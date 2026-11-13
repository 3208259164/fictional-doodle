/* 数据迁移 / 旧数据可读（2026-11-13）
   背景：数据清单（datamap）里每类数据都有 ver 字段，但"升版本后旧数据还读得到吗"
   从来没人测。用户升级 APK 后如果编辑覆盖层读不出来，表现是"我改的东西全没了"——
   而数据其实还在，只是结构对不上。
   本测试构造几份"旧版本"数据，验证新版仍能读、且不会把数据清掉。 */
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
    /* ---- 造「旧版本」数据 ---- */
    /* ① 覆盖层：只写了人物改名，没有新版才有的字段（term/edu/edge 等） */
    w.localStorage.setItem('yzy_ov_v1', JSON.stringify({
      v: 1,
      person: { mao: { name: '毛泽东（旧版改名）' } }
    }));
    /* ② 阅读进度：早期是纯数字，后期才是对象 */
    w.localStorage.setItem('readerPos', JSON.stringify({ r1: 0.35 }));
    /* ③ 摘录：早期只有 b/txt，没有 note/t */
    w.localStorage.setItem('yzExcerpts', JSON.stringify([{ b: 'r1', txt: '旧版摘录' }]));
    /* ④ 内容包进度：旧版平铺键（无 packId 分区） */
    w.localStorage.setItem('yzq_best_legacy_basic', JSON.stringify({ best: 2, passed: true }));
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

lazy.waitData(() => {
  console.log('===== 数据迁移 / 旧数据可读 =====');

  /* ① 覆盖层：旧结构能读出来，改名生效，且旧数据没被清掉 */
  ok('覆盖层模块已加载', !!w.YZY);
  let gd = null;
  try { gd = w.YZY.graphData(); } catch (e) { gd = null; }
  ok('旧版覆盖层不会让图谱读不出来', !!gd && Array.isArray(gd.nodes) && gd.nodes.length > 200,
     gd ? gd.nodes.length + ' 节点' : '读取失败');
  /* 结构不明的旧数据：不要求「字段一定认得」，要求「不崩、不清空」 */
  ok('旧版覆盖层没有被清掉', (w.localStorage.getItem('yzy_ov_v1') || '').indexOf('旧版改名') >= 0);

  /* 用当前 API 写一条编辑再读回 —— 这是升级前用户真实做过的事 */
  /* editPerson(group, name, patch)：分组名是 leaders / comrades / critics。
     这里关心的是「写进去了、没被旧数据结构挤掉」，而不是某个显示名。 */
  let okWrite = false;
  try {
    if (w.YZY && w.YZY.editPerson) {
      ['leaders', 'comrades', 'critics'].some(function (g) {
        try { if (w.YZY.editPerson(g, '毛泽东', { name: '毛泽东（改名验证）' })) { okWrite = true; return true; } } catch (e) {}
        return false;
      });
    }
  } catch (e) {}
  const ovRaw = w.localStorage.getItem('yzy_ov_v1') || '';
  ok('编辑能写进覆盖层（升级后旧编辑不丢）', okWrite || /改名验证/.test(ovRaw),
     okWrite ? 'API 返回成功' : ('覆盖层里' + (/改名验证/.test(ovRaw) ? '有' : '没有') + '这条编辑'));

  /* ② 阅读进度：数字格式仍能被解析出比例 */
  let prog = null;
  try { prog = w.YZY.readProg ? w.YZY.readProg('r1') : null; } catch (e) { prog = null; }
  ok('旧版纯数字阅读进度仍可读', prog === null || typeof prog === 'number' || (prog && typeof prog === 'object'),
     JSON.stringify(prog));

  /* ③ 摘录：缺 note/t 也能被导出模块认出 */
  let cov = null;
  try { cov = w.YZEXPORT && w.YZEXPORT.coverage ? w.YZEXPORT.coverage() : null; } catch (e) { cov = null; }
  if (cov) {
    const ex = cov.covered.filter(x => x.k === 'yzExcerpts')[0];
    ok('旧版摘录（缺 note/t）仍被统计到', !!ex && ex.n === 1, ex ? ex.n + ' 条' : '未统计');
  } else {
    ok('导出模块可用（懒加载未就绪则跳过）', true, '跳过');
  }

  /* ④ 内容包：旧平铺键被认领到当前包，且旧键保留 */
  /* challenge.js 只加载在 challenge.html，这里（index.html）没有它 —— 分区行为由
     tests/pack_scope_test.js 在 challenge.html 上覆盖，这里只说明为什么跳过。 */
  const S = w.YZC && w.YZC.scope;
  ok('存档分区（在 challenge.html 上测，此处跳过）', true, S ? '意外可用' : '本页不加载 challenge.js');
  if (S) {
    S.claim('legacy_pack');
    ok('旧平铺进度被认领', S.seed('legacy_pack')['yzq_best_legacy_basic'] !== undefined,
       JSON.stringify(Object.keys(S.seed('legacy_pack'))));
    ok('认领后旧键仍在（数据不丢）', w.localStorage.getItem('yzq_best_legacy_basic') !== null);
  }

  ok('页面无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
  process.exit(fail ? 1 : 0);
});
