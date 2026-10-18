/* =====================================================================
   学通 · 内容覆盖层（overlay）v2
   作用：允许“客户端自助添加/修改”内容，且【只影响本机】。
   加载顺序：data/*.js → data/overrides.js → assets/overlay.js → assets/app.js（→ assets/editor.js）
   两层来源（后者覆盖前者）：
     ① 官方覆盖：data/overrides.js 的 window.SITE_OVERRIDES（运营者发布，全站生效）
     ② 个人覆盖：本机存储（用户在浏览器/App 里自行增改）
   ★ v2 变更：
     - 存储层加固：写入后读回校验；localStorage 失败自动降级到
       sessionStorage → 内存 → Android App 原生桥（AndroidApp.storeGet/storeSet）
     - 支持“新增目录 / 删除目录”
     - 支持“人物头像（含本机上传）”——存 dataURL，严格白名单校验
     - 支持“新增人物 / 移动人物 / 改介绍”
     - 支持“关系图谱编辑”：新建图谱、加节点、连边、关系线颜色与命名、删节点/删边
     - 所有来源（本机存储 / 官方 / 导入 JSON）进入 apply 前一律过 normalize()
   ===================================================================== */
(function () {
  'use strict';

  var KEY = 'yzy_ov_v1';
  var MAX = 4000;              // 单条文本上限
  var AV_MAX = 400000;         // 头像 dataURL 上限（约 300KB 二进制）
  var GID_MAIN = 'main';
  var GROUPS_PERSON = ['leaders', 'comrades', 'critics'];
  /* 内置图谱注册表（随站点/App 发布，不可删除 / 改名；仍可被本地覆盖层编辑） */
  function builtinGraphs() {
    var m = {};
    var W = window.SITE_GRAPH_WENGE;
    if (W && Array.isArray(W.nodes)) m.wenge = { name: (W.name || '文革图谱'), get: function () { return W; } };
    /* 世界图谱：与「主图谱」同一批人物/思想/组织，但落到真实世界经纬度（geo）。
       单列为一个内置图谱，避免和主图谱（纯关系网）互相争夺视图模式。 */
    m.world = {
      name: '世界图谱',
      get: function () {
        /* 世界图谱 = 独立数据集（data/graph-world.js：节点已带真实经纬度），
           不再依赖运行时注入，避免与主图谱互相影响。 */
        var W = window.SITE_GRAPH_WORLD;
        return (W && Array.isArray(W.nodes)) ? W : { nodes: [], links: [] };
      }
    };
    return m;
  }

  window.__YZY_OVERLAY_V = 2;

  /* ================= 净化 ================= */
  function clean(s, max) {
    s = (s === null || s === undefined) ? '' : String(s);
    s = s.replace(/<[^>]*>/g, '');                                   // 整段去 HTML 标签
    s = s.replace(/[<>]/g, '');                                      // 去残余尖括号
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');  // 去控制字符
    s = s.replace(/javascript:/gi, '');
    if (max && s.length > max) s = s.slice(0, max);
    return s.trim();
  }
  function cleanUrl(u) {
    u = clean(u, 500);
    if (!u) return '';
    if (/^(https?:|\.|\/|#|books\/|audio\/|images\/|assets\/)/i.test(u)) return u;
    return '';
  }
  function cleanList(a, max, cap) {
    if (!Array.isArray(a)) return [];
    var out = [];
    for (var i = 0; i < a.length && out.length < (cap || 30); i++) {
      var v = clean(a[i], max || 300);
      if (v) out.push(v);
    }
    return out;
  }
  /* 头像：只放行 data:image/*;base64 或站内相对路径 */
  function cleanAvatar(s) {
    s = (s === null || s === undefined) ? '' : String(s);
    if (!s) return '';
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) {
      return s.length > AV_MAX ? '' : s;
    }
    return cleanUrl(s);
  }
  function cleanColor(c) {
    c = (c === null || c === undefined) ? '' : String(c).trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
    if (/^rgba?\(\s*[\d.\s,%]+\)$/.test(c)) return c;
    return '';
  }
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return {}; } }
  function uid(p) { return (p || 'u') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ================= 存储层（多级降级 + 写后读回校验） ================= */
  var mem = {};
  var S_backend = 'memory';
  var S_warn = '';

  function probe() {
    var k = '__yzyp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    try {
      localStorage.setItem(k, '1');
      var ok = localStorage.getItem(k) === '1';
      localStorage.removeItem(k);
      return ok;
    } catch (e) { return false; }
  }
  function rawGet() {
    try { var v = localStorage.getItem(KEY); if (v !== null) return v; } catch (e) {}
    try { var v2 = sessionStorage.getItem(KEY); if (v2 !== null) return v2; } catch (e) {}
    if (mem[KEY] !== undefined) return mem[KEY];
    try {
      if (window.AndroidApp && window.AndroidApp.storeGet) {
        var v3 = window.AndroidApp.storeGet(KEY);
        if (v3 !== null && v3 !== undefined && v3 !== '') return String(v3);
      }
    } catch (e) {}
    return null;
  }
  function rawSet(str) {
    // 1) localStorage（写后读回）
    try {
      localStorage.setItem(KEY, str);
      if (localStorage.getItem(KEY) === str) { S_backend = 'localStorage'; S_warn = ''; return true; }
    } catch (e) { S_warn = (e && e.name) + ':' + (e && e.message); }
    // 2) sessionStorage
    try {
      sessionStorage.setItem(KEY, str);
      if (sessionStorage.getItem(KEY) === str) { S_backend = 'sessionStorage'; S_warn += ' 已降级到会话存储（关页即失效）'; return true; }
    } catch (e) {}
    // 3) App 原生桥（持久化到 App 私有目录）
    try {
      if (window.AndroidApp && window.AndroidApp.storeSet) {
        window.AndroidApp.storeSet(KEY, str);
        var back = window.AndroidApp.storeGet(KEY);
        if (back === str) { S_backend = 'android-bridge'; S_warn += ' 已降级到 App 存储'; return true; }
      }
    } catch (e) {}
    // 4) 内存（仅本次会话有效，明确告警）
    mem[KEY] = str; S_backend = 'memory';
    S_warn += ' 存储不可用，改动只在本次浏览有效';
    return false;
  }
  function storageInfo() {
    return { backend: S_backend, warn: S_warn, ok: S_backend !== 'memory' };
  }
  if (probe()) { S_backend = 'localStorage'; } else { S_warn = 'localStorage 不可用'; }

  /* ================= 结构 ================= */
  function empty() {
    return {
      v: 3,
      editor: { enabled: false, userSet: false },   // ★ 默认关闭：需用户手动开启
      resources: { added: [], edited: {}, removed: [], catLabels: {}, catAdded: [], catRemoved: [] },
      people: { edited: {}, moved: {}, added: [], avatars: {} },
      hubLabels: {}, hubName: '',
      graphs: {
        created: {},            // gid -> {id,name,createdAt,nodes:[],links:[]}
        removed: [],            // 被删掉的内置图谱 id（预留）
        active: GID_MAIN,
        nodeAdd: {}, edgeAdd: {},   // gid -> [ ... ]
        nodeStyle: {}, edgeStyle: {},   // gid -> { key: {...} }
        nodePos: {},                // gid -> { id: {x,y} }
        nodeRemove: {}, edgeRemove: {}  // gid -> [ ... ]
      }
    };
  }
  function sub(o, k, d) { if (!o[k] || typeof o[k] !== 'object') o[k] = d; return o[k]; }

  /* ================= 归一化（任何来源进入 apply 前必过） ================= */
  function normRes(rec) {
    rec = rec || {};
    return {
      id: clean(rec.id, 60) || uid('r'), title: clean(rec.title, 200), author: clean(rec.author, 120),
      cat: clean(rec.cat, 40) || '参考', icon: clean(rec.icon, 8) || '📄',
      tags: cleanList(rec.tags, 30, 12), desc: clean(rec.desc, 300), intro: clean(rec.intro, MAX),
      note: clean(rec.note, 600), url: cleanUrl(rec.url), fmt: clean(rec.fmt, 20) || '—',
      src: clean(rec.src, 60) || '读者补充', status: 'ok', hot: 0, size: clean(rec.size, 20) || '—',
      date: clean(rec.date, 20) || new Date().toISOString().slice(0, 10)
    };
  }
  function normEdit(p) {
    p = p || {}; var q = {};
    ['title', 'author', 'cat', 'icon', 'desc', 'intro', 'note', 'fmt', 'src'].forEach(function (k) {
      if (p[k] !== undefined) q[k] = clean(p[k], k === 'intro' ? MAX : 300);
    });
    if (p.url !== undefined) q.url = cleanUrl(p.url);
    if (p.tags !== undefined) q.tags = cleanList(p.tags, 30, 12);
    return q;
  }
  function normPerson(p) {
    p = p || {}; var q = {};
    if (p.intro !== undefined) q.intro = clean(p.intro, MAX);
    if (p.role !== undefined) q.role = clean(p.role, 200);
    if (p.works !== undefined) q.works = clean(p.works, 600);
    if (p.years !== undefined) q.years = clean(p.years, 40);
    if (p.points !== undefined) q.points = cleanList(p.points, 300, 20);
    if (p.avatar !== undefined) q.avatar = cleanAvatar(p.avatar);
    return q;
  }
  function normNode(n) {
    n = n || {};
    var t = (n.type === 'idea' || n.type === 'org' || n.type === 'event') ? n.type : 'person';
    return {
      id: clean(n.id, 60) || uid('n'), name: clean(n.name, 80), type: t,
      years: clean(n.years, 40), role: clean(n.role, 200), desc: clean(n.desc, MAX),
      img: cleanAvatar(n.img), crit: !!n.crit, color: cleanColor(n.color)
    };
  }
  function normEdge(e) {
    e = e || {};
    var key = clean(e.source, 60) + '|' + clean(e.target, 60) + '|' + clean(e.rel, 40);
    return { source: clean(e.source, 60), target: clean(e.target, 60), rel: clean(e.rel, 40), color: cleanColor(e.color), key: key };
  }
  /* 原型污染防护：任何外部 JSON（导入/存储）进入 apply 前，剔除 __proto__/constructor/prototype */
  function stripProto(o) {
    if (!o || typeof o !== 'object') return o;
    if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) stripProto(o[i]); return o; }
    ['__proto__', 'constructor', 'prototype'].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(o, k)) { try { delete o[k]; } catch (e) {} }
    });
    Object.keys(o).forEach(function (k) { stripProto(o[k]); });
    return o;
  }
  function normalize(OV) {
    stripProto(OV);
    OV = OV || empty();
    var srcV = (typeof OV.v === 'number') ? OV.v : 0;
    sub(OV, 'editor', { enabled: false, userSet: false });
    OV.editor.enabled = (OV.editor.enabled === true);
    OV.editor.userSet = (OV.editor.userSet === true);
    // 旧版数据（v<3）默认开启过：一次性改为默认关闭，用户需重新手动开启
    if (!OV.editor.userSet && srcV < 3) OV.editor.enabled = false;
    OV.v = 3;

    sub(OV, 'resources', {});
    var R = OV.resources;
    R.added = (Array.isArray(R.added) ? R.added : []).map(normRes).filter(function (x) { return x.title; });
    var e = {}, eo = R.edited || {};
    Object.keys(eo).forEach(function (k) { var id = clean(k, 60); if (id) e[id] = normEdit(eo[k]); });
    R.edited = e;
    R.removed = (Array.isArray(R.removed) ? R.removed : []).map(function (x) { return clean(x, 60); }).filter(Boolean);
    var cl = {}, co = R.catLabels || {};
    Object.keys(co).forEach(function (k) { var a = clean(k, 40), b = clean(co[k], 40); if (a && b) cl[a] = b; });
    R.catLabels = cl;
    R.catAdded = cleanList(R.catAdded, 40, 60);
    R.catRemoved = cleanList(R.catRemoved, 40, 60);

    sub(OV, 'people', {});
    var P = OV.people;
    var pe = {}, peo = P.edited || {};
    Object.keys(peo).forEach(function (k) { var kk = clean(k, 80); if (kk) pe[kk] = normPerson(peo[k]); });
    P.edited = pe;
    var pm = {}, pmo = P.moved || {};
    Object.keys(pmo).forEach(function (k) {
      var a = k.split('|')[0], b = clean(pmo[k], 20);
      if (GROUPS_PERSON.indexOf(a) >= 0 && GROUPS_PERSON.indexOf(b) >= 0) pm[clean(k, 80)] = b;
    });
    P.moved = pm;
    P.added = (Array.isArray(P.added) ? P.added : []).map(function (x) {
      x = x || {};
      var g = GROUPS_PERSON.indexOf(clean(x.group, 20)) >= 0 ? clean(x.group, 20) : 'comrades';
      return { key: clean(x.key, 80) || uid('p'), name: clean(x.name, 80), group: g,
        years: clean(x.years, 40), role: clean(x.role, 200), intro: clean(x.intro, MAX),
        works: clean(x.works, 600), points: cleanList(x.points, 300, 20), avatar: cleanAvatar(x.avatar) };
    }).filter(function (x) { return x.name; });
    var av = {}, avo = P.avatars || {};
    Object.keys(avo).forEach(function (k) { var kk = clean(k, 80), v = cleanAvatar(avo[k]); if (kk && v) av[kk] = v; });
    P.avatars = av;

    sub(OV, 'hubLabels', {});
    var hl = {}, hlo = OV.hubLabels;
    Object.keys(hlo).forEach(function (k) { var a = clean(k, 20), b = clean(hlo[k], 40); if (a && b) hl[a] = b; });
    OV.hubLabels = hl;
    OV.hubName = clean(OV.hubName, 40);

    sub(OV, 'graphs', {});
    var G = OV.graphs;
    sub(G, 'created', {}); sub(G, 'removed', []); sub(G, 'nodeAdd', {}); sub(G, 'edgeAdd', {});
    sub(G, 'nodeStyle', {}); sub(G, 'edgeStyle', {}); sub(G, 'nodePos', {}); sub(G, 'nodeRemove', {}); sub(G, 'edgeRemove', {});
    var cr = {}, cro = G.created;
    Object.keys(cro).forEach(function (gid) {
      var g = cro[gid] || {}; var id = clean(gid, 40) || uid('g');
      if (id === GID_MAIN) return;
      cr[id] = { id: id, name: clean(g.name, 60) || '新图谱', createdAt: (typeof g.createdAt === 'number' ? g.createdAt : Date.now()),
        nodes: (Array.isArray(g.nodes) ? g.nodes : []).map(normNode).filter(function (n) { return n.name; }),
        links: (Array.isArray(g.links) ? g.links : []).map(normEdge).filter(function (x) { return x.source && x.target; }) };
    });
    G.created = cr;
    G.removed = (Array.isArray(G.removed) ? G.removed : []).map(function (x) { return clean(x, 40); }).filter(Boolean);
    G.active = clean(G.active, 40) || GID_MAIN;
    if (G.active !== GID_MAIN && !G.created[G.active]) G.active = GID_MAIN;
    ['nodeAdd', 'edgeAdd'].forEach(function (k) {
      var m = {}, so = G[k];
      Object.keys(so).forEach(function (gid) {
        var arr = Array.isArray(so[gid]) ? so[gid] : [];
        m[clean(gid, 40)] = (k === 'nodeAdd') ? arr.map(normNode).filter(function (n) { return n.name; }) : arr.map(normEdge).filter(function (x) { return x.source && x.target; });
      });
      G[k] = m;
    });
    ['nodeStyle', 'nodePos', 'edgeStyle'].forEach(function (k) {
      var m = {}, so = G[k];
      Object.keys(so).forEach(function (gid) { var o = so[gid]; m[clean(gid, 40)] = (o && typeof o === 'object') ? o : {}; });
      G[k] = m;
    });
    ['nodeRemove', 'edgeRemove'].forEach(function (k) {
      var m = {}, so = G[k];
      Object.keys(so).forEach(function (gid) {
        m[clean(gid, 40)] = cleanList(so[gid], 60, 2000);
      });
      G[k] = m;
    });
    return OV;
  }

  /* ================= 读两层覆盖 ================= */
  function official() {
    var s = window.SITE_OVERRIDES;
    return (s && typeof s === 'object') ? s : null;
  }
  function stored() {
    var raw = rawGet();
    if (!raw) return null;
    try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; }
  }
  function merge(a, b) {
    if (!a) { return b ? clone(b) : empty(); }
    if (!b) { return clone(a); }
    var r = clone(a);
    // resources
    r.resources = r.resources || {}; var bb = b.resources || {};
    r.resources.added = (r.resources.added || []).concat(bb.added || []);
    r.resources.edited = Object.assign({}, r.resources.edited || {}, bb.edited || {});
    r.resources.removed = (r.resources.removed || []).concat(bb.removed || []);
    r.resources.catLabels = Object.assign({}, r.resources.catLabels || {}, bb.catLabels || {});
    r.resources.catAdded = (r.resources.catAdded || []).concat(bb.catAdded || []);
    r.resources.catRemoved = (r.resources.catRemoved || []).concat(bb.catRemoved || []);
    // people
    r.people = r.people || {}; var pb = b.people || {};
    r.people.edited = Object.assign({}, r.people.edited || {}, pb.edited || {});
    r.people.moved = Object.assign({}, r.people.moved || {}, pb.moved || {});
    r.people.added = (r.people.added || []).concat(pb.added || []);
    r.people.avatars = Object.assign({}, r.people.avatars || {}, pb.avatars || {});
    // hub
    r.hubLabels = Object.assign({}, r.hubLabels || {}, b.hubLabels || {});
    if (b.hubName) r.hubName = b.hubName;
    if (b.editor) r.editor = { enabled: (b.editor.enabled === true), userSet: (b.editor.userSet === true) };
    // graphs
    var ga = r.graphs || empty().graphs, gb = b.graphs || {};
    ga.created = Object.assign({}, ga.created || {}, gb.created || {});
    ga.removed = (ga.removed || []).concat(gb.removed || []);
    if (gb.active) ga.active = gb.active;
    ['nodeAdd', 'edgeAdd', 'nodeRemove', 'edgeRemove'].forEach(function (k) {
      var m = ga[k] || {};
      Object.keys(gb[k] || {}).forEach(function (gid) { m[gid] = (m[gid] || []).concat(gb[k][gid] || []); });
      ga[k] = m;
    });
    ['nodeStyle', 'edgeStyle', 'nodePos'].forEach(function (k) {
      var m = ga[k] || {};
      Object.keys(gb[k] || {}).forEach(function (gid) { m[gid] = Object.assign({}, m[gid] || {}, gb[k][gid] || {}); });
      ga[k] = m;
    });
    r.graphs = ga;
    return r;
  }

  /* ================= 应用到数据（原地） ================= */
  function applyResources(OV) {
    var R = window.SITE_RESOURCES;
    if (!Array.isArray(R)) return;
    var i, k, e;
    if (OV.resources.removed.length) {
      for (i = R.length - 1; i >= 0; i--) if (OV.resources.removed.indexOf(R[i].id) >= 0) R.splice(i, 1);
    }
    var ed = OV.resources.edited;
    for (i = 0; i < R.length; i++) {
      e = ed[R[i].id];
      if (e) for (k in e) if (Object.prototype.hasOwnProperty.call(e, k)) R[i][k] = clone(e[k]);
    }
    for (i = 0; i < OV.resources.added.length; i++) {
      if (!R.some(function (x) { return x.id === OV.resources.added[i].id; })) R.push(clone(OV.resources.added[i]));
    }
    if (OV.resources.catLabels) {
      for (i = 0; i < R.length; i++) if (R[i].cat && OV.resources.catLabels[R[i].cat]) R[i].cat = OV.resources.catLabels[R[i].cat];
    }
  }

  function personGroups() {
    var CT = window.SITE_CONTENT || {}, EX = window.SITE_EXTRA || {};
    return { leaders: CT.leaders, comrades: CT.comrades, critics: EX.critics };
  }
  function applyPeople(OV) {
    var groups = personGroups();
    // ① 新增人物
    OV.people.added.forEach(function (p) {
      var arr = groups[p.group];
      if (!Array.isArray(arr)) return;
      if (arr.some(function (x) { return x && x.name === p.name; })) return;
      var rec = { name: p.name, years: p.years, role: p.role, intro: p.intro, desc: p.intro,
        works: p.works, points: p.points, src: '读者补充' };
      if (p.avatar) rec.img = p.avatar;
      arr.push(rec);
    });
    // ② 移动
    Object.keys(OV.people.moved).forEach(function (key) {
      var pr = key.split('|'), from = pr[0], name = pr[1], to = OV.people.moved[key];
      if (GROUPS_PERSON.indexOf(from) < 0 || GROUPS_PERSON.indexOf(to) < 0 || from === to) return;
      var src = groups[from], dst = groups[to];
      if (!Array.isArray(src) || !Array.isArray(dst)) return;
      for (var i = src.length - 1; i >= 0; i--) {
        if (src[i] && src[i].name === name) { dst.push(src.splice(i, 1)[0]); break; }
      }
    });
    // ③ 改介绍
    Object.keys(OV.people.edited).forEach(function (key) {
      var pr = key.split('|'), g = pr[0], name = pr[1];
      var arr = groups[g];
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].name === name) {
          var e = OV.people.edited[key];
          for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) {
            if (k === 'avatar') { if (e[k]) arr[i].img = e[k]; }
            else arr[i][k] = clone(e[k]);
          }
          break;
        }
      }
    });
    // ④ 头像（按 组|姓名 或 节点id）
    Object.keys(OV.people.avatars).forEach(function (k) {
      var v = OV.people.avatars[k]; if (!v) return;
      if (k.indexOf('n|') === 0) {
        var nid = k.slice(2), GN = (window.SITE_GRAPH && window.SITE_GRAPH.nodes) || [];
        for (var j = 0; j < GN.length; j++) if (GN[j].id === nid) { GN[j].img = v; break; }
        return;
      }
      var parts = k.split('|'), g2 = parts[0], nm = parts[1], arr2 = groups[g2];
      if (!Array.isArray(arr2)) return;
      for (var m = 0; m < arr2.length; m++) if (arr2[m] && arr2[m].name === nm) { arr2[m].img = v; break; }
    });
  }

  function captureBaseGraph() {
    if (window.__YZY_BASE_GRAPH) return;
    var GR = window.SITE_GRAPH;
    if (!GR || !Array.isArray(GR.nodes)) return;
    try { window.__YZY_BASE_GRAPH = clone({ nodes: GR.nodes, links: GR.links || [] }); } catch (e) {}
  }
  function applyGraphToSiteGraph(OV) {
    var GR = window.SITE_GRAPH;
    if (!GR || !Array.isArray(GR.nodes)) return;
    captureBaseGraph();
    var base = window.__YZY_BASE_GRAPH;
    if (!base) return;
    var gid = GID_MAIN;
    function arr(map) { return (OV.graphs[map] && OV.graphs[map][gid]) || []; }
    var rmN = {}, rmE = {};
    arr('nodeRemove').forEach(function (id) { rmN[id] = 1; });
    arr('edgeRemove').forEach(function (k) { rmE[k] = 1; });

    /* ① 每次都从“冻结的内置基线”重新构建 —— 纯函数式，天然幂等，
          不再往 SITE_GRAPH 里累加（那是“反复编辑后漂移/丢失”的根源） */
    var nodes = [], byId = {};
    (base.nodes || []).forEach(function (n) {
      if (rmN[n.id]) return;
      var c = clone(n); nodes.push(c); byId[c.id] = c;
    });
    var links = [], seen = {};
    function pushLink(l) {
      var k = (l.source || '') + '|' + (l.target || '') + '|' + (l.rel || '');
      if (rmE[k] || seen[k]) return;
      seen[k] = 1; links.push(l);
    }
    (base.links || []).forEach(function (l) {
      if (rmN[l.source] || rmN[l.target]) return;
      pushLink(clone(l));
    });

    /* ② 新增节点：按 id upsert（不重复 push） */
    arr('nodeAdd').forEach(function (n) {
      if (!n || !n.id || rmN[n.id]) return;
      var c = byId[n.id], k;
      if (c) { for (k in n) if (Object.prototype.hasOwnProperty.call(n, k)) c[k] = clone(n[k]); }
      else { var nc = clone(n); nodes.push(nc); byId[nc.id] = nc; }
    });

    /* ③ 新增边：按 key 去重 */
    arr('edgeAdd').forEach(function (e) {
      if (!e || !byId[e.source] || !byId[e.target]) return;
      pushLink(clone(e));
    });

    /* ④ 边样式（以 base 为底覆盖，不读上一轮结果） */
    var es = (OV.graphs.edgeStyle && OV.graphs.edgeStyle[gid]) || {};
    links.forEach(function (l) {
      var st = es[l.source + '|' + l.target + '|' + (l.rel || '')];
      if (st) { if (st.color) l.color = st.color; if (st.label) l.rel = st.label; }
    });

    /* ⑤ 节点样式 */
    var nst = (OV.graphs.nodeStyle && OV.graphs.nodeStyle[gid]) || {};
    nodes.forEach(function (n) {
      var st = nst[n.id]; if (!st) return;
      if (st.color) n.color = st.color;
      if (st.name) n.name = st.name;
    });

    /* ⑥ ★ 位置最后写回节点 —— “主图谱编辑后不保存”的真凶就是这里曾没写 */
    var pos = (OV.graphs.nodePos && OV.graphs.nodePos[gid]) || {};
    Object.keys(pos).forEach(function (id) {
      var n = byId[id];
      if (n && pos[id]) { n.x = pos[id].x; n.y = pos[id].y; }
    });

    GR.nodes = nodes; GR.links = links;
  }

  function applyLabels(OV) {
    window.__YZY_HUB_LABELS = OV.hubLabels || {};
    if (OV.hubName) window.__YZY_HUB_NAME = OV.hubName;
  }

  /* ================= 对外 API ================= */
  var S = null;
  function load() {
    var off = normalize(official());
    var per = normalize(stored());
    var base = merge(off, per);
    S = normalize(base);
    return S;
  }
  function persist() {
    var ok = rawSet(JSON.stringify(S));
    if (!ok && window.console) console.warn('[YZY] 存储降级：', S_warn);
    return ok;
  }
  function reapply() {
    load();
    applyResources(S);
    applyPeople(S);
    applyGraphToSiteGraph(S);
    applyLabels(S);
    /* 覆盖层（含导入的备份）刚合并完，立刻净化一次，避免把 HTML 带进页面 */
    try { if (window.yzCleanData) window.yzCleanData(); } catch (e) {}
    return S;
  }
  window.YZY = {
    version: 2,
    sanitize: clean,
    storage: storageInfo,
    state: function () { return clone(S); },

    /* ---- 总开关 ---- */
    editorEnabled: function () { return S.editor.enabled === true; },
    setEditorEnabled: function (on) { S.editor = { enabled: !!on, userSet: true }; persist(); return true; },

    /* ---- 资源导航 ---- */
    addResource: function (obj) {
      obj = obj || {};
      var rec = normRes(obj);
      if (!rec.title) return { ok: false, msg: '标题不能为空' };
      if (S.resources.added.some(function (x) { return x.id === rec.id; })) rec.id = uid('r');
      S.resources.added.push(rec); persist();
      return { ok: true, id: rec.id, backend: S_backend };
    },
    editResource: function (id, patch) {
      patch = patch || {}; var p = normEdit(patch);
      for (var i = 0; i < S.resources.added.length; i++) {
        if (S.resources.added[i].id === id) { Object.assign(S.resources.added[i], p); persist(); return { ok: true }; }
      }
      S.resources.edited[id] = Object.assign(S.resources.edited[id] || {}, p);
      persist(); return { ok: true };
    },
    removeResource: function (id) {
      S.resources.added = S.resources.added.filter(function (x) { return x.id !== id; });
      if (S.resources.removed.indexOf(id) < 0) S.resources.removed.push(id);
      delete S.resources.edited[id];
      persist(); return { ok: true };
    },
    restoreResource: function (id) {
      S.resources.removed = S.resources.removed.filter(function (x) { return x !== id; });
      persist(); return { ok: true };
    },
    moveResource: function (id, toCat) { return this.editResource(id, { cat: clean(toCat, 40) }); },

    /* ---- 目录（分类）---- */
    renameCat: function (from, to) {
      from = clean(from, 40); to = clean(to, 40);
      if (!from || !to || from === to) return { ok: false, msg: '名称无效或未变化' };
      S.resources.catLabels[from] = to;
      S.resources.catAdded = S.resources.catAdded.map(function (x) { return x === from ? to : x; });
      (S.resources.added || []).forEach(function (x) { if (x.cat === from) x.cat = to; });
      persist(); return { ok: true };
    },
    addCat: function (name) {
      name = clean(name, 40);
      if (!name) return { ok: false, msg: '目录名不能为空' };
      var exists = S.resources.catAdded.indexOf(name) >= 0;
      if (!exists) S.resources.catAdded.push(name);
      S.resources.catRemoved = S.resources.catRemoved.filter(function (x) { return x !== name; });
      persist(); return { ok: true };
    },
    removeCat: function (name) {
      name = clean(name, 40); if (!name) return { ok: false };
      S.resources.catAdded = S.resources.catAdded.filter(function (x) { return x !== name; });
      if (S.resources.catRemoved.indexOf(name) < 0) S.resources.catRemoved.push(name);
      delete S.resources.catLabels[name];
      persist(); return { ok: true };
    },

    /* ---- 人物 ---- */
    editPerson: function (group, name, patch) {
      var key = group + '|' + name, p = normPerson(patch);
      S.people.edited[key] = Object.assign(S.people.edited[key] || {}, p);
      persist(); return { ok: true };
    },
    addPerson: function (obj) {
      obj = obj || {};
      var name = clean(obj.name, 80);
      if (!name) return { ok: false, msg: '姓名不能为空' };
      var g = GROUPS_PERSON.indexOf(obj.group) >= 0 ? obj.group : 'comrades';
      if (g === 'leaders') return { ok: false, msg: '「革命导师」为内置固定的五位，不接受新增；请改添加到「革命同志」或「被批判人物」' };
      var rec = { key: uid('p'), name: name, group: g, years: clean(obj.years, 40), role: clean(obj.role, 200),
        intro: clean(obj.intro, MAX), works: clean(obj.works, 600), points: cleanList(obj.points, 300, 20),
        avatar: cleanAvatar(obj.avatar) };
      S.people.added.push(rec); persist();
      return { ok: true, key: rec.key, backend: S_backend };
    },
    removePersonAdded: function (key) { S.people.added = S.people.added.filter(function (x) { return x.key !== key; }); persist(); return { ok: true }; },
    movePerson: function (fromGroup, name, toGroup) {
      if (fromGroup === toGroup) return { ok: false };
      if (GROUPS_PERSON.indexOf(toGroup) < 0) return { ok: false, msg: '目标目录不合法' };
      S.people.moved[fromGroup + '|' + name] = toGroup; persist(); return { ok: true };
    },
    undoMovePerson: function (fromGroup, name) { delete S.people.moved[fromGroup + '|' + name]; persist(); return { ok: true }; },
    setAvatar: function (key, dataUrl) {
      key = clean(key, 80);
      if (!key) return { ok: false, msg: '缺少标识' };
      var raw = (dataUrl === null || dataUrl === undefined) ? '' : String(dataUrl);
      if (!raw) { delete S.people.avatars[key]; persist(); return { ok: true, cleared: true }; }
      var v = cleanAvatar(raw);
      if (!v) return { ok: false, msg: '头像格式不被接受（仅支持 png/jpg/webp/gif，且不超过约 300KB）' };
      S.people.avatars[key] = v; persist();
      return { ok: true, size: v.length };
    },
    getAvatar: function (key) { return S.people.avatars[clean(key, 80)] || ''; },

    /* ---- 栏目改名 ---- */
    setHubLabel: function (key, title) {
      key = clean(key, 20); title = clean(title, 40);
      if (!key || !title) return { ok: false, msg: '无效' };
      S.hubLabels[key] = title; persist(); return { ok: true };
    },
    setHubName: function (n) { S.hubName = clean(n, 40); persist(); return { ok: true }; },
    getHubLabel: function (key, fallback) { return S.hubLabels[key] || fallback; },

    /* ================= 关系图谱 ================= */
    listGraphs: function () {
      var out = [{ id: GID_MAIN, name: '主图谱（内置）', builtin: true }];
      var BA = builtinGraphs();
      Object.keys(BA).forEach(function (id) {
        var d = BA[id].get() || { nodes: [], links: [] };
        out.push({ id: id, name: BA[id].name + '（内置）', builtin: true, nodes: (d.nodes || []).length, links: (d.links || []).length });
      });
      Object.keys(S.graphs.created).forEach(function (gid) {
        out.push({ id: gid, name: S.graphs.created[gid].name, builtin: false, nodes: S.graphs.created[gid].nodes.length, links: S.graphs.created[gid].links.length });
      });
      return out;
    },
    activeGraphId: function () { return S.graphs.active; },
    setActiveGraph: function (gid) {
      gid = clean(gid, 40);
      if (gid !== GID_MAIN && !builtinGraphs()[gid] && !S.graphs.created[gid]) return { ok: false, msg: '图谱不存在' };
      S.graphs.active = gid; persist(); return { ok: true };
    },
    newGraph: function (name) {
      name = clean(name, 60) || '新图谱';
      var gid = uid('g');
      S.graphs.created[gid] = { id: gid, name: name, createdAt: Date.now(), nodes: [], links: [] };
      S.graphs.active = gid; persist();
      return { ok: true, id: gid, name: name };
    },
    /* 从 JSON 导入一张图谱 → 建为「自定义图谱」（只存本机）。
       容错：节点缺 id/name 丢弃并去重；关系两端必须存在于节点表，否则丢弃（不产生悬空边）；
       重名自动加序号。返回 { ok, id, name, nodes, links, saved }。 */
    importGraph: function (obj) {
      try {
        stripProto(obj);
        if (!obj || typeof obj !== 'object') return { ok: false, msg: '不是有效的图谱 JSON' };
        var raw = Array.isArray(obj.nodes) ? obj.nodes : null;
        if (!raw) return { ok: false, msg: '缺少 nodes 数组' };
        var on = [];
        raw.forEach(function (n) {
          if (!n || typeof n !== 'object') return;
          var id = clean(n.id, 60), nm = clean(n.name, 80);
          if (!id || !nm) return;
          if (on.some(function (x) { return x.id === id; })) return;
          var t = (n.type === 'idea' || n.type === 'org' || n.type === 'event') ? n.type : 'person';
          on.push({ id: id, name: nm, type: t,
            years: clean(n.years, 40), role: clean(n.role, 200), desc: clean(n.desc, MAX),
            img: cleanAvatar(n.img), crit: !!n.crit, color: cleanColor(n.color),
            points: cleanList(n.points, 300, 20), works: cleanList(n.works, 200, 40), tags: cleanList(n.tags, 40, 20) });
        });
        if (!on.length) return { ok: false, msg: '没有可用的节点（每条至少要有 id 与 name）' };
        var ids = {}; on.forEach(function (n) { ids[n.id] = 1; });
        var ol = [];
        (Array.isArray(obj.links) ? obj.links : []).forEach(function (l) {
          if (!l || typeof l !== 'object') return;
          var s = clean(l.source, 60), t = clean(l.target, 60);
          if (!s || !t || !ids[s] || !ids[t]) return;
          var rel = clean(l.rel, 40) || '相关';
          var k = s + '|' + t + '|' + rel;
          if (ol.some(function (x) { return x.key === k; })) return;
          ol.push({ source: s, target: t, rel: rel, color: cleanColor(l.color), key: k });
        });
        var name = clean(obj.name, 60) || '导入的图谱';
        var taken = {}; Object.keys(S.graphs.created).forEach(function (g) { taken[S.graphs.created[g].name] = 1; });
        if (taken[name]) { var base = name, i = 2; while (taken[base + '（' + i + '）']) i++; name = base + '（' + i + '）'; }
        var gid = uid('g');
        S.graphs.created[gid] = { id: gid, name: name, createdAt: Date.now(), nodes: on, links: ol };
        S.graphs.active = gid;
        var saved = persist();
        return { ok: true, id: gid, name: name, nodes: on.length, links: ol.length, saved: saved };
      } catch (e) { return { ok: false, msg: '导入失败：' + ((e && e.message) ? e.message : e) }; }
    },
    renameGraph: function (gid, name) {
      gid = clean(gid, 40); name = clean(name, 60);
      if (!S.graphs.created[gid] || !name) return { ok: false };
      S.graphs.created[gid].name = name; persist(); return { ok: true };
    },
    deleteGraph: function (gid) {
      gid = clean(gid, 40);
      if (!S.graphs.created[gid]) return { ok: false, msg: '只能删除自定义图谱' };
      delete S.graphs.created[gid];
      Object.keys(S.graphs.nodeAdd).forEach(function (g) { if (g === gid) delete S.graphs.nodeAdd[g]; });
      Object.keys(S.graphs.edgeAdd).forEach(function (g) { if (g === gid) delete S.graphs.edgeAdd[g]; });
      if (S.graphs.active === gid) S.graphs.active = GID_MAIN;
      persist(); return { ok: true };
    },
    /* 当前图谱数据（供 graph.html 渲染） */
    graphData: function (gid) {
      gid = clean(gid || S.graphs.active, 40);
      var nodes, links, name, kinds, refs, mapOnly = false;
      if (gid === GID_MAIN) {
        var G0 = window.SITE_GRAPH || { nodes: [], links: [] };
        nodes = (G0.nodes || []).map(function (n) { return clone(n); });
        links = (G0.links || []).map(function (l) { return clone(l); });
        name = '主图谱';
      } else if (builtinGraphs()[gid]) {
        var bg = builtinGraphs()[gid].get() || { nodes: [], links: [] };
        nodes = (bg.nodes || []).map(function (n) { return clone(n); });
        links = (bg.links || []).map(function (l) { return clone(l); });
        name = builtinGraphs()[gid].name;
        kinds = bg.kinds || null; refs = bg.refs || null; mapOnly = !!bg.mapOnly;
      } else {
        var g = S.graphs.created[gid];
        if (!g) return { id: gid, name: '（不存在）', nodes: [], links: [] };
        nodes = g.nodes.map(function (n) { return clone(n); });
        links = g.links.map(function (l) { return clone(l); });
        name = g.name;
      }
      // 叠加增量编辑
      var rmN = (S.graphs.nodeRemove[gid] || []), rmE = (S.graphs.edgeRemove[gid] || []);
      if (rmN.length) nodes = nodes.filter(function (n) { return rmN.indexOf(n.id) < 0; });
      (S.graphs.nodeAdd[gid] || []).forEach(function (n) {
        if (!nodes.some(function (x) { return x.id === n.id; })) nodes.push(clone(n));
      });
      if (rmE.length) links = links.filter(function (l) { return rmE.indexOf((l.source || '') + '|' + (l.target || '') + '|' + (l.rel || '')) < 0; });
      (S.graphs.edgeAdd[gid] || []).forEach(function (e) {
        var k = e.source + '|' + e.target + '|' + e.rel;
        if (!links.some(function (l) { return (l.source + '|' + l.target + '|' + (l.rel || '')) === k; })) links.push(clone(e));
      });
      var es = S.graphs.edgeStyle[gid] || {};
      links.forEach(function (l) {
        var st = es[l.source + '|' + l.target + '|' + (l.rel || '')];
        if (st) { if (st.color) l.color = st.color; if (st.label) l.rel = st.label; }
      });
      var ns2 = S.graphs.nodeStyle[gid] || {};
      var pos = S.graphs.nodePos[gid] || {};
      nodes.forEach(function (n) {
        var st = ns2[n.id]; if (st) { if (st.color) n.color = st.color; if (st.name) n.name = st.name; }
        if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; }
      });
      return { id: gid, name: name, nodes: nodes, links: links, kinds: kinds || null, refs: refs || null, mapOnly: mapOnly };
    },
    addGraphNode: function (gid, node) {
      gid = clean(gid || S.graphs.active, 40); node = normNode(node);
      if (!node.name) return { ok: false, msg: '名称不能为空' };
      var d = this.graphData(gid);
      if (d.nodes.some(function (x) { return x.id === node.id; })) return { ok: false, msg: '已存在同名/同 id 节点' };
      if (gid !== GID_MAIN && S.graphs.created[gid]) S.graphs.created[gid].nodes.push(node);
      else { S.graphs.nodeAdd[gid] = S.graphs.nodeAdd[gid] || []; S.graphs.nodeAdd[gid].push(node); }
      persist(); reapply(); return { ok: true, id: node.id };
    },
    addGraphEdge: function (gid, edge) {
      gid = clean(gid || S.graphs.active, 40); edge = normEdge(edge);
      if (!edge.source || !edge.target) return { ok: false, msg: '需要两个节点' };
      if (edge.source === edge.target) return { ok: false, msg: '不能连到自己' };
      if (!edge.rel) edge.rel = '关联';
      var d = this.graphData(gid);
      if (!d.nodes.some(function (x) { return x.id === edge.source; }) || !d.nodes.some(function (x) { return x.id === edge.target; })) return { ok: false, msg: '节点不存在' };
      var k = edge.source + '|' + edge.target + '|' + edge.rel;
      if (d.links.some(function (l) { return (l.source + '|' + l.target + '|' + (l.rel || '')) === k; })) return { ok: false, msg: '这条关系已存在' };
      if (gid !== GID_MAIN && S.graphs.created[gid]) S.graphs.created[gid].links.push(edge);
      else { S.graphs.edgeAdd[gid] = S.graphs.edgeAdd[gid] || []; S.graphs.edgeAdd[gid].push(edge); }
      persist(); reapply(); return { ok: true, key: k };
    },
    setEdgeStyle: function (gid, key, style) {
      gid = clean(gid || S.graphs.active, 40); key = clean(key, 200);
      var o = {};
      if (style && style.color !== undefined) o.color = cleanColor(style.color);
      if (style && style.label !== undefined) o.label = clean(style.label, 40);
      S.graphs.edgeStyle[gid] = S.graphs.edgeStyle[gid] || {};
      S.graphs.edgeStyle[gid][key] = Object.assign(S.graphs.edgeStyle[gid][key] || {}, o);
      // 自定义图谱：直接改到本体
      if (gid !== GID_MAIN && S.graphs.created[gid]) {
        var parts = key.split('|');
        S.graphs.created[gid].links.forEach(function (l) {
          if (l.source === parts[0] && l.target === parts[1] && (l.rel || '') === parts[2]) {
            if (o.color) l.color = o.color; if (o.label) l.rel = o.label;
          }
        });
      }
      persist(); reapply(); return { ok: true };
    },
    setNodeStyle: function (gid, id, style) {
      gid = clean(gid || S.graphs.active, 40); id = clean(id, 60);
      var o = {};
      if (style && style.color !== undefined) o.color = cleanColor(style.color);
      if (style && style.name !== undefined) o.name = clean(style.name, 80);
      S.graphs.nodeStyle[gid] = S.graphs.nodeStyle[gid] || {};
      S.graphs.nodeStyle[gid][id] = Object.assign(S.graphs.nodeStyle[gid][id] || {}, o);
      if (gid !== GID_MAIN && S.graphs.created[gid]) {
        S.graphs.created[gid].nodes.forEach(function (n) { if (n.id === id) { if (o.color) n.color = o.color; if (o.name) n.name = o.name; } });
      }
      persist(); reapply(); return { ok: true };
    },
    setNodePos: function (gid, id, pos) {
      gid = clean(gid || S.graphs.active, 40); id = clean(id, 60);
      var x = Number(pos && pos.x), y = Number(pos && pos.y);
      if (!isFinite(x) || !isFinite(y)) return { ok: false };
      S.graphs.nodePos[gid] = S.graphs.nodePos[gid] || {};
      S.graphs.nodePos[gid][id] = { x: Math.round(x), y: Math.round(y) };
      persist(); return { ok: true };
    },
    removeGraphNode: function (gid, id) {
      gid = clean(gid || S.graphs.active, 40); id = clean(id, 60);
      if (gid !== GID_MAIN && S.graphs.created[gid]) {
        S.graphs.created[gid].nodes = S.graphs.created[gid].nodes.filter(function (n) { return n.id !== id; });
        S.graphs.created[gid].links = S.graphs.created[gid].links.filter(function (l) { return l.source !== id && l.target !== id; });
      } else {
        S.graphs.nodeRemove[gid] = S.graphs.nodeRemove[gid] || [];
        if (S.graphs.nodeRemove[gid].indexOf(id) < 0) S.graphs.nodeRemove[gid].push(id);
        S.graphs.nodeAdd[gid] = (S.graphs.nodeAdd[gid] || []).filter(function (n) { return n.id !== id; });
        var ek = S.graphs.edgeAdd[gid] || [];
        S.graphs.edgeAdd[gid] = ek.filter(function (e) { return e.source !== id && e.target !== id; });
      }
      persist(); reapply(); return { ok: true };
    },
    removeGraphEdge: function (gid, key) {
      gid = clean(gid || S.graphs.active, 40); key = clean(key, 200);
      var parts = key.split('|');
      if (gid !== GID_MAIN && S.graphs.created[gid]) {
        S.graphs.created[gid].links = S.graphs.created[gid].links.filter(function (l) { return !(l.source === parts[0] && l.target === parts[1] && (l.rel || '') === parts[2]); });
      } else {
        S.graphs.edgeRemove[gid] = S.graphs.edgeRemove[gid] || [];
        if (S.graphs.edgeRemove[gid].indexOf(key) < 0) S.graphs.edgeRemove[gid].push(key);
        S.graphs.edgeAdd[gid] = (S.graphs.edgeAdd[gid] || []).filter(function (e) { return (e.source + '|' + e.target + '|' + e.rel) !== key; });
      }
      persist(); reapply(); return { ok: true };
    },

    /* 整体替换某张图的节点/边（用于撤销） */
    replaceGraphData: function (gid, data) {
      gid = clean(gid || S.graphs.active, 40);
      var nodes = (data && Array.isArray(data.nodes) ? data.nodes : []).map(normNode).filter(function (n) { return n.name; });
      var links = (data && Array.isArray(data.links) ? data.links : []).map(normEdge).filter(function (l) { return l.source && l.target; });
      if (gid !== GID_MAIN) {
        if (!S.graphs.created[gid]) return { ok: false, msg: '图谱不存在' };
        S.graphs.created[gid].nodes = nodes;
        S.graphs.created[gid].links = links;
        S.graphs.nodeAdd[gid] = []; S.graphs.edgeAdd[gid] = [];
        S.graphs.nodeRemove[gid] = []; S.graphs.edgeRemove[gid] = [];
        S.graphs.nodeStyle[gid] = {}; S.graphs.edgeStyle[gid] = {};
        persist(); return { ok: true };
      }
      // 主图谱：与“内置基线”比较，重算覆盖差异
      var base = window.__YZY_BASE_GRAPH || { nodes: [], links: [] };
      var bid = {}, bkey = {};
      (base.nodes || []).forEach(function (n) { bid[n.id] = n; });
      (base.links || []).forEach(function (l) { bkey[l.source + '|' + l.target + '|' + (l.rel || '')] = l; });
      var nodeAdd = [], nodeRemove = [], edgeAdd = [], edgeRemove = [], nodeStyle = {};
      Object.keys(bid).forEach(function (id) {
        if (!nodes.some(function (n) { return n.id === id; })) nodeRemove.push(id);
      });
      nodes.forEach(function (n) {
        if (!bid[n.id]) { nodeAdd.push(n); return; }
        var b = bid[n.id], st = {};
        if (n.name && n.name !== b.name) st.name = n.name;
        if (n.color && n.color !== (b.color || '')) st.color = n.color;
        if (Object.keys(st).length) nodeStyle[n.id] = st;
      });
      Object.keys(bkey).forEach(function (k) {
        if (!links.some(function (l) { return (l.source + '|' + l.target + '|' + (l.rel || '')) === k; })) edgeRemove.push(k);
      });
      links.forEach(function (l) {
        var k = l.source + '|' + l.target + '|' + (l.rel || '');
        if (!bkey[k]) edgeAdd.push(l);
      });
      S.graphs.nodeAdd[gid] = nodeAdd; S.graphs.nodeRemove[gid] = nodeRemove;
      S.graphs.edgeAdd[gid] = edgeAdd; S.graphs.edgeRemove[gid] = edgeRemove;
      S.graphs.nodeStyle[gid] = nodeStyle;
      persist(); reapply(); return { ok: true };
    },

    /* ---- 导出 / 导入 / 重置 ---- */
    stats: function () {
      var Sx = S;
      return {
        added: Sx.resources.added.length, edited: Object.keys(Sx.resources.edited).length, removed: Sx.resources.removed.length,
        cats: Object.keys(Sx.resources.catLabels).length + Sx.resources.catAdded.length,
        peopleEdited: Object.keys(Sx.people.edited).length, peopleMoved: Object.keys(Sx.people.moved).length,
        peopleAdded: Sx.people.added.length, avatars: Object.keys(Sx.people.avatars).length,
        hubLabels: Object.keys(Sx.hubLabels).length,
        graphs: Object.keys(Sx.graphs.created).length,
        graphNodes: Object.keys(Sx.graphs.nodeAdd).reduce(function (a, k) { return a + Sx.graphs.nodeAdd[k].length; }, 0),
        graphEdges: Object.keys(Sx.graphs.edgeAdd).reduce(function (a, k) { return a + Sx.graphs.edgeAdd[k].length; }, 0)
      };
    },
    exportJSON: function () { return JSON.stringify(S, null, 2); },
    importJSON: function (text, mode) {
      var o;
      try { o = JSON.parse(text); } catch (e) { return { ok: false, msg: '不是合法 JSON' }; }
      if (!o || typeof o !== 'object') return { ok: false, msg: '结构不对' };
      var incoming = normalize(clone(o));
      S = (mode === 'replace') ? incoming : normalize(merge(S, incoming));
      persist();
      reapply();
      return { ok: true, msg: '导入成功（' + (mode === 'replace' ? '替换' : '合并') + '）', backend: S_backend };
    },
    reset: function () { S = empty(); persist(); return { ok: true }; },
    reapply: function () { return reapply(); },
    _norm: normalize
  };

  /* ---- 变更通知：内容被本机修改时，记一条通知（可在「史料 → 通知」清除） ---- */
  /* 图谱页（graph.html）与编辑台（editor.html）没有加载 app.js，__yzNotify 不存在，
     这里自带一份兜底写入（格式与 app.js 的「通知」完全一致），否则在这些页面做的修改不会留下通知。 */
  function yzNote(text) {
    try {
      var a = []; try { a = JSON.parse(localStorage.getItem('notifs') || '[]') || []; } catch (e) { a = []; }
      a.unshift({ t: String(text || '内容已修改'), ts: Date.now() });
      if (a.length > 200) a = a.slice(0, 200);
      localStorage.setItem('notifs', JSON.stringify(a));
    } catch (e) {}
  }
  (function () {
    try {
      var LBL = {
        addResource:'新增 / 修改资源', editResource:'编辑资源', moveResource:'移动资源', removeResource:'删除资源', restoreResource:'恢复资源',
        addCat:'新增分类', removeCat:'删除分类', renameCat:'重命名分类',
        addPerson:'添加 / 修改人物', editPerson:'编辑人物', removePersonAdded:'删除人物', movePerson:'调整人物分组', undoMovePerson:'撤销分组调整', setAvatar:'更换人物头像',
        setHubLabel:'修改栏目名', setHubName:'修改模块名',
        newGraph:'新建图谱', renameGraph:'重命名图谱', deleteGraph:'删除图谱',
        addGraphNode:'图谱：加节点', addGraphEdge:'图谱：加连线', removeGraphNode:'图谱：删节点', removeGraphEdge:'图谱：删连线',
        setNodeStyle:'图谱：节点样式', setEdgeStyle:'图谱：连线样式',
        importJSON:'导入数据', reset:'重置本机数据'
      };
      Object.keys(LBL).forEach(function (k) {
        if (typeof window.YZY[k] !== 'function') return;
        var f = window.YZY[k];
        window.YZY[k] = function () {
          var r = f.apply(this, arguments);
          try { if (r && r.ok) { if (window.__yzNotify) window.__yzNotify(LBL[k]); else yzNote(LBL[k]); } } catch (e) {}
          return r;
        };
      });
    } catch (e) {}
  })();

  /* ================= 初始化 ================= */
  reapply();
})();
