#!/usr/bin/env bash
# =====================================================================
# 学通 · 发布前检查清单（一条命令跑完）
#   1) 代码静态审计（语法/引用/死资源/CSS 类）
#   2) 数据一致性审计（悬空关系、重复 id、孤立节点、坐标、头像清单）
#   3) 运行时回归（headless 打开各页面 + 关键功能）
#      · tools/regress_site.mjs        历史修复点总回归（32 项）
#      · tools/verify_graph_mgr.mjs    图谱管理面板 / 关系工具抽屉 / 导出菜单（13 项）
#      · tools/verify_home_friends.mjs 主页「添加到主页」（导师默认已添加·可取消）（6 项）
#      · tools/verify_interactions.mjs 图谱默认显示 / 分类页管理收起（含防点透）/ 编辑通知 / 空图谱提示（17 项）
#      · tools/verify_injection.mjs    注入面封堵（属性闭合 / 存储型 / 图谱面板）（13 项）
#      · tools/verify_storage.mjs      本机存储写满的提示与导入保护（5 项）
#      · tools/verify_features.mjs     图谱添加到主页 / 记住视角 / 按钮语义 / 死代码清理（10 项）
#      · tools/verify_graph28.mjs      图谱聚焦 / 影响力排名 / 双击归位 / 2D 深链（13 项）
#      · tools/verify_a11y.mjs         无障碍：skip link / 焦点环 / 线型区分 / 3D 省电（11 项）
#      · tools/verify_sharecard.mjs    分享卡片 PNG（含二维码）（41 项）
#      · tools/verify_3d_idle.mjs      3D 空闲不再持续绘制（20 项）
#      · tools/verify_contrast.mjs     三套主题色彩对比度（10 项，纯计算）
#      · tools/verify_round31.mjs      浮层关闭治理：互斥/Esc/点空白/焦点泄漏/工具栏让位（15 项）
#      · tools/verify_round31b.mjs     3D 页 Esc/布局避让/字号自适应 + 卡片降级 + 入口页 Esc（13 项）
#      · tools/probe_index.mjs         入口页交互矩阵：6 类浮层打开/关闭闭环 × 4 视口（108 项）
#      · tools/verify_round34.mjs      导出图片已移除 + 导出数据走保存 + 3D 提示条（11 项）
#      · tools/verify_fulltext.mjs     全文检索：内置语料 + App 内导入的书（19 项）
#      · tools/verify_export_all.mjs   数据可迁出：Markdown 导出 + 书文件导出（21 项）
#      · tools/verify_shelf.mjs        我的书：三标签/排序/视图/批量管理（30 项）
#      · tools/verify_mount.mjs        书壳挂载本机文件（13 项）
#      · tools/verify_onetap.mjs       一键导入与格式白名单（22 项）
#      · tools/verify_editor_v3.mjs    编辑台：事件增删 / 书目录 / 批量标签与移目录 / 撤销找回（24 项）
#      · tools/verify_reader.mjs       阅读器基础（26 项）
#      · tools/verify_reader2.mjs      阅读器三档翻页/排版/夜间/页码/返回（54 项）
#      · tools/verify_visual.mjs       视觉回归：7 页截图逐像素比对基线（含书架浮层）
#                                      基线更新：node tools/verify_visual.mjs --update
# 用法： bash tools/check.sh            # 站点根目录下运行
#        PORT=8946 bash tools/check.sh  # 自定义端口
#        SKIP_RUNTIME=1 bash tools/check.sh   # 只跑 1、2（无需浏览器）
# =====================================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE="$(cd "$HERE/.." && pwd)"
cd "$SITE" || exit 1
PORT="${PORT:-8946}"
FAIL=0

echo "=== [1/3] 代码静态审计 ==="
node tools/audit_code.js || FAIL=1

echo
echo "=== [2/3] 数据一致性审计 ==="
node tools/validate_data.js || FAIL=1      # 既有：字段/唯一性/悬空/头像/别名
# 导出书库时 EPUB 要重新打包成标准格式 —— 纯 JVM 校验（mimetype 首条且不压缩）
if [ -f "$SITE/../qa/tools/run_epubpack_test.sh" ]; then
  bash "$SITE/../qa/tools/run_epubpack_test.sh" >/tmp/yzy_epubpack.log 2>&1 \
    && echo "  ✅ EPUB 重打包符合 OCF 规范（8 项）" \
    || { echo "  ❌ EPUB 重打包有问题（见 /tmp/yzy_epubpack.log）"; FAIL=1; }
