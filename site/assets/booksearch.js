/* =====================================================================
   学通 · 书库检索（问一问用）
   ---------------------------------------------------------------------
   数据来源（只读本机已有数据，不联网）：
     · window.SITE_RESOURCES —— 322 条书库条目（title/author/cat/intro/
       publisher/pubyear/fmt/src/url/alias）
     · window.SITE_CONTENT.quotes —— 经典引文 → 反查出自哪本书

   为什么单独成文件：qa-engine.js 是「图谱推理」，这里是「书库检索」，
   两套数据两套算法，混在一起会让图谱引擎的体积和职责都失控。

   对外：window.YZBOOK = { tryAnswer, search, stats, get }
     tryAnswer(q) 返回 null 表示「这不是书库问题」，交回图谱引擎。
   ===================================================================== */
(function () {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[《》〈〉「」『』【】"'’‘“”`]/g, '')
      .replace(/[\s,，、。.！!？?：:；;（）()\[\]\-—_·…~]/g, '')
      .toLowerCase();
  }
  /* 书名主体：去掉「（1至4卷）」这类补充 */
  function core(t) {
    return String(t || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[《》〈〉]/g, '').trim();
  }

  var IDX = null;
  function load() {
    if (IDX) return IDX;
    var B = Array.isArray(window.SITE_RESOURCES) ? window.SITE_RESOURCES : [];
    IDX = [];
    B.forEach(function (r) {
      if (!r || !r.title) return;
      IDX.push({
        r: r,
        k1: norm(core(r.title)),      /* 主体名 */
        k2: norm(r.title),            /* 全名 */
        al: String(r.alias || '').toLowerCase()
      });
    });
    return IDX;
  }

  function get(id) {
    var idx = load();
    for (var i = 0; i < idx.length; i++) if (idx[i].r.id === id) return idx[i].r;
    return null;
  }

  /* ---------- 书名匹配 ---------- */
  function matchBooks(qn) {
    var idx = load(), out = [];
    idx.forEach(function (it) {
      var score = 0;
      if (it.k2 && it.k2.length >= 3 && qn.indexOf(it.k2) >= 0) score = it.k2.length + 2;
      else if (it.k1 && it.k1.length >= 3 && qn.indexOf(it.k1) >= 0) score = it.k1.length;
      else if (it.al) {
        var toks = it.al.split(/\s+/);
        for (var i = 0; i < toks.length; i++) {
          var t = norm(toks[i]);
          if (t.length >= 4 && qn.indexOf(t) >= 0) { score = 3; break; }
        }
      }
      if (score) out.push({ r: it.r, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* ---------- 引文反查：出自哪本书 ---------- */
  function matchQuote(qn) {
    var Q = (window.SITE_CONTENT && window.SITE_CONTENT.quotes) || [];
    for (var i = 0; i < Q.length; i++) {
      var t = norm(Q[i].t || '');
      if (!t) continue;
      /* 用户往往只引一句；用 10 字滑窗判断是否被引用 */
      if (t.length <= 14 ? qn.indexOf(t) >= 0 : (function () {
        for (var k = 0; k + 10 <= t.length; k += 3) {
          if (qn.indexOf(t.slice(k, k + 10)) >= 0) return true;
        }
        return false;
      })()) return Q[i];
    }
    return null;
  }

  /* 文本里提到的书名（用于书单条目）→ 反查书库条目 */
  function findByMention(text) {
    var t = norm(text), best = null, bestLen = 0;
    load().forEach(function (it) {
      if (!it.k1 || it.k1.length < 3) return;
      if (t.indexOf(it.k1) >= 0 && it.k1.length > bestLen) { best = it.r; bestLen = it.k1.length; }
    });
    return best;
  }

  /* ---------- 一本书的说明书 ---------- */
  function bookLine(r) {
    var bits = [];
    if (r.cat) bits.push(r.cat);
    if (r.author) bits.push(r.author);
    return '《' + r.title + '》' + (bits.length ? '（' + bits.join(' · ') + '）' : '');
  }
  function pubLine(r) {
    var b = [];
    if (r.publisher) b.push(r.publisher);
    if (r.pubyear && r.pubyear !== '—' && r.pubyear !== '-') b.push(r.pubyear + '年');
    if (r.translator) b.push(r.translator + ' 译');
    return b.join(' · ');
  }
  function availLine(r) {
    var noFile = (!r.url || r.url === '#');
    if (noFile) {
      return '本站不存放该书文件' + (r.src ? '（来源：' + r.src + '）' : '') +
        '，可在浏览器按书名检索获取。';
    }
    return '本站可读' + (r.fmt && r.fmt !== '—' ? '（' + r.fmt + '）' : '') +
      (r.src ? '，来源：' + r.src : '') + '。';
  }
  function toBook(r, sub) {
    return {
      id: r.id,
      title: r.title,
      sub: sub || [r.cat, r.author, r.fmt && r.fmt !== '—' ? r.fmt : ''].filter(Boolean).join(' · '),
      href: 'index.html#/r/' + encodeURIComponent(r.id)
    };
  }

  /* ---------- 单本回答 ---------- */
  function answerOne(r, q) {
    var res = { ok: true, intent: 'book', answer: '', notes: [], evidence: [], books: [] };
    var lines = [];
    lines.push(bookLine(r));
    var pub = pubLine(r);
    if (pub) lines.push('出版：' + pub);
    if (r.desc) lines.push(r.desc);
    if (r.intro) lines.push(r.intro);
    lines.push(availLine(r));
    if (r.note) res.notes.push(r.note);
    if (r.sourceNote) res.notes.push(r.sourceNote);
    res.answer = lines.join('\n');
    res.books.push(toBook(r));
    /* 同一作者的其他书，顺带给 3 本，便于继续找 */
    if (r.author) {
      var sib = load().filter(function (it) {
        return it.r.author === r.author && it.r.id !== r.id;
      }).slice(0, 3);
      if (sib.length) {
        res.notes.push('同作者还有：' + sib.map(function (it) { return '《' + it.r.title + '》'; }).join('、') + '（下方可直接打开）');
        sib.forEach(function (it) { res.books.push(toBook(it.r)); });
      }
    }
    res.evidence = [{ from: '书库', rel: '收录', to: r.title }];
    return res;
  }

  /* ---------- 多本回答 ---------- */
  function answerMany(hits, q) {
    var res = { ok: true, intent: 'book', answer: '', notes: [], evidence: [], books: [] };
    var top = hits.slice(0, 8).map(function (h) { return h.r; });
    res.answer = '书库里有 ' + hits.length + ' 条相关：' + top.map(function (r) { return '《' + r.title + '》'; }).join('、') +
      (hits.length > top.length ? ' 等' : '') + '。\n点下方条目可直接打开详情。';
    top.forEach(function (r) { res.books.push(toBook(r)); });
    res.evidence = top.map(function (r) { return { from: '书库', rel: '收录', to: r.title }; });
    return res;
  }

  /* ---------- 「有哪些书 / 推荐几本」 ---------- */
  function answerList(q, qn) {
    var idx = load();

    /* 3.0 「推荐 / 入门 / 书单」→ 用站点自带的分阶段书单（与导读书单同源） */
    if (/推荐|入门|书单|读什么|怎么读|先读/.test(q)) {
      var RL = (window.SITE_CONTENT && window.SITE_CONTENT.readlist) || [];
      if (RL.length) {
        var res0 = { ok: true, intent: 'booklist', answer: '', notes: [], evidence: [], books: [] };
        var lines = ['按阅读阶段推荐（与站点「阅读清单」同源）：'];
        RL.forEach(function (stage) {
          lines.push('');
          lines.push(stage.stage || '');
          (stage.items || []).forEach(function (it) {
            var t = String(it.t || '');
            lines.push('· ' + t + (it.n || ''));
            var r = findByMention(t);
            if (r && res0.books.length < 12) {
              var dup = res0.books.some(function (b) { return b.id === r.id; });
              if (!dup) res0.books.push(toBook(r));
            }
          });
        });
        res0.answer = lines.join('\n');
        res0.notes.push('书单里的书名，能在书库检索到的已列在下方，可直接打开。');
        return res0;
      }
    }

    var cats = {};
    idx.forEach(function (it) { var c = it.r.cat || '其他'; cats[c] = (cats[c] || 0) + 1; });
    var catName = ['原著', '导读', '词典', '参考', '对公文献', '有声书', '讲堂', '影像', '歌曲', '工具', '当代']
      .filter(function (c) { return cats[c]; });
    var res = { ok: true, intent: 'booklist', answer: '', notes: [], evidence: [], books: [] };

    /* 指定了分类 → 列该分类前 8 本 */
    var wantCat = null;
    catName.forEach(function (c) { if (qn.indexOf(norm(c)) >= 0) wantCat = c; });
    if (!wantCat && /原著|经典/.test(q)) wantCat = '原著';
    if (!wantCat && /导读|解读/.test(q)) wantCat = '导读';
    if (!wantCat && /词典|辞书/.test(q)) wantCat = '词典';

    if (wantCat) {
      var list = idx.filter(function (it) { return it.r.cat === wantCat; }).slice(0, 10);
      res.answer = '书库「' + wantCat + '」共 ' + cats[wantCat] + ' 条，先列前 ' + list.length + ' 条：\n' +
        list.map(function (it, i) { return (i + 1) + '. ' + bookLine(it.r); }).join('\n');
      list.forEach(function (it) { res.books.push(toBook(it.r)); });
      return res;
    }

    res.answer = '书库共 ' + idx.length + ' 条，按类别分：\n' +
      catName.map(function (c) { return '· ' + c + ' ' + cats[c] + ' 条'; }).join('\n') +
      '\n问「有哪些原著」「推荐入门读物」这样的问题，可以直接列出来。';
    res.notes.push('要查看全部，在首页搜索框输入书名或作者。');
    return res;
  }

  /* ---------- 引文回答 ---------- */
  function answerQuote(qt) {
    var res = { ok: true, intent: 'quote', answer: '', notes: [], evidence: [], books: [] };
    var srcName = String(qt.s || '').replace(/[《》]/g, '');
    res.answer = '「' + qt.t + '」\n—— ' + (qt.a || '') + '《' + srcName + '》';
    var hits = matchBooks(norm(srcName));
    if (hits.length) {
      res.books.push(toBook(hits[0].r, [hits[0].r.cat, hits[0].r.author].filter(Boolean).join(' · ')));
      res.notes.push('这句话出自书库收录的《' + hits[0].r.title + '》，下方可直接打开。');
    } else {
      res.notes.push('书库未收录该书全文，仅登记了这条引文。');
    }
    res.evidence = [{ from: qt.a || '马克思', rel: '原话', to: srcName }];
    return res;
  }

  /* ---------- 入口 ---------- */
  function tryAnswer(raw) {
    var q = String(raw || '').trim();
    if (!q) return null;
    var qn = norm(q);

    /* 1. 引文反查（最具体，先判） */
    var qt = matchQuote(qn);
    if (qt) return answerQuote(qt);

    /* 2. 书名命中 */
    var hits = matchBooks(qn);
    if (hits.length === 1) return answerOne(hits[0].r, q);
    if (hits.length > 1) {
      /* 全名精确命中的优先，其余视为相关 */
      var exact = hits.filter(function (h) { return h.score > h.r.title.length; });
      if (exact.length === 1) return answerOne(exact[0].r, q);
      return answerMany(hits, q);
    }

    /* 3. 泛问「有哪些书」 */
    if (/(有哪些|有什么|推荐|列一下|书单).{0,8}(书|著作|原著|文献|读物)/.test(q) ||
        /(原著|导读|词典).{0,4}(有哪些|有什么|清单|推荐)/.test(q) ||
        /读书|读什么|入门读物/.test(q)) {
      return answerList(q, qn);
    }

    /* 4. 问「某本书」但书名没对上 —— 不接管，交回图谱引擎 */
    return null;
  }

  function search(q) {
    var qn = norm(q);
    if (!qn) return [];
    return load().filter(function (it) {
      return it.k1.indexOf(qn) >= 0 || it.k2.indexOf(qn) >= 0 ||
        norm(it.r.author).indexOf(qn) >= 0 || norm(it.r.intro).indexOf(qn) >= 0;
    }).map(function (it) { return it.r; });
  }

  function stats() {
    var idx = load(), cats = {};
    idx.forEach(function (it) { var c = it.r.cat || '其他'; cats[c] = (cats[c] || 0) + 1; });
    return { total: idx.length, cats: cats, withFile: idx.filter(function (it) { return it.r.url && it.r.url !== '#'; }).length };
  }

  window.YZBOOK = { tryAnswer: tryAnswer, search: search, stats: stats, get: get };
})();
