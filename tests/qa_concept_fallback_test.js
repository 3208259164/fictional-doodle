/* 问一问：概念能不能直接答（2026-11-14）
 *
 * 起因：搜「安人」这类词只能给出书目，用户要的是「直接回答概念」。
 * 这一轮做了三件事，测试锁住：
 *   ① 补了 6 个高频缺失概念（无政府主义/巴枯宁主义/空想社会主义/改良主义/机会主义/工团主义）
 *   ② 旧译归一：安那其 → 无政府主义（中文马列文献里同一概念常有多个译名）
 *   ③ 复合名拆分：「无政府主义 · 巴枯宁主义」要能被「无政府主义」直接问到
 *   ④ 查不到时给「最接近的条目」或「相关书目」，不再只报一句节点统计
 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'ask.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errs.push(e.message); });
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

setTimeout(() => {
  console.log('===== 问一问：概念直接回答 =====');
  ok('问答引擎已就绪', !!(w.YZQA && typeof w.YZQA.ask === 'function'));
  if (!w.YZQA) { process.exit(1); }

  const gs = w.YZQA.graphs().map(g => g.id);
  ok('问答库含「理论概念」层', gs.indexOf('concepts') >= 0, gs.join('/'));

  const concepts = ['无政府主义', '巴枯宁主义', '空想社会主义', '改良主义', '机会主义', '工团主义',
    /* 第 1 批（2026-11-14 追加）：辩证法五对范畴 + 政经细分 + 思潮 + 中国化 */
    '本质与现象', '可能性与现实性', '内因与外因', '内容和形式'.replace('内容和形式', '内容与形式'),
    '具体劳动', '抽象劳动', '利息', '金融寡头',
    '工联主义', '布朗基主义', '费边主义', '民粹主义', '民主社会主义',
    '社会主义初级阶段', '社会主义市场经济', '人的全面发展'];
  for (const q of concepts) {
    const r = w.YZQA.ask(q);
    const isIntro = r.intent === 'intro' || r.intent === 'concept-near';
    ok('「' + q + '」直接回答概念', isIntro && String(r.answer || '').length > 40,
      r.intent + ' · ' + String(r.answer || '').slice(0, 46).replace(/\n/g, ' '));
  }

  const a1 = String(w.YZQA.ask('无政府主义').answer || '');
  ok('无政府主义：提到废除国家/权威', /废除国家|权威/.test(a1), a1.slice(0, 40));
  const a2 = String(w.YZQA.ask('空想社会主义').answer || '');
  ok('空想社会主义：提到代表人物', /圣西门|傅立叶|欧文|莫尔/.test(a2), a2.slice(0, 40));

  const al = w.YZQA.ask('安那其');
  ok('「安那其」按旧译答到无政府主义',
    (al.intent === 'intro' || al.intent === 'concept-near') && /无政府|废除国家/.test(String(al.answer || '')),
    al.intent + ' · ' + String(al.answer || '').slice(0, 40));
  ok('旧译有说明（不让人以为答错了词）',
    (al.notes || []).some(n => /安那其/.test(n) && /无政府主义/.test(n)),
    (al.notes || []).join(' | ').slice(0, 60));

  const bad = w.YZQA.ask('绝对不存在的人物xyzabc');
  const bt = String(bad.answer || '');
  ok('查不到时明确说「没有找到」', /没有找到/.test(bt), bt.slice(0, 50));
  ok('查不到时给出下一步（候选/书目/补全建议）',
    /候选|相关书目|试试/.test(bt) || (bad.notes || []).some(n => /相关书目|候选/.test(n)),
    ((bad.notes || []).join(' | ') || bt).slice(0, 60));
  ok('不编造模糊话术', !/可能|大概|也许/.test(bt));

  const short = w.YZQA.ask('安人');
  ok('两字短词提示补全', /两个字符|试试写成完整/.test(String(short.answer || '')),
    String(short.answer || '').slice(0, 60));

  /* ---- 7. 书名前缀不再抢答概念（2026-11-14 修） ---- */
  const dl = w.YZQA.ask('帝国主义');
  ok('「帝国主义」答概念而不是《帝国主义是资本主义的最高阶段》',
    (dl.intent === 'intro' || dl.intent === 'concept-near') && /垄断|帝国主义/.test(String(dl.answer || '')),
    dl.intent + ' · ' + String(dl.answer || '').slice(0, 34));
  const cap = w.YZQA.ask('资本积累');
  ok('「资本积累」答概念而不是《资本积累论》', cap.intent !== 'book', cap.intent);
  /* 带书名号仍然答书：问《…》就是在问那本书 */
  const bk = w.YZQA.ask('《无产阶级专政》');
  ok('带书名号时仍答书（不被概念抢走）', bk.intent === 'book', bk.intent);

  /* ---- 8. 移出主图谱的节点，问一问仍然答得到（2026-11-14） ----
     主图谱瘦身把哲学史/西马/共运组织并进了世界图谱，问答库走的是全部图谱的并集，
     所以这些节点必须照样能被问到——不然「移走」就等于「删掉」。 */
  const moved = ['康德', '黑格尔', '卢卡奇', '阿尔都塞', '契卡'];
  for (const q of moved) {
    const r = w.YZQA.ask(q);
    const isEntry = r.ok && ['intro', 'term', 'faq', 'concept-near'].indexOf(r.intent) >= 0;
    ok('移出主图谱的「' + q + '」问答仍答得出', isEntry,
      r.intent + ' · ' + String(r.answer || '').slice(0, 30).replace(/\n/g, ' '));
  }

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
}, 2500);
