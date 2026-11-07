#!/usr/bin/env bash
# =============================================================================
# 学通 · 一键构建（aapt2 → javac → R8 → dex → zipalign → apksigner → 自检）
#
# 用法：
#   NAME=0.17.52 CODE=231 bash build.sh
#
# 必给：NAME（版本名，如 0.17.52）、CODE（versionCode，只增不减）
# 可选：
#   SITE_VER=0.34.119   同时写站点版本（site data/config.js 的 version）
#   SW_SYNC=1           把 sw.js 的 VERSION 强制改成 v$CODE（默认保留手写值，只提醒）
#   DOWNLEVEL=1         用 esbuild 重新把 3D 引擎降到 ES2015（默认只做兼容性校验，不改字节）
#   FORCE=1             跳过 versionCode 只增校验（重出同一版本时用）
#   UNSIGNED=1          只出未签名包（做差分/对照时用）
#
# 环境变量（未给则用 /sandbox/workspace/toolchain 下的默认路径）：
#   BT=<build-tools 目录>  AJ=<android.jar>  R8=<r8.jar>
#   KS=<keystore>  KS_PW=<口令>  ESBUILD=<esbuild>
#   P=<apk 工程目录>  SITE=<站点源码目录>
# =============================================================================
set -euo pipefail
# 注意：不能用 LC_ALL=C —— 那会让 bash 把中文产物名写成「??????-0.17.51.apk」。
# 用 C.UTF-8：既能保证排序/时间格式可复现，又能正确处理 UTF-8 文件名。
export LC_ALL=C.UTF-8 TZ=UTC

P="${P:-$(cd "$(dirname "$0")" && pwd)}"

# 站点目录：仓库里叫 site/，本地开发目录叫 site_new/ —— 自动探测，不再写死其中一个。
if [ -z "${SITE:-}" ]; then
  for cand in "$P/../site" "$P/../site_new"; do
    if [ -f "$cand/index.html" ]; then SITE="$cand"; break; fi
  done
fi
[ -n "${SITE:-}" ] || { echo "  ❌ 找不到站点目录（试过 ../site、../site_new），请传 SITE=/path" >&2; exit 1; }

# 工具链：环境变量 > 工程同级 toolchain/ > 本机默认位置
if [ -z "${TC:-}" ]; then
  for cand in "$P/../toolchain" /sandbox/workspace/toolchain "$HOME/toolchain"; do
    if [ -d "$cand" ]; then TC="$cand"; break; fi
  done
fi
TC="${TC:-/sandbox/workspace/toolchain}"

# 版本号：唯一真相源是 $SITE/version.json。NAME/CODE 可以不传；
# 传了就必须与它一致，否则中止 —— 防止「README 写一个版本、包里是另一个」。
VJ="$SITE/version.json"
if [ -f "$VJ" ]; then
  V_NAME=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['versionName'])" "$VJ")
  V_CODE=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['versionCode'])" "$VJ")
  V_SITE=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8'))['siteVersion'])" "$VJ")
  if [ -n "${NAME:-}" ] && [ "$NAME" != "$V_NAME" ]; then
    echo "  ❌ NAME=$NAME 与 version.json 的 $V_NAME 不一致" >&2
    echo "     改版本：python3 $SITE/tools/sync_version.py --set app=$NAME --apply" >&2
    exit 1
  fi
  if [ -n "${CODE:-}" ] && [ "$CODE" != "$V_CODE" ]; then
    echo "  ❌ CODE=$CODE 与 version.json 的 $V_CODE 不一致" >&2
    echo "     改版本：python3 $SITE/tools/sync_version.py --set code=$CODE --apply" >&2
    exit 1
  fi
  NAME="${NAME:-$V_NAME}"
  CODE="${CODE:-$V_CODE}"
  SITE_VER="${SITE_VER:-$V_SITE}"
else
  echo "  ⚠️  站点里没有 version.json，回退到手工传 NAME/CODE" >&2
