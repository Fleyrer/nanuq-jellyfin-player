// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Nanuq para Android: conecta la PWA con el sistema.
// - Sustituye navigator.mediaSession por una versión que maneja una MediaSession nativa
//   (notificación, pantalla de bloqueo, audífonos y reproducción en segundo plano).
// - Pasa el color del tema (meta theme-color) a las barras del sistema.
// Se carga antes que el script de la app (app.js); index.html no necesita cambios: se inyecta al compilar.
(function () {
  'use strict';
  var N = window.NanuqAndroid;
  if (!N) return;

  var handlers = Object.create(null);
  var meta = null, pbState = 'none';
  var last = { dur: -1, pos: 0, rate: 1, at: 0 };

  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return ''; } }

  function MediaMetadata(init) {
    init = init || {};
    this.title = String(init.title || '');
    this.artist = String(init.artist || '');
    this.album = String(init.album || '');
    this.artwork = Array.isArray(init.artwork) ? init.artwork.slice() : [];
  }
  window.MediaMetadata = MediaMetadata;

  function bestArt(list) {
    var best = null, bestSize = -1;
    (list || []).forEach(function (a) {
      if (!a || !a.src) return;
      var s = 0;
      String(a.sizes || '').split(/\s+/).forEach(function (x) { var m = /^(\d+)x(\d+)$/i.exec(x); if (m) s = Math.max(s, +m[1]); });
      // La notificación no necesita más de 512 px.
      var score = s > 512 ? 1024 - s : s;
      if (score > bestSize) { bestSize = score; best = a.src; }
    });
    return best ? abs(best) : '';
  }

  var mediaSession = {
    get metadata() { return meta; },
    set metadata(m) {
      meta = m || null;
      N.setMetadata(meta ? meta.title : '', meta ? meta.artist : '', meta ? meta.album : '', meta ? bestArt(meta.artwork) : '');
    },
    get playbackState() { return pbState; },
    set playbackState(s) {
      s = s === 'playing' || s === 'paused' ? s : 'none';
      if (s === pbState) return;
      pbState = s;
      N.setPlaybackState(s);
    },
    setActionHandler: function (action, fn) {
      if (typeof fn === 'function') handlers[action] = fn; else delete handlers[action];
      N.setActions(Object.keys(handlers).join(','));
    },
    setPositionState: function (p) {
      p = p || {};
      var dur = +p.duration || 0, pos = +p.position || 0, rate = p.playbackRate == null ? 1 : +p.playbackRate;
      var now = Date.now();
      // timeupdate llega ~4 veces por segundo: solo se avisa al sistema si la posición se desvió.
      var expected = last.pos + (pbState === 'playing' ? (now - last.at) / 1000 * last.rate : 0);
      if (dur !== last.dur || rate !== last.rate || Math.abs(expected - pos) > 1.5) N.setPosition(dur, pos, rate);
      last = { dur: dur, pos: pos, rate: rate, at: now };
    }
  };
  try { Object.defineProperty(navigator, 'mediaSession', { value: mediaSession, configurable: true }); } catch (e) { }

  // Los archivos ya vienen dentro del APK: el service worker de la PWA no hace falta.
  if (navigator.serviceWorker) {
    try { navigator.serviceWorker.register = function () { return Promise.reject(new Error('Sin service worker en la app de Android')); }; } catch (e) { }
  }

  // Llamado desde Java cuando se toca un botón de la notificación, los audífonos, etc.
  window.__nanuqMedia = function (action, arg) {
    var h = handlers[action];
    if (!h) return false;
    var d = { action: action };
    if (action === 'seekto') d.seekTime = +arg;
    if (action === 'seekforward' || action === 'seekbackward') d.seekOffset = +arg || 10;
    try { h(d); } catch (e) { }
    return true;
  };

  // Colores de las barras del sistema según el tema elegido en Ajustes.
  function sendTheme() {
    var m = document.querySelector('meta[name=theme-color]');
    N.setBarColor((m && m.content) || '#081120');
  }
  document.addEventListener('DOMContentLoaded', function () {
    var m = document.querySelector('meta[name=theme-color]');
    if (m && window.MutationObserver) new MutationObserver(sendTheme).observe(m, { attributes: true, attributeFilter: ['content'] });
    sendTheme();
  });
})();
