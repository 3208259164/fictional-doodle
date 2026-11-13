/* 导出 × 数据清单一致性（2026-11-13）
   背景：datamap.js 用 export:true 声明「这项数据应该随导出带走」，
   但导出函数以前不读它 —— 声明与实现可以悄悄分家。
   本测试锁住：导出文件里必须出现「数据清单覆盖」小节，
   已导出的列出条数，没接统计的必须显式列出（不静默丢）。 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errs.push(e.message); });

let lazy = null;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    /* 造一份「有内容」的用户数据 */
    /* 站点实际字段：{ b:<bookId>, txt, note, t } —— 用真实结构，别自造 */
    w.localStorage.setItem('yzExcerpts', JSON.stringify([
      { b: 'r1', txt: '摘录一：国家是阶级统治的工具。', note: '', t: Date.now() },
      { b: 'r1', txt: '摘录二：革命是历史的火车头。', note: '我的想法', t: Date.now() }
    ]));
    w.localStorage.setItem('readerPos', JSON.stringify({ r1: 0.42, r2: 0.1 }));
    w.localStorage.setItem('chanEdits', JSON.stringify({ n1: { t: '改过的标题' } }));
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

lazy.waitData(() => {
  console.log('===== 导出 × 数据清单 =====');
  const D = w.YZDATAMAP, X = w.YZEXPORT;
  ok('数据清单已加载', !!D);
  ok('导出模块已加载', !!(X && X.allMd && X.coverage));
  if (!D || !X) { console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail); process.exit(1); }

  const c = X.coverage();
  ok('coverage 返回清单版本', c.ver === D.ver, 'v' + c.ver);
  const keys = c.covered.map(x => x.k);
  ok('摘录被算作已导出', keys.indexOf('yzExcerpts') >= 0, JSON.stringify(c.covered));
  ok('阅读进度被算作已导出', keys.indexOf('readerPos') >= 0);
  ok('频道编辑被算作已导出', keys.indexOf('chanEdits') >= 0);
  const ex = c.covered.filter(x => x.k === 'yzExcerpts')[0];
  ok('摘录条数统计正确', ex && ex.n === 2, ex ? ex.n + ' 条' : '-');

  /* 声明里 export:true 但没接统计的，必须出现在 unknown 里，而不是被忽略 */
  const declaredExport = D.items.filter(i => i.export).map(i => i.k);
  const accounted = keys.concat(c.unknown, c.empty);
  const lost = declaredExport.filter(k => accounted.indexOf(k) < 0);
  ok('声明的导出项全部有归属（已导出/未接统计/无数据）', lost.length === 0, lost.join(',') || 'ok');

  const md = X.allMd();
  ok('导出文本含「数据清单覆盖」小节', md.indexOf('数据清单覆盖') >= 0);
  ok('导出文本写明摘录条数', /yzExcerpts（2 项）/.test(md));
  ok('未接统计的项被显式列出（不静默丢）',
     c.unknown.length === 0 || md.indexOf('未接统计') >= 0, c.unknown.join(',') || '（无）');
  ok('说明了书籍正文不随导出', /书籍正文.*不随|IndexedDB/.test(md));

  ok('页面无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
  process.exit(fail ? 1 : 0);
});
