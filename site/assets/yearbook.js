/* =====================================================================
   学通 · 年鉴（yearbook.js）—— 按「年」看这一年发生了什么
   ---------------------------------------------------------------------
   为什么做这个而不做日历：
     站内的「月日」颗粒度只有 39%（366 天里 144 天有内容），做日历六成是空格；
     但「年份」是满的 —— 史料事件、三个图谱的人物生卒/组织成立/思潮标志年、
     126 种原著首版年，加起来 161 个年份、930 条记录，全都有年。
     所以做「这一年」，不做「这一天」。

   数据口径（重要）：
     · 事件：SITE_EXTRA.events（102 条）+ 三个图谱里的 event 节点
     · 出生/逝世：一律从人物的 years 字符串（"1893—1976"）解析，**不用图谱的 y0/y1**
       —— 文革图谱的 y0/y1 是「文革期间的活动年份」，当生年用会得出「1966 年出生 30 人」的错数据
     · 著作：书库的 firstYear（首次发表年，126 条）
     · 组织/思潮：图谱节点的 years 里第一个年份
   去重：同一人在主图谱、文革图谱、世界图谱里都有，按名字去重。

   入口：史料 → 重大事件 页顶部的「📅 按年份看」；也可直接 YZ_YEAR.open(1966)
   ===================================================================== */
