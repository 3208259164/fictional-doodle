/* 跨图谱关系网（2026-11-14）
 *
 * 需求：人物/事件介绍页的关系网要能看到「其他图谱里与这个节点的关系」，点一下能跳过去。
 * 以前介绍页只有一句「在关系图谱中查看 →」，同一人物在文革/世界/新民图谱里的关系一条都不显示。
 *
 * 断言点：
 *   ① 介绍页出现「🕸 关系网」区块，且注明跨了几张图谱
 *   ② 至少两个图谱分组（主图谱 + 其他）
 *   ③ 关系条目标题带方向（→ / ←）和关系词
 *   ④ 点击能把当前页切到对方节点（而不是报「暂未收录」）
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

lazy.waitData(() => {
  console.log('===== 跨图谱关系网 =====');

  /* 五张图谱到齐后再渲染，否则只会统计到已加载的几张 */
  w.ensureAllGraphs(function () {
    /* openFigure 渲染到 #contentView（不是 #contentArea） */
    w.openFigure('mao', true);
    const view = d.getElementById('contentView');
    const txt = (view && view.textContent) || '';

    ok('介绍页出现「🕸 关系网」', txt.indexOf('关系网') >= 0, txt.length + ' 字');
    const m = txt.match(/跨\s*(\d+)\s*张图谱\s*·\s*共\s*(\d+)\s*条/);
    ok('统计到跨图谱的关系条数', !!m, m ? m[0] : '未匹配');
    ok('至少跨 2 张图谱（主图谱之外还有）', !!m && Number(m[1]) >= 2, m ? m[1] + ' 张' : '');

    const tags = Array.from(view.querySelectorAll('.tagrow .tag')).map(e => e.textContent.trim());
    const relTags = tags.filter(t => /^[→←]/.test(t));
    ok('给出了具体关系条目', relTags.length >= 5, relTags.slice(0, 3).join(' / '));
    ok('关系条目带方向', relTags.some(t => t.indexOf('→') === 0) || relTags.some(t => t.indexOf('←') === 0));

    /* 图谱分组标题（主图谱 / 文革图谱 / 世界图谱 …） */
    const heads = Array.from(view.querySelectorAll('div')).map(e => e.textContent || '')
      .filter(t => /^(主图谱|文革图谱|世界图谱|旧民图谱|新民图谱|思想源流图谱|西方马克思主义图谱|国际共运组织图谱)（\d+）/.test(t.trim()));
    ok('按图谱分组列出', heads.length >= 2, heads.map(t => t.trim().slice(0, 10)).join(' / '));

    /* 点第一条关系能跳过去 */
    const first = view.querySelector('.tagrow .tag[onclick]');
    ok('关系条目可点击', !!first, first ? first.getAttribute('onclick').slice(0, 40) : '无');
    if (first) {
      const before = (d.getElementById('contentView').textContent || '').slice(0, 40);
      try { first.click(); } catch (e) {}
      const after = (d.getElementById('contentView').textContent || '').slice(0, 40);
      ok('点击后页面切到对方条目', after !== before, before.replace(/\s+/g, ' ') + ' → ' + after.replace(/\s+/g, ' '));
    }

    ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 2).join(' / '));
    console.log('\n########## 断言 ' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
    process.exit(fail ? 1 : 0);
  });
});
