/* 构建 data/graph3d.js —— 3 个 3D 数据集（通用框架的数据源）
   数据集：① 思想谱系  ② 全景星云  ③ 文献·人物著作影响网
   用法：node tools/build_graph3d.js */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'data');
global.window = {};
for (const f of ['config.js', 'content.js', 'graph.js', 'graph-wenge.js', 'resources.js']) {
  const p = path.join(dir, f);
  if (fs.existsSync(p)) (0, eval)(fs.readFileSync(p, 'utf8'));
}
const W = global.window, G = W.SITE_GRAPH;
const CMAP = { person: '#7ec8ff', idea: '#c792ea', org: '#8de6a1', work: '#ffb454', event: '#ffd166' };
const VAL = { person: 5, idea: 3, org: 3, work: 2, event: 2 };
const LINE = /影响|受其影响|继承|发展|创立|共同创立|奠立|阐释|奠基|源流|前身|领导/;
const POS = /影响|继承|发展|奠基|奠立|创立|阐释|源流|前身/;

function node(n) {
  return { id: n.id, name: n.name, type: n.type, val: VAL[n.type] || 2, color: n.color || CMAP[n.type] || '#9aa0a6',
    years: n.years || '', role: n.role || '', desc: n.desc || '', img: n.img || '' };
}
function link(l, rel) { const o = { source: l.source, target: l.target, rel: rel || l.rel || '' }; if (l.src) o.src = l.src; return o; }

/* ① 思想谱系：只取“正面传承/影响”关系（排除批判/对立） */
const lNodes = new Set(), lLinks = [];
G.links.forEach(l => { if (LINE.test(l.rel) && !/批判|对立|分歧|论战/.test(l.rel)) { lNodes.add(l.source); lNodes.add(l.target); lLinks.push(link(l)); } });
const lineage = { nodes: G.nodes.filter(n => lNodes.has(n.id)).map(node), links: lLinks };

/* ② 全景星云：全部节点与关系，边按关系正负着色 */
const nebula = {
  nodes: G.nodes.map(node),
  links: G.links.map(l => { const o = link(l); o.color = /批判|对立|分歧|论战|反对/.test(l.rel) ? '#ff6b6b' : 'rgba(150,150,180,.35)'; return o; })
};

/* ③ 文献·人物著作影响网：人物 + 其代表作 + 影响关系（含被影响/被创立的思想与组织）
   关键：关系必须“闭环”——端点若在节点表里找不到就会让 d3-force 抛 node not found
   并中断其余关系的解析（曾造成 26 条关系画不出来）。因此这里①过滤掉端点缺失的关系，
   ②把被影响关系指向的思想/组织一并纳入节点表，③最后删掉完全没有连线的孤立节点。 */
const byId = {}; G.nodes.forEach(n => { byId[n.id] = n; });
const nodes3 = [], seen3 = {}, links3 = [];
function push3(n) { if (!n || seen3[n.id]) return; seen3[n.id] = 1; nodes3.push(node(n)); }
G.nodes.filter(n => n.type === 'person').forEach(p => {
  push3(p);
  (p.works || []).forEach(w => {
    const wid = 'w:' + (w.length > 20 ? w.slice(0, 12) : w);
    if (!seen3[wid]) { seen3[wid] = 1; nodes3.push({ id: wid, name: w, type: 'work', val: 2, color: CMAP.work }); }
    links3.push({ source: p.id, target: wid, rel: '著作' });
  });
});
G.links.forEach(l => {
  if (!POS.test(l.rel) || /批判|对立|分歧|论战/.test(l.rel)) return;
  if (!byId[l.source] || !byId[l.target]) return;      // 端点缺失 → 丢弃，绝不让引擎抛错
  push3(byId[l.source]); push3(byId[l.target]);        // 思想/组织一同纳入，保证关系闭环
  links3.push(link(l));
});
const deg3 = {}; links3.forEach(l => { deg3[l.source] = (deg3[l.source] || 0) + 1; deg3[l.target] = (deg3[l.target] || 0) + 1; });
const citNodes = nodes3.filter(n => deg3[n.id]);      // 去掉没有任何连线的漂浮点
const citIds = {}; citNodes.forEach(n => { citIds[n.id] = 1; });
const citations = { nodes: citNodes, links: links3.filter(l => citIds[l.source] && citIds[l.target]) };

const out = {
  datasets: {
    nebula: { name: '全景星云', desc: '全部 ' + nebula.nodes.length + ' 个节点 · ' + nebula.links.length + ' 条关系', nodes: nebula.nodes, links: nebula.links },
    lineage: { name: '思想谱系', desc: '人物·思想·组织的传承与影响（' + lineage.nodes.length + ' 节点 / ' + lineage.links.length + ' 关系）', nodes: lineage.nodes, links: lineage.links },
    citations: { name: '文献·著作', desc: '人物—代表作—影响网络（含被影响的思想/组织）（' + citations.nodes.length + ' 节点 / ' + citations.links.length + ' 关系）', nodes: citations.nodes, links: citations.links }
  },
  colors: CMAP
};
fs.writeFileSync(path.join(dir, 'graph3d.js'), 'window.SITE_GRAPH3D = ' + JSON.stringify(out) + ';\n', 'utf8');
console.log('OK', Object.keys(out.datasets).map(k => k + ':' + out.datasets[k].nodes.length + '/' + out.datasets[k].links.length).join('  '));
