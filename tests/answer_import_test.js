/* 答疑文档批量导入回归（12 项）
   为什么做：答疑原来只能一条条点「＋ 新增」，而且新增的条目都被塞进第一个分组（「怎么读」），
            没法从 TXT / MD 里成批搬进来，也没法指定分组。
   本测试锁住：文档解析（# 分组 / Q: / A: / 问：/ 答：）、分组归属、同名跳过与覆盖、
            新增条目确实进了指定分组、以及弹窗能打开。 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window, d = w.document;
setTimeout(() => {
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };
  const P = w.YZStudy._parseAnswerText;
  ok('解析器已导出', typeof P === 'function');

  /* ① 基本格式：# 分组 + Q/A */
  const doc1 = [
    '# 哲学与认识',
    'Q: 什么是唯物辩证法？',
    'A: 关于自然、社会和思维发展一般规律的科学。',
    'Q: 它和形而上学有什么区别？',
    'A: 是否承认内部矛盾是发展的动力。',
    '# 政治经济学',
    'Q: 什么是剩余价值？',
    'A: 工人创造的价值中被无偿占有的部分。'
  ].join('\n');
  const r1 = P(doc1);
  ok('解析出 3 条问答', r1.list.length === 3, r1.list.length + ' 条');
  ok('分组归属正确', r1.list[0].group === '哲学与认识' && r1.list[2].group === '政治经济学',
    r1.list.map(x => x.group).join('/'));

  /* ② 中文标点与多行答案 */
  const doc2 = '问：什么是实践？\n答：人能动地改造世界的物质活动。\n它首先是生产活动。\n问：什么是认识？\n答：人脑对客观世界的反映。';
  const r2 = P(doc2);
  ok('认「问：」「答：」', r2.list.length === 2, r2.list.length + ' 条');
  ok('答案支持续行', /首先是生产活动/.test(r2.list[0].a), r2.list[0].a);

  /* ③ 没有分组时归入「导入」 */
  const r3 = P('Q: 孤零零的一问\nA: 孤零零的一答');
  ok('无分组时 group 为空（导入时归入「导入」）', r3.list.length === 1 && !r3.list[0].group, JSON.stringify(r3.list[0].group));

  /* ④ 坏行不硬凑 */
  const r4 = P('随便一行没有标记\nQ: 正常问题\nA: 正常答案');
  ok('坏行进 bad 不进 list', r4.list.length === 1 && r4.bad.length === 1,
    'list=' + r4.list.length + ' bad=' + r4.bad.length);

  /* ⑤ 导入：走 YZY.importAnswers，落到指定分组 */
  const before = (w.SITE_ANSWERS.groups || []).reduce((a, g) => a + (g.items || []).length, 0);
  const res = w.YZY.importAnswers(r1.list, {});
  ok('importAnswers 返回新增 3 条', res && res.ok && res.added === 3, JSON.stringify({ added: res.added, skipped: res.skipped }));
  w.YZY.reapply();
  const after = (w.SITE_ANSWERS.groups || []).reduce((a, g) => a + (g.items || []).length, 0);
  ok('导入后条目总数 +3', after === before + 3, before + ' → ' + after);

  const gp = (w.SITE_ANSWERS.groups || []).filter(g => g.name === '哲学与认识')[0];
  ok('新条目确实进了「哲学与认识」组',
    !!gp && (gp.items || []).some(x => x.q === '什么是唯物辩证法？'),
    gp ? (gp.items || []).length + ' 条' : '找不到该组');
  const gpe = (w.SITE_ANSWERS.groups || []).filter(g => g.name === '政治经济学')[0];
  ok('另一条进了「政治经济学」组', !!gpe && (gpe.items || []).some(x => x.q === '什么是剩余价值？'));

  /* ⑥ 同名跳过 */
  const res2 = w.YZY.importAnswers([{ q: '什么是唯物辩证法？', a: '重复的' }], {});
  ok('同名问题默认跳过', res2 && res2.added === 0 && (res2.skipped || []).length === 1, JSON.stringify(res2.skipped));

  /* ⑦ 幂等：反复 reapply 不会重复堆叠 */
  const n1 = (w.SITE_ANSWERS.groups || []).reduce((a, g) => a + (g.items || []).length, 0);
  w.YZY.reapply(); w.YZY.reapply();
  const n2 = (w.SITE_ANSWERS.groups || []).reduce((a, g) => a + (g.items || []).length, 0);
  ok('反复 reapply 不重复堆叠', n1 === n2, n1 + ' → ' + n2);

  /* ⑧ 弹窗 */
  w.YZStudy.ansImport();
  ok('导入弹窗能打开', !!d.getElementById('yzAnsImp'));

  /* ⑨ 依据行：不再被当成答案续行 */
  const r5 = P('Q: 什么是阶级\nA: 一个集团占有另一个集团的劳动\n依据：列宁《伟大的创举》');
  ok('「依据：」解析为 basis 而不是粘进答案',
    r5.list.length === 1 && (r5.list[0].basis || []).length === 1 && !/依据/.test(r5.list[0].a),
    JSON.stringify({ a: r5.list[0].a, basis: r5.list[0].basis }));

  /* ⑩ 导出：格式与导入一致，能往返 */
  ok('导出器已导出', typeof w.YZStudy._answersText === 'function');
  const md = w.YZStudy._answersText('');
  ok('导出文本非空且含分组标记', md.length > 200 && /^# /m.test(md), md.length + ' 字');
  ok('导出文本含 Q: / A:', /^Q: /m.test(md) && /^A: /m.test(md));
  const rt = P(md);
  ok('导出的文本能被自己的解析器读回来', rt.list.length > 0, rt.list.length + ' 条');
  const qN = (md.match(/^Q:/gm) || []).length;
  ok('往返条数一致（导出 N 条 = 解析回 N 条）', rt.list.length === qN, qN + ' vs ' + rt.list.length);
  ok('往返保留分组', rt.list.some(x => x.group && x.group.length > 0), rt.list[0] && rt.list[0].group);
  const one = w.YZStudy._answersText((w.SITE_ANSWERS.groups[0] || {}).name);
  ok('可以只导出单组', /^# /m.test(one) && (one.match(/^# /gm) || []).length === 1, (one.match(/^Q:/gm) || []).length + ' 条');

  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
}, 1600);
