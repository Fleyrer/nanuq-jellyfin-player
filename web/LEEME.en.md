<p align="right"><a href="LEEME.md">Español</a> · <b>English</b></p>

# Nanuq: a music client for Jellyfin (PWA)

It's the static files in this folder (`web/`): `index.html`, `i18n.js`, `app.js`, `app.css`, `manifest.webmanifest`, `sw.js` and `icons/`. You don't need to build anything: upload the `web/` folder as is.

This folder is also the **only source of the interface** for the Android and Linux apps: when they're built, it's copied into each package.

## 1. Hosting the app

To install as an app, Chrome requires the page to arrive over **HTTPS** (or from `localhost`).

- **Next to Jellyfin, with Caddy** (the easiest if you already have a domain):
  ```
  music.yourdomain.com {
      root * /path/to/nanuq/web
      file_server
  }
  jellyfin.yourdomain.com {
      reverse_proxy [::1]:8096
  }
  ```
  Caddy gets the certificates on its own. With an AAAA record, everything works over IPv6.
- **GitHub Pages, Netlify or Cloudflare Pages**: publish the `web/` folder as is.

## 2. The Jellyfin server has to use HTTPS

If Nanuq opens over `https://`, the browser blocks requests to a Jellyfin on `http://` (mixed content). You have two options:

- Put Jellyfin behind an HTTPS proxy (like the example above).
- Or serve Nanuq over `http://` inside your network. It works as a page, but Android won't install it as a full app.

## 3. Accepted IPv6 addresses

| You type | It connects to |
|---|---|
| `2001:db8::10` | `http(s)://[2001:db8::10]:8096` (or `:8920` if the app uses https) |
| `[2001:db8::10]:8096` | that address and that port |
| `https://[2001:db8::10]/jellyfin` | it keeps the scheme, port and path |
| `fd00::5` (ULA) | works the same |
| `fe80::1%wlan0` | ✗ browsers don't accept link-local addresses with a zone |

Below the field you'll see, live, the final URL that will be used.

## 4. Installing on Android

Open the address in Chrome → ⋮ menu → **Install app** (or **Add to Home screen**). Lock-screen and Bluetooth headphone controls work through the Media Session API.

## Language

**Settings → Language** switches the interface between **Spanish** and **English**. In the Android app, until you pick one, Nanuq uses the **phone's language** (if it isn't Spanish or English, English); the “System language” option goes back to that mode. On desktop and in the browser the default language is Spanish. When you change it, Nanuq reopens in that language; the music stays paused at the same second. The DJ (its introductions and, if you turn it on, its voice, which uses an English system voice), the “Your week” and “Your year” videos and the Party change too. What comes from your library (titles, artists, lyrics) isn't translated. On Android, the playback notification follows the phone's language.

Texts are written in Spanish inside `app.js`, wrapped in `tx('…')`, and their translation is in `i18n.js` (the Spanish text is the key). Anything without a translation shows in Spanish.

## Lyrics

The **Lyrics** button (on the now playing screen or in the bottom bar on a computer) shows the synced lyrics and highlights them line by line; tap a line to jump to that moment. It requires Jellyfin 10.9 or newer and available lyrics:

- `.lrc` (synced) or `.txt` files with the same name as the song, in the same folder, or
- The **LrcLib** plugin: Dashboard → Plugins → Catalog → LrcLib, then rescan the library.

### Syncing by hand

On the lyrics screen, tap **Sync** (or ⋮ → *Sync lyrics by hand*). Play the song and tap **Mark** right when each line starts. ↶ undoes the last mark, and −¼s / +¼s adjust it. When you press **Save**, Nanuq uploads an `.lrc` to your Jellyfin. The new lyrics show up immediately: even if Jellyfin takes a few seconds to serve them, Nanuq shows the ones you just saved until the server has them. If your user doesn't have permission, the lyrics are only saved on that phone. To grant it: Dashboard → Users → your user → *Allow lyrics management*.

You can also go to ⋮ → *Find other lyrics (LrcLib)* to choose a synced version, or to *Paste or edit lyrics*.

## DJ Nanuq

In **Home → Your music**, the **DJ Nanuq** card builds a never-ending session, like a radio DJ, without AI: just rules about your library and your Jellyfin history. The session goes in rounds of about 5 songs. The main ones are themes and forgotten songs: While it builds the first round you see Nanuq at the turntable with lines like “Preparing mixes…”; the screen goes away as soon as the music starts.

