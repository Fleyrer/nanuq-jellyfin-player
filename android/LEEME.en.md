<p align="right"><a href="LEEME.md">Español</a> · <b>English</b></p>

# Nanuq for Android (APK)

The Android app wraps the same PWA from `../web/` (`index.html`, `i18n.js`, `app.js`, `app.css`, `icons/`, `manifest.webmanifest`). **There's no second copy of the interface**: every build copies those files into the APK, so any change to `web/` reaches Android just by building again. The APK's version comes from `const VERSION` in `web/app.js`. To build everything together (and bump the version) use `scripts/build.sh` from the root.

## Building

```
./build-apk.sh          # signed APK → ../dist/<version>/nanuq-<version>-release.apk
./build-apk.sh debug    # debug APK (inspected from chrome://inspect on the PC)
```

Tools installed in your user (no sudo):

| What | Where |
|---|---|
| JDK 21 (Temurin) | `~/.local/opt/jdk21` |
| Android SDK (platform 35, build-tools 35, platform-tools/adb) | `~/Android/Sdk` |
| Gradle | downloaded automatically by `./gradlew` |

## Signing: don't lose the key

The release APK is signed with `~/.android/nanuq-release.jks`. The password is in `android/keystore.properties`. **Back up both files.** Android only accepts updating the app if the new APK is signed with the same key. If you lose it, you'll have to uninstall the app (and lose its data) to install a new version.

## Installing on the phone

- Copy the `.apk` to the phone and open it (Android will ask you to allow installing apps from that source), or
- with USB debugging turned on: `~/Android/Sdk/platform-tools/adb install -r ../dist/<version>/nanuq-<version>-release.apk`

## Differences from the PWA in the browser

- **`http://` servers on your network work.** The app is served internally from `http://localhost`, so there's no mixed-content blocking. IPs without a scheme use `http://…:8096`. Certificates you install yourself on Android are also accepted (for Jellyfin with its own certificate).
- **Music in the background and with the screen off.** While it plays, a foreground service keeps the app, the CPU and Wi-Fi alive.
- **Notification and lock screen** with cover, previous, play/pause, next and a position bar. Bluetooth headphone buttons work too. Disconnecting the headphones pauses the music.
- After 10 minutes paused the service is released, and the notification can be dismissed by swiping it.
- **Back** closes dialogs and goes back between screens. On the home screen it sends the app to the background without stopping the music. Removing it from recents closes it.
- The system bars take the chosen theme's color.
- **Favorite and Download** on the now playing screen. Favorite marks the song in Jellyfin. Download saves it on the phone and, from then on, it plays from that file without using data.
- **More → Downloads** (or the sidebar on tablets) shows the songs saved on your phone; without a connection to your server, Home takes you there.
- **What's next, saved ahead of time** (Settings → Playback, on by default): while you listen, the phone downloads the next songs in your queue until it covers the minutes you choose (10 by default; 5 to 60) and, when their turn comes, they play from the phone: a slow network or a brief drop goes unnoticed. It's a temporary cache (`Prefetch.java`): it's deleted when the app opens and when the song leaves those minutes, it doesn't count as a download and it has limits (400 MB per song, 1 GB in total, always leaving 300 MB free).
- **Language:** until you pick one in Settings, the phone's (Spanish or, otherwise, English).
- **Settings → Downloads** lets you configure:
  - the maximum number of songs;
  - whether it only downloads on Wi-Fi (the default) or also on mobile data;
  - automatically saving the songs you play 3 times or more;
  - the quality of the downloads.

  When the maximum is reached, the automatically saved songs you play least make room for the new ones. The ones you downloaded yourself are never deleted on their own. If Wi-Fi drops in the middle of a download, it pauses and continues when it comes back.
- **Request a song (SomeDL)** works without a proxy: requests to SomeDL are made by Java (`NativeHttp.java`), because its server doesn't accept requests from the WebView (CORS). When a download finishes and the app isn't on screen, a notification arrives on the “Requested songs” channel. While the app is closed nothing is checked: when you open it, Nanuq catches up.
- **Party (guest):** More → Party finds rooms on your network (UDP 47865, `Discovery.java`) and joins with the code; from there you send songs from your Jellyfin to the computer acting as host. While you're at a party the app only shows the party (no bottom bar or mini player) until you leave; if the phone sleeps, you're still at the party and rejoin on your own when you wake it (`MainActivity`'s 20 s heartbeat and `onStart` trigger it).
- It doesn't use a service worker: the files already come inside the APK.

## Files

- `bridge/android-bridge.js`: replaces `navigator.mediaSession` with a version that talks to Android. It's injected into `index.html` at build time.
- `app/src/main/java/com/nanuq/app/MainActivity.java`: the WebView and the internal `localhost` server.
- `MediaCenter.java`: the system MediaSession and the notification.
- `PlaybackService.java`: the foreground service and the CPU and Wi-Fi locks.
- `NativeHttp.java`: CORS-free HTTP requests for “Request a song” (`NanuqAndroid.http`, answers in `window.__nanuqHttp`).
- `Downloads.java`: downloads to listen without data (queue, limit, Wi-Fi only, encrypted index).
- `LocalServer.java`: server on `127.0.0.1` (random port, routes with a token) that hands downloads (and ahead-of-time songs) to the player.
- `Prefetch.java`: what's next in the queue, saved ahead of time in the cache (`NanuqAndroid.pfSet/pfReady/pfBroken`).
- `res/values-en/strings.xml`: native texts in English (notification and channels).
- `SecureStore.java`: encrypted store for personal data (AES-256-GCM with the Android Keystore).
- `Discovery.java`: discovery of Jellyfin servers on the local network (UDP 7359).