fi
NAME="${NAME:?需要 NAME（可在 version.json 里写 versionName，或用 sync_version.py 改）}"
CODE="${CODE:?需要 CODE（可在 version.json 里写 versionCode，或用 sync_version.py 改）}"
BT="${BT:-$TC/build-tools-36}"
AJ="${AJ:-$TC/android-sdk/platforms/android-36/android.jar}"
R8="${R8:-$TC/r8.jar}"
KS="${KS:-$TC/release.keystore}"
KS_PW="${KS_PW:-$(cat "$TC/ks.pw" 2>/dev/null || true)}"
ESBUILD="${ESBUILD:-$TC/js/node_modules/.bin/esbuild}"
SITE_VER="${SITE_VER:-}"
SW_SYNC="${SW_SYNC:-0}"
DOWNLEVEL="${DOWNLEVEL:-0}"
FORCE="${FORCE:-0}"
UNSIGNED="${UNSIGNED:-0}"
SOURCE_DATE_EPOCH_FIXED=315532800   # 1980-01-01，与成品包时间戳一致

WORK="$(mktemp -d /tmp/xuetong-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()  { printf '  ✅ %s\n' "$*"; }
die() { printf '  ❌ %s\n' "$*" >&2; exit 1; }

for f in "$BT/aapt2" "$AJ" "$R8" "$ESBUILD"; do [ -e "$f" ] || die "工具链缺件：$f"; done

say "[00/8] 一致性门禁（版本号 / 预缓存清单）"
if [ -f "$SITE/tools/sync_version.py" ]; then
  python3 "$SITE/tools/sync_version.py" --check --quiet \
    || die "版本号不一致：先跑 python3 $SITE/tools/sync_version.py --apply"
  ok "版本号一致（config.js / sw.js / version.json）"
fi
if [ -f "$SITE/tools/gen_sw_core.py" ]; then
  if ! python3 "$SITE/tools/gen_sw_core.py" --check > "$WORK/swcore.log" 2>&1; then
    cat "$WORK/swcore.log" | sed 's/^/  /' >&2
    die "预缓存清单与磁盘不一致：先跑 python3 $SITE/tools/gen_sw_core.py --apply（否则离线会缺文件）"
  fi
  ok "预缓存清单与磁盘一致"
fi

say "[0/8] 版本门禁"
LAST=$(cat "$P/.last_code" 2>/dev/null || echo 0)
if [ "$FORCE" != "1" ] && [ "$CODE" -le "$LAST" ]; then
  die "CODE=$CODE 不大于上次的 $LAST（.last_code）。重出同一版本请加 FORCE=1，或把 CODE 调大"
fi
ok "NAME=$NAME CODE=$CODE（上次 $LAST）"

# 临时构建目录：源码树在构建过程中**零写入**（除最后写 .last_code 这一处版本状态）。
# 以前直接把站点复制进 $BUILD/assets/site、改写 $P/AndroidManifest.xml，
# 构建一次 git 状态就脏一片，出问题时也分不清「源错了还是副本错了」。
BUILD="$WORK/app"
mkdir -p "$BUILD/assets"
cp -a "$P/java" "$P/res" "$BUILD/"
cp -a "$P/r8.pro" "$P/AndroidManifest.xml" "$BUILD/"

say "[0b/8] 重新生成 assets/site（排除 tools/，HTML 注入 __YZV 与 ?v=$CODE）"
python3 "$P/tools/inject_app_site.py" "$SITE" "$BUILD/assets/site" "$CODE"
N_SITE=$(find "$BUILD/assets/site" -type f | wc -l)
ok "assets/site：$N_SITE 个文件"

say "[0b+/8] 讲堂全文索引（data/jtfull.js，搜索用）"
if [ -f "$P/../gen_jtfull.py" ]; then
  python3 "$P/../gen_jtfull.py" | sed 's/^/  /'
  cp "$SITE/data/jtfull.js" "$BUILD/assets/site/data/jtfull.js"
  ok "jtfull.js 已同步到包内"
else
  ok "无 gen_jtfull.py，跳过"
fi

