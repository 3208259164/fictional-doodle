package com.yuanziyuan.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.RenderEffect;
import android.graphics.Shader;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 学通 App · 现代安卓壳层（2026）
 * - targetSdk 36 (Android 16)：强制 edge-to-edge，本类负责 insets 内边距避让
 * - 预测性返回：API 33+ 用 OnBackInvokedCallback；<33 走 onBackPressed
 * - 本地站点经 https://appassets.androidplatform.net/ 载入（等同 WebViewAssetLoader 的安全模型）
 * - 完全离线的内置站点：全部内容随 APK 分发；无内容包热更新、无应用内自更新
 *   （更新由 F-Droid / 项目发布页负责，应用本身不下载、不安装任何可执行代码）
 * - 权限最小化：启动不申请任何运行时权限；保存/打开文件按需处理并优雅降级
 */
public class MainActivity extends Activity {

    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ASSET_BASE = "https://" + ASSET_HOST + "/";
    /* 与 @color/bg 一致：站点深色主题的实际主背景色（style.css 的 linear-gradient
       160deg #4a0808 → #2b0505 → #170303，manifest theme_color 也是 #2b0505）。
       App 启动时 WebView 还没画出第一帧，露出的就是这一层，必须与站点同色。 */
    private static final int BAR_COLOR = 0xFF2B0505;
    private android.widget.FrameLayout root;           // 承载 WebView 的同色容器

    private WebView web;
    /* 主框架最近一次真实导航地址：用于来源判定，避免个别 ROM 上 web.getUrl() 取不到值导致误判 */
    private volatile String lastMainUrl = null;
    private String pendingPwd = null;
    private boolean errShown = false;
    private String lastSaveMethod = "";   /* tree / appfolder / download：本次实际写入方式 */
    private String lastSaveError = "";     /* 非空表示首选位置写入失败并已回退 */
    private String lastSavedMime = "application/octet-stream";
    private ValueCallback<Uri[]> fileCb;
    private static final int REQ_FILE = 1001;
    private static final int REQ_TREE = 1002;   /* 选择「导出文件夹」（SAF，零权限） */
    private static final int REQ_PERM = 1003;   /* 申请存储权限（直写系统「下载」目录） */
    private static final int REQ_BOOK = 1004;   /* 选择电子书（EPUB / PDF，SAF） */

    /* ---------------- 离线朗读（系统 TTS，全部本机）----------------
       要点（都是踩过的坑）：
         · TextToSpeech 必须在「主线程」new，初始化回调也在主线程触发；
         · 初始化是异步的：先在回调里把结论写进 ttsInited / ttsReady / ttsReason，
           网页轮询 ttsStatus() 拿结论，不能同步等；
         · 单次朗读上限约 4000 字符（TextToSpeech.getMaxSpeechInputLength()），
           长文必须自己切段，用 UtteranceProgressListener 一段读完再喂下一段，
           否则引擎会截断或直接报错；
         · 只用本机引擎：不联网、不下载语音包、不申请任何权限；
         · 页面销毁必须 shutdown()，否则引擎连接泄漏、退出后还会继续出声。 */
    private TextToSpeech tts = null;                // 只在主线程创建/使用
    private volatile boolean ttsStarting = false;   // 已派发过一次创建（防桥线程重复 new）
    private volatile boolean ttsInited = false;     // 初始化回调已返回（不论成败）
    private volatile boolean ttsReady = false;      // 引擎可用且中文语种就绪
    private volatile String ttsEngine = "";         // 实际使用的引擎包名
    private volatile String ttsReason = "";         // 不可用时的原因（给诊断报告 / 提示）
    private volatile boolean ttsBusy = false;       // 正在朗读
    private volatile boolean ttsStopped = true;     // 用户已停止：队列不再续读
    private volatile float ttsRate = 1.0f;          // 语速 0.5 ~ 2.0
    private final List<String> ttsSegs = new ArrayList<String>();   // 当前朗读的段落队列
    private int ttsSegIdx = 0;                      // 已投喂到第几段
    private volatile int ttsEngineCount = -1;       // 系统里的引擎个数（-1 = 没查过）
    private volatile boolean pageLoaded = false;    // 主页面是否已 onPageFinished（用于补记启动成功）

