/* 阅读器字号 / 行距（2026-11-14）
 *
 * 修的 bug：设置页的「行距」改的是 --lh（body 的行高），但阅读器的正文容器
 * #yzbkBody 上有一行 inline line-height:1.95，把 --lh 整个盖掉 ——
 * 用户在设置里把行距从「紧」调到「松」，进阅读器一点变化都没有。
 * 字号同理只用了 rem，虽然会跟 html 的 font-size 走，但三档 × 三档叠在一起幅度太小，
 * 看起来像没生效。
 *
 * 现在的口径：阅读器正文 = 「设置页基准」× 「阅读器档位」
 *   字号：基准 = html 的 font-size（15/16/18px），档位 0.9 / 1 / 1.14 / 1.3
 *   行距：基准 = --lh（1.6 / 1.9 / 2.2），档位 0.85 / 1 / 1.15
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

  /* ---- 2. 设置页改「大」+「松」→ 阅读器跟着变（这就是原来的 bug） ---- */
  w.setFS('lg'); w.setLH('2.2');
  w.YZAppBooks.reapplyText();
  ok('设置页字号「大」→ 阅读器 18px', num(body.style.fontSize) === 18, body.style.fontSize);
  ok('设置页行距「松」→ 阅读器 2.2', Math.abs(num(body.style.lineHeight) - 2.2) < 0.02, body.style.lineHeight);
  ok('行距不再被写死 1.95 覆盖', Math.abs(num(body.style.lineHeight) - 1.95) > 0.05, body.style.lineHeight);

  /* ---- 3. 阅读器自己的档位乘在基准上 ---- */
  w.localStorage.setItem('yzReadCfg', JSON.stringify({ fs: 1.3, lh: 1.15, pd: 16 }));
  w.YZAppBooks.reapplyText();
  ok('档位 1.3 × 基准 18 = 23.4px', Math.abs(num(body.style.fontSize) - 23.4) < 0.2, body.style.fontSize);
  ok('档位 1.15 × 基准 2.2 ≈ 2.53', Math.abs(num(body.style.lineHeight) - 2.53) < 0.05, body.style.lineHeight);

  /* ---- 4. 旧配置迁移：绝对值 1.6 → 系数 0.85 ---- */
  w.localStorage.setItem('yzReadCfg', JSON.stringify({ fs: 1, lh: 1.6, pd: 16 }));
  w.YZAppBooks.reapplyText();
  ok('旧值 1.6 迁移成 0.85 × 2.2 ≈ 1.87', Math.abs(num(body.style.lineHeight) - 1.87) < 0.06, body.style.lineHeight);

  /* ---- 5. 设置项落盘 ---- */
  w.setFS('sm'); w.setLH('1.6');
  ok('字号选择写进 localStorage', w.localStorage.getItem('fs') === 'sm', w.localStorage.getItem('fs'));
  ok('行距选择写进 localStorage', w.localStorage.getItem('lh') === '1.6', w.localStorage.getItem('lh'));

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
