# Music Player v1.3.0 — Release notes

- Library relink: select new folders/files, review high-confidence matches, resolve ambiguities, or relink a song individually. Existing song IDs, edited details, playlists and favorites are retained.
- Storage manager: review optional offline audio by song, album and playlist; select copies to remove, search and review approximate browser usage and quota. Legacy copied audio stays protected until the original is relinked.
- Incremental performance: local sampled signatures are stored with new imports; bulk matching uses indexes rather than comparing every source against every catalog row.
- Improved mobile layout for both new dialogs.
- Added the standardized `mobile-web-app-capable` meta tag and stopped unconditionally cancelling native install banners. The in-app Install control remains available.
- Revised the music rights notice for clarity.
- Retained Buildiful® brand assets, consent-based optional GA4 and the GitHub Pages offline app shell.

See `QA_CHECKLIST.md` for device-specific manual testing. Source files are not uploaded, moved or deleted by the player. A browser may revoke file permission or evict local storage. No native iPhone app is included in this release.
