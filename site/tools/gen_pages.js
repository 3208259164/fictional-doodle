#!/usr/bin/env node
/* =====================================================================
   学通 · 静态快照生成（SEO / AI 引用用）
   用法：node tools/gen_pages.js
   产物：pages/index.html（目录）、pages/r/<id>.html（每条资源一页）、pages/pages.css
        并同步更新 sitemap.xml
   说明：站点是 SPA，261 条资源都藏在 JS 里，爬虫只看到一个空壳；
        本脚本把每条资源渲染成真实的静态 HTML（含 JSON-LD），便于收录与引用。
        纯零依赖、手动运行；pages/ 不会进 APK、也不进 Service Worker 预缓存。
   ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
/* 产物放到站点目录之外：pages/ 只用于网页版 SEO，不进 APK，
   也不该污染站点源码目录（否则体检工具会把它当成重复代码）。
   发布网站时再把 ../pages_seo 拷回站点根、改名 pages/ 即可。 */
const OUT = path.join(root, '..', 'pages_seo');

/* ---- 读取站点数据（与 tools/gen_feed.js 同一套做法） ---- */
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['config.js', 'resources.js', 'content.js', 'knowledge.js']) {
  const p = path.join(root, 'data', f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
}
const W = ctx.window, CFG = W.SITE_CONFIG || {}, RES = W.SITE_RESOURCES || [], CT = W.SITE_CONTENT || {};
const BASE = String(CFG.siteUrl || 'https://chimerical-peony-793bf1.netlify.app/').replace(/\/+$/, '/');
const SITE = CFG.siteName || '学通';
const VERSION = CFG.version || '';

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugOf = s => encodeURIComponent(String(s == null ? '' : s).trim());
const fileSlug = (r, i) => {
  const id = String(r.id || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : ('r' + i);
};

/* ---- 共享样式 ---- */
const CSS = `*{box-sizing:border-box}
body{margin:0;background:linear-gradient(165deg,#3a0606,#1c0303);color:#f3e6d8;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.9}
.wrap{max-width:760px;margin:0 auto;padding:22px 18px 70px}
a{color:#e8b04b}
.crumb{font-size:.72rem;opacity:.7;margin-bottom:14px}
.crumb a{text-decoration:none}
h1{font-size:1.24rem;color:#e8b04b;margin:.2rem 0 .4rem;line-height:1.5}
.meta{font-size:.76rem;opacity:.75;margin:0 0 14px}
.tags{margin:10px 0 16px;display:flex;flex-wrap:wrap;gap:6px}
.tags span{font-size:.68rem;border:1px solid rgba(232,176,75,.35);border-radius:20px;padding:2px 10px;opacity:.9}
h2{font-size:.86rem;color:#e8b04b;margin:22px 0 8px;border-left:3px solid #e8b04b;padding-left:9px}
p{font-size:.86rem;opacity:.92;margin:.5rem 0}
.box{border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:12px;padding:14px 16px;margin:14px 0}
.cta{display:inline-block;margin:6px 8px 6px 0;padding:9px 16px;border-radius:10px;border:1px solid #e8b04b;color:#e8b04b;text-decoration:none;font-size:.82rem}
.cta.solid{background:#e8b04b;color:#2a1508;font-weight:700}
ul{list-style:none;margin:0;padding:0}
ul.dir li{margin:0 0 7px}
ul.dir a{text-decoration:none;display:block;padding:9px 12px;border:1px solid rgba(255,255,255,.10);border-radius:10px;background:rgba(255,255,255,.02)}
ul.dir a b{color:#f3e6d8;font-weight:600}
ul.dir a i{display:block;font-style:normal;font-size:.7rem;opacity:.62;margin-top:2px}
.grp{font-size:.76rem;color:#e8b04b;letter-spacing:1px;margin:20px 0 8px}
footer{margin-top:34px;font-size:.7rem;opacity:.6;line-height:1.8}
.toc{margin:14px 0}
.toc a{font-size:.76rem}
`;

function page(opt) {
  const jsonld = JSON.stringify(opt.jsonld, null, 1);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(opt.title)}</title>
<meta name="description" content="${esc(opt.desc)}">
<link rel="canonical" href="${esc(opt.canonical)}">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#2b0505">
<meta property="og:title" content="${esc(opt.title)}">
<meta property="og:description" content="${esc(opt.desc)}">
<meta property="og:type" content="article">
<link rel="icon" href="${opt.favicon}" type="image/svg+xml">
<link rel="stylesheet" href="${opt.css}">
<script type="application/ld+json">${jsonld}</script>
</head>
<body><div class="wrap">
${opt.body}
<footer>
  <p>本页为「${esc(SITE)}」的静态快照${VERSION ? '（站点 v' + esc(VERSION) + '）' : ''}，供搜索引擎与 AI 索引；交互式版本请访问
  <a href="${opt.home}">${esc(SITE)}</a>。</p>
  <p>本站为个人发起的公益整理站点，内容版权归原作者与出版方所有，本站仅作整理与检索。</p>
</footer>
</div></body></html>
`;
}

/* ---- 生成 ---- */
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'r'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'pages.css'), CSS);

const used = Object.create(null);
const entries = RES.map((r, i) => {
  let f = fileSlug(r, i);
  if (used[f]) f = f + '-' + i;
  used[f] = 1;
  return { r, i, file: f };
});

/* 单条页 */
entries.forEach(({ r, file }) => {
  const url = BASE + 'pages/r/' + file + '.html';
  const spa = '../../index.html#/r/' + slugOf(r.id || r.title);
  const isBook = /EPUB|PDF|MOBI|AZW|TXT/i.test(r.fmt || '') || /原著|导读|文献|选集|文集|全集|词典|参考/.test(r.cat || '');
  const rows = [
    ['作者', r.author], ['类别', r.cat], ['格式', r.fmt], ['版本/来源', r.publisher || r.src],
    ['出版年', r.pubyear], ['译者', r.translator], ['更新', (r.date && r.date !== '—') ? r.date : '']
  ].filter(x => x[1] && x[1] !== '—');
  const body = `<nav class="crumb"><a href="../../index.html">${esc(SITE)}</a> › <a href="../index.html">资料目录</a> › ${esc(r.cat || '资源')}</nav>
<h1>${esc(r.title)}</h1>
<p class="meta">${rows.map(x => esc(x[0]) + '：' + esc(x[1])).join(' ｜ ')}</p>
${(r.tags || []).length ? `<div class="tags">${(r.tags || []).map(t => '<span>' + esc(t) + '</span>').join('')}</div>` : ''}
<div class="box">${r.desc ? '<p>' + esc(r.desc) + '</p>' : ''}${r.intro ? '<p>' + esc(r.intro) + '</p>' : ''}${r.note ? '<p style="opacity:.75">' + esc(r.note) + '</p>' : ''}</div>
${r.author ? `<h2>作者／人物</h2><p><a href="../../index.html#/a/${slugOf(r.author)}">${esc(r.author)}</a>　（在站内查看其全部著作与关系图谱）</p>` : ''}
<h2>打开完整版本</h2>
<p><a class="cta solid" href="${esc(spa)}">打开交互版（含分类、检索、关系图谱）</a>
<a class="cta" href="../index.html">浏览全部 ${RES.length} 条资料</a></p>
<p style="font-size:.74rem;opacity:.65">提示：本站在「资料目录」里可按书名 / 作者 / 别名 / 正文关键词检索；本站不提供外部跳转，获取请自行在浏览器中检索。</p>`;
  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': isBook ? 'Book' : 'CreativeWork', name: r.title, headline: r.title,
      author: { '@type': 'Person', name: r.author || '—' },
      inLanguage: 'zh-CN', url: url, mainEntityOfPage: url,
      description: r.intro || r.desc || '',
      publisher: { '@type': 'Organization', name: r.publisher || r.src || SITE },
      isPartOf: { '@type': 'CollectionPage', name: SITE, url: BASE + 'pages/index.html' },
      dateModified: (r.date && r.date !== '—') ? r.date : undefined,
      license: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE, item: BASE },
      { '@type': 'ListItem', position: 2, name: '资料目录', item: BASE + 'pages/index.html' },
      { '@type': 'ListItem', position: 3, name: r.title, item: url } ]}
  ] };
  fs.writeFileSync(path.join(OUT, 'r', file + '.html'),
    page({ title: r.title + ' · ' + SITE, desc: (r.desc || r.intro || r.title).slice(0, 150),
           canonical: url, jsonld, body,
           css: '../pages.css', favicon: '../../favicon.svg', home: '../../index.html' }));
});

/* 目录页 */
const byCat = {}; const catOrder = [];
entries.forEach(e => { const c = e.r.cat || '其他'; if (!byCat[c]) { byCat[c] = []; catOrder.push(c); } byCat[c].push(e); });
const dirBody = `<nav class="crumb"><a href="../index.html">${esc(SITE)}</a> › 资料目录</nav>
<h1>📚 资料目录 · 全部 ${RES.length} 条</h1>
<p class="meta">按类别整理。每一条都有一张独立的静态页（便于检索与引用）；交互式版本支持全文检索与关系图谱。</p>
<p><a class="cta solid" href="../index.html">打开交互版站点</a></p>
${catOrder.map(c => `<div class="grp">${esc(c)} · ${byCat[c].length}</div><ul class="dir">` +
  byCat[c].map(e => `<li><a href="r/${e.file}.html"><b>${esc(e.r.title)}</b><i>${esc([e.r.author, e.r.fmt, (e.r.date && e.r.date !== '—') ? e.r.date : ''].filter(Boolean).join(' ｜ '))}</i></a></li>`).join('') +
  '</ul>').join('')}`;
fs.writeFileSync(path.join(OUT, 'index.html'),
  page({ depth: 0, css: 'pages.css', favicon: '../favicon.svg', home: '../index.html',
         title: '资料目录 · ' + SITE, desc: '本站整理的马列毛主义文献目录，共 ' + RES.length + ' 条。',
         canonical: BASE + 'pages/index.html',
         jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: '资料目录 · ' + SITE,
                   url: BASE + 'pages/index.html', inLanguage: 'zh-CN',
                   isPartOf: { '@type': 'WebSite', name: SITE, url: BASE },
                   hasPart: entries.slice(0, 200).map(e => ({ '@type': 'CreativeWork', name: e.r.title, url: BASE + 'pages/r/' + e.file + '.html' })) },
         body: dirBody }));

/* sitemap.xml */
const urls = [
  { u: BASE, p: '1.0', f: 'weekly' },
  { u: BASE + 'graph.html', p: '0.7', f: 'weekly' },
  { u: BASE + 'graph3d.html', p: '0.6', f: 'weekly' },
  { u: BASE + 'card.html', p: '0.5', f: 'monthly' },
  { u: BASE + 'pages/index.html', p: '0.8', f: 'weekly' },
  ...entries.map(e => ({ u: BASE + 'pages/r/' + e.file + '.html', p: '0.5', f: 'monthly' }))
];
const sm = `<?xml version="1.0" encoding="UTF-8"?>
<!-- 学通 · 站点地图（由 tools/gen_pages.js 生成；换域名请改 data/config.js 的 siteUrl） -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(x => `  <url>\n    <loc>${x.u}</loc>\n    <changefreq>${x.f}</changefreq>\n    <priority>${x.p}</priority>\n  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(root, 'sitemap.xml'), sm);

const bytes = entries.reduce((a, e) => a + fs.statSync(path.join(OUT, 'r', e.file + '.html')).size, 0);
console.log('✅ 生成完成');
console.log('   单条页：' + entries.length + ' 个（合计 ' + (bytes / 1024).toFixed(0) + ' KB）');
console.log('   目录页：pages/index.html ｜ 样式：pages/pages.css');
console.log('   sitemap.xml：' + urls.length + ' 条 URL');
console.log('   例：pages/r/' + entries[0].file + '.html');
