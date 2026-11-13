#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""学通 · 构建 manifest（2026-11-13）

为什么需要：网页版和 APK 是两条构建路径 ——
  · Pages 在部署时把 sw.js 的 VERSION 改成 commit sha 前 8 位；
  · APK 构建用 version.json 的版本号打包，资源还经过 versionize_html 注入 ?v=。
两条路都合理，但产物不是逐字节相同。用户说「网页版和 App 看起来不一样」时，
光比版本名没用，得能比「这份构建用了哪些文件」。

本脚本产出一份可比的清单：版本三元组、commit、关键文件哈希、预缓存清单哈希、
首屏体积、构建工具版本。

用法：
    python3 tools/gen_manifest.py                      # 写到 stdout
    python3 tools/gen_manifest.py --out build-manifest.json
    python3 tools/gen_manifest.py --sha 0aa025b8       # 记录源提交
"""
import argparse
import hashlib
import json
import platform
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # site/
SITE = ROOT

KEY_FILES = [
    "index.html", "sw.js", "version.json",
    "data/graph.js", "data/graph-wenge.js", "data/graph-world.js",
    "data/resources.js", "data/edge-meta.js", "data/concepts.js",
    "assets/app.js", "assets/challenge.js", "assets/qa-engine.js",
    "assets/datamap.js",
    "books/bk_zuopai_youzhibing.txt",
]


def sha256_of(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_version() -> dict:
    vf = SITE / "version.json"
    if vf.exists():
        d = json.loads(vf.read_text(encoding="utf-8"))
        return {
            "appVersion": d.get("versionName") or d.get("version"),
            "versionCode": d.get("versionCode") or d.get("code"),
            "siteVersion": d.get("siteVersion") or d.get("site"),
            "swVersion": d.get("sw"),
        }
    return {}


def sw_core_hash() -> str:
    """预缓存清单的哈希：把这批 URL 排序后拼起来算 sha256。
    两个构建只要预缓存集合不同，这里就会不同。"""
    swf = SITE / "sw.js"
    if not swf.exists():
        return ""
    txt = swf.read_text(encoding="utf-8")
    m = re.search(r"const CORE\s*=\s*\[(.*?)\]", txt, re.S)
    if not m:
        return ""
    items = sorted(set(re.findall(r"'([^']+)'", m.group(1))))
    return hashlib.sha256("\n".join(items).encode()).hexdigest()


def first_screen() -> dict:
    idx = SITE / "index.html"
    if not idx.exists():
        return {}
    html = idx.read_text(encoding="utf-8")
    srcs = re.findall(r'<script[^>]*src="([^"?]+)', html)
    total, missing = 0, []
    for s in srcs:
        p = SITE / s.lstrip("./")
        if p.exists():
            total += p.stat().st_size
        else:
            missing.append(s)
    return {"scripts": len(srcs), "kb": round(total / 1024), "missing": missing}


def count_files() -> dict:
    n = 0
    b = 0
    for p in SITE.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(SITE).as_posix()
        if rel.startswith("tools/") or "/node_modules/" in rel or rel.startswith("node_modules/"):
            continue
        n += 1
        b += p.stat().st_size
    return {"files": n, "bytes": b, "mb": round(b / 1048576, 2)}


def tool_version(cmd) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return (r.stdout or r.stderr).strip().splitlines()[0]
    except Exception:
        return ""


def build(commit: str) -> dict:
    v = read_version()
    keys = {}
    for rel in KEY_FILES:
        p = SITE / rel
        keys[rel] = sha256_of(p) if p.exists() else None
    return {
        "_说明": "这份清单说明该构建用了哪些输入；网页版与 APK 对不上时先比这里，别只比版本名。",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": commit or "",
        **v,
        "swCoreHash": sw_core_hash(),
        "keyFiles": keys,
        "firstScreen": first_screen(),
        "size": count_files(),
        "tools": {
            "python": platform.python_version(),
            "node": tool_version(["node", "--version"]),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    ap.add_argument("--sha", default="")
    a = ap.parse_args()

    data = build(a.sha)
    txt = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if a.out:
        out = Path(a.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(txt, encoding="utf-8")
        print("已写出 %s（%d 字节）" % (out, len(txt)))
        print("  版本 %s / %s ｜ SW %s ｜ commit %s" %
              (data.get("appVersion"), data.get("versionCode"), data.get("swVersion"), data.get("commit") or "—"))
        print("  文件 %d 个 / %.2f MB ｜ 首屏 %s KB ｜ 预缓存哈希 %s" %
              (data["size"]["files"], data["size"]["mb"], data["firstScreen"].get("kb"), data["swCoreHash"][:12]))
    else:
        sys.stdout.write(txt)


if __name__ == "__main__":
    main()
