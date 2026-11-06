/* 渲染级验证：graph.html?g=wenge 切到文革图谱并渲染（含关系线类型 UI 与事件节点） */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));
const BASE = (process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (require('fs').existsSync(require('path').join(__dirname, '..', 'site', 'graph.html')) ? (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/' : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() { } });
      if (p === 'canvas') return { width: 1, height: 1 };
      if (typeof p === 'string' && /^(font|fillStyle|strokeStyle|lineWidth|globalAlpha|shadowBlur|shadowColor|textAlign|textBaseline|lineDashOffset|lineJoin|lineCap|miterLimit|globalCompositeOperation|filter)$/.test(p)) return undefined;
      return function () { };
    }, set() { return true; }
  });
}
function inline(html) {
  return html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, function (m, src) {
    try { return '<script>' + fs.readFileSync(path.join(BASE, src), 'utf8') + '</script>'; } catch (e) { return m; }
  });
}
(async function () {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail ? (e.detail.message || e.detail) : e.message)));
  const html = inline(fs.readFileSync(BASE + 'graph.html', 'utf8'));
  const dom = new JSDOM(html, {
    url: 'https://local.test/graph.html?g=wenge', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); }; }
  });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
  await sleep(900);
  let fail = 0;
  const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };
  ok('URL ?g=wenge → 活动图谱为文革图谱', w.YZY.activeGraphId() === 'wenge', w.YZY.activeGraphId());
  ok('画布数据切为文革图谱', w.GR && w.GR.nodes.length >= 60, w.GR && (w.GR.nodes.length + ' 节点 / ' + w.GR.links.length + ' 关系'));
  const byType = {}; (w.GR.nodes || []).forEach(n => byType[n.type] = (byType[n.type] || 0) + 1);
  ok('含事件类节点', (byType.event || 0) >= 10, JSON.stringify(byType));
  ok('关系线 kind 已注入布局', (w.es || []).every(e => e.k), (w.es || []).length + ' 条');
  ok('#kinds 类型过滤按钮 = kind 数', (d.querySelectorAll('#kinds button') || []).length === Object.keys(w.GR.kinds).length, d.querySelectorAll('#kinds button').length + ' 个');
  ok('关系线类型图例存在（线样）', !!d.getElementById('kindLegend') && /border-color/.test(d.getElementById('kindLegend').innerHTML));
  ok('「事件」在节点图例而非关系图例', !!d.querySelector('#nodeLegend') && /事件/.test(d.querySelector('#nodeLegend').textContent) && !/事件/.test((d.getElementById('edgeLegend')||{}).textContent||''));
  ok('类型过滤新增「事件」按钮', !!d.querySelector('#filters button[data-f="event"]'));
  ok('____kf 过滤表已建立', w.__kf && typeof w.__kf === 'object');
  ok('切回主图谱无 kind UI 依赖残留', (function(){
    var n = w.YZY.graphData('main').nodes.length;
    var base = (w.SITE_GRAPH && w.SITE_GRAPH.nodes) ? w.SITE_GRAPH.nodes.length : n;
    /* 主图谱数据量会随内容增长，断言只校验「不是文革图谱那套（202）」且与主图谱数据源一致 */
    return n > 90 && n !== 202 && n === base;
  })(), w.YZY.graphData('main').nodes.length);
  ok('渲染无 JS 错误', errors.length === 0, errors.join(' ; ').slice(0, 200));
  console.log(fail === 0 ? '\n★ 文革图谱 Phase 2 渲染：全部通过' : ('\n★ 失败 ' + fail + ' 项'));
  process.exit(fail === 0 ? 0 : 1);
})();
