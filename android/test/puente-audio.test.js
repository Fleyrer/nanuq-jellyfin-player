// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Prueba de window.NanuqNativeAudio (android-bridge.js): el objeto que se usa como un <audio> y reproduce con el
// reproductor del sistema (NativeAudio.java). Sin dependencias: android/build-apk.sh la corre antes de compilar (si
// falla, no hay APK). A mano: node --test android/test/*.test.js
// android-bridge.js se carga TAL CUAL en vm con un NanuqAndroid falso que anota lo que le piden; los avisos del teléfono
// se simulan llamando a window.__nanuqAudio como lo hace NativeAudio.emit.
'use strict';
const test = require('node:test'), assert = require('node:assert'), vm = require('vm'), fs = require('fs'), path = require('path');

function load() {
  const calls = [];
  const N = new Proxy({}, { get: (t, k) => k === 'auNew' ? () => { calls.push(['auNew']); return 1; } : (...a) => { calls.push([k, ...a]); } });
  const ctx = {
    NanuqAndroid: N, navigator: {}, location: { href: 'http://localhost/index.html' },
    document: { addEventListener() { }, querySelector() { return null; } },
    EventTarget, Event, DOMException, URL, Promise, setTimeout, Audio: function () { this.addEventListener = () => { }; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'bridge', 'android-bridge.js'), 'utf8'), ctx);
  return { ctx, calls, a: new ctx.NanuqNativeAudio() };
}
const events = a => { const l = []; for (const t of ['play', 'playing', 'pause', 'ended', 'error', 'timeupdate', 'loadedmetadata']) a.addEventListener(t, () => l.push(t)); return l; };

test('suena: src y play() llegan al teléfono y la promesa se cumple con «playing»', async () => {
  const { ctx, calls, a } = load(), ev = events(a);
  a.src = 'http://jelly:8096/Audio/x/universal'; const p = a.play();
  assert.deepStrictEqual(calls.find(c => c[0] === 'auSrc'), ['auSrc', 1, 1, 'http://jelly:8096/Audio/x/universal']);
  ctx.__nanuqAudio(1, 1, 'meta', 0, 200, 0); ctx.__nanuqAudio(1, 1, 'playing', 0, 200, 0);
  await p;
  assert.strictEqual(a.paused, false); assert.strictEqual(a.duration, 200); assert.strictEqual(a.seekable.length, 1);
  assert.ok(ev.includes('play') && ev.includes('playing') && ev.includes('loadedmetadata'));
});

test('un aviso de la canción anterior (gen viejo) se ignora: no se salta ninguna canción', () => {
  const { ctx, a } = load(), ev = events(a);
  a.src = 'http://jelly/a'; a.play().catch(() => { }); ctx.__nanuqAudio(1, 1, 'playing', 0, 100, 0);
  a.src = 'http://jelly/b'; a.play().catch(() => { });          // gen 2
  ctx.__nanuqAudio(1, 1, 'ended', 100, 100, 0);                  // llega tarde, de la canción «a»
  assert.ok(!ev.includes('ended')); assert.strictEqual(a.ended, false);
});

test('«ended» deja la canción en pausa y avisa pause y luego ended', () => {
  const { ctx, a } = load(), ev = events(a);
  a.src = 'http://jelly/a'; a.play().catch(() => { }); ctx.__nanuqAudio(1, 1, 'playing', 0, 100, 0);
  ev.length = 0; ctx.__nanuqAudio(1, 1, 'ended', 100, 100, 0);
  assert.strictEqual(a.paused, true); assert.strictEqual(a.ended, true);
  assert.ok(ev.indexOf('pause') >= 0 && ev.indexOf('pause') < ev.indexOf('ended'));
});

test('sin foco de audio («denied»): play() se rechaza con NotAllowedError', async () => {
  const { ctx, a } = load();
  a.src = 'http://jelly/a'; const p = a.play();
  ctx.__nanuqAudio(1, 1, 'denied', 0, -1, 0);
  await assert.rejects(p, e => e.name === 'NotAllowedError');
  assert.strictEqual(a.paused, true);
});

test('otra app tomó el audio («paused») y lo devolvió («playing»): pause y luego play, sin quedar trabado', () => {
  const { ctx, a } = load(), ev = events(a);
  a.src = 'http://jelly/a'; a.play().catch(() => { }); ctx.__nanuqAudio(1, 1, 'playing', 0, 100, 0);
  ev.length = 0; ctx.__nanuqAudio(1, 1, 'paused', 10, 100, 0);
  assert.strictEqual(a.paused, true); assert.strictEqual(a.native, true);
  ctx.__nanuqAudio(1, 1, 'playing', 10, 100, 0);
  assert.strictEqual(a.paused, false); assert.deepStrictEqual(ev.filter(t => t !== 'timeupdate'), ['pause', 'play', 'playing']);
});

test('modo demo (blob:) usa un <audio> por dentro y no le pide nada al teléfono', () => {
  const { calls, a } = load();
  a.src = 'blob:http://localhost/abc';
  assert.strictEqual(a.native, false);
  assert.deepStrictEqual(calls.filter(c => c[0] === 'auSrc').map(c => c[3]), ['']);
});
