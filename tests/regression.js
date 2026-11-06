/* =====================================================================
   元资源库 · 回归测试（固化版，跨会话可复跑）
   用法：  node tests/regression.js [editor|graph|page|persist|ui|site|theme|bar|all]
   套件：
     editor  —— 自助编辑器组件级（真实 DOM 点击）
     graph   —— 图谱编辑器（含“事件能否到达按钮”的针对性回归）
     page    —— 主站 index.html 整页冒烟
     persist —— ★ 跨“重启/刷新”的持久化与幂等（本次新加，直击“编辑后不保存”）
     ui      —— ★ 清屏隐藏 / 按钮精简 / 总开关 / 引用列表
     site    —— ★F-Droid 合规：本地站点运行器 / 网盘 已移除
     theme   —— ★ 主题「跟随系统」
     bar     —— ★ 自助编辑工具栏位置与几何（不遮挡底部面板）
   依赖：jsdom（已随本目录安装）
   ===================================================================== */
'use strict';
const { JSDOM, VirtualConsole } = require(require('path').join(__dirname, 'node_modules', 'jsdom'));
const fs = require('fs');
const BASE = (process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (require('fs').existsSync(require('path').join(__dirname, '..', 'site', 'graph.html')) ? (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/' : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')) + '/'));
const KEY = 'yzy_ov_v1';

