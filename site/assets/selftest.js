/* =====================================================================
   学通 · 学习自测（selftest.js）
   ---------------------------------------------------------------------
   解决什么问题：
     站里有 68 张术语卡、124 个图谱节点、20 篇导读、24 条引文，
     但读完没有任何东西能检验「到底记住没有」。学了不等于会了。

   为什么能做到几乎零成本上线：
     题目全部由**已有数据自动生成**，不新造任何内容——
     ① 术语辨析：把术语卡的「容易混的地方」当正确项，其他术语的辨析当干扰项；
     ② 年代排序：用图谱节点的 y0/y1（本轮刚补齐，124 个节点全有）；
     ③ 导读题：用导读的 ask（这一本要解决什么问题）反推书名；
     ④ 引文题：用史料页的引文反推出处。
     所以内容越多，题库自动越大，不需要单独维护。

   出题为什么要固定：
     用「日期」当种子做确定性随机，同一天题目固定 —— 便于复习同一套题，
     也便于回归测试拿固定样本断言。

   对外接口：
     window.YZSELFTEST.open()           → 打开 10 题
     window.YZSELFTEST.build(seed)      → 只生成题目（不渲染），供测试
     window.YZSELFTEST.answer(i, j)     → 选项点击
     window.YZSELFTEST.state()          → { total, answered, right }
   ===================================================================== */
