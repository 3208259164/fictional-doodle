/**
 * 学通 ③ 事件委托 —— 专项测试
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
  console.log('\n[1] 结构：不再有可迁移的 onclick');
  {
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    const oc = (html.match(/onclick="/g) || []).length;
    const da = (html.match(/data-act="/g) || []).length;
    ok(oc === 3, '残留 onclick 仅 3 处复合语句（实为 ' + oc + '）');
    ok(da >= 43, 'data-act 至少 43 处（实为 ' + da + '）');
  }

  console.log('\n[2] 点击底栏「首页」');
  {
    const { w, d, errs } = boot('#browse');
    await sleep(80);
    const btn = Array.from(d.querySelectorAll('.tabbar button')).find(b => b.getAttribute('data-act') === 'tabTo');
    ok(!!btn, '底栏按钮已转为 data-act');
    ok(btn.getAttribute('data-arg') === 'home', '参数为 home');
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(60);
    ok(errs.length === 0, '点击无 JS 错误（' + (errs[0] || '无') + '）');
    ok(d.getElementById('view-results').hidden === true, '已切回首页');
  }

  console.log('\n[3] 委托全局函数（不在 ACTIONS 表里也能用）');
  {
    const { w, d } = boot('#browse');
    await sleep(80);
    let hit = 0;
    w.tabTo = function(k){ hit = k; };
    const btn = Array.from(d.querySelectorAll('[data-act="tabTo"]'))[0];
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    ok(hit === 'home', '未注册的全局函数被委托调用（实参 ' + hit + '）');
  }

  console.log('\n[4] ACTIONS 表优先于全局同名');
  {
    const { w, d } = boot('#browse');
    await sleep(80);
    let which = '';
    w.yzAct('backToTop', function(){ which = 'actions'; });
    const btn = d.getElementById('toTop');
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    ok(which === 'actions', 'ACTIONS 表优先生效（实为 ' + which + '）');
  }

  console.log('\n[5] 键盘可达');
  {
    const { w, d } = boot('#browse');
    await sleep(80);
    let n = 0;
    w.yzAct('backToTop', function(){ n++; });
    const btn = d.getElementById('toTop');
    btn.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(30);
    ok(n === 1, 'Enter 触发（实为 ' + n + ' 次）');
  }

  console.log('\n[6] 未知 action 不抛错');
  {
    const { w, d, errs } = boot('#browse');
    await sleep(80);
    const el = d.createElement('button');
    el.setAttribute('data-act', 'noSuchFunction');
    d.body.appendChild(el);
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    ok(errs.length === 0, '无 JS 错误');
  }

  console.log('\n[7] 复合语句的 3 处仍走原 onclick');
  {
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    ok(html.indexOf("onclick=\"openSection(secIdx('使用指南'));closePlus()\"") > 0, '快捷面板三处保留');
    ok(html.indexOf("onclick=\"document.getElementById('search').focus()\"") > 0, '聚焦按钮保留');
  }

  console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
  process.exit(fail ? 1 : 0);
})();
