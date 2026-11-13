#!/usr/bin/env node
/**
 * 学通 · 出处覆盖体检（节点 + 关系边）
 *
 * 为什么单独做一份：门禁里的 validate_data / audit_data 只管「结构与引用」，
 * 不回答「每条陈述依据什么材料」。2026-11-07 排查问答证据链时发现：
 *   · 节点级出处：主 / 文革 / 世界 100%，旧民 / 新民 曾低到 18% / 24%（已补 general 级）
 *   · 关系边：1360 条，带 src 的 0 条 —— 问答能给的「依据」只能核到条目，核不到这条关系
 *
 * 这个脚本只报告，不改数据（退出码恒 0）。
 *
 * 用法：
 *   node tools/src_report.js                # 打印汇总 + 待补边前 30 条
 *   node tools/src_report.js --limit 200    # 打印前 200 条
 *   node tools/src_report.js --md out.md    # 额外输出 markdown 待补清单
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const LIMIT = Number((argv[argv.indexOf('--limit') + 1] || 30)) || 30;
const MD = argv.indexOf('--md') >= 0 ? argv[argv.indexOf('--md') + 1] : '';

const ctx = { window: {}, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
/* graph-old / graph-new 会顺手改写 window.SITE_GRAPH，必须排在 graph.js 之前，
   否则主图谱那一行统计的是新民图谱的数据。 */
['graph-old.js', 'graph-new.js', 'graph.js', 'graph-wenge.js', 'graph-world.js', 'edge-meta.js'].forEach((f) => {
  const p = path.join(ROOT, 'data', f);
  if (fs.existsSync(p)) {
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx); } catch (e) { console.log('跳过 ' + f + '：' + e.message); }
  }
});

const SETS = [
  ['SITE_GRAPH', '主图谱'],
  ['SITE_GRAPH_OLD', '旧民图谱'],
  ['SITE_GRAPH_NEW', '新民图谱'],
  ['SITE_GRAPH_WENGE', '文革图谱'],
  ['SITE_GRAPH_WORLD', '世界图谱'],
];

function hasSrc(n) {
  if (!n) return false;                    /* 边的端点可能在别的图谱里，取不到是常态 */
  return !!(n.source || (n.sources && n.sources.length) || (typeof n.sources === 'string' && n.sources));
}
function nodeSrc(n) {
  if (!n) return '';
  if (n.source) return String(n.source);
  if (Array.isArray(n.sources)) return n.sources.filter(Boolean).join('；');
  if (typeof n.sources === 'string') return n.sources;
  return '';
}

const rows = [];
const edgeGap = [];
let totalGeneric = 0;

SETS.forEach(([key, label]) => {
  const G = ctx.window[key];
  if (!G || !G.nodes) return;
  const N = G.nodes, L = G.links || [];
  const covered = N.filter(hasSrc);
  const generic = N.filter((n) => n.sourceLevel === 'general').length;
  totalGeneric += generic;
  const deg = {};
  L.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    deg[s] = (deg[s] || 0) + 1;
    deg[t] = (deg[t] || 0) + 1;
  });
  const byId = {};
  N.forEach((n) => { byId[n.id] = n; });
  L.forEach((l) => {
    if (l.src || l.source_ref || l.ref) return;
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    const A = byId[s], B = byId[t];
    edgeGap.push({
      graph: label, from: (A && A.name) || s, to: (B && B.name) || t, rel: l.rel || '',
      weight: (deg[s] || 0) + (deg[t] || 0),
      hint: [nodeSrc(A), nodeSrc(B)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('；'),
    });
  });
  rows.push({
    label, nodes: N.length, covered: covered.length,
    pct: (covered.length / N.length * 100).toFixed(1),
    generic, links: L.length, linkSrc: L.filter((l) => l.src || l.source_ref || l.ref).length,
  });
});

const tn = rows.reduce((s, r) => s + r.nodes, 0);
const tc = rows.reduce((s, r) => s + r.covered, 0);
const tl = rows.reduce((s, r) => s + r.links, 0);
const tls = rows.reduce((s, r) => s + r.linkSrc, 0);

