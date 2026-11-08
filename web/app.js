// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const VERSION = '1.44.4';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// JSON que llega de afuera (Jellyfin, SomeDL, la fiesta, tus otros dispositivos): sin claves «toString»/«valueOf»/«__proto__».
// Un objeto como {"toString": 1} hace fallar cualquier conversión a texto: un servidor podía dejar sin cargar todas las
// listas que tuvieran esa canción.
const jparse = t => JSON.parse(t, (k, v) => (k === 'toString' || k === 'valueOf' || k === '__proto__') ? undefined : v);
const str = v => { if (v == null) return ''; try { return String(v); } catch { return ''; } };
const esc = s => str(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Seguridad: lo que llega del servidor se limpia antes de usarlo en rutas de la API o en HTML.
// Los ids de Jellyfin son hexadecimales (con o sin guiones): cualquier otro carácter se descarta, así un id
// malicioso no puede salirse de su ruta («../») ni de un atributo HTML.
const sid = v => v == null || v === '' ? null : String(v).replace(/[^A-Za-z0-9-]/g, '') || null;
const num = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
const numOrNull = v => v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null);
// Imágenes que fallan (carátula inexistente, servidor caído): se quitan y queda el ícono de fondo. Antes era un
// onerror="…" en línea, que la CSP ya no permite (script-src sin 'unsafe-inline'). «error» no burbujea: se escucha en captura.
document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.hasAttribute('data-rm')) t.remove(); }, true);
// Textos fijos de index.html (botones, títulos y etiquetas del reproductor): se traducen una sola vez al cargar, antes de que
// haya datos tuyos en pantalla (un título de canción nunca pasa por aquí). Ver tx() en i18n.js.
(function txStatic() {
  if (LANG === 'es') return;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) if (n.nodeValue.trim() && !n.parentElement.closest('svg')) n.nodeValue = tx(n.nodeValue);
  for (const a of ['title', 'aria-label', 'placeholder']) document.querySelectorAll('[' + a + ']').forEach(e => e.setAttribute(a, tx(e.getAttribute(a))));
})();
const ic = (n, f) => `<svg class="i${f ? ' f' : ''}"><use href="#i-${n}"/></svg>`;
const fmt = t => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
// ---- Datos guardados en el dispositivo ----
// Lo que dice algo de ti (sesión, cola, conteo de reproducciones, DJ, pedidos, servidores, letras, id del dispositivo) va
// a un almacén CIFRADO del sistema cuando existe: en Linux, un archivo AES-256-GCM cuya clave guarda el llavero
// (GNOME Keyring / KWallet); en Android, AES-GCM con una clave del Android Keystore. Las preferencias de la interfaz
// (tema, volumen, órdenes) quedan en localStorage. En el navegador no hay almacén seguro: todo queda en localStorage.
const SENSITIVE = new Set(['party', 'lyrIdx', 'session', 'queue', 'plays', 'dj', 'djHist', 'libIdx', 'mp3ids', 'somedlReqs', 'somedl', 'somedlLast', 'servers', 'lastServer', 'device']);
const isSensitive = k => SENSITIVE.has(k) || k.startsWith('lrc.') || k.startsWith('history.');
// kind: nombre del almacén si funciona; 'locked' si hay datos cifrados que ahora no se pueden abrir (Keystore o llavero
// que todavía no arranca: se reintenta); 'lost' si ya no se podrán abrir nunca (la clave se perdió: se ofrece empezar
// de cero); null si no hay almacén. Mientras no esté abierto, lo nuevo vive solo en memoria (mem) y nada va en claro.
const SEC = (() => {
  const A = window.NanuqAndroid, D = window.nanuqDesktop && window.nanuqDesktop.secure;
  const s = D || (A && A.secKind ? { kind: () => A.secKind(), get: k => A.secGet(k), set: (k, v) => A.secSet(k, v), del: k => A.secDel(k), reset: () => Promise.resolve(A.secReset ? A.secReset() : null) } : null);
  const read = () => { try { return s ? s.kind() || null : null; } catch { return null; } };
  const S = { s, kind: read(), mem: new Map(), dels: new Set(), ok: () => !!S.kind && S.kind !== 'locked' && S.kind !== 'lost',
    shut: () => S.kind === 'locked' || S.kind === 'lost' };
  // Vuelve a preguntar (el almacén nativo reintenta abrirse). Al abrirse, lo guardado en memoria mientras tanto se escribe.
  S.refresh = () => { const was = S.ok(); S.kind = read(); if (!was && S.ok()) S.flushMem(); return S.kind; };
  S.flushMem = () => { try { for (const k of S.dels) S.s.del(k); for (const [k, v] of S.mem) if (S.s.get(k) == null || S.memDirty.has(k)) S.s.set(k, v); } catch { } S.dels.clear(); S.memDirty.clear(); secMigrate(); };
  S.memDirty = new Set();
  return S;
})();
const store = {
  get(k, d) {
    try {
      if (SEC.kind && isSensitive(k)) {
        let v = SEC.mem.has(k) ? SEC.mem.get(k) : SEC.ok() ? SEC.s.get(k) : null;
        if (v == null && SEC.ok()) { const old = localStorage.getItem('nanuq.' + k); if (old != null) { SEC.s.set(k, old); localStorage.removeItem('nanuq.' + k); v = old; } }
        if (v == null) return d;
        SEC.mem.set(k, v);
        return JSON.parse(v);
      }
      const v = localStorage.getItem('nanuq.' + k); return v == null ? d : JSON.parse(v);
    } catch { return d; }
  },
  set(k, v) {
    try {
      if (SEC.kind && isSensitive(k)) {
        const j = JSON.stringify(v); SEC.mem.set(k, j); SEC.dels.delete(k);
        // Si el almacén está cerrado, solo en memoria: nada nuevo en claro, y lo que ya existía no se toca.
        if (SEC.ok()) { SEC.s.set(k, j); localStorage.removeItem('nanuq.' + k); } else SEC.memDirty.add(k);
        return;
      }
      localStorage.setItem('nanuq.' + k, JSON.stringify(v));
    } catch { }
  },
  del(k) { try { SEC.mem.delete(k); SEC.memDirty.delete(k); if (SEC.ok() && isSensitive(k)) SEC.s.del(k); else if (SEC.kind && isSensitive(k)) SEC.dels.add(k); localStorage.removeItem('nanuq.' + k); } catch { } }
};
// Al abrir: lo que versiones anteriores dejaron en claro pasa al almacén cifrado.
function secMigrate() {
  if (!SEC.ok()) return;
  try {
    for (const full of Object.keys(localStorage)) {
      if (!full.startsWith('nanuq.')) continue;
      const k = full.slice(6); if (!isSensitive(k)) continue;
      if (SEC.s.get(k) == null) SEC.s.set(k, localStorage.getItem(full));
      localStorage.removeItem(full);
    }
  } catch { }
}
secMigrate();
// Sesión de Jellyfin: va al almacén de arriba (cifrada si existe).
const Vault = {
  get kind() { return SEC.ok() ? SEC.kind : null; },
  // Arranque en frío: el Keystore de Android o el llavero del escritorio a veces tardan en estar listos (por ejemplo,
  // si Nanuq se abre solo al iniciar sesión). Antes de dar la sesión por perdida se reintenta unos segundos.
  async init() {
    for (let k = 0; k < 5 && SEC.kind === 'locked'; k++) { await new Promise(r => setTimeout(r, 700 + k * 500)); SEC.refresh(); }
  },
  async save(cfg) { store.set('session', cfg); },
  async load() {
    const c = store.get('session', null);
    if (!c && SEC.shut()) return { kind: 'jellyfin', token: '', locked: true };
    return c;
  },
  // «Empezar de cero»: los datos cifrados que ya no se pueden abrir se apartan (no se borran sin más) y se crea un
  // almacén nuevo. Lo que se hizo en esta sesión (en memoria) se guarda en el nuevo.
  async reset() {
    if (!SEC.s || !SEC.s.reset) return null;
    try { await SEC.s.reset(); } catch { }
    SEC.kind = null; SEC.refresh();
    if (SEC.ok()) { for (const k of SEC.memDirty) SEC.mem.has(k) && SEC.s.set(k, SEC.mem.get(k)); SEC.memDirty.clear(); SEC.dels.clear(); }
    return SEC.kind;
  }
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');
const deviceId = () => { let d = store.get('device'); if (!d) { d = uid(); store.set('device', d); } return d; };
const deviceName = () => /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : /Mac/i.test(navigator.userAgent) ? 'Mac' : /Linux/i.test(navigator.userAgent) ? 'Linux' : /Win/i.test(navigator.userAgent) ? 'Windows' : 'Navegador';

/* =========================================================
   Server address parsing (IPv4, IPv6, hostnames)
   ========================================================= */
function parseServer(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error(tx('Escribe la dirección del servidor'));
  let scheme = null;
  const m = s.match(/^([a-z]+):\/\//i);
  if (m) {
    scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') throw new Error(tx('Usa http:// o https://'));
    s = s.slice(m[0].length);
  }
  let host, port = '', path = '';
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) throw new Error(tx('Falta el corchete de cierre «]» en la dirección IPv6'));
    host = s.slice(1, end);
    let rest = s.slice(end + 1);
    const pm = rest.match(/^:(\d{1,5})/);
    if (pm) { port = pm[1]; rest = rest.slice(pm[0].length); }
    else if (rest.startsWith(':')) throw new Error(tx('Puerto no válido'));
    if (rest && !rest.startsWith('/')) throw new Error(tx('Dirección no válida después de «]»'));
    path = rest;
  } else {
    const slash = s.indexOf('/');
    const hp = slash < 0 ? s : s.slice(0, slash);
    path = slash < 0 ? '' : s.slice(slash);
    const colons = (hp.match(/:/g) || []).length;
    if (colons >= 2) host = hp;               // IPv6 sin corchetes
    else if (colons === 1) { [host, port] = hp.split(':'); if (!/^\d{1,5}$/.test(port)) throw new Error(tx('Puerto no válido')); }
    else host = hp;
  }
  if (!host) throw new Error(tx('Falta el nombre o la IP del servidor'));
  const v6 = host.includes(':');
  if (v6) {
    if (host.includes('%')) throw new Error(tx('Los navegadores no aceptan direcciones IPv6 con zona (%wlan0, %eth0). Usa una dirección global (2xxx:) o ULA (fdxx:), o un nombre de host.'));
    if (/^fe[89ab]/i.test(host)) throw new Error(tx('Las direcciones de enlace local (fe80::) no funcionan en el navegador. Usa la IPv6 global o ULA (fdxx:) del servidor.'));
    try { new URL('http://[' + host + ']/'); } catch { throw new Error(tx('La dirección IPv6 no es válida')); }
  }
  if (port && (+port < 1 || +port > 65535)) throw new Error(tx('El puerto debe estar entre 1 y 65535'));
  const v4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIP = v6 || v4;
  // Sin esquema ni puerto: se asumen los puertos por defecto de Jellyfin para IPs y nombres cortos de la red local.
  const implicit = !scheme;
  if (!scheme) scheme = location.protocol === 'https:' ? 'https' : 'http';
  if (implicit && !port && (isIP || (!host.includes('.') && host !== 'localhost'))) port = scheme === 'https' ? '8920' : '8096';
  const hostPart = v6 ? '[' + host + ']' : host;
  let url;
  try { url = new URL(scheme + '://' + hostPart + (port ? ':' + port : '') + path); } catch { throw new Error(tx('La dirección no es válida')); }
  const base = (url.origin + url.pathname).replace(/\/+$/, '');
  const mixed = location.protocol === 'https:' && scheme === 'http' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return { base, v6, isIP, scheme, mixed, host: url.hostname };
}

/* =========================================================
   Jellyfin API
   ========================================================= */
class Jellyfin {
  constructor(cfg) { Object.assign(this, { base: cfg.base, token: cfg.token || '', userId: sid(cfg.userId) || '', userName: cfg.userName || '', serverName: cfg.serverName || '', version: cfg.version || '' }); this.kind = 'jellyfin'; }
  authHeader() { return `MediaBrowser Client="Nanuq", Device="${deviceName()}", DeviceId="${deviceId()}", Version="${VERSION}"` + (this.token ? `, Token="${this.token}"` : ''); }
  // Tiempo límite: sin él, una petición sobre una conexión muerta (red que se cayó, VPN sin red debajo) se queda colgada
  // para siempre, y lo que la espera (la búsqueda de dispositivos, una vista) nunca vuelve a intentar aunque el
  // servidor ya responda.
  async req(path, { method = 'GET', body, params, timeout = 45000 } = {}) {
    const u = new URL(this.base + path);
    if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
    let r;
    try {
      r = await fetch(u, { method, cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined, headers: { 'Authorization': this.authHeader(), 'Accept': 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw netError(this.base); }
    if (r.status === 401) {
      // Cualquier 401 con tu sesión (venga de una vista, del control remoto o de una petición en segundo plano) se
      // confirma con una segunda consulta; si de verdad venció, se detiene todo y se pide entrar.
      if (this === api && this.token) sessionGone().then(g => { if (g) sessionExpired(); });
      const e = new Error(tx('Usuario o contraseña incorrectos, o la sesión expiró.')); e.code = 401; throw e;
    }
    if (r.status === 404) { const e = new Error(tx('No encontrado (404)')); e.code = 404; throw e; }
    if (!r.ok) throw new Error(tx('El servidor respondió con el error ') + r.status);
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? jparse(await r.text()) : null;
  }
  async alt(paths, opts) { let last; for (const p of paths) { try { return await this.req(p, opts); } catch (e) { last = e; if (e.code !== 404) throw e; } } throw last; }
  static async probe(base) {
    let r;
    try { r = await fetch(base + '/System/Info/Public', { headers: { Accept: 'application/json' } }); } catch { throw netError(base); }
    if (!r.ok) throw new Error(tx('Se encontró algo en esa dirección, pero no parece Jellyfin (error ') + r.status + ').');
    const d = await r.text().then(jparse).catch(() => null);
    if (!d || !d.Id) throw new Error(tx('Esa dirección no respondió como un servidor Jellyfin.'));
    return { serverName: d.ServerName, version: d.Version, id: d.Id };
  }
  async login(user, pw) {
    const d = await this.req('/Users/AuthenticateByName', { method: 'POST', body: { Username: user, Pw: pw } });
    this.token = String(d.AccessToken || ''); this.userId = sid(d.User && d.User.Id) || ''; this.userName = String(d.User && d.User.Name || '');
  }
  cfg() { return { kind: 'jellyfin', base: this.base, token: this.token, userId: this.userId, userName: this.userName, serverName: this.serverName, version: this.version }; }
  map(x) {
    const T = x.Type;
    const type = T === 'Audio' ? 'track' : T === 'MusicAlbum' ? 'album' : T === 'MusicArtist' ? 'artist' : T === 'Playlist' ? 'playlist' : (T === 'MusicGenre' || T === 'Genre') ? 'genre' : x.IsFolder ? 'folder' : 'other';
    let imgId = null, imgTag = null;
    if (x.ImageTags && x.ImageTags.Primary) { imgId = sid(x.Id); imgTag = sid(x.ImageTags.Primary); }
    else if (x.AlbumId && x.AlbumPrimaryImageTag) { imgId = sid(x.AlbumId); imgTag = sid(x.AlbumPrimaryImageTag); }
    const aa = (x.AlbumArtists && x.AlbumArtists[0]) || (x.ArtistItems && x.ArtistItems[0]);
    return {
      id: sid(x.Id), name: String(x.Name || tx('Sin título')), type,
      artist: x.AlbumArtist || (x.Artists || []).join(', '), albumArtist: String(x.AlbumArtist || ''), trackArtist: (x.Artists || []).join(', ') || x.AlbumArtist || '',
      artistId: aa ? sid(aa.Id) : null, album: String(x.Album || ''), albumId: sid(x.AlbumId), year: numOrNull(x.ProductionYear),
      duration: x.RunTimeTicks ? num(x.RunTimeTicks) / 1e7 : 0, index: numOrNull(x.IndexNumber), disc: numOrNull(x.ParentIndexNumber),
      genres: Array.isArray(x.Genres) ? x.Genres.filter(g => typeof g === 'string').slice(0, 30) : [], count: numOrNull(x.ChildCount ?? x.AlbumCount), imgId, imgTag, mediaType: x.MediaType,
      fav: !!(x.UserData && x.UserData.IsFavorite), plays: num(x.UserData && x.UserData.PlayCount),
      lastPlayed: (x.UserData && x.UserData.LastPlayedDate) ? Date.parse(x.UserData.LastPlayedDate) || 0 : 0,
      added: x.DateCreated ? Date.parse(x.DateCreated) || 0 : 0,
      hasLyrics: x.HasLyrics === true ? true : x.HasLyrics === false ? false : null // Jellyfin 10.9+: si la canción tiene letra
    };
  }
  async items(p) {
    const d = await this.req('/Items', { params: { userId: this.userId, Recursive: true, Fields: 'PrimaryImageAspectRatio,ProductionYear,Genres,ChildCount,ParentId', EnableImageTypes: 'Primary', ImageTypeLimit: 1, ...p } });
    return { items: (d.Items || []).map(x => this.map(x)), total: d.TotalRecordCount ?? (d.Items || []).length };
  }
  albums({ start = 0, limit = 100, sort = 'name' } = {}) {
    const S = { name: ['SortName', 'Ascending'], artist: ['AlbumArtist,SortName', 'Ascending'], recent: ['DateCreated,SortName', 'Descending'], year: ['ProductionYear,SortName', 'Descending'], random: ['Random', 'Ascending'] }[sort] || ['SortName', 'Ascending'];
    return this.items({ IncludeItemTypes: 'MusicAlbum', SortBy: S[0], SortOrder: S[1], StartIndex: start, Limit: limit });
  }
  async item(id) { id = sid(id); return this.map(await this.alt(['/Items/' + id, `/Users/${this.userId}/Items/${id}`], { params: { userId: this.userId } })); }
  async album(id) {
    const [album, t] = await Promise.all([this.item(id), this.items({ ParentId: id, IncludeItemTypes: 'Audio', SortBy: 'ParentIndexNumber,IndexNumber,SortName' })]);
    return { album, tracks: t.items };
  }
  async artists({ start = 0, limit = 100 } = {}) {
    const d = await this.req('/Artists/AlbumArtists', { params: { userId: this.userId, StartIndex: start, Limit: limit, SortBy: 'SortName', Fields: 'PrimaryImageAspectRatio,ChildCount', EnableImageTypes: 'Primary', ImageTypeLimit: 1 } });
    return { items: (d.Items || []).map(x => this.map(x)), total: d.TotalRecordCount ?? 0 };
  }
  // Jellyfin 10.11 a veces guarda un mismo artista con varios IDs; se prueban varios filtros y, al final, el nombre.
  artistFilters(id, name) {
    const f = [];
    if (id) f.push({ AlbumArtistIds: id }, { ArtistIds: id }, { ContributingArtistIds: id });
    if (name) f.push({ Artists: name });
    return f;
  }
  async firstNonEmpty(base, filters) {
    for (const f of filters) { try { const r = await this.items({ ...base, ...f }); if (r.items.length) return r.items; } catch (e) { if (e.code === 401) throw e; } }
    return [];
  }
  async artist(id, nameHint) {
    let artist = null;
    if (id) artist = await this.item(id).catch(e => { if (e.code === 401) throw e; return null; });
    const name = (artist && artist.name) || nameHint || '';
    if (!artist) artist = { id, name: name || tx('Artista'), type: 'artist', imgId: null };
    let albums = await this.firstNonEmpty({ IncludeItemTypes: 'MusicAlbum', SortBy: 'ProductionYear,SortName', SortOrder: 'Descending' }, this.artistFilters(id, name));
    if (!albums.length) {
      // Último recurso: armar los álbumes a partir de las canciones del artista.
      const tracks = await this.artistTracks(id, name);
      const m = new Map();
      for (const t of tracks) if (t.albumId && !m.has(t.albumId)) m.set(t.albumId, { id: t.albumId, name: t.album || tx('Sin álbum'), type: 'album', artist: t.artist, artistId: id, year: t.year, imgId: t.imgId, imgTag: t.imgTag, genres: [] });
      albums = [...m.values()].sort((a, b) => (b.year || 0) - (a.year || 0));
    }
    return { artist, albums };
  }
  async artistTracks(id, name) {
    if (!name && id) name = (await this.item(id).catch(() => null))?.name || '';
    const f = this.artistFilters(id, name);
    const order = [f.find(x => x.ArtistIds), f.find(x => x.AlbumArtistIds), f.find(x => x.ContributingArtistIds), f.find(x => x.Artists)].filter(Boolean);
    return this.firstNonEmpty({ IncludeItemTypes: 'Audio', SortBy: 'Album,ParentIndexNumber,IndexNumber', Limit: 1000 }, order);
  }
  // Jellyfin cambia según versión dónde expone los géneros de música: se prueban varias rutas
  // y, si ninguna responde, se sacan de los propios álbumes.
  async genres() {
    const base = { userId: this.userId, Recursive: true, SortBy: 'SortName', Fields: 'ChildCount' };
    const tries = [['/MusicGenres', {}], ['/Genres', { IncludeItemTypes: 'MusicAlbum' }], ['/Genres', { IncludeItemTypes: 'Audio' }], ['/Genres', {}]];
    for (const [path, extra] of tries) {
      try {
        const d = await this.req(path, { params: { ...base, ...extra } });
        const l = (d && d.Items || []).map(x => ({ ...this.map(x), type: 'genre' })).filter(g => g.name);
        if (l.length) return l;
      } catch (e) { if (e.code === 401) throw e; }
    }
    const counts = new Map(); let start = 0, total = Infinity;
    while (start < total && start < 6000) {
      const d = await this.req('/Items', { params: { userId: this.userId, Recursive: true, IncludeItemTypes: 'MusicAlbum', Fields: 'Genres', StartIndex: start, Limit: 1000, EnableImageTypes: 'None' } });
      const items = d.Items || []; total = d.TotalRecordCount ?? items.length; start += items.length;
      for (const it of items) for (const g of (it.Genres || [])) { const k = g.trim(); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
      if (!items.length) break;
    }
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([name, count]) => ({ id: 'name:' + name, name, type: 'genre', count, imgId: null }));
  }
  genreParam(ids) {
    const real = ids.filter(i => !String(i).startsWith('name:')), names = ids.filter(i => String(i).startsWith('name:')).map(i => i.slice(5));
    const p = {}; if (real.length) p.GenreIds = real.join(','); if (names.length) p.Genres = names.join('|');
    return p;
  }
  async genre(id, name) {
    const q = { IncludeItemTypes: 'MusicAlbum', SortBy: 'AlbumArtist,SortName' };
    let r = (await this.items({ ...q, ...this.genreParam([id]) })).items;
    if (!r.length && name) r = (await this.items({ ...q, Genres: name })).items;
    return r;
  }
  // Canciones de un género: la etiqueta suele estar en las canciones, no en el álbum.
  async genreTracks(id, name, albums = []) {
    const q = { IncludeItemTypes: 'Audio', SortBy: 'AlbumArtist,Album,ParentIndexNumber,IndexNumber', Limit: 1500 };
    const tries = [this.genreParam([id])];
    if (name) tries.push({ Genres: name });
    for (const t of tries) { try { const r = (await this.items({ ...q, ...t })).items; if (r.length) return r; } catch (e) { if (e.code === 401) throw e; } }
    const out = [];
    for (const a of albums.slice(0, 30)) out.push(...(await this.items({ ParentId: a.id, IncludeItemTypes: 'Audio', SortBy: 'ParentIndexNumber,IndexNumber,SortName' })).items);
    return out;
  }
  async playlists() { return (await this.items({ IncludeItemTypes: 'Playlist', SortBy: 'SortName', Fields: 'ChildCount,MediaType' })).items.filter(p => p.mediaType !== 'Video'); }
  async playlist(id) {
    const [playlist, d] = await Promise.all([this.item(id), this.req('/Playlists/' + sid(id) + '/Items', { params: { userId: this.userId, Fields: 'PrimaryImageAspectRatio,ProductionYear', EnableImageTypes: 'Primary' } })]);
    return { playlist, tracks: (d.Items || []).map(x => this.map(x)).filter(t => t.type === 'track') };
  }
  async views() {
    const d = await this.alt(['/UserViews', `/Users/${this.userId}/Views`], { params: { userId: this.userId } });
    return (d.Items || []).filter(v => !v.CollectionType || v.CollectionType === 'music').map(x => ({ ...this.map(x), type: 'folder' }));
  }
  async folder(id) { return (await this.items({ ParentId: id, Recursive: false, SortBy: 'IsFolder,SortName' })).items; }
  async search(q) {
    const [it, ar] = await Promise.all([
      this.items({ searchTerm: q, IncludeItemTypes: 'MusicAlbum,Audio', Limit: 80 }),
      this.req('/Artists', { params: { userId: this.userId, searchTerm: q, Limit: 20, Fields: 'PrimaryImageAspectRatio', EnableImageTypes: 'Primary' } }).catch(() => ({ Items: [] }))
    ]);
    return { artists: (ar.Items || []).map(x => this.map(x)), albums: it.items.filter(x => x.type === 'album'), tracks: it.items.filter(x => x.type === 'track') };
  }
  img(it, size = 300, remote = false) {
    if (!it || !it.imgId) return null;
    if (!remote) { const c = DL.coverUrl(it.imgId); if (c) return c; } // carátula guardada en el teléfono
    return `${this.base}/Items/${encodeURIComponent(it.imgId)}/Images/Primary?fillHeight=${num(size)}&fillWidth=${num(size)}&quality=90${it.imgTag ? '&tag=' + encodeURIComponent(it.imgTag) : ''}`;
  }
  streamUrl(t, br, session = P.session) {
    const q = new URLSearchParams({ UserId: this.userId, DeviceId: deviceId(), ApiKey: this.token, api_key: this.token, MaxStreamingBitrate: br, Container: 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg', TranscodingContainer: 'mp3', TranscodingProtocol: 'http', AudioCodec: 'mp3', PlaySessionId: session });
    return `${this.base}/Audio/${sid(t.id)}/universal?${q}`;
  }
  // Con calidad «Original», las canciones que no arrancaron en este reproductor se piden directo en MP3 (ver fallbackMp3).
  async stream(t) { return DL.localUrl(t.id) || PF.url(t.id) || this.streamUrl(t, +Settings.quality >= 1e7 && MP3.ids.has(t.id) ? 320000 : Settings.quality); }
  // Copia para guardar en el teléfono; Android la descarga con su propia sesión de reproducción.
  // Las descargas se guardan en MP3 (se reproduce en cualquier lado); con «Original», el archivo tal cual.
  dlUrl(t) {
    const br = +Settings.dlQuality;
    if (br >= 1e7) return this.streamUrl(t, br, 'dl' + uid());
    const q = new URLSearchParams({ UserId: this.userId, DeviceId: deviceId(), ApiKey: this.token, api_key: this.token, MaxStreamingBitrate: br, Container: 'mp3', TranscodingContainer: 'mp3', TranscodingProtocol: 'http', AudioCodec: 'mp3', PlaySessionId: 'dl' + uid() });
    return `${this.base}/Audio/${sid(t.id)}/universal?${q}`;
  }
  async peaks(t) {
    const r = await fetch(DL.localUrl(t.id) || this.streamUrl(t, 64000));
    if (!r.ok) throw new Error('wave');
    return peaksFromBuffer(await decode(await r.arrayBuffer()));
  }
  tracks({ start = 0, limit = 200, sort = 'name' } = {}) {
    const S = { name: ['SortName', 'Ascending'], artist: ['AlbumArtist,Album,ParentIndexNumber,IndexNumber', 'Ascending'], album: ['Album,ParentIndexNumber,IndexNumber', 'Ascending'], recent: ['DateCreated,SortName', 'Descending'], plays: ['PlayCount,SortName', 'Descending'], random: ['Random', 'Ascending'] }[sort] || ['SortName', 'Ascending'];
    return this.items({ IncludeItemTypes: 'Audio', SortBy: S[0], SortOrder: S[1], StartIndex: start, Limit: limit });
  }
  async lyrics(t) {
    let d;
    try { d = await this.req('/Audio/' + sid(t.id) + '/Lyrics'); } catch (e) { if (e.code === 404) return null; throw e; }
    return normLyrics((d && d.Lyrics) || [], d && d.Metadata && d.Metadata.IsSynced);
  }
  async mix(q, limit = 100) {
    const p = { IncludeItemTypes: 'Audio', Limit: limit, SortBy: q.sort || 'Random', SortOrder: q.order || 'Descending' };
    if (q.genreIds && q.genreIds.length) Object.assign(p, this.genreParam(q.genreIds));
    if (q.years) p.Years = q.years.join(',');
    if (q.filters) p.Filters = q.filters;
    return (await this.items(p)).items;
  }
  async uploadLyrics(t, text, ext = 'lrc') {
    const name = (String(t.name || 'letra').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[.\s]+/, '').slice(0, 100) || 'letra') + '.' + (ext === 'txt' ? 'txt' : 'lrc');
    let r;
    try { r = await fetch(`${this.base}/Audio/${sid(t.id)}/Lyrics?fileName=${encodeURIComponent(name)}`, { method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'text/plain; charset=utf-8' }, body: text }); }
    catch { throw netError(this.base); }
    if (!r.ok) { const e = new Error(tx('Jellyfin respondió ') + r.status); e.code = r.status; throw e; }
  }
  async searchLyrics(t) {
    const d = await this.req(`/Audio/${sid(t.id)}/RemoteSearch/Lyrics`);
    return (d || []).map(x => ({ id: x.Id, provider: x.ProviderName || tx('Proveedor'), L: normLyrics((x.Lyrics && x.Lyrics.Lyrics) || [], null) })).filter(x => x.L);
  }
  async pickLyrics(t, id) { await this.req(`/Audio/${sid(t.id)}/RemoteSearch/Lyrics/${encodeURIComponent(id)}`, { method: 'POST' }); }
  // Jellyfin 10.9+ usa /UserFavoriteItems; las versiones anteriores, /Users/{id}/FavoriteItems.
  async setFavorite(id, on) {
    id = sid(id);
    const d = await this.alt([`/UserFavoriteItems/${id}`, `/Users/${this.userId}/FavoriteItems/${id}`], { method: on ? 'POST' : 'DELETE', params: { userId: this.userId } });
    return d && typeof d.IsFavorite === 'boolean' ? d.IsFavorite : on;
  }
  // ¿Está en la sección de favoritas de Jellyfin? (el filtro IsFavorite, lo mismo que muestra su interfaz web)
  async inFavorites(id) { const r = await this.items({ Ids: id, IncludeItemTypes: 'Audio', Filters: 'IsFavorite' }); return r.items.some(t => t.id === sid(id)); }
  async isFavorite(id) {
    id = sid(id);
    const d = await this.alt(['/Items/' + id, `/Users/${this.userId}/Items/${id}`], { params: { userId: this.userId } });
    return !!(d && d.UserData && d.UserData.IsFavorite);
  }
  // La playlist que arma el plugin «Favorited Songs Playlist» (github.com/Saturn745/jellyfin-favorited-songs-playlist):
  // por omisión se llama «{Usuario}'s: Favorited Songs», con la primera letra del usuario en mayúscula.
  async favPlaylist() {
    const u = String(this.userName || '').toLowerCase(); if (!u) return null;
    const pls = await this.playlists().catch(() => []);
    const name = p => String(p.name || '').toLowerCase();
    return pls.find(p => name(p) === u + "'s: favorited songs")
      || pls.find(p => name(p).includes('favorited songs') && name(p).includes(u)) || null;
  }
  async favorites(sort = 'name') {
    // Tus favoritas son las que Jellyfin marca con ♥ (su filtro IsFavorite): la misma fuente que el botón del reproductor,
    // así la lista y el botón nunca se contradicen. Antes se leía la playlist del plugin «Favorited Songs», pero esa
    // copia puede quedar atrasada o distinta (justo después de un cambio la vacía y la rellena; y en un servidor real se
    // vio con una canción que Jellyfin ya no tenía como favorita). La playlist del plugin se sigue mostrando como enlace.
    const pl = await this.favPlaylist().catch(() => null);
    const S = { name: ['SortName', 'Ascending'], artist: ['AlbumArtist,Album,ParentIndexNumber,IndexNumber,SortName', 'Ascending'], album: ['Album,ParentIndexNumber,IndexNumber,SortName', 'Ascending'], recent: ['DateCreated,SortName', 'Descending'], plays: ['PlayCount,SortName', 'Descending'], played: ['DatePlayed,SortName', 'Descending'], random: ['Random', 'Ascending'] }[sort] || ['SortName', 'Ascending'];
    const out = []; let total = Infinity;
    while (out.length < total && out.length < 5000) {
      const r = await this.items({ IncludeItemTypes: 'Audio', Filters: 'IsFavorite', SortBy: S[0], SortOrder: S[1], StartIndex: out.length, Limit: 500 });
      out.push(...r.items); total = r.total; if (!r.items.length) break;
    }
    const l = out.filter(t => t.type === 'track').map(t => ({ ...t, fav: true }));
    for (const t of l) FAVK.set(t.id, true);
    l.source = pl ? pl.name : null; l.sourceId = pl ? pl.id : null;
    return l;
  }
  // Ruta anterior a 10.9 (sigue en 10.11 por compatibilidad): segundo intento si la nueva no guardó.
  setFavoriteLegacy(id, on) { return this.req(`/Users/${this.userId}/FavoriteItems/${sid(id)}`, { method: on ? 'POST' : 'DELETE' }); }
  // Radio de una canción: la «mezcla instantánea» de Jellyfin (canciones parecidas por artista, álbum y género).
  async instantMix(id, limit = 100) {
    id = sid(id);
    const d = await this.alt([`/Items/${id}/InstantMix`, `/Songs/${id}/InstantMix`], { params: { userId: this.userId, limit, Fields: 'PrimaryImageAspectRatio,ProductionYear,Genres', EnableImageTypes: 'Primary', ImageTypeLimit: 1 } });
    return (d && d.Items || []).map(x => this.map(x)).filter(t => t.type === 'track');
  }
  addToPlaylist(plId, ids) { return this.req(`/Playlists/${sid(plId)}/Items`, { method: 'POST', params: { ids: ids.join(','), userId: this.userId } }); }
  // Busca archivos nuevos en las bibliotecas (solo administradores).
  refreshLibrary() { return this.req('/Library/Refresh', { method: 'POST' }); }
  async savePlaylist(name, ids) { const d = await this.req('/Playlists', { method: 'POST', body: { Name: name, Ids: ids, UserId: this.userId, MediaType: 'Audio' } }); return d && d.Id; }
  report(kind, t, pos, paused) {
    if (!t || RC.remote) return;
    const path = { start: '/Sessions/Playing', progress: '/Sessions/Playing/Progress', stop: '/Sessions/Playing/Stopped' }[kind];
    this.req(path, { method: 'POST', body: { ItemId: t.id, PositionTicks: Math.floor((pos || 0) * 1e7), IsPaused: !!paused, CanSeek: true, PlayMethod: 'DirectStream', PlaySessionId: P.session, MediaSourceId: t.id, NowPlayingQueue: RC.queueForReport(), PlaylistItemId: t.qid || t.id, RepeatMode: { once: 'RepeatNone', all: 'RepeatAll', one: 'RepeatOne' }[P.mode] } })
      .then(() => favReassert(t, kind === 'stop')).catch(() => { });
  }
  logout() { return this.req('/Sessions/Logout', { method: 'POST' }).catch(() => { }); }
  // ---- Mis dispositivos (control remoto entre Nanuq a través de Jellyfin) ----
  // Jellyfin 10.10+ solo acepta «api_key» con la autorización heredada activada; «ApiKey» es el parámetro actual.
  wsUrl() { return this.base.replace(/^http/, 'ws') + '/socket?ApiKey=' + encodeURIComponent(this.token) + '&deviceId=' + encodeURIComponent(deviceId()); }
  postCapabilities() { return this.req('/Sessions/Capabilities/Full', { method: 'POST', body: { PlayableMediaTypes: ['Audio'], SupportedCommands: ['SetRepeatMode', 'SetShuffleQueue'], SupportsMediaControl: true, SupportsPersistentIdentifier: true } }).catch(() => { }); }
  // Sin «controllableByUserId»: así también aparecen los Nanuq que aún no pueden recibir órdenes (y se dice por qué).
  sessions() { return this.req('/Sessions', { params: { activeWithinSeconds: 960 }, timeout: 15000 }); }
  sessionCmd(id, cmd, params) { return this.req(`/Sessions/${sid(id)}/Playing/${encodeURIComponent(cmd)}`, { method: 'POST', params }); }
  sessionPlay(id, ids, startIndex, startTicks, playCommand = 'PlayNow') { return this.req(`/Sessions/${sid(id)}/Playing`, { method: 'POST', params: { playCommand, itemIds: ids.map(sid).filter(Boolean).join(','), startIndex, startPositionTicks: startTicks } }); }
  sessionGeneral(id, name, args) { return this.req(`/Sessions/${sid(id)}/Command`, { method: 'POST', body: { Name: name, Arguments: args || {} } }); }
  async itemsByIds(ids) {
    const out = new Map();
    for (let k = 0; k < ids.length; k += 100) (await this.items({ Ids: ids.slice(k, k + 100).join(',') })).items.forEach(t => out.set(t.id, t));
    return ids.map(id => out.get(id)).filter(Boolean);
  }
}
function netError(base) {
  const https = location.protocol === 'https:';
  const isHttp = base.startsWith('http:');
  let msg = tx('No se pudo conectar con ') + base + '.';
  if (https && isHttp) msg += tx(' Esta app se abrió por HTTPS y el navegador bloquea servidores http:// (contenido mixto). Usa la dirección https:// de tu servidor, o abre Nanuq desde una dirección http:// en tu red.');
  else msg += tx(' Revisa que el servidor esté encendido, que la dirección y el puerto sean correctos y que tu red tenga conectividad IPv6 si usas una IPv6.');
  return new Error(msg);
}

function normLyrics(arr, isSynced) {
  let lines = arr.map(l => ({ t: l.Start != null ? l.Start / 1e7 : null, text: String(l.Text ?? '').trim() }));
  const timed = lines.filter(l => l.t != null && isFinite(l.t));
  const synced = timed.length >= 2 && new Set(timed.map(l => l.t)).size > 1;
  if (synced) lines = lines.filter(l => l.t != null).sort((a, b) => a.t - b.t);
  else lines = lines.flatMap(l => l.text.split(/\r?\n/)).map(text => ({ t: null, text: text.trim() }));
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  if (!lines.some(l => l.text)) return null;
  return { synced, lines };
}

/* =========================================================
   Audio helpers (waveforms, demo synth)
   ========================================================= */
let _actx;
function actx() { if (!_actx) { const C = window.AudioContext || window.webkitAudioContext; _actx = new C(); } return _actx; }
function decode(buf) { return new Promise((res, rej) => { const p = actx().decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }); }
function peaksFromBuffer(ab, n = 800) {
  const ch = ab.getChannelData(0), step = Math.max(1, Math.floor(ch.length / n)), out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) { let m = 0; const s = i * step, e = Math.min(ch.length, s + step); for (let j = s; j < e; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; } out[i] = m; if (m > max) max = m; }
  if (max > 0) for (let i = 0; i < n; i++) out[i] = Math.pow(out[i] / max, 0.8);
  return out;
}
function rng(seed) { let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function wav(ab) {
  const ch = ab.getChannelData(0), sr = ab.sampleRate, n = ch.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, ch[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([b], { type: 'audio/wav' });
}
async function synth(seed, dur) {
  const sr = 22050, C = window.OfflineAudioContext || window.webkitOfflineAudioContext, ctx = new C(1, Math.floor(sr * dur), sr), r = rng(seed);
  const master = ctx.createGain(); master.gain.value = 0.32;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800 + r() * 1800; lp.Q.value = 0.6;
  master.connect(lp); lp.connect(ctx.destination);
  const root = 110 * Math.pow(2, Math.floor(r() * 7) / 12);
  const scale = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];
  const progs = [[0, 5, 3, 4], [0, 3, 5, 4], [0, 4, 5, 3], [5, 3, 0, 4]];
  const prog = progs[Math.floor(r() * progs.length)];
  const bars = 8, bar = dur / bars;
  const f = st => root * Math.pow(2, st / 12);
  for (let b = 0; b < bars; b++) {
    const deg = prog[b % 4], t0 = b * bar;
    for (const k of [0, 2, 4]) {
      const st = scale[(deg + k) % scale.length] + (deg + k >= scale.length ? 12 : 0);
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = k === 0 ? 'triangle' : 'sine'; o.frequency.value = f(st); o.detune.value = det;
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.09, t0 + bar * 0.35); g.gain.linearRampToValueAtTime(0.0001, t0 + bar * 1.05);
        o.connect(g); g.connect(master); o.start(t0); o.stop(Math.min(dur, t0 + bar * 1.1));
      }
    }
    const steps = 8, sl = bar / steps, intensity = Math.sin(Math.PI * (b + 0.5) / bars);
    for (let i = 0; i < steps; i++) {
      if (r() > 0.35 + 0.5 * intensity) continue;
      const st = scale[(deg + [0, 2, 4, 7][Math.floor(r() * 4)]) % scale.length] + 12, t = t0 + i * sl;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f(st);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * intensity + 0.04, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + sl * 1.8);
      o.connect(g); g.connect(master); o.start(t); o.stop(Math.min(dur, t + sl * 2));
    }
    const k = ctx.createOscillator(), kg = ctx.createGain();
    k.frequency.setValueAtTime(90, t0); k.frequency.exponentialRampToValueAtTime(40, t0 + 0.25);
    kg.gain.setValueAtTime(0.5 * intensity, t0); kg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    k.connect(kg); kg.connect(master); k.start(t0); k.stop(t0 + 0.45);
  }
  master.gain.setValueAtTime(0.32, dur - 1.5); master.gain.linearRampToValueAtTime(0, dur);
  return ctx.startRendering();
}

/* =========================================================
   Demo library (works offline, no server needed)
   ========================================================= */
class Demo {
  constructor() {
    this.kind = 'demo'; this.serverName = tx('Biblioteca demo'); this.version = VERSION; this.userName = 'demo'; this.base = 'demo';
    const r = rng('nanuq');
    const genres = ['Ambient', 'Electrónica', 'Downtempo', 'Neoclásica', 'Post-rock'];
    const data = [
      ['Lumen Drift', [['Glaciar', 2021], ['Horizonte Blanco', 2023]]],
      ['Aurora Fields', [['Noches Boreales', 2019], ['Deshielo', 2022]]],
      ['Tundra Echo', [['Permafrost', 2020]]],
      ['Marea Lenta', [['Costa Norte', 2018], ['Bruma', 2024]]],
      ['Kestrel', [['Altitud', 2017]]],
      ['Nordlys', [['Estrella Polar', 2025]]]
    ];
    const words = ['Hielo', 'Aliento', 'Corriente', 'Silencio', 'Brillo', 'Océano', 'Nieve fina', 'Distancia', 'Faro', 'Viento solar', 'Cristal', 'Latitud', 'Polaris', 'Ártico', 'Sombra azul', 'Deriva', 'Luz tenue', 'Témpano', 'Calma', 'Reflejo', 'Norte', 'Vapor', 'Ecos', 'Abismo', 'Amanecer', 'Escarcha'];
    this.artistsList = []; this.albumsList = []; this.tracksList = []; this.playlistsList = [];
    this.genresList = genres.map((g, i) => ({ id: 'g' + i, name: g, type: 'genre', imgId: null }));
    data.forEach(([an, albums], ai) => {
      const arId = 'ar' + ai;
      this.artistsList.push({ id: arId, name: an, type: 'artist', imgId: 'art:' + arId, count: albums.length });
      albums.forEach(([title, year], bi) => {
        const alId = `al${ai}_${bi}`, g = genres[Math.floor(r() * genres.length)];
        const al = { id: alId, name: title, type: 'album', artist: an, artistId: arId, year, genres: [g], imgId: 'cov:' + alId, count: 0 };
        const n = 5 + Math.floor(r() * 4);
        for (let k = 0; k < n; k++) {
          const t = { id: `${alId}_t${k}`, name: words[Math.floor(r() * words.length)] + (r() > 0.7 ? ' (' + ['Reprise', 'Interludio', 'Versión larga'][Math.floor(r() * 3)] + ')' : ''), type: 'track', artist: an, trackArtist: an, artistId: arId, album: title, albumId: alId, year, index: k + 1, disc: 1, duration: 36 + Math.floor(r() * 40), imgId: al.imgId, genres: [g] };
          this.tracksList.push(t);
        }
        al.count = n; al.duration = this.tracksList.filter(t => t.albumId === alId).reduce((a, t) => a + t.duration, 0);
        this.albumsList.push(al);
      });
    });
    this.albumsList.sort((a, b) => a.name.localeCompare(b.name));
    const pick = (k) => { const o = []; const rr = rng('pl' + k); for (let i = 0; i < 9; i++) o.push(this.tracksList[Math.floor(rr() * this.tracksList.length)]); return o; };
    this.playlistsList = [{ id: 'pl0', name: 'Para concentrarse', type: 'playlist', tracks: pick(0) }, { id: 'pl1', name: 'Noche polar', type: 'playlist', tracks: pick(1) }].map(p => ({ ...p, count: p.tracks.length, imgId: p.tracks[0].imgId }));
    this.blobs = new Map(); this.buffers = new Map();
  }
  cfg() { return { kind: 'demo' }; }
  wait(v) { return new Promise(r => setTimeout(() => r(v), 120)); }
  albums({ start = 0, limit = 100, sort = 'name' } = {}) {
    let l = [...this.albumsList];
    if (sort === 'year') l.sort((a, b) => b.year - a.year); else if (sort === 'artist') l.sort((a, b) => a.artist.localeCompare(b.artist)); else if (sort === 'random') l.sort(() => Math.random() - .5); else if (sort === 'recent') l.reverse();
    return this.wait({ items: l.slice(start, start + limit), total: l.length });
  }
  album(id) { return this.wait({ album: this.albumsList.find(a => a.id === id), tracks: this.tracksList.filter(t => t.albumId === id) }); }
  artists() { return this.wait({ items: this.artistsList, total: this.artistsList.length }); }
  // Como en Jellyfin: por id o, si no hay, por nombre.
  artistBy(id, name) { return this.artistsList.find(a => a.id === id) || this.artistsList.find(a => name && a.name === name); }
  artist(id, name) { const ar = this.artistBy(id, name); return this.wait({ artist: ar, albums: ar ? this.albumsList.filter(a => a.artistId === ar.id).sort((a, b) => b.year - a.year) : [] }); }
  artistTracks(id, name) { const ar = this.artistBy(id, name); return this.wait(ar ? this.tracksList.filter(t => t.artistId === ar.id) : []); }
  genres() { return this.wait(this.genresList.map(g => ({ ...g, count: this.albumsList.filter(a => a.genres.includes(g.name)).length })).filter(g => g.count)); }
  genreTracks(id) { const g = this.genresList.find(x => x.id === id); return this.wait(this.tracksList.filter(t => t.genres.includes(g.name))); }
  genre(id) { const g = this.genresList.find(x => x.id === id); return this.wait(this.albumsList.filter(a => a.genres.includes(g.name))); }
  playlists() { return this.wait(this.playlistsList); }
  playlist(id) { const p = this.playlistsList.find(x => x.id === id); return this.wait({ playlist: p, tracks: p.tracks }); }
  views() { return this.wait([{ id: 'root', name: 'Música', type: 'folder', imgId: null }]); }
  folder(id) {
    if (id === 'root') return this.wait(this.artistsList.map(a => ({ ...a, type: 'folder', imgId: null })));
    if (id.startsWith('ar')) return this.wait(this.albumsList.filter(a => a.artistId === id).map(a => ({ ...a, type: 'folder' })));
    return this.wait(this.tracksList.filter(t => t.albumId === id));
  }
  search(q) {
    const n = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); const k = n(q);
    return this.wait({ artists: this.artistsList.filter(a => n(a.name).includes(k)), albums: this.albumsList.filter(a => n(a.name).includes(k) || n(a.artist).includes(k)), tracks: this.tracksList.filter(t => n(t.name).includes(k)).slice(0, 50) });
  }
  img(it) {
    if (!it || !it.imgId) return null;
    if (this._img && this._img.has(it.imgId)) return this._img.get(it.imgId);
    this._img = this._img || new Map();
    const r = rng(it.imgId), hue = Math.floor(r() * 360), h2 = (hue + 30 + r() * 60) % 360, round = it.imgId.startsWith('art:');
    let shapes = '';
    const kind = Math.floor(r() * 3);
    if (round) shapes = `<circle cx="150" cy="120" r="46" fill="hsla(${h2},60%,85%,.5)"/><path d="M60 270c10-60 50-90 90-90s80 30 90 90" fill="hsla(${h2},60%,85%,.4)"/>`;
    else if (kind === 0) for (let i = 0; i < 6; i++) shapes += `<path d="M0 ${170 + i * 22} Q75 ${150 + i * 22 - r() * 40} 150 ${170 + i * 22} T300 ${170 + i * 22}" stroke="hsla(${h2},70%,88%,${.15 + i * .08})" stroke-width="2" fill="none"/>`;
    else if (kind === 1) shapes = `<circle cx="${90 + r() * 120}" cy="${80 + r() * 60}" r="${40 + r() * 40}" fill="hsla(${h2},80%,90%,.55)"/><path d="M0 230 L${80 + r() * 60} ${150 + r() * 40} L${170 + r() * 40} 210 L230 160 L300 220 V300 H0Z" fill="hsla(${hue},40%,12%,.55)"/>`;
    else for (let i = 0; i < 40; i++) shapes += `<circle cx="${r() * 300}" cy="${r() * 300}" r="${r() * 1.8 + .3}" fill="#fff" opacity="${r()}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,42%)"/><stop offset="1" stop-color="hsl(${h2},60%,18%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/>${shapes}</svg>`;
    const u = 'data:image/svg+xml,' + encodeURIComponent(svg); this._img.set(it.imgId, u); return u;
  }
  async buf(t) { if (!this.buffers.has(t.id)) this.buffers.set(t.id, synth(t.id, t.duration)); return this.buffers.get(t.id); }
  async stream(t) { if (!this.blobs.has(t.id)) { const b = await this.buf(t); this.blobs.set(t.id, URL.createObjectURL(wav(b))); } return this.blobs.get(t.id); }
  async peaks(t) { return peaksFromBuffer(await this.buf(t)); }
  tracks({ start = 0, limit = 200, sort = 'name' } = {}) {
    let l = [...this.tracksList];
    const c = (a, b) => String(a || '').localeCompare(String(b || ''));
    if (sort === 'name') l.sort((a, b) => c(a.name, b.name)); else if (sort === 'artist') l.sort((a, b) => c(a.artist, b.artist) || c(a.album, b.album) || a.index - b.index); else if (sort === 'album') l.sort((a, b) => c(a.album, b.album) || a.index - b.index); else if (sort === 'recent') l.reverse(); else if (sort === 'random') l.sort(() => Math.random() - .5);
    return this.wait({ items: l.slice(start, start + limit), total: l.length });
  }
  mix(q, limit = 100) {
    let l = [...this.tracksList];
    if (q.genreIds && q.genreIds.length) { const names = this.genresList.filter(g => q.genreIds.includes(g.id)).map(g => g.name).concat(q.genreIds.filter(i => String(i).startsWith('name:')).map(i => i.slice(5))); l = l.filter(t => t.genres.some(g => names.includes(g))); }
    if (q.years) l = l.filter(t => q.years.includes(t.year));
    if (q.filters === 'IsFavorite') l = l.filter(t => /a/.test(t.name[1] || '')); // demo: algunas "favoritas"
    if (q.sort === 'DateCreated,SortName') l.reverse();
    else if (q.sort === 'DatePlayed,SortName' || q.sort === 'PlayCount,SortName') { const r = rng(q.sort); l = l.map(t => [r(), t]).sort((a, b) => a[0] - b[0]).map(x => x[1]); }
    else l.sort(() => Math.random() - .5);
    return this.wait(l.slice(0, limit));
  }
  lyrics(t) {
    const r = rng('ly' + t.id);
    const A = ['Camino sobre el hielo', 'Bajo la estrella polar', 'El viento cambia de nombre', 'Guardo tu voz en la nieve', 'La noche no termina aquí', 'Todo brilla en azul', 'Me sigue la marea', 'Cruzo el silencio contigo', 'Se apaga la ciudad', 'Hay un faro en tu mirada', 'Respiro el frío del norte', 'Y vuelvo a empezar'];
    const B = ['', ' otra vez', ' sin mirar atrás', ' hasta el amanecer', ' despacio', ' una vez más'];
    const lines = []; let tm = 2.5; const end = t.duration - 3;
    while (tm < end) {
      if (lines.length && r() < 0.12) { lines.push({ t: tm, text: '' }); tm += 3 + r() * 2; continue; }
      lines.push({ t: tm, text: A[Math.floor(r() * A.length)] + B[Math.floor(r() * B.length)] });
      tm += 2.6 + r() * 2.4;
    }
    return this.wait({ synced: true, lines });
  }
  async setFavorite(id, on) { this.favs = this.favs || new Set(); if (on) this.favs.add(id); else this.favs.delete(id); return on; }
  async isFavorite(id) { return !!(this.favs && this.favs.has(id)); }
  async inFavorites(id) { return this.isFavorite(id); }
  async favorites() { const f = this.favs || new Set(); return this.wait(this.tracksList.filter(t => f.has(t.id)).map(t => ({ ...t, fav: true }))); }
  async instantMix(id) { const t = this.tracksList.find(x => x.id === id); const g = t && t.genres[0]; return this.wait(this.tracksList.filter(x => x.id !== id && (!g || x.genres.includes(g))).sort(() => Math.random() - .5).slice(0, 40)); }
  async addToPlaylist(plId, ids) { const p = this.playlistsList.find(x => x.id === plId); if (p) { p.tracks.push(...ids.map(i => this.tracksList.find(t => t.id === i)).filter(Boolean)); p.count = p.tracks.length; } }
  async savePlaylist(name, ids) { const tracks = ids.map(id => this.tracksList.find(t => t.id === id)).filter(Boolean); this.playlistsList.push({ id: 'pl' + Date.now(), name, type: 'playlist', tracks, count: tracks.length, imgId: tracks[0]?.imgId }); }
  report() { }
  logout() { }
}

/* ---------- accesorios del oso según el tema ---------- */
const BEAR_ACC = {"navy": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <path d=\"M82 138C71 -22 441 -22 430 138\" fill=\"none\" stroke-width=\"30\"/> <path d=\"M82 138C71 -22 441 -22 430 138\" fill=\"none\" stroke=\"#3cc0f5\" stroke-width=\"16\"/> <path d=\"M97 96C100 3 412 3 415 96\" pathLength=\"100\" stroke-dasharray=\"0 24 52 100\" fill=\"none\" stroke=\"#9be3ff\" stroke-width=\"6\" opacity=\".9\"/> <g class=\"b-cupL\"><rect x=\"47\" y=\"90\" width=\"70\" height=\"100\" rx=\"32\" fill=\"#1e3a66\"/><rect x=\"62\" y=\"107\" width=\"40\" height=\"66\" rx=\"19\" fill=\"#3cc0f5\" stroke-width=\"5\"/></g> <g class=\"b-cupR\"><rect x=\"395\" y=\"90\" width=\"70\" height=\"100\" rx=\"32\" fill=\"#1e3a66\"/><rect x=\"410\" y=\"107\" width=\"40\" height=\"66\" rx=\"19\" fill=\"#3cc0f5\" stroke-width=\"5\"/></g> <g class=\"b-n1\"><g transform=\"translate(-40 -46)\"><path d=\"M26 150v-58l36-10v58\" fill=\"none\" stroke=\"#9be3ff\" stroke-width=\"7\"/> <ellipse cx=\"16\" cy=\"152\" rx=\"14\" ry=\"11\" fill=\"#9be3ff\" stroke-width=\"6\"/><ellipse cx=\"52\" cy=\"142\" rx=\"14\" ry=\"11\" fill=\"#9be3ff\" stroke-width=\"6\"/></g></g> <g class=\"b-n2\"><path d=\"M492 268v-44\" fill=\"none\" stroke=\"#7dd3fc\" stroke-width=\"6\"/><path d=\"M492 224c14 6 20 16 16 28\" fill=\"none\" stroke=\"#7dd3fc\" stroke-width=\"6\"/> <ellipse cx=\"482\" cy=\"270\" rx=\"13\" ry=\"10\" fill=\"#7dd3fc\" stroke-width=\"6\"/></g> <g class=\"b-spk\"><path transform=\"translate(-10 46)\" d=\"M478 -84l11 31 31 11-31 11-11 31-11-31-31-11 31-11z\" fill=\"#fff6c7\" stroke-width=\"6\"/></g> </g>", "leaf": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-steam\"><path d=\"M232 300c-14-22 14-30 0-52M266 296c-14-24 16-32 2-58M300 300c-14-22 14-30 0-52\" fill=\"none\" stroke=\"#9fe0b4\" stroke-width=\"9\"/></g> <g class=\"b-cup\"><path d=\"M356 352c40 0 52 52 0 62\" fill=\"none\" stroke-width=\"14\"/><path d=\"M356 352c40 0 52 52 0 62\" fill=\"none\" stroke=\"#f4fbf6\" stroke-width=\"5\"/> <path d=\"M176 330h184v86c0 36-30 56-92 56s-92-20-92-56z\" fill=\"#f4fbf6\"/> <ellipse cx=\"268\" cy=\"330\" rx=\"92\" ry=\"20\" fill=\"#5bbf6e\"/> <path d=\"M176 380h184\" fill=\"none\" stroke=\"#5bd68a\" stroke-width=\"14\"/> <path d=\"M300 330l18 46\" fill=\"none\" stroke-width=\"4\"/><rect x=\"306\" y=\"372\" width=\"28\" height=\"30\" rx=\"5\" fill=\"#5bd68a\"/> <ellipse cx=\"166\" cy=\"392\" rx=\"30\" ry=\"26\" fill=\"#fff\"/><ellipse cx=\"370\" cy=\"420\" rx=\"28\" ry=\"24\" fill=\"#fff\"/></g> <g class=\"b-leaf\"><path d=\"M300 -6c40-30 92-14 96 22-40 26-88 14-96-22z\" fill=\"#5bd68a\"/><path d=\"M304 -4c30 4 58 10 88 20\" fill=\"none\" stroke-width=\"5\"/></g> </g>", "pony": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-horn\"><path d=\"M222 52L255 -92 288 52z\" fill=\"#ffd1e8\"/> <path d=\"M232 10l46 -12M240 -26l32 -9M247 -60l18 -5\" fill=\"none\" stroke=\"#ff4f9a\" stroke-width=\"7\"/></g> <g class=\"b-blush\"><circle cx=\"128\" cy=\"170\" r=\"26\" fill=\"#ff8fc2\" stroke=\"none\" opacity=\".75\"/><circle cx=\"382\" cy=\"170\" r=\"26\" fill=\"#ff8fc2\" stroke=\"none\" opacity=\".75\"/></g> <g class=\"b-spk\"><path d=\"M66 20l8 22 22 8-22 8-8 22-8-22-22-8 22-8zM448 30l6 16 16 6-16 6-6 16-6-16-16-6 16-6z\" fill=\"#ffd1e8\" stroke-width=\"5\"/></g> </g>", "gato": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-earL\"><path d=\"M70 92L96 -40 196 40z\" fill=\"#ff9a3c\"/><path d=\"M98 56L108 -6 158 34z\" fill=\"#ffd2a6\" stroke-width=\"5\"/></g> <g class=\"b-earR\"><path d=\"M442 92L416 -40 316 40z\" fill=\"#ff9a3c\"/><path d=\"M414 56L404 -6 354 34z\" fill=\"#ffd2a6\" stroke-width=\"5\"/></g> <g class=\"b-tuft\"><path d=\"M226 30l6 34M256 22v40M286 30l-6 34\" fill=\"none\" stroke=\"#ff9a3c\" stroke-width=\"12\"/></g> <g class=\"b-wsk\"><path d=\"M188 168L80 150M188 186L84 196M324 168L432 150M324 186L428 196\" fill=\"none\" stroke-width=\"6\"/></g> </g>", "uva": "<g stroke=\"#1b2547\" stroke-width=\"7\" stroke-linejoin=\"round\"> <g class=\"b-grapes\"><path d=\"M262 296c-6-26 6-40 26-48\" fill=\"none\" stroke-width=\"9\" stroke-linecap=\"round\"/> <path d=\"M268 286c26-36 74-30 86-4-34 18-66 18-86 4z\" fill=\"#5bd68a\"/> <g fill=\"#9b5cf6\"><circle cx=\"210\" cy=\"322\" r=\"30\"/><circle cx=\"268\" cy=\"318\" r=\"30\"/><circle cx=\"326\" cy=\"322\" r=\"30\"/><circle cx=\"238\" cy=\"370\" r=\"30\"/><circle cx=\"298\" cy=\"370\" r=\"30\"/><circle cx=\"268\" cy=\"418\" r=\"30\"/></g> <g fill=\"#d4b8ff\" stroke=\"none\"><circle cx=\"200\" cy=\"312\" r=\"8\"/><circle cx=\"258\" cy=\"308\" r=\"8\"/><circle cx=\"316\" cy=\"312\" r=\"8\"/><circle cx=\"228\" cy=\"360\" r=\"8\"/><circle cx=\"288\" cy=\"360\" r=\"8\"/><circle cx=\"258\" cy=\"408\" r=\"8\"/></g></g> <ellipse cx=\"166\" cy=\"372\" rx=\"30\" ry=\"26\" fill=\"#fff\"/><ellipse cx=\"370\" cy=\"372\" rx=\"30\" ry=\"26\" fill=\"#fff\"/> <g class=\"b-spk\"><path d=\"M454 -10l8 22 22 8-22 8-8 22-8-22-22-8 22-8zM40 30l6 16 16 6-16 6-6 16-6-16-16-6 16-6z\" fill=\"#f5d0ff\"/></g> </g>", "cafe": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-steam\"><path d=\"M226 300c-14-22 14-30 0-52M266 296c-14-24 16-32 2-58\" fill=\"none\" stroke=\"#e7d3bd\" stroke-width=\"9\"/></g> <g class=\"b-cup\"><path d=\"M352 352c42 0 54 54 0 64\" fill=\"none\" stroke-width=\"14\"/><path d=\"M352 352c42 0 54 54 0 64\" fill=\"none\" stroke=\"#b07a4f\" stroke-width=\"5\"/> <path d=\"M168 330h188v80c0 38-32 60-94 60s-94-22-94-60z\" fill=\"#b07a4f\"/> <ellipse cx=\"262\" cy=\"330\" rx=\"94\" ry=\"20\" fill=\"#f3e1c7\"/> <g class=\"b-heart\"><path d=\"M262 342c-10-12-32-6-22 8l22 14 22-14c10-14-12-20-22-8z\" fill=\"#b07a4f\" stroke-width=\"4\"/></g> <ellipse cx=\"160\" cy=\"392\" rx=\"30\" ry=\"26\" fill=\"#fff\"/><ellipse cx=\"364\" cy=\"420\" rx=\"28\" ry=\"24\" fill=\"#fff\"/></g> </g>", "synth": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\"> <defs><linearGradient id=\"sg\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ff3cac\"/><stop offset=\"1\" stop-color=\"#3ad1ff\"/></linearGradient></defs> <g class=\"b-glasses\"><path d=\"M80 82h352\" stroke-width=\"12\" stroke-linecap=\"round\"/> <path d=\"M98 80h138l-12 54c-4 14-14 20-30 20h-66c-16 0-26-8-28-22z\" fill=\"url(#sg)\"/> <path d=\"M276 80h138l-2 52c-2 14-12 22-28 22h-66c-16 0-26-6-30-20z\" fill=\"url(#sg)\"/> <g class=\"b-glint\"><path d=\"M118 104h96M296 104h96\" stroke=\"#fff\" stroke-width=\"6\" opacity=\".7\"/></g></g> </g>", "chile": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-chili\"><path d=\"M136 400c40 40 170 50 250-60 14-20 34-6 24 12-70 140-250 130-300 66-14-18 10-34 26-18z\" fill=\"#ff3b3b\"/> <path d=\"M396 346c6-24 22-34 42-34\" fill=\"none\" stroke=\"#3aa84e\" stroke-width=\"12\"/> <path d=\"M384 352c10-12 28-12 36 0\" fill=\"#3aa84e\" stroke-width=\"6\"/> <path d=\"M170 404c40 24 100 26 150 6\" fill=\"none\" stroke=\"#ffb3b3\" stroke-width=\"8\"/></g> <g class=\"b-blush\"><circle cx=\"128\" cy=\"170\" r=\"26\" fill=\"#ff5a5a\" stroke=\"none\" opacity=\".7\"/><circle cx=\"382\" cy=\"170\" r=\"26\" fill=\"#ff5a5a\" stroke=\"none\" opacity=\".7\"/></g> <g class=\"b-drop\"><path d=\"M452 60c-14 22-20 34-20 44a20 20 0 0 0 40 0c0-10-6-22-20-44z\" fill=\"#9ad8ff\"/></g> </g>", "abejita": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-ant\"><path d=\"M206 34C196 0 176-24 150-40M306 34c10-34 30-58 56-74\" fill=\"none\" stroke-width=\"9\"/> <circle cx=\"146\" cy=\"-44\" r=\"20\" fill=\"#ffcc00\"/><circle cx=\"366\" cy=\"-44\" r=\"20\" fill=\"#ffcc00\"/></g> <g class=\"b-bee\"><g transform=\"translate(450 250) rotate(-15)\"><g class=\"b-wing\"><ellipse cx=\"-6\" cy=\"-30\" rx=\"18\" ry=\"24\" fill=\"#e8f6ff\" stroke-width=\"5\"/><ellipse cx=\"16\" cy=\"-30\" rx=\"18\" ry=\"24\" fill=\"#e8f6ff\" stroke-width=\"5\"/></g> <ellipse cx=\"0\" cy=\"0\" rx=\"40\" ry=\"28\" fill=\"#ffcc00\"/><path d=\"M-10 -26v52M10 -26v52\" stroke-width=\"10\"/><circle cx=\"-26\" cy=\"-4\" r=\"4\" fill=\"#1b2547\"/></g> </g></g>", "girasol": "<g stroke=\"#1b2547\" stroke-width=\"7\" stroke-linejoin=\"round\" transform=\"translate(392 36)\"> <g class=\"b-flower\"><g class=\"b-petals\"><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(30)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(60)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(90)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(120)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(150)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(180)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(210)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(240)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(270)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(300)\"/><ellipse cx=\"0\" cy=\"-46\" rx=\"17\" ry=\"30\" fill=\"#ffcc00\" transform=\"rotate(330)\"/></g> <circle r=\"34\" fill=\"#7a4a1d\"/><g fill=\"#a86b32\" stroke=\"none\"><circle cx=\"-10\" cy=\"-8\" r=\"5\"/><circle cx=\"10\" cy=\"-6\" r=\"5\"/><circle cx=\"0\" cy=\"10\" r=\"5\"/></g></g> </g>", "caribe": "<g stroke=\"#1b2547\" stroke-width=\"7\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-flower\"><g transform=\"translate(112 40)\"><ellipse cx=\"0\" cy=\"-34\" rx=\"24\" ry=\"34\" fill=\"#ff5d73\" transform=\"rotate(0)\"/><ellipse cx=\"0\" cy=\"-34\" rx=\"24\" ry=\"34\" fill=\"#ff5d73\" transform=\"rotate(72)\"/><ellipse cx=\"0\" cy=\"-34\" rx=\"24\" ry=\"34\" fill=\"#ff5d73\" transform=\"rotate(144)\"/><ellipse cx=\"0\" cy=\"-34\" rx=\"24\" ry=\"34\" fill=\"#ff5d73\" transform=\"rotate(216)\"/><ellipse cx=\"0\" cy=\"-34\" rx=\"24\" ry=\"34\" fill=\"#ff5d73\" transform=\"rotate(288)\"/><circle r=\"14\" fill=\"#ffd34d\"/><path d=\"M0 0l26 -30\" stroke=\"#ffd34d\" stroke-width=\"6\"/></g></g> <g class=\"b-lei\"><path d=\"M100 262c50 50 262 50 312 0\" fill=\"none\" stroke-width=\"10\"/> <circle cx=\"118\" cy=\"276\" r=\"24\" fill=\"#ff5d73\"/><circle cx=\"170\" cy=\"300\" r=\"24\" fill=\"#ffd34d\"/><circle cx=\"226\" cy=\"312\" r=\"24\" fill=\"#2ed3c6\"/><circle cx=\"286\" cy=\"312\" r=\"24\" fill=\"#ff5d73\"/><circle cx=\"342\" cy=\"300\" r=\"24\" fill=\"#ffd34d\"/><circle cx=\"394\" cy=\"276\" r=\"24\" fill=\"#2ed3c6\"/></g> </g>", "amoled": "<g stroke=\"#1b2547\" stroke-width=\"7\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-moon\"><path d=\"M470 -40a56 56 0 1 0 30 100 46 46 0 1 1-30-100z\" fill=\"#f2f2f2\"/></g> <g class=\"b-zzz\"><path d=\"M400 70h30l-30 34h30M372 16h20l-20 22h20\" fill=\"none\" stroke=\"#f2f2f2\" stroke-width=\"9\"/> <path d=\"M400 70h30l-30 34h30M372 16h20l-20 22h20\" fill=\"none\" stroke-width=\"3\"/></g> </g>", "sandia": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-slice\"><path d=\"M150 330a118 118 0 0 0 236 0z\" fill=\"#3fae5a\"/> <path d=\"M166 330a102 102 0 0 0 204 0z\" fill=\"#d9f7c9\" stroke-width=\"5\"/> <path d=\"M180 330a88 88 0 0 0 176 0z\" fill=\"#ff4d6d\" stroke-width=\"5\"/> <g fill=\"#1b2547\" stroke=\"none\"><ellipse cx=\"226\" cy=\"362\" rx=\"6\" ry=\"10\" transform=\"rotate(-20 226 362)\"/><ellipse cx=\"268\" cy=\"384\" rx=\"6\" ry=\"10\"/><ellipse cx=\"310\" cy=\"362\" rx=\"6\" ry=\"10\" transform=\"rotate(20 310 362)\"/><ellipse cx=\"248\" cy=\"346\" rx=\"5\" ry=\"8\"/><ellipse cx=\"290\" cy=\"346\" rx=\"5\" ry=\"8\"/></g> <ellipse cx=\"150\" cy=\"368\" rx=\"30\" ry=\"26\" fill=\"#fff\"/><ellipse cx=\"386\" cy=\"368\" rx=\"30\" ry=\"26\" fill=\"#fff\"/></g> </g>", "invierno": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-hat\"><path d=\"M104 64C110-30 402-30 408 64z\" fill=\"#e5484d\"/> <path d=\"M92 60h328v34H92z\" fill=\"#f4f7fb\" rx=\"10\"/> <path d=\"M130 60v34M170 60v34M210 60v34M250 60v34M290 60v34M330 60v34M370 60v34\" stroke=\"#c9d4e4\" stroke-width=\"5\"/></g> <g class=\"b-pom\"><circle cx=\"256\" cy=\"-30\" r=\"30\" fill=\"#f4f7fb\"/></g> <path d=\"M150 0c20 14 40 14 60 0M302 0c20 14 40 14 60 0\" fill=\"none\" stroke=\"#ff9a9d\" stroke-width=\"6\"/> <path d=\"M96 246c40 40 280 40 320 0l10 40c-50 44-290 44-340 0z\" fill=\"#e5484d\"/> <g class=\"b-tail\"><path d=\"M330 270l20 110h56l-30-120z\" fill=\"#e5484d\"/> <path d=\"M350 340h48M356 362h46\" stroke=\"#f4f7fb\" stroke-width=\"6\"/></g> </g>", "chocolate": "<g stroke=\"#1b2547\" stroke-width=\"8\" stroke-linejoin=\"round\" stroke-linecap=\"round\"> <g class=\"b-bar\"><path d=\"M176 300h168v130H176z\" fill=\"#d9a25f\"/> <path d=\"M176 300h168v52H176z\" fill=\"#5a3420\"/> <path d=\"M232 300v52M288 300v52M176 326h168\" stroke=\"#7a4a2e\" stroke-width=\"5\"/> <path d=\"M176 300l14-14 12 14 14-14 12 14\" fill=\"none\" stroke-width=\"6\"/> <path d=\"M200 380h120\" stroke=\"#fff3df\" stroke-width=\"10\"/> <ellipse cx=\"166\" cy=\"392\" rx=\"30\" ry=\"26\" fill=\"#fff\"/><ellipse cx=\"354\" cy=\"392\" rx=\"30\" ry=\"26\" fill=\"#fff\"/></g> <g class=\"b-crumb\"><circle cx=\"208\" cy=\"230\" r=\"9\" fill=\"#5a3420\" stroke=\"none\"/></g> </g>", "aurora": "<g stroke-linecap=\"round\" fill=\"none\"> <g class=\"b-w1\"><path d=\"M-10 30C80-40 160 40 250-20S420 10 520-40\" stroke=\"#38f2b0\" stroke-width=\"22\" opacity=\".9\"/></g> <g class=\"b-w2\"><path d=\"M-10 0C90-70 170 10 260-50S430-20 520-70\" stroke=\"#8b7bff\" stroke-width=\"18\" opacity=\".85\"/></g> <g class=\"b-w3\"><path d=\"M10 56C90 0 170 70 250 16S410 40 500 0\" stroke=\"#5be7ff\" stroke-width=\"12\" opacity=\".8\"/></g> <g class=\"b-stars\"><g fill=\"#eafff7\" stroke=\"none\"><circle cx=\"60\" cy=\"-50\" r=\"6\"/><circle cx=\"470\" cy=\"60\" r=\"5\"/><circle cx=\"380\" cy=\"-70\" r=\"4\"/><circle cx=\"140\" cy=\"-80\" r=\"4\"/></g></g> </g>"};
function logoInner(theme) { const a = BEAR_ACC[theme || Settings.theme] || ''; return `<span class="lgimg"><svg class="acc" viewBox="0 0 512 488" aria-hidden="true">${a}</svg></span>`; }
// Cara expresiva sobre el oso (mismas coordenadas que los accesorios: 512×488).
const BEAR_FACE = `<svg class="face" viewBox="0 0 512 488" aria-hidden="true">
<g class="f-joy"><ellipse cx="126" cy="166" rx="28" ry="17" fill="#ff8fb3" opacity=".55"/><ellipse cx="386" cy="166" rx="28" ry="17" fill="#ff8fb3" opacity=".55"/>
<path d="M230 172q12 14 25 0q13 14 25 0" fill="none" stroke="#1d2a5c" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g>
<g class="f-sad"><ellipse cx="168" cy="108" rx="32" ry="27" fill="#fff"/><ellipse cx="342" cy="108" rx="32" ry="27" fill="#fff"/>
<ellipse cx="170" cy="112" rx="11" ry="13" fill="#1d2a5c"/><ellipse cx="340" cy="112" rx="11" ry="13" fill="#1d2a5c"/><circle cx="174" cy="107" r="4" fill="#fff"/><circle cx="344" cy="107" r="4" fill="#fff"/>
<path d="M144 94L190 80M366 94L320 80" stroke="#1d2a5c" stroke-width="10" stroke-linecap="round"/>
<path d="M234 184Q255 166 276 184" fill="none" stroke="#1d2a5c" stroke-width="9" stroke-linecap="round"/>
<path class="f-tear" d="M190 128c-7 11-10 17-10 21a10 10 0 0 0 20 0c0-4-3-10-10-21z" fill="#7dd3fc" stroke="#1d2a5c" stroke-width="4"/></g>
<g class="f-notes"><g class="fn fn1" style="--dx:-34px;--r:-22deg"><ellipse cx="58" cy="150" rx="15" ry="11"/><path d="M71 148V100l22 8"/></g>
<g class="fn fn2" style="--dx:30px;--r:18deg"><ellipse cx="452" cy="132" rx="15" ry="11"/><path d="M465 130V84l22 8"/></g>
<g class="fn fn3" style="--dx:-8px;--r:12deg"><ellipse cx="306" cy="-6" rx="13" ry="10"/><path d="M317 -8V-48"/></g></g>
</svg>`;
const BEAR = { el: null, t: 0, playing: false, pauseT: 0 };
// Oso animable: el logo con su cara expresiva encima.
function bearHTML() { const logo = logoInner(); return `<span class="bmove">${logo.slice(0, logo.lastIndexOf('</span>'))}${BEAR_FACE}</span></span>`; }
// Estado actual para los osos que se crean al navegar (encabezados).
function bearState() { return BEAR.sad ? 'sad' : BEAR.playing ? (BEAR.dancing ? 'dance' : 'happy') : ''; }
// Ahorro de CPU: las animaciones decorativas sin fin (Nanuq bailando, el DJ, el disco, las escenas de Inicio) corren solo en
// ráfagas cortas (body.nq-burst; fuera de ellas el CSS las pausa). Medido en un teléfono Android de gama media (pantalla de 120 Hz): cualquier
// animación sin fin, por pequeña que sea, obliga al WebView a componer 120 cuadros por segundo, ≈ 1 núcleo de CPU con la
// música sonando (≈ 2 con el DJ); quietas, ≈ 0.3. Así Nanuq baila al empezar cada canción y luego se queda contento.
const NQB = { t: 0, until: 0 };
function nqBurst(ms = 8000) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.visibilityState !== 'visible' || RC.visible === false) return; // nadie lo está viendo
  const end = Date.now() + ms; if (end <= NQB.until) return;
  NQB.until = end; document.body.classList.add('nq-burst'); clearTimeout(NQB.t);
  NQB.t = setTimeout(nqBurstEnd, ms);
}
// Fin de la ráfaga (también en cuanto Nanuq deja de verse: pantalla apagada o bloqueada, app en segundo plano).
function nqBurstEnd() {
  clearTimeout(NQB.t); NQB.until = 0; document.body.classList.remove('nq-burst');
  if (BEAR.dancing) { BEAR.dancing = false; $$('.bear.dance:not(.sp-bear)').forEach(el => { el.classList.remove('dance'); if (BEAR.playing) el.classList.add('happy'); }); }
}
// Nanuq baila un rato (al empezar a sonar y en cada canción nueva).
function bearDance() {
  if (!BEAR.playing) return;
  BEAR.dancing = true; $$('.bear:not(.sp-bear)').forEach(el => { el.classList.remove('happy', 'sad'); el.classList.add('dance'); });
  nqBurst(8000);
}
function bearInit() {
  $$('.brand .logo').forEach(l => { l.classList.add('bear'); l.innerHTML = bearHTML(); });
}
// Todos los osos (reproductor, encabezados, barra lateral) sienten la música a la vez:
// contentos y bailando mientras suena; tristes un momento al parar y luego quietos como siempre.
function bearMood(playing) {
  if (playing === BEAR.playing) return;
  BEAR.playing = playing; clearTimeout(BEAR.t);
  BEAR.sad = !playing; BEAR.dancing = playing;
  const els = $$('.bear:not(.sp-bear)');
  els.forEach(el => el.classList.remove('joy', 'sad', 'dance', 'happy'));
  void document.body.offsetWidth;
  if (playing) { els.forEach(el => el.classList.add('joy', 'dance')); nqBurst(8000); BEAR.t = setTimeout(() => $$('.bear.joy:not(.sp-bear)').forEach(el => el.classList.remove('joy')), 900); }
  else { els.forEach(el => el.classList.add('sad')); nqBurst(3000); BEAR.t = setTimeout(() => { BEAR.sad = false; $$('.bear.sad').forEach(el => el.classList.remove('sad')); }, 2800); }
}
// Pantalla de bienvenida con el oso del tema elegido.
function showSplash(name) {
  const sp = $('#splash'); if (!sp) return;
  clearTimeout(showSplash.t);
  const b = sp.querySelector('.sp-bear');
  b.innerHTML = bearHTML(); b.className = 'sp-bear bear joy dance'; nqBurst(2400);
  sp.querySelector('.sp-name').textContent = name || tx('a Nanuq');
  sp.classList.remove('out'); sp.hidden = false;
  const hide = () => { sp.classList.add('out'); clearTimeout(showSplash.t); showSplash.t = setTimeout(() => { sp.hidden = true; b.innerHTML = ''; }, 460); };
  sp.onclick = hide;
  showSplash.t = setTimeout(hide, 1900);
}
function refreshBear() {
  $$('.lgimg:not(.tiny)').forEach(el => { el.querySelector('.acc').innerHTML = BEAR_ACC[Settings.theme] || ''; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); });
}

/* =========================================================
   Settings & theme
   ========================================================= */
const Settings = {
  theme: store.get('theme', 'navy'),
  quality: store.get('quality', 140000000),
  wave: store.get('wave', false),
  volume: store.get('volume', 1),
  albumSort: store.get('albumSort', 'name'),
  songView: store.get('songView', 'list'),
  songSort: store.get('songSort', 'name'),
  artistView: store.get('artistView', 'songs'),   // songs | albums
  artistSort: store.get('artistSort', 'album'),   // album | name | plays
  devSync: store.get('devSync', true),
  devSameNet: store.get('devSameNet', true),
  devOthers: store.get('devOthers', false),   // aceptar canciones/órdenes que manden OTROS usuarios de Jellyfin
  dlMax: store.get('dlMax', 100),
  dlWifi: store.get('dlWifi', true),
  dlAuto: store.get('dlAuto', true),
  dlQuality: store.get('dlQuality', 320000),
  pfOn: store.get('pfOn', true),   // Android: guardar por adelantado lo que sigue en la cola
  pfMin: store.get('pfMin', 10),   // … cuántos minutos
  djVoice: store.get('djVoice', false),
  fade: store.get('fade', true),   // desvanecer al pausar y al reanudar
  discord: store.get('discord', false),          // «Escuchando Nanuq» en Discord (apps de escritorio)
  discordCover: store.get('discordCover', false),  // con la portada (comparte la dirección de tu servidor)
  playerAnim: store.get('playerAnim', 'all'),   // con el DJ, en el reproductor: all (Nanuq y el disco) | disc (solo el disco) | none (la portada de siempre)
  favSort: store.get('favSort', 'name'),
  set(k, v) { this[k] = v; store.set(k, v); }
};

/* =========================================================
   Descargas para escuchar sin datos (solo en la app de Android)
   ========================================================= */
const AUTO_PLAYS = 3; // reproducciones para guardar una canción automáticamente
const DL = {
  on: !!(window.NanuqAndroid && window.NanuqAndroid.dlEnqueue),
  map: new Map(), covers: new Map(), base: '',
  init() {
    if (!this.on) return;
    try { this.base = NanuqAndroid.dlBase ? NanuqAndroid.dlBase() : ''; } catch { }
    try { for (const e of JSON.parse(NanuqAndroid.dlList())) this.map.set(e.id, e); } catch { }
    this.indexCovers();
    this.config();
  },
  // imgId (álbum o canción) → carátula guardada en el teléfono
  indexCovers() {
    this.covers.clear();
    if (this.base) for (const e of this.map.values()) if (e.state === 'done' && e.hasCover && e.track && e.track.imgId) this.covers.set(e.track.imgId, this.base + 'c/' + encodeURIComponent(e.id));
  },
  coverUrl(imgId) { return this.on && imgId ? this.covers.get(imgId) || null : null; },
  // Descargas hechas antes de guardar carátulas: se piden una vez.
  backfillCovers() {
    if (!this.usable() || !NanuqAndroid.dlCover) return;
    for (const e of this.map.values()) if (e.state === 'done' && !e.hasCover && e.track && e.track.imgId) { const u = api.img(e.track, 600, true); if (u) NanuqAndroid.dlCover(e.id, u); }
    // Descargas recuperadas solo desde el archivo (el índice no se pudo leer): se completan nombre, artista y carátula.
    const nameless = [...this.map.values()].filter(e => e.state === 'done' && !(e.track && e.track.name)).map(e => sid(e.id)).filter(Boolean).slice(0, 500);
    if (nameless.length) api.itemsByIds(nameless).then(ts => ts.forEach(t => this.add(t, false))).catch(() => { });
  },
  config() { if (this.on) NanuqAndroid.dlConfig(+Settings.dlMax, !!Settings.dlWifi); },
  usable() { return this.on && api && api.kind === 'jellyfin'; },
  get(id) { return id ? this.map.get(id) || null : null; },
  localUrl(id) { const e = this.on && this.base && this.get(id); return e && e.state === 'done' ? this.base + 'a/' + encodeURIComponent(id) : null; },
  isLocal(url) { return !!this.base && !!url && url.startsWith(this.base); },
  // ok | full | lower | off
  add(t, auto = false) {
    if (!this.usable() || !t) return 'off';
    const { qid, ...track } = t;
    return NanuqAndroid.dlEnqueue(t.id, api.dlUrl(t), api.img(t, 600, true) || '', JSON.stringify(track), auto, Plays.count(t.id));
  },
  remove(id) { if (this.on) NanuqAndroid.dlRemove(id); },
  removeAll(onlyAuto) { if (this.on) NanuqAndroid.dlRemoveAll(!!onlyAuto); },
  list() { return [...this.map.values()]; },
  bytes() { return this.list().reduce((a, e) => a + (e.state === 'done' ? e.size : 0), 0); },
  net() { try { return NanuqAndroid.dlNetwork(); } catch { return 'wifi'; } }
};
window.__nanuqDl = ev => {
  if (ev.state === 'removed') DL.map.delete(ev.id);
  else {
    const prev = DL.map.get(ev.id); DL.map.set(ev.id, ev);
    if (prev && prev.state !== 'done' && ev.state === 'done' && !ev.auto && P.cur && P.cur.id === ev.id) toast('«' + (ev.track.name || tx('La canción')) + tx('» ya está guardada en tu teléfono'));
  }
  DL.indexCovers();
  updateDlBtn();
  const c = cur();
  if (c && c.name === 'downloads') renderDownloadsSoon();
  if (c && c.name === 'settings') { const x = $('#dlSum'); if (x) x.textContent = dlSummary(); }
};
// Reproducciones por canción en este teléfono: deciden qué se guarda automáticamente.
const Plays = {
  data: store.get('plays', {}),
  count(id) { const p = this.data[id]; return p ? p.n : 0; },
  add(t) {
    const p = this.data[t.id] || (this.data[t.id] = { n: 0, last: 0 });
    p.n++; p.last = Date.now();
    const keys = Object.keys(this.data);
    if (keys.length > 3000) keys.sort((a, b) => this.data[a].last - this.data[b].last).slice(0, keys.length - 3000).forEach(k => delete this.data[k]);
    store.set('plays', this.data);
    if (!DL.usable()) return;
    if (DL.get(t.id)) NanuqAndroid.dlScore(t.id, p.n);
    else if (Settings.dlAuto && p.n >= AUTO_PLAYS) DL.add(t, true);
  }
};
// Lo que sigue en la cola, guardado por adelantado (solo en la app de Android, ver Prefetch.java): se le pide al teléfono
// que baje las canciones que vienen hasta cubrir los minutos elegidos; al llegar su turno suenan desde el teléfono, así
// una red lenta o un corte breve no se notan. La que suena no se baja otra vez (ya se está transmitiendo), pero se
// conserva si ya estaba guardada. Con el ajuste apagado, controlando otro dispositivo o en la fiesta, se vacía.
const PF = {
  on: !!(window.NanuqAndroid && window.NanuqAndroid.pfSet), t: 0, last: '',
  usable() { return this.on && !!api && api.kind === 'jellyfin'; },
  isUrl(u) { return this.on && !!DL.base && !!u && u.startsWith(DL.base + 'p/'); },
  url(id) { if (!this.usable() || !Settings.pfOn || !id) return null; try { return NanuqAndroid.pfReady(id) ? DL.base + 'p/' + encodeURIComponent(id) : null; } catch { return null; } },
  soon(ms = 1500) { if (!this.on) return; clearTimeout(this.t); this.t = setTimeout(() => this.sync(), ms); },
  sync() {
    if (!this.on) return;
    const want = [];
    if (this.usable() && Settings.pfOn && !RC.remote && P.cur && !partyHostOpen() && !document.body.classList.contains('in-party')) {
      const lim = Math.max(1, num(Settings.pfMin)) * 60, br = t => +Settings.quality >= 1e7 && MP3.ids.has(t.id) ? 320000 : Settings.quality;
      const add = (t, keep) => { if (t && t.id && !DL.localUrl(t.id) && !want.some(x => x.id === t.id)) want.push({ id: t.id, url: api.streamUrl(t, br(t), 'pf' + uid()), keep }); };
      add(P.cur, true);
      let acc = 0;
      for (let k = P.i + 1; k < P.queue.length && acc < lim && want.length < 40; k++) { add(P.queue[k], false); acc += P.queue[k].duration || 180; }
    }
    const sig = want.map(x => x.id + (x.keep ? '*' : '')).join();
    if (sig === this.last) return; this.last = sig;
    try { NanuqAndroid.pfSet(JSON.stringify(want)); } catch { }
  }
};
function fmtMB(b) { b = b || 0; return b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', LANG === 'es' ? ',' : '.') + ' GB' : (b / 1e6).toFixed(b >= 1e8 ? 0 : 1).replace('.', LANG === 'es' ? ',' : '.') + ' MB'; }
function dlStatus(e) {
  if (!e) return '';
  switch (e.state) {
    case 'done': return tx('Descargada');
    case 'downloading': return e.total > 0 ? Math.floor(e.bytes / e.total * 100) + ' %' : tx('Descargando ') + fmtMB(e.bytes);
    case 'waiting': return Settings.dlWifi ? tx('Esperando Wi-Fi') : tx('Esperando conexión');
    case 'error': return tx('Falló');
    default: return tx('En cola');
  }
}
// Versión corta para el botón del reproductor (no cabe un texto largo): el porcentaje basta para saber que se baja.
function dlStatusShort(e) {
  if (!e) return tx('Descargar');
  if (e.state === 'done') return tx('Descargada');
  if (e.state === 'error') return tx('Falló');
  return (e.state === 'downloading' && e.total > 0 ? Math.floor(e.bytes / e.total * 100) : 0) + '%';
}
function dlSummary() {
  const all = DL.list(), done = all.filter(e => e.state === 'done').length, pend = all.length - done;
  return tx('{0} de {1} canciones · {2}{3}', [done, Settings.dlMax, fmtMB(DL.bytes()), pend ? ' · ' + tx(pend === 1 ? '{0} pendiente' : '{0} pendientes', [pend]) : '']);
}
const THEMES = {
  navy: { name: tx('Marino'), bg: '#081120', side: '#0c182b', a: '#3cc0f5', t: '#dce7f6' },
  dark: { name: tx('Oscuro'), bg: '#1c2024', side: '#23282d', a: '#2aa8f2', t: '#e7e9eb' },
  light: { name: tx('Claro'), bg: '#f3f6f9', side: '#ffffff', a: '#1ea7e6', t: '#27303b' },
  leaf: { name: tx('🌿 Green Leaf'), bg: '#0b1a12', side: '#10241a', a: '#5bd68a', t: '#e3f3e8' },
  pony: { name: tx('🦄 Pinky Pony'), bg: '#fff3f8', side: '#ffffff', a: '#ff4f9a', t: '#4a2338' },
  gato: { name: tx('🐈 Gato Naranjoso'), bg: '#fff5ea', side: '#fffaf4', a: '#ff8a1f', t: '#3d2614' },
  uva: { name: tx('🍇 Uva Galáctica'), bg: '#120a24', side: '#1a1032', a: '#b77bff', t: '#ece4ff' },
  cafe: { name: tx('☕ Café con Leche'), bg: '#f5eee5', side: '#fbf7f2', a: '#a0663a', t: '#3b2c22' },
  synth: { name: tx('🌆 Synthwave'), bg: '#0d0221', side: '#150734', a: '#ff3cac', t: '#f3e9ff' },
  chile: { name: tx('🌶️ Chile Rojo'), bg: '#1a0a0b', side: '#240e10', a: '#ff3b3b', t: '#fde8e8' },
  abejita: { name: tx('🐝 Abejita'), bg: '#14120a', side: '#1c190e', a: '#ffcc00', t: '#fff8dc' },
  girasol: { name: tx('🌻 Girasol'), bg: '#fffbe8', side: '#fffdf3', a: '#c28400', t: '#3a2f05' },
  caribe: { name: tx('🏝️ Caribe'), bg: '#eefbfa', side: '#f7fefd', a: '#00b3a4', t: '#0f3533' },
  amoled: { name: tx('⚫ Negro AMOLED'), bg: '#000000', side: '#0d0d0d', a: '#ffffff', t: '#f2f2f2' },
  sandia: { name: tx('🍉 Sandía'), bg: '#fff2f3', side: '#fffafa', a: '#e8364f', t: '#3d1820' },
  invierno: { name: tx('❄️ Invierno'), bg: '#f0f6fc', side: '#fafdff', a: '#2b7fd4', t: '#16263a' },
  chocolate: { name: tx('🍫 Chocolate'), bg: '#170f0b', side: '#20150f', a: '#d9a25f', t: '#f6e9dc' },
  aurora: { name: tx('🌌 Aurora Boreal'), bg: '#06141a', side: '#0a1d25', a: '#38f2b0', t: '#e4fbf6' }
};
function themeSummary() {
  const t = THEMES[Settings.theme] || THEMES.navy;
  return `<span class="swt" style="background:${t.bg}"><i style="background:${t.side}"></i><span><b style="background:${t.a}"></b></span></span><span class="nm">${esc(t.name)}<small>${tx('Toca para ver los')} ${Object.keys(THEMES).length} ${tx('temas')}</small></span><svg class="i chev"><use href="#i-down"/></svg>`;
}
function applyTheme(t) {
  if (!THEMES[t]) t = 'navy';
  document.documentElement.dataset.theme = t;
  $('meta[name=theme-color]').content = THEMES[t].bg;
  Settings.set('theme', t);
  _css = {};
  if (typeof refreshBear === 'function') refreshBear();
  requestAnimationFrame(drawWaves);
}

/* =========================================================
   State, routing
   ========================================================= */
let api = null;
const cache = new Map();
const lists = {};
let listSeq = 0;
const regList = arr => { const k = 'l' + (++listSeq); lists[k] = arr; if (listSeq > 60) delete lists['l' + (listSeq - 60)]; return k; };
const S = { stack: [] };
const TOP = ['home', 'albums', 'songs', 'artists', 'genres', 'playlists', 'favorites', 'downloads', 'folders', 'search', 'settings', 'queue', 'more', 'request', 'party'];
const NAV = [['home', tx('Inicio'), 'home'], ['search', tx('Buscar'), 'search'], ['folders', tx('Carpetas'), 'folder'], ['genres', tx('Géneros'), 'tag'], ['artists', tx('Artistas'), 'user'], ['albums', tx('Álbumes'), 'disc'], ['songs', tx('Canciones'), 'music'], ['playlists', 'Playlists', 'list'], ['favorites', tx('Favoritas'), 'heart'], ...(window.NanuqAndroid && window.NanuqAndroid.dlEnqueue ? [['downloads', tx('Descargas'), 'download']] : []), ...(window.NanuqAndroid || (window.nanuqDesktop && window.nanuqDesktop.party) ? [['party', tx('Fiesta'), 'party']] : []), ['request', tx('Solicitar canción'), 'req'], ['settings', tx('Ajustes'), 'gear']];
const TABS = [['home', tx('Inicio'), 'home'], ['songs', tx('Canciones'), 'music'], ['search', tx('Buscar'), 'search'], ['queue', tx('Cola'), 'queue'], ['more', tx('Más'), 'grid']];
const mqMobile = matchMedia('(max-width:719px)');
const mqQueue = matchMedia('(min-width:1181px)');

const NAV_ORDER = ['home', 'songs', 'search', 'queue', 'more', 'albums', 'artists', 'playlists', 'favorites', 'downloads', 'genres', 'folders', 'party', 'request', 'settings'];
function cur() { return S.stack[S.stack.length - 1]; }
function go(name, params = {}, opts = {}) {
  if (name !== 'party' && (document.body.classList.contains('party-host') || document.body.classList.contains('in-party'))) return; // en la fiesta no hay otras pantallas
  const c = cur(); if (c) c.scroll = $('#main').scrollTop;
  if (opts.root || TOP.includes(name) && !opts.push) S.stack = [];
  S.stack.push({ name, params, scroll: 0 });
  try { history.pushState({ d: S.stack.length }, ''); } catch { }
  closeSheet(true); $('#queue').classList.remove('open');
  render();
}
function back() {
  if ($('.scrim')) { $('.scrim').remove(); return true; }
  if (SY.on) { syncCancel(); return true; }
  if ($('#sheet').classList.contains('open')) { closeSheet(true); return true; }
  if (document.body.classList.contains('in-party') || document.body.classList.contains('party-host')) return false; // en la fiesta no hay otra pantalla a la que volver (la app pasa a segundo plano)
  if (S.stack.length > 1) { S.stack.pop(); render(true); return true; }
  return false;
}
addEventListener('popstate', () => { if (back()) { try { history.pushState({ d: S.stack.length }, ''); } catch { } } });

const cacheDrop = prefix => { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); };
// Vuelve a dibujar la pantalla actual (sin perder el desplazamiento) si cumple la condición.
function refreshIf(test) { const c = cur(); if (!c || !test(c)) return; c.scroll = $('#main').scrollTop; render(true); }
// Una playlist cambió: se olvidan sus copias y, si está a la vista, se vuelve a pedir. Jellyfin a veces
// termina de guardar una playlist nueva un instante después, así que se revisa otra vez.
function playlistsChanged(plId) {
  cache.delete('playlists'); cacheDrop('folder:'); if (plId) cache.delete('playlist:' + plId);
  const test = c => c.name === 'playlists' || (c.name === 'playlist' && (!plId || c.params.id === plId)) || c.name === 'folders';
  refreshIf(test);
  setTimeout(() => { cache.delete('playlists'); if (plId) cache.delete('playlist:' + plId); refreshIf(test); }, 1800);
}
// Caché de vistas con tope (las más viejas salen primero): una sesión larga no hace crecer la memoria sin fin.
async function cached(key, fn) { if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; } const p = fn(); cache.set(key, p); p.catch(() => cache.delete(key)); while (cache.size > 400) cache.delete(cache.keys().next().value); return p; }

/* =========================================================
   Álbumes según las etiquetas de las canciones
   ========================================================= */
// Jellyfin arma sus álbumes por CARPETA: si muchas canciones comparten carpeta (p. ej. las que baja SomeDL), aparecen como
// un solo álbum gigante, y un mismo disco en dos carpetas sale partido. Nanuq los arma con las etiquetas de cada canción:
// «Álbum» + «Artista del álbum» (o su primer artista). «Álbum (Disc 2)» / «(CD 2)» se juntan con su disco.
// El índice (todas tus canciones) se guarda cifrado en el dispositivo y se renueva en segundo plano cada 10 minutos.
const albumNorm = v => String(v || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const ALBUM_DISC = /\s*[([]\s*(?:disc|disco|cd)\s*(\d{1,2})\s*[)\]]\s*$/i;
function albumKeyOf(t) {
  let name = String(t.album || '').trim(), disc = null;
  const m = ALBUM_DISC.exec(name); if (m && m.index > 0) { name = name.slice(0, m.index).trim(); disc = +m[1]; }
  const artist = String(t.albumArtist || '').trim() || String(t.trackArtist || t.artist || '').split(/,\s*/)[0].trim();
  return { key: albumNorm(artist) + '\u0001' + albumNorm(name), name, artist, disc };
}
// Id estable del álbum (sale de su artista y su nombre): «m» + 2 hashes en base 36. Solo letras y números.
const albumGid = key => { let a = 0x811c9dc5, b = 0x9e3779b1; for (let i = 0; i < key.length; i++) { const c = key.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519); } return 'm' + (a >>> 0).toString(36) + (b >>> 0).toString(36); };
const LIB = {
  data: null, at: 0, p: null, owner: null, TTL: 10 * 60e3,
  who() { return api ? api.kind + '|' + (api.base || '') + '|' + (api.userId || '') : ''; },
  // Índice listo (o la promesa del primero). Si está viejo, se usa igual y se renueva; onUpdate se llama si cambió.
  async index(onUpdate) {
    const w = this.who();
    if (this.owner !== w) {
      this.owner = w; this.data = null; this.at = 0; this.p = null;
      const c = api.kind === 'jellyfin' ? store.get('libIdx', null) : null;
      if (c && c.w === w && Array.isArray(c.t)) { try { this.data = this.build(c.t.map(x => this.unpack(x)).filter(Boolean)); this.at = num(c.at); } catch { this.data = null; } }
    }
    const stale = !this.data || Date.now() - this.at > this.TTL;
    if (stale && !this.p) this.p = this.refresh().finally(() => { this.p = null; });
    if (!this.data) { await this.p; return this.data; }
    if (stale && onUpdate && this.p) this.p.then(ch => { if (ch) onUpdate(); }).catch(() => { });
    return this.data;
  },
  peek() { return this.owner === this.who() ? this.data : null; }, // sin esperar (null si todavía no hay)
  reset() { this.at = 0; },
  async refresh() {
    const w = this.who(), tr = await this.fetchAll();
    if (w !== this.who()) return false;
    const old = this.data && this.data.sig; this.data = this.build(tr); this.at = Date.now(); this.save(tr, w);
    return old !== this.data.sig;
  },
  async fetchAll() {
    if (api.kind === 'demo') return api.tracksList.slice();
    const lim = 1000, q = { IncludeItemTypes: 'Audio', SortBy: 'AlbumArtist,Album,ParentIndexNumber,IndexNumber,SortName', Fields: 'ProductionYear,Genres,DateCreated,ParentId', Limit: lim };
    const first = await api.items({ ...q, StartIndex: 0 }), total = Math.min(num(first.total), 50000), pages = [first.items];
    const starts = []; for (let k = lim; k < total; k += lim) starts.push(k);
    let n = 0; // tres páginas a la vez
    await Promise.all(Array.from({ length: Math.min(3, starts.length) }, async () => { while (n < starts.length) { const k = starts[n++]; pages[k / lim] = (await api.items({ ...q, StartIndex: k })).items; } }));
    return pages.flat().filter(t => t && t.type === 'track' && t.id);
  },
  // Copia compacta para guardar (solo lo que se usa).
  pack: t => [t.id, t.name, t.artist, t.trackArtist, t.albumArtist, t.artistId, t.album, t.albumId, t.year, t.duration, t.index, t.disc, t.genres, t.imgId, t.imgTag, t.added, t.plays, t.lastPlayed, t.fav ? 1 : 0, t.hasLyrics == null ? null : t.hasLyrics ? 1 : 0],
  unpack(x) {
    if (!Array.isArray(x) || !sid(x[0])) return null;
    const S = v => String(v ?? '').slice(0, 400);
    return { id: sid(x[0]), name: S(x[1]) || tx('Sin título'), type: 'track', artist: S(x[2]), trackArtist: S(x[3]), albumArtist: S(x[4]), artistId: sid(x[5]), album: S(x[6]), albumId: sid(x[7]), year: numOrNull(x[8]), duration: num(x[9]), index: numOrNull(x[10]), disc: numOrNull(x[11]), genres: Array.isArray(x[12]) ? x[12].slice(0, 10).map(S) : [], imgId: sid(x[13]), imgTag: sid(x[14]), added: num(x[15]), plays: num(x[16]), lastPlayed: num(x[17]), fav: !!x[18], hasLyrics: x[19] == null ? null : !!x[19] };
  },
  save(tr, w) {
    if (api.kind !== 'jellyfin') return;
    const v = { w, at: this.at, t: tr.map(this.pack) };
    if (JSON.stringify(v).length < 2e6) store.set('libIdx', v); else store.del('libIdx'); // bibliotecas enormes: solo en memoria
  },
  build(tracks) {
    const groups = new Map();
    for (const t0 of tracks) {
      const k = albumKeyOf(t0), t = k.disc && !t0.disc ? { ...t0, disc: k.disc } : t0;
      let g = groups.get(k.key); if (!g) groups.set(k.key, g = { key: k.key, name: k.name, artist: k.artist, tracks: [] });
      g.tracks.push(t);
    }
    const albums = new Map(), byTrack = new Map(), byJf = new Map(); let sig = 0;
    for (const g of groups.values()) {
      const id = albumGid(g.key), all = g.tracks.sort((a, b) => (a.disc || 1) - (b.disc || 1) || (a.index ?? 9999) - (b.index ?? 9999) || String(a.name).localeCompare(String(b.name), 'es'));
      // El mismo disco bajado dos veces (en dos carpetas) se junta aquí: cada canción una sola vez (mismo disco, número y
      // título; sin número, mismo título y duración), la copia más escuchada.
      const dupKey = t => (t.disc || 1) + '|' + (t.index ?? 'd' + Math.round((t.duration || 0) / 3)) + '|' + albumNorm(t.name), keep = new Map();
      for (const t of all) { const k = dupKey(t), o = keep.get(k); if (!o || (t.plays || 0) > (o.plays || 0) || (!!t.fav && !o.fav)) keep.set(k, t); }
      const tr = all.filter(t => keep.get(dupKey(t)) === t);
      const most = f => { const c = new Map(); let best = null, n = 0; for (const t of tr) { const v = f(t); if (v != null && v !== '') c.set(v, (c.get(v) || 0) + 1); } for (const [v, k] of c) if (k > n) { best = v; n = k; } return best; };
      const img = tr.find(t => t.imgId), gc = new Map();
      for (const t of tr) for (const x of t.genres || []) gc.set(x, (gc.get(x) || 0) + 1);
      const a = { id, type: 'album', name: g.name || tx('Sin álbum'), artist: g.artist, artistId: most(t => t.artistId), year: most(t => t.year), imgId: img ? img.imgId : null, imgTag: img ? img.imgTag : null, genres: [...gc].sort((x, y) => y[1] - x[1]).slice(0, 2).map(x => x[0]), count: tr.length, duration: tr.reduce((s2, t) => s2 + (t.duration || 0), 0), added: Math.max(0, ...tr.map(t => t.added || 0)), tracks: tr };
      albums.set(id, a);
      for (const t of all) { byTrack.set(t.id, id); if (t.albumId) { if (!byJf.has(t.albumId)) byJf.set(t.albumId, new Set()); byJf.get(t.albumId).add(id); } sig = (Math.imul(sig, 31) + t.id.charCodeAt(0) + t.id.charCodeAt(t.id.length - 1) * 7 + id.length) | 0; }
    }
    return { albums, list: [...albums.values()], byTrack, byJf, sig: tracks.length + ':' + albums.size + ':' + sig };
  },
  // Álbumes (según etiquetas) de un grupo de canciones, de más a menos canciones.
  albumsOf(tracks) {
    const L = this.peek(); if (!L) return null;
    const seen = new Map(); for (const t of tracks) { const id = L.byTrack.get(t.id); if (id) seen.set(id, (seen.get(id) || 0) + 1); }
    return [...seen].sort((a, b) => b[1] - a[1]).map(([id]) => L.albums.get(id)).filter(Boolean);
  },
  sorted(sort) {
    const l = this.peek() ? this.peek().list.slice() : [];
    const c = (x, y) => String(x || '').localeCompare(String(y || ''), 'es', { sensitivity: 'base' });
    if (sort === 'artist') l.sort((a, b) => c(a.artist, b.artist) || c(a.name, b.name));
    else if (sort === 'recent') l.sort((a, b) => b.added - a.added || c(a.name, b.name));
    else if (sort === 'year') l.sort((a, b) => (b.year || 0) - (a.year || 0) || c(a.name, b.name));
    else if (sort === 'random') { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } }
    else l.sort((a, b) => c(a.name, b.name) || c(a.artist, b.artist));
    return l;
  }
};

/* =========================================================
   Búsqueda en las letras («no sé cómo se llama, pero me sé la letra»)
   ========================================================= */
// Jellyfin no busca dentro de las letras: Nanuq arma su propio índice con las letras de las canciones que Jellyfin marca
// con letra (HasLyrics; en servidores que no lo dicen, todas) más las guardadas en este dispositivo. Se arma la primera
// vez que buscas, de a 3 canciones a la vez, y después solo se agregan las nuevas. Se guarda en el almacén cifrado
// (si cabe: ≤ 6 MB). Las letras son datos del servidor: se tratan como texto (esc) y se acotan.
const lyrNorm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const LYRX = {
  w: '', map: new Map(), none: new Set(), busy: null, done: 0, total: 0, saveT: 0,
  load() {
    const w = LIB.who(); if (this.w === w) return;
    this.w = w; this.map = new Map(); this.none = new Set(); this.busy = null;
    const c = api && api.kind === 'jellyfin' ? store.get('lyrIdx', null) : null;
    if (c && c.w === w && Array.isArray(c.l)) {
      for (const x of c.l.slice(0, 20000)) if (Array.isArray(x) && sid(x[0]) && typeof x[1] === 'string') this.add(sid(x[0]), x[1]);
      for (const id of Array.isArray(c.none) ? c.none.slice(0, 60000) : []) if (sid(id)) this.none.add(sid(id));
    }
  },
  add(id, text) { text = String(text).slice(0, 20000); this.map.set(id, { text, n: lyrNorm(text) }); },
  save() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => {
      if (!api || api.kind !== 'jellyfin' || this.w !== LIB.who()) return;
      const v = { w: this.w, l: [...this.map].map(([id, e]) => [id, e.text]), none: [...this.none] };
      if (JSON.stringify(v).length < 6e6) store.set('lyrIdx', v); else store.del('lyrIdx'); // bibliotecas enormes: solo en memoria
    }, 1500);
  },
  reset() { this.w = ''; this.map = new Map(); this.none = new Set(); store.del('lyrIdx'); },
  // Arma (o completa) el índice. onProgress(hechas, total) durante; devuelve cuando termina.
  build(onProgress) {
    this.load();
    this.onProgress = onProgress;
    if (this.busy) return this.busy;
    return (this.busy = (async () => {
      try {
        const L = await LIB.index(); if (!L) return;
        const all = L.list.flatMap(a => a.tracks), known = all.some(t => t.hasLyrics === true);
        const todo = all.filter(t => !this.map.has(t.id) && !this.none.has(t.id) && (known ? t.hasLyrics === true || !!store.get(lrcKey(t.id), null) : t.hasLyrics !== false)).slice(0, 8000);
        this.total = todo.length; this.done = 0; let k = 0;
        const w = this.w;
        await Promise.all(Array.from({ length: 3 }, async () => {
          while (k < todo.length && this.w === w) {
            const t = todo[k++];
            let L2 = null; try { L2 = localLyrics(t) || await api.lyrics(t); } catch (e) { if (e.code === 401) throw e; }
            const text = L2 ? L2.lines.map(l => l.text).filter(Boolean).join('\n') : '';
            if (text) this.add(t.id, text); else this.none.add(t.id);
            this.done++; if (this.onProgress) this.onProgress(this.done, this.total);
            if (this.done % 50 === 0) this.save();
          }
        }));
        this.save();
      } finally { this.busy = null; }
    })());
  },
  // Canciones cuya letra contiene el texto (sin importar acentos, mayúsculas ni signos), con la línea que coincide.
  search(q) {
    this.load();
    const qn = lyrNorm(q); if (qn.length < 4) return [];
    const L = LIB.peek(); if (!L) return [];
    const out = [];
    for (const [id, e] of this.map) {
      if (!e.n.includes(qn)) continue;
      const a = L.albums.get(L.byTrack.get(id)), t = a && a.tracks.find(x => x.id === id); if (!t) continue;
      const lines = e.text.split('\n'), first = qn.split(' ')[0];
      const line = lines.find(l => lyrNorm(l).includes(qn)) || lines.find(l => lyrNorm(l).includes(first)) || '';
      out.push({ t, line: line.slice(0, 200) });
      if (out.length >= 40) break;
    }
    return out;
  }
};
// Una línea de letra con lo que buscaste resaltado, palabra por palabra (todo escapado).
function lyrSnippetHTML(line, q) {
  const words = lyrNorm(q).split(' ').filter(x => x.length > 1);
  if (!words.length) return esc(line);
  return String(line).split(/(\s+)/).map(part => { const n = lyrNorm(part); return n && words.some(w => n.includes(w)) ? `<mark>${esc(part)}</mark>` : esc(part); }).join('');
}
function lyricsHitsHTML(hits, q, act = 'play-list') {
  const tracks = hits.map(h => h.t), k = regList(tracks);
  return `<div class="tracks songs lyrhits">${hits.map((h, i) => `<div class="tr${P.cur && P.cur.id === h.t.id ? ' cur' : ''}" data-tid="${esc(h.t.id)}"><button class="n thb" data-act="${act}" data-l="${k}" data-i="${i}">${coverHTML(h.t, 80)}</button><button class="t" data-act="${act}" data-l="${k}" data-i="${i}"><span class="tn">${esc(h.t.name)}</span><small>${esc(h.t.trackArtist || h.t.artist || '')}</small><small class="lyrline">«${lyrSnippetHTML(h.line, q)}»</small></button><span class="d">${h.t.duration ? fmt(h.t.duration) : ''}</span>${act === 'play-list' ? `<button class="more" data-act="track-menu" data-l="${k}" data-i="${i}" aria-label="${tx('Opciones')}">${ic('more')}</button>` : '<span></span>'}</div>`).join('')}</div>`;
}
// Sección «En las letras» de un buscador: la arma dentro de box y la va completando mientras se indexa.
async function lyricsSection(box, v, isCurrent, act, onDone) {
  if (!box || !api || lyrNorm(v).length < 4) { if (box) box.innerHTML = ''; return; }
  const paint = (building) => {
    if (!isCurrent()) return;
    const hits = LYRX.search(v);
    const prog = building && LYRX.total ? `<div class="muted lyrprog">${tx('Buscando también en las letras de tus canciones…')} ${LYRX.done.toLocaleString(LOC)} ${tx('de')} ${LYRX.total.toLocaleString(LOC)}</div>` : '';
    box.innerHTML = (hits.length ? `<div class="letter">${tx('En las letras')}</div>${lyricsHitsHTML(hits, v, act)}` : '') + prog;
  };
  paint(true);
  let last = 0;
  try { await LYRX.build(() => { if (Date.now() - last > 1500) { last = Date.now(); paint(true); } }); } catch { }
  paint(false);
  if (onDone && isCurrent()) onDone(LYRX.search(v).length);
}

/* =========================================================
   Rendering helpers
   ========================================================= */
function coverHTML(it, size = 300, cls = '') {
  const u = api && api.img(it, size);
  const icon = it && it.type === 'artist' ? 'user' : it && it.type === 'folder' ? 'folder' : it && it.type === 'playlist' ? 'list' : it && it.type === 'genre' ? 'tag' : 'music';
  return `<div class="cover ${cls}"><div class="ph">${ic(icon)}</div>${u ? `<img src="${esc(u)}" alt="" loading="lazy" decoding="async" data-rm>` : ''}</div>`;
}
function head(title, actions = '', showBack, logo = true) {
  const b = (showBack ?? S.stack.length > 1) && !document.body.classList.contains('in-party') && !document.body.classList.contains('party-host'); // en la fiesta no hay a dónde regresar
  return `<div class="head">${b ? `<button class="cbtn back" data-act="back" aria-label="${tx('Atrás')}">${ic('left')}</button>` : ''}<h1 title="${esc(title)}">${esc(title)}</h1><div class="btns">${actions}</div>${logo ? '<span class="hlogo bear ' + bearState() + '" aria-hidden="true">' + bearHTML() + '</span>' : ''}</div>`;
}
const albumCard = a => `<button class="card" data-act="open" data-r="album" data-id="${esc(a.id)}">${coverHTML(a)}<div class="t">${esc(a.name)}</div><div class="s">${esc(a.artist || '')}${a.year ? ' · ' + a.year : ''}</div></button>`;
const artistCard = a => `<button class="card round" data-act="open" data-r="artist" data-id="${esc(a.id)}" data-name="${esc(a.name)}">${coverHTML(a)}<div class="t">${esc(a.name)}</div>${a.count ? `<div class="s">${a.count} ${a.count === 1 ? tx('álbum') : tx('álbumes')}</div>` : ''}</button>`;
function trackRows(tracks, o = {}) { return `<div class="tracks${o.cls ? ' ' + o.cls : ''}">${rowsHTML(tracks, o)}</div>`; }
function rowsHTML(tracks, { showArtist = false, showAlbum = false, discs = true, key, offset = 0, thumbs = false } = {}) {
  const k = key || regList(tracks);
  const multi = discs && new Set(tracks.map(t => t.disc || 1)).size > 1;
  let html = '', lastDisc = null;
  tracks.forEach((t, j) => {
    const i = j + offset;
    if (multi && t.disc !== lastDisc) { lastDisc = t.disc; html += `<div class="disc">${tx('Disco')} ${t.disc || 1}</div>`; }
    const sub = [showArtist && t.trackArtist, showAlbum && t.album].filter(Boolean).join(' · ');
    html += `<div class="tr${P.cur && P.cur.id === t.id ? ' cur' : ''}" data-tid="${esc(t.id)}"><button class="n${thumbs ? ' thb' : ''}" data-act="play-list" data-l="${k}" data-i="${i}">${thumbs ? coverHTML(t, 80) : (showAlbum || !t.index ? i + 1 : t.index) + '.'}</button><button class="t" data-act="play-list" data-l="${k}" data-i="${i}"><span class="tn">${esc(t.name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button><span class="d">${t.duration ? fmt(t.duration) : ''}</span><button class="more" data-act="track-menu" data-l="${k}" data-i="${i}" aria-label="${tx('Opciones')}">${ic('more')}</button></div>`;
  });
  return html;
}
const loading = () => '<div class="spin"></div>';
function errBox(e) { return `<div class="err"><b>${tx('No se pudo cargar')}</b>${esc(e.message || e)}<div style="margin-top:12px"><button class="btn" data-act="retry">${tx('Reintentar')}</button></div></div>`; }

/* =========================================================
   Views
   ========================================================= */
const V = {};
V.albums = async (el) => {
  const sorts = [['name', tx('Nombre')], ['artist', tx('Artista')], ['recent', tx('Añadidos recientemente')], ['year', tx('Año')], ['random', tx('Aleatorio')]];
  el.innerHTML = head(tx('Álbumes')) + `<div class="toolbar"><select class="sel" id="aSort" aria-label="${tx('Ordenar')}">${sorts.map(([k, n]) => `<option value="${k}"${Settings.albumSort === k ? ' selected' : ''}>${n}</option>`).join('')}</select><span class="muted" id="aCount"></span></div><div class="grid" id="aGrid">${LIB.peek() ? '' : loading() + ('<p class="muted" style="text-align:center">' + tx('Ordenando tus álbumes con los datos de tus canciones…') + '</p>')}</div><div class="sentinel" id="aMore"></div>`;
  $('#aSort', el).onchange = e => { Settings.set('albumSort', e.target.value); render(); };
  // Álbumes armados con las etiquetas de tus canciones (ver LIB). Si el índice cambia en segundo plano, se redibuja.
  await LIB.index(() => refreshIf(c => c.name === 'albums'));
  const all = LIB.sorted(Settings.albumSort), grid = $('#aGrid', el), more = $('#aMore', el);
  $('#aCount', el).textContent = all.length.toLocaleString(LOC) + tx(' álbumes');
  if (!all.length) { grid.outerHTML = ('<div class="empty">' + tx('Tu biblioteca de música está vacía.') + '</div>'); return; }
  let shown = 0;
  const step = () => { if (shown >= all.length) return; grid.insertAdjacentHTML('beforeend', all.slice(shown, shown + 120).map(albumCard).join('')); shown += 120; };
  grid.innerHTML = ''; step();
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) step(); }, { root: $('#main'), rootMargin: '800px' });
  io.observe(more); el._cleanup = () => io.disconnect();
};
V.album = async (el, { id, tid }) => {
  el.innerHTML = head(tx('Álbum')) + loading();
  // El álbum según las etiquetas: por su id («m…»), por la canción desde la que llegaste o por el álbum de Jellyfin si
  // corresponde a uno solo. Si no, el álbum de Jellyfin tal cual (como antes).
  const find = L => L && (L.albums.get(id) || (tid && L.albums.get(L.byTrack.get(tid))) || (L.byJf.get(id)?.size === 1 ? L.albums.get([...L.byJf.get(id)][0]) : null));
  let a = null, tracks;
  try { let L = await LIB.index(() => refreshIf(c => c.name === 'album' && c.params.id === id)); a = find(L); if (!a && /^m[0-9a-z]+$/.test(id)) { await LIB.refresh(); a = find(LIB.peek()); } } catch (e) { if (e.code === 401) throw e; }
  if (a) tracks = a.tracks;
  else if (!id || /^m[0-9a-z]+$/.test(String(id))) { el.innerHTML = head(tx('Álbum')) + ('<div class="empty">' + tx('Este álbum ya no está en tu biblioteca.') + '</div>'); return; }
  else ({ album: a, tracks } = await cached('album:' + id, () => api.album(id)));
  const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const k = regList(tracks);
  el.innerHTML = head(a.name, `<button class="btn" data-act="play-list" data-l="${k}" data-i="0">${ic('play', 1)}<span class="lb">${tx('Reproducir')}</span></button><button class="btn" data-act="queue-list" data-l="${k}">${ic('qadd')}<span class="lb">${tx('A la cola')}</span></button>`)
    + `<div class="byline">${a.artist ? `${tx('De&nbsp;')}<a href="#" data-act="open" data-r="artist" data-id="${esc(a.artistId || '')}" data-name="${esc(a.artist)}">${esc(a.artist)}</a>` : ''}<span class="sp"></span>${(a.genres || []).slice(0, 2).map(g => `<span class="chip">${esc(g)}</span>`).join('')}</div>`
    + `<div class="album"><div class="art">${coverHTML(a, 600)}<div class="cap">${esc(a.name)}${a.year ? ' (' + a.year + ')' : ''} · ${tracks.length} ${tx('pistas ·')} ${fmt(dur)}</div></div>${tracks.length ? trackRows(tracks, { showArtist: tracks.some(t => t.trackArtist && t.trackArtist !== a.artist) }) : ('<div class="empty">' + tx('Este álbum no tiene pistas.') + '</div>')}</div>`;
};
/* ---------- Inicio: mosaicos ---------- */
const MIXES = [
  { k: 'top', name: tx('Más escuchadas'), sub: tx('Lo que más suena'), icon: 'flame', c: ['#ff7a45', '#d6246e'], q: { sort: 'PlayCount,SortName', filters: 'IsPlayed' }, group: 'mine' },
  { k: 'new', name: tx('Recién agregadas'), sub: tx('Lo último en tu biblioteca'), icon: 'new', c: ['#22c1a6', '#1a6fb3'], q: { sort: 'DateCreated,SortName' }, group: 'mine' },
  { k: 'recent', name: tx('Escuchadas hace poco'), sub: tx('Vuelve a lo de ayer'), icon: 'history', c: ['#6d7cff', '#3b2f9e'], q: { sort: 'DatePlayed,SortName', filters: 'IsPlayed' }, group: 'mine' },
  { k: 'fav', name: tx('Favoritas'), sub: tx('Las que marcaste con ♥'), icon: 'heart', c: ['#ff5f8f', '#a4166b'], q: { sort: 'Random', filters: 'IsFavorite' }, group: 'mine', random: true },
  { k: 'discover', name: tx('Por descubrir'), sub: tx('Nunca las has escuchado'), icon: 'compass', c: ['#f5b83d', '#c25a12'], q: { sort: 'Random', filters: 'IsUnplayed' }, group: 'mine', random: true },
  { k: 'random', name: tx('Al azar'), sub: tx('Toda tu biblioteca'), icon: 'dice', c: ['#5b6b86', '#27324a'], q: { sort: 'Random' }, group: 'mine', random: true },
  { k: 'energy', name: tx('Energía'), icon: 'bolt', c: ['#ff9a2e', '#e3342f'], kw: ['rock', 'metal', 'punk', 'electro', 'edm', 'dance', 'house', 'techno', 'drum', 'dubstep', 'trap', 'hard', 'grunge', 'ska', 'industrial'], not: ['post-rock', 'post rock', 'soft rock', 'folk rock', 'deep house'], group: 'mood', random: true },
  { k: 'chill', name: tx('Relajado'), icon: 'leaf', c: ['#3fd0c9', '#2563a8'], kw: ['ambient', 'chill', 'lofi', 'lo-fi', 'acoust', 'acust', 'jazz', 'bossa', 'downtempo', 'new age', 'reggae', 'soul', 'r&b', 'trip'], group: 'mood', random: true },
  { k: 'focus', name: tx('Concentración'), icon: 'target', c: ['#7b6cff', '#3a2a8f'], kw: ['classical', 'clasic', 'clásic', 'neoclas', 'instrumental', 'soundtrack', 'score', 'banda sonora', 'piano', 'ambient', 'post-rock', 'minimal', 'orchestr', 'orquest'], group: 'mood', random: true },
  { k: 'party', name: tx('Fiesta'), icon: 'spark', c: ['#ff4fa3', '#ff8a3d'], kw: ['pop', 'reggaeton', 'latin', 'latino', 'dance', 'hip hop', 'hip-hop', 'rap', 'cumbia', 'salsa', 'bachata', 'disco', 'funk', 'urbano', 'k-pop', 'merengue', 'electropop'], group: 'mood', random: true },
  { k: 'nostalgia', name: tx('Nostalgia'), icon: 'clock', c: ['#e0a24a', '#7a3e1d'], kw: ['oldies', 'classic rock', 'bolero', 'motown', 'retro', '60', '70', '80', '90', 'ranchera', 'trova', 'doo'], years: true, group: 'mood', random: true },
  { k: 'blue', name: tx('Melancolía'), icon: 'rain', c: ['#6f8bb3', '#28324f'], kw: ['indie', 'alternativ', 'blues', 'ballad', 'balada', 'emo', 'sad', 'singer', 'cantautor', 'shoegaze', 'slowcore', 'folk', 'dream'], group: 'mood', random: true }
];
const normTxt = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function mixDef(k) {
  const m = MIXES.find(x => x.k === k); if (!m) return null;
  if (m.group !== 'mood') return { ...m };
  const genres = await cached('genres', () => api.genres()).catch(() => []);
  const kws = m.kw.map(normTxt);
  const nots = (m.not || []).map(normTxt);
  const hit = genres.filter(g => { const n = normTxt(g.name); if (nots.some(w => n.includes(w))) return false; return kws.some(w => /^\d+$/.test(w) ? new RegExp('(^|\\D)' + w + '(s|\\D|$)').test(n) : n.includes(w)); });
  const q = { sort: 'Random' };
  if (hit.length) q.genreIds = hit.slice(0, 40).map(g => g.id);
  else if (m.years) { q.years = []; for (let y = 1950; y < 2000; y++) q.years.push(y); }
  else return { ...m, q: null };
  const sub = hit.length ? hit.slice(0, 3).map(g => g.name).join(', ') + (hit.length > 3 ? '…' : '') : tx('Música anterior al 2000');
  return { ...m, q, sub };
}
const mixTracks = (d, limit = 100) => cached('mix:' + d.k + ':' + limit, () => api.mix(d.q, limit));
function greeting() { const h = new Date().getHours(); return h < 6 ? tx('Buenas noches') : h < 12 ? tx('Buenos días') : h < 20 ? tx('Buenas tardes') : tx('Buenas noches'); }
/* =========================================================
   DJ Nanuq: como un DJ de radio, arma una sesión por rondas con tu propia biblioteca y presenta cada una.
   Sin IA: reglas sobre tu historial de Jellyfin (lo más escuchado, lo reciente, favoritas, olvidadas,
   por descubrir en tus géneros, recién agregadas, una década y el ánimo según la hora).
   ========================================================= */
// DJ Nanuq: el oso del logo (icons/logo.webp, en vector en las <defs>) con audífonos, bufanda del color del tema
// y tornamesa. Con la clase «on» mueve la cabeza, se mece la bufanda y giran los discos.
function djBearSVG(cls = '') {
  const A = 'var(--accent)', AD = 'color-mix(in srgb,var(--accent) 64%,#000)', AL = 'color-mix(in srgb,var(--accent) 72%,#fff)', N = '#0d2a66';
  const u = id => `<use href="#djb-${id}"/>`;
  const plat = x => `<g transform="translate(${x} 318) scale(1 .26)"><circle r="54" fill="#0e1320"/><g class="dj-spin"><circle r="38" fill="none" stroke="#273049" stroke-width="5"/><circle r="22" fill="none" stroke="#273049" stroke-width="4"/><circle r="17" style="fill:${A}"/><rect x="-4" y="-50" width="8" height="20" rx="3" fill="#d5deea"/></g><circle r="4" fill="#d5deea"/></g>`;
  return `<svg class="djbear ${cls}" viewBox="-24 -44 408 432" aria-hidden="true">
  <g class="dj-notes" style="fill:${A}"><path d="M-4 84V52l24-6v28" fill="none" style="stroke:${A}" stroke-width="5" stroke-linecap="round"/><circle cx="-9" cy="86" r="9"/><circle cx="15" cy="78" r="9"/><path d="M348 20V-6l18-5" fill="none" style="stroke:${A}" stroke-width="5" stroke-linecap="round"/><circle cx="343" cy="22" r="8"/></g>
  <g class="dj-body">${u('body')}${u('belly')}</g>
  <g class="dj-head">
    ${u('head')}${u('muzzle')}${u('nose')}
    <g class="dj-eyes">${u('eyes')}</g>
    <g class="dj-blush" fill="#ff9fb4"><ellipse cx="96" cy="112" rx="17" ry="9"/><ellipse cx="264" cy="112" rx="17" ry="9"/></g>
    <path d="M58 96C50 -16 310 -16 302 96" fill="none" stroke="${N}" stroke-width="15" stroke-linecap="round"/>
    <path d="M68 66C70 2 290 2 292 66" fill="none" style="stroke:${AL}" stroke-width="4" stroke-linecap="round" opacity=".8"/>
    <rect x="38" y="66" width="40" height="64" rx="19" fill="${N}"/><rect x="46" y="76" width="24" height="44" rx="12" style="fill:${A}"/>
    <rect x="282" y="66" width="40" height="64" rx="19" fill="${N}"/><rect x="290" y="76" width="24" height="44" rx="12" style="fill:${A}"/>
  </g>
  <g class="dj-scarf">
    <path d="M44 166Q180 198 316 166Q326 182 318 200Q180 236 42 200Q34 182 44 166Z" style="fill:${A}"/>
    <path d="M46 184Q180 216 314 184" fill="none" style="stroke:${AD}" stroke-width="6" opacity=".55"/>
    <g class="dj-tails">
      <path d="M92 204L70 286L104 292L118 210Z" style="fill:${AD}"/>
      <path d="M112 206L102 300L138 302L138 208Z" style="fill:${A}"/>
      <path d="M104 236L138 238M103 262L137 264" style="stroke:${AD}" stroke-width="7"/>
      <path d="M106 300l-2 10M115 301l-2 10M124 301l-1 10M133 302l-1 10" style="stroke:${A}" stroke-width="4" stroke-linecap="round"/>
    </g>
    <ellipse cx="120" cy="204" rx="22" ry="16" style="fill:${A}"/><path d="M106 198Q120 192 134 198" fill="none" style="stroke:${AD}" stroke-width="4" stroke-linecap="round" opacity=".6"/>
  </g>
  <g class="dj-deck">
    <path d="M0 332H360L344 304H16Z" fill="#2b3450"/>
    ${plat(96)}${plat(264)}
    <rect x="164" y="309" width="32" height="16" rx="3" fill="#1a2030"/><rect x="174" y="311" width="12" height="12" rx="2" style="fill:${A}"/>
    <rect x="-6" y="330" width="372" height="56" rx="12" fill="#1e2537"/>
    <g class="dj-leds" style="fill:${A}"><circle cx="24" cy="358" r="7"/><circle cx="46" cy="358" r="7" opacity=".55"/><circle cx="68" cy="358" r="7" opacity=".3"/></g>
    <rect x="146" y="352" width="68" height="11" rx="5.5" fill="#2b3450"/><rect x="168" y="346" width="16" height="23" rx="4" fill="#d5deea"/>
    <circle cx="300" cy="358" r="11" fill="#2b3450"/><circle cx="334" cy="358" r="11" fill="#2b3450"/>
  </g>
  <g class="dj-paws" fill="#fff"><ellipse class="dj-paw1" cx="122" cy="312" rx="30" ry="15"/><ellipse cx="244" cy="310" rx="28" ry="14"/><g fill="#daeaf9"><ellipse cx="122" cy="315" rx="13" ry="6"/><ellipse cx="244" cy="313" rx="12" ry="6"/></g></g>
</svg>`;
}

const DJ_SEGS = {
  top: { name: tx('Lo que más escuchas'), q: { sort: 'PlayCount,SortName', filters: 'IsPlayed' }, lines: [tx('Arrancamos con las que más suenan en tu casa: {a}.'), tx('Lo que nunca falla: {a}. Tus clásicos de siempre.'), tx('Empecemos fuerte, con las que más pones: {a}.')] },
  recent: { name: tx('Lo de estos días'), q: { sort: 'DatePlayed,SortName', filters: 'IsPlayed' }, lines: [tx('Volvamos a lo que traías estos días: {a}.'), tx('Esto lo escuchaste hace poco y te gustó: {a}.')] },
  forgotten: { name: tx('Rescate de olvidadas'), q: { sort: 'DatePlayed,SortName', order: 'Ascending', filters: 'IsPlayed' }, lines: [tx('Hace mucho que no escuchas a {a}. Vamos a refrescar la memoria.'), tx('Rescaté unas que tenías olvidadas: {a}.')] },
  fav: { name: tx('Tus favoritas'), q: { sort: 'Random', filters: 'IsFavorite' }, lines: [tx('Ahora, directo del corazón: tus favoritas, con {a}.'), tx('Las que marcaste con corazón: {a}.')] },
  discover: { name: tx('Por descubrir'), q: { sort: 'Random', filters: 'IsUnplayed' }, n: 4, lines: [tx('Algo nuevo para ti{g}: estas nunca las has escuchado. Empezamos con {a}.'), tx('Hora de descubrir{g}. Nunca has puesto a {a}.')] },
  fresh: { name: tx('Recién llegadas'), q: { sort: 'DateCreated,SortName' }, lines: [tx('Recién llegado a tu biblioteca: {a}.'), tx('Esto acaba de entrar a tu colección: {a}. Vamos a estrenarlo.')] },
  genre: { name: tx('Ronda de género'), q: null, lines: [tx('Ahora, una ronda de {G}: {a}.'), tx('Cambiamos a {G}, con {a}.'), tx('Puro {G} de tu biblioteca: {a}.'), tx('Se me antojó {G}. Va {a}.')], stale: [tx('Desempolvé algo de {G} que tenías olvidado: {a}.'), tx('{G} que hace mucho no escuchas: {a}.')] },
  decade: { name: tx('Viaje en el tiempo'), q: null, lines: [tx('Viajemos a los {d}: {a}.'), tx('Máquina del tiempo encendida: los {d}, con {a}.'), tx('Nos vamos a los {d}, con {a}.')] },
  mood: { name: tx('Para este momento'), q: null, lines: [tx('Para esta {m}, algo {v}: {a}.'), 'Esta {m} pide algo {v}. Va {a}.'] }
};
// Ánimo según la hora: mezcla de «Según tu ánimo» y cómo se presenta.
const djMoment = () => { const h = new Date().getHours(); return h >= 6 && h < 12 ? [tx('mañana'), 'chill', tx('tranquilo')] : h >= 12 && h < 19 ? [tx('tarde'), 'energy', tx('con energía')] : h >= 19 ? [tx('noche'), 'party', tx('para animarla')] : [tx('madrugada'), 'blue', tx('para la madrugada')]; };
const pick = l => l[Math.floor(Math.random() * l.length)];
// Elección al azar con pesos: [[valor, peso], …].
const wpick = l => { let r = Math.random() * l.reduce((t, x) => t + x[1], 0); for (const [v, w] of l) if ((r -= w) <= 0) return v; return l.length ? l[l.length - 1][0] : null; };
// Ordena al azar dando más chance de ir adelante a lo que pesa más (devuelve solo los valores).
const wshuffle = l => l.map(([v, w]) => [v, -Math.log(1 - Math.random()) / w]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
// Las canciones del DJ llevan su ronda en el id de la cola (PlaylistItemId), que Jellyfin les muestra a tus otros
// dispositivos: «dj-<sesión>-<ronda>-<al azar>». Así el que controla desde otro lado sabe que suena el DJ y en qué ronda va.
const djQid = (s, i) => `dj-${String(s).slice(0, 12)}-${i}-${uid().slice(0, 10)}`;
const djTag = q => { const m = /^dj-([A-Za-z0-9]{6,32})-(\d{1,5})-[A-Za-z0-9]+$/.exec(String(q || '')); return m ? { s: m[1], i: +m[2] } : null; };
const djSame = (a, b) => !!a && !!b && String(a).slice(0, 12) === String(b).slice(0, 12);
const DJ = {
  active: false, session: '', segs: {}, used: new Set(), pools: {}, lastI: -1, busy: null, line: '', recentTypes: [], themes: [],
  voiceOk: () => !!(window.speechSynthesis && window.SpeechSynthesisUtterance) && speechSynthesis.getVoices().some(v => v.lang && v.lang.toLowerCase().startsWith(LANG)),
  save() {
    if (this.active) store.set('dj', { session: this.session, segs: this.segs, used: [...this.used].slice(-1500), recentTypes: this.recentTypes, themes: this.themes }); else store.del('dj');
    // Tus otros dispositivos ven las rondas (y pueden seguir la sesión): se comparte por tu Jellyfin.
    if (this.active) DJSHARE.pushSoon(); else if (DJSHARE.mine) DJSHARE.offSoon();
  },
  restore() {
    const d = store.get('dj', null);
    if (!d || !P.cur || P.cur.djS !== d.session) { this.active = false; store.del('dj'); return; }
    Object.assign(this, { active: true, session: d.session, segs: d.segs || {}, used: new Set(d.used || []), recentTypes: d.recentTypes || [], themes: d.themes || [], lastI: P.cur.djI, pools: {} });
    this.line = (this.segs[P.cur.djI] || {}).line || '';
  },
  // Una muestra al azar de toda la biblioteca: de ahí salen los géneros y las décadas que de verdad tienes.
  async sample() {
    if (this.pools.sample) return this.pools.sample;
    const l = await api.mix({ sort: 'Random' }, 400).catch(() => []);
    return (this.pools.sample = l.filter(t => t.type === 'track'));
  },
  // Lo que más suena: las rondas temáticas lo dejan al final para no repetir lo de siempre.
  async heavy() {
    if (this.pools.heavy) return this.pools.heavy;
    const top = await this.pool('top').catch(() => []);
    return (this.pools.heavy = new Set(top.map(t => t.id))); // tus 60 más escuchadas
  },
  // Género de la ronda: cualquiera de tu biblioteca con suficientes canciones, sin repetir los de hace poco.
  async pickGenre() {
    const c = new Map();
    for (const t of await this.sample()) for (const g of t.genres || []) { const k = g.trim(); if (k) c.set(k, (c.get(k) || 0) + 1); }
    // Con pocos géneros se bloquean menos, para que siempre quede de dónde elegir.
    const recent = this.themes.filter(x => x.startsWith('g:')).slice(0, Math.min(6, Math.floor(c.size / 2))).map(x => x.slice(2));
    let l = [...c].filter(([g, n]) => n >= 3 && !recent.includes(g));
    if (!l.length) l = [...c].filter(([g]) => !recent.includes(g));
    return wpick(l.map(([g, n]) => [g, Math.sqrt(n)]));
  },
  // Década de la ronda: las que hay en tu biblioteca, sin repetir las de hace poco.
  async pickDecade() {
    const now = Math.floor(new Date().getFullYear() / 10) * 10, c = new Map();
    for (const t of await this.sample()) if (t.year && t.year >= 1940 && t.year <= new Date().getFullYear()) { const d = Math.floor(t.year / 10) * 10; c.set(d, (c.get(d) || 0) + 1); }
    const recent = this.themes.filter(x => x.startsWith('d:')).slice(0, 3).map(x => +x.slice(2));
    let l = [...c].filter(([d, n]) => n >= 3 && !recent.includes(d));
    if (!l.length) l = [...c].filter(([d]) => d < now);
    if (!l.length) return pick([1970, 1980, 1990, 2000]);
    // Las décadas pasadas pesan más: la de ahora ya sale en otras rondas.
    return wpick(l.map(([d, n]) => [d, Math.sqrt(n) * (d < now ? 1.5 : 1)]));
  },
  // Qué tan «gastada» está una canción para el DJ (más bajo = va antes). Lo que sonó en los últimos 3 días o que el DJ ya
  // puso en sesiones recientes casi no entra; lo nunca escuchado va casi primero (es para explorar tu biblioteca).
  rank(t, heavy, now) {
    const days = t.lastPlayed ? (now - t.lastPlayed) / 864e5 : null;
    if (this.recentSet && this.recentSet.has(t.id)) return 6;
    if (days != null && days < 3) return 6;
    if (heavy.has(t.id) || (days != null && days < 21)) return 3;
    if (days != null && days < 60) return 1.5;
    if (days == null) return t.plays ? 1.5 : 0.4; // nunca (según la fecha)
    return 0; // olvidada de verdad
  },
  async pool(type) {
    let key = type, q, extra = {};
    if (type === 'genre') {
      const g = await this.pickGenre(); if (!g) return [];
      key = 'g:' + g; q = { sort: 'Random', genreIds: ['name:' + g] }; extra = { G: g, name: g, theme: key };
    } else if (type === 'decade') {
      const d = await this.pickDecade();
      key = 'd:' + d; q = { sort: 'Random', years: Array.from({ length: 10 }, (_, k) => d + k) };
      const dd = d < 2000 ? String(d).slice(2) : String(d);
      extra = { d: dd, name: tx('Los {0}', [dd]), theme: key };
    }
    if (this.pools[key]) return this.pools[key];
    const s = DJ_SEGS[type]; if (!q) q = s.q && { ...s.q };
    if (type === 'discover') {
      const top = await this.pool('top').catch(() => []), gc = new Map();
      for (const t of top) for (const g of t.genres || []) gc.set(g, (gc.get(g) || 0) + 1);
      const gs = [...gc].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
      if (gs.length && api.kind === 'jellyfin') {
        const l = await api.mix({ ...q, genreIds: gs.map(g => 'name:' + g) }, 150).catch(() => []);
        if (l.filter(t => !this.used.has(t.id)).length >= 8) { l.extra = { g: gs[0] }; return (this.pools[key] = l); }
      }
      // Sin resultados en tus géneros (o muy pocos): lo nunca escuchado de toda tu biblioteca.
      const l = await api.mix(q, 150).catch(() => []); l.extra = {}; return (this.pools[key] = l);
    } else if (type === 'mood') {
      const [m, k, v] = djMoment(), def = await mixDef(k);
      if (!def || !def.q) return (this.pools[key] = []);
      q = def.q; extra.m = m; extra.v = v;
    }
    const n = { genre: 200, decade: 200, forgotten: 200, mood: 150, fav: 150, fresh: 80 }[type] || 60;
    const list = await api.mix(q, n);
    list.extra = extra;
    return (this.pools[key] = list);
  },
  async build(type, strict = true) {
    const s = DJ_SEGS[type], pool = await this.pool(type).catch(() => []), now = Date.now();
    let cand = pool.filter(t => t.type === 'track' && !this.used.has(t.id));
    const heavy = await this.heavy().catch(() => new Set());
    let stale = false;
    if (type === 'forgotten') {
      // Olvidadas de verdad: más de 45 días sin sonar. Con un historial corto no hay: la ronda no se usa.
      cand = cand.filter(t => t.lastPlayed && now - t.lastPlayed > 45 * 864e5 && !heavy.has(t.id));
      if (cand.length < 3) return null;
      cand = cand.slice(0, 40).sort(() => Math.random() - .5);
    } else if (type === 'top' || type === 'recent') cand = cand.slice(0, 30).sort(() => Math.random() - .5);
    else {
      cand = cand.map(t => [this.rank(t, heavy, now) + Math.random(), t]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
      const fresh = cand.filter(t => this.rank(t, heavy, now) < 6);
      if (fresh.length >= (s.n || 5)) cand = fresh; // lo de los últimos 3 días, solo si no hay de otra
      // Una ronda que solo puede ofrecer lo que ya sonó estas semanas no explora: se salta (otra ronda lo hará mejor).
      if (strict && cand.filter(t => this.rank(t, heavy, now) < 3).length < 3) return null;
      if (type === 'genre') stale = cand.slice(0, 5).filter(t => this.rank(t, heavy, now) === 0).length >= 3;
    }
    const out = [], seen = new Set();
    for (const t of cand) { const a = t.trackArtist || t.artist; if (seen.has(a) && cand.length > 8) continue; seen.add(a); out.push(t); if (out.length >= (s.n || 5)) break; }
    if (out.length < 3) return null;
    const arts = [...new Set(out.map(t => t.trackArtist || t.artist).filter(Boolean))].slice(0, 2);
    const x = pool.extra || {};
    const line = pick(stale && s.stale ? s.stale : s.lines).replace('{a}', arts.length > 1 ? tx('{0} y {1}', [arts[0], arts[1]]) : arts[0] || tx('tu música')).replace('{G}', x.G || '').replace('{g}', x.g ? ' ' + tx('de {0}', [x.g]) : '').replace('{d}', x.d || '').replace('{m}', x.m || '').replace('{v}', x.v || '');
    return { type, name: x.name || s.name, line, tracks: out, theme: x.theme };
  },
  async next(exclude) {
    const hist = Object.values(this.segs).map(s => s.type).reverse();
    const W = { genre: 6, decade: 3.5, discover: 3, forgotten: 3, mood: 1, fresh: .8, fav: .6, recent: .15, top: .15 };
    const COOL = { top: 12, recent: 10, fav: 4 };
    const order = wshuffle(Object.entries(W).filter(([t]) => {
      if (t === exclude && t !== 'genre') return false;
      return !COOL[t] || !hist.slice(0, COOL[t]).includes(t);
    })).sort((a, b) => (a !== 'genre' && this.recentTypes.includes(a)) - (b !== 'genre' && this.recentTypes.includes(b)));
    for (const t of order) { const s = await this.build(t, true); if (s) return s; }
    for (const t of order) { const s = await this.build(t, false); if (s) return s; } // si ninguna explora, la que se pueda
    return null;
  },
  // Lo que el DJ puso en sus últimas sesiones (ids, guardado cifrado): no lo repite en la siguiente.
  hist: store.get('djHist', []),
  items(seg) {
    this.hist = this.hist.concat(seg.tracks.map(t => t.id)).slice(-400); store.set('djHist', this.hist);
    const i = this.lastKey() + 1; this.segs[i] = { type: seg.type, name: seg.name, line: seg.line };
    this.recentTypes = [seg.type, ...this.recentTypes].slice(0, 3);
    if (seg.theme) this.themes = [seg.theme, ...this.themes].slice(0, 12);
    seg.tracks.forEach(t => this.used.add(t.id));
    return seg.tracks.map((t, k) => ({ ...t, qid: djQid(this.session, i), djS: this.session, djI: i, djFirst: k === 0 }));
  },
  lastKey() { const k = Object.keys(this.segs).map(Number); return k.length ? Math.max(...k) : -1; },
  async start() {
    if (!api) return;
    const peer = RC.remote; // controlando otro dispositivo: la sesión se arma aquí y suena allá
    toast(tx('Nanuq está armando tu sesión…'), 2500);
    Object.assign(this, { session: uid().slice(0, 12), segs: {}, used: new Set(), pools: {}, lastI: -1, recentTypes: [], themes: [], recentSet: new Set(this.hist) });
    let seg = null;
    for (const t of ['genre', 'decade', 'forgotten']) if ((seg = await this.build(t))) break;
    if (!seg) seg = await this.next();
    if (!seg) { toast(tx('Todavía no hay suficiente música para el DJ.')); return; }
    const who = api.userName && api.kind === 'jellyfin' ? ', ' + api.userName : '';
    seg.line = tx('{0}{1}. Soy Nanuq, tu DJ. ', [greeting(), who]) + seg.line;
    const items = this.items(seg);
    if (peer) {
      if (RC.remote !== peer) return;
      this.active = true;
      const st = await this.share(peer, items, 0);
      RC.playQueue(items, 0); this.handedOff(st);
      return;
    }
    this.active = true; this.save();
    P.queue = items; playIndex(0); renderQueueAll();
    this.extend();
  },
  // ---- El DJ entre tus dispositivos ----
  // Antes de pasarle la música a otro dispositivo se deja en tu Jellyfin el estado de la sesión y qué ronda es cada
  // canción de la ventana que se le manda; ese dispositivo lo lee al recibir la orden y sigue la misma sesión.
  async share(peer, queue, start) {
    const w = RC.window(queue, start), q = queue.slice(w.a, w.a + 200).map(t => [t.id, t.djS === this.session ? t.djI : -1, t.djFirst ? 1 : 0]);
    try { return (await DJSHARE.push({ to: peer.DeviceId, q })) || null; } catch { return null; }
  },
  // La sesión ya suena en el otro dispositivo: aquí se apaga (sin avisar «apagado» a los demás) y se queda para mostrarla.
  handedOff(st) { this.active = false; store.del('dj'); DJSHARE.mine = false; clearTimeout(DJSHARE.t); try { speechSynthesis.cancel(); } catch { } if (st) this.rst = { ...st, fetched: Date.now() }; this.rAnn = ''; this.paint(); },
  // Sigue aquí una sesión que viene de otro dispositivo (st: estado compartido, ya limpio).
  adopt(st, queue, start) {
    Object.assign(this, { active: true, session: st.s, segs: { ...st.segs }, used: new Set([...st.used, ...queue.filter(t => t.djS).map(t => t.id)]), recentTypes: st.recentTypes, themes: st.themes, pools: {}, recentSet: new Set(this.hist), busy: null, rst: null, rAnn: '' });
    const t = queue[start]; this.lastI = t && t.djS ? t.djI : -1; this.line = (this.segs[this.lastI] || {}).line || '';
  },
  // Cola recibida con la orden «reproducir» + qué ronda es cada canción (q, del estado compartido).
  queueFromShare(tracks, st) { return tracks.map((t, k) => { const x = st.q[k]; return x && x[1] >= 0 ? { ...t, djS: st.s, djI: x[1], djFirst: !!x[2], qid: djQid(st.s, x[1]) } : { ...t, qid: uid() }; }); },
  // Cola del otro dispositivo (sus ids traen la ronda) al traer la música aquí.
  queueFromTags(q, s) { let prev = null; return q.map(t => { const g = djTag(t.qid); if (!g || !djSame(g.s, s)) { prev = null; return { ...t, qid: uid() }; } const first = prev !== g.i; prev = g.i; return { ...t, djS: s, djI: g.i, djFirst: first, qid: t.qid }; }); },
  // ¿Lo que suena en el dispositivo que controlas es el DJ? Lo dice el id de la cola; si allá lo terminaron, ya no.
  remoteTag() { if (!RC.remote || !P.cur) return null; const g = djTag(P.cur.qid); if (!g) return null; const r = this.rst; return r && djSame(r.s, g.s) && r.off ? null : g; },
  shown() { return this.active ? !!P.cur : !!this.remoteTag(); },
  // Controlando otro dispositivo: trae (como mucho cada 15 s) las rondas de allá y presenta la nueva en el globo.
  remoteTrack() {
    const g = this.remoteTag(), r = this.rst, now = Date.now();
    if (g && (!r || !djSame(r.s, g.s) || !r.segs[g.i] || now - (r.fetched || 0) > 15000) && !this.rBusy && now - (this.rTried || 0) > 4000) {
      this.rTried = now;
      this.rBusy = DJSHARE.pull().then(st => { if (st) this.rst = { ...st, fetched: Date.now() }; }).catch(() => { }).finally(() => { this.rBusy = null; if (RC.remote) this.remoteTrack(); });
    }
    const seg = g && r && djSame(r.s, g.s) ? r.segs[g.i] : null, key = g ? g.s + ':' + g.i : '';
    if (seg && this.rAnn !== key) { this.rAnn = key; this.rLine = seg.line; this.show(seg.line); }
    this.paint();
  },
  stop(silent) { if (!this.active) return; this.active = false; this.save(); try { speechSynthesis.cancel(); } catch { } this.paint(); if (!silent) toast(tx('DJ en pausa: la cola se queda como está.')); },
  // Al cambiar de canción: presenta la ronda nueva y agrega la siguiente cuando faltan pocas.
  onTrack() {
    if (!this.active) return;
    const t = P.cur;
    if (!t || t.djS !== this.session) { this.stop(true); return; }
    if (t.djI !== this.lastI) { this.lastI = t.djI; const s = this.segs[t.djI]; if (s) this.announce(s); }
    if (P.queue.length - 1 - P.i <= 2) this.extend();
    this.paint();
  },
  extend() {
    if (this.busy) return this.busy;
    return (this.busy = (async () => {
      try {
        const seg = await this.next(this.segs[this.lastKey()]?.type);
        if (seg && this.active) { P.queue.push(...this.items(seg)); saveQueue(); renderQueueAll(); this.save(); this.paint(); }
      } finally { this.busy = null; }
    })());
  },
  // «Cambiar de onda»: otra ronda en lugar de lo que quedaba.
  async switchUp() {
    if (!this.active) return this.start();
    const curType = (this.segs[P.cur?.djI] || {}).type;
    const seg = await this.next(curType);
    if (!seg) { toast(tx('No encontré otra onda por ahora.')); return; }
    P.queue = P.queue.slice(0, P.i + 1).concat(this.items(seg));
    this.save(); playIndex(P.i + 1); renderQueueAll(); this.extend();
  },
  announce(s) { this.line = s.line; this.show(s.line); this.speak(s.line); this.paint(); },
  // En el reproductor maximizado lo dice Nanuq en un globo; en su pantalla, el globo de arriba; en las demás, un aviso.
  show(line) {
    const sh = $('#sheet');
    if (sh.classList.contains('open') && sh.classList.contains('djmode')) this.say(line);
    else if (cur()?.name !== 'dj' || !this.visible()) toast('DJ Nanuq · ' + line, 6500);
  },
  speak(text) {
    if (!Settings.djVoice || !this.voiceOk()) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text), vs = speechSynthesis.getVoices();
      u.voice = (LANG === 'es' ? vs.find(v => /^es[-_](MX|US|419)/i.test(v.lang)) : vs.find(v => /^en[-_]US/i.test(v.lang))) || vs.find(v => v.lang && v.lang.toLowerCase().startsWith(LANG)) || null;
      u.lang = u.voice ? u.voice.lang : LANG; u.rate = 1.03;
      // Como en la radio: la música baja mientras habla. Si interrumpe otra presentación, el volumen de referencia es
      // el de antes de la primera (no el ya bajado), y solo la última presentación lo devuelve.
      const v = this.duckV ?? P.audio.volume; this.duckV = v; this.duckU = u; P.audio.volume = v * 0.3;
      u.onend = u.onerror = () => {
        if (this.duckU !== u) return; // la interrumpió una presentación más nueva
        this.duckU = null; this.duckV = null;
        if (Math.abs(P.audio.volume - v * 0.3) < 0.01) P.audio.volume = v; // si moviste el volumen mientras hablaba, se respeta
      };
      speechSynthesis.speak(u);
    } catch { }
  },
  visible: () => document.visibilityState === 'visible',
  bears(playing) { const on = !!playing && this.shown(); $$('.djbear').forEach(b => b.classList.toggle('on', on)); $('#sDj')?.classList.toggle('playing', on); },
  // Reproductor maximizado: en lugar de la carátula, Nanuq pone la portada como un disco y la cambia
  // hacia la siguiente, la anterior o, si saltaste a otra canción, deja caer la nueva desde arriba.
  stage: { qid: null, i: -1 },
  say(text) {
    const b = $('#sDjSay'); if (!b) return;
    b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); nqBurst(7000);
    clearTimeout(this.sayT); this.sayT = setTimeout(() => b.classList.remove('show'), 7000);
  },
  scene() {
    const on = this.shown() && Settings.playerAnim !== 'none', sheet = $('#sheet'), box = $('#sDj');
    sheet.classList.toggle('djmode', on); sheet.classList.toggle('pa-disc', Settings.playerAnim === 'disc');
    if (!on || !box) { this.stage = { qid: null, i: -1 }; if (box) box.querySelector('.djs-crate').innerHTML = ''; return; }
    const bear = box.querySelector('.djs-bear');
    if (!bear.firstElementChild) bear.innerHTML = djBearSVG();
    const t = P.cur; if (this.stage.qid === t.qid) return;
    const first = this.stage.qid == null;
    const dir = first ? 'jump' : P.i === this.stage.i + 1 ? 'next' : P.i === this.stage.i - 1 ? 'prev' : 'jump';
    this.stage = { qid: t.qid, i: P.i };
    const u = api.img(t, 400), crate = box.querySelector('.djs-crate'), el = document.createElement('div');
    el.className = 'djs-sleeve in-' + dir;
    el.innerHTML = `<div class="djs-vinyl"><div class="djs-disc"><span class="djs-label"${u ? ` style="background-image:url('${esc(u.replace(/'/g, '%27'))}')"` : ''}></span></div></div><div class="djs-art">${coverHTML(t, 800)}</div>`;
    crate.querySelectorAll('.djs-sleeve:not(.gone)').forEach(o => { o.className = 'djs-sleeve gone out-' + dir; setTimeout(() => o.remove(), 900); });
    crate.appendChild(el);
    bear.classList.remove('grab-next', 'grab-prev', 'grab-jump'); void bear.offsetWidth;
    if (!first) bear.classList.add('grab-' + dir);
    this.bears(!P.audio.paused && !!P.audio.src);
  },
  paint() {
    this.scene();
    const rg = !this.active && this.remoteTag(), rs = rg && this.rst && djSame(this.rst.s, rg.s) ? this.rst : null;
    this.bears(RC.remote ? !RC.paused : !P.audio.paused && !!P.audio.src);
    $$('.djtile').forEach(t => t.classList.toggle('live', this.active || !!rg));
    if (cur()?.name !== 'dj') return;
    const b = $('#djBubble'), nx = $('#djNext'), btns = $('#djBtns'), now = $('#djNow');
    if (b) b.textContent = this.active && this.line ? this.line : rg ? (this.rLine || tx('DJ Nanuq está sonando en ') + devName(RC.remote) + '.') : tx('¿Listo? Te armo rondas por género y por década, rescato lo que tenías olvidado y te presento cosas nuevas, todo de tu propia biblioteca.');
    if (btns) btns.innerHTML = this.active
      ? `<button class="btn pri" data-act="dj-switch">${ic('shuffle')}${tx('Cambiar de onda')}</button><button class="btn" data-act="dj-stop">${ic('x')}${tx('Terminar')}</button>`
      : rg ? `<span class="muted">${tx('Sonando en')} ${esc(devLabel(RC.remote))}${tx(': lo controlas desde aquí.')}</span><button class="btn" data-act="dj-start">${ic('play', 1)}${tx('Empezar otra sesión')}</button>`
      : `<button class="btn pri" data-act="dj-start">${ic('play', 1)}${tx('Empezar sesión')}</button>`;
    const s = this.active && P.cur ? this.segs[P.cur.djI] : rs ? rs.segs[rg.i] : null;
    if (now) now.innerHTML = s ? `<span class="djtag">${esc(s.name)}</span>` : '';
    if (nx) {
      // [pista, posición, ronda, ¿primera de su ronda?]: aquí con los datos de cada pista; controlando, con el id de la cola.
      let up = [];
      if (this.active) up = P.queue.map((t, i) => [t, i, t.djI, t.djFirst]).slice(P.i + 1).filter(([t]) => t.djS === this.session);
      else if (rg) { let prev = rg.i; up = P.queue.map((t, i) => [t, i]).slice(P.i + 1).map(([t, i]) => { const g = djTag(t.qid); if (!g || !djSame(g.s, rg.s)) return null; const f = g.i !== prev; prev = g.i; return [t, i, g.i, f]; }).filter(Boolean); }
      const segs = this.active ? this.segs : rs ? rs.segs : {};
      up = up.slice(0, 8);
      nx.innerHTML = up.length ? `<div class="letter">${tx('Lo que sigue')}</div><div class="list">${up.map(([t, i, si, first]) => `<button class="li" data-act="qplay" data-i="${i}">${coverHTML(t, 80)}<span class="t">${esc(t.name)}<small>${esc([t.trackArtist || t.artist, (first && segs[si]) ? '▸ ' + segs[si].name : ''].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>` : '';
    }
  }
};
// Estado del DJ compartido entre tus dispositivos, guardado en tu Jellyfin como preferencia de pantalla de tu usuario
// (/DisplayPreferences, cliente «Nanuq»): sesión, rondas, lo que ya sonó y, al pasar la música, a qué dispositivo y qué
// ronda es cada canción. Lo que se lee se trata como no confiable (djClean): ids limpios, textos acotados, tipos conocidos.
const DJSHARE = {
  id: 'nanuq-dj', t: 0, mine: false,
  ok() { return !!api && api.kind === 'jellyfin' && !!Settings.devSync; },
  state(extra = {}) {
    const segs = {};
    for (const k of Object.keys(DJ.segs).map(Number).sort((a, b) => a - b).slice(-16)) { const x = DJ.segs[k]; segs[k] = { type: x.type, name: String(x.name || '').slice(0, 80), line: String(x.line || '').slice(0, 400) }; }
    return { v: 1, s: DJ.session, off: !DJ.active, dev: deviceId(), at: Date.now(), segs, used: [...DJ.used].slice(-250), recentTypes: DJ.recentTypes, themes: DJ.themes, to: null, q: null, ...extra };
  },
  async push(extra) {
    if (!this.ok() || !DJ.session) return null;
    clearTimeout(this.t); this.t = 0;
    const st = this.state(extra); this.mine = true;
    await api.req('/DisplayPreferences/' + this.id, { method: 'POST', params: { userId: api.userId, client: 'Nanuq' }, timeout: 15000, body: { Id: this.id, Client: 'Nanuq', SortBy: 'SortName', SortOrder: 'Ascending', RememberIndexing: false, RememberSorting: false, ScrollDirection: 'Horizontal', ShowBackdrop: false, ShowSidebar: false, CustomPrefs: { dj: JSON.stringify(st) } } });
    return st;
  },
  // Escribe un estado ya armado (p. ej. el que se leyó del otro dispositivo, con otra cola).
  async pushRaw(st) {
    if (!this.ok() || !st) return;
    await api.req('/DisplayPreferences/' + this.id, { method: 'POST', params: { userId: api.userId, client: 'Nanuq' }, timeout: 15000, body: { Id: this.id, Client: 'Nanuq', SortBy: 'SortName', SortOrder: 'Ascending', RememberIndexing: false, RememberSorting: false, ScrollDirection: 'Horizontal', ShowBackdrop: false, ShowSidebar: false, CustomPrefs: { dj: JSON.stringify(st) } } });
  },
  pushSoon() { if (!this.ok()) return; clearTimeout(this.t); this.t = setTimeout(() => this.push().catch(() => { }), 1500); },
  // El DJ se apagó aquí: se avisa solo si la sesión compartida sigue siendo la de este dispositivo (si otro ya la tomó, no se pisa).
  offSoon() {
    if (!this.ok()) return; clearTimeout(this.t);
    this.t = setTimeout(async () => { try { const cur = await this.pull(); if (cur && cur.dev !== deviceId()) { this.mine = false; return; } await this.push(); this.mine = false; } catch { } }, 1500);
  },
  async pull() {
    if (!this.ok()) return null;
    const d = await api.req('/DisplayPreferences/' + this.id, { params: { userId: api.userId, client: 'Nanuq' }, timeout: 15000 });
    return djClean(d && d.CustomPrefs && d.CustomPrefs.dj);
  }
};
function djClean(raw) {
  let o; try { o = jparse(str(raw).slice(0, 200000)); } catch { return null; }
  if (!o || typeof o !== 'object' || !/^[A-Za-z0-9]{6,32}$/.test(String(o.s || ''))) return null;
  const segs = {}, arr = (a, n) => Array.isArray(a) ? a.slice(0, n) : [];
  for (const [k, v] of Object.entries(o.segs && typeof o.segs === 'object' ? o.segs : {}).slice(0, 40)) if (/^\d{1,5}$/.test(k) && v && Object.hasOwn(DJ_SEGS, v.type)) segs[+k] = { type: v.type, name: String(v.name || '').slice(0, 80), line: String(v.line || '').slice(0, 400) };
  return {
    s: String(o.s), off: !!o.off, dev: String(o.dev || '').slice(0, 64), at: num(o.at), segs,
    used: arr(o.used, 400).map(sid).filter(Boolean), recentTypes: arr(o.recentTypes, 3).filter(t => Object.hasOwn(DJ_SEGS, t)),
    themes: arr(o.themes, 12).map(String).filter(t => /^(g|d):.{1,80}$/.test(t)), to: o.to ? String(o.to).slice(0, 64) : null,
    q: Array.isArray(o.q) ? o.q.slice(0, 200).map(x => Array.isArray(x) ? [sid(x[0]), Number.isInteger(x[1]) && x[1] >= -1 && x[1] < 1e5 ? x[1] : -1, x[2] ? 1 : 0] : [null, -1, 0]) : null
  };
}
// El DJ se mueve sin parar (también el parpadeo y la respiración en pausa) mientras está DE VERDAD en pantalla: el
// reproductor abierto con la escena del DJ (sin la letra ni la cola encima) o la pantalla del DJ. Fuera de la vista,
// quieto (ver nqBurst: cada animación sin fin cuesta ≈ 1 núcleo en un teléfono de 120 Hz).
function djLiveSync() {
  // A la vista: la página visible y, en Android, la app en primer plano (pantalla encendida y desbloqueada; lo avisa la
  // app nativa con __nanuqVis, por si el WebView no marca la página como oculta).
  // «Se ve» = ocupa espacio en pantalla: en el teléfono la letra o la cola tapan al DJ; en pantallas anchas (computadora)
  // van al lado y el DJ sigue a la vista, así que sigue animándose.
  const sh = $('#sheet'), vis = document.visibilityState === 'visible' && RC.visible !== false, c = sh.classList, box = $('#sDj');
  box?.classList.toggle('live', vis && c.contains('open') && c.contains('djmode') && !c.contains('syncing') && box.getClientRects().length > 0);
  $$('.djhero').forEach(h => h.classList.toggle('live', vis && !c.contains('open') && cur()?.name === 'dj' && h.isConnected));
}
new MutationObserver(djLiveSync).observe($('#sheet'), { attributes: true, attributeFilter: ['class'] });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') nqBurstEnd(); setTimeout(djLiveSync, 0); }); // después de que RC.visible se actualice
let djLiveT = 0; addEventListener('resize', () => { clearTimeout(djLiveT); djLiveT = setTimeout(djLiveSync, 150); }); // al cambiar el ancho, la letra puede tapar al DJ o ponerse al lado
function djTileHTML() {
  return `<button class="tile djtile${DJ.active ? ' live' : ''}" data-act="open" data-r="dj"><div class="djart">${djBearSVG()}</div><span class="djkick">${DJ.active ? tx('Al aire') : tx('Nuevo')}</span><b>DJ Nanuq</b><small>${tx('Tu música, presentada por Nanuq')}</small><span class="tp" data-act="dj-start" role="button" aria-label="${tx('Empezar DJ')}">${ic('play', 1)}</span></button>`;
}
V.dj = async (el) => {
  el.innerHTML = head('DJ Nanuq') + `<section class="djhero">
      <div class="djstage">${djBearSVG('big')}<div class="djbubble" id="djBubble"></div></div>
      <div class="djinfo">
        <div class="akind">${tx('Tu DJ personal · sin IA')}</div>
        <h2>DJ Nanuq</h2>
        <p class="muted">${tx('Arma una sesión por rondas con tu biblioteca: tus clásicos, lo de estos días, favoritas, olvidadas, cosas que nunca has escuchado en tus géneros, recién llegadas, viajes a otra década y algo según la hora. Antes de cada ronda te cuenta qué viene.')}</p>
        <div id="djNow"></div>
        <div class="abtns" id="djBtns"></div>
      </div>
    </section>
    <div id="djNext"></div>
    ${DJ.voiceOk() ? `<div class="set"><div class="row"><div class="l">${tx('Voz del DJ')}<small>${tx('Nanuq lee la presentación de cada ronda con la voz en español de tu sistema; la música baja mientras habla.')}</small></div><button class="sw${Settings.djVoice ? ' on' : ''}" data-act="dj-voice" aria-label="${tx('Voz del DJ')}"></button></div></div>` : ''}`;
  DJ.paint(); djLiveSync();
};
// Celdas vacías de Inicio: Nanuq (el oso del logo, en vector) con el accesorio del tema elegido.
const NANUQ_SCENES = [
  ['nap', tx('Siesta polar'), tx('Nanuq duerme hasta que pongas algo')],
  ['wave', tx('¡Hola!'), tx('Nanuq te saluda desde el hielo')],
  ['dance', tx('Modo fiesta'), tx('A Nanuq le gusta tu música')],
  ['peek', tx('¿Qué ponemos?'), tx('Nanuq se asoma a ver qué eliges')],
  ['snow', tx('Está nevando'), tx('Clima perfecto para un álbum completo')]
];
const NANUQ_PETS = [tx('¡Jiji, cosquillas!'), tx('Nanuq te da un abrazo de oso'), tx('¿Otra canción? ¡Va!'), tx('Abrígate, aquí hace frío'), tx('Nanuq aprueba tu gusto musical'), tx('¡Hora de bailar!'), tx('Shhh… está sonando lo mejor')];
function nanuqSceneSVG(k) {
  const A = 'var(--accent)', u = id => `<use href="#djb-${id}"/>`;
  const back = k === 'snow' ? `<g class="n-fx" fill="#fff">${[[20, 0, 9], [130, -60, 6], [250, 30, 8], [380, -20, 7], [470, 40, 10], [80, 120, 5], [330, 140, 6], [540, -80, 7]].map(([x, y, r]) => `<g class="n-flake"><circle cx="${x}" cy="${y}" r="${r}"/></g>`).join('')}</g>` : '';
  const fx = k === 'nap' ? `<g class="n-fx" style="fill:${A}" font-family="Outfit,Inter,sans-serif" font-weight="700"><text class="n-z" x="420" y="40" font-size="70">z</text><text class="n-z" x="420" y="40" font-size="56">z</text><text class="n-z" x="420" y="40" font-size="44">z</text></g>`
    : k === 'dance' ? `<g class="n-fx" style="fill:${A};stroke:${A}" stroke-width="9" stroke-linecap="round">${[[-10, 200], [470, 150], [40, 60]].map(([x, y]) => `<g class="n-note"><ellipse cx="${x}" cy="${y}" rx="17" ry="13" stroke="none"/><path d="M${x + 14} ${y - 2}V${y - 58}l26 9" fill="none"/></g>`).join('')}</g>` : '';
  const paw = k === 'wave' ? `<g class="n-paw"><path d="M452 330C440 270 452 214 488 206C524 200 540 250 526 330Z" fill="#fff"/><ellipse cx="490" cy="238" rx="16" ry="13" fill="#daeaf9"/></g>` : '';
  return `<svg class="nsc nsc-${k} nfb" viewBox="-70 -150 652 660" aria-hidden="true">${back}<g class="n-bear"><g transform="scale(1.4222 1.4227)">${u('body')}${u('belly')}${u('head')}${u('muzzle')}${u('nose')}${u('eyes')}</g>${paw}<g class="acc-g">${BEAR_ACC[Settings.theme] || ''}</g></g>${fx}</svg>`;
}
// Escenas anchas (ocupan dos celdas) para cuando el hueco es de dos o más.
const NANUQ_WIDE = [
  ['aurora', tx('Noche de aurora'), tx('Nanuq mira el cielo con tu música de fondo')],
  ['skate', tx('Patinaje sobre hielo'), tx('Nanuq practica sus giros')],
  ['friends', tx('Fiesta en el iglú'), tx('Nanuq y su osezno bailan contigo')],
  ['fish', tx('Pesca polar'), tx('Nanuq espera que algo pique… o una buena canción')]
];
// Nanuq listo para colocar en una escena: (x, y) es su esquina superior izquierda; k, la escala sobre 512×488.
function nanuqBear(x, y, k, cls = '', acc = true) {
  const u = id => `<use href="#djb-${id}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${k})"><g class="n-bear ${cls}"><g transform="scale(1.4222 1.4227)">${u('body')}${u('belly')}${u('head')}${u('muzzle')}${u('nose')}${u('eyes')}</g>${acc ? `<g class="acc-g">${BEAR_ACC[Settings.theme] || ''}</g>` : ''}</g></g>`;
}
function nanuqWideSVG(k) {
  const A = 'var(--accent)', AL = 'color-mix(in srgb,var(--accent) 55%,#fff)', ice = '<path d="M-20 372Q500 318 1020 360V430H-20Z" fill="#fff" opacity=".88"/>';
  const note = (x, y) => `<g class="n-note"><ellipse cx="${x}" cy="${y}" rx="15" ry="11" stroke="none"/><path d="M${x + 12} ${y - 2}V${y - 50}l22 8" fill="none"/></g>`;
  let body = '';
  if (k === 'aurora') body = `<g fill="#fff">${[[420, 40], [520, 90], [690, 30], [880, 70], [960, 20], [760, 120]].map(([x, y], i) => `<circle class="n-star" style="animation-delay:${i * .4}s" cx="${x}" cy="${y}" r="${i % 2 ? 3 : 4.5}"/>`).join('')}</g>
    <g class="n-aur" fill="none" stroke-linecap="round"><path d="M360 150C480 60 600 190 720 110S900 60 1040 130" style="stroke:${A}" stroke-width="34" opacity=".55"/><path class="n-aur2" d="M340 200C470 120 610 230 740 160S920 120 1040 180" style="stroke:${AL}" stroke-width="22" opacity=".45"/></g>
    ${ice}${nanuqBear(630, 99, .56, 'n-gaze')}`;
  else if (k === 'skate') body = `${ice}<g class="n-trail" fill="none" stroke="#bcd3ee" stroke-width="5" stroke-linecap="round"><path d="M400 392H560M620 400H760M800 390H900"/></g>
    <g class="n-skater">${nanuqBear(400, 128, .5)}</g>`;
  else if (k === 'friends') body = `<g style="fill:${A};stroke:${A}" stroke-width="8" stroke-linecap="round">${note(470, 120)}${note(940, 90)}${note(720, 50)}</g>${ice}
    ${nanuqBear(440, 104, .55, 'n-hopA')}${nanuqBear(780, 211, .33, 'n-hopB')}`;
  else body = `${ice}<ellipse cx="880" cy="384" rx="70" ry="14" fill="#0d2a66" opacity=".85"/>
    <g class="n-fish"><path d="M0 0C20 -16 46 -16 62 0C46 16 20 16 0 0ZM62 0L84 -14V14Z" style="fill:${A}"/><circle cx="16" cy="-3" r="3.5" fill="#0d2a66"/></g>
    ${nanuqBear(400, 104, .55, 'n-wait')}<path class="n-rod" d="M700 300L800 120" stroke="#6b4a2e" stroke-width="8" stroke-linecap="round"/><path class="n-line" d="M800 120Q850 250 880 380" fill="none" stroke="#e8eef7" stroke-width="2.5"/>`;
  return `<svg class="nsc nwide nscw-${k} nfb" viewBox="0 0 1000 420" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">${body}</svg>`;
}
let nanuqWideSeq = Math.floor(Math.random() * NANUQ_WIDE.length);
function nanuqWideTileHTML() {
  const [k, t, sub] = NANUQ_WIDE[nanuqWideSeq++ % NANUQ_WIDE.length];
  return `<div class="tile nfill nwide" role="button" tabindex="0" data-act="nanuq-pet" aria-label="${esc(t)}">${nanuqWideSVG(k)}<b>${esc(t)}</b><small>${esc(sub)}</small></div>`;
}
let nanuqSceneSeq = Math.floor(Math.random() * NANUQ_SCENES.length);
function nanuqTileHTML() {
  const [k, t, sub] = NANUQ_SCENES[nanuqSceneSeq++ % NANUQ_SCENES.length];
  return `<div class="tile nfill" role="button" tabindex="0" data-act="nanuq-pet" aria-label="${esc(t)}">${nanuqSceneSVG(k)}<b>${esc(t)}</b><small>${esc(sub)}</small></div>`;
}
// Visitas: de vez en cuando un Nanuq de otro tema (con su accesorio) entra a una celda, saluda y se va.
const NANUQ_VISIT_SAYS = [n => tx('El Nanuq de {0} vino a saludar', [n]), n => tx('{0} pasó a escuchar música', [n]), n => tx('Nanuq de {0} está de visita', [n]), n => tx('¡Llegó el Nanuq de {0}!', [n])];
const NANUQ_VISIT_TAPS = [n => tx('Nanuq de {0} dice: ¡qué buena música!', [n]), n => tx('{0} te manda un abrazo de oso', [n]), n => tx('Nanuq de {0} ya se quiere quedar', [n])];
function nanuqVisit(box) {
  const tiles = [...(box || document).querySelectorAll('.tile.nfill:not(.visiting)')].filter(t => t.isConnected);
  if (!tiles.length) return;
  const t = tiles[Math.floor(Math.random() * tiles.length)];
  const others = Object.keys(BEAR_ACC).filter(k => k !== Settings.theme && THEMES[k]);
  if (!others.length) return;
  const k = others[Math.floor(Math.random() * others.length)], name = THEMES[k].name.replace(/^[^\p{L}\d]+/u, '').trim(); // sin el emoji del tema
  const b = t.querySelector('b'), sm = t.querySelector('small'), was = [b.textContent, sm.textContent];
  const u = id => `<use href="#djb-${id}"/>`;
  t.insertAdjacentHTML('beforeend', `<svg class="nvis nfb" viewBox="-70 -150 652 660" aria-hidden="true"><g class="n-bear"><g transform="scale(1.4222 1.4227)">${u('body')}${u('belly')}${u('head')}${u('muzzle')}${u('nose')}${u('eyes')}</g><g class="acc-g">${BEAR_ACC[k]}</g></g></svg>`);
  const v = t.lastElementChild;
  t.classList.add('visiting'); t.dataset.visitor = name; nqBurst(10500);
  b.textContent = tx('¡Visita!'); sm.textContent = NANUQ_VISIT_SAYS[Math.floor(Math.random() * NANUQ_VISIT_SAYS.length)](name);
  setTimeout(() => { if (t.isConnected) { t.classList.remove('pet'); void t.offsetWidth; t.classList.add('pet'); } }, 1300); // el de la casa lo saluda
  v.addEventListener('animationend', e => {
    if (e.target !== v) return;
    v.remove(); t.classList.remove('visiting'); delete t.dataset.visitor;
    b.textContent = was[0]; sm.textContent = was[1];
  });
}
function nanuqVisits(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => { };
  let t = 0;
  const next = first => { t = setTimeout(() => { if (document.visibilityState === 'visible' && el.isConnected) nanuqVisit(el); next(false); }, first ? 6000 + Math.random() * 8000 : 15000 + Math.random() * 20000); };
  next(true);
  return () => clearTimeout(t);
}
// Cuenta las columnas de la cuadrícula y rellena lo que falta para completar la última fila.
function fillGaps(box) {
  if (!box || !box.isConnected) return;
  box.querySelectorAll('.nfill').forEach(e => e.remove());
  const cols = getComputedStyle(box).gridTemplateColumns.split(' ').filter(Boolean).length;
  const tiles = [...box.children].filter(t => t.classList.contains('tile'));
  if (cols < 2 || !tiles.length) return;
  const span = t => { const cs = getComputedStyle(t), m = /span\s+(\d+)/.exec(cs.gridColumnStart + ' ' + cs.gridColumnEnd); return Math.min(m ? +m[1] : 1, cols); };
  const used = tiles.reduce((a, t) => a + span(t), 0); // las tarjetas anchas (DJ, Tu año…) ocupan dos columnas
  let gap = (cols - used % cols) % cols;
  // Huecos de dos o más: escenas anchas que ocupan dos celdas; si sobra una, una escena sencilla.
  while (gap >= 2) { box.insertAdjacentHTML('beforeend', nanuqWideTileHTML()); gap -= 2; }
  if (gap) box.insertAdjacentHTML('beforeend', nanuqTileHTML());
}
function tileHTML(d) {
  return `<button class="tile loading" data-act="open" data-r="mix" data-id="${d.k}" data-name="${esc(d.name)}" style="--c1:${d.c[0]};--c2:${d.c[1]}"><div class="stack"></div><svg class="i ti"><use href="#i-${d.icon}"/></svg><b>${esc(d.name)}</b><small>${esc(d.sub || '')}</small><span class="tp" data-act="mix-play" data-k="${d.k}" role="button" aria-label="${esc(tx('Reproducir {0}', [d.name]))}">${ic('play', 1)}</span></button>`;
}
// Android sin conexión con el servidor (sin red, o fuera de casa con un Jellyfin que solo está en tu red): Inicio
// ofrece tus descargas, que sí funcionan.
function offlineBanner(el) {
  const n = DL.on && api && api.kind === 'jellyfin' ? DL.list().filter(e => e.state === 'done').length : 0;
  if (!n || !el.isConnected || $('.offbar', el)) return;
  el.querySelector('.head')?.insertAdjacentHTML('afterend', `<div class="err offbar" style="margin-bottom:18px"><b>${tx('Sin conexión con tu servidor')}</b>${tx('Puedes escuchar')} ${n === 1 ? tx('tu canción descargada') : 'tus ' + n + tx(' canciones descargadas')}.<div style="margin-top:10px"><button class="btn pri" data-act="open" data-r="downloads" data-push="1">${ic('download')}${tx('Tus descargas')}</button></div></div>`);
}
V.home = async (el) => {
  el.innerHTML = head(greeting()) + `<div class="sec"><h2>${tx('Tu música')}</h2></div><div class="tiles" id="hMine"></div><div class="sec"><h2>${tx('Según tu ánimo')}</h2></div><div class="tiles" id="hMood">${loading()}</div><div class="sec"><h2>${tx('Álbumes recién agregados')}</h2><a href="#" class="lnk" data-act="home-albums">${tx('Ver todos')}</a></div><div class="hscroll" id="hNew">${loading()}</div>`;
  const fill = async (box, defs) => {
    box.innerHTML = defs.map(tileHTML).join('');
    await Promise.all(defs.map(async d => {
      const t = box.querySelector(`[data-id="${d.k}"]`);
      try {
        const prev = await cached('mixprev:' + d.k, () => api.mix(d.q, 3));
        if (!prev.length) { t.remove(); return; }
        const urls = prev.map(x => api.img(x, 200)).filter(Boolean);
        t.querySelector('.stack').innerHTML = urls.map(u => `<span style="background-image:url('${esc(u.replace(/'/g, '%27'))}')"></span>`).join('');
        t.classList.remove('loading');
      } catch (e) { t.remove(); }
    }));
  };
  if (DL.on && DL.net() === 'none') offlineBanner(el);
  // Con una VPN sin red debajo, o un servidor que no contesta, las peticiones se quedan colgadas en vez de fallar:
  // si en 8 s no llegó nada, también se ofrecen las descargas.
  setTimeout(() => { if (el.isConnected && $('#hNew .spin', el)) offlineBanner(el); }, 8000);
  const mine = MIXES.filter(m => m.group === 'mine').map(m => ({ ...m }));
  const mineP = fill($('#hMine', el), mine);
  $('#hMine', el).insertAdjacentHTML('afterbegin', djTileHTML()); DJ.paint();
  if (recapYearOpen()) $('#hMine .djtile', el)?.insertAdjacentHTML('afterend', recapTileHTML());
  const moods = (await Promise.all(MIXES.filter(m => m.group === 'mood').map(m => mixDef(m.k)))).filter(d => d && d.q);
  const moodBox = $('#hMood', el);
  if (!moods.length) moodBox.outerHTML = ('<div class="empty">' + tx('Tus canciones no tienen géneros que pueda relacionar con un ánimo.') + '</div>');
  const moodP = moods.length ? fill(moodBox, moods) : null;
  try {
    await LIB.index(() => { if (el.isConnected && $('#hNew', el)) $('#hNew', el).innerHTML = LIB.sorted('recent').slice(0, 14).map(albumCard).join(''); });
    const r = LIB.sorted('recent').slice(0, 14);
    $('#hNew', el).innerHTML = r.length ? r.map(albumCard).join('') : ('<div class="empty">' + tx('Sin álbumes.') + '</div>');
    $('.offbar', el)?.remove(); // el servidor sí respondió (tardó)
  } catch (e) { $('#hNew', el).innerHTML = errBox(e); if (!e.code) offlineBanner(el); }
  await Promise.all([mineP, moodP]);
  // Completar las filas con Nanuq; al cambiar el ancho cambian las columnas.
  const boxes = ['#hMine', '#hMood'].map(q => $(q, el)).filter(b => b && b.classList.contains('tiles'));
  boxes.forEach(fillGaps); nqBurst(6000); // las escenas de Nanuq se mueven un rato al llegar
  if (window.ResizeObserver) {
    let cols = boxes.map(b => getComputedStyle(b).gridTemplateColumns.split(' ').length), t = 0;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => boxes.forEach((b, i) => { const c = getComputedStyle(b).gridTemplateColumns.split(' ').length; if (c !== cols[i]) { cols[i] = c; fillGaps(b); } }), 120); });
    boxes.forEach(b => ro.observe(b));
    const stopVisits = nanuqVisits(el);
    el._cleanup = () => { ro.disconnect(); stopVisits(); };
  }
};
V.mix = async (el, { id, name }) => {
  el.innerHTML = head(name || tx('Mezcla')) + loading();
  const d = await mixDef(id);
  if (!d || !d.q) { el.innerHTML = head(name || tx('Mezcla')) + ('<div class="empty">' + tx('Esta mezcla no está disponible.') + '</div>'); return; }
  const tracks = await mixTracks(d);
  const k = regList(tracks);
  el.innerHTML = head(d.name, `<button class="btn" data-act="play-list" data-l="${k}" data-i="0">${ic('play', 1)}<span class="lb">${tx('Reproducir')}</span></button>${d.random ? `<button class="btn" data-act="mix-regen" data-k="${d.k}">${ic('refresh')}<span class="lb">${tx('Otra mezcla')}</span></button>` : ''}<button class="btn" data-act="mix-save" data-k="${d.k}">${ic('save')}<span class="lb">${tx('Guardar')}</span></button>`)
    + `<div class="mixhero" style="--c1:${d.c[0]};--c2:${d.c[1]}">${ic(d.icon)}<div><b>${esc(d.name)}</b><span>${esc(d.sub || '')}</span><span>${tracks.length} ${tx('canciones ·')} ${fmt(tracks.reduce((a, t) => a + (t.duration || 0), 0))}</span></div></div>`
    + (tracks.length ? trackRows(tracks, { showArtist: true, showAlbum: true, discs: false, thumbs: true, cls: 'songs' }) : ('<div class="empty">' + tx('No hay canciones para esta mezcla todavía.') + '</div>'));
};
V.songs = async (el) => {
  const sorts = [['name', tx('Título')], ['artist', tx('Artista')], ['album', tx('Álbum')], ['recent', tx('Añadidas recientemente')], ['plays', tx('Más escuchadas')], ['random', tx('Aleatorio')]].filter(x => api.kind !== 'demo' || x[0] !== 'plays');
  el.innerHTML = head(tx('Canciones'), `<button class="btn" data-act="songs-play">${ic('play', 1)}<span class="lb">${tx('Reproducir todo')}</span></button><button class="btn" data-act="songs-play" data-shuffle="1">${ic('shuffle')}<span class="lb">${tx('Aleatorio')}</span></button>`)
    + `<div class="toolbar"><select class="sel" id="tSort" aria-label="${tx('Ordenar')}">${sorts.map(([k, n]) => `<option value="${k}"${Settings.songSort === k ? ' selected' : ''}>${n}</option>`).join('')}</select><span class="muted" id="tCount"></span></div><div class="tracks songs" id="tList"></div><div class="sentinel" id="tMore"></div>`;
  $('#tSort', el).onchange = e => { Settings.set('songSort', e.target.value); cache.delete('songs'); render(); };
  const st = await cached('songs', async () => ({ items: [], total: null, sort: Settings.songSort }));
  lists.songs = st.items;
  const list = $('#tList', el), more = $('#tMore', el), cnt = $('#tCount', el);
  const o = { key: 'songs', thumbs: true, showArtist: true, showAlbum: true, discs: false };
  const count = () => { cnt.textContent = st.total != null ? st.total.toLocaleString(LOC) + tx(' canciones') : ''; };
  list.innerHTML = rowsHTML(st.items, o); count();
  let busy = false;
  const load = async () => {
    if (busy || (st.total != null && st.items.length >= st.total)) return;
    busy = true; more.innerHTML = loading();
    try {
      const r = await api.tracks({ start: st.items.length, limit: 200, sort: st.sort });
      const off = st.items.length; st.items.push(...r.items); st.total = r.items.length ? r.total : st.items.length;
      list.insertAdjacentHTML('beforeend', rowsHTML(r.items, { ...o, offset: off })); count();
    } catch (e) { more.innerHTML = errBox(e); busy = false; return; }
    more.innerHTML = ''; busy = false;
    if (!st.items.length) list.outerHTML = ('<div class="empty">' + tx('No hay canciones en tu biblioteca.') + '</div>');
    else if (more.getBoundingClientRect().top < innerHeight + 600) load();
  };
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) load(); }, { root: $('#main'), rootMargin: '800px' });
  io.observe(more); el._cleanup = () => io.disconnect();
  if (!st.items.length) await load();
};
V.artists = async (el) => {
  el.innerHTML = head(tx('Artistas')) + loading();
  const r = await cached('artists', async () => { const out = []; let total = Infinity; while (out.length < total && out.length < 20000) { const p = await api.artists({ start: out.length, limit: 500 }); out.push(...p.items); total = num(p.total) || out.length; if (!p.items.length) break; } /* tope: un servidor no puede mandar páginas sin fin */ return out; });
  if (!r.length) { el.innerHTML = head(tx('Artistas')) + ('<div class="empty">' + tx('No hay artistas.') + '</div>'); return; }
  el.innerHTML = head(tx('Artistas')) + `<div class="toolbar"><span class="muted">${r.length} ${tx('artistas')}</span></div><div class="grid">${r.map(artistCard).join('')}</div>`;
};
// Duración larga: «3 h 12 min» o «42 min».
const fmtLong = t => { t = Math.round((t || 0) / 60); const h = Math.floor(t / 60), m = t % 60; return h ? `${h} h${m ? ' ' + m + ' min' : ''}` : `${m || (t ? 1 : 0)} min`; };
const ARTIST_SORTS = [['album', tx('Por álbum')], ['name', 'A–Z'], ['plays', tx('Más escuchadas')]];
V.artist = async (el, { id, name }) => {
  el.innerHTML = head(name || tx('Artista')) + loading();
  let [{ artist, albums }, tracks] = await Promise.all([
    cached('artist:' + (id || name), () => api.artist(id, name)),
    cached('artistTracks:' + (id || name), () => api.artistTracks(id, name)).catch(() => [])
  ]);
  albums = albums.slice(); // la lista en caché no se toca
  // Álbumes según las etiquetas de sus canciones: los suyos (es el artista del álbum) y en los que aparece (colaboraciones,
  // recopilaciones). Sin índice, los de Jellyfin como antes.
  let guestAlbums = [];
  await LIB.index().catch(() => null);
  const tagged = tracks.length ? LIB.albumsOf(tracks) : null;
  if (tagged && tagged.length) {
    const me = albumNorm(artist.name), mine = a => albumNorm(a.artist) === me || (!!id && a.artistId === id);
    const byYear = (x, y) => (y.year || 0) - (x.year || 0) || String(x.name).localeCompare(String(y.name), 'es');
    albums.splice(0, albums.length, ...tagged.filter(mine).sort(byYear));
    guestAlbums = tagged.filter(a => !mine(a)).sort(byYear);
  } else {
    const own = new Set(albums.map(a => a.id)), guest = new Map();
    for (const t of tracks) if (t.albumId && !own.has(t.albumId) && !guest.has(t.albumId)) guest.set(t.albumId, { id: t.albumId, name: t.album || tx('Sin álbum'), type: 'album', artist: t.artist, year: t.year, imgId: t.imgId, imgTag: t.imgTag });
    guestAlbums = [...guest.values()].sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const gc = new Map(); for (const t of tracks) for (const g of t.genres || []) gc.set(g, (gc.get(g) || 0) + 1);
  const genres = [...gc].sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
  const hasPlays = tracks.some(t => t.plays > 0);
  const allK = regList(tracks);
  const bgSrc = api.img(artist, 600) || (albums[0] && api.img(albums[0], 600)) || (tracks[0] && api.img(tracks[0], 600));
  const stats = [tracks.length ? `${tracks.length} ${tracks.length === 1 ? tx('canción') : tx('canciones')}` : '', albums.length ? `${albums.length} ${albums.length === 1 ? tx('álbum') : tx('álbumes')}` : '', total ? fmtLong(total) : ''].filter(Boolean).join(' · ');
  const back = S.stack.length > 1 && !document.body.classList.contains('in-party') ? `<button class="cbtn back" data-act="back" aria-label="${tx('Atrás')}">${ic('left')}</button>` : '';
  el.innerHTML = `<section class="ahero">
      <div class="abg">${bgSrc ? `<img src="${esc(bgSrc)}" alt="" data-rm>` : ''}</div>
      <div class="atop">${back}<span class="sp"></span><span class="hlogo bear ${bearState()}" aria-hidden="true">${bearHTML()}</span></div>
      <div class="ain">
        <div class="aph">${coverHTML(artist.imgId ? { ...artist, type: 'artist' } : { ...(albums[0] || tracks[0] || artist), type: 'artist' }, 400)}</div>
        <div class="ameta">
          <div class="akind">${tx('Artista')}</div>
          <h1 title="${esc(artist.name)}">${esc(artist.name)}</h1>
          ${stats ? `<div class="astats">${esc(stats)}</div>` : ''}
          ${genres.length && api.kind === 'jellyfin' ? `<div class="agen">${genres.map(g => `<button data-act="open" data-r="genre" data-id="${esc('name:' + g)}" data-name="${esc(g)}">${esc(g)}</button>`).join('')}</div>` : ''}
          <div class="abtns">${tracks.length ? `<button class="btn pri" data-act="play-list" data-l="${allK}" data-i="0">${ic('play', 1)}${tx('Reproducir')}</button><button class="btn" data-act="genre-shuffle" data-l="${allK}">${ic('shuffle')}${tx('Aleatorio')}</button>` : ''}</div>
        </div>
      </div>
    </section>
    <div class="atabs"><div class="seg" role="tablist">
      <button role="tab" data-v="songs">${ic('music')}${tx('Canciones')}<b>${tracks.length}</b></button>
      <button role="tab" data-v="albums">${ic('disc')}${tx('Álbumes')}<b>${albums.length + guestAlbums.length}</b></button>
    </div><select class="sel" id="aSort" aria-label="${tx('Ordenar canciones')}">${ARTIST_SORTS.filter(([v]) => v !== 'plays' || hasPlays).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></div>
    <div id="aBody"></div>`;
  const body = $('#aBody', el), sortSel = $('#aSort', el);
  const sorted = () => {
    const by = Settings.artistSort === 'plays' && !hasPlays ? 'album' : Settings.artistSort, l = tracks.slice();
    if (by === 'name') l.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    else if (by === 'plays') l.sort((a, b) => (b.plays || 0) - (a.plays || 0) || a.name.localeCompare(b.name, 'es'));
    else l.sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.album).localeCompare(String(b.album), 'es') || (a.disc || 1) - (b.disc || 1) || (a.index || 0) - (b.index || 0));
    return l;
  };
  const paint = () => {
    const v = Settings.artistView === 'albums' ? 'albums' : 'songs';
    $$('.seg button', el).forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    sortSel.hidden = v !== 'songs' || !tracks.length;
    sortSel.value = Settings.artistSort === 'plays' && !hasPlays ? 'album' : Settings.artistSort;
    if (v === 'songs') {
      if (!tracks.length) { body.innerHTML = ('<div class="empty">' + tx('No encontré canciones de este artista.') + '</div>'); return; }
      const list = sorted(), listK = regList(list), pb = $('.abtns .btn.pri', el);
      if (pb) pb.dataset.l = listK; // «Reproducir» sigue el orden que se ve
      const top = hasPlays && Settings.artistSort === 'album' ? tracks.filter(t => t.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 5) : [];
      body.innerHTML = (top.length >= 3 ? `<div class="letter">${tx('Las que más escuchas')}</div>${trackRows(top, { showAlbum: true, discs: false, thumbs: true, cls: 'songs atop5' })}<div class="letter">${tx('Todas las canciones')}</div>` : '')
        + trackRows(list, { showArtist: true, showAlbum: true, discs: false, thumbs: true, cls: 'songs', key: listK });
    } else {
      body.innerHTML = (albums.length ? `<div class="letter">${tx('Álbumes')}</div><div class="grid">${albums.map(albumCard).join('')}</div>` : '')
        + (guestAlbums.length ? `<div class="letter">${tx('Aparece en')}</div><div class="grid">${guestAlbums.map(albumCard).join('')}</div>` : '')
        + (!albums.length && !guestAlbums.length ? ('<div class="empty">' + tx('Sin álbumes.') + '</div>') : '');
    }
    markCurrent();
  };
  $$('.seg button', el).forEach(b => b.onclick = () => { if (Settings.artistView === b.dataset.v) return; Settings.set('artistView', b.dataset.v); paint(); });
  sortSel.onchange = () => { Settings.set('artistSort', sortSel.value); paint(); };
  paint();
};
V.genres = async (el) => {
  el.innerHTML = head(tx('Géneros')) + loading();
  const g = await cached('genres', () => api.genres());
  el.innerHTML = head(tx('Géneros')) + (g.length ? `<div class="list">${g.map(x => `<button class="li" data-act="open" data-r="genre" data-id="${esc(x.id)}" data-name="${esc(x.name)}"><span class="cover" style="display:grid;place-items:center;color:var(--accent)">${ic('tag')}</span><span class="t">${esc(x.name)}</span>${x.count ? `<span class="s">${x.count}</span>` : ''}</button>`).join('')}</div>` : ('<div class="empty">' + tx('No encontré géneros en tu biblioteca. Revisa que tus canciones tengan la etiqueta de género y vuelve a escanear la biblioteca en Jellyfin.') + '<div style="margin-top:12px"><button class="btn" data-act="retry">' + tx('Reintentar') + '</button></div></div>'));
};
V.genre = async (el, { id, name }) => {
  el.innerHTML = head(name || tx('Género')) + loading();
  let a = await cached('genre:' + id, () => api.genre(id, name)).catch(() => []);
  const t = await cached('genreTracks:' + id, () => api.genreTracks(id, name, a));
  if (t.length) { await LIB.index().catch(() => null); const tagged = LIB.albumsOf(t); if (tagged && tagged.length) a = tagged; } // álbumes según las etiquetas
  const k = regList(t);
  el.innerHTML = head(name || tx('Género'), t.length ? `<button class="btn" data-act="play-list" data-l="${k}" data-i="0">${ic('play', 1)}<span class="lb">${tx('Reproducir')}</span></button><button class="btn" data-act="genre-shuffle" data-l="${k}">${ic('shuffle')}<span class="lb">${tx('Aleatorio')}</span></button>` : '')
    + (a.length ? `<div class="sec"><h2>${tx('Álbumes')}</h2><span class="muted">${a.length}</span></div><div class="hscroll">${a.map(albumCard).join('')}</div>` : '')
    + (t.length ? `<div class="sec"><h2>${tx('Canciones')}</h2><span class="muted">${t.length}${t.length >= 1500 ? '+' : ''} · ${fmt(t.reduce((s2, x) => s2 + (x.duration || 0), 0))}</span></div>` + trackRows(t, { showArtist: true, showAlbum: true, discs: false, thumbs: true, cls: 'songs' })
      : (a.length ? '' : ('<div class="empty">' + tx('No encontré canciones con este género. Revisa la etiqueta de género de tus archivos y vuelve a escanear la biblioteca.') + '</div>')));
};
V.playlists = async (el) => {
  el.innerHTML = head('Playlists') + loading();
  const p = await cached('playlists', () => api.playlists());
  el.innerHTML = head('Playlists') + (p.length ? `<div class="list">${p.map(x => `<button class="li" data-act="open" data-r="playlist" data-id="${esc(x.id)}">${coverHTML(x, 100)}<span class="t">${esc(x.name)}</span>${x.count != null ? `<span class="s">${x.count} ${tx('pistas')}</span>` : ''}</button>`).join('')}</div>` : ('<div class="empty">' + tx('Aún no tienes playlists. Arma una cola y pulsa') + ' <b>' + tx('Guardar') + '</b>.</div>'));
};
V.playlist = async (el, { id }) => {
  el.innerHTML = head('Playlist') + loading();
  const { playlist, tracks } = await cached('playlist:' + id, () => api.playlist(id));
  const k = regList(tracks);
  el.innerHTML = head(playlist.name, `<button class="btn" data-act="play-list" data-l="${k}" data-i="0">${ic('play', 1)}<span class="lb">${tx('Reproducir')}</span></button><button class="btn" data-act="queue-list" data-l="${k}">${ic('qadd')}<span class="lb">${tx('A la cola')}</span></button>`)
    + `<div class="toolbar"><span class="muted">${tracks.length} ${tx('pistas ·')} ${fmt(tracks.reduce((s, t) => s + t.duration, 0))}</span></div>` + (tracks.length ? trackRows(tracks, { showArtist: true, showAlbum: true, discs: false, thumbs: true, cls: 'songs' }) : ('<div class="empty">' + tx('Playlist vacía.') + '</div>'));
};
// Favoritas: muestra al instante la última lista y, cada vez que entras, la vuelve a pedir a Jellyfin
// (pudiste marcar favoritas en otro dispositivo u otra app); si cambió, se redibuja.
V.favorites = async (el) => {
  const sorts = [['name', tx('Título')], ['artist', tx('Artista')], ['album', tx('Álbum')], ['recent', tx('Añadidas recientemente')], ['played', tx('Escuchadas hace poco')], ['plays', tx('Más escuchadas')], ['random', tx('Aleatorio')]];
  const sort = sorts.some(x => x[0] === Settings.favSort) ? Settings.favSort : 'name', key = 'favs:' + sort;
  if (!api.favorites) { el.innerHTML = head(tx('Favoritas')) + ('<div class="empty">' + tx('No disponible.') + '</div>'); return; }
  const draw = raw => {
    const tracks = favMerge(raw);
    for (const t of tracks) FAVK.set(t.id, true);
    const k = regList(tracks);
    el.innerHTML = head(tx('Favoritas'), tracks.length ? `<button class="btn" data-act="play-list" data-l="${k}" data-i="0">${ic('play', 1)}<span class="lb">${tx('Reproducir')}</span></button><button class="btn" data-act="play-shuffle" data-l="${k}">${ic('shuffle')}<span class="lb">${tx('Aleatorio')}</span></button><button class="btn" data-act="queue-list" data-l="${k}">${ic('qadd')}<span class="lb">${tx('A la cola')}</span></button>` : '')
      + `<div class="toolbar"><select class="sel" id="fSort" aria-label="${tx('Ordenar')}">${sorts.map(([v, n]) => `<option value="${v}"${sort === v ? ' selected' : ''}>${n}</option>`).join('')}</select><span class="muted">${tracks.length.toLocaleString(LOC)} ${tracks.length === 1 ? tx('canción') : tx('canciones')} · ${fmt(tracks.reduce((a, t) => a + t.duration, 0))}${raw.source ? ` ${tx('· también en la playlist')} <a href="#" data-act="open" data-r="playlist" data-id="${esc(raw.sourceId)}" data-push="1">${esc(raw.source)}</a>` : ''}</span></div>`
      + (tracks.length ? trackRows(tracks, { key: k, showArtist: true, showAlbum: true, discs: false, thumbs: true, cls: 'songs' }) : `<div class="empty">${tx('Aún no tienes favoritas. Toca')} ${ic('heart')} ${tx('en el reproductor o «Agregar a favoritas» en el menú de una canción.')}</div>`);
    $('#fSort', el).onchange = e => { Settings.set('favSort', e.target.value); if (e.target.value === 'random') cache.delete('favs:random'); render(); };
    markCurrent();
  };
  const had = cache.has(key);
  if (!had) el.innerHTML = head(tx('Favoritas')) + loading();
  const tracks = await cached(key, () => api.favorites(sort));
  draw(tracks);
  if (!had) return; // recién pedida: ya está al día
  const sig = l => favMerge(l).map(t => t.id).sort().join();
  api.favorites(sort).then(fresh => {
    if (!el.isConnected || cur()?.name !== 'favorites') return;
    cache.set(key, Promise.resolve(fresh));
    if (sig(fresh) !== sig(tracks)) { const y = $('#main').scrollTop; draw(fresh); $('#main').scrollTop = y; }
  }).catch(() => { });
};
V.folders = async (el, { id, name } = {}) => {
  const title = name || tx('Carpetas');
  el.innerHTML = head(title) + loading();
  const items = await cached('folder:' + (id || 'root'), () => id ? api.folder(id) : api.views());
  const folders = items.filter(x => x.type !== 'track'), tracks = items.filter(x => x.type === 'track');
  el.innerHTML = head(title, tracks.length ? `<button class="btn" data-act="play-list" data-l="${regList(tracks)}" data-i="0">${ic('play', 1)}<span class="lb">${tx('Reproducir')}</span></button>` : '')
    + (folders.length ? `<div class="list">${folders.map(x => `<button class="li" data-act="open" data-r="folders" data-id="${esc(x.id)}" data-name="${esc(x.name)}">${x.type === 'album' ? coverHTML(x, 100) : `<span class="cover" style="display:grid;place-items:center;color:var(--accent)">${ic('folder')}</span>`}<span class="t">${esc(x.name)}</span></button>`).join('')}</div>` : '')
    + (tracks.length ? trackRows(tracks, { discs: false }) : '') + (!items.length ? ('<div class="empty">' + tx('Carpeta vacía.') + '</div>') : '');
};
V.search = async (el, { q = '' } = {}) => {
  el.innerHTML = head(tx('Buscar')) + `<form class="searchbar" id="sForm">${ic('search')}<input class="inp" id="sQ" type="search" placeholder="${tx('Artistas, álbumes, canciones o un pedazo de la letra…')}" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></form><div id="sRes"></div><div id="sLyrRes"></div>`;
  const inp = $('#sQ', el), res = $('#sRes', el), lyrBox = $('#sLyrRes', el);
  let t, seq = 0;
  const run = async () => {
    const v = inp.value.trim(); cur().params.q = v;
    if (v.length < 2) { res.innerHTML = ('<div class="empty">' + tx('Escribe al menos 2 letras.') + '</div>'); lyrBox.innerHTML = ''; return; }
    const n = ++seq; res.innerHTML = loading();
    // En paralelo: también en las letras. Si ni el nombre ni la letra coinciden, se dice.
    const none = () => { if (n === seq && el.isConnected && st.base === 0 && st.lyr === 0) res.innerHTML = `<div class="empty">${tx('Nada coincide con «')}${esc(v)}${tx('», ni en las letras de tus canciones.')}</div>`; };
    const st = { base: null, lyr: lyrNorm(v).length >= 4 ? null : 0 };
    lyricsSection(lyrBox, v, () => n === seq && el.isConnected, 'play-list', k => { st.lyr = k; none(); });
    try {
      const r = await api.search(v); if (n !== seq) return;
      // Álbumes según las etiquetas (si el índice ya está; si no, se arma para la próxima búsqueda).
      const L = LIB.peek();
      if (L) { const k = normTxt(v); r.albums = L.list.filter(a => normTxt(a.name).includes(k) || normTxt(a.artist).includes(k)).sort((x, y) => normTxt(x.name).indexOf(k) - normTxt(y.name).indexOf(k) || y.count - x.count); }
      else LIB.index().catch(() => { });
      if (!r.artists.length && !r.albums.length && !r.tracks.length) { st.base = 0; res.innerHTML = lyrNorm(v).length >= 4 ? '' : `<div class="empty">${tx('Nada coincide con «')}${esc(v)}».</div>`; none(); return; }
      st.base = 1;
      res.innerHTML = (r.artists.length ? `<div class="letter">${tx('Artistas')}</div><div class="grid">${r.artists.slice(0, 12).map(artistCard).join('')}</div>` : '')
        + (r.albums.length ? `<div class="letter">${tx('Álbumes')}</div><div class="grid">${r.albums.slice(0, 24).map(albumCard).join('')}</div>` : '')
        + (r.tracks.length ? songsBlock(r.tracks) : '');
    } catch (e) { if (n === seq) res.innerHTML = errBox(e); }
  };
  inp.oninput = () => { clearTimeout(t); t = setTimeout(run, 280); };
  $('#sForm', el).onsubmit = e => { e.preventDefault(); clearTimeout(t); run(); inp.blur(); };
  if (q) run(); else res.innerHTML = '';
  if (!mqMobile.matches || !q) setTimeout(() => inp.focus(), 50);
};
function songsBlock(tracks) {
  const grid = Settings.songView === 'grid';
  const tog = `<span class="vt" role="group" aria-label="${tx('Vista')}"><button class="vbtn${grid ? '' : ' on'}" data-act="songview" data-v="list" aria-label="${tx('Lista')}">${ic('rows')}</button><button class="vbtn${grid ? ' on' : ''}" data-act="songview" data-v="grid" aria-label="${tx('Cuadrícula')}">${ic('grid')}</button></span>`;
  if (!grid) return `<div class="letter lrow">${tx('Canciones')}${tog}</div>` + trackRows(tracks, { showArtist: true, showAlbum: true, discs: false, thumbs: true, cls: 'songs' });
  const k = regList(tracks);
  return `<div class="letter lrow">${tx('Canciones')}${tog}</div><div class="grid">` + tracks.map((t, i) => `<div class="card scard${P.cur && P.cur.id === t.id ? ' cur' : ''}" data-tid="${esc(t.id)}"><button class="cbox" data-act="play-list" data-l="${k}" data-i="${i}" aria-label="${esc(tx('Reproducir {0}', [t.name]))}">${coverHTML(t)}<span class="pl">${ic('play', 1)}</span></button><button class="more" data-act="track-menu" data-l="${k}" data-i="${i}" aria-label="${tx('Opciones')}">${ic('more')}</button><div class="t">${esc(t.name)}</div><div class="s">${esc([t.trackArtist || t.artist, t.album].filter(Boolean).join(' · '))}</div></div>`).join('') + '</div>';
}
V.queue = async (el) => { el.innerHTML = ''; const box = document.createElement('div'); box.className = 'qview'; el.appendChild(box); renderQueue(box); };
V.more = async (el) => {
  el.innerHTML = head(tx('Más')) + `<div class="list">${[['albums', tx('Álbumes'), 'disc'], ['artists', tx('Artistas'), 'user'], ['playlists', 'Playlists', 'list'], ['favorites', tx('Favoritas'), 'heart'], ...(DL.usable() ? [['downloads', tx('Descargas'), 'download']] : []), ...(recapYearOpen() ? [['recap', tx('Tu año con Nanuq'), 'spark']] : []), ['genres', tx('Géneros'), 'tag'], ['folders', tx('Carpetas'), 'folder'], ...(partyOn() ? [['party', tx('Fiesta'), 'party']] : []), ['request', tx('Solicitar canción'), 'req'], ['settings', tx('Ajustes'), 'gear']].map(([r, n, i]) => `<button class="li" data-act="open" data-r="${r}" data-push="1"><span class="cover" style="display:grid;place-items:center;color:var(--accent)">${ic(i)}</span><span class="t">${n}</span></button>`).join('')}<button class="li" data-act="logout"><span class="cover" style="display:grid;place-items:center;color:var(--muted)">${ic('out')}</span><span class="t">${tx('Cerrar sesión')}</span></button></div>`;
};
V.settings = async (el) => {
  const q = [[140000000, tx('Original (sin transcodificar)')], [320000, '320 kbps'], [192000, '192 kbps'], [128000, '128 kbps'], [96000, tx('96 kbps (ahorro de datos)')]];
  el.innerHTML = head(tx('Ajustes')) + `<div class="set">
    <h2>${tx('Idioma')}</h2>
    <div class="row"><div class="l">${tx('Idioma de Nanuq')}<small>${tx('Al cambiarlo, Nanuq se vuelve a abrir en ese idioma (la música queda en pausa en el mismo segundo).')}</small></div><select class="sel" id="langSel" aria-label="${tx('Idioma')}">${(() => { const chosen = store.get('lang', null), pick = Object.hasOwn(LANGS, chosen) ? chosen : LANG_AUTO ? 'auto' : LANG; return (LANG_AUTO ? `<option value="auto"${pick === 'auto' ? ' selected' : ''}>${tx('Idioma del sistema')} (${Object.hasOwn(LANGS, LANG_SYS) ? LANGS[LANG_SYS] : 'English'})</option>` : '') + Object.entries(LANGS).map(([k, n]) => `<option value="${k}"${pick === k ? ' selected' : ''}>${n}</option>`).join(''); })()}</select></div>
    <h2>${tx('Tema')}</h2><details class="thbox"><summary>${themeSummary()}</summary><div class="themes">${Object.entries(THEMES).map(([k, t]) => `<button class="th${Settings.theme === k ? ' on' : ''}" data-act="theme" data-t="${k}"><div class="pv" style="background:${t.bg}"><i style="background:${t.side};border-right:1px solid ${t.t}22"></i><div class="b"><span style="background:${t.a};width:60%"></span><span style="background:${t.t};opacity:.35;width:85%"></span><span style="background:${t.t};opacity:.2;width:45%"></span></div></div>${logoInner(k).replace('class="lgimg"', 'class="lgimg tiny"')}<b>${t.name}</b></button>`).join('')}</div></details>
    <h2>${tx('Reproducción')}</h2>
    ${DISC.can() ? `<div class="row"><div class="l">${tx('Mostrar en Discord lo que escuchas')}<small>${tx('Tu perfil dice «Escuchando Nanuq» con la canción, el artista y el tiempo, como con Spotify. Necesita Discord abierto en esta computadora (o Vesktop/Equibop con Rich Presence activado).')}</small><small class="dcst" id="dcSt"${Settings.discord ? '' : ' hidden'}></small></div><button class="sw${Settings.discord ? ' on' : ''}" data-act="discord" aria-label="${tx('Mostrar en Discord lo que escuchas')}"></button></div>
    <div class="row" id="dcCoverRow"${Settings.discord ? '' : ' hidden'}><div class="l">${tx('Con la portada')}<small>${tx('Discord solo muestra imágenes que puede descargar de internet, así que solo funciona si tu Jellyfin está en internet por https (y su dirección queda a la vista de quien vea tu perfil). Si no, se muestra el logo de Nanuq.')}</small></div><button class="sw${Settings.discordCover ? ' on' : ''}" data-act="discord-cover" aria-label="${tx('Mostrar la portada en Discord')}"></button></div>` : ''}
    <div class="row"><div class="l">${tx('Calidad del streaming')}<small>${tx('Si tu archivo supera este bitrate, Jellyfin lo convierte a MP3. En «Original», si una canción no arranca, Nanuq la pide en MP3 sola.')}</small></div><select class="sel" id="qSel">${q.map(([v, n]) => `<option value="${v}"${+Settings.quality === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="row"><div class="l">${tx('Animaciones del reproductor')}<small>${tx('Con el DJ activo: Nanuq con su tornamesa y el disco girando, solo el disco de vinilo, o la portada de siempre.')}</small></div><select class="sel" id="paSel">${[['all', tx('Todas')], ['disc', tx('Solo el disco de vinilo')], ['none', tx('Ninguna')]].map(([v, n]) => `<option value="${v}"${Settings.playerAnim === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="row"><div class="l">${tx('Desvanecer al pausar')}<small>${tx('La música baja suave al pausar y sube suave al reanudar.')}</small></div><button class="sw${Settings.fade ? ' on' : ''}" data-act="fade" aria-label="${tx('Desvanecer al pausar')}"></button></div>
    <div class="row"><div class="l">${tx('Forma de onda real')}<small>${tx('Descarga una copia ligera de cada canción para dibujarla (≈2 MB por pista).')}</small></div><button class="sw${Settings.wave ? ' on' : ''}" data-act="wave" aria-label="${tx('Forma de onda')}"></button></div>
    ${PF.usable() ? `<div class="row"><div class="l">${tx('Guardar por adelantado lo que sigue')}<small>${tx('El teléfono baja las próximas canciones de tu cola mientras escuchas, así suenan aunque la red se ponga lenta o se corte un momento. Se guardan solo un rato y no cuentan como descargas.')}</small></div><button class="sw${Settings.pfOn ? ' on' : ''}" data-act="pf" aria-label="${tx('Guardar por adelantado lo que sigue')}"></button></div>
    <div class="row" id="pfRow"${Settings.pfOn ? '' : ' hidden'}><div class="l">${tx('Cuánto guardar por adelantado')}<small>${tx('Minutos de música de tu cola, a partir de la que suena.')}</small></div><select class="sel" id="pfSel">${[5, 10, 15, 20, 30, 60].map(v => `<option value="${v}"${+Settings.pfMin === v ? ' selected' : ''}>${tx('{0} minutos', [v])}</option>`).join('')}</select></div>` : ''}
    ${DL.usable() ? `<h2>${tx('Descargas')}</h2>
    <div class="row"><div class="l">${tx('Canciones en el teléfono')}<small id="dlSum">${esc(dlSummary())}</small></div><button class="btn" data-act="open" data-r="downloads" data-push="1">${ic('download')}${tx('Gestionar')}</button></div>
    <div class="row"><div class="l">${tx('Máximo de canciones')}<small>${tx('Al llegar al máximo, las guardadas automáticamente que menos escuchas dejan lugar a las nuevas.')}</small></div><select class="sel" id="dlMaxSel">${[25, 50, 100, 200, 500, 1000, 2000].map(v => `<option value="${v}"${+Settings.dlMax === v ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="row"><div class="l">${tx('Descargar solo con Wi-Fi')}<small>${tx('Apágalo para descargar también con datos móviles.')}</small></div><button class="sw${Settings.dlWifi ? ' on' : ''}" data-act="dl-wifi" aria-label="${tx('Descargar solo con Wi-Fi')}"></button></div>
    <div class="row"><div class="l">${tx('Guardar las más escuchadas')}<small>${tx('Cuando escuchas una canción')} ${AUTO_PLAYS} ${tx('veces, se guarda sola para no volver a gastar datos en ella.')}</small></div><button class="sw${Settings.dlAuto ? ' on' : ''}" data-act="dl-auto" aria-label="${tx('Guardar automáticamente las más escuchadas')}"></button></div>
    <div class="row"><div class="l">${tx('Calidad de las descargas')}<small>${tx('Más calidad ocupa más espacio. Original guarda el archivo tal cual (FLAC puede pesar 30 MB).')}</small></div><select class="sel" id="dlQSel">${q.map(([v, n]) => `<option value="${v}"${+Settings.dlQuality === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
    ${api.kind === 'jellyfin' ? `<h2>${tx('Mis dispositivos')}</h2>
    <div class="row"><div class="l">${tx('Sincronizar con mis otros dispositivos')}<small>${tx('Si Nanuq suena en tu teléfono o tu computadora con este mismo usuario, aquí ves la misma canción, el progreso y la cola, y los controles mandan allá. Usa tu Jellyfin como puente.')}</small></div><button class="sw${Settings.devSync ? ' on' : ''}" data-act="dev-sync" aria-label="${tx('Sincronizar con mis otros dispositivos')}"></button></div>
    <div class="row"><div class="l">${tx('Solo en la misma red')}<small>${tx('Se conectan solos únicamente si Jellyfin ve ambos dispositivos desde tu red. Desde «Dispositivos» puedes conectar a mano uno de otra red.')}</small></div><button class="sw${Settings.devSameNet ? ' on' : ''}" data-act="dev-net" aria-label="${tx('Solo en la misma red')}"></button></div>
    <div class="row"><div class="l">${tx('Aceptar órdenes de otros usuarios')}<small>${tx('Por seguridad, este Nanuq solo acepta que le pongan canciones desde tus propios dispositivos. Actívalo si quieres que otro usuario de tu Jellyfin con permiso para controlar a otros (por ejemplo, un administrador) pueda hacerlo.')}</small></div><button class="sw${Settings.devOthers ? ' on' : ''}" data-act="dev-others" aria-label="${tx('Aceptar órdenes de otros usuarios')}"></button></div>
    <div class="row"><div class="l">${tx('Dispositivos')}<small>${tx('Ver tus otros Nanuq, pasarles la música o controlarlos.')}</small></div><button class="btn" data-act="devices">${ic('devices')}${tx('Ver')}</button></div>` : ''}
    <h2>${tx('Servidor')}</h2>
    <div class="row"><div class="l">${esc(api.serverName || 'Jellyfin')}<small>${api.kind === 'demo' ? tx('Modo demo, sin servidor') : esc(api.base) + ' · Jellyfin ' + esc(api.version || '') + ' · ' + esc(api.userName)}</small></div><button class="btn" data-act="logout">${ic('out')}${tx('Salir')}</button></div>
    ${api.kind === 'jellyfin' ? `<div class="row"><div class="l">${tx('Actualizar desde Jellyfin')}<small>${tx('Vuelve a pedir a tu servidor los datos de tu biblioteca (álbumes, canciones, carátulas, favoritas y las canciones de tu cola), por si cambiaste algo en Jellyfin. Si eres administrador, además le pide a Jellyfin que revise tus archivos.')}</small></div><button class="btn" data-act="lib-refresh">${ic('refresh')}${tx('Actualizar')}</button></div>` : ''}
    <div class="row"><div class="l">${tx('Tu semana con Nanuq')}<small>${tx('Un video de menos de un minuto con lo que escuchaste la semana pasada, presentado por Nanuq.')}</small></div><button class="btn" data-act="recap-week">${ic('spark')}${tx('Crear')}</button></div>
    ${api.kind === 'jellyfin' ? `<div class="row"><div class="l">${tx('Datos de tus resúmenes')}<small id="rcSrc">${tx('Revisando tu servidor…')}</small></div></div>` : ''}
    ${api.kind === 'jellyfin' ? `<div class="row"><div class="l">${tx('Datos guardados en este dispositivo')}<small>${esc(tx('Sesión, cola, DJ, pedidos, servidores y letras: ') + (SEC.ok() ? (window.NanuqAndroid ? tx('cifrados con el almacén de claves de Android (AES-256).') : tx('cifrados (AES-256) con una clave guardada en el llavero del sistema (') + ({ gnome_libsecret: 'GNOME Keyring', kwallet: 'KWallet', kwallet5: 'KWallet', kwallet6: 'KWallet', dpapi: 'Windows', keychain: tx('Llavero de macOS') }[SEC.kind] || SEC.kind) + ').') : SEC.kind === 'locked' ? tx('el almacén cifrado no se pudo abrir; mientras tanto no se guarda nada nuevo (al entrar puedes empezar de cero).') : SEC.kind === 'lost' ? tx('los datos cifrados anteriores ya no se pueden abrir (se perdió su clave); mientras tanto no se guarda nada nuevo.') : window.nanuqDesktop ? tx('sin cifrar, porque no se encontró un llavero del sistema (GNOME Keyring o KWallet). Solo tu usuario puede leer el archivo.') : window.NanuqAndroid ? tx('en el almacenamiento privado de la app, que Android cifra y aísla.') : tx('los guarda el navegador, en tu perfil.')))}</small></div></div>` : ''}
    ${api.kind === 'jellyfin' ? `<div class="row"><div class="l">${tx('Probar conexión')}<small>${tx('Mide la respuesta del servidor y la descarga de una canción para encontrar por qué tarda en empezar.')}</small></div><button class="btn" data-act="conn-test">${ic('bolt')}${tx('Probar')}</button></div>` : ''}
    <div class="row"><div class="l">Nanuq ${VERSION}<small>${tx('Cliente de música para Jellyfin. Estética inspirada en Polaris.')}</small><small>${tx('Software libre bajo la licencia GNU GPL versión 3 o posterior: puedes usarlo, estudiarlo, compartirlo y modificarlo.')} <a href="https://github.com/Fleyrer/nanuq-jellyfin-player/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">${tx('Ver la licencia')}</a></small></div></div>
  </div>`;
  dcStatusPaint();
  $('#qSel', el).onchange = e => Settings.set('quality', +e.target.value);
  // Cambiar de idioma: se guarda y la página se vuelve a abrir (así todo, hasta lo que se arma al cargar, sale en el idioma
  // nuevo). La posición de la canción se guarda antes para seguir en el mismo segundo.
  $('#langSel', el).onchange = e => {
    const v = e.target.value;
    if (v === 'auto' && LANG_AUTO) store.del('lang'); else if (Object.hasOwn(LANGS, v)) store.set('lang', v); else return;
    QPOS.save(true); location.reload();
  };
  if ($('#pfSel', el)) $('#pfSel', el).onchange = e => { Settings.set('pfMin', +e.target.value); PF.sync(); };
  $('#paSel', el).onchange = e => { Settings.set('playerAnim', e.target.value); DJ.stage = { qid: null, i: -1 }; DJ.scene(); };
  if ($('#dlMaxSel', el)) {
    $('#dlMaxSel', el).onchange = e => {
      const v = +e.target.value, manual = DL.list().filter(x => !x.auto).length;
      Settings.set('dlMax', v); DL.config();
      if (manual > v) toast(tx('Tienes {0} canciones que descargaste tú; no se borran solas. Quita algunas en Gestionar.', [manual]), 5000);
      setTimeout(() => { const x = $('#dlSum'); if (x) x.textContent = dlSummary(); }, 300);
    };
    $('#dlQSel', el).onchange = e => Settings.set('dlQuality', +e.target.value);
  }
};
// Ajustes: de dónde salen los datos de «Tu semana» y «Tu año».
{ const base = V.settings; V.settings = async el => {
  await base(el);
  const e = $('#rcSrc', el); if (!e) return;
  const ok = await ServerStats.available();
  if (e.isConnected) e.textContent = ok ? tx('Del historial de reproducción de tu servidor (plugin Playback Reporting): todas tus reproducciones, desde cualquier app, solo de tu usuario.') : tx('De los datos básicos que Jellyfin guarda de tu usuario (aproximados). Para resúmenes exactos, instala en Jellyfin el plugin «Playback Reporting»; Nanuq lo puede leer si tu usuario es administrador.');
}; }
V.downloads = async (el) => {
  const all = DL.list().sort((a, b) => (a.state === 'done') - (b.state === 'done') || b.added - a.added);
  const doneE = all.filter(e => e.state === 'done'), done = doneE.map(e => e.track || {});
  const k = regList(done), autoN = all.filter(e => e.auto).length;
  const row = e => {
    const t = e.track || {}, i = doneE.indexOf(e), pct = e.state === 'downloading' && e.total > 0 ? Math.floor(e.bytes / e.total * 100) : -1;
    const sub = [t.trackArtist || t.artist, e.state === 'done' ? fmtMB(e.size) : dlStatus(e) + (e.state === 'error' && e.error ? ': ' + e.error : '')].filter(Boolean).join(' · ');
    return `<div class="dlrow">${coverHTML(t, 100)}<button class="m"${i >= 0 ? ` data-act="play-list" data-l="${k}" data-i="${i}"` : ''}><div class="t">${esc(t.name || tx('Canción'))}${e.auto ? ('<span class="tag">' + tx('Automática') + '</span>') : ''}</div><small>${esc(sub)}</small>${pct >= 0 ? `<div class="dlbar"><i style="width:${pct}%"></i></div>` : ''}</button><button class="cbtn" data-act="dl-remove" data-id="${esc(e.id)}" aria-label="${tx('Quitar de las descargas')}" title="${tx('Quitar')}">${ic('x')}</button></div>`;
  };
  el.innerHTML = head(tx('Descargas'), done.length ? `<button class="btn" data-act="play-list" data-l="${k}" data-i="0">${ic('play', 1)}<span class="lb">${tx('Reproducir')}</span></button>` : '')
    + `<div class="dlsum muted">${esc(dlSummary())}${Settings.dlWifi ? tx(' · solo con Wi-Fi') : ''}</div>`
    + (all.length ? `<div class="list">${all.map(row).join('')}</div>
      <div class="dlsum" style="margin-top:18px">${autoN ? `<button class="btn" data-act="dl-clear" data-auto="1">${tx('Borrar automáticas (')}${autoN})</button>` : ''}<button class="btn" data-act="dl-clear">${tx('Borrar todas')}</button></div>`
      : `<div class="empty">${tx('Aún no hay canciones en el teléfono.')}<br>${tx('Toca')} <b>${tx('Descargar')}</b> ${tx('en la pantalla de reproducción')}${Settings.dlAuto ? tx(', o escucha una canción {0} veces y se guardará sola', [AUTO_PLAYS]) : ''}.</div>`);
};
let dlRenderT = 0;
function renderDownloadsSoon() {
  if (dlRenderT) return;
  dlRenderT = setTimeout(async () => { dlRenderT = 0; if (cur()?.name !== 'downloads') return; const m = $('#main').scrollTop; await render(); $('#main').scrollTop = m; }, 500);
}

/* =========================================================
   Tu año con Nanuq: resumen anual de lo que escuchaste, presentado por los Nanuqs y exportable como video (≤ 1 min).
   Datos: los de tu usuario en el servidor (plugin Playback Reporting si está; si no, lo que guarda Jellyfin).
   Todo se dibuja en un <canvas>: nada de lo que llega del servidor se mete como
   HTML (el resumen en texto de la vista pasa por esc()). La música se genera aquí mismo (no usa tus canciones).
   ========================================================= */
// Los resúmenes usan los datos del servidor (solo del usuario activo); el historial local que guardaban versiones
// anteriores ya no se usa y se borra.
const History = {
  purge() {
    try { store.del('history.' + (sid(api && api.userId) || 'local')); store.del('history.local'); for (const k of Object.keys(localStorage)) if (k.startsWith('nanuq.history.')) localStorage.removeItem(k); } catch { }
  }
};
// Historial de reproducción del servidor: plugin «Playback Reporting» de Jellyfin. Guarda cada reproducción (usuario,
// canción, hora y segundos escuchados) desde cualquier app. Su API exige que el usuario sea administrador. Nanuq solo
// lo lee, para el usuario activo, con la fecha que arma él y el filtro fijo «Audio» (el plugin mete el filtro tal cual
// en su SQL); su consulta SQL libre no se usa.
const ServerStats = {
  ok: null, who: '',
  async available() {
    if (!api || api.kind !== 'jellyfin') return false;
    if (this.who === api.userId && this.ok != null) return this.ok;
    this.who = api.userId;
    try { const r = await api.req('/user_usage_stats/type_filter_list'); this.ok = Array.isArray(r); } catch { this.ok = false; }
    return this.ok;
  },
  // Reproducciones entre dos fechas (locales): [{ ms, id, sec }]. Un día por consulta, cuatro a la vez.
  async plays(from, to, onProgress) {
    const days = []; for (let d = new Date(from); d.getTime() < to && days.length < 370; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);
    const tz = -new Date().getTimezoneOffset() / 60, uid = sid(api.userId), pad = n => String(n).padStart(2, '0'), out = [];
    let k = 0, done = 0, stop = false;
    const worker = async () => {
      while (k < days.length && !stop) {
        const d = days[k++], ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const r = await api.req(`/user_usage_stats/${uid}/${ds}/GetItems`, { params: { filter: 'Audio', timezoneOffset: tz } }).catch(() => []);
        for (const x of Array.isArray(r) ? r.slice(0, 3000) : []) {
          const id = sid(x && x.Id); if (!id) continue;
          const m = /(\d{1,2}):(\d{2})\s*([AaPp])?/.exec(String(x.Time || '')); let h = m ? +m[1] : 12; const mi = m ? +m[2] : 0;
          if (m && m[3]) { const pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
          out.push({ ms: new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.min(h, 23), Math.min(mi, 59)).getTime(), id, sec: Math.max(0, Math.min(num(x.Duration), 6 * 3600)) });
          if (out.length >= 200000) { stop = true; break; } // tope de memoria
        }
        done++;
        // Si ya no se ve la vista (saliste a otra pantalla), se dejan de pedir días.
        if (onProgress && onProgress(done, days.length) === false) stop = true;
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return out.sort((a, b) => a.ms - b.ms);
  }
};

// Personalidad musical según el género favorito: nombre, frase y el disfraz (accesorio de un tema) que se pone Nanuq.
const RECAP_PERSONAS = [
  [['metal', 'rock', 'punk', 'grunge', 'hardcore', 'emo'], tx('Oso Rockero'), 'Guitarras al máximo y los audífonos echando humo.', 'chile'],
  [['reggaeton', 'latin', 'latino', 'salsa', 'cumbia', 'bachata', 'merengue', 'urbano', 'tropical'], tx('Oso Tropical'), tx('Si hay ritmo, hay baile. Nanuq ya se puso el collar de flores.'), 'caribe'],
  [['electro', 'edm', 'house', 'techno', 'trance', 'dubstep', 'synth', 'drum'], tx('Oso Raver'), tx('Luces de neón, bajos profundos y lentes oscuros a medianoche.'), 'synth'],
  [['hip hop', 'hip-hop', 'rap', 'trap', 'r&b', 'soul', 'funk'], tx('Oso del Barrio'), tx('Flow constante y la cabeza siguiendo el beat.'), 'gato'],
  [['jazz', 'blues', 'bossa', 'swing', 'lounge'], tx('Oso de Jazz'), tx('Café en mano y saxofón de fondo.'), 'cafe'],
  [['classical', 'clásic', 'clasic', 'orchestr', 'orquest', 'soundtrack', 'piano', 'score', 'banda sonora'], tx('Oso de Gala'), tx('Elegancia de concierto, aunque sea en pijama.'), 'invierno'],
  [['indie', 'alternativ', 'folk', 'acoust', 'acúst', 'lo-fi', 'lofi', 'chill', 'ambient'], tx('Oso Indie'), tx('Descubres bandas antes de que sean famosas.'), 'leaf'],
  [['pop', 'k-pop', 'dance', 'disco'], tx('Oso Pop'), tx('Coros pegajosos y cero vergüenza al cantarlos.'), 'pony'],
  [['country', 'ranchera', 'regional', 'mariachi', 'banda', 'norteñ'], tx('Oso Ranchero'), tx('Sombrero imaginario y corazón de cantina.'), 'girasol']
];
// Pronóstico musical de la semana: [clima, frase, dibujo]
const RECAP_WEATHER = {
  chile: [tx('Tormenta eléctrica'), tx('de guitarras y baterías'), 'storm'], caribe: [tx('Soleado y caluroso'), tx('con ráfagas de ritmo tropical'), 'sun'],
  synth: [tx('Noche despejada'), tx('con luces de neón hasta el amanecer'), 'neon'], gato: [tx('Nublado con beats'), tx('y rimas dispersas'), 'cloud'],
  cafe: [tx('Lluvia suave'), tx('con saxofón de fondo'), 'rain'], invierno: [tx('Nevada elegante'), tx('con orquesta de fondo'), 'snow'],
  leaf: [tx('Brisa fresca'), tx('con guitarras acústicas'), 'breeze'], pony: [tx('Arcoíris pegajoso'), tx('con coros para cantar'), 'rainbow'],
  girasol: [tx('Calor de feria'), tx('con trompetas y acordeón'), 'sun'], aurora: [tx('Clima variado'), tx('un poco de todo, como debe ser'), 'aurora']
};
const RECAP_W = 720, RC_H = 1280, RECAP_FPS = 30, RECAP_BPM = 112;
// Escenas y duración (s). Total ≈ 50 s: el video nunca pasa de 1 minuto.
const RECAP_SCENES = [['intro', 5], ['minutes', 6], ['drum', 2.6], ['artist', 5], ['artists', 5], ['songs', 8], ['persona', 6], ['habits', 6], ['outro', 6.5]];
const RECAP_TRANS = ['slide', 'circle', 'zoom', 'wipe'];
const RECAP_TOTAL = RECAP_SCENES.reduce((a, s) => a + s[1], 0);
// Semana pasada: ≈ 52 s (también por debajo del minuto).
const RECAP_WEEK_SCENES = [['wk-intro', 4], ['wk-minutes', 5], ['wk-days', 5], ['wk-drum', 2.6], ['wk-song', 5], ['wk-top', 6], ['wk-artists', 6], ['wk-hours', 5], ['wk-new', 4.5], ['wk-weather', 5.5], ['wk-outro', 4]]; // ≈ 52.6 s

const Recap = {
  // Modo: resumen del año (≈ 50 s) o de la semana pasada (≈ 52 s). Mismo motor, otras escenas y otro ritmo.
  scenes: RECAP_SCENES, bpm: RECAP_BPM, tr: .7, week: false,
  get total() { return this.scenes.reduce((a, x) => a + x[1], 0); },
  setMode(week) { Object.assign(this, week ? { scenes: RECAP_WEEK_SCENES, bpm: 118, tr: .6, week: true } : { scenes: RECAP_SCENES, bpm: RECAP_BPM, tr: .7, week: false }); },
  // ---- Datos (siempre del usuario activo) ----
  // Reproducciones del periodo: del plugin Playback Reporting si está (exacto: cada reproducción con sus segundos
  // escuchados; cuenta si duró 30 s o más); si no, lo que Jellyfin guarda de tu usuario (aproximado: la última vez que
  // sonó cada canción y su total de reproducciones).
  async plays(from, to, { week, onProgress } = {}) {
    if (api.kind === 'demo') {
      const r = rng('demo' + from), out = [], meta = new Map();
      for (const t of api.tracksList.slice(0, week ? 30 : 120)) { meta.set(t.id, t); const n = Math.floor(r() * r() * (week ? 8 : 40)) + 1; for (let k = 0; k < n; k++) out.push({ ms: from + r() * (Math.min(to, Date.now()) - from), id: t.id, sec: num(t.duration) }); }
      return { source: 'demo', list: out, meta };
    }
    if (await ServerStats.available()) {
      const raw = (await ServerStats.plays(from, to, onProgress)).filter(p => p.sec >= 30);
      const ids = [...new Set(raw.map(p => p.id))].slice(0, 4000), meta = new Map();
      (await api.itemsByIds(ids).catch(() => [])).filter(t => t.type === 'track').forEach(t => meta.set(t.id, t));
      return { source: 'servidor', list: raw.filter(p => meta.has(p.id)), meta };
    }
    const jt = await this.jellyfinYear(from, to).catch(() => []), meta = new Map(), list = [];
    for (const t of jt) { meta.set(t.id, t); const n = week ? 1 : Math.max(1, num(t.plays)); for (let k = 0; k < n; k++) list.push({ ms: t.lastPlayed, id: t.id, sec: num(t.duration) }); }
    return { source: 'jellyfin', list, meta };
  },
  // Agrupa las reproducciones: canciones, artistas, géneros, horas, días…
  tally(P0) {
    const songs = new Map(), artists = new Map(), genres = new Map(), hours = Array(24).fill(0), days = Array(7).fill(0);
    for (const p of P0.list) {
      const t = P0.meta.get(p.id); if (!t) continue;
      const s = songs.get(p.id) || { id: p.id, name: t.name, artist: t.trackArtist || t.artist || '', album: t.album || '', genre: (t.genres || [])[0] || '', imgId: t.imgId, imgTag: t.imgTag, artistId: t.artistId, total: num(t.plays), n: 0, sec: 0, first: p.ms };
      s.n++; s.sec += p.sec; songs.set(p.id, s);
      const d = new Date(p.ms); hours[d.getHours()]++; days[(d.getDay() + 6) % 7]++;
    }
    const list = [...songs.values()];
    for (const s of list) {
      const a = String(s.artist || '').split(/,\s*/)[0].trim() || tx('Artista desconocido');
      const e = artists.get(a) || { name: a, n: 0, sec: 0, artistId: s.artistId, imgId: s.imgId, imgTag: s.imgTag }; e.n += s.n; e.sec += s.sec; if (!e.artistId && s.artistId) e.artistId = s.artistId; artists.set(a, e);
      if (s.genre) genres.set(s.genre, (genres.get(s.genre) || 0) + s.n);
    }
    // Racha: días seguidos con música (solo con fechas reales de cada reproducción).
    let streak = 0;
    if (P0.source !== 'jellyfin') { const ds = [...new Set(P0.list.map(p => { const d = new Date(p.ms); return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5); }))].sort((a, b) => a - b); let run = 0, prev = null; for (const x of ds) { run = prev != null && x === prev + 1 ? run + 1 : 1; streak = Math.max(streak, run); prev = x; } }
    const gname = ([...genres].sort((a, b) => b[1] - a[1])[0] || [''])[0], pn = normTxt(gname);
    const persona = RECAP_PERSONAS.find(p => p[0].some(w => pn.includes(normTxt(w)))) || [null, tx('Oso Ecléctico'), tx('Un poco de todo y sin miedo a mezclar.'), 'aurora'];
    const top = list.slice().sort((a, b) => b.n - a.n || b.sec - a.sec);
    const peak = hours.indexOf(Math.max(...hours));
    const firstPlay = P0.list[0] && P0.meta.get(P0.list[0].id);
    return { list, top, artists: [...artists.values()].sort((a, b) => b.n - a.n || b.sec - a.sec), hours, days, peak, streak, gname, persona, firstPlay, activeDays: days.filter(Boolean).length }; // activeDays: días de la semana con música (lo usa «Tu semana»)
  },
  async collect(year, onProgress) {
    const from = new Date(year, 0, 1).getTime(), to = Math.min(new Date(year + 1, 0, 1).getTime(), Date.now());
    const P0 = await this.plays(from, to, { onProgress }), T = this.tally(P0);
    if (T.list.length < 3) return null;
    const clock = T.peak < 6 ? [tx('Oso trasnochador'), tx('La mejor música suena cuando todos duermen.')] : T.peak < 12 ? [tx('Oso madrugador'), tx('Tu día empieza con música desde temprano.')] : T.peak < 19 ? [tx('Oso de tarde'), tx('Tus tardes tienen banda sonora.')] : [tx('Oso nocturno'), tx('De noche es cuando más le subes el volumen.')];
    return {
      year, source: P0.source, minutes: Math.round(T.list.reduce((a, s) => a + s.sec, 0) / 60), songsN: T.list.length, artistsN: T.artists.length,
      top: T.top.slice(0, 5), topArtists: T.artists.slice(0, 5), genre: T.gname, persona: { name: T.persona[1], line: T.persona[2], theme: T.persona[3] },
      hours: T.hours, peak: T.peak, clock, streak: T.streak, first: P0.source === 'jellyfin' ? '' : (T.firstPlay || {}).name || '', repeat: T.top[0]
    };
  },
  // Semana pasada (lunes a domingo, hora local).
  async collectWeek(onProgress) {
    const now = new Date(), mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7);
    const from = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() - 7).getTime(), to = mon.getTime();
    const P0 = await this.plays(from, to, { week: true, onProgress }), T = this.tally(P0);
    if (!T.list.length) return null;
    // Descubrimientos: canciones cuyo total de reproducciones en tu Jellyfin no pasa de lo de esa semana (antes no las habías puesto).
    const fresh = P0.source === 'servidor' ? T.list.filter(s => s.total && s.total <= s.n).sort((a, b) => a.first - b.first) : null;
    const fmtD = ms => new Date(ms).toLocaleDateString(LOC, { day: 'numeric', month: 'short' });
    return {
      week: true, year: new Date(from).getFullYear(), source: P0.source, label: fmtD(from) + ' – ' + fmtD(to - 1), from,
      minutes: Math.round(T.list.reduce((a, s) => a + s.sec, 0) / 60), plays: T.list.reduce((a, s) => a + s.n, 0), songsN: T.list.length, artistsN: T.artists.length,
      top: T.top.slice(0, 5), topArtists: T.artists.slice(0, 3), days: T.days, bestDay: T.days.indexOf(Math.max(...T.days)), activeDays: T.activeDays,
      hours: T.hours, peak: T.peak, genre: T.gname, persona: { name: T.persona[1], theme: T.persona[3] }, weather: RECAP_WEATHER[T.persona[3]] || RECAP_WEATHER.aurora,
      fresh: fresh && { n: fresh.length, first: fresh[0] }
    };
  },
  async jellyfinYear(from, to) {
    const out = [];
    for (let start = 0; start < 5000; start += 500) {
      const r = await api.items({ IncludeItemTypes: 'Audio', Filters: 'IsPlayed', SortBy: 'DatePlayed', SortOrder: 'Descending', StartIndex: start, Limit: 500, Fields: 'PrimaryImageAspectRatio,ProductionYear,Genres' });
      const items = r.items.filter(t => t.type === 'track');
      for (const t of items) if (t.lastPlayed >= from && t.lastPlayed < to) out.push(t);
      const last = items[items.length - 1];
      if (items.length < 500 || (last && last.lastPlayed && last.lastPlayed < from)) break;
    }
    return out;
  },

  // ---- Recursos gráficos ----
  async assets(R) {
    const css = getComputedStyle(document.documentElement), accent = (css.getPropertyValue('--accent') || THEMES[Settings.theme]?.a || '#3cc0f5').trim();
    const th = THEMES[Settings.theme] || THEMES.navy;
    const a = /^#[0-9a-f]{6}$/i.test(accent) ? accent : th.a;
    const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); return .2126 * r + .7152 * g + .0722 * b; };
    // Los textos y los Nanuqs son blancos: el video va siempre sobre un fondo oscuro, aunque el tema sea claro.
    const pal = { bg: lum(th.bg) > .35 ? mixHex(a, '#0b1020', .82) : th.bg, side: th.side, a, t: th.t };
    const paths = ['body', 'belly', 'head', 'muzzle', 'nose', 'eyes'].map(id => { const e = document.getElementById('djb-' + id); return e ? e.outerHTML : ''; }).join('');
    const bearSVG = k => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -150 652 660" width="652" height="660"><g transform="scale(1.4222 1.4227)">${paths}</g>${BEAR_ACC[k] || ''}</svg>`;
    const AD = mixHex(pal.a, '#000000', .36), AL = mixHex(pal.a, '#ffffff', .28);
    const dj = djBearSVG().replace(/<svg class="[^"]*"/, '<svg xmlns="http://www.w3.org/2000/svg" width="408" height="432"')
      .replace(/<use href="#djb-([a-z]+)"\/>/g, (m, id) => { const e = document.getElementById('djb-' + id); return e ? e.outerHTML : ''; })
      .replace(/color-mix\(in srgb,var\(--accent\) 64%,#000\)/g, AD).replace(/color-mix\(in srgb,var\(--accent\) 72%,#fff\)/g, AL).replace(/var\(--accent\)/g, pal.a);
    const toImg = (svg, w) => new Promise(res => { const i = new Image(); i.onload = async () => { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * i.height / i.width); c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c); }; i.onerror = () => res(null); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const others = Object.keys(BEAR_ACC).filter(k => THEMES[k] && k !== Settings.theme);
    const visitors = others.sort(() => Math.random() - .5).slice(0, 6);
    const [me, djb, persona, ...vis] = await Promise.all([toImg(bearSVG(Settings.theme), 420), toImg(dj, 420), toImg(bearSVG(R.persona.theme), 420), ...visitors.map(k => toImg(bearSVG(k), 260))]);
    // Carátulas y foto del artista: pedidas con fetch (CORS) y convertidas a imagen local, con tope de tamaño.
    const covers = new Map(), want = [...R.top.map(s => [s.id, s]), ['artist', R.topArtists[0] && (R.topArtists[0].artistId ? { imgId: R.topArtists[0].artistId } : R.topArtists[0])]];
    await Promise.all(want.slice(0, 8).map(async ([k, it]) => { const b = await this.loadImg(it && api.img(it, 400)); if (b) covers.set(k, b); }));
    return { pal, me, dj: djb, persona, vis: vis.filter(Boolean), covers };
  },
  async loadImg(url) {
    if (!url) return null;
    try {
      if (/^(data|blob):/.test(url)) return await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
      const r = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
      if (!r.ok) return null;
      const b = await r.blob();
      if (b.size > 8e6 || !/^image\//.test(b.type || 'image/')) return null; // tope: 8 MB y solo imágenes
      if (/svg/.test(b.type)) return await new Promise(res => { const u = URL.createObjectURL(b), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); res(null); }; i.src = u; });
      return await createImageBitmap(b, { resizeWidth: 400, resizeHeight: 400, resizeQuality: 'high' });
    } catch { return null; }
  },

  // ---- Dibujo ----
  sceneAt(t) { let a = 0; for (let i = 0; i < this.scenes.length; i++) { const d = this.scenes[i][1]; if (t < a + d || i === this.scenes.length - 1) return { i, local: t - a, dur: d, start: a }; a += d; } },
  frame(ctx, t, R, A, buf) {
    const s = this.sceneAt(Math.min(t, this.total - 0.001)), TR = this.tr;
    if (s.i > 0 && s.local < TR) {
      const p = ease.inOut(s.local / TR), prev = this.scenes[s.i - 1];
      this.scene(buf[0].getContext('2d'), s.i - 1, prev[1] - 0.001 + s.local, prev[1], t, R, A);
      this.scene(buf[1].getContext('2d'), s.i, s.local, s.dur, t, R, A);
      this.transition(ctx, buf[0], buf[1], p, RECAP_TRANS[(s.i - 1) % RECAP_TRANS.length]);
    } else this.scene(ctx, s.i, s.local, s.dur, t, R, A);
  },
  transition(ctx, a, b, p, kind) {
    const W = RECAP_W, H = RC_H;
    ctx.save(); ctx.clearRect(0, 0, W, H);
    if (kind === 'slide') { ctx.drawImage(a, 0, -H * p * .35); ctx.globalAlpha = 1; ctx.drawImage(b, 0, H * (1 - p)); }
    else if (kind === 'circle') { ctx.drawImage(a, 0, 0); ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * p, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(b, 0, 0); }
    else if (kind === 'zoom') { ctx.globalAlpha = 1 - p; const k = 1 + p * .25; ctx.drawImage(a, W * (1 - k) / 2, H * (1 - k) / 2, W * k, H * k); ctx.globalAlpha = p; const k2 = .85 + p * .15; ctx.drawImage(b, W * (1 - k2) / 2, H * (1 - k2) / 2, W * k2, H * k2); }
    else { ctx.drawImage(a, 0, 0); ctx.beginPath(); const x = (W + H) * p; ctx.moveTo(0, 0); ctx.lineTo(x, 0); ctx.lineTo(x - H, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip(); ctx.drawImage(b, 0, 0); }
    ctx.restore();
  },
  // Fondo de cada escena: degradado del tema, brillo que respira con el ritmo y copos/notas que caen.
  bg(ctx, i, T, A, hue2) {
    const W = RECAP_W, H = RC_H, P = A.pal, beat = T * this.bpm / 60;
    const g = ctx.createLinearGradient(0, 0, W * .3, H);
    g.addColorStop(0, mixHex(P.bg, hue2 || P.a, .18)); g.addColorStop(1, P.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const pulse = .5 + .5 * Math.pow(1 - (beat % 1), 3);
    const rg = ctx.createRadialGradient(W * .5, H * .38, 10, W * .5, H * .38, W * (.75 + pulse * .06));
    rg.addColorStop(0, hexA(hue2 || P.a, .35)); rg.addColorStop(1, hexA(hue2 || P.a, 0));
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    const r = rng('fondo' + i);
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (let k = 0; k < 46; k++) {
      const x = (r() * W + Math.sin(T * .7 + k) * 18 + W) % W, y = ((r() * H + T * (30 + r() * 50)) % (H + 40)) - 20, sz = 1.5 + r() * 3.5;
      ctx.globalAlpha = .25 + r() * .5; ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  weather(ctx, kind, x, y, l) {
    ctx.save(); ctx.translate(x, y);
    const cloud = (cx, cy, k, col = '#e8eef7') => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx - 60 * k, cy, 50 * k, 0, 7); ctx.arc(cx, cy - 30 * k, 70 * k, 0, 7); ctx.arc(cx + 65 * k, cy, 55 * k, 0, 7); ctx.fill(); ctx.fillRect(cx - 110 * k, cy, 230 * k, 50 * k); };
    const sun = (cx, cy, r) => { ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 12; ctx.lineCap = 'round'; for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + l * .6; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r + 22), cy + Math.sin(a) * (r + 22)); ctx.lineTo(cx + Math.cos(a) * (r + 52), cy + Math.sin(a) * (r + 52)); ctx.stroke(); } };
    if (kind === 'sun') sun(0, 0, 90);
    else if (kind === 'storm' || kind === 'rain' || kind === 'cloud') {
      cloud(0, -10, 1.2, kind === 'storm' ? '#9aa6bd' : '#e8eef7');
      if (kind !== 'cloud') for (let k = 0; k < 8; k++) { const dx = -100 + k * 30, dy = 70 + ((l * 260 + k * 47) % 140); ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - 8, dy + 26); ctx.stroke(); }
      if (kind === 'storm' && (l * 2.5) % 1 < .35) { ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.moveTo(10, 40); ctx.lineTo(-30, 130); ctx.lineTo(5, 130); ctx.lineTo(-20, 210); ctx.lineTo(50, 105); ctx.lineTo(15, 105); ctx.lineTo(40, 40); ctx.fill(); }
      if (kind === 'cloud') { ctx.fillStyle = '#fff'; ctx.font = '700 60px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('♪ ♫', Math.sin(l * 2) * 30, 140); }
    } else if (kind === 'snow') { cloud(0, -20, 1.1); ctx.fillStyle = '#fff'; for (let k = 0; k < 14; k++) { const dx = -130 + (k * 37) % 260, dy = 60 + ((l * 90 + k * 31) % 170); ctx.beginPath(); ctx.arc(dx, dy, 7, 0, 7); ctx.fill(); } }
    else if (kind === 'rainbow') { ['#ff5f8f', '#ffa24d', '#ffd34d', '#5bd68a', '#3cc0f5', '#9b5cf6'].forEach((c, k) => { ctx.strokeStyle = c; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(0, 90, 200 - k * 18, Math.PI, Math.PI + Math.PI * clamp01(l / 1.2)); ctx.stroke(); }); cloud(-170, 80, .5); cloud(170, 80, .5); }
    else if (kind === 'neon') { ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(0, 0, 80, 0, 7); ctx.fill(); ctx.fillStyle = mixHex('#0b1020', '#ff3cac', .2); ctx.beginPath(); ctx.arc(35, -25, 70, 0, 7); ctx.fill(); ['#ff3cac', '#3ad1ff'].forEach((c, k) => { ctx.strokeStyle = c; ctx.lineWidth = 8; ctx.shadowColor = c; ctx.shadowBlur = 24; ctx.beginPath(); ctx.moveTo(-220, 150 + k * 30); for (let x2 = -220; x2 <= 220; x2 += 20) ctx.lineTo(x2, 150 + k * 30 + Math.sin(x2 / 30 + l * 4 + k) * 14); ctx.stroke(); }); ctx.shadowBlur = 0; }
    else if (kind === 'breeze') { sun(-90, -40, 55); ctx.strokeStyle = '#e8eef7'; ctx.lineWidth = 10; ctx.lineCap = 'round'; for (let k = 0; k < 3; k++) { ctx.beginPath(); const o = (l * 120 + k * 60) % 120; ctx.moveTo(-150 + o, 60 + k * 45); ctx.bezierCurveTo(-50 + o, 30 + k * 45, 40 + o, 100 + k * 45, 150 + o, 60 + k * 45); ctx.stroke(); } }
    else { ['#38f2b0', '#8b7bff', '#5be7ff'].forEach((c, k) => { ctx.strokeStyle = c; ctx.globalAlpha = .85; ctx.lineWidth = 26 - k * 6; ctx.beginPath(); for (let x2 = -260; x2 <= 260; x2 += 20) ctx.lineTo(x2, -40 + k * 40 + Math.sin(x2 / 60 + l * 1.5 + k) * 30); ctx.stroke(); }); ctx.globalAlpha = 1; }
    ctx.restore();
  },
  bear(ctx, img, x, y, h, T, o = {}) {
    if (!img) return;
    const beat = T * this.bpm / 60 + (o.phase || 0), b = Math.pow(Math.abs(Math.sin(beat * Math.PI)), 1.5);
    const w = h * img.width / img.height, hop = (o.hop ?? 1) * b * h * .06, sq = 1 + (o.hop ?? 1) * (1 - b) * .03;
    ctx.save(); ctx.translate(x, y - hop); ctx.rotate((o.rot || 0) + Math.sin(beat * Math.PI * .5) * (o.sway ?? .05)); if (o.flip) ctx.scale(-1, 1); ctx.scale(sq * (o.k || 1), (2 - sq) * (o.k || 1));
    ctx.globalAlpha = o.alpha ?? 1; ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = h * .05; ctx.shadowOffsetY = h * .012; ctx.drawImage(img, -w / 2, -h, w, h); ctx.restore();
  },
  text(ctx, str, x, y, size, o = {}) {
    str = String(str ?? '');
    const max = o.max || RECAP_W - 100, fam = o.font === 'b' ? 'Inter' : 'Outfit';
    let s = size; ctx.font = `${o.w || 600} ${s}px ${fam}, Inter, system-ui, sans-serif`;
    while (s > 16 && ctx.measureText(str).width > max) { s -= 2; ctx.font = `${o.w || 600} ${s}px ${fam}, Inter, system-ui, sans-serif`; }
    if (ctx.measureText(str).width > max) { while (str.length > 1 && ctx.measureText(str + '…').width > max) str = str.slice(0, -1); str += '…'; }
    ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = o.color || '#fff'; ctx.globalAlpha = o.alpha ?? 1;
    if (o.shadow !== false) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3; }
    ctx.fillText(str, x, y); ctx.shadowColor = 'transparent'; ctx.globalAlpha = 1;
  },
  cover(ctx, img, x, y, s, r, label) {
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, s, s, r); ctx.clip();
    if (img) { const k = Math.max(s / img.width, s / img.height), w = img.width * k, h = img.height * k; ctx.drawImage(img, x + (s - w) / 2, y + (s - h) / 2, w, h); }
    else { const g = ctx.createLinearGradient(x, y, x + s, y + s); g.addColorStop(0, '#5b6b86'); g.addColorStop(1, '#27324a'); ctx.fillStyle = g; ctx.fillRect(x, y, s, s); this.text(ctx, String(label || '♪').trim().charAt(0).toUpperCase() || '♪', x + s / 2, y + s * .66, s * .5, { shadow: false, max: s }); }
    ctx.restore();
  },
  confetti(ctx, T0, T, n = 90, seed = 'c') {
    const r = rng('conf' + seed), dt = T - T0; if (dt < 0 || dt > 4) return;
    const cols = ['#ff5f8f', '#ffd34d', '#3cc0f5', '#5bd68a', '#9b5cf6', '#ffffff'];
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (r() - .5) * 2.2, v = 500 + r() * 700, x = RECAP_W / 2 + Math.cos(a) * v * dt, y = RC_H * .45 + Math.sin(a) * v * dt + 900 * dt * dt;
      ctx.save(); ctx.translate(x, y); ctx.rotate(dt * (r() * 10 - 5)); ctx.globalAlpha = Math.max(0, 1 - dt / 4); ctx.fillStyle = cols[k % cols.length]; ctx.fillRect(-6, -3, 12, 6); ctx.restore();
    }
  },
  scene(ctx, i, l, dur, T, R, A) {
    const W = RECAP_W, H = RC_H, P = A.pal, name = this.scenes[i][0], inn = x => ease.out(clamp01(x)), fmtN = n => Math.round(n).toLocaleString(LOC);
    ctx.save(); ctx.clearRect(0, 0, W, H);
    if (name === 'intro') {
      this.bg(ctx, i, T, A);
      this.text(ctx, tx('Tu'), W / 2, 250, 64, { alpha: inn(l / .6) });
      this.text(ctx, String(R.year), W / 2, 250 + 170 * inn(l / .8), 180, { w: 700, alpha: inn(l / .8) });
      this.text(ctx, tx('con Nanuq'), W / 2, 520, 70, { alpha: inn((l - .4) / .6) });
      this.bear(ctx, A.me, W / 2, H - 140 + (1 - ease.back(clamp01((l - .3) / .9))) * 600, 520, T);
      A.vis.slice(0, 3).forEach((v, k) => { const p = (l * .22 + k * .33) % 1.2 - .1; this.bear(ctx, v, -80 + p * (W + 160), H - 60, 170, T, { phase: k * .3, flip: true, sway: .12 }); });
    } else if (name === 'minutes') {
      this.bg(ctx, i, T, A, '#ffd34d');
      this.text(ctx, tx('Este año escuchaste'), W / 2, 230, 48, { alpha: inn(l / .5) });
      const m = R.minutes * ease.out(clamp01((l - .3) / 2.2));
      this.text(ctx, fmtN(m), W / 2, 440, 168, { w: 700, color: '#ffd34d' });
      this.text(ctx, tx('minutos de música'), W / 2, 520, 50);
      const days = R.minutes / 1440, km = R.minutes / 60 * 5.5;
      this.text(ctx, days >= 1 ? tx('Eso es como {0} días seguidos', [days.toFixed(1)]) : tx('Eso es como {0} horas seguidas', [(R.minutes / 60).toFixed(1)]), W / 2, 640, 38, { w: 500, alpha: inn((l - 2.4) / .6) });
      this.text(ctx, tx('Un oso polar habría caminado {0} km', [fmtN(km)]), W / 2, 700, 34, { w: 500, alpha: inn((l - 3) / .6) });
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, H - 150, W, 6);
      this.bear(ctx, A.me, -120 + ((l / dur) * (W + 240)), H - 150, 260, T, { flip: true, sway: .15, hop: 1.4 });
    } else if (name === 'drum') {
      this.bg(ctx, i, T, A, '#ff5f8f');
      const shake = Math.sin(l * 70) * 6 * clamp01(l / 2);
      this.text(ctx, tx('¿Quién fue tu'), W / 2 + shake, 400, 60);
      this.text(ctx, 'artista #1?', W / 2 - shake, 490, 84, { w: 700 });
      this.bear(ctx, A.dj, W / 2, H - 120, 560, T * 3, { sway: .03, hop: 2.2 });
    } else if (name === 'artist') {
      const a = R.topArtists[0] || { name: '—', n: 0, sec: 0 };
      this.bg(ctx, i, T, A, '#ff5f8f');
      const k = ease.back(clamp01(l / .8)), s = 380 * k, img = A.covers.get('artist');
      ctx.save(); ctx.beginPath(); ctx.arc(W / 2, 470, s / 2 + 10, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.restore();
      if (s > 2) { ctx.save(); ctx.beginPath(); ctx.arc(W / 2, 470, s / 2, 0, Math.PI * 2); ctx.clip(); this.cover(ctx, img, W / 2 - s / 2, 470 - s / 2, s, 0, a.name); ctx.restore(); }
      this.text(ctx, tx('Tu artista del año'), W / 2, 200, 44, { alpha: inn(l / .5) });
      this.text(ctx, a.name, W / 2, 780, 76, { w: 700, alpha: inn((l - .5) / .5) });
      this.text(ctx, `${fmtN(a.n)} reproducciones · ${fmtN(a.sec / 60)} min`, W / 2, 850, 34, { w: 500, alpha: inn((l - .9) / .5) });
      this.bear(ctx, A.me, 150, H - 70, 300, T, { sway: .1 }); this.bear(ctx, A.vis[0], W - 150, H - 70, 260, T, { flip: true, phase: .5, sway: .1 });
      this.confetti(ctx, .5, l, 110, 'a');
    } else if (name === 'artists') {
      this.bg(ctx, i, T, A, '#9b5cf6');
      this.text(ctx, tx('Tus artistas favoritos'), W / 2, 190, 50);
      R.topArtists.forEach((a, k) => {
        const p = ease.back(clamp01((l - .2 - k * .35) / .6)), y = 330 + k * 165, x = W / 2 + (1 - p) * (k % 2 ? 700 : -700);
        ctx.save(); ctx.globalAlpha = clamp01(p); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(x - 300, y - 62, 600, 124, 26); ctx.fill(); ctx.restore();
        this.text(ctx, '#' + (k + 1), x - 240, y + 18, 56, { w: 700, color: k ? '#fff' : '#ffd34d', align: 'center', alpha: clamp01(p) });
        this.text(ctx, a.name, x - 180, y + 2, 40, { align: 'left', max: 440, alpha: clamp01(p) });
        this.text(ctx, fmtN(a.n) + ' reproducciones', x - 180, y + 42, 26, { align: 'left', w: 400, font: 'b', color: 'rgba(255,255,255,.75)', alpha: clamp01(p), max: 440 });
      });
      this.bear(ctx, A.me, W - 120, H - 30, 230, T, { sway: .12 });
    } else if (name === 'songs') {
      this.bg(ctx, i, T, A, '#3cc0f5');
      this.text(ctx, tx('Tus canciones del año'), W / 2, 160, 50);
      const t1 = R.top[0];
      if (t1) {
        const p = ease.back(clamp01(l / .8)), s = 300 * p;
        // DJ Nanuq gira el disco de tu canción #1
        ctx.save(); ctx.translate(W / 2 + 120, 400); ctx.rotate(l * 2.4); ctx.fillStyle = '#111521'; ctx.beginPath(); ctx.arc(0, 0, 150 * p, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2; for (let r2 = 60; r2 < 150; r2 += 12) { ctx.beginPath(); ctx.arc(0, 0, r2 * p, 0, Math.PI * 2); ctx.stroke(); } ctx.restore();
        this.cover(ctx, A.covers.get(t1.id), W / 2 - 120 - s / 2 + 40, 400 - s / 2, s, 18, t1.name);
        this.text(ctx, '#1  ' + t1.name, W / 2, 640, 50, { w: 700, color: '#ffd34d', alpha: inn((l - .6) / .5) });
        this.text(ctx, `${t1.artist} · ${fmtN(t1.n)} veces`, W / 2, 690, 30, { w: 500, alpha: inn((l - .8) / .5) });
      }
      R.top.slice(1, 5).forEach((s2, k) => {
        const p = ease.out(clamp01((l - 1.6 - k * .45) / .5)), y = 760 + k * 120;
        ctx.save(); ctx.globalAlpha = p; ctx.translate(0, (1 - p) * 60);
        this.cover(ctx, A.covers.get(s2.id), 90, y, 96, 14, s2.name);
        this.text(ctx, '#' + (k + 2) + '  ' + s2.name, 210, y + 44, 34, { align: 'left', max: 440, alpha: p });
        this.text(ctx, s2.artist, 210, y + 82, 24, { align: 'left', w: 400, font: 'b', color: 'rgba(255,255,255,.75)', max: 440, alpha: p });
        ctx.restore();
      });
      this.bear(ctx, A.dj, W - 105, H - 10, 250, T, { sway: .04 });
    } else if (name === 'persona') {
      this.bg(ctx, i, T, A, '#5bd68a');
      this.text(ctx, tx('Tu personalidad musical'), W / 2, 190, 46, { alpha: inn(l / .5) });
      // Nanuq gira y, a media vuelta, cambia de disfraz
      const spin = clamp01((l - .6) / 1.2), sx = Math.cos(spin * Math.PI * 2), img = spin < .25 || spin > .75 ? (spin > .75 ? A.persona : A.me) : (spin < .5 ? A.me : A.persona);
      this.bear(ctx, img, W / 2, 820, 520, T, { k: 1, hop: spin >= 1 ? 1 : 0, sway: 0, flip: sx < 0 });
      this.text(ctx, R.persona.name, W / 2, 940, 78, { w: 700, color: '#ffd34d', alpha: inn((l - 1.9) / .5) });
      this.text(ctx, R.genre ? tx('Porque escuchaste mucho ') + R.genre : '', W / 2, 1000, 32, { w: 500, alpha: inn((l - 2.3) / .5) });
      this.text(ctx, R.persona.line, W / 2, 1060, 30, { w: 400, font: 'b', alpha: inn((l - 2.7) / .5) });
      if (spin >= 1) this.confetti(ctx, 1.8, l, 60, 'p');
    } else if (name === 'habits') {
      this.bg(ctx, i, T, A, '#9b5cf6');
      this.text(ctx, R.clock[0], W / 2, 190, 64, { w: 700, color: '#ffd34d', alpha: inn(l / .5) });
      this.text(ctx, R.clock[1], W / 2, 245, 30, { w: 500, alpha: inn((l - .3) / .5) });
      // Reloj de 24 horas: cuánto escuchas a cada hora
      const mx = Math.max(1, ...R.hours), cx = W / 2, cy = 520, grow = ease.out(clamp01((l - .4) / 1.2));
      for (let h = 0; h < 24; h++) {
        const a = h / 24 * Math.PI * 2 - Math.PI / 2, len = 30 + 150 * R.hours[h] / mx * grow;
        ctx.strokeStyle = h === R.peak ? '#ffd34d' : 'rgba(255,255,255,.55)'; ctx.lineWidth = 16; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70); ctx.lineTo(cx + Math.cos(a) * (70 + len), cy + Math.sin(a) * (70 + len)); ctx.stroke();
      }
      this.text(ctx, String(R.peak).padStart(2, '0') + ':00', cx, cy + 16, 44, { w: 700, shadow: false });
      const lines = [R.streak > 1 ? tx('Racha: {0} días seguidos con música', [R.streak]) : null, R.repeat ? tx('«{0}» sonó {1} veces: Nanuq ya se la sabe de memoria', [R.repeat.name, R.repeat.n]) : null,
        tx('{0} canciones distintas de {1} artistas', [fmtN(R.songsN), fmtN(R.artistsN)]), R.first ? tx('Empezaste el año con «{0}»', [R.first]) : null].filter(Boolean).slice(0, 3);
      lines.forEach((s2, k) => this.text(ctx, s2, W / 2, 860 + k * 70, 30, { w: 500, alpha: inn((l - 1.4 - k * .5) / .5), max: W - 80 }));
      this.bear(ctx, A.me, 130, H - 20, 220, T, { sway: .12 }); this.bear(ctx, A.vis[1] || A.me, W - 130, H - 20, 200, T, { flip: true, phase: .4 });
    } else if (name === 'wk-intro') {
      this.bg(ctx, i, T, A);
      this.text(ctx, tx('Tu semana'), W / 2, 330, 104, { w: 700, alpha: inn(l / .6) });
      this.text(ctx, tx('con Nanuq'), W / 2, 425, 66, { alpha: inn((l - .3) / .6) });
      this.text(ctx, R.label, W / 2, 510, 38, { w: 500, color: '#ffd34d', alpha: inn((l - .6) / .6) });
      this.bear(ctx, A.me, W / 2, H - 120 + (1 - ease.back(clamp01((l - .4) / .9))) * 600, 520, T);
      A.vis.slice(0, 2).forEach((v, k) => this.bear(ctx, v, -80 + ((l * .22 + k * .5) % 1.1) * (W + 160), H - 50, 170, T, { flip: true, phase: k * .4, sway: .14 }));
    } else if (name === 'wk-minutes') {
      this.bg(ctx, i, T, A, '#ffd34d');
      this.text(ctx, tx('La semana pasada escuchaste'), W / 2, 270, 46, { alpha: inn(l / .5) });
      this.text(ctx, fmtN(R.minutes * ease.out(clamp01((l - .3) / 1.8))), W / 2, 470, 180, { w: 700, color: '#ffd34d' });
      this.text(ctx, tx('minutos de música'), W / 2, 550, 50);
      this.text(ctx, tx('Unos {0} minutos al día · {1} canciones', [fmtN(R.minutes / 7), fmtN(R.plays)]), W / 2, 650, 32, { w: 500, alpha: inn((l - 2) / .5) });
      this.text(ctx, tx('Un oso polar habría caminado {0} km', [fmtN(R.minutes / 60 * 5.5)]), W / 2, 705, 32, { w: 500, alpha: inn((l - 2.6) / .5) });
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, H - 150, W, 6);
      this.bear(ctx, A.me, -110 + (l / dur) * (W + 220), H - 150, 250, T, { flip: true, sway: .18, hop: 1.5 });
    } else if (name === 'wk-days') {
      this.bg(ctx, i, T, A, '#9b5cf6');
      const DIAS = [tx('lunes'), tx('martes'), tx('miércoles'), tx('jueves'), tx('viernes'), tx('sábado'), tx('domingo')], QUIPS = [tx('¡Contra el lunes, música!'), tx('Martes con ritmo.'), tx('A mitad de semana, a todo volumen.'), tx('Jueves de calentamiento.'), tx('¡Viernes de fiesta!'), tx('Sábado sin alarma y con música.'), tx('Domingo de relax.')];
      this.text(ctx, tx('Música {0} de 7 días', [R.activeDays]), W / 2, 200, 56, { w: 700, alpha: inn(l / .5) });
      this.text(ctx, tx('Tu día más musical: el ') + DIAS[R.bestDay], W / 2, 262, 38, { w: 500, alpha: inn((l - .5) / .5) });
      this.text(ctx, QUIPS[R.bestDay], W / 2, 315, 32, { w: 500, color: '#ffd34d', alpha: inn((l - 1) / .5) });
      const mx = Math.max(1, ...R.days), bw = 70, gap = 16, x0 = (W - (bw * 7 + gap * 6)) / 2, base = 1010, grow = ease.out(clamp01((l - .3) / 1.2));
      R.days.forEach((n, k) => {
        const h = 30 + 420 * n / mx * grow;
        ctx.fillStyle = k === R.bestDay ? '#ffd34d' : 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.roundRect(x0 + k * (bw + gap), base - h, bw, h, 14); ctx.fill();
        this.text(ctx, DIAS[k].slice(0, 2).toUpperCase(), x0 + k * (bw + gap) + bw / 2, base + 46, 26, { w: 600, shadow: false });
      });
      const bx = x0 + R.bestDay * (bw + gap) + bw / 2, bh = 30 + 420 * R.days[R.bestDay] / mx * grow;
      this.bear(ctx, A.me, bx, base - bh + 6, 170, T * 1.4, { hop: 2.2, sway: .12 });
    } else if (name === 'wk-drum') {
      this.bg(ctx, i, T, A, '#ff5f8f');
      const shake = Math.sin(l * 70) * 6 * clamp01(l / 2);
      this.text(ctx, tx('¿Cuál fue tu canción'), W / 2 + shake, 400, 60);
      this.text(ctx, tx('de la semana?'), W / 2 - shake, 490, 76, { w: 700 });
      this.bear(ctx, A.dj, W / 2, H - 120, 560, T * 3, { sway: .03, hop: 2.2 });
    } else if (name === 'wk-song') {
      this.bg(ctx, i, T, A, '#3cc0f5');
      const t1 = R.top[0], p = ease.back(clamp01(l / .7)), s2 = 360 * p;
      this.text(ctx, tx('Tu canción de la semana'), W / 2, 190, 46, { alpha: inn(l / .4) });
      ctx.save(); ctx.translate(W / 2 + 130, 470); ctx.rotate(l * 3); ctx.fillStyle = '#111521'; ctx.beginPath(); ctx.arc(0, 0, 175 * p, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2; for (let r2 = 70; r2 < 175; r2 += 14) { ctx.beginPath(); ctx.arc(0, 0, r2 * p, 0, Math.PI * 2); ctx.stroke(); } ctx.restore();
      if (t1) {
        this.cover(ctx, A.covers.get(t1.id), W / 2 - 100 - s2 / 2, 470 - s2 / 2, s2, 18, t1.name);
        this.text(ctx, t1.name, W / 2, 750, 60, { w: 700, color: '#ffd34d', alpha: inn((l - .6) / .5) });
        this.text(ctx, tx('{0} · la pusiste {1} {2}', [t1.artist, t1.n, t1.n === 1 ? tx('vez') : tx('veces')]), W / 2, 805, 30, { w: 500, alpha: inn((l - .9) / .5) });
        this.text(ctx, t1.n >= 5 ? tx('Nanuq ya se la sabe de memoria.') : tx('Nanuq ya la está tarareando.'), W / 2, 860, 30, { w: 500, font: 'b', alpha: inn((l - 1.5) / .5) });
      }
      this.bear(ctx, A.me, 130, H - 40, 260, T, { sway: .12 }); this.bear(ctx, A.vis[0] || A.me, W - 130, H - 40, 230, T, { flip: true, phase: .5 });
      this.confetti(ctx, .5, l, 100, 'ws');
    } else if (name === 'wk-top') {
      this.bg(ctx, i, T, A, '#3cc0f5');
      this.text(ctx, tx('Lo más sonado de la semana'), W / 2, 170, 46);
      R.top.slice(0, 5).forEach((s2, k) => {
        const p = ease.back(clamp01((l - .2 - k * .45) / .6)), y = 250 + k * 170, x = (1 - p) * (k % 2 ? 700 : -700);
        ctx.save(); ctx.globalAlpha = clamp01(p); ctx.translate(x, 0);
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(60, y, 600, 140, 26); ctx.fill();
        this.cover(ctx, A.covers.get(s2.id), 80, y + 15, 110, 14, s2.name);
        this.text(ctx, '#' + (k + 1), 240, y + 60, 40, { w: 700, color: k ? '#fff' : '#ffd34d', align: 'left', alpha: clamp01(p) });
        this.text(ctx, s2.name, 310, y + 60, 34, { align: 'left', max: 330, alpha: clamp01(p) });
        this.text(ctx, `${s2.artist} · ${s2.n} ${s2.n === 1 ? tx('vez') : tx('veces')}`, 310, y + 102, 24, { align: 'left', w: 400, font: 'b', color: 'rgba(255,255,255,.75)', max: 330, alpha: clamp01(p) });
        ctx.restore();
      });
    } else if (name === 'wk-artists') {
      this.bg(ctx, i, T, A, '#ff5f8f');
      this.text(ctx, tx('El podio de la semana'), W / 2, 190, 54, { w: 700, alpha: inn(l / .5) });
      const spots = [[0, W / 2, 330, '#ffd34d'], [1, W / 2 - 220, 230, '#d5deea'], [2, W / 2 + 220, 170, '#e0a24a']]; // [lugar, x, alto, color]: el 1.º al centro y más alto
      const crew = [A.me, A.vis[0] || A.me, A.vis[1] || A.me], base = H - 170;
      spots.forEach(([k, x, h], n) => {
        const a2 = R.topArtists[k], g = ease.out(clamp01((l - .3 - n * .5) / .7)), hh = h * g;
        if (!a2) return;
        ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.roundRect(x - 100, base - hh, 200, hh, 16); ctx.fill();
        ctx.fillStyle = spots[n][3]; ctx.fillRect(x - 100, base - hh, 200, 10);
        this.text(ctx, String(k + 1), x, base - hh / 2 + 30, 80, { w: 700, color: spots[n][3], alpha: g });
        this.bear(ctx, crew[k], x, base - hh + 4, k === 0 ? 230 : 190, T, { phase: n * .3, hop: k === 0 ? 1.8 : 1, alpha: g });
        this.text(ctx, a2.name, x, base - hh - (k === 0 ? 250 : 210), k === 0 ? 38 : 30, { w: 700, max: 220, alpha: inn((l - 1.6 - n * .3) / .5) });
        this.text(ctx, `${a2.n} ${a2.n === 1 ? tx('canción') : tx('canciones')}`, x, base - hh - (k === 0 ? 215 : 178), 22, { w: 500, font: 'b', max: 220, color: 'rgba(255,255,255,.8)', alpha: inn((l - 1.8 - n * .3) / .5) });
      });
      this.confetti(ctx, 2.6, l, 90, 'wa');
    } else if (name === 'wk-hours') {
      this.bg(ctx, i, T, A, '#9b5cf6');
      const clock = R.peak < 6 ? [tx('Oso trasnochador'), tx('Tus canciones salen cuando todos duermen.')] : R.peak < 12 ? [tx('Oso madrugador'), tx('Tu día arrancó con música.')] : R.peak < 19 ? [tx('Oso de tarde'), tx('Tus tardes tuvieron banda sonora.')] : [tx('Oso nocturno'), tx('De noche le subiste el volumen.')];
      this.text(ctx, clock[0], W / 2, 200, 62, { w: 700, color: '#ffd34d', alpha: inn(l / .5) });
      this.text(ctx, clock[1], W / 2, 255, 30, { w: 500, alpha: inn((l - .3) / .5) });
      const mx = Math.max(1, ...R.hours), cx = W / 2, cy = 600, grow = ease.out(clamp01((l - .4) / 1.4));
      for (let h = 0; h < 24; h++) {
        const ang = h / 24 * Math.PI * 2 - Math.PI / 2, len = 30 + 160 * R.hours[h] / mx * grow;
        ctx.strokeStyle = h === R.peak ? '#ffd34d' : 'rgba(255,255,255,.55)'; ctx.lineWidth = 16; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * 75, cy + Math.sin(ang) * 75); ctx.lineTo(cx + Math.cos(ang) * (75 + len), cy + Math.sin(ang) * (75 + len)); ctx.stroke();
      }
      this.text(ctx, String(R.peak).padStart(2, '0') + ':00', cx, cy + 16, 46, { w: 700, shadow: false });
      this.bear(ctx, A.me, W / 2, H - 30, 250, T, { sway: .1 });
    } else if (name === 'wk-new') {
      this.bg(ctx, i, T, A, '#5bd68a');
      if (R.fresh && R.fresh.n) {
        this.text(ctx, tx('Descubriste'), W / 2, 330, 54, { alpha: inn(l / .5) });
        this.text(ctx, fmtN(R.fresh.n * ease.out(clamp01((l - .3) / 1))), W / 2, 500, 170, { w: 700, color: '#ffd34d' });
        this.text(ctx, R.fresh.n === 1 ? tx('canción nueva') : tx('canciones nuevas'), W / 2, 575, 46);
        if (R.fresh.first) this.text(ctx, tx('Como «') + R.fresh.first.name + '»', W / 2, 660, 32, { w: 500, alpha: inn((l - 1.6) / .5), max: W - 100 });
      } else {
        this.text(ctx, tx('Tu semana en números'), W / 2, 330, 50, { alpha: inn(l / .5) });
        this.text(ctx, fmtN(R.songsN), W / 2, 490, 150, { w: 700, color: '#ffd34d' });
        this.text(ctx, tx('canciones distintas'), W / 2, 560, 44);
        this.text(ctx, `de ${fmtN(R.artistsN)} ${R.artistsN === 1 ? tx('artista') : tx('artistas')}`, W / 2, 625, 36, { w: 500, alpha: inn((l - 1) / .5) });
      }
      // Nanuq con lupa
      this.bear(ctx, A.me, W / 2 - 40, H - 40, 300, T, { sway: .08 });
      const lx = W / 2 + 120 + Math.sin(l * 2) * 20, ly = H - 300 + Math.cos(l * 2) * 12;
      ctx.lineWidth = 12; ctx.strokeStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(lx, ly, 46, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
      ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(lx + 32, ly + 32); ctx.lineTo(lx + 80, ly + 80); ctx.stroke();
    } else if (name === 'wk-weather') {
      this.bg(ctx, i, T, A, '#3cc0f5');
      const [wname, wline, kind] = R.weather;
      this.text(ctx, tx('Pronóstico musical de tu semana'), W / 2, 180, 42, { alpha: inn(l / .5) });
      this.weather(ctx, kind, W / 2, 400, l);
      this.text(ctx, wname, W / 2, 640, 66, { w: 700, color: '#ffd34d', alpha: inn((l - .8) / .5) });
      this.text(ctx, wline, W / 2, 700, 34, { w: 500, alpha: inn((l - 1.1) / .5) });
      if (R.genre) this.text(ctx, tx('Con 90% de probabilidad de {0}', [R.genre]), W / 2, 760, 30, { w: 500, font: 'b', alpha: inn((l - 1.6) / .5), max: W - 80 });
      this.bear(ctx, A.persona, W / 2, H - 30, 330, T, { sway: .1 });
    } else if (name === 'wk-outro') {
      this.bg(ctx, i, T, A);
      this.text(ctx, tx('¡Buena semana!'), W / 2, 420, 92, { w: 700, color: '#ffd34d', alpha: inn(l / .5) });
      this.text(ctx, tx('Nanuq te espera el próximo lunes'), W / 2, 495, 36, { w: 500, alpha: inn((l - .3) / .5) });
      const crew = [A.me, ...A.vis].filter(Boolean).slice(0, 4);
      crew.forEach((b2, k) => this.bear(ctx, b2, W / 2 + (k - (crew.length - 1) / 2) * 160, H - 60, k === 0 ? 260 : 200, T, { phase: k * .25, flip: k % 2 === 1, sway: .2 }));
      this.confetti(ctx, 0, l, 110, 'w');
      const src = { servidor: tx('Con el historial de reproducción de tu servidor.'), jellyfin: tx('Con los datos básicos de tu Jellyfin (aproximados).'), demo: tx('Modo demo: datos de ejemplo.') }[R.source] || '';
      this.text(ctx, src, W / 2, 570, 22, { w: 400, font: 'b', color: 'rgba(255,255,255,.6)', shadow: false });
    } else {
      this.bg(ctx, i, T, A);
      const card = ease.back(clamp01(l / .8));
      ctx.save(); ctx.translate(W / 2, 520); ctx.scale(card, card); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(-300, -330, 600, 660, 36); ctx.fill(); ctx.restore();
      if (card > .5) {
        this.text(ctx, tx('Tu {0} con Nanuq', [R.year]), W / 2, 260, 48, { w: 700 });
        const rows = [[tx('Minutos'), fmtN(R.minutes)], ['Artista #1', (R.topArtists[0] || {}).name || '—'], [tx('Canción #1'), (R.top[0] || {}).name || '—'], [tx('Personalidad'), R.persona.name], [tx('Hora favorita'), String(R.peak).padStart(2, '0') + ':00']];
        rows.forEach(([k2, v], n) => { this.text(ctx, k2, 150, 360 + n * 100, 26, { align: 'left', w: 500, font: 'b', color: 'rgba(255,255,255,.7)' }); this.text(ctx, v, 150, 400 + n * 100, 38, { align: 'left', w: 700, max: 430 }); });
      }
      this.text(ctx, tx('¡Nos vemos en {0}!', [R.year + 1]), W / 2, 990, 56, { w: 700, color: '#ffd34d', alpha: inn((l - 1.2) / .5) });
      const crew = [A.me, ...A.vis].filter(Boolean).slice(0, 5);
      crew.forEach((b, k) => this.bear(ctx, b, W / 2 + (k - (crew.length - 1) / 2) * 140, H - 30, k === 0 ? 240 : 190, T, { phase: k * .25, flip: k % 2 === 1, sway: .14 }));
      this.confetti(ctx, .3, l, 120, 'o');
      const src = { servidor: tx('Con el historial de reproducción de tu servidor.'), jellyfin: tx('Con los datos básicos de tu Jellyfin (aproximados).'), demo: tx('Modo demo: datos de ejemplo.') }[R.source] || '';
      this.text(ctx, src, W / 2, 900, 22, { w: 400, font: 'b', color: 'rgba(255,255,255,.6)', shadow: false });
      ctx.globalAlpha = clamp01((dur - l) / .6); // fundido al final
    }
    ctx.restore();
    if (i === this.scenes.length - 1 && dur - l < .6) { ctx.fillStyle = `rgba(0,0,0,${1 - clamp01((dur - l) / .6)})`; ctx.fillRect(0, 0, W, H); }
  },

  // ---- Música (generada aquí mismo): batería, bajo, acordes y arpegio; redoble antes del artista #1 ----
  music(ac, out, seed) {
    const r = rng('musica' + seed), spb = 60 / this.bpm, t0 = ac.currentTime + .08, dur = this.total;
    const root = 45 + [0, 2, 3, 5, 7][Math.floor(r() * 5)], f = m => 440 * Math.pow(2, (m - 69) / 12);
    const prog = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];
    const master = ac.createGain(); master.gain.setValueAtTime(0, t0); master.gain.linearRampToValueAtTime(.55, t0 + 1); master.gain.setValueAtTime(.55, t0 + dur - 2.2); master.gain.linearRampToValueAtTime(0, t0 + dur); master.connect(out);
    const comp = ac.createDynamicsCompressor(); comp.connect(master);
    const nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), nd = nb.getChannelData(0); for (let k = 0; k < nd.length; k++) nd[k] = Math.random() * 2 - 1;
    const tone = (type, fr, t, len, vol, to = null) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(fr, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + len); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + len); o.connect(g); g.connect(comp); o.start(t); o.stop(t + len + .05); };
    const noise = (t, len, vol, hp) => { const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nb; fl.type = 'highpass'; fl.frequency.value = hp; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0005, t + len); s.connect(fl); fl.connect(g); g.connect(comp); s.start(t, Math.random() * .5, len + .05); };
    let acc = 0, rollA = -1, rollB = -1; for (const [n, d] of this.scenes) { if (/drum$/.test(n)) { rollA = acc; rollB = acc + d; } acc += d; }
    for (let b = 0; b * spb < dur - .5; b++) {
      const t = t0 + b * spb, bar = Math.floor(b / 4), bt = b % 4, ch = prog[bar % 4], rel = b * spb;
      const inRoll = rel >= rollA && rel < rollB;
      if (!inRoll) {
        if (bt === 0 || bt === 2) tone('sine', 150, t, .32, .9, 45);
        if (bt === 1 || bt === 3) noise(t, .16, .45, 1800);
        noise(t, .04, .18, 7000); noise(t + spb / 2, .04, .12, 7000);
        tone('triangle', f(root + ch[0] - 12), t, spb * .9, .35);
        for (let k = 0; k < 2; k++) tone('square', f(root + 24 + ch[(b * 2 + k) % 3]), t + k * spb / 2, spb * .45, .045);
        if (bt === 0) ch.forEach(n => tone('sawtooth', f(root + 12 + n), t, spb * 4, .03));
      }
    }
    // Redoble y platillo
    if (rollA >= 0) { for (let x = rollA; x < rollB; x += .045) noise(t0 + x, .06, .1 + .35 * (x - rollA) / (rollB - rollA), 1500); noise(t0 + rollB, 1.6, .5, 3000); tone('sine', 110, t0 + rollB, .5, .9, 40); }
    return master;
  },

  // ---- Reproducir / grabar ----
  // Detener desde fuera (salir de la pantalla, otra reproducción): una grabación a medias se descarta, no se guarda.
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; recapCloseAudio(this.ac); this.ac = null; if (this.rec && this.rec.state !== 'inactive') try { this.rec.cancelled = true; this.rec.stop(); } catch { } },
  play(canvas, R, A, { record = false, sound = true, onEnd, onTick } = {}) {
    this.stop();
    const ctx = canvas.getContext('2d'), buf = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = RECAP_W; c.height = RC_H; return c; });
    const ac = this.ac = new (window.AudioContext || window.webkitAudioContext)(), out = ac.createGain();
    if (sound) out.connect(ac.destination);
    let dest = null, chunks = [], size = 0, mime = '';
    if (record) { dest = ac.createMediaStreamDestination(); out.connect(dest); }
    this.music(ac, out, R.year);
    if (record) {
      mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      if (!mime) { toast(tx('Este dispositivo no puede grabar video.'), 5000); this.stop(); return; }
      const stream = new MediaStream([...canvas.captureStream(RECAP_FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const rec = this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4e6, audioBitsPerSecond: 128e3 });
      rec.ondataavailable = e => { if (!e.data || !e.data.size) return; size += e.data.size; if (size > 200e6) { try { rec.stop(); } catch { } return; } chunks.push(e.data); };
      rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); if (onEnd && !rec.cancelled) onEnd(new Blob(chunks, { type: mime.split(';')[0] }), mime); };
      rec.start(1000);
    }
    const start = performance.now();
    const loop = () => {
      const t = (performance.now() - start) / 1000;
      if (t >= this.total || t > 59) { this.frame(ctx, this.total - .001, R, A, buf); cancelAnimationFrame(this.raf); this.raf = 0; if (record) setTimeout(() => { try { this.rec.stop(); } catch { } recapCloseAudio(ac); }, 250); else { recapCloseAudio(ac); if (onEnd) onEnd(); } return; }
      this.frame(ctx, t, R, A, buf); if (onTick) onTick(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  // ---- Guardar el video ----
  async save(blob, mime, year, tag = '') {
    const ext = /mp4/.test(mime) ? 'mp4' : 'webm', name = `Nanuq-${tag ? tag.replace(/[^a-z0-9-]/gi, '') : num(year)}.${ext}`;
    if (ext === 'mp4') blob = new Blob([mp4Finalize(await blob.arrayBuffer())], { type: 'video/mp4' });
    const A = window.NanuqAndroid;
    if (A && A.videoBegin) {
      const id = A.videoBegin(mime.split(';')[0]); if (!id) { toast(tx('No se pudo guardar el video.')); return; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      for (let o = 0; o < bytes.length; o += 786432) {
        const part = bytes.subarray(o, o + 786432); let bin = ''; for (let k = 0; k < part.length; k += 32768) bin += String.fromCharCode.apply(null, part.subarray(k, k + 32768));
        if (!A.videoChunk(id, btoa(bin))) { toast(tx('No se pudo guardar el video.')); return; }
      }
      const r = String(A.videoEnd(id, year, tag ? tag.replace(/[^a-z0-9-]/gi, '') : '') || '');
      if (r.startsWith('ok:')) { const uri = r.slice(3); menu(null, [[tx('Compartir el video'), 'next-up', () => A.videoShare(uri)], [tx('Listo'), 'check', () => { }]], `<div class="mh"><div class="t">${tx('Video guardado en Películas › Nanuq')}</div></div>`); }
      else if (r.startsWith('file:')) toast(tx('Video guardado en ') + r.slice(5), 6000);
      else toast(tx('No se pudo guardar el video.'));
      return;
    }
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
    toast(tx('Video listo: ') + name, 4000);
  }
};
// MediaRecorder graba MP4 «fragmentado» sin la duración total en el encabezado: algunas galerías muestran mal la
// duración o no dejan adelantar. Se calcula con los fragmentos y se escribe en mvhd/tkhd/mdhd y en una caja mehd nueva.
// (Los fragmentos usan posiciones relativas a sí mismos, así que agregar 20 bytes al encabezado no mueve nada más.)
function mp4Finalize(buf) {
  try {
    const b = new Uint8Array(buf), dv = new DataView(buf);
    const kids = (s, e) => { const out = []; let i = s; while (i + 8 <= e) { const size = dv.getUint32(i); if (size < 8 || i + size > e) break; out.push({ t: String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]), i, s: i + 8, e: i + size }); i += size; } return out; };
    const top = kids(0, b.length), moov = top.find(x => x.t === 'moov'); if (!moov) return buf;
    const mk = kids(moov.s, moov.e), mvhd = mk.find(x => x.t === 'mvhd'), mvex = mk.find(x => x.t === 'mvex');
    if (!mvhd || !mvex || kids(mvex.s, mvex.e).some(x => x.t === 'mehd')) return buf;
    const v1 = b[mvhd.s] === 1, mts = dv.getUint32(mvhd.s + (v1 ? 20 : 12)), tracks = {};
    for (const tr of mk.filter(x => x.t === 'trak')) {
      const tk = kids(tr.s, tr.e), tkhd = tk.find(x => x.t === 'tkhd'), mdia = tk.find(x => x.t === 'mdia'); if (!tkhd || !mdia) continue;
      const mdhd = kids(mdia.s, mdia.e).find(x => x.t === 'mdhd'); if (!mdhd) continue;
      tracks[dv.getUint32(tkhd.s + (b[tkhd.s] === 1 ? 20 : 12))] = { tkhd, mdhd, ts: dv.getUint32(mdhd.s + (b[mdhd.s] === 1 ? 20 : 12)), end: 0 };
    }
    for (const mf of top.filter(x => x.t === 'moof')) for (const tf of kids(mf.s, mf.e).filter(x => x.t === 'traf')) {
      let id = 0, base = 0, def = 0, dur = 0;
      for (const x of kids(tf.s, tf.e)) {
        const fl = dv.getUint32(x.s) & 0xffffff;
        if (x.t === 'tfhd') { if (fl & 1) return buf; id = dv.getUint32(x.s + 4); let o = x.s + 8; if (fl & 2) o += 4; if (fl & 8) def = dv.getUint32(o); }
        else if (x.t === 'tfdt') base = b[x.s] === 1 ? Number(dv.getBigUint64(x.s + 4)) : dv.getUint32(x.s + 4);
        else if (x.t === 'trun') {
          const n = dv.getUint32(x.s + 4), per = (fl & 0x100 ? 4 : 0) + (fl & 0x200 ? 4 : 0) + (fl & 0x400 ? 4 : 0) + (fl & 0x800 ? 4 : 0);
          let o = x.s + 8 + (fl & 1 ? 4 : 0) + (fl & 4 ? 4 : 0);
          if (n > 1e6) return buf;
          for (let k = 0; k < n; k++) { dur += fl & 0x100 ? dv.getUint32(o) : def; o += per; }
        }
      }
      const T = tracks[id]; if (T) T.end = Math.max(T.end, base + dur);
    }
    let total = 0; for (const T of Object.values(tracks)) if (T.ts) total = Math.max(total, T.end / T.ts);
    if (!total || !isFinite(total) || total > 600) return buf;
    const put = (off, big, val) => big ? dv.setBigUint64(off, BigInt(Math.round(val))) : dv.setUint32(off, Math.round(val));
    put(mvhd.s + (v1 ? 24 : 16), v1, total * mts);
    for (const T of Object.values(tracks)) { const tv = b[T.tkhd.s] === 1, mv = b[T.mdhd.s] === 1; put(T.tkhd.s + (tv ? 28 : 20), tv, total * mts); put(T.mdhd.s + (mv ? 24 : 16), mv, T.end); }
    const out = new Uint8Array(b.length + 20), od = new DataView(out.buffer);
    out.set(b.subarray(0, mvex.s), 0); out.set(b.subarray(mvex.s), mvex.s + 20);
    od.setUint32(mvex.s, 20); out.set([109, 101, 104, 100], mvex.s + 4); od.setUint32(mvex.s + 8, 0x01000000); od.setBigUint64(mvex.s + 12, BigInt(Math.round(total * mts)));
    od.setUint32(moov.i, dv.getUint32(moov.i) + 20); od.setUint32(mvex.i, dv.getUint32(mvex.i) + 20);
    return out.buffer;
  } catch { return buf; }
}
// Cerrar el audio una sola vez (close() de un contexto ya cerrado rechaza la promesa).
const recapCloseAudio = ac => { if (ac && ac.state !== 'closed') ac.close().catch(() => { }); };
const ease = { out: x => 1 - Math.pow(1 - x, 3), inOut: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, back: x => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); } };
const clamp01 = x => Math.max(0, Math.min(1, x));
function mixHex(a, b, p) { const h = s => [1, 3, 5].map(i => parseInt(String(s).slice(i, i + 2), 16) || 0), x = h(a), y = h(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * p).toString(16).padStart(2, '0')).join(''); }
function hexA(h, a) { const [r, g, b] = [1, 3, 5].map(i => parseInt(String(h).slice(i, i + 2), 16) || 0); return `rgba(${r},${g},${b},${a})`; }

const recapYearOpen = (d = new Date()) => d.getMonth() === 11 && d.getDate() <= 7;
function recapTileHTML() {
  return `<button class="tile rctile" data-act="open" data-r="recap" data-push="1"><span class="rckick">${new Date().getFullYear()}</span><b>${tx('Tu año con Nanuq')}</b><small>${tx('Tu resumen en video')}</small><svg class="rcbear nfb" viewBox="-70 -150 652 660" aria-hidden="true"><g class="n-bear"><g transform="scale(1.4222 1.4227)">${['body', 'belly', 'head', 'muzzle', 'nose', 'eyes'].map(id => `<use href="#djb-${id}"/>`).join('')}</g><g class="acc-g">${BEAR_ACC[Settings.theme] || ''}</g></g></svg></button>`;
}
V.recap = async (el, { year, week } = {}) => {
  week = !!week; Recap.setMode(week);
  const title = week ? tx('Tu semana con Nanuq') : tx('Tu año con Nanuq');
  year = new Date().getFullYear(); // solo el año en curso
  if (!week && !recapYearOpen()) { el.innerHTML = head(title) + `<div class="empty">${tx('«Tu año con Nanuq» llega la primera semana de diciembre (del 1 al 7). Mientras tanto, prueba «Tu semana con Nanuq» en Ajustes.')}</div>`; return; }
  el.innerHTML = head(title) + loading() + '<p class="muted" id="rcLoad" style="text-align:center"></p>';
  const prog = (n, m) => { if (!el.isConnected) return false; const e = $('#rcLoad', el); if (e && m > 1) e.textContent = tx('Leyendo tu historial del servidor… {0} de {1} días', [n, m]); };
  const R = await (week ? Recap.collectWeek(prog) : Recap.collect(year, prog)).catch(() => null);
  if (!R) { el.innerHTML = head(title) + `<div class="empty">${week ? tx('No encontré música de la semana pasada. Escucha algo esta semana y vuelve el lunes.') : tx('Todavía no hay suficiente música de {0} para armar tu resumen. Escucha un poco más y vuelve.', [year])}</div>`; return; }
  el.innerHTML = head(title) + `<div class="rcwrap"><div class="rcstage"><canvas id="rcC" width="${RECAP_W}" height="${RC_H}"></canvas><div class="rcprog" id="rcP"><i></i></div></div>
    <div class="rcside">
      <div class="btns"><button class="btn pri" id="rcPlay">${ic('play', 1)}${tx('Ver')}</button><button class="btn" id="rcRec">${ic('download')}${tx('Exportar video')}</button></div>
      <p class="muted" id="rcMsg">${week ? tx('Semana del ') + esc(R.label) + '. ' : ''}${tx('Unos')} ${Math.round(Recap.total)} ${tx('segundos, con música hecha por Nanuq. Para exportar, Nanuq lo reproduce y lo graba: no cambies de app mientras tanto.')}</p>
      <div class="list rcsum">${week ? `
        <div class="li"><span class="t">${esc(R.minutes.toLocaleString(LOC))} ${tx('minutos')}<small>${esc(R.plays)} ${tx('canciones la semana pasada')}</small></span></div>
        <div class="li"><span class="t">${esc((R.top[0] || {}).name || '—')}<small>${tx('Tu canción de la semana ·')} ${esc((R.top[0] || {}).artist || '')}</small></span></div>
      </div>` : `
        <div class="li"><span class="t">${esc(R.minutes.toLocaleString(LOC))} ${tx('minutos')}<small>${tx('de música en')} ${esc(R.year)}</small></span></div>
        <div class="li"><span class="t">${esc((R.topArtists[0] || {}).name || '—')}<small>${tx('Tu artista del año')}</small></span></div>
        <div class="li"><span class="t">${esc((R.top[0] || {}).name || '—')}<small>${tx('Tu canción del año ·')} ${esc((R.top[0] || {}).artist || '')}</small></span></div>
        <div class="li"><span class="t">${esc(R.persona.name)}<small>${esc(R.persona.line)}</small></span></div>
      </div>`}
    </div></div>`;
  const cv = $('#rcC', el), msg = $('#rcMsg', el), bar = $('#rcP i', el), playB = $('#rcPlay', el), recB = $('#rcRec', el);
  const A = await Recap.assets(R);
  if (!el.isConnected) return;
  Recap.frame(cv.getContext('2d'), week ? 1.2 : 2.2, R, A, [0, 1].map(() => Object.assign(document.createElement('canvas'), { width: RECAP_W, height: RC_H })));
  const tick = t => { bar.style.width = (t / Recap.total * 100) + '%'; };
  const idle = () => { playB.disabled = recB.disabled = false; playB.innerHTML = ic('play', 1) + tx('Ver'); };
  playB.onclick = () => {
    if (Recap.raf && !Recap.rec) { Recap.stop(); idle(); return; }
    if (P.audio && !P.audio.paused) P.pause();
    playB.innerHTML = ic('pause', 1) + tx('Detener'); recB.disabled = true; Recap.rec = null;
    Recap.play(cv, R, A, { onTick: tick, onEnd: idle });
  };
  recB.onclick = () => {
    if (P.audio && !P.audio.paused) P.pause();
    playB.disabled = recB.disabled = true; msg.textContent = tx('Grabando… no cambies de app hasta que termine.');
    Recap.play(cv, R, A, { record: true, onTick: tick, onEnd: async (blob, mime) => { Recap.rec = null; msg.textContent = tx('Guardando…'); await Recap.save(blob, mime, R.year, week ? 'semana-' + (d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))(new Date(R.from)) : ''); msg.textContent = tx('Listo. Puedes volver a exportarlo cuando quieras.'); idle(); } });
  };
  el._cleanup = () => { Recap.stop(); Recap.rec = null; Recap.setMode(false); };
};
/* =========================================================
   Solicitar canción: un servidor SomeDL (https://github.com/ChemistryGull/SomeDL, abierto con «somedl web»)
   descarga la canción de YouTube Music con sus datos y la guarda en la carpeta de tu biblioteca. Nanuq le
   manda el pedido (POST /add), sigue su avance (/status y /get-queue) y avisa cuando termina.
   El servidor web de SomeDL no acepta peticiones de otras páginas (CORS): en Android y Linux las hace la app nativa.
   ========================================================= */
const REQ_HTTP = { seq: 0, wait: new Map() };
window.__nanuqHttp = (id, status, text) => { const w = REQ_HTTP.wait.get(id); if (w) { REQ_HTTP.wait.delete(id); w({ status, text }); } };
const reqNative = () => !!((window.NanuqAndroid && window.NanuqAndroid.http) || (window.nanuqDesktop && window.nanuqDesktop.http));
async function reqRawHttp(method, url, body) {
  const b = body === undefined ? undefined : JSON.stringify(body);
  if (window.NanuqAndroid && NanuqAndroid.http) return new Promise(res => { const id = 'h' + (++REQ_HTTP.seq); REQ_HTTP.wait.set(id, res); NanuqAndroid.http(id, method, url, b || ''); });
  if (window.nanuqDesktop && nanuqDesktop.http) return nanuqDesktop.http(method, url, b);
  try {
    const r = await fetch(url, { method, headers: { Accept: 'application/json', ...(b ? { 'Content-Type': 'application/json' } : {}) }, body: b });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { status: 0, text: String(e && e.message || e) }; }
}
// Dirección de SomeDL: como la de Jellyfin, pero sin esquema se usa http:// y, para IPs y nombres cortos, el puerto 5000.
function parseSomedl(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error(tx('Escribe la dirección de SomeDL'));
  const hasScheme = /^[a-z]+:\/\//i.test(s);
  const p = parseServer(hasScheme ? s : 'http://' + s);
  const u = new URL(p.base);
  if (!hasScheme && !u.port && (p.isIP || !p.host.includes('.'))) { u.port = '5000'; p.base = (u.origin + u.pathname).replace(/\/+$/, ''); }
  return p;
}
function reqNetError(base) {
  let m = tx('No hubo respuesta de SomeDL en {0}. Revisa que esté abierto con «somedl web» y que en su configuración, en [webui], tenga host = "0.0.0.0" para aceptar otros dispositivos.', [base]);
  if (!reqNative()) {
    if (location.protocol === 'https:' && base.startsWith('http:')) m += tx(' Además, esta página va por https y SomeDL por http: el navegador bloquea la conexión.');
    m += tx(' En el navegador, SomeDL solo funciona detrás de un proxy que permita CORS (ver LEEME); la app de Android y la de Linux se conectan directo.');
  }
  return new Error(m);
}
const REQ_STATES = { queued: tx('En la cola de SomeDL'), active: tx('Descargando'), done: tx('Descargada'), exists: tx('Ya estaba descargada'), skipped: tx('SomeDL tiene la descarga desactivada'), failed: tx('No se pudo descargar'), lost: tx('SomeDL se reinició y la perdió') };
// Paso que SomeDL está haciendo ahora (mismo orden que usa su página) → texto y avance aproximado.
const REQ_STEPS = [['albumart', tx('Guardando carátula'), 95], ['downloading', tx('Descargando audio'), 75], ['wait_queue', tx('Esperando turno para descargar'), 50], ['get_lyrics', tx('Buscando la letra'), 40], ['musicbrainz', tx('Buscando datos'), 30], ['deezer', tx('Buscando datos'), 20], ['album', tx('Buscando el álbum'), 10]];
const REQ = {
  cfg: store.get('somedl', null),     // { base, version }
  list: store.get('somedlReqs', []),  // { id, q, title, song, artist, state, step, pct, path, at, end }
  pollT: 0, miss: {}, offline: false, busy: false, lastRefresh: 0,
  save() { this.list = this.list.slice(0, 200); store.set('somedlReqs', this.list); },
  setCfg(c) { this.cfg = c; if (c) store.set('somedl', c); else store.del('somedl'); this.offline = false; },
  pending() { return this.list.filter(r => r.state === 'queued' || r.state === 'active'); },
  visible() { return document.visibilityState === 'visible' && RC.visible; },
  async http(path, body, base = this.cfg && this.cfg.base) {
    const r = await reqRawHttp(body === undefined ? 'GET' : 'POST', base + path, body);
    if (!r || r.status === 0) throw reqNetError(base);
    let d = null; try { d = r.text ? jparse(r.text) : null; } catch { }
    if (r.status >= 400) { const e = new Error(d && d.error ? tx('SomeDL respondió: ') + d.error : tx('SomeDL respondió con el error ') + r.status); e.code = r.status; throw e; }
    if (d == null) throw new Error(tx('Esa dirección respondió, pero no parece SomeDL.'));
    return d;
  },
  async probe(base) {
    const d = await this.http('/get-version', undefined, base);
    if (!d || !d.v) throw new Error(tx('Esa dirección respondió, pero no parece SomeDL.'));
    return String(d.v);
  },
  // Manda el pedido. SomeDL busca la canción antes de responder (puede tardar unos segundos); un enlace de playlist trae varias.
  async add(q) {
    const d = await this.http('/add', { input_list: [q] });
    const songs = (d && d.song_list) || [];
    if (!songs.length) throw new Error(tx('SomeDL no encontró nada para «') + q + '».');
    const now = Date.now();
    for (const s of songs.slice().reverse()) {
      const title = s.text_query || [s.artist_name, s.song_title].filter(Boolean).join(' - ') || q;
      this.list.unshift({ id: String(s.somedl_id), q, title, song: s.song_title || '', artist: s.artist_name || '', state: 'queued', step: '', pct: 0, at: now });
    }
    this.save(); this.schedule(1500);
    return songs.length;
  },
  schedule(ms) { clearTimeout(this.pollT); this.pollT = 0; if (this.cfg && this.pending().length) this.pollT = setTimeout(() => this.poll(), ms); },
  async poll() {
    this.pollT = 0;
    if (!this.cfg || !this.pending().length || this.busy) return;
    this.busy = true;
    let st, qu;
    try { [st, qu] = await Promise.all([this.http('/status'), this.http('/get-queue')]); }
    catch { this.busy = false; if (!this.offline) { this.offline = true; renderReqSoon(); } this.schedule(this.visible() ? 10000 : 30000); return; }
    this.busy = false; this.offline = false;
    const fin = st.finished_items || {}, act = st.active_items || {}, queued = new Set((qu.queue || []).map(x => String(x.somedl_id)));
    const ended = [];
    for (const r of this.pending()) {
      if (fin[r.id]) {
        const s = fin[r.id][0];
        r.state = s === 'success' ? 'done' : s === 'already_downloaded' ? 'exists' : s === 'download_disabled' ? 'skipped' : 'failed';
        r.path = fin[r.id][1] || ''; r.end = Date.now(); r.pct = 100; ended.push(r); delete this.miss[r.id];
      } else if (act[r.id]) {
        const a = act[r.id], data = a.data || {}, step = REQ_STEPS.find(x => data[x[0]]);
        r.state = 'active'; r.step = step ? step[1] : tx('Preparando'); r.pct = step ? step[2] : 5;
        const t = String(a.text || '').split(/ (.+)/)[1]; if (t) r.title = t; // «1/2 Artista - Canción»
        delete this.miss[r.id];
      } else if (queued.has(r.id)) { r.state = 'queued'; delete this.miss[r.id]; }
      // Ni en la cola ni descargándose ni terminada: SomeDL se reinició (su historial vive en memoria).
      else if ((this.miss[r.id] = (this.miss[r.id] || 0) + 1) >= 3) { r.state = 'lost'; r.end = Date.now(); ended.push(r); delete this.miss[r.id]; }
    }
    this.save();
    if (ended.length) this.announce(ended);
    renderReqSoon();
    this.schedule(this.visible() ? 2500 : 15000);
  },
  announce(ended) {
    const name = r => tx('«{0}»', [r.title]), names = l => l.slice(0, 3).map(name).join(', ') + (l.length > 3 ? ' ' + tx('y {0} más', [l.length - 3]) : '');
    const ok = ended.filter(r => r.state === 'done'), had = ended.filter(r => r.state === 'exists'), bad = ended.filter(r => !['done', 'exists'].includes(r.state));
    const msgs = [];
    if (ok.length) msgs.push([ok.length === 1 ? tx('Canción descargada') : ok.length + tx(' canciones descargadas'), names(ok) + (ok.length === 1 ? tx(' ya está') : tx(' ya están')) + tx(' en tu servidor. Aparecerá en tu biblioteca cuando Jellyfin la escanee.')]);
    if (had.length) msgs.push([had.length === 1 ? tx('Ya la tenías') : tx('Ya las tenías'), names(had) + (had.length === 1 ? tx(' ya estaba descargada.') : tx(' ya estaban descargadas.'))]);
    if (bad.length) msgs.push([bad.length === 1 ? tx('No se pudo descargar') : tx('No se pudieron descargar ') + bad.length, names(bad) + tx('. Puedes reintentar desde Solicitar canción.')]);
    toast(msgs.map(m => m[0] + ': ' + m[1]).join(' '), 7000);
    if (!this.visible()) msgs.forEach(([t, b]) => sysNotify(t, b));
    if (ok.length && api && api.kind === 'jellyfin') {
      // Pedir a Jellyfin que busque archivos nuevos (solo funciona con usuarios administradores; si no, lo hará en su próximo escaneo).
      if (Date.now() - this.lastRefresh > 120000) { this.lastRefresh = Date.now(); api.refreshLibrary().catch(() => { }); }
      setTimeout(() => { cache.clear(); LIB.reset(); }, 20000); // que las listas (y los álbumes) muestren las canciones nuevas
    }
  },
  retry(r) {
    const q = r.artist && r.song ? r.artist + ' - ' + r.song : r.title || r.q;
    this.list = this.list.filter(x => x !== r);
    return this.add(q);
  }
};
// Aviso del sistema cuando Nanuq no está a la vista.
function sysNotify(title, body) {
  try {
    if (window.NanuqAndroid && NanuqAndroid.notice) { NanuqAndroid.notice(title, body); return; }
    if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: 'icons/icon-192.png', tag: 'nanuq-req-' + Date.now() });
  } catch { }
}
function askNotifyPermission() { try { if (!window.NanuqAndroid && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { }); } catch { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') REQ.schedule(400); });

function reqRowHTML(r) {
  const sub = r.state === 'active' ? r.step || REQ_STATES.active : REQ_STATES[r.state] || r.state;
  const when = r.end || r.at ? new Date(r.end || r.at).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const icon = { done: 'check', exists: 'check', failed: 'x', lost: 'x', skipped: 'x' }[r.state] || 'req';
  const color = r.state === 'done' || r.state === 'exists' ? 'var(--accent)' : ['failed', 'lost', 'skipped'].includes(r.state) ? '#ff6b6b' : 'var(--muted)';
  const act = r.state === 'done' || r.state === 'exists' ? `<button class="btn" data-act="req-find" data-id="${esc(r.id)}" title="${tx('Buscar en tu biblioteca')}">${ic('search')}<span class="lb">${tx('Buscar')}</span></button>`
    : ['failed', 'lost', 'skipped'].includes(r.state) ? `<button class="btn" data-act="req-retry" data-id="${esc(r.id)}" title="${tx('Pedirla otra vez')}">${ic('refresh')}<span class="lb">${tx('Reintentar')}</span></button>` : '';
  return `<div class="dlrow"><span class="cover reqic" style="color:${color}">${ic(icon)}</span><div class="m"><div class="t">${esc(r.title)}</div><small>${esc([sub, when].filter(Boolean).join(' · '))}</small>${r.state === 'active' || r.state === 'queued' ? `<div class="dlbar"><i style="width:${r.state === 'queued' ? 2 : r.pct || 5}%"></i></div>` : ''}</div>${act}<button class="cbtn" data-act="req-del" data-id="${esc(r.id)}" aria-label="${tx('Quitar de la lista')}" title="${tx('Quitar de la lista')}">${ic('x')}</button></div>`;
}
function reqListHTML() {
  const l = REQ.list, endedN = l.filter(r => !['queued', 'active'].includes(r.state)).length;
  return (REQ.offline ? `<div class="err" style="margin-bottom:14px"><b>${tx('SomeDL no responde')}</b>${tx('Se seguirá intentando; las canciones pendientes no se pierden mientras SomeDL siga abierto.')}</div>` : '')
    + (l.length ? `<div class="letter">${tx('Tus pedidos')}</div><div class="list">${l.map(reqRowHTML).join('')}</div>${endedN ? `<div class="dlsum" style="margin-top:14px"><button class="btn" data-act="req-clear">${tx('Quitar las terminadas (')}${endedN})</button></div>` : ''}`
      : `<div class="empty">${tx('Escribe el artista y el nombre de la canción, o pega un enlace de YouTube o YouTube Music.')}<br>${tx('SomeDL la descarga a tu servidor y Nanuq te avisa cuando esté lista.')}</div>`);
}
let reqRenderT = 0;
function renderReqSoon() {
  if (reqRenderT) return;
  reqRenderT = setTimeout(() => { reqRenderT = 0; if (cur()?.name !== 'request') return; const b = $('#rqList'); if (b) b.innerHTML = reqListHTML(); }, 150);
}
V.request = async (el) => {
  const c = REQ.cfg;
  if (!c) {
    el.innerHTML = head(tx('Solicitar canción')) + `<div class="set">
      <p class="muted" style="margin-top:0">${tx('¿Te falta una canción?')} <b>SomeDL</b> ${tx('la busca en YouTube Music, le pone carátula, letra y datos, y la guarda en tu servidor. Nanuq le manda tus pedidos y te avisa cuando están listos.')}</p>
      <h2>${tx('Conectar con SomeDL')}</h2>
      <form id="rqSF" autocomplete="off">
        <div class="field"><label for="rqS">${tx('Dirección de SomeDL')}</label><input class="inp" id="rqS" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="${tx('192.168.1.20:5000 o http://servidor:5000')}" value="${esc(store.get('somedlLast', ''))}"><div class="hint" id="rqSH"></div></div>
        <button class="btn pri" id="rqGo">${tx('Conectar')}</button><div class="msg" id="rqSM"></div>
      </form>
      <h2>${tx('Cómo prepararlo')}</h2>
      <ol class="reqhelp">
        <li>${tx('En la computadora de Jellyfin, instala SomeDL:')} <code>${tx('pipx install somedl')}</code> ${tx('(necesita Python 3.10 o más nuevo y FFmpeg).')}</li>
        <li>${tx('Crea su configuración con')} <code>${tx('somedl --generate-config')}</code> ${tx('y edita')} <code>${tx('somedl_config.toml')}</code>${tx(': en')} <code>${tx('[download]')}</code>${tx(', pon en')} <code>${tx('output_dir')}</code> ${tx('la carpeta de música de Jellyfin; en')} <code>${tx('[webui]')}</code>${tx(', pon')} <code>${tx('host = "0.0.0.0"')}</code> ${tx('(para que otros dispositivos se conecten) y')} <code>${tx('open_browser = false')}</code>.</li>
        <li>${tx('Ábrelo con')} <code>${tx('somedl web')}</code>${tx('. Escucha en el puerto 5000.')}</li>
        <li>${tx('Para que las canciones aparezcan solas, activa en Jellyfin el')} <i>${tx('monitoreo en tiempo real')}</i> ${tx('de la biblioteca de música.')}</li>
      </ol>
      <p class="muted" style="font-size:12.5px">${tx('SomeDL no tiene contraseña: no lo publiques en internet, úsalo solo en tu red o por VPN.')}${reqNative() ? '' : tx(' En el navegador necesita además un proxy con CORS (ver LEEME); la app de Android y la de Linux se conectan directo.')}</p>
    </div>`;
    const inp = $('#rqS', el), hint = $('#rqSH', el), msg = $('#rqSM', el), btn = $('#rqGo', el);
    const upd = () => { const v = inp.value.trim(); if (!v) { hint.className = 'hint'; hint.textContent = tx('IP o nombre de la computadora donde corre SomeDL.'); return; } try { const p = parseSomedl(v); hint.className = 'hint ok'; hint.textContent = '→ ' + p.base; } catch (e) { hint.className = 'hint warn'; hint.textContent = e.message; } };
    inp.oninput = upd; upd();
    $('#rqSF', el).onsubmit = async e => {
      e.preventDefault(); msg.innerHTML = '';
      let p; try { p = parseSomedl(inp.value); } catch (err) { msg.innerHTML = `<div class="err">${esc(err.message)}</div>`; return; }
      btn.disabled = true; btn.textContent = tx('Conectando…');
      try {
        const v = await REQ.probe(p.base);
        store.set('somedlLast', inp.value.trim()); REQ.setCfg({ base: p.base, version: v });
        toast(tx('Conectado con SomeDL ') + v); render(); REQ.schedule(500);
      } catch (err) { if (!document.body.contains(btn)) return; msg.innerHTML = `<div class="err"><b>${tx('Sin conexión')}</b>${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = tx('Conectar'); }
    };
    if (!mqMobile.matches) setTimeout(() => inp.focus(), 50);
    return;
  }
  el.innerHTML = head(tx('Solicitar canción'), `<button class="btn" data-act="req-change" title="${tx('Servidor SomeDL')}">${ic('server')}<span class="lb">SomeDL</span></button>`)
    + `<form class="reqf" id="rqF" autocomplete="off"><input class="inp" id="rqQ" maxlength="500" placeholder="${tx('Artista - Canción, o un enlace de YouTube')}" enterkeyhint="send" autocapitalize="sentences"><button class="btn pri" id="rqB">${ic('req')}${tx('Solicitar')}</button></form>
      <div class="hint" id="rqM" style="margin:-12px 0 18px">${tx('Se descarga en SomeDL')} ${esc(c.version || '')} · ${esc(c.base)}</div>
      <div id="rqList">${reqListHTML()}</div>`;
  const inp = $('#rqQ', el), btn = $('#rqB', el), m = $('#rqM', el), idle = m.textContent;
  $('#rqF', el).onsubmit = async e => {
    e.preventDefault();
    const q = inp.value.trim();
    if (q.length < 2) { inp.focus(); return; }
    askNotifyPermission();
    btn.disabled = true; inp.disabled = true; m.className = 'hint'; m.textContent = tx('SomeDL está buscando «') + q + '»…';
    try {
      const n = await REQ.add(q);
      inp.value = ''; m.className = 'hint ok'; m.textContent = n === 1 ? tx('Pedido enviado. Te avisamos cuando esté lista.') : n + tx(' canciones en camino. Te avisamos cuando estén listas.');
      setTimeout(() => { if (m.isConnected) { m.className = 'hint'; m.textContent = idle; } }, 5000);
      renderReqSoon();
    } catch (err) { m.className = 'hint warn'; m.textContent = err.message; }
    btn.disabled = false; inp.disabled = false; if (!mqMobile.matches) inp.focus();
  };
  if (!mqMobile.matches) setTimeout(() => inp.focus(), 50);
  REQ.schedule(300);
};
// «Actualizar desde Jellyfin» (Ajustes): se olvida todo lo guardado de la biblioteca y se vuelve a pedir. Si eres
// administrador, también se le pide a Jellyfin que revise tus archivos (cambios de etiquetas o canciones nuevas) y, medio
// minuto después, se vuelve a pedir lo que haya cambiado.
async function refreshFromJellyfin(again) {
  if (!api || api.kind !== 'jellyfin') return;
  if (!again) toast(tx('Actualizando tus datos desde Jellyfin…'), 3000);
  cache.clear(); LY.cache.clear(); P.peaks.clear(); LYRX.reset(); LIB.reset();
  try { await LIB.index(); await (LIB.p || LIB.refresh()); } // index() ya empezó a renovarla (se olvidó la fecha): se espera esa
  catch (e) { if (!again) toast(tx('No se pudo actualizar: ') + e.message, 5000); return; }
  // Las canciones de tu cola (nombres, carátulas, álbum…), sin cortar lo que suena.
  if (!RC.remote && P.queue.length) {
    const ids = [...new Set(P.queue.map(t => t.id))].slice(0, 1000);
    const fresh = new Map((await api.itemsByIds(ids).catch(() => [])).map(t => [t.id, t]));
    P.queue = P.queue.map(t => fresh.has(t.id) ? { ...t, ...fresh.get(t.id), qid: t.qid, djS: t.djS, djI: t.djI, djFirst: t.djFirst } : t);
    P.cur = P.queue[P.i] || null; saveQueue(); updateNow(); renderQueueAll();
  }
  const L = LIB.peek(), songs = L ? L.list.reduce((a, x) => a + x.tracks.length, 0) : 0;
  refreshIf(() => true);
  if (again) return;
  let scan = false; try { await api.refreshLibrary(); scan = true; } catch { }
  toast(tx('Listo: {0} canciones en {1} álbumes.', [songs.toLocaleString(LOC), L ? L.list.length.toLocaleString(LOC) : 0]) + (scan ? tx(' Jellyfin está revisando tus archivos: en medio minuto se actualiza otra vez.') : ''), 5000);
  if (scan) setTimeout(() => refreshFromJellyfin(true), 30000);
}
// Un 401 no siempre es la sesión vencida: puede venir de un proxy con inicio de sesión propio o de Jellyfin mientras
// arranca. Antes de mandarte a entrar se confirma con una segunda consulta (una sola a la vez).
let sessionCheck = null;
function sessionGone() {
  if (sessionCheck) return sessionCheck;
  sessionCheck = (async () => {
    await new Promise(r => setTimeout(r, 1500));
    try { await api.alt(['/Users/Me', `/Users/${api.userId}`]); return false; }
    catch (e) { return e.code === 401; }
  })();
  sessionCheck.finally(() => setTimeout(() => { sessionCheck = null; }, 2000)); // vale solo para la ráfaga de 401 de ese momento
  return sessionCheck;
}
// Sesión vencida de verdad: se detiene todo (música, control remoto, DJ) antes de pedir entrar. La cola se conserva.
function sessionExpired() {
  if ($('#login') && !$('#login').classList.contains('hidden')) return;
  RC.stop(); DJ.stop(true); sessionHold('off');
  QPOS.save(true); P.pause();
  toast(tx('Tu sesión de Jellyfin expiró. Vuelve a entrar.'), 5000);
  showLogin();
}
let renderSeq = 0;
async function render(restore) {
  const c = cur(); if (!c) return;
  const view = $('#view'), main = $('#main');
  const old = view.firstElementChild; if (old && old._cleanup) { old._cleanup(); old._cleanup = null; }
  const n = ++renderSeq;
  const top = c.name === 'folders' && c.params.id ? 'folders' : (TOP.includes(c.name) ? c.name : ({ album: 'albums', artist: 'artists', genre: 'genres', playlist: 'playlists', mix: 'home', dj: 'home', recap: 'home' }[c.name] || ''));
  const navKey = S.stack.find(s => TOP.includes(s.name))?.name || top;
  $$('#sidenav button').forEach(b => b.classList.toggle('on', b.dataset.r === navKey));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.r === navKey || (b.dataset.r === 'more' && ['albums', 'artists', 'playlists', 'favorites', 'downloads', 'genres', 'folders', 'settings', 'request', 'party'].includes(navKey) && !(b.dataset.r === navKey))));
  main.scrollTop = 0;
  const box = document.createElement('div');
  // Transición: al cambiar de pestaña se desliza según su posición; al entrar más hondo, desde la derecha; al volver, desde la izquierda.
  const depth = S.stack.length, oi = NAV_ORDER.indexOf(S.lastNav), ni = NAV_ORDER.indexOf(navKey);
  const dir = S.lastNav && S.lastNav !== navKey ? (ni >= oi ? 'fwd' : 'bwd') : depth > (S.lastDepth || 0) ? 'fwd' : depth < (S.lastDepth || 0) ? 'bwd' : '';
  if (dir && S.lastNav) box.className = 'vin ' + dir;
  S.lastNav = navKey; S.lastDepth = depth;
  view.replaceChildren(box);
  try {
    await (V[c.name] || V.albums)(box, c.params || {});
    if (n !== renderSeq) return;
    if (restore && c.scroll) requestAnimationFrame(() => main.scrollTop = c.scroll);
    markCurrent(); djLiveSync();
  } catch (e) {
    if (n !== renderSeq) return;
    if (e.code === 401 && api.kind === 'jellyfin') {
      box.innerHTML = head('') + loading();
      if (await sessionGone()) return; // sessionExpired() ya se encarga (desde req)
      if (n !== renderSeq) return;
      box.innerHTML = head(c.name === 'album' ? tx('Álbum') : '') + errBox(new Error(tx('El servidor rechazó esta petición (401), pero tu sesión de Jellyfin sigue activa. Si entras a Jellyfin a través de un proxy con su propio inicio de sesión (Authelia, Cloudflare Access…), vuelve a entrar en él.')));
      return;
    }
    box.innerHTML = head(c.name === 'album' ? tx('Álbum') : '') + errBox(e);
  }
}

/* =========================================================
   Player
   ========================================================= */
const P = {
  audio: new Audio(), queue: [], i: -1, cur: null, mode: store.get('mode', 'once'), session: uid(), seq: 0, peaks: new Map(), lastReport: 0,
};
P.audio.preload = 'auto';
// Pausas que hace Nanuq (tus botones, la barra espaciadora, los controles del sistema, la fiesta, cambiar de canción…)
// se marcan. Una pausa que Nanuq NO pidió (otra app tomó la salida de audio y Chromium detuvo la canción) deja la
// salida de audio de esa canción muerta: al reanudar no se oía nada hasta reiniciar Nanuq. Por eso, tras una pausa
// así, reanudar vuelve a cargar la canción en el mismo segundo (con una salida de audio nueva). Ver playSoft.
P.pause = () => { P.ownPauseAt = Date.now(); P.audio.pause(); };
P.audio.volume = Settings.volume;
// Como control remoto, P.queue es la cola del OTRO dispositivo: no se guarda como tuya.
function saveQueue() { PF.soon(); if (RC.remote) return; store.set('queue', { q: P.queue.slice(0, 3000), i: P.i }); RC.reportSoon(600); }
// Posición de la canción para retomarla tras un cierre (el sistema mató la app, se apagó el teléfono…). Solo se
// guarda el id al azar de esa entrada de la cola y los segundos: no dice nada de ti, va en localStorage.
const QPOS = {
  t: 0,
  save(force) {
    if (RC.remote || !P.cur || !P.audio.src) return;
    const now = Date.now(); if (!force && now - this.t < 5000) return; this.t = now;
    store.set('queuePos', { qid: P.cur.qid, pos: Math.round(ptime()) });
  },
  // { qid, sec } si la canción actual de la cola es la que estaba sonando y vale la pena retomarla.
  restore() {
    const q = store.get('queuePos', null), d = P.cur && P.cur.duration || 0;
    return q && P.cur && q.qid === P.cur.qid && q.pos > 3 && (!d || q.pos < d - 5) ? { qid: q.qid, sec: q.pos } : null;
  },
  clear() { store.del('queuePos'); }
};
addEventListener('pagehide', () => QPOS.save(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') QPOS.save(true); });
function setQueue(tracks, start = 0) { if (RC.remote) { RC.playQueue(tracks, start); return; } P.queue = tracks.map(t => ({ ...t, qid: uid() })); playIndex(start); renderQueueAll(); }
function addToQueue(tracks, next) {
  if (RC.remote) { RC.add(tracks, next); return; }
  const items = tracks.map(t => ({ ...t, qid: uid() }));
  if (next && P.i >= 0) P.queue.splice(P.i + 1, 0, ...items); else P.queue.push(...items);
  if (P.i < 0) playIndex(0); else { saveQueue(); renderQueueAll(); }
  toast(items.length === 1 ? (next ? tx('Sonará a continuación') : tx('Añadida a la cola')) : tx('{0} pistas añadidas a la cola', [items.length]));
}
/* Posición de la canción = desplazamiento + tiempo del <audio>. Las conversiones en vivo de Jellyfin (p. ej. MP3 a 320 kbps)
   no tienen duración ni permiten saltar dentro del archivo: para adelantar se le pide al servidor que empiece en ese segundo
   (StartTimeTicks) y se recuerda el desplazamiento. Los archivos directos y los descargados saltan normal. */
const ptime = () => RC.remote ? RC.pos() : (P.off || 0) + P.audio.currentTime;
function pdur() {
  if (RC.remote) return P.cur?.duration || 0;
  const d = P.audio.duration;
  if (!P.off && d && isFinite(d)) return d;
  return P.cur?.duration || (d && isFinite(d) ? (P.off || 0) + d : 0);
}
function setSrc(url) { clearTimeout(P.seekT); P.dragSec = null; P.off = 0; P.srcBase = url; P.ownPauseAt = Date.now(); P.extPause = null; P.audio.src = url; }
// drag: el usuario está arrastrando la barra. Si saltar exige pedir otra vez el audio (conversión en vivo) o mandar
// una orden al otro dispositivo, solo se mueve la barra y la petición sale al soltar o tras 300 ms quieto: así no se
// arranca una conversión nueva en Jellyfin por cada movimiento del dedo.
function seekTo(sec, drag = false) {
  if (!P.cur) return;
  clearTimeout(P.seekT);
  if (RC.remote) {
    if (drag) { RC.anchor = { pos: Math.max(0, sec), at: Date.now() }; RC.tick(); P.seekT = setTimeout(() => RC.seek(sec), 300); }
    else RC.seek(sec);
    return;
  }
  const d = pdur(); sec = Math.max(0, d ? Math.min(d - 0.2, sec) : sec);
  // Todavía no se cargó el audio (recién abierta la app): se recuerda el punto y se salta ahí al reproducir.
  if (!P.audio.getAttribute('src')) { P.resume = { qid: P.cur.qid, sec }; P.dragSec = sec; drawWaves(); return; }
  const rel = sec - (P.off || 0), sk = P.audio.seekable;
  for (let k = 0; k < sk.length; k++) if (rel >= 0 && rel >= sk.start(k) && rel <= sk.end(k)) { P.dragSec = null; P.audio.currentTime = rel; drawWaves(); RC.reportSoon(); return; }
  if (api.kind !== 'jellyfin' || !P.srcBase || P.srcBase.startsWith('blob:') || DL.isLocal(P.srcBase)) { P.dragSec = null; try { P.audio.currentTime = Math.max(0, rel); } catch { } drawWaves(); return; }
  if (drag) { P.dragSec = sec; drawWaves(); P.seekT = setTimeout(() => seekTo(sec), 300); return; }
  P.dragSec = null;
  const wasPaused = P.audio.paused;
  P.off = sec; P.ownPauseAt = Date.now(); P.audio.src = P.srcBase + '&StartTimeTicks=' + Math.round(sec * 1e7);
  if (!wasPaused) P.audio.play().catch(() => { });
  drawWaves(); syncLyrics(true); RC.reportSoon();
}
async function playIndex(i, autoplay = true, quiet = false) {
  if (i < 0 || i >= P.queue.length) return;
  if (partyHostOpen()) return; // con la fiesta abierta, tu música no suena
  if (RC.remote) { RC.playQueue(P.queue, i); return; }
  if (P.cur && !quiet) api.report('stop', P.cur, ptime());
  P.i = i; P.cur = P.queue[i]; const n = ++P.seq;
  saveQueue(); updateNow(); renderQueueAll(); markCurrent(); DJ.onTrack();
  try {
    const url = await api.stream(P.cur);
    if (n !== P.seq) return;
    sessionHold(autoplay ? 'loading' : 'parked'); // que los controles del sistema no desaparezcan mientras carga
    setSrc(url);
    // Primera vez que suena la canción que quedó a medias al cerrar la app: retoma en ese segundo.
    if (P.resume && P.resume.qid === P.cur.qid) P.pendingSeek = { seq: n, sec: P.resume.sec };
    P.resume = null;
    if (autoplay) armStallWatch(n);
    if (autoplay) await P.audio.play();
    if (!quiet) api.report('start', P.cur, 0);
  } catch (e) {
    if (n !== P.seq) return;
    if (RCK.el && !RCK.el.paused && P.audio.paused) RCK.el.pause();
    updatePlayState();
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
    if (localFailed(n) || fallbackMp3(n)) return;
    playFailed(n);
    return;
  }
  loadPeaks(P.cur);
}
// play() no termina mientras el audio no empieza: si se atora, se avisa en vez de quedarse en silencio.
function armStallWatch(n) {
  clearTimeout(P.stallT);
  if (api.kind !== 'jellyfin' || (P.cur && DL.localUrl(P.cur.id))) return;
  P.stallT = setTimeout(() => {
    if (n !== P.seq || !P.cur || P.audio.readyState >= 3 || P.audio.currentTime > 0.5) return;
    const v6 = api.base.includes('[');
    toast(tx('«{0}» está tardando en empezar.{1} Revisa Ajustes → Probar conexión.', [P.cur.name, v6 ? tx(' Con servidores IPv6 suele ser un problema de la red.') : '']), 8000);
  }, 10000);
}
/* Calidad «Original»: algunos archivos llegan en formatos que este reproductor no arranca o arranca muy lento
   (M4A con el índice al final, ALAC…). Si no empieza en unos segundos o el reproductor lo rechaza, se pide en
   MP3 320 kbps y se recuerda para la próxima vez. Las canciones que sí funcionan siguen en calidad original. */
const MP3 = {
  ids: new Set(store.get('mp3ids', [])),
  add(id) { this.ids.add(id); store.set('mp3ids', [...this.ids].slice(-3000)); }
};
// La copia descargada no se pudo reproducir (p. ej. un formato que este reproductor no abre):
// suena desde el servidor en MP3 y se vuelve a descargar en MP3.
function localFailed(n) {
  const t = P.cur;
  if (!t || n !== P.seq || P.localFailSeq === n || !DL.isLocal(P.srcBase) || api.kind !== 'jellyfin') return false;
  P.localFailSeq = n;
  if (PF.isUrl(P.srcBase)) { try { NanuqAndroid.pfBroken(t.id); } catch { } setSrc(api.streamUrl(t, +Settings.quality >= 1e7 && MP3.ids.has(t.id) ? 320000 : Settings.quality)); P.audio.play().catch(() => { }); return true; } // la guardada por adelantado: sin aviso
  const e = DL.get(t.id);
  setSrc(api.streamUrl(t, 320000));
  P.audio.play().catch(() => { });
  if (e) { DL.remove(t.id); setTimeout(() => DL.add(t, !!e.auto), 300); }
  toast(tx('La copia descargada de «') + t.name + tx('» no se pudo reproducir: suena desde el servidor y se volverá a descargar en MP3.'), 5500);
  return true;
}
function canFallback(n) {
  return n === P.seq && !!P.cur && api.kind === 'jellyfin' && +Settings.quality >= 1e7 && P.fbSeq !== n && !MP3.ids.has(P.cur.id) && !DL.localUrl(P.cur.id);
}
function fallbackMp3(n) {
  if (!canFallback(n)) return false;
  P.fbSeq = n; clearTimeout(P.fbT); MP3.add(P.cur.id);
  const t = P.cur;
  setSrc(api.streamUrl(t, 320000));
  armStallWatch(n);
  P.audio.play().then(() => { if (n === P.seq) api.report('start', t, 0); }).catch(() => { });
  if (!fallbackMp3.told) { fallbackMp3.told = true; toast('«' + t.name + tx('» no arrancaba en calidad original; se pidió en MP3 320 kbps.'), 4500); }
  return true;
}
function armFallback(n) {
  clearTimeout(P.fbT);
  if (!canFallback(n)) return;
  P.fbT = setTimeout(() => { if (n === P.seq && P.audio.readyState < 3 && P.audio.currentTime < 0.3) fallbackMp3(n); }, 6000);
}
let failSeq = -1;
async function playFailed(n) {
  if (failSeq === n || n !== P.seq || !P.cur) return;
  failSeq = n;
  const t = P.cur, url = P.audio.currentSrc || P.audio.src;
  let why = '';
  if (api.kind === 'jellyfin' && url) {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-1' } });
      if (r.status === 401 || r.status === 403) why = tx('el servidor rechazó la autorización del streaming (') + r.status + tx('). Cierra sesión y vuelve a entrar.');
      else if (r.status === 404) why = tx('el servidor no encontró el archivo (404).');
      else if (r.status >= 500) why = tx('el servidor falló al preparar el audio (') + r.status + tx('). Revisa que ffmpeg funcione en Jellyfin.');
      else if (r.ok) why = tx('el navegador no puede decodificar este formato. Prueba con 320 kbps en Ajustes para recibir MP3.');
      else why = 'error ' + r.status + '.';
      try { r.body && r.body.cancel(); } catch { }
    } catch { why = tx('no hubo respuesta del servidor.'); }
  }
  if (n !== P.seq) return;
  toast(tx('No se pudo reproducir «') + t.name + '»' + (why ? ': ' + why : ''), 6000);
}
// El audio falló (se cayó la red a media canción): ese <audio> ya no vuelve a pedir nada aunque le des ▶. Se pide de
// nuevo la misma canción desde el segundo en que iba.
function audioDead() { return !!P.audio.getAttribute('src') && (!!P.audio.error || P.audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE); }
function replayHere(autoplay = true) {
  if (!P.cur) return;
  const sec = ptime(); P.resume = sec > 1 ? { qid: P.cur.qid, sec } : null; P.netLost = false;
  playIndex(P.i, autoplay, true);
}
// Desvanecer al pausar y al reanudar: el volumen baja (0.3 s) antes de pausar y sube (0.4 s) al reanudar. Si la app no
// está a la vista (pantalla apagada, ventana oculta) los cuadros de animación se detienen: ahí se pausa al instante.
const FADE = { raf: 0, t: 0, on: false, base: 1, run: 0 };
function fadeStop() { cancelAnimationFrame(FADE.raf); clearTimeout(FADE.t); FADE.on = false; FADE.run++; }
function fadeTo(to, ms, done) {
  fadeStop(); const run = FADE.run, from = P.audio.volume, t0 = performance.now();
  let fin = false; const end = () => { if (fin || run !== FADE.run) return; fin = true; FADE.on = false; P.audio.volume = to; if (done) done(); };
  if (document.hidden || ms <= 0 || P.audio.muted || !Settings.fade) { end(); return; }
  FADE.on = true;
  const step = () => { if (run !== FADE.run) return; const k = Math.min(1, (performance.now() - t0) / ms); P.audio.volume = from + (to - from) * k; if (k < 1) FADE.raf = requestAnimationFrame(step); else end(); };
  FADE.raf = requestAnimationFrame(step);
  FADE.t = setTimeout(end, ms + 300); // por si los cuadros de animación se frenan a medio camino
}
// El volumen al que se vuelve tras desvanecer: SIEMPRE el que elegiste (y, si el DJ está hablando, el bajado de su voz).
// Antes se tomaba el volumen de ese instante: con dos «play» seguidos (p. ej. tras la pausa que manda una extensión de GNOME
// o los controles del sistema), el segundo leía el 0 del desvanecido y la canción quedaba sonando muda hasta reiniciar.
const userVol = () => DJ.duckU ? Settings.volume * 0.3 : Settings.volume;
function pauseSoft() {
  if (P.audio.paused) return;
  const base = userVol(); FADE.base = base;
  fadeTo(0, 300, () => { P.pause(); P.audio.volume = base; });
}
function playSoft() {
  // Después de una pausa que no hizo Nanuq, la salida de audio puede haber quedado muerta: se vuelve a cargar la canción.
  if (P.extPause && P.extPause.seq === P.seq && P.cur && !RC.remote) { P.extPause = null; replayHere(); return; }
  const base = userVol(); FADE.base = base;
  if (Settings.fade && !document.hidden && !P.audio.muted) { fadeStop(); P.audio.volume = 0; }
  P.audio.play().then(() => fadeTo(base, 400)).catch(() => { P.audio.volume = base; });
}
// Fiesta abierta en esta computadora y sonando (o en pausa) su canción: el play, siguiente, anterior, la barra espaciadora,
// el volumen y los controles del sistema manejan la fiesta, no tu cola. Si pones tu propia música, vuelven a tu cola.
const partyNow = () => typeof PH !== 'undefined' && PH.active();
// Fiesta abierta en la computadora: tu música está detenida y nada fuera de la fiesta la puede volver a poner (ni los
// controles del sistema, ni otro dispositivo, ni el DJ) hasta que la cierres.
const partyHostOpen = () => document.body.classList.contains('party-host');
function toggle() {
  if (partyNow()) { PH.toggle(); return; }
  if (partyHostOpen()) { if (typeof PH !== 'undefined' && PH.cur) PH.toggle(); return; }
  if (RC.remote) { RC.cmd('PlayPause'); return; }
  if (!P.cur) { if (P.queue.length) playIndex(0); return; }
  if (!P.audio.src) { playIndex(P.i); return; }
  if (audioDead()) { replayHere(); return; }
  if (P.audio.paused) playSoft(); else pauseSoft();
}
function next(auto) {
  if (!auto && partyNow()) { PH.done(); return; }
  if (partyHostOpen()) { if (!auto && PH.cur) PH.done(); return; }
  if (RC.remote) { if (!auto) RC.cmd('NextTrack'); return; }
  if (!P.queue.length) return;
  if (auto && SY.on) { toast(tx('Canción terminada. Revisa tus marcas y pulsa Guardar.'), 4000); updatePlayState(); return; }
  if (auto && P.mode === 'one') { seekTo(0); P.audio.play().catch(() => { }); return; }
  if (P.i < P.queue.length - 1) playIndex(P.i + 1);
  else if (P.mode === 'all') playIndex(0);
  else if (!auto) playIndex(0, false);
  else { api.report('stop', P.cur, ptime()); playIndex(0, false, true); } // fin de la cola: la primera canción, en pausa (los controles siguen)
}
function prev() { if (partyNow() || partyHostOpen()) { if (PH.cur) PH.audio.currentTime = 0; return; } if (RC.remote) { RC.cmd('PreviousTrack'); return; } if (ptime() > 3 || P.i <= 0) { seekTo(0); } else playIndex(P.i - 1); }
function seekFrac(f, drag = false) { const d = pdur(); if (!d) return; seekTo(f * d, drag); }
function removeAt(i) {
  if (RC.remote) { const q = P.queue.filter((_, k) => k !== i); if (!q.length) { RC.cmd('Stop'); return; } const ni = i < P.i ? P.i - 1 : i === P.i ? Math.min(i, q.length - 1) : P.i; RC.playQueue(q, ni, i === P.i ? 0 : RC.pos()); return; }
  if (i === P.i) { P.queue.splice(i, 1); if (P.queue.length) playIndex(Math.min(i, P.queue.length - 1), !P.audio.paused); else clearQueue(); return; }
  P.queue.splice(i, 1); if (i < P.i) P.i--; saveQueue(); renderQueueAll();
}
function clearQueue() { if (RC.remote) { RC.cmd('Stop'); return; } QPOS.clear(); P.resume = null; DJ.stop(true); sessionHold('off'); if (P.cur) api.report('stop', P.cur, ptime()); P.pause(); P.audio.removeAttribute('src'); P.audio.load(); P.queue = []; P.i = -1; P.cur = null; saveQueue(); updateNow(); renderQueueAll(); markCurrent(); }
function shuffleQueue() {
  if (RC.remote) { RC.general('SetShuffleQueue', { ShuffleMode: 'Shuffle' }); toast(tx('Cola mezclada')); return; }
  if (P.queue.length < 2) return;
  const c = P.queue[P.i]; const rest = P.queue.filter((_, k) => k !== P.i);
  for (let k = rest.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1));[rest[k], rest[j]] = [rest[j], rest[k]]; }
  P.queue = c ? [c, ...rest] : rest; P.i = c ? 0 : -1; saveQueue(); renderQueueAll(); toast(tx('Cola mezclada'));
}
const MODES = { once: [tx('Reproducir una vez'), 'once'], all: [tx('Repetir todo'), 'repeat'], one: [tx('Repetir una'), 'repeat1'] };
function setMode(m) {
  if (RC.remote) { P.mode = m; renderQueueAll(); updateModeBtn(); RC.general('SetRepeatMode', { RepeatMode: REPEAT[m] }); return; }
  P.mode = m; store.set('mode', m); renderQueueAll(); updateModeBtn(); RC.reportSoon();
}
function updateModeBtn() { const b = $('#sMode'); b.innerHTML = ic(MODES[P.mode][1]); b.classList.toggle('on', P.mode !== 'once'); b.title = MODES[P.mode][0]; }

async function loadPeaks(t) {
  if (!t || P.peaks.has(t.id)) { drawWaves(); return; }
  if (api.kind !== 'demo' && !Settings.wave) { drawWaves(); return; }
  P.peaks.set(t.id, null);
  try { const p = await api.peaks(t); P.peaks.set(t.id, p); if (P.peaks.size > 60) P.peaks.delete(P.peaks.keys().next().value); }
  catch { P.peaks.delete(t.id); }
  drawWaves();
}
let _css = {};
function cssVar(n) { if (!(n in _css)) _css[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return _css[n]; }
function drawWaves() {
  const d = pdur(), pt = P.dragSec != null && !RC.remote ? P.dragSec : ptime(); // mientras se arrastra, la barra sigue al dedo
  const f = d ? Math.min(1, pt / d) : 0;
  const peaks = P.cur ? P.peaks.get(P.cur.id) : null;
  const a = cssVar('--accent'), w = cssVar('--wave');
  for (const c of $$('[data-seek] canvas')) {
    const r = c.getBoundingClientRect(); if (!r.width) continue;
    const dpr = devicePixelRatio || 1, W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
    const px = f * W;
    if (peaks) {
      const bw = Math.max(2, Math.round(2 * dpr)), gap = Math.max(1, Math.round(dpr)), n = Math.floor(W / (bw + gap));
      for (let k = 0; k < n; k++) {
        const v = peaks[Math.floor(k / n * peaks.length)] || 0, h = Math.max(dpr * 1.5, v * H * 0.92), x = k * (bw + gap);
        g.fillStyle = x + bw / 2 <= px ? a : w; g.fillRect(x, (H - h) / 2, bw, h);
      }
    } else {
      const h = Math.round(4 * dpr), y = (H - h) / 2, rr = h / 2;
      g.fillStyle = w; roundRect(g, 0, y, W, h, rr); g.fill();
      if (px > 0) { g.fillStyle = a; roundRect(g, 0, y, Math.max(h, px), h, rr); g.fill(); }
      if (P.cur) { g.fillStyle = a; g.beginPath(); g.arc(Math.max(6 * dpr, Math.min(W - 6 * dpr, px)), H / 2, 6 * dpr, 0, 7); g.fill(); }
    }
  }
  $('#mBar').style.width = (f * 100) + '%';
  const ct = fmt(pt), dt = fmt(d);
  $('#pCur').textContent = ct; $('#pDur').textContent = dt; $('#sCur').textContent = ct; $('#sDur').textContent = dt;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

function updateNow() {
  const t = P.cur;
  const cv = t ? coverHTML(t, 300) : coverHTML(null);
  $('#pCover').outerHTML = cv.replace('class="cover ', 'id="pCover" class="cover ');
  $('#mCover').outerHTML = cv.replace('class="cover ', 'id="mCover" class="cover ');
  $('#sCover').outerHTML = (t ? coverHTML(t, 800) : coverHTML(null)).replace('class="cover ', 'id="sCover" class="cover ');
  const u = t && api.img(t, 300);
  $('#sBg').innerHTML = u ? `<img src="${esc(u)}" alt="">` : '';
  // Álbum y artista como enlaces (el álbum según las etiquetas: se abre por la canción, ver V.album).
  $('#pAlbum').innerHTML = !t ? tx('Nada en reproducción') : t.album ? `<a href="#" data-act="open" data-r="album" data-id="${esc(t.albumId || '')}" data-tid="${esc(t.id)}" title="${tx('Ir al álbum')}">${esc(t.album)}</a>` : esc(t.name);
  $('#pArtist').innerHTML = !t ? '' : (t.artistId || t.artist) ? `<a href="#" data-act="open" data-r="artist" data-id="${esc(t.artistId || '')}" data-name="${esc(t.artist || t.trackArtist || '')}" title="${tx('Ir al artista')}">${esc(t.artist || t.trackArtist)}</a>` : esc(t.trackArtist || '');
  $('#pYear').textContent = t && t.year ? t.year : '';
  $('#pTitle').textContent = t ? [t.trackArtist || t.artist, t.name].filter(Boolean).join(' - ') : ' ';
  $('#mTitle').textContent = t ? t.name : tx('Nada en reproducción');
  $('#mArtist').textContent = t ? [t.trackArtist || t.artist, t.album].filter(Boolean).join(' · ') : tx('Elige un álbum para empezar');
  $('#sTitle').textContent = t ? t.name : '—';
  $('#sSub').innerHTML = t ? `${t.artistId ? `<a href="#" data-act="open" data-r="artist" data-id="${esc(t.artistId)}" data-name="${esc(t.artist || t.trackArtist)}">${esc(t.trackArtist || t.artist)}</a>` : esc(t.trackArtist || t.artist || '')}${t.album ? ` · <a href="#" data-act="open" data-r="album" data-id="${esc(t.albumId || '')}" data-tid="${esc(t.id)}">${esc(t.album)}</a>` : ''}` : '';
  document.title = t ? `${t.name} · ${t.trackArtist || t.artist} — Nanuq` : 'Nanuq';
  if ('mediaSession' in navigator && !partyNow() && !partyHostOpen()) { // con la fiesta abierta, los controles del sistema son de la fiesta (o no hay)
    try {
      navigator.mediaSession.metadata = t ? new MediaMetadata({ title: t.name, artist: t.trackArtist || t.artist || '', album: t.album || '', artwork: u ? [96, 256, 512].map(s => ({ src: api.img(t, s), sizes: s + 'x' + s, type: 'image/jpeg' })) : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] }) : null;
    } catch { }
  }
  updatePlayState(); drawWaves();
  updateFavBtn(); updateDlBtn(); refreshFav(t); RC.decorate();
  if (SY.on && P.cur !== SY.t) syncCancel(tx('Sincronización cancelada: cambió la canción'));
  if (LY.mode) renderLyrics();
  refreshLyricsButtons();
  DJ.scene();
}
function updatePlayState() {
  const party = partyNow(), playing = party ? !PH.audio.paused : RC.remote ? !RC.paused : !P.audio.paused && !!P.audio.src;
  $$('use.pp').forEach(u => u.setAttribute('href', playing ? '#i-pause' : '#i-play'));
  DJ.bears(playing);
  if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = party ? (playing ? 'playing' : 'paused') : (!P.cur || partyHostOpen()) ? 'none' : (playing ? 'playing' : 'paused'); } catch { }
  // Como control remoto aquí no suena nada, pero los controles del sistema (barra de tareas, MPRIS, teclas
  // multimedia) deben seguir: manejan lo que suena en el otro dispositivo.
  if (RC.remote) rcKeep(playing);
  DISC.update();
}
// «Escuchando Nanuq» en tu perfil de Discord (solo en las apps de escritorio, si lo activas en Ajustes). Se avisa al
// cambiar de canción, pausar, reanudar o saltar (no en cada segundo: Discord admite pocas actualizaciones). En pausa se
// quita. Funciona también mientras controlas otro dispositivo (muestra lo que suena allá).
const DISC = {
  t: 0, key: '',
  can: () => !!(window.nanuqDesktop && window.nanuqDesktop.discord),
  update() { if (!this.can()) return; clearTimeout(this.t); this.t = setTimeout(() => this.send(), 1200); },
  send() {
    const t = P.cur, playing = RC.remote ? !RC.paused : !P.audio.paused && !!P.audio.getAttribute('src');
    let a = null;
    if (Settings.discord && api && t && playing) {
      // Portada: la de tu servidor, solo si Discord puede llegar a él (https y dirección de internet). Si no, el logo.
      const pos = ptime(), mine = Settings.discordCover && api.kind === 'jellyfin' && /^https:/.test(api.base) && cleartextRisk(api.base.replace(/^https:/, 'http:')) ? api.img(t, 512, true) || '' : '';
      a = { title: t.name, artist: t.trackArtist || t.artist || '', album: t.album || '', dur: pdur(), pos, cover: mine };
    }
    // Misma canción y mismo punto de partida (un salto lo cambia): no se repite.
    const key = a ? [a.title, a.artist, a.cover, Math.round((Date.now() - a.pos * 1000) / 3000)].join('|') : '';
    if (key === this.key) return; this.key = key;
    window.nanuqDesktop.discord(a).catch(() => { });
  }
};
// Ajustes: qué pasa con Discord (lo que respondió, o por qué no se pudo). Sin esto, si Discord no mostraba nada no había
// forma de saber si Nanuq no lo encontró, si Windows no dejó conectarse o si Discord rechazó la actividad.
async function dcStatusPaint() {
  const e = $('#dcSt'); if (!e || !DISC.can() || !Settings.discord) return;
  let s; try { s = await window.nanuqDesktop.discord('status'); } catch { return; }
  if (!e.isConnected || !s || typeof s !== 'object') return;
  const win = s.os === 'win32', msg = String(s.msg || '').slice(0, 200), user = String(s.user || '').slice(0, 40);
  const T = {
    off: tx('Se conecta con Discord en cuanto suene una canción.'),
    connecting: tx('Buscando Discord…'),
    nodiscord: tx('No encontré Discord abierto en esta computadora. Abre la app de escritorio de Discord (la página web no sirve): Nanuq lo busca cada 10 s.') + (win ? '' : tx(' Si usas Discord en Flatpak o Snap, ábrelo antes que Nanuq.')),
    denied: tx('Discord está abierto, pero el sistema no dejó conectarse (') + msg + ').' + (win ? tx(' Pasa si Discord se abrió como administrador: ciérralo y ábrelo normal.') : ''),
    ok: tx('Conectado con Discord') + (user ? ' (' + user + ')' : '') + tx('. Si no aparece en tu perfil, en Discord revisa Ajustes → Privacidad de actividad → «Compartir tu actividad».'),
    error: tx('Discord rechazó la actividad: ') + msg,
    closed: tx('Discord cerró la conexión: ') + msg
  };
  e.textContent = T[s.st] || '';
  e.className = 'dcst' + (s.st === 'ok' ? ' ok' : ['nodiscord', 'denied', 'error', 'closed'].includes(s.st) ? ' warn' : '');
}
// Chromium solo muestra los controles del sistema mientras la página tiene un audio activo: con el control remoto
// suena un audio en silencio (no gasta datos) que sigue el estado del otro dispositivo. Los botones ya mandan
// las órdenes allá (RC.cmd).
const RCK = { el: null, posAt: 0 };
function rcKeep(on) {
  if (!('mediaSession' in navigator)) return;
  if (!RCK.el) {
    if (!on) return;
    const n = 8000 * 12; // 12 s de silencio a 8 kHz
    RCK.el = new Audio(URL.createObjectURL(wav({ sampleRate: 8000, getChannelData: () => new Float32Array(n) })));
    RCK.el.loop = true; RCK.el.preload = 'auto';
  }
  if (on) { if (RCK.el.paused) RCK.el.play().catch(() => { }); }
  else if (!RCK.el.paused) RCK.el.pause();
}
// Escritorio: Chromium quita los controles del sistema (MPRIS / barra de tareas) cuando no hay ningún audio activo:
// mientras carga la siguiente canción y al terminar la cola. El mismo audio en silencio de rcKeep los sostiene: suena
// mientras carga y se queda en pausa (pero presente) al terminar la cola. En Android la notificación es nativa.
function sessionHold(state) { // 'loading' | 'parked' | 'off'
  if (!('mediaSession' in navigator) || window.NanuqAndroid || RC.remote) return;
  if (state === 'off') { rcKeepOff(); return; }
  rcKeep(true);
  if (state === 'parked') { const el = RCK.el, done = () => { el.removeEventListener('playing', done); if (P.audio.paused) el.pause(); }; el.addEventListener('playing', done); if (!el.paused && el.readyState >= 3) done(); }
}
function rcKeepOff() { if (RCK.el) { RCK.el.pause(); try { RCK.el.currentTime = 0; } catch { } } }
let rafPending = false;
P.audio.addEventListener('timeupdate', () => {
  syncLyrics();
  // Cuenta como escuchada al pasar la mitad (o 4 minutos), una vez por reproducción.
  const dd = pdur();
  if (P.cur && P.counted !== P.seq && dd && ptime() >= Math.min(dd * 0.5, 240)) { P.counted = P.seq; Plays.add(P.cur); }
  if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; drawWaves(); }); }
  QPOS.save();
  const now = Date.now(); if (now - P.lastReport > (RC.on() && RC.peers.length ? 4000 : 10000)) { P.lastReport = now; if (api) api.report('progress', P.cur, ptime(), P.audio.paused); }
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && pdur()) { try { const dd = pdur(); navigator.mediaSession.setPositionState({ duration: dd, position: Math.min(ptime(), dd), playbackRate: 1 }); } catch { } }
});
P.audio.addEventListener('play', () => { updatePlayState(); syncLyrics(true); clearTimeout(BEAR.pauseT); if (BEAR.playing && P.danced !== P.seq) bearDance(); bearMood(true); P.danced = P.seq; if (P.audio.readyState < 3) armFallback(P.seq); RC.reportSoon(300); });
// Cuando otro dispositivo pasa la música a este: empezar en el mismo segundo.
P.audio.addEventListener('canplay', () => { const ps = P.pendingSeek; if (ps && ps.seq === P.seq) { P.pendingSeek = null; seekTo(ps.sec); } });
P.audio.addEventListener('playing', () => { setTimeout(() => { if (!P.audio.paused && !FADE.on && P.audio.volume < 0.01 && userVol() > 0.01) P.audio.volume = userVol(); }, 900); });
P.audio.addEventListener('playing', () => { clearTimeout(P.fbT); if (!RC.remote && RCK.el && !RCK.el.paused) RCK.el.pause(); }); // ya suena la canción: el silencio se pausa
P.audio.addEventListener('pause', () => {
  // ¿La pidió Nanuq? Si no (otra app tomó el audio), se recuerda para reanudar con la canción recargada.
  if (!P.audio.ended && !RC.remote && P.audio.getAttribute('src') && Date.now() - (P.ownPauseAt || 0) > 1500) P.extPause = { seq: P.seq, at: Date.now() };
  QPOS.save(true);
  updatePlayState(); if (api) api.report('progress', P.cur, ptime(), true); // (sin sesión todavía: p. ej. la fiesta detiene la música antes de entrar)
  // Entre canciones también hay una pausa breve: solo se pone triste si la música de verdad se detuvo.
  clearTimeout(BEAR.pauseT); BEAR.pauseT = setTimeout(() => { if (P.audio.paused && !RC.remote) bearMood(false); }, 900);
});
P.audio.addEventListener('ended', () => next(true));
P.audio.addEventListener('play', () => { if (typeof PH !== 'undefined') PH.yieldTo(); }); // tu música pausa la de la fiesta
P.audio.addEventListener('loadedmetadata', drawWaves);
P.audio.addEventListener('seeked', () => { LY.hold = 0; syncLyrics(true); DISC.update(); });
P.audio.addEventListener('error', () => {
  if (!P.audio.getAttribute('src') || !P.cur) return;
  // Error de red: se recuerda para reintentar sola en cuanto vuelva la conexión (evento «online» o al volver a la app).
  if (P.audio.error && P.audio.error.code === MediaError.MEDIA_ERR_NETWORK) P.netLost = { seq: P.seq, at: Date.now() };
  if (localFailed(P.seq) || fallbackMp3(P.seq)) return;
  updatePlayState(); playFailed(P.seq);
});
// Audio atorado a media canción: si la red se cae con el búfer vacío, el navegador NO da error: deja el <audio>
// «esperando» para siempre y no reintenta aunque vuelva la red. Si lleva 12 s sin avanzar (o vuelve la red mientras
// está así), se pide otra vez desde ese segundo. Solo a media canción (t > 0.5): un arranque lento no se reinicia.
const STALL = { pos: -1, last: 0, retryAt: 0 };
function stallCheck(netIsBack = false) {
  if (RC.remote || !P.cur || P.audio.paused || !P.audio.getAttribute('src')) { STALL.pos = -1; return; }
  const t = P.audio.currentTime, now = Date.now();
  if (t !== STALL.pos) { STALL.pos = t; STALL.last = now; if (!netIsBack) return; }
  const stuck = now - STALL.last > (netIsBack ? 2500 : 12000);
  if (stuck && t > 0.5 && P.audio.readyState < 3 && now > STALL.retryAt && navigator.onLine !== false) { STALL.retryAt = now + 15000; STALL.last = now; replayHere(); }
}
setInterval(stallCheck, 4000);
// Volvió la red: lo que se cortó se reanuda y el control remoto se reconecta sin esperar a su próximo intento.
function netBack() {
  if (P.netLost && P.netLost.seq === P.seq && Date.now() - P.netLost.at < 30 * 60 * 1000 && audioDead()) replayHere();
  else stallCheck(true);
  if (RC.on()) { if (!RC.ws) { clearTimeout(RC.wsTimer); RC.backoff = 0; RC.connect(); } RC.schedule(500); }
  REQ.schedule(1000);
}
addEventListener('online', netBack);
addEventListener('online', () => { if (typeof PG !== 'undefined') PG.wake(true); });
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession, h = (a, f) => { try { ms.setActionHandler(a, f); } catch { } };
  h('play', () => partyNow() ? (PH.audio.paused && PH.toggle()) : RC.remote ? RC.cmd('Unpause') : (P.audio.getAttribute('src') ? playSoft() : toggle())); h('pause', () => partyNow() ? (!PH.audio.paused && PH.toggle()) : RC.remote ? RC.cmd('Pause') : pauseSoft()); h('previoustrack', prev); h('nexttrack', () => next(false));
  h('seekto', e => { if (e.seekTime == null) return; if (partyNow()) PH.audio.currentTime = Math.max(0, e.seekTime); else seekTo(e.seekTime); });
  h('seekbackward', e => partyNow() ? (PH.audio.currentTime = Math.max(0, PH.audio.currentTime - (e.seekOffset || 10))) : seekTo(ptime() - (e.seekOffset || 10)));
  h('seekforward', e => partyNow() ? (PH.audio.currentTime += e.seekOffset || 10) : seekTo(ptime() + (e.seekOffset || 10)));
}

/* seek interaction */
document.addEventListener('pointerdown', e => {
  const s = e.target.closest('[data-seek]'); if (!s || !P.cur) return;
  e.preventDefault(); s.setPointerCapture(e.pointerId);
  const r = s.getBoundingClientRect(), f = x => Math.max(0, Math.min(1, (x - r.left) / r.width));
  let last = f(e.clientX), moved = false;
  seekFrac(last);
  const mv = ev => { last = f(ev.clientX); moved = true; seekFrac(last, true); };
  const up = () => { s.removeEventListener('pointermove', mv); s.removeEventListener('pointerup', up); s.removeEventListener('pointercancel', up); if (moved) seekFrac(last); };
  s.addEventListener('pointermove', mv); s.addEventListener('pointerup', up); s.addEventListener('pointercancel', up);
});
addEventListener('resize', () => requestAnimationFrame(drawWaves));

/* volume */
const vol = $('#vol');
function paintVol() { vol.style.setProperty('--p', (P.audio.muted ? 0 : P.audio.volume * 100) + '%'); $('#volIco').setAttribute('href', P.audio.muted || P.audio.volume === 0 ? '#i-mute' : '#i-vol'); }
vol.value = Settings.volume; paintVol();
vol.oninput = () => { fadeStop(); DJ.duckV = null; P.audio.volume = +vol.value; P.audio.muted = false; if (typeof PH !== 'undefined') { PH.audio.volume = +vol.value; PH.audio.muted = false; } Settings.set('volume', +vol.value); paintVol(); };

/* =========================================================
   Lyrics
   ========================================================= */
const LY = { cache: new Map(), pending: new Map(), seq: 0, mode: false, data: null, idx: -1, hold: 0, tid: null, times: null, fixed: false };
const lrcKey = id => 'lrc.' + id;
function lrcTime(t) { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0'); }
function parseLRC(text) {
  const out = []; let offset = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i); if (off) { offset = +off[1] / 1000; continue; }
    // Las marcas de tiempo van al principio de la línea (puede haber varias seguidas: la línea se repite).
    const lead = raw.match(/^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+)/);
    if (!lead) continue;
    const tags = [...lead[1].matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    const text = raw.slice(lead[0].length).trim();
    for (const m of tags) out.push({ t: Math.max(0, +m[1] * 60 + parseFloat(m[2].replace(':', '.')) - offset), text });
  }
  out.sort((x, y) => x.t - y.t);
  return out.length >= 2 ? { synced: true, lines: out } : null;
}
function toLRC(t, lines) {
  // Los datos de la canción y cada línea van en un solo renglón, sin corchetes ni marcas de tiempo metidas
  // (una línea con «[00:30.00]» adentro crearía otra línea en el archivo).
  const tag = v => String(v || '').replace(/[\r\n\[\]]/g, ' ').trim().slice(0, 200);
  const line = v => String(v || '').replace(/[\r\n]/g, ' ').replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();
  const head = [t.name && `[ti:${tag(t.name)}]`, (t.trackArtist || t.artist) && `[ar:${tag(t.trackArtist || t.artist)}]`, t.album && `[al:${tag(t.album)}]`, t.duration && `[length:${lrcTime(t.duration).slice(0, 5)}]`, '[by:Nanuq]'].filter(Boolean);
  return head.concat(lines.map(l => `[${lrcTime(l.t)}]${line(l.text)}`)).join('\n') + '\n';
}
// Letra escrita o pegada por el usuario: sin caracteres de control (salvo saltos de línea y tabuladores), con un
// tamaño razonable antes de guardarla en el teléfono o subirla a Jellyfin. Mostrarla siempre pasa por esc().
const LYR_MAX = 200000, LYR_LINES = 5000;
function cleanLyricsText(v) {
  v = String(v || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  // Sin etiquetas HTML: una letra no las necesita y otras apps de Jellyfin podrían mostrarlas sin escapar.
  // («<3» o «a < b» no son etiquetas y se quedan.)
  v = v.replace(/<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/gi, '');
  if (v.length > LYR_MAX) throw new Error(tx('La letra es demasiado larga (máximo ') + (LYR_MAX / 1000) + tx(' mil caracteres).'));
  if (v.split('\n').length > LYR_LINES) throw new Error(tx('La letra tiene demasiadas líneas (máximo ') + LYR_LINES + ').');
  return v.trim();
}
const lyricsFromText = raw => parseLRC(raw) || normLyrics([{ Text: raw, Start: null }], null);
function localLyrics(t) {
  const raw = store.get(lrcKey(t.id), null); if (!raw) return null;
  const L = lyricsFromText(raw);
  if (L) L.local = true;
  return L;
}
// ¿Es la misma letra? Mismo tipo, mismas líneas y, si está sincronizada, los mismos tiempos
// (al volver a sincronizar, el texto no cambia: solo los tiempos).
function lyrSame(a, b) {
  if (!a || !b || !!a.synced !== !!b.synced) return false;
  const x = a.lines.filter(l => l.text), y = b.lines.filter(l => l.text);
  if (x.length !== y.length) return false;
  return !a.synced || x.every((l, i) => Math.abs(l.t - y[i].t) < 0.06);
}
// Recién guardada en Jellyfin: se muestra ya la que tenemos aquí, porque Jellyfin puede tardar unos segundos
// en servirla (o seguir dando la vieja). Se revisa varias veces hasta que la del servidor coincida.
function lyricsSaved(t, L) {
  if (!L) return;
  const tok = {}; LY.pending.set(t.id, { L, tok });
  LY.cache.set(t.id, Promise.resolve(L));
  const waits = [1500, 4000, 10000, 25000];
  const check = k => setTimeout(async () => {
    if (LY.pending.get(t.id)?.tok !== tok) return; // otra letra más nueva la reemplazó
    const S = await Promise.resolve(api.lyrics(t)).catch(() => null);
    if (LY.pending.get(t.id)?.tok !== tok) return;
    if (lyrSame(S, L)) { LY.pending.delete(t.id); LY.cache.set(t.id, Promise.resolve(S)); return; }
    if (k + 1 < waits.length) check(k + 1);
    // Si nunca coincide, se sigue mostrando la guardada durante esta sesión.
  }, waits[k]);
  check(0);
}
function getLyrics(t) {
  if (!t) return Promise.resolve(null);
  const loc = localLyrics(t); if (loc) return Promise.resolve(loc);
  const pend = LY.pending.get(t.id); if (pend) return Promise.resolve(pend.L);
  if (!api.lyrics) return Promise.resolve(null);
  if (!LY.cache.has(t.id)) { const p = Promise.resolve(api.lyrics(t)).catch(() => null); LY.cache.set(t.id, p); if (LY.cache.size > 80) LY.cache.delete(LY.cache.keys().next().value); }
  return LY.cache.get(t.id);
}
function setLyricsMode(on) {
  const sh = $('#sheet'), animate = sh.classList.contains('open') && !!on !== sh.classList.contains('lyrics') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && document.startViewTransition && !setLyricsMode.busy) {
    // Transición entre las dos vistas: la carátula se encoge o se mueve a su lugar y la letra entra deslizándose.
    setLyricsMode.busy = true; sh.classList.add('lyrvt'); // no «vt»: esa clase ya es la de los botones de vista (display:flex; gap)
    const vt = document.startViewTransition(() => applyLyricsMode(on));
    vt.finished.finally(() => { sh.classList.remove('lyrvt'); setLyricsMode.busy = false; });
    return;
  }
  if (animate) { sh.classList.remove('lyr-in', 'lyr-out'); void sh.offsetWidth; sh.classList.add(on ? 'lyr-in' : 'lyr-out'); setTimeout(() => sh.classList.remove('lyr-in', 'lyr-out'), 500); }
  applyLyricsMode(on);
}
// Cola dentro del reproductor maximizado: la portada se cambia por la lista de lo que sigue, como con las letras.
function setQueueMode(on) {
  const sh = $('#sheet'), animate = sh.classList.contains('open') && !!on !== sh.classList.contains('qmode') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply = () => { if (on && LY.mode) applyLyricsMode(false); sh.classList.toggle('qmode', !!on); $('#sQBtn').classList.toggle('on', !!on); if (on) renderSheetQueue(true); };
  if (animate && document.startViewTransition && !setLyricsMode.busy) {
    setLyricsMode.busy = true; sh.classList.add('lyrvt');
    const vt = document.startViewTransition(apply);
    vt.finished.finally(() => { sh.classList.remove('lyrvt'); setLyricsMode.busy = false; });
    return;
  }
  apply();
}
function renderSheetQueue(scroll) {
  const box = $('#sQueue'); if (!box || !$('#sheet').classList.contains('qmode')) return;
  const row = (t, i) => { const u = api && api.img(t, 120); return `<div class="qr sqr${i === P.i ? ' cur' : ''}" data-act="qplay" data-i="${i}"><span class="cv">${u ? `<img src="${esc(u)}" alt="" loading="lazy" data-rm>` : ''}</span><span class="tt"><b>${esc(t.name)}</b><small>${esc(t.trackArtist || t.artist || '')}</small></span><span class="du">${t.duration ? fmt(t.duration) : ''}</span><span class="dh" role="button" aria-label="${tx('Arrastrar para mover')}" title="${tx('Arrastra para moverla')}">${ic('grip')}</span></div>`; };
  const nextUp = P.queue.slice(P.i + 1, P.i + 101);
  box.innerHTML = (P.cur ? `<div class="sqh">${tx('Sonando')}</div>${row(P.cur, P.i)}` : '')
    + (nextUp.length ? `<div class="sqh">${tx('A continuación')}</div>${nextUp.map((t, k) => row(t, P.i + 1 + k)).join('')}` : `<div class="none">${tx('No hay más canciones en la cola.')}</div>`)
    + (P.queue.length - P.i - 1 > 100 ? `<div class="sqh">y ${P.queue.length - P.i - 101} ${tx('más')}</div>` : '');
  if (scroll) box.scrollTop = 0;
}
function applyLyricsMode(on) {
  if (on && $('#sheet').classList.contains('qmode')) { $('#sheet').classList.remove('qmode'); $('#sQBtn').classList.remove('on'); }
  LY.mode = on;
  $('#sheet').classList.toggle('lyrics', on);
  $('#sLyrBtn').classList.toggle('on', on);
  $$('.lyrbtn').forEach(b => b.classList.toggle('on', on && $('#sheet').classList.contains('open')));
  if (on) renderLyrics(); else { LY.tid = null; if (SY.on) syncCancel(); }
}
function reloadLyrics() { if (P.cur && !LY.pending.has(P.cur.id)) LY.cache.delete(P.cur.id); LY.tid = null; if (LY.mode) renderLyrics(); refreshLyricsButtons(); }
async function renderLyrics() {
  const t = P.cur, box = $('#sLyr');
  if (!t) { box.innerHTML = ''; return; }
  if (LY.tid === t.id) { syncLyrics(true); return; }
  LY.tid = t.id; LY.data = null; LY.idx = -1; LY.times = null; LY.fixed = false;
  const seq = ++LY.seq; // una carga anterior que llegue tarde no debe pisar la letra nueva
  box.className = 'lyr center'; box.innerHTML = loading();
  const L = await getLyrics(t);
  if (P.cur !== t || !LY.mode || seq !== LY.seq) return;
  LY.data = L;
  if (!L) {
    box.className = 'lyr center';
    box.innerHTML = `<div class="none">${ic('lyrics')}<b>${tx('No hay letra para esta canción')}</b><span>${tx('Jellyfin usa archivos .lrc junto a tus canciones o el plugin LrcLib. También puedes buscarla o pegarla tú y sincronizarla a mano.')}</span><div class="btns">${api.searchLyrics ? `<button class="btn pri" data-act="lyr-search">${ic('search')}${tx('Buscar letra')}</button>` : ''}<button class="btn" data-act="lyr-paste">${ic('paste')}${tx('Pegar letra')}</button></div></div>`;
    return;
  }
  LY.times = L.synced ? L.lines.map(l => l.t) : estimateTimes(L.lines, t.duration || P.audio.duration);
  const tag = !L.synced ? `<div class="lyr-tag">${tx('Tiempos aproximados')}<button data-act="sync-start">${tx('Sincronizar')}</button></div>`
    : L.local ? `<div class="lyr-tag">${tx('Sincronizada en este teléfono')}<button data-act="sync-start">${tx('Ajustar')}</button></div>` : '';
  box.className = 'lyr' + (L.synced ? '' : ' approx');
  box.innerHTML = tag + L.lines.map((l, i) => `<p data-li="${i}"${l.text ? '' : ' class="gap"'}>${l.text ? esc(l.text) : '♪ ♪ ♪'}</p>`).join('');
  box.scrollTop = 0; LY.hold = 0;
  syncLyrics(true);
}
// Letra sin tiempos: reparte las líneas a lo largo de la canción según su largo (deja intro y final).
function estimateTimes(lines, dur) {
  if (!dur || !isFinite(dur)) dur = 180;
  const w = lines.map(l => l.text ? Math.max(10, l.text.length) : 6), sum = w.reduce((a, b) => a + b, 0) || 1;
  const start = dur * 0.07, span = dur * 0.86;
  let acc = 0;
  return w.map(x => { const t = start + span * acc / sum; acc += x; return t; });
}
function syncLyrics(force) {
  if (SY.on) { syncEditorTick(); return; }
  const L = LY.data, T = LY.times;
  if (!LY.mode || !L || !T || LY.tid !== P.cur?.id) return;
  if (!L.synced && P.audio.duration && isFinite(P.audio.duration) && Math.abs((P.cur.duration || 0) - P.audio.duration) > 2 && !LY.fixed) { LY.times = estimateTimes(L.lines, P.audio.duration); LY.fixed = true; return syncLyrics(true); }
  const now = ptime() + (L.synced ? 0.25 : 0);
  let i = -1;
  for (let k = 0; k < T.length; k++) { if (T[k] <= now) i = k; else break; }
  if (i === LY.idx && !force) return;
  LY.idx = i;
  const box = $('#sLyr'), ps = box.querySelectorAll('p');
  ps.forEach((p, k) => { p.classList.toggle('on', k === i); p.classList.toggle('past', k < i); });
  if (Date.now() < LY.hold) return;
  const el = ps[Math.max(0, i)];
  if (el) requestAnimationFrame(() => box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.34, behavior: force ? 'auto' : 'smooth' }));
}
(() => {
  const box = $('#sLyr');
  const hold = () => { LY.hold = Date.now() + 3500; };
  box.addEventListener('wheel', hold, { passive: true });
  box.addEventListener('touchmove', hold, { passive: true });
  box.addEventListener('click', e => {
    const p = e.target.closest('p[data-li]'); const L = LY.data;
    if (!p || !L || !L.synced) return;
    seekTo(L.lines[+p.dataset.li].t);
    if (P.audio.paused) P.audio.play().catch(() => { });
    LY.hold = 0; syncLyrics(true);
  });
  $('#sSync').addEventListener('click', e => {
    const p = e.target.closest('p[data-si]'); if (!p) return;
    const i = +p.dataset.si; SY.cur = i;
    const l = SY.lines[i];
    if (l.t != null) seekTo(l.t - 2);
    renderSync();
  });
})();
function refreshLyricsButtons() {
  const t = P.cur; if (!t) return;
  getLyrics(t).then(L => {
    if (P.cur !== t) return;
    // Sin letra, el botón invita a buscarla en vez de verse desactivado.
    const none = !L, b = $('#sLyrBtn');
    b.classList.toggle('find', none);
    b.querySelector('use').setAttribute('href', none ? '#i-search' : '#i-lyrics');
    b.querySelector('span').textContent = none ? tx('Buscar letra') : tx('Letra');
    $$('.lyrbtn').forEach(x => { x.classList.toggle('find', none); x.title = none ? tx('Buscar letra') : tx('Letra'); });
  });
}

/* ---------- Manual sync editor ---------- */
const SY = { on: false, lines: [], cur: 0, t: null, playIdx: -1 };
function syncStart(lines) {
  if (RC.remote) { toast(tx('Sincroniza la letra en el dispositivo que está sonando.'), 4000); return; }
  const t = P.cur; if (!t) return;
  const L = LY.data;
  const src = lines || (L && L.lines);
  if (!src || !src.length) { toast(tx('No hay letra para sincronizar. Pégala primero.')); return; }
  SY.on = true; SY.t = t; SY.playIdx = -1;
  SY.lines = src.map(l => ({ text: l.text, t: (!lines && L && L.synced) ? l.t : null }));
  SY.cur = SY.lines.findIndex(l => l.t == null); if (SY.cur < 0) SY.cur = 0;
  if (!$('#sheet').classList.contains('open')) openSheet(true);
  $('#sheet').classList.add('syncing');
  renderSync(true);
  requestAnimationFrame(drawWaves);
}
function syncEnd() {
  SY.on = false; $('#sheet').classList.remove('syncing');
  requestAnimationFrame(drawWaves);
}
function syncCancel(silent) { if (!SY.on) return; syncEnd(); LY.tid = null; if (LY.mode) renderLyrics(); if (silent) toast(silent); }
function renderSync(force) {
  const box = $('#sSync'), done = SY.lines.filter(l => l.t != null).length;
  box.innerHTML = `<div class="synchelp">${tx('Reproduce la canción y toca')} <b>${tx('Marcar')}</b> ${tx('justo cuando empiece la línea resaltada. Toca cualquier línea para elegirla o revisarla.')} <span class="muted">${done}/${SY.lines.length} ${tx('marcadas')}</span></div>`
    + SY.lines.map((l, i) => `<p data-si="${i}" class="${i === SY.cur ? 'tgt' : ''}${l.t != null ? ' done' : ''}${i === SY.playIdx ? ' play' : ''}"><span class="ts">${l.t != null ? lrcTime(l.t) : '––:––.––'}</span><span>${l.text ? esc(l.text) : '♪ ♪ ♪'}</span></p>`).join('');
  const el = box.querySelector('p.tgt') || box.querySelector('p:last-of-type');
  if (el) requestAnimationFrame(() => box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.38, behavior: force ? 'auto' : 'smooth' }));
}
function syncEditorTick() {
  const now = ptime(); let i = -1;
  SY.lines.forEach((l, k) => { if (l.t != null && l.t <= now) i = k; });
  if (i === SY.playIdx) return;
  SY.playIdx = i;
  $$('#sSync p').forEach((p, k) => p.classList.toggle('play', k === i));
}
function syncMark() {
  if (!SY.on) return;
  if (P.audio.paused) { P.audio.play().catch(() => { }); toast(tx('Reproduciendo. Toca Marcar cuando empiece la línea.')); return; }
  const i = SY.cur; if (i >= SY.lines.length) { toast(tx('Ya marcaste todas. Pulsa Guardar.')); return; }
  const now = Math.max(0, ptime() - 0.15); // compensa el tiempo de reacción
  let prevT = -1; for (let k = i - 1; k >= 0; k--) if (SY.lines[k].t != null) { prevT = SY.lines[k].t; break; }
  SY.lines[i].t = prevT >= 0 && now <= prevT ? prevT + 0.1 : now; // nunca antes que la línea anterior
  for (let k = i + 1; k < SY.lines.length; k++) if (SY.lines[k].t != null && SY.lines[k].t <= SY.lines[i].t) SY.lines[k].t = null;
  SY.cur = i + 1;
  if (navigator.vibrate) try { navigator.vibrate(12); } catch { }
  if (SY.cur >= SY.lines.length) toast(tx('¡Listo! Revisa y pulsa Guardar.'), 3500);
  renderSync();
}
function syncUndo() {
  if (!SY.on) return;
  const i = Math.max(0, SY.cur - 1);
  SY.lines[i].t = null; SY.cur = i;
  let prev = null; for (let k = i - 1; k >= 0; k--) if (SY.lines[k].t != null) { prev = SY.lines[k].t; break; }
  seekTo((prev ?? 0) - 1);
  renderSync();
}
function syncNudge(d) {
  if (!SY.on) return;
  let i = SY.cur - 1; if (i < 0 || SY.lines[i]?.t == null) i = SY.cur;
  const l = SY.lines[i]; if (!l || l.t == null) { toast(tx('Primero marca una línea')); return; }
  l.t = Math.max(0, l.t + d);
  seekTo(l.t - 1.2);
  if (P.audio.paused) P.audio.play().catch(() => { });
  renderSync();
}
async function syncSave() {
  if (!SY.on) return;
  const marked = SY.lines.filter(l => l.t != null).length;
  if (marked < 2) { toast(tx('Marca al menos dos líneas')); return; }
  const out = SY.lines.map(l => ({ ...l }));
  for (let i = 0; i < out.length; i++) {           // rellena las líneas sin marcar
    if (out[i].t != null) continue;
    let a = i - 1; while (a >= 0 && out[a].t == null) a--;
    let b = i + 1; while (b < out.length && out[b].t == null) b++;
    const ta = a >= 0 ? out[a].t : 0;
    out[i].t = b < out.length ? ta + (out[b].t - ta) * (i - a) / (b - a) : ta + 3 * (i - a);
  }
  for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) out[i].t = out[i - 1].t;
  const t = SY.t, lrc = toLRC(t, out);
  await saveLyricsText(t, lrc, 'lrc');
  syncEnd(); LY.tid = null; if (LY.mode) renderLyrics(); refreshLyricsButtons();
}
async function saveLyricsText(t, text, ext) {
  try { text = cleanLyricsText(text); } catch (e) { toast(e.message, 5000); return null; }
  if (api.kind === 'jellyfin') {
    try { await api.uploadLyrics(t, text, ext); store.del(lrcKey(t.id)); lyricsSaved(t, lyricsFromText(text)); toast(tx('Letra guardada en tu Jellyfin'), 3500); return 'server'; }
    catch (e) {
      store.set(lrcKey(t.id), text);
      toast(e.code === 403 || e.code === 401 ? tx('Guardada en este teléfono. Para guardarla en Jellyfin, activa «Permitir administrar letras» en tu usuario (Panel → Usuarios).') : tx('Guardada en este teléfono. Jellyfin no la aceptó (') + e.message + ').', 7000);
      return 'local';
    }
  }
  store.set(lrcKey(t.id), text); toast(tx('Letra guardada en este navegador')); return 'local';
}
async function lyricsSearch() {
  const t = P.cur; if (!t || !api.searchLyrics) return;
  toast(tx('Buscando letras…'), 8000);
  let res;
  try { res = await api.searchLyrics(t); }
  catch (e) { toast(e.code === 403 || e.code === 401 ? tx('Tu usuario no tiene permiso para buscar letras. Actívalo en Panel → Usuarios → «Permitir administrar letras».') : tx('No se pudo buscar: ') + e.message, 6000); return; }
  $$('.toast').forEach(x => x.remove());
  if (P.cur !== t) return;
  if (!res.length) { toast(tx('No se encontraron letras. Puedes pegarla tú.'), 4000); return; }
  res.sort((a, b) => (b.L.synced - a.L.synced));
  menu(t, res.slice(0, 8).map(r => {
    const first = (r.L.lines.find(l => l.text) || {}).text || '';
    return [`${r.L.synced ? '✓ Sincronizada' : tx('Sin tiempos')} · ${r.provider} · “${first.slice(0, 32)}${first.length > 32 ? '…' : ''}”`, r.L.synced ? 'sync' : 'lyrics', async () => {
      // La letra elegida ya está aquí: se muestra al momento, sin esperar a que Jellyfin la guarde y la vuelva a servir.
      const keepLocal = () => store.set(lrcKey(t.id), r.L.synced ? toLRC(t, r.L.lines) : r.L.lines.map(l => l.text).join('\n'));
      let saved = false;
      try { await api.pickLyrics(t, r.id); saved = true; }
      catch (e) { keepLocal(); toast(tx('Guardada en este equipo (Jellyfin no permitió guardarla).'), 4000); }
      if (saved) {
        LY.pending.delete(t.id); LY.cache.set(t.id, Promise.resolve(r.L));
        // Comprobación: si Jellyfin no la sirve (carpeta de solo lectura, otro proveedor…), se guarda también aquí.
        Promise.resolve(api.lyrics(t)).catch(() => null).then(L => {
          if (L) { store.del(lrcKey(t.id)); toast(tx('Letra guardada en tu Jellyfin')); }
          else { keepLocal(); toast(tx('Jellyfin no pudo guardar la letra en tu biblioteca; se guardó en este equipo.'), 5000); }
        });
      }
      LY.tid = null; if (LY.mode) renderLyrics(); refreshLyricsButtons();
    }];
  }));
}
function lyricsPaste() {
  const t = P.cur; if (!t) return;
  const s = document.createElement('div'); s.className = 'scrim'; s.style.alignItems = 'center';
  const cur = LY.data ? LY.data.lines.map(l => l.text).join('\n') : '';
  s.innerHTML = `<form class="dialog"><h3>${tx('Letra de «')}${esc(t.name)}»</h3><textarea class="inp" maxlength="${LYR_MAX}" placeholder="${tx('Pega aquí la letra, una línea por renglón. Si ya tiene tiempos [00:12.34], también sirve.')}">${esc(cur)}</textarea><div class="btns"><button type="button" class="btn" data-c>${tx('Cancelar')}</button><button type="button" class="btn" data-only>${tx('Solo guardar')}</button><button class="btn pri">${tx('Guardar y sincronizar')}</button></div></form>`;
  const f = s.querySelector('form'), ta = s.querySelector('textarea');
  const done = async (sync) => {
    let v; try { v = cleanLyricsText(ta.value); } catch (err) { toast(err.message, 5000); return; }
    if (!v) { ta.focus(); return; }
    s.remove();
    const timed = parseLRC(v);
    if (sync && !timed) { const lines = v.split(/\r?\n/).map(x => ({ text: x.trim(), t: null })).filter((l, i, arr) => l.text || (i > 0 && arr[i - 1].text)); syncStart(lines); return; }
    await saveLyricsText(t, v, timed ? 'lrc' : 'txt'); LY.tid = null; if (LY.mode) renderLyrics(); refreshLyricsButtons();
  };
  s.onclick = e => { if (e.target === s || e.target.closest('[data-c]')) s.remove(); else if (e.target.closest('[data-only]')) done(false); };
  f.onsubmit = e => { e.preventDefault(); done(true); };
  document.body.appendChild(s); setTimeout(() => ta.focus(), 30);
}
function forgetLocalLyrics() { if (!P.cur) return; store.del(lrcKey(P.cur.id)); LY.pending.delete(P.cur.id); LY.cache.delete(P.cur.id); toast(tx('Se quitó la letra guardada en este teléfono')); reloadLyrics(); }

/* =========================================================
   Queue panel
   ========================================================= */
function renderQueue(box) {
  const total = P.queue.reduce((s, t) => s + (t.duration || 0), 0);
  box.innerHTML = `<div class="q-head">${head(tx('Cola'), `<button class="btn" data-act="clear" ${P.queue.length ? '' : 'disabled'}>${ic('x')}<span class="lb">${tx('Limpiar')}</span></button><button class="btn" data-act="save" ${P.queue.length ? '' : 'disabled'}>${ic('save')}<span class="lb">${tx('Guardar')}</span></button>`, false)}</div>
    <div class="q-tools"><select class="sel" data-mode aria-label="${tx('Modo')}">${Object.entries(MODES).map(([k, [n]]) => `<option value="${k}"${P.mode === k ? ' selected' : ''}>${n}</option>`).join('')}</select><button class="btn" data-act="shuffle">${ic('shuffle')}${tx('Mezclar')}</button><span class="sp"></span></div>
    <div class="q-list">${P.queue.length ? P.queue.map((t, i) => `<div class="qr${i === P.i ? ' cur' : ''}" data-act="qplay" data-i="${i}"><span class="ind">${i === P.i ? ic('play', 1) : ''}</span><span class="cv">${api && api.img(t, 80) ? `<img src="${esc(api.img(t, 80))}" alt="" loading="lazy" data-rm>` : ''}</span><span class="tt">${esc(t.trackArtist || t.artist)}${t.album ? ' - ' + esc(t.album) : ''}<em>${esc(t.name)}</em></span><span class="al">${t.index ? String(t.index).padStart(2, '0') + '. ' : ''}${esc(t.name)}</span><span class="d">${fmt(t.duration)}</span><button class="x" data-act="qremove" data-i="${i}" aria-label="${tx('Quitar')}">${ic('x')}</button><span class="dh" role="button" aria-label="${tx('Arrastrar para mover')}" title="${tx('Arrastra para moverla')}">${ic('grip')}</span></div>`).join('') : ('<div class="empty">' + tx('La cola está vacía.') + '<br>' + tx('Abre un álbum y pulsa') + ' <b>' + tx('Reproducir') + '</b> o <b>' + tx('A la cola') + '</b>.</div>')}</div>
    ${P.queue.length ? `<div class="q-foot">${P.queue.length} ${tx('pistas ·')} ${fmt(total)}</div>` : ''}`;
  const sel = box.querySelector('[data-mode]'); sel.onchange = e => setMode(e.target.value);
  const c = box.querySelector('.qr.cur'); if (c) requestAnimationFrame(() => { const l = box.querySelector('.q-list'); const top = c.offsetTop - l.offsetTop; if (top < l.scrollTop || top > l.scrollTop + l.clientHeight - 60) l.scrollTop = top - l.clientHeight / 3; });
}
function renderQueueAll() {
  renderQueue($('#queue')); renderSheetQueue();
  if (cur()?.name === 'queue') { const b = $('.qview'); if (b) { const m = $('#main').scrollTop; renderQueue(b); $('#main').scrollTop = m; } }
}
// Mueve una canción de la cola de la posición «from» a «to» (la que suena sigue sonando).
async function moveQueue(from, to) {
  if (from === to || !(from >= 0 && to >= 0 && from < P.queue.length && to < P.queue.length)) return;
  const q = P.queue.slice(), [x] = q.splice(from, 1); q.splice(to, 0, x);
  let i = P.i; if (from === P.i) i = to; else if (from < P.i && to >= P.i) i--; else if (from > P.i && to <= P.i) i++;
  if (RC.remote) { await RC.reorder(q, i); return; }
  P.queue = q; P.i = i; P.cur = q[i] || null; saveQueue(); renderQueueAll(); markCurrent(); DJ.paint();
}
// Arrastrar en la cola (panel, vista de Cola y la cola del reproductor): por la agarradera, con mouse o dedo. Las demás
// filas se corren para mostrar dónde quedará; cerca del borde, la lista se desplaza sola.
const QD = { on: false, eat: false };
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('.qr .dh'); if (!h || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const row = h.closest('.qr[data-i]'); if (!row) return;
  e.preventDefault(); e.stopPropagation(); clearTimeout(LP.t); // nada de toque largo ni de reproducir
  const scroller = (el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return document.scrollingElement; })(row);
  const rows = [...row.parentElement.querySelectorAll(':scope > .qr[data-i]')], from = rows.indexOf(row);
  if (from < 0 || rows.length < 2) return;
  const rects = rows.map(r => r.getBoundingClientRect()), mids = rects.map(r => r.top + r.height / 2);
  const step = rows[from + 1] ? rects[from + 1].top - rects[from].top : rects[from].top - rects[from - 1].top;
  const y0 = e.clientY, st0 = scroller.scrollTop;
  let y = y0, pos = from, raf = 0, done = false;
  QD.on = true; document.body.classList.add('qdrag'); row.classList.add('dragging');
  rows.forEach((r, j) => j !== from && r.classList.add('shifting'));
  try { h.setPointerCapture(e.pointerId); } catch { }
  if (navigator.vibrate && e.pointerType !== 'mouse') try { navigator.vibrate(10); } catch { }
  const paint = () => {
    if (!row.isConnected) { end(true); return; } // la cola se redibujó mientras tanto (p. ej. el DJ agregó una ronda)
    const ds = scroller.scrollTop - st0, cy = y + ds; // posición del dedo en las coordenadas del inicio
    row.style.transform = `translateY(${cy - y0}px)`;
    pos = rows.reduce((n, r, j) => n + (j !== from && mids[j] < cy ? 1 : 0), 0);
    rows.forEach((r, j) => { if (j === from) return; const sh = from < pos && j > from && j <= pos ? -step : from > pos && j >= pos && j < from ? step : 0; r.style.transform = sh ? `translateY(${sh}px)` : ''; });
  };
  const tick = () => { // desplazamiento automático cerca de los bordes
    raf = 0; if (done) return;
    const r = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect(), edge = 56;
    // Solo si llevas la canción hacia ese borde (si la tomas ya cerca del borde, la lista no debe correrse sola).
    const v = y < r.top + edge && y < y0 - 8 ? -Math.ceil((r.top + edge - y) / 4) : y > r.bottom - edge && y > y0 + 8 ? Math.ceil((y - (r.bottom - edge)) / 4) : 0;
    if (v) { scroller.scrollTop += v; paint(); raf = requestAnimationFrame(tick); }
  };
  const move = ev => { y = ev.clientY; paint(); if (!raf) raf = requestAnimationFrame(tick); };
  const end = (cancel) => {
    if (done) return; done = true; cancelAnimationFrame(raf);
    h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', cc);
    document.body.classList.remove('qdrag'); QD.on = false; QD.eat = true; setTimeout(() => { QD.eat = false; }, 400);
    rows.forEach(r => { r.classList.remove('dragging', 'shifting'); r.style.transform = ''; });
    if (!cancel && pos !== from) moveQueue(+rows[from].dataset.i, +rows[pos].dataset.i);
  };
  const up = () => end(false), cc = () => end(true);
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', cc);
}, true);
// El clic que llega al soltar no debe reproducir la canción.
document.addEventListener('click', e => { if (QD.eat && e.target.closest('.qr')) { QD.eat = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
function markCurrent() { $$('.tr,.scard').forEach(r => r.classList.toggle('cur', !!P.cur && r.dataset.tid === P.cur.id)); }

/* =========================================================
   Overlays
   ========================================================= */
function toast(m, ms = 2600) { $$('.toast').forEach(t => t.remove()); const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; t.onclick = () => t.remove(); document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function menu(t, items, headHTML = '') {
  $$('.scrim').forEach(x => x.remove());
  const s = document.createElement('div'); s.className = 'scrim';
  s.innerHTML = `<div class="menu" role="menu">${headHTML}${t ? `<div class="mh">${coverHTML(t, 100)}<div style="min-width:0"><div class="t">${esc(t.name)}</div><div class="muted" style="font-size:12.5px">${esc([t.trackArtist || t.artist, t.album].filter(Boolean).join(' · '))}</div></div></div>` : ''}${items.map((it, i) => `<button class="mi" data-k="${i}">${ic(it[1])}${esc(it[0])}</button>`).join('')}</div>`;
  s.onclick = e => { const b = e.target.closest('[data-k]'); if (b || e.target === s) { s.remove(); if (b) items[+b.dataset.k][2](); } };
  document.body.appendChild(s);
}
/* =========================================================
   Mis dispositivos: un Nanuq suena y los demás del mismo usuario (y la misma red) lo controlan,
   como un control remoto. Jellyfin es el puente: sesiones (/Sessions), órdenes (/Sessions/{id}/Playing…)
   y avisos al instante por su WebSocket. No se abre ningún puerto en los dispositivos.
   ========================================================= */
const DEV_LABEL = { Android: tx('Teléfono (Android)'), Linux: 'Computadora (Linux)', Windows: 'Computadora (Windows)', Mac: 'Mac', iOS: 'iPhone' };
const devLabel = s => DEV_LABEL[s && s.DeviceName] || (s && s.DeviceName) || tx('Otro dispositivo');
const DEV_NAME = { Android: tx('el teléfono (Android)'), Linux: tx('la computadora (Linux)'), Windows: tx('la computadora (Windows)'), Mac: tx('la Mac'), iOS: tx('el iPhone') };
const devName = s => DEV_NAME[s && s.DeviceName] || (s && s.DeviceName) || tx('el otro dispositivo');
// ¿Misma red? Igual subred IPv4 (/24) o prefijo IPv6 (/64), o ambos llegan al servidor desde direcciones locales.
function expand6(ip) {
  const [h, t] = ip.split('::'), a = h ? h.split(':') : [], b = t !== undefined && t ? t.split(':') : [];
  if (t === undefined && a.length !== 8) return null;
  const fill = 8 - a.length - b.length; if (fill < 0) return null;
  return [...a, ...Array(t === undefined ? 0 : fill).fill('0'), ...b].map(x => x.toLowerCase().padStart(4, '0'));
}
function ipKey(ip) {
  if (!ip) return null;
  ip = String(ip).trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const m4 = ip.match(/^(?:::ffff:)?(\d+\.\d+\.\d+)\.\d+$/i);
  if (m4) return { v: 4, net: m4[1], priv: /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(m4[1] + '.') };
  if (ip.includes(':')) { const f = expand6(ip); return f ? { v: 6, net: f.slice(0, 4).join(':'), priv: /^f[cd]|^fe[89ab]/.test(f[0]) || f.join(':') === '0000:0000:0000:0000:0000:0000:0000:0001' } : null; }
  return null;
}
function sameNetwork(a, b) {
  const x = ipKey(a), y = ipKey(b); if (!x || !y) return false;
  return (x.v === y.v && x.net === y.net) || (x.priv && y.priv);
}
const REPEAT = { once: 'RepeatNone', all: 'RepeatAll', one: 'RepeatOne' }, REPEAT_BACK = { RepeatNone: 'once', RepeatAll: 'all', RepeatOne: 'one' };
const RC = {
  ws: null, wsTimer: 0, keepT: 0, pollT: 0, tickT: 0, repT: 0, backoff: 0, visible: true,
  peers: [], self: null,
  remote: null,              // sesión del dispositivo que estamos controlando, o null
  anchor: { pos: 0, at: 0 }, paused: true, lastRaw: null, qkey: null, since: 0,
  items: new Map(),          // id → pista, para armar la cola del otro
  dismissed: new Set(),      // dispositivos que el usuario desconectó a mano (hasta que dejen de sonar)
  on() { return !!api && api.kind === 'jellyfin' && !!Settings.devSync; },
  start() { this.stop(); if (!this.on()) return; api.postCapabilities(); this.connect(); this.schedule(1500); },
  stop() {
    clearTimeout(this.pollT); clearTimeout(this.wsTimer); clearInterval(this.keepT);
    const ws = this.ws; this.ws = null; try { ws && ws.close(); } catch { }
    if (this.remote) this.leave(); this.peers = [];
  },
  // ---- WebSocket: órdenes que llegan de otros dispositivos ----
  connect() {
    if (!this.on() || this.ws) return;
    let ws; try { ws = new WebSocket(api.wsUrl()); } catch { return; }
    this.ws = ws;
    ws.onopen = () => { this.backoff = 0; this.wsOk = true; this.wsFails = 0; api.postCapabilities(); };
    ws.onmessage = e => { let m; try { m = jparse(e.data); } catch { return; } try { this.onMessage(m); } catch { } };
    ws.onclose = () => {
      clearInterval(this.keepT);
      if (this.ws !== ws) return;
      this.ws = null; this.wsOk = false; this.wsFails = (this.wsFails || 0) + 1;
      if (this.on()) this.wsTimer = setTimeout(() => this.connect(), Math.min(60000, 2000 * 2 ** this.backoff++));
    };
  },
  send(type, data) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(data === undefined ? { MessageType: type } : { MessageType: type, Data: data })); } catch { } },
  onMessage(m) {
    const d = m.Data || {};
    if (m.MessageType === 'ForceKeepAlive') { clearInterval(this.keepT); this.keepT = setInterval(() => this.send('KeepAlive'), Math.max(5, (+m.Data || 60) / 2) * 1000); this.send('KeepAlive'); }
    else if (m.MessageType === 'Playstate') this.onPlaystate(d);
    else if (m.MessageType === 'Play') { if (this.fromMe(d)) this.onPlay(d); }
    else if (m.MessageType === 'GeneralCommand') { if (this.fromMe(d)) this.onGeneral(d); }
    else if (m.MessageType === 'UserDataChanged') favRemote(d.UserDataList);
  },
  // ¿La orden viene de mi propio usuario? En Play y GeneralCommand, Jellyfin pone él mismo quién la manda
  // (ControllingUserId), así que es confiable. En las de pausa/siguiente/buscar (Playstate) ese dato lo manda el cliente
  // y no sirve para verificar: ahí el límite es el permiso de Jellyfin «controlar a otros usuarios».
  fromMe(d) {
    if (Settings.devOthers || d.ControllingUserId == null) return true; // versiones de Jellyfin sin ese dato
    const norm = v => String(v || '').replace(/-/g, '').toLowerCase();
    if (norm(d.ControllingUserId) === norm(api.userId)) return true;
    if (Date.now() - (this.deniedAt || 0) > 60000) { this.deniedAt = Date.now(); toast(tx('Se ignoró una orden de otro usuario de Jellyfin. Si quieres permitirlo: Ajustes → «Aceptar órdenes de otros usuarios».'), 6000); }
    return false;
  },
  onPlaystate(d) {
    if (this.remote) return;
    switch (d.Command) {
      case 'PlayPause': toggle(); break;
      case 'Pause': pauseSoft(); break;
      case 'Stop': pauseSoft(); DJ.stop(true); break; // p. ej. «Reproducir aquí» en otro dispositivo: el DJ sigue allá
      case 'Unpause': if (P.audio.src) playSoft(); else toggle(); break;
      case 'NextTrack': next(false); break;
      case 'PreviousTrack': prev(); break;
      case 'Seek': seekTo((+d.SeekPositionTicks || 0) / 1e7); break;
    }
    this.reportSoon(200);
  },
  async onPlay(d) {
    const ids = d.ItemIds || []; if (!ids.length) return;
    let tracks; try { tracks = (await api.itemsByIds(ids)).filter(t => t.type === 'track'); } catch { return; }
    if (!tracks.length) return;
    if (this.remote) this.leave();
    if (d.PlayCommand === 'PlayNext' || d.PlayCommand === 'PlayLast') { addToQueue(tracks, d.PlayCommand === 'PlayNext'); this.reportSoon(); return; }
    const start = Math.max(0, Math.min(+d.StartIndex || 0, tracks.length - 1)), sec = (+d.StartPositionTicks || 0) / 1e7;
    // ¿Te pasaron la música con el DJ? El otro dispositivo dejó en tu Jellyfin la sesión, para este dispositivo y con
    // estas mismas canciones: se sigue aquí la misma sesión (y se marca como tomada).
    const st = await DJSHARE.pull().catch(() => null);
    if (st && !st.off && st.to === deviceId() && st.q && st.q.length === tracks.length && st.q.every((x, k) => x[0] === tracks[k].id) && Math.abs(Date.now() - st.at) < 6 * 3600e3) {
      const queue = DJ.queueFromShare(tracks, st), same = DJ.active && DJ.session === st.s;
      DJ.adopt(st, queue, start);
      P.queue = queue; playIndex(start); renderQueueAll();
      DJ.save(); DJSHARE.push().catch(() => { }); DJ.paint();
      if (sec > 1) P.pendingSeek = { seq: P.seq, sec };
      if (!same) toast(tx('DJ Nanuq sigue la sesión aquí'), 3500);
      return;
    }
    setQueue(tracks, start);
    if (sec > 1) P.pendingSeek = { seq: P.seq, sec };
  },
  onGeneral(d) {
    if (this.remote) return;
    const a = d.Arguments || {};
    if (d.Name === 'SetRepeatMode' && REPEAT_BACK[a.RepeatMode]) { setMode(REPEAT_BACK[a.RepeatMode]); this.reportSoon(); }
    else if (d.Name === 'SetShuffleQueue') { shuffleQueue(); this.reportSoon(); }
  },
  // ---- Lo que este dispositivo le cuenta a Jellyfin cuando es el que suena ----
  queueForReport() { const a = Math.max(0, P.i - 100); return P.queue.slice(a, a + 300).map(t => ({ Id: t.id, PlaylistItemId: t.qid || t.id })); },
  reportSoon(ms = 400) {
    if (!this.on() || this.remote) return;
    clearTimeout(this.repT);
    this.repT = setTimeout(() => { if (P.cur && !this.remote && P.audio.src) api.report('progress', P.cur, ptime(), P.audio.paused); }, ms);
  },
  // ---- Buscar los otros Nanuq del usuario ----
  schedule(ms) { clearTimeout(this.pollT); if (this.on()) this.pollT = setTimeout(() => this.poll(), ms); },
  async poll() {
    if (!this.on()) return;
    if (!this.visible && !this.remote) { this.schedule(20000); return; }
    let list;
    try { list = await api.sessions(); } catch { this.schedule(this.remote ? 3000 : 15000); return; }
    const me = deviceId();
    this.self = (list || []).find(s => s.DeviceId === me) || null;
    // Hora del servidor ahora mismo: nuestra propia sesión se acaba de actualizar con esta consulta.
    this.serverNow = this.self && this.self.LastActivityDate ? Date.parse(this.self.LastActivityDate) : 0;
    // «Activo hace poco» se mide con el reloj del SERVIDOR, no con el de este equipo: con el reloj desfasado (típico en
    // una PC con Windows y Linux, que guardan la hora del BIOS distinto) todos los demás parecían viejos y no aparecían.
    const now = this.serverNow || Date.now(), recent = s => !s.LastActivityDate || now - Date.parse(s.LastActivityDate) < 15 * 60 * 1000;
    this.peers = (list || []).filter(s => s.DeviceId !== me && s.Client === 'Nanuq' && s.UserId === api.userId && recent(s))
      .map(s => ({ ...s, sameNet: sameNetwork(this.self && this.self.RemoteEndPoint, s.RemoteEndPoint), ctl: !!(s.SupportsRemoteControl || s.SupportsMediaControl) }));
    for (const id of [...this.dismissed]) { const p = this.peers.find(x => x.DeviceId === id); if (!p || !p.NowPlayingItem) this.dismissed.delete(id); }
    if (this.remote) {
      const s = this.peers.find(p => p.DeviceId === this.remote.DeviceId);
      if (!s) { const was = this.remote; this.leave(); toast(tx('Se perdió la conexión con ') + devName(was), 4000); }
      else if (!s.NowPlayingItem) { if (Date.now() - this.since > 8000) this.leave(); }
      else { this.remote = s; await this.apply(s); }
    } else this.maybeFollow();
    this.schedule(this.remote ? 2000 : 8000);
  },
  maybeFollow() {
    if (!P.audio.paused && P.audio.src) return; // aquí ya suena algo: cada quien lo suyo
    const c = this.peers.find(p => p.ctl && p.NowPlayingItem && p.PlayState && !p.PlayState.IsPaused && (p.sameNet || !Settings.devSameNet) && !this.dismissed.has(p.DeviceId));
    if (c) this.enter(c, true);
  },
  // ---- Modo control remoto ----
  enter(s, auto) {
    // Tu cola local se aparta mientras controlas el otro dispositivo y vuelve al desconectarte (al abrir la app con
    // otro Nanuq sonando, la conexión es automática: antes se perdía la cola de este dispositivo).
    if (!this.remote) { QPOS.save(true); this.localQ = { q: P.queue, i: P.i }; }
    PF.soon(300); // controlando otro dispositivo aquí no suena nada: se vacía lo guardado por adelantado
    if (P.cur && P.audio.src) api.report('stop', P.cur, ptime());
    P.pause(); P.audio.removeAttribute('src'); try { P.audio.load(); } catch { } P.extPause = null;
    clearTimeout(P.fbT); clearTimeout(P.stallT); P.off = 0; P.srcBase = '';
    this.remote = s; this.since = Date.now(); this.qkey = null; this.lastRaw = null;
    if (!s.NowPlayingItem) { this.paused = false; this.anchor = { pos: 0, at: Date.now() }; }
    document.body.classList.add('rc-on');
    clearInterval(this.tickT); this.tickT = setInterval(() => this.tick(), 500);
    if (s.NowPlayingItem) this.apply(s); else { updateNow(); updatePlayState(); }
    if (auto) toast(tx('Conectado con ') + devName(s) + tx(': lo que suena allá se controla desde aquí.'), 4500);
    this.schedule(1200);
  },
  leave() {
    if (!this.remote) return;
    this.remote = null; this.qkey = null; rcKeepOff(); DJ.rAnn = ''; DJ.rLine = '';
    if (this.localQ) { P.queue = this.localQ.q; P.i = Math.min(this.localQ.i, P.queue.length - 1); P.cur = P.queue[P.i] || null; this.localQ = null; P.resume = QPOS.restore(); }
    clearInterval(this.tickT); document.body.classList.remove('rc-on');
    this.paused = true;
    updateNow(); updatePlayState(); renderQueueAll(); markCurrent(); bearMood(false); saveQueue();
  },
  async apply(s) {
    const it = s.NowPlayingItem, ps = s.PlayState || {};
    const track = { ...api.map(it), qid: sid(s.PlaylistItemId) || sid(it.Id) };
    this.items.set(track.id, { ...(this.items.get(track.id) || {}), ...track });
    while (this.items.size > 3000) this.items.delete(this.items.keys().next().value); // tope de memoria
    const q = (Array.isArray(s.NowPlayingQueue) ? s.NowPlayingQueue.slice(0, 3000) : []).map(x => ({ Id: sid(x.Id), PlaylistItemId: sid(x.PlaylistItemId) })).filter(x => x.Id), key = q.map(x => x.PlaylistItemId || x.Id).join(',');
    if (key !== this.qkey) {
      const missing = [...new Set(q.map(x => x.Id))].filter(id => !this.items.has(id)).slice(0, 500);
      if (missing.length) { try { (await api.itemsByIds(missing)).forEach(t => this.items.set(t.id, t)); } catch { } }
      if (this.remote !== s && (!this.remote || this.remote.DeviceId !== s.DeviceId)) return;
      this.qkey = key;
      P.queue = q.length ? q.map(x => ({ ...(this.items.get(x.Id) || { id: x.Id, name: '…', type: 'track' }), qid: x.PlaylistItemId || x.Id })) : [track];
      renderQueueAll();
    }
    let i = P.queue.findIndex(t => t.qid === sid(s.PlaylistItemId));
    if (i < 0) i = P.queue.findIndex(t => t.id === sid(it.Id));
    if (i < 0) { P.queue = [track]; i = 0; this.qkey = null; renderQueueAll(); }
    const changed = !P.cur || P.cur.id !== sid(it.Id) || P.i !== i;
    P.i = i; P.cur = P.queue[i];
    const pos = (ps.PositionTicks || 0) / 1e7, paused = !!ps.IsPaused;
    // Antigüedad del último reporte del otro, medida con el reloj del servidor (sin desfase entre dispositivos).
    let age = 0.8;
    if (s.LastPlaybackCheckIn && this.serverNow) { const a = (this.serverNow - Date.parse(s.LastPlaybackCheckIn)) / 1000; if (a >= 0 && a < 30) age = a; }
    const est = pos + (paused ? 0 : age);
    if (changed || paused !== this.paused || Math.abs(this.pos() - est) > 0.5) this.anchor = { pos: est, at: Date.now() };
    this.lastRaw = pos; this.paused = paused;
    const m = REPEAT_BACK[ps.RepeatMode]; if (m && m !== P.mode) { P.mode = m; updateModeBtn(); }
    if (changed) { updateNow(); markCurrent(); renderQueueAll(); }
    updatePlayState(); bearMood(!paused); if (changed) bearDance(); this.tick();
    DJ.remoteTrack(); // si allá suena el DJ: su escena, la ronda y su presentación
  },
  pos() { const a = this.anchor, d = P.cur && P.cur.duration || 0; const p = a.pos + (this.paused ? 0 : (Date.now() - a.at) / 1000); return d ? Math.max(0, Math.min(p, d)) : Math.max(0, p); },
  tick() {
    drawWaves(); syncLyrics();
    const now = Date.now(), d = pdur();
    if (this.remote && d && navigator.mediaSession?.setPositionState && now - RCK.posAt > 1000) {
      RCK.posAt = now; try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(this.pos(), d), playbackRate: 1 }); } catch { }
    }
  },
  decorate() {
    const on = !!this.remote, where = on ? tx('Sonando en ') + devLabel(this.remote) : '';
    document.body.classList.toggle('rc-on', on);
    if (on) { $('#mArtist').textContent = where; $('#pArtist').textContent = where; }
  },
  // ---- Órdenes al dispositivo que suena ----
  fail(e) { toast(tx('No se pudo enviar la orden a ') + devName(this.remote || {}) + ': ' + (e && e.message || e), 5000); },
  cmd(c, params) {
    const s = this.remote; if (!s) return;
    if (c === 'PlayPause' || c === 'Pause' || c === 'Unpause') { const p = this.pos(); this.paused = c === 'Pause' ? true : c === 'Unpause' ? false : !this.paused; this.anchor = { pos: p, at: Date.now() }; updatePlayState(); bearMood(!this.paused); }
    api.sessionCmd(s.Id, c, params).catch(e => this.fail(e));
    this.schedule(700);
  },
  seek(sec) { sec = Math.max(0, sec); this.anchor = { pos: sec, at: Date.now() }; this.lastRaw = null; this.tick(); this.cmd('Seek', { seekPositionTicks: Math.round(sec * 1e7) }); },
  window(tracks, start) { const a = Math.max(0, start - 50), list = tracks.slice(a, a + 200); return { ids: list.map(t => t.id), index: start - a, a }; },
  playQueue(tracks, start, sec = 0) {
    const s = this.remote; if (!s || !tracks.length) return;
    tracks.forEach(t => this.items.set(t.id, t));
    const w = this.window(tracks, start);
    api.sessionPlay(s.Id, w.ids, w.index, Math.round(sec * 1e7)).catch(e => this.fail(e));
    P.queue = tracks.map(t => ({ ...t, qid: t.qid || uid() })); P.i = start; P.cur = P.queue[start];
    this.qkey = null; this.paused = false; this.anchor = { pos: sec, at: Date.now() }; this.lastRaw = null;
    updateNow(); renderQueueAll(); markCurrent(); bearMood(true); this.schedule(1200);
  },
  add(tracks, nextUp) {
    const s = this.remote; if (!s) return;
    tracks.forEach(t => this.items.set(t.id, t));
    api.sessionPlay(s.Id, tracks.slice(0, 200).map(t => t.id), 0, 0, nextUp ? 'PlayNext' : 'PlayLast')
      .then(() => toast((tracks.length === 1 ? (nextUp ? tx('Sonará a continuación') : tx('Añadida a la cola')) : tracks.length + tx(' pistas añadidas a la cola')) + ' ' + tx('en') + ' ' + devName(s)))
      .catch(e => this.fail(e));
    this.schedule(1200);
  },
  // Cola reordenada mientras controlas otro dispositivo: se le manda la cola nueva (sigue en el mismo segundo). Si allá
  // suena el DJ, antes se le deja la sesión con la ronda de cada canción para que siga siendo el DJ.
  async reorder(q, i) {
    const s = this.remote; if (!s) return;
    const g = DJ.remoteTag(), st = g ? await DJSHARE.pull().catch(() => null) : null;
    if (st && !st.off && djSame(st.s, g.s)) {
      const w = this.window(q, i); let prev = null;
      const qq = q.slice(w.a, w.a + 200).map(t => { const x = djTag(t.qid); if (!x || !djSame(x.s, st.s)) { prev = null; return [t.id, -1, 0]; } const f = prev !== x.i ? 1 : 0; prev = x.i; return [t.id, x.i, f]; });
      await DJSHARE.pushRaw({ ...st, at: Date.now(), to: s.DeviceId, q: qq }).catch(() => { });
    }
    if (this.remote !== s) return;
    this.playQueue(q, i, this.pos());
  },
  general(name, args) { const s = this.remote; if (!s) return; api.sessionGeneral(s.Id, name, args).catch(e => this.fail(e)); this.schedule(900); },
  // ---- Pasar la música de un lado a otro ----
  async here() {
    const s = this.remote; if (!s) return;
    const sec = this.pos(), q = P.queue.slice(), i = P.i, wasPaused = this.paused;
    // Si allá suena el DJ, la sesión se trae también (y allá se apaga al recibir «Stop»).
    const g = DJ.remoteTag();
    let st = g ? await DJSHARE.pull().catch(() => null) : null;
    if (st && (st.off || !djSame(st.s, g.s))) st = null;
    if (this.remote !== s) return;
    api.sessionCmd(s.Id, 'Stop').catch(() => { });
    this.dismissed.add(s.DeviceId);
    this.leave();
    if (!q.length || i < 0) return;
    if (st) {
      const queue = DJ.queueFromTags(q, st.s);
      DJ.adopt(st, queue, i); P.queue = queue;
      playIndex(i, !wasPaused); DJ.save(); DJSHARE.push().catch(() => { }); DJ.paint();
    } else {
      P.queue = q.map(t => ({ ...t, qid: uid() }));
      playIndex(i, !wasPaused);
    }
    if (sec > 1) P.pendingSeek = { seq: P.seq, sec };
    toast(tx('Ahora suena en este dispositivo'));
  },
  async there(peer) {
    if (!P.cur) { this.enter(peer); return; }
    const sec = ptime(), w = this.window(P.queue, P.i), q = P.queue.slice(), i = P.i;
    // Con el DJ sonando, la sesión viaja también: el otro dispositivo la sigue y este la muestra mientras lo controla.
    const dj = DJ.active && P.cur.djS === DJ.session, st = dj ? await DJ.share(peer, q, i) : null;
    try { await api.sessionPlay(peer.Id, w.ids, w.index, Math.round(sec * 1e7)); }
    catch (e) { toast(tx('No se pudo pasar la música a ') + devName(peer) + ': ' + e.message, 5000); return; }
    if (dj && st) DJ.handedOff(st); // si no se pudo compartir, allá suena como una cola normal y el DJ sigue aquí
    this.enter(peer);
    P.queue = q; P.i = i; P.cur = q[i]; this.paused = false; this.anchor = { pos: sec, at: Date.now() };
    updateNow(); renderQueueAll(); markCurrent(); bearMood(true);
    toast(tx('Ahora suena en ') + devName(peer));
  }
};
document.addEventListener('visibilitychange', () => { RC.visible = document.visibilityState === 'visible'; if (RC.visible) RC.schedule(300); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshIf(c => c.name === 'favorites'); });
// Android con la pantalla bloqueada: el WebView frena los temporizadores de la página (a ~1 por minuto), el «sigo
// aquí» del WebSocket no llega a tiempo y Jellyfin corta la conexión; el teléfono dejaba de recibir órdenes hasta
// despertarlo. La app nativa llama a esto cada 20 s (evaluateJavascript no se frena): latido y reconexión.
window.__nanuqTick = () => {
  if (typeof PG !== 'undefined') PG.wake();
  if (!RC.on()) return;
  if (RC.ws && RC.ws.readyState === 1) RC.send('KeepAlive');
  else if (!RC.ws) { clearTimeout(RC.wsTimer); RC.connect(); }
  if (P.netLost && audioDead() && navigator.onLine !== false) netBack();
  stallCheck(); // con la pantalla bloqueada el setInterval de la página va frenado
};
window.__nanuqVis = v => { RC.visible = !!v; if (v) { netBack(); if (typeof PG !== 'undefined') PG.wake(true); } else nqBurstEnd(); djLiveSync(); };
async function openDevices() {
  if (!api || api.kind !== 'jellyfin') { toast(tx('Disponible al conectarte a tu servidor Jellyfin.')); return; }
  if (!Settings.devSync) { toast(tx('Activa «Sincronizar con mis otros dispositivos» en Ajustes.'), 4000); return; }
  toast(tx('Buscando tus dispositivos…'), 2000);
  await RC.poll();
  $$('.toast').forEach(x => x.remove());
  const items = [];
  let headHTML = '';
  if (RC.remote) {
    const now = P.cur ? [P.cur.name, P.cur.trackArtist || P.cur.artist].filter(Boolean).join(' · ') : '';
    headHTML = `<div class="rch"><span class="ico">${ic('devices')}</span><div style="min-width:0"><div class="t">${tx('Sonando en')} ${esc(devLabel(RC.remote))}</div>${now ? `<div class="muted">${RC.paused ? tx('En pausa: ') : ''}${esc(now)}</div>` : ''}</div></div>`;
    items.push([tx('Reproducir aquí'), 'play', () => RC.here()]);
    items.push([tx('Desconectar de ') + devLabel(RC.remote), 'x', () => { RC.dismissed.add(RC.remote.DeviceId); RC.leave(); toast(tx('Desconectado: cada dispositivo vuelve a lo suyo')); }]);
  }
  if (!RC.wsOk) items.push([tx('Este dispositivo no pudo abrir la conexión en vivo con Jellyfin (WebSocket), así que los demás no pueden controlarlo. Revisa que tu proxy permita WebSocket.'), 'x', () => { }]);
  for (const p of RC.peers) {
    if (RC.remote && p.DeviceId === RC.remote.DeviceId) continue;
    const what = p.NowPlayingItem ? (p.PlayState && p.PlayState.IsPaused ? tx('en pausa: ') : 'sonando: ') + p.NowPlayingItem.Name : tx('sin música');
    const where = String(p.RemoteEndPoint || '').replace(/^::ffff:/, '');
    const label = devLabel(p) + (where ? ' (' + where + ')' : '') + ' · ' + what + (p.sameNet ? '' : tx(' · otra red'));
    if (!p.ctl) { items.push([devLabel(p) + tx(' · no recibe órdenes todavía: actualiza Nanuq a ') + VERSION + tx(' en ese dispositivo y vuelve a abrirlo.'), 'x', () => { }]); continue; }
    if (!RC.remote && P.cur) items.push([tx('Pasar la música a ') + label, 'next-up', () => RC.there(p)]);
    else if (p.NowPlayingItem) items.push(['Controlar ' + label, 'queue', () => RC.enter(p)]);
    else if (P.cur) items.push([tx('Pasar la música a ') + label, 'next-up', () => RC.there(p)]);
    else items.push([label, 'x', () => { }]);
  }
  if (!items.length) items.push([tx('No encontré otro Nanuq abierto con tu usuario. Ábrelo en tu teléfono o tu computadora.'), 'x', () => { }]);
  menu(null, items, headHTML);
}

/* Favorito y Descargar (pantalla de reproducción) */
function updateFavBtn() {
  const b = $('#sFavBtn'); if (!b) return;
  const on = !!(P.cur && P.cur.fav);
  b.classList.toggle('on', on); b.querySelector('svg').classList.toggle('f', on);
  b.querySelector('span').textContent = on ? tx('Favorita') : tx('Favorito');
}
function setFavLocal(id, on) { for (const q of P.queue) if (q.id === id) q.fav = on; if (P.cur && P.cur.id === id) P.cur.fav = on; saveQueue(); updateFavBtn(); }
let favSeq = 0;
const favBusy = new Map(); // id → hasta cuándo ignorar lecturas viejas (un clic reciente manda)
const FAVK = new Map();    // id → favorita sí/no, según lo último que supimos
// Cambios recientes que la lista del servidor quizá todavía no refleja (el plugin rehace su playlist un instante
// después): id → { on, t (la canción, para agregarla), until }.
const FAVPEND = new Map();
function favPending(id, on, t) { FAVPEND.set(id, { on, t: t || FAVPEND.get(id)?.t || null, until: Date.now() + 90000 }); }
function favMerge(list) {
  const now = Date.now(); let out = list.slice(); out.source = list.source; out.sourceId = list.sourceId;
  for (const [id, p] of FAVPEND) {
    const has = out.some(t => t.id === id);
    if (p.until < now || has === p.on) { FAVPEND.delete(id); continue; } // ya coincide (o se venció)
    if (p.on && p.t) out.push({ ...p.t, fav: true }); else if (!p.on) out = Object.assign(out.filter(t => t.id !== id), { source: list.source, sourceId: list.sourceId });
  }
  return out;
}
// Aviso de Jellyfin (WebSocket «UserDataChanged»): alguien marcó o quitó una favorita en otro dispositivo
// u otra app con tu usuario. También llega por cada reproducción, así que solo cuenta si cambió la favorita.
let favRemoteT = 0;
// Jellyfin 12 (visto en el servidor del usuario): cada aviso de reproducción («empezó», «progreso», «terminó») de una
// canción vuelve a escribir sus datos con la favorita como estaba AL EMPEZAR a sonar. Marcar o quitar una favorita
// mientras suena duraba hasta el siguiente aviso (2–10 s) y se perdía. Ninguna ruta de la API lo evita (se probaron
// /UserFavoriteItems, /Users/{u}/FavoriteItems, /UserItems/{id}/UserData y reenviar «empezó»). Así que, mientras esa
// canción siga sonando, la favorita se vuelve a guardar justo DESPUÉS de cada aviso: lo último escrito es lo que quieres.
const FAVHOLD = new Map(); // id → { on, until }: canciones cuya favorita se está protegiendo
function favHold(t, on) { if (t && P.cur && P.cur.id === t.id && !RC.remote && api.kind === 'jellyfin') FAVHOLD.set(t.id, { on, until: Date.now() + 6 * 3600e3 }); }
// Ojo: NO depende de cuál suena ahora. El aviso «terminó» de una canción se manda justo al pasar a la siguiente, y
// cuando Jellyfin responde (y pisa la favorita), la actual ya es otra: también hay que corregir ese último pisotón.
function favHeld(id) { const h = FAVHOLD.get(id); if (h && h.until <= Date.now()) FAVHOLD.delete(id); return !!h && h.until > Date.now(); }
function favReassert(t, last) {
  if (!t || !favHeld(t.id)) return;
  const h = FAVHOLD.get(t.id), on = h.on;
  // Terminó: con esta última escritura basta (la próxima vez que suene, Jellyfin ya la lee bien). Se sigue reteniendo
  // 10 s más para ignorar el aviso «cambió» que Jellyfin manda por ese último pisotón.
  if (last) h.until = Date.now() + 10000;
  api.setFavorite(t.id, on).catch(() => { });
}
function favRemote(list) {
  let changed = false;
  for (const u of list || []) {
    if (typeof u.IsFavorite !== 'boolean' || !u.ItemId) continue;
    const id = String(u.ItemId).replace(/-/g, '').toLowerCase(), on = u.IsFavorite;
    if ((favBusy.get(id) || 0) > Date.now()) continue; // es el eco de un clic de aquí
    // Mientras se protege (la cambiaste aquí y sigue sonando), los avisos de Jellyfin son su propio pisotón: se ignoran.
    // (Jellyfin agrupa estos avisos ~2 s y manda el estado de ESE momento, ya pisado; por eso un cambio hecho en otro
    // dispositivo mientras la canción suena aquí no se puede distinguir ni proteger: es un límite del servidor.)
    if (favHeld(id)) continue;
    const q = (P.cur && P.cur.id === id) ? P.cur : P.queue.find(x => x.id === id);
    const known = FAVK.has(id) ? FAVK.get(id) : q ? !!q.fav : null;
    FAVK.set(id, on);
    if (known === on || (known === null && !on)) continue;
    changed = true; favPending(id, on, q || null);
    if (P.queue.some(q => q.id === id && !!q.fav !== on) || (P.cur && P.cur.id === id && !!P.cur.fav !== on)) setFavLocal(id, on);
  }
  if (!changed) return;
  clearTimeout(favRemoteT);
  const again = () => { cacheDrop('favs:'); cacheDrop('mix:fav'); cacheDrop('mixprev:fav'); refreshIf(c => c.name === 'favorites'); };
  favRemoteT = setTimeout(() => { again(); favRemoteT = setTimeout(again, 4000); }, 700); // y otra vez cuando el plugin rehízo su playlist
}
async function refreshFav(t) {
  if (!t || !api || !api.isFavorite || favHeld(t.id)) return; // en espera de corregir el pisotón: lo local manda
  const n = ++favSeq;
  try {
    const f = await api.isFavorite(t.id);
    // Una lectura que salió antes del clic y llega después traería el estado viejo: se descarta.
    if (n !== favSeq || (favBusy.get(t.id) || 0) > Date.now()) return;
    if (P.cur && P.cur.id === t.id && f !== !!t.fav) setFavLocal(t.id, f);
  } catch { }
}
// Marca o quita la favorita en Jellyfin y lo comprueba leyendo de vuelta del servidor.
async function toggleFav(t = P.cur) {
  if (!t || !api.setFavorite) return;
  const want = !t.fav; favSeq++; favBusy.set(t.id, Date.now() + 8000); favHold(t, want);
  t.fav = want; setFavLocal(t.id, want);
  try {
    await api.setFavorite(t.id, want);
    // Sonando, una lectura inmediata puede caer justo después de un aviso de reproducción que la pisó: la confirma favReassert.
    let saved = favHeld(t.id) ? want : await api.isFavorite(t.id);
    if (saved !== want && api.setFavoriteLegacy) { await api.setFavoriteLegacy(t.id, want).catch(() => { }); saved = await api.isFavorite(t.id); }
    t.fav = saved; setFavLocal(t.id, saved); FAVK.set(t.id, saved); favPending(t.id, saved, t);
    cacheDrop('mix:fav'); cacheDrop('mixprev:fav'); cacheDrop('favs:'); // «Favoritas» en Inicio y la sección Favoritas se vuelven a armar
    refreshIf(c => c.name === 'favorites');
    setTimeout(() => { cacheDrop('favs:'); refreshIf(c => c.name === 'favorites'); }, 5000); // el plugin ya rehízo su playlist
    if (saved !== want) toast(tx('Jellyfin no guardó el cambio de favorito. Revisa que tu usuario pueda modificar su biblioteca.'), 6000);
    else { toast(saved ? '«' + t.name + tx('» está en tus favoritas') : '«' + t.name + tx('» ya no está en tus favoritas')); favConfirm(t, want); }
  } catch (e) { FAVHOLD.delete(t.id); t.fav = !want; setFavLocal(t.id, !want); toast(tx('No se pudo cambiar el favorito: ') + e.message, 5000); }
  finally { favBusy.set(t.id, Date.now() + 1500); }
}
// Segunda confirmación, unos segundos después y contra la sección de favoritas de Jellyfin (no solo la canción): si no
// quedó, se guarda otra vez (también por la ruta antigua) y, si aun así no, se avisa y el botón muestra la verdad.
function favConfirm(t, want) {
  if (!api.inFavorites || favHeld(t.id)) return; // sonando: la corrige favReassert tras cada aviso
  setTimeout(async () => {
    try {
      if (await api.inFavorites(t.id) === want) return;
      await api.setFavorite(t.id, want).catch(() => { });
      if (api.setFavoriteLegacy) await api.setFavoriteLegacy(t.id, want).catch(() => { });
      await new Promise(r => setTimeout(r, 1500));
      const ok = await api.inFavorites(t.id) === want;
      if (!ok) { setFavLocal(t.id, !want); FAVK.set(t.id, !want); FAVPEND.delete(t.id); cacheDrop('favs:'); refreshIf(c => c.name === 'favorites'); }
      toast(ok ? tx('Jellyfin tardó en guardar «') + t.name + tx('»: se volvió a guardar y ya está.') : tx('Jellyfin no conservó el cambio de favorita de «') + t.name + tx('». Revisa el servidor (permisos o registro de errores).'), 6500);
    } catch { }
  }, 4000);
}
function updateDlBtn() {
  const b = $('#sDlBtn'); if (!b) return;
  b.hidden = !DL.usable();
  const e = P.cur && DL.get(P.cur.id);
  b.classList.toggle('on', !!e && e.state === 'done');
  b.classList.toggle('dim', !!e && e.state !== 'done');
  b.querySelector('span').textContent = dlStatusShort(e);
  b.title = e ? dlStatus(e) : tx('Descargar'); // el detalle (esperando Wi-Fi, etc.) queda como texto de ayuda
}
function dlAddToast(t, r) {
  if (r === 'full') { toast(tx('Ya tienes {0} canciones guardadas. Sube el máximo o quita algunas en Ajustes → Descargas.', [Settings.dlMax]), 5000); return; }
  if (r === 'bad') { toast(tx('No se pudo descargar «') + t.name + tx('»: la dirección no es válida.'), 4500); return; }
  if (r !== 'ok') return;
  // Si empieza ya, el botón muestra el porcentaje: no hace falta aviso. Solo se avisa si va a esperar.
  const net = DL.net();
  if (net === 'none') toast(tx('Se descargará cuando tengas conexión'), 3500);
  else if (net === 'cellular' && Settings.dlWifi) toast(tx('Se descargará cuando te conectes a Wi-Fi'), 3500);
}
function dlTap() {
  const t = P.cur; if (!t || !DL.usable()) return;
  const e = DL.get(t.id);
  if (!e) { dlAddToast(t, DL.add(t)); return; }
  menu(t, [
    ...(e.state === 'error' ? [[tx('Reintentar la descarga'), 'refresh', () => dlAddToast(t, DL.add(t))]] : []),
    ...(e.auto && e.state === 'done' ? [[tx('Conservarla siempre'), 'check', () => { DL.add(t); toast(tx('Ya no se borrará sola')); }]] : []),
    [e.state === 'done' ? tx('Quitar de las descargas') : tx('Cancelar la descarga'), 'x', () => { DL.remove(t.id); toast(e.state === 'done' ? tx('Se quitó del teléfono') : tx('Descarga cancelada')); }],
    [tx('Gestionar descargas'), 'download', () => go('downloads', {}, { push: true })]
  ]);
}
/* Probar conexión: separa "el servidor no responde", "tarda en preparar el audio",
   "la red es lenta" y "lo pequeño llega pero lo grande se atora" (típico de MTU en IPv6). */
async function connTest() {
  if (api.kind !== 'jellyfin') return;
  const v6 = api.base.includes('['), ctrl = new AbortController();
  let open = true;
  const s = document.createElement('div'); s.className = 'scrim'; s.style.alignItems = 'center';
  s.innerHTML = `<div class="dialog ctest"><h3>${tx('Probar conexión')}</h3><div class="muted" style="font-size:12.5px;margin:-8px 0 14px;overflow-wrap:anywhere">${esc(api.base)}${v6 ? ' · IPv6' : ''}</div><ol class="ctl"></ol><div class="cverdict"></div><div class="btns"><button type="button" class="btn" data-c>${tx('Cerrar')}</button></div></div>`;
  s.onclick = e => { if (e.target === s || e.target.closest('[data-c]')) { open = false; ctrl.abort(); s.remove(); } };
  document.body.appendChild(s);
  const list = s.querySelector('.ctl'), verdict = s.querySelector('.cverdict');
  const line = label => { const li = document.createElement('li'); li.innerHTML = `${esc(label)}<span>…</span>`; list.appendChild(li); return (txt, cls = 'ok') => { li.className = cls; li.querySelector('span').textContent = txt; }; };
  const kb = b => b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
  const withTimeout = (ms, fn) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); ctrl.signal.addEventListener('abort', () => c.abort()); return fn(c.signal).finally(() => clearTimeout(t)); };
  // Lee el cuerpo midiendo cuánto llega y si se queda quieto.
  // Hasta `first` ms para que empiece (el servidor puede estar convirtiendo); después, `stall` ms sin datos = atorada.
  async function pull(url, { max = 2e6, total = 25000, first = 15000, stall = 6000, headers } = {}) {
    const r = { ttfb: 0, bytes: 0, ms: 0, stalled: false, noStart: false, status: 0, error: '' }, t0 = performance.now();
    const c = new AbortController(); ctrl.signal.addEventListener('abort', () => c.abort());
    let last = t0;
    const timer = setInterval(() => {
      const now = performance.now();
      if (!r.ttfb && now - t0 > first) { r.noStart = true; c.abort(); }
      else if (r.ttfb && (now - last > stall || now - t0 > total)) { r.stalled = now - last > stall; c.abort(); }
    }, 250);
    try {
      const res = await fetch(url, { signal: c.signal, cache: 'no-store', headers });
      r.status = res.status; r.ttfb = performance.now() - t0; last = performance.now(); r.type = (res.headers.get('content-type') || '').split(';')[0];
      const rd = res.body.getReader();
      while (r.bytes < max) { const { done, value } = await rd.read(); if (done) break; r.bytes += value.length; last = performance.now(); }
      try { rd.cancel(); } catch { }
    } catch (e) { if (!r.stalled && !r.noStart && !c.signal.aborted) r.error = e.message || 'error'; }
    clearInterval(timer); r.ms = performance.now() - t0;
    return r;
  }

  // Prueba con un <audio> real (silenciado): así arranca el reproductor de verdad, con sus saltos (Range) y su decodificador.
  function playerProbe(url, ms = 20000) {
    return new Promise(resolve => {
      const a = new Audio(); a.muted = true; a.preload = 'auto';
      const t0 = performance.now(); let waits = 0, done = false, to;
      const end = r => { if (done) return; done = true; clearTimeout(to); try { a.pause(); a.removeAttribute('src'); a.load(); } catch { } resolve({ ...r, waits, ms: performance.now() - t0 }); };
      a.addEventListener('waiting', () => waits++); a.addEventListener('stalled', () => waits++);
      a.addEventListener('playing', () => end({ ok: true }));
      a.addEventListener('error', () => end({ ok: false, err: a.error ? tx('código ') + a.error.code + (a.error.message ? ' (' + a.error.message + ')' : '') : tx('desconocido') }));
      to = setTimeout(() => end({ ok: false, timeout: true }), ms);
      ctrl.signal.addEventListener('abort', () => end({ ok: false, aborted: true }));
      a.src = url; a.play().catch(e => { if (e.name !== 'AbortError') end({ ok: false, err: e.name }); });
    });
  }

  // 1. API (respuestas pequeñas)
  const setApi = line(tx('Respuesta del servidor'));
  const times = [];
  for (let k = 0; k < 3 && open; k++) {
    const t0 = performance.now();
    try { const r = await withTimeout(8000, sig => fetch(api.base + '/System/Info/Public', { signal: sig, cache: 'no-store' })); await r.text(); times.push(performance.now() - t0); } catch { }
  }
  if (!open) return;
  if (!times.length) { setApi(tx('sin respuesta'), 'bad'); verdict.innerHTML = `<b>${tx('El servidor no responde.')}</b> ${tx('Revisa que esté encendido y que este teléfono tenga conexión')} ${v6 ? tx('IPv6 (muchas redes Wi-Fi públicas y algunas de datos móviles solo dan IPv4)') : tx('con él')}.`; return; }
  times.sort((a, b) => a - b); const apiMs = times[Math.floor(times.length / 2)];
  setApi(Math.round(apiMs) + ' ms', apiMs > 800 ? 'warn' : 'ok');

  // Canción de prueba: la actual o una al azar.
  let t = P.cur;
  if (!t) try { t = (await api.tracks({ limit: 1, sort: 'random' })).items[0]; } catch { }
  if (!open) return;
  if (!t) { verdict.textContent = tx('No encontré canciones para probar la descarga.'); return; }

  // 2. Carátula (respuesta mediana)
  let img = null;
  const iu = api.img(t, 600);
  if (iu) {
    const setImg = line(tx('Carátula'));
    img = await pull(iu, { max: 5e6, total: 15000 });
    if (!open) return;
    setImg(img.error ? tx('falló') : img.noStart ? tx('no llegó') : img.stalled ? tx('se atoró en {0}', [kb(img.bytes)]) : tx('{0} en {1} s', [kb(img.bytes), (img.ms / 1000).toFixed(1)]), img.error || img.stalled || img.noStart ? 'bad' : 'ok');
  }

  // 3. Audio, con la calidad elegida
  const setTtfb = line(tx('Primeros datos del audio')), setRate = line(tx('Velocidad de descarga'));
  const au = await pull(api.streamUrl(t, Settings.quality, 'test' + uid()), { max: 2e6 });
  if (!open) return;
  if (au.error || (au.status && au.status >= 400)) { setTtfb(au.status ? 'error ' + au.status : tx('falló'), 'bad'); setRate('—', 'bad'); }
  else {
    setTtfb(au.ttfb ? (au.ttfb / 1000).toFixed(1) + ' s' : tx('más de 15 s'), !au.ttfb ? 'bad' : au.ttfb > 4000 ? 'warn' : 'ok');
    const kbps = au.bytes * 8 / Math.max(0.1, au.ms - au.ttfb); // bytes·8/ms = kbit/s
    setRate(au.noStart ? '—' : au.stalled ? tx('se atoró en {0}', [kb(au.bytes)]) : `${Math.round(kbps)} kbit/s (${kb(au.bytes)})`, au.stalled || au.noStart ? 'bad' : 'ok');
    au.kbps = kbps;
  }

  // 4. Formato, saltos y reproductor real
  let rng = null, pl = null;
  if (!au.error && !au.noStart && !(au.status >= 400)) {
    line(tx('Formato que manda el servidor'))(au.type || tx('desconocido'), 'ok');
    const setRng = line(tx('Saltar dentro de la canción'));
    rng = await pull(api.streamUrl(t, Settings.quality, 'test' + uid()), { max: 64e3, headers: { Range: 'bytes=300000-' } });
    if (!open) return;
    setRng(rng.status === 206 ? tx('sí ({0} ms)', [Math.round(rng.ttfb)]) : rng.status ? tx('no lo admite ({0})', [rng.status]) : tx('falló'), rng.status === 206 ? 'ok' : 'warn');
    const setPl = line(tx('Arranque del reproductor'));
    pl = await playerProbe(api.streamUrl(t, Settings.quality, 'test' + uid()));
    if (!open) return;
    setPl(pl.ok ? `${(pl.ms / 1000).toFixed(1)} s` + (pl.waits ? ` · ${pl.waits} ${pl.waits === 1 ? tx('espera') : tx('esperas')}` : '') : pl.timeout ? tx('no empezó en 20 s') : 'error ' + (pl.err || ''), !pl.ok ? 'bad' : pl.ms > 5000 ? 'warn' : 'ok');
  }

  // Diagnóstico
  const need = +Settings.quality >= 1e7 ? 1100 : +Settings.quality / 1000;
  const mtu = v6 ? tx(' Esto pasa mucho con IPv6 cuando los paquetes grandes se pierden en el camino (MTU): el router o el firewall bloquean el aviso ICMPv6 «Packet Too Big», o hay un túnel/PPPoE con MTU menor a 1500.') : '';
  let v;
  if ((au.stalled && au.bytes < 300e3) || (img && img.stalled && img.bytes < 300e3))
    v = `<b>${tx('Lo pequeño llega, pero las descargas grandes se atoran.')}</b>${mtu}<br><br>${tx('Para confirmarlo, en el servidor baja la MTU un momento (')}<code>${tx('sudo ip link set dev &lt;interfaz&gt; mtu 1280')}</code>${tx(') y vuelve a probar: si ahora funciona, la solución es permitir ICMPv6 tipo 2 en el firewall o activar «MSS clamping» en el router.')}`;
  else if (au.error || (au.status && au.status >= 400))
    v = `<b>${tx('El servidor no pudo entregar el audio')}${au.status ? ' (error ' + au.status + ')' : ''}.</b> ${tx('Revisa que ffmpeg funcione en Jellyfin y que tu usuario pueda reproducir.')}`;
  else if (pl && !pl.ok && !pl.timeout && !pl.aborted)
    v = /mpeg|mp3/.test(au.type || '')
      ? `<b>${tx('La descarga funciona, pero el MP3 que manda el servidor no se pudo reproducir')}</b> (${esc(pl.err || '')}${tx('). Puede que ese archivo esté dañado: prueba con otra canción.')}`
      : `<b>${tx('La descarga funciona, pero este dispositivo no pudo reproducir el formato')} ${esc(au.type || '')}</b> (${esc(pl.err || '')}${tx('). Elige')} <b>${tx('320 kbps')}</b> ${tx('en Ajustes → Calidad del streaming: Jellyfin la convertirá a MP3, que se reproduce en cualquier lado.')}`;
  else if (pl && (pl.timeout || pl.ms > 5000))
    v = `<b>${tx('La red está bien (')}${Math.round(au.kbps || 0)} ${tx('kbit/s), pero el reproductor tarda')} ${pl.timeout ? tx('más de 20 s') : (pl.ms / 1000).toFixed(0) + ' s'} ${tx('en arrancar con este formato (')}${esc(au.type || tx('desconocido'))}).</b>${rng && rng.status !== 206 ? tx(' Además el servidor no permite saltar dentro del archivo, y algunos formatos (como M4A con el índice al final) lo necesitan para empezar.') : ''} ${tx('Elige')} <b>${tx('320 kbps')}</b> ${tx('en Ajustes → Calidad del streaming: Jellyfin mandará MP3, que empieza casi al instante.')}`;
  else if (au.noStart)
    v = `<b>${tx('El servidor no empezó a mandar el audio en 15 s.')}</b> ${tx('Como lo demás sí responde, lo más probable es que Jellyfin se quede preparando la conversión: revisa que ffmpeg funcione (Panel → Reproducción → Transcodificación) y prueba la calidad «Original» en Ajustes.')}`;
  else if (au.ttfb > 4000)
    v = `<b>${tx('El servidor tarda')} ${(au.ttfb / 1000).toFixed(0)} ${tx('s en empezar a mandar el audio.')}</b> ${tx('Suele ser la conversión (transcodificación). Prueba la calidad «Original» en Ajustes, y en Jellyfin agrega la red')} ${v6 ? tx('IPv6 (tu prefijo) ') : ''}${tx('de tu casa en Panel → Redes → «Redes LAN», para que no aplique el límite de bitrate para Internet.')}`;
  else if (au.kbps && au.kbps < need)
    v = `<b>${tx('La conexión (')}${Math.round(au.kbps)} ${tx('kbit/s) es más lenta que la calidad elegida.')}</b> ${tx('Baja la calidad del streaming en Ajustes o descarga las canciones con Wi-Fi.')}`;
  else
    v = `<b>${tx('La conexión se ve bien.')}</b> ${tx('Si una canción sigue sin empezar, puede ser ese archivo en particular; tócala de nuevo o prueba con otra.')}`;
  verdict.innerHTML = v;
}
// ---- Radio, playlists y opciones de una canción (menú de ⋮, de la lista y de la cola) ----
async function startRadio(t) {
  if (!t || !api.instantMix) return;
  toast(tx('Armando la radio de «') + t.name + '»…', 2500);
  let mix;
  try { mix = (await api.instantMix(t.id)).filter(x => x.id !== t.id); } catch (e) { toast(tx('No se pudo armar la radio: ') + e.message, 5000); return; }
  if (!mix.length) { toast(tx('Jellyfin no encontró canciones parecidas a «') + t.name + '».', 4500); return; }
  DJ.stop(true);
  if (RC.remote) { RC.playQueue([t, ...mix], 0); }
  else if (P.cur && P.cur.id === t.id && P.audio.src) {
    // Ya está sonando: sigue sin cortarse y la cola se vuelve su radio.
    P.queue = [P.cur, ...mix.map(x => ({ ...x, qid: uid() }))]; P.i = 0; saveQueue(); renderQueueAll(); markCurrent();
  } else setQueue([t, ...mix], 0);
  toast(tx('Radio de «') + t.name + '»: ' + mix.length + tx(' canciones parecidas'), 3500);
}
async function addToPlaylistMenu(tracks) {
  tracks = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean);
  if (!tracks.length || !api.addToPlaylist) return;
  const ids = tracks.map(t => t.id), what = tracks.length === 1 ? '«' + tracks[0].name + '»' : tracks.length + tx(' canciones');
  let pls = [];
  try { pls = await cached('playlists', () => api.playlists()); } catch (e) { toast(tx('No se pudieron cargar tus playlists: ') + e.message, 4500); return; }
  const done = (name, plId) => { playlistsChanged(plId); toast(what + tx(' se agregó a «') + name + '»'); };
  const items = [[tx('Nueva playlist…'), 'plus', () => askName(tx('Nueva playlist'), tracks.length === 1 ? tracks[0].name : tx('Nueva playlist'), async name => {
    try { done(name, await api.savePlaylist(name, ids)); } catch (e) { toast(tx('No se pudo crear la playlist: ') + e.message, 5000); }
  })]];
  for (const p of pls) items.push([p.name + (p.count != null ? ' · ' + p.count : ''), 'list', async () => {
    try { await api.addToPlaylist(p.id, ids); done(p.name, p.id); } catch (e) { toast(tx('No se pudo agregar a «') + p.name + '»: ' + e.message, 5000); }
  }]);
  menu(null, items, `<div class="mh"><div style="min-width:0"><div class="t">${tx('Agregar a una playlist')}</div><div class="muted" style="font-size:12.5px">${esc(what)}</div></div></div>`);
}
function songOptions(t) {
  const o = [[tx('Iniciar radio de la canción'), 'radio', () => startRadio(t)], [tx('Agregar a una playlist'), 'list', () => addToPlaylistMenu([t])]];
  if (api.setFavorite) o.push([t.fav ? tx('Quitar de favoritas') : tx('Agregar a favoritas'), 'heart', () => toggleFav(t)]);
  if (PG.state === 'on') o.push([tx('Mandar a la fiesta'), 'party', () => PG.add(t)]);
  return o;
}
// Menú de una canción de la cola (clic derecho o mantener presionado).
function queueMenu(i) {
  const t = P.queue[i]; if (!t) return;
  const items = [];
  if (i !== P.i) items.push([tx('Reproducir ahora'), 'play', () => playIndex(i)]);
  if (i !== P.i && i !== P.i + 1 && !RC.remote) items.push([tx('Reproducir a continuación'), 'next-up', () => {
    const [x] = P.queue.splice(i, 1); if (i < P.i) P.i--; P.queue.splice(P.i + 1, 0, x); saveQueue(); renderQueueAll(); toast(tx('Sonará a continuación'));
  }]);
  items.push(...songOptions(t));
  if (t.albumId || t.album) items.push([tx('Ir al álbum'), 'disc', () => go('album', { id: t.albumId, tid: t.id }, { push: true })]);
  if (t.artistId || t.artist) items.push([tx('Ir al artista'), 'user', () => go('artist', { id: t.artistId, name: t.artist || t.trackArtist }, { push: true })]);
  items.push([tx('Quitar de la cola'), 'x', () => removeAt(i)]);
  menu(t, items);
}
function trackMenu(t) {
  const items = [[tx('Reproducir a continuación'), 'next-up', () => addToQueue([t], true)], [tx('Añadir a la cola'), 'qadd', () => addToQueue([t])]];
  if (DL.usable()) items.push(DL.get(t.id) ? [tx('Quitar de las descargas'), 'x', () => { DL.remove(t.id); toast(tx('Se quitó del teléfono')); }] : [tx('Descargar'), 'download', () => dlAddToast(t, DL.add(t))]);
  items.push(...songOptions(t));
  if (t.albumId || t.album) items.push([tx('Ir al álbum'), 'disc', () => go('album', { id: t.albumId, tid: t.id }, { push: true })]);
  if (t.artistId || t.artist) items.push([tx('Ir al artista'), 'user', () => go('artist', { id: t.artistId, name: t.artist || t.trackArtist }, { push: true })]);
  menu(t, items);
}
function askConfirm(text, ok, cb) {
  const s = document.createElement('div'); s.className = 'scrim'; s.style.alignItems = 'center';
  s.innerHTML = `<div class="dialog"><h3>${esc(text)}</h3><div class="btns"><button type="button" class="btn" data-c>${tx('Cancelar')}</button><button type="button" class="btn pri" data-ok>${esc(ok)}</button></div></div>`;
  s.onclick = e => { if (e.target === s || e.target.closest('[data-c]')) s.remove(); else if (e.target.closest('[data-ok]')) { s.remove(); cb(); } };
  document.body.appendChild(s);
}
function askName(title, def, cb) {
  const s = document.createElement('div'); s.className = 'scrim'; s.style.alignItems = 'center';
  s.innerHTML = `<form class="dialog"><h3>${esc(title)}</h3><input class="inp" value="${esc(def)}" required maxlength="120"><div class="btns"><button type="button" class="btn" data-c>${tx('Cancelar')}</button><button class="btn pri">${tx('Guardar')}</button></div></form>`;
  const f = s.querySelector('form'), i = s.querySelector('input');
  s.onclick = e => { if (e.target === s || e.target.closest('[data-c]')) s.remove(); };
  f.onsubmit = e => { e.preventDefault(); const v = i.value.trim(); if (v) { s.remove(); cb(v); } };
  document.body.appendChild(s); setTimeout(() => { i.focus(); i.select(); }, 30);
}
function openSheet(lyr = false) {
  if (!P.cur) return; if (BEAR.playing) nqBurst(6000);
  const sh = $('#sheet');
  // El modo (letra o portada) se pone ANTES de abrir y sin la transición de la letra: si se cruzaban, esa transición
  // tapaba el deslizamiento hacia arriba («a veces no se veía»).
  if (!!lyr !== !!LY.mode || (lyr && sh.classList.contains('qmode'))) applyLyricsMode(!!lyr);
  void sh.offsetWidth; // parte de abajo
  sh.classList.add('open'); $$('.lyrbtn').forEach(b => b.classList.toggle('on', !!lyr)); sh.setAttribute('aria-hidden', 'false'); try { history.pushState({ sheet: 1 }, ''); } catch { } requestAnimationFrame(drawWaves); }
function closeSheet() { if (SY.on) syncEnd(); $$('.lyrbtn').forEach(b => b.classList.remove('on')); $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden', 'true'); }

/* =========================================================
   Fiesta (Nanuq watch party): una computadora (la app de escritorio) abre una sala; los teléfonos de tu red entran con
   un código de 6 dígitos y le mandan canciones de SU propio Jellyfin (el teléfono la baja de su servidor y se la pasa a
   la computadora por la red local). La computadora las pone una tras otra y, cada segundo, les cuenta a los teléfonos
   en qué segundo va y qué línea de la letra toca (karaoke). La red y los archivos viven en linux/main.js («Fiesta»).
   Todo lo que llega por la red de la sala se trata como no confiable: textos acotados y siempre esc().
   ========================================================= */
const PARTY_PORT = 47864;
const partyHost = () => !!(window.nanuqDesktop && window.nanuqDesktop.party);
const partyGuest = () => !partyHost() && !!window.NanuqAndroid;
const partyOn = () => partyHost() || partyGuest();
// Canción para mandar a la fiesta: MP3 320 kbps (se reproduce en cualquier lado y pesa poco).
function partySongUrl(t) {
  const q = new URLSearchParams({ UserId: api.userId, DeviceId: deviceId(), ApiKey: api.token, api_key: api.token, MaxStreamingBitrate: 320000, Container: 'mp3', TranscodingContainer: 'mp3', TranscodingProtocol: 'http', AudioCodec: 'mp3', PlaySessionId: 'party' + uid() });
  return `${api.base}/Audio/${sid(t.id)}/universal?${q}`;
}
// Carátula para la fiesta: una miniatura JPEG de 240 px dibujada aquí (de tu Jellyfin o de tus descargas). Viaja con la
// canción como data: (≤ 150 KB); si no se puede, la canción va sin carátula.
async function partyCover(t) {
  const u = api && api.img(t, 300); if (!u) return '';
  const img = await Recap.loadImg(u); if (!img || !img.width || !img.height) return '';
  const c = document.createElement('canvas'); c.width = c.height = 240;
  const k = Math.max(240 / img.width, 240 / img.height), w = img.width * k, h = img.height * k;
  c.getContext('2d').drawImage(img, (240 - w) / 2, (240 - h) / 2, w, h);
  const d = c.toDataURL('image/jpeg', .82);
  return /^data:image\/jpeg;base64,/.test(d) && d.length < 150000 ? d : '';
}
// Carátula que sirve la computadora de la fiesta (solo desde su servidor interno, con el token de la sala).
const partyCoverOk = u => /^http:\/\/127\.0\.0\.1:\d{1,5}\/fiesta\/[0-9a-f]{32}\/[0-9a-f]{8}\/c$/.test(String(u || ''));
const PT_STATES = { uploading: tx('Llegando'), closing: tx('Llegando'), ready: tx('En la lista'), playing: tx('Sonando') };
// Estado que manda la computadora (para el teléfono): limpio y acotado.
function partyClean(m) {
  const s = (v, n) => String(v ?? '').slice(0, n);
  const list = (Array.isArray(m.list) ? m.list.slice(0, 100) : []).filter(e => e && /^[0-9a-f]{8}$/.test(String(e.id))).map(e => ({
    id: String(e.id), title: s(e.title, 200) || tx('Sin título'), artist: s(e.artist, 200), album: s(e.album, 200), duration: Math.max(0, Math.min(num(e.duration), 6 * 3600)),
    by: s(e.by, 20), byName: s(e.byName, 24), state: Object.hasOwn(PT_STATES, e.state) ? e.state : 'ready', mb: Math.max(0, num(e.mb)), hasCover: !!e.hasCover }));
  const guests = (Array.isArray(m.guests) ? m.guests.slice(0, 30) : []).map(g => ({ id: s(g && g.id, 20), name: s(g && g.name, 24), theme: Object.hasOwn(THEMES, String(g && g.theme)) ? String(g.theme) : 'navy', away: !!(g && g.away) }));
  const now = m.now && typeof m.now === 'object' && /^[0-9a-f]{8}$/.test(String(m.now.id)) ? { id: String(m.now.id), playing: !!m.now.playing } : null;
  return { room: s(m.room, 60), list, guests, now };
}
// Al abrir la fiesta en la computadora: tu música se DETIENE (no solo se pausa): con algo en pausa, los controles
// multimedia del sistema seguían a la vista y se podía reanudar desde ahí. Se guarda el segundo para seguir después; si
// estabas controlando otro dispositivo, se suelta.
function stopForParty() {
  if (RC.remote) RC.leave();
  QPOS.save(true); fadeStop(); DJ.stop(true);
  if (P.cur && P.audio.getAttribute('src')) api.report('stop', P.cur, ptime());
  P.pause(); P.audio.removeAttribute('src'); try { P.audio.load(); } catch { } P.extPause = null; P.audio.volume = userVol();
  sessionHold('off'); rcKeepOff();
  if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch { }
  updatePlayState(); DISC.update();
}
// ---- Anfitrión (computadora) ----
const PH = {
  st: { open: false }, audio: new Audio(), cur: null, L: null, T: null, paused: false, tickT: 0, lyrSeq: 0,
  // own: la fiesta es lo que manejan los controles (los de Nanuq, la barra espaciadora y los del sistema). Deja de serlo
  // si pones tu propia música, y vuelve al reanudar la fiesta o al empezar su siguiente canción.
  own: false, shown: false,
  active() { return !!this.st.open && !!this.cur && this.own; },
  init() {
    if (!partyHost()) return;
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.done());
    this.audio.addEventListener('error', () => { if (this.cur && this.audio.getAttribute('src')) { toast(tx('No se pudo reproducir «') + this.cur.title + tx('»: sigue la próxima.'), 4500); this.done(); } });
    for (const ev of ['play', 'pause']) this.audio.addEventListener(ev, () => { this.report(); renderPartySoon(); updatePlayState(); });
    // Pausa que no pidió Nanuq (otra app tomó la salida de audio): al reanudar se recarga la canción en el mismo segundo.
    this.audio.addEventListener('pause', () => { if (this.cur && !this.audio.ended && Date.now() - (this.ownPauseAt || 0) > 1500) this.extPause = this.cur.id; });
    this.audio.volume = Settings.volume; this.audio.muted = P.audio.muted;
    nanuqDesktop.party.on(ev => this.onEv(ev));
    nanuqDesktop.party.op({ op: 'status' }).then(s => s && this.apply(s)).catch(() => { });
  },
  onEv(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'state') this.apply(ev);
    else if (ev.type === 'join' && ev.guest) toast(String(ev.guest.name).slice(0, 24) + tx(' llegó a la fiesta'), 3000);
    else if (ev.type === 'leave' && ev.guest) toast(String(ev.guest.name).slice(0, 24) + tx(' salió de la fiesta'), 2500);
  },
  apply(s) {
    this.st = s && s.open ? s : { open: false };
    // Con la sala abierta, la computadora solo muestra la fiesta: sin menú lateral, cola ni reproductor (se ocultan y no
    // se pueden usar) hasta que la cierras.
    const was = document.body.classList.contains('party-host');
    document.body.classList.toggle('party-host', !!this.st.open);
    if (this.st.open && !was) { closeSheet(); $('#queue').classList.remove('open'); stopForParty(); if (cur()?.name !== 'party' || S.stack.length > 1) go('party', {}, { root: true }); }
    if (!this.st.open && was) { P.resume = QPOS.restore(); if (P.resume) P.dragSec = P.resume.sec; updateNow(); } // tu cola vuelve, lista para seguir en el mismo segundo
    if (!this.st.open) { this.stopCur(true); clearInterval(this.tickT); this.tickT = 0; }
    else if (!this.tickT) this.tickT = setInterval(() => this.tick(), 1000);
    this.next(); renderPartySoon();
  },
  list() { return this.st.open ? this.st.list || [] : []; },
  async open() {
    const who = api && api.kind === 'jellyfin' && api.userName ? api.userName : 'Nanuq';
    const s = await nanuqDesktop.party.op({ op: 'open', name: tx('Fiesta de ') + who }).catch(e => ({ open: false, error: e.message }));
    if (!s || !s.open) { toast(tx('No se pudo abrir la fiesta: ') + tx((s && s.error) || 'error'), 5000); return; }
    this.paused = false; this.apply(s);
  },
  close() { nanuqDesktop.party.op({ op: 'close' }).catch(() => { }); },
  // Elegiste una canción de «A continuación»: la que suena y las anteriores se saltan (y se borran) y suena esa.
  jump(e) {
    if (!e) return;
    if (e.state !== 'ready') { toast('«' + e.title + tx('» todavía está llegando.'), 3000); return; }
    this.paused = false; this.own = true;
    nanuqDesktop.party.op({ op: 'jump', id: e.id }).catch(() => { });
  },
  order(ids) { nanuqDesktop.party.op({ op: 'order', ids }).catch(() => { }); },
  // Sigue la lista: si la que sonaba ya no está, se corta; si no suena nada, la primera que ya llegó completa.
  next() {
    if (!this.st.open) return;
    const l = this.list();
    if (this.cur && !l.some(e => e.id === this.cur.id)) this.stopCur();
    if (this.cur || this.paused) return;
    const n = l.find(e => e.state === 'ready' && e.url); if (n) this.play(n);
  },
  play(e) {
    this.cur = e; this.L = null; this.T = null; this.own = true;
    if (!P.audio.paused) P.pause(); // la fiesta manda: tu propia cola se pausa
    this.ownPauseAt = Date.now(); this.extPause = null;
    this.audio.src = e.url; this.audio.volume = Settings.volume; this.audio.muted = P.audio.muted;
    this.audio.play().catch(() => { });
    this.loadLyrics(e); this.report(); this.media();
  },
  stopCur(silent) {
    if (!this.cur) return; this.cur = null; this.L = null; this.T = null; this.lyrSeq++;
    this.ownPauseAt = Date.now(); this.extPause = null;
    try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch { }
    if (!silent) this.report();
    this.media();
  },
  // Terminó de sonar (o se saltó): la computadora la borra de su disco y pasa a la siguiente.
  done() { const e = this.cur; this.stopCur(); if (e) nanuqDesktop.party.op({ op: 'played', id: e.id }).catch(() => { }); },
  toggle() {
    if (!this.cur) { this.paused = false; this.next(); renderPartySoon(); return; }
    if (this.audio.paused) {
      this.paused = false; this.own = true; if (!P.audio.paused) P.pause();
      if (this.extPause === this.cur.id) { // salida de audio muerta: misma canción, mismo segundo, salida nueva
        const t = this.audio.currentTime, a = this.audio; this.extPause = null; this.ownPauseAt = Date.now();
        a.src = this.cur.url; a.addEventListener('loadedmetadata', () => { try { a.currentTime = t; } catch { } }, { once: true });
      }
      this.audio.play().catch(() => { }); this.media();
    }
    else { this.paused = true; this.ownPauseAt = Date.now(); this.audio.pause(); }
  },
  // Pusiste tu propia música: la fiesta se pausa y los controles vuelven a tu cola (aunque la fiesta ya estuviera en pausa).
  yieldTo() {
    if (!this.cur) return;
    if (!this.audio.paused) { this.paused = true; this.ownPauseAt = Date.now(); this.audio.pause(); }
    if (this.own) { this.own = false; this.media(); }
  },
  // Controles del sistema (MPRIS, barra de tareas, teclas multimedia): la canción de la fiesta mientras ella manda; si no,
  // otra vez la tuya.
  media() {
    if (this.active()) {
      this.shown = true;
      if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = new MediaMetadata({ title: this.cur.title, artist: this.cur.artist || '', album: this.cur.album || '', artwork: [partyCoverOk(this.cur.cover) ? { src: this.cur.cover, sizes: '240x240', type: 'image/jpeg' } : { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] }); } catch { }
      updatePlayState();
    } else if (this.shown) {
      this.shown = false;
      // Con la sala abierta y sin canción de la fiesta: sin controles del sistema (tu música está detenida).
      if (partyHostOpen()) { if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch { } updatePlayState(); }
      else updateNow();
    }
  },
  report() {
    if (!this.st.open) return;
    nanuqDesktop.party.op({ op: 'now', id: this.cur ? this.cur.id : null, playing: !!this.cur && !this.audio.paused }).catch(() => { });
    this.tick();
  },
  async loadLyrics(e) {
    const seq = ++this.lyrSeq;
    if (!e.hasLyrics) return;
    const raw = await nanuqDesktop.party.op({ op: 'lyrics', id: e.id }).catch(() => '');
    if (seq !== this.lyrSeq || this.cur !== e || !raw) return;
    let L = null; try { L = lyricsFromText(cleanLyricsText(raw)); } catch { }
    if (!L) return;
    this.L = L; this.T = L.synced ? L.lines.map(l => l.t) : estimateTimes(L.lines, e.duration || this.audio.duration);
  },
  // [línea que toca ahora, la siguiente]
  line() {
    const L = this.L, T = this.T; if (!L || !T) return ['', ''];
    const now = this.audio.currentTime + (L.synced ? 0.25 : 0); let i = -1;
    for (let k = 0; k < T.length; k++) { if (T[k] <= now) i = k; else break; }
    const txt = k => { const l = L.lines[k]; return l ? (l.text || '♪') : ''; };
    return [i >= 0 ? txt(i) : '', txt(i + 1)];
  },
  // Cada segundo: el karaoke para los teléfonos (tiempo de la canción y la línea de la letra).
  tick() {
    if (!this.st.open || !this.cur) return;
    const [line, nxt] = this.line(), d = isFinite(this.audio.duration) && this.audio.duration ? this.audio.duration : this.cur.duration || 0;
    nanuqDesktop.party.op({ op: 'tick', id: this.cur.id, pos: this.audio.currentTime, dur: d, playing: !this.audio.paused, line, next: nxt }).catch(() => { });
    partyPaintTick({ pos: this.audio.currentTime, dur: d, line, next: nxt });
  }
};
// ---- Invitado (teléfono) ----
const PG = {
  ws: null, st: null, you: null, key: '', url: '', code: '', room: '', state: 'off', why: '', tick: null, up: null, retry: 0, retryT: 0, found: null, finding: false, wait: new Map(), bye: false, chunk: 262144,
  connect(url, code) {
    this.leave(true);
    this.url = url; this.code = code || ''; this.state = 'connecting'; this.why = ''; this.bye = false; renderPartySoon();
    let ws; try { ws = new WebSocket(url); } catch { this.state = 'off'; this.why = tx('Esa dirección no es válida.'); renderPartySoon(); return; }
    ws.binaryType = 'arraybuffer'; this.ws = ws; this.everOn = false; this.ui();
    const to = setTimeout(() => { if (this.ws === ws && this.state === 'connecting') try { ws.close(); } catch { } }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, code: this.code, key: this.key || undefined, name: (api && api.kind === 'jellyfin' && api.userName) || deviceName(), theme: Settings.theme }));
    ws.onmessage = ev => { if (typeof ev.data !== 'string' || ev.data.length > 2e6) return; let m; try { m = jparse(ev.data); } catch { return; } if (m && typeof m === 'object') try { this.onMsg(m); } catch { } };
    ws.onclose = () => {
      clearTimeout(to);
      if (this.ws !== ws) return;
      // Último contacto con la sala: desde aquí se cuentan las 2 h (también si Android cierra la app y se vuelve a abrir).
      if (this.state === 'on' && this.key) { this.lastOn = Date.now(); store.set('party', { url: this.url, key: this.key, room: this.room, at: this.lastOn }); }
      this.ws = null; this.state = 'off'; this.abortUp();
      // Se cortó la red o el teléfono se durmió (no te sacaron): sigues en la fiesta y vuelves a entrar solo, con tu llave,
      // sin el código. Se reintenta mientras la computadora conserve tu lugar (2 h); también al despertar el teléfono.
      // Más de 2 h sin poder volver (la computadora ya liberó tu lugar): se deja de intentar.
      if (!this.bye && this.key && Date.now() - (this.lastOn || Date.now()) > 2 * 3600e3) { this.key = ''; store.del('party'); this.why = tx('Se perdió la conexión con la fiesta.'); }
      // Si no logra volver a entrar (la computadora cerró la fiesta o se apagó, aunque no se pudo avisar porque el teléfono
      // estaba bloqueado): unos pocos intentos rápidos (≈ 30 s con la app a la vista) y luego sale con aviso. Con la app en
      // segundo plano los intentos no cuentan (al despertar se vuelve a intentar).
      if (!this.bye && this.key && !this.everOn && document.visibilityState === 'visible' && RC.visible !== false && ++this.fails >= 6) { this.key = ''; store.del('party'); this.why = tx('La fiesta ya no está disponible: la computadora la cerró o se apagó.'); toast(this.why, 5000); }
      if (!this.bye && this.key) { this.state = 'connecting'; clearTimeout(this.retryT); this.retryT = setTimeout(() => { this.retryT = 0; this.connect(this.url, ''); }, [1500, 3000, 5000, 8000, 12000][Math.min(this.retry++, 4)]); }
      else if (!this.why) this.why = tx('No hubo respuesta de la fiesta en ') + this.url.replace(/^ws:\/\//, '').replace(/\/fiesta$/, '') + tx('. Revisa que estés en la misma red Wi-Fi.');
      this.ui(); renderPartySoon();
    };
  },
  leave(keep) {
    clearTimeout(this.retryT); this.retryT = 0;
    const ws = this.ws; this.ws = null;
    if (ws) { if (!keep && ws.readyState === 1) try { ws.send(JSON.stringify({ t: 'leave' })); } catch { } try { ws.close(); } catch { } }
    this.abortUp(); this.state = 'off'; this.st = null; this.tick = null;
    if (!keep) { this.key = ''; this.retry = 0; this.why = ''; store.del('party'); }
    this.ui();
  },
  // ¿Estás en una fiesta? (conectado, o reconectando con tu llave). Mientras tanto la app solo muestra la fiesta: sin la
  // barra de abajo ni el reproductor minimizado; vuelven al salir.
  joined() { return this.state === 'on' || (!!this.key && !this.bye); },
  ui() {
    const on = partyGuest() && this.joined(), was = document.body.classList.contains('in-party');
    document.body.classList.toggle('in-party', on);
    if (on !== was) PF.soon(300); // en la fiesta tu música está en pausa: no se guarda nada por adelantado
    if (on && !was) { closeSheet(); if (!P.audio.paused) pauseSoft(); go('party', {}, { root: true }); } // solo la fiesta, sin pantallas detrás (ni botón de regresar)
  },
  // El teléfono despertó o volvió la red (o el latido de la app nativa): si la conexión se perdió, se entra otra vez ya.
  // fresh: el teléfono despertó o volvió la red (se reinicia la cuenta de intentos); sin él, el latido de la app nativa
  // solo reconecta si no hay ya un intento esperando.
  wake(fresh) {
    if (!this.key || this.bye) return;
    if (!this.ws) { if (!fresh && this.retryT) return; clearTimeout(this.retryT); this.retryT = 0; this.retry = 0; if (fresh) this.fails = 0; this.connect(this.url, ''); }
    else if (this.ws.readyState === 1) try { this.ws.send(JSON.stringify({ t: 'ping' })); } catch { }
  },
  // La app se volvió a abrir (o Android rehízo la pantalla) con una fiesta en curso: se vuelve a entrar.
  resume() {
    const p = store.get('party', null);
    if (!partyGuest() || !p || !p.key || !/^ws:\/\/[^/]+\/fiesta$/.test(String(p.url)) || Date.now() - num(p.at) > 2 * 3600e3) { if (p) store.del('party'); return; }
    this.key = String(p.key).slice(0, 64); this.room = String(p.room || '').slice(0, 60); this.lastOn = num(p.at); this.connect(p.url, '');
  },
  abortUp() { if (this.up) this.up.dead = true; },
  onMsg(m) {
    this.lastOn = Date.now();
    if (m.t === 'welcome') {
      this.state = 'on'; this.retry = 0; this.fails = 0; this.everOn = true; this.why = ''; this.lastOn = Date.now();
      this.you = { id: String(m.you && m.you.id || '').slice(0, 20), name: String(m.you && m.you.name || '').slice(0, 24) };
      this.key = String(m.key || '').slice(0, 64); this.room = String(m.room || tx('Fiesta')).slice(0, 60);
      this.chunk = Math.max(16384, Math.min(num(m.chunk) || 262144, 1e6 - 16));
      const again = store.get('party', null);
      if (!again || again.key !== this.key) toast(tx('Entraste a «') + this.room + '»', 3000);
      store.set('party', { url: this.url, key: this.key, room: this.room, at: Date.now() });
      this.ui();
    } else if (m.t === 'bye') {
      this.bye = true; const why = String(m.why || 'Saliste de la fiesta.').slice(0, 200); this.why = tx(why); // la computadora lo manda en español
      if (/código|cerró|llena|terminó/i.test(why)) { this.key = ''; store.del('party'); }
      this.ui();
    } else if (m.t === 'state') this.st = partyClean(m);
    else if (m.t === 'tick') {
      this.tick = { id: String(m.id || '').slice(0, 8), pos: num(m.pos), dur: num(m.dur), playing: !!m.playing, line: String(m.line || '').slice(0, 300), next: String(m.next || '').slice(0, 300) };
      partyPaintTick(this.tick); return;
    } else if (m.t === 'addOk' || m.t === 'addErr') {
      const w = this.wait.get(String(m.ref || '')); if (w) { this.wait.delete(String(m.ref)); w(m); return; }
      if (m.t === 'addErr') { toast(tx(String(m.why || 'La fiesta no aceptó la canción.').slice(0, 200)), 5000); if (this.up && this.up.id === String(m.id)) this.up.dead = true; }
    }
    renderPartySoon();
  },
  // Manda una canción: la pide a TU Jellyfin (o la toma de tus descargas) y se la pasa a la computadora por partes, sin
  // tenerla entera en memoria. Con la letra, para el karaoke.
  async add(t) {
    if (this.state !== 'on' || !this.ws) { toast(tx('Primero entra a una fiesta.')); return; }
    if (this.up) { toast(tx('Espera a que termine de enviarse «') + this.up.t.name + '».', 3500); return; }
    const up = this.up = { t, id: '', bytes: 0, dead: false, shown: 0 }; renderPartySoon();
    let rd = null;
    try {
      let lyrics = '';
      try { const L = await getLyrics(t); if (L) lyrics = L.synced ? toLRC(t, L.lines) : L.lines.map(l => l.text).join('\n'); } catch { }
      if (lyrics.length > 200000) lyrics = '';
      let cover = ''; try { cover = await partyCover(t); } catch { }
      if (this.state !== 'on' || !this.ws || up.dead) throw new Error('stop');
      const ref = uid().slice(0, 12), song = { title: t.name, artist: t.trackArtist || t.artist || '', album: t.album || '', duration: t.duration || 0, lyrics, cover };
      // La computadora acepta mensajes de hasta 450 KB: si no cabe todo, primero se deja la carátula y luego la letra.
      let msg = JSON.stringify({ t: 'add', ref, song });
      if (new TextEncoder().encode(msg).length > 440000) { song.cover = ''; msg = JSON.stringify({ t: 'add', ref, song }); }
      if (new TextEncoder().encode(msg).length > 440000) { song.lyrics = ''; msg = JSON.stringify({ t: 'add', ref, song }); }
      const r = await new Promise(res => {
        this.wait.set(ref, res);
        this.ws.send(msg);
        setTimeout(() => { if (this.wait.delete(ref)) res({ t: 'addErr', why: tx('La fiesta no respondió.') }); }, 15000);
      });
      if (r.t !== 'addOk' || !/^[0-9a-f]{8}$/.test(String(r.id))) throw new Error(tx(String(r.why || 'La fiesta no aceptó la canción.').slice(0, 200)));
      up.id = r.id; renderPartySoon();
      const src = DL.localUrl(t.id) || (api.kind === 'jellyfin' ? partySongUrl(t) : await api.stream(t));
      const res = await fetch(src);
      if (!res.ok || !res.body) throw new Error(tx('tu servidor no entregó la canción (') + res.status + ').');
      rd = res.body.getReader();
      const head = new TextEncoder().encode(up.id), N = this.chunk;
      let pend = [], pn = 0;
      const flush = async () => {
        if (!pn) return;
        const ws = this.ws; if (!ws || up.dead) throw new Error('stop');
        const f = new Uint8Array(8 + pn); f.set(head, 0); let o = 8; for (const p of pend) { f.set(p, o); o += p.length; } pend = []; pn = 0;
        ws.send(f);
        while (ws.bufferedAmount > 2e6) { await new Promise(z => setTimeout(z, 40)); if (this.ws !== ws || up.dead) throw new Error('stop'); }
      };
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        let v = value;
        while (v.length) { const take = Math.min(v.length, N - pn); pend.push(v.subarray(0, take)); pn += take; v = v.subarray(take); up.bytes += take; if (pn >= N) await flush(); }
        if (up.bytes > 80e6) throw new Error(tx('es demasiado grande para la fiesta.'));
        if (Date.now() - up.shown > 400) { up.shown = Date.now(); partyPaintUp(); }
      }
      await flush();
      if (!this.ws || up.dead) throw new Error('stop');
      this.ws.send(JSON.stringify({ t: 'end', id: up.id }));
      toast('«' + t.name + tx('» ya va en la lista de la fiesta'), 2600);
    } catch (e) {
      if (e.message !== 'stop') toast(tx('No se pudo mandar «') + t.name + '»: ' + e.message, 5000);
      if (up.id && this.ws && e.message !== 'stop') try { this.ws.send(JSON.stringify({ t: 'remove', id: up.id })); } catch { }
    } finally {
      try { rd && rd.cancel(); } catch { }
      if (this.up === up) this.up = null;
      renderPartySoon();
    }
  },
  remove(id) { if (this.ws && /^[0-9a-f]{8}$/.test(id)) try { this.ws.send(JSON.stringify({ t: 'remove', id })); } catch { } },
  // Fiestas abiertas en tu red (la app de Android pregunta por UDP).
  find() {
    if (!window.NanuqAndroid || !NanuqAndroid.partyDiscover) return Promise.resolve([]);
    return new Promise(res => {
      const t = setTimeout(() => { window.__nanuqParties = null; res([]); }, 6000);
      window.__nanuqParties = l => {
        clearTimeout(t); window.__nanuqParties = null;
        res((Array.isArray(l) ? l.slice(0, 20) : []).map(x => {
          try {
            const o = jparse(x.raw), from = str(x.from);
            if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(from)) return null;
            const port = Number.isInteger(o.Port) && o.Port > 0 && o.Port < 65536 ? o.Port : PARTY_PORT;
            return { name: String(o.Name || tx('Fiesta')).slice(0, 60), url: `ws://${from}:${port}/fiesta`, addr: from + ':' + port };
          } catch { return null; }
        }).filter(Boolean));
      };
      NanuqAndroid.partyDiscover();
    });
  }
};
// Dirección escrita a mano («192.168.1.20» o «192.168.1.20:47864») → ws://…/fiesta
function partyAddr(v) {
  const s = String(v || '').trim().replace(/^wss?:\/\//i, '').replace(/\/fiesta\/?$/, '');
  if (!s) throw new Error(tx('Escribe la dirección que muestra la computadora.'));
  const u = new URL(parseServer('http://' + s).base);
  return `ws://${u.hostname}:${u.port || PARTY_PORT}/fiesta`;
}
// ---- El iglú (fase 2): la fiesta que se ve en la computadora ----
// DJ Nanuq al centro; cada invitado es un Nanuq con el disfraz de SU tema, en círculo alrededor, con su nombre encima.
// Llegan y se van con una transición suave. Con música: el DJ toca, los Nanuqs bailan, hay luces de fiesta y la letra se
// proyecta en el techo. En pausa, todo descansa. Solo se anima mientras se ve (como el DJ del reproductor).
const IG = { seen: new Map(), line: null };
function iglooHTML() {
  const lights = ['#ff3cac', '#3ad1ff', '#ffd34d', '#38f2b0', '#9b5cf6', '#ff7a45'].map((c, k) => `<i class="igl" style="--c:${c};--x:${8 + k * 16}%;--d:${(1.1 + (k % 3) * .45).toFixed(2)}s;--w:${(k * .37).toFixed(2)}s"></i>`).join('');
  return `<section class="igloo" id="igloo" aria-label="${tx('El iglú de la fiesta')}">
    <div class="ig-dome"><div class="ig-beams"></div>${lights}</div>
    <div class="ig-sky"><div class="ig-line" id="igLine"></div><div class="ig-next" id="igNext"></div></div>
    <div class="ig-floor"></div>
    <div class="ig-vinyl" id="igVinyl" aria-hidden="true" hidden></div>
    <div class="ig-dj">${djBearSVG()}</div>
    <div class="ig-crowd" id="igCrowd"></div>
    <div class="ig-code" id="igCode"></div>
    <div class="ig-queue" id="igQueue" aria-label="${tx('A continuación')}"></div>
    <div class="ig-vol" id="igVol" role="status" aria-live="polite">${ic('vol')}<span class="ig-volbar"><i></i></span><b></b></div>
    <button class="cbtn ig-full" data-act="igloo-full" title="${tx('Pantalla completa')}" aria-label="${tx('Pantalla completa')}">${ic('grid')}</button>
  </section>`;
}
// Nanuq de un invitado: el oso del logo con el accesorio de su tema (si no existe ese tema, el Marino).
function iglooBear(theme) {
  const u = id => `<use href="#djb-${id}"/>`;
  // El tema lo manda el teléfono: solo uno que exista de verdad (no «constructor» ni otras propiedades heredadas).
  return `<svg class="igb" viewBox="-70 -150 652 660" aria-hidden="true"><g class="n-bear"><g transform="scale(1.4222 1.4227)">${u('body')}${u('belly')}${u('head')}${u('muzzle')}${u('nose')}${u('eyes')}</g><g class="acc-g">${Object.hasOwn(BEAR_ACC, theme) ? BEAR_ACC[theme] : BEAR_ACC.navy}</g></g></svg>`;
}
// Lo que sostiene el Nanuq de quien escogió la canción que suena: la carátula del álbum en alto entre sus dos manos, chapitas y destellos (coordenadas del dibujo del oso, 512×488; la cabeza va de y 6 a 274). Va dentro del grupo
// que baila. La carátula solo si es de la sala (partyCoverOk); si no, una nota.
function iglooHoldSVG(cover) {
  const star = (x, y, r) => `<path class="igs" d="M${x} ${y - r}l${r * .28} ${r * .72} ${r * .72} ${r * .28}-${r * .72} ${r * .28}-${r * .28} ${r * .72}-${r * .28}-${r * .72}-${r * .72}-${r * .28} ${r * .72}-${r * .28}z"/>`;
  return `<g fill="#ff8fb3" opacity=".6"><ellipse cx="128" cy="190" rx="30" ry="18"/><ellipse cx="384" cy="190" rx="30" ry="18"/></g>
    <g class="ig-lift"><rect x="86" y="-372" width="340" height="340" rx="20" fill="#13233d" stroke="#1b2547" stroke-width="12"/>
      ${cover ? `<image href="${esc(cover)}" x="93" y="-365" width="326" height="326" preserveAspectRatio="xMidYMid slice"/>` : '<text x="256" y="-150" text-anchor="middle" font-size="180" fill="#3cc0f5">♪</text>'}
      <circle cx="122" cy="-24" r="44" fill="#fff" stroke="#1b2547" stroke-width="10"/><circle cx="390" cy="-24" r="44" fill="#fff" stroke="#1b2547" stroke-width="10"/></g>
    <g class="ig-spark" fill="#ffd34d" stroke="#1b2547" stroke-width="5">${star(20, -250, 48)}${star(500, -150, 38)}${star(-20, 60, 32)}${star(530, 150, 42)}</g>`;
}
// Lo que el Nanuq traía en las manos según su disfraz (la taza del Leaf o del Café, las uvas, la sandía, el chocolate, el
// chile): mientras sostiene el álbum, ese objeto va encima del álbum (en el disfraz se esconde, ver CSS de .igg.star).
const IG_HELD = '.b-cup,.b-steam,.b-grapes,.b-slice,.b-bar,.b-crumb,.b-chili';
function iglooHeldOnTop(el, hold) {
  const src = [...el.querySelectorAll('.acc-g > g > g')].filter(g => g.matches(IG_HELD)); if (!src.length) return;
  const NS = 'http://www.w3.org/2000/svg', top = document.createElementNS(NS, 'g'), wrap = document.createElementNS(NS, 'g');
  // Mismo estilo de trazo que el disfraz (lo hereda de su grupo raíz).
  const root = src[0].parentNode; for (const a of ['stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap']) if (root.getAttribute(a)) wrap.setAttribute(a, root.getAttribute(a));
  for (const g of src) { const c = g.cloneNode(true); c.querySelectorAll('ellipse[fill="#fff"]').forEach(x => x.remove()); wrap.appendChild(c); } // sin sus manitas: ahora sostienen el álbum
  top.appendChild(wrap); hold.querySelector('.ig-lift').appendChild(top);
  try { const b = wrap.getBBox(); if (b.width) top.setAttribute('transform', `translate(${(256 - (b.x + b.width / 2)).toFixed(0)} ${(-372 + 26 - (b.y + b.height)).toFixed(0)})`); } catch { }
}
// Color de la etiqueta con el nombre de un invitado: el color principal del tema de SU Nanuq (con texto oscuro o claro
// según lo claro que sea). Si ya no está en la sala, el del tema de esta computadora.
function partyGuestColor(guests, id) {
  const g = (guests || []).find(x => x.id === id), th = g && Object.hasOwn(THEMES, g.theme) ? THEMES[g.theme] : null; // solo temas que existen
  if (!th) return '';
  const a = th.a, [r, gg, b] = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16) / 255), lum = .2126 * r + .7152 * gg + .0722 * b;
  return `background:${a};color:${lum > .55 ? '#0b1424' : '#fff'}`;
}
// Carátula de una canción de la lista de la fiesta: en la computadora, de su servidor interno; en el teléfono, la que
// sirve la computadora a los invitados (con tu llave de la sala).
function partyCoverSrc(e) {
  if (partyHost()) return partyCoverOk(e.cover) ? e.cover : '';
  if (!e.hasCover || !PG.key || !/^[0-9a-f]{8}$/.test(e.id)) return '';
  const m = /^ws:\/\/([^/]+)\/fiesta$/.exec(PG.url || ''); if (!m) return '';
  return `http://${m[1]}/fiesta/c/${e.id}?k=${encodeURIComponent(PG.key)}`;
}
// Pone a cada invitado en su lugar del círculo (los de adelante, más grandes) sin redibujar a los que ya estaban.
// cu: la canción que suena: el Nanuq de quien la escogió la sostiene en alto y baila más feliz.
function iglooSync(guests, playing, cu) {
  const starId = cu && cu.by, cover = cu && partyCoverOk(cu.cover) ? cu.cover : '';
  const box = $('#igCrowd'), ig = $('#igloo'); if (!box || !ig) return;
  ig.classList.toggle('playing', !!playing); ig.classList.toggle('nfb', !!playing); // nfb: los accesorios se mueven al bailar
  $('.ig-dj .djbear', ig)?.classList.toggle('on', !!playing);
  const ids = new Set(guests.map(g => g.id));
  for (const el of [...box.children]) if (!ids.has(el.dataset.g) && !el.classList.contains('out')) { el.classList.add('out'); setTimeout(() => el.remove(), 700); }
  const n = guests.length;
  guests.forEach((g, k) => {
    let el = box.querySelector(`.igg[data-g="${CSS.escape(g.id)}"]:not(.out)`);
    if (!el) {
      el = document.createElement('div'); el.className = 'igg in'; el.dataset.g = g.id;
      el.innerHTML = iglooBear(g.theme) + '<div class="ign"></div>';
      el.querySelector('.ign').textContent = g.name; // su nombre, debajo de su Nanuq: siempre como texto
      el.style.setProperty('--ph', (Math.random() * -.9).toFixed(2) + 's');
      box.appendChild(el); setTimeout(() => el.classList.remove('in'), 700);
    }
    // ¿Suena la canción que escogió? Su Nanuq sostiene la carátula.
    const star = g.id === starId, nb = el.querySelector('.n-bear'); el.classList.toggle('star', star);
    el.querySelector('.ign').style.cssText = star ? partyGuestColor(guests, g.id) : ''; // con el color de su tema
    let hold = el.querySelector('.ig-hold'); const key = star ? cu.id + '|' + cover : '';
    if (hold && hold.dataset.k !== key) { hold.remove(); hold = null; }
    if (star && !hold && nb) {
      hold = document.createElementNS('http://www.w3.org/2000/svg', 'g'); hold.setAttribute('class', 'ig-hold'); hold.dataset.k = key;
      hold.innerHTML = iglooHoldSVG(cover);
      nb.appendChild(hold);
      iglooHeldOnTop(el, hold);
    }
    // Elipse alrededor del DJ: un arco de 300° que deja libre el hueco justo detrás de él (ahí no se vería a nadie).
    const a = n === 1 ? Math.PI / 2 : (-60 + (k + .5) * 300 / n) * Math.PI / 180, x = 47 + 35 * Math.cos(a), y = 74 + 13 * Math.sin(a), sc = .72 + .38 * (y - 61) / 26;
    el.style.left = x.toFixed(2) + '%'; el.style.top = y.toFixed(2) + '%'; el.style.setProperty('--s', sc.toFixed(3)); el.style.zIndex = String(Math.round(y * 10));
  });
  iglooLive();
}
function iglooLive() { const ig = $('#igloo'); if (ig) ig.classList.toggle('live', document.visibilityState === 'visible' && RC.visible !== false && cur()?.name === 'party' && ig.isConnected); }
document.addEventListener('visibilitychange', () => setTimeout(iglooLive, 0));
// A continuación (solo a pantalla completa, abajo): una fila con lo que sigue en la lista; la más próxima, a la izquierda,
// y encima, siempre, el código para entrar. Cada bloque: carátula, nombre y álbum. Tocar uno lo pone (saltando los de
// antes); arrastrarlo cambia el orden; la rueda del mouse o deslizar el dedo recorre la fila. Solo se redibuja si cambió.
function iglooQueue(list, curId, st) {
  const box = $('#igQueue'), ig = $('#igloo'), code = $('#igCode'); if (!box || !ig) return;
  if (code) code.innerHTML = st && st.code ? `<span>${tx('Código para entrar')}</span><b>${esc(String(st.code).replace(/^(\d{3})(\d{3})$/, '$1 $2'))}</b>` : ''; // sin la dirección IP: a la vista solo el código
  const up = list.filter(e => e.id !== curId);
  IG.up = up;
  const sig = up.map(e => e.id + ':' + e.state + ':' + (e.cover ? 1 : 0) + ':' + (e.byName || '') + ':' + partyGuestColor(st && st.guests, e.by)).join(',') || '-';
  if (box.dataset.sig === sig || IGD.on) return; box.dataset.sig = sig;
  box.innerHTML = up.length ? up.map((e, k) => `<div class="igq${e.state === 'ready' ? '' : ' wait'}" data-id="${esc(e.id)}" role="button" tabindex="0" title="${esc(e.state === 'ready' ? tx('Tócala para ponerla ya · arrástrala para cambiar el orden') : tx('Todavía está llegando'))}"><span class="igq-cv">${ic('music')}${partyCoverOk(e.cover) ? `<img src="${esc(e.cover)}" alt="" draggable="false" data-rm>` : ''}<i class="igq-n">${k + 1}</i></span><span class="igq-t"><b>${esc(e.title)}</b><small>${esc(e.album || e.artist || (e.state === 'ready' ? '' : tx('Llegando…')))}</small></span>${e.byName ? `<span class="igq-by" style="${partyGuestColor(st && st.guests, e.by)}">${esc(e.byName)}</span>` : ''}</div>`).join('')
    : ('<div class="igq empty"><span class="igq-t"><b>' + tx('La lista está vacía') + '</b><small>' + tx('Manden canciones desde su teléfono') + '</small></span></div>');
  iglooQueueEdge();
}
// El degradado de la derecha solo si hay más canciones que no caben.
function iglooQueueEdge() { const b = $('#igQueue'); if (b) b.classList.toggle('more', b.scrollLeft + b.clientWidth < b.scrollWidth - 4); }
document.addEventListener('scroll', e => { if (e.target && e.target.id === 'igQueue') iglooQueueEdge(); }, true);
// Rueda del mouse: recorre la fila de lado.
document.addEventListener('wheel', e => {
  const b = e.target.closest && e.target.closest('#igQueue'); if (!b) return;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (!d) return;
  e.preventDefault(); b.scrollLeft += d * (e.deltaMode === 1 ? 40 : 1);
}, { passive: false });
// Tocar, arrastrar o deslizar en la fila. Con el mouse: arrastrar más de 6 px mueve la canción; un clic la pone. Con el
// dedo: deslizar recorre la fila (lo hace el navegador) y mantener presionado ~0.35 s la toma para moverla.
const IGD = { on: false };
document.addEventListener('pointerdown', e => {
  const box = e.target.closest('#igQueue'); if (!box || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const cell = e.target.closest('.igq[data-id]'); if (!cell && e.pointerType === 'mouse') return; // entre bloques: con el dedo, solo deslizar
  const x0 = e.clientX, y0 = e.clientY, touch = e.pointerType !== 'mouse';
  let dragging = false, moved = false, swiping = false, x = x0, raf = 0, from = -1, pos = -1, cells = [], mids = [], step = 0, sl0 = 0, lp = 0, done = false;
  const bsl = box.scrollLeft;
  const start = () => {
    cells = [...box.querySelectorAll('.igq[data-id]')]; from = cells.indexOf(cell); if (from < 0 || cells.length < 2) return false;
    const rs = cells.map(c => c.getBoundingClientRect()); mids = rs.map(r => r.left + r.width / 2); step = cells[1] ? rs[1].left - rs[0].left : rs[0].width;
    sl0 = box.scrollLeft; pos = from; dragging = IGD.on = true;
    try { cell.setPointerCapture(e.pointerId); } catch { }
    cell.classList.add('dragging'); cells.forEach((c, j) => j !== from && c.classList.add('shifting')); ig().classList.add('igdrag');
    if (touch && navigator.vibrate) try { navigator.vibrate(10); } catch { }
    return true;
  };
  const ig = () => $('#igloo');
  const paint = () => {
    const cx = x + (box.scrollLeft - sl0);
    cell.style.transform = `translateX(${cx - x0}px)`;
    pos = mids.reduce((n, m, j) => n + (j !== from && m < cx ? 1 : 0), 0);
    cells.forEach((c, j) => { if (j === from) return; const sh = from < pos && j > from && j <= pos ? -step : from > pos && j >= pos && j < from ? step : 0; c.style.transform = sh ? `translateX(${sh}px)` : ''; });
  };
  const tick = () => { // cerca de los bordes, la fila se desplaza sola
    raf = 0; if (!dragging || done) return;
    const r = box.getBoundingClientRect(), edge = 70;
    const v = x < r.left + edge && x < x0 - 8 ? -Math.ceil((r.left + edge - x) / 4) : x > r.right - edge && x > x0 + 8 ? Math.ceil((x - (r.right - edge)) / 4) : 0;
    if (v) { box.scrollLeft += v; paint(); raf = requestAnimationFrame(tick); }
  };
  const move = ev => {
    x = ev.clientX;
    if (swiping) { ev.preventDefault(); box.scrollLeft = bsl - (x - x0); return; }
    if (!dragging) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= 6) return;
      moved = true; clearTimeout(lp);
      if (touch || !cell) { swiping = true; try { box.setPointerCapture(e.pointerId); } catch { } ev.preventDefault(); box.scrollLeft = bsl - (x - x0); return; } // deslizar: recorre la fila
      if (!start()) return;
    }
    ev.preventDefault(); paint(); if (!raf) raf = requestAnimationFrame(tick);
  };
  const end = cancel => {
    if (done) return; done = true; clearTimeout(lp); cancelAnimationFrame(raf);
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cc);
    if (!dragging) {
      if (!cancel && !moved && cell) PH.jump((IG.up || []).find(z => z.id === cell.dataset.id));
      return;
    }
    IGD.on = false; ig()?.classList.remove('igdrag');
    cells.forEach(c => { c.classList.remove('dragging', 'shifting'); c.style.transform = ''; });
    if (cancel || pos === from) return;
    const ids = cells.map(c => c.dataset.id), [m] = ids.splice(from, 1); ids.splice(pos, 0, m);
    // Se ve ya en su lugar; la computadora guarda el orden y lo cuenta a todos.
    const [el] = cells.splice(from, 1); cells.splice(pos, 0, el); cells.forEach(c => box.appendChild(c));
    cells.forEach((c, k) => { const n = c.querySelector('.igq-n'); if (n) n.textContent = k + 1; });
    PH.order(ids);
  };
  const up = () => end(false), cc = () => end(true);
  if (touch && cell) lp = setTimeout(() => { if (!moved && !done && start()) paint(); }, 350);
  document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cc);
});
document.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('#igQueue .igq[data-id]'); if (c && (e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); PH.jump((IG.up || []).find(z => z.id === c.dataset.id)); } }, true);
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('#igQueue')) e.preventDefault(); });
// Volumen en la fiesta a pantalla completa (con la sala abierta el reproductor y su barra de volumen están ocultos): las
// flechas ↑ y ↓ lo cambian de 5 en 5 % y un aviso dentro del iglú muestra cuánto quedó (en pantalla completa solo se ve lo
// que está dentro del iglú, así que el aviso normal de la app no aparecería). Es el mismo volumen de la barra de abajo.
const IGV = { t: 0 };
function partyVolumeStep(d) {
  const v = Math.max(0, Math.min(1, Math.round((Settings.volume + d) * 20) / 20));
  fadeStop(); DJ.duckV = null;
  P.audio.volume = v; P.audio.muted = false; PH.audio.volume = v; PH.audio.muted = false;
  Settings.set('volume', v); vol.value = v; paintVol();
  const box = $('#igVol'); if (!box) return;
  box.querySelector('use').setAttribute('href', v === 0 ? '#i-mute' : '#i-vol');
  box.querySelector('i').style.width = Math.round(v * 100) + '%';
  box.querySelector('b').textContent = Math.round(v * 100) + ' %';
  box.classList.add('show'); clearTimeout(IGV.t); IGV.t = setTimeout(() => box.classList.remove('show'), 1400);
}
// Pantalla completa de la fiesta: el puntero del mouse se esconde si no lo mueves en 2.5 s.
const IGM = { t: 0 };
function iglooIdle(show) {
  const ig = $('#igloo'); clearTimeout(IGM.t); if (!ig) return;
  ig.classList.remove('idle');
  if (ig.classList.contains('full')) IGM.t = setTimeout(() => { if (!IGD.on) ig.classList.add('idle'); else iglooIdle(); }, 2500);
}
document.addEventListener('mousemove', () => { if (document.fullscreenElement && document.fullscreenElement.id === 'igloo') iglooIdle(); }, { passive: true });
document.addEventListener('fullscreenchange', () => { const ig = $('#igloo'); if (!ig) return; ig.classList.toggle('full', document.fullscreenElement === ig); iglooIdle(); setTimeout(iglooQueueEdge, 50); });
// La canción que suena, como en el DJ del reproductor: su carátula en la funda y el disco de vinilo (con la carátula de
// etiqueta) que sale de ella, en la esquina de abajo a la derecha, encima de «A continuación». El disco gira mientras
// suena (solo si se ve, como todo el iglú); con cada canción nueva, la funda vieja cae y entra la nueva.
function iglooVinyl(e, playing) {
  const v = $('#igVinyl'); if (!v) return;
  v.hidden = !e; v.classList.toggle('vspin', !!e && !!playing); // no «spin»: esa clase es la del indicador de carga (gira todo el elemento)
  const id = e ? e.id : null; if (id === IG.vin) return; IG.vin = id;
  v.querySelectorAll('.djs-sleeve:not(.gone)').forEach(o => { o.className = 'djs-sleeve gone out-jump'; setTimeout(() => o.remove(), 700); });
  if (!e) return;
  const cv = partyCoverOk(e.cover) ? esc(e.cover) : '', el = document.createElement('div');
  el.className = 'djs-sleeve in-jump';
  el.innerHTML = `<div class="djs-vinyl"><div class="djs-disc"><span class="djs-label"${cv ? ` style="background-image:url('${cv}')"` : ''}></span></div></div><div class="djs-art"><div class="cover"><div class="ph">${ic('music')}</div>${cv ? `<img src="${cv}" alt="" draggable="false" data-rm>` : ''}</div></div>`;
  v.appendChild(el);
}
// Letra en el techo: cada línea nueva entra con un destello.
function iglooLine(line, next) {
  const l = $('#igLine'); if (!l) return;
  if (line !== IG.line) { IG.line = line; l.textContent = line || ''; l.classList.remove('pop'); void l.offsetWidth; if (line) l.classList.add('pop'); }
  const n = $('#igNext'); if (n) n.textContent = next || '';
}
// ---- Pantalla «Fiesta» ----
let partyRenderT = 0;
function renderPartySoon() {
  if (partyRenderT) return;
  partyRenderT = setTimeout(() => { partyRenderT = 0; if (cur()?.name === 'party') paintParty(); }, 120);
}
function partyPaintTick(k) {
  iglooLine(k.line || '', k.next || '');
  const l = $('#ptLine'); if (!l) return;
  l.textContent = k.line || ''; const n = $('#ptNext'); if (n) n.textContent = k.next || '';
  const p = $('#ptPos'); if (p) p.textContent = k.dur ? fmt(k.pos) + ' / ' + fmt(k.dur) : '';
}
function partyPaintUp() { const u = PG.up, e = $('#ptUp'); if (e) e.textContent = u ? tx('Mandando «') + u.t.name + '»… ' + fmtMB(u.bytes) : ''; }
function partyRowsHTML(list, now) {
  if (!list.length) return ('<div class="empty">' + tx('Todavía no hay canciones.') + ' ') + (partyHost() ? tx('Los invitados las mandan desde su teléfono.') : tx('Busca una abajo y mándala.')) + '</div>';
  return `<div class="list">${list.map(e => {
    const playing = now && now.id === e.id, st = playing ? (now.playing ? tx('Sonando') : tx('En pausa')) : e.state === 'ready' ? (e.duration ? fmt(e.duration) : tx('Lista')) : tx('Llegando… ') + String(e.mb).replace('.', LANG === 'es' ? ',' : '.') + ' MB';
    const canX = partyHost(); // los invitados no quitan canciones de la lista
    const cv = partyCoverSrc(e);
    return `<div class="dlrow ptrow${playing ? ' on' : ''}"><span class="cover reqic"><span class="ph">${ic(playing ? 'music' : e.state === 'ready' ? 'check' : 'download')}</span>${cv ? `<img src="${esc(cv)}" alt="" loading="lazy" data-rm>` : ''}</span><div class="m"><div class="t">${esc(e.title)}</div><small>${esc([e.artist, tx('la puso ') + (e.byName || tx('alguien')), st].filter(Boolean).join(' · '))}</small></div>${canX ? `<button class="cbtn" data-act="party-remove" data-id="${esc(e.id)}" aria-label="${tx('Quitar de la fiesta')}" title="${tx('Quitar')}">${ic('x')}</button>` : ''}</div>`;
  }).join('')}</div>`;
}
const partyGuestsHTML = g => g.length ? `<div class="ptguests">${g.map(x => `<span class="chip${x.away ? ' away' : ''}" title="${x.away ? tx('Su teléfono está dormido o sin red: sigue en la fiesta') : ''}">${esc(x.name)}${x.away ? ' · ' + tx('ausente') : ''}</span>`).join('')}</div>` : ('<div class="muted">' + tx('Nadie todavía.') + '</div>');
function partyNowHTML(e, playing, isHost) {
  return `<div class="ptnow"><div class="ptnow-h"><b>${e ? esc(e.title) : tx('Nada sonando')}</b><small>${e ? esc([e.artist, tx('la puso ') + (e.byName || tx('alguien'))].filter(Boolean).join(' · ')) : (isHost ? tx('Empieza en cuanto llegue la primera canción.') : tx('Manda una canción para empezar.'))}</small><span class="muted" id="ptPos"></span></div>
    <div class="ptline" id="ptLine"></div><div class="ptnext muted" id="ptNext"></div>
    ${isHost ? `<div class="btns"><button class="btn pri" data-act="party-toggle">${ic(playing ? 'pause' : 'play', 1)}${playing ? tx('Pausa') : tx('Reproducir')}</button><button class="btn" data-act="party-skip"${e ? '' : ' disabled'}>${ic('next', 1)}${tx('Siguiente')}</button></div>` : ''}</div>`;
}
function paintParty() {
  const b = $('#ptBox'); if (!b) return;
  const keep = { a: $('#ptAddr')?.value, c: $('#ptCode')?.value };
  if (partyHost()) {
    const s = PH.st;
    if (!s.open) {
      b.innerHTML = `<div class="set"><p class="muted" style="margin-top:0">${tx('Abre una sala y tus amigos se unen desde su teléfono con la app de Nanuq para Android, conectados a la')} <b>${tx('misma red Wi-Fi')}</b>${tx('. Cada quien manda canciones de su propio Jellyfin: su teléfono la baja y se la pasa a esta computadora, que las pone una tras otra con la letra para cantar.')}</p>
        <p class="muted">${tx('Mientras la sala está abierta, Nanuq escucha en tu red local (puerto')} ${PARTY_PORT}${tx('); para entrar hace falta el código que verás aquí. Las canciones se guardan solo un rato en esta computadora y se borran al sonar o al cerrar la sala.')}</p>
        <button class="btn pri" data-act="party-open">${ic('party')}${tx('Abrir la fiesta')}</button></div>`;
      const ig = $('#igloo'); if (ig) ig.hidden = true;
      return;
    }
    const list = s.list || [], cu = PH.cur && list.find(e => e.id === PH.cur.id), playing = !!PH.cur && !PH.audio.paused;
    b.innerHTML = `<div class="ptcard"><div><div class="akind">${tx('Código para entrar')}</div><div class="ptcode"${(s.addrs || []).length ? ` title="${esc(tx('Si un teléfono no encuentra la fiesta, que escriba: ') + s.addrs.map(a => a + (s.port !== PARTY_PORT ? ':' + s.port : '')).join(' o '))}"` : ''}>${esc(s.code)}</div><small class="muted">${esc(s.name || '')}</small></div>
        <div class="btns"><button class="btn" data-act="party-newcode">${ic('refresh')}${tx('Otro código')}</button><button class="btn" data-act="party-close">${ic('x')}${tx('Cerrar la fiesta')}</button></div></div>
      ${partyNowHTML(cu, playing, true)}
      <div class="letter">${tx('En la fiesta ·')} ${(s.guests || []).length}</div>${partyGuestsHTML(s.guests || [])}
      <div class="letter">${tx('Lista')}</div>${partyRowsHTML(list, s.now)}`;
    const ig = $('#igloo'); if (ig) ig.hidden = false;
    iglooSync(s.guests || [], playing, cu); iglooQueue(list, PH.cur && PH.cur.id, s); iglooVinyl(cu, playing); if (!cu) iglooLine('', ''); PH.tick(); return;
  }
  // Invitado: arriba la sala y lo que suena (con su letra), en medio el buscador y abajo quién está y la lista.
  const add = $('#ptAdd'), low = $('#ptBox2');
  if (PG.state !== 'on' && PG.joined()) {
    // Tu teléfono se durmió o perdió la red: sigues en la fiesta, entrando otra vez.
    if (add) add.hidden = true; if (low) low.innerHTML = '';
    b.innerHTML = `<div class="ptcard"><div><div class="akind">${tx('Estás en')}</div><div class="ptroom">${esc(PG.room || tx('la fiesta'))}</div><small class="muted">${tx('Volviendo a conectar… (sigues en la fiesta)')}</small></div><div class="btns"><button class="btn" data-act="party-leave">${ic('out')}${tx('Salir')}</button></div></div>${loading()}`;
    return;
  }
  if (PG.state !== 'on') {
    if (add) add.hidden = true; if (low) low.innerHTML = '';
    const found = PG.found;
    b.innerHTML = `${PG.why ? `<div class="err" style="margin-bottom:16px">${esc(PG.why)}</div>` : ''}
      <div class="set"><p class="muted" style="margin-top:0">${tx('Únete a la fiesta que abrió una computadora con Nanuq en tu misma red Wi-Fi y mándale canciones de tu biblioteca.')}</p>
      ${window.NanuqAndroid && NanuqAndroid.partyDiscover ? `<div class="btns" style="margin-bottom:12px"><button class="btn" data-act="party-find"${PG.finding ? ' disabled' : ''}>${ic('search')}${PG.finding ? tx('Buscando…') : tx('Buscar fiestas en mi red')}</button></div>` : ''}
      ${found ? (found.length ? `<div class="list" style="margin-bottom:14px">${found.map((f, k) => `<button class="li" data-act="party-pick" data-k="${k}"><span class="cover reqic">${ic('party')}</span><span class="t">${esc(f.name)}<small>${esc(f.addr)}</small></span></button>`).join('')}</div>` : ('<p class="muted">' + tx('No encontré fiestas abiertas. Revisa que la computadora tenga la sala abierta y que estén en la misma red, o escribe su dirección.') + '</p>')) : ''}
      <form id="ptF" autocomplete="off"><div class="field"><label for="ptAddr">${tx('Dirección de la fiesta')}</label><input class="inp" id="ptAddr" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="192.168.1.20"></div>
      <div class="field"><label for="ptCode">${tx('Código')}</label><input class="inp" id="ptCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="${tx('6 dígitos')}"></div>
      <button class="btn pri wide"${PG.state === 'connecting' ? ' disabled' : ''}>${PG.state === 'connecting' ? tx('Entrando…') : tx('Entrar a la fiesta')}</button></form></div>`;
    if (keep.a != null) $('#ptAddr').value = keep.a; else if (PG.url) $('#ptAddr').value = PG.url.replace(/^ws:\/\//, '').replace(/\/fiesta$/, '');
    if (keep.c != null) $('#ptCode').value = keep.c;
    $('#ptF').onsubmit = e => {
      e.preventDefault();
      let url; try { url = partyAddr($('#ptAddr').value); } catch (err) { PG.why = err.message; paintParty(); return; }
      const code = $('#ptCode').value.trim();
      if (!/^\d{6}$/.test(code)) { $('#ptCode').focus(); toast(tx('Escribe el código de 6 dígitos que muestra la computadora.')); return; }
      PG.key = ''; PG.connect(url, code);
    };
    return;
  }
  if (add) add.hidden = false;
  const s = PG.st || { list: [], guests: [] }, list = s.list, cu = s.now && list.find(e => e.id === s.now.id);
  b.innerHTML = `<div class="ptcard"><div><div class="akind">${tx('Estás en')}</div><div class="ptroom">${esc(s.room || PG.room)}</div><small class="muted">${tx('como')} ${esc(PG.you ? PG.you.name : '')}</small></div><div class="btns"><button class="btn" data-act="party-leave">${ic('out')}${tx('Salir')}</button></div></div>
    ${partyNowHTML(cu, !!(s.now && s.now.playing), false)}`;
  if (low) low.innerHTML = `<div class="letter">${tx('En la fiesta ·')} ${s.guests.length}</div>${partyGuestsHTML(s.guests)}
    <div class="letter">${tx('Lista')}</div>${partyRowsHTML(list, s.now)}`;
  partyPaintUp(); if (PG.tick && cu && PG.tick.id === cu.id) partyPaintTick(PG.tick);
}
// Buscador de la fiesta (teléfono): artistas, álbumes y canciones de tu biblioteca. Tocar un artista o un álbum muestra sus
// canciones aquí mismo (en la fiesta no hay otras pantallas); tocar una canción la manda.
const PTS = { seq: 0, q: '' };
const partySongsHTML = tracks => { const k = regList(tracks); return `<div class="list">${tracks.slice(0, 300).map((x, i) => `<button class="li" data-act="party-send" data-l="${k}" data-i="${i}">${coverHTML(x, 80)}<span class="t">${esc(x.name)}<small>${esc([x.trackArtist || x.artist, x.album].filter(Boolean).join(' · '))}</small></span>${ic('party')}</button>`).join('')}</div>`; };
async function partySearch(v) {
  const res = $('#ptRes'); if (!res) return;
  PTS.q = v = String(v || '').trim();
  const plRow = p => `<button class="li" data-act="party-playlist" data-id="${esc(p.id)}" data-name="${esc(p.name)}">${coverHTML(p, 80)}<span class="t">${esc(p.name)}${p.count != null ? `<small>${esc(p.count)} ${tx('canciones')}</small>` : ''}</span><span class="ptchev">${ic('left')}</span></button>`;
  const n = ++PTS.seq;
  // Sin búsqueda: tus playlists, para elegir sin escribir.
  const lyrBox = $('#ptLyr'); if (lyrBox) lyrBox.innerHTML = '';
  if (v.length >= 4) lyricsSection(lyrBox, v, () => n === PTS.seq, 'party-send');
  if (v.length < 2) {
    res.innerHTML = '';
    const pls = await cached('playlists', () => api.playlists()).catch(() => []);
    if (n === PTS.seq && pls.length) res.innerHTML = `<div class="letter">${tx('Tus playlists')}</div><div class="list">${pls.slice(0, 50).map(plRow).join('')}</div>`;
    return;
  }
  res.innerHTML = loading();
  try {
    const [r, pls] = await Promise.all([api.search(v), cached('playlists', () => api.playlists()).catch(() => [])]); if (n !== PTS.seq) return;
    const k0 = normTxt(v); r.playlists = pls.filter(p => normTxt(p.name).includes(k0));
    // Álbumes según las etiquetas de tus canciones (como en Buscar), si el índice ya está.
    const L = LIB.peek(), k = normTxt(v);
    if (L) r.albums = L.list.filter(a => normTxt(a.name).includes(k) || normTxt(a.artist).includes(k)).sort((x, y) => normTxt(x.name).indexOf(k) - normTxt(y.name).indexOf(k) || y.count - x.count);
    if (!r.artists.length && !r.albums.length && !r.tracks.length && !r.playlists.length) { res.innerHTML = lyrNorm(v).length >= 4 ? '' : `<div class="empty">${tx('Nada coincide con «')}${esc(v)}».</div>`; return; }
    res.innerHTML = (r.playlists.length ? `<div class="letter">Playlists</div><div class="list">${r.playlists.slice(0, 8).map(plRow).join('')}</div>` : '')
      + (r.artists.length ? `<div class="letter">${tx('Artistas')}</div><div class="list">${r.artists.slice(0, 8).map(a => `<button class="li" data-act="party-artist" data-id="${esc(a.id || '')}" data-name="${esc(a.name)}">${coverHTML({ ...a, type: 'artist' }, 80)}<span class="t">${esc(a.name)}</span><span class="ptchev">${ic('left')}</span></button>`).join('')}</div>` : '')
      + (r.albums.length ? `<div class="letter">${tx('Álbumes')}</div><div class="list">${r.albums.slice(0, 12).map(a => `<button class="li" data-act="party-album" data-id="${esc(a.id)}" data-name="${esc(a.name)}">${coverHTML(a, 80)}<span class="t">${esc(a.name)}<small>${esc([a.artist, a.year].filter(Boolean).join(' · '))}</small></span><span class="ptchev">${ic('left')}</span></button>`).join('')}</div>` : '')
      + (r.tracks.length ? `<div class="letter">${tx('Canciones')}</div>${partySongsHTML(r.tracks.slice(0, 40))}` : '');
  } catch (e) { if (n === PTS.seq) res.innerHTML = errBox(e); }
}
async function partyBrowse(kind, id, name) {
  const res = $('#ptRes'); if (!res) return; const lb = $('#ptLyr'); if (lb) lb.innerHTML = '';
  const n = ++PTS.seq; res.innerHTML = loading();
  try {
    let tracks;
    if (kind === 'album') {
      const L = LIB.peek(), a = L && L.albums.get(id);
      tracks = a ? a.tracks : (await cached('album:' + id, () => api.album(id))).tracks;
    } else if (kind === 'playlist') tracks = (await cached('playlist:' + id, () => api.playlist(id))).tracks;
    else tracks = (await cached('artistTracks:' + (id || name), () => api.artistTracks(id || null, name))).slice().sort((x, y) => String(x.album).localeCompare(String(y.album), 'es') || (x.disc || 1) - (y.disc || 1) || (x.index || 0) - (y.index || 0));
    if (n !== PTS.seq) return;
    res.innerHTML = `<div class="ptbrowse"><button class="cbtn" data-act="party-back" aria-label="${tx('Volver a los resultados')}">${ic('left')}</button><div><div class="akind">${{ album: tx('Álbum'), playlist: 'Playlist' }[kind] || tx('Artista')}</div><b>${esc(name || '')}</b></div></div>`
      + (tracks.length ? partySongsHTML(tracks) : ('<div class="empty">' + tx('No encontré canciones.') + '</div>'));
  } catch (e) { if (n === PTS.seq) res.innerHTML = errBox(e); }
}
V.party = async (el) => {
  IG.line = null; IG.vin = undefined;
  el.innerHTML = head(tx('Fiesta')) + (partyHost() ? iglooHTML() : '') + '<div id="ptBox"></div>' + (partyGuest() ? `<div id="ptAdd" hidden><div class="letter">${tx('Mandar una canción')}</div><div class="hint ok" id="ptUp"></div><form class="searchbar" id="ptSF">${ic('search')}<input class="inp" id="ptQ" type="search" placeholder="${tx('Artistas, álbumes, canciones…')}" autocomplete="off" enterkeyhint="search"></form><div id="ptRes"></div><div id="ptLyr"></div></div><div id="ptBox2"></div>` : '');
  paintParty();
  const inp = $('#ptQ', el); if (!inp) return;
  LIB.index().catch(() => { }); // para los álbumes según tus etiquetas
  partySearch('');
  let t = 0;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(() => partySearch(inp.value), 300); };
  $('#ptSF', el).onsubmit = e => { e.preventDefault(); clearTimeout(t); partySearch(inp.value); inp.blur(); };
};
PH.init();

/* =========================================================
   Global actions
   ========================================================= */
const d0 = el => el.dataset;
// Cola: clic derecho (computadora) o mantener presionado (teléfono) abre las opciones de la canción.
const LP = { t: 0, x: 0, y: 0, fired: 0, eat: false };
document.addEventListener('contextmenu', e => {
  const r = e.target.closest('.qr[data-i]'); if (!r) return;
  e.preventDefault();
  if (Date.now() - LP.fired < 900) return; // ya lo abrió el toque largo
  queueMenu(+r.dataset.i);
});
document.addEventListener('pointerdown', e => {
  const r = e.target.closest('.qr[data-i]'); if (!r || e.pointerType === 'mouse') return;
  clearTimeout(LP.t); LP.x = e.clientX; LP.y = e.clientY;
  LP.t = setTimeout(() => { LP.fired = Date.now(); LP.eat = true; try { navigator.vibrate && navigator.vibrate(12); } catch { } queueMenu(+r.dataset.i); }, 480);
}, { passive: true });
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => clearTimeout(LP.t), { passive: true });
document.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - LP.x, e.clientY - LP.y) > 10) clearTimeout(LP.t); }, { passive: true });
// El toque largo no debe además reproducir la canción al soltar.
document.addEventListener('click', e => {
  if (!LP.eat) return;
  LP.eat = false; // solo el clic que viene al soltar el toque largo
  if (Date.now() - LP.fired < 1500 && e.target.closest('.qr[data-i]')) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true);
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, d = el.dataset;
  if (el.tagName === 'A') e.preventDefault();
  switch (a) {
    case 'nav': {
      // Primero se pinta la pestaña activa y en el siguiente cuadro se arma la pantalla nueva;
      // así el toque responde al instante aunque la vista tarde en construirse.
      $$('#tabs button,#sidenav button').forEach(b => b.classList.toggle('on', b.dataset.r === d.r));
      const r = d.r; requestAnimationFrame(() => setTimeout(() => go(r, {}, { root: true }), 0));
      break;
    }
    case 'open': if (d.r === 'artist' && !d.id && !d.name) break; go(d.r, { id: d.id, name: d.name, ...(d.tid ? { tid: d.tid } : {}) }, { push: !!d.id || !!d.name || !!d.push }); break;
    case 'back': if (document.body.classList.contains('in-party') || document.body.classList.contains('party-host')) break; if (!back()) go('home', {}, { root: true }); break;
    case 'retry': cache.clear(); LIB.reset(); render(); break;
    case 'play-list': { const l = lists[d.l]; if (l) setQueue(l, +d.i || 0); break; }
    case 'play-shuffle': { const l = lists[d.l]; if (!l || !l.length) break; const a = [...l]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } setQueue(a, 0); break; }
    case 'queue-list': { const l = lists[d.l]; if (l) addToQueue(l); break; }
    case 'track-menu': { const l = lists[d.l]; if (l) trackMenu(l[+d.i]); break; }
    case 'track-menu-cur': if (P.cur) menu(P.cur, [
      ...songOptions(P.cur),
      ...(LY.data ? [[tx('Sincronizar letra a mano'), 'sync', () => syncStart()]] : []),
      ...(api.searchLyrics ? [[tx('Buscar otra letra (LrcLib)'), 'search', lyricsSearch]] : []),
      [tx('Pegar o editar letra'), 'paste', lyricsPaste],
      ...(LY.data && LY.data.local ? [[tx('Quitar la letra guardada en este teléfono'), 'x', forgetLocalLyrics]] : []),
      ...(api.kind === 'jellyfin' ? [[tx('Mis dispositivos'), 'devices', openDevices]] : []),
      [tx('Ir al álbum'), 'disc', () => (P.cur.albumId || P.cur.album) && go('album', { id: P.cur.albumId, tid: P.cur.id }, { push: true })], [tx('Ir al artista'), 'user', () => (P.cur.artistId || P.cur.artist || P.cur.trackArtist) && go('artist', { id: P.cur.artistId, name: P.cur.artist || P.cur.trackArtist }, { push: true })], [tx('Ver la cola'), 'queue', () => mqMobile.matches ? go('queue') : (closeSheet(), $('#queue').classList.add('open'))]]); break;
    case 'play-artist': { try { let t = await api.artistTracks(d.id, d.name); if (d.shuffle) t = t.sort(() => Math.random() - .5); if (t.length) setQueue(t, 0); else toast(tx('Este artista no tiene canciones')); } catch (err) { toast(err.message); } break; }
    case 'toggle': toggle(); break;
    case 'next': next(false); break;
    case 'prev': prev(); break;
    case 'mute': P.audio.muted = !P.audio.muted; if (typeof PH !== 'undefined') PH.audio.muted = P.audio.muted; paintVol(); break;
    case 'sheet': if (document.body.classList.contains('party-host')) break; openSheet(); break;
    case 'sheet-close': if (!back()) closeSheet(); break;
    case 'queue': if (document.body.classList.contains('party-host')) break; $('#queue').classList.toggle('open'); break;
    case 'lyrics': setLyricsMode(!LY.mode); break;
    case 'genre-shuffle': { const l = lists[d.l]; if (l && l.length) { const sh = [...l]; for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; } setQueue(sh, 0); } break; }
    case 'songview': Settings.set('songView', d.v); { const m = $('#main').scrollTop; await render(); $('#main').scrollTop = m; } break;
    case 'nanuq-pet': {
      const v = el.querySelector('.nvis'), sm = el.querySelector('small');
      if (v) { nqBurst(4000); v.classList.remove('hop'); void v.getBoundingClientRect(); v.classList.add('hop'); if (sm) sm.textContent = NANUQ_VISIT_TAPS[Math.floor(Math.random() * NANUQ_VISIT_TAPS.length)](el.dataset.visitor); break; }
      nqBurst(4000); el.classList.remove('pet'); void el.offsetWidth; el.classList.add('pet'); if (sm) sm.textContent = NANUQ_PETS[Math.floor(Math.random() * NANUQ_PETS.length)]; break;
    }
    case 'dj-start': e.stopPropagation(); DJ.start(); break;
    case 'dj-switch': el.disabled = true; await DJ.switchUp(); el.disabled = false; break;
    case 'dj-stop': DJ.stop(); break;
    case 'dj-voice': Settings.set('djVoice', !Settings.djVoice); el.classList.toggle('on', Settings.djVoice); if (Settings.djVoice) DJ.speak(tx('Hola, soy Nanuq. Así sueno.')); break;
    case 'mix-play': { e.stopPropagation(); try { const d = await mixDef(d0(el).k); if (!d || !d.q) break; const t = await mixTracks(d); if (t.length) { setQueue(t, 0); toast(tx('Reproduciendo «') + d.name + '»'); } } catch (err) { toast(err.message); } break; }
    case 'mix-regen': { const d = await mixDef(d0(el).k); if (!d) break; cache.delete('mix:' + d.k + ':100'); render(); break; }
    case 'mix-save': { const d = await mixDef(d0(el).k); if (!d) break; const t = await mixTracks(d); askName(tx('Guardar como playlist'), d.name + ' · ' + new Date().toLocaleDateString(LOC), async n => { try { await api.savePlaylist(n, t.map(x => x.id)); playlistsChanged(); toast(tx('Playlist «') + n + tx('» guardada')); } catch (err) { toast(tx('No se pudo guardar: ') + err.message); } }); break; }
    case 'home-albums': go('albums', {}, { push: true }); break;
    case 'sync-start': syncStart(); break;
    case 'sync-mark': syncMark(); break;
    case 'sync-undo': syncUndo(); break;
    case 'sync-nudge': syncNudge(+d.d); break;
    case 'sync-save': syncSave(); break;
    case 'sync-cancel': syncCancel(); break;
    case 'sync-restart': SY.cur = 0; seekTo(0); P.audio.play().catch(() => { }); renderSync(); break;
    case 'lyr-search': lyricsSearch(); break;
    case 'lyr-paste': lyricsPaste(); break;
    case 'lyrics-open': if (!P.cur) { toast(tx('Reproduce una canción para ver su letra')); break; } if ($('#sheet').classList.contains('open') && LY.mode) { if (!back()) closeSheet(); } else openSheet(true); break;
    case 'sheet-queue': setQueueMode(!$('#sheet').classList.contains('qmode')); break;
    case 'songs-play': {
      try {
        const st = cache.has('songs') ? await cache.get('songs') : null;
        let list;
        if (d.shuffle) list = (await api.tracks({ start: 0, limit: 500, sort: 'random' })).items;
        else if (st && st.total != null && st.items.length >= st.total) list = st.items;
        else list = (await api.tracks({ start: 0, limit: 1000, sort: Settings.songSort })).items;
        if (list.length) { setQueue(list, 0); if (d.shuffle) toast(tx('Reproduciendo 500 canciones al azar').replace('500', list.length)); } else toast(tx('No hay canciones'));
      } catch (err) { toast(err.message); }
      break;
    }
    case 'qplay': if (!e.target.closest('.x')) playIndex(+d.i); break;
    case 'qremove': e.stopPropagation(); removeAt(+d.i); break;
    case 'clear': clearQueue(); break;
    case 'shuffle': shuffleQueue(); break;
    case 'cycle-mode': setMode({ once: 'all', all: 'one', one: 'once' }[P.mode]); toast(MODES[P.mode][0]); break;
    case 'save': askName(tx('Guardar cola como playlist'), tx('Nueva playlist'), async name => { try { await api.savePlaylist(name, P.queue.map(t => t.id)); playlistsChanged(); toast(tx('Playlist «') + name + tx('» guardada')); } catch (err) { toast(tx('No se pudo guardar: ') + err.message); } }); break;
    case 'theme': applyTheme(d.t); $$('.th').forEach(b => b.classList.toggle('on', b.dataset.t === d.t)); { const sm = $('.thbox>summary'); if (sm) sm.innerHTML = themeSummary(); } break;
    case 'conn-test': connTest(); break;
    case 'lib-refresh': el.disabled = true; await refreshFromJellyfin(); el.disabled = false; break;
    case 'devices': openDevices(); break;
    case 'dev-sync': Settings.set('devSync', !Settings.devSync); el.classList.toggle('on', Settings.devSync); if (Settings.devSync) RC.start(); else RC.stop(); break;
    case 'dev-net': Settings.set('devSameNet', !Settings.devSameNet); el.classList.toggle('on', Settings.devSameNet); break;
    case 'recap-week': go('recap', { week: 1 }, { push: true }); break;
    case 'dev-others': Settings.set('devOthers', !Settings.devOthers); el.classList.toggle('on', Settings.devOthers); break;
    case 'fav': toggleFav(); break;
    case 'dl': dlTap(); break;
    case 'dl-remove': DL.remove(d.id); break;
    case 'dl-clear': menu(null, [[d.auto ? tx('Sí, borrar las guardadas automáticamente') : tx('Sí, borrar todas las descargas'), 'x', () => { DL.removeAll(!!d.auto); toast(tx('Descargas borradas')); }], [tx('Cancelar'), 'left', () => { }]]); break;
    case 'dl-wifi': Settings.set('dlWifi', !Settings.dlWifi); el.classList.toggle('on', Settings.dlWifi); DL.config(); toast(Settings.dlWifi ? tx('Solo se descargará con Wi-Fi') : tx('También se descargará con datos móviles')); break;
    case 'pf': Settings.set('pfOn', !Settings.pfOn); el.classList.toggle('on', Settings.pfOn); { const r = $('#pfRow'); if (r) r.hidden = !Settings.pfOn; } PF.sync(); break;
    case 'dl-auto': Settings.set('dlAuto', !Settings.dlAuto); el.classList.toggle('on', Settings.dlAuto); break;
    case 'fade': Settings.set('fade', !Settings.fade); el.classList.toggle('on', Settings.fade); break;
    case 'discord': Settings.set('discord', !Settings.discord); el.classList.toggle('on', Settings.discord); { const r = $('#dcCoverRow'); if (r) r.hidden = !Settings.discord; } DISC.key = '-'; DISC.update(); { const x = $('#dcSt'); if (x) x.hidden = !Settings.discord; } dcStatusPaint(); setTimeout(dcStatusPaint, 2500); setTimeout(dcStatusPaint, 7000); break;
    case 'discord-cover': Settings.set('discordCover', !Settings.discordCover); el.classList.toggle('on', Settings.discordCover); DISC.key = '-'; DISC.update(); break;
    case 'wave': Settings.set('wave', !Settings.wave); el.classList.toggle('on', Settings.wave); if (Settings.wave) loadPeaks(P.cur); break;
    case 'req-del': REQ.list = REQ.list.filter(r => r.id !== d.id); REQ.save(); renderReqSoon(); break;
    case 'req-clear': REQ.list = REQ.list.filter(r => r.state === 'queued' || r.state === 'active'); REQ.save(); renderReqSoon(); break;
    case 'req-retry': { const r = REQ.list.find(x => x.id === d.id); if (!r) break; el.disabled = true; try { await REQ.retry(r); toast(tx('Se pidió otra vez')); } catch (err) { el.disabled = false; toast(err.message, 6000); } renderReqSoon(); break; }
    case 'req-find': { const r = REQ.list.find(x => x.id === d.id); if (r) go('search', { q: r.song || String(r.title).split(' - ').slice(1).join(' - ') || r.title }, { root: true }); break; }
    case 'req-change': menu(null, [[tx('Conectar con otro servidor SomeDL'), 'server', () => { REQ.setCfg(null); render(); }], [tx('Cancelar'), 'left', () => { }]]); break;
    case 'igloo-full': { const ig = $('#igloo'); if (!ig) break; if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else ig.requestFullscreen().catch(() => toast(tx('Esta pantalla no permite pantalla completa.'))); break; }
    case 'party-open': el.disabled = true; await PH.open(); break;
    case 'party-close': menu(null, [[tx('Sí, cerrar la fiesta'), 'x', () => PH.close()], [tx('Cancelar'), 'left', () => { }]], ('<div class="mh"><div class="t">' + tx('Se saca a todos y se borran las canciones que llegaron.') + '</div></div>')); break;
    case 'party-newcode': nanuqDesktop.party.op({ op: 'newcode' }).catch(() => { }); toast(tx('Código nuevo: el anterior ya no sirve para entrar (los que ya están siguen).'), 4000); break;
    case 'party-toggle': PH.toggle(); break;
    case 'party-skip': PH.done(); break;
    case 'party-remove': if (partyHost()) nanuqDesktop.party.op({ op: 'remove', id: d.id }).catch(() => { }); else PG.remove(d.id); break;
    case 'party-find': PG.finding = true; paintParty(); PG.found = await PG.find(); PG.finding = false; paintParty(); break;
    case 'party-pick': { const f = PG.found && PG.found[+d.k]; if (f) { $('#ptAddr').value = f.addr; $('#ptCode').focus(); } break; }
    case 'party-leave': PG.leave(false); PG.why = ''; paintParty(); break;
    case 'party-artist': partyBrowse('artist', d.id, d.name); break;
    case 'party-album': partyBrowse('album', d.id, d.name); break;
    case 'party-playlist': partyBrowse('playlist', d.id, d.name); break;
    case 'party-back': partySearch(PTS.q); break;
    case 'party-send': { const l = lists[d.l]; if (l && l[+d.i]) PG.add(l[+d.i]); break; }
    case 'logout': logout(); break;
  }
});
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  // Fiesta a pantalla completa: las flechas ↑ ↓ son el volumen (solo ahí).
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && document.fullscreenElement && document.fullscreenElement.id === 'igloo') { e.preventDefault(); partyVolumeStep(e.key === 'ArrowUp' ? .05 : -.05); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); return; }
  if (SY.on && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); syncMark(); return; }
  if (SY.on && e.key === 'Backspace') { e.preventDefault(); syncUndo(); return; }
  if (e.key === ' ') { e.preventDefault(); toggle(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) next(false);
  else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
  else if (e.key === 'Escape') back();
  else if (e.key === '/') { e.preventDefault(); go('search'); }
});

/* =========================================================
   Login
   ========================================================= */
/* ---- Servidores recientes y búsqueda en la red ---- */
function recentServers() { return store.get('servers', []); }
function rememberServer(srv, user) {
  if (!srv || !srv.base) return;
  const all = recentServers(), prev = all.find(x => x.base === srv.base) || {};
  const e = { base: srv.base, name: srv.serverName || prev.name || 'Jellyfin', id: srv.id || prev.id || '', version: srv.version || prev.version || '', user: user || prev.user || '', at: Date.now() };
  store.set('servers', [e, ...all.filter(x => x.base !== srv.base)].slice(0, 8));
}
function forgetServer(base) { store.set('servers', recentServers().filter(x => x.base !== base)); }
// Revisa la conexión con un límite de tiempo y mide cuánto tarda.
async function probeTimed(base, ms = 5000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms), t0 = performance.now();
  try {
    const r = await fetch(base + '/System/Info/Public', { signal: c.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!r.ok) return { ok: false, why: 'error ' + r.status };
    const d = await r.text().then(jparse).catch(() => null);
    if (!d || !d.Id) return { ok: false, why: tx('no parece Jellyfin') };
    return { ok: true, ms: Math.round(performance.now() - t0), info: { serverName: d.ServerName, version: d.Version, id: d.Id } };
  } catch { return { ok: false, why: tx('sin conexión') }; }
  finally { clearTimeout(t); }
}
const canDiscover = () => !!((window.nanuqDesktop && window.nanuqDesktop.discover) || (window.NanuqAndroid && window.NanuqAndroid.discover));
// Busca servidores Jellyfin en la red local (UDP, puerto 7359) a través de la app de Android o de escritorio.
function discoverServers() {
  return new Promise(resolve => {
    const done = list => resolve((list || []).map(x => {
      try {
        const o = jparse(x.raw);
        let base; try { base = parseServer(o.Address || x.from).base; } catch { base = 'http://' + x.from + ':8096'; }
        return { base, name: o.Name || 'Jellyfin', id: o.Id || '' };
      } catch { return null; }
    }).filter(Boolean));
    if (window.nanuqDesktop && window.nanuqDesktop.discover) { window.nanuqDesktop.discover().then(done, () => done([])); return; }
    if (window.NanuqAndroid && window.NanuqAndroid.discover) {
      const t = setTimeout(() => { window.__nanuqDiscovered = null; done([]); }, 7000);
      window.__nanuqDiscovered = l => { clearTimeout(t); window.__nanuqDiscovered = null; done(l); };
      window.NanuqAndroid.discover(); return;
    }
    done([]);
  });
}
// Lista de servidores (recientes o encontrados): cada uno revisa su conexión; al tocarlo se pide usuario y contraseña.
function serverList(box, title, list, { removable, extra = '' } = {}) {
  box.innerHTML = `<h3><span>${esc(title)}</span>${extra}</h3>` + (list.length ? list.map((x, k) => {
    let v6 = false; try { v6 = parseServer(x.base).v6; } catch { }
    return `<div class="srow" role="button" tabindex="0" data-k="${k}">${ic('server')}<span class="sp"><b>${esc(x.name || 'Jellyfin')}<span class="fam">${v6 ? 'IPv6' : /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(x.base) ? 'IPv4' : tx('Nombre')}</span></b><small>${esc(x.base)}${x.user ? ' · ' + esc(x.user) : ''}</small></span><span class="st">${tx('comprobando…')}</span>${removable ? `<button type="button" class="x" data-x="${k}" aria-label="${tx('Quitar de recientes')}" title="${tx('Quitar')}">${ic('x')}</button>` : ''}</div>`;
  }).join('') : ('<div class="none">' + tx('No se encontraron servidores.') + '</div>'));
  const rows = [...box.querySelectorAll('.srow')], state = [];
  list.forEach((x, k) => probeTimed(x.base).then(r => {
    state[k] = r; const st = rows[k] && rows[k].querySelector('.st'); if (!st) return;
    st.className = 'st ' + (r.ok ? 'ok' : 'bad'); st.textContent = r.ok ? '● ' + r.ms + ' ms' : '● ' + r.why;
  }));
  const pick = async k => {
    const x = list[k], st = rows[k].querySelector('.st'), msg = $('#lmsg');
    st.className = 'st'; st.textContent = tx('conectando…');
    const r = state[k] && state[k].ok ? state[k] : await probeTimed(x.base, 8000);
    if (!r.ok) { st.className = 'st bad'; st.textContent = '● ' + r.why; if (msg) msg.innerHTML = `<div class="err"><b>${tx('Sin conexión')}</b>${esc(netError(x.base).message)}</div>`; return; }
    rememberServer({ ...r.info, base: x.base });
    showLogin({ srv: { ...r.info, base: x.base }, user: x.user || '' });
  };
  box.onclick = e => {
    const xb = e.target.closest('[data-x]');
    if (xb) { e.stopPropagation(); forgetServer(list[+xb.dataset.x].base); showLogin(); return; }
    const row = e.target.closest('.srow'); if (row) pick(+row.dataset.k);
  };
  box.onkeydown = e => { const row = e.target.closest('.srow'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(+row.dataset.k); } };
}
// ¿La contraseña viajaría sin cifrar por internet? http:// a una dirección pública. En tu red local, por VPN
// (Tailscale/CGNAT) o por Yggdrasil (200::/7, que ya cifra de punta a punta) no se avisa.
function cleartextRisk(base) {
  let u; try { u = new URL(base); } catch { return false; }
  if (u.protocol !== 'http:') return false;
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes('.') && !h.includes(':')) return false; // nombre corto de la red local
  if (/^(localhost|.*\.(local|lan|home|internal|home\.arpa|ts\.net))$/.test(h)) return false;
  const v4 = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) { const a = +v4[1], b = +v4[2]; return !(a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)); }
  if (h.includes(':')) { const f = parseInt(h.split(':')[0] || '0', 16) || 0; return !(h === '::1' || (f & 0xfe00) === 0xfc00 || (f & 0xffc0) === 0xfe80 || (f & 0xfe00) === 0x0200); }
  return true; // nombre de dominio público
}
function showLogin(stage) {
  const L = $('#login'); L.classList.remove('hidden'); $('#app').classList.add('hidden');
  const saved = store.get('lastServer', '');
  const srv = stage && stage.srv;
  L.innerHTML = `<div class="box"><div class="lg"><span class="lgo">${logoInner()}</span><div class="word">nanuq</div><div class="tag">${tx('Música desde tu servidor Jellyfin')}</div></div>
  ${SEC.shut() ? `<div class="err" id="lsec" style="margin-bottom:14px"><b>${SEC.kind === 'lost' ? tx('Tus datos guardados ya no se pueden abrir') : tx('No se pudo abrir el almacén cifrado')}</b>${SEC.kind === 'lost'
      ? tx('La clave que los protegía ya no existe en este dispositivo (pasa a veces tras actualizar o restaurar el sistema). Puedes entrar, pero no se guardará nada hasta que empieces de cero.')
      : (window.NanuqAndroid ? tx('El almacén de claves de Android no respondió.') : tx('El llavero del sistema (GNOME Keyring o KWallet) no respondió o está bloqueado: desbloquéalo y vuelve a abrir Nanuq.')) + tx(' Mientras tanto puedes entrar, pero no se guardará nada.')}
      <div style="margin-top:10px"><button type="button" class="btn" data-secreset>${tx('Empezar de cero')}</button></div></div>` : ''}
  <form class="pane" id="lf" autocomplete="on">
    ${srv ? `<div class="server">${ic('server')}<div class="sp"><b>${esc(srv.serverName)}</b><span class="muted">${esc(srv.base)} ${tx('· Jellyfin')} ${esc(srv.version)}</span></div><button type="button" class="btn" data-change>${tx('Cambiar')}</button></div>
      ${cleartextRisk(srv.base) ? `<div class="hint warn" style="margin:-4px 0 12px;word-break:normal">${tx('⚠ Esta conexión no está cifrada (http://) y el servidor parece estar en internet: tu contraseña y tu música viajarían sin protección. Usa https:// (por ejemplo, con Caddy) o una VPN.')}</div>` : ''}
      <div class="field"><label for="lu">${tx('Usuario')}</label><input class="inp" id="lu" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(stage.user || '')}"></div>
      <div class="field"><label for="lp">${tx('Contraseña')}</label><input class="inp" id="lp" name="password" type="password" autocomplete="current-password"></div>
      <button class="btn pri wide" id="lgo">${tx('Entrar')}</button>`
      : `<div class="field"><label for="ls">${tx('Servidor')}</label><input class="inp" id="ls" inputmode="url" autocapitalize="none" spellcheck="false" placeholder="${tx('https://musica.ejemplo.com o [2001:db8::10]:8096')}" value="${esc(saved)}" required><div class="hint" id="lh">${tx('IPv4, IPv6 (con o sin corchetes) o nombre de host.')}</div></div>
      <button class="btn pri wide" id="lgo">${tx('Conectar')}</button>`}
    <div class="msg" id="lmsg"></div>
  </form>
  ${srv ? '' : `<div class="slist" id="lrec"></div><div class="slist" id="ldisc"></div>`}
  <div class="alt"><button type="button" data-demo>${tx('Probar el modo demo')}</button></div></div>`;
  const msg = $('#lmsg', L), btn = $('#lgo', L);
  L.querySelector('[data-demo]').onclick = () => startApp(new Demo());
  const sr = L.querySelector('[data-secreset]');
  if (sr) sr.onclick = () => askConfirm(SEC.kind === 'lost'
    ? tx('¿Empezar de cero? Se apartan los datos que ya no se pueden abrir (sesión, cola y letras guardadas aquí; tus descargas se conservan) y se crea un almacén nuevo. Tendrás que entrar otra vez.')
    : tx('¿Empezar de cero? Si el llavero solo está bloqueado, tus datos volverían al desbloquearlo: con esto se apartan y se crea un almacén nuevo. Tendrás que entrar otra vez.'), tx('Empezar de cero'), async () => {
      const k = await Vault.reset();
      toast(SEC.ok() ? tx('Listo: almacén nuevo. Ya puedes entrar.') : k === null ? tx('Listo. Este sistema no tiene llavero: los datos se guardarán como antes (ver Ajustes).') : tx('No se pudo crear el almacén nuevo.'), 5000);
      showLogin(stage);
    });
  if (!srv) {
    const rec = recentServers(), recBox = $('#lrec', L), discBox = $('#ldisc', L);
    if (rec.length) serverList(recBox, tx('Servidores recientes'), rec, { removable: true }); else recBox.remove();
    if (canDiscover()) {
      discBox.innerHTML = `<h3><span>${tx('En tu red')}</span><button type="button" data-find>${ic('search')} ${tx('Buscar servidores en mi red')}</button></h3>`;
      const find = async () => {
        discBox.innerHTML = ('<h3><span>' + tx('En tu red') + '</span><span>' + tx('Buscando…') + '</span></h3>');
        const found = await discoverServers();
        if (!document.body.contains(discBox)) return;
        serverList(discBox, tx('En tu red'), found, { extra: ('<button type="button" data-again>' + tx('Buscar otra vez') + '</button>') });
        const again = discBox.querySelector('[data-again]'); if (again) again.onclick = e => { e.stopPropagation(); find(); };
      };
      discBox.querySelector('[data-find]').onclick = find;
    } else discBox.remove();
    const inp = $('#ls', L), hint = $('#lh', L);
    const upd = () => { const v = inp.value.trim(); if (!v) { hint.className = 'hint'; hint.textContent = tx('IPv4, IPv6 (con o sin corchetes) o nombre de host.'); return; } try { const p = parseServer(v); hint.className = 'hint ' + (p.mixed ? 'warn' : 'ok'); hint.textContent = '→ ' + p.base + (p.v6 ? '  (IPv6)' : '') + (p.mixed ? tx('  · El navegador bloquea http:// desde una app https://') : ''); } catch (e) { hint.className = 'hint warn'; hint.textContent = e.message; } };
    inp.oninput = upd; upd();
    $('#lf', L).onsubmit = async e => {
      e.preventDefault(); msg.innerHTML = '';
      let p; try { p = parseServer(inp.value); } catch (err) { msg.innerHTML = `<div class="err">${esc(err.message)}</div>`; return; }
      btn.disabled = true; btn.textContent = tx('Conectando…');
      try { const info = await Jellyfin.probe(p.base); store.set('lastServer', inp.value.trim()); rememberServer({ ...info, base: p.base }); showLogin({ srv: { ...info, base: p.base } }); }
      catch (err) { msg.innerHTML = `<div class="err"><b>${tx('Sin conexión')}</b>${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = tx('Conectar'); }
    };
  } else {
    L.querySelector('[data-change]').onclick = () => showLogin();
    $('#lf', L).onsubmit = async e => {
      e.preventDefault(); msg.innerHTML = ''; btn.disabled = true; btn.textContent = tx('Entrando…');
      const j = new Jellyfin({ base: srv.base, serverName: srv.serverName, version: srv.version });
      try { await j.login($('#lu', L).value.trim(), $('#lp', L).value); await Vault.save(j.cfg()); rememberServer(srv, j.userName); startApp(j); showSplash(j.userName); }
      catch (err) { msg.innerHTML = `<div class="err">${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = tx('Entrar'); }
    };
    setTimeout(() => (stage.user ? $('#lp', L) : $('#lu', L)).focus(), 50);
  }
}
function startApp(a) {
  api = a; cache.clear(); ServerStats.ok = null;
  setTimeout(() => History.purge(), 1500); // historial local de versiones anteriores: ya no se usa
  setTimeout(() => RC.start(), 800);
  setTimeout(() => DL.backfillCovers(), 4000);
  setTimeout(() => REQ.schedule(0), 2500); // pedidos a SomeDL que seguían en camino
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const q = a.kind === 'demo' ? null : store.get('queue', null);
  if (q && q.q && q.q.length) { P.queue = q.q; P.i = Math.min(q.i, q.q.length - 1); P.cur = P.queue[P.i] || null; } else { P.queue = []; P.i = -1; P.cur = null; }
  P.resume = a.kind === 'demo' ? null : QPOS.restore();
  updateNow();
  if (P.resume) { P.dragSec = P.resume.sec; drawWaves(); } // la barra muestra dónde se quedó
  updateModeBtn(); renderQueueAll(); DJ.restore();
  S.stack = []; go(partyHostOpen() ? 'party' : 'home', {}, { root: true }); // con la sala abierta (p. ej. al recargar en plena fiesta) solo existe la Fiesta
  if (a.kind !== 'demo' || partyGuest()) setTimeout(() => PG.resume(), 600);
}
async function logout() {
  PG.leave(false); if (partyHost() && PH.st.open) PH.close();
  RC.stop(); DJ.stop(true); store.del('dj'); sessionHold('off');
  if (api && api.kind === 'jellyfin') rememberServer({ base: api.base, serverName: api.serverName, version: api.version }, api.userName);
  if (P.cur) api.report('stop', P.cur, ptime());
  P.pause(); P.audio.removeAttribute('src');
  if (api && api.kind === 'jellyfin') api.logout();
  // Lo que dice algo de quien usaba la app (historial del DJ, conteo de reproducciones, índice de su biblioteca) también
  // se borra: si entra otra persona en este dispositivo, no lo hereda.
  PF.last = '-'; try { if (PF.on) NanuqAndroid.pfSet('[]'); } catch { }
  store.del('djHist'); store.del('plays'); store.del('libIdx'); LYRX.reset(); DJ.hist = []; Plays.data = {}; LIB.owner = null; LIB.data = null; LIB.at = 0;
  store.del('session'); store.del('queue'); QPOS.clear(); P.resume = null; P.queue = []; P.i = -1; P.cur = null; cache.clear(); P.peaks.clear();
  updateNow(); showLogin();
}

/* =========================================================
   Boot
   ========================================================= */
$('#sidenav').innerHTML = NAV.map(([r, n, i]) => `<button data-act="nav" data-r="${r}">${ic(i)}${n}</button>`).join('');
$('#tabs').innerHTML = TABS.map(([r, n, i]) => `<button data-act="nav" data-r="${r}">${ic(i)}${n}</button>`).join('');
bearInit();
store.del('playerBear'); // opción quitada (Nanuq ya no aparece sobre el reproductor)
applyTheme(Settings.theme);
mqMobile.addEventListener?.('change', () => { if (!mqMobile.matches && cur()?.name === 'queue') go('home', {}, { root: true }); requestAnimationFrame(drawWaves); });
DL.init();
(async () => {
const wasShut = SEC.shut();
await Vault.init();
// El almacén se abrió con el reintento: lo que se leyó al cargar (cerrado) vino vacío y se vuelve a leer, para que una
// escritura posterior no pise los datos reales con esos vacíos.
if (wasShut && SEC.ok()) {
  Plays.data = store.get('plays', {}); MP3.ids = new Set(store.get('mp3ids', []));
  REQ.cfg = store.get('somedl', null); REQ.list = store.get('somedlReqs', []);
  DJ.hist = store.get('djHist', []); // si no, la primera ronda del DJ pisaba su historial de sesiones pasadas
  if (DL.on) { DL.map.clear(); DL.init(); }
}
const sess = await Vault.load();
if (sess && sess.kind === 'jellyfin' && sess.base && !recentServers().some(x => x.base === sess.base)) rememberServer({ base: sess.base, serverName: sess.serverName, version: sess.version }, sess.userName);
showSplash(sess && sess.kind === 'jellyfin' && sess.token ? sess.userName : '');
if (sess && sess.kind === 'jellyfin' && sess.token) startApp(new Jellyfin(sess)); else showLogin();
})();
try { history.replaceState({ d: 0 }, ''); history.pushState({ d: 1 }, ''); } catch { }
if ('serviceWorker' in navigator && location.protocol !== 'file:') { navigator.serviceWorker.register('sw.js').catch(() => { }); }