say "[0a/8] 3D 引擎（ES2015 基线）"
ENGINE="$BUILD/assets/site/lib/3d-force-graph.min.js"
[ -f "$ENGINE" ] || die "缺 $ENGINE"
EB=$(stat -c%s "$ENGINE")
if [ "$DOWNLEVEL" = "1" ]; then
  "$ESBUILD" "$ENGINE" --target=es2015 --minify --outfile="$WORK/lib3d.js" --log-level=warning
  cp "$WORK/lib3d.js" "$ENGINE"
  EB=$(stat -c%s "$ENGINE")
  ok "已重新降级：$EB 字节"
else
  "$ESBUILD" "$ENGINE" --target=es2015 --minify --outfile="$WORK/lib3d.check.js" --log-level=warning \
    || die "3D 引擎无法降到 ES2015（WebView 会白屏）"
  ok "3D 引擎就绪（$EB 字节 · ES2015 校验通过）"
fi

say "[0c/8] 站点 JS 压缩（只压产物，源码保持可读）"
python3 "$P/tools/minify_site.py" "$BUILD/assets/site" "$ESBUILD" | sed 's/^/  /' || ok "压缩失败，改用未压缩文件"

say "[0d/8] 固定时间戳（可复现构建）"
find "$BUILD/assets/site" -exec touch -h -d @$SOURCE_DATE_EPOCH_FIXED {} +

say "[1/8] 写版本号"
python3 - "$BUILD/AndroidManifest.xml" "$NAME" "$CODE" <<'PY'
import re, sys
p, name, code = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8').read()
s = re.sub(r'android:versionCode="\d+"', 'android:versionCode="%s"' % code, s, count=1)
s = re.sub(r'android:versionName="[^"]*"', 'android:versionName="%s"' % name, s, count=1)
open(p, 'w', encoding='utf-8').write(s)
print('  ✅ AndroidManifest：versionCode=%s versionName=%s' % (code, name))
PY
if [ -n "$SITE_VER" ]; then
  python3 - "$BUILD/assets/site/data/config.js" "$SITE_VER" <<'PY'
import re, sys
p, ver = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
s2 = re.sub(r"(version\s*:\s*')[^']*(')", r"\g<1>%s\g<2>" % ver, s, count=1)
open(p, 'w', encoding='utf-8').write(s2)
print('  ✅ data/config.js version=%s' % ver)
PY
else
  CUR=$(grep -oE "version[[:space:]]*:[[:space:]]*'[^']*'" "$BUILD/assets/site/data/config.js" | head -1 | grep -oE "'[^']*'" | tr -d "'")
  ok "站点版本沿用 $CUR（要改就传 SITE_VER=）"
fi
SWVER=$(grep -oE "const VERSION *= *'[^']*'" "$BUILD/assets/site/sw.js" | head -1 | grep -oE "v[0-9]+")
if [ "$SW_SYNC" = "1" ]; then
  python3 - "$BUILD/assets/site/sw.js" "v$CODE" <<'PY'
import re, sys
p, v = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
s = re.sub(r"(const VERSION\s*=\s*')[^']*(')", r"\g<1>%s\g<2>" % v, s, count=1)
open(p, 'w', encoding='utf-8').write(s)
print('  ✅ sw.js VERSION=%s（SW_SYNC=1 强制同步）' % v)
PY
elif [ "$SWVER" != "v$CODE" ]; then
  # 这条是真出过事的：0.18.28 的包里 sw.js 还是 v302（源码手写值没跟着 CODE 走）。
  # 后果是用户升级后 Service Worker 仍命中旧缓存，界面看着「改了没生效」。
  die "sw.js 缓存版本 $SWVER ≠ v$CODE：升级后会命中旧缓存。先跑 python3 $SITE/tools/sync_version.py --apply"
else
  ok "sw.js 缓存版本 $SWVER（与 versionCode 一致）"
fi

say "[2/8] aapt2 compile（--no-crunch：PNG 逐字节保留）"
"$BT/aapt2" compile --no-crunch --dir "$BUILD/res" -o "$WORK/res.zip"
ok "资源编译 $(stat -c%s "$WORK/res.zip") 字节"

