/* 概念频道：单条新增 / 批量导入，且新增后「搜得到、问得到」（2026-11-15）
 *
 * 用户的意见：概念频道只让改不让加，缺的概念只能回去改内置数据；
 * 并且要求「增加和修改的所有内容应当搜得到，并且问一问也能问得到」。
 *
 * 本套件用真实调用验证整条链路：
 *   新增 → 写进本机覆盖层 → 页面数据 SITE_CONCEPTS.nodes 里立刻有 → 频道列表出现
 *        → 全站搜索命中 → YZQA.ask 命中
 * 另外锁住批量面板允许新增（bulk.js 的 concept 不再 noNew）。
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
  console.log('===== 概念频道：新增 / 批量导入 / 可搜可问 =====');

  const nodes = () => (w.SITE_CONCEPTS && w.SITE_CONCEPTS.nodes) || [];
  const before = nodes().length;
  ok('概念频道已有数据', before > 100, before + ' 条');

  /* ① 频道顶部有入口 */
  w.chanTabSet('concept');
  const cv = d.getElementById('contentView');
  ok('频道顶部有「新增概念」入口', !!d.querySelector('[data-act="conceptNew"]'));
  ok('频道顶部有「批量导入」入口', !!d.querySelector('[data-act="conceptBulk"]'));

  /* ② 新增一条 */
  const r = w.YZY.addConcept({
    id: 'test_concept_2026', name: '测试概念甲乙丙', role: '自动化测试用',
    desc: '这是一条由测试新增的概念，用来验证新增后能进频道、能搜到、能回答。',
    source: '自动测试'
  });
  ok('addConcept 返回成功', !!(r && r.ok), JSON.stringify(r));
  const after = nodes().length;
  ok('页面数据里立刻多了一条', after === before + 1, before + ' → ' + after);
  const added = nodes().filter(x => x.id === 'test_concept_2026')[0];
  ok('新节点带着名称与正文', !!(added && added.name === '测试概念甲乙丙' && /自动化测试|测试新增/.test(added.desc)));

  /* ③ 频道列表看得到 */
  w.chanTabSet('concept');
  ok('概念频道列表里出现新条目', /测试概念甲乙丙/.test(d.getElementById('contentView').innerHTML));

  /* ④ 全站搜索能命中 */
  let hits = [];
  try { hits = w.omniSearchRaw('测试概念甲乙丙') || []; } catch (e) { hits = []; }
  ok('全站搜索命中新概念', hits.some(h => /测试概念甲乙丙/.test(JSON.stringify(h))), '命中 ' + hits.length + ' 条');

  /* ⑤ 问一问能答 */
  let ans = null;
  try { ans = w.YZQA.ask('测试概念甲乙丙是什么'); } catch (e) { ans = { err: e.message }; }
  const text = JSON.stringify(ans || {});
  ok('问一问能回答新概念', /测试概念甲乙丙/.test(text), (text || '').slice(0, 80));

  /* ⑥ 重名要拦住 */
  const dup = w.YZY.addConcept({ id: 'test_concept_2026', name: '重复' });
  ok('重复编号被拒绝并给出原因', !dup.ok && /已存在/.test(dup.msg || ''), dup.msg);

  /* ⑦ 改名后搜索跟着变 */
  w.YZY.editConcept('test_concept_2026', { name: '测试概念丁戊己' });
  w.chanTabSet('concept');
  ok('改名后频道里是新名字', /测试概念丁戊己/.test(d.getElementById('contentView').innerHTML));

  /* ⑧ 删除 */
  w.YZY.removeConcept('test_concept_2026');
  ok('删除后页面数据里没有了', !nodes().some(x => x.id === 'test_concept_2026'), nodes().length + ' 条');
  w.chanTabSet('concept');
  ok('删除后频道列表里也没有了', !/测试概念丁戊己/.test(d.getElementById('contentView').innerHTML));

  /* ⑨ 批量面板：概念允许新增 */
  const bulkSrc = fs.readFileSync(path.join(SITE, 'assets/bulk.js'), 'utf8');
  const conceptBlock = bulkSrc.slice(bulkSrc.indexOf("concept: {"), bulkSrc.indexOf("book: {"));
  ok('批量面板的概念表不再禁止新增', !/noNew\s*:\s*true/.test(conceptBlock));
  ok('批量保存支持 isNew 分支', /save:\s*function\s*\(r,\s*isNew\)/.test(conceptBlock) && /addConcept/.test(conceptBlock));

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
