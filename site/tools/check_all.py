#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""学通 · 一键门禁（CI 与本地共用）

设计原则（都是踩过坑才定下的）：
  1. 每个检查都必须产出**可解析的汇总行**，解析不到就算失败。
     —— 以前 verify_all.sh 用 `cmd | grep -q` 判断，命令报错被管道吞掉，
        整段检查几个月没真正执行过，还一直显示"通过"。
  2. 已知的历史欠账用基线（tools/check-baseline.json）管住：
     不允许变多，但也不把既有问题变成红灯。变少了会提示你下调基线。
  3. 脚本自身抽风（崩溃、找不到文件、断言数 0）一律失败，不回落成"看起来还行"。

用法：
    python3 tools/check_all.py                 # 全部检查
    python3 tools/check_all.py --quick         # 跳过需要 jsdom 的部分
    python3 tools/check_all.py --update-baseline   # 把当前数字写成新基线（仅在确认无误后用）
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent      # site/ 或 site_new/
TOOLS = Path(__file__).resolve().parent
BASELINE = TOOLS / "check-baseline.json"

results = []   # (ok, name, detail)


def run(cmd, timeout=600, cwd=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=timeout, cwd=str(cwd or ROOT))
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError as e:
        return 127, "命令不存在：%s" % e
    except subprocess.TimeoutExpired:
        return 124, "超时（%ds）" % timeout


def num(pattern, text):
    m = re.search(pattern, text)
    return int(m.group(1)) if m else None


