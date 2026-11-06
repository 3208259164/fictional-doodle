#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""学通 · 版本单一真相源

真相源只有一个：site/version.json

派生出去的地方（本脚本负责同步，你不需要手改）：
    site/data/config.js   version: 'x.y.z'
    site/sw.js            const VERSION = 'vN'      （= versionCode；Pages 部署时 CI 会再覆盖成 commit sha）
    site/version.json     补齐 code/version/site/sw 兼容字段
    README.md             第 5 行版本行 + Release 下载链接
    app/.last_code        versionCode（只增不减，构建门禁用）

用法：
    python3 tools/sync_version.py --check                      # 只体检，不一致 exit 1
    python3 tools/sync_version.py --apply                      # 按 version.json 写进各处
    python3 tools/sync_version.py --set app=0.18.29 --set code=310 --set site=0.37.13 --apply
    python3 tools/sync_version.py --set code=310 --apply       # 只升 code

--set 可以给多次；键：app（版本名）/ code（versionCode）/ site（站点版本）。
"""
import argparse
import json
import re
import sys
from pathlib import Path


def find_site_root():
    """脚本在 site/tools/ 或 site_new/tools/ 下，站点根是上一级。"""
    return Path(__file__).resolve().parent.parent


def find_app_dir(site_root):
    """仓库里叫 app/，本地开发目录叫 apk_new/。"""
    for name in ("app", "apk_new"):
        p = site_root.parent / name
        if (p / "AndroidManifest.xml").exists():
            return p
    return None


def find_readme(site_root):
    for name in ("README.md",):
        p = site_root.parent / name
        if p.exists():
            return p
    return None


# --------------------------- 读真相源 ---------------------------

def load_truth(site_root, sets=None):
    p = site_root / "version.json"
    if not p.exists():
        sys.exit(
            "❌ 缺 %s\n   这是版本唯一真相源。先建一个：\n"
            '   {"versionName":"0.1.0","versionCode":1,"siteVersion":"0.1.0"}' % p
        )
    d = json.loads(p.read_text(encoding="utf-8"))
    cur = {
        "app": d.get("versionName") or d.get("version"),
        "code": int(d.get("versionCode") or d.get("code") or 0),
        "site": d.get("siteVersion") or d.get("site"),
    }
    if not all(cur.values()):
        sys.exit("❌ version.json 缺字段（需要 versionName / versionCode / siteVersion）：%s" % d)

    for item in sets or []:
        if "=" not in item:
            sys.exit("❌ --set 格式应为 key=value，收到 %r" % item)
        k, v = item.split("=", 1)
        k = k.strip()
        if k not in cur:
            sys.exit("❌ 未知键 %r（可用：app / code / site）" % k)
        cur[k] = int(v) if k == "code" else v.strip()
    return cur, d


# --------------------------- 生成目标内容 ---------------------------

def render_config_js(text, site_ver):
    pat = re.compile(r"(version\s*:\s*')[^']*(')")
    if len(pat.findall(text)) != 1:
        sys.exit("❌ data/config.js 里 version: '...' 不是恰好一处，拒绝改（可能格式变了）")
    return pat.sub(lambda m: m.group(1) + site_ver + m.group(2), text, count=1)


def render_sw_js(text, code):
    pat = re.compile(r"(const VERSION\s*=\s*')[^']*(')")
    if len(pat.findall(text)) != 1:
        sys.exit("❌ sw.js 里 const VERSION = '...' 不是恰好一处，拒绝改")
    return pat.sub(lambda m: m.group(1) + "v%d" % code + m.group(2), text, count=1)


def render_version_json(truth):
    return json.dumps(
        {
            "deprecated": True,
            "note": "应用内自更新已移除（App 完全离线、无网络权限）。本文件仅记录构建版本，不用于更新检测。",
            "versionCode": truth["code"],
            "versionName": truth["app"],
            "siteVersion": truth["site"],
            "code": truth["code"],
            "version": truth["app"],
            "site": truth["site"],
            "sw": "v%d" % truth["code"],
        },
        ensure_ascii=False,
        indent=2,
    ) + "\n"


def render_readme(text, truth):
    site_ver_pat = re.compile(
        r"(\*\*当前版本：v)[\d.]+(（versionCode )\d+(）｜ 站点 )[\d.]+"
    )
    if site_ver_pat.search(text):
        text = site_ver_pat.sub(
            lambda m: "%s%s%s%d%s%s" % (m.group(1), truth["app"], m.group(2), truth["code"], m.group(3), truth["site"]),
            text,
            count=1,
        )
    # Release 下载链接（可能有多行：ghproxy / gh-proxy）
    text = re.sub(
        r"(releases/download/)v[\d.]+(/)xuetong-[\d.]+\.apk",
        lambda m: "%sv%s%sxuetong-%s.apk" % (m.group(1), truth["app"], m.group(2), truth["app"]),
        text,
    )
    return text


# --------------------------- 主流程 ---------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只体检，不一致 exit 1")
    ap.add_argument("--apply", action="store_true", help="写盘")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VAL")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    if not a.check and not a.apply:
        a.check = True
    if a.check and a.apply:
        sys.exit("❌ --check 与 --apply 只能二选一")

    site_root = find_site_root()
    app_dir = find_app_dir(site_root)
    readme = find_readme(site_root)
    truth, raw = load_truth(site_root, a.set)

    targets = []  # (label, path, 新内容 or None, 旧内容)

    cfg = site_root / "data" / "config.js"
    if cfg.exists():
        old = cfg.read_text(encoding="utf-8")
        targets.append(("data/config.js", cfg, render_config_js(old, truth["site"]), old))

    swp = site_root / "sw.js"
    if swp.exists():
        old = swp.read_text(encoding="utf-8")
        targets.append(("sw.js", swp, render_sw_js(old, truth["code"]), old))

    vj = site_root / "version.json"
    old = vj.read_text(encoding="utf-8") if vj.exists() else ""
    targets.append(("version.json", vj, render_version_json(truth), old))

    if readme:
        old = readme.read_text(encoding="utf-8")
        targets.append(("README.md", readme, render_readme(old, truth), old))

    last = app_dir / ".last_code" if app_dir else None
    if last is not None:
        old = last.read_text(encoding="utf-8").strip() if last.exists() else "0"
        prev = int(old or 0)
        # .last_code 只增不减：它是「历史最大构建号」，构建门禁靠它防降级
        want = max(prev, truth["code"])
        targets.append(("app/.last_code", last, "%d\n" % want, "%d\n" % prev if last.exists() else ""))

    drift = [(lbl, p, new, old) for (lbl, p, new, old) in targets if new != old]

    if a.check:
        if not drift:
            if not a.quiet:
                print("✅ 版本一致：App %s (%d) ｜ 站点 %s ｜ sw v%d"
                      % (truth["app"], truth["code"], truth["site"], truth["code"]))
            return 0
        print("❌ 版本信息不一致（%d 处）：" % len(drift))
        for lbl, p, new, old in drift:
            print("   · %s" % lbl)
        print("\n   修法：python3 %s --apply" % Path(__file__).name)
        print("   或一步升版本：python3 %s --set app=x.y.z --set code=N --set site=a.b.c --apply"
              % Path(__file__).name)
        return 1

    # apply
    vj.parent.mkdir(parents=True, exist_ok=True)
    for lbl, p, new, old in targets:
        if new == old:
            continue
        p.write_text(new, encoding="utf-8")
        print("   ✍️  %s" % lbl)
    print("✅ 已同步：App %s (%d) ｜ 站点 %s ｜ sw v%d"
          % (truth["app"], truth["code"], truth["site"], truth["code"]))
    if not readme:
        print("   （没有 README.md，跳过；在仓库里运行会一并更新）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
