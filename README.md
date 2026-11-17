# Music Player

**Music Player by Buildiful®** is a free, open-source, ad-free player for music you already have. No account, streaming service, backend, or audio upload is required. The original audio files never leave your device.

## Features

- **Reference-only library by default.** Add music files or folders, or drag and drop. New imports save song details and, where supported, file handles—not duplicate audio.
- **Large-library friendly.** Clear scanning/import progress, success and failure counts, Stop action, and a song list that shows 150 rows at a time. You can search and sort the entire catalog, not just the rows currently displayed.
- **Edit song info.** From any song's `•••` menu choose **Edit song info** to change title, artist, album, track number, year, or genre. Edits are stored in your player library, **not written to the original music file**. They survive relinking the same source file.
- **MP3 tags.** Locally reads ID3v2.2, ID3v2.3, ID3v2.4 and ID3v1 tags where available; uses filenames as a fallback. Other formats may use filenames or `Artist - Title` naming.
- **Playlists and playback.** Favorites, playlists, search, Up Next, pause/play/stop, previous/next, seek, shuffle, repeat, volume, and mute.
- **Optional offline copies.** Use Settings → **Keep newly added music offline**, or keep an individual song/album/playlist offline from its menu. This stores a **second copy** of selected audio in this browser's IndexedDB so supported offline installations, including iPhone Home Screen apps, can reopen and play those tracks without reselecting them while the data remains available.
- Installable PWA and standalone offline ZIP. Consent-based GA4 with no song or playlist content included in events.

## How the library works

### Reference-only mode (the default)

On supported Chromium desktop browsers, selecting originals yields file handles stored alongside the music catalog in IndexedDB. Chrome or Edge may ask you to allow file access again later. You must keep the originals accessible, including external drives. No audio is copied into browser storage.

Other browsers (including Safari on iPhone) can use a temporary reference during the current session. Song information and playlists remain in the browser's catalog, but **original files must be selected again after reopening** unless you saved optional offline copies. When matching files are selected again, the application reconnects them using filename, size, and modification time. No files are uploaded.

Adding a folder on supported browsers scans subfolders. Large folders can take time. The scan and import are shown separately; you can stop either operation. The list uses a **Show more** button so a 10,000-song library does not render all 10,000 rows at once. Device/browser conditions still affect import time and the practical library size; a particular capacity is not guaranteed.

### Offline copies (optional)

Offline copies are independent of original file handles. You can:

1. Turn on **Keep newly added music offline** in Settings *before importing* to copy only music you select from then on.
2. Select **Keep available offline** from a song's `•••` menu.
3. Select **Keep this album offline** from a song with an album name, or open a playlist and select **Keep offline**.

Offline copies consume additional browser storage, approximately the same size as the selected source audio. They are intended to improve the iPhone experience, but are **not as durable as the original files**: the browser/OS may erase or evict its storage under some circumstances. Clearing website data, deleting the Home Screen app, or changing browsers can also erase the stored catalog and offline copies. **Always keep your original files elsewhere.** You can remove optional copies in Settings without modifying your originals. Local copies may be unavailable if storage is full or restricted; the importer reports these failures.

**Important for iPhone:** Safari and an installed Home Screen PWA may have separate storage; import and save music from the version you intend to use. Open the installed app once while online for the offline app shell to be cached. On iOS, the original Files app file selection may still be required when adding new music. A native iPhone edition is not part of this release.

### Prior library versions

The database name is unchanged. Catalogs, favorites, playlists, and old copied audio from earlier versions remain available after the upgrade. Earlier copied tracks are not deleted automatically; reselect their original files to migrate them to references. Settings reports remaining old copies and new offline copies. The original files are never modified or deleted, even when you remove a song from Music Player.

## Platform guidance

| Platform | Source references after restart | Optional offline copies |
| --- | --- | --- |
| Chrome / Edge on Windows, macOS, Linux | Usually reusable, subject to browser permissions | Yes |
| Chrome on Android | File picker/handle support depends on Chrome version and Android permissions; device test recommended | Yes, subject to quota |
| Safari on macOS / Firefox | Typically reselect originals | Yes, subject to quota |
| Safari / Home Screen on iPhone | Reselect originals | Yes, subject to quota and storage retention |
| Standalone `file://` ZIP | Typically temporary references; no service worker | Session and browser-policy dependent |

Audio support: MP3, M4A, AAC, WAV, OGG/OGA, FLAC, OPUS, AIFF/AIF. Browser decoders determine which file encodings actually play; the app does not transcode or bypass DRM.

## Install and deploy

**GitHub Pages:** Publish the contents of this ZIP at your public repository root. Under Settings → Pages, choose Deploy from a branch → `main` → `/ (root)`. HTTPS is required for persistent file-handling APIs and service worker functionality. For local PWA QA, run `python3 -m http.server 8000` from this folder and open `http://localhost:8000`.

**Home Screen:** On iPhone, open the published page in Safari and choose Share → Add to Home Screen. After adding, launch the Home Screen version and import music there if you want its offline copies to be associated with the installed app's storage.

**Desktop installation:** In a supported desktop browser, use its Install app menu or button. A PWA is not a native `.app` or `.exe` installer.

**Standalone ZIP:** Unzip `downloads/Music-Player-Offline.zip` and open `index.html` directly. The `file://` version cannot install a service worker or use the persistent Chromium file pickers, and Analytics is disabled. File linking and storage persistence may differ from the HTTPS version.

## Privacy, rights, and analytics

Music and metadata are processed locally and are never uploaded to Buildiful or GitHub Pages. With permission, GA4 measures only a restricted set of feature actions and numeric counts, such as music imports, edits, optional offline copies saved or removed, playlist actions, and installation/download clicks. **It is not passed song titles, artist names, filenames, paths, playlists, or playback history.** Google Analytics is not loaded before opt-in. See `privacy.html`.

Only play files you have the rights or permission to use. This software does not distribute or license music.

## Repository contents

```text
index.html                     Interface, dialogs, accessible controls
styles.css                     Responsive appearance
app.js                         IndexedDB catalog, song tags, imports, edit and playback
buildiful-analytics-consent.js Optional analytics consent
privacy.html                   Privacy notice
manifest.webmanifest           PWA manifest
sw.js                          Offline app shell cache
assets/                       Official Buildiful® assets
  favicon.ico, favicon PNGs, apple-touch icon, PWA icons, white logo
downloads/                     Separate standalone offline package
QA_CHECKLIST.md                Manual verification checklist
.gitignore / .nojekyll         GitHub Pages support
LICENSE                        MIT code license (excluding branding assets)
```

## License

The app's source code is MIT licensed (see `LICENSE`). Buildiful® trademarks and supplied brand assets are not licensed for other projects' branding. Replace them with your own in derivatives.
