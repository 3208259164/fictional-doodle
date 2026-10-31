/* =====================================================================
   学通 · 学习层（study.js）
   ---------------------------------------------------------------------
   三层东西，一个文件：
     ① 答疑解惑（data/answers.js）—— 人工审定，带原文依据
     ② 术语卡  （data/glossary.js）—— 挂在概念详情页，也可单独检索
     ③ 原著导读（data/guides.js）—— 骨架由软件给，正文由用户填（只存本机）

   设计约束：
     · 不新增孤立页面：答疑挂在「史料」栏目里一页两签（答疑 / 术语）；
       术语卡挂在概念详情页；导读挂在书详情页。
     · 用户填的导读正文存 localStorage 'yzGuides'，结构与线上数据完全分离，
       升级换版本不会覆盖，导出/备份会带上（已加入 app.js 的 DATA_KEYS）。
     · 所有输出都做转义；用户输入按纯文本渲染（white-space:pre-line）。
   ===================================================================== */
(function () {
  'use strict';

  var KEY = 'yzGuides';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ans() { return (window.SITE_ANSWERS && window.SITE_ANSWERS.groups) || []; }
  function gls() { return window.SITE_GLOSSARY || []; }
  function gds() { return window.SITE_GUIDES || []; }

  /* ---------------- 本机导读正文 ---------------- */
  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function writeAll(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); return true; }
    catch (e) {
      try { if (window.toast) toast('本机存储已满，导读没保存上'); } catch (_) {}
      return false;
    }
  }
  function textOf(gid, i) {
    var a = readAll()[gid];
    return (a && a[i]) ? String(a[i]) : '';
  }
  function saveSection(gid, i, text) {
    var o = readAll();
    o[gid] = o[gid] || {};
    if (text && String(text).trim()) o[gid][i] = String(text);
    else delete o[gid][i];
    return writeAll(o);
  }
  function progress(g) {
    var done = 0;
    (g.sections || []).forEach(function (s, i) { if (textOf(g.id, i).trim()) done++; });
    return { done: done, total: (g.sections || []).length };
  }
  function guideByBook(title) {
    var L = gds();
    for (var i = 0; i < L.length; i++) if (L[i].book === title) return L[i];
    /* 书名不完全一致时退化匹配（如「共产主义运动中的"左派"幼稚病」引号不同） */
    var k = String(title || '').replace(/[《》「」“”"'\s]/g, '');
    for (var j = 0; j < L.length; j++) {
      if (String(L[j].book).replace(/[《》「」“”"'\s]/g, '') === k) return L[j];
    }
    return null;
  }

  /* ---------------- ① 答疑解惑 ---------------- */
  var _q = '';       /* 答疑页搜索词（本会话内） */
  function hitQ(item, q) {
    if (!q) return true;
    var hay = (item.q + item.a + (item.why || '') + (item.basis || []).join('') + (item.tags || []).join(''));
    return q.split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) >= 0; });
  }
  function answerCard(it) {
    return '<div class="lcard" style="align-items:flex-start;flex-direction:column;gap:6px;margin:8px 0;position:relative">' +
      (it.id ? '<button class="libedit" onclick="openAnswerEdit(\'' + esc(it.id) + '\')" aria-label="修改">✏️</button>' : '') +
      '<div class="pname" style="font-size:.92rem;line-height:1.6;padding-right:34px">Q · ' + esc(it.q) + '</div>' +
      '<div style="font-size:.85rem;line-height:1.95;opacity:.92">' + esc(it.a) + '</div>' +
      (it.why ? '<div style="font-size:.8rem;line-height:1.8;padding:8px 10px;background:rgba(245,197,24,.07);border-left:3px solid var(--accent);border-radius:0 8px 8px 0"><b style="opacity:.75">容易误以为：</b>' + esc(it.why) + '</div>' : '') +
      ((it.basis && it.basis.length) ? '<div style="font-size:.75rem;line-height:1.7;opacity:.62">依据：' + it.basis.map(function (b) { return esc(b); }).join(' ｜ ') + '</div>' : '') +
      '</div>';
  }
  function answersHTML() {
    var G = ans(), out = '';
    var total = 0; G.forEach(function (g) { total += g.items.length; });
    out += '<p class="sub" style="margin:0 0 10px;line-height:1.8">' +
      '共 <b>' + total + '</b> 条答疑、<b>' + gls().length + '</b> 张术语卡。' +
      '每条都尽量给出可查证的原文依据；查不到依据的会明说，不猜。' +
      '涉及历史评价与路线分歧的，只列说法与出处，不下结论。</p>' +
      '<div style="display:flex;gap:8px;margin:0 0 12px">' +
        '<button class="sbtn" style="flex:0 0 auto" onclick="openAnswerNew()">＋ 新增</button>' +
        '<button class="sbtn" style="flex:0 0 auto" onclick="YZStudy.ansImport()">📥 从文档导入</button>' +
        '<button class="sbtn" style="flex:0 0 auto" onclick="YZStudy.ansExport()">📤 导出</button>' +
        '<input id="yzAnsQ" placeholder="搜问题、术语、关键词…" value="' + esc(_q) + '" ' +
          'style="flex:1;min-width:0;padding:8px 12px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.85rem" ' +
          'oninput="YZStudy.setQuery(this.value)">' +
      '</div>';
    if (_q) {
      var hits = [];
      G.forEach(function (g) { g.items.forEach(function (it) { if (hitQ(it, _q)) hits.push({ g: g, it: it }); }); });
      gls().forEach(function (t) {
        var hay = t.term + (t.alias || []).join('') + t.dic + t.note;
        if (hay.indexOf(_q) >= 0) hits.push({ term: t });
      });
      out += '<div class="sub" style="margin:0 0 8px;opacity:.7">命中 ' + hits.length + ' 条' +
        (hits.length ? '' : '——换个词试试，或者用「问一问」') + '</div>';
      out += hits.map(function (h) {
        if (h.term) return '<div class="lcard" style="margin:8px 0;align-items:flex-start;flex-direction:column;gap:4px"><div class="pname">📗 ' + esc(h.term.term) + '</div><div style="font-size:.84rem;line-height:1.85;opacity:.9">' + esc(h.term.dic) + '</div></div>';
        return answerCard(h.it);
      }).join('');
      return out;
    }
    G.forEach(function (g) {
      out += '<h2 class="sub-title" style="margin-top:16px">' + esc(g.name) + '（' + g.items.length + '）</h2>' +
        (g.intro ? '<p class="sub" style="margin:0 0 6px;line-height:1.7;opacity:.7">' + esc(g.intro) + '</p>' : '') +
        g.items.map(answerCard).join('');
    });
    return out;
  }

  /* ---------------- ② 术语卡 ---------------- */
  function glossaryHTML() {
    var L = gls(), groups = {}, order = [];
    L.forEach(function (t) { var g = t.group || '其他'; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(t); });
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px">' +
        '<button class="lk-btn" style="font-size:.82rem" onclick="YZSELFTEST.open()">🎯 来 10 道自测</button>' +
        '<button class="sbtn" style="font-size:.78rem;padding:5px 10px" onclick="YZStudy.termNew()">＋ 新增术语</button>' +
        '<button class="sbtn" style="font-size:.78rem;padding:5px 10px" onclick="YZStudy.termImport()">📥 批量导入</button>' +
        '<span style="font-size:.76rem;opacity:.6;align-self:center">改动只存本机，可随备份导出</span></div>' +
      '<p class="sub" style="margin:0 0 10px;line-height:1.8">' + L.length +
      ' 张术语卡，按四层拆开：一句话定义、出处、容易混的地方、一句话辨析。概念详情页里也会直接显示对应的术语卡。</p>' +
      order.map(function (g) {
        return '<h2 class="sub-title" style="margin-top:16px">' + esc(g) + '（' + groups[g].length + '）</h2>' +
          groups[g].map(function (t) { return termCard(t); }).join('');
      }).join('');
  }
  function termCard(t) {
    return '<details class="fold" style="margin:8px 0">' +
      '<summary class="fold-t" style="cursor:pointer">📗 ' + esc(t.term) +
        (t.alias && t.alias.length ? '<span style="font-weight:400;opacity:.5;font-size:.76rem"> · ' + esc(t.alias.join(' / ')) + '</span>' : '') + '</summary>' +
      '<div style="padding:10px 12px">' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:2px">' +
          '<button class="aslink" style="font-size:.74rem" onclick="event.stopPropagation();YZStudy.termEdit(\'' + esc(t.id || '') + '\')">✏️ 改</button>' +
          (String(t.id || '').indexOf('gz') === 0 ? '<button class="aslink" style="font-size:.74rem;opacity:.75" onclick="event.stopPropagation();YZStudy.termRemove(\'' + esc(t.id || '') + '\')">🗑 删</button>' : '') +
        '</div>' +
        '<p style="margin:0 0 8px;font-size:.85rem;line-height:1.9">' + esc(t.dic) + '</p>' +
        '<p style="margin:0 0 8px;font-size:.76rem;line-height:1.7;opacity:.6">📖 出处：' + esc(t.from) + '</p>' +
        ((t.confuse || []).length ? (t.confuse.map(function (c) {
          return '<div style="margin:8px 0;padding:8px 10px;background:rgba(255,255,255,.05);border-radius:8px">' +
            '<b style="font-size:.8rem">容易混：' + esc(c.t) + '</b>' +
            '<div style="margin-top:4px;font-size:.81rem;line-height:1.85;opacity:.88">' + esc(c.d) + '</div></div>';
        }).join('')) : '') +
        (t.note ? '<p style="margin:8px 0 0;font-size:.8rem;line-height:1.8;color:var(--accent)">▸ ' + esc(t.note) + '</p>' : '') +
      '</div></details>';
  }
  /* 概念详情页用：只取「关联到该概念」的术语卡，直接铺开（不折叠） */
  function glossaryBlock(conceptId) {
    if (!conceptId) return '';
    var hit = gls().filter(function (t) { return t.concept === conceptId; });
    if (!hit.length) return '';
    return '<h2 class="sub-title" style="margin-top:16px">📗 术语卡</h2>' +
      hit.map(function (t) {
        return '<div style="margin:8px 0;padding:10px 12px;background:rgba(245,197,24,.05);border-left:3px solid var(--accent);border-radius:0 8px 8px 0">' +
          '<p style="margin:0 0 6px;font-size:.85rem;line-height:1.9">' + esc(t.dic) + '</p>' +
          '<p style="margin:0 0 6px;font-size:.74rem;opacity:.6">📖 ' + esc(t.from) + '</p>' +
          (t.note ? '<p style="margin:0;font-size:.79rem;line-height:1.8;color:var(--accent)">▸ ' + esc(t.note) + '</p>' : '') +
          '</div>';
      }).join('');
  }

  /* ---------------- ③ 原著导读 ---------------- */
  /* 章级论证骨架：按书的真实章节，给出「这一章回答什么问题、由哪几个论点构成、
     最容易在哪里读偏」。这是原书的论证结构，不是读后感，也不替代原文。 */
  /* 取某本书的章级骨架数据（不是 HTML）——目录要把每章的「在论证什么」并进章节里，
     避免出现「章级骨架」和「目录」两个区块讲同一件事（用户明确指出这处重复）。 */
  function outlineOf(bookTitle) {
    var g = guideByBook(bookTitle);
    return (g && g.outline) ? g.outline : [];
  }

  function outlineBlock(bookTitle) {
    var g = guideByBook(bookTitle);
    if (!g || !g.outline || !g.outline.length) return '';
    var body = g.outline.map(function (ch, i) {
      return '<div class="ol-ch">'
        + '<div class="ol-h">' + esc(ch.h) + '</div>'
        + (ch.q ? '<div class="ol-q">要回答：' + esc(ch.q) + '</div>' : '')
        + ((ch.points && ch.points.length)
          ? '<ol class="ol-p">' + ch.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ol>'
          : '')
        + (ch.mis ? '<div class="ol-mis">⚠ 常见误读：' + esc(ch.mis) + '</div>' : '')
        + '</div>';
    }).join('');
    return '<details class="yzOl">'
      + '<summary>📖 章级骨架 <span class="ol-hint">' + g.outline.length + ' 章 · 每章在论证什么</span></summary>'
      + '<div class="ol-body">' + body + '</div>'
      + '<div class="ol-src">结构依据：' + esc(g.book) + ' 原书章节；论点为该章实际论证步骤的概括，不代替原文。</div>'
      + '</details>';
  }

  function guideBlock(bookTitle) {
    var g = guideByBook(bookTitle);
    if (!g) return '';
    var p = progress(g);
    var started = p.done > 0;
    return '<h2 class="sub-title" style="margin-top:18px">📎 逐节研读（' + p.total + ' 节）</h2>' +
      '<p class="sub" style="margin:0 0 8px;line-height:1.8">' +
        '每节都带着写作背景、原文脉络和几个具体问题，打开就能读。' +
        (started ? '你已在 ' + p.done + ' 节记过想法。' : '想到什么也可以在节末记一句（只存本机）。') + '</p>' +
      '<button class="lk-btn" onclick="YZStudy.openGuide(\'' + esc(g.id) + '\')">📎 打开逐节研读 →</button>' +
      '<div style="margin-top:8px;font-size:.78rem;line-height:1.8;opacity:.65">这一本要解决的问题：' + esc(g.ask) + '</div>';
  }

  function openGuide(id) {
    var g = null;
    gds().forEach(function (x) { if (x.id === id) g = x; });
    if (!g) return;
    var p = progress(g);
    var body = '<div style="font-size:.8rem;line-height:1.8;opacity:.7;margin-bottom:10px">' +
        esc(g.author) + ' · ' + esc(g.year) + ' · ' + esc(g.level) + ' · 原文约 ' + g.minutes + ' 分钟' +
        '　｜　已填 <b id="yzGProg">' + p.done + '/' + p.total + '</b> 节</div>' +
      '<div style="font-size:.86rem;line-height:1.9;margin-bottom:14px;padding:10px 12px;background:rgba(245,197,24,.07);border-left:3px solid var(--accent);border-radius:0 8px 8px 0">' +
        '<b>这一本要解决的问题：</b>' + esc(g.ask) + '</div>' +
      '<div id="yzGList">' + g.sections.map(function (s, i) { return sectionHTML(g, s, i); }).join('') + '</div>' +
      ((g.refs && g.refs.length) ? '<p class="sub" style="margin-top:14px;line-height:1.9">同读：' + g.refs.map(esc).join(' ｜ ') + '</p>' : '');
    if (typeof window.openContent === 'function') {
      window.openContent('📖 ' + g.book + ' · 导读', body);
    }
  }
  function sectionHTML(g, s, i) {
    var t = textOf(g.id, i);
    var has = !!t.trim();
    var bg = (s.bg && String(s.bg).trim()) ? String(s.bg).trim() : '';
    /* 背景材料：客观事实与脉络（谁在什么背景下写、这一节讲什么、原文怎么走）。
       写作提示：把「该说什么」拆成具体问题。正文 t 仍由读者自己填，软件不代下结论。 */
    var bgHTML = bg
      ? '<details class="yzGBg" open style="margin:2px 0 4px">' +
          '<summary style="cursor:pointer;font-size:.79rem;color:var(--accent);opacity:.9;padding:2px 0;list-style:none">📎 背景材料<span style="opacity:.5;font-weight:400">（点此收起）</span></summary>' +
          '<div style="font-size:.84rem;line-height:2;white-space:pre-line;margin-top:4px;padding:10px 12px;background:rgba(255,255,255,.035);border-left:3px solid rgba(255,255,255,.18);border-radius:0 8px 8px 0">' + esc(bg) + '</div>' +
        '</details>'
      : '';
    return '<div class="lcard" style="align-items:flex-start;flex-direction:column;gap:8px;margin:10px 0">' +
      '<div class="pname" style="font-size:.9rem">' + esc(s.h) + (has ? '<span style="font-size:.72rem;opacity:.55;font-weight:400"> · 已填</span>' : '') + '</div>' +
      bgHTML +
      '<div style="font-size:.79rem;line-height:1.8;opacity:.62">✍️ 待你想清楚：' + esc(s.hint) + '</div>' +
      (has
        ? '<div style="font-size:.85rem;line-height:1.95;white-space:pre-line">' + esc(t) + '</div>'
        : '<div style="font-size:.8rem;opacity:.45">（这一节你还没写）</div>') +
      '<div style="display:flex;gap:8px"><button class="aslink" style="font-size:.78rem" onclick="YZStudy.editSection(\'' + g.id + '\',' + i + ')">' +
        (has ? '✏️ 修改' : '＋ 写下你的答案') + '</button></div>' +
      '</div>';
  }
  function editSection(gid, i) {
    var g = null; gds().forEach(function (x) { if (x.id === gid) g = x; });
    if (!g || !g.sections[i]) return;
    var s = g.sections[i], cur = textOf(gid, i);
    var html = '<p style="margin:0 0 8px;font-size:.82rem;line-height:1.8;opacity:.72"><b style="color:var(--accent)">写作提示：</b>' + esc(s.hint) + '</p>' +
      '<textarea id="yzGTa" style="width:100%;min-height:34vh;padding:10px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.86rem;line-height:1.9;font-family:inherit;resize:vertical">' + esc(cur) + '</textarea>' +
      '<div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">' +
        '<button class="lk-btn" onclick="YZStudy._save(\'' + gid + '\',' + i + ')">保存</button>' +
        '<button onclick="YZStudy._close()">取消</button>' +
        (cur ? '<button onclick="YZStudy._clear(\'' + gid + '\',' + i + ')">清空这段</button>' : '') +
      '</div>' +
      '<p class="sub" style="margin:10px 0 0;font-size:.74rem;line-height:1.7;opacity:.55">只存本机，不上传。可用「导出我的数据」带走（设置 → 导入导出）。</p>';
    var ov = document.getElementById('yzGEdit');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'yzGEdit';
      ov.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
      ov.onclick = function (e) { if (e.target === ov) closeEdit(); };
      ov.innerHTML = '<div style="width:100%;max-width:560px;max-height:86vh;overflow:auto;background:var(--card,#1b1512);border:1px solid var(--line);border-radius:14px;padding:16px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<b style="font-size:.92rem" id="yzGTitle">' + esc(s.h) + '</b>' +
        '<button onclick="YZStudy._close()" aria-label="关闭" style="background:none;border:0;color:inherit;font-size:1.1rem;cursor:pointer">✕</button></div>' +
        '<div id="yzGBody"></div></div>';
      document.body.appendChild(ov);
    }
    var ttl = document.getElementById('yzGTitle'); if (ttl) ttl.textContent = s.h;
    document.getElementById('yzGBody').innerHTML = html;
    var ta = document.getElementById('yzGTa'); if (ta) setTimeout(function () { ta.focus(); }, 60);
  }
  function closeEdit() { var ov = document.getElementById('yzGEdit'); if (ov) ov.remove(); }
  function _save(gid, i) {
    var ta = document.getElementById('yzGTa'); if (!ta) return;
    saveSection(gid, i, ta.value);
    closeEdit();
    openGuide(gid);                       /* 原地重渲染，进度同步更新 */
    try { if (window.toast) toast('已保存（只存本机）'); } catch (e) {}
  }
  function _clear(gid, i) {
    saveSection(gid, i, '');
    closeEdit(); openGuide(gid);
  }
  function setQuery(v) {
    _q = String(v || '').trim();
    var box = document.getElementById('contentView');
    if (!box) return;
    /* 只重渲染答疑页本身，不整页跳转：保持输入焦点与滚动位置 */
    var wrap = document.getElementById('yzAnsWrap');
    if (wrap) {
      var y = window.scrollY;
      wrap.innerHTML = answersHTML();
      var inp = document.getElementById('yzAnsQ');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      window.scrollTo(0, y);
    }
  }
  function listGuides() {
    return gds().map(function (g) {
      var p = progress(g);
      return { id: g.id, book: g.book, title: g.book + ' · 导读', done: p.done, total: p.total };
    });
  }
  function summary() {
    var started = 0, done = 0;
    gds().forEach(function (g) { var p = progress(g); if (p.done) started++; if (p.done >= p.total) done++; });
    return { guides: gds().length, started: started, finished: done, answers: ans().reduce(function (a, g) { return a + g.items.length; }, 0), terms: gls().length };
  }

  /* ---------------- 供问答引擎使用 ---------------- */
  /* 中文没有空格，按 2-gram 切比按空格切更靠谱。
     只回放静态文本，不生成任何新句子。 */
  function grams(str) {
    var t = String(str || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, '');
    var out = [], seen = {};
    for (var i = 0; i + 2 <= t.length; i++) {
      var g = t.slice(i, i + 2);
      if (/^[的了是在和与或吗呢么这那一不了有]+$/.test(g)) continue;
      if (!seen[g]) { seen[g] = 1; out.push(g); }
    }
    if (t.length === 2) out = [t];
    return out;
  }
  function jacc(a, b) {
    var set = {}; a.forEach(function (x) { set[x] = 1; });
    var n = 0; b.forEach(function (x) { if (set[x]) n++; });
    return b.length ? n / b.length : 0;
  }
  function search(q) {
    var raw = String(q || '').trim();
    if (!raw) return [];
    var R = grams(raw);
    var out = [];
    function coverRatio(hay) { return jacc(R, grams(hay)); }
    ans().forEach(function (g) {
      g.items.forEach(function (it) {
        var hay = it.q + it.a + (it.why || '') + (it.basis || []).join('') + (it.tags || []).join('');
        var cov = coverRatio(hay);                       /* 问题里有多少词能在这条里找到 */
        var qcov = coverRatio(it.q);                     /* 这条的问题有多少词出现在提问里 */
        var exact = (it.q.indexOf(raw) >= 0 || raw.indexOf(it.q.replace(/[?？。！!]/g, '')) >= 0) ? 10 : 0;
        /* 答疑的问题被覆盖得越多，越说明它就是问的这件事——权重高于正文命中 */
        var score = cov * 15 + qcov * 20 + (qcov >= 0.3 ? 8 : 0) + exact;
        if (score >= 3) out.push({ kind: 'answer', score: Math.round(score), title: it.q, text: it.a, basis: it.basis, group: g.name });
      });
    });
    gls().forEach(function (t) {
      var hay = t.term + (t.alias || []).join('') + t.dic + t.note;
      var cov = coverRatio(hay);
      var tk = (raw === t.term) ? 16 : ((raw.indexOf(t.term) >= 0) ? 13 : 0);
      var score = cov * 20 + tk;
      if (score >= 4 || tk) out.push({ kind: 'term', score: Math.round(score), title: t.term, text: t.dic, basis: [t.from], note: t.note });
    });
    gds().forEach(function (g) {
      var hay = g.book + g.ask + g.sections.map(function (x) { return x.h + x.hint; }).join('');
      var cov = coverRatio(hay);
      var score = cov * 18 + (raw.indexOf(g.book) >= 0 ? 6 : 0);
      if (score >= 6) out.push({ kind: 'guide', score: Math.round(score), title: g.book + ' · 导读骨架', text: '这一本要解决的问题：' + g.ask, basis: g.refs || [] });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 6);
  }


  /* ---------------- 术语卡：改 / 增 / 删 / 批量导入 ---------------- */
  function afterTermSave() {
    try { if (window.YZY && typeof YZY.reapply === 'function') YZY.reapply(); } catch (e) {}
    try { if (window.YZY && typeof YZY.applyOnce === 'function') YZY.applyOnce(); } catch (e) {}
    window.__yzAnsTab = 'gl';
    try { if (typeof openHub === 'function') { openHub('answers'); return; } } catch (e) {}
    try { if (window.openContent) window.openContent('📚 术语卡', glossaryHTML()); } catch (e) {}
  }
  function tfFld(label, id, val, ph, kind) {
    var v = String(val == null ? '' : val);
    var box = kind === 'textarea'
      ? '<textarea id="' + id + '" style="width:100%;min-height:' + (id === 'tfConfuse' ? '90px' : '76px') + ';padding:9px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.85rem;line-height:1.8;font-family:inherit" placeholder="' + esc(ph || '') + '">' + esc(v) + '</textarea>'
      : '<input id="' + id + '" value="' + esc(v) + '" placeholder="' + esc(ph || '') + '" style="width:100%;padding:9px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.85rem">';
    return '<label style="display:block;margin:8px 0"><span style="font-size:.76rem;opacity:.7">' + esc(label) + '</span>' + box + '</label>';
  }
  function termForm(title, init, save) {
    var old = document.getElementById('yzTermBox'); if (old) old.remove();
    init = init || {};
    var d = document.createElement('div');
    d.id = 'yzTermBox';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100005;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px';
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    var cf = (init.confuse || []).map(function (x) { return (x.t || '') + '|' + (x.d || ''); }).join('\n');
    d.innerHTML = '<div style="width:100%;max-width:560px;max-height:88vh;overflow:auto;background:var(--card,#1b1512);border:1px solid var(--line);border-radius:14px;padding:16px;text-align:left">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<b style="font-size:.94rem">' + esc(title) + '</b>' +
      '<button onclick="document.getElementById(\'yzTermBox\').remove()" style="background:none;border:0;color:inherit;font-size:1.1rem;cursor:pointer">✕</button></div>' +
      tfFld('术语名', 'tfTerm', init.term, '如：唯物主义') +
      tfFld('一句话定义', 'tfDic', init.dic, '主张物质第一性、精神第二性……', 'textarea') +
      tfFld('出处', 'tfFrom', init.from, '恩格斯《路德维希·费尔巴哈和德国古典哲学的终结》第二章') +
      tfFld('分组', 'tfGroup', init.group, '哲学与认识 / 历史观与阶级 / 政治经济学 / …') +
      tfFld('一句话辨析（可选）', 'tfNote', init.note, '判断标准只有一条：物质与意识谁是第一性') +
      tfFld('易混辨析（可选，每行一条，写成「标题|说明」）', 'tfConfuse', cf, '与「唯物」的日常用法|日常说这人很唯物多指重实际…', 'textarea') +
      '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">' +
      '<button class="lk-btn" id="tfSave">保存</button>' +
      '<button class="sbtn" style="padding:6px 12px" onclick="document.getElementById(\'yzTermBox\').remove()">取消</button></div>' +
      '<p class="sub" style="margin:9px 0 0;font-size:.74rem;line-height:1.7;opacity:.6">只存本机，不上传；可用「导出我的数据」一起带走。</p></div>';
    document.body.appendChild(d);
    function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
    document.getElementById('tfSave').onclick = function () {
      var v = { term: val('tfTerm'), dic: val('tfDic'), from: val('tfFrom'), group: val('tfGroup'), note: val('tfNote') };
      var list = val('tfConfuse').split(/\r?\n/).map(function (l) {
        l = l.trim(); if (!l) return null;
        var i = l.indexOf('|');
        if (i < 0) i = l.indexOf('｜');
        if (i < 0) return { t: l, d: '' };
        return { t: l.slice(0, i).trim(), d: l.slice(i + 1).trim() };
      }).filter(Boolean);
      v.confuse = list;
      if (!v.term) { if (window.toast) toast('术语名不能为空'); return; }
      if (!v.dic) { if (window.toast) toast('定义不能为空'); return; }
      if (save(v)) d.remove();
    };
    setTimeout(function () { var el = document.getElementById('tfTerm'); if (el) el.focus(); }, 80);
  }
  function termEdit(id) {
    var t = gls().filter(function (x) { return x.id === id; })[0];
    if (!t) { if (window.toast) toast('找不到这张卡'); return; }
    termForm('✏️ 修改术语卡', t, function (v) {
      var r = (window.YZY && YZY.editTerm) ? YZY.editTerm(id, v) : { ok: false, msg: '编辑器未加载' };
      if (!r || !r.ok) { if (window.toast) toast((r && r.msg) || '保存失败'); return false; }
      if (window.toast) toast('已保存');
      afterTermSave(); return true;
    });
  }
  function termNew() {
    termForm('＋ 新增术语卡', {}, function (v) {
      var r = (window.YZY && YZY.addTerm) ? YZY.addTerm(v) : { ok: false, msg: '编辑器未加载' };
      if (!r || !r.ok) { if (window.toast) toast((r && r.msg) || '保存失败'); return false; }
      if (window.toast) toast('已新增');
      afterTermSave(); return true;
    });
  }
  function termRemove(id) {
    try { if (!confirm('删除这张术语卡？只删本机副本，内置数据不动。')) return; } catch (e) { }
    var r = (window.YZY && YZY.removeTerm) ? YZY.removeTerm(id) : { ok: false, msg: '编辑器未加载' };
    if (!r || !r.ok) { if (window.toast) toast((r && r.msg) || '删除失败'); return; }
    if (window.toast) toast('已删除');
    afterTermSave();
  }
  /* 宽松解析：每行一条，列分隔认 | ｜ 制表符；只有「术语：定义」两列也能认 */
  function parseTermText(text) {
    var out = [], bad = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var raw = String(line || '').trim();
      if (!raw || raw.charAt(0) === '#') return;
      var parts = raw.split(/\s*[|｜\t]\s*/);
      if (parts.length < 2) {
        var m = raw.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
        if (m) parts = [m[1], m[2]]; else { bad.push(raw); return; }
      }
      var t = { term: String(parts[0] || '').trim(), dic: String(parts[1] || '').trim(), from: String(parts[2] || '').trim(), group: String(parts[3] || '').trim() || '导入' };
      if (!t.term || !t.dic) { bad.push(raw); return; }
      out.push(t);
    });
    return { list: out, bad: bad };
  }
  function termImport() {
    var old = document.getElementById('yzTermImp'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'yzTermImp';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100005;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px';
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    d.innerHTML = '<div style="width:100%;max-width:600px;max-height:88vh;overflow:auto;background:var(--card,#1b1512);border:1px solid var(--line);border-radius:14px;padding:16px;text-align:left">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<b style="font-size:.94rem">📥 批量导入术语卡</b>' +
      '<button onclick="document.getElementById(\'yzTermImp\').remove()" style="background:none;border:0;color:inherit;font-size:1.1rem;cursor:pointer">✕</button></div>' +
      '<p class="sub" style="margin:0 0 8px;font-size:.78rem;line-height:1.8">每行一张卡，列之间用 <b>|</b> 或 <b>｜</b> 或 Tab 分隔：<br>' +
      '<code style="font-size:.76rem">术语 | 一句话定义 | 出处（可空） | 分组（可空）</code><br>' +
      '只有「术语：定义」两列也能认；以 # 开头的行会被忽略。</p>' +
      '<textarea id="timTa" style="width:100%;min-height:190px;padding:9px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.82rem;line-height:1.9;font-family:inherit" placeholder="唯物主义 | 主张物质第一性、精神第二性…… | 恩格斯《费尔巴哈论》第二章 | 哲学与认识&#10;唯心主义 | 主张精神第一性、物质第二性…… | 同上 | 哲学与认识"></textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button class="sbtn" style="padding:6px 12px" id="timPrev">先看解析结果</button>' +
      '<button class="lk-btn" id="timGo">导入</button>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:.78rem;opacity:.8"><input type="checkbox" id="timOv">覆盖同名词条</label></div>' +
      '<div id="timOut" style="margin-top:10px;font-size:.8rem;line-height:1.9"></div></div>';
    document.body.appendChild(d);
    function ta() { return document.getElementById('timTa'); }
    function out() { return document.getElementById('timOut'); }
    document.getElementById('timPrev').onclick = function () {
      var r = parseTermText(ta().value);
      var names = {};
      (gls() || []).forEach(function (x) { if (x && x.term) names[x.term] = 1; });
      var dup = r.list.filter(function (x) { return names[x.term]; }).map(function (x) { return x.term; });
      out().innerHTML = '<div style="padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.05)">' +
        '可导入 <b>' + r.list.length + '</b> 条' +
        (dup.length ? '；其中 <b>' + dup.length + '</b> 条与已有同名词条（' + esc(dup.slice(0, 5).join('、')) + (dup.length > 5 ? '…' : '') + '）' : '') +
        (r.bad.length ? '；<span style="color:#ff8b8b">' + r.bad.length + ' 行格式不对已跳过</span>' : '') +
        (r.list.length ? '<div style="margin-top:6px;opacity:.75">例：' + esc(r.list.slice(0, 3).map(function (x) { return x.term + ' — ' + x.dic.slice(0, 18); }).join('　·　')) + '</div>' : '') +
        '</div>';
    };
    document.getElementById('timGo').onclick = function () {
      var r = parseTermText(ta().value);
      if (!r.list.length) { if (window.toast) toast('没解析出可导入的条目'); return; }
      if (!window.YZY || !YZY.importTerms) { if (window.toast) toast('编辑器未加载'); return; }
      var ov = document.getElementById('timOv');
      var res = YZY.importTerms(r.list, { overwrite: !!(ov && ov.checked) });
      if (!res || !res.ok) { if (window.toast) toast('导入失败'); return; }
      if (window.toast) toast('导入 ' + res.added + ' 条' + (res.skipped && res.skipped.length ? '，跳过 ' + res.skipped.length + ' 条同名' : ''));
      d.remove();
      afterTermSave();
    };
  }

  /* ---------------- 答疑：从文档批量导入 ---------------- */
  function parseAnswerText(text) {
    var list = [], bad = [], cur = null, group = '';
    function flush() { if (cur && cur.q && cur.a) list.push(cur); cur = null; }
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var t = String(line || '').trim();
      if (!t) return;
      var mg = t.match(/^#{1,4}\s*(.+)$/);
      if (mg) { flush(); group = mg[1].trim(); return; }
      var mq = t.match(/^(?:Q|q|问|问题)\s*[:：]\s*(.+)$/);
      if (mq) { flush(); cur = { group: group, q: mq[1].trim(), a: '' }; return; }
      var ma = t.match(/^(?:A|a|答|答案)\s*[:：]\s*(.+)$/);
      if (ma) { if (cur) cur.a = (cur.a ? cur.a + '\n' : '') + ma[1].trim(); else bad.push(t); return; }
      /* 依据 / 出处 / 来源：一路可对应「依据」字段，这样导出的文件再导入不会把依据粘进答案里 */
      var mb = t.match(/^(?:依据|出处|来源)\s*[:：]\s*(.+)$/);
      if (mb) { if (cur) cur.basis = (cur.basis || []).concat(mb[1].split(/[、;；]/).map(function (x) { return x.trim(); }).filter(Boolean));
        else bad.push(t); return; }
      if (cur && cur.q) cur.a = (cur.a ? cur.a + '\n' : '') + t;
      else bad.push(t);
    });
    flush();
    return { list: list.filter(function (x) { return x.q && x.a; }), bad: bad };
  }
  function ansImport() {
    var old = document.getElementById('yzAnsImp'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'yzAnsImp';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100005;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px';
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    d.innerHTML = '<div style="width:100%;max-width:620px;max-height:88vh;overflow:auto;background:var(--card,#1b1512);border:1px solid var(--line);border-radius:14px;padding:16px;text-align:left">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<b style="font-size:.94rem">📥 从文档导入答疑</b>' +
      '<button onclick="document.getElementById(\'yzAnsImp\').remove()" style="background:none;border:0;color:inherit;font-size:1.1rem;cursor:pointer">✕</button></div>' +
      '<p class="sub" style="margin:0 0 8px;font-size:.78rem;line-height:1.85">' +
      '按下面的格式贴进来（从 TXT / MD 复制的也行）：<br>' +
      '<code style="font-size:.76rem;white-space:pre-wrap"># 分组名（可省略，省略则归入「导入」）\nQ: 问题\nA: 答案（可以多行，直接往下写）\nQ: 下一个问题\nA: ……</code><br>' +
      '「问：」「答：」和「问题：」「答案：」也能认；空行会被忽略。</p>' +
      '<textarea id="ansTa" style="width:100%;min-height:210px;padding:9px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.82rem;line-height:1.9;font-family:inherit" placeholder="# 哲学与认识&#10;Q: 什么是唯物辩证法？&#10;A: ……&#10;Q: 它和形而上学有什么区别？&#10;A: ……"></textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button class="sbtn" style="padding:6px 12px" id="ansPrev">先看解析结果</button>' +
      '<button class="lk-btn" id="ansGo">导入</button>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:.78rem;opacity:.8"><input type="checkbox" id="ansOv">覆盖同名问题</label></div>' +
      '<div id="ansOut" style="margin-top:10px;font-size:.8rem;line-height:1.9"></div></div>';
    document.body.appendChild(d);
    function ta() { return document.getElementById('ansTa'); }
    document.getElementById('ansPrev').onclick = function () {
      var r = parseAnswerText(ta().value);
      var groups = {};
      r.list.forEach(function (x) { groups[x.group || '导入'] = (groups[x.group || '导入'] || 0) + 1; });
      var out = document.getElementById('ansOut');
      out.innerHTML = '<div style="padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.05)">' +
        '识别出 <b>' + r.list.length + '</b> 条问答' +
        (Object.keys(groups).length ? '，分组：' + esc(Object.keys(groups).map(function (k) { return k + ' ' + groups[k]; }).join(' · ')) : '') +
        (r.bad.length ? '；<span style="color:#ff8b8b">' + r.bad.length + ' 行没认出已跳过</span>' : '') +
        (r.list.length ? '<div style="margin-top:6px;opacity:.75">例：' + esc(r.list[0].q.slice(0, 30)) + '</div>' : '') + '</div>';
    };
    document.getElementById('ansGo').onclick = function () {
      var r = parseAnswerText(ta().value);
      if (!r.list.length) { if (window.toast) toast('没解析出问答'); return; }
      if (!window.YZY || !YZY.importAnswers) { if (window.toast) toast('编辑器未加载'); return; }
      var ov = document.getElementById('ansOv');
      var res = YZY.importAnswers(r.list, { overwrite: !!(ov && ov.checked) });
      if (!res || !res.ok) { if (window.toast) toast('导入失败'); return; }
      if (window.toast) toast('导入 ' + res.added + ' 条' + (res.skipped && res.skipped.length ? '，跳过 ' + res.skipped.length + ' 条同名' : ''));
      d.remove();
      try { if (YZY.reapply) YZY.reapply(); } catch (e) {}
      window.__yzAnsTab = 'qa';
      try { if (typeof openHub === 'function') openHub('answers'); } catch (e) {}
    };
  }
  /* ---------------- 答疑：导出 ---------------- */
  /* 导出成与「导入」完全相同的格式（# 分组 / Q: / A: / 依据：），
     这样导出文件可以直接再导入，用于备份、搬设备、或者在电脑上编辑后再贴回来。 */
  function answersText(groupName) {
    var G = (window.SITE_ANSWERS || {}).groups || [], out = [];
    G.forEach(function (g) {
      if (groupName && g.name !== groupName) return;
      var items = (g.items || []).filter(function (y) { return y && y.q && y.a; });
      if (!items.length) return;
      out.push('# ' + (g.name || '答疑'));
      items.forEach(function (y) {
        out.push('Q: ' + y.q);
        out.push('A: ' + String(y.a).replace(/\n/g, '\n   '));
        if (y.basis && y.basis.length) out.push('依据：' + y.basis.join('、'));
        out.push('');
      });
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function ansExport() {
    var old = document.getElementById('yzAnsExp'); if (old) old.remove();
    var G = ((window.SITE_ANSWERS || {}).groups || []).map(function (g) { return g.name; });
    var d = document.createElement('div');
    d.id = 'yzAnsExp';
    d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100005;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px';
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    d.innerHTML = '<div style="width:100%;max-width:620px;max-height:88vh;overflow:auto;background:var(--card,#1b1512);border:1px solid var(--line);border-radius:14px;padding:16px;text-align:left">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<b style="font-size:.94rem">📤 导出答疑</b>' +
      '<button onclick="document.getElementById(\'yzAnsExp\').remove()" style="background:none;border:0;color:inherit;font-size:1.1rem;cursor:pointer">✕</button></div>' +
      '<p class="sub" style="margin:0 0 8px;font-size:.78rem;line-height:1.8">导出的格式与「从文档导入」完全一致，可以直接再导入。</p>' +
      '<select id="ansExpG" style="width:100%;padding:8px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.82rem;margin-bottom:8px">' +
      '<option value="">全部答疑（' + G.length + ' 组）</option>' +
      G.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') + '</select>' +
      '<textarea id="ansExpTa" readonly style="width:100%;min-height:230px;padding:9px;border-radius:9px;border:1px solid var(--line);background:transparent;color:inherit;font-size:.78rem;line-height:1.8;font-family:ui-monospace,monospace"></textarea>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
      '<button class="sbtn" style="padding:6px 12px" id="ansCp">📋 复制全文</button>' +
      '<button class="lk-btn" id="ansSv">💾 存为 .txt</button>' +
      '<span id="ansExpN" class="sub" style="font-size:.76rem;align-self:center"></span></div></div>';
    document.body.appendChild(d);
    function refresh() {
      var g = document.getElementById('ansExpG').value || '';
      var t = answersText(g);
      document.getElementById('ansExpTa').value = t;
      var n = (t.match(/^Q:/gm) || []).length;
      document.getElementById('ansExpN').textContent = n + ' 条 · ' + t.length + ' 字';
      return t;
    }
    document.getElementById('ansExpG').onchange = refresh;
    refresh();
    document.getElementById('ansCp').onclick = function () {
      var t = document.getElementById('ansExpTa');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t.value); }
        else { t.removeAttribute('readonly'); t.select(); document.execCommand('copy'); t.setAttribute('readonly', 'readonly'); }
        if (window.toast) toast('已复制 ' + (t.value.match(/^Q:/gm) || []).length + ' 条');
      } catch (e) { try { t.select(); } catch (e2) {} if (window.toast) toast('请长按文本框全选复制'); }
    };
    document.getElementById('ansSv').onclick = function () {
      var t = refresh();
      var name = '学通-答疑-' + ((document.getElementById('ansExpG').value || '全部').replace(/[\\/:*?"<>|]/g, '_')) + '.txt';
      var ok = false;
      try { if (window.YZSave && YZSave.text) ok = !!YZSave.text(name, 'text/plain;charset=utf-8', t); } catch (e) {}
      if (window.toast) toast(ok ? '已保存：' + name : '这台设备不支持直接存文件，请用「复制全文」');
    };
  }
  window.YZStudy = {
    answersHTML: answersHTML, glossaryHTML: glossaryHTML, glossaryBlock: glossaryBlock,
    guideBlock: guideBlock, outlineBlock: outlineBlock, outlineOf: outlineOf, guideByBook: guideByBook, openGuide: openGuide,
    editSection: editSection, setQuery: setQuery, listGuides: listGuides, summary: summary,
    search: search, saveSection: saveSection, progress: progress, textOf: textOf,
    _save: _save, _clear: _clear, _close: closeEdit,
    termEdit: termEdit, termNew: termNew, termRemove: termRemove, termImport: termImport,
    ansImport: ansImport, ansExport: ansExport, _parseTermText: parseTermText, _parseAnswerText: parseAnswerText, _answersText: answersText
  };
})();
