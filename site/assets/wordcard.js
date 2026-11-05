/* =====================================================================
   学通 · 词条卡片（wordcard.js，0.18.27）
   ---------------------------------------------------------------------
   由来：阅读器里选中「马克思」会弹出人物注解卡片（看完整条目 / 存为摘录），
   但摘录、笔记里出现同一批名字时是死文字，点不动。
   这一版把「名字 → 卡片」抽成通用能力：
     YZWordCard.linkify(text)   把文本里的人名包成 <span data-w>
     YZWordCard.bind(el)        在容器上做一次事件委托（点名字弹卡片）
     YZWordCard.open(name)      直接弹某个人物的卡片
   名字来源：图谱人物 + 作者别名表；长的优先匹配（「罗莎·卢森堡」先于「卢森堡」）。
   ===================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var _names = null;
  function names() {
    if (_names) return _names;
    var set = {};
    try {
      var G = (window.allGraphNodes ? allGraphNodes() : []) || [];
      for (var i = 0; i < G.length; i++) {
        var n = G[i];
        if (!n || n.type !== 'person' || !n.name) continue;
        var nm = String(n.name);
        if (nm.length >= 2) set[nm] = 1;
        /* 「卡尔·马克思」→ 也收「马克思」：正文里多数只写姓 */
        var seg = nm.split(/[·・．.\-—]/);
        if (seg.length > 1) {
          var last = seg[seg.length - 1];
          if (last && last.length >= 2 && !/^[A-Za-z]+$/.test(last)) set[last] = 1;
        }
      }
    } catch (e) { }
    try {
      var A = window.YZ_AUTHOR_ALIAS || {};
      Object.keys(A).forEach(function (k) { if (k && k.length >= 2) set[k] = 1; });
    } catch (e) { }
    var arr = Object.keys(set);
    arr.sort(function (a, b) { return b.length - a.length; });
    /* 空表不缓存：图谱是懒加载的，第一次调用时可能还没到，缓存空表会永远认不出人名 */
    if (arr.length >= 5) _names = arr;
    return arr;
  }

  function re() {
    var ns = names();
    if (!ns.length) return null;
    return new RegExp('(' + ns.map(reEsc).join('|') + ')', 'g');
  }

  /* 文本 → 带可点名字的 HTML。raw 必须是纯文本（不是 HTML） */
  function linkify(raw) {
    var s = esc(raw);
    var r = re();
    if (!r) return s;
    return s.replace(r, function (m) {
      return '<span class="yz-word" data-w="' + m + '" onclick="event.stopPropagation();YZWordCard.open(this.getAttribute(\'data-w\'))"' +
        ' style="color:var(--accent);border-bottom:1px dashed currentColor;cursor:pointer">' + m + '</span>';
    });
  }

  var bound = [];
  function bind(el) {
    if (!el || el.__yzWordBound) return;
    el.__yzWordBound = true;
    el.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== el && !(t.getAttribute && t.getAttribute('data-w'))) t = t.parentNode;
      if (!t || t === el) return;
      var name = t.getAttribute('data-w');
      if (!name) return;
      e.stopPropagation();
      open(name);
    });
  }

  function findPerson(name) {
    var n = String(name || '').trim();
    if (!n) return null;
    try {
      var G = (window.allGraphNodes ? allGraphNodes() : []) || [];
      for (var i = 0; i < G.length; i++) {
        if (G[i] && G[i].type === 'person' && G[i].name === n) return G[i];
      }
      /* 「马克思」→「卡尔·马克思」：按后缀匹配（只认人名的最后一段，避免误配） */
      for (var i2 = 0; i2 < G.length; i2++) {
        var g2 = G[i2];
        if (!g2 || g2.type !== 'person' || !g2.name) continue;
        var segs = String(g2.name).split(/[·・．.\-—]/);
        if (segs.length > 1 && segs[segs.length - 1] === n) return g2;
      }
      /* 别名 → 全名（卢森堡 → 罗莎·卢森堡） */
      var A = window.YZ_AUTHOR_ALIAS || {};
      var al = A[n];
      var list = al ? (Array.isArray(al) ? al : [al]) : [];
      for (var j = 0; j < list.length; j++) {
        for (var k = 0; k < G.length; k++) {
          if (G[k] && G[k].type === 'person' && G[k].name === list[j]) return G[k];
        }
      }
    } catch (e) { }
    return null;
  }

  var cur = null;
  function close() {
    if (cur) { try { cur.remove(); } catch (e) { } cur = null; }
  }

  function open(name) {
    close();
    var p = findPerson(name);
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;top:0;z-index:100065;background:rgba(0,0,0,.5);' +
      'display:flex;align-items:flex-end;justify-content:center';
    var brief = p ? String(p.desc || p.role || '').slice(0, 160) : '';
    var meta = p ? [p.years, p.role].filter(Boolean).join(' · ') : '';
    d.innerHTML = '<div style="width:100%;max-width:540px;background:var(--card,#1b1815);border-radius:16px 16px 0 0;' +
      'padding:16px 16px 20px;color:inherit;text-align:left">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
      '<span style="font-size:.68rem;padding:2px 8px;border-radius:6px;background:rgba(201,162,39,.22);color:var(--accent,#c9a227)">' +
      (p ? '人物' : '词条') + '</span>' +
      '<b style="flex:1;font-size:1rem">' + esc(p ? p.name : name) + '</b>' +
      '<button data-a="close" style="border:none;background:none;color:inherit;font-size:1.2rem;padding:2px 6px">×</button></div>' +
      (meta ? '<div style="font-size:.76rem;opacity:.7;margin-top:6px;line-height:1.6">' + esc(meta) + '</div>' : '') +
      '<div style="font-size:.86rem;line-height:1.85;margin-top:10px;opacity:.92">' +
      (brief ? esc(brief) + (String(p.desc || '').length > 160 ? '…' : '') : '这条还没有介绍。') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      (p ? '<button data-a="full" style="flex:1;padding:11px;border-radius:11px;border:none;background:var(--accent,#c9a227);color:#1a1613;font-weight:600;font-size:.88rem">看完整条目</button>' : '') +
      '<button data-a="close" style="flex:1;padding:11px;border-radius:11px;border:1px solid rgba(255,255,255,.22);background:transparent;color:inherit;font-size:.88rem">关闭</button>' +
      '</div></div>';
    document.body.appendChild(d);
    cur = d;
    d.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (e.target === d) return close();
      if (a === 'close') return close();
      if (a === 'full') {
        close();
        if (p && p.id) {
          if (window.YZData && YZData.state && YZData.state()['data/graph-wenge.js'] !== 'ok') { /* 图谱按需加载由 openFigure 自己处理 */ }
          try { openFigure(p.id); } catch (err) { }
        }
      }
    });
  }

  window.YZWordCard = { linkify: linkify, bind: bind, open: open, close: close, names: names, _reset: function () { _names = null; } };
})();
