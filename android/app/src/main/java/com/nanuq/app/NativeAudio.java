// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * La música de Nanuq en Android, con el reproductor del sistema (MediaPlayer) y su propio foco de audio.
 *
 * Antes sonaba dentro del WebView, y el foco lo manejaba Chromium: al abrir un video en otra app (aunque estuviera en
 * silencio) pausaba de golpe y no volvía; con la pantalla apagada, además, pausaba el audio que arrancaba a volumen 0.
 * Aquí Nanuq decide:
 * - Pérdida pasajera (una notificación, la navegación, una llamada): baja con desvanecido y vuelve sola al recuperarlo.
 * - Pérdida «para siempre» (otra app empieza un video o su música): baja con desvanecido y se pausa; si en los 5 minutos
 *   siguientes ya no suena nada en el teléfono (el video terminó o lo cerraste), vuelve a sonar sola (se puede apagar
 *   en Ajustes). Mientras tanto, si tocas cualquier control, manda lo que tú hagas.
 * - «Puedes bajar el volumen» (avisos cortos): desde Android 8 el sistema baja el volumen solo.
 *
 * La página (web/app.js) no cambia su forma de reproducir: android-bridge.js le da un objeto que se comporta como un
 * <audio> y habla con esta clase por NanuqAndroid.au*(); los avisos vuelven por window.__nanuqAudio(id, gen, evento, …).
 * Cada cambio de canción lleva un número (gen): un aviso de la canción anterior que llegue tarde se ignora.
 * Todo corre en el hilo principal. Solo direcciones http(s) (las mismas que ya podía pedir la página).
 */
final class NativeAudio implements AudioManager.OnAudioFocusChangeListener {
    interface Sink { void emit(String js); }

    private static NativeAudio instance;

    static synchronized NativeAudio get(Context c) {
        if (instance == null) instance = new NativeAudio(c.getApplicationContext());
        return instance;
    }

    private static final int MAX_PLAYERS = 8;
    private static final long DECLICK_IN_MS = 60, DECLICK_OUT_MS = 80, FADE_MS = 600, RESUME_WINDOW_MS = 5 * 60 * 1000, RESUME_CHECK_MS = 2000, RELEASE_FOCUS_MS = 2500;

    private static final class Pl {
        final int id;
        MediaPlayer mp;
        String url = "";
        int gen;
        boolean prepared, want, started, seeking;
        float vol = 1f;
        boolean muted;
        double pendingSeek = -1;
        float dk = 1f;   // «anti-chasquido»: sube de 0 al empezar y baja a 0 antes de pausar (ver deClick)
        int dkRun;
        Pl(int id) { this.id = id; }
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioManager am;
    private final Map<Integer, Pl> players = new LinkedHashMap<>();
    private int nextId = 1;
    private volatile Sink sink;

    private boolean hasFocus;
    private AudioFocusRequest focusReq;
    private float fmul = 1f, duck = 1f;        // desvanecido por el foco y «bajar el volumen» (Android 7)
    private int fadeRun;
    private final Set<Integer> lostIds = new HashSet<>(); // las que sonaban cuando se perdió el foco
    private boolean lostForGood;
    private long lostAt;
    private int quiet;
    private boolean autoResume = true;

    private NativeAudio(Context app) {
        this.app = app;
        am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
    }

    void setSink(Sink s) { sink = s; }

    /** Esa pantalla se cierra: solo si sigue siendo la dueña (otra MainActivity pudo tomar su lugar) se para la música. */
    void detach(Sink s) { if (sink == s) { sink = null; releaseAll(); } }

    // ---- Llamadas desde la página (hilo del puente JS): todo se pasa al hilo principal ----

    int create() {
        synchronized (this) {
            if (players.size() >= MAX_PLAYERS) return 0;
            int id = nextId++;
            players.put(id, new Pl(id));
            return id;
        }
    }

