package com.yuanziyuan.app;

import android.app.Application;

/**
 * 学通 App · Application
 * E（启动优化）：在网络空闲的低优先级线程里预热 WebView 内核，
 * 把 Chromium 的类加载/Provider 初始化从"用户点开瞬间"提前到"进程启动后空闲时"。
 * D（诊断兜底）：装上进程级未捕获异常处理器，崩溃瞬间把现场落盘（见 DiagStore）。
 */
public class App extends Application {

    @Override public void onCreate() {
        super.onCreate();
        initDiag();
        warmWebViewKernel();
    }

    private void initDiag() {
        try {
            String v = "";
            try {
                android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                v = pi.versionName + " (" + pi.versionCode + ")";
            } catch (Throwable ignored) {}
            String wv = "";
            try {
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    android.content.pm.PackageInfo pi = android.webkit.WebView.getCurrentWebViewPackage();
                    if (pi != null) wv = pi.versionName;
                }
            } catch (Throwable ignored) {}
            DiagStore.install(this, v + (wv.length() > 0 ? " | WebView " + wv : ""));
        } catch (Throwable ignored) {}
    }

    private void warmWebViewKernel() {
        try {
            Thread t = new Thread(new Runnable() {
                @Override public void run() {
                    try { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); } catch (Throwable ignored) {}
                    // 仅预加载内核类与默认 UA，不创建 WebView 实例、不触碰主线程
                    try { Class.forName("android.webkit.WebViewFactory"); } catch (Throwable ignored) {}
                    try { android.webkit.WebSettings.getDefaultUserAgent(App.this); } catch (Throwable ignored) {}
                }
            }, "wv-warm");
            t.setPriority(Thread.MIN_PRIORITY);
            t.start();
        } catch (Throwable ignored) {}
    }
}
