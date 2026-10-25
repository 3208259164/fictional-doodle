#!/usr/bin/env node
/* =====================================================================
   link_world_events.js —— 让「世界图谱事件」与「史料 · 重大事件」不再是两份各写一遍的文案

   背景：同一事件在两处存在
     · data/knowledge.js 的 SITE_EXTRA.events —— 史料 → 重大事件（背景 / 要点 / 影响 / 相关人物）
     · data/graph-world.js 的 SITE_GRAPH_WORLD —— 世界图谱的事件节点（带经纬度与关系连线）
   有 19 个事件两处都写了描述，且内容不一致，改一处忘另一处。

   做法（幂等，可重复执行）：
     · 世界图谱事件节点的 desc / points 统一取 SITE_EXTRA.events 的文本（史料为唯一文本真源）
     · 标记 ex:true —— 表示「完整记述在史料 → 重大事件」，graph.html 据此给出跳转
   世界图谱独有的那部分事件（国际共运、苏东、亚非拉等）原样保留。

   ⚠️ knowledge.js 里除了 SITE_EXTRA 主对象，后面还有追加字段与一段 IIFE（追加 events），
      不能整体 JSON 化重写 —— 所以本脚本**只写 graph-world.js**，knowledge.js 只读。
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const F_WORLD = path.join(ROOT, 'data/graph-world.js');
const F_KNOW = path.join(ROOT, 'data/knowledge.js');

function loadWindow(file, key) {
  const src = fs.readFileSync(file, 'utf8');
  const w = {};
  /* 数据文件是纯声明式脚本，没有副作用；用 window 沙箱执行比正则切 JSON 稳 */
  new Function('window', src)(w);
  return w[key];
}

/* ---- 读（不写）史料事件 ---- */
const EXTRA = loadWindow(F_KNOW, 'SITE_EXTRA');
const exByName = {};
(EXTRA.events || []).forEach(function (e) { if (e && e.name) exByName[e.name] = e; });

/* ---- 读世界图谱原文，保留头部注释 ---- */
const src = fs.readFileSync(F_WORLD, 'utf8');
const key = 'window.SITE_GRAPH_WORLD';
const at = src.indexOf(key);
if (at < 0) throw new Error('找不到 ' + key);
const head = src.slice(0, at);
const W = loadWindow(F_WORLD, 'SITE_GRAPH_WORLD');

let touched = 0, marked = 0, worldOnly = 0;
(W.nodes || []).forEach(function (n) {
  if (!n || n.type !== 'event' || !n.name) return;
  const e = exByName[n.name];
  if (!e) { worldOnly++; return; }
  const before = JSON.stringify([n.desc, n.points]);
  if (e.desc) n.desc = e.desc;                                  /* 文本真源：史料 */
  if (Array.isArray(e.points) && e.points.length) n.points = e.points.slice();
  if (!n.ex) { n.ex = true; marked++; }
  if (JSON.stringify([n.desc, n.points]) !== before) touched++;
});

/* 自检：不得有悬空关系 */
const ids = new Set((W.nodes || []).map(function (n) { return n.id; }));
let dangling = 0;
(W.links || []).forEach(function (l) { if (!ids.has(l.source) || !ids.has(l.target)) dangling++; });

fs.writeFileSync(F_WORLD, head + key + ' = ' + JSON.stringify(W, null, 2) + ';\n', 'utf8');

const evCount = (W.nodes || []).filter(function (n) { return n.type === 'event'; }).length;
console.log('== 世界图谱事件与史料对齐 ==');
console.log('  事件节点 ' + evCount + ' 个');
console.log('  与史料同名、文本已统一 ' + touched + ' 个');
console.log('  新标记 ex ' + marked + ' 个');
console.log('  世界图谱独有（保留原文）' + worldOnly + ' 个');
console.log('  悬空关系 ' + dangling + ' 条');
if (dangling) process.exitCode = 1;