say "[3/8] aapt2 link"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$AJ" \
  --manifest "$BUILD/AndroidManifest.xml" -A "$BUILD/assets" \
  --java "$WORK/gen" \
  --min-sdk-version 29 --target-sdk-version 36 \
  --version-code "$CODE" --version-name "$NAME" \
  "$WORK/res.zip"
ok "base.apk $(stat -c%s "$WORK/base.apk") 字节"

say "[4/8] javac（-source 8 -target 8，classpath=android.jar）"
mkdir -p "$WORK/classes"
javac -source 8 -target 8 -nowarn -encoding UTF-8 -classpath "$AJ" \
  -d "$WORK/classes" $(find "$BUILD/java" -name '*.java') "$WORK/gen/com/yuanziyuan/app/R.java" 2>&1 \
  | grep -vE '警告|warning|^注:|^Note:' || true
[ -f "$WORK/classes/com/yuanziyuan/app/MainActivity.class" ] || die "javac 未产出 MainActivity.class"
NCLS=$(find "$WORK/classes" -name '*.class' | wc -l)
ok "编译 $NCLS 个 class"
( cd "$WORK/classes" && jar cf "$WORK/classes.jar" . )

say "[5/8] R8（shrink + optimize，保留 JS 桥方法名）"
mkdir -p "$WORK/r8out"
java -cp "$R8" com.android.tools.r8.R8 --release --min-api 29 \
  --lib "$AJ" --pg-conf "$BUILD/r8.pro" \
  --pg-map-output "$WORK/mapping-$NAME.txt" \
  --output "$WORK/r8out" "$WORK/classes.jar" 2>&1 | grep -vE '^\s+at |^Info in|Proguard configuration rule' || true
DEX="$WORK/r8out/classes.dex"
[ -f "$DEX" ] || die "R8 未产出 classes.dex（发布模式不静默退回 d8）"
cp "$WORK/mapping-$NAME.txt" "$P/mapping-$NAME.txt"
ok "classes.dex $(stat -c%s "$DEX") 字节 ｜ 映射已归档 mapping-$NAME.txt"
# ★ 必须校验 @JavascriptInterface 注解还在（0.18.25）：
#   注解被 R8 裁掉时，方法名仍然保留、大小也不变，但网页拿到的 AndroidApp 是个空壳——
#   朗读/导入/导出/分享/返回键全部失效，而且从包外面看不出来。
if [ -x "$BT/dexdump" ]; then
  ANN=$("$BT/dexdump" -a "$DEX" 2>/dev/null | grep -c "JavascriptInterface" || true)
  [ "${ANN:-0}" -ge 50 ] || die "R8 把 @JavascriptInterface 注解裁掉了（只剩 ${ANN:-0} 个）：网页将无法调用任何 App 方法。检查 r8.pro 里的 -keepattributes *Annotation*"
  ok "JS 桥注解完整（$ANN 个 @JavascriptInterface）"
fi

say "[6/8] 组包 + zipalign"
touch -d @$SOURCE_DATE_EPOCH_FIXED "$DEX"
( cd "$(dirname "$DEX")" && zip -X -0 -q "$WORK/base.apk" classes.dex )
"$BT/zipalign" -p -f 4 "$WORK/base.apk" "$WORK/aligned.apk"
ok "zipalign -p 4 → $(stat -c%s "$WORK/aligned.apk") 字节"

say "[7/8] 签名（v1+v2+v3，别名 yuanziyuan）"
OUT="$P/学通-$NAME.apk"
if [ "$UNSIGNED" = "1" ]; then
  cp "$WORK/aligned.apk" "$OUT"
  ok "UNSIGNED=1：只出未签名包"
