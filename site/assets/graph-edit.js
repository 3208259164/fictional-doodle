/* =====================================================================
   学通 · 关系图谱编辑器 v3（graph.html 专用）
   依赖：assets/overlay.js

   v2 → v3 变更（按用户反馈）
   1. ⛔ 总开关优先：自助编辑关闭时，本脚本**完全不加载**（不建任何 UI，
      ?edit=1 也忽略）——「关闭后关系图谱里不会显示任何编辑相关的东西」。
   2. 🧹 清屏模式：进入 body.clean 时隐藏全部编辑 UI（覆盖层/工具栏/状态标签/
      空图谱提示），并自动退出编辑模式、收起弹窗；退出清屏自动还原。
      实现＝「纯 CSS 隐藏」+「MutationObserver 处理逻辑副作用」双保险。
   3. 🔉 按钮精简：10 个 → 3 个（编辑 / 图谱 / 撤销）。新建·重命名·删除图谱
      全部并入「🗂 图谱」弹窗；适应窗口/放大/缩小移除（页面本来就有适应窗口，
      缩放手势由双指捏合承担）。
   4. 🔎 引用节点：不再用原生 <select>（Android WebView 里 100+ 选项会卡甚至卡死），
      改为**可搜索列表弹层**，并可引用「内置主图谱」的节点（这正是之前缺的能力）。
   5. 🎯 沿用 v2 的可靠事件模型：透明覆盖层接管 Pointer 事件，不吞按钮点击。
   ===================================================================== */
