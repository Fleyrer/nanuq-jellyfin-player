// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Muestra la PWA de Nanuq en un WebView. Los archivos se sirven desde los assets bajo
 * http://localhost/: es un contexto seguro (localStorage, crypto.randomUUID) y, al no ser
 * https, el WebView deja conectar con servidores Jellyfin http:// de la red local.
 */
public class MainActivity extends Activity {
    static final String HOST = "localhost";
    static final String START_URL = "http://" + HOST + "/index.html";
    static final String NOTICE_CHANNEL = "requests";
    private static final AtomicInteger noticeId = new AtomicInteger(1000);

    private WebView web;
    private MediaCenter media;
    private Downloads downloads;
    // Una sola referencia: MediaCenter solo suelta el despachador si sigue siendo este (otra MainActivity pudo tomarlo).
    private final MediaCenter.Dispatcher dispatcher = this::dispatchMedia;
    // Latido para la página: con la pantalla bloqueada el WebView frena sus temporizadores (~1 por minuto) y el WebSocket
    // de Jellyfin se cortaba (el teléfono dejaba de recibir órdenes de tus otros dispositivos). evaluateJavascript sí
    // corre a tiempo: cada 20 s la página manda su «sigo aquí» y, si hace falta, se reconecta.
    private final android.os.Handler ticker = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (web != null) web.evaluateJavascript("window.__nanuqTick&&window.__nanuqTick()", null);
            ticker.postDelayed(this, 20000);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        media = MediaCenter.get(this);