function fakeCtx() {
  return new Proxy({}, {
    get(t, p) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'getImageData') return () => ({ data: [] });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (p === 'canvas') return { width: 1, height: 1 };
      if (typeof p === 'string' && /^(font|fillStyle|strokeStyle|lineWidth|globalAlpha|shadowBlur|shadowColor|textAlign|textBaseline|lineDashOffset|lineJoin|lineCap|miterLimit|globalCompositeOperation|filter)$/.test(p)) return undefined;
      return function () {};
    }, set() { return true; }
  });
}
/* 把 <script src> 内联；可注入 seed 覆盖层（写在所有脚本之前，模拟“上次留下的本机存储”） */
function loadPage(file, url, seed, before) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = (e.detail ? (e.detail.message || e.detail) : e.message) || '';
    if (!/Could not load img|Not implemented|Could not parse CSS|Could not load link/.test(String(m))) errors.push('jsdomError: ' + m);
  });
  let html = fs.readFileSync(BASE + file, 'utf8');
  /* index.html 的脚本全部带 defer（构建时统一加），旧正则要求 src 紧跟 <script，
     导致一个都没内联 → 整页套件其实一直在空跑。这里放宽到任意属性。 */
  html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src, c) => {
    try { return '<script>\n' + fs.readFileSync(BASE + src, 'utf8') + '\n<\/script>'; }
    catch (e) { errors.push('inline fail ' + src); return ''; }
  });
  if (seed) {
    const b = '<script>try{localStorage.setItem(' + JSON.stringify(KEY) + ',' + JSON.stringify(typeof seed === 'string' ? seed : JSON.stringify(seed)) + ')}catch(e){}</' + 'script>';
    const i = html.indexOf('<script');
    html = i >= 0 ? html.slice(0, i) + b + html.slice(i) : b + html;
  }
  const dom = new JSDOM(html, {
    url: url || ('https://local.test/' + file), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
      /* 0.18.21 起编辑台等 11 个模块改成懒加载（lazydata.js 里动态 createElement('script')），
         jsdom 不会去下载，于是「开启自助编辑」后编辑器永远 boot 不起来 → 整页套件误判。
         这里把动态脚本的 src 拦截下来，直接 eval 源码。 */
      try {
        const origCreate = w.document.createElement.bind(w.document);
        w.document.createElement = function (tag) {
          const el = origCreate(tag);
          if (String(tag).toLowerCase() === 'script') {
            let _src = '';
            try {
              Object.defineProperty(el, 'src', {
                configurable: true,
                get() { return _src; },
                set(v) {
                  _src = v;
                  setTimeout(function () {
                    try {
                      const rel = String(v).replace(/^https?:\/\/[^/]+\//, '').split('?')[0].replace(/^\.?\//, '');
                      const txt = fs.readFileSync(BASE + rel, 'utf8');
                      w.eval(txt);
                      if (typeof el.onload === 'function') el.onload();
                    } catch (e) {
                      errors.push('lazy fail ' + v + ' :: ' + e.message);
                      if (typeof el.onerror === 'function') el.onerror(e);
                    }
                  }, 0);
                }
              });
            } catch (e) { errors.push('lazy hook: ' + e.message); }
          }
          return el;
        };
      } catch (e) { errors.push('lazy hook outer: ' + e.message); }
      if (before) { try { w.eval(before); } catch (e) { errors.push('beforeParse: ' + e.message); } }
    }
  });
  dom.window.addEventListener('error', e => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
  return { dom, w: dom.window, d: dom.window.document, errors };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEED_ON = { v: 3, editor: { enabled: true, userSet: true } };
const SEED_OFF = { v: 3, editor: { enabled: false, userSet: true } };
function mkRunner(name) {
  const log = [];
  return {
    name, log,
    ok: (c, m) => { log.push((c ? '  ✓ ' : '  ✗ ') + m); return !!c; },
    note: m => log.push('  · ' + m),
    section: m => log.push('\n[' + name + '] ' + m),
    done(errors) {
      const bad = log.filter(l => l.trim().startsWith('✗')).length;
      const total = log.filter(l => /[✓✗]/.test(l)).length;
      return { bad, total, log: log.join('\n'), errors: errors || [] };
    }
  };
}

/* ================= 套件 1：自助编辑器 ================= */
async function suiteEditor() {
  const R = mkRunner('editor');
  const FILES = ['data/config.js', 'data/resources.js', 'data/content.js', 'data/knowledge.js',
    'data/libraries.js', 'data/graph.js', 'data/avatars.js', 'data/overrides.js', 'assets/overlay.js', 'assets/editor.js'];
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errs.push('jsdomError: ' + (e.detail ? (e.detail.message || e.detail) : e.message)));
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>',
    { runScripts: 'dangerously', url: 'https://local.test/index.html', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window, d = w.document;
  w.addEventListener('error', e => errs.push('window.error: ' + (e.error && e.error.stack || e.message)));
  for (const f of FILES) { try { w.eval(fs.readFileSync(BASE + f, 'utf8')); } catch (e) { errs.push('EVAL ' + f + ': ' + e.message); } }
  await sleep(700);

  R.section('★ 默认关闭（新需求）');
  R.ok(w.YZY.editorEnabled() === false, '首次默认：自助编辑=关闭');
  R.ok(!d.getElementById('zzyBtn'), '关闭时不挂载 ✏️ 按钮');
  R.ok(typeof w.__yzEditorBoot === 'function', '仍保留 boot 钩子供设置页开启');
  w.YZY.setEditorEnabled(true); w.__yzEditorBoot(); await sleep(60);
  R.ok(!!d.getElementById('zzyBtn'), '开启后 ✏️ 按钮出现');
  R.ok(w.YZY.state().editor.userSet === true, '记录“用户已显式设置”');

  const clickText = (root, txt) => {
    const els = [...root.querySelectorAll('button,a')].filter(e => (e.textContent || '').includes(txt));
    if (!els.length) { R.ok(false, '找不到按钮: ' + txt); return null; }
    els[0].click(); return els[0];
  };
  const setv = (id, v) => { const e = d.getElementById(id); if (!e) { R.ok(false, '缺输入框 ' + id); return false; } e.value = v; return true; };

  R.section('挂载与标签页');
  R.ok(!!w.YZY, 'overlay v' + w.__YZY_OVERLAY_V);
  R.ok((w.SITE_RESOURCES || []).length >= 261, '资源 ' + ((w.SITE_RESOURCES || []).length) + ' 条（≥261）');
  R.ok(typeof w.YZY.storage === 'function', 'storage() 探测 → ' + w.YZY.storage().backend);
  const need = ['addResource', 'editResource', 'removeResource', 'renameCat', 'addCat', 'removeCat', 'editPerson', 'addPerson',
    'setAvatar', 'movePerson', 'newGraph', 'addGraphNode', 'addGraphEdge', 'setEdgeStyle', 'removeGraphNode', 'replaceGraphData',
    'stats', 'exportJSON', 'importJSON', 'reset', 'reapply', 'setEditorEnabled'];
  const miss = need.filter(k => typeof w.YZY[k] !== 'function');
  R.ok(!miss.length, 'YZY API 完整（缺失: ' + (miss.join(',') || '无') + '）');

  const btn = d.getElementById('zzyBtn'); if (!btn) return R.done(errs);
  btn.click(); const wrap = d.getElementById('zzyWrap');
  R.ok(wrap.classList.contains('open'), '面板打开');
  ['资源', '人物', '目录', '图谱', '数据'].forEach(t => { const b = errs.length; clickText(wrap, t); R.ok(!!wrap.querySelector('.zx') && errs.length === b, 'tab[' + t + '] 渲染无错误'); });

  R.section('新增资源 / 目录 / 人物');
  clickText(wrap, '资源'); clickText(wrap, '新增资源');
  R.ok(!!d.getElementById('zzyResForm_title'), '新增资源表单出现');
  setv('zzyResForm_title', '测试条目ABC'); setv('zzyResForm_cat', '测试目录'); setv('zzyResForm_author', '张三');
  clickText(wrap, '添加');
  R.ok(w.YZY.state().resources.added.length === 1, '新增资源写入覆盖层');
  R.ok((w.SITE_RESOURCES || []).some(r => r.title === '测试条目ABC'), '新资源即时生效（无需刷新）');
  clickText(wrap, '目录'); setv('zzyNewCat', '新民主主义时期'); clickText(wrap, '新增');
  R.ok((w.YZY.state().resources.catAdded || []).indexOf('新民主主义时期') >= 0, '新增目录已记录');
  clickText(wrap, '人物');
  /* 「革命导师」为内置固定五位、不提供新增（见 editor.js pplTab）：先切到「革命同志」再测新增 */
  const psel = wrap.querySelector('select');
  if (psel) { psel.value = 'comrades'; psel.dispatchEvent(new w.Event('change')); }
  clickText(wrap, '新增人物');
  R.ok(!!d.getElementById('zzyNewP_name'), '新增人物表单出现');
  setv('zzyNewP_name', '测试人物ABC'); setv('zzyNewP_intro', '测试人物介绍');
  /* 精确点「添加」（资源表单里也有「添加」，取最后一个＝刚打开的这张表） */
  {
    const btns = [...wrap.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === '添加');
    if (btns.length) btns[btns.length - 1].click();
    else R.ok(false, '找不到「添加」按钮');
  }
  R.ok(Object.keys(w.YZY.state().people.added).length >= 1, '新增人物写入覆盖层');
  const b1 = [...wrap.querySelectorAll('button')].find(b => b.textContent.includes('修改介绍'));
  R.ok(!!b1, '「修改介绍」按钮存在');
  if (b1) {
    b1.click(); R.ok(!!d.getElementById('zzyPplForm_intro'), '人物表单出现');
    setv('zzyPplForm_intro', '测试介绍XYZ'); clickText(wrap, '保存修改');
    R.ok(Object.keys(w.YZY.state().people.edited).length === 1, '人物改动写入');
  }
  R.ok(w.YZY.setAvatar('leaders|测试人物A', 'data:image/png;base64,iVBORw0KGgo=').ok, 'setAvatar 接受白名单 dataURL');
  R.ok(!w.YZY.setAvatar('leaders|x', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').ok, 'setAvatar 拒绝非白名单/超限');
  /* 新增人物表单的下拉里本来就没有「革命导师」（内置固定五位）→ 拒绝逻辑要直接测 API */
  {
    const _rej = w.YZY.addPerson({ name: '测试人物A', group: 'leaders' });
    R.ok(_rej && _rej.ok === false, '「革命导师」API 拒绝新增');
    R.ok(w.YZY.state().people.added.length === 1, '拒绝后仍为 1 条');
  }

  R.section('图谱 API');
  const g = w.YZY.newGraph('测试图谱'); R.ok(g.ok && g.name === '测试图谱', '新建图谱');
  R.ok(w.YZY.graphData().id === g.id, '新图谱已激活');
  const n1 = w.YZY.addGraphNode(undefined, { name: '甲', type: 'person' });
  const n2 = w.YZY.addGraphNode(undefined, { name: '乙', type: 'idea' });
  R.ok(n1.ok && n2.ok, '加两个节点');
  const e1 = w.YZY.addGraphEdge(undefined, { source: n1.id, target: n2.id, rel: '相关', color: '#8de6a1' });
  R.ok(e1.ok, '连线成功');
  let gd = w.YZY.graphData();
  R.ok(gd.nodes.length === 2 && gd.links.length === 1 && gd.links[0].color === '#8de6a1', '关系线与颜色已保存');
  w.YZY.setEdgeStyle(undefined, e1.key, { label: '思想来源', color: '#7ec8ff' });
  gd = w.YZY.graphData();
  R.ok(gd.links[0].rel === '思想来源' && gd.links[0].color === '#7ec8ff', '关系线改名+改色生效');
  w.YZY.removeGraphNode(undefined, n1.id); gd = w.YZY.graphData();
  R.ok(gd.nodes.length === 1 && gd.links.length === 0, '删节点连带删边');
  w.YZY.replaceGraphData(g.id, { nodes: [{ name: '甲', type: 'person' }, { name: '乙', type: 'idea' }], links: [{ source: 'a', target: 'b', rel: 'x' }] });
  R.ok(w.YZY.graphData().nodes.length === 2, 'replaceGraphData 整体替换（撤销用）');
  w.YZY.setActiveGraph('main'); R.ok(w.YZY.activeGraphId() === 'main', '切回主图谱');
  const mn = w.YZY.addGraphNode(undefined, { name: '主图新节点', type: 'person' });
  R.ok(mn.ok && (w.SITE_GRAPH.nodes || []).some(n => n.name === '主图新节点'), '主图谱加节点即时进入 SITE_GRAPH');
  w.YZY.removeGraphNode(undefined, mn.id);
  R.ok(!(w.SITE_GRAPH.nodes || []).some(n => n.name === '主图新节点'), '主图谱删节点生效');

  R.section('导出 / 导入 / 开关');
  const ej = w.YZY.exportJSON(); R.ok(typeof ej === 'string' && ej.length > 50, '导出 JSON');
  const before = w.YZY.stats().added; w.YZY.reset(); R.ok(w.YZY.stats().added === 0, 'reset 清空');
  const r = w.YZY.importJSON(ej, 'replace'); R.ok(r.ok && w.YZY.stats().added === before, '导入恢复');
  w.YZY.setEditorEnabled(false); R.ok(w.YZY.editorEnabled() === false, '编辑器开关可关'); w.YZY.setEditorEnabled(true);
  return R.done(errs);
}

/* ================= 套件 2：图谱编辑器 ================= */
async function suiteGraph() {
  const R = mkRunner('graph');
  const { w, d, errors } = loadPage('graph.html', 'https://local.test/graph.html?edit=1', SEED_ON);
  const pev = (type, x, y, id) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clientX', { value: x }); Object.defineProperty(e, 'clientY', { value: y });
    Object.defineProperty(e, 'pointerId', { value: id || 1 }); Object.defineProperty(e, 'button', { value: 0 });
    return e;
  };
  const btnByText = (t, root) => [...(root || d.getElementById('geDlg')).querySelectorAll('button')].find(b => b.textContent === t);
  await sleep(900);

  R.section('加载');
  R.ok(!!w.YZY, '覆盖层 v' + w.__YZY_OVERLAY_V + '，编辑器已启用');
  R.ok(typeof w.__geRebuild === 'function', '图谱编辑器加载');
  const BASE_N = (w.GR.nodes || []).length, BASE_L = (w.GR.links || []).length;
  R.ok(BASE_N >= 90 && BASE_L >= 200, '原图谱 ' + BASE_N + ' 节点 / ' + BASE_L + ' 关系');
  R.ok(w.__ge.isEdit() === true, '?edit=1 自动进入编辑模式');

  R.section('★ 事件能否到达按钮（v1 的真 bug）');
  const layer = d.getElementById('geLayer'), barEl = d.getElementById('geBar');
  R.ok(!!layer && !!barEl, '编辑覆盖层与工具栏存在');
  R.ok(layer.style.display === 'block', '编辑态覆盖层显示');
  R.ok(String(layer.style.zIndex) === '4', '覆盖层 z-index=4（>canvas，<页面UI 的 5）');
  const probe = (el, type) => { let hit = false; const h = () => { hit = true; }; el.addEventListener(type, h); el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true })); el.removeEventListener(type, h); return hit; };
  R.ok(probe(barEl.querySelector('button'), 'touchstart'), 'touchstart 能到达工具栏按钮（v1 在此被吞掉）');
  R.ok(probe(barEl.querySelector('button'), 'click'), 'click 能到达工具栏按钮');
  let covered = false; const lh = () => { covered = true; };
  layer.addEventListener('pointerdown', lh); layer.dispatchEvent(pev('pointerdown', 10, 10)); layer.removeEventListener('pointerdown', lh);
  R.ok(covered, '覆盖层收到 pointerdown（画布手势由它接管）');

  R.section('用 Pointer 走完编辑流程');
  w.YZY.newGraph('T5'); w.__ge.rebuild(false, true); await sleep(60);
  layer.dispatchEvent(pev('pointerdown', 200, 200)); layer.dispatchEvent(pev('pointerup', 200, 200)); await sleep(40);
  R.ok(!!d.getElementById('ge_name'), '点空白弹出「新建节点」（含引用入口）');
  R.ok(!!d.getElementById('ge_refpick'), '表单里有「引用已有节点」入口（不是原生 select）');
  d.getElementById('ge_name').value = '甲';
  btnByText('创建节点').click(); await sleep(80);
  R.ok(w.YZY.graphData().nodes.length === 1, '节点甲已创建');
  layer.dispatchEvent(pev('pointerdown', 400, 200)); layer.dispatchEvent(pev('pointerup', 400, 200)); await sleep(40);
  d.getElementById('ge_name').value = '乙'; d.getElementById('ge_type').value = 'idea';
  btnByText('创建节点').click(); await sleep(150);
  R.ok(w.YZY.graphData().nodes.length === 2, '节点乙已创建');
  const ns = w.ns;
  const sx = o => o.x * w.view.k + w.view.x, sy = o => o.y * w.view.k + w.view.y;
  layer.dispatchEvent(pev('pointerdown', sx(ns[0]), sy(ns[0]))); layer.dispatchEvent(pev('pointerup', sx(ns[0]), sy(ns[0]))); await sleep(30);
  layer.dispatchEvent(pev('pointerdown', sx(ns[1]), sy(ns[1]))); layer.dispatchEvent(pev('pointerup', sx(ns[1]), sy(ns[1]))); await sleep(30);
  R.ok(!!d.getElementById('ge_edge_rel'), '两点式连线：弹出关系对话框');
  d.getElementById('ge_edge_rel').value = '师承'; d.getElementById('ge_edge_hex').value = '#7ec8ff';
  btnByText('建立关系').click(); await sleep(150);
  let gd = w.YZY.graphData();
  R.ok(gd.links.length === 1 && gd.links[0].rel === '师承' && gd.links[0].color === '#7ec8ff', '连线成功且颜色/名称已保存');

  R.section('拖动节点并记住位置');
  layer.dispatchEvent(pev('pointerdown', sx(ns[0]), sy(ns[0])));
  layer.dispatchEvent(pev('pointermove', sx(ns[0]) + 60, sy(ns[0]) + 40));
  layer.dispatchEvent(pev('pointerup', sx(ns[0]) + 60, sy(ns[0]) + 40)); await sleep(60);
  const posObj = (w.YZY.state().graphs.nodePos[w.YZY.activeGraphId()] || {});
  R.ok(Object.keys(posObj).length > 0, '拖动后位置已写入存储');

  R.section('仅改样式不重排（性能）');
  const before = w.ns.map(o => ({ id: o.d.id, x: Math.round(o.x), y: Math.round(o.y) }));
  w.__ge.editEdge(w.es[0]); await sleep(20);
  d.getElementById('ge_edge_rel').value = '师从'; d.getElementById('ge_edge_hex').value = '#ff8b8b';
  btnByText('保存').click(); await sleep(150);
  const after = w.ns.map(o => ({ id: o.d.id, x: Math.round(o.x), y: Math.round(o.y) }));
  R.ok(w.YZY.graphData().links[0].rel === '师从', '改关系名成功');
  R.ok(JSON.stringify(before) === JSON.stringify(after), '仅改样式时节点坐标未被打乱（未重排）');

  R.section('布局分帧性能');
  const t1 = Date.now(); for (let i = 0; i < 30; i++) w.__ge.stepLayout(); const per = (Date.now() - t1) / 30;
  R.ok(per < 12, 'stepLayout 单次 ' + per.toFixed(2) + 'ms（<12ms）');

  R.section('撤销 / pointercancel / 退出编辑');
  w.__ge.undo(); await sleep(60);
  R.ok(w.YZY.graphData().links[0].rel === '师承', '撤销恢复上一步');
  layer.dispatchEvent(pev('pointerdown', 300, 300, 7)); layer.dispatchEvent(pev('pointercancel', 300, 300, 7));
  layer.dispatchEvent(pev('pointerdown', 305, 305, 8)); layer.dispatchEvent(pev('pointerup', 305, 305, 8)); await sleep(60);
  R.ok(d.getElementById('geDlg').style.display === 'flex', 'pointercancel 后状态复位，仍能发起新操作');
  const cc = btnByText('取消'); if (cc) cc.click();
  w.__ge.setMode(false);
  R.ok(layer.style.display === 'none', '退出编辑后覆盖层隐藏');
  R.ok(w.__ge.isEdit() === false, '编辑态已关闭');
  w.YZY.setActiveGraph('main'); w.__ge.rebuild(true, true); await sleep(120);
  R.ok((w.GR.nodes || []).length === BASE_N, '切回主图谱，节点数恢复 ' + BASE_N);
  return R.done(errors);
}

