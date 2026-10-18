#!/usr/bin/env node
/* 学通 · 代码体检（防"屎山"）
   ---------------------------------------------------------------------
   用法：
     node tools/audit_code.js            # 仅报告（始终退出码 0）
     node tools/audit_code.js --strict   # 发现问题时退出码 1（可用于 CI 拦截）

   检查项：
     A. ★调用了但从未定义的函数（历史事故：工具栏变量 bar 覆盖了辅助函数 bar()，
        一开页面就 "bar is not a function"）
     B. 定义了却无人调用的函数（冗余）
     C. 内联事件里引用但未定义的处理函数（onclick="xxx()"）
     D. 顶层 const/let/var 定义后从未使用
     E. 同一 HTML 内重复的 id
     F. CSS 里定义但页面从未引用的类
     G. 同一 CSS 文件内重复的选择器（潜在"层叠屎山"）
     H. 数据文件里同一集合内重复的 id
     I. 站点里既没被引用、也没被动态加载的资源文件

   A–D 基于真正的 JS 语法树（acorn）：不会再被字符串里的 CSS 函数、注释里的名字干扰。
   acorn 优先从本机已有的 node_modules 里取；找不到时自动降级为"正则粗测"并明确提示。
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const read = p => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch (e) { return ''; } };
const exists = p => { try { return fs.statSync(path.join(root, p)).isFile(); } catch (e) { return false; } };

let acorn = null, acornVer = '';
for (const c of ['acorn', path.join(root, 'node_modules/acorn'), path.join(root, '../node_modules/acorn')]) {
  try {
    const m = require(c);
    if (m && m.parse) {
      acorn = m;
      try {
        let d = path.dirname(require.resolve(c));
        for (let k = 0; k < 4; k++) {
          const pj = path.join(d, 'package.json');
          if (fs.existsSync(pj)) { const j = JSON.parse(fs.readFileSync(pj, 'utf8')); if (j.name === 'acorn') { acornVer = j.version; break; } }
          d = path.dirname(d);
        }
      } catch (e) {}
      break;
    }
  } catch (e) {}
}

const JS_FILES = ['assets/app.js', 'assets/overlay.js', 'assets/editor.js', 'assets/graph-edit.js',
  'data/config.js', 'data/content.js', 'data/graph.js', 'data/graph-wenge.js', 'data/graph-world.js', 'data/knowledge.js', 'data/libraries.js',
  'data/overrides.js', 'data/resources.js', 'data/avatars.js'].filter(exists);
const HTML_FILES = ['index.html', 'graph.html', 'graph3d.html', 'card.html', '404.html', 'offline.html', 'privacy.html', 'licenses.html'].filter(exists);

const VENDOR = new Set();            /* vendor 库导出的全局名（qrcode / JSZip …） */
['assets/vendor/qrcode.min.js', 'assets/vendor/jszip.min.js'].filter(exists).forEach(f => {
  const v = read(f);
  [...v.matchAll(/\bvar\s+([A-Za-z_$][\w$]*)\s*=/g)].forEach(m => VENDOR.add(m[1]));
  [...v.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].forEach(m => VENDOR.add(m[1]));
});
/* lib/ 下自托管的第三方库（UMD/全局导出名）：显式列出，避免整包扫描把内部变量误当全局 */
['ForceGraph3D', 'THREE', 'JSZip', 'QRCode', 'pdfjsLib', 'ePub'].forEach(n => VENDOR.add(n));

const SRC = {};
JS_FILES.forEach(f => SRC[f] = read(f));
const HTML = {};
HTML_FILES.forEach(f => {
  const h = read(f); HTML[f] = h;
  [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].forEach((m, i) => {
    if (m[1].trim()) SRC[f + ' · 内联' + (i ? i + 1 : '')] = m[1];
  });
});
const allRaw = Object.values(SRC).join('\n');
const allHtml = Object.values(HTML).join('\n');

let issues = 0;
const note = m => { issues++; console.log('  ⚠️ ' + m); };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (re, s) => ((s.match(re) || []).length);

