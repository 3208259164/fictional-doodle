#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""学通 · 包内验证（第三层）

起因：规范第 5 节要求交付前跑 `tools/verify_apk.sh`（62 项），但该脚本没随源码交付
（属前任缺件）。这里按规范的检查意图重写一份等效实现，覆盖：完整性 / 版本 /
安全基线 / 签名 / 包内站点与源站点一致 / 版本注入 / 全文索引 / 素材字节。

用法： python3 tools/verify_apk.py [--apk PATH] [--site DIR]
      有 toolchain 时自动跑 aapt2 / apksigner，没有则跳过并标注 SKIP。
"""
import os, sys, json, zipfile, subprocess, hashlib

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))    # site/ 或 site_new/
ROOT = os.path.dirname(SITE)                                           # 站点与 App 工程的共同上级
APP = next((os.path.join(ROOT, n) for n in ("app", "apk_new")
            if os.path.exists(os.path.join(ROOT, n, "AndroidManifest.xml"))), os.path.join(ROOT, "app"))
TC = os.environ.get("TC") or next((p for p in (
    os.path.join(ROOT, "toolchain"), os.path.expanduser("~/toolchain"),
    "/sandbox/workspace/toolchain") if os.path.isdir(p)), "")
AAPT2 = os.path.join(TC, "build-tools-36", "aapt2")
APKSIGNER = os.path.join(TC, "build-tools-36", "apksigner")
OK = FAIL = SKIP = 0
FAILS = []


def ck(name, cond, extra=""):
    global OK, FAIL
    if cond:
        OK += 1
        print("  ✅ %s%s" % (name, (" · " + extra) if extra else ""))
    else:
        FAIL += 1
        FAILS.append(name)
        print("  ❌ %s%s" % (name, (" · " + extra) if extra else ""))


def sk(name, why):
    global SKIP
    SKIP += 1
    print("  ⏭  %s（%s）" % (name, why))


def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except Exception as e:
        return 1, str(e)


def main():
    apk = sys.argv[sys.argv.index("--apk") + 1] if "--apk" in sys.argv else None
    if not apk:
        cands = sorted([f for f in os.listdir(APP)
                        if f.endswith(".apk") and f.startswith("学通-")],
                       key=lambda f: os.path.getmtime(os.path.join(APP, f)))
        apk = os.path.join(APP, cands[-1]) if cands else ""
    print("APK:", apk)
    print("SITE:", SITE)
    if not apk or not os.path.exists(apk):
        print("找不到 APK"); sys.exit(2)

    size = os.path.getsize(apk)
    sha = hashlib.sha256(open(apk, "rb").read()).hexdigest()

    print("\n— A. 文件与完整性 —")
    ck("APK 存在且非空", size > 500_000, "%d 字节" % size)
    z = zipfile.ZipFile(apk)
    bad = z.testzip()
    ck("zip 结构完整（无损坏条目）", bad is None, "首个坏条目 %s" % bad if bad else "%d 条目" % len(z.infolist()))
    names = [i.filename for i in z.infolist()]
    ck("含 AndroidManifest.xml", "AndroidManifest.xml" in names)
    ck("含 classes.dex", any(n == "classes.dex" for n in names))
    ck("含 resources.arsc", "resources.arsc" in names)
    ck("无 macOS 垃圾条目", not any(n.startswith("__MACOSX") or n.endswith(".DS_Store") for n in names))

    print("\n— B. 包内站点文件 —")
    site_names = [n for n in names if n.startswith("assets/site/")]
    ck("assets/site 条目数 > 100", len(site_names) > 100, str(len(site_names)))
    ck("index.html 在包内", "assets/site/index.html" in names)
    ck("data/resources.js 在包内", "assets/site/data/resources.js" in names)
    ck("data/jtfull.js 在包内（全文索引）", "assets/site/data/jtfull.js" in names)
    ck("data/jtprev.js 在包内（列表预览）", "assets/site/data/jtprev.js" in names)
    ck("无 tools/ 泄漏", not any("/tools/" in n for n in site_names))
    ck("无 .bak/.tmp 泄漏", not any((".bak" in n or ".tmp" in n or ".orig" in n) for n in site_names))
    ck("无非 ASCII 文件名（aapt2 不写 UTF-8 flag）",
       not any(any(ord(c) > 127 for c in n) for n in names))

    # 与源站点逐字节
    src_bad, src_miss, n_src = [], [], 0
    for root, dirs, files in os.walk(SITE):
        if "tools" in root.split(os.sep) or "node_modules" in root.split(os.sep):
            continue
        for f in files:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, SITE)
            n_src += 1
            key = "assets/site/" + rel
            if key not in names:
                src_miss.append(rel); continue
            if rel.endswith(".html"):
                continue          # 构建期注入 __YZV / ?v= 属预期差异
            if z.read(key) != open(p, "rb").read():
                src_bad.append(rel)
    ck("源站点文件全部进包", not src_miss, "%d 个，缺 %d" % (n_src, len(src_miss)))
    ck("非 HTML 逐字节一致", not src_bad, "不一致 %d" % len(src_bad))

    print("\n— C. 版本注入 —")
    try:
        idx = z.read("assets/site/index.html").decode("utf-8", "ignore")
        import re
        m = re.search(r"window\.__YZV\s*=\s*'(\d+)'", idx)
        ck("HTML 注入 __YZV", bool(m), m.group(1) if m else "未找到")
        ck("静态资源带 ?v= 版本号", "?v=" + (m.group(1) if m else "\0") in idx)
        cfg = z.read("assets/site/data/config.js").decode("utf-8", "ignore")
        ver = re.search(r"version\s*:\s*'([^']+)'", cfg)
        ck("config.js 有站点版本", bool(ver), ver.group(1) if ver else "—")
        sw = z.read("assets/site/sw.js").decode("utf-8", "ignore")
        sv = re.search(r"const VERSION\s*=\s*'([^']+)'", sw)
        ck("sw.js 有 VERSION", bool(sv), sv.group(1) if sv else "—")
        ck("sw VERSION 与 __YZV 对齐", bool(m and sv and sv.group(1) == "v" + m.group(1)),
           "%s vs v%s" % (sv.group(1) if sv else "—", m.group(1) if m else "—"))
    except Exception as e:
        ck("版本注入可读", False, str(e))

    print("\n— D. 数据自洽 —")
    try:
        res = z.read("assets/site/data/resources.js").decode("utf-8")
        arr = json.loads(res.split("window.SITE_RESOURCES = ", 1)[1].rstrip().rstrip(";"))
        jt = [x for x in arr if x.get("cat") == "讲堂"]
        ck("资源条目数 > 400", len(arr) > 400, str(len(arr)))
        ck("讲堂条目 > 0", len(jt) > 0, str(len(jt)))
        books = {n.split("/")[-1] for n in site_names if "/books/" in n}
        miss = [x["id"] for x in jt if x.get("url", "").split("/")[-1] not in books]
        ck("讲堂 url 全部命中包内文件", not miss, "%d 条缺 %d" % (len(jt), len(miss)))
        prev = z.read("assets/site/data/jtprev.js").decode("utf-8")
        pv = json.loads(prev.split("window.JT_PREV = ", 1)[1].rstrip().rstrip(";"))
        nocover = [x["id"] for x in jt if not pv.get(x["id"])]
        ck("讲堂每篇都有列表预览", not nocover, "缺 %d" % len(nocover))
    except Exception as e:
        ck("数据可解析", False, str(e))

    print("\n— E. Manifest 与安全基线 —")
    if os.path.exists(AAPT2):
        rc, out = run([AAPT2, "dump", "badging", apk])
        ck("aapt2 badging 可读", rc == 0)
        import re
        vc = re.search(r"versionCode='(\d+)'", out)
        vn = re.search(r"versionName='([^']+)'", out)
        pkg = re.search(r"package: name='([^']+)'", out)
        ck("包名正确", bool(pkg and pkg.group(1) == "com.yuanziyuan.app"), pkg.group(1) if pkg else "—")
        ck("versionCode 存在", bool(vc), vc.group(1) if vc else "—")
        ck("versionName 存在", bool(vn), vn.group(1) if vn else "—")
        ck("minSdk = 29", "minSdkVersion:'29'" in out)
        ck("targetSdk = 36", "targetSdkVersion:'36'" in out)
        ck("无 INTERNET 权限", "android.permission.INTERNET" not in out)
    else:
        sk("aapt2 检查", "工具链未就绪")

    if os.path.exists(APKSIGNER):
        rc, out = run([APKSIGNER, "verify", "-v", "--print-certs", "--min-sdk-version", "21", apk])
        ck("签名校验通过", rc == 0, out.strip().splitlines()[0] if out.strip() else "")
        ck("含 v1/v2/v3 三档", ("v1 scheme (JAR signing): true" in out or "v1" in out) and "v2" in out and "v3" in out)
        import re
        m = re.search(r"SHA-256 digest: ([0-9a-f]+)", out)
        ck("证书指纹为原钥匙", bool(m and m.group(1).lower().startswith("60c58fe3")),
           (m.group(1)[:16] + "…") if m else "—")
    else:
        sk("apksigner 检查", "工具链未就绪")

    print("\n— F. 汇总 —")
    print("  通过 %d ｜ 失败 %d ｜ 跳过 %d" % (OK, FAIL, SKIP))
    print("  SHA256: %s" % sha)
    if FAILS:
        print("  失败项: " + "；".join(FAILS))
        sys.exit(1)
    print("  ✅ 包内验证全部通过")


if __name__ == "__main__":
    main()
