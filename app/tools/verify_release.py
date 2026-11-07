#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""学通 · 交付自检

为什么要有这个脚本：
    2026-11 有过一次真实事故 —— 交付 0.18.25 时贴了 0.18.24 的旧链接，用户装了两遍才发现。
    从那以后规矩是：**发出去的包，必须自己按用户拿到的方式再取一遍核对**。
    靠记性会漏，所以写成脚本。

它核对四件事（四项全过才算 PASS）：
    1. 字节：大小 + SHA-256（有 --sha 时逐字节比对）
    2. 清单：versionCode / versionName / minSdk / targetSdk
    3. 内容：包内 assets/site/data/config.js 的站点版本、sw.js 的缓存版本
    4. 桥：dex 里 @JavascriptInterface 注解数量（R8 裁掉注解会让所有 App 功能变空壳）

用法：
    python3 tools/verify_release.py 学通-0.18.28.apk
    python3 tools/verify_release.py --url https://.../xuetong-0.18.28.apk --sha e67908...
    python3 tools/verify_release.py 学通-0.18.28.apk --expect-code 309 --expect-site 0.37.12
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

UA = "Mozilla/5.0 (compatible; xuetong-verify/1.0)"


def log(ok, label, detail=""):
    print("%s %-28s %s" % ("✅" if ok else "❌", label, detail))
    return ok


def find_bt(explicit=None):
    if explicit:
        return Path(explicit)
    app = Path(__file__).resolve().parent.parent
    cands = [
        app.parent / "toolchain",
        Path("/sandbox/workspace/toolchain"),
        Path.home() / "toolchain",
    ]
    for c in cands:
        if (c / "build-tools-36" / "aapt2").exists():
            return c / "build-tools-36"
    return None


def download(url, dest, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f, 1024 * 256)
            return True
        except Exception as e:      # 代理经常中途截断，重试是常态
            last = e
            print("   …第 %d 次下载失败：%s" % (i + 1, e))
    print("   ❌ 下载失败：%s" % last)
    return False


