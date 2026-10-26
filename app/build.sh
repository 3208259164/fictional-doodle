#!/usr/bin/env bash
# =====================================================================
# 学通 App · 构建脚本（自定义工具链：aapt2 + javac + R8 + zipalign + apksigner）
#
# 用法：
#   NAME=0.15.0 CODE=56 bash build.sh                # 本地发布：产出「已签名」APK
#   NAME=0.15.0 CODE=56 UNSIGNED=1 bash build.sh     # F-Droid：产出「未签名」APK
#
# 环境变量（均有默认值，可覆盖以便在 CI / F-Droid buildserver 上跑）：
#   NAME=版本名  CODE=版本号(整数,只增)  UNSIGNED=1(不签名)  KS_PW=签名口令
#   BT=build-tools 目录   AJ=android.jar   R8=r8.jar
#   P=App 工程目录        SITE=站点源码目录  KS=签名密钥
#   MIN_SDK(默认29=Android10) / TARGET_SDK(默认36) / SOURCE_DATE_EPOCH（可复现构建，默认2020-01-01）
# =====================================================================
set -e
NAME="${NAME:?请指定 NAME，如 NAME=0.15.0}"
CODE="${CODE:?请指定 CODE，如 CODE=56}"
BT="${BT:?请指定 BT（Android build-tools 目录，含 aapt2/zipalign/apksigner）}"
AJ="${AJ:?请指定 AJ（platform 的 android.jar，targetSdk 36）}"
R8="${R8:?请指定 R8（r8.jar 路径）}"
P="${P:-$(cd "$(dirname "$0")" && pwd)}"   # 默认取脚本所在目录（原写死 /output/apk 会把站点拷进元资源库工程）
SITE="${SITE:-$P/../site}"; [ -d "$SITE" ] || { echo "❌ 站点目录不存在：$SITE（用 SITE= 指定）" >&2; exit 1; }
KS="${KS:?请指定 KS（签名 keystore 路径）}"
# 签名口令：**不写入仓库**。优先环境变量 KS_PW，其次本地文件 $KS_PW_FILE（默认见下）。仅签名时需要。
PW="${KS_PW:-}"
if [ -z "$PW" ]; then PWF="${KS_PW_FILE:-$P/ks.pw}"; if [ -f "$PWF" ]; then PW="$(cat "$PWF")"; fi; fi
B="$P/build"
OUT="$P/dist"
MIN_SDK="${MIN_SDK:-29}"
TARGET_SDK="${TARGET_SDK:-36}"

# 内容可复现：固定时间戳 / 区域 / 时区 —— dex / 资源 / 资产逐字节相同。
#   注意：APK **整体**字节不可复现，因为签名块每次不同（ECDSA 用随机数 k）；
#   逐字节比对需先去掉签名（F-Droid 用 apksigcopier 正是这么做的）。
export LC_ALL=C
export TZ=UTC
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1577836800}"   # 2020-01-01T00:00:00Z

SIGNED_TXT=$([ "${UNSIGNED:-0}" = "1" ] && echo "否（F-Droid 用自身密钥签名）" || echo "是")
# ---- versionCode 只增校验 ----------------------------------------------------
# 只比较手传的 CODE 这个数字，与 versionName 无关（不按版本名推导，避免
# "0.10.99=1099 > 0.11.1=111" 那种高级版本号反而更小的情况）。
# 历史最大值记在 $P/.last_code；文件丢失时从 0 起算（不会误拦，构建成功后会写回）。
CODE_FILE="$P/.last_code"
LAST=0
if [ -f "$CODE_FILE" ]; then LAST="$(cat "$CODE_FILE" 2>/dev/null || echo 0)"; fi
case "$LAST" in ''|*[!0-9]*) LAST=0 ;; esac
case "$CODE" in ''|*[!0-9]*) echo "❌ CODE 必须是整数：$CODE" >&2; exit 1 ;; esac
if [ "$CODE" -le "$LAST" ]; then
  echo "❌ versionCode 必须递增：本次 CODE=$CODE，历史上用过的最大值是 $LAST" >&2
  echo "   覆盖安装时新包的 versionCode 必须大于已装的，否则系统会判定为降级、直接拒绝安装。" >&2
  echo "   如确需重出当前版本，请把 CODE 调大（例如 $((LAST+1))）。" >&2
  exit 1
