#!/usr/bin/env python3
"""生成书籍结构索引 data/bstruct.js（P0：文本结构层）

与阅读器 appbooks.js 的分段规则保持一致：
  paras = re.split(r'\\n\\s*\\n', text.replace('\\r\\n', '\\n'))
  isCh  = 段 <=34 字且匹配 CH_RE（或 Markdown 标题）

输出（紧凑）：
window.SITE_BSTRUCT = {
  "bk_xxx.txt": {
    "n": 段数,
    "ch": [[段序, "章标题"], ...],          // 与阅读器算出来的一致，用于校验
    "an": [[段序, "第 7 号", "上册"], ...]  // 原书锚点：篇号 / 册次（讲话类才有）
  }
}

锚点的两种来源（2026-11-15 起）：
  ① 正文里仍标着「（中册第 404 号·原文 2,040 字·大会讲话记录稿）」—— 直接读这一行；
  ② 正文已改成朴素排法、不再标括注（《十年首长讲话选编》就是这种）—— 按篇标题段
     （「01　1966.5.21　周恩来谈…」）的先后顺序，沿用上一次生成的锚点标签序列。
     这样 edge-meta 里存的「第 694 号」仍然跳得到，而页面上不再出现那串括注。

用法：python3 tools/gen_bstruct.py
"""
import json, os, re

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKS = os.path.join(SITE, 'books')
OUT = os.path.join(SITE, 'data/bstruct.js')

CH_RE = re.compile(r'^(?:第\s*[〇零一二三四五六七八九十百千0-9]+\s*[章节篇部卷讲]|[〇零一二三四五六七八九十]{1,3}\s*[、.．]|[0-9]{1,3}\s*[、.．)）]|序\s*[言章]|前\s*言|引\s*言|导\s*言|结\s*语|后\s*记|附\s*录|尾\s*声)')
AN_RE = re.compile(r'^（(?:(上册|中册|下册))?(?:第\s*(\d+)\s*号)?[·・]([^）]*)）$')
HEAD_RE = re.compile(r'^\d{2}[\s\u3000]')


def load_old():
    """读上一版 bstruct.js，用于「正文不再标篇号」时沿用锚点标签序列。"""
    try:
        t = open(OUT, encoding='utf-8').read()
        return json.loads(t[t.index('{'):t.rindex('}') + 1])
    except Exception:
        return {}


def parse(path, name='', old=None):
    t = open(path, encoding='utf-8').read().replace('\r\n', '\n')
    paras = re.split(r'\n\s*\n', t)
    n = len(paras)
    ch, an, heads = [], [], []
    cnt = {}
    for i, raw in enumerate(paras):
        pt = raw.strip()
        if not pt:
            continue
        if HEAD_RE.match(pt) and len(pt) <= 60:
            heads.append(i)
        m = AN_RE.match(pt)
        if m:
            vol = m.group(1) or ''
            num = m.group(2)
            if num:
                an.append([i, '第 %s 号' % num, vol])
            else:
                # 下册有一批只标「下册·原文 N 字」，没有原书号：按该册出现顺序编号
                vol = vol or '下册'
                cnt[vol] = cnt.get(vol, 0) + 1
                an.append([i, '%s第 %d 篇' % (vol, cnt[vol]), vol])
            continue
        if re.match(r'^#{1,3}\s+', pt):
            ch.append([i, re.sub(r'^#{1,3}\s+', '', pt).strip()])
        elif len(pt) <= 34 and CH_RE.match(pt):
            ch.append([i, pt])
    filled = 0
    if not an and heads:
        labs = (old or {}).get(name, {}).get('an') or []
        for k, idx in enumerate(heads):
            if k < len(labs):
                an.append([idx, labs[k][1], labs[k][2]])
                filled += 1
    return {'n': n, 'an': an}, filled


def main():
    old = load_old()
    data = {}
    tot_filled = 0
    for f in sorted(os.listdir(BOOKS)):
        if not f.endswith('.txt'):
            continue
        st, filled = parse(os.path.join(BOOKS, f), f, old)
        tot_filled += filled
        if st['an']:
            data[f] = st
    js = 'window.SITE_BSTRUCT = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(OUT, 'w', encoding='utf-8').write(js)
    tot_an = sum(len(v['an']) for v in data.values())
    print('书籍', len(data), '| 篇锚点', tot_an, '（其中按篇标题回填 %d 条）' % tot_filled,
          '|', os.path.getsize(OUT), '字节')
    k = 'bk_shouzhang_jianghua.txt'
    if k in data:
        print('样例', k, '段数', data[k]['n'], '锚点', len(data[k]['an']))
        print('  前 3 锚点:', data[k]['an'][:3])


if __name__ == '__main__':
    main()
