/**
 * 学通 · 图谱问答引擎测试
 * 用真实图谱数据跑一批问题，检查意图、答案、可追踪性
 */
const fs = require('fs');
const vm = require('vm');
const DIR = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';

const sandbox = { window: {}, console, JSON };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(DIR + 'data/graph.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(DIR + 'data/graph-wenge.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(DIR + 'data/graph-world.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(DIR + 'assets/qa-engine.js', 'utf8'), sandbox);

const QA = sandbox.window.YZQA;
let pass = 0, fail = 0;
function ok(c, m, extra) {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
}

console.log('\n[0] 加载');
ok(QA && typeof QA.ask === 'function', '引擎可用');
const st = QA.stats();
ok(st.nodes > 50 && st.links > 100, '图谱规模 ' + st.nodes + ' 节点 / ' + st.links + ' 关系');

console.log('\n[1] 直接关系');
{
  const r = QA.ask('马克思和恩格斯什么关系？');
  ok(r.intent === 'relation', '意图=relation');
  ok(r.answer.indexOf('挚友') >= 0 || r.answer.indexOf('合作') >= 0, '答案含关系描述');
  ok(r.evidence.length > 0, '带证据链 ' + r.evidence.length + ' 条');
  console.log('    ' + r.answer);
}

console.log('\n[2] 关系方向不能反');
{
  const r = QA.ask('马克思和恩格斯什么关系');
  ok(!/恩格斯.*(创立|提出).*马克思/.test(r.answer), '没把「谁创立」说反');
}

console.log('\n[3] 人物介绍');
{
  const r = QA.ask('马克思是谁');
  ok(r.intent === 'intro', '意图=intro');
  ok(r.answer.indexOf('马克思主义') >= 0, '答案含关键定位');
  ok(r.answer.indexOf('1818') >= 0, '含生卒年');
  console.log('    ' + r.answer.split('\n')[0]);
}

console.log('\n[4] 代表作');
{
  const r = QA.ask('马克思写过什么');
  ok(r.intent === 'works', '意图=works');
  ok(r.answer.indexOf('共产党宣言') >= 0, '含《共产党宣言》');
  ok(r.answer.indexOf('资本论') >= 0, '含《资本论》');
}

console.log('\n[5] 观点');
{
  const r = QA.ask('马克思的主要观点');
  ok(r.intent === 'points', '意图=points');
  ok(r.answer.indexOf('唯物史观') >= 0, '含唯物史观');
  ok(r.answer.indexOf('剩余价值') >= 0, '含剩余价值');
}

console.log('\n[6] 批判关系');
{
  const r = QA.ask('马克思批判过谁');
  ok(r.intent === 'crit', '意图=crit');
  ok(r.answer.length > 10, '有实质答案');
  console.log('    ' + r.answer.slice(0, 90));
}

console.log('\n[7] 关联网');
{
  const r = QA.ask('毛泽东和谁有关系');
  ok(r.intent === 'neighbors', '意图=neighbors');
  ok(/有 \d+ 条关联/.test(r.answer), '统计出关联条数');
  ok(r.evidence.length > 3, '证据链完整 ' + r.evidence.length + ' 条');
}

console.log('\n[8] 类型统计');
{
  const r = QA.ask('有哪些人物');
  ok(r.intent === 'type', '意图=type');
  ok(/收录 人物 \d+ 个/.test(r.answer), '给出数量');
}

console.log('\n[9] 间接关系（多跳）');
{
  const r = QA.ask('马克思和列宁什么关系');
  ok(r.intent === 'relation', '意图=relation');
  ok(r.ok === true, '能找到关联（直接或间接）');
  console.log('    ' + r.answer.slice(0, 120));
}

console.log('\n[10] 不可达要诚实');
{
  const r = QA.ask('马克思和雷锋什么关系');
  ok(r.ok === false || r.intent === 'relation', '不硬编答案');
  ok(r.answer.indexOf('检索不到') >= 0 || r.notes.length > 0, '明确说明查不到，并提示图谱局限');
  console.log('    ' + r.answer.slice(0, 80));
}

console.log('\n[11] 别名与简称');
{
  const a = QA.find('马克思');
  ok(a.length > 0 && a[0].node.id === 'marx', '「马克思」能定位到 marx');
  const b = QA.find('毛泽东');
  ok(b.length > 0, '「毛泽东」能定位');
}

console.log('\n[12] 空输入不崩');
{
  const r = QA.ask('');
  ok(r.ok === false && r.answer.length > 0, '空输入有提示');
  const r2 = QA.ask('???');
  ok(typeof r2.answer === 'string', '乱输入不崩');
}

console.log('\n[13] 关系归一化');
{
  const cats = {};
  ['挚友 · 合作', '战友', '批判', '领导', '创立', '成员', '父子', '对立'].forEach(function (x) {
    cats[x] = QA.relCat(x);
  });
  ok(cats['挚友 · 合作'] === '合作', '挚友·合作 → 合作');
  ok(cats['战友'] === '合作', '战友 → 合作');
  ok(cats['批判'] === '对立', '批判 → 对立');
  ok(cats['成员'] === '组织成员', '成员 → 组织成员');
  ok(cats['父子'] === '亲属', '父子 → 亲属');
}

console.log('\n[14] 方向不能说反（原始数据方向不统一，禁止断言谁继承谁）');
{
  const r = QA.ask('马克思和列宁什么关系');
  ok(!/马克思[^，。]{0,6}继承[^，。]{0,6}列宁/.test(r.answer), '不出现「马克思继承列宁」这类反向断言');
  ok(r.answer.indexOf('关系') >= 0, '改用中性表述报关系名');
  console.log('    ' + r.answer.replace(/\n/g, ' ').slice(0, 90));
}

console.log('\n[15] 多跳不超过 2 步');
{
  const r = QA.ask('马克思和雷锋什么关系');
  ok(r.ok === false, '3 步以上不给路径（实为 ok=' + r.ok + '）');
  ok(r.answer.indexOf('2 步以内') >= 0, '明确说明检索范围');
}

console.log('\n[16] 实体消歧：人物优先于概念');
{
  const a = QA.find('列宁');
  ok(a[0].node.id === 'lenin', '「列宁」命中人物 lenin，而不是 leninism（实为 ' + a[0].node.id + '）');
  const b = QA.find('毛泽东');
  ok(b[0].node.id === 'mao', '「毛泽东」命中 mao，而不是 maoism（实为 ' + b[0].node.id + '）');
  const c = QA.find('列宁主义');
  ok(c[0].node.id === 'leninism', '「列宁主义」精确命中概念节点');
}

console.log('\n[14] 性能：1000 次问答');
{
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) QA.ask('马克思和恩格斯什么关系');
  const ms = Date.now() - t0;
  /* 阈值 5000ms（单次 5ms）：0.17.19 起 ask 会额外经过正文级检索，单次从 ~2.9ms 升到 ~3.7ms，
     仍是 270 次/秒的量级，用户完全无感；原阈值 3000ms 是「没有正文检索」时代定的。 */
  ok(ms < 5000, '1000 次 ' + ms + 'ms（单次 ' + (ms / 1000).toFixed(2) + 'ms）');
}

console.log('\n[17] 多图谱：注册与切换');
{
  const gs = QA.graphs();
  ok(gs.length >= 4, '注册了 ' + gs.length + ' 个图谱（含合并视图）');
  const ids = gs.map(x => x.id).join(',');
  ok(ids.indexOf('main') >= 0 && ids.indexOf('wenge') >= 0 && ids.indexOf('world') >= 0, '含 main/wenge/world');
  ok(ids.indexOf('all') >= 0, '含「全部」合并视图');
  const allStats = QA.stats();
  ok(allStats.graph === 'all', '默认使用「全部」，无需选图谱');
  ok(allStats.nodes >= 300, '合并后 ' + allStats.nodes + ' 节点（比任一单图谱都多）');
}

console.log('\n[18] 文革图谱问答');
{
  QA.use('wenge');
  const st = QA.stats();
  ok(st.graph === 'wenge', '已切到文革图谱');
  ok(st.nodes > 200, '节点 ' + st.nodes + ' 个');

  const r1 = QA.ask('林彪是谁');
  ok(r1.intent === 'intro' && r1.answer.indexOf('林彪') >= 0, '人物介绍可用');
  ok(r1.answer.indexOf('温都尔汗') >= 0, '内容来自该图谱（含九一三）');

  const r2 = QA.ask('有哪些事件');
  ok(r2.intent === 'type' && r2.answer.indexOf('事件') >= 0, '事件类型可列举');
  console.log('    ' + r2.answer.slice(0, 90));

  const r3 = QA.ask('中央文革小组');
  ok(r3.ok === true || r3.answer.length > 5, '组织条目可查');
}

console.log('\n[19] 世界图谱问答');
{
  QA.use('world');
  const st = QA.stats();
  ok(st.graph === 'world' && st.nodes > 100, '切到世界图谱，' + st.nodes + ' 节点');
  const r = QA.ask('有哪些事件');
  ok(r.intent === 'type', '事件可列举');
}

console.log('\n[20] 切回主图谱后互不污染');
{
  QA.use('main');
  ok(QA.stats().graph === 'main', '已切回 main');
  const r = QA.ask('彭德怀是谁');
  ok(r.answer.indexOf('彭德怀') >= 0 && r.answer.indexOf('温都尔汗') < 0, '主图谱答案不含文革图谱内容');
  const w = QA.ask('林彪是谁');
  ok(w.answer.indexOf('国防部长') < 0, '主图谱的林彪条目独立于文革图谱');
}

console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
process.exit(fail ? 1 : 0);
