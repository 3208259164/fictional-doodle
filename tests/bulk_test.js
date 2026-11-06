/* 学通 0.18.23：批量改 / 粘贴导入（史料人物、思潮组织、概念、书库） */
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
  vc.on('jsdomError', e => { const m = (e.detail ? (e.detail.message || e.detail) : e.message) || ''; if (!/Could not load img|Not implemented|Could not parse CSS|execCommand/.test(m)) errs.push(m); });
  let html = fs.readFileSync(BASE + 'index.html', 'utf8');
  html = html.replace(/<script([^>]*?)\ssrc="([^"]+)"([^>]*)><\/script>/g, (m, a, src) => {
    try { return '<script>\n' + fs.readFileSync(BASE + src, 'utf8') + '\n</' + 'script>'; } catch (e) { return ''; }
  });
  const dom = new JSDOM(html, {
    url: 'https://local.test/index.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => fakeCtx();
      w.confirm = () => true;
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
  await sleep(2200);

  ok('YZBulk 已加载', typeof w.YZBulk === 'object' && !!w.YZBulk);
  ok('四类可批量', w.YZBulk && w.YZBulk.types().length >= 4, w.YZBulk ? w.YZBulk.types().join(',') : '');

  /* ---------- 纯函数：TSV 往返 ---------- */
  const fields = [{ k: 'a', label: '甲' }, { k: 'b', label: '乙' }];
  const tsv = w.YZBulk._toTSV([{ a: '1', b: '含\t制表符' }, { a: '含,逗号', b: '带"引号"' }], fields);
  const back = w.YZBulk._parse(tsv);
  ok('TSV 往返：行数正确', back.rows.length === 3, back.rows.length + '');
  ok('TSV 往返：制表符不被拆分', back.rows[1][1] === '含\t制表符', JSON.stringify(back.rows[1]));
  ok('TSV 往返：引号还原', back.rows[2][1] === '带"引号"', JSON.stringify(back.rows[2]));
  ok('TSV 往返：逗号不被当分隔', back.rows[2][0] === '含,逗号', JSON.stringify(back.rows[2]));
  ok('自动识别 Tab 分隔', back.delim === '\t');

  /* 逗号表也能认 */
  const csv = w.YZBulk._parse('a,b\n1,2');
  ok('逗号表可解析', csv.delim === ',' && csv.rows.length === 2);

  /* 引号内换行 */
  const multi = w.YZBulk._parse('"第一行\n第二行"\tX');
  ok('引号内换行不拆行', multi.rows.length === 1 && multi.rows[0][0].indexOf('\n') > 0, JSON.stringify(multi.rows));

  /* ---------- 端到端：推荐人物新增 ---------- */
  const before = (w.SITE_CONTENT.recommend || []).length;
  w.YZBulk.open('rec');
  await sleep(60);
  ok('批量面板打开', !!d.getElementById('yzBulk'));
  ok('面板列出条目', d.querySelectorAll('#bkBody .bk-row').length > 0);

  /* 点粘贴 */
  d.querySelector('#yzBulk [data-a="paste"]').click();
  await sleep(50);
  ok('粘贴弹层出现', !!d.getElementById('yzBulkPaste'));
  const ta = d.getElementById('bkPasteTa');
  ok('粘贴框有列顺序提示', d.getElementById('yzBulkPaste').innerHTML.indexOf('名称') > 0);

  ta.value = '名称\t账号\t粉丝数\t主页链接\t介绍\n' +
    '批量测试甲\tbt_a\t1.2万\thttps://a.example\t甲的介绍\n' +
    '批量测试乙\tbt_b\t3千\thttps://b.example\t乙的介绍\n';
  d.getElementById('bkParse').click();
  await sleep(60);
  const prevHTML = d.getElementById('bkPrev').innerHTML;
  ok('解析出预览', prevHTML.indexOf('共') > 0 && prevHTML.indexOf('新增') > 0);
  ok('预览标出「新增 2」', /新增\s*<b[^>]*>2<\/b>/.test(prevHTML) || prevHTML.indexOf('>2<') > 0, prevHTML.slice(0, 200));
  ok('有确认写入按钮', !!d.getElementById('bkCommit'));

  d.getElementById('bkCommit').click();
  await sleep(200);
  const after = (w.SITE_CONTENT.recommend || []).length;
  ok('新增 2 条进了数据', after === before + 2, before + ' → ' + after);
  const names = (w.SITE_CONTENT.recommend || []).map(x => x.name);
  ok('新条目能查到', names.indexOf('批量测试甲') >= 0 && names.indexOf('批量测试乙') >= 0, names.slice(-3).join(','));
  ok('写入后弹层已关', !d.getElementById('yzBulkPaste'));

  /* ---------- 更新已有 + 空单元格不改 ---------- */
  const p0 = (w.SITE_CONTENT.recommend || []).filter(x => x.name === '批量测试甲')[0];
  const oldFans = p0.fans;
  w.YZBulk.open('rec');
  await sleep(40);
  d.querySelector('#yzBulk [data-a="paste"]').click();
  await sleep(40);
  d.getElementById('bkPasteTa').value = '名称\t账号\t粉丝数\t主页链接\t介绍\n批量测试甲\t\t9.9万\t\t\n';
  d.getElementById('bkParse').click();
  await sleep(50);
  const pv2 = d.getElementById('bkPrev').innerHTML;
  ok('识别为「更新 1」', /更新\s*<b[^>]*>1<\/b>/.test(pv2) || pv2.indexOf('更新') > 0);
  d.getElementById('bkCommit').click();
  await sleep(200);
  const p1 = (w.SITE_CONTENT.recommend || []).filter(x => x.name === '批量测试甲')[0];
  ok('粉丝数改成 9.9万', p1.fans === '9.9万', p1.fans);
  ok('空着的账号没被清空', p1.account === 'bt_a', String(p1.account));
  ok('空着的介绍没被清空', p1.intro === '甲的介绍', String(p1.intro));

  /* ---------- 有错误行则整批不写 ---------- */
  const cnt = (w.SITE_CONTENT.recommend || []).length;
  w.YZBulk.open('rec');
  await sleep(40);
  d.querySelector('#yzBulk [data-a="paste"]').click();
  await sleep(40);
  d.getElementById('bkPasteTa').value = '名称\t账号\n好的\tok\n\t没名字\n';
  d.getElementById('bkParse').click();
  await sleep(50);
  const btn = d.getElementById('bkCommit');
  ok('有错误行时按钮禁用', btn && btn.hasAttribute('disabled'));
  ok('错误行标出原因', d.getElementById('bkPrev').innerHTML.indexOf('缺少') > 0);
  await sleep(100);
  ok('脏数据一条没写进去', (w.SITE_CONTENT.recommend || []).length === cnt, cnt + ' → ' + (w.SITE_CONTENT.recommend || []).length);

  /* ---------- 思潮 / 组织 ---------- */
  w.YZBulk.open('sch');
  await sleep(60);
  ok('思潮批量可打开', !!d.getElementById('yzBulk'));
  const schRows = d.querySelectorAll('#bkBody .bk-row').length;
  ok('思潮条目列出来了', schRows > 3, schRows + ' 条');
  const tsvSch = w.YZBulk._toTSV([], [{ k: 'name', label: '名称' }]);
  ok('思潮表头正确', tsvSch === '名称');

  /* ---------- 变更日志记录了批量导入 ---------- */
  const ch = w.YZChanges.list().filter(x => x.act === 'import');
  ok('批量导入写进变更日志', ch.length >= 1, ch.length + ' 条');
  ok('变更日志带数量', ch.length && /新增\s*\d+/.test(ch[ch.length - 1].note || ''), ch.length ? ch[ch.length - 1].note : '');

  ok('全程无 JS 错误', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\n===== 批量改 / 粘贴导入 =====');
  console.log('通过 ' + pass + ' · 失败 ' + fail);
  if (bad.length) { bad.forEach(x => console.log('  ✗ ' + x)); process.exit(1); }
  process.exit(0);
})();
