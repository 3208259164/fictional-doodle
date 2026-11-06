#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""学通 · Service Worker 预缓存清单自动生成

为什么要有这个脚本：
    sw.js 的 CORE 原来是手写的。站点 120 多个文件，每新增一个模块都要记得往里加，
    漏一次就是「离线打开缺功能 / 白屏」。已经真实发生过：assets/store.js 与
    assets/netbasics.js 被 index.html 首屏引用，却一直不在 CORE 里。

规则（写死在这里，别再靠记性）：
    预缓存 = 所有页面 + HTML 静态引用的 js/css + assets 下的 js/css + data 下的小数据
              + 图标与 manifest
    不预缓存 = 构建工具（tools/）、3D 引擎（lib/，1.35 MB，用到才下）、
                正文（books/、images/、audio/）、超大数据文件（> LAZY_LIMIT）

用法：
    python3 tools/gen_sw_core.py --check     # 体检：清单与磁盘是否一致、引用是否漏、路径是否存在
    python3 tools/gen_sw_core.py --apply     # 重新生成并写回 sw.js
"""
import argparse
import re
import sys
from pathlib import Path

LAZY_LIMIT = 400 * 1024          # 单个数据文件超过它就默认不预缓存（首次访问不该为它多下 0.4 MB）

# 超过阈值但确实首屏/核心功能必需的，写在这里强制预缓存（每个都要有理由）
FORCE_CORE = {
    # 书库索引 460 KB：首页书库列表、搜索、详情页全靠它，少了等于书库空了
    "data/resources.js",
}

EXCLUDE_DIRS = {
    "tools", "lib", "books", "images", "audio", "_screens",
    "__pycache__", "node_modules", "vendor_src",
}

# 分组：让 diff 稳定、让人一眼看出哪类资源变了
GROUP_PAGES = "页面"
GROUP_SCRIPT = "样式与脚本"
GROUP_DATA = "数据"
GROUP_ICON = "图标与清单"


def site_root():
    return Path(__file__).resolve().parent.parent


def rel(p, root):
    return "./" + p.relative_to(root).as_posix()


def html_refs(html_path):
    """取 HTML 里同站的 js/css 引用。"""
    try:
        s = html_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    out = []
    for m in re.finditer(r'(?:src|href)\s*=\s*"([^"?#:]+\.(?:js|css))"', s):
        out.append(m.group(1).lstrip("./"))
    return out


def collect(root):
    pages, scripts, data, icons = [], [], [], []
    lazy = {}   # 因为太大被排除的

    # 1) 页面
    for p in sorted(root.glob("*.html")):
        pages.append(p)

    # 2) HTML 静态引用的 js/css（闭包再扫一层：被引用的 js 不再解析，只认引用关系）
    ref = set()
    for p in pages:
        for r in html_refs(p):
            ref.add(r)

    # 3) assets 下全部 js/css（lib/ 除外）
    for p in sorted((root / "assets").rglob("*")):
        if not p.is_file():
            continue
        if any(part in EXCLUDE_DIRS for part in p.relative_to(root).parts):
            continue
        if p.suffix.lower() in (".js", ".css"):
            scripts.append(p)

    # 4) data 下全部 js（超限的排除，FORCE_CORE 例外）
    for p in sorted((root / "data").rglob("*.js")):
        sz = p.stat().st_size
        if sz > LAZY_LIMIT and rel(p, root).lstrip("./") not in FORCE_CORE:
            lazy[rel(p, root)] = sz
        else:
            data.append(p)

    # 5) 图标与清单
    for name in ("manifest.webmanifest", "favicon.svg", "avatar.svg"):
        p = root / name
        if p.exists():
            icons.append(p)
    icons.extend(sorted((root / "icons").glob("*.png")))

    items = []
    seen = set()

    def add(p, group):
        r = rel(p, root)
        if r in seen:
            return
        if not p.exists():
            return
        seen.add(r)
        items.append((group, r))

    # './' 是根路径本身（导航到 / 时命中它）——保留，别让重写把它吃掉
    seen.add("./")
    items.append((GROUP_PAGES, "./"))
    add(root / "index.html", GROUP_PAGES)
    for p in pages:
        add(p, GROUP_PAGES)

    # HTML 引用里若有 assets/data 之外的文件，也补进来（防止有人从别处引）
    for r in sorted(ref):
        p = root / r
        if p.exists():
            add(p, GROUP_SCRIPT)

    for p in scripts:
        add(p, GROUP_SCRIPT)
    for p in data:
        add(p, GROUP_DATA)
    for p in icons:
        add(p, GROUP_ICON)

    # 组内排序；组间固定顺序
    order = {GROUP_PAGES: 0, GROUP_SCRIPT: 1, GROUP_DATA: 2, GROUP_ICON: 3}
    items.sort(key=lambda t: (order[t[0]], t[1]))
    return items, lazy


def render_core(items):
    lines = ["const CORE = ["]
    cur = None
    for group, r in items:
        if group != cur:
            cur = group
            lines.append("  /* %s */" % group)
        lines.append("  '%s'," % r)
    # 最后一项的逗号去掉，符合常见风格
    if lines[-1].endswith(","):
        lines[-1] = lines[-1][:-1]
    lines.append("];")
    return "\n".join(lines)


CORE_RE = re.compile(r"const CORE = \[.*?\n\];", re.S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    if not a.check and not a.apply:
        a.check = True

    root = site_root()
    swp = root / "sw.js"
    if not swp.exists():
        sys.exit("❌ 找不到 %s" % swp)
    sw = swp.read_text(encoding="utf-8")

    m = CORE_RE.search(sw)
    if not m:
        sys.exit("❌ sw.js 里找不到 `const CORE = [ ...\\n];` 段，格式可能变了")

    old_block = m.group(0)
    old_items = re.findall(r"'([^']+)'", old_block)

    items, lazy = collect(root)
    new_block = render_core(items)

    problems = []

    # A. 清单里的路径必须真实存在
    for r in old_items:
        if r == "./":
            continue
        if not (root / r.lstrip("./")).exists():
            problems.append("清单里的 %s 不存在于磁盘" % r)

    # B. 首屏静态引用必须都在清单里（这条是真出过事的）
    index = root / "index.html"
    if index.exists():
        listed = set(r.lstrip("./") for r in old_items)
        for r in html_refs(index):
            if r not in listed:
                problems.append("index.html 引用了 %s，但不在预缓存清单（离线首次打开会缺它）" % r)

    # C. 清单与磁盘不一致（新增文件没进去 / 已删文件还在）
    old_set = set(r for r in old_items if r != "./")
    new_set = set(r for _, r in items if r != "./")
    for r in sorted(new_set - old_set):
        problems.append("新增未收录：%s" % r)
    for r in sorted(old_set - new_set):
        if (root / r.lstrip("./")).exists():
            problems.append("被本脚本排除：%s" % r)

    if a.check:
        if problems:
            print("❌ 预缓存清单有问题（%d 项）：" % len(problems))
            for p in problems:
                print("   · " + p)
            print("\n   修法：python3 tools/gen_sw_core.py --apply")
            return 1
        print("✅ 预缓存清单一致（%d 项）" % len(old_items))
        if lazy:
            print("   （按规则不预缓存的大文件：%s）"
                  % "、".join("%s %dKB" % (k, v // 1024) for k, v in sorted(lazy.items())))
        return 0

    if old_block == new_block:
        print("✅ 无需改动（%d 项）" % len(items))
        return 0
    swp.write_text(sw.replace(old_block, new_block, 1), encoding="utf-8")
    added = sorted(set(r for _, r in items if r != "./") - old_set)
    removed = sorted(old_set - set(r for _, r in items if r != "./"))
    print("✅ 已重写 sw.js 预缓存清单：%d 项（原 %d）" % (len(items), len(old_items)))
    if added:
        print("   + " + "、".join(added))
    if removed:
        print("   - " + "、".join(removed))
    if lazy:
        print("   （不预缓存：%s）" % "、".join(sorted(lazy)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
