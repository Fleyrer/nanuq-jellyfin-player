<p align="right"><b>Español</b> · <a href="LEEME.en.md">English</a></p>

# Nanuq para Linux y Windows

La misma PWA de `../web/` en una ventana de Electron. Al compilar se copian `index.html`, `i18n.js`, `app.js`, `app.css`, `manifest.webmanifest` e `icons/` a `www/`, y la versión se toma de `const VERSION` en `web/app.js`. Para compilar todo junto (y subir la versión) usa `scripts/build.sh` desde la raíz.

## Compilar

```
cd linux
npm install          # solo la primera vez
npm run dist         # → ../dist/<versión>/nanuq-<versión>-x86_64.AppImage y .rpm
npm start            # abrirla sin empaquetar, para probar
```

El `.rpm` se arma con `fpm` instalado como gema de Ruby en tu usuario (`~/bin/fpm`). El `fpm` que trae electron-builder necesita `libcrypt.so.1`, que Nobara no incluye.

## Instalar

- **RPM** (Nobara/Fedora): `sudo dnf install ./dist/<versión>/nanuq-<versión>-x86_64.rpm`. Se instala en `/opt/Nanuq`, aparece en el menú de aplicaciones y se actualiza instalando un `.rpm` más nuevo.
- **AppImage** (cualquier distribución): `chmod +x nanuq-*.AppImage` y ábrela. No se instala nada.

## Flatpak

```
cd linux/flatpak
./build-flatpak.sh             # publica en el repositorio local y deja ../../dist/<versión>/nanuq-<versión>.flatpak
./build-flatpak.sh --install   # además instala o ACTUALIZA la app en el sistema (pide contraseña)
```

Primero corre `npm run dist`, porque el Flatpak se arma a partir de esa compilación (`dist/_build/linux-unpacked`). Las carpetas de trabajo de flatpak-builder quedan en `dist/_build/flatpak/`, fuera del código. Usa el runtime `org.freedesktop.Platform` 26.08 con la base `org.electronjs.Electron2.BaseApp`, y se construye con `org.flatpak.Builder`, instalado como Flatpak de usuario.

### Actualizaciones sin desinstalar

Cada compilación se publica en un **repositorio Flatpak local**, `~/.local/share/nanuq/flatpak-repo`, firmado con una llave propia (`~/.local/share/nanuq/gpg`; Flatpak exige firma para instalar en el sistema desde un repositorio). La app instalada con `--install` viene de ese repositorio (remoto `nanuq-local`), así que las versiones nuevas llegan como **actualizaciones**:

- `./build-flatpak.sh --install` la actualiza directamente, o
- después de compilar, el **centro de software** (GNOME Software / Discover) o `flatpak update` la muestran como actualización.

La primera vez que usas `--install`, si la app estaba instalada desde un archivo `.flatpak` (origen `app-origin`, que no se puede actualizar), se reinstala desde el repositorio. Tus datos no se tocan.

- **Instalar el archivo en otra PC:** `flatpak install nanuq-<versión>.flatpak`. Para pasar a una versión más nueva en esa PC, instala el archivo nuevo **desde la terminal** con el mismo comando: actualiza sin desinstalar. El centro de software no sabe actualizar desde un archivo suelto. Si falta el runtime, lo baja de Flathub. Instálalo siempre de la misma forma (sistema **o** `--user`, no las dos): una instalación de usuario que se quita deja un caché de íconos viejo y GNOME deja de mostrar el ícono.
- **Desinstalar:** `flatpak uninstall com.nanuq.app`. Para quitar también el repositorio local: `flatpak remote-delete nanuq-local`.
- **Permisos:** red, sonido, Wayland/X11, GPU, el nombre MPRIS (controles del sistema), notificaciones y el llavero del sistema (`org.freedesktop.secrets` y KWallet, para cifrar tus datos). No tiene acceso a tus archivos.
- **Datos (sesión, ajustes, cola):** se guardan en `~/.var/app/com.nanuq.app/config/Nanuq`, separados de los de la versión RPM o AppImage. Desinstalar o actualizar no los borra.

## Qué hace distinto a la versión de navegador

