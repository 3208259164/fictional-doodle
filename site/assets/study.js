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
    return '<p class="sub" style="margin:0 0 10px;line-height:1.8">' + L.length +
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
  function guideBlock(bookTitle) {
    var g = guideByBook(bookTitle);
    if (!g) return '';
    var p = progress(g);
    var started = p.done > 0;
    return '<h2 class="sub-title" style="margin-top:18px">📖 导读骨架（' + p.total + ' 节 · 已填 ' + p.done + '）</h2>' +
      '<p class="sub" style="margin:0 0 8px;line-height:1.8">' +
        '这一层是「结构」，不是「内容」：骨架列出该说什么，正文由你自己写（只存本机）。' +
        (started ? '已填 ' + p.done + ' 节，接着写即可。' : '还没开始，点下面进去。') + '</p>' +
      '<button class="lk-btn" onclick="YZStudy.openGuide(\'' + esc(g.id) + '\')">' +
        (started ? '✏️ 继续写导读' : '✏️ 开始写导读') + ' →</button>' +
      '<div style="margin-top:8px;font-size:.78rem;line-height:1.8;opacity:.65">要解决的问题：' + esc(g.ask) + '</div>';
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
    return '<div class="lcard" style="align-items:flex-start;flex-direction:column;gap:8px;margin:10px 0">' +
      '<div class="pname" style="font-size:.9rem">' + esc(s.h) + (has ? '<span style="font-size:.72rem;opacity:.55;font-weight:400"> · 已填</span>' : '') + '</div>' +
      '<div style="font-size:.79rem;line-height:1.8;opacity:.62">写作提示：' + esc(s.hint) + '</div>' +
      (has
        ? '<div style="font-size:.85rem;line-height:1.95;white-space:pre-line">' + esc(t) + '</div>'
        : '<div style="font-size:.8rem;opacity:.45">（还没写）</div>') +
      '<div style="display:flex;gap:8px"><button class="aslink" style="font-size:.78rem" onclick="YZStudy.editSection(\'' + g.id + '\',' + i + ')">' +
        (has ? '✏️ 修改这段' : '＋ 填写这段') + '</button></div>' +
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
      '<p class="sub" style="margin:10px 0 0;font-size:.74rem;line-height:1.7;opacity:.55">只存本机，不上传。可在「备份与恢复」里随快照一起备份，也可用「导出我的数据」带走。</p>';
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

  window.YZStudy = {
    answersHTML: answersHTML, glossaryHTML: glossaryHTML, glossaryBlock: glossaryBlock,
    guideBlock: guideBlock, guideByBook: guideByBook, openGuide: openGuide,
    editSection: editSection, setQuery: setQuery, listGuides: listGuides, summary: summary,
    search: search, saveSection: saveSection, progress: progress, textOf: textOf,
    _save: _save, _clear: _clear, _close: closeEdit
  };
})();