    void src(int id, int gen, String url) { main.post(() -> doSrc(id, gen, url)); }
    void play(int id) { main.post(() -> doPlay(id)); }
    void pause(int id) { main.post(() -> doPause(id)); }
    void seek(int id, double sec) { main.post(() -> doSeek(id, sec)); }
    void volume(int id, double v, boolean muted) { main.post(() -> { Pl p = pl(id); if (p == null) return; p.vol = (float) Math.max(0, Math.min(1, v)); p.muted = muted; apply(p); }); }
    void release(int id) { main.post(() -> { Pl p; synchronized (this) { p = players.remove(id); } if (p != null) stopSoft(p); maybeReleaseFocus(); }); }
    void configure(boolean resume) { main.post(() -> { autoResume = resume; if (!resume) forgetLoss(); }); }

    /** La página se va (se recarga o se cierra el WebView): sin página no suena nada. */
    void releaseAll() {
        // La lista se vacía YA (los ids que la página pida después son de la página nueva); los reproductores se paran
        // en el hilo principal.
        final List<Pl> all;
        synchronized (this) { all = new ArrayList<>(players.values()); players.clear(); }
        main.post(() -> {
            for (Pl p : all) stop(p);
            forgetLoss();
            abandonFocus();
        });
    }

    private synchronized Pl pl(int id) { return players.get(id); }

    // ---- Reproductor ----

