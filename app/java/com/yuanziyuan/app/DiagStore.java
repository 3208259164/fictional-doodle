package com.yuanziyuan.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import java.io.File;
import java.text.SimpleDateFormat;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.BufferedReader;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedList;
import java.util.Locale;
import java.util.TimeZone;

/**
 * 学通 App · 本机诊断存储（崩溃落盘 + 面包屑 + 启动自检 + 安全模式）
 *
 * 为什么要这一层：
 *   网页层的 window.onerror 只能记录「页面还在」时的脚本错误。一旦进程被杀、
 *   WebView 渲染进程崩溃、或 Java 层抛未捕获异常，页面根本没有机会写任何东西，
 *   用户点「导出诊断报告」时看到的是「一切正常」。业界（Firefox / Crashlytics /
 *   ACRA / Obsidian 本地日志）的统一做法是：崩溃瞬间由宿主把现场写进文件，
 *   下次启动再读出来提示用户。
 *
 * 本实现的边界（离线、不联网、不上传）：
 *   - 只写 App 私有目录 files/diag/，不申请任何权限；
 *   - 崩溃报告只在下次启动时由页面读取展示，导出由用户主动触发；
 *   - 环形保留：崩溃报告最多 10 份，面包屑最多 60 条。
 */
public final class DiagStore {

    private static final String SP = "yz_diag";
    private static final String DIR = "diag";
    private static final int MAX_CRASH_FILES = 10;
    private static final int MAX_BREAD = 60;
    private static final Object LOCK = new Object();

    private static final LinkedList<String> BREAD = new LinkedList<String>();
    private static Context app;
    private static String verInfo = "";
    private static volatile long lastBreadMs = 0L;
    private static boolean installed = false;
    private static volatile int unflushed = 0;

    private DiagStore() {}

    /* ---------------- 初始化 ---------------- */

