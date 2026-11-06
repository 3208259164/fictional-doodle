# 学通 · 站点工具

这里放**长期要用**的脚本。文件名以下划线开头、或叫 `verify_*.mjs` / `shot_*.mjs` / `probe_*.mjs`
的那批是**一次性诊断脚本**（当初排查某个具体问题时写的），留作参考，不参与构建与校验，
不要指望它们在任何机器上都能跑。

## 长期脚本（CI 会跑这几个）

| 脚本 | 作用 | 依赖 |
|---|---|---|
| `validate_data.js` | 数据结构校验：分类、字段、引用 | 无 |
| `audit_data.js` | 数据体检：坐标范围、头像文件、id 唯一 | 无 |
| `check_resources.js` | 书库条目完整性（链接、正文、来源） | 无 |
| `audit_code.js` | 代码体检：悬空调用 / 死函数 / 重复 id / 无用资源（acorn 语法树） | `acorn` |
| `sync_version.py` | **版本号唯一真相源**：把 `version.json` 写进 config.js / sw.js / README / `.last_code` | Python 3 |
| `gen_sw_core.py` | **自动生成** `sw.js` 的预缓存清单（CORE），并校验清单里的文件都存在 | Python 3 |
| `verify_apk.py` | 包内验证（第三层）：站点是否完整进包、版本对齐、签名指纹 | 可选 aapt2/apksigner |
| `gen_py.py` | 重建 `data/py.js` 拼音索引 | `pypinyin` |
| `gen_snapshot.py` | 生成给 AI 读的源码快照 | Python 3 |
| `serve.py` | 本地预览静态站点 | Python 3 |
| `check.sh` | 一键跑上面几项 | 视上面而定 |

## 版本号怎么改（只改一个地方）

```bash
# 升到 0.18.29 / versionCode 310 / 站点 0.37.13
python3 tools/sync_version.py --set app=0.18.29 --set code=310 --set site=0.37.13 --apply

# 体检（不一致会列出来，退出码 1）
python3 tools/sync_version.py --check
```

`version.json` 是唯一真相源。`data/config.js`、`sw.js` 的 `VERSION`、`README.md` 的版本行、
`app/.last_code` 全部由它派生，**不要手改**。构建脚本在第一步就会校验一致性，不一致直接中止。

## 预缓存清单怎么改

```bash
python3 tools/gen_sw_core.py --apply     # 按磁盘现状重新生成
python3 tools/gen_sw_core.py --check     # 体检：漏收 / 多余 / 引用了但没进清单
```

规则写在脚本顶部：页面 + HTML 静态引用的 js/css + `assets/` 全部 + `data/` 的小于 400 KB 的数据
+ 图标。`lib/`（3D 引擎）、`books/`、`images/`、`audio/`、`tools/` 不进预缓存。
超过 400 KB 但确实必需的，加进脚本里的 `FORCE_CORE` 并写明理由。

## 依赖安装

```bash
cd tools && npm i        # 只装 acorn（audit_code.js 用）
```

装在哪都行，脚本按 `ACORN_PATH` 环境变量 → 常规 `require` → `site/node_modules` →
`site/tools/node_modules` 的顺序找。找不到会**明确警告并降级为正则粗测**，不会假装成功。
