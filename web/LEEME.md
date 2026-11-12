<p align="right"><b>Español</b> · <a href="LEEME.en.md">English</a></p>

# Nanuq: cliente de música para Jellyfin (PWA)

Son los archivos estáticos de esta carpeta (`web/`): `index.html`, `i18n.js`, `app.js`, `app.css`, `manifest.webmanifest`, `sw.js` e `icons/`. No necesitas compilar nada: sube la carpeta `web/` tal cual.

Esta carpeta es también la **única fuente de la interfaz** de las apps de Android y Linux: al compilarlas se copia dentro de cada paquete.

## 1. Alojar la app

Para instalarse como app, Chrome exige que la página llegue por **HTTPS** (o desde `localhost`).

- **Junto a Jellyfin, con Caddy** (lo más sencillo si ya tienes dominio):
  ```
  musica.tudominio.com {
      root * /ruta/a/nanuq/web
      file_server
  }
  jellyfin.tudominio.com {
      reverse_proxy [::1]:8096
  }
  ```
  Caddy saca los certificados solo. Con un registro AAAA, todo funciona por IPv6.
- **GitHub Pages, Netlify o Cloudflare Pages**: publica la carpeta `web/` tal cual.

## 2. El servidor Jellyfin tiene que ir por HTTPS

Si Nanuq se abre por `https://`, el navegador bloquea las peticiones a un Jellyfin en `http://` (contenido mixto). Tienes dos opciones:

- Pon Jellyfin detrás de un proxy con HTTPS (como el ejemplo de arriba).
- O sirve Nanuq por `http://` dentro de tu red. Funciona como página, pero Android no la instalará como app completa.

## 3. Direcciones IPv6 aceptadas

| Escribes | Se conecta a |
|---|---|
| `2001:db8::10` | `http(s)://[2001:db8::10]:8096` (o `:8920` si la app va por https) |
| `[2001:db8::10]:8096` | esa dirección y ese puerto |
| `https://[2001:db8::10]/jellyfin` | respeta el esquema, el puerto y la ruta |
| `fd00::5` (ULA) | funciona igual |
| `fe80::1%wlan0` | ✗ los navegadores no admiten direcciones de enlace local con zona |

Debajo del campo verás en vivo la URL final que se va a usar.

## 4. Instalar en Android

Abre la dirección en Chrome → menú ⋮ → **Instalar app** (o **Añadir a pantalla de inicio**). Los controles de la pantalla de bloqueo y de los audífonos Bluetooth funcionan con la API Media Session.

## Idioma

**Ajustes → Idioma** cambia la interfaz entre **español** e **inglés**. En la app de Android, mientras no elijas uno, Nanuq usa el **idioma del teléfono** (si no es español ni inglés, inglés); la opción «Idioma del sistema» vuelve a ese modo. En escritorio y navegador el idioma por omisión es el español. Al cambiarlo, Nanuq se vuelve a abrir en ese idioma; la música queda en pausa en el mismo segundo. También cambian el DJ (sus presentaciones y, si la activas, su voz, que usa una voz en inglés del sistema), los videos de «Tu semana» y «Tu año» y la Fiesta. Lo que viene de tu biblioteca (títulos, artistas, letras) no se traduce. En Android, la notificación de reproducción sigue el idioma del teléfono.

Los textos están en español dentro de `app.js`, envueltos en `tx('…')`, y su traducción está en `i18n.js` (el texto en español es la clave). Lo que no tenga traducción se ve en español.

## Letras

El botón **Letra** (en la pantalla de reproducción o en la barra inferior en computadora) muestra la letra sincronizada y la resalta línea por línea; toca una línea para saltar a ese momento. Requiere Jellyfin 10.9 o más nuevo y letras disponibles:

- Archivos `.lrc` (sincronizadas) o `.txt` con el mismo nombre que la canción, en la misma carpeta, o
- El plugin **LrcLib**: Panel → Plugins → Catálogo → LrcLib, y luego vuelve a escanear la biblioteca.

