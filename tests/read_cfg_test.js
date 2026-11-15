/* 阅读器字号 / 行距（2026-11-14）
 *
 * 修的 bug：设置页的行距改的是 --lh（body 的行高），但阅读器的正文容器
 * #yzbkBody 上有一行 inline line-height:1.95，把 --lh 整个盖掉 ——
 * 用户在设置里把行距从紧调到松，进阅读器一点变化都没有。
 * 字号同理只用了 rem，虽然会跟 html 的 font-size 走，但三档 × 三档叠在一起幅度太小，
 * 看起来像没生效。
 *
 * 现在的口径：阅读器正文 = 设置页基准× 阅读器档位
 *   字号：基准 = html 的 font-size（15/16/18px），档位 0.85 / 1 / 1.2 / 1.45
 *   行距：基准 = --lh（1.6 / 1.9 / 2.2），档位 0.85 / 1 / 1.2
 *   2026-11-15 把档位幅度拉开（原来 0.9/1/1.14/1.3 与 0.85/1/1.15 在手机上几乎看不出差别），
 *   旧值 0.9/1.14/1.3 与 1.15 自动迁移到新档位。
 *   旧版 yzReadCfg 里存的绝对行距（1.6 / 1.95 / 2.3）自动迁移成系数。
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
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };
const num = v => parseFloat(String(v || '0'));

lazy.waitData(() => {
  console.log('===== 阅读器：字号 / 行距 =====');

  /* 造一个阅读器正文容器（正常流程由 YZAppBooks.open 懒创建） */
  const body = d.createElement('div');
  body.className = 'bk-body'; body.id = 'yzbkBody';
  d.body.appendChild(body);
  ok('YZAppBooks 暴露 reapplyText', !!(w.YZAppBooks && typeof w.YZAppBooks.reapplyText === 'function'));

  /* ---- 1. 默认：基准 16px / --lh 1.9 ---- */
  try { w.localStorage.removeItem('yzReadCfg'); } catch (e) {}
  w.setFS('md'); w.setLH('1.9');
  w.YZAppBooks.reapplyText();
  ok('默认字号 = 16px（16 × 1）', num(body.style.fontSize) === 16, body.style.fontSize);
  ok('默认行距 = 1.9（1.9 × 1）', Math.abs(num(body.style.lineHeight) - 1.9) < 0.02, body.style.lineHeight);

  /* ---- 2. 设置页改大+松→ 阅读器跟着变（这就是原来的 bug） ---- */
  w.setFS('lg'); w.setLH('2.2');
  w.YZAppBooks.reapplyText();
  ok('设置页字号大→ 阅读器 18px', num(body.style.fontSize) === 18, body.style.fontSize);
  ok('设置页行距松→ 阅读器 2.2', Math.abs(num(body.style.lineHeight) - 2.2) < 0.02, body.style.lineHeight);
  ok('行距不再被写死 1.95 覆盖', Math.abs(num(body.style.lineHeight) - 1.95) > 0.05, body.style.lineHeight);

  /* ---- 3. 阅读器自己的档位乘在基准上 ---- */
  w.localStorage.setItem('yzReadCfg', JSON.stringify({ fs: 1.45, lh: 1.2, pd: 16 }));
  w.YZAppBooks.reapplyText();
  ok('档位 1.45 × 基准 18 = 26.1px', Math.abs(num(body.style.fontSize) - 26.1) < 0.2, body.style.fontSize);
  ok('档位 1.2 × 基准 2.2 = 2.64', Math.abs(num(body.style.lineHeight) - 2.64) < 0.05, body.style.lineHeight);

  /* ---- 4. 旧配置迁移：绝对值 1.6 → 系数 0.85 ---- */
  w.localStorage.setItem('yzReadCfg', JSON.stringify({ fs: 1, lh: 1.6, pd: 16 }));
  w.YZAppBooks.reapplyText();
  ok('旧值 1.6 迁移成 0.85 × 2.2 ≈ 1.87', Math.abs(num(body.style.lineHeight) - 1.87) < 0.06, body.style.lineHeight);

  /* ---- 5. 设置项落盘 ---- */
  w.setFS('sm'); w.setLH('1.6');
  ok('字号选择写进 localStorage', w.localStorage.getItem('fs') === 'sm', w.localStorage.getItem('fs'));
  ok('行距选择写进 localStorage', w.localStorage.getItem('lh') === '1.6', w.localStorage.getItem('lh'));

  /* ---- 6. 关掉 Font Boosting（2026-11-15 定位的真因） ----
     移动端 WebView 的 Text Autosizer 会把小于 32×multiplier−16 的字统一拉大，
     multiplier 常见 1.0~1.3 → 阈值 16~25.6px，于是 15/16/18px 全被抹平。
     没有 text-size-adjust 的话，字号开关在手机上看起来永远无效。 */
  const css = fs.readFileSync(path.join(SITE, 'assets/extra.css'), 'utf8');
  ok('html/body 上有 text-size-adjust:100%',
    /html\s*\{[^}]*text-size-adjust\s*:\s*100%/i.test(css) && /body\s*\{[^}]*text-size-adjust\s*:\s*100%/i.test(css));
  ok('两套阅读器正文另有单独锁定',
    /#yzbkBody[^{]*\{[^}]*text-size-adjust\s*:\s*100%/i.test(css));

  /* ---- 7. 我的书阅读器（books.js）也要跟随设置页 ----
     它原来只读自己的 readerCfg，设置页调字号行距对它完全无效。 */
  const rd = d.createElement('div'); rd.id = 'yzReader';
  const art = d.createElement('article'); art.className = 'reader-body';
  rd.appendChild(art); d.body.appendChild(rd);
  ok('yzBooks 暴露 reapplyText', !!(w.yzBooks && typeof w.yzBooks.reapplyText === 'function'));

  try { w.localStorage.removeItem('readerCfg'); } catch (e) {}
  w.setFS('md'); w.setLH('1.9');
  w.yzBooks.reapplyText();
  ok('我的书阅读器：默认字号 = 设置页基准 16px', num(art.style.fontSize) === 16, art.style.fontSize);
  ok('我的书阅读器：默认行距 = 基准 1.9', Math.abs(num(art.style.lineHeight) - 1.9) < 0.02, art.style.lineHeight);

  w.setFS('lg'); w.setLH('2.2');
  w.yzBooks.reapplyText();
  ok('设置页大 + 松→ 我的书阅读器跟着变', num(art.style.fontSize) === 18 && Math.abs(num(art.style.lineHeight) - 2.2) < 0.02,
    art.style.fontSize + ' / ' + art.style.lineHeight);

  w.localStorage.setItem('readerCfg', JSON.stringify({ fs: 21, lh: 2.4, pd: 2, jc: 1, th: 'day' }));
  w.yzBooks.reapplyText();
  ok('阅读器自己的偏移叠加在基准上', Math.abs(num(art.style.fontSize) - 22) < 0.2 && num(art.style.lineHeight) > 2.5,
    art.style.fontSize + ' / ' + art.style.lineHeight);

  /* ---- 7. 2026-11-15：真机上「还是调不动」的三条反制 ---- */
  w.localStorage.setItem('yzReadCfg', JSON.stringify({ fs: 1.2, lh: 1.2, pd: 16 }));
  const panel = d.createElement('div'); panel.id = 'yzbkAAPanel'; d.body.appendChild(panel);
  w.YZAppBooks.reapplyText();

  const rootEl = d.documentElement;
  ok('html 上声明 -webkit-text-size-adjust:none',
     /none/.test(rootEl.style.getPropertyValue('-webkit-text-size-adjust') || ''),
     rootEl.style.getPropertyValue('-webkit-text-size-adjust'));
  ok('该声明带 !important（否则样式表能顶回来）',
     rootEl.style.getPropertyPriority('-webkit-text-size-adjust') === 'important');
  ok('正文字号用 inline !important 写',
     body.style.getPropertyPriority('font-size') === 'important', body.style.fontSize);
  ok('正文行距用 inline !important 写',
     body.style.getPropertyPriority('line-height') === 'important', body.style.lineHeight);
  ok('页面文字也不参与字体自动放大',
     /none/.test(d.body.style.getPropertyValue('-webkit-text-size-adjust') || ''),
     d.body.style.getPropertyValue('-webkit-text-size-adjust'));
  const actual = w.YZAppBooks.readActual && w.YZAppBooks.readActual();
  ok('YZAppBooks.readActual() 记下实际值（诊断与面板读数都读它）',
     !!(actual && actual.px > 0), JSON.stringify(actual || null));
  const fsv = d.getElementById('yzbkFsVal'), lhv = d.getElementById('yzbkLhVal');
  ok('Aa 面板显示字号实测值', !!fsv && /px/.test(fsv.textContent), fsv && fsv.textContent);
  ok('Aa 面板显示行距实测值', !!lhv && parseFloat(lhv.textContent) > 0, lhv && lhv.textContent);

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
