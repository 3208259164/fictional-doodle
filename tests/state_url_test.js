/**
 * 学通 ② 状态收束 + URL 化 —— 专项测试
 * 1. 带参数进入：状态恢复、输入框回填
 * 2. 切分类：URL 跟着变
 * 3. 搜索：URL 跟着变（防抖后）
 * 4. 回首页再进：状态保持
 * 5. 非法参数：不崩
 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');

const DIR = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

function boot(hash) {
  let html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
    const p = path.join(DIR, src);
    if (!fs.existsSync(p)) return '';
    return '<script>' + fs.readFileSync(p, 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>';
  });
  const errs = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test/' + (hash || ''),
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
      w.scrollTo = () => {};
    }
  });
  dom.window.addEventListener('error', e => errs.push(e.message));
  return { w: dom.window, d: dom.window.document, errs };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n[1] 带参数进入：状态恢复');
  {
    const { w, d, errs } = boot('#browse?q=%E7%9F%9B%E7%9B%BE&cat=%E5%8E%9F%E8%91%97&sort=new');
    await sleep(60);
    ok(d.getElementById('search').value === '矛盾', '搜索框回填「矛盾」（实为 ' + d.getElementById('search').value + '）');
    ok(w.S.cat === '原著', '分类恢复为「原著」（实为 ' + w.S.cat + '）');
    ok(d.getElementById('sortSel').value === 'new', '排序恢复为 new');
    ok(!d.getElementById('view-results').hidden, '处在结果页');
    ok(errs.length === 0, '无 JS 错误');
  }

  console.log('\n[2] 切分类：URL 跟着变');
  {
    const { w, d } = boot('#browse');
    await sleep(60);
    w.homeCat('原著');
    await sleep(320);
    ok(w.location.hash.indexOf('cat=') > 0, 'URL 含 cat=（实为 ' + w.location.hash + '）');
    ok(decodeURIComponent(w.location.hash).indexOf('原著') > 0, 'cat 值为「原著」');
  }

  console.log('\n[3] 搜索：URL 跟着变');
  {
    const { w, d } = boot('#browse');
    await sleep(60);
    d.getElementById('search').value = '实践论';
    w.render();
    await sleep(320);
    ok(w.location.hash.indexOf('q=') > 0, 'URL 含 q=（实为 ' + w.location.hash + '）');
    ok(decodeURIComponent(w.location.hash).indexOf('实践论') > 0, 'q 值为「实践论」');
  }

  console.log('\n[4] 回首页再进：状态保持（不被清空）');
  {
    const { w, d } = boot('#browse');
    await sleep(60);
    w.homeCat('导读');
    await sleep(320);
    const h1 = w.location.hash;
    w.goHome();
    await sleep(60);
    w.goResults();
    await sleep(320);
    ok(w.S.cat === '导读', '分类仍为「导读」（实为 ' + w.S.cat + '）');
    ok(w.location.hash.indexOf('cat=') > 0, 'URL 仍带 cat=（实为 ' + w.location.hash + '）');
  }

  console.log('\n[5] 异常参数：不崩');
  {
    const { w, errs } = boot('#browse?q=%E0%A4%A&cat=&tag=&sort=');
    await sleep(80);
    ok(errs.length === 0, '畸形编码不抛错（' + (errs[0] || '无') + '）');
    ok(typeof w.S === 'object', 'state 仍完好');
  }

  console.log('\n[6] 五个旧变量读写兼容');
  {
    const { w } = boot('#browse');
    await sleep(60);
    w.favOnly = true;
    ok(w.S.fav === true, 'favOnly=true → S.fav=true');
    ok(w.favOnly === true, '读回一致');
    w.activeTag = '矛盾论';
    ok(w.S.tag === '矛盾论', 'activeTag 写入 → S.tag');
    w.activeCat = '原著';
    ok(w.S.cat === '原著', 'activeCat 写入 → S.cat');
  }

  console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
  process.exit(fail ? 1 : 0);
})();
