#!/usr/bin/env node
/* 学通 · 重复内容检测
   ---------------------------------------------------------------------
   audit_code.js 查的是「函数有没有调用、id 有没有重复、CSS 类有没有引用」，
   不查「同一件事是不是被写了两遍」。这个脚本补上：
     1. 实体跨库同名（人物/组织/概念/学派/地名/会议）
     2. 名称高度相似（包含关系且长度接近）
     3. 书库同名书（含去掉括号后缀后同名）
     4. 事件同名 / 同义（含年份+名称双键）
     5. 重复实现的辅助函数（toast / esc 系列）
   用法：node site/tools/detect_dup.js [站点目录]
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..'));
function run(files) {
  const sb = { window: {}, console: { log() {}, warn() {}, error() {}, info() {} } };
  sb.window.window = sb.window;
  vm.createContext(sb);
  files.forEach(f => {
    const p = path.join(SITE, f);
    if (!fs.existsSync(p)) return;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f }); } catch (e) { /* 依赖缺失时跳过 */ }
  });
  return sb.window;
}
const W = run([
  'data/graph.js', 'data/graph-wenge.js', 'data/graph-world.js', 'data/graph-old.js', 'data/graph-new.js',
  'data/concepts.js', 'data/places.js', 'data/meetings.js', 'data/papers.js',
  'data/knowledge.js', 'data/graph-extra.js', 'data/events-extra.js', 'data/glossary.js', 'data/resources.js'
]);

const ent = [];   // {name, kind, src}
const push = (arr, kind, src, key) => (arr || []).forEach(x => {
  const n = x && (x.name || x.title);
  if (n) ent.push({ name: String(n).trim(), kind, src, obj: x });
});
push((W.SITE_GRAPH || {}).nodes, '人物/思想/组织', 'graph.js');
push((W.SITE_GRAPH_WENGE || {}).nodes, '文革图谱', 'graph-wenge.js');
push((W.SITE_GRAPH_WORLD || {}).nodes, '世界图谱', 'graph-world.js');
push((W.SITE_CONCEPTS || {}).nodes, '概念', 'concepts.js');
push(W.SITE_PLACES, '地名', 'places.js');
push(W.SITE_MEETINGS, '会议', 'meetings.js');
push(W.SITE_PAPERS, '报刊', 'papers.js');
push((W.SITE_EXTRA || {}).critics, '被批判', 'knowledge.js');
((W.SITE_EXTRA || {}).schools || []).forEach(g => push(g.items, '思想/组织条目', 'knowledge.js'));
((W.SITE_EXTRA || {}).features || []).forEach(f => push([f], '专题', 'knowledge.js'));
push(W.SITE_GLOSSARY, '术语', 'glossary.js');

/* ---------- 1. 跨库同名 ---------- */
const byName = {};
ent.forEach(e => (byName[e.name] = byName[e.name] || []).push(e));
const sameName = Object.keys(byName).filter(k => byName[k].length > 1);

/* ---------- 2. 高度相似（包含且长度差 ≤3） ---------- */
const names = Object.keys(byName);
const similar = [];
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    if (a === b) continue;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    if (s.length < 3) continue;
    if (l.indexOf(s) >= 0 && l.length - s.length <= 3) similar.push([a, b]);
  }
}

/* ---------- 3. 书库同名 ---------- */
const books = (W.SITE_RESOURCES || []).filter(Boolean);
const norm = t => String(t || '').replace(/[（(].*?[）)]/g, '').replace(/[\s·・]/g, '').toLowerCase();
const bmap = {};
books.forEach(b => { const k = norm(b.title); (bmap[k] = bmap[k] || []).push(b); });
const dupBooks = Object.keys(bmap).filter(k => bmap[k].length > 1);

/* ---------- 4. 事件重复 ---------- */
/* 注意：events-extra.js 末尾会把自己的内容 push 进 SITE_EXTRA.events，
   所以「SITE_EXTRA.events + SITE_EVENTS_EXTRA」相加会把扩容批算两遍
   （第一版就这样得出「375 组同名」的假结论）。这里按 name+year 去重。 */
