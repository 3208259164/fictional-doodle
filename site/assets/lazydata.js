/* =====================================================================
   学通 · 首屏数据延迟加载（lazydata.js，0.17.35 新增）
   ---------------------------------------------------------------------
   为什么做：
     首页启动阶段其实并不读这些数据（用 defineProperty 拦截 window 属性的读取栈，
     实测出「首屏只读 12 个全局、另有 12 个一次都没读」），但它们在 index.html
     里是同步 <script>，白白拖慢首屏。
   怎么做：
     ① 先放「形状一致的空壳」——任何 window.SITE_X.y 访问都不会抛 TypeError；
     ② 页面 load 之后 80ms，或用户第一次交互（按下 / 按键 / 聚焦）时开始串行注入；
     ③ 全部注入完成后清掉派生索引缓存（__yzPyIdx 等），重放一次本机改动并重绘。
   边界（重要）：
     app.js 顶部用 const 快照了 RES / CT / EX / LIBS / GR，
     所以 resources.js、content.js、knowledge.js、libraries.js、graph.js
     必须保持同步加载，绝不能加进 LAZY。
   ===================================================================== */
(function () {
  'use strict';

  var LAZY = [
    /* 首屏不读、但一点就可能要用的：图谱数据 / 网络词条。排最前，尽早到位。 */
    'data/graph.js',
    'data/netbasics.js',
    'data/nett.js',
    'data/py.js',
    /* guides.js（导读/逐节研读）是书详情页一进去就要用的，排在前面；
       以前排在第 10 位，进详情页要等三四秒导读区才出现 */
    'data/guides.js',
    'data/intro-short.js',
    'data/author-alias.js',
    'data/authors-bio.js',
    'data/mentors.js',
    'data/album.js',
    'data/channel.js',
    'data/answers.js',
    'data/glossary.js',
    'data/concepts.js',
    'data/avatars.js',
    'data/booknotes.js',
    /* 检索合并后主站也要能问答：这两个模块原本只在 ask.html 加载 */
    'assets/qa-engine.js',
    'assets/booksearch.js',
    /* 讲堂列表的两行预览（27 条，6.6KB）。首屏不读，滚到书库才用到，
       放最后注入；afterAll 会重绘一次，预览自然补上。 */
    'data/jtprev.js'
  ];

  /* 空壳：字段形状与真实数据一致。用 in 判断，避免覆盖已经先到的真实数据。 */
  var SHELL = {
    SITE_PY: {},
    YZ_INTRO_SHORT: {},
    YZ_AUTHOR_ALIAS: {},
    YZ_AUTHOR_BIO: {},
    SITE_MENTOR_LIFE: {},
    SITE_ALBUM: [],
    SITE_CHANNEL: [],
    SITE_ANSWERS: { intro: '', groups: [] },
    SITE_GLOSSARY: [],
    SITE_GUIDES: [],
    SITE_CONCEPTS: { nodes: [], links: [] },
    AVATAR_FILES: {},
    SITE_BOOKNOTES: {}
  };
  for (var k in SHELL) {
    if (!(k in window) || window[k] == null) window[k] = SHELL[k];
  }

  var started = false, done = 0, failed = [];

  function afterAll() {
    /* 清派生缓存：pyIndex() 会把 window.SITE_PY 的结果缓存成数组，
       空壳期间若被调用过，必须清掉，否则拼音搜索永远是空的 */
    try { window.__yzPyIdx = null; } catch (e) { }
    /* 图谱数据延迟到达：先让覆盖层丢弃空基线，再把数据填进 app.js 那份 GR */
    try { if (window.YZY && YZY.resetBaseGraph) YZY.resetBaseGraph(); } catch (e) { }
    try {
      if (window.SITE_GRAPH && window.__YZ_GR) {
        window.__YZ_GR.nodes = window.SITE_GRAPH.nodes || [];
        window.__YZ_GR.links = window.SITE_GRAPH.links || [];
      }
    } catch (e) { }
    /* 重放本机改动（编辑层）并重绘一次 */
    try { if (window.YZY && YZY.reapply) YZY.reapply(); } catch (e) { }
    try { if (typeof renderHomeFriends === 'function') renderHomeFriends(); } catch (e) { }
    try { if (typeof render === 'function') render(); } catch (e) { }
    /* 导读区（逐节研读）依赖 guides.js，它就在上面这批里。
       早先渲染书详情时它还没到，那块就空着——这里补画一次。 */
    try { if (window.yzFillGuide) window.yzFillGuide(); } catch (e) { }
    try { window.dispatchEvent(new CustomEvent('yz:lazydata')); } catch (e) { }
    try {
      if (window.console && console.info) {
        console.info('[学通] 延迟数据已就绪 ' + done + '/' + LAZY.length + (failed.length ? ('，失败：' + failed.join(',')) : ''));
      }
    } catch (e) { }
  }

  function next(i) {
    if (i >= LAZY.length) { afterAll(); return; }
    var s = document.createElement('script');
    s.src = LAZY[i] + (window.__YZV ? ('?v=' + window.__YZV) : '');
    s.async = false;                       /* 保持顺序：后一个可能依赖前一个 */
    s.onload = function () { done++; next(i + 1); };
    s.onerror = function () { failed.push(LAZY[i]); next(i + 1); };
    document.head.appendChild(s);
  }

  function kick() {
    if (started) return;
    started = true;
    next(0);
  }

  window.YZData = {
    lazy: LAZY,
    kick: kick,
    started: function () { return started; },
    /* 需要「数据到位再渲染」的地方可以用：YZData.ready(function(){ ... }) */
    ready: function (cb) {
      if (done >= LAZY.length) { try { cb(); } catch (e) { } return; }
      window.addEventListener('yz:lazydata', function () { try { cb(); } catch (e) { } }, { once: true });
      kick();
    }
  };

  /* 触发时机：先 load+80ms；用户若先动手就立刻开始 */
  if (document.readyState === 'complete') setTimeout(kick, 80);
  else window.addEventListener('load', function () { setTimeout(kick, 80); });
  ['pointerdown', 'touchstart', 'keydown', 'focusin'].forEach(function (t) {
    window.addEventListener(t, kick, { passive: true, once: true });
  });
})();
