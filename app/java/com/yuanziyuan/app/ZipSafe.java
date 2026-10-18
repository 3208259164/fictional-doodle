package com.yuanziyuan.app;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 网站包解压的**安全内核**（纯 JDK，不依赖 Android，可单独做单元测试）。
 * 见 tools/ZipSafeTest.java（用真实攻击样本验证：Zip Slip / 绝对路径 / zip 炸弹 / 兄弟目录绕过）。
 */
public final class ZipSafe {

    private ZipSafe() {}

    public static class TooLarge extends Exception {
        public TooLarge(String m) { super(m); }
    }

    public static class Unsafe extends Exception {
        public Unsafe(String m) { super(m); }
    }

    /**
     * 把 zip 解压到 stage 目录。
     * 防护：规范化路径前缀校验（Zip Slip，含「兄弟目录」绕过）、绝对路径、空字节、
     *       文件数上限、解压总量上限（zip 炸弹）。任一违规即抛异常并中止。
     */
    public static int extractZip(File zip, File stage, int maxFiles, long maxTotal) throws Exception {
        if (stage == null || !stage.exists() && !stage.mkdirs()) throw new Exception("无法创建解压目录");
        final String stageCan = stage.getCanonicalPath();
        final String prefix = stageCan.endsWith(File.separator) ? stageCan : stageCan + File.separator;
        ZipInputStream zin = new ZipInputStream(new FileInputStream(zip));
        int files = 0;
        long total = 0;
        try {
            ZipEntry ze;
            byte[] buf = new byte[1 << 16];
            while ((ze = zin.getNextEntry()) != null) {
                String n = ze.getName();
                if (n == null) continue;
                n = n.replace('\\', '/');
                if (n.indexOf('\0') >= 0) throw new Unsafe("压缩包内含非法字符");
                while (n.startsWith("/")) n = n.substring(1);
                if (n.isEmpty() || n.endsWith("/")) continue;                 /* 目录项 */
                if (n.contains("..")) throw new Unsafe("压缩包内含穿越路径，已拒绝：" + n);
                if (isAbsoluteLike(n)) throw new Unsafe("压缩包内含绝对路径，已拒绝：" + n);

                File out = new File(stage, n);
                String outCan = out.getCanonicalPath();
                /* 关键：先规范化再比对，且必须带分隔符，挡住 /sites/A 与 /sites/AB 式绕过 */
                if (!outCan.startsWith(prefix)) throw new Unsafe("压缩包试图跳出解压目录，已拒绝：" + n);

                File par = out.getParentFile();
                if (par != null && !par.exists() && !par.mkdirs()) throw new Exception("无法创建目录：" + n);

                if (++files > maxFiles) throw new TooLarge("文件数超过上限 " + maxFiles);
                FileOutputStream fo = new FileOutputStream(out);
                try {
                    int c;
                    while ((c = zin.read(buf)) > 0) {
                        total += c;
                        if (total > maxTotal) throw new TooLarge("解压总量超过上限，疑似 zip 炸弹");
                        fo.write(buf, 0, c);
                    }
                } finally { fo.close(); }
                zin.closeEntry();
            }
        } finally {
            try { zin.close(); } catch (Throwable ignored) {}
        }
        return files;
    }

    /** Windows 盘符（C:/）等绝对路径形态 */
    private static boolean isAbsoluteLike(String n) {
        return n.length() >= 2 && n.charAt(1) == ':' && Character.isLetter(n.charAt(0));
    }

    /** 递归收集相对路径（正斜杠） */
    public static void walk(File dir, String prefix, List<String> out) {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            String rel = prefix.isEmpty() ? f.getName() : prefix + "/" + f.getName();
            if (f.isDirectory()) walk(f, rel, out);
            else if (f.isFile()) out.add(rel);
        }
    }

    /** 选主页面：优先根 index.html；其次第一个 .html；再退到「顶层唯一目录」形态 */
    public static String pickEntry(List<String> paths) {
        if (paths.contains("index.html")) return "index.html";
        List<String> html = new ArrayList<String>();
        for (String p : paths) {
            String l = p.toLowerCase();
            if (l.endsWith(".html") || l.endsWith(".htm")) html.add(p);
        }
        Collections.sort(html);
        if (!html.isEmpty()) return html.get(0);
        Map<String, Integer> tops = new HashMap<String, Integer>();
        boolean allNested = !paths.isEmpty();
        for (String p : paths) {
            int i = p.indexOf('/');
            if (i <= 0) { allNested = false; break; }
            String t = p.substring(0, i);
            Integer v = tops.get(t);
            tops.put(t, v == null ? 1 : v + 1);
        }
        if (allNested && tops.size() == 1) {
            String top = tops.keySet().iterator().next();
            if (paths.contains(top + "/index.html")) return top + "/index.html";
        }
        return paths.isEmpty() ? "index.html" : paths.get(0);
    }

    public static boolean hasIndexAt(File base, String top) {
        return new File(new File(base, top), "index.html").isFile();
    }

    /** 移动目录（renameTo 失败时退回复制） */
    public static boolean moveDir(File src, File dst) {
        if (src == null || !src.exists()) return false;
        if (src.renameTo(dst)) return true;
        try {
            if (!dst.exists() && !dst.mkdirs()) return false;
            File[] fs = src.listFiles();
            if (fs == null) return false;
            for (File f : fs) {
                File t = new File(dst, f.getName());
                if (f.isDirectory()) { if (!moveDir(f, t)) return false; }
                else {
                    InputStream in = new FileInputStream(f);
                    OutputStream o = new FileOutputStream(t);
                    byte[] b = new byte[1 << 16]; int n;
                    while ((n = in.read(b)) > 0) o.write(b, 0, n);
                    in.close(); o.close();
                }
            }
            deleteRec(src);
            return true;
        } catch (Throwable t) { return false; }
    }

    public static void deleteRec(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] fs = f.listFiles();
            if (fs != null) for (File c : fs) deleteRec(c);
        }
        f.delete();
    }
}
