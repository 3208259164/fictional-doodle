/* 内容包存档分区回归（2026-11-13）
   背景：Copilot 指出「包 A 能读包 B 的进度、清存档会连别人一起清」，核实成立：
     · packSeed() 把所有 yzq_* 无差别喂给当前包；
     · yzq:clear 无差别删所有 yzq_*；
     · 存档键 yzq_best_<nodeId>_<tier> 不含包名，节点 id 相同就互相覆盖；
     · 独立 WebView 的 __yzq_seeded 是全局标记，第二个包不再 seed。
   本测试锁住分区后的行为：物理键加 yzq@<packId>@，读写与清空都只在包内生效。 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'challenge.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errs.push(e.message); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/challenge.html',
  virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
  }
});
const w = dom.window;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

setTimeout(() => {
  console.log('===== 内容包存档分区 =====');
  const S = w.YZC && w.YZC.scope;
  ok('分区钩子已挂上', !!(S && S.set && S.seed && S.clear && S.claim));
  if (!S) { console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail); process.exit(1); }

  const ls = w.localStorage;

  /* ① 物理键带包名前缀 */
  ok('物理键形态 yzq@<packId>@<原键>', S.pre('packA') === 'yzq@packA@', S.pre('packA'));
  S.set('packA', 'yzq_best_mao_basic', '{"best":3,"passed":true}');
  ok('写入后物理键带前缀', ls.getItem('yzq@packA@yzq_best_mao_basic') !== null);
  ok('不再平铺到裸 yzq_ 键', ls.getItem('yzq_best_mao_basic') === null);

  /* ② 包 B 读不到包 A 的进度 */
  ok('包 B 的 seed 为空', Object.keys(S.seed('packB')).length === 0);
  const sa = S.seed('packA');
  ok('包 A 的 seed 含自己的进度', sa['yzq_best_mao_basic'] === '{"best":3,"passed":true}',
     JSON.stringify(sa));

  /* ③ 清空只影响自己 */
  S.set('packB', 'yzq_best_mao_basic', '{"best":1}');
  S.clear('packA');
  ok('清包 A 后包 A 空了', Object.keys(S.seed('packA')).length === 0);
  ok('清包 A 不影响包 B', S.seed('packB')['yzq_best_mao_basic'] === '{"best":1}');

  /* ④ 旧平铺键一次性认领 */
  ls.setItem('yzq_best_oldnode_hard', '{"best":5}');
  S.claim('packC');
  ok('旧平铺键被认领到当前包', S.seed('packC')['yzq_best_oldnode_hard'] === '{"best":5}');
  ok('旧键保留（认领错了也不丢数据）', ls.getItem('yzq_best_oldnode_hard') === '{"best":5}');

  /* ⑤ 认领只发生一次，不会每次打开都把进度冲回旧快照 */
  ls.setItem('yzq_best_oldnode_hard', '{"best":9}');
  S.claim('packC');
  ok('再次认领不覆盖已有进度', S.seed('packC')['yzq_best_oldnode_hard'] === '{"best":5}',
     S.seed('packC')['yzq_best_oldnode_hard']);

  /* ⑥ 认领不会把别的包的分区键也卷进来 */
  ok('认领不卷入分区键', S.seed('packC')['yzq_best_mao_basic'] === undefined);

  /* ⑦ 原生回传按包写回 */
  w.__yzqAbsorb(JSON.stringify({ 'yzq_best_n1_basic': '{"best":2}' }), 'packD');
  ok('回传按 packId 写进对应分区', S.seed('packD')['yzq_best_n1_basic'] === '{"best":2}');
  ok('回传不会写进别人的分区', S.seed('packA')['yzq_best_n1_basic'] === undefined);

  /* ⑧ 源码守卫：没有当前包时不落盘（防串包的最后一道） */
  const src = fs.readFileSync(path.join(SITE, 'assets/challenge.js'), 'utf8');
  ok('消息桥要求有当前包才落盘', /var bp = curPack && curPack\.packId;\s*\n\s*if \(!bp\) return;/.test(src));
  ok('yzq:clear 走 pkClear（不再无差别遍历）', src.indexOf('pkClear(bp);') > 0);
  ok('独立模式按包 seed 标记', src.indexOf('LS.getItem(k)===null') > 0);

  ok('页面无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
  process.exit(fail ? 1 : 0);
}, 1200);