fi

echo "==> 构建 学通 $NAME (versionCode $CODE, minSdk $MIN_SDK, targetSdk $TARGET_SDK, 签名=$SIGNED_TXT)"

echo "[0] 刷新站点资源（站点目录为唯一真源）"
rm -rf "$P/assets/site"
cp -r -p "$SITE" "$P/assets/site"
rm -rf "$P/assets/site/.git"

echo "[0b0] SW 缓存版本对齐构建号（防止忘改 sw.js VERSION 导致 Service Worker 永不更新）"
SWF="$P/assets/site/sw.js"
if [ -f "$SWF" ]; then
  python3 - "$SWF" "$CODE" <<'PYEOF'
import re, sys
p, code = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
s2 = re.sub(r"^const VERSION = '[^']*';", "const VERSION = 'v%s';" % code, s, count=1, flags=re.M)
assert s2 != s, 'sw.js 未找到 VERSION 行'
open(p, 'w', encoding='utf-8').write(s2)
print('   sw.js VERSION -> v' + code)
PYEOF
fi

echo "[0b1] 静态资源版本化（?v=$CODE）—— 让 WebView 敢缓存、也让 V8 编译缓存能复用"
python3 "$(dirname "$0")/../tools/versionize_html.py" "$P/assets/site" "$CODE"

echo "[0b] 精简安装包（去开发用文件；站点目录已不含 library/epub/pdf/jszip 等下线组件）"
rm -rf "$P/assets/site/tools" "$P/assets/site/.github"
rm -f "$P/assets/site/CHANGELOG.md" "$P/assets/site/README.md"
rm -rf "$P/assets/site/pages"          # 静态快照（SEO 用，仅网页版需要）
rm -f "$P/assets/site/sitemap.xml"     # 同上
rm -f "$P/assets/site/CHANGELOG-archive.md"   # 历史变更记录（仅仓库留档，不进安装包）
rm -f "$P/assets/site/version.json"
# 编辑器/脚本的历史备份（.bak_*）绝不进包：曾混入 6 个 resources 备份，APK 白胖 585KB
find "$P/assets/site" -type f -name "*.bak*" -delete 2>/dev/null || true
find "$P/assets/site" -type f \( -name "*.orig" -o -name "*.rej" -o -name "*~" \) -delete 2>/dev/null || true

echo "[0a] JS 兼容基线：自动降到 ES2015（无 esbuild 时使用仓库内已降级文件）"
ESB="${ESBUILD:-$(command -v esbuild 2>/dev/null || true)}"
if [ -z "$ESB" ] && [ -x "$P/tools/esbuild" ]; then ESB="$P/tools/esbuild"; fi
if [ -n "$ESB" ] && command -v "$ESB" >/dev/null 2>&1; then
  for f in "$P/assets/site/lib/"*.js; do
    [ -e "$f" ] || continue
    [ "$(stat -c%s "$f")" -gt 1000 ] || continue   # 跳过占位小文件
    if "$ESB" "$f" --target=es2015 --minify --outfile="$f.es2015.tmp" >/dev/null 2>&1; then mv "$f.es2015.tmp" "$f"; else rm -f "$f.es2015.tmp"; echo "   ⚠️ 降级失败(保留原文件): $f"; fi
  done
  echo "   已用 esbuild 降级 lib/*.js → ES2015"
else
  echo "   未发现 esbuild → 使用仓库内已降级的 lib/*.js（跳过）"
fi
# 校验 3D 引擎确为“降级版”（含 globalThis 垫片）且体积合理
ENG="$P/assets/site/lib/3d-force-graph.min.js"
ESZ=$(stat -c%s "$ENG" 2>/dev/null || echo 0)
if [ "$ESZ" -lt 1000000 ] || ! grep -q "globalThis" "$ENG" 2>/dev/null; then
  echo "❌ 3D 引擎异常（大小=$ESZ 字节，或缺 globalThis 兼容垫片）。请运行 tools/downlevel-lib.sh 重新生成。"; exit 1
fi
echo "   ✅ 3D 引擎就绪（$ESZ 字节 · ES2015）"

echo "[0c] 固定源文件时间戳（可复现构建）"
find "$P/res" "$P/assets" -exec touch -d "@$SOURCE_DATE_EPOCH" {} + 2>/dev/null || true

