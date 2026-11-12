// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.WebView;

/**
 * La pantalla de Nanuq: muestra la página (ver Page, que también puede vivir sin pantalla mientras suena la música),
 * maneja «Atrás», el color de las barras del sistema y el permiso de notificaciones.
 */
public class MainActivity extends Activity {
    private Page page;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        page = Page.get(this);
        show(page.attach(this));
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    /** Pone el WebView de la página en esta pantalla (también cuando la página se rehízo, ver Page.recreate). */
    void show(WebView web) { setContentView(web); }

    /** Atrás cierra diálogos y vuelve entre pantallas; en la pantalla inicial deja la app sonando en segundo plano. */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (!page.alive()) { super.onBackPressed(); return; }
        page.eval("(function(){try{return typeof back==='function'&&back()?1:0}catch(e){return 0}})()", v -> {
            if (!"1".equals(v)) moveTaskToBack(true);
        });
    }

    // La página no siempre sabe que la app pasó a segundo plano: se le avisa para que busque dispositivos menos seguido.
    @Override
    protected void onStart() { super.onStart(); page.eval("window.__nanuqVis&&window.__nanuqVis(true)"); }

    @Override
    protected void onStop() { page.eval("window.__nanuqVis&&window.__nanuqVis(false)"); SecureStore.get(this).flush(); super.onStop(); }

    @Override
    protected void onDestroy() {
        page.detach(this, isFinishing());
        super.onDestroy();
    }

    /** Pantalla encendida (FLAG_KEEP_SCREEN_ON) mientras la página lo pida: la letra a la vista y sonando. */
    void setKeepOn(boolean on) {
        if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    void setBarColor(int color) {
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
}
