/* 引文比对回归（14 项）
   功能：把用户记得的「半句」跟站内所有正文段落做模糊比对，记错几个字也能找到出处。
   加载方式：只 eval data/*.js + fulltext.js + quote-match.js（不加载整页），
            避免把 1.7MB 数据脚本塞进 index.html 解析流程导致超时。 */
const fs = require('fs');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://local.test/' });
const w = dom.window;
for (const f of fs.readdirSync(SITE + 'data').filter(x => x.endsWith('.js'))) {
  try { w.eval(fs.readFileSync(SITE + 'data/' + f, 'utf8')); } catch (e) {}
}
w.eval(fs.readFileSync(SITE + 'assets/fulltext.js', 'utf8'));
w.eval(fs.readFileSync(SITE + 'assets/quote-match.js', 'utf8'));

let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };
const Q = w.YZQUOTE;
ok('YZQUOTE 已加载', !!Q);
if (!Q) { console.log('\n失败 1 项'); process.exit(1); }

const st = Q.stats();
ok('语料已建立（1600 段量级）', st.segs > 1000, st.segs + ' 段');

/* ① 归一化：标点、空格都不影响 */
ok('归一化忽略标点与空格',
  Q._norm('全世界无产者，联合起来！') === Q._norm('全世界无产者 联合起来'),
  Q._norm('全世界无产者，联合起来！'));

/* ② 精确引文 */
const r1 = Q.match('国家是阶级矛盾不可调和的产物');
ok('精确引文能命中且分数很高', r1.length > 0 && r1[0].score >= 0.9,
  r1.length ? Math.round(r1[0].score * 100) + '% · ' + r1[0].t : '无');

/* ③ 漏一个字 */
const r2 = Q.match('一切社会的历史都是阶级斗争史');
ok('漏一个字仍能命中', r2.length > 0 && r2[0].score >= 0.8,
  r2.length ? Math.round(r2[0].score * 100) + '% · ' + r2[0].t : '无');

/* ④ 换一个词 */
const r3 = Q.match('每个人的自由发展是一切人的自由发展条件');
ok('换一个词仍能命中', r3.length > 0, r3.length ? Math.round(r3[0].score * 100) + '% · ' + r3[0].t : '无');

/* ⑤ 无关句子不硬凑 */
const r4 = Q.match('今天天气很好我打算出门买点水果回来吃');
ok('无关句子不返回高分结果', r4.filter(x => x.score >= 0.55).length === 0,
  r4.length ? '最高 ' + Math.round(r4[0].score * 100) + '%' : '空');

/* ⑥ 短查询不触发 */
ok('少于 6 字不比对（避免噪音）', Q.match('阶级').length === 0);

/* ⑦ 结构完整 */
if (r1.length) {
  const x = r1[0];
  ok('结果含 cat/t/sub/snip/score/fn',
    x.cat === '引文比对' && !!x.t && !!x.sub && !!x.snip && typeof x.score === 'number' && typeof x.fn === 'function');
  ok('片段带省略号或本身够短', /…/.test(x.snip) || x.snip.length <= 80);
  ok('相似度在 (0,1]', x.score > 0 && x.score <= 1);
} else { ok('（无结果，结构断言失败）', false); fail++; }

/* ⑧ 定位映射：归一化下标必须能正确回到原文（标点不造成错位） */
const S0 = '甲：「阶级斗争」是历史的直接动力，这一点很重要。';
const loc = Q._locate(S0, '阶级斗争是历史的直接动力');
ok('定位能跨过标点找到原文位置', !!loc && loc.start >= 0 && loc.end > loc.start,
  loc ? ('原文 ' + loc.start + '—' + loc.end) : '未定位');
const cut = loc ? S0.slice(loc.start, loc.end) : '';
ok('定位片段就是引文本身（不被标点带偏）',
  cut.replace(/[，。：「」]/g, '') === '阶级斗争是历史的直接动力', cut);

/* ⑨ 排序降序 */
const all = r1;   /* 只检查单次查询内部的降序（不同查询之间本就不可比） */
ok('单次结果按加权分降序', all.every((x, i) => i === 0 || all[i - 1].score >= x.score - 1e-9),
  all.map(x => Math.round(x.score * 100) + '%').join(' ≥ '));

/* ⑩ 集成：源码里确实挂了兜底，且被 index.html / sw.js 引用 */
const appjs = fs.readFileSync(SITE + 'assets/app.js', 'utf8');
ok('app.js 在精确检索零结果时调用 YZQUOTE', /YZQUOTE\.match\(/.test(appjs));
// 0.18 起这个模块改成「按需注入」：首页不引它，搜索时才 need 一份。
// 断言要跟着口径走：只要能被加载到（首屏引用 / 懒加载清单 / 搜索路径里 need）就算过。
const _qref = ['index.html', 'assets/lazydata.js', 'assets/app.js']
  .filter(f => { try { return /quote-match\.js/.test(fs.readFileSync(SITE + f, 'utf8')); } catch (e) { return false; } });
ok('quote-match.js 会被加载（首屏或按需）', _qref.length > 0, _qref.join(' / ') || '一处都没有');
ok('sw.js 已预缓存 quote-match.js', /quote-match\.js/.test(fs.readFileSync(SITE + 'sw.js', 'utf8')));

console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
process.exit(fail ? 1 : 0);
