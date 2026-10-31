# 学通 · XueTong

> 一个离线的马克思主义理论学习 App：书库 + 关系图谱 + 史料 + 离线问答，全部本地运行，不联网、不注册、不上传。

**当前版本：v0.17.66（versionCode 245）｜ 站点 0.36.10 ｜ 要求 Android 10+**

学通把「读原著、看关系、考理解」三件事放在同一个离线应用里。站点用纯静态 HTML/CSS/JS（无框架、无构建依赖），Android 客户端用原生 WebView 壳，Java 侧零第三方依赖（仅 Android framework）。

---

## 下载 / 在线体验

| 方式 | 地址 | 说明 |
|---|---|---|
| **Android 安装包** | [Releases](../../releases/latest) | 下载 `xuetong-<版本>.apk`，覆盖安装即可，**不要卸载**（会清空本机数据） |
| **网页版（GitHub Pages）** | https://3208259164.github.io/fictional-doodle/ | 免安装直接浏览全部资料；数据存在你的浏览器里，与 App 内的数据互不相通 |
| **网页版（备用）** | https://xuetone.netlify.app/ | 同上 |
| **Komi Store** | 在 Komi Store 内搜索「学通」 | 收录自本仓库的 Release，可直接安装并自动更新 |

安装包校验：

- 签名：ECDSA P-256，SHA-256 指纹 `60:C5:8F:E3:…:8D:99`（与 [元资源库](https://github.com/3208259164) 共用同一把密钥，可互相覆盖升级）
- 每个 Release 的说明里附该版本 APK 的 SHA-256，可用 `sha256sum` 核对

**如果 GitHub 直连下载失败**（`release-assets.githubusercontent.com` 在部分网络下不可达），可用加速镜像，下载后**务必核对 SHA-256**：

```bash
# 任选其一
curl -L -o xuetong.apk "https://ghproxy.net/https://github.com/3208259164/fictional-doodle/releases/download/v0.17.66/xuetong-0.17.66.apk"
curl -L -o xuetong.apk "https://gh-proxy.com/https://github.com/3208259164/fictional-doodle/releases/download/v0.17.66/xuetong-0.17.66.apk"

# 校验（应与 Release 说明里的 SHA-256 一致）
sha256sum xuetong.apk
```

> 第三方代理存在被篡改的可能，**只认 SHA-256，不看来源**。已实测 v0.17.66 经 `ghproxy.net` 下载后与官方逐字节一致。

> **升级提示**：versionCode 严格递增（构建脚本会拒绝小于历史最大值的构建），因此新包总能覆盖旧包。
> 应用不申请 INTERNET 权限，无法联网上传任何东西。

---

## 功能

### 书库（456 条：书目 / 讲堂正文 / 网络扫盲 / 导读 / 词典）
- 分类：原著 / 导读 / 词典 / 有声书 / 歌曲 / 影像 / 工具 / 参考 / 对公文献
- **书壳与正文分离**：预置的是「书壳」（书名、作者、简介、封面），正文由用户自己导入本地文件后挂到对应书壳上
- 导入的正文只存在设备本地（IndexedDB），不上传任何服务器
- 同名书自动合并，不会因为重复导入多出一个条目

### 关系图谱
- **2D 关系网**：人物 / 组织 / 事件 / 思想四类节点，按社区着色、可切时间轴过滤
- **2D 地理视图**：节点按真实发生地落点，支持中国/世界两套底图
- **3D 力导向图谱**：可旋转、可下钻
- 内置图谱：主图谱（思想史）、世界图谱（含世界性重大事件）、专题图谱
- 路径高亮、拼音检索、束线、多点聚合（同地多点合并为数字徽标，点开列出全部）

### 闯关（可选内容包）
- 软件只提供**接口**：地图 / 节点 / 解锁 / 星级 / 存档 / 沙箱播放器 / 限时器
- 关卡与题目放在独立的单文件 `.html` 内容包里，选择性导入，随时可换
- 一个内容包可含多个节点，每个节点带**基础 / 进阶 / 挑战**三档题库
- 挑战档整卷限时，答错不扣分
- 题目随机抽取 + 选项顺序独立打乱

---

## 目录结构

```
xuetong/
├── site/                      # 站点源码（也是 App 内置的页面）
│   ├── index.html             # 书库 / 首页
│   ├── graph.html             # 2D 关系图谱 + 地理视图
│   ├── graph3d.html           # 3D 图谱
│   ├── challenge.html         # 闯关地图
│   ├── assets/                # app.js / books.js / challenge.js / 样式
│   ├── data/                  # 书库元数据、图谱数据、配置（含 jtfull.js 全文索引）
│   ├── books/                 # 讲堂正文（站内 .txt，内置阅读器直接打开）
│   ├── lib/                   # 第三方库（3d-force-graph 等）
│   ├── images/ icons/         # 站点图形资源
│   ├── sw.js                  # Service Worker 离线缓存
│   └── tools/                 # 代码体检 / 数据校验脚本
└── app/                       # Android 工程
    ├── build.sh               # 一键构建（aapt2 + javac + R8 + zipalign + apksigner）
    ├── AndroidManifest.xml
    ├── r8.pro                 # R8 保留规则（混淆配置）
    ├── java/                  # MainActivity 等（零第三方依赖）
    ├── res/                   # 图标、主题
    └── tools/verify_apk.sh    # 产物自检（62 项）
```

---

## 快速开始

### 只看站点

站点是纯静态的，任何静态服务器都能跑：

```bash
cd site
python3 -m http.server 8080
# 打开 http://localhost:8080
```

> 直接双击 `index.html` 用 `file://` 也能看到界面，但 Service Worker 与部分文件读取会受限，建议用本地服务器。

部署到任何静态托管（Netlify / Vercel / GitHub Pages / Nginx）直接上传 `site/` 目录即可，`netlify.toml` 与 `_headers` 已带好缓存策略。

### 构建 APK

需要准备（都不进仓库）：

| 依赖 | 说明 |
|---|---|
| Android SDK build-tools | `aapt2`、`zipalign` |
| `android.jar` | Platform 36 |
| `r8.jar` | 代码压缩与混淆 |
| `apksigner` | 随 build-tools 提供 |
| 签名密钥 | 你自己的 keystore |

> 也可以把工具链放在仓库同级目录 `toolchain/`（`build-tools-36`、`android-sdk/platforms/android-36/android.jar`、`r8.jar`、`release.keystore` + `ks.pw`），
> 这样不传 `TC` 也能找到；`SITE` 默认取 `../site`。

```bash
cd app
NAME=1.0.0 CODE=1 \
BT=/path/to/build-tools \
AJ=/path/to/platforms/android-36/android.jar \
R8=/path/to/r8.jar \
KS=/path/to/your.keystore KS_PW=你的口令 \
bash build.sh
```

构建脚本会自动：

> `CODE` 必须大于仓库里的 `app/.last_code`（历史上用过的最大 versionCode），否则构建会在第一步中止 —— 这是为了防止出现「新包版本号比旧包小、用户装不上」的降级事故。
1. 把 `../site` 复制进 `assets/site`（站点是唯一真源，不在 App 里手改副本）
2. 对齐 `sw.js` 的缓存版本号与构建号
3. 编译、压缩、混淆、对齐、签名

不签名（例如给 F-Droid 或自己做可复现构建）加 `UNSIGNED=1`。

构建完自检：

```bash
bash tools/verify_apk.sh 学通-1.0.0.apk
```

---

## 设计要点

**为什么站点不用框架**
所有交互靠原生 DOM + 少量工具函数，页面总量小、首屏快、离线可靠。168 处内联 `onclick` 是刻意保留的：它让每个页面可以独立打开、独立调试，不依赖模块加载顺序。

**为什么书壳和正文分离**
预置正文会带来版权问题，也会让安装包变成几十兆。现在的做法是只带「目录卡片」，用户拿自己合法持有的电子书挂上去。这样做的好处是：更新书目不用重新发版，也不会把用户的阅读记录传到任何地方。

**为什么闯关包是单文件 HTML**
内容包需要能被任何人独立制作、独立分发。单个 HTML 文件可以但当作普通网页打开预览，也可以被 App 用沙箱 `iframe` 装进去，通过 `postMessage` 通信。格式约定见 `site/challenge.html` 顶部注释与 `challenge.js` 里的 `YZQ_BOOT` / `yz:win` 处理。

**离线优先**
Service Worker 预缓存核心页面；IndexedDB 存用户导入的书籍正文与闯关进度。所有数据留在设备上。

---

## 已知限制

- 未做多语言，界面仅中文
- 闯关内容包需要自行制作或获取，仓库不含版权题目
- 3D 图谱对低端设备（Android 10 以下、内存 < 3GB）会自动降级为 2D
- 站点未适配桌面宽屏，按手机竖屏设计

---

## 许可

- **程序代码**（Java / 构建脚本 / 站点 HTML·CSS·JS）：GPL-3.0-or-later，见 `LICENSE`
- 若你希望改用更宽松的条款，可换成 `LICENSE-MIT`（二选一，不要同时生效）
- **文案 / 文献整理 / 本站原创图像**：CC BY-SA 4.0
- 第三方组件清单与版本见 `NOTICE`

## 内容声明

本项目是学习工具，不存储、不分发任何受版权保护的书籍正文。书库中出现的书名、作者、简介属于合理引用范畴；原始文献的著作权归原作者与出版方所有。

导入到本应用的文件由用户自行提供，仅保存在用户设备本地，项目不收集、不上传。

## 免责声明

本项目为个人学习用途的开源软件，与任何机构无隶属关系。使用者应自行遵守所在地法律法规。
