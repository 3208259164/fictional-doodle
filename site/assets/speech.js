/* =====================================================================
   学通 · 离线朗读（speech.js）
   ---------------------------------------------------------------------
   只用本机能力，绝不联网，不加载任何外部资源：

     ① 有安卓壳（AndroidApp.ttsStatus 存在）→ 走系统 TTS：
        AndroidApp.ttsStatus() / ttsSpeak(text, rate) / ttsStop() / ttsBusy()
        完全离线，中文引擎由系统提供（缺引擎时明确提示去系统设置装）。
     ② 没有壳（电脑浏览器 / 其它 WebView）→ 退回 window.speechSynthesis。

   挂载：本文件不改 app.js / index.html —— 自己在 DOM 上等「正文阅读区域」
   出现（MutationObserver + 低频补扫），往合适位置插一个 🔊 朗读按钮：
     · 本机书籍内置阅读器：#yzReader 的 .reader-bar（读 .reader-body）
     · 资源详情页正文：#contentView article 里的 .ops（读标题 + 正文段落）
   按钮样式复用站点已有的 sbtn / .ops button，不新增 CSS。

   对外接口（window.YZSPEECH）：
     available()            有没有可用的朗读通道（原生桥优先，其次 speechSynthesis）
     status()               一句中文描述，给「设置 → 诊断」用
     diagnose()             结构化诊断 { mode, ok, reason, status, … }
     speak(text, rate)      朗读一段文字（内部按 3800 字符切段）
     stop()                 停止朗读并复位按钮
     toggle(text)           正在读就停，否则读
     toggleFrom(key)        给按钮用：按挂载点 key 取正文再 toggle
     attach(el, getText)    手动挂载按钮（主 agent 需要时可用）
     busy()                 是否正在朗读
     chunkText(text, max)   切段函数（导出便于自测）
   ===================================================================== */
