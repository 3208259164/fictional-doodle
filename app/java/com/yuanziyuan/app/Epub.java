package com.yuanziyuan.app;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.nio.charset.Charset;
import java.util.Enumeration;

/**
 * 学通 · 零依赖 EPUB 解包与解析（0.17.36）
 *
 * 为什么不用 epublib / 任何 AAR：本项目的构建链是自研 aapt2 + javac + R8，
 * 没有 Gradle 依赖解析，引一个 AAR 等于手工造半个依赖系统。EPUB 本质就是
 * ZIP + container.xml + OPF + XHTML，java.util.zip 完全够。
 *
 * 做法：把整本解到 App 私有目录（files/books/&lt;id&gt;/），之后章节随机读取，
 * 不做「每次请求都重扫 zip」这种慢操作。
 * 安全：解包时拒绝含 ".." 或绝对路径的条目（zip slip），并把总解压体积限制在 400MB。
 */
public final class Epub {

    private static final long MAX_TOTAL = 400L * 1024 * 1024;

    private Epub() {}

    /** 先把 epub 落盘（ZipFile 才能按条目随机访问，也才能指定文件名编码） */
    public static File stage(InputStream in, File dir, String id) throws IOException {
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录");
        File out = new File(dir, id + ".epub");
        File tmp = new File(dir, id + ".epub.tmp");
        FileOutputStream fos = new FileOutputStream(tmp);
        try {
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_TOTAL) throw new IOException("文件过大");
                fos.write(buf, 0, n);
            }
        } finally { try { fos.close(); } catch (Throwable t) {} }
        if (!tmp.renameTo(out)) { try { tmp.delete(); } catch (Throwable t) {} throw new IOException("写入失败"); }
        return out;
    }

    /**
     * 解包并解析；返回的 JSON 形如 {"ok":true,"title":"...","chapters":[{"i":0,"title":"..."}]}
     *
     * 编码：中文 EPUB 有相当一部分是用 GBK 打包的（老工具、国内编辑器），
     * 而 java.util.zip 一律按指定字符集解文件名 —— 用 UTF-8 解 GBK 名字会得到一���替换字符，
     * 表现就是「能导入但章节全空 / 点开报找不到文件」。所以先按 UTF-8 试，
     * 发现条目名出现替换字符、或根本找不到 container.xml，就换 GBK 重来一遍。
     */
    public static String importTo(File epubFile, File dir) {
        String r = importWith(epubFile, dir, "UTF-8");
        /* 判据不是「条目名里有没有替换字符」——GBK 字节按 UTF-8 解出来是一堆 cp437 可见字符，
           看起来正常但目录层级全错，结果是「能导入、章节 0 条」。
           所以真正的判据是：能不能解析出章节。解析不出就换 GBK 重来。 */
        if (hasChapters(r)) return r;
        String r2 = importWith(epubFile, dir, "GBK");
        if (hasChapters(r2)) return r2;
        if (r.indexOf("\"ok\":true") >= 0) return r;
        if (r2.indexOf("\"ok\":true") >= 0) return r2;
        return r;   /* 两种都不行，报第一次的错误（更可能是真损坏而不是编码问题） */
    }

    /** 结果里是否真的解析出了章节 */
    private static boolean hasChapters(String json) {
        if (json == null) return false;
        int i = json.indexOf("\"count\":");
        if (i < 0) return false;
        try {
            int n = Integer.parseInt(json.substring(i + 8).replaceAll("[^0-9].*$", ""));
            return n > 0;
        } catch (Throwable t) { return false; }
    }

    private static String importWith(File epubFile, File dir, String charset) {
        try {
            if (dir.exists()) deleteTree(dir);
            if (!dir.mkdirs()) return err("无法创建目录");
            ZipFile zf = new ZipFile(epubFile, Charset.forName(charset));
            try {
                long total = 0;
                boolean badName = false;
                Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    String name = e.getName();
                    if (name == null || name.length() == 0) continue;
                    if (name.indexOf('\uFFFD') >= 0) badName = true;
                    String norm = name.replace('\\', '/');
                    if (norm.startsWith("/") || norm.indexOf("../") >= 0 || norm.equals("..")) continue;
                    if (e.isDirectory()) { new File(dir, norm).mkdirs(); continue; }
                    File out = new File(dir, norm);
                    File parent = out.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    InputStream zin = zf.getInputStream(e);
                    FileOutputStream fos = new FileOutputStream(out);
                    try {
                        byte[] buf = new byte[32768];
                        int n;
                        while ((n = zin.read(buf)) > 0) {
                            total += n;
                            if (total > MAX_TOTAL) throw new IOException("解压后超过 400MB");
                            fos.write(buf, 0, n);
                        }
                    } finally { try { zin.close(); } catch (Throwable t) {} try { fos.close(); } catch (Throwable t) {} }
                }
                if (badName && "UTF-8".equals(charset)) return err("文件名编码不是 UTF-8");
            } finally { try { zf.close(); } catch (Throwable t) {} }

            String opfPath = findOpf(dir);
            if (opfPath == null) return err("不是有效的 EPUB（找不到 container.xml / OPF）");
            String opf = readText(new File(dir, opfPath));
            String base = opfPath.indexOf('/') >= 0 ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : "";

            String title = tag(opf, "dc:title");
            if (title == null || title.length() == 0) title = tag(opf, "title");
            if (title == null || title.length() == 0) title = "未命名";

            // manifest: id -> href
            Map<String, String> hrefById = new LinkedHashMap<String, String>();
            Matcher mi = Pattern.compile("<item\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(opf);
            while (mi.find()) {
                String tag = mi.group();
                String id = attr(tag, "id");
                String href = attr(tag, "href");
                if (id != null && href != null) hrefById.put(id, href);
            }
            // spine 顺序
            List<String> order = new ArrayList<String>();
            Matcher si = Pattern.compile("<itemref\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(opf);
            while (si.find()) {
                String idref = attr(si.group(), "idref");
                if (idref != null && hrefById.containsKey(idref)) order.add(hrefById.get(idref));
            }
            if (order.isEmpty()) return err("EPUB 的 spine 为空");

            List<String> titles = tocTitles(dir, base, opf, hrefById);

            StringBuilder sb = new StringBuilder();
            sb.append("{\"ok\":true,\"title\":").append(q(title));
            sb.append(",\"chapters\":[");
            int n = 0;
            for (int i = 0; i < order.size(); i++) {
                String href = order.get(i);
                File f = new File(dir, joinPath(base, href));
                if (!f.exists() || !f.isFile()) continue;
                if (n > 0) sb.append(',');
                sb.append("{\"i\":").append(i).append(",\"title\":").append(q(titles.get(i)));
                sb.append(",\"href\":").append(q(href)).append('}');
                n++;
            }
            sb.append("],\"count\":").append(n).append('}');
            writeText(new File(dir, "_toc.json"), sb.toString());
            StringBuilder mp = new StringBuilder();
            for (int i2 = 0; i2 < order.size(); i2++) {
                File f2 = new File(dir, joinPath(base, order.get(i2)));
                if (f2.exists() && f2.isFile()) mp.append(i2).append('\t').append(order.get(i2)).append('\n');
            }
            writeText(new File(dir, "_chapters.txt"), mp.toString());
            return sb.toString();
        } catch (Throwable e) {
            return err(msg(e));
        }
    }

    /** 取某一章正文（已剥 script/style/事件属性，只留结构化 HTML） */
    public static String chapterHTML(File dir, int idx) {
        try {
            /* 优先用导入时落下的 _chapters.txt（index\thref 逐行），
               避免每次翻章都重读 OPF 再跑一遍正则。纯文本，不依赖 org.json。 */
            File map = new File(dir, "_chapters.txt");
            if (map.exists()) {
                String[] lines = readText(map).split("\n");
                for (String ln : lines) {
                    int tb = ln.indexOf('\t');
                    if (tb <= 0) continue;
                    if (parseIntSafe(ln.substring(0, tb).trim(), -1) != idx) continue;
                    String href = ln.substring(tb + 1).trim();
                    String opfPath2 = readText(new File(dir, "_opf.txt")).trim();
                    String base2 = opfPath2.indexOf('/') >= 0 ? opfPath2.substring(0, opfPath2.lastIndexOf('/') + 1) : "";
                    File f2 = new File(dir, joinPath(base2, href));
                    if (!f2.exists()) return "<p class=\"sub\">章节文件缺失</p>";
                    return clean(readText(f2));
                }
                return "<p class=\"sub\">章节不存在</p>";
            }
            String opfPath = readText(new File(dir, "_opf.txt")).trim();
            String base = opfPath.indexOf('/') >= 0 ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : "";
            String opf = readText(new File(dir, opfPath));
            Map<String, String> hrefById = new LinkedHashMap<String, String>();
            Matcher mi = Pattern.compile("<item\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(opf);
            while (mi.find()) {
                String t = mi.group();
                String id = attr(t, "id"), href = attr(t, "href");
                if (id != null && href != null) hrefById.put(id, href);
            }
            List<String> order = new ArrayList<String>();
            Matcher si = Pattern.compile("<itemref\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(opf);
            while (si.find()) {
                String idref = attr(si.group(), "idref");
                if (idref != null && hrefById.containsKey(idref)) order.add(hrefById.get(idref));
            }
            if (idx < 0 || idx >= order.size()) return "<p class=\"sub\">章节不存在</p>";
            File f = new File(dir, joinPath(base, order.get(idx)));
            if (!f.exists()) return "<p class=\"sub\">章节文件缺失</p>";
            return clean(readText(f));
        } catch (Throwable e) {
            return "<p class=\"sub\">读取失败：" + msg(e) + "</p>";
        }
    }

    /* ---------------- 内部 ---------------- */

    private static String findOpf(File dir) throws IOException {
        File c = new File(dir, "META-INF/container.xml");
        if (c.exists()) {
            String x = readText(c);
            Matcher m = Pattern.compile("full-path\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(x);
            if (m.find()) {
                String p = m.group(1);
                if (new File(dir, p).exists()) {
                    writeText(new File(dir, "_opf.txt"), p);
                    return p;
                }
            }
        }
        // 兜底：目录里任意 .opf
        File[] fs = dir.listFiles();
        if (fs != null) for (File f : fs) {
            if (f.isFile() && f.getName().toLowerCase().endsWith(".opf")) {
                writeText(new File(dir, "_opf.txt"), f.getName());
                return f.getName();
            }
        }
        return null;
    }

    /** 目录标题：优先 nav.xhtml / toc.ncx，失败则逐章读 <title> 或首个 h1-h3 */
    private static List<String> tocTitles(File dir, String base, String opf, Map<String, String> hrefById) {
        List<String> out = new ArrayList<String>();
        Map<String, String> byHref = new LinkedHashMap<String, String>();
        // nav.xhtml
        String nav = null;
        try {
            Matcher m = Pattern.compile("<item\\b[^>]*properties\\s*=\\s*[\"'][^\"']*\\bnav\\b[^\"']*[\"'][^>]*>", Pattern.CASE_INSENSITIVE).matcher(opf);
            if (m.find()) nav = attr(m.group(), "href");
        } catch (Throwable t) {}
        String[] cands = nav != null ? new String[]{nav, "toc.ncx", "nav.xhtml", "toc.xhtml"} : new String[]{"toc.ncx", "nav.xhtml", "toc.xhtml"};
        for (String c : cands) {
            File f = new File(dir, joinPath(base, c));
            if (!f.exists()) continue;
            try {
                String html = readText(f);
                Matcher a = Pattern.compile("<a\\b[^>]*href\\s*=\\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL).matcher(html);
                while (a.find()) {
                    String h = a.group(1); int k = h.indexOf('#'); if (k >= 0) h = h.substring(0, k);
                    String t = stripTags(a.group(2));
                    if (t.length() > 0) byHref.put(h, t);
                }
                Matcher nb = Pattern.compile("<navPoint\\b[\\s\\S]*?<text>(.*?)</text>[\\s\\S]*?src\\s*=\\s*[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE).matcher(html);
                while (nb.find()) {
                    String t = stripTags(nb.group(1)); String h = nb.group(2); int k = h.indexOf('#'); if (k >= 0) h = h.substring(0, k);
                    if (t.length() > 0 && !byHref.containsKey(h)) byHref.put(h, t);
                }
            } catch (Throwable t) {}
            if (!byHref.isEmpty()) break;
        }
        // 组装：按 spine 顺序，取不到就退化为「第 N 章」
        String opf2 = opf;
        Matcher si = Pattern.compile("<itemref\\b[^>]*>", Pattern.CASE_INSENSITIVE).matcher(opf2);
        int i = 0;
        while (si.find()) {
            String idref = attr(si.group(), "idref");
            String href = idref == null ? null : hrefById.get(idref);
            String t = href == null ? null : byHref.get(href);
            if (t == null && href != null) {
                File f = new File(dir, joinPath(base, href));
                if (f.exists()) {
                    try {
                        String h = readText(f);
                        t = tag(h, "title");
                        if (t == null) t = tag(h, "h1");
                        if (t == null) t = tag(h, "h2");
                        if (t == null) t = tag(h, "h3");
                        if (t != null) t = stripTags(t);
                    } catch (Throwable e) {}
                }
            }
            if (t == null || t.length() == 0) t = "第 " + (i + 1) + " 节";
            out.add(t);
            i++;
        }
        return out;
    }

    /** 只留 body 内的结构化标签，剥掉脚本/样式/事件属性/外链 */
    static String clean(String html) {
        String s = html;
        /* CDATA：在 XHTML 里是「原样文本」，但塞进 HTML 上下文会被解析成注释 —— 整段内容凭空消失。
           这里先把包裹去掉，留下内容本身。 */
        s = s.replaceAll("(?is)<!\\[CDATA\\[", "").replaceAll("(?is)\\]\\]>", "");
        /* 自闭合的 script/style：HTML 解析器不认 <script/>，会把它当开标签，把后面所有内容吞进去。
           注意不能只写 <script/>——要先连成对的形式一起清掉。 */
        s = s.replaceAll("(?is)<script\\b[^>]*/>", "");
        s = s.replaceAll("(?is)<style\\b[^>]*/>", "");
        s = s.replaceAll("(?is)<script[^>]*>.*?</script>", "");
        s = s.replaceAll("(?is)<style[^>]*>.*?</style>", "");
        s = s.replaceAll("(?is)<head[^>]*>.*?</head>", "");
        s = s.replaceAll("(?is)<!DOCTYPE[^>]*>", "");
        s = s.replaceAll("(?is)<!--.*?-->", "");
        Matcher b = Pattern.compile("(?is)<body[^>]*>(.*)</body>").matcher(s);
        if (b.find()) s = b.group(1);
        s = s.replaceAll("(?i)\\son\\w+\\s*=\\s*(\"[^\"]*\"|'[^']*')", "");
        s = s.replaceAll("(?i)(href|src)\\s*=\\s*(\"|')\\s*javascript:[^\"']*(\"|')", "");
        return s.trim();
    }

    private static int parseIntSafe(String s, int def) {
        try { return Integer.parseInt(s.trim()); } catch (Throwable t) { return def; }
    }

    static String readText(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } finally { try { in.close(); } catch (Throwable t) {} }
    }

    static void writeText(File f, String s) throws IOException {
        FileOutputStream fos = new FileOutputStream(f);
        try { fos.write(s.getBytes("UTF-8")); } finally { try { fos.close(); } catch (Throwable t) {} }
    }

    static void deleteTree(File f) {
        try {
            File[] fs = f.listFiles();
            if (fs != null) for (File x : fs) deleteTree(x);
            f.delete();
        } catch (Throwable t) {}
    }

    private static String joinPath(String base, String href) {
        String h = href;
        try { h = java.net.URLDecoder.decode(href, "UTF-8"); } catch (Throwable t) {}
        if (base == null || base.length() == 0) return h;
        return base + h;
    }

    static String attr(String tag, String name) {
        Matcher m = Pattern.compile("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", Pattern.CASE_INSENSITIVE).matcher(tag);
        if (m.find()) return m.group(2) != null ? m.group(2) : m.group(3);
        return null;
    }

    static String tag(String s, String name) {
        Matcher m = Pattern.compile("(?is)<" + name + "[^>]*>(.*?)</" + name + ">").matcher(s);
        return m.find() ? m.group(1) : null;
    }

    static String stripTags(String s) {
        if (s == null) return "";
        String t = s.replaceAll("(?s)<[^>]*>", "");
        t = t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"");
        return t.replaceAll("\\s+", " ").trim();
    }

    static String q(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(" ");
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private static String err(String m) { return "{\"ok\":false,\"error\":" + q(m) + "}"; }

    private static String msg(Throwable e) {
        String m = e.getMessage();
        return (m == null || m.length() == 0) ? e.getClass().getSimpleName() : m;
    }
}