(function () {
  'use strict';

  var PER_ROUND = 10;
  var _cur = [], _ans = {}, _right = 0;

  function S(v) { return v == null ? '' : String(v); }
  function esc(s) {
    return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* 线性同余：同一种子出同一套题 */
  function mk(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function pick(R, arr) { return arr[Math.floor(R() * arr.length)]; }
  function shuffle(R, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function uniq(arr) {
    var out = [], seen = {};
    arr.forEach(function (x) { var k = S(x); if (!seen[k]) { seen[k] = 1; out.push(x); } });
    return out;
  }

  /* ① 术语辨析：正确项取自该术语的 confuse，干扰项取自别的术语 */
  function qTerm(R) {
    var G = (window.SITE_GLOSSARY || []).filter(function (x) { return x.confuse && x.confuse.length; });
    if (G.length < 5) return null;
    var t = pick(R, G), c = pick(R, t.confuse);
    var pool = shuffle(R, G.filter(function (x) { return x.id !== t.id; })).slice(0, 6);
    var wrong = pool.map(function (x) { return pick(R, x.confuse).d; });
    var right = c.d;
    var opts = uniq(shuffle(R, [right].concat(wrong))).slice(0, 4);
    if (opts.length < 3 || opts.indexOf(right) < 0) return null;
    return {
      type: '辨析',
      q: '关于「' + t.term + '」，下面哪一段辨析是对的？',
      opts: opts,
      ans: opts.indexOf(right),
      why: '「' + t.term + '」容易混的地方是' + c.t + '：' + c.d + '（出处：' + S(t.from) + '）',
      refName: t.term
    };
  }

  /* ② 年代题：谁最早（用图表节点的 y0/y1） */
  function qYear(R) {
    var N = ((window.SITE_GRAPH && window.SITE_GRAPH.nodes) || []).filter(function (n) { return typeof n.y0 === 'number'; });
    if (N.length < 8) return null;
    var four = shuffle(R, N).slice(0, 4);
    var years = four.map(function (n) { return n.y0; });
    if (uniq(years).length < 4) return null;      /* 同年并列会让题目有歧义 */
    var earliest = four.reduce(function (a, b) { return b.y0 < a.y0 ? b : a; });
    return {
      type: '年代',
      q: '下列四项中，时间最早的是哪一个？',
      opts: four.map(function (n) { return n.name; }),
      ans: four.indexOf(earliest),
      why: four.map(function (n) { return n.name + '（' + n.y0 + (n.y1 ? '—' + n.y1 : '') + '）'; }).join('　·　'),
      refName: earliest.name
    };
  }

  /* ③ 导读题：由 ask 反推书名 */
  function qGuide(R) {
    var G = window.SITE_GUIDES || [];
    if (G.length < 5) return null;
    var g = pick(R, G);
    var others = shuffle(R, G.filter(function (x) { return x.id !== g.id; })).slice(0, 3);
    var opts = shuffle(R, [g].concat(others)).map(function (x) { return '《' + x.book + '》'; });
    return {
      type: '导读',
      q: '「' + g.ask + '」——这是哪一本书要解决的问题？',
      opts: opts,
      ans: opts.indexOf('《' + g.book + '》'),
      why: '《' + g.book + '》（' + g.author + '，' + g.year + '）。这一本要解决的问题：' + g.ask,
      refName: g.book
    };
  }

  /* ④ 引文题：给出处 */
  function qQuote(R) {
    var Q = (window.SITE_CHANNEL || []).filter(function (x) { return x.text && x.src; });
    if (Q.length < 6) return null;
    var q = pick(R, Q);
    var used = {};
    var opts = [q.src];
    shuffle(R, Q.filter(function (x) { return x !== q; })).forEach(function (x) {
      if (opts.length >= 4) return;
      if (used[x.src] || opts.indexOf(x.src) >= 0) return;
      used[x.src] = 1; opts.push(x.src);
    });
    if (opts.length < 3) return null;
    opts = shuffle(R, opts);
    return {
      type: '引文',
      q: '「' + q.text + '」出自哪里？',
      opts: opts,
      ans: opts.indexOf(q.src),
      why: '这句子出自 ' + q.src,
      refName: q.src
    };
  }

  function build(seed) {
    var key = 0, str = S(seed || 'yz');
    for (var i = 0; i < str.length; i++) key = (key * 31 + str.charCodeAt(i)) >>> 0;
    var R = mk(key), gens = [qTerm, qYear, qGuide, qQuote], out = [], guard = 0;
    while (out.length < PER_ROUND && guard++ < 400) {
      var g = gens[out.length % gens.length];
      var q = g(R);
      if (q) out.push(q);
    }
    return out;
  }

  function todaySeed() {
    var d = new Date();
    return 'yz' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function card(i, q) {
    return '<div class="lcard" style="flex-direction:column;align-items:stretch;gap:8px;margin:10px 0">' +
      '<div style="font-size:.86rem;line-height:1.9"><b>' + (i + 1) + '.</b> ' +
      '<span style="opacity:.6;font-size:.74rem">[' + esc(q.type) + ']</span> ' + esc(q.q) + '</div>' +
      q.opts.map(function (o, j) {
        return '<button class="aslink" style="text-align:left;font-size:.83rem;line-height:1.85;padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:transparent;color:inherit" ' +
          'onclick="YZSELFTEST.answer(' + i + ',' + j + ')">' + String.fromCharCode(65 + j) + '. ' + esc(o) + '</button>';
      }).join('') +
      '<div id="stf' + i + '" style="font-size:.8rem;line-height:1.85;opacity:.9"></div>' +
      '</div>';
  }

  function open() {
    _cur = build(todaySeed()); _ans = {}; _right = 0;
    if (!_cur.length) { if (window.toast) toast('自测题目生成失败：数据没加载完'); return; }
    var html = '<p class="sub" style="margin:0 0 10px;line-height:1.85">' +
      _cur.length + ' 道题，全部由站内已有数据自动生成（术语卡的辨析 / 图谱年份 / 导读问题 / 史料引文）。' +
      '选完立刻判对错并给解析，解析里的出处可以顺着去原条目看。</p>' +
      '<div id="stScore" style="font-size:.82rem;opacity:.75;margin-bottom:8px">已答 0 题</div>' +
      _cur.map(function (q, i) { return card(i, q); }).join('');   /* map 回调是 (元素, 下标)，不能直接传 card */
    if (window.openContent) window.openContent('🎯 学习自测', html);
  }

  function answer(i, j) {
    var q = _cur[i]; if (!q) return;
    if (_ans[i] != null) return;                 /* 一题只判一次 */
    _ans[i] = j;
    var box = document.getElementById('stf' + i); if (!box) return;
    var okk = (j === q.ans);
    if (okk) _right++;
    box.innerHTML = '<div style="padding:8px 10px;border-radius:8px;background:' + (okk ? 'rgba(141,230,161,.12)' : 'rgba(255,139,139,.12)') + '">' +
      '<b style="color:' + (okk ? '#8de6a1' : '#ff8b8b') + '">' + (okk ? '✓ 对了' : '✗ 不对，正确答案是 ' + String.fromCharCode(65 + q.ans)) + '</b>' +
      '<div style="margin-top:4px">' + esc(q.why) + '</div></div>';
    var n = Object.keys(_ans).length;
    var sc = document.getElementById('stScore');
    if (sc) sc.textContent = '已答 ' + n + ' 题　·　答对 ' + _right + ' 题' + (n === _cur.length ? '　（本组完成）' : '');
  }

  function state() {
    return { total: _cur.length, answered: Object.keys(_ans).length, right: _right };
  }

  window.YZSELFTEST = { open: open, build: build, answer: answer, state: state, _todaySeed: todaySeed };
})();
