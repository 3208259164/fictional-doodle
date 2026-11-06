/* 学通 0.18.22 端到端：频道真能改、改完有提示、不认识类型不报错 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');
const BASE = (process.env.YZY_SITE || (process.env.YZY_SITE || require('path').join(__dirname, '..', 'site'))).replace(/\/?$/, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const bad = [];
function ok(n, c, x) { if (c) pass++; else { fail++; bad.push(n + (x ? ' — ' + x : '')); } }

function fakeCtx() { return new Proxy({}, { get(t, p) { if (p === 'measureText') return () => ({ width: 10 }); if (p === 'canvas') return { width: 1, height: 1 }; return () => {}; }, set() { return true; } }); }

(async function () {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (!/Could not load img|Not implemented|Could not parse CSS/.test(m)) errs.push(m); });
  let html = fs.readFileSync(BASE + 'index.html', 'utf8');
  html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
    try { return '<script>\n' + fs.readFileSync(BASE + src, 'utf8') + '\n</' + 'script>'; } catch (e) { return ''; }
  });
  const dom = new JSDOM(html, {
    url: 'https://local.test/index.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
      w.confirm = () => true;   // jsdom 未实现 confirm，App 里由 MainActivity.onJsConfirm 提供
      try { w.localStorage.setItem('yzy_ov_v1', JSON.stringify({ v: 3, editor: { enabled: true, userSet: true } })); } catch (e) {}
      const orig = w.document.createElement.bind(w.document);
      w.document.createElement = function (tag) {
        const el = orig(tag);
        if (String(tag).toLowerCase() === 'script') {
          let _s = '';
          try {
            Object.defineProperty(el, 'src', {
              configurable: true, get() { return _s; },
              set(v) {
                _s = v;
                setTimeout(() => {
                  try {
                    const rel = String(v).replace(/^https?:\/\/[^/]+\//, '').split('?')[0].replace(/^\.?\//, '');
                    w.eval(fs.readFileSync(BASE + rel, 'utf8'));
                    if (typeof el.onload === 'function') el.onload();
                  } catch (e) {}
                }, 0);
              }
            });
          } catch (e) {}
        }
        return el;
      };
    }
  });
  const w = dom.window, d = w.document;
  await sleep(2000);

  ok('页面已启动（render 可用）', typeof w.render === 'function');
  ok('YZChanges 已加载', typeof w.YZChanges === 'object' && !!w.YZChanges);
  ok('yzEdit 已加载', typeof w.yzEdit === 'function');

  /* ---------- 1. 频道：改一条 ---------- */
  const list0 = w.channelList();
  ok('频道有发言', list0.length > 10, list0.length + ' 条');
  const target = list0[0];
  const key = w.chanKey(target);
  const keyEnc = w.encKey(target);
  const oldText = target.text;

  w.chanEdit(keyEnc);
  await sleep(50);
  ok('点「编辑」弹出编辑框', !!d.getElementById('chanEditBox'));
  ok('编辑框带出原文', (d.getElementById('ceT') || {}).value === oldText);

  d.getElementById('ceT').value = oldText + '【本机修订】';
  d.getElementById('ceSave').click();
  await sleep(80);

  const after = w.channelList().filter(x => w.chanKey(x) === key)[0];
  ok('改完正文生效', after && after.text.indexOf('【本机修订】') >= 0, after ? after.text.slice(0, 20) : '找不到该条');
  ok('改完键不变（评论/点赞不丢）', after && w.chanKey(after) === key);
  ok('编辑框已关闭', !d.getElementById('chanEditBox'));

  const changes = w.YZChanges.list();
  ok('改动写进变更日志', changes.length >= 1);
  const last = changes[changes.length - 1];
  ok('变更日志记了正文', (last.fields || []).some(f => f.k === '正文'), JSON.stringify(last.fields || []));
  ok('变更日志带旧值', (last.fields || []).some(f => String(f.from).indexOf('本机修订') < 0 && f.to.indexOf('本机修订') >= 0));

  /* ---------- 2. 删除一条 ---------- */
  w.chanDel(keyEnc);
  await sleep(80);
  ok('删除后列表里没了', w.channelList().filter(x => w.chanKey(x) === key).length === 0);
  ok('内置数据未被破坏', (w.SITE_CHANNEL || []).some(x => w.chanKey(x) === key) === true);

  /* ---------- 3. 未知类型不再报「不支持」 ---------- */
  let threw = null;
  try { w.yzEdit('meeting', 'no-such-meeting'); } catch (e) { threw = e.message; }
  ok('未知类型调用不抛错', threw === null, threw || '');
  ok('未知类型也能开编辑框（兜底）', !!d.getElementById('yzContentEdit'));

  let meta;
  try { meta = w.YZY.setMeta('meeting:no-such-meeting', [{ k: '定位', v: '测试' }]); } catch (e) { meta = { ok: false, err: e.message }; }
  ok('setMeta 对任意类型前缀都放行', meta && meta.ok !== false, JSON.stringify(meta));
  const back = w.YZY.getMeta('meeting:no-such-meeting');
  ok('写进去能读回来', back.length === 1 && back[0].v === '测试', JSON.stringify(back));

  /* ---------- 4. 变更面板能打开 ---------- */
  w.YZChanges.openPanel();
  await sleep(50);
  const panel = d.getElementById('yzChangesPanel');
  ok('「最近的改动」面板可打开', !!panel);
  ok('面板里列出了刚才的改动', panel && panel.innerHTML.indexOf('【本机修订】') >= 0 || (panel && /正文/.test(panel.innerHTML)));

  ok('全程无 JS 错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n===== 端到端：频道可改 + 变更提示 + 类型兜底 =====');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
  process.exit(0);
})();
