/* 学通 · 相册（YZPhoto）
   定位：给「图片」一个正确的归宿。
   以前图片被当成书导入书架 → 读不了、还卡。现在导入时按类型自动分派，
   图片进这里；书架里不再出现读不了的东西。

   边界（重要）：**只放 App 自己导入的照片，不扫系统相册**。
   扫系统相册需要 READ_MEDIA_IMAGES 权限，而这个 App 的根基是零权限、无网络，
   为了一个相册把权限打开不划算，也不符合用户对这个软件的预期。
   照片存在 App 私有目录（files/photos），由原生侧通过 _photo/ 同源地址提供。
*/
(function () {
  'use strict';
  if (window.YZPhoto) return;

  function app() { try { return window.AndroidApp || null; } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function sizeTxt(n) {
    n = Number(n) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  }
  function toast(m) {
    try { if (typeof window.toast === 'function') return window.toast(m); } catch (e) { }
    try { console.log('[photo]', m); } catch (e) { }
  }

  var list = [], idx = 0, root = null, zoom = null, ready = false;

  function ensureCSS() {
    if (document.getElementById('yzPhotoCSS')) return;
    var st = document.createElement('style');
    st.id = 'yzPhotoCSS';
    st.textContent = [
      '#yzphoto{position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100%;z-index:135;',
      '  display:none;flex-direction:column;background:#141414;color:#eee;',
      '  font-family:inherit;-webkit-tap-highlight-color:transparent}',
      '#yzphoto.open{display:flex}',
      '#yzphoto .ph-top{flex:0 0 auto;display:flex;align-items:center;gap:.4rem;padding:calc(.5rem + env(safe-area-inset-top)) .6rem .5rem;',
      '  background:#1d1d1d;border-bottom:1px solid rgba(255,255,255,.12)}',
      '#yzphoto .ph-title{flex:1 1 auto;font-weight:600;font-size:1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#yzphoto .ph-btn{flex:0 0 auto;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#eee;',
      '  border-radius:.5rem;padding:.34rem .62rem;font-size:.86rem;cursor:pointer}',
      '#yzphoto .ph-btn:active{background:rgba(255,255,255,.2)}',
      '#yzphoto .ph-body{flex:1 1 0;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:.6rem}',
      '#yzphoto .ph-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem}',
      '#yzphoto .ph-cell{position:relative;aspect-ratio:1/1;border-radius:.5rem;overflow:hidden;background:#242424;cursor:pointer}',
      '#yzphoto .ph-cell img{width:100%;height:100%;object-fit:cover;display:block}',
      '#yzphoto .ph-cell .ph-nm{position:absolute;left:0;right:0;bottom:0;padding:.18rem .3rem;font-size:.66rem;',
      '  color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.72));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#yzphoto .ph-empty{padding:2.4rem 1rem;text-align:center;opacity:.78;line-height:1.75;font-size:.92rem}',
      '#yzphoto .ph-empty b{color:#f0c14b}',
      /* 全屏查看层 */
      '#yzphoto .ph-view{position:absolute;left:0;top:0;right:0;bottom:0;display:none;flex-direction:column;background:#000}',
      '#yzphoto .ph-view.on{display:flex}',
      '#yzphoto .ph-stage{flex:1 1 0;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '#yzphoto .ph-stage img{max-width:100%;max-height:100%;display:block;will-change:transform}',
      '#yzphoto .ph-bar{flex:0 0 auto;display:flex;align-items:center;gap:.5rem;padding:.5rem .6rem calc(.5rem + env(safe-area-inset-bottom));',
      '  background:rgba(20,20,20,.92);border-top:1px solid rgba(255,255,255,.12)}',
      '#yzphoto .ph-bar .ph-info{flex:1 1 auto;font-size:.82rem;opacity:.82;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#yzphoto .ph-hint{position:absolute;left:50%;bottom:4.2rem;transform:translateX(-50%);font-size:.76rem;color:#ddd;',
      '  background:rgba(0,0,0,.6);padding:.28rem .6rem;border-radius:1rem;pointer-events:none;opacity:0;transition:opacity .25s}',
      '#yzphoto .ph-hint.on{opacity:1}'
    ].join('');
    document.head.appendChild(st);
  }

  function ensureDOM() {
    if (root) return root;
    ensureCSS();
    var d = document.createElement('div');
    d.id = 'yzphoto';
    d.innerHTML = '<div class="ph-top">'
      + '<button class="ph-btn" type="button" data-act="close">×</button>'
      + '<span class="ph-title" id="phTitle">相册</span>'
      + '<button class="ph-btn" type="button" data-act="pick">＋ 导入照片</button>'
      + '</div>'
      + '<div class="ph-body" id="phBody"></div>'
      + '<div class="ph-view" id="phView">'
      + '  <div class="ph-top"><button class="ph-btn" type="button" data-act="back">‹ 返回</button>'
      + '    <span class="ph-title" id="phVTitle"></span>'
      + '    <button class="ph-btn" type="button" data-act="close">×</button></div>'
      + '  <div class="ph-stage" id="phStage"><img id="phImg" alt=""></div>'
      + '  <div class="ph-hint" id="phHint">双指缩放 · 左右滑动切换</div>'
      + '  <div class="ph-bar"><span class="ph-info" id="phInfo"></span>'
      + '    <button class="ph-btn" type="button" data-act="export">导出</button>'
      + '    <button class="ph-btn" type="button" data-act="del">删除</button></div>'
      + '</div>';
    document.body.appendChild(d);
    root = d;

    d.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-act]') : null;
      var cell = ev.target.closest ? ev.target.closest('.ph-cell') : null;
      if (cell) { var i = parseInt(cell.getAttribute('data-i'), 10); if (!isNaN(i)) view(i); return; }
      if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'close') closeAll();
      else if (a === 'back') backToGrid();
      else if (a === 'pick') pickPhoto();
      else if (a === 'del') askDel();
      else if (a === 'export') doExport();
    });
    return root;
  }

  function read() {
    var A = app();
    var out = [];
    if (A && A.photoList) { try { out = JSON.parse(A.photoList() || '[]') || []; } catch (e) { out = []; } }
    return out;
  }
  function srcOf(p) {
    /* 用当前页面的 origin：App 内是 appassets.androidplatform.net，本地测试是 127.0.0.1 —— 写死域名会在测试里 404 */
    var base = location.protocol + '//' + location.host;
    return base + '/_photo/' + encodeURIComponent(p.id + (p.ext || '.jpg')) + '?v=' + (p.at || 0);
  }

  function renderGrid() {
    var body = document.getElementById('phBody');
    if (!body) return;
    document.getElementById('phTitle').textContent = '相册' + (list.length ? ' · ' + list.length : '');
    if (!list.length) {
      body.innerHTML = '<div class="ph-empty">相册是空的。<br>'
        + '点右上角「＋ 导入照片」选几张图，也可以从书架用「＋ 导入文件」把照片和书一起选进来。<br><br>'
        + '<b>照片只存这台手机里</b>，不联网、不上传；App 也不会去读你系统相册里的其它图片。</div>';
      return;
    }
    body.innerHTML = '<div class="ph-grid">' + list.map(function (p, i) {
      return '<div class="ph-cell" data-i="' + i + '">'
        + '<img src="' + esc(srcOf(p)) + '" alt="' + esc(p.name || '') + '" loading="lazy" decoding="async">'
        + '<div class="ph-nm">' + esc(String(p.name || '').replace(/\.[a-z0-9]+$/i, '')) + '</div></div>';
    }).join('') + '</div>';
  }

  function pickPhoto() {
    var A = app();
    if (!A || !A.bookPick) { toast('导入照片需要在 App 内使用'); return; }
    try { A.bookPick(); toast('选好照片后会自动进相册'); } catch (e) { toast('无法打开选择器'); }
    /* 导入完成后台由 __yzBookResult 触发刷新，这里不做轮询 */
  }

  function view(i) {
    if (!list.length) return;
    idx = Math.max(0, Math.min(list.length - 1, i));
    var p = list[idx];
    var v = document.getElementById('phView');
    var st = document.getElementById('phStage');
    var img = document.getElementById('phImg');
    v.classList.add('on');
    img.src = srcOf(p);
    img.alt = p.name || '';
    document.getElementById('phVTitle').textContent = String(p.name || '').replace(/\.[a-z0-9]+$/i, '');
    document.getElementById('phInfo').textContent = (idx + 1) + ' / ' + list.length + ' · ' + sizeTxt(p.size);
    if (zoom) { try { zoom.destroy(); } catch (e) { } zoom = null; }
    if (window.YZZoom) {
      zoom = window.YZZoom.attach(st, {
        max: 3,
        onSwipe: function (dir) {
          var n = idx + dir;
          if (n < 0 || n >= list.length) { toast(dir > 0 ? '已经是最后一张' : '已经是第一张'); return; }
          view(n);
        },
        onTap: function () { /* 点一下不做事，避免误触 */ }
      });
    }
    var hint = document.getElementById('phHint');
    if (hint) { hint.classList.add('on'); setTimeout(function () { hint.classList.remove('on'); }, 1800); }
  }

  function backToGrid() {
    var v = document.getElementById('phView');
    v.classList.remove('on');
    if (zoom) { try { zoom.destroy(); } catch (e) { } zoom = null; }
    renderGrid();
  }

  function askDel() {
    var p = list[idx];
    if (!p) return;
    var ok = true;
    try { ok = window.confirm('从相册删除这张照片？\n\n「' + (p.name || '') + '」\n\n只删除 App 里的副本，不影响你手机里原来的照片。'); } catch (e) { ok = true; }
    if (!ok) return;
    var A = app();
    try { if (A && A.photoRemove) A.photoRemove(p.id); } catch (e) { }
    list = read();
    if (list.length) { view(Math.min(idx, list.length - 1)); } else { backToGrid(); renderGrid(); }
  }

  function doExport() {
    var p = list[idx];
    if (!p) return;
    var A = app();
    if (!A || !A.photoExport) { toast('导出需要在 App 内使用'); return; }
    try { A.photoExport(p.id); toast('正在导出到「下载」…'); } catch (e) { toast('导出失败'); }
  }

  function show() {
    ensureDOM();
    list = read();                 /* 每次打开都重新读，别指望模块变量自己更新 */
    root.classList.add('open');
    document.body.classList.add('yzphoto-open');
    renderGrid();
  }
  function closeAll() {
    if (root) {
      root.classList.remove('open');
      var v = document.getElementById('phView');
      if (v) v.classList.remove('on');
    }
    document.body.classList.remove('yzphoto-open');
    if (zoom) { try { zoom.destroy(); } catch (e) { } zoom = null; }
  }

  function open() { show(); }
  /* 从「我的资料 → 相册」点某一张进来：直接进全屏那一张 */
  function openAt(id) {
    list = read();
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].id === id) { i = k; break; }
    if (i < 0) { toast('这张照片已经不在了'); return; }
    ensureDOM();
    root.classList.add('open');
    document.body.classList.add('yzphoto-open');
    renderGrid();
    view(i);
  }
  function refresh() { if (root && root.classList.contains('open')) { list = read(); renderGrid(); } }
  function count() { return read().length; }

  window.YZPhoto = { open: open, openAt: openAt, close: closeAll, refresh: refresh, count: count, view: view };
})();
