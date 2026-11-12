/* =====================================================================
   学通 · 图书馆 / 书库清单
   ⚠ 本清单仅用于「图书馆」页的**介绍展示**：本站为本地 / 离线应用，
   不提供任何跳转。下列 url / search / alts 字段只作资料留存，页面不再使用。
   ---------------------------------------------------------------------
   ⚠ 镜像地址与可用性常变动（部分域名会被停用/封锁），故每家图书馆除主域名
     外另配 alts 备用域名，页面上会一并列出，打不开时换一个即可。
     本轮核对（2026-10）：Z-Library 现行官方域名为 z-lib.gs / z-library.sk /
     z-lib.fm / go-to-library.sk（原先写的 zh.z-lib.gs 并不存在）；
     Anna's Archive 原 .org 已被停用，现行 .gl / .pk / .gd；
     Library Genesis 现行 .li / .gs / .rs。
   ===================================================================== */
window.SITE_LIBRARIES = [
  {
    "id": "zlib",
    "group": "文献与书目",
    "name": "Z-Library",
    "url": "https://zh.101thur.ru/",
    "search": "https://zh.101thur.ru/s/{q}",
    "tag": "电子书",
    "note": "规模最大的电子书库之一，中英文书都有，学术书与绝版书较多。可按书名、作者、ISBN 检索，支持 PDF/EPUB/MOBI 等格式。域名变动频繁，主站打不开时依次试下方备用域名；下载前注意甄别上传者版本与扫描质量。",
    "hint": "介绍",
    "alts": [
      {
        "name": "镜像 zh.101d.by",
        "url": "https://zh.101d.by/",
        "search": "https://zh.101d.by/s/{q}"
      },
      {
        "name": "镜像 zh.834101.ru",
        "url": "https://zh.834101.ru/",
        "search": "https://zh.834101.ru/s/{q}"
      },
      {
        "name": "镜像 zh.z-lib.today",
        "url": "https://zh.z-lib.today/",
        "search": "https://zh.z-lib.today/s/{q}"
      },
      {
        "name": "官方登录 singlelogin.re",
        "url": "https://singlelogin.re/",
        "search": ""
      },
      {
        "name": "镜像导航 imi123.cn",
        "url": "https://www.imi123.cn/",
        "search": ""
      }
    ]
  },
  {
    "id": "annas",
    "group": "文献与书目",
    "name": "安娜的档案",
    "url": "https://zh.annas-archive.gl/",
    "search": "https://zh.annas-archive.gl/search?q={q}",
    "tag": "聚合",
    "note": "聚合了 Z-Library、Library Genesis、Sci-Hub 等多个书库的元检索入口，一次搜索即可比对多个来源，还提供「慢速下载」等通道。界面有中文，适合找不到某本书时换这里再搜一遍。域名同样常变，备用域名在下方。",
    "alts": [
      {
        "name": "镜像 zh.annas-archive.se",
        "url": "https://zh.annas-archive.se/",
        "search": "https://zh.annas-archive.se/search?q={q}"
      },
      {
        "name": "镜像 zh.annas-archive.pk",
        "url": "https://zh.annas-archive.pk/",
        "search": "https://zh.annas-archive.pk/search?q={q}"
      },
      {
        "name": "镜像 zh.annas-archive.gd",
        "url": "https://zh.annas-archive.gd/",
        "search": "https://zh.annas-archive.gd/search?q={q}"
      }
    ]
  },
  {
    "id": "libgen",
    "group": "文献与书目",
    "name": "Library Genesis",
    "url": "https://libgen.li/",
    "search": "https://libgen.li/index.php?req={q}",
    "tag": "电子书",
    "note": "学术书籍与期刊论文的大型镜像库，理工、人文社科的外文书尤其丰富，也可按 DOI/ISBN 精确检索。界面朴素、多为扫描版 PDF，文件质量参差，下载前先看文件大小与格式。",
    "alts": [
      {
        "name": "镜像 libgen.gs",
        "url": "https://libgen.gs/",
        "search": "https://libgen.gs/index.php?req={q}"
      },
      {
        "name": "镜像 libgen.rs",
        "url": "https://libgen.rs/",
        "search": "https://libgen.rs/index.php?req={q}"
      },
      {
        "name": "镜像 libgen.ee",
        "url": "https://libgen.ee/",
        "search": "https://libgen.ee/index.php?req={q}"
      }
    ]
  },
  {
    "id": "ia",
    "group": "文献与书目",
    "name": "Internet Archive",
    "url": "https://archive.org/",
    "search": "https://archive.org/search?query={q}",
    "tag": "档案",
    "note": "互联网档案馆，非营利的巨型数字图书馆：收录图书、期刊、音像、网页历史快照（Wayback Machine）。大量 20 世纪出版物可在线借阅（受版权限制时需排队），也是查找旧报刊、老唱片、历史照片的好去处。"
  },
  {
    "id": "openlib",
    "group": "文献与书目",
    "name": "Open Library",
    "url": "https://openlibrary.org/",
    "search": "https://openlibrary.org/search?q={q}",
    "tag": "书目",
    "note": "互联网档案馆的开放书目项目，以「书目数据」为主：书名、作者、出版信息、封面、主题词，部分条目可直接链接到可读版本。适合核对版本信息，或查找某本书有哪些版本。"
  },
  {
    "id": "gbooks",
    "group": "文献与书目",
    "name": "Google 图书",
    "url": "https://books.google.com/",
    "search": "https://www.google.com/search?tbm=bks&q={q}",
    "tag": "书目",
    "note": "谷歌图书，最大的图书扫描索引之一。强项是「全文检索」——记得一句话但忘了出自哪本书时，可以用引号搜原句。多数书只给片段或预览，能否看全文取决于版权状态。"
  },
  {
    "id": "marxists",
    "group": "文献与书目",
    "name": "马克思主义文库（中文）",
    "url": "https://www.marxists.org/chinese/index.html",
    "search": "https://www.marxists.org/chinese/search.htm",
    "tag": "全文库",
    "note": "由国际志愿者维护的中文马克思主义文献库（MIA 中文站），收录马克思、恩格斯、列宁、斯大林、毛泽东等人的著作，以及国际共运史文献、人物传记和参考资料。按人物与著作组织，全部免费，是核对经典原文与出处的首选。中国大陆访问可能受限，可试下方直连地址。"
  },
  {
    "id": "gutenberg",
    "group": "文献与书目",
    "name": "古腾堡计划",
    "url": "https://www.gutenberg.org/",
    "search": "https://www.gutenberg.org/ebooks/search/?query={q}",
    "tag": "公版",
    "note": "古腾堡计划，最早的公有领域电子书库，七万余种，以英文古典文学与历史著作为主，也有部分中文古籍。全部为纯文本/EPUB，无版权风险，适合找 1949 年前的中文旧籍与外国古典著作。"
  },
  {
    "id": "wikisource",
    "group": "文献与书目",
    "name": "中文维基文库",
    "url": "https://zh.wikisource.org/",
    "search": "https://zh.wikisource.org/w/index.php?search={q}",
    "tag": "全文库",
    "note": "维基文库中文版，收录已进入公有领域的原始文献：古籍、条约、法令、历史文件、作者文集。优势是「原文 + 校勘 + 注释」并存，且每条都有来源说明。查找近代条约、旧报刊文章、历史文件时很好用。"
  },
  {
    "id": "ctext",
    "group": "文献与书目",
    "name": "中国哲学书电子化计划",
    "url": "https://ctext.org/zhs",
    "search": "",
    "tag": "古籍",
    "note": "中国哲学书电子化计划，收录先秦至清代的典籍原文与注疏，支持简繁对照、全文检索、词语索引。查经史子集的原文与历代注释，比直接搜网页可靠得多。"
  },
  {
    "id": "shuge",
    "group": "文献与书目",
    "name": "书格",
    "url": "https://shuge.org/",
    "search": "",
    "tag": "古籍",
    "note": "书格，专注中国古籍善本的数字图书馆，提供高清扫描的宋元明清刻本、抄本、舆图，多为公版资源，可下载。适合查版本、看原刻面貌。"
  },
  {
    "id": "nlc",
    "group": "文献与书目",
    "name": "中国国家图书馆",
    "url": "https://www.nlc.cn/",
    "search": "",
    "tag": "图书馆",
    "note": "中国国家图书馆，馆藏目录与部分数字化资源的官方入口。可查民国期刊、古籍、方志的馆藏信息，注册读者证后可用其数字资源。检索「民国时期期刊全文数据库」时常用。"
  },
  {
    "id": "ncpssd",
    "group": "文献与书目",
    "name": "国家哲学社会科学文献中心",
    "url": "https://www.ncpssd.org/",
    "search": "",
    "tag": "学术",
    "note": "国家哲学社会科学文献中心，免费的学术文献平台，收录中文社科期刊论文、外文期刊、古籍与图书，注册后可在线阅读与下载。查当代研究文献（含党史、马理论）比较方便。"
  },
  {
    "id": "netlify",
    "group": "开发与托管",
    "name": "Netlify",
    "url": "https://www.netlify.com/",
    "search": "",
    "tag": "建站托管",
    "note": "静态站点托管平台，支持自动部署、免费 HTTPS 与自定义域名。本站的网页版即托管在同类平台上，了解它有助于自己部署一份离线站点。"
  },
  {
    "id": "github",
    "group": "开发与托管",
    "name": "GitHub",
    "url": "https://github.com/",
    "search": "",
    "tag": "代码托管",
    "note": "全球最大的代码托管平台，也是大量文献整理项目、数据集与开源工具的存放地。查找某个资料库的源码、镜像或抓取脚本时常来这里。"
  },
  {
    "id": "gitlab",
    "group": "开发与托管",
    "name": "GitLab",
    "url": "https://gitlab.com/",
    "search": "",
    "tag": "代码托管",
    "note": "与 GitHub 类似的代码托管平台，支持自建实例，部分开源项目在此维护。"
  },
  {
    "id": "gitee",
    "group": "开发与托管",
    "name": "Gitee 码云",
    "url": "https://gitee.com/",
    "search": "",
    "tag": "代码托管",
    "note": "国内的代码托管平台，访问速度较快，不少镜像项目与中文开源工具放在这里。"
  },
  {
    "id": "fsf",
    "group": "开发与托管",
    "name": "自由软件基金会（FSF）",
    "url": "https://www.fsf.org/",
    "search": "",
    "tag": "开源组织",
    "note": "自由软件基金会，GNU 计划的发起组织，倡导软件自由（运行、研究、修改、分发的自由），维护 GPL 系列许可证。理解「自由软件」与「开源」的区别，从这里看最权威。"
  },
  {
    "id": "osi",
    "group": "开发与托管",
    "name": "开放源代码促进会（OSI）",
    "url": "https://opensource.org/",
    "search": "",
    "tag": "开源组织",
    "note": "开放源代码促进会，负责「开源」这一名称的认证与开源许可证的审核。查某个许可证是否属于开源许可，可查它的许可清单。"
  },
  {
    "id": "mdn",
    "group": "开发与托管",
    "name": "MDN Web Docs",
    "url": "https://developer.mozilla.org/zh-CN/",
    "search": "",
    "tag": "技术文档",
    "note": "Mozilla 维护的 Web 技术文档，HTML/CSS/JavaScript 与浏览器 API 的标准参考，中文版覆盖主要条目。写网页或排查兼容性问题时的第一手资料。"
  },
  {
    "id": "webdev",
    "group": "开发与托管",
    "name": "web.dev",
    "url": "https://web.dev/",
    "search": "",
    "tag": "技术文档",
    "note": "谷歌出品的 Web 开发最佳实践站点，讲性能、可访问性、离线缓存（Service Worker）等。本站的离线方案就参考了其中的思路。"
  },
  {
    "id": "proletarian",
    "group": "文献与书目",
    "name": "无产阶级图书馆",
    "url": "https://library.proletarian.me/",
    "search": "",
    "tag": "文库",
    "note": "以马克思列宁毛泽东著作与共运文献为主的中文资料站，界面简洁，按专题与人物分类。适合查找经典著作的电子版与部分史料汇编。"
  },
  {
    "id": "jiumodiary",
    "group": "文献与书目",
    "name": "鸠摩搜书",
    "url": "https://www.jiumodiary.com/",
    "search": "",
    "tag": "搜书",
    "note": "电子书搜索引擎，聚合多个网盘的公开分享结果（网盘类资源），可按书名/作者搜索。结果质量与可用性取决于网盘状态，需要自行甄别。"
  },
  {
    "id": "feishu",
    "group": "文献与书目",
    "name": "持续更新的资料链接（飞书）",
    "url": "https://ai.feishu.cn/wiki/RZOlwUONQifDkMk5saicUGMpnPH",
    "search": "",
    "tag": "导航",
    "note": "一份持续更新的资料链接合集（飞书文档），按主题整理了大量文献、史料与工具入口。适合当作「索引的索引」浏览，注意其中外链同样可能受网络限制。"
  },
  {
    "id": "mzdbl",
    "group": "文献与书目",
    "name": "红军旗 · 毛泽东博览",
    "url": "http://www.mzdbl.cn/",
    "search": "",
    "tag": "HTTP",
    "note": "毛泽东博览（红军旗），以毛泽东著作、年谱、传记、诗词与照片为主的中文资料站，也收录部分党史文献。适合查毛泽东著作版本与生平材料。"
  },
  {
    "id": "wikipedia",
    "group": "百科与课程",
    "name": "维基百科",
    "url": "https://zh.wikipedia.org/",
    "search": "",
    "tag": "百科",
    "note": "维基百科中文版，覆盖面最广的百科。作为「查基本信息」的起点很好（人物生卒、事件时间、机构沿革），但涉及争议问题时条目立场可能摇摆，引用前务必看它的参考来源，再回到原始文献核对。"
  },
  {
    "id": "neteaseopen",
    "group": "百科与课程",
    "name": "网易公开课",
    "url": "https://open.163.com/",
    "search": "",
    "tag": "课程",
    "note": "网易公开课，汇集国内外高校的公开课视频（含部分人文社科课程），有中文字幕。适合系统了解某个学科的基础框架。"
  },
  {
    "id": "icourse163",
    "group": "百科与课程",
    "name": "中国大学 MOOC",
    "url": "https://www.icourse163.org/",
    "search": "",
    "tag": "课程",
    "note": "中国大学 MOOC，国内高校的在线课程平台，思政、历史、哲学类课程较多，多数免费旁听。"
  },
  {
    "id": "sumatrapdfreader",
    "group": "工具与阅读",
    "name": "SumatraPDF",
    "url": "https://www.sumatrapdfreader.org/",
    "search": "",
    "tag": "阅读器",
    "note": "极轻量的 PDF 阅读器，启动快、对老机器友好，支持 PDF/EPUB/MOBI/CHM 等多种格式。本站推荐的本地阅读工具之一。"
  },
  {
    "id": "calibreebook",
    "group": "工具与阅读",
    "name": "Calibre",
    "url": "https://calibre-ebook.com/",
    "search": "",
    "tag": "阅读器",
    "note": "电子书管理与转换工具，可整理书库、编辑元数据、在 EPUB/MOBI/AZW3/PDF 之间互转，也能把网页、TXT 转成电子书。整理本地书库很实用。"
  },
  {
    "id": "pdfjs",
    "group": "工具与阅读",
    "name": "PDF.js（在线预览）",
    "url": "https://mozilla.github.io/pdf.js/",
    "search": "",
    "tag": "在线",
    "note": "Mozilla 的 PDF.js 在线演示，浏览器里直接打开 PDF 的参考实现。可用来查看某个 PDF 的渲染效果，或在不装阅读器的情况下临时预览。"
  },
  {
    "id": "xiaozhongjishu",
    "group": "工具与阅读",
    "name": "小众技术工具库",
    "url": "https://www.xiaozhongjishu.com/",
    "search": "",
    "tag": "导航",
    "note": "小众技术工具库，收录各类在线小工具（格式转换、编码、图片处理等），界面简单，多数无需注册。"
  },
  {
    "id": "sojson",
    "group": "工具与阅读",
    "name": "sojson 在线工具",
    "url": "https://m.sojson.com/",
    "search": "",
    "tag": "在线",
    "note": "在线工具集合站，提供 JSON 格式化、编码转换、时间戳、正则测试等常用开发小工具。"
  },
  {
    "id": "smallpdf",
    "group": "工具与阅读",
    "name": "Smallpdf（合并 PDF）",
    "url": "https://smallpdf.com/merge-pdf",
    "search": "",
    "tag": "在线",
    "note": "在线 PDF 工具（合并、拆分、压缩、转换），网页端即可完成，无需安装。上传前注意文件是否涉密。"
  },
  {
    "id": "ilovepdf",
    "group": "工具与阅读",
    "name": "iLovePDF",
    "url": "https://www.ilovepdf.com.cn/zh/",
    "search": "",
    "tag": "在线",
    "note": "另一家在线 PDF 工具站，功能与 Smallpdf 类似，有中文界面。同样注意上传文件的私密性。"
  },
  {
    "id": "wormhole",
    "group": "工具与阅读",
    "name": "Wormhole",
    "url": "https://wormhole.app/",
    "search": "",
    "tag": "传输",
    "note": "端到端加密的临时文件传输服务，文件上传后生成链接，可设有效期与下载次数，服务器不保存明文。传大文件时比网盘省事。"
  },
  {
    "id": "monks",
    "group": "工具与阅读",
    "name": "send.monks.tools",
    "url": "https://send.monks.tools/",
    "search": "",
    "tag": "传输",
    "note": "基于浏览器的临时文件分享工具，主打「传完即弃」，适合临时传一个文件给对方。"
  },
  {
    "id": "vercel",
    "group": "开发与托管",
    "name": "Vercel",
    "url": "https://vercel.com/",
    "search": "",
    "tag": "托管",
    "note": "前端托管与 Serverless 平台，支持静态站点一键部署、自动 HTTPS。与 Netlify 同类。"
  },
  {
    "id": "cfpages",
    "group": "开发与托管",
    "name": "Cloudflare Pages",
    "url": "https://pages.cloudflare.com/",
    "search": "",
    "tag": "托管",
    "note": "Cloudflare Pages，静态站点托管，免费额度较大，全球 CDN。与前两者同类，选一个即可。"
  },
  {
    "id": "dawnnav",
    "group": "文献与书目",
    "name": "黎明导航（DawnNav）",
    "url": "https://dawnnav.pages.dev/",
    "search": "",
    "tag": "导航站",
    "note": "国际马克思主义、当代毛主义与全球左翼理论、社会运动资源的中文导航站。按「刊物 / 博主 / 论坛 / 其他 / 工具 / 归档」分类收录站点入口，可当作查找左翼资料站的第一站。所收外链质量与立场不一，点进去仍需自行判断。"
  },
  {
    "id": "rotepresse",
    "group": "文献与书目",
    "name": "红色新闻（Rote Presse）",
    "url": "https://rotepresse.noblogs.org/",
    "search": "",
    "tag": "德语 · 出版平台",
    "note": "德国革命左翼的出版与文献平台（德语），集中发布《红色邮报》（Rote Post）与《阶级立场》（Klassenstandpunkt）等刊物的文章与电子版。《红色邮报》侧重时事评论与社会问题，《阶级立场》偏重革命理论、共运史与政治路线；内容涉及劳动与住房、国家镇压、新闻自由、战争与巴勒斯坦等议题。"
  },
  {
    "id": "militantwire",
    "group": "文献与书目",
    "name": "战线（Militant Wire）",
    "url": "https://www.militantwire.com/",
    "search": "",
    "tag": "研究媒体 · 非左翼",
    "note": "以全球武装冲突、政治暴力、叛乱与极端主义为对象的独立分析媒体，**不是左翼组织或左翼媒体**，立场是安全研究与政治暴力分析。栏目分 Analysis / Interviews / History / Reviews / News / Archive，涉及 ISIS、萨赫勒武装、印度纳萨尔—毛主义运动、菲律宾新人民军、缅甸反军政府武装等。研究左翼武装运动时可作对照材料，引用时须分清它的分析框架并非左翼立场。"
  },
  {
    "id": "iplark",
    "group": "工具与阅读",
    "name": "IPLark（IP 查询）",
    "url": "https://iplark.com/",
    "search": "",
    "tag": "网络工具",
    "note": "IP 地址查询与网络环境诊断工具，可查当前 IP 的地理位置、运营商、ASN、风险评分，以及代理/VPN 检测，并支持多源数据库（IPStack、MaxMind、IP-API）比对。排查「某个站点为什么打不开」时可辅助判断是本地网络、代理还是对方封锁。"
  },
  {
    "id": "maglit",
    "group": "工具与阅读",
    "name": "MagLit（加密短链）",
    "url": "https://maglit.me/",
    "search": "",
    "tag": "隐私工具",
    "note": "开源（AGPLv3）的隐私短链服务，最初为磁力链接设计，也可用于普通网址。链接在浏览器端用自定义密钥加密，服务器看不到内容；无需注册，支持密码保护与自定义后缀，不收集个人数据。适合分享不便公开的链接。"
  },
  {
    "id": "bida",
    "group": "工具与阅读",
    "name": "Bida 自主服务器",
    "url": "https://bida.im/",
    "search": "",
    "tag": "意大利 · 无政府主义社群",
    "note": "意大利无政府主义与社会运动背景的自主服务器集体（anarchist server collective），提供注重隐私的邮件、社交网络等服务，主张自由软件、反监控与自主管理。**其政治传统是无政府主义，与马列毛主义不是一回事**，此处仅作「同类自主基础设施」的记录。"
  },
  {
    "id": "difangwenge",
    "group": "文献与书目",
    "name": "文革与当代史研究网",
    "url": "https://difangwenge.org/",
    "search": "",
    "tag": "史料 · 论坛",
    "note": "以文化大革命与中国现当代史为核心的民间研究与资料论坛。栏目含「地方文革」「文革研究」「文革回忆」「现当代史纵横」「毛泽东研究」「原始资料」「学术信息」，并按东北、华北、华东、华中、华南、西北、西南分区整理地方资料。内容含档案、回忆、论文与评论，引用时须区分原始档案、回忆材料与评论文章三类性质。"
  },
  {
    "id": "leftwingbooks",
    "group": "文献与书目",
    "name": "左翼书籍（Leftwingbooks）",
    "url": "https://leftwingbooks.net",
    "search": "",
    "tag": "书店 · 英文",
    "note": "英语左翼政治书店与文献发行平台，面向加拿大与美国配送。书目跨马克思主义、共产主义、无政府主义、革命社会主义、黑人激进主义、反帝国主义、女性主义、巴勒斯坦团结等传统，单设「maoism & marxism-leninism」类别（含菲共干部训练材料等）。它是一个跨派别的文献渠道，不代表某一派立场。"
  }
];
