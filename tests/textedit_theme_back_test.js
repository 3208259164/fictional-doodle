/* 编辑正文浮层的两个真 bug（2026-11-15）
 *
 * 用户报：①书籍⋯ → ✏️ 编辑正文进去以后退不出来；②主题选浅色时，编辑界面的文字
 * 根本看不见。
 *
 * 根因两条，都是变量名写错/层级没接上：
 *   ① textedit.js 的容器写 `background:var(--bg); color:var(--fg,#f2e9e4)`，
 *      而全站样式表从来没定义过 --fg（只有 --text）。于是文字色永远是后退值 #f2e9e4，
 *      浅色主题的 --bg 是 #f5e9e2 —— 浅底压近白字，对比度 1.0 出头。
 *   ② app.js 的 window.__appBack 只判 YZAppBooks，不认 #yzTextEdit。按系统返回键时
 *      它去关背后的阅读器，编辑浮层（z-index 100060）留在最上层 → 只能杀进程。
 *
 * 本套件锁四件事：
 *   A. 浅色/深色两套主题下，浮层文字与底色的对比度 ≥ 4.5（WCAG AA 正文标准）
 *   B. 容器与 textarea 的配色不再引用 --fg；textarea 显式给了 -webkit-text-fill-color
 *   C. YZTextEdit.onBack() 存在：先关单段编辑卡片，再关整层
 *   D. __appBack 里 YZTextEdit 的处理排在 YZAppBooks 之前
 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
const TE = fs.readFileSync(path.join(SITE, 'assets/textedit.js'), 'utf8');
const APP = fs.readFileSync(path.join(SITE, 'assets/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(SITE, 'assets/style.css'), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } }

/* ── ✦1 对比度 ─────────────────────────────────────────────── */
function hex(c) {
  c = String(c).trim().replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
}
function lum(rgb) {
  const f = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = rgb.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = lum(hex(a)), l2 = lum(hex(b));
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function varsOf(block) {
  const o = {};
  block.replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { o[k] = v.trim(); return m; });
  return o;
}
const rootBlock = (CSS.match(/:root\s*\{[^}]*\}/) || [''])[0];
const lightBlock = (CSS.match(/body\.light\s*\{[^}]*\}/) || [''])[0];
const R = varsOf(rootBlock), L = varsOf(lightBlock);

ok(!!rootBlock && !!lightBlock, '样式表里能取到 :root 与 body.light');
ok(!('fg' in R) && !('fg' in L), '--fg 确实全站未定义（这正是不该引用它的原因）');

const lightBg = L['panel-bg'] || L['bg'], lightFg = L['panel-text'] || L['text'];
const darkBg = R['bg'], darkFg = R['text'];
const cLight = contrast(lightBg, lightFg), cDark = contrast(darkBg, darkFg);
console.log('  浅色 panel: ' + lightBg + ' / ' + lightFg + '  对比度 ' + cLight.toFixed(2));
console.log('  深色 bg/text: ' + darkBg + ' / ' + darkFg + '  对比度 ' + cDark.toFixed(2));
ok(cLight >= 4.5, '浅色主题浮层文字对比度 ≥ 4.5（实际 ' + cLight.toFixed(2) + '）');
ok(cDark >= 4.5, '深色主题浮层文字对比度 ≥ 4.5（实际 ' + cDark.toFixed(2) + '）');
ok(lightBg && lightFg && lightBg !== lightFg, '浅色主题 --panel-bg / --panel-text 都已定义');

/* ── ✦2 源码口径 ───────────────────────────────────────────── */
ok(TE.indexOf('var(--fg') < 0, 'textedit.js 不再引用未定义的 --fg');
ok(/var\(--panel-bg,var\(--bg/.test(TE), '容器底色取 --panel-bg 并以 --bg 兜底');
ok(/var\(--panel-text,var\(--text/.test(TE), '容器文字色取 --panel-text 并以 --text 兜底');
ok(TE.indexOf('-webkit-text-fill-color') >= 0, 'textarea 显式给 -webkit-text-fill-color（WebView 表单域会接管 color）');
ok(TE.indexOf('caret-color') >= 0, 'textarea 给 caret-color');
ok(TE.indexOf('safe-area-inset-top') >= 0, '顶部避开状态栏（edge-to-edge App 里 ✕ 会压到状态栏底下）');
ok(TE.indexOf('te-foot') >= 0, '底部有常驻完成出口');

/* ── ✦3 / ✦4 运行时行为 ─────────────────────────────────────── */
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'dangerously', url: 'https://local.test/' });
const w = dom.window, d = w.document;
w.eval(TE);

const Y = w.YZTextEdit;
ok(!!Y && typeof Y.onBack === 'function', 'YZTextEdit.onBack 已导出');

const items = [{ t: '第一段正文' }, { t: '小标题', k: 'h' }, { t: '第三段正文' }];
Y.open('books/test.txt', '测试书', items);
ok(!!d.getElementById('yzTextEdit'), 'open() 建出浮层');
ok(!!d.querySelector('#yzTextEdit .te-foot button'), '浮层里有底部完成按钮');

/* 关闭按钮能关（原来就能，防回归） */
d.querySelector('#yzTextEdit .te-x').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok(!d.getElementById('yzTextEdit'), '点 ✕ 能关掉浮层');

/* 返回键：整层打开时，onBack 关掉整层 */
Y.open('books/test.txt', '测试书', items);
ok(Y.onBack() === true, 'onBack() 在浮层打开时返回 true（吞掉这次返回）');
ok(!d.getElementById('yzTextEdit'), 'onBack() 把整层关掉');

/* 返回键：先关单段编辑卡片，列表留住 */
Y.open('books/test.txt', '测试书', items);
d.querySelector('#yzTextEdit .te-row').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok(!!d.querySelector('#yzTextEdit .te-edit'), '点段落后弹出单段编辑卡片');
ok(Y.onBack() === true, '卡片打开时 onBack() 也返回 true');
ok(!d.querySelector('#yzTextEdit .te-edit') && !!d.getElementById('yzTextEdit'),
   '第一次返回只关卡片，列表还在（不会一步退到底）');
Y.onBack();
ok(!d.getElementById('yzTextEdit'), '第二次返回关掉列表');
ok(Y.onBack() === false, '浮层没开时 onBack() 返回 false，把返回键交还给下一层');

/* __appBack 的层级顺序 */
const iTe = APP.indexOf('YZTextEdit.onBack');
const iBk = APP.indexOf('YZAppBooks.isOpen');
ok(iTe > 0, '__appBack 里调用了 YZTextEdit.onBack');
ok(iTe < iBk && iBk > 0, 'YZTextEdit 的处理排在 YZAppBooks 之前（浮层在阅读器上层）');
const at = APP.lastIndexOf('window.__appBack = function');
const backSrc = APP.slice(at, at + 900);
ok(/if\s*\(\s*YZTextEdit\.onBack\(\)\s*\)\s*return true/.test(backSrc),
   'onBack() 返回 true 时立即 return true（不落到阅读器分支）');

console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
process.exit(fail ? 1 : 0);
