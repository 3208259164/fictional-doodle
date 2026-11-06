#!/usr/bin/env node
/* 图谱页管理开关 + 3D 名字层 —— jsdom 实测 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));

function load(file) {
  let html = fs.readFileSync(path.join(SITE, file), 'utf8');
  html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
    const f = path.join(SITE, src);
    if (!fs.existsSync(f)) return '';
    return `<script>${fs.readFileSync(f, 'utf8').replace(/<\/script>/g, '<\\/script>')}</script>`;
  });
  return new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
        get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; }
      });
      w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      w.scrollTo = () => {};
    }
  });
}

const R = []; const ok = (n, c, x) => R.push([c, n, x]);

// ---------- ① 2D 图谱页 ----------
const d2 = load('graph.html');
setTimeout(() => {
  const w = d2.window;
  try {
    ok('管理面板存在', !!w.document.getElementById('mgPanel'));
    ok('「顶部显示」段已加入', !!w.document.getElementById('mgTop'));
    const tops = w.document.querySelectorAll('#mgTop button');
    ok('顶部显示有 3 项（节点图例/关系线图例/操作提示）', tops.length === 3, '实际 ' + tops.length);

    // 排名默认关闭
    const rb = w.document.getElementById('rankb');
    ok('排名按钮存在', !!rb);
    ok('排名默认隐藏', rb && rb.style.display === 'none', rb ? 'display=' + (rb.style.display || '(空)') : '缺');
    ok('mgToolHidden("rankb") 为真', w.eval('mgToolHidden("rankb")') === true);

    // 顶部默认显示
    const nl = w.document.getElementById('nodeLegend');
    ok('节点图例默认可见', nl && nl.style.display !== 'none');
    const sub = w.document.getElementById('tlSub');
    ok('操作提示元素有 id', !!sub);

    // 关掉节点图例
    w.eval('toggleMgrTop("nodeLegend")');
    ok('关掉后节点图例隐藏', nl.style.display === 'none', 'display=' + nl.style.display);
    // 再开
    w.eval('toggleMgrTop("nodeLegend")');
    ok('再点恢复显示', nl.style.display === '');

    // 底部面板收紧（CSS 里应有媒体查询覆盖）
    const cssTxt = w.document.documentElement.innerHTML;
    ok('底部面板有下调收紧样式', cssTxt.indexOf('底部面板下调') >= 0 || cssTxt.indexOf('#tr{bottom:calc(6px') >= 0);
    // 3 个新开关都不影响其它工具
    ok('数据按钮仍默认隐藏', w.eval('mgToolHidden("dtb")') === true);
    ok('适应窗口默认可用', w.eval('mgToolHidden("fb")') === false);
  } catch (e) { R.push([false, '2D 异常: ' + e.message, e.stack && e.stack.split('\n')[1]]); }

  // ---------- ② 3D 图谱页 ----------
  const d3 = load('graph3d.html');
  setTimeout(() => {
    const w3 = d3.window;
    try {
      ok('3D：名字容器 #yzLabels 存在', !!w3.document.getElementById('yzLabels'));
      ok('3D：管理面板 #mg3 存在', !!w3.document.getElementById('mg3'));
      ok('3D：工具栏有「🏷 名字」', !!w3.document.getElementById('lb3'));
      ok('3D：工具栏有「⚙ 管理」', !!w3.document.getElementById('mgb3'));
      ok('3D：yz3d.toggleLabels 已暴露', w3.yz3d && typeof w3.yz3d.toggleLabels === 'function');
      ok('3D：yz3d.toggleMgr3 已暴露', w3.yz3d && typeof w3.yz3d.toggleMgr3 === 'function');
      // 面板开合
      w3.yz3d.toggleMgr3();
      ok('3D：管理面板能打开', w3.document.getElementById('mg3').classList.contains('open'));
      w3.yz3d.toggleMgr3();
      ok('3D：管理面板能关闭', !w3.document.getElementById('mg3').classList.contains('open'));
      // 名字开关（不依赖真实渲染，只看状态与容器）
      const before = w3.document.getElementById('yzLabels').style.display;
      w3.yz3d.toggleLabels();
      const after = w3.document.getElementById('yzLabels').style.display;
      ok('3D：名字开关能切换容器显隐', before !== after, before + ' → ' + after);
    } catch (e) { R.push([false, '3D 异常: ' + e.message, e.stack && e.stack.split('\n')[1]]); }

    let p = 0, f = 0;
    for (const [c, n, x] of R) { console.log(`  ${c ? '✓' : '✗'} ${n}${x !== undefined ? '  → ' + x : ''}`); c ? p++ : f++; }
    console.log(`\n结果：通过 ${p} 项，失败 ${f} 项`);
    process.exit(f ? 1 : 0);
  }, 1200);
}, 1200);
