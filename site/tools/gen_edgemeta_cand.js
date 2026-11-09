#!/usr/bin/env node
/* 生成 edge-meta 候选：按两端节点的存续年份推导关系的有效区间
 *
 * 逻辑：一条边的两端节点都标了 y0/y1 时，节点存续区间之交可作为
 * 「这条关系可能成立的时间窗」的**候选**（不等于事实，故输出 c:1）。
 * 只列尚未标注过的边；两端年份无交集或缺失的跳过。
 *
 * 用法：node tools/gen_edgemeta_cand.js [数量]
 * 输出：_edgemeta_cand.json（供人工审阅后并入 data/edge-meta.js）
 */
const fs = require('fs');
const path = require('path');
global.window = {};
const site = path.dirname(__dirname);
['graph.js', 'graph-wenge.js', 'graph-world.js', 'edge-meta.js'].forEach(f => { try { require(path.join(site, 'data', f)); } catch (e) {} });

const N = Number(process.argv[2] || 80);
const META = window.SITE_EDGE_META || {};
const nodes = {}, links = [];
[['SITE_GRAPH', 'main'], ['SITE_GRAPH_WENGE', 'wenge'], ['SITE_GRAPH_WORLD', 'world']].forEach(([g, ds]) => {
  const G = window[g]; if (!G) return;
  (G.nodes || []).forEach(n => { if (!nodes[n.id]) nodes[n.id] = n; });
  (G.links || []).forEach(l => links.push({ ...l, ds }));
});

const cand = [];
links.forEach(l => {
  const key = l.source + '|' + l.target + '|' + (l.rel || '');
  if (META[key]) return;
  const a = nodes[l.source], b = nodes[l.target];
  if (!a || !b) return;
  const y0 = Math.max(a.y0 || 0, b.y0 || 0), y1 = Math.min(a.y1 || 0, b.y1 || 0);
  if (!y0 || !y1 || y1 < y0) return;
  /* 只挑「组织/事件」参与的边：这类关系的起止最可能跟节点存续一致 */
  const topical = /org|event/.test(a.type || '') || /org|event/.test(b.type || '');
  cand.push({
    key, a: a.name, b: b.name, rel: l.rel, t: [y0, y1],
    score: (l.ds === 'wenge' ? 6 : 0) + (topical ? 2 : 1) + (a.type === 'org' || b.type === 'org' ? 1 : 0) + (y1 - y0 >= 2 ? 1 : 0)
  });
});
cand.sort((x, y) => y.score - x.score);
const out = cand.slice(0, N);
fs.writeFileSync(path.join(site, 'tools', '_edgemeta_cand.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('候选', out.length, '条（未标注边总数', links.length - Object.keys(META).length, '）');
out.slice(0, 25).forEach(c => console.log(' ', c.key, '→', c.t.join('—'), '|', c.a, c.rel, c.b));