(function () {
  'use strict';

  var CACHE = null;

  function S(v) { return v == null ? '' : String(v); }
  function esc(s) {
    return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nums(str) {
    var m = S(str).match(/(1[5-9]\d\d|20[0-2]\d)/g);
    return m ? m.map(Number) : null;
  }
  function okYear(y) { return typeof y === 'number' && y >= 1000 && y <= 2030; }

  function build() {
    /* 文革图谱是 400ms 后动态加载的（app.js 的 loadWengeGraph）。
       若在它加载前就建好缓存，年鉴会永久缺掉 202 个文革节点 —— 所以缓存要记「当时有没有文革数据」，
       两次不一致就重算。 */
    var hasW = !!(window.SITE_GRAPH_WENGE && window.SITE_GRAPH_WENGE.nodes && window.SITE_GRAPH_WENGE.nodes.length);
    if (CACHE && CACHE.hasW === hasW) return CACHE;
    var map = {}, seen = {};
    function put(y, kind, item) {
      if (!okYear(y)) return;
      var key = kind + '|' + (item.name || item.title || '');
      if (seen[key]) return;
      seen[key] = 1;
      (map[y] = map[y] || { ev: [], born: [], died: [], work: [], org: [], idea: [] })[kind].push(item);
    }

    /* ① 史料事件 */
    ((window.SITE_EXTRA && window.SITE_EXTRA.events) || []).forEach(function (e, i) {
      var n = nums(e.year);
      if (!n) return;
      put(n[0], 'ev', { name: e.name, year: S(e.year), desc: S(e.desc), idx: i, src: 'event' });
    });

    /* ② 三个图谱：人物生卒 / 组织 / 思潮 / 事件节点 */
    var GS = [
      { g: window.SITE_GRAPH, tag: 'main' },
      { g: window.SITE_GRAPH_WENGE, tag: 'wenge' },
      { g: window.SITE_GRAPH_WORLD, tag: 'world' }
    ];
    GS.forEach(function (box) {
      var nodes = (box.g && box.g.nodes) || [];
      nodes.forEach(function (nd) {
        if (!nd || !nd.name) return;
        if (nd.type === 'person') {
          var n = nums(nd.years);
          if (n && n.length >= 2) { put(n[0], 'born', { name: nd.name, roles: S(nd.role), id: nd.id }); put(n[1], 'died', { name: nd.name, roles: S(nd.role), id: nd.id }); }
          else if (n && n.length === 1) put(n[0], 'born', { name: nd.name, roles: S(nd.role), id: nd.id });
        } else if (nd.type === 'org') {
          /* 组织的 years 有的写「1966—1969」，有的只有 y0/y1 数字字段，两种都认 */
          var o = nums(nd.years) || (typeof nd.y0 === 'number' ? [nd.y0] : null);
          if (o) put(o[0], 'org', { name: nd.name, roles: S(nd.years), id: nd.id, tag: box.tag });
        } else if (nd.type === 'idea') {
          var i2 = nums(nd.years) || (typeof nd.y0 === 'number' ? [nd.y0] : null);
          if (i2) put(i2[0], 'idea', { name: nd.name, roles: S(nd.basis || nd.years), id: nd.id, tag: box.tag });
        } else if (nd.type === 'event') {
          var e2 = nums(nd.years) || (typeof nd.y0 === 'number' ? [nd.y0] : null);
          if (e2) put(e2[0], 'ev', { name: nd.name, year: S(nd.years), desc: S(nd.desc), id: nd.id, tag: box.tag, src: 'graph' });
        }
      });
    });

    /* ③ 原著首版年 */
    (window.SITE_RESOURCES || []).forEach(function (r) {
      if (!r.firstYear) return;
      put(r.firstYear, 'work', { title: r.title, author: S(r.author), note: S(r.firstYearNote), id: r.id });
    });

    var years = Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
    CACHE = { map: map, years: years, hasW: hasW };
    return CACHE;
  }

  function total(y) {
    var o = build().map[y]; if (!o) return 0;
    return o.ev.length + o.born.length + o.died.length + o.work.length + o.org.length + o.idea.length;
  }

  /* ---------- 交互 ---------- */
  function goEvent(it) {
    try {
      if (it.src === 'event' && typeof window.openEvent === 'function') return window.openEvent(it.idx);
      if (it.tag === 'wenge' && typeof window.openWengeNode === 'function') return window.openWengeNode(it.id);
      if (it.tag === 'wenge') { location.href = 'graph.html?g=wenge#' + it.id; return; }
      if (it.id) { location.href = 'graph.html#' + it.id; return; }
      if (typeof window.openSearch === 'function') return window.openSearch(it.name);
    } catch (e) {}
    if (window.toast) toast('没有对应页面');
  }
  function goPerson(it) {
    try { if (typeof window.openAuthor === 'function') return window.openAuthor(it.name); } catch (e) {}
  }
  function goWork(it) {
    try { if (typeof window.openBook === 'function') return window.openBook(it.title); } catch (e) {}
  }
  function goNode(it) {
    try {
      if (it.tag === 'wenge' && typeof window.openWengeNode === 'function') return window.openWengeNode(it.id);
      location.href = (it.tag === 'wenge' ? 'graph.html?g=wenge#' : 'graph.html#') + it.id;
    } catch (e) {}
  }

  /* 挂到全局，供内联 onclick 调用 */
  window.yzYearEvent = function (y, i) { var o = build().map[y]; if (o) goEvent(o.ev[i]); };
  window.yzYearPerson = function (y, k, i) { var o = build().map[y]; if (o) goPerson(o[k][i]); };
  window.yzYearWork = function (y, i) { var o = build().map[y]; if (o) goWork(o.work[i]); };
  window.yzYearNode = function (y, k, i) { var o = build().map[y]; if (o) goNode(o[k][i]); };

  function chip(y) {
    var c = total(y);
    var size = c >= 30 ? '1rem' : (c >= 10 ? '.92rem' : '.84rem');
    return '<span class="tag" style="font-size:' + size + ';cursor:pointer" onclick="YZ_YEAR.open(' + y + ')">' +
      y + '<span style="opacity:.55;font-size:.78em"> · ' + c + '</span></span>';
  }

  function index() {
    var B = build();
    if (!B.years.length) { if (window.toast) toast('年鉴数据没加载'); return; }
    var dec = {};
    B.years.forEach(function (y) { var d = Math.floor(y / 10) * 10; (dec[d] = dec[d] || []).push(y); });
    var body = '<p class="sub" style="margin:0 0 10px;line-height:1.85">按年份看：某一年出生了谁、逝世了谁、出版了哪些原著、成立了什么组织、发生了什么事件。' +
      '共 <b>' + B.years.length + '</b> 个有记录的年份，起 ' + B.years[0] + ' 至 ' + B.years[B.years.length - 1] + '。' +
      '（只按年汇总——站内的月日记录还不够密，做日历会有大半是空的，所以没有做。）</p>';
    var keys = Object.keys(dec).map(Number).sort(function (a, b) { return a - b; });
    body += keys.map(function (d) {
      return '<h2 class="sub-title" style="margin-top:14px">' + d + ' 年代<span style="font-weight:400;opacity:.5;font-size:.8em"> · ' + dec[d].length + ' 年有记录</span></h2>' +
        '<div class="tagrow">' + dec[d].map(chip).join('') + '</div>';
    }).join('');
    if (window.openContent) window.openContent('📅 年鉴 · 按年份看', body);
  }

  function block(title, html) {
    return html ? '<h2 class="sub-title" style="margin-top:16px">' + title + '</h2>' + html : '';
  }
  function li(text, onclick) {
    return '<li style="padding-left:16px;position:relative;line-height:1.9"><span style="position:absolute;left:0;opacity:.5">▸</span>' +
      (onclick ? '<button class="aslink" style="text-align:left;font-size:.85rem" onclick="' + onclick + '">' + text + '</button>' : text) + '</li>';
  }

  function open(y) {
    y = +y;
    var B = build(), o = B.map[y];
    if (!o) { if (window.toast) toast(y + ' 年本站暂无记录'); index(); return; }
    var i = B.years.indexOf(y);
    var prev = i > 0 ? B.years[i - 1] : null;
    var next = i >= 0 && i < B.years.length - 1 ? B.years[i + 1] : null;

    var nav = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px">' +
      '<button class="lk-btn" style="font-size:.78rem" onclick="YZ_YEAR.index()">📅 全部年份</button>' +
      (prev ? '<button style="font-size:.78rem;padding:5px 10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit" onclick="YZ_YEAR.open(' + prev + ')">‹ ' + prev + '</button>' : '') +
      (next ? '<button style="font-size:.78rem;padding:5px 10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit" onclick="YZ_YEAR.open(' + next + ')">' + next + ' ›</button>' : '') +
      '</div>';

    var body = nav + '<p class="sub" style="margin:0 0 6px">这一年共 <b>' + total(y) + '</b> 条记录。</p>';

    body += block('📅 事件 · ' + o.ev.length,
      o.ev.length ? '<ul style="list-style:none;padding:0;margin:0">' + o.ev.map(function (x, k) {
        return li('<b>' + esc(x.name) + '</b>' + (x.desc ? '<span style="opacity:.72;font-size:.9em"> — ' + esc(x.desc.slice(0, 70)) + (x.desc.length > 70 ? '…' : '') + '</span>' : ''), 'yzYearEvent(' + y + ',' + k + ')');
      }).join('') + '</ul>' : '');

    body += block('👶 出生 · ' + o.born.length,
      o.born.length ? '<div class="tagrow">' + o.born.map(function (x, k) {
        return '<span class="tag" style="cursor:pointer" onclick="yzYearPerson(' + y + ',\'born\',' + k + ')">' + esc(x.name) + (x.roles ? '<span style="opacity:.5;font-size:.85em"> · ' + esc(x.roles.slice(0, 14)) + '</span>' : '') + '</span>';
      }).join('') + '</div>' : '');

    body += block('🕯 逝世 · ' + o.died.length,
      o.died.length ? '<div class="tagrow">' + o.died.map(function (x, k) {
        return '<span class="tag" style="cursor:pointer" onclick="yzYearPerson(' + y + ',\'died\',' + k + ')">' + esc(x.name) + '</span>';
      }).join('') + '</div>' : '');

    body += block('📚 原著首版 · ' + o.work.length,
      o.work.length ? '<ul style="list-style:none;padding:0;margin:0">' + o.work.map(function (x, k) {
        return li('<b>《' + esc(x.title) + '》</b> <span style="opacity:.7;font-size:.9em">' + esc(x.author) + '</span>' +
          (x.note ? '<div style="font-size:.76rem;opacity:.6;line-height:1.7">' + esc(x.note) + '</div>' : ''), 'yzYearWork(' + y + ',' + k + ')');
      }).join('') + '</ul>' : '');

    body += block('🏛️ 组织 · ' + o.org.length,
      o.org.length ? '<div class="tagrow">' + o.org.map(function (x, k) {
        return '<span class="tag" style="cursor:pointer" onclick="yzYearNode(' + y + ',\'org\',' + k + ')">' + esc(x.name) + '</span>';
      }).join('') + '</div>' : '');

    body += block('💡 思潮 · ' + o.idea.length,
      o.idea.length ? '<div class="tagrow">' + o.idea.map(function (x, k) {
        return '<span class="tag" style="cursor:pointer" onclick="yzYearNode(' + y + ',\'idea\',' + k + ')">' + esc(x.name) + '</span>';
      }).join('') + '</div>' : '');

    if (window.openContent) window.openContent('📅 ' + y + ' 年', body);
  }

  window.YZ_YEAR = {
    build: build, index: index, open: open, total: total,
    years: function () { return build().years.slice(); }
  };
})();