/* ================= 套件 3：主站整页冒烟 ================= */
async function suitePage() {
  const R = mkRunner('page');
  const { w, d, errors } = loadPage('index.html', 'https://local.test/index.html', SEED_ON);
  await sleep(900);
  R.section('加载');
  R.ok(!!w.YZY, '覆盖层加载');
  R.ok(typeof w.render === 'function', 'app.js 顶层 render() 可用');
  R.ok(typeof w.__yzRefreshLabels === 'function', '栏目改名热刷新钩子存在');
  R.ok(typeof w.toggleSelfEdit === 'function' && typeof w.syncSelfEditSwitch === 'function', '自助编辑开关函数存在');
  R.section('设置页');
  const sv = d.getElementById('settingsView');
  R.ok(!!d.getElementById('themeSeg'), '设置页有「主题」分组（自助编辑开关已移到史料页）');
  R.ok(sv.innerHTML.indexOf('导出我的数据') < 0, '设置页已不含「导出我的数据」（在账号页）');
  R.ok(sv.innerHTML.indexOf('导出我的数据') < 0 && sv.innerHTML.indexOf('清除本机数据') < 0, '设置页「数据」组已移走');
  R.ok(!/自 助 编 辑/.test(sv.innerHTML), '设置页不再有「自助编辑」分组（开关已移到史料页）');
  R.section('账号页');
  w.openAccountView(); const av = d.getElementById('accountView');
  R.ok(d.getElementById('drawerTitle').textContent.indexOf('账号') >= 0, '标题=账号');
  R.ok(av.innerHTML.indexOf('免费赞助') < 0, '账号页不再有免费赞助');
  R.ok(av.innerHTML.indexOf('导出我的数据') >= 0 && av.innerHTML.indexOf('导入我的数据') >= 0 && av.innerHTML.indexOf('清除本机数据') >= 0, '账号页有 导出/导入/清除');
  R.ok(av.querySelectorAll('.acct-item').length >= 7, '账号页条目用 acct-item 风格（' + av.querySelectorAll('.acct-item').length + ' 条）');
  R.section('开关联动');
  w.YZY.setEditorEnabled(true); w.syncSelfEditSwitch();
  /* 开关已从「设置页 editSw」挪到「个人中心 seState」（renderPc 里渲染） */
  R.ok(w.selfEditOn() === true, '开关状态函数 selfEditOn 与 YZY 一致（已开启）');
  w.toggleSelfEdit(); R.ok(w.YZY.editorEnabled() === false && w.selfEditOn() === false, 'toggleSelfEdit 关闭并同步状态');
  w.toggleSelfEdit(); R.ok(w.YZY.editorEnabled() === true, '再切换回开启');
  w.YZY.setEditorEnabled(true); w.__yzEditorBoot();
  w.openSelfEdit(); const wrap = d.getElementById('zzyWrap');
  R.ok(!!wrap && wrap.classList.contains('open'), '设置里「打开编辑器」能打开面板');
  R.ok(String(wrap.getAttribute('style') || '').indexOf('inset') < 0, '编辑器面板未使用 inset 简写（旧内核兼容）');
  w.openSettings(); R.ok(d.getElementById('drawerTitle').textContent.indexOf('设置') >= 0, '抽屉标题=设置（与 setTopbar 同步）');
  return R.done(errors);
}

