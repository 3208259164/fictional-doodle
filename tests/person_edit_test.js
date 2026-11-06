#!/usr/bin/env node
/* 人物内联编辑 + 「改了看不到」bug 修复 —— jsdom 实测 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));

let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
  const f = path.join(SITE, src);
  if (!fs.existsSync(f)) return '';
  return `<script>${fs.readFileSync(f, 'utf8').replace(/<\/script>/g, '<\\/script>')}</script>`;
});

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : () => ({})), set: (t, k, v) => { t[k] = v; return true; }
    });
    w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    w.scrollTo = () => {};
  }
});
const w = dom.window;
const R = [];
const ok = (n, c, x) => R.push([c, n, x]);

const { waitData } = require('./_lazy_hook')(w, SITE);   /* 编辑/术语等数据按需注入，jsdom 要真加载 */
waitData(() => {
  try {
    w.YZY.setEditorEnabled(true);
    ok('openPersonEdit 已定义', typeof w.openPersonEdit === 'function');

    // ① 修 bug：editPerson 后图谱 desc 应同步
    const descBefore = w.eval('(allGraphNodes().find(n=>n.name==="卡尔·马克思")||{}).desc');
    w.YZY.editPerson('leaders', '卡尔·马克思', { intro: '【测试】人物介绍已更新' });
    w.YZY.reapply();
    const descAfter = w.eval('(allGraphNodes().find(n=>n.name==="卡尔·马克思")||{}).desc');
    ok('图谱节点 desc 已同步（bug 修好）', String(descAfter).indexOf('【测试】') >= 0,
       String(descAfter).slice(0, 22));
    ok('旧 desc 确实被替换', descAfter !== descBefore);

    // ② 幂等：再 reapply 两次，值不变（不漂移）
    w.YZY.reapply(); w.YZY.reapply();
    const desc3 = w.eval('(allGraphNodes().find(n=>n.name==="卡尔·马克思")||{}).desc');
    ok('重复 reapply 幂等（不漂移）', desc3 === descAfter, String(desc3).slice(0, 22));

    // ③ 人物详情页弹层
    const mid = w.eval('(allGraphNodes().find(n=>n.name==="卡尔·马克思")||{}).id');
    w.openPersonEdit(mid);
    const box = w.document.getElementById('personEditor');
    ok('弹层 #personEditor 已出现', !!box);
    if (box) {
      const ta = box.querySelector('#peIntro');
      ok('介绍框有初值', !!ta && String(ta.value).indexOf('【测试】') >= 0);
      ok('在人物库中的人有「保存」', !!box.querySelector('[data-pe="save"]'));

      // ④ 通过弹层再改一次
      ta.value = '【测试2】通过详情页保存的介绍';
      box.querySelector('[data-pe="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
      const d2 = w.eval('(allGraphNodes().find(n=>n.name==="卡尔·马克思")||{}).desc');
      ok('弹层保存后详情页数据更新', String(d2).indexOf('【测试2】') >= 0, String(d2).slice(0, 24));
      ok('保存后弹层关闭', !w.document.getElementById('personEditor'));
    }

    // ⑤ 不在人物库的人：应给提示、不给保存按钮
    const outsider = w.eval('(function(){var g=allGraphNodes().filter(n=>n.type==="person");for(var i=0;i<g.length;i++){var nm=g[i].name;if(!personGroupOf(nm))return g[i];}return null;})()');
    if (outsider) {
      w.openPersonEdit(outsider.id);
      const b2 = w.document.getElementById('personEditor');
      ok('未收录人物也能打开只读提示', !!b2, outsider.name);
      ok('未收录人物没有「保存」按钮', !!b2 && !b2.querySelector('[data-pe="save"]'));
      ok('未收录人物给出说明', !!b2 && /未收录|无处落脚/.test(b2.textContent));
      w.closePersonEdit();
    } else {
      ok('（无未收录人物可测）', true);
    }
  } catch (e) {
    R.push([false, '异常: ' + e.message, e.stack && e.stack.split('\n')[1]]);
  }
  let p = 0, f = 0;
  for (const [c, n, x] of R) { console.log(`  ${c ? '✓' : '✗'} ${n}${x !== undefined ? '  → ' + x : ''}`); c ? p++ : f++; }
  console.log(`\n结果：通过 ${p} 项，失败 ${f} 项`);
  process.exit(f ? 1 : 0);
});
