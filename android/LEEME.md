<p align="right"><b>Español</b> · <a href="LEEME.en.md">English</a></p>

# Nanuq para Android (APK)

La app de Android envuelve la misma PWA de `../web/` (`index.html`, `i18n.js`, `app.js`, `app.css`, `icons/`, `manifest.webmanifest`). **No hay una segunda copia de la interfaz**: cada compilación copia esos archivos dentro del APK, así que cualquier cambio a `index.html` llega a Android con solo volver a compilar. La versión del APK sale de `const VERSION` en `web/app.js`. Para compilar todo junto (y subir la versión) usa `scripts/build.sh` desde la raíz.

## Compilar

```
./build-apk.sh          # APK firmado → ../dist/<versión>/nanuq-<versión>-release.apk
./build-apk.sh debug    # APK de depuración (se inspecciona desde chrome://inspect en la PC)
```

Herramientas instaladas en tu usuario (sin sudo):

| Qué | Dónde |
|---|---|
| JDK 21 (Temurin) | `~/.local/opt/jdk21` |
| Android SDK (platform 35, build-tools 35, platform-tools/adb) | `~/Android/Sdk` |
| Gradle | se descarga solo con `./gradlew` |
| Node.js (para la prueba del reproductor, `test/*.test.js`) | el del sistema (`node` en el PATH) |

## Firma: no pierdas la llave

El APK de release se firma con `~/.android/nanuq-release.jks`. La contraseña está en `android/keystore.properties`. **Respalda los dos archivos.** Android solo acepta actualizar la app si el nuevo APK está firmado con la misma llave. Si la pierdes, tendrás que desinstalar la app (y perder sus datos) para instalar una versión nueva.

## Instalar en el teléfono

- Copia el `.apk` al teléfono y ábrelo (Android pedirá permitir instalar apps de esa fuente), o
- con depuración USB activada: `~/Android/Sdk/platform-tools/adb install -r ../dist/<versión>/nanuq-<versión>-release.apk`

## Diferencias con la PWA en el navegador

- **Servidores `http://` de tu red funcionan.** La app se sirve internamente desde `http://localhost`, así que no hay bloqueo por contenido mixto. Las IPs sin esquema usan `http://…:8096`. También se aceptan certificados que instales tú en Android (para Jellyfin con certificado propio).
- **Música en segundo plano y con la pantalla apagada.** Mientras suena, un servicio en primer plano mantiene viva la app, la CPU y el Wi-Fi.
- **Suena con el reproductor del sistema, no dentro del WebView.** Si otra app empieza a sonar (un video, por ejemplo), Nanuq baja suave y se pausa; cuando ya no suena nada (hasta 5 minutos después), vuelve a sonar sola (Ajustes → «Volver a sonar cuando la otra app termine»). Con avisos cortos, la navegación o una llamada, se pausa y vuelve sola al terminar. Opus en Ogg desde Android 10 (antes, MP3).
- **Notificación y pantalla de bloqueo** con carátula, anterior, reproducir/pausa, siguiente y barra de posición. Los botones de los audífonos Bluetooth también funcionan. Al desconectar los audífonos, la música se pausa.
- En pausa, los controles se quedan (el servicio sigue sin gastar batería: suelta la CPU y el Wi-Fi) hasta que deslizas la notificación (donde el sistema lo permite) o cierras la app desde Recientes. Si Android cierra Nanuq para liberar memoria, ▶ en los audífonos, en una notificación que quedó o en la tarjeta de «reanudar» (solo en teléfonos que la tienen activa; Samsung no) la despierta sin abrir la pantalla y sigue tu cola donde iba.
- **Atrás** cierra diálogos y vuelve entre pantallas. En la pantalla inicial manda la app al fondo sin cortar la música. Quitarla de recientes la cierra.
- Las barras del sistema toman el color del tema elegido.
- **Favorito y Descargar** en la pantalla de reproducción. Favorito marca la canción en Jellyfin. Descargar la guarda en el teléfono y, a partir de ahí, se reproduce desde ese archivo sin gastar datos.
- **Más → Descargas** (o la barra lateral en tablets) muestra tus canciones guardadas en el teléfono; sin conexión con tu servidor, Inicio te lleva ahí.
- **Lo que sigue, guardado por adelantado** (Ajustes → Reproducción, encendido por omisión): mientras escuchas, el teléfono baja las próximas canciones de tu cola hasta cubrir los minutos que elijas (10 por omisión; 5 a 60) y, al llegar su turno, suenan desde el teléfono: una red lenta o un corte breve no se notan. Es una caché temporal (`Prefetch.java`): se borra al abrir la app y cuando la canción sale de esos minutos, no cuenta como descarga y tiene topes (400 MB por canción, 1 GB en total, siempre deja 300 MB libres).
- **Idioma:** sin elegir uno en Ajustes, el del teléfono (español o, si no, inglés).
- **Ajustes → Descargas** permite configurar:
  - el máximo de canciones;
  - si se descarga solo con Wi-Fi (opción predeterminada) o también con datos móviles;
  - el guardado automático de las canciones que escuchas 3 veces o más;
  - la calidad de las descargas.

  Al llegar al máximo, las canciones guardadas automáticamente que menos escuchas dejan lugar a las nuevas. Las que descargaste tú nunca se borran solas. Si se cae el Wi-Fi a mitad de una descarga, esta se pausa y sigue cuando vuelve.