/* ================= 套件 4：★ 跨“重启”持久化与幂等 ================= */
async function suitePersist() {
  const R = mkRunner('persist');
  /* ---- 第一次“打开 App” ---- */
  const A = loadPage('graph.html', 'https://local.test/graph.html?edit=1', SEED_ON);
  await sleep(900);
  R.section('第一次打开：编辑内置主图谱');
  const baseN = (A.w.SITE_GRAPH.nodes || []).length;
  R.ok(A.w.YZY.activeGraphId() === 'main', '当前是内置主图谱');
  const node = A.w.YZY.addGraphNode(undefined, { name: '持久化测试节点', type: 'person', desc: '用于验证刷新后仍在' });
  R.ok(node && node.ok, '新增节点到主图谱');
  A.w.YZY.setNodePos(undefined, node.id, { x: 123, y: -45 });
  const e = A.w.YZY.addGraphEdge(undefined, { source: node.id, target: 'marx', rel: '测试关系', color: '#63e6be' });
  R.ok(e && e.ok, '主图谱新增关系');
  A.w.YZY.setNodeStyle(undefined, node.id, { color: '#ff8b8b' });
  const raw = A.w.localStorage.getItem(KEY);
  R.ok(typeof raw === 'string' && raw.length > 20, '已落盘到本机存储（' + (raw || '').length + ' 字节）');
  R.ok(JSON.parse(raw).graphs.nodePos.main[node.id].x === 123, '存储里带有位置 x=123');

  /* ---- 模拟“关掉 App 再打开 / 网页刷新” ---- */
  const B = loadPage('graph.html', 'https://local.test/graph.html', raw);
  await sleep(900);
  R.section('★ 重启后：内置主图谱的编辑是否还在');
  const gb = B.w.YZY.graphData('main');
  const got = gb.nodes.filter(x => x.id === node.id)[0];
  R.ok(!!got, '重启后新增节点仍在');
  R.ok((B.w.SITE_GRAPH.nodes || []).length === baseN + 1, 'SITE_GRAPH 节点数 = 原 ' + baseN + ' + 1');
  R.ok(gb.links.some(l => l.source === node.id || l.target === node.id), '重启后新增关系仍在');
  R.ok(got && got.x === 123 && got.y === -45, '★ 重启后节点位置仍在（x/y 已写回内置数据）');
  R.ok(got && got.color === '#ff8b8b', '重启后节点颜色仍在');
  R.section('幂等性（重复 apply 不漂移）');
  for (let i = 0; i < 5; i++) { B.w.YZY.reapply(); }
  const b2 = B.w.YZY.graphData('main');
  R.ok((B.w.SITE_GRAPH.nodes || []).filter(x => x.id === node.id).length === 1, '重复 apply 不重复 push（只有 1 个）');
  R.ok((B.w.SITE_GRAPH.nodes || []).length === baseN + 1, '重复 apply 节点总数不漂移');
  R.ok(b2.links.filter(l => l.rel === '测试关系').length === 1, '重复 apply 关系不重复');
  const posCount = Object.keys(JSON.parse(B.w.localStorage.getItem(KEY) || '{}').graphs.nodePos.main || {}).length;
  R.ok(posCount === 1, '位置表未被重复写入污染（' + posCount + ' 条）');
  R.section('★ 布局按保存的位置摆放');
  B.w.__ge.rebuild(false, false); await sleep(60);
  const o = (B.w.ns || []).filter(x => x.d.id === node.id)[0];
  R.ok(!!o && Math.round(o.x) === 123 && Math.round(o.y) === -45, '画布上该节点坐标 = (123, -45)');
  R.ok(!!(o && o.pinned), '该节点被标记 pinned（不被后续布局搬走）');
  R.section('自建图谱的持久化');
  const g2 = B.w.YZY.newGraph('重启测试谱');
  const u1 = B.w.YZY.addGraphNode(undefined, { name: '甲一', type: 'person' });
  B.w.YZY.addGraphNode(undefined, { name: '乙二', type: 'org' });
  B.w.YZY.addGraphEdge(undefined, { source: u1.id, target: (B.w.YZY.graphData().nodes[1] || {}).id, rel: '关联', color: '#ffd166' });
  const raw2 = B.w.localStorage.getItem(KEY);
  const C = loadPage('graph.html', 'https://local.test/graph.html', raw2);
  await sleep(900);
  R.ok(C.w.YZY.activeGraphId() === g2.id, '重启后仍停在上次的自建图谱');
  const gc = C.w.YZY.graphData();
  R.ok(gc.nodes.length === 2 && gc.links.length === 1, '自建图谱的节点与关系仍在（2 节点 / 1 关系）');
  R.ok(!!(C.w.GR && C.w.GR.nodes.length === 2), '页面按自建图谱渲染');
  return R.done([...A.errors, ...B.errors, ...C.errors]);
}

