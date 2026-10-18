#!/usr/bin/env node
/* 候选来源检索（构建期 / 云端定时用，非站点依赖）
   用法：
     node tools/find_sources.js                        # 全部来源
     node tools/find_sources.js --only=ia,gb           # 只用指定来源
     node tools/find_sources.js --selftest             # 只做联网/来源可达性自检
     node tools/find_sources.js --rows=3 --timeout=20000 --delay=500 --out=data/sources.json
   读 data/resources.js，按书名到多个公开来源检索候选（书名/年/直链/详情页），
   写入 data/sources.json，供人工筛选后填进 resources.js 的 url / mirrors。
   只做检索，不下载、不做正版/盗版判定。

   已考虑的情况：单源失败不影响其它源 / 超时 / 限流(403/429) / 地区限制 /
   本机无网络 / 中文书名命中率低 —— 均如实标注，并区分「本机网络问题」与
   「源本身问题」（先做联网预检，再逐条判定）。
   来源：Internet Archive · Google Books · Open Library · 维基文库 · HathiTrust · marxists.org */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const getArg = (n, d) => { const p = args.find(a => a.startsWith('--' + n + '=')); return p ? p.slice(n.length + 3) : d; };
const has = n => args.includes('--' + n);
const ONLY = getArg('only', '').split(',').map(s => s.trim()).filter(Boolean);
const ROWS = Math.max(1, parseInt(getArg('rows', '5'), 10) || 5);
const TIMEOUT = parseInt(getArg('timeout', '15000'), 10) || 15000;
const DELAY = parseInt(getArg('delay', '250'), 10);
const OUT = getArg('out', path.join(root, 'data/sources.json'));
const UA = 'yuanziyuan-find-sources/1.1';

if (has('help')) {
  console.log('用法：node tools/find_sources.js [--only=ia,gb,ol,ws,hathi,marxists] [--rows=5] [--timeout=15000] [--delay=250] [--out=path] [--selftest]');
  process.exit(0);
}
if (typeof fetch !== 'function') { console.error('❌ 需要 Node 18 及以上（内置 fetch）。当前：' + process.version); process.exit(2); }

global.window = {};
require(path.join(root, 'data/resources.js'));
const RES = global.window.SITE_RESOURCES || [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const on = s => !ONLY.length || ONLY.includes(s);

async function fetchJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: ctl.signal });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, error: (e && e.name === 'AbortError') ? '超时' : String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

/* ---- 联网 / 来源可达性预检（区分本地网络问题与源问题） ---- */
const HOST_OF = { 'Internet Archive': 'archive.org', 'Google Books': 'www.googleapis.com', 'Open Library': 'openlibrary.org', '维基文库': 'zh.wikisource.org' };
const REACH = {};
async function probeHost(host) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://' + host + '/', { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: ctl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch (e) { clearTimeout(t); return false; }
}
async function preflight() {
  const online = await probeHost('www.gstatic.com');
  for (const h of Object.values(HOST_OF)) REACH[h] = online ? await probeHost(h) : false;
  return { online, reachable: Object.assign({}, REACH) };
}
function fail(src, r) {
  const code = r.status ? r.status : (r.error || '未知');
  const h = HOST_OF[src];
  let hint = '';
  if (h && REACH[h] === false) hint = '（本机预检无法连接 ' + h + '，多为本地网络/地区限制，非源失效；请联网或换网络/在云端复跑）';
  else if (r.status === 403 || r.status === 429) hint = '（限流/防盗链，稍后重试或换网络）';
  return { source: src, note: '查询失败：' + code + hint };
}

