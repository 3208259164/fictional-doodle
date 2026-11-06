/* 学通：懒加载模块「要用时才拉」（0.18.24）
   背景：speech/zoompane/photo/selftest/quote-match/exportdata/booknote/mine/editor
        这 9 个被挪进懒加载队列尾部，用户点了才发现在排队 → 看着像功能没了。
   本测试锁住：need/guard 能现拉、不重复拉、到货后接着执行。 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');
const BASE = (process.env.YZY_SITE || (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'))).replace(/\/?$/, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const bad = [];
function ok(n, c, x) { if (c) pass++; else { fail++; bad.push(n + (x ? ' — ' + x : '')); } }

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (!/Could not load|Not implemented|CSS|execCommand/.test(m)) errs.push(m); });
let html = fs.readFileSync(BASE + 'index.html', 'utf8');
html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
  try { return '<script>' + fs.readFileSync(BASE + src, 'utf8') + '</' + 'script>'; } catch (e) { return ''; }
});
const loads = [];      // 记录懒加载/按需加载了哪些文件
const block = new Set(); // 故意「卡住」的文件（模拟还在排队）
let holdQueue = true;   // 队列先不动，方便验证「用到时才拉」

const dom = new JSDOM(html, {
  url: 'https://local.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true });
    w.scrollTo = () => {};
    /* 关键：让队列停在原地（真正模拟「模块还在排队」）。
       lazydata 的每一步都走 requestIdleCallback，这里给一个永不回调的实现。 */
    w.requestIdleCallback = function () { };
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
              const rel = String(v).replace(/^https?:\/\/[^/]+\//, '').split('?')[0].replace(/^\.?\//, '');
              loads.push(rel);
              if (block.has(rel)) return;               // 卡住不回
              setTimeout(() => {
                try {
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
  await sleep(600);
  ok('YZData.need 已暴露', typeof w.YZData.need === 'function');
  ok('YZData.guard 已暴露', typeof w.YZData.guard === 'function');

  /* 1. 现拉一个还没加载的文件 */
  const before = loads.filter(x => x === 'assets/speech.js').length;
  delete w.YZSPEECH;
  let got = null;
  w.YZData.need('assets/speech.js', ok2 => { got = ok2; });
  await sleep(300);
  ok('need 拉取成功并回调 true', got === true, String(got));
  ok('拉完后全局就位', typeof w.YZSPEECH === 'object');
  ok('确实加载了一次', loads.filter(x => x === 'assets/speech.js').length === before + 1);

  /* 2. 重复 need 不会重复加载 */
  const t1 = Date.now();
  let c2 = null;
  w.YZData.need('assets/speech.js', ok2 => { c2 = ok2; });
  await sleep(120);
  ok('已加载的文件再 need 立刻回调', c2 === true);
  ok('没有重复插入脚本', loads.filter(x => x === 'assets/speech.js').length === before + 1);

  /* 3. 并发 need 同一个文件：只加载一次，回调都给到 */
  delete w.YZPhoto;
  const n0 = loads.filter(x => x === 'assets/photo.js').length;
  let hits = 0;
  w.YZData.need('assets/photo.js', () => hits++);
  w.YZData.need('assets/photo.js', () => hits++);
  w.YZData.need('assets/photo.js', () => hits++);
  await sleep(300);
  ok('并发 need 只加载一次', loads.filter(x => x === 'assets/photo.js').length === n0 + 1, String(loads.filter(x => x === 'assets/photo.js').length - n0));
  ok('三个回调都执行', hits === 3, String(hits));

  /* 4. guard：已在 → 同步执行；不在 → 加载后执行 */
  let ran = 0;
  w.YZData.guard('YZPhoto', 'assets/photo.js', () => ran++);
  ok('guard 全局已存在时同步执行', ran === 1, String(ran));
  delete w.YZQUOTE;
  let ran2 = 0;
  w.YZData.guard('YZQUOTE', 'assets/quote-match.js', () => ran2++);
  ok('guard 全局缺失时不立刻执行', ran2 === 0);
  await sleep(400);
  ok('guard 加载完成后执行', ran2 === 1, String(ran2));

  /* 5. 卡住的文件：need 会等待，不会误报成功 */
  block.add('assets/mine.js');
  delete w.openMine; delete w.YZMine;
  let state5 = 'pending';
  w.YZData.need('assets/mine.js', ok2 => { state5 = ok2 ? 'ok' : 'fail'; });
  await sleep(300);
  ok('卡住时回调不触发（等得到）', state5 === 'pending', state5);

  /* 6. 入口函数存在性：几个包装函数都应该在 */
  ok('yzOpenMine 存在', typeof w.yzOpenMine === 'function');
  ok('yzBootEditor 存在', typeof w.yzBootEditor === 'function');
  ok('yzBookNoteLazy 存在', typeof w.yzBookNoteLazy === 'function');
  ok('yzSelfTest 存在', typeof w.yzSelfTest === 'function');

  /* 7. 调 yzSelfTest 后 selftest 模块被拉起 */
  const s0 = loads.filter(x => x === 'assets/selftest.js').length;
  if (typeof w.yzSelfTest === 'function') w.yzSelfTest();
  await sleep(400);
  ok('点自测会现拉 selftest.js', loads.filter(x => x === 'assets/selftest.js').length > s0 || !!w.YZSELFTEST);

  /* 8. 队列本身不重复加载已就绪的文件 */
  const dup = {};
  loads.forEach(x => { dup[x] = (dup[x] || 0) + 1; });
  const dups = Object.keys(dup).filter(k => dup[k] > 1 && k !== 'assets/speech.js' && k !== 'assets/photo.js');
  ok('队列没有重复加载同名文件', dups.length === 0, dups.slice(0, 5).join(','));

  ok('全程无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n===== 懒加载「要用时再拉」 =====');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
  process.exit(0);
})();
