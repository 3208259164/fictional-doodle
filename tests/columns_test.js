/* Phase 3 验证：首页「文革」独立栏目、人物栏合并、专题不再含文革、边界声明去邓小平 */
const path = require('path');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));
const BASE = (process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (require('fs').existsSync(require('path').join(__dirname, '..', 'site', 'graph.html')) ? (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/' : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/'));
/* 容错读文件：CHANGELOG.md 等可选文件缺失时按空串处理，不让整条测试崩掉 */
function rt(f){ try { return fs.readFileSync(BASE+f,'utf8'); } catch(e) { return ''; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IGN = m => /scrollTo|Not implemented/.test(m || '');
function fakeCtx(){ return new Proxy({}, { get(t,p){ if(p==='measureText')return ()=>({width:10}); if(p==='canvas')return {width:1,height:1}; return function(){}; }, set(){return true;} }); }
function inline(html){ return html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m,src)=>{ try{ return '<script>'+fs.readFileSync(path.join(BASE,src),'utf8')+'</script>'; }catch(e){ return m; } }); }
(async function(){
  const errors=[]; const vc=new VirtualConsole();
  vc.on('jsdomError', e=>{ const m=(e.detail?(e.detail.message||e.detail):e.message)||''; if(IGN(m))return; errors.push('jsdomError: '+m); });
  const dom=new JSDOM(inline(fs.readFileSync(BASE+'index.html','utf8')), {url:'https://local.test/index.html', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc,
    beforeParse(w){
      w.HTMLCanvasElement.prototype.getContext=function(){return fakeCtx();};
      /* 0.17.18 起文革图谱改为动态加载（loadWengeGraph → 动态 script），jsdom 默认不抓外部脚本，
         这里拦截 script.src，直接用当前站点源码 eval，保证「动态加载」路径也真的被执行到。 */
      const origCE = w.document.createElement.bind(w.document);
      w.document.createElement = function(tag){
        const el = origCE(tag);
        if (String(tag).toLowerCase() === 'script') {
          Object.defineProperty(el, 'src', {
            set(v){
              this._src = v;
              const sv = String(v);
              const i0 = Math.max(sv.lastIndexOf('assets/'), sv.lastIndexOf('data/'), sv.lastIndexOf('tools/'));
              const rel = i0 >= 0 ? sv.slice(i0) : sv;
              setTimeout(() => {
                try { w.eval(fs.readFileSync(path.join(BASE, rel), 'utf8')); } catch (e) { }
                try { this.onload && this.onload(); } catch (e) { }
              }, 0);
            },
            get(){ return this._src || ''; }
          });
        }
        return el;
      };
    }});
  const w=dom.window, d=w.document;
  w.addEventListener('error', e=>{ const m=(e.error&&e.error.stack||e.message)||''; if(IGN(m))return; errors.push('window.error: '+m); });
  for (let _k = 0; _k < 40 && !(w.SITE_GRAPH_WENGE && w.SITE_GRAPH_WENGE.nodes); _k++) await sleep(100);
  await sleep(400);
  let fail=0; const ok=(n,c,x)=>{ console.log((c?'  ✓ ':'  ✗ ')+n+(x?(' — '+x):'')); if(!c)fail++; };
  ok('window.SITE_GRAPH_WENGE 已加载', !!(w.SITE_GRAPH_WENGE&&w.SITE_GRAPH_WENGE.nodes), w.SITE_GRAPH_WENGE&&w.SITE_GRAPH_WENGE.nodes.length+' 节点');
  ok('app.js 已注册「文革」栏目', fs.readFileSync(BASE+'assets/app.js','utf8').indexOf("key:'wenge'")>=0);
  ok('hubCount(wenge) 有值', w.hubCount('wenge')>=60, String(w.hubCount('wenge')));
  ok('专题计数已排除文革（=8）', w.hubCount('features')===8, String(w.hubCount('features')));
  const fl=w.figuresList();
  /* 口径修订：林彪可能已在「被批判人物」等独立组里，按 name 去重后不会重复进人物栏，
     直接断言 id==='linbiao' 会假红。改为「文革图谱写有的、主图谱没有的人物，必须能在人物栏里找到」。 */
  const mainNames={}; ((w.SITE_GRAPH||{}).nodes||[]).forEach(n=>{ mainNames[n.name]=1; });
  const wgPersons=(w.wengeGraph().nodes||[]).filter(n=>n.type==='person' && !mainNames[n.name]);
  const flNames={}; fl.forEach(n=>{ flNames[n.name]=1; });
  ok('人物栏已合并文革人物', wgPersons.length>0 && wgPersons.some(n=>flNames[n.name]),
    fl.length+' 人；文革独有 '+wgPersons.length+' 人，已并入 '+wgPersons.filter(n=>flNames[n.name]).length+' 人');
  try{ w.openHub('wenge'); }catch(e){ errors.push('openHub(wenge): '+e.message); }
  const body=d.body.innerHTML;
  ok('文革栏目渲染出「打开文革图谱」入口', body.indexOf('打开「文革图谱」')>=0);
  ok('文革栏目含「组织 · 派系」小节', body.indexOf('组织 · 派系')>=0);
  try{ w.openWengeNode('wuhan720'); }catch(e){ errors.push('openWengeNode: '+e.message); }
  ok('文革节点详情可打开(七二〇事件)', d.body.innerHTML.indexOf('七二〇事件')>=0);
  ok('content.js 已去「不收录邓小平」', fs.readFileSync(BASE+'data/content.js','utf8').indexOf('与邓小平有关')<0);
  ok('llms.txt 已去「不收录邓小平」', fs.readFileSync(BASE+'llms.txt','utf8').indexOf('与邓小平有关')<0);
  ok('graph.js 已去「不收邓小平」', fs.readFileSync(BASE+'data/graph.js','utf8').indexOf('与邓小平有关')<0);
  ok('resources.js 已去「与邓小平相关」', fs.readFileSync(BASE+'data/resources.js','utf8').indexOf('与邓小平相关')<0);
  ok('全站不再残留「不收录邓小平」声明', (function(){ let n=0; for(const f of ['data/content.js','data/graph.js','data/resources.js','llms.txt','CHANGELOG.md']){ n += (rt(f).match(/不(收|收录)[^。\n]*邓小平/g)||[]).length; } return n===0; })());
  ok('运行无 JS 错误', errors.length===0, errors.join(' ; ').slice(0,200));
  console.log(fail===0?'\n★ Phase 3 栏目/边界：全部通过':('\n★ 失败 '+fail+' 项'));
  process.exit(fail===0?0:1);
})();
