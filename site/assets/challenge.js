/* 学通闯关 · App 侧（已退化为「包列表 + 容器」）
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
    var nodes = (meta && meta.nodes) || [], got = 0, total = nodes.length * 3, done = 0;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      ['basic', 'hard', 'hell'].forEach(function (k) {
        if (!n.tiers || !n.tiers[k]) return;
        try {
          var raw = localStorage.getItem('yzq_best_' + n.id + '_' + k);
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
    var t = 0, nodes = (meta && meta.nodes) || [];
    for (var i = 0; i < nodes.length; i++) {
      ['basic', 'hard', 'hell'].forEach(function (k) {
        try {
          var raw = localStorage.getItem('yzq_best_' + nodes[i].id + '_' + k);
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
        '⚠️ 内容与 App 同源运行，可以读取本机的书库与记录（但无法联网外传）。\n' +
        '请只导入你自己制作或信任来源的文件。';
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
          '<div class="e2">还没有导入任何关卡包</div>' +
          '<div class="e3">点右上角「＋ 导入包」选择一个 .html 文件。<br>' +
          '关卡、地图、题目、进度全部由包自己提供，软件只负责把它跑起来。</div>';
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

  /* ---------------- 打开 / 关闭 ---------------- */
  var curPack = null;
  function openPack(p) {
    curPack = p;
    $('pName').textContent = p.title + ' · v' + p.version;
    $('player').classList.add('on');
    $('loading').classList.remove('off');
    var f = $('game');
    f.removeAttribute('src');
    /* 注入启动参数：包自己决定从哪开始（地图 / 继续上次） */
    var boot = '<script>window.YZQ_BOOT=' + JSON.stringify({ packId: p.packId, version: p.version }) + ';<\/script>';
    f.srcdoc = boot + p.html;
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
        var bootJs = '<script>window.YZQ_BOOT=' + JSON.stringify({ packId: curPack.packId, version: curPack.version }) + ';<\/script>';
        f.srcdoc = bootJs + curPack.html;
        setTimeout(function () { $('loading').classList.add('off'); }, 700);
      }, 60);
    };
    bindMessage();
    renderList();
    setTimeout(function () { $('loading').classList.add('off'); }, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.YZC = { close: closePlayer, reload: renderList, boot: renderList };
})();
