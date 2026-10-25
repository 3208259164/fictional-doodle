/* =====================================================================
   学通 · 学习路径（paths.js）
   ---------------------------------------------------------------------
   放在「阅读与手册」里：把散落各处的书按「先读什么、为什么读」串成一条线。
     · 内置 3 条（入门 / 哲学基础 / 党史与新中国），按书名片段匹配资源库，缺书自动跳过
     · 可以「复制为我的路径」后增删步骤、写自己的说明、勾选完成
     · 数据存 localStorage 'yzPaths'，随「导出我的数据」一起走
   ===================================================================== */
(function () {
  'use strict';
  var KEY = 'yzPaths';

  function ls(def) { try { var v = localStorage.getItem(KEY); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); return true; } catch (e) { return false; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function RES() { return window.SITE_RESOURCES || []; }
  function findBook(text) {
    var R = RES(), t = String(text || '');
    var i = R.findIndex(function (r) { return r.title === t; });
    if (i >= 0) return i;
    i = R.findIndex(function (r) { return t && r.title && r.title.indexOf(t) >= 0; });
    return i;
  }

  /* 内置路径：step 用「书名片段」而不是 id —— 资源库增删条目也不会断链 */
  var BUILTIN = [
    { id: 'b-intro', name: '入门 · 从宣言到国家', desc: '半年内读完的主干：先把「马克思主义是什么」立起来，再进国家与革命问题。',
      steps: [
        { t: '共产党宣言', note: '最短的纲领，先读它建立基本词汇' },
        { t: '社会主义从空想到科学的发展', note: '恩格斯写的通俗导论，讲清三大来源' },
        { t: '国家与革命', note: '国家学说与国家消亡，列宁最清楚的一本' },
        { t: '共产主义运动中的"左派"幼稚病', note: '讲策略：什么时候妥协、什么时候不' },
        { t: '帝国主义是资本主义的最高阶段', note: '时代判断：为什么是帝国主义时代' },
        { t: '毛泽东选集', note: '把理论落到中国：先读《实践论》《矛盾论》《新民主主义论》' }
      ] },
    { id: 'b-philo', name: '哲学基础 · 从提纲到两论', desc: '把辩证唯物主义与历史唯物主义打通，配一本辞典随时查。',
      steps: [
        { t: '关于费尔巴哈的提纲', note: '十一条，实践观点的起点' },
        { t: '唯物主义和经验批判主义', note: '物质与经验，唯物主义的分界线' },
        { t: '辩证唯物主义 历史唯物主义', note: '教材式的体系梳理' },
        { t: '实践论', note: '认识论：两次飞跃' },
        { t: '矛盾论', note: '辩证法：普遍性与特殊性' },
        { t: '哲学小辞典', note: '工具书，遇到术语就查' }
      ] },
    { id: 'b-party', name: '党史与新中国 · 从阶级分析到决议', desc: '按历史顺序读原著，看理论如何被现实逼出来。',
      steps: [
        { t: '中国社会各阶级的分析', note: '谁是我们的敌人、谁是我们的朋友' },
        { t: '湖南农民运动考察报告', note: '调查研究的方法示范' },
        { t: '中国革命战争的战略问题', note: '战略问题的中国化' },
        { t: '论联合政府', note: '建国构想' },
        { t: '毛泽东选集', note: '通读一遍，重点在第三、四卷' },
        { t: '关于建国以来党的若干历史问题的决议', note: '1981 年的总结，读原文而非转述' }
      ] }
  ];

  function mine() { var a = ls([]); return Array.isArray(a) ? a : []; }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  function addPath(name, desc) {
    var a = mine();
    var p = { id: uid(), name: String(name || '未命名路径').slice(0, 40), desc: String(desc || '').slice(0, 200), steps: [] };
    a.push(p); save(a);
    return p;
  }
  function delPath(id) { save(mine().filter(function (x) { return x.id !== id; })); return true; }
  function addStep(pathId, bookTitle, note) {
    var a = mine(), p = a.find(function (x) { return x.id === pathId; });
    if (!p) return false;
    if (p.steps.some(function (s) { return s.t === bookTitle; })) return false;
    p.steps.push({ t: bookTitle, note: String(note || '').slice(0, 120), done: 0 });
    save(a);
    return true;
  }
  function delStep(pathId, i) {
    var a = mine(), p = a.find(function (x) { return x.id === pathId; });
    if (!p || !p.steps[i]) return false;
    p.steps.splice(i, 1); save(a); return true;
  }
  function toggleStep(pathId, i) {
    var a = mine(), p = a.find(function (x) { return x.id === pathId; });
    if (!p || !p.steps[i]) return false;
    p.steps[i].done = p.steps[i].done ? 0 : 1; save(a); return true;
  }
  function copyBuiltin(id) {
    var b = BUILTIN.find(function (x) { return x.id === id; });
    if (!b) return false;
    var p = addPath(b.name + '（副本）', b.desc);
    b.steps.forEach(function (s) { addStep(p.id, s.t, s.note); });
    return true;
  }

  function stepHTML(s, i, pathId, editable) {
    var idx = findBook(s.t);
    var title = idx >= 0 ? RES()[idx].title : s.t;
    var click = idx >= 0 ? ' onclick="openItemDetail(' + idx + ')"' : '';
    return '<li style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--card-border)">' +
      (editable
        ? '<label style="flex:none;margin-top:2px"><input type="checkbox"' + (s.done ? ' checked' : '') +
          ' onchange="YZPaths.toggle(\'' + pathId + '\',' + i + ');YZPaths.refresh()"></label>'
        : '<span style="flex:none;opacity:.5">' + (i + 1) + '.</span>') +
      '<span style="flex:1;min-width:0;' + (s.done ? 'opacity:.5;text-decoration:line-through' : '') + '"' + click + '>' +
      '<b style="font-size:.84rem;font-weight:600">' + esc(title) + (idx >= 0 ? ' <span style="font-weight:400;opacity:.6;font-size:.72rem">前往 ↗</span>' : '') + '</b>' +
      (s.note ? '<span style="display:block;font-size:.74rem;opacity:.62;line-height:1.65;margin-top:2px">' + esc(s.note) + '</span>' : '') +
      '</span>' +
      (editable ? '<button class="sbtn" style="flex:none;font-size:.66rem;padding:0 6px" onclick="YZPaths.delStep(\'' + pathId + '\',' + i + ');YZPaths.refresh()">删</button>' : '') +
      '</li>';
  }

  function html() {
    var out = '<h2 class="sub-title" style="margin-top:26px">📚 学习路径（书单）</h2>' +
      '<p class="sub" style="margin:2px 0 8px;line-height:1.8">按「先读什么、为什么读」把书串起来。内置三条可直接照着走；也可以复制为自己的路径，增删步骤、写自己的说明、勾选完成（只存本机）。</p>';

    /* 我的路径 */
    var m = mine();
    out += '<div style="display:flex;gap:8px;margin:0 0 10px"><button class="sbtn" onclick="YZPaths.create()">＋ 新建路径</button></div>';
    if (m.length) {
      out += m.map(function (p) {
        var done = p.steps.filter(function (s) { return s.done; }).length;
        var pct = p.steps.length ? Math.round(done / p.steps.length * 100) : 0;
        return '<div style="border:1px solid var(--card-border);border-radius:12px;padding:11px 12px;margin:0 0 10px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
          '<b style="flex:1;font-size:.88rem">' + esc(p.name) + '</b>' +
          '<span style="font-size:.72rem;opacity:.6">' + done + '/' + p.steps.length + '</span>' +
          '<button class="sbtn" style="font-size:.68rem;padding:0 7px" onclick="YZPaths.del(\'' + p.id + '\');YZPaths.refresh()">删</button></div>' +
          (p.desc ? '<p style="font-size:.75rem;opacity:.65;line-height:1.7;margin:4px 0 6px">' + esc(p.desc) + '</p>' : '') +
          '<div style="height:4px;background:var(--card-border);border-radius:3px;overflow:hidden;margin:6px 0"><i style="display:block;height:100%;width:' + pct + '%;background:var(--accent)"></i></div>' +
          '<ul style="list-style:none;padding:0;margin:4px 0 0">' +
          p.steps.map(function (s, i) { return stepHTML(s, i, p.id, true); }).join('') +
          (p.steps.length ? '' : '<li style="font-size:.76rem;opacity:.6;padding:6px 0">还没有步骤。打开任意一本书，点「＋ 加入学习路径」。</li>') +
          '</ul></div>';
      }).join('');
    }

    /* 内置 */
    out += '<div style="font-size:.74rem;opacity:.6;margin:12px 0 6px">内置路径</div>';
    out += BUILTIN.map(function (p) {
      var rows = p.steps.map(function (s, i) { return stepHTML(s, i, p.id, false); }).join('');
      return '<details style="border:1px solid var(--card-border);border-radius:12px;padding:10px 12px;margin:0 0 9px">' +
        '<summary style="cursor:pointer;font-size:.86rem;font-weight:600">' + esc(p.name) +
        ' <span style="font-weight:400;font-size:.72rem;opacity:.55">（' + p.steps.length + ' 步）</span></summary>' +
        '<p style="font-size:.75rem;opacity:.65;line-height:1.75;margin:6px 0">' + esc(p.desc) + '</p>' +
        '<ul style="list-style:none;padding:0;margin:0">' + rows + '</ul>' +
        '<button class="sbtn" style="margin-top:8px;font-size:.72rem" onclick="YZPaths.copy(\'' + p.id + '\')">复制为我的路径</button>' +
        '</details>';
    }).join('');
    return out;
  }

  function refresh() {
    try {
      if (typeof openContent === 'function' && typeof secIdx === 'function') {
        openContent('📖 阅读与手册', readManualHTML());
      }
    } catch (e) {}
  }
  function create() {
    var n = prompt('路径名称（如「半年的读书计划」）', '');
    if (!n) return false;
    var d = prompt('一句话说明（可留空）', '') || '';
    addPath(n, d);
    refresh();
    return true;
  }
  function copy(id) { copyBuiltin(id); refresh(); return true; }
  function del(id) { if (!confirm('删除这条路径？步骤与勾选记录一起删掉。')) return false; delPath(id); refresh(); return true; }

  /* 书详情页的「加入学习路径」入口 */
  function pickFor(bookTitle) {
    var m = mine();
    var old = document.getElementById('yzPathPick');
    if (old) { try { old.remove(); } catch (e) {} }
    var w = document.createElement('div');
    w.id = 'yzPathPick';
    w.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100007;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
    w.innerHTML = '<div style="width:100%;max-width:480px;background:var(--panel-bg,#1b1412);color:var(--panel-text,#f2e9e4);' +
      'border:1px solid var(--panel-line,rgba(255,255,255,.16));border-radius:14px;padding:14px;max-height:80vh;overflow:auto">' +
      '<b style="font-size:.9rem">加入学习路径：' + esc(bookTitle) + '</b>' +
      (m.length ? m.map(function (p) {
        return '<button class="sbtn" style="display:block;width:100%;text-align:left;margin-top:8px" onclick="YZPaths.addTo(\'' + p.id + '\',\'' +
          esc(bookTitle).replace(/'/g, "\\'") + '\')">' + esc(p.name) + '（' + p.steps.length + ' 步）</button>';
      }).join('') : '<p style="font-size:.78rem;opacity:.6;margin:8px 0">还没有自己的路径。</p>') +
      '<div style="display:flex;gap:8px;margin-top:12px"><button class="sbtn" onclick="YZPaths.createFrom(\'' +
      esc(bookTitle).replace(/'/g, "\\'") + '\')">＋ 新建路径并加入</button>' +
      '<button class="sbtn" onclick="document.getElementById(\'yzPathPick\').remove()">关闭</button></div></div>';
    document.body.appendChild(w);
    w.addEventListener('click', function (ev) { if (ev.target === w) { try { w.remove(); } catch (e) {} } });
  }
  function addTo(pathId, title) {
    addStep(pathId, title, '');
    try { document.getElementById('yzPathPick').remove(); } catch (e) {}
    toast('已加入路径');
    return true;
  }
  function createFrom(title) {
    var n = prompt('新路径名称', '我的读书计划');
    if (!n) return false;
    var p = addPath(n, '');
    addStep(p.id, title, '');
    try { document.getElementById('yzPathPick').remove(); } catch (e) {}
    toast('已新建并加入');
    return true;
  }
  function toast(m) {
    try { if (window.toast) { window.toast(m); return; } } catch (e) {}
  }

  window.YZPaths = {
    html: html, paths: mine, builtins: function () { return BUILTIN.slice(); },
    addPath: addPath, delPath: delPath, addStep: addStep, delStep: delStep, toggle: toggleStep,
    copy: copy, create: create, del: del, refresh: refresh,
    pickFor: pickFor, addTo: addTo, createFrom: createFrom,
    count: function () { return mine().length; }
  };
  window.yzPathsHTML = html;
  window.yzPathPick = pickFor;
})();
