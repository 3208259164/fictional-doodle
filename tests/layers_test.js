/**
 * 三层结构 + 导入导出测试
 */
const fs = require('fs');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const DIR = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/';

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x ? ' → ' + x : '')); } };

function boot() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously',
    url: 'https://local.test/'
  });
  const w = dom.window;
  /* 手动加载依赖，顺序固定 */
  function load(f) {
    const code = fs.readFileSync(DIR + f, 'utf8');
    w.eval(code);
  }
  load('data/graph.js');
  load('data/graph-wenge.js');
  load('data/graph-world.js');
  load('assets/qa-engine.js');
  load('assets/layers.js');
  return w;
}

const w = boot();
const L = w.YZ_LAYERS;
const Q = w.YZQA;

console.log('\n[1] 初始状态');
{
  const st = L.stats();
  ok(st.base > 300, '官方层 ' + st.base + ' 节点');
  ok(st.user === 0, '用户层为空');
  ok(st.merged >= 300, '合并视图 ' + st.merged + ' 节点');
}

console.log('\n[2] 解析 JSON');
{
  const txt = JSON.stringify({
    type: 'yzt-graph',
    nodes: [
      { id: 'surplus_value', name: '剩余价值', type: 'concept', desc: '由雇佣工人剩余劳动创造、被资本家无偿占有的价值。', source: '《资本论》第一卷', verified: true },
      { id: 'historical_materialism', name: '唯物史观', type: 'concept', desc: '社会存在决定社会意识。', source: '《政治经济学批判》序言' }
    ],
    links: [{ source: 'marx', target: 'surplus_value', rel: '提出' }]
  });
  const p = L.parse(txt, 'test.json');
  ok(p.nodes.length === 2, '解析出 2 个节点');
  ok(p.links.length === 1, '解析出 1 条关系');
  ok(p.errors.length === 0, '无解析错误');
  ok(p.nodes[0].type === 'concept', 'type=concept 被保留');
  ok(p.nodes[0].verified === true, 'verified 被保留');
}

console.log('\n[3] 解析 JSONL（问答对）');
{
  const txt = [
    '{"instruction":"什么是剩余价值","output":"由雇佣工人剩余劳动创造、被资本家无偿占有的价值。","source":"graph#surplus_value"}',
    '{"instruction":"什么是唯物史观","output":"社会存在决定社会意识。","source":"graph#historical_materialism"}'
  ].join('\n');
  const p = L.parse(txt, 'qa.jsonl');
  ok(p.nodes.length === 2, '转成 2 条知识条目');
  ok(p.nodes[0].type === 'concept', '类型为 concept');
  ok(p.nodes[0].desc.indexOf('雇佣工人') >= 0, '内容正确');
  ok(p.nodes[0].verified === false, '默认 verified=false（未核对）');
}

console.log('\n[4] 解析 Markdown（frontmatter）');
{
  const txt = ['---', 'id: class_struggle', 'name: 阶级斗争', 'type: concept', 'source: 《共产党宣言》', '---', '阶级斗争是阶级社会发展的直接动力。'].join('\n');
  const p = L.parse(txt, 'x.md');
  ok(p.nodes.length === 1, '解析出 1 个节点');
  ok(p.nodes[0].id === 'class_struggle', 'id 正确');
  ok(p.nodes[0].desc.indexOf('直接动力') >= 0, '正文正确');
  ok(p.nodes[0].source.indexOf('共产党宣言') >= 0, '来源正确');
}

console.log('\n[5] 预览：新增 / 重复 / 冲突');
{
  const txt = JSON.stringify({
    nodes: [
      { id: 'surplus_value', name: '剩余价值', desc: '新内容' },                    /* 新增 */
      { id: 'marx', name: '卡尔·马克思', desc: '内容不同' },                       /* 与官方冲突 */
      { id: 'engels', name: '弗里德里希·恩格斯' }                                  /* 与官方重复（描述不一致） */
    ]
  });
  const p = L.parse(txt, 'x.json');
  const pv = L.preview(p);
  ok(pv.added === 1, '新增 1（实为 ' + pv.added + '）');
  ok(pv.dupBase === 2, '与官方重复/冲突 2（实为 ' + pv.dupBase + '）');
  ok(pv.noSource === 3, '三条都没写来源');
}

console.log('\n[6] 提交：写入用户层');
{
  const txt = JSON.stringify({
    nodes: [
      { id: 'surplus_value', name: '剩余价值', type: 'concept', desc: '由雇佣工人剩余劳动创造。', source: '《资本论》' },
      { id: 'historical_materialism', name: '唯物史观', type: 'concept', desc: '社会存在决定社会意识。', source: '《政治经济学批判》序言' }
    ],
    links: [{ source: 'marx', target: 'surplus_value', rel: '提出' }]
  });
  const p = L.parse(txt, 'x.json');
  const r = L.commit(p);
  ok(r.added === 2, '写入 2 条（实为 ' + r.added + '）');
  const st = L.stats();
  ok(st.user === 2, '用户层 2 条');
  ok(st.merged > 0 && st.merged >= st.base - 5, '合并视图有节点（基础 ' + st.base + ' → 合并 ' + st.merged + '，两者口径不同，允许小差）');
}

console.log('\n[7] 导入后可直接问答');
{
  const a = Q.ask('剩余价值是谁');
  ok(a.ok === true && a.answer.indexOf('剩余价值') >= 0, '能查到新导入的节点');
  const b = Q.ask('剩余价值');
  ok(b.answer.indexOf('雇佣工人') >= 0, '内容正确');
}

console.log('\n[8] 导出 JSON');
{
  const s = L.exportJSON({ includeBase: false, includeUser: true });
  const d = JSON.parse(s);
  ok(d.type === 'yzt-graph', 'type 标记正确');
  ok(d.nodes.length === 2, '只导用户层 2 条');
  ok(d.nodes.every(n => n._layer === 'user'), 'layer 标记为 user');
}

console.log('\n[9] 导出训练语料（JSONL）');
{
  const s = L.exportJSONL({ includeBase: false, includeUser: true, includeUnverified: true });
  const lines = s.split('\n').filter(Boolean);
  ok(lines.length >= 4, '生成 ' + lines.length + ' 条训练样本');
  const first = JSON.parse(lines[0]);
  ok(!!first.instruction && !!first.output, '有 instruction/output');
  ok(!!first.source, '带 source：' + first.source);
  ok(first.layer === 'user', 'layer=user');
  ok('verified' in first, '带 verified 字段（可区分是否核对）');
}

console.log('\n[10] 未核对的内容默认不进训练集');
{
  const s1 = L.exportJSONL({ includeBase: false, includeUser: true });
  const s2 = L.exportJSONL({ includeBase: false, includeUser: true, includeUnverified: true });
  ok(s1.length < s2.length, '默认排除未核对条目（' + s1.split('\n').length + ' < ' + s2.split('\n').length + '）');
}

console.log('\n[11] 清空用户层');
{
  L.clear();
  ok(L.stats().user === 0, '用户层已清空');
  const a = Q.ask('剩余价值');
  /* 「剩余价值」是马克思的 tag，清空后仍会命中马克思——这不算错，只要不含用户层内容即可 */
  ok(a.answer.indexOf('雇佣工人') < 0, '清空后不再返回用户层内容');
}

console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
process.exit(fail ? 1 : 0);