    private static final Map<String, String> MIME = new HashMap<String, String>();
    static {
        MIME.put("html", "text/html"); MIME.put("js", "application/javascript"); MIME.put("css", "text/css");
        MIME.put("json", "application/json"); MIME.put("svg", "image/svg+xml"); MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg"); MIME.put("jpeg", "image/jpeg"); MIME.put("webp", "image/webp");
        MIME.put("gif", "image/gif"); MIME.put("ico", "image/x-icon");
        MIME.put("xml", "application/xml"); MIME.put("txt", "text/plain"); MIME.put("md", "text/markdown");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("woff", "font/woff"); MIME.put("woff2", "font/woff2"); MIME.put("ttf", "font/ttf"); MIME.put("otf", "font/otf");
        MIME.put("mp3", "audio/mpeg"); MIME.put("m4a", "audio/mp4"); MIME.put("ogg", "audio/ogg"); MIME.put("wav", "audio/wav");
        MIME.put("mp4", "video/mp4"); MIME.put("webm", "video/webm");
        MIME.put("epub", "application/epub+zip"); MIME.put("pdf", "application/pdf");
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        setupWindow();
        /* 启动自检：上次启动若没跑完心跳，说明上一轮异常退出 → 计数，连续两次失败进安全模式 */
        try { DiagStore.bootStart(this); } catch (Throwable ignored) {}


        /* WebView 不能直接 setContentView：edge-to-edge 下导航栏/状态栏区域是
           “窗口”透出来的部分，WebView 透明时那块会露出系统默认白底（用户看到的
           “设置下面是白色”）。包一层同色容器，padding 区就与页面同色。 */
        root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(BAR_COLOR);
        web = new WebView(this);
        web.setBackgroundColor(BAR_COLOR);
        web.setContentDescription("学通");
        root.addView(web, new android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(false);   // WebSQL 已废弃；本站仅用 localStorage（DomStorage）
        // —— 文件访问：全部关闭（本地站点走 https asset 域，无需 file://）——
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        // —— 其他硬化 ——
        s.setSavePassword(false);
        s.setSaveFormData(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setDefaultTextEncodingName("utf-8");
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);   // 禁用双击 / 捏合缩放（避免点按每日一句触发整页缩放）
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 注意：不设置 setTextZoom —— 保留系统「字体大小」无障碍缩放能力
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);
        try { s.setUserAgentString(s.getUserAgentString() + " YuanziyuanApp/" + appVersionName()); } catch (Exception e) {}

        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return intercept(req.getUrl());
            }
            @Override public void onReceivedSslError(WebView v, android.webkit.SslErrorHandler h, android.net.http.SslError e) {
                h.cancel();   /* 永不忽略证书错误 */
            }
            @Override public void onReceivedClientCertRequest(WebView v, android.webkit.ClientCertRequest req) {
                req.cancel(); /* 本应用不需要客户端证书，显式拒绝（默认亦为 cancel，显式以防误配置） */
            }
            @Override public void doUpdateVisitedHistory(WebView v, String url, boolean isReload) {
                if (url != null && url.length() > 0) lastMainUrl = url;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return handleUrl(r.getUrl().toString()); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) { return handleUrl(url); }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && !errShown) { errShown = true; v.loadUrl(ASSET_BASE + "index.html"); }
            }
            @Override public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse er) {
                /* 资产缺失会返回 404（HTTP 错误，不走 onReceivedError）→ 主框架同样兜底回首页，避免白屏 */
                if (r.isForMainFrame() && !errShown) { errShown = true; v.loadUrl(ASSET_BASE + "index.html"); }
            }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                /* WebView 渲染进程崩溃：返回 true 表示已处理，避免系统连带杀掉整个 App；重建 Activity 优雅恢复 */
                /* 渲染进程崩溃不会走 Java 的未捕获异常处理器，必须在这里自己落盘 */
                try { DiagStore.writeRenderCrash(MainActivity.this, d == null ? "渲染进程异常终止" : ("didCrash=" + d.didCrash())); } catch (Throwable ignored) {}
                try { toast("页面渲染进程已重启，正在重新加载…"); } catch (Throwable t) {}
                if (!isFinishing()) { try { recreate(); } catch (Throwable t) {} }
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) {
                pageLoaded = true;   /* 页面真的画出来了：退到后台时可以据此补记「本轮启动成功」 */
                try { DiagStore.bread(MainActivity.this, "打开页面 " + shortUrl(url)); } catch (Throwable ignored) {}
                if (pendingPwd != null) { String _p = pendingPwd; pendingPwd = null; autofillPwd(v, _p); }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                fileCb = cb;
                /* 关键：不能直接 p.createIntent() —— 它会把 <input accept> 翻成 MIME 过滤，
                   而 .html 在不少国产 ROM 的文件管理器里被标成 text/plain 或 application/octet-stream，
                   结果就是"文件明明在那儿却灰着选不了"。这里统一改成任意类型（不过滤），
                   扩展名与内容合法性由网页侧校验（challenge.js / books.js 都会检查）。 */
                Intent intent = null;
                try {
                    intent = p.createIntent();
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"*/*"});
                } catch (Throwable t) { intent = null; }
                if (intent == null) {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    try { if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true); } catch (Throwable t) {}
                }
                try { startActivityForResult(intent, REQ_FILE); return true; }
                catch (Exception e) { fileCb = null; return false; }
            }
            @Override public void onPermissionRequest(final PermissionRequest req) {
                /* 本地离线站点无需任何硬件权限（摄像头/麦克风等）：一律拒绝。 */
                runOnUiThread(new Runnable() { public void run() { try { req.deny(); } catch (Throwable ignored) {} } });
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback cb) {
                cb.invoke(origin, false, false);   /* 拒绝定位 */
            }
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                return true;   /* 不回显控制台日志，避免信息泄漏 */
            }
            /* JS 原生对话框：显式实现，保证跨 WebView 版本都能弹出；
               任何分支都必须调用 confirm()/cancel()，否则 JS 线程会永久挂起。 */
            @Override public boolean onJsAlert(WebView v, String url, String message, final JsResult result) {
                try {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("提示")
                        .setMessage(message == null ? "" : message)
                        .setPositiveButton("知道了", new DialogInterface.OnClickListener() { public void onClick(DialogInterface dlg, int w) { result.confirm(); } })
                        .setOnCancelListener(new DialogInterface.OnCancelListener() { public void onCancel(DialogInterface dlg) { result.confirm(); } })
                        .show();
                } catch (Throwable t) { result.confirm(); }
                return true;
            }
            @Override public boolean onJsConfirm(WebView v, String url, String message, final JsResult result) {
                try {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("请确认")
                        .setMessage(message == null ? "" : message)
                        .setPositiveButton("确定", new DialogInterface.OnClickListener() { public void onClick(DialogInterface dlg, int w) { result.confirm(); } })
                        .setNegativeButton("取消", new DialogInterface.OnClickListener() { public void onClick(DialogInterface dlg, int w) { result.cancel(); } })
                        .setOnCancelListener(new DialogInterface.OnCancelListener() { public void onCancel(DialogInterface dlg) { result.cancel(); } })
                        .show();
                } catch (Throwable t) { result.cancel(); }
                return true;
            }
            @Override public boolean onJsPrompt(WebView v, String url, String message, String defaultValue, final JsPromptResult result) {
                try {
                    final EditText et = new EditText(MainActivity.this);
                    et.setText(defaultValue == null ? "" : defaultValue);
                    et.setSingleLine(true);
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("输入")
                        .setMessage(message == null ? "" : message)
                        .setView(et)
                        .setPositiveButton("确定", new DialogInterface.OnClickListener() { public void onClick(DialogInterface dlg, int w) { result.confirm(et.getText().toString()); } })
                        .setNegativeButton("取消", new DialogInterface.OnClickListener() { public void onClick(DialogInterface dlg, int w) { result.cancel(); } })
                        .setOnCancelListener(new DialogInterface.OnCancelListener() { public void onCancel(DialogInterface dlg) { result.cancel(); } })
                        .show();
                } catch (Throwable t) { result.cancel(); }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidApp");
        web.setDownloadListener(new DownloadListener() {
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                if (url != null && url.startsWith("blob:")) { toast("请点击页面内的保存按钮下载"); return; }
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { toast("无法打开下载链接"); }
            }
        });

        try { WebView.setWebContentsDebuggingEnabled(false); } catch (Exception e) {}

        /* Service Worker 的 fetch 不经过 WebViewClient.shouldInterceptRequest，
           需单独注册 ServiceWorkerClient（API 24+），否则离线缓存请求会落空。 */
        if (Build.VERSION.SDK_INT >= 24) {
            try {
                android.webkit.ServiceWorkerController.getInstance().setServiceWorkerClient(
                    new android.webkit.ServiceWorkerClient() {
                        @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest req) {
                            return intercept(req.getUrl());
                        }
                    });
            } catch (Throwable ignored) {}
        }

        applyInsets();

        registerPredictiveBack();

        /* 版本升级后清一次 WebView 的 HTTP 缓存：否则升级 APK 后，页面可能仍是上一版的缓存副本
           （只清 HTTP 缓存，不动 localStorage / 用户编辑数据）。 */
        try {
            android.content.SharedPreferences sp = getSharedPreferences("app_meta", MODE_PRIVATE);
            int last = sp.getInt("lastVersionCode", 0), cur = appVersionCode();
            if (last != cur) { web.clearCache(true); sp.edit().putInt("lastVersionCode", cur).apply(); }
        } catch (Throwable ignored) {}

        web.loadUrl(ASSET_BASE + "index.html");

        String route = routeFromIntent();
        if ("graph".equals(route)) web.loadUrl(ASSET_BASE + "graph.html");
        else if ("graph3d".equals(route)) web.loadUrl(ASSET_BASE + "graph3d.html");

    }

    @Override public void onConfigurationChanged(Configuration nc) {
        super.onConfigurationChanged(nc);
        // 系统深/浅色变化时，通知页面重新解析「跟随系统」主题
        try { if (web != null) web.evaluateJavascript("window.__yzSystemTheme&&window.__yzSystemTheme()", null); } catch (Throwable ignored) {}
    }

    private String routeFromIntent() {
        try { Intent i = getIntent(); if (i != null) return i.getStringExtra("route"); } catch (Exception e) {}
        return null;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (web == null || intent == null) return;
        String route = intent.getStringExtra("route");
        if ("graph".equals(route)) web.loadUrl(ASSET_BASE + "graph.html");
        else if ("graph3d".equals(route)) web.loadUrl(ASSET_BASE + "graph3d.html");
    }

    /* ---------------- 窗口 / 系统栏 ---------------- */
    private void setupWindow() {
        if (Build.VERSION.SDK_INT >= 30) {
            Api30.setupEdgeToEdge(this);
        } else if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(BAR_COLOR);
            getWindow().setNavigationBarColor(BAR_COLOR);
        }
        if (Build.VERSION.SDK_INT >= 23) getWindow().getDecorView().setSystemUiVisibility(0);
    }

    /** 按背景亮度决定系统栏图标是深色还是浅色（深底配白图标，浅底配黑图标） */
    private void applyBarIconTone(int c) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            int r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
            boolean lightBg = (0.299 * r + 0.587 * g + 0.114 * b) > 160;
            View dv = getWindow().getDecorView();
            int f = dv.getSystemUiVisibility();
            if (lightBg) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            else f &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            dv.setSystemUiVisibility(f);
        } catch (Throwable ignored) {}
    }

    private void applyInsets() {
        if (Build.VERSION.SDK_INT < 30) return;
        web.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                /* Android 15/16 强制 edge-to-edge：以 systemBars 内边距避让（替代已废弃的 getSystemWindowInset*）。
                   注意：edge-to-edge 下系统不再自动为键盘让位，底部还要取 systemBars 与 IME 的较大者，
                   否则笔记 / 搜索框 / 自助编辑等输入框会被软键盘遮住。 */
                android.graphics.Insets sb = insets.getInsets(WindowInsets.Type.systemBars());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(sb.left, sb.top, sb.right, Math.max(sb.bottom, ime.bottom));
                return insets;
            }
        });
        try { web.requestApplyInsets(); } catch (Exception e) {}
    }

    /* ---------------- 返回处理（预测性返回） ---------------- */
    /* 最近一次返回键的处理结果：给网页侧「返回键自检」用，
       用户按一次返回就能看到到底是应用内层级接住了、还是退到了历史/退出。 */
    private static volatile String lastBackInfo = "(尚未按过返回键)";
    private void registerPredictiveBack() {
        if (Build.VERSION.SDK_INT >= 33) Api33.registerBack(this);
    }

    @Override public void onBackPressed() {
        dispatchBack();
    }

    private void dispatchBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript(
            "(function(){try{return (window.__appBack&&window.__appBack())?1:0;}catch(e){return 0;}})()",
            new ValueCallback<String>() {
                @Override public void onReceiveValue(String val) {
                    /* evaluateJavascript 的回调值是 JSON 编码的：数字 1 → "1"，布尔 true → "true"，
                       字符串 → 带引号。原来只认 "1"，一旦站点返回 true 就会被误判成「没处理」而退历史。 */
                    String v = val == null ? "" : val.replace("\"", "").trim();
                    boolean handled = "1".equals(v) || "true".equalsIgnoreCase(v);
                    /* 落一条面包屑：用户导出诊断报告就能看到每次返回到底走没走应用内层级 */
                    lastBackInfo = "页面处理=" + (handled ? "是" : "否") + " 原始=" + val
                        + (handled ? " → 由应用内层级接管" : (web.canGoBack() ? " → 退浏览器历史" : " → 退出应用"));
                    try { DiagStore.bread(MainActivity.this, "返回键: " + lastBackInfo); } catch (Throwable ignored) {}
                    if (handled) return;
                    if (web.canGoBack()) web.goBack(); else finish();
                }
            });
    }

    /* ---------------- 本地站点资源：同源 https 资产域（等价 WebViewAssetLoader 安全模型） ----------------
       只服务 appassets.androidplatform.net；其它 host / file: / content: 一律返回 403 空响应，
       既不联网加载第三方内容，也不暴露本地文件（本应用完全离线）。 */
    private static final String CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; "
        + "font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; "
        + "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    private WebResourceResponse intercept(Uri u) {
        if (u == null) return null;
        String scheme = u.getScheme();
        if (scheme == null) return null;
        scheme = scheme.toLowerCase(Locale.US);
        if (scheme.equals("data") || scheme.equals("blob") || scheme.equals("about")) return null;
        if (ASSET_HOST.equalsIgnoreCase(u.getHost())) return assetResponse(u);
        return blocked();
    }

    private Map<String, String> respHeaders(String mime) { return respHeaders(mime, null); }

    /**
     * 缓存策略（0.17.22 起）：
     *   · HTML 一律 no-store —— 它永远从这里拿最新的，是「升级后必须立即可见」的那一层；
     *   · 带 ?v=<当前 versionCode> 的脚本/样式/数据 → 一年长缓存 + immutable。
     *     因为版本号参与 URL，换版本就是换 URL，旧缓存永远不会被复用；
     *     同时 WebView 才会为这些脚本生成 V8 编译缓存（no-store 时会禁用），
     *     第二次打开页面可以跳过重新编译，这是「点进页面卡一下」的主要开销。
     *   · 不带版本串（或版本串不匹配）→ no-cache，保守回退，不会跑旧代码。
     */
    private Map<String, String> respHeaders(String mime, Uri u) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("X-Content-Type-Options", "nosniff");
        h.put("Referrer-Policy", "no-referrer");
        boolean isHtml = (mime != null && mime.startsWith("text/html"));
        String ver = null;
        try { ver = (u == null) ? null : u.getQueryParameter("v"); } catch (Throwable ignored) {}
        if (isHtml || u == null) {
            h.put("Cache-Control", "no-store, must-revalidate");
            h.put("Pragma", "no-cache");
        } else if (ver != null && ver.equals(String.valueOf(appVersionCode()))) {
            h.put("Cache-Control", "public, max-age=31536000, immutable");
        } else {
            h.put("Cache-Control", "no-cache, must-revalidate");
        }
        if (isHtml) h.put("Content-Security-Policy", CSP);
        return h;
    }

    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
                respHeaders("text/plain"), new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                respHeaders("text/plain"), new ByteArrayInputStream(new byte[0]));
    }

    private WebResourceResponse assetResponse(Uri u) {
        try {
            String path = u.getPath();
            String p = (path == null || path.equals("/")) ? "index.html" : path.substring(1);
            /* 路径加固：拒绝穿越 / 反斜杠 / 空字节 / 绝对路径 / 冒号 */
            if (p.isEmpty() || p.indexOf("..") >= 0 || p.indexOf('\\') >= 0 || p.indexOf('\0') >= 0
                    || p.startsWith("/") || p.indexOf(':') >= 0) return notFound();
            String ext = p.contains(".") ? p.substring(p.lastIndexOf('.') + 1).toLowerCase(Locale.US) : "";
            String mime;
            if (ext.isEmpty()) { p = p + "/index.html"; mime = "text/html"; }
            else mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            String enc = (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg")) ? "utf-8" : null;

            /* 电子书 PDF 页图（0.17.37）：从私有缓存目录按需读。
               走同源 https 的目的是让 WebView 用它自己的图片管线（可流式、可缓存、可降采样），
               而不是把几 MB 的 base64 通过 JS 桥搬进内存。 */
            if (p.startsWith("_bookpage/")) {
                String rel = p.substring("_bookpage/".length());
                if (rel.indexOf("..") >= 0 || rel.indexOf(':') >= 0 || rel.indexOf('\\') >= 0) return notFound();
                File pf = new File(bookPagesRoot(), rel);
                if (!pf.exists() || !pf.isFile()) return notFound();
                return new WebResourceResponse("image/jpeg", null, 200, "OK",
                    respHeaders("image/jpeg", u), new FileInputStream(pf));
            }

            /* 纯文本正文（TXT / MD）：给网页一个同源地址去 fetch。
               不把几 MB 文本用 base64 过桥——那样既慢又占内存，还会卡住 JS 线程。 */
            if (p.startsWith("_booktext/")) {
                String rel = p.substring("_booktext/".length());
                if (badRel(rel)) return notFound();
                File tf = new File(booksRoot(), rel);
                if (!tf.exists() || !tf.isFile()) return notFound();
                String tm = tf.getName().toLowerCase(Locale.US).endsWith(".md") ? "text/markdown" : "text/plain";
                return new WebResourceResponse(tm, "utf-8", 200, "OK", respHeaders(tm, u), new FileInputStream(tf));
            }

            /* 相册照片（App 私有目录，不碰系统相册，不需要任何存储权限） */
            if (p.startsWith("_photo/")) {
                String rel = p.substring("_photo/".length());
                if (badRel(rel)) return notFound();
                File ph = new File(photosRoot(), rel);
                if (!ph.exists() || !ph.isFile()) return notFound();
                String low = rel.toLowerCase(Locale.US);
                String pm = low.endsWith(".png") ? "image/png" : (low.endsWith(".webp") ? "image/webp"
                          : (low.endsWith(".gif") ? "image/gif" : "image/jpeg"));
                return new WebResourceResponse(pm, null, 200, "OK", respHeaders(pm, u), new FileInputStream(ph));
            }

            /* 内置 assets（全部内容随 APK 分发） */
            InputStream in = getAssets().open("site/" + p);
            return new WebResourceResponse(mime, enc, 200, "OK", respHeaders(mime, u), in);
        } catch (Exception e) {
            return notFound();
        }
    }

    private void autofillPwd(WebView v, String code) {
        String c = code.replace("\\", "\\\\").replace("'", "\\'");
        String js = "(function(){var code='" + c + "';function f(){try{"
            + "var d=document;"
            + "var i=d.querySelector('#pwd')||d.querySelector('.passwdinput input')||d.querySelector('input[name=pwd]')||d.querySelector('input[type=password]');"
            + "if(!i)return false;i.focus();i.value=code;"
            + "i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));"
            + "var b=d.querySelector('#sub')||d.querySelector('.passwddiv-btn')||d.querySelector('#passwddiv button')||d.querySelector('button[type=submit]')||d.querySelector('.pwd-btn')||d.querySelector('a[onclick]');"
            + "if(b){b.click();return true;}"
            + "if(i.form){try{i.form.submit();return true;}catch(e){}}"
            + "i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true}));return true;"
            + "}catch(e){return false;}}var n=0;var t=setInterval(function(){if(f()||++n>15)clearInterval(t);},600);})();";
        v.evaluateJavascript(js, null);
    }

    private boolean isSiteHost(String url) {
        return url != null && (url.contains(ASSET_HOST) || url.startsWith("about:")
                || url.startsWith("blob:") || url.startsWith("data:"));
    }

    private boolean handleUrl(String url) {
        if (url == null) return false;
        if (isSiteHost(url)) return false;
        /* 只把 http(s)/系统常见 scheme 交给外部应用打开；
           拒绝 file:/content:/intent:/javascript: 等，防 Intent 注入与本地文件泄露。 */
        String low = url.toLowerCase(Locale.US);
        boolean okScheme = low.startsWith("http://") || low.startsWith("https://")
                || low.startsWith("mailto:") || low.startsWith("tel:") || low.startsWith("sms:")
                || low.startsWith("geo:") || low.startsWith("market:");
        if (!okScheme) return true;
        if (url.contains("lanzou") && url.contains("#pwd=")) {
            try { int i = url.indexOf("#pwd="); pendingPwd = url.substring(i + 5); web.loadUrl(url.substring(0, i)); } catch (Exception e) {}
            return true;
        }
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); return true; } catch (Exception e) { toast("无法打开链接"); return true; }
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        if (req == REQ_PERM) {
            boolean ok = (res != null && res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED);
            try { getSharedPreferences("yz", 0).edit().putBoolean("directDownload", ok).apply(); } catch (Throwable t) {}
            toast(ok ? "已开启：导出将直接写入系统「下载」目录（文件管理器一定看得到）"
                     : "未授予存储权限；导出仍用系统「下载」（媒体库方式）");
            return;
        }
        super.onRequestPermissionsResult(req, perms, res);
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_TREE) {
            if (res != RESULT_OK || data == null || data.getData() == null) { toast("已取消：导出位置未更改"); return; }
            try {
                if (data != null && data.getData() != null) {
                    Uri u = data.getData();
                    try { getContentResolver().takePersistableUriPermission(u,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Throwable t) {}
                    String label = treeDisplayName(u);
                    if (label == null || label.length() == 0) label = "所选文件夹";
                    getSharedPreferences("yz", 0).edit().putString("exportTree", u.toString()).putString("exportTreeName", label).apply();
                    toast("导出文件夹已设为：" + label);
                }
            } catch (Throwable t) { toast("设置失败：" + t.getMessage()); }
            return;
        }
        if (req == REQ_BOOK) {
            if (res != RESULT_OK || data == null) { bookResult("{\"ok\":false,\"error\":\"已取消\"}"); return; }
            final java.util.ArrayList<Uri> uris = new java.util.ArrayList<Uri>();
            try {
                android.content.ClipData cd = data.getClipData();
                if (cd != null && cd.getItemCount() > 0) {
                    for (int i = 0; i < cd.getItemCount(); i++) {
                        Uri one = cd.getItemAt(i) == null ? null : cd.getItemAt(i).getUri();
                        if (one != null) uris.add(one);
                    }
                } else if (data.getData() != null) uris.add(data.getData());
            } catch (Throwable t) {}
            if (uris.isEmpty()) { bookResult("{\"ok\":false,\"error\":\"已取消\"}"); return; }
            new Thread(new Runnable() { public void run() {
                StringBuilder items = new StringBuilder("[");
                int nb = 0, np = 0, bad = 0;
                String firstErr = null;
                String lastId = "", lastType = ""; int lastCount = 0;
                for (int k = 0; k < uris.size(); k++) {
                    Uri bu = uris.get(k);
                    try { getContentResolver().takePersistableUriPermission(bu, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Throwable t) {}
                    String one;
                    try { one = importBook(bu); }
                    catch (Throwable e) { one = "{\"ok\":false,\"error\":" + Epub.q(msgOf(e)) + "}"; }
                    if (one == null) continue;
                    if (one.indexOf("\"ok\":true") < 0) {
                        bad++;
                        if (firstErr == null) {
                            try { firstErr = new org.json.JSONObject(one).optString("error"); } catch (Throwable t) { firstErr = "导入失败"; }
                        }
                        continue;
                    }
                    if (items.length() > 1) items.append(',');
                    items.append(one);
                    try {
                        org.json.JSONObject o = new org.json.JSONObject(one);
                        if ("photo".equals(o.optString("kind"))) np++;
                        else { nb++; lastId = o.optString("id"); lastType = o.optString("type"); lastCount = o.optInt("count", 0); }
                    } catch (Throwable t) { nb++; }
                }
                items.append(']');
                String out = "{\"ok\":true,\"items\":" + items
                    + ",\"books\":" + nb + ",\"photos\":" + np + ",\"bad\":" + bad
                    + ",\"id\":" + Epub.q(lastId) + ",\"type\":" + Epub.q(lastType)
                    + ",\"count\":" + lastCount
                    + ",\"error\":" + Epub.q(firstErr == null ? "" : firstErr) + "}";
                final String j = out;
                runOnUiThread(new Runnable() { public void run() { bookResult(j); } });
            }}).start();
            return;
        }
        if (req == REQ_FILE) {
            if (fileCb == null) return;
            Uri[] results = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) { int n = data.getClipData().getItemCount(); results = new Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri(); }
                else if (data.getData() != null) results = new Uri[]{ data.getData() };
            }
            fileCb.onReceiveValue(results); fileCb = null; return;
        }
        super.onActivityResult(req, res, data);
    }

    /* ================= 电子书：导入与读取（0.17.36）=================
       全部零依赖：EPUB 用 java.util.zip 自己解，PDF 用系统 PdfRenderer 逐页出图。
       文件统一落到 App 私有目录 files/books/，之后不再依赖用户原来的路径。 */

    private File booksRoot() { File f = new File(getFilesDir(), "books"); if (!f.exists()) f.mkdirs(); return f; }

    /* ---------------- 导出书库（Longevity） ----------------
       EPUB 在导入时被解成了目录（Epub.stage），所以要重新打包成标准 .epub 才能带走。
       规范要求 mimetype 必须是第一个条目且不压缩，这里照做，主流阅读器都能直接打开。 */

    /* JSON 字符串转义（只处理导出提示里用得到的几个字符） */
    private static String jsEscape(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\') sb.append("\\\\");
            else if (c == '"') sb.append("\\\"");
            else if (c == '\n' || c == '\r' || c == '\t') sb.append(' ');
            else sb.append(c);
        }
        return sb.toString();
    }

    private String bookTitleOf(File root, String id) {
        try {
            File mj = new File(root, id + ".json");
            if (!mj.exists()) return null;
            String t = readAllText(mj);
            java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"name\"\\s*:\\s*\"([^\"]{1,120})\"").matcher(t);
            if (m.find()) return m.group(1);
            m = java.util.regex.Pattern.compile("\"title\"\\s*:\\s*\"([^\"]{1,120})\"").matcher(t);
            if (m.find()) return m.group(1);
        } catch (Throwable ignored) {}
        return null;
    }

    private String readAllText(File f) throws Exception { return EpubPack.readAllText(f); }

    private byte[] zipEpubDir(File dir) throws Exception { return EpubPack.zipDir(dir); }

    private File bookPagesRoot() { File f = new File(getCacheDir(), "bookpages"); if (!f.exists()) f.mkdirs(); return f; }

    /** PDF 夜间：页图要按夜间重渲染一次，所以状态存原生侧 */
    private boolean pdfNightOn() {
        try { return getSharedPreferences("yz", 0).getBoolean("pdfNight", false); } catch (Throwable t) { return false; }
    }

    private File photosRoot() { File f = new File(getFilesDir(), "photos"); if (!f.exists()) f.mkdirs(); return f; }

    /** 流式落盘（TXT / MD / 图片都走这里，不经过内存拼字符串） */
    private static long copyTo(InputStream in, File out) throws Exception {
        File parent = out.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        FileOutputStream fos = new FileOutputStream(out);
        try {
            byte[] buf = new byte[8192];
            long total = 0; int n;
            while ((n = in.read(buf)) > 0) { fos.write(buf, 0, n); total += n; }
            fos.flush();
            return total;
        } finally { try { fos.close(); } catch (Throwable t) {} }
    }

    private static byte[] readBytes(File f) throws Exception {
        InputStream in = new java.io.FileInputStream(f);
        try {
            long len = f.length();
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream((int) Math.max(1024, Math.min(len, 64L * 1024 * 1024)));
            byte[] buf = new byte[8192]; int k;
            while ((k = in.read(buf)) > 0) bos.write(buf, 0, k);
            return bos.toByteArray();
        } finally { try { in.close(); } catch (Throwable t) {} }
    }

    /** 媒体路径防护：不允许跳出私有目录 */
    private static boolean badRel(String rel) {
        return rel == null || rel.indexOf("..") >= 0 || rel.indexOf(':') >= 0 || rel.indexOf('\\') >= 0 || rel.startsWith("/");
    }

    private static String msgOf(Throwable e) {
        String m = e.getMessage();
        return (m == null || m.length() == 0) ? e.getClass().getSimpleName() : m;
    }

    private String displayNameOf(Uri u) {
        String name = null;
        Cursor c = null;
        try {
            c = getContentResolver().query(u, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = c.getString(i);
            }
        } catch (Throwable ignore) {
        } finally { if (c != null) try { c.close(); } catch (Throwable t) {} }
        if (name == null) { name = u.getLastPathSegment(); if (name == null) name = "未命名"; }
        return name;
    }

    private void saveBookMeta(String id, String name, String type, long size, String chaptersJson) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("id", id); o.put("name", name); o.put("type", type);
            o.put("size", size); o.put("at", System.currentTimeMillis());
            if (chaptersJson != null && chaptersJson.length() > 2) {
                try { o.put("chapters", new org.json.JSONArray(chaptersJson)); } catch (Throwable t) {}
            }
            FileOutputStream fos = new FileOutputStream(new File(booksRoot(), id + ".json"));
            try { fos.write(o.toString().getBytes("UTF-8")); } finally { try { fos.close(); } catch (Throwable t) {} }
        } catch (Throwable ignored) {}
    }

    /** 照片只记最小元信息（原名 / 后缀 / 字节数 / 时间），不解析内容 */
    private void savePhotoMeta(String id, String name, String ext, long size) {
        try {
            org.json.JSONObject o = new org.json.JSONObject();
            o.put("id", id); o.put("name", name); o.put("ext", ext);
            o.put("size", size); o.put("at", System.currentTimeMillis());
            FileOutputStream fos = new FileOutputStream(new File(photosRoot(), id + ".json"));
            try { fos.write(o.toString().getBytes("UTF-8")); } finally { try { fos.close(); } catch (Throwable t) {} }
        } catch (Throwable ignored) {}
    }

    private String importBook(Uri u) {
        String name = displayNameOf(u);
        String lower = name.toLowerCase(Locale.US);
        /* 格式白名单。安卓的文件选择器不看 accept，从相册、QQ/微信「发送到」进来的
           任何文件都会到这儿；以前只有「是不是 .pdf」一个判断，其它一律当 EPUB 处理，
           结果一张 JPG 也被导成「书」占了书架、点开又读不出来。 */
        boolean okPdf = lower.endsWith(".pdf");
        boolean okEpub = lower.endsWith(".epub");
        boolean okText = lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".markdown");
        boolean okPhoto = lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png")
                       || lower.endsWith(".webp") || lower.endsWith(".gif") || lower.endsWith(".bmp");
        if (!okPdf && !okEpub && !okText && !okPhoto) {
            return "{\"ok\":false,\"error\":\"不支持这种格式（收 EPUB / PDF / TXT / MD 和图片）\"}";
        }
        /* 同一毫秒选多个文件会撞 id，加随机后缀 */
        String id = (okPhoto ? "p" : "b") + System.currentTimeMillis() + (100 + (int) (Math.random() * 900));
        InputStream in = null;
        try {
            in = getContentResolver().openInputStream(u);
            if (in == null) return "{\"ok\":false,\"error\":\"无法读取这个文件\"}";
            /* 图片：进相册，不进书架。它是“另一种东西”，不是“另一种书”。 */
            if (okPhoto) {
                String ext = ".jpg";
                int dot = lower.lastIndexOf('.');
                if (dot >= 0) ext = lower.substring(dot);
                File out = new File(photosRoot(), id + ext);
                long n = copyTo(in, out);
                savePhotoMeta(id, name, ext, n);
                return "{\"ok\":true,\"kind\":\"photo\",\"id\":" + Epub.q(id)
                     + ",\"title\":" + Epub.q(name) + ",\"size\":" + n + "}";
            }
            /* 纯文本：落盘成 <id>.txt，阅读时用 _booktext/ 同源地址取，过桥只传地址 */
            if (okText) {
                boolean md = lower.endsWith(".md") || lower.endsWith(".markdown");
                File out = new File(booksRoot(), id + (md ? ".md" : ".txt"));
                long n = copyTo(in, out);
                saveBookMeta(id, name, md ? "md" : "txt", n, null);
                return "{\"ok\":true,\"kind\":\"book\",\"id\":" + Epub.q(id)
                     + ",\"title\":" + Epub.q(name.replaceAll("(?i)\\.(txt|md|markdown)$", ""))
                     + ",\"type\":\"" + (md ? "md" : "txt") + "\",\"size\":" + n + "}";
            }
            if (lower.endsWith(".pdf")) {
                File f = Pdf.stage(in, booksRoot(), id);
                String info = Pdf.info(f);
                if (info.indexOf("\"ok\":true") < 0) { try { f.delete(); } catch (Throwable t) {} return info; }
                saveBookMeta(id, name, "pdf", f.length(), null);
                return "{\"ok\":true,\"id\":" + Epub.q(id) + ",\"title\":" + Epub.q(name.replaceAll("(?i)\\.pdf$", ""))
                     + ",\"type\":\"pdf\",\"kind\":\"book\",\"info\":" + info + "}";
            }
            File epubFile = Epub.stage(in, booksRoot(), id);
            File dir = new File(booksRoot(), id);
            String j = Epub.importTo(epubFile, dir);
            if (j.indexOf("\"ok\":true") < 0) { Epub.deleteTree(dir); return j; }
            /* 章节目录一起存进元信息：否则重开 App 后「目录」按钮会拿不到标题 */
            String chaptersJson = null;
            try { chaptersJson = new org.json.JSONObject(j).getJSONArray("chapters").toString(); } catch (Throwable t) {}
            saveBookMeta(id, name, "epub", 0, chaptersJson);
            /* 把 id / type / 原文件名补进结果 JSON */
            return j.substring(0, j.length() - 1) + ",\"id\":" + Epub.q(id)
                 + ",\"type\":\"epub\",\"kind\":\"book\",\"file\":" + Epub.q(name.replaceAll("(?i)\\.epub$", "")) + "}";
        } catch (Throwable e) {
            return "{\"ok\":false,\"error\":" + Epub.q(msgOf(e)) + "}";
        } finally { if (in != null) try { in.close(); } catch (Throwable t) {} }
    }

    /** 把导入结果回传给网页 */
    private void bookResult(String json) {
        final String js = "window.__yzBookResult&&window.__yzBookResult(" + json + ")";
        try { if (web != null) web.evaluateJavascript(js, null); } catch (Throwable ignored) {}
    }

    @Override protected void onPause() {
        /* 退到后台时把面包屑落盘：进程若被系统直接杀掉，内存里的记录还在 */
        try { DiagStore.flushBread(this); } catch (Throwable ignored) {}
        /* 页面已经画出来了才退到后台 → 这轮其实启动成功。
           否则「用几秒就退出」会被当成启动失败，累计几次就误进安全模式。 */
        if (pageLoaded) { try { DiagStore.bootOk(this); } catch (Throwable ignored) {} }
        super.onPause();
    }

    @Override protected void onDestroy() {
        /* 朗读引擎必须先关：否则退出后还会继续出声，引擎连接也会泄漏 */
        try { ttsRelease(); } catch (Throwable ignored) {}
        try { if (web != null) { web.stopLoading(); web.destroy(); } } catch (Exception e) {}
        super.onDestroy();
    }

    /** 面包屑里只保留页面名，避免日志里塞满长 URL */
    private static String shortUrl(String u) {
        try {
            if (u == null) return "?";
            int i = u.indexOf("appassets.androidplatform.net/");
            String s = (i >= 0) ? u.substring(i + "appassets.androidplatform.net/".length()) : u;
            if (s.length() > 70) s = s.substring(0, 70);
            return s;
        } catch (Throwable t) { return "?"; }
    }

    private String appVersionName() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; } }
    private int appVersionCode() { try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception e) { return 0; } }

    private void toast(final String s) { runOnUiThread(new Runnable() { public void run() { Toast.makeText(MainActivity.this, s, Toast.LENGTH_LONG).show(); } }); }

    /* 导出结果对话框：标题直接给结论，正文给位置/文件名/字节数，content:// 额外可「打开文件」 */
    private void showExportDialog(final String title, final String msg, final Uri uri) {
        runOnUiThread(new Runnable() { public void run() {
            try {
                AlertDialog.Builder b = new AlertDialog.Builder(MainActivity.this)
                    .setTitle(title).setMessage(msg)
                    .setPositiveButton("知道了", null);
                if (uri != null && "content".equalsIgnoreCase(uri.getScheme())) {
                    b.setNeutralButton("用其他应用打开", new DialogInterface.OnClickListener() {
                        public void onClick(DialogInterface d, int w) {
                            try {
                                Intent i = new Intent(Intent.ACTION_VIEW);
                                i.setDataAndType(uri, lastSavedMime == null ? "*/*" : lastSavedMime);
                                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                startActivity(Intent.createChooser(i, "用其他应用打开"));
                            } catch (Exception e) { toast("没有可打开该格式的应用"); }
                        }
                    });
                }
                b.show();
            } catch (Throwable t) { toast(title + "\n" + msg); }
        }});
    }

    private void infoDialog(final String title, final String msg) {
        runOnUiThread(new Runnable() { public void run() {
            try { new AlertDialog.Builder(MainActivity.this).setTitle(title).setMessage(msg).setPositiveButton("知道了", null).show(); } catch (Exception e) {}
        }});
    }

    /* ---------------- 保存 / 打开文件（权限优雅降级） ---------------- */
    private boolean hasWritePerm() {
        if (Build.VERSION.SDK_INT >= 29) return true;
        if (Build.VERSION.SDK_INT < 23) return true;
        return checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    /* ---------------- 用户自选「导出文件夹」（SAF / Storage Access Framework） ----------------
       零权限：由用户在系统选择器里指定一个文件夹，本应用取得持久写权限，
       导出文件直接写进该文件夹——一定能在文件管理里找到（不受媒体库索引影响）。 */
    /* 取用户所选文件夹的「显示名」：查 DocumentsProvider 的 DISPLAY_NAME，失败再回退解析 documentId */
    private String treeDisplayName(Uri tree) {
        String id = "";
        try {
            id = DocumentsContract.getTreeDocumentId(tree);
            Uri docUri = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            Cursor c = getContentResolver().query(docUri, new String[]{ DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null);
            if (c != null) {
                try { if (c.moveToFirst()) { String n = c.getString(0); if (n != null && n.length() > 0) return n; } }
                finally { try { c.close(); } catch (Throwable t) {} }
            }
        } catch (Throwable t) {}
        try {
            int i = id.indexOf(':');
            String p = (i >= 0) ? id.substring(i + 1) : id;
            int j = p.lastIndexOf('/');
            if (j >= 0) p = p.substring(j + 1);
            if (p.length() > 0) return p;
        } catch (Throwable t) {}
        return "";
    }
    private Uri exportTree() {
        try {
            String s = getSharedPreferences("yz", 0).getString("exportTree", null);
            return (s == null || s.length() == 0) ? null : Uri.parse(s);
        } catch (Throwable t) { return null; }
    }
    private String exportTreeLabel() {
        Uri tree = exportTree();
        if (tree != null) {
            String nm = treeDisplayName(tree);
            return (nm != null && nm.length() > 0) ? ("你选择的文件夹「" + nm + "」") : "你选择的文件夹";
        }
        return "系统「下载」文件夹";
    }
    private boolean useAppFolder() {
        try { return getSharedPreferences("yz", 0).getBoolean("exportAppFolder", false); } catch (Throwable t) { return false; }
    }
    /* 应用专属外部目录：零权限、无需系统选择器；Android 10 的文件管理器可直接进入查看 */
    private File appExportDir() {
        File d = null;
        try { d = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS); } catch (Throwable t) {}
        if (d == null) d = new File(getFilesDir(), "export");
        if (!d.exists()) d.mkdirs();
        return d;
    }
    private Uri saveToAppFolder(String name, byte[] data) throws Exception {
        File f = new File(appExportDir(), name);
        FileOutputStream fo = new FileOutputStream(f);
        try { fo.write(data); fo.flush(); } finally { try { fo.close(); } catch (Throwable t) {} }
        return Uri.fromFile(f);
    }

    /* ---------------- 直写系统「下载」目录（Android 10 及以下，需存储权限） ----------------
       作用域存储下 MediaStore 写入的文件，部分机型（尤其国产 ROM）在文件管理器里不显示；
       直写公共 Download 目录 + 媒体扫描，能保证文件在「文件管理 → 下载」中一定看得到。 */
    private boolean directDownload() {
        try { return getSharedPreferences("yz", 0).getBoolean("directDownload", false); } catch (Throwable t) { return false; }
    }
    private boolean hasStoragePerm() {
        if (Build.VERSION.SDK_INT > 29) return false;   /* Android 11+：该权限已无效 */
        if (Build.VERSION.SDK_INT < 23) return true;
        try { return checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED; } catch (Throwable t) { return false; }
    }
    private Uri saveToPublicDownload(String name, byte[] data) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) throw new java.io.IOException("系统「下载」目录不可用");
        if (!dir.exists() && !dir.mkdirs()) throw new java.io.IOException("无法创建「下载」目录");
        File f = new File(dir, name);
        FileOutputStream fo = new FileOutputStream(f);
        try { fo.write(data); fo.flush(); } finally { try { fo.close(); } catch (Throwable t) {} }
        try { sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(f))); } catch (Throwable t) {}
        return Uri.fromFile(f);
    }

    /* 回读校验：确认文件真的写出了且字节数一致（对付「提示成功却没落盘」）。 */
    private long savedSize(Uri uri) {
        try {
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) return -1;
            long n = 0; byte[] buf = new byte[8192]; int r;
            while ((r = in.read(buf)) > 0) n += r;
            try { in.close(); } catch (Throwable t) {}
            return n;
        } catch (Throwable t) { return -1; }
    }

    private Uri saveToExportTree(Uri tree, String name, byte[] data, String mime) throws Exception {
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri doc = DocumentsContract.createDocument(getContentResolver(), parent, mime, name);
        if (doc == null) throw new java.io.IOException("无法在所选文件夹中创建文件");
        OutputStream os = getContentResolver().openOutputStream(doc);
        if (os == null) throw new java.io.IOException("无法写入所选文件夹");
        try { os.write(data); os.flush(); } finally { try { os.close(); } catch (Throwable t) {} }
        return doc;
    }

    private Uri saveDownload(String rawName, byte[] data, String mime) throws Exception {
        /* 文件名来自网页：净化后再落盘（去路径分隔符与控制字符，防穿越/覆盖） */
        String name = cleanFileName(rawName);
        /* 优先写入用户自选的「导出文件夹」（授权失效则自动回退系统「下载」） */
        lastSaveError = "";
        Uri _tree = exportTree();
        if (_tree != null) {
            try { lastSaveMethod = "tree"; return saveToExportTree(_tree, name, data, mime); }
            catch (Throwable t) {
                lastSaveError = "所选文件夹写入失败：" + ((t.getMessage() == null) ? t.getClass().getSimpleName() : t.getMessage());
            }
        }
        lastSaveMethod = "download";
        if (Build.VERSION.SDK_INT >= 29) {
            /* Android 10+ 作用域存储：优先走 MediaStore，文件才会出现在系统「文件管理 → 下载」。
               但 MediaProvider 在部分机型/系统版本上会对下面的写法拒收（insert 返回 null），例如：
                 · 某些 ROM 不接受显式 RELATIVE_PATH；
                 · 媒体库被安全策略限制 / Downloads 集合被停用；
                 · 目标存储卷当前不可写。
               旧实现在此直接抛错 → 用户看到「导出失败」。现在改为「两次 MediaStore 尝试 + 应用专属目录兜底」，
               保证无论系统怎么拒绝，导出都不会失败：
               1) 先按标准写法（显式 RELATIVE_PATH=Download）写；
               2) 失败则去掉 RELATIVE_PATH 再试一次（兼容收紧的 ROM）；
               3) 仍失败 → 写应用专属「下载」目录（零权限，必然可写），并在提示里说明真实原因。 */
            String msErr = "";
            try { return mediaStoreDownload(name, data, mime, true); }
            catch (Throwable tA) { msErr = _msg(tA); }
            try { return mediaStoreDownload(name, data, mime, false); }
            catch (Throwable tB) { msErr = msErr + " / " + _msg(tB); }
            lastSaveMethod = "appdir";
            lastSaveError = "系统媒体库拒绝写入（" + msErr + "）——已改存到应用专属文件夹。";
            return saveToAppFolder(name, data);
        }
        File dir;
        if (hasWritePerm()) {
            dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        } else {
            dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = getFilesDir();
        }
        if (!dir.exists()) dir.mkdirs();
        File f = new File(dir, name);
        FileOutputStream fo = new FileOutputStream(f); fo.write(data); fo.close();
        return Uri.fromFile(f);
    }

    /* MediaStore 写入的单次尝试。useRelativePath=false 时不设 RELATIVE_PATH，兼容部分收紧的 ROM。
       返回媒体库生成的 Uri；任何一步失败都抛异常，由上层决定「换个写法重试」还是「走兜底」。 */
    private Uri mediaStoreDownload(String name, byte[] data, String mime, boolean useRelativePath) throws Exception {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
        cv.put(MediaStore.Downloads.MIME_TYPE, mime);
        if (useRelativePath) cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        cv.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri coll = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri uri = getContentResolver().insert(coll, cv);
        if (uri == null) throw new java.io.IOException("媒体库未创建条目");
        OutputStream os = getContentResolver().openOutputStream(uri);
        if (os == null) { try { getContentResolver().delete(uri, null, null); } catch (Throwable t) {} throw new java.io.IOException("无法打开写入通道"); }
        try { os.write(data); os.flush(); } finally { try { os.close(); } catch (Throwable t) {} }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Downloads.IS_PENDING, 0);
        getContentResolver().update(uri, done, null, null);
        try { sendBroadcast(new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, uri)); } catch (Throwable t) {}
        return uri;
    }
    /* 把异常转成一句可读的原因（用于回传给网页，帮助定位问题） */
    private static String _msg(Throwable t) {
        if (t == null) return "未知错误";
        String m = t.getMessage();
        return (m == null || m.length() == 0) ? t.getClass().getSimpleName() : m;
    }

    /** 把来自网页的文件名净化为单层安全文件名 */
    private static String cleanFileName(String raw) {
        String n = (raw == null) ? "file" : raw.trim();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n.length(); i++) {
            char c = n.charAt(i);
            if (c < 32 || c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|') sb.append('_');
            else sb.append(c);
        }
        String out = sb.toString().trim();
        if (out.length() > 120) out = out.substring(out.length() - 120);
        if (out.isEmpty() || out.equals(".") || out.equals("..")) out = "file";
        return out;
    }

    /* 网页端本机存储的落盘位置：filesDir/webstore/<安全化 key>.txt */

    @Override protected void onResume() {
        super.onResume();
    }

    private File storeFile(String key) {
        try {
            String safe = (key == null ? "k" : key).replaceAll("[^A-Za-z0-9_.-]", "_");
            if (safe.length() > 60) safe = safe.substring(0, 60);
            return new File(new File(getFilesDir(), "webstore"), safe + ".txt");
        } catch (Throwable t) { return null; }
    }

    /* =================== 离线朗读（TTS）===================
       全部方法都在主线程执行（桥线程 / 引擎回调线程都往主线程 post），
       避免同一个 TextToSpeech 实例被多线程同时使用。 */

    /** 桥线程调用：把「创建引擎」派发到主线程。已经有实例 / 已在创建就不再重复派发。 */
    private void ttsEnsure() {
        if (tts != null || ttsStarting) return;
        ttsStarting = true;
        runOnUiThread(new Runnable() {
            public void run() {
                try { ttsCreate(); } catch (Throwable t) { ttsStarting = false; ttsInited = true; ttsReady = false; ttsReason = "创建语音引擎失败：" + _tmsg(t); }
            }
        });
    }

    /** 主线程：真正 new 一个 TextToSpeech，并把初始化结果记到字段里。 */
    private void ttsCreate() {
        if (tts != null) { ttsStarting = false; return; }
        tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
            @Override public void onInit(int status) {
                ttsStarting = false;
                ttsInited = true;
                if (status != TextToSpeech.SUCCESS) {
                    ttsReady = false;
                    ttsReason = "系统语音引擎初始化失败（status=" + status + "）";
                    ttsBusy = false;
                    ttsSegs.clear();
                    ttsSegIdx = 0;
                    return;
                }
                try { String e = tts.getDefaultEngine(); if (e != null) ttsEngine = e; } catch (Throwable ignored) {}
                int lang = ttsSetChinese();
                if (lang == TextToSpeech.LANG_MISSING_DATA) {
                    ttsReady = false;
                    ttsReason = "引擎缺少中文语音数据（手机设置 → 无障碍/语音合成 → 安装中文语音包）";
                } else if (lang == TextToSpeech.LANG_NOT_SUPPORTED) {
                    ttsReady = false;
                    ttsReason = "引擎不支持中文（请安装/启用中文语音引擎）";
                } else if (lang < 0) {
                    ttsReady = false;
                    ttsReason = "设置中文语种失败（code=" + lang + "）";
                } else {
                    ttsReady = true;
                    ttsReason = "";
                }
                try { tts.setOnUtteranceProgressListener(ttsListener()); } catch (Throwable ignored) {}
                /* 初始化前用户就按了朗读：这里补上（异步初始化的关键一步） */
                if (ttsBusy && !ttsStopped) {
                    if (ttsReady) { ttsPump(); }
                    else { ttsBusy = false; toast("本机没有可用的中文语音引擎，请到系统设置安装"); }
                }
            }
        });
    }

    /** 依次尝试 简体中文 → 中国 → 中文；返回 TextToSpeech 语种状态码（<0 表示不可用）。 */
    private int ttsSetChinese() {
        int r = TextToSpeech.LANG_NOT_SUPPORTED;
        if (tts == null) return TextToSpeech.ERROR;
        try {
            r = tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
            if (r < 0) { int r2 = tts.setLanguage(Locale.CHINA); if (r2 >= 0) r = r2; }
            if (r < 0) { int r3 = tts.setLanguage(Locale.CHINESE); if (r3 >= 0) r = r3; }
        } catch (Throwable t) { r = TextToSpeech.ERROR; }
        return r;
    }

    /** 分段队列的推进器：一段读完（onDone / onError）再喂下一段，避免引擎截断或拒收长文。 */
    private UtteranceProgressListener ttsListener() {
        return new UtteranceProgressListener() {
            @Override public void onStart(String id) {}
            @Override public void onDone(String id) { ttsNext(); }
            @Override public void onError(String id) { ttsNext(); }
            @Override public void onStop(String id, boolean interrupted) {}
        };
    }

    /** 引擎回调线程 → 主线程 */
    private void ttsNext() {
        runOnUiThread(new Runnable() { public void run() { ttsPump(); } });
    }

    /** 主线程：喂下一段。队列空了就把 busy 复位（网页据此把按钮变回「朗读」）。 */
    private void ttsPump() {
        if (tts == null || ttsStopped || !ttsReady) { ttsBusy = false; return; }
        if (ttsSegIdx >= ttsSegs.size()) {
            ttsBusy = false;
            ttsSegs.clear();
            ttsSegIdx = 0;
            return;
        }
        String seg = ttsSegs.get(ttsSegIdx);
        ttsSegIdx++;
        try {
            tts.setSpeechRate(ttsRate);
            String uid = "yztts-" + ttsSegIdx;
            int rc = tts.speak(seg, TextToSpeech.QUEUE_FLUSH, null, uid);
            if (rc == TextToSpeech.ERROR) {
                ttsReason = "引擎拒绝朗读（第 " + ttsSegIdx + " 段）";
                ttsBusy = false;
                ttsSegs.clear();
                ttsSegIdx = 0;
                toast("朗读失败：语音引擎拒绝了这段文字");
            }
        } catch (Throwable t) {
            ttsReason = "朗读异常：" + _tmsg(t);
            ttsBusy = false;
            ttsSegs.clear();
            ttsSegIdx = 0;
            toast("朗读失败：" + _tmsg(t));
        }
    }

    /** 主线程：开始朗读一批已经切好的段落。 */
    private void ttsStart(List<String> segs, float rate) {
        ttsEnsure();
        ttsRate = rate;
        ttsStopped = false;
        ttsSegs.clear();
        ttsSegs.addAll(segs);
        ttsSegIdx = 0;
        ttsBusy = true;
        if (tts == null) {          // 还在建（异步）→ 初始化回调里会接着读
            ttsInited = false;
            return;
        }
        if (ttsInited && !ttsReady) {
            ttsBusy = false;
            ttsSegs.clear();
            ttsSegIdx = 0;
            toast("本机没有可用的中文语音引擎，请到系统设置安装");
            return;
        }
        if (!ttsInited || !ttsReady) return;   // 等 onInit 回调
        try { tts.stop(); } catch (Throwable ignored) {}
        ttsPump();
    }

    /** 主线程：停止并清队列（可重复调用）。 */
    private void ttsStopNow() {
        ttsStopped = true;
        ttsBusy = false;
        ttsSegs.clear();
        ttsSegIdx = 0;
        if (tts != null) { try { tts.stop(); } catch (Throwable ignored) {} }
    }

    /** 主线程：销毁引擎（onDestroy 必调，否则连接泄漏、退出后还会出声）。 */
    private void ttsRelease() {
        ttsStopped = true;
        ttsBusy = false;
        ttsSegs.clear();
        ttsSegIdx = 0;
        if (tts != null) {
            try { tts.stop(); } catch (Throwable ignored) {}
            try { tts.shutdown(); } catch (Throwable ignored) {}
            tts = null;
        }
        ttsStarting = false;
        ttsReady = false;
        ttsInited = false;
    }

    /** 单段上限：官方上限（一般 4000）再留 200 字符余量，个别引擎贴近上限会报错。 */
    private static int ttsMaxLen() {
        int max = 4000;
        try {
            int m = TextToSpeech.getMaxSpeechInputLength();
            if (m > 400) max = m;
        } catch (Throwable ignored) {}
        return max - 200;
    }

    /** 长文切段：优先在句末 / 换行处切（回看最后 1/4 段长），找不到就硬切。 */
    private static List<String> ttsSplit(String text) {
        List<String> out = new ArrayList<String>();
        String t = (text == null) ? "" : text.replace("\r\n", "\n").replace('\r', '\n');
        int max = ttsMaxLen();
        int i = 0, n = t.length();
        while (i < n) {
            int end = Math.min(n, i + max);
            if (end < n) {
                int floor = Math.max(i + 1, end - Math.max(80, max / 4));
                int cut = -1;
                for (int p = end - 1; p >= floor; p--) {
                    char ch = t.charAt(p);
                    if (ch == '\n' || ch == '。' || ch == '！' || ch == '？' || ch == '；'
                            || ch == '…' || ch == '!' || ch == '?' || ch == ';') { cut = p + 1; break; }
                }
                if (cut > i) end = cut;
            }
            String seg = t.substring(i, end).trim();
            if (seg.length() > 0) out.add(seg);
            i = end;
        }
        return out;
    }

    /** 语速解析：空 / 非法 → 1.0；超出 0.5~2.0 夹紧。 */
    private static float ttsParseRate(String s) {
        float r = 1.0f;
        try {
            if (s != null && s.trim().length() > 0) r = Float.parseFloat(s.trim());
        } catch (Throwable ignored) { r = 1.0f; }
        if (Float.isNaN(r) || Float.isInfinite(r) || r <= 0f) r = 1.0f;
        if (r < 0.5f) r = 0.5f;
        if (r > 2.0f) r = 2.0f;
        return r;
    }

    /** 系统里注册的 TTS 引擎个数（只做诊断用；Android 11+ 包可见性受限时可能为 0，
        所以「能不能读」一律以初始化回调的结论为准，不以这个数字为准）。 */
    private int ttsEngineCount() {
        if (ttsEngineCount >= 0) return ttsEngineCount;
        int n = 0;
        try {
            if (tts != null) {
                List<TextToSpeech.EngineInfo> es = tts.getEngines();
                if (es != null) n = es.size();
            }
        } catch (Throwable ignored) {}
        ttsEngineCount = n;
        return n;
    }

    /** 状态 JSON（手写拼接，避免多引一层 org.json）：网页据此决定是否显示朗读按钮 / 给什么提示。 */
    private String ttsStatusJson() {
        StringBuilder sb = new StringBuilder(220);
        sb.append("{\"ok\":").append(ttsReady ? "true" : "false");
        sb.append(",\"lang\":\"zh-CN\"");
        sb.append(",\"engine\":\"").append(_tjson(ttsEngine)).append('"');
        sb.append(",\"reason\":\"").append(_tjson(ttsReason)).append('"');
        sb.append(",\"inited\":").append(ttsInited ? "true" : "false");
        sb.append(",\"busy\":").append(ttsBusy ? "true" : "false");
        sb.append(",\"rate\":").append(String.format(Locale.US, "%.2f", Float.valueOf(ttsRate)));
        sb.append(",\"engineCount\":").append(ttsEngineCount());
        sb.append('}');
        return sb.toString();
    }

    /** JSON 字符串转义（与 DiagStore.esc 同一套规则） */
    private static String _tjson(String s) {
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

    private static String _tmsg(Throwable t) {
        if (t == null) return "未知错误";
        String m = t.getMessage();
        return (m == null || m.length() == 0) ? t.getClass().getSimpleName() : m;
    }

    /* ---------------- JS 桥 ---------------- */
    public class Bridge {
        /** 仅在「内置站点」页面内允许使用桥；用户导入的 /sites/ 第三方页面一律屏蔽（防任意页面调用本机能力）。 */
        private boolean trusted() {
            /* 判定顺序：web.getUrl() → 记录的主框架地址 → 都拿不到则放行。
               本应用完全离线（无 INTERNET 权限），所有请求都被资源层拦到内置资产域，
               外部页面无法加载；因此这里唯一需要拒绝的是「用户导入的第三方页面 /sites/」。 */
            try {
                String u = (web == null) ? null : web.getUrl();
                if (u == null || u.length() == 0) u = lastMainUrl;
                if (u == null || u.length() == 0) return true;
                Uri uu = Uri.parse(u);
                String sch = (uu.getScheme() == null) ? "" : uu.getScheme().toLowerCase(Locale.US);
                String host = (uu.getHost() == null) ? "" : uu.getHost().toLowerCase(Locale.US);
                String p = uu.getPath();
                if (p != null && (p.equals("/sites") || p.startsWith("/sites/"))) return false;  /* 第三方页面：拒绝 */
                if ((sch.equals("https") || sch.equals("http")) && host.equals(ASSET_HOST)) return true;
                if (sch.equals("file") && p != null && p.startsWith("/android_asset/")) return true;
                if (sch.equals("about") || sch.equals("blob") || sch.equals("data")) return true;
                return false;   /* 其它明确来源：拒绝 */
            } catch (Throwable t) { return true; }
        }

        /** 当前页面地址（诊断用）：优先 getUrl()，其次记录值 */
        private String curUrl() {
            try {
                String u = (web == null) ? null : web.getUrl();
                if (u != null && u.length() > 0) return u;
            } catch (Throwable ignored) {}
            return (lastMainUrl == null) ? "(未知)" : lastMainUrl;
        }
        /* ---------------- 诊断与日志（崩溃落盘 / 面包屑 / 安全模式） ---------------- */
        /** 启动横幅摘要：最近一次崩溃、启动失败次数、是否安全模式 */
        @JavascriptInterface public String crashPending() {
            try { return DiagStore.pendingSummary(MainActivity.this); } catch (Throwable t) { return "{}"; }
        }
        /** 全量诊断 JSON（崩溃报告 + 面包屑 + 状态）：由网页导出成 .txt/.json */
        @JavascriptInterface public String diagRead() {
            try { return DiagStore.readAll(MainActivity.this); } catch (Throwable t) { return "{}"; }
        }
        @JavascriptInterface public void diagClear() { try { DiagStore.clear(MainActivity.this); } catch (Throwable ignored) {} }
        @JavascriptInterface public void diagSeen() { try { DiagStore.markSeen(MainActivity.this); } catch (Throwable ignored) {} }
        /** 面包屑：网页每点一下报一条，崩溃报告里会带上最近 60 条 */
        @JavascriptInterface public void bread(final String s) {
            try { DiagStore.bread(MainActivity.this, s); } catch (Throwable ignored) {}
        }
        @JavascriptInterface public void bootOk() { try { DiagStore.bootOk(MainActivity.this); } catch (Throwable ignored) {} }
        @JavascriptInterface public boolean safeMode() { try { return DiagStore.safeMode(MainActivity.this); } catch (Throwable t) { return false; } }
        @JavascriptInterface public void exitSafeMode() { try { DiagStore.exitSafeMode(MainActivity.this); } catch (Throwable ignored) {} }
        /**
         * 诊断自测：在「设置 → 诊断与日志」长按触发，制造一次真正的 Java 未捕获异常。
         * 必须在独立线程抛（桥线程抛异常会被 WebView 吞掉，测不出落盘链路）。
         * 触发后 App 会退出，重新打开应看到「上次异常退出」提示条 —— 这就是链路的验收标准。
         */
        @JavascriptInterface public void diagCrashTest() {
            try { DiagStore.bread(MainActivity.this, "诊断自测：主动触发崩溃"); DiagStore.flushBread(MainActivity.this); } catch (Throwable ignored) {}
            new Thread(new Runnable() {
                @Override public void run() {
                    throw new RuntimeException("学通诊断自测：这是用户主动触发的测试崩溃，可安全忽略");
                }
            }, "diag-selftest").start();
        }

        @JavascriptInterface public String platform() { return "android"; }
        @JavascriptInterface public boolean systemDark() {
            try {
                int m = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
                return m == Configuration.UI_MODE_NIGHT_YES;
            } catch (Throwable t) { return true; }
        }
        @JavascriptInterface public String versionName() { return appVersionName(); }
        @JavascriptInterface public String getVersionName() { return appVersionName(); }
        @JavascriptInterface public int versionCode() { return appVersionCode(); }
        /** 返回键自检：最近一次按返回键实际发生了什么 */
        @JavascriptInterface public String backProbe() { return lastBackInfo; }
        /* 内核/环境诊断：便于把线上问题一次性定位到“是不是 WebView 版本问题” */
        @JavascriptInterface public String webviewVersion() {
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    android.content.pm.PackageInfo pi = WebView.getCurrentWebViewPackage();
                    if (pi != null) return pi.versionName + " | " + pi.packageName;
                }
            } catch (Throwable t) {}
            return "unknown";
        }
        @JavascriptInterface public String deviceInfo() {
            try { return Build.MANUFACTURER + " " + Build.MODEL + " | Android " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")"; }
            catch (Throwable t) { return "unknown"; }
        }

        /* 本机存储兜底：WebView 的 localStorage 不可用时，网页端会改用这里持久化 */
        @JavascriptInterface public String storeGet(final String key) {
            try {            if (!trusted()) return "";

                File f = storeFile(key);
                if (f == null || !f.exists()) return "";
                byte[] buf = new byte[(int) f.length()];
                FileInputStream in = new FileInputStream(f);
                int n = in.read(buf);
                in.close();
                return (n <= 0) ? "" : new String(buf, 0, n, "UTF-8");
            } catch (Throwable t) { return ""; }
        }
        @JavascriptInterface public void storeSet(final String key, final String val) {
            try {            if (!trusted()) return;

                File f = storeFile(key);
                if (f == null) return;
                File par = f.getParentFile();
                if (par != null) par.mkdirs();
                FileOutputStream o = new FileOutputStream(f);
                o.write((val == null ? "" : val).getBytes("UTF-8"));
                o.close();
            } catch (Throwable t) {}
        }
        /** 更新渠道：本应用经 F-Droid / 项目发布页更新，不在应用内下载安装。 */
        @JavascriptInterface public String updateChannel() { return "fdroid"; }

        /* 外部链接：由网页 JS 调用（WebView 的 window.open 在 setSupportMultipleWindows=false 下无效） */
        @JavascriptInterface public void openExternal(final String url) {
            if (url == null) return;            if (!trusted()) return;

            final String u = url.trim();
            if (!(u.startsWith("http://") || u.startsWith("https://"))) return;
            runOnUiThread(new Runnable() { public void run() { handleUrl(u); } });
        }

        /* 选择导出文件夹（SAF）：零权限，用户自选，之后导出即存那里 */
        @JavascriptInterface public void chooseExportDir() {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    if (!trusted()) { toast("导出位置：安全校验未通过，已取消"); return; }
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                    /* 只带「读 + 写 + 可持久化」三个 flag。部分 ROM 见到 PREFIX flag 会异常返回。 */
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                             | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                             | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    try {
                        if (i.resolveActivity(getPackageManager()) == null) {
                            toast("本机没有可用的「文件选择器」，无法自选文件夹；导出仍会存到系统「下载」。"); return;
                        }
                    } catch (Throwable ignore) { /* 解析失败时仍尝试启动 */ }
                    startActivityForResult(i, REQ_TREE);
                } catch (Throwable e) {
                    String m = (e.getMessage() == null) ? e.getClass().getSimpleName() : e.getMessage();
                    toast("无法打开文件夹选择器：" + m);
                }
            }});
        }
        @JavascriptInterface public boolean hasExportDir() { return exportTree() != null; }

        /* ---------------- 电子书阅读（0.17.36） ----------------
           选书走 SAF（零权限），导入后文件落在 App 私有目录，之后按需读取。 */
        @JavascriptInterface public void bookPick() {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    if (!trusted()) { toast("选择文件：安全校验未通过，已取消"); return; }
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    /* 一次能选多个：书和照片混着选也行，导入时按扩展名各归各位 */
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "application/epub+zip", "application/pdf", "text/plain", "text/markdown", "image/*" });
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                    try { if (i.resolveActivity(getPackageManager()) == null) { toast("本机没有可用的文件选择器"); return; } } catch (Throwable ignore) {}
                    startActivityForResult(i, REQ_BOOK);
                } catch (Throwable e) { toast("无法打开文件选择器：" + msgOf(e)); }
            }});
        }
        @JavascriptInterface public String bookChapter(String id, int idx) {
            try {
                File dir = new File(booksRoot(), id);
                if (!dir.exists() || !dir.isDirectory()) return "<p class=\"sub\">这本书已经不在了，请重新导入</p>";
                return Epub.chapterHTML(dir, idx);
            } catch (Throwable e) { return "<p class=\"sub\">读取失败：" + msgOf(e) + "</p>"; }
        }
        @JavascriptInterface public String bookPage(String id, int idx, int w) {
            try {
                File pdf = new File(booksRoot(), id + ".pdf");
                if (!pdf.exists()) return "{\"ok\":false,\"error\":\"文件不存在\"}";
                int ww = w > 0 ? w : 780;
                String rel = id + "/" + idx + "-" + ww + ".jpg";
                File out = new File(bookPagesRoot(), rel);
                String r;
                if (out.exists() && out.length() > 0) {
                    /* 已经渲染过：直接复用文件，网页那边也有图片缓存 */
                    r = "{\"ok\":true,\"pages\":0,\"bytes\":" + out.length() + "}";
                } else {
                    r = Pdf.renderTo(pdf, idx, ww, out, pdfNightOn());
                }
                if (r.indexOf("\"ok\":true") < 0) return r;
                String url = "https://" + ASSET_HOST + "/_bookpage/" + rel + "?v=" + out.lastModified();
                return r.substring(0, r.length() - 1) + ",\"url\":" + Epub.q(url) + "}";
            } catch (Throwable e) { return "{\"ok\":false,\"error\":" + Epub.q(msgOf(e)) + "}"; }
        }
        /** 纯文本正文的同源地址（JS 用它 fetch，不走 base64 过桥） */
        @JavascriptInterface public String bookTextUrl(String id) {
            try {
                if (badRel(id)) return "";
                File t = new File(booksRoot(), id + ".txt");
                if (!t.exists()) { File m = new File(booksRoot(), id + ".md"); if (m.exists()) t = m; }
                if (!t.exists() || !t.isFile()) return "";
                return "https://" + ASSET_HOST + "/_booktext/" + t.getName() + "?v=" + t.lastModified();
            } catch (Throwable e) { return ""; }
        }

        /** 相册：直接扫私有目录，按时间倒序 */
        @JavascriptInterface public String photoList() {
            StringBuilder sb = new StringBuilder("[");
            try {
                File[] fs = photosRoot().listFiles();
                java.util.ArrayList<org.json.JSONObject> arr = new java.util.ArrayList<org.json.JSONObject>();
                if (fs != null) for (File f : fs) {
                    if (!f.isFile() || !f.getName().endsWith(".json")) continue;
                    String t = Epub.readText(f);
                    if (t == null || t.length() < 2) continue;
                    try { arr.add(new org.json.JSONObject(t)); } catch (Throwable ignored) {}
                }
                java.util.Collections.sort(arr, new java.util.Comparator<org.json.JSONObject>() {
                    public int compare(org.json.JSONObject a, org.json.JSONObject b) {
                        return Long.compare(b.optLong("at", 0), a.optLong("at", 0));
                    }
                });
                boolean first = true;
                for (org.json.JSONObject o : arr) {
                    if (!first) sb.append(',');
                    sb.append(o.toString()); first = false;
                }
            } catch (Throwable ignored) {}
            return sb.append(']').toString();
        }

        /** 把相册里的一张照片导出到系统「下载」——字节全在原生侧搬，不过 JS 桥 */
        @JavascriptInterface public void photoExport(final String id) {
            new Thread(new Runnable() { public void run() {
                try {
                    if (badRel(id)) { finishSave(null, false, "❌ 参数异常", 0, "", null); return; }
                    File src = null; String ext = ".jpg"; String nm = null;
                    File[] fs = photosRoot().listFiles();
                    if (fs != null) for (File f : fs) {
                        String fn = f.getName();
                        if (fn.equals(id + ".json")) {
                            try { nm = new org.json.JSONObject(Epub.readText(f)).optString("name", null); } catch (Throwable t) {}
                        }
                        if (fn.startsWith(id + ".") && !fn.endsWith(".json")) {
                            src = f; ext = fn.substring(id.length());
                        }
                    }
                    if (src == null) { finishSave(null, false, "❌ 找不到这张照片", 0, "", null); return; }
                    byte[] data = readBytes(src);
                    String low = ext.toLowerCase(Locale.US);
                    String mime = low.endsWith(".png") ? "image/png" : (low.endsWith(".webp") ? "image/webp"
                                : (low.endsWith(".gif") ? "image/gif" : "image/jpeg"));
                    String base = (nm == null || nm.length() == 0) ? ("photo-" + id) : nm;
                    if (base.toLowerCase(Locale.US).endsWith(low)) { /* 已带后缀 */ } else { base = base + ext; }
                    lastSavedMime = mime;
                    try {
                        Uri u = saveDownload(base, data, mime);
                        String where = "tree".equals(lastSaveMethod) ? exportTreeLabel()
                                     : ("appdir".equals(lastSaveMethod) ? ("应用专属文件夹：" + appExportDir().getAbsolutePath())
                                                                         : "系统「文件管理 → 下载」");
                        finishSave(u, true, "✅ 已导出\n位置：" + where + "\n文件名：" + base + "\n大小：" + data.length + " 字节",
                            data.length, base, u == null ? null : u.toString());
                    } catch (Throwable e) {
                        finishSave(null, false, "❌ 导出失败\n" + msgOf(e), 0, base, null);
                    }
                } catch (Throwable e) {
                    finishSave(null, false, "❌ 导出失败\n" + msgOf(e), 0, "", null);
                }
            }}).start();
        }

        @JavascriptInterface public void photoRemove(String id) {
            try {
                if (badRel(id)) return;
                File root = photosRoot();
                File[] fs = root.listFiles();
                if (fs != null) for (File f : fs) {
                    String n = f.getName();
                    if (n.startsWith(id + ".") || n.equals(id + ".json")) { try { f.delete(); } catch (Throwable ignored) {} }
                }
                toast("已从相册删除");
            } catch (Throwable e) { toast("删除失败：" + msgOf(e)); }
        }

        /** 切到/退出夜间：清掉已渲染的页图缓存，让下次翻页按新配色重出图 */
        @JavascriptInterface public void setPdfNight(final boolean on) {
            try {
                boolean old = pdfNightOn();
                getSharedPreferences("yz", 0).edit().putBoolean("pdfNight", on).apply();
                if (old == on) return;
                File[] dirs = bookPagesRoot().listFiles();
                if (dirs != null) for (File d : dirs) {
                    if (d.isDirectory()) {
                        File[] fs = d.listFiles();
                        if (fs != null) for (File f : fs) { try { f.delete(); } catch (Throwable t) {} }
                    }
                }
            } catch (Throwable t) { }
        }

        /** 阅读时隐藏系统状态栏/导航栏（沉浸）；退出阅读再显示回来 */
        @JavascriptInterface public void setImmersive(final boolean on) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= 30) {
                        android.view.WindowInsetsController c = getWindow().getInsetsController();
                        if (c != null) {
                            if (on) {
                                c.hide(android.view.WindowInsets.Type.systemBars());
                                c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                            } else {
                                c.show(android.view.WindowInsets.Type.systemBars());
                            }
                        }
                    } else {
                        android.view.View d = getWindow().getDecorView();
                        if (on) {
                            d.setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                                | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
                        } else {
                            d.setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_VISIBLE);
                        }
                    }
                } catch (Throwable t) { }
            }});
        }

        @JavascriptInterface public String bookList() {
            StringBuilder sb = new StringBuilder("[");
            try {
                File[] fs = booksRoot().listFiles();
                boolean first = true;
                if (fs != null) for (File f : fs) {
                    if (!f.isFile() || !f.getName().endsWith(".json")) continue;
                    String t = Epub.readText(f);
                    if (t == null || t.length() < 2) continue;
                    if (!first) sb.append(',');
                    sb.append(t); first = false;
                }
            } catch (Throwable ignored) {}
            return sb.append(']').toString();
        }
        /* 阅读进度另存一份到原生（SharedPreferences）。
           原因：WebView 的 localStorage 是"尽力而为"的存储——系统空间不足、
           WebView 组件升级、用户在系统里清"缓存"都可能让它整片消失，
           而 Chromium 的 LevelDB 一旦损坏在 Android 上没有 API 能修。
           进度丢失是用户最恼火的一类问题，所以双写：网页侧 localStorage（快）+ 原生（稳）。 */
        @JavascriptInterface public void bookPosSave(String json) {
            try { getSharedPreferences("yz", 0).edit().putString("bookPos", json == null ? "{}" : json).apply(); } catch (Throwable t) {}
        }
        @JavascriptInterface public String bookPosLoad() {
            try { return getSharedPreferences("yz", 0).getString("bookPos", "{}"); } catch (Throwable t) { return "{}"; }
        }

        /* 导出全部书（书文件本身，标准格式）——「换台设备还能打开」的前提。
           返回 JSON：{ok, n, bytes, skipped, folder, failed:[...]} */
        @JavascriptInterface public String exportLibrary() {
            File root = booksRoot();
            File[] items = root.listFiles();
            if (items == null) return "{\"ok\":false,\"error\":\"书库目录不可读\"}";
            java.util.Arrays.sort(items, new java.util.Comparator<File>() {
                public int compare(File a, File b) { return a.getName().compareTo(b.getName()); }
            });
            int n = 0; long total = 0; int skipped = 0;
            java.util.ArrayList<String> failed = new java.util.ArrayList<String>();
            java.util.HashSet<String> used = new java.util.HashSet<String>();

            for (File f : items) {
                String nm = f.getName();
                if (nm.endsWith(".json")) continue;
                if (nm.startsWith("_")) continue;

                String id, ext = "", title;
                if (f.isDirectory()) {
                    id = nm; ext = "epub";
                } else {
                    int dot = nm.lastIndexOf('.');
                    if (dot <= 0) { skipped++; continue; }
                    id = nm.substring(0, dot);
                    ext = nm.substring(dot + 1).toLowerCase();
                    if (!("pdf".equals(ext) || "txt".equals(ext) || "md".equals(ext))) { skipped++; continue; }
                }
                title = bookTitleOf(root, id);
                if (title == null || title.trim().isEmpty()) title = id;
                title = cleanFileName(title.trim());
                if (title.length() > 60) title = title.substring(0, 60);

                String fname = title + "." + ext;
                if (used.contains(fname)) {
                    int k = 2;
                    while (used.contains(title + " (" + k + ")." + ext)) k++;
                    fname = title + " (" + k + ")." + ext;
                }
                used.add(fname);

                try {
                    byte[] data;
                    String mime;
                    if (f.isDirectory()) {
                        data = zipEpubDir(f);
                        mime = "application/epub+zip";
                    } else {
                        data = java.nio.file.Files.readAllBytes(f.toPath());
                        mime = "pdf".equals(ext) ? "application/pdf"
                             : ("md".equals(ext) ? "text/markdown" : "text/plain");
                    }
                    if (data == null || data.length == 0) { failed.add(fname + "：内容为空"); continue; }
                    saveDownload(fname, data, mime);
                    n++; total += data.length;
                } catch (Throwable t) {
                    String m = (t.getMessage() == null) ? t.getClass().getSimpleName() : t.getMessage();
                    failed.add(fname + "：" + m);
                }
            }

            StringBuilder sb = new StringBuilder();
            sb.append("{\"ok\":").append(failed.isEmpty()).append(",\"n\":").append(n)
              .append(",\"bytes\":").append(total).append(",\"skipped\":").append(skipped)
              .append(",\"folder\":\"").append(exportTree() != null ? "tree" : "download").append("\"");
            if (exportTree() != null) {
                sb.append(",\"folderName\":\"").append(jsEscape(exportTreeLabel())).append("\"");
            }
            sb.append(",\"failed\":[");
            for (int i = 0; i < failed.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append('"').append(jsEscape(failed.get(i))).append('"');
            }
            sb.append("]}");
            return sb.toString();
        }

        @JavascriptInterface public void bookRemove(String id) {
            try {
                File root = booksRoot();
                File dir = new File(root, id);
                if (dir.exists()) Epub.deleteTree(dir);
                File pdf = new File(root, id + ".pdf");
                if (pdf.exists()) pdf.delete();
                File txt = new File(root, id + ".txt");
                if (txt.exists()) txt.delete();
                File md = new File(root, id + ".md");
                if (md.exists()) md.delete();
                File meta = new File(root, id + ".json");
                if (meta.exists()) meta.delete();
                toast("已删除这本书的本机副本");
            } catch (Throwable e) { toast("删除失败：" + msgOf(e)); }
        }
        @JavascriptInterface public boolean isDirectDownload() { return directDownload() && hasStoragePerm(); }
        @JavascriptInterface public void requestDirectDownload() {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    if (Build.VERSION.SDK_INT > 29) { toast("本机（Android 11 及以上）不允许直写系统目录；请改用「选择文件夹」或「用应用文件夹」。"); return; }
                    if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
                        getSharedPreferences("yz", 0).edit().putBoolean("directDownload", true).apply();
                        toast("已开启：导出将直接写入系统「下载」目录（文件管理器一定看得到）");
                        return;
                    }
                    requestPermissions(new String[]{ android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, REQ_PERM);
                } catch (Throwable t) { toast("申请存储权限失败：" + ((t.getMessage() == null) ? t.getClass().getSimpleName() : t.getMessage())); }
            }});
        }
        @JavascriptInterface public void clearDirectDownload() {
            try { getSharedPreferences("yz", 0).edit().putBoolean("directDownload", false).apply(); toast("已关闭直写；导出位置回到其它设置"); } catch (Throwable t) {}
        }
        @JavascriptInterface public void useAppFolderExportDir() {
            try {
                getSharedPreferences("yz", 0).edit().putBoolean("exportAppFolder", true).remove("exportTree").remove("exportTreeName").apply();
                toast("导出位置已设为：应用专属文件夹（零权限）");
            } catch (Throwable t) {}
        }
        @JavascriptInterface public String exportDirLabel() { return exportTreeLabel(); }
        @JavascriptInterface public void clearExportDir() {
            try { getSharedPreferences("yz", 0).edit().remove("exportTree").remove("exportTreeName").remove("exportAppFolder").putBoolean("directDownload", false).apply(); toast("已改回：存到系统「下载」（媒体库方式）"); } catch (Throwable t) {}
        }

        @JavascriptInterface public void saveBase64(final String name, final String b64, final String mime) {
            if (!trusted()) { finishSave(null, false, "❌ 导出失败\n原因：当前是否为「用户导入的第三方页面」校验未通过，已阻止保存。\n当前页面：" + curUrl(), 0, name, ""); return; }
            new Thread
(new Runnable() { public void run() {
                try {
                    byte[] data = Base64.decode(b64, Base64.DEFAULT);
                    lastSavedMime = (mime == null ? "application/octet-stream" : mime);
                    Uri uri = saveDownload(name, data, lastSavedMime);
                    long sz = savedSize(uri);
                    boolean sizeOk = (sz == data.length);
                    String where = "tree".equals(lastSaveMethod) ? exportTreeLabel()
                                 : ("appdir".equals(lastSaveMethod) ? ("应用专属文件夹：" + appExportDir().getAbsolutePath())
                                                                     : "系统「文件管理 → 下载」");
                    StringBuilder m = new StringBuilder();
                    m.append("位置：").append(where).append("\n");
                    m.append("文件：").append(name).append("\n");
                    m.append("大小：").append(sz).append(" 字节");
                    if (sizeOk) m.append("（与原数据一致✓）");
                    else m.append("（应为 ").append(data.length).append(" 字节，不一致）");
                    if (lastSaveError.length() > 0) m.append("\n\n⚠ ").append(lastSaveError).append("\n已改存到上面的位置。");
                    String title = sizeOk ? (lastSaveError.length() > 0 ? "⚠ 导出完成（已回退位置）" : "✅ 导出成功")
                                          : "❌ 导出可能未写入";
                    finishSave((sizeOk ? uri : null), sizeOk,
                               title + "\n" + m.toString(), data.length, name,
                               sizeOk ? uri.toString() : "");
                } catch (Throwable e) {
                    finishSave(null, false, "❌ 导出失败\n原因：" + ((e.getMessage() == null) ? e.getClass().getSimpleName() : e.getMessage()), 0, name, "");
                }
            }}).start();
        }

        /* 统一出口：系统弹窗 + 把真实结果回传网页。网页据此更新浮层，不再自己猜。 */
        private void finishSave(final Uri uri, final boolean ok, final String msg, final int bytes, final String name, final String uriStr) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    String title = msg.contains("\n") ? msg.substring(0, msg.indexOf('\n')) : msg;
                    showExportDialog(title, msg, (ok && uri != null) ? uri : null);
                } catch (Throwable t) {}
                try {
                    String js = "window.__yzSaveResult&&window.__yzSaveResult("
                        + new org.json.JSONObject()
                            .put("ok", ok).put("msg", msg).put("uri", uriStr)
                            .put("mime", lastSavedMime == null ? "" : lastSavedMime)
                            .put("name", name == null ? "" : name).put("bytes", bytes).toString()
                        + ")";
                    if (web != null) web.evaluateJavascript(js, null);
                } catch (Throwable t) {}
            }});
        }

        /* 页面内「用其他应用打开」：直接调用，不再依赖系统弹窗 */
        @JavascriptInterface public void openSaved(final String uriStr, final String mime) {
            if (!trusted()) { toast("无法打开：安全校验未通过"); return; }
            runOnUiThread(new Runnable() { public void run() {
                try {
                    Uri u = Uri.parse(uriStr);
                    /* 应用专属目录里的文件是 file:// 形式：Android 7(API 24)+ 禁止把 file:// 经 Intent
                       外传给其他应用（FileUriExposedException）——「用其他应用打开」因此失效。
                       这里改用 ExportProvider 暴露的 content:// 加临时读权限，正常打开。 */
                    Uri open = u;
                    if ("file".equalsIgnoreCase(u.getScheme())) {
                        String nm = u.getLastPathSegment();
                        if (nm == null) { toast("文件路径无法解析"); return; }
                        open = ExportProvider.uriFor(nm);
                    }
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(open, (mime == null || mime.length() == 0) ? "*/*" : mime);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(i, "用其他应用打开"));
                } catch (Exception e) { toast("没有可打开该格式的应用"); }
            }});
        }

        @JavascriptInterface public void openFile(final String name, final String b64, final String mime) {
            if (!trusted()) return;
            new Thread
(new Runnable() { public void run() {
                try {
                    byte[] data = Base64.decode(b64, Base64.DEFAULT);
                    final Uri uri = saveDownload(name, data, mime == null ? "application/octet-stream" : mime);
                    runOnUiThread(new Runnable() { public void run() {
                        try {
                            Intent i = new Intent(Intent.ACTION_VIEW);
                            i.setDataAndType(uri, mime == null ? "*/*" : mime);
                            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                        } catch (Exception e) { toast("没有可打开该格式的应用"); }
                    }});
                } catch (Exception e) { toast("打开失败：" + e.getMessage()); }
            }}).start();
        }

        @JavascriptInterface public void shareText(final String title, final String text, final String url) {
            if (!trusted()) return;
            runOnUiThread
(new Runnable() { public void run() {
                try {
                    StringBuilder sb = new StringBuilder();
                    if (text != null && text.length() > 0) sb.append(text);
                    if (url != null && url.length() > 0) { if (sb.length() > 0) sb.append("\n"); sb.append(url); }
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_SUBJECT, title == null ? "" : title);
                    i.putExtra(Intent.EXTRA_TEXT, sb.toString());
                    startActivity(Intent.createChooser(i, "分享到"));
                } catch (Exception e) { toast("分享失败"); }
            }});
        }

        @JavascriptInterface public void toast(String s) { MainActivity.this.toast(s); }

        /* 网页切换深浅色时调用，让状态栏/导航栏/容器背景跟着变，
           否则系统栏区域会一直是启动时的颜色（深色页面配深红条、浅色页面更突兀）。 */
        @JavascriptInterface public void setBarColor(final String hex) {
            MainActivity.this.runOnUiThread(new Runnable() { public void run() {
                try {
                    int c = Color.parseColor(hex);
                    if (root != null) root.setBackgroundColor(c);
                    if (web != null) web.setBackgroundColor(c);
                    applyBarIconTone(c);
                } catch (Throwable ignored) {}
            }});
        }

        /* ---------------- 离线朗读（系统 TTS）----------------
           网页：assets/speech.js。全部本机、无权限、无网络。 */

        /** 引擎状态：{"ok":true/false,"lang":"zh-CN","engine":"包名","reason":"…","inited":…,"busy":…}。
            初始化是异步的：首次调用会顺手开始初始化并返回 inited=false，轮询几次即可拿到结论。 */
        @JavascriptInterface public String ttsStatus() {
            ttsEnsure();
            return ttsStatusJson();
        }

        /** 朗读。rate 为 float 字符串（0.5~2.0，空/非法按 1.0）。长文在原生侧再切段排队。
            返回 {"ok":true,"seg":N} 表示已受理（异步播放），{"ok":false,"reason":"…"} 表示拒绝。 */
        @JavascriptInterface public String ttsSpeak(final String text, final String rate) {
            try {
                final List<String> segs = ttsSplit(text);
                if (segs.isEmpty()) return "{\"ok\":false,\"reason\":\"没有可朗读的文字\"}";
                final float r = ttsParseRate(rate);
                final String back = "{\"ok\":true,\"seg\":" + segs.size() + "}";
                ttsEnsure();
                runOnUiThread(new Runnable() {
                    public void run() { ttsStart(segs, r); }
                });
                return back;
            } catch (Throwable t) {
                return "{\"ok\":false,\"reason\":\"" + _tjson(_tmsg(t)) + "\"}";
            }
        }

        /** 停止并清空队列（可重复调用）。 */
        @JavascriptInterface public void ttsStop() {
            try {
                runOnUiThread(new Runnable() { public void run() { ttsStopNow(); } });
            } catch (Throwable ignored) {}
        }

        /** 是否还在朗读：网页据此把按钮从「停止」复位回「朗读」。
            （TextToSpeech 没有「整段读完了」的回调出口，轮询这个最可靠） */
        @JavascriptInterface public boolean ttsBusy() { return ttsBusy; }

        /** 当前语速（只读，用于诊断）；设置语速请直接传 ttsSpeak 的第二个参数。 */
        @JavascriptInterface public String ttsRate() { return String.format(Locale.US, "%.2f", Float.valueOf(ttsRate)); }
    }

    /* ---------------- 版本分支隔离（避免旧系统类校验问题） ---------------- */
    static class Api30 {
        static void setupEdgeToEdge(Activity a) {
            Window w = a.getWindow();
            w.setDecorFitsSystemWindows(false);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= 29) w.setNavigationBarContrastEnforced(false);
        }
    }

    static class Api31 {
        static void blur(View v) {
            if (Build.VERSION.SDK_INT < 31 || v == null) return;
            try { v.setRenderEffect(RenderEffect.createBlurEffect(26f, 26f, Shader.TileMode.CLAMP)); } catch (Throwable t) {}
        }
        static void clearBlur(View v) {
            if (Build.VERSION.SDK_INT < 31 || v == null) return;
            try { v.setRenderEffect(null); } catch (Throwable t) {}
        }
    }

    static class Api33 {
        static void registerBack(final MainActivity a) {
            a.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                new android.window.OnBackInvokedCallback() {
                    @Override public void onBackInvoked() { a.dispatchBack(); }
                });
        }
    }
}
