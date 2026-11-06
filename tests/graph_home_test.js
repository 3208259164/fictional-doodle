/* 首页图谱入口 + 图谱管理「主页入口」开关（14 项）
   背景：首页「我的主页」里的图谱入口是启动那一刻用 YZY.listGraphs() 渲染的，
        而 data/graph-wenge.js 是 400ms 后才动态加载的（首屏不背 142KB）。
        以前内置图谱列表要求「数据已在」才注册文革图谱 → 首页永远少一个入口。
   本测试故意**不加载** graph-wenge.js，模拟「动态加载之前」的状态。 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  const f = src.split('?')[0];
  if (/graph-wenge\.js$/.test(f)) return '<!-- 故意不加载：模拟动态加载之前 -->';
  try { return '<script>' + fs.readFileSync(path.join(SITE, f), 'utf8') + '</script>'; } catch (e) { return ''; }
});
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window, d = w.document;
setTimeout(() => {
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? (' — ' + x) : '')); if (!c) fail++; };
  const box = d.getElementById('homeFriends');
  ok('首页「我的主页」容器存在', !!box);
  const txt = box ? box.textContent : '';
  ok('文革图谱数据未加载（模拟动态加载前）', !w.SITE_GRAPH_WENGE);
  const gs = w.YZY.listGraphs();
  const ids = gs.map(g => g.id);
  ok('内置图谱列表含文革图谱', ids.indexOf('wenge') >= 0, ids.join(','));
  ok('内置图谱列表含世界图谱', ids.indexOf('world') >= 0);
  ok('首页确实出现「文革图谱」入口', /文革图谱/.test(txt), (txt.match(/文革图谱|世界图谱|主图谱|3D/g) || []).join('/'));
  ok('首页出现「世界图谱」入口', /世界图谱/.test(txt));

  /* 主页入口开关 */
  ok('默认全部开启：homeGraphOn(wenge) 为真', w.YZY.homeGraphOn('wenge') === true);
  const r1 = w.YZY.setHomeGraph('wenge', false);
  ok('关掉文革图谱入口后返回 ok', r1 && r1.ok, JSON.stringify(r1));
  ok('关掉后 homeGraphOn(wenge) 为假', w.YZY.homeGraphOn('wenge') === false);
  w.renderHomeFriends();
  ok('关掉后首页不再出现文革图谱', !/文革图谱/.test(d.getElementById('homeFriends').textContent));
  ok('关掉文革图谱不影响世界图谱', /世界图谱/.test(d.getElementById('homeFriends').textContent));

  w.YZY.setHomeGraph('wenge', true);
  w.renderHomeFriends();
  ok('重新打开后又出现在首页', /文革图谱/.test(d.getElementById('homeFriends').textContent));

  /* 关掉 3D */
  w.YZY.setHomeGraph('3d', false); w.renderHomeFriends();
  ok('关掉 3D 关系图谱入口生效', !/3D 关系图谱/.test(d.getElementById('homeFriends').textContent));
  w.YZY.setHomeGraph('3d', true); w.renderHomeFriends();

  /* 主图谱：关掉之后不能在首页被「兜底」加回来 */
  w.YZY.setHomeGraph('main', false); w.renderHomeFriends();
  ok('关掉主图谱后首页不出现「主图谱」', !/主图谱/.test(d.getElementById('homeFriends').textContent),
    d.getElementById('homeFriends').textContent.replace(/\s+/g, ' ').slice(0, 60));
  w.YZY.setHomeGraph('wenge', false); w.YZY.setHomeGraph('world', false); w.YZY.setHomeGraph('3d', false);
  w.renderHomeFriends();
  const allOff = d.getElementById('homeFriends').textContent;
  ok('全部关掉后也不会偷偷把主图谱加回来', !/主图谱（内置）|主图谱\b/.test(allOff), allOff.replace(/\s+/g, ' ').slice(0, 60));
  ok('全部关掉后不在首页留任何提示（史料里本来就能进图谱）', !/都已关闭|图谱入口/.test(allOff));
  ok('全部关掉后「我的主页」仍保留人物（只是没有图谱入口）', /马克思/.test(allOff));
  ['main', 'wenge', 'world', '3d'].forEach(id => w.YZY.setHomeGraph(id, true));
  w.renderHomeFriends();

  /* 关闭列表是「只记关掉的」，以后新增内置图谱自动出现 */
  w.localStorage.setItem('homeGraphsOff', JSON.stringify(['wenge']));
  ok('只记关掉的图谱 id', JSON.stringify(w.YZY.homeGraphsOff()) === '["wenge"]', JSON.stringify(w.YZY.homeGraphsOff()));
  ok('主图谱默认仍开启', w.YZY.homeGraphOn('main') === true);

  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
}, 1800);
