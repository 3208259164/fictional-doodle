#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CHANGELOG 归档：主文件只保留最近 KEEP 个版本，其余移入 CHANGELOG-archive.md"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, 'CHANGELOG.md')
ARC = os.path.join(ROOT, 'CHANGELOG-archive.md')
KEEP = 8

s = open(MAIN, encoding='utf-8').read()
parts = re.split(r'(?m)^(?=# v\d)', s)
head, versions = parts[0], parts[1:]
if len(versions) <= KEEP:
    print('无需归档（当前 %d 个版本 ≤ %d）' % (len(versions), KEEP))
    sys.exit(0)

keep, move = versions[:KEEP], versions[KEEP:]
if os.path.exists(ARC):
    old = open(ARC, encoding='utf-8').read()
    if not old.endswith('\n'):
        old += '\n'
else:
    old = ('# 更新日志 · 归档（更早版本）\n\n'
           '本文件保存 `CHANGELOG.md` 归档下来的历史记录，最新记录请看 CHANGELOG.md。\n\n')
open(ARC, 'w', encoding='utf-8').write(old + '\n' + '\n'.join(move).rstrip('\n') + '\n')

tail = ('\n---\n\n更早的更新记录（%d 个版本）见 [CHANGELOG-archive.md](CHANGELOG-archive.md)。\n' % len(move))
open(MAIN, 'w', encoding='utf-8').write(head.rstrip('\n') + '\n\n' + '\n'.join(keep).rstrip('\n') + '\n' + tail)
print('已归档：主文件保留 %d 个版本，移出 %d 个 → CHANGELOG-archive.md' % (len(keep), len(move)))
