// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.regex.Pattern;

/**
 * Integridad de lo que se descarga (descargas y cola guardada por adelantado).
 * Ogg (Opus): cada página trae su CRC y la última marca el fin del flujo (EOS). Las conversiones de Jellyfin no mandan
 * Content-Length, así que sin esto una descarga cortada a la mitad (o con bytes cambiados en el camino) se guardaba
 * como buena. Se revisan todas las páginas y que el archivo termine justo en una página con EOS.
 */
final class OggCheck {
    private OggCheck() { }

    private static final int[] CRC = new int[256];
    static {
        for (int i = 0; i < 256; i++) {
            int r = i << 24;
            for (int k = 0; k < 8; k++) r = (r & 0x80000000) != 0 ? (r << 1) ^ 0x04C11DB7 : r << 1;
            CRC[i] = r;
        }
    }

    private static int crc(int c, byte[] b, int len) {
        for (int i = 0; i < len; i++) c = (c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 0xff];
        return c;
    }

    private static int read(InputStream in, byte[] b, int len) throws IOException {
        int n = 0;
        while (n < len) { int r = in.read(b, n, len - n); if (r < 0) break; n += r; }
        return n;
    }

    /** true si no es Ogg (otros formatos no se revisan aquí) o si es un Ogg completo y sin alterar. */
    static boolean valid(File f) {
        try (InputStream in = new BufferedInputStream(new FileInputStream(f), 64 * 1024)) {
            byte[] h = new byte[27], lace = new byte[255], body = new byte[255 * 255];
            boolean first = true, eos = false;
            while (true) {
                int r = read(in, h, 27);
                if (first && (r < 4 || h[0] != 'O' || h[1] != 'g' || h[2] != 'g' || h[3] != 'S')) return true; // no es Ogg
                if (r == 0) return eos;             // terminó justo después de una página: ¿era la última?
                if (r < 27 || h[0] != 'O' || h[1] != 'g' || h[2] != 'g' || h[3] != 'S' || h[4] != 0) return false;
                first = false;
                int nseg = h[26] & 0xff;
                if (read(in, lace, nseg) < nseg) return false;
                int size = 0;
                for (int i = 0; i < nseg; i++) size += lace[i] & 0xff;
                if (read(in, body, size) < size) return false; // cortado a media página
                int want = (h[22] & 0xff) | (h[23] & 0xff) << 8 | (h[24] & 0xff) << 16 | (h[25] & 0xff) << 24;
                h[22] = h[23] = h[24] = h[25] = 0;
                if (crc(crc(crc(0, h, 27), lace, nseg), body, size) != want) return false; // bytes cambiados
                eos = (h[5] & 0x04) != 0;
            }
        } catch (IOException e) {
            return false;
        }
    }

    private static final Pattern MIME = Pattern.compile("audio/[a-z0-9.+-]{1,40}");

    /** El tipo de audio que dijo el servidor, solo si es razonable (se repite tal cual en el servidor local). */
    static String mime(String contentType, String fallback) {
        if (contentType == null) return fallback;
        String m = contentType.split(";")[0].trim().toLowerCase(java.util.Locale.ROOT);
        return MIME.matcher(m).matches() ? m : fallback;
    }
}
