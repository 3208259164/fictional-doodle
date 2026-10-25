/* =====================================================================
   学通 · 自定义层（custom.js）
   ---------------------------------------------------------------------
   一句话：把「能改什么」从「内容」扩到「外观 / 结构 / 版式」，且全部存在本机。

   四块能力：
     ① 主题外观（look）：强调色 / 页面底色 / 文字色 / 卡片色 / 圆角 / 字号 / 字体
     ② 样式片段（snippets）：20 个「勾选即生效」的预设，手机上不必写 CSS
     ③ 自定义 CSS（css）：给想深入的人一个口子（64KB 上限）
     ④ 详情页模板（tpl）：用占位符写自己的版式（安全迷你模板引擎，禁脚本）

   设计约束（与业界一致的几条）：
     · 用户输入一律先转义再插入；模板只允许白名单标签，属性只留 class —— 杜绝 XSS
     · 配置存 localStorage（'yzCustom'），随「导出我的数据」一起走
     · 注入用 <style> + !important，顺序无关，不会被内置样式压掉
     · 出错不影响主流程：任何异常都吞掉并保留内置样式
   ===================================================================== */
(function () {
  'use strict';

  var KEY = 'yzCustom';
  var MAX_CSS = 65536;          /* 64KB：localStorage 5MB 下留足余量 */
  var STYLE_ID = 'yzUserStyle';

  /* ---------------- 默认配置 ---------------- */
  function blank() {
    return {
      v: 1,
      look: {},                  /* accent / bg1 / bg2 / text / card / radius / scale / font */
      snippets: {},              /* id: 1 表示启用 */
      css: '',
      tpl: {},                   /* book / person / concept / event：模板字符串 */
      home: { order: [], off: [], extra: [] },  /* 模块顺序 / 隐藏 / 末尾的自定义模块 */
      profiles: []               /* 配置档案：{id,name,at,look,snippets,css,tpl,home} */
    };
  }
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return blank(); } }

  var C = blank();
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var p = JSON.parse(raw);
      C = { v: 1,
        look: p.look || {}, snippets: p.snippets || {}, css: p.css || '',
        tpl: p.tpl || {}, home: { order: (p.home && p.home.order) || [], off: (p.home && p.home.off) || [],
                                  extra: (p.home && p.home.extra) || [] },
        profiles: Array.isArray(p.profiles) ? p.profiles : [] };
    }
  } catch (e) { C = blank(); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(C)); return true; }
    catch (e) { return false; }
  }
  function get() { return clone(C); }

  /* ---------------- 11 个预设片段 ----------------
     取舍原则（2026-10 · 按软件实际情况收窄）：
       只保留「设置页里没有的、且在本 App 里真的看得出效果」的项。
       字号 / 行距 / 版心 / 动效已有设置页控件，圆角与字体在外观页里改，
       统统不在这里重复 —— 否则两处都写 !important，必然互相覆盖。 */
  var SNIPPETS = [
    { id: 'hide-stars', g: '简洁', name: '隐藏背景装饰', desc: '去掉背景里漂浮的五角星', css: '.stars{display:none !important}' },
    { id: 'hide-daily', g: '简洁', name: '隐藏「每日一句」', desc: '首页顶部那句每天换的语录', css: '.daily{display:none !important}' },
    { id: 'hide-search', g: '简洁', name: '隐藏顶部搜索框', desc: '屏幕顶部那条搜索栏', css: '.qsearchbar{display:none !important}' },
    { id: 'hide-footer', g: '简洁', name: '隐藏页脚', desc: '底部版本与声明那一行', css: 'footer{display:none !important}' },
    { id: 'hide-cats', g: '简洁', name: '隐藏快捷分类', desc: '首页那一排分类按钮', css: '.quickcats{display:none !important}' },

    { id: 'compact', g: '排版', name: '紧凑列表', desc: '减小条目间距，一屏看更多', css: '.citem{padding:8px 2px !important;min-height:38px !important}.group{margin:10px 0 !important}' },

    { id: 'no-shadow', g: '交互', name: '去阴影', desc: '去掉卡片阴影，扁平化', css: '*{box-shadow:none !important}' },
    { id: 'big-tap', g: '交互', name: '加大点击区', desc: '按钮与条目最小高度 48px', css: '.sbtn,.tag,.citem,.qitem{min-height:48px !important}' },
    { id: 'underline', g: '交互', name: '链接加下划线', desc: '可点文字更容易认出来', css: '.aslink,footer a{text-decoration:underline !important}' },

    { id: 'sepia-bg', g: '配色', name: '护眼米黄底', desc: '页面改成米黄纸色（覆盖当前主题）', css: 'body{background:#f4ecd8 !important;color:#3a2a10 !important}' },
    { id: 'print-friendly', g: '配色', name: '打印优化', desc: '隐藏按钮与导航，白底黑字', css: '@media print{.qtop,.tabbar,.qsearchbar,.toolbar,.sbtn,footer{display:none !important}body{background:#fff !important;color:#000 !important}}' }
  ];

  /* ---------------- 生成并注入样式 ---------------- */
  function lookCSS() {
    var L = C.look || {}, out = [];
    var root = [];
    if (L.accent) root.push('--accent:' + L.accent);
    if (L.text) root.push('--text:' + L.text);
    if (L.card) root.push('--card:' + L.card);
    if (L.radius !== undefined && L.radius !== '') {
      root.push('--r-sm:' + L.radius + 'px', '--r-md:' + L.radius + 'px', '--r-lg:' + L.radius + 'px');
    }
    if (root.length) {
      out.push(':root,body.light,body.sepia{' + root.join(';') + ' !important}');
    }
    if (L.bg1 || L.bg2) {
      var a = L.bg1 || '#4a0808', b = L.bg2 || a;
      out.push('body{background:radial-gradient(circle at 20% 10%, rgba(255,80,60,.18), transparent 45%),' +
        'linear-gradient(160deg,' + a + ' 0%,' + b + ' 100%) !important;background-attachment:fixed !important}');
    }
    if (L.font) out.push('body{font-family:' + L.font + ' !important}');
    if (L.scale) out.push('html{font-size:' + L.scale + '% !important}');
    if (L.radius !== undefined && L.radius !== '') {
      out.push('.leave-card,.set-group,.sbtn,.tag,.card,.qpanel{border-radius:' + L.radius + 'px !important}');
    }
    return out.join('\n');
  }
  function snippetCSS() {
    var out = [];
    SNIPPETS.forEach(function (s) {
      if (C.snippets && C.snippets[s.id]) out.push('/* ' + s.name + ' */\n' + s.css);
    });
    return out.join('\n');
  }
  function buildCSS() {
    var parts = [];
    try { parts.push(lookCSS()); } catch (e) {}
    try { parts.push(snippetCSS()); } catch (e) {}
    if (C.css && C.css.trim()) parts.push('/* ===== 我的 CSS ===== */\n' + C.css.slice(0, MAX_CSS));
    return parts.filter(Boolean).join('\n\n');
  }
  function apply() {
    try {
      var txt = buildCSS();
      var el = document.getElementById(STYLE_ID);
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(el);
      }
      el.textContent = txt;
      return txt.length;
    } catch (e) { return 0; }
  }
  /* 尽早应用（脚本在 head 里加载，此时 body 还没出来，样式照样生效） */
  apply();

  /* ---------------- 简易配置 API ---------------- */
  function setLook(patch) {
    C.look = C.look || {};
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k];
      if (v === '' || v === null || v === undefined) delete C.look[k];
      else C.look[k] = v;
    });
    save(); apply();
    return get();
  }
  function toggleSnippet(id, on) {
    C.snippets = C.snippets || {};
    var v = (on === undefined) ? !C.snippets[id] : !!on;
    if (v) C.snippets[id] = 1; else delete C.snippets[id];
    save(); apply();
    return v;
  }
  function setCSS(txt) {
    C.css = String(txt == null ? '' : txt).slice(0, MAX_CSS);
    save(); apply();
    return C.css.length;
  }
  function setTpl(kind, txt) {
    C.tpl = C.tpl || {};
    if (txt && String(txt).trim()) C.tpl[kind] = String(txt).slice(0, 8000);
    else delete C.tpl[kind];
    save();
    return !!(C.tpl[kind]);
  }
  function resetAll() {
    C = blank(); save(); apply();
    return true;
  }
  function exportConfig() { return JSON.stringify({ tool: 'xuetong-custom', v: 1, cfg: C }, null, 2); }
  function importConfig(text) {
    try {
      var o = JSON.parse(text);
      var c = o && o.cfg ? o.cfg : o;
      if (!c) return '不是有效的配置文件';
      C = { v: 1, look: c.look || {}, snippets: c.snippets || {}, css: c.css || '',
            tpl: c.tpl || {}, home: { order: (c.home && c.home.order) || [], off: (c.home && c.home.off) || [],
                                      extra: (c.home && c.home.extra) || [] },
            profiles: Array.isArray(c.profiles) ? c.profiles : [] };
      save(); apply();
      return true;
    } catch (e) { return '不是有效的 JSON：' + (e && e.message); }
  }

  /* ---------------- 安全迷你模板引擎 ----------------
     支持：{{name}} 占位符、{{#if:points}}…{{/if}}、{{#each:points}}…{{/each}}（{{.}} 为当前项）
     白名单标签；属性只留 class。所有取值先 HTML 转义。绝不 eval、绝不执行脚本。 */
  var ALLOW = ('p br strong b em i u s ul ol li h3 h4 h5 h6 div span table thead tbody tr th td ' +
    'hr blockquote small details summary code pre').split(' ');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function sanitizeTpl(html) {
    var s = String(html == null ? '' : html);
    /* 先干掉脚本/样式/内嵌框架整段（含内容），再逐标签白名单过滤 */
    s = s.replace(/<(script|style|iframe|object|embed|link|meta|form|input|button)[\s\S]*?<\/\1>/gi, '');
    s = s.replace(/<(script|style|iframe|object|embed|link|meta|form|input|button)[^>]*\/?>/gi, '');
    s = s.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, function (m, close, tag, attrs) {
      var t = String(tag).toLowerCase();
      if (ALLOW.indexOf(t) < 0) return '';
      if (close) return '</' + t + '>';
      var cm = String(attrs).match(/class\s*=\s*"([^"]*)"/);
      var cls = cm ? ' class="' + cm[1].replace(/[^A-Za-z0-9_\-\s]/g, '') + '"' : '';
      return '<' + t + cls + '>';
    });
    return s;
  }
  function pick(d, key) {
    var v = d[key];
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.join('、');
    return String(v);
  }
  function renderTpl(tpl, data) {
    try {
      var s = sanitizeTpl(tpl);
      /* each */
      s = s.replace(/\{\{#each:([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, function (m, key, inner) {
        var arr = data[key];
        if (!Array.isArray(arr) || !arr.length) return '';
        return arr.map(function (it) {
          var one = inner.replace(/\{\{\.\}\}/g, esc(typeof it === 'object' ? (it && it.name) || '' : it));
          return one;
        }).join('');
      });
      /* if */
      s = s.replace(/\{\{#if:([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, function (m, key, inner) {
        var v = data[key];
        var truthy = Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && String(v).trim() !== '');
        return truthy ? inner : '';
      });
      /* 占位符 */
      s = s.replace(/\{\{([\w.]+)\}\}/g, function (m, key) {
        if (key === '.') return '';
        return esc(pick(data, key));
      });
      /* 残留的未知花括号：直接清掉，避免露出模板语法 */
      s = s.replace(/\{\{[^}]*\}\}/g, '');
      return s;
    } catch (e) { return ''; }
  }
  function tplFor(kind) { return (C.tpl && C.tpl[kind]) || ''; }

  /* ---------------- 首页模块编排 ---------------- */
  /* 末尾自定义模块：数据来自 reading.js（书架 / 摘录）与收藏 */
  var EXTRA_MODS = [
    { id: 'shelf', name: '📚 我的书架（在读优先）' },
    { id: 'excerpts', name: '✍️ 最近摘录' },
    { id: 'favs', name: '⭐ 我的收藏' }
  ];
  function renderExtra() {
    try {
      var view = document.getElementById('view-home'); if (!view) return;
      var box = document.getElementById('yzHomeExtra');
      if (!box) { box = document.createElement('div'); box.id = 'yzHomeExtra'; view.appendChild(box); }
      var list = (C.home && C.home.extra) || [];
      if (!list.length) { box.innerHTML = ''; return; }
      var out = '';
      list.forEach(function (t) {
        if (t === 'shelf' && window.YZRead) {
          var arr = YZRead.shelfPreview(4);
          if (!arr.length) return;
          out += '<div class="group"><div class="group-title">📚 我的书架</div>' + arr.map(function (x) {
            var b = x.b, st = x.st;
            return '<div class="frow" onclick="openItemDetail(' + (window.SITE_RESOURCES || []).indexOf(b) + ')">' +
              '<span class="fava"><span class="fico">📕</span></span>' +
              '<span class="fmeta"><span class="fnm">' + esc(b.title) + '</span>' +
              '<span class="fsub">' + st.icon + ' ' + st.name + (x.s.p ? ' · ' + x.s.p + '%' : '') + '</span></span>' +
              '<span class="fmor">›</span></div>';
          }).join('') + '</div>';
        }
        if (t === 'excerpts' && window.YZRead) {
          var ex = YZRead.recentExcerpts(3);
          if (!ex.length) return;
          out += '<div class="group"><div class="group-title">✍️ 最近摘录</div>' + ex.map(function (x) {
            var b = (window.SITE_RESOURCES || []).find(function (y) { return y.id === x.b; });
            return '<div style="border-left:2px solid var(--card-border);padding:3px 0 3px 9px;margin:8px 0">' +
              '<div style="font-size:.82rem;line-height:1.8">' + esc(x.txt.slice(0, 90)) + (x.txt.length > 90 ? '…' : '') + '</div>' +
              '<div style="font-size:.7rem;opacity:.55;margin-top:2px">' + (b ? esc(b.title) : '未关联') + '</div></div>';
          }).join('') + '</div>';
        }
        if (t === 'favs') {
          var fav = [];
          try { fav = JSON.parse(localStorage.getItem('favs') || '[]'); } catch (e) {}
          var rs = (window.SITE_RESOURCES || []).filter(function (r) { return fav.indexOf(r.id) >= 0; }).slice(0, 5);
          if (!rs.length) return;
          out += '<div class="group"><div class="group-title">⭐ 我的收藏</div>' + rs.map(function (r) {
            return '<div class="frow" onclick="openItemDetail(' + (window.SITE_RESOURCES || []).indexOf(r) + ')">' +
              '<span class="fava"><span class="fico">' + (r.icon || '📕') + '</span></span>' +
              '<span class="fmeta"><span class="fnm">' + esc(r.title) + '</span>' +
              '<span class="fsub">' + esc(r.author || '') + ' · ' + esc(r.cat || '') + '</span></span>' +
              '<span class="fmor">›</span></div>';
          }).join('') + '</div>';
        }
      });
      box.innerHTML = out;
    } catch (e) {}
  }

  var HOME_MODS = [
    { id: 'daily', name: '每日一句', sel: '.daily' },
    { id: 'friends', name: '我的主页（导师/人物）', sel: '#homeFriends' },
    { id: 'cats', name: '快捷分类', sel: '.toolbar' },
    { id: 'continue', name: '继续阅读', sel: '#continueBox' }
  ];
  function homeCfg() {
    var h = C.home || {};
    return { order: (h.order || []).filter(function (x) { return HOME_MODS.some(function (m) { return m.id === x; }); }),
             off: (h.off || []).slice(),
             extra: (h.extra || []).filter(function (x) { return EXTRA_MODS.some(function (m) { return m.id === x; }); }) };
  }
  function setHome(patch) {
    C.home = { order: (patch && patch.order) || [], off: (patch && patch.off) || [],
               extra: (patch && patch.extra) || (C.home && C.home.extra) || [] };
    save(); applyHome();
    return homeCfg();
  }
  function applyHome() {
    try {
      var view = document.getElementById('view-home');
      if (!view) return;
      var cfg = homeCfg();
      var nodes = {};
      HOME_MODS.forEach(function (m) {
        var el = view.querySelector(m.sel);
        if (el) nodes[m.id] = el;
      });
      var order = cfg.order.concat(HOME_MODS.map(function (m) { return m.id; })
        .filter(function (id) { return cfg.order.indexOf(id) < 0; }));
      /* 依次插到 view 的最后（appendChild 会自动移动节点，从而完成排序） */
      order.forEach(function (id) {
        var el = nodes[id];
        if (!el) return;
        if (cfg.off.indexOf(id) >= 0) { el.style.display = 'none'; return; }
        el.style.display = '';
        view.appendChild(el);
      });
      HOME_MODS.forEach(function (m) {
        var el = nodes[m.id];
        if (el && cfg.off.indexOf(m.id) >= 0) el.style.display = 'none';
      });
      renderExtra();
    } catch (e) {}
  }

  /* ---------------- 自定义字段（我的标注） ---------------- */
  function metaOf(kind, id) {
    try {
      if (window.YZY && YZY.getMeta) return YZY.getMeta(kind + ':' + id) || [];
    } catch (e) {}
    return [];
  }
  function metaHTML(kind, id) {
    var list = metaOf(kind, id);
    var rows = list.map(function (x, i) {
      return '<tr><th style="text-align:left;padding:6px 10px 6px 0;font-weight:400;opacity:.7;white-space:nowrap;vertical-align:top">' +
        esc(x.k) + '</th><td style="padding:6px 0;line-height:1.7">' + esc(x.v) +
        ' <button class="sbtn" style="padding:1px 7px;font-size:.7rem;margin-left:6px" onclick="yzMetaDel(\'' + esc(kind) + '\',\'' + esc(id) + '\',' + i + ')">删</button></td></tr>';
    }).join('');
    var addBtn = '<button class="sbtn" data-act="yzMetaAdd" data-arg="' + esc(kind + '|' + id) + '">＋ 添加标注</button>';
    /* 概念 / 事件没有编辑台，这里给一个就地编辑入口（仅开启自助编辑时显示） */
    var canEdit = false;
    try { canEdit = (kind === 'concept' || kind === 'event') && window.YZY && YZY.editorEnabled && YZY.editorEnabled(); } catch (e) {}
    var editBtn = canEdit ? ' <button class="sbtn" onclick="yzEditCur(\'' + esc(kind) + '\',\'' + esc(id) + '\')">✏️ 改介绍</button>' : '';
    return '<div class="yz-meta" style="margin-top:18px">' +
      '<h2 class="sub-title">🏷 我的标注' + (list.length ? '（' + list.length + '）' : '') + '</h2>' +
      (list.length ? '<table style="width:100%;border-collapse:collapse;font-size:.82rem">' + rows + '</table>'
                   : '<p class="sub" style="font-size:.78rem;opacity:.7;line-height:1.8">可以给自己加字段，比如「评分」「阅读状态」「摘抄页码」。只存在本机，随「导出我的数据」一起带走。</p>') +
      '<div style="margin-top:8px">' + addBtn + editBtn + '</div>' +
      '</div>';
  }
  function metaAdd(kind, id) {
    var k = prompt('字段名（如 评分 / 阅读状态 / 摘抄页码）', '');
    if (!k) return false;
    var v = prompt('内容（如 ★★★★★ / 已读完 / P.120）', '');
    if (v == null) return false;
    try { YZY.addMeta(kind + ':' + id, k, v); } catch (e) { return false; }
    return true;
  }
  function metaDel(kind, id, i) {
    try { YZY.delMeta(kind + ':' + id, i); } catch (e) {}
    try { if (typeof openCurrent === 'function') openCurrent(); } catch (e) {}
    return true;
  }

  /* ---------------- 概念 / 事件就地编辑（自带编辑器，不依赖编辑台） ---------------- */
  function editCur(kind, id) {
    var d = collectData(kind, id);
    var old = document.getElementById('yzEditPanel');
    if (old) { try { old.remove(); } catch (e) {} }
    var wrap = document.createElement('div');
    wrap.id = 'yzEditPanel';
    wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100005;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML =
      '<div style="width:100%;max-width:560px;background:var(--panel-bg,#1b1412);color:var(--panel-text,#f2e9e4);' +
      'border:1px solid var(--panel-line,rgba(255,255,255,.16));border-radius:14px;padding:14px;max-height:86vh;overflow:auto">' +
      '<b style="font-size:.92rem">✏️ 编辑：' + esc(d.name || id) + '</b>' +
      '<p style="font-size:.72rem;opacity:.6;margin:6px 0 8px;line-height:1.6">只改本机，不动随包数据；导出「我的数据」会带走。留空则不修改。</p>' +
      '<label style="display:block;font-size:.76rem;opacity:.75;margin:10px 0 4px">定位（一句话）</label>' +
      '<input id="yzE_role" value="' + esc(d.role || '') + '" style="width:100%;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:8px;padding:7px 9px;font-size:.82rem">' +
      '<label style="display:block;font-size:.76rem;opacity:.75;margin:10px 0 4px">正文介绍</label>' +
      '<textarea id="yzE_desc" style="width:100%;height:30vh;background:rgba(0,0,0,.26);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:10px;padding:10px;font-size:.82rem;line-height:1.75;resize:vertical">' +
      esc(d.desc || d.intro || '') + '</textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button id="yzE_cancel" style="' + btn() + '">取消</button>' +
      '<button id="yzE_save" style="' + btn(0, 'background:var(--panel-btn,#8f3a2c);border-color:transparent;color:var(--panel-btn-text,#fff)') + '">保存</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    function close() { try { wrap.remove(); } catch (e) {} }
    wrap.querySelector('#yzE_cancel').onclick = close;
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) close(); });
    wrap.querySelector('#yzE_save').onclick = function () {
      var role = wrap.querySelector('#yzE_role').value.trim();
      var desc = wrap.querySelector('#yzE_desc').value.trim();
      var patch = {};
      if (role && role !== (d.role || '')) patch.role = role;
      if (desc && desc !== (d.desc || d.intro || '')) patch.desc = desc;
      if (!Object.keys(patch).length) { close(); return; }
      try {
        if (kind === 'concept') YZY.editConcept(id, patch);
        else if (kind === 'event') YZY.editEvent(d.name || id, patch);
      } catch (e) { alert('保存失败：' + e.message); return; }
      close();
      try { if (window.openCurrent) openCurrent(); } catch (e) {}
      toastLocal('已保存到本机');
    };
  }
  window.yzEditCur = editCur;

  /* ---------------- 详情页装饰：模板替换 + 标注区 ---------------- */
  function decorate(kind, id, html) {
    try {
      var out = html;
      var tpl = tplFor(kind);
      if (tpl) {
        var data = collectData(kind, id);
        var rendered = renderTpl(tpl, data);
        if (rendered && rendered.length > 40) {
          out = '<div class="yz-tpl">' + rendered + '</div>';
        }
      }
      try { if (window.YZRead) out += YZRead.block(kind, id); } catch (e) {}
      if (id) out += metaHTML(kind, id);
      return out;
    } catch (e) { return html; }
  }
  function collectData(kind, id) {
    var d = { kind: kind, id: id, name: '', role: '', desc: '', years: '', points: [], works: [], tags: [], source: '', intro: '', author: '', cat: '', date: '', note: '' };
    try {
      if (kind === 'book' && window.SITE_RESOURCES) {
        var r = SITE_RESOURCES.find(function (x) { return x.id === id; });
        if (r) { d.name = r.title; d.author = r.author; d.cat = r.cat; d.intro = r.intro || r.desc || ''; d.desc = r.desc || ''; d.date = r.date || ''; d.note = r.note || ''; d.tags = r.tags || []; }
      } else if (kind === 'person') {
        var G = (window.YZY && YZY.graphData) ? YZY.graphData('main') : (window.SITE_GRAPH || { nodes: [] });
        var p = (G.nodes || []).find(function (x) { return x.id === id; });
        if (p) { d.name = p.name; d.years = p.years; d.role = p.role; d.desc = p.desc; d.points = p.points || []; d.works = p.works || []; d.tags = p.tags || []; d.source = p.source || ''; }
      } else if (kind === 'concept') {
        var cp = ((window.SITE_CONCEPTS && SITE_CONCEPTS.nodes) || []).find(function (x) { return x.id === id; });
        if (cp) { d.name = cp.name; d.role = cp.role; d.desc = cp.desc; d.points = cp.points || []; d.works = cp.works || []; d.tags = cp.tags || []; d.source = cp.source || ''; }
      } else if (kind === 'event') {
        var ev = ((window.SITE_GRAPH_WORLD && SITE_GRAPH_WORLD.nodes) || []).find(function (x) { return x.id === id; });
        if (ev) { d.name = ev.name; d.years = ev.years; d.role = ev.role; d.desc = ev.desc; d.points = ev.points || []; d.tags = ev.tags || []; d.source = ev.source || ''; }
      }
    } catch (e) {}
    return d;
  }

  /* ---------------- 设置面板 ---------------- */
  var PANEL = null;
  function btn(st, extra) { return 'border:1px solid rgba(255,255,255,.28);background:transparent;color:inherit;border-radius:8px;padding:5px 10px;font-size:.78rem;' + (extra || ''); }

  function openPanel(tab) {
    closePanel();
    var T = tab || 'look';
    var wrap = document.createElement('div');
    wrap.id = 'yzCustomPanel';
    wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100003;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center';
    var L = C.look || {};
    var tabs = [['look', '🎨 主题'], ['snip', '🧩 片段'], ['css', '⌨️ CSS'], ['tpl', '🧱 模板'], ['home', '🏠 首页'], ['prof', '🗂 档案']];
    var tabHTML = tabs.map(function (t) {
      var on = t[0] === T;
      return '<button data-t="' + t[0] + '" style="' + btn(0, 'flex:0 0 auto;' + (on ? 'background:var(--panel-btn,#8f3a2c);border-color:transparent;color:var(--panel-btn-text,#fff)' : '')) + '">' + t[1] + '</button>';
    }).join('');

    function field(label, val, ph, k, type) {
      return '<label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:.8rem">' +
        '<span style="flex:0 0 86px;opacity:.78">' + label + '</span>' +
        '<input id="yzL_' + k + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '" placeholder="' + esc(ph || '') + '"' +
        ' style="flex:1;min-width:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);color:inherit;border-radius:8px;padding:5px 8px;font-size:.8rem">' +
        '</label>';
    }
    function colorRow(label, val, k, def) {
      return '<label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:.8rem">' +
        '<span style="flex:0 0 86px;opacity:.78">' + label + '</span>' +
        '<input id="yzC_' + k + '" type="color" value="' + esc(val || def) + '" style="width:38px;height:28px;border:0;background:transparent;padding:0">' +
        '<span style="font-size:.72rem;opacity:.55">' + esc(val || '默认') + '</span>' +
        '</label>';
    }

    var body = '';
    if (T === 'look') {
      body =
        '<p style="font-size:.76rem;opacity:.7;margin:0 0 10px;line-height:1.7">这里只放<b>设置页没有的</b>项：强调色 / 页面底色 / 文字色 / 卡片色 / 圆角 / 字体。<b>字号、行距、版心、动效</b>请到「设置 → 显示」调，两边都写会互相覆盖。只影响本机，立刻生效。</p>' +
        colorRow('强调色', L.accent, 'accent', '#f5c518') +
        colorRow('页面底色 1', L.bg1, 'bg1', '#4a0808') +
        colorRow('页面底色 2', L.bg2, 'bg2', '#170303') +
        colorRow('文字色', L.text, 'text', '#f2e8d8') +
        colorRow('卡片底色', L.card, 'card', 'rgba(255,255,255,0.09)') +
        field('圆角 (px)', L.radius, '留空=默认（10~20）', 'radius', 'number') +
        '<label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:.8rem"><span style="flex:0 0 86px;opacity:.78">字体</span>' +
        '<select id="yzL_font" style="flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);color:inherit;border-radius:8px;padding:5px 8px;font-size:.8rem">' +
        [['', '默认（系统）'], ['-apple-system,"PingFang SC","Noto Sans SC",sans-serif', '黑体'],
         ['"Noto Serif SC","Songti SC",serif', '宋体'],
         ['ui-monospace,Menlo,Consolas,monospace', '等宽']].map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + ((L.font || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label>';
    } else if (T === 'snip') {
      var groups = {};
      SNIPPETS.forEach(function (s) { (groups[s.g] = groups[s.g] || []).push(s); });
      body = '<p style="font-size:.76rem;opacity:.7;margin:0 0 10px;line-height:1.7">勾选即生效，不用写代码，可叠加。这里只留<b>设置页做不到</b>的事情（隐藏元素、紧凑列表、扁平化、护眼纸色、打印优化…）；字号 / 行距 / 版心 / 动效在「设置 → 显示」里，不在此重复。</p>' +
        Object.keys(groups).map(function (g) {
          return '<div style="margin:0 0 12px"><div style="font-size:.74rem;opacity:.6;margin:0 0 6px">' + g + '</div>' +
            groups[g].map(function (s) {
              var on = !!(C.snippets && C.snippets[s.id]);
              return '<label style="display:flex;align-items:flex-start;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.08)">' +
                '<input type="checkbox" data-snip="' + s.id + '"' + (on ? ' checked' : '') + ' style="margin-top:3px;width:16px;height:16px">' +
                '<span style="flex:1"><b style="font-weight:600;font-size:.82rem">' + s.name + '</b>' +
                '<span style="display:block;font-size:.73rem;opacity:.6;line-height:1.6">' + s.desc + '</span></span></label>';
            }).join('') + '</div>';
        }).join('');
    } else if (T === 'css') {
      body = '<p style="font-size:.76rem;opacity:.7;margin:0 0 8px;line-height:1.7">直接写 CSS，会追加在所有内置样式之后（建议用 !important）。上限 64KB。</p>' +
        '<textarea id="yzCssBox" spellcheck="false" style="width:100%;height:34vh;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:10px;padding:10px;font-family:ui-monospace,Menlo,monospace;font-size:.76rem;line-height:1.6;resize:vertical">' +
        esc(C.css || '') + '</textarea>' +
        '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
        '<button id="yzCssSave" style="' + btn() + '">保存并应用</button>' +
        '<button id="yzCssSample" style="' + btn() + '">插入示例</button>' +
        '<button id="yzCssClear" style="' + btn() + '">清空</button>' +
        '<span id="yzCssInfo" style="font-size:.72rem;opacity:.6;align-self:center">' + (C.css || '').length + ' / ' + MAX_CSS + '</span>' +
        '</div>';
    } else if (T === 'tpl') {
      var kinds = [['book', '书'], ['person', '人物'], ['concept', '概念'], ['event', '事件']];
      body = '<p style="font-size:.76rem;opacity:.7;margin:0 0 10px;line-height:1.7">用自己的版式替换详情页正文。可用占位符：<code>{{name}} {{desc}} {{role}} {{years}} {{author}} {{intro}}</code>；' +
        '条件 <code>{{#if:points}}…{{/if}}</code>；循环 <code>{{#each:points}}{{.}}{{/each}}</code>。只允许白名单标签，不执行脚本。</p>' +
        kinds.map(function (k) {
          return '<div style="margin:0 0 14px"><div style="font-size:.78rem;font-weight:600;margin:0 0 4px">' + k[1] + '详情模板</div>' +
            '<textarea data-tpl="' + k[0] + '" spellcheck="false" placeholder="留空 = 使用内置版式" style="width:100%;height:20vh;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.2);color:inherit;border-radius:10px;padding:10px;font-family:ui-monospace,Menlo,monospace;font-size:.74rem;line-height:1.6;resize:vertical">' +
            esc((C.tpl && C.tpl[k[0]]) || '') + '</textarea>' +
            '<button data-tplfill="' + k[0] + '" style="' + btn(0, 'margin-top:6px') + '">填入示例</button></div>';
        }).join('');
    } else if (T === 'prof') {
      var ps = C.profiles || [];
      body = '<p style="font-size:.76rem;opacity:.7;margin:0 0 10px;line-height:1.7">把当前这套外观（主题 + 片段 + CSS + 模板 + 首页编排）存成档案，之后一键切换。比如「阅读」「研究」各一套。</p>' +
        '<button id="yzProfSave" style="' + btn(0, 'margin-bottom:10px') + '">＋ 保存当前设置为档案</button>' +
        (ps.length ? ps.map(function (p) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.1)">' +
            '<span style="flex:1;min-width:0"><b style="font-size:.84rem">' + esc(p.name) + '</b>' +
            '<span style="display:block;font-size:.72rem;opacity:.55">' + (p.at || '') + ' · ' +
            Object.keys(p.snippets || {}).length + ' 个片段' + ((p.css || '').length ? ' · 有自定义 CSS' : '') + '</span></span>' +
            '<button data-profuse="' + p.id + '" style="' + btn() + '">应用</button>' +
            '<button data-profdel="' + p.id + '" style="' + btn() + '">删</button></div>';
        }).join('') : '<p style="font-size:.78rem;opacity:.6;line-height:1.8">还没有档案。</p>');
    } else {
      var hc = homeCfg();
      var order = hc.order.concat(HOME_MODS.map(function (m) { return m.id; }).filter(function (id) { return hc.order.indexOf(id) < 0; }));
      body = '<p style="font-size:.76rem;opacity:.7;margin:0 0 10px;line-height:1.7">首页从上到下的顺序与显示。用 ↑↓ 调顺序。</p>' +
        order.map(function (id, i) {
          var m = HOME_MODS.find(function (x) { return x.id === id; });
          if (!m) return '';
          var off = hc.off.indexOf(id) >= 0;
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)">' +
            '<span style="flex:1;font-size:.82rem' + (off ? ';opacity:.45;text-decoration:line-through' : '') + '">' + (i + 1) + '. ' + m.name + '</span>' +
            '<button data-homeup="' + id + '" style="' + btn() + '">↑</button>' +
            '<button data-homedown="' + id + '" style="' + btn() + '">↓</button>' +
            '<button data-hometog="' + id + '" style="' + btn() + '">' + (off ? '显示' : '隐藏') + '</button></div>';
        }).join('') +
        '<div style="font-size:.74rem;opacity:.6;margin:14px 0 6px">末尾追加的模块（有自己的数据时才显示）</div>' +
        EXTRA_MODS.map(function (m) {
          var on = hc.extra.indexOf(m.id) >= 0;
          return '<label style="display:flex;align-items:center;gap:9px;padding:6px 0">' +
            '<input type="checkbox" data-homeextra="' + m.id + '"' + (on ? ' checked' : '') + ' style="width:16px;height:16px">' +
            '<span style="font-size:.82rem">' + m.name + '</span></label>';
        }).join('');
    }

    wrap.innerHTML =
      '<div style="width:100%;max-width:660px;max-height:88vh;overflow:auto;background:var(--panel-bg,#1b1412);color:var(--panel-text,#f2e9e4);' +
      'border:1px solid var(--panel-line,rgba(255,255,255,.16));border-radius:16px 16px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom,0px))">' +
      '<div style="display:flex;align-items:center;gap:8px;margin:0 0 10px"><b style="flex:1">🎛 自定义</b>' +
      '<button id="yzCpReset" style="' + btn() + '">恢复默认</button>' +
      '<button id="yzCpExport" style="' + btn() + '">导出配置</button>' +
      '<button id="yzCpImport" style="' + btn() + '">导入</button>' +
      '<button id="yzCpClose" style="' + btn() + '">关闭</button></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px">' + tabHTML + '</div>' +
      body +
      '</div>';
    document.body.appendChild(wrap);
    PANEL = wrap;

    function close() { closePanel(); }
    wrap.querySelector('#yzCpClose').onclick = close;
    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) close(); });
    wrap.querySelectorAll('[data-t]').forEach(function (b) {
      b.onclick = function () { openPanel(b.getAttribute('data-t')); };
    });
    wrap.querySelector('#yzCpReset').onclick = function () {
      if (!confirm('恢复默认外观与全部自定义配置？本机标注与内容编辑不受影响。')) return;
      resetAll(); openPanel('look');
    };
    wrap.querySelector('#yzCpExport').onclick = function () {
      var txt = exportConfig();
      var name = '学通-自定义配置-' + new Date().toISOString().slice(0, 10) + '.json';
      try {
        if (window.YZSave && YZSave.text && YZSave.text(name, 'application/json', txt)) { toastLocal('配置已导出'); return; }
      } catch (e) {}
      try {
        var blob = new Blob([txt], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { alert('导出失败：' + e.message); }
    };
    wrap.querySelector('#yzCpImport').onclick = function () {
      var txt = prompt('粘贴配置 JSON：', '');
      if (!txt) return;
      var r = importConfig(txt);
      if (r === true) { openPanel('look'); toastLocal('配置已导入'); } else alert(r);
    };

    /* 主题：即时应用 */
    if (T === 'look') {
      ['accent', 'bg1', 'bg2', 'text', 'card'].forEach(function (k) {
        var el = wrap.querySelector('#yzC_' + k);
        if (el) el.onchange = function () { var p = {}; p[k] = el.value; setLook(p); openPanel('look'); };
      });
      ['radius', 'scale'].forEach(function (k) {
        var el = wrap.querySelector('#yzL_' + k);
        if (el) el.onchange = function () { var p = {}; p[k] = el.value === '' ? '' : parseInt(el.value, 10); setLook(p); };
      });
      var f = wrap.querySelector('#yzL_font');
      if (f) f.onchange = function () { setLook({ font: f.value }); };
    }
    /* 片段：勾选即生效 */
    if (T === 'snip') {
      wrap.querySelectorAll('[data-snip]').forEach(function (cb) {
        cb.onchange = function () { toggleSnippet(cb.getAttribute('data-snip'), cb.checked); };
      });
    }
    /* CSS */
    if (T === 'css') {
      var box = wrap.querySelector('#yzCssBox'), info = wrap.querySelector('#yzCssInfo');
      box.oninput = function () { if (info) info.textContent = box.value.length + ' / ' + MAX_CSS; };
      wrap.querySelector('#yzCssSave').onclick = function () {
        var n = setCSS(box.value); toastLocal('已应用（' + n + ' 字符）'); openPanel('css');
      };
      wrap.querySelector('#yzCssSample').onclick = function () {
        box.value = '/* 示例：把卡片改成暖色玻璃质感 */\n.leave-card, .set-group {\n  background: rgba(255, 240, 230, .10) !important;\n  border-color: rgba(255, 200, 160, .35) !important;\n}\n/* 示例：首页标题居中 */\n#resTitle, .set-title { text-align: center !important; }\n';
        if (info) info.textContent = box.value.length + ' / ' + MAX_CSS;
      };
      wrap.querySelector('#yzCssClear').onclick = function () { box.value = ''; setCSS(''); toastLocal('已清空'); openPanel('css'); };
    }
    /* 模板 */
    if (T === 'tpl') {
      wrap.querySelectorAll('[data-tpl]').forEach(function (ta) {
        ta.onchange = function () { setTpl(ta.getAttribute('data-tpl'), ta.value); toastLocal(ta.value.trim() ? '模板已保存' : '已恢复内置版式'); };
      });
      wrap.querySelectorAll('[data-tplfill]').forEach(function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-tplfill');
          var ta = wrap.querySelector('[data-tpl="' + k + '"]');
          if (!ta) return;
          ta.value = (k === 'book')
            ? '<h3>{{name}}</h3>\n<p style="opacity:.7">{{author}} · {{cat}}</p>\n<p>{{intro}}</p>\n{{#if:tags}}<p style="opacity:.6">标签：{{tags}}</p>{{/if}}'
            : '<h3>{{name}}</h3>\n<p style="opacity:.7">{{years}} · {{role}}</p>\n<p>{{desc}}</p>\n{{#if:points}}<ul>{{#each:points}}<li>{{.}}</li>{{/each}}</ul>{{/if}}\n{{#if:works}}<p style="opacity:.6">文献：{{works}}</p>{{/if}}';
          ta.onchange();
        };
      });
    }
    /* 首页编排 */
    if (T === 'home') {
      function move(id, dir) {
        var c = homeCfg();
        var order = c.order.concat(HOME_MODS.map(function (m) { return m.id; }).filter(function (x) { return c.order.indexOf(x) < 0; }));
        var i = order.indexOf(id), j = i + dir;
        if (i < 0 || j < 0 || j >= order.length) return;
        var t = order[i]; order[i] = order[j]; order[j] = t;
        setHome({ order: order, off: c.off }); openPanel('home');
      }
      wrap.querySelectorAll('[data-homeup]').forEach(function (b) { b.onclick = function () { move(b.getAttribute('data-homeup'), -1); }; });
      wrap.querySelectorAll('[data-homedown]').forEach(function (b) { b.onclick = function () { move(b.getAttribute('data-homedown'), 1); }; });
      wrap.querySelectorAll('[data-homeextra]').forEach(function (cb) {
        cb.onchange = function () {
          var c = homeCfg(), id = cb.getAttribute('data-homeextra');
          var extra = c.extra.indexOf(id) >= 0 ? c.extra.filter(function (x) { return x !== id; }) : c.extra.concat([id]);
          setHome({ order: c.order, off: c.off, extra: extra });
        };
      });
      wrap.querySelectorAll('[data-hometog]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-hometog'), c = homeCfg();
          var off = c.off.indexOf(id) >= 0 ? c.off.filter(function (x) { return x !== id; }) : c.off.concat([id]);
          setHome({ order: c.order, off: off }); openPanel('home');
        };
      });
    }
    if (T === 'prof') {
      var saveBtn = wrap.querySelector('#yzProfSave');
      if (saveBtn) saveBtn.onclick = function () {
        var n = prompt('档案名称（如「阅读用」「研究用」）', '我的配置');
        if (!n) return;
        C.profiles = C.profiles || [];
        C.profiles.unshift({ id: 'pf' + Date.now().toString(36), name: String(n).slice(0, 24), at: new Date().toLocaleString(),
          look: clone(C.look || {}), snippets: clone(C.snippets || {}), css: C.css || '',
          tpl: clone(C.tpl || {}), home: clone(C.home || {}) });
        while (C.profiles.length > 12) C.profiles.pop();
        save(); openPanel('prof');
      };
      wrap.querySelectorAll('[data-profuse]').forEach(function (b) {
        b.onclick = function () {
          var p = (C.profiles || []).find(function (x) { return x.id === b.getAttribute('data-profuse'); });
          if (!p) return;
          C.look = clone(p.look || {}); C.snippets = clone(p.snippets || {}); C.css = p.css || '';
          C.tpl = clone(p.tpl || {}); C.home = clone(p.home || {});
          save(); apply(); applyHome(); openPanel('prof'); toastLocal('已应用：' + p.name);
        };
      });
      wrap.querySelectorAll('[data-profdel]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('删除这个档案？')) return;
          C.profiles = (C.profiles || []).filter(function (x) { return x.id !== b.getAttribute('data-profdel'); });
          save(); openPanel('prof');
        };
      });
    }
  }
  function closePanel() {
    try { if (PANEL && PANEL.parentNode) PANEL.parentNode.removeChild(PANEL); } catch (e) {}
    PANEL = null;
  }
  function toastLocal(msg) {
    try { if (window.toast) { window.toast(msg); return; } } catch (e) {}
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:100004;background:rgba(0,0,0,.88);' +
      'color:#fff;padding:9px 14px;border-radius:10px;font-size:.86rem;max-width:86vw;text-align:center';
    document.body.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, 2000);
  }

  /* ---------------- 对外 API ---------------- */
  window.YZCustom = {
    get: get, setLook: setLook, toggleSnippet: toggleSnippet, setCSS: setCSS, setTpl: setTpl,
    reset: resetAll, apply: apply, exportConfig: exportConfig, importConfig: importConfig,
    snippets: function () { return SNIPPETS.slice(); },
    tplFor: tplFor, renderTpl: renderTpl, decorate: decorate,
    metaHTML: metaHTML, metaAdd: metaAdd, metaDel: metaDel,
    home: homeCfg, setHome: setHome, applyHome: applyHome, renderExtra: renderExtra,
    open: openPanel, close: closePanel
  };
  window.openCustom = function (tab) { openPanel(tab); };
  window.yzMetaDel = metaDel;

  /* 标注按钮走事件委托的 action 表（app.js 的 data-act 分发） */
  if (window.yzAct) {
    try {
      yzAct('yzMetaAdd', function (arg) {
        var p = String(arg || '').split('|');
        if (p.length < 2) return;
        if (metaAdd(p[0], p[1])) { try { openCurrent(); } catch (e) {} }
      });
    } catch (e) {}
  } else {
    /* custom.js 可能早于 app.js 加载：先用点击兜底 */
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      while (t && t !== document) {
        if (t.getAttribute && t.getAttribute('data-act') === 'yzMetaAdd') {
          var p = String(t.getAttribute('data-arg') || '').split('|');
          if (p.length >= 2 && metaAdd(p[0], p[1])) { try { openCurrent(); } catch (e) {} }
          return;
        }
        t = t.parentNode;
      }
    }, true);
  }

  /* app.js 若在本文件之后加载，等 DOM 就绪时把动作注册进它的 ACTIONS 表 */
  function regAct() {
    try {
      if (window.yzAct) {
        yzAct('yzMetaAdd', function (arg) {
          var p = String(arg || '').split('|');
          if (p.length < 2) return;
          if (metaAdd(p[0], p[1])) { try { openCurrent(); } catch (e) {} }
        });
      }
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', regAct);
  else regAct();

  /* 首页模块编排：DOM 就绪后执行一次 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyHome);
  else setTimeout(applyHome, 60);
  window.addEventListener('load', function () { setTimeout(applyHome, 300); });
})();
