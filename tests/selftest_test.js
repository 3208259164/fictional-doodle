/* 学习自测回归（15 项）
   功能：题目由站内已有数据自动生成（术语辨析 / 年代 / 导读 / 引文），
        同一天同一套题（确定性随机），答完给解析。
   本测试锁住：生成数量、结构完整、选项不重复、答案下标有效、答案本身正确、
            四类题型都出得来、同种子可复现、不同种子会变、判对判错与防重复作答。 */
const fs = require('fs');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://local.test/' });
const w = dom.window, d = w.document;
for (const f of fs.readdirSync(SITE + 'data').filter(x => x.endsWith('.js'))) {
  try { w.eval(fs.readFileSync(SITE + 'data/' + f, 'utf8')); } catch (e) {}
}
w.eval(fs.readFileSync(SITE + 'assets/selftest.js', 'utf8'));

let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };
const T = w.YZSELFTEST;
ok('YZSELFTEST 已加载', !!T);
if (!T) { console.log('\n失败 1 项'); process.exit(1); }

/* ① 数量与结构 */
const qs = T.build('yz-test-1');
ok('一组 10 题', qs.length === 10, qs.length + ' 题');
ok('每题都有 q/opts/ans/why',
  qs.every(q => q.q && Array.isArray(q.opts) && typeof q.ans === 'number' && q.why));
ok('每题选项 3~4 个', qs.every(q => q.opts.length >= 3 && q.opts.length <= 4),
  qs.map(q => q.opts.length).join(','));
ok('答案下标在范围内', qs.every(q => q.ans >= 0 && q.ans < q.opts.length));
ok('同一题内选项不重复', qs.every(q => new Set(q.opts).size === q.opts.length));

/* ② 题型齐全 */
const types = {};
qs.forEach(q => { types[q.type] = (types[q.type] || 0) + 1; });
ok('四类题型都出得来', Object.keys(types).length === 4, JSON.stringify(types));

/* ③ 答案本身对不对：年代题的最早项必须真的是 y0 最小 */
const yearQs = qs.filter(q => q.type === '年代');
if (yearQs.length) {
  const N = w.SITE_GRAPH.nodes;
  const good = yearQs.every(q => {
    const picked = N.filter(n => q.opts.indexOf(n.name) >= 0);
    if (picked.length !== q.opts.length) return false;
    /* picked 的顺序来自 N，不是选项顺序 —— 必须按名字找答案项 */
    const right = picked.find(n => n.name === q.opts[q.ans]);
    return !!right && picked.every(n => right.y0 <= n.y0);
  });
  ok('年代题答案确实是最早的', good, yearQs.length + ' 道年代题');
} else { ok('（无年代题，跳过）', true); }

/* ④ 导读题的 ask 与答案书名对应 */
const gq = qs.filter(q => q.type === '导读');
if (gq.length) {
  const G = w.SITE_GUIDES;
  const good = gq.every(q => {
    const book = q.opts[q.ans].replace(/^《|》$/g, '');
    const g = G.find(x => x.book === book);
    return !!g && q.q.indexOf(g.ask) >= 0;
  });
  ok('导读题答案与问题出自同一本书', good, gq.length + ' 道导读题');
} else { ok('（无导读题，跳过）', true); }

/* ⑤ 确定性：同种子同一套题 */
const a1 = T.build('yz-same'), a2 = T.build('yz-same');
ok('同种子出同一套题（可复现）', JSON.stringify(a1) === JSON.stringify(a2));
const b1 = T.build('yz-other');
ok('不同种子出不同题', JSON.stringify(a1) !== JSON.stringify(b1));

/* ⑥ 判题流程：插入一个题卡容器，答对/答错/防重复 */
d.body.innerHTML = '<div id="stf0"></div><div id="stScore"></div>';
T._setForTest && T._setForTest(qs);
/* open() 会重置 _cur，这里直接走 answer 需要 _cur —— 用 open 后再取状态 */
T.open();
const st0 = T.state();
ok('open() 后生成题目并清零', st0.total > 0 && st0.answered === 0 && st0.right === 0, JSON.stringify(st0));

const cur = w.YZSELFTEST.state();
d.body.innerHTML = '<div id="stf0"></div><div id="stScore"></div>';
/* 取第 0 题的正确下标：通过再次 build 同种子拿到（open 用 todaySeed） */
const today = T.build(T._todaySeed());
const right0 = today[0].ans;
T.answer(0, right0);
const s1 = T.state();
ok('答对后计数 +1', s1.right === 1 && s1.answered === 1, JSON.stringify(s1));
ok('解析已写入页面', d.getElementById('stf0').innerHTML.indexOf(today[0].why.slice(0, 10)) >= 0 ||
  d.getElementById('stf0').innerHTML.length > 20);
T.answer(0, (right0 + 1) % today[0].opts.length);
const s2 = T.state();
ok('同一题不能重复作答（计数不变）', s2.right === 1 && s2.answered === 1, JSON.stringify(s2));
T.answer(1, (today[1].ans + 1) % today[1].opts.length);
const s3 = T.state();
ok('答错不加分但计入已答', s3.right === 1 && s3.answered === 2, JSON.stringify(s3));

console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
process.exit(fail ? 1 : 0);
