/* 复用：世界图谱事件节点 ← EXTRA.events 已有的 bg / impact
   两者内容同源（同一批历史事件），只按名称归一化匹配，不新造内容。
   只补 bg/impact，不动 points/desc。重复执行安全。 */
const fs=require('fs'),vm=require('vm');
const P='data/graph-world.js';
const src=fs.readFileSync(P,'utf8');
const ctx={window:{}};vm.createContext(ctx);
for(const f of fs.readdirSync('data').filter(x=>x.endsWith('.js'))){
  try{vm.runInContext(fs.readFileSync('data/'+f,'utf8'),ctx,{filename:f});}catch(e){}
}
const E=ctx.window.SITE_EXTRA.events;
const WO=ctx.window.SITE_GRAPH_WORLD;
const norm=s=>String(s||'').replace(/[《》「」“”"'·\s（）()、,，.。:：]/g,'');
let n=0;
(WO.nodes||[]).forEach(x=>{
  if(x.type!=='event'||x.bg||x.impact) return;
  const a=norm(x.name);
  const m=E.find(e=>norm(e.name)===a) || E.find(e=>norm(e.name).indexOf(a)>=0 || a.indexOf(norm(e.name))>=0);
  if(!m) return;
  if(m.bg) x.bg=m.bg;
  if(m.impact) x.impact=m.impact;
  x.bgFrom='EXTRA.events'; n++;
});
const cut=src.lastIndexOf('window.SITE_GRAPH_WORLD');
fs.writeFileSync(P, src.slice(0,cut)+'window.SITE_GRAPH_WORLD='+JSON.stringify(WO)+';\n');
const ev=(WO.nodes||[]).filter(x=>x.type==='event');
console.log('复用 '+n+' 个 | 现有 bg '+ev.filter(x=>x.bg).length+'/'+ev.length+' | impact '+ev.filter(x=>x.impact).length+'/'+ev.length);
