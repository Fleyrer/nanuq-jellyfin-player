// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lo que sigue en la cola, guardado por adelantado: la página manda (pfSet) las canciones que vienen hasta cubrir los
 * minutos elegidos en Ajustes, y aquí se bajan de una en una a una carpeta de caché. Al llegar su turno, la canción suena
 * desde el teléfono (servidor local, ver LocalServer «p/»): si la red se pone lenta o se corta un momento, no se nota.
 *
 * No son descargas: viven en getCacheDir()/prefetch (el sistema puede vaciarla), se borran al abrir la app y en cuanto
 * una canción sale de la ventana, y no cuentan para el máximo de Descargas. Mismas reglas de seguridad que Downloads:
 * solo direcciones de audio de Jellyfin (okUrl), redirecciones solo al mismo servidor, tope por archivo, en total y de
 * espacio libre.
 */
final class Prefetch {
    private static Prefetch instance;

    static synchronized Prefetch get(Context c) {
        if (instance == null) instance = new Prefetch(c.getApplicationContext());
        return instance;
    }

    private static final long MAX_FILE = 400L * 1024 * 1024, MAX_TOTAL = 1024L * 1024 * 1024, KEEP_FREE = 300L * 1024 * 1024;
    private static final int MAX_ITEMS = 40, MAX_TRIES = 3;

    private static final class Item {
        String id, url, mime = "audio/mpeg", state = "pending"; // pending | downloading | done | error | skipped (tope total)
        long size;
        int tries;
        volatile boolean cancelled;
    }

    private final File dir;
    private final ConnectivityManager cm;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final LinkedHashMap<String, Item> items = new LinkedHashMap<>(); // en el orden de la cola
    private boolean running;

    private Prefetch(Context app) {
        dir = new File(app.getCacheDir(), "prefetch");
        File[] old = dir.listFiles(); // de la vez anterior: la cola pudo cambiar, se empieza de cero
        if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
            f.delete();
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
        try {
            cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { kick(); } // volvió la red: sigue con lo pendiente
            });
        } catch (RuntimeException ignored) { }
    }

    /**
     * La ventana que quiere la página: [{id, url, keep}] en orden. keep = la que suena: se conserva si ya está guardada
     * (puede estar sonando desde aquí), pero no se baja (ya se está transmitiendo). Lo que no está en la lista se borra.
     */
    synchronized void set(String json) {
        List<JSONObject> want = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            for (int i = 0; i < a.length() && want.size() < MAX_ITEMS; i++) {
                JSONObject o = a.getJSONObject(i);
                String id = o.optString("id"), url = o.optString("url");
                if (id.matches("[A-Za-z0-9-]{1,64}") && Downloads.okUrl(url, false)) want.add(o);
            }
        } catch (Exception e) { return; }
        Set<String> ids = new HashSet<>();
        for (JSONObject o : want) ids.add(o.optString("id"));
        for (Item it : new ArrayList<>(items.values())) if (!ids.contains(it.id)) drop(it);
        LinkedHashMap<String, Item> next = new LinkedHashMap<>();
        for (JSONObject o : want) {
            String id = o.optString("id");
            Item it = items.get(id);
            if (it == null) {
                if (o.optBoolean("keep")) continue;
                it = new Item(); it.id = id; it.url = o.optString("url");
            } else if (("error".equals(it.state) && it.tries < MAX_TRIES) || "skipped".equals(it.state)) { it.state = "pending"; it.url = o.optString("url"); }
            next.put(id, it);
        }
        items.clear();
        items.putAll(next);
        kickLocked();
    }

    /** La canción guardada no se pudo reproducir: se borra y no se vuelve a bajar en esta sesión. */
    synchronized void broken(String id) {
        Item it = items.get(id);
        if (it == null) return;
        it.cancelled = true; it.state = "error"; it.tries = MAX_TRIES;
        deleteFiles(id);
    }

    synchronized boolean ready(String id) { return file(id) != null; }

    synchronized File file(String id) {
        Item it = id == null ? null : items.get(id);
        if (it == null || !"done".equals(it.state)) return null;
        File f = new File(dir, it.id + ".audio");
        return f.isFile() ? f : null;
    }

    synchronized String mime(String id) {
        Item it = id == null ? null : items.get(id);
        return it == null ? "audio/mpeg" : it.mime;
    }

    private void drop(Item it) { it.cancelled = true; items.remove(it.id); deleteFiles(it.id); }

    private void deleteFiles(String id) {
        //noinspection ResultOfMethodCallIgnored
        new File(dir, id + ".audio").delete();
        //noinspection ResultOfMethodCallIgnored
        new File(dir, id + ".part").delete();
    }

    private synchronized void kick() { kickLocked(); }

    private void kickLocked() {
        if (running) return;
        running = true;
        worker.execute(this::loop);
    }

    private void loop() {
        while (true) {
            Item it = null;
            synchronized (this) {
                long total = 0;
                for (Item x : items.values()) { if ("done".equals(x.state)) total += x.size; else if (it == null && "pending".equals(x.state)) it = x; }
                if (it == null || total >= MAX_TOTAL || !online()) { running = false; return; }
                it.state = "downloading";
            }
            fetch(it);
        }
    }

    private boolean online() {
        Network n = cm.getActiveNetwork();
        NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void fetch(Item it) {
        File part = new File(dir, it.id + ".part"), out = new File(dir, it.id + ".audio");
        HttpURLConnection con = null;
        boolean ok = false;
        String mime = null;
        long n = 0;
        try {
            con = Downloads.openSameHost(it.url, 15000, 30000);
            if (con.getResponseCode() != 200) throw new IOException("El servidor respondió " + con.getResponseCode());
            long len = con.getContentLengthLong();
            if (len > MAX_FILE) throw new IOException("Demasiado grande");
            if (dir.getUsableSpace() < Math.max(len, 0) + KEEP_FREE) throw new IOException("Sin espacio");
            String ct = con.getContentType();
            mime = OggCheck.mime(ct, null);
            try (InputStream in = con.getInputStream(); OutputStream os = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) != -1) {
                    if (it.cancelled) break;
                    os.write(buf, 0, r);
                    n += r;
                    if (n > MAX_FILE) throw new IOException("Demasiado grande");
                }
            }
            ok = !it.cancelled && n > 0 && (len <= 0 || n >= len) && OggCheck.valid(part, len); // Opus: páginas completas y sin cambios
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
        synchronized (this) {
            if (it.cancelled || items.get(it.id) != it) { //noinspection ResultOfMethodCallIgnored
                part.delete(); return; }
            if (ok && part.renameTo(out)) {
                it.state = "done"; it.size = n;
                if (mime != null) it.mime = mime;
                trim();
            } else {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                it.state = "error"; it.tries++;
            }
        }
    }

    /** Tope total: si se pasa, se sueltan las más lejanas de la cola (quedan apartadas y se vuelven a pedir cuando la cola avanza). */
    private void trim() {
        long total = 0;
        for (Item x : items.values()) if ("done".equals(x.state)) total += x.size;
        List<Item> l = new ArrayList<>(items.values());
        for (int i = l.size() - 1; i >= 0 && total > MAX_TOTAL; i--) {
            Item x = l.get(i);
            if (!"done".equals(x.state)) continue;
            total -= x.size; x.state = "skipped"; deleteFiles(x.id);
        }
    }
}
