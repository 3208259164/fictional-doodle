/* =====================================================================
   学通 · 问题专题（topics.js）
   ---------------------------------------------------------------------
   为什么有这个东西：书库 456 条、图谱 200+ 节点，是按「类型」摆的
   （书 / 人 / 事 / 词）。但人想问题是按「问题」想的——
   「国家是什么」「苏联为什么变修」这类问题，现在只能搜到零散条目。

   本文件不新增任何原文，只做聚合：一段导言 + 几条原文摘录 + 相关书目
   + 相关术语/人物。点开书单直接跳书目详情，点术语跳术语卡。

   增补专题：往 TOPICS 里加一条即可（books/terms/people 用书名与名称片段
   匹配现有数据，写错也不会全崩，只是那一项不显示）。
   ===================================================================== */
(function () {
  'use strict';

  var TOPICS = [
    {
      id: 'guojia',
      name: '国家是什么',
      sub: '从起源到消亡：马克思主义国家学说的最小闭环',
      icon: '🏛️',
      lead: '国家不是从来就有的。氏族社会没有国家，也不需要国家；国家是阶级矛盾不可调和的产物，是一个阶级压迫另一个阶级的机关。它由「特殊的武装队伍、监狱等」构成，而不是靠道德或契约维持。由此引出两个直接结论：一，无产阶级不能简单地掌握现成的国家机器，必须打碎它；二，国家最终会「自行消亡」，但那是在阶级消灭之后，而不是靠宣布废除。这一条线索从恩格斯的《家庭、私有制和国家的起源》一路写到列宁的《国家与革命》，再到毛泽东的《论人民民主专政》，是本库最基础的一组文本。',
      quotes: [
        { t: '国家是阶级矛盾不可调和的产物和表现。在阶级矛盾客观上达到不能调和的地方、时候和程度，便产生国家。', src: '列宁《国家与革命》第一章' },
        { t: '工人阶级不能简单地掌握现成的国家机器，并运用它来达到自己的目的。', src: '马克思《法兰西内战》' },
        { t: '无产阶级专政不是阶级斗争的结束，而是阶级斗争在新形式中的继续。', src: '列宁《无产阶级专政时代的经济和政治》' },
        { t: '革命的中心任务和最高形式是武装夺取政权，是战争解决问题。', src: '毛泽东《战争和战略问题》' }
      ],
      books: ['国家与革命', '法兰西内战', '家庭、私有制和国家的起源', '论人民民主专政', '无产阶级专政时代的经济和政治', '马克思主义和修正主义', '论粮食税', '国家与革命'],
      terms: ['国家', '无产阶级专政', '国家消亡', '暴力革命', '民主'],
      people: ['列宁', '恩格斯', '马克思', '毛泽东']
    },
    {
      id: 'ussr',
      name: '苏联为什么变修',
      sub: '从十月革命到解体：一个社会主义国家的变质过程',
      icon: '❄️',
      lead: '苏联的变质不是某一天发生的，也不是「被外部推翻」的。它的线索埋在三个地方：经济上，商品货币关系没有受到限制反而不断扩大；政治上，党的机关从选举产生变成任命制，官僚集团逐步固化；理论上，从赫鲁晓夫「全民国家、全民党」开始，无产阶级专政被悄悄抽掉。1963—1964 年的九评把这套判断系统化，认为苏联已经变成「没有资本家的资产阶级国家」。这个过程可以按文件顺序读下来：列宁晚年的警告、斯大林时期的争论、赫鲁晓夫的报告与纲领、中苏论战的文本、直到 1991 年的结局。',
      quotes: [
        { t: '苏联的资本主义复辟，是从赫鲁晓夫修正主义集团篡夺党政领导权开始的。', src: '《评苏共中央的公开信》（九评）' },
        { t: '所谓「全民国家」「全民党」，就是取消无产阶级专政、改变党的无产阶级性质。', src: '同上' },
        { t: '在社会主义制度下，价值规律仍然发生作用，但它的作用范围受到限制。', src: '斯大林《苏联社会主义经济问题》' }
      ],
      books: ['苏联社会主义经济问题', '评苏共中央的公开信（九评）', '关于国际共产主义运动总路线的建议（二十五条）', '论联共（布）党内的右倾', '给代表大会的信', '苏联是怎样蜕变为社会帝国主义国家的', '资本主义是怎样在苏联复辟的', '南斯拉夫现代修正主义观点选编'],
      terms: ['修正主义', '社会帝国主义', '和平演变', '无产阶级专政', '资产阶级法权'],
      people: ['斯大林', '赫鲁晓夫', '勃列日涅夫', '毛泽东', '列宁']
    },
    {
      id: 'cr',
      name: '无产阶级专政下继续革命',
      sub: '从两类矛盾到 1976：一条理论线索的文件顺序',
      icon: '🔥',
      lead: '这条线索的起点是 1957 年的《关于正确处理人民内部矛盾的问题》：社会主义社会仍然有矛盾，只是大量表现为人民内部矛盾，而敌我矛盾依然存在。由此推出一个判断——无产阶级夺取政权之后，阶级斗争没有结束，重点转向了党内和上层建筑。1966 年的五一六通知与十六条把判断变成运动，1975 年的「学习无产阶级专政理论」又把落点放回经济基础：资产阶级法权在按劳分配中依然存在，是新的资产阶级产生的土壤。要理解这段历史，最好的办法不是看转述，而是按文件顺序读原文。',
      quotes: [
        { t: '在社会主义社会中，基本的矛盾仍然是生产关系和生产力之间的矛盾，上层建筑和经济基础之间的矛盾。', src: '毛泽东《关于正确处理人民内部矛盾的问题》' },
        { t: '无产阶级专政下继续革命，就是无产阶级在夺取政权之后，还要在政治、经济、文化各个领域继续进行革命。', src: '《论无产阶级专政下继续革命》' },
        { t: '我国现在实行的商品制度、货币交换、按劳分配，跟旧社会没有多少差别，所不同的是所有制变更了。', src: '毛泽东关于理论问题的谈话（1974）' }
      ],
      books: ['关于正确处理人民内部矛盾的问题', '五一六通知', '关于无产阶级文化大革命的决定（十六条）', '论无产阶级专政下继续革命', '毛泽东读社会主义政治经济学批注和谈话', '谈谈资产阶级法权', '论资产阶级法权', '《红旗》杂志文选'],
      terms: ['两类矛盾', '无产阶级专政下继续革命', '资产阶级法权', '党内走资派'],
      people: ['毛泽东', '张春桥', '姚文元']
    }
  ];

  window.SITE_TOPICS = TOPICS;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 按书名片段在本库资源里找条目（找不到就跳过，不报错） */
  function findBook(text) {
    var R = window.SITE_RESOURCES || [], t = String(text || '');
    for (var i = 0; i < R.length; i++) { if (R[i].title === t) return { i: i, r: R[i] }; }
    for (var j = 0; j < R.length; j++) { if (t && R[j].title && R[j].title.indexOf(t) >= 0) return { i: j, r: R[j] }; }
    return null;
  }

  function topicCardHTML(t) {
    return '<div class="lcard" style="align-items:flex-start" onclick="openTopic(\'' + esc(t.id) + '\')">' +
      '<div style="font-size:1.5rem;line-height:1;margin-right:4px">' + t.icon + '</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div class="pname">' + esc(t.name) + '</div>' +
      '<div class="prole" style="line-height:1.7;opacity:.85">' + esc(t.sub) + '</div>' +
      '<div class="prole" style="opacity:.55;font-size:.72rem;margin-top:2px">' + t.quotes.length + ' 条摘录 · ' + t.books.length + ' 本书 · ' + t.terms.length + ' 个概念</div>' +
      '</div><span style="opacity:.4">›</span></div>';
  }

  function topicsHTML() {
    return '<p class="sub" style="margin:0 0 10px;line-height:1.85">按「问题」而不是按「类型」组织。每个专题给一段导言、几条原文摘录、一份书单，以及相关的概念与人物——都能点进去。</p>' +
      TOPICS.map(topicCardHTML).join('');
  }

  function openTopic(id) {
    var t = null;
    for (var i = 0; i < TOPICS.length; i++) { if (TOPICS[i].id === id) { t = TOPICS[i]; break; } }
    if (!t) return;
    var h = '<div style="padding:2px 0 6px"><div style="font-size:1.35rem;font-weight:600">' + t.icon + ' ' + esc(t.name) + '</div>' +
      '<div class="sub" style="margin-top:4px;opacity:.75">' + esc(t.sub) + '</div></div>' +
      '<p class="sub" style="line-height:1.95;margin:10px 0 0">' + esc(t.lead) + '</p>' +
      '<h2 class="sub-title" style="margin-top:20px">📌 原文摘录</h2>';
    t.quotes.forEach(function (q) {
      h += '<div style="margin:10px 0;padding:10px 12px;border-left:3px solid var(--accent);background:rgba(255,255,255,.03);border-radius:0 8px 8px 0">' +
        '<div style="font-size:.9rem;line-height:1.85">' + esc(q.t) + '</div>' +
        '<div class="sub" style="margin-top:6px;font-size:.74rem;opacity:.6">—— ' + esc(q.src) + '</div></div>';
    });
    h += '<h2 class="sub-title" style="margin-top:20px">📚 相关书目</h2><div class="tagrow" style="flex-wrap:wrap;gap:6px">';
    var seen = {};
    t.books.forEach(function (bt) {
      var f = findBook(bt);
      if (!f || seen[f.i]) return;
      seen[f.i] = 1;
      h += '<span class="tag" style="cursor:pointer" onclick="openItemDetail(' + f.i + ')">' + esc(f.r.title) + (f.r.cat === '原著' ? '' : ' · ' + esc(f.r.cat || '')) + '</span>';
    });
    h += '</div>';
    if (t.terms && t.terms.length) {
      h += '<h2 class="sub-title" style="margin-top:20px">🔑 相关概念</h2><div class="tagrow" style="flex-wrap:wrap;gap:6px">';
      t.terms.forEach(function (k) {
        h += '<span class="tag" style="cursor:pointer" onclick="openTermByName(\'' + esc(k) + '\')">' + esc(k) + '</span>';
      });
      h += '</div>';
    }
    if (t.people && t.people.length) {
      h += '<h2 class="sub-title" style="margin-top:20px">👤 相关人物</h2><div class="tagrow" style="flex-wrap:wrap;gap:6px">';
      t.people.forEach(function (p) {
        h += '<span class="tag" style="cursor:pointer" onclick="openPersonByName(\'' + esc(p) + '\')">' + esc(p) + '</span>';
      });
      h += '</div>';
    }
    h += '<p class="sub" style="margin-top:22px;opacity:.55;line-height:1.85;font-size:.76rem">摘录为节选，断句以原著为准；点书名进书目详情，点概念进术语卡。</p>';
    openContent(t.icon + ' ' + t.name, crumbFrom([{ t: '史料', fn: function () { openSection(0); } }, { t: '专题', fn: function () { openSection(0); } }]) + h);
  }

  /* 按名字跳人物页（优先图谱人物，其次作者页） */
  window.openPersonByName = function (name) {
    try {
      var gn = (window.allGraphNodes ? allGraphNodes() : []).filter(function (n) { return n.name === name || (n.name || '').indexOf(name) >= 0; })[0];
      if (gn && typeof openFigure === 'function') { openFigure(gn.id); return; }
      if (typeof openAuthor === 'function') { openAuthor(name); return; }
      toast('暂无「' + name + '」的人物页');
    } catch (e) { try { toast('打开失败'); } catch (e2) { } }
  };

  /* 按名字跳术语卡：打开术语页后滚到最匹配的那张卡并高亮一下 */
  window.openTermByName = function (name) {
    try {
      var html = (window.YZStudy && YZStudy.glossaryHTML) ? YZStudy.glossaryHTML() : '';
      if (!html) { try { toast('术语卡模块未加载'); } catch (e) { } return; }
      openContent('📚 术语卡', html);
      setTimeout(function () {
        var box = document.getElementById('contentView') || document.body;
        var els = box.querySelectorAll('div,li');
        for (var i = 0; i < els.length; i++) {
          var tx = els[i].textContent || '';
          if (tx.indexOf(name) === 0 && tx.length < 300) {
            try { els[i].scrollIntoView({ block: 'center' }); } catch (e) { }
            var el = els[i];
            el.style.transition = 'background .5s';
            el.style.background = 'rgba(245,197,24,.18)';
            setTimeout(function () { el.style.background = ''; }, 1800);
            break;
          }
        }
      }, 150);
    } catch (e) { try { toast('打开失败'); } catch (e2) { } }
  };

  window.topicsHTML = topicsHTML;
  window.openTopic = openTopic;
  window.YZ_TOPICS = { list: function () { return TOPICS.slice(); }, get: function (id) { return TOPICS.filter(function (t) { return t.id === id; })[0] || null; } };
})();
