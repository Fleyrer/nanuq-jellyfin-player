# Métodos expuestos a JavaScript con addJavascriptInterface.
-keepclassmembers class com.nanuq.app.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
