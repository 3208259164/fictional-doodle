/* =====================================================================
   学通 · 应用脚本
   依赖：data/config.js、data/resources.js、data/content.js、data/knowledge.js
        assets/vendor/qrcode.min.js（分享二维码，可选）
   ===================================================================== */
const CFG = window.SITE_CONFIG   || {};
const RES = window.SITE_RESOURCES || [];
/* 外链净化：占位链接（example.com、含省略号/全角、缺协议、网盘地址 之类）一律视为“未添加”，
   避免点击后跳到无效外部网页（用户反馈：跳出去打不开）。 */
function validUrl(u){
  if (!u || u === '#' || u === 'mailto:') return false;
  if (!/^https?:\/\//i.test(u)) return false;
  if (/example\.(com|org|net)\b/i.test(u)) return false;
  if (/[\u2026\uFF0E]/.test(u)) return false;                 /* … ． */
  if (/网盘地址|你的名称|占位|xxxx?/i.test(u)) return false;
  try { const h = new URL(u).host; if (!h || h.indexOf('.') < 0 || h.indexOf(' ') >= 0) return false; } catch(e){ return false; }
  return true;
}
try {
  RES.forEach(function(it){
    if (it && typeof it.url === 'string' && /^https?:\/\//i.test(it.url) && !validUrl(it.url)) it.url = '#';
    if (it && it.mirrors) it.mirrors = it.mirrors.filter(function(m){ return m && validUrl(m.u); });
  });
} catch(e){}
const CT  = window.SITE_CONTENT   || {};
const EX  = window.SITE_EXTRA     || {};
const LIBS = window.SITE_LIBRARIES || [];
const GR   = window.SITE_GRAPH || { nodes:[], links:[] };
const HUB_NAME = window.__YZY_HUB_NAME || '史料';
const BASE = (CFG.siteUrl || (location.origin + location.pathname)).replace(/#.*$/, '');

const statusMap = {ok:'✅', warn:'⚠️', dead:'❌'};
const catIcon = {原著:'📕', 导读:'📗', 词典:'📘', 有声书:'🎧', 歌曲:'🎼', 影像:'🎬', 手册:'📘', '对公文献':'📄', 参考:'📕', 工具:'🧰'};
let activeCat = '推荐';
let activeTag = '';
let curQ = '';
let favOnly = false;
let fileOnly = false;

var _noticeEl = document.getElementById('noticeText'); if (_noticeEl) _noticeEl.textContent = CFG.notice || '';
var QQ_AVA_DEF = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2b1b1b"/><circle cx="20" cy="15" r="7.5" fill="#b9a79a"/><path d="M6 40c0-8.5 6.3-13.5 14-13.5S34 31.5 34 40z" fill="#b9a79a"/></svg>');
function syncSetAva(){ try { var a = localStorage.getItem('acctAvatar') || ''; var el = document.getElementById('qAvaImg'); if (el) el.src = a || QQ_AVA_DEF;
  var qn = document.getElementById('qName'); if (qn) qn.textContent = localStorage.getItem('acctName') || '教员的好战士'; } catch(e){} }
try { syncSetAva(); } catch(e){}
var _snEl = document.getElementById('siteName'); if (_snEl) _snEl.textContent = CFG.siteName || '学通';
const _bio = document.getElementById('bio'); if (_bio){ if (CFG.bio) _bio.textContent = CFG.bio; else _bio.style.display = 'none'; }
document.title = (CFG.siteName || '学通') + ' · 马列毛主义资料整理';
/* 背景音乐：仅在确有内置音频时设置 src，避免无谓的 404 请求（App 为离线包，通常不含音频） */

/* ---------- 本机诊断（运行状态与错误，仅存内存，可导出；不含个人信息） ---------- */
const DIAG = { ua: navigator.userAgent, lang: navigator.language, errors: [], events: [] };
function diagLog(kind, info){ if (DIAG.errors.length < 80) DIAG.errors.push({ t:new Date().toISOString(), kind:kind, info:String(info).slice(0,300) }); }
function diagEvent(name){ if (DIAG.events.length < 40) DIAG.events.push({ t:new Date().toISOString(), e:name }); }
window.addEventListener('error', e => { diagLog('error', (e.message || '资源加载失败') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0)); }, true);
window.addEventListener('unhandledrejection', e => diagLog('promise', (e.reason && (e.reason.message || e.reason)) || 'unknown'));
window.addEventListener('offline', () => diagEvent('offline'));
window.addEventListener('online', () => diagEvent('online'));

/* ---------- 通用工具 ---------- */
function esc(s){ return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
/* 转义升级版：既做 JS 字符串转义、又做 HTML 属性转义。
   用于塞进 onclick="fn('…')" 这类「属性里的 JS 字符串」，避免值里的 " 闭合属性造成注入。 */
function escAttr(s){ return esc(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
/* ---------- 文本净化：数据与本机覆盖层（自助编辑 / 导入他人备份）合并后统一清洗一次 ----------
   把 < > 去掉、把 ASCII 引号换成全角引号。这样即使数据里被塞进 HTML，也拼不出标签与属性。 */
var YZ_RAW_KEYS = { url:1, u:1, href:1, img:1, avatar:1, icon:1, py:1, alias:1, id:1, key:1, slug:1, color:1, color2:1 };
function yzCleanText(v){ return (typeof v === 'string') ? v.replace(/[<>]/g, '').replace(/"/g, '\u201d').replace(/'/g, '\u2019') : v; }
function yzCleanDeep(o, depth){
  if (!o || typeof o !== 'object' || (depth || 0) > 6) return o;
  Object.keys(o).forEach(function(k){
    var v = o[k];
    if (typeof v === 'string'){ if (!YZ_RAW_KEYS[k]) o[k] = yzCleanText(v); }
    else if (v && typeof v === 'object') yzCleanDeep(v, (depth || 0) + 1);
  });
  return o;
}
window.yzCleanText = yzCleanText;
window.yzCleanData = function(){ try { [RES, CT, EX].forEach(function(r){ yzCleanDeep(r, 0); }); } catch (e) {} };
function slugOf(s){ return encodeURIComponent(String(s == null ? '' : s).trim()).replace(/'/g, '%27'); }
function unSlug(s){ try { return decodeURIComponent(s); } catch(e){ return s; } }
function idxBySlug(slug){ const s = unSlug(slug); let i = RES.findIndex(r => r.id === s); if (i < 0) i = RES.findIndex(r => r.title === s); return i; }
function setHash(h){ try { history.replaceState(null, '', h); } catch(e){ location.hash = h; } }
function isNew(it){
  if (!it || !hasBody(it)) return false;   /* 没有正文的条目不算“新”，避免“标了更新却打不开”的误导 */
  if (!it.date || it.date === '—') return false;
  const d = new Date(it.date + 'T00:00:00'); if (isNaN(d)) return false;
  return (Date.now() - d.getTime()) / 86400000 <= (CFG.newDays || 30);
}
/* 站内真正存在的正文文件清单（构建时生成；没放实体文件时为空表）。
   只有「本机导入的书」或「清单里确实有的文件」才算“有正文”；外链与占位都不算。 */
const SITE_FILES = new Set((((window.SITE_HAVE_FILES) || (typeof CFG !== 'undefined' && CFG && CFG.siteHaveFiles) || [])).map(s => String(s).replace(/^\.?\//, '')));
function hasBody(it){
  if (!it) return false;
  if (it.local && it.bookId) return true;
  const u = String(it.url || '');
  if (!u || u === '#' || /^(https?:|mailto:|tel:)/i.test(u)) return false;
  return SITE_FILES.has(u.replace(/^\.?\//, ''));
}
/* 这是一本“可以有正文”的书，但当前没有正文 → 值得给「导入本书」入口 */
function canImport(it){
  if (!it || hasBody(it)) return false;
  if (/^(https?:|mailto:|tel:)/i.test(String(it.url || ''))) return false;
  return !!(it.fmt && it.fmt !== '—' && it.fmt !== 'MP3');
}
function hasFile(r){ return hasBody(r); }

/* ---------- JSON-LD 结构数据（便于搜索与 AI 理解） ---------- */
function jsonld(id, obj){ let e = document.getElementById(id); if (!e){ e = document.createElement('script'); e.type = 'application/ld+json'; e.id = id; document.head.appendChild(e); } e.textContent = JSON.stringify(obj); }
function jsonldBase(){
  const _logo = { '@type':'ImageObject', url:BASE + 'icons/icon-192.png' };
  jsonld('ld-base', { '@context':'https://schema.org', '@graph':[
    { '@type':'WebSite', name:CFG.siteName || '学通', url:BASE, inLanguage:'zh-CN',
      description:'马列毛主义文献与史料的整理与分享：原著电子书、有声书、研究文献、人物与思想关系图谱。',
      publisher:{ '@type':'Organization', name:CFG.siteName || '学通', url:BASE, logo:_logo },
      potentialAction:{ '@type':'SearchAction', target:BASE + '?q={search_term_string}', 'query-input':'required name=search_term_string' } },
    { '@type':'Organization', name:CFG.siteName || '学通', url:BASE, logo:_logo },
    { '@type':'FAQPage', mainEntity:(CT.faq || []).map(([q,a]) => ({ '@type':'Question', name:q, acceptedAnswer:{ '@type':'Answer', text:a } })) }
  ]});
}
function jsonldItem(it){
  const url = BASE + '#/r/' + slugOf(it.id || it.title);
  const _isBook = /EPUB|PDF|MOBI|AZW|TXT/i.test(it.fmt || '') || /原著|导读|文献|选集|文集|全集|词典|参考/.test(it.cat || '');
  jsonld('ld-item', { '@context':'https://schema.org', '@graph':[
    { '@type': _isBook ? 'Book' : 'CreativeWork', name:it.title, headline:it.title,
      author:{ '@type':'Person', name:it.author || '—' },
      inLanguage:'zh-CN', url:url, description:it.intro || it.desc || '',
      publisher:{ '@type':'Organization', name:it.publisher || it.src || '学通' },
      isPartOf:{ '@type':'CollectionPage', name:CFG.siteName || '学通', url:BASE },
      datePublished:(it.date && it.date !== '—') ? it.date : undefined,
      license:'https://creativecommons.org/licenses/by-sa/4.0/' },
    { '@type':'BreadcrumbList', itemListElement:[
      { '@type':'ListItem', position:1, name:'首页', item:BASE },
      { '@type':'ListItem', position:2, name:it.title, item:url } ]}
  ]});
}

/* ---------- 面包屑（按钮式，无蓝色、无 URL 显示） ---------- */
let CUR_TRAIL = [];
function crumbFrom(items){
  CUR_TRAIL = items.slice();
  const parts = [`<button class="aslink" onclick="goHome()">首页</button>`]
    .concat(items.map((x, i) => (i === items.length - 1)
      ? `<span class="cur">${x.t}</span>`
      : `<button class="aslink" onclick="openTrail(${i})">${x.t}</button>`));
  return `<nav class="crumb" aria-label="面包屑导航">${parts.join(' <span class="sep">›</span> ')}</nav>`;
}
function openTrail(i){ const x = CUR_TRAIL[i]; if (x && x.fn) x.fn(); }
function resourceForText(text){
  const clean = String(text).replace(/[《》·—\s]/g, '');
  let best = -1, bestLen = 0;
  RES.forEach((r, i) => {
    const keys = [String(r.title).replace(/[《》]/g, '')].concat(String(r.alias || '').split(/\s+/));
    keys.forEach(k => { if (k && k.length >= 2 && clean.includes(k) && k.length > bestLen){ bestLen = k.length; best = i; } });
  });
  return best;
}
function rowHTML(idx){
  const it = RES[idx]; if (!it) return '';
  const badge = isNew(it) ? '<i class="badge-new">NEW</i>' : '';
  return `<button class="lcard aslink" onclick="openItemDetail(${idx})"><span class="li">${it.icon||'📕'}</span>` +
    `<span style="flex:1"><span class="pname">${it.title}${badge}</span>` +
    `<span class="prole">${it.author} · ${it.cat}${it.size && it.size!=='—' ? ' · ' + it.size : ''} · ${hasBody(it) ? statusMap[it.status] : '📭 暂无原文'}</span></span>` +
    `<span style="opacity:.4">›</span></button>`;
}
/* ---------- 本机存储写入：统一入口，配额写满时给出提示（原先是静默失败） ---------- */
var _lsetWarnT = 0;
/* 本机存储自检：部分 Android WebView（磁盘紧张、隐私模式、定制 ROM）会「写入不报错、读回为空」，
   只靠 try/catch 发现不了 → 表现为「设了主题/进度，重启又没了」。启动时做一次写→读→删闭环。 */
function storageSelfTest(){
  try {
    var k = '__yzStoreProbe', v = 'p' + Date.now();
    window.localStorage.setItem(k, v);
    var back = window.localStorage.getItem(k);
    window.localStorage.removeItem(k);
    return back === v;
  } catch (e) { return false; }
}
window.storageSelfTest = storageSelfTest;
function lset(k, v){
  try { window.localStorage['setItem'](k, v); return true; }
  catch (e){
    var now = Date.now();
    if (now - _lsetWarnT > 3000){
      _lsetWarnT = now;
      try { toast((e && (e.name === 'QuotaExceededError' || e.code === 22))
        ? '本机存储已满，这次保存没成功：可在「我的资料 → 清除本机数据」里清理后重试'
        : '本机无法保存数据（可能是浏览器隐私模式）'); } catch (x) {}
    }
    return false;
  }
}
function toast(msg){
  let t = document.getElementById('toast');
  if (!t){
    t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role','status'); t.setAttribute('aria-live','polite');
    t.style.cssText = 'position:fixed;left:50%;bottom:36px;transform:translateX(-50%);background:rgba(0,0,0,.82);color:#fff;padding:8px 16px;border-radius:20px;font-size:.8rem;z-index:9999;opacity:0;transition:opacity .25s;pointer-events:none';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = '0'; }, 1800);
}

/* ---------- 每日一句（首页） ---------- */
const QUOTES = CT.quotes || [];
let qIdx = QUOTES.length ? Math.floor(Math.random() * QUOTES.length) : 0;
function paintQuote(){
  const el = document.getElementById('dailyQuote'); if (!el) return;
  if (!QUOTES.length){ el.style.display = 'none'; return; }
  const q = QUOTES[qIdx];
  el.innerHTML = `“${q.t}”<br><b>—— ${q.a}，${q.s}</b>`;
}
function nextQuote(){ if (!QUOTES.length) return; qIdx = (qIdx + 1) % QUOTES.length; paintQuote(); }

/* ---------- 模态浮层的焦点管理（WAI-ARIA dialog 模式） ----------
   打开：记住来源元素并把焦点移入浮层；关闭：把焦点还原到来源 */
var _yzPrevFocus = null;
function yzDlgOpen(m){
  try{ _yzPrevFocus = document.activeElement; }catch(e){}
  try{ var f = m && m.querySelector('button,a[href],input:not([type=hidden]),textarea,select,[tabindex]:not([tabindex="-1"])'); if (f) f.focus(); }catch(e){}
}
function yzDlgClose(){ try{ var p=_yzPrevFocus; _yzPrevFocus=null; if (p && p.focus && document.contains(p)) p.focus(); }catch(e){} }
/* ---------- 分享（二维码 + 系统分享 + 复制） ---------- */
function shareUrlFor(nid){ return BASE + '#/r/' + slugOf(nid); }
function openShare(url, title){
  const m = document.getElementById('shareModal'); if (!m) return;
  document.getElementById('shareUrl').textContent = url;
  const box = document.getElementById('qrBox'); box.innerHTML = '';
  try {
    if (window.qrcode){ const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); box.innerHTML = qr.createImgTag(4, 0); }
    else { box.innerHTML = '<span class="sub">（离线：未能生成二维码）</span>'; }
  } catch(e){ box.innerHTML = '<span class="sub">（二维码生成失败）</span>'; }
  m._url = url; m._title = title || ''; yzDlgOpen(m); m.classList.add('open');
}
function closeShare(){ const m = document.getElementById('shareModal'); if (m) m.classList.remove('open'); yzDlgClose(); }
function shareCopy(){ const m = document.getElementById('shareModal'); copyText((m && m._url) || '', '链接已复制'); }
function shareSystem(){ const m = document.getElementById('shareModal'); if (navigator.share){ navigator.share({ title:(m && m._title) || '学通', url:(m && m._url) || location.href }).catch(() => {}); } else { shareCopy(); } }

/* ---------- 我的笔记 / 书签（仅存本机） ---------- */
function getNote(id){ return localStorage.getItem('note_' + id) || ''; }
function saveNote(id, val){ lset('note_' + id, val); }
function marks(){ try { return JSON.parse(localStorage.getItem('marks') || '[]'); } catch(e){ return []; } }
function isMarked(idx){ const it = RES[idx]; return it && marks().includes(it.id || it.title); }
function toggleMark(idx){
  const it = RES[idx]; if (!it) return;
  const id = it.id || it.title; let m = marks();
  if (m.includes(id)) m = m.filter(x => x !== id); else m.push(id);
  lset('marks', JSON.stringify(m));
  toast(m.includes(id) ? '已加入书签' : '已取消书签');
  openItemDetail(idx);
}
function openMarks(){
  const list = marks().map(id => RES.findIndex(r => (r.id || r.title) === id)).filter(i => i >= 0);
  openContent('🔖 我的书签',
    crumbFrom([{ t:'我的书签', fn:()=>openMarks() }]) +
    (list.length ? list.map(rowHTML).join('') + `<p class="sub" style="margin-top:12px;font-size:.72rem">共 ${list.length} 个，仅存本机。</p>`
      : `<p class="sub">还没有书签。在资源详情页点「🔖 书签」即可添加。</p>`));
}

/* 从「全站命中」直接跳到关系图谱的某个节点（graph.html 支持 ?g= 图谱 + #id 定位）。
   注意：函数名不能叫 openGraphNode —— 下面 1709 行另有同名函数（接受节点对象渲染详情），
   同名会被后者覆盖，导致这里传字符串 id 进去被当成对象用（历史 bug：点文革图谱条目显示 undefined）。 */
function openGraphJump(id, ds){
  try { location.href = 'graph.html' + (ds ? '?g=' + encodeURIComponent(ds) : '') + '#' + encodeURIComponent(id); } catch(e){}
}

/* ---------- 导出 / 导入我的数据 ---------- */
async function exportDiag(){
  const cfg = {};
  ['siteUrl','tgChannel','email','requestForm'].forEach(k => { cfg[k] = CFG[k] ? '已填' : '未添加'; });
  cfg.mirrors = (CFG.mirrors || []).length;
  let online = true; try { online = navigator.onLine; } catch(e){}
  let conn = ''; try { const c = navigator.connection || {}; conn = [c.effectiveType, c.downlink ? (c.downlink + 'Mb/s') : ''].filter(Boolean).join(' / '); } catch(e){}
  let lsBytes = 0, lsKeys = 0;
  try { for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); lsKeys++; lsBytes += (String(k).length + String(localStorage.getItem(k) || '').length); } } catch(e){}
  let siteCount = 0; try { siteCount = window.__sites ? (await window.__sites.count()) : 0; } catch(e){}
  let sw = 'none'; try { sw = (navigator.serviceWorker && navigator.serviceWorker.controller) ? 'active' : (('serviceWorker' in navigator) ? 'registered' : 'none'); } catch(e){ sw = 'n/a'; }
  let mem = ''; try { if (performance && performance.memory) mem = Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB / ' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + 'MB'; } catch(e){}
  const byCat = {}; RES.forEach(r => { byCat[r.cat] = (byCat[r.cat] || 0) + 1; });
  let app = ''; try { app = (window.AndroidApp && window.AndroidApp.getVersionName) ? window.AndroidApp.getVersionName() : ''; } catch(e){}
  let wv = ''; try { wv = (window.AndroidApp && window.AndroidApp.webviewVersion) ? window.AndroidApp.webviewVersion() : ''; } catch(e){}
  let dev = ''; try { dev = (window.AndroidApp && window.AndroidApp.deviceInfo) ? window.AndroidApp.deviceInfo() : ''; } catch(e){}
  const _cr = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || '?';
  let cssFeat = 'ok'; try { const miss = [];
    if (window.CSS && CSS.supports) { if (!CSS.supports('inset','0')) miss.push('no-css-inset'); if (!CSS.supports('padding-bottom','env(safe-area-inset-bottom,0px)')) miss.push('no-css-env'); }
    if (!('PointerEvent' in window)) miss.push('no-pointer-events');
    if (miss.length) cssFeat = miss.join(',');
  } catch(e){}
  const data = {
    generated: new Date().toISOString(),
    tool: 'runtime-diagnostics v2',
    app: { name: CFG.siteName || '', site: CFG.version || '', app: app || '(web)', isApp: IS_APP },
    env: { ua: DIAG.ua, lang: DIAG.lang, platform: (navigator.platform || ''), online: online, connection: conn,
           webview: (wv || ('Chrome/' + _cr)), device: (dev || '(web)'), cssFeatures: cssFeat,
           viewport: innerWidth + 'x' + innerHeight, dpr: (window.devicePixelRatio || 1),
           screen: (screen.width + 'x' + screen.height), theme: (document.body.className || '(默认)'), storage: (storageSelfTest() ? 'ok' : 'fail'),
           motion: ((document.body.className || '').indexOf('no-motion') >= 0 ? 'off' : 'on') },
    storage: { localStorageKeys: lsKeys, localStorageBytes: lsBytes, indexedDB: !!window.indexedDB, localSites: siteCount, serviceWorker: sw, jsHeap: mem },
    config: cfg,
    counts: { resources: RES.length, byCat: byCat,
              leaders: (leaders || []).length, comrades: (comrades || []).length, recommend: (CT.recommend || []).length,
              graphNodes: ((GR && GR.nodes) || []).length, graphLinks: ((GR && GR.links) || []).length,
              events: (EX.events || []).length, features: (EX.features || []).length, debunks: (EX.debunks || []).length,
              critics: (EX.critics || []).length, schools: (EX.schools || []).length,
              marks: marks().length, favs: favSet().size },
    errors: DIAG.errors.slice(-50),
    events: DIAG.events.slice(-20)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = '学通-诊断.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  toast('诊断报告已导出（v2 · 含环境 / 存储 / 数据统计，可直接发给开发者）｜' + (window.AndroidApp ? '已存到系统「下载」' : '已存到浏览器下载'));
}
function buildDataObj(){
  const data = { app:'学通', ver:2, exportedAt:new Date().toISOString(),
    name: localStorage.getItem('acctName') || '', avatar: localStorage.getItem('acctAvatar') || '',
    theme: localStorage.getItem('theme'), fs: localStorage.getItem('fs'), lh: localStorage.getItem('lh'),
    w: localStorage.getItem('w'), motion: localStorage.getItem('motion'),
    defaultLib: getDefaultLib(), lastItem: localStorage.getItem('lastItem'),
    favs: localStorage.getItem('favs'), marks: localStorage.getItem('marks'),
    quizBank: quizBank(), notes: {} };
  Object.keys(localStorage).forEach(k => { if (k.indexOf('note_') === 0) data.notes[k] = localStorage.getItem(k); });
  return data;
}
function applyImportedData(d){
  let fail = 0;
  const put = (k, v) => { if (!lset(k, v)) fail++; };
  ['favs','marks','theme','fs','lh','w','motion','lastItem'].forEach(k => { if (d[k] != null) put(k, d[k]); });
  if (d.name != null) put('acctName', d.name);
  if (d.avatar != null) put('acctAvatar', d.avatar);
  if (d.defaultLib) put('defaultLib', d.defaultLib);
  Object.entries(d.notes || {}).forEach(([k, v]) => put(k, v));
  if (Array.isArray(d.quizBank)) { try { quizSave(d.quizBank); } catch (e) { fail++; } }
  return fail;                                    /* 0 = 全部写入成功 */
}
function exportData(){ openDataIO('export'); }
function openDataIO(mode){
  const exp = (mode === 'export');
  const m = document.getElementById('dataModal'); if (!m) return;
  document.getElementById('dataTitle').textContent = exp ? '💾 导出我的数据' : '🔐 导入我的数据';
  document.getElementById('dataHint').innerHTML = exp
    ? '下面是你的全部数据（收藏 · 书签 · 笔记 · 做题题库 · 各项设置）。点「📋 复制」存进备忘录 / 聊天，换设备时粘贴回来即可恢复。'
    : '把你的数据 JSON 粘贴到下面，点「导入并恢复」；<b>部分浏览器</b>也支持直接用「选择文件」。';
  const ta = document.getElementById('dataText');
  ta.value = exp ? JSON.stringify(buildDataObj(), null, 2) : '';
  ta.readOnly = exp;
  document.getElementById('dataOps').innerHTML = exp
    ? '<button class="go" onclick="copyDataText()">📋 复制</button>' +
      '<button onclick="downloadDataText()">⬇️ 下载 .json</button>' +
      '<button onclick="closeDataModal()">关闭</button>'
    : '<button class="go" onclick="submitDataImport()">导入并恢复</button>' +
      '<label style="font-size:.75rem;padding:6px 14px;border-radius:8px;cursor:pointer;background:var(--card);border:1px solid var(--card-border);color:var(--text)">选择文件<input type="file" accept="application/json,.json" onchange="importData(this)" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden"></label>' +
      '<button onclick="closeDataModal()">取消</button>';
  yzDlgOpen(m); m.classList.add('open');
}
function closeDataModal(){ const m = document.getElementById('dataModal'); if (m) m.classList.remove('open'); yzDlgClose(); }
function copyDataText(){
  const ta = document.getElementById('dataText'); const t = ta.value || '';
  const ok = () => toast('已复制到剪贴板');
  const fb = () => { try { ta.focus(); ta.select(); ta.setSelectionRange(0, t.length); (document.execCommand('copy') ? ok() : toast('请长按文本框，手动全选复制')); } catch(e){ toast('请长按文本框，手动全选复制'); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok).catch(fb);
  else fb();
}
function downloadDataText(){
  try {
    const t = document.getElementById('dataText').value || '';
    const blob = new Blob([t], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '学通-我的数据.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    toast('已尝试下载；若没反应，请用「📋 复制」');
  } catch(e){ toast('此环境不支持下载，请用「📋 复制」'); }
}
function submitDataImport(){
  const t = (document.getElementById('dataText').value || '').trim();
  if (!t){ toast('请先粘贴数据 JSON'); return; }
  try {
    const d = JSON.parse(t);
    const fail = applyImportedData(d);
    closeDataModal();
    toast(fail ? ('已导入，但有 ' + fail + ' 项因本机存储已满未能保存') : '导入成功，正在恢复…');
    setTimeout(() => location.reload(), fail ? 1800 : 700);
  } catch(e){ toast('导入失败：内容不是有效的 JSON'); }
}
function importData(input){
  const f = input.files && input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      const fail = applyImportedData(d);
      closeDataModal();
      toast(fail ? ('已导入，但有 ' + fail + ' 项因本机存储已满未能保存') : '导入成功，正在恢复…');
      setTimeout(() => location.reload(), fail ? 1800 : 700);
    } catch(e){ toast('导入失败：文件内容不是有效的 JSON'); }
    input.value = '';
  };
  r.readAsText(f);
}

/* ---------- 意见反馈：跳转反馈页；页内表单通过 AJAX 提交到 Netlify Forms ---------- */
function requestAction(){ if (CFG.requestForm) confirmLeave(CFG.requestForm, '意见反馈'); else openSection(secIdx('意见反馈')); }
function submitFeedback(e){
  e.preventDefault();
  const form = e.target, note = document.getElementById('fbNote');
  const val = (form && form.note && form.note.value ? form.note.value : '').trim();
  const url = CFG.requestForm || 'https://wj.qq.com/s2/28091671/hw7m/';
  // 跨站问卷无法由脚本代填，改为：复制你写的内容 + 直接打开问卷
  try { if (val && navigator.clipboard) navigator.clipboard.writeText(val); } catch(err){}
  if (note) note.textContent = (val ? '已复制你写的内容；' : '') + '正在打开问卷，粘贴进去提交即可…';
  setTimeout(() => { confirmLeave(url, '意见反馈 · 腾讯问卷'); }, 120);
}


/* ---------- 外链确认弹窗 ---------- */
function leaveOK(){ return localStorage.getItem('leaveOK') === '1'; }
/* 打开外部链接：App 内 WebView 的 window.open 不会生效（setSupportMultipleWindows=false），
   故 App 内走原生桥 openExternal()，浏览器内用新标签、被拦截则退回当前页跳转。 */
function openExternal(url){
  if (!url || url === '#' || url === 'mailto:') return;
  try { if (window.AndroidApp && typeof AndroidApp.openExternal === 'function'){ AndroidApp.openExternal(url); return; } } catch(e){}
  var w = null;
  try { w = window.open(url, '_blank', 'noopener'); } catch(e){}
  if (!w) { try { location.href = url; } catch(e){} }
}
window.openExternal = openExternal;
function confirmLeave(url, name){
  if (!url || url === '#' || url === 'mailto:'){ toast('该入口尚未添加'); return; }
  if (!validUrl(url)){ toast('该链接无效或尚未添加'); return; }   /* 占位链接不再跳转 */
  if (!CFG.confirmLeave || leaveOK()) { openExternal(url); return; }
  const m = document.getElementById('leaveModal'); if (!m) { openExternal(url); return; }
  m._url = url;
  document.getElementById('leaveName').textContent = name || '';
  let host = url; try { host = new URL(url).host; } catch(e){}
  document.getElementById('leaveHost').textContent = host;
  yzDlgOpen(m); m.classList.add('open');
}
function leaveGo(){ const m = document.getElementById('leaveModal'); const u = m._url; closeLeave(); if (u) openExternal(u); }
function leaveNever(){ lset('leaveOK', '1'); leaveGo(); }
function closeLeave(){ const m = document.getElementById('leaveModal'); if (m) m.classList.remove('open'); yzDlgClose(); }

/* ---------- 视图切换 ---------- */
function goResults(){ if (location.hash !== '#browse') location.hash = 'browse'; else route(); }
function goHome(){ try { resetPageStack(); } catch(e){} try { closeDrawer(); } catch(e){} try { setTopbar('root', { right:{ text:'＋', act:'togglePlus()' } }); } catch(e){} if (location.hash !== '') location.hash = ''; else route(); }
var _rootSearch = null;
function topSearch(){ var q = document.getElementById('qSearch'); var v = q ? q.value.trim() : '';
  if (_rootSearch){ _rootSearch(v); return; }
  var s = document.getElementById('search'); if (s) s.value = v; goResults(); }

/* 主页（root 模式）下滑手势打开搜索框：scrollY==0 且起点在顶部 → 下拉 ≥70px → focus 输入框并提示。
   仅在 root 模式生效（qSearchWrap 可见且非详情页）。 */
(function(){
  var stY = 0, triggered = false;
  /* 四个 tab 页（频道也有搜索框）才响应；下滑不必从搜索框附近开始 */
  function canPull(){
    var bar = document.getElementById('qSearchBar');
    return !!(bar && !bar.hidden);
  }
  document.addEventListener('touchstart', function(e){
    triggered = false;
    stY = (e.touches && e.touches[0]) ? e.touches[0].clientY : 0;
  }, { passive: true });
  document.addEventListener('touchmove', function(e){
    if (triggered) return;
    if (!canPull()) return;
    var t = (e.touches && e.touches[0]); if (!t) return;
    var dy = t.clientY - stY;
    /* 页面已经滚下去了：下滑 = 内容往回滚，等它自然滚到顶，搜索框就回来了，不抢手势 */
    if (window.scrollY > 30) return;
    if (dy > 70){
      triggered = true;
      /* 直接打开全屏搜索（#browse），不再只是 focus */
      try { if (typeof topSearch === 'function') topSearch(); else goResults(); } catch(_){ try { goResults(); } catch(__){} }
      try { if (typeof flash2 === 'function') flash2('已打开搜索', 1200); } catch(_){ }
    }
  }, { passive: true });
})();

/* 常驻顶栏：root = 头像+搜索+＋；page = ←+标题 */
function setTopbar(mode, opts){
  opts = opts || {};
  var back = document.getElementById('qBack'), ava = document.getElementById('qAva');
  var bar = document.getElementById('qSearchBar'), tt = document.getElementById('qTitle');
  var inp = document.getElementById('qSearch');
  if (mode === 'page'){
    /* 深层页：头顶只留 ← 和标题（搜索框整条隐藏，内容顶上来） */
    if (back) back.hidden = false; if (ava) ava.hidden = true;
    if (bar) bar.hidden = true; if (tt){ tt.hidden = false; tt.textContent = opts.title || ''; }
    _rootSearch = null;
  } else {
    /* 四个 tab 页：头像+加号在最上方（固定），搜索框这一条跟着页面走 */
    if (back) back.hidden = true; if (ava) ava.hidden = false;
    if (bar) bar.hidden = false; if (tt) tt.hidden = true;
    _rootSearch = opts.search || null;
    if (inp) inp.placeholder = opts.ph || '搜索书名 / 作者 / 关键词…';
    if (inp) inp.value = '';
    try { window.scrollTo(0, 0); } catch(e){}   /* 切页时回到顶部，搜索框自然在 */
  }
  /* 抽屉/整页推进里的标题（#drawerTitle）也要跟着变，否则打开「账号」「设置」时
     抽屉顶部仍写着上一次的标题（真实 UI bug：标题与内容不一致）。 */
  var dt = document.getElementById('drawerTitle');
  if (dt) dt.textContent = (mode === 'page') ? (opts.title || '') : '';
  var plus = document.getElementById('qPlus');
  var rc = (mode === 'page') ? { text:'＋', act:'togglePlus()' } : (opts.right || { text:'＋', act:'togglePlus()' });
  if (plus){ plus.textContent = rc.text || '＋'; plus.setAttribute('onclick', rc.act || 'togglePlus()'); }
}
/* 底栏四个标签：先清空页面栈，保证「点哪个进哪个」（否则会停留在上次打开的子页面） */
function tabTo(kind){
  try { resetPageStack(); } catch(e){}
  try { closeDrawer(); } catch(e){}
  if (kind === 'home')     { try { goHome(); } catch(e){} return; }
  if (kind === 'channel')  { try { openChannel(); } catch(e){} return; }
  if (kind === 'history')  { try { openSection(0); } catch(e){} return; }
  if (kind === 'classify') { try { openClassify(); } catch(e){} return; }
}
function homeCat(key){ activeCat = key; document.getElementById('search').value = ''; goResults(); }
function route(){
  const h = location.hash || '';
  const homeEl = document.getElementById('view-home');
  const resEl  = document.getElementById('view-results');

  if (h.indexOf('#/r/') === 0){
    homeEl.hidden = false; resEl.hidden = true;
    const idx = idxBySlug(h.slice(4));
    if (idx >= 0) openItemDetail(idx, true); else closeDrawer();
    window.scrollTo(0, 0); return;
  }
  if (h.indexOf('#/a/') === 0){
    homeEl.hidden = false; resEl.hidden = true;
    openAuthor(unSlug(h.slice(4)), true);
    window.scrollTo(0, 0); return;
  }
  if (h.indexOf('#/p/') === 0){
    homeEl.hidden = false; resEl.hidden = true;
    openNodeByName(unSlug(h.slice(4)), true);
    window.scrollTo(0, 0); return;
  }
  if (h.indexOf('#/g/') === 0){
    homeEl.hidden = false; resEl.hidden = true;
    openGraphNodeById(unSlug(h.slice(4)), true);
    window.scrollTo(0, 0); return;
  }
  if (h.indexOf('#/e/') === 0){
    homeEl.hidden = false; resEl.hidden = true;
    openEvent(parseInt(unSlug(h.slice(4)), 10) || 0, true);
    window.scrollTo(0, 0); return;
  }

  const isResults = h === '#browse';
  homeEl.hidden = isResults;
  resEl.hidden = !isResults;
  if (isResults) render(); else CUR_TRAIL = [];
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* 快捷键：按 / 聚焦搜索框 */
document.addEventListener('keydown', e => {
  const tag = (document.activeElement || {}).tagName || '';
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)){
    const onResults = !document.getElementById('view-results').hidden;
    e.preventDefault(); var t=document.getElementById(onResults ? 'search' : 'qSearch'); if(t) t.focus();
  }
});

/* ---------- 回到顶部 ---------- */
function backToTop(){ window.scrollTo({ top:0, behavior:'smooth' }); const d = document.getElementById('drawer'); if (d) d.scrollTo({ top:0, behavior:'smooth' }); }
function updateToTop(){
  const d = document.getElementById('drawer');
  const y = (window.scrollY || window.pageYOffset || 0) + ((d && d.classList.contains('open')) ? d.scrollTop : 0);
  const t = document.getElementById('toTop'); if (t) t.classList.toggle('show', y > 320);
}

/* ---------- 收藏 ---------- */
function favSet(){ try { return new Set(JSON.parse(localStorage.getItem('favs')||'[]')); } catch(e){ return new Set(); } }
function favKey(it){ return it.title + '|' + it.url; }
function isFav(it){ return favSet().has(favKey(it)); }
function toggleFav(idx){
  const it = RES[idx]; if(!it) return;
  const s = favSet(), k = favKey(it);
  if (s.has(k)) s.delete(k); else s.add(k);
  lset('favs', JSON.stringify([...s]));
  render();
}
function toggleFavOnly(){
  favOnly = !favOnly;
  const c = document.getElementById('favChip');
  c.textContent = favOnly ? '★ 只看收藏' : '☆ 我的收藏';
  c.classList.toggle('active', favOnly);
  render();
}
function toggleFileOnly(){
  fileOnly = !fileOnly;
  const c = document.getElementById('fileChip');
  c.textContent = fileOnly ? '📄 仅看有文件 ✓' : '📄 仅看有文件';
  c.classList.toggle('active', fileOnly);
  render();
}

/* ---------- 首页搜索辅助 ---------- */
function quickSearch(w){ var q=document.getElementById('qSearch'); if(q) q.value = w; topSearch(); }

/* ---------- 分类 ---------- */
const IS_APP = !!(window.AndroidApp);
function isFeatured(r){ return r.cat === '原著' && (r.hot || 0) >= 9; }
function countOf(key){
  if (key === '推荐') return RES.filter(isFeatured).length;
  if (key === '全部') return RES.length;
  if (key === '做题') return quizCount();
  return RES.filter(r => r.cat === key).length;
}

/* ---------- 标签云（按频次排序 · 精简 · 默认折叠） ---------- */
const tagFreq = {};
RES.forEach(r => (r.tags || []).forEach(t => { tagFreq[t] = (tagFreq[t] || 0) + 1; }));
const allTags = Object.keys(tagFreq).sort((a, b) => (tagFreq[b] - tagFreq[a]) || a.localeCompare(b));
const TOP_TAGS = 12;
const tagChip = t => `<span class="tag" onclick="pickTag('${escAttr(t)}')">${t}</span>`;
document.getElementById('tagrow').innerHTML = `<span class="lbl">标签：</span>` +
  allTags.slice(0, TOP_TAGS).map(tagChip).join('') +
  (allTags.length > TOP_TAGS ? `<span class="tag" id="tagMore" onclick="toggleMoreTags()">▾ 更多（${allTags.length - TOP_TAGS}）</span><span id="tagRest" hidden>${allTags.slice(TOP_TAGS).map(tagChip).join('')}</span>` : '');
function toggleMoreTags(){
  const r = document.getElementById('tagRest'), b = document.getElementById('tagMore');
  if (!r || !b) return;
  const opening = r.hidden;
  r.hidden = !opening;
  b.textContent = opening ? '▴ 收起' : `▾ 更多（${allTags.length - TOP_TAGS}）`;
}
function pickTag(t){
  activeTag = (activeTag === t) ? '' : t;
  document.querySelectorAll('#tagrow .tag').forEach(x => { if (x.id !== 'tagMore') x.classList.toggle('active', x.textContent === activeTag); });
  render();
}

/* ---------- 作者下拉 ---------- */
const authorSel = document.getElementById('authorSel');
['全部作者', ...new Set(RES.map(r => r.author))].forEach(a => {
  const o = document.createElement('option'); o.value = a; o.textContent = a; authorSel.appendChild(o);
});

function hl(s, q){
  s = String(s == null ? '' : s);
  if(!q) return escHtml(s);
  const i = s.toLowerCase().indexOf(String(q).toLowerCase());
  if (i < 0) return escHtml(s);
  return escHtml(s.slice(0, i)) + '<mark>' + escHtml(s.slice(i, i + q.length)) + '</mark>' + escHtml(s.slice(i + q.length));
}
/* 简介/说明命中片段（高亮关键词），让"为什么命中"一目了然 */
function snipOf(s, q){
  if (!q || !s) return '';
  const i = String(s).toLowerCase().indexOf(q);
  if (i < 0) return '';
  const a = Math.max(0, i - 22), b = Math.min(String(s).length, i + q.length + 34);
  return (a > 0 ? '…' : '') + String(s).slice(a, i) + '<mark>' + String(s).slice(i, i + q.length) + '</mark>' + String(s).slice(i + q.length, b) + (b < String(s).length ? '…' : '');
}
function introHit(item, q){
  if (!q) return '';
  const parts = [];
  const s1 = snipOf(item.intro, q); if (s1) parts.push(s1);
  const s2 = snipOf(item.note, q);  if (s2) parts.push(s2);
  if (!parts.length) return '';
  return '<span style="display:block;margin-top:4px;opacity:.82;font-size:.72rem;line-height:1.5">🔎 ' + parts.slice(0, 2).join(' ／ ') + '</span>';
}

/* ---------- 卡片 ---------- */
function resourceCardHTML(item){
  const idx = RES.indexOf(item);
  const k = 'click_' + (item.id || idx);
  const isHttp = item.url.startsWith('http');
  const canPreview = item.url !== '#' && (item.url.endsWith('.pdf') || item.url.endsWith('.epub'));
  const sizeTxt = item.size && item.size !== '—' ? ' · ' + item.size : '';
  const tags = (item.tags || []).map(t => `<i>${t}</i>`).join('');
  const fav = isFav(item);
  const st = escAttr(item.title.replace(/'/g, ''));
  const badge = (item.crit ? '<i class="badge-crit">被批判</i>' : '') + (isNew(item) ? '<i class="badge-new">NEW</i>' : '');
  return `<a class="card" href="javascript:void(0)" data-key="${k}" onclick="return cardAction(${idx})">
    <span class="icon">${item.icon}</span>
    <span class="body"><span class="title">${hl(item.title, curQ)}${badge}</span>
      <span class="desc">${hl(item.author, curQ)} · ${hl(item.desc, curQ)}${sizeTxt}</span>
      <span class="tags">${tags}</span>
      ${introHit(item, curQ)}
      <span class="ops">
        ${item.local ? `<button onclick="event.preventDefault();event.stopPropagation();yzBooks.read('${escAttr(item.bookId||'')}','${st}')">📖 阅读</button>` : (canPreview && hasBody(item) ? `<button onclick="event.preventDefault();event.stopPropagation();openPreview('${item.url}','${st}')">👁 预览</button>` : '')}
        <button class="${fav ? 'on' : ''}" onclick="event.preventDefault();event.stopPropagation();toggleFav(${idx})">${fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </span></span>
    <span class="meta">${hasBody(item) ? (statusMap[item.status] + ' ' + (item.date || '')) : '<span style="opacity:.62">📭 暂无原文</span>'}</span></a>`;
}

/* ---------- 检索（多字段 + 模糊回退 + 相关度排序） ---------- */
function haystack(r){
  return (r.title + ' ' + r.author + ' ' + r.cat + ' ' + (r.tags || []).join(' ') + ' ' + (r.alias || '') + ' ' +
    (r.py || '') + ' ' + (r.id || '') + ' ' + (r.fmt || '') + ' ' + (r.desc || '') + ' ' + (r.intro || '') + ' ' +
    (r.note || '') + ' ' + (r.publisher || '') + ' ' + (r.pubyear || '') + ' ' + (r.translator || '')).toLowerCase();
}
function scoreIt(r, terms){
  const title = (r.title + ' ' + (r.alias || '')).toLowerCase();
  const hay = haystack(r);
  let s = 0, any = false, all = true;
  terms.forEach(t => { if (hay.includes(t)){ any = true; s += title.includes(t) ? 5 : 1; } else { all = false; } });
  if (all) s += 10;
  return any ? s : 0;
}
function suggest(q){
  if (!q) return [];
  const out = [];
  const push = t => { if (t && !out.includes(t)) out.push(t); };
  (CFG.hotSearch || []).forEach(w => { if (w.includes(q) || q.includes(w)) push(w); });
  RES.forEach(r => { const blob = (r.title + (r.alias || '')).toLowerCase(); if (blob.includes(q)) push(r.title); else if ([...q].some(ch => r.title.includes(ch))) push(r.title); });
  return out.slice(0, 4);
}

/* ---------- 全站命中：把「史料 + 资源导航」也纳入检索 ---------- */
function omniSearch(q){
  if (!q) return [];
  const ql = String(q).toLowerCase();
  const hit = s => s && String(s).toLowerCase().includes(ql);
  const out = [];
  (leaders || []).forEach((p, i) => { if (hit(p.name) || hit(p.intro) || hit(p.role) || hit(p.works)) out.push({ cat:'革命导师', t:p.name, sub:(p.years||'') + ' · ' + (p.role||p.intro||''), fn:`showLeaderDetail(${i})` }); });
  (comrades || []).forEach(p => { if (hit(p.name) || hit(p.intro)) out.push({ cat:'革命同志', t:p.name, sub:(p.years||'') + ' · ' + (p.intro||''), fn:`openAuthor('${escAttr(p.name)}')` }); });
  figuresList().forEach(p => { if (hit(p.name) || hit(p.desc) || hit(p.role) || hit(p.works)) out.push({ cat:'人物', t:p.name, sub:(p.years?p.years+' · ':'') + (p.role || ''), fn:`openFigure('${p.id}')` }); });
  (EX.critics || []).forEach((c, i) => { if (hit(c.name) || hit(c.desc) || hit(c.role)) out.push({ cat:'被批判人物', t:c.name, sub:(c.role || c.desc || ''), fn:`openCritic(${i})` }); });
  (EX.events || []).forEach((e, i) => { if (hit(e.name) || hit(e.desc) || hit(e.year)) out.push({ cat:'重大事件', t:e.year + ' ' + e.name, sub:(e.desc || ''), fn:`openEvent(${i})` }); });
  (EX.features || []).forEach(f => { if (hit(f.name) || hit(f.desc)) out.push({ cat:(f.id === 'wenhua' ? '文革' : '专题'), t:f.name, sub:(f.desc || ''), fn:(f.id === 'wenhua' ? `openHub('wenge')` : `openHub('features')`) }); });
  (EX.debunks || []).forEach((d, i) => { if (hit(d.title) || hit(d.q) || hit(d.a)) out.push({ cat:'辟谣', t:'辟谣 · ' + d.title, sub:(d.q || '') + ' → ' + (d.a || ''), fn:`openHub('debunks')` }); });
  schoolGroups().forEach((g, gi) => (g.items || []).forEach((it, ii) => { if (hit(it.name) || hit(it.desc)) out.push({ cat:(g.group || (gi === 0 ? '思想' : '组织')), t:it.name, sub:(it.desc || ''), fn:`openSchoolItem(${gi},${ii})` }); }));
  (navGroups || []).forEach((g, gi) => (g.items || []).forEach((l, ii) => { if (hit(l.name) || hit(l.desc) || hit(l.intro)) out.push({ cat:'资源导航', t:l.name, sub:(l.desc || l.intro || ''), fn:`openNavItem(${gi},${ii})` }); }));
  /* —— round16 扩展：纳入此前未被检索的文本源 —— */
  (wengeGraph().nodes || []).forEach(n => {                 /* 文革图谱（人物已由 figuresList 覆盖，此处只补组织/派系/事件） */
    if (!n || n.type === 'person') return;
    if (hit(n.name) || hit(n.desc) || hit(n.role) || hit((n.points || []).join(' ')))
      out.push({ cat:'文革图谱', t:n.name, sub:(n.years ? n.years + ' · ' : '') + (n.role || n.desc || ''), fn:`openGraphJump('${n.id}','wenge')` });
  });
  (EX.features || []).forEach(f => (f.factions || []).forEach(x => {   /* 文革各派系释义 */
    if (hit(x.name) || hit(x.desc)) out.push({ cat:'文革派系', t:x.name, sub:x.desc || '', fn:`openHub('wenge')` });
  }));
  const _wt = EX.worksTimeline || {};                        /* 导师著作年表 */
  Object.keys(_wt).forEach(pname => {
    const li = (leaders || []).findIndex(p => p.name === pname);
    (_wt[pname] || []).forEach(e => {
      if (hit(e.t) || hit(e.y)) out.push({ cat:'著作年表', t:(e.y ? e.y + ' ' : '') + (e.t || ''), sub:pname, fn:(li >= 0 ? `showLeaderDetail(${li})` : `openHub('leaders')`) });
    });
  });
  (EX.topics || []).forEach(t => { if (hit(t.title) || hit(t.desc)) out.push({ cat:'阅读路径', t:t.title, sub:t.desc || '', fn:`openSection(secIdx('阅读与手册'))` }); });
  schoolGroups().forEach((g, gi) => { if (hit(g.note)) out.push({ cat:(g.group || '流派'), t:'流派说明', sub:g.note, fn:`openHub('${gi === 0 ? 'thoughts' : 'orgs'}')` }); });
  (CT.help || []).forEach(([k, v]) => { if (hit(k) || hit(v)) out.push({ cat:'使用指南', t:k, sub:v, fn:`openSection(secIdx('使用指南'))` }); });
  (CT.faq || []).forEach(([qq, aa]) => { if (hit(qq) || hit(aa)) out.push({ cat:'常见问题', t:qq, sub:aa, fn:`openSection(secIdx('使用指南'))` }); });
  (channelList() || []).forEach(c => { const _s = [c.author, c.text, c.critique && c.critique.text].filter(Boolean).join(' '); if (hit(_s)) out.push({ cat:'频道', t:c.author || '发言', sub:_s, fn:'openChannel()' }); });

  /* 同类同名去重 + 每类限量，避免单一来源刷屏 */
  const _seen = {}, _per = {}, _kept = [];
  out.forEach(h => { const k = h.cat + '|' + h.t; if (_seen[k]) return; _seen[k] = 1;
    _per[h.cat] = (_per[h.cat] || 0) + 1; if (_per[h.cat] > 25) return; _kept.push(h); });
  return _kept.slice(0, 120);
}
function omniCounts(hits){
  const cats = {}; hits.forEach(h => { cats[h.cat] = (cats[h.cat] || 0) + 1; });
  return Object.keys(cats).map(k => k + ' ' + cats[k]).join(' · ');
}
function renderOmni(q){
  const el = document.getElementById('omni'); if (!el) return;
  if (!q){ el.hidden = true; el.innerHTML = ''; return; }
  const hits = omniSearch(q);
  if (!hits.length){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="lcard" onclick="openOmniResults('${escAttr(q)}')" style="border:1px solid var(--accent);margin:2px 0 8px;cursor:pointer">
    <span class="li">🔎</span>
    <div style="flex:1"><div class="pname">全站命中 · ${hits.length} 条</div>
    <div class="prole" style="line-height:1.7">${omniCounts(hits)}　<span style="opacity:.6">点击查看全部 ›</span></div></div></div>`;
}
function openOmniResults(q){
  const hits = omniSearch(q);
  const cut = s => { s = String(s || ''); return s.length > 72 ? s.slice(0, 72) + '…' : s; };
  const body = hits.length ? hits.map(h => `<div class="lcard" onclick="${h.fn}">
      <div style="flex:1"><div class="pname">${hl(h.t, q)}<span style="font-size:.62rem;opacity:.55;font-weight:normal;margin-left:8px;border:1px solid currentColor;border-radius:4px;padding:0 5px">${h.cat}</span></div>
      <div class="prole" style="line-height:1.7">${hl(cut(h.sub), q)}</div></div>
      <span style="opacity:.4">›</span></div>`).join('') : '<p class="sub">没有匹配的史料 / 导航条目。</p>';
  openContent('🔎 全站命中 · ' + q,
    `<p class="sub" style="margin:0 0 10px;line-height:1.7">关键词「${escHtml(q)}」全站共命中 <b>${hits.length}</b> 条，分布在：${omniCounts(hits)}。</p>` + body);
}
const PAGE = 20;
let listLimit = PAGE, listSig = '';
function render(){
  curQ = document.getElementById('search').value.trim().toLowerCase();
  const terms = curQ.split(/\s+/).filter(Boolean);
  const author = authorSel.value;
  const sort = document.getElementById('sortSel').value;
  const groupBy = document.getElementById('groupSel').value;
  const sig = [curQ, activeCat, activeTag, author, sort, groupBy, favOnly, fileOnly].join('~');
  if (sig !== listSig){ listSig = sig; listLimit = PAGE; }

  const crb = document.getElementById('crumb');
  if (crb){
    CUR_TRAIL = [{ t:'资源目录', fn:()=>goResults() }];
    crb.innerHTML = `<nav class="crumb" aria-label="面包屑导航"><button class="aslink" onclick="goHome()">首页</button> <span class="sep">›</span> <span class="cur">资源目录${activeCat && activeCat !== '全部' ? ' · ' + activeCat : ''}</span></nav>`;
  }

  document.querySelectorAll('#catChips .tag').forEach(b => b.classList.toggle('active', b.dataset.cat === activeCat));
  document.getElementById('filterbox').hidden = !(curQ || activeTag || author !== '全部作者' || favOnly || fileOnly);

  let all = RES.filter(r => {
    /* 有关键词时搜「全库」：不受当前分类标签限制。
       （原先在默认的「推荐」分类下搜索，只会在 isFeatured 的少数条目里找，
        导致导入的书、以及一切非「原著」书籍都搜不出来——用户反馈「搜不到/结果只有一条」。） */
    if (terms.length) return true;
    if (activeCat === '推荐') { if (!isFeatured(r)) return false; }
    else if (activeCat !== '全部') { if (r.cat !== activeCat) return false; }
    if (author !== '全部作者' && r.author !== author) return false;
    if (activeTag && !(r.tags || []).includes(activeTag)) return false;
    if (favOnly && !isFav(r)) return false;
    if (fileOnly && !hasFile(r)) return false;
    return true;
  });
  if (terms.length){ all = all.map(r => ({ r, s: scoreIt(r, terms) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.r); }
  if (activeCat === '推荐' || sort === 'hot') all = all.slice().sort((a,b) => (b.hot||0) - (a.hot||0));
  if (sort === 'new') all = all.slice().sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const total = all.length;
  const list = all.slice(0, listLimit);

  let html = '';
  if (list.length) {
    if (activeCat === '推荐' || (terms.length && groupBy === 'cat')) {
      html = list.map(resourceCardHTML).join('');
    } else {
      const groups = {}, order = [];
      const keyOf = r => groupBy === 'author' ? r.author : r.cat;
      list.forEach(r => { const g = keyOf(r); if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(r); });
      html = order.map(g => {
        const title = groupBy === 'author' ? `👤 ${g}` : `${catIcon[g] || '📦'} ${g}`;
        return `<h2 class="sub-title">${title}<span style="opacity:.5;letter-spacing:0"> · ${groups[g].length}</span></h2>` + groups[g].map(resourceCardHTML).join('');
      }).join('');
    }
  }
  if (total > list.length) html += `<div class="more-wrap"><button onclick="moreList()">加载更多 · 还有 ${total - list.length} 条</button></div>`;
  document.getElementById('list').innerHTML = html;
  renderOmni(curQ);

  const emptyEl = document.getElementById('empty');
  if (total){ emptyEl.style.display = 'none'; }
  else {
    emptyEl.style.display = 'block';
    const sug = suggest(curQ);
    emptyEl.innerHTML = '没有找到匹配的资源<br>换个关键词试试，或回首页按分类浏览' +
      (sug.length ? `<div class="sugg">你是不是想找：${sug.map(s => `<span class="tag" onclick="quickSearch('${escAttr(s)}')">${s}</span>`).join('')}</div>` : '');
  }

  const title = terms.length ? '🔎 搜 索 结 果'
    : (activeCat === '推荐' ? '⭐ 推 荐 内 容' : activeCat === '全部' ? '📦 资 源 目 录' : `${catIcon[activeCat] || '📦'} ${activeCat}`);
  document.getElementById('resTitle').innerHTML = title + `　<span style="opacity:.5;letter-spacing:0">共 ${total} 项 · ✅正常 ⚠️网盘 ❌待补</span>`;
  bindClicks();
}
function moreList(){ listLimit += PAGE; render(); }
function clearFilters(){
  document.getElementById('search').value = '';
  activeTag = ''; favOnly = false; fileOnly = false;
  const c = document.getElementById('favChip'); c.textContent = '☆ 我的收藏'; c.classList.remove('active');
  const f = document.getElementById('fileChip'); if (f){ f.textContent = '📄 仅看有文件'; f.classList.remove('active'); }
  authorSel.value = '全部作者';
  document.getElementById('groupSel').value = 'cat';
  document.getElementById('sortSel').value = 'default';
  document.querySelectorAll('#tagrow .tag').forEach(x => x.classList.remove('active'));
  activeCat = '全部';
  render();
}
function renderContinue(){
  const el = document.getElementById('continueBox'); if (!el) return;
  const id = localStorage.getItem('lastItem');
  const idx = RES.findIndex(r => (r.id || r.title) === id);
  if (idx < 0){ el.innerHTML = ''; return; }
  const it = RES[idx];
  el.innerHTML = `<button class="continue aslink" onclick="openItemDetail(${idx})">
    <span class="ci">${it.icon || '📕'}</span>
    <span class="ct"><span class="cn">继续上次</span><span>${it.title}</span></span>
    <span style="opacity:.4">›</span></button>`;
}

/* ---------- 主页「我的好友」（QQ 式好友列表） ---------- */
function homeFriendList(){ try { var a = JSON.parse(localStorage.getItem('homeFriends') || '[]'); return Array.isArray(a) ? a : []; } catch(e){ return []; } }
function saveHomeFriends(a){ try { lset('homeFriends', JSON.stringify(a || [])); } catch(e){} }
function inHomeFriends(k){ return homeFriendList().some(function(x){ return x && x.k === k; }); }
function imgOf(p){ var im = p && p.img; return (im && !/placeholder\.svg$/.test(im)) ? im : ''; }
var _friendReg = {};
function friendBtnHTML(entry){
  if (!entry || !entry.k) return '';
  _friendReg[entry.k] = entry;
  var on = inHomeFriends(entry.k);
  var arg = encodeURIComponent(entry.k).replace(/'/g, '%27');
  return '<button id="addHomeBtn" class="addhome' + (on ? ' on' : '') + '" onclick="toggleHomeFriend(\'' + arg + '\')">' +
    (on ? '✔ 已添加到主页（点此移出）' : '➕ 添加到主页') + '</button>';
}
function toggleHomeFriend(arg){
  var k = ''; try { k = decodeURIComponent(arg); } catch(e){ k = arg; }
  var e = _friendReg[k]; if (!e) return;
  var a = homeFriendList();
  var i = a.findIndex(function(x){ return x && x.k === k; });
  if (i >= 0) a.splice(i, 1); else a.push(e);
  saveHomeFriends(a);
  var b = document.getElementById('addHomeBtn');
  if (b){ var on = i < 0; b.classList.toggle('on', on); b.textContent = on ? '✔ 已添加到主页（点此移出）' : '➕ 添加到主页'; }
  renderHomeFriends();
  toast(i >= 0 ? '已从主页移出' : '已添加到主页');
}
function friendRow(o){
  var ava = o.img ? '<img src="' + escHtml(o.img) + '" alt="">' : '<span class="fico">' + (o.icon || '🫡') + '</span>';
  return '<div class="frow" onclick="' + (o.act || '') + '"><span class="fava">' + ava + '</span>' +
    '<span class="fmeta"><span class="fnm">' + escHtml(o.name || '') + '</span>' +
    (o.sub ? '<span class="fsub">' + escHtml(o.sub) + '</span>' : '') +
    '</span><span class="fmor">›</span></div>';
}
function graphFriendRows(){
  var defs = [];
  try { if (window.YZY && YZY.listGraphs) YZY.listGraphs().forEach(function(g){
    if (g && g.id) defs.push({ name:g.name, icon:'🕸️', sub:'关系图谱', act:"location.href='graph.html?g=" + encodeURIComponent(g.id) + "'" });
  }); } catch(e){}
  if (!defs.length) defs.push({ name:'主图谱', icon:'🕸️', sub:'关系图谱', act:"location.href='graph.html'" });
  defs.push({ name:'3D 关系图谱', icon:'🧊', sub:'立体图谱', act:"location.href='graph3d.html'" });
  return defs;
}
function leaderFriendRows(){
  var out = [];
  try { (CT.leaders || []).forEach(function(p, i){
    out.push({ k:'l:'+p.name, name:p.name, img:(p.img && !/placeholder\.svg$/.test(p.img) ? p.img : ''), icon:'🫡', sub:[p.years, p.role].filter(Boolean).join(' · '), act:"showLeaderDetail(" + i + ")" });
  }); } catch(e){}
  return out;
}
function ensureHomeFriendsInit(){
  /* 首次使用：革命导师默认就是「已添加到主页」的状态（与其他人一样，可自行移出） */
  try{
    if (localStorage.getItem('homeFriendsInit') === '1') return;
    var a = homeFriendList();
    leaderFriendRows().forEach(function(r){
      if (!a.some(function(x){ return x && x.k === r.k; })) a.push({ k:r.k, name:r.name, img:r.img, icon:r.icon, sub:r.sub, act:r.act });
    });
    saveHomeFriends(a);
    lset('homeFriendsInit', '1');
  }catch(e){}
}
function renderHomeFriends(){
  var box = document.getElementById('homeFriends'); if (!box) return;
  ensureHomeFriendsInit();
  /* 导师与图谱入口之外的人一律由 homeFriends 决定：默认已添加，可在人物页点「✔ 已添加到主页（点此移出）」取消 */
  var rows = graphFriendRows().map(friendRow).concat(homeFriendList().map(friendRow));
  if (!rows.length) rows = ['<p class="sub" style="margin:0;opacity:.75;line-height:1.8">还没有添加到主页的人。在人物页面点「➕ 添加到主页」，就能把常看的人放到这里。</p>'];
  box.innerHTML = rows.join('');
}

function albumGroups(){ return (window.SITE_ALBUM || []); }
function albumCount(){ var n = 0; albumGroups().forEach(function(g){ n += (g.items || []).length; }); return n; }
function pcRow(icon, title, sub, act){
  return '<div class="pc-row" onclick="' + act + '"><span class="pc-ic">' + icon + '</span>' +
    '<span class="pc-tx"><span class="pc-t">' + title + '</span>' + (sub ? '<span class="pc-s">' + sub + '</span>' : '') + '</span>' +
    '<span class="pc-ar">›</span></div>';
}
function renderPc(){
  var el = document.getElementById('pcView'); if (!el) return;
  var name = localStorage.getItem('acctName') || '教员的好战士';
  var av = localStorage.getItem('acctAvatar') || '';
  var favN = 0; try { favN = JSON.parse(localStorage.getItem('favs') || '[]').length; } catch(e){}
  el.innerHTML =
    '<div class="pc-head">' +
      '<button class="pc-ava" onclick="openAccountView()" title="我的资料">' + (av ? '<img src="' + av + '" alt="">' : '👤') + '</button>' +
      '<div class="pc-meta"><div class="pc-name">' + escHtml(name) + '</div>' +
        '<div class="pc-sign">我的资料 · 账号与本机数据 →</div></div>' +
      '<button class="pc-x" onclick="closeDrawer()" aria-label="关闭">✕</button>' +
    '</div>' +
    '<div class="pc-list">' +
      pcRow('🖼️','相册','内置照片 ' + albumCount() + ' 张','openAlbum()') +
      pcRow('⭐','收藏','我的收藏 ' + favN + ' 项','openFavs()') +
      pcRow('🌐','网站版','xuetone.netlify.app · 浏览器打开','openSiteVersion()') +
      pcRow('📁','文件','全部文件 · ' + RES.length + ' 项',"openSection(secIdx('文件'))") +
      pcRow('📥','导入书籍','本机电子书 · 可搜索可阅读','yzBooks.openShelf()') +
      pcRow('🎮','闯关','地图关卡 · 导入 HTML 包','location.href=\'challenge.html\'') +
      pcRow('👕','个性装扮','敬请期待','pcDress()') +
    '</div>' +
    '<div class="pc-bottom">' +
      '<button class="pc-b" onclick="openSettings()">⚙️ 设置</button>' +
      '<button class="pc-b" onclick="pcNight()">🌙 夜间</button>' +
    '</div>';
}
function openFavs(){
  var list = RES.filter(isFav);
  openContent('⭐ 我的收藏',
    crumbFrom([{ t:'我的收藏', fn:openFavs }]) +
    (list.length ? list.map(function(r){ return rowHTML(RES.indexOf(r)); }).join('')
                 : '<p class="sub" style="line-height:1.9">还没有收藏。在资源卡片上点「☆」即可加入收藏。</p>'));
}
/* ---------- 相册：IndexedDB 大容量存储（旧 localStorage 数据自动迁移） ---------- */
const ALBUM_DB = 'yzy_album', ALBUM_STORE = 'photos';
let __albumExtra = [], __albumBooting = false, __albumBooted = false;
function _albIdb(){
  return new Promise(function(res, rej){
    try {
      if (!window.indexedDB) throw new Error('no-idb');
      var rq = indexedDB.open(ALBUM_DB, 1);
      rq.onupgradeneeded = function(){ var db = rq.result; if (!db.objectStoreNames.contains(ALBUM_STORE)) db.createObjectStore(ALBUM_STORE, { keyPath:'id' }); };
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('idb-open')); };
    } catch(e){ rej(e); }
  });
}
function _albRun(mode, fn){
  return _albIdb().then(function(db){
    return new Promise(function(res, rej){
      var tx = db.transaction(ALBUM_STORE, mode), st = tx.objectStore(ALBUM_STORE), rq = fn(st);
      tx.oncomplete = function(){ res(rq && rq.result); };
      tx.onerror = function(){ rej(tx.error); };
    });
  });
}
function _albPut(rec){ return _albRun('readwrite', function(st){ return st.put(rec); }); }
function _albAll(){
  return _albIdb().then(function(db){
    return new Promise(function(res, rej){
      var tx = db.transaction(ALBUM_STORE, 'readonly'), rq = tx.objectStore(ALBUM_STORE).getAll();
      rq.onsuccess = function(){ res(rq.result || []); }; rq.onerror = function(){ rej(rq.error); };
    });
  });
}
function _albDataURLtoBlob(u){
  try {
    var parts = String(u).split(','), mime = (parts[0].match(/:(.*?);/) || [0, 'image/jpeg'])[1];
    var bin = atob(parts[1] || ''), n = bin.length, arr = new Uint8Array(n);
    for (var i = 0; i < n; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch(e){ return null; }
}
function _albRelease(){
  __albumExtra.forEach(function(e){ if (e.src && e.src.indexOf('blob:') === 0){ try { URL.revokeObjectURL(e.src); } catch(x){} } });
}
function albumCacheFromRecs(recs){
  _albRelease();
  __albumExtra = (recs || []).map(function(r){
    var src = ''; try { src = URL.createObjectURL(r.blob); } catch(e){}
    return { id:r.id, name:r.name, src:src };
  });
}
function albumPageOpen(){
  try { var t = _pageStack[_pageStack.length - 1]; return !!(t && t.title && t.title.indexOf('\u76f8\u518c') >= 0); } catch(e){ return false; }
}
function albumBoot(){
  if (__albumBooting) return Promise.resolve(__albumExtra);
  __albumBooting = true;
  var legacy = []; try { legacy = JSON.parse(localStorage.getItem('albumExtra') || '[]'); } catch(e){}
  var migrate = Promise.resolve();
  if (legacy.length){
    migrate = Promise.all(legacy.map(function(it, i){
      var b = _albDataURLtoBlob(it.src || ''); if (!b) return Promise.resolve();
      return _albPut({ id:'m' + Date.now().toString(36) + '_' + i, name:it.name || 'photo', blob:b }).catch(function(){});
    })).then(function(){ try { localStorage.removeItem('albumExtra'); } catch(e){} });
  }
  return migrate.then(_albAll).then(function(recs){
    albumCacheFromRecs(recs); __albumBooted = true; __albumBooting = false;
    if (albumPageOpen()) openAlbum();
    return __albumExtra;
  }).catch(function(){ __albumBooting = false; return __albumExtra; });
}
function albumAll(){
  var G = albumGroups().map(function(g){ return { icon:g.icon, title:g.title, items:(g.items || []).slice() }; });
  if (__albumExtra.length) G.push({ icon:'📥', title:'\u6211\u5bfc\u5165\u7684', items:__albumExtra });
  return G;
}
function openAlbum(){
  if (!__albumBooted) albumBoot();
  var G = albumAll();
  var body = G.map(function(g){
    return '<h2 class="sub-title">' + (g.icon || '🖼\ufe0f') + ' ' + g.title +
      '<span style="opacity:.5;letter-spacing:0"> \u00b7 ' + g.items.length + '</span></h2>' +
      '<div class="album-grid">' + g.items.map(function(it){
        return '<figure class="album-item" onclick="openPhoto(\'' + encodeURIComponent(it.src) + '\',\'' + encodeURIComponent(it.name || '') + '\')"><img src="' + it.src + '" alt="' + escHtml(it.name) + '" loading="lazy" decoding="async"><figcaption>' + escHtml(it.name) + '</figcaption></figure>';
      }).join('') + '</div>';
  }).join('');
  openContent('🖼\ufe0f \u76f8\u518c',
    crumbFrom([{ t:'\u76f8\u518c', fn:openAlbum }]) +
    '<div class="ch-top"><span class="ch-top-t">🖼\ufe0f \u76f8\u518c \u00b7 \u5185\u7f6e ' + albumCount() + ' \u5f20' + (__albumExtra.length ? ' \u00b7 \u5df2\u5bfc\u5165 ' + __albumExtra.length + ' \u5f20' : '') + '</span>' +
      '<button class="sbtn" onclick="albumImport()">\uff0b \u5bfc\u5165\u7167\u7247</button>' +
      '<input type="file" id="albumFile" accept="image/*" multiple style="display:none" onchange="albumImportDo(this)"></div>' +
    (G.length ? body : '<p class="sub">\u6682\u65e0\u7167\u7247\u3002</p>'));
}
function albumImport(){ var f = document.getElementById('albumFile'); if (f) f.click(); }
function albumImportDo(inp){
  var files = Array.prototype.slice.call(inp.files || []); if (!files.length) return;
  var pend = files.length, added = 0;
  function step(){
    if (--pend > 0) return;
    if (!added){ toast('\u5bfc\u5165\u5931\u8d25\uff1a\u5b58\u50a8\u4e0d\u53ef\u7528'); return; }
    albumBoot().then(function(){ openAlbum(); toast('\u5df2\u5bfc\u5165 ' + added + ' \u5f20\u7167\u7247'); });
  }
  files.forEach(function(file){
    var rd = new FileReader();
    rd.onload = function(){
      var img = new Image();
      img.onload = function(){
        var max = 1200, w = img.width || max, h = img.height || max, sc = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
        try { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); } catch(e){}
        var rec = { id:'p' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7), name:(file.name || 'photo').replace(/\.[^.]+$/, '') };
        function _store(blob){
          if (!blob){ step(); return; }
          rec.blob = blob;
          _albPut(rec).then(function(){ added++; step(); }, function(){ step(); });
        }
        if (c.toBlob) c.toBlob(function(b){ _store(b); }, 'image/jpeg', 0.82);
        else _store(_albDataURLtoBlob(c.toDataURL('image/jpeg', 0.82)));
      };
      img.onerror = function(){ step(); };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}
function openPhoto(srcEnc, nameEnc){
  var src = decodeURIComponent(srcEnc), name = decodeURIComponent(nameEnc);
  var old = document.getElementById('photoView'); if (old) old.remove();
  var d = document.createElement('div'); d.id = 'photoView'; d.className = 'photo-view';
  d.innerHTML = '<div class="pv-bar"><span class="pv-name">' + escHtml(name) + '</span>' +
    '<a class="pv-btn" href="' + src + '" download="' + escHtml(name) + '">\u2b07 \u4e0b\u8f7d</a>' +
    '<button class="pv-btn" onclick="closePhoto()">\u2715</button></div>' +
    '<div class="pv-stage"><img src="' + src + '" alt="' + escHtml(name) + '"></div>';
  d.addEventListener('click', function(ev){ if (ev.target === d || ev.target.classList.contains('pv-stage')) closePhoto(); });
  document.body.appendChild(d);
}
function closePhoto(){ var e = document.getElementById('photoView'); if (e) e.remove(); }
function personImg(name){
  try { var L = (CT.leaders || []).concat(CT.comrades || []).concat((window.SITE_EXTRA && window.SITE_EXTRA.figures) || []);
    for (var i = 0; i < L.length; i++){ if (L[i] && L[i].name === name && L[i].img) return L[i].img; } } catch(e){}
  return '';
}
function channelList(){
  var base = (window.SITE_CHANNEL || []);
  var extra = []; try { extra = JSON.parse(localStorage.getItem('channelExtra') || '[]'); } catch(e){}
  return base.concat(Array.isArray(extra) ? extra : []);
}
function chanFace(a){
  var im = personImg(a);
  if (im) return '<img src="' + escHtml(im) + '" alt="">';
  var ch = String(a || '').replace(/[\uff08(\u00b7.\s].*$/, '').charAt(0) || '\uff1f';
  return '<span class="ch-ini">' + escHtml(ch) + '</span>';
}
function chanBodyHTML(p, withCrit){
  var critic = !!p.critic;
  var html = '<div class="ch-head"><span class="ch-ava">' + chanFace(p.author) + '</span>' +
      '<div class="ch-meta"><span class="ch-name">' + escHtml(p.author || '') + (critic ? ' <i class="ch-badge">被批判人物</i>' : '') + '</span>' +
      (p.src ? '<span class="ch-src">' + escHtml(p.src) + '</span>' : '') + '</div></div>' +
    '<p class="ch-text">' + escHtml(p.text || '') + '</p>';
  return html;
}
function chanKey(p){ return (p.author || '') + '|' + (p.text || ''); }
function chanComments(){ try { return JSON.parse(localStorage.getItem('chanComments') || '{}'); } catch(e){ return {}; } }
/* 默认评论：仅为「有意义」的条目添加（被批判者的导师批判 + 少量精选），其余不默认生成 */
var CHAN_CURATED = {
  '卡尔·马克思|全世界无产者，联合起来！': [{ by:'读者', text:'这句号召把分散的斗争连成了一片。' }],
  '弗里德里希·恩格斯|劳动创造了人本身。': [{ by:'读者', text:'劳动的观点，是理解历史的钥匙。' }],
  '弗拉基米尔·伊里奇·列宁|没有革命的理论，就不会有革命的运动。': [{ by:'读者', text:'理论不是空谈，是行动的指南。' }],
  '毛泽东|一切反动派都是纸老虎。': [{ by:'同志', text:'战略上藐视敌人，战术上重视敌人。' }]
};
function chanDefaultComments(p){
  if (p && p.critic && p.critique){ return [{ by:(p.critique.by || '导师'), text:(p.critique.text || ''), books:(p.critique.books || []), mentor:true }]; }
  var c = CHAN_CURATED[chanKey(p)];
  return c ? c.slice() : [];
}
function chanCommentHTML(c){
  return '<div class="ch-cmt-item"><span class="ch-cmt-ic">' + (c.mentor ? '⚖️' : '💬') + '</span>' +
    '<span class="ch-cmt-tx"><b class="ch-cmt-by">' + escHtml(c.by || '') + '</b>' + escHtml(c.text || '') +
    ((c.books && c.books.length) ? '<div class="ch-books">' + c.books.map(function(x){ return '<span class="ch-book">📖 ' + escHtml(x) + '</span>'; }).join('') + '</div>' : '') +
    '</span></div>';
}
function chanCommentCount(p){ var c = chanComments()[chanKey(p)]; return chanDefaultComments(p).length + (c ? c.length : 0); }
function chanAddComment(key, text){ var m = chanComments(); (m[key] = m[key] || []).push({ text:text, ts:Date.now() }); try { lset('chanComments', JSON.stringify(m)); } catch(e){} }
function encKey(p){ return encodeURIComponent(chanKey(p)).replace(/'/g, '%27'); }
function chanLikes(){ try { return JSON.parse(localStorage.getItem('chanLikes') || '{}'); } catch(e){ return {}; } }
function chanLikeCount(key){ var m = chanLikes(); return m[key] ? 1 : 0; }
function chanLike(keyEnc, el){
  var key = decodeURIComponent(keyEnc); var m = chanLikes();
  if (m[key]) delete m[key]; else m[key] = 1;
  try { lset('chanLikes', JSON.stringify(m)); } catch(e){}
  if (el){ el.classList.toggle('on', !!m[key]); var n = el.querySelector('i'); if (n) n.textContent = chanLikeCount(key); }
  toast(m[key] ? '已点赞' : '已取消点赞');
}
function chanFootHTML(p){
  var k = encKey(p);
  var liked = chanLikes()[chanKey(p)] ? ' on' : '';
  return '<div class="ch-foot">' +
    '<button class="ch-act' + liked + '" onclick="event.stopPropagation();chanLike(\'' + k + '\',this)">👍<i>' + chanLikeCount(chanKey(p)) + '</i></button>' +
    '<button class="ch-act" onclick="event.stopPropagation();openChannelPost(\'' + k + '\')">💬<i>' + chanCommentCount(p) + '</i></button>' +
    '<button class="ch-act" onclick="event.stopPropagation();chanCopy(\'' + k + '\')">📋<i>复制</i></button>' +
    '</div>';
}
function chanCardHTML(p){
  return '<article class="ch-post' + (p.critic ? ' ch-crit' : '') + '" onclick="openChannelPost(\'' + encKey(p) + '\')">' + chanBodyHTML(p) + chanFootHTML(p) + '</article>';
}
function copyText(t, okMsg){
  try { if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(function(){ toast(okMsg || '已复制'); }, function(){ fallbackCopy(t, okMsg); }); return; } } catch(e){}
  fallbackCopy(t, okMsg);
}
function fallbackCopy(t, okMsg){
  try { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove(); toast(okMsg || '已复制'); }
  catch(e){ toast('复制失败'); }
}
function chanCopy(keyEnc){
  var key = decodeURIComponent(keyEnc);
  var p = channelList().find(function(x){ return chanKey(x) === key; }); if (!p) return;
  copyText((p.author || '') + '：' + (p.text || '') + (p.src ? ('（' + p.src + '）') : ''), '已复制发言');
}
function channelBodyHTML(list){
  if (!list.length) return '<p class="sub" style="line-height:1.9">没有找到相关发言。</p>';
  return list.map(chanCardHTML).join('');
}
function channelHTML(){ return channelBodyHTML(channelList()); }
function channelSearch(q){
  var cv = document.getElementById('contentView'); if (!cv) return;
  var ql = (q || '').toLowerCase();
  if (!ql){ cv.innerHTML = channelHTML(); return; }
  var list = channelList().filter(function(p){
    var hay = String(p.author || '') + String(p.text || '') + String(p.src || '') + (p.critic ? JSON.stringify(p.critique || {}) : '');
    return hay.toLowerCase().indexOf(ql) >= 0;
  });
  cv.innerHTML = channelBodyHTML(list);
}
function chanDetailHTML(key, keyEnc){
  var p = channelList().find(function(x){ return chanKey(x) === key; });
  if (!p) return '<p class="sub">内容不存在。</p>';
  var defaults = chanDefaultComments(p);
  var users = chanComments()[key] || [];
  var total = defaults.length + users.length;
  return crumbFrom([{ t:'频道', fn:openChannel }, { t:'详情', fn:function(){ openChannelPost(keyEnc); } }]) +
    '<article class="ch-post ch-detail">' + chanBodyHTML(p, true) + chanFootHTML(p) + '</article>' +
    '<div class="ch-cmts"><div class="ch-cmts-t">💬 评论区 · ' + total + '</div>' +
      defaults.map(chanCommentHTML).join('') +
      users.map(function(c){ return '<div class="ch-cmt-item"><span class="ch-cmt-ic">💬</span><span class="ch-cmt-tx"><b class="ch-cmt-by">我</b>' + escHtml(c.text) + '</span></div>'; }).join('') +
      (total ? '' : '<p class="sub" style="line-height:1.9">还没有评论，来说两句。</p>') +
    '</div>' +
    '<div class="ch-input"><textarea id="chCmtTa" placeholder="写下你的评论…" rows="2"></textarea><button class="sbtn" onclick="chanSend(\'' + keyEnc + '\')">发送</button></div>';
}
function openChannelPost(kEnc){ var key = decodeURIComponent(kEnc); openContent('📡 帖子详情', chanDetailHTML(key, kEnc)); }
function chanSend(kEnc){
  var ta = document.getElementById('chCmtTa'); if (!ta) return;
  var t = ta.value.trim(); if (!t){ toast('请输入评论'); return; }
  var key = decodeURIComponent(kEnc); chanAddComment(key, t);
  var top = _pageStack[_pageStack.length - 1];
  var html = chanDetailHTML(key, kEnc);
  if (top){ top.html = html; _renderPage(top); } else { openChannelPost(kEnc); }
  toast('已发布评论');
}
function openChannel(){ openContent('📡 频道', channelHTML(), { root:true, search:channelSearch, ph:'搜索发言…', right:{ text:'📥', act:'channelImport()' } }); }
function renderChannel(){ var cv = document.getElementById('contentView'); if (cv) cv.innerHTML = channelHTML(); }
function channelImport(){
  var old = document.getElementById('chImport'); if (old) old.remove();
  var d = document.createElement('div'); d.id = 'chImport'; d.className = 'leave open';
  d.innerHTML = '<div class="leave-card"><b>📥 \u5bfc\u5165\u9891\u9053\u5185\u5bb9</b>' +
    '<p class="leave-note" style="line-height:1.7">\u7c98\u8d34 JSON \u6570\u7ec4\uff0c\u6bcf\u9879\u5982\uff1a<br><code>{"author":"\u59d3\u540d","text":"\u53d1\u8a00","src":"\u51fa\u5904"}</code><br>\u88ab\u6279\u5224\u4eba\u7269\u53ef\u52a0 <code>"critic":true,"critique":{"by":"\u5bfc\u5e08","text":"\u6279\u5224","books":["\u4e66\u540d"]}</code>\u3002</p>' +
    '<textarea id="chImportTa" spellcheck="false" style="width:100%;height:150px;margin:6px 0;padding:8px;border-radius:8px;border:1px solid var(--card-border);background:var(--card);color:var(--text);font-size:.72rem;font-family:ui-monospace,Menlo,Consolas,monospace;resize:vertical"></textarea>' +
    '<div class="leave-ops"><button class="go" onclick="channelImportDo()">\u5bfc\u5165</button><button onclick="channelImportClose()">\u53d6\u6d88</button></div>' +
    '<p class="leave-note">\u6570\u636e\u53ea\u5b58\u672c\u673a\u3002</p></div>';
  document.body.appendChild(d);
}
function channelImportClose(){ var e = document.getElementById('chImport'); if (e) e.remove(); }
function channelImportDo(){
  var ta = document.getElementById('chImportTa'); if (!ta) return;
  var arr; try { arr = JSON.parse(ta.value || '[]'); } catch(e){ toast('JSON \u683c\u5f0f\u6709\u8bef'); return; }
  if (!Array.isArray(arr) || !arr.length){ toast('\u8bf7\u63d0\u4f9b\u975e\u7a7a JSON \u6570\u7ec4'); return; }
  var ok = arr.filter(function(x){ return x && x.author && x.text; });
  if (!ok.length){ toast('\u6bcf\u9879\u9700\u542b author \u4e0e text'); return; }
  var cur = []; try { cur = JSON.parse(localStorage.getItem('channelExtra') || '[]'); } catch(e){}
  cur = cur.concat(ok);
  try { lset('channelExtra', JSON.stringify(cur)); } catch(e){ toast('\u5b58\u4e0d\u4e0b\uff0c\u5185\u5bb9\u8fc7\u591a'); return; }
  channelImportClose(); renderChannel(); toast('\u5df2\u5bfc\u5165 ' + ok.length + ' \u6761');
}
function pcDress(){ toast('个性装扮暂未开放'); }
/* 网站版（Netlify 部署）：App 内无网络权限，交给系统浏览器打开 */
function openSiteVersion(){
  var u = 'https://xuetone.netlify.app/';
  try{
    if (window.AndroidApp && typeof AndroidApp.openExternal === 'function'){
      AndroidApp.openExternal(u);
      try { toast('已在浏览器打开网站版'); } catch(e){}
      return;
    }
  }catch(e){}
  try{
    var w = window.open(u, '_blank', 'noopener,noreferrer');
    if (!w) location.href = u;
    try { toast('已在浏览器打开网站版'); } catch(e){}
  }catch(e2){ try { location.href = u; } catch(e3){} }
}
function pcNight(){ try { var dark = resolvedTheme(localStorage.getItem('theme') || 'auto') === 'dark'; setTheme(dark ? 'light' : 'dark'); toast(dark ? '已切换浅色' : '已切换深色'); } catch(e){} }

function bindClicks(){
  /* 只「叠加」点击计数 / 外站不跳转这类额外行为，
     绝不能用 a.onclick = 覆盖卡片自带的内联 onclick —— 那会把 cardAction → openItemDetail
     整个顶掉，导致搜索结果里的书籍「点了没反应、打不开」。改用 addEventListener + 幂等标记。 */
  document.querySelectorAll('#list a.card, #linksList a.card').forEach(a => {
    if (a.dataset.bound === '1') return;
    a.dataset.bound = '1';
    const href = a.getAttribute('href') || '';
    const ext = href.startsWith('http');
    a.addEventListener('click', e => {
      const k = a.dataset.key; if (k) lset(k, (+localStorage.getItem(k) || 0) + 1);
      if (ext) e.preventDefault();   /* 外站链接一律不再跳转：本站只作介绍与索引 */
    });
  });
}

/* =====================================================================
   板块注册表
   ===================================================================== */
const helpHTML = CT.help ? `<ul>${CT.help.map(([k,v]) => `<li><b>${k}</b>　${v}</li>`).join('')}</ul>` : '';
const faqHTML = (CT.faq||[]).map(([q,a]) => `<details class="q"><summary>${q}</summary><p>${a}</p></details>`).join('');
const logHTML = `<ul class="changelog">${(CT.changelog||[]).map(c => `<li><b>${c.date}</b>${c.text}</li>`).join('')}</ul>`;
const LC = CT.legal || {};
const legalHTML =
  `<p>${LC.disclaimer||''}</p>
   <h3 style="margin-top:8px"><b>隐私说明</b></h3><ul>${(LC.privacy||[]).map(x=>`<li>${x}</li>`).join('')}</ul>
   <h3 style="margin-top:8px"><b>用户协议</b></h3><ul>${(LC.terms||[]).map(x=>`<li>${x}</li>`).join('')}</ul>`;
const metaHTML = (CT.meta||[]).map(s => `<section style="margin-bottom:16px"><h2 style="font-size:.78rem;color:var(--accent);letter-spacing:1px;margin-bottom:4px">${s.title}</h2><div style="font-size:.82rem;opacity:.88;line-height:1.95">${s.html}</div></section>`).join('');

/* ---------- 人物与资料 ---------- */
function personAuthors(name){ const a = (EX.authors || {})[name]; return (a && a.length) ? a : [name]; }
function personResources(name){ const keys = personAuthors(name); return RES.filter(r => r.author && keys.includes(r.author)); }
function personResourcesHTML(name){
  const list = personResources(name);
  if (!list.length) return `<h2 class="sub-title" style="margin-top:18px">📚 本站收录</h2><p class="sub">暂未收录相关书籍，欢迎通过「意见反馈」补充。</p>`;
  /* 默认直接展开：条目本就不多；此前默认折叠成「▸ 显示更多」，容易被误认为「书籍打不开」。 */
  return `<h2 class="sub-title" style="margin-top:18px">📚 本站收录 · ${list.length}</h2>` +
    `<p class="sub" style="margin:2px 0 6px;line-height:1.7">以下均为资源库里的同一条目，点一下即可打开详情。</p>` +
    list.map(it => rowHTML(RES.indexOf(it))).join('');
}
function timelineHTML(name){
  const ev = (EX.timelines || {})[name]; if (!ev || !ev.length) return '';
  return `<h2 class="sub-title" style="margin-top:18px">🕰️ 生平年表</h2><ul class="timeline">` + ev.map(e => `<li><b>${e.y}</b>${e.t}</li>`).join('') + `</ul>`;
}
function worksTimelineHTML(name){
  const ev = (EX.worksTimeline || {})[name]; if (!ev || !ev.length) return '';
  return `<h2 class="sub-title" style="margin-top:18px">📖 著作年表</h2><ul class="timeline">` + ev.map(e => `<li><b>${e.y}</b>${e.t}</li>`).join('') + `</ul>`;
}

/* ---------- 史料 ---------- */
const leaders = CT.leaders || [];
const comrades = CT.comrades || [];
/* 头像统一：有真实照片用照片；没有就画「姓氏字」头像（不再生成简笔画头像） */
function initialFace(p, big){
  const cls = big ? 'lface-lg' : 'lface';
  const key = String((p && (p.name || p.id)) || '').trim();
  const ch = key ? key.replace(/[（(·.·\s].*$/, '').charAt(0) : '？';
  const fs = big ? '3.6rem' : '1.35rem';
  return `<span class="${cls} lface-ini" style="display:inline-flex;align-items:center;justify-content:center;` +
    `border-radius:50%;background:rgba(245,197,24,.14);border:2px solid rgba(245,197,24,.5);color:#f5c518;` +
    `font-weight:700;font-size:${fs};line-height:1" aria-hidden="true">${escAttr(ch)}</span>`;
}
function faceHTML(p, big){
  const cls = big ? 'lface-lg' : 'lface';
  const img = p && p.img;
  const real = img && !/placeholder\.svg$/.test(img);
  if (real) return `<img class="${cls} lface-photo" src="${img}" alt="${escAttr(p.name || '')}" loading="lazy" decoding="async">`;
  return initialFace(p, big);
}
const HUB = [
  { key:'leaders',  icon:'🫡', title:'革命导师' },
  { key:'comrades', icon:'🫡', title:'革命同志' },
  { key:'recommend', icon:'📺', title:'推荐人物' },
  { key:'figures',  icon:'👤', title:'其他人物' },
  { key:'thoughts', icon:'💡', title:'思想' },
  { key:'orgs',     icon:'🏛️', title:'组织' },
  { key:'wenge',    icon:'🔥', title:'文革' },
  { key:'critics',  icon:'⚔️', title:'被批判人物' },
  { key:'events',   icon:'📅', title:'重大事件' },
  { key:'features', icon:'🧩', title:'专题' },
  { key:'debunks',  icon:'🧾', title:'辟谣' },
];
/* 覆盖层：栏目改名（客户端/官方均可） */
var HUB_DEF = {}; HUB.forEach(function(h){ HUB_DEF[h.key] = h.title; });
if (window.__YZY_HUB_LABELS) HUB.forEach(function(h){ if (window.__YZY_HUB_LABELS[h.key]) h.title = window.__YZY_HUB_LABELS[h.key]; });
window.__yzRefreshLabels = function(){ try{ var L=window.__YZY_HUB_LABELS||{}; HUB.forEach(function(h){ h.title = (L[h.key]||HUB_DEF[h.key]||h.title); }); if (typeof render==="function") render(); }catch(e){} };
function hubTitle(key){ const h = HUB.find(x => x.key === key); return h ? h.title : ''; }
function schoolGroups(){ return EX.schools || []; }
function hubGi(key){ return key === 'thoughts' ? 0 : 1; }
function resolveSchool(name){ const G = schoolGroups(); for (let gi = 0; gi < G.length; gi++){ const ii = G[gi].items.findIndex(x => x.name === name); if (ii >= 0) return { gi, ii }; } return null; }
function hubTabs(active){
  return `<nav class="tagrow" aria-label="史料栏目" style="margin:2px 0 10px">` +
    HUB.map(h => `<span class="tag${h.key === active ? ' active' : ''}" onclick="openHub('${h.key}')">${h.icon} ${h.title}</span>`).join('') + `</nav>`;
}
/* 「人物」框：取自关系图谱同一份数据（graph.js），介绍与图谱一致 */
function wengeGraph(){ return window.SITE_GRAPH_WENGE || { nodes: [], links: [] }; }
function allGraphNodes(){
  var out = [], seen = {};
  var add = function(list){ (list || []).forEach(function(n){ if (n && n.id && !seen[n.id]) { seen[n.id] = 1; out.push(n); } }); };
  add((window.SITE_GRAPH && window.SITE_GRAPH.nodes) || []);
  add(wengeGraph().nodes);
  return out;
}
function figuresList(){
  var leadersN = {}; (leaders || []).forEach(function(p){ leadersN[p.name] = 1; });
  var comradesN = {}; (comrades || []).forEach(function(p){ comradesN[p.name] = 1; });
  var criticsN = {}; (EX.critics || []).forEach(function(x){ criticsN[x.name] = 1; });
  var seen = {}, out = [];
  allGraphNodes().forEach(function(n){
    if (!n || n.type !== 'person' || seen[n.id]) return;
    if (leadersN[n.name] || comradesN[n.name] || criticsN[n.name]) return; /* 已单列，不重复 */
    seen[n.id] = 1; out.push(n);
  });
  return out;
}
function hubCount(key){
  if (key === 'leaders') return leaders.length;
  if (key === 'comrades') return comrades.length;
  if (key === 'figures') return figuresList().length;
  if (key === 'critics') return (EX.critics || []).length;
  if (key === 'events') return (EX.events || []).length;
  if (key === 'recommend') return (CT.recommend || []).length;
  if (key === 'features') return (EX.features || []).filter(function(f){ return f.id !== 'wenhua'; }).length;
  if (key === 'wenge') return wengeGraph().nodes.length;
  if (key === 'debunks') return (EX.debunks || []).length;
  const g = schoolGroups()[hubGi(key)]; return g ? g.items.length : 0;
}
function hubTrail(key){ return [ { t:HUB_NAME, fn:()=>openSection(0) }, { t:hubTitle(key), fn:()=>openHub(key) } ]; }
let _tocSeq = 0, _foldSeq = 0;
function tocHTML(items){
  const list = (items || []).filter(Boolean);
  if (list.length < 4) return '';
  const id = 'toc-' + (++_tocSeq);
  const big = list.length > 12; /* 条目过多默认折叠，避免刷屏、遮挡正文 */
  return `<nav class="toc" aria-label="本页目录"><div class="toc-t">📑 本页目录（${list.length}）` +
    (big ? `<button class="aslink tocfold" onclick="toggleToc('${id}',this)">展开</button>` : '') +
    `</div><div class="toc-body ${big ? 'hidden' : ''}" id="${id}">` +
    list.map(x => `<button class="aslink" onclick="scrollToId('${x.id}')">· ${x.t}</button>`).join('') + `</div></nav>`;
}
function toggleToc(id, btn){
  const e = document.getElementById(id); if (!e) return;
  const hid = e.classList.toggle('hidden');
  if (btn) btn.textContent = hid ? '展开' : '收起';
}
/* 长列表渐进渲染：先渲染前 n 条，其余点「显示更多」再展开 */
function foldCards(cards, n){
  const arr = (cards || []).filter(Boolean); if (arr.length <= n) return arr.join('');
  const id = 'fold-' + (++_foldSeq), rest = arr.length - n;
  return arr.slice(0, n).join('') +
    `<div id="${id}" style="display:none">` + arr.slice(n).join('') + `</div>` +
    `<button class="aslink morebtn" data-n="${rest}" onclick="toggleFold('${id}',this)">▸ 显示更多（${rest}）</button>`;
}
function toggleFold(id, btn){
  const e = document.getElementById(id); if (!e) return;
  const hidden = e.style.display === 'none';
  e.style.display = hidden ? 'block' : 'none';
  if (btn) btn.textContent = hidden ? '▾ 收起' : ('▸ 显示更多（' + (btn.getAttribute('data-n') || '') + '）');
}
function scrollToId(id){ const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior:'smooth', block:'start' }); }
function openHub(key){
  const h = HUB.find(x => x.key === key) || HUB[0];
  if (key === 'leaders'){
    const cards = leaders.map((p, i) => ({ t:p.name, id:'hub-l-'+i,
      html:`<div class="lcard" id="hub-l-${i}" onclick="showLeaderDetail(${i})">
        ${faceHTML(p)}
        <div style="flex:1"><div class="pname">${p.name}</div><div class="prole">${p.years} · ${p.role}</div></div>
        <span style="opacity:.4">›</span></div>` }));
    openContent('🫡 革命导师', crumbFrom(hubTrail('leaders')) + hubTabs('leaders') + tocHTML(cards) + cards.map(c => c.html).join(''));
    return;
  }
  if (key === 'comrades'){
    const cards = comrades.map((p, i) => ({ t:p.name, id:'hub-m-'+i,
      html:`<div class="lcard" id="hub-m-${i}" onclick="openAuthor('${escAttr(p.name)}')">
        ${faceHTML(p)}
        <div style="flex:1"><div class="pname">${p.name}<span style="font-size:.72rem;opacity:.55">（${p.years}）</span></div>
        <div class="prole" style="line-height:1.7">${p.intro}</div></div>
        <span style="opacity:.4">›</span></div>` }));
    openContent('🫡 革命同志', crumbFrom(hubTrail('comrades')) + hubTabs('comrades') + tocHTML(cards) + cards.map(c => c.html).join(''));
    return;
  }
  if (key === 'recommend'){
    const list = CT.recommend || [];
    const cards = list.map((p, i) => ({ t:p.name, id:'hub-r-'+i,
      html:`<div class="lcard" id="hub-r-${i}" style="align-items:flex-start">
        ${faceHTML(p)}
        <div style="flex:1;min-width:0"><div class="pname">${escAttr(p.name)}<span style="font-size:.72rem;opacity:.55;font-weight:normal;margin-left:6px">${p.account && p.account !== p.name ? ('@'+escAttr(p.account)) : ''}${p.fans ? (' · 粉丝 '+escAttr(p.fans)) : ''}</span></div>
        <div class="prole" style="line-height:1.8;opacity:.86">${escAttr(p.intro || '')}</div>
        </div>
      </div>` }));
    openContent('📺 推荐人物', crumbFrom(hubTrail('recommend')) + hubTabs('recommend') +
      `<p class="sub" style="margin:0 0 8px;line-height:1.8">${CT.recommendNote || ''}</p>` +
      tocHTML(cards) + cards.map(c => c.html).join(''));
    return;
  }
  if (key === 'figures'){
    const cards = figuresList().map((p, i) => ({ t:p.name, id:'hub-f-'+i,
      html:`<div class="lcard" id="hub-f-${i}" onclick="openFigure('${p.id}')">
        ${faceHTML(p)}
        <div style="flex:1"><div class="pname">${p.name}<span style="font-size:.72rem;opacity:.55;font-weight:normal;margin-left:6px">${p.years || ''}</span></div>
        <div class="prole" style="line-height:1.7">${p.role || ''}</div></div>
        <span style="opacity:.4">›</span></div>` }));
    openContent('👤 人物', crumbFrom(hubTrail('figures')) + hubTabs('figures') +
      `<p class="sub" style="margin:0 0 8px;line-height:1.7">以下为暂未归入「革命导师 / 革命同志 / 被批判人物」的其他重要人物（共运活动家、早期领导人等）。其介绍与「关系图谱」中同一人物的介绍为同一份内容。</p>` +
      tocHTML(cards) + foldCards(cards.map(c => c.html), 40));
    return;
  }
  if (key === 'debunks'){
    const list = EX.debunks || [];
    const cards = list.map((d, i) => ({ t:d.title, id:'hub-d-'+i,
      html:`<div class="lcard" id="hub-d-${i}" style="align-items:flex-start;flex-direction:column">
        <div class="pname">🧾 辟谣 · ${d.title}</div>
        <div class="prole" style="line-height:1.85;margin-top:6px"><b style="color:var(--accent)">说法：</b>${d.q}</div>
        <div class="prole" style="line-height:1.9;margin-top:4px"><b style="color:var(--accent)">正解：</b>${d.a}</div>
      </div>` }));
    openContent('🧾 辟谣', crumbFrom(hubTrail('debunks')) + hubTabs('debunks') +
      `<p class="sub" style="margin:0 0 8px;line-height:1.8">针对若干流传甚广的说法，逐一辨正，摆明立场与事实。</p>` +
      tocHTML(cards) + cards.map(c => c.html).join(''));
    return;
  }
  if (key === 'critics'){
    const cards = (EX.critics || []).map((c, i) => ({ t:c.name, id:'hub-c-'+i,
      html:`<div class="lcard" id="hub-c-${i}" onclick="openCritic(${i})" style="align-items:flex-start">
        <div style="flex:1"><div class="pname">${c.name}${c.years ? `<span style="font-size:.66rem;opacity:.55;font-weight:normal;margin-left:8px">${c.years}</span>` : ''}</div>
        <div class="prole" style="line-height:1.75">${c.role || ''}</div></div>
        <span style="opacity:.4">›</span></div>` }));
    openContent('⚔️ 被批判人物', crumbFrom(hubTrail('critics')) + hubTabs('critics') +
      `<p class="sub" style="margin:0 0 8px;line-height:1.7">以下为在马克思主义发展史上有重大影响、但受到革命导师批判的人物（按人物组织，仅列姓名与简介，不设肖像）。</p>` +
      tocHTML(cards) + cards.map(c => c.html).join(''));
    return;
  }
  if (key === 'events'){
    openContent('📅 重大事件 · 时间轴', crumbFrom(hubTrail('events')) + hubTabs('events') +
      `<p class="sub" style="margin:0 0 8px;line-height:1.7">国际共产主义运动中有重大影响或变革意义的事件，依年代排列；点事件名看详情，点人物 / 思想可跳转。</p>` +
      eventsTimelineHTML());
    return;
  }
  if (key === 'features'){
    openContent('🧩 专题', crumbFrom(hubTrail('features')) + hubTabs('features') + featuresHTML(function(f){ return f.id !== 'wenhua'; }));
    return;
  }
  if (key === 'wenge'){
    const wf = (EX.features || []).find(f => f.id === 'wenhua');
    const wn = wengeGraph().nodes || [];
    const byType = t => wn.filter(n => n.type === t);
    const card = (n, i) => `<div class="lcard" id="hub-w-${n.type}-${i}" onclick="openWengeNode('${n.id}')">
        ${faceHTML(n)}
        <div style="flex:1"><div class="pname">${n.name}${n.years ? `<span style="font-size:.72rem;opacity:.55;font-weight:normal;margin-left:6px">${n.years}</span>` : ''}</div>
        <div class="prole" style="line-height:1.7">${n.role || ''}</div></div>
        <span style="opacity:.4">›</span></div>`;
    const H3 = t => `<h3 style="font-size:.88rem;color:var(--accent);letter-spacing:1px;margin:14px 0 6px">${t}</h3>`;
    const orgs = foldCards(byType('org').map(card), 40);
    const events = foldCards(byType('event').map(card), 40);
    openContent('🔥 文革',
      crumbFrom(hubTrail('wenge')) + hubTabs('wenge') +
      `<p class="sub" style="margin:0 0 8px;line-height:1.8">1966—1976 年「文化大革命」。此处以<b>客观陈述</b>聚合相关人物、组织派系与事件，不作定性评价；可切换至「文革图谱」查看其关系网。</p>` +
      `<p style="margin:0 0 10px"><a href="graph.html?g=wenge" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border:1px solid var(--accent);border-radius:10px;color:var(--accent);text-decoration:none;font-size:.85rem">🕸 打开「文革图谱」 →</a></p>` +
      (wf ? featuresHTML(function(f){ return f.id === 'wenhua'; }) : '') +
      `<div class="lcard" onclick="openHub('figures')" style="margin:6px 0"><span class="li">👤</span><div style="flex:1"><div class="pname">人物 · 已归入「史料 → 人物」</div><div class="prole">文革相关人物统一在「人物」栏目查看</div></div><span style="opacity:.4">›</span></div>` +
      (orgs ? H3('🏛️ 组织 · 派系（' + byType('org').length + '）') + orgs : '') +
      (events ? H3('📅 事件 · 文件（' + byType('event').length + '）') + events : '')
    );
    return;
  }
  const gi = hubGi(key), g = schoolGroups()[gi]; if (!g) return;
  const cards = g.items.map((it, ii) => ({ t:it.name, id:'hub-s-'+gi+'-'+ii,
    html:`<div class="lcard" id="hub-s-${gi}-${ii}" onclick="openSchoolItem(${gi},${ii})" style="align-items:flex-start">
      <div style="flex:1"><div class="pname">${it.name}${it.meta ? `<span style="font-size:.66rem;opacity:.55;font-weight:normal;margin-left:8px">${it.meta}</span>` : ''}${it.crit ? ' <i class="badge-crit">被批判</i>' : ''}</div>
      <div class="prole" style="line-height:1.75">${it.desc}</div></div>
      <span style="opacity:.4">›</span></div>` }));
  openContent(h.icon + ' ' + g.group, crumbFrom(hubTrail(key)) + hubTabs(key) +
    (g.note ? `<p class="sub" style="margin:0 0 8px;line-height:1.7">${g.note}</p>` : '') +
    tocHTML(cards) + cards.map(c => c.html).join(''));
}
function linkChips(names, kind){
  if (!names || !names.length) return '';
  return names.map(n => {
    if (kind === 'people') return `<span class="tag" onclick="openPerson('${escAttr(n)}')">👤 ${n}</span>`;
    const s = resolveSchool(n); return s ? `<span class="tag" onclick="openSchoolItem(${s.gi},${s.ii})">${n}</span>` : `<span class="tag">${n}</span>`;
  }).join('');
}
function openSchoolItem(gi, ii){
  const g = schoolGroups()[gi], it = g && g.items[ii]; if (!it) return;
  const key = gi === 0 ? 'thoughts' : 'orgs';
  const people = (it.people || []).length ? `<h2 class="sub-title" style="margin-top:16px">👤 相关人物</h2><div class="tagrow">${it.people.map(p => `<span class="tag" onclick="openPerson('${escAttr(p)}')">${p}</span>`).join('')}</div>` : '';
  const opposed = it.opposed && it.opposed !== '——' ? `<h2 class="sub-title" style="margin-top:16px">⚔️ 对立 / 被其批判的思潮与派系</h2><p class="sub" style="line-height:1.95">${it.opposed}</p>` : '';
  openContent('🧩 ' + it.name,
    crumbFrom(hubTrail(key).concat([{ t:it.name, fn:()=>openSchoolItem(gi,ii) }])) +
    `<h3 style="color:var(--accent);font-size:1rem;letter-spacing:1px">${it.name}${it.crit ? ' <i class="badge-crit">被批判</i>' : ''}</h3>
     ${it.meta ? `<div class="prole" style="margin:4px 0 8px">${it.meta}</div>` : ''}
     <p style="font-size:.85rem;line-height:1.95;opacity:.9">${it.desc || ''}</p>
     ${it.works && it.works !== '—' ? `<dl class="meta-grid" style="margin-top:12px"><dt>相关文献</dt><dd>${it.works}</dd></dl>` : ''}
     ${graphDetailHTML(it.name, true)}
     ${people}${opposed}` + graphLinkHTMLByName(it.name));
}
function openFigure(id, fromRoute){
  var G = allGraphNodes();
  var p = G.find(function(n){ return n.id === id; }); if (!p) return;
  var _fe = { k:'p:'+p.id, name:p.name, img:imgOf(p), sub:[p.years, p.role].filter(Boolean).join(' · '), act:"openFigure('"+p.id+"')" };
  var pts = (p.points && p.points.length) ? `<h2 class="sub-title" style="margin-top:16px">📌 要点</h2><ul style="list-style:none;padding:0;font-size:.85rem;line-height:1.95;opacity:.92">${p.points.map(function(x){return '<li style="padding-left:16px;position:relative">▸ '+x+'</li>';}).join('')}</ul>` : '';
  var works = (p.works && p.works.length) ? `<h2 class="sub-title" style="margin-top:16px">📚 代表文献</h2><div class="tagrow">${p.works.map(function(w){return '<span class="tag">'+w+'</span>';}).join('')}</div>` : '';
  openContent('👤 ' + p.name,
    crumbFrom(hubTrail('figures').concat([{ t:p.name, fn:function(){ openFigure(id); } }])) +
    `<div class="ldetail">
       ${faceHTML(p, true)}
       <h3>${p.name}</h3><div class="prole">${[p.years, p.role].filter(Boolean).join(' · ')}</div>
       <p>${p.desc || ''}</p>
     </div>` + '<p style="margin:14px 0 2px">' + friendBtnHTML(_fe) + '</p>' + pts + works +
    `<p style="margin-top:18px"><a href="graph.html#${p.id}" target="_blank" rel="noopener" style="display:inline-block;padding:9px 16px;border:1px solid var(--accent);border-radius:10px;color:var(--accent);text-decoration:none;font-size:.85rem">🕸 在关系图谱中查看 →</a></p>`);
  if (!fromRoute) setHash('#/p/' + slugOf(p.name));
}
function openWengeNode(id){
  var w = wengeGraph().nodes || [];
  var p = w.find(function(n){ return n.id === id; }); if (!p) return;
  var pts = (p.points && p.points.length) ? `<h2 class="sub-title" style="margin-top:16px">📌 要点</h2><ul style="list-style:none;padding:0;font-size:.85rem;line-height:1.95;opacity:.92">${p.points.map(function(x){return '<li style="padding-left:16px;position:relative">▸ '+x+'</li>';}).join('')}</ul>` : '';
  var src = (p.sources && p.sources.length) ? `<h2 class="sub-title" style="margin-top:16px">🗃 来源</h2><div class="tagrow">${p.sources.map(function(s){return '<span class="tag">'+s+'</span>';}).join('')}</div>` : '';
  openContent('🔥 ' + p.name,
    crumbFrom(hubTrail('wenge').concat([{ t:p.name, fn:function(){ openWengeNode(id); } }])) +
    `<div class="ldetail">
       ${faceHTML(p, true)}
       <h3>${p.name}</h3><div class="prole">${[p.years, p.role, p.prov].filter(Boolean).join(' · ')}</div>
       <p>${p.desc || ''}</p>
     </div>` + pts + src +
    `<p style="margin-top:18px"><a href="graph.html?g=wenge#${p.id}" target="_blank" rel="noopener" style="display:inline-block;padding:9px 16px;border:1px solid var(--accent);border-radius:10px;color:var(--accent);text-decoration:none;font-size:.85rem">🕸 在「文革图谱」中查看 →</a></p>`);
}
function openCritic(i, fromRoute){
  const c = (EX.critics || [])[i]; if (!c) return;
  var _fe = { k:'c:'+c.name, name:c.name, img:'', sub:(c.years || '') + (c.role ? ' · ' + c.role : ''), act:"openCritic("+i+")" };
  openContent('👤 ' + c.name,
    crumbFrom(hubTrail('critics').concat([{ t:c.name, fn:()=>openCritic(i) }])) +
    `<h3 style="color:var(--accent);font-size:1rem;letter-spacing:1px">${c.name}</h3>
     <div class="prole" style="margin:4px 0 10px">${c.years || ''}${c.role ? ' · ' + c.role : ''}</div>
     <p style="font-size:.85rem;line-height:1.95;opacity:.9">${c.desc || ''}</p>` + '<p style="margin:14px 0 2px">' + friendBtnHTML(_fe) + '</p>' + ((c.points && c.points.length) ? `<h2 class="sub-title" style="margin-top:16px">📌 要点</h2><ul style="list-style:none;padding:0;font-size:.85rem;line-height:1.95;opacity:.92">${c.points.map(x=>`<li style="padding-left:16px;position:relative">▸ ${x}</li>`).join('')}</ul>` : '') + graphDetailHTML(c.name, true) + graphLinkHTMLByName(c.name));
  if (!fromRoute) setHash('#/p/' + slugOf(c.name));
}
function openEvent(i, fromRoute){
  const e = (EX.events || [])[i]; if (!e) return;
  const rel = [];
  if ((e.people || []).length) rel.push(`<h2 class="sub-title" style="margin-top:16px">👤 相关人物</h2><div class="tagrow">${linkChips(e.people, 'people')}</div>`);
  const sch = (e.schools || []).concat(e.orgs || []);
  if (sch.length) rel.push(`<h2 class="sub-title" style="margin-top:12px">🧩 相关思想 · 组织</h2><div class="tagrow">${linkChips(sch, 'school')}</div>`);
  const detail = [];
  if (e.bg) detail.push(`<h2 class="sub-title" style="margin-top:16px">📜 背景</h2><p style="font-size:.85rem;line-height:1.95;opacity:.92">${e.bg}</p>`);
  if (e.points && e.points.length) detail.push(`<h2 class="sub-title" style="margin-top:14px">📌 要点</h2><ul style="list-style:none;padding:0;font-size:.85rem;line-height:1.95;opacity:.92">${e.points.map(x=>`<li style="padding-left:16px;position:relative">▸ ${x}</li>`).join('')}</ul>`);
  if (e.impact) detail.push(`<h2 class="sub-title" style="margin-top:14px">🌏 影响 · 意义</h2><p style="font-size:.85rem;line-height:1.95;opacity:.92">${e.impact}</p>`);
  openContent('📅 ' + e.year + ' · ' + e.name,
    crumbFrom(hubTrail('events').concat([{ t:e.year + ' ' + e.name, fn:()=>openEvent(i) }])) +
    `<h3 style="color:var(--accent);font-size:1rem;letter-spacing:1px">${e.name}</h3>
     <div class="prole" style="margin:4px 0 10px">${e.year}</div>
     <p style="font-size:.85rem;line-height:1.95;opacity:.9">${e.desc || ''}</p>` + detail.join('') + rel.join(''));
  if (!fromRoute) setHash('#/e/' + i);
}
function relatedSchoolsHTML(name){
  const G = schoolGroups(), hits = [];
  G.forEach((g, gi) => g.items.forEach((it, ii) => { if ((it.people || []).includes(name)) hits.push({ gi, ii, it }); }));
  if (!hits.length) return '';
  return `<h2 class="sub-title" style="margin-top:18px">🧩 相关思想 · 组织</h2><div class="tagrow">` + hits.map(h => `<span class="tag" onclick="openSchoolItem(${h.gi},${h.ii})">${h.it.name}</span>`).join('') + `</div>`;
}
function graphNodeByName(name){ var G = (window.SITE_GRAPH && window.SITE_GRAPH.nodes) || []; return G.find(function(n){ return n.name === name; }) || null; }
function graphNodeById(id){ var A = allGraphNodes(); for (var i = 0; i < A.length; i++){ if (A[i].id === id) return A[i]; } return null; }
/* 图谱名 → 史料名 的别名（对不上的那几个） */
var G_ALIAS = window.SITE_ALIAS || { '爱德华·伯恩施坦':'伯恩施坦', '卡尔·考茨基':'考茨基', '列夫·托洛茨基':'托洛茨基',
  '马赫主义':'马赫主义 · 经验批判主义', '维也纳国际 · 第二半国际':'社会主义国际 · 维也纳国际（第二半国际）',
  '苏联共产党':'苏联共产党 · 中国共产党', '中国共产党':'苏联共产党 · 中国共产党' };
/* 找出图谱节点对应的「史料」条目 */
function resolveEntryOfNode(g){
  var names = [g.name, G_ALIAS[g.name]].filter(Boolean);
  function has(list){ return list.some(function(x){ return names.indexOf(x) >= 0; }); }
  if (g.type === 'person'){
    var i = leaders.findIndex(function(p){ return names.indexOf(p.name) >= 0; });
    if (i >= 0) return { kind:'leader', i:i };
    if (g.mid) return { kind:'figure', id:g.id };
    if (comrades.some(function(p){ return names.indexOf(p.name) >= 0; })) return { kind:'comrade', name:g.name };
    var ci = (EX.critics || []).findIndex(function(x){ return names.indexOf(x.name) >= 0; });
    if (ci >= 0) return { kind:'critic', i:ci };
  } else {
    for (var gi = 0; gi < schoolGroups().length; gi++){
      var ii = schoolGroups()[gi].items.findIndex(function(x){ return names.indexOf(x.name) >= 0; });
      if (ii >= 0) return { kind:'school', gi:gi, ii:ii };
    }
  }
  return null;
}
function openGraphNodeById(id, fromRoute){
  var g = graphNodeById(id); if (!g) return;
  var e = resolveEntryOfNode(g);
  if (e){
    if (e.kind === 'leader') showLeaderDetail(e.i);
    else if (e.kind === 'figure') openFigure(e.id, true);
    else if (e.kind === 'comrade') openAuthor(e.name, true);
    else if (e.kind === 'critic') openCritic(e.i, true);
    else if (e.kind === 'school') openSchoolItem(e.gi, e.ii);
  } else { openGraphNode(g, true); }
  if (!fromRoute) setHash('#/g/' + g.id);
}
function graphDetailHTML(name, skipDesc){
  var g = graphNodeByName(name); if (!g) return '';
  var h = '';
  if (!skipDesc && g.desc) h += '<h2 class="sub-title" style="margin-top:16px">📖 详解</h2><p style="font-size:.85rem;line-height:1.95;opacity:.92">' + g.desc + '</p>';
  if (g.points && g.points.length) h += '<h2 class="sub-title" style="margin-top:14px">📌 要点</h2><ul style="list-style:none;padding:0;font-size:.85rem;line-height:1.95;opacity:.92">' + g.points.map(function(x){return '<li style="padding-left:16px">▸ '+x+'</li>';}).join('') + '</ul>';
  if (g.works && g.works.length) h += '<h2 class="sub-title" style="margin-top:14px">📚 代表文献</h2><div class="tagrow">' + g.works.map(function(w){return '<span class="tag">'+w+'</span>';}).join('') + '</div>';
  return h;
}
function graphLinkHTMLByName(name){ var g = graphNodeByName(name); if (!g) return ''; return '<p style="margin-top:16px"><a href="graph.html#'+g.id+'" target="_blank" rel="noopener" style="display:inline-block;padding:9px 16px;border:1px solid var(--accent);border-radius:10px;color:var(--accent);text-decoration:none;font-size:.85rem">🕸 在关系图谱中查看 →</a></p>'; }
function openPerson(name){ openNodeByName(name); }
function openNodeByName(name, fromRoute){
  const i = leaders.findIndex(p => p.name === name);
  if (i >= 0){ showLeaderDetail(i); }
  else {
    const f = figuresList().find(x => x.name === name);
    if (f){ openFigure(f.id, true); }
    else if (comrades.some(p => p.name === name)){ openAuthor(name, true); }
    else {
      const ci = (EX.critics || []).findIndex(x => x.name === name);
      if (ci >= 0){ openCritic(ci, true); }
      else {
        const sc = resolveSchool(name);
        if (sc){ openSchoolItem(sc.gi, sc.ii); }
        else { const g = graphNodeByName(name); if (g){ openGraphNode(g, true); } else { openAuthor(name, true); } }
      }
    }
  }
  if (!fromRoute) setHash('#/p/' + slugOf(name));
}
function openGraphNode(g, fromRoute){
  var tn = g.type === 'person' ? '人物' : g.type === 'idea' ? '思想' : '组织';
  var face = (g.type === 'person' && g.img)
    ? '<img class="lface-lg" src="'+g.img+'" alt="'+g.name+'" loading="lazy">'
    : '<div class="lface-lg" style="display:grid;place-items:center;font-size:2.2rem">'+(g.type === 'idea' ? '💡' : g.type === 'org' ? '🏛️' : '👤')+'</div>';
  var pts = (g.points && g.points.length) ? '<h2 class="sub-title" style="margin-top:16px">📌 要点</h2><ul style="list-style:none;padding:0;font-size:.85rem;line-height:1.95;opacity:.92">' + g.points.map(function(x){return '<li style="padding-left:16px">▸ '+x+'</li>';}).join('') + '</ul>' : '';
  var wks = (g.works && g.works.length) ? '<h2 class="sub-title" style="margin-top:16px">📚 代表文献</h2><div class="tagrow">' + g.works.map(function(w){return '<span class="tag">'+w+'</span>';}).join('') + '</div>' : '';
  openContent((g.type === 'idea' ? '💡 ' : g.type === 'org' ? '🏛️ ' : '👤 ') + g.name,
    crumbFrom([{ t:HUB_NAME, fn:function(){ openSection(0); } }, { t:g.name, fn:function(){ openGraphNode(g); } }]) +
    '<div class="ldetail">' + face +
    '<h3>'+g.name+'</h3><div class="prole">'+[g.years, g.role, tn].filter(Boolean).join(' · ')+'</div><p>'+(g.desc || '')+'</p></div>' + pts + wks +
    graphLinkHTMLByName(g.name));
  if (!fromRoute) setHash('#/p/' + slugOf(g.name));
}
function showLeaderDetail(i){
  const p = leaders[i];
  var _fe = { k:'l:'+p.name, name:p.name, img:imgOf(p), sub:[p.years, p.role].filter(Boolean).join(' · '), act:"showLeaderDetail("+i+")" };
  openContent('🫡 ' + p.name,
    crumbFrom(hubTrail('leaders').concat([{ t:p.name, fn:()=>showLeaderDetail(i) }])) +
    `<div class="ldetail">
       ${faceHTML(p, true)}
       <h3>${p.name}</h3><div class="prole">${p.years} · ${p.role}</div>
       <div class="pworks">代表作：${p.works}</div>
       <p>${p.intro}</p>
       ${p.points ? `<div style="text-align:left;margin-top:14px"><b>主要贡献与思想</b><ul>${p.points.map(x=>`<li>${x}</li>`).join('')}</ul></div>` : ''}
     </div>` + '<p style="margin:14px 0 2px">' + friendBtnHTML(_fe) + '</p>' + timelineHTML(p.name) + worksTimelineHTML(p.name) + personResourcesHTML(p.name) + relatedSchoolsHTML(p.name) + graphLinkHTMLByName(p.name));
  setHash('#/p/' + slugOf(p.name));
}
function personOf(name){ return leaders.concat(comrades).find(x => x.name === name) || null; }
function openAuthor(name, fromRoute){
  const isComrade = comrades.some(p => p.name === name);
  const trail = [{ t:HUB_NAME, fn:()=>openSection(0) }];
  if (isComrade) trail.push({ t:'革命同志', fn:()=>openHub('comrades') });
  trail.push({ t:name, fn:()=>openAuthor(name) });
  const p = personOf(name);
  var _fe = { k:'a:'+name, name:name, img:imgOf(p), sub:(p ? [p.years, p.role].filter(Boolean).join(' · ') : ''), act:"openAuthor('"+String(name).replace(/['\\]/g, '')+"')" };
  const head = p
    ? `<div class="ldetail">${faceHTML(p, true)}
        <h3>${p.name}</h3><div class="prole">${p.years || ''}${p.role ? ' · ' + p.role : ''}</div>
        ${p.works ? `<div class="pworks">代表作：${p.works}</div>` : ''}
        <p>${p.intro || ''}</p>
        ${p.points ? `<div style="text-align:left;margin-top:12px"><b>主要贡献与思想</b><ul>${p.points.map(x=>`<li>${x}</li>`).join('')}</ul></div>` : ''}
      </div>`
    : `<h3 style="color:var(--accent);font-size:1rem;letter-spacing:1px">👤 ${name}</h3>`;
  openContent('👤 ' + name, crumbFrom(trail) + head + '<p style="margin:14px 0 2px">' + friendBtnHTML(_fe) + '</p>' + graphDetailHTML(name) + timelineHTML(name) + worksTimelineHTML(name) + personResourcesHTML(name) + relatedSchoolsHTML(name) + graphLinkHTMLByName(name));
  if (!fromRoute) setHash('#/a/' + slugOf(name));
}

/* ---------- 全部内容 ---------- */
function pinyinIndexHTML(){
  const buckets = {};
  RES.forEach((r, i) => { const py = (r.py || '').toLowerCase(); const L = py ? py[0].toUpperCase() : '#'; (buckets[L] = buckets[L] || []).push({ r, i }); });
  const letters = Object.keys(buckets).sort();
  if (!letters.length) return '';
  const jumps = letters.map(L => `<span class="tag" onclick="scrollToId('py-${L}')">${L}</span>`).join('');
  return `<div class="tagrow" style="margin:2px 0 6px"><span class="lbl">拼音：</span>${jumps}</div>` +
    letters.map(L => `<h2 class="sub-title" id="py-${L}" style="scroll-margin-top:14px;margin-top:14px">${L} · ${buckets[L].length}</h2>` +
      buckets[L].map(x => rowHTML(x.i)).join('')).join('');
}
function allIndexHTML(){
  return `<p class="sub" style="margin-top:0;line-height:1.7">本站全部文件的总索引，便于浏览与自查。</p>` +
    `<h2 class="sub-title">📚 全部书籍 · ${RES.length}</h2>` + pinyinIndexHTML() +
    `<h2 class="sub-title" style="margin-top:18px">📜 史料</h2>
     <p class="sub" style="margin:2px 0 6px">共 ${leaders.length + comrades.length + figuresList().length} 位人物、${(EX.events || []).length} 件大事，另有思想、组织等。</p>
     <div class="tagrow">` + HUB.map(h => `<span class="tag" onclick="openHub('${h.key}')">${h.icon} ${h.title}（${hubCount(h.key)}）</span>`).join('') + `</div>`;
}

/* ---------- 资源导航 ---------- */
const navGroups = CT.navGroups || [];
const tagHTML = t => t ? ` <span style="font-size:.62rem;opacity:.62;border:1px solid currentColor;border-radius:4px;padding:0 4px;margin-left:6px;vertical-align:middle;white-space:nowrap">${t}</span>` : '';
function navTrail(i){ return [{ t:'资源导航', fn:()=>openSection(2) }, { t:navGroups[i].name, fn:()=>openNavGroup(i) }]; }
function navGroupsListHTML(){
  return `<p class="sub" style="margin-top:0;line-height:1.7">${CT.navNote || '以下均为第三方站点，内容非本站控制，请自行甄别。'}</p>` +
    navGroups.map((g, i) => `<div class="lcard" onclick="openNavGroup(${i})">
      <span class="li">${g.icon || '📁'}</span><div style="flex:1"><div class="pname">${g.name}</div><div class="prole">${g.items.length} 个站点</div></div>
      <span style="opacity:.4">›</span></div>`).join('') +
    `<p style="margin-top:14px;font-size:.72rem;opacity:.55">链接失效或打不开？<button class="aslink" style="text-decoration:underline" onclick="requestAction()">点此反馈</button></p>`;
}
function openNavGroup(i){
  const g = navGroups[i]; if(!g) return;
  openContent((g.icon || '📁') + ' ' + g.name, crumbFrom(navTrail(i)) +
    g.items.map((l, j) => `<div class="lcard" onclick="openNavItem(${i},${j})">
      <span class="li">🔗</span><div style="flex:1"><div class="pname">${l.name}${tagHTML(l.tag)}</div><div class="prole">${l.desc}</div></div>
      <span style="opacity:.4">›</span></div>`).join(''));
}
function openNavItem(gi, ii){
  const g = navGroups[gi], l = g && g.items[ii]; if(!l) return;
  openContent('🔗 ' + l.name,
    crumbFrom(navTrail(gi).concat([{ t:l.name, fn:()=>openNavItem(gi,ii) }])) +
    `<h3 style="color:var(--accent);font-size:1rem;letter-spacing:2px">${l.name}${tagHTML(l.tag)}</h3>
     <p style="margin:10px 0;font-size:0.83rem;opacity:.85;line-height:1.95">${l.intro || l.desc}</p>
     <p style="margin-top:10px;font-size:.7rem;opacity:.5">本站仅作介绍与索引，<b>不提供跳转</b>；如需访问，请自行在浏览器中搜索该站名。内容由第三方提供，请注意甄别。</p>`);
}

/* 精华摘要：优先用「重新精炼过的简介」数据（window.YZ_INTRO_SHORT，如有）；否则用数据里那句话简介 desc；
   再否则取详细介绍的首句 / 截断到 100 字以内。——保证一眼看到的是重点，而不是一大段。 */
function briefIntro(it){
  const id = it.id || it.title;
  try { const M = window.YZ_INTRO_SHORT; if (M && M[id]) return String(M[id]); } catch(e){}
  const desc = String(it.desc || '').replace(/\s+/g, ' ').trim();
  if (desc.length >= 12) return desc;
  const full = String(it.intro || '').replace(/\s+/g, ' ').trim();
  if (full.length <= 100) return full;
  const cut = full.indexOf('。');
  if (cut > 12 && cut < 100) return full.slice(0, cut + 1);
  return full.slice(0, 100) + '…';
}
/* ---------- 资源详情 ---------- */
function openItemDetail(idx, fromRoute){
  const it = RES[idx]; if(!it) return;
  const canPreview = it.url !== '#' && (it.url.endsWith('.pdf') || it.url.endsWith('.epub'));
  const isHttp = it.url.startsWith('http');
  const fav = isFav(it);
  const marked = isMarked(idx);
  const byAuthor = it.author && it.author !== '—';
  const nid = it.id || it.title;
  const fmt = it.fmt || (it.url.endsWith('.pdf') ? 'PDF' : it.url.endsWith('.epub') ? 'EPUB' : it.url.endsWith('.mp3') ? 'MP3' : '—');
  const relScore = r => (r.author === it.author ? 3 : 0) + ((r.cat === it.cat) ? 1 : 0) +
    ((r.tags || []).some(t => (it.tags || []).includes(t)) ? 2 : 0);
  const related = RES.filter(r => r !== it && relScore(r) > 0).slice().sort((a, b) => relScore(b) - relScore(a)).slice(0, 4);
  const relHTML = related.length ? `<section class="related"><h2 class="rl-title">📎 相关推荐</h2>` + related.map(r => {
      const ri = RES.indexOf(r);
      const why = r.author === it.author ? '同作者' : (r.cat === it.cat ? '同类型' : '同标签');
      return `<div class="lcard" onclick="openItemDetail(${ri})"><span class="li">${r.icon||'📕'}</span><div style="flex:1"><div class="pname">${r.title}</div><div class="prole">${r.author} · ${r.cat} · ${why}</div></div><span style="opacity:.4">›</span></div>`;
    }).join('') + `</section>` : '';
  const noteHTML = it.note ? `<h2 class="sub-title" style="margin-top:16px">📄 来源 · 校订说明</h2><p class="note-box">${it.note}</p>` : '';
  const kindTag = it.kind ? ` <span class="tag" style="font-size:.7rem;padding:2px 8px">${it.kind}</span>` : '';
  const fullIntro = String(it.intro || '').trim();
  const brief = briefIntro(it);
  /* ① 详细介绍（默认收起，点标题展开）  ② 章节目录 = 逐条可折叠：点开看该章内容，再点收起 */
  /* 只有当「完整介绍」明显比精华摘要长时才给折叠全文，避免同一段话在页面上说两遍 */
  const introSection = (fullIntro && fullIntro.replace(/\s+/g, ' ') !== brief) ? `<details class="fold" style="margin-top:14px">
    <summary class="fold-t">📘 详细介绍</summary>
    <p class="fold-body" style="font-size:.86rem;line-height:1.95;opacity:.92;white-space:pre-line;padding:12px 14px;background:rgba(245,197,24,.06);border-left:3px solid var(--accent);border-radius:6px">${escAttr(fullIntro)}</p></details>` : '';
  const tocItems = (it.chapters && it.chapters.length) ? it.chapters : [];
  const tocSection = tocItems.length ?
    `<h2 class="sub-title" style="margin-top:18px">📑 目录 · 章节内容（共 ${tocItems.length} ${it.kind === '对公文献' ? '段' : '章'}，点标题展开/收起）</h2>` +
    tocItems.map(function (ch, ci) {
      const title = `${ci + 1}. ${escAttr(ch.t || '')}`;
      const body = ch.d ? String(ch.d).trim() : '';
      if (!body) return `<div class="ch-item ch-static"><b>${title}</b><span class="ch-none">（暂未收录内容）</span></div>`;
      return `<details class="ch-item"><summary><b>${title}</b><i class="ch-arrow" aria-hidden="true">▸</i></summary>` +
        `<div class="ch-body">${escAttr(body)}</div></details>`;
    }).join('') : '';
  const contentSection = '';   /* 章节内容已并入上面的可折叠目录，不再重复渲染一遍 */
  const chaptersHTML = '';
  const last = CUR_TRAIL[CUR_TRAIL.length - 1];
  const trail = (last && last.t === it.title) ? CUR_TRAIL : CUR_TRAIL.concat([{ t:it.title, fn:()=>openItemDetail(idx) }]);
  openContent('ℹ️ ' + it.title,
    crumbFrom(trail) +
    `<article style="text-align:left">
       <h3 style="color:var(--accent);font-size:1rem;letter-spacing:1px">${it.title}${isNew(it) ? ' <i class="badge-new">NEW</i>' : ''}</h3>
       <p style="margin:8px 0;font-size:.78rem;opacity:.65">${byAuthor ? `<button class="aslink" style="text-decoration:underline" onclick="openAuthor('${escAttr(it.author)}')">${it.author}</button>` : it.author} · ${it.cat}${kindTag} · ${hasBody(it) ? statusMap[it.status] : '📭 暂无原文'}</p>
       <p style="font-size:.84rem;opacity:.88;line-height:1.95">${escAttr(brief)}</p>
       <dl class="meta-grid">
         <dt>类型</dt><dd>${it.cat}</dd>
         <dt>格式</dt><dd>${fmt}</dd>
         <dt>大小</dt><dd>${it.size && it.size !== '—' ? it.size : '—'}</dd>
         ${hasBody(it) ? `<dt>更新</dt><dd>${it.date || '—'}</dd>` : ''}
         <dt>获取</dt><dd>${it.src || '本站整理'}</dd>
         ${it.publisher ? `<dt>出版社</dt><dd>${it.publisher}</dd>` : ''}
         ${it.pubyear ? `<dt>出版年</dt><dd>${it.pubyear}</dd>` : ''}
         ${it.translator ? `<dt>译者</dt><dd>${it.translator}</dd>` : ''}
         ${it.pages && it.pages !== '—' ? `<dt>页数</dt><dd>${it.pages}</dd>` : ''}
         <dt>状态</dt><dd>${hasBody(it) ? (statusMap[it.status] + ' 已收录' + (it.local ? '（本机正文）' : '')) : '📭 暂无原文（可导入本机文件）'}</dd>
       </dl>
       <div class="ops" style="margin-top:14px">
         ${it.local ? `<button class="go" onclick="yzBooks.read('${escAttr(it.bookId || '')}','${escAttr(it.title)}')">📖 开始阅读</button>` : (canImport(it) ? `<button class="go" onclick="yzBooks.importInto('${escAttr(it.id || '')}')">📥 导入本书</button>` : '')}
         ${it.local
           ? `<p class="sub" style="margin:0;font-size:.76rem;opacity:.7">这是你导入本机的书，内容只存在本机；点「📖 开始阅读」在应用内阅读。</p>`
           : (canImport(it)
             ? `<p class="sub" style="margin:0;font-size:.76rem;opacity:.7">本站只提供条目介绍与索引，<b>不含原文文件</b>；点「📥 导入本书」把你手机里的电子书导进来，就能在这一页阅读（只存在本机、不上传）。</p>`
             : `<p class="sub" style="margin:0;font-size:.76rem;opacity:.7">本站仅作条目介绍与索引，<b>不提供外部跳转</b>；如需获取，请自行在浏览器中检索书名。</p>`)}
         <button class="${fav ? 'on' : ''}" onclick="toggleFav(${idx});openItemDetail(${idx})">${fav ? '★ 已收藏' : '☆ 收藏'}</button>
         <button class="${marked ? 'on' : ''}" onclick="toggleMark(${idx})">${marked ? '🔖 已书签' : '🔖 书签'}</button>
         <button onclick="openShare('${escAttr(shareUrlFor(nid))}','${escAttr(it.title)}')">🔗 分享</button>
       </div>
       ${critHTML(nid)}
       <p style="margin-top:12px;font-size:.72rem;opacity:.5">标签：${(it.tags||[]).join(' / ') || '—'}</p>
       ${introSection}
       ${tocSection}
       ${contentSection}
       ${noteHTML}
       <section class="notes"><h2 class="rl-title">📝 我的笔记（仅存本机）</h2>
         <textarea placeholder="写点笔记、划重点、记下进度……" aria-label="我的笔记" oninput="saveNote('${escAttr(nid)}', this.value)">${escAttr(getNote(nid))}</textarea>
       </section>
       ${relHTML}
     </article>`);
  if (!fromRoute) setHash('#/r/' + slugOf(nid));
  lset('lastItem', nid);
  jsonldItem(it);
}

/* ---------- 使用指南 ---------- */
function helpFaqHTML(){
  var quick = [
    ['🔎 找书', '顶部搜索框输入书名 / 作者 / 关键词，回车即可；也可回首页点「分类」按类型浏览。'],
    ['📚 看条目', '点任意条目进入详情页，可看作者、版本、简介、要点与相关推荐。'],
    ['⭐ 收藏', '卡片上的「☆」即加入收藏；「个人中心 → 收藏」里集中查看。'],
    ['🗂 分类', '底栏「分类」按类型汇总：推荐 / 原著 / 歌曲 / 影像 / 工具 / 图书馆 / 对公文献 / 做题；右上角「⚙️」可隐藏不看的分类。'],
    ['📡 频道', '底栏「频道」是导师语录与思想交流的信息流，可点赞、评论、复制发言。'],
    ['📜 史料', '底栏「史料」按分组 / 人物 / 图谱整理全部人物与文献；右上角「＋」可打开自助编辑，添加或修改内容。'],
    ['🕸️ 关系图谱', '「史料 → 图谱」进入图谱页：顶栏下拉可切换内置图谱（主图谱 / 文革图谱 / 世界图谱）。拖动平移、滚轮缩放、点节点看它的关系网；工具栏还可切「列表 / 排名 / 关系工具 / 地图 / 社区 / 时间轴」。'],
    ['🏛️ 图书馆', '「分类 → 图书馆」列出常见第三方书库（Z-Library、安娜的档案、Internet Archive、马克思主义文库等）的定位与收录范围——本站只作介绍，不跳转。'],
    ['👤 个人中心', '点左上角头像，或在首页从屏幕左边缘向右滑，打开个人中心（相册 / 收藏 / 文件 / 设置）。'],
    ['🌗 显示设置', '「个人中心 → 设置 → 显示」可切换主题、字号、行距与版心。']
  ];
  var local = [
    ['✏️ 自助编辑', '点「史料」页右上角的「＋」打开：可在本机新增资源、修改人物介绍与头像、增删目录、编辑关系图谱。改动只存本机，不上传服务器。'],
    ['🕸️ 图谱的导出与导入', '图谱页右上角「⬇ 数据」可把<b>当前图谱</b>导出为 JSON / CSV / GraphML——几套内置图谱都能直接导出；同一菜单里的「📥 导入图谱」可从一份 JSON 建一张你自己的图谱。'],
    ['🗂 新建 / 重命名 / 删除图谱', '开启「自助编辑」后，图谱页会多出「🗂 图谱」按钮：可新建、重命名、删除、切换图谱；新建与导入的图谱都只存本机。'],
    ['💾 导出位置与打开', '「个人中心 → 设置 → 导出位置」可指定一个文件夹（无需任何权限）；每次导出完成都会显示真实保存位置、文件名与大小，并可直接点「用其他应用打开」。'],
    ['🔐 导入 / 导出数据', '打开「个人中心」，点头像进入账号页：可导出账号数据（头像、名字、收藏、书签、设置）为 JSON；换设备时点「登录」粘贴即可恢复。'],
    ['📥 导入频道内容', '在「频道」右上角点 📥，粘贴 JSON 数组即可添加自己的发言（只存本机）。'],
    ['🖼️ 相册', '「个人中心 → 相册」可查看内置照片、下载，或点「＋导入照片」把自己手机里的照片加进来。']
  ];
  var rows = function(a){ return a.map(function(x){ return '<div class="hp"><span class="hp-t">' + x[0] + '</span><span class="hp-d">' + x[1] + '</span></div>'; }).join(''); };
  return '<h2 class="stage">🚀 快速上手</h2>' + rows(quick) +
    '<h2 class="stage" style="margin-top:18px">📖 关于资源（重要）</h2>' + (helpHTML || '<p class="sub">暂无</p>') +
    '<h2 class="stage" style="margin-top:18px">🧰 本机功能（只存本机）</h2>' + rows(local) +
    '<h2 class="stage" style="margin-top:18px">❓ 常见问题</h2>' + (faqHTML || '<p class="sub">暂无</p>');
}

/* ---------- 阅读与手册 ---------- */
/* ---------- 推荐书单：本地「已读」勾选与进度（只存本机，不上传） ---------- */
function rlKey(t){ return String(t || '').replace(/[^\u4e00-\u9fff0-9A-Za-z]/g, '').slice(0, 44); }
function rlDone(){ try { const a = JSON.parse(localStorage.getItem('readlistDone') || '[]'); return Array.isArray(a) ? a : []; } catch(e){ return []; } }
function rlSave(a){ try { lset('readlistDone', JSON.stringify(a)); } catch(e){} }
function rlHas(k){ return rlDone().indexOf(k) >= 0; }
function rlToggle(ev, k){
  try { ev.stopPropagation(); } catch(e){}
  const a = rlDone(), i = a.indexOf(k);
  if (i >= 0) a.splice(i, 1); else a.push(k);
  rlSave(a);
  try { const li = ev.target && ev.target.closest ? ev.target.closest('li') : null; if (li) li.classList.toggle('rl-done', !!ev.target.checked); } catch(e){}
  rlUpdate();
}
function rlClearAll(){
  if (!confirm('清空本机记录的全部「已读」标记？')) return;
  rlSave([]);
  try { Array.prototype.forEach.call(document.querySelectorAll('input[data-rl]'), x => { x.checked = false; const li = x.closest ? x.closest('li') : null; if (li) li.classList.remove('rl-done'); }); } catch(e){}
  rlUpdate();
}
function rlUpdate(){
  try {
    const boxes = Array.prototype.slice.call(document.querySelectorAll('input[data-rl]'));
    if (!boxes.length) return;
    const done = boxes.filter(b => b.checked).length, pct = Math.round(done / boxes.length * 100);
    const t = document.getElementById('rlProgTxt'), bar = document.getElementById('rlProgBar');
    if (t) t.textContent = '已读 ' + done + ' / ' + boxes.length + '（' + pct + '%）';
    if (bar) bar.style.width = pct + '%';
  } catch(e){}
}
function readlistItemLi(text, note){
  const idx = resourceForText(text); const n = note ? ` <span class="sub">${note}</span>` : '';
  const key = rlKey(text), on = rlHas(key) ? ' checked' : '';
  const ck = `<label class="rlck" title="标记已读（仅存本机）" onclick="event.stopPropagation()"><input type="checkbox" data-rl="${key}"${on} onchange="rlToggle(event,'${key}')"></label>`;
  const cls = idx >= 0 ? 'rlink' + (on ? ' rl-done' : '') : (on ? 'rl-done' : '');
  const open = idx >= 0 ? ` onclick="openItemDetail(${idx})"` : '';
  return `<li${cls ? ` class="${cls}"` : ''}${open}>` + ck + `${text}${n}` + (idx >= 0 ? `<span class="lk">前往 ↗</span>` : '') + `</li>`;
}
function readlistMergedHTML(){
  const stages = CT.readlist || [];
  const used = new Set();
  const out = stages.map(sec => {
    const items = sec.items.map(it => { const idx = resourceForText(it.t); if (idx >= 0) used.add(RES[idx].id); return readlistItemLi(it.t, it.n); }).join('');
    return { stage: sec.stage, items };
  });
  const extras = [];
  (EX.topics || []).forEach(t => (t.items || []).forEach(id => {
    if (used.has(id)) return; const r = RES.find(x => x.id === id); if (!r) return; used.add(id);
    extras.push(`<li class="rlink" onclick="openItemDetail(${RES.indexOf(r)})">${r.title}<span class="lk">前往 ↗</span></li>`);
  }));
  if (extras.length){ if (out.length) out[out.length - 1].items += extras.join(''); else out.push({ stage:'推荐阅读', items: extras.join('') }); }
  const _body = out.map(s => `<h2 class="stage">${s.stage}</h2><ul>${s.items}</ul>`).join('') + (CT.readlistNote ? `<p class="sub" style="margin-top:10px">${CT.readlistNote}</p>` : '');
  setTimeout(rlUpdate, 0);
  return `<div class="rlbar"><b id="rlProgTxt">阅读进度</b><span class="rlprogwrap"><i id="rlProgBar"></i></span><button class="rlclear" onclick="rlClearAll()">清零</button></div>` + _body;
}
function readManualHTML(){
  const M = CFG.manual || {};
  let html = '';
  if (M.enable){
    html += `<h2 class="sub-title" style="margin-top:0">📕 本站手册 · ${M.title || '网络生存手册'}</h2>
      <p style="margin:6px 0;font-size:.75rem;opacity:.6">${M.size || ''}${M.updated ? ' · 更新：' + M.updated : ''}</p>
      <p style="font-size:.84rem;opacity:.88;line-height:1.95">${M.desc || ''}</p>
      <div class="ops" style="margin-top:10px">
        <button onclick="openPreview('${M.url}','${escAttr(M.title||'本站手册')}')">👁 在线阅读</button>
        <a href="${M.url}" download>⬇ 下载 PDF</a>
      </div>
      <hr style="border:0;border-top:1px dashed var(--card-border);margin:18px 0">`;
  }
  return html + `<h2 class="sub-title" style="margin-top:0">📖 推荐阅读书单</h2>` +
    `<p class="sub" style="margin:2px 0 0;line-height:1.7">带「前往 ↗」的条目可直接点进资源库中的对应书籍。</p>` + readlistMergedHTML();
}

/* ---------- 意见反馈 ---------- */
function feedbackHTML(){
  return `
    <p class="sub" style="margin-top:0;line-height:1.75">有话说？想求书、报错、提建议，或只是想聊聊——直接写在下面，提交就行。</p>
    <form class="fb-form" onsubmit="submitFeedback(event)">
      <input type="hidden" name="form-name" value="意见反馈">
      <p style="display:none"><label>请勿填写<input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
      <textarea name="note" class="fb-input" rows="6" required placeholder="想讲什么就写什么……（求书的话，把书名和版本写上就行）"></textarea>
      <div class="fb-actions"><button class="go" type="submit">提交</button></div>
      <p class="fb-note" id="fbNote">提交后由站主在后台查看；本站不收集浏览数据、不索取账号密码。</p>
    </form>
    <p style="margin-top:16px;opacity:.55;font-size:.72rem">本站永久免费，不会以任何名义收费或索取账号密码。</p>`;
}


/* ---------- 时间轴专页 ---------- */
function eventsTimelineHTML(){
  const evs = EX.events || [];
  if (!evs.length) return '<p class="sub">暂无事件。</p>';
  const items = evs.map((e, i) => {
    const sch = (e.schools || []).concat(e.orgs || []);
    const chips = linkChips(e.people || [], 'people') + linkChips(sch, 'school');
    const rel = chips ? `<div class="tagrow" style="margin-top:6px">${chips}</div>` : '';
    return `<li><b>${e.year}</b> <span onclick="openEvent(${i})" style="cursor:pointer">${e.name}<span class="lk"> 详情 ↗</span></span>` +
      (e.desc ? `<p class="sub" style="margin:4px 0 0;line-height:1.8">${e.desc}</p>` : '') + rel + `</li>`;
  }).join('');
  return `<p class="sub" style="margin-top:0;line-height:1.75">按时间顺序，共 ${evs.length} 件。点事件名看详情，点人物 / 思想可跳转。</p>` +
    `<ul class="timeline" style="font-size:.86rem;line-height:1.9">${items}</ul>`;
}

/* ---------- 专题聚合页 ---------- */
function featuresHTML(filter){
  const F = (EX.features || []).filter(function(f){ return filter ? filter(f) : true; });
  if (!F.length) return '<p class="sub">暂无专题。</p>';
  const bookCard = i => `<div class="lcard" onclick="openItemDetail(${i})"><span class="li">${RES[i].icon || '📕'}</span><div style="flex:1"><div class="pname">${RES[i].title}</div><div class="prole">${RES[i].desc || ''}</div></div><span style="opacity:.4">›</span></div>`;
  const H3 = t => `<h3 style="font-size:.88rem;color:var(--accent);letter-spacing:1px;margin:13px 0 6px">${t}</h3>`;
  return `<p class="sub" style="margin-top:0;line-height:1.75">按主题把「书 · 人物 · 事件 · 思想」聚合在一起，点任意项即可跳转。</p>` +
    F.map(f => {
      const books = (f.books || []).map(id => { const i = RES.findIndex(r => r.id === id); return i < 0 ? '' : bookCard(i); }).join('');
      const ppl = linkChips(f.people || [], 'people');
      const evs = (f.events || []).map(y => { const i = (EX.events || []).findIndex(e => e.year === y); return i < 0 ? '' : `<span class="tag" onclick="openEvent(${i})">📅 ${EX.events[i].year} ${EX.events[i].name}</span>`; }).join('');
      const sch = linkChips(f.schools || [], 'school');
      return `<section style="margin:0 0 24px;padding-bottom:8px;border-bottom:1px solid var(--card-border)">
        <h2 class="sub-title" style="font-size:1.05rem;margin-bottom:4px">${f.icon || '🧩'} ${f.name}</h2>
        ${f.desc ? `<p class="sub" style="line-height:1.8;margin:2px 0 4px">${f.desc}</p>` : ''}
        ${books ? H3('📚 相关书籍') + books : ''}
        ${ppl ? H3('👤 相关人物') + `<div class="tagrow">${ppl}</div>` : ''}
        ${evs ? H3('📅 相关事件') + `<div class="tagrow">${evs}</div>` : ''}
        ${sch ? H3('🧩 相关思想 · 组织') + `<div class="tagrow">${sch}</div>` : ''}
        ${(f.factions && f.factions.length) ? H3('🧭 各派系') + '<div style="display:flex;flex-direction:column;gap:8px">' + f.factions.map(x => '<div style="padding:9px 11px;border:1px solid var(--card-border);border-radius:10px"><b style="color:var(--accent);font-size:.82rem">' + x.name + '</b><div style="font-size:.76rem;line-height:1.8;opacity:.86;margin-top:3px">' + x.desc + '</div></div>').join('') + '</div>' : ''}
        ${(f.refs && f.refs.length) ? H3('🗃 存档文献 · 各方观点') + '<div style="display:flex;flex-direction:column;gap:6px">' + f.refs.map(x => '<div style="display:flex;gap:9px;padding:8px 11px;border:1px solid var(--card-border);border-radius:10px"><span>📎</span><div style="flex:1;min-width:0"><div style="font-size:.8rem;font-weight:600">' + x.t + '</div>' + (x.n ? '<div style="font-size:.72rem;opacity:.72;margin-top:2px">' + x.n + '</div>' : '') + '</div></div>').join('') + '</div>' + '<p class="sub" style="font-size:.68rem;opacity:.6;margin:5px 0 0;line-height:1.7">以上为<b>存档文献</b>，仅作资料留存与查阅。文中观点属原作者，收录不代表编者立场；对同一历史议题，本站同时保留不同立场的材料，供读者自行辨识与判断。</p>' : ''}
      </section>`;
    }).join('');
}

function critHTML(id){
  const it = RES.find(r => r.id === id); if (!it || !it.crit) return '';
  const links = (it.critBy || []).map(c => { const i = RES.findIndex(r => r.id === c.id); return i < 0 ? `<span class="tag">${c.t}</span>` : `<span class="tag" onclick="openItemDetail(${i})">${c.t} ↗</span>`; }).join('');
  return `<div style="margin-top:14px;padding:10px 12px;border:1px dashed #b66;border-radius:10px">
      <div style="font-size:.8rem;color:#ff8b8b;margin-bottom:6px">⚔️ 被马克思主义批判的著作</div>
      <div style="font-size:.72rem;opacity:.8;margin-bottom:6px">批判它的著作（点击查看）：</div>
      <div class="tagrow">${links}</div></div>`;
}

function checkUpdateUI(){
  toast('更新请通过 F-Droid 或项目发布页获取（应用内不下载、不安装可执行文件）');
}

/* ---------- 免费赞助（算力支援，完全自愿；不影响任何内容的免费开放） ---------- */
function openSponsor(){
  const L1 = 'https://ima.qq.com/copilot-invite-reward-token/assist/V_5sR_vRxr6uWRsf9qaanw';
  const L2 = 'https://ima.qq.com/copilot-industry-workflow/share?assistUserId=V_5sR_vRxr6uWRsf9qaanw&industryId=gov';
  openContent('❤️ 免费赞助', crumbFrom([{ t:'设置', fn:()=>openAccount() }, { t:'免费赞助', fn:()=>openSponsor() }]) + `
    <p class="sub" style="line-height:1.95;margin-top:0">本站<b>完全免费、公开</b>，不向任何人收费，也不设任何门槛。</p>
    <p class="sub" style="line-height:1.95">目前唯一缺的是<b>算力</b>——没有算力，网站与 App 就难以继续更新和完善。如果你愿意，可以点下面的链接帮本站「助力」：<b>邀请新用户使用 ima，双方都能领到免费算力</b>。这些算力<b>只会投入到本软件的创作</b>之中。</p>
    <p class="sub" style="line-height:1.95;margin-top:4px;opacity:.9">如有余力，可在「ima」中通过官方入口给予算力支援；本应用内不提供外部跳转。</p>
    <p class="sub" style="line-height:1.95;margin-top:14px;opacity:.88"><b>无论你是否赞助，本站内容都一律免费公开</b>，任何人都能看、都能用。</p>
    <p class="sub" style="text-align:center;margin-top:20px;color:var(--accent)">最后，感谢每一位支持本站的同志。🙏</p>`);
}

const privacyHTML = '<p class="sub" style="line-height:1.8">本站与「学通」App 均为纯本地 / 静态实现：不收集、不上传任何个人数据，无第三方统计脚本、无账号服务器。你的收藏、书签、笔记、做题题库与本机书库，全部只保存在本机浏览器 / App 存储中。</p><div class="ops" style="margin-top:12px"><a class="go" style="text-decoration:none;padding:8px 16px;border-radius:9px;display:inline-block" href="privacy.html">📄 打开完整隐私政策</a></div>';

const licensesHTML = '<p class="sub" style="line-height:1.8">本站与本 App 内置了以下开源软件，版权归各自作者所有，谨致谢意：</p>' + '<ul style="line-height:2;font-size:.83rem">' + '<li><b>3d-force-graph</b> 1.80.1 — MIT License · © Vasco Asturiano</li>' + '<li><b>three.js</b> r186 — MIT License · © three.js authors</li>' + '<li><b>qrcode-generator</b> 1.4.4 — MIT License · © Kazuhiko Arase</li>' + '</ul>' + '<p class="sub" style="line-height:1.7;opacity:.75;margin-top:6px">历史版本曾使用 epub.js / JSZip / PDF.js（随「本地书库」下线，当前发行版已不再内置，详见许可页）。</p>' + '<div class="ops" style="margin-top:12px"><a class="go" href="licenses.html" style="text-decoration:none;padding:8px 16px;border-radius:9px;display:inline-block">📄 查看许可全文</a></div>';

const SECTIONS = [
  { icon:'📜', title:HUB_NAME,       get:() => historyPageHTML() },
  { icon:'🏛️', title:'图书馆',       get:() => libsHTML(), hideInNav:true },
  { icon:'🧭', title:'资源导航',     get:() => navGroupsListHTML() },
  { icon:'📖', title:'阅读与手册',   get:() => readManualHTML() },
  { icon:'📘', title:'使用指南',     get:() => helpFaqHTML(), hideInNav:true },
  { icon:'📮', title:'意见反馈',     get:() => feedbackHTML() },
  { icon:'📁', title:'文件',     get:() => allIndexHTML(), hideInNav:true },
  { icon:'🛡️', title:'隐私与协议',   get:() => privacyHTML, hideInNav:true },
  { icon:'📜', title:'开源许可',     get:() => licensesHTML, hideInNav:true },
  { icon:'📝', title:'更新日志',     get:() => logHTML,  hideInNav:true },
  { icon:'ℹ️', title:'关于本站',     get:() => metaHTML, hideInNav:true },
];
function openSection(i){
  const s = SECTIONS[i]; if (!s) return;
  /* 照 QQ：除频道外，所有页面顶部都是搜索框（头像 / 搜索 / ＋ 常驻，不随页面切换而变） */
  openContent(s.icon + ' ' + s.title, (i === 0 ? '' : crumbFrom([{ t:s.title, fn:()=>openSection(i) }])) + s.get(), { root: true, right: (i === 0 ? { text:'＋', act:'openSelfEdit()' } : null) });
}

/* 首页板块导航已移除：史料改为底栏标签，关系图谱/3D图谱并入「史料 → 图谱」 */
document.getElementById('viewList').innerHTML =
  SECTIONS.map((s, i) => `<div class="set-row"><span>${s.icon} ${s.title}</span><button class="sbtn" onclick="openSection(${i})">查看</button></div>`).join('');

/* ---------- 顶部快捷面板（仿 QQ「+」） ---------- */
function togglePlus(){ try{ var p=document.getElementById('qPanel'), s=document.getElementById('qScrim'); if(!p) return; var open=p.hidden; p.hidden=!open; if(s) s.hidden=!open; }catch(e){} }
function closePlus(){ try{ var p=document.getElementById('qPanel'), s=document.getElementById('qScrim'); if(p) p.hidden=true; if(s) s.hidden=true; }catch(e){} }
document.addEventListener('click', function(e){
  var p = document.getElementById('qPanel'); if (!p || p.hidden) return;
  if (p.contains(e.target)) return;
  var plus = document.getElementById('qPlus'); if (plus && plus.contains(e.target)) return;
  closePlus();
}, true);

/* ---------- 分类（底栏第三栏）：动态 + 分类入口（分开列出，非文件夹） ---------- */
function dynamicsHTML(){
  var L=(CT.leaders||[]), LIFE=window.SITE_MENTOR_LIFE||{}, ny=(new Date()).getFullYear();
  return '<div class="sec-t">📣 动态</div>' + L.map(function(p){
    var f=LIFE[p.name]||{}, y=(f.died?parseInt(f.died.slice(0,4),10):0), n=y?(ny-y):0;
    var ymd=f.died?(f.died.slice(0,4)+'年'+parseInt(f.died.slice(5,7),10)+'月'+parseInt(f.died.slice(8,10),10)+'日'):'';
    return '<div class="dyn">'+faceHTML(p)+
      '<div class="dyn-b"><div class="dyn-n">'+p.name+'</div>'+
      '<div class="dyn-t">纪念 '+p.name+' 逝世 '+n+' 周年</div>'+
      (ymd?'<div class="dyn-s">'+ymd+' 于'+(f.place||'')+' 逝世</div>':'')+
      '<div class="dyn-meta">'+(p.years||'')+(p.role?(' · '+p.role):'')+'</div></div></div>';
  }).join('');
}
function classifyRowDefs(){
  var rows=[
    {k:'推荐', i:'⭐', a:"closeDrawer();homeCat('推荐')", c:countOf('推荐')},
    {k:'原著', i:'📕', a:"closeDrawer();homeCat('原著')", c:countOf('原著')},
    {k:'歌曲', i:'🎵', a:"closeDrawer();homeCat('歌曲')", c:countOf('歌曲')},
    {k:'影像', i:'🎬', a:"closeDrawer();homeCat('影像')", c:countOf('影像')},
    {k:'工具', i:'🧰', a:"closeDrawer();homeCat('工具')", c:countOf('工具')},
    {k:'图书馆', i:'🏛️', a:"closeDrawer();openSection(secIdx('图书馆'))", c:''},
    {k:'对公文献', i:'📄', a:"closeDrawer();homeCat('对公文献')", c:countOf('对公文献')},
    {k:'做题', i:'✍️', a:"closeDrawer();openQuiz()", c:quizCount()}
  ];
  return rows;
}
function classifyHidden(){ try { return JSON.parse(localStorage.getItem('classifyHidden') || '[]'); } catch(e){ return []; } }
function classifyHTML(){
  var rows = classifyRowDefs().filter(function(r){ return classifyHidden().indexOf(r.k) < 0; });
  return rows.map(function(r){
    return '<div class="citem" onclick="'+r.a+'"><span class="ci">'+r.i+'</span><span class="cn">'+r.k+'</span><span class="cc">'+(r.c===''?'':r.c)+'</span><span class="ca">›</span></div>';
  }).join('');
}
function classifyPageHTML(){ return crumbFrom([{t:'分类', fn:function(){ openClassify(); }}]) + dynamicsHTML() + classifyHTML(); }
function openClassify(){ openContent('🗂️ 分类', classifyPageHTML(), { root:true, right:{ text:'⚙️', act:'openClassifyManage()' } }); }
function renderClassify(){ var cv = document.getElementById('contentView'); if (cv) cv.innerHTML = classifyPageHTML(); }
function openClassifyManage(){
  var wasOpen = !!document.getElementById('clsM');
  closeClassifyManage();
  if (wasOpen) return;                     /* 再点一次右上角 = 收起 */
  var defs = classifyRowDefs(), hid = classifyHidden();
  var d = document.createElement('div'); d.id = 'clsM'; d.className = 'qpanel'; d.setAttribute('role','menu');
  d.style.minWidth = '210px';
  d.innerHTML = '<div class="cls-tt">🗂️ 分类页管理</div>' +
    defs.map(function(r){
      return '<label class="cls-row"><input type="checkbox"' + (hid.indexOf(r.k) < 0 ? ' checked' : '') +
        ' onchange="classifyToggle(this.getAttribute(\'data-k\'),this.checked)" data-k="' + escHtml(r.k) + '">' +
        '<span class="ci">' + r.i + '</span><span class="cn">' + r.k + '</span></label>';
    }).join('') +
    '<button class="qitem cls-ok" onclick="closeClassifyManage()">✓ 完成</button>';
  var sc = document.createElement('div'); sc.id = 'clsScrim'; sc.className = 'qpanel-scrim';
  var shut = function(ev){ try { if (ev && ev.cancelable) ev.preventDefault(); } catch(e){}
    _clsGuardOn(); closeClassifyManage(); };
  sc.onclick = shut; sc.addEventListener('touchend', shut);
  document.body.appendChild(sc); document.body.appendChild(d);
  if (!window._clsEsc){
    window._clsEsc = 1;
    /* 鼠标：捕获阶段判断「点的是不是面板内部」，点外面就收起（并用 guard 防止这一次 click 漏到下层） */
    document.addEventListener('click', function(e){
      if (_clsGuardHit()) { e.stopPropagation(); e.preventDefault(); return; }
      var dm = document.getElementById('clsM'); if (!dm) return;
      if (dm.contains(e.target)) return;
      var plus = document.getElementById('qPlus'); if (plus && plus.contains(e.target)) return;
      e.stopPropagation(); e.preventDefault(); _clsGuardOn(); closeClassifyManage();
    }, true);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeClassifyManage(); });
  }
}
function closeClassifyManage(){ var d=document.getElementById('clsM'); if(d)d.remove(); var s=document.getElementById('clsScrim'); if(s)s.remove(); }
/* 关闭后 400ms 内吞掉那一次 click，避免「点遮罩关闭 → 顺手点到底下的分类项」（移动端点透） */
var _clsGuardT = 0;
function _clsGuardOn(){ _clsGuardT = Date.now(); }
function _clsGuardHit(){ return _clsGuardT && (Date.now() - _clsGuardT) < 400; }
function classifyToggle(k, on){
  if (!k) return;
  var hid = classifyHidden(); var i = hid.indexOf(k);
  if (on){ if (i >= 0) hid.splice(i, 1); } else { if (i < 0) hid.push(k); }
  try { lset('classifyHidden', JSON.stringify(hid)); } catch(e){}
  renderClassify();
}

/* ---------- 立场 / 声明 / 防失联 ---------- */
document.getElementById('standingBox').textContent = CT.standing || '';
document.getElementById('legalBox').innerHTML = legalHTML;
var _ml = document.getElementById('mirrorList');
if (_ml) _ml.innerHTML =
  (CFG.mirrors && CFG.mirrors.length)
    ? '备用入口：' + CFG.mirrors.filter(u => validUrl(u)).map(u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).join(' · ')
    : '备用入口：未添加';

/* ---------- 在线预览 ---------- */
/* 站内文件（books/、audio/…）可能并未随站点一起上传：先探一下，缺了就直接转图书馆，
   避免点下去是 404 的死链接。探测失败/跨域一律放行，不挡用户。 */
function probeLocalFile(u, cb){
  let done = false;
  const fin = v => { if (done) return; done = true; cb(!!v); };
  try { setTimeout(() => fin(true), 4000); } catch(e){}
  try {
    fetch(u, { method:'GET', headers:{ 'Range':'bytes=0-7' }, cache:'no-store' }).then(r => {
      const ct = String(r.headers.get('content-type') || '').toLowerCase();
      if (!r.ok || ct.indexOf('text/html') >= 0) return fin(false);
      return r.arrayBuffer().then(b => {
        const n = new Uint8Array(b); let sig = '';
        for (let i = 0; i < Math.min(4, n.length); i++) sig += String.fromCharCode(n[i]);
        const looks = sig.indexOf('%PDF') === 0 || sig.indexOf('PK') === 0 || sig.indexOf('ID3') === 0 || (n.length > 0 && n[0] === 0xFF);
        fin(looks || (n.length > 0 && ct.indexOf('octet-stream') < 0));
      });
    }).catch(() => fin(true));
  } catch(e){ fin(true); }
}
function openPreview(url, title){
  if (url && /^https?:/i.test(url)) { toast('本站不跳转外部链接；请自行在浏览器中检索。'); return; }
  probeLocalFile(url, ok => {
    if (ok) return reallyOpenPreview(url, title);
    toast('本站未存放该文件本体，也不跳转外部图书馆。');
  });
}
function reallyOpenPreview(url, title){
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalOpen').href = url;
  document.getElementById('modalFrame').src = url;
  var _mp=document.getElementById('modal'); yzDlgOpen(_mp); _mp.classList.add('open');
}
function closePreview(){ document.getElementById('modal').classList.remove('open'); document.getElementById('modalFrame').src = ''; yzDlgClose(); }
document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closePreview(); });
document.getElementById('dataModal').addEventListener('click', e => { if (e.target.id === 'dataModal') closeDataModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { var _d = document.getElementById('drawer'); if (_d && _d.classList.contains('open')) { pageBack(); return; } closePlus(); closePreview(); closeLeave(); closeShare(); closeDataModal(); } });

/* ---------- 页导航（QQ 原生「整页推进」） ---------- */
function openDrawer(mode){
  var d = document.getElementById('drawer'); if (!d) return;
  var isPage = mode !== 'drawer';
  d.classList.toggle('page', isPage);
  d.classList.add('open');
  var s = document.getElementById('scrim'); if (s) s.classList.toggle('open', !isPage);
  setTimeout(updateToTop, 0);
  /* 键盘/读屏：打开后把焦点移入抽屉，优先落到关闭按钮 */
  setTimeout(function(){ try{ var b=d.querySelector('.pc-x')||d.querySelector('.drawer-head button')||d.querySelector('button'); if(b) b.focus(); }catch(e){} }, 30);
}
function closeDrawer(){ var d = document.getElementById('drawer'); if (d) d.classList.remove('open'); var s = document.getElementById('scrim'); if (s) s.classList.remove('open'); updateToTop(); }
/* 从页面「退出」→ 回到主页（而不是停在设置） */
function exitToHome(){ try { resetPageStack(); } catch(e){} try { closeDrawer(); } catch(e){} try { goHome(); } catch(e){} }
/* 抽屉滑动：仅允许在「主页」从左侧边缘右滑打开（其他页面不响应） */
(function(){
  var sx=0, sy=0, tracking=false;
  function homeVisible(){ var h=document.getElementById('view-home'); return !!h && !h.hidden; }
  document.addEventListener('touchstart', function(e){
    if (e.touches.length !== 1) { tracking=false; return; }
    var d=document.getElementById('drawer');
    sx=e.touches[0].clientX; sy=e.touches[0].clientY;
    tracking = homeVisible() && sx < 40 && !(d && d.classList.contains('open'));
  }, { passive:true });
  document.addEventListener('touchend', function(e){
    if (!tracking) return; tracking=false;
    if (!e.changedTouches.length) return;
    var dx=e.changedTouches[0].clientX - sx;
    var dy=Math.abs(e.changedTouches[0].clientY - sy);
    if (dx > 60 && dy < 60) openAccount();
  }, { passive:true });
})();
/* 抽屉已打开时：从右往左滑可收回 */
(function(){
  var sx=0, sy=0, track=false;
  document.addEventListener('touchstart', function(e){
    if (e.touches.length !== 1){ track=false; return; }
    var d=document.getElementById('drawer');
    sx=e.touches[0].clientX; sy=e.touches[0].clientY;
    track = !!(d && d.classList.contains('open'));
  }, { passive:true });
  document.addEventListener('touchend', function(e){
    if (!track) return; track=false;
    if (!e.changedTouches.length) return;
    var dx=e.changedTouches[0].clientX - sx;
    var dy=Math.abs(e.changedTouches[0].clientY - sy);
    if (dy >= 60) return;
    /* 从右往左滑：收回抽屉（回主页） */
    if (dx < -60) { closeDrawer(); return; }
    /* 从左往右滑：返回上一级；已经在最外层时收回抽屉 */
    if (dx > 60) {
      if (_pageStack && _pageStack.length > 1) { try { pageBack(); } catch(e){} }
      else { closeDrawer(); }
    }
  }, { passive:true });
})();
function _hideDrawerViews(){
  ['pcView','accountView','settingsView','contentView'].forEach(function(id){ var e = document.getElementById(id); if (e) e.style.display = 'none'; });
}
function openPc(){                       /* 个人中心：左侧抽屉（仿 QQ「我的」） */
  resetPageStack();
  _hideDrawerViews();
  var pv = document.getElementById('pcView'); if (pv) pv.style.display = 'flex';
  document.getElementById('drawerTitle').textContent = '';
  var b = document.getElementById('acctBack'); if (b) b.hidden = true;
  renderPc();
  openDrawer('drawer');
}
function openSettings(){                 /* 设置页：整页推进 */
  resetPageStack();
  _hideDrawerViews();
  document.getElementById('settingsView').style.display = 'block';
  setTopbar('page', { title:'⚙️ 设置' });
  try { syncSelfEditSwitch(); } catch(e){}
  openDrawer('page');
}
function openAccountView(){              /* 账号页：整页推进 */
  resetPageStack();
  _hideDrawerViews();
  document.getElementById('accountView').style.display = 'block';
  setTopbar('page', { title:'👤 账号' });
  renderAccount();
  openDrawer('page');
}
function secIdx(t){ return SECTIONS.findIndex(s => s.title === t); }
/* 默认必须是「关」：overlay.js 未加载/加载失败时如果返回 true，
   界面会显示「已开启」但实际编辑器并不存在（用户点了没反应）。 */
function selfEditOn(){ try{ if (window.YZY && typeof YZY.editorEnabled === "function") return !!YZY.editorEnabled(); }catch(e){} return false; }
function syncSelfEditSwitch(){ try{ var b=document.getElementById("editSw"); if(b) b.textContent = selfEditOn() ? "已开启" : "已关闭"; }catch(e){} }
function toggleSelfEdit(){
  if (!window.YZY || typeof YZY.setEditorEnabled!=="function"){ toast("编辑器未加载，请刷新页面"); return; }
  var on = selfEditOn(); YZY.setEditorEnabled(!on); syncSelfEditSwitch();
  var st = document.getElementById("seState"); if (st) st.textContent = !on ? "已开启" : "已关闭";
  if (!on) { try { if (window.__yzEditorBoot) window.__yzEditorBoot(); } catch(e){} toast("自助编辑已开启"); }
  else { var w=document.getElementById("zzyWrap"); if(w) w.classList.remove("open"); toast("自助编辑已关闭"); }
}
function openSelfEdit(){
  try {
  try { if (window.YZY && typeof YZY.setEditorEnabled==="function" && !YZY.editorEnabled()){ YZY.setEditorEnabled(true); syncSelfEditSwitch(); var _s=document.getElementById('seState'); if(_s)_s.textContent='已开启'; } } catch(e){}
  try { if (window.__yzEditorBoot) window.__yzEditorBoot(); } catch(e){}
  var b = document.getElementById("zzyBtn");
  if (b) { b.click(); openDrawer('page'); } else { try { location.href = "index.html?edit=1"; } catch(e){} }
  } catch(e){}
}
function openAccount(){ openPc(); }
function renderAccount(){
  const el = document.getElementById('accountView'); if (!el) return;
  let favN = 0, markN = 0;
  try { favN = JSON.parse(localStorage.getItem('favs') || '[]').length; } catch(e){}
  try { markN = JSON.parse(localStorage.getItem('marks') || '[]').length; } catch(e){}
  const name = localStorage.getItem('acctName') || '教员的好战士';
  const av = localStorage.getItem('acctAvatar') || '';
  el.innerHTML = `
    <div class="acct-head">
      <button class="acct-ava" onclick="pickAvatar()" title="点击更换头像">${av ? `<img src="${av}" alt="头像">` : '👤'}<span class="acct-cam">📷</span></button>
      <div style="flex:1;min-width:0">
        <button class="acct-name" onclick="editName()" title="点击修改名字">${name ? escAttr(name) : '未命名'} <span class="acct-pen">✏️</span></button>
        <div class="acct-sub">收藏 ${favN} · 书签 ${markN}</div>
      </div>
    </div>
    <div class="acct-ops">
      <button class="go" onclick="openDataIO('import')">🔐 登录（导入数据）</button>
      <button class="lbtn" onclick="exportData()">💾 导出账号数据</button>
    </div>
    <p class="acct-note">本站无服务器，账号只存在本机。换设备或重装后，用此前导出的 JSON 点「登录」，即可把头像、名字、收藏、书签与设置全部恢复。</p>
    <p class="acct-note">「我的数据」也在这一页：书签、导出 / 导入、清除本机数据。收藏、书签、笔记与本机设置不上传服务器。</p>
    <div class="acct-menu">
      <button class="acct-item" onclick="openSection(secIdx('隐私与协议'))"><span>🛡️</span>隐私与协议<i>数据与隐私</i></button>
      <button class="acct-item" onclick="openSection(secIdx('开源许可'))"><span>📜</span>开源许可<i>使用了哪些开源库</i></button>
      <button class="acct-item" onclick="requestAction()"><span>📮</span>意见反馈<i>求书 · 纠错 · 建议</i></button>
      <button class="acct-item" onclick="openMarks()"><span>🔖</span>我的书签<i>${markN} 条</i></button>
      <button class="acct-item" onclick="exportData()"><span>💾</span>导出我的数据<i>收藏 · 笔记 · 设置</i></button>
      <button class="acct-item" onclick="openDataIO('import')"><span>📥</span>导入我的数据<i>粘贴 JSON 恢复</i></button>
      <button class="acct-item" onclick="clearLocal()"><span>🧹</span>清除本机数据<i>不影响线上</i></button>
      <button class="acct-item" onclick="openSection(secIdx('关于本站'))"><span>ℹ️</span>关于本站<i>开源 · 声明</i></button>
    </div>
    <input type="file" id="acctFile" accept="application/json" style="display:none" onchange="importData(this)">
`;
}
function pickAvatar(){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { const img = new Image();
      img.onload = () => {
        const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
        const ctx = c.getContext('2d'); const r = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - r) / 2, (img.height - r) / 2, r, r, 0, 0, s, s);
        try { lset('acctAvatar', c.toDataURL('image/jpeg', 0.82)); }
        catch(e){ toast('图片过大，请换一张'); return; }
        try { syncSetAva(); } catch(e){}
        renderAccount(); toast('头像已更新');
      };
      img.src = rd.result; };
    rd.readAsDataURL(file);
  };
  inp.click();
}
function editName(){
  const cur = localStorage.getItem('acctName') || '教员的好战士';
  const v = prompt('输入昵称（仅存本机，可随时改）', cur);
  if (v === null) return;
  lset('acctName', v.trim().slice(0, 24));
  renderAccount(); syncSetAva();
}
var _pageStack = [];
function _renderPage(entry){
  _hideDrawerViews();
  const cv = document.getElementById('contentView');
  cv.style.display = 'block';
  cv.innerHTML = entry.html || '<p class="sub">暂无内容</p>';
  const d = document.getElementById('drawer'); if (d) d.scrollTop = 0;
  if (entry.root) setTopbar('root', { search: entry.search, ph: entry.ph, right: entry.right });
  else setTopbar('page', { title: entry.title });
  openDrawer('page');
}
function openContent(title, html, opts){
  opts = opts || {};
  var body = html || '<p class="sub">暂无内容</p>';
  var top = _pageStack[_pageStack.length - 1];
  function _sameRight(x, y){ if (!x && !y) return true; if (!x || !y) return false; return x.text === y.text && x.act === y.act; }
  if (top && top.title === title && top.html === body && top.root === !!opts.root && _sameRight(top.right, opts.right || null)){ _renderPage(top); return; }
  _pageStack.push({ title:title, html:body, root:!!opts.root, search:opts.search || null, ph:opts.ph || '', right:opts.right || null });
  if (_pageStack.length > 80) _pageStack.shift();
  _renderPage(_pageStack[_pageStack.length - 1]);
}
/* 返回上一页；已在最外层则回主页 */
function pageBack(){
  if (_pageStack.length > 1){ _pageStack.pop(); _renderPage(_pageStack[_pageStack.length - 1]); return; }
  _pageStack.length = 0; closeDrawer(); goHome();
}
function resetPageStack(){ _pageStack.length = 0; }

/* ---------- 显示调节（主题 / 字号 / 行距 / 版心 / 动效） ---------- */
/* 主题：auto = 跟随系统（实时响应系统的深色 / 浅色切换） */
const THEME_MQ = (window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null);
function resolvedTheme(mode){
  const m = (mode === 'sepia') ? 'auto' : (mode || 'auto');   /* 护眼已移除 */
  if (m !== 'auto') return m;
  try { if (window.AndroidApp && typeof AndroidApp.systemDark === 'function') return AndroidApp.systemDark() ? 'dark' : 'light'; } catch(e){}
  return (THEME_MQ && THEME_MQ.matches) ? 'light' : 'dark';
}
function applyTheme(mode){
  const m = mode || 'auto', r = resolvedTheme(m);
  document.body.classList.toggle('light', r === 'light');
  document.body.classList.remove('sepia');
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute('content', r === 'light' ? '#f5e9e2' : '#2b0505');
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('active', b.dataset.th === m));
}
function setTheme(mode){ applyTheme(mode); try { lset('theme', mode); } catch(e){} }
function setFS(v){
  const map = { sm:'15px', md:'16px', lg:'18px' };
  document.documentElement.style.fontSize = map[v] || map.md;
  document.querySelectorAll('#fsSeg button').forEach(b => b.classList.toggle('active', b.dataset.fs === v));
  lset('fs', v);
}
function setLH(v){
  document.documentElement.style.setProperty('--lh', v);
  document.querySelectorAll('#lhSeg button').forEach(b => b.classList.toggle('active', b.dataset.lh === v));
  lset('lh', v);
}
function setW(v){
  document.documentElement.style.setProperty('--maxw', v + 'px');
  document.querySelectorAll('#wSeg button').forEach(b => b.classList.toggle('active', b.dataset.w === v));
  lset('w', v);
}
function toggleMotion(){
  const off = !document.body.classList.contains('no-motion');
  document.body.classList.toggle('no-motion', off);
  document.getElementById('motionSw').textContent = off ? '已关闭' : '已开启';
  lset('motion', off ? 'off' : 'on');
}

/* ---------- 音乐 ---------- */
/* 背景音乐入口已移除 */

function clearLocal(){
  if (!confirm('确定清除本机数据吗？（收藏、书签、笔记、显示偏好）')) return;
  try{ localStorage.clear(); }catch(e){}
  try{ if (window.indexedDB) window.indexedDB.deleteDatabase('yzy_sites'); }catch(e){}
  try{ if (window.indexedDB) window.indexedDB.deleteDatabase('yz_books_v1'); }catch(e){}   /* 导入的书籍文件 */
  location.reload();
}

/* ---------- PWA 安装引导 ---------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; const b = document.getElementById('installBtn'); if (b && CFG.pwaHint) b.hidden = false; });
function installPWA(){ if (!deferredPrompt) return; deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => { deferredPrompt = null; const b = document.getElementById('installBtn'); if (b) b.hidden = true; }); }


/* ---------- 做题（选择题题库：只存本机 · 不记录答题/成绩 · 不进「我的数据」） ---------- */
const QUIZ_KEY = 'quizBank';
let quizPicked = {};   // 临时选择，不持久化、不计分
function quizBank(){
  try {
    const d = JSON.parse(localStorage.getItem(QUIZ_KEY) || '[]');
    if (Array.isArray(d)) return d;
    return d.questions || d.list || d.items || [];
  } catch(e){ return []; }
}
function quizSave(a){ try { lset(QUIZ_KEY, JSON.stringify(a)); } catch(e){} }
function quizCount(){ return quizBank().length; }
function quizAnswerIndex(it){
  const opts = it.options || it.opts || [];
  const a = (it.answer != null) ? it.answer : (it.a != null ? it.a : (Array.isArray(it.answers) ? it.answers[0] : null));
  if (typeof a === 'number') return (a >= 1 && a <= opts.length) ? a - 1 : a;
  if (typeof a === 'string'){ const m = a.trim().toUpperCase().match(/[A-Z]/); if (m) return m[0].charCodeAt(0) - 65; }
  return -1;
}
function quizReason(it, j, L){
  const rs = it.reasons || it.optionsWhy;
  if (Array.isArray(rs)) return rs[j] || '';
  if (rs && typeof rs === 'object') return rs[L] || rs[String(j)] || rs[String(j + 1)] || '';
  return '';
}
function quizRender(){
  const cv = document.getElementById('contentView');
  if (cv) cv.innerHTML = crumbFrom([{ t:'做题', fn:()=>openQuiz() }]) + quizHTML();
}
function openQuiz(){ openContent('✍️ 做题', crumbFrom([{ t:'做题', fn:()=>openQuiz() }]) + quizHTML()); }
function quizHTML(){
  const bank = quizBank();
  const tools = `<div class="ops" style="margin:10px 0 4px;flex-wrap:wrap;gap:8px">` +
    `<label class="tag" style="cursor:pointer">📥 导入选择题<input type="file" accept="application/json,.json" onchange="quizImport(this)" style="display:none"></label>` +
    (bank.length ? `<button class="tag" onclick="quizExport()">📤 导出选择题</button><button class="tag" onclick="quizClear()">🗑 清空题库</button>` : '') +
    `</div>`;
  const note = `<p class="sub" style="margin-top:0;line-height:1.75">只导入 <b>选择题</b>：题干 · 选项 · 答案 · 解析（含<b>逐项说明每个选项为什么对 / 为什么错</b>）。题库<b>只存本机</b>、<b>不记录答题与成绩</b>；可在本页<b>单独导入 / 导出</b>，也会一并进「导出我的数据」。</p>`;
  if (!bank.length){
    return note + tools +
      `<div style="margin-top:10px;padding:12px;border:1px dashed var(--card-border);border-radius:10px;line-height:1.9">
        <div style="color:var(--accent);font-weight:700;margin-bottom:6px">题库为空</div>
        点上方「📥 导入选择题」，选一个 JSON 文件即可。格式示例：
        <pre style="white-space:pre-wrap;font-size:.72rem;opacity:.85;margin-top:8px;line-height:1.7">{
  "title": "我的题库",
  "questions": [
    { "q": "题干文字",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "A",
      "explain": "总解析：为什么选 A",
      "reasons": [
        "A 对：因为……",
        "B 错：因为……",
        "C 错：因为……",
        "D 错：因为……"
      ]
    }
  ]
}</pre>
        <div style="font-size:.72rem;opacity:.7;margin-top:6px">answer 可写字母（A/B/C…）或数字（1 表示第 1 个选项）；explain 为总解析、reasons 为逐项说明（数组，与选项一一对应；也可写成 { "A":"…", "B":"…" } 的对象），两者都可省略。</div>
      </div>`;
  }
  const cards = bank.map((it, i) => {
    const opts = (it.optptns || it.opts || []);
    const ai = quizAnswerIndex(it);
    const picked = quizPicked[i];
    const reveal = (picked != null);
    const optHTML = opts.map((o, j) => {
      const L = String.fromCharCode(65 + j);
      if (!reveal)
        return `<button class="tag" onclick="quizPick(${i},${j})">${L}. ${escAttr(String(o))}</button>`;
      const isAns = (j === ai), isPick = (j === picked);
      const color = isAns ? '#8fd08f' : (isPick ? '#ff8b8b' : 'inherit');
      const mark = isAns ? '✅' : (isPick ? '❌' : '·');
      const r = quizReason(it, j, L);
      return `<div style="margin:6px 0;color:${color};line-height:1.6">${mark} ${L}. ${escAttr(String(o))}` +
        (r ? `<div style="opacity:.72;font-size:.92em;margin-left:1.5em;color:var(--text)">${escAttr(String(r))}</div>` : '') + `</div>`;
    }).join('');
    let res = '';
    if (reveal){
      const ok = (ai === picked);
      const ex = it.explain || it.analysis || '';
      res = `<div style="margin-top:8px;font-size:.82rem;line-height:1.8">
        <b style="color:${ok ? '#8fd08f' : '#ff8b8b'}">${ok ? '✅ 答对了' : ('❌ 答错了 · 正确答案：' + (ai < 0 ? '（未标注）' : String.fromCharCode(65 + ai)))}</b>` +
        (ex ? `<div style="opacity:.88;margin-top:4px">💡 总解析：${escAttr(String(ex))}</div>` : '') +
        `<div style="opacity:.55;margin-top:8px;font-size:.9em">逐项说明：</div>${optHTML}</div>`;
    }
    return `<div style="margin-top:12px;padding:12px;border:1px solid var(--card-border);border-radius:10px">
      <div style="font-weight:600;line-height:1.7">${i + 1}. ${escAttr(String(it.q || it.question || it.title || ''))}</div>` +
      (reveal ? '' : `<div class="tagrow" style="margin-top:8px">${optHTML}</div>`) + res + `</div>`;
  }).join('');
  return note + tools + `<div style="margin-top:6px">${cards}</div>`;
}
function quizPick(i, j){ quizPicked[i] = (quizPicked[i] === j ? null : j); quizRender(); }
function quizImport(input){
  const f = input.files && input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      let qs = Array.isArray(d) ? d : (d.questions || d.list || d.items || []);
      qs = qs.filter(x => x && (x.q || x.question || x.title) && (x.options || x.opts));
      if (!qs.length) throw new Error('empty');
      qs = qs.map(x => ({ q: x.q || x.question || x.title, options: x.options || x.opts,
        answer: (x.answer != null ? x.answer : x.a), explain: x.explain || x.analysis || '', reasons: x.reasons || x.optionsWhy || '' }));
      quizSave(qs); quizPicked = {}; quizRender();
      toast('已导入 ' + qs.length + ' 道选择题');
    } catch(e){ toast('导入失败：JSON 格式不对'); }
    input.value = '';
  };
  r.readAsText(f);
}
function quizExport(){
  const bank = quizBank(); if (!bank.length){ toast('题库为空'); return; }
  const blob = new Blob([JSON.stringify({ title:'选择题题库', questions: bank }, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '做题题库.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已导出选择题 JSON｜' + (window.AndroidApp ? '已存到系统「下载」' : '已存到浏览器下载'));
}
function quizClear(){
  if (!confirm('清空本机题库？（不可恢复）')) return;
  quizSave([]); quizPicked = {}; quizRender(); toast('题库已清空');
}

/* ===================== 通知（本机自助编辑的变更记录） ===================== */
function nfList(){ try { return JSON.parse(localStorage.getItem('notifs') || '[]'); } catch(e){ return []; } }
function nfPush(text){ try { var a = nfList(); a.unshift({ t:String(text || '内容已修改'), ts:Date.now() }); if (a.length > 200) a = a.slice(0,200); lset('notifs', JSON.stringify(a)); nfBadge(); } catch(e){} }
window.__yzNotify = nfPush;
function nfClear(){ try { localStorage.removeItem('notifs'); } catch(e){} nfBadge(); }
function nfBadge(){ try { var n = nfList().length, d = document.getElementById('nfBadge'); if (d){ d.textContent = n ? String(n > 99 ? '99+' : n) : ''; d.style.display = n ? 'inline-block' : 'none'; } } catch(e){} }
function fmtTs(ts){ try { var d = new Date(ts); return (d.getMonth()+1)+'/'+d.getDate()+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); } catch(e){ return ''; } }
function escHtml(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function openNotifs(){
  var a = nfList();
  openContent('🔔 通知', crumbFrom([{ t:'通知', fn:openNotifs }]) +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 8px">' +
      '<span class="sec-t" style="border:0;margin:0">共 ' + a.length + ' 条</span>' +
      (a.length ? '<button class="sbtn" onclick="nfClear();openNotifs()">清除全部</button>' : '') + '</div>' +
    (a.length
      ? a.map(function(x){ return '<div class="nf"><span class="nf-t">' + escHtml(x.t) + '</span><span class="nf-d">' + fmtTs(x.ts) + '</span></div>'; }).join('')
      : '<p class="sub" style="line-height:1.9">暂无通知。<br>对本机内容（人物 / 资源 / 图谱等）进行修改后，这里会记录一条通知，可随时清除。</p>'));
  nfBadge();
}

/* ===================== 史料：仿 QQ「联系人」页 ===================== */
function historyPageHTML(){
  var ava = 'avatar.svg'; try { ava = localStorage.getItem('acctAvatar') || 'avatar.svg'; } catch(e){}
  var T = [['group','分组'],['people','人物'],['graph','图谱'],['channel','频道'],['archive','史料']];
  return '<div class="qqquick">' +
      '<div class="qqrow" onclick="toggleSelfEdit()"><span class="qi">✏️</span><span class="qn">自助编辑</span><span class="qs" id="seState">' + (selfEditOn() ? '已开启' : '已关闭') + '</span><span class="qa">›</span></div>' +
      '<div class="qqrow" onclick="openNotifs()"><span class="qi">🔔</span><span class="qn">通知</span><span class="nf-badge" id="nfBadge"></span><span class="qa">›</span></div>' +
    '</div>' +
    '<div class="qqtabs">' + T.map(function(x,i){ return '<button class="qqt' + (i ? '' : ' on') + '" data-t="' + x[0] + '" onclick="setHistTab(\'' + x[0] + '\',this)">' + x[1] + '</button>'; }).join('') + '</div>' +
    '<div class="qqpanels">' +
      '<div class="qqpanel on" data-p="group">' + histGroupHTML() + '</div>' +
      '<div class="qqpanel" data-p="people">' + histPeopleHTML() + '</div>' +
      '<div class="qqpanel" data-p="graph">' + histGraphHTML() + '</div>' +
      '<div class="qqpanel" data-p="channel"><p class="sub" style="line-height:1.9">「频道」暂未开放，后续在此添加。</p></div>' +
      '<div class="qqpanel" data-p="archive">' + histArchiveHTML() + '</div>' +
    '</div>';
}
function setHistTab(k, btn){
  var box = btn ? btn.parentNode : document.querySelector('.qqtabs');
  if (box) Array.prototype.forEach.call(box.querySelectorAll('.qqt'), function(b){ b.classList.toggle('on', b.getAttribute('data-t') === k); });
  Array.prototype.forEach.call(document.querySelectorAll('.qqpanel'), function(p){ p.classList.toggle('on', p.getAttribute('data-p') === k); });
}
function histGroupHTML(){
  return HUB.map(function(h){
    return '<div class="qqrow" onclick="openHub(\'' + h.key + '\')"><span class="qi">' + h.icon + '</span><span class="qn">' + h.title + '</span><span class="qs">' + hubCount(h.key) + ' 项</span><span class="qa">›</span></div>';
  }).join('');
}
function histPeopleHTML(){
  var rows = [['🫡','导师','leaders'],['🫡','同志','comrades'],['📺','推荐人物','recommend'],['👤','其他人物','figures']];
  return rows.map(function(r){ return '<div class="qqrow" onclick="openHub(\'' + r[2] + '\')"><span class="qi">' + r[0] + '</span><span class="qn">' + r[1] + '</span><span class="qs">' + hubCount(r[2]) + ' 项</span><span class="qa">›</span></div>'; }).join('');
}
function histArchiveHTML(){
  var rows = [['💡','思想','thoughts'],['🏛️','组织','orgs'],['🔥','文革','wenge'],['⚔️','被批判人物','critics']];
  return rows.map(function(r){ return '<div class="qqrow" onclick="openHub(\'' + r[2] + '\')"><span class="qi">' + r[0] + '</span><span class="qn">' + r[1] + '</span><span class="qs">' + hubCount(r[2]) + ' 项</span><span class="qa">›</span></div>'; }).join('');
}
function histGraphHTML(){
  var rows = [];
  try { if (window.YZY && YZY.listGraphs) YZY.listGraphs().forEach(function(g){ rows.push(['🕸️', g.name, "location.href='graph.html?g=" + encodeURIComponent(g.id) + "'"]); }); } catch(e){}
  if (!rows.length) rows.push(['🕸️','主图谱',"location.href='graph.html'"]);
  rows.push(['🧊','3D 关系图谱',"location.href='graph3d.html'"]);
  return '<div class="qqgt">🕸️ 图谱（点击进入）</div>' + rows.map(function(r){
    return '<div class="qqrow" onclick="' + r[2] + '"><span class="qi">' + r[0] + '</span><span class="qn">' + r[1] + '</span><span class="qa">›</span></div>';
  }).join('');
}

/* ---------- 初始化 ---------- */
/* 主题默认「跟随系统」。早期版本出厂默认深色，需要一次性迁移成 auto；
   但迁移只能在首次做一次——原来每次启动都把 'dark' 吞成 'auto'，
   于是用户「在设置里选了深色」，重开 App（以及打开图谱页）又变回浅色。
   现在：迁移只跑一次（themeMigrated 标记），之后完全尊重用户的选择。 */
try {
  const _saved = localStorage.getItem('theme');
  if (!localStorage.getItem('themeMigrated')) {
    const _t = (!_saved || _saved === 'sepia') ? 'auto' : _saved;
    applyTheme(_t); lset('theme', _t);
    try { localStorage.setItem('themeMigrated', '1'); } catch (e) {}
  } else {
    applyTheme(_saved || 'auto');
  }
} catch(e){ applyTheme('auto'); }
try {
  if (THEME_MQ) {
    const _onSys = () => { try { if ((localStorage.getItem('theme') || 'auto') === 'auto') applyTheme('auto'); } catch(e){} };
    if (THEME_MQ.addEventListener) THEME_MQ.addEventListener('change', _onSys); else if (THEME_MQ.addListener) THEME_MQ.addListener(_onSys);
  }
} catch(e){}
/* 供 App 在系统深/浅色切换时调用（App 端 onConfigurationChanged） */
window.__yzSystemTheme = function(){ try { if ((localStorage.getItem('theme') || 'auto') === 'auto') applyTheme('auto'); } catch(e){} };
setFS(localStorage.getItem('fs') || 'md');
setLH(localStorage.getItem('lh') || '1.9');
setW(localStorage.getItem('w') || '460');
/* 申请持久化存储：避免离线数据（相册 / 导入内容 / 离线缓存）被浏览器按 LRU 清理 */
try { if (navigator.storage && navigator.storage.persisted) { navigator.storage.persisted().then(function(p){ if (!p && navigator.storage.persist) return navigator.storage.persist(); }).catch(function(){}); } } catch(e){}
if (localStorage.getItem('motion') === 'off') { document.body.classList.add('no-motion'); document.getElementById('motionSw').textContent = '已关闭'; }
else { document.getElementById('motionSw').textContent = '已开启'; }
var _totEl = document.getElementById('total'); if (_totEl) _totEl.textContent = RES.length;
try { var _v = 'v' + ((window.SITE_CONFIG || {}).version || '0.0.0'); document.documentElement.setAttribute('data-build', _v); var _bt = document.getElementById('buildTag'); if (_bt) _bt.textContent = _v; } catch(e){}
try { var _vs=(window.SITE_CONFIG||{}).version||'—'; var _vn=''; if (window.AndroidApp && AndroidApp.versionName) _vn=AndroidApp.versionName(); var _vl=document.getElementById('verLine'); if (_vl) _vl.innerHTML='<span>🌐 网站 v'+_vs+'</span><span style="opacity:.32"> ｜ </span><span>📱 App v'+(_vn||'—')+'</span><span style="opacity:.32"> ｜ </span><span onclick="checkUpdateUI()" style="cursor:pointer;color:var(--accent)">🔄 检查更新</span>'; } catch(e){}
try { syncSetAva(); } catch(e){}

paintQuote();
renderContinue();
renderHomeFriends();
jsonldBase();
/* ---------- 从关系图谱带书名跳进来：index.html?q=书名 → 自动到书库搜索 ---------- */
(function(){
  try{
    var m = String(location.search || '').match(/[?&]q=([^&]*)/);
    if (!m) return;
    var q = decodeURIComponent(m[1].replace(/\+/g, ' '));
    if (!q) return;
    var sb = document.getElementById('search'); if (sb) sb.value = q;
    if (location.hash !== '#browse') location.hash = 'browse';
    /* 等结果渲染：若恰好只有一条命中，直接打开它的详情页（有原文就能点「📖 开始阅读」） */
    setTimeout(function(){
      try{
        var low = q.toLowerCase();
        var hits = RES.filter(function(r){ return haystack(r).indexOf(low) >= 0; });
        if (hits.length === 1){ var i = RES.indexOf(hits[0]); if (i >= 0) openItemDetail(i); }
      }catch(e){}
    }, 320);
  }catch(e){}
})();
route();

window.addEventListener('scroll', updateToTop, { passive:true });
document.getElementById('drawer').addEventListener('scroll', updateToTop, { passive:true });

/* ---------- PWA：注册 Service Worker ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  if (window.AndroidApp) {
    /* App 内：本地资源由 App 自己（shouldInterceptRequest）提供，WebView 的 Service
       Worker 拦截不到这些请求，留着只会把页面拖成白屏 —— 主动注销。
       「本地站点」在 App 内走 App 的本地主机，不依赖 SW。 */
    try { navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {}); } catch(e){}
  } else {
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => {
    /* updateViaCache:'none' —— 让浏览器始终绕过 HTTP 缓存校验 sw.js，避免被冻结在旧版本 */
    navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {});
  });
  /* 新 worker 接管后刷新一次，避免"旧页面 + 新资源"版本错配（仅当此前已有 SW 时才刷新） */
  let __swReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || __swReloaded) return;
    __swReloaded = true; location.reload();
  });
  }
}

