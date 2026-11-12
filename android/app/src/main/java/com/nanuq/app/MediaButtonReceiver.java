// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;

/**
 * Botones multimedia con Nanuq cerrado. Mientras la app vive, los botones (audífonos Bluetooth, controles del sistema)
 * llegan a su sesión (MediaCenter). Si Android la cerró, el sistema se los manda a la última app de música que dejó este
 * receptor: así ▶ despierta a Nanuq, que sigue tu cola sin abrir la pantalla (Page.resumeHeadless). Los demás botones,
 * con la app cerrada, no hacen nada.
 */
public class MediaButtonReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (!Intent.ACTION_MEDIA_BUTTON.equals(i.getAction())) return;
        KeyEvent k;
        if (android.os.Build.VERSION.SDK_INT >= 33) k = i.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent.class);
        else { //noinspection deprecation
            k = i.getParcelableExtra(Intent.EXTRA_KEY_EVENT); }
        if (k == null || k.getAction() != KeyEvent.ACTION_DOWN) return;
        int code = k.getKeyCode();
        if (code == KeyEvent.KEYCODE_MEDIA_PLAY || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_HEADSETHOOK) {
            MediaCenter.get(c).dispatch("play", Double.NaN);
        }
    }
}
