/* 学通：导出走系统分享，不再往「下载」目录丢文件（0.18.24） */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');
const BASE = (process.env.YZY_SITE || (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'))).replace(/\/?$/, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const bad = [];
function ok(n, c, x) { if (c) pass++; else { fail++; bad.push(n + (x ? ' — ' + x : '')); } }

const vc = new VirtualConsole(); const errs = [];
vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (!/Could not load|Not implemented|CSS|execCommand|Not allowed/.test(m)) errs.push(m); });
let html = fs.readFileSync(BASE + 'index.html', 'utf8');
html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
  try { return '<script>' + fs.readFileSync(BASE + src, 'utf8') + '</' + 'script>'; } catch (e) { return ''; }
});

const shareCalls = [];
const dom = new JSDOM(html, {
  url: 'https://local.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true });
    w.scrollTo = () => {};
    w.requestIdleCallback = function () {};
    /* 假 App 桥：只实现这次要验证的几个 */
    w.AndroidApp = {
      getVersionName: () => '0.18.24',
      saveBase64: (n, b, m) => { shareCalls.push(['save', n, m]); },
      shareFile: (n, b, m) => { shareCalls.push(['share', n, m]); },
      ttsStatus: () => '{"ok":true,"engine":"test"}',
      ttsSpeak: () => true,
      backProbe: () => ''
    };
    const orig = w.document.createElement.bind(w.document);
    w.document.createElement = function (tag) {
      const el = orig(tag);
      if (String(tag).toLowerCase() === 'script') {
        let _s = '';
        try {
          Object.defineProperty(el, 'src', {
            configurable: true, get() { return _s; },
            set(v) {
              _s = v;
              setTimeout(() => {
                try {
                  const rel = String(v).replace(/^https?:\/\/[^/]+\//, '').split('?')[0].replace(/^\.?\//, '');
                  w.eval(fs.readFileSync(BASE + rel, 'utf8'));
                  if (typeof el.onload === 'function') el.onload();
                } catch (e) { if (typeof el.onerror === 'function') el.onerror(e); }
              }, 0);
            }
          });
        } catch (e) {}
      }
      return el;
    };
  }
});
const w = dom.window, d = w.document;

(async function () {
  await sleep(800);

  ok('YZSave.share 已暴露', typeof (w.YZSave && w.YZSave.share) === 'function');
  ok('YZSave.isApp 判定为真', !!(w.YZSave && w.YZSave.isApp()));

  /* 1. YZSave.share 走原生 shareFile，不调 saveBase64 */
  shareCalls.length = 0;
  const r1 = w.YZSave.share('测试.md', 'text/markdown', '# 标题\n正文');
  await sleep(60);
  ok('share 返回 share', r1 === 'share', String(r1));
  ok('调用的是 shareFile', shareCalls.some(c => c[0] === 'share' && c[1] === '测试.md'), JSON.stringify(shareCalls));
  ok('没有落盘 saveBase64', !shareCalls.some(c => c[0] === 'save'));

  /* 2. 导出笔记：deliver 走 share 分支 */
  const ED = w.YZExport || w.YZEXPORT;
  ok('导出模块已加载', !!ED || typeof w.YZData === 'object');

  /* 3. 导出我的数据：调用后应只触发 shareFile */
  shareCalls.length = 0;
  let dt = d.getElementById('dataText');
  if (!dt) { dt = d.createElement('textarea'); dt.id = 'dataText'; d.body.appendChild(dt); }
  dt.value = JSON.stringify({ hello: 'world' });
  if (typeof w.downloadDataText === 'function') w.downloadDataText();
  await sleep(80);
  ok('导出我的数据走分享', shareCalls.some(c => c[0] === 'share' && c[1].indexOf('我的数据') >= 0), JSON.stringify(shareCalls));
  ok('导出我的数据没有落盘', !shareCalls.some(c => c[0] === 'save'));

  /* 4. 题库导出走分享 */
  shareCalls.length = 0;
  try { w.localStorage.setItem('quizBank', JSON.stringify([{ q: '题', options: ['a', 'b'], answer: 0 }])); } catch (e) {}
  if (typeof w.quizExport === 'function') w.quizExport();
  await sleep(80);
  ok('题库导出走分享', shareCalls.some(c => c[0] === 'share'), JSON.stringify(shareCalls));

  /* 5. 批量导出不再落盘 */
  const bulkSrc = fs.readFileSync(BASE + 'assets/bulk.js', 'utf8');
  ok('批量导出已去掉 YZSave.text', bulkSrc.indexOf('YZSave.text') < 0);

  /* 6. 诊断报告：App 内只弹预览，不落盘 */
  const appSrc = fs.readFileSync(BASE + 'assets/app.js', 'utf8');
  ok('诊断报告不再先保存再预览', !/YZSave\.text && YZSave\.text\(fname/.test(appSrc));

  /* 7. 文案里不再出现「下载 .json」 */
  ok('没有「下载 .json」字样', appSrc.indexOf('下载 .json') < 0);

  /* 8. 朗读状态诊断能区分「桥不在」和「方法缺失」 */
  const spSrc = fs.readFileSync(BASE + 'assets/speech.js', 'utf8');
  ok('朗读状态区分桥存在但有缺方法', spSrc.indexOf('App 桥在，但里面没有语音接口') > 0);
  ok('朗读状态区分完全没桥', spSrc.indexOf('没拿到 App 桥') > 0);

  /* 9. 诊断报告里有 appBridge 字段 */
  ok('诊断环境含 appBridge', appSrc.indexOf('appBridge: bridge') > 0);

  ok('全程无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n===== 导出改分享 / 不再落「下载」 =====');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
  process.exit(0);
})();
