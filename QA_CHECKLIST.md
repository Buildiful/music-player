# Music Player — Release QA Checklist

## Install and upgrade

- [ ] Load the HTTPS GitHub Pages deployment; confirm the official Buildiful® logo, favicon, privacy link, copyright, and correct version.
- [ ] Upgrade an existing catalog from v1.0.x / v1.1.x. Verify song details, playlists, favorites, and previously stored copies remain available.
- [ ] Verify the service worker upgrades its cache to v1.3.0 and the interface opens offline after one successful online load.
- [ ] In Chrome/Edge, install as a desktop PWA; import from original folder, close and reopen, and check permissions/reconnection.
- [ ] On iPhone Safari, Add to Home Screen; separately test importing in that installed app and reopening offline.

## Import larger libraries

- [ ] Use an 11-track album, a folder with 100+ tracks, and a collection with 1,000+ tracks. Confirm counts, visible progress, no unexpected duplicate copies, and no page freeze.
- [ ] With a large folder, confirm `Scanning folder` appears before `Adding music`, and `Stop` retains completed songs.
- [ ] Confirm errors appear under the progress bar, rather than disappearing into the developer console; dismiss and start another import.
- [ ] Verify multi-select, nested folder import where supported, drag/drop, re-adding the same tracks, searching, sorting and Show more with 150+ songs.
- [ ] On an unsupported file picker, confirm temporary links reconnect by matching filename, size, and modified time after reselecting files.
- [ ] With quota near full, confirm the import reports failures and existing songs remain unaffected.

## Library relink and Storage manager

- [ ] Take a backup of your working library (or test in a fresh browser profile) before migrating an important catalog; test v1.2.0 → v1.3.0 without resetting IndexedDB.
- [ ] Import originals, manually edit title and artist, mark as favorite, add to a playlist; move/rename originals and relink using the new file/folder selection. Confirm song ID, edits, favorite, and playlist membership remain.
- [ ] Test relinking on an existing v1.2.0 catalog without audio signatures: unchanged-size and modification-date matches; if unresolved, manually select the correct file.
- [ ] Test a folder containing several identically-sized audio files; ambiguous matches must require review and never link automatically without confirmation. Confirm one original is not linked to multiple catalog tracks in the same batch.
- [ ] Test no matches and cancelled scans: catalog entries must not be modified. Test browser permission denial and removable drives going offline.
- [ ] In Storage manager, group by song, album and playlist; select/deselect, search and paginate with hundreds of offline songs. A track in two playlists must not be counted twice when deleting selected copies.
- [ ] Remove some but not all offline copies; ensure retained ones remain playable, and neither original audio files nor playlists are modified. Verify counts after reload.
- [ ] Confirm old v1.0 legacy copies are reported separately, are not silently deleted, and become individually removable only after a reference is re-established or an offline copy exists.
- [ ] Confirm browser-estimated usage/quota is clearly labelled as approximate, not guaranteed free space.

## Song metadata and offline choices

- [ ] Import MP3 samples with ID3v2.2, v2.3, v2.4 and ID3v1 tags. Verify title/artist/album, including UTF-8/UTF-16. Confirm filename fallback for missing tags.
- [ ] Edit title, artist, album, track number, year, genre; verify search and playback labels update; reload and confirm changes persist.
- [ ] Reconnect manually edited tracks; confirm edits remain and original MP3 files are unchanged.
- [ ] From a song's menu, keep it offline. Reload in the same origin and verify it plays with no source file permission when storage is retained.
- [ ] Keep an album or playlist offline and test progress/cancellation, storage quota messaging, and optional copy removal.
- [ ] Enable **Keep newly added music offline**, import a few songs, verify copies are made, then disable it and confirm later imports remain reference-only.
- [ ] On iPhone Home Screen, import and save an album offline; relaunch with Wi-Fi/mobile data disabled. Confirm playback. Check OS storage settings and the app's storage warning.

## Playback and privacy

- [ ] Play/pause/stop/next/previous, seek, repeat, shuffle, volume, background/lock-screen controls where supported.
- [ ] Create, rename and delete playlists; favorite/unfavorite songs; ensure removing a catalog entry never deletes the original file.
- [ ] Confirm no audio request, file path, name, playlist name, song title, relink information or listening history reaches any external service.
- [ ] Decline GA: no GA script or requests. Allow GA: only sanitized action types, counts and platform categories. Withdraw consent and confirm requests stop after reload.
- [ ] Check `mobile-web-app-capable` meta, and that a custom Install click calls the prompt when available without unconditionally suppressing the browser native banner.
- [ ] Download the offline ZIP and confirm it opens with `file://` without assets missing; note that no service worker or persistent handles are available.
- [ ] Check mobile widths (320–430px), desktop widths, keyboard navigation, labels, dialogs, Storage Manager, Library relink and import status aria-live.

## Publishing

- [ ] Verify `.gitignore`, `.nojekyll`, LICENSE, README, official Buildiful® logo and favicon assets.
- [ ] Search **all** public code/docs/asset text for campaign or numbered-day references (none allowed).
- [ ] Confirm service worker cache version is incremented and app shell assets update after deployment.
- [ ] Test on a real iMac and iPhone before announcing a production upgrade; simulated browser tests do not replace device verification.
