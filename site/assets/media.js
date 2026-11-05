/* =====================================================================
   学通 · 音视频库（media.js，0.18.26）
   ---------------------------------------------------------------------
   为什么有它：
     书库「歌曲 31 条 / 影像 35 条」原来只有 1 条真能播（国际歌），其余全是 #。
     不能导入自己的音频视频，也没有分享。

   这一版的做法（与 Android 官方推荐一致）：
     ① 选文件：SAF（ACTION_OPEN_DOCUMENT，audio/* video/*，可多选）
     ② 立刻复制进应用私有目录 —— content:// 的读权限不持久，
        直接引用会出现「今天能放、过几天打不开」
     ③ 播放：App 内 <audio>/<video>，地址走同源 https 的 _media/ 路由
     ④ 分享 / 删除：分享经 ExportProvider 转 content:// 交给系统分享面板

   对外：YZMedia.openLib / pick / play / share / remove / refresh
   ===================================================================== */
(function () {
  'use strict';

  function A() { try { return window.AndroidApp || null; } catch (e) { return null; } }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) { } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  var cache = [];
  var busy = false;

  function list() {
    var a = A();
    if (!a || typeof a.mediaList !== 'function') return [];
    var out = [];
    try {
      var raw = a.mediaList() || '[]';
      var arr = JSON.parse(raw);
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].name) out.push(arr[i]);
      }
    } catch (e) { }
    return out;
  }

  function rowHTML(it) {
    var icon = it.type === 'video' ? '🎬' : '🎵';
    return '<div class="lcard" style="align-items:center" onclick="YZMedia.play(\'' + esc(it.name).replace(/'/g, "\\'") + '\')">' +
      '<div style="font-size:1.4rem;line-height:1;margin-right:8px">' + icon + '</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div class="pname" style="word-break:break-all">' + esc(it.name) + '</div>' +
      '<div class="prole">' + (it.type === 'video' ? '视频' : '音频') + ' · ' + fmtSize(it.size) + '</div></div>' +
      '<button class="sbtn" onclick="event.stopPropagation();YZMedia.share(\'' + esc(it.name).replace(/'/g, "\\'") + '\')">分享</button>' +
      '<button class="sbtn" onclick="event.stopPropagation();YZMedia.remove(\'' + esc(it.name).replace(/'/g, "\\'") + '\')" style="opacity:.7">删除</button>' +
      '</div>';
  }

  function bodyHTML() {
    var a = A();
    if (!a || typeof a.mediaPick !== 'function') {
      return '<p class="sub" style="line-height:1.9">音视频导入要在 App 内使用（网页版没有本机文件访问权限）。<br>' +
        '书库里的歌曲 / 影像条目仍然可以照常查看。</p>';
    }
    var items = list();
    var btn = '<div style="display:flex;gap:8px;margin:0 0 10px">' +
      '<button class="sbtn" onclick="YZMedia.pick()">＋ 导入音频 / 视频</button></div>';
    if (!items.length) {
      return btn + '<p class="sub" style="line-height:1.9">还没有导入任何音视频。<br>' +
        '点上面的按钮选文件（可以一次选多个，音频视频一起选也行）。<br>' +
        '导入后会复制一份到应用内部，删掉原文件也不影响播放；随时可以分享或删除。</p>';
    }
    var audio = items.filter(function (x) { return x.type !== 'video'; });
    var video = items.filter(function (x) { return x.type === 'video'; });
    var h = btn;
    h += '<p class="sub" style="margin:0 0 8px">共 ' + items.length + ' 个（音频 ' + audio.length + ' · 视频 ' + video.length + '）。点一下播放，右侧可分享或删除。</p>';
    if (audio.length) h += '<h2 class="sub-title" style="margin-top:6px">🎵 音频（' + audio.length + '）</h2>' + audio.map(rowHTML).join('');
    if (video.length) h += '<h2 class="sub-title" style="margin-top:14px">🎬 视频（' + video.length + '）</h2>' + video.map(rowHTML).join('');
    return h;
  }

  function openLib() {
    if (!window.openContent) { toast('页面还没准备好'); return; }
    openContent('🎵 音视频', bodyHTML(), { title: '🎵 音视频' });
  }

  function pick() {
    var a = A();
    if (!a || typeof a.mediaPick !== 'function') { toast('要在 App 内使用'); return; }
    if (busy) { toast('正在导入，请稍候'); return; }
    busy = true;
    try { a.mediaPick(); } catch (e) { busy = false; toast('打不开文件选择器'); }
    setTimeout(function () { busy = false; }, 5000);
  }

  /* Java 侧导入完成后会调这个 */
  function refresh() {
    busy = false;
    var cur = window.yzCur ? window.yzCur() : null;
    /* 只在「音视频」页时重绘，别打断用户正在看的别的页面 */
    try {
      var t = document.querySelector('#contentView .sub-title, #contentView .pname');
      if (t && window.openContent) {
        var cv = document.getElementById('contentView');
        if (cv && cv.innerHTML.indexOf('导入音频 / 视频') >= 0) openLib();
      }
    } catch (e) { }
  }

  function play(name) {
    var a = A();
    var items = list();
    var it = null;
    for (var i = 0; i < items.length; i++) if (items[i].name === name) { it = items[i]; break; }
    if (!it) { toast('文件不在了'); return; }
    var src = it.url;
    var media = (it.type === 'video')
      ? '<video src="' + esc(src) + '" controls playsinline preload="metadata" style="width:100%;max-height:62vh;background:#000;border-radius:10px"></video>'
      : '<audio src="' + esc(src) + '" controls preload="metadata" style="width:100%"></audio>';
    var h = '<div style="padding:6px 0">' + media + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
      '<button class="sbtn" onclick="YZMedia.share(\'' + esc(name).replace(/'/g, "\\'") + '\')">📤 分享</button>' +
      '<button class="sbtn" onclick="YZMedia.remove(\'' + esc(name).replace(/'/g, "\\'") + '\')" style="opacity:.75">🗑 删除</button>' +
      '</div>' +
      '<p class="sub" style="margin-top:14px;line-height:1.8;font-size:.76rem;opacity:.65">' +
      fmtSize(it.size) + ' · 存在应用内部（不占相册、不需要存储权限）</p>';
    openContent('▶ ' + name, h, { title: name });
  }

  function share(name) {
    var a = A();
    if (!a || typeof a.mediaShare !== 'function') { toast('要在 App 内使用'); return; }
    try { a.mediaShare(name); } catch (e) { toast('分享失败'); }
  }

  function remove(name) {
    var a = A();
    if (!a || typeof a.mediaRemove !== 'function') { toast('要在 App 内使用'); return; }
    if (!window.confirm('删除「' + name + '」？\n只删 App 里这一份，手机原文件不受影响。')) return;
    try { a.mediaRemove(name); } catch (e) { }
    toast('已删除');
    openLib();
  }

  window.YZMedia = { openLib: openLib, pick: pick, play: play, share: share, remove: remove, refresh: refresh, list: list, bodyHTML: bodyHTML };
})();
