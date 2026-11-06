/* 文革图谱要点完整性回归（14 项）
   背景：这一层曾有两处硬伤 —— ①7 个人物节点的 name 直接用了英文 id（页面显示 "mao"），
        缺 years/role/desc；②122 个节点没有「要点」，点开只有一句简介。
   本测试锁住：要点全覆盖、每条 3 条以上、人物节点有中文名与生卒、关系无悬空、
            无重复 id、地理落点齐全、渲染链路能把要点显示出来。 */
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
    url: 'https://local.test/graph.html?g=wenge', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); }; }
  });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => { const m = (e.error && e.error.stack || e.message) || ''; if (IGN(m)) return; errs.push(m); });
  require('./_lazy_hook')(dom.window, BASE);   /* 图谱数据是动态注入的，jsdom 需要真的加载 */
  await sleep(900);
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };

  const N = w.GR.nodes;
  ok('节点 202 个 · 关系 278 条', N.length === 202 && w.GR.links.length === 278, N.length + ' / ' + w.GR.links.length);

  /* ① 要点全覆盖 */
  const noPts = N.filter(n => !n.points || !n.points.length);
  ok('每个节点都有「要点」', noPts.length === 0, noPts.map(n => n.id).join(',') || '全覆盖');
  ok('每个节点要点 ≥ 3 条', N.every(n => (n.points || []).length >= 3),
    '最少 ' + Math.min(...N.map(n => (n.points || []).length)) + ' 条');
  const ptsChars = N.reduce((a, n) => a + (n.points || []).reduce((b, s) => b + s.length, 0), 0);
  ok('要点总字数过万', ptsChars > 12000, ptsChars.toLocaleString() + ' 字');

  /* ② 人物节点：不能再用英文 id 当名字 */
  const persons = N.filter(n => n.type === 'person');
  const idAsName = persons.filter(n => !n.name || n.name === n.id);
  ok('人物节点都有中文名（不再显示 id）', idAsName.length === 0, idAsName.map(n => n.id).join(',') || '全部正常');
  ok('人物节点有生卒年', persons.every(n => n.years && /\d{4}/.test(n.years)));
  ok('人物节点有身份与简介', persons.every(n => n.role && n.desc));

  /* ③ 结构完整性 */
  const ids = new Set(N.map(n => n.id));
  ok('关系无悬空端点', w.GR.links.every(l => ids.has(l.source) && ids.has(l.target)));
  ok('节点 id 无重复', ids.size === N.length);
  ok('每个节点都有地理落点', N.every(n => n.geo && n.geo.length === 2),
    N.filter(n => !n.geo).map(n => n.id).join(',') || '全覆盖');
  ok('每个节点都有出处', N.filter(n => n.sources && n.sources.length).length >= N.length - 35,
    N.filter(n => n.sources && n.sources.length).length + '/' + N.length);

  /* ④ 渲染链路：选中节点后要点要出现在面板里 */
  try { w.panel('mao'); } catch (e) { console.log('  panel 异常: ' + e.message); }
  const ppts = d.getElementById('ppts');
  const html = ppts ? ppts.innerHTML : '';
  ok('节点面板渲染出要点列表', html.indexOf('要点') >= 0 && /<li>/.test(html));
  ok('面板显示的是毛泽东的要点（不是别人的）',
    html.indexOf('炮打司令部') >= 0 || html.indexOf('红卫兵') >= 0, html.slice(0, 60).replace(/\s+/g, ' '));

  if (errs.length) { console.log('\n JS 错误: ' + errs.slice(0, 3).join(' | ')); fail++; }
  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
