/* 学通 · 内容包（自 0.17.37 起由「闯关」更名）
   ------------------------------------------------------------------
   定位：这是一个「可扩展内容」机制，不是游戏。用户自己做一个 HTML 页面
   （课件、测验、时间轴推演、地图沙盘、任何交互页面），导入 App 里全屏运行。
   软件只提供三件事：包库管理、沙箱容器、以及「打开书库条目 / 记一条统计 / 退出」三个桥。
   ------------------------------------------------------------------
   本文件只做四件事：
     1. 包库管理（IndexedDB yzy_packs：导入 / 列出 / 删除）
     2. 导入时扫描危险模式（包现在能读本机数据，必须提示 + 拦截明显越权）
     3. 打开包：srcdoc 注入 YZQ_BOOT，全屏 iframe（allow-same-origin）
     4. 收消息：yz:win 记统计、yz:openBook 跳书库、yz:exit 回列表

   ★ 地图、节点、连线、手势、卡片、解锁、星级、存档 —— 全部在包内，
     本文件一行都不参与。App 的角色是浏览器，不是运行时。
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* 主色随主题（浅色时换一套） */
  var C = { gold: '#f5c518' };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function showErr(msg) {
    var b = $('errbar'); if (!b) return;
    b.textContent = String(msg || ''); b.classList.add('on');
    setTimeout(function () { b.classList.remove('on'); }, 6000);
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = String(msg || ''); t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1800);
  }
  window.addEventListener('error', function (e) { showErr('页面脚本错误：' + (e.message || e)); });

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    var t = 'auto';
    try { t = localStorage.getItem('theme') || 'auto'; } catch (e) {}
    var dark = true;
    if (t === 'dark') dark = true;
    else if (t === 'light') dark = false;
    else {
      try {
        if (window.AndroidApp && AndroidApp.systemDark) dark = AndroidApp.systemDark() === '1';
        else dark = !window.matchMedia || !window.matchMedia('(prefers-color-scheme: light)').matches;
      } catch (e) { dark = true; }
    }
    var bg = dark ? '#170303' : '#f6f2ea', fg = dark ? '#e8e8ea' : '#2a2118';
    C.gold = dark ? '#f5c518' : '#b8860b';
    document.documentElement.style.setProperty('--bg', bg);
    document.documentElement.style.setProperty('--fg', fg);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', bg);
  }

  /* ---------------- 包库（IndexedDB） ---------------- */
  var DB = null;
  function openDB(cb) {
    if (DB) return cb(DB);
    try {
      var r = indexedDB.open('yzy_packs', 1);
      /* 用 r.result 而不是 e.target.result：部分环境（含测试替身）回调不传 event */
      r.onupgradeneeded = function () {
        var db = r.result;
        if (db && !db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'packId' });
      };
      r.onsuccess = function () { DB = r.result; cb(DB); };
      r.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }
  function dbAll(cb) {
    openDB(function (db) {
      if (!db) return cb([]);
      try {
        var t = db.transaction('packs', 'readonly').objectStore('packs').getAll();
        t.onsuccess = function () { cb(t.result || []); };
        t.onerror = function () { cb([]); };
      } catch (e) { cb([]); }
    });
  }
  function dbPut(rec, cb) {
    openDB(function (db) {
      if (!db) return cb && cb(false);
      try {
        var st = db.transaction('packs', 'readwrite').objectStore('packs');
        st.put(rec);
        st.transaction.oncomplete = function () { cb && cb(true); };
        st.transaction.onerror = function () { cb && cb(false); };
      } catch (e) { cb && cb(false); }
    });
  }
  function dbDel(id, cb) {
    openDB(function (db) {
      if (!db) return cb && cb();
      try {
        var st = db.transaction('packs', 'readwrite').objectStore('packs');
        st.delete(id);
        st.transaction.oncomplete = function () { cb && cb(); };
        st.transaction.onerror = function () { cb && cb(); };
      } catch (e) { cb && cb(); }
    });
  }

  /* ---------------- 进度（包存在 localStorage，App 只读来显示摘要） ----------------
     包内用 yzq_best_<nodeId>_<tier> = {best, stars, passed}，同源可直接读。 */
  function readProg(meta) {
    var pid = (meta && meta.packId) || '';
    var nodes = (meta && meta.nodes) || [], got = 0, total = nodes.length * 3, done = 0;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      ['basic', 'hard', 'hell'].forEach(function (k) {
        if (!n.tiers || !n.tiers[k]) return;
        try {
          var raw = progGet(pid, 'yzq_best_' + n.id + '_' + k);
          if (!raw) return;
          var b = JSON.parse(raw);
          got += (+b.stars || 0);
          if (b.passed) done++;
        } catch (e) {}
      });
    }
    return { stars: got, done: done, total: total };
  }
  function lastPlayed(meta) {
    var pid = (meta && meta.packId) || '';
    var t = 0, nodes = (meta && meta.nodes) || [];
    for (var i = 0; i < nodes.length; i++) {
      ['basic', 'hard', 'hell'].forEach(function (k) {
        try {
          var raw = progGet(pid, 'yzq_best_' + nodes[i].id + '_' + k);
          if (raw) {
            var b = JSON.parse(raw);
            if (b.at && b.at > t) t = b.at;
          }
        } catch (e) {}
      });
    }
    return t;
  }

  /* ---------------- 元数据 / 安全检查 ---------------- */
  function parseMeta(html) {
    var m = html.match(/<meta\s+name=["']yz-pack["']\s+content='([\s\S]*?)'\s*\/?>/i) ||
            html.match(/<meta\s+name=["']yz-pack["']\s+content="([\s\S]*?)"\s*\/?>/i) ||
            html.match(/<meta\s+content='([\s\S]*?)'\s+name=["']yz-pack["']\s*\/?>/i);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) {
      try { return JSON.parse(m[1].replace(/&quot;/g, '"')); } catch (e2) { return null; }
    }
  }

  /* 包现在与 App 同源（要自己存档），因此必须拦住明显越权的东西。
     不追求百分百（做不到），只把「一眼就知道要干坏事」的挑出来让用户确认。 */
  var RISK = [
    { re: /parent\s*\.\s*document|top\s*\.\s*document|window\s*\.\s*top\s*\.\s*document/i, why: '试图读写 App 页面（parent/top.document）' },
    { re: /top\s*\.\s*location|window\s*\.\s*top\s*\.\s*location|parent\s*\.\s*location\s*=/i, why: '试图把 App 跳转到别的页面' },
    { re: /document\s*\.\s*cookie/i, why: '读写 cookie' },
    { re: /<script[^>]+src\s*=\s*["']https?:/i, why: '引用外部脚本' },
    { re: /new\s+Worker\s*\(/i, why: '创建 Worker（可能绕过沙箱）' },
    { re: /<iframe[^>]+src\s*=\s*["']https?:/i, why: '内嵌外部页面' }
  ];
  function scanRisks(html) {
    var out = [];
    RISK.forEach(function (r) { if (r.re.test(html)) out.push(r.why); });
    return out;
  }

  /* ---------------- 导入 ---------------- */
  function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var html = String(fr.result || '');
      if (html.length > 8 * 1024 * 1024) return toast('包太大（>8MB）');
      var meta = parseMeta(html);
      var loose = false;                 /* 宽松模式：没有 yz-pack 也照样能跑 */
      if (!meta) {
        /* 用户要求：不强制校验「是本软件的包」。
           任意 HTML 都能导入，App 当它是一个黑盒网页来跑。
           有 meta 时才有节点数、版本、进度摘要这些额外信息。 */
        loose = true;
        var rawName = (file && file.name) || '未命名页';
        meta = {
          schema: 1,
          packId: 'file_' + Math.abs(hash32(String(file && file.name || '') + html.length)).toString(36),
          packTitle: rawName.replace(/\.html?$/i, ''),
          version: '—',
          nodes: []
        };
      } else if (meta.schema !== 1) {
        return toast('协议版本 ' + meta.schema + '，当前只支持 schema 1');
      } else if (!meta.packId || !Array.isArray(meta.nodes) || !meta.nodes.length) {
        /* 有 meta 但字段残缺 —— 降级为宽松模式，不拦 */
        meta.packId = meta.packId || ('file_' + Math.abs(hash32(String(file && file.name || '') + html.length)).toString(36));
        meta.packTitle = meta.packTitle || String(file && file.name || '未命名包').replace(/\.html?$/i, '');
        meta.nodes = Array.isArray(meta.nodes) ? meta.nodes : [];
        loose = true;
      }

      var risks = scanRisks(html);
      var msg = '导入《' + (meta.packTitle || meta.packId) + '》？\n\n' +
        (loose
          ? '这是一个普通网页（没有关卡包元数据），会以「整页运行」的方式装进来。\n'
          : '包含 ' + meta.nodes.length + ' 个关卡：' + meta.nodes.slice(0, 5).map(function (n) { return n.title; }).join('、') +
            (meta.nodes.length > 5 ? ' 等' : '') + '\n') +
        '版本 ' + (meta.version || '—') + '\n\n' +
        '⚠️ 内容在独立沙箱中运行：读不到 App 的任何数据（书库、存档、书签），也无法联网。\n' +
        '进度由软件代为保存。仍建议只导入你自己制作或信任来源的文件。';
      if (risks.length) msg += '\n\n⛔ 检测到可疑行为：\n· ' + risks.join('\n· ') + '\n\n仍要导入吗？';
      if (!confirm(msg)) return;

      dbPut({
        packId: meta.packId, title: meta.packTitle || meta.packId,
        version: meta.version || '0', meta: meta, html: html,
        addedAt: Date.now(), risks: risks, loose: loose
      }, function (ok) {
        if (!ok) return toast('保存失败（本机存储不可用）');
        toast('已导入《' + (meta.packTitle || meta.packId) + '》');
        renderList();
      });
    };
    fr.onerror = function () { toast('读取文件失败'); };
    fr.readAsText(file);
  }

  /* ---------------- 列表 ---------------- */
  function renderList() {
    dbAll(function (packs) {
      var box = $('list');
      if (!packs.length) {
        box.innerHTML = '';
        /* 先清掉可能残留的空状态块，避免多次 renderList 叠出好几个 */
        Array.prototype.forEach.call(document.querySelectorAll('.emptybox'), function (old) {
          if (old && old.parentNode) old.parentNode.removeChild(old);
        });
        var e = document.createElement('div');
        e.className = 'emptybox';
        e.innerHTML = '<div class="e1">🎮</div>' +
          '<div class="e2">还没有导入任何内容包</div>' +
          '<div class="e3">内容包就是一个 <b>.html</b> 文件——自制课件、学习卡片、测验、' +
          '地图推演都行。点右上角「＋ 导入包」选一个，它会在 App 里全屏运行。<br>' +
          '<span style="opacity:.7">界面、题目、进度全由包自己提供，软件只负责把它跑起来；' +
          '包没有联网能力（App 本身就没有网络权限）。</span></div>';
        document.body.appendChild(e);
        return;
      }
      var old = document.querySelector('.emptybox'); if (old) old.remove();

      packs.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
      var h = '';
      packs.forEach(function (p) {
        var pr = readProg(p.meta);
        var lp = lastPlayed(p.meta);
        h += '<div class="pack" data-id="' + esc(p.packId) + '">' +
          '<span class="ic">🎯</span>' +
          '<span class="mid"><b>' + esc(p.title) + '</b>' +
          '<i>' + (p.loose ? '整页运行' : ((p.meta.nodes || []).length + ' 关')) + ' · v' + esc(p.version) +
          (lp ? ' · ' + new Date(lp).toLocaleDateString() : '') + '</i>' +
          '<u>' + (p.loose ? '普通网页 · 内容与进度由页面自己管理' : '按关卡推进，三档（基础/进阶/挑战）互不锁定') + '</u></span>' +
          '<span class="st">' + (pr.done > 0 ? (pr.stars + '★') : '未开始') + '</span>' +
          '<button class="del" data-del="' + esc(p.packId) + '" title="删除">✕</button>' +
          '</div>';
      });
      box.innerHTML = h;

      Array.prototype.forEach.call(box.querySelectorAll('.pack'), function (el) {
        el.onclick = function (e) {
          if (e.target && e.target.getAttribute && e.target.getAttribute('data-del')) return;
          var id = el.getAttribute('data-id'), pack = null;
          packs.forEach(function (p) { if (p.packId === id) pack = p; });
          if (pack) openPack(pack);
        };
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (b) {
        b.onclick = function (e) {
          e.stopPropagation();
          var id = b.getAttribute('data-del');
          if (!confirm('删除这个关卡包？\n（包内的进度也会一并清掉）')) return;
          /* 只清这个包的节点进度。早期版本这里无差别清掉所有 yzq_best_*，
             多包共存时会把别的包的进度一起删掉。 */
          var target = null;
          packs.forEach(function (p) { if (p.packId === id) target = p; });
          var nodeIds = ((target && target.meta && target.meta.nodes) || []).map(function (n) { return n.id; });
          dbDel(id, function () {
            pkClear(id);                                  /* 新版：只清这个包的分区键 */
            try {
              var keys = [];
              for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (!k || k.indexOf('yzq_best_') !== 0) continue;
                for (var j = 0; j < nodeIds.length; j++) {
                  if (k.indexOf('_' + nodeIds[j] + '_') >= 0) { keys.push(k); break; }
                }
              }
              keys.forEach(function (k) { localStorage.removeItem(k); });
            } catch (err) {}
            toast('已删除');
            renderList();
          });
        };
      });
    });
  }

  /* ---------------- 沙箱存档桥（2026-11-07） ----------------
     背景：iframe 原来是 allow-scripts + allow-same-origin，等于没有沙箱 ——
     包里的脚本能读 parent.document、直接读写 App 的 localStorage、还能调原生桥。
     现在去掉 allow-same-origin（iframe 变成 opaque origin），parent.document / cookie /
     localStorage 全部抛 SecurityError，隔离才成立。

     代价：包不能再用 localStorage 直接存档。实测（Chromium）在 opaque origin 下
     `Object.defineProperty(window,'localStorage',…)` 仍然成功，所以这里注入一个内存版
     localStorage：读同步走内存、写同步更新内存 + postMessage 交给父页落盘。
     旧包不用改一个字，键名与语义都不变。 */
  var SHIM = '(function(){' +
    'var SEED=window.__YZQ_SEED||{},mem={},has=Object.prototype.hasOwnProperty;' +
    'Object.keys(SEED).forEach(function(k){mem[k]=String(SEED[k]);});' +
    'function post(d){try{d.__yzq=1;parent.postMessage(d,"*");}catch(e){}}' +
    'var LS={' +
      'getItem:function(k){k=String(k);return has.call(mem,k)?mem[k]:null;},' +
      'setItem:function(k,v){k=String(k);v=String(v);mem[k]=v;post({t:"yzq:set",k:k,v:v});},' +
      'removeItem:function(k){k=String(k);delete mem[k];post({t:"yzq:del",k:k});},' +
      'clear:function(){Object.keys(mem).forEach(function(k){delete mem[k];});post({t:"yzq:clear"});},' +
      'key:function(i){var ks=Object.keys(mem);return (i>=0&&i<ks.length)?ks[i]:null;}' +
    '};' +
    'try{Object.defineProperty(LS,"length",{get:function(){return Object.keys(mem).length;}});}catch(e){}' +
    'try{Object.defineProperty(window,"localStorage",{value:LS,configurable:true});}catch(e){}' +
    'try{Object.defineProperty(window,"sessionStorage",{value:LS,configurable:true});}catch(e){}' +
  '})();';

  /* ---------------- 存档分区（2026-11-13） ----------------
     旧版把所有内容包的进度平铺在 yzq_* 上：包 A 打开时喂进去的是**全部** yzq_*，
     包内 localStorage.clear() 会把所有包的进度一起删掉，节点 id 相同的两个包还会
     互相覆盖。现在物理键统一加 yzq@<packId>@ 前缀，包里的代码不用改（它仍写
     yzq_*，前缀只在落盘/读出时加剥）。
     旧平铺键不删：首次打开某个包时复制一份进它的命名空间（只复制一次），
     认领给了错的包也不会丢数据。 */
  var PK_SEP = '@';
  function pkPre(pid) { return 'yzq' + PK_SEP + pid + PK_SEP; }
  function pkKey(pid, k) { return pkPre(pid) + String(k); }
  function pkGet(pid, k) { try { return localStorage.getItem(pkKey(pid, k)); } catch (e) { return null; } }
  function pkSet(pid, k, v) { try { localStorage.setItem(pkKey(pid, k), String(v)); } catch (e) {} }
  function pkDel(pid, k) { try { localStorage.removeItem(pkKey(pid, k)); } catch (e) {} }
  function pkKeys(pid) {
    var pre = pkPre(pid), out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(pre) === 0) out.push(k.slice(pre.length));
      }
    } catch (e) {}
    return out;
  }
  function pkClear(pid) {
    var ks = pkKeys(pid), pre = pkPre(pid);
    for (var i = 0; i < ks.length; i++) { try { localStorage.removeItem(pre + ks[i]); } catch (e) {} }
  }
  /* 把 App 里已有关卡的存档喂回给包（只给这个包自己的） */
  function packSeed(pid) {
    var o = {}, ks = pid ? pkKeys(pid) : [];
    for (var i = 0; i < ks.length; i++) {
      var v = pkGet(pid, ks[i]);
      if (v != null) o[ks[i]] = v;
    }
    return o;
  }
  /* 旧版平铺键的一次性认领 */
  function pkClaim(pid) {
    if (!pid) return;
    try {
      if (localStorage.getItem('yzq_claim_' + pid)) return;
      var legacy = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('yzq_') !== 0) continue;
        if (k.indexOf('yzq' + PK_SEP) === 0) continue;          /* 已经是分区键 */
        if (k.indexOf('yzq_claim_') === 0) continue;
        if (k.indexOf('yzq_last_') === 0) continue;             /* App 自己的打开记录 */
        legacy.push(k);
      }
      for (var j = 0; j < legacy.length; j++) {
        var vv = localStorage.getItem(legacy[j]);
        if (vv != null) pkSet(pid, legacy[j], vv);
      }
      localStorage.setItem('yzq_claim_' + pid, '1');
    } catch (e) {}
  }
  function progGet(pid, k) {
    if (pid) { var v = pkGet(pid, k); if (v != null) return v; }
    try { return localStorage.getItem(k); } catch (e) { return null; }   /* 兼容未认领的旧键 */
  }

  function buildBoot(p) {
    /* 内容包沙箱第一道闸（0.18.47）：原生桥是注入到**每个 frame** 的，
       iframe 加了 sandbox 也拿得到（Android 官方文档：any frame could obtain the
       object name and call methods on it）。内容包本来就不需要桥（存档走
       postMessage 交给父页），所以进来第一件事就是把桥从本 frame 的全局抹掉。
       抹不掉也不影响主页面，只是这条兜底失效——真正的彻底隔离要等下一版用
       不带桥的独立 WebView 承载内容包。 */
    var shield = 'try{delete window.AndroidApp}catch(e){}'
               + 'try{Object.defineProperty(window,"AndroidApp",{value:undefined,writable:false,configurable:false})}catch(e){}'
               + 'try{window.AndroidApp=undefined}catch(e){}';
    pkClaim(p.packId);
    return '<script>' + shield + 'window.YZQ_BOOT=' + JSON.stringify({ packId: p.packId, version: p.version }) +
           ';window.__YZQ_SEED=' + JSON.stringify(packSeed(p.packId)) + ';' + SHIM + '<\/script>';
  }

  /* ---------------- 独立 WebView 模式的启动脚本（0.18.48 / A7） ----------------
     无桥环境里原生 localStorage 是可用的（独立 origin https://yzpack.local），
     所以不需要内存版 shim：能存就直接存，存不了才退内存。
     seed 只在**首次**写入，否则每次打开都会把进度冲回打开前的快照。 */
  function buildStandaloneBoot(p) {
    pkClaim(p.packId);
    var seed = packSeed(p.packId);
    /* 独立 WebView 用同一个 origin（https://yzpack.local），localStorage 是所有包共享的。
       所以这里把 localStorage 包装一层：包看到的仍是 yzq_*，物理键多了 yzq@<packId>@ 前缀，
       clear()/length/key() 都只作用于本包。__yzq_seeded 也按包区分（旧版是全局标记，
       第二个包裹进来就不再 seed）。 */
    return '<script>window.YZQ_BOOT=' + JSON.stringify({ packId: p.packId, version: p.version }) +
      ';window.__YZQ_SEED=' + JSON.stringify(seed) + ';' +
      '(function(){' +
        'var SEED=window.__YZQ_SEED||{},PID=window.YZQ_BOOT.packId,PRE=\"yzq@\"+PID+\"@\";' +
        'var mem={},has=Object.prototype.hasOwnProperty,ok=false,real=null;' +
        'try{real=window.localStorage;real.setItem(PRE+\"__probe\",\"1\");real.removeItem(PRE+\"__probe\");ok=true;}catch(e){ok=false;}' +
        'function ownKeys(){var ks=[];if(ok){for(var i=0;i<real.length;i++){var k=real.key(i);if(k&&k.indexOf(PRE)===0)ks.push(k.slice(PRE.length));}}else{ks=Object.keys(mem);}return ks;}' +
        'var LS=ok?{' +
          'getItem:function(k){k=String(k);try{return real.getItem(PRE+k);}catch(e){return null;}},' +
          'setItem:function(k,v){k=String(k);try{real.setItem(PRE+k,String(v));}catch(e){}},' +
          'removeItem:function(k){k=String(k);try{return real.removeItem(PRE+k);}catch(e){}},' +
          'clear:function(){var ks=ownKeys();for(var i=0;i<ks.length;i++){try{real.removeItem(PRE+ks[i]);}catch(e){}}},' +
          'key:function(i){var ks=ownKeys();return (i>=0&&i<ks.length)?ks[i]:null;}' +
        '}:{' +
          'getItem:function(k){k=String(k);return has.call(mem,k)?mem[k]:null;},' +
          'setItem:function(k,v){mem[String(k)]=String(v);},removeItem:function(k){delete mem[String(k)];},' +
          'clear:function(){mem={};},key:function(i){var ks=Object.keys(mem);return (i>=0&&i<ks.length)?ks[i]:null;}' +
        '};' +
        'try{Object.defineProperty(LS,\"length\",{get:function(){return ownKeys().length;}});}catch(e){}' +
        'Object.keys(SEED).forEach(function(k){if(LS.getItem(k)===null)LS.setItem(k,String(SEED[k]));});' +
        'try{Object.defineProperty(window,\"localStorage\",{value:LS,configurable:true});}catch(e){}' +
        'try{Object.defineProperty(window,\"sessionStorage\",{value:LS,configurable:true});}catch(e){}' +
      '})();' +
      '<\/script>';
  }

  /* 内容包退出后，原生把存档交回来 → 写回主站 localStorage（进度显示不受影响） */
  window.__yzqAbsorb = function (json, pid) {
    try {
      var o = JSON.parse(json || '{}'), pre = pid ? pkPre(pid) : '';
      Object.keys(o).forEach(function (k) {
        if (k.indexOf('yzq_') === 0) { try { localStorage.setItem(pre + k, String(o[k])); } catch (e) {} }
      });
      try { renderList(); } catch (e) {}
    } catch (e) {}
  };

  /* ---------------- 打开 / 关闭 ---------------- */
  var curPack = null;
  function openPack(p) {
    curPack = p;
    /* 首选：交给不带桥的独立 WebView（0.18.48）。任何异常都自动降级回 iframe。 */
    try {
      if (window.AndroidApp && typeof window.AndroidApp.openPack === 'function') {
        window.AndroidApp.openPack(JSON.stringify({
          id: p.packId, title: p.title, version: p.version,
          html: buildStandaloneBoot(p) + p.html
        }));
        return;
      }
    } catch (e) { /* 落到下面的 iframe */ }
    $('pName').textContent = p.title + ' · v' + p.version;
    $('player').classList.add('on');
    $('loading').classList.remove('off');
    var f = $('game');
    f.removeAttribute('src');
    /* 注入启动参数 + 存档桥：包自己决定从哪开始（地图 / 继续上次） */
    f.srcdoc = buildBoot(p) + p.html;
    setTimeout(function () { $('loading').classList.add('off'); }, 900);
  }
  function closePlayer() {
    var f = $('game');
    f.srcdoc = '';                      /* 清空，避免下次 srcdoc 不生效 */
    $('player').classList.remove('on');
    curPack = null;
    renderList();
  }

  /* ---------------- 消息 ---------------- */
  function bindMessage() {
    window.addEventListener('message', function (e) {
      var f = $('game');
      if (!f || e.source !== f.contentWindow) return;
      var m = e.data;
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;

      /* 存档桥：包在无 same-origin 的沙箱里只能发消息，落盘由父页做。
         只接受 yzq_ 前缀 —— 不允许包往 App 的其它键里写任何东西。 */
      if (m.t === 'yzq:set' || m.t === 'yzq:del' || m.t === 'yzq:clear') {
        var bp = curPack && curPack.packId;
        if (!bp) return;                       /* 没有当前包就不落盘，免得串到别人 */
        try {
          if (m.t === 'yzq:clear') {
            pkClear(bp);                        /* 只清这个包的分区键 */
          } else {
            var pk = String(m.k || '');
            if (pk.indexOf('yzq_') !== 0) return;
            if (m.t === 'yzq:set') pkSet(bp, pk, String(m.v == null ? '' : m.v).slice(0, 20000));
            else pkDel(bp, pk);
          }
        } catch (err) {}
        return;
      }

      if (m.t === 'yz:ready') {
        /* 包自报「起来了」——立刻撤掉载入遮罩，比死等 900ms 更准 */
        $('loading').classList.add('off');
      } else if (m.t === 'yz:win') {
        /* 包内已自己存档；这里只记一次「打开过」，供列表显示最近时间 */
        try { localStorage.setItem('yzq_last_' + (m.packId || ''), String(Date.now())); } catch (err) {}
      } else if (m.t === 'yz:exit') {
        closePlayer();
      } else if (m.t === 'yz:openBook') {
        var title = String(m.title || '').replace(/[<>"'&]/g, '').slice(0, 60);
        if (!title) return;
        closePlayer();
        location.href = 'index.html?q=' + encodeURIComponent(title);
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    try { initTheme(); } catch (e) {}
    $('picker').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) importFile(f);
    };
    $('pBack').onclick = closePlayer;
    $('pReload').onclick = function () {
      if (!curPack) return;
      $('loading').classList.remove('off');
      var f = $('game');
      f.srcdoc = '';
      setTimeout(function () {
        f.srcdoc = buildBoot(curPack) + curPack.html;
        setTimeout(function () { $('loading').classList.add('off'); }, 700);
      }, 60);
    };
    bindMessage();
    renderList();
    setTimeout(function () { $('loading').classList.add('off'); }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.YZC = {
    close: closePlayer, reload: renderList, boot: renderList,
    /* 存档分区的测试钩子（tests/pack_scope_test.js 用）。生产路径不读它。
       挂在 YZC 下而不是新增 window.__yzqScope —— 门禁要求新增能力进统一命名空间。 */
    scope: {
      pre: pkPre, get: pkGet, set: pkSet, del: pkDel,
      keys: pkKeys, clear: pkClear, seed: packSeed, claim: pkClaim,
    },
  };
})();
