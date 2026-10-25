#!/usr/bin/env node
/* =====================================================================
   学通 · 世界图谱事件节点补充（幂等）
   世界图谱原由 tools/gen_world_graph.js 从主图谱生成，该脚本在源码快照中缺失，
   故本脚本用于「只往世界图谱追加事件节点」——主图谱 / 2D 图谱不受影响。
   用法：node tools/add_world_events.js
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'graph-world.js');

/* 13 件与「反修防修」相关的事件，仅入世界图谱 */
const EVENTS = [
  {
    id: 'ev_poznan', name: '波兹南事件', years: '1956', role: '波兰工人抗议 · 波匈事件之一',
    desc: '1956 年 6 月 28 日，波兰波兹南采盖尔斯基机车车辆厂工人因工资与税收问题上街，示威扩大到全城，与军警冲突，数十人死亡。事件暴露了照搬苏联模式造成的经济与政治矛盾，推动哥穆尔卡于当年 10 月复出主持波兰统一工人党，也加深了各社会主义国家对苏联模式的反思。',
    points: ['起因是工资、税收与劳动定额问题', '示威扩大为全城抗议，遭武力压制', '推动哥穆尔卡复出与波兰「十月转变」', '与匈牙利事件并称 1956 年波匈事件'],
    tags: ['波兹南事件', '1956', '波兰', '波匈事件'],
    place: '波兰·波兹南', geo: [16.93, 52.41],
    source: '《国际共产主义运动史》', sourceLevel: 'collection',
    links: [['cpsu', '苏波冲突']]
  },
  {
    id: 'ev_1957_moscow', name: '1957 年莫斯科会议', years: '1957', role: '社会主义国家与各国共产党的联合会议',
    desc: '1957 年 11 月，12 个社会主义国家共产党和工人党代表会议与 64 个共产党和工人党代表会议在莫斯科先后举行，通过《社会主义国家共产党和工人党代表会议宣言》（莫斯科宣言）与《和平宣言》。宣言肯定十月革命道路的普遍意义，同时提出各国可依本国条件决定具体道路，是中苏在分歧中暂时达成妥协的产物。',
    points: ['12 个社会主义国家党＋64 个共产党工人党参加', '通过《莫斯科宣言》《和平宣言》', '肯定十月革命道路的普遍性，承认各国道路的特殊性', '中苏分歧被暂时搁置'],
    tags: ['莫斯科会议', '1957', '莫斯科宣言'],
    place: '苏联·莫斯科', geo: [37.62, 55.75],
    source: '《关于国际共产主义运动总路线的论战》', sourceLevel: 'collection',
    links: [['cpsu', '主办'], ['ccp', '与会'], ['ev_20congress', '延续']]
  },
  {
    id: 'ev_1960_bucharest', name: '布加勒斯特会议', years: '1960', role: '赫鲁晓夫组织对中共的突然围攻',
    desc: '1960 年 6 月，罗马尼亚工人党第三次代表大会期间，赫鲁晓夫借各国党代表聚会之机，散发《苏共中央致中共中央的通知书》，组织对中共中央代表团的围攻，指责中共「教条主义」「冒险主义」。中共代表团（彭真）发表声明予以驳斥。会议未形成决议，但中苏分歧由内部争论转为公开冲突。',
    points: ['借罗党三大之机突然发难', '散发苏共中央通知书，组织围攻中共代表团', '中共代表团当场声明驳斥', '中苏分歧由内部转向公开'],
    tags: ['布加勒斯特会议', '1960', '中苏分歧'],
    place: '罗马尼亚·布加勒斯特', geo: [26.10, 44.43],
    source: '《关于国际共产主义运动总路线的论战》', sourceLevel: 'collection',
    links: [['cpsu', '组织围攻'], ['ccp', '被围攻']]
  },
  {
    id: 'ev_1960_moscow81', name: '1960 年莫斯科会议', years: '1960', role: '81 国共产党和工人党代表会议',
    desc: '1960 年 11 月，81 个共产党和工人党代表会议在莫斯科举行，通过《各国共产党和工人党代表会议声明》（莫斯科声明）。声明对苏共二十大与和平过渡问题作了折中表述，申明反对修正主义也反对教条主义。会议期间中苏争论激烈，最终以妥协收场，但双方分歧并未解决。',
    points: ['81 个共产党和工人党参加', '通过《莫斯科声明》，对和平过渡作折中表述', '同时申明反对修正主义与教条主义', '争论激烈，妥协收场而分歧未解'],
    tags: ['莫斯科会议', '1960', '莫斯科声明'],
    place: '苏联·莫斯科', geo: [37.62, 55.75],
    source: '《关于国际共产主义运动总路线的论战》', sourceLevel: 'collection',
    links: [['cpsu', '主办'], ['ccp', '与会'], ['ev_1960_bucharest', '延续']]
  },
  {
    id: 'ev_two_articles', name: '《论无产阶级专政的历史经验》两文发表', years: '1956', role: '中共对苏共二十大的公开回应',
    desc: '1956 年 4 月 5 日，《人民日报》以编辑部文章形式发表《关于无产阶级专政的历史经验》；同年 12 月 29 日发表《再论无产阶级专政的历史经验》。两文肯定苏共二十大反对个人崇拜的举措，同时提出对斯大林应「三七开」评价，强调无产阶级专政与十月革命道路的普遍意义，明确反对全盘否定斯大林，是对现代修正主义的最早系统回应。',
    points: ['1956.4《关于无产阶级专政的历史经验》', '1956.12《再论无产阶级专政的历史经验》', '斯大林「三七开」：功绩是主要的，错误是次要的', '坚持十月革命道路的普遍意义'],
    tags: ['两论', '1956', '斯大林', '反修'],
    place: '中国·北京', geo: [116.4, 39.9],
    source: '《人民日报》1956 年 4 月 5 日、12 月 29 日', sourceLevel: 'primary',
    links: [['ccp', '发表'], ['ev_20congress', '回应'], ['stalin', '评价'], ['revisionism', '批判']]
  },
  {
    id: 'ev_cpsu22', name: '苏共二十二大', years: '1961', role: '「三和两全」系统化 · 再次批判斯大林',
    desc: '1961 年 10 月苏共第二十二次代表大会召开，通过新党纲，宣布苏联二十年内建成共产主义，系统提出「全民国家」「全民党」理论；会上再次批判斯大林（其遗体迁出列宁墓），并公开攻击阿尔巴尼亚劳动党。中共代表团团长周恩来中途退场、提前回国，中苏关系进一步恶化。',
    points: ['通过新党纲，宣称二十年内建成共产主义', '系统提出「全民国家」「全民党」', '再次批判斯大林，遗体迁出列宁墓', '公开攻击阿尔巴尼亚劳动党，周恩来提前回国'],
    tags: ['苏共二十二大', '1961', '三和两全', '全民国家'],
    place: '苏联·莫斯科', geo: [37.62, 55.75],
    source: '《关于国际共产主义运动总路线的论战》', sourceLevel: 'collection',
    links: [['cpsu', '召开'], ['hoxha', '攻击阿尔巴尼亚劳动党'], ['stalin', '再次批判'], ['ev_20congress', '延续']]
  },
  {
    id: 'ev_sino_soviet_polemic', name: '中苏大论战', years: '1963—1964', role: '国际共运总路线之争',
    desc: '1963 年 7 月，中苏两党在莫斯科举行会谈，未达成一致。此后双方以公开信与评论文章的形式展开全面论战：中共自 1963 年 9 月起连续发表九篇评论苏共中央公开信的文章（「九评」），苏共则发表公开信、决议与大量文章。争论涉及和平过渡、和平共处、全民国家、斯大林评价、反对个人崇拜等根本问题，实质是国际共产主义运动总路线的分歧。',
    points: ['1963.7 莫斯科两党会谈无果', '中共以「九评」系统阐述立场', '苏共以公开信与决议反击', '争点：和平过渡 / 全民国家 / 斯大林评价 / 总路线'],
    tags: ['中苏论战', '九评', '1963', '总路线'],
    place: '苏联·莫斯科', geo: [37.62, 55.75],
    source: '《关于国际共产主义运动总路线的论战》（人民出版社）', sourceLevel: 'primary',
    links: [['cpsu', '论战一方'], ['ccp', '论战一方'], ['revisionism', '批判对象'], ['ev_cpsu22', '导火索']]
  },
  {
    id: 'ev_jiuping', name: '「九评」发表', years: '1963—1964', role: '评苏共中央公开信的九篇文章',
    desc: '1963 年 9 月 6 日至 1964 年 7 月 14 日，中共中央以《人民日报》《红旗》编辑部名义连续发表九篇评论苏共中央公开信的文章：一评《苏共领导同我们分歧的由来和发展》…… 九评《关于赫鲁晓夫的假共产主义及其在世界历史上的教训》。九评系统阐述了中共对国际共运总路线、无产阶级专政、反修防修等问题的立场，是这一时期最重要的理论文献。',
    points: ['1963.9.6 一评，至 1964.7.14 九评', '第九评《关于赫鲁晓夫的假共产主义及其在世界历史上的教训》', '系统阐述无产阶级专政与反修防修', '成为后来「反修防修」的理论依据'],
    tags: ['九评', '1963', '1964', '反修防修'],
    place: '中国·北京', geo: [116.4, 39.9],
    source: '《关于国际共产主义运动总路线的论战》（人民出版社）', sourceLevel: 'primary',
    links: [['ccp', '发表'], ['cpsu', '评论对象'], ['mao', '指导'], ['maoism', '理论阐述'], ['ev_sino_soviet_polemic', '组成部分']]
  },
  {
    id: 'ev_khrushchev_out', name: '赫鲁晓夫下台', years: '1964', role: '苏共领导层变动 · 论战未止',
    desc: '1964 年 10 月 14 日，苏共中央全会解除赫鲁晓夫第一书记职务（次日解除部长会议主席职务），勃列日涅夫、柯西金分别接任。中共曾派周恩来率团赴莫斯科参加十月革命节，试探改善关系，但苏方表示对华政策不变，论战与对抗继续。',
    points: ['1964.10.14 苏共中央全会解除赫鲁晓夫职务', '勃列日涅夫任第一书记、柯西金任部长会议主席', '中共派周恩来赴苏试探，未获结果', '苏方对华政策未变，论战继续'],
    tags: ['赫鲁晓夫', '1964', '苏共'],
    place: '苏联·莫斯科', geo: [37.62, 55.75],
    source: '《国际共产主义运动史》', sourceLevel: 'collection',
    links: [['cpsu', '领导层变动'], ['ev_sino_soviet_polemic', '延续']]
  },
  {
    id: 'ev_ssjf', name: '四清运动（社会主义教育运动）', years: '1963—1966', role: '城乡社会主义教育 · 反修防修的重要一环',
    desc: '1963 年 5 月中共中央发出《关于目前农村工作中若干问题的决定（草案）》（前十条），9 月发出《关于农村社会主义教育运动中一些具体政策的规定（草案）》（后十条）；1965 年 1 月《农村社会主义教育运动中目前提出的一些问题》（二十三条）把运动统一为「四清」：清政治、清经济、清组织、清思想。城市中相应开展「五反」。运动以清经济、清政治为切入口，主旨是防止基层蜕变、防止修正主义，1966 年文革开始后逐步中止。',
    points: ['1963.5「前十条」、1963.9「后十条」', '1965.1「二十三条」统一为四清', '清政治 / 清经济 / 清组织 / 清思想', '主旨是防修防变，文革开始后中止'],
    tags: ['四清运动', '社会主义教育运动', '1963', '反修防修'],
    place: '中国·北京', geo: [116.4, 39.9],
    source: '《建国以来重要文献选编》', sourceLevel: 'primary',
    links: [['ccp', '开展'], ['mao', '决策'], ['ev_culture', '前奏']]
  },
  {
    id: 'ev_prague_invasion', name: '苏联入侵捷克斯洛伐克', years: '1968', role: '「有限主权论」的武力实践',
    desc: '1968 年 8 月 20 日夜，苏联及波兰、匈牙利、保加利亚、东德军队进入捷克斯洛伐克，终止「布拉格之春」改革。此后苏方提出「有限主权论」「社会主义大家庭论」，声称为保卫社会主义成果可以干涉他国。中共予以严厉谴责，将其视为社会帝国主义的例证。',
    points: ['1968.8.20 华约五国军队进入捷克斯洛伐克', '终止「布拉格之春」改革', '提出「有限主权论」「社会主义大家庭论」', '中共谴责为社会帝国主义'],
    tags: ['入侵捷克斯洛伐克', '1968', '有限主权论'],
    place: '捷克斯洛伐克·布拉格', geo: [14.42, 50.08],
    source: '《国际共产主义运动史》', sourceLevel: 'collection',
    links: [['cpsu', '出兵'], ['ccp', '谴责'], ['ev_prague', '终结']]
  },
  {
    id: 'ev_zhenbao', name: '珍宝岛事件', years: '1969', role: '中苏边境武装冲突 · 对抗全面化',
    desc: '1969 年 3 月，中国边防部队与苏联边防军在乌苏里江珍宝岛发生武装冲突，双方均有伤亡；同年 8 月新疆铁列克提地区再起冲突。事件使中苏由意识形态论战转入国家间军事对抗，中国随即加强战备（「备战备荒为人民」），并推动中美关系出现转机。',
    points: ['1969.3 珍宝岛武装冲突', '同年 8 月铁列克提再起冲突', '中苏由论战转入军事对抗', '推动中国加强战备与对外战略调整'],
    tags: ['珍宝岛', '1969', '中苏边境'],
    place: '中国·珍宝岛', geo: [133.90, 47.70],
    source: '《中国共产党历史》', sourceLevel: 'collection',
    links: [['ccp', '冲突方'], ['cpsu', '冲突方'], ['ev_sino_soviet_polemic', '激化']]
  },
  {
    id: 'ev_pd_theory', name: '学习无产阶级专政理论运动', years: '1974—1975', role: '限制资产阶级法权 · 反修防修的理论高潮',
    desc: '1974 年毛泽东多次谈理论问题，提出「列宁为什么说对资产阶级专政，这个问题要搞清楚」，主张限制资产阶级法权、批判「资产阶级法权思想」。1975 年 2 月《人民日报》刊出《马克思恩格斯列宁论无产阶级专政》（三十三条），全国开展学习运动；张春桥发表《论对资产阶级的全面专政》。这场运动把「反修防修」从国际论战推进到国内所有制与分配关系的讨论。',
    points: ['1974 年毛泽东关于理论问题的谈话', '1975.2 刊出「三十三条」语录', '张春桥《论对资产阶级的全面专政》', '主旨：限制资产阶级法权、防修防变'],
    tags: ['无产阶级专政理论', '1974', '1975', '资产阶级法权'],
    place: '中国·北京', geo: [116.4, 39.9],
    source: '《人民日报》1975 年 2 月 22 日', sourceLevel: 'primary',
    links: [['mao', '提出'], ['zhangchunqiao', '阐述'], ['ccp', '开展'], ['ev_jiuping', '延续']]
  }
];

