/* 学通 · 闯关地图（challenge.html）
   ------------------------------------------------------------------
   职责边界（严格）：
     · 软件只负责：地图、节点、解锁状态、导入、沙箱播放器、进度存档
     · 题目与玩法全在导入的 .html 文件包里，软件不读题、不判分
   数据来源：IndexedDB(yzy_packs) 里用户导入的包；包内节点由 <meta name="yz-pack"> 声明
   安全：包只在 iframe 里跑，sandbox="allow-scripts ..."（绝不给 allow-same-origin）
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var DB = 'yzy_packs', STORE = 'packs', KEY = 'yzq_prog';
  var C = {
    bg: '#170303', line: 'rgba(245,197,24,.35)', lineDim: 'rgba(255,255,255,.10)',
    node: '#3a0808', nodeDone: '#4a2a05', gold: '#f5c518', text: '#e8e8ea', dim: 'rgba(255,255,255,.35)',
    light: false
  };
  var cv, ctx, W = 0, H = 0, DPR = 1;
  var view = { x: 0, y: 0, k: 1 };
  var nodes = [], edges = [], packs = [];
  var selId = null, prog = {}, blown = true;

  /* ---------------- 小工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* 页面级错误直接显示在顶部红条里：这类"点了没反应"的问题，没有提示最难查 */
  function showErr(msg) {
    var b = document.getElementById('errbar');
    if (!b) { try { alert('出错了：' + msg); } catch (e) {} return; }
    b.textContent = '出错了：' + msg;
    b.classList.add('on');
    setTimeout(function () { b.classList.remove('on'); }, 8000);
  }
  window.addEventListener('error', function (e) {
    showErr((e && e.message) || '未知脚本错误');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    showErr((r && (r.message || r)) || '未处理的异步错误');
  });
  function toast(msg) {
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));' +
      'transform:translateX(-50%);z-index:99;background:rgba(0,0,0,.86);color:#fff;padding:9px 16px;' +
      'border-radius:999px;font-size:.8rem;max-width:86vw;text-align:center';
    document.body.appendChild(d);
    setTimeout(function () { d.style.transition = 'opacity .3s'; d.style.opacity = 0; }, 1800);
    setTimeout(function () { try { d.remove(); } catch (e) {} }, 2200);
  }

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    var t = 'auto';
    try { t = localStorage.getItem('theme') || 'auto'; } catch (e) {}
    var light = false;
    if (t === 'light') light = true;
    else if (t === 'dark') light = false;
    else {
      try { if (window.AndroidApp && typeof AndroidApp.systemDark === 'function') light = !AndroidApp.systemDark(); } catch (e) {}
      if (!light) { try { light = !!(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches); } catch (e) {} }
    }
    if (light) {
      document.body.classList.add('light');
      C.bg = '#f6f2ea'; C.line = 'rgba(170,120,20,.45)'; C.lineDim = 'rgba(0,0,0,.10)';
      C.node = '#fff3df'; C.nodeDone = '#ffe6a8'; C.gold = '#b45309'; C.text = '#2a2320';
      C.dim = 'rgba(0,0,0,.35)';
    }
    C.light = light;
  }

  /* ---------------- IndexedDB ---------------- */
  function openDB() {
    return new Promise(function (res, rej) {
      try {
        if (!window.indexedDB) return rej(new Error('no-idb'));
        var rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'packId' });
        };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error || new Error('idb-open')); };
      } catch (e) { rej(e); }
    });
  }
  function dbAll(db) {
    return new Promise(function (res) {
      try {
        var rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        rq.onsuccess = function () { res(Array.prototype.slice.call(rq.result || [])); };
        rq.onerror = function () { res([]); };
      } catch (e) { res([]); }
    });
  }
  function dbPut(db, rec) {
    return new Promise(function (res) {
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }
  function dbDel(db, packId) {
    return new Promise(function (res) {
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(packId);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }

  /* ---------------- 进度（localStorage，按 nodeId+tier） ---------------- */
  function loadProg() {
    try { prog = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { prog = {}; }
  }
  function saveProg() {
    try { localStorage.setItem(KEY, JSON.stringify(prog)); } catch (e) {}
  }
  function nodeStars(nodeId) {
    var p = prog[nodeId] || {}, n = 0;
    ['basic', 'hard', 'hell'].forEach(function (k) { n += (+(p[k] && p[k].stars) || 0); });
    return n;
  }
  function nodePassed(nodeId) {
    var p = prog[nodeId] || {};
    return !!(p.basic && p.basic.passed);
  }

  /* ---------------- 导入包 ---------------- */
  function parseMeta(html) {
    var m = html.match(/<meta\s+name=["']yz-pack["']\s+content='([\s\S]*?)'\s*\/?>/i) ||
            html.match(/<meta\s+name=["']yz-pack["']\s+content="([\s\S]*?)"\s*\/?>/i);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  }
  function scanRisks(html) {
    var tips = [];
    var ext = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
    if (ext.length) tips.push('引用了 ' + ext.length + ' 处外部文件（离线打开会白屏）');
    if (/\bfetch\s*\(|XMLHttpRequest/.test(html)) tips.push('会尝试联网（本应用完全离线，相关功能不可用）');
    return tips;
  }

  function importFile(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) return toast('只支持 .html / .htm 单文件包');
    if (file.size > 30 * 1024 * 1024) return toast('文件超过 30MB，装不进地图');
    var fr = new FileReader();
    fr.onload = function () {
      var html = String(fr.result || '');
      var meta = parseMeta(html);
      if (!meta) return toast('这个文件里没有 <meta name="yz-pack">，不是本软件的关卡包');
      if (meta.schema !== 1) return toast('协议版本 ' + meta.schema + '，当前软件只支持 schema 1，请更新 App');
      if (!meta.packId || !Array.isArray(meta.nodes) || !meta.nodes.length) return toast('包的元数据不完整（缺 packId 或 nodes）');
      var tips = scanRisks(html);
      if (file.size > 4 * 1024 * 1024) tips.push('文件较大（' + (file.size / 1048576).toFixed(1) + 'MB），进关卡时可能等 2~5 秒');
      var msg = '导入《' + (meta.packTitle || meta.packId) + '》？\n\n' +
        '包含 ' + meta.nodes.length + ' 个关卡：' + meta.nodes.slice(0, 6).map(function (n) { return n.title; }).join('、') +
        (meta.nodes.length > 6 ? ' 等' : '') + '\n' +
        (tips.length ? '\n⚠ ' + tips.join('\n⚠ ') + '\n' : '') +
        '\n进度按关卡保存，重新导入新版本不会丢分。';
      if (!window.confirm(msg)) return;
      openDB().then(function (db) {
        return dbPut(db, {
          packId: meta.packId, title: meta.packTitle || meta.packId,
          version: meta.version || '0', meta: meta, html: html, addedAt: Date.now()
        });
      }).then(function (ok2) {
        if (!ok2) return toast('保存失败：本机存储不可用');
        toast('已导入《' + (meta.packTitle || meta.packId) + '》');
        boot();
      }).catch(function () { toast('本机存储不可用，无法保存'); });
    };
    fr.onerror = function () { toast('读文件失败'); };
    fr.readAsText(file);
  }

  /* ---------------- 布局：确定性（同数据同结果） ---------------- */
  function layout() {
    nodes = []; edges = [];
    var seen = {};
    packs.forEach(function (p) {
      (p.meta.nodes || []).forEach(function (n) {
        if (seen[n.id]) return;                    /* 同名节点只取第一次出现的定义 */
        seen[n.id] = 1;
        nodes.push({
          id: n.id, title: n.title, icon: n.icon || '🎯', kind: n.kind || 'normal',
          zone: n.zone || '未分类', preview: n.preview || '', graphNode: n.graphNode || '',
          tiers: n.tiers || {}, packId: p.packId
        });
      });
    });
    /* 按 zone 分组，zone 中心分布在大圆环上，组内节点分布在小圆环上 */
    var zs = [], zi = {};
    nodes.forEach(function (n) { if (!(n.zone in zi)) { zi[n.zone] = zs.length; zs.push({ name: n.zone, items: [] }); } zi[n.zone]; zs[zi[n.zone]].items.push(n); });
    var ZR = zs.length <= 1 ? 0 : (zs.length === 2 ? 220 : 300);
    zs.forEach(function (z, k) {
      var ang = -Math.PI / 2 + (k / zs.length) * Math.PI * 2;
      var zx = Math.cos(ang) * ZR, zy = Math.sin(ang) * ZR;
      z.cx = zx; z.cy = zy;
      var n = z.items.length, r = n <= 1 ? 0 : (n <= 4 ? 110 : 150);
      z.items.forEach(function (nd, i) {
        var a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        nd.x = zx + (n === 1 ? 0 : Math.cos(a) * r);
        nd.y = zy + (n === 1 ? 0 : Math.sin(a) * r);
        nd.zoneCx = zx; nd.zoneCy = zy;
      });
      /* 组内串联成一条线（顺序即声明顺序），表示推进方向 */
      for (var i = 1; i < z.items.length; i++) {
        edges.push({ a: z.items[i - 1].id, b: z.items[i].id });
      }
    });
    /* 不同区域之间连一条淡线，形成"图谱感" */
    for (var k = 1; k < zs.length; k++) {
      if (zs[k - 1].items[0] && zs[k].items[0]) edges.push({ a: zs[k - 1].items[0].id, b: zs[k].items[0].id, dim: 1 });
    }
  }

  function byId(id) { for (var i = 0; i < nodes.length; i++) if (nodes[i].id === id) return nodes[i]; return null; }

  /* ---------------- 绘制 ---------------- */
  function resize() {
    cv = $('cv'); ctx = cv.getContext('2d');
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    draw();
  }
  function S(n) { return { x: n.x * view.k + view.x, y: n.y * view.k + view.y }; }
  function nodeR(n) { return (n.kind === 'boss-big' ? 30 : n.kind === 'boss-small' ? 25 : 20); }

  function draw() {
    if (!ctx) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    /* 连线 */
    edges.forEach(function (e) {
      var a = byId(e.a), b = byId(e.b); if (!a || !b) return;
      var p = S(a), q = S(b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      var mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      ctx.quadraticCurveTo(mx, my - 26 * view.k, q.x, q.y);
      ctx.setLineDash(e.dim ? [3, 8] : [7, 7]);
      ctx.lineWidth = (e.dim ? 1 : 1.6) * Math.min(view.k, 1.4);
      ctx.strokeStyle = (nodePassed(e.a) ? C.line : C.lineDim);
      ctx.globalAlpha = e.dim ? 0.5 : 0.9;
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });

    /* 节点 */
    nodes.forEach(function (n) {
      var p = S(n), r = nodeR(n) * Math.min(view.k, 1.5);
      var passed = nodePassed(n.id), st = nodeStars(n.id);
      if (st >= 9) {                                     /* 满星：外圈光晕 */
        var g = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 2.3);
        g.addColorStop(0, 'rgba(245,197,24,.30)'); g.addColorStop(1, 'rgba(245,197,24,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.3, 0, Math.PI * 2); ctx.fill();
      }
      /* 主圆 */
      var g2 = ctx.createLinearGradient(p.x - r, p.y - r, p.x + r, p.y + r);
      if (passed) { g2.addColorStop(0, C.nodeDone); g2.addColorStop(1, C.light ? '#f7d27a' : '#6b3a06'); }
      else { g2.addColorStop(0, C.node); g2.addColorStop(1, C.light ? '#f3e6d2' : '#1b0404'); }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = g2; ctx.fill();
      ctx.lineWidth = selId === n.id ? 3 : 1.6;
      ctx.strokeStyle = selId === n.id ? C.gold : (passed ? 'rgba(245,197,24,.55)' : C.lineDim);
      ctx.stroke();
      /* 图标 */
      ctx.font = Math.round(r * 1.05) + 'px -apple-system,"Segoe UI Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n.icon, p.x, p.y + r * 0.04);
      /* 名称 */
      var fs = Math.max(10.5, Math.min(14, 12.5 * view.k));
      ctx.font = '600 ' + fs.toFixed(1) + 'px -apple-system,sans-serif';
      ctx.fillStyle = passed ? C.gold : C.text;
      ctx.globalAlpha = passed ? 1 : 0.82;
      ctx.fillText(n.title, p.x, p.y + r + fs * 1.05);
      /* 星级 */
      if (st > 0) {
        ctx.font = Math.round(fs * 0.8) + 'px sans-serif';
        ctx.fillStyle = C.gold; ctx.globalAlpha = 1;
        ctx.fillText('★'.repeat(Math.min(3, Math.ceil(st / 3))), p.x, p.y - r - fs * 0.9);
      }
      ctx.globalAlpha = 1;
    });
  }

  /* ---------------- 手势 ---------------- */
  var drag = null, pts = {}, pinch = null;
  function bindGestures() {
    cv.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (ids.length === 1) {
        drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      } else if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        drag = null;
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (pinch && ids.length >= 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var k2 = Math.max(0.25, Math.min(3, pinch.k * (d / (pinch.d || 1))));
        var wx = (pinch.cx - view.x) / view.k, wy = (pinch.cy - view.y) / view.k;
        view.k = k2;
        view.x = pinch.cx - wx * k2; view.y = pinch.cy - wy * k2;
        draw(); return;
      }
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
        view.x = drag.vx + dx; view.y = drag.vy + dy;
        draw();
      }
    });
    function up(e) {
      delete pts[e.pointerId];
      var ids = Object.keys(pts);
      if (ids.length < 2) pinch = null;
      if (drag) {
        var moved = drag.moved; drag = null;
        if (!moved) tap(e.clientX, e.clientY);
      }
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', function (e) { delete pts[e.pointerId]; drag = null; pinch = null; });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k2 = Math.max(0.25, Math.min(3, view.k * (e.deltaY > 0 ? 0.92 : 1.08)));
      var wx = (e.clientX - view.x) / view.k, wy = (e.clientY - view.y) / view.k;
      view.k = k2; view.x = e.clientX - wx * k2; view.y = e.clientY - wy * k2;
      draw();
    }, { passive: false });
  }

  function tap(mx, my) {
    var best = null, bd = 1e9;
    nodes.forEach(function (n) {
      var p = S(n), r = nodeR(n) * Math.min(view.k, 1.5) + 12;
      var d = Math.hypot(p.x - mx, p.y - my);
      if (d < r && d < bd) { bd = d; best = n; }
    });
    if (best) openSheet(best); else closeSheet();
  }

  /* ---------------- 底部卡片 ---------------- */
  function closeSheet() { selId = null; $('sheet').classList.remove('open'); draw(); }
  function openSheet(n) {
    selId = n.id; draw();
    var p = prog[n.id] || {};
    var total = 0, got = 0;
    ['basic', 'hard', 'hell'].forEach(function (k) {
      total += 3; got += (+(p[k] && p[k].stars) || 0);
    });
    var TIER = { basic: '基础', hard: '进阶', hell: '挑战' };
    var h = '<button class="x" onclick="YZC.closeSheet()">✕</button>' +
      '<div class="sn">' + esc(n.icon) + ' ' + esc(n.title) + '</div>' +
      '<div class="sz">' + esc(n.zone) +
      (n.kind === 'boss-small' ? ' · 小 BOSS' : n.kind === 'boss-big' ? ' · 大 BOSS' : ' · 普通关') +
      ' · 进度 ' + got + '/' + total + ' ★</div>' +
      (n.preview ? '<div class="sp2">' + esc(n.preview) + '</div>' : '') +
      '<div class="tiers">';
    ['basic', 'hard', 'hell'].forEach(function (k) {
      var t = n.tiers[k]; if (!t) return;
      var b = (p[k] || {});
      h += '<button class="tier' + (k === 'hell' ? ' hell' : '') + '" data-k="' + k + '">' +
        '<b>' + TIER[k] + '</b>' +
        '<i>' + t.draw + ' 题 · 需 ' + t.need + '</i>' +
        '<i>' + (b.best != null ? ('最好 ' + b.best + ' ' + '★'.repeat(b.stars || 0)) : '未挑战') + '</i>' +
        '</button>';
    });
    h += '</div>';
    var sh = $('sheet');
    sh.innerHTML = h;
    sh.classList.add('open');
    Array.prototype.forEach.call(sh.querySelectorAll('.tier'), function (b) {
      b.onclick = function () { play(n, b.getAttribute('data-k')); };
    });
  }

  /* ---------------- 播放器 ---------------- */
  var curNode = null;
  function play(n, tier) {
    var pk = null;
    for (var i = 0; i < packs.length; i++) if (packs[i].packId === n.packId) { pk = packs[i]; break; }
    if (!pk) return toast('找不到这个关卡所在的包');
    curNode = n;
    $('pName').textContent = n.title + ' · ' + ({ basic: '基础', hard: '进阶', hell: '挑战' })[tier];
    $('player').classList.add('on');
    $('game').style.display = 'block';
    /* 关键：**必须用 srcdoc，不能用 Blob URL**。
       iframe 带 sandbox（且按安全要求不授予 allow-same-origin）时，文档处在 opaque origin，
       浏览器会拒绝加载 blob: 资源 —— 表现就是关卡区一片黑 + 一个"破图"图标（用户实测）。
       srcdoc 在 sandbox 下是标准支持的：文档直接继承 sandbox 的 opaque origin。
       代价是整段 HTML 当字符串解析，几十 KB ~ 几 MB 都可用；超过 4MB 导入时会给出慢速提示。 */
    var f = $('game');
    try { f.removeAttribute('src'); } catch (e) {}
    f.srcdoc = injectBridge(pk.html, n.id, tier);
    $('pBack').onclick = function () { closePlayer(); };
    $('pReload').onclick = function () {
      f.srcdoc = '';
      setTimeout(function () { f.srcdoc = injectBridge(pk.html, n.id, tier); }, 30);
    };
  }
  /* 注入一段桥：告诉包"你现在在哪一关、哪一档"，并把 storage 兜住 */
  function injectBridge(html, nodeId, tier) {
    var boot = '<script>window.YZQ_BOOT=' + JSON.stringify({ nodeId: nodeId, tier: tier }) + ';<\/script>';
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, function (m) { return m + boot; });
    return boot + html;
  }
  function closePlayer() {
    $('player').classList.remove('on');
    var f = $('game');
    /* 必须真正清空内容，否则 WebGL / canvas 占的显存不释放，连开几个关卡会 OOM。
       注意用 srcdoc='' 而不是 src='about:blank'——后者会让下一次 srcdoc 赋值不生效。 */
    try { f.removeAttribute('src'); f.srcdoc = ''; } catch (e) {}
    curNode = null;
    draw();
  }

  /* ---------------- 宿主消息 ---------------- */
  function bindMessage() {
    window.addEventListener('message', function (e) {
      var f = $('game');
      if (!f || e.source !== f.contentWindow) return;      /* 只认这个 iframe */
      var m = e.data;
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;   /* 畸形消息静默丢弃 */
      if (m.t === 'yz:win') {
        var total = Math.max(1, +m.total || 1);
        var score = Math.max(0, Math.min(+m.score || 0, total));   /* 分数钳制 */
        var rate = score / total;
        var st = rate >= 0.95 ? 3 : rate >= 0.8 ? 2 : rate >= 0.6 ? 1 : 0;
        var nodeId = String(m.nodeId || (curNode && curNode.id) || '');
        var tier = ['basic', 'hard', 'hell'].indexOf(m.tier) >= 0 ? m.tier : 'basic';
        if (!nodeId) return;
        var p = prog[nodeId] || {};
        var old = p[tier] || {};
        p[tier] = {
          best: Math.max(old.best || 0, score), stars: Math.max(old.stars || 0, st),
          passed: !!(old.passed || m.passed || score >= 1), plays: (old.plays || 0) + 1, at: Date.now()
        };
        prog[nodeId] = p; saveProg();
        if ($('player').classList.contains('on')) {
          setTimeout(function () { closePlayer(); openSheet(byId(nodeId) || curNode); }, 260);
        }
      } else if (m.t === 'yz:exit') {
        closePlayer();
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    openDB().then(function (db) {
      return dbAll(db).then(function (arr) {
        packs = (arr || []).sort(function (a, b) { return (a.addedAt || 0) - (b.addedAt || 0); });
        layout();
        fitAll();
        draw();
        emptyState();
        return db;
      });
    }).catch(function () {
      packs = []; layout(); draw(); emptyState();
    });
  }
  function emptyState() {
    var ex = document.getElementById('emptybox');
    if (nodes.length) { if (ex) ex.remove(); return; }
    if (ex) return;
    var d = document.createElement('div');
    d.id = 'emptybox'; d.className = 'emptybox';
    d.innerHTML = '<div class="e1">🎮</div><div class="e2">还没有关卡</div>' +
      '<div class="e3">点右上角「＋ 导入包」，选择一个 .html 关卡包。<br>软件只负责地图与记录，题目都在包里。</div>';
    document.body.appendChild(d);
  }
  function fitAll() {
    if (!nodes.length) { view = { x: W / 2, y: H / 2, k: 1 }; return; }
    var xs = nodes.map(function (n) { return n.x; }), ys = nodes.map(function (n) { return n.y; });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var w = Math.max(120, maxx - minx), h = Math.max(120, maxy - miny);
    view.k = Math.max(0.35, Math.min(Math.min((W - 120) / w, (H - 220) / h), 1.6));
    view.x = W / 2 - (minx + maxx) / 2 * view.k;
    view.y = H / 2 - (miny + maxy) / 2 * view.k;
  }

  window.YZC = { closeSheet: closeSheet, fit: function () { fitAll(); draw(); }, boot: boot };
  window.addEventListener('resize', function () { resize(); });
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
  document.addEventListener('DOMContentLoaded', function () {
   try {
    initTheme(); loadProg(); resize(); bindGestures(); bindMessage();
    /* input 已经铺在按钮上，用户点到的就是它本身；这里只处理"选完之后"。
       另外保留一个 click 兜底（部分环境 label/覆盖层点击没传下去时仍可用）。 */
    var pk = $('picker');
    pk.onchange = function () {
      var f = this.files && this.files[0];
      this.value = '';
      importFile(f);
    };
    var wrap = document.querySelector('.impwrap');
    if (wrap) wrap.addEventListener('click', function (e) {
      if (e.target === pk) return;          /* 直接点在 input 上，交给原生 */
      try { pk.click(); } catch (x) {}
    });
    boot();
   } catch (err) {
    /* 任何启动异常都不能把页面留在"载入中"——那样整屏被盖住，点哪儿都没反应 */
    showErr((err && err.message) || String(err));
   } finally {
    setTimeout(function () { var l = $('loading'); if (l) l.classList.add('off'); }, 260);
   }
  });
})();
