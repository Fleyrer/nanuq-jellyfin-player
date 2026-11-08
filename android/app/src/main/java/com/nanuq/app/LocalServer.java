// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Servidor HTTP mínimo en 127.0.0.1 para las canciones y carátulas descargadas.
 * El reproductor de audio del WebView no siempre pasa por shouldInterceptRequest, pero sí por la red:
 * con un servidor real en el propio teléfono las descargas se reproducen y se puede saltar (Range).
 * Las rutas llevan un token aleatorio para que otras apps del teléfono no puedan leer los archivos.
 *
 * Rutas: /&lt;token&gt;/a/&lt;id&gt; (audio), /&lt;token&gt;/c/&lt;id&gt; (carátula) y /&lt;token&gt;/p/&lt;id&gt; (lo que sigue en la cola, ver Prefetch).
 */
final class LocalServer {
    interface Files {
        File audio(String id);
        String audioMime(String id);
        File cover(String id);
        File prefetch(String id);      // lo que sigue en la cola, guardado por adelantado (ver Prefetch)
        String prefetchMime(String id);
    }

    final int port;
    final String token;
    private final ServerSocket server;
    private final Files files;
    // Como mucho 32 conexiones atendidas a la vez (el reproductor usa una o dos): nadie puede agotar la memoria abriendo
    // miles, y como cada una tiene 10 s en total para mandar su petición, tampoco puede bloquear el servidor dejándolas mudas.
    private final ExecutorService pool = Executors.newFixedThreadPool(32);

    LocalServer(Files files) throws IOException {
        this.files = files;
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format(Locale.ROOT, "%02x", x));
        token = sb.toString();
        server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        port = server.getLocalPort();
        Thread t = new Thread(this::acceptLoop, "nanuq-local-server");
        t.setDaemon(true);
        t.start();
    }

    String base() { return "http://127.0.0.1:" + port + "/" + token + "/"; }

    private void acceptLoop() {
        while (!server.isClosed()) {
            try {
                Socket s = server.accept();
                pool.execute(() -> handle(s));
            } catch (IOException e) {
                if (server.isClosed()) return;
            }
        }
    }

    /** Una línea de la petición. deadline: hora límite para toda la petición (no solo para cada lectura). */
    private static String readLine(InputStream in, long deadline) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (System.currentTimeMillis() > deadline) throw new IOException("petición demasiado lenta");
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) throw new IOException("línea demasiado larga");
        }
        return c == -1 && sb.length() == 0 ? null : sb.toString();
    }

    private void handle(Socket s) {
        try (Socket sock = s) {
            // Para leer la petición: 5 s por lectura y 10 s en total, con como mucho 100 encabezados (enviar el audio no depende
            // de esto). Sin el tope total, otra app del teléfono podía mandar encabezados sin fin (o un byte cada pocos
            // segundos) y tener ocupados los 32 hilos: las descargas dejaban de sonar.
            sock.setSoTimeout(5000);
            long deadline = System.currentTimeMillis() + 10000;
            InputStream in = sock.getInputStream();
            OutputStream out = new BufferedOutputStream(sock.getOutputStream(), 64 * 1024);
            String request = readLine(in, deadline);
            if (request == null) return;
            String range = null, line;
            int headers = 0;
            while ((line = readLine(in, deadline)) != null && !line.isEmpty()) {
                if (++headers > 100) { status(out, 431, "Request Header Fields Too Large"); return; }
                int i = line.indexOf(':');
                if (i > 0 && line.substring(0, i).trim().equalsIgnoreCase("range")) range = line.substring(i + 1).trim();
            }
            String[] parts = request.split(" ");
            if (parts.length < 2 || !(parts[0].equals("GET") || parts[0].equals("HEAD"))) { status(out, 405, "Method Not Allowed"); return; }
            boolean head = parts[0].equals("HEAD");
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            String prefix = "/" + token + "/";
            if (!path.startsWith(prefix) || path.length() < prefix.length() + 3) { status(out, 404, "Not Found"); return; }
            String kind = path.substring(prefix.length(), prefix.length() + 2);
            String id = URLDecoder.decode(path.substring(prefix.length() + 2), "UTF-8");
            File f;
            String mime;
            if (kind.equals("a/")) { f = files.audio(id); mime = files.audioMime(id); }
            else if (kind.equals("c/")) { f = files.cover(id); mime = "image/jpeg"; }
            else if (kind.equals("p/")) { f = files.prefetch(id); mime = files.prefetchMime(id); }
            else { status(out, 404, "Not Found"); return; }
            if (f == null || !f.isFile()) { status(out, 404, "Not Found"); return; }
            serveFile(out, f, mime, range, head);
        } catch (IOException ignored) {
            // El reproductor corta conexiones a menudo (al saltar o cambiar de canción).
        } catch (RuntimeException ignored) {
            // Una petición mal formada no debe cerrar la app (en Android, un error sin capturar en un hilo la cierra).
        }
    }

    private static void status(OutputStream out, int code, String msg) throws IOException {
        String r = "HTTP/1.1 " + code + " " + msg + "\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
        out.write(r.getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
    }

    private static void serveFile(OutputStream out, File f, String mime, String range, boolean head) throws IOException {
        long len = f.length(), start = 0, end = len - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String[] p = range.substring(6).split(",")[0].trim().split("-", -1);
            try {
                if (p[0].isEmpty()) start = Math.max(0, len - Long.parseLong(p[1]));
                else {
                    start = Long.parseLong(p[0]);
                    if (p.length > 1 && !p[1].isEmpty()) end = Math.min(end, Long.parseLong(p[1]));
                }
                partial = true;
            } catch (NumberFormatException | ArrayIndexOutOfBoundsException e) { start = 0; end = len - 1; partial = false; }
        }
        if (partial && (start >= len || end < start)) {
            String r = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + len + "\r\nContent-Length: 0\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
            out.write(r.getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
            return;
        }
        long count = end - start + 1;
        StringBuilder h = new StringBuilder();
        h.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n")
                .append("Content-Type: ").append(mime).append("\r\n")
                .append("Content-Length: ").append(count).append("\r\n")
                .append("Accept-Ranges: bytes\r\n")
                .append("Access-Control-Allow-Origin: *\r\n")
                .append("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n")
                .append("Cache-Control: no-cache\r\n")
                .append("Connection: close\r\n");
        if (partial) h.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(len).append("\r\n");
        h.append("\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!head) {
            try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
                raf.seek(start);
                byte[] buf = new byte[64 * 1024];
                long left = count;
                while (left > 0) {
                    int r = raf.read(buf, 0, (int) Math.min(buf.length, left));
                    if (r <= 0) break;
                    out.write(buf, 0, r);
                    left -= r;
                }
            }
        }
        out.flush();
    }
}
