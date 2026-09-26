"""模型验证：三种模式各生成一条，输出 wav 与性能数据。

用法: uv run python verify_model.py [--model PATH]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from tts_engine import DEFAULT_MODEL_PATH, GenerateRequest, TTSEngine, float_to_pcm16

OUT = Path(__file__).resolve().parent.parent / "outputs" / "verify"


def run(engine: TTSEngine, name: str, req: GenerateRequest) -> dict:
    t0 = time.time()
    parts, sr, stats = [], None, {}
    engine.acquire()
    try:
        for chunk in engine.generate(req):
            sr = chunk.sample_rate
            if chunk.pcm:
                parts.append(np.frombuffer(chunk.pcm, dtype="<i2").astype(np.float32) / 32767.0)
            stats = {"tokens_per_sec": chunk.tokens_per_sec, "peak_memory_gb": chunk.peak_memory_gb}
    finally:
        engine.release()
    audio = np.concatenate(parts) if parts else np.zeros(0, np.float32)
    wav = OUT / f"{name}.wav"
    sf.write(str(wav), audio, sr, subtype="PCM_16")
    wall = time.time() - t0
    info = {
        "mode": req.mode,
        "wav": str(wav),
        "duration_s": round(audio.size / sr, 2),
        "wall_s": round(wall, 2),
        "rtf": round(wall / max(audio.size / sr, 1e-6), 3),
        **stats,
    }
    print(f"[{name}] {info}")
    return info


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=str(DEFAULT_MODEL_PATH))
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    engine = TTSEngine(args.model)
    print(f"加载模型: {args.model}")
    engine.load()
    print(f"模型就绪，耗时 {engine.load_seconds}s，采样率 {engine.sample_rate}")

    # 1) 音色设计：纯文字描述创建声音
    design = run(engine, "1-design", GenerateRequest(
        text="(sigh) 欢迎使用微风语音合成系统，愿它为你带来一丝清凉。",
        instruct="一位温柔的年轻女性，声音清澈明亮，语速平缓，语气亲切自然。",
        cfg_scale=4.0,
        seed=42,
    ))

    # 2) 声音克隆：用第 1 步的输出做参考音频
    ref_wav = str(OUT / "1-design.wav")
    clone = run(engine, "2-clone", GenerateRequest(
        text="这是用刚才那段声音克隆出来的语音，听起来像同一个人吗？",
        ref_audio=ref_wav,
        ref_text="(叹气) 欢迎使用微风语音合成系统，愿它为你带来一丝清凉。",
        seed=42,
    ))

    # 3) 语气控制：参考音频 + 自然语言指令
    direction = run(engine, "3-direction", GenerateRequest(
        text="[笑] 今天真是太开心了，所有的事情都顺利得不可思议！",
        ref_audio=ref_wav,
        ref_text="(叹气) 欢迎使用微风语音合成系统，愿它为你带来一丝清凉。",
        instruct="语速加快，语气兴奋欢快，带着抑制不住的喜悦。",
        cfg_scale=4.0,
        seed=42,
    ))

    print("\n全部通过 ✅  输出目录:", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
