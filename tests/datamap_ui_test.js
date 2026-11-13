/* 设置页「本机数据概览」入口（2026-11-13）
   以前数据清单只出现在诊断报告里（要导出 JSON 才看得到），而「本地优先」是
   产品承诺 —— 用户应该能自己点开看到有哪些数据、占多少、哪些会随导出带走。 */
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
    try { Object.defineProperty(w.navigator, 'storage', { value: { estimate: () => Promise.resolve({ usage: 3 * 1048576, quota: 200 * 1048576 }) }, configurable: true }); } catch (e) {}
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

lazy.waitData(() => {
  console.log('===== 设置页数据概览入口 =====');
  ok('数据清单模块已加载', !!w.YZDATAMAP);

  try { w.openSettings(); } catch (e) {}
  const btn = d.getElementById('yzDmBtn');
  ok('设置页有「本机数据概览」按钮', !!btn, btn ? btn.textContent.trim() : '未找到');

  if (btn) {
    let opened = false, text = '';
    try {
      btn.click();
      /* detail 是异步的，等一拍 */
      setTimeout(function () {
        text = (d.getElementById('contentView') || d.body).textContent || '';
        opened = /数据清单 v/.test(text) && /随导出/.test(text);
        const qtitle = (d.getElementById('qTitle') || {}).textContent || '';
        ok('点开后标题是「本机数据概览」', /本机数据概览/.test(qtitle), qtitle || '(空)');
        ok('点开后能看到清单内容', opened, text.replace(/\s+/g, ' ').slice(0, 80));
        ok('清单里出现了键名与「随导出」标记',
           /yzExcerpts/.test(text) && /随导出/.test(text));
        ok('说明了书籍正文需单独导出', /单独导出|IndexedDB/.test(text));
        ok('页面无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '));
        console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
        process.exit(fail ? 1 : 0);
      }, 400);
      return;
    } catch (e) {
      ok('点开概览不抛错', false, e.message);
    }
  }

  console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
  process.exit(fail ? 1 : 0);
});
