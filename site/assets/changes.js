/* =====================================================================
   学通 · 变更日志（changes.js）
   ---------------------------------------------------------------------
   解决什么问题：
     保存只弹一句「已保存到本机」，改了什么、从什么改成什么，一概看不见；
     导入内容包说「新增 12 处、跳过 3 处」，也不知道具体是哪 12 条。
     结果就是——改完、导完，用户感觉「没作用」。

   做法：每次保存/导入都记一条变更（changeset），存本机：
     { t: 时间戳, act: 'edit'|'add'|'import'|'text',
       kind: 'concept'|'event'|..., ref: id/名字, name: 显示名,
       fields: [{ k: 字段中文名, from: 旧, to: 新 }], note: 备注 }

   用途三处：
     ① 保存后的提示：「已保存 2 项：年份 1965→1966 · 影响评价 已修改」
     ② 设置页「最近的改动」：列出全部，可逐条撤销
     ③ 导入内容包：逐条列出新增了什么

   撤销只写回旧值，不做复杂的反向 diff——对个人使用的编辑器够用。
   对外：YZChanges.add / list / openPanel / summaryOf / undo
   ===================================================================== */
(function () {
  'use strict';

  var LS = 'yzChanges';
  var MAX = 200;

  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nowStr() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(LS) || '[]') || []; } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(LS, JSON.stringify(list.slice(-MAX))); return true; }
    catch (e) { return false; }
  }

  /* 把一段文字压成便于对比的短串 */
  function brief(v) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!s) return '（空）';
    return s.length > 14 ? (s.slice(0, 14) + '…') : s;
  }

  function add(rec) {
    if (!rec) return;
    var list = load();
    list.push({
      t: Date.now(),
      ts: nowStr(),
      act: rec.act || 'edit',
      kind: rec.kind || '',
      ref: rec.ref == null ? '' : String(rec.ref),
      name: rec.name || '',
      fields: Array.isArray(rec.fields) ? rec.fields.filter(function (f) { return f && f.k; }) : [],
      note: rec.note || '',
      undoable: rec.undoable !== false
    });
    save(list);
  }

  /* 一条变更的人话摘要，用于 toast / 列表 */
  function summaryOf(rec) {
    if (!rec) return '';
    if (rec.act === 'import') return rec.note || '导入内容包';
    var fs = rec.fields || [];
    if (!fs.length) return '已保存（无字段变化）';
    var parts = fs.slice(0, 3).map(function (f) {
      return f.k + ' ' + brief(f.from) + '→' + brief(f.to);
    });
    if (fs.length > 3) parts.push('等 ' + fs.length + ' 项');
    return parts.join(' · ');
  }

  /* 保存后的统一提示 */
  function afterSave(rec) {
    add(rec);
    var s = summaryOf(rec);
    toast('已保存：' + s);
    return s;
  }

  /* ---------- 面板 ---------- */
  function openPanel() {
    var old = document.getElementById('yzChangesPanel');
    if (old) { try { old.remove(); } catch (e) {} }
    var list = load().reverse();
    var rows = list.length ? list.map(function (r, i) {
      var idx = list.length - 1 - i;   /* 回到原数组下标 */
      return '<div class="chg" data-i="' + idx + '">' +
        '<div class="chg-h"><b>' + esc(r.name || r.ref || '未命名') + '</b>' +
        '<span class="chg-t">' + esc(r.ts || '') + '</span></div>' +
        '<div class="chg-s">' + esc(summaryOf(r)) + '</div>' +
        '<div class="chg-o">' + (r.undoable === false
          ? '<span style="font-size:.7rem;opacity:.45">这一类请重新编辑改回</span>'
          : '<button data-a="undo" data-i="' + idx + '">撤销</button>') + '</div>' +
        '</div>';
    }).join('') : '<p style="opacity:.6;font-size:.85rem;padding:10px 0">还没有改动记录。</p>';

    var w = document.createElement('div');
    w.id = 'yzChangesPanel';
    w.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:100080;background:var(--bg,#12100e);' +
      'color:var(--fg,#f2e9e4);display:flex;flex-direction:column';
    w.innerHTML =
      '<style>' +
      '#yzChangesPanel .ch-bar{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.16);display:flex;' +
      'align-items:center;gap:10px;flex:0 0 auto}' +
      '#yzChangesPanel .ch-bar b{flex:1;font-size:.94rem}' +
      '#yzChangesPanel .ch-x{background:none;border:none;color:inherit;font-size:1.1rem;padding:4px 8px}' +
      '#yzChangesPanel .ch-body{flex:1;overflow:auto;padding:8px 12px 40px}' +
      '#yzChangesPanel .chg{padding:10px 2px;border-bottom:1px solid rgba(255,255,255,.08)}' +
      '#yzChangesPanel .chg-h{display:flex;gap:8px;align-items:baseline}' +
      '#yzChangesPanel .chg-h b{flex:1;font-size:.88rem}' +
      '#yzChangesPanel .chg-t{font-size:.7rem;opacity:.5}' +
      '#yzChangesPanel .chg-s{font-size:.78rem;opacity:.78;line-height:1.7;margin-top:3px}' +
      '#yzChangesPanel .chg-o{margin-top:6px}' +
      '#yzChangesPanel .chg-o button{font-size:.74rem;padding:4px 10px;border-radius:7px;' +
      'border:1px solid rgba(255,255,255,.24);background:transparent;color:inherit}' +
      '</style>' +
      '<div class="ch-bar"><b>🕘 最近的改动（' + list.length + '）</b>' +
      '<button class="ch-x" data-a="close">✕</button></div>' +
      '<div class="ch-body">' + rows + '</div>';
    document.body.appendChild(w);

    w.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
      if (a === 'close') return w.remove();
      if (a === 'undo') {
        var i = +ev.target.getAttribute('data-i');
        var rec = load()[i];
        if (!rec) return;
        if (!window.confirm('撤销这一条改动？\n' + (rec.name || '') + '\n' + summaryOf(rec))) return;
        var r = undo(rec);
        toast(r.ok ? '已撤销' : ('撤销失败：' + (r.msg || '')));
        if (r.ok) { w.remove(); openPanel(); }
      }
    });
  }

  /* 撤销：把 from 值写回；正文段落写回空 patch（即恢复原文） */
  function undo(rec) {
    if (!rec) return { ok: false, msg: '没有了' };
    try {
      if (rec.act === 'import') return { ok: false, msg: '导入是批量的，请到「内容包」里手动覆盖' };
      if (rec.kind === 'text') {
        if (!window.YZTextEdit) return { ok: false, msg: '正文编辑器未加载' };
        var f = rec.ref.split('|');
        var patch = window.YZTextEdit.all()[f[0]] || {};
        delete patch[f[1]];
        var allp = window.YZTextEdit.all(); allp[f[0]] = patch;
        localStorage.setItem('yzTextPatch', JSON.stringify(allp));
        return { ok: true };
      }
      if (!window.YZY) return { ok: false, msg: '编辑模块未加载' };
      var patch2 = {};
      (rec.fields || []).forEach(function (x) { patch2[x.k2 || x.k] = x.from; });
      if (rec.kind === 'concept') return window.YZY.editConcept(rec.ref, patch2);
      if (rec.kind === 'event') return window.YZY.editEvent(rec.ref, patch2);
      return { ok: false, msg: '这一类型暂不支持撤销' };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  window.YZChanges = {
    add: add,
    afterSave: afterSave,
    list: load,
    summaryOf: summaryOf,
    openPanel: openPanel,
    undo: undo,
    clear: function () { try { localStorage.removeItem(LS); } catch (e) {} }
  };
})();