fi
node tools/audit_data.js || FAIL=1         # 补充：3D 数据集、世界地理坐标、孤立节点
node tools/check_meetings.js || FAIL=1     # 会议条目：人物名/书目 id/事件名能否在站内解析

if [ "${SKIP_RUNTIME:-0}" = "1" ]; then
  echo; echo "（已跳过运行时回归：SKIP_RUNTIME=1）"
else
  echo
  echo "=== [3/3] 运行时回归（headless）==="
  if [ ! -f tools/regress_site.mjs ]; then
    echo "（跳过：缺少 tools/regress_site.mjs）"
  else
    SERVE=""
    for cand in tools/serve.py /sandbox/workspace/serve.py; do [ -f "$cand" ] && SERVE="$cand"; done
    if [ -n "$SERVE" ]; then
      python3 "$SERVE" "$PORT" "$SITE" >/tmp/yzy_check_server.log 2>&1 &
    else
      python3 -m http.server "$PORT" --directory "$SITE" >/tmp/yzy_check_server.log 2>&1 &
    fi
    SRV=$!
    sleep 2
    PORT="$PORT" node tools/regress_site.mjs || FAIL=1
    PORT="$PORT" node tools/verify_graph_mgr.mjs || FAIL=1
    PORT="$PORT" node tools/verify_home_friends.mjs || FAIL=1
    PORT="$PORT" node tools/verify_interactions.mjs || FAIL=1
    PORT="$PORT" node tools/verify_injection.mjs || FAIL=1
    PORT="$PORT" node tools/verify_storage.mjs || FAIL=1
    PORT="$PORT" node tools/verify_features.mjs || FAIL=1
    PORT="$PORT" node tools/verify_graph28.mjs || FAIL=1
    PORT="$PORT" node tools/graph_label_density_test.js || FAIL=1
    PORT="$PORT" node tools/verify_lazydata.mjs || FAIL=1
    PORT="$PORT" node tools/verify_appbooks.mjs || FAIL=1
    PORT="$PORT" node tools/verify_bookshelf3.mjs || FAIL=1
    PORT="$PORT" node tools/verify_shelf.mjs || FAIL=1
    PORT="$PORT" node tools/verify_mount.mjs || FAIL=1
    PORT="$PORT" node tools/verify_onetap.mjs || FAIL=1
    PORT="$PORT" node tools/verify_reader.mjs || FAIL=1
    PORT="$PORT" node tools/verify_reader2.mjs || FAIL=1
    PORT="$PORT" node tools/verify_booknote.mjs || FAIL=1
    PORT="$PORT" node tools/verify_outline.mjs || FAIL=1
    PORT="$PORT" node tools/verify_fulltext.mjs || FAIL=1
    PORT="$PORT" node tools/verify_export_all.mjs || FAIL=1
    PORT="$PORT" node tools/verify_searchmerge.mjs || FAIL=1
    PORT="$PORT" node tools/verify_editmerge.mjs || FAIL=1
    PORT="$PORT" node tools/verify_editor_v3.mjs || FAIL=1
    PORT="$PORT" node tools/graph_world_label_test.js || FAIL=1
    PORT="$PORT" node tools/verify_a11y.mjs || FAIL=1
    PORT="$PORT" node tools/verify_sharecard.mjs || FAIL=1
    PORT="$PORT" node tools/verify_3d_idle.mjs || FAIL=1
    node tools/verify_contrast.mjs || FAIL=1
    PORT="$PORT" node tools/verify_round31.mjs || FAIL=1
    PORT="$PORT" node tools/verify_round31b.mjs || FAIL=1
    PORT="$PORT" node tools/probe_index.mjs || FAIL=1
    PORT="$PORT" node tools/verify_round34.mjs || FAIL=1
    PORT="$PORT" node tools/verify_export_dir.mjs || FAIL=1
    PORT="$PORT" node tools/verify_graph_io.mjs || FAIL=1
    # 视觉回归放在最后：拍 7 页截图与基线逐像素比对（基线缺失则跳过）
    if [ -d "$SITE/../shots/base" ]; then
      PORT="$PORT" node tools/verify_visual.mjs || FAIL=1
    else
      echo "（跳过视觉回归：没有基线，先跑 node tools/verify_visual.mjs --update）"
    fi
    kill "$SRV" 2>/dev/null
  fi
fi

echo
if [ "$FAIL" = "0" ]; then echo "✅ 检查清单全部通过"; else echo "❌ 检查清单存在问题（见上）"; fi
exit "$FAIL"
