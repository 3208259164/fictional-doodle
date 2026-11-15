/* 人物条目（不进图谱）+ 无书壳文献说明页（2026-11-15）
 *
 * 用户的要求：
 *   ① 人物继续增加但不加入图谱 —— 书库里有 159 位作者没有页面
 *   ② 介绍里的「代表文献」有些没有书壳，点开不能只有一句 toast
 * 本套件验证：人物条目能进人物栏、能搜到、点开有页面；没有书壳的文献点开是说明页。
 */
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
    w.fetch = (u) => {
      const rel = String(u).replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').split('?')[0];
      try { return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(fs.readFileSync(path.join(SITE, rel), 'utf8')) }); }
      catch (e) { return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }); }
    };
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

lazy.waitData(() => {
  console.log('===== 人物条目（不进图谱）+ 无书壳文献 =====');

  const extra = w.SITE_PEOPLE_EXTRA || [];
  ok('人物条目已加载', extra.length >= 20 && extra.length <= 30, extra.length + ' 人');
  ok('这些人不进图谱', extra.every(p => p.extra === true));

  /* 人物栏里能看到 */
  const figs = w.figuresList();
  ok('人物栏收录了这些人', figs.some(p => p.name === '普列汉诺夫'), '人物栏 ' + figs.length + ' 人');

  /* 点开有页面 */
  w.openFigure('plekhanov');
  const cv = d.getElementById('contentView');
  const html2 = cv ? cv.innerHTML : '';
  ok('点开人物条目有正文', /普列汉诺夫/.test(html2) && /俄国马克思主义先驱|劳动解放社/.test(html2));
  ok('页面上有代表文献', /论一元论历史观之发展/.test(html2));
  ok('没有书壳的文献标了「仅书名」', /仅书名/.test(html2));

  /* 搜索命中 */
  let hits = [];
  try { hits = w.omniSearchRaw('普列汉诺夫') || []; } catch (e) { hits = []; }
  ok('全站搜索能命中', hits.length > 0, '命中 ' + hits.length);

  /* 无书壳文献：点开是说明页，不是一句 toast */
  ok('findBookByTitle 找不到时返回 -1', w.findBookByTitle('根本不存在的一本书') === -1);
  ok('能正常找到书库里的书', w.findBookByTitle('共产党宣言') >= 0);
  w.openBookByTitle('根本不存在的一本书');
  const html3 = (d.getElementById('contentView') || {}).innerHTML || '';
  ok('点开无书壳文献进说明页', /只有书名/.test(html3) && /还没有收录/.test(html3));
  ok('说明页给了全站搜索的出口', /在全站搜这本书/.test(html3));

  /* 图谱页：节点面板要能看到「其他图谱里的关系」（外挂脚本，不改内联） */
  const ghtml = fs.readFileSync(path.join(SITE, 'graph.html'), 'utf8');
  const gcross = fs.readFileSync(path.join(SITE, 'assets/graph-cross.js'), 'utf8');
  ok('graph.html 引入了 graph-cross.js', /assets\/graph-cross\.js/.test(ghtml));
  ok('跨图谱模块按 id 聚合各图谱的边', /SITE_GRAPH_WENGE/.test(gcross) && /SITE_GRAPH_WORLD/.test(gcross) && /l\.source === id/.test(gcross));
  ok('用观察器在面板打开时注入（不改内联脚本）', /MutationObserver/.test(gcross) && /classList\.contains\('open'\)/.test(gcross));

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
