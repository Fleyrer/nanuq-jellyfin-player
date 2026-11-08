// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Datos personales cifrados: sesión, cola, conteo de reproducciones, DJ, pedidos, servidores, letras (desde la página)
 * y el índice de descargas. La clave AES-256 vive en el almacén de claves de Android (Android Keystore): no se puede
 * sacar del teléfono y, en la mayoría de los equipos, está en hardware. Cada archivo va cifrado con AES-GCM
 * (12 bytes de IV + texto cifrado con su etiqueta de autenticación).
 *
 * kind(): "android-keystore" si funciona; "locked" si el Keystore no responde ahora (se reintenta); "lost" si los datos
 * ya no se pueden abrir (se ofrece empezar de cero); null si el Keystore no está disponible (la página guarda como antes).
 * En "locked" y "lost" no se guarda nada en claro.
 */
final class SecureStore {
    private static final String ALIAS = "nanuq-datos";
    private static final int IV = 12;
    private static SecureStore instance;

    static synchronized SecureStore get(Context c) {
        if (instance == null) instance = new SecureStore(c.getApplicationContext());
        return instance;
    }

    private final File file;
    private SecretKey key;
    private JSONObject map;
    private String kind;
    private final ScheduledExecutorService writer = Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> pending;

    private long triedAt;

    private SecureStore(Context app) {
        file = new File(app.getFilesDir(), "datos-cifrados.bin");
        open();
    }

    /**
     * Abre (o crea) la clave y el archivo. Dos tipos de falla:
     * - el Keystore no responde (pasa a veces justo al arrancar el teléfono): "locked", se reintenta en kind();
     * - la clave ya no abre el archivo (se perdió o se invalidó tras actualizar o restaurar el sistema): "lost", solo
     *   reset() lo arregla. Nunca se escribe nada en claro ni se borra el archivo sin que el usuario lo pida.
     */
    private void open() {
        triedAt = System.currentTimeMillis();
        boolean fresh = false;
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (!ks.containsAlias(ALIAS)) {
                KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build());
                kg.generateKey();
                fresh = true; // si ya había archivo, se cifró con otra clave: no se podrá abrir
            }
            key = (SecretKey) ks.getKey(ALIAS, null);
            if (key == null) throw new IllegalStateException("sin clave");
        } catch (Exception e) {
            key = null; map = null;
            kind = file.isFile() ? "locked" : null;
            return;
        }
        if (!file.isFile()) { map = new JSONObject(); kind = "android-keystore"; return; }
        try {
            map = new JSONObject(new String(decrypt(readAll(file)), StandardCharsets.UTF_8));
            kind = "android-keystore";
        } catch (javax.crypto.AEADBadTagException | android.security.keystore.KeyPermanentlyInvalidatedException | org.json.JSONException e) {
            map = null; kind = "lost";
        } catch (Exception e) {
            map = null; kind = fresh ? "lost" : "locked";
        }
    }

    /** Estado del almacén; si estaba "locked" (Keystore que no respondía), vuelve a intentar abrirlo. */
    synchronized String kind() {
        if ("locked".equals(kind) && System.currentTimeMillis() - triedAt > 1500) open();
        return kind;
    }

    /**
     * «Empezar de cero» (lo pide la página, con confirmación del usuario): el archivo que ya no se abre se aparta con
     * otro nombre, se crea una clave nueva y un almacén vacío. Devuelve el nuevo estado.
     */
    synchronized String reset() {
        if (pending != null) pending.cancel(false);
        if (file.isFile()) //noinspection ResultOfMethodCallIgnored
            file.renameTo(new File(file.getPath() + ".ilegible-" + System.currentTimeMillis()));
        try { KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); ks.deleteEntry(ALIAS); } catch (Exception ignored) { }
        open();
        return kind;
    }

    boolean ready() { return key != null && map != null; }

    synchronized String get(String k) {
        if (!ready() || !validKey(k)) return null;
        return map.has(k) ? map.optString(k, null) : null;
    }

    synchronized boolean set(String k, String v) {
        if (!ready() || !validKey(k) || v == null || v.length() > 8_000_000) return false;
        try { map.put(k, v); } catch (Exception e) { return false; }
        scheduleSave();
        return true;
    }

    synchronized void del(String k) {
        if (!ready() || !validKey(k)) return;
        map.remove(k);
        scheduleSave();
    }

    private static boolean validKey(String k) { return k != null && k.matches("[A-Za-z0-9._-]{1,120}"); }

    private void scheduleSave() {
        if (pending != null) pending.cancel(false);
        pending = writer.schedule(this::saveNow, 400, TimeUnit.MILLISECONDS);
    }

    /** Escribe ya (por ejemplo, cuando la app pasa a segundo plano). */
    void flush() { writer.execute(this::saveNow); }

    private void saveNow() {
        byte[] plain;
        synchronized (this) { if (!ready()) return; plain = map.toString().getBytes(StandardCharsets.UTF_8); }
        try { writeAtomic(file, encrypt(plain)); } catch (Exception ignored) { }
        Arrays.fill(plain, (byte) 0);
    }

    // ---- Cifrado de bloques de bytes (también para el índice de descargas) ----

    byte[] encrypt(byte[] plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = c.getIV(), ct = c.doFinal(plain);
        byte[] out = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(ct, 0, out, iv.length, ct.length);
        return out;
    }

    byte[] decrypt(byte[] data) throws Exception {
        if (data.length < IV + 16) throw new IOException("Archivo cifrado incompleto");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, data, 0, IV));
        return c.doFinal(data, IV, data.length - IV);
    }

    static byte[] readAll(File f) throws IOException {
        long len = f.length();
        if (len > 64L * 1024 * 1024) throw new IOException("Archivo demasiado grande");
        byte[] b = new byte[(int) len];
        try (InputStream in = new FileInputStream(f)) { int off = 0, r; while (off < b.length && (r = in.read(b, off, b.length - off)) > 0) off += r; }
        return b;
    }

    static void writeAtomic(File f, byte[] data) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(data); o.getFD().sync(); }
        if (!tmp.renameTo(f)) throw new IOException("No se pudo guardar");
    }
}