/* ================= 套件 5：★ 清屏 / 按钮精简 / 总开关 / 引用列表 ================= */
async function suiteUI() {
  const R = mkRunner('ui');
  const { w, d, errors } = loadPage('graph.html', 'https://local.test/graph.html?edit=1', SEED_ON);
  await sleep(900);

  R.section('★ 按钮精简');
  const barEl = d.getElementById('geBar');
  const labels = [...barEl.querySelectorAll('button')].map(b => b.textContent);
  R.note('工具栏按钮：' + JSON.stringify(labels));
  R.ok(labels.length === 3, '工具栏只剩 3 个按钮（' + labels.length + '）');
  R.ok(!labels.some(t => /适应窗口|放大|缩小/.test(t)), '不再有 适应窗口/放大/缩小（页面本身已有 / 捏合缩放）');
  R.ok(!labels.some(t => /新建图谱|重命名|删除图谱|返回主图谱/.test(t)), '新建/重命名/删除/返回 已收进「🗂 图谱」弹窗');
  R.section('★ 图谱弹窗（切换+新建+重命名+删除 合一）');
  w.__ge.openGraphSheet(); await sleep(30);
  R.ok(!!d.getElementById('ge_graph_list'), '「图谱」弹窗打开且有列表');
  R.ok(d.querySelectorAll('#ge_graph_list [data-gid]').length >= 1, '列表里有可切换的图谱行');
  R.ok(!!d.getElementById('ge_new_graph'), '弹窗内有「新建图谱」');
  R.ok(!d.getElementById('ge_rename_graph') && !d.getElementById('ge_del_graph'), '主图谱下不显示 重命名/删除（内置不可改）');
  [...d.querySelectorAll('#geDlg button')].find(b => b.textContent === '关闭').click();
  const g = w.YZY.newGraph('UI测试谱'); w.__ge.rebuild(true, true); await sleep(60);
  w.__ge.openGraphSheet(); await sleep(30);
  R.ok(!!d.getElementById('ge_rename_graph') && !!d.getElementById('ge_del_graph'), '自建图谱下出现 重命名/删除');
  [...d.querySelectorAll('#geDlg button')].find(b => b.textContent === '关闭').click();

  R.section('★ 引用节点：可搜索列表 + 能引用内置主图谱');
  const groups = w.__ge.refCandidates();
  R.ok(groups.length >= 1 && /内置主图谱/.test(groups[0].label), '候选里有「内置主图谱」（' + (groups[0] ? groups[0].label : '无') + '）');
  R.ok((groups[0] ? groups[0].items.length : 0) >= 90, '内置主图谱可引用节点 >=90 个（' + (groups[0] ? groups[0].items.length : 0) + '）');
  R.ok(!groups.some(gr => gr.items.some(it => (w.YZY.graphData().nodes || []).some(n => n.id === it.id))), '候选已排除本图谱已有节点（避免重复）');
  w.__ge.pickerSheet({ title: '引用已有节点', groups: groups, allowNone: true, noneText: '— 不引用，新建 —' });
  await sleep(30);
  R.ok(!!d.getElementById('ge_pick_q'), '列表弹层带搜索框（不是原生 select）');
  R.ok(!d.querySelector('#geDlg select'), '没有 100+ 项的原生 <select>（Android WebView 会卡）');
  const first = d.querySelector('#ge_pick_list [data-pick]');
  R.ok(!!first, '列表有可点条目');
  const rows = d.querySelectorAll('#ge_pick_list .btn, #ge_pick_list button').length;
  R.ok(rows > 0, '条目以可点行渲染（' + rows + ' 行）');
  d.getElementById('ge_pick_q').value = '马克思';
  d.getElementById('ge_pick_q').dispatchEvent(new w.Event('input', { bubbles: true }));
  await sleep(20);
  R.ok(d.querySelectorAll('#ge_pick_list [data-pick]').length >= 1, '搜索过滤生效（含“马克思”）');
  [...d.querySelectorAll('#geDlg button')].find(b => b.textContent === '取消').click();

  R.section('★ 清屏模式：隐藏所有编辑 UI');
  R.ok(w.__ge.isEdit() === true, '开始前处于编辑模式');
  d.body.classList.add('clean');
  await sleep(60);
  R.ok(barEl.style.display === 'none', '清屏后工具栏隐藏');
  R.ok(d.getElementById('geTag').style.display === 'none', '清屏后状态标签隐藏');
  R.ok(w.__ge.isEdit() === false, '清屏后自动退出编辑模式');
  R.ok(!d.getElementById('geEmpty') || d.getElementById('geEmpty').style.display === 'none', '清屏后空图谱提示隐藏');
  d.body.classList.remove('clean');
  await sleep(60);
  R.ok(barEl.style.display !== 'none', '退出清屏后工具栏恢复');
  R.ok(d.getElementById('geTag').style.display !== 'none', '退出清屏后状态标签恢复');

  R.section('★ 主站“首次打开”：默认关闭');
  const F = loadPage('index.html', 'https://local.test/index.html');   // 不注入任何存储 = 全新用户
  await sleep(900);
  R.ok(F.w.YZY.editorEnabled() === false, '主站首次打开：自助编辑默认关闭');
  /* 开关本体在「史料页」的 qqquick 行（seState），不在设置页。
     这里直接断言状态函数（DOM 位置会随页面结构调整，别让测试绑死在某个 id 上）。 */
  R.ok(F.w.selfEditOn() === false, '默认关闭（selfEditOn=false）');
  R.ok(!F.d.getElementById('zzyBtn'), '主站首次打开不挂载 ✏️ 按钮');
  F.w.toggleSelfEdit(); await sleep(60);
  R.ok(F.w.YZY.editorEnabled() === true && !!F.d.getElementById('zzyBtn'), '用户手动开启后才出现 ✏️');

  R.section('★ 总开关关闭：图谱页不显示任何编辑相关');
  const OFF = loadPage('graph.html', 'https://local.test/graph.html?edit=1', SEED_OFF);
  await sleep(900);
  R.ok(OFF.w.YZY.editorEnabled() === false, '自助编辑处于关闭');
  R.ok(!OFF.d.getElementById('geBar'), '关闭时不建工具栏');
  R.ok(!OFF.d.getElementById('geLayer'), '关闭时不建编辑覆盖层');
  R.ok(!OFF.d.getElementById('geTag'), '关闭时不建状态标签');
  R.ok(!OFF.d.getElementById('geDlg'), '关闭时不建弹窗');
  R.ok(!OFF.d.getElementById('geEmpty'), '关闭时不建空图谱提示');
  R.ok(typeof OFF.w.__ge === 'undefined', '关闭时编辑器整体未加载');
  return R.done([...errors, ...OFF.errors]);
}

