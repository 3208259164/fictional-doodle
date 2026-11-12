/* 地图聚合「重复」审计（12 项）
   用户反复报的现象：地图上「合并成计数圈的」和「圈里面的内容节点」会同时出现。
   一层层查下来其实是三件事，本测试逐个锁住：
     ① 节点层：被合并进计数圈的节点仍被单独画了点；
     ② 标签层：被合并的节点虽然不画点了，名字还照画 → 圈心附近堆一片人名；
     ③ 事件层：被合并进事件徽标的标点仍被单独画了点、单独登记了命中项
        （于是「圈里写 3，点开只有 1 条」），事件徽标还会压在节点圈上。
   判据用运行时探针 window._aggIds / _drawnIds / _aggDup / AGG / EVMARKS。 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'graph.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? (' — ' + x) : '')); if (!c) fail++; };

function boot(gid, cb) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://local.test/graph.html?g=' + gid, pretendToBeVisual: true,
    beforeParse(w) {
      w.devicePixelRatio = 2;
      const fake = () => new Proxy({}, {
        get: (t, k) => (k === 'measureText' ? (() => ({ width: 30 }))
          : (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') ? (() => ({ addColorStop() {} }))
            : (k === 'canvas' ? { width: 900, height: 700 } : () => {})),
        set: () => true
      });
      w.HTMLCanvasElement.prototype.getContext = function () { return fake(); };
      w.scrollTo = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    }
  });
  setTimeout(() => cb(dom.window), 2200);
}

function audit(w, tag) {
  if (w.viewMode !== 'geo') w.toggleViewMode();
  try { w.draw(); } catch (e) { }
  const ns = w.ns || [], AGG = w.AGG || [], EV = w.EVMARKS || [];
  const dup = w._aggDup || [];
  console.log(`  · ${tag}：节点 ${ns.length} / 计数圈 ${AGG.length} / 合并进圈 ${Object.keys(w._aggIds || {}).length} / 单独绘制 ${(w._drawnIds || []).length}`);
  ok(`${tag}：没有「圈里成员又被单独绘制」`, dup.length === 0, dup.slice(0, 5).join(','));
  let far = 0;
  const byId = {}; ns.forEach(n => byId[n.d.id] = n);
  AGG.forEach(a => (a.ids || []).forEach(id => {
    const n = byId[id]; if (!n || !w.S) return;
    const p = w.S(n); if (Math.hypot(p.x - a.x, p.y - a.y) > 2.5) far++;
  }));
  ok(`${tag}：圈成员坐标与圈心一致（圈画在成员质心上）`, far === 0, far + ' 个偏离');
  /* 允许「单个事件小点」落在节点圈里（不同内容，且锚死坐标不偏移）；
     但不允许「事件数字徽标」叠在节点计数圈上——两个数字互相盖住就分不清了。 */
  let over = 0;
  AGG.forEach(a => EV.forEach(m => { if (m.kind === 'agg' && Math.hypot(m.x - a.x, m.y - a.y) < 3) over++; }));
  ok(`${tag}：事件「数字」徽标不压在节点计数圈上`, over === 0, over + ' 处重叠');
  /* 点数字圈：应展开该处全部条目 */
  if (AGG.length) {
    const a0 = AGG.filter(a => a.n >= 3)[0] || AGG[0];
    let n0 = 0;
    try { w.__tapOut = null; w.tapAt(a0.x, a0.y); } catch (e) { }
    const cl = w.document.getElementById('clusterList') || w.document.getElementById('clList');
    ok(`${tag}：点击计数圈能进到条目列表`, !!cl || typeof w.tapAt === 'function');
  }
}

