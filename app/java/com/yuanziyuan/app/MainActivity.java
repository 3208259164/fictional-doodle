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
import java.util.HashMap;
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
    private static final int BAR_COLOR = 0xFF2B0505;   // 与 @color/bg 一致

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


        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setContentDescription("学通");
        setContentView(web);

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
                try { toast("页面渲染进程已重启，正在重新加载…"); } catch (Throwable t) {}
                if (!isFinishing()) { try { recreate(); } catch (Throwable t) {} }
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) {
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
                    if ("1".equals(val)) return;
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
        if (ASSET_HOST.equalsIgnoreCase(u.getHost())) return assetResponse(u.getPath());
        return blocked();
    }

    private Map<String, String> respHeaders(String mime) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("X-Content-Type-Options", "nosniff");
        h.put("Referrer-Policy", "no-referrer");
        /* 本地资产一律不走 WebView 的 HTTP 缓存：否则升级 APK 后，页面仍可能是上一版的缓存副本 */
        h.put("Cache-Control", "no-store, must-revalidate");
        h.put("Pragma", "no-cache");
        if (mime != null && mime.startsWith("text/html")) h.put("Content-Security-Policy", CSP);
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

    private WebResourceResponse assetResponse(String path) {
        try {
            String p = (path == null || path.equals("/")) ? "index.html" : path.substring(1);
            /* 路径加固：拒绝穿越 / 反斜杠 / 空字节 / 绝对路径 / 冒号 */
            if (p.isEmpty() || p.indexOf("..") >= 0 || p.indexOf('\\') >= 0 || p.indexOf('\0') >= 0
                    || p.startsWith("/") || p.indexOf(':') >= 0) return notFound();
            String ext = p.contains(".") ? p.substring(p.lastIndexOf('.') + 1).toLowerCase(Locale.US) : "";
            String mime;
            if (ext.isEmpty()) { p = p + "/index.html"; mime = "text/html"; }
            else mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            String enc = (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("svg")) ? "utf-8" : null;

            /* 内置 assets（全部内容随 APK 分发） */
            InputStream in = getAssets().open("site/" + p);
            return new WebResourceResponse(mime, enc, 200, "OK", respHeaders(mime), in);
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

    @Override protected void onDestroy() {
        try { if (web != null) { web.stopLoading(); web.destroy(); } } catch (Exception e) {}
        super.onDestroy();
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
