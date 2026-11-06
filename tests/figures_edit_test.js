#!/usr/bin/env node
/* 「其他人物」83 人可编辑 —— jsdom 实测 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
  const f = path.join(SITE, src); if (!fs.existsSync(f)) return '';
  return `<script>${fs.readFileSync(f, 'utf8').replace(/<\/script>/g, '<\\/script>')}</script>`;
});
const dom = new JSDOM(html, { runScripts:'dangerously', url:'https://local.test/', pretendToBeVisual:true,
  beforeParse(w){
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get:(t,k)=> k in t? t[k] : ()=>({}), set:(t,k,v)=>{t[k]=v;return true;} });
    w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    w.scrollTo = () => {};
  }});
const w = dom.window; const R = []; const ok = (n,c,x) => R.push([c,n,x]);

setTimeout(() => {
  try {
    w.YZY.setEditorEnabled(true);

    // ① 规模
    const nFig = w.eval('(CT.figures||[]).length');
    const nList = w.eval('figuresList().length');
    ok('人物库 figures 组 83 条', nFig === 83, 'figures=' + nFig);
    ok('figuresList 与人物库数量一致', nList === 83, 'list=' + nList);

    // ② 抽查三个典型人物的分组识别
    ['刘少奇','邓小平','聂元梓','许世友','老舍'].forEach(function(nm){
      const g = w.eval('personGroupOf(' + JSON.stringify(nm) + ')');
      ok('可识别分组：' + nm, g === 'figures', String(g));
    });

    // ③ 详情页能打开 + 弹层可编辑
    const target = '刘少奇';
    const node = w.eval('figuresList().find(function(p){return p.name===' + JSON.stringify(target) + '})');
    ok('figuresList 里能取到 ' + target, !!node, node && node.id);
    w.openFigure(node.id);
    w.openPersonEdit(node.id);
    const box = w.document.getElementById('personEditor');
    ok('弹层出现', !!box);
    if (box) {
      ok('有「保存」按钮（说明已认定可编辑）', !!box.querySelector('[data-pe="save"]'));
      const ta = box.querySelector('#peIntro');
      ok('介绍框带出图谱原文', !!ta && String(ta.value).length > 10, String(ta.value).slice(0, 24));

      // ④ 保存并校验同步到图谱
      ta.value = '【测试】其他人物组的编辑';
      box.querySelector('[data-pe="save"]').dispatchEvent(new w.Event('click', { bubbles:true }));
      const st = w.YZY.state();
      const key = 'figures|' + target;
      ok('覆盖层 people.edited 有该条', !!(st.people.edited && st.people.edited[key]), key);
      const desc = w.eval('(allGraphNodes().find(function(n){return n.name===' + JSON.stringify(target) + '})||{}).desc');
      ok('图谱 desc 已同步', String(desc).indexOf('【测试】') >= 0, String(desc).slice(0, 20));

      // ⑤ 幂等
      w.YZY.reapply(); w.YZY.reapply();
      const d2 = w.eval('(allGraphNodes().find(function(n){return n.name===' + JSON.stringify(target) + '})||{}).desc');
      ok('重复 reapply 不漂移', d2 === desc);
    }

    // ⑥ 其他三组不受影响
    ok('革命导师仍 5 人', w.eval('leaders.length') === 5);
    ok('革命同志仍 51 人', w.eval('comrades.length') === 51);
    ok('被批判人物仍 15 人', w.eval('(EX.critics||[]).length') === 15);
  } catch (e) {
    R.push([false, '异常: ' + e.message, e.stack && e.stack.split('\n')[1]]);
  }
  let p=0,f=0;
  for (const [c,n,x] of R) { console.log(`  ${c?'✓':'✗'} ${n}${x!==undefined?'  → '+x:''}`); c?p++:f++; }
  console.log(`\n结果：通过 ${p} 项，失败 ${f} 项`);
  process.exit(f?1:0);
}, 1400);
