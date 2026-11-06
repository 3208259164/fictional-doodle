#!/usr/bin/env node
/* 史料四类（推荐人物 / 思想 / 组织 / 答疑）编辑 —— jsdom 实测 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));

let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
  const f = path.join(SITE, src);
  if (!fs.existsSync(f)) return '';
  return `<script>${fs.readFileSync(f, 'utf8').replace(/<\/script>/g, '<\\/script>')}</script>`;
});

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; }
    });
    w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    w.scrollTo = () => {};
  }
});
const w = dom.window;
const R = [];
const ok = (n, c, x) => R.push([c, n, x]);

const { waitData } = require('./_lazy_hook')(w, SITE);   /* 编辑/术语等数据按需注入，jsdom 要真加载 */
waitData(() => {
  try {
    w.YZY.setEditorEnabled(true);
    ok('① openEduEdit 已定义', typeof w.openEduEdit === 'function');
    ok('① openRecommendEdit 已定义', typeof w.openRecommendEdit === 'function');
    ok('① openSchoolEdit 已定义', typeof w.openSchoolEdit === 'function');
    ok('① openAnswerEdit 已定义', typeof w.openAnswerEdit === 'function');
    ok('① 三个新增函数已定义',
      typeof w.openRecommendNew === 'function' && typeof w.openSchoolNew === 'function' && typeof w.openAnswerNew === 'function');

    /* ---------- ② 推荐人物 ---------- */
    const recName = w.eval('CT.recommend[0].name');
    w.openRecommendEdit(recName);
    let box = w.document.getElementById('eduEditor');
    ok('② 推荐人物弹层出现', !!box);
    if (box) {
      ok('② 弹层回填了原介绍', String(box.querySelector('#ee_intro').value).length > 20);
      box.querySelector('#ee_intro').value = '【测试】推荐人物介绍已改';
      box.querySelector('#ee_fans').value = '99.9万';
      box.querySelector('[data-ee="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
      const intro = w.eval(`(CT.recommend.filter(x=>x.name===${JSON.stringify(recName)})[0]||{}).intro`);
      const fans = w.eval(`(CT.recommend.filter(x=>x.name===${JSON.stringify(recName)})[0]||{}).fans`);
      ok('② 介绍已保存', String(intro).indexOf('【测试】') >= 0, String(intro).slice(0, 18));
      ok('② 粉丝数已保存', fans === '99.9万', String(fans));
      ok('② 弹层已关闭', !w.document.getElementById('eduEditor'));
    }
    /* 幂等 */
    w.YZY.reapply(); w.YZY.reapply();
    const intro2 = w.eval(`(CT.recommend.filter(x=>x.name===${JSON.stringify(recName)})[0]||{}).intro`);
    ok('② 重复 reapply 幂等', String(intro2).indexOf('【测试】') >= 0 && intro2.length < 40, String(intro2).slice(0, 18));
    ok('② 推荐条数未变', w.eval('CT.recommend.length') === 4);

    /* ---------- ③ 思想 / 组织 ---------- */
    const schName = w.eval('EX.schools[0].items[0].name');
    w.openSchoolEdit(schName);
    box = w.document.getElementById('eduEditor');
    ok('③ 思想弹层出现', !!box);
    if (box) {
      ok('③ 弹层回填了要点说明', String(box.querySelector('#ee_desc').value).length > 20);
      box.querySelector('#ee_desc').value = '【测试】思想要点已改';
      box.querySelector('#ee_people').value = '甲 乙 丙';
      box.querySelector('[data-ee="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
      const d = w.eval(`(EX.schools[0].items.filter(x=>x.name===${JSON.stringify(schName)})[0]||{}).desc`);
      const pp = w.eval(`(EX.schools[0].items.filter(x=>x.name===${JSON.stringify(schName)})[0]||{}).people`);
      ok('③ 要点说明已保存', String(d).indexOf('【测试】') >= 0, String(d).slice(0, 18));
      ok('③ 相关人物按空格拆开', Array.isArray(pp) && pp.length === 3 && pp[0] === '甲', JSON.stringify(pp));
    }

    /* ---------- ④ 答疑 ---------- */
    const qid = w.eval('SITE_ANSWERS.groups[0].items[0].id');
    w.openAnswerEdit(qid);
    box = w.document.getElementById('eduEditor');
    ok('④ 答疑弹层出现', !!box);
    if (box) {
      ok('④ 弹层回填了原回答', String(box.querySelector('#ee_a').value).length > 50);
      box.querySelector('#ee_a').value = '【测试】答疑回答已改';
      box.querySelector('#ee_basis').value = '《共产党宣言》\n《资本论》';
      box.querySelector('[data-ee="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
      const a = w.eval(`(SITE_ANSWERS.groups[0].items.filter(x=>x.id===${JSON.stringify(qid)})[0]||{}).a`);
      const bs = w.eval(`(SITE_ANSWERS.groups[0].items.filter(x=>x.id===${JSON.stringify(qid)})[0]||{}).basis`);
      ok('④ 回答已保存', String(a).indexOf('【测试】') >= 0, String(a).slice(0, 18));
      ok('④ 依据按行拆成数组', Array.isArray(bs) && bs.length === 2 && bs[0] === '《共产党宣言》', JSON.stringify(bs));
    }

    /* ---------- ⑤ 新增三类 ---------- */
    const n0 = w.eval('CT.recommend.length');
    w.openRecommendNew();
    box = w.document.getElementById('eduEditor');
    if (box) {
      box.querySelector('#ee_name').value = '【测试新人】';
      box.querySelector('#ee_intro').value = '新增的推荐条目';
      box.querySelector('[data-ee="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    }
    ok('⑤ 推荐人物已新增', w.eval('CT.recommend.length') === n0 + 1, String(w.eval('CT.recommend.length')));
    ok('⑤ 新增条目内容正确',
      w.eval('CT.recommend.filter(x=>x.name==="【测试新人】")[0].intro') === '新增的推荐条目');

    const s0 = w.eval('EX.schools[0].items.length');
    w.openSchoolNew(0);
    box = w.document.getElementById('eduEditor');
    if (box) {
      box.querySelector('#ee_name').value = '【测试思想】';
      box.querySelector('#ee_desc').value = '新增的要点';
      box.querySelector('[data-ee="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    }
    ok('⑤ 思想条目已新增', w.eval('EX.schools[0].items.length') === s0 + 1);
    ok('⑤ 新增思想落在第 1 组',
      w.eval('EX.schools[0].items.filter(x=>x.name==="【测试思想】").length') === 1);

    const q0 = w.eval('SITE_ANSWERS.groups[0].items.length');
    w.openAnswerNew();
    box = w.document.getElementById('eduEditor');
    if (box) {
      box.querySelector('#ee_q').value = '【测试问题】';
      box.querySelector('#ee_a').value = '测试回答';
      box.querySelector('[data-ee="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    }
    ok('⑤ 答疑已新增', w.eval('SITE_ANSWERS.groups[0].items.length') === q0 + 1);

    /* ---------- ⑥ 持久化 ---------- */
    const raw = w.localStorage.getItem('yzy_ov_v1') || '';
    let ov = {};
    try { ov = JSON.parse(raw); } catch (e) {}
    ok('⑥ 覆盖层已写入本机', !!ov.edu, raw.slice(0, 40));
    ok('⑥ 三类都有存档',
      !!(ov.edu && ov.edu.rec && ov.edu.sch && ov.edu.qa));
    ok('⑥ 推荐人物改动已落盘',
      !!(ov.edu && ov.edu.rec.edited && Object.keys(ov.edu.rec.edited).length > 0));
    ok('⑥ 答疑改动已落盘',
      !!(ov.edu && ov.edu.qa.edited && Object.keys(ov.edu.qa.edited).length > 0));

    /* ---------- ⑦ 列表卡片上的 ✏️ ---------- */
    w.openHub('recommend');
    ok('⑦ 推荐人物卡片有 ✏️',
      w.document.querySelectorAll('#hub-r-0 .libedit').length === 1);
    w.openHub('thoughts');
    ok('⑦ 思想列表每张卡有 ✏️',
      w.document.querySelectorAll('[id^="hub-s-0-"] .libedit').length > 0);
    ok('⑦ 思想列表有「新增条目」按钮',
      /openSchoolNew\(0\)/.test(w.document.body.innerHTML));
    w.__yzAnsTab = 'qa';
    w.openHub('answers');
    const ansHTML = w.document.getElementById('yzAnsWrap');
    ok('⑦ 答疑卡片有 ✏️', !!ansHTML && ansHTML.querySelectorAll('.libedit').length > 0);
    ok('⑦ 答疑页有「新增」按钮', /openAnswerNew\(\)/.test(w.document.body.innerHTML));

  } catch (e) {
    ok('未捕获异常', false, e && (e.stack || e.message));
  }

  let bad = 0;
  R.forEach(([c, n, x]) => {
    if (!c) bad++;
    console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? '   [' + x + ']' : ''));
  });
  console.log(`\n—— 史料四类编辑：失败 ${bad} / 断言 ${R.length}`);
  process.exit(bad ? 1 : 0);
});
