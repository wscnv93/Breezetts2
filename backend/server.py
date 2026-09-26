"""Breeze TTS 2 本地推理服务。

HTTP:
  GET  /api/health              服务与模型状态
  GET  /api/model               模型路径/有效性 + 下载任务状态
  POST /api/model/path          设置模型路径 {path}（写入 settings.json 并热切换）
  POST /api/model/download      启动下载 {source: "modelscope"|"huggingface"}
  POST /api/model/cancel        取消进行中的下载
  GET  /api/history             生成历史列表
  DELETE /api/history/{id}      删除一条历史
  GET  /api/ref_audio           已保存音色列表（含名称/参考文字）
  POST /api/ref_audio           上传克隆参考音频 (multipart: file[, name, ref_text]，
                                ffmpeg 转 24kHz mono wav，自动入「我的音色」库)
  PATCH /api/ref_audio/{id}     更新音色名称/参考文字 {name?, ref_text?}
  DELETE /api/ref_audio/{id}    删除音色
  POST /api/tts                 非流式生成，返回完整 WAV（调试/兜底用）
WebSocket /ws/tts:
  → {"action":"generate","request":{text,instruct,ref_id,ref_text,cfg_scale,...}}
  ← {"type":"meta"|"model_loading"|"model_ready"|"queued"|"done"|"cancelled"|"error",...}
  ← binary: PCM16LE 单声道帧（sample_rate 见 meta）
  → {"action":"cancel"}  取消当前生成（保留已生成片段）
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

import store
import model_downloader
from tts_engine import DEFAULT_MODEL_PATH, GenerateRequest, TTSEngine

log = logging.getLogger("breezetts")

ROOT = store.ROOT
MAX_TEXT_LEN = 5000
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

engine = TTSEngine(os.environ.get("BREEZE_MODEL_PATH", DEFAULT_MODEL_PATH))


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.environ.get("BREEZE_NO_PRELOAD") != "1":
        threading.Thread(target=_safe_preload, daemon=True).start()
    yield


def _safe_preload() -> None:
    try:
        engine.load()
        log.info("模型就绪，加载耗时 %ss", engine.load_seconds)
    except Exception:  # noqa: BLE001
        log.exception("模型预加载失败")


app = FastAPI(title="Breeze TTS 2 Local Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
store.ensure_dirs()
app.mount("/outputs", StaticFiles(directory=ROOT / "outputs"), name="outputs")


# ---------- 请求解析 ----------

def _clamp(v, lo, hi, default):
    if v is None:
        return default
    try:
        v = type(default)(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


BUILTIN_VOICES = [f"S{i}" for i in range(10)]


def _validate_voice(v) -> str:
    if v is None or str(v).strip() == "":
        return "S0"
    s = str(v).strip()
    if s not in BUILTIN_VOICES:
        raise ValueError(f"不支持的音色: {s}（可选 {BUILTIN_VOICES[0]}–{BUILTIN_VOICES[-1]}）")
    return s


def parse_request(body: dict) -> GenerateRequest:
    text = (body.get("text") or "").strip()
    if not text:
        raise ValueError("text 不能为空")
    if len(text) > MAX_TEXT_LEN:
        raise ValueError(f"text 过长（>{MAX_TEXT_LEN} 字）")

    instruct = (body.get("instruct") or "").strip() or None
    ref_text = (body.get("ref_text") or "").strip() or None
    ref_id = (body.get("ref_id") or "").strip() or None

    ref_audio = None
    if ref_id:
        ref_audio = store.get_ref_path(ref_id)
        if ref_audio is None:
            raise ValueError(f"参考音频不存在: {ref_id}")
        if not ref_text:
            raise ValueError("声音克隆需要提供参考音频的完整文字（ref_text）")

    return GenerateRequest(
        text=text,
        instruct=instruct,
        ref_audio=str(ref_audio) if ref_audio else None,
        ref_text=ref_text if ref_audio else None,
        voice=_validate_voice(body.get("voice")),
        preset=(str(body.get("preset")).strip() or None) if body.get("preset") else None,
        cfg_scale=_clamp(body.get("cfg_scale"), 1.0, 10.0, 4.0),
        temperature=_clamp(body.get("temperature"), 0.0, 2.0, 0.9),
        top_p=_clamp(body.get("top_p"), 0.0, 1.0, 1.0),
        top_k=int(_clamp(body.get("top_k"), 1, 200, 50)),
        repetition_penalty=_clamp(body.get("repetition_penalty"), 1.0, 2.0, 1.0),
        seed=body.get("seed") if body.get("seed") is not None else None,
        max_tokens=int(_clamp(body.get("max_tokens"), 100, 3000, 750)),
        streaming_interval=_clamp(body.get("streaming_interval"), 0.5, 5.0, 1.0),
    )


def _meta_of(req: GenerateRequest) -> dict:
    return {
        "mode": req.mode,
        "text": req.text,
        "instruct": req.instruct,
        "ref_text": req.ref_text,
        "voice": req.voice,
        "preset": req.preset,
        "params": {
            "cfg_scale": req.cfg_scale if req.instruct else None,
            "temperature": req.temperature,
            "top_p": req.top_p,
            "top_k": req.top_k,
            "seed": req.seed,
        },
    }


# ---------- HTTP ----------

@app.get("/api/health")
async def health():
    return {"ok": True, "engine": engine.status()}


# ---------- 模型路径与下载 ----------

def _model_info() -> dict:
    st = engine.status()
    p = Path(st["model_path"])
    # 完整性粗检：模型目录应包含模型权重与配置
    complete = p.is_dir() and (p / "config.json").exists() and any(p.glob("*.safetensors"))
    return {
        "model_path": str(p),
        "model_exists": st["model_exists"],
        "model_complete": complete,
        "engine_state": st["state"],
        "engine_error": st["error"],
        "load_seconds": st["load_seconds"],
        "sample_rate": st["sample_rate"],
        "download_dir": str(model_downloader.DOWNLOAD_ROOT),
        "download_target": str(model_downloader.TARGET_DIR),
        "download": model_downloader.status(),
    }


def _apply_model_path(path: Path) -> None:
    """记录到 settings.json 并让引擎热切换（重新解析默认路径时也会命中）。"""
    store.save_settings({"model_path": str(path)})
    engine.set_model_path(path)


@app.get("/api/model")
async def model_info():
    return _model_info()


@app.post("/api/model/path")
async def model_set_path(body: dict):
    raw = str(body.get("path") or "").strip()
    if not raw:
        raise HTTPException(400, "path 不能为空")
    p = Path(raw).expanduser().resolve()
    if not p.is_dir():
        raise HTTPException(400, f"目录不存在: {p}")
    if not (p / "config.json").exists():
        raise HTTPException(400, f"{p} 不像模型目录（缺少 config.json）")
    try:
        engine.set_model_path(p)
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e
    store.save_settings({"model_path": str(p)})
    return _model_info()


@app.post("/api/model/download")
async def model_download(body: dict):
    source = str(body.get("source") or "").strip()

    def on_success(target: Path) -> None:
        try:
            _apply_model_path(target)
        except Exception:  # noqa: BLE001
            log.exception("下载完成后自动切换模型失败")

    try:
        return {**_model_info(), "download": model_downloader.start(source, on_success=on_success)}
    except (ValueError, RuntimeError) as e:
        raise HTTPException(400, str(e)) from e


@app.post("/api/model/cancel")
async def model_cancel():
    ok = model_downloader.cancel()
    if not ok:
        raise HTTPException(400, "当前没有进行中的下载")
    return {"ok": True}


@app.get("/api/history")
async def history(limit: int = 100):
    return store.list_history(limit=min(limit, 500))


@app.delete("/api/history/{gen_id}")
async def history_delete(gen_id: str):
    if not store.delete_history(gen_id):
        raise HTTPException(404, "历史记录不存在")
    return {"ok": True}


@app.get("/api/ref_audio")
async def ref_audio_list(limit: int = 100):
    return store.list_refs(limit=min(limit, 500))


@app.post("/api/ref_audio")
async def ref_audio_upload(
    file: UploadFile,
    name: str = Form(default=""),
    ref_text: str = Form(default=""),
):
    import shutil as _sh

    if not _sh.which("ffmpeg"):
        raise HTTPException(500, "未找到 ffmpeg，无法处理参考音频")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "文件过大（>50MB）")
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    tmp = store.REFS_DIR / f"tmp-{os.getpid()}-{threading.get_ident()}{suffix}"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    try:
        tmp.write_bytes(data)
        info = store.save_ref(tmp, name=name, ref_text=ref_text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"音频处理失败: {e}") from e
    finally:
        tmp.unlink(missing_ok=True)
    return info


@app.get("/api/ref_audio/{ref_id}")
async def ref_audio_get(ref_id: str):
    p = store.get_ref_path(ref_id)
    if p is None:
        raise HTTPException(404, "参考音频不存在")
    return FileResponse(str(p), media_type="audio/wav")


@app.patch("/api/ref_audio/{ref_id}")
async def ref_audio_update(ref_id: str, body: dict):
    try:
        entry = store.update_ref(
            ref_id,
            name=body.get("name") if "name" in body else None,
            ref_text=body.get("ref_text") if "ref_text" in body else None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if entry is None:
        raise HTTPException(404, "参考音频不存在")
    return entry


@app.delete("/api/ref_audio/{ref_id}")
async def ref_audio_delete(ref_id: str):
    if not store.delete_ref(ref_id):
        raise HTTPException(404, "参考音频不存在")
    return {"ok": True}


@app.post("/api/tts")
async def tts_http(body: dict):
    try:
        req = parse_request(body)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    def run() -> tuple[bytes, dict]:
        engine.load()
        engine.acquire()
        try:
            parts: list[np.ndarray] = []
            stats: dict = {}
            sample_rate = engine.sample_rate
            for chunk in engine.generate(req, stop=threading.Event()):
                sample_rate = chunk.sample_rate
                if chunk.pcm:
                    parts.append(np.frombuffer(chunk.pcm, dtype="<i2").astype(np.float32) / 32767.0)
                stats = {
                    "rtf": chunk.real_time_factor,
                    "tokens_per_sec": chunk.tokens_per_sec,
                    "peak_memory_gb": chunk.peak_memory_gb,
                }
            audio = np.concatenate(parts) if parts else np.zeros(0, np.float32)
            entry = store.save_generation(audio, sample_rate, _meta_of(req) | {"stats": stats})
            buf = io.BytesIO()
            sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
            return buf.getvalue(), entry
        finally:
            engine.release()

    wav_bytes, entry = await asyncio.to_thread(run)
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"X-History-Id": entry["id"], "X-Duration": str(entry["duration"])},
    )


# ---------- WebSocket 流式 ----------

@app.websocket("/ws/tts")
async def ws_tts(ws: WebSocket):
    await ws.accept()
    try:
        first = json.loads(await ws.receive_text())
    except (WebSocketDisconnect, json.JSONDecodeError):
        return
    if first.get("action") != "generate":
        await _ws_send_json(ws, {"type": "error", "message": "第一条消息应为 action=generate"})
        return
    try:
        req = parse_request(first.get("request") or {})
    except ValueError as e:
        await _ws_send_json(ws, {"type": "error", "message": str(e)})
        return

    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()
    cancel = threading.Event()

    def put(kind: str, payload=None) -> None:
        loop.call_soon_threadsafe(q.put_nowait, (kind, payload))

    def worker() -> None:
        acquired = False
        try:
            if engine.state != "ready":
                put("model_loading")
                engine.load()
                put("model_ready", {"load_seconds": engine.load_seconds})
            if cancel.is_set():
                put("cancelled")
                return
            if not engine.acquire_nowait():
                put("queued")
                engine.acquire()
                acquired = True
                if cancel.is_set():
                    put("cancelled")
                    return
            else:
                acquired = True

            parts: list[np.ndarray] = []
            stats: dict = {}
            sample_rate = engine.sample_rate
            interrupted = False
            t_gen = time.time()
            try:
                for chunk in engine.generate(req, stop=cancel):
                    if cancel.is_set():
                        interrupted = True
                        break
                    sample_rate = chunk.sample_rate
                    if chunk.pcm:
                        parts.append(
                            np.frombuffer(chunk.pcm, dtype="<i2").astype(np.float32) / 32767.0
                        )
                    stats = {
                        "rtf": chunk.real_time_factor,
                        "tokens_per_sec": chunk.tokens_per_sec,
                        "peak_memory_gb": max(
                            stats.get("peak_memory_gb", 0.0), chunk.peak_memory_gb
                        ),
                        "tokens": stats.get("tokens", 0) + chunk.token_count,
                    }
                    if chunk.pcm:
                        put("chunk", chunk)
            finally:
                engine.release()
                acquired = False

            # 停止信号可能由引擎内部传播（生成器干净结束），这里统一判定
            interrupted = interrupted or cancel.is_set()
            audio = np.concatenate(parts) if parts else np.zeros(0, np.float32)
            # 汇总为整体统计（此前是最后一个片段的瞬时值）
            wall = time.time() - t_gen
            duration = audio.size / sample_rate
            stats = stats | {
                "rtf": round(wall / max(duration, 1e-6), 2),
                "tokens_per_sec": round(stats.get("tokens", 0) / max(wall, 1e-6), 1),
            }
            if audio.size == 0:
                put("error", "未生成任何音频，请调整文本或参数后重试")
                return
            meta = _meta_of(req) | {
                "stats": stats,
                "partial": interrupted,
            }
            entry = store.save_generation(audio, sample_rate, meta)
            if interrupted:
                put("cancelled", {"history": entry, "stats": stats})
            else:
                put("done", {"history": entry, "stats": stats})
        except Exception as e:  # noqa: BLE001
            log.exception("生成失败")
            put("error", f"{type(e).__name__}: {e}")
        finally:
            if acquired:
                engine.release()
            put("stop")

    threading.Thread(target=worker, daemon=True, name="tts-worker").start()

    async def sender() -> None:
        await _ws_send_json(
            ws,
            {"type": "meta", "sample_rate": engine.sample_rate, "mode": req.mode,
             "max_text_len": MAX_TEXT_LEN},
        )
        closed = False
        while True:
            kind, payload = await q.get()
            if kind == "stop":
                break
            if closed:
                continue
            try:
                if kind == "chunk":
                    await ws.send_bytes(payload.pcm)
                    await _ws_send_json(
                        ws,
                        {
                            "type": "progress",
                            "samples": payload.samples,
                            "is_final": payload.is_final,
                            "stats": {
                                "rtf": payload.real_time_factor,
                                "tokens_per_sec": payload.tokens_per_sec,
                                "peak_memory_gb": payload.peak_memory_gb,
                                "tokens": payload.token_count,
                            },
                        },
                    )
                elif kind in ("done", "cancelled"):
                    msg = {"type": kind, **(payload or {})}
                    await _ws_send_json(ws, msg)
                elif kind in ("model_loading", "model_ready", "queued"):
                    await _ws_send_json(ws, {"type": kind, **(payload if payload else {})})
                elif kind == "error":
                    await _ws_send_json(ws, {"type": "error", "message": payload})
            except Exception:  # 客户端断开：停止发送，继续排水
                closed = True
                cancel.set()

    async def receiver() -> None:
        try:
            while True:
                m = await ws.receive_text()
                with contextlib.suppress(json.JSONDecodeError):
                    data = json.loads(m)
                    if data.get("action") == "cancel":
                        cancel.set()
        except (WebSocketDisconnect, RuntimeError):
            cancel.set()

    send_task = asyncio.create_task(sender())
    recv_task = asyncio.create_task(receiver())
    await send_task
    recv_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await recv_task


async def _ws_send_json(ws: WebSocket, obj: dict) -> None:
    await ws.send_text(json.dumps(obj, ensure_ascii=False))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Breeze TTS 2 本地推理服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