- **Solicitar canción (SomeDL)** funciona sin proxy: las peticiones a SomeDL las hace Java (`NativeHttp.java`), porque su servidor no acepta peticiones del WebView (CORS). Cuando termina una descarga y la app no está a la vista, llega una notificación del canal «Canciones solicitadas». Mientras la app está cerrada no se revisa nada: al abrirla, Nanuq se pone al día.
- **Fiesta (invitado):** Más → Fiesta busca salas en tu red (UDP 47865, `Discovery.java`) y entra con el código; desde ahí mandas canciones de tu Jellyfin a la computadora que hace de anfitrión. Mientras estás en una fiesta la app solo muestra la fiesta (sin la barra de abajo ni el reproductor minimizado) hasta que sales; si el teléfono se duerme, sigues en la fiesta y vuelves a entrar solo al despertarlo (el latido de `MainActivity` cada 20 s y `onStart` lo disparan).
- No usa service worker: los archivos ya vienen dentro del APK.

## Archivos

- `bridge/android-bridge.js`: sustituye `navigator.mediaSession` por una versión que habla con Android. Se inyecta en `index.html` al compilar.
- `app/src/main/java/com/nanuq/app/MainActivity.java`: la pantalla (Atrás, color de las barras). La página vive en `Page.java` (el WebView, el puente `NanuqAndroid` y el servidor interno de `localhost`), que también puede arrancar sin pantalla; `NanuqBrowserService.java` y `Resume.java`: la tarjeta de «reanudar» de los controles del sistema.
- `MediaCenter.java`: la MediaSession del sistema y la notificación.
- `PlaybackService.java`: el servicio en primer plano y los bloqueos de CPU y Wi-Fi.
- `NativeHttp.java`: peticiones HTTP sin CORS para «Solicitar canción» (`NanuqAndroid.http`, responde en `window.__nanuqHttp`).
- `Downloads.java`: descargas para escuchar sin datos (cola, límite, solo Wi-Fi, índice cifrado).
- `LocalServer.java`: servidor en `127.0.0.1` (puerto al azar, rutas con token) que entrega las descargas (y lo guardado por adelantado) al reproductor.
- `Prefetch.java`: lo que sigue en la cola, guardado por adelantado en la caché (`NanuqAndroid.pfSet/pfReady/pfBroken`).
- `res/values-en/strings.xml`: textos nativos en inglés (notificación y canales).
- `SecureStore.java`: almacén cifrado de los datos personales (AES-256-GCM con el Android Keystore).
- `Discovery.java`: búsqueda de servidores Jellyfin en la red local (UDP 7359).
- `NativeAudio.java`: la música, con el reproductor del sistema (`MediaPlayer`) y su propio foco de audio; la página lo usa como un `<audio>` (`NanuqNativeAudio` en `android-bridge.js`).
