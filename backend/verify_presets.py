"""验证预置音色方案：10 个声音描述是否能生成互不相同的正常语音。

预置音色走官方支持的 Voice Design 路径（纯 instruction + cfg 4），
而不是模型里未训练的 [S0]-[S9] 占位 token。
"""
from __future__ import annotations

import itertools
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from tts_engine import TTSEngine, GenerateRequest

OUT = Path(__file__).resolve().parent.parent / "outputs" / "presets"

PRESETS: list[dict] = [
    {"id": "gentle_f", "name": "温柔女声",
     "zh": "一位温柔的年轻女性，声音清澈柔和，语速平缓，语气亲切自然，像在耳边轻声说话。",
     "en": "A gentle young woman with a clear, soft voice, speaking slowly and warmly."},
    {"id": "wise_f", "name": "知性女声",
     "zh": "一位成熟知性的女性，声音沉稳清晰，语调平和从容，有书卷气。",
     "en": "A mature, intellectual woman with a calm, clear and composed voice."},
    {"id": "lively_f", "name": "活泼少女",
     "zh": "一位年轻女孩，声音明亮清脆，语速偏快，充满元气和活力。",
     "en": "A young girl with a bright, crisp and energetic voice, speaking fairly fast."},
    {"id": "steady_m", "name": "沉稳男声",
     "zh": "一位成熟男性，声音低沉浑厚，字正腔圆，语速稳健有力。",
     "en": "A mature man with a deep, rich and steady voice, speaking clearly and firmly."},
    {"id": "magnetic_m", "name": "磁性男声",
     "zh": "一位中年男性，声音醇厚有磁性，娓娓道来，节奏舒缓。",
     "en": "A middle-aged man with a deep, magnetic and mellow voice, speaking slowly."},
    {"id": "news", "name": "新闻播报",
     "zh": "一位专业的新闻播音员，发音标准清晰，语调平稳有力，节奏规整。",
     "en": "A professional news anchor with precise pronunciation and a steady, authoritative delivery."},
    {"id": "docu", "name": "纪录片旁白",
     "zh": "一位纪录片解说员，声音沉稳大气，节奏舒缓，富有画面感和叙事感。",
     "en": "A documentary narrator with a deep, composed voice and a slow, evocative delivery."},
    {"id": "kids", "name": "儿童故事",
     "zh": "一位给孩子讲故事的温柔声音，语气生动亲切，节奏轻快，富有表情。",
     "en": "A warm storyteller for children, expressive and lively, with a gentle tone."},
    {"id": "night_radio", "name": "深夜电台",
     "zh": "一位深夜电台主持人，声音温柔低缓，气息柔和，贴近耳边。",
     "en": "A late-night radio host with a soft, low and intimate voice, speaking slowly."},
    {"id": "ad", "name": "广告活力",
     "zh": "一位广告配音员，年轻有活力，语调上扬，节奏明快，充满感染力。",
     "en": "An energetic young advertising voice actor with an upbeat, bright delivery."},
]

TEST_TEXT_ZH = "风吹过窗台，今天适合把这句话读给你听。"
TEST_TEXT_EN = "The wind drifts past the window; today is a good day to read this to you."


def gen(engine: TTSEngine, req: GenerateRequest) -> tuple[np.ndarray, int]:
    parts: list[np.ndarray] = []
    sr = 24000
    engine.acquire()
    try:
        for c in engine.generate(req):
            sr = c.sample_rate
            if c.pcm:
                parts.append(np.frombuffer(c.pcm, dtype="<i2").astype(np.float32) / 32767.0)
    finally:
        engine.release()
    return (np.concatenate(parts) if parts else np.zeros(0, np.float32)), sr


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    engine = TTSEngine()
    engine.load()
    print(f"模型就绪 ({engine.load_seconds}s)\n")

    results: dict[str, np.ndarray] = {}
    for i, p in enumerate(PRESETS, 1):
        t0 = time.time()
        audio, sr = gen(engine, GenerateRequest(
            text=TEST_TEXT_ZH, instruct=p["zh"], cfg_scale=4.0, seed=42,
        ))
        sf.write(str(OUT / f"{i:02d}-{p['id']}.wav"), audio, sr, subtype="PCM_16")
        rms = float(np.sqrt((audio ** 2).mean())) if audio.size else 0.0
        dur = audio.size / sr
        # 简单失真检查：峰值削顶比例过高说明合成异常
        clip = float((np.abs(audio) > 0.99).mean()) if audio.size else 1.0
        results[p["id"]] = audio
        print(f"[{i:02d}] {p['name']:<6} {dur:5.2f}s rms={rms:.3f} clip={clip:.4f} "
              f"耗时={time.time()-t0:5.1f}s")

    print("\n=== 音色两两差异（平均绝对差，>0.02 视为可区分）===")
    diffs = []
    for a, b in itertools.combinations(results, 2):
        x, y = results[a], results[b]
        n = min(len(x), len(y))
        if n == 0:
            continue
        diffs.append((float(np.abs(x[:n] - y[:n]).mean()), a, b))
    diffs.sort()
    print(f"最相似的三对：")
    for d, a, b in diffs[:3]:
        flag = "⚠️ 太像" if d < 0.02 else "✓"
        print(f"  {a} ↔ {b}: {d:.4f} {flag}")
    print(f"最不同的三对：")
    for d, a, b in diffs[-3:]:
        print(f"  {a} ↔ {b}: {d:.4f}")
    print(f"\n平均差异 {sum(d for d,_,_ in diffs)/len(diffs):.4f}，"
          f"最小 {diffs[0][0]:.4f}")
    print("输出目录:", OUT)

    # 英文指令也测一条，确认双语可用
    print("\n=== 英文文本 + 英文指令 ===")
    audio, sr = gen(engine, GenerateRequest(
        text=TEST_TEXT_EN, instruct=PRESETS[0]["en"], cfg_scale=4.0, seed=42,
    ))
    sf.write(str(OUT / "99-en-gentle_f.wav"), audio, sr, subtype="PCM_16")
    print(f"英文: {audio.size/sr:.2f}s rms={float(np.sqrt((audio**2).mean())):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
