// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;

/**
 * La última canción que sonó, para la tarjeta de «reanudar» que Android deja en los controles cuando Nanuq lleva rato en
 * pausa o se cerró (ver NanuqBrowserService). Título, artista y álbum van en el almacén cifrado (SecureStore, clave
 * «native.resume»); la carátula, reducida, en el almacenamiento privado de la app. Se borra al cerrar sesión (la página
 * deja de publicar una canción).
 */
final class Resume {
    private static final String KEY = "native.resume", ART = "resume-art.png";
    final String title, artist, album;

    private Resume(String t, String a, String al) { title = t; artist = a; album = al; }

    private static String last = "";

    static synchronized void save(Context c, String t, String a, String al) {
        String sig = t + '\u0001' + a + '\u0001' + al;
        if (sig.equals(last)) return;
        last = sig;
        try { SecureStore.get(c).set(KEY, new JSONObject().put("t", t).put("a", a).put("al", al).toString()); } catch (Exception ignored) { }
    }

    static synchronized void clear(Context c) {
        if (last.isEmpty() && !new File(c.getFilesDir(), ART).exists()) return;
        last = "";
        SecureStore.get(c).del(KEY);
        //noinspection ResultOfMethodCallIgnored
        new File(c.getFilesDir(), ART).delete();
    }

    static void saveArt(Context c, Bitmap b) {
        File f = new File(c.getFilesDir(), ART), tmp = new File(c.getFilesDir(), ART + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { b.compress(Bitmap.CompressFormat.PNG, 100, o); }
        catch (Exception e) { //noinspection ResultOfMethodCallIgnored
            tmp.delete(); return; }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(f);
    }

    static Resume load(Context c) {
        String j = SecureStore.get(c).get(KEY);
        if (j == null) return null;
        try {
            JSONObject o = new JSONObject(j);
            String t = o.optString("t", "");
            return t.isEmpty() ? null : new Resume(t, o.optString("a", ""), o.optString("al", ""));
        } catch (Exception e) { return null; }
    }

    /** La carátula guardada (como mucho 640 px, la guardó MediaCenter), o null. */
    Bitmap art(Context c) {
        File f = new File(c.getFilesDir(), ART);
        if (!f.isFile() || f.length() > 8L * 1024 * 1024) return null;
        try { return BitmapFactory.decodeFile(f.getPath()); } catch (Exception | OutOfMemoryError e) { return null; }
    }
}
