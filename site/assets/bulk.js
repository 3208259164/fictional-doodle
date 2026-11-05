/* =====================================================================
   学通 · 批量编辑与导入（bulk.js）
   ---------------------------------------------------------------------
   为什么要有它：
     史料里的推荐人物、思潮 / 组织，以及概念、书库条目，原来只能一条一条点开改；
     想从 Excel 里整理好一批贴进来，没有任何入口。所谓「导入」只认 {author,text}
     这种特定数组，格式不对就一句「每项需含 author 与 text」，用户感觉「没作用」。

   这一版的做法（与通行做法一致）：
     ① 全部数据先「导出为表格（TSV）」——你能看见到底有哪些字段、现在是什么值；
     ② 在 Excel / WPS / 表格里整片改，复制，粘回来；
     ③ 粘贴后先「解析预览」：哪一行第几列有问题、要不要新增、要不要更新，一目了然；
     ④ 确认才写；单个单元格为空 = 这一项不改（不是清空）；
     ⑤ 写完给报告：新增 N · 更新 M · 无变化 K · 失败 F（带行号与原因）。

   对外：
     YZBulk.open(typeKey)   打开某一类的批量面板
     YZBulk.center()        类型选择
   ===================================================================== */
(function () {
  'use strict';

  var LS_LAST = 'yzBulkLast';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(m) { try { if (window.toast) window.toast(m); else console.log(m); } catch (e) {} }
  function Y() { return window.YZY || {}; }

  /* ================= TSV 解析 / 生成 ================= */
  function cellOut(v) {
    var s = String(v == null ? '' : v);
    if (/[\t\n\r"]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toTSV(rows, fields) {
    var out = [fields.map(function (f) { return cellOut(f.label); }).join('\t')];
    rows.forEach(function (r) {
      out.push(fields.map(function (f) { return cellOut(r[f.k]); }).join('\t'));
    });
    return out.join('\r\n');
  }
  /* 支持 Tab 或逗号；引号内可含分隔符与换行 */
  function parseTable(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var tab = (text.match(/\t/g) || []).length;
    var comma = (text.match(/,/g) || []).length;
    var delim = (tab >= comma) ? '\t' : ',';
    var rows = [], row = [], cell = '', q = false, i = 0;
    while (i < text.length) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === delim) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return { delim: delim, rows: rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); }) };
  }

  /* ================= 类型注册表 ================= */
  var TYPES = {
    rec: {
      label: '推荐人物（史料）',
      icon: '👤',
      key: 'name',
      fields: [
        { k: 'name', label: '名称', req: true },
        { k: 'account', label: '账号' },
        { k: 'fans', label: '粉丝数' },
        { k: 'url', label: '主页链接' },
        { k: 'intro', label: '介绍', long: true }
      ],
      rows: function () {
        var R = ((window.SITE_CONTENT || {}).recommend) || [];
        return R.map(function (x) {
          return { name: x.name, account: x.account, fans: x.fans, url: x.url, intro: x.intro };
        });
      },
      save: function (r, isNew) {
        var p = {};
        ['account', 'fans', 'url', 'intro'].forEach(function (k) { if (r[k] !== '' && r[k] != null) p[k] = r[k]; });
        if (isNew) return Y().addRec(Object.assign({ name: r.name }, p));
        return Y().editRec(r.name, p);
      }
    },

    sch: {
      label: '思潮 / 组织（史料）',
      icon: '🏛',
      key: 'name',
      fields: [
        { k: 'name', label: '名称', req: true },
        { k: 'group', label: '所属分组' },
        { k: 'meta', label: '一句话定位' },
        { k: 'desc', label: '要点说明', long: true },
        { k: 'works', label: '相关文献' },
        { k: 'people', label: '相关人物（空格分隔）' },
        { k: 'opposed', label: '对立思潮', long: true }
      ],
      rows: function () {
        var G = ((window.SITE_EXTRA || {}).schools) || [];
        var out = [];
        G.forEach(function (g) {
          (g.items || []).forEach(function (it) {
            out.push({
              name: it.name, group: it.group || g.group || g.name || '', meta: it.meta,
              desc: it.desc, works: it.works,
              people: (it.people || []).join(' '), opposed: it.opposed
            });
          });
        });
        return out;
      },
      save: function (r, isNew) {
        var p = {};
        ['group', 'meta', 'desc', 'works', 'opposed'].forEach(function (k) { if (r[k] !== '' && r[k] != null) p[k] = r[k]; });
        if (r.people != null && String(r.people).trim() !== '') {
          p.people = String(r.people).split(/[\s,，、]+/).filter(Boolean);
        }
        if (isNew) return Y().addSch(Object.assign({ name: r.name }, p));
        return Y().editSch(r.name, p);
      }
    },

    concept: {
      label: '概念',
      icon: '💡',
      key: 'id',
      noNew: true,   /* 概念表只支持改，不支持新增（新增请在内置数据里加） */
      fields: [
        { k: 'id', label: '编号', req: true },
        { k: 'name', label: '名称' },
        { k: 'role', label: '定位' },
        { k: 'desc', label: '正文介绍', long: true },
        { k: 'points', label: '要点（一行一条）', long: true, list: true },
        { k: 'works', label: '相关文献（一行一条）', list: true },
        { k: 'tags', label: '关键词（空格分隔）', list: true },
        { k: 'source', label: '出处' }
      ],
      rows: function () {
        var ns = ((window.SITE_CONCEPTS || {}).nodes) || [];
        return ns.map(function (x) {
          return {
            id: x.id, name: x.name, role: x.role, desc: x.desc,
            points: (x.points || []).join('\n'),
            works: (x.works || []).join('\n'),
            tags: (x.tags || []).join(' '),
            source: x.source
          };
        });
      },
      save: function (r) {
        var p = {};
        ['name', 'role', 'desc', 'source'].forEach(function (k) { if (r[k] !== '' && r[k] != null) p[k] = r[k]; });
        if (r.points) p.points = String(r.points).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (r.works) p.works = String(r.works).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (r.tags) p.tags = String(r.tags).split(/[\s,，、]+/).filter(Boolean);
        return Y().editConcept(r.id, p);
      }
    },

    book: {
      label: '书库条目',
      icon: '📚',
      key: 'id',
      fields: [
        { k: 'id', label: '编号', req: true },
        { k: 'title', label: '书名' },
        { k: 'author', label: '作者' },
        { k: 'cat', label: '分类' },
        { k: 'date', label: '收录日期' },
        { k: 'intro', label: '简介', long: true }
      ],
      rows: function () {
        var R = window.SITE_RESOURCES || [];
        return R.map(function (x) {
          return { id: x.id, title: x.title, author: x.author, cat: x.cat, date: x.date, intro: x.intro };
        });
      },
      save: function (r) {
        var p = {};
        ['title', 'author', 'cat', 'date', 'intro'].forEach(function (k) { if (r[k] !== '' && r[k] != null) p[k] = r[k]; });
        return Y().editResource(r.id, p);
      }
    }
  };

  /* ================= 面板 ================= */
  var S = null;   /* { type, list, filter } */

  function typeOf(k) { return TYPES[k]; }

  function open(typeKey) {
    var t = typeOf(typeKey);
    if (!t) return toast('没有这一类：' + typeKey);
    if (!window.YZY) return toast('编辑模块未加载');
    closePanel();
    S = { type: typeKey, filter: '' };
    var wrap = document.createElement('div');
    wrap.id = 'yzBulk';
    wrap.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:100070;' +
      'background:var(--bg,#12100e);color:var(--fg,#f2e9e4);display:flex;flex-direction:column';
    wrap.innerHTML =
      '<style>' +
      '#yzBulk .bk-bar{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.16);flex:0 0 auto}' +
      '#yzBulk .bk-bar b{flex:1;font-size:.94rem}' +
      '#yzBulk .bk-bar button,#yzBulk .bk-b2 button{font-size:.78rem;padding:6px 10px;border-radius:8px;' +
      'border:1px solid rgba(255,255,255,.24);background:transparent;color:inherit}' +
      '#yzBulk .bk-tip{padding:8px 14px;font-size:.74rem;opacity:.62;line-height:1.7;flex:0 0 auto}' +
      '#yzBulk .bk-search{padding:0 14px 8px;flex:0 0 auto}' +
      '#yzBulk .bk-search input{width:100%;box-sizing:border-box;padding:9px 12px;border-radius:10px;' +
      'border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.05);color:inherit;font-size:.84rem}' +
      '#yzBulk .bk-body{flex:1;overflow:auto;padding:0 10px 40px}' +
      '#yzBulk .bk-row{display:flex;align-items:center;gap:8px;padding:11px 4px;border-bottom:1px solid rgba(255,255,255,.08)}' +
      '#yzBulk .bk-m{flex:1;min-width:0}' +
      '#yzBulk .bk-n{font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#yzBulk .bk-s{font-size:.72rem;opacity:.55;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#yzBulk .bk-e{width:100%;box-sizing:border-box;margin:4px 0;padding:8px 10px;border-radius:8px;' +
      'border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.05);color:inherit;font-size:.82rem;line-height:1.7}' +
      '#yzBulk .bk-edit{padding:10px 4px;background:rgba(255,255,255,.04);border-radius:10px;margin:6px 0}' +
      '#yzBulk .bk-ok{font-size:.76rem;padding:8px 14px;border-radius:9px;background:var(--accent,#c9a227);color:#1a1613;border:none;font-weight:600}' +
      '</style>' +
      '<div class="bk-bar"><b>' + t.icon + ' 批量 · ' + esc(t.label) + '</b>' +
        '<button data-a="paste">📋 粘贴</button>' +
        '<button data-a="copy">⬇ 导出</button>' +
        '<button data-a="close">✕</button></div>' +
      '<div class="bk-tip">点一条可改；贴表格能一次改很多条。导出的表可以直接在 Excel 里改完再贴回来。</div>' +
      '<div class="bk-search"><input id="bkQ" placeholder="搜索…" value=""></div>' +
      '<div class="bk-body" id="bkBody"></div>';
    document.body.appendChild(wrap);
    renderBody();

    wrap.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-a]') : null;
      var a = b && b.getAttribute('data-a');
      if (a === 'close') return closePanel();
      if (a === 'paste') return openPaste();
      if (a === 'copy') return exportTSV();
      if (a === 'edit') {
        var i = +b.getAttribute('data-i');
        return openRowEdit(i);
      }
      if (a === 'saverow') {
        var idx = +b.getAttribute('data-i');
        return saveRow(idx, b.closest ? b.closest('.bk-edit') : null);
      }
      if (a === 'cancelrow') {
        var box = b.closest ? b.closest('.bk-edit') : null;
        if (box) box.remove();
        return;
      }
    });
    var q = document.getElementById('bkQ');
    if (q) q.addEventListener('input', function () {
      S.filter = q.value.trim();
      renderBody();
    });
  }

  function closePanel() {
    var e = document.getElementById('yzBulk');
    if (e) e.remove();
    var p = document.getElementById('yzBulkPaste');
    if (p) p.remove();
    S = null;
  }

  function currentList() {
    var t = typeOf(S.type);
    var rows = t.rows() || [];
    if (S.filter) {
      var f = S.filter.toLowerCase();
      rows = rows.filter(function (r) {
        return Object.keys(r).some(function (k) { return String(r[k] || '').toLowerCase().indexOf(f) >= 0; });
      });
    }
    return rows;
  }

  function renderBody() {
    var box = document.getElementById('bkBody');
    if (!box) return;
    var t = typeOf(S.type);
    var rows = currentList();
    if (!rows.length) { box.innerHTML = '<p style="opacity:.6;font-size:.84rem;padding:14px 4px">没有条目。</p>'; return; }
    box.innerHTML = rows.map(function (r, i) {
      var k = String(r[t.key] || '');
      var sub = t.fields.filter(function (f) { return f.k !== t.key; })
        .map(function (f) { return r[f.k]; })
        .filter(function (x) { return x != null && String(x).trim() !== ''; })
        .join(' · ');
      return '<div class="bk-row" data-row="' + i + '">' +
        '<div class="bk-m"><div class="bk-n">' + esc(k || '（无名称）') + '</div>' +
        '<div class="bk-s">' + esc(String(sub).slice(0, 60)) + '</div></div>' +
        '<button data-a="edit" data-i="' + i + '">✏️</button></div>';
    }).join('');
  }

  function openRowEdit(i) {
    var t = typeOf(S.type);
    var r = currentList()[i];
    if (!r) return;
    var body = document.getElementById('bkBody');
    var rowEl = body.querySelector('[data-row="' + i + '"]');
    if (!rowEl) return;
    var old = rowEl.nextElementSibling;
    if (old && old.classList && old.classList.contains('bk-edit')) { old.remove(); return; }
    var inputs = t.fields.map(function (f) {
      var v = r[f.k] == null ? '' : String(r[f.k]);
      var dis = (f.k === t.key) ? ' readonly' : '';
      if (f.long || String(v).indexOf('\n') >= 0) {
        return '<div style="font-size:.72rem;opacity:.6;margin:6px 0 3px">' + esc(f.label) + '</div>' +
          '<textarea class="bk-e" data-f="' + f.k + '" rows="3"' + dis + '>' + esc(v) + '</textarea>';
      }
      return '<div style="font-size:.72rem;opacity:.6;margin:6px 0 3px">' + esc(f.label) + '</div>' +
        '<input class="bk-e" data-f="' + f.k + '" value="' + esc(v) + '"' + dis + '>';
    }).join('');
    var box = document.createElement('div');
    box.className = 'bk-edit';
    box.setAttribute('data-i', i);
    box.innerHTML = inputs +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button class="bk-ok" data-a="saverow" data-i="' + i + '">保存这一条</button>' +
      '<button data-a="cancelrow">取消</button></div>';
    rowEl.parentNode.insertBefore(box, rowEl.nextSibling);
  }

  function saveRow(i, box) {
    var t = typeOf(S.type);
    var r = currentList()[i];
    if (!r || !box) return;
    var patch = {};
    var chg = [];
    box.querySelectorAll('[data-f]').forEach(function (el) {
      var k = el.getAttribute('data-f');
      var nv = el.value;
      var ov = r[k] == null ? '' : String(r[k]);
      if (nv === ov) return;
      patch[k] = nv;
      var f = t.fields.filter(function (x) { return x.k === k; })[0];
      chg.push({ k: f ? f.label : k, k2: k, from: ov, to: nv });
    });
    if (!Object.keys(patch).length) { toast('没有改动'); return; }
    var res;
    try { res = t.save(Object.assign({}, r, patch), false); }
    catch (e) { return toast('保存失败：' + e.message); }
    if (res && res.ok === false) return toast('保存失败：' + (res.msg || res.err || ''));
    try { Y().reapply(); } catch (e) {}
    try { if (window.openCurrent) window.openCurrent(); } catch (e) {}
    box.remove();
    renderBody();
    if (window.YZChanges) {
      window.YZChanges.afterSave({ act: 'edit', kind: S.type, ref: String(r[t.key]), name: String(r[t.key]), fields: chg });
    } else toast('已保存：' + chg.length + ' 项');
  }

  /* ================= 导出 ================= */
  function exportTSV() {
    var t = typeOf(S.type);
    var rows = t.rows() || [];
    var txt = toTSV(rows, t.fields);
    var name = '学通-' + t.label.replace(/[\/\\:*?"<>|（）()]/g, '') + '.tsv';
    /* 复制到剪贴板优先（手机上没有「另存为」的概念） */
    var done = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt); done = true;
      }
    } catch (e) {}
    if (!done) {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta);
        ta.select();
        done = document.execCommand && document.execCommand('copy');
        ta.remove();
      } catch (e) {}
    }
    if (window.YZSave && YZSave.text) { try { YZSave.text(name, 'text/tab-separated-values;charset=utf-8', '\uFEFF' + txt); } catch (e) {} }
    toast(done ? ('已复制 ' + rows.length + ' 条到剪贴板（也可另存为 ' + name + '）')
               : ('已导出 ' + rows.length + ' 条：' + name));
  }

  /* ================= 粘贴导入 ================= */
  function openPaste() {
    var old = document.getElementById('yzBulkPaste');
    if (old) old.remove();
    var t = typeOf(S.type);
    var d = document.createElement('div');
    d.id = 'yzBulkPaste';
    d.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:100090;background:rgba(0,0,0,.66);' +
      'display:flex;align-items:flex-end;justify-content:center';
    d.innerHTML =
      '<div style="width:100%;max-width:560px;background:var(--card,#1b1815);border-radius:16px 16px 0 0;' +
      'padding:14px;max-height:92vh;overflow:auto;text-align:left;color:inherit">' +
      '<div style="font-weight:600;font-size:.95rem;margin-bottom:6px">📋 粘贴表格 · ' + esc(t.label) + '</div>' +
      '<div style="font-size:.74rem;opacity:.65;line-height:1.75;margin-bottom:8px">' +
        '从 Excel / WPS 复制整片（含或不含表头都行），粘到下面。列顺序：' +
        '<span style="color:var(--accent,#c9a227)">' + t.fields.map(function (f) { return esc(f.label); }).join(' | ') + '</span>' +
      '</div>' +
      '<textarea id="bkPasteTa" rows="7" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;' +
      'border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.28);color:inherit;font-size:.78rem;' +
      'line-height:1.7;font-family:ui-monospace,Menlo,Consolas,monospace"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button id="bkParse" class="bk-ok" style="flex:1">解析预览</button>' +
        '<button id="bkPasteClose" style="padding:8px 14px;border-radius:9px;border:1px solid rgba(255,255,255,.24);' +
        'background:transparent;color:inherit">取消</button></div>' +
      '<div id="bkPrev"></div></div>';
    document.body.appendChild(d);
    document.getElementById('bkPasteClose').onclick = function () { d.remove(); };
    document.getElementById('bkParse').onclick = function () { previewPaste(); };
    d.addEventListener('click', function (e) { if (e.target === d) d.remove(); });
  }

  var LAST_PARSE = null;

  function previewPaste() {
    var t = typeOf(S.type);
    var ta = document.getElementById('bkPasteTa');
    var prev = document.getElementById('bkPrev');
    if (!ta || !prev) return;
    var txt = ta.value;
    if (!String(txt).trim()) { prev.innerHTML = '<p style="color:#e08;font-size:.8rem;margin:10px 0">还没粘贴内容。</p>'; return; }

    var P = parseTable(txt);
    if (!P.rows.length) { prev.innerHTML = '<p style="color:#e08;font-size:.8rem;margin:10px 0">解析不出任何行。</p>'; return; }

    /* 表头识别：第一行里与字段 label/k 命中的数量 */
    var first = P.rows[0].map(function (x) { return String(x).trim(); });
    var hits = 0;
    first.forEach(function (x) {
      if (!x) return;
      if (t.fields.some(function (f) { return f.label === x || f.k === x; })) hits++;
    });
    var hasHeader = hits >= 2;
    var dataRows = hasHeader ? P.rows.slice(1) : P.rows;

    /* 列映射：有表头按名字，没有按顺序 */
    var colOf = [];
    if (hasHeader) {
      t.fields.forEach(function (f) {
        var i = first.indexOf(f.label);
        if (i < 0) i = first.indexOf(f.k);
        colOf.push(i);
      });
    } else {
      t.fields.forEach(function (f, i) { colOf.push(i); });
    }

    var existing = {};
    (t.rows() || []).forEach(function (r) { existing[String(r[t.key])] = r; });

    var items = [], bad = 0, news = 0, ups = 0, same = 0;
    dataRows.forEach(function (cells, ri) {
      var obj = {}, err = '';
      t.fields.forEach(function (f, fi) {
        var ci = colOf[fi];
        obj[f.k] = ci >= 0 && ci < cells.length ? String(cells[ci]) : '';
      });
      var key = String(obj[t.key] || '').trim();
      obj[t.key] = key;
      if (!key) err = '缺少「' + (t.fields[0].label) + '」';
      var old = existing[key];
      var action = '';
      if (!err) {
        if (old) {
          var diff = t.fields.some(function (f) {
            if (f.k === t.key) return false;
            var nv = String(obj[f.k] == null ? '' : obj[f.k]).trim();
            if (nv === '') return false;                    /* 空＝不改 */
            var ov = String(old[f.k] == null ? '' : old[f.k]);
            return nv !== ov;
          });
          action = diff ? 'update' : 'same';
        } else {
          action = t.noNew ? 'error' : 'new';
          if (t.noNew) err = '这一类不支持新增（编号不存在）';
        }
      }
      if (err) { bad++; action = 'error'; }
      else if (action === 'update') ups++;
      else if (action === 'new') news++;
      else same++;
      items.push({ line: ri + (hasHeader ? 2 : 1), obj: obj, err: err, action: action, old: old });
    });

    LAST_PARSE = { items: items, hasHeader: hasHeader, delim: P.delim };

    var labelOf = { update: '更新', new: '新增', same: '无变化', error: '失败' };
    var colorOf = { update: '#4ea1ff', 'new': '#3ecf8e', same: 'rgba(255,255,255,.45)', error: '#ff5c7a' };
    var rowsHTML = items.slice(0, 80).map(function (it) {
      var sub = t.fields.filter(function (f) { return f.k !== t.key; })
        .map(function (f) { return it.obj[f.k]; })
        .filter(function (x) { return x != null && String(x).trim() !== ''; }).join(' · ');
      return '<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:.76rem">' +
        '<span style="opacity:.45;min-width:26px">' + it.line + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          esc(it.obj[t.key] || '（空）') +
          (it.err ? ' <span style="color:#ff5c7a">· ' + esc(it.err) + '</span>' : '') +
          '<div style="opacity:.5;font-size:.7rem">' + esc(String(sub).slice(0, 46)) + '</div></span>' +
        '<span style="color:' + colorOf[it.action] + ';font-size:.72rem">' + labelOf[it.action] + '</span></div>';
    }).join('');

    prev.innerHTML =
      '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.05);' +
      'font-size:.8rem;line-height:1.8">' +
        '共 <b>' + items.length + '</b> 行（' + (hasHeader ? '识别到表头' : '无表头，按列顺序') + '，分隔符 ' +
        (P.delim === '\t' ? 'Tab' : '逗号') + '）<br>' +
        '新增 <b style="color:#3ecf8e">' + news + '</b> · 更新 <b style="color:#4ea1ff">' + ups + '</b> · ' +
        '无变化 ' + same + ' · 失败 <b style="color:#ff5c7a">' + bad + '</b>' +
      '</div>' +
      (bad ? '<p style="font-size:.74rem;color:#ff5c7a;margin:8px 0">有失败行时整批不会写入。</p>' : '') +
      '<div style="max-height:38vh;overflow:auto;margin-top:6px">' + rowsHTML +
      (items.length > 80 ? '<p style="opacity:.5;font-size:.72rem;padding:8px 0">仅预览前 80 行</p>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button id="bkCommit" class="bk-ok" style="flex:1' + (bad ? ';opacity:.45' : '') + '"' + (bad ? ' disabled' : '') + '>' +
          (bad ? '有错误，先修好' : ('确认写入 ' + (news + ups) + ' 条')) + '</button>' +
        '<button id="bkPrevClose" style="padding:8px 14px;border-radius:9px;border:1px solid rgba(255,255,255,.24);' +
        'background:transparent;color:inherit">关闭</button></div>';

    var pc = document.getElementById('bkPrevClose');
    if (pc) pc.onclick = function () { prev.innerHTML = ''; };
    var cb = document.getElementById('bkCommit');
    if (cb && !bad) cb.onclick = function () { commitPaste(); };
  }

  function commitPaste() {
    var t = typeOf(S.type);
    if (!LAST_PARSE) return;
    var ok = 0, skip = 0, failed = [];
    LAST_PARSE.items.forEach(function (it) {
      if (it.action === 'same') { skip++; return; }
      if (it.action === 'error') { failed.push(it); return; }
      var isNew = it.action === 'new';
      var res;
      try { res = t.save(Object.assign({}, it.obj), isNew); }
      catch (e) { res = { ok: false, msg: e.message }; }
      if (res && res.ok === false) failed.push({ line: it.line, obj: it.obj, err: res.msg || res.err || '保存失败' });
      else ok++;
    });
    try { Y().reapply(); } catch (e) {}
    try { if (window.openCurrent) window.openCurrent(); } catch (e) {}
    renderBody();

    var d = document.getElementById('yzBulkPaste');
    if (d) d.remove();
    var nw = LAST_PARSE.items.filter(function (x) { return x.action === 'new'; }).length;
    var up = LAST_PARSE.items.filter(function (x) { return x.action === 'update'; }).length;
    if (window.YZChanges) {
      window.YZChanges.add({
        act: 'import', kind: S.type, ref: '', name: t.label + ' 批量',
        note: '新增 ' + nw + ' · 更新 ' + up + ' · 无变化 ' + skip + (failed.length ? ' · 失败 ' + failed.length : '')
      });
    }
    var msg = '已写入 ' + ok + ' 条（新增 ' + nw + '，更新 ' + up + '）';
    if (skip) msg += ' · ' + skip + ' 条无变化';
    if (failed.length) msg += ' · ' + failed.length + ' 条失败：第 ' + failed.slice(0, 3).map(function (f) { return f.line; }).join('、') + ' 行';
    toast(msg);
    LAST_PARSE = null;
  }

  /* ================= 类型选择 ================= */
  function center() {
    var old = document.getElementById('yzBulkCenter');
    if (old) { old.remove(); return; }
    var d = document.createElement('div');
    d.id = 'yzBulkCenter';
    d.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:100075;background:rgba(0,0,0,.62);' +
      'display:flex;align-items:center;justify-content:center;padding:20px';
    d.innerHTML = '<div style="width:100%;max-width:420px;background:var(--card,#1b1815);border-radius:16px;' +
      'padding:16px;color:inherit;text-align:left">' +
      '<div style="font-weight:600;margin-bottom:4px">📋 批量编辑 / 导入</div>' +
      '<div style="font-size:.74rem;opacity:.6;line-height:1.7;margin-bottom:10px">选一类，可以导出表格、改完贴回来。</div>' +
      Object.keys(TYPES).map(function (k) {
        var t = TYPES[k];
        return '<button data-t="' + k + '" style="display:flex;align-items:center;gap:10px;width:100%;' +
          'padding:13px 12px;margin-bottom:8px;border-radius:11px;border:1px solid rgba(255,255,255,.16);' +
          'background:rgba(255,255,255,.04);color:inherit;font-size:.86rem;text-align:left">' +
          '<span style="font-size:1.1rem">' + t.icon + '</span><span style="flex:1">' + esc(t.label) + '</span>' +
          '<span style="opacity:.4">›</span></button>';
      }).join('') +
      '<button data-t="" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);' +
      'background:transparent;color:inherit;font-size:.82rem">取消</button></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-t]') : null;
      if (!b) { if (e.target === d) d.remove(); return; }
      var k = b.getAttribute('data-t');
      d.remove();
      if (k) open(k);
    });
  }

  window.YZBulk = { open: open, center: center, types: function () { return Object.keys(TYPES); }, _parse: parseTable, _toTSV: toTSV };
})();
