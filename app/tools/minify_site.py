#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建期 JS 压缩（0.18.9）
--------------------------------------------------------------------------
只作用于构建产物 apk_new/assets/site，站点源码保持可读（便于调试与测试）。
实测（esbuild --minify --charset=utf8 --target=es2018）：
    assets/*.js  -30% ~ -46%（app.js 326KB → 228KB）
    data/*.js    -4% ~ -22%（中文内容多，压缩率低，但也不亏）
    首屏 JS      3005KB → 2441KB；4 倍降速下 FCP 444ms → 272ms
--charset=utf8 必须加：否则中文会被转义成 \\uXXXX，文件反而变大。
--legal-comments=inline 保留 /*! 开头的 MIT 声明（许可合规要求）。

用法：python3 tools/minify_site.py <站点目录> <esbuild 路径>
失败不致命：任何一个文件压缩失败就保留原文件，整体返回 0。
"""
import os
import subprocess
import sys
import glob


def main():
    if len(sys.argv) < 3:
        print('用法：minify_site.py <站点目录> <esbuild>')
        return 0
    site, eb = sys.argv[1], sys.argv[2]
    if not os.path.isfile(eb):
        print('  （跳过：未找到 esbuild）')
        return 0
    files = sorted(glob.glob(os.path.join(site, 'assets', '*.js')) +
                   glob.glob(os.path.join(site, 'data', '*.js')))
    if not files:
        print('  （跳过：没有可压缩的 JS）')
        return 0

    tot = mini = 0
    done = skipped = 0
    for f in files:
        a = os.path.getsize(f)
        tot += a
        try:
            with open(f, 'rb') as fh:
                r = subprocess.run(
                    [eb, '--minify', '--charset=utf8', '--target=es2018',
                     '--loader=js', '--legal-comments=inline', '--log-level=error'],
                    stdin=fh, capture_output=True, timeout=120)
            out = r.stdout
            # 压缩结果明显异常（空 / 变大 / 非 0 退出）时不采用
            if r.returncode != 0 or not out or len(out) >= a:
                mini += a
                skipped += 1
                continue
            tmp = f + '.tmp'
            with open(tmp, 'wb') as fh:
                fh.write(out)
            os.replace(tmp, f)
            mini += len(out)
            done += 1
        except Exception:
            mini += a
            skipped += 1

    pct = int(round(100.0 * (tot - mini) / tot)) if tot else 0
    print('  %d 个文件压缩完成（%d 个跳过）：%dKB → %dKB（-%d%%）'
          % (done, skipped, tot // 1024, mini // 1024, pct))
    return 0


if __name__ == '__main__':
    sys.exit(main())
