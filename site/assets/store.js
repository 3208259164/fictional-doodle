/* =====================================================================
   学通 · 本机存储层（YZStore）
   ---------------------------------------------------------------------
   为什么要有它：
     全站有一百多处直接调 localStorage，键名、JSON 解析、配额处理各写各的。
     一旦某个键改名或结构变化，老用户的数据就会「读不到 → 回落默认值」，
     看起来像功能丢了，其实数据还躺在那里。
   它做三件事：
     ① 统一读写（JSON 解析容错、配额写满返回 false 而不是抛错）
     ② 记录 schema 版本（localStorage.yzSchema），每次启动跑一次迁移
     ③ 把历史上改名/改结构的键就地修好，修完保留旧键一段时间不删（便于排查）
   约定：新代码一律走 YZStore；老代码的直调暂不动（改动面太大，收益不成正比）。
   ===================================================================== */
(function () {
  'use strict';

  var SCHEMA = 2;
  var VKEY = 'yzSchema';

  function rawGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function rawSet(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) {
      /* 配额写满：把错误交给调用方，而不是让整个流程崩掉 */
      try { if (window.console) console.warn('[YZStore] 写入失败：', k, e && e.name); } catch (e2) { }
      return false;
    }
  }
  function rawDel(k) { try { localStorage.removeItem(k); return true; } catch (e) { return false; } }

  function get(k, dflt) {
    var v = rawGet(k);
    if (v == null) return dflt;
    try { var j = JSON.parse(v); return j == null ? dflt : j; } catch (e) { return v; }  /* 非 JSON 的纯字符串原样返回 */
  }
  function set(k, v) { return rawSet(k, typeof v === 'string' ? v : JSON.stringify(v)); }

  function ver() {
    var v = parseInt(rawGet(VKEY) || '0', 10);
    return isFinite(v) ? v : 0;
  }

  /* ---------------- 迁移 ---------------- */
  var log = [];

  /* v0 → v1：搜索栏分类快捷从「显示列表 qCats」改成「隐藏列表 qCatHidden」 */
  function m0to1() {
    var old = null;
    try { old = JSON.parse(rawGet('qCats') || 'null'); } catch (e) { }
    if (Array.isArray(old) && rawGet('qCatHidden') == null) {
      var ALL = ['讲堂', '图书馆', '原著', '导读', '词典', '有声书', '歌曲', '影像', '工具', '对公文献', '当代', '参考'];
      var hidden = ALL.filter(function (k) { return old.indexOf(k) < 0; });
      rawSet('qCatHidden', JSON.stringify(hidden));
      log.push('qCats → qCatHidden（' + hidden.length + ' 项隐藏）');
    }
  }

  /* v1 → v2：修掉几类「结构坏了但不会报错」的键 */
  function m1to2() {
    /* 通知列表必须是数组，否则渲染处会静默空白 */
    var n = rawGet('notifs');
    if (n != null) {
      var ok = false;
      try { ok = Array.isArray(JSON.parse(n)); } catch (e) { }
      if (!ok) { rawSet('notifs', '[]'); log.push('notifs 结构损坏 → 重置为空数组'); }
    }
    /* 主题值只允许三档 */
    var th = rawGet('theme');
    if (th != null && ['auto', 'light', 'dark'].indexOf(th.replace(/^"|"$/g, '')) < 0) {
      rawDel('theme'); log.push('theme 值非法 → 回到自动');
    }
    /* 阅读配置必须是对象 */
    ['readerCfg', 'yzReadCfg'].forEach(function (k) {
      var v = rawGet(k);
      if (v == null) return;
      var o = null;
      try { o = JSON.parse(v); } catch (e) { }
      if (!o || typeof o !== 'object' || Array.isArray(o)) { rawDel(k); log.push(k + ' 结构损坏 → 清除'); }
    });
    /* 书架偏好必须是对象 */
    var sp = rawGet('yzShelfPref');
    if (sp != null) {
      var so = null;
      try { so = JSON.parse(sp); } catch (e) { }
      if (!so || typeof so !== 'object') { rawDel('yzShelfPref'); log.push('yzShelfPref 结构损坏 → 清除'); }
    }
  }

  var STEPS = [m0to1, m1to2];

  function migrate() {
    var from = ver();
    if (from >= SCHEMA) return { from: from, to: from, log: log };
    for (var v = from; v < SCHEMA; v++) {
      try { if (STEPS[v]) STEPS[v](); } catch (e) {
        try { if (window.console) console.warn('[YZStore] 迁移步骤 ' + v + ' 失败：', e); } catch (e2) { }
      }
    }
    rawSet(VKEY, String(SCHEMA));
    try {
      if (log.length && window.console) console.info('[学通] 本机数据迁移 ' + from + ' → ' + SCHEMA + '：' + log.join('；'));
    } catch (e) { }
    return { from: from, to: SCHEMA, log: log };
  }

  window.YZStore = {
    SCHEMA: SCHEMA,
    version: ver,
    migrate: migrate,
    get: get,
    set: set,
    del: rawDel,
    rawGet: rawGet,
    rawSet: rawSet,
    lastLog: function () { return log.slice(); }
  };

  /* 启动即迁移：必须早于任何读取本机偏好的脚本 */
  try { migrate(); } catch (e) { }
})();
