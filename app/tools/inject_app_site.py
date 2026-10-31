#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
inject_app_site.py — 把站点源码「变成」APK 内 assets/site 的形态（幂等）

做两件事（依据 0.17.51 成品 APK 逐字节比对反推出来的实际行为）：
  1. 每个 *.html 在 <head> 之后注入 <script>window.__YZV='<CODE>';</script>
  2. 每个 *.html 里的 <script src="X"> 与 <link ... href="X">，若 X 是本地相对路径，
     且还没有 ?v=，就追加 ?v=<CODE>（缓存破坏）。<img src> 不处理。

用法：
  python3 tools/inject_app_site.py <站点目录> <目标目录> <CODE>
  python3 tools/inject_app_site.py --verify <目标目录> <站点目录> <CODE>
"""
import os
import re
import shutil
import sys

SKIP_DIRS = {'tools'}          # 精简包：开发脚本不进 APK
TAG = re.compile(r'<(script|link)\b([^>]*)>', re.I)
ATTR = re.compile(r'\b(src|href)="([^"]+)"', re.I)
REL = re.compile(r'\brel="([^"]*)"', re.I)
HEAD = re.compile(r'^([ \t]*)<head[^>]*>\s*$', re.I | re.M)


def want_version(path):
    """本地静态资源才加版本号；外链 / data: / 锚点 / 已是绝对路径的不加。"""
    if not path:
        return False
    if path.startswith(('http://', 'https://', '//', 'data:', '#', 'mailto:')):
        return False
    if path.startswith('/'):
        return False
    if '?v=' in path or path.endswith('.html'):
        return False          # 页面之间的跳转不加（与成品包一致）
    return True


def inject_html(text, code):
    # 注意：页面脚本里可能已经引用 window.__YZV（读版本号），所以判「是否已注入」
    # 不能用 "__YZV"，只能匹配注入语句本身。
    if "window.__YZV='" not in text:
        m = HEAD.search(text)
        if m:
            ins = "<script>window.__YZV='%s';</script>" % code
            text = text[:m.end()] + '\n' + ins + text[m.end():]
        else:
            text = text.replace('<head>', "<head>\n<script>window.__YZV='%s';</script>" % code, 1)

    def repl(m):
        tag = m.group(1).lower()
        attrs = m.group(2)
        sm = ATTR.search(attrs)
        if not sm:
            return m.group(0)
        if tag == 'link':
            rm = REL.search(attrs)
            # 成品包只给 stylesheet 加版本号；icon / apple-touch-icon / manifest 不加
            if not rm or 'stylesheet' not in rm.group(1).lower():
                return m.group(0)
        val = sm.group(2)
        if not want_version(val):
            return m.group(0)
        old = '%s="%s"' % (sm.group(1), val)
        new = '%s="%s?v=%s"' % (sm.group(1), val, code)
        return '<%s%s>' % (m.group(1), attrs.replace(old, new, 1))

    return TAG.sub(repl, text)


def build(site, dst, code):
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    os.makedirs(dst, exist_ok=True)
    n = 0
    for root, dirs, files in os.walk(site):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(root, site)
        out = dst if rel == '.' else os.path.join(dst, rel)
        os.makedirs(out, exist_ok=True)
        for f in files:
            src_p = os.path.join(root, f)
            dst_p = os.path.join(out, f)
            if f.lower().endswith('.html'):
                with open(src_p, encoding='utf-8') as fh:
                    t = fh.read()
                with open(dst_p, 'w', encoding='utf-8', newline='') as fh:
                    fh.write(inject_html(t, code))
            else:
                shutil.copy2(src_p, dst_p)
            n += 1
    return n


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == '--verify':
        dst, site, code = sys.argv[2], sys.argv[3], sys.argv[4]
        bad = 0
        for root, dirs, files in os.walk(site):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if not f.lower().endswith('.html'):
                    continue
                rel = os.path.relpath(os.path.join(root, f), site)
                a = os.path.join(dst, rel)
                with open(os.path.join(root, f), encoding='utf-8') as fh:
                    want = inject_html(fh.read(), code)
                got = open(a, encoding='utf-8').read() if os.path.exists(a) else ''
                if want != got:
                    bad += 1
                    print('MISMATCH', rel)
        print('HTML 注入校验：%d 处不一致' % bad)
        sys.exit(1 if bad else 0)

    site, dst, code = sys.argv[1], sys.argv[2], sys.argv[3]
    n = build(site, dst, code)
    print('  + assets/site：%d 个文件（已排除 tools/，HTML 已注入 __YZV 与 ?v=%s）' % (n, code))


if __name__ == '__main__':
    main()
