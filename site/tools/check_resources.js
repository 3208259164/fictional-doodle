#!/usr/bin/env node
/* =====================================================================
   学通 · 数据自检 / 外链诊断（发布前、CI 里跑）
   用法：
     node tools/check_resources.js            # 本地字段自检
     node tools/check_resources.js --url      # 额外实检外链可达性（需联网）
     node tools/check_resources.js --json     # 输出诊断到 data/diagnostics.json
   ---------------------------------------------------------------------
   ⚠️ 重要：外链"不通"未必是链接失效——很可能是**本机网络 / 地区限制**
   （如 archive.org、Google 在国内需科学上网）。本工具会先做联网预检，
   再对每条链接分类：确已失效 / 限流防盗链 / 对端故障 / 本机无法联网 /
   疑似地区限制，并给出对应处理建议，避免误判。
   ---------------------------------------------------------------------
   退出码：发现「错误」时为 1，仅「提醒」时为 0。
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const CHECK_URL = argv.includes('--url');
const WRITE_JSON = argv.includes('--json') || argv.includes('--url');
const DIAG_PATH = path.join(root, 'data/diagnostics.json');
const UA = 'yuanziyuan-check/1.1 (+static site self-check)';

if (argv.includes('--help')) {
  console.log('用法：node tools/check_resources.js [--url] [--json]\n  --url   实检外链可达性（需联网，会区分本地网络/地区限制）\n  --json  写出 data/diagnostics.json（可交给 AI 分析）');
  process.exit(0);
}
if (typeof fetch !== 'function') { console.error('❌ 需要 Node 18 及以上（内置 fetch）。当前：' + process.version); process.exit(2); }

/* ---- 读取数据 ---- */
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['data/config.js', 'data/resources.js']) {
  const p = path.join(root, f);
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); }
  catch (e) { console.error('❌ 无法解析 ' + f + '：', e.message); process.exit(1); }
}
const RES = ctx.window.SITE_RESOURCES || [];
const CFG = ctx.window.SITE_CONFIG || {};
const REQUIRED = ['id', 'title', 'author', 'cat', 'url', 'status'];
const STATUS = ['ok', 'warn', 'dead'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

let errors = 0, warns = 0;
const findings = [];                       // 结构化诊断条目
const seenId = new Map(), seenTitle = new Map();
const add = (level, resource, message) => { findings.push({ level, resource, message }); };

console.log('学通 · 数据自检' + (CHECK_URL ? '（含外链诊断）' : '') + '\n资源条数：' + RES.length + '\n');

for (const k of ['siteUrl', 'tgChannel', 'email', 'requestForm']) {
  const v = String(CFG[k] || '');
  if (v.includes('example') || v === '' || v === '#') { console.log('⚠️ config.' + k + ' 未填写/占位'); warns++; add('warn', 'config.' + k, '未填写'); }
}

/* 稀疏数组（数组字面量里的「空位」）检测：
   这类空洞会让 forEach / map 静默跳过、而普通 for 循环与 findIndex 会拿到 undefined，
   表现为「首页 JS 报 Cannot read properties of undefined」且内建校验全部查不出来。 */
let holes = 0;
for (let i = 0; i < RES.length; i++) if (!(i in RES)) { holes++; }
if (holes) { console.log('❌ 资源数组存在 ' + holes + ' 个空位（很可能是删条目时多留了逗号）'); errors++; add('error', '(资源数组)', '存在 ' + holes + ' 个空位（多余逗号）'); }
else console.log('✓ 资源数组无空位（' + RES.length + ' 条）');

const urlChecks = [];
RES.forEach((r, i) => {
  const at = '#' + (i + 1) + ' 「' + (r.title || '(无标题)') + '」';
  for (const f of REQUIRED) if (!r[f]) { console.log('❌ ' + at + ' 缺少必填字段 ' + f); errors++; add('error', r.title, '缺少必填字段 ' + f); }
  if (r.id) { if (seenId.has(r.id)) { console.log('❌ ' + at + ' id 重复：' + r.id); errors++; add('error', r.title, 'id 重复 ' + r.id); } else seenId.set(r.id, i); }
  if (r.title) { if (seenTitle.has(r.title)) { console.log('❌ ' + at + ' 标题重复'); errors++; add('error', r.title, '标题重复'); } else seenTitle.set(r.title, i); }
  if (r.status && !STATUS.includes(r.status)) { console.log('❌ ' + at + ' status 非法：' + r.status); errors++; add('error', r.title, 'status 非法 ' + r.status); }
  if (r.date && r.date !== '—' && !DATE.test(r.date)) { console.log('⚠️ ' + at + ' 日期格式应为 YYYY-MM-DD：' + r.date); warns++; add('warn', r.title, '日期格式 ' + r.date); }
  /* 无独立文件的条目（被批判者著作 / 标“图书馆获取”）按设计就不设 url，不算问题 */
  const libOnly = r.crit === true || (r.src && String(r.src).indexOf('图书馆') >= 0);
  if (r.status === 'ok' && r.url === '#' && !libOnly) { console.log('⚠️ ' + at + ' 状态为正常，但 url 为空(#)'); warns++; add('warn', r.title, '状态正常但无 url'); }
  if (r.url && r.url !== '#' && !/^https?:/i.test(r.url)) {
    const fp = path.join(root, r.url);
    if (!fs.existsSync(fp)) { console.log('⚠️ ' + at + ' 本地文件不存在：' + r.url + '（尚未放入）'); warns++; add('warn', r.title, '本地文件缺失 ' + r.url); }
  }
  if (r.url && /example\.(com|net)|example\.netlify/.test(r.url)) { console.log('⚠️ ' + at + ' url 仍为占位地址'); warns++; add('warn', r.title, 'url 为占位地址'); }
  if (CHECK_URL && /^https?:/i.test(r.url || '') && !/example\./.test(r.url)) urlChecks.push({ at, url: r.url, title: r.title });
});
if (CFG.manual && CFG.manual.enable) {
  if (!fs.existsSync(path.join(root, CFG.manual.url || ''))) { console.log('⚠️ 本站手册文件不存在：' + CFG.manual.url); warns++; add('warn', 'manual', '手册文件缺失'); }
}

/* ---- 联网预检 + 外链诊断 ---- */
async function probe(url) {
  for (const method of ['HEAD', 'GET']) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const opt = { method, redirect: 'follow', headers: Object.assign({ 'User-Agent': UA }, method === 'GET' ? { Range: 'bytes=0-0' } : {}) };
      const res = await fetch(url, Object.assign(opt, { signal: ctl.signal }));
      clearTimeout(t);
      if (method === 'HEAD' && (res.status === 403 || res.status === 405 || res.status >= 500)) continue; // 再试 GET
      return { status: res.status };
    } catch (e) { clearTimeout(t); if (method === 'GET') return { err: e.name === 'AbortError' ? '超时(10s)' : String(e.message || e) }; }
  }
  return { err: '未知' };
}
function classify(p, globalOnline) {
  if (p.status != null) {
    if (p.status < 400) return { verdict: 'ok', hint: '' };
    if (p.status === 404 || p.status === 410) return { verdict: 'not-found', hint: '链接确已失效，请更换来源' };
    if (p.status === 401 || p.status === 403 || p.status === 429) return { verdict: 'blocked', hint: '对端拒绝/限流（403/429）——可能是防盗链或地区限制，未必是链接失效，可换网络/换来源' };
    if (p.status >= 500) return { verdict: 'server-error', hint: '对端服务器错误，稍后重试即可' };
    return { verdict: 'http-' + p.status, hint: '' };
  }
  return globalOnline
    ? { verdict: 'unreachable', hint: '无法连接（本机已联网）——该站可能被地区限制/墙，或临时故障；请换网络或在 GitHub Actions 云端复跑' }
    : { verdict: 'offline-local', hint: '本机当前无法联网（或受限），非链接失效；请联网后重跑' };
}

