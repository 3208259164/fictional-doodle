/* =====================================================================
   学通 · 网络扫盲页（词条检索）
   ---------------------------------------------------------------------
   入口：主页右上角「＋」→ 网络扫盲。
   形态：分组 + 搜索 + 点击展开。刻意不做成"书"——每条只有三句话，
   翻页比点击慢。数据在 data/netbasics.js（离线，无外链）。
   ===================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function groups(q) {
    var list = window.NET_BASICS || [];
    var kq = String(q || '').trim().toLowerCase();
    var out = [], map = {};
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (kq) {
        var hay = (x.n + ' ' + x.e + ' ' + x.d + ' ' + x.l + ' ' + x.m + ' ' + x.g).toLowerCase();
        if (hay.indexOf(kq) < 0) continue;
      }
      if (!map[x.g]) { map[x.g] = { g: x.g, items: [] }; out.push(map[x.g]); }
      map[x.g].items.push(x);
    }
    return out;
  }

  function cardHTML(x) {
    return '<button class="netc" type="button" onclick="netToggle(this)" aria-expanded="false">' +
      '<span class="netc-h"><b>' + esc(x.n) + '</b>' +
      (x.e ? '<i>' + esc(x.e) + '</i>' : '') +
      '<span class="netc-x">›</span></span>' +
      '<span class="netc-b">' +
      (x.t ? '<span class="netc-t"><b>原理</b>' + esc(x.t) + '</span>' : '') +
      '<span class="netc-d"><b>一句话</b>' + esc(x.d) + '</span>' +
      '<span class="netc-l"><b>像什么</b>' + esc(x.l) + '</span>' +
      '<span class="netc-m"><b>常见误解</b>' + esc(x.m) + '</span>' +
      '</span></button>';
  }

  function listHTML(q) {
    var gs = groups(q), n = 0;
    if (!gs.length) return '<p class="netempty">没有匹配的词条。换个说法试试，比如「DNS」「后缀」「证书」。</p>';
    var html = '';
    for (var i = 0; i < gs.length; i++) {
      html += '<div class="netg-t">' + esc(gs[i].g) + '<span class="netg-n">' + gs[i].items.length + '</span></div>';
      for (var j = 0; j < gs[i].items.length; j++) { html += cardHTML(gs[i].items[j]); n++; }
    }
    return html;
  }

  function pageHTML() {
    var total = (window.NET_BASICS || []).length;
    return '<div class="netwrap">' +
      '<p class="netlead">先把名词弄明白，再谈判断。共 ' + total + ' 条，点开看释义、比喻和常见误解。</p>' +
      '<div class="netsearch"><input id="netQ" type="search" placeholder="查词条：DNS / 证书 / 后缀 / 钓鱼…" ' +
      'aria-label="搜索网络名词" oninput="netFilter(this.value)"></div>' +
      '<div class="netops"><button type="button" class="netall" onclick="netAll(true)">全部展开</button>' +
      '<button type="button" class="netall" onclick="netAll(false)">全部收起</button></div>' +
      '<div id="netList">' + listHTML('') + '</div>' +
      '</div>';
  }

  window.openNetBasics = function () {
    if (typeof openContent !== 'function') return;
    /* 词条数据是延迟加载的：万一用户点得极快，先催一次并说明，而不是给出空列表 */
    if (!(window.NET_BASICS || []).length) {
      try { if (window.YZData && YZData.kick) YZData.kick(); } catch (e) { }
      try { toast('词条正在载入，稍等一下再点一次'); } catch (e) { }
      return;
    }
    try { if (typeof closePlus === 'function') closePlus(); } catch (e) { }
    /* 不用 root 模式：root 顶栏是「头像 + ＋」不带标题，词条页会看起来没有页名 */
    openContent('🌐 网络扫盲', pageHTML(), {});
  };
  window.netFilter = function (v) {
    var box = document.getElementById('netList');
    if (box) box.innerHTML = listHTML(v);
  };
  window.netAll = function (on) {
    var cs = document.querySelectorAll('#netList .netc');
    for (var i = 0; i < cs.length; i++) {
      if (on) cs[i].classList.add('on'); else cs[i].classList.remove('on');
      cs[i].setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  };
  window.netToggle = function (el) {
    if (!el) return;
    var on = el.classList.toggle('on');
    el.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
})();
