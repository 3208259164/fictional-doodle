# 学通 App · R8 混淆规则
-dontwarn **
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, MethodParameters

# 清单里以 .MainActivity / .App / .ExportProvider 引用，必须保留类名
-keep class com.yuanziyuan.app.MainActivity { *; }
-keep class com.yuanziyuan.app.MainActivity$* { *; }
-keep class com.yuanziyuan.app.App { *; }
# 导出文件的 content:// 出口（Manifest <provider android:name=".ExportProvider"> 按名引用）
-keep class com.yuanziyuan.app.ExportProvider { *; }

# 内容包/升级逻辑（被主类引用；保留以防条件分支被误裁）

# JS 桥：被 @JavascriptInterface 标注的方法必须保留（否则网页调用失效）
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
