/* 问答 evidence 消费 edge-meta（2026-11-13）
   背景：edge-meta.js 是关系时序/置信度的覆盖层，但问答引擎以前零引用 ——
   数据在校验器里，用户在答案里看不到。本测试锁住：
     · 关系级 evidence 带 span（1967—1979）与 conf（原文直述 / 有明确出处 / 推断待核）；
     · c≥2 且有 src 的标注算「关系级出处」，c=1 的推断不算；
     · 没有标注的边不会被凭空加上时效。 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
const ctx = { window: {}, console, document: {}, navigator: {}, setTimeout, clearTimeout };
ctx.window.window = ctx.window;
ctx.window.document = ctx.document;
ctx.globalThis = ctx;
vm.createContext(ctx);

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

['graph.js', 'graph-wenge.js', 'edge-meta.js', 'entity.js', 'bstruct.js'].forEach(f => {
  try { vm.runInContext(fs.readFileSync(SITE + 'data/' + f, 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log('  装载 ' + f + ' 失败：' + e.message.slice(0, 60)); }
});
vm.runInContext(fs.readFileSync(SITE + 'assets/qa-engine.js', 'utf8'), ctx, { filename: 'qa-engine.js' });
const Q = ctx.window.YZQA;

console.log('===== 问答 evidence × edge-meta =====');
ok('问答引擎已加载', !!(Q && Q.ask));

const META = ctx.window.SITE_EDGE_META || {};
ok('edge-meta 已加载', Object.keys(META).length > 0, Object.keys(META).length + ' 条标注');

if (Q && Q.ask) {
  Q.use && Q.use('wenge');

  /* ① 有 src + c=2 的标注 → 关系级出处 + 时效 + 置信度 */
  const r1 = Q.ask('毛泽东和三支两军什么关系');
  const e1 = (r1.evidence || []).filter(e => e.kind === 'edge' && /三支两军/.test(e.to + e.from))[0];
  ok('直接关系命中', !!e1, e1 ? (e1.from + '→' + e1.to) : (r1.answer || '').slice(0, 40));
  if (e1) {
    ok('带上了时效区间', !!e1.span, e1.span);
    ok('带上了置信度文案', !!e1.conf, e1.conf);
    ok('c=2 且带 src → 算关系级出处', e1.srcLevel === 'edge', e1.srcLevel + ' / ' + (e1.src || e1.metaSrc));
  }

  /* ② c=1 的推断 → 不能冒充关系级出处 */
  const r2 = Q.ask('三支两军和军委办事组什么关系');
  const e2 = (r2.evidence || []).filter(e => e.kind === 'edge' && /军委办事组/.test(e.to + e.from))[0];
  if (e2) {
    ok('推断类标注（c=1）标为推断待核', e2.conf === '推断待核', e2.conf || '(无)');
    ok('c=1 不被当成关系级出处', e2.srcLevel !== 'edge', e2.srcLevel);
  } else {
    ok('推断类标注（c=1）能找到', false, '没找到对应 evidence');
  }

  /* ③ 没有标注的边不凭空造时效 */
  const r3 = Q.ask('彭德怀和毛泽东什么关系');
  const ev3 = (r3.evidence || []).filter(e => e.kind === 'edge');
  /* metaKey 是 id 拼的键，标注只写一个方向，所以要双向查 */
  const hasMeta = e => {
    if (!e.metaKey) return false;
    var p = e.metaKey.split('|');
    return !!(META[e.metaKey] || META[p[1] + '|' + p[0] + '|' + p[2]]);
  };
  const withSpan = ev3.filter(e => e.span);
  const withoutSpan = ev3.filter(e => !e.span);
  ok('带时效的边都能在 edge-meta 里找到标注', withSpan.every(hasMeta),
     withSpan.length + ' 条带时效 / ' + ev3.length + ' 条');
  ok('不带时效的边确实没有标注', withoutSpan.every(e => !hasMeta(e)),
     withoutSpan.map(e => e.from + '→' + e.to + '[' + e.rel + ']').slice(0, 3).join(',') || 'ok');

  /* ④ 统计字段 */
  ok('输出 spanCount 统计', typeof r1.spanCount === 'number' && r1.spanCount >= 1, String(r1.spanCount));
  ok('输出 citedMeta 统计', typeof r1.citedMeta === 'number', String(r1.citedMeta));
}

console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
process.exit(fail ? 1 : 0);
