/* 主图谱瘦身：把「主线之外」的节点并入世界图谱（2026-11-14）
 *
 * 需求原文：「我不是叫你新增图谱，是主图谱那些不是很重要的节点，移到其他图谱当中。
 *           要保证改了以后还是节点能跳转，问一问也能问得到。」
 *
 * 做法：主图谱只留马克思主义主线（270 → 188），把三类节点并入**已有的世界图谱**
 *       （188 → 269），不新增任何图谱：
 *         · 哲学史 / 古典政治经济学 / 空想社会主义 / 俄国革命民主主义
 *         · 西方马克思主义（卢卡奇、法兰克福学派、阿尔都塞学派）
 *         · 共产国际下属机构 / 苏共党务与安全机关
 *       id 一律不改，所以按 id 的跳转、收藏、笔记、编辑全部照旧。
 *
 * 这个测试锁住两件事：**节点还能跳转**、**图谱数量没有多出来**。
 * 「问一问答得到」在 qa_concept_fallback_test.js 里验（那边才有问答引擎）。
 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errs.push(e.message); });
let lazy = null;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

lazy.waitData(() => {
  w.ensureAllGraphs(function () {
    console.log('===== 主图谱瘦身（并入世界图谱） =====');
    const M = w.SITE_GRAPH, W = w.SITE_GRAPH_WORLD;
    const has = (g, nm) => (g.nodes || []).some(n => String(n.name || '').indexOf(nm) >= 0);

    /* ---- 1. 主图谱只剩下主线 ---- */
    ok('主图谱节点数下降', M.nodes.length > 150 && M.nodes.length < 220, M.nodes.length + ' 节点');
    ok('主线人物仍在主图谱', has(M, '毛泽东') && has(M, '马克思') && has(M, '列宁'));
    ok('哲学史人物已移出主图谱', !has(M, '康德') && !has(M, '柏拉图'));
    ok('西马人物已移出主图谱', !has(M, '卢卡奇'));
    ok('共运下属机构已移出主图谱', !has(M, '契卡'));

    /* ---- 2. 全部并进了已有的世界图谱，没有新增图谱 ---- */
    ok('世界图谱收下了这些节点', W.nodes.length > 240, W.nodes.length + ' 节点');
    ok('世界图谱含哲学史人物', has(W, '康德') && has(W, '黑格尔'));
    ok('世界图谱含西马人物', has(W, '卢卡奇') || has(W, '阿尔都塞'));
    ok('世界图谱含共运组织', has(W, '契卡'));
    ok('世界图谱原有的主线人物没丢', has(W, '毛泽东') && has(W, '马克思'));

    let list = [];
    try { list = w.YZY.listGraphs() || []; } catch (e) {}
    ok('图谱数量仍是 5 张（没有新增）', list.length === 5, list.map(x => x.id).join('/'));

    /* ---- 3. 节点还能跳转 ---- */
    w.openFigure('kant', true);
    const v = d.getElementById('contentView').textContent || '';
    ok('移走的节点按 id 仍能打开（康德）', v.indexOf('康德') >= 0, v.slice(0, 26).replace(/\s+/g, ' '));
    ok('介绍页仍显示关系网', v.indexOf('关系网') >= 0);

    const url = w.graphUrlOf('kant');
    ok('「在关系图谱中查看」指向世界图谱', url.indexOf('?g=world') >= 0, url);
    const url2 = w.graphUrlOf('mao');
    ok('主图谱节点的链接仍指向主图谱', url2.indexOf('?g=') < 0 || url2.indexOf('?g=world') < 0, url2);

    /* ---- 4. 跨图谱关系网照旧能聚合 ---- */
    w.openFigure('mao', true);
    const v2 = d.getElementById('contentView').textContent || '';
    const m = v2.match(/跨\s*(\d+)\s*张图谱\s*·\s*共\s*(\d+)\s*条/);
    ok('跨图谱关系网仍统计得出', !!m && Number(m[1]) >= 2, m ? m[0] : '未匹配');

    ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
    console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
    process.exit(fail ? 1 : 0);
  });
});
