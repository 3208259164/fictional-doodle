const path=require('path'),fs=require('fs');
const {JSDOM,VirtualConsole}=require(path.join(__dirname,'node_modules','jsdom'));
const BASE = (process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (require('fs').existsSync(require('path').join(__dirname, '..', 'site', 'graph.html')) ? (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/' : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/')); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const IGN=m=>/scrollTo|Not implemented/.test(m||'');
function fakeCtx(){return new Proxy({},{get(t,p){if(p==='measureText')return ()=>({width:10});if(p==='createLinearGradient'||p==='createRadialGradient')return ()=>({addColorStop(){}});if(p==='canvas')return{width:1,height:1};if(typeof p==='string'&&/^(font|fillStyle|strokeStyle|lineWidth|globalAlpha|shadowBlur|shadowColor|textAlign|textBaseline|lineDashOffset|lineJoin|lineCap|miterLimit|globalCompositeOperation|filter)$/.test(p))return undefined;return function(){};},set(){return true;}});}
function inline(h){return h.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g,(m,s)=>{try{return '<script>'+fs.readFileSync(path.join(BASE,s),'utf8')+'</script>';}catch(e){return m;}});}
(async function(){
  const errs=[]; const vc=new VirtualConsole(); vc.on('jsdomError',e=>{const m=(e.detail?(e.detail.message||e.detail):e.message)||'';if(IGN(m))return;errs.push(m);});
  const dom=new JSDOM(inline(fs.readFileSync(BASE+'graph.html','utf8')),{url:'https://local.test/graph.html?g=wenge',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.HTMLCanvasElement.prototype.getContext=function(){return fakeCtx();};}});
  const w=dom.window,d=w.document; w.addEventListener('error',e=>{const m=(e.error&&e.error.stack||e.message)||'';if(IGN(m))return;errs.push(m);});
  await sleep(900);
  let fail=0; const ok=(n,c,x)=>{console.log((c?'  ✓ ':'  ✗ ')+n+(x?(' — '+x):''));if(!c)fail++;};
  ok('顶栏有 社区/时间轴/束线 按钮', !!d.getElementById('cb2')&&!!d.getElementById('cb3')&&!!d.getElementById('cb4'));
  w.toggleComm();
  const nComm=Math.max.apply(null,Object.values(w.comm||{x:-1}).concat([0]))+1;
  ok('社区检测已算出社区（≥2）', nComm>=2, nComm+' 个社区');
  ok('社区图例出现', !!d.getElementById('commLegend'));
  w.toggleYears();
  ok('时间轴滑块出现', !!(d.getElementById('yearbar')) && d.getElementById('yearbar').style.display==='flex');
  const all=(w.ns||[]).length; w.yearVal=1966; const y1966=(w.ns||[]).filter(o=>o.d.y0<=1966&&o.d.y1>=1966).length;
  ok('1966 年时少数节点不存在(如九一三)', y1966<all, y1966+'/'+all);
  w.yearVal=1971; const y1971=(w.ns||[]).filter(o=>o.d.y0<=1971&&o.d.y1>=1971).length;
  ok('拖到 1971 年成员变化', y1971!==y1966, '1966='+y1966+', 1971='+y1971);
  w.toggleBundle(); ok('束线开关生效', w.bundleOn===true);
  ok('增强功能无 JS 错误', errs.length===0, errs.join(' ; ').slice(0,160));
  console.log(fail===0?'\n★ Phase 5 增强：全部通过':('\n★ 失败 '+fail+' 项')); process.exit(fail===0?0:1);
})();
