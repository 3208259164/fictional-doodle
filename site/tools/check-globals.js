#!/usr/bin/env node
/* 学通 · 全局命名空间基线（0.18.50 新增）
   ---------------------------------------------------------------------
   为什么：window.* 从 152 个涨到 185 个（0.17.66 → 0.18.50），
   「改一处忘一处」的根源。没有 lint / 类型 / 构建，只能靠基线卡住：
   只许变少，不许新增。

   用法：
     node tools/check-globals.js assets/*.js            # 检查（新增即失败）
     node tools/check-globals.js assets/*.js --update   # 重建基线（确认无新增后）
   --------------------------------------------------------------------- */
const fs = require('fs');
const files = process.argv.slice(2).filter(f => /\.js$/.test(f));
if (!files.length) { console.error('用法: node tools/check-globals.js assets/*.js [--update]'); process.exit(2); }

const re = /(?:^|[^.\w$])(?:window|self|globalThis)\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)/g;
const found = new Map();   // 名字 -> 首次出现的文件
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(src))) if (!found.has(m[1])) found.set(m[1], f.split('/').pop());
}

const baseFile = 'tools/globals.baseline.json';
let base = null;
if (fs.existsSync(baseFile)) {
  try { base = JSON.parse(fs.readFileSync(baseFile, 'utf8')); } catch (e) { base = null; }
}

if (process.argv.includes('--update') || !base || !base.names) {
  const obj = { _说明: '全局命名空间基线：只许变少，不许新增。新增请挂到统一命名空间下；确认无误后用 --update 重建。',
                count: found.size, names: [...found.keys()].sort() };
  fs.writeFileSync(baseFile, JSON.stringify(obj, null, 1) + '\n');
  console.log('✅ 基线已建立：%d 个 window.* → %s', found.size, baseFile);
  process.exit(0);
}

const old = new Set(base.names || []);
const added = [...found.keys()].filter(x => !old.has(x));
const gone = [...old].filter(x => !found.has(x));

if (added.length) {
  console.error('❌ 新增全局 %d 个（请挂到命名空间下，或确认后 --update）：', added.length);
  added.slice(0, 30).forEach(n => console.error('   + window.%s   (%s)', n, found.get(n)));
  process.exit(1);
}
console.log('✅ 全局数 %d（基线 %d），无新增', found.size, old.size);
if (gone.length) console.log('ℹ️ 有 %d 个已消失，可下调基线：%s', gone.length, gone.slice(0, 15).join(', '));
