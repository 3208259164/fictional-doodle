#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools/gen_py.py —— 重建 data/py.js 拼音索引
   来源：resources.js 的 title（书库） + content.js/knowledge.js/graph*.js 的 name（人物/概念/事件）
   输出：window.SITE_PY = {"名称":"全拼|首字母", ...}
   用法：python3 tools/gen_py.py
"""
import json, os, re, subprocess, sys
import sys as _sys
for _p in ('/sandbox/workspace/pylibs',):
    if _p not in _sys.path:
        _sys.path.insert(0, _p)
from pypinyin import lazy_pinyin

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(SITE, "data", "py.js")

# ① 用 node 把所有名称导出来（data/*.js 是 JS 字面量，Python 解析不了）
JS = r"""
const fs=require('fs'),vm=require('vm');
const ctx={window:{},console};vm.createContext(ctx);
['data/config.js','data/content.js','data/knowledge.js','data/resources.js',
 'data/graph.js','data/graph-wenge.js','data/graph-world.js','data/concepts.js','data/libraries.js']
 .forEach(f=>{ try{ if(fs.existsSync(f)) vm.runInContext(fs.readFileSync(f,'utf8'),ctx);}catch(e){} });
const W=ctx.window, out=new Set();
const push=x=>{ if(typeof x==='string'&&x.trim()) out.add(x.trim()); };
(W.SITE_RESOURCES||[]).forEach(r=>push(r.title));
(W.SITE_CONTENT&&W.SITE_CONTENT.leaders||[]).forEach(p=>push(p.name));
(W.SITE_CONTENT&&W.SITE_CONTENT.comrades||[]).forEach(p=>push(p.name));
(W.SITE_CONTENT&&W.SITE_CONTENT.figures||[]).forEach(p=>push(p.name));
(W.SITE_EXTRA&&W.SITE_EXTRA.critics||[]).forEach(p=>push(p.name));
['SITE_GRAPH','SITE_GRAPH_WENGE','SITE_GRAPH_WORLD'].forEach(k=>{
  ((W[k]&&W[k].nodes)||[]).forEach(n=>push(n.name)); });
((W.SITE_CONCEPTS&&W.SITE_CONCEPTS.items)||[]).forEach(c=>push(c.name||c.t));
(W.SITE_LIBRARIES||W.SITE_LIBS||[]).forEach(l=>push(l.name));
console.log(JSON.stringify([...out]));
"""

names = json.loads(subprocess.run(["node", "-e", JS], capture_output=True, text=True, cwd=SITE).stdout)
print("名称总数:", len(names))

def py_full(s):
    t = re.sub(r'[（）()《》【】“”「」\s、，,。：:·—－\-—…]', '', s)
    t = re.sub(r'[^\u4e00-\u9fa5A-Za-z0-9]', '', t)
    return ''.join(lazy_pinyin(t))

def py_ini(s):
    t = re.sub(r'[（）()《》【】“”「」\s、，,。：:·—－\-—…]', '', s)
    t = re.sub(r'[^\u4e00-\u9fa5A-Za-z0-9]', '', t)
    return ''.join(x[0] for x in lazy_pinyin(t) if x)

rows = []
for n in sorted(set(names)):
    f, a = py_full(n), py_ini(n)
    if not f:
        continue
    rows.append((n, f + "|" + a))

head = ("/* 学通 · 名称拼音索引（由 tools/gen_py.py 生成，勿手改）\n"
        "   用途：输入 mao / mzd / zibenlun 也能搜到中文条目。\n"
        "   重新生成：python3 tools/gen_py.py（加书、加人物后务必重跑）*/\n")
body = "window.SITE_PY = {" + ",\n".join(
    json.dumps(k, ensure_ascii=False) + ":" + json.dumps(v, ensure_ascii=False) for k, v in rows) + "};\n"
open(OUT, "w", encoding="utf-8").write(head + body)
print(f"✓ 已写入 {OUT}：{len(rows)} 条")
