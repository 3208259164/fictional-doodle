/* =====================================================================
   学通 · 内容编辑器（contentedit.js）
   ---------------------------------------------------------------------
   为什么重写：原来的「✏️ 改介绍」只给两个输入框（定位 + 正文介绍），
   概念改不了出处/相关文献/关键词，史料改不了年份、背景、经过、影响、涉及人物，
   而且部分入口传的参数对不上（事件按名字存、面板却按 id 找），点了像没反应。

   这一版：按类型给「全部字段」，数组字段一行一条；保存走 YZY 的既有接口，
   写完立刻 reapply + 重绘当前页，肉眼能看到变化。

   对外：yzEdit(kind, ref)
     concept → ref = 概念 id
     event   → ref = 事件名（与 OV.events.edited 的键一致）
     person  → ref = 人物 id（会在三张图里找）
     book    → ref = 书库下标或条目 id
   ===================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

  var SCHEMA = {
    concept: {
      title: '概念',
      save: function (ref, patch) { return window.YZY.editConcept(ref, patch); },
      load: function (ref) {
        var ns = (window.SITE_CONCEPTS && window.SITE_CONCEPTS.nodes) || [];
        for (var i = 0; i < ns.length; i++) if (ns[i].id === ref) return ns[i];
        return null;
      },
      fields: [
        ['name', '名称', 'text'],
        ['role', '定位（一句话）', 'text'],
        ['desc', '正文介绍', 'area'],
        ['points', '要点（一行一条）', 'list'],
        ['source', '出处', 'text'],
        ['works', '相关文献（一行一条）', 'list'],
        ['tags', '关键词（一行一条）', 'list']
      ]
    },
    event: {
      title: '史料事件',
      save: function (ref, patch) { return window.YZY.editEvent(ref, patch); },
      load: function (ref) {
        var l = (window.SITE_EXTRA && window.SITE_EXTRA.events) || [];
        for (var i = 0; i < l.length; i++) if (l[i].name === ref) return l[i];
        return null;
      },
      fields: [
        ['year', '年份', 'text'],
        ['name', '事件名称', 'text'],
        ['desc', '概述', 'area'],
        ['bg', '背景', 'area'],
        ['points', '经过 / 要点（一行一条）', 'list'],
        ['impact', '影响与评价', 'area'],
        ['people', '涉及人物（一行一条）', 'list'],
        ['schools', '相关思潮 / 派别（一行一条）', 'list']
      ]
    },
    person: {
      title: '人物',
      save: function (ref, patch) {
        var G = (window.YZY && window.YZY.graphData) ? window.YZY.graphData('main') : (window.SITE_GRAPH || { nodes: [] });
        var p = (G.nodes || []).filter(function (x) { return x.id === ref; })[0];
        var grp = 'comrades';
        try {
          var L = window.leaders || []; var C = window.comrades || [];
          if (p && L.some(function (x) { return x.name === p.name; })) grp = 'leaders';
        } catch (e) {}
        return window.YZY.editPerson(grp, p ? p.name : ref, patch);
      },
      load: function (ref) {
        var G = (typeof allGraphNodes === 'function') ? allGraphNodes() : ((window.SITE_GRAPH || { nodes: [] }).nodes || []);
        for (var i = 0; i < G.length; i++) if (G[i].id === ref) return G[i];
        return null;
      },
      fields: [
        ['name', '姓名', 'text'],
        ['years', '生卒年', 'text'],
        ['role', '定位', 'text'],
        ['desc', '介绍', 'area'],
        ['points', '要点（一行一条）', 'list'],
        ['works', '代表作（一行一条）', 'list']
      ]
    },
    book: {
      title: '书目',
      save: function (ref, patch) { return window.YZY.editResource(ref, patch); },
      load: function (ref) {
        var RES = (window.SITE_RESOURCES || []);
        if (typeof ref === 'number') return RES[ref];
        for (var i = 0; i < RES.length; i++) if (RES[i].id === ref) return RES[i];
        return null;
      },
      fields: [
        ['title', '书名', 'text'],
        ['author', '作者', 'text'],
        ['cat', '分类', 'text'],
        ['desc', '一句话简介', 'text'],
        ['intro', '详细简介', 'area'],
        ['note', '来源 · 校订说明', 'area'],
        ['url', '链接（站内 books/… 或 https://…）', 'text'],
        ['tags', '标签（一行一条）', 'list']
      ]
    }
  };

  /* 兜底：没有专用字段的类型（会议、频道、术语、人物频道发言……）
     不再弹「不认识的类型」，而是给一个通用编辑器：
     改动存进「我的标注」（YZY.setMeta），会显示在该页下方，随导出一起带走。 */
  function genericSchema(kind) {
    return {
      title: '内容',
      load: function (ref) {
        var o = { name: String(ref || '') };
        try {
          var m = (window.YZY && YZY.getMeta) ? YZY.getMeta(kind + ':' + ref) : [];
          (m || []).forEach(function (x) { o['m_' + x.k] = x.v; });
        } catch (e) {}
        return o;
      },
      fields: [
        ['name', '名称（只作显示，不改数据）', 'text'],
        ['m_定位', '定位（一句话）', 'text'],
        ['m_介绍', '介绍 / 正文', 'area'],
        ['m_备注', '备注', 'area']
      ],
      save: function (ref, patch) {
        var arr = [];
        if (patch.m_定位) arr.push({ k: '定位', v: patch.m_定位 });
        if (patch.m_介绍) arr.push({ k: '介绍', v: patch.m_介绍 });
        if (patch.m_备注) arr.push({ k: '备注', v: patch.m_备注 });
        return window.YZY.setMeta(kind + ':' + ref, arr);
      },
      note: '这一类没有专用字段，改动会显示在本页下方「🏷 我的标注」里。'
    };
  }
  function val(o, f) {
    var v = o ? o[f] : '';
    if (Array.isArray(v)) return v.join('\n');
    return v == null ? '' : String(v);
  }

  /* 统一「找这条内容」：专用表找不到就换着地方找，再找不到才退回通用编辑器。
     以前直接 toast('找不到这条内容') 或走错类型，用户看到的就是「点了没反应 / 不支持」。 */
  function resolve(kind, ref) {
    var sc = SCHEMA[kind];
    if (sc) {
      var d = sc.load(ref);
      if (d) return { sc: sc, d: d, ref: ref, generic: false };
    }
    if (kind === 'event') {
      var w = (window.SITE_GRAPH_WORLD && window.SITE_GRAPH_WORLD.nodes) || [];
      for (var i = 0; i < w.length; i++) {
        var n = w[i];
        if (!n || (n.id !== ref && n.name !== ref)) continue;
        var nm = n.name || ref;
        var e2 = SCHEMA.event.load(nm);
        return { sc: SCHEMA.event, d: e2 || n, ref: nm, generic: false };
      }
      var ex = (window.SITE_EXTRA && window.SITE_EXTRA.events) || [];
      for (var j = 0; j < ex.length; j++) if (ex[j] && ex[j].name === ref) return { sc: SCHEMA.event, d: ex[j], ref: ref, generic: false };
    }
    if (kind === 'person') {
      var names = ref;
      var lists = [];
      try { if (window.YZY && YZY.listGraphs) YZY.listGraphs().forEach(function (g) { var gd = YZY.graphData(g.id); if (gd && gd.nodes) lists.push(gd.nodes); }); } catch (e) {}
      lists.push((window.SITE_GRAPH && SITE_GRAPH.nodes) || []);
      for (var a = 0; a < lists.length; a++) for (var b = 0; b < lists[a].length; b++) {
        if (lists[a][b] && lists[a][b].id === ref) return { sc: SCHEMA.person, d: lists[a][b], ref: ref, generic: false };
      }
    }
    var g = genericSchema(kind);
    return { sc: g, d: g.load(ref), ref: ref, generic: true };
  }

  window.yzEdit = function (kind, ref) {
    if (!window.YZY) return toast('编辑模块未加载');
    var _r = resolve(kind, ref);
    var sc = _r.sc, d = _r.d;
    ref = _r.ref;
    if (!d) return toast('找不到这条内容');

    var old = document.getElementById('yzContentEdit');
    if (old) { try { old.remove(); } catch (e) {} }

    var wrap = document.createElement('div');
    wrap.id = 'yzContentEdit';
    wrap.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:100050;' +
      'background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center';
    var rows = (_r.generic ? '<div class="le-hint" style="opacity:.7">' + esc(sc.note || '') + '</div>' : '') +
      sc.fields.map(function (f) {
      var k = f[0], label = f[1], type = f[2], v = val(d, k);
      var input;
      if (type === 'area') {
        input = '<textarea data-f="' + k + '" rows="4" style="width:100%;box-sizing:border-box;padding:8px;' +
          'border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.28);color:inherit;' +
          'font-size:.86rem;line-height:1.7;resize:vertical">' + esc(v) + '</textarea>';
      } else if (type === 'list') {
        input = '<textarea data-f="' + k + '" rows="3" placeholder="一行一条" style="width:100%;box-sizing:border-box;padding:8px;' +
          'border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.28);color:inherit;' +
          'font-size:.86rem;line-height:1.7;resize:vertical">' + esc(v) + '</textarea>';
      } else {
        input = '<input data-f="' + k + '" value="' + esc(v) + '" style="width:100%;box-sizing:border-box;padding:8px;' +
          'border-radius:8px;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.28);color:inherit;font-size:.88rem">';
      }
      return '<label style="display:block;margin:10px 0 0">' +
        '<span style="display:block;font-size:.74rem;opacity:.72;margin-bottom:3px">' + esc(label) + '</span>' +
        input + '</label>';
    }).join('');

    wrap.innerHTML =
      '<div style="width:100%;max-width:620px;max-height:92vh;overflow:auto;background:var(--panel-bg,#1b1412);' +
      'color:var(--panel-text,#f2e9e4);border-radius:16px 16px 0 0;padding:14px 16px 18px">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<b style="flex:1;font-size:.95rem">✏️ 编辑' + sc.title + '：' + esc(d.name || d.title || '') + '</b>' +
        '<button data-a="close" style="background:none;border:none;color:inherit;font-size:1.1rem;padding:4px 8px">✕</button>' +
      '</div>' +
      '<p style="font-size:.72rem;opacity:.6;margin:6px 0 2px;line-height:1.7">' +
        '只改本机，不动随包数据；改完随「导出我的数据」一起备份。数组字段一行一条，留空表示不改。' +
        '要恢复原样，点下面的「清除本条改动」。</p>' +
      rows +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap">' +
        '<button data-a="reset" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.24);' +
          'background:transparent;color:inherit;font-size:.82rem">清除本条改动</button>' +
        '<button data-a="cancel" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.24);' +
          'background:transparent;color:inherit;font-size:.82rem">取消</button>' +
        '<button data-a="save" style="padding:8px 16px;border-radius:8px;border:none;background:var(--accent,#c9a227);' +
          'color:#1b1412;font-size:.86rem;font-weight:600">保存</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(wrap);
    function close() { try { wrap.remove(); } catch (e) {} }
    function readAll() {
      var o = {};
      sc.fields.forEach(function (f) {
        var el = wrap.querySelector('[data-f="' + f[0] + '"]');
        if (!el) return;
        var v = String(el.value || '');
        if (f[2] === 'list') {
          var arr = v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
          if (arr.length) o[f[0]] = arr;
        } else {
          v = v.trim();
          if (v) o[f[0]] = v;
        }
      });
      return o;
    }

    wrap.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
      if (!a) { if (ev.target === wrap) close(); return; }
      if (a === 'close' || a === 'cancel') return close();
      if (a === 'save') {
        var patch = readAll();
        if (!Object.keys(patch).length) { close(); return toast('没有填写内容'); }
        /* 先算出「哪些字段真的变了」，保存后才有话可说 */
        var fields = [];
        Object.keys(patch).forEach(function (k) {
          var f = sc.fields.filter(function (x) { return x[0] === k; })[0];
          if (!f) return;
          var oldV = val(d, k);
          var newV = Array.isArray(patch[k]) ? patch[k].join('\n') : String(patch[k]);
          if (oldV !== newV) fields.push({ k: f[1], k2: k, from: oldV, to: newV });
        });
        var r;
        try { r = sc.save(ref, patch); } catch (e) { return toast('保存失败：' + e.message); }
        if (r && r.ok === false) return toast('保存失败：' + (r.msg || r.err || '未知原因'));
        close();
        try { if (window.openCurrent) window.openCurrent(); } catch (e) {}
        if (window.YZChanges) {
          window.YZChanges.afterSave({
            act: 'edit', kind: kind, ref: String(ref),
            name: d.name || d.title || String(ref), fields: fields
          });
        } else {
          toast('已保存到本机');
        }
        return;
      }
      if (a === 'reset') {
        if (!window.confirm('清除这条内容在本机的改动？')) return;
        try {
          var key = (kind === 'event') ? String(ref) : String(ref);
          if (kind === 'concept' && window.YZY.clearConceptEdit) window.YZY.clearConceptEdit(key);
          else if (kind === 'event' && window.YZY.clearEventEdit) window.YZY.clearEventEdit(key);
          else if (kind === 'book' && window.YZY.clearResourceEdit) window.YZY.clearResourceEdit(key);
          else if (kind === 'person' && window.YZY.clearPersonEdit) window.YZY.clearPersonEdit(key);
          else return toast('这一条还不支持清除');
        } catch (e) { return toast('清除失败：' + e.message); }
        close();
        try { if (window.openCurrent) window.openCurrent(); } catch (e) {}
        toast('已恢复原样');
      }
    });
  };
})();
