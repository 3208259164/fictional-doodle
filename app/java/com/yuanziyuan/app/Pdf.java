package com.yuanziyuan.app;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Comparator;

/**
 * 学通 · 零依赖 PDF 逐页渲染（0.17.37 重做）
 *
 * 用系统自带的 android.graphics.pdf.PdfRenderer（API 21+，零第三方库、零联网）。
 *
 * 为什么不再把页图做成 base64 回传网页（0.17.36 的写法已废）：
 *   一页 A4 按 2 倍宽渲染是 1190×1684 的 ARGB_8888 位图 = 8.0MB；压成 JPEG 约 300~600KB；
 *   base64 再 ×1.33；然后这个字符串要经「Java String → JNI UTF-8 → V8 字符串 → JS 拼 data URI
 *   → WebView 解码成新位图」四五份拷贝，单页峰值 15~20MB。而且 data: 图不进图片缓存、
 *   不降采样、滑过去也不释放 —— 连续翻二十页在 3GB 机型上必然 OOM。
 *   现在改成：渲染到私有目录的 JPEG 文件，网页用同源 https 地址
 *   https://appassets.androidplatform.net/_bookpage/<id>/<页>-<宽>.jpg 直接取，
 *   走 WebView 自己的图片管线（可流式、可缓存、可降采样），桥只回几百字节元信息。
 *
 * 三个必须遵守的硬约束：
 *   ① PdfRenderer 只接受 ARGB_8888，传 RGB_565 直接抛 IllegalArgumentException；
 *   ② 构造必须传可 seek 的 ParcelFileDescriptor —— SAF 的 content:// 常是管道，所以先落盘；
 *   ③ 加密 PDF 抛 SecurityException（非受检），且有「污染同进程后续实例」的已知报告，
 *      所以每次渲染独立新建/关闭 renderer，并且 fd 交给 renderer 拥有，不重复 close。
 */
public final class Pdf {

    private static final long CACHE_MAX = 96L * 1024 * 1024;   /* 页图缓存上限 96MB，超了删最旧 */

    private Pdf() {}

