/* 学通 · 数据一致性审计
   检查：关系端点是否都有对应节点（悬空）、id 是否重复、是否有孤立节点、坐标是否合法、
         头像清单指向的文件是否真实存在。
   用法：node tools/audit_data.js   （有问题时退出码 1） */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'data');
global.window = {};
const FILES = ['config.js', 'content.js', 'graph.js', 'graph-wenge.js', 'graph-world.js',
  'geo-china.js', 'geo-world.js', 'graph-geo.js', 'resources.js', 'knowledge.js',
  'libraries.js', 'avatars.js', 'graph3d.js'];
for (const f of FILES) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  try { (0, eval)(fs.readFileSync(p, 'utf8')); } catch (e) { console.log('  [跳过] ' + f + '：' + e.message.slice(0, 60)); }
}
const W = global.window;
let bad = 0;
const fail = m => { bad++; console.log('  ❌ ' + m); };

function checkGraph(label, obj) {
  if (!obj || !Array.isArray(obj.nodes)) return;
  const ids = new Set();
  let dup = 0;
  obj.nodes.forEach(n => { const id = n && (n.id || n.name); if (ids.has(id)) dup++; ids.add(id); });
  const links = Array.isArray(obj.links) ? obj.links : [];
  const dang = links.filter(l => {
    const s = l.source === undefined ? l.from : l.source, t = l.target === undefined ? l.to : l.target;
    return (typeof s === 'string' && !ids.has(s)) || (typeof t === 'string' && !ids.has(t));
  });
  const deg = {};
  links.forEach(l => {
    const s = l.source === undefined ? l.from : l.source, t = l.target === undefined ? l.to : l.target;
    deg[s] = (deg[s] || 0) + 1; deg[t] = (deg[t] || 0) + 1;
  });
  const iso = obj.nodes.filter(n => !deg[n.id || n.name]).length;
  const selfLoop = links.filter(l => (l.source === l.target)).length;
  const line = label + '：' + obj.nodes.length + ' 节点 / ' + links.length + ' 关系';
  if (dup) fail(line + ' —— id 重复 ' + dup + ' 处');
  if (dang.length) fail(line + ' —— 悬空关系 ' + dang.length + ' 条（例：' + dang.slice(0, 2).map(l => (l.source || l.from) + '→' + (l.target || l.to)).join('、') + '）');
  if (selfLoop) fail(line + ' —— 自环 ' + selfLoop + ' 条');
  if (iso) fail(line + ' —— 无任何关系的节点 ' + iso + ' 个');
  if (!dup && !dang.length && !selfLoop && !iso) console.log('  ✅ ' + line + '（0 重复 / 0 悬空 / 0 自环 / 0 孤立）');
}

console.log('— 图谱数据 —');
checkGraph('主图谱 SITE_GRAPH', W.SITE_GRAPH);
checkGraph('文革图谱 SITE_GRAPH_WENGE', W.SITE_GRAPH_WENGE);
checkGraph('世界图谱 SITE_GRAPH_WORLD', W.SITE_GRAPH_WORLD);
const d3 = (W.SITE_GRAPH3D || {}).datasets || {};
Object.keys(d3).forEach(k => checkGraph('3D 数据集 ' + k, d3[k]));

console.log('— 地理坐标 —');
let geoN = 0, geoBad = 0;
[['主图谱/事件', W.SITE_GRAPH_GEO], ['逝世地', W.SITE_DEATH_GEO], ['事件', W.SITE_EVENT_GEO],
 ['世界图谱', W.SITE_GRAPH_WORLD_GEO || (W.SITE_GRAPH_WORLD && W.SITE_GRAPH_WORLD.geo)]].forEach(([k, m]) => {
  if (!m || typeof m !== 'object') return;
  Object.keys(m).forEach(id => {
    const v = m[id]; if (!v || typeof v !== 'object') return;
    /* 约定：geo:[lng,lat]；多点事件为 [[lng,lat],…]；兼容 lng/lat、lon/lat */
    let pts = null;
    if (Array.isArray(v.geo) && v.geo.length) {
      pts = Array.isArray(v.geo[0]) ? v.geo : [v.geo];
    } else if (v.lng !== undefined) pts = [[v.lng, v.lat]];
    else if (v.lon !== undefined) pts = [[v.lon, v.lat]];
    if (!pts) return;
    pts.forEach((p, i) => {
      if (!Array.isArray(p) || p.length < 2) { geoBad++; fail('坐标格式异常：' + k + '/' + id + ' 第 ' + (i + 1) + ' 点'); return; }
      geoN++;
      if (!(Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) { geoBad++; fail('坐标越界：' + k + '/' + id + ' = ' + p.join(',')); }
    });
  });
});
if (!geoBad) console.log('  ✅ 坐标点 ' + geoN + ' 个，全部在合法范围');

console.log('— 头像清单 —');
const AV = W.AVATAR_FILES || {};
const miss = Object.keys(AV).filter(k => { try { return !fs.existsSync(path.join(__dirname, '..', AV[k])); } catch (e) { return true; } });
if (miss.length) fail('头像清单有 ' + miss.length + ' 个文件不存在：' + miss.slice(0, 5).join('、'));
else console.log('  ✅ ' + Object.keys(AV).length + ' 个键全部指向真实文件');

console.log(bad ? ('\n—— 数据体检：❌ 发现 ' + bad + ' 个问题 ——') : '\n—— 数据体检：✅ 通过 ——');
process.exit(bad ? 1 : 0);
