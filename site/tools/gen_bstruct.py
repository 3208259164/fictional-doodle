#!/usr/bin/env python3
"""生成书籍结构索引 data/bstruct.js（P0：文本结构层）

与阅读器 appbooks.js 的分段规则保持一致：
  paras = re.split(r'\n\s*\n', text.replace('\r\n', '\n'))
  isCh  = 段 <=34 字且匹配 CH_RE（或 Markdown 标题）

输出（紧凑）：
window.SITE_BSTRUCT = {
  "bk_xxx.txt": {
    "n": 段数,
    "ch": [[段序, "章标题"], ...],          // 与阅读器算出来的一致，用于校验
    "an": [[段序, "第 7 号", "上册"], ...]  // 原书锚点：篇号 / 册次（讲话类才有）
  }
}

用法：python3 tools/gen_bstruct.py
"""
import json, os, re

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOOKS = os.path.join(SITE, 'books')
OUT = os.path.join(SITE, 'data/bstruct.js')

CH_RE = re.compile(r'^(?:第\s*[〇零一二三四五六七八九十百千0-9]+\s*[章节篇部卷讲]|[〇零一二三四五六七八九十]{1,3}\s*[、.．]|[0-9]{1,3}\s*[、.．)）]|序\s*[言章]|前\s*言|引\s*言|导\s*言|结\s*语|后\s*记|附\s*录|尾\s*声)')
AN_RE = re.compile(r'^（(?:(上册|中册|下册))?(?:第\s*(\d+)\s*号)?[·・]([^）]*)）$')


def parse(path):
    t = open(path, encoding='utf-8').read().replace('\r\n', '\n')
    paras = re.split(r'\n\s*\n', t)
    n = len(paras)
    ch, an = [], []
    cnt = {}
    for i, raw in enumerate(paras):
        pt = raw.strip()
        if not pt:
            continue
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
    return {'n': n, 'an': an}


def main():
    data = {}
    for f in sorted(os.listdir(BOOKS)):
        if not f.endswith('.txt'):
            continue
        st = parse(os.path.join(BOOKS, f))
        if st['an']:
            data[f] = st
    js = 'window.SITE_BSTRUCT = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(OUT, 'w', encoding='utf-8').write(js)
    tot_an = sum(len(v['an']) for v in data.values())
    tot_ch = 0
    print('书籍', len(data), '| 章', tot_ch, '| 篇锚点', tot_an, '|', os.path.getsize(OUT), '字节')
    k = 'bk_shouzhang_jianghua.txt'
    if k in data:
        print('样例', k, '段数', data[k]['n'], '锚点', len(data[k]['an']))
        print('  前 3 锚点:', data[k]['an'][:3])


if __name__ == '__main__':
    main()
