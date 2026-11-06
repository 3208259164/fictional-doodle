/* 多图谱骨架功能测试：内置「文革图谱」应可切换、可读取、不可删除/改名 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://local.test/' });
const w = dom.window;
function ev(p) { w.eval(fs.readFileSync(path.join(SITE, p), 'utf8')); }

ev('data/graph.js');
ev('data/graph-wenge.js');
ev('assets/overlay.js');

let fail = 0;
function ok(name, cond, extra) { console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? (' — ' + extra) : '')); if (!cond) fail++; }

const YZY = w.YZY;
ok('暴露 YZY 接口', !!YZY && typeof YZY.listGraphs === 'function');

const list = YZY.listGraphs();
ok('listGraphs 含「主图谱」', list.some(g => g.id === 'main' && g.builtin));
ok('listGraphs 含内置「文革图谱」', list.some(g => g.id === 'wenge' && g.builtin), list.map(g => g.id + ':' + g.name).join(' | '));
const wg = list.find(g => g.id === 'wenge');
ok('文革图谱被标记 builtin:true', !!wg && wg.builtin === true);
ok('文革图谱计数随数据（≥20 节点）', !!wg && wg.nodes >= 20, wg && (wg.nodes + ' 节点 / ' + wg.links + ' 关系'));

const d = YZY.graphData('wenge');
ok('graphData(wenge) 返回文革图谱', d.id === 'wenge' && d.nodes.length >= 20, d.nodes.length + ' 节点 / ' + d.links.length + ' 关系');
ok('文革图谱含复用主图谱节点(mao)', d.nodes.some(n => n.id === 'mao' && n.name.indexOf('毛泽东') >= 0));
ok('文革图谱含专属节点(工总司)', d.nodes.some(n => n.id === 'gzs'));

const s = YZY.setActiveGraph('wenge');
ok('setActiveGraph(wenge) 成功', s && s.ok && YZY.activeGraphId() === 'wenge');
ok('setActiveGraph 拒绝不存在的图谱', (function () { const r = YZY.setActiveGraph('nope'); return r && r.ok === false; })());

const rn = YZY.renameGraph('wenge', 'x');
ok('内置图谱不可改名', rn && rn.ok === false);
const dg = YZY.deleteGraph('wenge');
ok('内置图谱不可删除', dg && dg.ok === false);
ok('文革图谱切回主图谱正常', YZY.setActiveGraph('main').ok === true);

console.log(fail === 0 ? '\n★ 多图谱骨架：全部通过' : ('\n★ 失败 ' + fail + ' 项'));
process.exit(fail === 0 ? 0 : 1);
