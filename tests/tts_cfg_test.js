/* 朗读的语速与定时（2026-11-14）
 *
 * 需求：能调语速，能设读多久就停，到点自动截止。
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
    /* 用假的 speechSynthesis 顶替系统引擎：不真出声，只把念了哪段、什么语速记下来 */
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
  ok('设不限清掉截止', S.cfg().deadline === 0, String(S.cfg().deadline));
  S.setMinutes(999);
  ok('非法时长回落到不限', S.cfg().minutes === 0, String(S.cfg().minutes));

  /* ---- 4. 面板 ---- */
  S.openCfg(d.body);
  const panel = d.getElementById('yzTtsPanel');
  ok('设置面板能打开', !!panel);
  ok('面板有语速和时长', !!panel && panel.textContent.indexOf('语速') >= 0 && panel.textContent.indexOf('时长') >= 0);
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
     按钮才会显示停止 · 剩余时间；直接 speak() 属于后台调用，不动按钮）。 */
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

  /* 把截止时间推到过去，模拟到点了 */
  const realNow = w.Date.now;
  w.Date.now = () => realNow() + 20 * 60000;
  const up = S._tick();
  w.Date.now = realNow;
  ok('到点后自动停止', up === true && S.busy() === false, 'tick=' + up + ' busy=' + S.busy());
  ok('停止后清掉截止时间', S.cfg().deadline === 0, String(S.cfg().deadline));

  /* ---- 6.5 语速：正在朗读时改，立刻用新语速重读当前段 ----
     以前要等下一段才生效，而短文本只有一段 → 用户点了 1.5× 完全没反应。 */
  const host2 = d.createElement('div');
  d.body.appendChild(host2);
  S.attach(host2, () => '这是一段用于验证语速即时生效的测试正文，需要足够长一些。');
  const btn2 = host2.querySelector('button[data-yztts]');
  spoken = [];
  if (btn2) btn2.click();
  await sleep(60);
  const before = spoken.length;
  S.openCfg(host2);
  const pnl = d.getElementById('yzTtsPanel');
  const fast = pnl && pnl.querySelector('[data-yzr="1.5"]');
  if (fast) { fast.click(); await sleep(120); }
  ok('改语速后立刻重读（不用等下一段）', spoken.length > before, before + ' → ' + spoken.length);
  ok('重读用的是新语速', spoken.length > before && Math.abs(Number(spoken[spoken.length - 1].rate) - 1.5) < 0.01,
    spoken.length ? String(spoken[spoken.length - 1].rate) : '无');
  S.stop();
  if (pnl) pnl.remove();

  /* ---- 7. 到点检查必须自己跑（不能只靠每段开始前） ----
     反例：短文本整篇一次发送，只在开头查一次 → 读 20 分钟也不会停。
     这里把引擎换成永不回调的假实现，模拟一次长朗读，再把时间推到截止之后，
     不点任何按钮、不调 _tick，等 1.5 秒看它会不会自己停。 */
  const realNow2 = w.Date.now;
  w.speechSynthesis.speak = function (u) { /* 永不结束：模拟一段很长的朗读 */ };
  S.setMinutes(15);
  S.speak('这是一段用于验证定时器会自动截止的文字。');
  await sleep(80);
  ok('长朗读进行中', S.busy() === true, 'busy=' + S.busy());
  w.Date.now = () => realNow2() + 16 * 60000;   /* 越过截止时间 */
  await sleep(1600);
  w.Date.now = realNow2;
  ok('不靠段前进检查，计时器自己到点停', S.busy() === false, 'busy=' + S.busy());
  ok('停止后截止时间被清掉', S.cfg().deadline === 0, String(S.cfg().deadline));

  S.stop();
  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