const BUILTIN = new Set(['console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'fetch', 'alert', 'confirm', 'prompt', 'print', 'open',
  'close', 'scroll', 'scrollTo', 'scrollBy', 'btoa', 'atob', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'String', 'Number', 'Boolean', 'Object', 'Array',
  'JSON', 'Math', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy', 'Reflect', 'Error',
  'TypeError', 'RangeError', 'SyntaxError', 'EvalError', 'Function', 'getComputedStyle', 'matchMedia', 'structuredClone',
  'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'FormData', 'Headers', 'Request', 'Response', 'AbortController',
  'AbortSignal', 'TextEncoder', 'TextDecoder', 'indexedDB', 'localStorage', 'sessionStorage', 'crypto', 'Image', 'Audio',
  'Event', 'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'XMLHttpRequest', 'WebSocket',
  'Worker', 'Notification', 'CSS', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'SharedArrayBuffer', 'BigInt', 'Intl', 'DOMException', 'Node',
  'Element', 'HTMLElement', 'getSelection', 'dispatchEvent', 'addEventListener', 'removeEventListener', 'postMessage',
  'DOMParser', 'NodeFilter', 'Range', 'TreeWalker', 'WeakRef', 'FinalizationRegistry', 'globalThis', 'escape', 'unescape',
  'require', 'process', 'module', 'exports', 'define', 'JSZip', 'QRCode', 'epub', 'epubjs', 'pdfjsLib', 'arguments', 'this']);

console.log('学通 · 代码体检（' + JS_FILES.length + ' 个 JS / ' + HTML_FILES.length + ' 个 HTML；' +
  (acorn ? '语法树模式 acorn ' + (acornVer || '?') : '正则降级模式（未找到 acorn）') + '）\n');

/* ---------------- 收集声明 / 引用 / 调用 ---------------- */
const declared = new Set();      /* 函数名 / 变量名 / 类名 */
const refs = new Map();          /* 名字 -> 被引用次数 */
const called = new Map();        /* 名字 -> 被调用次数 */
const declaredFn = new Set(), declaredTopVar = new Set();
const parseFail = [];

function pat(node) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': declared.add(node.name); return;
    case 'ObjectPattern': node.properties.forEach(p => pat(p.value || p.argument || p)); return;
    case 'ArrayPattern': node.elements.forEach(pat); return;
    case 'AssignmentPattern': pat(node.left); return;
    case 'RestElement': pat(node.argument); return;
  }
}
function walk(node, fn, parent, key) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => walk(n, fn, parent)); return; }
  if (typeof node.type === 'string') fn(node, parent, key);
  for (const k in node) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (v && typeof v === 'object') walk(v, fn, node, k);
  }
}

Object.entries(SRC).forEach(([f, src]) => {
  if (!acorn) return;
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); }
  catch (e) { parseFail.push(f + ': ' + e.message); return; }

  /* 顶层声明（供 D 用）*/
  (ast.body || []).forEach(st => {
    if (st.type === 'VariableDeclaration') st.declarations.forEach(dc => {
      if (dc.id && dc.id.type === 'Identifier') declaredTopVar.add(dc.id.name);
    });
    if (st.type === 'FunctionDeclaration' && st.id) declaredFn.add(st.id.name);
  });

  walk(ast, (n, p) => {
    if (n.type === 'FunctionDeclaration') { if (n.id) { declared.add(n.id.name); declaredFn.add(n.id.name); } (n.params || []).forEach(pat); return; }
    if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') { (n.params || []).forEach(pat); return; }
    if (n.type === 'ClassDeclaration') { if (n.id) declared.add(n.id.name); return; }
    if (n.type === 'VariableDeclarator') { if (n.id && n.id.type === 'Identifier') declared.add(n.id.name); pat(n.id); return; }
    if (n.type === 'CatchClause' && n.param) { pat(n.param); return; }
    if (n.type === 'AssignmentExpression' && n.left && n.left.type === 'MemberExpression' && !n.left.computed &&
        n.left.object && n.left.object.type === 'Identifier' &&
        /^(window|globalThis|self)$/.test(n.left.object.name) && n.left.property && n.left.property.type === 'Identifier') {
      declared.add(n.left.property.name); return;
    }
    if (n.type === 'Identifier') {
      if (p && (p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression') &&
          (p.id === n || (p.params || []).indexOf(n) >= 0)) return;
      if (p && p.type === 'VariableDeclarator' && p.id === n) return;
      if (p && p.type === 'ClassDeclaration' && p.id === n) return;
      if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return;
      if (p && p.type === 'Property' && p.key === n && !p.computed) return;
      refs.set(n.name, (refs.get(n.name) || 0) + 1);
      if (p && (p.type === 'CallExpression' || p.type === 'NewExpression') && p.callee === n) {
        called.set(n.name, (called.get(n.name) || 0) + 1);
      }
    }
  });
});

if (parseFail.length) parseFail.forEach(m => note('语法解析失败：' + m));

