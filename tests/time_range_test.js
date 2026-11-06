/* =====================================================================
   学通 · 时间轴 / 时空区间回归
   ---------------------------------------------------------------------
   2026-11-02 把两套东西合并成一套：
     旧：`toggleYears` + 「单年淡化」+ `#yearbar`
     新：`toggleTime` + 「起止区间」+ `#stbar`（两个 range + ▶ 播放）
   区间外的节点淡出到 12%（保留上下文），不是整块消失。

   这一段原本没有测试盯着（旧测试 graph_years_test 断言的是已删除的旧 UI），
   本文件是重构后新写的，锁住的是「现在的模型」：

     ① _yr 解析：years 字符串 / y0-y1 / 单年 / 反序 / 无年份
     ② 开关：默认关、打开有 #stbar、关闭后全部恢复
     ③ 区间：滑块 min/max 与 stYears() 一致、收缩后可见数变少
     ④ 淡化：区间外 0.12、区间内 1、无年份节点不淡化
     ⑤ 兜底：整张图谱没有年份时给提示而不是崩
   跑法：node tests/time_range_test.js
   ===================================================================== */
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));

const BASE = (process.env.YZY_SITE
  ? process.env.YZY_SITE.replace(/\/?$/, '/')
  : (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IGN = m => /scrollTo|Not implemented/.test(m || '');

function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (p === 'canvas') return { width: 1, height: 1 };
      if (typeof p === 'string' && /^(font|fillStyle|strokeStyle|lineWidth|globalAlpha|shadowBlur|shadowColor|textAlign|textBaseline|lineDashOffset|lineJoin|lineCap|miterLimit|globalCompositeOperation|filter)$/.test(p)) return undefined;
      return function () {};
    },
    set() { return true; }
  });
}

function inline(h) {
  return h.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, s) => {
    try { return '<script>' + fs.readFileSync(path.join(BASE, s), 'utf8') + '</script>'; }
    catch (e) { return m; }
  });
}

