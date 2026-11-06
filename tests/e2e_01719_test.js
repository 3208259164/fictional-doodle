/* 学通 · 0.17.19 本轮改动的端到端验证
   覆盖：返回层级（分类→结果→返回分类）/ 相册保存 / 人物编辑新字段（年表·相关推荐·头像）
        / 本站收录收起与加书 / 关系工具键盘搜索 / 书籍相关推荐
   跑法：node tests/e2e_01719_test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/';
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✅ ' + n + (x ? '   ⟨' + x + '⟩' : '')); } else { fail++; console.log('  ❌ ' + n + (x ? '   ⟨' + x + '⟩' : '')); } }

let html = fs.readFileSync(SITE + 'index.html', 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  const p = path.join(SITE, src);
  if (!p.startsWith(SITE) || !fs.existsSync(p)) return '<!-- skip ' + src + ' -->';
  return '<script>' + fs.readFileSync(p, 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>';
});

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const m = String(e && e.message); if (!/Could not parse CSS|Not implemented/.test(m)) errs.push(m.slice(0, 140)); });

/* 记录保存桥调用 */
let savedCalls = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://appassets.androidplatform.net/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.AndroidApp = {
      saveBase64: function (name, b64, mime) { savedCalls.push({ name: name, b64: (b64 || '').slice(0, 20), mime: mime }); },
      toast: function () { }
    };
    w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/jpeg;base64,/9j/AAAA'; };
    w.HTMLCanvasElement.prototype.getContext = function () { return { fillRect() { }, fillStyle: '', drawImage() { } }; };
    /* XMLHttpRequest 桩：模拟取到一张图 */
    w.XMLHttpRequest = function () {
      this.open = function () { }; this.send = function () { const s = this; setTimeout(() => { s.status = 200; s.response = { size: 100, type: 'image/webp' }; s.onload && s.onload(); }, 0); };
    };
    w.FileReader = function () {
      this.readAsDataURL = function () { const s = this; setTimeout(() => { s.result = 'data:image/webp;base64,AAAA'; s.onload && s.onload(); }, 0); };
      this.readAsText = function () { const s = this; setTimeout(() => { s.result = ''; s.onload && s.onload(); }, 0); };
    };
  }
});
const w = dom.window;

