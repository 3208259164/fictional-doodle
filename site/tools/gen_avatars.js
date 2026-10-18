#!/usr/bin/env node
/* =====================================================================
   学通 · 生成头像清单（data/avatars.js 里的 window.AVATAR_FILES）
   ---------------------------------------------------------------------
   背景：graph.html 的人物节点过去靠「按 id 猜路径」去找头像
        （images/comrades/<id>.webp、images/leaders/<id>.webp），
        猜不中就产生 404。文革图谱里 72 位人物因此每次打开都会发出
        一百多个无效请求（实测 144 个 404）。
   做法：扫描 images/ 下真实存在的头像文件，生成一份清单；
        graph.html 改为「只请求清单里确实存在的文件」→ 404 归零。
        （人物照片不新增、不合成；没有照片的人物照旧显示姓氏字头像。）
   用法：node tools/gen_avatars.js      # 重新扫描并写入 data/avatars.js
   ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const DIRS = ['images/leaders', 'images/comrades', 'images/people'];   // 优先级：导师 > 同志 > 人物
const map = {}, conflict = [];

for (const dir of DIRS) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!/\.(webp|png|jpe?g)$/i.test(f)) continue;
    const key = f.replace(/\.[^.]+$/, '');
    const val = dir + '/' + f;
    if (map[key] && map[key] !== val) { conflict.push(key + ' → 已有 ' + map[key] + '，忽略 ' + val); continue; }
    map[key] = val;
  }
}
/* 同时登记「去掉下划线」的键：文革图谱里 id 形如 zhou_enlai，而文件名是 zhouenlai.webp */
for (const k of Object.keys(map)) {
  const s = k.replace(/_/g, '');
  if (s !== k && !map[s]) map[s] = map[k];
}

const keys = Object.keys(map).sort();
const out = `/* =====================================================================
   学通 · 头像清单（由 tools/gen_avatars.js 自动生成，请勿手改）
   ---------------------------------------------------------------------
   window.AVATAR_FILES：人物 id / 姓名拼音 → 头像文件路径（只收录真实存在的文件）。
   用途：graph.html 的人物节点只请求清单里有的文件，避免「猜路径」产生 404。
   重新生成：node tools/gen_avatars.js
   收录 ${keys.length} 个头像文件（${new Date().toISOString().slice(0, 10)} 扫描）。
   ===================================================================== */
window.AVATAR_FILES = ${JSON.stringify(map, null, 0).replace(/\},/g, '},\n  ').replace(/^\{/, '{\n  ').replace(/\}$/, '\n}')};

/* 兼容保留：旧的生成式线稿头像已废弃，调用它永远返回空串。 */
window.LINE_AVATAR_URI = function () { return ''; };
`;
fs.writeFileSync(path.join(root, 'data/avatars.js'), out);
console.log('✅ 头像清单已生成：' + keys.length + ' 个键');
if (conflict.length) console.log('   ⚠️ 同名冲突（已保留优先级更高的目录）：\n     ' + conflict.join('\n     '));
