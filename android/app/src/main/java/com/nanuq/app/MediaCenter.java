// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Refleja en Android lo que la página publica en navigator.mediaSession: una MediaSession
 * del sistema (pantalla de bloqueo, audífonos Bluetooth, Android Auto/relojes) y la
 * notificación de reproducción. Mientras suena, PlaybackService mantiene viva la app.
 */
final class MediaCenter {
    interface Dispatcher { void dispatch(String action, double arg); }

    static final String CHANNEL = "playback";
    static final int NOTIFICATION_ID = 1;

    private static MediaCenter instance;

    static synchronized MediaCenter get(Context c) {
        if (instance == null) instance = new MediaCenter(c.getApplicationContext());
        return instance;
    }

    final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final NotificationManager nm;
    final MediaSession session;
    private volatile Dispatcher dispatcher; // la página (MainActivity); null si no hay WebView vivo

    private String title = "", artist = "", album = "", artUrl = "";
    private Bitmap art;
    private String state = "none";
    private double duration, position, rate = 1;
    private long positionAt = SystemClock.elapsedRealtime();
    private Set<String> actions = new HashSet<>();
    private boolean noisyRegistered;

    private MediaCenter(Context app) {
        this.app = app;
        nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, app.getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW);
            ch.setDescription(app.getString(R.string.channel_desc));
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        session = new MediaSession(app, "Nanuq");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { dispatch("play", Double.NaN); }
            @Override public void onPause() { dispatch("pause", Double.NaN); }
            @Override public void onStop() { dispatch("pause", Double.NaN); }
            @Override public void onSkipToNext() { dispatch("nexttrack", Double.NaN); }
            @Override public void onSkipToPrevious() { dispatch("previoustrack", Double.NaN); }
            @Override public void onSeekTo(long ms) { dispatch("seekto", ms / 1000.0); }
            @Override public void onFastForward() { dispatch("seekforward", 10); }
            @Override public void onRewind() { dispatch("seekbackward", 10); }
        }, main);
        session.setSessionActivity(contentIntent());
        // Con la app cerrada, el sistema manda los botones multimedia (▶ de los audífonos) a MediaButtonReceiver.
        android.content.ComponentName mbr = new android.content.ComponentName(app, MediaButtonReceiver.class);
        if (Build.VERSION.SDK_INT >= 33) session.setMediaButtonBroadcastReceiver(mbr);
        else { //noinspection deprecation
            session.setMediaButtonReceiver(PendingIntent.getBroadcast(app, 0, new Intent(Intent.ACTION_MEDIA_BUTTON).setComponent(mbr), PendingIntent.FLAG_IMMUTABLE)); }
        publishState();
    }

    void attach(Dispatcher d) { main.post(() -> dispatcher = d); }

    void detach(Dispatcher d) { main.post(() -> { if (dispatcher == d) dispatcher = null; }); }

    /** ¿Hay una página que reciba las órdenes? (Si el proceso murió y se recreó solo el servicio, no.) */
    boolean hasPage() { return dispatcher != null; }

    /** Sin página no suena nada: se quitan la notificación y el servicio para que no queden «zombis». */
    void stopIfNoPage() {
        main.post(() -> {
            if (dispatcher != null) return;
            state = "none";
            publishState();
            refresh();
        });
    }

    void dispatch(String action, double arg) {
        Dispatcher d = dispatcher;
        if (d != null) d.dispatch(action, arg);
        // ▶ con Nanuq cerrado (tarjeta de «reanudar» de Android o una notificación que quedó): la página arranca sin
        // pantalla y sigue tu cola (ver Page.resumeHeadless).
        else if ("play".equals(action)) Page.get(app).resumeHeadless();
    }

    /**
     * Mientras la página arranca sin pantalla para reanudar: el servicio pasa a primer plano YA (Android solo lo permite
     * justo después de tocar los controles) con la última canción a la vista, en pausa.
     */
    void holdForResume() {
        main.post(() -> {
            Resume r = Resume.load(app);
            if (r != null && title.isEmpty()) { title = r.title; artist = r.artist; album = r.album; art = r.art(app); publishMetadata(); }
            if ("none".equals(state)) state = "paused";
            publishState();
            try {
                Intent i = new Intent(app, PlaybackService.class);
                if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(i); else app.startService(i);
            } catch (Exception ignored) { } // Android no lo dejó: la música igual arranca y se reintenta al sonar
            refresh();
        });
    }

    // ---- Llamadas desde la página (llegan en el hilo del puente JS) ----

    void setMetadata(String t, String a, String al, String url) {
        main.post(() -> {
            title = t == null ? "" : t;
            artist = a == null ? "" : a;
            album = al == null ? "" : al;
            String u = url == null ? "" : url;
            if (!title.isEmpty()) Resume.save(app, title, artist, album);
            else Resume.clear(app); // sin canción (cerraste sesión, vaciaste la cola): nada que reanudar
            if (!u.equals(artUrl)) {
                artUrl = u;
                art = null;
                if (!u.isEmpty()) io.execute(() -> {
                    Bitmap b = loadBitmap(u);
                    if (b != null) Resume.saveArt(app, b);
                    main.post(() -> {
                        if (b != null && u.equals(artUrl)) { art = b; publishMetadata(); refresh(); }
                    });
                });
            }
            publishMetadata();
            refresh();
        });
    }

    void setPlaybackState(String s) {
        main.post(() -> {
            String next = "playing".equals(s) || "paused".equals(s) ? s : "none";
            if ("playing".equals(next)) Page.get(app).played(); // retomada sin pantalla: ya sonó, no se apaga sola
            position = currentPosition();
            positionAt = SystemClock.elapsedRealtime();
            state = next;
            publishState();
            refresh();
        });
    }

    void setActions(String csv) {
        main.post(() -> {
            actions = new HashSet<>(Arrays.asList(csv == null ? new String[0] : csv.split(",")));
            publishState();
            refresh();
        });
    }

    void setPosition(double dur, double pos, double r) {
        main.post(() -> {
            boolean durChanged = Math.abs(dur - duration) > 0.5;
            duration = dur;
            position = pos;
            rate = r <= 0 ? 1 : r;
            positionAt = SystemClock.elapsedRealtime();
            if (durChanged) publishMetadata();
            publishState();
        });
    }

    // ---- Estado del sistema ----

    boolean isPlaying() { return "playing".equals(state); }

    private double currentPosition() {
        if (!isPlaying()) return position;
        return position + (SystemClock.elapsedRealtime() - positionAt) / 1000.0 * rate;
    }

    private void publishMetadata() {
        MediaMetadata.Builder b = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album);
        if (duration > 0) b.putLong(MediaMetadata.METADATA_KEY_DURATION, (long) (duration * 1000));
        if (art != null) b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(b.build());
    }

    private void publishState() {
        long mask = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
        if (actions.contains("nexttrack")) mask |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (actions.contains("previoustrack")) mask |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        if (actions.contains("seekto")) mask |= PlaybackState.ACTION_SEEK_TO;
        if (actions.contains("seekforward")) mask |= PlaybackState.ACTION_FAST_FORWARD;
        if (actions.contains("seekbackward")) mask |= PlaybackState.ACTION_REWIND;
        int st = isPlaying() ? PlaybackState.STATE_PLAYING : "paused".equals(state) ? PlaybackState.STATE_PAUSED : PlaybackState.STATE_NONE;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(mask)
                .setState(st, (long) (Math.max(0, position) * 1000), isPlaying() ? (float) rate : 0f, positionAt)
                .build());
        session.setActive(!"none".equals(state));
    }


    /** Ajusta servicio, notificación y bloqueos según el estado actual. */
    private void refresh() {
        PlaybackService svc = PlaybackService.current;
        if ("none".equals(state)) {
            setNoisyReceiver(false);
            if (svc != null) svc.release(true);
            nm.cancel(NOTIFICATION_ID);
            return;
        }
        if (isPlaying()) {
            setNoisyReceiver(true);
            if (svc == null) {
                try {
                    Intent i = new Intent(app, PlaybackService.class);
                    if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(i); else app.startService(i);
                    return; // el servicio publica la notificación al arrancar
                } catch (Exception e) {
                    // Android 12+ puede negarse a arrancar el servicio desde segundo plano; se sigue con una notificación normal.
                }
            } else svc.setLocks(true);
        } else {
            setNoisyReceiver(false);
            // En pausa el servicio sigue en primer plano (sin bloqueos de CPU ni Wi-Fi: no gasta batería). Antes se soltaba a
            // los 10 min y, en el mismo segundo, la interfaz de Samsung quitaba los controles del panel (visto con logcat el
            // 2026-11-12). Se suelta si deslizas la notificación (ACTION_DISMISS) o al cerrar la app.
            if (svc != null) svc.setLocks(false);
        }
        nm.notify(NOTIFICATION_ID, buildNotification());
    }

    /** Detiene todo: se llama cuando la app se cierra de verdad. */
    void shutdown() {
        main.post(() -> {
            state = "none";
            dispatcher = null;
            publishState();
            refresh();
        });
    }

    // ---- Notificación ----

    Notification buildNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(app, CHANNEL) : new Notification.Builder(app);
        List<Integer> compact = new ArrayList<>();
        int n = 0;
        if (actions.contains("previoustrack")) { b.addAction(action(R.drawable.ic_prev, R.string.prev, PlaybackService.ACTION_PREV)); compact.add(n++); }
        if (isPlaying()) b.addAction(action(R.drawable.ic_pause, R.string.pause, PlaybackService.ACTION_PAUSE));
        else b.addAction(action(R.drawable.ic_play, R.string.play, PlaybackService.ACTION_PLAY));
        compact.add(n++);
        if (actions.contains("nexttrack")) { b.addAction(action(R.drawable.ic_next, R.string.next, PlaybackService.ACTION_NEXT)); compact.add(n++); }
        int[] idx = new int[compact.size()];
        for (int i = 0; i < idx.length; i++) idx[i] = compact.get(i);

        b.setSmallIcon(R.drawable.ic_stat_nanuq)
                .setColor(0xFF3CC0F5)
                .setContentTitle(title.isEmpty() ? app.getString(R.string.app_name) : title)
                .setContentText(artist)
                .setSubText(album.isEmpty() ? null : album)
                .setLargeIcon(art)
                .setContentIntent(contentIntent())
                .setDeleteIntent(serviceIntent(PlaybackService.ACTION_DISMISS)) // la deslizaste (en pausa): se suelta el servicio
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .setOngoing(isPlaying())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(idx));
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private Notification.Action action(int icon, int label, String act) {
        return new Notification.Action.Builder(Icon.createWithResource(app, icon), app.getString(label), serviceIntent(act)).build();
    }

    private PendingIntent serviceIntent(String act) {
        Intent i = new Intent(app, PlaybackService.class).setAction(act);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        int code = act.hashCode();
        if (Build.VERSION.SDK_INT >= 26) return PendingIntent.getForegroundService(app, code, i, flags);
        return PendingIntent.getService(app, code, i, flags);
    }

    private PendingIntent contentIntent() {
        Intent i = new Intent(app, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(app, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ---- Audífonos desconectados: pausar ----

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) dispatch("pause", Double.NaN);
        }
    };

    private void setNoisyReceiver(boolean on) {
        if (on == noisyRegistered) return;
        noisyRegistered = on;
        if (on) {
            IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(noisy, f, Context.RECEIVER_NOT_EXPORTED);
            else app.registerReceiver(noisy, f);
        } else {
            try { app.unregisterReceiver(noisy); } catch (IllegalArgumentException ignored) { }
        }
    }

    // ---- Carátulas ----

    private Bitmap loadBitmap(String url) {
        try {
            Uri u = Uri.parse(url);
            InputStream in;
            HttpURLConnection con = null;
            boolean asset = Page.HOST.equals(u.getHost()) && u.getPath() != null && !u.getPath().contains("..");
            boolean local = "127.0.0.1".equals(u.getHost()) && "http".equals(u.getScheme()); // carátula descargada (LocalServer)
            if (!asset && !local && !Downloads.okUrl(url, true)) return null; // solo carátulas de Jellyfin
            if (asset) {
                in = app.getAssets().open("www" + u.getPath());
            } else {
                con = (HttpURLConnection) new URL(url).openConnection();
                con.setInstanceFollowRedirects(false);
                con.setConnectTimeout(8000);
                con.setReadTimeout(10000);
                if (con.getResponseCode() != 200) { con.disconnect(); return null; }
                in = con.getInputStream();
            }
            // Seguridad de memoria: como mucho 8 MB, y primero se miden las dimensiones para decodificar ya reducida
            // (una imagen pequeña en bytes pero enorme en píxeles agotaría la memoria y cerraría la app).
            byte[] data;
            try { data = readCapped(in, 8 * 1024 * 1024); } finally { in.close(); if (con != null) con.disconnect(); }
            if (data == null) return null;
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, o);
            if (o.outWidth <= 0 || o.outHeight <= 0 || (long) o.outWidth * o.outHeight > 100_000_000L) return null;
            int sample = 1;
            while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= 640) sample *= 2;
            BitmapFactory.Options d = new BitmapFactory.Options();
            d.inSampleSize = sample;
            Bitmap b = BitmapFactory.decodeByteArray(data, 0, data.length, d);
            if (b == null) return null;
            int max = Math.max(b.getWidth(), b.getHeight());
            if (max > 640) {
                float k = 640f / max;
                b = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true);
            }
            return b;
        } catch (Exception | OutOfMemoryError e) {
            return null;
        }
    }

    /** Lee todo el flujo, o null si pasa de max bytes. */
    private static byte[] readCapped(InputStream in, int max) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int r;
        while ((r = in.read(buf)) != -1) { out.write(buf, 0, r); if (out.size() > max) return null; }
        return out.toByteArray();
    }
}
