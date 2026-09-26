"""模型下载器：后台子进程运行 modelscope / hf CLI，解析 tqdm 进度条。

同一时间只允许一个下载任务。状态通过 status() 轮询获取（前端每秒拉一次）。
取消即 terminate 子进程；断点续传由 CLI 自身保证，重试即可继续。
"""
from __future__ import annotations

import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable, Iterator, Optional

MODEL_DIR_NAME = "Breeze-TTS-2-mlx"
REPO_ID = f"mlx-community/{MODEL_DIR_NAME}"
DOWNLOAD_ROOT = Path.home() / ".downloadmodels"
TARGET_DIR = DOWNLOAD_ROOT / MODEL_DIR_NAME

SOURCES = ("modelscope", "huggingface")

_lock = threading.Lock()
_state: dict = {"active": False}
_proc: Optional[subprocess.Popen] = None
_cancelled = False


def status() -> dict:
    with _lock:
        return dict(_state)


def is_active() -> bool:
    return _state.get("active", False)


def _venv_bin(name: str) -> str:
    """与当前解释器同 venv 的 CLI 路径（开发 venv 与打包 venv 布局一致）。"""
    return str(Path(sys.executable).parent / name)


def _build_cmd(source: str, target: Path) -> list[str]:
    if source == "modelscope":
        return [_venv_bin("modelscope"), "download", "--model", REPO_ID,
                "--local_dir", str(target)]
    return [_venv_bin("hf"), "download", REPO_ID, "--local-dir", str(target)]


# tqdm 行：模型-00001.safetensors:  45%|████▍  | 3.4G/7.6G [01:02<01:15, 55.5M/s]
_PROGRESS_RE = re.compile(
    r"^(?P<name>[^:%\r\n]+):\s+(?P<pct>\d{1,3})%\|[^|]*\|\s*"
    r"(?P<done>[\d.]+)(?P<du>[kMGT]?i?B?)?/(?P<total>[\d.]+)(?P<tu>[kMGT]?i?B?)?"
)
_UNIT = {"": 1, "k": 10**3, "M": 10**6, "G": 10**9, "T": 10**12}


def _to_bytes(num: str, unit: Optional[str]) -> float:
    u = (unit or "").replace("iB", "").replace("B", "")
    return float(num) * _UNIT.get(u, 1)


def start(source: str, target: Path = TARGET_DIR,
          on_success: Optional[Callable[[Path], None]] = None) -> dict:
    """启动后台下载并立即返回初始状态；已有任务在跑时抛 RuntimeError。"""
    global _proc, _state, _cancelled
    if source not in SOURCES:
        raise ValueError(f"不支持的下载源: {source}（可选 {SOURCES}）")
    with _lock:
        if _state.get("active"):
            raise RuntimeError("已有下载任务正在进行")
        _cancelled = False
        _state = {
            "active": True,
            "source": source,
            "phase": "running",
            "target": str(target),
            "file": None,
            "percent": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": None,
            "speed": None,
            "error": None,
            "started_at": time.time(),
            "finished_at": None,
        }
        target.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen(
            _build_cmd(source, target),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        _proc = proc

    def watch() -> None:
        global _proc
        per_file: dict[str, tuple[float, float]] = {}
        tail: list[str] = []
        try:
            assert proc.stderr is not None
            for block in _iter_stream(proc.stderr):
                m = _PROGRESS_RE.match(block)
                if m:
                    done = _to_bytes(m.group("done"), m.group("du"))
                    total = _to_bytes(m.group("total"), m.group("tu"))
                    if total > 0:
                        per_file[m.group("name").strip()] = (done, total)
                    speed = _parse_speed(block)
                    overall_done = sum(v[0] for v in per_file.values())
                    overall_total = sum(v[1] for v in per_file.values())
                    with _lock:
                        _state.update(
                            file=m.group("name").strip(),
                            percent=round(overall_done / overall_total * 100, 1)
                            if overall_total else int(m.group("pct")),
                            downloaded_bytes=int(overall_done),
                            total_bytes=int(overall_total) if overall_total else None,
                            speed=speed,
                        )
                else:
                    tail.append(block.strip())
                    tail[:] = tail[-8:]
            code = proc.wait()
            with _lock:
                _state["active"] = False
                _state["finished_at"] = time.time()
                if _cancelled:
                    _state["phase"] = "cancelled"
                elif code == 0:
                    _state["phase"] = "done"
                    _state["percent"] = 100.0
                else:
                    _state["phase"] = "error"
                    _state["error"] = _summarize_error(tail) or f"下载进程退出（code={code}）"
            if code == 0 and not _cancelled and on_success:
                try:
                    on_success(target)
                except Exception:  # noqa: BLE001
                    pass
        finally:
            with _lock:
                _proc = None

    threading.Thread(target=watch, daemon=True, name="model-download").start()
    return status()


def cancel() -> bool:
    """终止当前下载。已下载的文件保留，CLI 支持断点续传。"""
    global _cancelled
    with _lock:
        if not _state.get("active") or _proc is None:
            return False
        _cancelled = True
        _proc.terminate()
        return True


def _iter_stream(stream) -> Iterator[str]:
    """按 \r 或 \n 切分 tqdm 输出（进度条靠回车符原地刷新）。"""
    buf = ""
    while True:
        ch = stream.read(1)
        if not ch:
            if buf.strip():
                yield buf
            return
        if ch in ("\r", "\n"):
            if buf.strip():
                yield buf
            buf = ""
        else:
            buf += ch


def _summarize_error(tail: list[str]) -> str:
    """从 CLI 输出尾部挑出人能读懂的错误行（优先含异常名/网络关键词的）。"""
    kw = ("Error", "error", "Timeout", "timed out", "Connect", "connect",
          "refused", "unreachable", "denied", "404", "403")
    picks = [t for t in tail if any(k in t for k in kw)]
    msg = "；".join(picks[-2:] or tail[-1:])[-400:]
    return msg


def _parse_speed(block: str) -> Optional[float]:
    m = re.search(r"([\d.]+)([kMGT]?)B?/s", block)
    if not m:
        return None
    return round(_to_bytes(m.group(1), m.group(2)), 0)
