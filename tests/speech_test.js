#!/usr/bin/env node
/* 学通 · 离线朗读（assets/speech.js）—— jsdom 实测
   覆盖：有桥 / 无桥两种降级、status 文案、toggle 开关、缺引擎提示、
        长文本分段（>4000 字符切成多段）、自动挂载按钮与状态复位。
   跑法：node tests/speech_test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
const SRC = fs.readFileSync(path.join(SITE, 'assets/speech.js'), 'utf8');

const R = [];
const ok = (n, c, x) => R.push([!!c, n, x === undefined ? '' : String(x)]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- 场景搭建 ---------- */
const READER_HTML =
  '<div id="contentView" class="panel" style="display:none">' +
    '<div id="yzReader" data-book="b1">' +
      '<div class="reader-bar">' +
        '<button>A−</button><span class="rfs">17</span><button>A＋</button>' +
        '<span style="flex:1"></span><span>共 2 段</span>' +
      '</div>' +
      '<article class="reader-body"><p>第一段：实践是检验真理的唯一标准。</p><p>第二段：没有调查就没有发言权。</p></article>' +
    '</div>' +
  '</div>';

const DETAIL_HTML =
  '<div id="contentView" class="panel" style="display:none">' +
    '<article style="text-align:left">' +
      '<h3>《共产党宣言》</h3>' +
      '<p>一个幽灵，共产主义的幽灵，在欧洲游荡。</p>' +
      '<p>至今一切社会的历史都是阶级斗争的历史。</p>' +
      '<div class="ops" style="margin-top:14px"><button class="lk-btn">🔗 添加链接</button></div>' +
      '<section class="notes"><h2 class="rl-title">📝 我的笔记</h2><textarea></textarea></section>' +
    '</article>' +
  '</div>';

function mockBridge(cfg) {
  cfg = cfg || {};
  const calls = { speak: [], stop: 0, status: 0 };
  let busy = false;
  return {
    ttsStatus() {
      calls.status++;
      return JSON.stringify(cfg.status || {
        ok: true, lang: 'zh-CN', engine: 'com.google.android.tts', reason: '',
        inited: true, busy: busy, rate: 1.0, engineCount: 2
      });
    },
    ttsSpeak(t, r) {
      calls.speak.push({ t: String(t), r: String(r) });
      busy = true;
      setTimeout(() => { busy = false; }, cfg.busyMs || 60);
      return '{"ok":true,"seg":1}';
    },
    ttsStop() { calls.stop++; busy = false; },
    ttsBusy() { return busy; },
    _calls: calls
  };
}

function newWin(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true
  });
  const w = dom.window;
  w.__toasts = [];
  w.toast = (m) => w.__toasts.push(String(m));
  /* jsdom 没有 speechSynthesis / SpeechSynthesisUtterance：默认置空，需要时再装 */
  if (opts.synth) {
    const spoken = [];
    w.__spoken = spoken;
    w.SpeechSynthesisUtterance = function (text) {
      this.text = text; this.lang = ''; this.rate = 1;
      this.onend = null; this.onerror = null;
    };
    w.speechSynthesis = {
      speak(u) { spoken.push(u); },
      cancel() { w.__cancelled = (w.__cancelled || 0) + 1; },
      getVoices() { return opts.voices === undefined ? [{ lang: 'zh-CN', name: 'Mandarin' }] : opts.voices; }
    };
  }
  if (opts.html) w.document.body.innerHTML = opts.html;
  if (opts.bridge) w.AndroidApp = opts.bridge;
  w.eval(SRC);
  return { dom, w };
}

/* 一段足够长的中文正文（> 4000 字符，且句子完整） */
function longText(n) {
  const unit = '实践是检验真理的唯一标准，人民群众是历史的创造者。';
  let s = '';
  while (s.length < n) s += unit;
  return s.slice(0, n);
}

