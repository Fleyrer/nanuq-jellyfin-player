// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Prueba de parseServer (web/app.js): convierte lo que escribes al entrar («192.168.1.20», «[2001:db8::10]:8096»…) en
// la dirección de tu Jellyfin. Se saca la función de app.js TAL CUAL y se corre en vm con tx() y location falsos.
// La corre scripts/build.sh. A mano: node --test linux/test/*.test.js
'use strict';
const test = require('node:test'), assert = require('node:assert'), vm = require('vm'), fs = require('fs'), path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'app.js'), 'utf8');
const src = /\nfunction parseServer\([\s\S]*?\n}\n/.exec(app)[0];
function parser(protocol = 'http:') {
  const ctx = { tx: s => s, location: { protocol }, URL };
  vm.createContext(ctx); vm.runInContext(src + ';this.parseServer = parseServer;', ctx);
  return ctx.parseServer;
}
const P = parser();

test('IPv4 y nombres cortos sin puerto: el de Jellyfin (8096)', () => {
  assert.strictEqual(P('192.168.1.20').base, 'http://192.168.1.20:8096');
  assert.strictEqual(P('servidor').base, 'http://servidor:8096');
  assert.strictEqual(P('192.168.1.20:9000').base, 'http://192.168.1.20:9000');
});

test('nombres con dominio y https con ruta, tal cual', () => {
  assert.strictEqual(P('musica.ejemplo.com').base, 'http://musica.ejemplo.com');
  const p = P('https://casa.ejemplo/jellyfin/');
  assert.strictEqual(p.base, 'https://casa.ejemplo/jellyfin'); assert.strictEqual(p.scheme, 'https');
});

test('IPv6 con y sin corchetes', () => {
  assert.strictEqual(P('[2001:db8::10]:8096').base, 'http://[2001:db8::10]:8096');
  const p = P('2001:db8::10'); assert.strictEqual(p.base, 'http://[2001:db8::10]:8096'); assert.strictEqual(p.v6, true);
  assert.strictEqual(P('fd12::5').base, 'http://[fd12::5]:8096');
});

test('direcciones que no sirven: error claro, no una dirección rara', () => {
  for (const bad of ['', '   ', 'ftp://x', '[2001:db8::1', 'host:99999', 'host:abc', 'fe80::1', '[fe80::1%wlan0]', 'http://']) assert.throws(() => P(bad), bad);
});

test('app abierta por https y servidor http: avisa contenido mixto (salvo localhost)', () => {
  const H = parser('https:');
  assert.strictEqual(H('http://192.168.1.20:8096').mixed, true);
  assert.strictEqual(H('http://localhost:8096').mixed, false);
  assert.strictEqual(H('192.168.1.20').base, 'https://192.168.1.20:8920'); // sin esquema: https y su puerto
});
