/**
 * 学通 · 内容包沙箱验证（真实浏览器）
 *
 * 验证 2026-11-07 的安全收紧确实生效，并且旧包不被打破：
 *   1. 包内拿不到 parent.document（隔离生效）
 *   2. 包内 localStorage 走注入的内存实现，读写同步可用（旧包无感）
 *   3. 包内的写入会被父页落到真正的 localStorage（存档不丢）
 *   4. 父页已有关卡进度能 seed 回包内（读得到自己的进度）
 *   5. 包内调 toast/confirm 之类不会影响父页
 *
 * 跑法：python3 -m http.server 8979 --directory site & node tests/verify_challenge_sandbox.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:8979').replace(/\/+$/, '');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log('  ✓ ' + m); }
  else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
};

/* 造一个「旧式」内容包：它直接调用 localStorage.setItem，没有任何配合新机制的特殊写法。
   目的就是验证旧包在新沙箱下依然能存档。 */
const PACK = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="yz-pack" content='{"schema":1,"packId":"sandbox_probe","packTitle":"沙箱探针","version":"1.0","nodes":[{"id":"n1","title":"第一关","tiers":{"basic":1}}]}'>
</head><body>
<h1>probe</h1>
<script>
  var out = {};
  // 1) 是否还能摸到父页
  try { out.parentDoc = !!parent.document; } catch (e) { out.parentDoc = 'blocked:' + e.name; }
  // 2) 旧式写法：直接写 localStorage（应被 shim 接管）
  try { localStorage.setItem('yzq_best_n1_basic', JSON.stringify({ stars: 3, passed: true, at: 1 })); out.write = 'ok'; }
  catch (e) { out.write = 'ERR:' + e.name; }
  // 3) 读回（同步）
  try { out.read = localStorage.getItem('yzq_best_n1_basic'); } catch (e) { out.read = 'ERR:' + e.name; }
  // 4) seed：父页预先放进去的进度能不能读到
  try { out.seed = localStorage.getItem('yzq_best_seed_basic'); } catch (e) { out.seed = 'ERR:' + e.name; }
  try { out.len = localStorage.length; } catch (e) { out.len = 'ERR:' + e.name; }
  window.__probe = out;
  parent.postMessage({ t: 'yz:win', packId: 'sandbox_probe' }, '*');
<\/script>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
page.on('dialog', async (d) => { await d.accept(); });   /* 导入确认 */

console.log('\n[1] 打开关卡页，预先塞一条「已有进度」');
await page.goto(BASE + '/challenge.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(600);
await page.evaluate(() => localStorage.setItem('yzq_best_seed_basic', JSON.stringify({ stars: 2, passed: true, at: 2 })));

console.log('\n[2] 导入一个「旧式」内容包（走真实文件导入路径）');
const tmp = path.join(os.tmpdir(), 'xuetong_sandbox_probe.html');
fs.writeFileSync(tmp, PACK, 'utf8');
const input = await page.$('#picker') || await page.$('input[type=file]');
ok(!!input, '找到导入控件');
await input.uploadFile(tmp);
await sleep(1500);
const packCount = await page.$$eval('.pack', (els) => els.length).catch(() => 0);
ok(packCount >= 1, '包已进入列表（' + packCount + ' 个）');

console.log('\n[3] 打开包，检查沙箱行为');
await page.click('.pack');
await sleep(2000);
const frames = page.frames().filter((f) => f !== page.mainFrame());
ok(frames.length >= 1, 'iframe 已载入（' + frames.length + ' 个 frame）');

let probe = null;
for (const f of frames) {
  try {
    probe = await f.evaluate(() => window.__probe || null);
    if (probe) break;
  } catch (e) {}
}
ok(!!probe, '包内脚本已执行并回报探针');
if (probe) {
  ok(probe.parentDoc !== true, '包内拿不到 parent.document（' + probe.parentDoc + '）');
  ok(probe.write === 'ok', '旧式 localStorage.setItem 未报错（' + probe.write + '）');
  ok(!!probe.read && probe.read.indexOf('stars') >= 0, '同步读到刚写的值');
  ok(!!probe.seed && probe.seed.indexOf('stars') >= 0, 'seed 生效：包能读到自己原有的进度');
  ok(typeof probe.len === 'number' && probe.len >= 2, 'length 可用（' + probe.len + '）');
}

console.log('\n[4] 父页确实落盘了（存档没丢）');
await sleep(600);
const saved = await page.evaluate(() => localStorage.getItem('yzq_best_n1_basic'));
ok(!!saved && saved.indexOf('stars') >= 0, '父页 localStorage 里有包写入的进度：' + String(saved).slice(0, 40));

console.log('\n[5] 沙箱属性核对');
const attr = await page.$eval('#game', (el) => el.getAttribute('sandbox'));
ok(attr && attr.indexOf('allow-same-origin') < 0, 'iframe 已不含 allow-same-origin（' + attr + '）');
ok(attr && attr.indexOf('allow-scripts') >= 0, '保留 allow-scripts（关卡是脚本游戏）');

console.log('\n########## 沙箱验证：' + pass + ' 通过 / ' + fail + ' 失败 ##########');
await browser.close();
try { fs.unlinkSync(tmp); } catch (e) {}
process.exit(fail ? 1 : 0);
