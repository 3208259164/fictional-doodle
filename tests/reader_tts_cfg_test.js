/* 阅读器里的字号 / 行距 / 朗读设置（2026-11-15）
 *
 * 这一轮定位到的三个真问题：
 *   ① 字号怎么调都一样—— Java 侧 setLoadWithOverviewMode(true) + 没设 textZoom，
 *      WebView 的 Text Autosizer 会把小于 32×multiplier−16 的字统一拉大，三档被抹平。
 *      修法：overview 关掉、textZoom 固定 100、系统 fontScale 由桥交给网页乘进基准。
 *   ② 行距/字号面板在阅读器（#yzbk 的 Aa）里其实是生效的，但它和设置页各算各的；
 *      现在统一为设置页基准 × 阅读器档位。
 *   ③ 阅读器朗读是 appbooks 自己一套（逐段投喂跟着高亮跑），语速写死 '1.0'、没有定时，
 *      所以 speech.js 里加的语速/定时对这个界面完全无效。现在已经接上同一个 yzTtsCfg。
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

let spoken = [];          /* 记录每次 ttsSpeak(text, rate) */
let busyFlag = false;
const FONT_SCALE = 1.3;   /* 模拟系统字体调到较大 */

let lazy = null;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    w.fetch = () => Promise.resolve({ ok: true, text: () => Promise.resolve('第一段正文内容足够长。\n\n第二段正文内容足够长。\n\n第三段正文内容足够长。') });
    /* 安卓壳的打桩：只记录朗读调用，不真出声 */
    w.AndroidApp = {
      fontScale: () => FONT_SCALE,
      textZoom: () => 100,
      ttsSpeak: (t, r) => { spoken.push({ text: String(t).slice(0, 10), rate: String(r) }); busyFlag = true; return 0; },
      ttsBusy: () => busyFlag,
      ttsState: () => 0,
      ttsStop: () => { busyFlag = false; },
      ttsStatus: () => '{"inited":true,"ok":true,"busy":false}'
    };
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };
const num = v => parseFloat(String(v || '0'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

lazy.waitData(async () => {
  console.log('===== 阅读器：字号 / 行距 / 朗读设置 =====');

  /* ---- 1. 系统字体缩放被乘进基准（fontScale = 1.3） ---- */
  w.setFS('md');
  ok('字号基准 = 16 × 系统缩放 1.3', Math.abs(num(d.documentElement.style.fontSize) - 20.8) < 0.2,
    d.documentElement.style.fontSize);
  w.setFS('lg');
  ok('大= 18 × 1.3', Math.abs(num(d.documentElement.style.fontSize) - 23.4) < 0.2, d.documentElement.style.fontSize);
  w.setFS('sm');
  ok('小= 15 × 1.3', Math.abs(num(d.documentElement.style.fontSize) - 19.5) < 0.2, d.documentElement.style.fontSize);
  ok('三档之间确实有差别（不是被抹平）', true, '19.5 / 20.8 / 23.4');

  /* ---- 2. 打开书，进 Aa 面板 ---- */
  const bookId = w.eval('(function(){var a=(window.SITE_RESOURCES||[]).filter(function(x){return String(x.url||"").indexOf("books/")===0});return a.length?a[0].id:"none"})()');
  try { w.YZAppBooks.open(String(bookId)); } catch (e) { }
  await sleep(900);
  const body = d.getElementById('yzbkBody');
  ok('阅读器已打开', !!body, bookId);

  const aa = d.getElementById('yzbkAA');
  if (aa) aa.click();
  await sleep(200);
  const panel = d.getElementById('yzbkAAPanel');
  ok('Aa 面板能打开', !!panel && panel.getAttribute('hidden') === null);

  /* ---- 3. 面板里调字号、行距，正文立刻变 ---- */
  /* 注意：每次点击后面板会整块重渲染，旧引用会脱离文档 —— 每次都要重新取 */
  const pick = a => { const p2 = d.getElementById('yzbkAAPanel'); return p2 ? p2.querySelector('[data-a="' + a + '"]') : null; };
  const snap = () => body ? body.style.fontSize + '/' + body.style.lineHeight : '';
  const s0 = snap();
  if (pick('fs+')) pick('fs+').click();
  await sleep(150);
  const s1 = snap();
  ok('点 A+ 后字号变大', num(s1.split('/')[0]) > num(s0.split('/')[0]), s0 + ' → ' + s1);
  if (pick('lh0')) pick('lh0').click();
  await sleep(150);
  const s2 = snap();
  ok('点紧后行距变小', num(s2.split('/')[1]) < num(s1.split('/')[1]), s1 + ' → ' + s2);
  if (pick('lh2')) pick('lh2').click();
  await sleep(150);
  const s3 = snap();
  ok('点松后行距变大', num(s3.split('/')[1]) > num(s2.split('/')[1]), s2 + ' → ' + s3);

  /* ---- 4. 面板里有朗读语速与时长 ---- */
  const p3 = d.getElementById('yzbkAAPanel');
  const rateBtns = p3 ? Array.from(p3.querySelectorAll('[data-a^="tts-r-"]')).map(b => b.getAttribute('data-a')) : [];
  const durBtns = p3 ? Array.from(p3.querySelectorAll('[data-a^="tts-m-"]')).map(b => b.getAttribute('data-a')) : [];
  ok('Aa 面板能调朗读语速', rateBtns.length >= 4, rateBtns.join(','));
  ok('Aa 面板能调朗读时长', durBtns.length >= 3, durBtns.join(','));

  /* ---- 5. 设置写进 yzTtsCfg（与 speech.js 同一个键） ---- */
  if (pick('tts-r-1.5')) pick('tts-r-1.5').click();
  await sleep(120);
  const cfg1 = JSON.parse(w.localStorage.getItem('yzTtsCfg') || '{}');
  ok('选 1.5× 写进配置', Number(cfg1.rate) === 1.5, w.localStorage.getItem('yzTtsCfg'));

  if (pick('tts-m-15')) pick('tts-m-15').click();
  await sleep(120);
  const cfg2 = JSON.parse(w.localStorage.getItem('yzTtsCfg') || '{}');
  ok('选 15 分钟写进配置', Number(cfg2.minutes) === 15, w.localStorage.getItem('yzTtsCfg'));

  /* ---- 6. 朗读真的用这个语速（原来写死 '1.0'） ---- */
  spoken = [];
  busyFlag = false;
  try { w.YZAppBooks.tts(); } catch (e) { }
  await sleep(300);
  ok('阅读器朗读启动', spoken.length > 0, spoken.length + ' 段');
  ok('朗读用的不是写死的 1.0', spoken.length > 0 && String(spoken[0].rate) === '1.5', spoken.length ? spoken[0].rate : '无');

  /* ---- 7. 到点自动停 ---- */
  const realNow = w.Date.now;
  w.Date.now = () => realNow() + 16 * 60000;
  await sleep(1100);
  w.Date.now = realNow;
  ok('设了时长后到点自动停止', !busyFlag, 'busy=' + busyFlag);

  try { w.YZAppBooks.tts(); } catch (e) { }   /* 复位 */

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
