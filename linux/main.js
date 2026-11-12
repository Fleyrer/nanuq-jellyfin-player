// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Nanuq para Linux: la misma PWA en una ventana de Electron.
// - Los archivos se sirven desde http://127.0.0.1:<puerto>: es un contexto seguro y, al no ser
//   https, se puede conectar con servidores Jellyfin http:// de la red local.
// - Chromium publica navigator.mediaSession por MPRIS: controles en el panel de GNOME/KDE,
//   teclas multimedia y audífonos Bluetooth sin código extra.
'use strict';
const { app, BrowserWindow, shell, nativeTheme, ipcMain, safeStorage } = require('electron');
const dgram = require('dgram');
const os = require('os');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

app.setName('Nanuq');
// En Wayland, GNOME busca el ícono de la ventana por su app_id, que Electron saca del nombre del .desktop
// (por defecto «nanuq.desktop», el de la RPM y la AppImage). En Flatpak el lanzador es com.nanuq.app.desktop.
if (process.env.FLATPAK_ID) app.setDesktopName(process.env.FLATPAK_ID + '.desktop');
// Windows: identidad de la app para las notificaciones y los controles multimedia de la barra de tareas.
if (process.platform === 'win32') app.setAppUserModelId('com.nanuq.app');
// NANUQ_PROFILE: carpeta de datos aparte (para probar dos copias a la vez como si fueran dos dispositivos).
if (process.env.NANUQ_PROFILE) app.setPath('userData', process.env.NANUQ_PROFILE);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); // la siguiente canción arranca sola
app.commandLine.appendSwitch('enable-features', 'MediaSessionService,HardwareMediaKeyHandling');
// Sin caché HTTP en el disco: ahí Chromium guarda las respuestas tal cual (carátulas, y antes también URLs con el token),
// sin forma de saber si otra app las cambió. Las carátulas se vuelven a pedir a tu Jellyfin al abrir la app.
app.commandLine.appendSwitch('disable-http-cache');

const WWW = path.join(__dirname, 'www');
// Puerto fijo: localStorage (sesión, ajustes, cola) depende del origen, incluido el puerto.
const PORT = +process.env.NANUQ_PORT || 47863; // NANUQ_PORT: para probar en paralelo con otra copia abierta
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

let win = null, origin = '';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}

function serve() {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    // Seguridad: cualquier página abierta en tu navegador puede pedirle cosas a este puerto. Un byte nulo en la ruta hacía
    // que fs.stat lanzara un error fuera del callback y se cerraba toda la app; solo método GET/HEAD y rutas razonables.
    if ((req.method !== 'GET' && req.method !== 'HEAD') || p.includes('\0') || p.length > 512) { res.writeHead(400).end(); return; }
    // DNS rebinding: una página de internet que se haga pasar por 127.0.0.1 llega con su propio nombre en «Host».
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ''))) { res.writeHead(421).end(); return; }
    if (p.startsWith('/fiesta/')) { ptServe(req, res, p); return; } // canciones de la fiesta (ver «Fiesta» más abajo)
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(WWW, p));
    if (!file.startsWith(WWW + path.sep)) { res.writeHead(403).end(); return; }
    try { fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No encontrado'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }); } catch { res.writeHead(400).end(); }
  });
  server.on('clientError', (e, sock) => { try { sock.destroy(); } catch { } }); // peticiones mal formadas: sin caerse
  return new Promise((resolve, reject) => {
    server.once('error', e => {
      if (e.code !== 'EADDRINUSE') return reject(e);
      // Otro programa usa el puerto: se usa uno libre (los datos guardados no se verán en esta sesión).
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(PORT));
  });
}

// Buscar servidores Jellyfin en la red local: "Who is JellyfinServer?" por UDP al puerto 7359 (método oficial).
const broadcastOf = (ip, mask) => ip.split('.').map((o, i) => (+o | (~+mask.split('.')[i] & 255)) & 255).join('.');
function discover(ms = 3000) {
  return new Promise(resolve => {
    const found = new Map(), sock = dgram.createSocket('udp4'), msg = Buffer.from('Who is JellyfinServer?');
    sock.on('message', (buf, rinfo) => {
      const raw = buf.toString('utf8');
      let id = raw; try { id = JSON.parse(raw).Id || raw; } catch { return; }
      if (!found.has(id) && found.size < 32 && raw.length < 8192) found.set(id, { raw, from: rinfo.address }); // como mucho 32 servidores
    });
    sock.on('error', () => { });
    sock.bind(() => {
      try { sock.setBroadcast(true); } catch { }
      const targets = new Set(['255.255.255.255']);
      for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && a.netmask) targets.add(broadcastOf(a.address, a.netmask));
      const send = () => targets.forEach(t => sock.send(msg, 7359, t, () => { }));
      send(); setTimeout(send, 900); // por si se pierde el primer paquete
    });
    setTimeout(() => { try { sock.close(); } catch { } resolve([...found.values()]); }, ms);
  });
}
// Seguridad: solo la página de la app (nuestro servidor en 127.0.0.1) puede pedirle cosas al proceso principal.
const fromApp = e => { try { return !!origin && new URL(e.senderFrame.url).origin === origin; } catch { return false; } };
ipcMain.handle('nanuq:discover', e => fromApp(e) ? discover() : []);