    /** 把 uri 指向的文件拷进 App 私有目录，返回落地后的 File */
    public static File stage(InputStream in, File dir, String id) throws Exception {
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("无法创建目录");
        File out = new File(dir, id + ".pdf");
        File tmp = new File(dir, id + ".pdf.tmp");
        FileOutputStream fos = new FileOutputStream(tmp);
        try {
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 512L * 1024 * 1024) throw new Exception("文件超过 512MB");
                fos.write(buf, 0, n);
            }
        } finally { try { fos.close(); } catch (Throwable t) {} }
        if (!tmp.renameTo(out)) { try { tmp.delete(); } catch (Throwable t) {} throw new Exception("写入失败"); }
        return out;
    }

    /** 元信息：{"ok":true,"pages":123,"w":595,"h":842} */
    public static String info(File pdf) {
        PdfRenderer r = null;
        try {
            ParcelFileDescriptor fd = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY);
            /* PdfRenderer 会接管 fd 的所有权：close() 时一并关闭，所以这里不再单独 close fd */
            r = new PdfRenderer(fd);
            StringBuilder sb = new StringBuilder();
            sb.append("{\"ok\":true,\"pages\":").append(r.getPageCount());
            if (r.getPageCount() > 0) {
                PdfRenderer.Page p = r.openPage(0);
                try {
                    sb.append(",\"w\":").append(p.getWidth()).append(",\"h\":").append(p.getHeight());
                } finally { try { p.close(); } catch (Throwable t) {} }
            }
            return sb.append('}').toString();
        } catch (Throwable e) {
            return "{\"ok\":false,\"error\":" + Epub.q(msg(e)) + "}";
        } finally {
            if (r != null) try { r.close(); } catch (Throwable t) {}
        }
    }

    /**
     * 渲染第 idx 页到 outFile（JPEG）。返回 {"ok":true,"w":..,"h":..,"pages":..,"bytes":..}
     * 原子替换：先写 .tmp 再 rename，避免网页读到写了一半的图（会显示灰块）。
     */
    public static String renderTo(File pdf, int idx, int targetW, File outFile) {
        return renderTo(pdf, idx, targetW, outFile, false);
    }

    /**
     * @param night 夜间模式：把白纸底映射成深底、黑字映射成浅字（像素级，不是盖一层色）。
     *              扫描件在夜里就是一张亮白纸，只把容器调暗毫无意义——必须改像素。
     */
    public static String renderTo(File pdf, int idx, int targetW, File outFile, boolean night) {
        PdfRenderer r = null;
        File tmp = new File(outFile.getAbsolutePath() + ".tmp");
        try {
            ParcelFileDescriptor fd = ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY);
            r = new PdfRenderer(fd);
            int n = r.getPageCount();
            if (idx < 0 || idx >= n) return "{\"ok\":false,\"error\":\"页码超出范围\",\"pages\":" + n + "}";
            PdfRenderer.Page p = r.openPage(idx);
            try {
                int pw = p.getWidth(), ph = p.getHeight();
                if (pw <= 0 || ph <= 0) return "{\"ok\":false,\"error\":\"页面尺寸异常\"}";
                int w = targetW > 0 ? targetW : 780;
                if (w > pw * 2) w = pw * 2;                 /* 不放大超过原始 2 倍，白费内存 */
                int h = (int) Math.round((double) ph * w / (double) pw);
                if (h > 8000) h = 8000;
                /* 必须先铺白底：PDF 页面透明区域在深色主题下会显示成黑的 */
                Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                try {
                    bmp.eraseColor(Color.WHITE);
                    p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    if (night) applyNight(bmp);
                    File parent = outFile.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    FileOutputStream fos = new FileOutputStream(tmp);
                    try {
                        bmp.compress(Bitmap.CompressFormat.JPEG, 82, fos);
                    } finally { try { fos.close(); } catch (Throwable t) {} }
                } finally { try { bmp.recycle(); } catch (Throwable t) {} }
            } finally { try { p.close(); } catch (Throwable t) {} }
            if (!tmp.renameTo(outFile)) {
                try { outFile.delete(); } catch (Throwable t) {}
                if (!tmp.renameTo(outFile)) { try { tmp.delete(); } catch (Throwable t) {} return "{\"ok\":false,\"error\":\"写入页图失败\"}"; }
            }
            prune(outFile.getParentFile());
            return "{\"ok\":true,\"w\":" + 0 + ",\"h\":" + 0 + ",\"pages\":" + n + ",\"bytes\":" + outFile.length() + "}";
        } catch (Throwable e) {
            try { tmp.delete(); } catch (Throwable t) {}
            return "{\"ok\":false,\"error\":" + Epub.q(msg(e)) + "}";
        } finally {
            if (r != null) try { r.close(); } catch (Throwable t) {}
        }
    }

    /** 页图缓存上限：超了按最后修改时间删最旧的文件，避免读一本厚书把手机塞满 */
    /**
     * 夜间映射。思路：灰阶内容（纸底、正文）按亮度从「深底」到「浅字」线性映射；
     * 彩色内容（印章、图表、彩色插图）只压暗、保留色相，免得整页变灰。
     */
    private static void applyNight(Bitmap bmp) {
        int w = bmp.getWidth(), h = bmp.getHeight();
        if (w <= 0 || h <= 0) return;
        int[] px = new int[w * h];
        try { bmp.getPixels(px, 0, w, 0, 0, w, h); } catch (Throwable t) { return; }
        final int bgR = 23, bgG = 22, bgB = 26;        /* #17161a 近黑偏暖 */
        final int fgR = 200, fgG = 196, fgB = 188;     /* #c8c4bc 浅灰，不是纯白 */
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            int r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
            int mx = Math.max(r, Math.max(g, b)), mn = Math.min(r, Math.min(g, b));
            if (mx - mn > 48) {
                r = (r * 72) / 100; g = (g * 72) / 100; b = (b * 72) / 100;
            } else {
                int lum = (r * 77 + g * 150 + b * 29) >> 8;   /* 0~255 */
                int t = 255 - lum;
                r = bgR + (fgR - bgR) * t / 255;
                g = bgG + (fgG - bgG) * t / 255;
                b = bgB + (fgB - bgB) * t / 255;
            }
            px[i] = 0xff000000 | (r << 16) | (g << 8) | b;
        }
        try { bmp.setPixels(px, 0, w, 0, 0, w, h); } catch (Throwable t) { }
    }

    private static void prune(File dir) {
        try {
            if (dir == null) return;
            File[] fs = dir.listFiles();
            if (fs == null || fs.length < 8) return;
            long total = 0;
            for (File f : fs) total += f.length();
            if (total <= CACHE_MAX) return;
            Arrays.sort(fs, new Comparator<File>() {
                public int compare(File a, File b) { return Long.compare(a.lastModified(), b.lastModified()); }
            });
            for (File f : fs) {
                if (total <= CACHE_MAX) break;
                long len = f.length();
                if (f.delete()) total -= len;
            }
        } catch (Throwable ignored) {}
    }

    private static String msg(Throwable e) {
        String m = e.getMessage();
        return (m == null || m.length() == 0) ? e.getClass().getSimpleName() : m;
    }
}
