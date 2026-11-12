// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Canciones guardadas en el teléfono para escucharlas sin gastar datos.
 * Se descargan de una en una, por defecto solo con Wi-Fi (o cualquier red sin medición),
 * y se guardan en el almacenamiento privado de la app. La página las reproduce desde
 * el servidor local en 127.0.0.1 (ver LocalServer).
 *
 * Estados: pending (en cola), waiting (esperando una red permitida), downloading, done, error.
 */
final class Downloads {
    interface Listener { void onChange(JSONObject event); }

    private static Downloads instance;

    static synchronized Downloads get(Context c) {
        if (instance == null) instance = new Downloads(c.getApplicationContext());
        return instance;
    }

    private static final int MAX_TRIES = 3;

    private final File dir, indexFile, indexEnc;
    private final SecureStore sec;
    private LocalServer server;
    private final ConnectivityManager cm;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private volatile Listener listener;
    private boolean running;
    private int max = 100;
    // El índice cifrado existe pero el almacén aún no abre (arranque en frío): se lee cuando abra, antes de escribir nada.
    private boolean deferred;
    private boolean wifiOnly = true;

    private static final class Entry {
        String id, url, coverUrl = "", mime = "audio/mpeg", state = "pending", error = "";
        JSONObject track;
        boolean auto, hasCover;
        int score, tries;
        long added, size, bytes, total = -1;
        volatile boolean cancelled;
    }

