package com.yuanziyuan.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.Arrays;
import java.util.Comparator;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * EPUB 目录 → 标准 .epub 字节流。
 *
 * 为什么单独一个类：学通导入 EPUB 时会解压成目录（Epub.stage），
 * 导出时必须重新打包才能被别的阅读器打开。这段逻辑不碰 Android API，
 * 所以能在普通 JVM 上直接跑测试（qa/tools/EpubPackTest.java），
 * 而不是只能靠真机验证。
 *
 * 规范要点（EPUB 3 / OCF）：
 *   1. mimetype 必须是 ZIP 里的**第一个**条目；
 *   2. 且必须**不压缩**（STORED），内容固定为 application/epub+zip。
 * 违反这两点，多数阅读器会判定「不是有效的 EPUB」。
 */
public final class EpubPack {

    private EpubPack() { }

    public static byte[] zipDir(File dir) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        ZipOutputStream zos = new ZipOutputStream(bo);
        try {
            File mt = new File(dir, "mimetype");
            if (mt.exists()) {
                byte[] b = readAllText(mt).getBytes("UTF-8");
                ZipEntry e = new ZipEntry("mimetype");
                e.setMethod(ZipEntry.STORED);
                e.setSize(b.length);
                e.setCompressedSize(b.length);
                CRC32 c = new CRC32();
                c.update(b);
                e.setCrc(c.getValue());
                zos.putNextEntry(e);
                zos.write(b);
                zos.closeEntry();
            }
            walk(dir, "", zos);
        } finally {
            try { zos.close(); } catch (Throwable ignored) { }
        }
        return bo.toByteArray();
    }

    private static void walk(File dir, String prefix, ZipOutputStream zos) throws Exception {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        Arrays.sort(fs, new Comparator<File>() {
            public int compare(File a, File b) { return a.getName().compareTo(b.getName()); }
        });
        for (File f : fs) {
            String name = f.getName();
            String path = prefix.isEmpty() ? name : prefix + "/" + name;
            if (f.isDirectory()) { walk(f, path, zos); continue; }
            if (prefix.isEmpty() && "mimetype".equals(name)) continue;   /* 已在最前面写过 */
            ZipEntry e = new ZipEntry(path);
            zos.putNextEntry(e);
            FileInputStream in = new FileInputStream(f);
            try {
                byte[] buf = new byte[8192];
                int r;
                while ((r = in.read(buf)) > 0) zos.write(buf, 0, r);
            } finally {
                try { in.close(); } catch (Throwable ignored) { }
            }
            zos.closeEntry();
        }
    }

    public static String readAllText(File f) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        FileInputStream in = new FileInputStream(f);
        try {
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
        } finally {
            try { in.close(); } catch (Throwable ignored) { }
        }
        return new String(bo.toByteArray(), "UTF-8");
    }
}
