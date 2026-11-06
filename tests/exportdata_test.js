#!/usr/bin/env node
/* 学通 · 摘录/笔记导出（Markdown / CSV）与本机存储用量 —— jsdom 实测
   被测文件：site_new/assets/exportdata.js（新建）、site_new/assets/mine.js（改）
   只搭最小 DOM（不加载 index.html），避免依赖主 agent 正在改的 app.js。 */
const fs = require('fs');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
const EXPORT_SRC = fs.readFileSync(SITE + '/assets/exportdata.js', 'utf8');
const MINE_SRC = fs.readFileSync(SITE + '/assets/mine.js', 'utf8');

const R = [];
const ok = (n, c, x) => R.push([!!c, n, x === undefined ? '' : String(x).slice(0, 120)]);

const BOOKS = [
  { id: 'ma-xuanji', title: '马克思恩格斯选集', author: '马克思恩格斯', cat: '原著' },
  { id: 'tg-yandu', title: '《共产党宣言》导读, 修订版', author: '李某某', cat: '导读' },   /* 书名含逗号 */
  { id: 'quote-book', title: '他说"你好"的书', author: '王五', cat: '原著' }              /* 书名含双引号 */
];
const EXC = [
  { b: 'ma-xuanji', txt: '全世界无产者，联合起来！\n第二行摘录', note: '这句要记住', t: 1700000000000 },
  { b: 'tg-yandu', txt: '含"引号"的摘录', note: '笔记第一行\n笔记第二行', t: 1700000500000 }
];
const READ = { 'ma-xuanji': { st: 'reading', p: 40, t: 1700000600000 } };

