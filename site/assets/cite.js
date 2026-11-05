/* =====================================================================
   学通 · 共享小工具（文件保存）
   - YZSave.text(name,mime,text) / YZSave.base64(name,mime,b64) / YZSave.url(name,dataURL)
       App 内优先走 AndroidApp.saveBase64（保存到系统「下载」）；
       网页端回退为 Blob + <a download>。两处都不依赖网络。
   ===================================================================== */
(function () {
  'use strict';

  function isApp() { try { return !!(window.AndroidApp && window.AndroidApp.saveBase64); } catch (e) { return false; } }
  function b64utf8(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ''; } }

  function saveBase64(name, mime, b64) {
    mime = mime || 'application/octet-stream';
    try { if (isApp()) { window.AndroidApp.saveBase64(name, b64, mime); return true; } } catch (e) {}
    try {
      var bin = atob(b64), n = bin.length, arr = new Uint8Array(n);
      for (var i = 0; i < n; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: mime }));
      var a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1500);
      return true;
    } catch (e) { return false; }
  }
  function saveText(name, mime, text) { var b = b64utf8(text); return b ? saveBase64(name, mime, b) : false; }
  function saveURL(name, dataURL) {
    try {
      var s = String(dataURL), i = s.indexOf(',');
      if (i < 0) return false;
      var mime = (s.slice(0, i).match(/^data:([^;]+)/) || [0, 'application/octet-stream'])[1];
      return saveBase64(name, mime, s.slice(i + 1));
    } catch (e) { return false; }
  }

  function openBase64(name, mime, b64) {
    try { if (isApp() && window.AndroidApp.openFile) { window.AndroidApp.openFile(name, b64, mime); return true; } } catch (e) {}
    return saveBase64(name, mime, b64);
  }
  function openURL(name, dataURL) {
    try {
      var s = String(dataURL), i = s.indexOf(','); if (i < 0) return false;
      var mime = (s.slice(0, i).match(/^data:([^;]+)/) || [0, 'application/octet-stream'])[1];
      return openBase64(name, mime, s.slice(i + 1));
    } catch (e) { return false; }
  }
  function tip(name) {
    if (isApp()) {
      var d = '';
      try { d = (window.AndroidApp && AndroidApp.exportDirLabel) ? String(AndroidApp.exportDirLabel() || '') : ''; } catch (e) {}
      return (d ? ('已保存到「' + d + '」：') : '已保存到系统「下载」：') + name;
    }
    return '已下载：' + name;
  }
  /* dataURL → 文本（用于文本类导出的内容预览） */
  function dataURLToText(s) {
    try {
      s = String(s == null ? '' : s);
      var i = s.indexOf(','); if (i < 0) return s;
      var head = s.slice(0, i), body = s.slice(i + 1);
      if (/;base64/i.test(head)) return decodeURIComponent(escape(atob(body)));
      return decodeURIComponent(body);
    } catch (e) { return ''; }
  }
  /* 导出结果预览浮层：图片显示图，文本/数据直接显示内容（点背景或 Esc 关闭） */
  /* 复制到剪贴板（0.18.27）：App 内 navigator.clipboard 常常不可用，
     回退到 textarea + execCommand；都不行就返回 false，让调用方提示长按选中。 */
  function copyText(t) {
    var txt = String(t == null ? '' : t);
    if (!txt) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); return true; }
    } catch (e) { }
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, txt.length); } catch (e) { }
      var ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); } catch (e) { }
      ta.remove();
      return !!ok;
    } catch (e) { return false; }
  }

  function preview(name, body, note) {
    try {
      var ov = document.getElementById('yzExportOv');
      if (!ov) {
        ov = document.createElement('div'); ov.id = 'yzExportOv';
        ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '导出结果');
        ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:18px;box-sizing:border-box';
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var o = document.getElementById('yzExportOv'); if (o) o.remove(); } });
        document.body.appendChild(ov);
      }
      ov.innerHTML = '';
      var bodyStr = (body == null ? '' : String(body));
      var node;
      if (/^data:image\//i.test(bodyStr)) {
        node = document.createElement('img'); node.src = bodyStr; node.alt = name || '导出结果';
        node.style.cssText = 'max-width:92vw;max-height:68vh;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.6);background:#fff';
      } else {
        var txt = /^data:/i.test(bodyStr) ? dataURLToText(bodyStr) : bodyStr;
        node = document.createElement('pre');
        node.textContent = txt.length > 4000 ? (txt.slice(0, 4000) + '\n\n…（内容较长，仅显示前 4000 字符；完整内容见已保存的文件）') : txt;
        node.style.cssText = 'max-width:92vw;max-height:62vh;overflow:auto;margin:0;padding:12px;background:#0b0b0b;color:#d8d8d8;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;border-radius:10px;white-space:pre-wrap;word-break:break-all;text-align:left;box-shadow:0 10px 40px rgba(0,0,0,.6)';
        if (name) node.setAttribute('aria-label', name);
      }
      var p = document.createElement('p');
      p.textContent = note || ((isApp() ? '已保存到系统「下载」：' : '已下载：') + name);
      p.style.cssText = 'color:#fff;font-size:.85rem;margin:0;text-align:center;line-height:1.6;max-width:92vw;word-break:break-all';
      /* 完整文本（pre 里只显示前 4000 字） */
      var full = /^data:/i.test(bodyStr) ? dataURLToText(bodyStr) : bodyStr;
      var bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;max-width:92vw';
      var btnStyle = 'padding:9px 20px;border-radius:22px;border:0;font-size:.88rem;font-weight:600;cursor:pointer;';
      /* ★ 文件通道为主（0.18.28 用户要求）：导出必须能给到别的应用，
         有些手机剪贴板放不下超长文本，大文件更不可能靠复制。 */
      var isData = /^data:/i.test(bodyStr);
      var hasApp = !!(window.AndroidApp && window.AndroidApp.openFile);
      if (hasApp && isData) {
        var bOpen = document.createElement('button'); bOpen.type = 'button';
        bOpen.textContent = '📤 用其他应用打开';
        bOpen.style.cssText = btnStyle + 'background:#f5d76e;color:#1a1613';
        bOpen.onclick = function () { try { YZSave.openURL(name || 'export.txt', bodyStr); } catch (e) { } ov.remove(); };
        var bShare = document.createElement('button'); bShare.type = 'button';
        bShare.textContent = '分享到…';
        bShare.style.cssText = btnStyle + 'background:#fff;color:#111';
        bShare.onclick = function () {
          try {
            var m = bodyStr.match(/^data:([^;]+);base64,([\s\S]*)$/);
            if (m) YZSave.shareB64(name || 'export.txt', m[1], m[2]);
            else YZSave.share(name || 'export.txt', 'text/plain;charset=utf-8', full);
          } catch (e) { }
        };
        bar.appendChild(bOpen); bar.appendChild(bShare);
      }
      /* 复制降为辅助（剪贴板放不下的东西它救不了） */
      var copyBtn = document.createElement('button'); copyBtn.type = 'button';
      copyBtn.textContent = '复制文字';
      copyBtn.style.cssText = 'padding:7px 16px;border-radius:22px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;font-size:.8rem;cursor:pointer';
      copyBtn.onclick = function () {
        var ok = copyText(full);
        copyBtn.textContent = ok ? '✓ 已复制' : '复制失败，长按选中';
        if (!ok) { try { var pre = ov.querySelector('pre'); if (pre) { var r = document.createRange(); r.selectNodeContents(pre); var sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(r); } } catch (e) { } }
      };
      var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '关闭';
      btn.style.cssText = 'padding:9px 26px;border-radius:22px;border:0;background:#fff;color:#111;font-size:.9rem;cursor:pointer';
      btn.onclick = function () { ov.remove(); };
      bar.appendChild(btn);
      ov.appendChild(node); ov.appendChild(p); ov.appendChild(bar); ov.appendChild(copyBtn);
    } catch (e) {}
  }

  /* App 保存完成后由原生回调进来（window.__yzSaveResult({ok,msg,uri,mime,name,bytes})） */
  window.__yzSaveResult = function (r) {
    try { if (typeof window.yzOnSaveResult === 'function') window.yzOnSaveResult(r || {}); } catch (e) {}
  };
  /* 导出即分享（0.18.24）：App 内直接把文件交给系统分享面板（微信/QQ/网盘/邮件），
     不再往系统「下载」目录丢——手机上那个目录用户根本找不到。
     浏览器没有分享面板，就还回下载。返回 'share' / 'save' / false，调用方据此出提示。 */
  function shareBase64(name, mime, b64) {
    mime = mime || 'application/octet-stream';
    try {
      if (window.AndroidApp && window.AndroidApp.shareFile) {
        window.AndroidApp.shareFile(name, b64, mime);
        return 'share';
      }
    } catch (e) {}
    return saveBase64(name, mime, b64) ? 'save' : false;
  }
  function shareText(name, mime, text) {
    var b = b64utf8(text);
    return b ? shareBase64(name, mime, b) : false;
  }

  window.YZSave = { base64: saveBase64, text: saveText, url: saveURL, openURL: openURL, tip: tip, preview: preview, b64: b64utf8, isApp: isApp, copy: copyText,
    share: shareText, shareB64: shareBase64 };
})();
