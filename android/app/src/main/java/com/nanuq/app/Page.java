// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
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
 * La página de Nanuq (la PWA en un WebView) y todo lo que la conecta con Android: el puente window.NanuqAndroid, la
 * música (NativeAudio), los controles del sistema (MediaCenter), las descargas y el latido.
 *
 * Vive aparte de la pantalla (MainActivity) para que pueda arrancar SIN pantalla: si tocas ▶ en los controles del
 * sistema con Nanuq cerrado (la tarjeta de «reanudar» que deja Android, ver NanuqBrowserService, o una notificación
 * que quedó), la página carga en segundo plano y sigue tu cola donde iba. Al abrir Nanuq, la pantalla adopta esa misma
 * página (MutableContextWrapper: el WebView pasa del contexto de la app al de la pantalla) en vez de crear otra.
 * Los archivos se sirven desde los assets bajo http://localhost/: contexto seguro (localStorage, crypto.randomUUID) y,
 * al no ser https, el WebView deja conectar con servidores Jellyfin http:// de la red local.
 */
final class Page {
    static final String HOST = "localhost";
    static final String START_URL = "http://" + HOST + "/index.html";
    static final String NOTICE_CHANNEL = "requests";
    private static final AtomicInteger noticeId = new AtomicInteger(1000);
    /** Arrancada sin pantalla para reanudar: si en este tiempo no empezó a sonar (p. ej. sin sesión), se apaga. */
    private static final long HEADLESS_GIVE_UP_MS = 30000;

    private static Page instance;

    static synchronized Page get(Context c) {
        if (instance == null) instance = new Page(c.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final MediaCenter media;
    private final Downloads downloads;
    private final NativeAudio audio;
    private MutableContextWrapper ctx;
    private WebView web;
    private MainActivity activity; // la pantalla que la muestra (null: sin pantalla)

    private final NativeAudio.Sink audioSink = js -> main.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
    // Una sola referencia: MediaCenter solo suelta el despachador si sigue siendo este.
    private final MediaCenter.Dispatcher dispatcher = this::dispatchMedia;
    // Latido para la página: con la pantalla bloqueada el WebView frena sus temporizadores (~1 por minuto) y el WebSocket
    // de Jellyfin se cortaba (el teléfono dejaba de recibir órdenes de tus otros dispositivos). evaluateJavascript sí
    // corre a tiempo: cada 20 s la página manda su «sigo aquí» y, si hace falta, se reconecta.
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (web != null) web.evaluateJavascript("window.__nanuqTick&&window.__nanuqTick()", null);
            main.postDelayed(this, 20000);
        }
    };

    private Page(Context app) {
        this.app = app;
        media = MediaCenter.get(app);
        downloads = Downloads.get(app);
        audio = NativeAudio.get(app);
    }

    boolean alive() { return web != null; }

    /** La pantalla muestra la página: la que ya existe (arrancada sin pantalla) o una nueva. Hilo principal. */
    WebView attach(MainActivity a) {
        activity = a;
        if (web == null) create(a, START_URL);
        else {
            ctx.setBaseContext(a);
            if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
            main.removeCallbacks(giveUp);
            // Arrancó sin pantalla: el color de las barras que pidió entonces no se pudo poner; se vuelve a pedir.
            web.evaluateJavascript("(function(){var m=document.querySelector('meta[name=theme-color]');if(m&&window.NanuqAndroid)NanuqAndroid.setBarColor(m.content)})()", null);
        }
        return web;
    }

