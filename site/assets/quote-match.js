/* =====================================================================
   学通 · 引文比对（quote-match.js）
   ---------------------------------------------------------------------
   解决什么问题：
     现有的正文检索是「精确子串匹配」。可人回忆引文常常记错几个字——
     把「全世界无产者，联合起来」记成「全世界无产阶级联合起来」，
     把「一切社会的历史都是阶级斗争的历史」漏掉一个字，
     精确检索就一条都出不来。

   做什么：
     把用户记住的那半句，跟站内所有正文段落做**模糊比对**，
     返回相似度最高的一段，并指出它在原文里的位置（前后各取一段上下文）。
     这是为了回答一个很具体的问题：这句话到底在哪本书、哪一段里。

   怎么做（不建倒排，直接线性扫）：
     ① 查询与段落都做「归一化」：去掉标点、空格，英文转小写；
     ② 把查询切成 3 字滑窗（3-gram），去重；
     ③ 每一段算「命中的 gram 数 / gram 总数」= 覆盖率；
     ④ 覆盖率 ≥ 阈值 的段落按分数排序返回；
     ⑤ 对命中的段落，再用 4 字片段做定位，把位置映射回**原文索引**
        （因为归一化会改变下标），取出原文上下文。
     站内可控文本约 2 MB、1200 余段，一次全扫在 20 ms 量级；
     只有精确检索零结果时才会调用，不影响正常搜索。

   对外接口：
     window.YZQUOTE.match(q, opt) → [{cat,t,sub,snip,hit,score,fn}]
     window.YZQUOTE.best(q)       → 单条最优（无则 null）
     window.YZQUOTE.stats()       → 诊断用
     opt: { limit:5, thresh:0.5, minLen:6 }
   ===================================================================== */
