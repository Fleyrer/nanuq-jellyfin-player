// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Peticiones HTTP hechas desde Java en lugar del WebView. Sirve para servicios que no permiten
 * peticiones desde otras páginas (CORS), como el servidor web de SomeDL («Solicitar canción»).
 * Solo http(s) y respuestas de hasta 4 MB.
 */
final class NativeHttp {
    private NativeHttp() { }

    static final class Result {
        final int status;   // 0 = no hubo respuesta (sin red, servidor apagado…)
        final String text;  // cuerpo de la respuesta, o el motivo del error si status = 0
        Result(int status, String text) { this.status = status; this.text = text; }
    }

    private static final int MAX_BYTES = 4 * 1024 * 1024;

    /** Rutas de la API de SomeDL que usa «Solicitar canción» (ver REQ en index.html). */
    static boolean allowed(String method, String path) {
        if (path == null) return false;
        String p = path.endsWith("/") && path.length() > 1 ? path.substring(0, path.length() - 1) : path;
        if ("POST".equals(method)) return p.endsWith("/add");
        return p.endsWith("/status") || p.endsWith("/get-queue") || p.endsWith("/get-version");
    }

    static Result fetch(String method, String url, String body) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(url);
            String scheme = u.getProtocol();
            if (!"http".equals(scheme) && !"https".equals(scheme)) return new Result(0, "Solo se admiten direcciones http o https");
            String m = "POST".equals(method) ? "POST" : "GET";
            // Seguridad: este puente existe solo para SomeDL. Si alguien lograra ejecutar código en la página, no
            // debe poder usarlo para leer otros servicios de tu red (router, paneles…): solo sus rutas, sin redirecciones.
            if (!allowed(m, u.getPath())) return new Result(0, "Ruta no permitida");
            c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(8000);
            c.setReadTimeout(120000); // SomeDL busca los datos de la canción antes de responder a /add
            c.setRequestMethod(m);
            c.setRequestProperty("Accept", "application/json");
            if ("POST".equals(m)) {
                byte[] b = (body == null ? "{}" : body).getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(b.length);
                try (OutputStream o = c.getOutputStream()) { o.write(b); }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Result(code, in == null ? "" : readAll(in));
        } catch (Exception e) {
            String why = e.getMessage();
            return new Result(0, why == null ? e.getClass().getSimpleName() : why);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int r;
            while ((r = s.read(buf)) != -1) {
                out.write(buf, 0, r);
                if (out.size() > MAX_BYTES) throw new IOException("Respuesta demasiado grande");
            }
            return out.toString("UTF-8");
        }
    }
}