/* ---------- 访问统计（可选）：填了 goatcounter 才加载 ---------- */
if (CFG.goatcounter) {
  const s = document.createElement('script'); s.async = true; s.dataset.goatcounter = CFG.goatcounter; s.src = 'https://gc.zgo.at/count.js'; document.body.appendChild(s);
}


/* =====================================================================
   图书馆 —— 仅作介绍（本站为本地 / 离线应用，不提供任何外部跳转）
   ===================================================================== */
function getDefaultLib(){ return localStorage.getItem('defaultLib') || CFG.defaultLibrary || 'zlib'; }
function libsHTML(){
  /* 只作介绍：列出各图书馆的定位与收录范围，不提供任何跳转（本站为本地 / 离线应用）。 */
  return `<p class="sub" style="margin-top:0;line-height:1.75">以下是常见的<b>第三方图书馆 / 书库</b>，本站仅作<b>介绍与索引</b>——<b>不提供跳转</b>，也不会替你打开它们。想找书时，请自行在浏览器里搜索下面这些名称。</p>` +
    LIBS.map(l => {
      return `<div class="lcard"><span class="li">🏛️</span>
      <div style="flex:1"><div class="pname">${escAttr(l.name)}</div>
      <div class="prole">${escAttr(l.tag || '')}${l.tag && l.note ? ' · ' : ''}${escAttr(l.note || '')}</div></div></div>`;
    }).join('') +
    `<p style="margin-top:14px;font-size:.72rem;opacity:.55">本站不存放文件本体，也不代理下载；上列各站均为第三方，内容与其可用性由各自负责。</p>`;
}