- **Controles del sistema (MPRIS):** el panel de GNOME/KDE, las teclas multimedia del teclado y los audífonos Bluetooth controlan la música y muestran la carátula. Chromium lo hace solo a partir de `navigator.mediaSession`.
- **Servidores `http://` de tu red funcionan:** la app se sirve internamente desde `http://127.0.0.1:47863`, así que no hay bloqueo por contenido mixto.
- **Sigue sonando con la ventana minimizada** y pasa de canción a tiempo.
- La ventana recuerda su tamaño y posición. Solo se abre una instancia.
- **Puerto 47863:** la ventana carga la app desde `http://127.0.0.1:47863`, y el navegador guarda tus ajustes (tema, volumen…) según esa dirección. Si otro programa ya usa ese puerto (por ejemplo, la versión AppImage y la Flatpak abiertas a la vez), Nanuq usa otro puerto libre: funciona, pero **en esa sesión** no verás tus ajustes y, si tu sistema no tiene llavero, tampoco tu sesión. Cierra la otra copia y vuelve a abrir Nanuq. Tus datos cifrados (sesión, cola) no dependen del puerto.
- **«Escuchando Nanuq» en Discord:** con **Ajustes → Mostrar en Discord lo que escuchas**, tu perfil de Discord muestra la canción, el artista y el tiempo (como con Spotify). Se quita al pausar. Necesita Discord abierto en la misma computadora (Discord oficial, o Vesktop/Equibop con «Rich Presence»/arRPC activado). Nanuq habla con Discord por su socket local (`discord-ipc-0`, o la tubería con ese nombre en Windows), sin dependencias extra; el Flatpak tiene permiso para ese socket y para las carpetas donde lo crean Discord, Vesktop y Equibop instalados como Flatpak (`$XDG_RUNTIME_DIR/.flatpak/<id>/xdg-run`, con `:create` para que funcione aunque abras Discord después de Nanuq). Si Discord se abre o se reinicia con Nanuq sonando, Nanuq lo encuentra solo en unos 10 s. Excepción: con el Discord **nativo** (RPM o .deb, no Flatpak) y Nanuq en Flatpak, abre Discord antes que Nanuq (su socket es un archivo suelto que Flatpak solo comparte si ya existe; la versión AppImage/RPM de Nanuq no tiene ese límite). Con Vesktop/Equibop, activa su «Rich Presence» (arRPC). Nota: el arRPC 1.3.4 que trae Equibop se cae si alguien se conecta por WebSocket (un error suyo); Nanuq usa solo el socket. La portada solo se muestra si activas «Con la portada» y tu Jellyfin está en internet por https: Discord solo muestra imágenes que puede descargar él mismo. Si no, el logo de Nanuq (sin servicios de terceros).
  - **Si no aparece en tu perfil**, mira la línea de estado debajo del ajuste: dice si Nanuq no encontró Discord abierto (abre la app de escritorio; la página web no sirve), si el sistema no dejó conectarse (en Windows, pasa si Discord se abrió como administrador), si Discord rechazó la actividad o cerró la conexión (con el motivo que dio), o si está conectado (entonces revisa en Discord: Ajustes → Privacidad de actividad → «Compartir tu actividad»). Si Discord rechaza la actividad, Nanuq la vuelve a mandar con lo mínimo (título, artista y tiempo).
- **Fiesta (anfitrión):** mientras la sala está abierta, Nanuq escucha en tu red local en **TCP 47864** (WebSocket) y **UDP 47865** (para que los teléfonos la encuentren). Si tu firewall no deja entrar conexiones (en Fedora/Nobara: `sudo firewall-cmd --add-port=47864/tcp --add-port=47865/udp`; en Windows, el Firewall pregunta la primera vez: permítelo en redes privadas), los teléfonos no la verán. Sin la búsqueda UDP, se puede entrar escribiendo la dirección que muestra la pantalla. Las canciones recibidas viven en el disco, cifradas, en `~/.cache/nanuq/nanuq-fiesta-*` (Flatpak: `~/.var/app/com.nanuq.app/cache/nanuq`), una carpeta que se borra sola. A pantalla completa, **↑ ↓** cambian el volumen.
- **Atajos:** F11 pantalla completa, F5 o Ctrl+R recargar, Ctrl+Shift+I herramientas de desarrollo.
- Los datos (sesión, ajustes, cola) se guardan en `~/.config/Nanuq`.
- Las **descargas** para escuchar sin datos solo existen en Android, así que en Linux no aparece el botón.
- **Solicitar canción (SomeDL)** funciona sin proxy: el proceso principal hace las peticiones (`nanuq:http` en `main.js`), porque el servidor de SomeDL no acepta peticiones de otras páginas (CORS). Al terminar una descarga con la ventana minimizada, llega una notificación del escritorio.

## Windows

La misma app de Electron, empaquetada como instalador NSIS (`nanuq-<versión>-setup.exe`). Se compila desde Linux con **Wine** (lo usa electron-builder para poner el ícono y los datos de Nanuq en el `.exe`):

```
sudo dnf install wine        # solo la primera vez
scripts/build.sh windows     # o: cd linux && npm run dist:win
```

- **Instalar:** abre el `.exe`. Se instala para tu usuario (sin permisos de administrador) en la carpeta que elijas, con accesos directos en el escritorio y el menú Inicio. Una versión nueva se instala encima de la anterior; desinstalar no borra tus datos (`%APPDATA%\Nanuq`).
- **Sin firma de código:** Windows mostrará «Windows protegió tu PC»; toca **Más información → Ejecutar de todas formas**.
- **Datos cifrados con DPAPI** (ligado a tu cuenta de Windows). Ajustes → *Datos guardados en este dispositivo* lo muestra.
- Los controles multimedia de la barra de tareas y las notificaciones aparecen como «Nanuq».
- La primera vez que busques servidores en tu red, el Firewall de Windows puede preguntar si Nanuq puede comunicarse: permítelo en redes privadas.
- Ejecutable con los **fusibles de Electron** activados (no se puede usar como Node ni inyectarle código; en Windows valida su propio paquete al arrancar).
