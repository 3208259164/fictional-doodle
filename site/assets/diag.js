/* =====================================================================
   学通 · 轻量诊断收集（给「非首页」页面用）
   ---------------------------------------------------------------------
   首页由 assets/app.js 自带 DIAG 收集；但 graph / graph3d / ask / card /
   challenge 这些页面不加载 app.js，出错时什么都不留，导致「导出诊断报告」
   永远看不到这些页面的问题。本文件只做一件事：把错误写进 localStorage
   的 yzErrLog（环形 60 条），由首页的诊断导出统一汇总。

   不联网、不上报、不含个人信息。
   ===================================================================== */
(function () {
  try {
    var KEY = 'yzErrLog', MAX = 60;
    var page = (location.pathname.split('/').pop() || 'index.html');
    function push(kind, info) {
      try {
        var a = [];
        try { a = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { a = []; }
        a.push({ t: new Date().toISOString(), page: page, kind: kind, info: String(info == null ? '' : info).slice(0, 300) });
        if (a.length > MAX) a = a.slice(a.length - MAX);
        localStorage.setItem(KEY, JSON.stringify(a));
      } catch (e) {}
    }
    window.addEventListener('error', function (e) {
      var t = e.target || {};
      if (t && t.tagName) push('resource', (t.src || t.href || t.tagName) + ' 加载失败');
      else push('error', (e.message || '脚本错误') + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      push('promise', (e.reason && (e.reason.message || e.reason)) || 'unknown');
    });
    window.YZDiagPush = push;   /* 供页面主动记录自定义事件 */
    window.YZDiagClear = function () { try { localStorage.removeItem(KEY); } catch (e) {} };
  } catch (e) {}
})();