- **by genre**: Pop, Rock, Pop Punk… any you have in your library, without repeating recent ones
- **by decade**: a trip to the 70s, the 80s, etc., according to the years in your library
- **to discover**: songs you've never heard (from your genres or, if there are none, from your whole library)
- **forgotten**: the ones that haven't played in more than 45 days (if your history is short, this round doesn't come up)
- and every now and then: for the time of day, recently added and your favorites

**The DJ explores your library:** in each round, the never-heard and the forgotten go first; what played in the last 3 days is left out if there are alternatives, and a round that could only offer what you already heard these weeks is skipped for another one. **Your most played** and **these days** come up very rarely. It also remembers what it played in its last sessions so it doesn't repeat it.

Before each round, Nanuq introduces it with the artists coming up. **Change the vibe** jumps to another round, and when the queue is running out, it adds the next one on its own. It doesn't repeat songs within the same session. If you play another album or playlist, the DJ stops and the queue stays as it is.

With the DJ on, the **full-screen player** swaps the cover for a scene: the song's cover is the sleeve of a record whose vinyl spins with the music and Nanuq introduces it from its turntable. When moving to the next one, the sleeve leaves to the left and the new one comes in from the right; with the previous one, the other way around; if you jump to another song, the new one drops from above. The introductions show up there in a speech bubble.

**The DJ across your devices:** if you send the music to another Nanuq from **My devices** with the DJ playing, the session goes with it: there it keeps the same rounds (and adds the next ones), and the device you're controlling from shows the DJ scene, the round and its introduction. If you pick another song there, you see it here right away. You can also start the DJ from a device that's controlling another one: it plays there. With **Play here**, the session comes back to you. It needs “Sync with my other devices” turned on and Nanuq 1.30.7 or newer on both sides.

If your system has a voice in the app's language (Chrome and Electron with voices installed), the **DJ voice** option appears: Nanuq reads the introduction and lowers the music while it talks. It comes turned off. On Android, the WebView has no voices, so the introduction is only shown as text.

## Your year with Nanuq

