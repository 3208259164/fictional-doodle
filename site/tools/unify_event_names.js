#!/usr/bin/env node
/* =====================================================================
   学通 · 事件命名统一（幂等）
   ---------------------------------------------------------------------
   问题：同一件事在「史料事件」与「世界图谱」里用了两个名字。
   后果：搜索同一关键词出现两条；从史料点进去与从地图点进去是两套内容；
        互跳对不上（按名字找只能命中靠前那条）。
   做法：以史料（EX.events，搜索与列表的数据源）为准，把世界图谱那一侧的名字改过来，
        旧名保留在 alias 里，搜索仍能命中。
   只改 8 组已确认「同一事件」的；有角度差异的（如「苏共二十大与中苏分歧」
   特意强调分歧）不动。
   用法：node tools/unify_event_names.js
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 世界图谱 id → [统一后的名字, 旧名] */
const RENAME = {
  'ev_korea': ['抗美援朝战争', '抗美援朝'],
  'ev_algeria': ['阿尔及利亚独立战争', '阿尔及利亚独立'],
  'ev_oct': ['俄国十月革命', '十月革命'],
  'ev_intl2_collapse': ['第二国际瓦解', '第二国际破产'],
  'ev_nonaligned': ['不结盟运动兴起', '不结盟运动'],
  'ev_stalingrad': ['斯大林格勒战役', '斯大林格勒保卫战'],
  'ev_manifesto_cn': ['陈望道译《共产党宣言》全译本出版', '《共产党宣言》中文全译本出版']
};

const WF = path.join(ROOT, 'data', 'graph-world.js');
const raw = fs.readFileSync(WF, 'utf8');
const k = raw.lastIndexOf('window.SITE_GRAPH_WORLD');
const lb = raw.indexOf('{', k);
/* 括号配平（考虑字符串与转义），只替换赋值段，前面的加工逻辑原样保留 */
let depth = 0, inStr = false, escd = false, end = -1;
for (let i = lb; i < raw.length; i++) {
  const c = raw[i];
  if (inStr) {
    if (escd) escd = false;
    else if (c === '\\') escd = true;
    else if (c === '"') inStr = false;
  } else {
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
}
if (end < 0) { console.error('找不到 SITE_GRAPH_WORLD 对象边界'); process.exit(1); }
const head = raw.slice(0, lb), tail = raw.slice(end + 1);
const G = JSON.parse(raw.slice(lb, end + 1));

let n = 0;
const miss = [];
Object.keys(RENAME).forEach(id => {
  const node = (G.nodes || []).find(x => x.id === id);
  if (!node) { miss.push(id); return; }
  const target = RENAME[id][0], old = RENAME[id][1];
  if (node.name === target) return;
  const al = new Set(String(node.alias || '').split(/\s+/).filter(Boolean));
  al.add(old); al.add(node.name);
  node.alias = Array.from(al).join(' ');
  node.name = target;
  n++;
});
fs.writeFileSync(WF, head + JSON.stringify(G) + tail);

const w2 = fs.readFileSync(WF, 'utf8');
const k2 = w2.lastIndexOf('window.SITE_GRAPH_WORLD');
const b2 = w2.indexOf('{', k2);
const G2 = JSON.parse(w2.slice(b2, w2.lastIndexOf('}') + 1));
const ids = new Set((G2.nodes || []).map(x => x.id));
const dangling = (G2.links || []).filter(l => !ids.has(l.source) || !ids.has(l.target));
console.log('世界图谱改名 ' + n + ' 个' + (miss.length ? ('（未找到：' + miss.join(',') + '）') : ''));
console.log('世界图谱：' + G2.nodes.length + ' 节点 / ' + G2.links.length + ' 关系 ｜ 悬空 ' + dangling.length);
process.exitCode = dangling.length ? 1 : 0;
