/* =====================================================================
   学通 · 本机备份快照 + 快捷键（backup.js）
   ---------------------------------------------------------------------
   ① 快照：把本机改动（覆盖层 / 自定义配置 / 阅读状态 / 摘录 / 路径 / 收藏…）
      打包成一份，最多留 5 份，可随时恢复。自定义能力越多越需要这个。
   ② 快捷键：外接键盘 / 平板上的常用动作（/ 搜索、g h 首页、? 帮助、Esc 关闭）
   ===================================================================== */
(function () {
  'use strict';
  var K_SNAP = 'yzSnaps';
  var K_META = 'yzSnapMeta';
  var MAX_SNAP = 5;
  var MAX_BYTES = 400000;      /* 单份快照上限，超过就跳过最大的可选键 */

  /* 必带键（丢了等于丢改动）与可选键（体积大、丢了可重建） */
  var MUST = ['yzy_ov_v1', 'yzCustom', 'yzRead', 'yzExcerpts', 'yzPaths'];
  var OPT = ['favs', 'marks', 'links', 'libLinks', 'quizBank', 'homeFriends', 'readlistDone',
    'askHistory', 'notifs', 'classifyHidden', 'channelExtra', 'chanLikes', 'chanComments', 'graphView',
    /* 0.17.21 补：导入书索引、相册索引、阅读进度、做题成绩 —— 原来这些不进快照，
       一旦覆盖层损坏需要回滚，书壳和成绩会一起消失 */
    'yzImportedBooks', 'albumExtra', 'readerFS'];
  var PREFIX = ['note_', 'readerPos-', 'readerCh-', 'yzq_best_', 'yzq_last_'];

  function ls(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function nowISO() { return new Date().toISOString(); }
  function fmt(iso) { try { var d = new Date(iso); return d.toLocaleString(); } catch (e) { return iso; } }

  function collect() {
    var kv = {}, size = 0;
    MUST.forEach(function (k) { var v = ls(k, null); if (v != null) { kv[k] = v; size += v.length; } });
    OPT.forEach(function (k) {
      var v = ls(k, null);
      if (v != null && size + v.length < MAX_BYTES) { kv[k] = v; size += v.length; }
    });
    /* 前缀键：笔记 / 阅读进度 / 章节进度 / 做题成绩 */
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        var hit = false;
        for (var j = 0; j < PREFIX.length; j++) { if (k.indexOf(PREFIX[j]) === 0) { hit = true; break; } }
        if (hit && kv[k] == null) {
          var v = ls(k, '');
          if (size + v.length < MAX_BYTES) { kv[k] = v; size += v.length; }
        }
      }
    } catch (e) {}
    return { kv: kv, size: size };
  }

  function all() { try { var a = JSON.parse(ls(K_SNAP, '[]')); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveAll(a) { return set(K_SNAP, JSON.stringify(a)); }

  function make(reason) {
    var c = collect();
    var snap = { id: 's' + Date.now().toString(36), at: nowISO(), reason: reason || '手动', size: c.size, kv: c.kv };
    /* 超过单份上限时收集阶段已经丢掉了「可重建」的键，要如实标记，别让用户以为备份是完整的 */
    if (c.size >= MAX_BYTES) snap.partial = true;
    var a = all();
    a.unshift(snap);
    while (a.length > MAX_SNAP) a.pop();
    if (!saveAll(a)) {
      /* 存储满：退一步只留必须键再试一次 */
      a = a.slice(0, 2);
      var keep = {};
      MUST.forEach(function (k) { if (snap.kv[k] != null) keep[k] = snap.kv[k]; });
      snap.kv = keep; snap.size = JSON.stringify(keep).length; snap.partial = true;
      var ok2 = saveAll(a);
      if (!ok2) {
        try {
          if (typeof toast === 'function') toast('本机存储已满，这份快照没存上。建议先「导出我的数据」再清理本机内容');
        } catch (e) { }
      }
    }
    set(K_META, JSON.stringify({ last: snap.at }));
    return snap;
  }

  function restore(id) {
    var a = all(), s = a.find(function (x) { return x.id === id; });
    if (!s) return '找不到这份快照';
    if (!confirm('恢复这份快照会覆盖当前本机改动（' + fmt(s.at) + '）。继续？')) return false;
    var fail = 0;
    Object.keys(s.kv).forEach(function (k) { if (!set(k, s.kv[k])) fail++; });
    try { if (typeof toast === 'function') toast('已恢复' + (fail ? '（' + fail + ' 项失败，可能存储已满）' : '')); } catch (e) {}
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 700);
    return true;
  }

  function del(id) {
    saveAll(all().filter(function (x) { return x.id !== id; }));
    return true;
  }

  /* 每天首次启动自动留一份（不打扰、可关） */
  function autoDaily() {
    try {
      if (ls('yzSnapAuto', '1') === '0') return;
      var meta = {}; try { meta = JSON.parse(ls(K_META, '{}') || '{}'); } catch (e) {}
      var today = new Date().toISOString().slice(0, 10);
      if (meta.last && String(meta.last).slice(0, 10) === today) return;
      /* 没有任何本机改动就不必留 */
      var hasData = false;
      MUST.forEach(function (k) { if (ls(k, null) != null) hasData = true; });
      if (!hasData) return;
      make('自动（每日）');
    } catch (e) {}
  }

  /* ---------------- 面板 ---------------- */
  function open() {
    var a = all();
    var old = document.getElementById('yzSnapPanel');
    if (old) { try { old.remove(); } catch (e) {} }
    var w = document.createElement('div');
    w.id = 'yzSnapPanel';
    w.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100008;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
    var rows = a.length ? a.map(function (s) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.1)">' +
        '<span style="flex:1;min-width:0"><b style="font-size:.82rem">' + fmt(s.at) + '</b>' +
        '<span style="display:block;font-size:.72rem;opacity:.6">' + (s.reason || '') + ' · ' +
        Math.round((s.size || 0) / 1024) + ' KB · ' + Object.keys(s.kv || {}).length + ' 项' +
        (s.partial ? ' · <b style="color:var(--accent)">部分（超出上限，可重建项未含）</b>' : '') + '</span></span>' +
        '<button data-rst="' + s.id + '" class="sbtn" style="font-size:.72rem">恢复</button>' +
        '<button data-del="' + s.id + '" class="sbtn" style="font-size:.72rem">删</button></div>';
    }).join('') : '<p style="font-size:.8rem;opacity:.65;line-height:1.8">还没有快照。点「立即备份」生成一份。</p>';

    w.innerHTML = '<div style="width:100%;max-width:620px;max-height:86vh;overflow:auto;background:var(--panel-bg,#1b1412);color:var(--panel-text,#f2e9e4);' +
      'border:1px solid var(--panel-line,rgba(255,255,255,.16));border-radius:16px 16px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom,0px))">' +
      '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1">🗄 备份与恢复</b>' +
      '<button id="yzSnapNow" class="sbtn">立即备份</button>' +
      '<button id="yzSnapX" class="sbtn">关闭</button></div>' +
      '<p style="font-size:.75rem;opacity:.65;line-height:1.75;margin:8px 0 4px">只包含本机改动（编辑内容、自定义外观、阅读状态、摘录、路径、收藏等），最多留 5 份。' +
      '换手机请用「导出我的数据」，快照只在本机。</p>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:.76rem;margin:8px 0"><input type="checkbox" id="yzSnapAuto"' +
      (ls('yzSnapAuto', '1') !== '0' ? ' checked' : '') + '> 每天首次打开自动备份一份</label>' + rows + '</div>';
    document.body.appendChild(w);

    function close() { try { w.remove(); } catch (e) {} }
    w.querySelector('#yzSnapX').onclick = close;
    w.addEventListener('click', function (ev) { if (ev.target === w) close(); });
    w.querySelector('#yzSnapNow').onclick = function () { make('手动'); open(); };
    w.querySelector('#yzSnapAuto').onchange = function (ev) { set('yzSnapAuto', ev.target.checked ? '1' : '0'); };
    w.querySelectorAll('[data-rst]').forEach(function (b) { b.onclick = function () { restore(b.getAttribute('data-rst')); }; });
    w.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { del(b.getAttribute('data-del')); open(); };
    });
  }

  /* ---------------- 快捷键 ---------------- */
  function isTyping(el) {
    if (!el) return false;
    var t = (el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
  }
  var gPending = false, gTimer = null;
  function hotkeys() {
    document.addEventListener('keydown', function (ev) {
      try {
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
        if (isTyping(ev.target)) {
          if (ev.key === 'Escape' && ev.target.blur) ev.target.blur();
          return;
        }
        var k = ev.key;
        if (k === '/') {
          var q = document.getElementById('qSearch');
          if (q) { ev.preventDefault(); q.focus(); q.select && q.select(); }
          return;
        }
        if (k === '?') { if (typeof openSection === 'function' && typeof secIdx === 'function') { openSection(secIdx('使用指南')); ev.preventDefault(); } return; }
        if (k === 'g') { gPending = true; clearTimeout(gTimer); gTimer = setTimeout(function () { gPending = false; }, 900); return; }
        if (gPending) {
          gPending = false; clearTimeout(gTimer);
          if (k === 'h') { try { if (typeof goHome === 'function') goHome(); } catch (e) {} ev.preventDefault(); return; }
          if (k === 'b') { try { if (typeof openShelf === 'function') openShelf(); } catch (e) {} ev.preventDefault(); return; }
          if (k === 'n') { try { if (typeof openExcerpts === 'function') openExcerpts(); } catch (e) {} ev.preventDefault(); return; }
          if (k === 't') { try { if (typeof openSection === 'function' && typeof secIdx === 'function') openSection(secIdx('阅读与手册')); } catch (e) {} ev.preventDefault(); return; }
          if (k === 'c') { try { if (typeof openCustom === 'function') openCustom(); } catch (e) {} ev.preventDefault(); return; }
        }
        if (k === 'Escape') {
          var panels = ['yzSnapPanel', 'yzCustomPanel', 'yzCrashPanel', 'yzExEditPanel'];
          for (var i = 0; i < panels.length; i++) {
            var el = document.getElementById(panels[i]);
            if (el) { el.remove(); ev.preventDefault(); return; }
          }
        }
      } catch (e) {}
    }, true);
  }

  window.YZBackup = {
    make: make, all: all, restore: restore, del: del, open: open,
    autoDaily: autoDaily, collect: collect
  };
  window.openBackup = open;
  window.yzHotkeys = hotkeys;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { autoDaily(); hotkeys(); });
  else { autoDaily(); hotkeys(); }
})();
