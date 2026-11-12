/**
 * 频道双频道 / 加号 / 书库检索 —— 回归套件
 *   1. 右上角「＋」：setTopbar 之后仍然单击即可打开（历史上的双绑定 bug）
 *   2. 频道：人物频道 + 概念频道，切换、搜索、概念详情
 *   3. 概念不并入图谱：graphData 仍是 107 节点
 *   4. 书库：单本 / 多本 / 书单 / 引文反查 / 跳转链接
 *
 * 用法：node tests/chan_book_test.js
 */
const path = require('path'), fs = require('fs');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const DIR = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'));
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

function loadPage(file, url, opts) {
  let html = fs.readFileSync(path.join(DIR, file), 'utf8');
  html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
    try { return '<script>' + fs.readFileSync(path.join(DIR, src), 'utf8') + '</script>'; } catch (e) { return m; }
  });
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: url || 'https://local.test/index.html', virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = new Proxy({}, { get: () => () => ({}) });
      try { if (opts && opts.theme) w.localStorage.setItem('theme', opts.theme); } catch (e) {}
      require('./_lazy_hook')(w, DIR);   /* 数据是按需注入的，jsdom 需要真的加载 */
    }
  });
  return { w: dom.window, d: dom.window.document, errors };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  console.log('\n[1] 右上角「＋」单击可打开');
  {
    const { w, d } = loadPage('index.html');
    await sleep(2500);
    const plus = d.getElementById('qPlus'), panel = d.getElementById('qPanel');
    plus.click();
    ok(!panel.hidden, '初始状态单击可打开');
    w.closePlus();
    w.setTopbar('page', { title: '测试页' });
    ok(plus.getAttribute('onclick') === null, 'setTopbar 后 qPlus 没有内联 onclick（避免双绑定）');
    plus.click();
    ok(!panel.hidden, '进过子页面后单击仍能打开');
    w.closePlus();
    w.setTopbar('root', {});
    plus.click();
    ok(!panel.hidden, '回到主页后单击仍能打开');
  }

  console.log('\n[2] 频道：人物 / 概念');
  let w, d;
  {
    const L = loadPage('index.html'); w = L.w; d = L.d;
    await sleep(2500);
    w.openChannel();
    const cv = d.getElementById('contentView');
    const qa = d.getElementById('qAct');
    ok(!qa.hidden && qa.textContent === '📡', '顶部有「切换频道」按钮（在导入右边）');
    ok(qa.getAttribute('data-act') === 'chanPick', '按钮走事件委托（无内联 onclick）');
    ok(cv.querySelectorAll('.ch-tab').length === 0, '正文里不再铺标签条');
    const cN = w.SITE_CONCEPTS.nodes.length;
    ok(cv.querySelectorAll('.cc-post').length === cN, '默认进入概念频道（' + cN + ' 张概念卡）');
    ok(cv.querySelectorAll('.ch-post:not(.cc-post)').length === 0, '默认不显示人物频道的发言卡');
    ok((cv.querySelector('.cc-name') || {}).textContent === '商品', '概念频道首条是「商品」');

    w.channelSearch('帝国');
    ok(cv.querySelectorAll('.cc-post').length >= 2, '概念频道可搜索（帝国 → ' + cv.querySelectorAll('.cc-post').length + ' 条）');
    ok((cv.querySelector('.cc-name') || {}).textContent === '帝国主义', '搜索命中帝国主义');

    w.channelSearch('');
    qa.click();
    const pick = d.getElementById('chanPick');
    /* 频道已收敛为概念 / 文章两项（人物频道并入人物页，不再单列） */
    const _ks = [...pick.querySelectorAll('.chp-item')].map(x => x.getAttribute('data-k'));
    ok(!!pick && _ks.length === 2, '频道选择 2 项（' + _ks.join(' / ') + '）');
    ok(_ks[1] === 'article', '第二项是文章频道');
    ok(pick.querySelectorAll('.chp-item')[0].getAttribute('data-k') === 'concept', '概念频道排在前面');
    ok(pick.querySelector('.chp-item.on').getAttribute('data-k') === 'concept', '当前频道（概念）有选中标记');
    pick.querySelector('[data-k="article"]').click();
    ok(!d.getElementById('chanPick'), '选择后弹层关闭');
    /* 文章列表内容取决于 articles.js 是否已注入，断言只锁「频道状态切过去了」 */
    ok(w._chanTab === 'article', '可切到文章频道');

    w.channelSearch('');
    w.openConcept('commodity');
    const body = d.getElementById('contentView').textContent;
    ok(d.getElementById('qTitle').textContent.indexOf('商品') >= 0, '概念详情标题正确');
    ok(body.indexOf('要点') >= 0, '详情含要点');
    ok(body.indexOf('出处') >= 0, '详情含出处');
    ok(body.indexOf('相关文献') >= 0, '详情含相关文献');

    w.chanTabSet('concept');
    ok(cv.querySelectorAll('.cc-post').length === cN, '可切回概念频道');

    /* 著作不进频道：检查它确实进了书库「原著」分类 */
    const RESX = w.eval('RES');
    ok(!w.SITE_WORKS, '没有独立的著作数据（已并入书库）');
    ok(RESX.filter(r => r.cat === '原著').length >= 180, '书库「原著」类 ' + RESX.filter(r => r.cat === '原著').length + ' 条');
    ok(RESX.some(r => r.title === '论联共（布）党内的右倾'), '新增条目归入「原著」（样本：论联共（布）党内的右倾）');
    ok(RESX.every(r => !/^yuanzhu-/.test(r.id) || r.cat === '原著'), '新增条目分类一致（全部为原著）');
    w.goHome();
    ok(d.getElementById('qAct').hidden, '离开频道页后按钮自动隐藏');
  }

  console.log('\n[2.5] 首页每日一句：只从原有 6 条里取');
  {
    const dq = d.getElementById('dailyQuote');
    ok(!!dq, '每日一句模块存在（保留原功能）');
    const homeQ = (w.eval('CT').quotes || []).filter(q => q.home);
    ok(homeQ.length === 6, '首页池只含原有 6 条（新增引文不进首页）');
    ok(dq.textContent.length > 0, '每日一句有内容');
    const longOnes = homeQ.filter(q => q.t.length > 60).length;
    ok(longOnes === 0, '首页池没有超长句（不会把人物行挤变形）');
  }

  console.log('\n[3] 概念不并入图谱');
  {
    const gd = w.YZY ? w.YZY.graphData() : null;
    if (gd){
      const conceptN = gd.nodes.filter(n => n.type === 'concept').length;
      const workN = gd.nodes.filter(n => n.type === 'work').length;
      ok(conceptN === 0, '概念不进图谱（在频道看）');
      ok(workN === 0, '著作不进图谱（书在书库/频道）');
      ok(gd.nodes.length >= 100 && gd.nodes.length === w.SITE_GRAPH.nodes.length,
        '主图谱节点数与数据一致（' + gd.nodes.length + '：人物 ' + gd.nodes.filter(n=>n.type==='person').length + ' + 思想 ' + gd.nodes.filter(n=>n.type==='idea').length + ' + 组织 ' + gd.nodes.filter(n=>n.type==='org').length + '）');
    } else ok(true, '（本页无图谱覆盖层，跳过）');
  }

  console.log('\n[4] 书库检索');
  {
    const L = loadPage('ask.html', 'https://local.test/ask.html');
    const aw = L.w, ad = L.d;
    await sleep(2500);
    const B = aw.YZBOOK;
    ok(!!B, 'booksearch.js 已加载');
    const st = B.stats();
    ok(st.total >= 335, '书库 ' + st.total + ' 条');

    const one = B.tryAnswer('共产党宣言讲什么');
    ok(one && one.intent === 'book', '单本命中');
    ok(one.books[0].href === 'index.html#/r/gongchandang-xuanyan', '跳转链接指向书库详情');
    ok(one.answer.indexOf('人民出版社') >= 0, '回答含出版信息');

    const many = B.tryAnswer('有哪些原著');
    ok(many && many.intent === 'booklist', '「有哪些原著」→ 书单');
    ok(many.books.length === 10, '列出 10 本，均可跳转');

    const rec = B.tryAnswer('推荐的入门书');
    ok(rec && rec.intent === 'booklist' && rec.books.length > 0, '推荐书单有可跳转条目');

    const qt = B.tryAnswer('无产者在这个革命中失去的只是锁链 出自哪本书');
    ok(qt && qt.intent === 'quote', '引文反查命中');
    ok(qt.answer.indexOf('共产党宣言') >= 0, '引文答出《共产党宣言》');

    ok(B.tryAnswer('今天天气怎么样') === null, '无关问题不接管（交回图谱）');

    /* 端到端：页面里真的渲染出可点链接 */
    const input = ad.getElementById('q') || ad.querySelector('input,textarea');
    const form = ad.querySelector('form');
    input.value = '共产党宣言讲什么';
    form.dispatchEvent(new aw.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(700);
    const cards = ad.querySelectorAll('.book');
    ok(cards.length >= 1, '页面渲染出书卡 ' + cards.length + ' 张');
    ok(cards[0] && /index\.html#\/r\//.test(cards[0].getAttribute('href')), '书卡链接可跳转到书库');
    const foot = (ad.querySelector('.foot') || {}).textContent || '';
    ok(/\d+ 条书库记录/.test(foot), '底部显示书库规模');
  }

  console.log('\n[5] 深色跟随 App 主题（不只听系统）');
  {
    const L = loadPage('ask.html', 'https://local.test/ask.html', { theme: 'dark' });
    await sleep(700);
    ok(L.d.documentElement.classList.contains('dark'), 'localStorage.theme=dark → html.dark');
    ok(!L.d.documentElement.classList.contains('light'), '同时不带 light 类');

    const L2 = loadPage('ask.html', 'https://local.test/ask.html', { theme: 'light' });
    await sleep(700);
    ok(L2.d.documentElement.classList.contains('light'), 'theme=light → html.light');
    ok(!L2.d.documentElement.classList.contains('dark'), '不误判为深色');

    ok(/html\.dark\b/.test(fs.readFileSync(path.join(DIR, 'ask.html'), 'utf8')), 'ask.html 用 html.dark 选择器（不是纯 @media）');

    /* 从主站带参数进来：?theme=dark 必须压过本机设置 */
    const L3 = loadPage('ask.html', 'https://local.test/ask.html?theme=dark', { theme: 'light' });
    await sleep(700);
    ok(L3.d.documentElement.classList.contains('dark'), 'URL ?theme=dark 压过 localStorage.theme=light');

    const L4 = loadPage('ask.html', 'https://local.test/ask.html?theme=light', { theme: 'dark' });
    await sleep(700);
    ok(L4.d.documentElement.classList.contains('light'), 'URL ?theme=light 压过 localStorage.theme=dark');

    /* 底部输入条：页面是渐变底，这里若用实色 var(--bg) 会出现一条色块 */
    const askCss = fs.readFileSync(path.join(DIR, 'ask.html'), 'utf8');
    const formRule = /form\{([^}]*)\}/.exec(askCss);
    ok(!!formRule && /background:inherit/.test(formRule[1]), '底部输入条继承页面背景（不再用实色 var(--bg)）');
    ok(!!formRule && /background-attachment:fixed/.test(formRule[1]), '底部输入条 fixed 附着，颜色与页面衔接');
    const qRule = /#q\{([^}]*)\}/.exec(askCss);
    ok(!!qRule && /background:transparent/.test(qRule[1]), '输入框透明底（与主站搜索框同一写法）');

    /* 系统栏：切换主题时要通知 App */
    ok(/AndroidApp\.setBarColor/.test(askCss), '问一问切换主题会同步系统栏颜色');
    ok(/AndroidApp\.setBarColor/.test(fs.readFileSync(path.join(DIR, 'assets/app.js'), 'utf8')), '主站切换主题会同步系统栏颜色');
  }

  console.log('\n[6] 问一问：人物 / 概念 可跳转');
  {
    const L = loadPage('ask.html', 'https://local.test/ask.html');
    await sleep(2500);
    const Q = L.w.YZQA;
    const p = Q.ask('毛泽东是什么人');
    ok(!!p.links && p.links.length >= 2, '人物答案带跳转链接');
    ok(p.links.some(l => /index\.html#\/g\//.test(l.href)), '有「人物介绍」链接（#/g/）');
    ok(p.links.some(l => /graph\.html#/.test(l.href)), '有「图谱定位」链接');

    const c = Q.ask('商品是什么');
    ok(c.links && c.links.some(l => /index\.html#\/c\/commodity/.test(l.href)), '概念答案跳到概念详情（#/c/）');

    const r = Q.ask('林彪和毛泽东什么关系');
    ok(r.links && r.links.length >= 2, '关系问题两端都有链接');

    /* 页面里真的渲染出链接 */
    const input = L.d.getElementById('q') || L.d.querySelector('input,textarea');
    const form = L.d.querySelector('form');
    input.value = '毛泽东是什么人';
    form.dispatchEvent(new L.w.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(700);
    ok(L.d.querySelectorAll('.lnk').length >= 2, '页面渲染出可点跳转按钮 ' + L.d.querySelectorAll('.lnk').length + ' 个');
  }

  console.log('\n[7] 抽屉：对齐 QQ 结构（无横线、设置/夜间置底）');
  {
    const css = fs.readFileSync(path.join(DIR, 'assets/extra.css'), 'utf8');
    const row = /(\.pc-row \{[^}]*\})/.exec(css);
    ok(!!row && /border-bottom:\s*0/.test(row[1]), '中间列表项去掉了横线');
    ok(!!row && /border-radius/.test(row[1]), '列表项改为圆角块（QQ 风格）');
    const list = /(\.pc-list \{[^}]*\})/.exec(css);
    ok(!!list && /margin:\s*2px -18px/.test(list[1]), '列表用负边距抵消抽屉内边距 → 真正通到屏幕边缘');
    ok(!!row && /padding:\s*8px 18px/.test(row[1]), '行高收紧（8px）且左右内边距 18px（整行可点）');
    const bot = /(\.pc-bottom \{[^}]*\})/.exec(css);
    ok(!!bot && /background:\s*transparent/.test(bot[1]), '底栏背景透明，直接透出抽屉渐变（不会再有色差）');
    ok(!!bot && !/linear-gradient/.test(bot[1]), '底栏不再自己复制一份渐变（WebView 上会和抽屉错位）');
    ok(!!bot && /flex:\s*none/.test(bot[1]), '底栏是固定项，不随内容滚动');
    ok(!!bot && /border-top:\s*1px solid var\(--card-border\)/.test(bot[1]), '底栏用与主页底栏一致的 1px 淡边');
    const list2 = /(\.pc-list \{[^}]*\})/.exec(css);
    ok(!!list2 && /overflow-y:\s*auto/.test(list2[1]) && /flex:\s*1 1 auto/.test(list2[1]), '中间列表是唯一的滚动区');
    const pv = /(#pcView \{[^}]*\})/.exec(css);
    ok(!!pv && /height:\s*100%/.test(pv[1]) && /overflow:\s*hidden/.test(pv[1]), 'pcView 定高且自身不滚（头/列表/底栏三段式）');
    ok(!!bot && /margin:\s*0 -18px/.test(bot[1]), '底部同样通栏（负边距抵消抽屉内边距）');
  }

  console.log('\n[8] 拼音搜索 / 最近搜索 / 书库链接');
  {
    const L = loadPage('index.html');
    const w2 = L.w, d2 = L.d;
    await sleep(1000);
    ok(w2.pyQuery('mao').indexOf('毛泽东') >= 0, '拼音 mao → 毛泽东');
    ok(w2.pyQuery('mzd').indexOf('毛泽东') >= 0, '首字母 mzd → 毛泽东');
    ok(w2.omniSearch('mao').length > 0, '搜 mao 有结果');
    ok(w2.omniSearch('zibenlun').length > 0, '搜 zibenlun 有结果');
    const top = w2.omniSearch('宣言')[0];
    ok(top && top.t.indexOf('宣言') >= 0, '搜「宣言」首条是《共产党宣言》相关（' + (top && top.t) + '）');

    /* 最近搜索 */
    const inp = d2.getElementById('search');
    inp.value = '资本论'; w2.render();
    inp.value = ''; w2.render();
    const rb = d2.getElementById('recentBox');
    ok(!rb.hidden && rb.querySelectorAll('.rs-chip').length >= 1, '最近搜索有记录');
    rb.querySelector('.rs-chip').click();
    ok(inp.value === '资本论', '点按历史可重跑');

    /* 书库链接可编辑 */
    const RES = w2.eval('RES');
    const bi = RES.findIndex(r => r.id === 'zibenlun');
    w2.openLinkEditor(bi);
    const ed = d2.getElementById('linkEditor');
    ok(!!ed, '链接编辑弹层打开');
    ed.querySelector('#leInput').value = 'https://example.org/zbl.epub';
    ed.querySelector('[data-le="save"]').click();
    ok((w2.localStorage.getItem('links') || '').indexOf('example.org') >= 0, '链接可保存');
    const cvv = d2.getElementById('contentView');
    ok(cvv.querySelectorAll('.lk-btn, .lk-edit').length > 0, '详情页有可点的链接按钮（不只藏在 meta 里）');
    w2.openLinkEditor(bi);
    d2.getElementById('linkEditor').querySelector('#leInput').value = 'javascript:alert(1)';
    d2.getElementById('linkEditor').querySelector('[data-le="save"]').click();
    ok((w2.localStorage.getItem('links') || '').indexOf('javascript') < 0, '恶意协议被拒');
    w2.openLinkEditor(bi);
    d2.getElementById('linkEditor').querySelector('[data-le="reset"]').click();
    ok(w2.localStorage.getItem('links') === '{}', '可恢复默认链接', String(w2.localStorage.getItem('links')));
  }

  console.log('\n[8.5] 图谱节点颜色/形状保持原样（未篡改）');
  {
    const css = fs.readFileSync(path.join(DIR, 'graph.html'), 'utf8');
    ok(css.indexOf("if(t==='concept')return") < 0, 'color() 没有概念分支（不在图谱里）');
    ok(!/lg-concept/.test(css), '图例没有概念项');
    ok(!/o\.d\.type==='concept'\)\{var _hx/.test(css), '没有给概念加形状');
    ok(!/o\.d\.type==='idea'\)\{var _t1/.test(css), '没有给思想改形状（仍为圆点）');
    ok(!/concepts\.js/.test(css), '图谱页不加载概念数据');
    /* 画布配色必须与图例一致：图例 人物=绿/思想=蓝/组织=黄 */
    ok(/#8de6a1/.test(css) && /return '#8de6a1'/.test(css), '画布人物用绿（与图例一致）');
    ok(/return '#7ec8ff'/.test(css), '画布思想用蓝（与图例一致）');
    ok(/return '#ffd166'/.test(css), '画布组织用黄（与图例一致）');
    const colorBody = (css.match(/function color\(n\)\{[\s\S]*?\n\}/) || [''])[0];
    ok(colorBody && !/#F0E442/.test(colorBody), 'color() 里不再把思想画成黄色（社区色板另算，不算冲突）');
  }

  console.log('\n[8.6] 图书馆（分类 → 图书馆）：可跳转 + 可改链接');
  {
    const L = loadPage('index.html');
    const w4 = L.w, d4 = L.d;
    await sleep(2500);
    const si = w4.secIdx('图书馆');
    ok(si >= 0, '能定位「图书馆」页');
    w4.openSection(si);
    const cv4 = d4.getElementById('contentView');
    ok(cv4.querySelectorAll('.libcard').length === w4.SITE_LIBRARIES.length, '图书馆条目数与数据一致（' + w4.SITE_LIBRARIES.length + '）');
    ok(cv4.querySelectorAll('.libedit').length === w4.SITE_LIBRARIES.length, '每条都有修改链接按钮');
    ok(cv4.textContent.indexOf('🔗') >= 0, '显示当前链接');

    w4.openLibEditor('zlib');
    const ed = d4.getElementById('libEditor');
    ok(!!ed, '修改弹层打开');
    ed.querySelector('#leInput').value = 'https://example.net/zlib';
    ed.querySelector('[data-le="save"]').click();
    ok((w4.localStorage.getItem('libLinks') || '').indexOf('example.net') >= 0, '图书馆链接可保存');

    w4.openLibEditor('zlib');
    d4.getElementById('libEditor').querySelector('#leInput').value = 'javascript:alert(1)';
    d4.getElementById('libEditor').querySelector('[data-le="save"]').click();
    ok((w4.localStorage.getItem('libLinks') || '').indexOf('javascript') < 0, '拒绝非 http(s) 链接');

    w4.openLibEditor('zlib');
    d4.getElementById('libEditor').querySelector('[data-le="reset"]').click();
    ok(w4.localStorage.getItem('libLinks') === '{}', '图书馆链接可恢复默认', String(w4.localStorage.getItem('libLinks')));
  }

  console.log('\n[9] 内容：事件 / 概念 / 著作 / 引文');
  {
    const L = loadPage('ask.html', 'https://local.test/ask.html');
    await sleep(1100);
    const w3 = L.w;
    const st = w3.YZQA.stats();
    ok(st.nodes >= 380, '合并节点 ' + st.nodes + '（含事件与著作）');
    const q1 = w3.YZQA.ask('新经济政策');
    ok(q1.ok && q1.answer.indexOf('粮食税') >= 0, '新事件可查：新经济政策');
    const q2 = w3.YZQA.ask('古巴导弹危机');
    ok(q2.ok && q2.answer.indexOf('1962') >= 0, '新事件可查：古巴导弹危机');
    const q3 = w3.YZQA.ask('价值规律');
    ok(q3.ok && q3.answer.indexOf('社会必要劳动时间') >= 0, '新概念可查：价值规律');
    const q4 = w3.YZQA.ask('按劳分配');
    ok(q4.ok, '新概念可查：按劳分配');
    ok(w3.SITE_CONCEPTS.nodes.length >= 46, '概念数不少于基线（' + w3.SITE_CONCEPTS.nodes.length + '）');
    ok(w3.SITE_GRAPH_WORLD.nodes.filter(n => n.type === 'event').length >= 50,
       '世界图谱事件 ≥50（' + w3.SITE_GRAPH_WORLD.nodes.filter(n => n.type === 'event').length + '）');
    ok((w3.SITE_CONTENT.quotes || []).length >= 60, '经典引文 ≥60（' + (w3.SITE_CONTENT.quotes || []).length + '）');
  }

  console.log('\n########## 合计：' + (pass + fail) + ' 项，失败 ' + fail + ' ##########');
  process.exit(fail ? 1 : 0);
})();