From **December 1st to 7th**, in **Home → Your music** (or in **More**), your recap of the current year shows up on video, presented by the Nanuqs: the minutes you listened to (and how many km a polar bear would have walked in that time), your artist of the year with a drumroll, your favorite artists and songs, your **music personality** (Nanuq changes costume according to your favorite genre), the time of day you listen most, your streak of days and the song you repeated most. It lasts about 50 seconds, with music made by Nanuq (it doesn't use your songs).

- **View** plays it in the app. **Export video** records it as MP4 (or WebM if the device can't do MP4): on Android it's saved in *Movies › Nanuq* and can be shared; on Linux and in the browser it's downloaded. Don't switch apps while it records.
- The data is **your user's on your Jellyfin server**, from all your apps and devices. If you have the **Playback Reporting** plugin in Jellyfin and your user is an administrator, the recaps are exact: every play with the minutes actually listened (it counts if it lasted 30 seconds or more). Otherwise, the basic data Jellyfin keeps about your user is used (the last time each song played and its total plays), which is approximate. **Settings → Data for your recaps** tells you which one is used.
- Exported videos aren't encrypted: they're for sharing.

### Your week with Nanuq

In **Settings → Your week with Nanuq** you can create a video under a minute long about last week (Monday to Sunday): minutes listened, how many days had music and your most musical day, a drumroll for your song of the week, your 5 most played songs, **your artists' podium** with three Nanuqs, your favorite hour, your discoveries and **your week's music forecast** (for example, “Thunderstorm of guitars and drums” or “Catchy rainbow”). You view and export it the same way as the year recap.

## Request a song (SomeDL)

In **More → Request a song** (or in the sidebar, on a computer) you can request a song you don't have. [SomeDL](https://github.com/ChemistryGull/SomeDL) finds it on YouTube Music, adds the cover, lyrics and details, and saves it in your library folder. Nanuq follows its progress and lets you know when it's done, with a system notification if the app isn't on screen.

1. On the Jellyfin computer: `pipx install somedl` (it needs Python 3.10 or newer and FFmpeg).
2. Run `somedl --generate-config` and edit `somedl_config.toml`:
   - `[download]` → `output_dir = "/path/to/your/music"` (the Jellyfin library folder)
   - `[webui]` → `host = "0.0.0.0"` (otherwise it only accepts connections from that same computer) and `open_browser = false`
3. Start it with `somedl web` (port 5000). In Nanuq, type the address, for example `192.168.1.20` (`:5000` is added).
4. For songs to show up on their own, turn on Jellyfin's *real-time monitoring* for the music library. If your user is an administrator, Nanuq also asks Jellyfin to rescan when each download finishes.

Type `Artist - Song` or paste a YouTube or YouTube Music link (a playlist link requests all its songs). If one fails, tap **Retry**. Requests are saved on the device: if you close Nanuq, it keeps checking them when you come back. SomeDL keeps its history in memory, so if it restarts while a song was pending, Nanuq marks it as lost.

**SomeDL has no password**, and its page lets anyone change its configuration. Don't publish it on the internet: use it on your network or over a VPN.

**In the browser:** SomeDL's server doesn't accept requests from other pages (CORS), so the PWA can only use it behind a proxy that adds those permissions. The Android and Linux apps connect directly, with no proxy. With Caddy, inside your network:

```
somedl.yourdomain.com {
    @preflight method OPTIONS
    header Access-Control-Allow-Origin "https://music.yourdomain.com"
    header Access-Control-Allow-Headers "Content-Type"
    header Access-Control-Allow-Methods "GET, POST, OPTIONS"
    respond @preflight 204
    reverse_proxy 127.0.0.1:5000
}
```

## Party (Nanuq watch party)

Your computer (the Linux or Windows app) opens a room and your friends join from their phones with the Nanuq Android app, connected to the **same Wi-Fi network**. Everyone sends songs from **their own** Jellyfin: their phone downloads it from their server and passes it to the computer over the local network, which plays them one after another.

- **On the computer:** sidebar → **Party** → *Open the party*. While the room is open, the computer only shows the party: the sidebar, the queue and the player are hidden and your music **stops** (no taskbar controls or way to resume it outside the party); when you close it everything comes back, with your queue ready to continue where it was. A **6-digit code** and the room's address show up. From there you see who's in, the list, what's playing with its lyrics (karaoke) and you can pause, skip or remove songs (only the computer removes songs; guests can't). *Another code* invalidates the previous one (those already in stay). *Close the party* removes everyone and deletes the songs that arrived.
- **On the phone:** More → **Party** → *Find parties on my network* (or type the address the computer shows) and the code. While you're at the party, the app only shows the party (no bottom bar, mini player or back button, and your music pauses); they come back when you tap **Leave**. Below what's playing and its lyrics is the search box: your playlists (even without typing anything), artists, albums and songs from your library; tap a playlist, an artist or an album to see its songs and tap a song to send it.
- **If the phone sleeps or locks** (or loses Wi-Fi), you're still at the party: your Nanuq keeps dancing in the igloo (the list says “away”) and, when the phone wakes up, it rejoins on its own, without the code (even if Android closed the app). Only **Leave** takes you out. If 2 hours pass without coming back, the computer frees your place. If, when it wakes up, the party no longer exists (the computer closed it or shut down while your phone slept), your phone tries for a few seconds and leaves with a notice. If you have the song downloaded, it comes from the phone without using data; if not, your phone asks your Jellyfin for it as MP3 320 kbps. The lyrics (if your Jellyfin has them) and a cover thumbnail travel with it: every second, the computer tells all the phones which second it's at and which line is playing.
- **The igloo:** on the computer, the party looks like the inside of an igloo: DJ Nanuq in the center and, around it, a Nanuq for each guest in **their** theme's costume with their name below (when the song they picked plays, their name takes their theme's color and their Nanuq lifts the cover with both hands —and whatever it was holding, like the cup or the grapes, goes on top of the cover—, grows a little and hops more happily among sparkles); they come and go with a smooth transition. While music plays, the DJ spins, the Nanuqs dance, there are party lights and the lyrics are projected on the ceiling; in the bottom-right corner is the playing song like in the player's DJ: its cover on the sleeve and the vinyl record coming out of it, spinning (each new song drops in); when paused, everyone rests. The corner button makes it full screen (ideal for a TV): there, at the bottom, **Up next** appears, a row with what's next in the list (the nearest on the left), each with its cover, name and album, and below who picked it (in their Nanuq's theme color); above the row, always visible, the **code to join** (the IP address isn't shown: if a phone can't find the room, hover the mouse over the code on the party card to see it). Tap a song in the row to play it now (the one playing and those before it are skipped and removed from the list); drag it to change the order (with a finger: press and hold it and move it); scroll the row with the mouse wheel or by swiping. The mouse pointer hides if you don't move it for a few seconds. It's only animated while you're looking at it.
- **Controls on the computer:** while a party song plays (or is paused), the space bar, the play, next and previous buttons, the volume, mute and the system controls (GNOME/KDE panel, media keys, taskbar) control **the party**, and the system controls show its song. If you play your own music, the party pauses and the controls go back to your queue until you resume the party.
- **Volume in full screen:** with the igloo in full screen, the **↑** and **↓** arrows raise and lower the volume in 5% steps and a notice with the percentage appears at the top (with the room open, the player's volume bar is hidden). Outside full screen, the arrows don't change the volume.
- Songs are only stored for a while on the computer: they're deleted when they play, if they've been in the list for more than 2 hours, when removed or when the room closes. At most 10 songs per guest, 60 in the list and 80 MB per song.
- While the room is open, the computer listens on your local network (TCP 47864 and UDP 47865). Security details in [SECURITY.en.md](../SECURITY.en.md).

## Search by lyrics

Don't know its name but remember a bit of the lyrics? Type it in **Search** (at least 4 letters): besides artists, albums and songs, **In the lyrics** shows up, with the matching line highlighted (ignoring accents, capitals and punctuation). It also works in the phone's Party search.

Jellyfin doesn't search inside lyrics, so Nanuq builds its own index: the first time it reads the lyrics of every song Jellyfin marks as having lyrics (a few at a time, so it doesn't load your server; you'll see the progress) and afterwards it only adds new ones. The index is stored encrypted on your device and deleted when you log out.

## Refresh from Jellyfin

**Settings → Server → Refresh from Jellyfin** asks your server again for your library's data (albums, songs, covers, favorites and the songs in your queue), in case you changed something in Jellyfin and Nanuq still shows the old version. If your user is an administrator, it also asks Jellyfin to scan your files and, half a minute later, fetches whatever changed.

## Fade on pause

When you pause, the music fades out before stopping; when you resume, it fades in. It works with the button, the keyboard, the notification and the controls of your other devices, also with the screen off. It lasts 0.5 to 5 s (**Settings → Fade length**, 1 s by default); tapping ▶ while it fades out brings it back up and the curve follows decibels, the way the ear hears it. Turn it off in **Settings → Fade on pause**.

## Crossfade between DJ songs

With DJ Nanuq, in the last seconds of a song the next one already starts: the ending song fades out while the new one fades in (constant-power curve, no dip in the middle). Choose it in **Settings → Crossfade between DJ songs**: 3, 4 (default) or 5 s, or off. It doesn't happen with “Repeat one”, while controlling another device, at a party or while you sync lyrics.

## Formats and quality

By default Nanuq asks for the lowest quality, **96 kbps** (it uses less data; in Opus it sounds good), and the maximized player shows how each song arrives between the two times (e.g. “Opus · 96 kbps”, “Original” or “On the phone”). Change it in **Settings → Streaming quality**. With **Original** quality, your files play as they are: FLAC, Opus, AAC/M4A, MP3, WAV, OGG. If you pick a lower bitrate (or the file goes over it), Jellyfin converts it to **Opus** (better sound than MP3 at the same bitrate) or MP3: **Settings → Conversion format** (only shown if your player opens Opus). If a song won't start in Opus, Nanuq asks for it in MP3 and remembers. Phone downloads are saved in that same format (or the file as-is with “Original”). While you drag the progress bar, the song stays silent and plays again where you let go.

## Queue in the player

In the full-screen player, the **Queue** button swaps the cover for the list of what's next (with the same transition as the lyrics; on wide screens, the cover stays on the left). Tap a song to play it; right-click or press and hold for its options. Lyrics and Queue alternate.

**Moving songs:** drag them by their handle (≡, to the right of each song), with the mouse or a finger, in the player's queue, the queue panel or the **Queue** tab. The others shift to show where it will land and, near the edge, the list scrolls on its own. The one playing keeps playing. If you're controlling another device, its queue changes too (there it continues at the same second; with the DJ, it's still the DJ).

## Albums from your songs

Jellyfin builds albums by folder: if many songs live in the same folder (for example, the ones SomeDL downloads), they show up as a single giant album, and a record split across two folders comes out split. Nanuq builds them from **each song's tags**: the album and its album artist (or the first artist). That way, in **Albums**, on Home, on each artist (“Albums” and “Appears on”), in genres and in Search you see the real records. “Album (Disc 2)” or “(CD 2)” are joined with their record, and if you have the same record twice, each song shows up only once (the copy you played most). “Go to album” from a song opens its record.

The first time, Nanuq reads all your songs (a few seconds); afterwards the index is stored encrypted on the device, shows up instantly and refreshes itself every 10 minutes. **Retry** or a new song from SomeDL refresh it sooner. **Folders** still show how your server is organized.

## Nanuq takes care of the battery

Nanuq dances for a few seconds every time a song starts and then stays happy and still; the Home scenes move when you arrive or tap them. The DJ and its record move all the time **while you're looking at them** (the player open with the DJ or the DJ screen; when paused, Nanuq keeps blinking and breathing) and stop when they're no longer on screen: on the phone with the lyrics or the queue on top (on a computer they're side by side and the DJ keeps moving), with the player minimized or in another section, with the screen off or locked, or with Nanuq in the background. When you come back, they continue.

**Settings → Player animations** chooses what the player shows with the DJ: **All** (Nanuq with its turntable and the spinning record), **Just the vinyl record** (without Nanuq) or **None** (the usual cover; the DJ's introductions arrive as a notice). On phones with a 120 Hz screen, an animation that never stops forces 120 frames per second to be drawn: measured on a mid-range Android phone, with music playing Nanuq went from using between 1.7 and 3 processor cores to 0.6 (almost the same as playing audio), and when paused to almost nothing. That way the phone doesn't heat up or slow down.

## Song options

In the full-screen player's **⋮**, in the menu of any song in a list, and in the **queue** (right-click on a computer, press and hold on the phone):

- **Start song radio**: uses Jellyfin's instant mix, with similar songs by artist, album and genre. If that song is already playing, it isn't interrupted: the queue becomes its radio.
- **Add to a playlist**: choose one of your playlists or create a new one.
- **Add to favorites / Remove from favorites**: it's saved in Jellyfin and Nanuq checks it by reading it back from the server. If Jellyfin didn't save it, it tells you.
- In the queue, also: play now, play next and remove from the queue.

When you add a song to a playlist (or create a new one), the playlist you have open updates itself, without reloading.

## Favorites

In **More → Favorites** (or in the sidebar, on a computer) are all the songs you marked with ♥.

The list comes from the favorites Jellyfin has marked with ♥ (the same source as the player's button, so they never contradict each other). If you have the [Favorited Songs Playlist](https://github.com/Saturn745/jellyfin-favorited-songs-playlist) plugin in your Jellyfin, a link to **your** favorites playlist appears at the top (by default “User's: Favorited Songs”); it isn't used as the source because it can fall behind. When you mark or unmark one, the list changes right away. You can sort them by title, artist, album, recently added, recently played or most played, and play them in order, shuffled or send them to the queue. If you remove a favorite, it disappears from the list right away.

Favorites are saved in Jellyfin, with your user: you see them on all your devices and in any other Jellyfin app. Every time you enter the section, Nanuq instantly shows the last list and confirms it with Jellyfin. If someone marks or unmarks a favorite on another device or app with your user, the section updates itself while you're looking at it (with “Sync with my other devices” turned on in Settings, which it is by default).

## Controlling another device

For security, each Nanuq only lets devices of **your same user** play songs on it. If you want another user of your Jellyfin (for example, an administrator) to be able to do it, turn on **Settings → Accept commands from other users**. The **My devices** list shows each one's address: if you see one you don't recognize, change your password.

When you send the music to another device (or control what's playing on it) from **My devices**, the system controls stay there: the taskbar or the GNOME/KDE panel, the keyboard's media keys and the lock screen show the song playing on the other device and their buttons control it. For the system to keep them, Nanuq plays a silent audio while the remote control lasts (it doesn't use data).

## Notes

- The theme (Navy, Dark, Light…), the quality, the language, the queue and the session are saved on the device.
- **Save** in the queue creates a playlist in your Jellyfin.
- The real waveform is off by default because it downloads a light copy of each song. Turn it on in Settings.
