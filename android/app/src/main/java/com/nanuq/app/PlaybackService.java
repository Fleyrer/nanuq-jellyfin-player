// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Servicio en primer plano mientras hay música: evita que Android congele o cierre la app
 * con la pantalla apagada y mantiene la CPU y el Wi-Fi despiertos para el streaming.
 * También recibe los botones de la notificación.
 */
public class PlaybackService extends Service {
    static final String ACTION_PLAY = "com.nanuq.app.PLAY";
    static final String ACTION_PAUSE = "com.nanuq.app.PAUSE";
    static final String ACTION_NEXT = "com.nanuq.app.NEXT";
    static final String ACTION_PREV = "com.nanuq.app.PREV";

    static volatile PlaybackService current;

    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    @Override
    public void onCreate() {
        super.onCreate();
        current = this;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nanuq:playback");
        wake.setReferenceCounted(false);
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            @SuppressWarnings("deprecation") int mode = WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifi = wm.createWifiLock(mode, "nanuq:stream");
            wifi.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MediaCenter media = MediaCenter.get(this);
        // Siempre hay que pasar a primer plano: el servicio se arranca con startForegroundService.
        if (Build.VERSION.SDK_INT >= 29) startForeground(MediaCenter.NOTIFICATION_ID, media.buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(MediaCenter.NOTIFICATION_ID, media.buildNotification());

        String a = intent == null ? null : intent.getAction();
        // Arranque en frío desde un botón de la notificación: el proceso había muerto y la notificación quedó a la vista.
        // Sin la página (el WebView) no hay música que tocar: se quita todo en vez de dejar un servicio vacío encendido.
        // (La página, cuando existe, arranca este servicio sin acción.)
        if (a != null && !media.hasPage()) { media.stopIfNoPage(); release(true); return START_NOT_STICKY; }
        if (ACTION_PLAY.equals(a)) media.dispatch("play", Double.NaN);
        else if (ACTION_PAUSE.equals(a)) media.dispatch("pause", Double.NaN);
        else if (ACTION_NEXT.equals(a)) media.dispatch("nexttrack", Double.NaN);
        else if (ACTION_PREV.equals(a)) media.dispatch("previoustrack", Double.NaN);
        setLocks(media.isPlaying());
        return START_NOT_STICKY;
    }

    void setLocks(boolean on) {
        if (on) {
            if (!wake.isHeld()) wake.acquire(6 * 60 * 60 * 1000L);
            if (wifi != null && !wifi.isHeld()) wifi.acquire();
        } else {
            if (wake.isHeld()) wake.release();
            if (wifi != null && wifi.isHeld()) wifi.release();
        }
    }

    /** Sale del primer plano y termina. Con removeNotification=false la notificación queda (descartable). */
    void release(boolean removeNotification) {
        setLocks(false);
        stopForeground(removeNotification ? STOP_FOREGROUND_REMOVE : STOP_FOREGROUND_DETACH);
        stopSelf();
        if (current == this) current = null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // La app se quitó de recientes: el WebView ya no existe, así que se cierra todo.
        MediaCenter.get(this).shutdown();
        release(true);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        setLocks(false);
        if (current == this) current = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
