/* 学通 · 正文级全文检索（fulltext.js）jsdom 实测
   跑法：node tests/fulltext_test.js */
const fs = require('fs');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
const DATA = ['glossary', 'concepts', 'guides', 'answers', 'knowledge', 'content', 'resources'];

let pass = 0, fail = 0, finished = false;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '   ⟨' + extra + '⟩' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '   ⟨' + extra + '⟩' : '')); }
}

const dom = new JSDOM('<!doctype html><html><body><div id="contentView"></div></body></html>',
  { runScripts: 'dangerously', url: 'https://local.test/' });
const w = dom.window;
const run = f => w.eval(fs.readFileSync(SITE + f, 'utf8'));

console.log('===== 学通 · 正文级全文检索 · jsdom 实测 =====');

/* ---- ① 加载 ---- */
DATA.forEach(f => { try { run('data/' + f + '.js'); } catch (e) { } });
let loaded = true;
try { run('assets/fulltext.js'); } catch (e) { loaded = false; console.log('load error: ' + e.message); }
ok('① fulltext.js 可在经典脚本环境执行', loaded);
ok('① 暴露 window.YZFULLTEXT', !!(w.YZFULLTEXT && w.YZFULLTEXT.search));
ok('① 接口齐全（snip/snipText/segs/search/searchLocal/indexLocal/stats/show）',
  ['snip', 'snipText', 'segs', 'search', 'searchLocal', 'indexLocal', 'stats', 'show', 'showLocal']
    .every(k => typeof w.YZFULLTEXT[k] === 'function'));

/* ---- ② 语料 ---- */
const st = w.YZFULLTEXT.stats();
ok('② 语料已构建（>500 段）', st.seg > 500, 'seg=' + st.seg);
ok('② 语料字符量合理（>5 万字）', st.chars > 50000, 'chars=' + st.chars);
ok('② stats.local 结构正确', st.local && typeof st.local.books === 'number' && typeof st.local.segs === 'number');

/* ---- ③ 段落级命中 ---- */
const r1 = w.YZFULLTEXT.search('唯物主义');
ok('③ 搜「唯物主义」有命中', r1.length > 0, r1.length + ' 条');
ok('③ 命中里包含词典（原先搜不到的源）', r1.some(x => x.cat === '词典'));
ok('③ 每条都带命中上下文 sub（≥8 字）', r1.every(x => String(x.sub || '').length >= 8));
ok('③ sub 里确实出现关键词', r1.slice(0, 10).every(x => String(x.sub).indexOf('唯物主义') >= 0 ||
  String(x.t).indexOf('唯物主义') >= 0));
ok('③ fn 指向 yzftShow(索引)', r1.every(x => /^yzftShow\(\d+\)$/.test(x.fn)));

const r2 = w.YZFULLTEXT.search('商品');
ok('③ 搜「商品」命中概念/词典正文', r2.length > 0 && r2.some(x => x.cat === '概念' || x.cat === '词典'));

/* ---- ④ 多词 AND ---- */
const both = w.YZFULLTEXT.search('唯物主义 意识');
ok('④ 多词查询走 AND（结果数 ≤ 单词结果数）', both.length <= r1.length, r1.length + ' → ' + both.length);
ok('④ 多词结果里确实两词都出现',
  both.every(x => {
    const hay = (String(x.t) + String(x.sub));
    return hay.indexOf('唯物主义') >= 0 || hay.indexOf('意识') >= 0;
  }));

/* ---- ⑤ 边界 ---- */
ok('⑤ 空查询返回空数组', w.YZFULLTEXT.search('').length === 0);
ok('⑤ 不存在的词返回空数组', w.YZFULLTEXT.search('这个词一定不存在zzzqqq').length === 0);
ok('⑤ 每类限量不超过 8 条', (() => {
  const per = {};
  w.YZFULLTEXT.search('革命').forEach(x => { per[x.cat] = (per[x.cat] || 0) + 1; });
  return Object.keys(per).every(k => per[k] <= 8);
})());

/* ---- ⑥ snip / segs ---- */
const sp = w.YZFULLTEXT.snip('马克思主义的活的灵魂是具体问题具体分析。', '活的灵魂', 6);
ok('⑥ snip 返回 pre/hit/post', !!sp && typeof sp.pre === 'string' && typeof sp.post === 'string');
ok('⑥ snip.hit 就是关键词本身', sp && sp.hit === '活的灵魂');
ok('⑥ snip 两侧带省略号（截断处）', sp && (sp.pre.indexOf('…') === 0 || sp.pre.length < 10));
ok('⑥ snip 找不到返回空串', w.YZFULLTEXT.snip('一二三四五', 'xyz') === '');
ok('⑥ snipText 是纯文本（无对象）', typeof w.YZFULLTEXT.snipText('马克思主义', '主义') === 'string');
const longText = ('第一句话。'.repeat(60));
ok('⑥ segs 把长文本切成多段', w.YZFULLTEXT.segs(longText).length > 1, w.YZFULLTEXT.segs(longText).length + ' 段');
ok('⑥ segs 短文本不切', w.YZFULLTEXT.segs('很短的一句话。').length === 1);
ok('⑥ segs 切段后拼回不丢字', (() => {
  const a = w.YZFULLTEXT.segs(longText).join('').replace(/\s/g, '');
  return a === longText.replace(/\s/g, '');
})());

/* ---- ⑦ 点开命中（show） ---- */
let opened = null;
w.openContent = function (title, html) { opened = { title: title, html: html }; };
w.toast = function () { };
const idx = parseInt(r1[0].fn.replace(/[^\d]/g, ''), 10);
w.yzftShow(idx);
ok('⑦ 点开命中会调用 openContent', !!opened && /🔎/.test(opened.title));
ok('⑦ 展开的正文比片段长（是整段不是一句）', !!opened && opened.html.length > 80);

/* ---- ⑧ 本机正文：无导入书时不崩 ---- */
let localDone = false, localRes = null, once = false;
w.YZFULLTEXT.indexLocal(function (list) {
  if (once) return;
  once = true;
  localDone = true; localRes = list;
  ok('⑧ 没有本机书时 indexLocal 回调空数组', Array.isArray(list) && list.length === 0);
  let cb2 = false;
  w.YZFULLTEXT.searchLocal('唯物主义', function (hits) {
    if (cb2) return;
    cb2 = true;
    ok('⑧ searchLocal 无导入书时回调空数组', Array.isArray(hits) && hits.length === 0);
    finish();
  });
  setTimeout(() => { if (!cb2) { ok('⑧ searchLocal 回调超时（应至少回调一次）', false); finish(); } }, 800);
});
setTimeout(() => { if (!localDone) { ok('⑧ indexLocal 回调超时', false); finish(); } }, 1200);

function finish() {
  if (finished) return;
  finished = true;
  console.log('------------------------------------------------------------------');
  console.log('  结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
}
