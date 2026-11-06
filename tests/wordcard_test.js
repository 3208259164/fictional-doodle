/* 学通 0.18.27：词条卡片 / 摘录人名可点 / 诊断复制 / 导入入口合并 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');
const BASE = (process.env.YZY_SITE || (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'))).replace(/\/?$/, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const bad = [];
function ok(n, c, x) { if (c) pass++; else { fail++; bad.push(n + (x ? ' — ' + x : '')); } }

const vc = new VirtualConsole(); const errs = [];
vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (!/Could not load|Not implemented|CSS|execCommand|Not allowed/.test(m)) errs.push(m); });
let html = fs.readFileSync(BASE + 'index.html', 'utf8');
html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
  try { return '<script>' + fs.readFileSync(BASE + src, 'utf8') + '</' + 'script>'; } catch (e) { return ''; }
});

const dom = new JSDOM(html, {
  url: 'https://local.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true });
    w.scrollTo = () => {};
    w.confirm = () => true;
    w.AndroidApp = { getVersionName: () => '0.18.27' };
    const orig = w.document.createElement.bind(w.document);
    w.document.createElement = function (tag) {
      const el = orig(tag);
      if (String(tag).toLowerCase() === 'script') {
        let _s = '';
        try {
          Object.defineProperty(el, 'src', {
            configurable: true, get() { return _s; },
            set(v) {
              _s = v;
              setTimeout(() => {
                try {
                  const rel = String(v).replace(/^https?:\/\/[^/]+\//, '').split('?')[0].replace(/^\.?\//, '');
                  w.eval(fs.readFileSync(BASE + rel, 'utf8'));
                  if (typeof el.onload === 'function') el.onload();
                } catch (e) { if (typeof el.onerror === 'function') el.onerror(e); }
              }, 0);
            }
          });
        } catch (e) {}
      }
      return el;
    };
  }
});
const w = dom.window, d = w.document;

(async function () {
  await sleep(2800);

  ok('YZWordCard 已加载', typeof w.YZWordCard === 'object' && !!w.YZWordCard);
  ok('wordcard.js 在 index.html', fs.readFileSync(BASE + 'index.html', 'utf8').indexOf('assets/wordcard.js') > 0);

  /* 1. 名字表 */
  const ns = w.YZWordCard.names();
  ok('名字表非空', ns.length > 20, ns.length + ' 个');
  ok('长名字排在前面', ns[0].length >= ns[ns.length - 1].length);

  /* 2. linkify */
  const h = w.YZWordCard.linkify('马克思和恩格斯写了共产党宣言，列宁接着做。');
  ok('人名被包成可点元素', h.indexOf('data-w="马克思"') > 0, h.slice(0, 120));
  ok('恩格斯也识别', h.indexOf('data-w="恩格斯"') > 0);
  ok('普通文字不被误包', h.indexOf('data-w="写了"') < 0);
  ok('HTML 被转义（无注入）', w.YZWordCard.linkify('<script>x</script>').indexOf('<script>') < 0);

  /* 3. 点名字 → 弹卡片 */
  w.YZWordCard.open('马克思');
  await sleep(60);
  const card = Array.from(d.body.children).filter(e => e.style && e.style.cssText.indexOf('100065') >= 0)[0];
  ok('弹出人物卡片', !!card);
  if (card) {
    ok('卡片显示名字', card.innerHTML.indexOf('马克思') > 0);
    ok('卡片有「看完整条目」', card.innerHTML.indexOf('看完整条目') > 0);
    ok('卡片有角色标签', card.innerHTML.indexOf('人物') > 0);
    ok('卡片能关闭', card.innerHTML.indexOf('关闭') > 0);
  }
  w.YZWordCard.close();
  await sleep(40);

  /* 4. 摘录里人名可点（源码层校验） */
  const mineSrc = fs.readFileSync(BASE + 'assets/mine.js', 'utf8');
  ok('摘录用了 linkify', mineSrc.indexOf('YZWordCard.linkify') > 0);
  ok('摘录批注也 linkify', (mineSrc.match(/YZWordCard\.linkify/g) || []).length >= 2);

  /* 5. 诊断报告有「复制全部」 */
  const cite = fs.readFileSync(BASE + 'assets/cite.js', 'utf8');
  ok('preview 有复制按钮', cite.indexOf('复制文字') > 0 || cite.indexOf('📋 复制全部') > 0);
  ok('诊断有「用其他应用打开」', cite.indexOf('用其他应用打开') > 0);
  ok('诊断有「分享到」', cite.indexOf('分享到…') > 0);
  ok('YZSave.copy 已暴露', cite.indexOf('copy: copyText') > 0);
  ok('复制失败有兜底提示', cite.indexOf('长按选中') > 0 || cite.indexOf('长按文字选中') > 0);

  /* 6. 抽屉入口合并 */
  const appSrc = fs.readFileSync(BASE + 'assets/app.js', 'utf8');
  ok('抽屉是「我的文件」', appSrc.indexOf("'我的文件'") > 0);
  ok('抽屉不再单列「音视频」', appSrc.indexOf("pcRow('🎵','音视频'") < 0);

  /* 7. 书架一个入口收全部 */
  const abSrc = fs.readFileSync(BASE + 'assets/appbooks.js', 'utf8');
  ok('导入按钮文案已合并', abSrc.indexOf('＋ 导入（书 / 音视频）') > 0);
  ok('书架有音视频入口', abSrc.indexOf('YZMedia.openLib()') > 0);
  ok('导入结果统计音视频', abSrc.indexOf("x.kind === 'media'") > 0);

  /* 8. Java 侧白名单收音频视频 */
  const _p = require('path');
  const _mainAct = ['app', 'apk_new']
    .map(n => _p.join(__dirname, '..', n, 'java', 'com', 'yuanziyuan', 'app', 'MainActivity.java'))
    .find(x => fs.existsSync(x));
  const java = fs.readFileSync(_mainAct, 'utf8');
  ok('Java 白名单含音频', java.indexOf('isAudioName(lower)') > 0);
  ok('Java 导入分流 media', java.indexOf('"kind":"media"') > 0 || java.indexOf('\\"kind\\":\\"media\\"') > 0);
  ok('Java 文件选择器含 audio/*', java.indexOf('"audio/*"') > 0);

  ok('全程无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n===== 词条卡片 / 摘录可点 / 诊断复制 / 入口合并 =====');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
  process.exit(0);
})();
