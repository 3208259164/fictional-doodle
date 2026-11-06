/* 术语卡编辑 + 批量导入回归（17 项）
   为什么做：术语卡原来只读，68 张卡改不了、加不了，也没法从别处搬一批进来。
   本测试锁住：改/增/删三条链路、同名词条拦截、批量导入（跳过 vs 覆盖）、
            宽松解析（| ｜ Tab ：）、净化（HTML 被清）、以及两个弹窗能打开。 */
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
    w.confirm = () => true;
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window, d = w.document;
setTimeout(() => {
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };
  const Y = w.YZY;
  ok('YZY 覆盖层 API 齐全', !!(Y && Y.editTerm && Y.addTerm && Y.removeTerm && Y.importTerms));
  const gl = () => w.SITE_GLOSSARY || [];
  const before = gl().length;
  ok('初始 68 张术语卡', before === 68, before + ' 张');

  /* ① 改 */
  const first = gl()[0];
  const r1 = Y.editTerm(first.id, { dic: '【改过的定义】' });
  ok('editTerm 返回 ok', !!(r1 && r1.ok));
  Y.reapply();
  const after1 = gl().filter(x => x.id === first.id)[0];
  ok('改完 reapply 后定义确实变了', after1 && after1.dic === '【改过的定义】', after1 && after1.dic);

  /* ② 净化：带标签的输入要被清掉 */
  Y.editTerm(first.id, { note: '正常文字<script>alert(1)</script>尾巴' });
  Y.reapply();
  const n1 = gl().filter(x => x.id === first.id)[0];
  ok('写入的 HTML 被净化（没有 <script>）', n1 && n1.note.indexOf('<script>') < 0 && n1.note.indexOf('正常文字') >= 0, n1 && n1.note);

  /* ③ 增 */
  const r2 = Y.addTerm({ term: '测试术语A', dic: '这是测试定义', from: '测试出处', group: '导入' });
  ok('addTerm 返回 id', !!(r2 && r2.ok && r2.id), r2 && r2.id);
  Y.reapply();
  ok('新增后出现在术语卡列表', gl().some(x => x.term === '测试术语A'), gl().length + ' 张');

  /* ④ 同名拦截 */
  const r3 = Y.addTerm({ term: '测试术语A', dic: '另一个定义' });
  ok('同名重复新增被拒绝', r3 && r3.ok === false, r3 && r3.msg);

  /* ⑤ 删（新增的） */
  Y.removeTerm(r2.id); Y.reapply();
  ok('删掉新增的卡后消失', !gl().some(x => x.term === '测试术语A'));
  ok('删完回到 68 张', gl().length === 68, gl().length + ' 张');

  /* ⑥ 删（内置的） */
  Y.removeTerm('gl-weixinzhuyi'); Y.reapply();
  ok('内置卡也能删（只删本机副本）', !gl().some(x => x.id === 'gl-weixinzhuyi'), gl().length + ' 张');

  /* ⑦ 批量导入：跳过同名 */
  const list = [
    { term: '批量词条1', dic: '定义1' },
    { term: '批量词条2', dic: '定义2' },
    { term: '唯物主义', dic: '重复的' },
    { term: '', dic: '没有名字' }
  ];
  const r4 = Y.importTerms(list, {});
  ok('批量导入：新增 2、跳过同名 1、坏行 1',
    r4 && r4.added === 2 && (r4.skipped || []).length === 1 && (r4.bad || []).length === 1,
    JSON.stringify({ added: r4.added, skipped: r4.skipped, bad: r4.bad }));
  Y.reapply();
  ok('导入的词条已在列表里', gl().some(x => x.term === '批量词条1') && gl().some(x => x.term === '批量词条2'));

  /* ⑧ 批量导入：覆盖同名 */
  const r5 = Y.importTerms([{ term: '唯物主义', dic: '被覆盖的定义' }], { overwrite: true });
  Y.reapply();
  const wu = gl().filter(x => x.term === '唯物主义')[0];
  ok('overwrite=true 时覆盖同名词条', !!(r5 && r5.added === 1) && wu && wu.dic === '被覆盖的定义', wu && wu.dic);

  /* ⑨ 宽松解析 */
  const P = w.YZStudy._parseTermText;
  const parsed = P('甲 | 定义甲 | 出处甲 | 分组甲\n乙｜定义乙\n丙\t定义丙\n丁：定义丁\n# 注释行\n乱码一行没有分隔');
  ok('解析认 | ｜ Tab ： 四种分隔', parsed.list.length === 4 && parsed.bad.length === 1,
    'list=' + parsed.list.length + ' bad=' + parsed.bad.length);
  ok('解析出的列正确', parsed.list[0].term === '甲' && parsed.list[0].dic === '定义甲' && parsed.list[0].group === '分组甲');

  /* ⑩ 两个弹窗能打开 */
  w.YZStudy.termEdit('gl-weiwuzhuyi');
  ok('编辑弹窗打开', !!d.getElementById('yzTermBox'));
  d.getElementById('yzTermBox').remove();
  w.YZStudy.termImport();
  ok('批量导入弹窗打开', !!d.getElementById('yzTermImp'));
  d.getElementById('yzTermImp').remove();

  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
}, 1600);
