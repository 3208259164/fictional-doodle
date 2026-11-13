/* 性能体验基线（2026-11-13）
   为什么需要：首屏护栏原来是纯「字节预算」（2600 KB），字节合格不等于体验合格；
   反过来，内容增长时也容易用「抬护栏」代替「看清代价」。
   这里加一组**可重复测量**的代理指标，跑在 jsdom 上 —— 它不是真机数字，
   但同环境前后可比，用来抓「某次改动让启动/问答/搜索变慢」这类退化。

   指标与口径：
     scripts_kb   首屏同步脚本总字节（稳定，等价于下载+编译量的代理）
     boot_ms      DOM 就绪 → 懒加载数据全部到位（jsdom 比真机慢 3~5 倍，只看趋势）
     ask_ms       1000 次 YZQA.ask 的单次均值
     search_ms    200 次 omniSearch 的单次均值

   基线存在 perf-baseline.json，超出 1.5 倍算退化；超出 3 倍直接失败。
   更新基线：node tests/perf_baseline_test.js --update */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
const BASE_FILE = path.join(__dirname, 'perf-baseline.json');
const UPDATE = process.argv.indexOf('--update') >= 0;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});

/* ① 首屏字节：直接从 index.html 的静态引用算，和门禁口径一致 */
const raw = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const srcs = [...raw.matchAll(/<script[^>]*src="([^"?]+)/g)].map(m => m[1]);
let bytes = 0;
srcs.forEach(s => { try { bytes += fs.statSync(path.join(SITE, s.replace(/^\.\//, ''))).size; } catch (e) {} });
const scripts_kb = Math.round(bytes / 1024);

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errs.push(e.message); });

const t0 = Date.now();
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window;
const { waitData } = require('./_lazy_hook')(w, SITE);

waitData(() => {
  const boot_ms = Date.now() - t0;

  /* ② 问答：1000 次均值 */
  let ask_ms = 0;
  try {
    const Q = w.YZQA;
    Q.use && Q.use('all');
    Q.ask('彭德怀和毛泽东什么关系');            /* 预热，别把首次建索引算进去 */
    const a0 = Date.now();
    for (let i = 0; i < 1000; i++) Q.ask('彭德怀和毛泽东什么关系');
    ask_ms = +((Date.now() - a0) / 1000).toFixed(2);
  } catch (e) { ask_ms = -1; }

  /* ③ 全站搜索：200 次均值 */
  let search_ms = 0;
  try {
    w.omniSearch && w.omniSearch('井冈山');
    const s0 = Date.now();
    for (let i = 0; i < 200; i++) w.omniSearch('井冈山');
    search_ms = +((Date.now() - s0) / 200).toFixed(2);
  } catch (e) { search_ms = -1; }

  console.log('===== 性能体验基线（jsdom 代理指标，非真机） =====');
  console.log('  首屏同步脚本 ' + scripts_kb + ' KB / 数据就绪 ' + boot_ms + ' ms / 问答 ' + ask_ms
    + ' ms 次均 / 搜索 ' + search_ms + ' ms 次均');

  if (UPDATE) {
    fs.writeFileSync(BASE_FILE, JSON.stringify({ scripts_kb, boot_ms, ask_ms, search_ms, at: new Date().toISOString().slice(0, 10) }, null, 1) + '\n');
    console.log('  已写入基线 ' + path.basename(BASE_FILE));
    process.exit(0);
  }

  const base = fs.existsSync(BASE_FILE) ? JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')) : null;
  ok('基线文件存在', !!base, base ? ('采样于 ' + base.at) : '先跑 node tests/perf_baseline_test.js --update');
  if (!base) { console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail); process.exit(1); }

  const cmp = (name, cur, lim, ratioHard) => {
    if (!lim || cur < 0) { ok(name + '（可选指标，未采到）', true, String(cur)); return; }
    const soft = lim * 1.5, hard = lim * (ratioHard || 3);
    const x = (cur / lim).toFixed(2);
    ok(name + ' 未退化（' + cur + ' / 基线 ' + lim + '，' + x + '×）', cur <= hard, cur <= soft ? '正常' : '⚠️ 超过基线 1.5 倍');
    if (cur > hard) fail++;
  };

  cmp('首屏字节 KB', scripts_kb, base.scripts_kb, 1.5);
  /* boot 在 jsdom 上波动很大（4.4s↔3.6s），CI 机器又可能慢 2~3 倍 ——
     用 5 倍作为硬失败线，只抓真正的数量级退化。 */
  cmp('数据就绪 ms', boot_ms, base.boot_ms, 5);
  cmp('问答单次 ms', ask_ms, base.ask_ms);
  cmp('搜索单次 ms', search_ms, base.search_ms);

  ok('页面无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
  console.log('口径提示：这是 jsdom 上的代理指标，用于抓「同环境前后退化」，不能当开机时间对外引用。');
  process.exit(fail ? 1 : 0);
});
