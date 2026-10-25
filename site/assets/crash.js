/* =====================================================================
   学通 · 崩溃与启动自检（crash.js）
   ---------------------------------------------------------------------
   为什么需要它（业界通用做法，见 Firefox about:crashes / Crashlytics / ACRA）：
     崩溃发生的瞬间，页面已经死了，点不到任何按钮。所以诊断必须
     ① 由宿主（Java 层）在进程死前把现场写进文件；
     ② 下次启动时读取，主动告诉用户「上次异常退出」。

   本文件做四件事：
     1) 面包屑：把「用户最近做了什么」持续报给 Java 层（崩溃报告里要用）；
     2) 启动心跳：页面活够 10 秒 → 调 AndroidApp.bootOk()，标记本轮启动成功；
     3) 异常横幅：读取 AndroidApp.crashPending()，有上次崩溃就显示可操作横条；
     4) 安全模式：连续三次启动未成功时，__yzSafeMode=true，overlay.js 跳过本机改动，
        先保证界面能打开，并提供「导出本机改动 / 退出安全模式」。

   全部本地，不联网、不上传。
   ===================================================================== */
(function () {
  'use strict';

  var KEY_BREAD = 'yzBread';
  var KEY_BANNER = 'yzBannerHidden';
  var MAX_BREAD = 40;

  function bridge(fn) {
    try {
      if (window.AndroidApp && typeof window.AndroidApp[fn] === 'function') {
        return window.AndroidApp[fn];
      }
    } catch (e) {}
    return null;
  }
  function call(fn, arg) {
    var f = bridge(fn);
    if (!f) return null;
    try { return (arg === undefined) ? f.call(window.AndroidApp) : f.call(window.AndroidApp, arg); }
    catch (e) { return null; }
  }

  /* ---------- 1. 安全模式（必须最早确定，overlay.js 稍后加载时会读它） ---------- */
  try { window.__yzSafeMode = !!(call('safeMode') === true); } catch (e) { window.__yzSafeMode = false; }

  /* ---------- 2. 面包屑 ---------- */
  var memBread = [];
  function nowHM() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  var lastMsg = '', lastAt = 0;
  function bread(msg) {
    try {
      if (!msg) return;
      var s = String(msg).replace(/\s+/g, ' ').trim();
      if (!s) return;
      if (s.length > 120) s = s.slice(0, 120);
      var t = Date.now();
      if (s === lastMsg && t - lastAt < 1500) return;   /* 同一动作 1.5 秒内只记一次 */
      lastMsg = s; lastAt = t;
      memBread.push(nowHM() + ' ' + s);
      while (memBread.length > MAX_BREAD) memBread.shift();
      try { localStorage.setItem(KEY_BREAD, JSON.stringify(memBread)); } catch (e) {}
      call('bread', s);
    } catch (e) {}
  }
  window.YZBread = bread;

  /* 页面名：路径最后一段 */
  function pageName() {
    try {
      var p = location.pathname.split('/').pop() || 'index.html';
      var q = location.search ? location.search : '';
      return p + q + (location.hash ? location.hash.slice(0, 40) : '');
    } catch (e) { return '(未知页)'; }
  }

  /* 自动记录：点击（捕获阶段，取最近的可读文本） */
  document.addEventListener('click', function (ev) {
    try {
      var el = ev.target;
      var depth = 0, txt = '';
      while (el && depth < 4 && !txt) {
        txt = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
        if (!txt) txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
        el = el.parentNode; depth++;
      }
      bread('点击「' + txt + '」@' + pageName());
    } catch (e) {}
  }, true);
  window.addEventListener('hashchange', function () { bread('跳转 #' + String(location.hash).slice(0, 40)); });
  window.addEventListener('popstate', function () { bread('返回上一页 @' + pageName()); });
  document.addEventListener('visibilitychange', function () { bread(document.hidden ? '切到后台' : '回到前台'); });
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t.tagName) bread('资源加载失败 ' + (t.src || t.href || t.tagName));
    else bread('脚本错误 ' + ((e && e.message) || '') + ' @' + ((e && e.filename) || '').split('/').pop() + ':' + ((e && e.lineno) || 0));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    bread('Promise 未处理 ' + ((e && e.reason && (e.reason.message || e.reason)) || ''));
  });

  /* ---------- 3. 启动心跳 ---------- */
  var beatTimer = null;
  function beat() {
    try { call('bootOk'); } catch (e) {}
  }
  function scheduleBeat() {
    if (beatTimer) clearTimeout(beatTimer);
    /* 3 秒后才算「真的起来了」：太早（首屏就报）无法区分「白屏但进程活着」，
       太长（原来 10 秒）会让「只想查一句话、用不到 10 秒就退出」的正常使用被误判成启动失败，
       连续几次就误进安全模式、本机改动全不加载。 */
    beatTimer = setTimeout(beat, 3000);
  }
  if (document.readyState === 'complete') scheduleBeat();
  else window.addEventListener('load', scheduleBeat);
  /* 页面从后台回到前台，补一次心跳（避免长时间挂后台被系统杀掉时误判） */
  document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleBeat(); });

  /* ---------- 4. 状态读取 ---------- */
  function readSummary() {
    var raw = call('crashPending');
    if (!raw) return null;
    try { return (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch (e) { return null; }
  }
  function readAll() {
    var raw = call('diagRead');
    var obj = null;
    if (raw) { try { obj = (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch (e) { obj = null; } }
    if (!obj) obj = { crashes: [], bread: '', state: { web: true } };
    /* 网页/浏览器环境：用 localStorage 里的面包屑兜底 */
    if (!obj.bread) {
      try { obj.bread = (JSON.parse(localStorage.getItem(KEY_BREAD) || '[]') || []).join('\n'); } catch (e) {}
    }
    obj.page = pageName();
    obj.ua = navigator.userAgent;
    return obj;
  }

  /* ---------- 5. 文件写出（优先 YZSave，其次原生桥，最后 Blob） ---------- */
  function b64utf8(s) {
    try {
      if (window.YZSave && window.YZSave.b64) return window.YZSave.b64(s);
      return btoa(unescape(encodeURIComponent(s)));
    } catch (e) { return ''; }
  }
  function save(name, mime, text) {
    try {
      if (window.YZSave && window.YZSave.text) return window.YZSave.text(name, mime, text);
    } catch (e) {}
    var sb = bridge('saveBase64');
    if (sb) {
      /* 注意参数顺序：Java 侧签名是 saveBase64(name, base64, mime) */
      try { sb.call(window.AndroidApp, name, b64utf8(text), mime); return true; } catch (e) {}
    }
    try {
      var blob = new Blob([text], { type: mime + ';charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (e) {} }, 1200);
      return true;
    } catch (e) { return false; }
  }

  function reportText() {
    var d = readAll();
    var lines = [];
    lines.push('学通 崩溃日志导出');
    lines.push('生成时间: ' + new Date().toISOString());
    lines.push('页面: ' + d.page);
    lines.push('UA: ' + d.ua);
    var st = d.state || {};
    lines.push('启动次数: ' + (st.bootCount || 0) + ' | 连续失败: ' + (st.failCount || 0) + ' | 安全模式: ' + (st.safeMode ? '是' : '否'));
    lines.push('最近启动: ' + (st.lastBootAt || '-') + ' | 最近成功: ' + (st.lastOkAt || '-'));
    lines.push('');
    lines.push('========== 崩溃报告（共 ' + (d.crashes || []).length + ' 份）==========');
    (d.crashes || []).forEach(function (c, i) {
      lines.push('');
      lines.push('--- [' + (i + 1) + '] ' + c.file + ' · ' + c.at + ' · ' + c.size + ' 字节 ---');
      lines.push(c.text || '(空)');
    });
    lines.push('');
    lines.push('========== 面包屑（最近操作）==========');
    lines.push(d.bread || '(无)');
    lines.push('');
    lines.push('说明：本文件只在你的手机上生成，不含个人信息，不会自动上传。');
    return lines.join('\n');
  }

  function exportLog() {
    var name = '学通-崩溃日志-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.txt';
    var txt = reportText();
    var ok = save(name, 'text/plain', txt);
    if (!ok) { alert('无法保存日志：当前环境不允许写文件'); return false; }
    return true;
  }

  function clearAll() {
    try { call('diagClear'); } catch (e) {}
    try { localStorage.removeItem(KEY_BREAD); } catch (e) {}
    memBread = [];
    hideBanner();
    try { if (window.toast) toast('诊断日志已清除'); } catch (e) {}
    return true;
  }

  /* ---------- 6. 横幅 UI ---------- */
  var barEl = null;

  function toastLocal(msg) {
    try { if (window.toast) { window.toast(msg); return; } } catch (e) {}
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:100002;' +
      'background:rgba(0,0,0,.86);color:#fff;padding:9px 14px;border-radius:10px;font-size:.86rem;max-width:86vw;text-align:center';
    document.body.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, 2200);
  }

  function hideBanner(remember) {
    try { if (barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl); } catch (e) {}
    barEl = null;
    if (remember) { try { sessionStorage.setItem(KEY_BANNER, '1'); } catch (e) {} }
  }

  function makeBar(html, bg, fg, border) {
    hideBanner(false);
    var el = document.createElement('div');
    el.id = 'yzCrashBar';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 74px);' +
      'z-index:9998;background:' + bg + ';color:' + fg + ';border:1px solid ' + border + ';' +
      'border-radius:12px;padding:9px 11px;font-size:.8rem;line-height:1.45;' +
      'box-shadow:0 6px 22px rgba(0,0,0,.28);display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    el.innerHTML = html;
    document.body.appendChild(el);
    barEl = el;
    return el;
  }

  function btnStyle(dark) {
    return 'flex:0 0 auto;border:1px solid ' + (dark ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.18)') +
      ';background:transparent;color:inherit;border-radius:8px;padding:4px 9px;font-size:.78rem;cursor:pointer';
  }

  function showBanner() {
    if (!document.body) return;
    var s = readSummary();
    if (!s) return;
    var safe = !!s.safeMode || !!window.__yzSafeMode;
    var crashed = (s.count > 0) && s.unseen;
    var hidden = false;
    try { hidden = sessionStorage.getItem(KEY_BANNER) === '1'; } catch (e) {}

    if (safe) {
      var b1 = makeBar(
        '<span style="flex:1 1 140px">🛟 <b>安全模式</b>：上次连续三次没能正常打开，已跳过本机改动先启动。</span>' +
        '<button id="yzCbExit" style="' + btnStyle(true) + '">退出安全模式</button>' +
        '<button id="yzCbDetail" style="' + btnStyle(true) + '">查看日志</button>',
        'rgba(122,84,0,.94)', '#ffe9b0', 'rgba(255,214,102,.5)');
      b1.querySelector('#yzCbExit').onclick = function () {
        try { if (window.confirm && !confirm('退出安全模式后，本机改动会重新加载。\n如果仍然打不开，日志里会有记录。继续？')) return; } catch (e) {}
        try { call('exitSafeMode'); } catch (e) {}
        try { localStorage.setItem('yzSafeExitAt', String(Date.now())); } catch (e) {}
        try { location.reload(); } catch (e) {}
      };
      b1.querySelector('#yzCbDetail').onclick = function () { openPanel(); };
      return;
    }
    if (!crashed || hidden) return;

    var head = (s.head || '').replace(/^异常:\s*/, '');
    if (head.length > 46) head = head.slice(0, 46) + '…';
    var b = makeBar(
      '<span style="flex:1 1 150px">⚠️ <b>上次异常退出</b>' + (head ? '：' + escapeHtml(head) : '') + '</span>' +
      '<button id="yzCbView" style="' + btnStyle(true) + '">查看</button>' +
      '<button id="yzCbEx" style="' + btnStyle(true) + '">导出日志</button>' +
      '<button id="yzCbX" style="' + btnStyle(true) + '">忽略</button>',
      'rgba(43,5,5,.95)', '#f4e7e0', 'rgba(255,255,255,.22)');
    b.querySelector('#yzCbView').onclick = function () { openPanel(); };
    b.querySelector('#yzCbEx').onclick = function () {
      if (exportLog()) toastLocal('日志已导出，可在「下载」里找到');
    };
    b.querySelector('#yzCbX').onclick = function () {
      hideBanner(true);
      try { call('diagSeen'); } catch (e) {}
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 7. 详情面板 ---------- */
  function openPanel() {
    var old = document.getElementById('yzCrashPanel');
    if (old) { try { old.remove(); } catch (e) {} }
    var d = readAll();
    var list = (d.crashes || []).slice().reverse();
    var items = list.length ? list.map(function (c, i) {
      var body = String(c.text || '');
      if (body.length > 2400) body = body.slice(0, 2400) + '\n…（已截断，导出可看完整）';
      return '<details style="margin:0 0 8px"' + (i === 0 ? ' open' : '') + '>' +
        '<summary style="cursor:pointer;font-weight:600">' + escapeHtml(c.file) + ' · ' + escapeHtml(c.at || '') + '</summary>' +
        '<pre style="white-space:pre-wrap;word-break:break-word;font-size:.72rem;line-height:1.5;max-height:34vh;overflow:auto;' +
        'background:rgba(0,0,0,.18);padding:8px;border-radius:8px;margin:6px 0 0">' + escapeHtml(body) + '</pre>' +
        '</details>';
    }).join('') : '<p style="opacity:.75;font-size:.82rem">本机还没有崩溃记录。崩溃会在下次启动时出现在这里。</p>';

    var wrap = document.createElement('div');
    wrap.id = 'yzCrashPanel';
    wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100001;background:rgba(0,0,0,.55);display:flex;' +
      'align-items:flex-end;justify-content:center;padding:0';
    wrap.innerHTML =
      '<div style="width:100%;max-width:640px;max-height:86vh;overflow:auto;background:var(--panel-bg,#1b1412);' +
      'color:var(--panel-text,#f2e9e4);border:1px solid var(--panel-line,rgba(255,255,255,.16));' +
      'border-radius:16px 16px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom,0px));">' +
      '<div style="display:flex;align-items:center;gap:8px;margin:0 0 10px">' +
      '<b style="flex:1;font-size:.95rem">诊断日志</b>' +
      '<button id="yzCpEx" style="' + btnStyle(true) + '">导出</button>' +
      '<button id="yzCpClr" style="' + btnStyle(true) + '">清除</button>' +
      '<button id="yzCpX" style="' + btnStyle(true) + '">关闭</button>' +
      '</div>' +
      '<p style="font-size:.76rem;opacity:.72;margin:0 0 10px">全部保存在本机，不上传。启动 ' +
      (d.state && d.state.bootCount || 0) + ' 次，连续失败 ' + (d.state && d.state.failCount || 0) + ' 次' +
      ((d.state && d.state.safeMode) ? '，当前为安全模式' : '') + '。</p>' +
      items +
      '<p id="yzCpTest" style="font-size:.7rem;opacity:.45;margin:14px 0 0;text-align:center;' +
      'user-select:none;-webkit-user-select:none">长按此处 3 秒：模拟一次崩溃（仅排查用，App 会退出）</p>' +
      '<details style="margin-top:6px"><summary style="cursor:pointer;font-weight:600">最近操作（面包屑）</summary>' +
      '<pre style="white-space:pre-wrap;word-break:break-word;font-size:.72rem;line-height:1.5;max-height:26vh;overflow:auto;' +
      'background:rgba(0,0,0,.18);padding:8px;border-radius:8px;margin:6px 0 0">' + escapeHtml(d.bread || '(无)') + '</pre>' +
      '</details>' +
      '</div>';
    document.body.appendChild(wrap);
    function close() { try { wrap.remove(); } catch (e) {} }
    /* 长按 3 秒触发真实崩溃测试：验证「崩溃 → 落盘 → 下次启动提示」整条链路 */
    (function () {
      var hint = wrap.querySelector('#yzCpTest'), timer = null;
      function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
      hint.addEventListener('pointerdown', function () {
        cancel();
        timer = setTimeout(function () {
          timer = null;
          var msg = window.YZCrash.test(true);
          hint.textContent = msg;
        }, 3000);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { hint.addEventListener(ev, cancel); });
    })();
    wrap.querySelector('#yzCpX').onclick = close;
    wrap.querySelector('#yzCpClr').onclick = function () {
      try { if (window.confirm && !confirm('清除本机全部崩溃日志与面包屑？清除后无法恢复。')) return; } catch (e) {}
      clearAll(); close();
    };
    wrap.querySelector('#yzCpEx').onclick = function () {
      if (exportLog()) toastLocal('日志已导出');
    };
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) close(); });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
  }

  /* ---------- 8. 对外 API ---------- */
  window.YZCrash = {
    bread: bread,
    summary: readSummary,
    read: readAll,
    exportLog: exportLog,
    clear: clearAll,
    open: openPanel,
    bar: showBanner,
    report: reportText,
    /* 自测：java=true 走原生桥抛真崩溃（会退出 App）；否则只记录一条面包屑 */
    test: function (java) {
      bread('诊断自测：手动触发');
      if (java) { try { call('diagCrashTest'); } catch (e) {} return '已触发 Java 层崩溃（App 会退出，重开后应出现提示条）'; }
      return '仅记录面包屑；传 true 可触发真实崩溃测试';
    }
  };

  /* 首屏提示：等 DOM 就绪（app.js 的 toast 也要可用） */
  function boot() {
    try { bread('打开页面 ' + pageName()); } catch (e) {}
    setTimeout(function () { try { showBanner(); } catch (e) {} }, 900);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