### Sincronizar a mano

En la pantalla de letra, toca **Sincronizar** (o ⋮ → *Sincronizar letra a mano*). Reproduce la canción y toca **Marcar** justo cuando empiece cada línea. ↶ deshace la última marca, y −¼s / +¼s la ajustan. Al pulsar **Guardar**, Nanuq sube un `.lrc` a tu Jellyfin. La letra nueva se ve al instante: aunque Jellyfin tarde unos segundos en servirla, Nanuq muestra la que acabas de guardar hasta que el servidor la tenga. Si tu usuario no tiene permiso, la letra se guarda solo en ese teléfono. Para darle permiso: Panel → Usuarios → tu usuario → *Permitir administrar letras*.

También puedes ir a ⋮ → *Buscar otra letra (LrcLib)* para elegir una versión sincronizada, o a *Pegar o editar letra*.

## DJ Nanuq

En **Inicio → Tu música**, la tarjeta **DJ Nanuq** arma una sesión que no se acaba, como un DJ de radio, sin IA: solo reglas sobre tu biblioteca y tu historial de Jellyfin. La sesión va por rondas de unas 5 canciones. Lo principal son los temas y lo olvidado: Mientras arma la primera ronda verás a Nanuq en su tornamesa con frases como «Preparando mezclas…»; la pantalla se quita cuando empieza a sonar.

- **por género**: Pop, Rock, Pop Punk… cualquiera que tengas en la biblioteca, sin repetir los de hace poco
- **por década**: un viaje a los 70, los 80, etc., según los años que hay en tu biblioteca
- **por descubrir**: canciones que nunca has escuchado (de tus géneros o, si no hay, de toda tu biblioteca)
- **olvidadas**: las que no suenan desde hace más de 45 días (si tu historial es corto, esta ronda no sale)
- y de vez en cuando: según la hora del día, recién agregadas y tus favoritas

**El DJ explora tu biblioteca:** en cada ronda, lo nunca escuchado y lo olvidado va primero; lo que sonó en los últimos 3 días queda fuera si hay alternativas, y una ronda que solo podría ofrecer lo que ya escuchaste estas semanas se salta y toca otra. **Lo que más escuchas** y **lo de estos días** salen muy poco. Además recuerda lo que puso en sus últimas sesiones para no repetirlo.

Antes de cada ronda, Nanuq la presenta con los artistas que vienen. **Cambiar de onda** salta a otra ronda, y cuando la cola se va acabando, agrega la siguiente sola. No repite canciones dentro de una misma sesión. Si pones otro álbum o playlist, el DJ se detiene y la cola queda como está.

Con el DJ activo, el **reproductor maximizado** cambia la carátula por una escena: la portada de la canción es la funda de un disco cuyo vinilo gira con la música y Nanuq la presenta con su tornamesa. Al pasar a la siguiente, la funda sale por la izquierda y la nueva entra por la derecha; con la anterior, al revés; si saltas a otra canción, la nueva cae desde arriba. Las presentaciones aparecen ahí en un globo de diálogo.

**El DJ entre tus dispositivos:** si pasas la música a otro Nanuq desde **Mis dispositivos** con el DJ sonando, la sesión se va con ella: allá sigue las mismas rondas (y agrega las siguientes), y el dispositivo desde el que controlas muestra la escena del DJ, la ronda y su presentación. Si eliges otra canción allá, aquí se ve al momento. También puedes empezar el DJ desde un dispositivo que está controlando a otro: suena allá. Con **Reproducir aquí**, la sesión vuelve contigo. Necesita «Sincronizar con mis otros dispositivos» activado y Nanuq 1.30.7 o más nuevo en ambos lados.

Si tu sistema tiene una voz en español (Chrome y Electron con voces instaladas), aparece la opción **Voz del DJ**: Nanuq lee la presentación y baja la música mientras habla. Viene apagada. En Android, el WebView no tiene voces, así que la presentación solo se muestra como texto.

