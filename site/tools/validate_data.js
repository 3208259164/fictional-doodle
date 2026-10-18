#!/usr/bin/env node
/* 学通 · 数据校验器（Schema 化，可反复运行 / 可进 CI）
   检查：必填字段、id 规范与唯一性、分类取值、关系边悬空、人物字段、
        头像文件存在性、别名表指向、以及"写死版本号"等历史坑。
   用法：node tools/validate_data.js   （退出码 0=通过） */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = { window: {} }; vm.createContext(ctx);
['config','resources','netdisks','content','knowledge','libraries','graph','avatars'].forEach(f => {
  const p = path.join(ROOT, 'data', f + '.js');
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
});
const W = ctx.window;
let err = 0, warn = 0;
const E = m => { err++; console.log('  ❌ ' + m); };
const Wn = m => { warn++; console.log('  ⚠️ ' + m); };
const OK = m => console.log('  ✓ ' + m);

const CFG = W.SITE_CONFIG || {}, RES = W.SITE_RESOURCES || [], G = W.SITE_GRAPH || { nodes: [], links: [] };
const EX = W.SITE_EXTRA || {}, CT = W.SITE_CONTENT || {};

console.log('== 学通 · 数据校验 ==');

/* 1. 站点配置 */
(CFG.version && /^\d+\.\d+\.\d+$/.test(CFG.version)) ? OK('站点版本 ' + CFG.version) : E('SITE_CONFIG.version 缺失或非 SemVer');
CFG.siteUrl ? OK('siteUrl 已配置') : E('SITE_CONFIG.siteUrl 缺失');

/* 2. 资源 */
const CATS = ['原著','导读','词典','有声书','歌曲','影像','参考','工具'];
const ids = new Set(), dup = [];
RES.forEach((r, i) => {
  if (!r.id) E('资源 #' + i + ' 缺 id');
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(r.id)) Wn('资源 id 不符合小写短横线规范：' + r.id);
  if (r.id && ids.has(r.id)) dup.push(r.id); ids.add(r.id);
  if (!r.title) E('资源 ' + (r.id || '#' + i) + ' 缺 title');
  if (!r.cat) E('资源 ' + r.id + ' 缺 cat');
  else if (CATS.indexOf(r.cat) < 0) Wn('资源 ' + r.id + ' 的分类不在标准集：' + r.cat);
  if (r.url && !/^(https?:|\.|\/|#|books\/|audio\/|images\/|assets\/)/i.test(r.url)) E('资源 ' + r.id + ' 的 url 协议可疑：' + r.url);
});
dup.length ? E('资源 id 重复：' + dup.join(',')) : OK('资源 ' + RES.length + ' 条，id 唯一且规范');
const byCat = {}; RES.forEach(r => { byCat[r.cat] = (byCat[r.cat] || 0) + 1; });
OK('分类分布：' + JSON.stringify(byCat));

/* 3. 图谱 */
const nid = new Set(), ndup = [];
G.nodes.forEach(n => { if (!n.id) E('图谱节点缺 id'); if (nid.has(n.id)) ndup.push(n.id); nid.add(n.id); });
ndup.length ? E('图谱节点 id 重复：' + ndup.join(',')) : OK('图谱节点 ' + G.nodes.length + ' 个，id 唯一');
const pers = G.nodes.filter(n => n.type === 'person');
const bad = G.links.filter(l => !nid.has(l.source) || !nid.has(l.target));
bad.length ? E('关系边悬空 ' + bad.length + ' 条') : OK('关系边 ' + G.links.length + ' 条，无悬空');
['desc','role','years'].forEach(k => { const m = pers.filter(p => !p[k]); m.length ? E('人物缺 ' + k + '：' + m.map(p => p.id).join(',')) : OK('人物均有 ' + k); });
const noWorks = pers.filter(p => !p.works || !p.works.length);
noWorks.length ? Wn('人物缺代表作 ' + noWorks.length + ' 位（页面会隐藏该栏）：' + noWorks.slice(0, 8).map(p => p.id).join(',')) : OK('人物均有代表作');
const noImg = pers.filter(p => p.img && !fs.existsSync(path.join(ROOT, p.img)));
noImg.length ? E('头像文件缺失 ' + noImg.length + ' 个：' + noImg.map(p => p.id + '→' + p.img).join(' | ')) : OK('' + pers.length + ' 位人物头像文件全部存在');
const noEdge = pers.filter(p => !G.links.some(l => l.source === p.id || l.target === p.id));
noEdge.length ? Wn('孤立人物（无边）：' + noEdge.map(p => p.id).join(',')) : OK('无孤立人物');

/* 4. 别名表（图谱名 → 史料名）必须都指向存在的图谱节点 */
const AL = W.SITE_ALIAS || {};
const badAlias = Object.keys(AL).filter(k => !G.nodes.some(n => n.name === k));
badAlias.length ? Wn('别名表的源名不在图谱中：' + badAlias.join(',')) : OK('别名表 ' + Object.keys(AL).length + ' 条，源名均在图谱内');

/* 5. 文本内容 */
const leaders = CT.leaders || [], comrades = CT.comrades || [], critics = EX.critics || [];
[...leaders, ...comrades].forEach((p, i) => { if (!p.name) E('人物条目缺 name (#' + i + ')'); });
OK('革命导师 ' + leaders.length + ' 位 ｜ 革命同志 ' + comrades.length + ' 位 ｜ 被批判人物 ' + critics.length + ' 位');

/* 6. 历史坑：写死版本号 */
const hard = JSON.stringify(CT).match(/"v\d+\.\d+\.\d+"/g) || [];
hard.length ? Wn('content.js 里疑似写死版本号：' + [...new Set(hard)].join(',') + '（应改为引用 SITE_CONFIG.version）') : OK('文本内容未写死版本号');

console.log('\n== 结果：错误 ' + err + ' 项，提醒 ' + warn + ' 项 ==');
process.exit(err ? 1 : 0);
