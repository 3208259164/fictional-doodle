/* =====================================================================
   学通 · 我的资料（mine.js）
   ---------------------------------------------------------------------
   把散在各处的「我的东西」收进一页，五个页签：书架 / 收藏 / 书签 / 摘录 / 标注。
   为什么要合并：这些功能都挂在「同一个条目」上，分散成四五个入口时，
   用户既记不住哪个东西存在哪，也看不出自己到底积累了多少。

   数据来源（全部只读，不复制、不搬家）：
     yzRead(书架) · favs(收藏) · marks(书签) · yzExcerpts(摘录) · yzy_ov_v1.meta(标注)
   ===================================================================== */
(function () {
  'use strict';

  function RES() { return window.SITE_RESOURCES || []; }
  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function favSet() { try { return new Set(ls('favs', [])); } catch (e) { return new Set(); } }
  function marks() { return ls('marks', []) || []; }
  function readMap() { return ls('yzRead', {}) || {}; }
  function metaAll() { try { return (window.YZY && YZY.allMeta) ? YZY.allMeta() : {}; } catch (e) { return {}; } }
  function exAll() { try { return (window.YZRead && YZRead.excerpts) ? YZRead.excerpts() : []; } catch (e) { return []; } }

  function counts() {
    var rm = readMap();
    return {
      shelf: Object.keys(rm).length,
      favs: favSet().size,
      marks: marks().length,
      ex: exAll().length,
      meta: Object.keys(metaAll()).length
    };
  }

  function row(title, sub, onclick) {
    return '<div class="frow"' + (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
      '<span class="fava"><span class="fico">📕</span></span>' +
      '<span class="fmeta"><span class="fnm">' + esc(title) + '</span>' +
      '<span class="fsub">' + esc(sub || '') + '</span></span>' +
      '<span class="fmor">›</span></div>';
  }
  function emptyBox(text) {
    return '<p class="sub" style="line-height:1.9;font-size:.82rem;opacity:.75">' + text + '</p>';
  }

  function tabShelf() {
    var rm = readMap();
    var ST = [{ k: 'reading', n: '📖 在读', i: '📖' }, { k: 'want', n: '📌 想读', i: '📌' }, { k: 'done', n: '✅ 读完', i: '✅' }];
    var html = '';
    ST.forEach(function (st) {
      var list = RES().filter(function (b) { return rm[b.id] && rm[b.id].st === st.k; });
      if (!list.length) return;
      html += '<h2 class="sub-title">' + st.n + '（' + list.length + '）</h2>' +
        list.map(function (b) {
          var p = rm[b.id].p ? ' · ' + rm[b.id].p + '%' : '';
          return row(b.title, (b.author || '') + ' · ' + (b.cat || '') + p, 'openItemDetail(' + RES().indexOf(b) + ')');
        }).join('');
    });
    return html || emptyBox('书架还空着。打开任意一本书，在「阅读状态」里点「想读 / 在读 / 读完」就会出现在这里。');
  }

  function tabFavs() {
    var f = favSet(), list = RES().filter(function (r) { return f.has(r.id); });
    if (!list.length) return emptyBox('还没有收藏。在资源卡片上点「☆」即可加入。');
    return list.map(function (r) { return row(r.title, (r.author || '') + ' · ' + (r.cat || ''), 'openItemDetail(' + RES().indexOf(r) + ')'); }).join('');
  }

  function tabMarks() {
    var m = marks();
    if (!m.length) return emptyBox('还没有书签。在条目上点「🔖」加入，方便下次回来接着看。');
    var list = m.map(function (id) { return RES().findIndex(function (r) { return (r.id || r.title) === id; }); }).filter(function (i) { return i >= 0; });
    return list.map(function (i) { var r = RES()[i]; return row(r.title, (r.author || '') + ' · ' + (r.cat || ''), 'openItemDetail(' + i + ')'); }).join('');
  }

  function tabExcerpts() {
    var a = exAll();
    if (!a.length) return emptyBox('还没有摘录。打开一本书，在「我的摘录」里可以存原文和自己的想法。');
    return a.slice(0, 200).map(function (x) {
      var b = RES().find(function (r) { return r.id === x.b; });
      var i = b ? RES().indexOf(b) : -1;
      return '<div style="border-bottom:1px solid var(--card-border);padding:9px 0"' + (i >= 0 ? ' onclick="openItemDetail(' + i + ')"' : '') + '>' +
        '<div style="font-size:.84rem;line-height:1.85">' + esc(x.txt) + '</div>' +
        (x.note ? '<div style="font-size:.76rem;opacity:.62;margin-top:3px">💭 ' + esc(x.note) + '</div>' : '') +
        '<div style="font-size:.7rem;opacity:.5;margin-top:4px">' + (b ? esc(b.title) : '未关联书目') + '</div></div>';
    }).join('') + (a.length > 200 ? '<p class="sub" style="font-size:.74rem;opacity:.6">只显示最近 200 条（共 ' + a.length + ' 条）。</p>' : '');
  }

  function tabMeta() {
    var all = metaAll(), keys = Object.keys(all);
    if (!keys.length) return emptyBox('还没有标注。在任意书 / 人物 / 概念 / 事件的详情页底部，可以加「评分 / 阅读状态 / 摘抄页码」这类自定义字段。');
    return keys.map(function (k) {
      var p = k.split(':');
      var name = (typeof yzNameOf === 'function') ? yzNameOf(p[0], p[1]) : p[1];
      var fn = (typeof yzOpenRef === 'function') ? yzOpenRef(p[0], p[1]) : '';
      var body = (all[k] || []).map(function (f) { return esc(f.k) + '：' + esc(f.v); }).join(' · ');
      return row(name, body, fn);
    }).join('');
  }

  var TABS = [
    { id: 'shelf', n: '📚 书架', f: tabShelf },
    { id: 'favs', n: '⭐ 收藏', f: tabFavs },
    { id: 'marks', n: '🔖 书签', f: tabMarks },
    { id: 'ex', n: '✍️ 摘录', f: tabExcerpts },
    { id: 'meta', n: '🏷 标注', f: tabMeta }
  ];

  /* ---------------- 导出（Markdown / CSV）与本机存储用量 ----------------
     实现在 assets/exportdata.js（window.YZEXPORT），这里只负责按钮与提示。
     下载通道在 exportdata.js 里已做「AndroidApp 桥优先 → 浏览器 Blob 兜底」。 */
  function say(m) {
    try { if (typeof window.toast === 'function') { window.toast(m); return; } } catch (e) {}
    try { console.log('[学通·我的资料] ' + m); } catch (e) {}
  }
  function doExport(kind) {
    var X = window.YZEXPORT;
    if (!X) { say('导出模块未加载：请确认 assets/exportdata.js 已被 index.html 引入'); return false; }
    try {
      if (kind === 'usage') {
        if (X.openUsage) { X.openUsage(); return true; }
        say('用量面板不可用'); return false;
      }
      return !!X.save(kind === 'csv' ? 'csv' : 'md');
    } catch (e) { say('导出失败：' + (e && e.message ? e.message : '未知错误')); return false; }
  }
  function actionsHTML() {
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px">' +
      '<button class="sbtn" data-yzx="md">📝 导出笔记（Markdown）</button>' +
      '<button class="sbtn" data-yzx="csv">📄 导出表格（CSV）</button>' +
      '<button class="sbtn" data-yzx="usage">📊 存储用量</button></div>';
  }

  function openMine(tab) {
    var c = counts();
    var cur = tab || 'shelf';
    var tabsHTML = TABS.map(function (t) {
      var on = t.id === cur;
      var n = (t.id === 'shelf' ? c.shelf : t.id === 'favs' ? c.favs : t.id === 'marks' ? c.marks : t.id === 'ex' ? c.ex : c.meta);
      return '<button class="sbtn" data-mt="' + t.id + '"' + (on ? ' style="border-color:var(--accent);color:var(--accent)"' : '') + '>' +
        t.n + (n ? ' ' + n : '') + '</button>';
    }).join('');
    var body = (TABS.find(function (t) { return t.id === cur; }) || TABS[0]).f();
    var html = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px">' + tabsHTML + '</div>' +
      '<p class="sub" style="font-size:.74rem;opacity:.6;line-height:1.7;margin:0 0 8px">五类都在本机，互不重复：书架管「读到哪」，收藏是「想留着」，书签是「下次接着看」，摘录存「原话」，标注记「我的字段」。随「导出我的数据」一起走。</p>' +
      actionsHTML() +
      body;
    try {
      if (typeof openContent === 'function') { openContent('📚 我的资料', html); return true; }
    } catch (e) {}
    return false;
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== document) {
      if (t.getAttribute && t.getAttribute('data-mt')) { openMine(t.getAttribute('data-mt')); return; }
      if (t.getAttribute && t.getAttribute('data-yzx')) {
        var kind = t.getAttribute('data-yzx');
        if (kind !== 'usage') ev.preventDefault();
        doExport(kind);
        return;
      }
      t = t.parentNode;
    }
  }, true);

  window.YZMine = { open: openMine, counts: counts, exportData: doExport };
  window.openMine = openMine;
})();