/* ---------------- A. 调用了但未定义 ---------------- */
console.log('— A. 调用但未定义的函数/变量（最致命）—');
const bad = [];
called.forEach((c, n) => { if (!declared.has(n) && !BUILTIN.has(n) && !VENDOR.has(n)) bad.push(n); });
if (!acorn) {
  console.log('  ⚠️⚠️ 严重：未找到 acorn → 已降级为「正则粗测」，下面 A/C/D 项全是误报，请勿据此改代码！');
  console.log('     修复：在本目录执行 npm i acorn，或把 acorn 放进 node_modules。');
  console.log('  · 以下仅为粗测结果：');
  const re = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  const found = new Map();
  Object.entries(SRC).forEach(([f, src]) => {
    let m; const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
    while ((m = re.exec(clean))) {
      const nm = m[1];
      if (BUILTIN.has(nm) || declared.has(nm) || /^(if|for|while|switch|catch|return|typeof|function|new|do|else)$/.test(nm)) continue;
      if (!found.has(nm)) found.set(nm, new Set());
      found.get(nm).add(f);
    }
  });
  if (!found.size) console.log('  ✅ 粗测未发现悬空调用');
  else found.forEach((fs, nm) => note('可能悬空：' + nm + '  ← ' + [...fs].join(', ')));
} else if (bad.length) bad.forEach(n => note('调用了但未定义：' + n + ' ×' + called.get(n)));
else console.log('  ✅ 无悬空调用（' + called.size + ' 个被调用的函数名全部有定义）');

/* ---------------- B. 定义了但无人调用 ---------------- */
console.log('\n— B. 定义但未使用的函数 —');
let unusedFn = 0;
declaredFn.forEach(n => {
  const r = refs.get(n) || 0;
  const raw = count(new RegExp('\\b' + esc(n) + '\\b', 'g'), allRaw) + count(new RegExp('\\b' + esc(n) + '\\b', 'g'), allHtml);
  if (r === 0 && raw <= 1) { note('函数未被调用：' + n); unusedFn++; }
});
if (!unusedFn) console.log('  ✅ 无未调用函数（共 ' + declaredFn.size + ' 个函数声明）');

/* ---------------- C. 内联事件处理器 ---------------- */
console.log('\n— C. 内联事件处理器 —');
const handlers = new Map();
Object.entries(HTML).forEach(([f, src]) => {
  [...src.matchAll(/\bon[a-z]+\s*=\s*"([^"]*)"/g)].forEach(m => {
    const body = m[1];
    if (acorn) {
      try {
        const ast = acorn.parse('(function(){' + body + ';})', { ecmaVersion: 'latest' });
        walk(ast, (n, p) => {
          if (n.type === 'Identifier' && p && p.type === 'CallExpression' && p.callee === n) handlers.set(n.name, f);
          if (n.type === 'Identifier' && p && p.type === 'NewExpression' && p.callee === n) handlers.set(n.name, f);
        });
        return;
      } catch (e) {}
    }
    [...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].forEach(x => handlers.set(x[1], f));
  });
});
let evBad = 0;
handlers.forEach((f, n) => { if (!declared.has(n) && !BUILTIN.has(n)) { note(f + ' 内联事件引用未定义函数：' + n); evBad++; } });
if (!evBad) console.log('  ✅ 内联事件全部有定义（共 ' + handlers.size + ' 个）');

/* ---------------- D. 顶层变量未使用 ---------------- */
console.log('\n— D. 顶层变量 —');
let topBad = 0;
declaredTopVar.forEach(n => {
  const r = refs.get(n) || 0;
  const raw = count(new RegExp('\\b' + esc(n) + '\\b', 'g'), allRaw) + count(new RegExp('\\b' + esc(n) + '\\b', 'g'), allHtml);
  if (r === 0 && raw <= 1) { note('顶层变量未使用：' + n); topBad++; }
});
if (!topBad) console.log('  ✅ 顶层变量均有使用（共 ' + declaredTopVar.size + ' 个）');

/* ---------------- E. 重复 id ---------------- */
console.log('\n— E. HTML 重复 id —');
let dupId = 0;
Object.entries(HTML).forEach(([f, src]) => {
  const seen = {}, dups = new Set();
  [...src.matchAll(/\bid\s*=\s*"([^"]+)"/g)].forEach(m => { if (seen[m[1]]) dups.add(m[1]); seen[m[1]] = 1; });
  if (dups.size) { note(f + ' 内重复 id：' + [...dups].join(', ')); dupId++; }
});
if (!dupId) console.log('  ✅ 无重复 id');

