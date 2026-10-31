/* =====================================================================
   学通 · 人物速查卡「分享图」生成器（assets/sharecard.js）
   ---------------------------------------------------------------------
   用途：在 card.html（人物速查卡）里把某个人物渲染成一张深色卡片 PNG，
         直接保存到本地 / 系统「下载」。全部用原生 Canvas 2D 手绘，
         不依赖 html2canvas 等第三方库，也不联网（二维码用站内自托管的
         assets/vendor/qrcode.min.js，即 qrcode-generator）。

   对外接口（挂在 window 上）：
     window.YZShareCard.render(id) → Promise<{canvas,dataURL,blob,bytes,url,qr,...}>
     window.YZShareCard.save(id)   → 渲染并保存，返回同上（附 filename / saved）
     window.YZShareCard.mount()    → 按当前页面状态显示 / 隐藏分享按钮
     window.shareCardImg()         → 按钮 onclick 入口（含失败提示）
   生成结果会写到（供自动化验证 / 排查问题）：
     window.__lastCardBytes / __lastCardBlob / __lastCardQR / __lastCardQrDrawn
     window.__lastCardDataURL / __lastCardSaved

   依赖（按需，缺失时降级，不抛错）：
     window.SITE_GRAPH（data/graph.js）、window.SITE_CONTENT（data/content.js）、
     window.AVATAR_FILES（data/avatars.js）、window.SITE_CONFIG（data/config.js）、
     window.YZSave（assets/cite.js）、window.qrcode（assets/vendor/qrcode.min.js）

   语法基线：ES2015+（async/await 需 Chromium 55+，项目基线 WebView 为
   Chromium 74），故不使用 ?. / ?? / 可选链等 ES2020 语法。
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.SITE_CONFIG || {};
  var SITE_NAME = String(CFG.siteName || '学通');

  /* ---------------- 画布设计尺寸（逻辑像素，导出时整体放大） ---------------- */
  var W = 720, H = 1000;                 // 设计稿 720×1000（约 3:4.17，适合手机转发）
  var CB = 16;                           // 深色底衬边距（让卡片有圆角轮廓）
  var PAD = 46;                          // 卡片内边距
  var CARD_X = CB, CARD_Y = CB;
  var CARD_W = W - CB * 2, CARD_H = H - CB * 2;
  var CX = CARD_X + PAD;                 // 内容左边界 = 62
  var CR = CARD_X + CARD_W - PAD;        // 内容右边界 = 658
  var CW = CR - CX;                      // 内容宽度 = 596

  var AV_R = 66, AV_CX = CX + AV_R, AV_CY = CARD_Y + PAD + AV_R;
  var NAME_X = AV_CX + AV_R + 32, NAME_W = CR - NAME_X;

  var QR_SIZE = 148, QR_PAD = 12, QR_BOX = QR_SIZE + QR_PAD * 2;   // 172
  var QR_X = CR - QR_BOX;
  var QR_Y = CARD_Y + CARD_H - PAD - QR_BOX;
  var CONTENT_BOTTOM = QR_Y - 30;        // 正文可用区底线
  var FOOT_DIV_Y = QR_Y - 14;            // 页脚分隔线

  var LH = 31, GAP = 15;                 // 正文行高 / 条目间距
  var MAX_ITEMS = 6, MIN_ITEMS = 3, MAX_ITEM_LINES = 2;
  var QR_GEOM = null;                    // 最近一次二维码的绘制几何（设备像素，供自检/验证）

  var COL = {
    ink: '#f5ecda',          // 主文字
    sub: '#c6ae89',          // 次要文字
    faint: '#907c5c',        // 更淡的小字
    accent: '#e0aa46',       // 站点主色（暖金）
    accentDim: '#b98a3c',
    cardLine: 'rgba(224,170,70,.34)',
    innerLine: 'rgba(224,170,70,.16)',
    qrInk: '#15110a',
    qrPaper: '#f8f3e6',
    avatarBg: '#120c05'
  };

  var FONT_STACK = '"Noto Serif CJK SC","Source Han Serif SC","Songti SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",Georgia,serif';
  function font(size, weight) { return (weight || '') + ' ' + size + 'px ' + FONT_STACK; }
  function F(size) { return font(size, ''); }
  function FB(size) { return font(size, 'bold'); }

  var LABEL = { person: '人物', idea: '思想', org: '组织', event: '事件', work: '著作' };

  /* ======================= 小工具 ======================= */
  function str(x) { return x == null ? '' : String(x); }
  function esc(s) {
    return str(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function measure(ctx, t) { return ctx.measureText(str(t)).width; }

  /* 逐字换行（中文友好；同时按空格优先断行） */
  function wrapLines(ctx, text, maxW) {
    var s = str(text).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!s) return [''];
    var out = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var t = cur + ch;
      if (cur && measure(ctx, t) > maxW) { out.push(cur); cur = (ch === ' ' ? '' : ch); }
      else cur = t;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }
  /* 单行截断，超宽则末尾加省略号 */
  function ellipsize(ctx, text, maxW) {
    var s = str(text), e = '…';
    if (measure(ctx, s) <= maxW) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (measure(ctx, s.slice(0, mid) + e) <= maxW) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? s.slice(0, lo) + e : e;
  }
  /* 多行截断：最多 maxLines 行，若被砍掉则末行末尾补省略号 */
  function fitLines(ctx, text, maxW, maxLines) {
    var lines = wrapLines(ctx, text, maxW);
    if (lines.length <= maxLines) return lines;
    var cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = ellipsize(ctx, cut[maxLines - 1] + '…', maxW);
    return cut;
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  function today() {
    try { return new Date().toISOString().slice(0, 10); } catch (e) { return ''; }
  }

  /* ======================= 数据来源 ======================= */
  function nodeById(id) {
    var G = window.SITE_GRAPH || {}, nodes = G.nodes || [];
    var i;
    for (i = 0; i < nodes.length; i++) if (str(nodes[i].id) === str(id)) return nodes[i];
    for (i = 0; i < nodes.length; i++) if (str(nodes[i].name) === str(id)) return nodes[i];
    return null;
  }
  function contentOf(name) {
    var c = window.SITE_CONTENT || {};
    var lists = [c.leaders, c.comrades, c.persons, c.people];
    for (var k = 0; k < lists.length; k++) {
      var arr = lists[k];
      if (!arr || !arr.length) continue;
      for (var i = 0; i < arr.length; i++) if (str(arr[i].name) === str(name)) return arr[i];
    }
    return null;
  }
  function imgOf(n) {
    if (n && n.img) return str(n.img);
    var AV = window.AVATAR_FILES || {};
    if (!n) return '';
    return str(AV[n.id] || AV[str(n.id).replace(/_/g, '')] || '');
  }
  /* 关系网 → 文本行（“挚友 · 合作：恩格斯、列斯纳”） */
  function relLines(id) {
    var G = window.SITE_GRAPH || {}, P = {}, groups = {}, order = [];
    (G.nodes || []).forEach(function (n) { P[n.id] = n; });
    (G.links || []).forEach(function (l) {
      var other = null;
      if (l.source === id) other = l.target;
      else if (l.target === id) other = l.source;
      else return;
      if (!P[other]) return;
      var k = str(l.rel) || '关联';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(str(P[other].name));
    });
    return order.map(function (k) { return k + '：' + groups[k].slice(0, 6).join('、'); });
  }

  /* ======================= 深链与站点地址 ======================= */
  /* 本地 / 内网 / 测试地址不算线上站点地址，避免生成扫不到或无效的二维码 */
  function isLocalHost(host) {
    host = str(host).toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1') return true;
    if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
    if (/\.local$/.test(host) || /\.test$/.test(host) || /\.invalid$/.test(host)) return true;
    return false;
  }
  function siteBase() {
    var u = str(CFG.siteUrl).replace(/^\s+|\s+$/g, '');
    if (u) return u.replace(/#.*$/, '').replace(/\/+$/, '');
    /* 没有配置时，退而用当前线上地址（本地/内网地址不算） */
    try {
      var loc = window.location;
      if (/^https?:$/.test(loc.protocol) && !isLocalHost(loc.hostname)) {
        return (loc.origin + str(loc.pathname).replace(/[^/]*$/, '')).replace(/\/+$/, '');
      }
    } catch (e) {}
    return '';
  }
  function deepLink(id) {
    var b = siteBase();
    if (!b) return '';
    return b + '/graph.html#' + encodeURIComponent(id);
  }
  function hostOf(u) {
    var s = str(u).replace(/^https?:\/\//i, '');
    return s;
  }

  /* ======================= 卡片数据模型 ======================= */
  function buildModel(id) {
    var n = nodeById(id);
    if (!n) throw new Error('没找到人物「' + str(id) + '」（数据里没有这个 id）');
    var ci = contentOf(n.name) || {};
    var points = [];
    if (n.points && n.points.length) points = n.points.slice(0);
    else if (ci.points && ci.points.length) points = ci.points.slice(0);

    var items = [], i;
    for (i = 0; i < points.length && items.length < MAX_ITEMS; i++) items.push({ kind: 'point', text: str(points[i]) });
    /* 要点不足 6 条时，用主要关系补足（规格：3–6 条要点或主要关系），既补全信息也避免下半区留白 */
    var rels = relLines(n.id);
    for (i = 0; i < rels.length && items.length < MAX_ITEMS; i++) items.push({ kind: 'rel', text: rels[i] });
    if (!items.length && n.desc) items.push({ kind: 'point', text: str(n.desc) });

    var role = str(n.role) || str(ci.role);
    var desc = str(n.desc) || str(ci.intro) || str(ci.desc);
    var title = str(n.name) || str(id);
    var works = n.works || ci.works || '';
    if (works && works.length && typeof works.join === 'function') works = works.join('、');
    return {
      id: str(n.id), name: title, years: str(n.years), role: role, desc: desc,
      typeLabel: LABEL[n.type] || str(n.type) || '人物',
      img: imgOf(n), items: items, url: deepLink(n.id), works: str(works)
    };
  }

  /* ======================= 版式规划 ======================= */
  function planItems(ctx, items, topY, bottomY, maxW) {
    var y = topY, blocks = [], trunc = false, i;
    for (i = 0; i < items.length; i++) {
      if (blocks.length >= MAX_ITEMS) { trunc = true; break; }
      var ls = fitLines(ctx, items[i].text, maxW, MAX_ITEM_LINES);
      var need = ls.length * LH;
      if (y + need - LH > bottomY) { trunc = true; break; }
      blocks.push({ kind: items[i].kind, lines: ls, y: y });
      y += need + GAP;
    }
    if (trunc && blocks.length) {
      var b = blocks[blocks.length - 1], li = b.lines.length - 1, lt = b.lines[li];
      if (lt.charAt(lt.length - 1) !== '…') {
        b.lines[li] = measure(ctx, lt + '…') <= maxW ? lt + '…' : ellipsize(ctx, lt, maxW);
      }
    }
    return { blocks: blocks, truncated: trunc };
  }

  /* 版式留白优化：条目之间可随剩余空间略微拉开，避免底部大片空白 */
  function distributeBlocks(blocks, bottom, maxExtra) {
    if (blocks.length < 2) return;
    var last = blocks[blocks.length - 1];
    var end = last.y + (last.lines.length - 1) * LH;
    var spare = bottom - end;
    if (spare <= 0) return;
    var extra = Math.floor(Math.min(spare / (blocks.length - 1), maxExtra));
    if (extra <= 0) return;
    for (var i = 1; i < blocks.length; i++) blocks[i].y += extra * i;
  }

  function plan(ctx, m, useIntro, useWorks) {
    var out = {};
    var roleText = m.role || m.desc || '';
    var introText = (m.role && useIntro) ? (m.desc || '') : '';

    out.nameBase = CARD_Y + PAD + 46;
    out.metaBase = out.nameBase + 36;
    out.roleBase = out.metaBase + 34;

    ctx.font = F(21);
    out.roleLines = roleText ? fitLines(ctx, roleText, NAME_W, 2) : [];
    var avBottom = CARD_Y + PAD + AV_R * 2;
    var blockBottom = out.roleBase + Math.max(0, out.roleLines.length - 1) * 27 + 6;
    out.headerBottom = Math.max(avBottom, blockBottom);
    out.divY = out.headerBottom + 22;

    var y = out.divY + 38;
    out.introLines = [];
    if (introText) {
      ctx.font = F(22);
      out.introLines = fitLines(ctx, introText, CW, 2);
      if (out.introLines.length === 1 && out.introLines[0] === '') out.introLines = [];
      y += Math.max(0, out.introLines.length - 1) * 33;
    }
    out.introBase = out.divY + 38;
    out.titleBase = y + 52;
    out.bulletsTop = out.titleBase + 40;

    out.hasRel = false;
    for (var i = 0; i < m.items.length; i++) if (m.items[i].kind === 'rel') out.hasRel = true;
    out.title = out.hasRel ? '要点与关系' : '要点';

    /* 代表文献（可选，压在页脚分割线上方，用来平衡下半区留白） */
    out.works = (useWorks !== false && m.works) ? ('代表文献：' + m.works) : '';
    out.worksBase = FOOT_DIV_Y - 18;
    out.bulletBottom = out.works ? (out.worksBase - 26) : CONTENT_BOTTOM;

    ctx.font = F(23);
    var p = planItems(ctx, m.items, out.bulletsTop, out.bulletBottom, CW - 30);
    out.blocks = p.blocks; out.truncated = p.truncated;
    distributeBlocks(out.blocks, out.bulletBottom, 26);
    return out;
  }

  /* ======================= 图片加载 ======================= */
  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 6000);
      var im = new Image();
      im.onload = function () { if (!done) { done = true; clearTimeout(timer); resolve(im); } };
      im.onerror = function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } };
      try { im.src = src; } catch (e) { clearTimeout(timer); resolve(null); }
    });
  }

  /* ======================= 绘制 ======================= */
  function paintBackground(ctx) {
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0e0903'); bg.addColorStop(1, '#1c1307');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    /* 卡片本体（圆角 + 阴影 + 主色描边） */
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
    roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 30);
    var g = ctx.createLinearGradient(CARD_X, CARD_Y, CARD_X + CARD_W, CARD_Y + CARD_H);
    g.addColorStop(0, '#261b0d'); g.addColorStop(.55, '#1d1509'); g.addColorStop(1, '#2c2010');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();

    roundRect(ctx, CARD_X + .75, CARD_Y + .75, CARD_W - 1.5, CARD_H - 1.5, 30);
    ctx.lineWidth = 1.5; ctx.strokeStyle = COL.cardLine; ctx.stroke();

    /* 顶部主色光晕 */
    ctx.save();
    roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 30); ctx.clip();
    var gl = ctx.createLinearGradient(0, CARD_Y, 0, CARD_Y + 230);
    gl.addColorStop(0, 'rgba(224,170,70,.16)'); gl.addColorStop(1, 'rgba(224,170,70,0)');
    ctx.fillStyle = gl; ctx.fillRect(CARD_X, CARD_Y, CARD_W, 230);
    ctx.restore();
  }

  function paintAvatar(ctx, m, avImg) {
    ctx.save();
    ctx.beginPath(); ctx.arc(AV_CX, AV_CY, AV_R, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = COL.avatarBg; ctx.fill();
    ctx.clip();
    if (avImg) {
      var iw = avImg.naturalWidth || avImg.width, ih = avImg.naturalHeight || avImg.height;
      var sq = Math.min(iw, ih);
      try {
        ctx.drawImage(avImg, (iw - sq) / 2, (ih - sq) / 2, sq, sq,
          AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
      } catch (e) { avImg = null; }
    }
    if (!avImg) {
      /* 无头像：暖色渐变圆 + 姓名首字（比 emoji 更稳，不依赖 emoji 字体） */
      var rg = ctx.createRadialGradient(AV_CX - 22, AV_CY - 26, 6, AV_CX, AV_CY, AV_R);
      rg.addColorStop(0, '#4c3514'); rg.addColorStop(1, '#241708');
      ctx.fillStyle = rg; ctx.fillRect(AV_CX - AV_R, AV_CY - AV_R, AV_R * 2, AV_R * 2);
      var ch = str(m.name).slice(0, 1) || '？';
      ctx.fillStyle = COL.accent; ctx.font = FB(64);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ch, AV_CX, AV_CY + 3);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(AV_CX, AV_CY, AV_R + 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = COL.accent; ctx.stroke();
  }

  function paintQR(ctx, url, S) {
    var qr, n;
    try {
      if (!window.qrcode) return false;
      if (!url) return false;
      qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      n = qr.getModuleCount();
      if (!n) return false;
    } catch (e) { return false; }

    ctx.save();
    roundRect(ctx, QR_X, QR_Y, QR_BOX, QR_BOX, 16);
    ctx.fillStyle = COL.qrPaper; ctx.fill();
    ctx.restore();

    /* 用设备像素整数格绘制，并在白色纸面内居中（四周留出等宽空白区/quiet zone），
       保证手机扫码清晰不糊、不因紧贴边缘而扫不出 */
    var avail = Math.max(1, Math.floor(QR_SIZE * S));
    var cell = Math.max(1, Math.floor(avail / n));
    var total = cell * n;
    var ox = Math.round(QR_X * S + (QR_BOX * S - total) / 2);
    var oy = Math.round(QR_Y * S + (QR_BOX * S - total) / 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COL.qrInk;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      }
    }
    ctx.restore();
    QR_GEOM = {
      ox: ox, oy: oy, cell: cell, n: n, modules: total,
      box: QR_BOX, boxPx: QR_BOX * S, margin: Math.round((QR_BOX * S - total) / 2), scale: S
    };
    return true;
  }

  function paintPlaceholder(ctx) {
    ctx.save();
    roundRect(ctx, QR_X, QR_Y, QR_BOX, QR_BOX, 16);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(224,170,70,.45)';
    ctx.setLineDash([7, 7]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'center'; ctx.font = F(19); ctx.fillStyle = COL.faint;
    ctx.fillText('二维码不可用', QR_X + QR_BOX / 2, QR_Y + QR_BOX / 2 - 8);
    ctx.font = F(17);
    ctx.fillText('站点地址未配置', QR_X + QR_BOX / 2, QR_Y + QR_BOX / 2 + 22);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function paintFooter(ctx, url, qrDrawn) {
    ctx.strokeStyle = COL.innerLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX, FOOT_DIV_Y + .5); ctx.lineTo(CR, FOOT_DIV_Y + .5); ctx.stroke();

    var leftW = QR_X - 24 - CX;
    ctx.textAlign = 'left';
    if (qrDrawn) {
      ctx.font = FB(24); ctx.fillStyle = COL.accent;
      ctx.fillText('扫码查看详情', CX, QR_Y + 58);
      ctx.font = F(19); ctx.fillStyle = COL.sub;
      ctx.fillText(ellipsize(ctx, hostOf(url), leftW), CX, QR_Y + 96);
    } else {
      ctx.font = FB(22); ctx.fillStyle = COL.accentDim;
      ctx.fillText('分享链接未配置', CX, QR_Y + 58);
      ctx.font = F(19); ctx.fillStyle = COL.sub;
      ctx.fillText('在 data/config.js 填 siteUrl 即可生成二维码', CX, QR_Y + 94);
    }
    ctx.font = F(18); ctx.fillStyle = COL.faint;
    var brand = (SITE_NAME && SITE_NAME !== '学通')
      ? ('学通 · ' + SITE_NAME) : '学通';
    ctx.fillText(ellipsize(ctx, brand + ' · 人物速查卡 · ' + today(), leftW), CX, QR_Y + 138);
  }

  /* ======================= 空白检测 ======================= */
  function verifyCanvas(ctx, cv) {
    if (!cv.width || !cv.height) throw new Error('画布尺寸异常（0）');
    var xs = [], ys = [], k;
    for (k = 1; k <= 6; k++) xs.push(Math.floor(cv.width * k / 7));
    for (k = 1; k <= 8; k++) ys.push(Math.floor(cv.height * k / 9));
    var seen = {}, colors = 0, opaque = 0;
    try {
      for (var i = 0; i < xs.length; i++) {
        for (var j = 0; j < ys.length; j++) {
          var d = ctx.getImageData(xs[i], ys[j], 1, 1).data;
          if (d[3] > 0) opaque++;
          var key = d[0] + ',' + d[1] + ',' + d[2];
          if (!seen[key]) { seen[key] = 1; colors++; }
        }
      }
    } catch (e) {
      return { checked: false };  /* 取不到像素（可能被污染），交由字节数判断 */
    }
    if (opaque === 0) throw new Error('画布为空白：取不到任何像素');
    if (colors < 2) throw new Error('画布疑似空白图（取样只有一种颜色）');
    return { checked: true, colors: colors };
  }

  /* ======================= 导出 ======================= */
  function b64Bytes(dataURL) {
    try {
      var b = String(dataURL).split(',')[1] || '';
      return atob(b).length;
    } catch (e) {
      var s = String(dataURL).split(',')[1] || '', pad = 0, m = s.match(/=+$/);
      if (m) pad = m[0].length;
      return Math.floor(s.length * 3 / 4) - pad;
    }
  }
  function dataURLToBlob(dataURL) {
    var s = String(dataURL), i = s.indexOf(',');
    var mime = (s.slice(0, i).match(/^data:([^;]+)/) || [0, 'image/png'])[1];
    var bin = atob(s.slice(i + 1)), n = bin.length, arr = new Uint8Array(n);
    for (var k = 0; k < n; k++) arr[k] = bin.charCodeAt(k);
    return new Blob([arr], { type: mime });
  }

  /* ======================= 主渲染 ======================= */
  async function render(id) {
    var m = buildModel(id);

    /* 字体就绪（不支持则忽略） */
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (e) {}

    var dpr = Number(window.devicePixelRatio) || 1;
    if (!isFinite(dpr) || dpr <= 0) dpr = 1;
    var S = Math.max(2, dpr);                       /* 至少 ×2，保证手机清晰 */

    var cv = document.createElement('canvas');
    cv.width = Math.round(W * S);
    cv.height = Math.round(H * S);
    var ctx = cv.getContext('2d');
    if (!ctx) throw new Error('当前环境不支持 Canvas 2D');
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    var avImg = await loadImage(m.img);

    /* 背景 */
    paintBackground(ctx);

    /* 版式：先按「简介 + 要点 + 代表文献」排；若正文不足 3 条，
       依次尝试「去掉简介」「再去掉代表文献」，保证要点/关系不少于 3 条 */
    var lay = plan(ctx, m, true, true);
    if (lay.blocks.length < MIN_ITEMS) {
      var alt1 = plan(ctx, m, false, true);
      if (alt1.blocks.length > lay.blocks.length) lay = alt1;
    }
    if (lay.blocks.length < MIN_ITEMS) {
      var alt2 = plan(ctx, m, false, false);
      if (alt2.blocks.length > lay.blocks.length) lay = alt2;
    }

    /* 头像 */
    paintAvatar(ctx, m, avImg);

    /* 姓名 / 生卒年·类型 / 身份 */
    ctx.fillStyle = COL.ink; ctx.font = FB(44);
    ctx.fillText(ellipsize(ctx, m.name, NAME_W), NAME_X, lay.nameBase);

    var meta = [];
    if (m.years) meta.push(m.years);
    if (m.typeLabel) meta.push(m.typeLabel);
    if (meta.length) {
      ctx.font = F(23); ctx.fillStyle = COL.accentDim;
      ctx.fillText(ellipsize(ctx, meta.join(' · '), NAME_W), NAME_X, lay.metaBase);
    }
    ctx.font = F(21); ctx.fillStyle = COL.sub;
    for (var i = 0; i < lay.roleLines.length; i++) {
      ctx.fillText(lay.roleLines[i], NAME_X, lay.roleBase + i * 27);
    }

    /* 分隔线 */
    ctx.strokeStyle = COL.innerLine; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CX, lay.divY + .5); ctx.lineTo(CR, lay.divY + .5); ctx.stroke();

    /* 简介 */
    if (lay.introLines.length) {
      ctx.font = F(22); ctx.fillStyle = COL.sub;
      for (var j = 0; j < lay.introLines.length; j++) {
        ctx.fillText(lay.introLines[j], CX, lay.introBase + j * 33);
      }
    }

    /* 章节标题（主色竖条点缀） */
    ctx.fillStyle = COL.accent;
    ctx.fillRect(CX, lay.titleBase - 18, 4, 21);
    ctx.font = FB(24); ctx.fillText(lay.title, CX + 16, lay.titleBase);

    /* 要点 / 关系 */
    for (var b = 0; b < lay.blocks.length; b++) {
      var blk = lay.blocks[b], y = blk.y;
      ctx.fillStyle = blk.kind === 'rel' ? COL.accentDim : COL.accent;
      ctx.beginPath(); ctx.arc(CX + 8, y - 8, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = F(23);
      ctx.fillStyle = blk.kind === 'rel' ? COL.sub : COL.ink;
      for (var l = 0; l < blk.lines.length; l++) ctx.fillText(blk.lines[l], CX + 28, y + l * LH);
    }

    /* 代表文献（单行，超宽截断） */
    if (lay.works) {
      ctx.font = F(20); ctx.fillStyle = COL.faint;
      ctx.fillText(ellipsize(ctx, lay.works, CW), CX, lay.worksBase);
    }

    /* 页脚 + 二维码 */
    QR_GEOM = null;
    var qrDrawn = paintQR(ctx, m.url, S);
    if (!qrDrawn) paintPlaceholder(ctx);
    paintFooter(ctx, m.url, qrDrawn);

    /* 导出 PNG */
    var dataURL;
    try { dataURL = cv.toDataURL('image/png'); }
    catch (e) { throw new Error('画布导出失败（可能被跨域图片污染）：' + (e && e.message ? e.message : e)); }
    if (!dataURL || dataURL.indexOf('data:image/png') !== 0) throw new Error('画布导出失败：未取得 PNG 数据');

    var bytes = b64Bytes(dataURL);
    if (!bytes || bytes < 1024) throw new Error('导出图像过小（' + bytes + ' 字节），疑似空白图');
    verifyCanvas(ctx, cv);

    var blob = null;
    try { blob = dataURLToBlob(dataURL); } catch (e) { blob = null; }

    window.__lastCardBytes = bytes;
    window.__lastCardBlob = blob;
    window.__lastCardDataURL = dataURL;
    window.__lastCardQR = m.url;
    window.__lastCardQrDrawn = !!qrDrawn;
    /* 测试可观测性（tools/verify_sharecard.mjs 依赖，只读、无行为影响） */
    window.__lastCardScale = S;
    window.__lastCardQrGeom = QR_GEOM;

    return {
      id: m.id, name: m.name, canvas: cv, dataURL: dataURL, blob: blob,
      bytes: bytes, url: m.url, qr: !!qrDrawn, qrGeom: QR_GEOM, scale: S, model: m
    };
  }

  /* ======================= 保存 ======================= */
  function safeName(s) {
    return str(s).replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40) || 'person';
  }
  function downloadBlob(filename, blob, dataURL) {
    try {
      var b = blob || (dataURL ? dataURLToBlob(dataURL) : null);
      if (!b) return false;
      var url = URL.createObjectURL(b);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      a.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 2000);
      return true;
    } catch (e) { return false; }
  }

  async function save(id) {
    var r = await render(id);
    var fname = 'yuanziyuan-card-' + safeName(r.id) + '-' + (today() || 'card') + '.png';
    var ok = false;
    /* App 内 WebView：YZSave → AndroidApp.saveBase64 存到系统「下载」 */
    if (window.YZSave && typeof window.YZSave.url === 'function') {
      try { ok = !!((window.AndroidApp && window.YZSave.openURL) ? window.YZSave.openURL(fname, r.dataURL) : window.YZSave.url(fname, r.dataURL)); } catch (e) { ok = false; }
      if (!ok && typeof window.YZSave.base64 === 'function') {
        try { ok = !!window.YZSave.base64(fname, 'image/png', String(r.dataURL).split(',')[1] || ''); } catch (e) { ok = false; }
      }
    }
    /* 网页端兜底：Blob + <a download> */
    if (!ok) ok = downloadBlob(fname, r.blob, r.dataURL);
    if (!ok) throw new Error('保存失败：浏览器拒绝了下载（可长按图片另存为）');
    r.saved = true; r.filename = fname;
    window.__lastCardSaved = true;
    return r;
  }

  /* ======================= 页面按钮 ======================= */
  function currentId() {
    if (window.__id) return str(window.__id);
    try {
      var q = String(window.location.search || '');
      var m = q.match(/[?&]id=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
      var h = String(window.location.hash || '').replace(/^#\/?g?\/?/, '').replace(/^#/, '');
      if (h) return decodeURIComponent(h);
    } catch (e) {}
    return '';
  }
  function tip(msg, isErr) {
    try {
      var el = document.getElementById('shareTip');
      if (!el) {
        el = document.createElement('span');
        el.id = 'shareTip';
        el.style.cssText = 'font-size:.72rem;color:#6b5c48';
        var btn = document.getElementById('shareBtn');
        if (btn && btn.parentNode) btn.parentNode.insertBefore(el, btn.nextSibling);
        else document.body.appendChild(el);
      }
      el.style.color = isErr ? '#a3381f' : '#6b5c48';
      el.innerHTML = esc(msg);   /* 统一转义后再插入 */
    } catch (e) {}
  }

  window.shareCardImg = function () {
    var btn = document.getElementById('shareBtn');
    var id = currentId();
    if (!id) { tip('请先从列表里选择一位人物，再生成分享图', true); return; }
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 正在生成…'; }
    tip('正在绘制分享图…', false);
    save(id).then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = '✓ 已保存'; }
      tip((window.AndroidApp ? '已保存到系统「下载」并打开：' : '已下载：') + r.filename + '（' + Math.round(r.bytes / 1024) + ' KB）' + (r.qr ? '' : '，二维码未生成'), false);
      try { if (window.YZSave && window.YZSave.preview) window.YZSave.preview(r.filename, r.dataURL); } catch (e) {}
      setTimeout(function () { if (btn) btn.textContent = old || '📤 生成分享图'; }, 2200);
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = old || '📤 生成分享图'; }
      var msg = (err && err.message) ? err.message : str(err);
      tip('生成失败：' + msg, true);
      try { alert('生成分享图失败：' + msg); } catch (e) {}
    });
  };

  function mount() {
    var btn = document.getElementById('shareBtn');
    if (!btn) return;
    if (!currentId()) {
      btn.style.display = 'none';       /* 列表选择模式：先选人物才有卡片可分享 */
      tip('选择一位人物后即可生成分享图', false);
    } else {
      btn.style.display = '';
    }
  }

  window.YZShareCard = {
    render: render, save: save, mount: mount,
    buildModel: buildModel, deepLink: deepLink, siteBase: siteBase,
    TODAY: today(), siteName: SITE_NAME
  };
})();
