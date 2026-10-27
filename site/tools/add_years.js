/* 说明：本文件是工具体，与书库 firstYear 的补录分别是 tools/add_years.js（主图谱年份）
   与 tools/add_book_years.js（书库首次发表年），不要混用。 */

/* 给主图谱节点补数字型 y0/y1（供时间轴使用）。
   - person：由现成的 years 字符串（如「1818—1883」）解析，客观可核实
   - org   ：取成立年与解散/改名年（表内手写，依据各组织史实）
   - idea  ：取该思潮「标志性年份」而非严格起止，见每项 yearBasis 说明
   不覆盖已有字段，只做补充；重复执行安全。 */
const fs = require('fs'), vm = require('vm');
const P = 'data/graph.js';
const src = fs.readFileSync(P, 'utf8');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(src, ctx);
const G = ctx.window.SITE_GRAPH;

/* 组织：成立年—解散/改名年（null 表示延续至今，不写 y1） */
const ORG = {
  cpy:      { y0: 1847, y1: 1852, basis: '1847 年伦敦成立，1852 年科隆审判后解散' },
  intl1:    { y0: 1864, y1: 1876, basis: '1864 年伦敦成立，1876 年费城代表会议后停止活动' },
  commune:  { y0: 1871, y1: 1871, basis: '1871 年 3 月 28 日成立，5 月 28 日失败' },
  spd:      { y0: 1863, y1: null, basis: '1863 年全德工人联合会成立；1869 年爱森纳赫派；1875 年哥达合并' },
  intl2:    { y0: 1889, y1: 1914, basis: '1889 年巴黎成立，1914 年多数党支持战争后瓦解' },
  bolshevik:{ y0: 1903, y1: null, basis: '1903 年二大分裂形成，1918 年改名俄共（布）' },
  menshevik:{ y0: 1903, y1: 1921, basis: '1903 年形成，1921 年被取缔' },
  comintern:{ y0: 1919, y1: 1943, basis: '1919 年莫斯科成立，1943 年解散' },
  intl4:    { y0: 1938, y1: null, basis: '1938 年巴黎成立' },
  vienna:   { y0: 1921, y1: 1923, basis: '1921 年成立，1923 年并入第二国际' },
  cpsu:     { y0: 1898, y1: 1991, basis: '1898 年俄国社会民主工党成立，1912 年布拉格会议后独立，1952 年改称苏共，1991 年停止活动' },
  ccp:      { y0: 1921, y1: null, basis: '1921 年 7 月一大' },
  redarmy:  { y0: 1927, y1: 1937, basis: '1927 年建军，1937 年改编为八路军、新四军' },
  pla:      { y0: 1927, y1: null, basis: '1927 年创建，1946 年改称中国人民解放军' },
  cpv:      { y0: 1950, y1: 1958, basis: '1950 年 10 月组建，1958 年 10 月全部撤回国' }
};

/* 思潮：标志性年份（不是严格起止） */
const IDEA = {
  marxism:        { y0: 1848, y1: null, basis: '以 1848 年《共产党宣言》发表为标志' },
  socialism:      { y0: 1848, y1: null, basis: '同上；恩格斯说两大发现使之成为科学' },
  dialmat:        { y0: 1845, y1: null, basis: '以 1845 年《关于费尔巴哈的提纲》《德意志意识形态》为形成标志' },
  leninism:       { y0: 1902, y1: null, basis: '以 1902 年《怎么办？》为建党理论形成标志' },
  maoism:         { y0: 1927, y1: null, basis: '以 1927 年开辟农村包围城市道路为实践起点，1945 年七大写入党章' },
  newdemocracy:   { y0: 1940, y1: null, basis: '以 1940 年《新民主主义论》为系统化标志' },
  utopian:        { y0: 1516, y1: 1848, basis: '1516 年莫尔《乌托邦》起，至 1848 年科学社会主义形成' },
  proudhonism:    { y0: 1840, y1: 1865, basis: '1840 年《什么是所有权》起，蒲鲁东 1865 年去世后衰落' },
  lassalism:      { y0: 1863, y1: 1875, basis: '1863 年全德工人联合会起，1875 年哥达合并后被马克思批判' },
  anarchism:      { y0: 1864, y1: 1876, basis: '第一国际内斗争期（1864—1876）为主' },
  revisionism:    { y0: 1899, y1: null, basis: '以 1899 年伯恩施坦《社会主义的前提和社会民主党的任务》为标志' },
  kautskyism:     { y0: 1910, y1: 1917, basis: '1910 年前后形成中派立场，1917 年后彻底右转' },
  trotskyism:     { y0: 1905, y1: null, basis: '以 1905 年「不断革命论」提出为起点' },
  permanentrev:   { y0: 1905, y1: null, basis: '1905 年提出，1906 年《总结与展望》系统化' },
  economism:      { y0: 1897, y1: 1902, basis: '1897 年《工人思想报》创刊起，1902 年《怎么办？》批判后衰落' },
  machism:        { y0: 1886, y1: 1914, basis: '1886 年马赫《感觉的分析》起，1914 年前后影响消退' },
  syndicalism:    { y0: 1895, y1: 1920, basis: '1895 年法国总工会成立起，1920 年后衰落' }
};

let nP = 0, nO = 0, nI = 0, fail = [];
G.nodes.forEach(n => {
  if (n.type === 'person') {
    if (typeof n.y0 === 'number') return;
    const m = String(n.years || '').match(/(1[89]\d\d|20\d\d)/g);
    if (!m || m.length < 2) { fail.push(n.name + '=' + n.years); return; }
    n.y0 = +m[0]; n.y1 = +m[1]; nP++;
  } else if (n.type === 'org') {
    const o = ORG[n.id]; if (!o) { fail.push('org:' + n.id); return; }
    if (typeof n.y0 === 'number') return;
    n.y0 = o.y0; if (o.y1 !== null) n.y1 = o.y1;
    n.yearBasis = o.basis; nO++;
  } else if (n.type === 'idea') {
    const o = IDEA[n.id]; if (!o) { fail.push('idea:' + n.id); return; }
    if (typeof n.y0 === 'number') return;
    n.y0 = o.y0; if (o.y1 !== null) n.y1 = o.y1;
    n.yearBasis = o.basis; nI++;
  }
});
if (fail.length) { console.error('未处理：', fail.join(' ')); process.exit(1); }

const cut = src.lastIndexOf('window.SITE_GRAPH');
fs.writeFileSync(P, src.slice(0, cut) + 'window.SITE_GRAPH = ' + JSON.stringify(G, null, 1) + ';\n');
const withY = G.nodes.filter(n => typeof n.y0 === 'number').length;
console.log('✅ person ' + nP + ' · org ' + nO + ' · idea ' + nI + ' → 共 ' + withY + '/' + G.nodes.length + ' 节点有 y0');
console.log('   年份跨度：' + Math.min(...G.nodes.map(n => n.y0)) + ' — ' + Math.max(...G.nodes.map(n => n.y1 || n.y0)));
