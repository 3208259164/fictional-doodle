/* =====================================================================
   学通 · 本机书籍「导入 / 阅读」
   ---------------------------------------------------------------------
   做什么：
     · 从本机选电子书（TXT / MD / EPUB / PDF）导入
     · 文件内容存 IndexedDB（容量大），元数据存 localStorage
     · 导入的书会并入资源库 RES → **能被顶部搜索搜到、能点开详情**
     · 内置阅读器：TXT / MD 直接读（分段渲染、字号可调、记住进度）
  为什么能这样存：
     App 内页面跑在 WebViewAssetLoader 的 https 源上（appassets.androidplatform.net），
     属安全上下文，IndexedDB 可正常使用；离线、无网络权限也不受影响。
   ===================================================================== */
(function () {
  'use strict';

  var DB_NAME = 'yz_books_v1', STORE = 'files', LS = 'yzImportedBooks';
  var MAX_MB = 80;                                  /* 单文件上限，防止把存储撑爆 */
  var isFn = function (f) { return typeof f === 'function'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  /* ---------------- 元数据（localStorage） ---------------- */
  function metaAll() { try { var a = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function metaSave(a) { try { localStorage.setItem(LS, JSON.stringify(a || [])); return true; } catch (e) { return false; } }

  /* ---------------- 文件内容（IndexedDB） ---------------- */
  var _db = null;
  function withDB(cb) {
    if (_db) return cb(_db);
    if (!window.indexedDB) return cb(null);
    var _tDb = (window.__YZTiming ? window.__YZTiming.now() : 0);
    try {
      var rq = window.indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () { try { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); } catch (e) { } };
      rq.onsuccess = function () {
        _db = rq.result;
        try { if (window.__YZTiming) window.__YZTiming.span('dbOpen', _tDb); } catch (e) {}
        cb(_db);
      };
      rq.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  function dbPut(id, blob, cb) {
    withDB(function (d) {
      if (!d) return isFn(cb) && cb(false);
      try {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = function () { isFn(cb) && cb(true); };
        tx.onerror = function () { isFn(cb) && cb(false); };
      } catch (e) { isFn(cb) && cb(false); }
    });
  }
  function dbGet(id, cb) {
    withDB(function (d) {
      if (!d) return cb(null);
      try {
        var rq = d.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        rq.onsuccess = function () { cb(rq.result || null); };
        rq.onerror = function () { cb(null); };
      } catch (e) { cb(null); }
    });
  }
  function dbDel(id, cb) {
    withDB(function (d) {
      if (!d) return isFn(cb) && cb(false);
      try {
        var tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { isFn(cb) && cb(true); };
        tx.onerror = function () { isFn(cb) && cb(false); };
      } catch (e) { isFn(cb) && cb(false); }
    });
  }

  /* ---------------- 书名归一化 + 匹配已有「书壳」 ---------------- */
  function normTitle(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/\.[a-z0-9]{1,5}$/, '')
      .replace(/[《》【】\[\]（）()〈〉「」『』\s·・,，.。_\-—–~!！?？:：;；'"“”‘’]/g, '')
      .replace(/(人民出版社|中央编译局|中共中央|扫描版|高清版|高清|完整版|文字版|整理|校订|pdf|epub|txt|markdown|md|azw3|mobi)/g, '');
  }
  /* 在资源库里找同名的“书壳”（只认非本机条目），找不到返回 null */
  /* 编辑距离相似度（0~1），用于判断「导入书名与书壳差多少」 */
  function simScore(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 1;
    var m = a.length, n = b.length;
    if (!m || !n) return 0;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return 1 - prev[n] / Math.max(m, n);
  }
  /* 找到最接近的书壳，并带回「是否完全同名 / 相似度」——是否要弹窗由 decideShell 决定 */
  function findShellInfo(title) {
    if (typeof RES === 'undefined' || !RES) return null;
    var nt = normTitle(title);
    if (nt.length < 2) return null;
    var exact = null, partial = null, ps = 0, pdiff = 99;
    for (var i = 0; i < RES.length; i++) {
      var r = RES[i];
      if (!r || r.local) continue;
      var rt = normTitle(r.title);
      if (!rt) continue;
      if (rt === nt) { exact = r; break; }
      /* 门槛从 5 字放宽到 3 字：像《资本论 第一卷》→《资本论》这种短书名也能被认出来；
         因为有「书名不完全一致」的弹窗把关，放宽不会造成静默挂错。 */
      if (nt.length >= 3 && rt.length >= 3 &&
        (rt.indexOf(nt) >= 0 || nt.indexOf(rt) >= 0) &&
        Math.abs(rt.length - nt.length) <= 6) {
        var diff = Math.abs(rt.length - nt.length), sc = simScore(rt, nt);
        /* 先比「长度差」再比相似度：《资本论 第一卷》同时包含「资本论」与「资本论导读」时，
           长度差最小的才是真书壳，否则会错挂到《资本论导读》上。 */
        if (!partial || diff < pdiff || (diff === pdiff && sc > ps)) { partial = r; ps = sc; pdiff = diff; }
      }
    }
    if (exact) return { item: exact, exact: true, score: 1 };
    if (partial) return { item: partial, exact: false, score: ps };
    return null;
  }
  function findShell(title) { var f = findShellInfo(title); return f ? f.item : null; }

  /* 决定「要不要挂到已有书壳」：
     · 完全同名（归一化后一致）→ 静默挂上，不打扰；
     · 只是相近（如带副标题、卷次、版本号）→ 弹窗说明「本机文件名 / 资源库条目」，
       选「继续」挂到该书壳，选「取消」则作为一本新书单独导入，避免挂错书。
     同一次会话里同一个书壳只问一次，批量导入不会连环弹窗。 */
  var _askedShell = {};
  function decideShell(rec) {
    var info = findShellInfo(rec.title);
    if (!info) return null;
    if (info.exact) return info.item;
    var key = info.item.id;
    if (!(key in _askedShell)) {
      var msg = '书名不完全一致\n\n'
        + '本机文件：' + String(rec.title || '').slice(0, 60) + '\n'
        + '资源库条目：' + String(info.item.title || '').slice(0, 60) + '\n'
        + (info.item.author ? '作者：' + String(info.item.author).slice(0, 30) + '\n' : '')
        + '\n要继续把它挂到这本书的「书壳」下吗？（共用封面与介绍）\n'
        + '· 点「确定」＝ 继续，视为同一本书\n'
        + '· 点「取消」＝ 作为一本新书单独导入';
      var ok;
      try { ok = window.confirm(msg); } catch (e) { ok = true; }
      _askedShell[key] = !!ok;
    }
    return _askedShell[key] ? info.item : null;
  }
  /* 把本机文件挂到已有条目上（不新建条目） */
  function attach(r, rec) {
    if (!r) return;
    r.local = true;
    r.bookId = rec.id;
    if (!r._src0) r._src0 = r.src;
    if (rec.fmt && rec.fmt !== '—') r.fmt = rec.fmt;
    if (rec.sizeTxt) r.size = rec.sizeTxt;
    if (rec.date) r.date = rec.date;
    r.src = '本机导入';
    r.hasLocal = true;
  }
  function metaPatch(id, patch) {
    var a = metaAll(), ch = false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].id === id) { for (var k in patch) { a[i][k] = patch[k]; } ch = true; }
    }
    if (ch) { try { metaSave(a); } catch (e) { } }
  }

  /* ---------------- 并入资源库（于是能被搜索、能进详情页） ---------------- */
  /* silent=true：启动恢复时用——直接按书名挂，不弹「书名不完全一致」确认框
     （否则每次开机都会冒出一个莫名其妙的对话框）。用户主动导入才弹。 */
  function inject(rec, silent) {
    if (typeof RES === 'undefined' || !RES) return null;
    /* ① 已有同名「书壳」→ 把本机正文挂上去（绝不重复生成条目） */
    var shell = silent ? findShell(rec.title) : decideShell(rec);
    if (shell) { attach(shell, rec); metaPatch(rec.id, { targetId: shell.id }); return shell; }
    /* ② 否则新建一条“本机导入”条目 */
    var rid = 'local-' + rec.id, exist = null;
    for (var i = 0; i < RES.length; i++) { if (RES[i].id === rid) { exist = RES[i]; break; } }
    if (exist) { attach(exist, rec); return exist; }
    var item = {
      id: rid,
      title: rec.title,
      author: rec.author || '本机导入',
      cat: rec.cat || '我的书',
      icon: rec.icon || '📥',
      tags: ['本机导入'].concat(rec.fmt ? [rec.fmt] : []),
      alias: '', py: '',
      desc: '本机导入 · ' + (rec.fmt || '未知格式') + (rec.sizeTxt ? ' · ' + rec.sizeTxt : ''),
      intro: '这是你从本机导入的电子书，内容只保存在本机、不会上传。点「📖 开始阅读」即可在应用内阅读。',
      fmt: rec.fmt || '—',
      size: rec.sizeTxt || '—',
      src: '本机导入',
      status: 'ok',
      hot: 999,
      url: '#local',
      date: rec.date || '',
      local: true,
      bookId: rec.id
    };
    RES.push(item);
    return item;
  }
  /* 一次性取出 IndexedDB 里全部主键（用于完整性自检） */
  function dbKeys(cb) {
    withDB(function (d) {
      if (!d) return cb(null);
      try {
        var tx = d.transaction(STORE, 'readonly'), st = tx.objectStore(STORE);
        if (typeof st.getAllKeys !== 'function') return cb(null);
        var rq = st.getAllKeys();
        rq.onsuccess = function () { cb(Array.prototype.slice.call(rq.result || [])); };
        rq.onerror = function () { cb(null); };
      } catch (e) { cb(null); }
    });
  }
  /* 文件已不在 IndexedDB 时，把挂在它上面的「书壳」解下来，恢复成“暂无原文” */
  function detachByBookId(id) {
    if (typeof RES === 'undefined' || !RES) return;
    for (var i = 0; i < RES.length; i++) {
      var r = RES[i];
      if (r && r.bookId === id) {
        delete r.local; delete r.bookId; delete r.hasLocal;
        if (r._src0) { r.src = r._src0; delete r._src0; }
      }
    }
  }
  function loadAll() {
    var arr = metaAll();
    var paint = function (list) {
      list.forEach(function (m) {
        /* 之前挂到过某个条目 → 直接挂回去 */
        if (m.targetId && typeof RES !== 'undefined' && RES) {
          var t = null;
          for (var i = 0; i < RES.length; i++) { if (RES[i].id === m.targetId) { t = RES[i]; break; } }
          if (t) { attach(t, m); return; }
        }
        inject(m, true);   /* 内部：优先按书名挂到已有书壳，否则新建条目（静默，不弹窗） */
      });
    };
    paint(arr);
    /* 一次性完整性自检：元数据在、文件却已被系统清掉的，不能再显示“已收录” */
    dbKeys(function (keys) {
      if (!keys) return;                       /* 环境不支持检查 → 保持原样 */
      var have = {};
      keys.forEach(function (k) { have[k] = 1; });
      var missing = arr.filter(function (m) { return !have[m.id]; });
      if (!missing.length) return;
      missing.forEach(function (m) { detachByBookId(m.id); });
      try { metaSave(arr.filter(function (m) { return have[m.id]; })); } catch (e) { }
      try { if (typeof render === 'function') render(); } catch (e) { }
      try { toast('检测到 ' + missing.length + ' 本本机电子书已不在本机（可能被系统清理了），条目已还原为「暂无原文」，可重新导入'); } catch (e) { }
    });
    /* 尽量申请“持久化存储”，降低被系统自动清理的概率 */
    try { if (window.navigator && navigator.storage && typeof navigator.storage.persist === 'function') navigator.storage.persist(); } catch (e) { }
  }

  /* 「导入本书」：把本机文件直接挂到指定条目上（书名相同就不新建条目） */
  function importInto(itemId) {
    pick(function (recs) {
      var tgt = null;
      if (typeof RES !== 'undefined' && RES) {
        for (var i = 0; i < RES.length; i++) { if (RES[i].id === itemId) { tgt = RES[i]; break; } }
      }
      var hit = null;
      (recs || []).forEach(function (rec) {
        var t = (tgt && !tgt.local) ? tgt : decideShell(rec);
        if (t && !t.local) { attach(t, rec); metaPatch(rec.id, { targetId: t.id }); if (!hit) hit = t; }
      });
      try { if (typeof render === 'function') render(); } catch (e) { }
      if (hit && typeof openItemDetail === 'function') {
        var ix = RES.indexOf(hit); if (ix >= 0) openItemDetail(ix);
      }
    });
  }

  /* ---------------- 导入 ---------------- */
  function fmtOf(name, type) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    var e = m ? m[1] : '';
    if (e === 'markdown') e = 'md';
    if (!e) e = (/pdf/.test(type || '') ? 'pdf' : (/epub/.test(type || '') ? 'epub' : 'txt'));
    return e.toUpperCase();
  }
  function sizeTxt(n) {
    n = Number(n) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function importOne(file, done) {
    var fmt = fmtOf(file.name, file.type);
    if (file.size > MAX_MB * 1048576) { try { toast('「' + file.name + '」超过 ' + MAX_MB + 'MB，已跳过'); } catch (e) { } return done(); }
    var id = uid();
    dbPut(id, file, function (ok) {
      if (!ok) { try { toast('「' + file.name + '」保存失败（本机存储可能已满）'); } catch (e) { } return done(); }
      var rec = {
        id: id,
        title: String(file.name).replace(/\.[^.]+$/, ''),
        author: '本机导入',
        cat: '我的书',
        icon: '📥',
        fmt: fmt,
        sizeTxt: sizeTxt(file.size),
        size: file.size,
        date: new Date().toISOString().slice(0, 10)
      };
      var arr = metaAll(); arr.push(rec); metaSave(arr);
      inject(rec);
      done(rec);
    });
  }

  function pick(cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.txt,.md,.markdown,.epub,.pdf,text/plain,application/pdf,application/epub+zip';
    inp.multiple = true;
    inp.style.display = 'none';
    inp.onchange = function () {
      var fs = Array.prototype.slice.call(inp.files || []);
      if (!fs.length) { try { inp.remove(); } catch (e) { } return; }
      var i = 0, okN = 0, recs = [];
      (function next() {
        if (i >= fs.length) {
          try { inp.remove(); } catch (e) { }
          try { if (typeof render === 'function') render(); } catch (e) { }
          try { toast('已导入 ' + okN + ' 本 · 可在顶部搜索或「导入书籍」里打开'); } catch (e) { }
          if (isFn(cb)) { try { cb(recs); } catch (e) { } }
          else { try { if (typeof openLocalShelf === 'function') openLocalShelf(); } catch (e) { } }
          return;
        }
        var f = fs[i++];
        importOne(f, function (r) { if (r) recs.push(r); okN++; next(); });
      })();
    };
    document.body.appendChild(inp);
    inp.click();
    setTimeout(function () { try { inp.remove(); } catch (e) { } }, 120000);
  }

  /* ---------------- 「我的书」书架 ---------------- */
  function openLocalShelf() {
    var arr = metaAll();
    var body = arr.length
      ? arr.map(function (m) {
        return '<div class="lcard" style="cursor:default">' +
          '<span class="li">📥</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="pname">' + esc(m.title) + '</div>' +
            '<div class="prole">' + esc(m.fmt) + (m.sizeTxt ? ' · ' + esc(m.sizeTxt) : '') + ' · ' + esc(m.date || '') + '</div>' +
          '</div>' +
          '<button class="sbtn" style="flex:none" onclick="yzBooks.read(\'' + esc(m.id) + '\',\'' + esc(m.title).replace(/'/g, "\\'") + '\')">📖 阅读</button>' +
          '<button class="sbtn" style="flex:none" onclick="yzBooks.remove(\'' + esc(m.id) + '\')" title="从本机删除">🗑</button>' +
          '</div>';
      }).join('')
      : '<p class="sub">还没有导入书籍。点上方「📥 导入书籍」从本机选择 TXT / MD / EPUB / PDF 文件。</p>';
    if (typeof openContent === 'function') {
      openContent('📥 我的书 · ' + arr.length,
        (typeof crumbFrom === 'function' ? crumbFrom([{ t: '我的书', fn: openLocalShelf }]) : '') +
        '<p class="sub" style="margin:0 0 10px;line-height:1.7">导入的书只存在本机，会被并入资源库——顶部搜索也能搜到。<br><b>请勿在系统设置里「清除应用数据」</b>，否则本机电子书会一并丢失。</p>' +
        '<div class="ops" style="margin:0 0 12px"><button onclick="yzBooks.pick()">📥 导入书籍</button></div>' +
        body);
    }
  }

  /* ---------------- 阅读器 ---------------- */
  function read(id, title) {
    dbGet(id, function (blob) {
      if (!blob) { try { toast('找不到这本书的内容（可能已被清理）'); } catch (e) { } return; }
      var fmt = fmtOf(title, blob.type);
      if (fmt === 'TXT' || fmt === 'MD') {
        var fr = new FileReader();
        fr.onload = function () { renderReader(title, String(fr.result || ''), id); };
        fr.onerror = function () { try { toast('读取失败'); } catch (e) { } };
        fr.readAsText(blob);
      } else if (fmt === 'EPUB') {
        try { toast('EPUB 在线阅读正在开发中；可先用「导出」到电脑，或用其他应用打开'); } catch (e) { }
        renderUnsupported(title, id, fmt);
      } else {
        renderUnsupported(title, id, fmt);
      }
    });
  }

  function renderUnsupported(title, id, fmt) {
    if (typeof openContent !== 'function') return;
    openContent('📖 ' + title,
      (typeof crumbFrom === 'function' ? crumbFrom([{ t: '我的书', fn: openLocalShelf }, { t: title, fn: function () { read(id, title); } }]) : '') +
      '<h3 style="color:var(--accent);font-size:1rem">' + esc(title) + '</h3>' +
      '<p class="sub" style="margin:10px 0;line-height:1.8">当前内置阅读器支持 <b>TXT / MD</b>（纯文本）格式。<br>' +
      '这本是 <b>' + esc(fmt) + '</b>，暂不支持在线渲染。<br>你可以：① 在电脑上转成 TXT 再导入；② 用「导出」把书导出后，用其它阅读应用打开。</p>' +
      '<div class="ops" style="flex-wrap:wrap;gap:8px">' +
        '<button onclick="yzBooks.openExternal(\'' + esc(id) + '\')">📤 用其他应用打开</button>' +
        '<button onclick="yzBooks.remove(\'' + esc(id) + '\')">🗑 从本机删除</button></div>');
  }

  /* 章节标题识别：第一章 / 一、 / 1. / 序言 / 前言 / 引言 / 结语 / 后记 / 附录 / 尾声
     —— 只认「短行」，避免把正文里出现「第一章」的句子误当标题。 */
  var CH_RE = /^(?:第\s*[〇零一二三四五六七八九十百千0-9]+\s*[章节篇部卷讲]|[〇零一二三四五六七八九十]{1,3}\s*[、.．]|[0-9]{1,3}\s*[、.．)）]|序\s*[言章]|前\s*言|引\s*言|导\s*言|结\s*语|后\s*记|附\s*录|尾\s*声)/;
  function splitChapters(paras) {
    var chs = [], i;
    for (i = 0; i < paras.length; i++) {
      var t = String(paras[i]).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (!t || t.length > 34) continue;
      if (CH_RE.test(t)) chs.push({ pi: i, title: t.slice(0, 30) });
    }
    return chs;
  }

  function renderReader(title, text, id) {
    if (typeof openContent !== 'function') return;
    var paras = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/).map(function (s) { return s.replace(/[ \t]+$/g, ''); }).filter(function (s) { return s.trim().length > 0; });
    if (!paras.length) paras = ['（空文件）'];
    var fs = parseInt(localStorage.getItem('readerFS') || '17', 10) || 17;
    var chs = splitChapters(paras), chAt = {}, ci;
    for (ci = 0; ci < chs.length; ci++) chAt[chs[ci].pi] = ci;
    var body = paras.map(function (p, i) {
      var inner = (chAt[i] != null)
        ? '<h3 class="rch" id="yzch-' + chAt[i] + '" data-ch="' + chAt[i] + '">' + esc(p).replace(/\n/g, '<br>') + '</h3>'
        : '<p data-i="' + i + '">' + esc(p).replace(/\n/g, '<br>') + '</p>';
      return inner;
    }).join('');
    openContent('📖 ' + title,
      (typeof crumbFrom === 'function' ? crumbFrom([{ t: '我的书', fn: openLocalShelf }, { t: title, fn: function () { read(id, title); } }]) : '') +
      '<div id="yzReader" data-book="' + esc(id) + '">' +
        '<div class="reader-bar">' +
          '<button onclick="yzBooks.setFS(-1)" aria-label="缩小字号">A−</button>' +
          '<span class="rfs">' + fs + '</span>' +
          '<button onclick="yzBooks.setFS(1)" aria-label="放大字号">A＋</button>' +
          (chs.length ? '<button onclick="yzBooks.toc()" aria-label="目录">📑 目录</button>' : '') +
          '<span style="flex:1"></span>' +
          '<span class="rpos" style="opacity:.6;font-size:.72rem;margin-right:6px"></span>' +
          '<span style="opacity:.6;font-size:.74rem">共 ' + paras.length + ' 段' + (chs.length ? ' · ' + chs.length + ' 章' : '') + '</span>' +
        '</div>' +
        '<article class="reader-body" style="font-size:' + fs + 'px">' + body + '</article>' +
      '</div>');
    restorePos(id);
    updatePosLabel();
  }

  /* 进度记忆：记在 #drawer 的滚动位置上 */
  function drawerEl() { return document.getElementById('drawer'); }
  /* ---------- 阅读位置：章节 + 章内比例（旧的纯像素值仍双写，兼容老版本数据） ---------- */
  function chEls() { return document.querySelectorAll('#yzReader .rch'); }
  function curCh() {
    var hs = chEls(); if (!hs.length) return -1;
    var d = drawerEl(); if (!d) return -1;
    var base = d.getBoundingClientRect().top + 60, cur = 0;
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].getBoundingClientRect().top <= base) cur = i; else break;
    }
    return cur;
  }
  function chRatio() {
    /* 当前章节读了多少（0~1）：用下一章顶部 - 本章顶部作分母 */
    var hs = chEls(); var c = curCh();
    if (c < 0) return 0;
    var d = drawerEl(); if (!d) return 0;
    var base = d.getBoundingClientRect().top + 60;
    var y0 = hs[c].getBoundingClientRect().top - base;
    var y1 = (c + 1 < hs.length) ? (hs[c + 1].getBoundingClientRect().top - base) : (d.scrollHeight - d.scrollTop - 60);
    if (y1 <= y0) return 0;
    var r = (-y0) / (y1 - y0);
    return Math.max(0, Math.min(1, r));
  }
  function updatePosLabel() {
    var r = document.getElementById('yzReader'); if (!r) return;
    var s = r.querySelector('.rpos'); if (!s) return;
    var hs = chEls(), c = curCh();
    if (!hs.length) { s.textContent = ''; return; }
    var pct = Math.round(((c + chRatio()) / hs.length) * 100);
    s.textContent = '第 ' + (c + 1) + '/' + hs.length + ' 章 · ' + pct + '%';
  }
  function restorePos(id) {
    setTimeout(function () {
      var d = drawerEl(); if (!d) return;
      var rec = null;
      try { rec = JSON.parse(localStorage.getItem('readerCh-' + id) || 'null'); } catch (e) { rec = null; }
      if (rec && rec.ch >= 0) {
        var hs = chEls(), el = hs[rec.ch];
        if (el) {
          var y = el.getBoundingClientRect().top - d.getBoundingClientRect().top + d.scrollTop - 56;
          try { d.scrollTop = Math.max(0, y); } catch (e) { }
          updatePosLabel();
          return;
        }
      }
      var top = parseInt(localStorage.getItem('readerPos-' + id) || '0', 10) || 0;
      if (top > 0) { try { d.scrollTop = top; } catch (e) { } }
      updatePosLabel();
    }, 60);
  }
  function savePos() {
    var r = document.getElementById('yzReader'); if (!r) return;
    var d = drawerEl(); if (!d) return;
    var id = r.getAttribute('data-book');
    /* 旧键照写（像素），保证老逻辑 / 老数据都能用 */
    try { localStorage.setItem('readerPos-' + id, String(d.scrollTop || 0)); } catch (e) { }
    /* 新键：章节序号 + 章内比例 —— 换字号 / 换设备后仍能定位到同一处 */
    try {
      var c = curCh(), hs = chEls();
      if (hs.length) {
        localStorage.setItem('readerCh-' + id, JSON.stringify({ ch: c, r: Number(chRatio().toFixed(3)), t: Date.now() }));
        /* 顺手把书架上的百分比更新成按章节算的真实进度 */
        try {
          if (window.YZRead && YZRead.setProgress) YZRead.setProgress(id, Math.round(((c + chRatio()) / hs.length) * 100));
        } catch (e2) { }
      }
    } catch (e) { }
    updatePosLabel();
  }
  /* 目录浮层：不替换阅读页（openContent 会把阅读器整个换掉） */
  function toc() {
    var hs = chEls(); if (!hs.length) { try { toast('这本书没识别到章节标题'); } catch (e) { } return; }
    var cur = curCh(), i;
    var old = document.getElementById('yzToc'); if (old) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.id = 'yzToc';
    box.setAttribute('style', 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:210;background:rgba(0,0,0,.5)');
    var list = '';
    for (i = 0; i < hs.length; i++) {
      var t = String(hs[i].textContent || '').slice(0, 40);
      list += '<div data-ch="' + i + '" style="display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 2px;border-bottom:1px solid var(--line);cursor:pointer">' +
        '<span style="flex:1;font-size:.88rem;line-height:1.6;' + (i === cur ? 'color:var(--accent);font-weight:600' : '') + '">' + (i === cur ? '▶ ' : '') + esc(t) + '</span>' +
        '<span style="opacity:.45;font-size:.72rem">' + (i + 1) + '</span></div>';
    }
    box.innerHTML = '<div style="position:absolute;left:0;right:0;bottom:0;top:auto;max-height:78vh;overflow:auto;background:var(--card);border-top:1px solid var(--card-border);border-radius:16px 16px 0 0;padding:14px 16px calc(18px + env(safe-area-inset-bottom, 0px))">' +
      '<div style="display:flex;align-items:center;gap:8px;margin:0 0 8px"><b style="flex:1">📑 目录（' + hs.length + ' 章）</b>' +
      '<button data-close="1" style="background:none;border:0;color:inherit;font-size:1rem;padding:6px 8px">✕</button></div>' + list + '</div>';
    document.body.appendChild(box);
    box.addEventListener('click', function (ev) {
      var tg = ev.target;
      while (tg && tg !== box && !tg.getAttribute('data-ch') && !tg.getAttribute('data-close')) tg = tg.parentNode;
      if (!tg || tg === box) { closeToc(); return; }
      if (tg.getAttribute('data-close')) { closeToc(); return; }
      var k = parseInt(tg.getAttribute('data-ch'), 10);
      closeToc(); jumpCh(k);
    });
  }
  function closeToc() { var e = document.getElementById('yzToc'); if (e && e.parentNode) e.parentNode.removeChild(e); }
  function jumpCh(k) {
    var hs = chEls(), el = hs[k]; if (!el) return;
    var d = drawerEl(); if (!d) return;
    var y = el.getBoundingClientRect().top - d.getBoundingClientRect().top + d.scrollTop - 56;
    try { d.scrollTop = Math.max(0, y); } catch (e) { }
    savePos();
  }
  function setFS(delta) {
    var fs = parseInt(localStorage.getItem('readerFS') || '17', 10) || 17;
    fs = Math.max(12, Math.min(30, fs + delta));
    try { localStorage.setItem('readerFS', String(fs)); } catch (e) { }
    var r = document.getElementById('yzReader');
    if (!r) return;
    var b = r.querySelector('.reader-body'); if (b) b.style.fontSize = fs + 'px';
    var s = r.querySelector('.rfs'); if (s) s.textContent = String(fs);
  }

  function remove(id) {
    if (!window.confirm('从本机删除这本书？')) return;
    dbDel(id, function () {
      metaSave(metaAll().filter(function (m) { return m.id !== id; }));
      if (typeof RES !== 'undefined' && RES) {
        for (var i = RES.length - 1; i >= 0; i--) {
          var r = RES[i];
          if (r.id === 'local-' + id) { RES.splice(i, 1); continue; }
          /* 挂在本机文件上的“书壳”要恢复成“暂无原文” */
          if (r.bookId === id) {
            delete r.local; delete r.bookId; delete r.hasLocal;
            if (r._src0) { r.src = r._src0; delete r._src0; }
          }
        }
      }
      try { localStorage.removeItem('readerPos-' + id); } catch (e) { }
      try { toast('已删除'); } catch (e) { }
      try { if (typeof render === 'function') render(); } catch (e) { }
      openLocalShelf();
    });
  }

  /* 用其他应用打开：IndexedDB 内容 -> base64 -> App 桥 openFile → 系统选择器 */
  function openExternal(id) {
    dbGet(id, function (blob) {
      if (!blob) { try { toast('找不到这本书的内容（可能已被清理）'); } catch (e) { } return; }
      var m = metaAll().filter(function (x) { return x.id === id; })[0] || {};
      var name = m.title || ('book.' + String(m.fmt || 'bin').toLowerCase());
      var mime = blob.type || 'application/octet-stream';
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || ''), c = s.indexOf(',');
        var b64 = c >= 0 ? s.slice(c + 1) : s;
        if (window.AndroidApp && typeof AndroidApp.openFile === 'function') {
          try { AndroidApp.openFile(name, b64, mime); } catch (e) { try { toast('打开失败'); } catch (x) { } }
        } else {
          try { toast('当前环境不支持“用其他应用打开”（仅 App 内可用）'); } catch (e) { }
        }
      };
      fr.onerror = function () { try { toast('读取失败'); } catch (e) { } };
      fr.readAsDataURL(blob);
    });
  }

  /* 阅读时把「我的书」入口也挂到详情页按钮上（供 openItemDetail 调用） */
  window.yzBooks = { load: loadAll, pick: pick, read: read, remove: remove, setFS: setFS, savePos: savePos, openShelf: openLocalShelf, openExternal: openExternal, importInto: importInto, findShell: findShell, findShellInfo: findShellInfo, decideShell: decideShell, simScore: simScore, meta: metaAll,
    toc: toc, closeToc: closeToc, jumpCh: jumpCh, splitChapters: splitChapters, curCh: curCh };
  /* 滚动时保存进度（节流） */
  var _t = 0;
  window.addEventListener('scroll', function () { if (!document.getElementById('yzReader')) return; var n = Date.now(); if (n - _t < 1200) return; _t = n; savePos(); }, true);
  try { loadAll(); } catch (e) { }
})();