/* ---------------- F. CSS 类 ---------------- */
const cssFiles = ['assets/style.css', 'assets/extra.css'].filter(exists);
const css = cssFiles.map(read).join('\n') + '\n' + read('data/extra.css');
console.log('\n— F. CSS 类 —');
const UTIL = new Set(['light', 'sepia', 'open', 'active', 'on', 'show', 'playing', 'disabled', 'no-motion', 'cur', 'sep',
  'col', 'row', 't', 'ti', 'li', 'lk', 'ct', 'cn', 'ci', 'mg', 'fi', 'fn', 'fc', 's', 'p', 'q', 'e', 'html', 'css', 'js', 'md']);
let cssUnused = 0;
[...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]))].forEach(c => {
  if (UTIL.has(c) || /^\d/.test(c)) return;
  const inHtml = new RegExp("[\"'\\s>.]" + esc(c) + "(?:[\"'\\s>.\\[{:]|$)").test(allHtml);
  const inJs = new RegExp("['\"`\\s>.]" + esc(c) + "['\"`\\s>,)+:]").test(allRaw);
  if (!inHtml && !inJs) { note('CSS 类疑似未使用：.' + c); cssUnused++; }
});
if (!cssUnused) console.log('  ✅ CSS 类均有引用');

/* ---------------- G. 同一 CSS 文件内重复选择器 ---------------- */
const stripAtRules = src => {
  let out = '', i = 0;
  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at === -1) { out += src.slice(i); break; }
    out += src.slice(i, at);
    const brace = src.indexOf('{', at);
    if (brace === -1) { out += src.slice(at); break; }
    let depth = 0, j = brace;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) { j++; break; } } }
    i = j;
  }
  return out;
};
let dupSel = 0;
cssFiles.forEach(f => {
  const src = stripAtRules(read(f));
  const sels = [...src.matchAll(/([^\n{}@][^{}]*?)\s*\{/g)].map(m => m[1].trim().replace(/\s+/g, ' '))
    .filter(x => /^[.#a-zA-Z]/.test(x) && !/^%|^from$|^to$/.test(x));
  const seen = {}; sels.forEach(s => seen[s] = (seen[s] || 0) + 1);
  Object.entries(seen).forEach(([s, c]) => { if (c > 1) { note(f + ' 内重复选择器：' + s + ' ×' + c); dupSel++; } });
});
if (!dupSel) console.log('  ✅ 无同一文件内的重复选择器');

/* ---------------- H. 数据重复 id ---------------- */
console.log('\n— H. 数据 —');
let dupData = 0;
['data/resources.js', 'data/knowledge.js'].forEach(f => {
  const src = read(f);
  let seen = {}, dups = new Set();
  src.split(/\r?\n/).forEach(line => {
    if (/^\s*[A-Za-z_$][\w$]*\s*:\s*\[/.test(line)) seen = {};
    const m = line.match(/\{\s*id\s*:\s*'([^']+)'/);
    if (m) { if (seen[m[1]]) dups.add(m[1]); seen[m[1]] = 1; }
  });
  if (dups.size) { note(f + ' 重复 id：' + [...dups].join(', ')); dupData++; }
});
if (!dupData) console.log('  ✅ 数据 id 无重复');

/* ---------------- I. 未被引用的资源 ---------------- */
console.log('\n— I. 资源文件引用 —');
const refsSet = new Set();
[...allHtml.matchAll(/(?:src|href)\s*=\s*"([^"?#]+)"/g)].forEach(m => refsSet.add(m[1].replace(/^\.\//, '')));
[...allRaw.matchAll(/(?:src|href)\s*=\s*['"]([^'"?#]+)['"]/g)].forEach(m => refsSet.add(m[1].replace(/^\.\//, '')));
[...allRaw.matchAll(/['"]\.?([A-Za-z0-9_\-.\/]+\.(?:js|css|json|png|svg|woff2?))['"]/g)].forEach(m => refsSet.add(m[1].replace(/^\.\//, '')));
const walkDir = (dir, out) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) walkDir(rel, out); else out.push(rel);
  }
  return out;
};
let orphan = 0;
[...walkDir('assets', []), ...walkDir('data', [])].forEach(a => {
  const base = a.split('/').pop();
  if (/\.map$/.test(a)) return;
  const referenced = refsSet.has(a) || refsSet.has(base) || [...refsSet].some(r => r.endsWith('/' + base));
  if (!referenced) { note('资源未被引用：' + a); orphan++; }
});
if (!orphan) console.log('  ✅ assets/ 与 data/ 全部有引用');

console.log('\n—— 体检结果：' + (issues ? '⚠️ ' + issues + ' 项待留意' : '✅ 通过，无明显问题') + ' ——');
process.exit(STRICT && issues ? 1 : 0);
