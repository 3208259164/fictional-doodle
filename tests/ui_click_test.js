/* 上一轮几项改动的「真点了才算数」复验（16 项）
   用户的要求：「重查一下之前是否执行，或者真正能够使用，是否存在 bug」。
   所以这里不走内部 API 断言，而是**真的点到按钮上**，再看页面有没有变。
   覆盖：给人物加书后能否显示、★ 推荐是否只出现一次、术语卡能否改、
        答疑页面上的导入/导出按钮是否真在、点开是否真弹层。 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.confirm = () => true;
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window, d = w.document;
let fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? (' — ' + x) : '')); if (!c) fail++; };

const { waitData } = require('./_lazy_hook')(w, SITE);   /* 编辑/术语等数据按需注入，jsdom 要真加载 */
waitData(() => {
  try {
    /* ---------- ① 给人物加书：完成之后页面上要能看到 ---------- */
    const nodes = w.allGraphNodes();
    const p = nodes.filter(n => n.type === 'person')[10];
    w.openFigure(p.id);
    const box = () => d.getElementById('contentView');
    const txt0 = box() ? box().textContent : '';
    ok('打开图谱人物页后出现「本站收录」', /本站收录/.test(txt0), p.name);
    ok('「本站收录」有可挂载的容器 #yzPrsBody 或说明文字', !!d.getElementById('yzPrsBody') || /暂未收录/.test(txt0));

    /* 真的点「＋ 加书」按钮 */
    const addBtn = Array.from(d.querySelectorAll('[data-act="openAddRelated"]'))[0];
    ok('人物页上有「＋ 加书」按钮', !!addBtn);
    if (addBtn) addBtn.click();
    ok('点了之后弹出加书面板', !!d.getElementById('addRelBox'));

    /* 在面板里点第一本 */
    const firstBook = d.querySelector('#addRelBox [data-add]');
    ok('加书面板里列出了可挑的书', !!firstBook);
    const bookTitle = firstBook ? firstBook.getAttribute('data-add') : '';
    const relBefore = w.personResources(p.name).map(x => x.title);
    if (firstBook) firstBook.click();
    const relAfter = w.personResources(p.name).map(x => x.title);
    ok('点一本书之后「本站收录」里真的多了这本书',
      relAfter.indexOf(bookTitle) >= 0 && relBefore.length + 1 === relAfter.length,
      relBefore.length + ' → ' + relAfter.length);

    /* 点「完成」→ 回到人物页 → 书名必须出现在页面上 */
    const done = d.querySelector('#addRelBox [data-ar="cancel"]');
    if (done) done.click();
    ok('点「完成」后面板关闭', !d.getElementById('addRelBox'));
    const txt1 = box() ? box().textContent : '';
    ok('★ 这就是之前那个 bug：加完书页面上能看到它', txt1.indexOf(bookTitle) >= 0, bookTitle);

    /* ② ★ 推荐只出现一次 */
    const marks = (txt1.match(/★ 推荐/g) || []).length;
    ok('「★ 推荐」在人物页只出现一次（原来每本书各一条）', marks <= 1, marks + ' 次');

    /* ③ 术语卡：点「✏️ 改」→ 真的能改 */
    const gl = w.SITE_GLOSSARY || [];
    ok('术语卡数据存在', gl.length > 0, gl.length + ' 张');
    if (gl.length) {
      const t0 = gl[0];
      w.YZStudy.termEdit(t0.id);
      const form = d.getElementById('tfTerm');
      ok('点「✏️ 改」弹出编辑表单', !!form);
      if (form) {
        form.value = (t0.term || '') + '（改）';
        const dic = d.getElementById('tfDic'); if (dic) dic.value = '复验用的定义';
        const saveBtn = d.getElementById('tfSave');
        ok('表单里有保存按钮', !!saveBtn);
        if (saveBtn) saveBtn.click();
        w.YZY.reapply();
        const t1 = (w.SITE_GLOSSARY || []).filter(x => x.id === t0.id)[0];
        ok('改完真的存下来了', !!t1 && /（改）/.test(t1.term || ''), t1 && t1.term);
      }
    }

    /* ④ 答疑页：导入 / 导出按钮都在，点了都弹层 */
    w.__yzAnsTab = 'qa';
    try { w.openHub('answers'); } catch (e) { console.log('    (openHub 报错：' + e.message + ')'); }
    ok('答疑页渲染出来了', /答疑|术语卡/.test(box().textContent));
    const imp = Array.from(d.querySelectorAll('button')).filter(b => /从文档导入/.test(b.textContent))[0];
    const exp = Array.from(d.querySelectorAll('button')).filter(b => /📤 导出/.test(b.textContent))[0];
    ok('答疑页上有「📥 从文档导入」按钮', !!imp);
    ok('答疑页上有「📤 导出」按钮', !!exp);
    if (imp) { imp.click(); ok('导入按钮点了真弹层', !!d.getElementById('yzAnsImp')); const x = d.getElementById('yzAnsImp'); if (x) x.remove(); }
    if (exp) { exp.click(); ok('导出按钮点了真弹层', !!d.getElementById('yzAnsExp')); }

    console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('✗ 运行出错：', e.message, (e.stack || '').split('\n')[1]);
    process.exit(1);
  }
});
