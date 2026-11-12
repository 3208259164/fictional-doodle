#!/usr/bin/env node
/* =====================================================================
   学通 · 近代重要事件补充（幂等）
   ---------------------------------------------------------------------
   用户要求：「近代事件要筛选重要的，然后进史料当中。十分重要的事件世界图谱得有。」
   筛选标准（不是泛近代史，而是三条件交集）：
     ① 改变中国社会性质或革命进程的节点（不平等条约、政权更替）
     ② 马克思主义在中国传播的关键环节
     ③ 站内已有事件链上明显缺的那一环（有辛亥革命没有民国成立、有五四没有《宣言》全译本）
   落点：
     · 史料事件 → data/events-extra.js（懒加载，运行时合并并同步基线）
     · 世界图谱 → data/graph-world.js（带 geo，geo 为 [经度, 纬度]）
   用法：node tools/add_modern_events.js
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const EVENTS = [
  {
    name: '《南京条约》签订', year: '1842',
    desc: '8月29日，清政府与英国在南京下关江面的英舰上签订《南京条约》：割香港岛，赔款二千一百万银元，开放广州、厦门、福州、宁波、上海五处为通商口岸，协定关税。这是中国近代史上第一个不平等条约，中国开始由封建社会沦为半殖民地半封建社会。',
    points: ['割香港岛、赔款 2100 万银元', '五口通商：广州、厦门、福州、宁波、上海', '协定关税，丧失关税自主权', '中国近代史第一个不平等条约'],
    people: [], schools: [],
    src: '中国近代史通行教材'
  },
  {
    name: '火烧圆明园', year: '1860',
    desc: '10月，英法联军攻入北京，闯入圆明园大肆抢掠后纵火焚烧，大火三日不熄。圆明园自康熙年间起历经一百五十余年营建，汇集中西园林与大量典籍文物，至此化为废墟。同年清政府被迫签订《北京条约》。',
    points: ['英法联军抢掠后纵火，大火三日不熄', '一百五十余年营建的园林毁于一旦', '同年签订《北京条约》'],
    people: [], schools: [],
    src: '中国近代史通行教材'
  },
  {
    name: '《马关条约》签订', year: '1895',
    desc: '4月17日，清政府被迫与日本签订《马关条约》：割让台湾全岛及澎湖列岛、辽东半岛（后因三国干涉还辽），赔款二亿两白银，开放沙市、重庆、苏州、杭州为商埠，允许日本在华设厂。赔款数额与设厂权使列强对华资本输出合法化，半殖民地化程度大大加深，直接刺激了戊戌变法的发生。',
    points: ['割台湾、澎湖，赔款二亿两白银', '允许日本在华设厂，资本输出合法化', '半殖民地化程度大大加深', '直接刺激戊戌变法'],
    people: [], schools: [],
    src: '中国近代史通行教材'
  },
  {
    name: '《辛丑条约》签订', year: '1901',
    desc: '9月，清政府与十一国签订《辛丑条约》：赔款四亿五千万两白银（本息合计约九亿八千万两），划定北京东交民巷为使馆界由各国驻兵，拆毁大沽炮台，允许列强在京津沿线驻军，禁止中国人成立或加入反帝性质的组织。清政府完全成为帝国主义统治中国的工具，中国完全沦为半殖民地半封建社会。',
    points: ['赔款 4.5 亿两，本息合计约 9.8 亿两', '划东交民巷为使馆界，列强驻兵', '禁止反帝组织与活动', '中国完全沦为半殖民地半封建社会'],
    people: [], schools: [],
    src: '中国近代史通行教材'
  },
  {
    name: '中华民国成立', year: '1912',
    desc: '1月1日，孙中山在南京就任中华民国临时大总统，宣告中华民国成立，改用公历，以 1912 年为民国元年。2 月 12 日清帝溥仪退位，延续两千余年的君主专制制度结束。3 月颁布《中华民国临时约法》。辛亥革命推翻了帝制，但未改变中国半殖民地半封建的社会性质，政权随后落入袁世凯之手。',
    points: ['1912 年 1 月 1 日南京，孙中山就任临时大总统', '2 月 12 日清帝退位，帝制结束', '3 月颁布《中华民国临时约法》', '未改变半殖民地半封建社会性质'],
    people: ['孙中山'], schools: [],
    src: '中国近代史通行教材'
  },
  {
    name: '陈望道译《共产党宣言》全译本出版', year: '1920',
    desc: '8 月，陈望道据日文版并参照英文版翻译的《共产党宣言》全译本，由上海社会主义研究社出版，为《宣言》第一个中文全译本。初版印一千册，很快售罄，此后多次再版，在进步知识分子中广泛流传。此前国内只有节译与转述，全译本的出版使中国先进分子第一次能完整读到《宣言》，对建党起了直接的思想准备作用。',
    points: ['《宣言》第一个中文全译本', '陈望道据日文本并参照英文本译出', '1920 年 8 月上海社会主义研究社出版', '为建党作了直接的思想准备'],
    people: ['陈望道', '陈独秀'], schools: ['马克思主义'],
    src: '《中国共产党一百年大事记》；《陈望道文集》'
  },
  {
    name: '上海共产主义小组成立', year: '1920',
    desc: '8 月，陈独秀等在上海成立共产党早期组织（通称上海共产主义小组），推陈独秀为书记，成员有李达、李汉俊、陈望道、俞秀松等。小组创办《劳动界》周刊向工人宣传，开办外国语学社培养干部，并推动北京、武汉、长沙、济南、广州及旅日旅法等地建立同类组织。上海小组实际起了中国共产党发起组的作用。',
    points: ['1920 年 8 月在上海成立，陈独秀任书记', '创办《劳动界》周刊，办外国语学社', '推动各地建立共产党早期组织', '实际起发起组作用'],
    people: ['陈独秀', '李达', '李汉俊', '陈望道'], schools: ['马克思主义'],
    src: '《中国共产党一百年大事记》'
  }
];

const WORLD = [
  {
    id: 'ev_opium1', name: '第一次鸦片战争', type: 'event', years: '1840—1842',
    role: '中国近代史的开端',
    desc: '1840 年 6 月英国以禁烟为借口派舰队封锁珠江口，战争爆发。清军屡败，1842 年 8 月被迫签订《南京条约》。中国由此开始由封建社会沦为半殖民地半封建社会，近代中国革命反帝反封建的任务由此提出。',
    points: ['1840 年 6 月英军封锁珠江口', '1842 年《南京条约》，近代史开端', '中国开始沦为半殖民地半封建社会'],
    geo: [113.26, 23.13], place: '中国·广州',
    source: '中国近代史通行教材', sourceLevel: 'collection',
    links: [['ev_nanjing', '结果']]
  },
  {
    id: 'ev_nanjing', name: '《南京条约》签订', type: 'event', years: '1842',
    role: '中国近代第一个不平等条约',
    desc: '1842 年 8 月 29 日签订：割香港岛，赔款 2100 万银元，五口通商（广州、厦门、福州、宁波、上海），协定关税。中国丧失领土与关税自主权，社会经济结构开始被外力改造。',
    points: ['割香港岛，赔款 2100 万银元', '五口通商，协定关税', '中国近代第一个不平等条约'],
    geo: [118.80, 32.06], place: '中国·南京',
    source: '中国近代史通行教材', sourceLevel: 'collection',
    links: [['ev_opium1', '结果']]
  },
  {
    id: 'ev_jiawu', name: '甲午中日战争', type: 'event', years: '1894—1895',
    role: '洋务运动破产与民族觉醒的转折',
    desc: '1894 年日本发动侵华战争，北洋海军在黄海海战与威海卫之战中覆没。1895 年签订《马关条约》。战败暴露了洋务运动「中体西用」的局限，直接推动戊戌变法与民族意识的普遍觉醒。',
    points: ['1894 年黄海海战，北洋海军覆没', '1895 年《马关条约》', '洋务运动破产，推动戊戌变法'],
    geo: [122.10, 37.50], place: '中国·威海卫',
    source: '中国近代史通行教材', sourceLevel: 'collection',
    links: [['ev_maguan', '结果']]
  },
  {
    id: 'ev_maguan', name: '《马关条约》签订', type: 'event', years: '1895',
    role: '半殖民地化大大加深',
    desc: '1895 年 4 月 17 日签订：割台湾与澎湖，赔款二亿两白银，增开沙市、重庆、苏州、杭州为商埠，允许日本在华设厂。资本输出合法化，列强对华经济侵略由商品输出转入资本输出阶段。',
    points: ['割台湾、澎湖，赔款二亿两', '允许在华设厂，资本输出合法化', '半殖民地化大大加深'],
    geo: [130.95, 33.95], place: '日本·马关（下关）',
    source: '中国近代史通行教材', sourceLevel: 'collection',
    links: [['ev_jiawu', '结果']]
  },
  {
    id: 'ev_roc', name: '中华民国成立', type: 'event', years: '1912',
    role: '君主专制制度结束',
    desc: '1912 年 1 月 1 日孙中山在南京就任临时大总统，中华民国成立；2 月 12 日清帝退位，两千余年帝制结束；3 月颁布《中华民国临时约法》。辛亥革命推翻了帝制，但未改变半殖民地半封建社会性质，也未完成反帝反封建的任务。',
    points: ['1912 年 1 月 1 日南京', '2 月 12 日清帝退位', '《临时约法》；未改变社会性质'],
    geo: [118.80, 32.06], place: '中国·南京',
    source: '中国近代史通行教材', sourceLevel: 'collection',
    links: [['ev_xinhai', '结果']]
  },
  {
    id: 'ev_manifesto_cn', name: '《共产党宣言》中文全译本出版', type: 'event', years: '1920',
    role: '马克思主义在中国系统传播的标志',
    desc: '1920 年 8 月，陈望道翻译的《共产党宣言》全译本由上海社会主义研究社出版，为第一个中文全译本，初印一千册旋即售罄并多次再版。全译本使中国先进分子第一次能完整读到《宣言》，直接为建党作了思想准备。',
    points: ['陈望道译，1920 年 8 月上海出版', '第一个中文全译本，初印千册', '为建党作直接思想准备'],
    geo: [121.47, 31.23], place: '中国·上海',
    source: '《中国共产党一百年大事记》', sourceLevel: 'book',
    links: [['ev_may4', '思想准备'], ['ev_ccp1', '思想准备']]
  }
];

/* ---------- events-extra.js ---------- */
const EF = path.join(ROOT, 'data', 'events-extra.js');
const src = fs.readFileSync(EF, 'utf8');
/* 这个文件末尾还有「把本数组并进 SITE_EXTRA.events 并同步基线」的自合并代码，
   所以不能用 lastIndexOf(']') 截取（会连带后面的代码一起当成 JSON）。
   用括号配平（考虑字符串与转义）找出数组本身的起止位置。 */