(async function () {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (!IGN(m)) errs.push(m); });

  const dom = new JSDOM(inline(fs.readFileSync(BASE + 'graph.html', 'utf8')), {
    url: 'https://local.test/graph.html', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); }; }
  });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => { const m = (e.error && e.error.stack || e.message) || ''; if (!IGN(m)) errs.push(m); });

  require('./_lazy_hook')(w, BASE);
  await sleep(900);

  let fail = 0, pass = 0;
  const ok = (n, c, x) => { console.log('  ' + (c ? '✓' : '✗') + ' ' + n + (x !== undefined && x !== '' ? ' — ' + x : '')); if (c) pass++; else fail++; };

  /* ---------- ① 年份解析 ---------- */
  console.log('\n[1] _yr：年份从哪来');
  const yr = dflt => { try { return w.eval('_yr(' + JSON.stringify(dflt) + ')'); } catch (e) { return 'ERR:' + e.message; } };
  const a1 = yr({ years: '1818—1883' });
  ok('人物区间「1818—1883」', a1 && a1.a === 1818 && a1.b === 1883, a1 && (a1.a + '-' + a1.b));
  const a2 = yr({ years: '1917' });
  ok('单年「1917」→ 起止相同', a2 && a2.a === 1917 && a2.b === 1917, a2 && (a2.a + '-' + a2.b));
  const a3 = yr({ years: '1883—1818' });
  ok('反序自动交换', a3 && a3.a === 1818 && a3.b === 1883, a3 && (a3.a + '-' + a3.b));
  const a4 = yr({ y0: 1927, y1: 1936, years: '1900' });
  ok('y0/y1 优先于 years（文革图谱口径）', a4 && a4.a === 1927 && a4.b === 1936, a4 && (a4.a + '-' + a4.b));
  ok('没有年份 → null', yr({ name: '无年份' }) === null);

  /* ---------- ② 开关 ---------- */
  console.log('\n[2] 开关与控件');
  ok('初始：stOn = false', w.stOn === false);
  const n0 = w.ns.length;
  ok('默认不做任何淡化（spot 全为 1）', w.ns.every(o => w.spot(o) === 1), '节点 ' + n0);
  ok('默认没有 #stbar', !d.getElementById('stbar'));

  w.toggleTime();
  ok('打开后 stOn = true', w.stOn === true);
  const bar = d.getElementById('stbar');
  ok('#stbar 已创建', !!bar);
  ok('#stbar 可见（display 不是 none）', !!bar && bar.style.display !== 'none', bar && bar.style.display);
  ok('有起止两个滑块 #stA / #stB', !!d.getElementById('stA') && !!d.getElementById('stB'));
  ok('有播放按钮 #stplay 与关闭按钮 #stclose', !!d.getElementById('stplay') && !!d.getElementById('stclose'));

  /* ---------- ③ 区间 ---------- */
  console.log('\n[3] 区间与可见数');
  const Y = w.stYears();
  ok('stYears() 给出合法区间', Y.b >= Y.a && Y.a > 1000, Y.a + '—' + Y.b);
  const ia = d.getElementById('stA'), ib = d.getElementById('stB');
  ok('滑块 min/max 与 stYears() 一致', String(ia.min) === String(Y.a) && String(ia.max) === String(Y.b),
    ia.min + '~' + ia.max);
  ok('初始区间拉满（stA=最早、stB=最晚）', w.stA === Y.a && w.stB === Y.b, w.stA + '—' + w.stB);

  const cntAll = w.stCount();
  ok('拉满时可见数 = 节点总数的一半以上', cntAll >= n0 * 0.5, cntAll + ' / ' + n0);

  // 收窄到最靠后的 50 年
  const narrowA = Y.b - 50 > Y.a ? Y.b - 50 : Y.a;
  w.stA = narrowA; w.stB = Y.b;
  if (typeof w.refreshSt === 'function') w.refreshSt();
  const cntNarrow = w.stCount();
  ok('收窄区间后可见数变少', cntNarrow < cntAll, cntNarrow + ' < ' + cntAll);

  /* ---------- ④ 淡化 ---------- */
  console.log('\n[4] 淡化比例');
  const outside = w.ns.find(o => { const y = w.eval('_yr(' + JSON.stringify(o.d) + ')'); return y && y.b < narrowA; });
  ok('落在区间外的节点淡到 0.12', !!outside && w.spot(outside) === 0.12, outside && w.spot(outside));
  // 把区间收到「某个节点自己的年份」上：它必须保持 1（最不受数据分布影响的判据）
  const anyNode = w.ns.find(o => w.eval('_yr(' + JSON.stringify(o.d) + ')'));
  const anyY = w.eval('_yr(' + JSON.stringify(anyNode.d) + ')');
  w.stA = anyY.a; w.stB = anyY.b;
  ok('区间收到某节点自己的年份上，它保持 1', w.spot(anyNode) === 1,
    (anyNode.d.name || anyNode.d.id) + '（' + anyY.a + '—' + anyY.b + '）spot=' + w.spot(anyNode));
  const noYear = w.ns.find(o => w.eval('_yr(' + JSON.stringify(o.d) + ')') === null);
  ok('无年份的节点不淡化（spot = 1）', !noYear || w.spot(noYear) === 1, noYear ? w.spot(noYear) : '本图谱无此类节点');
  ok('淡出用的是透明度，不是从图上删掉（节点数不变）', w.ns.length === n0, w.ns.length + ' / ' + n0);

  /* ---------- ⑤ 关闭 ---------- */
  console.log('\n[5] 关闭后完全恢复');
  w.toggleTime();
  ok('再点一次：stOn = false', w.stOn === false);
  ok('关闭后所有节点恢复（spot 全为 1）', w.ns.every(o => w.spot(o) === 1));
  ok('关闭后 #stbar 隐藏', !d.getElementById('stbar') || d.getElementById('stbar').style.display === 'none');

  /* ---------- ⑥ 无年份图谱的兜底 ---------- */
  console.log('\n[6] 整张图谱没有年份时');
  const kicked = [];
  const oldToast = w.toast2;
  w.toast2 = function (m) { kicked.push(String(m)); };
  const savedNs = w.ns.slice();
  w.ns.length = 0;
  w.stA = null; w.stB = null;
  w.toggleTime();
  ok('给提示而不是崩溃', kicked.some(m => /没有年份/.test(m)), kicked.join('|'));
  ok('不会进入时空模式', w.stOn === false);
  w.ns.push.apply(w.ns, savedNs);
  w.toast2 = oldToast;

  /* ---------- ⑦ 全程无 JS 异常 ---------- */
  ok('全程无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n共 ' + (pass + fail) + ' 项断言，失败 ' + fail + ' 项' + (fail ? '' : ' · 全部通过'));
  process.exit(fail ? 1 : 0);
})();
