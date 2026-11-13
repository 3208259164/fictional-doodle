/**
 * 学通 · 真实浏览器冒烟（jsdom 测不到的那部分）
 *
 * 覆盖 jsdom 的四个盲区：
 *   1. 首次启动（全新 profile）会不会白屏、有没有 JS 错误
 *   2. Service Worker 预缓存是否真的装完
 *   3. 断网后重载还能不能用（离线优先是不是真的）
 *   4. 关键页（图谱 / 立方体 / 问答）在断网下能否打开
 *
 * 仍然测不到：Android WebView 特有的行为（insets、SAF 文件选择、系统 TTS、返回键）。
 * 那部分只能在真机上验证。
 *
 * 跑法：
 *   python3 -m http.server 8977 --directory site &
 *   node tests/smoke_browser.mjs
 *   环境变量：SMOKE_BASE（默认 http://127.0.0.1:8977）、CHROME_PATH（默认 /usr/bin/chromium）
 */
import fs from 'fs';
import path from 'path';

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:8977').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 浏览器不存在时：本地 → 跳过（exit 0）；CI → 必须跑（REQUIRE_BROWSER=1，缺浏览器即失败）。
   为什么要这个开关：这两个脚本长期没进 CI，本地又常常没有 Chrome，
   直接跑会「静默跳过」或者「莫名变红」，两种都让它们形同虚设。 */
if (!fs.existsSync(CHROME)) {
  if (process.env.REQUIRE_BROWSER === '1') {
    console.error('✗ 找不到浏览器：' + CHROME + '（REQUIRE_BROWSER=1，不允许跳过）');
    process.exit(1);
  }
  console.log('⏭ 跳过：找不到浏览器 ' + CHROME);
  console.log('   本地跑：CHROME_PATH=/path/to/chrome node tests/' + path.basename(new URL(import.meta.url).pathname));
  process.exit(0);
}

/* puppeteer-core 动态加载：放在「浏览器是否存在」判断之后 ——
   否则没装依赖时连「跳过」都走不到，直接 ERR_MODULE_NOT_FOUND。 */
const { default: puppeteer } = await import('puppeteer-core');


let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 100)); });

console.log('\n[1] 首次启动');
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(2500);
ok(errs.length === 0, '首屏无 JS 错误', errs[0]);
const len1 = await page.evaluate(() => document.body.innerText.trim().length);
ok(len1 > 50, '首屏有内容（' + len1 + ' 字）');
ok(await page.evaluate(() => !!navigator.serviceWorker), 'Service Worker 可用');

console.log('\n[2] 预缓存（103 项，最长等 45s）');
let cached = 0;
for (let i = 0; i < 45; i++) {
  cached = await page.evaluate(async () => {
    if (!('caches' in window)) return -1;
    const ks = await caches.keys();
    let total = 0;
    for (const k of ks) { const c = await caches.open(k); total += (await c.keys()).length; }
    return total;
  });
  if (cached >= 100) break;
  await sleep(1000);
}
ok(cached >= 100, '预缓存装完（' + cached + ' 条）');

console.log('\n[3] 断网重载');
await page.setOfflineMode(true);
try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
await sleep(1500);
const len2 = await page.evaluate(() => document.body.innerText.trim().length).catch(() => 0);
ok(len2 > 50, '断网后首页仍有内容（' + len2 + ' 字）');

console.log('\n[4] 断网下关键页');
const pages = [
  ['/graph.html?g=old', '#cv', '旧民图谱'],
  ['/graph.html?g=new', '#cv', '新民图谱'],
  ['/graph4d.html', '#cv', '时空立方体'],
  ['/ask.html', '#q', '问答页'],
];
for (const [url, sel, label] of pages) {
  const e2 = [];
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => e2.push(String(e.message).slice(0, 80)));
  try { await pg.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) {}
  await sleep(1600);
  /* 判据分两类：画布要有非零尺寸；输入框只要存在。
     2026-11-07 这条先抓出一个真 bug：离线打开带查询串的页面会落到首页（见 sw.js navigation 分支）。 */
  const found = await pg.$eval(sel, (el) => {
    if (!el) return 0;
    if (el.tagName === 'CANVAS') return el.width > 0 ? 1 : 0;
    return 1;
  }).catch(() => 0);
  ok(found === 1, label + ' 断网可打开');
  ok(e2.length === 0, label + ' 无 JS 错误', e2[0]);
  await pg.close();
}

console.log('\n[5] 问答在断网下能出答案');
{
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/ask.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1200);
  const answered = await pg.evaluate(async () => {
    try {
      const r = window.YZQA && window.YZQA.ask('长征是什么');
      return r && r.ok ? String(r.answer).slice(0, 40) : '';
    } catch (e) { return ''; }
  });
  ok(!!answered, '断网问答有答案：' + answered);
  await pg.close();
}

console.log('\n########## 冒烟：' + pass + ' 通过 / ' + fail + ' 失败 ##########');
await browser.close();
process.exit(fail ? 1 : 0);