/* ---------- 搭一个最小环境 ---------- */
function mkEnv(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { url: 'https://local.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.SITE_RESOURCES = BOOKS;
  w.__dl = [];                                     /* 下载通道记录 */
  w.__blobText = ''; w.__blobType = '';

  /* Blob：只记录内容，不真做二进制 */
  w.Blob = function (parts, o) {
    w.__blobText = (parts || []).join('');
    w.__blobType = (o && o.type) || '';
    this.parts = parts; this.type = w.__blobType;
  };
  w.URL.createObjectURL = function () { w.__dl.push('blob-url'); return 'blob:stub'; };
  w.URL.revokeObjectURL = function () {};
  w.HTMLAnchorElement.prototype.click = function () {
    w.__dl.push('anchor:' + this.download + ':' + this.href);
  };
  /* 桥：有/无 AndroidApp 两种 */
  if (opts.bridge) {
    w.__bridge = [];
    w.AndroidApp = {
      saveBase64: function (name, b64, mime) {
        w.__bridge.push({ name: name, b64: b64, mime: mime });
        if (opts.bridgeThrow) throw new Error('bridge-boom');
      }
    };
  }
  /* navigator.storage.estimate */
  if (opts.estimate !== false) {
    const storage = {
      estimate: function () {
        return opts.estimateReject
          ? Promise.reject(new Error('no-estimate'))
          : Promise.resolve({ usage: opts.usage || 123456, quota: opts.quota || 50000000 });
      }
    };
    try { Object.defineProperty(w.navigator, 'storage', { value: storage, configurable: true }); }
    catch (e) { try { Object.defineProperty(w.Navigator.prototype, 'storage', { value: storage, configurable: true }); } catch (e2) {} }
  } else {
    try { Object.defineProperty(w.navigator, 'storage', { value: undefined, configurable: true }); }
    catch (e) { try { delete w.Navigator.prototype.storage; } catch (e2) {} }
  }
  return { dom, w };
}
function seed(w) {
  w.localStorage.setItem('yzExcerpts', JSON.stringify(EXC));
  w.localStorage.setItem('yzRead', JSON.stringify(READ));
  w.localStorage.setItem('favs', JSON.stringify(['quote-book']));
  w.localStorage.setItem('marks', JSON.stringify(['tg-yandu']));
}
function clear(w) {
  try { w.localStorage.clear(); } catch (e) {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  /* ================= 环境 A：无桥（浏览器 Blob 兜底） ================= */
  const A = mkEnv({});
  const w = A.w;
  let loadErr = '';
  try { w.eval(EXPORT_SRC); } catch (e) { loadErr = e.message; }
  ok('① exportdata.js 可在经典脚本环境执行', !loadErr, loadErr);
  const X = w.YZEXPORT;
  ok('① 暴露 window.YZEXPORT 且 6 个方法齐全',
    X && ['marksMd', 'cardsMd', 'allMd', 'csv', 'save', 'usage', 'renderUsagePanel'].every((k) => typeof X[k] === 'function'),
    X ? Object.keys(X).join(',') : 'undefined');

  seed(w);

  /* ---------- A1 Markdown：摘录分组 ---------- */
  const md = X.marksMd();
  ok('② marksMd 有一级标题', md.indexOf('# ✍️ 我的摘录与笔记') === 0, md.split('\n')[0]);
  ok('② 每本书一节（两个 ### 书名标题）', (md.match(/^### /gm) || []).length === 2, (md.match(/^### .*/gm) || []).join(' ／ '));
  ok('② 分组归属正确：导读那本书在第一节（最新摘录在前）',
    md.indexOf('### 《共产党宣言》导读, 修订版 · 李某某') >= 0 &&
    md.indexOf('### 《马克思恩格斯选集》 · 马克思恩格斯（1 条）') > md.indexOf('《共产党宣言》导读'),
    md.indexOf('### 《共产党宣言》导读'));
  ok('② 摘录原文用引用块，多行每行都带 >', md.indexOf('> 全世界无产者，联合起来！\n> 第二行摘录') >= 0,
    JSON.stringify(md.slice(md.indexOf('> 全世界'), md.indexOf('> 全世界') + 40)));
  ok('② 我的笔记跟在引用块后', /💭 我的想法：\n\n这句要记住/.test(md), md.match(/💭[\s\S]{0,18}/));
  ok('② 文末有生成时间与书籍总数', /共 2 本书 · 2 条摘录/.test(md) && /生成于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(md),
    (md.match(/共 .*本书.*摘录.*/) || [''])[0]);

  /* ---------- A2 Markdown：收藏/书签/阅读状态表格 ---------- */
  const cm = X.cardsMd();
  ok('③ cardsMd 是表格式（含 | --- | 分隔行）', (cm.match(/^\| --- \|/gm) || []).length === 3, (cm.match(/^\| --- .*/gm) || []).join(' / '));
  ok('③ cardsMd 含收藏书名与阅读状态', cm.indexOf('他说"你好"的书') >= 0 && cm.indexOf('📖 在读') >= 0 && cm.indexOf('40%') >= 0);

  /* ---------- A3 allMd ---------- */
  const am = X.allMd();
  ok('④ allMd 以「# 学通 · 我的阅读笔记」开头', am.indexOf('# 学通 · 我的阅读笔记') === 0);
  ok('④ allMd 带目录且目录是锚点链接',
    am.indexOf('## 目录') > 0 && am.indexOf('[摘录与笔记](#摘录与笔记)') > 0 &&
    am.indexOf('[收藏 · 书签 · 阅读状态](#收藏--书签--阅读状态)') > 0);
  ok('④ allMd 含两大部分（摘录节 + 表格节）',
    am.indexOf('## 摘录与笔记') > 0 && am.indexOf('## 收藏 · 书签 · 阅读状态') > 0 &&
    am.indexOf('### 《马克思恩格斯选集》') > 0);

  /* ---------- A4 CSV ---------- */
  const csv = X.csv();
  ok('⑤ CSV 开头有 UTF-8 BOM', csv.charCodeAt(0) === 0xFEFF, '0x' + csv.charCodeAt(0).toString(16).toUpperCase());
  ok('⑤ CSV 表头正确', csv.slice(1).indexOf('类型,书名,作者,内容,备注,时间') === 0, csv.slice(1, 26));
  ok('⑤ CSV 双引号转义为 ""', csv.indexOf('含""引号""的摘录') > 0, (csv.match(/含.*引号.*摘录/g) || [''])[0]);
  ok('⑤ CSV 含逗号的书名被整体加引号', csv.indexOf('"《共产党宣言》导读, 修订版"') > 0);
  ok('⑤ CSV 含换行的字段加引号（笔记两行在同一字段内）', /"笔记第一行\r?\n笔记第二行"/.test(csv),
    (csv.match(/"笔记第一行[\s\S]{0,14}/) || [''])[0]);
  const csvRows = csv.slice(1).split('\r\n').filter(Boolean);
  ok('⑤ CSV 行数 = 表头 1 + 摘录 2 + 收藏 1 + 书签 1 + 阅读状态 1',
    csvRows.length === 6, '行数=' + csvRows.length);
  ok('⑤ CSV 用 CRLF 换行', csv.indexOf('\r\n') > 0);

  /* ---------- A5 空数据不崩 ---------- */
  clear(w);
  let emptyErr = '';
  let emd = '', ecsv = '', eu = null;
  try { emd = X.allMd(); ecsv = X.csv(); eu = X.usage(); } catch (e) { emptyErr = e.message; }
  ok('⑥ 空数据时 allMd/csv/usage 不抛异常', !emptyErr, emptyErr);
  ok('⑥ 空数据时 Markdown 给出空态文案', emd.indexOf('还没有摘录') > 0);
  ok('⑥ 空数据时 CSV 仍有 BOM + 表头', ecsv.charCodeAt(0) === 0xFEFF && ecsv.indexOf('类型,书名') === 1);
  ok('⑥ 空数据时 usage 归零', eu.local.keys === 0 && eu.local.used === 0 && eu.local.percent === 0,
    JSON.stringify(eu.local));

  /* ---------- A6 usage 数值 ---------- */
  seed(w);
  const u = X.usage();
  let manual = 0;
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    manual += JSON.stringify(String(w.localStorage.getItem(k))).length * 2;
  }
  ok('⑦ usage.local.total 按 5MB 计', u.local.total === 5 * 1024 * 1024, u.local.total);
  ok('⑦ usage.local.used 与「JSON.stringify(v).length*2」独立重算一致', u.local.used === manual,
    u.local.used + ' vs ' + manual);
  ok('⑦ usage.local.percent 与 used/total 相符（小数据四舍五入到 0.1%）',
    Math.abs(u.local.percent - Math.round(u.local.used / u.local.total * 1000) / 10) < 1e-9,
    u.local.used + 'B → ' + u.local.percent + '%');
  /* 造一份大体积数据，验证百分比会真的动起来 */
  w.localStorage.setItem('yzBigBlob', 'x'.repeat(400000));
  const uBig = X.usage();
  ok('⑦ 数据变大后 percent 明显上升且仍 ≈ used/total',
    uBig.local.percent > 10 && uBig.local.percent < 30 &&
    Math.abs(uBig.local.percent - uBig.local.used / uBig.local.total * 100) < 0.2, uBig.local.percent + '%');
  ok('⑦ 大键排在 byKey 第一', uBig.byKey[0].k === 'yzBigBlob', uBig.byKey[0].k + ':' + uBig.byKey[0].bytes);
  w.localStorage.removeItem('yzBigBlob');
  ok('⑦ usage.byKey 按字节降序且首项最大',
    u.byKey.length === w.localStorage.length &&
    u.byKey.every((it, i) => i === 0 || u.byKey[i - 1].bytes >= it.bytes),
    u.byKey.map((x) => x.k + ':' + x.bytes).join(' '));
  ok('⑦ usage.byKey 含 yzExcerpts 与 favs',
    u.byKey.some((x) => x.k === 'yzExcerpts') && u.byKey.some((x) => x.k === 'favs'));

  /* 异步：有 estimate → idb.available，字节数来自 estimate */
  const u2 = await X.refreshUsage();
  ok('⑦ refreshUsage 走 navigator.storage.estimate 后 idb 可用且字节正确',
    u2.idb.available === true && u2.idb.bytes === 123456 && u2.idb.source === 'estimate',
    JSON.stringify(u2.idb));
  /* 降级：estimate 抛错 → available=false，不崩 */
  const B = mkEnv({ estimateReject: true });
  B.w.localStorage.setItem('yzImportedBooks', JSON.stringify([{ id: 'x', size: 2048 }, { id: 'y', size: 1024 }]));
  B.w.eval(EXPORT_SRC);
  const ub = await B.w.YZEXPORT.refreshUsage();
  ok('⑦ estimate 失败时降级（available=false，书籍数仍可用）',
    ub.idb.available === false && ub.idb.books === 2 && ub.idb.bytes === 3072, JSON.stringify(ub.idb));

  /* ---------- A7 renderUsagePanel ---------- */
  const panel = X.renderUsagePanel();
  ok('⑧ 用量面板含进度条与百分比',
    panel.indexOf('width:' + u.local.percent + '%') > 0 && /%<\/b>/.test(panel) &&
    (panel.indexOf(u.local.percent + '%') >= 0 || panel.indexOf('&lt;0.1%') >= 0),
    panel.slice(0, 60));
  ok('⑧ 用量面板含人话结论', /存储|注意|快满/.test(panel) && panel.indexOf('yz-usage') > 0);
  ok('⑧ 用量面板列出键名（最多 10 个）',
    (panel.match(/overflow:hidden;text-overflow:ellipsis/g) || []).length <= 10 &&
    panel.indexOf('摘录与笔记') > 0);
  /* 造 14 个键验证「前 10」 */
  for (let i = 0; i < 14; i++) w.localStorage.setItem('yzPad' + i + '_' + 'x'.repeat(i), 'v'.repeat(i * 10 + 1));
  const panel2 = X.renderUsagePanel();
  ok('⑧ 键超过 10 个时只显示前 10 个',
    (panel2.match(/overflow:hidden;text-overflow:ellipsis/g) || []).length === 10,
    (panel2.match(/overflow:hidden;text-overflow:ellipsis/g) || []).length);
  for (let i = 0; i < 14; i++) w.localStorage.removeItem('yzPad' + i + '_' + 'x'.repeat(i));

  /* ---------- A8 下载通道：无桥 → Blob + <a download> ---------- */
  w.__dl = [];
  const ch1 = X.save('md');
  ok('⑨ 无桥时走 Blob 通道', ch1 === 'blob', ch1);
  ok('⑨ Blob 内容就是 Markdown 全文', w.__blobText.indexOf('# 学通 · 我的阅读笔记') === 0 &&
    w.__blobType.indexOf('text/markdown') === 0, w.__blobType);
  const dl = w.__dl.join('|');
  const today = (() => { const d = new Date(); return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); })();
  ok('⑨ 下载文件名 = 学通-笔记-YYYYMMDD.md', dl.indexOf('anchor:学通-笔记-' + today + '.md:') >= 0, dl);
  ok('⑨ 没有用 window.open（无新窗口）', w.document.querySelectorAll('a[target=_blank]').length === 0);

  w.__dl = []; w.__blobText = '';
  const ch2 = X.save('csv');
  ok('⑨ save("csv") 走 Blob 且内容是带 BOM 的 CSV',
    ch2 === 'blob' && w.__blobText.charCodeAt(0) === 0xFEFF && w.__blobType.indexOf('text/csv') === 0, w.__blobType);
  ok('⑨ CSV 文件名 .csv 后缀', w.__dl.join('|').indexOf('学通-笔记-' + today + '.csv') >= 0, w.__dl.join('|'));
  ok('⑨ 未知 kind 兜底为 md', X.save('bogus') === 'blob' && w.__blobText.indexOf('# 学通') === 0);

  /* ---------- A9 下载通道：有桥 ---------- */
  const C = mkEnv({ bridge: true });
  C.w.eval(EXPORT_SRC);
  seed(C.w);
  const chC = C.w.YZEXPORT.save('md');
  const expect = C.w.YZEXPORT.allMd();
  const b64 = C.w.__bridge[0] || {};
  const decoded = b64.b64 ? decodeURIComponent(escape(Buffer.from(b64.b64, 'base64').toString('binary'))) : '';
  ok('⑩ 有桥时优先走 AndroidApp.saveBase64', chC === 'app' && C.w.__bridge.length === 1, chC);
  ok('⑩ 桥参数：文件名 / mime / base64 内容正确',
    b64.name === '学通-笔记-' + today + '.md' && /text\/markdown/.test(b64.mime || '') && decoded === expect,
    (b64.name || '') + ' ' + (b64.mime || '') + ' len=' + decoded.length);
  ok('⑩ 有桥时不产生 Blob 下载', C.w.__dl.length === 0, C.w.__dl.join('|'));
  C.w.YZEXPORT.save('csv');
  ok('⑩ 桥通道 CSV 也用 text/csv', C.w.__bridge.length === 2 && /text\/csv/.test(C.w.__bridge[1].mime));

  /* 桥抛错 → 回落 Blob */
  const D = mkEnv({ bridge: true, bridgeThrow: true });
  D.w.eval(EXPORT_SRC); seed(D.w);
  ok('⑩ 桥抛异常时回落到 Blob 通道', D.w.YZEXPORT.save('md') === 'blob' && D.w.__blobText.indexOf('# 学通') === 0);

  /* ---------- A10 mine.js 集成 ---------- */
  const M = mkEnv({});
  M.w.openContent = function (title, html) { M.w.__mineHTML = html; M.w.__mineTitle = title; };
  M.w.eval(EXPORT_SRC);
  seed(M.w);
  let mineErr = '';
  try { M.w.eval(MINE_SRC); } catch (e) { mineErr = e.message; }
  ok('⑪ mine.js 语法与执行正常', !mineErr, mineErr);
  ok('⑪ 暴露 YZMine.exportData', typeof M.w.YZMine === 'object' && typeof M.w.YZMine.exportData === 'function');
  const opened = M.w.openMine('ex');
  const html = M.w.__mineHTML || '';
  ok('⑪ 「我的资料」页渲染成功（openContent 被调用）', opened === true && M.w.__mineTitle === '📚 我的资料', M.w.__mineTitle);
  ok('⑪ 页面含两个必需按钮', html.indexOf('📝 导出笔记（Markdown）') > 0 && html.indexOf('📊 存储用量') > 0);
  ok('⑪ 按钮带 data-yzx 且沿用既有 sbtn 样式',
    html.indexOf('class="sbtn" data-yzx="md"') > 0 && html.indexOf('class="sbtn" data-yzx="usage"') > 0);
  /* 点按钮 ① 真的导出 */
  const box = M.w.document.createElement('div');
  box.innerHTML = html;
  M.w.document.body.appendChild(box);
  M.w.__dl = [];
  box.querySelector('[data-yzx="md"]').dispatchEvent(new M.w.MouseEvent('click', { bubbles: true }));
  ok('⑪ 点「导出笔记（Markdown）」触发保存', M.w.__dl.join('|').indexOf('学通-笔记-' + today + '.md') >= 0, M.w.__dl.join('|'));
  /* 点按钮 ② 弹出用量面板 */
  box.querySelector('[data-yzx="usage"]').dispatchEvent(new M.w.MouseEvent('click', { bubbles: true }));
  const ov = M.w.document.getElementById('yzUsageOv');
  ok('⑪ 点「存储用量」弹出面板（含进度条与关闭按钮）',
    !!ov && ov.innerHTML.indexOf('本机存储') > 0 && ov.innerHTML.indexOf('data-yzusage="close"') > 0);
  await sleep(30);
  ok('⑪ 面板异步补上 IndexedDB 行', (ov.innerHTML.indexOf('本机书籍') > 0) || (ov.innerHTML.indexOf('容量估算') > 0));
  /* 面板内「导出笔记」按钮 */
  M.w.__dl = [];
  ov.querySelector('[data-yzusage="md"]').dispatchEvent(new M.w.MouseEvent('click', { bubbles: true }));
  ok('⑪ 面板内也能直接导出', M.w.__dl.join('|').indexOf('.md') > 0, M.w.__dl.join('|'));

  /* ---------- 输出 ---------- */
  let pass = 0;
  console.log('\n===== 学通 · 笔记导出（Markdown/CSV）与存储用量 · jsdom 实测 =====');
  R.forEach((r, i) => {
    if (r[0]) pass++;
    console.log((r[0] ? '  ✅ ' : '  ❌ ') + String(i + 1).padStart(2, '0') + '. ' + r[1] + (r[2] ? '   ⟨' + r[2] + '⟩' : ''));
  });
  console.log('------------------------------------------------------------------');
  console.log('  结果：' + pass + '/' + R.length + ' 通过' + (pass === R.length ? ' · 全部通过 ✅' : ' · 有失败 ❌'));
  process.exit(pass === R.length ? 0 : 1);
})().catch((e) => { console.error('测试脚本异常：', e); process.exit(2); });
