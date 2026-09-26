"""生成历史与参考音频的本地存储。

数据根目录由 BREEZE_DATA_DIR 指定；默认 ~/.breezevoice（与常见 CLI 工具一致）。

<root>/
├── outputs/history/{id}.wav + {id}.json   每次生成的音频与元数据
└── outputs/refs/{id}.wav + {id}.json      已保存音色（24kHz 单声道）+ 元数据（名称/参考文字）
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

BACKEND_DIR = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("BREEZE_DATA_DIR") or Path.home() / ".breezevoice")
HISTORY_DIR = ROOT / "outputs" / "history"
REFS_DIR = ROOT / "outputs" / "refs"
SETTINGS_PATH = ROOT / "settings.json"
PEAK_BUCKETS = 160

# 旧版本的数据位置（打包应用支持目录 / 开发时的项目目录），启动时一次性迁入
LEGACY_OUTPUTS = [
    Path.home() / "Library" / "Application Support" / "BreezeVoice" / "outputs",
    BACKEND_DIR.parent / "outputs",
]


def _ensure_dirs() -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    REFS_DIR.mkdir(parents=True, exist_ok=True)


def ensure_dirs() -> None:
    """供启动时调用：建目录 + 迁移旧版数据（幂等，文件已存在则跳过）。"""
    _ensure_dirs()
    for legacy in LEGACY_OUTPUTS:
        try:
            if legacy.resolve() == (ROOT / "outputs").resolve():
                continue
        except OSError:
            continue
        for sub in ("history", "refs"):
            src_dir = legacy / sub
            if not src_dir.is_dir():
                continue
            dst_dir = ROOT / "outputs" / sub
            dst_dir.mkdir(parents=True, exist_ok=True)
            for f in src_dir.iterdir():
                dst = dst_dir / f.name
                try:
                    if f.is_file() and not dst.exists():
                        shutil.copy2(f, dst)
                except OSError:
                    continue


def compute_peaks(audio: np.ndarray, buckets: int = PEAK_BUCKETS) -> list[float]:
    """波形缩略图：等分取每段绝对峰值，归一化到 0~1。"""
    if audio.size == 0:
        return []
    step = max(1, audio.size // buckets)
    peaks = np.abs(audio[: step * buckets].reshape(-1, step)).max(axis=1)
    peak_max = peaks.max()
    if peak_max > 0:
        peaks = peaks / peak_max
    return [round(float(p), 3) for p in peaks]


def convert_to_wav(src: Path, dst: Path, sample_rate: int = 24000) -> float:
    """用 ffmpeg 转成单声道 s16 wav，返回时长（秒）。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-ac", "1", "-ar", str(sample_rate), "-sample_fmt", "s16", str(dst)],
        check=True,
    )
    info = sf.info(str(dst))
    return float(info.duration)


# ---------- 生成历史 ----------