function sliceArray(text, marker) {
  const s = text.indexOf(marker);
  const lb = text.indexOf('[', s);
  let depth = 0, inStr = false, esc = false;
  for (let i = lb; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) return { start: lb, end: i }; }
    }
  }
  return null;
}
const span = sliceArray(src, 'window.SITE_EVENTS_EXTRA');
if (!span) { console.error('找不到 SITE_EVENTS_EXTRA 数组边界'); process.exit(1); }
const head = src.slice(0, span.start);
const tail = src.slice(span.end + 1);
const arr = JSON.parse(src.slice(span.start, span.end + 1));
let eAdd = 0, eSkip = 0;
EVENTS.forEach(e => {
  if (arr.some(x => x.name === e.name)) { eSkip++; return; }
  arr.push(e); eAdd++;
});
fs.writeFileSync(EF, head + JSON.stringify(arr, null, 1) + tail);

/* ---------- graph-world.js ---------- */
const WF = path.join(ROOT, 'data', 'graph-world.js');
function loadJSON(file, gname) {
  const s = fs.readFileSync(file, 'utf8');
  const k = s.indexOf(gname);
  const body = s.slice(k);
  return { head: s.slice(0, k), G: JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) };
}
const w = loadJSON(WF, 'window.SITE_GRAPH_WORLD');
let wAdd = 0, wSkip = 0;
WORLD.forEach(n => {
  if (w.G.nodes.some(x => x.id === n.id)) { wSkip++; return; }
  const node = Object.assign({}, n); delete node.links;
  w.G.nodes.push(node); wAdd++;
});
const ids = new Set(w.G.nodes.map(x => x.id));
const wMiss = [];
WORLD.forEach(n => (n.links || []).forEach(([tid, rel]) => {
  if (!ids.has(tid)) { wMiss.push(n.id + '→' + tid); return; }
  if (w.G.links.some(l => l.source === n.id && l.target === tid)) return;
  w.G.links.push({ source: n.id, target: tid, rel: rel });
}));
fs.writeFileSync(WF, w.head + 'window.SITE_GRAPH_WORLD = ' + JSON.stringify(w.G, null, 2) + ';\n');

const w2 = loadJSON(WF, 'window.SITE_GRAPH_WORLD').G;
const ids2 = new Set(w2.nodes.map(x => x.id));
const dangling = w2.links.filter(l => !ids2.has(l.source) || !ids2.has(l.target));
const deg = {}; w2.links.forEach(l => { deg[l.source] = 1; deg[l.target] = 1; });
const iso = w2.nodes.filter(x => !deg[x.id]);
console.log('史料事件新增 ' + eAdd + ' 条' + (eSkip ? ('（跳过 ' + eSkip + '）') : '') + '，现共 ' + arr.length + ' 条');
console.log('世界图谱事件新增 ' + wAdd + ' 个' + (wSkip ? ('（跳过 ' + wSkip + '）') : '') +
  '，现 ' + w2.nodes.length + ' 节点 / ' + w2.links.length + ' 关系 ｜ 悬空 ' + dangling.length + ' ｜ 孤立 ' + iso.length);
if (wMiss.length) console.log('⚠ 端点缺失：' + wMiss.join(', '));
process.exitCode = (dangling.length || iso.length || wMiss.length) ? 1 : 0;
