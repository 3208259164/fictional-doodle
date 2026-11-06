/* 作者名跳转回归（12 项）
   背景：书库作者写简称（卢森堡、普列汉诺夫、考茨基），人物库存全名（罗莎·卢森堡…），
        简称查不到就落到「还没有为这位作者建立人物页」——明明有页却打不开。
   本测试锁住：别名表生效、简称能跳人物页、合署名走多人分支、
            有书无页的作者显示简介、真没有的作者仍走原文案。 */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(__dirname + '/node_modules/jsdom');
const SITE = process.env.YZY_SITE ? process.env.YZY_SITE.replace(/\/?$/, '/') : (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
let html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  try { return '<script>' + fs.readFileSync(path.join(SITE, src.split('?')[0]), 'utf8') + '</script>'; } catch (e) { return ''; }
});
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://local.test/', pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}) });
    w.scrollTo = () => {};
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }
});
const w = dom.window;
const { waitData } = require('./_lazy_hook')(w, SITE);   /* 别名/简介等数据是按需注入的 */
waitData(() => {
  let fail = 0; const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x ? (' — ' + x) : '')); if (!c) fail++; };

  ok('别名表已加载', !!w.YZ_AUTHOR_ALIAS, Object.keys(w.YZ_AUTHOR_ALIAS || {}).length + ' 条');
  ok('作者简介已加载', !!w.YZ_AUTHOR_BIO, Object.keys(w.YZ_AUTHOR_BIO || {}).length + ' 条');

  /* 挂住 openContent，看最终渲染了什么 */
  let last = null; w.openContent = function (t, h) { last = { t: String(t), h: String(h) }; };
  const open = name => { last = null; try { w.openAuthor(name); } catch (e) { last = { t: 'ERR', h: e.message }; } return last || { t: '', h: '' }; };

  /* ① 简称 → 全名 → 人物页 */
  const a = open('卢森堡');
  ok('「卢森堡」跳到人物页（罗莎·卢森堡）', /罗莎·卢森堡/.test(a.t), a.t);
  const b = open('普列汉诺夫');
  ok('「普列汉诺夫」跳到人物页', /格奥尔基·普列汉诺夫/.test(b.t), b.t);
  const c = open('考茨基');
  ok('「考茨基」跳到被批判人物页', /考茨基/.test(c.t), c.t);

  /* ② 合署名 / 歧义 */
  const d = open('马克思恩格斯');
  ok('「马克思恩格斯」走多人分支', /马克思恩格斯/.test(d.t), d.t);
  const e = open('李卜克内西');
  ok('「李卜克内西」不硬猜，列出两个人', /李卜克内西/.test(e.t) && (/威廉/.test(e.h) || /卡尔/.test(e.h)), e.t);

  /* ③ 有书无页的作者 → 显示简介 */
  const f = open('魏巍');
  ok('「魏巍」显示作者简介（不再是空白页）', /魏巍/.test(f.t) && /最可爱的人|作家/.test(f.h), f.t);
  const g = open('李达');
  ok('「李达」显示简介与身份', /李达/.test(g.t) && /哲学家/.test(g.h));
  const h2 = open('艾思奇');
  ok('「艾思奇」显示《大众哲学》', /大众哲学/.test(h2.h));

  /* ④ 真没有的作者：仍走「本站还没有…」+ 书目 */
  const i = open('某某不存在的作者');
  ok('无名作者仍有兜底文案', /还没有为这位作者建立人物页/.test(i.h));

  /* ⑤ 直名不受影响 */
  const j = open('毛泽东');
  ok('「毛泽东」直接进人物页', /毛泽东/.test(j.t), j.t);

  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
});