(async function run() {
  /* ================= ① 无桥、无 speechSynthesis：彻底不支持 ================= */
  {
    const { w } = newWin({});
    ok('① 无桥无合成 → available() 为 false', w.YZSPEECH.available() === false);
    const st = w.YZSPEECH.status();
    ok('① 无桥无合成 → status() 说明不支持', /不支持语音朗读/.test(st), st);
    const r = w.YZSPEECH.speak('测试文字');
    ok('① 无桥无合成 → speak() 返回 false', r === false);
    ok('① 无桥无合成 → 有 toast 提示', w.__toasts.length >= 1, w.__toasts.join('|'));
    const d = w.YZSPEECH.diagnose();
    ok('① diagnose() mode=none 且 ok=false', d.mode === 'none' && d.ok === false, JSON.stringify(d.mode));
  }

  /* ================= ② 有桥 + 引擎正常 ================= */
  {
    const bridge = mockBridge();
    const { w } = newWin({ bridge, html: READER_HTML });
    w.YZSPEECH._poll(40);
    ok('② 有桥 → available() 为 true', w.YZSPEECH.available() === true);
    const st = w.YZSPEECH.status();
    ok('② status() 含引擎包名', /com\.google\.android\.tts/.test(st), st);
    ok('② status() 标记可用', /原生朗读可用/.test(st), st);

    /* 短文本：一次 ttsSpeak */
    w.YZSPEECH.speak('第一段：实践是检验真理的唯一标准。');
    ok('② speak() 调用了原生 ttsSpeak', bridge._calls.speak.length === 1, bridge._calls.speak.length);
    ok('② 透传的文字正确', bridge._calls.speak[0].t.indexOf('实践是检验') >= 0, bridge._calls.speak[0].t.slice(0, 14));
    ok('② 默认语速为 1', bridge._calls.speak[0].r === '1', bridge._calls.speak[0].r);
    ok('② 朗读中 busy() 为 true', w.YZSPEECH.busy() === true);

    /* toggle：先停 */
    const t1 = w.YZSPEECH.toggle('再来一段');
    ok('② 朗读中 toggle() 返回 stop', t1 === 'stop', t1);
    ok('② toggle 停止时调用了 ttsStop', bridge._calls.stop >= 1, bridge._calls.stop);
    ok('② 停止后 busy() 为 false', w.YZSPEECH.busy() === false);
    /* 再开 */
    const t2 = w.YZSPEECH.toggle('重新开始朗读');
    ok('② 停止后 toggle() 重新开始', t2 === 'speak', t2);
    w.YZSPEECH.stop();
  }

  /* ================= ③ 语速参数 ================= */
  {
    const bridge = mockBridge();
    const { w } = newWin({ bridge });
    w.YZSPEECH.speak('文字', 1.5);
    ok('③ 语速 1.5 透传', bridge._calls.speak[0].r === '1.5', bridge._calls.speak[0].r);
    w.YZSPEECH.speak('文字', 'abc');
    ok('③ 非法语速回落 1', bridge._calls.speak[1].r === '1', bridge._calls.speak[1].r);
    w.YZSPEECH.speak('文字', 9);
    ok('③ 超范围语速夹紧 2', bridge._calls.speak[2].r === '2', bridge._calls.speak[2].r);
    w.YZSPEECH.speak('文字', 0.1);
    ok('③ 过小语速夹紧 0.5', bridge._calls.speak[3].r === '0.5', bridge._calls.speak[3].r);
    w.YZSPEECH.stop();
  }

  /* ================= ④ 长文本分段（>4000 字符） ================= */
  {
    const bridge = mockBridge({ busyMs: 30 });
    const { w } = newWin({ bridge });
    w.YZSPEECH._poll(30);
    const text = longText(5600);
    w.YZSPEECH.speak(text);
    ok('④ 长文首次只发第一段', bridge._calls.speak.length === 1, bridge._calls.speak.length);
    await sleep(500);   /* 等轮询把后续段落喂完 */
    const calls = bridge._calls.speak;
    ok('④ 长文被切成多段调用 ttsSpeak', calls.length >= 2, calls.length);
    ok('④ 每段都不超过引擎上限', calls.every(c => c.t.length <= 4000), calls.map(c => c.t.length).join(','));
    const joined = calls.map(c => c.t).join('').replace(/\s/g, '');
    ok('④ 分段后无丢字无重复', joined === text.replace(/\s/g, ''), joined.length + '/' + text.length);
    ok('④ 全部读完后 busy() 自动复位', w.YZSPEECH.busy() === false);

    /* 切段函数本身 */
    const cs = w.YZSPEECH.chunkText(longText(9000), 3800);
    ok('④ chunkText 切出 3 段', cs.length === 3, cs.length);
    ok('④ chunkText 每段不超限', cs.every(s => s.length <= 3800), cs.map(s => s.length).join(','));
  }

  /* ================= ⑤ 缺中文引擎：不静默失败 ================= */
  {
    const bridge = mockBridge({
      status: { ok: false, lang: 'zh-CN', engine: 'com.android.shell', reason: '引擎不支持中文（请安装/启用中文语音引擎）', inited: true, busy: false }
    });
    const { w } = newWin({ bridge });
    const st = w.YZSPEECH.status();
    ok('⑤ 缺引擎 → status() 含「不可用」', /原生朗读不可用/.test(st), st);
    const r = w.YZSPEECH.speak('这段文字');
    ok('⑤ 缺引擎 → speak() 返回 false', r === false);
    ok('⑤ 缺引擎 → 提示去系统设置安装',
      w.__toasts.some(m => /没有可用的中文语音引擎/.test(m) && /系统设置/.test(m)), w.__toasts.join('|'));
    ok('⑤ 缺引擎 → 没有调用 ttsSpeak', bridge._calls.speak.length === 0, bridge._calls.speak.length);
    const d = w.YZSPEECH.diagnose();
    ok('⑤ diagnose() 给出可读原因', d.ok === false && /不支持中文/.test(d.reason), d.reason);
  }

  /* ================= ⑥ 引擎尚未初始化（异步）不误判 ================= */
  {
    const bridge = mockBridge({ status: { ok: false, lang: 'zh-CN', engine: '', reason: '', inited: false, busy: false } });
    const { w } = newWin({ bridge });
    const st = w.YZSPEECH.status();
    ok('⑥ 初始化中 → status() 说「正在初始化」', /正在初始化/.test(st), st);
    const r = w.YZSPEECH.speak('初始化中的文字');
    ok('⑥ 初始化中仍把文字交给原生（不提前判死）', r === true && bridge._calls.speak.length === 1, bridge._calls.speak.length);
    w.YZSPEECH.stop();
  }

  /* ================= ⑦ 无桥 + speechSynthesis 降级 ================= */
  {
    const { w } = newWin({ synth: true, html: READER_HTML });
    ok('⑦ 无桥有合成 → available() 为 true', w.YZSPEECH.available() === true);
    const st = w.YZSPEECH.status();
    ok('⑦ status() 描述浏览器合成', /浏览器语音合成/.test(st), st);
    w.YZSPEECH.speak('用浏览器念这段话');
    ok('⑦ 走了 speechSynthesis', w.__spoken.length === 1, w.__spoken.length);
    ok('⑦ utterance 语言为 zh-CN', w.__spoken[0].lang === 'zh-CN', w.__spoken[0].lang);
    /* 模拟 onend → 自动复位 */
    await sleep(20);
    if (w.__spoken[0] && w.__spoken[0].onend) w.__spoken[0].onend();
    ok('⑦ 读完后自动复位（busy=false）', w.YZSPEECH.busy() === false);

    const text = longText(5200);
    w.YZSPEECH.speak(text);
    await sleep(20);
    ok('⑦ 浏览器分支也分段朗读', w.__spoken.length === 2, w.__spoken.length);
    /* 依次触发 onend，把队列读完 */
    let guard = 0;
    while (w.YZSPEECH.busy() && guard++ < 12) {
      const last = w.__spoken[w.__spoken.length - 1];
      if (last && last.onend) last.onend();
      await sleep(10);
    }
    ok('⑦ 浏览器分支读完全部后复位',
      w.YZSPEECH.busy() === false && w.__spoken.length >= 3 && w.__spoken.every(u => u.text.length <= 4000),
      'utterance=' + w.__spoken.length);
    /* 停止要 cancel */
    w.YZSPEECH.speak('再念一段');
    w.YZSPEECH.stop();
    ok('⑦ stop() 调用了 speechSynthesis.cancel', (w.__cancelled || 0) >= 1, w.__cancelled);
  }

  /* ================= ⑧ 自动挂载：书阅读器 ================= */
  {
    const bridge = mockBridge({ busyMs: 30 });
    const { w } = newWin({ bridge, html: READER_HTML });
    w.YZSPEECH._poll(30);
    await sleep(200);   /* 等 MutationObserver → scan */
    const bar = w.document.querySelector('#yzReader .reader-bar');
    const btn = bar && bar.querySelector('button[data-yztts]');
    ok('⑧ 阅读器工具条里挂上了朗读按钮', !!btn);
    ok('⑧ 按钮文案是「🔊 朗读」', !!btn && /朗读/.test(btn.textContent), btn && btn.textContent);
    ok('⑧ 按钮没有破坏原有工具条', bar.querySelectorAll('button').length === 3, bar.querySelectorAll('button').length);

    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await sleep(40);
    ok('⑧ 点按钮 → 调用 ttsSpeak', bridge._calls.speak.length === 1, bridge._calls.speak.length);
    ok('⑧ 点按钮 → 读的是正文而不是按钮文字',
      bridge._calls.speak[0].t.indexOf('第一段') >= 0 && bridge._calls.speak[0].t.indexOf('第二段') > 0,
      JSON.stringify(bridge._calls.speak[0].t.slice(0, 30)));
    ok('⑧ 朗读中按钮变「⏹ 停止」', /停止/.test(btn.textContent), btn.textContent);
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await sleep(40);
    ok('⑧ 再点 → 停止并复位文案', /朗读/.test(btn.textContent) && bridge._calls.stop >= 1, btn.textContent);

    /* 离开阅读器（节点被换掉）→ 自动停 */
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await sleep(30);
    const yz = w.document.getElementById('yzReader');
    yz.parentNode.removeChild(yz);
    await sleep(200);
    ok('⑧ 阅读区消失 → 自动停止', w.YZSPEECH.busy() === false);
  }

  /* ================= ⑨ 自动挂载：资源详情页 ================= */
  {
    const bridge = mockBridge({ busyMs: 30 });
    const { w } = newWin({ bridge, html: DETAIL_HTML });
    w.YZSPEECH._poll(30);
    await sleep(200);
    const ops = w.document.querySelector('#contentView article .ops');
    const btn = ops && ops.querySelector('button[data-yztts]');
    ok('⑨ 详情页 .ops 里挂上了朗读按钮', !!btn);
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    await sleep(40);
    const said = bridge._calls.speak[0] ? bridge._calls.speak[0].t : '';
    ok('⑨ 详情页读到标题+正文', said.indexOf('共产党宣言') >= 0 && said.indexOf('幽灵') >= 0, JSON.stringify(said.slice(0, 24)));
    ok('⑨ 详情页不把「我的笔记」正文读进去', said.indexOf('我的笔记') < 0, JSON.stringify(said.slice(-20)));
    w.YZSPEECH.stop();
  }

  /* ================= ⑩ attach() 手动挂载 ================= */
  {
    const { w } = newWin({ bridge: mockBridge() });
    const box = w.document.createElement('div');
    box.id = 'myBox';
    box.textContent = '手动挂载的正文';
    w.document.body.appendChild(box);
    const btn = w.YZSPEECH.attach(box, () => '手动挂载的正文');
    ok('⑩ attach() 返回按钮并插入 DOM', !!btn && box.contains(btn));
    ok('⑩ attach() 幂等（不重复插）', (function () {
      w.YZSPEECH.attach(box, () => '手动挂载的正文');
      return box.querySelectorAll('button[data-yztts]').length === 1;
    })());
  }

  /* ---------- 汇总 ---------- */
  const bad = R.filter(r => !r[0]);
  R.forEach(r => console.log((r[0] ? '  ✅ ' : '  ❌ ') + r[1] + (r[0] || !r[2] ? '' : '   → ' + r[2])));
  console.log('\n共 ' + R.length + ' 项断言，通过 ' + (R.length - bad.length) + ' 项，失败 ' + bad.length + ' 项');
  if (bad.length) {
    console.log('\n失败项：');
    bad.forEach(r => console.log('  - ' + r[1] + (r[2] ? '   → ' + r[2] : '')));
    process.exit(1);
  }
  console.log('speech.js 全部通过 ✅');
  process.exit(0);
})().catch(e => {
  console.error('测试崩溃：', e);
  process.exit(2);
});
