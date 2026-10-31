/* =====================================================================
   学通 · 键盘快捷键（keys.js）
   ---------------------------------------------------------------------
   原在 backup.js 里，2026-10-31 移除「备份与恢复」功能时抽出，
   避免「删一个功能顺带删掉全站快捷键」。

   /        聚焦搜索框
   ?        打开「使用指南」
   g h      回首页        g b  打开书架      g n  打开摘录
   g t      阅读与手册    g c  打开自定义
   Esc      关闭当前浮层（自定义 / 崩溃 / 编辑面板）
   ===================================================================== */
(function () {
  'use strict';

  function isTyping(el) {
    if (!el) return false;
    var t = (el.tagName || '').toLowerCase();
    if (t === 'input' || t === 'textarea' || t === 'select') return true;
    return !!(el.isContentEditable);
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
          var panels = ['yzCustomPanel', 'yzCrashPanel', 'yzExEditPanel'];
          for (var i = 0; i < panels.length; i++) {
            var el = document.getElementById(panels[i]);
            if (el) { el.remove(); ev.preventDefault(); return; }
          }
        }
      } catch (e) {}
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hotkeys);
  else hotkeys();
})();
