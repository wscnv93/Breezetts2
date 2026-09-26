"""Breeze TTS 2 推理引擎封装。

MLX 的计算流是线程本有的（Stream(gpu,0) 绑定创建它的线程），因此模型的
加载与全部生成都必须发生在同一个专职线程上：外部调用把任务投递到
_job_q，由 _ml_loop 顺序执行，生成结果通过线程安全队列流回调用方。
"""
from __future__ import annotations

import gc
import os
import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Optional

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parent
BREEZE_HOME = Path.home() / ".breezevoice"
DOWNLOAD_MODELS = Path.home() / ".downloadmodels"
APP_SUPPORT = Path.home() / "Library" / "Application Support" / "BreezeVoice"
MODEL_DIR_NAME = "Breeze-TTS-2-mlx"


def _settings_model_path() -> Optional[Path]:
    """settings.json 里用户手动指定的模型路径（设置面板可改）。"""
    try:
        import store

        p = str(store.load_settings().get("model_path") or "").strip()
        return Path(p) if p else None
    except Exception:  # noqa: BLE001
        return None


def resolve_model_path() -> Path:
    """按优先级查找模型目录：环境变量 → settings.json → ~/.downloadmodels →
    ~/.breezevoice → 旧版应用支持目录 → 项目目录。"""
    env = os.environ.get("BREEZE_MODEL_PATH")
    if env:
        return Path(env)
    for candidate in (
        _settings_model_path(),
        DOWNLOAD_MODELS / MODEL_DIR_NAME,
        BREEZE_HOME / "models" / MODEL_DIR_NAME,
        APP_SUPPORT / "models" / MODEL_DIR_NAME,
        BACKEND_DIR.parent / "models" / MODEL_DIR_NAME,
        BACKEND_DIR / "models" / MODEL_DIR_NAME,
    ):
        if candidate and candidate.exists():
            return candidate
    # 都不存在时返回默认下载位置，让上层报错信息里带上明确位置
    return DOWNLOAD_MODELS / MODEL_DIR_NAME


DEFAULT_MODEL_PATH = resolve_model_path()


@dataclass
class GenerateRequest:
    text: str
    instruct: Optional[str] = None
    ref_audio: Optional[str] = None  # 本地 wav 路径
    ref_text: Optional[str] = None
    voice: str = "S0"  # 引擎内部说话人占位标签（非可点选的预置音色）
    preset: Optional[str] = None  # 预置音色名，仅作历史记录标签
    cfg_scale: Optional[float] = None
    temperature: float = 0.9
    top_p: float = 1.0
    top_k: int = 50
    repetition_penalty: float = 1.0
    seed: Optional[int] = None
    max_tokens: int = 750
    streaming_interval: float = 1.0

    @property
    def mode(self) -> str:
        has_ref = bool(self.ref_audio)
        has_instruct = bool(self.instruct and self.instruct.strip())
        if has_ref and has_instruct:
            return "direction"
        if has_ref:
            return "clone"
        if has_instruct:
            return "design"
        return "builtin"


@dataclass
class Chunk:
    pcm: bytes
    sample_rate: int
    samples: int
    is_final: bool
    token_count: int
    real_time_factor: float
    tokens_per_sec: float
    peak_memory_gb: float


