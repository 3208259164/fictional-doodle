/* 来源口径交叉一致性（2026-11-13）
   问题：`src_report` 算「关系级出处」用一套规则，问答 evidence 显示出处用另一套。
   两套规则各自看着都对，但没人证明它们在同一批边上得出同一个结论 ——
   Copilot 的评审提的正是这点。本测试把两边对起来跑：
     · src_report 用 --json 导出逐边归类（它自己的判定）；
     · 问答走真实的 ask()，取 evidence 的 srcLevel；
     · 同名同关系的边，两边结论必须一致。
   映射：edge-self / edge-meta → edge（关系级）；node → node；inferred / none → none。 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
const TMP = '/tmp/_src_layers.json';

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

/* ① 让 src_report 自己导出一份判定 */
try { fs.unlinkSync(TMP); } catch (e) {}
execFileSync('node', [path.join(SITE, 'tools/src_report.js'), '--limit', '1', '--json', TMP],
  { stdio: 'ignore', timeout: 180000 });
const LAYERS = JSON.parse(fs.readFileSync(TMP, 'utf8'));

/* ② 加载图谱数据 + 问答引擎 */
const ctx = { window: {}, console, document: {}, navigator: {}, setTimeout, clearTimeout };
ctx.window.window = ctx.window;
ctx.window.document = ctx.document;
ctx.globalThis = ctx;
vm.createContext(ctx);
['graph.js', 'graph-wenge.js', 'graph-world.js', 'graph-old.js', 'graph-new.js', 'edge-meta.js'].forEach(f => {
  try { vm.runInContext(fs.readFileSync(SITE + 'data/' + f, 'utf8'), ctx, { filename: f }); } catch (e) {}
});
vm.runInContext(fs.readFileSync(SITE + 'assets/qa-engine.js', 'utf8'), ctx, { filename: 'qa-engine.js' });
const Q = ctx.window.YZQA;

const NAME = {};
['SITE_GRAPH', 'SITE_GRAPH_WENGE', 'SITE_GRAPH_WORLD', 'SITE_GRAPH_OLD', 'SITE_GRAPH_NEW'].forEach(g => {
  const G = ctx.window[g]; if (!G || !G.nodes) return;
  G.nodes.forEach(n => { if (n.id && n.name) NAME[n.id] = n.name; });
});

console.log('===== 来源口径交叉一致性 =====');
ok('src_report 输出了逐边归类', Array.isArray(LAYERS.edges) && LAYERS.edges.length > 1000, LAYERS.edges.length + ' 条');
ok('问答引擎可用', !!(Q && Q.ask));

const MAP = { 'edge-self': 'edge', 'edge-meta': 'edge', node: 'node', inferred: 'none', none: 'none' };

/* ③ 每个分类取样本（优先两端都有中文名的边，否则问句解析不出来） */
const want = {
  'edge-meta': 3, 'edge-self': 2, node: 3, inferred: 2, none: 2
};
const picked = {};
for (const lv of Object.keys(want)) {
  picked[lv] = [];
  for (const e of LAYERS.edges) {
    if (e.lv !== lv) continue;
    if (!NAME[e.from] || !NAME[e.to]) continue;
    if (/[「」《》（）()·]/.test(NAME[e.from] + NAME[e.to])) continue;  /* 带符号的名字问句里分不清 */
    if (picked[lv].some(x => x.from === e.from && x.to === e.to)) continue;
    picked[lv].push(e);
    if (picked[lv].length >= want[lv]) break;
  }
}

let compared = 0, mismatch = 0;
const detail = [];
for (const lv of Object.keys(picked)) {
  for (const e of picked[lv]) {
    Q.use && Q.use('all');
    const q = NAME[e.from] + '和' + NAME[e.to] + '有什么关系';
    let r = null;
    try { r = Q.ask(q); } catch (err) { r = null; }
    const ev = ((r && r.evidence) || []).filter(x => x.kind === 'edge'
      && ((x.from === NAME[e.from] && x.to === NAME[e.to]) || (x.from === NAME[e.to] && x.to === NAME[e.from])));
    if (!ev.length) { detail.push(`${lv}: 问句未命中（${q}）—— 跳过`); continue; }
    const got = ev[0].srcLevel || 'none';
    const expect = MAP[lv];
    compared++;
    if (got !== expect) {
      mismatch++;
      detail.push(`✗ ${NAME[e.from]}→${NAME[e.to]}（${e.rel}）：报告 ${lv} 应为 ${expect}，问答给的是 ${got}`);
    }
  }
}

ok('至少比对了 6 条边', compared >= 6, compared + ' 条');
ok('两边口径一致（0 处冲突）', mismatch === 0, mismatch ? detail.filter(x => x.startsWith('✗')).join('；') : '全部一致');
if (detail.length) detail.slice(0, 6).forEach(d => console.log('    · ' + d));

/* ④ 反面校验：报告里「关系级 84 条」必须等于 layers 里 edge-self + edge-meta */
const nEdge = LAYERS.edges.filter(e => e.lv === 'edge-self' || e.lv === 'edge-meta').length;
ok('分层合计与逐边明细自洽', nEdge === (LAYERS.layers['edge-self'] + LAYERS.layers['edge-meta']),
  nEdge + ' vs ' + (LAYERS.layers['edge-self'] + LAYERS.layers['edge-meta']));

console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
process.exit(fail ? 1 : 0);
