// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Prueba del cifrado de las canciones de la fiesta (ptSeal / ptOpenRange de main.js), sin dependencias.
// La corre scripts/build.sh antes de compilar Linux (si falla, no hay paquetes). A mano: node --test linux/test/*.test.js
// (con este Node, «node --test linux/test/» con la carpeta no funciona: usa el glob).
// main.js se carga TAL CUAL con un «electron» falso (ver cargar-main.js).
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const T = require('./cargar-main')('ptSeal, ptOpenRange, ptEncSize, PT, PT_CH, ptLocal');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanuq-prueba-fiesta-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Una canción como la arma ptAdd/ptChunk/ptEnd: bloques de 64 KB sellados en orden y el resto al final.
let seq = 0;
function seal(plain) {
  const e = { file: path.join(dir, 'c' + (seq++) + '.audio'), fkey: T.PT.fkey, nonce: crypto.randomBytes(8), k: 0, size: plain.length };
  const parts = [];
  for (let o = 0; o < plain.length; o += T.PT_CH) parts.push(T.ptSeal(e, plain.subarray(o, o + T.PT_CH)));
  fs.writeFileSync(e.file, Buffer.concat(parts));
  return e;
}
async function read(e, a, b) { const out = []; for await (const c of T.ptOpenRange(e, a, b)) out.push(c); return Buffer.concat(out); }
T.PT.fkey = crypto.randomBytes(32);

test('ida y vuelta: el archivo mide lo esperado y cualquier rango sale idéntico', async () => {
  for (const n of [1, 1000, T.PT_CH - 1, T.PT_CH, T.PT_CH + 1, 300000]) {
    const plain = crypto.randomBytes(n), e = seal(plain);
    assert.strictEqual(fs.statSync(e.file).size, T.ptEncSize(e), 'tamaño cifrado de ' + n);
    const ranges = [[0, n - 1], [n - 1, n - 1], [0, 0]];
    for (let k = 0; k < 30; k++) { const a = crypto.randomInt(0, n), b = crypto.randomInt(a, n); ranges.push([a, b]); }
    for (const [a, b] of ranges) assert.ok((await read(e, a, b)).equals(plain.subarray(a, b + 1)), `rango ${a}-${b} de ${n}`);
  }
});

test('un byte cambiado en el disco: no se entrega ese bloque', async () => {
  const plain = crypto.randomBytes(200000), e = seal(plain), buf = fs.readFileSync(e.file);
  buf[100000] ^= 1; fs.writeFileSync(e.file, buf);
  await assert.rejects(read(e, 0, plain.length - 1));
  assert.ok((await read(e, 0, 1000)).equals(plain.subarray(0, 1001)), 'el primer bloque, intacto, sí se lee');
});

test('bloques cambiados de lugar: falla', async () => {
  const plain = crypto.randomBytes(3 * T.PT_CH), e = seal(plain), buf = fs.readFileSync(e.file), B = T.PT_CH + 16;
  fs.writeFileSync(e.file, Buffer.concat([buf.subarray(B, 2 * B), buf.subarray(0, B), buf.subarray(2 * B)]));
  await assert.rejects(read(e, 0, 10));
});

test('el archivo de otra canción (misma sala) no se acepta', async () => {
  const a = seal(crypto.randomBytes(100000)), b = seal(crypto.randomBytes(100000));
  fs.copyFileSync(b.file, a.file);
  await assert.rejects(read(a, 0, 10));
});

test('la sala solo atiende a la red local (ptLocal): privadas sí, internet no', () => {
  for (const ip of ['192.168.1.20', '10.0.0.5', '172.16.3.4', '127.0.0.1', '100.100.1.1', '::ffff:192.168.1.9', 'fd12::1', 'fe80::1%wlan0', '::1'])
    assert.strictEqual(T.ptLocal(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '::ffff:8.8.8.8', '2001:db8::1', '200::1', '201:abcd::1', 'fec0::1', '', 'basura'])
    assert.strictEqual(T.ptLocal(ip), false, ip);
});
