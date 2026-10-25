/* =====================================================================
   学通 · 三层知识结构（base / user / merged）
   ---------------------------------------------------------------------
   为什么分三层：
     · base  随包分发、只读、有出处 —— 官方内容不能被导入污染
     · user  用户导入或自建、存本机 —— 可删可改，升级不丢
     · merged 问答时用 —— 两边合起来，冲突并列，不替用户裁决

   铁律：
     · 导入内容必须带来源；没来源的存但标「未注明出处」
     · verified=false 的条目，问答时必须标注，且不能进训练集
     · 任何写入都要先预览，看不见就确认等于默许污染

   对外接口：
     YZ_LAYERS.load()                 读用户层
     YZ_LAYERS.parse(text, name)      解析文本 → {nodes, links, errors}
     YZ_LAYERS.preview(parsed)        对比 base，返回统计
     YZ_LAYERS.commit(parsed)         写进 user 层并重建 merged
     YZ_LAYERS.exportJSON(opts)       导出 JSON 字符串
     YZ_LAYERS.exportJSONL(opts)      导出训练语料（JSONL）
     YZ_LAYERS.stats()                各层规模
     YZ_LAYERS.clear()                清空用户层
   ===================================================================== */
(function () {
  'use strict';

  var KEY = 'yz_user_layer_v1';
  var SCHEMA = 1;

  /* ---------- 允许的节点类型 ---------- */
  var TYPES = { person: 1, org: 1, idea: 1, event: 1, work: 1, concept: 1, place: 1 };

  function emptyLayer() {
    return { version: SCHEMA, nodes: [], links: [], meta: { updatedAt: null, origin: 'self' } };
  }

  /* ---------- 存储 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return emptyLayer();
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.nodes)) return emptyLayer();
      return d;
    } catch (e) {
      return emptyLayer();
    }
  }

  function save(layer) {
    layer.meta = layer.meta || {};
    layer.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(layer));
    return layer;
  }

  /* ---------- 工具 ---------- */
  function trim(x) { return String(x == null ? '' : x).trim(); }

  function normId(s) {
    return trim(s).toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fa5]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  /* ---------- 解析：JSON ---------- */
  function parseJSON(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { return { nodes: [], links: [], errors: ['JSON 解析失败：' + e.message] }; }
    var nodes = d.nodes || d.items || (Array.isArray(d) ? d : []);
    var links = d.links || d.edges || [];
    return { nodes: nodes, links: links, errors: [] };
  }

  /* ---------- 解析：JSONL（每行一条问答） ---------- */
  function parseJSONL(text) {
    var nodes = [], errors = [];
    text.split(/\r?\n/).forEach(function (line, i) {
      line = line.trim();
      if (!line) return;
      try {
        var o = JSON.parse(line);
        /* 问答对不是图节点，转成一条「问答条目」，挂在虚拟 id 上供检索 */
        if (o.instruction) {
          nodes.push({
            id: 'qa_' + (o.id || (i + 1)),
            name: trim(o.instruction).slice(0, 40),
            type: 'concept',
            desc: trim(o.output),
            tags: ['问答', '导入'],
            source: o.source || '',
            verified: o.verified === true
          });
        } else if (o.id && o.name) {
          nodes.push(o);
        }
      } catch (e) {
        errors.push('第 ' + (i + 1) + ' 行解析失败');
      }
    });
    return { nodes: nodes, links: [], errors: errors };
  }

  /* ---------- 解析：Markdown（frontmatter） ---------- */
  function parseMarkdown(text) {
    var m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { nodes: [], links: [], errors: ['缺少 frontmatter（--- ... ---）'] };
    var head = m[1], body = m[2].trim();
    var o = {};
    head.split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(':');
      if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    if (!o.name && !o.id) return { nodes: [], links: [], errors: ['frontmatter 里至少要有 id 或 name'] };
    var n = {
      id: o.id || normId(o.name),
      name: o.name || o.id,
      type: TYPES[o.type] ? o.type : 'concept',
      years: o.years || '',
      role: o.role || '',
      desc: body,
      tags: o.tags ? o.tags.split(/[,，]/).map(trim).filter(Boolean) : [],
      source: o.source || '',
      verified: o.verified === 'true'
    };
    return { nodes: [n], links: [], errors: [] };
  }

  /* ---------- 总解析 ---------- */
  function parse(text, fileName) {
    var name = String(fileName || '').toLowerCase();
    var t = String(text || '').replace(/^\uFEFF/, '');
    var res;
    if (/\.jsonl$/.test(name)) res = parseJSONL(t);
    else if (/\.md$/.test(name)) res = parseMarkdown(t);
    else {
      /* 按内容猜 */
      var first = t.trim().slice(0, 1);
      if (first === '[' || first === '{') {
        /* 可能是 JSON，也可能是 JSONL */
        try { JSON.parse(t); res = parseJSON(t); }
        catch (e) { res = parseJSONL(t); }
      } else if (/^---/.test(t.trim())) res = parseMarkdown(t);
      else res = parseJSONL(t);
    }

    /* 规范化 + 校验 */
    var out = { nodes: [], links: [], errors: res.errors.slice() };
    /* 关系原样保留（id 规范化在 commit 时做，避免此处误伤） */
    (res.links || []).forEach(function (l) {
      if (l && l.source && l.target) out.links.push({ source: l.source, target: l.target, rel: trim(l.rel), kind: l.kind });
    });
    res.nodes.forEach(function (n, i) {
      if (!n || typeof n !== 'object') { out.errors.push('第 ' + (i + 1) + ' 条不是对象'); return; }
      var id = normId(n.id || n.name || '');
      if (!id) { out.errors.push('第 ' + (i + 1) + ' 条缺少 id/name'); return; }
      out.nodes.push({
        id: id,
        name: trim(n.name || n.id),
        type: TYPES[n.type] ? n.type : 'concept',
        years: trim(n.years),
        role: trim(n.role),
        desc: trim(n.desc || n.description || n.text),
        points: Array.isArray(n.points) ? n.points.filter(Boolean).map(trim) : [],
        works: Array.isArray(n.works) ? n.works.filter(Boolean).map(trim) : [],
        tags: Array.isArray(n.tags) ? n.tags.filter(Boolean).map(trim) : [],
        source: trim(n.source || ''),
        verified: n.verified === true
      });
    });
    return out;
  }

  /* ---------- 与 base 对比 ---------- */
  /* 官方层 = 三个随包分发的图谱，不含 user、不含合并视图（否则会把自己算成官方） */
  function baseIndex() {
    var idx = {};
    ['SITE_GRAPH', 'SITE_GRAPH_WENGE', 'SITE_GRAPH_WORLD', 'SITE_CONCEPTS'].forEach(function (k) {
      if (window[k] && window[k].nodes) {
        window[k].nodes.forEach(function (n) { if (!idx[n.id]) idx[n.id] = n; });
      }
    });
    return idx;
  }

  function preview(parsed) {
    var base = baseIndex();
    var user = load();
    var userIdx = {};
    user.nodes.forEach(function (n) { userIdx[n.id] = n; });

    var stat = { total: parsed.nodes.length, added: 0, dupBase: 0, dupUser: 0, conflict: 0, noSource: 0, items: [] };
    parsed.nodes.forEach(function (n) {
      if (base[n.id]) {
        stat.dupBase++;
        var same = trim(base[n.id].desc) === trim(n.desc);
        stat.items.push({ id: n.id, name: n.name, status: same ? 'dup' : 'conflict-base' });
      } else if (userIdx[n.id]) {
        stat.dupUser++;
        stat.items.push({ id: n.id, name: n.name, status: 'dup-user' });
      } else {
        stat.added++;
        stat.items.push({ id: n.id, name: n.name, status: 'new' });
      }
      if (!n.source) stat.noSource++;
    });
    stat.errors = parsed.errors || [];
    stat.links = (parsed.links || []).length;
    return stat;
  }

  /* ---------- 写入用户层 ---------- */
  function commit(parsed, opts) {
    opts = opts || {};
    var layer = load();
    var idx = {};
    layer.nodes.forEach(function (n) { idx[n.id] = n; });
    var base = baseIndex();

    var added = 0, updated = 0, skipped = 0;
    parsed.nodes.forEach(function (n) {
      /* 与官方重复且内容一致 → 不重复存 */
      if (base[n.id] && trim(base[n.id].desc) === trim(n.desc) && !opts.force) { skipped++; return; }
      if (idx[n.id]) { Object.assign(idx[n.id], n); updated++; }
      else {
        n._layer = 'user';
        n._importedAt = new Date().toISOString();
        n._origin = opts.origin || 'import';
        layer.nodes.push(n);
        idx[n.id] = n;
        added++;
      }
    });

    var seen = {};
    layer.links.forEach(function (l) { seen[l.source + '>' + l.target + '>' + (l.rel || '')] = 1; });
    (parsed.links || []).forEach(function (l) {
      var k = l.source + '>' + l.target + '>' + (l.rel || '');
      if (seen[k]) return;
      seen[k] = 1;
      layer.links.push({ source: normId(l.source), target: normId(l.target), rel: trim(l.rel), _layer: 'user' });
    });

    save(layer);
    rebuild();
    return { added: added, updated: updated, skipped: skipped, total: layer.nodes.length };
  }

  /* ---------- 重建合并视图 ---------- */
  function rebuild() {
    if (!window.YZQA || !window.YZQA_ADD) return;
    var layer = load();
    window.YZQA_ADD('user', { nodes: layer.nodes, links: layer.links }, '用户补充');
  }

  /* ---------- 导出 ---------- */
  function baseNodes() {
    var idx = baseIndex();
    return Object.keys(idx).map(function (k) { return idx[k]; });
  }

  function exportJSON(opts) {
    opts = opts || {};
    var user = load();
    var nodes = [];
    if (opts.includeBase !== false) {
      baseNodes().forEach(function (n) {
        var c = JSON.parse(JSON.stringify(n));
        c._layer = 'base';
        nodes.push(c);
      });
    }
    if (opts.includeUser !== false) {
      user.nodes.forEach(function (n) { nodes.push(JSON.parse(JSON.stringify(n))); });
    }
    /* 备份是完整快照，默认不按 verified 过滤；只有「要不要未核对内容」显式关掉才过滤 */
    if (opts.includeUnverified === false) nodes = nodes.filter(function (n) { return n.verified === true; });

    return JSON.stringify({
      type: 'yzt-graph',
      version: SCHEMA,
      exportedAt: new Date().toISOString(),
      nodes: nodes,
      links: user.links || []
    }, null, 2);
  }

  /* 训练语料：每个节点生成 3–5 条问答 */
  function exportJSONL(opts) {
    opts = opts || {};
    var lines = [];
    function push(instruction, output, id, layer, verified) {
      if (!instruction || !output) return;
      lines.push(JSON.stringify({ instruction: instruction, output: output, source: 'graph#' + id, layer: layer, verified: !!verified }));
    }
    function emit(n, layer) {
      if (n.verified === false && !opts.includeUnverified) return;
      if (n.name) push(n.name + '是谁', (n.role ? n.role + '。' : '') + (n.desc || ''), n.id, layer, n.verified);
      if (n.desc) push(n.name + '的要点是什么', n.desc, n.id, layer, n.verified);
      (n.points || []).slice(0, 5).forEach(function (p, i) {
        push(n.name + '的第' + (i + 1) + '个要点', p, n.id, layer, n.verified);
      });
      (n.works || []).forEach(function (w) {
        push(n.name + '写过什么', w, n.id, layer, n.verified);
      });
    }

    if (opts.includeBase !== false) baseNodes().forEach(function (n) { emit(n, 'base'); });
    if (opts.includeUser !== false) load().nodes.forEach(function (n) { emit(n, 'user'); });

    return lines.join('\n');
  }

  /* ---------- 统计 ---------- */
  function stats() {
    var user = load();
    var b = baseNodes().length;
    return {
      base: b,
      user: user.nodes.length,
      userLinks: user.links.length,
      merged: window.YZQA && window.YZQA.stats ? window.YZQA.stats().nodes : null
    };
  }

  function clear() {
    localStorage.removeItem(KEY);
    rebuild();
  }

  window.YZ_LAYERS = {
    load: load,
    save: save,
    parse: parse,
    preview: preview,
    commit: commit,
    rebuild: rebuild,
    exportJSON: exportJSON,
    exportJSONL: exportJSONL,
    stats: stats,
    clear: clear
  };
})();
