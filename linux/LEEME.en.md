<p align="right"><a href="LEEME.md">Español</a> · <b>English</b></p>

# Nanuq for Linux and Windows

The same PWA from `../web/` in an Electron window. At build time `index.html`, `i18n.js`, `app.js`, `app.css`, `manifest.webmanifest` and `icons/` are copied to `www/`, and the version is taken from `const VERSION` in `web/app.js`. To build everything together (and bump the version) use `scripts/build.sh` from the root.

## Building

```
cd linux
npm install          # only the first time
npm run dist         # → ../dist/<version>/nanuq-<version>-x86_64.AppImage and .rpm
npm start            # open it unpackaged, for testing
```

The `.rpm` is built with `fpm` installed as a Ruby gem in your user (`~/bin/fpm`). The `fpm` that comes with electron-builder needs `libcrypt.so.1`, which Nobara doesn't include.

## Installing

- **RPM** (Nobara/Fedora): `sudo dnf install ./dist/<version>/nanuq-<version>-x86_64.rpm`. It installs in `/opt/Nanuq`, shows up in the applications menu and is updated by installing a newer `.rpm`.
- **AppImage** (any distribution): `chmod +x nanuq-*.AppImage` and open it. Nothing is installed.

## Flatpak

```
cd linux/flatpak
./build-flatpak.sh             # publishes to the local repository and leaves ../../dist/<version>/nanuq-<version>.flatpak
./build-flatpak.sh --install   # also installs or UPDATES the app on the system (asks for the password)
```

Run `npm run dist` first, because the Flatpak is built from that build (`dist/_build/linux-unpacked`). flatpak-builder's work folders stay in `dist/_build/flatpak/`, outside the code. It uses the `org.freedesktop.Platform` 26.08 runtime with the `org.electronjs.Electron2.BaseApp` base, and it's built with `org.flatpak.Builder`, installed as a user Flatpak.

### Updates without uninstalling

Every build is published to a **local Flatpak repository**, `~/.local/share/nanuq/flatpak-repo`, signed with its own key (`~/.local/share/nanuq/gpg`; Flatpak requires a signature to install system-wide from a repository). The app installed with `--install` comes from that repository (remote `nanuq-local`), so new versions arrive as **updates**:

- `./build-flatpak.sh --install` updates it directly, or
- after building, the **software center** (GNOME Software / Discover) or `flatpak update` show it as an update.

