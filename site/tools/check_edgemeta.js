#!/usr/bin/env node
/* 校验 data/edge-meta.js（P2 关系时序与溯源的覆盖层）
 *
 * 检查项：
 *   1. key 必须是 source|target|rel 三段
 *   2. 该边必须真实存在于某个图谱
 *   3. t 为 [起, 止]，年份 1900–2100，起 <= 止（止为 0 表示未终止）
 *   4. src.b 指向 books/ 下真实存在的文件
 *   5. src.an 若给出，必须出现在 data/bstruct.js 的锚点里
 *   6. sup 若给出，必须指向本文件里存在的 key
 *
 * 用法：node tools/check_edgemeta.js   退出码 0 通过 / 1 有问题
 */
const fs = require('fs');
const path = require('path');
global.window = {};
const site = path.dirname(__dirname);
const need = f => { try { require(path.join(site, 'data', f)); return true; } catch (e) { return false; } };
/* graph-old / graph-new 会顺手改写 window.SITE_GRAPH，所以必须排在 graph.js 之前加载，
   否则主图谱会被它们顶掉（变 95 节点），校验就对着错的数据做了。 */
['graph-old.js', 'graph-new.js', 'graph.js', 'graph-wenge.js', 'graph-world.js', 'graph-extra.js', 'edge-meta.js', 'bstruct.js'].forEach(need);

const META = window.SITE_EDGE_META || {};
const keys = new Set();
['SITE_GRAPH', 'SITE_GRAPH_WENGE', 'SITE_GRAPH_WORLD', 'SITE_GRAPH_EXTRA', 'SITE_GRAPH_OLD', 'SITE_GRAPH_NEW'].forEach(g => {
  const G = window[g]; if (!G) return;
  (G.links || []).forEach(l => keys.add(l.source + '|' + l.target + '|' + (l.rel || '')));
});
const books = new Set(fs.readdirSync(path.join(site, 'books')).filter(f => f.endsWith('.txt')));
const B = window.SITE_BSTRUCT || {};
const anchors = {};
Object.keys(B).forEach(f => { (B[f].an || []).forEach(a => { (anchors[f] = anchors[f] || new Set()).add(a[1]); }); });

let bad = 0, n = 0;
Object.keys(META).forEach(k => {
  n++;
  if (k.split('|').length !== 3) { console.log('  x 键格式不对:', k); bad++; return; }
  if (!keys.has(k)) { console.log('  x 图里没有这条边:', k); bad++; return; }
  const m = META[k];
  if (m.t) {
    if (!Array.isArray(m.t) || m.t.length !== 2) { console.log('  x t 不是 [起,止]:', k); bad++; }
    else {
      const a = m.t[0], b = m.t[1];
      if (!(a >= 1900 && a <= 2100)) { console.log('  x 起始年越界:', k, a); bad++; }
      if (b !== 0 && !(b >= 1900 && b <= 2100)) { console.log('  x 终止年越界:', k, b); bad++; }
      if (b !== 0 && b < a) { console.log('  x 终止早于起始:', k); bad++; }
    }
  }
  if (m.src) {
    if (m.src.b && !books.has(m.src.b)) { console.log('  x src 书不存在:', k, m.src.b); bad++; }
    if (m.src.an && m.src.b && !(anchors[m.src.b] && anchors[m.src.b].has(m.src.an))) {
      console.log('  x src 锚点不在 bstruct 里:', k, m.src.an); bad++;
    }
  }
  if (m.sup && !META[m.sup]) { console.log('  x sup 指向不存在的键:', k, m.sup); bad++; }
});

console.log('== edge-meta 校验 ==');
console.log('  标注边', n, '| 图谱边总数', keys.size, '| 问题', bad);
if (bad) { console.log('  FAIL'); process.exit(1); }
console.log('  PASS');
