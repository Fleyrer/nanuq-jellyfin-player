# Métodos expuestos a JavaScript con addJavascriptInterface.
-keepclassmembers class com.nanuq.app.Page$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
