/* 学通 · 0.17.18 新功能端到端冒烟（整页 jsdom）
   覆盖：首屏无 JS 错误 / 正文检索接进全站搜索 / 设置页三行状态 / 朗读与导出模块可用
   跑法：node tests/e2e_01718_test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '   ⟨' + extra + '⟩' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ⟨' + extra + '⟩' : '')); }
}

/* 把 <script src="..."> 内联成 <script>…</script>（jsdom 不自动加载外部脚本） */
let html = fs.readFileSync(SITE + 'index.html', 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  const p = path.join(SITE, src);
  if (!p.startsWith(SITE) || !fs.existsSync(p)) return '<!-- skip ' + src + ' -->';
  let code = fs.readFileSync(p, 'utf8');
  return '<script>' + code.replace(/<\/script>/g, '<\\/script>') + '</script>';
});

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/Could not parse CSS|Not implemented/.test(String(e && e.message))) errs.push(String(e && e.message).slice(0, 160)); });
vc.on('error', (...a) => errs.push('console.error ' + a.join(' ').slice(0, 160)));

const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://appassets.androidplatform.net/', virtualConsole: vc, pretendToBeVisual: true });
const w = dom.window;

setTimeout(() => {
  console.log('===== 学通 0.17.18 · 新功能端到端冒烟 =====');

  ok('① 首屏无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  ok('① app.js 已执行（顶层 const 可求值）', (() => { try { return typeof w.eval('catIcon') === 'object'; } catch (e) { return false; } })());
  ok('① 正文检索模块挂上了', !!(w.YZFULLTEXT && w.YZFULLTEXT.search));
  ok('① 朗读模块挂上了', !!w.YZSPEECH);
  ok('① 导出模块挂上了', !!(w.YZEXPORT && w.YZEXPORT.allMd));

  /* 正文检索真的进了全站搜索 */
  const hits = w.omniSearch('唯物主义');
  ok('② 全站搜索命中 > 0', hits.length > 0, hits.length + ' 条');
  ok('② 结果里有「词典」类（正文级新增来源）', hits.some(h => h.cat === '词典'));
  ok('② 结果里有带上下文片段的条目', hits.some(h => h.snip && h.snip.length > 8));
  const cats = [...new Set(hits.map(h => h.cat))];
  ok('② 分类覆盖 ≥3 种', cats.length >= 3, cats.join('/'));

  /* 作者名 → 人物页 */
  const two = w.authorPeople('马克思恩格斯');
  ok('③ 「马克思恩格斯」拆成 2 位作者', two.length === 2, two.map(x => x.name).join(' + '));
  const critic = w.authorPeople('蒲鲁东');
  ok('③ 被批判人物也能从书名点进去', critic.length === 1 && critic[0].kind === 'critic');

  /* 设置页三行状态 */
  try { w.eval('openSettings()'); } catch (e) { }
  const ubox = w.document.getElementById('yzUsageBox');
  ok('④ 设置页有存储用量容器', !!ubox);
  ok('④ 用量面板已渲染（含百分比或容量）', !!ubox && /%|KB|MB/.test(ubox.textContent || ''), (ubox ? (ubox.textContent || '').slice(0, 40) : ''));
  const tts = w.document.getElementById('yzTtsLine');
  ok('④ 朗读引擎状态有文案', !!tts && (tts.textContent || '').length > 2, tts ? tts.textContent : '');
  const ft = w.document.getElementById('yzFtLine');
  ok('④ 正文检索统计有文案', !!ft && /段|千字/.test(ft.textContent || ''), ft ? ft.textContent : '');

  /* 章节 */
  const chs = w.yzBooks.splitChapters(['第一章 商品', '正文一段'.repeat(8), '第二章 货币', '正文二段'.repeat(8)]);
  ok('⑤ 章节能被识别（第一章/第二章）', chs.length === 2, JSON.stringify(chs.map(c => c.title)));

  /* 懒加载文革数据：首屏不该有，loadWengeGraph 在 */
  ok('⑥ 首屏未加载文革图谱（懒加载生效）', !w.SITE_GRAPH_WENGE);
  ok('⑥ 懒加载入口存在', typeof w.loadWengeGraph === 'function');

  /* 无内联 onclick 回归 */
  const rawHtml = fs.readFileSync(SITE + 'index.html', 'utf8');
  const inline = (rawHtml.match(/onclick=/g) || []).length;
  ok('⑦ index.html 静态 onclick 没有回升（≤3）', inline <= 3, inline + ' 处');

  console.log('------------------------------------------------------------------');
  console.log('  结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
}, 1500);
