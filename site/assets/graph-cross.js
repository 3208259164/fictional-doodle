/* =====================================================================
   学通 · 图谱页节点面板：显示「这个节点在其他图谱里的关系」
   ---------------------------------------------------------------------
   为什么单独一个文件：
     图谱页的内联脚本很长（12 万字符），直接往里插函数容易把整块脚本搞坏
     （实测过一次：插完 acorn 直接报 Unexpected token，图谱页整页失效）。
     所以这里用外挂方式：不改内联脚本，只在面板打开时把一段 HTML 插到关系网区后面。

   数据来源：graph.html 已经加载了 main / old / new / wenge / world 五份图谱，
   同一个人的 id 在各图里是一致的，所以可以直接按 id 聚合。
   ===================================================================== */
(function () {
  'use strict';

  var BOX_ID = 'yzCrossGraph';

  function esc(x) {
    return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function sources() {
    return [
      ['main', '主图谱', window.SITE_GRAPH],
      ['old', '旧民图谱', window.SITE_GRAPH_OLD],
      ['new', '新民图谱', window.SITE_GRAPH_NEW],
      ['wenge', '文革图谱', window.SITE_GRAPH_WENGE],
      ['world', '世界图谱', window.SITE_GRAPH_WORLD]
    ];
  }

  /* 当前打开的是哪一张：优先问 YZY 的当前图谱 id；
     拿不到再退回「与 GR 是同一个对象」的判断（GR 常常是复制出来的对象，比引用不可靠）。 */
  function currentId() {
    try { if (window.YZY && typeof YZY.activeGraphId === 'function') return YZY.activeGraphId() || ''; } catch (e) {}
    return '';
  }

  /* 当前打开的是哪张图：优先用 GR（页面自己的全局），拿不到就按节点数比对 */
  function current() {
    try { if (window.GR && window.GR.nodes) return window.GR; } catch (e) {}
    return null;
  }

  function crossGraphHTML(id) {
    if (!id) return '';
    var cur = current();
    var nameOf = {};
    try {
      (cur ? cur.nodes : []).forEach(function (n) { if (n && n.id) nameOf[n.id] = n.name || n.id; });
    } catch (e) {}

    var groups = [], total = 0, cid = currentId();
    sources().forEach(function (s) {
      var gid = s[0], label = s[1], g = s[2];
      if (!g || !g.nodes || !g.links) return;
      /* 当前这张图的关系，面板上面已经列了 —— 不要再列一遍 */
      if ((cid && gid === cid) || (!cid && g === cur)) return;
      var rows = [], seen = {};
      g.links.forEach(function (l) {
        if (!l) return;
        var out = (l.source === id);
        var other = out ? l.target : (l.target === id ? l.source : null);
        if (!other) return;
        var k = other + '|' + (l.rel || '');
        if (seen[k]) return;
        seen[k] = 1;
        if (!nameOf[other]) {
          (g.nodes || []).forEach(function (n) { if (n && n.id === other && n.name) nameOf[other] = n.name; });
        }
        rows.push({ other: other, rel: l.rel || '相关', out: out });
      });
      if (!rows.length) return;
      total += rows.length;
      groups.push({ label: label, rows: rows });
    });

    if (!groups.length) return '';

    var h = '<div id="' + BOX_ID + '" style="margin:14px 0 0">' +
      '<div class="sub2">🕸 其他图谱里的关系 · ' + groups.length + ' 张 · 共 ' + total + ' 条</div>' +
      '<div style="font-size:.76rem;opacity:.6;line-height:1.7;margin:2px 0 6px">→ 是本条目对它是这个关系，← 是它对本条目。点下面的按钮进史料看可点击的完整关系网。</div>';

    groups.forEach(function (g) {
      h += '<p style="font-size:.78rem;opacity:.72;margin:8px 0 2px">' + esc(g.label) + '</p>' +
        '<div style="font-size:.82rem;line-height:1.8">' +
        g.rows.slice(0, 24).map(function (r) {
          return '<div>(' + (r.out ? '→' : '←') + ') ' + esc(nameOf[r.other] || r.other) + ' · ' + esc(r.rel) + '</div>';
        }).join('') +
        (g.rows.length > 24 ? '<div style="opacity:.55">… 还有 ' + (g.rows.length - 24) + ' 条</div>' : '') +
        '</div>';
    });

    h += '</div>';
    return h;
  }

  function selectedId() {
    try {
      var s = window.selected;
      if (s && s.d && s.d.id) return s.d.id;
      if (s && s.id) return s.id;
    } catch (e) {}
    /* 兜底：从面板标题反查不到 id，就不显示 */
    return '';
  }

  var _busy = false;
  function inject() {
    /* 自己插入节点也会触发观察器：加个闸门，避免无限递归 */
    if (_busy) return;
    _busy = true;
    try {
      var panel = document.getElementById('panel');
      if (!panel || !panel.classList.contains('open')) return;
      var pr = document.getElementById('pr');
      if (!pr || !pr.parentNode) return;
      var old = document.getElementById(BOX_ID);
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var id = selectedId();
      var html = crossGraphHTML(id);
      if (!html) return;
      var box = document.createElement('div');
      box.innerHTML = html;
      var node = box.firstChild;
      pr.parentNode.insertBefore(node, pr.nextSibling);
    } catch (e) {} finally {
      /* 必须放 finally：中途 return（比如面板还没打开）也要把闸门打开，
         否则 _busy 永远是 true，之后一次都不会再注入。 */
      setTimeout(function () { _busy = false; }, 30);
    }
  }

  function watch() {
    var panel = document.getElementById('panel');
    if (!panel) { setTimeout(watch, 400); return; }
    try {
      /* ⚠️ 同一个 observer 调两次 observe 会覆盖前一次配置（第一次的 attributes 就失效了）。
         一次给齐：class 变化（打开/关闭）+ 内容重写（切换节点时 class 不变，只换内容）。 */
      var mo = new MutationObserver(function () { inject(); });
      mo.observe(panel, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    } catch (e) {}
    inject();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