The first time you use `--install`, if the app was installed from a `.flatpak` file (origin `app-origin`, which can't be updated), it's reinstalled from the repository. Your data isn't touched.

- **Installing the file on another PC:** `flatpak install nanuq-<version>.flatpak`. To move to a newer version on that PC, install the new file **from the terminal** with the same command: it updates without uninstalling. The software center can't update from a loose file. If the runtime is missing, it downloads it from Flathub. Always install it the same way (system **or** `--user`, not both): a user installation that gets removed leaves an old icon cache and GNOME stops showing the icon.
- **Uninstalling:** `flatpak uninstall com.nanuq.app`. To also remove the local repository: `flatpak remote-delete nanuq-local`.
- **Permissions:** network, sound, Wayland/X11, GPU, the MPRIS name (system controls), notifications and the system keyring (`org.freedesktop.secrets` and KWallet, to encrypt your data). It has no access to your files.
- **Data (session, settings, queue):** stored in `~/.var/app/com.nanuq.app/config/Nanuq`, separate from the RPM or AppImage version's. Uninstalling or updating doesn't delete it.

## What's different from the browser version

- **System controls (MPRIS):** the GNOME/KDE panel, the keyboard's media keys and Bluetooth headphones control the music and show the cover. Chromium does it on its own from `navigator.mediaSession`.
- **`http://` servers on your network work:** the app is served internally from `http://127.0.0.1:47863`, so there's no mixed-content blocking.
- **It keeps playing with the window minimized** and moves to the next song on time.
- The window remembers its size and position. Only one instance opens.
- **Port 47863:** the window loads the app from `http://127.0.0.1:47863`, and the browser stores your settings (theme, volume…) by that address. If another program already uses that port (for example, the AppImage and Flatpak versions open at the same time), Nanuq uses another free port: it works, but **in that session** you won't see your settings and, if your system has no keyring, not your session either. Close the other copy and open Nanuq again. Your encrypted data (session, queue) doesn't depend on the port.
- **“Listening to Nanuq” on Discord:** with **Settings → Show what you're listening to on Discord**, your Discord profile shows the song, the artist and the time (like with Spotify). It's removed when you pause. It needs Discord open on the same computer (official Discord, or Vesktop/Equibop with “Rich Presence”/arRPC turned on). Nanuq talks to Discord through its local socket (`discord-ipc-0`, or the pipe with that name on Windows), with no extra dependencies; the Flatpak has permission for that socket and for the folders where Discord, Vesktop and Equibop installed as Flatpak create it (`$XDG_RUNTIME_DIR/.flatpak/<id>/xdg-run`, with `:create` so it works even if you open Discord after Nanuq). If Discord opens or restarts while Nanuq is playing, Nanuq finds it on its own within about 10 s. Exception: with **native** Discord (RPM or .deb, not Flatpak) and Nanuq as a Flatpak, open Discord before Nanuq (its socket is a loose file that Flatpak only shares if it already exists; the AppImage/RPM version of Nanuq doesn't have that limit). With Vesktop/Equibop, turn on their “Rich Presence” (arRPC). Note: the arRPC 1.3.4 that comes with Equibop crashes if someone connects over WebSocket (its own bug); Nanuq only uses the socket. The cover is only shown if you turn on “With the cover” and your Jellyfin is on the internet over https: Discord only shows images it can download itself. Otherwise, the Nanuq logo (no third-party services).
  - **If it doesn't show on your profile**, look at the status line below the setting: it says whether Nanuq didn't find Discord open (open the desktop app; the web page doesn't work), whether the system didn't allow the connection (on Windows, this happens if Discord was opened as administrator), whether Discord rejected the activity or closed the connection (with the reason it gave), or whether it's connected (then check in Discord: Settings → Activity Privacy → “Share your activity”). If Discord rejects the activity, Nanuq sends it again with the minimum (title, artist and time).
- **Party (host):** while the room is open, Nanuq listens on your local network on **TCP 47864** (WebSocket) and **UDP 47865** (so phones can find it). If your firewall doesn't let connections in (on Fedora/Nobara: `sudo firewall-cmd --add-port=47864/tcp --add-port=47865/udp`; on Windows, the Firewall asks the first time: allow it on private networks), the phones won't see it. Without UDP discovery, you can join by typing the address the screen shows. Received songs live in a temporary folder (`nanuq-fiesta-*`) that deletes itself. In full screen, **↑ ↓** change the volume.
- **Shortcuts:** F11 full screen, F5 or Ctrl+R reload, Ctrl+Shift+I developer tools.
- Data (session, settings, queue) is stored in `~/.config/Nanuq`.
- **Downloads** to listen without data only exist on Android, so the button doesn't appear on Linux.
- **Request a song (SomeDL)** works without a proxy: the main process makes the requests (`nanuq:http` in `main.js`), because SomeDL's server doesn't accept requests from other pages (CORS). When a download finishes with the window minimized, a desktop notification arrives.

## Windows

The same Electron app, packaged as an NSIS installer (`nanuq-<version>-setup.exe`). It's built from Linux with **Wine** (electron-builder uses it to set Nanuq's icon and details in the `.exe`):

```
sudo dnf install wine        # only the first time
scripts/build.sh windows     # or: cd linux && npm run dist:win
```

- **Installing:** open the `.exe`. It installs for your user (no administrator permissions) in the folder you choose, with shortcuts on the desktop and in the Start menu. A new version installs over the previous one; uninstalling doesn't delete your data (`%APPDATA%\Nanuq`).
- **No code signing:** Windows will show “Windows protected your PC”; tap **More info → Run anyway**.
- **Data encrypted with DPAPI** (tied to your Windows account). Settings → *Data saved on this device* shows it.
- The taskbar media controls and notifications appear as “Nanuq”.
- The first time you look for servers on your network, Windows Firewall may ask whether Nanuq can communicate: allow it on private networks.
- Executable with **Electron fuses** turned on (it can't be used as Node or have code injected; on Windows it validates its own package at startup).
