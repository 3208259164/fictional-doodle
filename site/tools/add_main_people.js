#!/usr/bin/env node
/* =====================================================================
   学通 · 主图谱人物补充（幂等）
   0.16.95：加入 尼基塔·赫鲁晓夫 / 列昂尼德·勃列日涅夫（中苏论战、反修防修绕不开的两位）
   —— 主图谱与「世界图谱」同时加（世界图谱另带经纬度），并同步拼音索引 data/py.js。
   用法：node tools/add_main_people.js
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PEOPLE = [
  {
    id: 'khrushchev', name: '尼基塔·赫鲁晓夫', type: 'person',
    years: '1894—1971', role: '苏共中央第一书记（1953—1964）· 部长会议主席',
    desc: '斯大林逝世后出任苏共中央第一书记。1956 年在苏共二十大上作《关于个人崇拜及其后果》报告，全盘否定斯大林；提出「和平过渡、和平共处、和平竞赛」与「全民国家、全民党」，1961 年苏共二十二大通过宣称二十年建成共产主义的新党纲。1962 年古巴导弹危机中与美对峙后撤走导弹，1964 年 10 月被解除职务。中苏分歧在其任内由内部争论演为全面公开论战。',
    points: [
      '1956 年苏共二十大作「秘密报告」，全盘否定斯大林',
      '提出「三和两全」，1961 年二十二大通过新党纲',
      '1960 年布加勒斯特会议组织对中共代表团围攻',
      '1962 年古巴导弹危机，1964 年 10 月被解职'
    ],
    works: ['关于个人崇拜及其后果', '赫鲁晓夫回忆录'],
    tags: ['赫鲁晓夫', 'khrushchev', '苏联', '现代修正主义'],
    source: '《赫鲁晓夫回忆录》；《国际共产主义运动史》', sourceLevel: 'collection',
    geo: [37.62, 55.75], place: '苏联·莫斯科',
    links: [
      ['cpsu', '领导'], ['stalin', '批判个人崇拜'], ['mao', '分歧 · 论战'], ['revisionism', '现代修正主义']
    ]
  },
  {
    id: 'brezhnev', name: '列昂尼德·勃列日涅夫', type: 'person',
    years: '1906—1982', role: '苏共中央总书记（1964—1982）',
    desc: '1964 年 10 月接任苏共中央第一书记（后改称总书记），执政至 1982 年。任内苏联军备急剧扩张，对外提出「有限主权论」「社会主义大家庭论」，1968 年出兵捷克斯洛伐克，1969 年与中国在珍宝岛发生武装冲突，1979 年出兵阿富汗；对内宣称建成「发达社会主义」，经济体制趋于停滞。中苏国家关系在其任内长期对抗。',
    points: [
      '1964 年 10 月接任苏共领导，执政至 1982 年',
      '提出「有限主权论」「社会主义大家庭论」',
      '1968 年出兵捷克斯洛伐克，1969 年珍宝岛冲突',
      '1979 年出兵阿富汗；对内称「发达社会主义」'
    ],
    works: ['遵循列宁主义的方针'],
    tags: ['勃列日涅夫', 'brezhnev', '苏联', '有限主权论'],
    source: '《苏联共产党历史》；《国际共产主义运动史》', sourceLevel: 'collection',
    geo: [37.62, 55.75], place: '苏联·莫斯科',
    links: [
      ['cpsu', '领导'], ['khrushchev', '接任'], ['mao', '对抗'], ['revisionism', '延续']
    ]
  }
];

const PY = { '尼基塔·赫鲁晓夫': 'nikitaheluxiaofu|nthlxf', '赫鲁晓夫': 'heluxiaofu|hlxf',
             '列昂尼德·勃列日涅夫': 'lieangnidebolieniefu|landblnf', '勃列日涅夫': 'bolieniefu|blnf' };

function loadJSON(file, globalName) {
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf(globalName);
  const body = src.slice(i);
  return { head: src.slice(0, i), G: JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) };
}
function saveJSON(file, globalName, head, G) {
  fs.writeFileSync(file, head + globalName + ' = ' + JSON.stringify(G, null, 2) + ';\n');
}

/* ---- 主图谱 ---- */
const FILE1 = path.join(ROOT, 'data', 'graph.js');
const m = loadJSON(FILE1, 'window.SITE_GRAPH');
let n1 = 0, l1 = 0, skip1 = 0;
PEOPLE.forEach(p => {
  if (m.G.nodes.some(x => x.id === p.id)) { skip1++; return; }
  const node = Object.assign({}, p);
  delete node.links; delete node.geo; delete node.place;
  m.G.nodes.push(node); n1++;
  (p.links || []).forEach(([tid, rel]) => {
    if (!m.G.nodes.some(x => x.id === tid)) { console.warn('⚠ 主图谱缺端点 ' + tid); return; }
    m.G.links.push({ source: p.id, target: tid, rel: rel }); l1++;
  });
});
saveJSON(FILE1, 'window.SITE_GRAPH', m.head, m.G);

