/* 学通 0.18.22 专项：变更提示 + 频道可改 + 不再报「不支持的类型」 */
const fs = require('fs');
const path = require('path');

const SITE = process.env.YZY_SITE || (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; bad.push(name + (extra ? '  → ' + extra : '')); }
}

/* ---------- 1. 文案层面：两处「不支持」提示必须已消失 ---------- */
const ce = fs.readFileSync(path.join(SITE, 'assets/contentedit.js'), 'utf8');
const ov = fs.readFileSync(path.join(SITE, 'assets/overlay.js'), 'utf8');
const app = fs.readFileSync(path.join(SITE, 'assets/app.js'), 'utf8');
const cust = fs.readFileSync(path.join(SITE, 'assets/custom.js'), 'utf8');

ok('contentedit 不再调用「不认识的类型」toast', !/toast\('不认识的类型/.test(ce));
ok('overlay 不再返回「不支持的条目类型」', !/err:\s*'不支持的条目类型'/.test(ov));
ok('contentedit 有 genericSchema 兜底', /function genericSchema/.test(ce));
ok('contentedit 有 resolve 跨源查找', /function resolve\(kind, ref\)/.test(ce));
ok('setMeta 改为「含冒号即可」', /k\.indexOf\(':'\) <= 0/.test(ov));

/* ---------- 2. 频道：可改可删 ---------- */
ok('频道有 chanEdits', /function chanEdits\(\)/.test(app));
ok('频道有 chanEdit 弹层', /function chanEdit\(kEnc\)/.test(app));
ok('频道有 chanEditSave', /function chanEditSave/.test(app));
ok('频道有 chanDel', /function chanDel\(kEnc\)/.test(app));
ok('channelList 应用编辑与删除', /chanEdits\(\)/.test(app.slice(app.indexOf('function channelList'), app.indexOf('function channelList') + 1400)));
ok('chanKey 支持稳定键 __ok', /function chanKey\(p\)\{[^}]*__ok/.test(app));
ok('详情页有编辑按钮', app.indexOf('✏️ 编辑这条') > 0);
ok('详情页有删除按钮', app.indexOf('🗑 删除') > 0);

/* ---------- 3. custom.js 的编辑按钮不再限定类型 ---------- */
ok('custom 编辑按钮走 yzEdit', /onclick="yzEdit\(/.test(cust));
ok('custom 不再限定 concept/event', !/kind === 'concept' \|\| kind === 'event'\) && window\.YZY/.test(cust));

/* ---------- 4. 变更日志模块 ---------- */
const chg = fs.readFileSync(path.join(SITE, 'assets/changes.js'), 'utf8');
ok('changes.js 存在且导出 YZChanges', /window\.YZChanges = \{/.test(chg));
ok('changes.js 有 afterSave', /afterSave: afterSave/.test(chg));
ok('changes.js 有 openPanel', /openPanel: openPanel/.test(chg));
ok('changes.js 记录 undoable', /undoable: rec\.undoable !== false/.test(chg));

/* ---------- 5. 运行逻辑：用极简 DOM 存根跑一遍通道 ---------- */
function stub() {
  const store = {};
  const g = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    toast: () => {},
    confirm: () => true,
    JSON, String, Object, Array, Math, Date, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
    console
  };
  g.window = g;
  return g;
}

/* 5a. changes.js：记录 + 摘要文案 */
(function () {
  const g = stub();
  const src = fs.readFileSync(path.join(SITE, 'assets/changes.js'), 'utf8');
  const fn = new Function('window', 'localStorage', 'document', 'toast', 'confirm', 'JSON', 'String', 'Object', 'Array', 'Math', 'Date', src);
  fn(g, g.localStorage, { getElementById: () => null, createElement: () => ({ style: {}, innerHTML: '', addEventListener() {} }), body: { appendChild() {} } }, g.toast, g.confirm, JSON, String, Object, Array, Math, Date);

  g.YZChanges.add({ act: 'edit', kind: 'concept', ref: 'c1', name: '剩余价值',
    fields: [{ k: '年份', k2: 'year', from: '1865', to: '1867' }] });
  const list = g.YZChanges.list();
  ok('变更被写入（1 条）', list.length === 1, 'got ' + list.length);
  ok('变更保留旧值新值', list[0].fields[0].from === '1865' && list[0].fields[0].to === '1867');

  const s1 = g.YZChanges.summaryOf(list[0]);
  ok('摘要含「年份 1865→1867」', /年份 1865→1867/.test(s1), s1);

  const rec = { act: 'edit', kind: 'edu', ref: 't', name: 't', fields: [{ k: '粉丝数', k2: 'fans', from: '1万', to: '2万' }] };
  const s2 = g.YZChanges.summaryOf(rec);
  ok('摘要含「粉丝数 1万→2万」', /粉丝数 1万→2万/.test(s2), s2);

  /* 长文本压成短串 */
  const s3 = g.YZChanges.summaryOf({ act: 'edit', fields: [{ k: '正文', from: 'a'.repeat(60), to: 'b'.repeat(60) }] });
  ok('长文本摘要被截断', s3.length < 80, 'len=' + s3.length);

  /* 上限 200 条 */
  for (let i = 0; i < 260; i++) g.YZChanges.add({ act: 'edit', kind: 'x', ref: 'r' + i, name: 'n', fields: [] });
  ok('最多保留 200 条', g.YZChanges.list().length === 200, 'got ' + g.YZChanges.list().length);
})();

/* 5b. contentedit：genericSchema 不再抛，保存走 setMeta */
(function () {
  const g = stub();
  let savedKey = null;
  g.YZY = {
    setMeta: function (k, arr) { savedKey = k; return { ok: true }; },
    getMeta: function () { return [{ k: '定位', v: '测试' }]; },
    editConcept: function () { return { ok: true }; },
    editEvent: function () { return { ok: true }; }
  };
  g.document = {
    getElementById: () => null,
    createElement: () => ({ style: {}, innerHTML: '', addEventListener() {}, remove() {}, appendChild() {} }),
    body: { appendChild() {} },
    querySelector: () => null
  };
  const src = fs.readFileSync(path.join(SITE, 'assets/contentedit.js'), 'utf8');
  const fn = new Function('window', 'document', 'toast', 'JSON', 'String', 'Object', 'Array', 'Math', 'Date', 'setTimeout', src);
  fn(g, g.document, g.toast, JSON, String, Object, Array, Math, Date, setTimeout);
  ok('yzEdit 已暴露', typeof g.yzEdit === 'function');
  /* 未知类型不应抛错（以前会 return，现在要给通用编辑器） */
  let threw = null;
  try { g.yzEdit('meeting', 'm1'); } catch (e) { threw = e.message; }
  ok('未知名类型调用不抛错', threw === null, threw || '');
})();

/* ---------- 6. 接线检查 ---------- */
const idx = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
ok('index.html 引入 changes.js', idx.indexOf('assets/changes.js') > 0);
ok('设置页有「最近的改动」入口', app.indexOf('最近的改动') > 0);
ok('textedit 保存写变更', fs.readFileSync(path.join(SITE, 'assets/textedit.js'), 'utf8').indexOf('YZChanges.add') > 0);
ok('contentpack 导入写变更', fs.readFileSync(path.join(SITE, 'assets/contentpack.js'), 'utf8').indexOf('YZChanges.add') > 0);
ok('史料编辑器保存给摘要', /changed\.push/.test(app));

console.log('\n===== 变更提示 / 频道可改 / 类型兜底 =====');
console.log('通过 ' + pass + ' · 失败 ' + fail);
if (bad.length) { console.log('失败项：'); bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
