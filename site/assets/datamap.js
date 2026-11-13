/* =====================================================================
   学通 · 用户数据清单（datamap.js）
   ---------------------------------------------------------------------
   为什么需要：用户数据分散在三处 —— localStorage、IndexedDB、Android 私有文件。
   它们承接的东西完全不同（进度 / 正文 / 编辑），但以前没有任何一处能回答
   「我有哪些数据、存在哪、能不能导出、换版本会不会丢」。

   这份清单是**声明式**的：代码、诊断报告、导出流程都从这里取口径，
   不再各自硬编码键名。改数据结构时先改这里，再改实现。

   字段：
     k     键名或键名前缀（* 结尾表示前缀匹配）
     where local | idb | native
     ver   该数据的结构版本（升级时写迁移函数并 +1）
     export 是否随「导出」带走（false 表示只在本机有效，如主题偏好）
     desc  一句话说明
   ===================================================================== */
(function () {
  'use strict';

  var ITEMS = [
    { k: 'yzy_ov_v1', where: 'local', ver: 1, export: true, desc: '全站编辑覆盖层：人物 / 史料 / 术语 / 图谱 / 关系标注的本机修改' },
    { k: 'yzExcerpts', where: 'local', ver: 1, export: true, desc: '摘录与笔记' },
    { k: 'yzRead', where: 'local', ver: 1, export: false, desc: '已读标记（可从进度重建）' },
    { k: 'readerPos', where: 'local', ver: 1, export: true, desc: '阅读进度（正文位置）' },
    { k: 'readerCh', where: 'local', ver: 1, export: true, desc: '阅读进度（章节 + 章内比例）' },
    { k: 'readerFS', where: 'local', ver: 1, export: false, desc: '阅读器字号与行距偏好' },
    { k: 'yzReadCfg', where: 'local', ver: 1, export: false, desc: '阅读器主题与排版配置' },
    { k: 'yzBkTheme', where: 'local', ver: 1, export: false, desc: '阅读背景主题' },
    { k: 'yzBright', where: 'local', ver: 1, export: false, desc: '阅读亮度' },
    { k: 'yzPdfMode', where: 'local', ver: 1, export: false, desc: 'PDF 阅读模式偏好' },
    { k: 'yzShelfPref', where: 'local', ver: 1, export: false, desc: '书架视图偏好' },
    { k: 'homeGraphsOff', where: 'local', ver: 1, export: false, desc: '首页隐藏的图谱入口' },
    { k: 'chanEdits', where: 'local', ver: 1, export: true, desc: '频道内容的本机编辑' },
    { k: 'chanDels', where: 'local', ver: 1, export: true, desc: '频道内容的隐藏记录' },
    { k: 'channelExtra', where: 'local', ver: 1, export: true, desc: '频道里新增的条目' },
    { k: 'notifs', where: 'local', ver: 1, export: false, desc: '通知已读状态' },
    { k: 'yzTextPatch', where: 'local', ver: 1, export: true, desc: '正文勘误（本机改字）' },
    { k: 'yzBookShellMap', where: 'local', ver: 1, export: true, desc: '书壳与导入文件的对应关系' },
    { k: 'yzq@*', where: 'local', ver: 2, export: false, desc: '内容包进度（按 packId 分区，见 challenge.js）' },
    { k: 'yzq_last_*', where: 'local', ver: 1, export: false, desc: '内容包最近打开时间' },
    { k: 'books', where: 'idb', ver: 1, export: false, desc: '导入的书籍正文（IndexedDB，体积大，不随导出）' },
    { k: 'packs', where: 'idb', ver: 1, export: false, desc: '导入的内容包（IndexedDB）' },
    { k: 'app_files', where: 'native', ver: 1, export: false, desc: 'App 私有目录里的导入文件与导出的成书' }
  ];

  function sizeOf(v) { return v == null ? 0 : String(v).length; }

  /* 统计当前实际占用：每条数据是否在场、大约多少字节。
     localStorage 能直接量；IndexedDB / 原生文件这里只报「清单声明」，不假装量过。 */
  function audit() {
    var out = [], legacy = 0;
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i], hit = 0, bytes = 0, n = 0;
      if (it.where === 'local') {
        try {
          var prefix = it.k.charAt(it.k.length - 1) === '*';
          var key = prefix ? it.k.slice(0, -1) : it.k;
          for (var j = 0; j < localStorage.length; j++) {
            var k = localStorage.key(j);
            if (!k) continue;
            var match = prefix ? k.indexOf(key) === 0 : k === key;
            if (!match) continue;
            hit++; n++;
            bytes += sizeOf(localStorage.getItem(k));
          }
        } catch (e) {}
      }
      out.push({ k: it.k, where: it.where, ver: it.ver, present: it.where === 'local' ? hit > 0 : null,
        count: n, bytes: bytes, desc: it.desc, export: !!it.export });
    }
    /* 未登记的 localStorage 键：不算错误，但要报出来，避免「悄悄长出一份没人管的数据」 */
    try {
      for (var q = 0; q < localStorage.length; q++) {
        var kk = localStorage.key(q);
        if (!kk) continue;
        var known = false;
        for (var t = 0; t < ITEMS.length; t++) {
          if (ITEMS[t].where !== 'local') continue;
          var pfx = ITEMS[t].k.charAt(ITEMS[t].k.length - 1) === '*';
          var base = pfx ? ITEMS[t].k.slice(0, -1) : ITEMS[t].k;
          if (pfx ? kk.indexOf(base) === 0 : kk === base) { known = true; break; }
        }
        if (!known) legacy++;
      }
    } catch (e) {}
    return { ver: 2, items: out, unlisted: legacy };
  }

  function findByKey(k) {
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i], pfx = it.k.charAt(it.k.length - 1) === '*';
      var base = pfx ? it.k.slice(0, -1) : it.k;
      if (pfx ? String(k).indexOf(base) === 0 : String(k) === base) return it;
    }
    return null;
  }

  /* 给诊断报告用的一行摘要 */
  function summary() {
    var a = audit(), n = 0, bytes = 0, listed = 0;
    for (var i = 0; i < a.items.length; i++) {
      if (a.items[i].present) { n++; bytes += a.items[i].bytes; }
      if (a.items[i].where === 'local') listed++;
    }
    return '数据清单 v' + a.ver + '：' + a.items.length + ' 类（localStorage ' + listed + ' 类），'
      + '当前有数据 ' + n + ' 类 / 约 ' + (bytes / 1024).toFixed(1) + ' KB'
      + (a.unlisted ? '；未登记键 ' + a.unlisted + ' 个' : '；无未登记键');
  }

  /* ---------------- 真实占用（不只是声明） ----------------
     localStorage 能逐键量；IndexedDB 与原生目录只能整体量。
     量不到就说量不到 —— 不拿「清单里有这一项」冒充「已经量过」。 */
  function storageEstimate(cb) {
    try {
      if (window.navigator && navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (e) {
          cb({ usage: (e && e.usage) || 0, quota: (e && e.quota) || 0 });
        }, function () { cb(null); });
        return;
      }
    } catch (e) {}
    cb(null);
  }

  /* 原生侧：有桥就数条目，没有桥（网页版）就明确报「不适用」 */
  function nativeStats() {
    var out = { available: false, books: null, media: null, note: '网页版没有原生文件目录' };
    try {
      var A = window.AndroidApp;
      if (A && typeof A.bookList === 'function') {
        out.available = true; out.note = '';
        try { out.books = (JSON.parse(A.bookList() || '[]') || []).length; } catch (e) { out.books = -1; }
        try {
          out.media = (typeof A.mediaList === 'function') ? (JSON.parse(A.mediaList() || '[]') || []).length : null;
        } catch (e) { out.media = -1; }
      }
    } catch (e) {}
    return out;
  }

  /* 给诊断报告用的完整版：同步部分 + 真实占用 + 原生条目 */
  function detail(cb) {
    var base = audit();
    storageEstimate(function (est) {
      base.estimate = est;                 /* null 表示这个环境给不出 */
      base.native = nativeStats();
      base.text = summary() + '；' +
        (est ? ('总占用 ' + (est.usage / 1048576).toFixed(1) + ' MB / 配额 ' + (est.quota / 1048576).toFixed(0) + ' MB')
             : '总占用：本环境无法测量') +
        (base.native.available
          ? ('；原生文件：书 ' + base.native.books + ' 本' + (base.native.media === null ? '' : '、媒体 ' + base.native.media + ' 个'))
          : '；原生文件：' + base.native.note);
      cb(base);
    });
  }

  window.YZDATAMAP = { ver: 2, items: ITEMS, audit: audit, summary: summary, find: findByKey, detail: detail, storageEstimate: storageEstimate, nativeStats: nativeStats };
})();
