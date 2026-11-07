/**
 * 学通 · ask.html 问答页面测试
 */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');

const DIR = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x ? ' → ' + x : '')); } };

function boot() {
  let html = fs.readFileSync(path.join(DIR, 'ask.html'), 'utf8');
  html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
    const p = path.join(DIR, src);
    if (!fs.existsSync(p)) return '';
    return '<script>' + fs.readFileSync(p, 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>';
  });
  const errs = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://local.test/ask.html',
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
  console.log('\n[1] 加载');
  {
    const { w, d, errs } = boot();
    await sleep(100);
    ok(!!w.YZQA, '问答引擎已加载');
    ok(errs.length === 0, '无 JS 错误（' + (errs[0] || '无') + '）');
    ok(!!d.getElementById('q'), '输入框存在');
    ok(d.querySelectorAll('.chip').length >= 5, '快捷问题 ' + d.querySelectorAll('.chip').length + ' 个');
  }

  console.log('\n[2] 点快捷问题');
  {
    const { w, d } = boot();
    await sleep(100);
    const chip = d.querySelector('.chip');
    const text = chip.textContent;
    chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(80);
    ok(d.querySelectorAll('.msg.q').length === 1, '出现用户消息');
    ok(d.querySelectorAll('.msg.a').length === 1, '出现回答');
    ok(d.querySelector('.msg.a .bubble').textContent.length > 5, '回答非空');
    ok(d.getElementById('empty') === null, '空状态已移除');
    console.log('    Q: ' + text);
    console.log('    A: ' + d.querySelector('.msg.a .bubble').textContent.replace(/\n/g, ' ').slice(0, 80));
  }

  console.log('\n[3] 提交表单');
  {
    const { w, d } = boot();
    await sleep(100);
    d.getElementById('q').value = '马克思和恩格斯什么关系';
    d.getElementById('f').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(80);
    ok(d.querySelectorAll('.msg.a').length === 1, '出答案');
    ok(d.querySelector('.msg.a .bubble').textContent.indexOf('恩格斯') >= 0, '答案相关');
    ok(d.getElementById('q').value === '', '输入框已清空');
  }

  console.log('\n[4] 依据的可核性要说实话');
  {
    const { w, d } = boot();
    await sleep(100);
    d.getElementById('q').value = '马克思和恩格斯什么关系';
    d.getElementById('f').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(80);
    const ev = d.querySelector('details.ev');
    ok(!!ev, '有依据折叠块');
    ok(ev.querySelectorAll('li').length > 0, '依据条目 ' + ev.querySelectorAll('li').length + ' 条');
    const sum = ev.querySelector('summary').textContent;
    /* 2026-11-07 起不再一律宣称「可核对」：
       图谱 1360 条关系边一条都没标出处，写「可核对」是不实承诺。
       现在必须按实际情况区分「关系级出处 / 只有条目级出处 / 未标出处」。 */
    ok(/关系依据/.test(sum), '文案点明这是关系依据');
    ok(/这一关系本身的出处|只能核到条目级文献|未标注出处/.test(sum), '出处强度说得清楚：' + sum.slice(0, 48));
    const li0 = ev.querySelector('li');
    ok(/未标出处|条目出处|出处：/.test(li0.textContent), '每条都带出处状态标记');
  }

  console.log('\n[5] 查不到要说实话');
  {
    const { w, d } = boot();
    await sleep(100);
    d.getElementById('q').value = '绝对不存在的人物xyz';
    d.getElementById('f').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(80);
    const t = d.querySelector('.msg.a .bubble').textContent;
    ok(/没有找到|检索不到|既没有/.test(t), '明确说查不到');
    ok(!/可能|大概|也许/.test(t), '不编造模糊话术');
  }

  console.log('\n[6] 连续多轮');
  {
    const { w, d } = boot();
    await sleep(100);
    for (const q of ['马克思是谁', '毛泽东是谁', '有哪些组织']) {
      d.getElementById('q').value = q;
      d.getElementById('f').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await sleep(50);
    }
    ok(d.querySelectorAll('.msg.q').length === 3, '3 轮提问');
    ok(d.querySelectorAll('.msg.a').length === 3, '3 轮回答');
  }

  console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
  process.exit(fail ? 1 : 0);
})();