/* ========== 套件 6：F-Droid 合规 ——「本地站点运行器 / 网盘」已彻底移除 ========== */
async function suiteSite() {
  const R = mkRunner('site');
  const F = loadPage('index.html', 'https://local.test/index.html');
  await sleep(900);
  const { w, d } = F;

  R.section('★ 已移除「本地站点运行器」（入口 / 模块 / 桥方法）');
  R.ok(!d.querySelector('[data-cat="本地站点"]'), '首页无「本地站点」目录卡片');
  R.ok(!d.querySelector('[data-cat="我的文档"]'), '也无旧的「我的文档」入口');
  ['openSites','siteImportZip','siteOpen','siteFiles','siteViewFile','siteRename','siteDel','siteClearAll'].forEach(n => {
    R.ok(typeof w[n] !== 'function', 'window.' + n + ' 已移除');
  });
  R.ok(!w.__sites, '不再暴露 __sites 模块');
  R.ok(!(w.PLUGINS || []).some(p => p && p.id === 'sites'), '插件列表里不再有「本地站点运行器」');

  R.section('★ 已移除「网盘」补充来源');
  R.ok(typeof w.netdisksHTML !== 'function' && typeof w.firstNetdiskFor !== 'function' && typeof w.netdisksFor !== 'function',
       '网盘相关函数已移除');

  R.section('★ 代码里不再残留引用');
  const appjs = fs.readFileSync(BASE + 'assets/app.js', 'utf8');
  R.ok(!/openSites|netdisksHTML|firstNetdiskFor|netdisksFor|siteClear/.test(appjs), 'app.js 无残留引用');
  const sw = fs.readFileSync(BASE + 'sw.js', 'utf8');
  R.ok(!/serveLocalSite|openSitesDb|yzy_sites/.test(sw), 'sw.js 无「本地站点」虚拟托管');
  R.ok(!fs.existsSync(BASE + 'assets/sites.js'), 'assets/sites.js 已删除');
  R.ok(!fs.existsSync(BASE + 'data/netdisks.js'), 'data/netdisks.js 已删除');
  return R.done(F.errors);
}

