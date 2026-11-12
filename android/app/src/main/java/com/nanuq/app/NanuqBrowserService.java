// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.MediaDescription;
import android.media.browse.MediaBrowser;
import android.os.Bundle;
import android.os.Process;
import android.service.media.MediaBrowserService;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * «Reanudar» en los controles del sistema. Android quita del panel los controles de una app que lleva un rato en pausa
 * (unos 10 minutos) salvo que la app ofrezca reanudar: entonces deja una tarjeta con la última canción y, al tocar ▶,
 * le pide a esta app que vuelva a sonar (aunque esté cerrada). El sistema pregunta aquí con la pista EXTRA_RECENT; se
 * responde con la última canción (ver Resume) y la sesión de Nanuq (MediaCenter), cuyo ▶ arranca la página sin pantalla
 * si hace falta (Page.resumeHeadless).
 *
 * Solo responde a apps del sistema (la interfaz de Android): otra app instalada no puede preguntar qué escuchaste.
 * No se ofrece una biblioteca para navegar (Android Auto, etc.): solo la última canción.
 */
public class NanuqBrowserService extends MediaBrowserService {
    private static final String ROOT = "nanuq-recent";

    @Override
    public void onCreate() {
        super.onCreate();
        setSessionToken(MediaCenter.get(this).session.getSessionToken());
    }

    @Override
    public BrowserRoot onGetRoot(String pkg, int uid, Bundle hints) {
        if (hints == null || !hints.getBoolean(BrowserRoot.EXTRA_RECENT) || !fromSystem(pkg, uid)) return null;
        return Resume.load(this) == null ? null : new BrowserRoot(ROOT, null);
    }

    @Override
    public void onLoadChildren(String parentId, Result<List<MediaBrowser.MediaItem>> result) {
        Resume r = ROOT.equals(parentId) ? Resume.load(this) : null;
        if (r == null) { result.sendResult(Collections.emptyList()); return; }
        MediaDescription d = new MediaDescription.Builder()
                .setMediaId("nanuq-last")
                .setTitle(r.title)
                .setSubtitle(r.artist)
                .setDescription(r.album)
                .setIconBitmap(r.art(this))
                .build();
        List<MediaBrowser.MediaItem> list = new ArrayList<>();
        list.add(new MediaBrowser.MediaItem(d, MediaBrowser.MediaItem.FLAG_PLAYABLE));
        result.sendResult(list);
    }

    /** ¿Lo pide el sistema? (o esta misma app). Cualquier otra app instalada, no. */
    private boolean fromSystem(String pkg, int uid) {
        if (uid == Process.SYSTEM_UID || uid == Process.myUid()) return true;
        try {
            PackageManager pm = getPackageManager();
            String[] pkgs = pm.getPackagesForUid(uid);
            boolean owns = false;
            if (pkgs != null) for (String p : pkgs) if (p.equals(pkg)) { owns = true; break; }
            if (!owns) return false; // el paquete que dice ser no es el de quien llama
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return (ai.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0;
        } catch (Exception e) { return false; }
    }
}
