#!/usr/bin/env bash
# 准备随应用打包的 Python 运行时。
#
# 为什么要暂存一份：macOS 代码签名会拒绝 bundle 内指向 bundle 之外的符号链接，
# 而 venv 的 bin/python 是指向 Homebrew 解释器的绝对路径软链。这里复制一份
# venv 并把该链接解引用成真实文件（pyvenv.cfg 就在同级，解释器能正确定位
# site-packages），从而得到一个可签名、自包含的运行时。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../backend/.venv"
DST="$HERE/../../backend/.venv-staged"

if [ ! -d "$SRC" ]; then
  echo "错误：找不到后端虚拟环境 $SRC" >&2
  echo "请先在 backend/ 目录执行：uv sync" >&2
  exit 1
fi

echo "→ 暂存 venv：$SRC → $DST"
rm -rf "$DST"
cp -R "$SRC" "$DST"

# 解引用指向包外的解释器软链
if [ -L "$DST/bin/python" ]; then
  TARGET="$(readlink "$DST/bin/python")"
  if [ -e "$TARGET" ]; then
    rm "$DST/bin/python"
    cp "$TARGET" "$DST/bin/python"
    chmod +x "$DST/bin/python"
    echo "→ 已解引用解释器：$TARGET"
  else
    echo "错误：软链目标不存在 $TARGET" >&2
    exit 1
  fi
fi

# 清掉缓存文件，减小体积
find "$DST" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$DST" -name '*.pyc' -delete 2>/dev/null || true

# 校验：确认没有残留的包外链接
ESCAPED="$(find "$DST" -type l -exec sh -c 'for l; do t=$(readlink "$l"); case "$t" in /*) echo "$l -> $t";; esac; done' _ {} + || true)"
if [ -n "$ESCAPED" ]; then
  echo "错误：仍有指向包外的符号链接，签名会失败：" >&2
  echo "$ESCAPED" >&2
  exit 1
fi

# 校验：确认解释器能导入推理依赖
if ! "$DST/bin/python" -c "import mlx_audio, soundfile" >/dev/null 2>&1; then
  echo "错误：暂存的运行时无法导入 mlx_audio" >&2
  exit 1
fi

echo "✅ 后端运行时已就绪（$(du -sh "$DST" | cut -f1)）"
