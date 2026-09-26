"""API 联调：HTTP 生成、参考音频上传+克隆、WS 流式、历史、删除。"""
from __future__ import annotations

import asyncio
import json
import sys
import urllib.error
import urllib.request

import websockets

BASE = "http://127.0.0.1:8765"
WS = "ws://127.0.0.1:8765/ws/tts"


def http_json(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


async def ws_test() -> dict:
    async with websockets.connect(WS, max_size=2**30) as ws:
        await ws.send(json.dumps({
            "action": "generate",
            "request": {"text": "这是流式接口测试，声音应该在生成的同时逐步传来。", "seed": 5},
        }))
        pcm_bytes = 0
        last = None
        while True:
            msg = await ws.recv()
            if isinstance(msg, bytes):
                pcm_bytes += len(msg)
            else:
                last = json.loads(msg)
                print("  ws:", {k: v for k, v in last.items() if k != "history"}, flush=True)
                if last.get("type") in ("done", "error", "cancelled"):
                    return {"type": last["type"], "pcm": pcm_bytes, "msg": last}


async def ws_cancel_test() -> str:
    async with websockets.connect(WS, max_size=2**30) as ws:
        await ws.send(json.dumps({
            "action": "generate",
            "request": {"text": "这条很长很长，" * 30, "seed": 9},
        }))
        got_binary = False
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=60)
            if isinstance(msg, bytes):
                if not got_binary:
                    got_binary = True
                    await ws.send(json.dumps({"action": "cancel"}))
            else:
                d = json.loads(msg)
                if d.get("type") in ("cancelled", "done", "error"):
                    return d["type"]


def main() -> int:
    print("[1] HTTP /api/tts 设计模式")
    # 返回头里拿 history id
    req = urllib.request.Request(
        BASE + "/api/tts",
        data=json.dumps({"text": "你好，这是接口测试。", "instruct": "温和清晰的年轻女声",
                          "cfg_scale": 4, "seed": 7}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        wav = r.read()
        hid = r.headers["X-History-Id"]
    assert wav[:4] == b"RIFF" and len(wav) > 40000, "wav 异常"
    print(f"  ok: {len(wav)} bytes, history={hid}")

    print("[2] 参考音频上传 + 音色库 + 克隆")
    boundary = "----breezeform"
    with open("../outputs/verify/1-design.wav", "rb") as f:
        ref_bytes = f.read()
    parts = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
        f"filename=\"ref.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
    ).encode() + ref_bytes + (
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n"
        f"测试音色\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"ref_text\"\r\n\r\n"
        f"欢迎使用微风语音合成系统。\r\n--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(
        BASE + "/api/ref_audio", data=parts, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        ref = json.loads(r.read())
    print(f"  ok: ref_id={ref['id']} name={ref['name']} duration={ref['duration']}s peaks={len(ref['peaks'])}")
    assert ref["name"] == "测试音色" and ref["ref_text"] == "欢迎使用微风语音合成系统。"

    print("[2b] 音色库：列表 / 改名 / 删除")
    refs = http_json("GET", "/api/ref_audio")
    assert any(x["id"] == ref["id"] for x in refs), "上传的音色应出现在列表里"
    patched = http_json("PATCH", f"/api/ref_audio/{ref['id']}",
                        {"name": "测试音色A", "ref_text": "改名后的文字。"})
    assert patched["name"] == "测试音色A" and patched["ref_text"] == "改名后的文字。"
    refs2 = http_json("GET", "/api/ref_audio")
    saved = [x for x in refs2 if x["id"] == ref["id"]][0]
    assert saved["name"] == "测试音色A" and saved["ref_text"] == "改名后的文字。"
    http_json("DELETE", f"/api/ref_audio/{ref['id']}")
    assert all(x["id"] != ref["id"] for x in http_json("GET", "/api/ref_audio"))
    print("  ok: 库列表/改名/删除均生效")

    req = urllib.request.Request(
        BASE + "/api/tts",
        data=json.dumps({"text": "这是克隆出来的声音，应该像参考音频里的那个人。",
                          "ref_id": ref["id"],
                          "ref_text": "(叹气) 欢迎使用微风语音合成系统，愿它为你带来一丝清凉。",
                          "seed": 3}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        wav = r.read()
    assert wav[:4] == b"RIFF" and len(wav) > 40000
    print(f"  ok: clone {len(wav)} bytes")

    print("[3] WebSocket 流式")
    res = asyncio.run(ws_test())
    assert res["type"] == "done" and res["pcm"] > 40000, res
    print(f"  ok: {res['pcm']} bytes PCM, duration={res['msg']['history']['duration']}s")

    print("[4] WebSocket 取消")
    kind = asyncio.run(ws_cancel_test())
    assert kind == "cancelled", kind
    print("  ok: cancelled")

    print("[5] 历史 + 删除")
    items = http_json("GET", "/api/history?limit=5")
    assert len(items) >= 4, items
    hid = items[0]["id"]
    http_json("DELETE", f"/api/history/{hid}")
    items2 = http_json("GET", "/api/history?limit=5")
    assert all(i["id"] != hid for i in items2)
    print(f"  ok: {len(items2)} 条剩余")

    print("[6] 模型管理：信息 / 路径校验")
    info = http_json("GET", "/api/model")
    assert info["model_exists"] and info["model_complete"], info
    print(f"  ok: model_path={info['model_path']}")
    r = urllib.request.Request(
        BASE + "/api/model/path",
        data=json.dumps({"path": "/no/such/dir"}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        urllib.request.urlopen(r, timeout=10)
        raise AssertionError("无效路径应返回 400")
    except urllib.error.HTTPError as e:
        assert e.code == 400, e.code
    print("  ok: 无效路径被拒绝")

    print("\n全部 API 测试通过 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
