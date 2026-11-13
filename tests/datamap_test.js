/* 用户数据清单回归（2026-11-13）
   背景：用户数据散在 localStorage / IndexedDB / 原生文件三处，以前没有任何一处
   能回答「我有哪些数据、存在哪、能不能带走」。datamap.js 把这份口径变成代码，
   本测试锁住：清单自洽、前缀匹配生效、未登记键能被发现、诊断摘要可读。 */
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require(__dirname + '/node_modules/jsdom');

const SITE = (process.env.YZY_SITE || path.join(__dirname, '..', 'site')).replace(/\/+$/, '') + '/';
const code = fs.readFileSync(path.join(SITE, 'assets/datamap.js'), 'utf8');

const dom = new JSDOM('<!doctype html><meta charset="utf-8"><body></body>', {
  runScripts: 'dangerously', url: 'https://local.test/', virtualConsole: new VirtualConsole(),
  beforeParse(w) {
    /* 造几条真实数据：一条普通键、两条内容包分区键、一条未登记键 */
    w.localStorage.setItem('yzExcerpts', JSON.stringify([{ t: '这是一段摘录' }]));
    w.localStorage.setItem('yzq@packA@yzq_best_mao_basic', '{"best":3}');
    w.localStorage.setItem('yzq@packB@yzq_best_n1_hard', '{"best":1}');
    w.localStorage.setItem('yzq_last_packA', '1717000000000');
    w.localStorage.setItem('someUnknownKey', 'x');
    /* 真实占用与原生目录：给出可测量的假实现，验证「量得到就说量到，量不到就说量不到」 */
    try {
      Object.defineProperty(w.navigator, 'storage', { value: { estimate: () => Promise.resolve({ usage: 12 * 1048576, quota: 200 * 1048576 }) }, configurable: true });
    } catch (e) {}
    w.AndroidApp = { bookList: () => JSON.stringify([{ id: 1 }, { id: 2 }]), mediaList: () => JSON.stringify([{ id: 'm1' }]) };
  }
});
const w = dom.window;
w.eval(code);
const D = w.YZDATAMAP;

let pass = 0, fail = 0;
const ok = (n, c, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + n + (x !== undefined ? ' — ' + x : '')); c ? pass++ : fail++; };

console.log('===== 用户数据清单 =====');
ok('清单已挂载', !!(D && D.items && D.audit));
ok('清单有版本号', D.ver >= 2, 'v' + D.ver);
ok('条目数合理（≥15 类）', D.items.length >= 15, D.items.length + ' 类');

const bad = D.items.filter(it => !it.k || !it.where || !it.ver || !it.desc);
ok('每条都有 k / where / ver / desc', bad.length === 0, bad.map(x => x.k).join(',') || 'ok');
const badWhere = D.items.filter(it => ['local', 'idb', 'native'].indexOf(it.where) < 0);
ok('where 取值合法', badWhere.length === 0, badWhere.map(x => x.k).join(',') || 'ok');

const a = D.audit();
ok('audit 能跑出结果', Array.isArray(a.items) && a.items.length === D.items.length);

const ex = a.items.filter(x => x.k === 'yzExcerpts')[0];
ok('普通键被统计到', ex && ex.present === true && ex.count === 1, ex ? (ex.count + ' 条') : '-');

const pk = a.items.filter(x => x.k === 'yzq@*')[0];
ok('分区键按前缀命中（两个包都算）', pk && pk.count === 2, pk ? (pk.count + ' 个键 / ' + pk.bytes + ' 字节') : '-');

const lp = a.items.filter(x => x.k === 'yzq_last_*')[0];
ok('最近打开时间按前缀命中', lp && lp.count === 1, lp ? lp.count + ' 个' : '-');

ok('未登记的键被发现', a.unlisted === 1, '未登记 ' + a.unlisted + ' 个');

const sum = D.summary();
ok('摘要可读且含关键信息', /数据清单 v2/.test(sum) && /未登记键 1 个/.test(sum), sum);

const f = D.find('yzq@packA@yzq_best_mao_basic');
ok('按真实键能反查归属', !!f && f.k === 'yzq@*', f ? f.k : '-');

/* 分区键必须被声明为「不随导出带走」—— 内容包进度属于包自身，不该混进用户备份 */
ok('内容包进度标记为不可导出', pk && pk.export === false);
ok('摘录标记为可导出', ex && ex.export === true);

/* ⑤ 真实占用 / 原生条目（异步） */
D.detail(function (d) {
  ok('detail 返回 estimate', !!d.estimate && d.estimate.usage > 0, d.estimate ? Math.round(d.estimate.usage / 1048576) + ' MB' : '无');
  ok('detail 统计到原生书籍条目', d.native && d.native.available && d.native.books === 2, JSON.stringify(d.native));
  ok('detail 文本含总占用与原生文件', /总占用 \d/.test(d.text) && /原生文件/.test(d.text), d.text.slice(0, 80));

  console.log('\n########## 合计：断言 ' + (pass + fail) + ' 项，失败 ' + fail);
  process.exit(fail ? 1 : 0);
});