echo "[1] 写入版本号到 AndroidManifest.xml"
python3 - "$CODE" "$NAME" "$P" <<'PY'
import io, re, sys
code, name, P = sys.argv[1], sys.argv[2], sys.argv[3]
p = P + '/AndroidManifest.xml'
s = io.open(p, encoding='utf-8').read()
s = re.sub(r'android:versionCode="\d+"', 'android:versionCode="%s"' % code, s)
s = re.sub(r'android:versionName="[^"]*"', 'android:versionName="%s"' % name, s)
io.open(p, 'w', encoding='utf-8').write(s)
print('   manifest -> %s / %s' % (name, code))
PY

mkdir -p "$B" "$OUT"
echo "[2] aapt2 compile（--no-crunch：PNG 直通，避免非确定压缩）"; "$BT/aapt2" compile --no-crunch --dir "$P/res" -o "$B/res.zip"
echo "[3] aapt2 link (targetSdk $TARGET_SDK)"; "$BT/aapt2" link -o "$B/base.apk" -I "$AJ" --manifest "$P/AndroidManifest.xml" -A "$P/assets" \
  --java "$B/gen" -R "$B/res.zip" --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$CODE" --version-name "$NAME" --auto-add-overlay

echo "[4] javac（全部源文件）"
rm -rf "$B/classes"; mkdir -p "$B/classes"
SRCS=$(find "$P/java/com/yuanziyuan/app" -name '*.java' | LC_ALL=C sort)   # 固定源文件顺序（可复现）
javac -source 8 -target 8 -encoding UTF-8 -bootclasspath "$AJ" -cp "$AJ" -d "$B/classes" -nowarn \
  $SRCS "$B/gen/com/yuanziyuan/app/R.java" 2> "$B/javac.log" || { echo "javac 失败："; cat "$B/javac.log"; exit 1; }
if grep -qi "error" "$B/javac.log"; then echo "javac 有错误："; cat "$B/javac.log"; exit 1; fi
echo "   javac OK（$(ls "$P/java/com/yuanziyuan/app/"*.java | wc -l) 个源文件）"

echo "[5] R8（混淆 + 优化；失败回退 d8）"
rm -rf "$B/dex"; mkdir -p "$B/dex"
if java -cp "$R8" com.android.tools.r8.R8 --release --lib "$AJ" --min-api "$MIN_SDK" \
     --output "$B/dex" --pg-conf "$P/proguard-rules.pro" --pg-map-output "$B/dex/mapping.txt" "$B/classes/com/yuanziyuan/app/"*.class > "$B/r8.log" 2>&1; then
  echo "   R8 OK"; ls -la "$B/dex"
else
  echo "❌ R8 失败（发布构建不允许静默回退未混淆产物）；日志："; tail -25 "$B/r8.log"; exit 1
fi
# 归档混淆映射表（供线上崩溃栈还原）
if [ -f "$B/dex/mapping.txt" ]; then cp "$B/dex/mapping.txt" "$P/mapping-$NAME.txt"; echo "   mapping -> $P/mapping-$NAME.txt"; fi

echo "[6] dex + zipalign"
cp "$B/base.apk" "$B/app.apk"; touch -d "@$SOURCE_DATE_EPOCH" "$B/dex/classes.dex"; (cd "$B/dex" && zip -0 -X -q "$B/app.apk" classes.dex)   # -0=STORE：dex 不压缩（Android 惯例 + 更确定）

"$BT/zipalign" -p -f 4 "$B/app.apk" "$B/aligned.apk"