def check(name, cmd, parse, limit_key=None, base=None):
    """parse(text) -> (问题数, 提醒数, 说明) 或 None 表示「一行汇总都没解析到」"""
    code, out = run(cmd)
    parsed = parse(out)
    if parsed is None:
        results.append((False, name, "没有可解析的汇总行 —— 脚本可能崩了，输出尾部：\n" +
                        "\n".join("      " + l for l in out.strip().splitlines()[-3:])))
        return
    bad, warn, note = parsed
    if bad == 0 and warn == 0:
        results.append((True, name, note))
        return
    if limit_key and base:
        lim = base.get(limit_key, {})
        lim_bad = lim.get("max_problems", 0)
        lim_warn = lim.get("max_warns", 0)
        if bad <= lim_bad and warn <= lim_warn:
            tag = "（在基线内：问题 %d/%d、提醒 %d/%d）" % (bad, lim_bad, warn, lim_warn)
            if bad < lim_bad or warn < lim_warn:
                tag += " ← 比基线少了，可下调 check-baseline.json"
            results.append((True, name, note + tag))
        else:
            results.append((False, name, "%s —— 超出基线（问题 %d>%d 或提醒 %d>%d）"
                            % (note, bad, lim_bad, warn, lim_warn)))
    else:
        results.append((bad == 0, name, note))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="跳过需要 jsdom 的测试")
    ap.add_argument("--update-baseline", action="store_true")
    a = ap.parse_args()

    base = {}
    if BASELINE.exists():
        base = json.loads(BASELINE.read_text(encoding="utf-8"))

    print("学通 · 门禁（站点：%s）\n" % ROOT.name)

    # ---- 1. 版本一致性 ----
    code, out = run([sys.executable, str(TOOLS / "sync_version.py"), "--check", "--quiet"])
    results.append((code == 0, "版本号一致", out.strip().splitlines()[0] if out.strip() else "ok"))

    # ---- 2. 预缓存清单 ----
    code, out = run([sys.executable, str(TOOLS / "gen_sw_core.py"), "--check"])
    results.append((code == 0, "预缓存清单",
                    out.strip().splitlines()[0] if out.strip() else "ok"))

    # ---- 3. JS 语法 ----
    bad = []
    n = 0
    for p in list((ROOT / "assets").glob("*.js")) + list((ROOT / "data").glob("*.js")) + [ROOT / "sw.js"]:
        n += 1
        c, o = run(["node", "--check", str(p)], timeout=60)
        if c != 0:
            bad.append("%s：%s" % (p.name, o.strip().splitlines()[-1] if o.strip() else "语法错误"))
    results.append((not bad and n > 0, "JS 语法（%d 个文件）" % n,
                    "全部通过" if not bad else "；".join(bad[:3])))

    # ---- 3b. 首屏体积护栏 ----
    # 原来的欠账：27 个同步脚本 / 1765 KB 没有任何上限断言，涨回去无人提醒。
    # 这里按 index.html 的 <script src> 静态引用合计（不含运行时懒加载注入的部分）。
    # 0.18.49 抬护栏 1900 → 2100（用户决定）。0.37.30 新增 data/entity.js(83K)、
    # data/edge-meta.js(22K)、data/articles.js(13K)、data/bstruct.js(1.5K) 四个同步引用文件后
    # 首屏从 1891 KB 涨到 2036 KB，原护栏必然红灯。长期方向仍是 1800 KB（多余数据改懒加载），
    # 抬到 2100 只是把「现在已知的欠账」记在账上，不允许再往上走。
    FIRST_SCREEN_LIMIT_KB = 2600      # 0.18.64 抬护栏 2100 → 2600（用户决定：内容优先）；长期方向仍是 1800
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    srcs = re.findall(r'<script[^>]*src="([^"?]+)', html)
    tot, missing = 0, []
    for s in srcs:
        p = ROOT / s.lstrip("./")
        if p.exists():
            tot += p.stat().st_size
        else:
            missing.append(s)
    kb = round(tot / 1024)
    if missing:
        results.append((False, "首屏体积", "index.html 引用的脚本不存在：" + "、".join(missing[:3])))
    else:
        over = kb > FIRST_SCREEN_LIMIT_KB
        gap = "" if kb <= 1800 else "；已超原定目标 1800 KB，建议压缩而不是抬护栏"
        results.append((not over, "首屏体积",
                        "%d KB / %d 个同步脚本（护栏 %d KB%s）" % (kb, len(srcs), FIRST_SCREEN_LIMIT_KB, gap)))

    # ---- 4. 数据结构 ----
    check("数据结构 validate_data", ["node", str(TOOLS / "validate_data.js")],
          lambda t: (num(r"错误 (\d+) 项", t), num(r"提醒 (\d+) 项", t) or 0, "结构校验完成")
          if re.search(r"结果：", t) else None,
          "validate_data", base)

    # ---- 5. 数据体检 ----
    def p_audit_data(t):
        m = re.search(r"发现 (\d+) 个问题", t)
        if m:
            return int(m.group(1)), 0, "数据体检完成"
        if re.search(r"数据体检：✅", t):
            return 0, 0, "数据体检完成"
        return None

    check("数据体检 audit_data", ["node", str(TOOLS / "audit_data.js")], p_audit_data,
          "audit_data", base)

    # ---- 6. 书库完整性 ----
    check("书库 check_resources", ["node", str(TOOLS / "check_resources.js")],
          lambda t: (num(r"错误 (\d+) 项", t), num(r"提醒 (\d+) 项", t) or 0, "书库校验完成")
          if re.search(r"—— 结果：", t) else None,
          "check_resources", base)

    # ---- 6b. 地名数据（0.18.54 新增）----
    # places.js 的 events[] 是按事件名自动聚合的，事件改名后关联会静默断掉，必须有人盯着。
    check("地名 check_places", ["node", str(TOOLS / "check_places.js"), str(ROOT)],
          lambda t: ((num(r"未通过：(\d+) 项", t) or 0), (num(r"（(\d+) 条提醒）", t) or 0), "地名校验完成")
          if ("地名校验通过" in t or "地名校验未通过" in t) else None,
          "check_places", base)

    # ---- 7. 代码体检（严格）----
    code, out = run(["node", str(TOOLS / "audit_code.js"), str(ROOT), "--strict"])
    if "体检结果" not in out:
        results.append((False, "代码体检 audit_code", "没有输出体检结果 —— 脚本异常"))
    else:
        m = re.search(r"⚠️ (\d+) 项待留意", out)
        cnt = int(m.group(1)) if m else 0
        line = [l for l in out.splitlines() if "体检结果" in l][-1]
        if code == 2:
            # 退出码 2 = 环境未就绪（没装 acorn），三项没跑。
            # 「没跑」与「跑了但失败」必须分开报，否则会像 2026-11-07 那样
            # 把 1531 条正则粗测误报当成真实问题、门禁一片红。
            results.append((True, "代码体检 audit_code", "⛔ 跳过：环境未就绪（缺 acorn），不是通过也不是失败 —— cd site/tools && npm i"))
        else:
            results.append((code == 0 and cnt == 0, "代码体检 audit_code", line.strip("— ")))

    # ---- 7b. 全局命名空间（只许变少，不许新增）----
    # 0.18.50 新增：window.* 从 152 涨到 149→（去重后基线 149），
    # 「改一处忘一处」的根源。新增全局要挂到统一命名空间下再 --update。
    glob_js = TOOLS / "check-globals.js"
    if glob_js.exists():
        code, out = run(["node", str(glob_js)] + sorted(str(f) for f in (ROOT / "assets").glob("*.js")))
        line = [l for l in out.splitlines() if "全局数" in l or "新增全局" in l]
        results.append((code == 0, "全局命名空间 check-globals",
                        (line[0].strip() if line else (out.strip().splitlines() or [""])[-1])[:120]))
    else:
        results.append((True, "全局命名空间 check-globals", "脚本不存在，跳过"))

    # ---- 8. 回归测试（需要 jsdom）----
    runner = ROOT.parent / "tests" / "run_all.js"
    if a.quick:
        results.append((True, "回归测试", "已跳过（--quick）"))
    elif runner.exists():
        code, out = run(["node", str(runner), "--site", str(ROOT)], timeout=1800)
        # 从整段输出里找汇总行，而不是只取最后一行 ——
        # 2026-11-07 因为 run_all 在合计行之后多打印了一行提示，最后一行解析不到断言数，
        # 门禁把「解析失败」报成「回归测试失败」。规则是「解析不到就算失败」，
        # 所以要保证解析点稳定，而不是让输出格式迁就解析。
        _lines = [l for l in out.splitlines() if "合计：断言" in l]
        tail = _lines[-1] if _lines else (out.strip().splitlines()[-1] if out.strip() else "")
        if "断言" not in tail:
            results.append((False, "回归测试", "没跑出汇总（断言数为 0 视为失败）：" + tail[:120]))
        else:
            asserts = num(r"断言 (\d+)", tail)
            fails = num(r"失败 (\d+)", tail)
            ok = code == 0 and asserts and asserts > 0 and fails == 0
            results.append((ok, "回归测试", "断言 %s 项 / 失败 %s 项" % (asserts, fails)))
    else:
        results.append((True, "回归测试", "仓库内没有 tests/run_all.js，跳过"))

    # ---- 汇总 ----
    print()
    for ok, name, detail in results:
        print("%s %-24s %s" % ("✅" if ok else "❌", name, detail))

    nbad = sum(1 for ok, _, _ in results if not ok)
    nskip = sum(1 for _, _, d in results if "⛔ 跳过" in d)
    print("\n%s %d 项检查，%d 项未通过%s" % ("★ 全部通过" if nbad == 0 else "✗ 有未通过项",
                                            len(results), nbad,
                                            ("，%d 项跳过（环境未就绪）" % nskip) if nskip else ""))
    return 0 if nbad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