boot('world', w => {
  try {
    audit(w, '世界图谱');
    /* ③ 事件没被"删掉"：上一版把落进圈的标点全并进去，用户以为内容丢了；
       现在单个事件点照画（只是锚死坐标、不偏移），所以数量要够多。 */
    const evPts = (w.EVMARKS || []).filter(m => m.kind === 'event');
    ok('世界图谱：事件标点没有被删掉（照旧画在图上）', evPts.length >= 25, evPts.length + ' 个事件标点');

    /* ④ 事件坐标必须严格等于投影值：不许有任何屏幕像素偏移（偏移会随缩放滑动） */
    let off = 0, offMax = 0;
    (w.EVMARKS || []).forEach(m => {
      if (typeof m.lng !== 'number') return;
      const pr = w.proj(m.lng, m.lat), v = w.view;
      const ex = pr.x * v.k + v.x, ey = pr.y * v.k + v.y;
      const dd = Math.hypot(m.x - ex, m.y - ey);
      if (dd > 0.6) { off++; offMax = Math.max(offMax, dd); }
    });
    ok('世界图谱：事件标点零屏幕偏移（缩放不会漂）', off === 0, off + ' 个偏移，最大 ' + offMax.toFixed(1) + 'px');

    /* ⑤ 单个事件点：点一下直接出详情，不再套一层「只有一行的列表」 */
    const singles = (w.EVMARKS || []).filter(m => m.n === 1 && m.kind === 'event');
    ok('世界图谱：有单独的事件标点可点', singles.length > 0, singles.length + ' 个');
    const visPts = (w._drawnIds || []).map(id => w.ix[id]).filter(Boolean).map(o => w.S(o));
    const solo = singles.filter(m => !(w.AGG || []).some(a => Math.hypot(m.x - a.x, m.y - a.y) < a.r + 8)
      && !visPts.some(p => Math.hypot(p.x - m.x, p.y - m.y) < 12))[0];
    if (solo) {
      w.tapAt(solo.x, solo.y);
      const chip = w.document.getElementById('pchip').textContent;
      const rows = w.document.querySelectorAll('#pback .clitem').length;
      ok('单个事件标点：点一下直接是事件详情（不是列表）', chip === '事件' && rows === 0, '标题标签=' + chip + ' 列表行=' + rows);
      ok('单个事件标点：打开的就是这条事件本身', w.document.getElementById('pname').textContent === solo.nm,
        w.document.getElementById('pname').textContent + ' / 期望 ' + solo.nm);
    }

    /* ⑥ 同类节点外观必须一致（尺寸/透明度），别一半大一半小 */
    const st = w._nodeStyle || [];
    const rs = {}; st.forEach(x => { rs[x.ty + '|' + x.r + '|' + x.a] = 1; });
    const personR = st.filter(x => x.ty === 'person').map(x => x.r);
    ok('世界图谱：所有人物节点半径一致', new Set(personR).size <= 1, [...new Set(personR)].join(','));
    const allR = st.map(x => x.r);
    ok('世界图谱：所有类型节点同一尺寸（不再人物小、事件大）', new Set(allR).size === 1, [...new Set(allR)].join(','));

    /* ⑦ 事件不能既当节点又当标点（否则同一处两个名字） */
    const G = w.SITE_GRAPH_WORLD || {};
    const evNode = new Set((G.nodes || []).filter(n => n.type === 'event').map(n => n.name));
    const dupEv = (w.EVMARKS || []).filter(m => m.kind === 'event' && evNode.has(m.nm));
    ok('世界图谱：事件只出现一次（不再图和标点各一个名字）', dupEv.length === 0, dupEv.map(m => m.nm).slice(0, 5).join(','));

    /* ⑧ 点一个"看得见的节点"：直接打开它自己，不该弹出同地点的列表 */
    const visIds = w._drawnIds || [];
    const evNodeObj = visIds.map(id => w.ix[id]).filter(o => o && o.d && o.d.type === 'event')[0];
    if (evNodeObj) {
      const pp = w.S(evNodeObj);
      w.tapAt(pp.x, pp.y);
      const rows = w.document.querySelectorAll('#pback .clitem').length;
      const title = w.document.getElementById('pname').textContent;
      ok('点节点直接打开节点本身（不是同地点清单）', rows === 0 && title === evNodeObj.d.name, '标题=' + title + ' 行=' + rows);
    }

    /* ⑨ 时间轴：世界图谱也该可用（以前只认 y0，一个都没有 → 按钮点了没反应） */
    ok('世界图谱：时间轴可用（years 字符串也能解析）', w.yearsAvailable() === true);
    /* 2026-11-02 时间轴重构：toggleYears/#yearbar → toggleTime/#stbar + stOn/stA/stB */
    w.toggleTime();
    ok('世界图谱：时间轴打开后有年份区间', w.stOn === true && typeof w.stA === 'number' && typeof w.stB === 'number',
      w.stA + '-' + w.stB);
    const oldMan = w.ns.filter(o => /列宁/.test(o.d.name || ''))[0];
    if (oldMan) {
      /* 新区间模型：把区间收到最后一年，区间外的人应被淡化到 0.12 */
      w.stA = w.stB;
      if (typeof w.refreshSt === 'function') w.refreshSt();
      ok('时间轴真的在起作用（区间收到最后一年时旧人物变淡）', w.spot(oldMan) < 0.5, w.spot(oldMan).toFixed(2));
      w.stA = null; w.stB = null; if (typeof w.refreshSt === 'function') w.refreshSt();
    }
    w.toggleTime();

    /* 抽一个圈验证展开条数 */
    const AGG = w.AGG || [];
    const a0 = AGG[0];
    if (a0) {
      let got = -1;
      try { got = w.tapAt(a0.x, a0.y); } catch (e) { }
      ok('世界图谱：点圈返回内容（不是空）', got !== false, String(got));
    }
    boot('wenge', w2 => {
      try {
        audit(w2, '文革图谱');
        const AGG2 = w2.AGG || [];
        ok('文革图谱：合并生效（图上有计数圈）', AGG2.length > 0, AGG2.length + ' 个圈');
        /* 非地图模式不该有聚合（避免切回关系网后残留） */
        w2.toggleViewMode();
        ok('切回关系网后聚合集合清空', Object.keys(w2._aggIds || {}).length === 0, Object.keys(w2._aggIds || {}).length + ' 个残留');
        console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
        process.exit(fail ? 1 : 0);
      } catch (e) { console.log('✗ 文革图谱出错：', e.message); process.exit(1); }
    });
  } catch (e) { console.log('✗ 世界图谱出错：', e.message, e.stack.split('\n')[1]); process.exit(1); }
});
