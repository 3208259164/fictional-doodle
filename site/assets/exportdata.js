/* =====================================================================
   学通 · 我的笔记导出与存储用量（exportdata.js）
   ---------------------------------------------------------------------
   做什么：
     ① 把「摘录 / 笔记」导出成 Markdown（按书分组、原文用引用块）
     ② 把「收藏 / 书签 / 阅读状态」导出成 Markdown 表格
     ③ ①②合一（带一级标题 + 目录）
     ④ 导出一份 CSV（Excel 能直接开：开头带 UTF-8 BOM，否则中文乱码）
     ⑤ 本机存储用量报告（localStorage 逐键字节 + IndexedDB 估算）

   为什么单独一个文件：
     主 agent 正在改 app.js / mine.js 之外的东西，这里只读数据、只写文件，
     不改任何既有模块。数据全部现读 localStorage，不缓存、不复制。

   数据键（与 reading.js 一致，只读）：
     yzExcerpts [ {b:<bookId>, txt:'摘录', note:'我的想法', t:时间戳} ]
     yzRead     { <bookId>: { st:'want'|'reading'|'done', p:0-100, t:时间戳 } }
     favs       [ <bookId> ]
     marks      [ <bookId> ]

   关键坑（离线 WebView）：
     · App 内 <a download> 无效 → 先走 AndroidApp.saveBase64 桥（存到系统「下载」）；
     · 浏览器里没有桥 → Blob + <a download> 兜底；
     · 绝对不用 window.open（WebView 里会白屏），失败一律 toast 提示。

   导出面（全局）：
     window.YZEXPORT = {
       marksMd, cardsMd, allMd, csv, save, usage, refreshUsage,
       renderUsagePanel, openUsage, fileName, fmtBytes
     }
     window.yzExportNotes()        // 一行挂载用：导出 Markdown
     window.yzExportCsv()          // 一行挂载用：导出 CSV
     window.yzShowUsage()          // 一行挂载用：弹出存储用量面板
   ===================================================================== */
