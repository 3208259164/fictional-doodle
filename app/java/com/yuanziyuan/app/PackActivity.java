package com.yuanziyuan.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 内容包「无桥」承载页（0.18.48 / A7）。
 *
 * 为什么单独开一个 Activity：
 *   addJavascriptInterface 注入的对象对 WebView 里**每一个 frame** 都可见，
 *   任何 frame 都能拿到对象名并调用方法，而 app 侧没有任何 API 能判断调用者是谁
 *   （Android 官方 javadoc 原话）。所以「用 sandbox iframe 关掉 allow-same-origin」
 *   并不能阻止内容包调用原生桥 —— 桥是注入到 iframe 自己的 window 上的。
 *
 * 这个 Activity 的做法：
 *   · 不调用 addJavascriptInterface：包里没有任何原生能力可调；
 *   · 用 loadDataWithBaseURL("https://yzpack.local/") 给它一个独立 origin，
 *     读不到主站点（appassets.androidplatform.net）的 localStorage / 收藏 / 笔记；
 *   · 文件访问、content 访问全部关闭；跳出本域一律交给系统浏览器；
 *   · 存档：这个 origin 下的 localStorage 是持久的，退出时用 evaluateJavascript
 *     读出来回传给主页面写回原来的 yzq_* 键（内容包列表里的进度显示不受影响）。
 *
 * 失败时不影响主界面：任何异常都只 toast + finish，主页面还有 iframe 降级路径。
 */
public class PackActivity extends Activity {

    /** 回传存档给主页面用（主页面 onCreate 里设置） */
    public interface Sink { void onPackSave(String packId, String saveJson); }

    private static Sink sink;

    public static void setSink(Sink s) { sink = s; }

    private WebView web;
    private String packId = "";
    private boolean finished = false;

    /** 读出本包的全部 yzq_* 存档（JSON 字符串） */
    private static final String SAVE_JS =
        "(function(){try{var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);" +
        "if(k&&k.indexOf('yzq_')===0)o[k]=localStorage.getItem(k);}return JSON.stringify(o);}catch(e){return '{}';}})()";

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        String html = "";
        try {
            Intent it = getIntent();
            String payload = it == null ? null : it.getStringExtra("pack");
            if (payload == null || payload.length() == 0) { toast("内容包数据为空"); finish(); return; }
            org.json.JSONObject o = new org.json.JSONObject(payload);
            packId = o.optString("id", "");
            html = o.optString("html", "");
            String title = o.optString("title", "内容包");
            setTitle(title);
        } catch (Throwable t) {
            toast("内容包无法解析");
            finish();
            return;
        }

        try {
            Window w = getWindow();
            w.setStatusBarColor(Color.parseColor("#141210"));
            w.setNavigationBarColor(Color.parseColor("#141210"));
        } catch (Throwable ignored) {}

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#141210"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#141210"));
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);          /* 内容是脚本游戏，必须开 JS */
        s.setDomStorageEnabled(true);          /* 存档走这个 origin 的 localStorage */
        s.setDatabaseEnabled(false);
        /* 与主站同样的硬化：不给文件/content 访问，也不允许多窗口 */
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSavePassword(false);
        s.setSaveFormData(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        try { s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); } catch (Throwable ignored) {}

        /* 关键：这里一行 addJavascriptInterface 都没有 —— 包里没有任何原生桥。 */

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return handleUrl(r.getUrl() == null ? null : r.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return handleUrl(url);
            }
        });

        /* 顶部「退出」：包自己没有桥，不能自己关掉，必须由原生给一个出口 */
        TextView exit = new TextView(this);
        exit.setText("‹ 退出");
        exit.setTextColor(Color.parseColor("#F5C518"));
        exit.setTextSize(15);
        exit.setPadding(dp(16), dp(10), dp(16), dp(10));
        exit.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { close(); }
        });
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        root.addView(exit, lp);

        setContentView(root);

        try {
            web.loadDataWithBaseURL("https://yzpack.local/", html, "text/html", "UTF-8", null);
        } catch (Throwable t) {
            toast("内容包加载失败");
            finish();
        }
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    /** 只允许包内（同域）导航；其它 http(s) 交给系统浏览器，危险 scheme 一律拦掉 */
    private boolean handleUrl(String url) {
        if (url == null) return false;
        String low = url.toLowerCase(java.util.Locale.US);
        if (low.startsWith("https://yzpack.local/") || low.startsWith("about:") || low.startsWith("data:") || low.startsWith("blob:")) {
            return false;   /* 包内自己的请求：正常放行 */
        }
        if (low.startsWith("http://") || low.startsWith("https://")) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Throwable ignored) {}
            return true;
        }
        return true;        /* file: / intent: / javascript: 等：静默拦掉 */
    }

    /** 读存档 → 回传 → 关闭 */
    private void close() {
        if (finished) return;
        finished = true;
        try {
            web.evaluateJavascript(SAVE_JS, new android.webkit.ValueCallback<String>() {
                @Override public void onReceiveValue(String value) {
                    deliver(value);
                    finish();
                }
            });
            /* 兜底：万一 evaluateJavascript 回调不来，也不能卡住 */
            web.postDelayed(new Runnable() { public void run() { finish(); } }, 800);
        } catch (Throwable t) {
            finish();
        }
    }

    private void deliver(String rawJsonLiteral) {
        try {
            if (rawJsonLiteral == null || rawJsonLiteral.equals("null")) return;
            Object v = new org.json.JSONTokener(rawJsonLiteral).nextValue();
            String json = (v instanceof String) ? (String) v : String.valueOf(v);
            if (json.length() == 0) return;
            Sink k = sink;
            if (k != null) k.onPackSave(packId, json);
        } catch (Throwable ignored) {}
    }

    @Override public void onBackPressed() { close(); }

    @Override protected void onPause() {
        super.onPause();
        try { if (web != null) web.onPause(); } catch (Throwable ignored) {}
    }

    @Override protected void onResume() {
        super.onResume();
        try { if (web != null) web.onResume(); } catch (Throwable ignored) {}
    }

    @Override protected void onDestroy() {
        /* 进程被系统回收前也尽量把存档带回去 */
        try {
            if (!finished) {
                finished = true;
                web.evaluateJavascript(SAVE_JS, new android.webkit.ValueCallback<String>() {
                    @Override public void onReceiveValue(String value) { deliver(value); }
                });
            }
        } catch (Throwable ignored) {}
        try { if (web != null) { web.destroy(); web = null; } } catch (Throwable ignored) {}
        super.onDestroy();
    }

    private void toast(String s) {
        try { Toast.makeText(this, s, Toast.LENGTH_SHORT).show(); } catch (Throwable ignored) {}
    }
}
