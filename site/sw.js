/* 学通 Service Worker
   ------------------------------------------------------------------
   2026-10 整改要点：
   · 预缓存（SHELL）只放“应用外壳”，不再把 version.json 放进来
     （它必须每次联网取最新，缓存反而会让更新提示失效）。
   · 预缓存改为“逐个 add 容错”，避开 cache.addAll 的“全有或全无”陷阱。
   · 分资源类型缓存：图片/字体 = cache-first；CSS/JS/数据 = stale-while-revalidate；
     页面导航 = network-first（带超时，失败回退缓存，再失败回退 offline.html）。
   · sw.js 由 _headers 设定 no-cache；注册时 updateViaCache:'none'（见 app.js）。
   ------------------------------------------------------------------ */
const VERSION = 'v160';
const SHELL = 'yuanziyuan-' + VERSION;      // 应用外壳缓存
const RUNTIME = 'yuanziyuan-rt-' + VERSION; // 运行时缓存
const OFFLINE = './offline.html';

/* 预缓存清单：只放"每次都用到"的外壳。
   ⚠️ 3D 引擎（lib/3d-force-graph.min.js，约 1.35 MB）**故意不在此列**：
   它只在打开 graph3d.html 时才需要，放进预缓存会让首次访问白白多下 1.35 MB。
   它由下面的"CSS/JS 数据"分支在首次真正请求时按需缓存（stale-while-revalidate）。 */
const CORE = [
  './', './index.html', './graph.html',
  './graph3d.html', './card.html', './challenge.html', './assets/challenge.js',
  './data/graph3d.js',
  './offline.html', './404.html', './privacy.html', './licenses.html',
  './assets/style.css', './assets/extra.css', './assets/graph-hub.css', './assets/cite.js', './assets/app.js',
  './assets/overlay.js', './assets/editor.js', './assets/graph-edit.js', './assets/sharecard.js', './assets/books.js', './data/overrides.js',
  './assets/vendor/qrcode.min.js',
  './data/avatars.js', './data/config.js', './data/libraries.js', './data/graph.js', './data/graph-wenge.js', './data/graph-world.js', './data/graph-geo.js', './data/geo-china.js', './data/geo-world.js', './feed.xml', './feed.xsl',
  './data/resources.js', './data/intro-short.js', './data/content.js', './data/mentors.js', './data/album.js', './data/channel.js', './data/knowledge.js',
  './manifest.webmanifest', './favicon.svg', './avatar.svg',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-192-maskable.png', './icons/icon-512-maskable.png'
];

/* 安装：逐个预缓存，任一失败不影响整体 */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

/* 激活：清理所有旧版本缓存 */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k !== SHELL && k !== RUNTIME)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const IMG_RE = /\.(?:png|jpe?g|webp|gif|svg|ico|bmp|woff2?|ttf|otf)$/i;
const ASSET_RE = /\.(?:css|js|mjs|json|webmanifest|xml|txt|md)$/i;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 跨域交给浏览器默认行为

  /* 1) 页面导航：网络优先（3s 超时）→ 缓存 → 离线页 */
  if (req.mode === 'navigate') {
    /* 离线优先：无网时直接走缓存，不再空等网络超时（对完全离线的 App 尤其重要） */
    var offline = (self.navigator && self.navigator.onLine === false);
    var nav = offline
      ? caches.match(req).then(r => r || caches.match('./index.html'))
      : timeout(fetch(req), 3000)
          .then(res => { put(RUNTIME, req, res.clone()); return res; })
          .catch(() => caches.match(req))
          .then(r => r || caches.match('./index.html'));
    e.respondWith(nav.then(r => r || caches.match(OFFLINE)));
    return;
  }

  /* 2) 图片 / 字体：缓存优先 */
  if (IMG_RE.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => { put(RUNTIME, req, res.clone()); return res; }))
    );
    return;
  }

  /* 3) CSS / JS / 数据：先给缓存、后台更新（stale-while-revalidate） */
  if (ASSET_RE.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => { put(RUNTIME, req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  /* 4) 其余：网络优先，失败回退缓存 */
  e.respondWith(
    fetch(req).then(res => { put(RUNTIME, req, res.clone()); return res; })
      .catch(() => caches.match(req))
  );
});

function put(cacheName, req, res) {
  /* 只缓存「同源且成功（basic/ok）」的响应：避免把错误页或跨域 opaque 响应写进缓存（缓存投毒防护） */
  if (!res || !res.ok || res.type !== 'basic') return;
  caches.open(cacheName).then(c => c.put(req, res)).catch(() => {});
}
function timeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
