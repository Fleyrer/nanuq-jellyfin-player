// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;

/**
 * Prueba de OggCheck, sin dependencias: la corre android/build-apk.sh con el JDK antes de compilar el APK (si falla,
 * no hay APK). A mano:
 *   javac -d /tmp/oggt android/app/src/main/java/com/nanuq/app/OggCheck.java android/test/OggCheckTest.java
 *   java -cp /tmp/oggt com.nanuq.app.OggCheckTest
 * Los archivos Ogg se arman aquí mismo, página por página, con su CRC calculado bit a bit (otra forma de calcularlo que
 * la tabla de OggCheck: si una de las dos estuviera mal, no coincidirían).
 */
public final class OggCheckTest {
    private static int fails = 0, n = 0;

    private static void check(String what, boolean got, boolean want) {
        n++;
        if (got != want) { fails++; System.out.println("FALLA: " + what + " (dio " + got + ", se esperaba " + want + ")"); }
    }

    private static int crc(byte[] b) {
        int c = 0;
        for (byte x : b) {
            c ^= (x & 0xff) << 24;
            for (int k = 0; k < 8; k++) c = (c & 0x80000000) != 0 ? (c << 1) ^ 0x04C11DB7 : c << 1;
        }
        return c;
    }

    /** Una página Ogg con su CRC. flags: 2 = inicio del flujo, 4 = fin (EOS). */
    private static byte[] page(int flags, long granule, int seq, byte[] body) {
        int nseg = body.length / 255 + 1;
        byte[] p = new byte[27 + nseg + body.length];
        p[0] = 'O'; p[1] = 'g'; p[2] = 'g'; p[3] = 'S'; p[4] = 0; p[5] = (byte) flags;
        for (int i = 0; i < 8; i++) p[6 + i] = (byte) (granule >>> (8 * i));
        int serial = 0x4e616e75; // «Nanu»
        for (int i = 0; i < 4; i++) { p[14 + i] = (byte) (serial >>> (8 * i)); p[18 + i] = (byte) (seq >>> (8 * i)); }
        p[26] = (byte) nseg;
        int left = body.length;
        for (int i = 0; i < nseg; i++) { p[27 + i] = (byte) Math.min(255, left); left -= Math.min(255, left); }
        System.arraycopy(body, 0, p, 27 + nseg, body.length);
        int c = crc(p);
        for (int i = 0; i < 4; i++) p[22 + i] = (byte) (c >>> (8 * i));
        return p;
    }

    /** Un Ogg de 6 páginas (con o sin EOS al final), con cuerpos de varios tamaños (también de más de 255 bytes). */
    private static byte[] ogg(boolean eos) throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(page(2, 0, 0, "OpusHead\u0001\u00028\u0001\u0080»\0\0\0\0\0".getBytes("ISO-8859-1")));
        o.write(page(0, 0, 1, "OpusTags\u0005\0\0\0Nanuq\0\0\0\0".getBytes("ISO-8859-1")));
        int[] sizes = { 300, 1000, 77, 4000 };
        for (int i = 0; i < sizes.length; i++) {
            byte[] b = new byte[sizes[i]];
            for (int k = 0; k < b.length; k++) b[k] = (byte) (k * 31 + i);
            boolean last = i == sizes.length - 1;
            o.write(page(last && eos ? 4 : 0, 960L * (i + 1), 2 + i, b));
        }
        return o.toByteArray();
    }

    private static boolean valid(byte[] data, long len) throws Exception {
        File f = File.createTempFile("oggcheck", ".ogg");
        try { Files.write(f.toPath(), data); return OggCheck.valid(f, len); } finally { f.delete(); }
    }

    public static void main(String[] args) throws Exception {
        byte[] good = ogg(true), noEos = ogg(false);
        check("Ogg completo, sin tamaño", valid(good, -1), true);
        check("Ogg completo, con tamaño", valid(good, good.length), true);
        check("Sin EOS y sin tamaño (descarga cortada justo en el borde de una página)", valid(noEos, -1), false);
        check("Sin EOS pero con tamaño (archivo propio sin EOS)", valid(noEos, noEos.length), true);
        check("Cortado a media página, sin tamaño", valid(Arrays.copyOf(good, good.length - 500), -1), false);
        check("Cortado a media página, con tamaño", valid(Arrays.copyOf(good, good.length - 500), good.length), false);
        byte[] flip = good.clone(); flip[flip.length - 1000] ^= 0x10;
        check("Un bit cambiado en el audio", valid(flip, -1), false);
        byte[] gran = good.clone(); gran[good.length - 4000 - 16 - 27 + 6] ^= 0x01; // granule de la última página
        check("Un bit cambiado en el encabezado de una página", valid(gran, -1), false);
        byte[] junk = Arrays.copyOf(good, good.length + 10);
        check("Basura después de la última página", valid(junk, -1), false);
        check("No es Ogg (MP3): no se revisa aquí", valid("ID3\u0004\0\0\0\0\0\0datos de un mp3".getBytes("ISO-8859-1"), -1), true);
        boolean mime = "audio/ogg".equals(OggCheck.mime("Audio/Ogg; codecs=opus", "x"))
                && "x".equals(OggCheck.mime("audio/mpeg\r\nX-Malo: 1", "x"))
                && "x".equals(OggCheck.mime("text/html", "x"))
                && "x".equals(OggCheck.mime(null, "x"));
        check("mime(): solo tipos de audio razonables", mime, true);
        System.out.println(fails == 0 ? "OggCheck: " + n + " pruebas bien" : "OggCheck: " + fails + " de " + n + " pruebas fallaron");
        System.exit(fails == 0 ? 0 : 1);
    }
}
