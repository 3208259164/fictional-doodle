/* =====================================================================
   学通 · 电子书阅读（appbooks.js，0.17.36 新增）
   ---------------------------------------------------------------------
   解决的问题：
     书库里有 431 个书目入口，但站内一篇原文都没有；用户手上的真书
     （EPUB / PDF）之前导入后「EPUB 提示开发中、PDF 完全读不了」。
   怎么做的：
     走 App 侧的零依赖实现——EPUB 用 java.util.zip 自己解包解析，
     PDF 用系统 PdfRenderer 逐页出图（都不需要第三方库、不需要联网）。
     本文件只负责「选书 → 书架 → 阅读器 → 记进度」这一层。
   边界：
     · 只在 App 内可用（浏览器没有 AndroidApp 桥，会明确提示而不是假装能用）
     · PDF 是「页图」，不能选中文字（系统 PdfRenderer 不暴露文本层）
     · 文件本身存在 App 私有目录，卸载即消失；书籍元信息在 localStorage
   ===================================================================== */
(function () {
  'use strict';

  var LS = 'yzBookPos';           /* 阅读进度：{ id: { ch:0, page:0, t:时间 } } */
  var CSS_ID = 'yzBkStyle';

  function app() { try { return window.AndroidApp || null; } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toast(m) { try { if (typeof window.toast === 'function') window.toast(m); else console.log(m); } catch (e) { } }
  /* 进度双写：localStorage 快，原生 SharedPreferences 稳。
     localStorage 在 WebView 里可能被整片清掉（系统空间不足 / WebView 升级 / 清缓存），
     而它的底层 LevelDB 损坏后 Android 上没有 API 能修，所以必须留一份在原生。 */
  var _posLoaded = false;
  function posAll() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { o = {}; }
    if (!o || typeof o !== 'object') o = {};
    var A = app();
    if (!_posLoaded && A && A.bookPosLoad) {
      _posLoaded = true;
      try {
        var n = JSON.parse(A.bookPosLoad() || '{}');
        if (n && typeof n === 'object') {
          /* 以「更晚的那条」为准：本地有就用本地，缺了才用原生的 */
          for (var k in n) if (!o[k] || (n[k].t || 0) > (o[k].t || 0)) o[k] = n[k];
          try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { }
        }
      } catch (e) { }
    }
    return o;
  }
  function posSet(id, p) {
    try {
      p = p || {};
      p.t = Date.now();     /* 记下时间：「继续阅读」和「最近」标签靠它排序 */
      var o = posAll(); o[id] = p;
      localStorage.setItem(LS, JSON.stringify(o));
      var A = app();
      if (A && A.bookPosSave) A.bookPosSave(JSON.stringify(o));
    } catch (e) { }
  }
  function posGet(id) { return posAll()[id] || null; }

  function ensureCSS() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      '.yzbox{position:fixed;top:0;right:0;bottom:0;left:0;width:100%;height:100%;z-index:130;display:none;flex-direction:column;background:var(--panel-bg,#150c0c);color:var(--panel-text,#f2e9e4);overflow:hidden}',
      '.yzbox.open{display:flex}',
      /* 抽屉留在下面时，它的渐变 + backdrop-filter 会一直参与合成，手机上明显掉帧；
         而且关闭动画有 250ms 延时隐藏，会从书架底下透出来。打开书架就把它移出渲染树。 */
      'body.yzbk-open .drawer,body.yzbk-open #scrim,body.yzbk-open #qPanel,body.yzbk-open #qScrim,'
      + 'body.yzshelf-open .drawer,body.yzshelf-open #scrim,body.yzshelf-open #qPanel,body.yzshelf-open #qScrim{display:none!important}',
      'body.yzbk-open,body.yzshelf-open{overflow:hidden}',
      /* 阅读器打开时把书架整层藏起来（不是 display:none 到 0 尺寸，关掉就原位露出） */
      'body.yzbk-open #yzshelf{display:none!important}',
      '#yzbk{z-index:135}',
      '#yzshelf{z-index:130}',
      /* 回到 flex 占位：工具栏在布局里吃饭，绝不压在正文/书架按钮上。
         上一版为了「隐藏时省空间」改成 absolute，结果直接盖住了书架第一行按钮。 */
      '.yzbox .bk-top{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 10px;border-bottom:1px solid var(--panel-line,rgba(255,255,255,.14));flex:0 0 auto}',
      '.yzbox .bk-title{flex:1;min-width:0;font-weight:700;font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.yzbox .bk-btn{border:1px solid var(--panel-btn-line,rgba(255,255,255,.2));background:var(--panel-btn,rgba(255,255,255,.08));color:var(--panel-btn-text,inherit);border-radius:9px;padding:6px 11px;font-family:inherit;font-size:.82rem;cursor:pointer;flex:0 0 auto}',
      '.yzbox .bk-btn:disabled{opacity:.4}',
      /* touch-action / overscroll-behavior 都不写：默认值就是「交给浏览器滚」。
         之前写了 pan-y + contain，在部分 WebView 上会让滚动变得很黏甚至滑不动。 */
      '.yzbox .bk-body{flex:1 1 0;min-height:0;overflow-y:auto;overflow-x:hidden;padding:14px 16px 40px;line-height:1.95;font-size:1rem}',
      '.yzbox .bk-body p{margin:0 0 .95em}',
      '.yzbox .bk-body h1,.yzbox .bk-body h2,.yzbox .bk-body h3{font-size:1.06rem;margin:1.3em 0 .6em;line-height:1.5}',
      '.yzbox .bk-body img{max-width:100%;height:auto}',
      '.yzbox .bk-body blockquote{margin:.8em 0;padding-left:.9em;border-left:3px solid var(--panel-accent,#f5c518);opacity:.9}',
      /* 顶栏/底栏做成悬浮层（absolute），隐藏时正文高度不变、不会跳动 */
      '.yzbox .bk-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;',
      '  padding:8px 12px calc(env(safe-area-inset-bottom,0px) + 8px);border-top:1px solid var(--panel-line,rgba(255,255,255,.14));',
      '  font-size:.8rem;background:inherit}',
      '.yzbox .bk-seekwrap{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.yzbox .bk-seekwrap input[type=range]{width:100%;height:20px;margin:0;-webkit-appearance:none;background:transparent}',
      '.yzbox .bk-seekwrap input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:rgba(128,128,128,.4)}',
      '.yzbox .bk-seekwrap input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;margin-top:-6px;',
      '  border-radius:50%;background:var(--panel-accent,#f5c518);box-shadow:0 1px 3px rgba(0,0,0,.4)}',
      '.yzbox .bk-pnum{align-self:center;border:none;background:none;color:inherit;font:inherit;font-size:.76rem;opacity:.8;padding:0;cursor:pointer}',
      '.yzbox .bk-foot .bk-nav{flex:0 0 auto;padding:.2rem .5rem;font-size:.95rem;line-height:1}',
      '.yzbox .bk-foot .sp{flex:1}',
      '.yzbox .bk-list{padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 20px)}',
      '.yzbox .bk-item{display:flex;align-items:center;gap:10px;padding:12px 10px;border-bottom:1px solid var(--panel-line,rgba(255,255,255,.1));cursor:pointer}',
      '.yzbox .bk-item .ic{width:34px;height:34px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--panel-btn,rgba(255,255,255,.08));font-size:1rem}',
      '.yzbox .bk-item .nm{flex:1;min-width:0}',
      '.yzbox .bk-item .nm b{display:block;font-weight:600;font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.yzbox .bk-item .nm span{font-size:.74rem;opacity:.65}',
      '.yzbox .bk-item .nm .bk-shell{display:block;font-size:.7rem;opacity:.55;margin-top:2px;color:var(--panel-accent,#f5c518)}',
      '.yzbox .bk-item .go{opacity:.5;font-size:1.1rem}',
      '.yzbox .bk-empty{padding:40px 20px;text-align:center;opacity:.7;line-height:2}',
      '.yzbox .bk-toolbar{display:flex;gap:8px;padding:10px 12px 6px;flex-wrap:wrap}',
      '.yzbox .bk-import{background:var(--panel-accent,#f5c518)!important;color:#241b00!important;border-color:transparent!important;font-weight:700}',
      '.yzbox .bk-tip{padding:0 12px 4px;font-size:.74rem;opacity:.62;line-height:1.5}',
      /* 继续阅读：一条，不做成第二个书架 */
      '.yzbox .bk-cont{display:flex;align-items:center;gap:10px;margin:8px 12px 2px;padding:10px 12px;border-radius:10px;',
      '  background:var(--panel-btn,rgba(255,255,255,.08));border:1px solid var(--panel-line,rgba(255,255,255,.12));cursor:pointer}',
      '.yzbox .bk-cont .ic{width:30px;height:30px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;',
      '  border-radius:50%;background:var(--panel-accent,#f5c518);color:#241b00;font-size:.8rem}',
      '.yzbox .bk-cont .nm{flex:1;min-width:0}',
      '.yzbox .bk-cont .nm b{display:block;font-size:.88rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.yzbox .bk-cont .nm span{font-size:.72rem;opacity:.62}',
      /* 三个标签页 */
      '.yzbox .bk-tabs{display:flex;gap:6px;padding:10px 12px 0;overflow-x:auto;-webkit-overflow-scrolling:touch}',
      '.yzbox .bk-tab{flex:0 0 auto;border:1px solid var(--panel-line,rgba(255,255,255,.16));background:transparent;color:inherit;',
      '  border-radius:999px;padding:.34rem .72rem;font-size:.8rem;cursor:pointer;white-space:nowrap}',
      '.yzbox .bk-tab.on{background:var(--panel-accent,#f5c518);color:#241b00;border-color:transparent;font-weight:700}',
      '.yzbox .bk-tools{display:flex;gap:8px;align-items:center;padding:8px 12px 2px}',
      '.yzbox .bk-tools select{flex:1 1 auto;min-width:0;font:inherit;font-size:.8rem;padding:.3rem .4rem;border-radius:.45rem;',
      '  border:1px solid var(--panel-line,rgba(255,255,255,.16));background:var(--panel-btn,rgba(255,255,255,.07));color:inherit}',
      '.yzbox .bk-tools .bk-btn{flex:0 0 auto;font-size:.8rem;padding:.3rem .6rem}',
      /* 网格视图：两列卡片（不是封面墙——本站没有封面图） */
      '.yzbox .bk-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:6px 12px 20px}',
      '.yzbox .bk-grid .bk-item{flex-direction:column;align-items:flex-start;gap:7px;position:relative;',
      '  border:1px solid var(--panel-line,rgba(255,255,255,.12));border-radius:10px;padding:10px;border-bottom:none}',
      '.yzbox .bk-grid .bk-item .ic{width:38px;height:38px;font-size:1.15rem}',
      '.yzbox .bk-grid .bk-item .nm b{white-space:normal;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.yzbox .bk-grid .bk-item .go{position:absolute;right:6px;top:6px;opacity:.4}',
      '.yzbox .bk-item{position:relative}',
      '.yzbox .bk-item .pg{position:absolute;left:10px;right:10px;bottom:3px;height:2px;border-radius:2px;background:rgba(128,128,128,.25);overflow:hidden}',
      '.yzbox .bk-item .pg i{display:block;height:100%;background:var(--panel-accent,#f5c518);border-radius:2px}',
      '.yzbox .bk-item.bk-dim{opacity:.72}',
      '.yzbox .bk-item .bk-chk{flex:0 0 auto;width:22px;height:22px;margin-right:2px;border-radius:50%;',
      '  border:2px solid var(--panel-line,rgba(255,255,255,.34));display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700}',
      '.yzbox .bk-item.bk-picked .bk-chk{background:var(--panel-accent,#f5c518);color:#241b00;border-color:transparent}',
      '.yzbox .bk-selbar{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 10px);',
      '  background:var(--panel-bg2,#241414);border-top:1px solid var(--panel-line,rgba(255,255,255,.16));z-index:2}',
      '.yzbox .bk-selbar .n{flex:1;font-size:.82rem;opacity:.85}',
      '.yzbox .bk-item .ic{flex:0 0 auto}',
      '.yzbox .bk-sec{padding:14px 12px 6px;font-size:.76rem;letter-spacing:1px;opacity:.6}',
      '.yzbox .bk-pdfimg{display:block;width:100%;height:auto;max-width:100%;margin:0 auto;',
      '  border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,.28),0 6px 18px rgba(0,0,0,.16)}',
      '.yzbox .bk-stage{display:block;width:100%}',
      /* 连续滚动：多页竖着排，上下滑动一路读下去 */
      '.yzbox.fit-scroll .bk-body{padding:10px 10px calc(env(safe-area-inset-bottom,0px) + 24px)}',
      '.yzbox .bk-flow{display:block}',
      '.yzbox .bk-pg{margin:0 0 10px;text-align:center}',
      '.yzbox .bk-pg img{width:100%;height:auto;display:block;border-radius:2px;',
      '  box-shadow:0 1px 3px rgba(0,0,0,.24),0 5px 16px rgba(0,0,0,.14)}',

      '.yzbox.fit-page .bk-stage{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '.yzbox .bk-txt{padding:4px 2px 30px;line-height:1.95;font-size:1rem}',
      '.yzbox .bk-txt p{margin:0 0 1em}',
      '.yzbox .bk-txt .bk-h{margin:1.4em 0 .6em;font-size:1.06rem;line-height:1.5;opacity:.92}',
      /* 阅读进度条：3px，贴在底部按钮栏上方 */
      '.yzbox .bk-prog{flex:0 0 auto;height:3px;background:rgba(128,128,128,.22);overflow:hidden}',
      '.yzbox .bk-prog i{display:block;height:100%;width:0;background:var(--panel-accent,#f5c518);transition:width .2s}',
      /* 沉浸阅读：中间点一下收起顶栏与底栏 */
      /* 收起 = 直接不占位也不显示。上一版做成悬浮层，结果压在正文和书架按钮上，
         这里退回最简单的方式：显示时占位、隐藏时让出空间，绝不覆盖任何内容。 */
      '.yzbox.chrome-off .bk-top{display:none!important}',
      '.yzbox.chrome-off .bk-foot{display:none!important}',
      '.yzbox.chrome-off .bk-prog{display:none!important}',
      /* Aa 排版面板 */
      '.yzbox .bk-aa{position:absolute;right:10px;top:calc(env(safe-area-inset-top,0px) + 52px);z-index:3;',
      '  min-width:210px;padding:10px 12px;border-radius:12px;background:var(--panel-bg2,#241414);',
      '  border:1px solid var(--panel-line,rgba(255,255,255,.18));box-shadow:0 8px 22px rgba(0,0,0,.34)}',
      '.yzbox .bk-aa[hidden]{display:none}',
      '.yzbox .bk-aa .row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:.82rem}',
      '.yzbox .bk-aa .row>span{flex:0 0 62px;opacity:.75}',
      '.yzbox .bk-aa .row .bk-btn{flex:1 1 0;padding:.28rem .4rem;font-size:.8rem}',
      '.yzbox .bk-aa .row .on{background:var(--panel-accent,#f5c518);color:#241b00;border-color:transparent;font-weight:700}',
      /* 划词卡片：选中正文里的词，弹本站自己的解释（术语/概念/人物/事件） */
      '.yzbox .bk-word{position:absolute;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);z-index:4;',
      '  padding:11px 13px;border-radius:14px;background:var(--panel-bg2,#241414);border:1px solid var(--panel-line,rgba(255,255,255,.2));',
      '  box-shadow:0 10px 28px rgba(0,0,0,.4)}',
      '.yzbox .bk-word[hidden]{display:none}',
      '.yzbox .bk-word .w-top{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
      '.yzbox .bk-word .w-kind{flex:0 0 auto;font-size:.68rem;padding:.1rem .4rem;border-radius:.35rem;',
      '  background:var(--panel-accent,#f5c518);color:#241b00;font-weight:700}',
      '.yzbox .bk-word .w-name{flex:1;min-width:0;font-size:.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.yzbox .bk-word .w-x{flex:0 0 auto;padding:.1rem .5rem}',
      '.yzbox .bk-word .w-brief{font-size:.82rem;line-height:1.65;opacity:.85;max-height:5.1em;overflow:hidden}',
      '.yzbox .bk-word .w-ops{display:flex;gap:8px;margin-top:8px}',
      '.yzbox .bk-word .w-ops .bk-btn{flex:1;padding:.3rem .4rem;font-size:.8rem}',
      /* ---- 阅读态配色：和站点深红主题解耦 ----
         PDF 页图是白底的，压在一片深红上边缘会特别刺眼。阅读器自己一套配色：
         纸白（日间）与夜间两档，退出阅读器就还原成站点主题。 */
      'html body .yzbox.bk-read{background:#ece7dc;color:#26221c}',
      'html body .yzbox.bk-read .bk-top{background:#e3ddce;border-bottom-color:rgba(0,0,0,.1)}',
      'html body .yzbox.bk-read .bk-foot{background:#e3ddce;border-top-color:rgba(0,0,0,.1)}',
      'html body .yzbox.bk-read .bk-btn{border-color:rgba(0,0,0,.16);background:rgba(0,0,0,.05);color:#26221c}',
      'html body .yzbox.bk-read.night{background:#141416;color:#d9d5cc}',
      'html body .yzbox.bk-read.night .bk-top{background:#1c1c1f;border-bottom-color:rgba(255,255,255,.1)}',
      'html body .yzbox.bk-read.night .bk-foot{background:#1c1c1f;border-top-color:rgba(255,255,255,.1)}',
      'html body .yzbox.bk-read.night .bk-btn{border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#d9d5cc}',
      'html body .yzbox.bk-read.night .bk-pdfimg{box-shadow:0 1px 3px rgba(0,0,0,.6),0 6px 22px rgba(0,0,0,.5)}',
      'html body .yzbox.bk-read.night .bk-txt{color:#c9c5bd}',
      /* 纯黑档：OLED 上省电，也给喜欢全黑的人。字依然不是纯白 */
      'html body .yzbox.bk-read.black{background:#000;color:#b8b4ac}',
      'html body .yzbox.bk-read.black .bk-top{background:#0a0a0b;border-bottom-color:rgba(255,255,255,.08)}',
      'html body .yzbox.bk-read.black .bk-foot{background:#0a0a0b;border-top-color:rgba(255,255,255,.08)}',
      'html body .yzbox.bk-read.black .bk-btn{border-color:rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#b8b4ac}',
      'html body .yzbox.bk-read.black .bk-pdfimg,.yzbox.bk-read.black .bk-pg img{box-shadow:none}',
      /* 只作用于「正在读 PDF」的书架主体。原来只写了 .fit-page .bk-body，
         结果点过「整页」之后回到书架，书架列表也被 flex 居中挤压，
         表现为「主体大片空白、只剩一条书居中」——就是用户截图那个画面。 */
      '.yzbox.fit-page .bk-body.pdfread{display:flex;align-items:center;justify-content:center}',
      '.yzbox.fit-page .bk-pdfimg{width:auto;height:auto;max-width:100%;max-height:100%}',
      '.yzbox .bk-toc{padding:6px 0 24px}',
      '.yzbox .bk-toc a{display:block;padding:11px 16px;border-bottom:1px solid var(--panel-line,rgba(255,255,255,.08));color:inherit;text-decoration:none;font-size:.9rem}',
      '.yzbox .bk-toc a.on{color:var(--panel-accent,#f5c518);font-weight:700}',
      'body.light .yzbox,body.sepia .yzbox{background:var(--panel-bg,#fdf6ec);color:var(--panel-text,#2a2320)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------- 两个浮层，各管一摊 ----------------
     以前书架和阅读器共用 #yzbk 一个容器、一套 .bk-* 元素：
     进阅读态要手工把字号/边距/顶栏按钮一样样复位，漏一样就把书架搞乱
     （事故：fit-page 类残留 → 书架列表被 flex 居中挤成空白；
            顶栏挂着「整页 / 页码 / 日夜间」→ 书架上点它出错）。

     现在：
       · #yzshelf  —— 书架（只有标题 / 关闭 / 正文三块）
       · #yzbk     —— 阅读器（完整顶栏底栏；内部 id 前缀 yzbk* 保持原样，
                     阅读器相关的 60 多处代码一行都不用改）
     两者用同一个 class="yzbox" 共享排版样式。 */

  function shell() {                       /* 书架容器 */
    ensureCSS();
    var el = document.getElementById('yzshelf');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yzshelf';
      el.className = 'yzbox';
      el.innerHTML = '<div class="bk-top"><div class="bk-title" id="yzsTitle">📚 我的书</div>'
        + '<button class="bk-btn" type="button" onclick="YZAppBooks.close()">✕</button></div>'
        + '<div class="bk-body" id="yzsBody"></div>';
      document.body.appendChild(el);
    }
    return el;
  }

  function readerShell() {                 /* 阅读器容器 */
    ensureCSS();
    var el = document.getElementById('yzbk');
    if (!el) {
      el = document.createElement('div');
      el.id = 'yzbk';
      el.className = 'yzbox';
      el.innerHTML = '<div class="bk-top"><div class="bk-title" id="yzbkTitle">电子书</div>'
        + '<button class="bk-btn" type="button" id="yzbkFit" style="display:none">适宽</button>'
        + '<button class="bk-btn" type="button" id="yzbkTheme" style="display:none">🌙</button>'
        + '<button class="bk-btn" type="button" id="yzbkAA" style="display:none">Aa</button>'
        + '<button class="bk-btn" type="button" id="yzbkAct">目录</button>'
        + '<button class="bk-btn" type="button" onclick="YZAppBooks.close()">✕</button></div>'
        + '<div class="bk-body" id="yzbkBody"></div>'
        + '<div class="bk-prog" id="yzbkProg" style="display:none"><i></i></div>'
        + '<div class="bk-aa" id="yzbkAAPanel" hidden></div>'
        + '<div class="bk-word" id="yzbkWord" hidden>'
        + '  <div class="w-top"><span class="w-kind"></span><b class="w-name"></b>'
        + '    <button class="bk-btn w-x" type="button" onclick="YZAppBooks.wordClose()">×</button></div>'
        + '  <div class="w-brief"></div>'
        + '  <div class="w-ops"><button class="bk-btn" type="button" onclick="YZAppBooks.wordOpen()">看完整条目</button>'
        + '    <button class="bk-btn" type="button" onclick="YZAppBooks.wordExcerpt()">存为摘录</button></div>'
        + '</div>'
        + '<div class="bk-foot" id="yzbkFoot">'
        + '  <button class="bk-btn bk-nav" type="button" id="yzbkPrev">‹</button>'
        + '  <div class="bk-seekwrap">'
        + '    <input type="range" id="yzbkSeek" min="0" max="1" value="0" step="1" aria-label="阅读进度">'
        + '    <button class="bk-pnum" type="button" id="yzbkInfo">第 1 页</button>'
        + '  </div>'
        + '  <button class="bk-btn bk-nav" type="button" id="yzbkNext">›</button>'
        + '</div>';
      document.body.appendChild(el);
    }
    return el;
  }

  /* ---------------- 书架（0.17.38：两套书合并成一处） ----------------
     历史原因这里原先有两套：
       · books.js  → 「我的书」，网页侧导入 TXT/MD，存 IndexedDB，能读纯文本
       · appbooks.js → 「我的电子书」，App 侧导入 EPUB/PDF，存私有目录，能分章/翻页
     同一件事两个入口、两套存储、能力还互补，属于必须合并的重复。
     现在统一成「我的书」一页，按「能用什么方式读」分成两组，点哪本走对应阅读器。 */
  var _list = [];

  function localBooks() {
    try {
      var m = window.yzBooks && window.yzBooks.meta ? window.yzBooks.meta() : [];
      if (!Array.isArray(m)) return [];
      return m.filter(function (b) { return b && b.id; });
    } catch (e) { return []; }
  }

  /* ================= 书架视图 =================
     三个标签页解决的是「本机只有几本、书库却有几百条」这件事：
     有原文的排最前（能直接读），只有书壳的排后面（能看介绍、能挂文件）。
     以前这是两个割裂的入口——「我的书」里只有导入的几本，431 条书壳在书库里另开一页，
     用户不知道该去哪边找，也就没法把「书壳」和「本机文件」对上号。 */
  var SHELF = { tab: 'mine', sort: 'at', view: 'list', more: 60, shell: [], manage: false };
  var SEL = {};   /* 批量管理时被勾中的书 id */

  function shelfPrefLoad() {
    try {
      var o = JSON.parse(localStorage.getItem('yzShelfPref') || '{}') || {};
      if (o.tab === 'mine' || o.tab === 'shell' || o.tab === 'recent') SHELF.tab = o.tab;
      if (o.sort) SHELF.sort = o.sort;
      if (o.view === 'grid' || o.view === 'list') SHELF.view = o.view;
    } catch (e) { }
  }
  function shelfPrefSave() {
    try { localStorage.setItem('yzShelfPref', JSON.stringify({ tab: SHELF.tab, sort: SHELF.sort, view: SHELF.view })); } catch (e) { }
  }
  function progPct(b) {
    var p = posGet(b.id) || {};
    if (typeof p.pct === 'number') return Math.max(0, Math.min(100, p.pct));
    if (typeof p.page === 'number' && b.pages) return Math.max(0, Math.min(100, Math.round((p.page + 1) / b.pages * 100)));
    if (typeof p.ch === 'number' && b.chapters) return Math.max(0, Math.min(100, Math.round((p.ch + 1) / b.chapters * 100)));
    return 0;
  }
  function lastName(x) { return String((x && (x.name || x.title)) || ''); }
  function sortList(arr, by) {
    var a = arr.slice();
    if (by === 'title') a.sort(function (x, y) { return lastName(x).localeCompare(lastName(y), 'zh'); });
    else if (by === 'size') a.sort(function (x, y) { return (Number(y.size) || 0) - (Number(x.size) || 0); });
    else if (by === 'progress') a.sort(function (x, y) { return progPct(y) - progPct(x); });
    else if (by === 'read') a.sort(function (x, y) {
      var tx = Number((posGet(x.id) || {}).t) || 0, ty = Number((posGet(y.id) || {}).t) || 0;
      return ty - tx;
    });
    else a.sort(function (x, y) { return (Number(y.at) || 0) - (Number(x.at) || 0); });
    return a;
  }
  function sizeTxt2(n) {
    n = Number(n) || 0;
    if (!n) return '';
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  }
  /* 一条书的 DOM。列表 / 网格共用同一份结构，靠 CSS 换样子。 */
  function itemHTML(b, opt) {
    opt = opt || {};
    var managing = SHELF.manage && !opt.noSel && b && b.id;
    if (managing) opt.click = 'YZAppBooks.sel(\'' + esc(b.id) + '\')';
    var p = posGet(b.id) || {};
    var pct = progPct(b);
    var isPdf = b.type === 'pdf', isEpub = b.type === 'epub';
    var sub = opt.sub;
    if (sub == null) {
      sub = isPdf ? 'PDF' : (isEpub ? 'EPUB' : String(b.type || b.fmt || 'TXT').toUpperCase());
      var sz = sizeTxt2(b.size); if (sz) sub += ' · ' + sz;
      if (isPdf && typeof p.page === 'number') sub += ' · 读到第 ' + (p.page + 1) + ' 页';
      else if (isEpub && typeof p.ch === 'number') sub += ' · 读到第 ' + (p.ch + 1) + ' 章';
      else if (pct) sub += ' · 读到 ' + pct + '%';
    }
    var ic = opt.ic || (isPdf ? '📄' : (isEpub ? '📖' : '📃'));
    var cls = 'bk-item' + (SHELF.view === 'grid' ? ' bk-cell' : '') + (opt.cls ? ' ' + opt.cls : '');
    var right = opt.right != null ? opt.right : '<div class="go">›</div>';
    var picked = managing && SEL[b.id];
    return '<div class="' + cls + (picked ? ' bk-picked' : '') + '"' + (opt.click ? ' onclick="' + opt.click + '"' : '') + '>'
      + (managing ? '<div class="bk-chk">' + (picked ? '✓' : '') + '</div>' : '')
      + '<div class="ic">' + ic + '</div>'
      + '<div class="nm"><b>' + esc(opt.title != null ? opt.title : (b.name || b.title || b.id)) + '</b>'
      + '<span>' + esc(sub) + '</span>'
      + (function () {
        var sh = shellFor(b.id);
        return sh && sh.title ? '<span class="bk-shell">📚 ' + esc(String(sh.title).slice(0, 28)) + '</span>' : '';
      })()
      + '</div>'
      + right
      + (pct ? '<div class="pg"><i style="width:' + pct + '%"></i></div>' : '')
      + '</div>';
  }

  /* ---- 书壳挂载（新通道）----
     书库里 431 条「书壳」是元数据；本机导入的是文件。两者本该是一回事：
     一本《国家与革命》只有一条记录，下面挂着一个本机文件。
     旧通道（books.js）在导入时会问「要不要挂到书壳下」，但走书架导入的书不经过它，
     所以这里补一条：导入后按书名相似度自动认领；从详情页点「导入本书」的则强制挂到那一条。 */
  var __shellCache = null;
  function shellMapAll() {
    if (__shellCache) return __shellCache;
    try {
      var o = JSON.parse(localStorage.getItem('yzBookShellMap') || '{}');
      __shellCache = (o && typeof o === 'object') ? o : {};
    } catch (e) { __shellCache = {}; }
    return __shellCache;
  }
  function shellSave(m) {
    __shellCache = m || {};
    try { localStorage.setItem('yzBookShellMap', JSON.stringify(__shellCache)); } catch (e) { }
    try { if (window.shellMapInvalidate) window.shellMapInvalidate(); } catch (e) { }  /* 让书库那边的缓存同步失效 */
  }
  function shellAttach(bookId, res) {
    if (!bookId || !res || !res.id) return;
    var m = shellMapAll();
    m[bookId] = { resId: res.id, title: res.title || '', at: Date.now() };
    shellSave(m);
  }
  function shellDetach(bookId) { var m = shellMapAll(); delete m[bookId]; shellSave(m); }
  function shellFor(bookId) { return shellMapAll()[bookId] || null; }

  /* 书名比对：去掉扩展名和括号里的版本信息再比，避免「《资本论》(第一卷)」对不上「资本论」 */
  function normTitle(x) {
    return String(x || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[（(【\[].*?[）)】\]]/g, '')
      .replace(/[\s·・.,，。:：;；'"“”‘’《》<>\-—_]/g, '').trim();
  }
  function matchShell(name) {
    var R = window.SITE_RESOURCES || [];
    var base = normTitle(name);
    if (!base || base.length < 2) return null;
    var sim = (window.yzBooks && window.yzBooks.simScore) ? window.yzBooks.simScore : null;
    var best = null, bestS = 0;
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      if (!r || !r.title || r.cat === '我的书' || String(r.id || '').indexOf('local-') === 0) continue;
      var t = normTitle(r.title);
      if (!t) continue;
      var sc;
      if (t === base) sc = 1;
      else if (sim) sc = sim(base, t);
      else sc = (t.indexOf(base) >= 0 || base.indexOf(t) >= 0) ? 0.85 : 0;
      if (sc > bestS) { bestS = sc; best = r; }
    }
    /* 自动认领用 0.92：宁可少挂，也不能把《国家与革命》挂到《国家与革命（导读）》下面 */
    return (best && bestS >= 0.92) ? best : null;
  }

  function photoCountText() {
    var A = app(), n = 0;
    if (A && A.photoList) { try { n = (JSON.parse(A.photoList() || '[]') || []).length; } catch (e) { } }
    return n;
  }

  function headHTML(nMine, nShell, nPhoto, cont, webOnly) {
    var h = '<div class="bk-toolbar">'
      + '<button class="bk-btn bk-import" type="button" onclick="YZAppBooks.pick()">＋ 导入文件</button>'
      + '<button class="bk-btn" type="button" onclick="YZAppBooks.openAlbum()">🖼 相册' + (nPhoto ? ' · ' + nPhoto : '') + '</button>'
      + '</div>'
      + '<div class="bk-tip">书（EPUB / PDF / TXT / MD）进书架，照片自动进相册 —— 选完按类型自己分，不用先挑格式。</div>'
      /* 浏览器里打开（没有 App 桥）：书目照常能看，但导入和阅读要用 App——得说清楚，别让人点了没反应 */
      + (webOnly ? '<div class="bk-tip" style="color:#e6b422">现在是在浏览器里预览：书目能看，但「导入」和「打开阅读」需要在 App 内使用。</div>' : '');

    /* 继续阅读：最近读过的那本，一条就够，别做成第二个书架 */
    if (cont) {
      h += '<div class="bk-cont" onclick="YZAppBooks.open(\'' + esc(cont.id) + '\')">'
        + '<div class="ic">▶</div>'
        + '<div class="nm"><b>继续读「' + esc(cont.name || cont.title || '') + '」</b>'
        + '<span>' + (cont.pct ? ('读到 ' + cont.pct + '%') : '上次打开的') + '</span></div></div>';
    }

    h += '<div class="bk-tabs">'
      + '<button class="bk-tab' + (SHELF.tab === 'mine' ? ' on' : '') + '" type="button" onclick="YZAppBooks.tab(\'mine\')">有原文 · ' + nMine + '</button>'
      + '<button class="bk-tab' + (SHELF.tab === 'shell' ? ' on' : '') + '" type="button" onclick="YZAppBooks.tab(\'shell\')">只有书壳 · ' + nShell + '</button>'
      + '<button class="bk-tab' + (SHELF.tab === 'recent' ? ' on' : '') + '" type="button" onclick="YZAppBooks.tab(\'recent\')">最近</button>'
      + '</div>';

    h += '<div class="bk-tools">'
      + '<select id="bkSort" onchange="YZAppBooks.sortBy(this.value)">'
      + '<option value="at"' + (SHELF.sort === 'at' ? ' selected' : '') + '>最近添加</option>'
      + '<option value="read"' + (SHELF.sort === 'read' ? ' selected' : '') + '>最近阅读</option>'
      + '<option value="title"' + (SHELF.sort === 'title' ? ' selected' : '') + '>书名</option>'
      + '<option value="progress"' + (SHELF.sort === 'progress' ? ' selected' : '') + '>读得最多</option>'
      + '<option value="size"' + (SHELF.sort === 'size' ? ' selected' : '') + '>文件大小</option>'
      + '</select>'
      + '<button class="bk-btn" type="button" onclick="YZAppBooks.toggleView()">' + (SHELF.view === 'grid' ? '☰ 列表' : '▦ 网格') + '</button>'
      + '<button class="bk-btn" type="button" onclick="YZAppBooks.manage()">' + (SHELF.manage ? '完成' : '☑ 管理') + '</button>'
      + '</div>';
    return h;
  }

  function shelf() {
    var A = app();
    ensureCSS();
    /* 抽屉（z-index 96）会盖住书架（原 70），以前点了像没反应。
       现在一是把书架层级提到 130，二是在打开前先收起抽屉——两层叠着即使看得见也乱。 */
    try { if (typeof closeDrawer === 'function') closeDrawer(); } catch (e) { }
    try { if (typeof closePlus === 'function') closePlus(); } catch (e) { }
    try { document.body.classList.add('yzshelf-open'); } catch (e) { }
    try { document.body.classList.remove('yzbk-open'); } catch (e) { }
    var rb = document.getElementById('yzbk');
    if (rb) rb.classList.remove('open');
    shell().classList.add('open');

    /* 阅读态的收尾只做「与硬件/全局有关」的三件事；
       排版、顶栏按钮、滚动位置都不需要复位 —— 它们现在住在另一个容器里。 */
    cur = null;
    if (zoom) { try { zoom.destroy(); } catch (e) { } zoom = null; }
    clearTimeout(chromeTimer);
    try { if (A && A.setImmersive) A.setImmersive(false); } catch (e) { }

    shelfPrefLoad();
    renderShelf();
  }

  /* 统一渲染：标签页切换 / 排序 / 视图切换都只调它，不再各自拼 HTML */
  function renderShelf() {
    var A = app(), body = document.getElementById('yzsBody');
    if (!body) return;

    var native = refreshList();
    var txt = localBooks();

    var booksE = native.filter(function (b) { return b.type === 'pdf' || b.type === 'epub'; });
    var booksT = native.filter(function (b) { return b.type === 'txt' || b.type === 'md'; });
    _list = booksE.concat(booksT);          /* open() 按 id 找 meta，两类都要在 */

    var BOK = /^(TXT|MD|MARKDOWN|EPUB|PDF)$/;
    var goods = txt.filter(function (b) { return BOK.test(String(b.fmt || '').toUpperCase()); });
    var bads = txt.filter(function (b) { return !BOK.test(String(b.fmt || '').toUpperCase()); });

    /* 书壳：资源库里除「我的书」之外、还没挂上本机文件的那些 */
    var shells = [];
    try {
      var R = window.SITE_RESOURCES || [];
      shells = R.filter(function (r) {
        return r && r.cat !== '我的书' && !r.local && String(r.id || '').indexOf('local-') !== 0;
      });
    } catch (e) { shells = []; }
    SHELF.shell = shells;

    /* 继续阅读：最近读过的一本 */
    var cont = null;
    var all = booksE.concat(booksT).concat(goods);
    var bestT = 0;
    for (var i = 0; i < all.length; i++) {
      var pp = posGet(all[i].id) || {};
      var t = Number(pp.t) || 0;
      if (t > bestT) { bestT = t; cont = { id: all[i].id, name: all[i].name || all[i].title, pct: progPct(all[i]) }; }
    }

    var mineN = booksE.length + booksT.length + goods.length;
    var h = headHTML(mineN, shells.length, photoCountText(), cont, !A);

    if (!mineN && !shells.length) {
      body.innerHTML = h + '<div class="bk-empty">还没有书。<br>'
        + '点上面的「＋ 导入文件」，一次可以选好几本（也能和照片一起选）。<br>'
        + '<b>EPUB</b> 带目录分章，<b>PDF</b> 逐页翻还能放大，<b>TXT / MD</b> 适合自己整理的笔记。<br>'
        + '<span style="opacity:.7;font-size:.82rem">文件会复制到 App 内部，原文件不受影响；卸载 App 才会删。</span></div>';
      return;
    }

    if (SHELF.tab === 'mine') {
      var h2 = '';
      if (booksE.length) {
        h2 += '<div class="bk-sec">电子书 · EPUB / PDF</div>';
        h2 += (SHELF.view === 'grid' ? '<div class="bk-grid">' : '')
          + sortList(booksE, SHELF.sort).map(function (b) {
            return itemHTML(b, { click: 'YZAppBooks.open(\'' + esc(b.id) + '\')' });
          }).join('')
          + (SHELF.view === 'grid' ? '</div>' : '');
      }
      if (booksT.length) {
        h2 += '<div class="bk-sec">纯文本 · TXT / MD</div>';
        h2 += (SHELF.view === 'grid' ? '<div class="bk-grid">' : '')
          + sortList(booksT, SHELF.sort).map(function (b) {
            return itemHTML(b, { click: 'YZAppBooks.open(\'' + esc(b.id) + '\')', ic: '📃' });
          }).join('')
          + (SHELF.view === 'grid' ? '</div>' : '');
      }
      if (goods.length) {
        h2 += '<div class="bk-sec">早先导入的纯文本</div>';
        h2 += (SHELF.view === 'grid' ? '<div class="bk-grid">' : '')
          + sortList(goods, SHELF.sort).map(function (b) {
            return itemHTML(b, { click: 'YZAppBooks.openText(\'' + esc(b.id) + '\')', ic: '📃', title: b.title || b.id });
          }).join('')
          + (SHELF.view === 'grid' ? '</div>' : '');
      }
      if (bads.length) {
        h2 += '<div class="bk-sec" style="color:#e6b422">⚠ 不是电子书 · 无法阅读</div>'
          + '<div style="padding:0 12px .5rem;font-size:.8rem;opacity:.75">'
          + '这些是以前误导入的图片或其它文件。建议删掉，删了不影响原文件。</div>'
          + bads.map(function (b) {
            return itemHTML(b, {
              cls: 'bk-dim', ic: '⚠️', title: b.title || b.id,
              sub: (b.fmt || '?') + (b.sizeTxt ? (' · ' + b.sizeTxt) : '') + ' · 无法打开',
              right: '<div class="go"><button class="bk-btn" type="button" style="padding:.2rem .55rem;font-size:.78rem" '
                + 'onclick="event.stopPropagation();YZAppBooks.delText(\'' + esc(b.id) + '\')">删除</button></div>'
            });
          }).join('');
      }
      body.innerHTML = h + h2 + selBarHTML();
      return;
    }

    if (SHELF.tab === 'shell') {
      if (!shells.length) { body.innerHTML = h + '<div class="bk-empty">没有只有书壳的条目。</div>'; return; }
      var shown = sortList(shells, SHELF.sort === 'at' || SHELF.sort === 'read' ? 'title' : SHELF.sort).slice(0, SHELF.more);
      var h3 = '<div class="bk-sec">书壳 · 只有介绍与目录，还没有本机文件</div>'
        + '<div style="padding:0 12px .5rem;font-size:.8rem;opacity:.72">'
        + '点开可以看简介、目录与导读；如果你本机有这本书的电子版，在详情页里「📥 导入本书」就会挂到这条书壳下面，不会再单独多出一本。</div>'
        + (SHELF.view === 'grid' ? '<div class="bk-grid">' : '')
        + shown.map(function (r) {
          var idx = (window.SITE_RESOURCES || []).indexOf(r);
          return itemHTML({ id: r.id, title: r.title }, {
            ic: '📚', title: r.title,
            sub: [r.cat, r.author].filter(Boolean).join(' · ') || '书目',
            click: 'YZAppBooks.openShell(' + idx + ')'
          });
        }).join('')
        + (SHELF.view === 'grid' ? '</div>' : '');
      if (shells.length > shown.length) {
        h3 += '<div style="padding:14px 12px 30px;text-align:center">'
          + '<button class="bk-btn" type="button" onclick="YZAppBooks.moreShell()">显示更多（还有 ' + (shells.length - shown.length) + ' 条）</button></div>';
      }
      body.innerHTML = h + h3;
      return;
    }

    /* recent：读过的那几本，按最后阅读时间 */
    var read = all.filter(function (b) { return (Number((posGet(b.id) || {}).t) || 0) > 0; });
    if (!read.length) {
      body.innerHTML = h + '<div class="bk-empty">还没有读过的书。<br>读完一会儿再回来，这里会按时间排好。</div>';
      return;
    }
    body.innerHTML = h + '<div class="bk-sec">最近读过</div>'
      + (SHELF.view === 'grid' ? '<div class="bk-grid">' : '')
      + sortList(read, 'read').map(function (b) {
        return itemHTML(b, {
          click: (b.fmt ? 'YZAppBooks.openText(\'' + esc(b.id) + '\')' : 'YZAppBooks.open(\'' + esc(b.id) + '\')'),
          title: b.name || b.title || b.id
        });
      }).join('')
      + (SHELF.view === 'grid' ? '</div>' : '');
  }

  /* ---- 批量管理 ----
     一次导入十几本时，「一本一本删」是最烦的事。所以给一个管理态：
     勾哪几本，底部一条「已选 N · 删除」。不做长按进入——长按在手机上容易和滚动打架。 */
  function selCount() { var n = 0; for (var k in SEL) if (SEL[k]) n++; return n; }
  function selBarHTML() {
    if (!SHELF.manage) return '';
    return '<div class="bk-selbar">'
      + '<span class="n">已选 ' + selCount() + ' 本</span>'
      + '<button class="bk-btn" type="button" onclick="YZAppBooks.selAll()">全选</button>'
      + '<button class="bk-btn" type="button" style="border-color:#c0392b;color:#e88" onclick="YZAppBooks.delSel()">删除选中</button>'
      + '</div>';
  }
  function toggleManage() {
    SHELF.manage = !SHELF.manage;
    SEL = {};
    renderShelf();
    if (SHELF.manage) toast('点书前面的圆圈选中，底部可以批量删除');
  }
  function toggleSel(id) { if (SEL[id]) delete SEL[id]; else SEL[id] = 1; renderShelf(); }
  function selAll() {
    var all = _list || [];
    var on = selCount() === all.length;
    SEL = {};
    if (!on) all.forEach(function (b) { if (b && b.id) SEL[b.id] = 1; });
    renderShelf();
  }
  function delSel() {
    var A = app();
    var ids = Object.keys(SEL).filter(function (k) { return SEL[k]; });
    if (!ids.length) { toast('先选几本'); return; }
    var ok = true;
    try { ok = window.confirm('从本机删除这 ' + ids.length + ' 本？\n\n只删 App 里的副本，不影响你手机里原来的文件。'); } catch (e) { ok = true; }
    if (!ok) return;
    var listed = {};
    (_list || []).forEach(function (b) { if (b && b.id) listed[b.id] = 1; });
    ids.forEach(function (id) {
      try {
        if (listed[id]) { if (A && A.bookRemove) A.bookRemove(id); }
        else if (window.yzBooks && yzBooks.remove) { yzBooks.remove(id); return; }
        shellDetach(id);
      } catch (e) { }
    });
    SEL = {};
    setTimeout(function () {
      toast('已删除 ' + ids.length + ' 本');
      renderShelf();
    }, 320);
  }

  /* ---- 书架的交互入口（供 HTML 内联调用） ---- */
  function shelfTab(t) {
    SHELF.tab = t; SHELF.more = 60; shelfPrefSave(); renderShelf();
    try { document.getElementById('yzsBody').scrollTop = 0; } catch (e) { }
  }
  function shelfSort(by) { SHELF.sort = by; shelfPrefSave(); renderShelf(); }
  function shelfView() { SHELF.view = (SHELF.view === 'grid' ? 'list' : 'grid'); shelfPrefSave(); renderShelf(); }
  function moreShell() { SHELF.more += 60; renderShelf(); }
  function openShell(idx) {
    try {
      closeBookShelfOnly();
      if (typeof window.openItemDetail === 'function') window.openItemDetail(idx);
      else toast('书库还没加载好');
    } catch (e) { toast('打不开这本书的介绍'); }
  }
  function closeBookShelfOnly() {
    var el = document.getElementById('yzshelf');
    if (el) el.classList.remove('open');
    try { document.body.classList.remove('yzshelf-open'); } catch (e) { }
  }

  /* 删掉误导入的非电子书条目（书架内直接清理，不用跑回「我的资料」） */
  function delText(id) {
    try {
      if (window.yzBooks && window.yzBooks.remove) { window.yzBooks.remove(id); return; }
      toast('删除失败：导入模块未加载');
    } catch (e) { toast('删除失败'); }
  }

  /* 读 TXT / MD：正文从 _booktext/ 同源地址 fetch（Java 只传地址，不搬字符串）。
     段落按空行切分——纯文本里最稳的分段依据就是空行。 */
  function loadTxt() {
    var A = app();
    var body = document.getElementById('yzbkBody');
    var url = '';
    try { url = A && A.bookTextUrl ? A.bookTextUrl(cur.id) : ''; } catch (e) { url = ''; }
    if (!url) {
      body.innerHTML = '<p class="sub">这本书的正文找不到了（可能已被清理）。</p>';
      return;
    }
    body.innerHTML = '<p class="sub" style="opacity:.7">正在打开…</p>';
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var str = String(txt || '');
      if (!str.trim()) { body.innerHTML = '<p class="sub">文件是空的。</p>'; return; }
      var paras = str.replace(/\r\n/g, '\n').split(/\n\s*\n/);
      var html = '<div class="bk-txt">' + paras.map(function (p) {
        var t = p.trim();
        if (!t) return '';
        /* Markdown 的一级/二级标题给点层次，其余按段落 */
        var m = t.match(/^(#{1,3})\s+(.+)$/);
        if (m) return '<h3 class="bk-h">' + esc(m[2]) + '</h3>';
        return '<p>' + esc(t).replace(/\n/g, '<br>') + '</p>';
      }).join('') + '</div>';
      body.innerHTML = html;
      setFoot(Math.round(str.length / 1000) + ' 千字 · 约 ' + Math.max(1, Math.round(str.length / 900)) + ' 分钟');
      updateProgress();
      /* 记住读到哪里（按滚动百分比） */
      body.onscroll = function () {
        var el = body;
        var max = el.scrollHeight - el.clientHeight;
        if (max > 0) posSet(cur.id, { pct: Math.min(99, Math.round(el.scrollTop / max * 100)) });
      };
      var p = posGet(cur.id);
      if (p && typeof p.pct === 'number' && p.pct > 0) {
        setTimeout(function () {
          var max = body.scrollHeight - body.clientHeight;
          if (max > 0) body.scrollTop = max * p.pct / 100;
        }, 60);
      }
    }).catch(function (e) {
      body.innerHTML = '<p class="sub">打不开这本书：' + esc(e.message || '未知原因') + '</p>';
    });
  }

  /* 打开纯文本（交给 books.js 原本的阅读器，不另做一套） */
  function openText(id) {
    try {
      if (!window.yzBooks || !window.yzBooks.read) { toast('纯文本阅读器未加载'); return; }
      close();                       /* 先收起书架，避免两层全屏叠在一起 */
      window.yzBooks.read(id);
    } catch (e) { toast('打不开这本书：' + (e.message || '未知原因')); }
  }

  /* 导入纯文本：转给 books.js 的选文件流程 */
  function pickText() {
    try {
      if (!window.yzBooks || !window.yzBooks.pick) { toast('导入器未加载'); return; }
      close();
      window.yzBooks.pick(function () { setTimeout(shelf, 300); });
    } catch (e) { toast('无法打开文件选择器'); }
  }

  var pendingShell = null;   /* 「导入本书」要挂到哪条书壳 */

  /* 从书库详情页「📥 导入本书」调：选完文件自动挂到这条书壳下，不另开一条记录 */
  function pickFor(resId) { pendingShell = resId || null; pick(); }

  function pick() {
    var A = app();
    if (!A || !A.bookPick) { toast('电子书阅读需要在 App 内使用'); return; }
    try { A.bookPick(); toast('正在打开文件选择器…'); } catch (e) { toast('无法打开选择器'); }
  }

  /* App 侧导入完成后回调（由 MainActivity.bookResult 调用） */
  window.__yzBookResult = function (r) {
    try {
      if (!r || r.ok === false) { toast('导入失败：' + ((r && r.error) || '未知原因')); return; }
      /* 新格式一次选了多个文件：{items:[...], books:n, photos:n, bad:n}；老格式是单个对象 */
      var items = r.items || (r.id ? [r] : []);
      var nb = (typeof r.books === 'number') ? r.books : items.filter(function (x) { return x.kind !== 'photo'; }).length;
      var np = (typeof r.photos === 'number') ? r.photos : items.filter(function (x) { return x.kind === 'photo'; }).length;
      var bad = r.bad || 0;

      var msg = [];
      if (nb) msg.push(nb + ' 本书');
      if (np) msg.push(np + ' 张照片');
      if (bad) msg.push(bad + ' 个跳过');
      if (msg.length) toast('已导入：' + msg.join(' · '));
      else toast('没有可导入的文件' + (r.error ? '：' + r.error : ''));

      /* 从书详情页点「导入本书」进来的：强制挂到那一条书壳上 */
      if (pendingShell) {
        var pb = items.filter(function (x) { return x.kind !== 'photo' && x.id; })[0];
        if (pb) {
          var rr = (window.SITE_RESOURCES || []).filter(function (x) { return x.id === pendingShell; })[0];
          if (rr) {
            shellAttach(pb.id, rr);
            toast('已挂到《' + String(rr.title || '').slice(0, 24) + '》下面，以后从书库也能直接读');
          }
        }
        pendingShell = null;
      }
      /* 普通导入：按书名自动认领，认领到就算同一本（不额外多出一条） */
      if (!pendingShell) {
        items.forEach(function (x) {
          if (!x || x.kind === 'photo' || !x.id) return;
          if (shellFor(x.id)) return;
          var hit = matchShell(x.title || x.name);
          if (hit) shellAttach(x.id, hit);
        });
      }
      if (np && window.YZPhoto && YZPhoto.refresh) { try { YZPhoto.refresh(); } catch (e) { } }
      shelf();
      /* 只导了一本书的时候直接打开，省一次点击 */
      var books = items.filter(function (x) { return x.kind !== 'photo'; });
      if (books.length === 1 && books[0].type === 'epub' && books[0].count === 1) open(books[0].id);
      else if (books.length === 1 && books[0].type === 'txt') { /* 纯文本不自动开，书架里点 */ }
    } catch (e) { toast('导入结果处理异常：' + (e.message || '')); }
  };

  /* ---------------- 阅读器 ---------------- */
  var cur = null;   /* { id, type, title, idx, count } */
  var zoom = null;  /* YZZoom 实例（PDF 整页模式才有） */

  /* 阅读配色三档。夜间不是「纯白字压纯黑底」——那样反而刺眼：
     字用浅灰、底用近黑偏暖，对比度降下来才是能久看的夜间模式。 */
  var READ_THEMES = ['day', 'night', 'black'];
  var READ_THEME_NAME = { day: '日间', night: '夜间', black: '纯黑' };
  function readTheme() {
    try { var t = localStorage.getItem('yzBkTheme'); if (READ_THEMES.indexOf(t) >= 0) return t; } catch (e) { }
    return 'day';
  }
  function applyReadTheme(on) {
    var el = document.getElementById('yzbk');
    if (!el) return;
    var t = readTheme();
    el.classList.toggle('bk-read', !!on);
    el.classList.toggle('night', !!on && t === 'night');
    el.classList.toggle('black', !!on && t === 'black');
    var b = document.getElementById('yzbkTheme');
    if (b && on) {
      b.style.display = 'inline-block';
      b.textContent = t === 'day' ? '🌙' : (t === 'night' ? '🌓' : '☀');
    }
  }
  function setReadTheme(t) {
    if (READ_THEMES.indexOf(t) < 0) return;
    try { localStorage.setItem('yzBkTheme', t); } catch (e) { }
    applyReadTheme(true);
    applyReadCfg();
    syncPdfNight();
    toast(READ_THEME_NAME[t]);
  }
  function toggleReadTheme() {
    var i = READ_THEMES.indexOf(readTheme());
    setReadTheme(READ_THEMES[(i + 1) % READ_THEMES.length]);
  }

  /* 亮度：整块正文再压暗/提亮一档。夜间关灯看书时最有用（系统亮度调到最低还是亮） */
  function bright() { try { var v = parseFloat(localStorage.getItem('yzBright')); return (v >= 0.3 && v <= 1.2) ? v : 1; } catch (e) { return 1; } }
  function applyBright() {
    var body = document.getElementById('yzbkBody');
    if (!body) return;
    var v = bright();
    body.style.filter = (Math.abs(v - 1) < 0.02) ? '' : ('brightness(' + v.toFixed(2) + ')');
  }
  function setBright(v) {
    v = Math.max(0.3, Math.min(1.2, Number(v) || 1));
    try { localStorage.setItem('yzBright', String(v)); } catch (e) { }
    applyBright();
  }
  /* PDF 是页图，CSS 只能整体压暗；夜间要真的「白纸变深底」得让原生重渲染一次 */
  function syncPdfNight() {
    try { var A = app(); if (A && A.setPdfNight) A.setPdfNight(readTheme() !== 'day'); } catch (e) { }
    /* 正在读 PDF：立刻重出一遍图。不然切了夜间看到的还是上一次渲染的白色页缓存，
       用户会以为「夜间没用」。 */
    if (cur && cur.type === 'pdf') {
      setTimeout(function () {
        if (!cur || cur.type !== 'pdf') return;
        if (pdfMode() === 'scroll') renderPdfFlow(); else renderPdf();
      }, 80);
    }
  }

  /* ---- PDF 阅读档位 ---- */
  var PDF_MODE_NAME = { scroll: '连续', width: '适宽', page: '整页' };
  function pdfMode() {
    try {
      var m = localStorage.getItem('yzPdfMode');
      if (m === 'scroll' || m === 'width' || m === 'page') return m;
      return localStorage.getItem('yzPdfFit') === 'page' ? 'page' : 'scroll';   /* 老版本的单一开关 */
    } catch (e) { return 'scroll'; }
  }
  function setPdfMode(m) { try { localStorage.setItem('yzPdfMode', m); } catch (e) { } }
  function applyPdfMode() {
    var el = document.getElementById('yzbk');
    if (!el) return;
    var m = pdfMode();
    el.classList.toggle('fit-page', m === 'page');
    el.classList.toggle('fit-scroll', m === 'scroll');
    var body = document.getElementById('yzbkBody');
    if (body) body.classList.toggle('pdfscroll', m === 'scroll');
    /* 连续滚动不需要翻页按钮，但进度滑块必须留着——否则默认档根本看不到页码 */
    var foot = document.getElementById('yzbkFoot');
    if (foot) foot.style.display = 'flex';
    var compact = !!(cur && cur.type === 'pdf' && m === 'scroll');
    var pv = document.getElementById('yzbkPrev'), nx = document.getElementById('yzbkNext');
    if (pv) pv.style.display = compact ? 'none' : '';
    if (nx) nx.style.display = compact ? 'none' : '';
    bindPdfGestures();
  }
  function pdfWidth() { return Math.min(1400, Math.round((window.innerWidth || 390) * 2)); }

  var flowNext = 0, flowBusy = false;
  function renderPdfFlow() {
    var body = document.getElementById('yzbkBody');
    body.innerHTML = '<div class="bk-flow" id="bkFlow"></div>';
    /* 必须把滚动位置清零：连续档是「从 cur.idx 往后铺」，若沿用上一次的 scrollTop，
       跳页后会停在第 7 页而不是你要去的第 6 页（实测 717px 偏移）。 */
    try { body.scrollTop = 0; } catch (e) { }
    flowNext = cur.idx;
    flowBusy = false;
    appendFlow(4);
  }
  /* 一页一页往尾部接。Java 侧 bookPage 是同步渲染（几百毫秒），
     所以一次只接 2~4 页，滑到底再续，避免开场卡两三秒。 */
  function appendFlow(n) {
    var A = app(), flow = document.getElementById('bkFlow');
    if (!A || !flow || !cur || flowBusy) return;
    flowBusy = true;
    var w = pdfWidth(), added = 0;
    try {
      for (var k = 0; k < n; k++) {
        if (cur.count && flowNext >= cur.count) break;
        var idx = flowNext, r = null;
        try { r = JSON.parse(A.bookPage(cur.id, idx, w)); } catch (e) { r = null; }
        if (!r || r.ok === false) {
          if (!flow.children.length) {
            flow.innerHTML = '<p class="sub">这一页打不开：' + esc((r && r.error) || '未知原因') + '</p>';
          }
          flowNext = cur.count || (flowNext + 1);
          break;
        }
        if (r.pages) cur.count = r.pages;
        if (!r.url) { flowNext++; continue; }
        var d = document.createElement('div');
        d.className = 'bk-pg';
        d.setAttribute('data-p', idx);
        var im = document.createElement('img');
        im.loading = 'lazy'; im.decoding = 'async';
        im.alt = '第 ' + (idx + 1) + ' 页';
        im.src = r.url;
        d.appendChild(im);
        flow.appendChild(d);
        flowNext++; added++;
      }
    } catch (e) { }
    flowBusy = false;
    if (added) syncFlowPage();
    updateFlowInfo();
  }
  function updateFlowInfo() {
    var info = document.getElementById('yzbkInfo');
    if (!info || !cur) return;
    var pct = cur.count ? Math.round(cur.idx / cur.count * 100) : 0;
    info.textContent = '第 ' + (cur.idx + 1) + ' / ' + (cur.count || '?') + ' 页 · ' + pct + '%';
    /* 连续档也要让底部滑块反映总页数与当前位置（底栏是隐藏的，但滑块本身要可用） */
    var sk = document.getElementById('yzbkSeek');
    if (sk) {
      var mx = Math.max(0, (cur.count || 1) - 1);
      sk.max = String(mx);
      sk.value = String(Math.min(mx, Math.max(0, cur.idx)));
    }
  }
  /* 滚动时算「现在在第几页」，写进进度：切档位、退出再进都能接上 */
  function syncFlowPage() {
    var body = document.getElementById('yzbkBody');
    if (!body) return;
    var pgs = body.querySelectorAll('.bk-pg');
    if (!pgs.length) return;
    var top = body.getBoundingClientRect().top + 60;
    var now = cur.idx;
    for (var i = 0; i < pgs.length; i++) {
      var r = pgs[i].getBoundingClientRect();
      if (r.bottom > top) { now = parseInt(pgs[i].getAttribute('data-p'), 10); break; }
    }
    if (typeof now === 'number' && !isNaN(now)) {
      cur.idx = now;
      try { posSet(cur.id, { page: now, t: Date.now() }); } catch (e) { }
    }
    updateFlowInfo();
  }

  /* ---- EPUB / 纯文本 排版 ----
     这三项（字号、行距、边距）是「读不读得下去」的门槛：
     字小了看不清，行距挤了串行，边距宽了每屏没几个字。都只是 CSS，不动解析。 */
  var RC_DEF = { fs: 1, lh: 1.95, pd: 16, jc: false };
  var RC_FS = [0.9, 1, 1.14, 1.3];
  var RC_LH = [1.6, 1.95, 2.3];
  var RC_PD = [10, 16, 24];
  function readCfg() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem('yzReadCfg') || '{}') || {}; } catch (e) { o = {}; }
    return { fs: RC_FS.indexOf(o.fs) >= 0 ? o.fs : RC_DEF.fs, lh: RC_LH.indexOf(o.lh) >= 0 ? o.lh : RC_DEF.lh,
             pd: RC_PD.indexOf(o.pd) >= 0 ? o.pd : RC_DEF.pd, jc: !!o.jc };
  }
  function saveReadCfg(o) { try { localStorage.setItem('yzReadCfg', JSON.stringify(o)); } catch (e) { } }
  function applyReadCfg() {
    var body = document.getElementById('yzbkBody');
    if (!body) return;
    var c = readCfg();
    body.style.fontSize = c.fs + 'rem';
    body.style.lineHeight = String(c.lh);
    body.style.paddingLeft = c.pd + 'px';
    body.style.paddingRight = c.pd + 'px';
    body.style.textAlign = c.jc ? 'justify' : '';
    var p = document.getElementById('yzbkAAPanel');
    if (!p) return;
    var isText = !cur || cur.type === 'epub' || cur.type === 'txt' || cur.type === 'md';
    var th = readTheme(), br = bright();
    /* 主题与亮度对所有格式都有；字号行距只对文字版有意义 */
    var html = '<div class="row"><span>配色</span>'
      + READ_THEMES.map(function (t) {
          return '<button class="bk-btn' + (th === t ? ' on' : '') + '" type="button" data-a="th-' + t + '">' + READ_THEME_NAME[t] + '</button>';
        }).join('')
      + '</div>'
      + '<div class="row"><span>亮度</span>'
      + '<input type="range" class="aa-range" data-a="bright" min="30" max="120" value="' + Math.round(br * 100) + '"></div>';
    if (!isText) {
      html += '<div style="font-size:.74rem;opacity:.62;line-height:1.55;padding-top:4px">'
        + 'PDF 的夜间是重新渲染页图（白纸变深底、字变浅），不是盖一层颜色；换页后生效。</div>';
      p.innerHTML = html;
      return;
    }
    p.innerHTML = html + '<div class="row"><span>字号</span>'
        + '<button class="bk-btn" type="button" data-a="fs-">A−</button>'
        + '<button class="bk-btn" type="button" data-a="fs+">A＋</button></div>'
        + '<div class="row"><span>行距</span>'
        + RC_LH.map(function (v, i) { return '<button class="bk-btn' + (c.lh === v ? ' on' : '') + '" type="button" data-a="lh' + i + '">' + ['紧', '中', '松'][i] + '</button>'; }).join('')
        + '</div>'
        + '<div class="row"><span>边距</span>'
        + RC_PD.map(function (v, i) { return '<button class="bk-btn' + (c.pd === v ? ' on' : '') + '" type="button" data-a="pd' + i + '">' + ['窄', '中', '宽'][i] + '</button>'; }).join('')
        + '</div>'
        + '<div class="row"><span>两端对齐</span>'
        + '<button class="bk-btn' + (c.jc ? ' on' : '') + '" type="button" data-a="jc">' + (c.jc ? '已开' : '关闭') + '</button>'
        + '</div>';
  }
  function readCfgAction(a) {
    var c = readCfg();
    if (a.indexOf('th-') === 0) { setReadTheme(a.slice(3)); return; }
    if (a === 'fs-') { var i = RC_FS.indexOf(c.fs); c.fs = RC_FS[Math.max(0, i - 1)]; }
    else if (a === 'fs+') { var j = RC_FS.indexOf(c.fs); c.fs = RC_FS[Math.min(RC_FS.length - 1, j + 1)]; }
    else if (a.indexOf('lh') === 0) { c.lh = RC_LH[parseInt(a.slice(2), 10)] || RC_DEF.lh; }
    else if (a.indexOf('pd') === 0) { c.pd = RC_PD[parseInt(a.slice(2), 10)] || RC_DEF.pd; }
    else if (a === 'jc') { c.jc = !c.jc; }
    saveReadCfg(c); applyReadCfg();
  }

  /* ---- 阅读进度条 ---- */
  function updateProgress() {
    var bar = document.getElementById('yzbkProg');
    if (!bar || !cur) return;
    var body = document.getElementById('yzbkBody');
    var el = document.getElementById('yzbk');
    var pct = 0;
    if (cur.type === 'pdf') {
      if (el && el.classList.contains('fit-scroll')) pct = cur.count ? Math.round(flowNext / cur.count * 100) : 0;
      else pct = cur.count ? Math.round((cur.idx + 1) / cur.count * 100) : 0;
    } else if (cur.type === 'txt' || cur.type === 'md') {
      var max = body.scrollHeight - body.clientHeight;
      pct = max > 0 ? Math.round(body.scrollTop / max * 100) : 0;
    } else {
      pct = cur.count ? Math.round((cur.idx + 1) / cur.count * 100) : 0;
    }
    pct = Math.max(0, Math.min(100, pct));
    var fill = bar.querySelector('i');
    if (fill) fill.style.width = pct + '%';
    bar.setAttribute('data-pct', String(pct));
  }

  /* ---- 滚动：连续模式续页 + 记进度 + 进度条 ---- */
  function onReaderScroll() {
    var body = document.getElementById('yzbkBody');
    if (!body) return;
    var el = document.getElementById('yzbk');
    if (el && el.classList.contains('fit-scroll')) {
      if (body.scrollHeight - body.scrollTop - body.clientHeight < 1200) appendFlow(2);
      syncFlowPage();
    }
    var max = body.scrollHeight - body.clientHeight;
    if (cur && (cur.type === 'txt' || cur.type === 'md') && max > 0) {
      posSet(cur.id, { pct: Math.min(99, Math.round(body.scrollTop / max * 100)), t: Date.now() });
    }
    updateProgress();
  }

  /* ---- 沉浸式 ----
     进书先让人看一眼工具栏，然后自动收起；点屏幕中间呼出，静止一会儿再收。
     这是所有阅读器的通行做法：读的时候一屏都是字，要用时点一下就有。 */
  var chromeTimer = 0;
  /* 顶栏/底栏与系统状态栏一起进出：点一下，三样一起回来；再点或静止几秒，三样一起收。
     上一次只切了 App 自己的工具栏，系统状态栏藏了就再没回来——所以「点也打不开」。 */
  function immersive(on) {
    try { var A = app(); if (A && A.setImmersive) A.setImmersive(!!on); } catch (e) { }
  }
  function showChrome(ms) {
    var el = document.getElementById('yzbk');
    if (!el) return;
    el.classList.remove('chrome-off');
    if (cur) immersive(false);          /* 工具栏出来 → 状态栏也出来 */
    clearTimeout(chromeTimer);
    if (ms !== 0) chromeTimer = setTimeout(function () { hideChrome(); }, ms || 2800);
  }
  function hideChrome() {
    var el = document.getElementById('yzbk');
    if (!el) return;
    clearTimeout(chromeTimer);
    el.classList.add('chrome-off');
    if (cur) immersive(true);           /* 一起收起 */
  }
  function toggleChrome() {
    var el = document.getElementById('yzbk');
    if (!el) return;
    if (el.classList.contains('chrome-off')) showChrome(2800); else hideChrome();
  }
  /* 点任何操作都算「还在用」，把自动收起的时间往后推 */
  function keepChrome() { if (document.getElementById('yzbk') &&
      !document.getElementById('yzbk').classList.contains('chrome-off')) showChrome(2800); }

  /* 一屏一屏地翻：章很长的时候，点一下应该先滚一屏，到章末才进下一章。
     以前点右 1/3 直接 goto(下一章)，一整章内容被跳过。 */
  function flowUp() {
    var body = document.getElementById('yzbkBody');
    if (!body || !cur) return;
    if (body.scrollTop > 6) {
      body.scrollTo({ top: Math.max(0, body.scrollTop - body.clientHeight * 0.88), behavior: 'smooth' });
      return;
    }
    if (cur.idx > 0) {
      goto(cur.idx - 1);
      setTimeout(function () { try { body.scrollTop = body.scrollHeight; } catch (e) { } }, 90);
    } else toast('已经是开头了');
  }
  function flowDown() {
    var body = document.getElementById('yzbkBody');
    if (!body || !cur) return;
    if (body.scrollTop + body.clientHeight < body.scrollHeight - 6) {
      body.scrollTo({ top: body.scrollTop + body.clientHeight * 0.88, behavior: 'smooth' });
      return;
    }
    if (!cur.count || cur.idx < cur.count - 1) goto(cur.idx + 1);
    else toast('已经是结尾了');
  }

  /* ---- 点按分区翻页（只给分章的书用）----
     左 1/3 上一章、右 1/3 下一章、中间收起/展开顶栏底栏。
     PDF 不走这套：它用手势（左右滑 / 上下滚），点区会和它们打架。 */
  function onReaderClick(ev) {
    var el = document.getElementById('yzbk');
    if (!cur || !el || !el.classList.contains('open')) return;
    /* PDF 也要能点中央呼出工具栏。上一次这里直接 return 了，导致读 PDF 时怎么点都没反应。
       轻点不会和缩放/拖拽冲突：拖拽之后浏览器不会派发 click。 */
    var t = ev.target;
    if (t && t.closest && t.closest('a,button,input,select,textarea,.bk-toc,.bk-aa,.bk-txt a')) return;
    var w = el.clientWidth || 390;
    var x = ev.clientX;
    if (x < w * 0.33) flowUp();
    else if (x > w * 0.67) flowDown();
    else toggleChrome();
  }

  /* ---- 划词：选中正文里的词 → 弹本站自己的解释 ----
     通用阅读器接了词典后弹的是《现代汉语词典》；我们弹的是这个库里的
     术语卡、概念、人物、事件——这些词本来就是这本书的主题词，比通用词典准得多。 */
  function normW(x) {
    return String(x || '').replace(/[\s\u3000·・.,，。:：;；!！?？'"“”‘’《》<>()（）\[\]【】\-—_、/]/g, '');
  }
  /* 匹配打分：相等最准，其次是「选中的句子包含条目名」，
     最后才是「条目名包含选中的字」——后者必须有，否则选中「马克思」对不上「卡尔·马克思」。 */
  function matchScore(nm, t) {
    if (!nm || !t) return 0;
    if (nm === t) return 4;
    if (nm.length >= 2 && t.indexOf(nm) >= 0) return 3;
    if (t.length >= 2 && nm.indexOf(t) >= 0) return 2;
    return 0;
  }
  function bestOf(list, nameOf, t) {
    var best = null, bs = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i]; if (!o) continue;
      var nm = normW(nameOf(o));
      var sc = matchScore(nm, t);
      if (!sc) continue;
      /* 同分取更短的（「马克思」应命中「卡尔·马克思」而不是更长的派生词条） */
      if (sc > bs || (sc === bs && best && nm.length < normW(nameOf(best)).length)) { bs = sc; best = o; }
    }
    return best ? { item: best, score: bs } : null;
  }

  function lookupWord(raw) {
    var t = normW(raw);
    if (!t || t.length < 2) return null;
    var i, n;
    /* ① 术语卡 */
    try {
      var G = window.SITE_GLOSSARY || [];
      if (!Array.isArray(G)) G = [];
      var bestG = null, bestGS = 0;
      for (i = 0; i < G.length; i++) {
        var g = G[i];
        if (!g || !g.term) continue;
        var names = [g.term].concat(String(g.alias || '').split(/[\s,，、|/]+/));
        for (n = 0; n < names.length; n++) {
          var nm = normW(names[n]);
          var sc = matchScore(nm, t);
          if (sc > bestGS) { bestGS = sc; bestG = g; }
        }
      }
      if (bestG) {
        return { kind: '术语', title: String(bestG.term), brief: String(bestG.dic || bestG.note || bestG.from || '').slice(0, 260), go: null };
      }
    } catch (e) { }
    /* ② 概念 */
    try {
      var C = (window.SITE_CONCEPTS && window.SITE_CONCEPTS.nodes) || [];
      var bc = bestOf(C, function (x) { return x.name; }, t);
      if (bc) {
        var c = bc.item;
        return { kind: '概念', title: String(c.name), brief: String(c.role || '') + (c.desc ? '。' + String(c.desc).slice(0, 200) : ''), go: 'concept:' + c.id };
      }
    } catch (e) { }
    /* ③ 人物 / 著作 */
    try {
      var N = (window.SITE_GRAPH && window.SITE_GRAPH.nodes) || [];
      var bp = bestOf(N, function (x) { return x.name; }, t);
      if (bp) {
        var p = bp.item;
        var isP = (p.type === 'person');
        return {
          kind: isP ? '人物' : (p.type === 'work' ? '著作' : '组织'),
          title: String(p.name),
          brief: [p.years, p.role].filter(Boolean).join(' · ') || String(p.desc || '').slice(0, 200),
          go: isP ? 'figure:' + p.id : null
        };
      }
    } catch (e) { }
    /* ④ 重大事件 */
    try {
      var E = (window.SITE_EXTRA && window.SITE_EXTRA.events) || [];
      var be = bestOf(E, function (x) { return x.name; }, t);
      if (be) {
        var ev = be.item;
        return { kind: '事件', title: String(ev.name), brief: (ev.year ? ev.year + ' · ' : '') + String(ev.desc || '').slice(0, 220), go: 'event:' + encodeURIComponent(ev.name) };
      }
    } catch (e) { }
    return null;
  }

  var __wordSel = '', __wordGo = null;
  function hideWordCard() {
    var b = document.getElementById('yzbkWord');
    if (b) b.setAttribute('hidden', '');
  }
  function showWordCard(hit, sel) {
    var b = document.getElementById('yzbkWord');
    if (!b) return;
    b.querySelector('.w-kind').textContent = hit.kind;
    b.querySelector('.w-name').textContent = hit.title;
    b.querySelector('.w-brief').textContent = hit.brief || '';
    __wordSel = sel;
    __wordGo = hit.go;
    b.querySelector('.w-ops').style.display = hit.go ? 'flex' : 'none';
    b.removeAttribute('hidden');
  }
  function onSelChange() {
    if (__wordTimer) clearTimeout(__wordTimer);
    __wordTimer = setTimeout(function () {
      __wordTimer = 0;
      var el = document.getElementById('yzbk');
      if (!el || !el.classList.contains('open') || !cur) { hideWordCard(); return; }
      if (cur.type === 'pdf') return;
      var sel = '';
      try { sel = String((window.getSelection && window.getSelection().toString()) || '').trim(); } catch (e) { sel = ''; }
      if (!sel || sel.length > 18) { hideWordCard(); return; }
      var hit = lookupWord(sel);
      if (!hit) { hideWordCard(); return; }
      showWordCard(hit, sel);
    }, 320);
  }
  var __wordTimer = 0;

  /* PDF 手势：只在「整页」档启用。
     适宽档是要上下滚动读字的，接管手指会和滚动打架——所以那一档不绑。 */
  function bindPdfGestures() {
    var st = document.getElementById('bkStage');
    if (zoom) { try { zoom.destroy(); } catch (e) { } zoom = null; }
    if (!st || !window.YZZoom || !cur) return;
    if (!document.getElementById('yzbk').classList.contains('fit-page')) return;
    if (cur.type !== 'pdf') return;
    zoom = window.YZZoom.attach(st, {
      max: 3,
      onSwipe: function (dir) { goto(cur.idx + dir); },
      onTap: function () { /* 单击不翻页，避免误触 */ }
    });
  }

  /* 从原生读一次书目列表。以前只有渲染书架时才填 _list，
     于是「没进过书架就直接打开一本书」（冷启动深链、快捷方式）会查不到 meta，被弹回书架。 */
  function refreshList() {
    var A = app(), native = [];
    if (A && A.bookList) { try { native = JSON.parse(A.bookList() || '[]') || []; } catch (e) { native = []; } }
    _list = native;
    return _list;
  }

  function open(id) {
    var A = app();
    if (!A) { toast('电子书阅读需要在 App 内使用'); return; }
    if (!_list || !_list.length) refreshList();
    var meta = null;
    for (var i = 0; i < _list.length; i++) if (_list[i].id === id) meta = _list[i];
    if (!meta) { shelf(); return; }
    var p = posGet(id) || {};
    cur = {
      id: id, type: meta.type, title: meta.name || '',
      idx: meta.type === 'pdf' ? (p.page || 0) : (p.ch || 0),
      count: 0
    };
    readerShell().classList.add('open');
    try { document.body.classList.add('yzbk-open'); } catch (e) { }
    document.getElementById('yzbkTitle').textContent = cur.title;
    /* 记一次「打开」时间：只要打开过就算读过（继续阅读 / 最近 标签靠它排序）。
       以前只有滚动或翻页才写进度，于是「打开看了两眼就退出」的书在书架里查不到。 */
    try { var _p0 = posGet(id) || {}; posSet(id, _p0); } catch (e) { }

    var act = document.getElementById('yzbkAct');
    var prev = document.getElementById('yzbkPrev');
    var next = document.getElementById('yzbkNext');
    document.getElementById('yzbkFoot').style.display = 'flex';
    applyReadTheme(true);
    var th = document.getElementById('yzbkTheme');
    if (th) { th.style.display = 'inline-block'; th.onclick = toggleReadTheme; }

    /* 进度条、滚动、点按分区：所有格式都用 */
    var prog = document.getElementById('yzbkProg');
    if (prog) prog.style.display = 'block';
    var bd0 = document.getElementById('yzbkBody');
    if (bd0) { bd0.onscroll = onReaderScroll; bd0.onclick = onReaderClick; }
    applyReadCfg();
    bindSeek();
    applyBright();
    syncPdfNight();
    var infoBtn = document.getElementById('yzbkInfo');
    if (infoBtn) infoBtn.onclick = function () { jumpPage(); };
    /* 进书先给一眼工具栏（连状态栏一起露一下），1.6 秒后自动全收 */
    showChrome(1600);
    var aa = document.getElementById('yzbkAA');
    var aaP = document.getElementById('yzbkAAPanel');
    if (aa) {
      /* 字号/行距/边距只对文字版有意义；PDF 是页图，调字号没用 */
      aa.style.display = 'inline-block';
      aa.onclick = function () {
        if (!aaP) return;
        var willShow = aaP.hasAttribute('hidden');
        if (willShow) { applyReadCfg(); aaP.removeAttribute('hidden'); } else { aaP.setAttribute('hidden', ''); }
      };
    }
    if (aaP) {
      aaP.setAttribute('hidden', '');
      aaP.onclick = function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-a]') : null;
        if (!b) return;
        ev.stopPropagation();
        if (b.getAttribute('data-a') === 'bright') return;    /* 滑块走 input 事件 */
        readCfgAction(b.getAttribute('data-a'));
      };
      aaP.oninput = function (ev) {
        var b = ev.target;
        if (b && b.getAttribute && b.getAttribute('data-a') === 'bright') {
          setBright(parseInt(b.value, 10) / 100);
        }
      };
    }
    /* 书架里把它们藏起来了，进阅读态要显式打开，否则「目录」消失 */
    if (act) act.style.display = 'inline-block';
    var _bd = document.getElementById('yzbkBody');
    if (_bd) _bd.classList.add('pdfread');

    if (cur.type === 'txt' || cur.type === 'md') {
      /* 纯文本没有目录和页码，只有正文 */
      if (act) act.style.display = 'none';
      document.getElementById('yzbkFoot').style.display = 'none';
      loadTxt();
      return;
    }

    if (cur.type === 'pdf') {
      act.textContent = '页码';
      act.onclick = function () { jumpPage(); };
      /* 三档，按「怎么翻」区分，而不是按缩放比例：
         · 连续（默认）—— 一页接一页竖着排，滑到底自动接下一页。看资料最常用。
         · 适宽 —— 一次只显示一页、宽度铺满，上下滑看这一页。
         · 整页 —— 一屏一页，双指放大、左右滑动翻页，用来看版面/图表。
         以前只有后两档，所以「想一路往下滑着读」是做不到的。 */
      var fit = document.getElementById('yzbkFit');
      if (fit) {
        fit.style.display = 'inline-block';
        fit.textContent = PDF_MODE_NAME[pdfMode()];
        fit.onclick = function () {
          var order = ['scroll', 'width', 'page'];
          var i = order.indexOf(pdfMode());
          setPdfMode(order[(i + 1) % order.length]);
          fit.textContent = PDF_MODE_NAME[pdfMode()];
          applyPdfMode();
          if (pdfMode() === 'scroll') renderPdfFlow(); else renderPdf();
          toast(pdfMode() === 'scroll' ? '连续：上下滑动一路读下去，到底自动接下一页'
              : (pdfMode() === 'width' ? '适宽：一屏一页、铺满宽度，上下滑看这一页'
                                       : '整页：一屏一页，双指放大 · 左右滑动翻页'));
        };
      }
      prev.textContent = '‹';
      next.textContent = '›';
      prev.onclick = flowUp;
      next.onclick = flowDown;
      applyPdfMode();
      if (pdfMode() === 'scroll') renderPdfFlow(); else renderPdf();
    } else {
      act.textContent = '目录';
      act.onclick = function () { toc(); };
      var fitE = document.getElementById('yzbkFit'); if (fitE) fitE.style.display = 'none';
      try { document.getElementById('yzbk').classList.remove('fit-page'); } catch (e) { }
      prev.textContent = '‹';
      next.textContent = '›';
      prev.onclick = flowUp;
      next.onclick = flowDown;
      renderEpub();
    }
  }

  function goto(i) {
    if (!cur) return;
    if (i < 0) { toast('已经是第一' + (cur.type === 'pdf' ? '页' : '章')); return; }
    if (cur.count && i >= cur.count) { toast('已经是最后一' + (cur.type === 'pdf' ? '页' : '章')); return; }
    cur.idx = i;
    if (cur.type === 'pdf') {
      /* 连续档要重新铺多页；调 renderPdf 会把滚动视图换成一屏一页 */
      if (pdfMode() === 'scroll') renderPdfFlow(); else renderPdf();
    } else renderEpub();
  }

  function setFoot(txt) {
    var info = document.getElementById('yzbkInfo');
    if (info) info.textContent = txt;
    var sk = document.getElementById('yzbkSeek');
    if (sk && cur) {
      var maxIdx = Math.max(0, (cur.count || 1) - 1);
      sk.max = String(maxIdx);
      sk.value = String(Math.min(maxIdx, Math.max(0, cur.idx)));
    }
    var prev = document.getElementById('yzbkPrev'), next = document.getElementById('yzbkNext');
    if (prev) prev.disabled = cur.idx <= 0;
    if (next) next.disabled = !!cur.count && cur.idx >= cur.count - 1;
  }

  /* 页码滑块：拖动时只改提示，松手才跳（否则每动一下就渲染一页，必卡） */
  function bindSeek() {
    var sk = document.getElementById('yzbkSeek');
    if (!sk || sk.__yzBound) return;
    sk.__yzBound = true;
    sk.addEventListener('input', function () {
      var n = parseInt(sk.value, 10) || 0;
      var info = document.getElementById('yzbkInfo');
      if (info && cur) {
        info.textContent = (cur.type === 'pdf')
          ? ('第 ' + (n + 1) + ' / ' + (cur.count || '?') + ' 页')
          : ('第 ' + (n + 1) + ' 章');
      }
    });
    sk.addEventListener('change', function () {
      var n = parseInt(sk.value, 10) || 0;
      goto(n);
    });
  }

  function renderPdf() {
    var A = app(), body = document.getElementById('yzbkBody');
    /* 宽度按「屏幕宽度 × 2」要，App 侧渲染成同尺寸的 JPEG 文件；
       图片走同源 https 地址取（不是 base64 塞进 data URI），这样 WebView 能流式加载、
       能缓存、能降采样——不然一页 8MB 位图过桥，翻几页就 OOM。 */
    var w = Math.min(1400, Math.round((window.innerWidth || 390) * 2));
    body.innerHTML = '<p class="sub" style="opacity:.7">正在渲染第 ' + (cur.idx + 1) + ' 页…</p>';
    setFoot('第 ' + (cur.idx + 1) + ' 页');
    var t0 = Date.now(), r = null;
    try { r = JSON.parse(A.bookPage(cur.id, cur.idx, w)); } catch (e) { r = { ok: false, error: '渲染失败' }; }
    if (!r || r.ok === false) {
      body.innerHTML = '<p class="sub">这一页打不开：' + esc((r && r.error) || '未知原因') + '</p>'
        + '<p class="sub" style="opacity:.65;font-size:.8rem">常见原因：PDF 加密、扫描件字体异常、单页尺寸过大。</p>';
      return;
    }
    if (r.pages) cur.count = r.pages;
    if (!r.url) {
      body.innerHTML = '<p class="sub">这一页没有生成图片（可能是空页）</p>';
      return;
    }
    body.innerHTML = '<div class="bk-stage" id="bkStage"></div>';
    var img = document.createElement('img');
    img.className = 'bk-pdfimg';
    img.alt = '第 ' + (cur.idx + 1) + ' 页';
    img.onerror = function () {
      body.innerHTML = '<p class="sub">页图加载失败，可以试试翻到下一页再回来。</p>';
    };
    img.onload = function () {
      var cost = Date.now() - t0;
      setFoot('第 ' + (cur.idx + 1) + ' / ' + (cur.count || '?') + ' 页 · ' + cost + ' ms');
      bindPdfGestures();          /* 图出来之后再绑，尺寸才对得上 */
      /* 提前渲染下一页：只预取「紧邻的、还没渲染过的」那一页，并且 700ms 内只发一次。
         以前是每翻一页 400ms 后发一次请求，快速连翻时请求会在桥线程上排队，
         而单页渲染是同步的（几百毫秒），排到第三页就明显卡住。 */
      var _pf = cur.id + ':' + (cur.idx + 1);
      if (window.__yzPfed !== _pf) {
        window.__yzPfed = _pf;
        clearTimeout(window.__yzPfTimer);
        window.__yzPfTimer = setTimeout(function () {
          try { A.bookPage(cur.id, cur.idx + 1, w); } catch (e) { }
          window.__yzPfed = '';
        }, 700);
      }
    };
    /* 注意：上面已经把 body 换成 <div id=bkStage>，这里不能再清空 body，否则 stage 被抹掉 */
    var stageEl = document.getElementById('bkStage');
    if (stageEl) stageEl.appendChild(img); else body.appendChild(img);
    bindPdfGestures();
    /* 页码信息立刻更新，不等图片加载完成：图慢、图坏的时候用户也该知道自己在第几页 */
    setFoot('第 ' + (cur.idx + 1) + ' / ' + (cur.count || '?') + ' 页');
    img.src = r.url;
    posSet(cur.id, { page: cur.idx, t: Date.now() });
  }

  function renderEpub() {
    var A = app(), body = document.getElementById('yzbkBody');
    body.innerHTML = '<p class="sub" style="opacity:.7">正在打开…</p>';
    var html = '';
    try { html = A.bookChapter(cur.id, cur.idx) || ''; } catch (e) { html = ''; }
    body.innerHTML = html || '<p class="sub">这一章是空的</p>';
    body.scrollTop = 0;
    setFoot('第 ' + (cur.idx + 1) + ' 章');
    posSet(cur.id, { ch: cur.idx, t: Date.now() });
    loadTocTitles();
    updateProgress();
  }

  /* 章节标题：TOC 优先，取不到就用「第 N 章」 */
  var _toc = {};
  function loadTocTitles() {
    if (!cur || cur.type !== 'epub') return;
    var A = app();
    try {
      /* 章节标题在导入结果里带过一份；重新读一遍成本很低（只在首次） */
      if (!_titles[cur.id]) {
        var raw = A.bookList ? A.bookList() : '[]';
        var arr = JSON.parse(raw) || [];
        for (var i = 0; i < arr.length; i++) if (arr[i].id === cur.id && arr[i].chapters) _titles[cur.id] = arr[i].chapters;
      }
    } catch (e) { }
    var t = _titles[cur.id];
    if (t && t.length) {
      for (var k = 0; k < t.length; k++) {
        if (t[k] && t[k].i === cur.idx) { setFoot('第 ' + (cur.idx + 1) + ' 章 · ' + t[k].title); return; }
      }
    }
  }
  var _titles = {};

  function toc() {
    if (!cur) return;
    var body = document.getElementById('yzbkBody');
    var raw = '[]', A = app();
    try { raw = A.bookList ? A.bookList() : '[]'; } catch (e) { }
    var arr = [];
    try { arr = JSON.parse(raw) || []; } catch (e) { }
    var meta = null;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === cur.id) meta = arr[i];
    var chs = (meta && meta.chapters) || [];
    if (!chs.length) { toast('这本书没有章节目录'); return; }
    if (cur.count) { } else cur.count = chs.length;
    body.innerHTML = '<div class="bk-toc">' + chs.map(function (c) {
      return '<a href="javascript:void(0)" class="' + (c.i === cur.idx ? 'on' : '') + '" '
        + 'onclick="YZAppBooks.gotoChapter(' + c.i + ')">' + esc(c.title || ('第 ' + (c.i + 1) + ' 节')) + '</a>';
    }).join('') + '</div>';
    body.scrollTop = 0;
  }

  function gotoChapter(i) { if (!cur) return; cur.idx = i; renderEpub(); }

  function jumpPage() {
    if (!cur) return;
    var s = window.prompt('跳到第几页（共 ' + (cur.count || '?') + ' 页）', String(cur.idx + 1));
    if (s == null) return;
    var n = parseInt(s, 10);
    if (!n || n < 1) { toast('页码无效'); return; }
    goto(n - 1);
  }

  /* 关闭：分两层，和安卓的返回键一致
     · 正在读书 → 先回书架（你从书架点进来的，关书不该直接把你甩到别处）
     · 已经在书架 → 才真的关掉，并且回主页；同时把抽屉收掉，
       否则从「个人中心」进来的用户会看到抽屉从书架底下露出来（之前就是这样）。 */
  function close() {
    if (cur) { shelf(); return; }
    var el = document.getElementById('yzshelf');
    if (el) el.classList.remove('open');
    try { document.body.classList.remove('yzbk-open'); } catch (e) { }
    try { document.body.classList.remove('yzshelf-open'); } catch (e) { }
    try { clearTimeout(window.__yzPfTimer); window.__yzPfed = ''; } catch (e) { }
    try { if (typeof closeDrawer === 'function') closeDrawer(); } catch (e) { }
    try { if (typeof goHome === 'function') goHome(); } catch (e) { }
  }

  /* 给系统返回键用：true 表示这次返回被吞掉 */
  function back() {
    if (cur) { shelf(); return true; }
    var sh = document.getElementById('yzshelf');
    if (sh && sh.classList.contains('open')) { close(); return true; }
    return false;
  }
  function isOpen() {
    /* 书架或阅读器任一打开，都算「在书里」（App 侧返回键据此吞事件） */
    var rd = document.getElementById('yzbk');
    if (rd && rd.classList.contains('open') && cur) return true;
    var sh = document.getElementById('yzshelf');
    return !!(sh && sh.classList.contains('open'));
  }

  /* 长按选词时浏览器会发 selectionchange；只绑一次，靠 #yzbk.open 与 cur.type 过滤 */
  try { document.addEventListener('selectionchange', onSelChange); } catch (e) { }

  window.YZAppBooks = {
    /* 供测试/调试创建阅读器容器（正常流程由 open() 懒创建） */
    readerShell: readerShell,
    tab: shelfTab, sortBy: shelfSort, toggleView: shelfView, moreShell: moreShell, openShell: openShell,
    pickFor: pickFor, shellFor: shellFor, shellAttach: shellAttach, shellDetach: shellDetach, matchShell: matchShell,
    wordClose: hideWordCard,
    wordOpen: function () {
      var go = __wordGo; if (!go) return;
      var parts = String(go).split(':');
      var kind = parts[0], id = go.slice(kind.length + 1);
      hideWordCard();
      try {
        closeBookShelfOnly();
        if (kind === 'concept' && window.openConcept) return window.openConcept(id);
        if (kind === 'figure' && window.openFigure) return window.openFigure(id);
        if (kind === 'event' && window.openEvent) return window.openEvent(decodeURIComponent(id));
        toast('这条还没有独立页面');
      } catch (e) { toast('打不开'); }
    },
    wordExcerpt: function () {
      if (!__wordSel || !cur) return;
      try {
        var a = JSON.parse(localStorage.getItem('yzExcerpts') || '[]');
        if (!Array.isArray(a)) a = [];
        a.unshift({ b: cur.id, txt: __wordSel, note: '', t: Date.now() });
        localStorage.setItem('yzExcerpts', JSON.stringify(a.slice(0, 500)));
        toast('已存为摘录');
        hideWordCard();
      } catch (e) { toast('存摘录失败'); }
    },
    manage: toggleManage, sel: toggleSel, selAll: selAll, delSel: delSel,
    /* 书架里的「🖼 相册」走「我的资料 → 相册」那一套（唯一入口），
       照片在那边能缩放、左右滑、删除、导出 */
    openAlbum: function () {
      try {
        close();
        if (typeof window.openAlbum === 'function') { window.openAlbum(); return; }
        if (window.YZPhoto && YZPhoto.open) { YZPhoto.open(); return; }
        toast('相册未加载');
      } catch (e) { toast('打不开相册'); }
    }, delText: delText,
    shelf: shelf, pick: pick, open: open, close: close, back: back, isOpen: isOpen,
    openText: openText, pickText: pickText,
    gotoChapter: gotoChapter,
    get list() { return _list; },
    get current() { return cur; }
  };
})();