## Tu año con Nanuq

Del **1 al 7 de diciembre**, en **Inicio → Tu música** (o en **Más**) aparece tu resumen del año en curso en video, presentado por los Nanuqs: los minutos que escuchaste (y cuántos km habría caminado un oso polar en ese tiempo), tu artista del año con redoble de tambor, tus artistas y canciones favoritas, tu **personalidad musical** (Nanuq se cambia de disfraz según tu género favorito), a qué hora escuchas más, tu racha de días y la canción que más repetiste. Dura unos 50 segundos, con música hecha por Nanuq (no usa tus canciones).

- **Ver** lo reproduce en la app. **Exportar video** lo graba en MP4 (o WebM si el dispositivo no puede MP4): en Android se guarda en *Películas › Nanuq* y se puede compartir; en Linux y en el navegador se descarga. Mientras se graba, no cambies de app.
- Los datos son **de tu usuario en tu servidor Jellyfin**, de todas tus apps y dispositivos. Si en Jellyfin tienes el plugin **Playback Reporting** y tu usuario es administrador, los resúmenes son exactos: cada reproducción con los minutos realmente escuchados (cuenta si duró 30 segundos o más). Si no, se usan los datos básicos que Jellyfin guarda de tu usuario (la última vez que sonó cada canción y su total de reproducciones), que son aproximados. **Ajustes → Datos de tus resúmenes** dice cuál se está usando.
- Los videos exportados no van cifrados: son para compartir.

### Tu semana con Nanuq

En **Ajustes → Tu semana con Nanuq** puedes crear un video de menos de un minuto con la semana pasada (de lunes a domingo): minutos escuchados, cuántos días tuvieron música y tu día más musical, un redoble para tu canción de la semana, tus 5 canciones más sonadas, **el podio de tus artistas** con tres Nanuqs, tu hora favorita, tus descubrimientos y el **pronóstico musical de tu semana** (por ejemplo, «Tormenta eléctrica de guitarras» o «Arcoíris pegajoso»). Se ve y se exporta igual que el resumen del año.

## Solicitar canción (SomeDL)