const evs = [];
const evSeen = new Set();
const addEv = (e, src) => {
  if (!e || !e.name) return;
  const k = String(e.year || '') + '|' + e.name;
  if (evSeen.has(k)) return;
  evSeen.add(k); evs.push({ e, src });
};
((W.SITE_EXTRA || {}).events || []).forEach(e => addEv(e, 'knowledge.js'));
(W.SITE_EVENTS_EXTRA || []).forEach(e => addEv(e, 'events-extra.js'));
const evName = {};
const evKey = {};
evs.forEach(({ e, src }) => {
  if (!e || !e.name) return;
  (evName[e.name] = evName[e.name] || []).push(src);
  const k = String(e.year || '').slice(0, 4) + '|' + String(e.name).replace(/[「」《》]/g, '');
  (evKey[k] = evKey[k] || []).push(src);
});
const dupEvName = Object.keys(evName).filter(k => evName[k].length > 1);
const dupEvKey = Object.keys(evKey).filter(k => evKey[k].length > 1);
/* 同一年份、名称互相包含（如「俄国1905年革命 / 俄国第一次革命」这类抓不到，只抓包含型） */
const evNames = Array.from(new Set(evs.map(x => x.e && x.e.name).filter(Boolean)));
const evSimilar = [];
for (let i = 0; i < evNames.length; i++) {
  for (let j = i + 1; j < evNames.length; j++) {
    const a = evNames[i], b = evNames[j];
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    if (s.length < 4) continue;
    if (l.indexOf(s) >= 0 && l.length - s.length <= 4) evSimilar.push([a, b]);
  }
}

/* ---------- 5. 重复实现的辅助函数 ---------- */
const asFiles = fs.readdirSync(path.join(SITE, 'assets')).filter(f => f.endsWith('.js'));
const fnDefs = {};
['toast', 'esc', 'escHtml', 'escAttr', 'esc2', 'escA2', 'hl', 'clone', 'uid'].forEach(fn => { fnDefs[fn] = []; });
asFiles.forEach(f => {
  const src = fs.readFileSync(path.join(SITE, 'assets', f), 'utf8');
  Object.keys(fnDefs).forEach(fn => {
    const re = new RegExp('function\\s+' + fn + '\\s*\\(', 'g');
    if (re.test(src)) fnDefs[fn].push(f);
  });
});
const dupFn = Object.keys(fnDefs).filter(k => fnDefs[k].length > 1);

/* ---------- 输出 ---------- */
const line = (t) => console.log(t);
line('实体总数 ' + ent.length + '（' + names.length + ' 个不同名称）｜ 书库 ' + books.length + ' ｜ 事件 ' + evs.length);
line('');
line('【1】跨库同名 ' + sameName.length + ' 组');
sameName.slice(0, 25).forEach(k => line('  ' + k + '  ← ' + byName[k].map(x => x.kind + '(' + x.src + ')').join(' / ')));
if (sameName.length > 25) line('  …另有 ' + (sameName.length - 25) + ' 组');
line('');
line('【2】名称高度相似（包含且长度接近）' + similar.length + ' 组');
similar.slice(0, 20).forEach(([a, b]) => line('  ' + a + '  ≈  ' + b));
if (similar.length > 20) line('  …另有 ' + (similar.length - 20) + ' 组');
line('');
line('【3】书库同名（去括号后比较）' + dupBooks.length + ' 组');
dupBooks.forEach(k => line('  ' + bmap[k].map(b => b.title + ' [' + b.id + ']').join('  /  ')));
line('');
line('【4】事件重复：完全同名 ' + dupEvName.length + ' 组，年份+名称同键 ' + dupEvKey.length + ' 组');
dupEvName.slice(0, 10).forEach(k => line('  同名 ' + k + ' ← ' + evName[k].join('+')));
dupEvKey.slice(0, 10).forEach(k => { if (!evName[k.split('|')[1]]) line('  同年同键 ' + k + ' ← ' + evKey[k].join('+')); });
line('  名称包含型 ' + evSimilar.length + ' 组');
evSimilar.slice(0, 15).forEach(([a, b]) => line('    ' + a + '  ≈  ' + b));
if (evSimilar.length > 15) line('    …另有 ' + (evSimilar.length - 15) + ' 组');
line('');
line('【5】重复实现的辅助函数 ' + dupFn.length + ' 个');
dupFn.forEach(k => line('  ' + k + '：' + fnDefs[k].join(', ')));