(async () => {
  let env = { online: false, preflight: null };
  const urlResults = [];
  if (CHECK_URL) {
    // 预检：判断本机到底能不能联网
    const pre = await probe('https://www.gstatic.com/generate_204');
    env.online = pre.status != null;
    env.preflight = pre.status != null ? 'ok' : (pre.err || 'fail');
    console.log('—— 联网预检：' + (env.online ? '✅ 本机可联网' : '❌ 本机无法联网（' + env.preflight + '）——外链结果仅供参考') + ' ——');
    if (!env.online) console.log('   ⚠️ 提示：archive.org / Google 等在国内常需科学上网；本地"不通"不代表链接失效。\n');

    if (urlChecks.length) {
      console.log('—— 外链诊断（HEAD/GET，超时 10s）——');
      for (const u of urlChecks) {
        const p = await probe(u.url);
        const c = classify(p, env.online);
        const mark = c.verdict === 'ok' ? '✅' : (c.verdict === 'offline-local' || c.verdict === 'unreachable' ? '⚠️' : '❌');
        console.log(mark + ' ' + c.verdict.padEnd(14) + ' ' + (p.status || p.err) + '  ' + u.url);
        if (c.hint) console.log('      ↳ ' + c.hint);
        if (c.verdict !== 'ok') warns++;
        urlResults.push({ title: u.title, url: u.url, status: p.status || null, error: p.err || null, verdict: c.verdict, hint: c.hint });
        add(c.verdict === 'ok' ? 'info' : 'warn', u.title, '外链 ' + c.verdict + (c.hint ? '：' + c.hint : ''));
      }
      console.log('');
    }
  }

  const summary = { errors, warns, urlChecked: urlResults.length, urlFailing: urlResults.filter(u => u.verdict !== 'ok').length };
  console.log('—— 结果：错误 ' + errors + ' 项，提醒 ' + warns + ' 项' + (CHECK_URL ? '；外链 ' + summary.urlChecked + ' 条，异常 ' + summary.urlFailing + ' 条' : '') + ' ——');

  if (WRITE_JSON) {
    const diag = { generated: new Date().toISOString(), tool: 'check_resources.js', node: process.version, env, summary, findings, urls: urlResults };
    fs.writeFileSync(DIAG_PATH, JSON.stringify(diag, null, 2));
    console.log('诊断已写入 ' + path.relative(root, DIAG_PATH) + '（可交给 AI 分析）。');
  }
  process.exit(errors ? 1 : 0);
})();
