"""通过 CDP 在打包应用的渲染进程里实测麦克风是否真能录到声音。

用法: python mic_probe_packaged.py [cdp_port]
"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.request

JS = r"""
(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const track = stream.getAudioTracks()[0]
    const label = track.label
    const rec = new MediaRecorder(stream)
    const parts = []
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
    const stopped = new Promise((r) => { rec.onstop = r })
    rec.start(250)
    await new Promise((r) => setTimeout(r, 3000))
    rec.stop()
    await stopped
    stream.getTracks().forEach((t) => t.stop())
    const blob = new Blob(parts, { type: rec.mimeType })
    const ac = new AudioContext()
    const buf = await ac.decodeAudioData(await blob.arrayBuffer())
    const d = buf.getChannelData(0)
    let sum = 0, peak = 0
    for (let i = 0; i < d.length; i++) {
      sum += d[i] * d[i]
      const a = Math.abs(d[i]); if (a > peak) peak = a
    }
    const rms = Math.sqrt(sum / d.length)
    return {
      ok: true, label, mime: rec.mimeType, chunks: parts.length,
      bytes: blob.size, duration: +buf.duration.toFixed(2),
      rms: +rms.toFixed(6), peak: +peak.toFixed(6),
      db: rms > 0 ? +(20 * Math.log10(rms)).toFixed(1) : null,
      verdict: peak > 0.001 ? '有声音输入 ✅' : '纯静音 ❌'
    }
  } catch (e) {
    return { ok: false, name: e.name, message: e.message }
  }
})()
"""


async def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as r:
        targets = json.loads(r.read())
    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        print("没有找到 page 目标")
        return 1
    page = pages[0]
    print(f"目标页面: {page['url'][:80]}")

    import websockets

    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=2**24) as ws:
        await ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {
                "expression": JS,
                "awaitPromise": True,
                "returnByValue": True,
                "userGesture": True,
            },
        }))
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=60))
            if msg.get("id") == 1:
                result = msg.get("result", {})
                if "exceptionDetails" in result:
                    print("执行异常:", json.dumps(result["exceptionDetails"], ensure_ascii=False))
                    return 1
                value = result.get("result", {}).get("value")
                print(json.dumps(value, ensure_ascii=False, indent=2))
                if isinstance(value, dict) and value.get("verdict", "").startswith("有声音"):
                    print("\n结论: 打包应用能录到真实声音 ✅")
                    return 0
                print("\n结论: 仍然录不到声音 ❌")
                return 2
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
