/* =====================================================================
   测试用：让 jsdom 能「真的加载」按需注入的脚本
   ---------------------------------------------------------------------
   站点从 0.17.35 起把首屏不用的数据改成按需注入（assets/lazydata.js：
   document.createElement('script') → 设 src → appendChild）。jsdom 不会去
   取这个外部文件，于是测试里 window.SITE_YEAR / SITE_GUIDES 一直是空的，
   老断言就全红——红的是测试，不是功能。

   用法（放在 beforeParse 里，最后一行）：
       require('./_lazy_hook')(w, SITE);
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = function installLazyHook(w, SITE) {
  const doc = w.document;
  const origCreate = doc.createElement.bind(doc);

  doc.createElement = function (tag) {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() !== 'script') return el;

    let _src = '';
    Object.defineProperty(el, 'src', {
      configurable: true,
      get() { return _src; },
      set(v) {
        _src = v;
        // 站点代码是「先赋 src、后赋 onload」，所以这里必须异步，等 onload 挂上再回调
        setTimeout(function () {
          try {
            const file = path.join(SITE, String(v).split('?')[0].replace(/^\.?\//, ''));
            const code = fs.readFileSync(file, 'utf8');
            w.eval(code);
            if (typeof el.onload === 'function') el.onload({ type: 'load', target: el });
          } catch (e) {
            if (typeof el.onerror === 'function') el.onerror({ type: 'error', target: el, error: e });
          }
        }, 5);
      },
    });
    return el;
  };
};