/* ---- 世界图谱（带经纬度） ---- */
const FILE2 = path.join(ROOT, 'data', 'graph-world.js');
const w = loadJSON(FILE2, 'window.SITE_GRAPH_WORLD');
let n2 = 0, l2 = 0, skip2 = 0;
PEOPLE.forEach(p => {
  if (w.G.nodes.some(x => x.id === p.id)) { skip2++; return; }
  const node = Object.assign({}, p);
  delete node.links;
  w.G.nodes.push(node); n2++;
  (p.links || []).forEach(([tid, rel]) => {
    if (!w.G.nodes.some(x => x.id === tid)) { console.warn('⚠ 世界图谱缺端点 ' + tid); return; }
    w.G.links.push({ source: p.id, target: tid, rel: rel }); l2++;
  });
});
saveJSON(FILE2, 'window.SITE_GRAPH_WORLD', w.head, w.G);

/* ---- 拼音索引 ---- */
const FILE3 = path.join(ROOT, 'data', 'py.js');
let pyAdd = 0;
{
  const src = fs.readFileSync(FILE3, 'utf8');
  const i = src.indexOf('window.SITE_PY');
  const head = src.slice(0, i);
  const body = src.slice(i);
  const P = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
  Object.keys(PY).forEach(k => { if (!P[k]) { P[k] = PY[k]; pyAdd++; } });
  fs.writeFileSync(FILE3, head + 'window.SITE_PY = ' + JSON.stringify(P, null, 0).replace(/","/g, '",\n"') + ';\n');
}

/* ---- 自检 ---- */
function check(file, name) {
  const g = loadJSON(file, name).G;
  const ids = new Set(g.nodes.map(x => x.id));
  const dangling = g.links.filter(l => !ids.has(l.source) || !ids.has(l.target));
  const deg = {}; g.links.forEach(l => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
  const iso = g.nodes.filter(x => !deg[x.id]);
  const dup = g.nodes.map(x => x.id).filter((v, i, a) => a.indexOf(v) !== i);
  console.log(name + '：' + g.nodes.length + ' 节点 / ' + g.links.length + ' 关系 ｜ 悬空 ' + dangling.length + ' ｜ 孤立 ' + iso.length + ' ｜ 重复 ' + dup.length);
  return dangling.length + iso.length + dup.length;
}
console.log('主图谱新增 ' + n1 + ' 人 / ' + l1 + ' 条关系' + (skip1 ? '（跳过 ' + skip1 + '）' : ''));
console.log('世界图谱新增 ' + n2 + ' 人 / ' + l2 + ' 条关系' + (skip2 ? '（跳过 ' + skip2 + '）' : ''));
console.log('拼音新增 ' + pyAdd + ' 条');
process.exitCode = check(FILE1, 'window.SITE_GRAPH') + check(FILE2, 'window.SITE_GRAPH_WORLD') ? 1 : 0;