En **Más → Solicitar canción** (o en la barra lateral, en computadora) puedes pedir una canción que no tienes. [SomeDL](https://github.com/ChemistryGull/SomeDL) la busca en YouTube Music, le pone carátula, letra y datos, y la guarda en la carpeta de tu biblioteca. Nanuq sigue el avance y te avisa cuando termina, con una notificación del sistema si la app no está a la vista.

1. En la computadora de Jellyfin: `pipx install somedl` (necesita Python 3.10 o más nuevo y FFmpeg).
2. Ejecuta `somedl --generate-config` y edita `somedl_config.toml`:
   - `[download]` → `output_dir = "/ruta/a/tu/musica"` (la carpeta de la biblioteca de Jellyfin)
   - `[webui]` → `host = "0.0.0.0"` (si no, solo acepta conexiones desde esa misma computadora) y `open_browser = false`
3. Ábrelo con `somedl web` (puerto 5000). En Nanuq escribe la dirección, por ejemplo `192.168.1.20` (se completa con `:5000`).
4. Para que las canciones aparezcan solas, activa en Jellyfin el *monitoreo en tiempo real* de la biblioteca de música. Si tu usuario es administrador, Nanuq además le pide a Jellyfin que vuelva a escanear al terminar cada descarga.

Escribe `Artista - Canción` o pega un enlace de YouTube o YouTube Music (un enlace de playlist pide todas sus canciones). Si una falla, toca **Reintentar**. Los pedidos se guardan en el dispositivo: si cierras Nanuq, al volver sigue revisándolos. SomeDL guarda su historial en memoria, así que si se reinicia mientras una canción estaba pendiente, Nanuq la marca como perdida.

**SomeDL no tiene contraseña**, y su página permite cambiar su configuración. No lo publiques en internet: úsalo en tu red o por VPN.

**En el navegador:** el servidor de SomeDL no acepta peticiones de otras páginas (CORS), así que la PWA solo puede usarlo detrás de un proxy que agregue esos permisos. La app de Android y la de Linux se conectan directo, sin proxy. Con Caddy, dentro de tu red:

```
somedl.tudominio.com {
    @preflight method OPTIONS
    header Access-Control-Allow-Origin "https://musica.tudominio.com"
    header Access-Control-Allow-Headers "Content-Type"
    header Access-Control-Allow-Methods "GET, POST, OPTIONS"
    respond @preflight 204
    reverse_proxy 127.0.0.1:5000
}
```

## Fiesta (Nanuq watch party)

Tu computadora (la app de Linux o Windows) abre una sala y tus amigos se unen desde su teléfono con la app de Nanuq para Android, conectados a la **misma red Wi-Fi**. Cada quien manda canciones de **su propio** Jellyfin: su teléfono la baja de su servidor y se la pasa a la computadora por la red local, que las pone una tras otra.

- **En la computadora:** barra lateral → **Fiesta** → *Abrir la fiesta*. Mientras la sala está abierta, la computadora solo muestra la fiesta: el menú lateral, la cola y el reproductor se ocultan y tu música se **detiene** (sin controles en la barra de tareas ni forma de reanudarla fuera de la fiesta); al cerrarla vuelve todo, con tu cola lista para seguir donde iba. Aparece un **código de 6 dígitos** y la dirección de la sala. Desde ahí ves quién está, la lista, lo que suena con su letra (karaoke) y puedes pausar, saltar o quitar canciones (solo la computadora quita canciones; los invitados no). *Otro código* invalida el anterior (los que ya entraron siguen). *Cerrar la fiesta* saca a todos y borra las canciones que llegaron.
- **En el teléfono:** Más → **Fiesta** → *Buscar fiestas en mi red* (o escribe la dirección que muestra la computadora) y el código. Mientras estás en la fiesta, la app solo muestra la fiesta (sin la barra de abajo, el reproductor minimizado ni el botón de regresar, y tu música se pausa); vuelven al tocar **Salir**. Debajo de lo que suena y su letra está el buscador: tus playlists (también sin escribir nada), artistas, álbumes y canciones de tu biblioteca; toca una playlist, un artista o un álbum para ver sus canciones y toca una canción para mandarla.
- **Si el teléfono se duerme o se bloquea** (o pierde el Wi-Fi), sigues en la fiesta: tu Nanuq se queda bailando en el iglú (en la lista dice «ausente») y, al despertar el teléfono, vuelve a entrar solo, sin el código (aunque Android haya cerrado la app). Solo **Salir** te saca. Si pasan 2 horas sin volver, la computadora libera tu lugar. Si al despertar la fiesta ya no existe (la computadora la cerró o se apagó mientras tu teléfono dormía), tu teléfono lo intenta unos segundos y sale con un aviso. Si la tienes descargada, sale del teléfono sin gastar datos; si no, tu teléfono la pide a tu Jellyfin en MP3 320 kbps. La letra (si tu Jellyfin la tiene) y una miniatura de la carátula viajan con ella: cada segundo, la computadora le dice a todos los teléfonos en qué segundo va y qué línea toca.
- **El iglú:** en la computadora, la fiesta se ve como el interior de un iglú: DJ Nanuq al centro y, alrededor, un Nanuq por cada invitado con el disfraz de **su** tema y su nombre debajo (cuando suena la canción que escogió, su nombre toma el color de su tema y su Nanuq levanta la carátula con las dos manos —y lo que traía en ellas, como la taza o las uvas, va encima de la carátula—, crece un poco y brinca más feliz entre destellos); llegan y se van con una transición suave. Mientras suena, el DJ toca, los Nanuqs bailan, hay luces de fiesta y la letra se proyecta en el techo; en la esquina de abajo a la derecha está la canción que suena como en el DJ del reproductor: su carátula en la funda y el disco de vinilo saliendo de ella, girando (cada canción nueva entra cayendo); en pausa, todos descansan. El botón de la esquina lo pone en pantalla completa (ideal para una tele): ahí, al pie, aparece **A continuación**, una fila con lo que sigue en la lista (la más próxima a la izquierda), cada una con su carátula, nombre y álbum, y abajo quién la escogió (con el color del tema de su Nanuq); encima de la fila, siempre a la vista, el **código para entrar** (la dirección IP no se muestra: si un teléfono no encuentra la sala, pasa el mouse sobre el código en la tarjeta de la fiesta para verla). Toca una canción de la fila para ponerla ya (la que sonaba y las que iban antes se saltan y se quitan de la lista); arrástrala para cambiar el orden (con el dedo: mantenla presionada y muévela); recorre la fila con la rueda del mouse o deslizando el dedo. El puntero del mouse se esconde si no lo mueves en unos segundos. Solo se anima mientras lo estás viendo.
- **Controles en la computadora:** mientras suena (o está en pausa) una canción de la fiesta, la barra espaciadora, los botones de reproducir, siguiente y anterior, el volumen, el silencio y los controles del sistema (panel de GNOME/KDE, teclas multimedia, barra de tareas) manejan **la fiesta**, y los controles del sistema muestran su canción. Si pones tu propia música, la fiesta se pausa y los controles vuelven a tu cola hasta que reanudes la fiesta.
- **Volumen a pantalla completa:** con el iglú a pantalla completa, las flechas **↑** y **↓** suben y bajan el volumen de 5 en 5 % y arriba aparece un aviso con el porcentaje (con la sala abierta, la barra de volumen del reproductor está oculta). Fuera de la pantalla completa, las flechas no cambian el volumen.
- Las canciones solo se guardan un rato en la computadora: se borran al sonar, si llevan más de 2 horas en la lista, al quitarlas o al cerrar la sala. Como mucho 10 canciones por invitado, 60 en la lista y 80 MB por canción.
- Mientras la sala está abierta, la computadora escucha en tu red local (TCP 47864 y UDP 47865). Detalles de seguridad en [SECURITY.md](../SECURITY.md).

## Buscar por la letra

¿No sabes cómo se llama, pero te sabes un pedazo de la letra? Escríbelo en **Buscar** (al menos 4 letras): además de artistas, álbumes y canciones aparece **En las letras**, con la línea que coincide resaltada (sin importar acentos, mayúsculas ni signos). También funciona en el buscador de la Fiesta del teléfono.

Jellyfin no busca dentro de las letras, así que Nanuq arma su propio índice: la primera vez lee la letra de cada canción que Jellyfin marca con letra (de a pocas, para no cargar tu servidor; verás el avance) y después solo agrega las nuevas. El índice se guarda cifrado en tu dispositivo y se borra al cerrar sesión.

## Actualizar desde Jellyfin

**Ajustes → Servidor → Actualizar desde Jellyfin** vuelve a pedir a tu servidor los datos de tu biblioteca (álbumes, canciones, carátulas, favoritas y las canciones de tu cola), por si cambiaste algo en Jellyfin y Nanuq todavía muestra lo anterior. Si tu usuario es administrador, además le pide a Jellyfin que revise tus archivos y, medio minuto después, vuelve a traer lo que haya cambiado.

## Desvanecer al pausar

Al pausar, la música baja suave antes de detenerse; al reanudar, sube suave. Funciona con el botón, el teclado, la notificación y los controles de tus otros dispositivos, también con la pantalla apagada. Dura de 0,5 a 5 s (**Ajustes → Duración del desvanecido**, 1 s por omisión); al tocar ▶ mientras baja, vuelve a subir y la curva va en decibelios, como la oye el oído. Se apaga en **Ajustes → Desvanecer al pausar**.

## Transición entre canciones del DJ

Con DJ Nanuq, en los últimos segundos de una canción la siguiente ya empieza: la que termina baja mientras la nueva sube (curva de potencia constante, sin hueco a la mitad). Se elige en **Ajustes → Transición entre canciones del DJ**: 3, 4 (por omisión) o 5 s, o apagada. No se hace con «Repetir una», al controlar otro dispositivo, en la fiesta ni mientras sincronizas una letra.

## Formatos y calidad

Por omisión Nanuq pide la calidad más baja, **96 kbps** (gasta menos datos; en Opus suena bien), y el reproductor maximizado dice cómo llega cada canción entre los dos tiempos (p. ej. «Opus · 96 kbps», «Original» o «En el teléfono»). Cámbiala en **Ajustes → Calidad del streaming**. Con calidad **Original**, tus archivos suenan tal cual: FLAC, Opus, AAC/M4A, MP3, WAV, OGG. Si eliges un bitrate menor (o el archivo lo supera), Jellyfin lo convierte a **Opus** (mejor sonido que MP3 con el mismo bitrate) o a MP3: **Ajustes → Formato al convertir** (solo aparece si tu reproductor abre Opus). Si una canción no arranca en Opus, Nanuq la pide en MP3 y lo recuerda. Las descargas del teléfono se guardan en ese mismo formato (o el archivo tal cual con «Original»). Mientras arrastras la barra de progreso, la canción queda en silencio y vuelve a sonar donde la sueltas.

## Cola en el reproductor

En el reproductor maximizado, el botón **Cola** cambia la portada por la lista de lo que sigue (con la misma transición que la letra; en pantallas anchas, la portada queda a la izquierda). Toca una canción para reproducirla; con clic derecho o manteniendo presionado tienes sus opciones. Letra y Cola se alternan.

**Mover canciones:** arrástralas desde su agarradera (≡, a la derecha de cada canción), con el mouse o con el dedo, en la cola del reproductor, en el panel de la cola o en la pestaña **Cola**. Las demás se corren para mostrar dónde quedará y, cerca del borde, la lista se desplaza sola. La que suena sigue sonando. Si estás controlando otro dispositivo, su cola cambia igual (allá sigue en el mismo segundo; con el DJ, sigue siendo el DJ).

## Álbumes según tus canciones

Jellyfin arma los álbumes por carpeta: si muchas canciones viven en la misma carpeta (por ejemplo, las que baja SomeDL), aparecen como un solo álbum gigante, y un disco repartido en dos carpetas sale partido. Nanuq los arma con las **etiquetas de cada canción**: el álbum y su artista del álbum (o el primer artista). Así, en **Álbumes**, en Inicio, en cada artista («Álbumes» y «Aparece en»), en los géneros y en Buscar ves los discos reales. «Álbum (Disc 2)» o «(CD 2)» se juntan con su disco, y si tienes el mismo disco dos veces, cada canción aparece una sola vez (la copia que más escuchaste). «Ir al álbum» desde una canción abre su disco.

La primera vez Nanuq lee todas tus canciones (unos segundos); después el índice se guarda cifrado en el dispositivo, aparece al instante y se renueva solo cada 10 minutos. **Reintentar** o una canción nueva de SomeDL lo renuevan antes. Las **Carpetas** siguen mostrando cómo está organizado tu servidor.

## Nanuq cuida la batería

Nanuq baila unos segundos cada vez que empieza una canción y luego se queda contento y quieto; las escenas de Inicio se mueven al llegar o al tocarlas. El DJ y su disco se mueven todo el tiempo **mientras los estás viendo** (el reproductor abierto con el DJ o la pantalla del DJ; en pausa, Nanuq sigue parpadeando y respirando) y se detienen cuando dejan de estar en pantalla: en el teléfono con la letra o la cola encima (en la computadora van al lado y el DJ sigue moviéndose), con el reproductor minimizado o en otra sección, con la pantalla apagada o bloqueada, o con Nanuq en segundo plano. Al volver, siguen.

**Ajustes → Animaciones del reproductor** elige qué muestra el reproductor con el DJ: **Todas** (Nanuq con su tornamesa y el disco girando), **Solo el disco de vinilo** (sin Nanuq) o **Ninguna** (la portada de siempre; las presentaciones del DJ llegan como aviso). En teléfonos con pantalla de 120 Hz, una animación que no para obliga a dibujar 120 cuadros por segundo: medido en un teléfono Android de gama media, con la música sonando Nanuq pasó de usar entre 1.7 y 3 núcleos del procesador a 0.6 (casi lo mismo que reproducir audio), y en pausa a casi nada. Así el teléfono no se calienta ni baja su velocidad.

## Opciones de una canción

En **⋮** del reproductor maximizado, en el menú de cualquier canción de una lista, y en la **cola** (clic derecho en computadora, mantener presionado en el teléfono):

- **Iniciar radio de la canción**: usa la mezcla instantánea de Jellyfin, con canciones parecidas por artista, álbum y género. Si esa canción ya está sonando, no se corta: la cola se vuelve su radio.
- **Agregar a una playlist**: elige una de tus playlists o crea una nueva.
- **Agregar a favoritas / Quitar de favoritas**: se guarda en Jellyfin y Nanuq lo comprueba leyéndolo de vuelta del servidor. Si Jellyfin no lo guardó, te avisa.
- En la cola, además: reproducir ahora, reproducir a continuación y quitar de la cola.

Al agregar una canción a una playlist (o crear una nueva), la playlist que tengas abierta se actualiza sola, sin recargar.

## Favoritas

En **Más → Favoritas** (o en la barra lateral, en computadora) están todas las canciones que marcaste con ♥.

La lista sale de las favoritas que Jellyfin tiene marcadas con ♥ (la misma fuente que el botón del reproductor, así nunca se contradicen). Si en tu Jellyfin tienes el plugin [Favorited Songs Playlist](https://github.com/Saturn745/jellyfin-favorited-songs-playlist), arriba aparece un enlace a **tu** playlist de favoritas (por omisión «Usuario's: Favorited Songs»); no se usa como fuente porque puede quedar atrasada. Al marcar o quitar una, la lista cambia al momento. Puedes ordenarlas por título, artista, álbum, añadidas recientemente, escuchadas hace poco o más escuchadas, y reproducirlas en orden, en aleatorio o mandarlas a la cola. Si quitas una favorita, desaparece de la lista al momento.

Las favoritas se guardan en Jellyfin, con tu usuario: se ven en todos tus dispositivos y en cualquier otra app de Jellyfin. Cada vez que entras a la sección, Nanuq muestra al instante la última lista y la confirma con Jellyfin. Si alguien marca o quita una favorita en otro dispositivo u otra app con tu usuario, la sección se actualiza sola mientras la ves (con «Sincronizar con mis otros dispositivos» activado en Ajustes, que viene encendido).

## Controlar otro dispositivo

Por seguridad, cada Nanuq solo acepta que le pongan canciones desde dispositivos de **tu mismo usuario**. Si quieres que otro usuario de tu Jellyfin (por ejemplo, un administrador) pueda hacerlo, activa **Ajustes → Aceptar órdenes de otros usuarios**. La lista de **Mis dispositivos** muestra la dirección de cada uno: si ves uno que no reconoces, cambia tu contraseña.

Cuando pasas la música a otro dispositivo (o controlas lo que suena en él) desde **Mis dispositivos**, los controles del sistema siguen ahí: la barra de tareas o el panel de GNOME/KDE, las teclas multimedia del teclado y la pantalla de bloqueo muestran la canción que suena en el otro dispositivo y sus botones la controlan. Para que el sistema los mantenga, Nanuq reproduce un audio en silencio mientras dura el control remoto (no gasta datos).

## Notas

- El tema (Marino, Oscuro, Claro), la calidad, la cola y la sesión se guardan en el teléfono.
- **Guardar** en la cola crea una playlist en tu Jellyfin.
- La forma de onda real está apagada por defecto porque descarga una copia ligera de cada canción. Actívala en Ajustes.