(function () {
  'use strict';

  var MAX_CHUNK = 3800;      /* 系统引擎单次上限约 4000 字符，留余量 */
  var POLL_MS = 300;         /* 原生分支轮询 ttsBusy 的间隔 */
  var IDLE_TICKS = 2;        /* 连续几次「不忙」才算这一段读完了（避开启动瞬间的抖动） */
  var SCAN_MS = 1200;        /* 低频补扫（MutationObserver 之外兜底） */
  var BTN_ATTR = 'data-yztts';
  var EMPTY_TIP = '本机没有可用的中文语音引擎，请到系统设置安装';

  var speaking = false;
  var ownerKey = '';         /* 当前朗读的挂载点 key：换页就停 */
  var curText = '';
  var chunks = [];
  var chunkIdx = 0;
  var rateNow = 1.0;
  var pollTimer = null;
  var idleTicks = 0;
  var scanTimer = null;
  var observer = null;
  var registry = {};         /* key -> { btn, getText } */
  var lastStatus = null;

  /* ---------------- 小工具 ---------------- */
  function say(msg) {
    try { if (typeof window.toast === 'function') { window.toast(msg); return; } } catch (e) {}
    try { if (window.console && console.log) console.log('[YZSPEECH] ' + msg); } catch (e) {}
  }
  function bridge() {
    try {
      var a = window.AndroidApp;
      if (a && typeof a.ttsStatus === 'function' && typeof a.ttsSpeak === 'function') return a;
    } catch (e) {}
    return null;
  }
  function synth() {
    try { return (window.speechSynthesis && typeof window.speechSynthesis.speak === 'function') ? window.speechSynthesis : null; } catch (e) { return null; }
  }
  function voices() {
    try { var v = window.speechSynthesis.getVoices(); return (v && v.length) ? Array.prototype.slice.call(v) : []; } catch (e) { return []; }
  }
  function isZh(v) {
    try {
      var l = String((v && (v.lang || v.language)) || '').toLowerCase();
      return l.indexOf('zh') === 0 || l.indexOf('cmn') === 0 || l.indexOf('yue') === 0;
    } catch (e) { return false; }
  }
  function nativeStatus() {
    var b = bridge();
    if (!b) return null;
    try {
      var s = b.ttsStatus();
      if (!s) return null;
      var o = (typeof s === 'string') ? JSON.parse(s) : s;
      lastStatus = o;
      return o;
    } catch (e) { return null; }
  }
  function norm(t) {
    var s = String(t == null ? '' : t);
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+/g, ' ');
    s = s.replace(/\n{3,}/g, '\n\n').replace(/^[\s\n]+/, '').replace(/[\s\n]+$/, '');
    return s;
  }
  function normRate(r) {
    var v = parseFloat(r);
    if (!isFinite(v) || v <= 0) v = 1.0;
    if (v < 0.5) v = 0.5;
    if (v > 2.0) v = 2.0;
    return v;
  }

  /* ---------------- 切段（长文必须分段，否则引擎截断/报错） ---------------- */
  var CUT_CHARS = '\n。！？；…!?;';
  function chunkText(text, max) {
    var out = [];
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    max = parseInt(max, 10) || MAX_CHUNK;
    var i = 0, n = s.length;
    while (i < n) {
      var end = Math.min(n, i + max);
      if (end < n) {
        var floor = Math.max(i + 1, end - Math.floor(max / 5));
        var cut = -1;
        for (var p = end - 1; p >= floor; p--) {
          if (CUT_CHARS.indexOf(s.charAt(p)) >= 0) { cut = p + 1; break; }
        }
        if (cut > i) end = cut;
      }
      var seg = s.slice(i, end).replace(/^[\s]+/, '').replace(/[\s]+$/, '');
      if (seg) out.push(seg);
      i = end;
    }
    return out;
  }

  /* ---------------- 状态 ---------------- */
  function available() {
    if (bridge()) return true;
    return !!synth();
  }

  function status() {
    var b = bridge();
    if (b) {
      var st = nativeStatus() || {};
      if (st.ok === true) {
        var eng = st.engine ? String(st.engine) : '系统默认引擎';
        return '原生朗读可用 · 引擎 ' + eng + ' · 语种 ' + (st.lang || 'zh-CN') + (st.busy ? ' · 正在朗读' : '');
      }
      if (st.inited === false) return '原生朗读引擎正在初始化…' + (st.reason ? '（' + st.reason + '）' : '');
      return '原生朗读不可用：' + (st.reason || '系统里没有可用的中文语音引擎，请到系统设置安装');
    }
    var sy = synth();
    if (sy) {
      var vs = voices();
      var zh = 0;
      for (var i = 0; i < vs.length; i++) { if (isZh(vs[i])) zh++; }
      if (!vs.length) return '浏览器语音合成可用 · 语音列表尚未就绪（首次朗读时会加载）';
      return '浏览器语音合成 · 共 ' + vs.length + ' 个语音，中文 ' + zh + ' 个' + (zh ? '' : '（可能读不出中文）');
    }
    return '本机不支持语音朗读（既没有原生桥，也没有 speechSynthesis）';
  }

  function diagnose() {
    var b = bridge(), sy = synth();
    var d = {
      mode: b ? 'native' : (sy ? 'web' : 'none'),
      status: status(),
      busy: speaking,
      chunk: MAX_CHUNK
    };
    if (b) {
      var st = nativeStatus() || {};
      d.native = st;
      d.ok = st.ok === true;
      d.engine = st.engine || '';
      d.lang = st.lang || '';
      if (d.ok) d.reason = '';
      else if (st.inited === false) d.reason = '引擎初始化中' + (st.reason ? '：' + st.reason : '');
      else d.reason = st.reason || EMPTY_TIP;
    } else if (sy) {
      var vs = voices(), zh = 0;
      for (var i = 0; i < vs.length; i++) { if (isZh(vs[i])) zh++; }
      d.ok = true;              /* 浏览器分支无法先验判定，实践上总能读，只是音色不同 */
      d.voices = vs.length;
      d.zhVoices = zh;
      d.reason = zh ? '' : (vs.length ? '浏览器里没有中文语音，可能读不出中文' : '语音列表尚未加载');
    } else {
      d.ok = false;
      d.reason = '既没有原生 TTS 桥，也没有 speechSynthesis';
    }
    return d;
  }

  /* ---------------- 原生分支：网页自己切段，逐段喂给原生 ---------------- */
  function canUseBusy(b) {
    try { return typeof b.ttsBusy === 'function'; } catch (e) { return false; }
  }
  function busyOf(b) {
    try {
      if (typeof b.ttsBusy === 'function') return !!b.ttsBusy();
      var st = b.ttsStatus();
      var o = (typeof st === 'string') ? JSON.parse(st || '{}') : (st || {});
      return !!o.busy;
    } catch (e) { return false; }
  }

  function nativeSpeak(b, t, rate) {
    var st = nativeStatus() || {};
    /* 已经确定没有中文引擎：别静默失败，直接告诉用户去哪儿装 */
    if (st.inited === true && st.ok !== true) {
      say(EMPTY_TIP);
      return false;
    }
    rateNow = rate;
    chunks = canUseBusy(b) ? chunkText(t, MAX_CHUNK) : [t];
    if (!chunks.length) { say('没有可朗读的文字'); return false; }
    chunkIdx = 0;
    idleTicks = 0;
    speaking = true;
    ownerKey = ownerKey || '';
    refresh();
    if (!sendChunk()) return false;
    pollNative();
    return true;
  }

  function sendChunk() {
    var b = bridge();
    if (!speaking || !b) return false;
    if (chunkIdx >= chunks.length) { finish(); return false; }
    var seg = chunks[chunkIdx++];
    try {
      b.ttsSpeak(seg, String(rateNow));
    } catch (e) {
      finish();
      say('朗读启动失败：' + ((e && e.message) ? e.message : e));
      return false;
    }
    idleTicks = 0;
    return true;
  }

  function pollNative() {
    stopPoll();
    pollTimer = setInterval(function () {
      var b = bridge();
      if (!speaking) { stopPoll(); return; }
      if (!b) { finish(); return; }
      if (busyOf(b)) { idleTicks = 0; return; }
      idleTicks++;
      if (idleTicks < IDLE_TICKS) return;
      idleTicks = 0;
      if (chunkIdx < chunks.length) sendChunk();
      else finish();
    }, POLL_MS);
  }
  function stopPoll() {
    if (pollTimer) { try { clearInterval(pollTimer); } catch (e) {} pollTimer = null; }
    idleTicks = 0;
  }

  /* ---------------- 浏览器分支：speechSynthesis ---------------- */
  function webSpeak(sy, t, rate) {
    rateNow = rate;
    chunks = chunkText(t, MAX_CHUNK);
    if (!chunks.length) { say('没有可朗读的文字'); return false; }
    chunkIdx = 0;
    speaking = true;
    refresh();
    webNext();
    return true;
  }

  function webNext() {
    var sy = synth();
    if (!speaking) return;
    if (!sy) { finish(); return; }
    if (chunkIdx >= chunks.length) { finish(); return; }
    var seg = chunks[chunkIdx++];
    try {
      var U = window.SpeechSynthesisUtterance;
      if (typeof U !== 'function') { finish(); say('本机不支持语音朗读'); return; }
      var u = new U(seg);
      u.lang = 'zh-CN';
      u.rate = rateNow;
      u.onend = function () { if (speaking) webNext(); };
      u.onerror = function () { if (speaking) webNext(); };
      sy.speak(u);
    } catch (e) {
      finish();
      say('朗读失败：' + ((e && e.message) ? e.message : e));
    }
  }

  /* ---------------- 对外：读 / 停 / 开关 ---------------- */
  function speak(text, rate) {
    var t = norm(text);
    if (!t) { say('没有可朗读的文字'); return false; }
    rate = normRate(rate === undefined || rate === null ? rateNow : rate);
    stop(true);                 /* 先静默复位，避免旧队列继续出声 */
    curText = t;
    var b = bridge();
    if (b) return nativeSpeak(b, t, rate);
    var sy = synth();
    if (sy) return webSpeak(sy, t, rate);
    say('本机不支持语音朗读');
    return false;
  }

  function stop(silent) {
    speaking = false;
    chunks = [];
    chunkIdx = 0;
    stopPoll();
    var b = bridge();
    if (b && typeof b.ttsStop === 'function') { try { b.ttsStop(); } catch (e) {} }
    var sy = synth();
    if (sy && typeof sy.cancel === 'function') { try { sy.cancel(); } catch (e) {} }
    if (!silent) refresh();
    else refresh();
  }

  function finish() {
    speaking = false;
    chunks = [];
    chunkIdx = 0;
    stopPoll();
    refresh();
  }

  function toggle(text) {
    if (speaking) { stop(); return 'stop'; }
    speak(text);
    return speaking ? 'speak' : 'idle';
  }

  function busy() { return speaking; }

  /* ---------------- 按钮：自动挂载 + 状态复位 ---------------- */
  function btnLabel(on) { return on ? '⏹ 停止' : '🔊 朗读'; }

  function makeBtn(key) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sbtn';
    btn.setAttribute(BTN_ATTR, key);
    btn.style.cssText = 'white-space:nowrap';
    btn.textContent = btnLabel(false);
    btn.title = '用本机语音朗读这段正文（完全离线）';
    btn.onclick = function (ev) {
      try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {}
      try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (e) {}
      var k = btn.getAttribute(BTN_ATTR);
      var ent = registry[k];
      var t = ent && typeof ent.getText === 'function' ? ent.getText() : '';
      if (speaking && ownerKey === k) { stop(); return; }
      if (speaking) stop(true);
      ownerKey = k;
      speak(t);
      refresh();
    };
    return btn;
  }

  function refresh() {
    var list;
    try { list = document.querySelectorAll('button[' + BTN_ATTR + ']'); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var btn = list[i];
      var k = btn.getAttribute(BTN_ATTR);
      var on = speaking && ownerKey === k;
      btn.textContent = btnLabel(on);
      btn.title = on ? '点此停止朗读' : '用本机语音朗读这段正文（完全离线）';
      try {
        if (on) { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; }
        else { btn.style.borderColor = ''; btn.style.color = ''; }
      } catch (e) {}
    }
  }

  function mount(key, host, getText) {
    if (!host || !host.appendChild) return null;
    var btn = null;
    try { btn = host.querySelector('button[' + BTN_ATTR + '="' + key + '"]'); } catch (e) { btn = null; }
    if (!btn) {
      /* 同一个宿主里已经有别的朗读按钮（比如换了挂载点）→ 复用，避免出现两个 */
      try { btn = host.querySelector('button[' + BTN_ATTR + ']'); } catch (e) { btn = null; }
      if (btn) btn.setAttribute(BTN_ATTR, key);
    }
    if (!btn) {
      btn = makeBtn(key);
      host.appendChild(btn);
    }
    registry[key] = { btn: btn, getText: getText };
    return btn;
  }

  /* ---------------- 取正文 ---------------- */
  /* 老 WebView / jsdom 没有 innerText，退化成「逐块拼」，块与块之间补换行，
     否则 <p>a</p><p>b</p> 会被粘成 "ab"，朗读时断句全乱。 */
  function textOf(el) {
    if (!el) return '';
    try {
      var it = el.innerText;
      if (typeof it === 'string' && it.replace(/\s/g, '').length) return it;
    } catch (e) {}
    var kids = el.children;
    if (kids && kids.length) {
      var out = [];
      for (var i = 0; i < kids.length; i++) {
        var s = textOf(kids[i]);
        if (s) out.push(s);
      }
      if (out.length) return out.join('\n');
    }
    return String(el.textContent || '');
  }

  function detailText(art) {
    var out = [];
    try {
      var h = art.querySelector('h3');
      if (h) out.push(String(h.textContent || '').replace(/\s+/g, ' '));
      var ps = art.querySelectorAll('p');
      for (var i = 0; i < ps.length; i++) {
        var s = String(ps[i].textContent || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
        if (s) out.push(s);
      }
    } catch (e) {}
    var t = out.join('\n');
    return t.length > 8000 ? t.slice(0, 8000) : t;
  }

  function scan() {
    var hosts = [];
    /* ① 本机书籍内置阅读器（books.js 的 renderReader）：#yzReader .reader-bar + .reader-body */
    var rd = document.getElementById('yzReader');
    if (rd) {
      var bar = rd.querySelector('.reader-bar');
      var body = rd.querySelector('.reader-body');
      if (bar && body && body.textContent) {
        hosts.push({
          key: 'reader:' + (rd.getAttribute('data-book') || ''),
          host: bar,
          getText: function () {
            var b2 = document.getElementById('yzReader');
            var body2 = b2 && b2.querySelector('.reader-body');
            return textOf(body2);
          }
        });
      }
    }
    /* ② 资源详情页正文（app.js 的 openItemDetail）：#contentView article 里的 .ops 动作行 */
    var art = document.querySelector('#contentView article');
    if (art && !art.querySelector('.reader-body')) {
      var ops = art.querySelector('.ops');
      var ps = art.querySelectorAll('p');
      if (ops && ps.length >= 1 && detailText(art).length >= 40) {
        hosts.push({
          key: 'detail',
          host: ops,
          getText: function () {
            var a2 = document.querySelector('#contentView article');
            return a2 ? detailText(a2) : '';
          }
        });
      }
    }

    var alive = {};
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i];
      var btn = mount(h.key, h.host, h.getText);
      if (btn) { alive[h.key] = 1; if (!btn.parentNode || !document.body.contains(btn)) { try { h.host.appendChild(btn); } catch (e) {} } }
    }
    /* 挂载点没了 / 换页了 → 停，避免「按钮没了声音还在响」 */
    if (speaking && ownerKey && !document.querySelector('button[' + BTN_ATTR + '="' + ownerKey + '"]')) {
      finish();
    }
    refresh();
  }

  function schedule() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; try { scan(); } catch (e) {} }, 60);
  }

  function attach(el, getText) {
    if (!el) return null;
    var key = 'manual:' + (el.id || 'box');
    var btn = mount(key, el, getText || function () { return el.innerText || el.textContent || ''; });
    refresh();
    return btn;
  }

  function toggleFrom(key) {
    var ent = registry[key];
    if (!ent) return 'idle';
    var t = typeof ent.getText === 'function' ? ent.getText() : '';
    if (speaking && ownerKey === key) { stop(); return 'stop'; }
    if (speaking) stop(true);
    ownerKey = key;
    speak(t);
    refresh();
    return speaking ? 'speak' : 'idle';
  }

  /* ---------------- 启动：监听 DOM，等阅读区出现 ---------------- */
  function boot() {
    if (!document.body) { setTimeout(boot, 200); return; }
    try {
      if (typeof window.MutationObserver === 'function') {
        observer = new window.MutationObserver(function () { schedule(); });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    } catch (e) { observer = null; }
    try { setInterval(scan, SCAN_MS); } catch (e) {}
    /* 切后台就把嘴闭上，不让它在后台一直读 */
    try {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && speaking) stop();
      }, false);
    } catch (e) {}
    schedule();
  }

  window.YZSPEECH = {
    available: available,
    status: status,
    diagnose: diagnose,
    speak: speak,
    stop: stop,
    toggle: toggle,
    toggleFrom: toggleFrom,
    attach: attach,
    busy: busy,
    chunkText: chunkText,
    /* 自测/调试用 */
    _poll: function (ms) { if (ms > 0) POLL_MS = ms; return POLL_MS; },
    _state: function () {
      return { speaking: speaking, ownerKey: ownerKey, chunks: chunks.length, chunkIdx: chunkIdx, rate: rateNow, text: curText.slice(0, 40) };
    },
    _status: function () { return lastStatus; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})();