def float_to_pcm16(audio: np.ndarray) -> bytes:
    return (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


class TTSEngine:
    """模型加载与生成。所有 MLX 计算在专职线程上串行执行。"""

    def __init__(self, model_path: Path | str = DEFAULT_MODEL_PATH):
        self.model_path = Path(model_path)
        self._model = None
        self._state = "not_loaded"  # not_loaded / loading / ready / error
        self._error: Optional[str] = None
        self._load_lock = threading.Lock()
        self._gen_lock = threading.Lock()
        self._thread_lock = threading.Lock()
        self._ml_thread: Optional[threading.Thread] = None
        self._job_q: queue.Queue = queue.Queue()
        self.load_seconds: Optional[float] = None
        self.sample_rate = 24000
        self.last_stats: dict = {}

    # ---------- 专职 MLX 线程 ----------

    def _ensure_thread(self) -> None:
        with self._thread_lock:
            if self._ml_thread is None:
                self._ml_thread = threading.Thread(
                    target=self._ml_loop, daemon=True, name="mlx-worker"
                )
                self._ml_thread.start()

    def _ml_loop(self) -> None:
        while True:
            fn, done, box = self._job_q.get()
            try:
                box["result"] = fn()
            except BaseException as e:  # noqa: BLE001
                box["error"] = e
            finally:
                done.set()

    def _submit(self, fn: Callable):
        """投递任务并等待返回值（异常会重新抛出）。"""
        self._ensure_thread()
        done = threading.Event()
        box: dict = {}
        self._job_q.put((fn, done, box))
        done.wait()
        if "error" in box:
            raise box["error"]
        return box.get("result")

    def _submit_async(self, fn: Callable) -> None:
        """投递任务不等待（用于生成任务自身负责通过队列回传数据）。"""
        self._ensure_thread()
        self._job_q.put((fn, threading.Event(), {}))

    # ---------- 状态 ----------

    @property
    def state(self) -> str:
        return self._state

    @property
    def error(self) -> Optional[str]:
        return self._error

    def status(self) -> dict:
        return {
            "state": self._state,
            "error": self._error,
            "model_path": str(self.model_path),
            "model_exists": self.model_path.exists(),
            "load_seconds": self.load_seconds,
            "sample_rate": self.sample_rate,
            "last_stats": self.last_stats,
        }

    # ---------- 加载 ----------

    def set_model_path(self, path: Path | str) -> dict:
        """切换模型目录并卸载当前模型，下次生成时从新路径重新加载。

        生成进行中会抛 RuntimeError，避免换掉正在使用的权重。
        """
        if not self._gen_lock.acquire(blocking=False):
            raise RuntimeError("有生成任务正在进行，请等待完成或停止后再切换模型")
        try:
            with self._load_lock:
                self.model_path = Path(path)
                self._model = None
                self._state = "not_loaded"
                self._error = None
                self.load_seconds = None
                gc.collect()
                try:  # 释放 MLX 的 GPU 内存缓存
                    import mlx.core as mx

                    mx.metal.clear_cache()
                except Exception:  # noqa: BLE001
                    pass
            return self.status()
        finally:
            self._gen_lock.release()

    def load(self):
        """阻塞加载模型，幂等；失败后允许重试。"""
        with self._load_lock:
            if self._model is not None:
                return self._model
            self._state = "loading"
            self._error = None

            def _do_load():
                t0 = time.time()
                from mlx_audio.tts import load_model

                model = load_model(self.model_path)
                self.sample_rate = int(model.sample_rate)
                self.load_seconds = round(time.time() - t0, 2)
                return model

            try:
                self._model = self._submit(_do_load)
                self._state = "ready"
                return self._model
            except Exception as e:  # noqa: BLE001
                self._state = "error"
                self._error = f"{type(e).__name__}: {e}"
                raise

    # ---------- 并发控制 ----------

    def acquire_nowait(self) -> bool:
        return self._gen_lock.acquire(blocking=False)

    def acquire(self) -> None:
        self._gen_lock.acquire()

    def release(self) -> None:
        try:
            self._gen_lock.release()
        except RuntimeError:
            pass

    # ---------- 生成 ----------

    def generate(
        self, req: GenerateRequest, stop: Optional[threading.Event] = None
    ) -> Iterator[Chunk]:
        """流式生成。调用方需持有 _gen_lock（单并发）。

        stop 被置位时尽力提前终止；调用方中途放弃迭代也会触发同样的终止。
        """
        model = self.load()
        t_start = time.time()
        out_q: queue.Queue = queue.Queue()
        stop = stop or threading.Event()

        kwargs: dict = dict(
            text=req.text,
            voice=req.voice or "S0",
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            seed=req.seed,
            max_tokens=req.max_tokens,
            stream=True,
            streaming_interval=req.streaming_interval,
        )
        if req.instruct and req.instruct.strip():
            kwargs["instruct"] = req.instruct.strip()
            if req.cfg_scale:
                kwargs["cfg_scale"] = req.cfg_scale
        if req.ref_audio:
            kwargs["ref_audio"] = req.ref_audio
            kwargs["ref_text"] = req.ref_text or ""

        def _run() -> None:
            try:
                for r in model.generate(**kwargs):
                    if stop.is_set():
                        break
                    audio = (
                        np.asarray(r.audio, dtype=np.float32)
                        if r.samples
                        else np.zeros(0, np.float32)
                    )
                    out_q.put(
                        (
                            "chunk",
                            Chunk(
                                pcm=float_to_pcm16(audio),
                                sample_rate=int(r.sample_rate),
                                samples=int(r.samples),
                                is_final=bool(r.is_final_chunk),
                                token_count=int(r.token_count),
                                real_time_factor=float(r.real_time_factor),
                                tokens_per_sec=float(r.prompt.get("tokens-per-sec", 0.0)),
                                peak_memory_gb=float(r.peak_memory_usage),
                            ),
                        )
                    )
            except BaseException as e:  # noqa: BLE001
                out_q.put(("error", e))
            finally:
                out_q.put(("end", None))

        self._submit_async(_run)
        finished = False
        try:
            while True:
                kind, payload = out_q.get()
                if kind == "end":
                    finished = True
                    break
                if kind == "error":
                    raise payload
                yield payload
        finally:
            self.last_stats = {"wall_seconds": round(time.time() - t_start, 2)}
            # 异常或调用方提前放弃时，"end" 还没被消费：通知 MLX 线程停机，
            # 等它把剩余数据与 end 排空，避免占用下一次生成
            if not finished:
                stop.set()
                while True:
                    kind, _ = out_q.get()
                    if kind == "end":
                        break