(function () {
  'use strict';
  if (!window.YZY) return;
  /* —— 总开关：关闭就什么都不做 —— */
  if (typeof YZY.editorEnabled === 'function' && !YZY.editorEnabled()) return;

  var GID_MAIN = 'main';
  var editMode = false, linkFrom = null;
  var undoStack = [];

  var cv = document.getElementById('cv');
  if (!cv) return;
  try { cv.style.touchAction = 'none'; } catch (e) {}

  /* ================= 提示 ================= */
  var CLEAN = false;
  function toast(msg, err) {
    if (CLEAN) return;
    var t = document.getElementById('geToast');
    if (!t) {
      t = document.createElement('div'); t.id = 'geToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:99998;background:#101010;color:var(--panel-btn-text);' +
        'border:1px solid var(--panel-line);border-radius:10px;padding:10px 16px;font-size:.82rem;max-width:86%;box-shadow:0 4px 18px rgba(0,0,0,.6);display:none;pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = String(msg);
    t.style.display = 'block';
    t.style.borderColor = err ? '#e05555' : 'var(--panel-line)';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, err ? 6000 : 2600);
  }
  window.addEventListener('error', function (ev) { if (ev && ev.message) toast('脚本错误：' + ev.message, true); }, true);

  /* ================= 页内对话框 ================= */
  function D() {
    var d = document.getElementById('geDlg');
    if (!d) {
      d = document.createElement('div'); d.id = 'geDlg';
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:100000;' +
        'background:rgba(6,6,10,.86);display:none;align-items:flex-end;justify-content:center;padding:0';
      d.innerHTML = '<div class="box" style="background:var(--panel-bg);border:1px solid var(--panel-line);border-radius:16px 16px 0 0;padding:16px;' +
        'width:100%;max-width:560px;max-height:86%;overflow:auto;color:var(--panel-text);font-family:inherit;box-shadow:0 -8px 40px rgba(0,0,0,.7)"></div>';
      d.onclick = function (e) { if (e.target === d) closeD(); };
      document.body.appendChild(d);
    }
    return d;
  }
  function closeD() { var d = document.getElementById('geDlg'); if (d) d.style.display = 'none'; }
  function openD(inner, build) {
    var d = D(); d.style.display = 'flex';
    var box = d.querySelector('.box'); box.innerHTML = inner;
    if (build) build(box);
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function styleBtn(b, kind) {
    var base = 'padding:11px 16px;border-radius:10px;font-size:.9rem;cursor:pointer;font-family:inherit;' +
      'min-height:44px;box-sizing:border-box;touch-action:manipulation;';
    if (kind === 'g') b.style.cssText = base + 'border:1px solid var(--panel-line);background:transparent;color:var(--panel-text);flex:1';
    else if (kind === 'd') b.style.cssText = base + 'border:1px solid var(--panel-line);background:#3a0d0d;color:#ffc9c9;flex:1';
    else b.style.cssText = base + 'border:1px solid var(--panel-btn-line);background:var(--panel-btn);color:var(--panel-btn-text);flex:1';
    return b;
  }
  function btn(txt, kind) { var b = el('button', '', txt); b.type = 'button'; return styleBtn(b, kind); }
  function btnRow() { var d = el('div'); d.style.cssText = 'display:flex;gap:8px;margin-top:14px;flex-wrap:wrap'; return d; }
  function inp(val, ph, id) {
    var i = el('input'); i.type = 'text'; i.value = val || ''; if (ph) i.placeholder = ph;
    i.style.cssText = 'width:100%;box-sizing:border-box;background:var(--panel-bg2);border:1px solid var(--panel-line);color:var(--panel-text);' +
      'border-radius:10px;padding:11px;font-size:.9rem;font-family:inherit;margin-top:6px';
    if (id) i.id = id;
    return i;
  }
  function lab(txt) { var l = el('label', '', txt); l.style.cssText = 'display:block;font-size:.78rem;opacity:.85;margin:12px 0 0'; return l; }
  function listRow(txt, sub, active) {
    var r = el('button'); r.type = 'button';
    r.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;text-align:left;min-height:52px;box-sizing:border-box;' +
      'padding:10px 12px;margin:6px 0;border-radius:12px;font-family:inherit;font-size:.9rem;cursor:pointer;touch-action:manipulation;' +
      'border:1px solid ' + (active ? '#f5c518' : '#3a2e22') + ';background:' + (active ? 'rgba(245,197,24,.10)' : 'rgba(255,255,255,.03)') +
      ';color:' + (active ? '#f5c518' : 'var(--panel-text)');
    var t = el('span', '', txt); t.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    r.appendChild(t);
    if (sub) { var s = el('span', '', sub); s.style.cssText = 'font-size:.72rem;opacity:.65;flex:none'; r.appendChild(s); }
    return r;
  }

  function askText(title, def, ph) {
    return new Promise(function (res) {
      openD('<h4 style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">' + title + '</h4>', function (box) {
        var i = inp(def, ph, 'ge_text'); box.appendChild(i);
        var b = btnRow();
        var ok = btn('确定'), no = btn('取消', 'g');
        ok.onclick = function () { closeD(); res(i.value); };
        no.onclick = function () { closeD(); res(null); };
        b.appendChild(ok); b.appendChild(no); box.appendChild(b);
        setTimeout(function () { try { i.focus(); } catch (e) {} }, 30);
      });
    });
  }
  function askConfirm(title, text) {
    return new Promise(function (res) {
      openD('<h4 style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">' + title + '</h4>' +
        (text ? '<p style="font-size:.82rem;opacity:.85;line-height:1.7;margin:0">' + text + '</p>' : ''), function (box) {
          var b = btnRow();
          var ok = btn('确定'), no = btn('取消', 'g');
          ok.onclick = function () { closeD(); res(true); };
          no.onclick = function () { closeD(); res(false); };
          b.appendChild(ok); b.appendChild(no); box.appendChild(b);
        });
    });
  }

  /* ================= 分组与布局 ================= */
  function buildGroups(isMain) {
    if (isMain) {
      var G0 = [
        { key: 'core', label: '革命导师', ids: ['marx', 'engels', 'lenin', 'stalin', 'mao'] },
        { key: 'intl', label: '国际共运', ids: ['liebknecht', 'bebels', 'luxemburg', 'kl', 'zetkin', 'gramsci', 'dimitrov', 'thaelmann', 'ho', 'castro', 'che', 'tito', 'hoxha'] },
        { key: 'cn_early', label: '中国 · 建党先驱', ids: ['chen_duxiu', 'dch', 'cai_hesen', 'qu_qiubai', 'yun_daiying', 'peng_pai', 'fang_zhimin', 'xiang_jingyu', 'deng_zhongxia', 'liu_shaoqi', 'zhou_enlai', 'zhu_de'] },
        { key: 'cn_martyr', label: '革命同志 · 英烈', ids: ['dongbiwu', 'linboqu', 'zhangwentian', 'wangjiaxiang', 'renbishi', 'chentanqiu', 'heshuheng', 'dengfa', 'maozemin', 'liuzhidan', 'yangjingyu', 'zhaoyiman', 'jiangzhujun', 'liuhulan', 'dongcunrui', 'huangjiguang', 'leifeng', 'jiaoyulu'] },
        { key: 'srb', label: '文化大革命', ids: ['jiangqing', 'zhangchunqiao', 'yaowenyuan', 'wanghongwen'] },
        { key: 'critic', label: '被批判 · 对立', ids: ['proudhon', 'weitling', 'bakunin', 'lassalle', 'duhring', 'bernstein', 'kautsky', 'martov', 'trotsky'] },
        { key: 'idea', label: '思想 · 理论', ids: [] },
        { key: 'org', label: '组织 · 政党', ids: [] }
      ];
      var known = {};
      G0.forEach(function (g) { g.ids.forEach(function (id) { known[id] = 1; }); });
      var extra = [];
      (window.GR.nodes || []).forEach(function (n) {
        if (known[n.id]) return;
        if (n.type === 'idea') { if (G0[6].ids.indexOf(n.id) < 0) G0[6].ids.push(n.id); }
        else if (n.type === 'org') { if (G0[7].ids.indexOf(n.id) < 0) G0[7].ids.push(n.id); }
        else if (extra.indexOf(n.id) < 0) extra.push(n.id);
      });
      if (extra.length) G0.push({ key: 'extra', label: '其它人物（本机新增）', ids: extra });
      return G0;
    }
    var g = {};
    (window.GR.nodes || []).forEach(function (n) {
      var k = (n.type === 'idea') ? 'idea' : (n.type === 'org') ? 'org' : (n.type === 'event') ? 'event' : 'person';
      (g[k] = g[k] || []).push(n.id);
    });
    var LAB = { person: '人物', idea: '思想', org: '组织', event: '事件' };
    return Object.keys(g).map(function (k) { return { key: k, label: LAB[k] || k, ids: g[k] }; });
  }

  var ITER_CAP = 420, PER_FRAME = 70, settleToken = 0;
  function stepLayout() {
    var ns = window.ns, es = window.es, N = ns.length;
    if (!N) return 0;
    var F = 26000, KG = 0.0035, REST = 300, LK = 0.010, MIN = 150, i, j, k, m, p, q;
    for (i = 0; i < N; i++) {
      var a = ns[i];
      for (j = i + 1; j < N; j++) {
        var b = ns[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2), f = F / d2, ux = dx / d * f, uy = dy / d * f;
        a.vx += ux; a.vy += uy; b.vx -= ux; b.vy -= uy;
      }
    }
    for (k = 0; k < es.length; k++) {
      var e = es[k], ex = e.t.x - e.s.x, ey = e.t.y - e.s.y, ed = Math.sqrt(ex * ex + ey * ey) || 0.01, ff = (ed - REST) * LK, tx = ex / ed * ff, ty = ey / ed * ff;
      e.s.vx += tx; e.s.vy += ty; e.t.vx -= tx; e.t.vy -= ty;
    }
    var kin = 0;
    for (m = 0; m < N; m++) {
      var o = ns[m], c = window.CENTER[window.GID[o.d.id]] || [0, 0];
      if (o.pinned) { o.vx = 0; o.vy = 0; continue; }
      o.vx += (c[0] - o.x) * KG; o.vy += (c[1] - o.y) * KG;
      o.x += o.vx * 0.5; o.y += o.vy * 0.5; o.vx *= 0.82; o.vy *= 0.82;
      kin += o.vx * o.vx + o.vy * o.vy;
    }
    for (p = 0; p < N; p++) {
      var A = ns[p];
      for (q = p + 1; q < N; q++) {
        var B = ns[q], dx2 = A.x - B.x, dy2 = A.y - B.y, dd = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 0.01;
        if (dd < MIN) { var push = (MIN - dd) * 0.5, nx = dx2 / dd, ny = dy2 / dd; A.x += nx * push; A.y += ny * push; B.x -= nx * push; B.y -= ny * push; }
      }
    }
    return kin;
  }
  function runSettle(resetView, cap) {
    var my = ++settleToken, n = 0, cap2 = cap || ITER_CAP;
    function tick() {
      if (my !== settleToken) return;
      var kin = 1;
      for (var i = 0; i < PER_FRAME && n < cap2; i++) { kin = stepLayout(); n++; }
      if (window.draw) window.draw();
      if (n < cap2 && kin > 0.02) { requestAnimationFrame(tick); return; }
      if (resetView && window.ns.length && window.fitTo) window.fitTo(window.ns);
      else if (window.draw) window.draw();
    }
    requestAnimationFrame(tick);
  }

  var imgCache = {};
  function rebuild(resetView, relayout) {
    if (relayout === undefined) relayout = true;
    var d = YZY.graphData ? YZY.graphData() : { nodes: [], links: [] };
    var isMain = (d.id === GID_MAIN);
    var prevPos = {};
    (window.ns || []).forEach(function (o) { if (o && o.d) prevPos[o.d.id] = { x: o.x, y: o.y }; });

    window.GR = { nodes: d.nodes || [], links: d.links || [] };
    var P = {}; window.GR.nodes.forEach(function (n) { P[n.id] = n; }); window.P = P;
    var CT = window.SITE_CONTENT || {}, CMAP = {};
    ((CT.leaders || []).concat(CT.comrades || [])).forEach(function (p) { CMAP[p.name] = p; }); window.CMAP = CMAP;

    var GROUPS = buildGroups(isMain); window.GROUPS = GROUPS;
    var GID = {}, CENTER = {};
    if (typeof window.yzPlace === 'function') {
      /* ★ 与浏览模式共用页面的分组/落点：文革图谱按「省」分组成环，其余按语义分组。
         此前编辑模式自带另一套分组且不重算落点 → 图谱与地图都对不上（旧 bug）。 */
      GID = window.yzPlace() || window.GID || {};
      CENTER = window.CENTER || {};
      GROUPS = window.GROUPS || GROUPS;
    } else {
      GROUPS.forEach(function (g) { g.ids.forEach(function (id) { GID[id] = g.key; }); });
      var ELL = [2000, 900];
      var others = GROUPS.filter(function (g) { return g.key !== 'core'; });
      others.forEach(function (g, i) {
        var a = i / others.length * 2 * Math.PI - Math.PI / 2 + Math.PI / 6;
        g.c = [Math.cos(a) * ELL[0], Math.sin(a) * ELL[1]]; CENTER[g.key] = g.c;
      });
      var core = GROUPS.filter(function (g) { return g.key === 'core'; })[0];
      if (core) { core.c = [0, 0]; CENTER.core = [0, 0]; }
    }
    window.GID = GID; window.CENTER = CENTER;

    var ns = window.GR.nodes.map(function (n, i) {
      var c = CENTER[GID[n.id]] || [0, 0];
      var o = { d: n, vx: 0, vy: 0, deg: 0, img: null, imgOk: false };
      if (typeof n.x === 'number' && typeof n.y === 'number') { o.x = n.x; o.y = n.y; o.pinned = true; }
      else if (prevPos[n.id]) { o.x = prevPos[n.id].x; o.y = prevPos[n.id].y; }
      else { var a = i * 2.399963, r = 6 + (i % 7) * 5; o.x = c[0] + Math.cos(a) * r; o.y = c[1] + Math.sin(a) * r; }
      return o;
    });
    window.ns = ns;
    /* ★ 重算地理落点（gx/gy）：编辑模式此前不算 → 地图上只能按力导向坐标画，就是那张“错误的地图” */
    if (typeof window.yzGeo === 'function') { try { window.yzGeo(ns); } catch (e) {} }
    var ix = {}; ns.forEach(function (o) { ix[o.d.id] = o; }); window.ix = ix;
    window.selected = null; window.hover = null; window.nb = {};

    var es = [], usedPair = {};
    window.GR.links.forEach(function (l) {
      var s = ix[l.source], t = ix[l.target];
      if (s && t) {
        var key = [l.source, l.target].sort().join('|');
        usedPair[key] = (usedPair[key] || 0) + 1;
        es.push({ s: s, t: t, r: l.rel, k: l.kind, dir: ((window.hashStr(key) % 2) ? 1 : -1) * usedPair[key], color: l.color || '' });
        s.deg++; t.deg++;
      }
    });
    window.es = es;

    ns.forEach(function (o) {
      var v = o.d.img; if (!v) return;
      var c = imgCache[v];
      if (c && c.ok) { o.img = c.img; o.imgOk = true; return; }
      var im = new Image();
      im.onload = function () { imgCache[v] = { img: im, ok: true }; o.img = im; o.imgOk = true; if (window.draw) window.draw(); };
      im.onerror = function () { imgCache[v] = { img: null, ok: false }; o.imgOk = false; o.img = null; };
      im.src = v; o.img = im;
    });

    try {
      document.getElementById('nc').textContent = window.GR.nodes.length;
      document.getElementById('lc').textContent = window.GR.links.length;
    } catch (e) {}
    if (relayout) runSettle(resetView);
    else { if (resetView && window.ns.length && window.fitTo) window.fitTo(window.ns); else if (window.draw) window.draw(); }
    updateUI(); updateEmptyHint();
  }
  window.__geRebuild = rebuild;

  /* ================= 撤销 ================= */
  var undoLock = false;
  function snapshot() {
    if (undoLock) return;
    try {
      var d = YZY.graphData();
      undoStack.push({ id: d.id, data: JSON.parse(JSON.stringify({ nodes: d.nodes, links: d.links })) });
      if (undoStack.length > 20) undoStack.shift();
    } catch (e) {}
  }
  function undo() {
    if (!undoStack.length) { toast('没有可撤销的操作', true); return; }
    var s = undoStack.pop();
    if (!YZY.replaceGraphData) { toast('撤销不可用', true); return; }
    undoLock = true;
    try { YZY.replaceGraphData(s.id, s.data); } finally { undoLock = false; }
    rebuild(false, false); toast('已撤销');
  }

  /* ================= 可搜索列表弹层（替代原生 select；支持 100+ 项） ================= */
  function pickerSheet(opts) {
    /* opts: {title, hint, groups:[{label, items:[{id,name,sub,node}]}], allowNone, noneText} */
    return new Promise(function (res) {
      openD('<h4 id="ge_pick_title" style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">' + opts.title + '</h4>' +
        (opts.hint ? '<p style="font-size:.76rem;opacity:.75;line-height:1.6;margin:0 0 6px">' + opts.hint + '</p>' : ''), function (box) {
          var si = el('input'); si.type = 'search'; si.id = 'ge_pick_q'; si.placeholder = '输入名称筛选…'; si.setAttribute('inputmode', 'search');
          si.style.cssText = 'width:100%;box-sizing:border-box;background:var(--panel-bg2);border:1px solid var(--panel-line);color:var(--panel-text);' +
            'border-radius:10px;padding:11px;font-size:.9rem;font-family:inherit;margin-bottom:6px';
          box.appendChild(si);
          var listBox = el('div'); listBox.id = 'ge_pick_list'; listBox.style.cssText = 'max-height:52vh;overflow:auto';
          box.appendChild(listBox);

          function render(q) {
            q = (q || '').trim().toLowerCase();
            listBox.innerHTML = '';
            var shown = 0;
            (opts.groups || []).forEach(function (grp) {
              var items = (grp.items || []).filter(function (it) { return !q || (it.name || '').toLowerCase().indexOf(q) >= 0 || String(it.id).toLowerCase().indexOf(q) >= 0; });
              if (!items.length) return;
              var h = el('div', '', grp.label); h.style.cssText = 'font-size:.72rem;opacity:.6;margin:10px 0 2px';
              listBox.appendChild(h);
              items.slice(0, 400).forEach(function (it) {
                var r = listRow(it.name, it.sub, false);
                r.setAttribute('data-pick', it.id);
                if (it.disabled) {
                  r.style.opacity = '.5'; r.style.cursor = 'default';
                  r.onclick = function () { toast(it.sub || '该项不可选'); };
                } else {
                  r.onclick = function () { closeD(); res(it.node || it.id); };
                }
                listBox.appendChild(r); shown++;
              });
            });
            if (!shown) { var e = el('div', '', '没有匹配项'); e.style.cssText = 'opacity:.6;font-size:.82rem;padding:12px 0'; listBox.appendChild(e); }
          }
          si.oninput = function () { render(si.value); };
          render('');

          var b = btnRow();
          if (opts.allowNone) {
            var none = btn(opts.noneText || '— 不引用 —', 'g');
            none.id = 'ge_pick_none';
            none.onclick = function () { closeD(); res(''); };
            b.appendChild(none);
          }
          var no = btn('取消', 'g'); no.onclick = function () { closeD(); res(undefined); };
          b.appendChild(no); box.appendChild(b);
        });
    });
  }

  /* 可被引用为“已有节点”的候选：排除本图谱已有的（本图谱的直接点它连线即可） */
  function refCandidates() {
    var cur = YZY.graphData();
    var have = {};
    (cur.nodes || []).forEach(function (n) { have[n.id] = 1; });
    var groups = [];
    if (cur.id !== GID_MAIN) {
      var main = YZY.graphData(GID_MAIN);
      var mItems = (main.nodes || []).filter(function (n) { return !have[n.id]; }).map(function (n) {
        return { id: n.id, name: n.name || n.id, sub: (n.type === 'idea' ? '思想' : n.type === 'org' ? '组织' : '人物'), node: n };
      });
      if (mItems.length) groups.push({ label: '内置主图谱（' + mItems.length + ' 个可引用）', items: mItems });
    }
    var others = YZY.listGraphs().filter(function (g) { return !g.builtin && g.id !== cur.id; });
    var list = [];
    others.forEach(function (g) {
      (YZY.graphData(g.id).nodes || []).forEach(function (n) {
        if (have[n.id]) return;
        list.push({ id: n.id, name: n.name || n.id, sub: g.name, node: n });
      });
    });
    if (list.length) groups.push({ label: '我的其他图谱', items: list });
    return groups;
  }

  /* ================= 编辑动作 ================= */
  var TAP_MOVE = 10, TAP_TIME = 500, LONG_PRESS = 650;

  function askNodeForm(state) {
    state = state || { ref: '', refName: '', name: '', type: 'person', desc: '' };
    return new Promise(function (res) {
      openD('<h4 style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">新建节点</h4>', function (box) {
        box.appendChild(lab('① 引用已有节点（可选；来自内置主图谱或我的其他图谱）'));
        var refB = btn(state.ref ? ('已引用：' + state.refName) : '— 不引用，新建 —', 'g');
        refB.id = 'ge_refpick'; refB.style.width = '100%'; refB.style.flex = 'none';
        refB.onclick = function () {
          state.name = (document.getElementById('ge_name') || {}).value || state.name;
          state.type = (document.getElementById('ge_type') || {}).value || state.type;
          state.desc = (document.getElementById('ge_desc') || {}).value || state.desc;
          pickerSheet({ title: '引用已有节点', hint: '本图谱里已有的节点直接点它即可连线，这里只列其它图谱的节点。', groups: refCandidates(), allowNone: true, noneText: '— 不引用，新建 —' })
            .then(function (picked) {
              if (picked === undefined) { askNodeForm(state).then(res); return; }
              if (picked && typeof picked === 'object') {
                state.ref = picked.id; state.refName = picked.name;
                state.name = picked.name || state.name; state.type = picked.type || 'person';
                state.desc = picked.desc || '';
              } else { state.ref = ''; state.refName = ''; }
              askNodeForm(state).then(res);
            });
        };
        box.appendChild(refB);

        box.appendChild(lab('② 名称'));
        box.appendChild(inp(state.name, '如：某人物 / 某思想', 'ge_name'));
        box.appendChild(lab('③ 类型'));
        var sel = el('select'); sel.id = 'ge_type';
        sel.style.cssText = 'width:100%;box-sizing:border-box;background:var(--panel-bg2);border:1px solid var(--panel-line);color:var(--panel-text);border-radius:10px;padding:11px;margin-top:6px;font-size:.9rem';
        [['person', '人物'], ['idea', '思想'], ['org', '组织'], ['event', '事件']].forEach(function (o) {
          var op = el('option', '', o[1]); op.value = o[0]; if (o[0] === state.type) op.selected = true; sel.appendChild(op);
        });
        box.appendChild(sel);
        box.appendChild(lab('④ 介绍（可选）'));
        box.appendChild(inp(state.desc, '一两句话说清它是谁/是什么', 'ge_desc'));

        var b = btnRow();
        var ok = btn('创建节点');
        ok.onclick = function () {
          var o = {
            ref: state.ref,
            name: (document.getElementById('ge_name') || {}).value || '',
            type: (document.getElementById('ge_type') || {}).value || 'person',
            desc: (document.getElementById('ge_desc') || {}).value || ''
          };
          closeD(); res(o);
        };
        var no = btn('取消', 'g'); no.onclick = function () { closeD(); res(null); };
        b.appendChild(ok); b.appendChild(no); box.appendChild(b);
      });
    });
  }

  function createNodeAt(w) {
    askNodeForm(null).then(function (o) {
      if (!o) return;
      var node;
      if (o.ref) {
        var src = null;
        var cur = YZY.graphData();
        (cur.nodes || []).some(function (n) { if (n.id === o.ref) { src = n; return true; } return false; });
        if (!src) { (YZY.graphData(GID_MAIN).nodes || []).some(function (n) { if (n.id === o.ref) { src = n; return true; } return false; }); }
        if (!src) {
          YZY.listGraphs().forEach(function (g) { (YZY.graphData(g.id).nodes || []).some(function (n) { if (n.id === o.ref) { src = n; return true; } return false; }); });
        }
        if (!src) { toast('找不到被引用的节点', true); return; }
        node = JSON.parse(JSON.stringify(src));
        node.id = 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        if (o.name) node.name = o.name;
        if (o.type) node.type = o.type;
        if (o.desc) node.desc = o.desc;
      } else {
        if (!String(o.name || '').trim()) { toast('请填写名称', true); return; }
        node = { id: 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(o.name).trim(), type: o.type || 'person', desc: o.desc || '' };
      }
      snapshot();
      node.x = Math.round(w.x); node.y = Math.round(w.y);
      var r = YZY.addGraphNode(undefined, node);
      if (!r || r.ok === false) { toast((r && r.msg) || '新建失败', true); return; }
      YZY.setNodePos(undefined, node.id, { x: node.x, y: node.y });
      rebuild(false, true);
      toast('已新建节点：' + node.name + '（长按可删除）');
    });
  }
  function connectDialog(a, b) {
    var A = (a && a.d) ? a.d : a, B = (b && b.d) ? b.d : b;
    if (!A || !B) { toast('节点信息缺失', true); return; }
    if (A.id === B.id) { toast('不能连到自己', true); return; }
    askEdge('建立关系：' + (A.name || A.id) + ' → ' + (B.name || B.id), '关联', '#f5c518', false).then(function (r) {
      if (!r) return;
      snapshot();
      var x = YZY.addGraphEdge(undefined, { source: A.id, target: B.id, rel: (r.rel || '关联'), color: r.color || '#f5c518' });
      if (!x || x.ok === false) { toast((x && x.msg) || '连线失败', true); return; }
      rebuild(false, true);
      toast('已建立关系：' + (r.rel || '关联'));
    });
  }
  function askEdge(title, relVal, colorVal, allowDelete, allowSwap) {
    var PALETTE = ['#f5c518', '#8de6a1', '#7ec8ff', '#ff8b8b', '#d7aef2', '#ffd166', '#63e6be', '#a5d8ff', '#ffffff', '#9aa0a6'];
    return new Promise(function (res) {
      openD('<h4 style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">' + title + '</h4>', function (box) {
        box.appendChild(lab('关系名称'));
        var rel = inp(relVal, '师从 / 批判 / 战友 / 亲属…', 'ge_edge_rel'); box.appendChild(rel);
        box.appendChild(lab('关系线颜色'));
        var hex = inp(colorVal, '#RRGGBB', 'ge_edge_hex');
        var sw = el('div'), cur = colorVal || PALETTE[0];
        PALETTE.forEach(function (c) {
          var s = el('span'); s.style.cssText = 'display:inline-block;width:34px;height:34px;border-radius:9px;margin:4px 4px 0 0;cursor:pointer;background:' + c +
            ';border:2px solid ' + (c === cur ? 'var(--panel-btn-text)' : 'var(--panel-line)');
          s.onclick = function () { [].forEach.call(sw.children, function (x) { x.style.borderColor = 'var(--panel-line)'; }); s.style.borderColor = 'var(--panel-btn-text)'; hex.value = c; };
          sw.appendChild(s);
        });
        box.appendChild(sw); box.appendChild(hex);
        var b = btnRow();
        var ok = btn(allowDelete ? '保存' : '建立关系');
        ok.onclick = function () { closeD(); res({ rel: rel.value, color: hex.value }); };
        b.appendChild(ok);
        if (allowDelete) {
          var del = btn('删除这条关系', 'd');
          del.onclick = function () { closeD(); res({ del: true }); };
          b.appendChild(del);
        }
        if (allowSwap) {
          var sw = btn('⇄ 反向这条关系', 'g');
          sw.onclick = function () { closeD(); res({ swap: true, rel: rel.value, color: hex.value }); };
          b.appendChild(sw);
        }
        var no = btn('取消', 'g'); no.onclick = function () { closeD(); res(null); };
        b.appendChild(no); box.appendChild(b);
      });
    });
  }
  function editEdge(e) {
    var key = e.s.d.id + '|' + e.t.d.id + '|' + (e.r || '');
    askEdge('关系：' + e.s.d.name + ' → ' + e.t.d.name, e.r || '', e.color || '#f5c518', true, true).then(function (r) {
      if (!r) return;
      snapshot();
      /* 删线只删线：原来这里 rebuild(false, true) 会整图重排，节点全换了位置，
       看起来就像「把节点也删了」。改样式用的是 false，这里跟它对齐。 */
      if (r.del) { YZY.removeGraphEdge(undefined, key); rebuild(false, false); toast('关系已删除'); return; }
      if (r.swap) {
        YZY.removeGraphEdge(undefined, key);
        var x2 = YZY.addGraphEdge(undefined, { source: e.t.d.id, target: e.s.d.id, rel: r.rel || e.r || '关联', color: r.color || e.color });
        if (x2 && x2.ok === false) { toast(x2.msg || '反向失败', true); return; }
        rebuild(false, false);
        toast('已反向：' + (e.t.d.name || e.t.d.id) + ' → ' + (e.s.d.name || e.s.d.id));
        return;
      }
      YZY.setEdgeStyle(undefined, key, { label: r.rel || '关联', color: r.color || '#f5c518' });
      rebuild(false, false);
      toast('关系已更新');
    });
  }
  function edgeAt(cx, cy) {
    var es = window.es || [], best = null, bd = 16 * 16;
    for (var i = 0; i < es.length; i++) {
      var e = es[i], a = window.S(e.s), b = window.S(e.t);
      var ex = b.x - a.x, ey = b.y - a.y, L2 = ex * ex + ey * ey || 1;
      var t = ((cx - a.x) * ex + (cy - a.y) * ey) / L2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var px2 = a.x + ex * t, py = a.y + ey * t;
      var d2 = (px2 - cx) * (px2 - cx) + (py - cy) * (py - cy);
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }
  /* ---------- 节点操作面板（长按节点打开）：编辑内容 / 加关系（可搜索） / 删除 ---------- */
  function nodeSheet(o) {
    var d = (o && o.d) ? o.d : o;
    if (!d || !d.id) { toast('节点信息缺失', true); return; }
    var TN = { person: '人物', idea: '思想', org: '组织', event: '事件', work: '著作' };
    openD('<h4 style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">' + (d.name || d.id) + '</h4>', function (box) {
      var t = el('p', '', (TN[d.type] || '节点') + (d.role ? ' · ' + d.role : '') + (d.years ? ' · ' + d.years : ''));
      t.style.cssText = 'font-size:.76rem;opacity:.72;margin:0 0 8px;line-height:1.6';
      box.appendChild(t);
      var b1 = btnRow();
      var e1 = btn('📝 编辑内容 / 重命名');
      e1.onclick = function () { closeD(); askEditNode(d); };
      var e2 = btn('🔗 加一条关系');
      e2.onclick = function () { closeD(); addRelationFrom(d); };
      b1.appendChild(e1); b1.appendChild(e2);
      box.appendChild(b1);
      var b2 = btnRow();
      var dm = btn('排在最前（固定）', 'g');
      dm.onclick = function () {
        closeD(); snapshot();
        YZY.setNodePos(undefined, d.id, { x: (d.x || 0), y: (d.y || 0) });
        toast('已固定当前坐标（拖动可再调整）');
      };
      var e3 = btn('🗑 删除节点', 'd');
      e3.onclick = function () { closeD(); deleteNode({ d: d }); };
      b2.appendChild(dm); b2.appendChild(e3);
      box.appendChild(b2);
      var b3 = btnRow(); var no = btn('关闭', 'g'); no.onclick = function () { closeD(); };
      b3.appendChild(no); box.appendChild(b3);
    });
  }

  /* ---------- 编辑节点内容（含重命名） ---------- */
  function askEditNode(d) {
    openD('<h4 style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">编辑「' + (d.name || d.id) + '」</h4>', function (box) {
      box.appendChild(lab('① 名称（改名后图谱标签与详情标题一起变）'));
      box.appendChild(inp(d.name || '', '节点名称', 'ge_ed_name'));
      box.appendChild(lab('② 类型'));
      var sel = el('select'); sel.id = 'ge_ed_type';
      sel.style.cssText = 'width:100%;box-sizing:border-box;background:var(--panel-bg2);border:1px solid var(--panel-line);color:var(--panel-text);border-radius:10px;padding:11px;margin-top:6px;font-size:.9rem';
      [['person', '人物'], ['idea', '思想'], ['org', '组织'], ['event', '事件'], ['work', '著作']].forEach(function (o) {
        var op = el('option', '', o[1]); op.value = o[0]; if (o[0] === (d.type || 'person')) op.selected = true; sel.appendChild(op);
      });
      box.appendChild(sel);
      box.appendChild(lab('③ 年份 / 生卒（可空）'));
      box.appendChild(inp(d.years || '', '如 1894—1971', 'ge_ed_years'));
      box.appendChild(lab('④ 一句话定位（可空）'));
      box.appendChild(inp(d.role || '', '如 苏共中央第一书记', 'ge_ed_role'));
      box.appendChild(lab('⑤ 介绍'));
      var ta = el('textarea'); ta.id = 'ge_ed_desc'; ta.value = d.desc || ''; ta.rows = 5;
      box.appendChild(ta);
      box.appendChild(lab('⑥ 要点（每行一条，可空）'));
      var tp = el('textarea'); tp.id = 'ge_ed_points'; tp.value = (d.points || []).join('\n'); tp.rows = 3;
      box.appendChild(tp);
      var b = btnRow();
      var ok = btn('保存');
      ok.onclick = function () {
        var name = String((document.getElementById('ge_ed_name') || {}).value || '').trim();
        if (!name) { toast('名称不能为空', true); return; }
        var patch = {
          name: name,
          type: (document.getElementById('ge_ed_type') || {}).value || d.type || 'person',
          years: String((document.getElementById('ge_ed_years') || {}).value || '').trim(),
          role: String((document.getElementById('ge_ed_role') || {}).value || '').trim(),
          desc: String((document.getElementById('ge_ed_desc') || {}).value || ''),
          points: String((document.getElementById('ge_ed_points') || {}).value || '')
            .split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean)
        };
        closeD(); snapshot();
        var r = YZY.setNodeStyle(undefined, d.id, patch);
        if (!r || r.ok === false) { toast((r && r.msg) || '保存失败', true); return; }
        rebuild(false, false);
        toast('已保存「' + name + '」');
      };
      b.appendChild(ok);
      var no = btn('取消', 'g'); no.onclick = function () { closeD(); };
      b.appendChild(no); box.appendChild(b);
    });
  }

  /* ---------- 加关系：另一端可搜索（图谱太大点不中时用这个） ---------- */
  function connectPickerGroups(excludeId) {
    var cur = YZY.graphData() || {};
    var nodes = cur.nodes || [];
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var TN = { person: '人物', idea: '思想', org: '组织', event: '事件', work: '著作' };
    var gs = buildGroups(cur.id === 'main');
    var out = [], known = {};
    gs.forEach(function (g) {
      var items = [];
      (g.ids || []).forEach(function (id) {
        known[id] = 1;
        var n = byId[id]; if (!n || id === excludeId) return;
        items.push({ id: id, name: n.name || id, sub: (TN[n.type] || '节点') + (n.role ? ' · ' + n.role : ''), node: n });
      });
      if (items.length) out.push({ label: g.label, items: items });
    });
    var rest = nodes.filter(function (n) { return !known[n.id] && n.id !== excludeId; })
      .map(function (n) { return { id: n.id, name: n.name || n.id, sub: (TN[n.type] || '节点') + (n.role ? ' · ' + n.role : ''), node: n }; });
    if (rest.length) out.push({ label: '其它', items: rest });
    return out;
  }
  function addRelationFrom(d) {
    pickerSheet({
      title: '给「' + (d.name || d.id) + '」加一条关系',
      hint: '输入名称可筛选（如「毛」）。点中的节点会成为关系的另一端，方向为「' + (d.name || d.id) + ' → 它」。',
      groups: connectPickerGroups(d.id), allowNone: true, noneText: '— 取消 —'
    }).then(function (picked) {
      if (picked === undefined || !picked) return;
      var other = (picked && picked.node) ? picked.node : picked;
      if (!other || !other.id) { toast('没有选中节点', true); return; }
      connectDialog({ d: d }, { d: other });
    });
  }

  function deleteNode(o) {
    askConfirm('删除节点「' + (o.d.name || o.d.id) + '」？', '与它相连的所有关系线也会一并删除。').then(function (y) {
      if (!y) return;
      /* 删节点只删节点：rebuild 会优先复用每个节点已有的 x/y（prevPos），
         传 true 会跑一遍力导向收敛 = 剩下节点全被重新排布，看起来「整张图都乱了」。
         力导向图增量删除的标准做法就是「只重绘、不重算布局」。 */
      snapshot(); YZY.removeGraphNode(undefined, o.d.id); rebuild(false, false); toast('已删除节点');
    });
  }

  /* ================= 「🗂 图谱」弹窗：切换 + 新建 + 重命名 + 删除 合一 ================= */
  function openGraphSheet() {
    var list = YZY.listGraphs(), act = YZY.activeGraphId();
    var cur = (list.filter(function (g) { return g.id === act; })[0]) || {};
    openD('<h4 id="ge_sheet_title" style="margin:0 0 4px;color:var(--panel-accent);font-size:1rem">🗂 图谱</h4>' +
      '<p style="font-size:.76rem;opacity:.75;line-height:1.6;margin:0 0 6px">点一行即可切换。「＋ 新建 / ✎ 重命名 / 🗑 删除」只作用于你自建的图谱。</p>', function (box) {
        var listBox = el('div'); listBox.id = 'ge_graph_list'; listBox.style.cssText = 'max-height:46vh;overflow:auto';
        list.forEach(function (g) {
          var sub = g.builtin ? ('内置 · ' + (g.nodes != null ? g.nodes : '—') + ' 节点' + (g.links != null ? ' / ' + g.links + ' 关系' : ''))
                              : ((g.nodes || 0) + ' 节点 / ' + (g.links || 0) + ' 关系');
          var r = listRow(g.name, sub, g.id === act);
          r.setAttribute('data-gid', g.id);
          r.onclick = function () {
            if (g.id === act) { closeD(); return; }
            var x = YZY.setActiveGraph(g.id);
            if (x && x.ok === false) { toast(x.msg || '切换失败', true); return; }
            undoStack = []; linkFrom = null; closeD(); rebuild(true, true); updateUI();
            toast('已切换到「' + g.name + '」');
          };
          listBox.appendChild(r);
        });
        box.appendChild(listBox);

        var b1 = btnRow();
        var nb = btn('＋ 新建图谱', 'g'); nb.id = 'ge_new_graph';
        nb.onclick = function () {
          askText('新建图谱', '', '图谱名称，如：早期建党关系').then(function (name) {
            if (name === null) return;
            if (!String(name).trim()) { toast('请填写名称', true); return; }
            var r = YZY.newGraph(name);
            if (!r || r.ok === false) { toast((r && r.msg) || '新建失败', true); return; }
            undoStack = []; linkFrom = null; rebuild(true, true);
            toast('已新建「' + r.name + '」——点空白处开始建节点');
          });
        };
        b1.appendChild(nb);
        var ib = btn('📥 导入图谱', 'g'); ib.id = 'ge_import_graph';
        ib.title = '从 JSON 文件导入一张图谱（成为你自己的一张图谱）';
        ib.onclick = function () { closeD(); if (window.yzImportGraph) window.yzImportGraph(); };
        b1.appendChild(ib); box.appendChild(b1);

        if (act !== GID_MAIN && !cur.builtin) {
          var b2 = btnRow();
          var rb = btn('✎ 重命名当前', 'g'); rb.id = 'ge_rename_graph';
          rb.onclick = function () {
            askText('重命名图谱', cur.name).then(function (v) {
              if (!v) return;
              YZY.renameGraph(act, v); rebuild(false, false); updateUI();
              toast('已改名为「' + v + '」');
            });
          };
          var db = btn('🗑 删除当前', 'd'); db.id = 'ge_del_graph';
          db.onclick = function () {
            askConfirm('删除图谱「' + cur.name + '」？', '图谱内节点与关系会一并删除，不可恢复。').then(function (y) {
              if (!y) return;
              YZY.deleteGraph(act); undoStack = []; rebuild(true, true);
              toast('已删除图谱');
            });
          };
          b2.appendChild(rb); b2.appendChild(db); box.appendChild(b2);
        }
        var b3 = btnRow();
        var cl = btn('关闭', 'g'); cl.onclick = closeD; b3.appendChild(cl); box.appendChild(b3);
      });
  }

  /* ================= 编辑覆盖层（接管 Pointer，不吃按钮点击） ================= */
  var layer = document.createElement('div');
  layer.id = 'geLayer';
  layer.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:4;display:none;' +
    'touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;background:transparent';
  document.body.appendChild(layer);

  function px(ev) { var r = layer.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function worldXY(x, y) { return { x: (x - window.view.x) / window.view.k, y: (y - window.view.y) / window.view.k }; }

  var down = null, dragNode = null, moved = false, lpTimer = null, ptrs = {}, pinch = null;
  function ptrList() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
  function pinchDist() { var a = ptrList(); if (a.length < 2) return 1; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; }
  function pinchCenter() { var a = ptrList(); if (a.length < 2) return { x: 0, y: 0 }; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }

  layer.addEventListener('pointerdown', function (ev) {
    try {
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      try { layer.setPointerCapture(ev.pointerId); } catch (e) {}
      if (ptrList().length >= 2) {
        clearTimeout(lpTimer); down = null; dragNode = null; moved = false;
        var c = pinchCenter();
        pinch = { d: pinchDist(), k: window.view.k, cx: c.x, cy: c.y, x: window.view.x, y: window.view.y };
        return;
      }
      var p = px(ev);
      var h = window.hit ? window.hit(p.x, p.y) : null;
      down = { x: ev.clientX, y: ev.clientY, t: Date.now(), hit: h, moved: false, vx: window.view.x, vy: window.view.y };
      dragNode = h; moved = false;
      clearTimeout(lpTimer);
      lpTimer = setTimeout(function () {
        if (down && !down.moved && down.hit) { var o = down.hit; down = null; dragNode = null; nodeSheet(o); }
      }, LONG_PRESS);
    } catch (e) { toast('按下出错：' + e.message, true); }
  }, { passive: false });

  layer.addEventListener('pointermove', function (ev) {
    if (!ptrs[ev.pointerId]) return;
    ptrs[ev.pointerId].x = ev.clientX; ptrs[ev.pointerId].y = ev.clientY;
    if (pinch && ptrList().length >= 2) {
      var nk = Math.max(0.15, Math.min(6, pinch.k * (pinchDist() / pinch.d)));
      var r = nk / pinch.k, c = pinchCenter();
      window.view.x = c.x - (c.x - pinch.x) * r;
      window.view.y = c.y - (c.y - pinch.y) * r;
      window.view.k = nk;
      if (window.draw) window.draw();
      return;
    }
    if (!down) return;
    var dx = ev.clientX - down.x, dy = ev.clientY - down.y;
    if (Math.hypot(dx, dy) > TAP_MOVE) { down.moved = true; moved = true; clearTimeout(lpTimer); }
    if (!down.moved) return;
    if (dragNode) {
      var w = worldXY(px(ev).x, px(ev).y);
      dragNode.x = w.x; dragNode.y = w.y; dragNode.vx = 0; dragNode.vy = 0; dragNode.pinned = true;
      if (window.draw) window.draw();
    } else if (!down.hit) {
      window.view.x = down.vx + dx; window.view.y = down.vy + dy;
      if (window.draw) window.draw();
    }
  }, { passive: false });

  function endPointer(ev, cancelled) {
    clearTimeout(lpTimer);
    if (ev && ev.pointerId !== undefined) delete ptrs[ev.pointerId];
    if (ptrList().length < 2) pinch = null;
    if (cancelled) { down = null; dragNode = null; moved = false; return; }
    if (!down) return;
    var isTap = !down.moved && (Date.now() - down.t) < TAP_TIME;
    var h = down.hit, p = px(ev || { clientX: down.x, clientY: down.y });
    var wasDrag = dragNode && moved;
    down = null;
    try {
      if (wasDrag) {
        YZY.setNodePos(undefined, dragNode.d.id, { x: Math.round(dragNode.x), y: Math.round(dragNode.y) });
        toast('位置已记住');
      }
      dragNode = null; moved = false;
      if (!isTap) return;
      if (h) {
        if (!linkFrom) {
          linkFrom = h; if (window.draw) window.draw();
          toast('已选起点「' + (h.d.name || h.d.id) + '」→ 再点一个节点即可连线；长按节点可删除');
          return;
        }
        if (linkFrom === h) { linkFrom = null; if (window.draw) window.draw(); toast('已取消选择'); return; }
        var a = linkFrom; linkFrom = null;
        connectDialog(a, h);
        return;
      }
      var e2 = edgeAt(p.x, p.y);
      if (e2) { linkFrom = null; editEdge(e2); return; }
      linkFrom = null;
      createNodeAt(worldXY(p.x, p.y));
    } catch (err) { toast('操作出错：' + err.message, true); }
  }
  layer.addEventListener('pointerup', function (ev) { endPointer(ev, false); }, { passive: false });
  layer.addEventListener('pointercancel', function (ev) { endPointer(ev, true); }, { passive: false });
  layer.addEventListener('contextmenu', function (e) { if (editMode) { try { e.preventDefault(); } catch (x) {} } }, { passive: false });

  /* 双保险：编辑态下让原脚本挂在 #cv 上的属性型处理器空转 */
  var _om = { down: cv.onmousedown, up: cv.onmouseup, move: cv.onmousemove, leave: cv.onmouseleave, wheel: cv.onwheel };
  cv.onmousedown = function (e) { if (editMode) return; return _om.down && _om.down.apply(this, arguments); };
  cv.onmouseup = function (e) { if (editMode) return; return _om.up && _om.up.apply(this, arguments); };
  cv.onmousemove = function (e) { if (editMode) return; return _om.move && _om.move.apply(this, arguments); };
  cv.onmouseleave = function (e) { if (editMode) return; return _om.leave && _om.leave.apply(this, arguments); };
  cv.onwheel = function (e) { return _om.wheel && _om.wheel.apply(this, arguments); };

  /* ================= 工具栏（精简为 3 个） ================= */
  var bar = document.createElement('div');
  bar.id = 'geBar';
  document.body.appendChild(bar);

  function gb(txt, title, fn) {
    var b = el('button', 'ge-btn', txt); b.type = 'button';
    if (title) b.title = title;
    b.onclick = function () { try { fn(); } catch (e) { toast('操作失败：' + e.message, true); } };
    return b;
  }
  var btnMode = gb('✏️ 编辑', '进入编辑模式：点空白=建节点 · 点A再点B=连线 · 点关系线=改色改名 · 长按节点=删除 · 拖动=移动', function () { setMode(!editMode); });
  var btnGraph = gb('🗂 图谱', '新建 / 重命名 / 删除 / 切换图谱', function () { openGraphSheet(); });
  var btnUndo = gb('↶ 撤销', '撤销上一步编辑', function () { undo(); });
  [btnMode, btnGraph, btnUndo].forEach(function (b) { bar.appendChild(b); });

  var tag = document.createElement('div');
  tag.id = 'geTag';
  document.body.appendChild(tag);

  /* ================= 空图谱提示 ================= */
  var emptyEl = null, emptyDismissed = false;
  function updateEmptyHint() {
    var empty = !(window.ns && window.ns.length);
    if (!empty) { if (emptyEl) emptyEl.style.display = 'none'; return; }
    if (!emptyEl) {
      emptyEl = el('div'); emptyEl.id = 'geEmpty';
      document.body.appendChild(emptyEl);
    }
    emptyEl.style.display = (CLEAN || emptyDismissed) ? 'none' : 'block';
    emptyEl.innerHTML = '<button type="button" class="ge-x" title="关闭提示" aria-label="关闭提示">✕</button>' +
      '📭 这张图谱还是空的<br><span style="color:#f5c518">进入编辑模式 → 点空白处新建节点</span><br>' +
      '<span style="opacity:.75">想回到内置图谱：点「🗂 图谱」选「主图谱」</span>';
    var xb = emptyEl.querySelector('.ge-x');
    if (xb) xb.onclick = function (ev) {
      try { ev.stopPropagation(); } catch (e) {}
      emptyDismissed = true; emptyEl.style.display = 'none';
    };
  }

  /* ================= 模式 / 状态 ================= */
  function setMode(on) {
    editMode = !!on;
    layer.style.display = (editMode && !CLEAN) ? 'block' : 'none';
    btnMode.textContent = editMode ? '✔ 完成' : '✏️ 编辑';
    btnMode.title = editMode ? '退出编辑模式（恢复拖动平移 / 缩放）' : '进入编辑模式：点空白=建节点 · 点A再点B=连线 · 点关系线=改色改名 · 长按节点=删除';
    btnMode.classList.toggle('on', editMode);
    linkFrom = null; down = null; dragNode = null; ptrs = {}; pinch = null; clearTimeout(lpTimer);
    if (!editMode && window.clearSel) { try { window.clearSel(); } catch (e) {} }
    if (!CLEAN) {
      toast(editMode
        ? '编辑模式：点空白=建节点 · 点A再点B=连线 · 点关系线=改色改名 · 长按节点=删除 · 拖动=移动'
        : '已退出编辑模式（恢复拖动平移 / 缩放）');
    }
  }
  /* 标签贴到顶部工具栏下方、右对齐，避开右上角的其它按钮；文字完整换行，不再出现省略号 */
  function placeTag() {
    try {
      var top = 12, t = document.getElementById('tr');
      if (t) { var r = t.getBoundingClientRect(); if (r.bottom > 0) top = Math.round(r.bottom) + 8; }
      var p = document.getElementById('panel'), pw = (p && p.classList.contains('open') && window.innerWidth > 620) ? p.offsetWidth : 0;
      tag.style.top = top + 'px'; tag.style.bottom = 'auto'; tag.style.right = (pw + 10) + 'px';
    } catch (e) {}
  }
  function updateUI() {
    var d = YZY.graphData ? YZY.graphData() : { id: GID_MAIN, name: '', nodes: [], links: [] };
    tag.textContent = '当前图谱：' + (d.name || '主图谱') +
      '（' + (d.nodes || []).length + ' 节点 / ' + (d.links || []).length + ' 关系）' + (editMode ? ' · 编辑模式' : '');
    placeTag();
  }
  try { window.addEventListener('resize', function () { placeTag(); }); } catch (e) {}

  /* ================= 清屏模式：隐藏全部编辑 UI ================= */
  var cs = document.createElement('style'); cs.id = 'geStyle';
  cs.textContent = [
    '#geBar{position:fixed;right:10px;bottom:10px;z-index:99997;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:inherit}',
    '#geBar .ge-btn{padding:11px 15px;border-radius:11px;border:1px solid var(--panel-line);background:var(--panel-glass);color:var(--panel-text);' +
      'font-size:.78rem;cursor:pointer;font-family:inherit;white-space:nowrap;min-height:44px;touch-action:manipulation}',
    '#geBar .ge-btn.on{border-color:#f5c518;color:#f5c518}',
    '#geTag{position:fixed;right:8px;top:calc(8px + env(safe-area-inset-top,0px));left:auto;bottom:auto;z-index:6;padding:5px 9px;' +
      'border-radius:9px;background:var(--panel-glass);border:1px solid var(--panel-line);color:var(--panel-text);font-size:.62rem;line-height:1.45;font-family:inherit;' +
      'max-width:min(74vw,320px);white-space:normal;word-break:break-word;text-align:right;pointer-events:none;opacity:.94}',
    '#geEmpty{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;max-width:80vw;text-align:center;' +
      'background:var(--panel-glass);border:1px dashed var(--panel-line);border-radius:14px;padding:18px 36px 18px 20px;color:var(--panel-text);' +
      'font-size:.82rem;line-height:1.9;pointer-events:auto;font-family:inherit}',
    '#geEmpty .ge-x{position:absolute;top:6px;right:6px;width:26px;height:26px;padding:0;border-radius:50%;' +
      'border:1px solid var(--panel-line);background:var(--panel-glass);color:var(--panel-text);font:inherit;font-size:.78rem;line-height:1;cursor:pointer}',
    'body.clean #geBar,body.clean #geTag,body.clean #geEmpty,body.clean #geDlg{display:none!important}',
    /* 窄屏（手机）：工具栏移到屏幕右侧、竖向居中并收紧，避免压住底部搜索/筛选面板 */
    '@media(max-width:620px){',
    '  #geBar{right:6px;top:57%;bottom:auto;transform:translateY(-50%);gap:6px}',
    '  #geBar .ge-btn{padding:9px 10px;font-size:.68rem;min-height:40px;border-radius:12px}',
    '  #geTag{max-width:min(74vw,300px);font-size:.6rem;padding:4px 8px}',
    /* 介绍面板（下半屏浮层）打开时避让，防止互相压叠 */
    '  #panel.open~#geBar{opacity:0;pointer-events:none;transition:opacity .2s}',
    '}',
    /* 宽屏：右侧抽屉式面板打开时，工具栏左移避让 */
    '@media(min-width:621px){#panel.open~#geBar{right:calc(min(380px,88vw) + 12px)}}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(cs);

  var lastClean = null;
  function syncClean(force) {
    var c = !!(document.body && document.body.classList.contains('clean'));
    if (c === lastClean && !force) return;
    lastClean = c; CLEAN = c;
    bar.style.display = c ? 'none' : '';
    tag.style.display = c ? 'none' : '';
    if (c) {
      closeD();
      if (editMode) setMode(false);      // 清屏＝纯浏览
      if (emptyEl) emptyEl.style.display = 'none';
    } else {
      updateUI(); updateEmptyHint();
    }
  }
  var mo = null;
  try {
    mo = new MutationObserver(function () { syncClean(false); });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } catch (e) {}
  window.addEventListener('pagehide', function () { try { if (mo) mo.disconnect(); } catch (e) {} });

  /* ================= 启动 ================= */
  function boot() {
    try {
      var _gm = /[?&]g=([^&]+)/.exec(location.search);
      if (_gm && YZY.setActiveGraph) { try { YZY.setActiveGraph(decodeURIComponent(_gm[1])); } catch (e) {} }
    } catch (e) {}
    try {
      if (YZY.activeGraphId && YZY.activeGraphId() !== GID_MAIN) rebuild(true, true);
    } catch (e) { toast('载入图谱失败：' + e.message, true); }
    updateUI();
    syncClean(true);
    if (!CLEAN && /[?&]edit=1/.test(location.search)) setMode(true);
    try { if (window.draw) window.draw(); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.__geBoot = boot;
  window.__ge = {
    rebuild: rebuild, setMode: setMode, createNodeAt: createNodeAt, connectDialog: connectDialog,
    editEdge: editEdge, deleteNode: deleteNode, nodeSheet: nodeSheet, askEditNode: askEditNode,
    addRelationFrom: addRelationFrom, connectPickerGroups: connectPickerGroups,
    undo: undo, snapshot: snapshot,
    isEdit: function () { return editMode; }, stepLayout: stepLayout, runSettle: runSettle,
    updateEmptyHint: updateEmptyHint, layer: function () { return layer; }, bar: function () { return bar; },
    openGraphSheet: openGraphSheet, pickerSheet: pickerSheet, refCandidates: refCandidates,
    askNodeForm: askNodeForm, syncClean: syncClean, isClean: function () { return CLEAN; }
  };
})();
