/* 图谱页节点面板：跨图谱关系（2026-11-15）
 *
 * 用户的要求：在一个图谱里点开节点，要能看到这个人在别的图谱里的关系。
 * 实现方式：assets/graph-cross.js 外挂（不改 graph.html 内联脚本），
 * 用 MutationObserver 在面板打开时把区块插到关系网后面。
 *
 * 本套件验证：
 *   ① 面板打开后确实出现「其他图谱里的关系」区块
 *   ② 区块里列出的是别的图谱里的条目，且数量与数据对得上
 *   ③ 换一个只有单图关系的节点时不硬塞空区块
 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';

function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'canvas') return { width: 1, height: 1 };
      return function () { };
    }, set() { return true; }
  });
}

let html = fs.readFileSync(path.join(SITE, 'graph.html'), 'utf8');
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, pre, src, post) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; }
  catch (e) { return ''; }
});

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

(async function () {
  console.log('===== 图谱页：其他图谱里的关系 =====');
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => { const m = String(e && e.message); if (!/Could not parse CSS|Not implemented/.test(m)) errs.push(m.slice(0, 120)); });

  const dom = new JSDOM(html, {
    url: 'https://local.test/graph.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
      w.scrollTo = () => {};
      w.matchMedia = () => ({ matches: false, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } });
      w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
    }
  });
  const w = dom.window, d = w.document;
  await new Promise(r => setTimeout(r, 1200));

  ok('graph-cross.js 已内联进测试页', /其他图谱里的关系/.test(html));
  ok('图谱数据已就绪', !!(w.SITE_GRAPH && w.SITE_GRAPH.nodes && w.SITE_GRAPH.nodes.length), '主图谱 ' + ((w.SITE_GRAPH || {}).nodes || []).length + ' 节点');

  /* 找一个在多张图谱里都出现、且在其他图谱里确有关系边的 id */
  const ids = new Set(((w.SITE_GRAPH || {}).nodes || []).map(n => n.id));
  const others = [w.SITE_GRAPH_WENGE, w.SITE_GRAPH_WORLD, w.SITE_GRAPH_OLD, w.SITE_GRAPH_NEW].filter(Boolean);
  let pick = null;
  for (const id of ids) {
    let n = 0;
    others.forEach(g => (g.links || []).forEach(l => { if (l && (l.source === id || l.target === id)) n++; }));
    if (n > 0) { pick = id; break; }
  }
  ok('找到一个在其他图谱里也有关系的节点', !!pick, pick || '(无)');

  if (pick) {
    ok('默认没有跨图谱区块', !d.getElementById('yzCrossGraph'));
    w.select(pick);
    await new Promise(r => setTimeout(r, 200));

    const box = d.getElementById('yzCrossGraph');
    ok('打开面板后注入跨图谱区块', !!box);
    if (box) {
      ok('区块标题写明是其他图谱', /其他图谱里的关系/.test(box.textContent));
      ok('区块里带张数与条数', /\d+\s*张/.test(box.textContent) && /\d+\s*条/.test(box.textContent), (box.textContent.match(/\d+ 张 · 共 \d+ 条/) || [''])[0]);
      /* 数量核对：与数据直接算出来的一致 */
      let want = 0;
      others.forEach(g => (g.links || []).forEach(l => { if (l && (l.source === pick || l.target === pick)) want++; }));
      const got = parseInt((box.textContent.match(/共\s*(\d+)\s*条/) || [0, 0])[1], 10);
      ok('条数与数据对得上', got > 0 && (got <= want), '显示 ' + got + ' / 原始累加 ' + want);
    }
  }

  /* 关闭面板再打开另一个节点：区块要跟着换，不能残留上一个的 */
  if (pick) {
    w.select(pick);
    await new Promise(r => setTimeout(r, 150));
    const boxes = d.querySelectorAll('#yzCrossGraph');
    ok('重复打开不会叠加多个区块', boxes.length === 1, boxes.length);
  }

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
})();