    private Downloads(Context app) {
        dir = new File(app.getFilesDir(), "music");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        indexFile = new File(dir, "index.json");          // versiones anteriores (en claro): se migra y se borra
        indexEnc = new File(dir, "index.bin");             // índice cifrado (qué bajaste, cuánto lo escuchas, direcciones)
        sec = SecureStore.get(app);
        cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
        load();
        try {
            server = new LocalServer(new LocalServer.Files() {
                @Override public File audio(String id) { return file(id); }
                @Override public String audioMime(String id) { return mime(id); }
                @Override public File cover(String id) { return coverFile(id); }
                @Override public File prefetch(String id) { return Prefetch.get(app).file(id); }
                @Override public String prefetchMime(String id) { return Prefetch.get(app).mime(id); }
            });
        } catch (IOException ignored) { }
        cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { retryAndKick(); }
            @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { kick(); }
        });
        kick();
    }

    void setListener(Listener l) { listener = l; }

    // ---- API para la página ----

    synchronized void configure(int maxSongs, boolean onlyWifi) {
        ensureLoaded();
        max = Math.max(1, maxSongs);
        wifiOnly = onlyWifi;
        // Si bajó el máximo, se quitan descargas automáticas (nunca las que el usuario pidió).
        while (entries.size() > max) {
            Entry v = victim(Integer.MAX_VALUE);
            if (v == null) break;
            removeEntry(v);
        }
        save();
        for (Entry e : entries.values()) if ("waiting".equals(e.state)) e.state = "pending";
        kickLocked();
    }

    /** Dirección del servidor local (http://127.0.0.1:puerto/token/), o vacío si no arrancó. */
    String base() { return server == null ? "" : server.base(); }

    // ---- Seguridad: solo direcciones con la forma de Jellyfin ----
    // Lo descargado se le devuelve a la página por el servidor local: si alguien lograra ejecutar código en la página,
    // no debe poder usar las descargas para leer otros servicios de tu red. Audio: …/Audio/{id}/universal;
    // carátula: …/Items/{id}/Images/Primary (la dirección del servidor puede llevar una ruta antes, p. ej. /jellyfin).
    private static final long MAX_AUDIO = 1024L * 1024 * 1024, MAX_COVER = 15L * 1024 * 1024;
    private static final java.util.regex.Pattern AUDIO_PATH = java.util.regex.Pattern.compile("^(/[^?#]*)?/Audio/[A-Za-z0-9-]+/universal$");
    private static final java.util.regex.Pattern COVER_PATH = java.util.regex.Pattern.compile("^(/[^?#]*)?/Items/[A-Za-z0-9-]+/Images/Primary$");

    static boolean okUrl(String url, boolean cover) {
        if (url == null || url.isEmpty() || url.length() > 4096) return false;
        try {
            URL u = new URL(url);
            String sc = u.getProtocol();
            if (!"http".equals(sc) && !"https".equals(sc)) return false;
            if (u.getUserInfo() != null) return false;
            String path = u.getPath();
            if (path == null || path.contains("..")) return false;
            return (cover ? COVER_PATH : AUDIO_PATH).matcher(path).matches();
        } catch (Exception ex) { return false; }
    }

    /** Abre la conexión siguiendo redirecciones solo dentro del mismo servidor (máximo 3). */
    static HttpURLConnection openSameHost(String url, int connectMs, int readMs) throws IOException {
        URL u = new URL(url);
        for (int hop = 0; hop < 4; hop++) {
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(connectMs);
            c.setReadTimeout(readMs);
            c.setInstanceFollowRedirects(false);
            int code = c.getResponseCode();
            if (code < 300 || code > 399) return c;
            String loc = c.getHeaderField("Location");
            c.disconnect();
            if (loc == null) throw new IOException("Redirección sin destino");
            URL next = new URL(u, loc);
            if (!next.getProtocol().equals(u.getProtocol()) || !next.getHost().equalsIgnoreCase(u.getHost()) || next.getPort() != u.getPort())
                throw new IOException("El servidor redirigió a otro sitio");
            u = next;
        }
        throw new IOException("Demasiadas redirecciones");
    }

    /** @return ok | full (no cabe y no hay automáticas que reemplazar) | lower (automática con menos reproducciones que las guardadas) | bad (dirección o id no válidos) */
    synchronized String enqueue(String id, String url, String coverUrl, String trackJson, boolean auto, int score) {
        if (id == null || !id.matches("[A-Za-z0-9-]{1,64}") || !okUrl(url, false)) return "bad";
        if (!okUrl(coverUrl, true)) coverUrl = "";
        ensureLoaded();
        Entry e = entries.get(id);
        if (e != null) {
            // Entrada recuperada solo del archivo (sin nombre): se completan sus datos con los que manda la página.
            if (!e.track.has("name") && trackJson != null) { try { e.track = new JSONObject(trackJson); save(); emit(e); } catch (JSONException ignored) { } }
            if (!e.hasCover && coverUrl != null && !coverUrl.isEmpty()) { e.coverUrl = coverUrl; if ("done".equals(e.state)) fetchCoverLater(e); }
            if (!auto && e.auto) { e.auto = false; save(); emit(e); }
            e.score = Math.max(e.score, score);
            if ("error".equals(e.state)) { e.state = "pending"; e.tries = 0; e.url = url; save(); emit(e); kickLocked(); }
            return "ok";
        }
        if (entries.size() >= max) {
            Entry v = victim(auto ? score : Integer.MAX_VALUE);
            if (v == null) return auto ? "lower" : "full";
            removeEntry(v);
        }
        e = new Entry();
        e.id = id;
        e.url = url;
        e.coverUrl = coverUrl == null ? "" : coverUrl;
        e.auto = auto;
        e.score = score;
        e.added = System.currentTimeMillis();
        try { e.track = new JSONObject(trackJson); } catch (JSONException ex) { e.track = new JSONObject(); }
        entries.put(id, e);
        save();
        emit(e);
        kickLocked();
        return "ok";
    }

    synchronized void setScore(String id, int score) {
        ensureLoaded();
        Entry e = entries.get(id);
        if (e != null && score != e.score) { e.score = score; save(); }
    }

    synchronized void remove(String id) {
        ensureLoaded();
        Entry e = entries.get(id);
        if (e != null) { removeEntry(e); save(); }
    }

    synchronized void removeAll(boolean onlyAuto) {
        ensureLoaded();
        for (Entry e : new ArrayList<>(entries.values())) if (!onlyAuto || e.auto) removeEntry(e);
        save();
    }

    synchronized String list() {
        ensureLoaded();
        JSONArray a = new JSONArray();
        for (Entry e : entries.values()) a.put(toJson(e));
        return a.toString();
    }

    /** wifi | cellular | none: la red que se usaría ahora mismo. */
    String network() {
        NetworkCapabilities c = caps();
        if (c == null || !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return "none";
        if (c.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
            // Una VPN (Yggdrasil, Tailscale…) sigue «conectada» aunque debajo no haya Wi-Fi ni datos: se mira la red real.
            NetworkCapabilities u = underlying();
            if (u == null) return "none";
            return unmetered(u) ? "wifi" : "cellular";
        }
        return unmetered(c) ? "wifi" : "cellular";
    }

    /** Una red que no sea VPN y tenga internet (Wi-Fi, datos, Ethernet), o null si no hay ninguna. */
    @SuppressWarnings("deprecation")
    private NetworkCapabilities underlying() {
        for (Network n : cm.getAllNetworks()) {
            NetworkCapabilities x = cm.getNetworkCapabilities(n);
            if (x != null && !x.hasTransport(NetworkCapabilities.TRANSPORT_VPN) && x.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return x;
        }
        return null;
    }

    /** Archivo listo para reproducir, o null. */
    synchronized File file(String id) {
        ensureLoaded();
        Entry e = entries.get(id);
        if (e == null || !"done".equals(e.state)) return null;
        File f = new File(dir, safe(id) + ".audio");
        return f.isFile() ? f : null;
    }

    synchronized File coverFile(String id) {
        ensureLoaded();
        Entry e = entries.get(id);
        if (e == null || !e.hasCover) return null;
        File f = new File(dir, safe(id) + ".cover");
        return f.isFile() ? f : null;
    }

    /** Carátula para descargas hechas antes de que se guardaran las carátulas. */
    synchronized void setCover(String id, String coverUrl) {
        ensureLoaded();
        Entry e = entries.get(id);
        if (e == null || e.hasCover || !okUrl(coverUrl, true)) return;
        e.coverUrl = coverUrl;
        if ("done".equals(e.state)) fetchCoverLater(e);
    }

    private void fetchCoverLater(Entry e) { worker.execute(() -> fetchCover(e)); }

    /** Guarda la carátula junto a la canción para no pedirla al servidor (mejor esfuerzo). */
    private void fetchCover(Entry e) {
        String url;
        synchronized (this) { if (e.hasCover || !okUrl(e.coverUrl, true) || entries.get(e.id) != e) return; url = e.coverUrl; }
        File tmp = new File(dir, safe(e.id) + ".cover.part"), out = new File(dir, safe(e.id) + ".cover");
        HttpURLConnection con = null;
        try {
            con = openSameHost(url, 15000, 20000);
            if (con.getResponseCode() != 200) return;
            try (InputStream in = con.getInputStream(); OutputStream os = new FileOutputStream(tmp)) {
                byte[] buf = new byte[32 * 1024];
                int r; long n = 0;
                while ((r = in.read(buf)) != -1) { os.write(buf, 0, r); if ((n += r) > MAX_COVER) throw new IOException("Carátula demasiado grande"); }
            }
            synchronized (this) {
                if (entries.get(e.id) != e) { tmp.delete(); return; }
                if (out.exists()) out.delete();
                if (!tmp.renameTo(out)) return;
                e.hasCover = true;
                save();
                emit(e);
            }
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
            tmp.delete();
        }
    }

    synchronized String mime(String id) {
        ensureLoaded();
        Entry e = entries.get(id);
        return e == null ? "audio/mpeg" : e.mime;
    }

    // ---- Cola de descargas ----

    private void retryAndKick() {
        synchronized (this) {
            for (Entry e : entries.values()) if ("error".equals(e.state) && e.tries < MAX_TRIES) e.state = "pending";
        }
        kick();
    }

    private synchronized void kick() { kickLocked(); }

    private void kickLocked() {
        if (running) return;
        running = true;
        worker.execute(this::loop);
    }

    private void loop() {
        while (true) {
            Entry e;
            synchronized (this) {
                e = nextPending();
                if (e == null) { running = false; return; }
                if (!networkAllowed()) {
                    for (Entry x : entries.values()) if ("pending".equals(x.state)) { x.state = "waiting"; emit(x); }
                    running = false;
                    return;
                }
                e.state = "downloading";
                e.bytes = 0;
                e.total = -1;
                emit(e);
            }
            download(e);
        }
    }

    private Entry nextPending() {
        Entry best = null;
        for (Entry e : entries.values()) {
            if (!"pending".equals(e.state) && !"waiting".equals(e.state)) continue;
            // Primero las que pidió el usuario, luego las automáticas; dentro de cada grupo, por orden de llegada.
            if (best == null || (best.auto && !e.auto)) best = e;
        }
        return best;
    }

    private void download(Entry e) {
        File part = new File(dir, safe(e.id) + ".part"), out = new File(dir, safe(e.id) + ".audio");
        HttpURLConnection con = null;
        String fail = null;
        boolean paused = false;
        try {
            if (!okUrl(e.url, false)) throw new IOException("Dirección de descarga no válida");
            con = openSameHost(e.url, 15000, 30000);
            int code = con.getResponseCode();
            if (code == 401 || code == 403) throw new IOException("El servidor rechazó la descarga (" + code + "). Vuelve a iniciar sesión.");
            if (code != 200) throw new IOException("El servidor respondió " + code);
            String ct = con.getContentType();
            long len = con.getContentLengthLong();
            // Límites: una canción no pasa de 1 GB y debe quedar espacio libre (un servidor malicioso no puede llenar el teléfono).
            if (len > MAX_AUDIO) throw new IOException("El archivo es demasiado grande");
            if (dir.getUsableSpace() < Math.max(len, 0) + 200L * 1024 * 1024) throw new IOException("No hay espacio suficiente en el teléfono");
            synchronized (this) { e.total = len; e.mime = OggCheck.mime(ct, e.mime); }
            long lastEmit = 0, lastNetCheck = SystemClock.elapsedRealtime(), n = 0;
            try (InputStream in = con.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) != -1) {
                    if (e.cancelled) break;
                    os.write(buf, 0, r);
                    n += r;
                    if (n > MAX_AUDIO) throw new IOException("El archivo es demasiado grande");
                    long now = SystemClock.elapsedRealtime();
                    if (now - lastNetCheck > 2000) {
                        lastNetCheck = now;
                        // Si se perdió el Wi-Fi y solo se permite Wi-Fi, se pausa para no gastar datos.
                        if (!networkAllowed()) { paused = true; break; }
                    }
                    if (now - lastEmit > 700) {
                        lastEmit = now;
                        synchronized (this) { e.bytes = n; emit(e); }
                    }
                }
            }
            // Opus (Ogg): sin Content-Length, una descarga cortada o alterada solo se nota revisando sus páginas (fuera del candado:
            // leer el archivo tarda un poco).
            boolean ogg = paused || e.cancelled || OggCheck.valid(part, len);
            synchronized (this) {
                if (e.cancelled || entries.get(e.id) != e) { part.delete(); return; }
                if (paused) { part.delete(); e.state = "waiting"; emit(e); return; }
                if (len > 0 && n < len) throw new IOException("La descarga quedó incompleta");
                if (n == 0) throw new IOException("El servidor no envió audio");
                if (!ogg) throw new IOException("La descarga llegó incompleta o dañada");
                if (out.exists()) out.delete();
                if (!part.renameTo(out)) throw new IOException("No se pudo guardar el archivo");
                e.size = n;
                e.bytes = n;
                e.state = "done";
                e.error = "";
                save();
                emit(e);
            }
            fetchCover(e);
            return;
        } catch (Exception ex) {
            fail = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
        } finally {
            if (con != null) con.disconnect();
        }
        part.delete();
        synchronized (this) {
            if (e.cancelled || entries.get(e.id) != e) return;
            e.tries++;
            e.state = "error";
            e.error = fail;
            save();
            emit(e);
        }
    }

    // ---- Límite de canciones ----

    /** La descarga automática menos escuchada (y más antigua) con menos de {@code below} reproducciones. */
    private Entry victim(int below) {
        Entry v = null;
        for (Entry e : entries.values()) {
            if (!e.auto || e.score >= below) continue;
            if (v == null || e.score < v.score || (e.score == v.score && e.added < v.added)) v = e;
        }
        return v;
    }

    private void removeEntry(Entry e) {
        e.cancelled = true;
        entries.remove(e.id);
        new File(dir, safe(e.id) + ".audio").delete();
        new File(dir, safe(e.id) + ".part").delete();
        new File(dir, safe(e.id) + ".cover").delete();
        JSONObject ev = new JSONObject();
        try { ev.put("id", e.id); ev.put("state", "removed"); } catch (JSONException ignored) { }
        Listener l = listener;
        if (l != null) l.onChange(ev);
    }

    // ---- Red ----

    private NetworkCapabilities caps() {
        Network n = cm.getActiveNetwork();
        return n == null ? null : cm.getNetworkCapabilities(n);
    }

    private static boolean unmetered(NetworkCapabilities c) {
        return c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                || c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
    }

    private boolean networkAllowed() {
        NetworkCapabilities c = caps();
        if (c == null || !c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false;
        return !wifiOnly || unmetered(c);
    }

    // ---- Persistencia y eventos ----

    private static String safe(String id) { return id.replaceAll("[^A-Za-z0-9_-]", "_"); }

    private JSONObject toJson(Entry e) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", e.id);
            o.put("state", e.state);
            o.put("auto", e.auto);
            o.put("score", e.score);
            o.put("added", e.added);
            o.put("size", e.size);
            o.put("bytes", e.bytes);
            o.put("total", e.total);
            o.put("error", e.error);
            o.put("hasCover", e.hasCover);
            o.put("track", e.track);
        } catch (JSONException ignored) { }
        return o;
    }

    private void emit(Entry e) {
        Listener l = listener;
        if (l != null) l.onChange(toJson(e));
    }

    // Lo agregado mientras tanto (en memoria) se conserva y se guarda junto con lo leído.
    private void ensureLoaded() { if (deferred && sec.ready()) { deferred = false; load(); save(); } }

    private void load() {
        if (indexEnc.isFile() && !sec.ready()) { deferred = true; return; } // no tocar nada hasta poder leerlo
        boolean enc = indexEnc.isFile();
        if (!enc && !indexFile.isFile()) return;
        boolean readOk = false;
        try {
            byte[] b = enc ? sec.decrypt(SecureStore.readAll(indexEnc)) : SecureStore.readAll(indexFile);
            JSONArray a = new JSONArray(new String(b, StandardCharsets.UTF_8));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Entry e = new Entry();
                e.id = o.getString("id");
                e.url = o.optString("url");
                e.coverUrl = o.optString("coverUrl", "");
                e.hasCover = o.optBoolean("hasCover") && new File(dir, safe(e.id) + ".cover").isFile();
                e.mime = OggCheck.mime(o.optString("mime", null), "audio/mpeg");
                e.state = o.optString("state", "pending");
                e.auto = o.optBoolean("auto");
                e.score = o.optInt("score");
                e.tries = o.optInt("tries");
                e.added = o.optLong("added");
                e.size = o.optLong("size");
                e.bytes = e.size;
                e.error = o.optString("error");
                e.track = o.optJSONObject("track");
                if (e.track == null) e.track = new JSONObject();
                if ("done".equals(e.state) && !new File(dir, safe(e.id) + ".audio").isFile()) e.state = "pending";
                if ("downloading".equals(e.state) || "waiting".equals(e.state)) e.state = "pending";
                if ("error".equals(e.state) && e.tries < MAX_TRIES) e.state = "pending";
                if (!entries.containsKey(e.id)) entries.put(e.id, e); // lo que ya está en memoria es más nuevo
            }
            readOk = true;
        } catch (Exception ignored) { }
        File[] files = dir.listFiles();
        if (!readOk) {
            // El índice no se pudo leer (dañado, o cifrado con una clave que ya no existe): NO se borran las canciones.
            // Se recuperan desde los archivos (sin nombre: la página completa los datos al abrir la app).
            if (files != null) for (File f : files) {
                String n = f.getName();
                if (!n.endsWith(".audio")) continue;
                String id = n.substring(0, n.length() - 6);
                if (!id.matches("[A-Za-z0-9-]{1,64}") || entries.containsKey(id)) continue;
                Entry e = new Entry();
                e.id = id; e.state = "done"; e.auto = false; e.size = e.bytes = f.length(); e.added = f.lastModified();
                e.hasCover = new File(dir, id + ".cover").isFile();
                e.track = new JSONObject();
                try { e.track.put("id", id); } catch (JSONException ignored) { }
                entries.put(id, e);
            }
            if (sec.ready()) save();
            return;
        }
        // Archivos sueltos de descargas que ya no están en el índice.
        if (files != null) for (File f : files) {
            String n = f.getName();
            if (n.endsWith(".part")) f.delete();
            else if (n.endsWith(".audio") || n.endsWith(".cover")) {
                String base = n.substring(0, n.lastIndexOf('.'));
                boolean known = false;
                for (Entry e : entries.values()) if (safe(e.id).equals(base)) { known = true; break; }
                if (!known) f.delete();
            }
        }
        if (!enc && sec.ready() && indexFile.isFile()) { save(); } // migración: el índice en claro pasa a cifrado
    }

    private void save() {
        if (deferred) return; // todavía no se pudo leer el índice: escribir ahora lo pisaría con uno incompleto
        JSONArray a = new JSONArray();
        for (Entry e : entries.values()) {
            JSONObject o = toJson(e);
            try {
                o.put("url", e.url);
                o.put("coverUrl", e.coverUrl);
                o.put("mime", e.mime);
                o.put("tries", e.tries);
            } catch (JSONException ignored) { }
            a.put(o);
        }
        byte[] plain = a.toString().getBytes(StandardCharsets.UTF_8);
        if (sec.ready()) {
            try { SecureStore.writeAtomic(indexEnc, sec.encrypt(plain)); } catch (Exception ex) { return; }
            //noinspection ResultOfMethodCallIgnored
            indexFile.delete(); // ya no queda copia en claro
            return;
        }
        if ("locked".equals(sec.kind())) return; // hay datos cifrados que no se pueden abrir: no escribir nada en claro
        File tmp = new File(dir, "index.json.tmp");
        try (OutputStream os = new FileOutputStream(tmp)) {
            os.write(plain);
        } catch (IOException ex) { return; }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(indexFile);
    }
}
