// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Manual técnico de Nanuq (español e inglés): arquitectura con diagramas y, en el «nivel profundo», cada función del
// código (sale de functions.tsv; las secciones de app.js se leen del propio código al armar el PDF).
const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..', '..', '..');

module.exports = h => {
  const { t, tip, table, steps, A, esc } = h;
  const L = h.L;
  const S = [], TOC = [];
  const mk = id => `<span class="mk">@@${id}@@</span>`;
  let num = 0;
  const part = (id, label, title, lead, art) => { S.push({ part: true, id, label, title, lead, art }); TOC.push({ part: true, id, title }); };
  const add = (id, title, lead, html, subs = []) => { num++; S.push({ id, num, ci: num - 1, title, lead, html }); TOC.push({ id, title, desc: lead, ci: num - 1, num }); for (const s of subs) TOC.push({ sub: true, id: s[0], title: s[1] }); };

  // ---- Diagramas (SVG a mano) ----
  const C = { web: ['#e2f3fd', '#1e88d6'], and: ['#e6f7ec', '#1f9a55'], desk: ['#efe8ff', '#6c3fd1'], ext: ['#fff1e3', '#e0700a'], sec: ['#fde8ef', '#c4243c'], gray: ['#f1f4f8', '#5d6f8a'] };
  const box = (x, y, w, hh, title, sub, c = C.web) => `<g><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="10" fill="${c[0]}" stroke="${c[1]}" stroke-width="1.6"/>`
    + `<text x="${x + w / 2}" y="${y + (sub ? hh / 2 - 3 : hh / 2 + 5)}" text-anchor="middle" font-family="Outfit" font-weight="700" font-size="14" fill="#13233d">${title}</text>`
    + (sub ? `<text x="${x + w / 2}" y="${y + hh / 2 + 14}" text-anchor="middle" font-family="Inter" font-size="10.5" fill="#5d6f8a">${sub}</text>` : '') + '</g>';
  const arrow = (x1, y1, x2, y2, label = '', c = '#1e88d6', dash = false, lx = 0, ly = 0) => `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1.8" marker-end="url(#ar)"${dash ? ' stroke-dasharray="5 4"' : ''}/>`
    + (label ? `<text x="${(x1 + x2) / 2 + lx}" y="${(y1 + y2) / 2 + ly}" text-anchor="middle" font-family="Inter" font-size="10" fill="#33445d" paint-order="stroke" stroke="#fff" stroke-width="4">${label}</text>` : '') + '</g>';
  const diagram = (w, hh, body, cap) => `<div class="diagram"><svg viewBox="0 0 ${w} ${hh}" width="${w}"><defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#1e88d6"/></marker></defs>${body}</svg><div class="cap">${cap}</div></div>`;

  // ---- Datos del código ----
  const app = fs.readFileSync(R + '/web/app.js', 'utf8').split('\n');
  const heads = [];
  app.forEach((l, i) => { if (/^\/\* =+$/.test(l.trim()) && app[i + 1] && !/^=+/.test(app[i + 1].trim())) heads.push({ line: i + 2, raw: app[i + 1].trim() }); });
  const SECNAMES = [
    [/^Server address/, 'Direcciones del servidor', 'Server addresses'], [/^Jellyfin API/, 'API de Jellyfin', 'Jellyfin API'],
    [/^Audio helpers/, 'Audio: formas de onda y sintetizador', 'Audio: waveforms and synthesizer'], [/^Demo library/, 'Biblioteca demo', 'Demo library'],
    [/^Settings/, 'Ajustes y temas', 'Settings and themes'], [/^Descargas/, 'Descargas (Android)', 'Downloads (Android)'],
    [/^State, routing/, 'Estado y navegación', 'State and routing'], [/^Álbumes según/, 'Álbumes según las etiquetas', 'Albums from tags'],
    [/^Búsqueda en las letras/, 'Búsqueda en las letras', 'Lyrics search'], [/^Rendering helpers/, 'Ayudantes de dibujo', 'Rendering helpers'],
    [/^Views/, 'Vistas', 'Views'], [/^DJ Nanuq/, 'DJ Nanuq', 'DJ Nanuq'], [/^Tu año con Nanuq/, 'Tu año y Tu semana (video)', 'Your year and Your week (video)'],
    [/^Solicitar canción/, 'Solicitar canción (SomeDL)', 'Song requests (SomeDL)'], [/^Player/, 'Reproductor', 'Player'], [/^Lyrics/, 'Letras', 'Lyrics'],
    [/^Queue panel/, 'Cola', 'Queue'], [/^Overlays/, 'Avisos, menús y diálogos', 'Toasts, menus and dialogs'], [/^Mis dispositivos/, 'Mis dispositivos', 'My devices'],
    [/^Fiesta/, 'Fiesta (watch party)', 'Party (watch party)'], [/^Global actions/, 'Acciones globales', 'Global actions'], [/^Login/, 'Entrar', 'Login'], [/^Boot/, 'Arranque', 'Boot']];
  const secName = raw => { const m = SECNAMES.find(x => x[0].test(raw)); return m ? t(m[1], m[2]) : esc(raw.slice(0, 60)); };
  const fnRows = fs.readFileSync(__dirname + '/functions.tsv', 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const [file, name, line, es, en] = l.split('\t'); return { file, name, line: +line || 0, d: L === 'es' ? es : en }; });
  const byFile = new Map(); for (const r of fnRows) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
  const lineCount = f => { try { return fs.readFileSync(R + '/' + f, 'utf8').split('\n').length; } catch { return 0; } };
  const fnTable = rows => `<table class="fn"><thead><tr><th>${t('Función', 'Function')}</th><th>${t('Línea', 'Line')}</th><th>${t('Qué hace', 'What it does')}</th></tr></thead><tbody>${rows.map(r => `<tr><td class="name">${esc(r.name)}</td><td class="ln">${r.line || ''}</td><td>${esc(r.d)}</td></tr>`).join('')}</tbody></table>`;
  const fileBlock = f => `<h3 class="file">${esc(f)} <span class="badge">${lineCount(f).toLocaleString(L)} ${t('líneas', 'lines')} · ${(byFile.get(f) || []).length} ${t('funciones', 'functions')}</span></h3>${fnTable(byFile.get(f) || [])}`;
  const totalFns = fnRows.length;
  const nThemes = Object.keys(A.THEMES).length;
  const PT_MAX = /const PT_MAX = (\{[^}]+\})/.exec(fs.readFileSync(R + '/linux/main.js', 'utf8'))[1];

  // =================================================================================================================
  part('p1', t('Parte 1', 'Part 1'), t('Arquitectura', 'Architecture'), t('Cómo está armado Nanuq: una sola interfaz web, las apps que la envuelven y cómo se habla con Jellyfin, con tus otros dispositivos y con la fiesta.', 'How Nanuq is built: a single web interface, the apps that wrap it and how it talks to Jellyfin, to your other devices and to the party.'), A.bear('synth'));

  add('panorama', t('Panorama', 'Overview'), t('Una sola interfaz, tres envolturas.', 'One interface, three wrappers.'), t(`
<p class="lead">Toda la interfaz de Nanuq vive en <code>web/</code>: cuatro archivos sin compilar y sin dependencias. Las apps de Android y de escritorio no tienen interfaz propia: copian esa misma carpeta al compilar y le agregan, por un «puente», lo que una página web no puede hacer sola.</p>`, `
<p class="lead">All of Nanuq's interface lives in <code>web/</code>: four files, with no build step and no dependencies. The Android and desktop apps have no interface of their own: they copy that same folder at build time and add, through a “bridge”, what a web page can't do on its own.</p>`)
    + diagram(720, 330,
      box(210, 14, 300, 62, 'web/', 'index.html · i18n.js · app.js · app.css')
      + arrow(280, 76, 110, 140, '', '#1e88d6') + arrow(360, 76, 360, 140) + arrow(440, 76, 610, 140)
      + box(10, 142, 200, 66, t('Navegador', 'Browser'), t('PWA + sw.js', 'PWA + sw.js'), C.gray)
      + box(260, 142, 200, 66, 'Android', t('WebView + Java (NanuqAndroid)', 'WebView + Java (NanuqAndroid)'), C.and)
      + box(510, 142, 200, 66, t('Escritorio', 'Desktop'), t('Electron: Linux y Windows', 'Electron: Linux and Windows'), C.desk)
      + arrow(110, 208, 150, 262, '') + arrow(360, 208, 260, 262, '') + arrow(610, 208, 330, 262, '')
      + box(140, 262, 200, 56, 'Jellyfin', t('API, audio, WebSocket', 'API, audio, WebSocket'), C.ext)
      + arrow(360, 208, 450, 262, '', '#e0700a', true) + arrow(610, 208, 520, 262, '', '#e0700a', true)
      + box(400, 262, 130, 56, 'SomeDL', t('pedidos', 'requests'), C.ext)
      + arrow(640, 208, 640, 262, '', '#6c3fd1', true)
      + box(560, 262, 150, 56, t('Discord · Fiesta', 'Discord · Party'), t('solo escritorio', 'desktop only'), C.desk),
      t('Cada plataforma sirve la misma página; las flechas punteadas son lo que solo hace el código nativo (SomeDL sin CORS, Discord, la sala de la fiesta).', 'Every platform serves the same page; dashed arrows are what only native code does (SomeDL without CORS, Discord, the party room).'))
    + t(`<h2>Por qué así</h2>
<ul><li><b>Un cambio llega a todas partes</b>: la interfaz se toca solo en <code>web/</code>; Android y Linux la copian al compilar (<code>syncWeb</code> en Gradle, <code>prepare-web.js</code> en Electron).</li>
<li><b>Contexto seguro sin HTTPS</b>: Android sirve la página en <code>http://localhost</code> y Electron en <code>http://127.0.0.1:47863</code>. Así hay <code>crypto.randomUUID</code>, almacenamiento y service worker, y a la vez se puede hablar con un Jellyfin <code>http://</code> de la red local sin bloqueos de contenido mixto.</li>
<li><b>Sin servicios de terceros</b>: Nanuq solo habla con tu Jellyfin, tu SomeDL y (si lo activas) la app de Discord de tu computadora. Las únicas peticiones externas son las fuentes de Google Fonts.</li></ul>
<h2>Puertos</h2>`, `<h2>Why this way</h2>
<ul><li><b>One change reaches every platform</b>: the interface is only edited in <code>web/</code>; Android and Linux copy it at build time (<code>syncWeb</code> in Gradle, <code>prepare-web.js</code> in Electron).</li>
<li><b>Secure context without HTTPS</b>: Android serves the page at <code>http://localhost</code> and Electron at <code>http://127.0.0.1:47863</code>. That gives <code>crypto.randomUUID</code>, storage and a service worker, while still talking to an <code>http://</code> Jellyfin on the local network without mixed-content blocks.</li>
<li><b>No third-party services</b>: Nanuq only talks to your Jellyfin, your SomeDL and (if you enable it) the Discord app on your computer. The only external requests are the Google Fonts.</li></ul>
<h2>Ports</h2>`)
    + table([t('Puerto', 'Port'), t('Quién', 'Who'), t('Para qué', 'What for')], [
      ['TCP 47863', t('Escritorio (127.0.0.1)', 'Desktop (127.0.0.1)'), t('Sirve la página y, con la fiesta abierta, el audio de la sala (<code>/fiesta/&lt;token&gt;/…</code>). Puerto fijo porque el almacenamiento depende del origen.', 'Serves the page and, with the party open, the room\'s audio (<code>/fiesta/&lt;token&gt;/…</code>). Fixed port because storage depends on the origin.')],
      ['TCP 47864', t('Escritorio (red local)', 'Desktop (local network)'), t('WebSocket de la fiesta (<code>/fiesta</code>) y carátulas para los invitados. Solo con la sala abierta y solo direcciones privadas.', 'Party WebSocket (<code>/fiesta</code>) and covers for guests. Only with the room open and only private addresses.')],
      ['UDP 47865', t('Escritorio', 'Desktop'), t('Responde a «Who is NanuqParty?» para que los teléfonos encuentren la sala (≤ 30 respuestas/s).', 'Answers “Who is NanuqParty?” so phones find the room (≤ 30 answers/s).')],
      ['UDP 7359', 'Jellyfin', t('Búsqueda oficial de servidores («Who is JellyfinServer?»), desde Android y escritorio.', 'Official server discovery (“Who is JellyfinServer?”), from Android and desktop.')],
      [t('TCP aleatorio', 'TCP random'), t('Android (127.0.0.1)', 'Android (127.0.0.1)'), t('<code>LocalServer</code>: descargas, carátulas y lo guardado por adelantado, con token en la ruta.', '<code>LocalServer</code>: downloads, covers and prefetched songs, with a token in the path.')],
      ['8096 / 8920', 'Jellyfin', t('Puertos que se asumen si escribes una IP o un nombre corto sin puerto.', 'Ports assumed if you type an IP or short name without a port.')],
      ['5000', 'SomeDL', t('Puerto que se asume para SomeDL sin puerto.', 'Port assumed for SomeDL without a port.')]]));

  add('repo', t('El repositorio', 'The repository'), t('Qué hay en cada carpeta.', 'What lives in each folder.'), table([t('Ruta', 'Path'), t('Contenido', 'Contents')], [
    ['<code>web/index.html</code>', t('Estructura, CSP estricta y <code>&lt;defs&gt;</code> SVG: íconos <code>#i-*</code> y el oso vectorizado (<code>#djb-*</code>).', 'Structure, strict CSP and SVG <code>&lt;defs&gt;</code>: <code>#i-*</code> icons and the vector bear (<code>#djb-*</code>).')],
    ['<code>web/i18n.js</code>', t('Idiomas: <code>LANGS</code>, <code>LANG</code>, <code>LOC</code>, el diccionario <code>EN</code> (clave = texto en español) y <code>tx()</code>. Se carga antes que app.js.', 'Languages: <code>LANGS</code>, <code>LANG</code>, <code>LOC</code>, the <code>EN</code> dictionary (key = Spanish text) and <code>tx()</code>. Loaded before app.js.')],
    ['<code>web/app.js</code>', t(`Toda la lógica (${app.length.toLocaleString(L)} líneas). <code>const VERSION</code> es la fuente de verdad de la versión.`, `All the logic (${app.length.toLocaleString(L)} lines). <code>const VERSION</code> is the source of truth for the version.`)],
    ['<code>web/app.css</code>', t(`Todo el estilo, con variables por tema (${nThemes} temas).`, `All styling, with per-theme variables (${nThemes} themes).`)],
    ['<code>web/sw.js</code>', t('Service worker: guarda solo la app (red primero para el código), nunca música ni API.', 'Service worker: caches only the app (network first for code), never music or API.')],
    ['<code>android/</code>', t('WebView + Java (<code>com.nanuq.app</code>), el puente <code>bridge/android-bridge.js</code> y <code>build-apk.sh</code>.', 'WebView + Java (<code>com.nanuq.app</code>), the <code>bridge/android-bridge.js</code> bridge and <code>build-apk.sh</code>.')],
    ['<code>linux/</code>', t('Electron: <code>main.js</code>, <code>preload.js</code>, <code>prepare-web.js</code>, <code>collect.js</code> y <code>flatpak/</code>. También arma el instalador de Windows.', 'Electron: <code>main.js</code>, <code>preload.js</code>, <code>prepare-web.js</code>, <code>collect.js</code> and <code>flatpak/</code>. It also builds the Windows installer.')],
    ['<code>scripts/build.sh</code>', t('Sube la versión y compila todo a <code>dist/&lt;versión&gt;/</code>.', 'Bumps the version and builds everything into <code>dist/&lt;version&gt;/</code>.')],
    ['<code>docs/</code>', t('Imágenes del README y estos manuales (<code>docs/manuals/src</code>: <code>node docs/manuals/src/build.js</code>).', 'README images and these manuals (<code>docs/manuals/src</code>: <code>node docs/manuals/src/build.js</code>).')]])
    + tip(t('<code>dist/</code>, <code>keystore.properties</code> y los <code>*.jks</code> no van al repositorio. La llave de firma del APK vive fuera (<code>~/.android/nanuq-release.jks</code>): sin ella no se pueden publicar actualizaciones.', '<code>dist/</code>, <code>keystore.properties</code> and <code>*.jks</code> files never go into the repository. The APK signing key lives outside (<code>~/.android/nanuq-release.jks</code>): without it, updates can\'t be published.'), 'chile', true));

  const secRows = heads.map(x => [secName(x.raw), String(x.line)]);
  add('pagina', t('La página', 'The page'), t('Cómo arranca, navega y reacciona app.js.', 'How app.js starts, navigates and reacts.'), t(`
<h2>Arranque</h2>`, `<h2>Startup</h2>`) + steps(t([
    'Al cargar, <code>i18n.js</code> decide el idioma y <code>txStatic()</code> traduce los textos fijos del HTML.',
    '<code>SEC</code> detecta el almacén cifrado nativo y <code>secMigrate()</code> mueve allí lo que versiones viejas dejaron en claro.',
    'El bloque de arranque dibuja la barra lateral y las pestañas, aplica el tema e inicia las descargas (<code>DL.init</code>).',
    '<code>Vault.init()</code> reintenta unos segundos si el Keystore o el llavero aún no responden; luego <code>Vault.load()</code> lee la sesión.',
    'Con sesión: <code>startApp(new Jellyfin(sess))</code> recupera la cola y la posición (<code>QPOS</code>), restaura el DJ y abre Inicio. Sin sesión: <code>showLogin()</code>.'
  ], [
    'On load, <code>i18n.js</code> picks the language and <code>txStatic()</code> translates the fixed HTML texts.',
    '<code>SEC</code> detects the native encrypted store and <code>secMigrate()</code> moves there whatever older versions left in plain text.',
    'The boot block draws the sidebar and tabs, applies the theme and starts downloads (<code>DL.init</code>).',
    '<code>Vault.init()</code> retries for a few seconds if the Keystore or keyring isn\'t ready yet; then <code>Vault.load()</code> reads the session.',
    'With a session: <code>startApp(new Jellyfin(sess))</code> restores the queue and position (<code>QPOS</code>), restores the DJ and opens Home. Without one: <code>showLogin()</code>.'
  ]).map(x => x)) + t(`
<h2>Navegación</h2>
<p><code>S.stack</code> es la pila de pantallas. <code>go(nombre, params, opts)</code> empuja una pantalla (las de <code>TOP</code> vacían la pila) y llama a <code>render()</code>, que ejecuta <code>V[nombre](caja, params)</code>. Cada vista es una función asíncrona que llena su caja; si deja <code>_cleanup</code>, se llama al salir. <code>back()</code> cierra primero lo que esté encima (menú, editor de letra, reproductor) y luego retrocede. Con la fiesta abierta (<code>party-host</code> / <code>in-party</code>) solo existe la pantalla de la fiesta.</p>
<h2>Eventos</h2>
<p>La CSP prohíbe scripts en línea, así que no hay <code>onclick=</code>: todo botón lleva <code>data-act="…"</code> y un único manejador de clic global decide qué hacer (sección «Acciones globales»). Las imágenes que deben desaparecer si fallan llevan <code>data-rm</code>.</p>
<h2>Idiomas</h2>
<p>Todo texto visible se escribe en español dentro de <code>tx('…')</code>; <code>i18n.js</code> tiene la traducción con el texto en español como clave. Con valores: <code>tx('… {0} …', [x])</code>. Cambiar de idioma guarda la posición y recarga la página, así también se traducen los textos que se arman al cargar.</p>
<h2>Secciones de app.js</h2>`, `
<h2>Navigation</h2>
<p><code>S.stack</code> is the screen stack. <code>go(name, params, opts)</code> pushes a screen (the <code>TOP</code> ones clear the stack) and calls <code>render()</code>, which runs <code>V[name](box, params)</code>. Each view is an async function that fills its box; if it leaves a <code>_cleanup</code>, it's called on exit. <code>back()</code> first closes whatever is on top (menu, lyrics editor, player) and then goes back. With the party open (<code>party-host</code> / <code>in-party</code>) only the party screen exists.</p>
<h2>Events</h2>
<p>The CSP forbids inline scripts, so there's no <code>onclick=</code>: every button has <code>data-act="…"</code> and a single global click handler decides what to do (“Global actions” section). Images that must disappear when they fail carry <code>data-rm</code>.</p>
<h2>Languages</h2>
<p>Every visible text is written in Spanish inside <code>tx('…')</code>; <code>i18n.js</code> holds the translation keyed by the Spanish text. With values: <code>tx('… {0} …', [x])</code>. Switching language saves the position and reloads the page, so texts built at load time are translated too.</p>
<h2>Sections of app.js</h2>`)
    + table([t('Sección', 'Section'), t('Desde la línea', 'From line')], [[t('Base: ayudantes y almacén', 'Base: helpers and storage'), '1'], ...secRows]));

  add('datos', t('Datos y almacenamiento', 'Data and storage'), t('Lo que dice algo de ti va cifrado.', 'Anything about you is encrypted.'), t(`
<p class="lead"><code>store</code> es el único acceso al almacenamiento. Las preferencias de la interfaz (tema, volumen, órdenes) van a <code>localStorage</code> con el prefijo <code>nanuq.</code>; lo que dice algo de ti va al almacén cifrado de la plataforma.</p>`, `
<p class="lead"><code>store</code> is the only way to storage. Interface preferences (theme, volume, sort orders) go to <code>localStorage</code> with the <code>nanuq.</code> prefix; anything that says something about you goes to the platform's encrypted store.</p>`)
    + diagram(720, 250,
      box(260, 10, 200, 52, 'store.get / set / del', t('app.js', 'app.js'))
      + arrow(320, 62, 150, 112, t('preferencias', 'preferences'), '#5d6f8a', false, -30) + arrow(400, 62, 560, 112, t('sensible (isSensitive)', 'sensitive (isSensitive)'), '#c4243c', false, 40)
      + box(40, 114, 220, 56, 'localStorage', t('tema, volumen, órdenes…', 'theme, volume, sort orders…'), C.gray)
      + box(450, 114, 230, 56, 'SEC', t('almacén cifrado nativo', 'native encrypted store'), C.sec)
      + arrow(500, 170, 400, 196) + arrow(630, 170, 640, 196)
      + box(280, 198, 220, 46, 'Android: SecureStore', t('AES-GCM, clave en Keystore', 'AES-GCM, key in Keystore'), C.and)
      + box(520, 198, 190, 46, t('Escritorio: main.js SEC', 'Desktop: main.js SEC'), t('AES-256-GCM, clave en llavero', 'AES-256-GCM, key in keyring'), C.desk),
      t('En el navegador no hay almacén seguro: todo queda en localStorage (Ajustes lo dice).', 'In the browser there is no secure store: everything stays in localStorage (Settings says so).'))
    + table([t('Clave', 'Key'), t('Qué guarda', 'What it holds')], [
      ['session', t('Servidor, usuario y token de Jellyfin.', 'Jellyfin server, user and token.')],
      ['queue · queuePos', t('Tu cola (hasta 3000) y el segundo donde ibas (queuePos no es sensible: solo un id al azar y segundos).', 'Your queue (up to 3000) and the second you were at (queuePos isn\'t sensitive: just a random id and seconds).')],
      ['libIdx · lyrIdx', t('Índices de tu biblioteca (álbumes por etiquetas) y de tus letras.', 'Indexes of your library (albums from tags) and of your lyrics.')],
      ['dj · djHist', t('Sesión del DJ en curso e historial de lo que puso.', 'Current DJ session and history of what it played.')],
      ['plays · mp3ids', t('Reproducciones por canción en este dispositivo y canciones que van en MP3.', 'Plays per song on this device and songs that go as MP3.')],
      ['somedl · somedlReqs · somedlLast', t('Servidor SomeDL y tus pedidos.', 'SomeDL server and your requests.')],
      ['servers · lastServer · device · party', t('Servidores recientes, id del dispositivo y la fiesta en curso (teléfono).', 'Recent servers, device id and the current party (phone).')],
      ['lrc.&lt;id&gt;', t('Letras guardadas solo en este dispositivo.', 'Lyrics saved only on this device.')]])
    + t(`<h2>Estados del almacén</h2>
<p><code>SEC.kind</code> puede ser el nombre del almacén (funciona), <code>locked</code> (hay datos cifrados que ahora no abren: se reintenta), <code>lost</code> (la clave ya no existe: se ofrece «Empezar de cero», que aparta los datos sin borrarlos) o <code>null</code> (no hay almacén). Mientras no esté abierto, lo nuevo vive solo en memoria (<code>SEC.mem</code>): <b>nunca</b> se escribe en claro.</p>`, `<h2>Store states</h2>
<p><code>SEC.kind</code> can be the store's name (works), <code>locked</code> (encrypted data that won't open right now: retried), <code>lost</code> (the key is gone: “Start over” is offered, which sets the data aside without deleting it) or <code>null</code> (no store). While it isn't open, new data lives only in memory (<code>SEC.mem</code>): it's <b>never</b> written in plain text.</p>`));

  add('audio', t('Reproducción', 'Playback'), t('De dónde sale cada canción y qué pasa cuando algo falla.', 'Where each song comes from and what happens when something fails.'), t(`
<p class="lead"><code>P</code> guarda la cola, el índice y el único <code>&lt;audio&gt;</code>. <code>playIndex(i)</code> elige la fuente con <code>api.stream()</code>: primero la copia descargada, luego la guardada por adelantado y, si no hay, el streaming de Jellyfin.</p>`, `
<p class="lead"><code>P</code> holds the queue, the index and the single <code>&lt;audio&gt;</code>. <code>playIndex(i)</code> picks the source with <code>api.stream()</code>: first the downloaded copy, then the prefetched one and, if neither exists, Jellyfin streaming.</p>`)
    + diagram(720, 280,
      box(270, 8, 180, 46, 'playIndex(i)', 'api.stream(t)')
      + arrow(360, 54, 120, 100) + arrow(360, 54, 360, 100) + arrow(360, 54, 600, 100)
      + box(20, 102, 200, 56, 'DL.localUrl', t('descargada (127.0.0.1/a/)', 'downloaded (127.0.0.1/a/)'), C.and)
      + box(260, 102, 200, 56, 'PF.url', t('por adelantado (…/p/)', 'prefetched (…/p/)'), C.and)
      + box(500, 102, 200, 56, 'streamUrl', '/Audio/{id}/universal', C.ext)
      + arrow(360, 158, 360, 200, t('si falla', 'if it fails'), '#c4243c')
      + box(40, 202, 640, 66, t('localFailed → fallbackMp3 → playFailed', 'localFailed → fallbackMp3 → playFailed'), t('copia rota → del servidor · «Original» que no arranca → MP3 320 kbps · si nada: un aviso con la causa (401, 404, 5xx, formato)', 'broken copy → from the server · “Original” that won\'t start → MP3 320 kbps · if nothing works: a notice with the cause (401, 404, 5xx, format)'), C.sec),
      t('En Android, las dos primeras fuentes las sirve el teléfono mismo; en Android y escritorio la página nunca baja el audio completo a memoria.', 'On Android, the first two sources are served by the phone itself; on Android and desktop the page never loads the whole audio into memory.'))
    + t(`<h2>Detalles que importan</h2>
<ul><li><b>Saltar en conversiones en vivo</b>: si Jellyfin transcodifica, el archivo no admite saltos; <code>seekTo</code> pide el audio otra vez con <code>StartTimeTicks</code> y recuerda el desplazamiento (<code>P.off</code>). Al arrastrar, la petición sale al soltar.</li>
<li><b>Atascos</b>: <code>armStallWatch</code> avisa si no arranca en 10 s; <code>stallCheck</code> reanuda desde el mismo segundo si la red se cayó a media canción; <code>netBack</code> lo hace al volver la red.</li>
<li><b>Desvanecer</b>: <code>pauseSoft</code>/<code>playSoft</code>; el volumen de vuelta es siempre el tuyo (<code>userVol</code>), nunca el del instante.</li>
<li><b>Pausa ajena</b>: si otra app tomó la salida de audio (<code>P.extPause</code>), al reanudar se recarga la canción para no quedarse mudo.</li>
<li><b>Controles del sistema</b>: <code>navigator.mediaSession</code>; en Android lo reemplaza el puente nativo. En escritorio un audio en silencio (<code>rcKeep</code>/<code>sessionHold</code>) mantiene los controles mientras carga o controlas otro dispositivo.</li>
<li><b>Favoritas</b>: Jellyfin 12 sobrescribe la favorita de la canción que suena con cada aviso de reproducción; <code>FAVHOLD</code> la vuelve a guardar después de cada aviso.</li></ul>`, `<h2>Details that matter</h2>
<ul><li><b>Seeking in live transcodes</b>: if Jellyfin transcodes, the file can't be seeked; <code>seekTo</code> requests the audio again with <code>StartTimeTicks</code> and remembers the offset (<code>P.off</code>). While dragging, the request goes out on release.</li>
<li><b>Stalls</b>: <code>armStallWatch</code> warns if it doesn't start within 10 s; <code>stallCheck</code> resumes from the same second if the network dropped mid-song; <code>netBack</code> does it when the network returns.</li>
<li><b>Fades</b>: <code>pauseSoft</code>/<code>playSoft</code>; the restored volume is always yours (<code>userVol</code>), never the one of that instant.</li>
<li><b>Foreign pause</b>: if another app took the audio output (<code>P.extPause</code>), resuming reloads the song so it doesn't stay silent.</li>
<li><b>System controls</b>: <code>navigator.mediaSession</code>; on Android the native bridge replaces it. On desktop a silent audio (<code>rcKeep</code>/<code>sessionHold</code>) keeps the controls while loading or while you control another device.</li>
<li><b>Favorites</b>: Jellyfin 12 overwrites the favorite of the playing song with every playback report; <code>FAVHOLD</code> saves it again after each report.</li></ul>`));

  add('biblioteca', t('Biblioteca y Jellyfin', 'Library and Jellyfin'), t('La API que usa Nanuq y lo que arma por su cuenta.', 'The API Nanuq uses and what it builds on its own.'), table([t('Ruta de Jellyfin', 'Jellyfin route'), t('Para qué', 'What for')], [
    ['/System/Info/Public · /Users/AuthenticateByName', t('Reconocer el servidor y entrar.', 'Recognize the server and log in.')],
    ['/Items · /Artists/AlbumArtists · /MusicGenres · /Playlists', t('Listas de la biblioteca (con varias rutas de respaldo según la versión).', 'Library lists (with several fallback routes depending on the version).')],
    ['/Audio/{id}/universal', t('El audio (streaming, descargas, por adelantado, fiesta).', 'The audio (streaming, downloads, prefetch, party).')],
    ['/Audio/{id}/Lyrics · …/RemoteSearch/Lyrics', t('Leer, subir y buscar letras (10.9+).', 'Read, upload and search lyrics (10.9+).')],
    ['/UserFavoriteItems/{id}', t('Favoritas (y la ruta anterior a 10.9 como respaldo).', 'Favorites (and the pre-10.9 route as fallback).')],
    ['/Items/{id}/InstantMix', t('Radio de una canción.', 'Song radio.')],
    ['/Sessions · /Sessions/{id}/Playing · /socket', t('Mis dispositivos: sesiones, órdenes y avisos en vivo.', 'My devices: sessions, commands and live events.')],
    ['/Sessions/Playing(/Progress|/Stopped)', t('Avisos de reproducción (lo que ve el servidor).', 'Playback reports (what the server sees).')],
    ['/DisplayPreferences/nanuq-dj', t('Estado del DJ compartido entre tus dispositivos.', 'DJ state shared between your devices.')],
    ['/user_usage_stats/…', t('Plugin Playback Reporting para Tu semana / Tu año (si está).', 'Playback Reporting plugin for Your week / Your year (if present).')]])
    + t(`<h2>Álbumes por etiquetas (LIB)</h2>
<p>Jellyfin arma los álbumes por carpeta; Nanuq los arma con las etiquetas «Álbum» + «Artista del álbum» de cada canción (<code>albumKeyOf</code>), junta «(Disc 2)» con su disco y quita duplicados. El índice de todas tus canciones se pide de a 1000 (tres páginas a la vez), se guarda cifrado y se renueva cada 10 minutos. Los ids de estos álbumes empiezan con <code>m</code> (<code>albumGid</code>).</p>
<h2>Búsqueda en las letras (LYRX)</h2>
<p>Jellyfin no busca dentro de las letras: Nanuq indexa las canciones con <code>HasLyrics</code> (de a 3, hasta 8000) y las letras locales, normalizadas sin acentos ni signos (<code>lyrNorm</code>). Se busca con 4 caracteres o más.</p>`, `<h2>Albums from tags (LIB)</h2>
<p>Jellyfin builds albums by folder; Nanuq builds them from each song's “Album” + “Album artist” tags (<code>albumKeyOf</code>), joins “(Disc 2)” with its album and removes duplicates. The index of all your songs is fetched 1000 at a time (three pages at once), stored encrypted and refreshed every 10 minutes. These album ids start with <code>m</code> (<code>albumGid</code>).</p>
<h2>Lyrics search (LYRX)</h2>
<p>Jellyfin doesn't search inside lyrics: Nanuq indexes the songs with <code>HasLyrics</code> (3 at a time, up to 8000) plus local lyrics, normalized without accents or punctuation (<code>lyrNorm</code>). Searches need 4 characters or more.</p>`));

  add('dj', 'DJ Nanuq', t('Rondas con reglas, sin IA.', 'Rule-based rounds, no AI.'), t(`
<p class="lead"><code>DJ.next()</code> ordena los tipos de ronda al azar según su peso, evita repetir los recientes y prueba hasta encontrar una que <b>explore</b> (canciones que no sonaron en las últimas semanas). Cada canción lleva su ronda en el id de la cola: <code>dj-&lt;sesión&gt;-&lt;ronda&gt;-&lt;azar&gt;</code>.</p>`, `
<p class="lead"><code>DJ.next()</code> shuffles round types by weight, avoids repeating recent ones and tries until it finds one that <b>explores</b> (songs that didn't play in recent weeks). Each song carries its round in the queue id: <code>dj-&lt;session&gt;-&lt;round&gt;-&lt;random&gt;</code>.</p>`)
    + table([t('Ronda', 'Round'), t('Peso', 'Weight'), t('Qué pone', 'What it plays')], [
      ['genre', '6', t('Un género de tu biblioteca (≥ 3 canciones en una muestra de 400), sin repetir los recientes.', 'A genre from your library (≥ 3 songs in a 400-song sample), not repeating recent ones.')],
      ['decade', '3.5', t('Una década real de tu biblioteca; las pasadas pesan ×1.5.', 'A real decade from your library; past ones weigh ×1.5.')],
      ['discover', '3', t('Nunca escuchadas, primero en tus géneros favoritos.', 'Never played, first in your favorite genres.')],
      ['forgotten', '3', t('Más de 45 días sin sonar.', 'More than 45 days without playing.')],
      ['mood', '1', t('Según la hora (mañana tranquila, tarde con energía…).', 'By time of day (calm morning, energetic afternoon…).')],
      ['fresh · fav · recent · top', '.8 · .6 · .15 · .15', t('Recién llegadas, favoritas, lo de estos días y lo más escuchado (con enfriamiento).', 'Newly added, favorites, recent days and most played (with cooldown).')]])
    + t(`<p><code>DJ.rank()</code> decide qué tan «gastada» está una canción: lo de los últimos 3 días o de sesiones recientes del DJ casi no entra; lo olvidado va primero. Al pasar la música a otro dispositivo, <code>DJSHARE</code> deja el estado en tu Jellyfin y el otro lo adopta (<code>DJ.adopt</code>); lo que se lee se limpia con <code>djClean</code>.</p>`, `<p><code>DJ.rank()</code> decides how “worn out” a song is: anything from the last 3 days or from recent DJ sessions barely gets in; forgotten songs go first. When music moves to another device, <code>DJSHARE</code> leaves the state in your Jellyfin and the other one adopts it (<code>DJ.adopt</code>); whatever is read is cleaned with <code>djClean</code>.</p>`));

  add('dispositivos', t('Mis dispositivos', 'My devices'), t('Un Nanuq suena y los demás lo controlan, a través de Jellyfin.', 'One Nanuq plays and the others control it, through Jellyfin.'), diagram(720, 200,
    box(20, 70, 200, 60, t('Nanuq que suena', 'Playing Nanuq'), t('reporta su cola y posición', 'reports its queue and position'), C.and)
    + box(260, 70, 200, 60, 'Jellyfin', '/Sessions · WebSocket', C.ext)
    + box(500, 70, 200, 60, t('Nanuq control remoto', 'Remote-control Nanuq'), t('RC.remote', 'RC.remote'), C.desk)
    + arrow(220, 90, 258, 90, '') + arrow(498, 90, 462, 90, '') + arrow(462, 112, 498, 112, '') + arrow(258, 112, 222, 112, '')
    + `<text x="240" y="60" text-anchor="middle" font-family="Inter" font-size="10" fill="#33445d">${t('Playing/Progress', 'Playing/Progress')}</text><text x="480" y="60" text-anchor="middle" font-family="Inter" font-size="10" fill="#33445d">${t('GET /Sessions (2–8 s)', 'GET /Sessions (2–8 s)')}</text>`
    + `<text x="240" y="150" text-anchor="middle" font-family="Inter" font-size="10" fill="#33445d">${t('órdenes por WebSocket', 'commands via WebSocket')}</text><text x="480" y="150" text-anchor="middle" font-family="Inter" font-size="10" fill="#33445d">${t('POST …/Playing/{cmd}', 'POST …/Playing/{cmd}')}</text>`,
    t('No se abre ningún puerto en los dispositivos: todo pasa por tu Jellyfin, con tu sesión.', 'No port is opened on the devices: everything goes through your Jellyfin, with your session.'))
    + t(`<ul><li><b>Quién aparece</b>: sesiones con cliente «Nanuq», de tu mismo usuario, activas hace menos de 15 minutos según el reloj del <i>servidor</i> (los relojes desfasados no estorban).</li>
<li><b>Misma red</b>: misma /24 en IPv4 o /64 en IPv6 (o ambas privadas), con la dirección que ve el servidor.</li>
<li><b>Órdenes aceptadas</b>: <code>Play</code> y <code>GeneralCommand</code> solo si las manda tu usuario (dato que pone Jellyfin); <code>Playstate</code> lo filtra Jellyfin por permisos.</li>
<li><b>Controlando</b>, tu cola local se aparta (<code>RC.localQ</code>) y vuelve al desconectarte; la posición se estima desde el último reporte (<code>RC.anchor</code>).</li>
<li>En Android, con la pantalla bloqueada, la app nativa llama a <code>__nanuqTick</code> cada 20 s para mantener vivo el WebSocket.</li></ul>`, `<ul><li><b>Who shows up</b>: sessions with client “Nanuq”, of your same user, active within 15 minutes by the <i>server's</i> clock (skewed clocks don't matter).</li>
<li><b>Same network</b>: same /24 in IPv4 or /64 in IPv6 (or both private), using the address the server sees.</li>
<li><b>Accepted commands</b>: <code>Play</code> and <code>GeneralCommand</code> only if your user sent them (data Jellyfin fills in); <code>Playstate</code> is filtered by Jellyfin permissions.</li>
<li><b>While controlling</b>, your local queue is set aside (<code>RC.localQ</code>) and comes back when you disconnect; the position is estimated from the last report (<code>RC.anchor</code>).</li>
<li>On Android, with the screen locked, the native app calls <code>__nanuqTick</code> every 20 s to keep the WebSocket alive.</li></ul>`));

  add('fiesta', t('La fiesta', 'The party'), t('Teléfonos que mandan canciones a una computadora por la red local.', 'Phones sending songs to a computer over the local network.'), diagram(720, 260,
    box(10, 20, 190, 56, t('Jellyfin del invitado', 'Guest\'s Jellyfin'), t('o su descarga', 'or their download'), C.ext)
    + arrow(105, 76, 105, 118, t('MP3 320', 'MP3 320'), '#e0700a', false, 30)
    + box(10, 120, 190, 64, t('Teléfono (PG)', 'Phone (PG)'), t('hello · add · trozos binarios · end', 'hello · add · binary chunks · end'), C.and)
    + arrow(200, 140, 268, 140, 'WS :47864', '#1f9a55', false, 0, -8)
    + box(270, 110, 200, 90, 'main.js (PT)', t('código, llaves, topes, ptSniff', 'code, keys, limits, ptSniff'), C.desk)
    + arrow(470, 140, 528, 140, '127.0.0.1', '#6c3fd1', false, 0, -8)
    + box(530, 110, 180, 90, t('Página (PH)', 'Page (PH)'), t('reproduce, karaoke cada 1 s, iglú', 'plays, karaoke every 1 s, igloo'), C.web)
    + arrow(270, 180, 202, 180, t('state · tick', 'state · tick'), '#6c3fd1', true, 0, 14)
    + `<text x="370" y="240" text-anchor="middle" font-family="Inter" font-size="10.5" fill="#5d6f8a">${t('UDP :47865 «Who is NanuqParty?» → nombre y puerto de la sala', 'UDP :47865 “Who is NanuqParty?” → room name and port')}</text>`,
    t('El teléfono baja la canción de SU Jellyfin y se la pasa a la computadora en trozos de 256 KB, sin tenerla entera en memoria.', 'The phone fetches the song from ITS Jellyfin and hands it to the computer in 256 KB chunks, without holding it whole in memory.'))
    + table([t('Mensaje', 'Message'), t('Sentido', 'Direction'), t('Qué es', 'What it is')], [
      ['hello {code|key, name, theme}', t('teléfono → PC', 'phone → PC'), t('Entrar con el código de 6 dígitos o volver con su llave.', 'Join with the 6-digit code or come back with its key.')],
      ['welcome {you, key, room, chunk}', t('PC → teléfono', 'PC → phone'), t('Entró: su llave para volver sin código (2 h).', 'Joined: its key to come back without the code (2 h).')],
      ['add · [id + bytes] · end · remove', t('teléfono → PC', 'phone → PC'), t('Mandar una canción (datos, letra, carátula) y sus bytes.', 'Send a song (data, lyrics, cover) and its bytes.')],
      ['addOk · addErr · ready', t('PC → teléfono', 'PC → phone'), t('Respuesta al pedido y aviso de que ya está lista.', 'Answer to the request and notice that it\'s ready.')],
      ['state · tick', t('PC → teléfonos', 'PC → phones'), t('Lista, invitados y lo que suena; segundo y línea del karaoke.', 'List, guests and what\'s playing; second and karaoke line.')],
      ['bye {why} · leave · ping', t('ambos', 'both'), t('Salir, ser sacado o avisar que sigue ahí.', 'Leave, be removed or say it\'s still there.')]])
    + t(`<h2>Topes y defensas</h2><p><code>PT_MAX</code> en <code>main.js</code>: <code>${esc(PT_MAX)}</code>. Solo direcciones privadas (<code>ptLocal</code>), ≤ 4 conexiones sin presentarse por dirección, 5 códigos malos por minuto por dirección y, con 30 fallos en total, código nuevo y un minuto cerrado. El JSON se lee con <code>jparse</code> y los textos con <code>ptStr</code>; un mensaje que haga fallar algo solo corta esa conexión.</p>`, `<h2>Limits and defenses</h2><p><code>PT_MAX</code> in <code>main.js</code>: <code>${esc(PT_MAX)}</code>. Private addresses only (<code>ptLocal</code>), ≤ 4 not-yet-identified connections per address, 5 wrong codes per minute per address and, after 30 failures overall, a new code and one minute closed. JSON is read with <code>jparse</code> and texts with <code>ptStr</code>; a message that breaks something only drops that connection.</p>`));

  add('android', t('La app de Android', 'The Android app'), t('WebView + Java nativo.', 'WebView + native Java.'), table([t('Clase', 'Class'), t('Responsabilidad', 'Responsibility')], [
    ['MainActivity', t('WebView (assets en <code>http://localhost</code>), el puente <code>NanuqAndroid</code>, latido de 20 s, recrear el WebView si muere, enlaces externos solo http(s).', 'WebView (assets at <code>http://localhost</code>), the <code>NanuqAndroid</code> bridge, 20 s heartbeat, recreate the WebView if it dies, external links http(s) only.')],
    ['MediaCenter · PlaybackService', t('MediaSession y notificación; servicio en primer plano con bloqueos de CPU y Wi-Fi mientras suena; se libera tras 10 min en pausa.', 'MediaSession and notification; foreground service with CPU and Wi-Fi locks while playing; released after 10 min paused.')],
    ['Downloads', t('Descargas de una en una, solo Wi-Fi por omisión, límite con reemplazo de automáticas; índice cifrado.', 'One-at-a-time downloads, Wi-Fi only by default, limit with replacement of automatic ones; encrypted index.')],
    ['Prefetch', t('Lo que sigue en la cola, en la caché (≤ 400 MB por archivo, 1 GB total, 300 MB libres).', 'What\'s next in the queue, in the cache (≤ 400 MB per file, 1 GB total, 300 MB free).')],
    ['LocalServer', t('HTTP en 127.0.0.1 con token: <code>a/</code> audio, <code>c/</code> carátula, <code>p/</code> por adelantado; Range; 10 s por petición, ≤ 100 encabezados, 32 hilos.', 'HTTP on 127.0.0.1 with a token: <code>a/</code> audio, <code>c/</code> cover, <code>p/</code> prefetch; Range; 10 s per request, ≤ 100 headers, 32 threads.')],
    ['SecureStore', t('Almacén AES-GCM con clave en Android Keystore; estados locked / lost.', 'AES-GCM store with a key in Android Keystore; locked / lost states.')],
    ['NativeHttp · Discovery', t('HTTP sin CORS solo para las rutas de SomeDL; búsqueda UDP de Jellyfin y de fiestas.', 'HTTP without CORS only for SomeDL routes; UDP discovery for Jellyfin and parties.')]])
    + t(`<p>El puente <code>android-bridge.js</code> se inyecta en <code>index.html</code> al compilar y reemplaza <code>navigator.mediaSession</code> por uno que habla con <code>MediaCenter</code>. Solo se descargan direcciones con forma de Jellyfin (<code>Downloads.okUrl</code>) y las redirecciones solo dentro del mismo servidor (<code>openSameHost</code>).</p>`, `<p>The <code>android-bridge.js</code> bridge is injected into <code>index.html</code> at build time and replaces <code>navigator.mediaSession</code> with one that talks to <code>MediaCenter</code>. Only Jellyfin-shaped URLs are downloaded (<code>Downloads.okUrl</code>) and redirects only within the same server (<code>openSameHost</code>).</p>`));

  add('escritorio', t('La app de escritorio', 'The desktop app'), t('Electron para Linux y Windows.', 'Electron for Linux and Windows.'), table([t('Canal IPC', 'IPC channel'), t('Qué hace', 'What it does')], [
    ['nanuq:discover', t('Busca servidores Jellyfin por UDP.', 'Finds Jellyfin servers over UDP.')],
    ['nanuq:http', t('HTTP sin CORS, solo rutas de SomeDL, sin redirecciones, ≤ 4 MB.', 'HTTP without CORS, SomeDL routes only, no redirects, ≤ 4 MB.')],
    ['nanuq:sec (sync) · nanuq:secreset', t('Almacén cifrado: clave AES-256 aleatoria guardada con <code>safeStorage</code> (llavero / DPAPI).', 'Encrypted store: random AES-256 key saved with <code>safeStorage</code> (keyring / DPAPI).')],
    ['nanuq:discord', t('Rich Presence por el socket <code>discord-ipc-N</code> (solo sockets tuyos), con reintento mínimo y estado para Ajustes.', 'Rich Presence over the <code>discord-ipc-N</code> socket (only sockets you own), with a minimal retry and status for Settings.')],
    ['nanuq:party · nanuq:party-ev', t('Abrir/cerrar la sala y operarla (jump, order, played, now, tick, lyrics).', 'Open/close the room and run it (jump, order, played, now, tick, lyrics).')]])
    + t(`<ul><li>Todo canal IPC comprueba <code>fromApp(e)</code>: solo la página de nuestro origen puede pedirlo.</li>
<li>Ventana con <code>contextIsolation</code>, <code>sandbox</code> y sin Node; permisos solo notificaciones, pantalla completa y portapapeles.</li>
<li>Fusibles de Electron: sin <code>runAsNode</code> ni <code>NODE_OPTIONS</code>, integridad del asar y solo cargar desde el asar.</li>
<li>Las respuestas con el token en la URL no se guardan en la caché de disco (<code>no-store</code>).</li>
<li>Servidor local: solo GET/HEAD, <code>Host</code> 127.0.0.1/localhost (contra DNS rebinding), rutas ≤ 512 y sin bytes nulos.</li></ul>`, `<ul><li>Every IPC channel checks <code>fromApp(e)</code>: only the page from our origin can call it.</li>
<li>Window with <code>contextIsolation</code>, <code>sandbox</code> and no Node; permissions only for notifications, fullscreen and clipboard.</li>
<li>Electron fuses: no <code>runAsNode</code> or <code>NODE_OPTIONS</code>, asar integrity and load only from the asar.</li>
<li>Responses with the token in the URL aren't stored in the disk cache (<code>no-store</code>).</li>
<li>Local server: GET/HEAD only, <code>Host</code> 127.0.0.1/localhost (against DNS rebinding), paths ≤ 512 and no null bytes.</li></ul>`));

  add('seguridad', t('Seguridad', 'Security'), t('Lo que llega de afuera nunca se cree.', 'Nothing from outside is trusted.'), t(`
<ul><li><b>CSP</b> sin scripts en línea, sin <code>eval</code>, sin iframes ni <code>&lt;base&gt;</code>; solo atributos <code>style</code>.</li>
<li><b>JSON de afuera</b> con <code>jparse</code> (sin <code>toString</code>/<code>valueOf</code>/<code>__proto__</code>) y textos con <code>str()</code>: nunca <code>String(x)</code> sobre datos ajenos.</li>
<li><b>HTML</b>: todo dato pasa por <code>esc()</code>; los ids por <code>sid()</code> (solo letras, números y guiones) antes de ir a una ruta.</li>
<li><b>Letras</b> limpias de control y etiquetas (<code>cleanLyricsText</code>), ≤ 200 000 caracteres.</li>
<li><b>Puentes nativos</b> con lista blanca de rutas y topes de tamaño; nada de seguir redirecciones a otro servidor.</li>
<li><b>Datos personales</b> cifrados en disco; respaldo de Android desactivado (<code>allowBackup=false</code> y reglas de extracción).</li></ul>`, `
<ul><li><b>CSP</b> without inline scripts, without <code>eval</code>, iframes or <code>&lt;base&gt;</code>; only <code>style</code> attributes.</li>
<li><b>Outside JSON</b> through <code>jparse</code> (no <code>toString</code>/<code>valueOf</code>/<code>__proto__</code>) and texts through <code>str()</code>: never <code>String(x)</code> on foreign data.</li>
<li><b>HTML</b>: every value goes through <code>esc()</code>; ids through <code>sid()</code> (letters, digits and dashes only) before going into a path.</li>
<li><b>Lyrics</b> stripped of control characters and tags (<code>cleanLyricsText</code>), ≤ 200,000 characters.</li>
<li><b>Native bridges</b> with route allowlists and size limits; no following redirects to another server.</li>
<li><b>Personal data</b> encrypted on disk; Android backup disabled (<code>allowBackup=false</code> and extraction rules).</li></ul>`)
    + tip(t('El detalle completo (qué se protege y los límites conocidos) está en <code>SECURITY.md</code>.', 'The full detail (what is protected and known limits) is in <code>SECURITY.md</code>.'), 'invierno'));

  add('compilar', t('Compilar y publicar', 'Building and releasing'), t('Una orden para todas las plataformas.', 'One command for every platform.'), diagram(720, 230,
    box(250, 8, 220, 52, 'scripts/build.sh', t('patch | minor | major | x.y.z', 'patch | minor | major | x.y.z'), C.gray)
    + arrow(300, 60, 95, 104) + arrow(340, 60, 275, 104) + arrow(390, 60, 455, 104) + arrow(430, 60, 630, 104)
    + box(10, 106, 170, 60, 'android/build-apk.sh', t('Gradle + syncWeb, firma', 'Gradle + syncWeb, signing'), C.and)
    + box(190, 106, 170, 60, 'npm run dist', 'AppImage + RPM', C.desk)
    + box(370, 106, 170, 60, 'build-flatpak.sh', t('repositorio local firmado', 'signed local repo'), C.desk)
    + box(550, 106, 160, 60, 'npm run dist:win', t('NSIS (con Wine)', 'NSIS (with Wine)'), C.desk)
    + arrow(95, 166, 300, 192) + arrow(275, 166, 330, 192) + arrow(455, 166, 390, 192) + arrow(630, 166, 420, 192)
    + box(250, 192, 220, 34, 'dist/&lt;versión&gt;/', '', C.web),
    t('La versión vive en <code>web/app.js</code> (VERSION) y en <code>web/sw.js</code> (CACHE); el APK, el package.json y el Flatpak la toman de ahí.', 'The version lives in <code>web/app.js</code> (VERSION) and <code>web/sw.js</code> (CACHE); the APK, package.json and Flatpak take it from there.'))
    + t(`<ul><li><b>Versionado</b>: funciones nuevas suben el número menor; arreglos, el último. El <code>versionCode</code> del APK es M·10000 + m·100 + p.</li>
<li><b>Android</b> necesita JDK 21, el SDK y <code>android/keystore.properties</code>. Firmado con la misma llave siempre.</li>
<li><b>Linux</b>: el RPM usa el <code>fpm</code> del sistema (<code>USE_SYSTEM_FPM=true</code>). El Flatpak se arma con <code>linux-unpacked</code>.</li>
<li><b>Comprobar</b>: <code>node --check web/app.js</code> y, para interfaz, Chromium en modo demo.</li></ul>`, `<ul><li><b>Versioning</b>: new features bump the minor number; fixes, the last one. The APK <code>versionCode</code> is M·10000 + m·100 + p.</li>
<li><b>Android</b> needs JDK 21, the SDK and <code>android/keystore.properties</code>. Always signed with the same key.</li>
<li><b>Linux</b>: the RPM uses the system <code>fpm</code> (<code>USE_SYSTEM_FPM=true</code>). The Flatpak is built from <code>linux-unpacked</code>.</li>
<li><b>Checks</b>: <code>node --check web/app.js</code> and, for UI, Chromium in demo mode.</li></ul>`));

  add('trampas', t('Convenciones y trampas', 'Conventions and pitfalls'), t('Lo que conviene saber antes de cambiar algo.', 'What to know before changing anything.'), table([t('Regla', 'Rule'), t('Por qué', 'Why')], [
    [t('Cambios de interfaz solo en <code>web/</code>', 'UI changes only in <code>web/</code>'), t('Android y Linux la copian al compilar.', 'Android and Linux copy it at build time.')],
    [t('Todo texto visible en <code>tx(\'…\')</code> + su traducción en <code>EN</code>', 'Every visible text in <code>tx(\'…\')</code> + its <code>EN</code> translation'), t('Si no, sale en español con el idioma en inglés. Una frase completa por <code>tx</code>, sin pegar trozos.', 'Otherwise it shows in Spanish in English mode. One full sentence per <code>tx</code>, no gluing fragments.')],
    [t('Nada de <code>onclick=</code>, <code>&lt;script&gt;</code> ni <code>&lt;style&gt;</code> desde JS', 'No <code>onclick=</code>, <code>&lt;script&gt;</code> or <code>&lt;style&gt;</code> from JS'), t('La CSP los bloquea sin avisar.', 'The CSP blocks them silently.')],
    [t('Ids únicos en toda la app', 'Unique ids across the whole app'), t('Un id repetido escondió el cuadro de Buscar (1.30.2).', 'A duplicated id hid the Search box (1.30.2).')],
    [t('<code>view-transition-name</code> únicos', 'Unique <code>view-transition-name</code>'), t('Si se repiten, la transición se cancela sin error visible.', 'If repeated, the transition aborts with no visible error.')],
    [t('Animaciones sin fin solo en ráfagas (<code>nqBurst</code>)', 'Endless animations only in bursts (<code>nqBurst</code>)'), t('A 120 Hz cada una cuesta ≈ 1 núcleo del teléfono.', 'At 120 Hz each one costs ≈ 1 phone core.')],
    [t('Respetar <code>prefers-reduced-motion</code>', 'Respect <code>prefers-reduced-motion</code>'), t('Accesibilidad.', 'Accessibility.')],
    [t('Tras escribir en Jellyfin, mostrar lo local y confirmar después', 'After writing to Jellyfin, show the local copy and confirm later'), t('La lectura inmediata puede devolver lo viejo (letras, playlists, favoritas).', 'An immediate read may return stale data (lyrics, playlists, favorites).')],
    [t('<code>.ig-crowd</code> sin <code>z-index</code>', '<code>.ig-crowd</code> without <code>z-index</code>'), t('Crearía su propia capa y todos quedarían detrás del DJ.', 'It would create its own layer and everyone would end up behind the DJ.')]]));

  add('licencia', t('Licencia', 'License'), t('GPLv3 o posterior, archivo por archivo.', 'GPLv3 or later, file by file.'), t(`
<p class="lead">Nanuq es software libre bajo la <b>GNU General Public License, versión 3 o (a elección de quien lo reciba) cualquier versión posterior</b>: <code>GPL-3.0-or-later</code>. El texto completo está en <code>LICENSE</code>, en la raíz del repositorio.</p>
<h2>Qué significa para quien lo modifica</h2>
<ul><li>Puedes usar, estudiar, copiar y modificar el código para lo que quieras.</li>
<li>Si <b>distribuyes</b> Nanuq o una versión modificada (un APK, un paquete, la PWA en un servidor que otros descargan), debe ir bajo la misma licencia y con su código fuente (o una oferta para obtenerlo), con los avisos de copyright y de licencia intactos.</li>
<li>Una versión modificada debe decir que lo es. Para Android, usa otro <code>applicationId</code> y tu propia llave de firma: el APK oficial solo lo firma su autor (ver «Compilar y publicar»).</li>
<li>Se ofrece <b>sin ninguna garantía</b>.</li></ul>
<h2>Cómo está marcado el código</h2>
<p>Cada archivo fuente empieza con dos líneas en el formato de <b>SPDX</b> (el que usan las herramientas de licencias y la especificación REUSE):</p>
<p><code>SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq</code><br><code>SPDX-License-Identifier: GPL-3.0-or-later</code></p>
<p>Van como comentario del lenguaje de cada archivo (<code>//</code>, <code>/* */</code>, <code>&lt;!-- --&gt;</code> o <code>#</code>), después del <code>#!</code> en los scripts y del <code>&lt;!DOCTYPE&gt;</code> en el HTML. Al crear un archivo nuevo, agrégale las mismas dos líneas.</p>
<h2>Dónde más aparece</h2>`, `
<p class="lead">Nanuq is free software under the <b>GNU General Public License, version 3 or (at the recipient's option) any later version</b>: <code>GPL-3.0-or-later</code>. The full text is in <code>LICENSE</code>, at the root of the repository.</p>
<h2>What it means for whoever modifies it</h2>
<ul><li>You can use, study, copy and modify the code for any purpose.</li>
<li>If you <b>distribute</b> Nanuq or a modified version (an APK, a package, the PWA on a server others download from), it must go under the same license and with its source code (or an offer to get it), keeping the copyright and license notices.</li>
<li>A modified version must say it is one. For Android, use another <code>applicationId</code> and your own signing key: only the author signs the official APK (see “Building and releasing”).</li>
<li>It comes with <b>no warranty</b>.</li></ul>
<h2>How the code is marked</h2>
<p>Every source file starts with two lines in the <b>SPDX</b> format (the one used by license tools and the REUSE specification):</p>
<p><code>SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq</code><br><code>SPDX-License-Identifier: GPL-3.0-or-later</code></p>
<p>They go as a comment in each file's language (<code>//</code>, <code>/* */</code>, <code>&lt;!-- --&gt;</code> or <code>#</code>), after the <code>#!</code> in scripts and after the <code>&lt;!DOCTYPE&gt;</code> in HTML. When you create a new file, add the same two lines.</p>
<h2>Where else it shows up</h2>`)
    + table([t('Lugar', 'Place'), t('Cómo', 'How')], [
      ['<code>LICENSE</code>', t('Texto oficial de la GPLv3 (GitHub lo detecta y lo muestra en el repositorio).', 'Official GPLv3 text (GitHub detects it and shows it on the repository).')],
      ['README.md · README.en.md', t('Línea arriba, sección «Licencia» y enlace en el menú.', 'Line at the top, “License” section and a link in the menu.')],
      [t('Ajustes de la app', 'App settings'), t('Fila «Nanuq x.y.z»: la licencia y un enlace a <code>LICENSE</code> (se abre en el navegador).', '“Nanuq x.y.z” row: the license and a link to <code>LICENSE</code> (opens in the browser).')],
      ['linux/package.json', '<code>"license": "GPL-3.0-or-later"</code>'],
      [t('Flatpak (metainfo)', 'Flatpak (metainfo)'), '<code>&lt;project_license&gt;GPL-3.0-or-later&lt;/project_license&gt;</code>'],
      [t('Estos manuales', 'These manuals'), t('Portada y este capítulo.', 'Cover and this chapter.')]])
    + t('<h2>Lo que no es de Nanuq</h2>', '<h2>What isn\'t Nanuq\'s</h2>')
    + table([t('Componente', 'Component'), t('Licencia', 'License'), t('Dónde', 'Where')], [
      ['Electron', 'MIT', t('Dentro de las apps de escritorio (Linux y Windows).', 'Inside the desktop apps (Linux and Windows).')],
      ['Inter · Outfit', 'SIL Open Font License', t('Fuentes, cargadas de Google Fonts (no van en el repositorio).', 'Fonts, loaded from Google Fonts (not in the repository).')],
      ['Gradle wrapper', 'Apache 2.0', '<code>android/gradlew</code>'],
      ['Jellyfin', 'GPL-2.0', t('El servidor: un proyecto aparte con el que Nanuq habla por su API. Nanuq no está afiliado a él.', 'The server: a separate project Nanuq talks to through its API. Nanuq is not affiliated with it.')]]));

  // =================================================================================================================
  part('p2', t('Parte 2', 'Part 2'), t('Nivel profundo: cada función', 'Deep level: every function'), t(`Las ${totalFns} funciones y métodos del código, archivo por archivo, con la línea donde empiezan y qué hacen.`, `All ${totalFns} functions and methods in the code, file by file, with the line where they start and what they do.`), A.bear('uva'));

  // app.js por secciones (las de los comentarios /* ===== */ del propio archivo)
  const appRows = byFile.get('web/app.js') || [];
  const bounds = [{ line: 1, raw: '' }, ...heads];
  const appSubs = [], appHtml = bounds.map((b, k) => {
    const end = bounds[k + 1] ? bounds[k + 1].line : Infinity, rows = appRows.filter(r => r.line >= b.line && r.line < end);
    if (!rows.length) return '';
    const id = 'fa' + k, name = k ? secName(b.raw) : t('Base: ayudantes y almacén', 'Base: helpers and storage');
    appSubs.push([id, name]);
    return `<h3 class="file">${mk(id)}${name} <span class="badge">${t('desde la línea', 'from line')} ${b.line} · ${rows.length}</span></h3>${fnTable(rows)}`;
  }).join('');
  add('f-app', 'web/app.js', t(`${appRows.length} funciones, en el orden del archivo.`, `${appRows.length} functions, in file order.`), `<h3 class="file">web/app.js <span class="badge">${app.length.toLocaleString(L)} ${t('líneas', 'lines')}</span></h3>` + appHtml, appSubs);

  const groups = [
    ['f-web', t('Resto de la página', 'Rest of the page'), t('Idiomas y service worker.', 'Languages and service worker.'), ['web/i18n.js', 'web/sw.js']],
    ['f-android', 'Android', t('Java nativo y el puente de JavaScript.', 'Native Java and the JavaScript bridge.'), [...byFile.keys()].filter(f => f.startsWith('android/'))],
    ['f-desk', t('Escritorio', 'Desktop'), t('Electron y su empaquetado.', 'Electron and its packaging.'), [...byFile.keys()].filter(f => f.startsWith('linux/'))],
    ['f-scripts', t('Compilación', 'Build'), t('El script que compila todo.', 'The script that builds everything.'), [...byFile.keys()].filter(f => f.startsWith('scripts/'))]];
  for (const [id, title, lead, files] of groups) {
    const fl = files.filter(f => byFile.has(f));
    if (!fl.length) continue;
    const subs = fl.map((f, k) => [id + k, f]);
    add(id, title, lead, fl.map((f, k) => mk(id + k) + fileBlock(f)).join(''), subs);
  }

  return {
    kind: 'tech', file: 'technical_manual', pdfTitle: t('Nanuq · Manual técnico', 'Nanuq · Technical manual'), foot: t('Nanuq · Manual técnico', 'Nanuq · Technical manual'),
    title: t('Cómo está hecho Nanuq', 'How Nanuq is built'),
    subtitle: t('Arquitectura con diagramas, cada plataforma por dentro y, al final, cada función del código.', 'Architecture with diagrams, each platform inside out and, at the end, every function in the code.'),
    tocLead: t('La parte 1 explica el diseño; la parte 2 es la referencia de cada función.', 'Part 1 explains the design; part 2 is the reference for every function.'),
    backTitle: t('Hecho con cariño (y mucho hielo)', 'Made with care (and lots of ice)'), backText: t('Si cambias algo, recuerda: la interfaz vive en web/ y cada texto pasa por tx().', 'If you change something, remember: the interface lives in web/ and every text goes through tx().'),
    sections: S, toc: TOC, L
  };
};
