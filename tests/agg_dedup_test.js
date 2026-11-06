/* 世界/文革图谱「聚合圈与节点重复」回归（10 项）
   问题现象：地图模式下，同一地点的节点既画出了一个个小点，又叠了一个带数字的计数圈，
            看起来「合并的和合并里面的内容同时出现」。
   根因：draw() 先画所有节点，再算聚合、再把计数圈叠加画上去，画节点时没有排除聚合成员。
   修法：聚合计算提前，节点循环里跳过已被合并的节点。
   本测试锁住：聚合集合可用、节点确实被排除、退出地图后不聚合、点聚合里的节点仍能打开。 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));
const BASE = (process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IGN = m => /scrollTo|Not implemented/.test(m || '');
function fakeCtx() { return new Proxy({}, { get(t, p) { if (p === 'measureText') return () => ({ width: 10 }); if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} }); if (p === 'canvas') return { width: 1, height: 1 }; if (typeof p === 'string' && /^(font|fillStyle|strokeStyle|lineWidth|globalAlpha|shadowBlur|shadowColor|textAlign|textBaseline|lineDashOffset|lineJoin|lineCap|miterLimit|globalCompositeOperation|filter)$/.test(p)) return undefined; return function () {}; }, set() { return true; } }); }
function inline(h) { return h.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, s) => { try { return '<script>' + fs.readFileSync(path.join(BASE, s), 'utf8') + '</script>'; } catch (e) { return m; } }); }

(async function () {
  const errs = []; const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (IGN(m)) return; errs.push(m); });
  const dom = new JSDOM(inline(fs.readFileSync(BASE + 'graph.html', 'utf8')), {
    url: 'https://local.test/graph.html?g=wenge', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); }; }
  });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => { const m = (e.error && e.error.stack || e.message) || ''; if (IGN(m)) return; errs.push(m); });
  await sleep(900);
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };

  ok('默认进入地图模式', w.viewMode === 'geo');
  ok('聚合集合 _aggIds 已建立', !!w._aggIds, Object.keys(w._aggIds || {}).length + ' 个节点被合并');
  ok('_aggIds 非空（确有同地节点）', Object.keys(w._aggIds || {}).length > 0);
  ok('AGG 计数圈已生成', Array.isArray(w.AGG) && w.AGG.length > 0, (w.AGG || []).length + ' 个圈');

  /* 圈里的每个成员都必须在 _aggIds 里（否则会出现「圈 + 小点」重复） */
  const all = (w.AGG || []).reduce((a, g) => a.concat(g.ids || []), []);
  const notMarked = all.filter(id => !w._aggIds[id]);
  ok('AGG 里每个 id 都被标记为「不再单独画」', notMarked.length === 0, notMarked.slice(0, 5).join(',') || '全部标记');
  ok('聚合圈至少含 2 个节点', (w.AGG || []).every(g => (g.ids || []).length >= 2));

  /* 聚合成员仍然可以点开（不是被彻底藏掉） */
  const one = all[0];
  let boom = null;
  try { w.select(one); } catch (e) { boom = e.message; }
  ok('点聚合里的节点仍能选中并出面板', !boom && !!d.getElementById('panel'), boom || 'ok');
  try { w.clearSel(); } catch (e) {}

  /* 退出地图（关系网）不应该聚合 */
  try { w.toggleViewMode(); } catch (e) {}
  await sleep(120);
  const cnt = Object.keys(w._aggIds || {}).length;
  ok('切到关系网后不再聚合（_aggIds 为空）', w.viewMode !== 'geo' && cnt === 0, 'viewMode=' + w.viewMode + ' agg=' + cnt);

  if (errs.length) { console.log('\n JS 错误: ' + errs.slice(0, 2).join(' | ')); fail++; }
  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
