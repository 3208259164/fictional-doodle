#!/usr/bin/env node
/* 书籍章节/元信息编辑 + 「有简介不进图谱」的人物 —— jsdom 实测 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
  const f = path.join(SITE, src); if (!fs.existsSync(f)) return '';
  return `<script>${fs.readFileSync(f, 'utf8').replace(/<\/script>/g, '<\\/script>')}</script>`;
});
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t,k)=> k in t? t[k] : ()=>({}), set:(t,k,v)=>{t[k]=v;return true;} });
    w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    w.scrollTo = () => {};
  }});
const w = dom.window; const R = []; const ok = (n,c,x) => R.push([c,n,x]);

setTimeout(() => {
  try {
    w.YZY.setEditorEnabled(true);

    // ① 找一本「无产阶级文化大革命概述·简论」
    const idx = w.eval('RES.findIndex(function(x){return x.id==="wenge-gaishu-shuiluzhou"})');
    ok('目标书籍存在', idx >= 0, 'idx=' + idx);
    w.openItemDetail(idx);
    w.openResEdit(idx);
    const box = w.document.getElementById('resEditor');
    ok('弹层出现', !!box);
    ok('有章节目录输入框', !!box && !!box.querySelector('#reChapters'));
    ok('有出版社/出版年输入框', !!box && !!box.querySelector('#rePub') && !!box.querySelector('#reYear'));

    const chTa = box.querySelector('#reChapters');
    ok('章节目录有初值（读到了已有 chapters）',
       String(chTa.value).split('\n').length >= 4, '行数=' + String(chTa.value).split('\n').filter(Boolean).length);

    // ② 追加一章 + 改出版社，保存
    chTa.value = chTa.value + '\n测试章｜这是测试写入的章节说明';
    box.querySelector('#rePub').value = '测试出版社';
    box.querySelector('#reYear').value = '2026';
    box.querySelector('[data-re="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));

    const st = w.YZY.state();
    const ed = (st.resources.edited || {})['wenge-gaishu-shuiluzhou'] || {};
    ok('覆盖层保存了 chapters（不再被过滤）', Array.isArray(ed.chapters) && ed.chapters.length >= 5,
       'chapters=' + (ed.chapters ? ed.chapters.length : '无'));
    ok('新增章节内容正确', (ed.chapters || []).some(c => String(c.t).indexOf('测试章') >= 0));
    ok('出版社已保存', ed.publisher === '测试出版社', ed.publisher);
    ok('出版年已保存', ed.pubyear === '2026', ed.pubyear);

    // ③ 页面数据同步
    const after = w.eval('RES.find(function(x){return x.id==="wenge-gaishu-shuiluzhou"})');
    ok('页面 chapters 已更新', ((after.chapters || []).some(c => String(c.t).indexOf('测试章') >= 0)));
    ok('页面 publisher 已更新', after.publisher === '测试出版社', after.publisher);

    // ④ 详情页重新渲染后能看到新章节
    w.openItemDetail(idx);
    const pageHtml = w.document.body.innerHTML;
    ok('详情页出现新章节标题', pageHtml.indexOf('测试章') >= 0);

    // ⑤ 「有简介但不进图谱」：往人物库加人，不建图谱节点
    const N = '测试·张三';
    const before = w.eval('allGraphNodes().filter(function(n){return n.name==="' + N + '"}).length');
    const r = w.YZY.addPerson({ name: N, group: 'comrades', years: '1900—1980', role: '测试身份', intro: '这是只进人物库、不进图谱的一份简介。' });
    ok('addPerson 成功', !!(r && r.ok), r && r.msg);
    w.YZY.reapply();
    const inGraph = w.eval('allGraphNodes().filter(function(n){return n.name==="' + N + '"}).length');
    const inLib = w.eval('comrades.filter(function(p){return p.name==="' + N + '"}).length');
    ok('没有进图谱（图谱节点数不增）', inGraph === before, '图谱内=' + inGraph);
    ok('进了人物库', inLib === 1, '人物库内=' + inLib);

    // ⑥ 人物库详情能显示这份简介
    w.openAuthor(N);
    ok('openAuthor 能显示简介', w.document.body.innerHTML.indexOf('只进人物库、不进图谱') >= 0);

    // ⑦ 详情页也能编辑这个人（在人物库所以可编辑）
    const g = w.eval('personGroupOf("' + N + '")');
    ok('personGroupOf 能识别分组', g === 'comrades', String(g));
  } catch (e) {
    R.push([false, '异常: ' + e.message, e.stack && e.stack.split('\n')[1]]);
  }
  let p = 0, f = 0;
  for (const [c,n,x] of R) { console.log(`  ${c?'✓':'✗'} ${n}${x!==undefined?'  → '+x:''}`); c?p++:f++; }
  console.log(`\n结果：通过 ${p} 项，失败 ${f} 项`);
  process.exit(f?1:0);
}, 1400);