function load() {
  const src = fs.readFileSync(FILE, 'utf8');
  const head = src.slice(0, src.indexOf('window.SITE_GRAPH_WORLD'));
  const body = src.slice(src.indexOf('window.SITE_GRAPH_WORLD'));
  const json = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
  return { head, G: JSON.parse(json) };
}

const { head, G } = load();
const ids = new Set(G.nodes.map(n => n.id));
let addedN = 0, addedL = 0, skipped = 0;

EVENTS.forEach(e => {
  if (ids.has(e.id)) { skipped++; return; }
  const node = {
    id: e.id, name: e.name, type: 'event', years: e.years, role: e.role,
    desc: e.desc, points: e.points, tags: e.tags, place: e.place, geo: e.geo,
    source: e.source, sourceLevel: e.sourceLevel
  };
  G.nodes.push(node); ids.add(e.id); addedN++;
  (e.links || []).forEach(([tid, rel]) => {
    if (!ids.has(tid)) { console.warn('⚠ 端点不存在，跳过关系：' + e.id + ' → ' + tid); return; }
    G.links.push({ source: e.id, target: tid, rel: rel }); addedL++;
  });
});

/* 补齐既有孤立节点的关系（幂等） */
const FIX_LINKS = [
  ['ev_india_indep', 'ev_nonaligned', '前因'],
  ['ev_india_indep', 'ev_prc', '同时代']
];
const has = (a, b) => G.links.some(l => (l.source === a && l.target === b) || (l.source === b && l.target === a));
FIX_LINKS.forEach(([a, b, rel]) => {
  if (!ids.has(a) || !ids.has(b) || has(a, b)) return;
  G.links.push({ source: a, target: b, rel: rel }); addedL++;
});

/* 一致性自检 */
const all = new Set(G.nodes.map(n => n.id));
const dangling = G.links.filter(l => !all.has(l.source) || !all.has(l.target));
const deg = {}; G.links.forEach(l => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
const isolated = G.nodes.filter(n => !deg[n.id]);
const dup = G.nodes.map(n => n.id).filter((v, i, a) => a.indexOf(v) !== i);

const out = head + 'window.SITE_GRAPH_WORLD = ' + JSON.stringify(G, null, 2) + ';\n';
fs.writeFileSync(FILE, out);

console.log('新增事件节点 ' + addedN + ' 个、关系 ' + addedL + ' 条' + (skipped ? '（已存在跳过 ' + skipped + '）' : ''));
console.log('总计：' + G.nodes.length + ' 节点 / ' + G.links.length + ' 关系');
console.log('悬空关系 ' + dangling.length + ' ｜ 孤立节点 ' + isolated.length + (isolated.length ? '（' + isolated.map(n => n.id + '=' + n.name).join(', ') + '）' : '') + ' ｜ 重复 id ' + dup.length);
if (dangling.length || dup.length) process.exitCode = 1;
