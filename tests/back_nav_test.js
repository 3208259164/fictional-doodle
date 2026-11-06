#!/usr/bin/env node
/* 返回层级：① 个人中心↔设置↔账号 逐级回退 ② 分类 → 搜索结果 → 返回回到分类 */
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
const vis = id => { const e = w.document.getElementById(id); return e ? e.style.display !== 'none' : false; };

setTimeout(() => {
  try {
    // ① 个人中心 → 设置 → 返回
    w.openPc();
    ok('个人中心可见', vis('pcView'));
    w.openSettings();
    ok('设置页可见', vis('settingsView') && !vis('pcView'));
    w.pageBack();
    ok('设置 → 返回：回到个人中心', vis('pcView') && !vis('settingsView'));

    // ② 个人中心 → 账号 → 返回
    w.openAccountView();
    ok('账号页可见', vis('accountView'));
    w.pageBack();
    ok('账号 → 返回：回到个人中心', vis('pcView') && !vis('accountView'));

    // ③ 个人中心再返回：关抽屉
    w.pageBack();
    const dr = w.document.getElementById('drawer');
    ok('个人中心再返回：抽屉关闭', !(dr && dr.classList.contains('open')));

    // ④ 内容页 → 设置 → 返回
    w.openItemDetail(0);
    const before = w.document.getElementById('contentView').innerHTML.slice(0, 40);
    w.openSettings();
    w.pageBack();
    ok('内容页 → 设置 → 返回：回到原内容页',
       w.document.getElementById('contentView').innerHTML.slice(0, 40) === before && vis('contentView'));

    // ⑤ 分类 → 点分类 → 返回
    w.openClassify();
    const cls = w.document.getElementById('contentView').innerHTML.slice(0, 60);
    w.homeCat('原著');
    w.eval('route()');
    ok('点分类后切到结果视图', !w.document.getElementById('view-results').hidden);
    w.pageBack();
    ok('结果 → 返回：回到分类页',
       w.document.getElementById('contentView').innerHTML.slice(0, 60) === cls && w.document.getElementById('view-results').hidden);
    w.pageBack();
    ok('分类页再返回：回主页', !w.document.getElementById('view-home').hidden);
  } catch (e) {
    R.push([false, '异常: ' + e.message, e.stack && e.stack.split('\n')[1]]);
  }
  let p=0,f=0;
  for (const [c,n,x] of R) { console.log(`  ${c?'✓':'✗'} ${n}${x!==undefined?'  → '+x:''}`); c?p++:f++; }
  console.log(`\n结果：通过 ${p} 项，失败 ${f} 项`);
  process.exit(f?1:0);
}, 1600);
