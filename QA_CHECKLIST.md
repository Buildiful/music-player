# Music Player — release and test checklist

## Repository hygiene

- [x] Official Buildiful® logo is used in the header (`assets/buildiful-logo-white.png`).
- [x] Official Buildiful® favicon formats are referenced (favicon ICO/16/32 and Apple touch icon).
- [x] App icons (192/512) are built from the supplied favicon asset.
- [x] `.gitignore` and `.nojekyll` are present.
- [x] Standalone app, README, source comments, metadata, and documentation have been reviewed for public release.
- [x] Consent-based GA4 module and privacy notice are included; no additional GA snippet.
- [x] No credentials, audio content, user filenames, or personal test files included.

## Functional checklist

- [ ] Import MP3 files on a Mac and check local persistence after reload.
- [ ] Import from a folder on a supported desktop browser.
- [ ] Import MP3 files from iPhone Files (not a protected streaming library).
- [ ] Create/rename/delete playlists; add/remove songs; try favorites and search.
- [ ] Play, pause, stop, seek, previous, next, shuffle, repeat and volume.
- [ ] Close and reopen the PWA; verify library is present without internet.
- [ ] Install from macOS browser and from iPhone Share → Add to Home Screen.
- [ ] Validate device lock-screen audio behavior; browser/iOS limitations may apply.
- [ ] Try clearing browser storage, then check that original audio files remain untouched.
- [ ] Confirm decline or unanswered analytics consent loads no Google tracking tag and sends no requests.
- [ ] Confirm consented feature events, Analytics settings, and withdrawal.
- [ ] Check responsive interface, keyboard controls, and browser compatibility.

The interactive device/browser checks above require user testing on their devices; repository inclusion is not a substitute for these tests.
