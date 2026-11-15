/* =====================================================================
   学通 · 正文编辑器（textedit.js）
   ---------------------------------------------------------------------
   要解决的问题：内置的 39 篇正文、以及自己导入的整本书，以前只能读，
   错字、断行、缺段都改不了。这一层给段落级的改动能力：

     · 每段可改文字、可整段删除、可把删掉的段恢复
     · 改动只存本机（localStorage 键 yzTextPatch），不上传、不动包里的原文
     · 随导出我的数据一起备份，换设备导入即恢复
     · 阅读器渲染时按 patch 显示（appbooks.js 里那三行）

   存储结构：{ "books/bk_guoxxx.txt": { "12": "改成这样", "15": "" } }
     "" 表示这一段被删除；没有这个键表示用原文。

   对外：YZTextEdit.open(key, title, items)
   ===================================================================== */
(function () {
  'use strict';

  var LS = 'yzTextPatch';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

  function all() {
    try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(o) {
    try { localStorage.setItem(LS, JSON.stringify(o)); return true; }
    catch (e) { toast('本机存储写不进去：' + e.message); return false; }
  }
  function patchOf(key) { var o = all(); return o[key] || {}; }

  window.YZTextPatchGet = function (key, idx) {
    var p = patchOf(key);
    if (!Object.prototype.hasOwnProperty.call(p, String(idx))) return undefined;
    return p[String(idx)];
  };
  window.YZTextCount = function (key) { return Object.keys(patchOf(key)).length; };

  function setPatch(key, idx, val) {
    var o = all();
    o[key] = o[key] || {};
    if (val == null) delete o[key][String(idx)];
    else o[key][String(idx)] = String(val);
    if (!Object.keys(o[key]).length) delete o[key];
    return save(o);
  }

  function open(key, title, items) {
    var old = document.getElementById('yzTextEdit');
    if (old) { try { old.remove(); } catch (e) {} }
    var p = patchOf(key);
    var nMod = Object.keys(p).length;

    var wrap = document.createElement('div');
    wrap.id = 'yzTextEdit';
    /* 配色只能取站点真实定义过的变量：--fg 全站从未定义过（只有 --text），
       浅色主题下 --bg 是 #f5e9e2，如果文字色退回 #f2e9e4 就等于白底白字。
       --panel-bg / --panel-text 由 body.light 提供，深色主题没有则退回 --bg / --text。 */
    wrap.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:100060;' +
      'background:var(--panel-bg,var(--bg,#1b1412));' +
      'color:var(--panel-text,var(--text,#f2e8d8));display:flex;flex-direction:column;' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';

    var rows = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      var mod = Object.prototype.hasOwnProperty.call(p, String(i));
      var cur = mod ? p[String(i)] : it.t;
      var del = mod && cur === '';
      var head = it.k === 'h' ? '§ ' : '';
      var brief = String(cur || '').slice(0, 46) || '（空）';
      rows += '<div class="te-row' + (mod ? ' te-mod' : '') + (del ? ' te-del' : '') + '" data-i="' + i + '">' +
        '<span class="te-i">' + (i + 1) + '</span>' +
        '<span class="te-b">' + esc(head + brief) + (del ? ' · 已删除' : '') + '</span>' +
        '<span class="te-a">' + (mod ? '↺' : '✎') + '</span></div>';
    }

    wrap.innerHTML =
      '<style>' +
      '#yzTextEdit .te-bar{padding:12px 14px;border-bottom:1px solid var(--line,rgba(255,255,255,.16));display:flex;' +
      'align-items:center;gap:10px;flex:0 0 auto}' +
      '#yzTextEdit .te-bar b{flex:1;font-size:.94rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#yzTextEdit .te-x{background:none;border:none;color:inherit;font-size:1.15rem;' +
      'min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center}' +
      '#yzTextEdit .te-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:6px 10px 40px}' +
      '#yzTextEdit .te-tip{font-size:.74rem;opacity:.62;line-height:1.7;padding:8px 14px 4px}' +
      '#yzTextEdit .te-row{display:flex;gap:8px;align-items:center;padding:10px 8px;border-bottom:1px solid var(--line,rgba(255,255,255,.07));' +
      'font-size:.86rem;line-height:1.6}' +
      '#yzTextEdit .te-i{flex:0 0 34px;opacity:.42;font-size:.72rem;text-align:right}' +
      '#yzTextEdit .te-b{flex:1;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;' +
      '-webkit-box-orient:vertical}' +
      '#yzTextEdit .te-a{flex:0 0 22px;opacity:.5;text-align:center}' +
      '#yzTextEdit .te-mod .te-a{opacity:1;color:var(--accent,#f5c518)}' +
      '#yzTextEdit .te-del .te-b{opacity:.45;text-decoration:line-through}' +
      '#yzTextEdit .te-edit{position:fixed;left:0;right:0;bottom:0;top:0;background:rgba(0,0,0,.55);' +
      'display:flex;align-items:flex-end;z-index:100061}' +
      '#yzTextEdit .te-card{width:100%;max-height:86vh;overflow:auto;background:var(--panel-bg,#241a16);' +
      'color:var(--panel-text,var(--text,#f2e8d8));border-radius:16px 16px 0 0;' +
      'padding:14px 16px calc(18px + env(safe-area-inset-bottom,0px))}' +
      '#yzTextEdit .te-card textarea{width:100%;box-sizing:border-box;min-height:34vh;padding:10px;border-radius:10px;' +
      'border:1px solid var(--line,rgba(255,255,255,.22));background:var(--panel-bg2,rgba(0,0,0,.3));' +
      'color:var(--panel-text,var(--text,#f2e8d8));' +
      '-webkit-text-fill-color:var(--panel-text,var(--text,#f2e8d8));' +
      'caret-color:var(--panel-text,var(--text,#f2e8d8));' +
      'font-size:.9rem;line-height:1.85;font-family:inherit}' +
      '#yzTextEdit .te-ops{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}' +
      '#yzTextEdit .te-ops button{padding:8px 14px;border-radius:9px;font-size:.84rem;border:1px solid var(--line,rgba(255,255,255,.24));' +
      'background:transparent;color:inherit}' +
      '#yzTextEdit .te-ops button.go{background:var(--accent,#c9a227);border-color:transparent;color:#1b1412;font-weight:600}' +
      /* 常驻完成：✕ 在状态栏附近、键盘弹出后也可能够不着，底部再给一个出口 */
      '#yzTextEdit .te-foot{flex:0 0 auto;padding:10px 14px;border-top:1px solid var(--line,rgba(255,255,255,.16));' +
      'display:flex;justify-content:flex-end}' +
      '#yzTextEdit .te-foot button{padding:11px 22px;border-radius:10px;font-size:.9rem;border:none;min-height:44px;' +
      'background:var(--accent,#c9a227);color:#1b1412;font-weight:600}' +
      '</style>' +
      '<div class="te-bar"><b>✏️ 编辑正文 · ' + esc(title || '') + '</b>' +
        '<span style="font-size:.72rem;opacity:.6" id="teCnt">改动 ' + nMod + ' 处</span>' +
        '<button class="te-x" data-a="close">✕</button></div>' +
      '<div class="te-tip">点任意一段修改文字；清空内容即删除该段；带 ↺ 的是已改过的段，点它可以恢复原文。' +
        '改动只存本机，随导出我的数据一起备份。</div>' +
      '<div class="te-body">' + rows + '</div>' +
      '<div class="te-foot"><button data-a="close">完成</button></div>';

    document.body.appendChild(wrap);

    function close() { try { wrap.remove(); } catch (e) {} }
    function reRender() {
      close();
      open(key, title, items);
    }
    function updateCnt() {
      var el = document.getElementById('teCnt');
      if (el) el.textContent = '改动 ' + Object.keys(patchOf(key)).length + ' 处';
    }

    function editOne(i) {
      var it = items[i];
      if (!it) return;
      var pv = patchOf(key);
      var has = Object.prototype.hasOwnProperty.call(pv, String(i));
      var orig = it.t;
      var val = has ? pv[String(i)] : orig;

      var m = document.createElement('div');
      m.className = 'te-edit';
      m.innerHTML = '<div class="te-card">' +
        '<b style="font-size:.9rem">第 ' + (i + 1) + ' 段' + (it.k === 'h' ? '（标题）' : '') + '</b>' +
        '<p style="font-size:.72rem;opacity:.6;margin:6px 0 8px">清空后保存＝删除这一段。</p>' +
        '<textarea id="teTa">' + esc(val) + '</textarea>' +
        '<div class="te-ops">' +
          (has ? '<button data-a="restore">恢复原文</button>' : '') +
          '<button data-a="cancel">取消</button>' +
          '<button class="go" data-a="save">保存</button>' +
        '</div></div>';
      wrap.appendChild(m);
      var ta = m.querySelector('#teTa');
      try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
      m.addEventListener('click', function (ev) {
        var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
        if (!a) { if (ev.target === m) m.remove(); return; }
        if (a === 'cancel') return m.remove();
        if (a === 'restore') {
          setPatch(key, i, null); m.remove(); reRender(); return;
        }
        if (a === 'save') {
          var v = ta.value;
          if (v === orig) setPatch(key, i, null);   /* 改回原样＝不留改动 */
          else setPatch(key, i, v);
          if (window.YZChanges && v !== orig) {
            window.YZChanges.add({
              act: 'text', kind: 'text', ref: key + '|' + i,
              name: (title || '正文') + ' · 第 ' + (i + 1) + ' 段',
              fields: [{ k: '正文', k2: 'text', from: orig, to: v }]
            });
          }
          m.remove();
          reRender();
          try { if (window.YZAppBooks && window.YZAppBooks.reload) window.YZAppBooks.reload(); } catch (e) {}
          return;
        }
      });
    }

    wrap.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
      if (a === 'close') return close();
      var row = ev.target.closest ? ev.target.closest('.te-row') : null;
      if (row) {
        var i = +row.getAttribute('data-i');
        editOne(i);
      }
    });
  }

  /* 系统返回键：先关单段编辑卡片，再关整层；都没打开则返回 false，
     让 app.js 的 __appBack 继续往下一层（阅读器 / 页面栈）走。
     不接这一层的话，返回键会去关背后的阅读器，本层留在最上面永远退不出去。 */
  function onBack() {
    var w = document.getElementById('yzTextEdit');
    if (!w) return false;
    var m = w.querySelector('.te-edit');
    if (m) { try { m.remove(); } catch (e) {} return true; }
    try { w.remove(); } catch (e) {}
    return true;
  }

  window.YZTextEdit = {
    open: open,
    onBack: onBack,
    get: window.YZTextPatchGet,
    count: function (key) { return Object.keys(patchOf(key)).length; },
    clear: function (key) { var o = all(); delete o[key]; save(o); },
    all: function () { return all(); }
  };
})();