// Petición HTTP desde el proceso principal, sin las restricciones de CORS de la página.
// La usa «Solicitar canción»: el servidor web de SomeDL no acepta peticiones de otros orígenes.
// Solo las rutas de la API de SomeDL que usa «Solicitar canción»: si alguien lograra ejecutar código en la página,
// no podría usar este puente para leer otros servicios de tu red. Sin seguir redirecciones.
const SOMEDL_GET = ['/status', '/get-queue', '/get-version'], SOMEDL_POST = ['/add'];
ipcMain.handle('nanuq:http', async (e, { method, url, body } = {}) => {
  if (!fromApp(e)) return { status: 0, text: 'No permitido' };
  let u;
  try { u = new URL(String(url)); } catch { return { status: 0, text: 'Dirección no válida' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { status: 0, text: 'Solo se admiten direcciones http o https' };
  const post = method === 'POST', p = u.pathname.replace(/\/$/, '');
  if (!(post ? SOMEDL_POST : SOMEDL_GET).some(x => p.endsWith(x))) return { status: 0, text: 'Ruta no permitida' };
  try {
    const r = await fetch(u, {
      method: post ? 'POST' : 'GET',
      headers: { Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}) },
      body: post ? (typeof body === 'string' ? body : '{}') : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(120000) // SomeDL busca los datos de la canción antes de responder a /add
    });
    // Se lee por partes y se corta al pasar de 4 MB: una respuesta enorme no puede agotar la memoria.
    const chunks = []; let size = 0;
    if (r.body) for await (const c of r.body) { size += c.length; if (size > 4e6) { try { await r.body.cancel(); } catch { } return { status: r.status, text: '' }; } chunks.push(c); }
    return { status: r.status, text: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8') };
  } catch (e) { return { status: 0, text: String((e && e.cause && e.cause.code) || (e && e.message) || e) }; }
});

// Token de Jellyfin cifrado con el llavero del sistema (GNOME Keyring / KWallet). Si Electron solo tiene
// «basic_text» (una clave fija, sin llavero), no se finge: la página lo guarda como antes y Ajustes lo dice.
function vaultBackend() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    // Windows: DPAPI (ligado a tu cuenta de Windows); macOS: Llavero. getSelectedStorageBackend solo existe en Linux.
    if (process.platform === 'win32') return 'dpapi';
    if (process.platform === 'darwin') return 'keychain';
    const b = safeStorage.getSelectedStorageBackend ? safeStorage.getSelectedStorageBackend() : 'llavero';
    return b && b !== 'basic_text' && b !== 'unknown' ? b : null;
  } catch { return null; }
}
// ---- Almacén cifrado de los datos personales (sesión, cola, conteo de reproducciones, DJ, pedidos, servidores, letras) ----
// Una clave de datos aleatoria (AES-256) se guarda cifrada con el llavero del sistema; los datos van en un archivo
// cifrado con AES-256-GCM. La página lo usa de forma síncrona (sendSync) porque su almacenamiento es síncrono.
// kind: nombre del llavero si funciona; 'locked' si hay datos cifrados pero el llavero no los abre (no se guarda nada
// en claro); null si no hay llavero (la página guarda como antes y Ajustes lo dice).
const SEC = { map: null, key: null, kind: null, t: 0, dirty: false, tried: 0, busy: null, big: new Map(), bigDirty: new Set() };
const secFile = () => path.join(app.getPath('userData'), 'datos-cifrados.bin');
const secKeyFile = () => path.join(app.getPath('userData'), 'clave-datos.bin');
// Los índices grandes (biblioteca, hasta 2 MB; letras, hasta 6 MB) van cada uno en su propio archivo cifrado
// («datos-<clave>.bin», misma clave y mismo AES-GCM): antes iban con todo lo demás y cada cambio pequeño (cambiar de
// canción cambia 2 o 3 datos) volvía a cifrar y escribir varios MB.
const SEC_BIG = new Set(['libIdx', 'lyrIdx']);
const secBigFile = k => path.join(app.getPath('userData'), 'datos-' + k + '.bin');
const secSeal = (key, text) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); };
const secOpen = (key, b) => { const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); };
function writeAtomic(file, buf) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, buf, { mode: 0o600 }); fs.renameSync(tmp, file); }
// kind: 'locked' = hay datos pero el llavero no los abre ahora (no arrancó, está bloqueado): se reintenta cuando la
// página pregunta; 'lost' = la clave abre pero los datos no (dañados): solo «Empezar de cero» los recupera.
async function secInit() {
  SEC.tried = Date.now();
  const backend = vaultBackend();
  const hasData = fs.existsSync(secKeyFile());
  if (!backend) { SEC.kind = hasData ? 'locked' : null; return; }
  let key;
  try {
    if (hasData) {
      const r = await (safeStorage.decryptStringAsync ? safeStorage.decryptStringAsync(fs.readFileSync(secKeyFile())) : safeStorage.decryptString(fs.readFileSync(secKeyFile())));
      key = Buffer.from(typeof r === 'string' ? r : r.result, 'base64');
    } else {
      key = crypto.randomBytes(32);
      const enc = await (safeStorage.encryptStringAsync ? safeStorage.encryptStringAsync(key.toString('base64')) : safeStorage.encryptString(key.toString('base64')));
      writeAtomic(secKeyFile(), enc);
    }
    if (key.length !== 32) throw new Error('clave');
  } catch { SEC.kind = 'locked'; SEC.map = null; SEC.key = null; return; }
  try {
    let map = {};
    if (fs.existsSync(secFile())) map = JSON.parse(secOpen(key, fs.readFileSync(secFile())));
    Object.assign(SEC, { key, map, kind: backend, big: new Map(), bigDirty: new Set() });
    // Versiones anteriores: los índices grandes estaban en el archivo común; pasan a su propio archivo.
    for (const k of SEC_BIG) if (Object.prototype.hasOwnProperty.call(map, k)) { SEC.big.set(k, map[k]); SEC.bigDirty.add(k); delete map[k]; SEC.dirty = true; }
    if (SEC.dirty) SEC.t = setTimeout(secFlush, 400);
  } catch { SEC.kind = 'lost'; SEC.map = null; SEC.key = null; }
}
// «Empezar de cero» (lo pide la página, con tu confirmación): los archivos que ya no se abren se apartan con otro
// nombre (no se borran) y se crea un almacén nuevo.
ipcMain.handle('nanuq:secreset', async e => {
  if (!fromApp(e)) return null;
  const tag = '.ilegible-' + Date.now();
  for (const f of [secFile(), secKeyFile(), ...[...SEC_BIG].map(secBigFile)]) try { if (fs.existsSync(f)) fs.renameSync(f, f + tag); } catch { }
  Object.assign(SEC, { map: null, key: null, kind: null, dirty: false, big: new Map(), bigDirty: new Set() });
  await secInit();
  return SEC.kind;
});
function secFlush() {
  if (!SEC.dirty || !SEC.key) return;
  SEC.dirty = false; clearTimeout(SEC.t);
  // Primero los índices (al pasar de una versión anterior, el archivo común se escribe sin ellos solo después).
  for (const k of SEC.bigDirty) { const v = SEC.big.get(k); try { if (v == null) fs.rmSync(secBigFile(k), { force: true }); else writeAtomic(secBigFile(k), secSeal(SEC.key, v)); } catch { } }
  SEC.bigDirty.clear();
  try { writeAtomic(secFile(), secSeal(SEC.key, JSON.stringify(SEC.map))); } catch { }
}
app.on('before-quit', secFlush);
const SEC_KEY = /^[A-Za-z0-9._-]{1,120}$/;
ipcMain.on('nanuq:sec', (e, m = {}) => {
  if (!fromApp(e)) { e.returnValue = null; return; }
  const ok = SEC.map && SEC.kind && SEC.kind !== 'locked' && SEC.kind !== 'lost';
  if (m.op === 'kind') {
    // Arranque en frío: si el llavero todavía no estaba listo, se vuelve a intentar (como mucho cada 1.5 s).
    if (SEC.kind === 'locked' && !SEC.busy && Date.now() - SEC.tried > 1500) SEC.busy = secInit().catch(() => { }).finally(() => { SEC.busy = null; });
    e.returnValue = SEC.kind; return;
  }
  if (!ok || typeof m.k !== 'string' || !SEC_KEY.test(m.k)) { e.returnValue = null; return; }
  const big = SEC_BIG.has(m.k);
  if (m.op === 'get') {
    if (big && !SEC.big.has(m.k)) { let v = null; try { if (fs.existsSync(secBigFile(m.k))) v = secOpen(SEC.key, fs.readFileSync(secBigFile(m.k))); } catch { } SEC.big.set(m.k, v); } // dañado: como si no existiera (se vuelve a armar)
    e.returnValue = big ? SEC.big.get(m.k) : Object.prototype.hasOwnProperty.call(SEC.map, m.k) ? SEC.map[m.k] : null; return;
  }
  if (m.op === 'set' && typeof m.v === 'string' && m.v.length <= 8e6) { if (big) { SEC.big.set(m.k, m.v); SEC.bigDirty.add(m.k); } else SEC.map[m.k] = m.v; }
  else if (m.op === 'del') { if (big) { SEC.big.set(m.k, null); SEC.bigDirty.add(m.k); } else delete SEC.map[m.k]; }
  else { e.returnValue = false; return; }
  SEC.dirty = true; clearTimeout(SEC.t); SEC.t = setTimeout(secFlush, 400);
  e.returnValue = true;
});

// ---- Discord: «Escuchando Nanuq» en tu perfil (Rich Presence) ----
// Sin dependencias: Discord (o Vesktop/Equibop con arRPC) escucha en un socket local «discord-ipc-N» (en Windows, una
// tubería con nombre). Cada mensaje: [código int32 LE][largo int32 LE][JSON]. Solo la página de la app puede pedirlo, y
// solo se manda lo que se ve en el perfil: título, artista, álbum, tiempos y (si lo eliges) la portada por https.
// DISCORD_APP: id (público) de la aplicación «Nanuq» del portal de desarrolladores de Discord: su nombre es lo que se lee
// en «Escuchando …» y su imagen «nanuq» se usa cuando no hay portada. No hace falta ni se usa el «Client Secret».
// NANUQ_DISCORD_APP lo cambia (para pruebas).
const net = require('net');
const DISCORD_APP = String(process.env.NANUQ_DISCORD_APP || '1568648686983192758').replace(/\D/g, '');
const DC = { sock: null, ready: false, act: null, sent: 'x', busy: false, retryT: 0, sendT: 0, lastSend: 0, buf: Buffer.alloc(0), n: 0, minimal: false,
  // Lo último que se supo de Discord (Ajustes lo muestra): off | connecting | nodiscord | denied | ok | error | closed
  st: 'off', msg: '', user: '' };