if [ "${UNSIGNED:-0}" = "1" ]; then
  echo "[7] 跳过签名（UNSIGNED=1）——产出未签名 APK（供 F-Droid 用其自身密钥签名）"
  cp "$B/aligned.apk" "$OUT/学通-$NAME-unsigned.apk"
  echo "[8] 校验（未签名）"
  BADG="$("$BT/aapt2" dump badging "$OUT/学通-$NAME-unsigned.apk" 2>/dev/null)"
  printf '%s\n' "$BADG" | grep -E "^package:|minSdkVersion|targetSdkVersion" || true
  GOTMIN="$(printf '%s\n' "$BADG" | sed -n "s/^minSdkVersion:'\([0-9]\+\)'.*/\1/p" | head -1)"
  [ "$GOTMIN" = "$MIN_SDK" ] || { echo "❌ minSdkVersion 期望 $MIN_SDK，实得 '$GOTMIN'"; exit 1; }
  XMLTR="$("$BT/aapt2" dump xmltree "$OUT/学通-$NAME-unsigned.apk" --file AndroidManifest.xml 2>/dev/null)"
  if printf '%s\n' "$BADG" | grep -q "android.permission.INTERNET"; then echo "❌ 不应声明 INTERNET 权限（本应用完全离线）"; exit 1; fi
  if printf '%s\n' "$XMLTR" | grep -q "debuggable(0x0101000f)=true"; then echo "❌ 发布包不得为 debuggable"; exit 1; fi
  if printf '%s\n' "$XMLTR" | grep -q "usesCleartextTraffic(0x010104ec)=true"; then echo "❌ 不得允许明文流量"; exit 1; fi
  if printf '%s\n' "$XMLTR" | grep -q "allowBackup(0x01010280)=true"; then echo "❌ 不得允许应用数据备份"; exit 1; fi
  echo "   ✅ 安全基线：无 INTERNET 权限 / debuggable=false / cleartext=false / allowBackup=false"
  echo "   SHA256：$(sha256sum "$OUT/学通-$NAME-unsigned.apk" | cut -d' ' -f1)"

  ls -la "$OUT/学通-$NAME-unsigned.apk"
  echo "==> 完成：$OUT/学通-$NAME-unsigned.apk"
  exit 0
fi

[ -n "$PW" ] || { echo "❌ 缺少签名口令：设置环境变量 KS_PW，或把它写进 $KS_PW_FILE（默认 <工程>/ks.pw，已在 .gitignore 里排除）"; exit 1; }
echo "[7] 签名（必须在 /tmp 本地盘，virtiofs 上 apksigner 会失败）"
mkdir -p /tmp/apksign; cp "$B/aligned.apk" /tmp/apksign/a.apk; cp -f "$KS" /tmp/apksign/k.keystore
cd /tmp/apksign && java -jar "$BT/lib/apksigner.jar" sign --ks k.keystore --ks-key-alias yuanziyuan \
  --ks-pass pass:"$PW" --key-pass pass:"$PW" --min-sdk-version "$MIN_SDK" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --out s.apk a.apk
cp /tmp/apksign/s.apk "$P/学通-$NAME.apk"

echo "[8] 校验"
java -jar "$BT/lib/apksigner.jar" verify /tmp/apksign/s.apk 2>/dev/null && echo "   签名 OK"
BADG="$("$BT/aapt2" dump badging /tmp/apksign/s.apk 2>/dev/null)"
printf '%s\n' "$BADG" | grep -E "^package:|minSdkVersion|targetSdkVersion"
GOTMIN="$(printf '%s\n' "$BADG" | sed -n "s/^minSdkVersion:'\([0-9]\+\)'.*/\1/p" | head -1)"
[ "$GOTMIN" = "$MIN_SDK" ] || { echo "❌ minSdkVersion 期望 $MIN_SDK，实得 '$GOTMIN'"; exit 1; }
echo "   ✅ minSdk == $GOTMIN"
  XMLTR="$("$BT/aapt2" dump xmltree /tmp/apksign/s.apk --file AndroidManifest.xml 2>/dev/null)"
  if printf '%s\n' "$BADG" | grep -q "android.permission.INTERNET"; then echo "❌ 不应声明 INTERNET 权限（本应用完全离线）"; exit 1; fi
  if printf '%s\n' "$XMLTR" | grep -q "debuggable(0x0101000f)=true"; then echo "❌ 发布包不得为 debuggable"; exit 1; fi
  if printf '%s\n' "$XMLTR" | grep -q "usesCleartextTraffic(0x010104ec)=true"; then echo "❌ 不得允许明文流量"; exit 1; fi
  if printf '%s\n' "$XMLTR" | grep -q "allowBackup(0x01010280)=true"; then echo "❌ 不得允许应用数据备份"; exit 1; fi
  echo "   ✅ 安全基线：无 INTERNET 权限 / debuggable=false / cleartext=false / allowBackup=false"
  echo "   SHA256：$(sha256sum /tmp/apksign/s.apk | cut -d' ' -f1)"

ls -la "$P/学通-$NAME.apk"
echo "$CODE" > "$CODE_FILE"
echo "==> 完成：$P/学通-$NAME.apk"
