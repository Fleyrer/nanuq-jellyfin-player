// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Manual de usuario de Nanuq (español e inglés).
module.exports = h => {
  const { t, shot, tip, table, steps, A } = h;
  const S = [];
  const add = (id, title, lead, html) => S.push({ id, num: S.length + 1, ci: S.length, title, lead, html });

  add('bienvenida', t('Te presento a Nanuq', 'Meet Nanuq'), t('Un reproductor de música para tu servidor Jellyfin, con un oso polar que baila contigo.', 'A music player for your Jellyfin server, with a polar bear that dances with you.'), t(`
<p class="lead">Nanuq es una app para escuchar la música que guardas en tu servidor <b>Jellyfin</b>. Funciona en Android, en Linux, en Windows y en el navegador, en español o en inglés, sin anuncios ni cuentas extra.</p>
<p>Su mascota es <b>Nanuq</b>, un oso polar con audífonos: baila cuando empieza cada canción, se pone triste un momento cuando pausas, llena los huecos de la pantalla de inicio con escenas y recibe visitas de los Nanuqs de otros temas. Cada uno de los 18 temas le pone un disfraz distinto.</p>
<h2>Lo que puedes hacer</h2>
<ul><li><b>Escuchar tu biblioteca</b>: álbumes (armados con las etiquetas de tus canciones), artistas, géneros, playlists, favoritas y carpetas.</li>
<li><b>Letras sincronizadas</b> que avanzan con la canción, y buscarlas, pegarlas o sincronizarlas a mano.</li>
<li><b>DJ Nanuq</b>: una sesión infinita por rondas, presentada por Nanuq, que explora tu biblioteca.</li>
<li><b>Fiesta</b>: tu computadora abre una sala y tus amigos mandan canciones desde su teléfono.</li>
<li><b>Mis dispositivos</b>: controla un Nanuq desde otro o pasa la música de uno a otro.</li>
<li><b>Tu semana y Tu año con Nanuq</b>: tus resúmenes en video.</li>
<li>En el teléfono: <b>descargas</b> para escuchar sin datos y <b>lo que sigue guardado por adelantado</b>.</li></ul>
<h2>Lo que necesitas</h2>
<ul><li>Un servidor <b>Jellyfin</b> con tu música (10.9 o más nuevo para las letras; lo demás funciona desde 10.8).</li>
<li>Tu usuario y contraseña de Jellyfin.</li>
<li>Opcional: el plugin <b>Playback Reporting</b> (resúmenes exactos) y <b>SomeDL</b> (pedir canciones).</li></ul>
${tip('¿Todavía no tienes servidor? Toca <b>Probar el modo demo</b> en la pantalla de entrar: Nanuq trae una biblioteca de ejemplo con música hecha por él mismo.', 'navy')}`, `
<p class="lead">Nanuq is an app to listen to the music you keep on your <b>Jellyfin</b> server. It works on Android, Linux, Windows and in the browser, in English or Spanish, with no ads or extra accounts.</p>
<p>Its mascot is <b>Nanuq</b>, a polar bear with headphones: it dances when each song starts, gets sad for a moment when you pause, fills the gaps on the home screen with scenes and gets visits from the Nanuqs of other themes. Each of the 18 themes gives it a different costume.</p>
<h2>What you can do</h2>
<ul><li><b>Listen to your library</b>: albums (built from your songs' tags), artists, genres, playlists, favorites and folders.</li>
<li><b>Synced lyrics</b> that move with the song, and find, paste or sync them by hand.</li>
<li><b>DJ Nanuq</b>: an endless session in rounds, presented by Nanuq, that explores your library.</li>
<li><b>Party</b>: your computer opens a room and your friends send songs from their phones.</li>
<li><b>My devices</b>: control one Nanuq from another or send the music from one to another.</li>
<li><b>Your week and Your year with Nanuq</b>: your recaps on video.</li>
<li>On the phone: <b>downloads</b> to listen without data and <b>what's next saved ahead of time</b>.</li></ul>
<h2>What you need</h2>
<ul><li>A <b>Jellyfin</b> server with your music (10.9 or newer for lyrics; everything else works from 10.8).</li>
<li>Your Jellyfin username and password.</li>
<li>Optional: the <b>Playback Reporting</b> plugin (exact recaps) and <b>SomeDL</b> (requesting songs).</li></ul>
${tip("Don't have a server yet? Tap <b>Try demo mode</b> on the login screen: Nanuq comes with a sample library with music it made itself.", 'navy')}`));

  add('instalar', t('Instalar', 'Installing'), t('Elige tu plataforma: el mismo Nanuq en todas.', 'Pick your platform: the same Nanuq on all of them.'), t(`
<p>Descarga la última versión desde la página de <b>Releases</b> del proyecto.</p>
${table(['Plataforma', 'Archivo', 'Cómo instalar'], [
    ['Android 7+', '<code>nanuq-&lt;versión&gt;-release.apk</code>', 'Ábrelo en el teléfono y permite instalar apps de esa fuente.'],
    ['Windows', '<code>nanuq-&lt;versión&gt;-setup.exe</code>', 'Ábrelo y sigue el instalador. Si Windows dice «Windows protegió tu PC», toca <b>Más información → Ejecutar de todas formas</b> (aún no está firmado).'],
    ['Linux (Flatpak)', '<code>nanuq-&lt;versión&gt;.flatpak</code>', '<code>flatpak install nanuq-&lt;versión&gt;.flatpak</code>'],
    ['Linux (AppImage)', '<code>nanuq-&lt;versión&gt;-x86_64.AppImage</code>', '<code>chmod +x</code> y ábrelo.'],
    ['Fedora / Nobara', '<code>nanuq-&lt;versión&gt;-x86_64.rpm</code>', '<code>sudo dnf install ./nanuq-…rpm</code>'],
    ['Navegador', 'carpeta <code>web/</code>', 'Alójala en un servidor web por https (ver <code>web/LEEME.md</code>).']])}
<h2>Actualizar</h2>
<p>Instala la versión nueva encima de la anterior: tus datos se conservan. En Flatpak, instala el archivo nuevo desde la terminal con el mismo comando.</p>
<h2>Verificar el APK</h2>
<p>Todos los APK oficiales están firmados con el mismo certificado. Comprueba su huella SHA-256 con <code>apksigner verify --print-certs</code>; debe ser:</p>
<p><code style="font-size:7.4pt">9A:B9:59:A9:62:BD:DF:AA:1E:D3:0F:3B:2D:94:8D:55:F8:CB:54:41:B4:74:02:30:1E:EB:E7:9D:5A:74:D3:BD</code></p>
${tip('Si la huella no coincide, no lo instales: no es un Nanuq oficial.', 'chile', true)}`, `
<p>Download the latest version from the project's <b>Releases</b> page.</p>
${table(['Platform', 'File', 'How to install'], [
    ['Android 7+', '<code>nanuq-&lt;version&gt;-release.apk</code>', 'Open it on the phone and allow installing apps from that source.'],
    ['Windows', '<code>nanuq-&lt;version&gt;-setup.exe</code>', 'Open it and follow the installer. If Windows says “Windows protected your PC”, tap <b>More info → Run anyway</b> (it isn\'t signed yet).'],
    ['Linux (Flatpak)', '<code>nanuq-&lt;version&gt;.flatpak</code>', '<code>flatpak install nanuq-&lt;version&gt;.flatpak</code>'],
    ['Linux (AppImage)', '<code>nanuq-&lt;version&gt;-x86_64.AppImage</code>', '<code>chmod +x</code> and open it.'],
    ['Fedora / Nobara', '<code>nanuq-&lt;version&gt;-x86_64.rpm</code>', '<code>sudo dnf install ./nanuq-…rpm</code>'],
    ['Browser', '<code>web/</code> folder', 'Host it on a web server over https (see <code>web/LEEME.en.md</code>).']])}
<h2>Updating</h2>
<p>Install the new version over the old one: your data is kept. On Flatpak, install the new file from the terminal with the same command.</p>
<h2>Verifying the APK</h2>
<p>All official APKs are signed with the same certificate. Check its SHA-256 fingerprint with <code>apksigner verify --print-certs</code>; it must be:</p>
<p><code style="font-size:7.4pt">9A:B9:59:A9:62:BD:DF:AA:1E:D3:0F:3B:2D:94:8D:55:F8:CB:54:41:B4:74:02:30:1E:EB:E7:9D:5A:74:D3:BD</code></p>
${tip("If the fingerprint doesn't match, don't install it: it isn't an official Nanuq.", 'chile', true)}`));

  add('entrar', t('Primeros pasos', 'Getting started'), t('Conecta Nanuq con tu servidor.', 'Connect Nanuq to your server.'), t(`
${shot('login', 'La pantalla de entrar.')}
${steps(['Escribe la dirección de tu servidor: un nombre (<code>musica.ejemplo.com</code>), una IPv4 (<code>192.168.1.20</code>) o una IPv6 (<code>[2001:db8::10]</code>). Si no pones puerto, Nanuq usa el de Jellyfin (8096). Debajo verás la dirección final.',
    'En las apps, toca <b>Buscar servidores en mi red</b> para encontrar tu Jellyfin solo. Los servidores que ya usaste aparecen en <b>Servidores recientes</b>, con el tiempo que tardan en responder.',
    'Toca <b>Conectar</b>, escribe tu usuario y contraseña y toca <b>Entrar</b>.'])}
<p>Nanuq te saluda con su pantalla de bienvenida y te lleva a <b>Inicio</b>. Tu sesión queda guardada <b>cifrada</b> en el dispositivo: la próxima vez entras directo.</p>
${tip('Si el servidor está en internet por <code>http://</code>, Nanuq te avisa: tu contraseña viajaría sin protección. Usa <code>https://</code> o una VPN.', 'gato', true)}
<h2>Idioma</h2>
<p>Nanuq habla español e inglés. En <b>Ajustes → Idioma</b> eliges uno. En Android, mientras no elijas, usa el idioma del teléfono (y si no es ninguno de los dos, inglés). Al cambiarlo, la app se vuelve a abrir en ese idioma y la música queda en pausa en el mismo segundo.</p>`, `
${shot('login', 'The login screen.')}
${steps(['Type your server address: a name (<code>music.example.com</code>), an IPv4 (<code>192.168.1.20</code>) or an IPv6 (<code>[2001:db8::10]</code>). If you don\'t add a port, Nanuq uses Jellyfin\'s (8096). The final address shows below.',
    'In the apps, tap <b>Find servers on my network</b> to find your Jellyfin automatically. Servers you used before show up under <b>Recent servers</b>, with how long they take to answer.',
    'Tap <b>Connect</b>, type your username and password and tap <b>Log in</b>.'])}
<p>Nanuq greets you with its welcome screen and takes you <b>Home</b>. Your session is saved <b>encrypted</b> on the device: next time you go straight in.</p>
${tip('If the server is on the internet over <code>http://</code>, Nanuq warns you: your password would travel unprotected. Use <code>https://</code> or a VPN.', 'gato', true)}
<h2>Language</h2>
<p>Nanuq speaks English and Spanish. In <b>Settings → Language</b> you pick one. On Android, until you choose, it uses the phone's language (and if it's neither, English). When you change it, the app reopens in that language and the music stays paused at the same second.</p>`));

  add('inicio', t('La pantalla de inicio', 'The home screen'), t('Tus mezclas, el DJ y lo nuevo, de un vistazo.', 'Your mixes, the DJ and what\'s new, at a glance.'), t(`
${shot('home', 'Inicio en la computadora, con la cola a la derecha.')}
<ul><li><b>Tu música</b>: la tarjeta de <b>DJ Nanuq</b> y mezclas automáticas: más escuchadas, recién agregadas, escuchadas hace poco, favoritas, por descubrir y al azar. Toca una para ver sus canciones o su botón ▶ para que suene ya.</li>
<li><b>Según tu ánimo</b>: energía, relajado, concentración, fiesta, nostalgia y melancolía, armadas con los géneros de tu biblioteca.</li>
<li><b>Álbumes recién agregados</b>.</li>
<li>Los huecos se llenan con <b>escenas de Nanuq</b> (siesta, patinaje, pesca, aurora…). Tócalas: Nanuq reacciona. A veces llega de visita un Nanuq de otro tema.</li></ul>
<h2>Moverte por la app</h2>
<p>En la computadora usas la <b>barra lateral</b>; en el teléfono, las pestañas de abajo (Inicio, Canciones, Buscar, Cola y <b>Más</b>, donde está todo lo demás).</p>
${table(['Atajo', 'Qué hace'], [['<kbd>Espacio</kbd>', 'Reproducir / pausar'], ['<kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd>', 'Siguiente / anterior'], ['<kbd>/</kbd>', 'Ir a Buscar'], ['<kbd>Esc</kbd>', 'Atrás (cierra diálogos y el reproductor)'], ['<kbd>F11</kbd>', 'Pantalla completa (escritorio)']])}`, `
${shot('home', 'Home on the computer, with the queue on the right.')}
<ul><li><b>Your music</b>: the <b>DJ Nanuq</b> card and automatic mixes: most played, recently added, recently played, favorites, to discover and random. Tap one to see its songs or its ▶ button to play it right away.</li>
<li><b>For your mood</b>: energy, chill, focus, party, nostalgia and melancholy, built from your library's genres.</li>
<li><b>Recently added albums</b>.</li>
<li>Gaps are filled with <b>Nanuq scenes</b> (nap, skating, fishing, aurora…). Tap them: Nanuq reacts. Sometimes a Nanuq from another theme drops by.</li></ul>
<h2>Getting around</h2>
<p>On the computer you use the <b>sidebar</b>; on the phone, the tabs at the bottom (Home, Songs, Search, Queue and <b>More</b>, where everything else is).</p>
${table(['Shortcut', 'What it does'], [['<kbd>Space</kbd>', 'Play / pause'], ['<kbd>Shift</kbd> + <kbd>→</kbd> / <kbd>←</kbd>', 'Next / previous'], ['<kbd>/</kbd>', 'Go to Search'], ['<kbd>Esc</kbd>', 'Back (closes dialogs and the player)'], ['<kbd>F11</kbd>', 'Full screen (desktop)']])}`));

  add('reproducir', t('Reproducir música', 'Playing music'), t('El reproductor, la cola y todo lo que puedes hacer con una canción.', 'The player, the queue and everything you can do with a song.'), t(`
<p>Toca cualquier canción para que suene. Abajo aparece el reproductor; tócalo para abrir el <b>reproductor maximizado</b>, con la carátula, la forma de onda (arrástrala para adelantar), los controles, <b>mezclar</b> y el modo de <b>repetición</b> (una vez, repetir todo, repetir una).</p>
<h2>La cola</h2>
${shot('queue', 'El botón Cola cambia la portada por lo que sigue.')}
<ul><li>Toca una canción de la cola para ponerla ya.</li><li><b>Arrastra</b> desde la agarradera (≡) para cambiar el orden; cerca del borde, la lista se desplaza sola.</li>
<li>Clic derecho (computadora) o mantener presionado (teléfono): reproducir ahora, a continuación, radio, playlist, favorita, ir al álbum o al artista, quitar.</li><li><b>Guardar</b> convierte la cola en una playlist de tu Jellyfin.</li></ul>
<h2>Opciones de una canción</h2>
<ul><li><b>Iniciar radio</b>: canciones parecidas por artista, álbum y género.</li><li><b>Agregar a una playlist</b> (o crear una nueva).</li>
<li><b>Favorita</b> ♥: se guarda en Jellyfin y Nanuq lo comprueba con el servidor.</li><li><b>Ir al álbum / al artista</b>.</li></ul>
${tip('Al pausar, la música baja suave y al reanudar sube suave; eliges cuánto dura (de 0,5 a 5 s) en <b>Ajustes → Duración del desvanecido</b>. Si tocas ▶ mientras baja, vuelve a subir. Si prefieres que se detenga de golpe, apaga <b>Ajustes → Desvanecer al pausar</b>. Al arrastrar la barra de progreso, la canción queda en silencio y suena donde la sueltas.', 'leaf')}
<p>Nanuq recuerda la canción y el segundo en que ibas: si cierras la app, al volver toca ▶ y sigue donde estaba.</p>`, `
<p>Tap any song to play it. The player shows up at the bottom; tap it to open the <b>full-screen player</b>, with the cover, the waveform (drag it to seek), the controls, <b>shuffle</b> and the <b>repeat</b> mode (play once, repeat all, repeat one).</p>
<h2>The queue</h2>
${shot('queue', 'The Queue button swaps the cover for what\'s next.')}
<ul><li>Tap a song in the queue to play it now.</li><li><b>Drag</b> by the handle (≡) to change the order; near the edge, the list scrolls on its own.</li>
<li>Right-click (computer) or press and hold (phone): play now, play next, radio, playlist, favorite, go to album or artist, remove.</li><li><b>Save</b> turns the queue into a playlist in your Jellyfin.</li></ul>
<h2>Song options</h2>
<ul><li><b>Start song radio</b>: similar songs by artist, album and genre.</li><li><b>Add to a playlist</b> (or create a new one).</li>
<li><b>Favorite</b> ♥: saved in Jellyfin and Nanuq checks it with the server.</li><li><b>Go to album / artist</b>.</li></ul>
${tip('When you pause, the music fades out, and when you resume it fades in; choose how long (0.5 to 5 s) in <b>Settings → Fade length</b>. Tap ▶ while it fades out and it comes back up. If you\'d rather it stop instantly, turn off <b>Settings → Fade on pause</b>. While you drag the progress bar, the song stays silent and plays where you let go.', 'leaf')}
<p>Nanuq remembers the song and the second you were at: if you close the app, when you come back tap ▶ and it continues where it was.</p>`));

  add('letras', t('Letras', 'Lyrics'), t('La letra que sigue la canción, y cómo conseguirla.', 'Lyrics that follow the song, and how to get them.'), t(`
${shot('lyrics', 'La línea que suena se ilumina; las demás se apagan.')}
<p>Toca <b>Letra</b> en el reproductor. La línea que suena se ilumina y la letra avanza sola; toca una línea para saltar a ese momento. Jellyfin 10.9+ las lee de archivos <code>.lrc</code> junto a tus canciones o del plugin <b>LrcLib</b>.</p>
<h2>Si no hay letra</h2>
<ul><li><b>Buscar letra</b>: Nanuq la busca en LrcLib y eliges una versión.</li><li><b>Pegar letra</b>: pégala tú (si trae tiempos <code>[00:12.34]</code>, mejor).</li></ul>
<h2>Sincronizar a mano</h2>
${shot('sync', 'El editor: toca Marcar cuando empiece cada línea.')}
${steps(['Toca <b>Sincronizar</b> (o ⋮ → Sincronizar letra a mano).', 'Reproduce la canción y toca <b>Marcar</b> justo cuando empiece la línea resaltada (en la computadora, <kbd>Enter</kbd>).', 'Corrige con ↶ (deshacer) y −¼s / +¼s.', 'Toca <b>Guardar</b>: Nanuq sube un <code>.lrc</code> a tu Jellyfin.'])}
${tip('Para guardar letras en Jellyfin, tu usuario necesita el permiso <b>Permitir administrar letras</b> (Panel → Usuarios). Sin él, la letra se guarda solo en tu dispositivo.', 'synth')}`, `
${shot('lyrics', 'The playing line lights up; the others dim.')}
<p>Tap <b>Lyrics</b> in the player. The playing line lights up and the lyrics move on their own; tap a line to jump to that moment. Jellyfin 10.9+ reads them from <code>.lrc</code> files next to your songs or from the <b>LrcLib</b> plugin.</p>
<h2>If there are no lyrics</h2>
<ul><li><b>Find lyrics</b>: Nanuq searches LrcLib and you pick a version.</li><li><b>Paste lyrics</b>: paste them yourself (better if they have <code>[00:12.34]</code> timestamps).</li></ul>
<h2>Syncing by hand</h2>
${shot('sync', 'The editor: tap Mark when each line starts.')}
${steps(['Tap <b>Sync</b> (or ⋮ → Sync lyrics by hand).', 'Play the song and tap <b>Mark</b> right when the highlighted line starts (on a computer, <kbd>Enter</kbd>).', 'Fix it with ↶ (undo) and −¼s / +¼s.', 'Tap <b>Save</b>: Nanuq uploads an <code>.lrc</code> to your Jellyfin.'])}
${tip('To save lyrics in Jellyfin, your user needs the <b>Allow lyrics management</b> permission (Dashboard → Users). Without it, the lyrics are saved only on your device.', 'synth')}`));

  add('buscar', t('Buscar (también por la letra)', 'Search (also by lyrics)'), t('Encuentra una canción aunque solo recuerdes un pedazo de la letra.', 'Find a song even if you only remember a bit of the lyrics.'), t(`
${shot('search', 'Buscar «estrella polar»: álbumes y, abajo, «En las letras».')}
<p>Escribe al menos 2 letras: aparecen artistas, álbumes y canciones. Con 4 letras o más, además aparece <b>En las letras</b>: canciones cuya letra contiene lo que escribiste, con la línea resaltada (sin importar acentos ni mayúsculas).</p>
${tip('La primera vez, Nanuq lee las letras de tu biblioteca de a pocas (verás el avance) y arma su propio índice cifrado; después solo agrega las nuevas.', 'uva')}
<p>Las canciones se ven en lista o en cuadrícula (botones junto a «Canciones»).</p>`, `
${shot('search', 'Searching “estrella polar”: albums and, below, “In the lyrics”.')}
<p>Type at least 2 letters: artists, albums and songs show up. With 4 letters or more, <b>In the lyrics</b> also appears: songs whose lyrics contain what you typed, with the line highlighted (ignoring accents and capitals).</p>
${tip('The first time, Nanuq reads your library\'s lyrics a few at a time (you\'ll see the progress) and builds its own encrypted index; afterwards it only adds new ones.', 'uva')}
<p>Songs can be shown as a list or a grid (buttons next to “Songs”).</p>`));

  add('biblioteca', t('Tu biblioteca', 'Your library'), t('Álbumes, artistas, géneros, playlists, favoritas y carpetas.', 'Albums, artists, genres, playlists, favorites and folders.'), t(`
${shot('albums', 'Álbumes armados con las etiquetas de tus canciones.')}
<h2>Álbumes según tus canciones</h2>
<p>Jellyfin arma los álbumes por carpeta; Nanuq los arma con las <b>etiquetas de cada canción</b> (álbum y artista del álbum). Así, un disco repartido en dos carpetas sale junto, «(Disc 2)» se une a su disco y las canciones repetidas aparecen una sola vez.</p>
<h2>El resto</h2>
<ul><li><b>Artistas</b>: sus canciones (por álbum, A–Z o más escuchadas) y sus álbumes, más «Aparece en».</li>
<li><b>Géneros</b>, <b>Playlists</b> y <b>Carpetas</b> (como está organizado tu servidor).</li>
<li><b>Favoritas</b>: todo lo que marcaste con ♥, ordenable y siempre al día con Jellyfin, aunque la marques desde otra app.</li></ul>
${tip('¿Cambiaste etiquetas o agregaste música en el servidor? <b>Ajustes → Actualizar desde Jellyfin</b> vuelve a pedir todo (y, si eres administrador, le pide a Jellyfin que revise tus archivos).', 'cafe')}`, `
${shot('albums', 'Albums built from your songs\' tags.')}
<h2>Albums from your songs</h2>
<p>Jellyfin builds albums by folder; Nanuq builds them from <b>each song's tags</b> (album and album artist). That way, a record split across two folders shows up together, “(Disc 2)” joins its record and duplicate songs show up only once.</p>
<h2>Everything else</h2>
<ul><li><b>Artists</b>: their songs (by album, A–Z or most played) and their albums, plus “Appears on”.</li>
<li><b>Genres</b>, <b>Playlists</b> and <b>Folders</b> (how your server is organized).</li>
<li><b>Favorites</b>: everything you marked with ♥, sortable and always up to date with Jellyfin, even if you mark it from another app.</li></ul>
${tip('Changed tags or added music on the server? <b>Settings → Refresh from Jellyfin</b> asks for everything again (and, if you\'re an administrator, asks Jellyfin to scan your files).', 'cafe')}`));

  add('dj', 'DJ Nanuq', t('Tu música presentada como en la radio, sin IA.', 'Your music presented like on the radio, without AI.'), t(`
<div class="shots-row">${shot('dj-player', 'Con el DJ, la portada gira como un disco.')}${shot('dj', 'La pantalla del DJ y lo que sigue.')}</div>
<p>Toca la tarjeta <b>DJ Nanuq</b> en Inicio (o su ▶). Nanuq arma rondas de unas 5 canciones y presenta cada una:</p>
<ul><li><b>Por género</b> (Pop, Rock…) y <b>por década</b> (los 80, los 90…), según lo que hay en tu biblioteca.</li>
<li><b>Por descubrir</b> (lo que nunca has escuchado) y <b>olvidadas</b> (más de 45 días sin sonar).</li>
<li>De vez en cuando: algo según la hora, recién llegadas y favoritas.</li></ul>
<p><b>Cambiar de onda</b> salta a otra ronda; <b>Terminar</b> apaga el DJ y deja la cola. Si pasas la música a otro dispositivo, la sesión del DJ se va con ella.</p>
${tip('Con una voz del sistema instalada (escritorio), activa <b>Voz del DJ</b>: Nanuq lee sus presentaciones y baja la música mientras habla.', 'aurora')}
<p>Mientras arma la primera ronda verás a Nanuq en su tornamesa con frases como «Preparando mezclas…»; se quita en cuanto empieza a sonar. Entre canciones del DJ, una baja mientras la siguiente sube (<b>Ajustes → Transición entre canciones del DJ</b>: 3, 4 o 5 s, o apagada).</p>
<p>En <b>Ajustes → Animaciones del reproductor</b> eliges: Nanuq con su tornamesa, solo el disco de vinilo o la portada de siempre.</p>`, `
<div class="shots-row">${shot('dj-player', 'With the DJ, the cover spins like a record.')}${shot('dj', 'The DJ screen and what\'s next.')}</div>
<p>Tap the <b>DJ Nanuq</b> card on Home (or its ▶). Nanuq builds rounds of about 5 songs and introduces each one:</p>
<ul><li><b>By genre</b> (Pop, Rock…) and <b>by decade</b> (the 80s, the 90s…), according to what's in your library.</li>
<li><b>To discover</b> (what you've never heard) and <b>forgotten</b> (more than 45 days without playing).</li>
<li>Every now and then: something for the time of day, new arrivals and favorites.</li></ul>
<p><b>Change the vibe</b> jumps to another round; <b>End</b> turns the DJ off and keeps the queue. If you send the music to another device, the DJ session goes with it.</p>
${tip('With a system voice installed (desktop), turn on <b>DJ voice</b>: Nanuq reads its introductions and lowers the music while it talks.', 'aurora')}
<p>While it builds the first round you see Nanuq at the turntable with lines like “Preparing mixes…”; it goes away as soon as the music starts. Between DJ songs, one fades out while the next fades in (<b>Settings → Crossfade between DJ songs</b>: 3, 4 or 5 s, or off).</p>
<p>In <b>Settings → Player animations</b> you choose: Nanuq with its turntable, just the vinyl record or the usual cover.</p>`));

  add('resumen', t('Tu semana y Tu año', 'Your week and Your year'), t('Lo que escuchaste, en un video para compartir.', 'What you listened to, in a video to share.'), t(`
<div class="shots-row"><div class="shot" style="flex:.7">${'<img src="img/es-week.jpg">'}<div class="cap">Tu semana con Nanuq.</div></div><div style="flex:1.3">
<p><b>Ajustes → Tu semana con Nanuq → Crear</b>: un video de menos de un minuto sobre la semana pasada: minutos, días con música, tu canción de la semana con redoble, tus 5 más sonadas, el <b>podio</b> de tus artistas, tu hora favorita, descubrimientos y el <b>pronóstico musical</b>.</p>
<p>Del <b>1 al 7 de diciembre</b> aparece <b>Tu año con Nanuq</b> en Inicio, con tu <b>personalidad musical</b> (Nanuq se disfraza según tu género favorito).</p>
<p><b>Ver</b> lo reproduce; <b>Exportar video</b> lo graba en MP4 (en Android queda en <i>Películas › Nanuq</i> y se puede compartir). No cambies de app mientras graba.</p></div></div>
${tip('Con el plugin <b>Playback Reporting</b> en Jellyfin (y usuario administrador) los datos son exactos; si no, se usan los datos básicos de Jellyfin. Ajustes te dice cuál se usa.', 'invierno')}`, `
<div class="shots-row"><div class="shot" style="flex:.7">${'<img src="img/en-week.jpg">'}<div class="cap">Your week with Nanuq.</div></div><div style="flex:1.3">
<p><b>Settings → Your week with Nanuq → Create</b>: a video under a minute long about last week: minutes, days with music, your song of the week with a drumroll, your 5 most played, your artists' <b>podium</b>, your favorite hour, discoveries and the <b>music forecast</b>.</p>
<p>From <b>December 1st to 7th</b>, <b>Your year with Nanuq</b> shows up on Home, with your <b>music personality</b> (Nanuq dresses up according to your favorite genre).</p>
<p><b>View</b> plays it; <b>Export video</b> records it as MP4 (on Android it lands in <i>Movies › Nanuq</i> and can be shared). Don't switch apps while it records.</p></div></div>
${tip('With the <b>Playback Reporting</b> plugin in Jellyfin (and an administrator user) the data is exact; otherwise Jellyfin\'s basic data is used. Settings tells you which one.', 'invierno')}`));

  add('fiesta', t('Fiesta', 'Party'), t('Tu computadora pone la música; tus amigos la escogen desde su teléfono.', 'Your computer plays the music; your friends pick it from their phones.'), t(`
${shot('igloo', 'El iglú: DJ Nanuq al centro y un Nanuq por cada invitado.')}
<h2>En la computadora (anfitrión)</h2>
${steps(['Barra lateral → <b>Fiesta</b> → <b>Abrir la fiesta</b>. Aparece un <b>código de 6 dígitos</b>.', 'Mientras la sala está abierta, la computadora solo muestra la fiesta y tu música se detiene.', 'Pon el iglú en <b>pantalla completa</b> (ideal en una tele): abajo aparece <b>A continuación</b>; toca una canción para ponerla ya o arrástrala para cambiar el orden. Las flechas <kbd>↑</kbd> <kbd>↓</kbd> cambian el volumen.', '<b>Cerrar la fiesta</b> saca a todos y borra las canciones recibidas.'])}
<h2>En el teléfono (invitado)</h2>
<div class="shots-row">${shot('phone-party', 'Buscar fiestas en tu red.', 'phone')}<div style="flex:1.4">
${steps(['Conéctate a la <b>misma red Wi-Fi</b> que la computadora.', 'Más → <b>Fiesta</b> → <b>Buscar fiestas en mi red</b> (o escribe la dirección) y el código.', 'Busca en tus playlists, artistas, álbumes, canciones o letras y toca una canción para <b>mandarla</b>. Tu teléfono la baja de tu Jellyfin y se la pasa a la computadora, con su letra y carátula.', 'Canta: la letra aparece en tu teléfono y en el techo del iglú.'])}</div></div>
<p>Tu Nanuq aparece en el iglú con el disfraz de tu tema, y cuando suena tu canción, la levanta en alto. Si tu teléfono se duerme, sigues en la fiesta y vuelves a entrar solo. Solo <b>Salir</b> te saca.</p>
<p>Las canciones que llegan a la computadora se guardan en su disco <b>cifradas</b> y solo mientras están en la lista: se borran al sonar o al cerrar la fiesta, y ninguna otra app puede leerlas ni cambiarlas.</p>
${tip('Si los teléfonos no encuentran la sala, revisa el firewall de la computadora (TCP 47864 y UDP 47865) o escribe la dirección a mano.', 'pony', true)}`, `
${shot('igloo', 'The igloo: DJ Nanuq in the center and a Nanuq for each guest.')}
<h2>On the computer (host)</h2>
${steps(['Sidebar → <b>Party</b> → <b>Open the party</b>. A <b>6-digit code</b> shows up.', 'While the room is open, the computer only shows the party and your music stops.', 'Put the igloo in <b>full screen</b> (great on a TV): <b>Up next</b> appears at the bottom; tap a song to play it now or drag it to change the order. The <kbd>↑</kbd> <kbd>↓</kbd> arrows change the volume.', '<b>Close the party</b> removes everyone and deletes the received songs.'])}
<h2>On the phone (guest)</h2>
<div class="shots-row">${shot('phone-party', 'Find parties on your network.', 'phone')}<div style="flex:1.4">
${steps(['Connect to the <b>same Wi-Fi network</b> as the computer.', 'More → <b>Party</b> → <b>Find parties on my network</b> (or type the address) and the code.', 'Search your playlists, artists, albums, songs or lyrics and tap a song to <b>send it</b>. Your phone downloads it from your Jellyfin and passes it to the computer, with its lyrics and cover.', 'Sing: the lyrics show up on your phone and on the igloo\'s ceiling.'])}</div></div>
<p>Your Nanuq shows up in the igloo in your theme's costume, and when your song plays, it holds it up high. If your phone sleeps, you're still at the party and rejoin on your own. Only <b>Leave</b> takes you out.</p>
<p>Songs that reach the computer are stored on its disk <b>encrypted</b> and only while they're in the list: they're deleted when they play or when the party closes, and no other app can read or change them.</p>
${tip('If phones can\'t find the room, check the computer\'s firewall (TCP 47864 and UDP 47865) or type the address by hand.', 'pony', true)}`));

  add('dispositivos', t('Mis dispositivos', 'My devices'), t('Un Nanuq suena; los demás lo controlan.', 'One Nanuq plays; the others control it.'), t(`
<p>Si tienes Nanuq abierto en varios dispositivos con tu mismo usuario, toca el ícono de <b>dispositivos</b> en el reproductor:</p>
<ul><li><b>Pasar la música a…</b>: la cola sigue allá en el mismo segundo (con el DJ incluido).</li><li><b>Controlar…</b>: lo que suena allá se maneja desde aquí, con su letra, cola y controles del sistema.</li><li><b>Reproducir aquí</b>: trae la música de vuelta.</li></ul>
<p>Si al abrir Nanuq otro de tus dispositivos ya está sonando en tu red, se conecta solo. Ajustes → <b>Mis dispositivos</b> tiene los interruptores (sincronizar, solo en la misma red, aceptar órdenes de otros usuarios).</p>
${tip('Todo pasa por tu propio Jellyfin: no se abre ningún puerto en tus dispositivos. Por seguridad, solo tus dispositivos pueden ponerte canciones.', 'caribe')}`, `
<p>If you have Nanuq open on several devices with the same user, tap the <b>devices</b> icon in the player:</p>
<ul><li><b>Send the music to…</b>: the queue continues there at the same second (DJ included).</li><li><b>Control…</b>: what plays there is handled from here, with its lyrics, queue and system controls.</li><li><b>Play here</b>: brings the music back.</li></ul>
<p>If, when you open Nanuq, another of your devices is already playing on your network, it connects on its own. Settings → <b>My devices</b> has the switches (sync, only on the same network, accept commands from other users).</p>
${tip('Everything goes through your own Jellyfin: no ports are opened on your devices. For security, only your devices can play songs on yours.', 'caribe')}`));

  add('telefono', t('En el teléfono', 'On the phone'), t('Música en el bolsillo, con o sin datos.', 'Music in your pocket, with or without data.'), t(`
<div class="shots-row">${shot('phone-home', 'Inicio.', 'phone')}${shot('phone-player', 'Reproductor.', 'phone')}${shot('phone-more', 'Más.', 'phone')}</div>
<ul><li><b>Notificación y pantalla de bloqueo</b> con carátula y controles; los audífonos Bluetooth también. Al desconectar los audífonos, se pausa.</li>
<li><b>Descargas</b>: toca <b>Descargar</b> en el reproductor. Las canciones que escuchas 3 veces se guardan solas. En Ajustes → Descargas eliges el máximo, solo con Wi-Fi y la calidad. Sin conexión, Inicio te lleva a tus descargas.</li>
<li><b>Lo que sigue, guardado por adelantado</b> (Ajustes → Reproducción): el teléfono baja las próximas canciones de tu cola (10 minutos, ajustable) para que una red lenta no se note.</li>
<li><b>Atrás</b> cierra diálogos; en Inicio, manda la app al fondo sin cortar la música.</li></ul>
${tip('Nanuq cuida la batería: baila solo unos segundos al empezar cada canción y deja de animarse con la pantalla apagada.', 'abejita')}`, `
<div class="shots-row">${shot('phone-home', 'Home.', 'phone')}${shot('phone-player', 'Player.', 'phone')}${shot('phone-more', 'More.', 'phone')}</div>
<ul><li><b>Notification and lock screen</b> with cover and controls; Bluetooth headphones too. Unplugging the headphones pauses it.</li>
<li><b>Downloads</b>: tap <b>Download</b> in the player. Songs you play 3 times are saved automatically. In Settings → Downloads you choose the maximum, Wi-Fi only and the quality. Without a connection, Home takes you to your downloads.</li>
<li><b>What's next, saved ahead of time</b> (Settings → Playback): the phone downloads the next songs in your queue (10 minutes, adjustable) so a slow network goes unnoticed.</li>
<li><b>Back</b> closes dialogs; on Home, it sends the app to the background without stopping the music.</li></ul>
${tip('Nanuq takes care of the battery: it only dances for a few seconds when each song starts and stops animating with the screen off.', 'abejita')}`));

  add('solicitar', t('Solicitar canción', 'Request a song'), t('¿Te falta una canción? Pídela.', 'Missing a song? Request it.'), t(`
<p>Con <b>SomeDL</b> instalado en la computadora de tu Jellyfin, Nanuq le manda tus pedidos: SomeDL busca la canción en YouTube Music, le pone carátula, letra y datos, y la guarda en tu biblioteca. Nanuq te avisa cuando está lista.</p>
${steps(['En la computadora de Jellyfin: <code>pipx install somedl</code>, configura <code>output_dir</code> y <code>host = "0.0.0.0"</code>, y ábrelo con <code>somedl web</code>.', 'En Nanuq: Más → <b>Solicitar canción</b> → escribe la dirección (por ejemplo <code>192.168.1.20</code>) → <b>Conectar</b>.', 'Escribe <code>Artista - Canción</code> o pega un enlace de YouTube y toca <b>Solicitar</b>.'])}
${tip('SomeDL no tiene contraseña: úsalo solo en tu red o por VPN.', 'chile', true)}`, `
<p>With <b>SomeDL</b> installed on your Jellyfin computer, Nanuq sends it your requests: SomeDL finds the song on YouTube Music, adds the cover, lyrics and details, and saves it in your library. Nanuq tells you when it's ready.</p>
${steps(['On the Jellyfin computer: <code>pipx install somedl</code>, set <code>output_dir</code> and <code>host = "0.0.0.0"</code>, and start it with <code>somedl web</code>.', 'In Nanuq: More → <b>Request a song</b> → type the address (for example <code>192.168.1.20</code>) → <b>Connect</b>.', 'Type <code>Artist - Song</code> or paste a YouTube link and tap <b>Request</b>.'])}
${tip('SomeDL has no password: use it only on your network or over a VPN.', 'chile', true)}`));

  add('ajustes', t('Ajustes', 'Settings'), t('Todo lo que puedes ajustar, en un solo lugar.', 'Everything you can adjust, in one place.'), t(`
${shot('settings', 'Ajustes en la computadora.')}
${table(['Ajuste', 'Qué hace'], [
    ['Idioma', 'Español, inglés o (Android) el del sistema.'], ['Tema', '18 temas, cada uno con su Nanuq.'],
    ['Mostrar en Discord', 'Escritorio: «Escuchando Nanuq» en tu perfil. Si no aparece, la línea de estado dice por qué.'],
    ['Calidad del streaming', '96 kbps por omisión (menos datos), 128/192/320 kbps u Original (FLAC, Opus, AAC, MP3… tal cual). El reproductor maximizado la muestra entre los dos tiempos.'], ['Formato al convertir', 'Opus (mejor sonido) o MP3; también para las descargas.'], ['Guardar por adelantado', 'Android: cuántos minutos de la cola bajar antes.'],
    ['Animaciones del reproductor', 'Todas, solo el disco o ninguna.'], ['Desvanecer al pausar', 'Bajada y subida suave, de 0,5 a 5 s.'], ['Transición entre canciones del DJ', 'Apagada o 3/4/5 s: una canción baja mientras la otra sube.'], ['Forma de onda real', 'Dibuja la onda de cada canción (usa algo de datos).'],
    ['Descargas', 'Android: máximo, solo Wi-Fi, guardar las más escuchadas y calidad.'], ['Mis dispositivos', 'Sincronizar, solo misma red, órdenes de otros usuarios.'],
    ['Servidor', 'Salir, Actualizar desde Jellyfin, Tu semana, datos guardados y Probar conexión.']])}`, `
${shot('settings', 'Settings on the computer.')}
${table(['Setting', 'What it does'], [
    ['Language', 'Spanish, English or (Android) the system\'s.'], ['Theme', '18 themes, each with its Nanuq.'],
    ['Show on Discord', 'Desktop: “Listening to Nanuq” on your profile. If it doesn\'t show, the status line says why.'],
    ['Streaming quality', '96 kbps by default (less data), 128/192/320 kbps or Original (FLAC, Opus, AAC, MP3… as-is). The maximized player shows it between the two times.'], ['Conversion format', 'Opus (better sound) or MP3; also for downloads.'], ['Save ahead of time', 'Android: how many minutes of the queue to download early.'],
    ['Player animations', 'All, just the record or none.'], ['Fade on pause', 'Smooth fade out and in, 0.5 to 5 s.'], ['Crossfade between DJ songs', 'Off or 3/4/5 s: one song fades out as the next fades in.'], ['Real waveform', 'Draws each song\'s waveform (uses some data).'],
    ['Downloads', 'Android: maximum, Wi-Fi only, save the most played and quality.'], ['My devices', 'Sync, same network only, commands from other users.'],
    ['Server', 'Log out, Refresh from Jellyfin, Your week, saved data and Test connection.']])}`));

  add('temas', t('Temas', 'Themes'), t('18 temas, 18 Nanuqs.', '18 themes, 18 Nanuqs.'), t(`
${shot('themes', 'Ajustes → Tema: cada tema con su Nanuq.')}
<p>Cada tema cambia los colores de la app <b>y</b> el disfraz de Nanuq: audífonos (Marino), cuerno de unicornio (Pinky Pony), orejas de gato, uvas, taza de café, lentes de neón, chile, abejita, girasol, collar de flores, luna, sandía, gorro de invierno, chocolate y auroras.</p>
<div class="thgal">${Object.keys(A.BEAR_ACC).map(k => `<div class="thcard">${A.bear(k)}<div>${(A.THEMES[k] || {}).name || k}</div></div>`).join('')}</div>`, `
${shot('themes', 'Settings → Theme: each theme with its Nanuq.')}
<p>Each theme changes the app's colors <b>and</b> Nanuq's costume: headphones (Navy), unicorn horn (Pinky Pony), cat ears, grapes, coffee cup, neon glasses, chili, little bee, sunflower, flower necklace, moon, watermelon, winter hat, chocolate and auroras.</p>
<div class="thgal">${Object.keys(A.BEAR_ACC).map(k => `<div class="thcard">${A.bear(k)}<div>${(A.THEMES[k] || {}).name || k}</div></div>`).join('')}</div>`));

  add('privacidad', t('Privacidad y seguridad', 'Privacy and security'), t('Tu música, tus datos, tu servidor.', 'Your music, your data, your server.'), t(`
<ul><li>Nanuq solo habla con <b>tu</b> Jellyfin (y con SomeDL si lo configuras). Sin cuentas, sin analítica, sin anuncios. Lo único externo son las fuentes de Google Fonts.</li>
<li>Tu sesión, tu cola y todo lo que dice algo de ti se guardan <b>cifrados</b> (AES-256 con el llavero del sistema o el almacén de claves de Android). Si algo de lo guardado se alterara, Nanuq lo nota y no lo usa.</li>
<li>Revisado contra servidores y metadatos maliciosos, ataques de memoria y de denegación de servicio.</li>
<li><b>Cerrar sesión</b> revoca tu token y borra lo personal del dispositivo.</li></ul>
<h2>Software libre</h2>
<p>Nanuq es <b>software libre</b> bajo la <b>licencia GNU GPL versión 3 o posterior</b>: puedes usarlo, estudiarlo, compartirlo y modificarlo. Si compartes una versión modificada, tiene que llevar la misma licencia y su código fuente. Se ofrece sin ninguna garantía. Lo ves en <b>Ajustes → Nanuq</b> (al final), con el enlace al texto completo, y en el archivo <code>LICENSE</code> del proyecto.</p>
${tip('Los detalles técnicos están en <code>SECURITY.md</code> y en el manual técnico.', 'amoled')}`, `
<ul><li>Nanuq only talks to <b>your</b> Jellyfin (and to SomeDL if you set it up). No accounts, no analytics, no ads. The only external thing is the Google Fonts fonts.</li>
<li>Your session, your queue and anything that says something about you are stored <b>encrypted</b> (AES-256 with the system keyring or the Android keystore). If anything stored were altered, Nanuq notices and doesn't use it.</li>
<li>Reviewed against malicious servers and metadata, memory and denial-of-service attacks.</li>
<li><b>Logging out</b> revokes your token and deletes personal data from the device.</li></ul>
<h2>Free software</h2>
<p>Nanuq is <b>free software</b> under the <b>GNU GPL version 3 or later</b>: you can use, study, share and modify it. If you share a modified version, it must carry the same license and its source code. It comes with no warranty. You can see it in <b>Settings → Nanuq</b> (at the bottom), with a link to the full text, and in the project's <code>LICENSE</code> file.</p>
${tip('The technical details are in <code>SECURITY.en.md</code> and in the technical manual.', 'amoled')}`));

  add('problemas', t('Solución de problemas', 'Troubleshooting'), t('Cuando algo no sale como esperabas.', 'When something doesn\'t go as expected.'), t(table(['Si pasa esto…', 'Prueba esto'], [
    ['Una canción tarda en empezar', '<b>Ajustes → Probar conexión</b>: mide el servidor, la red y el reproductor y te dice qué falla. Prueba la calidad 320 kbps.'],
    ['«Tu sesión expiró»', 'Vuelve a entrar. Si usas un proxy con su propio inicio de sesión, entra en él.'],
    ['No veo mis cambios del servidor', '<b>Ajustes → Actualizar desde Jellyfin</b>.'],
    ['Discord no muestra nada', 'Mira la línea de estado en Ajustes: dice si no encontró Discord, si Windows no dejó conectarse (Discord como administrador) o si Discord lo rechazó.'],
    ['Los teléfonos no ven la fiesta', 'Misma red Wi-Fi, firewall (TCP 47864, UDP 47865) o escribe la dirección.'],
    ['Una favorita no se queda', 'Jellyfin 12 a veces la borra mientras suena: Nanuq la vuelve a guardar sola. Si persiste, márcala con la canción en pausa.'],
    ['«No se pudo abrir el almacén cifrado»', 'Desbloquea el llavero del sistema y vuelve a abrir Nanuq, o usa <b>Empezar de cero</b>.']])
    + tip('¿Algo más? Abre un issue en el proyecto. Si es un problema de seguridad, usa el reporte privado de GitHub.', 'navy'), table(['If this happens…', 'Try this'], [
    ['A song takes long to start', '<b>Settings → Test connection</b>: it measures the server, the network and the player and tells you what fails. Try 320 kbps quality.'],
    ['“Your session expired”', 'Log in again. If you use a proxy with its own login, log in to it.'],
    ['I don\'t see my server changes', '<b>Settings → Refresh from Jellyfin</b>.'],
    ['Discord shows nothing', 'Look at the status line in Settings: it says whether it didn\'t find Discord, whether Windows didn\'t allow the connection (Discord as administrator) or whether Discord rejected it.'],
    ['Phones can\'t see the party', 'Same Wi-Fi network, firewall (TCP 47864, UDP 47865) or type the address.'],
    ['A favorite doesn\'t stick', 'Jellyfin 12 sometimes deletes it while it plays: Nanuq saves it again on its own. If it persists, mark it with the song paused.'],
    ['“The encrypted store couldn\'t be opened”', 'Unlock the system keyring and open Nanuq again, or use <b>Start over</b>.']])
    + tip('Anything else? Open an issue in the project. If it\'s a security problem, use GitHub\'s private reporting.', 'navy')));

  const L = h.L;
  return {
    kind: 'user', file: 'user_manual', pdfTitle: t('Nanuq · Manual de usuario', 'Nanuq · User manual'), foot: t('Nanuq · Manual de usuario', 'Nanuq · User manual'),
    title: t('Todo lo que puedes hacer con Nanuq', 'Everything you can do with Nanuq'),
    subtitle: t('Tu música de Jellyfin, con un oso polar que baila contigo. Una guía paso a paso, con fotos de la app.', 'Your Jellyfin music, with a polar bear that dances with you. A step-by-step guide, with pictures of the app.'),
    tocLead: t('Empieza por donde quieras: cada capítulo se lee solo.', 'Start wherever you like: each chapter stands on its own.'),
    backTitle: t('¡Gracias por escuchar con Nanuq!', 'Thanks for listening with Nanuq!'), backText: t('Ahora sí: pon tu canción favorita y deja que Nanuq baile.', 'Now go: play your favorite song and let Nanuq dance.'),
    sections: S, toc: S.map(s => ({ id: s.id, title: s.title, desc: s.lead, ci: s.ci, num: s.num })), L
  };
};
