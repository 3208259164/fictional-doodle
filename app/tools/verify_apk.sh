#!/usr/bin/env bash
# =====================================================================
# 元资源库 App · APK 交付前校验脚本（可反复运行）
# 用法：  bash tools/verify_apk.sh <apk路径> [build-tools目录]
# 检查：签名方案 / 版本 / SDK / 权限 / 安全配置 / 组件 / 快捷方式 / 图标 /
#       dex 内 JS 桥与内容包·自更新类是否保留 / 站点资源是否齐全
# =====================================================================
set -e
APK="${1:?用法: bash tools/verify_apk.sh <apk> [build-tools目录]}"
BT="${2:-/sandbox/workspace/android/android-16}"
[ -f "$APK" ] || { echo "找不到 APK: $APK"; exit 1; }
T=/tmp/verify_apk_$$; mkdir -p "$T"; cp "$APK" "$T/a.apk"
ok=0; fail=0
has(){ if echo "$1" | grep -q "$2"; then echo "  ✓ $3"; ok=$((ok+1)); else echo "  ✗ $3"; fail=$((fail+1)); fi; }
no(){  if echo "$1" | grep -q "$2"; then echo "  ✗ $3"; fail=$((fail+1)); else echo "  ✓ $3"; ok=$((ok+1)); fi; }

echo "== 校验 $APK =="
BAD=$("$BT/aapt2" dump badging "$T/a.apk" 2>/dev/null || true)
VER=$(java -jar "$BT/lib/apksigner.jar" verify -v "$T/a.apk" 2>/dev/null || true)

echo "[签名]"
# 老版 apksigner（0.9）按 minSdk 语境只报告「必需的」方案：minSdk 29 会显示 v1/v2=false，
# 但并不代表没有签名。v1 直接用包内签名文件判断，v2/v3 用 apksigner，并加一条总判定。
V1N=$(unzip -l "$T/a.apk" 2>/dev/null | grep -cE 'META-INF/[^/]+\.(SF|RSA|DSA|EC)$' || true)
has "$([ "${V1N:-0}" -ge 2 ] && echo yes || echo no)" "yes" "v1 签名文件存在（META-INF: $V1N 个）"
has "$VER" "Verified using v[23] scheme.*: true" "v2/v3 至少一种签名方案通过（minSdk 29 下 v3 即可）"
has "$VER" "Verifies" "apksigner 总判定 Verifies"
echo "[版本 / SDK]"
has "$BAD" "versionName='"  "读取到 versionName"
has "$BAD" "targetSdkVersion:'36'" "targetSdkVersion = 36 (Android 16)"
has "$BAD" "minSdkVersion:'29'"     "minSdkVersion = 29 (Android 10)"
echo "[权限（最小化）]"
no  "$BAD" "android.permission.INTERNET" "无 INTERNET（完全离线）"
no  "$BAD" "android.permission.ACCESS_NETWORK_STATE" "无 ACCESS_NETWORK_STATE"
no  "$BAD" "android.permission.REQUEST_INSTALL_PACKAGES" "无 REQUEST_INSTALL_PACKAGES（不含自更新）"
no  "$BAD" "READ_MEDIA" "无 READ_MEDIA_* 媒体权限"
no  "$BAD" "CAMERA"     "无 CAMERA 权限"
no  "$BAD" "RECORD_AUDIO" "无 RECORD_AUDIO 权限"
echo "[安全配置]"
MT=$("$BT/aapt2" dump xmltree --file AndroidManifest.xml "$T/a.apk" 2>/dev/null || true)
has "$MT" "allowBackup(0x01010280)=false"           "allowBackup=false"
has "$MT" "debuggable.*=false"                      "debuggable=false（release 未被调试）"
has "$MT" "dataExtractionRules"                      "dataExtractionRules 已配置（禁备份/迁移）"
has "$MT" "taskAffinity"                             "taskAffinity 已固定（防任务劫持）"
has "$MT" "localeConfig"                             "localeConfig（按应用设置语言）"
has "$MT" "usesCleartextTraffic(0x010104ec)=false"  "禁止明文流量"
has "$MT" "networkSecurityConfig"                   "networkSecurityConfig 已配置"
has "$MT" "enableOnBackInvokedCallback.*=true"      "预测性返回已开启"
has "$MT" "resizeableActivity(0x010104f6)=true"     "允许大屏调整尺寸"
has "$MT" 'name(0x01010003)=".App"'                    "自定义 Application（WebView 预热）"
has "$MT" "android.app.shortcuts"                   "静态快捷方式已注册"
echo "[图标 / 单色层]"
IC=$("$BT/aapt2" dump xmltree --file res/mipmap-anydpi-v26/ic_launcher.xml "$T/a.apk" 2>/dev/null || true)
has "$IC" "monochrome" "Android 13+ 单色图标层"
echo "[dex · JS 桥]"
(cd "$T" && unzip -o -q a.apk classes.dex)
DX=$("$BT/dexdump" -d "$T/classes.dex" 2>/dev/null || true)
for m in platform versionName getVersionName versionCode updateChannel saveBase64 openFile openExternal shareText toast storeGet storeSet webviewVersion deviceInfo; do
  has "$DX" "'$m'" "桥方法 $m"
done
echo "[dex · 内容包 / 自更新类（应全部移除）]"
for c in PackCrypto PackManager ApkInstaller; do
  no "$DX" "Lcom/yuanziyuan/app/$c;" "类 $c 已移除"
done
no "$DX" "'verifyRsaSha256'" "无 RSA 验签（内容包）方法"
no "$DX" "'checkAndUpdate'"  "无内容包热更新方法"
echo "[dex · 已移除的「本地站点」能力（F-Droid 合规）]"
for m in siteBegin sitePush siteFinish siteAbort siteList siteFiles siteRename siteDelete siteClear; do
  no "$DX" "'$m'" "桥方法 $m 已移除"
done
echo "[站点资源]"
LS=$(unzip -l "$T/a.apk")
has "$LS" "assets/site/assets/overlay.js"  "内容覆盖层 overlay.js"
has "$LS" "assets/site/assets/editor.js"   "自助编辑器 editor.js"
has "$LS" "assets/site/data/overrides.js"  "官方覆盖 overrides.js"
has "$LS" "assets/site/llms.txt"           "AI 可读声明 llms.txt"
has "$LS" "assets/site/index.html"   "index.html"
has "$LS" "assets/site/graph.html"   "graph.html"
has "$LS" "assets/site/graph3d.html" "graph3d.html（3D 图谱）"
has "$LS" "assets/site/offline.html" "offline.html（离线页）"
has "$LS" "assets/site/ask.html" "ask.html（图谱问答页）"
has "$LS" "assets/site/assets/qa-engine.js" "问答引擎 qa-engine.js"
echo
echo "== 结果：通过 $ok 项，失败 $fail 项 =="
rm -rf "$T"
[ "$fail" -eq 0 ] || exit 1
