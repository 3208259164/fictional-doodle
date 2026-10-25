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

  { id:'zlib', group:'文献与书目', name:'Z-Library', url:'https://zh.101thur.ru/', search:'https://zh.101thur.ru/s/{q}',
    tag:'电子书', note:'规模较大的电子书库 · 域名约每月变动', hint:'介绍',
    alts:[ { name:'镜像 zh.101d.by',     url:'https://zh.101d.by/',     search:'https://zh.101d.by/s/{q}' },
           { name:'镜像 zh.834101.ru',   url:'https://zh.834101.ru/',   search:'https://zh.834101.ru/s/{q}' },
           { name:'镜像 zh.z-lib.today', url:'https://zh.z-lib.today/', search:'https://zh.z-lib.today/s/{q}' },
           { name:'官方登录 singlelogin.re', url:'https://singlelogin.re/', search:'' },
           { name:'镜像导航 imi123.cn',  url:'https://www.imi123.cn/',  search:'' } ] },

  { id:'annas', group:'文献与书目', name:'安娜的档案', url:'https://zh.annas-archive.gl/', search:'https://zh.annas-archive.gl/search?q={q}',
    tag:'聚合', note:'聚合多方书源的检索索引（原 .org 已停用）',
    alts:[ { name:'镜像 zh.annas-archive.se', url:'https://zh.annas-archive.se/', search:'https://zh.annas-archive.se/search?q={q}' },
           { name:'镜像 zh.annas-archive.pk', url:'https://zh.annas-archive.pk/', search:'https://zh.annas-archive.pk/search?q={q}' },
           { name:'镜像 zh.annas-archive.gd', url:'https://zh.annas-archive.gd/', search:'https://zh.annas-archive.gd/search?q={q}' } ] },

  { id:'libgen', group:'文献与书目', name:'Library Genesis', url:'https://libgen.li/', search:'https://libgen.li/index.php?req={q}',
    tag:'电子书', note:'老牌电子书与论文库，英文与学术书较多',
    alts:[ { name:'镜像 libgen.gs', url:'https://libgen.gs/', search:'https://libgen.gs/index.php?req={q}' },
           { name:'镜像 libgen.rs', url:'https://libgen.rs/', search:'https://libgen.rs/index.php?req={q}' },
           { name:'镜像 libgen.ee', url:'https://libgen.ee/', search:'https://libgen.ee/index.php?req={q}' } ] },

  { id:'ia', group:'文献与书目', name:'Internet Archive', url:'https://archive.org/', search:'https://archive.org/search?query={q}',
    tag:'档案', note:'非营利数字图书馆，扫描本与公版书丰富' },

  { id:'openlib', group:'文献与书目', name:'Open Library', url:'https://openlibrary.org/', search:'https://openlibrary.org/search?q={q}',
    tag:'书目', note:'开放书目库，可查版本信息并跳转借阅' },

  { id:'gbooks', group:'文献与书目', name:'Google 图书', url:'https://books.google.com/', search:'https://www.google.com/search?tbm=bks&q={q}',
    tag:'书目', note:'全球书目检索，部分可预览' },

  { id:'marxists', group:'文献与书目', name:'马克思主义文库（中文）', url:'https://www.marxists.org/chinese/index.html', search:'https://www.marxists.org/chinese/search.htm',
    tag:'全文库', note:'按人物与著作整理的经典著作全文库（公益）' },

  { id:'gutenberg', group:'文献与书目', name:'古腾堡计划', url:'https://www.gutenberg.org/', search:'https://www.gutenberg.org/ebooks/search/?query={q}',
    tag:'公版', note:'公共领域电子书，可自由下载' },

  { id:'wikisource', group:'文献与书目', name:'中文维基文库', url:'https://zh.wikisource.org/', search:'https://zh.wikisource.org/w/index.php?search={q}',
    tag:'全文库', note:'自由文本库，公版典籍与历史文件' },

  { id:'ctext', group:'文献与书目', name:'中国哲学书电子化计划', url:'https://ctext.org/zhs', search:'',
    tag:'古籍', note:'中国古代典籍全文数据库' },

  { id:'shuge', group:'文献与书目', name:'书格', url:'https://shuge.org/', search:'',
    tag:'古籍', note:'开放共享古籍善本的数字图书馆' },

  { id:'nlc', group:'文献与书目', name:'中国国家图书馆', url:'https://www.nlc.cn/', search:'',
    tag:'图书馆', note:'国家总书库，馆藏宏富，部分需注册' },

  { id:'ncpssd', group:'文献与书目', name:'国家哲学社会科学文献中心', url:'https://www.ncpssd.org/', search:'',
    tag:'学术', note:'免费检索、下载哲社类期刊与论文' },


  /* ================= 开源 / 建站相关（2026-10 新增） ================= */

  { id:'netlify', group:'开发与托管', name:'Netlify', url:'https://www.netlify.com/', search:'',
    tag:'建站托管', note:'静态网站托管平台：把网页文件拖上去即可上线，自带 HTTPS、自定义域名与 CDN；学通网页版就部署在这里' },

  { id:'github', group:'开发与托管', name:'GitHub', url:'https://github.com/', search:'',
    tag:'代码托管', note:'全球最大的开源代码托管平台，也是寻找开源项目、阅读源码与协作开发的首选' },

  { id:'gitlab', group:'开发与托管', name:'GitLab', url:'https://gitlab.com/', search:'',
    tag:'代码托管', note:'开源代码托管与 CI/CD 平台，可自建私有实例，常用于团队协作与自动化部署' },

  { id:'gitee', group:'开发与托管', name:'Gitee 码云', url:'https://gitee.com/', search:'',
    tag:'代码托管', note:'国内访问较快的代码托管平台，有大量中文开源项目与镜像仓库' },

  { id:'fsf', group:'开发与托管', name:'自由软件基金会（FSF）', url:'https://www.fsf.org/', search:'',
    tag:'开源组织', note:'1985 年成立，发起 GNU 计划与 GPL 许可证，倡导软件自由（自由使用、研究、修改与分发）' },

  { id:'osi', group:'开发与托管', name:'开放源代码促进会（OSI）', url:'https://opensource.org/', search:'',
    tag:'开源组织', note:'维护「开源定义」并审核开源许可证，是开源运动的主要组织之一' },

  { id:'mdn', group:'开发与托管', name:'MDN Web Docs', url:'https://developer.mozilla.org/zh-CN/', search:'',
    tag:'技术文档', note:'由 Mozilla 维护的 Web 技术开放文档（HTML / CSS / JavaScript），web.dev 之外最常用的参考' },

  { id:'webdev', group:'开发与托管', name:'web.dev', url:'https://web.dev/', search:'',
    tag:'技术文档', note:'Google 出品的 Web 开发最佳实践：性能、可访问性、PWA 与离线能力，本站的离线方案多参考于此' },

  /* ===== 由「资源导航」并入（非网盘条目）===== */
  { id:'proletarian', group:'文献与书目', name:'无产阶级图书馆', url:'https://library.proletarian.me/', search:'', tag:'文库', note:'左翼文献聚合检索'},
  { id:'jiumodiary', group:'文献与书目', name:'鸠摩搜书', url:'https://www.jiumodiary.com/', search:'', tag:'搜书', note:'多站电子书聚合搜索'},
  { id:'feishu', group:'文献与书目', name:'持续更新的资料链接（飞书）', url:'https://ai.feishu.cn/wiki/RZOlwUONQifDkMk5saicUGMpnPH', search:'', tag:'导航', note:'Z 站 / 安娜等入口长期更新'},
  { id:'mzdbl', group:'文献与书目', name:'红军旗 · 毛泽东博览', url:'http://www.mzdbl.cn/', search:'', tag:'HTTP', note:'个人整理的毛泽东资料站（2004 年至今）'},
  { id:'wikipedia', group:'百科与课程', name:'维基百科', url:'https://zh.wikipedia.org/', search:'', tag:'百科', note:'自由的网络百科全书'},
  { id:'neteaseopen', group:'百科与课程', name:'网易公开课', url:'https://open.163.com/', search:'', tag:'课程', note:'国内外名校公开课'},
  { id:'icourse163', group:'百科与课程', name:'中国大学 MOOC', url:'https://www.icourse163.org/', search:'', tag:'课程', note:'高校在线慕课平台'},
  { id:'sumatrapdfreader', group:'工具与阅读', name:'SumatraPDF', url:'https://www.sumatrapdfreader.org/', search:'', tag:'阅读器', note:'轻量 PDF 阅读器（Win）'},
  { id:'calibreebook', group:'工具与阅读', name:'Calibre', url:'https://calibre-ebook.com/', search:'', tag:'阅读器', note:'电子书管理与转换'},
  { id:'pdfjs', group:'工具与阅读', name:'PDF.js（在线预览）', url:'https://mozilla.github.io/pdf.js/', search:'', tag:'在线', note:'浏览器内 PDF 预览'},
  { id:'xiaozhongjishu', group:'工具与阅读', name:'小众技术工具库', url:'https://www.xiaozhongjishu.com/', search:'', tag:'导航', note:'聚合导航 · 分享实用软件与精品网站'},
  { id:'sojson', group:'工具与阅读', name:'sojson 在线工具', url:'https://m.sojson.com/', search:'', tag:'在线', note:'JSON 解析 · 在线工具大全'},
  { id:'smallpdf', group:'工具与阅读', name:'Smallpdf（合并 PDF）', url:'https://smallpdf.com/merge-pdf', search:'', tag:'在线', note:'在线 PDF 合并 / 转换'},
  { id:'ilovepdf', group:'工具与阅读', name:'iLovePDF', url:'https://www.ilovepdf.com.cn/zh/', search:'', tag:'在线', note:'在线 PDF 转换 / 合并'},
  { id:'wormhole', group:'工具与阅读', name:'Wormhole', url:'https://wormhole.app/', search:'', tag:'传输', note:'端到端加密 · 临时文件传输'},
  { id:'monks', group:'工具与阅读', name:'send.monks.tools', url:'https://send.monks.tools/', search:'', tag:'传输', note:'临时加密文件传输'},
  { id:'vercel', group:'开发与托管', name:'Vercel', url:'https://vercel.com/', search:'', tag:'托管', note:'前端部署平台'},
  { id:'cfpages', group:'开发与托管', name:'Cloudflare Pages', url:'https://pages.cloudflare.com/', search:'', tag:'托管', note:'Cloudflare 静态托管'},
];
