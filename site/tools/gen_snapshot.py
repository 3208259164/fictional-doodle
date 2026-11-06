#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_snapshot.py — 把站点与 App 源码打成一份「AI 可读」的文本快照

原版在 2026-11 之前就被写坏了（文件在第 25 行截断，从来没跑成过），这里重写一份。
每个文件一段，分隔行固定为：

    /* ===== FILE: 相对路径  (字节数 bytes) ===== */

用法：
    python3 tools/gen_snapshot.py [输出文件]
    默认输出到站点同级的 snapshot/源码快照_<日期>.md
    站点目录默认取本脚本的上一级，可用 SITE= 覆盖；App 目录自动找 ../app 或 ../apk_new。
"""
import datetime
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = Path(os.environ.get("SITE") or HERE.parent)
ROOT = SITE.parent
APP = next((ROOT / n for n in ("app", "apk_new") if (ROOT / n / "AndroidManifest.xml").exists()), None)

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else (
    ROOT / "snapshot" / ("源码快照_%s.md" % datetime.date.today().strftime("%Y%m%d")))

# 不进快照的：体积大且与「怎么写的」无关
SKIP_DIRS = {"lib", "images", "books", "audio", "node_modules", "__pycache__", "_screens", "snapshot"}
SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".mp3", ".mp4", ".woff", ".woff2", ".ttf"}
TEXT_SUFFIX = {".js", ".css", ".html", ".json", ".md", ".py", ".sh", ".java", ".xml", ".pro", ".txt",
               ".webmanifest", ".svg"}


def walk(base, skip_dirs):
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(base)
        if any(part in skip_dirs for part in rel.parts[:-1]):
            continue
        if p.suffix.lower() in SKIP_SUFFIX:
            continue
        if p.suffix and p.suffix.lower() not in TEXT_SUFFIX:
            continue
        yield p, rel.as_posix()


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    parts = [
        "# 学通 源码快照\n",
        "\n- 站点：%s\n- App：%s\n- 生成：%s\n- 说明：每个文件以 `/* ===== FILE: 路径  (N bytes) ===== */` 分段，可直接切分还原。\n"
        % (SITE.name, APP.name if APP else "（未找到）", datetime.datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    n = total = 0
    for p, rel in walk(SITE, SKIP_DIRS):
        try:
            body = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        parts.append("\n/* ===== FILE: %s  (%d bytes) ===== */\n\n```\n%s\n```\n"
                     % ("site/" + rel, len(body.encode("utf-8")), body.rstrip()))
        n += 1
        total += len(body)

    if APP:
        for p, rel in walk(APP, {"assets", "build"} | SKIP_DIRS):
            try:
                body = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            parts.append("\n/* ===== FILE: %s  (%d bytes) ===== */\n\n```\n%s\n```\n"
                         % ("app/" + rel, len(body.encode("utf-8")), body.rstrip()))
            n += 1
            total += len(body)

    OUT.write_text("".join(parts), encoding="utf-8")
    print("✅ %d 个文件 / %.1f 万字 → %s（%.2f MB）"
          % (n, total / 10000, OUT, OUT.stat().st_size / 1048576))


if __name__ == "__main__":
    main()
