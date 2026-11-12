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

  // ---- La música con el reproductor del sistema (ver NativeAudio.java) ----
  // window.NanuqNativeAudio se comporta como un <audio> (src, play(), pause(), currentTime, volume, eventos…), así que
  // app.js reproduce igual que en el navegador. Con una dirección http(s) suena en el reproductor nativo, con su propio
  // foco de audio; con otra (blob:, data:, archivos de la app: el modo demo) usa un <audio> normal por dentro.
  // currentTime se calcula aquí (último dato del teléfono + lo que pasó desde entonces), sin preguntar a Java.
  if (N.auNew) {
    var players = Object.create(null);
    var HTML_EVENTS = ['play', 'playing', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'seeking', 'seeked', 'waiting', 'stalled', 'error', 'emptied', 'volumechange', 'durationchange'];
    var noSource = function () { return { length: 0, start: function () { throw new RangeError('index'); }, end: function () { throw new RangeError('index'); } }; };
    var domErr = function (name, msg) { try { return new DOMException(msg, name); } catch (e) { var x = new Error(msg); x.name = name; return x; } };
    try { N.auReset(); } catch (e) { } // reproductores de una carga anterior de la página (p. ej. al cambiar de idioma)

    class NativeAudio extends EventTarget {
      constructor() {
        super();
        this.id = N.auNew(); this.gen = 0; this.preload = 'auto';
        this._src = ''; this._html = null; this._vol = 1; this._muted = false;
        this._reset();
        if (this.id) players[this.id] = this;
      }
      _reset() {
        this._paused = true; this._ended = false; this._pos = 0; this._at = 0; this._run = false; this._dur = NaN;
        this._ready = 0; this._seeking = false; this._err = null; this._seekable = false; this._fail('AbortError', 'La fuente cambió');
      }
      _fire(t) { this.dispatchEvent(new Event(t)); }
      _fail(name, msg) { var w = this._waits || []; this._waits = []; w.forEach(function (x) { x.no(domErr(name, msg)); }); }
      _ok() { var w = this._waits || []; this._waits = []; w.forEach(function (x) { x.ok(); }); }
      get native() { return !this._html; }
      // Con un <audio> por dentro (modo demo): sus eventos se reenvían desde aquí (el «target» es este objeto).
      _useHtml() {
        if (this._html) return this._html;
        var a = this._html = new Audio(), self = this;
        a.preload = 'auto'; a.volume = this._vol; a.muted = this._muted;
        HTML_EVENTS.forEach(function (t) { a.addEventListener(t, function () { if (self._html === a) self._fire(t); }); });
        return a;
      }
      _dropHtml() { var a = this._html; if (!a) return; this._html = null; try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { } }

      get src() { return this._html ? this._html.src : this._src; }
      set src(v) {
        var url = ''; if (v != null && String(v) !== '') { try { url = new URL(String(v), location.href).href; } catch (e) { url = String(v); } }
        // http(s) de afuera → nativo; los archivos de la app (http://localhost/…, los sirve el WebView), blob: y data: → <audio>.
        var nat = /^https?:/i.test(url) && !/^http:\/\/localhost[/:]/i.test(url);
        this.gen++; this._reset(); this._src = url;
        if (url && !nat) { if (this.id) N.auSrc(this.id, this.gen, ''); this._useHtml().src = url; return; }
        this._dropHtml();
        if (this.id) N.auSrc(this.id, this.gen, url);
        this._fire('emptied');
      }
      getAttribute(n) { return n === 'src' ? (this.src || null) : null; }
      hasAttribute(n) { return n === 'src' && !!this.src; }
      removeAttribute(n) { if (n === 'src') this.src = ''; }
      setAttribute(n, v) { if (n === 'src') this.src = v; }
      load() { if (this._html) { this._html.load(); return; } if (this._src) this.src = this._src; }
      get currentSrc() { return this.src; }

      get paused() { return this._html ? this._html.paused : this._paused; }
      get ended() { return this._html ? this._html.ended : this._ended; }
      get readyState() { return this._html ? this._html.readyState : this._ready; }
      get seeking() { return this._html ? this._html.seeking : this._seeking; }
      get error() { return this._html ? this._html.error : this._err; }
      get networkState() { return this._html ? this._html.networkState : this._err ? 3 : this._src ? 1 : 0; }
      get duration() { return this._html ? this._html.duration : this._dur; }
      get seekable() {
        if (this._html) return this._html.seekable;
        if (!this._seekable) return noSource();
        var d = this._dur; return { length: 1, start: function () { return 0; }, end: function () { return d; } };
      }
      get currentTime() {
        if (this._html) return this._html.currentTime;
        var t = this._pos + (this._run && !this._paused && !this._seeking ? (Date.now() - this._at) / 1000 : 0);
        return isFinite(this._dur) && this._dur > 0 ? Math.min(t, this._dur) : t;
      }
      set currentTime(v) {
        if (this._html) { this._html.currentTime = v; return; }
        v = Math.max(0, +v || 0); this._pos = v; this._at = Date.now(); this._seeking = true; this._ended = false;
        if (this.id) N.auSeek(this.id, v);
        this._fire('seeking');
      }
      get volume() { return this._vol; }
      set volume(v) {
        v = +v; if (!(v >= 0 && v <= 1)) throw domErr('IndexSizeError', 'Volumen fuera de rango');
        if (v === this._vol) return; this._vol = v;
        if (this._html) this._html.volume = v; else if (this.id) N.auVol(this.id, v, this._muted);
      }
      get muted() { return this._muted; }
      set muted(m) {
        m = !!m; if (m === this._muted) return; this._muted = m;
        if (this._html) this._html.muted = m; else if (this.id) N.auVol(this.id, this._vol, m);
      }
      play() {
        if (this._html) return this._html.play();
        if (!this.id) return Promise.reject(domErr('NotSupportedError', 'Sin reproductor'));
        if (!this._src) return Promise.reject(domErr('NotSupportedError', 'Sin canción'));
        if (this._err) return Promise.reject(domErr('NotSupportedError', 'La canción no se pudo reproducir'));
        var self = this, p = new Promise(function (ok, no) { self._waits.push({ ok: ok, no: no }); });
        if (this._paused) { this._paused = false; this._ended = false; this._fire('play'); }
        if (this._run) this._ok();
        N.auPlay(this.id);
        return p;
      }
      pause() {
        if (this._html) { this._html.pause(); return; }
        if (this._paused) return;
        this._pos = this.currentTime; this._paused = true; this._run = false;
        if (this.id) N.auPause(this.id);
        this._fail('AbortError', 'Pausada antes de empezar');
        this._fire('pause');
      }
      // Ya no se usará (p. ej. el de «Probar conexión»): se libera su lugar en el teléfono (como mucho hay 8).
      dispose() { this._dropHtml(); this._reset(); if (this.id) { delete players[this.id]; N.auRelease(this.id); this.id = 0; } }
      // Aviso del teléfono (ver NativeAudio.emit).
      _ev(ev, pos, dur, x) {
        var now = Date.now();
        if (pos >= 0) { this._pos = pos; this._at = now; }
        if (dur > 0) { if (dur !== this._dur) { this._dur = dur; } } else if (ev === 'meta') this._dur = Infinity; // conversión en vivo: sin duración
        switch (ev) {
          case 'meta':
            this._seekable = dur > 0; this._ready = 4;
            this._fire('durationchange'); this._fire('loadedmetadata'); this._fire('loadeddata'); this._fire('canplay'); this._fire('canplaythrough');
            break;
          case 'playing':
            this._run = true; this._ready = 4;
            // El teléfono volvió a sonar solo (recuperó el foco de audio): para la página es un «play».
            if (this._paused) { this._paused = false; this._ended = false; this._fire('play'); }
            this._ok(); this._fire('playing'); this._fire('timeupdate');
            break;
          case 'time': if (this._run && !this._seeking) this._fire('timeupdate'); break;
          case 'waiting': this._run = false; this._ready = 2; this._fire('waiting'); break;
          case 'seeked': this._seeking = false; this._fire('seeked'); this._fire('timeupdate'); break;
          case 'paused': // lo pausó el teléfono (otra app tomó el audio)
            if (!this._paused) { this._paused = true; this._run = false; this.pausedBy = 'focus'; this._fire('pause'); }
            break;
          case 'denied': // Android no dio el foco de audio (p. ej. durante una llamada)
            this._paused = true; this._run = false; this._fail('NotAllowedError', 'El teléfono no dejó reproducir ahora'); this._fire('pause');
            break;
          case 'ended':
            this._paused = true; this._ended = true; this._run = false;
            this._fire('timeupdate'); this._fire('pause'); this._fire('ended');
            break;
          case 'error':
            this._err = { code: x || 4, message: '' }; this._run = false; this._ready = 0;
            this._fail('NotSupportedError', 'La canción no se pudo reproducir'); this._fire('error');
            break;
        }
      }
    }
    // Constantes que app.js usa del <audio> (MediaError y networkState).
    NativeAudio.prototype.NETWORK_NO_SOURCE = 3;
    window.NanuqNativeAudio = NativeAudio;
    window.__nanuqAudio = function (id, gen, ev, pos, dur, x) {
      var a = players[id];
      if (!a || a.gen !== gen || a._html) return; // otra canción (o el <audio> de adentro): ese aviso ya no cuenta
      try { a._ev(ev, pos, dur, x); } catch (e) { }
    };
  }

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
