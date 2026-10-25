#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_snapshot.py — 把最新版「学通」按「AI 可读形式」打包成 site_*/app_* 文本快照
（对齐知识库既有 09_源码 文件夹的形态，供任意 AI 解析与复刻）
用法：python3 tools/gen_snapshot.py  → 输出到 /sandbox/workspace/output/源码快照_App0.16.48/
"""
import os, hashlib, datetime

SITE = "/sandbox/workspace/output/yuanziyuan"
OUT = "/sandbox/workspace/output/源码快照_App0.16.48"
os.makedirs(OUT, exist_ok=True)


def read(p):
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def pack(outname, items, title):
    """items: list of (relpath, abs_path)"""
    buf = ["/* =====================================================================",
           "   " + title,
           "   生成：%s   来源：%s" % (datetime.date.today().isoformat(), SITE),
           "   规则：每个文件以 '
