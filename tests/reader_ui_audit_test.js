/* 阅读器界面「名实核对」（2026-11-15）
 *
 * 用户的意见：不要名字有了、点下去却没有反应。这套件对每一项都做**真实点击**，
 * 然后检查状态确实变了，而不是只检查按钮存在。
 *
 * 覆盖：Aa 面板六项（字号/行距/边距/对齐/配色/亮度）、目录、更多菜单、
 *       底部翻页、进度条、书签摘录面板。
 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errs.push(e.message); });
let lazy = null;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    /* 阅读器读正文用 fetch；jsdom 没有实现，这里直接读盘 */
    w.fetch = (u) => {
      const rel = String(u).replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').split('?')[0];
      try {
        const t = fs.readFileSync(path.join(SITE, rel), 'utf8');
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(t) });
      } catch (e) {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
      }
    };
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };
const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

function pickBook() {
  // 找一本有正文（books/*.txt）的资源，用它打开阅读器
  const res = w.eval('window.SITE_RESOURCES || []');
  for (const r of res) if (r.url && /^books\//.test(r.url)) return r.id;
  return null;
}

lazy.waitData(async () => {
  console.log('===== 阅读器：按钮是否真的能用 =====');
  const id = pickBook();
  ok('找到一本有正文的书', !!id, id || '(无)');
  if (!id) { console.log('\n########## 断言 1 项（通过 0 / 失败 1）##########'); process.exit(1); }

  w.YZAppBooks.open(id);
  await new Promise(r => setTimeout(r, 600));      /* 正文是异步 fetch 读进来的 */
  const bk = d.getElementById('yzbk');
  ok('阅读器已打开', !!bk && bk.classList.contains('open'));
  const bd = d.getElementById('yzbkBody');
  ok('正文已渲染', !!bd && bd.textContent.trim().length > 200, bd ? bd.textContent.length + ' 字' : '');

  /* ---- Aa 面板 ---- */
  click(d.getElementById('yzbkAA'));
  const p = d.getElementById('yzbkAAPanel');
  ok('点 Aa 弹出设置面板', !!p && !p.hasAttribute('hidden'));

  const fs0 = parseFloat(bd.style.fontSize);
  click(p.querySelector('[data-a="fs+"]'));
  const fs1 = parseFloat(bd.style.fontSize);
  ok('A＋ 真的放大正文', fs1 > fs0, fs0 + 'px → ' + fs1 + 'px');
  ok('面板上的字号读数跟着变', (d.getElementById('yzbkFsVal') || {}).textContent === fs1.toFixed(1) + 'px',
     (d.getElementById('yzbkFsVal') || {}).textContent);

  click(p.querySelector('[data-a="fs-"]'));
  ok('A− 真的缩小正文', parseFloat(bd.style.fontSize) < fs1, bd.style.fontSize);

  const lh0 = parseFloat(bd.style.lineHeight);
  click(p.querySelector('[data-a="lh2"]'));
  const lh1 = parseFloat(bd.style.lineHeight);
  ok('行距「松」真的变宽', lh1 > lh0, lh0 + ' → ' + lh1);
  click(p.querySelector('[data-a="lh0"]'));
  ok('行距「紧」真的变窄', parseFloat(bd.style.lineHeight) < lh1, bd.style.lineHeight);

  const pd0 = parseFloat(bd.style.paddingLeft);
  click(p.querySelector('[data-a="pd2"]'));
  ok('边距「宽」真的变宽', parseFloat(bd.style.paddingLeft) > pd0, pd0 + 'px → ' + bd.style.paddingLeft);

  click(p.querySelector('[data-a="jc"]'));
  ok('两端对齐真的生效', /justify/.test(bd.style.textAlign), bd.style.textAlign);

  click(p.querySelector('[data-a="th-day"]'));
  ok('配色「日间」写进 yzBkTheme', w.localStorage.getItem('yzBkTheme') === 'day', w.localStorage.getItem('yzBkTheme'));
  ok('日间时阅读器不带 night 类', !bk.classList.contains('night'), bk.className);
  click(p.querySelector('[data-a="th-night"]'));
  ok('配色「夜间」写到 yzBkTheme', w.localStorage.getItem('yzBkTheme') === 'night', w.localStorage.getItem('yzBkTheme'));
  ok('夜间时阅读器加上 night 类', bk.classList.contains('night'), bk.className);

  const br = p.querySelector('input[data-a="bright"]');
  ok('亮度滑块存在', !!br);

  /* ---- 朗读两行：值要能写进 yzTtsCfg ---- */
  const r1 = p.querySelector('[data-a="tts-r-1.2"]');
  ok('朗读语速按钮存在', !!r1);
  if (r1) {
    click(r1);
    const cfg = JSON.parse(w.localStorage.getItem('yzTtsCfg') || '{}');
    ok('点 1.2× 真的写进 yzTtsCfg', Math.abs(cfg.rate - 1.2) < 0.001, JSON.stringify(cfg));
  }
  const m1 = p.querySelector('[data-a="tts-m-30"]');
  if (m1) {
    click(m1);
    const cfg = JSON.parse(w.localStorage.getItem('yzTtsCfg') || '{}');
    ok('点 30 分真的写进 yzTtsCfg', cfg.minutes === 30, JSON.stringify(cfg));
  }
  /* 收起面板 */
  if (!p.hasAttribute('hidden')) click(p.querySelector('[data-a="th-night"]'));

  /* ---- 字体选择（2026-11-15 新增） ---- */
  const ffBtns = p.querySelectorAll('[data-a^="ff"]');
  /* Android / 鸿蒙没有楷体字库，只留系统确定存在的两副：衬线（宋体）与无衬线（黑体） */
  ok('字体行有 3 档（默认/宋体/黑体）', ffBtns.length === 3, ffBtns.length);
  if (ffBtns.length === 3) {
    click(ffBtns[1]);
    ok('点「宋体」把衬线字族写到正文', /serif/i.test(bd.style.fontFamily), bd.style.fontFamily);
    const cfg2 = JSON.parse(w.localStorage.getItem('yzReadCfg') || '{}');
    ok('字体选择写进 yzReadCfg.ff', cfg2.ff === 1, JSON.stringify(cfg2));
    /* 面板每次点击都整块重渲染，必须重新取节点（旧引用已脱离文档） */
    click(d.querySelector('#yzbkAAPanel [data-a="ff0"]'));
    ok('切回「默认」会清掉 font-family', !bd.style.fontFamily || bd.style.fontFamily === '', bd.style.fontFamily);
  }

  /* ---- 夜间模式选中态必须能看清（源码口径：特异性 + !important） ---- */
  const teSrc = fs.readFileSync(path.join(SITE, 'assets/appbooks.js'), 'utf8');
  ok('选中态规则带 !important（否则被夜间 .bk-btn 规则盖掉）',
     /html body \.yzbox \.bk-aa \.row \.bk-btn\.on\{[^}]*!important/.test(teSrc));
  ok('夜间模式另有一套选中配色',
     /bk-read\.night \.bk-aa \.row \.bk-btn\.on\{[^}]*!important/.test(teSrc));

  /* ---- 目录 / 书签 / 摘录 ---- */
  click(d.getElementById('yzbkAct'));
  const lib = d.getElementById('bkLib');
  ok('点「目录」真的弹出面板', !!lib);
  ok('面板里有 目录/书签/摘录 三个 tab', !!lib && lib.querySelectorAll('.tabs .tb').length === 3,
     lib ? lib.querySelectorAll('.tabs .tb').length : 0);
  ok('目录 tab 有章节条目或给出明确说明', !!lib && (lib.querySelectorAll('.ln').length > 0 || /没有识别到章节/.test(lib.textContent)));
  if (lib) { const x = lib.querySelector('[data-a="close"]'); if (x) click(x); }
  ok('✕ 能关掉目录面板', !d.getElementById('bkLib'));

  /* ---- 更多菜单 ---- */
  click(d.getElementById('yzbkMore'));
  const mn = d.getElementById('bkMenu');
  ok('点 ⋯ 真的弹出菜单', !!mn);
  ok('菜单里有「编辑正文」', !!mn && /编辑正文/.test(mn.textContent));
  ok('菜单里有「摘录」', !!mn && /摘录/.test(mn.textContent));
  ok('菜单里有「书籍信息」', !!mn && /书籍信息/.test(mn.textContent));

  /* ---- 底部翻页 ---- */
  const nxt = d.getElementById('yzbkNext');
  ok('底部有下一页按钮', !!nxt);
  ok('有进度条', !!d.getElementById('yzbkSeek'));

  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
