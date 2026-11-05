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
# 4) ★ 必须保留注解（0.18.25 血泪）
#    Android 判断「哪些方法允许网页调用」只看 @JavascriptInterface 注解本身。
#    手工调 R8（不走 Gradle）时，注解会被当成无用信息裁掉——
#    方法名保住了，网页却看到一个空对象：朗读、导入、导出、分享、返回键全部失效。
#    加这一行后 dex 里 58 个注解全部回来，包体积一个字节没变。
-keepattributes *Annotation*
