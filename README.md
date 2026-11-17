# Music Player

**Music Player by Buildiful®** is a free, open-source, ad-free music player for your own audio files. It runs in the browser, stores imported music and playlists on your device, and can be installed as a Progressive Web App (PWA).

No account, backend, subscription, or audio upload is required.

## Features

- Import local audio files (including multiple files), select a folder on supported browsers, or drag and drop files.
- Keep an offline-capable library and create, rename, and delete playlists.
- Add and remove songs from playlists without changing the original files.
- Favorites, search, sorting, and an Up Next queue.
- Play, pause, stop, previous, next, seek, volume, mute, shuffle, repeat all, and repeat one.
- Lock-screen / hardware media controls where the browser implements the Media Session API.
- Install as a desktop or mobile PWA; download a separate offline copy from Settings.
- Optional, consent-based Google Analytics 4. Music contents and names are never sent.

## Supported audio

Supports common audio file extensions: MP3, M4A, AAC, WAV, OGG/OGA, FLAC, OPUS, AIFF/AIF. **Actual playback depends on your browser's audio codecs and the file encoding.** Protected streaming-library downloads and DRM-restricted files are not supported. MP3 ID3 title, artist, and album tags are read locally when available; other files default to their filenames (artist can be derived from `Artist - Title.ext`).

## How local storage works

On import, the app **copies** each file into the device's browser storage (IndexedDB). The original file stays at its original location. These local copies make it possible to reopen playlists after a browser restart without requesting access to the original file again. They also take additional local storage space.

Neither audio files nor playlists are sent to Buildiful's servers. Files are not hosted on GitHub Pages. Browser storage limits vary. If browser storage is unavailable, the player falls back to a temporary session (the app will warn you). Clearing website data, uninstalling the app, or browser storage eviction may remove imported copies and playlists. Keep your originals as your backup.

The iOS Files picker supports selecting individual audio files; whole-folder selection and file formats depend on the browser and device. Files imported in Safari and in a separately installed Home Screen app may be stored in different browser containers. If needed, import the files into the installed app again.

## Install the app

**Desktop:** On Chrome or Edge, visit the deployed site and use the browser's Install app option. On macOS Safari (version 17+), use File → Add to Dock. The installed app can launch in its own window and run offline after its shell has cached on that device. It is a browser-managed app, **not** a native `.app` or `.exe` binary.

**iPhone:** Open the deployed site in Safari, tap Share → Add to Home Screen, enable Open as Web App if offered, and tap Add. Launch the app once while online to populate its offline cache. Play music imported within the Home Screen app. Background/lock-screen playback is subject to iOS browser restrictions.

**Downloaded offline copy:** In Settings, select **Download offline copy**, unzip `Music-Player-Offline.zip`, and open `index.html`. The web player UI works without GitHub Pages or a network connection. Browser security rules for local `file://` pages differ; local library persistence can be unavailable (temporary session in that case), and service-worker installation is not available from this copy. For the most reliable persistent offline library, use the installed PWA instead. The local-file copy never loads Google Analytics.

Browser installation controls differ: the app's **Install app** button opens a native prompt if available, or shows platform-specific instructions otherwise. An `install_click` event means the user clicked that button; it does not prove installation. Browsers such as iOS Safari do not reliably report completed Home Screen installations to websites.

## Deploy on GitHub Pages

1. Create a public GitHub repository and commit the **contents of this directory** to the repository root, including `.nojekyll`, `sw.js`, `manifest.webmanifest`, `assets/`, and `downloads/`.
2. In repository Settings → Pages, set Build and deployment to **Deploy from a branch**, select `main` and `/ (root)`, then save.
3. Open the resulting HTTPS site. Try adding music, installing the app, going offline, and reopening the installed app.
4. If you upgrade the app shell later, update the cache version in `sw.js` so installed copies can refresh.

No build tool, package manager, external JavaScript dependency, or server API is required. For local testing (recommended for a PWA), run `python3 -m http.server 8000` in this directory and open `http://localhost:8000`. Service workers install on HTTPS or localhost; they cannot install on ordinary `file://` pages.

## Analytics and privacy

`buildiful-analytics-consent.js` uses GA4 measurement ID `G-TG14RBXLTF`. It **never loads Google's tag until users opt in**. The app has a Privacy link and an Analytics settings control. The consent choice is stored locally; denying analytics does not affect the app. Analytics excludes query strings, song names, filenames, playlists, audio blobs, and listening history.

Allowlisted events: `music_import` (source + count), `music_remove`, `playlist_create`, `playlist_delete`, `playlist_add_track`, `playlist_remove_track`, `library_clear`, `install_click` (platform category), `install_prompt_accepted`, `app_installed` (when exposed by browser), and `offline_copy_download_click`. These are limited usage actions, **not** proof that a file was downloaded or an app was installed. GA4 may collect device data and set cookies after consent; see `privacy.html`.

No Google Analytics network requests should occur when consent is declined, unanswered, or when using the downloaded local-file copy. Do not include a second GA tag in `index.html`.

## Rights

Only play music files that you have the rights or permission to play. This application does not provide or license any music.

## Project layout

```text
index.html                     App interface
styles.css                     Responsive styles
app.js                         Local library, playlists, audio player
buildiful-analytics-consent.js Opt-in analytics module
privacy.html                   Privacy notice
manifest.webmanifest           Installable app metadata
sw.js                          Offline app-shell cache
assets/                        Official Buildiful® branding + PWA icons
downloads/                     Standalone offline copy ZIP
QA_CHECKLIST.md                Release and test checklist
.gitignore / .nojekyll         Repository / GitHub Pages settings
LICENSE                        MIT code license, excluding brand assets
```

## License

The software is MIT licensed; see `LICENSE`. The Buildiful® name, trademark, logo, and supplied brand identity assets are **not** licensed for reuse as third-party branding. Forks may replace the brand assets with their own.
