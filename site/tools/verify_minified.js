#!/usr/bin/env node
/* 压缩产物的守门员（2026-11-14）
 *
 * 为什么需要它：Pages 部署前会把 assets/*.js 与 data/*.js 过一遍 terser（约 -40%），
 * 而仓库里的测试全跑在**未压缩源码**上——压缩这一步过去没有任何验证。terser 一旦
 * 在某个文件上出错（新版语法、正则字面量里的括号、模板字符串里的 ${}），
 * 坏文件会直接发到线上，而 CI 是绿的。
 *
 * 这个脚本用 jsdom 把压缩后的 index.html 真跑一遍，只查「模块有没有起来」，
 * 不查任何源码文本（压缩过的文件谈不上文本形态），所以它对压缩产物和对源码都成立。
 *
 * 用法：node site/tools/verify_minified.js site
 *       （需要 jsdom：npm i jsdom）
 */
const fs = require('fs');
const path = require('path');

const SITE = (process.argv[2] || 'site').replace(/\/+$/, '') + '/';
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  console.log('⏭ 跳过：没有 jsdom（npm i jsdom 后再跑）');
  process.exit(0);
}

let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => { if (!/Not implemented|Could not parse CSS/.test(e.message)) errs.push(e.message); });
vc.on('error', m => errs.push(String(m)));

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

/* 首屏必须起来的模块。压缩把顶层函数名 mangle 掉不影响它们——
   这些都是挂到 window 上的对象，名字是字符串赋值，terser 不会动。
   注意：语音/导出/引文比对/自测是 YZData.need 按需加载，不在首屏，别放进这个表
   （放进来就是给自己造假红）。 */
const MUST = ['YZChanges', 'YZSave', 'YZAppBooks', 'YZStudy', 'YZDATAMAP', '__appBack'];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => { };
    w.matchMedia = () => ({ matches: false, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } });
  }
});
const w = dom.window, d = dom.window.document;

setTimeout(function () {
  console.log('===== 压缩产物装载检查：' + SITE + ' =====');
  ok('没有未捕获的脚本错误', errs.length === 0, errs.slice(0, 3).join(' / '));
  ok('index.html 有列表容器', !!d.getElementById('list'));

  const RES = w.RES || (w.SITE_RESOURCES || null);
  ok('书库数据已加载', Array.isArray(RES) && RES.length > 0, RES ? RES.length + ' 条' : '无');

  const miss = MUST.filter(k => !w[k]);
  ok('关键模块都在（' + MUST.length + ' 个）', miss.length === 0, miss.join(', ') || '全在');

  /* 图谱数据不在首页加载（首页只引 graph-extra / knowledge / entity），
     所以这里不查「首页有没有图谱」，而是单独把 data/graph.js 拿去执行一遍，
     确认这个最大的数据文件压缩后仍然是一份能解析、节点非空的数据。 */
  try {
    const vm = require('vm');
    const ctx = { console, document: {}, localStorage: { getItem() { return null; }, setItem() { } }, navigator: {}, location: {} };
    ctx.window = ctx; ctx.self = ctx;
    vm.runInNewContext(fs.readFileSync(path.join(SITE, 'data/graph.js'), 'utf8'), ctx, { timeout: 20000 });
    const G = ctx.SITE_GRAPH;
    ok('data/graph.js 压缩后仍可执行', !!(G && G.nodes && G.nodes.length > 0), G && G.nodes ? G.nodes.length + ' 节点 / ' + (G.links || []).length + ' 边' : '无');
  } catch (e) {
    ok('data/graph.js 压缩后仍可执行', false, e.message);
  }

  /* 可读优先（2026-11-14）：默认视图必须只含有正文的条目 */
  try {
    w.location.hash = '#browse';
    w.render();
    const cards = Array.from(d.querySelectorAll('#list .card'));
    const idxs = cards.map(el => { const m = (el.getAttribute('onclick') || '').match(/cardAction\((\d+)\)/); return m ? Number(m[1]) : -1; }).filter(i => i >= 0);
    const noBody = idxs.filter(i => RES[i] && !w.hasBody(RES[i]));
    ok('默认视图只列可读条目', cards.length > 0 && noBody.length === 0, cards.length + ' 张，无正文 ' + noBody.length + ' 张');
  } catch (e) {
    ok('默认视图只列可读条目', false, '渲染失败：' + e.message);
  }

  console.log('\n########## 装载检查：' + (pass + fail) + ' 项（通过 ' + pass + ' / 失败 ' + fail + '）##########');
  process.exit(fail ? 1 : 0);
}, 1200);
