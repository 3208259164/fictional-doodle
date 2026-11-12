/* 年鉴（这一年）回归（14 项）
   功能：按年汇总——事件 / 出生 / 逝世 / 原著首版 / 组织 / 思潮。
   为什么不做日历：月日颗粒度只有 39%（366 天里 144 天有内容），做日历大半是空的；
                  年份是满的（162 个年份、930+ 条记录）。
   本测试锁住：数据聚合正确、生卒取自 years（不是文革图谱的 y0）、
            文革图谱动态加载后缓存会重算、年份导航与分组渲染、点击不炸。 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    require('./_lazy_hook')(w, SITE);   /* 让按需注入的 data/*.js 真的能加载 */
  }
});
const w = dom.window;
const waitFor = (cond, cb, ms) => { const t0 = Date.now(); (function tick(){ if (cond() || Date.now() - t0 > (ms || 8000)) return cb(); setTimeout(tick, 50); })(); };
waitFor(() => w.YZ_YEAR, () => {
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };
  const Y = w.YZ_YEAR;
  ok('YZ_YEAR 已加载', !!Y);
  if (!Y) { console.log('\n失败 1 项'); process.exit(1); }

  ok('未加载文革图谱时也能出数据（只有主图谱 + 史料）', Y.years().length > 100, Y.years().length + ' 年');
  const before = Y.years().length;

  /* 模拟文革图谱动态加载完成（jsdom 不会真的去拉 data/graph-wenge.js） */
  w.eval(fs.readFileSync(path.join(SITE, 'data/graph-wenge.js'), 'utf8'));
  ok('文革图谱注入后 SITE_GRAPH_WENGE 可用', !!(w.SITE_GRAPH_WENGE && w.SITE_GRAPH_WENGE.nodes));
  const after = Y.years().length;
  ok('缓存会重算（文革节点被纳入）', after > before, before + ' → ' + after);

  let last = null; w.openContent = function (t, h) { last = { t: String(t), h: String(h) }; };

  Y.index();
  ok('年鉴首页渲染', /年鉴/.test(last.t) && /年代/.test(last.h));
  ok('首页按十年分组', /1510 年代|1960 年代/.test(last.h));

  Y.open(1966);
  const ev = last.h.match(/事件 · (\d+)/), org = last.h.match(/组织 · (\d+)/), died = last.h.match(/逝世 · (\d+)/);
  ok('1966 年打开', /1966/.test(last.t));
  ok('1966 有事件（≥10 条）', ev && +ev[1] >= 10, ev && ev[1] + ' 条');
  ok('1966 有组织（≥10 个）', org && +org[1] >= 10, org && org[1] + ' 个');
  ok('1966 有逝世人物', died && +died[1] >= 1, died && died[1] + ' 位');
  ok('1966 不显示「出生」（生卒取自 years，不被文革活动年份污染）',
    !/👶 出生 · [1-9]/.test(last.h), (last.h.match(/出生 · \d+/) || ['无'])[0]);

  Y.open(1848);
  ok('1848 年能看到《共产党宣言》首版', /共产党宣言/.test(last.h) && /原著首版/.test(last.h));

  /* 年鉴口径已收窄到「有记录的年份」（当前 1840 起），1516 不再单列。
     断言改成「最早年份能打开且渲染出内容」，不再绑死某个具体年份的内容。 */
  const _ys = Y.years();
  Y.open(_ys[0]);
  ok('最早年份能打开（' + _ys[0] + '）', String(last.t).indexOf(String(_ys[0])) >= 0
     && String(last.h).replace(/<[^>]+>/g, '').trim().length > 50, last.t);

  /* 年份导航 */
  Y.open(1967);
  ok('年份页有上下年导航', /YZ_YEAR\.open\(\d{4}\)/.test(last.h));

  /* 点击不炸 */
  let boom = null;
  try { w.yzYearEvent(1966, 0); } catch (e) { boom = e.message; }
  ok('点事件不抛错', !boom, boom || 'ok');

  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
});
