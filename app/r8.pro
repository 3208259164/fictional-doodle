# 学通 · R8 保留规则
# 1) JS 桥：方法名由网页侧字符串调用（addJavascriptInterface），一旦被改名/裁剪即失效
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
# 2) 壳与桥的公开类全部保留（只有 8 个类，收益不值得冒风险）
-keep class com.yuanziyuan.app.** { *; }
# 3) 反射用到的 Android 组件入口
-keep class * extends android.app.Application { *; }
-keep class * extends android.app.Activity { *; }
-keep class * extends android.content.ContentProvider { *; }
-keep class * implements android.os.Parcelable { *; }