const dcSet = (st, msg = '') => { DC.st = st; DC.msg = String(msg || '').slice(0, 200); };
function dcPaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => '\\\\?\\pipe\\discord-ipc-' + i);
  const roots = [...new Set([process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean))];
  const subs = ['', 'app/com.discordapp.Discord', 'app/com.discordapp.DiscordCanary', 'app/dev.vencord.Vesktop', 'app/org.equicord.equibop', '.flatpak/com.discordapp.Discord/xdg-run', '.flatpak/dev.vencord.Vesktop/xdg-run', '.flatpak/org.equicord.equibop/xdg-run', 'snap.discord'];
  const out = [];
  // Solo sockets tuyos: en /tmp cualquier usuario de la computadora podría crear un «discord-ipc-0» falso para ver qué
  // escuchas.
  const me = typeof process.getuid === 'function' ? process.getuid() : null;
  for (const r of roots) for (const s of subs) for (let i = 0; i < 10; i++) { const p = path.join(r, s, 'discord-ipc-' + i); try { const st = fs.statSync(p); if (st.isSocket() && (me == null || st.uid === me)) out.push(p); } catch { } }
  return [...new Set(out)];
}
function dcWrite(op, obj) { if (!DC.sock) return; const j = Buffer.from(JSON.stringify(obj)), h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(j.length, 4); try { DC.sock.write(Buffer.concat([h, j])); } catch { } }
function dcRetry() { clearTimeout(DC.retryT); if (DC.act) DC.retryT = setTimeout(dcConnect, 10000); } // Discord se abrió después (o se reinició): se busca cada 10 s
function dcConnect() {
  if (DC.sock || DC.busy || !DISCORD_APP) return;
  const paths = dcPaths(); let k = 0, denied = ''; DC.busy = true;
  if (DC.st !== 'ok') dcSet('connecting');
  const next = () => {
    // Ninguna tubería/socket respondió. Si alguna existía pero el sistema no dejó entrar (en Windows pasa si Discord se
    // abrió como administrador y Nanuq no), se dice; si no, Discord no está abierto.
    if (k >= paths.length) { DC.busy = false; if (denied) dcSet('denied', denied); else dcSet('nodiscord'); dcRetry(); return; }
    const s = net.createConnection(paths[k++]); let ok = false;
    s.once('connect', () => { ok = true; DC.busy = false; DC.sock = s; DC.ready = false; DC.buf = Buffer.alloc(0); dcWrite(0, { v: 1, client_id: DISCORD_APP }); });
    s.on('data', dcData);
    s.on('error', e => { if (!ok) { if (e && /EACCES|EPERM/.test(e.code || '')) denied = e.code; s.destroy(); next(); } });
    s.on('close', () => { if (!ok) return; if (DC.sock === s) { DC.sock = null; DC.ready = false; DC.sent = 'x'; if (DC.st === 'ok' || DC.st === 'connecting') dcSet('nodiscord'); dcRetry(); } });
  };
  next();
}
function dcData(d) {
  DC.buf = Buffer.concat([DC.buf, d]);
  if (DC.buf.length > 1e6) { DC.buf = Buffer.alloc(0); try { DC.sock.destroy(); } catch { } return; }
  while (DC.buf.length >= 8) {
    const op = DC.buf.readInt32LE(0), len = DC.buf.readInt32LE(4);
    if (len < 0 || len > 65536) { DC.buf = Buffer.alloc(0); try { DC.sock.destroy(); } catch { } return; }
    if (DC.buf.length < 8 + len) return;
    let m = null; try { m = jparse(DC.buf.subarray(8, 8 + len).toString('utf8')); } catch { }
    DC.buf = DC.buf.subarray(8 + len);
    if (op === 3) dcWrite(4, m || {}); // ping → pong
    else if (op === 2) { dcSet('closed', ptStr(m && (m.message || m.code), 200) || 'Discord cerró la conexión'); const s = DC.sock; DC.sock = null; DC.ready = false; DC.sent = 'x'; try { s.destroy(); } catch { } dcRetry(); return; } // Discord cerró (p. ej. id de aplicación no válido)
    else if (m && m.evt === 'READY') { DC.ready = true; DC.sent = 'x'; const usr = m.data && m.data.user; DC.user = ([usr && usr.global_name, usr && usr.username].find(x => typeof x === 'string') || '').slice(0, 40); dcSet('ok'); dcFlush(); }
    else if (m && m.evt === 'ERROR' && m.cmd === 'SET_ACTIVITY') {
      // El Discord oficial valida más que arRPC (Vesktop/Equibop): si rechaza la actividad, se reintenta una vez con lo
      // mínimo (sin tipo «Escuchando», sin portada, sin álbum). El motivo queda a la vista en Ajustes.
      const why = ptStr(m.data && (m.data.message || m.data.code), 200) || 'error';
      if (!DC.minimal) { DC.minimal = true; DC.sent = 'x'; DC.lastSend = 0; dcSet('error', why + ' (se reintenta con menos datos)'); dcFlush(); }
      else dcSet('error', why);
    }
    else if (m && m.cmd === 'SET_ACTIVITY' && m.evt == null) { if (DC.st !== 'ok') dcSet('ok'); } // Discord la aceptó
  }
}
// Discord admite pocas actualizaciones (≈ 5 cada 20 s): se manda la última, con 4 s entre una y otra.
function dcFlush() {
  if (!DC.ready) return;
  const key = JSON.stringify(DC.act); if (key === DC.sent) return;
  const wait = DC.lastSend + 4000 - Date.now();
  if (wait > 0) { clearTimeout(DC.sendT); DC.sendT = setTimeout(dcFlush, wait); return; }
  DC.lastSend = Date.now(); DC.sent = key;
  let act = DC.act;
  if (act && DC.minimal) { act = { details: act.details, ...(act.state ? { state: act.state } : {}), ...(act.timestamps ? { timestamps: act.timestamps } : {}), assets: { large_image: 'nanuq' } }; }
  dcWrite(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: act }, nonce: String(++DC.n) });
}
// Lo que manda la página, limpio y acotado.
function dcActivity(a) {
  if (!a || typeof a !== 'object') return null;
  const str = (v, n = 128) => ptStr(v, 100000).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const pad = v => v.length >= 2 ? v : (v + '  ').slice(0, 2); // Discord pide al menos 2 caracteres
  const title = pad(str(a.title) || 'Música'), artist = str(a.artist), album = str(a.album);
  const dur = Math.max(0, Math.min(+a.dur || 0, 24 * 3600)), pos = Math.max(0, Math.min(+a.pos || 0, dur || 24 * 3600));
  const act = { type: 2, details: title, ...(artist ? { state: pad(artist) } : {}), assets: { large_image: 'nanuq', large_text: pad(album || 'Nanuq') }, instance: false };
  const cover = str(a.cover, 300);
  if (/^https:\/\/[^\s"'<>]+$/i.test(cover)) act.assets.large_image = cover; // portada de tu servidor (https público; Discord la pide él)
  if (dur > 0) { const start = Date.now() - Math.round(pos * 1000); act.timestamps = { start, end: start + Math.round(dur * 1000) }; }
  return act;
}
ipcMain.handle('nanuq:discord', (e, a) => {
  if (!fromApp(e)) return false;
  if (a === 'status') return { app: !!DISCORD_APP, connected: !!DC.ready, st: DC.st, msg: DC.msg, user: DC.user, minimal: DC.minimal, os: process.platform };
  DC.act = dcActivity(a);
  if (DC.act && !DC.sock) dcConnect();
  dcFlush();
  return true;
});
app.on('before-quit', () => { if (DC.ready) { DC.act = null; dcWrite(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: 'fin' }); } });

// ---- Fiesta (Nanuq watch party): los teléfonos de tu red mandan canciones y esta computadora las pone ----
// Mientras la sala está abierta (y solo entonces), Nanuq escucha en la red local:
//   - TCP 47864: WebSocket propio (sin dependencias, RFC 6455) en /fiesta. Para entrar hace falta el código de 6 dígitos
//     que se ve en pantalla; con errores repetidos se bloquea esa dirección un minuto y, si siguen, el código cambia.
//   - UDP 47865: responde a «Who is NanuqParty?» para que los teléfonos encuentren la sala sin escribir la dirección.
// Las canciones llegan por partes a una carpeta temporal privada (0700). Se borran al terminar de sonar, al quitarlas,
// si llevan más de 2 h en la lista, si dejaron de llegar a medias y al cerrar la sala o la app. Todo lo que llega se
// trata como no confiable: textos acotados, topes de tamaño y solo archivos que de verdad son audio.
// La página (el anfitrión) reproduce desde http://127.0.0.1:<puerto>/fiesta/<token>/<id> y manda el karaoke cada segundo.
const PARTY_PORT = +process.env.NANUQ_PARTY_PORT || 47864, PARTY_DISC = +process.env.NANUQ_PARTY_DISC || 47865, PARTY_ASK = 'Who is NanuqParty?';
const PT_MAX = { guests: 12, conns: 24, file: 80e6, disk: 800e6, list: 60, perGuest: 10, frame: 1 << 20, text: 450e3, lyrics: 200e3, cover: 150e3 };
const PT = { srv: null, udp: null, port: 0, code: '', token: '', rid: '', name: '', dir: '', conns: new Set(), keys: new Map(), list: [], now: null, fails: new Map(), failAll: 0, lockUntil: 0, udpN: 0, udpAt: 0, gcT: 0, stT: 0 };
// JSON que llega de afuera (teléfonos de la fiesta, Discord): sin claves «toString»/«valueOf»/«__proto__». Un objeto como
// {"toString": 1} hacía fallar cualquier String(…) y, en la fiesta, un mensaje así (incluso antes de dar el código) cerraba
// la app entera.
const jparse = t => JSON.parse(t, (k, v) => (k === 'toString' || k === 'valueOf' || k === '__proto__') ? undefined : v);
const ptStr = (v, n) => (typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const ptIp = a => String(a || '').replace(/^::ffff:/, '');
// ¿Viene de tu red local? La sala escucha en todas las interfaces (para que los teléfonos la encuentren), pero solo
// atiende a direcciones privadas: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 (CGNAT/Tailscale), ::1,
// fc00::/7 y fe80::/10. Una IPv6 pública o Yggdrasil (200::/7, una red global) no entran aunque el firewall lo permita.
function ptLocal(a) {
  const ip = ptIp(a).toLowerCase().replace(/%.*$/, ''), v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (v4) { const x = +v4[1], y = +v4[2]; return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127); }
  if (ip === '::1') return true;
  const h = parseInt(ip.split(':')[0] || 'x', 16);
  return ip.includes(':') && Number.isFinite(h) && ((h & 0xfe00) === 0xfc00 || (h & 0xffc0) === 0xfe80);
}
const ptOpenNow = () => !!PT.srv;
function ptEmit(ev) { if (win && !win.isDestroyed()) win.webContents.send('nanuq:party-ev', ev); }
// Restos de una sala anterior (la app se cerró de golpe): se borran al arrancar.
// Dónde se guardan las canciones de la sala: EN DISCO. En Linux, la caché del usuario (~/.cache/nanuq; en el Flatpak,
// ~/.var/app/com.nanuq.app/cache/nanuq). Antes era la carpeta temporal, que en el Flatpak (y en /tmp de muchas
// distribuciones) es memoria RAM: hasta 800 MB de canciones ocupaban RAM. En Windows y macOS la temporal ya es disco.
function ptBase() {
  if (process.platform !== 'linux') return app.getPath('temp');
  const d = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'nanuq');
  try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; } catch { return app.getPath('temp'); }
}
function ptCleanTemp() {
  const me = typeof process.getuid === 'function' ? process.getuid() : null;
  for (const tmp of new Set([app.getPath('temp'), ptBase()]))
  try { for (const n of fs.readdirSync(tmp)) if (n.startsWith('nanuq-fiesta-')) { const f = path.join(tmp, n); try { const st = fs.lstatSync(f); if (st.isDirectory() && (me == null || st.uid === me)) fs.rmSync(f, { recursive: true, force: true }); } catch { } } } catch { }
}
// ---- Canciones cifradas en el disco ----
// En disco, otra app de tu usuario podría cambiar un archivo mientras espera su turno (p. ej. meter uno armado para atacar
// el decodificador de audio). Por eso cada canción se guarda cifrada y autenticada (AES-256-GCM) con una clave al azar
// que solo vive en la memoria de esta sala: en bloques de 64 KB, cada uno con su etiqueta, y el número de bloque dentro
// del nonce (no se pueden cambiar de lugar ni mezclar con los de otra canción). Al reproducir se descifra y se comprueba
// bloque por bloque; si un solo byte cambió, no se entrega nada de ese bloque y la canción se quita de la lista.
// También impide leerlas: al cerrar la sala la clave se pierde y lo que quedara en el disco es ilegible.
const PT_CH = 64 * 1024;
const ptNonce = (e, k) => { const n = Buffer.alloc(12); e.nonce.copy(n, 0); n.writeUInt32BE(k, 8); return n; };
function ptSeal(e, plain) {
  const c = crypto.createCipheriv('aes-256-gcm', PT.fkey, ptNonce(e, e.k++));
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}
// Tamaño que debe tener el archivo cifrado (cada bloque lleva 16 bytes de etiqueta).
const ptEncSize = e => e.size + Math.ceil(e.size / PT_CH) * 16;
async function* ptOpenRange(e, start, end) {
  const fh = await fs.promises.open(e.file, 'r');
  try {
    for (let k = Math.floor(start / PT_CH); k <= Math.floor(end / PT_CH); k++) {
      const n = Math.min(PT_CH, e.size - k * PT_CH), buf = Buffer.alloc(n + 16);
      const { bytesRead } = await fh.read(buf, 0, buf.length, k * (PT_CH + 16));
      if (bytesRead !== buf.length) throw new Error('incompleto');
      const d = crypto.createDecipheriv('aes-256-gcm', e.fkey, ptNonce(e, k));
      d.setAuthTag(buf.subarray(n));
      const plain = Buffer.concat([d.update(buf.subarray(0, n)), d.final()]); // final() falla si el bloque se alteró
      const a = k * PT_CH;
      yield plain.subarray(Math.max(0, start - a), Math.min(n, end - a + 1));
    }
  } finally { await fh.close(); }
}
// ¿Es audio? Por los primeros bytes (no por lo que diga el teléfono). Devuelve el tipo con el que se sirve.
function ptSniff(h) {
  if (!h || h.length < 12) return '';
  const s = (a, b) => h.subarray(a, b).toString('latin1');
  if (s(0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0 && (h[1] & 0x06) !== 0)) return 'audio/mpeg';
  if (s(0, 4) === 'fLaC') return 'audio/flac';
  if (s(0, 4) === 'OggS') return 'audio/ogg';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return 'audio/wav';
  if (s(4, 8) === 'ftyp') return 'audio/mp4';
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return 'audio/webm';
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) return 'audio/aac'; // ADTS
  return '';
}
// Carátula que manda el teléfono (data: en base64, ≤ 150 KB): solo si sus bytes son de verdad JPEG, PNG o WebP.
function ptCover(v) {
  if (typeof v !== 'string' || !v || v.length > PT_MAX.cover) return null;
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v); if (!m) return null;
  const b = Buffer.from(m[1], 'base64'); if (b.length < 100) return null;
  const mime = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
    : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
    : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : '';
  return mime ? { b, mime } : null;
}
const ptPublic = e => ({ id: e.id, title: e.title, artist: e.artist, album: e.album, duration: e.duration, by: e.by, byName: e.byName, state: e.state, mb: Math.round(e.bytes / 1e5) / 10, hasCover: !!e.cover });
// Invitados en la sala: los conectados y los «ausentes» (su teléfono se durmió o perdió el Wi-Fi sin pulsar «Salir»): siguen
// en la fiesta (y en el iglú) y vuelven a entrar solos con su llave. Solo «Salir» los saca; un ausente se olvida a las 2 h.
const PT_AWAY = 2 * 3600e3;
const ptGuests = () => [...PT.keys.values()].filter(g => g.conn || g.away).map(g => ({ id: g.id, name: g.name, theme: g.theme, away: !g.conn }));
function ptAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (!a.internal && a.family === 'IPv4') out.push(a.address);
  return out.slice(0, 6);
}
function ptStatus() {
  if (!ptOpenNow()) return { open: false };
  return { open: true, code: PT.code, port: PT.port, name: PT.name, addrs: ptAddrs(), guests: ptGuests(), now: PT.now,
    list: PT.list.map(e => ({ ...ptPublic(e), url: e.state === 'ready' ? `${origin}/fiesta/${PT.token}/${e.id}` : '', cover: e.cover ? `${origin}/fiesta/${PT.token}/${e.id}/c` : '', hasLyrics: !!e.lyrics })) };
}
// Lo que cambió se cuenta a todos (invitados y la página), agrupado en 150 ms.
function ptState() { clearTimeout(PT.stT); PT.stT = setTimeout(ptStateNow, 150); }
function ptStateNow() {
  if (!ptOpenNow()) return;
  const st = { t: 'state', room: PT.name, guests: ptGuests(), list: PT.list.map(ptPublic), now: PT.now };
  for (const c of PT.conns) if (c.authed) ptSend(c, st);
  ptEmit({ type: 'state', ...ptStatus() });
}
function ptKill(e, why) {
  const i = PT.list.indexOf(e); if (i >= 0) PT.list.splice(i, 1);
  try { e.ws && e.ws.destroy(); } catch { }
  fs.rm(e.file, { force: true }, () => { });
  if (PT.now && PT.now.id === e.id) PT.now = null;
  if (why && e.conn && PT.conns.has(e.conn)) ptSend(e.conn, { t: 'addErr', id: e.id, why });
  ptState();
}
// ---- WebSocket mínimo ----
function ptFrame(c, op, data) {
  if (c.sock.destroyed) return;
  const n = data.length, h = Buffer.alloc(n < 126 ? 2 : n < 65536 ? 4 : 10);
  h[0] = 0x80 | op;
  if (n < 126) h[1] = n; else if (n < 65536) { h[1] = 126; h.writeUInt16BE(n, 2); } else { h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(n, 6); }
  try { c.sock.write(Buffer.concat([h, data])); } catch { }
}
const ptSend = (c, o) => ptFrame(c, 1, Buffer.from(JSON.stringify(o)));
function ptDrop(c, why) {
  if (!PT.conns.has(c)) return;
  if (why) ptSend(c, { t: 'bye', why });
  ptFrame(c, 8, Buffer.alloc(0));
  try { c.sock.end(); } catch { }
  setTimeout(() => { try { c.sock.destroy(); } catch { } }, 1000);
  ptGone(c);
}
function ptGone(c) {
  if (!PT.conns.delete(c)) return;
  clearTimeout(c.helloT);
  const g = c.guest;
  if (g && g.conn === c) {
    g.conn = null; g.left = Date.now(); g.away = !c.bye; // sin «Salir»: se quedó dormido o sin red, sigue en la fiesta
    for (const e of PT.list.slice()) if (e.state === 'uploading' && e.conn === c) ptKill(e); // la que venía a medias
    if (c.bye) ptEmit({ type: 'leave', guest: { id: g.id, name: g.name, theme: g.theme } });
    ptState();
  }
}
function ptUpgrade(req, sock, head) {
  let p = ''; try { p = new URL(req.url, 'http://x').pathname; } catch { }
  const key = String(req.headers['sec-websocket-key'] || ''), ip = ptIp(sock.remoteAddress);
  // Solo tu red local, y como mucho 4 conexiones sin presentarse por dirección (si no, alguien podía ocupar los 24 lugares
  // con conexiones mudas y nadie más entraba).
  if (!ptLocal(ip) || [...PT.conns].filter(x => !x.authed && x.ip === ip).length >= 4) { try { sock.destroy(); } catch { } return; }
  if (!ptOpenNow() || p !== '/fiesta' || !/websocket/i.test(String(req.headers.upgrade || '')) || req.headers['sec-websocket-version'] !== '13' || !/^[A-Za-z0-9+/]{22}==$/.test(key) || PT.conns.size >= PT_MAX.conns) {
    try { sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch { } return;
  }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  const c = { sock, buf: Buffer.alloc(0), ip: ptIp(sock.remoteAddress), authed: false, guest: null, frag: null, seen: Date.now() };
  PT.conns.add(c);
  sock.setNoDelay(true); sock.setTimeout(0);
  c.helloT = setTimeout(() => { if (!c.authed) ptDrop(c, 'Tiempo agotado'); }, 10000);
  sock.on('data', d => ptData(c, d));
  sock.on('error', () => { });
  sock.on('close', () => ptGone(c));
  if (head && head.length) ptData(c, head);
}
function ptData(c, d) {
  c.seen = Date.now();
  c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
  while (c.buf.length >= 2 && PT.conns.has(c)) {
    const b0 = c.buf[0], b1 = c.buf[1], fin = !!(b0 & 0x80), op = b0 & 15;
    if ((b0 & 0x70) || !(b1 & 0x80)) return ptDrop(c); // sin extensiones; del cliente siempre enmascarado
    let len = b1 & 127, o = 2;
    if (len === 126) { if (c.buf.length < 4) break; len = c.buf.readUInt16BE(2); o = 4; }
    else if (len === 127) { if (c.buf.length < 10) break; if (c.buf.readUInt32BE(2)) return ptDrop(c); len = c.buf.readUInt32BE(6); o = 10; }
    if (len > PT_MAX.frame) return ptDrop(c);
    if (c.buf.length < o + 4 + len) break;
    const mask = c.buf.subarray(o, o + 4), data = Buffer.from(c.buf.subarray(o + 4, o + 4 + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    c.buf = c.buf.subarray(o + 4 + len);
    if (op >= 8) {
      if (!fin || len > 125) return ptDrop(c);
      if (op === 8) return ptDrop(c);
      if (op === 9) ptFrame(c, 10, data);
      continue;
    }
    if (op === 0) {
      if (!c.frag) return ptDrop(c);
      c.frag.parts.push(data); c.frag.len += len;
      if (c.frag.len > PT_MAX.frame) return ptDrop(c);
      if (fin) { const f = c.frag; c.frag = null; try { ptMsg(c, f.op, Buffer.concat(f.parts)); } catch { return ptDrop(c); } }
      continue;
    }
    if ((op !== 1 && op !== 2) || c.frag) return ptDrop(c);
    if (!fin) { c.frag = { op, parts: [data], len }; continue; }
    try { ptMsg(c, op, data); } catch { return ptDrop(c); } // un mensaje que hace fallar algo: fuera esa conexión, la app sigue
  }
  if (c.buf.length > PT_MAX.frame + 16) ptDrop(c);
}
function ptMsg(c, op, data) {
  if (op === 2) return c.authed ? ptChunk(c, data) : ptDrop(c);
  if (data.length > (c.authed ? PT_MAX.text : 4096)) return ptDrop(c);
  let m; try { m = jparse(data.toString('utf8')); } catch { return ptDrop(c); }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ptDrop(c);
  if (!c.authed) return ptHello(c, m);
  if (m.t === 'add') ptAdd(c, m);
  else if (m.t === 'end') ptEnd(c, m);
  // Los invitados no quitan canciones de la lista (eso lo decide el anfitrión): solo cancelan la suya que no terminó de llegar.
  else if (m.t === 'remove') { const e = PT.list.find(x => x.id === ptStr(m.id, 8) && x.by === c.guest.id && (x.state === 'uploading' || x.state === 'closing')); if (e) ptKill(e); }
  else if (m.t === 'leave') { c.bye = true; PT.keys.delete(c.guest.key); c.guest.away = false; ptDrop(c); } // «Salir» en el teléfono
  // 'ping': el teléfono avisa que sigue ahí (c.seen ya se actualizó al recibirlo)
}
function ptNewCode() {
  PT.code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  ptEmit({ type: 'code', code: PT.code }); ptState();
}
function ptHello(c, m) {
  if (m.t !== 'hello') return ptDrop(c);
  const now = Date.now(), f = PT.fails.get(c.ip) || { n: 0, at: now };
  // Muchos códigos equivocados (desde varias direcciones: con IPv6 cambiar de dirección es fácil): el código cambia y por
  // un minuto nadie puede probar códigos (los que ya entraron vuelven con su llave).
  if (now < PT.lockUntil && !(typeof m.key === 'string' && PT.keys.has(m.key))) return ptDrop(c, 'Demasiados intentos. Espera un minuto.');
  if (now - f.at > 60000) { f.n = 0; f.at = now; }
  if (f.n >= 5) return ptDrop(c, 'Demasiados intentos. Espera un minuto.');
  let g = typeof m.key === 'string' && m.key.length < 64 ? PT.keys.get(m.key) || null : null;
  // Vuelve con una llave de una fiesta que ya no existe (la cerraron y abrieron otra) y sin código: se le avisa que terminó.
  if (!g && typeof m.key === 'string' && m.key && !m.code) return ptDrop(c, 'La fiesta terminó.');
  if (!g) {
    const a = Buffer.from(typeof m.code === 'string' ? m.code : ''), b = Buffer.from(PT.code);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      f.n++; PT.fails.set(c.ip, f);
      while (PT.fails.size > 500) PT.fails.delete(PT.fails.keys().next().value);
      if (++PT.failAll >= 30) { PT.failAll = 0; PT.lockUntil = now + 60000; ptNewCode(); } // alguien prueba códigos: el de ahora deja de servir y se cierra un minuto
      return ptDrop(c, 'Código incorrecto');
    }
    if (ptGuests().length >= PT_MAX.guests) return ptDrop(c, 'La sala está llena');
    const key = crypto.randomBytes(18).toString('base64url');
    g = { id: 'g' + crypto.randomBytes(4).toString('hex'), key, name: ptStr(m.name, 24) || 'Invitado', theme: typeof m.theme === 'string' && /^[a-z]{2,12}$/.test(m.theme) ? m.theme : 'navy', conn: null, left: 0 };
    PT.keys.set(key, g);
  } else if (g.conn) ptDrop(g.conn); // volvió a entrar desde el mismo teléfono: la conexión vieja sobra
  const back = !!g.left || !!g.conn;
  c.authed = true; c.guest = g; g.conn = c; g.left = 0; g.away = false; clearTimeout(c.helloT);
  ptSend(c, { t: 'welcome', you: { id: g.id, name: g.name }, key: g.key, room: PT.name, chunk: 256 * 1024 });
  if (!back) ptEmit({ type: 'join', guest: { id: g.id, name: g.name, theme: g.theme } }); // volver tras dormirse no es «llegó»
  ptState();
}
function ptAdd(c, m) {
  const g = c.guest, s = m.song && typeof m.song === 'object' ? m.song : {}, ref = ptStr(m.ref, 40);
  const err = why => ptSend(c, { t: 'addErr', ref, why });
  if (PT.list.length >= PT_MAX.list) return err('La lista de la fiesta está llena.');
  if (PT.list.filter(e => e.by === g.id).length >= PT_MAX.perGuest) return err('Ya tienes ' + PT_MAX.perGuest + ' canciones en la lista: espera a que suenen.');
  if (PT.list.some(e => e.state === 'uploading' && e.by === g.id)) return err('Espera a que termine de llegar la anterior.');
  try { const fsx = fs.statfsSync(PT.dir); if (fsx.bavail * fsx.bsize < 1e9) return err('La computadora de la fiesta ya no tiene espacio para más canciones: espera a que suenen.'); } catch { }
  const id = crypto.randomBytes(4).toString('hex'), file = path.join(PT.dir, id + '.audio');
  const e = { id, by: g.id, byName: g.name, conn: c, title: ptStr(s.title, 200) || 'Sin título', artist: ptStr(s.artist, 200), album: ptStr(s.album, 200),
    duration: Math.max(0, Math.min(+s.duration || 0, 6 * 3600)), lyrics: typeof s.lyrics === 'string' ? s.lyrics.slice(0, PT_MAX.lyrics) : '', cover: ptCover(s.cover),
    state: 'uploading', bytes: 0, head: Buffer.alloc(0), mime: '', file, at: Date.now(), last: Date.now(),
    fkey: PT.fkey, nonce: crypto.randomBytes(8), k: 0, pend: Buffer.alloc(0), size: 0 };
  try { e.ws = fs.createWriteStream(file, { mode: 0o600 }); } catch { return err('No se pudo guardar la canción.'); }
  e.ws.on('error', () => ptKill(e, 'No se pudo guardar la canción.'));
  PT.list.push(e);
  ptSend(c, { t: 'addOk', ref, id });
  ptState();
}
function ptChunk(c, data) {
  if (data.length < 9) return;
  const id = data.subarray(0, 8).toString('latin1'), e = PT.list.find(x => x.id === id && x.conn === c && x.state === 'uploading');
  if (!e) return; // cancelada o ya quitada
  const body = data.subarray(8);
  e.bytes += body.length; e.last = Date.now();
  const disk = PT.list.reduce((a, x) => a + x.bytes, 0);
  if (e.bytes > PT_MAX.file) return ptKill(e, 'La canción es demasiado grande (máximo ' + PT_MAX.file / 1e6 + ' MB).');
  if (disk > PT_MAX.disk) return ptKill(e, 'La computadora de la fiesta ya no tiene espacio para más canciones: espera a que suenen.');
  if (e.head.length < 16) e.head = Buffer.concat([e.head, body.subarray(0, 16 - e.head.length)]);
  // El disco va más lento que la red: se frena al teléfono hasta que se escriba. Se suelta también si el archivo se cierra
  // (terminó, se quitó): si no, la conexión quedaba frenada para siempre y no se enteraba de nada más.
  e.pend = e.pend.length ? Buffer.concat([e.pend, body]) : Buffer.from(body);
  let ok = true;
  while (e.pend.length >= PT_CH) { ok = e.ws.write(ptSeal(e, e.pend.subarray(0, PT_CH))) && ok; e.pend = e.pend.subarray(PT_CH); }
  if (!ok && !c.held) { c.held = true; c.sock.pause(); const go = () => { if (!c.held) return; c.held = false; try { c.sock.resume(); } catch { } }; e.ws.once('drain', go); e.ws.once('close', go); }
  if (!e.shownAt || Date.now() - e.shownAt > 1000) { e.shownAt = Date.now(); ptState(); }
}
function ptEnd(c, m) {
  const e = PT.list.find(x => x.id === ptStr(m.id, 8) && x.conn === c && x.state === 'uploading'); if (!e) return;
  e.state = 'closing';
  if (e.pend.length) e.ws.write(ptSeal(e, e.pend));
  e.pend = Buffer.alloc(0); e.size = e.bytes;
  e.ws.end(() => {
    if (!PT.list.includes(e)) return;
    const mime = ptSniff(e.head);
    if (!mime || e.bytes < 2000) return ptKill(e, 'Eso no parece una canción (el archivo no es audio).');
    e.mime = mime; e.state = 'ready'; e.ws = null; e.at = Date.now();
    if (PT.conns.has(c)) ptSend(c, { t: 'ready', id: e.id });
    ptEmit({ type: 'ready', id: e.id });
    ptState();
  });
}
// La página reproduce las canciones desde aquí (127.0.0.1, con el token de la sala), con saltos (Range).
// /fiesta/<token>/<id>/c es su carátula (si el teléfono la mandó).
function ptServe(req, res, p) {
  const [, , tok, id, kind, ...rest] = p.split('/');
  if (kind !== undefined && (kind !== 'c' || rest.length)) { res.writeHead(404).end(); return; }
  if (kind === 'c') {
    const x = ptOpenNow() && tok === PT.token ? PT.list.find(y => y.id === id && y.cover) : null;
    if (!x) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': x.cover.mime, 'Content-Length': x.cover.b.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : x.cover.b); return;
  }
  const e = ptOpenNow() && tok === PT.token ? PT.list.find(x => x.id === id && x.state === 'ready') : null;
  if (!e) { res.writeHead(404).end(); return; }
  fs.stat(e.file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end(); return; }
    if (st.size !== ptEncSize(e)) { res.writeHead(404).end(); ptKill(e); return; } // alguien cambió el archivo
    const size = e.size, m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    let start = 0, end = size - 1, code = 200;
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], size - 1); } else start = Math.max(0, size - +m[2]);
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end(); return; }
      code = 206;
    }
    res.writeHead(code, { 'Content-Type': e.mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(code === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    if (req.method === 'HEAD') { res.end(); return; }
    Readable.from(ptOpenRange(e, start, end)).on('error', () => { res.destroy(); if (PT.list.includes(e)) ptKill(e); }).pipe(res);
  });
}
// Carátulas para los teléfonos (su lista de la fiesta): GET /fiesta/c/<id>?k=<llave del invitado>. Solo con una llave de
// esta sala (la que recibe cada invitado al entrar) y solo la miniatura que ya se validó al llegar (ptCover).
function ptGuestCover(q, r) {
  let u; try { u = new URL(q.url, 'http://x'); } catch { r.writeHead(400).end(); return; }
  const m = /^\/fiesta\/c\/([0-9a-f]{8})$/.exec(u.pathname), k = u.searchParams.get('k') || '';
  const e = q.method === 'GET' && m && ptLocal(q.socket.remoteAddress) && k.length < 64 && PT.keys.has(k) ? PT.list.find(x => x.id === m[1] && x.cover) : null;
  if (!e) { r.writeHead(404, { 'Content-Type': 'text/plain' }).end('Nanuq'); return; }
  r.writeHead(200, { 'Content-Type': e.cover.mime, 'Content-Length': e.cover.b.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  r.end(e.cover.b);
}
// Limpieza cada 30 s: lo que lleva mucho en la lista, lo que dejó de llegar, invitados que se fueron y conexiones mudas.
function ptGc() {
  const now = Date.now();
  for (const e of PT.list.slice()) {
    if (e.state === 'ready' && (!PT.now || PT.now.id !== e.id) && now - e.at > 2 * 3600e3) ptKill(e);
    else if ((e.state === 'uploading' || e.state === 'closing') && now - e.last > 3 * 60e3) ptKill(e, 'La canción dejó de llegar.');
  }
  for (const [k, g] of PT.keys) if (!g.conn && g.left && now - g.left > PT_AWAY) { PT.keys.delete(k); if (g.away) { g.away = false; ptState(); } }
  for (const [ip, f] of PT.fails) if (now - f.at > 120000) PT.fails.delete(ip);
  for (const c of [...PT.conns]) { if (now - c.seen > 75000) ptDrop(c); else ptFrame(c, 9, Buffer.alloc(0)); }
}
function ptListen(srv) {
  const tries = [[PARTY_PORT, '::'], [PARTY_PORT, '0.0.0.0'], [0, '::'], [0, '0.0.0.0']];
  return new Promise((resolve, reject) => {
    const next = () => {
      const t = tries.shift(); if (!t) { reject(new Error('No se pudo abrir el puerto de la fiesta')); return; }
      const onErr = () => { srv.removeListener('listening', onOk); next(); };
      const onOk = () => { srv.removeListener('error', onErr); resolve(srv.address().port); };
      srv.once('error', onErr); srv.once('listening', onOk);
      srv.listen(t[0], t[1]);
    };
    next();
  });
}
async function ptOpen(name) {
  if (ptOpenNow()) return ptStatus();
  ptCleanTemp();
  PT.dir = fs.mkdtempSync(path.join(ptBase(), 'nanuq-fiesta-')); PT.fkey = crypto.randomBytes(32); try { fs.chmodSync(PT.dir, 0o700); } catch { }
  PT.code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); PT.token = crypto.randomBytes(16).toString('hex'); PT.rid = crypto.randomBytes(6).toString('hex');
  PT.name = ptStr(name, 40) || 'Fiesta Nanuq'; PT.list = []; PT.now = null; PT.keys.clear(); PT.fails.clear(); PT.failAll = 0; PT.lockUntil = 0;
  const srv = http.createServer(ptGuestCover);
  srv.headersTimeout = 10000; srv.requestTimeout = 15000; srv.keepAliveTimeout = 2000; srv.maxConnections = 64;
  srv.on('upgrade', ptUpgrade);
  srv.on('clientError', (e, s) => { try { s.destroy(); } catch { } });
  try { PT.port = await ptListen(srv); } catch (e) { fs.rmSync(PT.dir, { recursive: true, force: true }); return { open: false, error: e.message }; }
  PT.srv = srv;
  try {
    const u = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    u.on('error', () => { try { u.close(); } catch { } if (PT.udp === u) PT.udp = null; }); // sin búsqueda automática: queda la dirección a mano
    u.on('message', (msg, r) => {
      // Solo a la red local y como mucho 30 respuestas por segundo (no sirve para rebotar tráfico contra nadie).
      const now = Date.now(); if (now - PT.udpAt > 1000) { PT.udpAt = now; PT.udpN = 0; }
      if (!(msg.length < 64 && msg.toString('utf8') === PARTY_ASK && PT.srv && ptLocal(r.address) && ++PT.udpN <= 30)) return;
      u.send(Buffer.from(JSON.stringify({ Name: PT.name, Port: PT.port, Id: PT.rid, V: 1 })), r.port, r.address, () => { });
    });
    u.bind(PARTY_DISC); PT.udp = u;
  } catch { PT.udp = null; }
  PT.gcT = setInterval(ptGc, 30000);
  ptState();
  return ptStatus();
}
function ptClose() {
  if (!ptOpenNow()) return;
  // Se avisa a cada teléfono y se cortan YA todas las conexiones (también las de un teléfono bloqueado que ya no
  // contesta: antes quedaban medio abiertas hasta que el sistema las soltara).
  const socks = [...PT.conns].map(c => c.sock);
  for (const c of [...PT.conns]) ptDrop(c, 'El anfitrión cerró la fiesta');
  setTimeout(() => socks.forEach(s => { try { s.destroy(); } catch { } }), 250);
  try { PT.srv.close(); PT.srv.closeAllConnections && PT.srv.closeAllConnections(); } catch { } PT.srv = null;
  try { PT.udp && PT.udp.close(); } catch { } PT.udp = null;
  clearInterval(PT.gcT); clearTimeout(PT.stT);
  for (const e of PT.list.slice()) { try { e.ws && e.ws.destroy(); } catch { } }
  PT.list = []; PT.now = null; PT.keys.clear(); PT.fkey = null;
  try { fs.rmSync(PT.dir, { recursive: true, force: true }); } catch { }
  ptEmit({ type: 'state', open: false });
}
app.on('before-quit', ptClose);
ipcMain.handle('nanuq:party', async (e, o = {}) => {
  if (!fromApp(e) || !o || typeof o !== 'object') return null;
  switch (o.op) {
    case 'open': return ptOpen(o.name);
    case 'close': ptClose(); return { open: false };
    case 'status': return ptStatus();
    case 'newcode': if (ptOpenNow()) ptNewCode(); return ptStatus();
    case 'lyrics': { const x = PT.list.find(y => y.id === ptStr(o.id, 8)); return x ? x.lyrics : ''; }
    // El anfitrión eligió una canción de «A continuación»: la que suena y todas las que iban antes se saltan (fuera de la
    // lista y del disco) y esa queda primera.
    case 'jump': {
      const i = PT.list.findIndex(y => y.id === ptStr(o.id, 8)); if (i < 0) return false;
      const drop = PT.list.slice(0, i); const cur = PT.now && PT.list.find(y => y.id === PT.now.id && !drop.includes(y) && y.id !== ptStr(o.id, 8)); if (cur) drop.push(cur);
      for (const x of drop) ptKill(x, x.state === 'uploading' || x.state === 'closing' ? 'El anfitrión la saltó.' : '');
      return true;
    }
    // Nuevo orden (arrastrar en «A continuación»): ids en el orden elegido. La que suena va primero; lo que llegó mientras
    // tanto, al final.
    case 'order': {
      if (!Array.isArray(o.ids) || o.ids.length > PT_MAX.list) return false;
      const ids = o.ids.map(x => ptStr(x, 8)), by = new Map(PT.list.map(y => [y.id, y])), seen = new Set(), next = [];
      if (PT.now && by.has(PT.now.id)) { next.push(by.get(PT.now.id)); seen.add(PT.now.id); }
      for (const id of ids) if (by.has(id) && !seen.has(id)) { next.push(by.get(id)); seen.add(id); }
      for (const y of PT.list) if (!seen.has(y.id)) next.push(y);
      PT.list = next; ptState(); return true;
    }
    case 'played': case 'remove': { const x = PT.list.find(y => y.id === ptStr(o.id, 8)); if (x) ptKill(x); return true; } // ya sonó (o la quitó el anfitrión): fuera del disco
    case 'now': { // qué suena ahora en la computadora (o nada)
      const x = o.id ? PT.list.find(y => y.id === ptStr(o.id, 8)) : null;
      const n = x ? { id: x.id, playing: !!o.playing } : null;
      if (JSON.stringify(n) !== JSON.stringify(PT.now)) { PT.now = n; ptState(); }
      return true;
    }
    case 'tick': { // karaoke: cada segundo, el tiempo de la canción y la línea que toca
      if (!ptOpenNow() || !PT.now) return false;
      const t = { t: 'tick', id: String(o.id || '').slice(0, 8), pos: Math.max(0, +o.pos || 0), dur: Math.max(0, +o.dur || 0), playing: !!o.playing, line: ptStr(o.line, 300), next: ptStr(o.next, 300), at: Date.now() };
      for (const c of PT.conns) if (c.authed) ptSend(c, t);
      return true;
    }
  }
  return null;
});

// Tamaño y posición de la ventana entre sesiones.
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
// Solo números razonables: el archivo vive en tu carpeta de datos y podría venir alterado.
function loadState() {
  let o; try { o = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; }
  const n = (v, a, b) => Number.isInteger(v) && v >= a && v <= b ? v : undefined;
  return o && typeof o === 'object' ? { width: n(o.width, 360, 20000), height: n(o.height, 520, 20000), x: n(o.x, -20000, 20000), y: n(o.y, -20000, 20000), maximized: o.maximized === true } : {};
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  const s = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  try { fs.writeFileSync(stateFile(), JSON.stringify(s)); } catch { }
}

async function start() {
  // Caché HTTP de versiones anteriores: ya no se usa (disable-http-cache) y ocupa espacio.
  try { fs.rmSync(path.join(app.getPath('userData'), 'Cache'), { recursive: true, force: true }); } catch { }
  await secInit();
  ptCleanTemp(); // carpetas de una fiesta anterior que no se cerró bien
  const port = await serve();
  origin = `http://127.0.0.1:${port}`;
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1280, height: st.height || 820, x: st.x, y: st.y,
    minWidth: 360, minHeight: 520,
    title: 'Nanuq',
    icon: path.join(WWW, 'icons', 'icon-512.png'),
    backgroundColor: '#081120',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // con la ventana minimizada la música sigue y pasa de canción a tiempo
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false
    }
  });
  win.removeMenu();
  // Permisos: Electron, por omisión, concede todo lo que pida la página (micrófono, cámara, ubicación…).
  // Nanuq solo necesita notificaciones, pantalla completa y copiar al portapapeles.
  const OK_PERMS = new Set(['notifications', 'fullscreen', 'clipboard-sanitized-write']);
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((wc, perm, cb, d) => cb(OK_PERMS.has(perm) && (d.requestingUrl || '').startsWith(origin + '/')));
  ses.setPermissionCheckHandler((wc, perm, reqOrigin) => OK_PERMS.has(perm) && reqOrigin === origin);
  // El streaming de Jellyfin lleva el token en la URL (api_key): esas respuestas no se guardan en la caché del disco,
  // porque Chromium usa la URL completa como clave y el token quedaría escrito en claro.
  const TOKEN_URL = /[?&](api_key|apikey)=/i;
  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    if (!TOKEN_URL.test(d.url)) return cb({});
    const h = {};
    for (const [k, v] of Object.entries(d.responseHeaders || {})) if (!/^(cache-control|expires|etag|last-modified)$/i.test(k)) h[k] = v;
    h['Cache-Control'] = ['no-store'];
    cb({ responseHeaders: h });
  });
  // Descargas: solo los archivos que genera la propia app (el video de «Tu año con Nanuq», como blob: de nuestro origen).
  ses.on('will-download', (e, item) => { if (!item.getURL().startsWith('blob:' + origin + '/')) e.preventDefault(); });
  // Integridad del código de la app: los archivos vienen siempre del paquete instalado (solo lectura en RPM y Flatpak) por
  // el servidor interno. Lo que Chromium deja en la carpeta de datos y podría ejecutar en una sesión siguiente se borra
  // ANTES de abrir la página: el service worker y su caché (versiones anteriores lo registraban: guardaba copias de
  // index.html y app.js) y la caché de código compilado de JavaScript. Si otra app los alterara, no llegan a usarse.
  try { await ses.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }); } catch { }
  try { await ses.clearCodeCaches({}); } catch { }
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  for (const ev of ['resize', 'move']) win.on(ev, () => { clearTimeout(saveState.t); saveState.t = setTimeout(saveState, 400); });
  win.on('close', saveState);

  // Los enlaces externos se abren en el navegador.
  const external = url => !url.startsWith(origin + '/');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (external(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  // Atajos útiles: F5/Ctrl+R recarga, F11 pantalla completa, Ctrl+Shift+I herramientas (para depurar).
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r')) { e.preventDefault(); ses.clearCodeCaches({}).catch(() => { }).finally(() => win.webContents.reload()); }
    else if (i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (i.control && i.shift && i.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });

  nativeTheme.themeSource = 'dark';
  win.loadURL(origin + '/index.html');
}
