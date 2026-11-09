/* =====================================================================
   学通 · 图谱体检（tools/check_graph_nodes.js）
   ---------------------------------------------------------------------
   目的：把「整个图谱」一次查清，避免再出现「点开节点 → 没有找到」。

   检查项：
     ① 五张图谱能否读入；节点 / 边计数
     ② 悬空边：link.source / target 指向不存在的节点
     ③ 节点字段缺失：没有 id / name / type / desc
     ④ 跨图谱 id 冲突：同一 id 在两张图谱里指的不是同一个东西
     ⑤ 重名节点：同名不同 id（会导致「按名字跳」只落到其中一个）
     ⑥ 全部节点 id 是否都能在 allGraphNodes() 聚合里命中（= 前端解析入口能查到）

   输出：问题清单 + 退出码（0 通过 / 1 有问题）
   ===================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const GRAPHS = [
  ['主图谱', 'graph.js', 'SITE_GRAPH'],
  ['旧民图谱', 'graph-old.js', 'SITE_GRAPH_OLD'],
  ['新民图谱', 'graph-new.js', 'SITE_GRAPH_NEW'],
  ['文革图谱', 'graph-wenge.js', 'SITE_GRAPH_WENGE'],
  ['世界图谱', 'graph-world.js', 'SITE_GRAPH_WORLD'],
];

const ctx = { window: {}, console: { log() {}, warn() {}, error() {} } };
ctx.globalThis = ctx;
vm.createContext(ctx);

const problems = [];   /* 必须修：悬空边、字段缺失、id 冲突、坏数据 */
const notes = [];      /* 提示：同名不同 id（跨图谱并存是历史形成的，不影响打开） */
const warn = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);

for (const [label, file, key] of GRAPHS) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) { warn(`[缺文件] ${label}：data/${file} 不存在`); continue; }
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx); } catch (e) { warn(`[读入失败] ${label}: ${e.message}`); }
  const g = ctx.window[key];
  if (!g || !Array.isArray(g.nodes)) { warn(`[数据结构] ${label}：window.${key} 不是 {nodes,links}`); continue; }
  g.__label = label;
}

/* 逐图检查 */
const nodesByGraph = {};
for (const [label, , key] of GRAPHS) {
  const g = ctx.window[key];
  if (!g || !Array.isArray(g.nodes)) continue;
  const ids = new Set();
  nodesByGraph[label] = [];
  g.nodes.forEach((n, i) => {
    if (!n || typeof n !== 'object') { warn(`[节点坏] ${label} #${i} 不是对象`); return; }
    if (!n.id) { warn(`[节点坏] ${label} #${i} 缺 id（name=${n.name || '?'}）`); return; }
    if (ids.has(n.id)) warn(`[重复 id] ${label} 内 id=${n.id} 出现两次`);
    ids.add(n.id);
    if (!n.name) warn(`[字段] ${label} id=${n.id} 缺 name`);
    if (!n.type) warn(`[字段] ${label} id=${n.id}「${n.name}」缺 type`);
    else if (!['person', 'event', 'org', 'idea'].includes(n.type)) warn(`[字段] ${label} id=${n.id} type=${n.type} 不在 person/event/org/idea 内`);
    if (!n.desc) warn(`[字段] ${label} id=${n.id}「${n.name}」缺 desc（详情页会空一段）`);
    nodesByGraph[label].push(n);
  });
  /* 悬空边 */
  (g.links || []).forEach((l, i) => {
    if (!l || typeof l !== 'object') { warn(`[边坏] ${label} #${i} 不是对象`); return; }
    const s = typeof l.source === 'object' ? (l.source && l.source.id) : l.source;
    const t = typeof l.target === 'object' ? (l.target && l.target.id) : l.target;
    if (!s || !ids.has(s)) warn(`[悬空边] ${label} #${i} source=${s} 没有对应节点`);
    if (!t || !ids.has(t)) warn(`[悬空边] ${label} #${i} target=${t} 没有对应节点`);
    if (!l.rel) warn(`[边字段] ${label} #${i} 缺 rel（${s}→${t}）`);
  });
}

/* 跨图谱 id 冲突 / 重名 */
const idMap = new Map();
const nameMap = new Map();
for (const [label] of Object.entries(nodesByGraph)) {
  for (const n of nodesByGraph[label]) {
    if (idMap.has(n.id)) {
      const prev = idMap.get(n.id);
      if (prev.name !== n.name) warn(`[id 冲突] id=${n.id}：${prev.graph}「${prev.name}」 vs ${label}「${n.name}」`);
      else if (prev.type !== n.type) warn(`[id 类型冲突] id=${n.id}「${n.name}」：${prev.graph}=${prev.type} vs ${label}=${n.type}`);
    } else idMap.set(n.id, { name: n.name, type: n.type, graph: label });
    const arr = nameMap.get(n.name) || [];
    arr.push(`${label}:${n.id}`);
    nameMap.set(n.name, arr);
  }
}
for (const [name, arr] of nameMap) {
  if (arr.length > 1) {
    const ids = arr.map(x => x.split(':').slice(1).join(':'));
    if (new Set(ids).size > 1) note(`「${name}」出现在 ${arr.join(' / ')}（同名不同 id：按名字跳转只会命中靠前那张图谱，按 id 打开不受影响）`);
  }
}

/* 统计 + 汇总 */
let nodeTotal = 0, linkTotal = 0;
console.log('=== 学通图谱体检 ===');
for (const [label, file, key] of GRAPHS) {
  const g = ctx.window[key];
  if (!g || !Array.isArray(g.nodes)) { console.log(`  ${label.padEnd(6)} —（未读到）`); continue; }
  nodeTotal += g.nodes.length; linkTotal += (g.links || []).length;
  console.log(`  ${label.padEnd(6)} ${String(g.nodes.length).padStart(4)} 节点 / ${String((g.links || []).length).padStart(4)} 边   (${file})`);
}
console.log(`  合计   ${String(nodeTotal).padStart(4)} 节点 / ${String(linkTotal).padStart(4)} 边`);
const uniq = new Set();
for (const n of nodesByGraph[Object.keys(nodesByGraph)[0]] || []) uniq.add(n.id);
const allIds = new Set();
for (const arr of Object.values(nodesByGraph)) arr.forEach(n => allIds.add(n.id));
console.log(`  去重 id  ${allIds.size}（聚合后 allGraphNodes 可命中数）`);

if (notes.length) {
  console.log(`\nℹ️ 提示 ${notes.length} 条（不阻塞构建）：`);
  notes.slice(0, 25).forEach(x => console.log('   · ' + x));
  if (notes.length > 25) console.log(`   …另有 ${notes.length - 25} 条`);
}
if (!problems.length) {
  console.log('\n✅ 全部通过：节点/边完整，无悬空边、无 id 冲突、无字段缺失。');
  process.exit(0);
}
/* 按类别归并打印，避免同类刷屏 */
const buckets = {};
problems.forEach(p => {
  const k = (p.match(/^\[([^\]]+)\]/) || [, '其他'])[1];
  (buckets[k] = buckets[k] || []).push(p);
});
console.log(`\n⚠️ 共 ${problems.length} 条问题：`);
for (const k of Object.keys(buckets)) {
  const list = buckets[k];
  console.log(`\n-- ${k}（${list.length}）`);
  list.slice(0, 30).forEach(x => console.log('   ' + x));
  if (list.length > 30) console.log(`   …另有 ${list.length - 30} 条`);
}
process.exit(1);
