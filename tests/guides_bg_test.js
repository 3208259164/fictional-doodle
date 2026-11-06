/* 导读背景材料（sections[].bg）渲染回归：13 项。
   验证：内置 bg 渲染成可折叠块、未补的篇不受影响、
   空正文仍显示「还没写」、进度只统计用户自己填的。 */
const fs=require('fs'),path=require('path'),{JSDOM}=require(__dirname + '/node_modules/jsdom');
const SITE=(process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let html=fs.readFileSync(path.join(SITE,'index.html'),'utf8');
// 内联所有脚本
html=html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g,(m,src)=>{
  const p=path.join(SITE,src.split('?')[0]);
  try{return '<script>'+fs.readFileSync(p,'utf8')+'</script>';}catch(e){return '';}
});
const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://local.test/',pretendToBeVisual:true,
  beforeParse(w){
    w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:()=>()=>({})});
    w.scrollTo=()=>{}; w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  }});
const w=dom.window,d=w.document;
const { waitData } = require('./_lazy_hook')(w, SITE);   /* 导读数据是按需注入的 */
waitData(()=>{
  let fail=0;
  const t=(ok,m)=>{console.log((ok?'  ✓ ':'  ✗ ')+m);if(!ok)fail++;};
  t(!!w.YZStudy,'YZStudy 已加载');
  t(w.SITE_GUIDES.length===20,'导读 20 篇');
  const withBg=w.SITE_GUIDES.filter(g=>g.sections.some(s=>s.bg)).length;
  t(withBg===20,'20 篇导读全部有背景材料（实为 '+withBg+'）');

  w.YZStudy.openGuide('gd-manifesto');
  const clone=(d.getElementById('contentArea')||d.body).cloneNode(true);
  clone.querySelectorAll('script').forEach(function(x){x.remove();});
  const txt=clone.innerHTML;
  t(txt.indexOf('背景材料')>0,'导读页出现「背景材料」块');
  t(txt.indexOf('1847 年 6 月，正义者同盟在伦敦改组')>0,'  → 第 1 节背景材料已渲染');
  t(txt.indexOf('1888 年英文版恩格斯加了注')>0,'  → 第 4 节（难点）背景材料已渲染');
  t(txt.indexOf('待你想清楚')>0,'写作提示改文案生效');
  t(txt.indexOf('（这一节你还没写）')>0,'空正文提示正确（不冒充已填）');
  const nBg=(txt.match(/📎 背景材料/g)||[]).length;
  t(nBg===6,'6 个「📎 背景材料」块（实为 '+nBg+'）');
  t(txt.indexOf('· 已填')<0,'没有把内置材料误标成「已填」');

  // 未补背景的篇：不应出现 details，只有骨架
  /* 临时抽掉某一节的 bg，验证退化路径：该节只显示骨架与提示，不出现背景材料块 */
  var G=d.__G||w.SITE_GUIDES[0], keep=G.sections[5].bg;
  delete G.sections[5].bg;
  w.YZStudy.openGuide('gd-manifesto');
  const clone2=(d.getElementById('contentArea')||d.body).cloneNode(true);
  clone2.querySelectorAll('script').forEach(function(x){x.remove();});
  const t2=clone2.innerHTML;
  t(t2.indexOf('背景材料')>=0,'其余 5 节仍显示背景材料');
  t(t2.split('背景材料').length-1===5,'恰好 5 个块（被抽掉的那节不显示，实为 '+(t2.split('背景材料').length-1)+'）');
  t(t2.indexOf('六、与今天的对照')>0,'被抽掉的那节骨架仍在');
  G.sections[5].bg=keep;

  // 进度仍只统计用户自己写的
  const prog=w.document.getElementById('yzGProg');
  t(!!prog,'导读页有进度显示');
  console.log(fail?`\n失败 ${fail} 项`:'\n全部通过');
  process.exit(fail?1:0);
});
