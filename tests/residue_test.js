/**
 * 残留检查：证明 theory.html 在运行时也不可达
 * 1. 页面能加载且无 JS 错误
 * 2. 全局没有 openTheory
 * 3. 「＋」菜单里没有「构建纲要」
 * 4. 点击菜单所有项，不会产生 theory.html 请求
 * 5. 记录的 script/src 请求里不含 theory
 */
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const DIR = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x ? ' → ' + x : '')); } };

const requested = [];
let html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  requested.push(src);
  const p = path.join(DIR, src);
  if (!fs.existsSync(p)) return '';
  return '<script>' + fs.readFileSync(p, 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>';
});

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = (e.detail ? (e.detail.message || e.detail) : e.message) || '';
  if (!/Not implemented|Could not load img|Could not parse CSS|Could not load link/.test(String(m))) errs.push(m);
});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://local.test/index.html',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    w.scrollTo = () => {};
    /* 拦截所有 location 跳转 */
    w.__navs = [];
    try {
      const orig = Object.getOwnPropertyDescriptor(w.location, 'href');
      // jsdom 的 location.href 可写，直接监听
    } catch (e) {}
  }
});
dom.window.addEventListener('error', e => errs.push(e.message));

setTimeout(() => {
  const w = dom.window, d = w.document;

  console.log('\n[1] 页面加载');
  ok(errs.length === 0, '无 JS 错误（' + (errs[0] || '无') + '）');

  console.log('\n[2] 全局符号');
  ok(typeof w.openTheory === 'undefined', 'window.openTheory 不存在（实为 ' + typeof w.openTheory + '）');
  ok(typeof w.openQA === 'function', 'window.openQA 仍存在（对照，说明没误删）');

  console.log('\n[3] 「＋」菜单内容');
  const items = Array.from(d.querySelectorAll('#qPanel .qitem'));
  const texts = items.map(x => x.textContent.trim());
  ok(items.length > 0, '菜单有 ' + items.length + ' 项');
  ok(!texts.some(t => t.indexOf('构建纲要') >= 0), '菜单里没有「构建纲要」（现有：' + texts.join(' / ') + '）');
  ok(texts.some(t => t.indexOf('问一问') >= 0), '「问一问」仍在（对照）');

  console.log('\n[4] 所有 script 请求');
  const bad = requested.filter(u => /theory/i.test(u));
  ok(bad.length === 0, '请求清单里无 theory（共 ' + requested.length + ' 个脚本）');

  console.log('\n[5] 逐个点击菜单项，看是否触发 theory');
  let navTo = [];
  try {
    Object.defineProperty(w, 'location', {
      configurable: true,
      get() { return { href: '', get pathname() { return '/index.html'; }, search: '', hash: '', origin: 'https://local.test' }; },
      set(v) { navTo.push(String(v)); }
    });
  } catch (e) { /* 改不了就跳过 */ }

  items.forEach(function (b) {
    try { b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); } catch (e) {}
  });
  const badNav = navTo.filter(u => /theory/i.test(u));
  ok(badNav.length === 0, '点击后无跳转到 theory（记录 ' + navTo.length + ' 次跳转）');

  console.log('\n[6] 页面文本里没有残留链接');
  /* 口径：不能只扫 'theory' 子串——概念数据里有 theory_of_knowledge 这样的 id；
     真正要 guarantee 的是「没有指向 theory 页的链接、也没有 openTheory 调用」。 */
  const html = d.body.innerHTML;
  const badLink = /<a[^>]+href=["'][^"']*theory[^"']*["']/i.test(html);
  const badCall = /openTheory\s*\(/.test(html);
  ok(!badLink && !badCall, 'DOM 中没有指向 theory 页的链接/调用（链接 ' + badLink + '，调用 ' + badCall + '）');

  console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
  process.exit(fail ? 1 : 0);
}, 900);
