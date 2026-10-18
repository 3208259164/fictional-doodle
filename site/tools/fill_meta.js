#!/usr/bin/env node
/* 元数据自动补全（构建时用，非站点依赖）
   用法：node tools/fill_meta.js
   读 data/resources.js，按书名查询 Open Library / Google Books，打印建议的
   出版社 / 出版年 / 页数 / ISBN，供人工核对后填回 resources.js。
   不会自动改写 resources.js；建议写入 tools/meta_suggestions.json。
   ⚠️ 中文版本书名在这两个库里命中率有限，务必人工核对版本与译者。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
global.window = {};
require(path.join(root, 'data/resources.js'));
const RES = (global.window.SITE_RESOURCES || []);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openLibrary(title, author) {
  try {
    const q = encodeURIComponent((title + ' ' + (author && author !== '—' ? author : '')).trim());
    const r = await fetch('https://openlibrary.org/search.json?q=' + q + '&limit=1');
    if (!r.ok) return null;
    const d = await r.json();
    const doc = (d.docs || [])[0];
    if (!doc) return null;
    return { year: doc.first_publish_year || '', pub: (doc.publisher || [])[0] || '',
             pages: doc.number_of_pages_median || '', isbn: (doc.isbn || [])[0] || '', title: doc.title || '', src: 'OpenLibrary' };
  } catch (e) { return null; }
}
async function googleBooks(title, author) {
  try {
    const q = encodeURIComponent('intitle:' + title + (author && author !== '—' ? ' inauthor:' + author : ''));
    const r = await fetch('https://www.googleapis.com/books/v1/volumes?q=' + q + '&maxResults=1&country=US');
    if (!r.ok) return null;
    const d = await r.json();
    const v = (d.items || [])[0];
    if (!v) return null;
    const vi = v.volumeInfo || {};
    return { year: (vi.publishedDate || '').slice(0, 4), pub: vi.publisher || '',
             pages: vi.pageCount || '', isbn: (((vi.industryIdentifiers || [])[0]) || {}).identifier || '', title: vi.title || '', src: 'GoogleBooks' };
  } catch (e) { return null; }
}

(async () => {
  const need = RES.filter(r => !r.pubyear || r.pubyear === '—' || !r.publisher);
  console.log('共 ' + RES.length + ' 条，字段待补 ' + need.length + ' 条。\n');
  const out = [];
  for (const r of need) {
    let m = await openLibrary(r.title, r.author);
    await sleep(300);
    if (!m || (!m.year && !m.pub)) { m = await googleBooks(r.title, r.author); await sleep(300); }
    console.log('· ' + r.title + (r.author && r.author !== '—' ? '（' + r.author + '）' : ''));
    if (m) console.log('    → 出版社: ' + (m.pub || '?') + ' | 出版年: ' + (m.year || '?') +
      ' | 页数: ' + (m.pages || '?') + ' | ISBN: ' + (m.isbn || '?') + '   [' + m.src + ']');
    else console.log('    → 未找到（建议人工核对）');
    out.push({ id: r.id, title: r.title, suggestion: m || null });
  }
  fs.writeFileSync(path.join(root, 'tools/meta_suggestions.json'), JSON.stringify(out, null, 2));
  console.log('\n建议已写入 tools/meta_suggestions.json（仅供人工参考，未改动 resources.js）。');
})();
