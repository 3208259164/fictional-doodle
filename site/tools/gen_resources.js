#!/usr/bin/env node
/* =====================================================================
   学通 · 内容自动生成（扫描 books/ 与 audio/，生成资源条目骨架）
   用法：
     node tools/gen_resources.js            # 打印建议条目到屏幕
     node tools/gen_resources.js --write    # 写入 data/resources.suggested.js
   说明：只生成“骨架”，不会覆盖你手写的 data/resources.js。
   生成后请把需要保留的条目复制进 resources.js，并补全作者、简介等。
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const DIRS = [['books', '原著'], ['audio', '有声书']];

function inferFmt(f){ const e = path.extname(f).slice(1).toLowerCase(); return e ? e.toUpperCase() : '—'; }
function humanSize(b){ return b >= 1048576 ? (b/1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b/1024)) + ' KB'; }
function slugify(s){ return String(s).replace(/[《》]/g, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'item'; }

const items = [];
for (const [dir, cat] of DIRS){
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)){
    if (f === '说明.txt' || f.startsWith('.')) continue;
    const st = fs.statSync(path.join(abs, f));
    if (!st.isFile()) continue;
    const base = f.replace(/\.[^.]+$/, '');
    const iso = new Date(st.mtimeMs).toISOString().slice(0, 10);
    items.push({
      id: slugify(base), title: base, author: 'TODO', cat, icon: cat === '有声书' ? '🎧' : '📕',
      tags: [], alias: '', desc: 'TODO', fmt: inferFmt(f), src: '本站整理',
      url: dir + '/' + f, date: iso, status: 'ok', hot: 5, size: humanSize(st.size),
      intro: 'TODO',
    });
  }
}

const js = '/* 由 tools/gen_resources.js 自动生成，仅作参考，请合并进 resources.js */\n' +
  'window.SITE_RESOURCES_SUGGESTED = ' + JSON.stringify(items, null, 2) + ';\n';

if (process.argv.includes('--write')){
  fs.writeFileSync(path.join(root, 'data', 'resources.suggested.js'), js);
  console.log('已写入 data/resources.suggested.js，共 ' + items.length + ' 条骨架。');
} else {
  console.log('发现 ' + items.length + ' 个文件，建议条目如下（复制到 resources.js 并补全）：\n');
  console.log(js);
}
