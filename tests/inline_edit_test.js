#!/usr/bin/env node
/* 详情页内联编辑：书籍条目 —— jsdom 实测 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');

// 把 <script src> 全部内联，避开真实网络加载
html = html.replace(/<script([^>]*)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src, b) => {
  const f = path.join(SITE, src);
  if (!fs.existsSync(f)) return '';
  let code = fs.readFileSync(f, 'utf8');
  code = code.replace(/<\/script>/g, '<\\/script>');
  return `<script>${code}</script>`;
});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://local.test/',
  pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get: (t, k) => (k in t ? t[k] : () => ({})),
      set: (t, k, v) => { t[k] = v; return true; }
    });
    w.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    w.scrollTo = () => {};
    w.print = () => {};
  }
});

const w = dom.window;
const results = [];
const ok = (name, cond, extra) => { results.push([cond, name, extra]); };

setTimeout(() => {
  try {
    // ① 函数存在
    ok('openResEdit 已定义', typeof w.openResEdit === 'function');
    ok('closeResEdit 已定义', typeof w.closeResEdit === 'function');

    // ② 编辑开关关闭时不显示入口（行为层面：openResEdit 仍可调，但按钮不渲染）
    ok('YZY 覆盖层已加载', !!(w.YZY && w.YZY.editResource));

    // ③ 打开编辑开关
    w.YZY.setEditorEnabled(true);
    ok('编辑开关可开启', w.YZY.editorEnabled() === true);

    // ④ 打开一本真实书籍的编辑弹层
    const book = w.eval('RES[0]');
    w.openItemDetail(0);
    w.openResEdit(0);
    const box = w.document.getElementById('resEditor');
    ok('弹层 #resEditor 已出现', !!box);
    if (box) {
      const t = box.querySelector('#reTitle');
      const i = box.querySelector('#reIntro');
      ok('书名输入框有初值', !!t && t.value === String(book.title || ''));
      ok('介绍输入框有初值', !!i && i.value === String(book.intro || ''));

      // ⑤ 改介绍并保存
      const NEWTXT = '【测试】这段是内联编辑写入的介绍。';
      i.value = NEWTXT;
      const oldIntro = book.intro;
      const save = box.querySelector('[data-re="save"]');
      save.dispatchEvent(new w.Event('click', { bubbles: true }));

      // ⑥ 校验：覆盖层有记录
      const st = w.YZY.state();
      const id = book.id || book.title;
      ok('覆盖层 resources.edited 有该条', !!(st.resources && st.resources.edited && st.resources.edited[id]),
          id);
      ok('写入的 intro 与输入一致', st.resources.edited[id] && st.resources.edited[id].intro === NEWTXT);
      ok('弹层已关闭', !w.document.getElementById('resEditor'));

      // ⑦ 校验：内存中的 RES 已更新（reapply 生效）
      const after = w.eval(`RES.find(function(x){return (x.id||x.title)===${JSON.stringify(id)}})`) || w.eval('RES[0]');
      ok('页面数据已刷新为新的介绍', String(after.intro || '').indexOf('【测试】') >= 0,
          String(after.intro || '').slice(0, 24));

      // ⑧ 校验：旧内容确实被替换（不是追加）
      ok('旧介绍已被替换', String(after.intro || '') !== String(oldIntro || ''));
    }

    // ⑨ 空书名拒绝保存
    w.openResEdit(1);
    const box2 = w.document.getElementById('resEditor');
    if (box2) {
      box2.querySelector('#reTitle').value = '   ';
      const before = JSON.stringify(w.YZY.state().resources.edited);
      box2.querySelector('[data-re="save"]').dispatchEvent(new w.Event('click', { bubbles: true }));
      ok('空书名不写入', JSON.stringify(w.YZY.state().resources.edited) === before);
      w.closeResEdit();
    }
  } catch (e) {
    results.push([false, '运行异常: ' + e.message, e.stack && e.stack.split('\n')[1]]);
  }

  let pass = 0, fail = 0;
  for (const [c, n, ex] of results) {
    console.log(`  ${c ? '✓' : '✗'} ${n}${ex !== undefined ? '  → ' + ex : ''}`);
    c ? pass++ : fail++;
  }
  console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}, 1200);