else
  [ -f "$KS" ] || die "缺 keystore：$KS"
  [ -n "$KS_PW" ] || die "缺签名口令（\$TC/ks.pw 或 KS_PW=）"
  # apksigner 会在共享盘（virtiofs）上「Failed to read chunk / 输入输出错误」，
  # 所以签名全程在本地盘 $WORK 里做，最后再拷回工程目录。
  "$BT/apksigner" sign --ks "$KS" --ks-key-alias yuanziyuan \
    --ks-pass "pass:$KS_PW" --key-pass "pass:$KS_PW" \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --out "$WORK/signed.apk" "$WORK/aligned.apk" 2>&1 | grep -vE 'WARNING' || true
  [ -f "$WORK/signed.apk" ] || die "apksigner 未产出签名包"
  cp "$WORK/signed.apk" "$OUT"
  ok "已签名 → $(basename "$OUT")"
fi
echo "$CODE" > "$P/.last_code"

say "[8/8] 自检"
CHECK_APK="$OUT"
[ "$UNSIGNED" = "1" ] || CHECK_APK="$WORK/signed.apk"
if [ "$UNSIGNED" != "1" ]; then
  "$BT/apksigner" verify --print-certs "$CHECK_APK" 2>/dev/null | grep -q 'Signer #1 certificate SHA-256 digest: 60c58fe3' \
    || die "签名证书指纹不对（必须与原包 60:C5:8F:E3:… 一致，否则无法覆盖安装）"
  ok "签名校验通过（证书 60:C5:8F:E3:… 与原包同一把钥匙）"
  # 注意：minSdk=29 的包默认只报 v3。要确认 v1/v2 也真的签了，
  # 必须用 --min-sdk-version 21 再验一次（原包同样如此）。
  VER=$("$BT/apksigner" verify --min-sdk-version 21 -v "$CHECK_APK" 2>/dev/null || true)
  for s in v1 v2 v3; do
    if echo "$VER" | grep -qE "Verified using $s scheme.*: true"; then
      ok "签名方案 $s 已启用"
    else
      ok "签名方案 $s 未验证通过（仅提示）"
    fi
  done
fi
BADGING=$("$BT/aapt2" dump badging "$CHECK_APK" 2>/dev/null)
echo "$BADGING" | grep -q "versionCode='$CODE'" || die "包内 versionCode 不是 $CODE"
echo "$BADGING" | grep -q "minSdkVersion:'29'" || die "minSdk 不是 29"
echo "$BADGING" | grep -q "targetSdkVersion:'36'" || die "targetSdk 不是 36"
ok "minSdk == 29 ｜ targetSdk == 36"
if echo "$BADGING" | grep -q 'android.permission.INTERNET'; then
  die "包内出现 INTERNET 权限（立身之本，绝对不许）"
fi
if echo "$BADGING" | grep -q 'application-debuggable'; then
  die "包内 debuggable=true"
fi
ok "安全基线：无 INTERNET 权限 / 非 debuggable"
grep -q 'usesCleartextTraffic="false"' "$P/AndroidManifest.xml" || die "清单里 cleartext 不是 false"
grep -q 'allowBackup="false"' "$P/AndroidManifest.xml" || die "清单里 allowBackup 不是 false"
ok "安全基线：cleartext=false / allowBackup=false"
# 注意：不能写 `unzip -l | grep -q` —— grep 一匹配就退出，unzip 写管道会收到 SIGPIPE(141)，
# 在 set -o pipefail 下整条管道算失败，会偶发误报「包内缺 assets/site」（2026-11-02 实际踩到）。
unzip -l "$CHECK_APK" > "$WORK/plist.txt" 2>/dev/null || die "无法列出包内条目"
grep -q 'assets/site/index.html' "$WORK/plist.txt" || die "包内缺 assets/site"
ok "包内 assets/site 文件数：$(grep -c 'assets/site/' "$WORK/plist.txt")"

SZ=$(stat -c%s "$OUT")
SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
say "构建完成"
echo "  产物：$OUT"
echo "  体积：$SZ 字节"
echo "  SHA256：$SHA"
echo "  ⚠️  体积相同 ≠ 版本相同（apksigner 会 4096 对齐），核对请比包内文件"
