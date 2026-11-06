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

  ok('底图数据 SITE_GEO 已加载', !!(w.SITE_GEO&&w.SITE_GEO.provinces&&w.SITE_GEO.provinces.length>=30), w.SITE_GEO&&w.SITE_GEO.provinces.length+' 省级');
  ok('节点已算出地理落点 o.gx/o.gy', (w.ns||[]).every(o=>typeof o.gx==='number'&&typeof o.gy==='number'));

  // 文革图谱为「地方」而作 → 默认地图；关闭地图才是关系网
  ok('文革图谱默认进入地图', w.viewMode==='geo');
  const vb=d.getElementById('vb');
  ok('地图开关默认已开（按钮显示「关系网」）', !!vb && vb.classList.contains('on') && /关系网/.test(vb.textContent), vb&&vb.textContent);

  w.toggleViewMode();
  ok('关闭地图 → 关系构图', w.viewMode==='net' && !vb.classList.contains('on'), vb.textContent);
  w.toggleViewMode();
  ok('可再切回地图视图并画底图', w.viewMode==='geo' && vb.classList.contains('on'));

  // 位置偏移修复：选中节点后，视图应以其“地理坐标”居中，而不是旧的力导向坐标
  const id=(w.GR.nodes[0]||{}).id, o=w.ix[id];
  w.select(id);
  const ex=w.W/2-w.WX(o)*w.view.k, ey=w.H/2-w.WY(o)*w.view.k;
  ok('选中后视图按地理坐标居中（修偏移）', Math.abs(w.view.x-ex)<0.6 && Math.abs(w.view.y-ey)<0.6,
     'view=('+w.view.x.toFixed(1)+','+w.view.y.toFixed(1)+') 期望=('+ex.toFixed(1)+','+ey.toFixed(1)+')');
  w.clearSel();

  // 底部控件面板可收起
  ok('底部面板含「收起」开关 #trFold', !!d.getElementById('trFold'));
  const tr=d.getElementById('tr');
  w.toggleTr();
  ok('点收起后面板折叠（#tr.folded）', tr.classList.contains('folded'));
  w.toggleTr();
  ok('再点可展开', !tr.classList.contains('folded'));

  ok('全程无 JS 错误', errs.length===0, errs.join(' ; ').slice(0,160));
  console.log(fail===0?'\n★ 合并视图 / 地图 / 收起面板：全部通过':('\n★ 失败 '+fail+' 项'));
  process.exit(fail===0?0:1);
})();
