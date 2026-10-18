<?xml version="1.0" encoding="UTF-8"?>
<!-- 学通 · feed.xml 的显示样式（让 RSS 在浏览器里明暗都可读） -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="color-scheme" content="dark light"/>
        <title><xsl:value-of select="rss/channel/title"/></title>
        <style>
          :root{ --bg:#160f12; --card:#221a1e; --fg:#f2e8d8; --dim:#b9a89a; --accent:#f5c518; --line:#3a2e33; }
          @media (prefers-color-scheme: light){ :root{ --bg:#faf5ee; --card:#ffffff; --fg:#2a2320; --dim:#6b5c50; --accent:#a06a00; --line:#e6dbcc; } }
          *{ box-sizing:border-box; }
          body{ margin:0; padding:22px 16px 60px; background:var(--bg); color:var(--fg);
                font:16px/1.75 -apple-system,"PingFang SC","Noto Serif SC",serif; }
          .wrap{ max-width:760px; margin:0 auto; }
          h1{ font-size:1.25rem; color:var(--accent); letter-spacing:1px; margin:0 0 4px; }
          .sub{ color:var(--dim); font-size:.85rem; margin:0 0 2px; }
          .note{ color:var(--dim); font-size:.78rem; margin:0 0 18px; padding-bottom:12px; border-bottom:1px solid var(--line); }
          ul{ list-style:none; padding:0; margin:0; }
          li{ background:var(--card); border:1px solid var(--line); border-radius:12px;
              padding:12px 14px; margin:0 0 10px; }
          li a{ color:var(--fg); text-decoration:none; font-weight:600; word-break:break-word; }
          li a:hover{ color:var(--accent); }
          .d{ color:var(--dim); font-size:.82rem; margin-top:4px; }
          .t{ color:var(--dim); font-size:.72rem; margin-top:6px; opacity:.8; }
          .foot{ color:var(--dim); font-size:.75rem; margin-top:22px; text-align:center; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1>📰 <xsl:value-of select="rss/channel/title"/></h1>
          <p class="sub"><xsl:value-of select="rss/channel/description"/></p>
          <p class="note">仅列最新更新（最多 10 条） · 更新时间 <xsl:value-of select="rss/channel/lastBuildDate"/></p>
          <ul>
            <xsl:for-each select="rss/channel/item">
              <li>
                <a>
                  <xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>
                  <xsl:value-of select="title"/>
                </a>
                <div class="d"><xsl:value-of select="description"/></div>
                <div class="t"><xsl:value-of select="pubDate"/></div>
              </li>
            </xsl:for-each>
          </ul>
          <p class="foot">学通 · 纯静态 · 无跟踪脚本</p>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