    /** 在 Application.onCreate 里调用：装上未捕获异常处理器（进程级兜底）。 */
    public static void install(Context c, String versionInfo) {
        try {
            app = c.getApplicationContext();
            verInfo = versionInfo == null ? "" : versionInfo;
            if (installed) return;
            installed = true;
            final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
                @Override public void uncaughtException(Thread t, Throwable e) {
                    try { writeCrash(t, e, "uncaught"); } catch (Throwable ignored) {}
                    try { if (prev != null) { prev.uncaughtException(t, e); return; } } catch (Throwable ignored) {}
                    try { android.os.Process.killProcess(android.os.Process.myPid()); } catch (Throwable ignored) {}
                    try { System.exit(10); } catch (Throwable ignored) {}
                }
            });
        } catch (Throwable ignored) {}
    }

    /* ---------------- 路径与基础 IO ---------------- */

    private static File dir(Context c) {
        File d = new File(c.getFilesDir(), DIR);
        try { if (!d.exists()) d.mkdirs(); } catch (Throwable ignored) {}
        return d;
    }

    private static String ts() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
        try { f.setTimeZone(TimeZone.getDefault()); } catch (Throwable ignored) {}
        return f.format(new Date());
    }

    private static String tsFile() {
        SimpleDateFormat f = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US);
        return f.format(new Date());
    }

    private static String hm() {
        SimpleDateFormat f = new SimpleDateFormat("HH:mm:ss", Locale.US);
        return f.format(new Date());
    }

    private static boolean writeText(File f, String text) {
        FileOutputStream o = null;
        try {
            o = new FileOutputStream(f, false);
            o.write(text.getBytes("UTF-8"));
            o.flush();
            return true;
        } catch (Throwable t) {
            return false;
        } finally {
            try { if (o != null) o.close(); } catch (Throwable ignored) {}
        }
    }

    private static String readText(File f, int maxChars) {
        BufferedReader r = null;
        try {
            StringBuilder sb = new StringBuilder();
            r = new BufferedReader(new FileReader(f));
            char[] buf = new char[4096];
            int n;
            while ((n = r.read(buf)) > 0) {
                sb.append(buf, 0, n);
                if (sb.length() > maxChars) break;
            }
            String s = sb.toString();
            return s.length() > maxChars ? s.substring(0, maxChars) + "\n…（已截断）" : s;
        } catch (Throwable t) {
            return "";
        } finally {
            try { if (r != null) r.close(); } catch (Throwable ignored) {}
        }
    }

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(SP, Context.MODE_PRIVATE);
    }

    /* ---------------- 面包屑（崩溃前的操作序列） ---------------- */

    /**
     * 记录一步操作。网页侧每次点击/跳页都会调它；Java 侧在关键节点（渲染进程崩溃、
     * 页面加载失败、导出失败）也记一条。限频：同一毫秒只收一条，避免日志被刷爆。
     */
    public static void bread(Context c, String what) {
        try {
            if (c == null) return;
            if (what == null) return;
            String s = what.trim();
            if (s.length() == 0) return;
            if (s.length() > 160) s = s.substring(0, 160);
            long now = System.currentTimeMillis();
            if (now - lastBreadMs < 120) return;
            lastBreadMs = now;
            synchronized (LOCK) {
                BREAD.addLast(hm() + "  " + s);
                while (BREAD.size() > MAX_BREAD) BREAD.removeFirst();
                unflushed++;
            }
            if (unflushed >= 12) flushBread(c);
        } catch (Throwable ignored) {}
    }

    /** 把内存里的面包屑落到 bread.txt（崩溃时也会调一次）。 */
    public static void flushBread(Context c) {
        try {
            if (c == null) return;
            StringBuilder sb = new StringBuilder();
            synchronized (LOCK) {
                for (String l : BREAD) sb.append(l).append('\n');
                unflushed = 0;
            }
            writeText(new File(dir(c), "bread.txt"), sb.toString());
        } catch (Throwable ignored) {}
    }

    private static String breadText(Context c) {
        StringBuilder sb = new StringBuilder();
        synchronized (LOCK) {
            if (BREAD.isEmpty() && c != null) {
                String old = readText(new File(dir(c), "bread.txt"), 6000);
                if (old.length() > 0) sb.append(old);
            } else {
                for (String l : BREAD) sb.append(l).append('\n');
            }
        }
        if (sb.length() == 0) return "（无记录）";
        return sb.toString();
    }

    /* ---------------- 崩溃落盘 ---------------- */

    /** 供 onRenderProcessGone 等「Java 侧观察到但进程没死」的场合调用。 */
    public static void writeRenderCrash(Context c, String note) {
        try {
            StringBuilder sb = new StringBuilder();
            sb.append("学通 崩溃报告（渲染进程）\n");
            sb.append("时间: ").append(ts()).append('\n');
            sb.append("版本: ").append(verInfo).append('\n');
            sb.append("说明: ").append(note == null ? "WebView 渲染进程异常终止" : note).append('\n');
            sb.append("设备: ").append(deviceLine()).append('\n');
            sb.append("\n---- 最近操作 ----\n").append(breadText(c)).append('\n');
            save(sb.toString(), "render");
            bread(c, "渲染进程崩溃：" + (note == null ? "" : note));
        } catch (Throwable ignored) {}
    }

    private static void writeCrash(Thread t, Throwable e, String kind) {
        try {
            StringBuilder sb = new StringBuilder();
            sb.append("学通 崩溃报告\n");
            sb.append("时间: ").append(ts()).append('\n');
            sb.append("版本: ").append(verInfo).append('\n');
            sb.append("设备: ").append(deviceLine()).append('\n');
            sb.append("线程: ").append(t == null ? "?" : (t.getName() + " / id=" + t.getId())).append('\n');
            sb.append("类型: ").append(kind).append('\n');
            sb.append("异常: ").append(e == null ? "(null)" : e.toString()).append('\n');
            sb.append("\n---- 堆栈 ----\n");
            if (e != null) {
                StackTraceElement[] st = e.getStackTrace();
                for (int i = 0; i < st.length && i < 60; i++) sb.append("  at ").append(st[i].toString()).append('\n');
                Throwable cause = e.getCause();
                int depth = 0;
                while (cause != null && depth < 5) {
                    sb.append("Caused by: ").append(cause.toString()).append('\n');
                    StackTraceElement[] cs = cause.getStackTrace();
                    for (int i = 0; i < cs.length && i < 20; i++) sb.append("  at ").append(cs[i].toString()).append('\n');
                    cause = cause.getCause();
                    depth++;
                }
            }
            sb.append("\n---- 最近操作（最新在下） ----\n").append(breadText(app)).append('\n');
            sb.append("\n---- 提示 ----\n");
            sb.append("本文件由 App 自动写入，仅存本机、不会上传。\n");
            sb.append("下次打开「学通」会提示上次异常退出，可在「设置 → 诊断与日志」导出。\n");
            save(sb.toString(), kind);
        } catch (Throwable ignored) {}
    }

    private static void save(String text, String kind) {
        try {
            if (app == null) return;
            File f = new File(dir(app), "crash-" + tsFile() + "-" + kind + ".txt");
            writeText(f, text);
            try { sp(app).edit().putString("lastCrashAt", ts()).putString("lastCrashFile", f.getName()).putBoolean("crashUnseen", true).commit(); } catch (Throwable ignored) {}
            prune();
        } catch (Throwable ignored) {}
    }

    private static String deviceLine() {
        try {
            String abi = (Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0) ? Build.SUPPORTED_ABIS[0] : "";
            return Build.MANUFACTURER + " " + Build.MODEL + " | Android " + Build.VERSION.RELEASE
                    + " (SDK " + Build.VERSION.SDK_INT + ") | " + abi;
        } catch (Throwable t) { return "unknown"; }
    }

    /** 只保留最近 MAX_CRASH_FILES 份崩溃报告。 */
    private static void prune() {
        try {
            File[] fs = crashFiles(app);
            if (fs == null || fs.length <= MAX_CRASH_FILES) return;
            for (int i = 0; i < fs.length - MAX_CRASH_FILES; i++) { try { fs[i].delete(); } catch (Throwable ignored) {} }
        } catch (Throwable ignored) {}
    }

    /** 崩溃报告按时间升序返回（旧的在前）。 */
    public static File[] crashFiles(Context c) {
        try {
            File d = dir(c);
            File[] fs = d.listFiles(new java.io.FilenameFilter() {
                @Override public boolean accept(File dir, String name) {
                    return name != null && name.startsWith("crash-") && name.endsWith(".txt");
                }
            });
            if (fs == null) return new File[0];
            Arrays.sort(fs, new Comparator<File>() {
                @Override public int compare(File a, File b) { return Long.compare(a.lastModified(), b.lastModified()); }
            });
            return fs;
        } catch (Throwable t) { return new File[0]; }
    }

    /* ---------------- 启动自检 / 安全模式 ---------------- */

    /**
     * Activity.onCreate 里调用。
     * 逻辑：上次启动写了 bootPending 但没有心跳（bootOk）→ 说明上一轮异常退出 → 失败计数 +1；
     * 连续 2 次失败 → 进入安全模式（页面跳过本机改动覆盖层，先保证能打开）。
     */
    public static void bootStart(Context c) {
        try {
            if (c == null) return;
            app = c.getApplicationContext();
            SharedPreferences p = sp(c);
            boolean pending = p.getBoolean("bootPending", false);
            int fail = p.getInt("failCount", 0);
            if (pending) fail++;
            boolean safe = p.getBoolean("safeMode", false);
            /* 连续 3 次才算「起不来」。原来 2 次太激进：用户用不到 3 秒就退出也会累加 failCount，
               几次之后就误进安全模式（本机改动全部不加载，看起来像「编辑丢了」）。 */
            if (fail >= 3) safe = true;
            p.edit()
             .putBoolean("bootPending", true)
             .putInt("failCount", fail)
             .putBoolean("safeMode", safe)
             .putString("lastBootAt", ts())
             .putInt("bootCount", p.getInt("bootCount", 0) + 1)
             .commit();
        } catch (Throwable ignored) {}
    }

    /** 页面加载完成且跑够一段时间后由网页调用：本轮启动成功。 */
    public static void bootOk(Context c) {
        try {
            if (c == null) return;
            sp(c).edit().putBoolean("bootPending", false).putInt("failCount", 0)
                  .putString("lastOkAt", ts()).commit();
        } catch (Throwable ignored) {}
    }

    public static boolean safeMode(Context c) {
        try { return sp(c).getBoolean("safeMode", false); } catch (Throwable t) { return false; }
    }

    public static void exitSafeMode(Context c) {
        try {
            sp(c).edit().putBoolean("safeMode", false).putInt("failCount", 0).putBoolean("bootPending", false).commit();
            bread(c, "退出安全模式");
        } catch (Throwable ignored) {}
    }

    public static int failCount(Context c) {
        try { return sp(c).getInt("failCount", 0); } catch (Throwable t) { return 0; }
    }

    /* ---------------- 给网页读取的 JSON ---------------- */

    /** 启动横幅用的摘要：最近一次崩溃 + 启动失败次数 + 安全模式状态。 */
    public static String pendingSummary(Context c) {
        StringBuilder sb = new StringBuilder();
        try {
            File[] fs = crashFiles(c);
            File last = fs.length == 0 ? null : fs[fs.length - 1];
            SharedPreferences p = sp(c);
            sb.append("{\"count\":").append(fs.length);
            sb.append(",\"unseen\":").append(p.getBoolean("crashUnseen", false) ? "true" : "false");
            sb.append(",\"safeMode\":").append(p.getBoolean("safeMode", false) ? "true" : "false");
            sb.append(",\"failCount\":").append(p.getInt("failCount", 0));
            sb.append(",\"lastBootAt\":\"").append(esc(p.getString("lastBootAt", ""))).append("\"");
            sb.append(",\"lastCrashAt\":\"").append(esc(p.getString("lastCrashAt", ""))).append("\"");
            sb.append(",\"file\":\"").append(last == null ? "" : esc(last.getName())).append("\"");
            sb.append(",\"head\":\"");
            if (last != null) {
                String txt = readText(last, 1200);
                String head = "";
                String[] lines = txt.split("\n");
                for (String l : lines) { if (l.startsWith("异常:") || l.startsWith("说明:")) { head = l; break; } }
                if (head.length() == 0) head = lines.length > 0 ? lines[0] : "";
                sb.append(esc(head));
            }
            sb.append("\"}");
        } catch (Throwable t) {
            return "{\"count\":0,\"safeMode\":false,\"failCount\":0,\"head\":\"\"}";
        }
        return sb.toString();
    }

    /** 全量导出用的 JSON：崩溃报告（每份截断）+ 面包屑 + 状态。 */
    public static String readAll(Context c) {
        StringBuilder sb = new StringBuilder();
        try {
            File[] fs = crashFiles(c);
            sb.append("{\"crashes\":[");
            for (int i = 0; i < fs.length; i++) {
                if (i > 0) sb.append(',');
                File f = fs[i];
                sb.append("{\"file\":\"").append(esc(f.getName())).append("\"");
                sb.append(",\"size\":").append(f.length());
                sb.append(",\"at\":\"").append(esc(tsOf(f))).append("\"");
                sb.append(",\"text\":\"").append(esc(readText(f, 6000))).append("\"}");
            }
            sb.append("],\"bread\":\"").append(esc(breadText(c))).append("\"");
            SharedPreferences p = sp(c);
            sb.append(",\"state\":{\"safeMode\":").append(p.getBoolean("safeMode", false) ? "true" : "false");
            sb.append(",\"failCount\":").append(p.getInt("failCount", 0));
            sb.append(",\"bootCount\":").append(p.getInt("bootCount", 0));
            sb.append(",\"lastBootAt\":\"").append(esc(p.getString("lastBootAt", ""))).append("\"");
            sb.append(",\"lastOkAt\":\"").append(esc(p.getString("lastOkAt", ""))).append("\"}");
            sb.append("}");
        } catch (Throwable t) {
            return "{\"crashes\":[],\"bread\":\"\",\"state\":{}}";
        }
        return sb.toString();
    }

    /** 清除全部本地诊断记录（崩溃报告 + 面包屑 + 计数）。 */
    public static void clear(Context c) {
        try {
            File[] fs = crashFiles(c);
            for (File f : fs) { try { f.delete(); } catch (Throwable ignored) {} }
            try { new File(dir(c), "bread.txt").delete(); } catch (Throwable ignored) {}
            synchronized (LOCK) { BREAD.clear(); unflushed = 0; }
            sp(c).edit().remove("lastCrashAt").remove("lastCrashFile").putBoolean("crashUnseen", false)
                 .putBoolean("safeMode", false).putInt("failCount", 0).commit();
        } catch (Throwable ignored) {}
    }

    /** 用户看过横幅后调用，避免每次都提示同一份崩溃。 */
    public static void markSeen(Context c) {
        try { sp(c).edit().putBoolean("crashUnseen", false).commit(); } catch (Throwable ignored) {}
    }

    private static String tsOf(File f) {
        try {
            SimpleDateFormat s = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
            return s.format(new Date(f.lastModified()));
        } catch (Throwable t) { return ""; }
    }

    private static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (ch < 0x20) sb.append(' ');
                    else sb.append(ch);
            }
        }
        return sb.toString();
    }
}