console.log('\n学通 · 出处覆盖体检\n');
console.log('| 图谱 | 节点 | 有出处 | 覆盖率 | 其中 general（文献级通说） | 关系边 | 边带出处 |');
console.log('|---|---|---|---|---|---|---|');
rows.forEach((r) => {
  console.log(`| ${r.label} | ${r.nodes} | ${r.covered} | ${r.pct}% | ${r.generic} | ${r.links} | ${r.linkSrc} |`);
});
console.log(`| **合计** | ${tn} | ${tc} | ${(tc / tn * 100).toFixed(1)}% | ${totalGeneric} | ${tl} | ${tls} |`);
console.log(`\n节点出处缺口：${tn - tc} 个 ｜ 关系边出处缺口：${tl - tls} 条`);
console.log(`general 的含义：依据出自该书目的通行叙述，未逐条核到页码/章节。`);


/* ---------------- 出处分层（2026-11-13） ----------------
   一个「覆盖率 92%」藏了四种强度完全不同的东西：
     · 关系级：这条边本身有出处（含 edge-meta 标注的原文直述 / 有明确出处）
     · 节点级：只能核到两端人物/组织的条目文献，不能证明这条关系
     · 待核  ：edge-meta 标成 c=1 的推断，或者干脆什么都没有
   混在一起看会误判「可核对」。这里分开计数，门禁只守「关系级不下降」。 */
const META = ctx.window.SITE_EDGE_META || {};
let lvSelf = 0, lvMeta = 0, lvC3 = 0, lvC2 = 0, lvC1 = 0, lvNode = 0, lvNone = 0, edgeAll = 0;
SETS.forEach(([key]) => {
  const G = ctx.window[key];
  if (!G) return;
  const N = G.nodes || [], L = G.links || [];
  const byId = {};
  N.forEach((n) => { byId[n.id] = n; });
  L.forEach((l) => {
    edgeAll++;
    if (l.src || l.source_ref || l.ref) { lvSelf++; return; }
    const rel = l.rel || '';
    const m = META[l.source + '|' + l.target + '|' + rel] || META[l.target + '|' + l.source + '|' + rel];
    if (m && (m.c || 0) >= 2) { lvMeta++; if (m.c === 3) lvC3++; else lvC2++; return; }
    if (m && m.c === 1) { lvC1++; return; }
    if (hasSrc(byId[l.source]) || hasSrc(byId[l.target])) { lvNode++; return; }
    lvNone++;
  });
});
const lvEdge = lvSelf + lvMeta;
console.log(`\n出处分层：关系级 ${lvEdge} 条（自带出处 ${lvSelf} / 标注 ${lvMeta}，其中原文直述 ${lvC3}、有明确出处 ${lvC2}）`
  + `｜ 节点级 ${lvNode} 条 ｜ 待核 ${lvC1 + lvNone} 条（标注为推断 ${lvC1} / 无任何出处 ${lvNone}）｜ 边 ${edgeAll} 条`);
console.log(`关系级覆盖率：${(lvEdge / edgeAll * 100).toFixed(1)}%（这才是「可核对」的分母口径）`);

edgeGap.sort((a, b) => b.weight - a.weight);
console.log(`\n待补关系边（按两端度数排序，共 ${edgeGap.length} 条，显示前 ${LIMIT} 条）：\n`);
edgeGap.slice(0, LIMIT).forEach((e, i) => {
  console.log(`${String(i + 1).padStart(3)}. [${e.graph}] ${e.from} —[${e.rel}]→ ${e.to}   候选：${e.hint || '（两端也无出处）'}`);
});

if (MD) {
  const out = ['# 待补关系边清单（按两端度数排序）\n',
    `> 生成：node tools/src_report.js --limit 500 --md\n> 共 ${edgeGap.length} 条边缺 src。「候选」是两端节点的出处，只能作为标 src 时的线索，不是这条关系的依据。\n`,
    '| # | 图谱 | 源 | 关系 | 目标 | 候选出处 |', '|---|---|---|---|---|---|'];
  edgeGap.slice(0, Math.max(LIMIT, 500)).forEach((e, i) => {
    out.push(`| ${i + 1} | ${e.graph} | ${e.from} | ${e.rel} | ${e.to} | ${e.hint || '—'} |`);
  });
  fs.writeFileSync(MD, out.join('\n'), 'utf8');
  console.log('\n已写出：' + MD);
}
