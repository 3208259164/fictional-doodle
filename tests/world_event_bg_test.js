/* 世界图谱事件「背景 / 影响」回归（10 项）
   背景：79 个事件节点原来只有 desc + points，没有「为什么发生」与「后来怎样」。
        本次补 bg/impact 并在节点面板渲染，本测试锁住数据完整性与渲染链路。 */
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));
const BASE = (process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IGN = m => /scrollTo|Not implemented/.test(m || '');
function fakeCtx() { return new Proxy({}, { get(t, p) { if (p === 'measureText') return () => ({ width: 10 }); if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} }); if (p === 'canvas') return { width: 1, height: 1 }; if (typeof p === 'string' && /^(font|fillStyle|strokeStyle|lineWidth|globalAlpha|shadowBlur|shadowColor|textAlign|textBaseline|lineDashOffset|lineJoin|lineCap|miterLimit|globalCompositeOperation|filter)$/.test(p)) return undefined; return function () {}; }, set() { return true; } }); }
function inline(h) { return h.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, s) => { try { return '<script>' + fs.readFileSync(path.join(BASE, s), 'utf8') + '</script>'; } catch (e) { return m; } }); }

(async function () {
  const errs = []; const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (IGN(m)) return; errs.push(m); });
  const dom = new JSDOM(inline(fs.readFileSync(BASE + 'graph.html', 'utf8')), {
    url: 'https://local.test/graph.html?g=world', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); }; }
  });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => { const m = (e.error && e.error.stack || e.message) || ''; if (IGN(m)) return; errs.push(m); });
  require('./_lazy_hook')(dom.window, BASE);   /* 图谱数据是动态注入的，jsdom 需要真的加载 */
  await sleep(900);
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };

  const N = w.GR.nodes;
  const ev = N.filter(n => n.type === 'event');
  ok('世界图谱事件节点 79 个', ev.length === 79, ev.length + ' 个');
  ok('每个事件都有「背景」', ev.every(n => n.bg && n.bg.length >= 20),
    ev.filter(n => !n.bg).map(n => n.name).join(',') || '全部有');
  ok('每个事件都有「影响 · 意义」', ev.every(n => n.impact && n.impact.length >= 20),
    ev.filter(n => !n.impact).map(n => n.name).join(',') || '全部有');
  const tot = ev.reduce((a, n) => a + n.bg.length + n.impact.length, 0);
  ok('背景+影响总字数过九千', tot > 9000, tot + ' 字');

  /* 渲染链路：选中事件节点后面板应出现「背景」与「影响 · 意义」 */
  try { w.panel('ev_stalingrad'); } catch(e) { console.log('  panel 调用异常: '+e.message); }
  const ppts = d.getElementById('ppts');
  ok('节点面板已渲染', !!ppts);
  const html = ppts ? ppts.innerHTML : '';
  ok('面板出现「背景」段', html.indexOf('背景') >= 0);
  ok('面板出现「影响」段', html.indexOf('影响') >= 0);
  ok('内容是斯大林格勒的背景（不是别的节点）', html.indexOf('1942 年夏') >= 0 || html.indexOf('蓝色') >= 0);

  /* 无 bg 的节点不应出现背景段（退化路径） */
  const pn = N.find(n => n.type === 'person' && !n.bg);
  if (pn) {
    try { w.panel(pn.id); } catch(e) {}
    const h2 = d.getElementById('ppts').innerHTML;
    ok('人物节点不显示「背景」段', h2.indexOf('>背景<') < 0 || h2.indexOf('sub2">背景') < 0);
  } else { ok('（无人物节点可测退化路径，跳过）', true); }

  if (errs.length) { console.log('\n JS 错误: ' + errs.slice(0, 3).join(' | ')); fail++; }
  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
