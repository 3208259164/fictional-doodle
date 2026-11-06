/**
 * 统一检索测试：证明用户不需要选图谱
 */
const fs = require('fs'), vm = require('vm');
const DIR = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x ? ' → ' + x : '')); } };

const sb = { window: {}, console, JSON };
sb.window.window = sb.window;
vm.createContext(sb);
['data/graph.js', 'data/graph-wenge.js', 'data/graph-world.js', 'assets/qa-engine.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), sb);
});
const Q = sb.window.YZQA;

console.log('\n[1] 默认就是「全部」');
{
  const st = Q.stats();
  ok(st.graph === 'all', '默认图谱 = all（实为 ' + st.graph + '）');
  ok(st.nodes >= 300, st.nodes + ' 节点');
  ok(st.links >= 600, st.links + ' 关系');
}

console.log('\n[2] 不切换，直接问主图谱的人');
{
  const r = Q.ask('彭德怀是谁');
  ok(r.intent === 'intro' && r.answer.indexOf('彭德怀') >= 0, '命中彭德怀');
  ok(r.answer.indexOf('百团大战') >= 0, '内容完整');
}

console.log('\n[3] 不切换，直接问文革图谱的事');
{
  const r = Q.ask('中央文革小组');
  ok(r.ok === true, '命中组织节点');
  ok(r.answer.indexOf('陈伯达') >= 0, '内容来自文革图谱');
}

console.log('\n[4] 不切换，直接问世界图谱的事');
{
  const r = Q.ask('二战');
  ok(r.ok === true, '命中世界图谱事件');
  ok(r.answer.indexOf('1939') >= 0, '含年代');
}

console.log('\n[5] 三类问题混着问，不串味');
{
  const a = Q.ask('彭德怀是谁');
  const b = Q.ask('中央文革小组');
  const c = Q.ask('二战');
  ok(a.answer.indexOf('陈伯达') < 0, '问彭德怀不出现文革人物');
  ok(b.answer.indexOf('百团大战') < 0, '问文革小组不出现志愿军');
  ok(c.answer.indexOf('彭德怀') < 0, '问二战不出现彭德怀');
}

console.log('\n[6] 同名合并：林彪');
{
  const r1 = Q.ask('林彪是谁');
  const r2 = Q.ask('linbiao');
  ok(r1.answer.indexOf('林彪') >= 0, '中文名可查');
  ok(r2.answer.indexOf('林彪') >= 0, '拼音别名也可查（合并生效）');
}

console.log('\n[7] 统计口径正确');
{
  const p = Q.ask('有哪些人物');
  const e = Q.ask('有哪些事件');
  ok(/人物 \d+ 个/.test(p.answer), '人物总数：' + (p.answer.match(/人物 (\d+)/) || [])[1]);
  ok(/事件 \d+ 个/.test(e.answer), '事件总数：' + (e.answer.match(/事件 (\d+)/) || [])[1]);
  const np = Number((p.answer.match(/人物 (\d+)/) || [])[1]);
  ok(np > 120, '人物数 > 120（三图谱合并后）');
}

console.log('\n[8] 单图谱切换仍可用（给验证台留的口子）');
{
  Q.use('wenge');
  ok(Q.stats().graph === 'wenge', '可切到文革图谱');
  const r = Q.ask('林彪是谁');
  ok(r.answer.indexOf('国防部长') >= 0, '单图谱内容独立');
  Q.use('all');
  ok(Q.stats().graph === 'all', '可切回全部');
}

console.log('\n[9] 性能：合并后没变慢');
{
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) Q.ask('彭德怀和毛泽东什么关系');
  const ms = Date.now() - t0;
  ok(ms < 4000, '1000 次 ' + ms + 'ms（单次 ' + (ms / 1000).toFixed(2) + 'ms）');
}

console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
process.exit(fail ? 1 : 0);
