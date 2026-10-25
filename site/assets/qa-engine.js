/* =====================================================================
   学通 · 图谱问答引擎（专家系统，零模型、零网络、零参数）
   ---------------------------------------------------------------------
   设计原则（对应「两条腿走路」的正规军那条腿）：
     · 事实来自已有的结构化图谱，不来自参数记忆 → 不会编造
     · 推理路径完全可追踪（走了哪条边、依据是什么）→ 可审计
     · 纯前端、无依赖、内存占用≈图谱本身 → 断网可用、老机型可跑
     · 关系方向严格按数据语义判定 → 不把「谁批判谁」说反

   对外接口：
     YZQA.ask(question)   -> { ok, intent, answer, notes[], evidence[] }
     YZQA.find(text)      -> 节点数组（按匹配度排序）
     YZQA.relCat(rel)     -> 归一化后的关系大类
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- 多图谱上下文 ----------
     每个图谱各自建索引，切换时只换 CUR，不重建全部。
     这样主图谱（93→107 节点）与文革图谱（202 节点）可共存、可切换。 */
  var GRAPHS = {};
  var CUR = null;

  function buildGraph(id, raw, label) {
    if (!raw || !raw.nodes) return;
    var nodes = raw.nodes || [];
    var links = raw.links || raw.edges || [];
    var byId = {}, adj = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    function addAdj(k, item) { (adj[k] || (adj[k] = [])).push(item); }

    links.forEach(function (l) {
      var cat = relCat(l.rel, l.kind);
      var dir = relDir(l.rel, cat);
      addAdj(l.source, { to: l.target, rel: l.rel, kind: l.kind, cat: cat, dir: 'out', sem: dir });
      addAdj(l.target, { to: l.source, rel: l.rel, kind: l.kind, cat: cat, dir: 'in',  sem: dir });
    });

    GRAPHS[id] = { id: id, label: label || id, nodes: nodes, links: links, byId: byId, adj: adj };
    if (!CUR) CUR = GRAPHS[id];
  }

  function use(id) {
    if (GRAPHS[id]) CUR = GRAPHS[id];
    return CUR;
  }

  /* ---------- 联合图谱 ----------
     用户不该知道「彭德怀」在哪个图谱里。三个图谱合并成一份「全部」，
     按 id 去重、同名建别名、关系去重，默认就用它。
     合并后约 325 节点 / 648 关系，比任何单图谱都完整。 */
  function buildUnion() {
    var srcIds = Object.keys(GRAPHS).filter(function (k) { return k !== 'all'; });
    if (!srcIds.length) return null;

    var byId = {}, nodes = [], nameToId = {};

    /* 第一遍：按 id 合并，字段空的用后来的补 */
    srcIds.forEach(function (k) {
      GRAPHS[k].nodes.forEach(function (n) {
        var t = byId[n.id];
        if (!t) {
          t = byId[n.id] = JSON.parse(JSON.stringify(n));
          t._g = [k];
          nodes.push(t);
        } else {
          if (t._g && t._g.indexOf(k) < 0) t._g.push(k);
          Object.keys(n).forEach(function (f) {
            var v = n[f];
            if (v == null) return;
            if (Array.isArray(v)) {
              if (!Array.isArray(t[f]) || !t[f].length) t[f] = v.slice();
            } else if (t[f] == null || t[f] === '') {
              t[f] = v;
            }
          });
        }
        if (n.name && !nameToId[n.name]) nameToId[n.name] = n.id;
      });
    });

    /* 第二遍：同名不同 id → 记为别名，指向先出现的那个 */
    var aliasOf = {};
    Object.keys(nameToId).forEach(function (nm) {
      var mainId = nameToId[nm];
      nodes.forEach(function (n) {
        if (n.id !== mainId && n.name === nm) aliasOf[n.id] = mainId;
      });
    });

    /* 第三遍：关系替换别名 + 去重 */
    var links = [], seen = {};
    srcIds.forEach(function (k) {
      GRAPHS[k].links.forEach(function (l) {
        var a = aliasOf[l.source] || l.source;
        var b = aliasOf[l.target] || l.target;
        if (a === b) return;
        var key = a + '>' + b + '>' + (l.rel || '');
        if (seen[key]) return;
        seen[key] = 1;
        links.push({ source: a, target: b, rel: l.rel, kind: l.kind });
      });
    });

    /* 别名节点的字段补给主节点，然后剔除别名节点 */
    Object.keys(aliasOf).forEach(function (aid) {
      var an = byId[aid], mn = byId[aliasOf[aid]];
      if (!an || !mn) return;
      Object.keys(an).forEach(function (f) {
        var v = an[f];
        if (v == null) return;
        if (Array.isArray(v)) {
          if (!Array.isArray(mn[f]) || !mn[f].length) mn[f] = v.slice();
        } else if (mn[f] == null || mn[f] === '') {
          mn[f] = v;
        }
      });
      mn.alias = (mn.alias || []).concat([an.id, an.name]).filter(Boolean);
      if (an._g && mn._g) an._g.forEach(function (k) { if (mn._g.indexOf(k) < 0) mn._g.push(k); });
    });
    nodes = nodes.filter(function (n) { return !aliasOf[n.id]; });

    return { nodes: nodes, links: links };
  }

  function rebuildUnion() {
    var u = buildUnion();
    if (!u) return null;
    buildGraph('all', u, '全部');
    /* 重建会生成新的 all 对象，CUR 若还指着旧的就得换过去，否则改数据后查到的还是旧内容 */
    if (!CUR || CUR.id === 'all') CUR = GRAPHS.all;
    return GRAPHS.all;
  }

  /* ---------- 关系归一化 ----------
     90 多种 rel 归到 8 类，并判定方向语义。
     dir 含义：'out' 表示 source 对 target 施加该关系（如「领导」「批判」） */
  var CAT_RULES = [
    { cat: '对立',   re: /批判|对立|分歧|论战|开除|分裂|反对|声讨/ },
    { cat: '领导',   re: /领导|总书记|总司令|首任|缔造者之一|缔造·领导|领导党|遵义会议/ },
    { cat: '创立',   re: /创立|创建|缔造|奠基|奠立|提出|首次提出|起源|前身/ },
    { cat: '承继',   re: /继承|发展|阐释|影响|源流|承继|哲学基础|理论基础|思想来源|思想基础|指导思想|核心主张|纲领|总结|实践总结/ },
    { cat: '组织成员', re: /成员|代表|战士|英雄|骨干|参与者/ },
    { cat: '亲属',   re: /父子|兄弟|配偶|伴侣|亲属/ },
    { cat: '合作',   re: /战友|同志|共事|合作|同盟|交往|支持|声援|拥护|共事|同乡|论战/ },
    { cat: '包含',   re: /包含|内部思潮|前身思潮|分化自/ }
  ];

  /* 对称关系：两个方向都成立 */
  var SYMMETRIC = { '合作': 1, '对立': 1, '亲属': 1 };

  function relCat(rel, kind) {
    /* 文革图谱自带结构化 kind（发动/隶属/支持/对立/批判/夺权/结合/渊源/参与），优先使用 */
    if (kind) {
      var KMAP = { '发动': '领导', '隶属': '组织成员', '支持': '合作', '对立': '对立',
                   '批判': '对立', '夺权': '对立', '结合': '合作', '渊源': '承继', '参与': '组织成员' };
      if (KMAP[kind]) return KMAP[kind];
    }
    var s = String(rel || '');
    for (var i = 0; i < CAT_RULES.length; i++) {
      if (CAT_RULES[i].re.test(s)) return CAT_RULES[i].cat;
    }
    return '其他';
  }

  /* 方向语义：'src' 表示 source 是主语；'sym' 表示对称；'rev' 表示 target 是主语 */
  function relDir(rel, cat) {
    if (SYMMETRIC[cat]) return 'sym';
    /* 「X 是 Y 的成员 / X 代表 Y」：主语是 X，但语义上是「属于」 */
    if (cat === '组织成员' || cat === '包含') return 'belong';
    return 'src';
  }

  /* ---------- 实体识别 ---------- */
  function norm(s) {
    return String(s || '')
      .replace(/[\s·・,，。？！?!、；;："'“”‘’()（）《》]/g, '')
      .toLowerCase();
  }

  function scoreMatch(node, q) {
    var nq = norm(q);
    if (!nq) return 0;
    var name = norm(node.name);
    if (!name) return 0;
    /* 人物加权：问「列宁」时应命中人物，而不是「列宁主义」 */
    var bonus = node.type === 'person' ? 5 : 0;
    if (name === nq) return 100;
    /* 后缀匹配优先于前缀：「弗拉基米尔·伊里奇·列宁」←「列宁」应胜过「列宁主义」←「列宁」 */
    if (name.length > nq.length && name.slice(-nq.length) === nq) return 92 + bonus;
    if (name.indexOf(nq) === 0) return 80 + bonus;
    if (name.indexOf(nq) >= 0) return 60 + bonus;
    /* tags 里的别名 */
    var tags = node.tags || [];
    for (var i = 0; i < tags.length; i++) {
      var t = norm(tags[i]);
      /* 单字 tag（如「有」「人」）会让任何含该字的问句误命中，必须要求长度 ≥ 2 */
      if (t.length < 2) continue;
      if (t === nq) return 90;
      if (t.indexOf(nq) >= 0 || nq.indexOf(t) >= 0) return 55;
    }
    if (norm(node.id) === nq) return 85;
    /* 别名：合并时把同名异 id 的节点并进来了，旧 id / 旧名字也要能查到 */
    if (node.alias) {
      for (var a = 0; a < node.alias.length; a++) {
        var an = norm(node.alias[a]);
        if (!an) continue;
        if (an === nq) return 96;
        if (an.indexOf(nq) >= 0 || nq.indexOf(an) >= 0) return 58;
      }
    }
    return 0;
  }

  function find(text) {
    var out = [];
    CUR.nodes.forEach(function (n) {
      var s = scoreMatch(n, text);
      if (s > 0) out.push({ node: n, score: s });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    /* 同名同分的，保留前 5 个，交给上层消歧 */
    return out.slice(0, 5);
  }

  function best(text) {
    var r = find(text);
    return r.length && r[0].score >= 55 ? r[0].node : null;
  }

  /* ---------- 从问题里切出两个实体 ---------- */
  /* 常见模式：A和B / A与B / A跟B / A对B / A、B */
  var SPLIT_RE = /(.+?)(?:和|与|跟|同|及|、|还有|以及)(.+?)(?:什么关系|有什么关系|关系如何|是什么关系|之间|的)?[?？]?$/;

  function splitPair(q) {
    var body = String(q || '')
      .replace(/[?？。！!]+$/g, '')
      .replace(/^(请问|问一下|我想知道|帮我查|查一下|说说|讲讲)/, '')
      .replace(/(是什么关系|有什么关系|关系如何|之间什么关系|之间有什么关系|的关系是什么|的关系)$/g, '');
    var m = body.match(SPLIT_RE);
    if (!m) return null;
    var a = m[1], b = m[2];
    if (!a || !b) return null;
    var na = best(a), nb = best(b);
    if (!na || !nb || na.id === nb.id) return null;
    return [na, nb];
  }

  /* ---------- 答案片段 ---------- */
  /* 统一取来源：主图谱/概念用 source，文革图谱用 sources（复数） */
  function srcOf(n) {
    if (!n) return '';
    if (n.source) return String(n.source);
    if (Array.isArray(n.sources) && n.sources.length) return n.sources.filter(Boolean).join('；');
    if (typeof n.sources === 'string') return n.sources;
    return '';
  }

  function label(n) {
    return n.name + (n.years ? '（' + n.years + '）' : '');
  }

  function typeName(t) {
    return { person: '人物', org: '组织', idea: '思想', event: '事件',
             concept: '概念', work: '著作', place: '地点' }[t] || '条目';
  }

  /* 找 A 到 B 的直接关系 */
  function directEdges(a, b) {
    var out = [];
    (CUR.adj[a.id] || []).forEach(function (e) {
      if (e.to === b.id) out.push(e);
    });
    return out;
  }

  /* 用自然语言描述一条边（站在 a 的视角） */
  function describeEdge(a, e) {
    var b = CUR.byId[e.to];
    if (!b) return '';
    var isOut = e.dir === 'out';
    var subj = isOut ? a : b;
    var obj  = isOut ? b : a;
    switch (e.cat) {
      case '合作':   return subj.name + '与' + obj.name + '是' + e.rel + '关系';
      case '对立':   return subj.name + '与' + obj.name + '存在' + e.rel;
      case '领导':   return isOut ? (subj.name + '领导或影响了' + obj.name) : (obj.name + '领导或影响了' + subj.name);
      case '创立':   return isOut ? (subj.name + '创立或提出了' + obj.name) : (obj.name + '创立或提出了' + subj.name);
      /* 「继承·发展 / 影响 / 源流」这类关系的方向在原始数据里并不统一，
         强行断言「谁继承谁」会说反，因此只报关系名，不判断方向。 */
      case '承继':   return subj.name + ' 与 ' + obj.name + ' 的关系：' + e.rel;
      case '组织成员': return isOut ? (subj.name + '是' + obj.name + '的' + e.rel) : (obj.name + '是' + subj.name + '的' + e.rel);
      case '亲属':   return subj.name + '与' + obj.name + '是' + e.rel + '关系';
      case '包含':   return isOut ? (subj.name + '包含' + obj.name) : (obj.name + '包含' + subj.name);
      default:       return subj.name + '与' + obj.name + '：' + e.rel;
    }
  }

  /* BFS 最短路（限定 4 跳以内，避免答非所问） */
  function shortestPath(a, b, maxDepth) {
    maxDepth = maxDepth || 4;
    var prev = {}; prev[a.id] = null;
    var q = [a.id], depth = {}; depth[a.id] = 0;
    while (q.length) {
      var cur = q.shift();
      if (cur === b.id) break;
      if (depth[cur] >= maxDepth) continue;
      var nbrs = CUR.adj[cur] || [];
      for (var i = 0; i < nbrs.length; i++) {
        var nx = nbrs[i].to;
        if (prev[nx] !== undefined) continue;
        prev[nx] = { from: cur, edge: nbrs[i] };
        depth[nx] = depth[cur] + 1;
        q.push(nx);
      }
    }
    if (prev[b.id] === undefined) return null;
    var path = [], cur2 = b.id;
    while (prev[cur2]) {
      var step = prev[cur2];
      path.unshift({ from: CUR.byId[step.from], to: CUR.byId[cur2], edge: step.edge });
      cur2 = step.from;
    }
    return path;
  }

  /* ---------- 意图分派 ---------- */
  function askCore(q) {
    var raw = String(q || '').trim();
    var res = { ok: false, intent: 'unknown', answer: '', notes: [], evidence: [] };
    if (!raw) { res.answer = '请输入问题。'; return res; }

    /* 0.4 人工审定的题库第一档：术语卡与答疑（精确命中优先于书库与图谱）。
       只回放静态文本，不生成任何新句子；分数不到 12 分就让给后面的检索。 */
    var _hits = null;
    if (window.YZStudy && typeof window.YZStudy.search === 'function') {
      try { _hits = window.YZStudy.search(raw) || []; } catch (e) { _hits = []; }
      var _top = null;
      for (var _i = 0; _i < _hits.length; _i++) {
        if ((_hits[_i].kind === 'answer' || _hits[_i].kind === 'term') && _hits[_i].score >= 12) { _top = _hits[_i]; break; }
      }
      if (_top) {
        res.intent = _top.kind === 'term' ? 'term' : 'faq';
        res.answer = _top.text;
        res.notes.push(_top.kind === 'answer'
          ? '来源：答疑库（人工审定，附原文依据）'
          : '来源：术语卡' + (_top.basis && _top.basis[0] ? '（' + _top.basis[0] + '）' : ''));
        if (_top.note) res.notes.push(_top.note);
        (_top.basis || []).forEach(function (b) { res.evidence.push({ from: '依据', to: b, g: _top.kind }); });
        var _rest = _hits.filter(function (x) { return x !== _top; }).slice(0, 3);
        if (_rest.length) res.notes.push('还可能是：' + _rest.map(function (x) { return x.title; }).join(' ｜ '));
        res.ok = true;
        return res;
      }
    }

    /* 0. 书库问题先于图谱：问「《共产党宣言》讲什么」时，不该被同名图谱节点抢答。
          YZBOOK 未加载（如测试环境）则自动跳过。 */
    if (window.YZBOOK && typeof window.YZBOOK.tryAnswer === 'function') {
      try { var _bk = window.YZBOOK.tryAnswer(raw); if (_bk) return _bk; } catch (e) {}
    }

    /* 0.6 人工审定的题库第二档：导读骨架（问「这本书讲什么、怎么读」时用）。
       它不是答案，是结构：回一句「这本书要解决的问题」，并指明骨架在哪。 */
    if (_hits && _hits.length) {
      for (var _j = 0; _j < _hits.length; _j++) {
        if (_hits[_j].kind === 'guide') {
          res.intent = 'guide';
          res.answer = _hits[_j].text + '\n（这本书的导读骨架在「书详情页 → 导读骨架」，正文需自己填写。）';
          res.notes.push('来源：导读骨架（结构由软件提供，正文由读者填写）');
          (_hits[_j].basis || []).forEach(function (b) { res.evidence.push({ from: '同读', to: b, g: 'guide' }); });
          res.ok = true;
          return res;
        }
      }
    }

    /* 1. 关系：A 和 B 什么关系 */
    var pair = splitPair(raw);
    if (pair) {
      var a = pair[0], b = pair[1];
      res.intent = 'relation';
      var edges = directEdges(a, b);
      if (edges.length) {
        var lines = edges.map(function (e) { return describeEdge(a, e); });
        res.answer = lines.join('；') + '。';
        res.evidence = edges.map(function (e) {
          return { from: a.name, to: CUR.byId[e.to].name, rel: e.rel, cat: e.cat };
        });
        res.ok = true;
        return res;
      }
      /* 没有直接边：只在 2 步内给路径，且用原始关系名展示（不做语义转译，转译必失真） */
      var path = shortestPath(a, b, 2);
      if (path) {
        var chain = path.map(function (s) {
          return s.from.name + ' —[' + s.edge.rel + ']→ ' + s.to.name;
        }).join('\n');
        res.answer = a.name + ' 与 ' + b.name + ' 之间没有直接关系。图谱中的关联路径：\n' + chain;
        res.notes.push('这是图谱里已有的关联链，不是直接关系，也不能推出因果。');
        res.evidence = path.map(function (s) { return { from: s.from.name, to: s.to.name, rel: s.edge.rel, cat: s.edge.cat }; });
        res.ok = true;
        return res;
      }
      res.answer = a.name + ' 与 ' + b.name + ' 在图谱中既没有直接关系，也没有 2 步以内的关联。';
      res.notes.push('图谱只收录已核对的关系，缺漏不代表现实中无关。');
      return res;
    }

    /* 2. 单实体问题 */
    var hit = best(raw.replace(/[?？。！!]+$/g, '')
      .replace(/^(请问|问一下|我想知道|帮我查|查一下|说说|讲讲)/, '')
      .replace(/(是谁|是什么人|什么人物|的介绍|简介|是谁啊)$/g, ''));
    if (!hit) hit = best(raw);

    if (hit) {
      var n = hit;

      /* 2.1 作品 */
      if (/写过|著作|作品|写过什么|有哪些书|代表作/.test(raw)) {
        res.intent = 'works';
        var w = n.works || [];
        res.answer = w.length
          ? n.name + '的代表文献有 ' + w.length + ' 部：' + w.join('、') + '。'
          : n.name + '在图谱中没有登记代表文献。';
        res.ok = w.length > 0;
        res.evidence = [{ from: n.name, rel: '代表文献', to: w.join('、') }];
        return res;
      }

      /* 2.2 观点 */
      if (/观点|主张|要点|思想是什么|主张什么/.test(raw)) {
        res.intent = 'points';
        var p = n.points || [];
        res.answer = p.length
          ? n.name + '的主要要点：\n' + p.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n')
          : n.name + '在图谱中没有登记要点。';
        res.ok = p.length > 0;
        res.evidence = p.map(function (x) { return { from: n.name, rel: '要点', to: x }; });
        return res;
      }

      /* 2.3 批判 / 对立 */
      if (/批判|反对|对立|分歧|论战/.test(raw)) {
        res.intent = 'crit';
        var outCrit = [], inCrit = [];
        (CUR.adj[n.id] || []).forEach(function (e) {
          var o = CUR.byId[e.to];
          if (!o || e.cat !== '对立') return;
          if (e.dir === 'out') outCrit.push(o.name + '（' + e.rel + '）');
          else inCrit.push(o.name + '（' + e.rel + '）');
        });
        var parts = [];
        if (outCrit.length) parts.push(n.name + '的对立/批判对象：' + outCrit.join('、'));
        if (inCrit.length) parts.push('与' + n.name + '存在对立/批判关系的：' + inCrit.join('、'));
        res.answer = parts.length ? parts.join('；') + '。' : n.name + ' 在图谱中没有登记对立关系。';
        res.ok = parts.length > 0;
        res.evidence = [];
        return res;
      }

      /* 2.4 关联对象 */
      if (/和谁|与谁|跟谁|有哪些关系|关系网|关联/.test(raw)) {
        res.intent = 'neighbors';
        var nb = (CUR.adj[n.id] || []).map(function (e) {
          var o = CUR.byId[e.to]; if (!o) return null;
          /* 入边不写「被X」：原始数据方向不统一，加了「被」容易说反，只报关系名 */
          return o.name + '（' + e.rel + '）';
        }).filter(Boolean);
        res.answer = nb.length
          ? n.name + ' 在图谱中有 ' + nb.length + ' 条关联：' + nb.slice(0, 30).join('、') + (nb.length > 30 ? ' 等' : '') + '。'
          : n.name + ' 在图谱中没有登记关联。';
        res.ok = nb.length > 0;
        res.evidence = (CUR.adj[n.id] || []).map(function (e) {
          var o = CUR.byId[e.to];
          return o ? { from: n.name, to: o.name, rel: e.rel, cat: e.cat } : null;
        }).filter(Boolean);
        return res;
      }

      /* 2.5 默认：介绍 */
      res.intent = 'intro';
      var head = label(n);
      var body = [];
      if (n.role) body.push(n.role);
      if (n.desc) body.push(n.desc);
      res.answer = head + '\n' + body.join('\n');
      if (n.points && n.points.length) {
        res.answer += '\n要点：' + n.points.slice(0, 3).join('；') + (n.points.length > 3 ? ' 等' : '');
      }
      var cnt = (CUR.adj[n.id] || []).length;
      if (cnt) res.answer += '\n关联：与 ' + cnt + ' 个条目有关。';
      var src = srcOf(n);
      if (src) res.answer += '\n\n📖 来源：' + src;
      else res.answer += '\n\n📖 来源：待补（该条目尚未标注文献）';
      res.ok = true;
      res.evidence = [{ from: n.name, rel: '类型', to: typeName(n.type) }];
      if (src) res.evidence.push({ from: n.name, rel: '来源', to: src });
      return res;
    }

    /* 3. 类型统计：必须明确是「列举」意图，否则会把「不存在的人物xyz」误判 */
    var tm = raw.match(/^(有哪些|列出|所有的?|全部)(人物|组织|思想|事件|概念|著作)/);
    if (tm) {
      res.intent = 'type';
      var want = { '人物': 'person', '组织': 'org', '思想': 'idea', '事件': 'event',
                   '概念': 'concept', '著作': 'work' }[tm[2]];
      var list = CUR.nodes.filter(function (n) { return n.type === want; }).map(function (n) { return n.name; });
      if (!list.length) {
        res.answer = '当前还没有收录「' + tm[2] + '」类条目。\n'
          + '这是已知的内容缺口，不是查询出错——分类浏览里能看到现有全部 ' + CUR.nodes.length + ' 个节点。';
        res.ok = false;
        return res;
      }
      res.answer = '图谱收录 ' + tm[2] + ' ' + list.length + ' 个：' + list.join('、') + '。';
      res.ok = true;
      return res;
    }

    /* 4. 兜底：关键词检索 */
    var kw = raw.replace(/[?？。！!]/g, '').slice(0, 12);
    var hits = CUR.nodes.filter(function (n) {
      return (n.name || '').indexOf(kw) >= 0
        || (n.desc || '').indexOf(kw) >= 0
        || (n.tags || []).some(function (t) { return String(t).indexOf(kw) >= 0; });
    });
    res.intent = 'search';
    if (hits.length) {
      res.answer = '包含「' + kw + '」的条目有 ' + hits.length + ' 个：'
        + hits.slice(0, 12).map(function (n) { return n.name + '（' + typeName(n.type) + '）'; }).join('、')
        + (hits.length > 12 ? ' 等' : '') + '。';
      res.ok = true;
      return res;
    }
    var TN = { person: '人物', org: '组织', idea: '思想', event: '事件', concept: '概念', work: '著作', place: '地点' };
    var tcnt = {};
    CUR.nodes.forEach(function (n) { tcnt[n.type] = (tcnt[n.type] || 0) + 1; });
    var tdesc = Object.keys(tcnt).map(function (k) { return (TN[k] || k) + ' ' + tcnt[k]; }).join('、');
    res.answer = '没有找到与「' + kw + '」相关的内容。\n'
      + '当前图谱（' + CUR.label + '）收录：' + tdesc + '，共 ' + CUR.nodes.length + ' 个节点。'
      + '查不到属于覆盖范围限制，不是没有这段史实。';
    return res;
  }

  /* ---------- 跳转链接：答案要能落回站点里的具体位置 ----------
     用户的抱怨是「搜人物时没有图谱跳转和人物介绍跳转」——
     答案只给文字，用户没法接着看下去。这里按节点类型给出口：
       · 概念 → 概念详情页（频道 → 概念频道）
       · 人物/组织/事件/思想 → 站点详情页（#/g/id）+ 图谱定位（graph.html#id）
     注意只给「点进去真的存在」的链接，不编造。 */
  function gLabelOf(n) {
    if (!n || !n._g || !n._g.length) return '';
    var L = n._g.map(function (k) { return (GRAPHS[k] && GRAPHS[k].label) || k; });
    return L.length === 1 ? L[0] : (L[0] + ' 等 ' + L.length + ' 处');
  }
  function linksFor(n) {
    var out = [];
    if (!n || !n.id) return out;
    if (n.type === 'concept') {
      out.push({ label: '查看概念详情', href: 'index.html#/c/' + encodeURIComponent(n.id), kind: 'concept' });
      return out;
    }
    out.push({ label: n.name + ' · ' + ((n.type === 'person' || !n.type) ? '人物介绍' : '详情'),
               href: 'index.html#/g/' + encodeURIComponent(n.id), kind: 'detail' });
    out.push({ label: n.name + ' · 图谱定位', href: 'graph.html#' + encodeURIComponent(n.id), kind: 'graph' });
    return out;
  }
  /* 从答案里收集要挂链接的节点：主实体 + 证据链两端 */
  function attachLinks(res, raw) {
    if (!res || res.links) return res;
    var ids = [], seen = {};
    function add(n) { if (n && n.id && !seen[n.id]) { seen[n.id] = 1; ids.push(n); } }
    try { add(best(raw)); } catch (e) {}
    (res.evidence || []).forEach(function (e) {
      var a = CUR.nodes.filter(function (n) { return n.name === e.from; })[0];
      var b = CUR.nodes.filter(function (n) { return n.name === e.to; })[0];
      if (a) e.g = gLabelOf(a);
      add(a); add(b);
    });
    var links = [];
    ids.slice(0, 4).forEach(function (n) {
      linksFor(n).forEach(function (l) {
        if (!links.some(function (x) { return x.href === l.href; })) links.push(l);
      });
    });
    if (links.length) res.links = links;

    /* 来源说明：三图谱合并后，同一个问题可能落到不同图谱，不标来源会像「混在一起」 */
    try {
      var main = best(raw);
      if (main) {
        var g = gLabelOf(main);
        if (g) res.notes.push('该条收录于 ' + g + '。');
      }
    } catch (e) {}
    return res;
  }
  function ask(q) {
    var r = null;
    try { r = askCore(q); } catch (e) { r = { ok: false, intent: 'error', answer: '查询出错：' + (e && e.message), notes: [], evidence: [] }; }
    try { attachLinks(r, String(q || '').trim()); } catch (e) {}
    return r;
  }

  window.YZQA = {
    ask: ask,
    find: find,
    /* 供 RAG 层使用：返回某节点的直接邻居（带中文名，便于拼 context） */
    _src: srcOf,
    _adj: function (id) {
      return (CUR.adj[id] || []).map(function (e) {
        var o = CUR.byId[e.to];
        return { to: e.to, toName: o ? o.name : e.to, rel: e.rel, cat: e.cat, dir: e.dir };
      });
    },
    relCat: relCat,
    use: use,
    graphs: function () {
      return Object.keys(GRAPHS).map(function (k) {
        return { id: k, label: GRAPHS[k].label, nodes: GRAPHS[k].nodes.length, links: GRAPHS[k].links.length };
      });
    },
    stats: function () { return { graph: CUR.id, nodes: CUR.nodes.length, links: CUR.links.length }; }
  };

  /* ---------- 初始化：主图谱必载，其余有则加载 ---------- */
  buildGraph('main', window.SITE_GRAPH, '主图谱');
  buildGraph('wenge', window.SITE_GRAPH_WENGE, '文革图谱');
  buildGraph('world', window.SITE_GRAPH_WORLD, '世界图谱');
  buildGraph('concepts', window.SITE_CONCEPTS, '理论概念');
  rebuildUnion();
  if (GRAPHS.all) CUR = GRAPHS.all;   /* 默认就是「全部」，不再让用户选 */

  /* 按需注册：页面动态加载完某个图谱文件后，自动重建「全部」 */
  window.YZQA_ADD = function (id, raw, label) {
    buildGraph(id, raw, label);
    rebuildUnion();
    if (!CUR || CUR.id === 'all') CUR = GRAPHS.all || GRAPHS[id];
    return !!GRAPHS[id];
  };
})();
