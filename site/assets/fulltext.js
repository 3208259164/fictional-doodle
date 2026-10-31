/* =====================================================================
   学通 · 正文级全文检索（fulltext.js）
   ---------------------------------------------------------------------
   解决什么问题：
     顶部搜索原来只到「条目级」——搜一句话只能命中书名 / 人物名，
     命中词典释义、概念正文、导读正文、答疑正文里那句话的，一条都出不来；
     本机导入的整本书正文更完全搜不到（正文在 IndexedDB 里，几十万字）。

   做什么：
     ① 段落级检索（同步）：把 词典 / 概念 / 导读 / 答疑 / 书库简介 / 史料正文
        全部切段后扫一遍，命中时给出「命中上下文」片段，点开能看完整正文；
     ② 片段提取 snip()：给已有条目（书库、人物…）补一句命中上下文，
        让用户知道「为什么这条会命中」；
     ③ 本机书正文检索（异步）：读 IndexedDB 里的 TXT / MD 整本扫，
        每本书建一次切段缓存（存 IndexedDB），文件不变就不再重建。

   为什么不用 SQLite FTS5：
     本项目是 WebView 套壳，没有原生 SQLite 通道；站内可控文本约 2 MB，
     线性 indexOf 在现代 WebView 上 <50 ms，建倒排索引反而更慢更占内存。
     真正值得建缓存的是「本机书正文」，所以只给它做切段缓存。

   对外接口（window.YZFULLTEXT）：
     .snip(text,q,w)      → {pre,hit,post} | ''
     .snipText(text,q,w)  → 纯文本片段
     .search(q)           → [{cat,t,sub,snip,fn,score}]
     .searchLocal(q,cb)   → 异步；cb([...])，cat='本机正文'
     .indexLocal(cb)      → 预建本机正文缓存
     .stats()             → 诊断用
     页面级：yzftShow(i) / yzftLocal(id) —— 命中条目点开后展示正文
   ===================================================================== */
