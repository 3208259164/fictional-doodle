/* 学通 · 图谱交互验证（本机无 WebGL / 无网络，全部用桩）
   覆盖：
     ① 3D 节点名字叠加层：拿引擎内部节点坐标 → 投影 → 生成标签并定位
     ② 3D 底部按钮布局：独立按钮（仿 2D），不再是单个圆角胶囊
     ③ 2D 关系工具：可打字搜索对象（汉字 / 全拼 / 首字母）+ 键盘 ↑↓ Enter
   跑法：node tests/graph_ui_test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log('  ✅ ' + n + (x ? '   ⟨' + x + '⟩' : '')); } else { fail++; console.log('  ❌ ' + n + (x ? '   ⟨' + x + '⟩' : '')); } }

function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'canvas') return { width: 1, height: 1 };
      return function () { };
    }, set() { return true; }
  });
}

(async function () {
  /* ===================== ① 3D 名字层 ===================== */
  console.log('===== ① 3D 节点名字叠加层 =====');
  const LIVE = [
    { id: 'marx', name: '卡尔·马克思', x: 0, y: 0, z: 0 },
    { id: 'engels', name: '弗里德里希·恩格斯', x: 30, y: 10, z: -5 }
  ];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e && e.message); if (!/Could not parse CSS|Not implemented/.test(m)) errors.push(m.slice(0, 120)); });

  const html3d = fs.readFileSync(SITE + 'graph3d.html', 'utf8');
  const dom3d = new JSDOM(html3d, {
    url: 'https://local.test/graph3d.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
      w.WebGLRenderingContext = function () { };
      /* 引擎桩：graphData() 返回带坐标的内部节点；graph2ScreenCoords 给出可预测的屏幕坐标 */
      const api = {
        graphData: () => ({ nodes: LIVE, links: [] }),
        graph2ScreenCoords: (x, y) => ({ x: 100 + x, y: 200 + y })
      };
      const f = new Proxy(function () { }, {
        get(t, p) { if (p in api) return api[p]; return function () { return f; }; },
        apply() { return f; }
      });
      w.ForceGraph3D = function () { return f; };
      try { w.eval(fs.readFileSync(SITE + 'data/graph3d.js', 'utf8')); } catch (e) { }
      try { w.eval(fs.readFileSync(SITE + 'assets/cite.js', 'utf8')); } catch (e) { }
      const origCE = w.document.createElement.bind(w.document);
      w.document.createElement = function (tag) {
        const el = origCE(tag);
        if (String(tag).toLowerCase() === 'script') {
          Object.defineProperty(el, 'src', {
            set(v) { this._src = v; setTimeout(() => { try { this.onload && this.onload(); } catch (e) { } }, 0); },
            get() { return this._src || ''; }
          });
        }
        return el;
      };
    }
  });
  const w3 = dom3d.window;
  await new Promise(r => setTimeout(r, 3600));

  const layer = w3.document.getElementById('yzLabels');
  ok('① 名字层容器存在', !!layer);
  const labels = layer ? layer.querySelectorAll('.yl') : [];
  ok('① 生成了节点名字标签', labels.length === LIVE.length, labels.length + ' 个');
  ok('① 标签文字就是人物名', labels.length > 0 && labels[0].textContent.indexOf('马克思') >= 0,
    labels.length ? labels[0].textContent : '');
  ok('① 标签被定位到投影位置（不是全堆在原点）', (() => {
    if (labels.length < 2) return false;
    const p0 = (labels[0].style.left || '') + ',' + (labels[0].style.top || '');
    const p1 = (labels[1].style.left || '') + ',' + (labels[1].style.top || '');
    return p0 === '100px,200px' && p1 === '130px,210px';
  })(), labels[0] && (labels[0].style.left + ',' + labels[0].style.top));
  ok('① 标签可见（display 不是 none）', labels.length > 0 && labels[0].style.display !== 'none');
  ok('① 关闭开关后整层隐藏', (() => {
    try { w3.yz3d.toggleLabels(); const b = w3.document.getElementById('yzLabels'); return b.style.display === 'none'; } catch (e) { return false; }
  })());
  try { w3.yz3d.toggleLabels(); } catch (e) { }

  /* 真机可见性三连：合成层、容器兜底尺寸、canvas 降层 */
  ok('① 名字层强制独立合成层（防 WebGL canvas 盖住）', /#yzLabels\{[^}]*translateZ\(0\)/.test(html3d));
  ok('① 名字层尺寸有 width/height 兜底（不依赖 inset）',
    /#yzLabels\{[^}]*width:100%/.test(html3d) && /#yzLabels\{[^}]*height:100%/.test(html3d));
  ok('① WebGL canvas 显式沉底', /#stage canvas\{[^}]*z-index:0/.test(html3d));

  /* ===================== ② 3D 底部按钮 ===================== */
  console.log('\n===== ② 3D 底部按钮布局 =====');
  const styleTxt = html3d.slice(html3d.indexOf('#tools{'), html3d.indexOf('#tools{') + 900);
  ok('② 外层不再是 999px 圆角胶囊', !/#tools\{[^}]*border-radius:999px/.test(styleTxt));
  ok('② 按钮各自 9px 圆角（与 2D 一致）', /#tools button\{[^}]*border-radius:9px/.test(styleTxt));
  ok('② 按钮有最小高度（好点按）', /#tools button\{[^}]*min-height:36px/.test(styleTxt));
  ok('② 年份滑条单独占一行（flex-basis:100%）', /#tools #ybar\{[^}]*flex-basis:100%/.test(styleTxt));
  ok('② 底部条不再用 translateX 居中（改左右贴边 + 内部居中）', /#tools\{[^}]*left:0;right:0/.test(styleTxt));
  ok('② 页面无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  /* ===================== ③ 2D 关系工具键盘搜索 ===================== */
  console.log('\n===== ③ 2D 关系工具：打字选对象 =====');
  const errors2 = [];
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', e => { const m = String(e && e.message); if (!/Could not parse CSS|Not implemented/.test(m)) errors2.push(m.slice(0, 120)); });

  let html = fs.readFileSync(SITE + 'graph.html', 'utf8');
  html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
    const p = path.join(SITE, src);
    if (!p.startsWith(SITE) || !fs.existsSync(p)) return '<!-- skip -->';
    return '<script>' + fs.readFileSync(p, 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>';
  });
  const dom2 = new JSDOM(html, {
    url: 'https://local.test/graph.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc2,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
    }
  });
  const w2 = dom2.window;
  await new Promise(r => setTimeout(r, 900));

  ok('③ 关系工具有输入框（可打字）', !!w2.document.getElementById('rtAq') && !!w2.document.getElementById('rtBq'));
  ok('③ 原来的 select 仍保留（兼容既有逻辑）', !!w2.document.getElementById('rtA') && !!w2.document.getElementById('rtB'));
  ok('③ relPickInput / relPickKey 已定义', typeof w2.relPickInput === 'function' && typeof w2.relPickKey === 'function');

  /* 汉字搜索 */
  w2.document.getElementById('rtAq').value = '马克思';
  try { w2.relPickInput('A', '马克思'); } catch (e) { errors2.push('relPickInput ' + e.message); }
  const sugA = w2.document.getElementById('rtAsug');
  ok('③ 输入汉字给出候选并展开', !!sugA && sugA.classList.contains('open') && sugA.querySelectorAll('.it').length > 0,
    sugA ? sugA.querySelectorAll('.it').length + ' 条' : '');
  ok('③ 候选里第一条是马克思', sugA && sugA.querySelector('.it') && /马克思/.test(sugA.querySelector('.it').textContent),
    sugA && sugA.querySelector('.it') ? sugA.querySelector('.it').textContent.slice(0, 16) : '');

  /* 拼音首字母 */
  try { w2.relPickInput('B', 'mks'); } catch (e) { }
  const sugB = w2.document.getElementById('rtBsug');
  ok('③ 输入拼音首字母也能命中', sugB && sugB.querySelectorAll('.it').length > 0, sugB ? sugB.querySelectorAll('.it').length + ' 条' : '');

  /* 键盘：↓ 移动高亮、Enter 选中 */
  const it2 = sugB ? sugB.querySelectorAll('.it')[1] : null;
  const expected = it2 ? it2.textContent.replace(/\s+/g, '') : '';
  try { w2.relPickKey({ key: 'ArrowDown', preventDefault() { } }, 'B'); } catch (e) { }
  ok('③ ↓ 能移动高亮', sugB && sugB.querySelectorAll('.it')[1] && sugB.querySelectorAll('.it')[1].classList.contains('hl'));
  try { w2.relPickKey({ key: 'Enter', preventDefault() { } }, 'B'); } catch (e) { errors2.push('relPickKey ' + e.message); }
  const selB = w2.document.getElementById('rtB');
  const typedB = w2.document.getElementById('rtBq');
  ok('③ Enter 选中后写入 select.value', !!selB && !!selB.value, selB && selB.value);
  ok('③ Enter 选中后输入框显示完整姓名', !!typedB && typedB.value.length > 1, typedB && typedB.value);
  ok('③ 选中后候选自动收起', sugB && !sugB.classList.contains('open'));
  ok('③ 选中的正是高亮那一条', expected && typedB && expected.indexOf(typedB.value.replace(/\s+/g, '')) >= 0,
    '预期含 ' + (typedB ? typedB.value : '') + ' / 候选 ' + expected.slice(0, 20));

  /* 无匹配时的提示 */
  try { w2.relPickInput('A', 'zzzz不存在的名字'); } catch (e) { }
  ok('③ 无匹配时给提示而不是空白', (() => {
    const s = w2.document.getElementById('rtAsug');
    return !!s && /没有匹配/.test(s.textContent);
  })());

  ok('③ 页面无 JS 异常', errors2.length === 0, errors2.slice(0, 2).join(' | '));

  console.log('\n------------------------------------------------------------------');
  console.log('  结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