setTimeout(async () => {
  console.log('===== 学通 0.17.19 · 本轮改动验证 =====');

  /* ---------- ① 返回层级：分类 → 分类列表 → 返回分类 ---------- */
  ok('① 定义了 window.__appBack（系统返回键的入口）', typeof w.__appBack === 'function');
  ok('① 分类行改用页内入栈（openCatPage），不再改 hash', (() => {
    const src = fs.readFileSync(SITE + 'assets/app.js', 'utf8');
    const m = /function classifyRowDefs\(\)[\s\S]{0,900}?return rows;/.exec(src);
    return !!m && m[0].indexOf('openCatPage') >= 0 && m[0].indexOf('homeCat(') < 0;
  })());
  try { w.openClassify(); } catch (e) { }
  const st1 = w.eval('_pageStack.length');
  ok('① 打开分类页后栈里有 1 条', st1 === 1, 'len=' + st1);
  try { w.openCatPage('歌曲'); } catch (e) { }
  const st2 = w.eval('_pageStack.length');
  ok('① 点「歌曲」后是入栈（栈变 2 条），不是切到首页结果视图', st2 === 2, 'len=' + st2);
  ok('① 结果视图没有被拉起来（不再是 hash 跳转）', w.eval("document.getElementById('view-results').hidden === true"));
  ok('① 当前页面标题是「歌曲」', w.eval("(_pageStack[_pageStack.length-1]||{}).title || ''").indexOf('歌曲') >= 0,
    w.eval("(_pageStack[_pageStack.length-1]||{}).title || ''"));
  ok('① 页面里列出了歌曲条目', (() => {
    const t = w.document.getElementById('contentView').textContent || '';
    return /共 \d+ 条/.test(t);
  })(), (w.document.getElementById('contentView').textContent || '').slice(0, 40));
  /* 顶栏 ← 返回 */
  try { w.pageBack(); } catch (e) { }
  ok('① 点 ← 回到分类页', w.eval("(_pageStack[_pageStack.length-1]||{}).title || ''").indexOf('分类') >= 0,
    w.eval("(_pageStack[_pageStack.length-1]||{}).title || ''"));
  /* 系统返回键 */
  try { w.openCatPage('影像'); } catch (e) { }
  const back1 = w.__appBack();
  ok('① 系统返回键被应用层接管（返回 true）', back1 === true);
  ok('① 系统返回键回到分类页', w.eval("(_pageStack[_pageStack.length-1]||{}).title || ''").indexOf('分类') >= 0,
    w.eval("(_pageStack[_pageStack.length-1]||{}).title || ''"));
  const back2 = w.__appBack();
  ok('① 分类页再返回 → 回主页', back2 === true && w.eval("document.getElementById('view-home').hidden === false"));

  /* ---------- ② 相册保存 ---------- */
  savedCalls = [];
  try { w.savePhoto(encodeURIComponent('images/leaders/marx.webp'), encodeURIComponent('马克思')); } catch (e) { errs.push('savePhoto ' + e.message); }
  await new Promise(r => setTimeout(r, 120));
  ok('② 相册「下载」走 App 保存桥（不是 <a download>）', savedCalls.length === 1, JSON.stringify(savedCalls[0] || {}));
  ok('② 文件名带 .webp 扩展名', savedCalls[0] && /\.webp$/.test(savedCalls[0].name), savedCalls[0] && savedCalls[0].name);
  ok('② mime 正确', savedCalls[0] && savedCalls[0].mime === 'image/webp', savedCalls[0] && savedCalls[0].mime);

  /* ---------- ③ 人物编辑：年表 / 相关推荐 / 头像 ---------- */
  ok('③ parseChrono 解析「年｜事件」', (() => {
    const a = w.parseChrono('1918｜发表《庶民的胜利》\n1919｜领导五四运动');
    return a.length === 2 && a[0].y === '1918' && a[0].t.indexOf('庶民') >= 0;
  })());
  ok('③ parseChrono 兼容只写事件的行', (() => {
    const a = w.parseChrono('一些没有年份的说明');
    return a.length === 1 && a[0].y === '' && a[0].t.indexOf('说明') >= 0;
  })());

  const before = JSON.stringify((w.SITE_EXTRA.timelines || {})['李大钊'] || null);
  let r3 = null;
  try {
    r3 = w.YZY.editPerson('comrades', '李大钊', {
      timelines: [{ y: '1918', t: '发表《庶民的胜利》《布尔什维主义的胜利》' }],
      worksTimeline: [{ y: '1919', t: '《我的马克思主义观》' }],
      related: ['共产党宣言'],
      works: '庶民的胜利 布尔什维主义的胜利'
    });
    w.YZY.reapply();
  } catch (e) { errs.push('editPerson ' + e.message); }
  ok('③ 保存年表成功', r3 && r3.ok !== false);
  const tl = (w.SITE_EXTRA.timelines || {})['李大钊'];
  ok('③ 生平年表写回 SITE_EXTRA 且能读到', Array.isArray(tl) && tl.length === 1 && tl[0].y === '1918', JSON.stringify(tl));
  const wtl = (w.SITE_EXTRA.worksTimeline || {})['李大钊'];
  ok('③ 著作年表写回 SITE_EXTRA', Array.isArray(wtl) && wtl[0].t.indexOf('我的马克思主义观') >= 0, JSON.stringify(wtl));
  ok('③ 年表能在人物页渲染出来', (() => {
    try { const h = w.timelineHTML('李大钊'); return /生平年表/.test(h) && /庶民的胜利/.test(h); } catch (e) { return false; }
  })());

  /* 相关推荐 → 本站收录 */
  const prList = w.personResources('李大钊');
  ok('③ 相关推荐的书进了「本站收录」', prList.some(x => x && x.title === '共产党宣言'), prList.length + ' 本');

  /* 头像（dataURL 通过净化） */
  let r4 = null;
  try { r4 = w.YZY.editPerson('comrades', '李大钊', { avatar: 'data:image/jpeg;base64,' + 'A'.repeat(200) }); w.YZY.reapply(); } catch (e) { }
  ok('③ 头像 dataURL 能保存', r4 && r4.ok !== false);
  ok('③ 头像写回人物对象', (() => {
    const p = (w.SITE_CONTENT.comrades || []).filter(x => x.name === '李大钊')[0];
    return p && /^data:image\/jpeg/.test(p.img || '');
  })());
  ok('③ 非法头像（外链 javascript:）被拒绝', (() => {
    const r = w.YZY.editPerson('comrades', '李大钊', { avatar: 'javascript:alert(1)' });
    const p = (w.SITE_CONTENT.comrades || []).filter(x => x.name === '李大钊')[0];
    return !p || !/javascript:/.test(p.img || '');
  })());

  /* ---------- ④ 本站收录：收起与加书 ---------- */
  try { w.openAuthor('李大钊'); } catch (e) { }
  const prsBtn = w.document.querySelector('[data-act="prsToggleNext"]');
  ok('④ 人物页有「收起」按钮', !!prsBtn);
  ok('④ 有「＋ 加书」按钮', !!w.document.querySelector('[data-act="openAddRelated"]'));
  const body = w.document.getElementById('yzPrsBody');
  ok('④ 收录区有内容', !!body && body.querySelectorAll('.lcard').length > 0, body ? body.querySelectorAll('.lcard').length + ' 条' : '');
  if (prsBtn) { try { w.eval('prsToggleNext(null, document.querySelector(\'[data-act="prsToggleNext"]\'))'); } catch (e) { } }
  ok('④ 点收起后按钮变成「展开」', prsBtn && /展开/.test(prsBtn.textContent || ''), prsBtn && prsBtn.textContent);
  ok('④ 收起后只显示前 3 条', (() => {
    const b = w.document.getElementById('yzPrsBody'); if (!b) return false;
    const rows = b.querySelectorAll('.lcard'); let shown = 0;
    for (const x of rows) if (x.style.display !== 'none') shown++;
    return rows.length > 3 ? shown === 3 : shown === rows.length;
  })());
  if (prsBtn) { try { w.eval('prsToggleNext(null, document.querySelector(\'[data-act="prsToggleNext"]\'))'); } catch (e) { } }
  ok('④ 再点一次恢复展开', prsBtn && /收起/.test(prsBtn.textContent || ''), prsBtn && prsBtn.textContent);

  /* 加书弹层 */
  try { w.openAddRelated('李大钊'); } catch (e) { errs.push('openAddRelated ' + e.message); }
  const arBox = w.document.getElementById('addRelBox');
  ok('④ 「＋ 加书」能打开选择弹层', !!arBox);
  ok('④ 弹层里有书目候选（可打字筛选）', !!arBox && arBox.querySelectorAll('[data-add]').length > 3,
    arBox ? arBox.querySelectorAll('[data-add]').length + ' 条' : '');
  ok('④ 弹层有筛选输入框', !!arBox && !!arBox.querySelector('#arQ'));

  /* ---------- ⑤ 书籍相关推荐 ---------- */
  let r5 = null;
  try {
    const it = w.eval('RES[0]');
    r5 = w.YZY.editResource(it.id || it.title, { related: ['资本论'] });
    w.YZY.reapply();
  } catch (e) { errs.push('editResource ' + e.message); }
  ok('⑤ 书籍能保存相关推荐', r5 && r5.ok !== false);
  ok('⑤ 相关推荐写回资源条目', w.eval('(RES[0].related||[]).indexOf("资本论")>=0'));
  ok('⑤ 书籍详情页渲染「相关推荐」', (() => {
    try { w.openItemDetail(0); const t = w.document.getElementById('contentView').textContent; return /相关推荐/.test(t); } catch (e) { return false; }
  })());

  /* ---------- ⑥ 未引入 JS 错误 ---------- */
  ok('⑥ 全程无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('------------------------------------------------------------------');
  console.log('  结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
}, 1600);
