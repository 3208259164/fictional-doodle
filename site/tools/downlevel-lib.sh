#!/usr/bin/env bash
# =====================================================================
# 学通 · 3D 引擎兼容基线工具
#
# 作用：把上游原版 3d-force-graph（UMD，ES2020 语法）降级为 ES2015，
#       并前置 globalThis 兼容垫片，输出到站点 lib/3d-force-graph.min.js。
#       这样较老的 Android WebView（< Chrome 80）也能运行 3D 图谱。
#
# 何时运行：每次「升级 / 替换」lib/3d-force-graph.min.js 之后运行一次。
#
# 用法：
#   tools/downlevel-lib.sh <上游原始3d-force-graph.min.js>     # 自动定位 esbuild
#   ESBUILD=/path/to/esbuild tools/downlevel-lib.sh <原始文件>
#
# 说明：需要 Node 生态的 esbuild（仅构建期使用，不进入交付物）。
#       若 CI 无 esbuild：直接沿用仓库内已降级好的 lib，不要运行本工具。
# =====================================================================
set -e

IN="${1:?用法: $0 <上游原始3d-force-graph.min.js>}"
[ -f "$IN" ] || { echo "找不到输入文件：$IN"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../lib/3d-force-graph.min.js"
mkdir -p "$(dirname "$OUT")"

ESB="${ESBUILD:-$(command -v esbuild 2>/dev/null || true)}"
[ -n "$ESB" ] || { echo "未发现 esbuild。请先 `npm i -g esbuild`，或设 ESBUILD=/路径/to/esbuild"; exit 1; }

TMP="$(mktemp)"
"$ESB" "$IN" --target=es2015 --minify --outfile="$TMP"

{
  printf '/* 学通 · 3d-force-graph (UMD·自包含·已降级至 ES2015 以兼容较老 WebView) */\n'
  printf ';var globalThis=globalThis||(typeof self!=="undefined"?self:this);\n'
  cat "$TMP"
} > "$OUT"
rm -f "$TMP"

# 记录校验值，便于构建期核对
sha256sum "$OUT" | awk '{print $1}' > "$OUT.sha256"

echo "✅ 已生成 ES2015 版：$OUT （$(stat -c%s "$OUT") 字节）"
