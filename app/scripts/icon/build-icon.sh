#!/usr/bin/env bash
# 从 scripts/icon/icon.html 生成应用图标（PNG 1024 + icns 全尺寸）
#
# 遵循 macOS 图标网格：1024 画布 / 824 内容（80.5%）/ 圆角 185.4
# 小尺寸（16/32/64）使用简化图稿，否则缩到 16px 会失去辨识度。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ELECTRON="$APP/node_modules/.bin/electron"
[ -x "$ELECTRON" ] || { echo "错误：找不到 electron，请先 pnpm install" >&2; exit 1; }

echo "→ 渲染图稿"
"$ELECTRON" "$HERE/render.js" large "$TMP/big.png"   | grep -E "ICON_OK|ICON_ERROR"
"$ELECTRON" "$HERE/render.js" small "$TMP/small.png" | grep -E "ICON_OK|ICON_ERROR"

echo "→ 合成 iconset"
mkdir -p "$TMP/i.iconset"
sips -z 16 16     "$TMP/small.png" --out "$TMP/i.iconset/icon_16x16.png"      >/dev/null
sips -z 32 32     "$TMP/small.png" --out "$TMP/i.iconset/icon_16x16@2x.png"   >/dev/null
sips -z 32 32     "$TMP/small.png" --out "$TMP/i.iconset/icon_32x32.png"      >/dev/null
sips -z 64 64     "$TMP/small.png" --out "$TMP/i.iconset/icon_32x32@2x.png"   >/dev/null
sips -z 128 128   "$TMP/big.png"   --out "$TMP/i.iconset/icon_128x128.png"    >/dev/null
sips -z 256 256   "$TMP/big.png"   --out "$TMP/i.iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$TMP/big.png"   --out "$TMP/i.iconset/icon_256x256.png"    >/dev/null
sips -z 512 512   "$TMP/big.png"   --out "$TMP/i.iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$TMP/big.png"   --out "$TMP/i.iconset/icon_512x512.png"    >/dev/null
cp "$TMP/big.png" "$TMP/i.iconset/icon_512x512@2x.png"

iconutil -c icns "$TMP/i.iconset" -o "$TMP/icon.icns"

cp "$TMP/icon.icns" "$APP/build/icon.icns"
cp "$TMP/big.png"   "$APP/build/icon.png"
cp "$TMP/big.png"   "$APP/resources/icon.png"
echo "✅ 图标已更新（build/icon.icns、build/icon.png、resources/icon.png）"