    private void doSrc(int id, int gen, String url) {
        Pl p = pl(id); if (p == null) return;
        stopSoft(p); // la que sonaba baja en 80 ms y se suelta (cortarla a media onda chasqueaba, ver stopSoft)
        p.gen = gen; p.url = url == null ? "" : url; p.pendingSeek = -1;
        if (p.want) forgetLoss(); // cambiaste de canción: ya no se retoma lo de antes
        p.want = false;
        if (p.url.isEmpty()) { maybeReleaseFocus(); return; }
        String low = p.url.toLowerCase(Locale.ROOT);
        if (!low.startsWith("http://") && !low.startsWith("https://")) { emit(p, "error", 0, -1, 4); return; }
        MediaPlayer mp = new MediaPlayer();
        p.mp = mp;
        final int g = gen;
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            mp.setWakeMode(app, PowerManager.PARTIAL_WAKE_LOCK);
            mp.setOnPreparedListener(m -> { if (cur(p, m, g)) onPrepared(p); });
            mp.setOnCompletionListener(m -> { if (!cur(p, m, g)) return; p.started = false; p.want = false; emit(p, "ended", pos(p), dur(p), 0); maybeReleaseFocus(); });
            mp.setOnSeekCompleteListener(m -> { if (!cur(p, m, g)) return; p.seeking = false; emit(p, "seeked", pos(p), dur(p), 0); });
            mp.setOnInfoListener((m, what, extra) -> {
                if (!cur(p, m, g)) return false;
                if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) emit(p, "waiting", pos(p), dur(p), 0);
                else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END && p.started) emit(p, "playing", pos(p), dur(p), 0);
                return false;
            });
            mp.setOnErrorListener((m, what, extra) -> {
                if (!cur(p, m, g)) return true;
                // MediaError: 2 = red, 3 = no se pudo decodificar, 4 = formato no admitido
                int code = extra == MediaPlayer.MEDIA_ERROR_IO || extra == MediaPlayer.MEDIA_ERROR_TIMED_OUT ? 2
                        : extra == MediaPlayer.MEDIA_ERROR_UNSUPPORTED || extra == MediaPlayer.MEDIA_ERROR_MALFORMED ? 4 : 3;
                stop(p); p.want = false;
                emit(p, "error", 0, -1, code);
                maybeReleaseFocus();
                return true;
            });
            mp.setDataSource(p.url);
            mp.prepareAsync();
        } catch (Exception e) {
            stop(p);
            emit(p, "error", 0, -1, 4);
        }
    }

    private static boolean cur(Pl p, MediaPlayer m, int g) { return p.mp == m && p.gen == g; }

    private void onPrepared(Pl p) {
        p.prepared = true;
        apply(p);
        if (p.pendingSeek >= 0) { seekNow(p, p.pendingSeek); p.pendingSeek = -1; }
        emit(p, "meta", pos(p), dur(p), 0);
        if (p.want) startNow(p);
    }

    private void doPlay(int id) {
        Pl p = pl(id); if (p == null || p.mp == null) return;
        forgetLoss(); // tocaste ▶: manda lo que hagas tú
        if (!requestFocus()) { p.want = false; emit(p, "denied", pos(p), dur(p), 0); return; }
        cancelFade(); fmul = 1f; applyAll();
        p.want = true;
        if (p.prepared) startNow(p);
    }

    private void startNow(Pl p) {
        p.dk = 0f; apply(p); // empieza en silencio y sube en 60 ms: sin el golpe del primer instante
        try { p.mp.start(); } catch (IllegalStateException e) { p.dk = 1f; apply(p); return; }
        p.started = true;
        deClick(p, 1f, DECLICK_IN_MS, null);
        emit(p, "playing", pos(p), dur(p), 0);
        tick();
    }

    private void doPause(int id) {
        Pl p = pl(id); if (p == null) return;
        forgetLoss();
        p.want = false;
        if (p.mp != null && p.started) {
            final MediaPlayer mp = p.mp;
            // Baja en 60 ms y luego pausa (si en ese rato se vuelve a pedir ▶, deClick lo cancela).
            deClick(p, 0f, DECLICK_IN_MS, () -> { if (p.mp == mp && !p.want) { try { mp.pause(); } catch (IllegalStateException ignored) { } } });
        }
        p.started = false;
        maybeReleaseFocus();
    }

    private void doSeek(int id, double sec) {
        Pl p = pl(id); if (p == null || p.mp == null) return;
        if (!p.prepared) { p.pendingSeek = Math.max(0, sec); return; }
        seekNow(p, sec);
    }

    private void seekNow(Pl p, double sec) {
        p.seeking = true;
        long ms = (long) (Math.max(0, sec) * 1000);
        try {
            if (Build.VERSION.SDK_INT >= 26) p.mp.seekTo(ms, MediaPlayer.SEEK_CLOSEST);
            else p.mp.seekTo((int) ms);
        } catch (IllegalStateException e) { p.seeking = false; }
    }

    /**
     * Suelta el reproductor de una canción bajándolo a 0 en 80 ms. Muchos teléfonos reproducen MP3/AAC «descargados» al
     * procesador de audio (NuPlayerDecoderPassThrough en logcat): cortarlo de golpe a media onda dejaba un chasquido o un
     * pedacito distorsionado al saltar de canción. El reproductor viejo ya no pertenece a la canción (p.mp = null): la
     * nueva se prepara mientras tanto.
     */
    private void stopSoft(Pl p) {
        final MediaPlayer mp = p.mp;
        if (mp == null || !p.started) { stop(p); return; }
        final float v0 = p.muted ? 0f : p.vol * fmul * duck * p.dk;
        p.mp = null; p.prepared = false; p.started = false; p.seeking = false; p.dkRun++;
        ramp(v0, 0f, DECLICK_OUT_MS, v -> { try { mp.setVolume(v, v); } catch (Exception ignored) { } }, () -> true, () -> {
            try { mp.pause(); } catch (Exception ignored) { }
            try { mp.reset(); } catch (Exception ignored) { }
            try { mp.release(); } catch (Exception ignored) { }
        });
    }

    /** Lleva el «anti-chasquido» de la canción a «to» en ms y luego corre done. Uno nuevo cancela al anterior. */
    private void deClick(Pl p, float to, long ms, Runnable done) {
        final int run = ++p.dkRun;
        ramp(p.dk, to, ms, v -> { p.dk = v; apply(p); }, () -> run == p.dkRun && p.mp != null, done);
    }

    private interface FloatSet { void set(float v); }

    /**
     * Rampa de volumen en el hilo principal (no se frena con la pantalla apagada): cada 10 ms pone el valor que toca;
     * si «alive» deja de ser cierto (otra rampa la reemplazó), se detiene; al llegar, corre done.
     */
    private void ramp(float from, float to, long ms, FloatSet set, java.util.function.BooleanSupplier alive, Runnable done) {
        final long t0 = SystemClock.elapsedRealtime();
        main.post(new Runnable() {
            @Override public void run() {
                if (!alive.getAsBoolean()) return;
                float k = Math.min(1f, (SystemClock.elapsedRealtime() - t0) / (float) ms);
                set.set(from + (to - from) * k);
                if (k < 1f) main.postDelayed(this, 10);
                else if (done != null) done.run();
            }
        });
    }

    private void stop(Pl p) {
        MediaPlayer mp = p.mp;
        p.mp = null; p.prepared = false; p.started = false; p.seeking = false; p.dkRun++; p.dk = 1f;
        if (mp != null) { try { mp.reset(); } catch (Exception ignored) { } try { mp.release(); } catch (Exception ignored) { } }
    }

    private void apply(Pl p) {
        if (p.mp == null) return;
        float v = p.muted ? 0f : p.vol * fmul * duck * p.dk;
        try { p.mp.setVolume(v, v); } catch (IllegalStateException ignored) { }
    }

    private void applyAll() { for (Pl p : snapshot()) apply(p); }

    private synchronized List<Pl> snapshot() { return new ArrayList<>(players.values()); }

    private static double pos(Pl p) {
        if (p.mp == null || !p.prepared) return 0;
        try { return p.mp.getCurrentPosition() / 1000.0; } catch (IllegalStateException e) { return 0; }
    }

    /** Duración en segundos, o -1 si no se sabe (conversiones en vivo de Jellyfin: no se puede saltar dentro). */
    private static double dur(Pl p) {
        if (p.mp == null || !p.prepared) return -1;
        try { int d = p.mp.getDuration(); return d > 0 ? d / 1000.0 : -1; } catch (IllegalStateException e) { return -1; }
    }

    // Avance para la página, 4 veces por segundo mientras algo suena.
    private final Runnable ticker = this::tick;
    private void tick() {
        main.removeCallbacks(ticker);
        boolean any = false;
        for (Pl p : snapshot()) if (p.started && p.mp != null) { any = true; emit(p, "time", pos(p), dur(p), 0); }
        if (any) main.postDelayed(ticker, 250);
    }

    private void emit(Pl p, String ev, double pos, double dur, int x) {
        Sink s = sink; if (s == null) return;
        s.emit("window.__nanuqAudio&&window.__nanuqAudio(" + p.id + "," + p.gen + ",'" + ev + "'," + num(pos) + "," + num(dur) + "," + x + ")");
    }

    private static String num(double d) { return Double.isNaN(d) || Double.isInfinite(d) ? "-1" : String.format(Locale.ROOT, "%.3f", d); }

    // ---- Foco de audio ----

    private boolean requestFocus() {
        main.removeCallbacks(releaseFocus);
        if (hasFocus) return true;
        int r;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusReq == null) focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setWillPauseWhenDucked(false) // «bajar el volumen» lo hace el sistema
                    .setOnAudioFocusChangeListener(this, main)
                    .build();
            r = am.requestAudioFocus(focusReq);
        } else {
            //noinspection deprecation
            r = am.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        hasFocus = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        duck = 1f;
        return hasFocus;
    }

    private void abandonFocus() {
        main.removeCallbacks(releaseFocus);
        if (!hasFocus) return;
        hasFocus = false;
        if (Build.VERSION.SDK_INT >= 26) { if (focusReq != null) am.abandonAudioFocusRequest(focusReq); }
        else { //noinspection deprecation
            am.abandonAudioFocus(this); }
    }

    // Nada suena ni quiere sonar (pausaste, terminó la cola): el foco se suelta un poco después (entre canciones no).
    private final Runnable releaseFocus = () -> { if (!anyWanted() && lostIds.isEmpty()) abandonFocus(); };
    private void maybeReleaseFocus() { main.removeCallbacks(releaseFocus); if (!anyWanted()) main.postDelayed(releaseFocus, RELEASE_FOCUS_MS); }

    private boolean anyWanted() { for (Pl p : snapshot()) if (p.want) return true; return false; }

    @Override
    public void onAudioFocusChange(int change) {
        switch (change) {
            case AudioManager.AUDIOFOCUS_GAIN:
                hasFocus = true; duck = 1f; applyAll();
                if (!lostForGood && !lostIds.isEmpty()) resumeLost();
                break;
            case AudioManager.AUDIOFOCUS_LOSS:
                hasFocus = false;
                pauseForLoss(true);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                pauseForLoss(false);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK: // solo antes de Android 8 (después lo hace el sistema)
                duck = 0.2f; applyAll();
                break;
        }
    }

    /** Baja con desvanecido y pausa lo que sonaba; la página se entera («pause»). */
    private void pauseForLoss(boolean forGood) {
        List<Pl> playing = new ArrayList<>();
        for (Pl p : snapshot()) if (p.started && p.mp != null) playing.add(p);
        if (playing.isEmpty()) { if (forGood) abandonFocus(); return; }
        lostIds.clear();
        for (Pl p : playing) lostIds.add(p.id);
        lostForGood = forGood; lostAt = SystemClock.elapsedRealtime(); quiet = 0;
        fade(0f, () -> {
            for (Pl p : playing) {
                if (p.mp == null || !p.started) continue;
                try { p.mp.pause(); } catch (IllegalStateException ignored) { }
                p.started = false;
                emit(p, "paused", pos(p), dur(p), 0);
            }
            if (forGood) {
                abandonFocus(); // el sistema ya nos quitó de la lista; así queda limpio
                if (autoResume) main.postDelayed(resumeCheck, RESUME_CHECK_MS);
                else forgetLoss();
            }
        });
    }

    /** Vuelve a sonar lo que se pausó por el foco, subiendo con desvanecido. */
    private void resumeLost() {
        List<Pl> back = new ArrayList<>();
        for (int id : lostIds) { Pl p = pl(id); if (p != null && p.want && p.mp != null && p.prepared) back.add(p); }
        forgetLoss();
        if (back.isEmpty() || !requestFocus()) return;
        // Si el foco volvió mientras todavía bajaba, siguen sonando: solo vuelven a subir (el fade nuevo cancela la pausa).
        for (Pl p : back) if (!p.started) { if (fmul > 0f) { fmul = 0f; applyAll(); } startNow(p); }
        fade(1f, null);
    }

    // Tras perder el foco «para siempre»: cada 2 s se mira si en el teléfono ya no suena nada. Dos veces seguidas en
    // silencio (≈ 4 s) → vuelve a sonar. Solo durante 5 minutos.
    private final Runnable resumeCheck = new Runnable() {
        @Override public void run() {
            if (!lostForGood || lostIds.isEmpty()) return;
            if (SystemClock.elapsedRealtime() - lostAt > RESUME_WINDOW_MS) { forgetLoss(); return; }
            quiet = am.isMusicActive() ? 0 : quiet + 1;
            if (quiet >= 2) { lostForGood = false; resumeLost(); return; }
            main.postDelayed(this, RESUME_CHECK_MS);
        }
    };

    private void forgetLoss() {
        main.removeCallbacks(resumeCheck);
        lostIds.clear(); lostForGood = false; quiet = 0;
    }

    // ---- Desvanecido del foco (en el hilo principal: no se frena con la pantalla apagada) ----

    private void cancelFade() { fadeRun++; }

    private void fade(float to, Runnable done) {
        final int run = ++fadeRun;
        ramp(fmul, to, FADE_MS, v -> { fmul = v; applyAll(); }, () -> run == fadeRun, done);
    }
}