    /**
     * La pantalla se cierra. Si la cerraste tú (finishing) o no suena nada, la página se va con ella (como siempre: sin
     * página no suena nada). Si el sistema la cerró mientras suena, la página sigue sin pantalla.
     */
    void detach(MainActivity a, boolean finishing) {
        if (activity != a) return;
        activity = null;
        if (web != null && web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
        if (ctx != null) ctx.setBaseContext(app);
        if (finishing) { destroy(); media.shutdown(); }
        else if (!media.isPlaying()) { destroy(); media.stopIfNoPage(); }
    }

    /**
     * ▶ en los controles del sistema sin página (Nanuq cerrado): se arranca la página sin pantalla con «?resume=1», que
     * le dice que siga la cola en cuanto abra. El servicio de música pasa a primer plano YA (Android lo permite justo
     * después de un toque en los controles); si en 30 s no suena nada, se apaga todo.
     */
    void resumeHeadless() {
        main.post(() -> {
            if (web != null) { dispatchMedia("play", Double.NaN); return; }
            media.holdForResume();
            create(app, START_URL + "?resume=1");
            main.postDelayed(giveUp, HEADLESS_GIVE_UP_MS);
        });
    }

    private final Runnable giveUp = this::giveUpNow;
    /** Ya sonó: el plazo de 30 s deja de correr (si pausas después, la página y los controles se quedan). */
    void played() { main.post(() -> main.removeCallbacks(giveUp)); }
    private void giveUpNow() { if (activity == null && web != null && !media.isPlaying()) { destroy(); media.shutdown(); } }

    private void create(Context base, String url) {
        ctx = new MutableContextWrapper(base);
        web = new WebView(ctx);
        web.setBackgroundColor(0xFF081120);
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

        media.attach(dispatcher);
        downloads.setListener(ev -> main.post(() -> { if (web != null) web.evaluateJavascript("window.__nanuqDl&&window.__nanuqDl(" + ev + ")", null); }));
        audio.releaseAll(); // de una página anterior
        audio.setSink(audioSink);
        main.removeCallbacks(tick);
        main.postDelayed(tick, 20000);
        web.loadUrl(url);
    }

    private void destroy() {
        main.removeCallbacks(tick);
        main.removeCallbacks(giveUp);
        media.detach(dispatcher);
        downloads.setListener(null);
        audio.detach(audioSink); // sin página no hay quien controle la música
        WebView w = web; web = null;
        if (w != null) { try { w.removeJavascriptInterface("NanuqAndroid"); w.destroy(); } catch (Exception ignored) { } }
    }

    /**
     * El sistema cerró el proceso del WebView (poca memoria, sobre todo con la app en segundo plano) o se cayó. Sin esto,
     * Android cierra toda la app. Se arma un WebView nuevo y la página arranca otra vez (recupera la cola y la sesión
     * del almacén cifrado); los controles del sistema quedan en pausa hasta que la página vuelva a publicar.
     */
    private void recreate(WebView dead) {
        if (dead != web) return;
        MainActivity a = activity;
        destroy();
        media.setPlaybackState("paused");
        create(a != null ? a : app, START_URL);
        if (a != null) a.show(web);
    }

    /** Envía una acción de la MediaSession (notificación, audífonos, reloj…) a la página. */
    private void dispatchMedia(String action, double arg) {
        main.post(() -> {
            if (web == null) return;
            String js = "window.__nanuqMedia&&window.__nanuqMedia('" + action + "'," + (Double.isNaN(arg) ? "null" : String.valueOf(arg)) + ")";
            web.evaluateJavascript(js, null);
        });
    }

    void eval(String js) { if (web != null) web.evaluateJavascript(js, null); }
    void eval(String js, android.webkit.ValueCallback<String> cb) { if (web != null) web.evaluateJavascript(js, cb); else cb.onReceiveValue(null); }

    /** Abre algo fuera de la app (navegador, compartir). Sin pantalla, como tarea nueva. */
    private void startOutside(Intent i) {
        MainActivity a = activity;
        try { if (a != null) a.startActivity(i); else app.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (ActivityNotFoundException | SecurityException ignored) { }
    }

    /** Aviso del sistema (p. ej. «la canción que pediste ya se descargó»). Al tocarlo se abre la app. */
    private void showNotice(String title, String text) {
        NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(NOTICE_CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(NOTICE_CHANNEL, app.getString(R.string.notice_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription(app.getString(R.string.notice_channel_desc));
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(app, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(app, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        @SuppressWarnings("deprecation")
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(app, NOTICE_CHANNEL) : new Notification.Builder(app);
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
            main.post(() -> { MainActivity a = activity; if (a != null) a.setBarColor(c); });
        }

        // La música, con el reproductor del sistema y su propio foco de audio (ver NativeAudio y android-bridge.js).
        @JavascriptInterface public int auNew() { return audio.create(); }
        @JavascriptInterface public void auSrc(int id, int gen, String url) { audio.src(id, gen, url); }
        @JavascriptInterface public void auPlay(int id) { audio.play(id); }
        @JavascriptInterface public void auPause(int id) { audio.pause(id); }
        @JavascriptInterface public void auSeek(int id, double sec) { audio.seek(id, sec); }
        @JavascriptInterface public void auVol(int id, double v, boolean muted) { audio.volume(id, v, muted); }
        @JavascriptInterface public void auRelease(int id) { audio.release(id); }
        @JavascriptInterface public void auReset() { audio.releaseAll(); }
        @JavascriptInterface public void auConfig(boolean resume) { audio.configure(resume); }

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
        @JavascriptInterface public void pfSet(String json) { Prefetch.get(app).set(json); }
        @JavascriptInterface public boolean pfReady(String id) { return Prefetch.get(app).ready(id); }
        @JavascriptInterface public void pfBroken(String id) { Prefetch.get(app).broken(id); }

        // Petición HTTP sin las restricciones de CORS del WebView: responde con window.__nanuqHttp(id, estado, texto).
        @JavascriptInterface public void http(String id, String method, String url, String body) {
            new Thread(() -> {
                NativeHttp.Result r = NativeHttp.fetch(method, url, body);
                String js = "window.__nanuqHttp&&window.__nanuqHttp(" + JSONObject.quote(id) + "," + r.status + "," + JSONObject.quote(r.text) + ")";
                main.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
            }, "nanuq-http").start();
        }
        // Almacén cifrado de los datos personales (ver SecureStore y SEC en index.html). Síncrono, como localStorage.
        @JavascriptInterface public String secKind() { return SecureStore.get(app).kind(); }
        @JavascriptInterface public String secGet(String k) { return SecureStore.get(app).get(k); }
        @JavascriptInterface public boolean secSet(String k, String v) { return SecureStore.get(app).set(k, v); }
        @JavascriptInterface public void secDel(String k) { SecureStore.get(app).del(k); }
        // «Empezar de cero» cuando los datos cifrados ya no se pueden abrir (la página pide confirmación antes).
        @JavascriptInterface public String secReset() { return SecureStore.get(app).reset(); }

        // ---- Guardar el video de «Tu año con Nanuq» (llega en trozos base64 desde la página) ----
        // Solo MP4 o WebM, como mucho 300 MB; el nombre del archivo lo pone la app; se guarda en Películas/Nanuq.
        @JavascriptInterface public String videoBegin(String mime) {
            if (!"video/mp4".equals(mime) && !"video/webm".equals(mime)) return "";
            synchronized (videos) {
                for (File f : videos.values()) f.delete();
                videos.clear(); videoMime.clear();
                String id = Long.toHexString(new java.security.SecureRandom().nextLong() & Long.MAX_VALUE);
                File f = new File(app.getCacheDir(), "nanuq-video-" + id + ".part");
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
                    android.content.ContentResolver cr = app.getContentResolver();
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
                File dir = app.getExternalFilesDir(android.os.Environment.DIRECTORY_MOVIES);
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
            main.post(() -> {
                Intent send = new Intent(Intent.ACTION_SEND).setType("video/*").putExtra(Intent.EXTRA_STREAM, Uri.parse(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startOutside(Intent.createChooser(send, app.getString(R.string.share)));
            });
        }

        @JavascriptInterface public void notice(String title, String text) { main.post(() -> showNotice(title, text)); }

        // Buscar fiestas de Nanuq en la red local (una computadora con la sala abierta): responde con window.__nanuqParties(lista).
        @JavascriptInterface public void partyDiscover() {
            new Thread(() -> {
                String json = Discovery.find("Who is NanuqParty?", 47865, 2500);
                main.post(() -> { if (web != null) web.evaluateJavascript("window.__nanuqParties&&window.__nanuqParties(" + json + ")", null); });
            }, "nanuq-party-discovery").start();
        }

        // Buscar servidores Jellyfin en la red local (UDP): responde llamando a window.__nanuqDiscovered(lista).
        @JavascriptInterface public void discover() {
            new Thread(() -> {
                String json = Discovery.find(3000);
                main.post(() -> { if (web != null) web.evaluateJavascript("window.__nanuqDiscovered&&window.__nanuqDiscovered(" + json + ")", null); });
            }, "nanuq-discovery").start();
        }
    }

    private final class Client extends WebViewClient {
        // Arrancada sin pantalla (resumeHeadless): nadie llama a onStop, así que se le dice aquí que no está a la vista
        // (sin rampas de volumen ni transición del DJ, que dependen de temporizadores que sin pantalla van frenados).
        @Override
        public void onPageFinished(WebView view, String url) {
            if (activity == null && view == web) view.evaluateJavascript("window.__nanuqVis&&window.__nanuqVis(false)", null);
        }

        @Override
        @android.annotation.TargetApi(26) // Android 7 no lo llama (allí el WebView suele vivir en el proceso de la app)
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            main.post(() -> recreate(view));
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
                    InputStream in = app.getAssets().open("www" + path);
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
            startOutside(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
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
