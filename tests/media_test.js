/* 学通 0.18.26：音视频导入 / 播放 / 分享 */
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

const calls = [];
const dom = new JSDOM(html, {
  url: 'https://local.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true });
    w.scrollTo = () => {};
    w.requestIdleCallback = function () {};
    w.confirm = () => true;
    w.AndroidApp = {
      getVersionName: () => '0.18.26',
      mediaPick: () => calls.push(['pick']),
      mediaList: () => JSON.stringify([
        { name: '国际歌.mp3', size: 3145728, type: 'audio', url: 'https://appassets.androidplatform.net/_media/%E5%9B%BD%E9%99%85%E6%AD%8C.mp3', at: 1 },
        { name: '地道战.mp4', size: 104857600, type: 'video', url: 'https://appassets.androidplatform.net/_media/x.mp4', at: 2 }
      ]),
      mediaRemove: (n) => calls.push(['remove', n]),
      mediaShare: (n) => calls.push(['share', n])
    };
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
  await sleep(900);
  ok('YZMedia 已加载', typeof w.YZMedia === 'object' && !!w.YZMedia);
  ok('media.js 在 index.html 里', fs.readFileSync(BASE + 'index.html', 'utf8').indexOf('assets/media.js') > 0);
  ok('media.js 进了 sw 预缓存', fs.readFileSync(BASE + 'sw.js', 'utf8').indexOf('assets/media.js') > 0);

  /* 1. 列表渲染 */
  w.YZMedia.openLib();
  await sleep(80);
  const cv = d.getElementById('contentView');
  const h = cv ? cv.innerHTML : '';
  ok('音视频页能打开', !!cv && (h.indexOf('导入音频 / 视频') >= 0 || h.indexOf('音视频') >= 0));
  ok('列出声频条目', h.indexOf('国际歌.mp3') >= 0);
  ok('列出视频条目', h.indexOf('地道战.mp4') >= 0);
  ok('有导入按钮', h.indexOf('导入音频 / 视频') >= 0);
  ok('每条都有分享按钮', (h.match(/YZMedia\.share\(/g) || []).length >= 2, String((h.match(/YZMedia\.share\(/g) || []).length));
  ok('每条都有删除按钮', (h.match(/YZMedia\.remove\(/g) || []).length >= 2);
  ok('区分音频/视频标题', h.indexOf('🎵 音频') >= 0 && h.indexOf('🎬 视频') >= 0);
  ok('显示文件大小', /MB|KB/.test(h));

  /* 2. 导入会调桥 */
  calls.length = 0;
  w.YZMedia.pick();
  await sleep(60);
  ok('点导入会调用 mediaPick', calls.some(c => c[0] === 'pick'), JSON.stringify(calls));

  /* 3. 播放页 */
  w.YZMedia.play('国际歌.mp3');
  await sleep(80);
  const h2 = d.getElementById('contentView').innerHTML;
  ok('音频用 <audio controls>', /<audio[^>]*controls/i.test(h2), h2.slice(0, 120));
  ok('音频 src 指向 _media 路由', h2.indexOf('_media/') > 0);
  w.YZMedia.play('地道战.mp4');
  await sleep(80);
  const h3 = d.getElementById('contentView').innerHTML;
  ok('视频用 <video controls>', /<video[^>]*controls/i.test(h3));

  /* 4. 分享与删除 */
  calls.length = 0;
  w.YZMedia.share('国际歌.mp3');
  await sleep(40);
  ok('分享调用 mediaShare', calls.some(c => c[0] === 'share' && c[1] === '国际歌.mp3'), JSON.stringify(calls));
  calls.length = 0;
  w.YZMedia.remove('地道战.mp4');
  await sleep(80);
  ok('删除调用 mediaRemove', calls.some(c => c[0] === 'remove' && c[1] === '地道战.mp4'), JSON.stringify(calls));

  /* 5. 分类页入口 */
  if (typeof w.openCatPage === 'function') {
    w.openCatPage('歌曲');
    await sleep(80);
    const h4 = d.getElementById('contentView').innerHTML;
    ok('歌曲分类页有导入入口', h4.indexOf('YZMedia.pick()') >= 0);
    w.openCatPage('原著');
    await sleep(60);
    const h5 = d.getElementById('contentView').innerHTML;
    ok('非音视频分类不显示导入入口', h5.indexOf('YZMedia.pick()') < 0);
  }

  /* 6. 抽屉入口 */
  ok('书架有音视频入口（抽屉已合并为「我的文件」）',
     fs.readFileSync(BASE + 'assets/appbooks.js', 'utf8').indexOf('YZMedia.openLib()') > 0 &&
     fs.readFileSync(BASE + 'assets/app.js', 'utf8').indexOf("'我的文件'") > 0);

  /* 7. 无桥时给明确提示（浏览器） */
  const saved = w.AndroidApp;
  delete w.AndroidApp;
  w.YZMedia.openLib();
  await sleep(60);
  const h6 = d.getElementById('contentView').innerHTML;
  ok('没有桥时提示要在 App 内用', h6.indexOf('App 内') >= 0 || h6.indexOf('网页版') >= 0);
  w.AndroidApp = saved;

  ok('全程无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n===== 音视频导入 / 播放 / 分享 =====');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
  process.exit(0);
})();
