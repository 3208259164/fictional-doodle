/* =====================================================================
   学通 · 主图谱落点补丁（data/graph-geo-extra.js）
   ---------------------------------------------------------------------
   为什么单独一个文件：
     data/graph-geo.js 里既有 SITE_GRAPH_GEO 也有 SITE_EVENT_GEO 的合并逻辑，
     直接改它容易踩坑；这里只做「补空的」——已有的一律不覆盖，可反复执行。

   补的是什么：
     主图谱 124 个节点里有 31 个在 graph-geo.js 里没有落点（多为元帅/大将与
     苏联、德国、意大利的理论家），地图模式下会漏人。这里按出生地补齐；
     其中彭德怀、贺龙、陈毅、徐向前、聂荣臻、叶剑英、林彪、邓小平 8 位的
     坐标与文革图谱一致，其余按籍贯城市取点（精确到城市，与全站口径相同）。

   口径：地名取出生地；跨国的用「国·城市」。
   ===================================================================== */
(function () {
  var M = {
    /* 中国：元帅 / 大将 */
    "peng_dehuai":  { place: "中国·湖南湘潭", geo: [112.53, 27.91] },
    "liu_bocheng":  { place: "中国·重庆开州", geo: [108.41, 31.17] },
    "he_long":      { place: "中国·湖南桑植", geo: [110.16, 29.40] },
    "chen_yi":      { place: "中国·四川乐至", geo: [105.03, 30.28] },
    "luo_ronghuan": { place: "中国·湖南衡山", geo: [112.87, 27.23] },
    "xu_xiangqian": { place: "中国·山西五台", geo: [113.25, 38.73] },
    "nie_rongzhen": { place: "中国·重庆江津", geo: [106.26, 29.28] },
    "ye_jianying":  { place: "中国·广东梅县", geo: [116.12, 24.29] },
    "su_yu":        { place: "中国·湖南会同", geo: [109.72, 26.88] },
    "chen_geng":    { place: "中国·湖南湘乡", geo: [112.53, 27.73] },
    "huang_kecheng":{ place: "中国·湖南永兴", geo: [113.11, 26.13] },
    "lin_biao":     { place: "中国·湖北黄冈", geo: [114.88, 30.45] },
    "deng_xiaoping":{ place: "中国·四川广安", geo: [106.63, 30.47] },
    "chen_yun":     { place: "中国·上海青浦", geo: [121.12, 31.15] },
    /* 中共早期 */
    "wang_ming":    { place: "中国·安徽六安", geo: [116.51, 31.75] },
    "bo_gu":        { place: "中国·江苏无锡", geo: [120.31, 31.57] },
    "zhang_guotao": { place: "中国·江西萍乡", geo: [113.85, 27.62] },
    "xiang_ying":   { place: "中国·湖北武昌", geo: [114.31, 30.55] },
    "ye_ting":      { place: "中国·广东惠阳", geo: [114.45, 22.79] },
    "yang_kaihui":  { place: "中国·湖南长沙", geo: [113.10, 28.20] },
    "mao_anying":   { place: "中国·湖南长沙", geo: [112.98, 28.19] },
    /* 苏联 */
    "khrushchev":   { place: "俄罗斯·库尔斯克州卡利诺夫卡", geo: [36.19, 51.73] },
    "brezhnev":     { place: "乌克兰·卡缅斯科耶", geo: [34.60, 48.51] },
    "plekhanov":    { place: "俄罗斯·坦波夫州", geo: [41.45, 52.72] },
    "bukharin":     { place: "俄罗斯·莫斯科", geo: [37.62, 55.75] },
    "zinoviev":     { place: "乌克兰·克罗皮夫尼茨基", geo: [32.26, 48.51] },
    "kamenev":      { place: "俄罗斯·莫斯科", geo: [37.62, 55.75] },
    /* 德国 / 法国 / 意大利 */
    "dietzgen":     { place: "德国·布兰肯贝格", geo: [7.40, 50.72] },
    "lafargue":     { place: "古巴·圣地亚哥", geo: [-75.83, 20.02] },
    "mehring":      { place: "德国·西里西亚", geo: [15.00, 51.00] },
    "labriola":     { place: "意大利·卡西诺", geo: [13.83, 41.49] }
  };
  var T = window.SITE_GRAPH_GEO || (window.SITE_GRAPH_GEO = {});
  var n = 0;
  Object.keys(M).forEach(function (k) { if (!T[k]) { T[k] = M[k]; n++; } });
  window.__yzGeoExtra = n;
})();