/* =====================================================================
   关系图谱 —— 独立页面（graph.html）
   点击「关系图谱」直接跳转到图谱页，不再弹出中间层
   ===================================================================== */
function openGraph(){ location.href = 'graph.html'; }

/* ---------- 导出位置（App 内可自选文件夹，零权限） ---------- */
function chooseExportDir(){
  try {
    if (window.AndroidApp && typeof AndroidApp.chooseExportDir === 'function'){
      toast('正在打开系统文件夹选择器…');
      AndroidApp.chooseExportDir();
      setTimeout(function(){ try{ refreshExportDir(); }catch(e){} }, 1200);
      return;
    }
  } catch(e){}
  toast(window.AndroidApp ? '当前版本不支持自选导出文件夹（请更新 App）'
                          : '网页版由浏览器决定下载位置，可在浏览器设置里更改');
}
function refreshExportDir(){
  var n = document.getElementById('expDirNote');
  var has = false, label = '';
  try {
    if (window.AndroidApp){
      if (typeof AndroidApp.hasExportDir === 'function') has = !!AndroidApp.hasExportDir();
      if (AndroidApp.exportDirLabel) label = String(AndroidApp.exportDirLabel() || '');
    }
  } catch(e){}
  if (n) n.textContent = has
    ? ('当前导出到：' + (label || '你选择的文件夹') + '。导出的文件一定能在文件管理器中找到；导出完成后可直接「用其他应用打开」。')
    : '当前导出到：系统「下载」（媒体库）。若在文件管理器里找不到，建议点「选择文件夹…」指定一个文件夹——无需任何权限，之后导出都存那里。';
}
window.chooseExportDir = chooseExportDir; window.refreshExportDir = refreshExportDir;
try { refreshExportDir(); } catch(e){}

/* ---------- 歌曲 / 影像 / 有声：在线检索 ---------- */
function cardAction(idx){ openItemDetail(idx); return false; }   /* 点卡片只看站内详情，不跳站外 */

/* 自助编辑：初始化设置页开关状态 */
try { syncSelfEditSwitch(); } catch(e){}

/* 启动：数据装配完成后统一净化一次（覆盖层每次合并后也会再调一次） */
try { window.yzCleanData(); } catch (e) {}
try { albumBoot(); } catch(e){}

/* 本机存储自检（见 storageSelfTest）：不可用时明确告知，别让用户以为保存成功 */
try { if (!storageSelfTest()) setTimeout(function(){ try { toast('本机存储不可用：阅读进度、书签、主题等设置可能在重启后丢失'); } catch(e){} }, 3200); } catch(e){}
