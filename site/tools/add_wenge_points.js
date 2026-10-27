/* 给文革图谱补要点（points），并修 7 个只填了 id 的人物节点。
   要点口径：只写时间、职务、决议/文件、事件经过与处置结果等可核实事实；
   涉及评价的，注明出自哪份文献（如 1981 年《关于建国以来党的若干历史问题的决议》）。
   只补空字段，不覆盖已有内容；重复执行安全。 */
const fs = require('fs'), vm = require('vm');
const P = 'data/graph-wenge.js';
const src = fs.readFileSync(P, 'utf8');
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of fs.readdirSync('data').filter(x => x.endsWith('.js'))) {
  try { vm.runInContext(fs.readFileSync('data/' + f, 'utf8'), ctx, { filename: f }); } catch (e) {}
}
const W = ctx.window.SITE_GRAPH_WENGE;
const MAIN = (ctx.window.SITE_GRAPH || { nodes: [] }).nodes;

const PTS = Object.assign({},
  JSON.parse(fs.readFileSync('/tmp/wenge_pts1.json', 'utf8')),
  JSON.parse(fs.readFileSync('/tmp/wenge_pts2.json', 'utf8')));

/* ① 修残缺人物：从主图谱取中文名、生卒、身份、简介、出处 */
const BROKEN = ['mao', 'jiangqing', 'zhangchunqiao', 'yaowenyuan', 'wanghongwen', 'zhou_enlai', 'liu_shaoqi'];
let fixed = 0, fixedLog = [];
BROKEN.forEach(id => {
  const n = W.nodes.find(x => x.id === id);
  const m = MAIN.find(x => x.id === id);
  if (!n || !m) return;
  if (n.name === id || !n.desc) {
    n.name = m.name; n.years = m.years; n.role = m.role;
    n.desc = m.desc;
    if (m.source) n.source = m.source;
    if (m.works && !n.works) n.works = m.works;
    if (m.img && !n.img) n.img = m.img;
    fixed++; fixedLog.push(m.name);
  }
});

/* ② 补要点 */
let n1 = 0; const miss = [];
Object.keys(PTS).forEach(id => {
  const n = W.nodes.find(x => x.id === id);
  if (!n) { miss.push(id); return; }
  if (n.points && n.points.length) return;
  n.points = PTS[id]; n1++;
});

if (miss.length) console.warn('⚠ 图谱里没有这些 id：' + miss.join(' '));

/* 这个文件不是纯 JSON：前面有 IIFE、byName、links.push、地理落点等逻辑，
   最后才是 window.SITE_GRAPH_WENGE={...}，末尾还有 })(); 收尾。
   截断时必须把「赋值之后的尾部代码」原样接回去，否则括号不配平、整个文件语法错误。 */
const cut = src.lastIndexOf('window.SITE_GRAPH_WENGE=');
const tailAt = src.lastIndexOf('})();');
const tail = (tailAt > cut) ? src.slice(tailAt) : '';
fs.writeFileSync(P, src.slice(0, cut) + 'window.SITE_GRAPH_WENGE=' + JSON.stringify(W) + ';\n' + tail);

const no = W.nodes.filter(n => !n.points || !n.points.length);
const chars = W.nodes.reduce((a, n) => a + (n.points || []).reduce((b, s) => b + s.length, 0), 0);
console.log('✅ 修人物节点 ' + fixed + ' 个：' + fixedLog.join('、'));
console.log('✅ 补要点 ' + n1 + ' 个节点 → 覆盖 ' + (W.nodes.length - no.length) + '/' + W.nodes.length);
console.log('   要点总字数 ' + chars.toLocaleString() + '，平均 ' + Math.round(chars / W.nodes.length) + ' 字/节点');
if (no.length) console.log('   仍缺要点：' + no.map(x => x.id).join(' '));