(function () {
  'use strict';

  var K_EXC = 'yzExcerpts', K_READ = 'yzRead', K_FAV = 'favs', K_MARK = 'marks', K_BOOK = 'yzImportedBooks';
  var LOCAL_QUOTA = 5 * 1024 * 1024;          /* localStorage 按 5MB 估算（保守：UTF-16 按 2 字节/字符） */
  var ST = {
    want:    { name: '想读', icon: '📌' },
    reading: { name: '在读', icon: '📖' },
    done:    { name: '读完', icon: '✅' }
  };
  /* 键名 → 人话（用量面板用；没登记的键直接显示原名） */
  var KEY_LABEL = {
    yzExcerpts: '摘录与笔记', yzRead: '阅读状态（书架）', favs: '收藏', marks: '书签',
    yzImportedBooks: '本机书籍（元数据）', yzy_ov_v1: '自助标注与改动', yzCustom: '自定义配置',
    yzTheme: '主题', yzFS: '字号', yzHome: '首页编排', yzFriend: '主页好友',
    yzChannel: '频道点赞与评论', yzQuiz: '做题题库', yzPath: '学习路径', yzDiag: '诊断记录'
  };

  /* ---------------- 通用 ---------------- */
  function res() { try { return window.SITE_RESOURCES || []; } catch (e) { return []; } }
  function ls(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function arr(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
  function obj(v) { return (v && typeof v === 'object') ? v : {}; }
  function s(v) { return (v === null || v === undefined) ? '' : String(v); }
  function bookOf(id) {
    if (!id) return null;
    var a = res();
    for (var i = 0; i < a.length; i++) { if (a[i] && a[i].id === id) return a[i]; }
    return null;
  }
  function bookName(id) { var b = bookOf(id); return b ? s(b.title) : '（未关联书目）'; }
  function bookAuthor(id) { var b = bookOf(id); return b ? s(b.author) : ''; }
  function bookCat(id) { var b = bookOf(id); return b ? s(b.cat) : ''; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDateTime(t) {
    var n = Number(t);
    if (!n || !isFinite(n)) return '';
    var d = new Date(n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtDate(t) {
    var n = Number(t), d = (n && isFinite(n)) ? new Date(n) : new Date();
    return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }
  function nowText() { return fmtDateTime(Date.now()); }
  function toastMsg(m) {
    try { if (typeof window.toast === 'function') { window.toast(m); return; } } catch (e) {}
    try { if (window.console && console.log) console.log('[学通·导出] ' + m); } catch (e) {}
  }
  function fmtBytes(b) {
    var n = Number(b) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(2) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  /* ---------------- 数据读取（只读，不改任何键） ---------------- */
  function excerpts() {
    var a = arr(ls(K_EXC, [])), out = [];
    for (var i = 0; i < a.length; i++) {
      var x = obj(a[i]);
      if (!s(x.txt)) continue;
      out.push({ b: s(x.b), txt: s(x.txt), note: s(x.note), t: Number(x.t) || 0 });
    }
    return out;
  }
  function favIds() { return arr(ls(K_FAV, [])).map(s); }
  function markIds() { return arr(ls(K_MARK, [])).map(s); }
  function readMap() { return obj(ls(K_READ, {})); }
  function readList() {
    var m = readMap(), out = [];
    for (var k in m) {
      if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
      var v = obj(m[k]);
      out.push({ id: s(k), st: s(v.st), p: Number(v.p) || 0, t: Number(v.t) || 0 });
    }
    /* 最近更新的排前面 */
    out.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    return out;
  }

  /* 按书分组：同一本书的摘录归一节，节按「最近一条摘录」倒序 */
  function group() {
    var list = excerpts(), map = {}, order = [];
    for (var i = 0; i < list.length; i++) {
      var x = list[i], key = x.b || '';
      if (!map[key]) { map[key] = { id: key, items: [], latest: 0 }; order.push(key); }
      map[key].items.push(x);
      if (x.t > map[key].latest) map[key].latest = x.t;
    }
    var groups = order.map(function (k) { return map[k]; });
    groups.sort(function (a, b) { return (b.latest || 0) - (a.latest || 0); });
    for (var j = 0; j < groups.length; j++) {
      groups[j].items.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    }
    return groups;
  }

  /* ---------------- Markdown：摘录与笔记 ---------------- */
  /* 多行文本 → 每行加 '> ' 前缀（引用块里空行用 '>' 占位，避免把引用块断开） */
  function quote(text) {
    return s(text).split(/\r?\n/).map(function (line) {
      return line ? '> ' + line : '>';
    }).join('\n');
  }
  function bookHeading(g, level) {
    var t = bookName(g.id);
    var a = bookAuthor(g.id);
    /* 书名本身已带书名号就不重复加 */
    var shown = (g.id && t.charAt(0) !== '《') ? '《' + t + '》' : t;
    return new Array(level + 1).join('#') + ' ' + shown +
      (a ? ' · ' + a : '') + '（' + g.items.length + ' 条）';
  }
  /* level=2 时书名为 ###；供 allMd 复用 */
  function marksBody(level) {
    level = level || 2;
    var gs = group(), out = [];
    out.push(new Array(level + 1).join('#') + ' 摘录与笔记（' + gs.length + ' 本书 / ' + excerpts().length + ' 条）');
    out.push('');
    if (!gs.length) {
      out.push('还没有摘录。打开一本书，在「我的摘录」里可以存原文和自己的想法。');
      out.push('');
      return out.join('\n');
    }
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i];
      out.push(bookHeading(g, level + 1));
      out.push('');
      for (var j = 0; j < g.items.length; j++) {
        var x = g.items[j];
        out.push(quote(x.txt));
        out.push('');
        if (x.note) {
          out.push('💭 我的想法：');
          out.push('');
          out.push(x.note);
          out.push('');
        }
        if (x.t) { out.push('*' + fmtDateTime(x.t) + '*'); out.push(''); }
      }
      if (i < gs.length - 1) { out.push('---'); out.push(''); }
    }
    return out.join('\n');
  }

  /* ---------------- Markdown：收藏 / 书签 / 阅读状态 ---------------- */
  function cell(v) { return s(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—'; }
  function table(head, rows) {
    var out = [];
    out.push('| ' + head.join(' | ') + ' |');
    out.push('| ' + head.map(function () { return '---'; }).join(' | ') + ' |');
    for (var i = 0; i < rows.length; i++) {
      out.push('| ' + rows[i].map(cell).join(' | ') + ' |');
    }
    return out.join('\n');
  }
  function cardsBody(level) {
    level = level || 2;
    var H = new Array(level + 1).join('#');
    var out = [];
    var favs = favIds(), marks = markIds(), reads = readList();

    out.push(H + ' 收藏 · 书签 · 阅读状态');
    out.push('');

    out.push(new Array(level + 2).join('#') + ' ⭐ 收藏（' + favs.length + '）');
    out.push('');
    if (favs.length) {
      out.push(table(['#', '书名', '作者', '分类'],
        favs.map(function (id, i) { return [i + 1, bookOf(id) ? bookName(id) : id, bookAuthor(id), bookCat(id)]; })));
    } else { out.push('（暂无）'); }
    out.push('');

    out.push(new Array(level + 2).join('#') + ' 🔖 书签（' + marks.length + '）');
    out.push('');
    if (marks.length) {
      out.push(table(['#', '书名', '作者', '分类'],
        marks.map(function (id, i) { return [i + 1, bookOf(id) ? bookName(id) : id, bookAuthor(id), bookCat(id)]; })));
    } else { out.push('（暂无）'); }
    out.push('');

    out.push(new Array(level + 2).join('#') + ' 📖 阅读状态（' + reads.length + '）');
    out.push('');
    if (reads.length) {
      out.push(table(['#', '状态', '进度', '书名', '作者'],
        reads.map(function (r, i) {
          var st = ST[r.st] || { name: r.st || '—', icon: '' };
          var prog = (r.st === 'done') ? '100%' : (r.p ? r.p + '%' : '—');
          return [i + 1, st.icon + ' ' + st.name, prog, bookOf(r.id) ? bookName(r.id) : r.id, bookAuthor(r.id)];
        })));
    } else { out.push('（暂无）'); }
    out.push('');
    return out.join('\n');
  }

  /* ---------------- 落款 ---------------- */
  function footer() {
    var gs = group();
    var out = ['---', ''];
    out.push('*共 ' + gs.length + ' 本书 · ' + excerpts().length + ' 条摘录 · 收藏 ' + favIds().length +
      ' · 书签 ' + markIds().length + ' · 书架 ' + readList().length + ' · 生成于 ' + nowText() + '*');
    out.push('');
    out.push('> 由「学通」App 在本机生成，内容未上传任何服务器。');
    out.push('');
    return out.join('\n');
  }

  function marksMd() {
    return '# ✍️ 我的摘录与笔记\n\n' + marksBody(2) + footer();
  }
  function cardsMd() {
    return '# 📌 收藏 · 书签 · 阅读状态\n\n' + cardsBody(2) + footer();
  }
  function allMd() {
    var gs = group();
    var out = [];
    out.push('# 学通 · 我的阅读笔记');
    out.push('');
    out.push('> 离线生成于本机 · 共 ' + gs.length + ' 本书 / ' + excerpts().length + ' 条摘录 · 收藏 ' +
      favIds().length + ' · 书签 ' + markIds().length + ' · 书架 ' + readList().length + ' 本。');
    out.push('');
    out.push('## 目录');
    out.push('');
    out.push('1. [摘录与笔记](#摘录与笔记)');
    out.push('2. [收藏 · 书签 · 阅读状态](#收藏--书签--阅读状态)');
    out.push('');
    out.push('---');
    out.push('');
    out.push(marksBody(2));
    out.push('---');
    out.push('');
    out.push(cardsBody(2));
    out.push(footer());
    return out.join('\n');
  }

  /* ---------------- CSV ---------------- */
  function csvCell(v) {
    var t = s(v);
    if (/[",\r\n]/.test(t)) return '"' + t.replace(/"/g, '""') + '"';
    return t;
  }
  /* 开头必须带 BOM（\uFEFF），否则 Excel 打开中文是乱码 */
  function csv() {
    var rows = [['类型', '书名', '作者', '内容', '备注', '时间']];
    var ex = excerpts(), favs = favIds(), marks = markIds(), reads = readList();
    ex.forEach(function (x) {
      rows.push(['摘录', bookName(x.b), bookAuthor(x.b), x.txt, x.note, fmtDateTime(x.t)]);
    });
    favs.forEach(function (id) {
      rows.push(['收藏', bookOf(id) ? bookName(id) : id, bookAuthor(id), '', bookCat(id), '']);
    });
    marks.forEach(function (id) {
      rows.push(['书签', bookOf(id) ? bookName(id) : id, bookAuthor(id), '', '书签', '']);
    });
    reads.forEach(function (r) {
      var st = ST[r.st] || { name: r.st || '' };
      rows.push(['阅读状态', bookOf(r.id) ? bookName(r.id) : r.id, bookAuthor(r.id),
        st.name, (r.st === 'done' ? '100%' : (r.p ? r.p + '%' : '')), fmtDateTime(r.t)]);
    });
    var text = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    return '\uFEFF' + text + '\r\n';
  }

  /* ---------------- 下载通道（双通道） ---------------- */
  function isApp() {
    try { return !!(window.AndroidApp && typeof window.AndroidApp.saveBase64 === 'function'); } catch (e) { return false; }
  }
  function b64utf8(str) {
    try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return ''; }
  }
  /* ① AndroidApp 桥：存到系统「下载」（App 内唯一可靠通道） */
  function saveViaApp(name, mime, text) {
    if (!isApp()) return false;
    var b = b64utf8(text);
    if (!b) return false;
    try { window.AndroidApp.saveBase64(name, b, mime); return true; } catch (e) { return false; }
  }
  /* ② 浏览器 Blob + <a download>（WebView 里 <a download> 无效，但网页端可以） */
  function saveViaBlob(name, mime, text) {
    try {
      if (typeof Blob === 'undefined') return false;
      var blob = new Blob([text], { type: mime });
      var url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : '';
      if (!url) return false;
      var a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      a.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { a.parentNode && a.parentNode.removeChild(a); } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e) {}
      }, 1200);
      return true;
    } catch (e) { return false; }
  }
  /* ③ 最后兜底：cite.js 的 YZSave（它自己内部也做桥 / Blob 二选一） */
  function saveViaYZSave(name, mime, text) {
    try {
      if (window.YZSave && typeof window.YZSave.text === 'function') return !!window.YZSave.text(name, mime, text);
    } catch (e) {}
    return false;
  }
  function deliver(name, mime, text) {
    if (saveViaApp(name, mime, text)) return 'app';
    if (saveViaBlob(name, mime, text)) return 'blob';
    if (saveViaYZSave(name, mime, text)) return 'yzsave';
    return '';
  }
  function fileName(kind) {
    kind = (s(kind).toLowerCase() === 'csv') ? 'csv' : 'md';
    return '学通-笔记-' + fmtDate(Date.now()) + (kind === 'csv' ? '.csv' : '.md');
  }
  /* save('md'|'csv') → 返回实际走的通道：'app'|'blob'|'yzsave'|''（空 = 全失败） */
  function save(kind) {
    var k = (s(kind).toLowerCase() === 'csv') ? 'csv' : 'md';
    var text = (k === 'csv') ? csv() : allMd();
    var name = fileName(k);
    var mime = (k === 'csv') ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
    var ch = deliver(name, mime, text);
    if (ch === 'app') toastMsg('已保存到系统「下载」：' + name);
    else if (ch) toastMsg('已下载：' + name);
    else toastMsg('导出失败：此环境不支持保存文件（可改用「导出我的数据」复制文本）');
    return ch;
  }

  /* ---------------- 存储用量 ---------------- */
  /* UTF-16 估算：JSON.stringify(v).length * 2 字节（localStorage 以 UTF-16 计） */
  function bytesOf(v) { try { return JSON.stringify(s(v)).length * 2; } catch (e) { return 0; } }
  var __idb = { books: 0, bytes: 0, quota: 0, percent: 0, available: false, pending: true, source: 'none' };

  function importedBooks() {
    var a = arr(ls(K_BOOK, []));
    var bytes = 0;
    for (var i = 0; i < a.length; i++) { bytes += Number(obj(a[i]).size) || 0; }
    return { count: a.length, bytes: bytes };
  }
  function usage() {
    var byKey = [], used = 0, keys = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var b = bytesOf(localStorage.getItem(k));
        byKey.push({ k: s(k), bytes: b });
        used += b; keys++;
      }
    } catch (e) {}
    byKey.sort(function (a, b) { return b.bytes - a.bytes; });

    var ib = importedBooks();
    var idb = {
      books: __idb.available ? __idb.books : ib.count,
      bytes: __idb.available ? __idb.bytes : ib.bytes,
      quota: __idb.quota, percent: __idb.percent,
      available: __idb.available, pending: __idb.pending, source: __idb.available ? 'estimate' : 'fallback'
    };
    return {
      local: {
        used: used, total: LOCAL_QUOTA,
        percent: LOCAL_QUOTA ? Math.round(used / LOCAL_QUOTA * 1000) / 10 : 0,
        keys: keys
      },
      idb: idb,
      byKey: byKey
    };
  }
  /* 异步刷新 IndexedDB / 缓存用量（navigator.storage.estimate）；不可用时静默降级 */
  function refreshUsage() {
    var run = function () {
      try {
        if (navigator && navigator.storage && typeof navigator.storage.estimate === 'function') {
          return navigator.storage.estimate().then(function (est) {
            est = est || {};
            var used = Number(est.usage) || 0, quota = Number(est.quota) || 0;
            var ib = importedBooks();
            __idb.bytes = used; __idb.quota = quota; __idb.books = ib.count;
            __idb.percent = quota ? Math.round(used / quota * 1000) / 10 : 0;
            __idb.available = true; __idb.pending = false;
            return usage();
          })['catch'](function () {
            __idb.available = false; __idb.pending = false;
            return usage();
          });
        }
      } catch (e) {}
      __idb.available = false; __idb.pending = false;
      return usage();
    };
    try { return Promise.resolve(run()).then(function (u) { return u; }); }
    catch (e) { __idb.pending = false; return { then: function (f) { return f(usage()); } }; }
  }

  function conclusion(u) {
    var p = u.local.percent;
    if (!u.local.keys) return '本机还没有保存任何数据，导出与用量都是空的。';
    if (p >= 90) return '⚠️ 本机存储快满了（已用 ' + p + '%）：建议先导出笔记备份，再清理不用的摘录 / 相册照片，否则新的保存可能写不进去。';
    if (p >= 70) return '注意：本机存储已用 ' + p + '%（浏览器上限约 5 MB），再加上 IndexedDB 里的本机书籍，随手保存可能失败。';
    if (p >= 40) return '存储用量正常（' + p + '%），继续用即可；攒多了记得导出一次 Markdown 备份。';
    return '存储还很宽松（' + p + '%），正常使用即可。';
  }
  /* 0<p<0.1 时显示「<0.1%」，避免四舍五入成 0% 让人以为没算 */
  function pctText(p) {
    var n = Number(p) || 0;
    if (n > 0 && n < 0.1) return '&lt;0.1%';
    return n + '%';
  }
  function bar(percent, extraStyle) {
    var p = Math.max(0, Math.min(100, Number(percent) || 0));
    var color = p >= 90 ? '#e05252' : (p >= 70 ? '#e0a352' : 'var(--accent)');
    return '<div style="height:8px;border-radius:5px;background:var(--card-border);overflow:hidden' + (extraStyle || '') + '">' +
      '<i style="display:block;height:100%;width:' + p + '%;background:' + color + ';border-radius:5px;transition:width .3s"></i></div>';
  }

  /* 设置 → 存储：返回一段 HTML，可直接 innerHTML 挂上去 */
  function renderUsagePanel() {
    var u = usage(), out = [];
    out.push('<div class="yz-usage">');
    out.push('<p style="margin:0 0 6px;font-size:.84rem;line-height:1.7">本机存储（localStorage）已用 <b>' +
      fmtBytes(u.local.used) + '</b> / ' + fmtBytes(u.local.total) + ' · <b>' + pctText(u.local.percent) + '</b>' +
      ' · 共 ' + u.local.keys + ' 个数据键</p>');
    out.push(bar(u.local.percent, ';margin:0 0 8px'));
    out.push('<p class="sub" style="font-size:.76rem;opacity:.7;line-height:1.7;margin:0 0 10px">' + conclusion(u) + '</p>');

    /* IndexedDB / 缓存（本机书籍、相册照片在那边，localStorage 装不下） */
    if (u.idb.available) {
      out.push('<p style="margin:0 0 6px;font-size:.8rem;line-height:1.7">本机书籍 <b>' + u.idb.books + '</b> 本 · ' +
        'IndexedDB / 离线缓存 约 <b>' + fmtBytes(u.idb.bytes) + '</b>' +
        (u.idb.quota ? '（可用配额 ' + fmtBytes(u.idb.quota) + '，已用 ' + pctText(u.idb.percent) + '）' : '') + '</p>');
      out.push(bar(u.idb.percent, ';margin:0 0 10px'));
    } else {
      out.push('<p class="sub" style="font-size:.76rem;opacity:.7;line-height:1.7;margin:0 0 10px">' +
        'IndexedDB 用量：本机书籍 <b>' + u.idb.books + '</b> 本' +
        (u.idb.bytes ? '（约 ' + fmtBytes(u.idb.bytes) + '，按导入文件大小累计）' : '') +
        '。当前环境不支持容量估算，只能给出这个数字。</p>');
    }

    /* 占用最大的前 10 个键 */
    out.push('<p style="margin:0 0 4px;font-size:.8rem;font-weight:600">占用最大的前 10 个键</p>');
    if (!u.byKey.length) {
      out.push('<p class="sub" style="font-size:.78rem;opacity:.7;margin:0">（空）</p>');
    } else {
      out.push('<div style="font-size:.76rem;line-height:1.9">');
      u.byKey.slice(0, 10).forEach(function (it) {
        var pct = u.local.used ? Math.round(it.bytes / u.local.used * 100) : 0;
        out.push('<div style="display:flex;align-items:center;gap:8px;justify-content:space-between">' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          escapeHtml(KEY_LABEL[it.k] || it.k) +
          '<span style="opacity:.45;font-size:.68rem"> ' + escapeHtml(it.k) + '</span></span>' +
          '<span style="opacity:.75;white-space:nowrap">' + fmtBytes(it.bytes) + ' · ' + pct + '%</span></div>');
      });
      out.push('</div>');
    }
    out.push('</div>');
    return out.join('');
  }
  function escapeHtml(t) {
    return s(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 弹出用量面板（自带浮层，不依赖 index.html 结构；Esc / 点背景关闭） */
  var __escBound = false;
  var __ovBound = false;
  function openUsage() {
    var ov = document.getElementById('yzUsageOv');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'yzUsageOv';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', '本机存储用量');
      ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:rgba(0,0,0,.62);' +
        'display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box';
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
      document.body.appendChild(ov);
    }
    if (!__escBound) {
      __escBound = true;
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { var o = document.getElementById('yzUsageOv'); if (o) o.remove(); }
      });
    }
    ov.innerHTML = '<div style="width:100%;max-width:420px;max-height:82vh;overflow:auto;background:var(--card,#fff);' +
      'color:var(--text,#222);border:1px solid var(--card-border,#ddd);border-radius:14px;padding:16px;box-sizing:border-box">' +
      '<b style="font-size:.95rem">📊 本机存储用量</b>' +
      '<div id="yzUsageBody" style="margin-top:10px">' + renderUsagePanel() + '</div>' +
      '<p class="sub" style="font-size:.72rem;opacity:.55;line-height:1.6;margin:10px 0 0">' +
      '全部数据只在本机：没有账号、不上传。数字为估算值（localStorage 按 UTF-16 2 字节/字符、上限按 5 MB）。</p>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button class="sbtn" data-yzusage="refresh">刷新</button>' +
      '<button class="sbtn" data-yzusage="md">📝 导出笔记</button>' +
      '<button class="sbtn" data-yzusage="close">关闭</button></div>' +
      '</div>';
    /* 事件委托只绑一次，重复调用 openUsage 不会重复触发导出 */
    if (!__ovBound) {
      __ovBound = true;
      document.addEventListener('click', function (e) {
        var t = e.target, act = (t && t.getAttribute) ? t.getAttribute('data-yzusage') : '';
        if (!act) return;
        var o = document.getElementById('yzUsageOv');
        if (act === 'close') { if (o) o.remove(); return; }
        if (act === 'md') { save('md'); return; }
        if (act === 'refresh') {
          var body = document.getElementById('yzUsageBody');
          if (body) body.innerHTML = '<p class="sub" style="font-size:.78rem;opacity:.7;margin:0">正在估算…</p>';
          refreshUsage().then(function () {
            var b2 = document.getElementById('yzUsageBody');
            if (b2) b2.innerHTML = renderUsagePanel();
            toastMsg('已刷新存储用量');
          });
        }
      }, true);
    }
    /* 打开即异步补上 IndexedDB 数字 */
    refreshUsage().then(function () {
      var b = document.getElementById('yzUsageBody');
      if (b) b.innerHTML = renderUsagePanel();
    });
    return ov;
  }

  window.YZEXPORT = {
    marksMd: marksMd, cardsMd: cardsMd, allMd: allMd, csv: csv,
    save: save, fileName: fileName,
    usage: usage, refreshUsage: refreshUsage,
    renderUsagePanel: renderUsagePanel, openUsage: openUsage,
    fmtBytes: fmtBytes, fmtDateTime: fmtDateTime
  };
  /* 一行挂载用（index.html / 设置页的 onclick 直接调用） */
  window.yzExportNotes = function () { return save('md'); };
  window.yzExportCsv = function () { return save('csv'); };
  window.yzShowUsage = openUsage;
})();
