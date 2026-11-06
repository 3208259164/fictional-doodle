/* 主图谱时间轴回归（16 项）
   背景：主图谱 124 个节点原来没有数字型 y0/y1，graph.html 的 yearsAvailable() 恒为假，
        时间轴按钮点了没反应。本测试锁住「补年份之后时间轴真的能用」。
   覆盖：数据完整性（124 节点全有 y0）、跨度、开关状态、滑块、按年份的显隐曲线、
        年份依据说明（org/idea 的 yearBasis）。 */
const path = require('path'), fs = require('fs');
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
    url: 'https://local.test/graph.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); }; }
  });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => { const m = (e.error && e.error.stack || e.message) || ''; if (IGN(m)) return; errs.push(m); });
  await sleep(900);
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };

  /* ① 数据完整性 */
  const N = w.GR.nodes;
  ok('主图谱节点数 124', N.length === 124, N.length + ' 个');
  ok('全部节点有数字型 y0', N.every(n => typeof n.y0 === 'number'), N.filter(n => typeof n.y0 !== 'number').map(n => n.name).join(',') || '无缺');
  ok('人物都有 y1（卒年）', N.filter(n => n.type === 'person').every(n => typeof n.y1 === 'number'));
  const span = [Math.min(...N.map(n => n.y0)), Math.max(...N.map(n => n.y1 || n.y0))];
  ok('年份跨度 1516—2016', span[0] === 1516 && span[1] === 2016, span.join('—'));
  ok('组织/思潮带年份依据说明', N.filter(n => n.type !== 'person').every(n => !!n.yearBasis),
    N.filter(n => n.type !== 'person' && !n.yearBasis).map(n => n.name).join(',') || '全部有');

  /* ② 开关能真正打开（原来 yearsAvailable() 恒假 → 点了没反应） */
  ok('yearsAvailable() 为真', typeof w.yearsAvailable === 'function' && w.yearsAvailable() === true);
  w.toggleYears();
  ok('时间轴已开启', w.yearOn === true);
  const cb3 = d.getElementById('cb3');
  ok('按钮进入选中态', !!cb3 && cb3.classList.contains('on'));
  const bar = d.getElementById('yearbar');
  ok('出现滑块条 #yearbar', !!bar && bar.style.display !== 'none');
  ok('区间取全图最小/最大年', w.yearMin === 1516 && w.yearMax === 2016, w.yearMin + '—' + w.yearMax);
  const rng = d.getElementById('yrange');
  ok('滑块 min/max 已设置', !!rng && +rng.min === 1516 && +rng.max === 2016);

  /* ③ 按年份的显隐曲线 */
  const marx = w.ix['marx'], mao = w.ix['mao'], uto = w.ix['utopian'];
  w.yearVal = 1930;
  ok('1930 年：马克思已逝世（淡化）', w.spot(marx) < 0.3, 'spot=' + w.spot(marx).toFixed(2));
  ok('1930 年：毛泽东在世（正常显示）', w.spot(mao) > 0.7, 'spot=' + w.spot(mao).toFixed(2));
  w.yearVal = 1600;
  ok('1600 年：马克思尚未出生（淡化）', w.spot(marx) < 0.3, 'spot=' + w.spot(marx).toFixed(2));
  ok('1600 年：空想社会主义（1516 起）可见', w.spot(uto) > 0.7, 'spot=' + w.spot(uto).toFixed(2));
  w.yearVal = 2016;
  ok('2016 年：活到 1990 年代的人仍可见', w.spot(mao) < 0.3 && w.spot(w.ix['deng_xiaoping']) < 0.3);

  w.toggleYears();
  ok('再点一次关闭，滑块隐藏', w.yearOn === false && (!d.getElementById('yearbar') || d.getElementById('yearbar').style.display === 'none'));

  if (errs.length) { console.log('\n JS 错误: ' + errs.slice(0, 3).join(' | ')); fail++; }
  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
