/* =====================================================================
   学通 · 阅读层（reading.js）
   ---------------------------------------------------------------------
   三件事，全部本机、随「导出我的数据」一起走：
     ① 阅读状态与书架：想读 / 在读 / 读完 + 进度百分比
     ② 书摘与笔记：一处摘录、一处自己的话
     ③ 首页「我的」模块的数据来源（书架 / 最近书摘 / 收藏）

   数据键（localStorage）：
     yzRead     { <bookId>: { st:'want'|'reading'|'done', p:0-100, t:时间戳 } }
     yzExcerpts [ { b:<bookId>, txt:'摘录', note:'我的想法', t:时间戳 } ]
   ===================================================================== */
(function () {
  'use strict';

  var K_READ = 'yzRead', K_EXC = 'yzExcerpts';
  var ST = [
    { k: 'want', name: '想读', icon: '📌' },
    { k: 'reading', name: '在读', icon: '📖' },
    { k: 'done', name: '读完', icon: '✅' }
  ];

  function ls(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function lset(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function books() { return (window.SITE_RESOURCES || []); }
  function bookById(id) { return books().find(function (x) { return x.id === id; }); }

  /* ---------------- 阅读状态 ---------------- */
  function all() { return ls(K_READ, {}) || {}; }
  function state(id) { var a = all(); return a[id] || null; }
  function setState(id, st, p) {
    if (!id) return false;
    var a = all();
    if (!st) delete a[id];
    else {
      var prev = a[id] || {};
      a[id] = { st: st, p: (p === undefined ? (prev.p || 0) : Math.max(0, Math.min(100, parseInt(p, 10) || 0))), t: Date.now() };
    }
    lset(K_READ, a);
    return true;
  }
  function setProgress(id, p) {
    var s = state(id);
    if (!s) return setState(id, 'reading', p);
    return setState(id, s.st, p);
  }
  function statusOf(id) { var s = state(id); return s ? s.st : ''; }
  function statusChipHTML(id) {
    var s = state(id); if (!s) return '';
    var m = ST.find(function (x) { return x.k === s.st; });
    if (!m) return '';
    return '<span class="tag" style="font-size:.7rem;padding:1px 7px;margin-left:6px;border-color:var(--accent);color:var(--accent)">' +
      m.icon + ' ' + m.name + (s.st === 'reading' && s.p ? ' ' + s.p + '%' : '') + '</span>';
  }

  /* ---------------- 书摘 ---------------- */
  function excerpts(bookId) {
    var a = ls(K_EXC, []) || [];
    return bookId ? a.filter(function (x) { return x.b === bookId; }) : a;
  }
  function addExcerpt(bookId, txt, note) {
    txt = String(txt || '').trim(); if (!txt) return false;
    var a = ls(K_EXC, []) || [];
    a.unshift({ b: bookId || '', txt: txt.slice(0, 2000), note: String(note || '').trim().slice(0, 1000), t: Date.now() });
    if (a.length > 500) a = a.slice(0, 500);       /* 有界：只留最近 500 条 */
    lset(K_EXC, a);
    return true;
  }
  function delExcerpt(i) { var a = ls(K_EXC, []) || []; a.splice(i, 1); lset(K_EXC, a); return true; }

  /* ---------------- 详情页区块（书） ---------------- */
  function block(kind, id) {
    if (kind !== 'book') return '';
    var s = state(id) || { st: '', p: 0 };
    var btns = ST.map(function (x) {
      var on = s.st === x.k;
      return '<button class="sbtn" data-yst="' + x.k + '" data-yid="' + esc(id) + '"' +
        (on ? ' style="border-color:var(--accent);color:var(--accent)"' : '') + '>' + x.icon + ' ' + x.name + '</button>';
    }).join('');
    var prog = '<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:.76rem;opacity:.85">' +
      '<span>进度</span><input type="range" min="0" max="100" step="5" value="' + (s.p || 0) + '" data-yprog="' + esc(id) + '" style="flex:1">' +
      '<span data-ypv="' + esc(id) + '">' + (s.p || 0) + '%</span></div>';
    var ex = excerpts(id);
    var exHTML = ex.length ? ex.map(function (x, i) {
      return '<div style="border-left:2px solid var(--card-border);padding:2px 0 2px 9px;margin:8px 0">' +
        '<div style="font-size:.82rem;line-height:1.8">' + esc(x.txt) + '</div>' +
        (x.note ? '<div style="font-size:.76rem;opacity:.65;margin-top:3px">💭 ' + esc(x.note) + '</div>' : '') +
        '<button class="sbtn" style="font-size:.68rem;padding:0 6px;margin-top:4px" data-yexdel="' + i + '">删</button></div>';
    }).join('') : '<p class="sub" style="font-size:.76rem;opacity:.65">还没有摘录。读到好句子可以存下来。</p>';

    return '<div class="yz-read" style="margin-top:18px">' +
      '<h2 class="sub-title">📖 阅读状态</h2>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + btns + '</div>' + prog +
      '<h2 class="sub-title" style="margin-top:16px">✍️ 我的摘录（' + ex.length + '）</h2>' + exHTML +
      '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap"><button class="sbtn" data-yexadd="' + esc(id) + '">＋ 添加摘录</button>' +
      '<button class="sbtn" data-ypath="' + esc(id) + '">📚 加入学习路径</button></div>' +
      '</div>';
  }

  /* ---------------- 书架 ---------------- */
  function openShelf() {
    var a = all();
    var groups = ST.map(function (x) {
      var list = books().filter(function (b) { return a[b.id] && a[b.id].st === x.k; });
      if (!list.length) return '';
      return '<h2 class="sub-title">' + x.icon + ' ' + x.name + '（' + list.length + '）</h2>' +
        list.map(function (b) {
          var s = a[b.id];
          var pct = (x.k === 'reading' && s.p) ? ' · ' + s.p + '%' : '';
          return '<div class="frow" onclick="openItemDetail(' + books().indexOf(b) + ')">' +
            '<span class="fava"><span class="fico">📕</span></span>' +
            '<span class="fmeta"><span class="fnm">' + esc(b.title) + '</span>' +
            '<span class="fsub">' + esc(b.author || '') + ' · ' + esc(b.cat || '') + pct + '</span></span>' +
            '<span class="fmor">›</span></div>';
        }).join('');
    }).join('');
    var none = !Object.keys(a).length;
    page('📚 我的书架', none
      ? '<p class="sub" style="line-height:1.9">书架还是空的。打开任意一本书，在「阅读状态」里点「想读 / 在读 / 读完」就会出现在这里。</p>'
      : groups);
  }

  /* ---------------- 全部摘录 ---------------- */
  function openExcerpts() {
    var a = excerpts();
    if (!a.length) { page('✍️ 我的摘录', '<p class="sub" style="line-height:1.9">还没有摘录。打开一本书，在「我的摘录」里点「＋ 添加摘录」。</p>'); return; }
    var html = '<div style="display:flex;gap:8px;margin:0 0 10px"><input id="yzExQ" placeholder="搜摘录 / 我的想法…" oninput="yzExFilter()" style="flex:1;background:var(--card);border:1px solid var(--card-border);color:var(--text);border-radius:10px;padding:7px 10px;font-size:.82rem"></div><div id="yzExList">';
    a.forEach(function (x, i) {
      var b = bookById(x.b);
      html += '<div class="yz-ex" data-q="' + esc((x.txt + ' ' + (x.note || '') + ' ' + ((b && b.title) || '')).toLowerCase()) + '" style="border-bottom:1px solid var(--card-border);padding:10px 0">' +
        '<div style="font-size:.84rem;line-height:1.85">' + esc(x.txt) + '</div>' +
        (x.note ? '<div style="font-size:.76rem;opacity:.65;margin-top:4px">💭 ' + esc(x.note) + '</div>' : '') +
        '<div style="font-size:.7rem;opacity:.5;margin-top:5px">' + (b ? esc(b.title) : '未关联书目') + ' · ' + new Date(x.t).toLocaleDateString() +
        ' <button class="sbtn" style="font-size:.66rem;padding:0 6px;margin-left:6px" onclick="YZRead.delExcerpt(' + i + ');YZRead.openExcerpts()">删</button></div></div>';
    });
    html += '</div>';
    page('✍️ 我的摘录（' + a.length + '）', html);
  }
  function exFilter() {
    var q = (document.getElementById('yzExQ') || {}).value || '';
    q = q.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('.yz-ex'), function (el) {
      el.style.display = (!q || (el.getAttribute('data-q') || '').indexOf(q) >= 0) ? '' : 'none';
    });
  }

  /* ---------------- 首页模块数据 ---------------- */
  function shelfPreview(n) {
    var a = all(), out = [];
    ST.forEach(function (x) {
      books().forEach(function (b) {
        if (a[b.id] && a[b.id].st === x.k) out.push({ b: b, s: a[b.id], st: x });
      });
    });
    /* 在读优先 */
    out.sort(function (p, q) { return (p.st.k === 'reading' ? 0 : 1) - (q.st.k === 'reading' ? 0 : 1); });
    return out.slice(0, n || 4);
  }
  function recentExcerpts(n) { return excerpts().slice(0, n || 3); }

  /* 统一的「整页推进」：复用 app.js 的 openContent，没有就退化成简单容器 */
  function page(title, html) {
    try {
      if (typeof openContent === 'function') { openContent(title, html); return; }
    } catch (e) {}
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9000;background:var(--bg,#1b1210);color:var(--text);padding:18px;overflow:auto';
    d.innerHTML = '<button class="sbtn" onclick="this.parentNode.remove()">关闭</button><h2>' + title + '</h2>' + html;
    document.body.appendChild(d);
  }

  /* 添加摘录弹窗 */
  function addUI(bookId) {
    var old = document.getElementById('yzExPanel');
    if (old) { try { old.remove(); } catch (e) {} }
    var w = document.createElement('div');
    w.id = 'yzExPanel';
    w.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100006;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
    var b = bookById(bookId);
    w.innerHTML = '<div style="width:100%;max-width:560px;background:var(--panel-bg,#1b1412);color:var(--panel-text,#f2e9e4);border:1px solid var(--panel-line,rgba(255,255,255,.16));border-radius:14px;padding:14px">' +
      '<b style="font-size:.92rem">✍️ 摘录' + (b ? '：' + esc(b.title) : '') + '</b>' +
      '<textarea id="yzExTxt" placeholder="原文摘录…" style="width:100%;height:22vh;margin-top:10px;background:rgba(0,0,0,.26);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:10px;padding:10px;font-size:.84rem;line-height:1.8;resize:vertical"></textarea>' +
      '<textarea id="yzExNote" placeholder="我的想法（可留空）…" style="width:100%;height:12vh;margin-top:8px;background:rgba(0,0,0,.26);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:10px;padding:10px;font-size:.8rem;line-height:1.8;resize:vertical"></textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">' +
      '<button id="yzExCancel" class="sbtn">取消</button>' +
      '<button id="yzExSave" class="sbtn" style="border-color:var(--accent);color:var(--accent)">保存</button></div></div>';
    document.body.appendChild(w);
    function close() { try { w.remove(); } catch (e) {} }
    w.querySelector('#yzExCancel').onclick = close;
    w.addEventListener('click', function (ev) { if (ev.target === w) close(); });
    w.querySelector('#yzExSave').onclick = function () {
      var t = w.querySelector('#yzExTxt').value, n = w.querySelector('#yzExNote').value;
      if (!String(t).trim()) { alert('摘录内容不能为空'); return; }
      addExcerpt(bookId, t, n);
      close();
      try { if (window.openCurrent) openCurrent(); } catch (e) {}
    };
    setTimeout(function () { try { w.querySelector('#yzExTxt').focus(); } catch (e) {} }, 80);
  }

  /* ---------------- 事件委托：阅读状态按钮 / 摘录 ---------------- */
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== document) {
      if (t.getAttribute) {
        var st = t.getAttribute('data-yst');
        if (st) {
          var bid = t.getAttribute('data-yid');
          setState(bid, st);
          /* 局部更新：只改三个按钮的高亮与进度文字，不重渲染整页（重渲染会让页面跳动） */
          try {
            var bar = t.parentNode;
            if (bar) {
              Array.prototype.forEach.call(bar.querySelectorAll('[data-yst]'), function (b) {
                var on = b.getAttribute('data-yst') === st;
                b.style.borderColor = on ? 'var(--accent)' : '';
                b.style.color = on ? 'var(--accent)' : '';
              });
            }
            var s2 = state(bid) || {};
            var pv = document.querySelector('[data-ypv="' + bid + '"]');
            if (pv) pv.textContent = (s2.p || 0) + '%';
          } catch (e) {}
          return;
        }
        var yp = t.getAttribute('data-ypath');
        if (yp) {
          try {
            var b = bookById(yp);
            if (window.YZPaths && b) YZPaths.pickFor(b.title);
          } catch (e) {}
          return;
        }
        var exa = t.getAttribute('data-yexadd');
        if (exa) { addUI(exa); return; }
        var exd = t.getAttribute('data-yexdel');
        if (exd) {
          var cur = null;
          try { cur = (typeof yzCur === 'function') ? yzCur() : null; } catch (e) {}
          /* 详情页里的删除：按该书过滤后的列表删；全局列表由内联调用处理 */
          if (cur && cur.kind === 'book') {
            var list = excerpts(cur.id), target = list[parseInt(exd, 10)];
            if (target) {
              var allEx = excerpts();
              var idx = allEx.indexOf(target);
              if (idx >= 0) { delExcerpt(idx); try { openCurrent(); } catch (e) {} }
            }
          }
          return;
        }
      }
      t = t.parentNode;
    }
  }, true);

  /* 进度滑块 */
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var id = t.getAttribute('data-yprog');
    if (!id) return;
    var v = t.value;
    var lab = document.querySelector('[data-ypv="' + id.replace(/"/g, '') + '"]');
    if (lab) lab.textContent = v + '%';
  }, true);
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var id = t.getAttribute('data-yprog');
    if (!id) return;
    setProgress(id, t.value);
  }, true);

  window.YZRead = {
    state: state, setState: setState, setProgress: setProgress, statusOf: statusOf, statusChipHTML: statusChipHTML,
    all: all,
    excerpts: excerpts, addExcerpt: addExcerpt, delExcerpt: delExcerpt,
    block: block, openShelf: openShelf, openExcerpts: openExcerpts, addUI: addUI,
    shelfPreview: shelfPreview, recentExcerpts: recentExcerpts,
    count: function () { return Object.keys(all()).length; },
    exCount: function () { return excerpts().length; }
  };
  window.yzExFilter = exFilter;
  window.openShelf = openShelf;
  window.openExcerpts = openExcerpts;
})();
