#!/usr/bin/env node
/* 生成实体词典 data/entity.js（P1：图增强检索的「实体链接」底座）
 *
 * 来源：概念库、三套图谱节点、资源书名与别名、术语表
 * 输出：window.SITE_ENTITY = [[名称, 类型, id, 别名串], ...]
 *   type: 概念 / 人物 / 组织 / 事件 / 思想 / 书 / 术语
 * 体积控制在 50KB 以内；同名的只留一条（先出现的优先，别名合并）。
 *
 * 用法：node tools/gen_entity.js
 */
const fs = require('fs');
const path = require('path');
const site = path.dirname(__dirname);
const D = f => path.join(site, 'data', f);

global.window = {};
function req(f) { try { require(D(f)); } catch (e) { console.error('skip', f, e.message); } }

req('concepts.js'); req('graph.js'); req('graph-wenge.js'); req('graph-world.js');
req('resources.js'); req('glossary.js');

const out = [];
const seen = Object.create(null);

function add(name, type, id, alias) {
  name = String(name || '').trim();
  if (!name || name.length > 40) return;
  const k = name;
  if (seen[k]) {
    if (alias) seen[k][3] = (seen[k][3] ? seen[k][3] + ' ' : '') + String(alias).slice(0, 80);
    return;
  }
  const row = [name, type, id || '', String(alias || '').slice(0, 120)];
  seen[k] = row;
  out.push(row);
}

// 概念
((window.SITE_CONCEPTS || {}).nodes || []).forEach(c => {
  add(c.name, '概念', c.id, (c.tags || []).slice(0, 4).join(' '));
});
// 三套图谱
[['SITE_GRAPH', 'main'], ['SITE_GRAPH_WENGE', 'wenge'], ['SITE_GRAPH_WORLD', 'world']].forEach(([g, ds]) => {
  const G = window[g]; if (!G) return;
  (G.nodes || []).forEach(n => {
    const t = n.type === 'person' ? '人物' : (n.type === 'org' ? '组织' : (n.type === 'event' ? '事件' : '思想'));
    add(n.name, t, n.id ? (n.id + '@' + ds) : '', '');
  });
});
// 书
(window.SITE_RESOURCES || []).forEach(r => {
  add(r.title, '书', r.id || '', r.alias || '');
});
// 术语表
(window.SITE_GLOSSARY || window.GLOSSARY || []).forEach(g => {
  const n = (g && (g.k || g.term || g.name)) || '';
  add(n, '术语', (g && g.k) || '', '');
});

const js = 'window.SITE_ENTITY = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(path.join(site, 'data/entity.js'), js, 'utf8');
console.log('实体', out.length, '条 ·', Buffer.byteLength(js), '字节');
const t = {}; out.forEach(r => t[r[1]] = (t[r[1]] || 0) + 1);
console.log('类型分布', JSON.stringify(t));
console.log('样例', JSON.stringify(out.slice(0, 3), null, 0));
