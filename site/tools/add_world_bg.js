/* 给世界图谱仍缺 bg/impact 的事件补写（手写，事实性）。
   只补空字段，不覆盖已有内容；重复执行安全。 */
const fs=require('fs'),vm=require('vm');
const P='data/graph-world.js';
const src=fs.readFileSync(P,'utf8');
const ctx={window:{}};vm.createContext(ctx);
vm.runInContext(src,ctx);
const WO=ctx.window.SITE_GRAPH_WORLD;
const D=JSON.parse(fs.readFileSync('/tmp/world_bg.json','utf8'));
let n=0,miss=[];
WO.nodes.forEach(x=>{
  const d=D[x.id]; if(!d) return;
  if(!x.bg){x.bg=d.bg;n++;}
  if(!x.impact){x.impact=d.impact;n++;}
});
Object.keys(D).forEach(id=>{ if(!WO.nodes.some(x=>x.id===id)) miss.push(id); });
if(miss.length) console.error('⚠ 数据里没有这些 id：',miss.join(' '));
const cut=src.lastIndexOf('window.SITE_GRAPH_WORLD');
fs.writeFileSync(P, src.slice(0,cut)+'window.SITE_GRAPH_WORLD='+JSON.stringify(WO)+';\n');
const ev=WO.nodes.filter(x=>x.type==='event');
const chars=WO.nodes.reduce((a,x)=>a+((x.bg||'').length+(x.impact||'').length),0);
console.log('补充 '+n+' 个字段 | 事件 bg '+ev.filter(x=>x.bg).length+'/'+ev.length+' | impact '+ev.filter(x=>x.impact).length+'/'+ev.length);
console.log('事件 bg+impact 总字数：'+chars);
