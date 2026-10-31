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
  var GROUPS_PERSON = ['leaders', 'comrades', 'critics', 'figures'];
  /* 内置图谱注册表（随站点/App 发布，不可删除 / 改名；仍可被本地覆盖层编辑） */
  function builtinGraphs() {
    var m = {};
    /* 文革图谱：**始终注册**，取数据时才看 SITE_GRAPH_WENGE 在不在。
       原因：首页为了首屏体积，把 142KB 的 data/graph-wenge.js 放到 400ms 后动态加载，
       而首页「我的主页」里的图谱入口是启动那一刻用 listGraphs() 渲染的 ——
       以前这里要求「数据已在」才注册，于是首页永远少一个「文革图谱」入口
       （用户反馈的「文革图谱在我的首页看不到」就是这个）。 */
    m.wenge = {
      name: '文革图谱',
      get: function () {
        var W = window.SITE_GRAPH_WENGE;
        return (W && Array.isArray(W.nodes)) ? W : { nodes: [], links: [] };
      }
    };
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

  /* ---------------- 首页图谱入口（哪些图谱出现在首页「我的主页」） ----------------
     默认全部开启；只记录被关掉的那些，这样以后新增内置图谱会自动出现。 */
  function homeOffList() {
    try { var a = JSON.parse(localStorage.getItem('homeGraphsOff') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function homeGraphOn(gid) { return homeOffList().indexOf(String(gid)) < 0; }
  function setHomeGraph(gid, on) {
    gid = String(gid || '').slice(0, 40); if (!gid) return { ok: false };
    var a = homeOffList(), i = a.indexOf(gid);
    if (on && i >= 0) a.splice(i, 1);
    if (!on && i < 0) a.push(gid);
    try { localStorage.setItem('homeGraphsOff', JSON.stringify(a)); } catch (e) { return { ok: false, msg: '本机存储已满' }; }
    return { ok: true, on: !!on };
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
      /* 概念 / 事件的本机改动（通用条目编辑）：id 或 name → 字段覆盖 */
      concepts: { edited: {} },
      events: { edited: {} },
      /* 史料补充内容：推荐人物 / 思想组织 / 答疑（键 = 人物名 / 条目名 / 答疑 id） */
      /* 术语卡（data/glossary.js）：改 / 增 / 删，与史料四类同一套机制 */
      term: { edited: {}, added: [], removed: [] },
      edu: { rec: { edited: {}, added: [], removed: [] },
             sch: { edited: {}, added: [], removed: [] },
             qa:  { edited: {}, added: [], removed: [] } },
      /* 自定义字段（「我的标注」）：键 = "<kind>:<id>"，值 = [{k,v}]。
         kind 取 book / person / concept / event；跟着个人覆盖层走，随导出一起带走。 */
      meta: {},
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
    /* 元信息与章节目录：详情页「✏️ 编辑」要能改，否则被这里过滤掉、保存等于白做 */
    ['publisher', 'pubyear', 'translator', 'pages', 'size', 'fmt', 'src'].forEach(function (k) {
      if (p[k] !== undefined) q[k] = clean(p[k], 120);
    });
    if (p.chapters !== undefined) {
      var arr = Array.isArray(p.chapters) ? p.chapters : [];
      q.chapters = arr.slice(0, 80).map(function (c) {
        c = c || {};
        return { t: clean(c.t, 120), d: clean(c.d, 800) };
      }).filter(function (c) { return c.t || c.d; });
    }
    /* 手动指定的相关推荐（书名 / id 都行），会排到详情页「相关推荐」最前面 */
    if (p.related !== undefined) q.related = cleanList(p.related, 80, 40);
    return q;
  }
  /* 年表：每项 {y:年, t:事件}；生平年表与著作年表同构 */
  function normChrono(a) {
    if (!Array.isArray(a)) return [];
    return a.slice(0, 120).map(function (x) {
      x = x || {};
      return { y: clean(x.y, 24), t: clean(x.t, 400) };
    }).filter(function (x) { return x.y || x.t; });
  }
  function normPerson(p) {
    p = p || {}; var q = {};
    if (p.intro !== undefined) q.intro = clean(p.intro, MAX);
    if (p.desc !== undefined) q.desc = clean(p.desc, MAX);
    if (p.related !== undefined) q.related = cleanList(p.related, 80, 40);
    if (p.timelines !== undefined) q.timelines = normChrono(p.timelines);
    if (p.worksTimeline !== undefined) q.worksTimeline = normChrono(p.worksTimeline);
    if (p.role !== undefined) q.role = clean(p.role, 200);
    if (p.works !== undefined) q.works = clean(p.works, 600);
    if (p.years !== undefined) q.years = clean(p.years, 40);
    if (p.points !== undefined) q.points = cleanList(p.points, 300, 20);
    if (p.avatar !== undefined) q.avatar = cleanAvatar(p.avatar);
    return q;
  }
  /* ---- 史料补充内容 ---- */
  function normRec(p) {
    p = p || {}; var q = {};
    ['name', 'account', 'fans', 'uid', 'img'].forEach(function (k) {
      if (p[k] !== undefined) q[k] = clean(p[k], 120);
    });
    if (p.intro !== undefined) q.intro = clean(p.intro, MAX);
    if (p.url !== undefined) q.url = cleanUrl(p.url);
    return q;
  }
  function normSch(p) {
    p = p || {}; var q = {};
    ['name', 'meta', 'works', 'group'].forEach(function (k) {
      if (p[k] !== undefined) q[k] = clean(p[k], 400);
    });
    ['desc', 'opposed'].forEach(function (k) {
      if (p[k] !== undefined) q[k] = clean(p[k], MAX);
    });
    if (p.people !== undefined) q.people = cleanList(p.people, 60, 30);
    return q;
  }
  /* 术语卡：字段少但都是要显示的文本，逐项限长；confuse 是「易混辨析」数组 */
  function normTerm(p) {
    p = p || {}; var q = {};
    if (p.term !== undefined) q.term = clean(p.term, 40);
    if (p.dic !== undefined) q.dic = clean(p.dic, MAX);
    if (p.from !== undefined) q.from = clean(p.from, 200);
    if (p.group !== undefined) q.group = clean(p.group, 20);
    if (p.note !== undefined) q.note = clean(p.note, 200);
    if (p.concept !== undefined) q.concept = clean(p.concept, 60);
    if (p.alias !== undefined) q.alias = cleanList(p.alias, 20, 8);
    if (p.tags !== undefined) q.tags = cleanList(p.tags, 20, 8);
    if (p.confuse !== undefined) {
      q.confuse = (Array.isArray(p.confuse) ? p.confuse : []).slice(0, 6).map(function (c) {
        c = c || {}; return { t: clean(c.t, 60), d: clean(c.d, 400) };
      }).filter(function (c) { return c.t || c.d; });
    }
    return q;
  }
  function normQa(p) {
    p = p || {}; var q = {};
    if (p.q !== undefined) q.q = clean(p.q, 300);
    if (p.group !== undefined) q.group = clean(p.group, 40);
    ['a', 'why'].forEach(function (k) {
      if (p[k] !== undefined) q[k] = clean(p[k], MAX);
    });
    if (p.basis !== undefined) q.basis = cleanList(p.basis, 200, 20);
    if (p.tags !== undefined) q.tags = cleanList(p.tags, 30, 12);
    return q;
  }
  function normNode(n) {
    n = n || {};
    var TYPES = ['person', 'idea', 'org', 'event', 'work'];
    var t = TYPES.indexOf(n.type) >= 0 ? n.type : 'person';
    var o = {
      id: clean(n.id, 60) || uid('n'), name: clean(n.name, 80), type: t,
      years: clean(n.years, 40), role: clean(n.role, 200), desc: clean(n.desc, MAX),
      img: cleanAvatar(n.img), crit: !!n.crit, color: cleanColor(n.color)
    };
    /* ★ 业务字段：这里是「导出 → 导入」的唯一收口，不能裁掉，
       否则图谱导出再导入会丢要点 / 代表文献 / 标签 / 出处 / 地理坐标。 */
    if (n.points && n.points.length) o.points = cleanList(n.points, 300, 30);
    if (n.works && n.works.length) o.works = cleanList(n.works, 120, 40);
    if (n.tags && n.tags.length) o.tags = cleanList(n.tags, 30, 20);
    if (n.source) o.source = clean(n.source, 200);
    if (n.prov) o.prov = clean(n.prov, 40);
    if (n.place) o.place = clean(n.place, 80);
    if (Array.isArray(n.geo) && n.geo.length === 2 && isFinite(+n.geo[0]) && isFinite(+n.geo[1])) {
      o.geo = [+n.geo[0], +n.geo[1]];
    } else {
      if (typeof n.lng === 'number' && isFinite(n.lng)) o.lng = n.lng;
      if (typeof n.lat === 'number' && isFinite(n.lat)) o.lat = n.lat;
    }
    return o;
  }
  function normEdge(e) {
    e = e || {};
    var key = clean(e.source, 60) + '|' + clean(e.target, 60) + '|' + clean(e.rel, 40);
    var out = { source: clean(e.source, 60), target: clean(e.target, 60), rel: clean(e.rel, 40), color: cleanColor(e.color), key: key };
    if (e.src) out.src = clean(e.src, 200);        /* 关系依据，导出/导入要能往返 */
    return out;
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

    /* 术语卡（data/glossary.js）：edited 覆盖 / added 新增 / removed 删除。
       normalize() 是白名单式的——这里漏一段，整段改动就会被丢掉（editTerm 存进去、reapply 读不出）。 */
    sub(OV, 'term', {});
    var TERM = OV.term;
    sub(TERM, 'edited', {}); sub(TERM, 'added', []); sub(TERM, 'removed', []);
    var termEd = {};
    Object.keys(TERM.edited).forEach(function (k) { var id = clean(k, 60); if (id) termEd[id] = normTerm(TERM.edited[k]); });
    TERM.edited = termEd;
    TERM.added = (Array.isArray(TERM.added) ? TERM.added : []).map(function (x) {
      var p = normTerm(x); if (!p.term || !p.dic) return null;
      p.id = clean(x && x.id, 60) || ('gz' + Math.random().toString(36).slice(2, 8));
      return p;
    }).filter(Boolean);
    TERM.removed = (Array.isArray(TERM.removed) ? TERM.removed : []).map(function (x) { return clean(x, 60); }).filter(Boolean);

    sub(OV, 'edu', {});
    var ED = OV.edu, NORMEDU = { rec: normRec, sch: normSch, qa: normQa };
    Object.keys(NORMEDU).forEach(function (k) {
      sub(ED, k, {}); var B = ED[k];
      sub(B, 'edited', {}); sub(B, 'added', []); sub(B, 'removed', []);
      var e = {}, eo = B.edited || {};
      Object.keys(eo).forEach(function (kk) {
        var id = clean(kk, 120);
        if (id) e[id] = NORMEDU[k](eo[kk]);
      });
      B.edited = e;
      B.added = (Array.isArray(B.added) ? B.added : []).map(NORMEDU[k]).filter(function (x) {
        return x.name || x.q;
      });
      B.removed = (Array.isArray(B.removed) ? B.removed : []).map(function (x) {
        return clean(x, 120);
      }).filter(Boolean);
    });

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
    /* ★ 内置图谱（文革 / 世界）也是合法 active。这里以前只认 S.graphs.created，
       于是「在文革图谱里删一个节点/一条关系」→ persist → reapply → load → normalize
       把 active 强制改回 main，界面直接切成主图谱的另一套节点（用户看到的就是
       「删一下就整张图都乱了」）。setActiveGraph 本来就允许内置图谱，这里是漏判。 */
    if (G.active !== GID_MAIN && !G.created[G.active] && !builtinGraphs()[G.active]) G.active = GID_MAIN;
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

    /* 自定义字段：键形如 book:ma-eng-xuanji / person:mao；每条最多 20 个字段，值 300 字 */
    var mm = {}, mo = (OV.meta && typeof OV.meta === 'object') ? OV.meta : {};
    Object.keys(mo).forEach(function (key) {
      var kk = clean(key, 80);
      if (!kk || !/^(book|person|concept|event):/.test(kk)) return;
      var arr = Array.isArray(mo[key]) ? mo[key] : [];
      var list = [];
      arr.slice(0, 20).forEach(function (f) {
        if (!f) return;
        var k = clean(f.k, 30), v = clean(f.v, 300);
        if (k) list.push({ k: k, v: v });
      });
      if (list.length) mm[kk] = list;
    });
    OV.meta = mm;

    /* 概念 / 事件的本机改动 */
    sub(OV, 'concepts', {}); sub(OV, 'events', {});
    function normEdits(obj, allow) {
      var out = {}, src = (obj && typeof obj === 'object') ? obj : {};
      Object.keys(src).forEach(function (k) {
        var kk = clean(k, 80); if (!kk) return;
        var v = src[k] || {}, o2 = {};
        allow.forEach(function (f) {
          if (v[f] === undefined || v[f] === null) return;
          if (f === 'points') { var l = cleanList(v[f], 300, 12); if (l.length) o2.points = l; }
          else { var t = clean(v[f], MAX); if (t) o2[f] = t; }
        });
        if (Object.keys(o2).length) out[kk] = o2;
      });
      return out;
    }
    OV.concepts.edited = normEdits(OV.concepts.edited, ['name', 'role', 'desc', 'points']);
    OV.events.edited = normEdits(OV.events.edited, ['name', 'year', 'desc', 'points']);
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
    // 术语卡（data/glossary.js）：与 edu 同规则，个人后写覆盖官方
    r.term = r.term || { edited: {}, added: [], removed: [] };
    var _ta = r.term, _tb = b.term || {};
    r.term = {
      edited: Object.assign({}, _ta.edited || {}, _tb.edited || {}),
      added: (_ta.added || []).concat(_tb.added || []),
      removed: (_ta.removed || []).concat(_tb.removed || [])
    };
    // 史料补充内容（个人后写覆盖官方）
    r.edu = r.edu || {};
    ['rec', 'sch', 'qa'].forEach(function (k) {
      var a2 = r.edu[k] || {}, b2 = (b.edu || {})[k] || {};
      r.edu[k] = {
        edited: Object.assign({}, a2.edited || {}, b2.edited || {}),
        added: (a2.added || []).concat(b2.added || []),
        removed: (a2.removed || []).concat(b2.removed || [])
      };
    });
    // 概念 / 事件的本机改动（个人后写覆盖官方）
    r.concepts = r.concepts || { edited: {} };
    r.concepts.edited = Object.assign({}, (r.concepts.edited || {}), ((b.concepts || {}).edited) || {});
    r.events = r.events || { edited: {} };
    r.events.edited = Object.assign({}, (r.events.edited || {}), ((b.events || {}).edited) || {});
    // meta（自定义字段）：按条目合并，个人后写覆盖官方
    r.meta = Object.assign({}, r.meta || {}, b.meta || {});
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
    return { leaders: CT.leaders, comrades: CT.comrades, critics: EX.critics, figures: CT.figures };
  }
  function applyPeople(OV) {
    var groups = personGroups();
    // ① 新增人物
    OV.people.added.forEach(function (p) {
      var arr = groups[p.group];
      if (!Array.isArray(arr)) return;
      if (arr.some(function (x) { return x && x.name === p.name; })) return;
      var rec = { name: p.name, years: p.years, role: p.role, intro: p.intro, desc: p.desc || p.intro,
        works: p.works, points: p.points, related: p.related, src: '读者补充' };
      if (p.avatar) rec.img = p.avatar;
      arr.push(rec);
      /* 年表存 SITE_EXTRA，不在人物数组里 */
      try {
        if (window.SITE_EXTRA) {
          if (!SITE_EXTRA.timelines) SITE_EXTRA.timelines = {};
          if (!SITE_EXTRA.worksTimeline) SITE_EXTRA.worksTimeline = {};
          if (p.timelines && p.timelines.length) SITE_EXTRA.timelines[p.name] = normChrono(p.timelines);
          if (p.worksTimeline && p.worksTimeline.length) SITE_EXTRA.worksTimeline[p.name] = normChrono(p.worksTimeline);
        }
      } catch (e2) { }
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
    /* ★ 空数据不能当基线：graph.js 现在是延迟加载，首屏 window.SITE_GRAPH 只是个空占位，
       若在这里冻结成"内置基线"，之后每次 reapply 都会拿空基线重建 SITE_GRAPH，
       结果就是图谱数据被清空（表现为"图谱节点点不开、搜索不到"）。 */
    if (!GR.nodes.length) return;
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
    /* 安全模式（crash.js 设置）：连续两次启动未成功时跳过「本机个人改动」，
       先用官方内容把界面打开；用户可在横条里导出/清除本机改动后退出安全模式。 */
    var per = window.__yzSafeMode ? normalize(null) : normalize(stored());
    var base = merge(off, per);
    S = normalize(base);
    return S;
  }
  function persist() {
    var ok = rawSet(JSON.stringify(S));
    if (!ok && window.console) console.warn('[YZY] 存储降级：', S_warn);
    return ok;
  }
  /* 概念 / 事件：把本机改动直接写回页面正在用的数据对象（就地覆盖，宁可少改不弄坏结构） */
  function applyConcepts(OV) {
    try {
      var nodes = (window.SITE_CONCEPTS && window.SITE_CONCEPTS.nodes) || [];
      var ed = (OV.concepts && OV.concepts.edited) || {};
      Object.keys(ed).forEach(function (id) {
        var n = nodes.find(function (x) { return x.id === id; });
        if (!n) return;
        var e = ed[id];
        ['name', 'role', 'desc'].forEach(function (f) { if (e[f]) n[f] = e[f]; });
        if (e.points && e.points.length) n.points = e.points.slice();
      });
      /* 支持「新增概念」：直接 push（id 由用户给，重复则跳过） */
      ((OV.concepts && OV.concepts.added) || []).forEach(function (c) {
        if (!c || !c.id || nodes.some(function (x) { return x.id === c.id; })) return;
        nodes.push(c);
      });
    } catch (e) {}
  }
  function applyEvents(OV) {
    try {
      var list = (window.SITE_EXTRA && window.SITE_EXTRA.events) || [];
      var ed = (OV.events && OV.events.edited) || {};
      Object.keys(ed).forEach(function (name) {
        var n = list.find(function (x) { return x.name === name; });
        if (!n) return;
        var e = ed[name];
        ['year', 'desc'].forEach(function (f) { if (e[f]) n[f] = e[f]; });
        if (e.name) n.name = e.name;
        if (e.points && e.points.length) n.points = e.points.slice();
      });
    } catch (e) {}
  }

  /* 人物库（leaders/comrades/critics）的编辑 → 同步到图谱节点 desc。
     原因：人物详情页 openFigure() 读的是 SITE_GRAPH.nodes[].desc，
           而 editPerson 写的是 SITE_CONTENT 里的 intro，两份数据互不相通。
     做法：applyGraphToSiteGraph 每次已从 __YZY_BASE_GRAPH 重建 nodes（幂等），
           这里在它之后用 edited 的绝对值覆盖 desc，重复执行结果一致。 */
  function applyPeopleToGraph(OV) {
    var GR = window.SITE_GRAPH;
    if (!GR || !Array.isArray(GR.nodes)) return;
    var ed = (OV && OV.people && OV.people.edited) || {};
    Object.keys(ed).forEach(function (key) {
      var pr = key.split('|'), name = pr[1], e = ed[key] || {};
      if (!name) return;
      if (e.intro === undefined && e.years === undefined && e.role === undefined) return;
      for (var i = 0; i < GR.nodes.length; i++) {
        var n = GR.nodes[i];
        if (!n || n.name !== name) continue;
        if (e.intro !== undefined) n.desc = e.intro;
        if (e.years !== undefined && n.years !== undefined) n.years = e.years;
        if (e.role !== undefined && n.role !== undefined) n.role = e.role;
        break;
      }
    });
  }

  /* 史料补充内容的编辑结果写回页面数据。
     幂等：edited 是「绝对值覆盖」，added 按名称/id 去重，removed 用 filter 生成新数组。
     顺序固定：先覆盖 → 再新增 → 最后删除。 */
  function applyEdu(OV) {
    var ED = (OV && OV.edu) || {};
    var setf = function (it, e, fields) {
      fields.forEach(function (f) { if (e[f] !== undefined) it[f] = e[f]; });
    };
    try {
      /* ① 推荐人物 */
      var CT = window.SITE_CONTENT, R = CT && CT.recommend;
      if (Array.isArray(R)) {
        var b = ED.rec || {};
        var ed = b.edited || {};
        Object.keys(ed).forEach(function (nm) {
          for (var i = 0; i < R.length; i++) {
            if (R[i] && R[i].name === nm) { setf(R[i], ed[nm], ['account', 'fans', 'intro', 'url', 'img']); break; }
          }
        });
        (b.added || []).forEach(function (x) {
          if (!x || !x.name) return;
          if (R.some(function (y) { return y && y.name === x.name; })) return;
          R.push(x);
        });
        if (b.removed && b.removed.length) {
          CT.recommend = R.filter(function (x) { return b.removed.indexOf(x && x.name) < 0; });
        }
      }
      /* ② 思想 / 组织 */
      var EXO = window.SITE_EXTRA, G = (EXO && EXO.schools) || [];
      var bs = ED.sch || {}, sed = bs.edited || {};
      G.forEach(function (g) {
        (g.items || []).forEach(function (it) {
          if (!it) return;
          var e = sed[it.name];
          if (e) setf(it, e, ['meta', 'desc', 'works', 'opposed']);
          if (e && e.people) it.people = e.people.slice();
        });
      });
      (bs.added || []).forEach(function (x) {
        if (!x || !x.name) return;
        var tgt = null;
        G.forEach(function (g) {
          if (tgt) return;
          if ((g.group || g.name || '') === (x.group || '')) tgt = g;
        });
        if (!tgt) tgt = G[0];
        if (!tgt) return;
        if ((tgt.items || []).some(function (y) { return y && y.name === x.name; })) return;
        tgt.items.push(x);
      });
      if (bs.removed && bs.removed.length) {
        G.forEach(function (g) {
          g.items = (g.items || []).filter(function (y) { return bs.removed.indexOf(y && y.name) < 0; });
        });
      }
      /* ③ 答疑 */
      var ANS = window.SITE_ANSWERS;
      /* 撤掉上一轮由覆盖层临时建的分组与塞进去的条目（push 必须可撤销，apply 才幂等） */
      if (ANS && Array.isArray(ANS.groups)) {
        ANS.groups = ANS.groups.filter(function (g) { return !(g && g.__ov); });
        ANS.groups.forEach(function (g) { if (g && Array.isArray(g.items)) g.items = g.items.filter(function (y) { return !(y && y.__ov); }); });
      }
      var AG = (ANS && ANS.groups) || [];
      var bq = ED.qa || {}, qed = bq.edited || {};
      AG.forEach(function (g) {
        (g.items || []).forEach(function (it) {
          if (!it) return;
          var e = qed[it.id];
          if (!e) return;
          setf(it, e, ['q', 'a', 'why']);
          if (e.basis) it.basis = e.basis.slice();
          if (e.tags) it.tags = e.tags.slice();
        });
      });
      (bq.added || []).forEach(function (x) {
        if (!x || !x.q) return;
        var g0 = AG.filter(function (g) { return (g.items || []).some(function (y) { return y && y.q === x.q; }); })[0];
        if (g0) return;
        /* 指定了分组就放进去；组不存在就现建一个（标 __ov，下次重算时先撤掉） */
        var t = null;
        if (x.group) {
          t = AG.filter(function (g) { return g && g.name === x.group; })[0];
          if (!t) { t = { name: x.group, items: [], __ov: 1 }; AG.push(t); }
        }
        if (!t) t = AG[0];
        if (!t) return;
        var c = Object.assign({}, x); c.id = c.id || ('a-x' + Math.random().toString(36).slice(2, 7)); c.__ov = 1;
        (t.items = t.items || []).push(c);
      });
      if (bq.removed && bq.removed.length) {
        AG.forEach(function (g) {
          g.items = (g.items || []).filter(function (y) { return bq.removed.indexOf(y && y.id) < 0; });
        });
      }
    } catch (e) {}
  }

  /* 生平年表 / 著作年表存在 SITE_EXTRA（不在人物数组里），必须单独回写。
     ⚠️ 必须是「基线 → 删 → 按 id 写回」：只做「有则写」的话，把年表清空保存后旧内容会残留
     （用户会看到「删了还在」），重置覆盖层后也撤不掉。 */
  var _chronoBase = null;
  /* 术语卡的编辑结果写回 SITE_GLOSSARY：先覆盖 → 再新增 → 最后删除（与 applyEdu 同序，幂等） */
  function applyTerm(OV) {
    if (!Array.isArray(window.SITE_GLOSSARY)) return;
    /* 先把上一轮由覆盖层加进来的项剔掉再重加。
       否则 removeTerm 只把 added 清空，而上一轮 push 进数组的那一条会留在页面上
       ——「加了又删，删不掉」就是这里（push 型数据必须可撤销，apply 才幂等）。 */
    window.SITE_GLOSSARY = window.SITE_GLOSSARY.filter(function (x) { return !(x && x.__ov); });
    var T = window.SITE_GLOSSARY;
    var B = (OV && OV.term) || {}, ed = B.edited || {};
    T.forEach(function (t) {
      if (!t || !t.id) return;
      var e = ed[t.id]; if (!e) return;
      Object.keys(e).forEach(function (k) { t[k] = e[k]; });
    });
    (B.added || []).forEach(function (x) {
      if (!x || !x.term) return;
      if (T.some(function (y) { return y && (y.id === x.id || y.term === x.term); })) return;
      var c = Object.assign({}, x); c.__ov = 1;   /* 打标记，下一轮好撤；副本不写回存档 */
      T.push(c);
    });
    if (B.removed && B.removed.length) {
      window.SITE_GLOSSARY = T.filter(function (x) { return B.removed.indexOf(x && x.id) < 0; });
    }
  }
  function chronoBase() {
    if (_chronoBase) return _chronoBase;
    var EX = window.SITE_EXTRA || {};
    _chronoBase = {
      timelines: JSON.parse(JSON.stringify(EX.timelines || {})),
      worksTimeline: JSON.parse(JSON.stringify(EX.worksTimeline || {}))
    };
    return _chronoBase;
  }
  function applyPersonChrono(OV) {
    var EX = window.SITE_EXTRA;
    if (!EX) return;
    var base = chronoBase();
    /* ① 先整体恢复内置基线（撤销上一次的写入 / 已删除的条目） */
    EX.timelines = JSON.parse(JSON.stringify(base.timelines));
    EX.worksTimeline = JSON.parse(JSON.stringify(base.worksTimeline));
    /* ② 新增人物自带的年表 */
    (OV.people.added || []).forEach(function (p) {
      if (!p || !p.name) return;
      try {
        var ta = normChrono(p.timelines), tb = normChrono(p.worksTimeline);
        if (ta.length) EX.timelines[p.name] = ta;
        if (tb.length) EX.worksTimeline[p.name] = tb;
      } catch (e) { }
    });
    /* ③ 本机编辑的年表 */
    Object.keys(OV.people.edited || {}).forEach(function (key) {
      var pr = key.split('|'), name = pr[1], e = OV.people.edited[key] || {};
      try {
        if (e.timelines !== undefined) {
          var a = normChrono(e.timelines);
          if (a.length) EX.timelines[name] = a; else delete EX.timelines[name];
        }
        if (e.worksTimeline !== undefined) {
          var b = normChrono(e.worksTimeline);
          if (b.length) EX.worksTimeline[name] = b; else delete EX.worksTimeline[name];
        }
      } catch (err) { }
    });
  }

  function reapply() {
    load();
    applyResources(S);
    applyPeople(S);
    applyGraphToSiteGraph(S);
    applyPeopleToGraph(S);   /* ★ 人物介绍的编辑结果同步进图谱节点，否则详情页看不到 */
    applyPersonChrono(S);    /* ★ 生平年表 / 著作年表存在 SITE_EXTRA，单独回写 */
    applyConcepts(S);
    applyEvents(S);
    applyEdu(S);
    applyTerm(S);
    applyLabels(S);
    /* 覆盖层（含导入的备份）刚合并完，立刻净化一次，避免把 HTML 带进页面 */
    try { if (window.yzCleanData) window.yzCleanData(); } catch (e) {}
    return S;
  }
  window.YZY = {
    version: 2,
    /* 诊断用：返回当前覆盖层快照（只读副本），排查「改完没生效」时先用它看数据到底在不在 */
    dumpOverlay: function () { try { return JSON.parse(JSON.stringify(S)); } catch (e) { return null; } },
    sanitize: clean,
    storage: storageInfo,
    /* 懒加载图谱数据后，需要重新把本机改动应用一遍（覆盖层是幂等的） */
    reapply: function () { try { reapply(); return true; } catch (e) { return false; } },
    /* 延迟图谱数据到位后，让下一轮 reapply 重新捕获基线（否则基线还是那个空占位） */
    resetBaseGraph: function () { try { window.__YZY_BASE_GRAPH = null; } catch (e) { } return true; },
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

    /* ---- 术语卡：改 / 增 / 删 / 批量导入 ---- */
    editTerm: function (id, patch) {
      id = clean(id, 60); if (!id) return { ok: false, msg: '缺少 id' };
      var p = normTerm(patch);
      if (!Object.keys(p).length) return { ok: false, msg: '没有可保存的字段' };
      S.term.edited[id] = Object.assign(S.term.edited[id] || {}, p);
      persist(); return { ok: true };
    },
    addTerm: function (obj) {
      var p = normTerm(obj);
      if (!p.term) return { ok: false, msg: '缺少术语名' };
      if (!p.dic) return { ok: false, msg: '缺少定义' };
      var exist = (window.SITE_GLOSSARY || []).filter(function (x) { return x && x.term === p.term; })[0];
      if (exist) return { ok: false, msg: '已有同名词条：' + p.term, id: exist.id };
      p.id = 'gz' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      S.term.added.push(p); persist(); return { ok: true, id: p.id };
    },
    removeTerm: function (id) {
      id = clean(id, 60); if (!id) return { ok: false, msg: '缺少 id' };
      var inAdded = (S.term.added || []).some(function (x) { return x.id === id; });
      if (inAdded) S.term.added = S.term.added.filter(function (x) { return x.id !== id; });
      else if ((S.term.removed || []).indexOf(id) < 0) S.term.removed.push(id);
      persist(); return { ok: true };
    },
    importTerms: function (list, opts) {
      opts = opts || {};
      var added = 0, skipped = [], bad = [];
      (Array.isArray(list) ? list : []).forEach(function (x) {
        var p = normTerm(x);
        if (!p.term || !p.dic) { bad.push((x && x.term) || '(空)'); return; }
        var exist = (window.SITE_GLOSSARY || []).filter(function (y) { return y && y.term === p.term; })[0];
        if (exist) {
          if (opts.overwrite) { S.term.edited[exist.id] = Object.assign(S.term.edited[exist.id] || {}, p); added++; }
          else skipped.push(p.term);
          return;
        }
        p.id = 'gz' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        S.term.added.push(p); added++;
      });
      persist();
      return { ok: true, added: added, skipped: skipped, bad: bad };
    },

    /* ---- 史料补充内容：推荐人物 / 思想组织 / 答疑 ---- */
    editRec: function (name, patch) {
      name = clean(name, 120);
      if (!name) return { ok: false, msg: '缺少名称' };
      var p = normRec(patch);
      if (!Object.keys(p).length) return { ok: false, msg: '没有可保存的字段' };
      S.edu.rec.edited[name] = Object.assign(S.edu.rec.edited[name] || {}, p);
      persist(); return { ok: true };
    },
    addRec: function (obj) {
      var p = normRec(obj);
      if (!p.name) return { ok: false, msg: '名称不能为空' };
      S.edu.rec.added.push(p); persist(); return { ok: true, name: p.name };
    },
    removeRec: function (name) {
      name = clean(name, 120); if (!name) return { ok: false };
      S.edu.rec.removed = (S.edu.rec.removed || []).filter(function (x) { return x !== name; });
      S.edu.rec.removed.push(name);
      delete S.edu.rec.edited[name];
      persist(); return { ok: true };
    },
    editSch: function (name, patch) {
      name = clean(name, 120);
      if (!name) return { ok: false, msg: '缺少名称' };
      var p = normSch(patch);
      if (!Object.keys(p).length) return { ok: false, msg: '没有可保存的字段' };
      S.edu.sch.edited[name] = Object.assign(S.edu.sch.edited[name] || {}, p);
      persist(); return { ok: true };
    },
    addSch: function (obj) {
      var p = normSch(obj);
      if (!p.name) return { ok: false, msg: '名称不能为空' };
      S.edu.sch.added.push(p); persist(); return { ok: true, name: p.name };
    },
    removeSch: function (name) {
      name = clean(name, 120); if (!name) return { ok: false };
      S.edu.sch.removed = (S.edu.sch.removed || []).filter(function (x) { return x !== name; });
      S.edu.sch.removed.push(name);
      delete S.edu.sch.edited[name];
      persist(); return { ok: true };
    },
    editQa: function (id, patch) {
      id = clean(id, 120);
      if (!id) return { ok: false, msg: '缺少编号' };
      var p = normQa(patch);
      if (!Object.keys(p).length) return { ok: false, msg: '没有可保存的字段' };
      S.edu.qa.edited[id] = Object.assign(S.edu.qa.edited[id] || {}, p);
      persist(); return { ok: true };
    },
    addQa: function (obj) {
      var p = normQa(obj);
      if (!p.q) return { ok: false, msg: '问题不能为空' };
      p.id = 'a-' + Math.random().toString(36).slice(2, 8);
      S.edu.qa.added.push(p); persist(); return { ok: true, id: p.id };
    },
    /* 批量导入答疑：一条条走 addQa，同名问题跳过 */
    importAnswers: function (list, opts) {
      opts = opts || {};
      var added = 0, skipped = [], bad = [];
      var existQ = {};
      ((window.SITE_ANSWERS || {}).groups || []).forEach(function (g) {
        (g.items || []).forEach(function (y) { if (y && y.q) existQ[String(y.q).trim()] = 1; });
      });
      (Array.isArray(list) ? list : []).forEach(function (x) {
        var p = normQa(x);
        if (!p.q || !p.a) { bad.push((x && x.q) || '(空)'); return; }
        if (existQ[String(p.q).trim()] && !opts.overwrite) { skipped.push(p.q); return; }
        p.id = 'a-' + Math.random().toString(36).slice(2, 8);
        S.edu.qa.added.push(p); added++;
      });
      persist();
      return { ok: true, added: added, skipped: skipped, bad: bad };
    },
    removeQa: function (id) {
      id = clean(id, 120); if (!id) return { ok: false };
      S.edu.qa.removed = (S.edu.qa.removed || []).filter(function (x) { return x !== id; });
      S.edu.qa.removed.push(id);
      delete S.edu.qa.edited[id];
      persist(); return { ok: true };
    },

    /* ---- 自定义字段（我的标注）---- */
    getMeta: function (key) {
      var k = clean(key, 80);
      if (!k || !S.meta || !S.meta[k]) return [];
      return S.meta[k].map(function (x) { return { k: x.k, v: x.v }; });
    },
    setMeta: function (key, arr) {
      var k = clean(key, 80);
      if (!k || !/^(book|person|concept|event):/.test(k)) return { ok: false, err: '不支持的条目类型' };
      var list = [];
      (Array.isArray(arr) ? arr : []).slice(0, 20).forEach(function (f) {
        var kk = clean(f && f.k, 30), vv = clean(f && f.v, 300);
        if (kk) list.push({ k: kk, v: vv });
      });
      S.meta = S.meta || {};
      if (list.length) S.meta[k] = list; else delete S.meta[k];
      persist();
      return { ok: true };
    },
    addMeta: function (key, k, v) {
      var list = this.getMeta(key);
      if (list.length >= 20) return { ok: false, err: '每条约 20 个标注' };
      list.push({ k: clean(k, 30), v: clean(v, 300) });
      return this.setMeta(key, list);
    },
    delMeta: function (key, i) {
      var list = this.getMeta(key);
      if (i < 0 || i >= list.length) return { ok: false };
      list.splice(i, 1);
      return this.setMeta(key, list);
    },
    allMeta: function () { return clone((S && S.meta) || {}); },

    /* ---- 概念 / 事件：通用条目编辑 ---- */
    editConcept: function (id, patch) {
      var k = clean(id, 60); if (!k) return { ok: false };
      S.concepts = S.concepts || { edited: {} };
      S.concepts.edited[k] = Object.assign(S.concepts.edited[k] || {}, patch || {});
      S = normalize(S); persist(); reapply();
      return { ok: true };
    },
    editEvent: function (name, patch) {
      var k = clean(name, 80); if (!k) return { ok: false };
      S.events = S.events || { edited: {} };
      S.events.edited[k] = Object.assign(S.events.edited[k] || {}, patch || {});
      S = normalize(S); persist(); reapply();
      return { ok: true };
    },

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
        intro: clean(obj.intro, MAX), desc: clean(obj.desc || obj.intro, MAX),
        works: clean(obj.works, 600), points: cleanList(obj.points, 300, 20),
        related: cleanList(obj.related, 80, 40),
        timelines: normChrono(obj.timelines), worksTimeline: normChrono(obj.worksTimeline),
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
    homeGraphOn: homeGraphOn, setHomeGraph: setHomeGraph, homeGraphsOff: homeOffList,
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
          /* ★ 统一走 normNode：字段白名单只有一处，避免「导入时又裁一遍」把
             出处 / 地理 / 代表文献等悄悄丢掉（导入图谱曾因此丢 source 与 geo）。 */
          var nn = normNode(n);
          nn.id = id; nn.name = nm;
          on.push(nn);
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
          var ee = normEdge(l);
          ee.source = s; ee.target = t; ee.rel = rel; ee.key = k;
          ol.push(ee);
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
        var st = ns2[n.id];
        if (st) {
          if (st.color) n.color = st.color;
          if (st.name) n.name = st.name;
          if (st.type) n.type = st.type;
          if (st.years !== undefined) n.years = st.years;
          if (st.role !== undefined) n.role = st.role;
          if (st.desc !== undefined) n.desc = st.desc;
          if (st.points !== undefined) n.points = st.points;
        }
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
      var o = {}, TYPES = ['person', 'idea', 'org', 'event', 'work'];
      if (style && style.color !== undefined) o.color = cleanColor(style.color);
      if (style && style.name !== undefined) { if (!clean(style.name, 80)) return { ok: false, msg: '名称不能为空' }; o.name = clean(style.name, 80); }
      if (style && style.type !== undefined) o.type = TYPES.indexOf(style.type) >= 0 ? style.type : 'person';
      if (style && style.years !== undefined) o.years = clean(style.years, 40);
      if (style && style.role !== undefined) o.role = clean(style.role, 200);
      if (style && style.desc !== undefined) o.desc = clean(style.desc, MAX);
      if (style && style.points !== undefined) o.points = cleanList(style.points, 300, 30);
      S.graphs.nodeStyle[gid] = S.graphs.nodeStyle[gid] || {};
      S.graphs.nodeStyle[gid][id] = Object.assign(S.graphs.nodeStyle[gid][id] || {}, o);
      if (gid !== GID_MAIN && S.graphs.created[gid]) {
        S.graphs.created[gid].nodes.forEach(function (n) {
          if (n.id !== id) return;
          Object.keys(o).forEach(function (k) { n[k] = o[k]; });
        });
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
        meta: Object.keys(Sx.meta || {}).length,
        concepts: Object.keys((Sx.concepts && Sx.concepts.edited) || {}).length,
        events: Object.keys((Sx.events && Sx.events.edited) || {}).length,
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