def sha256_of(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("apk", nargs="?")
    ap.add_argument("--url")
    ap.add_argument("--sha")
    ap.add_argument("--expect-code", type=int)
    ap.add_argument("--expect-site")
    ap.add_argument("--bt")
    ap.add_argument("--min-bridge", type=int, default=50,
                    help="dex 里 @JavascriptInterface 至少这么多个（默认 50）")
    a = ap.parse_args()

    app = Path(__file__).resolve().parent.parent
    site = None
    for name in ("site", "site_new"):
        if (app.parent / name / "version.json").exists():
            site = app.parent / name
            break
    truth = {}
    if site:
        truth = json.loads((site / "version.json").read_text(encoding="utf-8"))

    expect_code = a.expect_code or truth.get("versionCode")
    expect_name = truth.get("versionName")
    expect_site = a.expect_site or truth.get("siteVersion")

    tmpdir = Path(tempfile.mkdtemp(prefix="yz-verify-"))
    try:
        if a.url:
            print("⬇️  下载：%s" % a.url)
            local = tmpdir / "download.apk"
            if not download(a.url, local):
                return 2
            report = local
        elif a.apk:
            report = Path(a.apk)
        else:
            sys.exit("❌ 要么给 apk 路径，要么给 --url")

        if not report.exists():
            sys.exit("❌ 文件不存在：%s" % report)

        results = []

        # ---- 1. 字节 ----
        size = report.stat().st_size
        sha = sha256_of(report)
        results.append(log(size > 1_000_000, "体积", "%d 字节" % size))
        if a.sha:
            results.append(log(sha == a.sha.lower(), "SHA-256", sha if sha == a.sha.lower()
                               else "%s（期望 %s）" % (sha, a.sha)))
        else:
            results.append(log(True, "SHA-256", sha + "（未给期望值，仅记录）"))

        # ---- 2. 清单 ----
        bt = find_bt(a.bt)
        if not bt:
            results.append(log(False, "清单", "找不到 build-tools（用 --bt 指定）"))
        else:
            badging = subprocess.run([str(bt / "aapt2"), "dump", "badging", str(report)],
                                     capture_output=True, text=True).stdout
            code = re.search(r"versionCode='(\d+)'", badging)
            name = re.search(r"versionName='([^']*)'", badging)
            mn = re.search(r"minSdkVersion:'(\d+)'", badging)
            tg = re.search(r"targetSdkVersion:'(\d+)'", badging)
            got_code = int(code.group(1)) if code else -1
            got_name = name.group(1) if name else "?"
            results.append(log(expect_code is None or got_code == expect_code, "versionCode",
                               "%d（期望 %s）" % (got_code, expect_code)))
            results.append(log(expect_name is None or got_name == expect_name, "versionName",
                               "%s（期望 %s）" % (got_name, expect_name)))
            results.append(log(bool(mn) and mn.group(1) == "29", "minSdk", mn.group(1) if mn else "?"))
            results.append(log(bool(tg) and tg.group(1) == "36", "targetSdk", tg.group(1) if tg else "?"))
            results.append(log("android.permission.INTERNET" not in badging, "无 INTERNET 权限",
                               "（这是立身之本）" if "android.permission.INTERNET" not in badging else "出现了！"))

        # ---- 3. 包内内容 ----
        with zipfile.ZipFile(report) as z:
            names = z.namelist()
            cfg = [n for n in names if n.endswith("assets/site/data/config.js")]
            full = [n for n in names if n.endswith("assets/site/data/resources.js")]
            if cfg:
                txt = z.read(cfg[0]).decode("utf-8", "ignore")
                # 注意：构建时站点 JS 会被 minify，config.js 里的单引号会变成双引号，
                # 只匹配单引号会导致「包内站点版本 ?」的假失败（2026-11-07 遇到）。
                m = re.search(r"version\s*:\s*['\"]([^'\"]*)['\"]", txt)
                got_site = m.group(1) if m else "?"
                results.append(log(expect_site is None or got_site == expect_site, "包内站点版本",
                                   "%s（期望 %s）" % (got_site, expect_site)))
            else:
                results.append(log(False, "包内站点版本", "没找到 assets/site/data/config.js"))
            # 首屏资源确实打进去了（防止 assets/site 复制不完整）
            for must in ("assets/site/index.html", "assets/site/assets/app.js"):
                results.append(log(any(n.endswith(must) for n in names), "包含 " + must.split("/")[-2] + "/" + must.split("/")[-1]))
            if full:
                sz = z.getinfo(full[0]).file_size
                results.append(log(sz > 300_000, "书库数据 resources.js", "%d 字节" % sz))
            sw = [n for n in names if n.endswith("assets/site/sw.js")]
            if sw:
                swtxt = z.read(sw[0]).decode("utf-8", "ignore")
                m = re.search(r"const VERSION\s*=\s*'([^']*)'", swtxt)
                gots = m.group(1) if m else "?"
                want = "v%s" % expect_code if expect_code else None
                results.append(log(want is None or gots == want, "包内 sw 缓存版本",
                                   "%s（期望 %s）" % (gots, want)))
                # 预缓存清单里的每个文件都必须真的打进包了，否则离线时静默缺功能
                core = re.search(r"const CORE = \[(.*?)\];", swtxt, re.S)
                missed = []
                if core:
                    for item in re.findall(r"'([^']+)'", core.group(1)):
                        if item in ("./", "/"):
                            continue
                        rel = item.lstrip("./")
                        if not any(n.endswith("assets/site/" + rel) for n in names):
                            missed.append(rel)
                results.append(log(not missed, "预缓存清单文件齐全",
                                   "全部在包内" if not missed else "缺 %d：%s" % (len(missed), "、".join(missed[:5]))))

            # ---- 4. JS 桥注解 ----
            dexes = [n for n in names if n.endswith(".dex")]
            if not dexes:
                results.append(log(False, "JS 桥注解", "包里没有 dex"))
            elif bt:
                total = 0
                for d in dexes:
                    p = tmpdir / Path(d).name
                    p.write_bytes(z.read(d))
                    out = subprocess.run([str(bt / "dexdump"), "-a", str(p)],
                                         capture_output=True, text=True).stdout
                    total += out.count("JavascriptInterface")
                results.append(log(total >= a.min_bridge, "JS 桥注解",
                                   "%d 个 @JavascriptInterface（下限 %d）" % (total, a.min_bridge)))

        print()
        if all(results):
            print("PASS —— 四项全过，可以交付")
            return 0
        print("FAIL —— 有 %d 项没过，不要交付" % (len(results) - sum(results)))
        return 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