(function () {
  'use strict';

  var SEG_MIN = 90;          /* 超过这个长度的正文才切段；短字段整段算一块 */
  var SNIP_W = 26;           /* 片段左右各取多少字 */
  var LOCAL_DB = 'yz_ft_v1', LOCAL_STORE = 'idx';
  var MAX_LOCAL_HIT = 12;

  function S(v) { return v == null ? '' : String(v); }
  function low(v) { return S(v).toLowerCase(); }
  function isFn(f) { return typeof f === 'function'; }
  function esc(s) {
    return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 查询拆成必须同时出现的词（空格 / 逗号 / 顿号分隔；中文不切） */
  function terms(q) {
    var a = low(q).split(/[\s,，、;；|]+/), out = [], i;
    for (i = 0; i < a.length; i++) if (a[i] && out.indexOf(a[i]) < 0) out.push(a[i]);
    return out;
  }

  /* ---------------- 命中上下文 ---------------- */
  function snip(text, q, w) {
    var t = S(text), ts = terms(q);
    if (!t || !ts.length) return '';
    var lt = t.toLowerCase(), pos = -1, hitLen = 0, i;
    var whole = low(q).replace(/^\s+|\s+$/g, '');
    if (whole.length > 1) { pos = lt.indexOf(whole); if (pos >= 0) hitLen = whole.length; }
    if (pos < 0) {
      for (i = 0; i < ts.length; i++) {
        var p = lt.indexOf(ts[i]);
        if (p >= 0 && (pos < 0 || p < pos)) { pos = p; hitLen = ts[i].length; }
      }
    }
    if (pos < 0) return '';
    var ww = w || SNIP_W;
    var a = Math.max(0, pos - ww), b = Math.min(t.length, pos + hitLen + ww);
    return {
      pre: (a > 0 ? '…' : '') + t.slice(a, pos),
      hit: t.slice(pos, pos + hitLen),
      post: t.slice(pos + hitLen, b) + (b < t.length ? '…' : '')
    };
  }
  function snipText(text, q, w) {
    var s = snip(text, q, w);
    return s ? (s.pre + s.hit + s.post) : '';
  }

  /* 长文本切段：按句末标点 / 换行切，过短的往后合并（写法兼容老内核，不用后行断言） */
  function segs(text) {
    var t = S(text).replace(/\r/g, '');
    if (!t) return [];
    if (t.length <= SEG_MIN) return [t];
    var marked = t.replace(/([。！？；!?;]|\n)/g, '$1\u0001');
    var parts = marked.split('\u0001');
    var out = [], buf = '', i;
    for (i = 0; i < parts.length; i++) {
      buf += parts[i];
      if (buf.length >= SEG_MIN) { out.push(buf); buf = ''; }
    }
    if (buf) { if (out.length) out[out.length - 1] += buf; else out.push(buf); }
    return out.length ? out : [t];
  }

  /* ---------------- 内置语料（懒构建，只做一次） ---------------- */
  var _corpus = null;

  function push(list, item) { if (item && (S(item.text).trim() || S(item.keys).trim())) list.push(item); }

  function buildCorpus() {
    var out = [], i, j;
    var W = window;

    /* ① 词典 */
    var GL = W.SITE_GLOSSARY || [];
    for (i = 0; i < GL.length; i++) {
      var g = GL[i] || {};
      var alias = (g.alias && g.alias.join) ? g.alias.join(' ') : S(g.alias);
      var confuse = '';
      if (g.confuse && g.confuse.length) {
        for (j = 0; j < g.confuse.length; j++) {
          var cf = g.confuse[j] || {};
          confuse += ' ' + S(cf.t) + ' ' + S(cf.d);
        }
      }
      push(out, {
        cat: '词典', t: S(g.term), keys: S(g.term) + ' ' + alias,
        text: S(g.dic) + (g.from ? ' 出自' + S(g.from) : '') + ' ' + S(g.note) + confuse,
        sub: S(g.group)
      });
    }

    /* ② 概念 */
    var CN = (W.SITE_CONCEPTS && W.SITE_CONCEPTS.nodes) || [];
    for (i = 0; i < CN.length; i++) {
      var c = CN[i] || {};
      if (c.type && c.type !== 'concept') continue;
      push(out, {
        cat: '概念', t: S(c.name), keys: S(c.name),
        text: S(c.role) + ' ' + S(c.desc) + ' ' + ((c.points || []).join ? c.points.join(' ') : ''),
        sub: S(c.role)
      });
    }

    /* ③ 导读 */
    var GD = W.SITE_GUIDES || [];
    for (i = 0; i < GD.length; i++) {
      var d = GD[i] || {}, secs = '';
      if (d.sections && d.sections.length) {
        for (j = 0; j < d.sections.length; j++) {
          var sc2 = d.sections[j] || {};
          secs += ' ' + S(sc2.h) + ' ' + S(sc2.hint) + ' ' + S(sc2.bg || '');
        }
      }
      push(out, {
        cat: '导读', t: S(d.book), keys: S(d.book) + ' ' + S(d.author),
        text: S(d.ask) + secs, sub: (S(d.year) ? d.year + ' · ' : '') + S(d.level)
      });
    }

    /* ④ 答疑 */
    var AN = W.SITE_ANSWERS || {}, groups = AN.groups || [];
    for (i = 0; i < groups.length; i++) {
      var g2 = groups[i] || {}, items = g2.items || [];
      for (j = 0; j < items.length; j++) {
        var it = items[j] || {};
        push(out, {
          cat: '答疑', t: S(it.q).slice(0, 40), keys: S(it.q),
          text: S(it.a) + ' ' + S(it.why) + ' ' + S(it.basis) + ' ' + ((it.refs || []).join ? it.refs.join(' ') : ''),
          sub: S(g2.name || g2.title)
        });
      }
    }

    /* ⑤ 书库简介 / 提要 */
    var RES = W.SITE_RESOURCES || [];
    for (i = 0; i < RES.length; i++) {
      var r = RES[i] || {};
      push(out, {
        cat: '书库', t: S(r.title), keys: S(r.title) + ' ' + S(r.author),
        text: S(r.intro) + ' ' + S(r.desc) + ' ' + S(r.note), sub: S(r.author),
        resIndex: i
      });
    }

    /* ⑥ 史料正文（人物 / 事件 / 辟谣 / 思潮） */
    var CT = W.SITE_CONTENT || {}, EX = W.SITE_EXTRA || {};
    var ppl = [].concat(CT.leaders || [], CT.comrades || [], CT.figures || [], EX.critics || []);
    for (i = 0; i < ppl.length; i++) {
      var p = ppl[i] || {};
      var pw = p.works && p.works.join ? p.works.join(' ') : S(p.works);
      push(out, {
        cat: '史料', t: S(p.name), keys: S(p.name),
        text: S(p.intro) + ' ' + S(p.desc) + ' ' + S(p.role) + ' ' + pw, sub: S(p.role || p.years)
      });
    }
    var EV = EX.events || [];
    for (i = 0; i < EV.length; i++) {
      var e = EV[i] || {};
      push(out, { cat: '史料', t: S(e.year) + ' ' + S(e.name), keys: S(e.name), text: S(e.desc), sub: '' });
    }
    var DK = EX.debunks || [];
    for (i = 0; i < DK.length; i++) {
      var b = DK[i] || {};
      push(out, { cat: '史料', t: '辟谣 · ' + S(b.title), keys: S(b.title), text: S(b.q) + ' ' + S(b.a), sub: '' });
    }
    var SC = EX.schools || [];
    for (i = 0; i < SC.length; i++) {
      var s2 = SC[i] || {}, sit = s2.items || [];
      for (j = 0; j < sit.length; j++) {
        var si = sit[j] || {};
        var sw = si.works && si.works.join ? si.works.join(' ') : S(si.works);
        var sp = si.people && si.people.join ? si.people.join(' ') : S(si.people);
        var so = si.opposed && si.opposed.join ? si.opposed.join(' ') : S(si.opposed);
        push(out, {
          cat: '史料', t: S(si.name), keys: S(si.name),
          text: S(si.desc) + ' ' + S(si.meta) + ' ' + sw + ' ' + sp + ' ' + so, sub: S(si.meta)
        });
      }
    }

    /* 段落化：每段独立成块，记住来源索引（点开用） */
    var flat = [], chars = 0;
    for (i = 0; i < out.length; i++) {
      var it0 = out[i], ss = segs(it0.text), k;
      if (!ss.length) ss = [''];
      for (k = 0; k < ss.length; k++) {
        var segText = String(ss[k] || '').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
        if (!segText) continue;
        flat.push({
          cat: it0.cat, t: it0.t, keys: it0.keys, text: segText,
          /* 小写副本预先算好：搜索时每段都要比对，重复 toLowerCase 是大头开销 */
          _lk: low(it0.keys), _lt: low(segText),
          sub: it0.sub, resIndex: it0.resIndex == null ? -1 : it0.resIndex, src: it0
        });
        chars += segText.length;
      }
      chars += S(it0.keys).length;
    }
    return { segs: flat, chars: chars };
  }

  function corpus() {
    if (!_corpus) {
      var _tB = (window.__YZTiming ? window.__YZTiming.now() : 0);
      try { _corpus = buildCorpus(); } catch (e) { _corpus = { segs: [], chars: 0 }; }
      try { if (window.__YZTiming) { window.__YZTiming.span('ftIndex', _tB); window.__YZTiming.m.ftSegs = _corpus.segs.length; window.__YZTiming.m.ftChars = _corpus.chars || 0; } } catch (e) {}
    }
    return _corpus;
  }

  /* ---------------- 段落级检索 ---------------- */
  function scoreOf(seg, ts, q) {
    var kt = seg._lk != null ? seg._lk : low(seg.keys);
    var tx = seg._lt != null ? seg._lt : low(seg.text);
    var score = 0, i;
    for (i = 0; i < ts.length; i++) {
      var inKey = kt.indexOf(ts[i]) >= 0, inTx = tx.indexOf(ts[i]) >= 0;
      if (!inKey && !inTx) return -1;                 /* AND：有一个词没出现就不算 */
      if (inKey) score += 100;
      if (inTx) {
        var p = tx.indexOf(ts[i]), n = 0;
        while (p >= 0 && n < 40) { n++; p = tx.indexOf(ts[i], p + ts[i].length); }
        score += 5 + Math.min(n, 20) * 3;
      }
    }
    var whole = low(q).replace(/^\s+|\s+$/g, '');
    if (whole && kt.indexOf(whole) >= 0) score += 60;
    return score;
  }

  function search(q) {
    var ts = terms(q);
    if (!ts.length) return [];
    var C = corpus(), out = [], seen = {}, i;
    for (i = 0; i < C.segs.length; i++) {
      var seg = C.segs[i];
      var sc = scoreOf(seg, ts, q);
      if (sc < 0) continue;
      var key = seg.cat + '|' + seg.t;
      var sp = snipText(seg.text, q, SNIP_W) || snipText(seg.keys, q, SNIP_W);
      var cand = { cat: seg.cat, t: seg.t, sub: sp || seg.sub, snip: sp, idx: i, score: sc, _k: key };
      var old = seen[key];
      if (!old) { seen[key] = cand; out.push(cand); }
      else if (sc > old.score) { old.score = sc; old.sub = cand.sub; old.snip = cand.snip; old.idx = i; }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    /* 每类限量，避免书库正文把词典 / 概念挤掉 */
    var per = {}, kept = [];
    for (i = 0; i < out.length; i++) {
      var o = out[i];
      per[o.cat] = (per[o.cat] || 0) + 1;
      if (per[o.cat] > 8) continue;
      o.fn = 'yzftShow(' + o.idx + ')';
      kept.push(o);
      if (kept.length >= 30) break;
    }
    return kept;
  }

  /* 点开一条命中：把该来源的所有段落（或书库提要）铺开显示 */
  function show(idx) {
    var C = corpus(), seg = C.segs[idx];
    if (!seg) { if (window.toast) toast('这条内容不在了'); return; }
    var src = seg.src || seg, list = [], i, n = 0;
    for (i = 0; i < C.segs.length; i++) {
      if (C.segs[i].src !== src) continue;
      if (!S(C.segs[i].text).trim()) continue;
      list.push('<p style="margin:0 0 10px;line-height:1.95;font-size:.9rem">' + esc(C.segs[i].text) + '</p>');
      if (++n >= 40) break;
    }
    var html = (src.sub ? '<p class="sub" style="margin:0 0 10px;opacity:.75">' + esc(src.sub) + '</p>' : '') +
      (list.length ? list.join('') : '<p class="sub">（这条只有标题，没有可展开的正文）</p>') +
      (src.cat === '书库' && src.resIndex >= 0
        ? '<div class="ops" style="margin-top:14px"><button class="go" onclick="openItemDetail(' + src.resIndex + ')">打开书目详情</button></div>'
        : '');
    if (window.openContent) openContent('🔎 ' + (src.cat || '') + ' · ' + S(src.t), html);
  }

  /* ---------------- 本机书正文（IndexedDB） ---------------- */
  var _local = null;
  var _db = null;

  function withDB(cb) {
    if (_db) return cb(_db);
    if (!window.indexedDB) return cb(null);
    try {
      var rq = window.indexedDB.open(LOCAL_DB, 1);
      rq.onupgradeneeded = function () { try { if (!rq.result.objectStoreNames.contains(LOCAL_STORE)) rq.result.createObjectStore(LOCAL_STORE); } catch (e) { } };
      rq.onsuccess = function () { _db = rq.result; cb(_db); };
      rq.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }

  /* 只读 books.js 的文件库，不写它的库 */
  function readBooks(cb) {
    var done = [];
    try {
      var meta = JSON.parse(localStorage.getItem('yzImportedBooks') || '[]');
      if (!meta || !meta.length) return cb([]);
      var rq = window.indexedDB.open('yz_books_v1', 1);
      rq.onupgradeneeded = function () { /* 库不存在时交给 books.js 去建，这里不建 */ };
      rq.onsuccess = function () {
        var d = rq.result, got = 0, total = meta.length, done2 = false;
        function fin() { if (done2) return; if (++got >= total) { done2 = true; cb(done); } }
        try {
          var tx = d.transaction('files', 'readonly'), st = tx.objectStore('files');
          meta.forEach(function (m) {
            try {
              var g = st.get(m.id);
              g.onsuccess = function () { done.push({ meta: m, blob: g.result || null }); fin(); };
              g.onerror = function () { fin(); };
            } catch (e) { fin(); }
          });
        } catch (e) { cb(done); }
      };
      rq.onerror = function () { cb([]); };
    } catch (e) { cb([]); }
  }

  function isTextLike(name) { return /\.(txt|md|markdown|text)$/i.test(S(name)); }

  function indexWeb(cb) {
    readBooks(function (list) {
      var out = [], pending = 0, total = 0, finished = false;
      withDB(function (d) {
        if (!d) { return isFn(cb) && cb([]); }
        var st = null;
        try { st = d.transaction(LOCAL_STORE, 'readonly').objectStore(LOCAL_STORE); } catch (e) { st = null; }
        if (!st) { return isFn(cb) && cb([]); }

        function fin() {
          if (--pending > 0) return;
          if (finished) return;
          finished = true;
          isFn(cb) && cb(out);
        }
        function build(x, id, m, fp) {
          var blob = x.blob;
          if (!blob || !blob.size) return fin();
          try {
            var fr = new FileReader();
            fr.onload = function () {
              var sgs = segs(S(fr.result).slice(0, 3000000));   /* 单本上限 300 万字，防爆内存 */
              out.push({ id: id, meta: m, segs: sgs });
              try {
                var tx = d.transaction(LOCAL_STORE, 'readwrite');
                tx.objectStore(LOCAL_STORE).put({ fp: fp, segs: sgs, t: Date.now() }, id);
                tx.oncomplete = fin; tx.onerror = fin;
              } catch (e) { fin(); }
            };
            fr.onerror = function () { fin(); };
            fr.readAsText(blob, 'utf-8');
          } catch (e) { fin(); }
        }

        list.forEach(function (x) {
          var m = x.meta || {}, id = m.id;
          if (!id || !isTextLike(m.name || m.title || '')) return;
          total++; pending++;
          var fp = S(m.size) + ':' + S(m.t) + ':' + S(m.name);
          var g;
          try { g = st.get(id); } catch (e) { pending--; return; }
          g.onsuccess = function () {
            var rec = g.result;
            if (rec && rec.fp === fp && rec.segs) { out.push({ id: id, meta: m, segs: rec.segs }); return fin(); }
            build(x, id, m, fp);
          };
          g.onerror = function () { fin(); };
        });
        if (!total) { isFn(cb) && cb([]); }
      });
    });
  }


  /* ---------------- App 侧导入的书（Java 私有目录） ----------------
     为什么单独一路：App 里导入的 EPUB / TXT / MD 存在应用私有目录，
     元数据在 AndroidApp.bookList()，正文只有 Java 取得到
     （EPUB 走 bookChapter(id,idx)，TXT/MD 走 bookTextUrl(id)）。
     网页侧 IndexedDB 里没有它们 —— 所以「App 里读得到、搜不到」。
     PDF 不进来：页是位图，没有文字层。 */

  function AndroidBridge() { try { return window.AndroidApp || null; } catch (e) { return null; } }

  function appBooks() {
    var a = AndroidBridge();
    if (!a || typeof a.bookList !== 'function') return [];
    var arr = [];
    try { arr = JSON.parse(a.bookList() || '[]') || []; } catch (e) { return []; }
    return arr.filter(function (b) {
      return b && b.id && (b.type === 'epub' || b.type === 'txt' || b.type === 'md');
    });
  }

  /* EPUB 章节是 HTML，去掉标签但保留段落边界，否则整章会粘成一坨搜不准 */
  function stripHTML(h) {
    return S(h)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&')
      .replace(/\n{3,}/g, '\n\n');
  }

  function appFp(m) { return S(m.size) + ':' + S(m.at) + ':' + S(m.name); }

  function saveAppIdx(d, key, rec, done) {
    try {
      var tx = d.transaction(LOCAL_STORE, 'readwrite');
      tx.objectStore(LOCAL_STORE).put(rec, key);
      tx.oncomplete = done; tx.onerror = done;
    } catch (e) { done(); }
  }

  /* 建一本的索引：TXT/MD 整篇取；EPUB 逐章取（分片，别把主线程堵死） */
  function buildApp(m, fp, d, done) {
    var a = AndroidBridge();
    if (!a) return done(null);

    if (m.type === 'txt' || m.type === 'md') {
      var url = '';
      try { url = a.bookTextUrl ? (a.bookTextUrl(m.id) || '') : ''; } catch (e) { url = ''; }
      if (!url) return done(null);
      fetch(url).then(function (r) { return r.ok ? r.text() : ''; }).then(function (txt) {
        var sgs = segs(S(txt).slice(0, 3000000));
        if (!sgs.length) return done(null);
        var rec = { fp: fp, segs: sgs, chapOf: null, t: Date.now() };
        saveAppIdx(d, 'app:' + m.id, rec, function () {
          done({ id: m.id, meta: m, segs: sgs, chapOf: null, from: 'app' });
        });
      }).catch(function () { done(null); });
      return;
    }

    /* EPUB */
    var n = (m.chapters && m.chapters.length) ? m.chapters.length : (m.count || 0);
    if (!n) return done(null);
    var all = [], chapOf = [], ci = 0, CHUNK = 3, stopped = false;
    function step() {
      if (stopped) return;
      var end = Math.min(n, ci + CHUNK), k, j;
      try {
        for (k = ci; k < end; k++) {
          var h = '';
          try { h = a.bookChapter ? (a.bookChapter(m.id, k) || '') : ''; } catch (e) { h = ''; }
          var txt = stripHTML(h).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
          if (!txt) continue;
          var sgs = segs(txt.slice(0, 200000));
          for (j = 0; j < sgs.length; j++) { all.push(sgs[j]); chapOf.push(k); }
          /* 上限保护：单本最多 2 万段，超了就不再往后读 */
          if (all.length >= 20000) { stopped = true; break; }
        }
      } catch (e) { }
      ci = end;
      if (stopped || ci >= n) {
        if (!all.length) return done(null);
        var rec = { fp: fp, segs: all, chapOf: chapOf, t: Date.now() };
        return saveAppIdx(d, 'app:' + m.id, rec, function () {
          done({ id: m.id, meta: m, segs: all, chapOf: chapOf, from: 'app' });
        });
      }
      setTimeout(step, 12);      /* 让出主线程，滚动/点击不卡 */
    }
    step();
  }

  var _app = null, _appBusy = false, _appWait = [];
  function indexApp(cb) {
    if (_app) return isFn(cb) && cb(_app);
    if (isFn(cb)) _appWait.push(cb);
    if (_appBusy) return;
    _appBusy = true;

    var books = appBooks();
    if (!books.length) { _app = []; _appBusy = false; return flushApp(); }

    withDB(function (d) {
      if (!d) { _app = []; _appBusy = false; return flushApp(); }
      var st = null;
      try { st = d.transaction(LOCAL_STORE, 'readonly').objectStore(LOCAL_STORE); } catch (e) { st = null; }
      if (!st) { _app = []; _appBusy = false; return flushApp(); }

      var out = [], pending = books.length, finished = false;
      function fin() {
        if (--pending > 0 || finished) return;
        finished = true;
        _app = out; _appBusy = false; flushApp();
      }
      books.forEach(function (m) {
        var key = 'app:' + m.id, fp = appFp(m), g;
        try { g = st.get(key); } catch (e) { return fin(); }
        g.onsuccess = function () {
          var rec = g.result;
          if (rec && rec.fp === fp && rec.segs) {
            out.push({ id: m.id, meta: m, segs: rec.segs, chapOf: rec.chapOf || null, from: 'app' });
            return fin();
          }
          buildApp(m, fp, d, function (item) { if (item) out.push(item); fin(); });
        };
        g.onerror = function () { fin(); };
      });
    });
  }
  function flushApp() {
    var w = _appWait; _appWait = [];
    for (var i = 0; i < w.length; i++) { try { w[i](_app || []); } catch (e) { } }
  }

  /* 对外：合并「网页侧 TXT/MD」+「App 侧导入的书」 */
  function indexLocal(cb) {
    if (_local) return isFn(cb) && cb(_local);
    indexWeb(function (web) {
      indexApp(function (app) {
        _local = (web || []).concat(app || []);
        isFn(cb) && cb(_local);
      });
    });
  }

  /* 后台预热：页面空闲时开始建索引，用户真去搜的时候基本已经好了 */
  function warmApp(delay) {
    setTimeout(function () {
      try {
        if (!appBooks().length) return;
        indexApp(function () { });
      } catch (e) { }
    }, delay || 3000);
  }

  function searchLocal(q, cb) {
    var ts = terms(q);
    if (!ts.length) return isFn(cb) && cb([]);
    indexLocal(function (list) {
      var out = [];
      (list || []).forEach(function (bk) {
        var best = null, bestScore = -1, hits = 0, i, k, bestIdx = -1;
        var sgs = bk.segs || [];
        for (i = 0; i < sgs.length; i++) {
          var tx = low(sgs[i]), ok = true, sc = 0;
          for (k = 0; k < ts.length; k++) {
            if (tx.indexOf(ts[k]) < 0) { ok = false; break; }
            sc += 10;
          }
          if (!ok) continue;
          hits++;
          if (sc > bestScore) { bestScore = sc; best = sgs[i]; bestIdx = i; }
        }
        if (!best) return;
        var m = bk.meta || {};
        var chap = (bk.chapOf && typeof bk.chapOf[bestIdx] === 'number') ? bk.chapOf[bestIdx] : null;
        out.push({
          cat: bk.from === 'app' ? '本机正文' : '本机正文',
          t: S(m.title || m.name || '未命名'),
          sub: snipText(best, q, SNIP_W) || S(best).slice(0, 60),
          snip: snipText(best, q, SNIP_W),
          fn: 'yzftLocal(\'' + esc(S(bk.id)) + '\')',
          score: (bk.from === 'app' ? 54 : 50) + Math.min(hits, 20), hits: hits,
          id: S(bk.id), app: bk.from === 'app', chap: chap,
          chapTitle: (chap !== null && m.chapters && m.chapters[chap]) ? S(m.chapters[chap].title || '') : ''
        });
      });
      out.sort(function (a, b) { return b.score - a.score; });
      isFn(cb) && cb(out.slice(0, MAX_LOCAL_HIT));
    });
  }

  /* 点开本机书命中：列出命中段落（不整本渲染，太重） */
  function showLocal(id, q) {
    indexLocal(function (list) {
      var bk = null, i;
      for (i = 0; i < (list || []).length; i++) if (S(list[i].id) === S(id)) { bk = list[i]; break; }
      if (!bk) { if (window.toast) toast('这本不在本机了'); return; }
      var ts = terms(q || ''), picked = [], segs2 = bk.segs || [];
      for (i = 0; i < segs2.length && picked.length < 60; i++) {
        var tx = low(segs2[i]), ok = ts.length ? true : false;
        for (var k = 0; k < ts.length; k++) if (tx.indexOf(ts[k]) < 0) { ok = false; break; }
        if (ok) picked.push(segs2[i]);
      }
      if (!picked.length) picked = segs2.slice(0, 6);
      var m = bk.meta || {};
      var html = '<p class="sub" style="margin:0 0 10px;opacity:.75">' + esc(S(m.author || '')) +
        ' · 共 ' + segs2.length + ' 段' + (q ? ' · 命中 ' + picked.length + ' 段' : '') + '</p>' +
        picked.map(function (t) {
          var s = q ? snip(t, q, 80) : null;
          return '<p style="margin:0 0 12px;line-height:1.95;font-size:.88rem">' +
            (s ? esc(s.pre) + '<mark style="background:rgba(255,200,0,.35);color:inherit">' + esc(s.hit) + '</mark>' + esc(s.post) : esc(t)) +
            '</p>';
        }).join('');
      if (window.openContent) openContent('📖 ' + S(m.title || m.name || '本机书'), html);
    });
  }

  function stats() {
    var C = corpus(), ln = 0, ls = 0, i, an = 0, as = 0;
    if (_local) {
      ln = _local.length;
      for (i = 0; i < _local.length; i++) {
        ls += (_local[i].segs || []).length;
        if (_local[i].from === 'app') { an++; as += (_local[i].segs || []).length; }
      }
    }
    return {
      seg: C.segs.length, chars: C.chars,
      local: { books: ln, segs: ls },
      app: { books: an, segs: as, available: appBooks().length, busy: _appBusy }
    };
  }

  /* ---------------- 站内正文（讲堂 books/*.txt）检索 ----------------
     索引由 gen_jtfull.py 预生成（data/jtfull.js，约 370 KB / 27 篇 / 1500+ 段），
     懒加载：首屏不下载，第一次搜正文时才拉一次，之后常驻内存。
     命中给段落序号，点开直接滚到那一句（阅读器 [data-i] 与索引同一切段规则）。 */
  var _jt = null, _jtLoading = false, _jtQ = [];
  function loadJT(cb) {
    if (_jt) { if (isFn(cb)) cb(_jt); return; }
    if (isFn(cb)) _jtQ.push(cb);
    if (_jtLoading) return;
    _jtLoading = true;
    function done(list) {
      _jt = list || []; _jtLoading = false;
      var q = _jtQ.slice(); _jtQ = [];
      for (var i = 0; i < q.length; i++) { try { q[i](_jt); } catch (e) { } }
    }
    try {
      var s = document.createElement('script');
      s.src = 'data/jtfull.js';
      s.async = true;
      s.onload = function () { done(window.JT_FULL); };
      s.onerror = function () { done([]); };
      document.head.appendChild(s);
    } catch (e) { done([]); }
  }
  function searchStation(q, cb) {
    loadJT(function (list) {
      var ts = terms(q), out = [], i, j, k;
      if (!ts.length || !list.length) { cb(out); return; }
      for (i = 0; i < list.length; i++) {
        var b = list[i], hit = -1, hits = 0, first = '';
        for (j = 0; j < b.t.length; j++) {
          var low = String(b.t[j]).toLowerCase(), ok = true;
          for (k = 0; k < ts.length; k++) { if (low.indexOf(ts[k]) < 0) { ok = false; break; } }
          if (ok) { hits++; if (hit < 0) { hit = j; first = b.t[j]; } }
        }
        if (hit < 0) continue;
        out.push({
          cat: '讲堂正文', t: b.title, id: b.id, url: b.url, para: hit, hits: hits,
          sub: String(first).replace(/\s+/g, ' ').slice(0, 90), score: 100 + hits
        });
      }
      out.sort(function (a, b) { return b.hits - a.hits; });
      cb(out.slice(0, 12));
    });
  }

  window.YZFULLTEXT = {
    snip: snip, snipText: snipText, segs: segs,
    searchStation: searchStation, preloadStation: function () { loadJT(function () { }); },
    /* 给「引文比对」用：暴露全部段落（含 text / cat / t / resIndex），只读不改 */
    all: function () { try { return corpus().segs || []; } catch (e) { return []; } },
    search: search, searchLocal: searchLocal, indexLocal: indexLocal, stats: stats,
    indexApp: indexApp, warmApp: warmApp,
    show: show, showLocal: showLocal,
    _reset: function () { _corpus = null; _local = null; }
  };
  window.yzftShow = function (i) { show(i); };
  window.yzftLocal = function (id) {
    var q = '';
    try { q = (window.__yzftQ || ''); } catch (e) { }
    showLocal(id, q);
  };
})();
