#!/usr/bin/env node
/* =====================================================================
   学通 · RSS 自动生成（根据 resources.js 的更新日期生成 feed.xml）
   用法：node tools/gen_feed.js
   依赖：data/config.js（siteUrl）、data/resources.js
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['data/config.js', 'data/resources.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}
const CFG = ctx.window.SITE_CONFIG || {};
const RES = ctx.window.SITE_RESOURCES || [];
const base = (CFG.siteUrl || 'https://example.netlify.app/').replace(/\/?$/, '/');

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const rfc822 = d => { const t = new Date((d || '') + 'T08:00:00+08:00'); return isNaN(t) ? new Date().toUTCString() : t.toUTCString(); };

const items = RES.filter(r => r.date && r.date !== '—')
  .slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10)
  .map(r => `    <item>
      <title>${esc(r.title)}</title>
      <link>${base}#/r/${encodeURIComponent(r.id || r.title)}</link>
      <guid isPermaLink="false">${esc(r.id || r.title)}-${esc(r.date)}</guid>
      <pubDate>${rfc822(r.date)}</pubDate>
      <description>${esc(r.author + ' · ' + (r.desc || r.intro || ''))}</description>
    </item>`).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="feed.xsl"?>
<!-- 由 tools/gen_feed.js 自动生成；每次更新资源后重新运行即可 -->
<rss version="2.0">
  <channel>
    <title>${esc(CFG.siteName || '学通')} · 更新</title>
    <link>${base}</link>
    <description>${esc(CFG.bio || '资料整理与分享')} · 更新（免费公益）</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
fs.writeFileSync(path.join(root, 'feed.xml'), xml);
console.log('已生成 feed.xml，共 ' + (items ? items.split('</item>').length - 1 : 0) + ' 条。');
