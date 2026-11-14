/* 朗读的语速与定时（2026-11-14）
 *
 * 需求：能调语速，能设「读多久就停」，到点自动截止。
 * 实现要点：
 *   · 语速走系统 TTS（setSpeechRate，0.5~2.0，1.0 常速），档位 0.7/0.85/1/1.2/1.5
 *   · 定时不另起计时器：分段朗读本来就在轮询，每段开始前检查 deadline，
 *     切后台轮询暂停、回来继续，不会像 setTimeout 那样被冻结后一次性爆发
 *   · 偏好存 localStorage yzTtsCfg，下次打开还在
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
let spoken = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    /* 用假的 speechSynthesis 顶替系统引擎：不真出声，只把「念了哪段、什么语速」记下来 */
    w.SpeechSynthesisUtterance = function (t) { this.text = t; };
    Object.defineProperty(w, 'speechSynthesis', {
      configurable: true,
      value: {
        /* 回调故意慢 400ms：太快的话测试还没检查按钮文案，一段已经读完自动收尾了 */
        speak(u) { spoken.push({ text: u.text, rate: u.rate }); if (u.onend) setTimeout(u.onend, 400); },
        cancel() {}, pause() {}, resume() {}, getVoices() { return [{ lang: 'zh-CN', name: 'test' }]; }
      }
    });
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

lazy.waitData(async () => {
  console.log('===== 朗读：语速 / 定时截止 =====');
  /* speech.js 是按需加载的，测试里手动注入 */
  try { w.eval(fs.readFileSync(path.join(SITE, 'assets/speech.js'), 'utf8')); } catch (e) { }
  ok('YZSPEECH 已加载', !!w.YZSPEECH);
  const S = w.YZSPEECH;
  if (!S) { console.log('中止'); process.exit(1); }

  ok('暴露语速/时长接口', typeof S.setRate === 'function' && typeof S.setMinutes === 'function');
  ok('导出档位表', Array.isArray(S.RATE_STEPS) && S.RATE_STEPS.length >= 4, S.RATE_STEPS && S.RATE_STEPS.join('/'));
  ok('时长档位含 15/30/60', (S.DUR_STEPS || []).join(',') === '0,15,30,60', (S.DUR_STEPS || []).join(','));

  /* ---- 1. 默认值 ---- */
  w.localStorage.removeItem('yzTtsCfg');
  const c0 = S.cfg();
  ok('默认语速 1.0、不限时长', Number(c0.rate) === 1 && c0.minutes === 0, JSON.stringify(c0));

  /* ---- 2. 语速 ---- */
  S.setRate(1.5);
  ok('setRate(1.5) 生效', Number(S.cfg().rate) === 1.5, String(S.cfg().rate));
  ok('语速写进 localStorage', String(w.localStorage.getItem('yzTtsCfg')).indexOf('1.5') >= 0, w.localStorage.getItem('yzTtsCfg'));
  S.setRate(-5);
  ok('越界语速被夹回合法区间', Number(S.cfg().rate) >= 0.5 && Number(S.cfg().rate) <= 2, String(S.cfg().rate));
  S.setRate(1.2);

  /* ---- 3. 时长 ---- */
  const t0 = Date.now();
  S.setMinutes(15);
  const c1 = S.cfg();
  ok('setMinutes(15) 记下时长', c1.minutes === 15, JSON.stringify(c1));
  ok('截止时间 ≈ 15 分钟后', c1.deadline > t0 + 14 * 60000 && c1.deadline < t0 + 16 * 60000, new Date(c1.deadline).toISOString());
  S.setMinutes(0);
  ok('设「不限」清掉截止', S.cfg().deadline === 0, String(S.cfg().deadline));
  S.setMinutes(999);
  ok('非法时长回落到「不限」', S.cfg().minutes === 0, String(S.cfg().minutes));

  /* ---- 4. 面板 ---- */
  S.openCfg(d.body);
  const panel = d.getElementById('yzTtsPanel');
  ok('设置面板能打开', !!panel);
  ok('面板有「语速」和「时长」', !!panel && panel.textContent.indexOf('语速') >= 0 && panel.textContent.indexOf('时长') >= 0);
  const rateBtn = panel && panel.querySelector('[data-yzr="1.2"]');
  ok('面板里有语速档位按钮', !!rateBtn, rateBtn ? rateBtn.textContent : '无');
  if (rateBtn) {
    rateBtn.click();
    ok('点语速按钮后设置生效', Number(S.cfg().rate) === 1.2, String(S.cfg().rate));
  }
  const durBtn = panel && panel.querySelector('[data-yzm="30"]');
  if (durBtn) {
    durBtn.click();
    ok('点时长按钮后记下 30 分钟', S.cfg().minutes === 30, String(S.cfg().minutes));
    ok('点时长按钮后立刻算出截止时间', S.cfg().deadline > Date.now(), new Date(S.cfg().deadline).toISOString().slice(11, 19));
  }
  S.setMinutes(15);

  /* ---- 5. 真的朗读一段：语速要传给引擎 ---- */
  spoken = [];
  S.speak('这是一段用于验证朗读语速的测试文字。');
  await sleep(120);
  ok('开始朗读（引擎收到内容）', spoken.length > 0, spoken.length + ' 段');
  ok('朗读使用设置的语速', spoken.length > 0 && Math.abs(Number(spoken[0].rate) - 1.2) < 0.01, spoken.length ? String(spoken[0].rate) : '无');

  /* ---- 6. 到点自动截止 ----
     先按真实入口走一遍：挂按钮 → 点按钮开始朗读（这样 ownerKey 才会被设上，
     按钮才会显示「停止 · 剩余时间」；直接 speak() 属于后台调用，不动按钮）。 */
  const host = d.createElement('div');
  d.body.appendChild(host);
  S.attach(host, () => '这是一段用于验证定时朗读的测试正文。');
  const ttsBtn = host.querySelector('button[data-yztts]');
  ok('朗读按钮与设置按钮都挂上了', !!ttsBtn && !!host.querySelector('button[data-yzttscfg]'),
    ttsBtn ? ttsBtn.textContent + ' / ⚙' : '无');
  S.setMinutes(15);
  if (ttsBtn) ttsBtn.click();
  await sleep(80);
  ok('朗读进行中', S.busy() === true, 'busy=' + S.busy());
  ok('朗读中按钮显示剩余时间', (function () {
    const btns = Array.from(d.querySelectorAll('button[data-yztts]'));
    return btns.some(b => b.textContent.indexOf('·') >= 0 && /\d+:\d\d/.test(b.textContent));
  })(), (Array.from(d.querySelectorAll('button[data-yztts]')).map(b => b.textContent).join(' / ') || '无按钮'));

  /* 把截止时间推到过去，模拟「到点了」 */
  const realNow = w.Date.now;
  w.Date.now = () => realNow() + 20 * 60000;
  const up = S._tick();
  w.Date.now = realNow;
  ok('到点后自动停止', up === true && S.busy() === false, 'tick=' + up + ' busy=' + S.busy());
  ok('停止后清掉截止时间', S.cfg().deadline === 0, String(S.cfg().deadline));

  S.stop();
  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