(function () {
  'use strict';

  var NG = 3;            /* 3-gram */
  var LOC_N = 4;         /* 定位用 4 字片段 */
  var DEF = { limit: 5, thresh: 0.5, minLen: 6, win: 34 };
  var CACHE = null;

  function S(v) { return v == null ? '' : String(v); }
  function isHan(ch) { return /[\u4e00-\u9fa5]/.test(ch); }

  /* 归一化：只保留汉字、字母、数字，英文小写 */
  function norm(s) {
    var t = S(s), o = '';
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (isHan(ch)) o += ch;
      else if (/[A-Za-z0-9]/.test(ch)) o += ch.toLowerCase();
    }
    return o;
  }

  /* 归一化 + 位置映射：n[i] 对应原文的 map[i] */
  function normMap(orig) {
    var t = S(orig), o = '', map = [];
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (isHan(ch)) { o += ch; map.push(i); }
      else if (/[A-Za-z0-9]/.test(ch)) { o += ch.toLowerCase(); map.push(i); }
    }
    return { n: o, map: map };
  }

  function grams(s, n) {
    var out = [], seen = {};
    for (var i = 0; i + n <= s.length; i++) {
      var g = s.substr(i, n);
      if (!seen[g]) { seen[g] = 1; out.push(g); }
    }
    return out;
  }

  /* 建索引：拉取 fulltext 的全部段落，预算归一化文本 */
  function build() {
    if (CACHE) return CACHE;
    var list = [];
    try {
      var all = (window.YZFULLTEXT && typeof YZFULLTEXT.all === 'function') ? YZFULLTEXT.all() : [];
      for (var i = 0; i < all.length; i++) {
        var s = all[i] || {};
        var n = norm(s.text);
        if (n.length < 8) continue;          /* 太短的段没有比对价值 */
        list.push({ seg: s, i: i, n: n });
      }
    } catch (e) { list = []; }
    CACHE = { list: list };
    return CACHE;
  }

  /* 在原文里定位：用 4 字片段找到最长的一段连续匹配，返回 {start,end}（原文下标） */
  function locate(orig, q) {
    var nm = normMap(orig), nq = norm(q);
    if (!nm.n || nq.length < LOC_N) return null;
    var best = { len: 0, at: -1 };
    for (var i = 0; i + LOC_N <= nq.length; i++) {
      var piece = nq.substr(i, LOC_N);
      var p = nm.n.indexOf(piece);
      while (p >= 0) {
        /* 向两端延长 */
        var a = i + LOC_N, b = p + LOC_N, len = LOC_N;
        while (a < nq.length && b < nm.n.length && nq.charAt(a) === nm.n.charAt(b)) { len++; a++; b++; }
        var c = i - 1, dd = p - 1, lenL = len;
        while (c >= 0 && dd >= 0 && nq.charAt(c) === nm.n.charAt(dd)) { lenL++; c--; dd--; }
        if (lenL > best.len) best = { len: lenL, at: p };
        p = nm.n.indexOf(piece, p + 1);
      }
    }
    if (best.at < 0) return null;
    /* 归一化下标 → 原文下标 */
    var s0 = nm.map[best.at];
    var s1 = nm.map[Math.min(best.at + best.len - 1, nm.map.length - 1)];
    return { start: s0, end: s1 + 1, len: best.len };   /* len 供加权排序用 */
  }

  function clip(orig, pos, win) {
    var w = win || DEF.win;
    var a = Math.max(0, pos.start - w), b = Math.min(orig.length, pos.end + w);
    return (a > 0 ? '…' : '') + orig.slice(a, b) + (b < orig.length ? '…' : '');
  }

  function esc(s) {
    return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 主接口 */
  function match(q, opt) {
    var o = opt || {};
    var limit = o.limit || DEF.limit;
    var thresh = (o.thresh == null) ? DEF.thresh : o.thresh;
    var minLen = o.minLen || DEF.minLen;

    var nq = norm(q);
    if (nq.length < minLen) return [];

    var C = build(), gs = grams(nq, NG);
    if (!gs.length) return [];

    var res = [], k, j;
    for (k = 0; k < C.list.length; k++) {
      var it = C.list[k], t = it.n;
      /* 长度差太大直接跳过：归一化长度差超过 3 倍不可能高分 */
      if (t.length < nq.length / 3 || t.length > nq.length * 60) continue;
      var hit = 0;
      for (j = 0; j < gs.length; j++) if (t.indexOf(gs[j]) >= 0) hit++;
      var sc = hit / gs.length;
      if (sc >= thresh) res.push({ sc: sc, it: it });
    }
    /* 二次排序：不只比「零散 gram 命中率」，还要比「连续匹配有多长」。
       例：搜「全世界无产阶级联合起来」时，只按覆盖率会先给出某段解释性文字（含"无产阶级""联合"等词），
       而真正的那句原文「全世界无产者，联合起来！」连续匹配最长，应排第一。 */
    res.forEach(function (r) {
      var pos = locate(S(r.it.seg.text), q);
      r.pos = pos;
      r.cont = pos ? pos.len : 0;
    });
    res.sort(function (a, b) {
      var sa = a.sc * 0.5 + (a.cont / nq.length) * 0.5;
      var sb = b.sc * 0.5 + (b.cont / nq.length) * 0.5;
      if (Math.abs(sb - sa) > 1e-9) return sb - sa;
      return a.it.seg.text.length - b.it.seg.text.length;   /* 同分取更短的段，命中更精准 */
    });
    res = res.slice(0, limit);

    return res.map(function (r) {
      var seg = r.it.seg, orig = S(seg.text);
      var pos = r.pos;
      var snip = pos ? clip(orig, pos) : (orig.length > 90 ? orig.slice(0, 90) + '…' : orig);
      var idx = seg.resIndex == null ? r.it.i : seg.resIndex;
      /* 展示与排序必须用同一个分数（加权分），否则用户看到「78% 排在 56% 前面」会以为乱了。
         覆盖率另存为 coverage，便于诊断。 */
      var wsc = r.sc * 0.5 + (r.cont / nq.length) * 0.5;
      return {
        cat: '引文比对',
        t: S(seg.t) || '（未命名段落）',
        sub: '相似度 ' + Math.round(wsc * 100) + '%　·　' + S(seg.cat),
        snip: snip,
        score: wsc,
        coverage: r.sc,
        seg: seg,
        fn: function () { try { if (window.yzftShow) window.yzftShow(idx); } catch (e) {} }
      };
    });
  }

  function best(q, opt) {
    var r = match(q, opt);
    return r.length ? r[0] : null;
  }

  function stats() {
    var C = build();
    return { segs: C.list.length, ng: NG };
  }

  window.YZQUOTE = { match: match, best: best, stats: stats, _norm: norm, _locate: locate, _clip: clip };
})();
