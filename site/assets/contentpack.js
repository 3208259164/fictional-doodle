/* =====================================================================
   学通 · 内容包（contentpack.js）
   ---------------------------------------------------------------------
   解决什么问题：
     「导出我的数据」是整机备份（收藏、笔记、设置、进度），用于换机恢复；
     但它不适合交换内容——你校订了一个错字、补了一段史料，没法单独给别人。

   内容包只装「你对内容的改动」：
     · 概念 / 史料的修改与新增（overlay 里的 concepts、events）
     · 正文的段落改动（texts，见 textedit.js）
   不含收藏、笔记、阅读进度这些私人数据。

   格式（参照常见的本地内容包做法：版本化 + 校验 + 追加不覆盖）：
     { format:"xuetong-content-pack", version:1,
       site:"0.37.x", createdAt:"…", counts:{…},
       data:{ overlay:{…}, texts:{…} } }

   导入是**追加式**：同 id / 同段号已有内容就跳过，绝不冲掉本机已有的改动；
   最后给一份「新增 N 条、跳过 M 条」的报告。要强制覆盖，勾选后再导。

   对外：YZPack.exportPack(force) / YZPack.importPack(text, force) / YZPack.stats()
   ===================================================================== */
(function () {
  'use strict';

  var FMT = 'xuetong-content-pack';
  var V = 1;

  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function siteVer() {
    try { return (window.SITE_CONFIG && window.SITE_CONFIG.version) || ''; } catch (e) { return ''; }
  }
  function readOV() {
    try { return JSON.parse(localStorage.getItem('yzy_ov_v1') || '{}') || {}; } catch (e) { return {}; }
  }
  function readTexts() {
    try { return JSON.parse(localStorage.getItem('yzTextPatch') || '{}') || {}; } catch (e) { return {}; }
  }

  function counts() {
    var ov = readOV(), tx = readTexts();
    var c = {
      concepts: Object.keys((ov.concepts && ov.concepts.edited) || {}).length +
                ((ov.concepts && ov.concepts.added) || []).length,
      events: Object.keys((ov.events && ov.events.edited) || {}).length +
              ((ov.events && ov.events.added) || []).length,
      resources: Object.keys((ov.resources && ov.resources.edited) || {}).length,
      people: Object.keys((ov.people && ov.people.edited) || {}).length,
      texts: 0
    };
    Object.keys(tx).forEach(function (f) { c.texts += Object.keys(tx[f] || {}).length; });
    return c;
  }

  function exportPack() {
    var c = counts();
    var total = c.concepts + c.events + c.resources + c.people + c.texts;
    if (!total) return toast('还没有任何内容改动可以导出');

    var ov = readOV();
    var slim = {
      concepts: ov.concepts || {},
      events: ov.events || {},
      resources: ov.resources || {},
      people: ov.people || {}
    };
    var pack = {
      format: FMT,
      version: V,
      site: siteVer(),
      createdAt: new Date().toISOString(),
      counts: c,
      data: { overlay: slim, texts: readTexts() }
    };
    var txt = JSON.stringify(pack, null, 1);
    var name = '学通内容包-' + new Date().toISOString().slice(0, 10) + '.json';
    try {
      if (window.YZSave && YZSave.share && YZSave.isApp && YZSave.isApp()) {
        if (YZSave.share(name, 'application/json;charset=utf-8', txt)) { toast('已导出内容包（在分享面板里选发给谁）'); return; }
      }
      if (window.YZSave && window.YZSave.text) { window.YZSave.text(name, 'application/json', txt); return; }
    } catch (e) {}
    try {
      var a = document.createElement('a');
      a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(txt);
      a.download = name; a.click();
    } catch (e) { toast('导出失败：' + e.message); }
  }

  /* 导入：追加式合并，不覆盖本机已有 */
  function importPack(text, force) {
    var pack;
    try { pack = JSON.parse(String(text || '')); } catch (e) { return { ok: false, msg: '不是合法的 JSON' }; }
    if (!pack || pack.format !== FMT) return { ok: false, msg: '这不是学通内容包（format 不符）' };
    if (!(pack.version >= 1)) return { ok: false, msg: '内容包版本过旧，请用新版导出' };
    if (pack.version > V) return { ok: false, msg: '内容包来自更新的版本（v' + pack.version + '），请先升级 App' };

    var ov = readOV(), tx = readTexts();
    var added = 0, skipped = 0;

    function mergeMap(target, src) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (k) {
        if (target[k] && !force) { skipped++; return; }
        target[k] = src[k]; added++;
      });
    }

    var dr = (pack.data && pack.data.overlay) || {};
    ov.concepts = ov.concepts || { edited: {} };
    ov.events = ov.events || { edited: {} };
    ov.resources = ov.resources || { edited: {} };
    ov.people = ov.people || { edited: {} };
    ['concepts', 'events', 'resources', 'people'].forEach(function (grp) {
      var sg = dr[grp] || {};
      ['edited'].forEach(function (f) {
        ov[grp][f] = ov[grp][f] || {};
        mergeMap(ov[grp][f], sg[f]);
      });
      if (sg.added && sg.added.length) {
        ov[grp].added = ov[grp].added || [];
        sg.added.forEach(function (item) {
          var key = item.id || item.name;
          var dup = ov[grp].added.some(function (x) { return (x.id || x.name) === key; });
          if (dup && !force) { skipped++; return; }
          if (dup) ov[grp].added = ov[grp].added.filter(function (x) { return (x.id || x.name) !== key; });
          ov[grp].added.push(item); added++;
        });
      }
    });

    var dt = (pack.data && pack.data.texts) || {};
    Object.keys(dt).forEach(function (file) {
      tx[file] = tx[file] || {};
      Object.keys(dt[file] || {}).forEach(function (idx) {
        if (Object.prototype.hasOwnProperty.call(tx[file], idx) && !force) { skipped++; return; }
        tx[file][idx] = dt[file][idx]; added++;
      });
    });

    try {
      localStorage.setItem('yzy_ov_v1', JSON.stringify(ov));
      localStorage.setItem('yzTextPatch', JSON.stringify(tx));
    } catch (e) { return { ok: false, msg: '本机存储写不进去：' + e.message }; }

    if (window.YZChanges) {
      window.YZChanges.add({
        act: 'import', kind: 'pack', ref: '', name: '内容包（来自 ' + (pack.site || '未知版本') + '）',
        note: '新增 ' + added + ' 处 · 跳过 ' + skipped + ' 处'
      });
    }
    try { if (window.YZY && window.YZY.reload) window.YZY.reload(); } catch (e) {}
    try { if (window.YZY && window.YZY.apply) window.YZY.apply(); } catch (e) {}
    return { ok: true, added: added, skipped: skipped, from: pack.site || '未知版本' };
  }

  /* ---------- 弹层 ---------- */
  function openPackPanel(mode) {
    var old = document.getElementById('yzPackPanel');
    if (old) { try { old.remove(); } catch (e) {} }
    var c = counts();
    var total = c.concepts + c.events + c.resources + c.people + c.texts;
    var w = document.createElement('div');
    w.id = 'yzPackPanel';
    w.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:100070;background:rgba(0,0,0,.6);' +
      'display:flex;align-items:center;justify-content:center;padding:16px';
    w.innerHTML =
      '<div style="width:100%;max-width:560px;background:var(--panel-bg,#1b1412);color:var(--panel-text,#f2e9e4);' +
      'border-radius:14px;padding:16px;max-height:88vh;overflow:auto">' +
      '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1">📦 内容包</b>' +
      '<button data-a="close" style="background:none;border:none;color:inherit;font-size:1.1rem">✕</button></div>' +
      '<p style="font-size:.76rem;opacity:.7;line-height:1.8;margin:8px 0">' +
        '只装你对内容的改动：概念 <b>' + c.concepts + '</b>、史料 <b>' + c.events + '</b>、' +
        '书库 <b>' + c.resources + '</b>、人物 <b>' + c.people + '</b>、正文段落 <b>' + c.texts + '</b> 处。' +
        '不含收藏、笔记、阅读进度。' +
      '</p>' +
      (mode === 'export'
        ? '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button data-a="doExport" style="flex:1;padding:10px;border-radius:9px;border:none;' +
            'background:var(--accent,#c9a227);color:#1b1412;font-weight:600">导出为 JSON（' + total + ' 处改动）</button>' +
          '</div>'
        : '<textarea id="yzPackIn" placeholder="粘贴内容包 JSON，或点下面的按钮选文件" ' +
            'style="width:100%;box-sizing:border-box;height:160px;margin-top:8px;padding:10px;border-radius:9px;' +
            'border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.28);color:inherit;font-size:.8rem"></textarea>' +
          '<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:.78rem">' +
            '<input type="checkbox" id="yzPackForce"> 强制覆盖本机已有的同一条改动</label>' +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button data-a="pickFile" style="padding:9px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.24);' +
            'background:transparent;color:inherit">选文件…</button>' +
            '<button data-a="doImport" style="flex:1;padding:10px;border-radius:9px;border:none;' +
            'background:var(--accent,#c9a227);color:#1b1412;font-weight:600">导入并合并</button>' +
          '</div>' +
          '<input type="file" id="yzPackFile" accept="application/json,.json" style="display:none">') +
      '<p id="yzPackMsg" style="font-size:.76rem;margin:10px 0 0;line-height:1.7;opacity:.85"></p>' +
      '</div>';
    document.body.appendChild(w);
    var msg = function (t, ok) {
      var el = w.querySelector('#yzPackMsg');
      if (el) { el.textContent = t; el.style.color = ok ? '#7bc47f' : '#e08a7a'; }
    };
    w.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
      if (!a) { if (ev.target === w) w.remove(); return; }
      if (a === 'close') return w.remove();
      if (a === 'doExport') { exportPack(); w.remove(); return; }
      if (a === 'pickFile') { w.querySelector('#yzPackFile').click(); return; }
      if (a === 'doImport') {
        var ta = w.querySelector('#yzPackIn');
        var force = !!(w.querySelector('#yzPackForce') || {}).checked;
        var r = importPack(ta.value, force);
        if (!r.ok) return msg('导入失败：' + r.msg, false);
        msg('完成：新增 ' + r.added + ' 处，跳过 ' + r.skipped + ' 处（已存在）。来源版本 ' + r.from + '。', true);
        return;
      }
    });
    var file = w.querySelector('#yzPackFile');
    if (file) file.onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var ta = w.querySelector('#yzPackIn');
        if (ta) ta.value = String(fr.result || '');
        msg('已读入 ' + f.name + '，点「导入并合并」。', true);
      };
      fr.readAsText(f);
    };
  }

  window.YZPack = {
    exportPack: exportPack,
    importPack: importPack,
    stats: counts,
    open: openPackPanel
  };
})();