        createWeb();
        media.attach(dispatcher);
        downloads = Downloads.get(this);
        downloads.setListener(ev -> runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.__nanuqDl&&window.__nanuqDl(" + ev + ")", null);
        }));
        web.loadUrl(START_URL);
        ticker.postDelayed(tick, 20000);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    private void createWeb() {
        web = new WebView(this);
        web.setBackgroundColor(0xFF081120);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // la siguiente canción y la notificación arrancan solas
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " NanuqAndroid/" + BuildConfig.VERSION_NAME);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        web.addJavascriptInterface(new Bridge(), "NanuqAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient());
    }

    /**
     * El sistema cerró el proceso del WebView (poca memoria, sobre todo con la app en segundo plano) o se cayó. Sin esto,
     * Android cierra toda la app. Se arma un WebView nuevo y la página arranca otra vez (recupera la cola y la sesión
     * del almacén cifrado); los controles del sistema quedan en pausa hasta que la página vuelva a publicar.
     */
    private void recreateWeb(WebView dead) {
        if (dead != web) return;
        web = null;
        try { dead.removeJavascriptInterface("NanuqAndroid"); dead.destroy(); } catch (Exception ignored) { }
        media.setPlaybackState("paused");
        createWeb();
        web.loadUrl(START_URL);
    }

    /** Envía una acción de la MediaSession (notificación, audífonos, reloj…) a la página. */
    private void dispatchMedia(String action, double arg) {
        runOnUiThread(() -> {
            if (web == null) return;
            String js = "window.__nanuqMedia&&window.__nanuqMedia('" + action + "'," + (Double.isNaN(arg) ? "null" : String.valueOf(arg)) + ")";
            web.evaluateJavascript(js, null);
        });
    }

    /** Atrás cierra diálogos y vuelve entre pantallas; en la pantalla inicial deja la app sonando en segundo plano. */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("(function(){try{return typeof back==='function'&&back()?1:0}catch(e){return 0}})()", v -> {
            if (!"1".equals(v)) moveTaskToBack(true);
        });
    }

    // La página no siempre sabe que la app pasó a segundo plano: se le avisa para que busque dispositivos menos seguido.
    @Override
    protected void onStart() { super.onStart(); if (web != null) web.evaluateJavascript("window.__nanuqVis&&window.__nanuqVis(true)", null); }

    @Override
    protected void onStop() { if (web != null) web.evaluateJavascript("window.__nanuqVis&&window.__nanuqVis(false)", null); SecureStore.get(this).flush(); super.onStop(); }

    @Override
    protected void onDestroy() {
        ticker.removeCallbacks(tick);
        media.detach(dispatcher);
        downloads.setListener(null);
        if (isFinishing()) media.shutdown();
        else media.stopIfNoPage(); // el sistema cerró la pantalla: sin WebView no suena nada, que la notificación no diga lo contrario
        if (web != null) {
            web.removeJavascriptInterface("NanuqAndroid");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private void setBarColor(int color) {
        Window w = getWindow();
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        double lum = (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0;
        boolean light = lum > 0.6;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            View d = w.getDecorView();
            int f = d.getSystemUiVisibility();
            int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
            d.setSystemUiVisibility(light ? (f | mask) : (f & ~mask));
        }
    }

    /** Aviso del sistema (p. ej. «la canción que pediste ya se descargó»). Al tocarlo se abre la app. */
    private void showNotice(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(NOTICE_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(NOTICE_CHANNEL, getString(R.string.notice_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(getString(R.string.notice_channel_desc));
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        @SuppressWarnings("deprecation")
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, NOTICE_CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_nanuq)
                .setColor(0xFF3CC0F5)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(pi)
                .setAutoCancel(true);
        try { nm.notify(noticeId.incrementAndGet(), b.build()); } catch (SecurityException ignored) { } // sin permiso de notificaciones
    }

    /** Métodos que la página llama mediante window.NanuqAndroid (ver bridge/android-bridge.js). */
    private final Map<String, File> videos = new HashMap<>();
    private final Map<String, String> videoMime = new HashMap<>();
    private final java.util.Set<String> savedVideos = new java.util.HashSet<>();

    final class Bridge {
        @JavascriptInterface public void setMetadata(String title, String artist, String album, String artwork) { media.setMetadata(title, artist, album, artwork); }
        @JavascriptInterface public void setPlaybackState(String state) { media.setPlaybackState(state); }
        @JavascriptInterface public void setActions(String csv) { media.setActions(csv); }
        @JavascriptInterface public void setPosition(double duration, double position, double rate) { media.setPosition(duration, position, rate); }
        @JavascriptInterface public void setBarColor(String css) {
            int c;
            try { c = Color.parseColor(css.trim()); } catch (Exception e) { return; }
            runOnUiThread(() -> MainActivity.this.setBarColor(c));
        }

        // Descargas para escuchar sin datos (ver Downloads).
        @JavascriptInterface public String dlList() { return downloads.list(); }
        @JavascriptInterface public String dlEnqueue(String id, String url, String cover, String track, boolean auto, int score) { return downloads.enqueue(id, url, cover, track, auto, score); }
        @JavascriptInterface public void dlCover(String id, String cover) { downloads.setCover(id, cover); }
        @JavascriptInterface public String dlBase() { return downloads.base(); }
        @JavascriptInterface public void dlRemove(String id) { downloads.remove(id); }
        @JavascriptInterface public void dlRemoveAll(boolean onlyAuto) { downloads.removeAll(onlyAuto); }
        @JavascriptInterface public void dlConfig(int max, boolean wifiOnly) { downloads.configure(max, wifiOnly); }
        @JavascriptInterface public void dlScore(String id, int score) { downloads.setScore(id, score); }
        @JavascriptInterface public String dlNetwork() { return downloads.network(); }
        // Lo que sigue en la cola, guardado por adelantado (ver Prefetch): la ventana que quiere la página, si una ya está
        // lista para sonar desde el teléfono, y la que no se pudo reproducir.
        @JavascriptInterface public void pfSet(String json) { Prefetch.get(MainActivity.this).set(json); }
        @JavascriptInterface public boolean pfReady(String id) { return Prefetch.get(MainActivity.this).ready(id); }
        @JavascriptInterface public void pfBroken(String id) { Prefetch.get(MainActivity.this).broken(id); }

        // Petición HTTP sin las restricciones de CORS del WebView: responde con window.__nanuqHttp(id, estado, texto).
        @JavascriptInterface public void http(String id, String method, String url, String body) {
            new Thread(() -> {
                NativeHttp.Result r = NativeHttp.fetch(method, url, body);
                String js = "window.__nanuqHttp&&window.__nanuqHttp(" + JSONObject.quote(id) + "," + r.status + "," + JSONObject.quote(r.text) + ")";
                runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
            }, "nanuq-http").start();
        }
        // Almacén cifrado de los datos personales (ver SecureStore y SEC en index.html). Síncrono, como localStorage.
        @JavascriptInterface public String secKind() { return SecureStore.get(MainActivity.this).kind(); }
        @JavascriptInterface public String secGet(String k) { return SecureStore.get(MainActivity.this).get(k); }
        @JavascriptInterface public boolean secSet(String k, String v) { return SecureStore.get(MainActivity.this).set(k, v); }
        @JavascriptInterface public void secDel(String k) { SecureStore.get(MainActivity.this).del(k); }
        // «Empezar de cero» cuando los datos cifrados ya no se pueden abrir (la página pide confirmación antes).
        @JavascriptInterface public String secReset() { return SecureStore.get(MainActivity.this).reset(); }

        // ---- Guardar el video de «Tu año con Nanuq» (llega en trozos base64 desde la página) ----
        // Solo MP4 o WebM, como mucho 300 MB; el nombre del archivo lo pone la app; se guarda en Películas/Nanuq.
        @JavascriptInterface public String videoBegin(String mime) {
            if (!"video/mp4".equals(mime) && !"video/webm".equals(mime)) return "";
            synchronized (videos) {
                for (File f : videos.values()) f.delete();
                videos.clear(); videoMime.clear();
                String id = Long.toHexString(new java.security.SecureRandom().nextLong() & Long.MAX_VALUE);
                File f = new File(getCacheDir(), "nanuq-video-" + id + ".part");
                f.delete();
                videos.put(id, f); videoMime.put(id, mime);
                return id;
            }
        }
        @JavascriptInterface public boolean videoChunk(String id, String b64) {
            File f;
            synchronized (videos) { f = videos.get(id); }
            if (f == null || b64 == null || b64.length() > 2_000_000) return false;
            try {
                byte[] b = android.util.Base64.decode(b64, android.util.Base64.NO_WRAP);
                if (f.length() + b.length > 300L * 1024 * 1024) { f.delete(); synchronized (videos) { videos.remove(id); } return false; }
                try (java.io.FileOutputStream o = new java.io.FileOutputStream(f, true)) { o.write(b); }
                return true;
            } catch (Exception e) { return false; }
        }
        // tag: «semana-AAAA-MM-DD» para «Tu semana con Nanuq»; vacío para «Tu año». Solo letras, números y guiones.
        @JavascriptInterface public String videoEnd(String id, int year, String tag) {
            File f; String mime;
            synchronized (videos) { f = videos.remove(id); mime = videoMime.remove(id); }
            if (f == null || mime == null || !f.isFile()) return "";
            int y = (year >= 2000 && year <= 2100) ? year : java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);
            String t = tag == null ? "" : tag.replaceAll("[^A-Za-z0-9-]", "");
            if (t.length() > 40) t = t.substring(0, 40);
            String name = "Nanuq-" + (t.isEmpty() ? String.valueOf(y) : t) + "-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new java.util.Date()) + ("video/mp4".equals(mime) ? ".mp4" : ".webm");
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, name);
                    cv.put(android.provider.MediaStore.Video.Media.MIME_TYPE, mime);
                    cv.put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, android.os.Environment.DIRECTORY_MOVIES + "/Nanuq");
                    cv.put(android.provider.MediaStore.Video.Media.IS_PENDING, 1);
                    android.content.ContentResolver cr = getContentResolver();
                    Uri uri = cr.insert(android.provider.MediaStore.Video.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY), cv);
                    if (uri == null) return "";
                    try (InputStream in = new java.io.FileInputStream(f); java.io.OutputStream out = cr.openOutputStream(uri)) {
                        byte[] buf = new byte[64 * 1024]; int r;
                        while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
                    }
                    cv.clear(); cv.put(android.provider.MediaStore.Video.Media.IS_PENDING, 0);
                    cr.update(uri, cv, null, null);
                    synchronized (videos) { savedVideos.add(uri.toString()); }
                    return "ok:" + uri;
                }
                File dir = getExternalFilesDir(android.os.Environment.DIRECTORY_MOVIES);
                if (dir == null) return "";
                dir.mkdirs();
                File dst = new File(dir, name);
                try (InputStream in = new java.io.FileInputStream(f); java.io.OutputStream out = new java.io.FileOutputStream(dst)) {
                    byte[] buf = new byte[64 * 1024]; int r;
                    while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
                }
                return "file:" + dst.getAbsolutePath();
            } catch (Exception e) {
                return "";
            } finally {
                f.delete();
            }
        }
        @JavascriptInterface public void videoShare(String uri) {
            // Solo el video que Nanuq acaba de guardar (no cualquier archivo de la galería).
            synchronized (videos) { if (uri == null || !savedVideos.contains(uri)) return; }
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND).setType("video/*").putExtra(Intent.EXTRA_STREAM, Uri.parse(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivity(Intent.createChooser(send, "Compartir")); } catch (ActivityNotFoundException ignored) { }
            });
        }

        @JavascriptInterface public void notice(String title, String text) { runOnUiThread(() -> showNotice(title, text)); }

        // Buscar fiestas de Nanuq en la red local (una computadora con la sala abierta): responde con window.__nanuqParties(lista).
        @JavascriptInterface public void partyDiscover() {
            new Thread(() -> {
                String json = Discovery.find("Who is NanuqParty?", 47865, 2500);
                runOnUiThread(() -> { if (web != null) web.evaluateJavascript("window.__nanuqParties&&window.__nanuqParties(" + json + ")", null); });
            }, "nanuq-party-discovery").start();
        }

        // Buscar servidores Jellyfin en la red local (UDP): responde llamando a window.__nanuqDiscovered(lista).
        @JavascriptInterface public void discover() {
            new Thread(() -> {
                String json = Discovery.find(3000);
                runOnUiThread(() -> { if (web != null) web.evaluateJavascript("window.__nanuqDiscovered&&window.__nanuqDiscovered(" + json + ")", null); });
            }, "nanuq-discovery").start();
        }
    }

    private final class Client extends WebViewClient {
        @Override
        @android.annotation.TargetApi(26) // Android 7 no lo llama (allí el WebView suele vivir en el proceso de la app)
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            runOnUiThread(() -> recreateWeb(view));
            return true; // ya lo manejamos: la app no se cierra
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!"http".equals(u.getScheme()) || !HOST.equals(u.getHost())) return null; // Jellyfin, fuentes, etc.: red normal
            String path = u.getPath();
            if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            if (!path.contains("..") && path.indexOf('\0') < 0 && path.length() <= 512) {
                try {
                    InputStream in = getAssets().open("www" + path);
                    return new WebResourceResponse(mime(path), "utf-8", 200, "OK", headers, in);
                } catch (IOException | RuntimeException ignored) { } // una ruta rara no debe cerrar la app
            }
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if ("http".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
            // Solo enlaces web van al navegador: nada de intent:, file:, content:, javascript:… (podrían abrir otras apps o
            // archivos del teléfono si algo lograra navegar la página hacia ahí).
            String sc = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (!"http".equals(sc) && !"https".equals(sc)) return true;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)); } catch (ActivityNotFoundException ignored) { }
            return true; // los enlaces externos se abren en el navegador
        }
    }

    private static final Map<String, String> MIME;
    static {
        Map<String, String> m = new HashMap<>();
        m.put("html", "text/html"); m.put("js", "text/javascript"); m.put("css", "text/css");
        m.put("json", "application/json"); m.put("webmanifest", "application/manifest+json");
        m.put("png", "image/png"); m.put("svg", "image/svg+xml"); m.put("webp", "image/webp");
        m.put("jpg", "image/jpeg"); m.put("woff2", "font/woff2"); m.put("ico", "image/x-icon");
        MIME = Collections.unmodifiableMap(m);
    }

    private static String mime(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String t = MIME.get(ext);
        return t != null ? t : "application/octet-stream";
    }
}
