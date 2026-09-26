# 微风之声 BreezeVoice

Breeze TTS 2 本地语音生成客户端 — 在 Apple Silicon Mac 上用 [MLX](https://github.com/ml-explore/mlx) 原生跑 Breeze TTS 2，Electron + React + TypeScript 桌面界面，边生成边播放。

## 功能

- **预置音色**：十个精心调校的声音（温柔女声 / 沉稳男声 / 新闻播报 / 深夜电台…），点选即用，描述可微调
- **音色设计**：自由描述想要的声音（如"温柔的年轻女声，清晨电台主播"）
- **声音克隆**：上传或录制 3–15 秒参考音频 + 逐字文字，复刻该声音
- **我的音色库**：克隆过的声音样本自动保存（含参考文字），重启后仍在，点选即用直接生成
- **语气控制**：在克隆的声音上用自然语言指令控制语气（"兴奋一点、语速加快"）
- **先听后播**：生成期间只累积音频不播放，全部完成后由你点击播放，避免听到半截
- **情感标记**：文本中插入 `[笑]` `[叹气]` `(laugh)` `(sigh)` `(cough)`
- **中英双语**：自动识别文本语言并匹配同语言的指令（官方建议指令与文本语言一致）
- **历史记录**：每次生成自动保存（含中断的片段），可回放、下载 WAV、删除
- **参数面板**：cfg 指令强度、采样温度、top_p、随机种子
- **模型管理**：设置面板（顶栏齿轮）可查看/指定模型路径，或从 ModelScope / HuggingFace 一键下载（带进度、断点续传，完成后自动启用）

## 四种模式对照

| 模式 | 需要什么 | 声音来源 |
|---|---|---|
| 预置音色 | 选中一个音色 + 输入文字 | 内置的十个声音描述，走 Voice Design 路径 |
| 音色设计 | 文字 + 自由声音描述 | 每次按描述即时生成新音色 |
| 声音克隆 | 文字 + 参考音频 + 逐字文字 | 复刻参考音频里的声音 |
| 语气控制 | 文字 + 参考音频 + 逐字文字 + 语气指令 | 复刻声音并按指令调整语气 |

> **关于"预置音色"的实现**：Breeze TTS 2 官方只有 Voice Clone / Voice Design /
> Voice Direction 三种范式，**没有可直接点选的预置说话人**。模型词表里存在
> `[S0]`–`[S9]` 占位 token（架构继承自 Qwen3-TTS 一类骨干），但未经说话人条件
> 训练，单独使用时输出会漂移（听感上像在唱而非说话）。因此本应用的"预置音色"
> 并非模型原生能力，而是十个调校好的声音描述，通过官方支持的 Voice Design
> 路径实现——选中后可自行修改描述。

## 架构

```
┌─────────────────────────────┐      spawn / 健康检查      ┌──────────────────────┐
│  Electron + React + TS      │ ────────────────────────▶ │  Python FastAPI      │
│  app/                       │   ws://127.0.0.1:8765     │  backend/            │
│  ├ 渲染：四模式工作台 UI   │ ◀──────────────────────── │  ├ tts_engine.py     │
│  ├ 主进程：后端生命周期      │   PCM16 流 + JSON 状态     │  │  （MLX 专职线程） │
│  └ Web Audio 播放器         │                           │  └ server.py         │
└─────────────────────────────┘                           └──────────┬───────────┘
                                                                    │ mlx-audio
                                                                    ▼
                                                          ~/.downloadmodels/Breeze-TTS-2-mlx
                                                          （魔搭下载，bf16 约 7.1GiB）
```

后端所有 MLX 计算（模型加载 + 生成）在一条专职线程上串行执行——MLX 的 GPU
Stream 绑定创建它的线程，跨线程推理会报 `There is no Stream(gpu, 0)`。

## 快速开始

前置：Apple Silicon Mac、Python 3.11+、[uv](https://docs.astral.sh/uv/)、Node 18+、pnpm、ffmpeg。

```bash
# 1) 安装后端依赖（backend/.venv）
cd backend
uv sync

# 2) 通过魔搭下载模型（首次，约 7.1GiB，可断点续传）
#    也可以跳过这步，直接在应用设置面板里点「下载」
uv run modelscope download \
  --model mlx-community/Breeze-TTS-2-mlx \
  --local_dir ~/.downloadmodels/Breeze-TTS-2-mlx

# 3) 启动应用（自动拉起后端 + 打开窗口）
cd ../app
pnpm install
pnpm dev
```

日常使用只需第 3 步。后端也可单独调试：

```bash
cd backend && uv run python server.py --port 8765
# 健康检查 / 历史列表
curl http://127.0.0.1:8765/api/health
# 我的音色库：列表 / 上传（可带 name、ref_text）/ 改名
curl http://127.0.0.1:8765/api/ref_audio
curl -X PATCH http://127.0.0.1:8765/api/ref_audio/ref-xxxx \
  -H 'Content-Type: application/json' -d '{"name":"我的声音","ref_text":"……"}'
# 音色设计（预置音色走的就是这条路径）
curl -X POST http://127.0.0.1:8765/api/tts -H 'Content-Type: application/json' \
  -d '{"text":"你好","instruct":"温柔的女声","cfg_scale":4}' -o out.wav
# 模型三模式自检
uv run python verify_model.py
# 预置音色批量自检
uv run python verify_presets.py
# API 全链路测试（HTTP/WS/克隆/取消/历史）
uv run python test_api.py
```

## 打包为 macOS 应用

```bash
cd app
pnpm build:mac          # 生成 .app 与 .dmg（含后端与 Python 运行时）
pnpm build:app          # 只生成 .app，跳过 dmg
pnpm icon               # 重新生成应用图标
```

产物在 `app/dist/`：`mac-arm64/微风之声 BreezeVoice.app` 与 `breezevoice-1.0.0.dmg`。

打包做了这些事：

- **随包 Python 运行时**：`scripts/prepare-backend.sh` 把 `backend/.venv` 复制成
  `.venv-staged` 并**解引用解释器软链**——macOS 代码签名会拒绝 bundle 内指向
  bundle 外的符号链接，而 venv 的 `bin/python` 正是指向 Homebrew 的绝对路径软链。
- **ad-hoc 签名 + hardened runtime**：`build/entitlements.mac.plist` 声明
  `com.apple.security.device.audio-input`（麦克风）与 `disable-library-validation`。
  没有 Developer ID 证书时 electron-builder 会跳过签名，此时 entitlements 不会生效。
- **数据落在 ~/.breezevoice**：生成历史与音色库存放在 `~/.breezevoice/outputs/`
  （由 `BREEZE_DATA_DIR` 可覆盖）。旧版本数据（`~/Library/Application Support/BreezeVoice`
  或项目目录 `outputs/`）会在启动时自动迁移过来，原文件保留不动。
- **模型放在 ~/.downloadmodels**：默认查找顺序 `BREEZE_MODEL_PATH` 环境变量 →
  设置面板指定的路径（存于 `~/.breezevoice/settings.json`）→ `~/.downloadmodels` →
  `~/.breezevoice/models` → 旧版应用支持目录。没有模型时可在应用设置面板里直接下载，
  或手动软链：

  ```bash
  mkdir -p ~/.downloadmodels
  ln -s "$PWD/models/Breeze-TTS-2-mlx" \
        ~/.downloadmodels/Breeze-TTS-2-mlx
  ```

### 关于麦克风权限（重要）

**开发模式下麦克风大概率录不到声音**：`pnpm dev` 从终端启动 Electron 时，
macOS 会把权限的"责任主体"算到终端进程上，而终端通常没有麦克风权限，
于是 Chromium 会返回一条**静音的音频轨道**（不报错，但全是零值）。
另外未签名的开发版 Electron 缺少 `audio-input` 权限声明。

**打包后的应用没有这个问题**。安装到 `/Applications` 后首次录制时系统会弹出
授权请求，允许即可。若误点了拒绝，到「系统设置 → 隐私与安全性 → 麦克风」重新打开。

前端内置了静音检测：录完会测量电平，纯静音会明确提示而不是静默失败。

## 应用图标

图标源码在 `app/scripts/icon/icon.html`，用 `pnpm icon` 重新生成，遵循 macOS 图标网格：

| 项目 | 值 |
|---|---|
| 画布 | 1024 × 1024 PNG（含 alpha） |
| 内容（squircle） | 824 × 824，即 **80.5%** |
| 四周透明边距 | 各 100 px |
| 圆角半径 | 185.4（Apple 模板值） |

母题是一道由**翠鸟青渐变为琥珀**的声波——冷色是风、暖色是声，与应用内的波形
播放器同源。小尺寸（16/32/64）单独使用简化图稿：波峰更少、线条更粗、对比度更高，
否则缩到 16px 会糊成一团。生成物为 `build/icon.icns`（十档尺寸）、`build/icon.png`
与 `resources/icon.png`。

## 性能参考（M4 Max / 64GB）

| 指标 | 数值 |
|---|---|
| 模型加载（热） | ~2 s |
| 模型加载（冷） | ~18 s |
| 首包音频 | ~2–5 s |
| 生成速度（RTF） | 约 2–5×（每秒生成 0.2–0.5 秒音频） |
| 峰值内存 | ~9.1 GB |

非实时流播：M4 Max 上生成慢于播放属正常现象，界面会边生成边累积播放。

## 目录结构

```
breezetts2/
├── outputs/verify/            # 三模式自检音频（用户数据在 ~/.breezevoice/outputs/）
├── backend/
│   ├── tts_engine.py          # MLX 推理封装（专职线程 + 单并发锁）
│   ├── model_downloader.py    # 模型下载器（modelscope / hf 子进程 + 进度解析）
│   ├── server.py              # FastAPI：HTTP + WebSocket 流式 + 模型管理
│   ├── store.py               # 历史/音色/设置存储（数据目录可配置）
│   ├── verify_model.py        # 三模式自检
│   ├── verify_presets.py      # 预置音色批量自检
│   ├── mic_probe_packaged.py  # 用 CDP 在打包应用里实测麦克风
│   └── test_api.py            # API 全链路测试
└── app/                       # Electron + React + TS（electron-vite）
    ├── scripts/icon/          # 图标源码与生成脚本
    ├── scripts/prepare-backend.sh  # 打包前暂存可签名的 Python 运行时
    ├── build/entitlements.mac.plist
    ├── src/main/              # 主进程：后端生命周期、麦克风权限、打包路径解析
    ├── src/preload/           # 暴露 serverBase
    └── src/renderer/          # 界面（四模式工作台 + 波形播放器 + 设置面板）

~/.breezevoice/                # 用户数据（settings.json + outputs/history + outputs/refs）
~/.downloadmodels/             # 模型权重默认位置（Breeze-TTS-2-mlx，约 7.1GB）
```

## 备注

- 模型权重与自托管输出遵循 BreezeBlue 的 Research and Non-Commercial 许可证，商用需联系 RESONIA, INC.（contact@breeze.blue）；代码部分 Apache-2.0。
- MLX 移植版由 [mlx-audio](https://github.com/Blaizzy/mlx-audio) 社区维护，模型转换自 [BreezeBlue/Breeze-TTS-2](https://modelscope.cn/models/mlx-community/Breeze-TTS-2-mlx)，另有 8bit（4.6GB）/ 4bit（3.0GB）量化版可替换使用。
- HuggingFace 直连不通时，模型一律从魔搭（ModelScope）下载；npm 依赖如遇网络问题需配置代理。