/* ================= 套件 7：主题跟随系统 ================= */
async function suiteTheme() {
  const R = mkRunner('theme');

  R.section('★ 默认 = 跟随系统（auto）');
  const A = loadPage('index.html', 'https://local.test/index.html');
  await sleep(900);
  R.ok(A.w.localStorage.getItem('theme') === 'auto', '首次打开：theme=auto');
  const btnAuto = A.d.querySelector('#themeSeg button[data-th="auto"]');
  R.ok(!!btnAuto, '设置里出现「跟随系统」按钮');
  R.ok(btnAuto && btnAuto.classList.contains('active'), '「跟随系统」处于选中态');
  R.ok(A.d.querySelector('meta[name="theme-color"]').getAttribute('content') === '#2b0505', '系统为深色时 theme-color 为深色');

  R.section('★ 显式选择「浅色」：老用户的选择被尊重');
  const B = loadPage('index.html', 'https://local.test/index.html', null,
    "try{localStorage.setItem('theme','light')}catch(e){}");
  await sleep(900);
  R.ok(B.d.body.classList.contains('light'), 'body.light 已应用');
  R.ok(B.d.querySelector('#themeSeg button[data-th="light"]').classList.contains('active'), '「浅色」按钮选中');
  R.ok(B.d.querySelector('meta[name="theme-color"]').getAttribute('content') === '#f5e9e2', 'theme-color 同步为浅色');

  R.section('切换');
  B.w.setTheme('sepia'); await sleep(30);
  R.ok(!B.d.body.classList.contains('sepia') && !B.d.querySelector('#themeSeg button[data-th="sepia"]'), '「护眼」已移除（setTheme(sepia) 不再生效）');
  B.w.setTheme('auto'); await sleep(30);
  R.ok(B.w.localStorage.getItem('theme') === 'auto', 'setTheme(auto) 已持久化');
  R.ok(B.d.querySelector('#themeSeg button[data-th="auto"]').classList.contains('active'), '切回 auto 后按钮态正确');
  return R.done([...A.errors, ...B.errors]);
}

