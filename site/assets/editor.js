/* =====================================================================
   学通 · 自助编辑器 v2（仅本机生效）
   - 资源导航：新增 / 编辑 / 删除 / 移动目录
   - 人物：改介绍 / 上传头像 / 移动 / 新增人物
   - 目录：改名 / 新增 / 删除
   - 图谱：新建 / 切换 / 改名 / 删除（编辑画布在 graph.html）
   - 数据：导出 / 导入 / 清空
   ★ v2 修复与加固：
     1. 不再依赖 CSS inset / 无 fallback 的 env()（旧 WebView 会让面板尺寸为 0 → 点不到）
     2. 不再使用原生 alert/confirm/prompt（WebView 里可能恒 false/null）；改页内对话框
     3. 所有点击处理都有 try/catch，失败会弹出可见提示，绝不“点了没反应”
     4. 写入后读回校验，存储失败会明确告警
     5. 保存后即时生效（重跑覆盖层 + 刷新页面渲染），无需整页刷新
   用法：点左下角 ✏️；或 index.html?edit=1；也可在「设置 → 自助编辑」里开关
   ===================================================================== */
(function () {
  'use strict';
  if (!window.YZY) return;

  var HUB_DEFAULT = [
    ['leaders', '革命导师'], ['comrades', '革命同志'], ['recommend', '推荐人物'], ['figures', '其他人物'],
    ['thoughts', '思想'], ['orgs', '组织'], ['critics', '被批判人物'], ['events', '重大事件'],
    ['features', '专题'], ['debunks', '辟谣']
  ];
  var PG = [['leaders', '革命导师'], ['comrades', '革命同志'], ['critics', '被批判人物']];
  function CT() { return window.SITE_CONTENT || {}; }
  function EX() { return window.SITE_EXTRA || {}; }
  function RES() { return window.SITE_RESOURCES || []; }
  function groupArr(g) {
    if (g === 'leaders') return CT().leaders || [];
    if (g === 'comrades') return CT().comrades || [];
    if (g === 'critics') return EX().critics || [];
    return [];
  }
  function cats() {
    var m = {}, a = RES();
    for (var i = 0; i < a.length; i++) if (a[i].cat && !m[a[i].cat]) m[a[i].cat] = (m[a[i].cat] || 0) + 1;
    var st = YZY.state() || {};
    (st.resources && st.resources.catAdded || []).forEach(function (c) { if (!m[c]) m[c] = 0; });
    (st.resources && st.resources.catRemoved || []).forEach(function (c) { delete m[c]; });
    return Object.keys(m);
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var d = document.createElement(tag); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }
  /* 不再生成简笔画头像：一律返回空串，列表里会自动改画「姓氏字头像」 */

  /* ================= 样式（兼容旧 WebView：不用 inset，env 带 fallback） ================= */
  var CSS = '' +
    '#zzyBtn{display:none;position:fixed;left:10px;bottom:96px;z-index:9998;width:44px;height:44px;border-radius:50%;border:1px solid #7a2b2b;background:rgba(43,5,5,.9);color:#f0d8a8;font-size:19px;line-height:1;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5);padding:0}' +
    '#zzyBtn:active{background:#7a1f1f}' +
    '#zzyWrap{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:99999;display:none;background:#0d0202;color:#eadfce;overflow:auto;-webkit-overflow-scrolling:touch}' +
    '#zzyWrap.open{display:block}' +
    '#zzyWrap .zx{max-width:860px;margin:0 auto;padding:12px 14px 64px}' +
    '#zzyWrap h3{margin:8px 0 10px;font-size:1.05rem;color:#f3c98b}' +
    '#zzyWrap h4{margin:14px 0 6px;font-size:.9rem;color:#f3c98b}' +
    '#zzyWrap .ztabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}' +
    '#zzyWrap .ztab{padding:8px 14px;border:1px solid #5c2b2b;border-radius:20px;background:transparent;color:#e6d6c0;font-size:.86rem;cursor:pointer;font-family:inherit}' +
    '#zzyWrap .ztab.on{background:#7a1f1f;border-color:#a33;color:#ffe9c2}' +
    '#zzyWrap label{display:block;font-size:.78rem;opacity:.85;margin:10px 0 4px}' +
    '#zzyWrap input,#zzyWrap textarea,#zzyWrap select{width:100%;box-sizing:border-box;background:#1a0606;border:1px solid #4a2222;color:#f2e7d8;border-radius:8px;padding:9px 10px;font-size:.9rem;font-family:inherit}' +
    '#zzyWrap textarea{min-height:96px;resize:vertical}' +
    '#zzyWrap .zrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '#zzyWrap .zrow>*{flex:1;min-width:120px}' +
    '#zzyWrap .zrow>button{flex:0 0 auto;min-width:0}' +
    '#zzyWrap .zbtn{padding:9px 15px;border-radius:8px;border:1px solid #8a3a3a;background:#7a1f1f;color:#ffeccb;font-size:.86rem;cursor:pointer;margin:4px 6px 4px 0;font-family:inherit}' +
    '#zzyWrap .zbtn.ghost{background:transparent;border-color:#7a3a3a;color:#e8d8c0}' +
    '#zzyWrap .zbtn.danger{background:#4a0f0f;border-color:#a33}' +
    '#zzyWrap .zitem{border:1px solid #401d1d;border-radius:10px;padding:10px;margin:8px 0;background:rgba(255,255,255,.02);display:flex;gap:10px;align-items:flex-start}' +
    '#zzyWrap .zitem .zbody{flex:1;min-width:0}' +
    '#zzyWrap .zitem .t{font-size:.92rem;color:#f6d7a0;word-break:break-word}' +
    '#zzyWrap .zitem .s{font-size:.76rem;opacity:.72;margin-top:3px;word-break:break-word}' +
    '#zzyWrap .zava{width:52px;height:52px;flex:0 0 52px;border-radius:50%;overflow:hidden;border:1px solid #5c2b2b;background:#1a0606;display:flex;align-items:center;justify-content:center;font-size:1.2rem}' +
    '#zzyWrap .zava img{width:100%;height:100%;object-fit:cover;display:block}' +
    '#zzyWrap .znote{font-size:.76rem;opacity:.8;line-height:1.7;background:rgba(255,255,255,.04);border-left:3px solid #8a3a3a;padding:8px 10px;border-radius:6px;margin:8px 0}' +
    '#zzyWrap .zwarn{border-left-color:#d9a300;color:#ffd98a}' +
    '#zzyWrap .zclose{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:8px;background:#2b0505;padding:10px 2px;border-bottom:1px solid #401d1d}' +
    '#zzyWrap .zsearch{margin-bottom:8px}' +
    '#zzyToast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:100001;background:#2b0505;color:#ffeccb;border:1px solid #8a3a3a;border-radius:10px;padding:10px 16px;font-size:.84rem;max-width:86%;box-shadow:0 4px 18px rgba(0,0,0,.6);display:none}' +
    '#zzyToast.show{display:block}#zzyToast.err{border-color:#e05555;color:#ffc9c9}' +
    '#zzyDlg{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;background:rgba(8,2,2,.86);display:none;align-items:center;justify-content:center;padding:16px}' +
    '#zzyDlg.open{display:flex}' +
    '#zzyDlg .box{background:#1c0606;border:1px solid #5c2b2b;border-radius:12px;padding:16px;width:100%;max-width:440px;max-height:84%;overflow:auto;box-shadow:0 8px 40px rgba(0,0,0,.7)}' +
    '#zzyDlg .dt{font-size:1rem;color:#f3c98b;margin:0 0 10px}' +
    '#zzyDlg .dm{font-size:.82rem;opacity:.85;line-height:1.7;margin:0 0 10px;white-space:pre-wrap;word-break:break-word}' +
    '#zzyDlg .sw{width:30px;height:30px;border-radius:8px;border:2px solid #6b3a3a;cursor:pointer;display:inline-block;margin:3px}' +
    '#zzyDlg .sw.on{border-color:#ffe9c2;transform:scale(1.08)}' +
    '#zzyErr{position:fixed;left:0;right:0;bottom:0;z-index:100002;background:#5a0d0d;color:#ffdede;font:12px monospace;padding:8px 10px;white-space:pre-wrap;display:none}';

  function mount() {
    if (document.getElementById('zzyBtn')) return;
    var style = document.getElementById('zzyStyle');
    if (!style) { style = document.createElement('style'); style.id = 'zzyStyle'; style.textContent = CSS; (document.head || document.documentElement).appendChild(style); }
    var btn = el('button', '', '✏️'); btn.id = 'zzyBtn'; btn.type = 'button';
    btn.title = '自助编辑（仅本机生效）';
    btn.setAttribute('aria-label', '打开自助编辑器');
    var wrap = el('div', ''); wrap.id = 'zzyWrap';
    var dlg = el('div'); dlg.id = 'zzyDlg'; dlg.appendChild(el('div', 'box', ''));
    var toast = el('div'); toast.id = 'zzyToast';
    var err = el('div'); err.id = 'zzyErr';
    var host = document.body || document.documentElement;
    host.appendChild(btn); host.appendChild(wrap); host.appendChild(dlg); host.appendChild(toast); host.appendChild(err);
    btn.addEventListener('click', function () {
      try { wrap.classList.add('open'); render(); } catch (e) { showErr('打开编辑器失败：' + (e && e.message)); }
    });
  }

  /* ================= 可见提示 ================= */
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = document.getElementById('zzyToast'); if (!t) return;
    t.textContent = String(msg);
    t.className = 'show' + (isErr ? ' err' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, isErr ? 6000 : 2600);
  }
  var showErr = function (m) {
    try { var e = document.getElementById('zzyErr'); if (!e) { toast(m, true); return; } e.style.display = 'block'; e.textContent = '⚠ ' + m; } catch (x) {}
  };
  window.addEventListener('error', function (ev) {
    if (ev && ev.message) showErr(ev.message + ' @' + (ev.filename || '').split('/').pop() + ':' + (ev.lineno || ''));
  }, true);

  /* ================= 页内对话框（替代 alert/confirm/prompt） ================= */
  function dlgOpen() { var d = document.getElementById('zzyDlg'); if (d) d.classList.add('open'); return d; }
  function dlgClose() { var d = document.getElementById('zzyDlg'); if (d) d.classList.remove('open'); }
  function askText(title, def, hint) {
    return new Promise(function (resolve) {
      var d = dlgOpen(); if (!d) { resolve(null); return; }
      var box = d.querySelector('.box'); box.innerHTML = '';
      box.appendChild(el('h4', 'dt', esc(title)));
      if (hint) box.appendChild(el('p', 'dm', esc(hint)));
      var i = el('input'); i.value = def || ''; i.id = 'zzyDlgInput';
      box.appendChild(i);
      var bar = el('div', 'zrow');
      var ok = el('button', 'zbtn', '确定'), no = el('button', 'zbtn ghost', '取消');
      bar.appendChild(ok); bar.appendChild(no); box.appendChild(bar);
      function done(v) { dlgClose(); resolve(v); }
      ok.onclick = function () { done(i.value); };
      no.onclick = function () { done(null); };
      setTimeout(function () { try { i.focus(); } catch (e) {} }, 30);
    });
  }
  function askConfirm(title, text) {
    return new Promise(function (resolve) {
      var d = dlgOpen(); if (!d) { resolve(false); return; }
      var box = d.querySelector('.box'); box.innerHTML = '';
      box.appendChild(el('h4', 'dt', esc(title)));
      if (text) box.appendChild(el('p', 'dm', esc(text)));
      var bar = el('div', 'zrow');
      var ok = el('button', 'zbtn', '确定'), no = el('button', 'zbtn ghost', '取消');
      bar.appendChild(ok); bar.appendChild(no); box.appendChild(bar);
      function done(v) { dlgClose(); resolve(v); }
      ok.onclick = function () { done(true); };
      no.onclick = function () { done(false); };
    });
  }
  var PALETTE = ['#f5c518', '#8de6a1', '#7ec8ff', '#ff8b8b', '#d7aef2', '#ffd166', '#63e6be', '#ffa8a8', '#a5d8ff', '#e5dbff', '#ffffff', '#9aa0a6'];
  function askForm(title, fields) {
    return new Promise(function (resolve) {
      var d = dlgOpen(); if (!d) { resolve(null); return; }
      var box = d.querySelector('.box'); box.innerHTML = '';
      box.appendChild(el('h4', 'dt', esc(title)));
      fields.forEach(function (fd) {
        box.appendChild(el('label', '', esc(fd.label || fd.k)));
        var i;
        if (fd.type === 'select') {
          i = el('select');
          (fd.options || []).forEach(function (o) { var op = el('option'); op.value = o[0]; op.textContent = o[1]; i.appendChild(op); });
        } else if (fd.type === 'textarea') { i = el('textarea'); i.value = fd.value || ''; }
        else { i = el('input'); i.value = fd.value || ''; if (fd.placeholder) i.placeholder = fd.placeholder; }
        i.id = 'zzydlg_' + fd.k;
        box.appendChild(i);
      });
      var bar = el('div', 'zrow');
      var ok = el('button', 'zbtn', '确定'), no = el('button', 'zbtn ghost', '取消');
      bar.appendChild(ok); bar.appendChild(no); box.appendChild(bar);
      function done(v) { dlgClose(); resolve(v); }
      ok.onclick = function () {
        var o = {};
        fields.forEach(function (fd) { var e = document.getElementById('zzydlg_' + fd.k); o[fd.k] = e ? e.value : ''; });
        done(o);
      };
      no.onclick = function () { done(null); };
    });
  }

  /* ================= 头像：文件 → 缩放 → dataURL ================= */
  function fileToAvatar(file, cb) {
    if (!file) { cb('', '没有选择文件'); return; }
    if (!/^image\//.test(file.type || '')) { cb('', '不是图片文件'); return; }
    var fr = new FileReader();
    fr.onerror = function () { cb('', '读取文件失败'); };
    fr.onload = function () {
      var src = String(fr.result || '');
      if (!src) { cb('', '读取为空'); return; }
      var im = new Image();
      im.onload = function () {
        try {
          var MAXPX = 256;
          var w = im.width || 0, h = im.height || 0;
          if (!w || !h) { cb(src, ''); return; }
          var k = Math.min(1, MAXPX / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
          var c = document.createElement('canvas'); c.width = cw; c.height = ch;
          var cx = c.getContext('2d');
          if (!cx) { cb(src, ''); return; }
          cx.drawImage(im, 0, 0, cw, ch);
          var out = c.toDataURL('image/jpeg', 0.82);
          if (!out || out.length > 380000) out = c.toDataURL('image/jpeg', 0.6);
          if (!out || out.length > 380000) { cb('', '图片过大，请换一张更小的'); return; }
          cb(out, '');
        } catch (e) { cb(src.length < 380000 ? src : '', e && e.message); }
      };
      im.onerror = function () { cb(src.length < 380000 ? src : '', '图片解码失败'); };
      im.src = src;
    };
    fr.readAsDataURL(file);
  }
  function avatarPicker(prefix, initial, onChange) {
    var row = el('div', 'zrow');
    var prev = el('div', 'zava');
    prev.id = prefix + '_prev';
    function paint(v) { prev.innerHTML = v ? '<img src="' + esc(v) + '" alt="头像">' : '👤'; }
    paint(initial);
    var fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none';
    fi.id = prefix + '_file';
    var pick = el('button', 'zbtn ghost', '上传头像');
    var clr = el('button', 'zbtn ghost', '移除');
    pick.type = 'button'; clr.type = 'button';
    pick.onclick = function () { try { fi.click(); } catch (e) { showErr('无法打开文件选择：' + (e && e.message)); } };
    fi.onchange = function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      toast('正在处理图片…');
      fileToAvatar(f, function (dataUrl, errmsg) {
        if (errmsg && !dataUrl) { toast('图片处理失败：' + errmsg, true); return; }
        if (errmsg) toast('提示：' + errmsg, true);
        paint(dataUrl); onChange(dataUrl); toast('头像已选，记得点保存');
      });
    };
    clr.onclick = function () { paint(''); onChange(''); };
    row.appendChild(prev); row.appendChild(pick); row.appendChild(clr); row.appendChild(fi);
    return row;
  }

  /* ================= 保存后即时生效 ================= */
  function applyNow(msg) {
    var r = null;
    try { r = YZY.reapply(); } catch (e) { showErr('应用改动失败：' + (e && e.message)); }
    try { if (typeof window.__yzRefreshLabels === 'function') window.__yzRefreshLabels(); } catch (e) {}
    try { if (typeof window.render === 'function') window.render(); } catch (e) {}
    var st = YZY.storage();
    if (!st.ok) toast((msg || '已保存') + '｜⚠ ' + st.warn, true);
    else if (msg) toast(msg);
    return r;
  }

  /* ================= 壳与渲染 ================= */
  var tab = 'res', resQ = '', pSel = 'leaders';
  function close() { var w = document.getElementById('zzyWrap'); if (w) w.classList.remove('open'); }

  function render() {
    var wrap = document.getElementById('zzyWrap'); if (!wrap) return;
    wrap.innerHTML = '';
    var box = el('div', 'zx');
    var head = el('div', 'zclose');
    head.appendChild(el('b', '', '✏️ 自助编辑'));
    head.appendChild(el('span', '', '<span style="font-size:.72rem;opacity:.7">仅本机生效</span>'));
    var x = el('button', 'zbtn ghost', '关闭'); x.type = 'button'; x.onclick = close; head.appendChild(x);
    box.appendChild(head);

    var tabs = el('div', 'ztabs');
    [['res', '资源'], ['ppl', '人物'], ['cat', '目录'], ['graph', '图谱'], ['data', '数据']].forEach(function (t) {
      var b = el('button', 'ztab' + (tab === t[0] ? ' on' : ''), t[1]); b.type = 'button';
      b.onclick = function () { tab = t[0]; render(); };
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    var st = YZY.storage();
    box.appendChild(el('div', 'znote' + (st.ok ? '' : ' zwarn'),
      st.ok
        ? '改动只存在本机（' + esc(st.backend) + '），不上传、不改动网站、不影响他人。要让改动全站生效：到「数据」导出 JSON，交给站点维护者。'
        : '⚠ 本机存储不可用：' + esc(st.warn) + '。可继续编辑，但建议尽快到「数据」导出 JSON 备份。'));

    try {
      if (tab === 'res') box.appendChild(resTab());
      else if (tab === 'ppl') box.appendChild(pplTab());
      else if (tab === 'cat') box.appendChild(catTab());
      else if (tab === 'graph') box.appendChild(graphTab());
      else box.appendChild(dataTab());
    } catch (e) { box.appendChild(el('div', 'znote zwarn', '该页渲染出错：' + esc(e && e.message))); }
    wrap.appendChild(box);
  }

  /* ---------------- 资源 ---------------- */
  function resTab() {
    var f = el('div');
    f.appendChild(el('h3', '', '资源导航（' + RES().length + ' 条）'));
    var add = el('button', 'zbtn', '＋ 新增资源'); add.type = 'button';
    add.onclick = function () { resForm(null); };
    f.appendChild(add);

    var s = el('input', 'zsearch'); s.placeholder = '搜索标题 / 作者 / id'; s.value = resQ;
    s.oninput = function () { resQ = s.value; var list = $('zzyResList'); if (list) list.innerHTML = resListHTML(); };
    f.appendChild(s);

    var list = el('div'); list.id = 'zzyResList'; list.innerHTML = resListHTML();
    f.appendChild(list);
    list.addEventListener('click', function (e) {
      try {
        var b = e.target && e.target.closest ? e.target.closest('button') : null; if (!b) return;
        var id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
        if (act === 'edit') resForm(id);
        else if (act === 'del') askConfirm('删除条目？（仅本机）', '').then(function (y) { if (y) { YZY.removeResource(id); applyNow('已删除'); render(); } });
        else if (act === 'move') askText('移动到哪个目录？', '').then(function (to) { if (to) { YZY.moveResource(id, to); applyNow('已移动'); render(); } });
      } catch (err) { showErr('操作失败：' + (err && err.message)); }
    });
    return f;
  }
  function resListHTML() {
    var a = RES(), q = (resQ || '').toLowerCase(), out = '', n = 0;
    for (var i = 0; i < a.length && n < 400; i++) {
      var r = a[i] || {};
      var hay = ((r.title || '') + (r.author || '') + (r.id || '')).toLowerCase();
      if (q && hay.indexOf(q) < 0) continue;
      n++;
      var nav = r.avatar || r.img;
      out += '<div class="zitem">' +
        (r.icon ? '<div class="zava" style="border-radius:10px">' + esc(r.icon) + '</div>' : '') +
        '<div class="zbody"><div class="t">' + esc(r.title || '') + '</div>' +
        '<div class="s">' + esc(r.id || '') + ' ｜ ' + esc(r.author || '—') + ' ｜ ' + esc(r.cat || '') + '</div>' +
        '<div style="margin-top:6px"><button class="zbtn ghost" type="button" data-act="edit" data-id="' + esc(r.id) + '">编辑</button>' +
        '<button class="zbtn ghost" type="button" data-act="move" data-id="' + esc(r.id) + '">移动目录</button>' +
        '<button class="zbtn danger" type="button" data-act="del" data-id="' + esc(r.id) + '">删除</button></div></div></div>';
    }
    if (!n) out = '<div class="znote">没有匹配条目。</div>';
    return out;
  }
  function resForm(id) {
    var base = null, a = RES();
    if (id) for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) base = a[i];
    var isNew = !base;
    var d = { title: base ? base.title : '', author: base ? base.author : '', cat: base ? base.cat : (cats()[0] || '参考'),
      icon: base ? base.icon : '📄', url: base ? base.url : '', desc: base ? base.desc : '', intro: base ? base.intro : '',
      note: base ? base.note : '', tags: base && base.tags ? base.tags.join(' ') : '' };
    var f = el('div');
    f.appendChild(el('h3', '', isNew ? '新增资源' : ('编辑：' + esc(d.title))));
    f.appendChild(form([['title', '标题', 'input'], ['author', '作者', 'input'], ['cat', '目录(分类)', 'input'],
      ['icon', '图标(emoji)', 'input'], ['url', '链接/文件路径', 'input'], ['desc', '一句话描述', 'input'],
      ['tags', '标签(空格分隔)', 'input'], ['intro', '简介', 'textarea'], ['note', '来源/说明', 'textarea']], d, 'zzyResForm'));
    var bar = el('div');
    var save = el('button', 'zbtn', isNew ? '添加' : '保存修改'); save.type = 'button';
    save.onclick = function () {
      try {
        var g = function (k) { var e = $('zzyResForm_' + k); return e ? e.value : ''; };
        var patch = { title: g('title'), author: g('author'), cat: g('cat'), icon: g('icon'), url: g('url'),
          desc: g('desc'), intro: g('intro'), note: g('note'), tags: String(g('tags')).split(/\s+/) };
        if (!String(patch.title).trim()) { toast('标题不能为空', true); return; }
        var r = isNew ? YZY.addResource(patch) : YZY.editResource(id, patch);
        if (!r || r.ok === false) { toast((r && r.msg) || '保存失败', true); return; }
        applyNow(isNew ? '已新增' : '已保存'); render();
      } catch (e) { showErr('保存失败：' + (e && e.message)); }
    };
    var back = el('button', 'zbtn ghost', '返回列表'); back.type = 'button'; back.onclick = render;
    bar.appendChild(save); bar.appendChild(back);
    if (!isNew) {
      var del = el('button', 'zbtn danger', '删除该条'); del.type = 'button';
      del.onclick = function () { askConfirm('删除？（仅本机）', '').then(function (y) { if (y) { YZY.removeResource(id); applyNow('已删除'); render(); } }); };
      bar.appendChild(del);
    }
    f.appendChild(bar);
    var wrap = document.getElementById('zzyWrap');
    wrap.querySelector('.zx').appendChild(f);
    scrollToEl(f);
  }
  function scrollToEl(f) {
    try { if (f && typeof f.scrollIntoView === 'function') f.scrollIntoView(true); } catch (e) {}
  }

  /* ---------------- 人物 ---------------- */
  function pplTab() {
    var f = el('div');
    f.appendChild(el('h3', '', '人物（可自由修改介绍、上传头像）'));
    var bar = el('div', 'zrow');
    var sel = el('select');
    PG.forEach(function (g) {
      var o = el('option'); o.value = g[0]; o.textContent = g[1] + '（' + groupArr(g[0]).length + '）';
      if (g[0] === pSel) o.selected = true; sel.appendChild(o);
    });
    sel.onchange = function () { pSel = sel.value; render(); };
    bar.appendChild(sel);
    if (pSel === 'leaders') {
      /* 革命导师为内置固定五位：不提供新增，避免与内置名单冲突 */
      f.appendChild(el('div', 'znote', '「革命导师」为内置固定的五位，不接受新增。要补充人物，请切换到「革命同志」或「被批判人物」。'));
    } else {
      var addp = el('button', 'zbtn', '＋ 新增人物'); addp.type = 'button';
      addp.onclick = function () { personNewForm(); };
      bar.appendChild(addp);
    }
    f.appendChild(bar);

    var arr = groupArr(pSel);
    var list = el('div');
    for (var i = 0; i < arr.length; i++) {
      (function (p) {
        var name = p.name || '';
        var it = el('div', 'zitem');
        var av = el('div', 'zava');
        var img = p.img || '';
        av.innerHTML = img ? '<img src="' + esc(img) + '" alt="">' : esc(name.charAt(0) || '?');
        var body = el('div', 'zbody');
        body.innerHTML = '<div class="t">' + esc(name) + '</div><div class="s">' + esc(p.years || '') + ' ｜ ' + esc(p.role || '') + '</div>' +
          '<div class="s">' + esc(String(p.intro || p.desc || '').slice(0, 70)) + '…</div>';
        var ops = el('div'); ops.style.marginTop = '6px';
        var b1 = el('button', 'zbtn ghost', '修改介绍'); b1.type = 'button'; b1.onclick = function () { personForm(pSel, name); };
        ops.appendChild(b1);
        var b2 = el('button', 'zbtn ghost', '改头像'); b2.type = 'button'; b2.onclick = function () { personAvatarForm(pSel, name, p.img || ''); };
        ops.appendChild(b2);
        var b3 = el('button', 'zbtn ghost', '移动到其它目录'); b3.type = 'button';
        b3.onclick = function () {
          askForm('移动到其它目录', [{ k: 'g', label: '目标目录', type: 'select', options: PG.map(function (g) { return [g[0], g[1]]; }) }]).then(function (o) {
            if (!o) return;
            if (o.g === pSel) { toast('已在该目录', true); return; }
            YZY.movePerson(pSel, name, o.g); applyNow('已移动'); render();
          });
        };
        ops.appendChild(b3);
        body.appendChild(ops);
        it.appendChild(av); it.appendChild(body);
        list.appendChild(it);
      })(arr[i] || {});
    }
    if (!arr.length) list.appendChild(el('div', 'znote', '该目录暂无人物。'));
    f.appendChild(list);

    var st = YZY.state() || {};
    var added = (st.people && st.people.added || []).filter(function (x) { return x.group === pSel; });
    if (added.length) {
      f.appendChild(el('h4', '', '本机新增（' + added.length + '）'));
      added.forEach(function (p) {
        var it = el('div', 'zitem');
        var av = el('div', 'zava'); av.innerHTML = p.avatar ? '<img src="' + esc(p.avatar) + '" alt="">' : esc((p.name || '?').charAt(0));
        var body = el('div', 'zbody');
        body.innerHTML = '<div class="t">' + esc(p.name) + ' <span style="opacity:.6;font-size:.75rem">（本机新增）</span></div><div class="s">' + esc(p.role || '') + '</div>';
        var ops = el('div'); ops.style.marginTop = '6px';
        var de = el('button', 'zbtn danger', '删除'); de.type = 'button';
        de.onclick = function () { askConfirm('删除这个本机新增的人物？', p.name).then(function (y) { if (y) { YZY.removePersonAdded(p.key); applyNow('已删除'); render(); } }); };
        ops.appendChild(de); body.appendChild(ops);
        it.appendChild(av); it.appendChild(body); f.appendChild(it);
      });
    }
    return f;
  }
  function personForm(group, name) {
    var arr = groupArr(group), base = null;
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].name === name) base = arr[i];
    if (!base) { toast('找不到该人物', true); return; }
    var isCritic = (group === 'critics');
    var d = { intro: base.intro || base.desc || '', role: base.role || '', works: base.works || '', years: base.years || '',
      points: base.points ? base.points.join('\n') : '' };
    var f = el('div');
    f.appendChild(el('h3', '', '修改人物：' + esc(name)));
    var fields = [['intro', isCritic ? '简介' : '介绍', 'textarea'], ['role', '职务/定位', 'input'], ['works', '代表作', 'input'], ['years', '生卒年', 'input']];
    if (!isCritic) fields.push(['points', '要点（每行一条）', 'textarea']);
    f.appendChild(form(fields, d, 'zzyPplForm'));
    var bar = el('div');
    var save = el('button', 'zbtn', '保存修改'); save.type = 'button';
    save.onclick = function () {
      try {
        var g = function (k) { var e = $('zzyPplForm_' + k); return e ? e.value : ''; };
        var patch = { intro: g('intro'), role: g('role'), works: g('works'), years: g('years') };
        if (!isCritic) patch.points = String(g('points')).split(/\n+/).filter(function (x) { return x.trim(); });
        var r = YZY.editPerson(group, name, patch);
        if (r && r.ok === false) { toast(r.msg || '保存失败', true); return; }
        applyNow('已保存'); render();
      } catch (e) { showErr('保存失败：' + (e && e.message)); }
    };
    var back = el('button', 'zbtn ghost', '返回'); back.type = 'button'; back.onclick = render;
    bar.appendChild(save); bar.appendChild(back); f.appendChild(bar);
    document.getElementById('zzyWrap').querySelector('.zx').appendChild(f);
    scrollToEl(f);
  }
  function personAvatarForm(group, name, cur) {
    var f = el('div');
    f.appendChild(el('h3', '', '上传头像：' + esc(name)));
    f.appendChild(el('div', 'znote', '头像会缩到 256px 并压缩后存在本机（不上传）。若不满意可「移除」恢复默认线稿头像。'));
    var val = { v: cur };
    f.appendChild(avatarPicker('zzyAva', cur, function (v) { val.v = v; }));
    var bar = el('div');
    var save = el('button', 'zbtn', '保存头像'); save.type = 'button';
    save.onclick = function () {
      try {
        var r = YZY.setAvatar(group + '|' + name, val.v);
        if (r && r.ok === false) { toast(r.msg || '保存失败', true); return; }
        applyNow(val.v ? '头像已更新' : '头像已移除'); render();
      } catch (e) { showErr('保存失败：' + (e && e.message)); }
    };
    var back = el('button', 'zbtn ghost', '返回'); back.type = 'button'; back.onclick = render;
    bar.appendChild(save); bar.appendChild(back); f.appendChild(bar);
    document.getElementById('zzyWrap').querySelector('.zx').appendChild(f);
    scrollToEl(f);
  }
  function personNewForm() {
    var f = el('div');
    f.appendChild(el('h3', '', '新增人物'));
    f.appendChild(el('div', 'znote', '新增的人物只存在本机。请只补充你有依据的内容——本站不编造史料。'));
    var d = { name: '', group: 'comrades', years: '', role: '', intro: '' };
    f.appendChild(form([['name', '姓名', 'input'], ['years', '生卒年', 'input'], ['role', '职务/定位', 'input'], ['intro', '介绍', 'textarea']], d, 'zzyNewP'));
    f.appendChild(el('label', '', '目录'));
    var sel = el('select'); sel.id = 'zzyNewP_group';
    /* 目录选项排除「革命导师」：内置固定五位，不可新增 */
    PG.filter(function (g) { return g[0] !== 'leaders'; })
      .forEach(function (g) { var o = el('option'); o.value = g[0]; o.textContent = g[1]; sel.appendChild(o); });
    f.appendChild(sel);
    f.appendChild(el('label', '', '头像（可选）'));
    var av = { v: '' };
    f.appendChild(avatarPicker('zzyNewAva', '', function (v) { av.v = v; }));
    var bar = el('div');
    var save = el('button', 'zbtn', '添加'); save.type = 'button';
    save.onclick = function () {
      try {
        var g = function (k) { var e = $('zzyNewP_' + k); return e ? e.value : ''; };
        var s = $('zzyNewP_group');
        var r = YZY.addPerson({ name: g('name'), group: s ? s.value : 'comrades', years: g('years'), role: g('role'), intro: g('intro'), avatar: av.v });
        if (r && r.ok === false) { toast(r.msg || '添加失败', true); return; }
        applyNow('已新增人物'); render();
      } catch (e) { showErr('添加失败：' + (e && e.message)); }
    };
    var back = el('button', 'zbtn ghost', '返回'); back.type = 'button'; back.onclick = render;
    bar.appendChild(save); bar.appendChild(back); f.appendChild(bar);
    document.getElementById('zzyWrap').querySelector('.zx').appendChild(f);
    scrollToEl(f);
  }

  /* ---------------- 目录 ---------------- */
  function catTab() {
    var f = el('div');
    f.appendChild(el('h3', '', '目录管理'));
    f.appendChild(el('div', 'znote', '改名只改显示名，条目的链接与内容不变；「新增目录」可新建空目录（再把资源移进去）。'));

    f.appendChild(el('h4', '', '新增目录'));
    var addRow = el('div', 'zrow');
    var ni = el('input'); ni.id = 'zzyNewCat'; ni.placeholder = '新目录名，如：新民主主义时期';
    var nb = el('button', 'zbtn', '＋ 新增'); nb.type = 'button';
    nb.onclick = function () {
      try {
        var v = $('zzyNewCat').value;
        var r = YZY.addCat(v);
        if (r && r.ok === false) { toast(r.msg || '失败', true); return; }
        applyNow('目录已新增'); render();
      } catch (e) { showErr(e && e.message); }
    };
    addRow.appendChild(ni); addRow.appendChild(nb); f.appendChild(addRow);

    f.appendChild(el('h4', '', '「史料」栏目名'));
    HUB_DEFAULT.forEach(function (h) {
      var cur = YZY.getHubLabel(h[0], h[1]);
      var row = el('div', 'zrow');
      var i = el('input'); i.value = cur; i.id = 'zzyHub_' + h[0];
      var b = el('button', 'zbtn ghost', '保存'); b.type = 'button';
      b.onclick = function () {
        try { YZY.setHubLabel(h[0], $('zzyHub_' + h[0]).value); applyNow('栏目名已保存（已刷新）'); if (typeof window.__yzRefreshLabels === 'function') { render(); } else { setTimeout(function () { try { location.reload(); } catch (e) {} }, 200); } }
        catch (e) { showErr(e && e.message); }
      };
      row.appendChild(i); row.appendChild(b); f.appendChild(row);
    });

    f.appendChild(el('h4', '', '资源目录 / 分类'));
    cats().forEach(function (c) {
      var row = el('div', 'zrow');
      var i = el('input'); i.value = c; i.id = 'zzyCat_' + encodeURIComponent(c);
      var b = el('button', 'zbtn ghost', '改名'); b.type = 'button';
      b.onclick = function () {
        try {
          var to = $('zzyCat_' + encodeURIComponent(c)).value.trim();
          if (!to || to === c) { toast('名称未变化', true); return; }
          var r = YZY.renameCat(c, to);
          if (r && r.ok === false) { toast(r.msg || '失败', true); return; }
          applyNow('已改名'); render();
        } catch (e) { showErr(e && e.message); }
      };
      var d = el('button', 'zbtn danger', '删除'); d.type = 'button';
      d.onclick = function () {
        askConfirm('删除目录「' + c + '」？', '目录内已有条目不会被删除，它们会显示原有分类名。').then(function (y) {
          if (!y) return; YZY.removeCat(c); applyNow('已删除目录'); render();
        });
      };
      row.appendChild(i); row.appendChild(b); row.appendChild(d); f.appendChild(row);
    });
    return f;
  }

  /* ---------------- 图谱 ---------------- */
  function graphTab() {
    var f = el('div');
    f.appendChild(el('h3', '', '关系图谱'));
    f.appendChild(el('div', 'znote', '在画布上可「新建图谱 / 加节点 / 连线 / 设关系线颜色与名称 / 删节点」。点下方按钮进入画布编辑模式。'));
    var open = el('a', 'zbtn', '🕸 打开图谱编辑');
    open.href = 'graph.html?edit=1'; open.style.display = 'inline-block'; open.style.textDecoration = 'none';
    f.appendChild(open);

    f.appendChild(el('h4', '', '新建图谱'));
    var row = el('div', 'zrow');
    var ni = el('input'); ni.id = 'zzyNewGraph'; ni.placeholder = '图谱名称，如：早期建党关系';
    var nb = el('button', 'zbtn', '＋ 新建并切换'); nb.type = 'button';
    nb.onclick = function () {
      try {
        var v = $('zzyNewGraph').value;
        var r = YZY.newGraph(v);
        if (r && r.ok === false) { toast(r.msg || '失败', true); return; }
        applyNow('已新建图谱「' + r.name + '」，正在打开…');
        setTimeout(function () { try { location.href = 'graph.html?edit=1'; } catch (e) {} }, 260);
      } catch (e) { showErr(e && e.message); }
    };
    row.appendChild(ni); row.appendChild(nb); f.appendChild(row);

    f.appendChild(el('h4', '', '我的图谱（点击切换）'));
    var act = YZY.activeGraphId();
    YZY.listGraphs().forEach(function (g) {
      var it = el('div', 'zitem');
      var body = el('div', 'zbody');
      body.innerHTML = '<div class="t">' + esc(g.name) + (g.id === act ? ' <span style="color:#8de6a1">✓ 当前</span>' : '') + '</div>' +
        '<div class="s">' + (function(){ var nn=g.nodes, ll=g.links; if(nn==null && window.YZY && YZY.graphData){ try{ var dd=YZY.graphData(g.id); nn=(dd.nodes||[]).length; ll=(dd.links||[]).length; }catch(e){} } return (nn==null) ? (g.builtin ? '内置图谱' : '') : ('节点 ' + nn + ' ｜ 关系 ' + ll); })() + '</div>';
      var ops = el('div'); ops.style.marginTop = '6px';
      if (!g.builtin) {
        var sw = el('button', 'zbtn ghost', '切换'); sw.type = 'button';
        sw.onclick = function () { YZY.setActiveGraph(g.id); applyNow('已切换'); render(); };
        var rn = el('button', 'zbtn ghost', '改名'); rn.type = 'button';
        rn.onclick = function () { askText('重命名图谱', g.name).then(function (v) { if (v) { YZY.renameGraph(g.id, v); applyNow('已改名'); render(); } }); };
        var de = el('button', 'zbtn danger', '删除'); de.type = 'button';
        de.onclick = function () { askConfirm('删除图谱「' + g.name + '」？', '图谱内的节点与关系会一并删除，不可恢复。').then(function (y) { if (y) { YZY.deleteGraph(g.id); applyNow('已删除'); render(); } }); };
        ops.appendChild(sw); ops.appendChild(rn); ops.appendChild(de);
      } else if (g.id !== act) {
        var sw2 = el('button', 'zbtn ghost', '切换回主图谱'); sw2.type = 'button';
        sw2.onclick = function () { YZY.setActiveGraph('main'); applyNow('已切回主图谱'); render(); };
        ops.appendChild(sw2);
      }
      body.appendChild(ops);
      it.appendChild(body); f.appendChild(it);
    });
    return f;
  }

  /* ---------------- 数据 ---------------- */
  function dataTab() {
    var f = el('div');
    var st = YZY.stats(), si = YZY.storage();
    f.appendChild(el('h3', '', '数据'));
    f.appendChild(el('div', 'znote' + (si.ok ? '' : ' zwarn'),
      '本机改动：新增资源 ' + st.added + ' ｜ 改资源 ' + st.edited + ' ｜ 删资源 ' + st.removed +
      ' ｜ 目录改动 ' + st.cats + ' ｜ 人物改 ' + st.peopleEdited + ' ｜ 人物移动 ' + st.peopleMoved +
      ' ｜ 新增人物 ' + st.peopleAdded + ' ｜ 头像 ' + st.avatars +
      ' ｜ 栏目改名 ' + st.hubLabels + ' ｜ 自建图谱 ' + st.graphs + '（节点 ' + st.graphNodes + ' / 关系 ' + st.graphEdges + '）' +
      '<br>存储后端：' + esc(si.backend) + (si.warn ? ('（' + esc(si.warn) + '）') : '')));

    var exp = el('button', 'zbtn', '导出 JSON'); exp.type = 'button';
    exp.onclick = function () {
      try {
        var txt = YZY.exportJSON(), name = '学通-我的改动-' + new Date().toISOString().slice(0, 10) + '.json';
        if (window.AndroidApp && window.AndroidApp.saveBase64) {
          window.AndroidApp.saveBase64(name, btoa(unescape(encodeURIComponent(txt))), 'application/json');
          toast('已保存到「下载」：' + name); return;
        }
        var b = new Blob([txt], { type: 'application/json' });
        var u = URL.createObjectURL(b), a = document.createElement('a');
        a.href = u; a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { try { URL.revokeObjectURL(u); a.remove(); } catch (e) {} }, 1500);
        toast('已导出：' + name);
      } catch (e) { showErr('导出失败：' + (e && e.message)); }
    };
    f.appendChild(exp);

    f.appendChild(el('label', '', '导入 JSON 文件'));
    var impFile = el('input'); impFile.type = 'file'; impFile.accept = '.json,application/json';
    impFile.onchange = function () {
      var file = impFile.files && impFile.files[0]; if (!file) return;
      var fr = new FileReader();
      fr.onerror = function () { toast('读取文件失败', true); };
      fr.onload = function () {
        askForm('导入方式', [{ k: 'mode', label: '合并 = 保留现有；替换 = 清空后导入', type: 'select', options: [['merge', '合并'], ['replace', '替换']] }]).then(function (o) {
          if (!o) return;
          var r = YZY.importJSON(String(fr.result), o.mode);
          toast(r.msg, !r.ok); if (r.ok) render();
        });
      };
      fr.readAsText(file, 'utf-8');
    };
    f.appendChild(impFile);

    f.appendChild(el('label', '', '或粘贴 JSON'));
    var paste = el('textarea'); paste.placeholder = '把 JSON 粘贴到这里';
    f.appendChild(paste);
    var imp2 = el('button', 'zbtn ghost', '导入粘贴内容'); imp2.type = 'button';
    imp2.onclick = function () { try { var r = YZY.importJSON(paste.value, 'merge'); toast(r.msg, !r.ok); if (r.ok) render(); } catch (e) { showErr(e && e.message); } };
    f.appendChild(imp2);

    var rst = el('button', 'zbtn danger', '清空本机全部改动'); rst.type = 'button';
    rst.onclick = function () { askConfirm('确定清空本机所有改动？', '不影响线上站点。此操作不可撤销。').then(function (y) { if (y) { YZY.reset(); applyNow('已清空'); render(); } }); };
    f.appendChild(rst);
    return f;
  }

  /* ---------------- 通用表单 ---------------- */
  function form(fields, data, idPrefix) {
    var f = el('div');
    fields.forEach(function (fd) {
      var k = fd[0], label = fd[1], type = fd[2];
      f.appendChild(el('label', '', label));
      var i;
      if (type === 'textarea') { i = el('textarea'); i.value = data[k] || ''; }
      else { i = el('input'); i.value = data[k] || ''; }
      i.id = idPrefix + '_' + k;
      f.appendChild(i);
    });
    return f;
  }

  /* ================= 启动 ================= */
  function boot() {
    if (!YZY.editorEnabled()) return;   // 在「设置 → 自助编辑」里关掉了
    mount();
    if (/[?&]edit=1/.test(location.search)) {
      setTimeout(function () {
        try { var w = document.getElementById('zzyWrap'); if (w) { w.classList.add('open'); render(); } } catch (e) { showErr(e && e.message); }
      }, 350);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.__yzEditorBoot = boot;   // 供设置开关即时启用
})();
