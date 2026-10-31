/* =====================================================================
   学通 · 书志卡（booknotes.js，0.17.38 新增）
   ---------------------------------------------------------------------
   解决什么问题：
     书库 431 条里，有 181 条简介不到 40 字，点进去几乎等于空壳。
     而"这本书是谁写的、什么时候写的、哪个版本、讲什么、从哪来、怎么读"
     这些问题，属于目录学的「解题」传统——《四库全书总目》提要做的事就是
     「先列作者之爵里，以论世知人；次考本书之得失，权众说之异同」。
   写什么、不写什么（重要）：
     · 只写可核实的硬事实：作者、成书与出版、版本与中译、章节结构、作者自述。
     · 有争议的地方如实写成「有争议」，不替读者下结论；评价类只列说法。
     · 不写页码、不写印数、不编造引文——宁可少写一条，也不写一条查不到的。
   数据在 data/booknotes.js（window.SITE_BOOKNOTES，键为书库 id）。
   ===================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function data() { return window.SITE_BOOKNOTES || {}; }

  /* 字段顺序即显示顺序：作者 → 成书 → 版本 → 大要 → 源流 → 读法 */
  var ROWS = [
    ['author', '作者'],
    ['written', '成书'],
    ['edition', '版本与中译'],
    ['summary', '内容大要'],
    ['lineage', '源流与争议'],
    ['howto', '读法']
  ];

  function block(idOrTitle) {
    var D = data();
    var note = D[idOrTitle];
    if (!note) {
      /* 也允许用书名查（资源 id 会变，书名更稳） */
      for (var k in D) if (D[k] && D[k].title === idOrTitle) { note = D[k]; break; }
    }
    if (!note) return '';
    var rows = '';
    for (var i = 0; i < ROWS.length; i++) {
      var v = note[ROWS[i][0]];
      if (!v) continue;
      rows += '<div class="bn-row"><div class="bn-k">' + ROWS[i][1] + '</div>'
        + '<div class="bn-v">' + esc(v) + '</div></div>';
    }
    if (!rows) return '';
    return '<details class="booknote" ' + (note.open ? 'open' : '') + '>'
      + '<summary>📖 书志 <span class="bn-hint">作者 · 成书 · 版本 · 大要 · 源流 · 读法</span></summary>'
      + '<div class="bn-body">' + rows + '</div>'
      + (note.src ? '<div class="bn-src">依据：' + esc(note.src) + '</div>' : '')
      + '</details>';
  }

  window.YZBookNote = {
    block: block,
    has: function (id) { return !!data()[id]; },
    count: function () { return Object.keys(data()).length; },
    ids: function () { return Object.keys(data()); }
  };
})();
