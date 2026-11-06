#!/usr/bin/env node
/* ① 未开启「自助编辑」时，书籍/人物详情页也要有 ✏️ ② 改过的内容能搜到、能导出 */
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

const { waitData } = require('./_lazy_hook')(w, SITE);   /* 编辑/术语等数据按需注入，jsdom 要真加载 */
waitData(() => {
  try {
    ok('自助编辑开关默认是关的', w.YZY.editorEnabled() === false);

    const qp = w.document.getElementById('qPlus');
    w.openItemDetail(0);
    ok('书籍详情页：顶栏按钮变成 ✏️', qp.textContent.indexOf('✏') >= 0, qp.textContent);
    ok('书籍详情页：按钮触发 openResEdit', qp.getAttribute('data-act') === 'openResEdit', qp.getAttribute('data-act'));

    const pid = w.eval('(allGraphNodes().find(n=>n.name==="卡尔·马克思")||{}).id');
    w.openFigure(pid);
    ok('人物详情页：顶栏按钮变成 ✏️', qp.textContent.indexOf('✏') >= 0, qp.textContent);
    ok('人物详情页：按钮触发 openPersonEdit', qp.getAttribute('data-act') === 'openPersonEdit', qp.getAttribute('data-act'));
    w.goHome();
    ok('回首页顶栏恢复为 ＋', qp.textContent === '＋' && qp.getAttribute('data-act') === 'togglePlus', qp.textContent);

    w.openResEdit(0);
    ok('未开开关也能打开书籍编辑弹层', !!w.document.getElementById('resEditor'));
    w.closeResEdit();
    w.openPersonEdit(pid);
    ok('未开开关也能打开人物编辑弹层', !!w.document.getElementById('personEditor'));
    w.closePersonEdit();

    const NEW = 'ZZTESTBOOKNAME';
    w.openResEdit(0);
    const box = w.document.getElementById('resEditor');
    box.querySelector('#reTitle').value = NEW;
    box.querySelector('#reIntro').value = '这是改过的介绍，用于验证搜索。';
    box.querySelector('[data-re="save"]').dispatchEvent(new w.Event('click', { bubbles:true }));

    const hit = w.eval(`(function(){var q=${JSON.stringify(NEW)}.toLowerCase();var n=0;
      RES.forEach(function(r){var t=((r.title||'')+' '+(r.alias||'')).toLowerCase();if(t.indexOf(q)>=0)n++;});return n;})()`);
    ok('改过的书名能被搜索命中', hit >= 1, '命中 ' + hit + ' 条');

    const hit2 = w.eval(`(function(){var q='验证搜索';var n=0;
      RES.forEach(function(r){if(String(r.intro||'').indexOf(q)>=0)n++;});return n;})()`);
    ok('改过的介绍能被搜索命中', hit2 >= 1, '命中 ' + hit2 + ' 条');

    const st = w.YZY.state();
    const id = w.eval('RES[0].id || RES[0].title');
    ok('覆盖层记录了这处改动', !!(st.resources.edited && st.resources.edited[id]));
    ok('导出 state 里能读到新书名', (st.resources.edited[id] || {}).title === NEW, (st.resources.edited[id]||{}).title);

    let json = '';
    try { json = JSON.stringify(st); } catch (e) { json = ''; }
    ok('覆盖层可序列化（能导出）', json.length > 100 && json.indexOf(NEW) >= 0, 'JSON ' + json.length + ' 字节');

    w.YZY.editPerson('leaders', '卡尔·马克思', { intro: 'PERSONEDIT' });
    const st2 = w.YZY.state();
    ok('人物改动也在导出范围内', JSON.stringify(st2).indexOf('PERSONEDIT') >= 0);
  } catch (e) {
    R.push([false, '异常: ' + e.message, e.stack && e.stack.split('\n')[1]]);
  }
  let p=0,f=0;
  for (const [c,n,x] of R) { console.log(`  ${c?'✓':'✗'} ${n}${x!==undefined?'  → '+x:''}`); c?p++:f++; }
  console.log(`\n结果：通过 ${p} 项，失败 ${f} 项`);
  process.exit(f?1:0);
});
