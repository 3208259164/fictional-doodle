/* 概念批量导入：选文件解析（2026-11-15）
 *
 * 用户的要求：批量导入不是复制粘贴，而是像导入文档一样选文件。
 * 本套件验证两件事：
 *   ① 文件解析：JSON（数组 / {nodes} / 单对象）与块文本（# 名称 + 键: 值 + - 要点）
 *   ② 端到端：解析出来的条目真的能写进概念频道，并且立刻能搜到、能答出来
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
  console.log('===== 概念批量导入：文件解析 =====');

  /* ① JSON 数组 */
  const j1 = w.yzConceptParse(JSON.stringify([
    { id: 'imp_a', name: '导入甲', role: '定位甲', desc: '正文甲', source: '出处甲', points: ['要点一', '要点二'] },
    { id: 'imp_b', name: '导入乙' }
  ]));
  ok('JSON 数组解析出 2 条', j1.list.length === 2, j1.list.length);
  ok('字段映射正确', j1.list[0].role === '定位甲' && j1.list[0].points.length === 2, JSON.stringify(j1.list[0]).slice(0, 80));

  /* ② {nodes:[...]} 与单对象 */
  const j2 = w.yzConceptParse(JSON.stringify({ nodes: [{ id: 'imp_c', name: '导入丙' }] }));
  ok('{nodes:[...]} 也能解析', j2.list.length === 1 && j2.list[0].name === '导入丙');
  const j3 = w.yzConceptParse(JSON.stringify({ id: 'imp_d', name: '导入丁' }));
  ok('单个对象也能解析', j3.list.length === 1 && j3.list[0].id === 'imp_d');

  /* ③ 块文本 */
  const txt = [
    '# 导入戊',
    '编号: imp_e',
    '定位: 一句话定位',
    '正文: 这是正文说明。',
    '出处: 某书第一章',
    '要点:',
    '- 第一点',
    '- 第二点',
    '',
    '# 导入己',
    '编号: imp_f',
    '正文: 第二条正文。'
  ].join('\n');
  const j4 = w.yzConceptParse(txt);
  ok('块文本解析出 2 条', j4.list.length === 2, j4.list.length);
  const e = j4.list[0] || {};
  ok('块文本的定位/正文/出处都对', e.role === '一句话定位' && /这是正文说明/.test(e.desc || '') && e.source === '某书第一章',
     JSON.stringify(e).slice(0, 100));
  ok('块文本的要点按 - 收集', Array.isArray(e.points) && e.points.length === 2, JSON.stringify(e.points));

  /* ④ 坏输入 */
  ok('空文件给出提示', w.yzConceptParse('').err.length > 0);
  ok('坏 JSON 给出原因', /JSON/.test((w.yzConceptParse('{oops').err[0] || '')));

  /* ⑤ 缺编号的条目要能识别出来（预览里会跳过） */
  const j5 = w.yzConceptParse(JSON.stringify([{ name: '只有名字' }, { id: 'ok_one', name: '完整' }]));
  const good = j5.list.filter(c => c.id && c.name);
  ok('缺编号的条目不算可导入', j5.list.length === 2 && good.length === 1, '可导入 ' + good.length);

  /* ⑥ 端到端：导入两条真的进频道、能搜、能答 */
  const before = (w.SITE_CONCEPTS.nodes || []).length;
  let okN = 0;
  j4.list.forEach(c => { const r = w.YZY.addConcept(c); if (r && r.ok) okN++; });
  ok('两条都写进概念频道', okN === 2 && (w.SITE_CONCEPTS.nodes || []).length === before + 2,
     before + ' → ' + (w.SITE_CONCEPTS.nodes || []).length);

  w.chanTabSet('concept');
  ok('频道列表里能看到导入的条目', /导入戊/.test(d.getElementById('contentView').innerHTML));
  let hits = [];
  try { hits = w.omniSearchRaw('导入戊') || []; } catch (er) { hits = []; }
  ok('导入的概念能被全站搜索命中', hits.length > 0, '命中 ' + hits.length);
  let ans = {};
  try { ans = w.YZQA.ask('导入戊是什么'); } catch (er) { ans = {}; }
  ok('导入的概念能被问一问答出来', /导入戊/.test(JSON.stringify(ans)));

  /* ⑦ 编号重复时不会覆盖 */
  const dup = w.YZY.addConcept({ id: 'imp_e', name: '改个名' });
  ok('重复编号被拒，不覆盖已有条目', !dup.ok, dup.msg);

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
