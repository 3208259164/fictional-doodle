# site/tools/ — 维护者用的辅助脚本

这些脚本用来**维护站点内容与代码质量**，不参与运行时，也不会被 App 调用。
放在 `site/tools/` 里是为了跟着站点走，改了数据顺手能验证。

## 体检 / 校验

| 脚本 | 作用 | 依赖 |
|---|---|---|
| `audit_code.js` | 用 acorn 语法树做静态体检：悬空函数调用、只定义未调用、重复定义、重复 id、无用资源、未引用的 CSS 类 | `npm i acorn` |
| `audit_data.js` | 数据结构体检（字段缺失、类型错误、引用不存在的 id） | 无 |
| `validate_data.js` | 校验书目 / 图谱 / 分类数据完整性，可当 CI 门禁 | 无 |
| `check_resources.js` | 检查书库条目里没有被引用的字段与失效链接 | 无 |
| `check.sh` | 一键跑上面几项 + 起本地服务预览 | 无 |

## 生成

| 脚本 | 作用 | 依赖 |
|---|---|---|
| `gen_resources.js` | 由原始书目清单生成 `data/resources.js` | 无 |
| `gen_pages.js` | 生成静态栏目页 | 无 |
| `gen_feed.js` | 生成 `feed.xml` | 无 |
| `gen_avatars.js` | 批量处理头像（裁剪 + 转 webp 保留 alpha） | ImageMagick |
| `gen_py.py` | 生成拼音检索表 `data/py.js` | `pip install pypinyin` |
| `build_graph3d.js` | 由主图谱生成 3D 用的数据集 `data/graph3d.js` | 无 |
| `gen_snapshot.py` | 把整个工程打成一个可还原的 Markdown 快照 | 无 |

## 数据补充（一次性/增量脚本）

`add_main_people.js`、`add_world_events.js`、`link_world_events.js`、`fill_meta.js`、`find_sources.js`
—— 都是「往数据里补一批条目」的脚本，跑完即弃，保留是为了留痕（能看出某个字段是哪一批加进来的）。

## 其他

- `serve.py`：本地静态服务器（`python3 tools/serve.py 8080`），带正确的 MIME 与 SW 调试开关
- `downlevel-lib.sh`：把第三方库降到老内核能解析的语法级别
- `archive_changelog.py`：归档历史 CHANGELOG

---

## ⚠️ 关于路径

部分脚本里写死了开发机上的绝对路径（`/sandbox/workspace/...`，指向 Node 依赖、
Python 库、输出目录）。**在自己机器上跑之前请改成你的路径**，或者用环境变量覆盖。

这不是刻意为之，是长期在固定环境里迭代留下的痕迹。要拿去跑 CI 的话，
建议先改成「从脚本所在目录向上查找」的写法。

## 跑之前

- Node 脚本：`node >= 18`
- `audit_code.js` 需要 `acorn`（`npm i acorn`，或放到任一 `node_modules` 里并被脚本找到）
- `gen_py.py` 需要 `pypinyin`
- 其余为纯标准库，无第三方依赖
