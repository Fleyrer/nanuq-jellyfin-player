// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
package com.nanuq.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Busca servidores Jellyfin en la red local con su método oficial: un mensaje UDP
 * "Who is JellyfinServer?" al puerto 7359 por difusión; cada servidor responde con un JSON
 * {Address, Id, Name}. Una página web no puede mandar UDP, por eso esto vive aquí.
 */
final class Discovery {
    private Discovery() { }

    /** @return JSON: lista de {raw: respuesta del servidor, from: IP que respondió}. */
    static String find(int timeoutMs) { return find("Who is JellyfinServer?", 7359, timeoutMs); }

    /** Igual, para otra pregunta y otro puerto (p. ej. las fiestas de Nanuq: «Who is NanuqParty?» al 47865). */
    static String find(String ask, int port, int timeoutMs) {
        JSONArray out = new JSONArray();
        Set<String> seen = new HashSet<>();
        byte[] msg = ask.getBytes(StandardCharsets.UTF_8);
        try (DatagramSocket s = new DatagramSocket()) {
            s.setBroadcast(true);
            s.setSoTimeout(300);
            List<InetAddress> targets = new ArrayList<>();
            targets.add(InetAddress.getByName("255.255.255.255"));
            try {
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (InterfaceAddress ia : ni.getInterfaceAddresses()) if (ia.getBroadcast() != null) targets.add(ia.getBroadcast());
                }
            } catch (Exception ignored) { }
            long start = System.currentTimeMillis(), end = start + timeoutMs;
            boolean resent = false;
            send(s, msg, targets, port);
            byte[] buf = new byte[8192];
            while (System.currentTimeMillis() < end) {
                // Los paquetes UDP se pueden perder: se repite una vez.
                if (!resent && System.currentTimeMillis() - start > 900) { send(s, msg, targets, port); resent = true; }
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    s.receive(p);
                    String txt = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                    String id;
                    try { id = new JSONObject(txt).optString("Id", txt); } catch (Exception e) { continue; }
                    if (seen.size() >= 32 || !seen.add(id)) continue; // como mucho 32: nadie en la red puede inflar la lista sin fin
                    JSONObject o = new JSONObject();
                    o.put("raw", txt);
                    o.put("from", p.getAddress().getHostAddress());
                    out.put(o);
                } catch (SocketTimeoutException ignored) { }
            }
        } catch (Exception ignored) { }
        return out.toString();
    }

    private static void send(DatagramSocket s, byte[] msg, List<InetAddress> targets, int port) {
        for (InetAddress t : targets) {
            try { s.send(new DatagramPacket(msg, msg.length, t, port)); } catch (Exception ignored) { }
        }
    }
}