/* ---- Internet Archive ---- */
async function ia(title) {
  if (!on('ia')) return [];
  const q = 'title:("' + String(title).replace(/["()]/g, ' ') + '")';
  const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
    '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=mediatype&rows=' + ROWS + '&page=1&output=json';
  const r = await fetchJSON(url);
  if (!r.ok) return [fail('Internet Archive', r)];
  return ((r.data.response && r.data.response.docs) || []).map(x => ({
    source: 'Internet Archive', title: x.title, creator: (x.creator || '').toString(), year: x.year || '',
    note: x.mediatype || '', page: 'https://archive.org/details/' + x.identifier,
    direct: 'https://archive.org/download/' + x.identifier + '/'
  }));
}

/* ---- Google Books（公版可得直链） ---- */
async function gb(title, author) {
  if (!on('gb')) return [];
  const q = 'intitle:' + title + (author && author !== '—' ? ' inauthor:' + author : '');
  const url = 'https://www.googleapis.com/books/v1/volumes?q=' + encodeURIComponent(q) + '&maxResults=' + ROWS + '&country=US';
  const r = await fetchJSON(url);
  if (!r.ok) return [fail('Google Books', r)];
  return ((r.data.items) || []).map(v => {
    const vi = v.volumeInfo || {}, ai = v.accessInfo || {};
    const pdf = ai.pdf && ai.pdf.isAvailable ? (ai.pdf.downloadLink || '') : '';
    return { source: 'Google Books', title: vi.title, creator: (vi.authors || []).join('、'),
      year: (vi.publishedDate || '').slice(0, 4), note: (ai.publicDomain ? '公版 · ' : '') + (vi.publisher || ''),
      page: vi.infoLink || ('https://books.google.com/books?id=' + v.id), direct: ai.publicDomain ? pdf : '' };
  });
}

/* ---- Open Library ---- */
async function ol(title, author) {
  if (!on('ol')) return [];
  const q = encodeURIComponent((title + ' ' + (author && author !== '—' ? author : '')).trim());
  const url = 'https://openlibrary.org/search.json?q=' + q + '&limit=' + ROWS + '&fields=key,title,author_name,first_publish_year,publisher,ia';
  const r = await fetchJSON(url);
  if (!r.ok) return [fail('Open Library', r)];
  return ((r.data.docs) || []).map(d => ({
    source: 'Open Library', title: d.title, creator: (d.author_name || []).join('、'), year: d.first_publish_year || '',
    note: (d.publisher || [])[0] || '（常为借阅/元数据）', page: 'https://openlibrary.org' + (d.key || ''),
    direct: d.ia && d.ia[0] ? 'https://archive.org/details/' + d.ia[0] : ''
  }));
}

/* ---- 维基文库（MediaWiki 全文） ---- */
async function ws(title) {
  if (!on('ws')) return [];
  const url = 'https://zh.wikisource.org/w/api.php?action=query&list=search&format=json&srlimit=' + ROWS + '&srsearch=' + encodeURIComponent(title);
  const r = await fetchJSON(url);
  if (!r.ok) return [fail('维基文库', r)];
  return ((((r.data.query || {}).search) || [])).map(s => ({
    source: '维基文库', title: s.title, creator: '', year: '', note: '全文（MediaWiki）',
    page: 'https://zh.wikisource.org/wiki/' + encodeURIComponent(s.title), direct: ''
  }));
}
const hathi = (title, author) => on('hathi') ? [{ source: 'HathiTrust', title, creator: author || '', year: '',
  note: '需自查全文可用性', page: 'https://catalog.hathitrust.org/Search/Home?lookfor=' + encodeURIComponent(title + ' ' + (author && author !== '—' ? author : '')) + '&type=all', direct: '' }] : [];
const marxists = title => on('marxists') ? [{ source: 'marxists.org', title, creator: '', year: '',
  note: '中文全文库，需自查', page: 'https://www.marxists.org/chinese/search.htm', direct: '' }] : [];

async function forBook(r) {
  const out = [];
  const tasks = [['Internet Archive', () => ia(r.title)], ['Google Books', () => gb(r.title, r.author)],
                 ['Open Library', () => ol(r.title, r.author)], ['维基文库', () => ws(r.title)]];
  for (const [name, fn] of tasks) {
    try { out.push(...(await fn())); } catch (e) { out.push({ source: name, note: '异常：' + ((e && e.message) || e) }); }
    await sleep(DELAY);
  }
  out.push(...hathi(r.title, r.author), ...marxists(r.title));
  return out;
}

(async () => {
  console.log('联网 / 来源可达性预检…');
  const env = await preflight();
  const reachN = Object.values(env.reachable).filter(Boolean).length;
  console.log('  本机联网：' + (env.online ? '✅ 可以' : '❌ 不可以（结果多为"无命中"，不代表源失效）') + '  · 可达来源 ' + reachN + '/' + Object.keys(env.reachable).length);
  for (const [h, ok] of Object.entries(env.reachable)) console.log('  · ' + h.padEnd(20) + (ok ? '✅ 可达' : '⚠️ 不可达（本地网络/地区限制）'));
  if (has('selftest')) { console.log('\n--selftest 完成，未做检索。'); return; }

  const books = [], stats = {};
  console.log('\n候选来源检索：' + RES.length + ' 条 · 来源=' + (ONLY.length ? ONLY.join(',') : '全部') + ' · 每源 ' + ROWS + ' 条\n');
  for (const r of RES) {
    const cands = await forBook(r);
    const hit = cands.filter(c => c.page && !/查询失败|异常/.test(c.note || ''));
    console.log('· ' + r.title + ' → ' + (hit.length ? hit.length + ' 个候选' : '无命中'));
    hit.slice(0, 3).forEach(c => console.log('    [' + c.source + '] ' + c.page));
    cands.forEach(c => { stats[c.source] = (stats[c.source] || 0) + 1; });
    books.push({ id: r.id, title: r.title, author: r.author, candidates: cands });
  }
  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), env, stats, books }, null, 2));
  console.log('\n各来源候选数：' + JSON.stringify(stats));
  console.log('已写入 ' + path.relative(root, OUT) + '（未改动 resources.js）。');
  console.log('提示：中文书名在 Internet Archive / Google Books 命中有限；公版原文可另去 marxists.org。');
})().catch(e => { console.error('运行出错：' + e); process.exit(1); });