/* ================= 套件 8：自助编辑工具栏（位置 / 尺寸 / 不遮挡） ================= */
async function suiteBar() {
  const R = mkRunner('bar');
  const G = loadPage('graph.html', 'https://local.test/graph.html?edit=1', SEED_ON);
  await sleep(900);
  const { w, d } = G;

  R.section('★ 工具栏结构：3 个按钮、无内联定位（便于响应式）');
  const bar = d.getElementById('geBar');
  R.ok(!!bar, '工具栏存在');
  R.ok(bar.style.position === '' && bar.style.bottom === '' && bar.style.right === '',
    '工具栏不再用内联定位（交给样式表，窄屏才能改写）');
  const btns = [...bar.querySelectorAll('button')];
  R.ok(btns.length === 3, '按钮精简为 3 个（实为 ' + btns.length + '）');
  R.ok(btns.every(b => b.classList.contains('ge-btn')), '按钮统一使用 .ge-btn 类');
  R.ok(btns.every(b => !b.style.cssText), '按钮无内联样式');
  const labels = btns.map(b => b.textContent);
  R.ok((labels[0] === '✏️ 编辑' || labels[0] === '✔ 完成') && labels[1] === '🗂 图谱' && labels[2] === '↶ 撤销',
    '按钮文案：编辑（态）/ 图谱 / 撤销 —— 实为 ' + labels.join('|'));
  R.ok(!btns.some(b => /适应窗口|放大|缩小/.test(b.textContent)), '★ 不再重复页面已有的适应窗口 / 放大 / 缩小');
  R.ok(btns.every(b => (b.title || '').length > 3), '每个按钮都有 title 说明');

  R.section('★ 窄屏样式：贴右侧、竖排、缩小、避让');
  const css = (d.getElementById('geStyle') || {}).textContent || '';
  R.ok(/#geBar\{position:fixed;right:10px;bottom:10px/.test(css), '宽屏默认：右下角');
  R.ok(/@media\(max-width:620px\)/.test(css), '存在窄屏媒体查询');
  R.ok(/#geBar\{right:6px;top:57%;bottom:auto;transform:translateY\(-50%\)/.test(css), '窄屏：贴右侧 + 竖向偏下（已按反馈下移）');
  R.ok(/#geBar \.ge-btn\{padding:9px 10px;font-size:\.68rem;min-height:40px/.test(css), '窄屏：按钮更小（40px / .68rem）');
  R.ok(/#panel\.open~#geBar/.test(css), '介绍面板打开时工具栏避让');

  R.section('★ 几何校验：不再压住底部搜索/筛选面板');
  const H = 640, trBottom = 46, trHeight = 132;
  const barH = 3 * 40 + 2 * 6;
  const barTop = H * 0.57 - barH / 2, barBottom = H * 0.57 + barH / 2;
  const trTopFromBottom = trBottom + trHeight;
  const barLowestFromBottom = H - barBottom;
  R.ok(barLowestFromBottom > trTopFromBottom,
    '工具栏下沿(' + barLowestFromBottom + 'px) 高于底部面板上沿(' + trTopFromBottom + 'px) —— 无遮挡');
  R.ok(barTop > 0 && barBottom < H, '工具栏完整落在屏幕内');
  return R.done(G.errors);
}

/* ================= 主入口 ================= */
(async () => {
  const which = process.argv[2] || 'all';
  const suites = [];
  if (which === 'all' || which === 'editor') suites.push(['编辑器组件级', suiteEditor]);
  if (which === 'all' || which === 'graph') suites.push(['图谱编辑器', suiteGraph]);
  if (which === 'all' || which === 'page') suites.push(['主站整页冒烟', suitePage]);
  if (which === 'all' || which === 'persist') suites.push(['★持久化与幂等', suitePersist]);
  if (which === 'all' || which === 'ui') suites.push(['★清屏/精简/开关', suiteUI]);
  if (which === 'all' || which === 'site') suites.push(['★本地站点', suiteSite]);
  if (which === 'all' || which === 'theme') suites.push(['★主题跟随系统', suiteTheme]);
  if (which === 'all' || which === 'bar') suites.push(['★自助编辑工具栏', suiteBar]);
  let bad = 0, total = 0, allErr = [];
  for (const [name, fn] of suites) {
    let r;
    try { r = await fn(); }
    catch (e) { r = { bad: 1, total: 0, log: '', errors: ['套件异常: ' + e.stack] }; }
    console.log('\n================ ' + name + ' ================');
    console.log(r.log);
    console.log('—— ' + name + '：失败 ' + r.bad + ' / 断言 ' + r.total + '，JS 错误 ' + r.errors.length + (r.errors.length ? '\n' + r.errors.join('\n') : ''));
    bad += r.bad; total += r.total; allErr = allErr.concat(r.errors);
  }
  console.log('\n########## 合计：断言 ' + total + ' 项，失败 ' + bad + ' 项，JS 错误 ' + allErr.length + ' ##########');
  process.exit(bad || allErr.length ? 1 : 0);
})();