def save_generation(
    audio: np.ndarray,
    sample_rate: int,
    meta: dict,
) -> dict:
    """写入 wav + json，返回完整元数据（含 peaks）。"""
    _ensure_dirs()
    gen_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    wav_path = HISTORY_DIR / f"{gen_id}.wav"
    sf.write(str(wav_path), audio, sample_rate, subtype="PCM_16")

    entry = {
        "id": gen_id,
        "created_at": time.time(),
        "duration": round(audio.size / sample_rate, 3),
        "samples": int(audio.size),
        "peaks": compute_peaks(audio),
        "file": f"{gen_id}.wav",
        **meta,
    }
    (HISTORY_DIR / f"{gen_id}.json").write_text(
        json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return entry


def list_history(limit: int = 100) -> list[dict]:
    if not HISTORY_DIR.exists():
        return []
    entries = []
    for jf in HISTORY_DIR.glob("*.json"):
        try:
            entries.append(json.loads(jf.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            continue
    entries.sort(key=lambda e: e.get("created_at", 0), reverse=True)
    return entries[:limit]


def delete_history(gen_id: str) -> bool:
    ok = False
    for ext in (".wav", ".json"):
        p = HISTORY_DIR / f"{gen_id}{ext}"
        if p.exists():
            p.unlink(missing_ok=True)
            ok = True
    return ok


# ---------- 应用设置 ----------

def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_settings(update: dict) -> dict:
    """合并写入 settings.json，返回合并后的完整设置。"""
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    merged = {**load_settings(), **update}
    SETTINGS_PATH.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return merged


# ---------- 参考音频（我的音色库） ----------

MAX_REF_NAME_LEN = 60


def _clean_ref_name(name: object) -> Optional[str]:
    s = str(name or "").strip()
    return s[:MAX_REF_NAME_LEN] or None


def _ref_meta_path(ref_id: str) -> Path:
    return REFS_DIR / f"{ref_id}.json"


def _ref_entry(wav_path: Path, meta: dict) -> dict:
    """wav 事实 + 元数据合成完整条目（元数据缺失字段回退到探测值）。"""
    audio, sr = sf.read(str(wav_path), dtype="float32")
    duration = audio.size / sr if sr else 0.0
    return {
        "id": wav_path.stem,
        "duration": round(duration, 2),
        "sample_rate": sr,
        "peaks": compute_peaks(audio),
        "file": wav_path.name,
        "name": None,
        "ref_text": None,
        "created_at": wav_path.stat().st_mtime,
        **meta,
    }


def save_ref(
    src: Path,
    sample_rate: int = 24000,
    name: Optional[str] = None,
    ref_text: Optional[str] = None,
) -> dict:
    """转码入库：wav + 元数据 json。name/ref_text 可由前端随上传带上。"""
    _ensure_dirs()
    ref_id = "ref-" + uuid.uuid4().hex[:10]
    wav_path = REFS_DIR / f"{ref_id}.wav"
    duration = convert_to_wav(src, wav_path, sample_rate)
    meta = {
        "name": _clean_ref_name(name) or f"音色 {time.strftime('%m-%d %H:%M')}",
        "ref_text": (ref_text or "").strip() or None,
        "created_at": time.time(),
    }
    entry = _ref_entry(wav_path, meta)
    _write_ref_meta(entry)
    return entry


def _write_ref_meta(entry: dict) -> None:
    (REFS_DIR / f"{entry['id']}.json").write_text(
        json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def list_refs(limit: int = 100) -> list[dict]:
    """已保存音色，按创建时间倒序。早期只有 wav 的旧参考音频会自愈补出元数据。"""
    if not REFS_DIR.exists():
        return []
    entries: list[dict] = []
    for wav_path in REFS_DIR.glob("*.wav"):
        mp = _ref_meta_path(wav_path.stem)
        meta: dict = {}
        if mp.exists():
            try:
                meta = json.loads(mp.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                meta = {}
        else:
            # 旧数据自愈：按文件 mtime 命名并落盘元数据，之后无需再探测
            meta = {
                "name": f"参考音频 {time.strftime('%m-%d %H:%M', time.localtime(wav_path.stat().st_mtime))}",
                "ref_text": None,
                "created_at": wav_path.stat().st_mtime,
            }
            try:
                _write_ref_meta(_ref_entry(wav_path, meta))
            except OSError:
                pass
        try:
            entries.append(_ref_entry(wav_path, meta))
        except Exception:  # noqa: BLE001
            continue
    entries.sort(key=lambda e: e.get("created_at", 0), reverse=True)
    return entries[:limit]


def get_ref_path(ref_id: str) -> Optional[Path]:
    p = REFS_DIR / f"{ref_id}.wav"
    return p if p.exists() else None


def update_ref(ref_id: str, name: Optional[str] = None, ref_text: Optional[str] = None) -> Optional[dict]:
    """更新音色名称/参考文字。传 None 表示不修改该字段。"""
    wav_path = REFS_DIR / f"{ref_id}.wav"
    if not wav_path.exists():
        return None
    mp = _ref_meta_path(ref_id)
    meta: dict = {}
    if mp.exists():
        try:
            meta = json.loads(mp.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            meta = {}
    if name is not None:
        cleaned = _clean_ref_name(name)
        if not cleaned:
            raise ValueError("音色名称不能为空")
        meta["name"] = cleaned
    if ref_text is not None:
        meta["ref_text"] = ref_text.strip() or None
    meta.setdefault("created_at", wav_path.stat().st_mtime)
    entry = _ref_entry(wav_path, meta)
    _write_ref_meta(entry)
    return entry


def delete_ref(ref_id: str) -> bool:
    p = REFS_DIR / f"{ref_id}.wav"
    existed = p.exists()
    if existed:
        p.unlink()
    _ref_meta_path(ref_id).unlink(missing_ok=True)
    return existed
