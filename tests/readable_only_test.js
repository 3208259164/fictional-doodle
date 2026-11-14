/* 书库「只看可读」（2026-11-14）
   背景：书库 495 条里只有 43 条带站内正文，其余是书目索引。默认全量平铺时，
   点开一本书大概率是空的——目录越大，落空感越强。
   现在的口径：
     · 无搜索词 → 默认只列有正文的条目（readableOnly = true）
     · 有搜索词 → 不受限，搜全库（搜「有没有这本书」和「正文在哪」是两个需求）
     · 卡片状态位：有正文「📖 可读」，没有「📚 书目 · 正文可导入」
     · 空分类给出唯一出口（显示全部书目），不写「暂无内容」
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
    lazy = require('./_lazy_hook')(w, SITE);
  }
});
const w = dom.window, d = dom.window.document;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

/* 从渲染出的卡片里取 RES 下标（卡片 onclick="return cardAction(N)"） */
function cardIdxs() {
  return Array.from(d.querySelectorAll('#list .card')).map(el => {
    const m = (el.getAttribute('onclick') || '').match(/cardAction\((\d+)\)/);
    return m ? Number(m[1]) : -1;
  }).filter(i => i >= 0);
}

lazy.waitData(() => {
  console.log('===== 书库：只看可读 =====');
  const RES = w.RES || w.eval('RES');
  const hasBody = w.hasBody || w.eval('typeof hasBody === "function" ? hasBody : null');
  ok('RES 已加载', Array.isArray(RES) && RES.length > 0, RES ? RES.length + ' 条' : '无');

  const readable = RES.filter(r => hasBody(r));
  ok('可读条目数远小于总数（这就是要默认收起的原因）',
    readable.length > 0 && readable.length < RES.length,
    '可读 ' + readable.length + ' / 总 ' + RES.length);

  /* ---- 1. 默认状态 ---- */
  ok('默认只看可读（readableOnly 为真）', w.readableOnly === true);
  const chip = d.getElementById('readChip');
  ok('列表页有「仅看可读」开关', !!chip, chip ? chip.textContent.trim() : '未找到');
  ok('开关文案带可读条数', !!chip && /\d+/.test(chip.textContent), chip ? chip.textContent.trim() : '');

  /* ---- 2. 默认渲染：所有卡片都必须有正文 ---- */
  w.location.hash = '#browse';
  w.render();
  let idxs = cardIdxs();
  ok('默认渲染出了卡片', idxs.length > 0, idxs.length + ' 张');
  const badOnes = idxs.filter(i => !hasBody(RES[i])).map(i => RES[i].title);
  ok('默认视图里没有「无正文」的卡片', badOnes.length === 0,
    badOnes.length ? '混入了 ' + badOnes.slice(0, 3).join('、') : '');

  /* ---- 3. 关掉开关 → 书壳出现 ---- */
  w.toggleReadableOnly();
  w.render();
  const idxs2 = cardIdxs();
  const shellsShown = idxs2.filter(i => !hasBody(RES[i])).length;
  ok('关掉后能看到只有书目的条目', shellsShown > 0, '共 ' + idxs2.length + ' 张，其中书壳 ' + shellsShown);
  ok('关掉时自动切到「全部」分类（否则推荐区条目反而更少）',
    /全部/.test(d.getElementById('readChip').textContent), d.getElementById('readChip').textContent.trim());

  /* ---- 4. 搜索时不受限 ---- */
  const shell = RES.filter(r => !hasBody(r))[0];
  if (shell) {
    const kw = String(shell.title).replace(/[《》]/g, '').slice(0, 3);
    d.getElementById('search').value = kw;
    w.render();
    const hitTitles = Array.from(d.querySelectorAll('#list .card .title')).map(e => e.textContent);
    ok('搜索会搜到只有书目的条目（不被可读开关挡住）',
      hitTitles.some(t => t.indexOf(kw) >= 0), '词「' + kw + '」命中 ' + hitTitles.length + ' 条');
    d.getElementById('search').value = '';
    w.toggleReadableOnly();   /* 复位成只看可读 */
  } else {
    ok('搜索不受限（无书壳样本，跳过）', true);
  }

  /* ---- 5. 卡片状态文案 ---- */
  w.render();
  const metaTxt = Array.from(d.querySelectorAll('#list .card .meta')).map(e => e.textContent.trim()).join(' | ');
  ok('可读卡片带「📖 可读」', metaTxt.indexOf('📖 可读') >= 0, metaTxt.slice(0, 60));
  ok('不再出现「暂无原文」这种否定式文案', metaTxt.indexOf('暂无原文') < 0);

  /* ---- 6. 无脚本错误 ---- */
  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
});
