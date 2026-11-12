// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Prueba del almacén cifrado de la app de escritorio (SEC de main.js): los índices grandes (biblioteca y letras) van en
// su propio archivo y un cambio pequeño (la cola) no los vuelve a escribir. La corre scripts/build.sh.
// A mano: node --test linux/test/*.test.js
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanuq-prueba-almacen-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const T = require('./cargar-main')('SEC, secFlush, secSeal, secOpen, setOrigin: o => { origin = o; }', dir);
T.setOrigin('http://127.0.0.1:47863');
const ev = () => ({ senderFrame: { url: 'http://127.0.0.1:47863/index.html' }, returnValue: undefined });
const sec = m => { const e = ev(); T.handlers['nanuq:sec'](e, m); return e.returnValue; };
const KEY = crypto.randomBytes(32);
const mainFile = path.join(dir, 'datos-cifrados.bin'), libFile = path.join(dir, 'datos-libIdx.bin');
const abrir = f => JSON.parse(T.secOpen(KEY, fs.readFileSync(f)));

function nuevo(map) { Object.assign(T.SEC, { key: KEY, map, kind: 'gnome_libsecret', dirty: false, big: new Map(), bigDirty: new Set() }); }

test('el índice grande va aparte y un cambio de la cola no lo reescribe', () => {
  nuevo({});
  const idx = JSON.stringify({ t: 'x'.repeat(200000) });
  assert.strictEqual(sec({ op: 'set', k: 'libIdx', v: idx }), true);
  assert.strictEqual(sec({ op: 'set', k: 'queue', v: '[1]' }), true);
  T.secFlush();
  assert.ok(fs.existsSync(libFile));
  assert.strictEqual(T.secOpen(KEY, fs.readFileSync(libFile)), idx);
  assert.deepStrictEqual(Object.keys(abrir(mainFile)), ['queue']); // el archivo común, sin el índice
  const antes = fs.readFileSync(libFile);
  sec({ op: 'set', k: 'queue', v: '[2]' }); T.secFlush();
  assert.ok(fs.readFileSync(libFile).equals(antes), 'el índice no se volvió a escribir');
  assert.strictEqual(abrir(mainFile).queue, '[2]');
  T.SEC.big.clear(); // como al abrir otra vez la app: se lee del archivo
  assert.strictEqual(sec({ op: 'get', k: 'libIdx' }), idx);
  sec({ op: 'del', k: 'libIdx' }); T.secFlush();
  assert.ok(!fs.existsSync(libFile));
  assert.strictEqual(sec({ op: 'get', k: 'libIdx' }), null);
});

test('un índice dañado se lee como si no existiera (la app lo vuelve a armar)', () => {
  nuevo({});
  fs.writeFileSync(path.join(dir, 'datos-lyrIdx.bin'), crypto.randomBytes(100));
  assert.strictEqual(sec({ op: 'get', k: 'lyrIdx' }), null);
});
