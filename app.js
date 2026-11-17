(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const audio = $('audioEl');
  const supported = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|aiff|aif)$/i;
  const state = {
    tracks: [], playlists: [], view: 'all', playlistId: null, search: '', sort: 'added',
    currentId: null, queue: [], queueBase: [], shuffle: false, repeat: 'off',
    editingPlaylistId: null, menuTrackId: null, objectUrl: null,
    stopped: true, volume: 0.8, persistence: 'device', installPrompt: null,
    toastTimer: null, dragDepth: 0, sessionFiles: new Map(), importing: false,
    importCancelled: false, importFailures: [], importSummary: null,
    listLimit: 150, keepNewOffline: false, offlineTask: false
  };
  const analytics = (event, details = {}) => window.buildifulAnalytics?.track?.(event, details);
  const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const fmt = time => { if (!Number.isFinite(time) || time < 0) return '0:00'; const t = Math.floor(time); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const shortSize = bytes => bytes >= 1024**3 ? `${(bytes / (1024**3)).toFixed(1)} GB` : bytes >= 1024**2 ? `${(bytes / (1024**2)).toFixed(1)} MB` : `${Math.round(bytes/1024)} KB`;
  const byId = id => state.tracks.find(t => t.id === id);
  const byPlaylistId = id => state.playlists.find(p => p.id === id);
  const sortByName = (a, b) => a.name.localeCompare(b.name, undefined, {sensitivity:'base'});
  const tick = () => new Promise(resolve => setTimeout(resolve,0));
  const finger = file => `${file.name}|${file.size}|${file.lastModified}`;

  // Metadata and file handles use IndexedDB. Audio copies are OPT-IN in a
  // separate store, not part of ordinary reference-only imports. Legacy audio
  // blobs remain available to protect libraries upgraded from older releases.
  class LibraryStore {
    constructor(db) { this.db = db; this.memoryTracks = new Map(); this.memoryPlaylists = new Map(); this.memoryOffline = new Map(); }
    static async create() {
      if (!('indexedDB' in window)) return new LibraryStore(null);
      try {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('buildiful-music-player-v1', 2);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', {keyPath:'id'});
            if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', {keyPath:'id'});
            if (!db.objectStoreNames.contains('offlineAudio')) db.createObjectStore('offlineAudio', {keyPath:'id'});
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Storage is blocked by another tab.'));
        });
        return new LibraryStore(db);
      } catch (error) { console.warn('Local storage unavailable. Using a temporary session.', error); return new LibraryStore(null); }
    }
    operation(store, type, method, arg) {
      if (!this.db) {
        const map = store === 'tracks' ? this.memoryTracks : store === 'playlists' ? this.memoryPlaylists : this.memoryOffline;
        if (method === 'getAll') return Promise.resolve([...map.values()]);
        if (method === 'get') return Promise.resolve(map.get(arg));
        if (method === 'put') { map.set(arg.id, arg); return Promise.resolve(arg.id); }
        if (method === 'delete') { map.delete(arg); return Promise.resolve(); }
        if (method === 'clear') { map.clear(); return Promise.resolve(); }
      }
      return new Promise((resolve, reject) => {
        let transaction;
        try { transaction = this.db.transaction(store, type); }
        catch (error) { reject(error); return; }
        const request = arg === undefined ? transaction.objectStore(store)[method]() : transaction.objectStore(store)[method](arg);
        let result;
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('Could not save locally.'));
        transaction.onabort = () => reject(transaction.error || new Error('Local storage was cancelled.'));
      });
    }
    tracks() { return this.operation('tracks','readonly','getAll'); }
    playlists() { return this.operation('playlists','readonly','getAll'); }
    putTrack(track) { return this.operation('tracks','readwrite','put',track); }
    deleteTrack(id) { return this.operation('tracks','readwrite','delete',id); }
    putPlaylist(playlist) { return this.operation('playlists','readwrite','put',playlist); }
    deletePlaylist(id) { return this.operation('playlists','readwrite','delete',id); }
    offline(id) { return this.operation('offlineAudio','readonly','get',id); }
    putOffline(id, blob) { return this.operation('offlineAudio','readwrite','put',{id,blob,size:blob.size}); }
    deleteOffline(id) { return this.operation('offlineAudio','readwrite','delete',id); }
    async clearOffline() { await this.operation('offlineAudio','readwrite','clear'); }
    async clear() { await this.operation('tracks','readwrite','clear'); await this.operation('playlists','readwrite','clear'); await this.clearOffline(); }
  }
  let store;

  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('visible'), 3800);
  }
  function closeSidebar() { $('sidebar').classList.remove('open'); $('mobileShade').classList.remove('show'); }
  function toggleSidebar() {
    const open = $('sidebar').classList.toggle('open'); $('mobileShade').classList.toggle('show', open);
  }
  function dialogOpen(el) { if (!el.open) el.showModal(); }
  function reportImportProgress(phase, done, total, detail = '') {
    const el = $('importStatus'); el.hidden = false;
    $('importPhase').textContent = phase;
    $('importDetail').textContent = detail;
    state.lastImportDone = done; state.lastImportTotal = total;
    $('importProgress').value = done;
    $('importProgress').max = Math.max(total,1);
    $('importCount').textContent = total ? `${done.toLocaleString()} / ${total.toLocaleString()}` : `${done.toLocaleString()} found`;
    $('cancelImportBtn').hidden = !state.importing;
    $('dismissImportBtn').hidden = state.importing;
  }
  function concludeImport(message, errors = []) {
    state.importing = false; state.offlineTask = false;
    const progress = $('importProgress');
    progress.max = Math.max(state.lastImportTotal||0,1);
    progress.value = state.lastImportDone || 0;
    $('importDetail').textContent = message;
    $('importCount').textContent = state.lastImportTotal ? `${(state.lastImportDone || 0).toLocaleString()} / ${state.lastImportTotal.toLocaleString()}` : `${state.lastImportDone||0} found`;
    $('importPhase').textContent = state.importCancelled ? 'Import stopped' : 'Import complete';
    $('cancelImportBtn').hidden = true; $('dismissImportBtn').hidden = false;
    $('importErrors').hidden = !errors.length;
    $('importErrors').textContent = errors.length ? `${errors.length} could not be added: ${errors.slice(0,4).join('; ')}${errors.length>4 ? `; and ${errors.length-4} more` : ''}` : '';
  }
  function allForView() {
    let tracks = state.tracks;
    if (state.view === 'favorites') tracks = tracks.filter(t => t.favorite);
    if (state.view === 'playlist') {
      const playlist = byPlaylistId(state.playlistId);
      tracks = tracks.filter(t => playlist?.trackIds.includes(t.id));
    }
    const search = state.search.trim().toLowerCase();
    if (search) tracks = tracks.filter(t => `${t.title} ${t.artist} ${t.album} ${t.filename}`.toLowerCase().includes(search));
    return [...tracks].sort((a, b) => {
      if (state.sort === 'title') return a.title.localeCompare(b.title, undefined, {sensitivity:'base'});
      if (state.sort === 'artist') return a.artist.localeCompare(b.artist, undefined, {sensitivity:'base'}) || a.title.localeCompare(b.title);
      return b.addedAt - a.addedAt || a.title.localeCompare(b.title);
    });
  }
  function renderNav() {
    $('allCount').textContent = state.tracks.length;
    $('navAll').classList.toggle('active',state.view === 'all');
    $('navFavorites').classList.toggle('active',state.view === 'favorites');
    $('playlistNav').innerHTML = state.playlists.slice().sort(sortByName).map(p =>
      `<button class="nav-item ${state.view === 'playlist' && state.playlistId === p.id ? 'active' : ''}" data-playlist-id="${p.id}">${icon('list')}<span>${escapeHtml(p.name)}</span></button>`).join('');
  }
  function renderTracks() {
    const tracks = allForView();
    const shown = tracks.slice(0,state.listLimit);
    const title = state.view === 'playlist' ? (byPlaylistId(state.playlistId)?.name || 'Playlist') : state.view === 'favorites' ? 'Favorites' : 'All songs';
    $('viewTitle').textContent = title;
    $('viewEyebrow').textContent = state.view === 'playlist' ? 'YOUR PLAYLIST' : 'YOUR LIBRARY';
    $('viewDescription').textContent = `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;
    $('playlistActions').hidden = state.view !== 'playlist';
    $('keepPlaylistOfflineBtn').hidden = state.view !== 'playlist';
    $('trackList').innerHTML = shown.map((t, i) => `<div class="track-row ${t.id === state.currentId ? 'is-playing':''}" role="listitem" data-id="${t.id}">
        <span class="track-index">${i+1}</span><div class="track-cover" aria-hidden="true">${icon('music')}</div>
        <button class="track-main" data-play-id="${t.id}" title="${trackAvailable(t) ? 'Play' : 'Reconnect'} ${escapeHtml(t.title)}"><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(t.artist || 'Unknown artist')}${trackAvailable(t) ? '' : ' · Reconnect'}</span></button>
        ${t.favorite ? `<span class="track-fav" title="Favorite">${icon('heart')}</span>` : ''}${t.offlineSaved || t.blob ? `<span class="offline-mark" title="Saved for offline listening">${icon('download')}</span>` : ''}
        <span class="track-duration">${t.duration ? fmt(t.duration) : '—'}</span>
        <button class="icon-btn row-action" aria-label="Options for ${escapeHtml(t.title)}" data-more-id="${t.id}">${icon('more')}</button></div>`).join('');
    const extra = Math.max(0,tracks.length-shown.length);
    $('moreTracksBtn').hidden = extra === 0;
    $('moreTracksBtn').textContent = extra ? `Show more (${extra.toLocaleString()} remaining)` : '';
    const noTracks = tracks.length === 0;
    $('emptyState').hidden = !noTracks;
    $('emptyAddBtn').hidden = state.tracks.length !== 0;
    if (noTracks) {
      const isLibraryEmpty = state.tracks.length === 0;
      $('emptyTitle').textContent = isLibraryEmpty ? 'A little quiet here.' : state.search ? 'No matches.' : 'Nothing here yet.';
      $('emptySubtitle').textContent = isLibraryEmpty ? 'Add some songs from your device.' : state.search ? 'Try a different search.' : state.view === 'favorites' ? 'Tap the heart on a song to save it here.' : 'Add songs from your library to this playlist.';
    }
  }
  function renderHero() {
    const t = byId(state.currentId);
    $('heroTitle').textContent = t?.title || 'Your music, your way.';
    $('heroArtist').textContent = t?.artist || 'Add music to start listening.';
    $('playingState').textContent = t ? audio.paused ? (state.stopped ? 'READY TO PLAY' : 'PAUSED') : 'NOW PLAYING' : 'READY WHEN YOU ARE';
    $('heroRecord').classList.toggle('spinning',Boolean(t && !audio.paused));
    $('heroActionBtn').innerHTML = t ? icon(audio.paused ? 'play' : 'pause')+`<span>${audio.paused ? 'Play' : 'Pause'}</span>` : icon('plus')+'<span>Add music</span>';
    $('heroNote').textContent = t ? `${state.tracks.length} songs in your library` : 'Files stay on your device';
    $('playerTitle').textContent = t?.title || 'Nothing playing';
    $('playerArtist').textContent = t?.artist || 'Add songs to begin';
    $('favoriteCurrentBtn').disabled = !t;
    $('favoriteCurrentBtn').classList.toggle('track-fav', Boolean(t?.favorite));
    $('favoriteCurrentBtn').setAttribute('aria-pressed', t?.favorite ? 'true' : 'false');
    const hasTrack = Boolean(t);
    for (const id of ['prevBtn','playPauseBtn','stopBtn','nextBtn','seekInput']) $(id).disabled = !hasTrack;
    $('playPauseBtn').innerHTML = icon(!audio.paused ? 'pause' : 'play');
    $('playPauseBtn').setAttribute('aria-label', !audio.paused ? 'Pause' : 'Play');
    $('playPauseBtn').title = !audio.paused ? 'Pause' : 'Play';
  }
  function renderQueue() {
    const idx = state.queue.indexOf(state.currentId);
    const next = idx >= 0 ? state.queue.slice(idx+1,idx+7) : [];
    if (!next.length) { $('queueBody').innerHTML = '<p class="quiet-caption">Your queue will appear here.</p>'; return; }
    $('queueBody').innerHTML = next.map(id => {
      const t = byId(id); if (!t) return '';
      return `<div class="queue-item"><div class="queue-art">${icon('music')}</div><button data-queue-id="${t.id}" title="Play ${escapeHtml(t.title)}"><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(t.artist)}</span></button></div>`;
    }).join('');
  }
  function renderAll() { renderNav(); renderTracks(); renderHero(); renderQueue(); updateStorage(); }
  function switchView(view, playlistId = null) {
    state.view = view; state.playlistId = playlistId; state.listLimit = 150;
    state.search = ''; $('searchInput').value = '';
    renderAll(); closeSidebar();
  }
  function setQueueFromView(trackId) {
    state.queueBase = allForView().map(t => t.id);
    if (!state.queueBase.includes(trackId)) state.queueBase = [trackId, ...state.queueBase];
    state.queue = state.shuffle ? shuffleQueue(state.queueBase, trackId) : [...state.queueBase];
  }
  function shuffleQueue(ids, firstId) {
    const rest = ids.filter(id => id !== firstId);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i+1)); [rest[i],rest[j]] = [rest[j],rest[i]]; }
    return firstId ? [firstId,...rest] : rest;
  }
  // Transient picker files live only in this tab. Persistent handles are available
  // on browsers offering the File System Access pickers (primarily Chromium).
  function trackAvailable(track) { return Boolean(track.blob || track.offlineSaved || track.handle || state.sessionFiles.has(track.id)); }
  async function sourceFile(track, allowPrompt = true) {
    if (track.blob) return track.blob; // Old copied library: retained for safe migration.
    if (state.sessionFiles.has(track.id)) return state.sessionFiles.get(track.id);
    if (track.offlineSaved) {
      try { const record = await store.offline(track.id); if (record?.blob) return record.blob; } catch (error) { console.warn('Offline audio unavailable:',error); }
    }
    if (!track.handle) return null;
    try {
      if (typeof track.handle.queryPermission === 'function') {
        let permission = await track.handle.queryPermission({mode:'read'});
        if (permission !== 'granted' && allowPrompt && typeof track.handle.requestPermission === 'function') {
          permission = await track.handle.requestPermission({mode:'read'});
        }
        if (permission !== 'granted') return null;
      }
      return await track.handle.getFile();
    } catch (error) {
      console.warn('File reference unavailable:', error);
      return null;
    }
  }
  async function selectTrack(id, playNow = true, resetQueue = false) {
    const t = byId(id); if (!t) return;
    if (resetQueue || state.queue.length === 0 || !state.queue.includes(id)) setQueueFromView(id);
    if (state.currentId !== id || !audio.src) {
      const file = await sourceFile(t, true);
      if (!file) {
        toast('File unavailable. Reconnect it with Add music or Add folder.');
        return;
      }
      audio.pause();
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.currentId = id;
      state.objectUrl = URL.createObjectURL(file);
      audio.src = state.objectUrl;
      audio.load();
      if ('mediaSession' in navigator && 'MediaMetadata' in window) {
        navigator.mediaSession.metadata = new MediaMetadata({title:t.title,artist:t.artist || 'Unknown artist',album:t.album || 'Music Player'});
      }
    }
    state.stopped = false;
    renderAll();
    if (playNow) await playAudio();
  }
  async function playAudio() {
    if (!state.currentId) {
      const t = allForView()[0] || state.tracks[0];
      if (!t) { await chooseFiles(); return; }
      await selectTrack(t.id,true,true); return;
    }
    try { await audio.play(); state.stopped = false; renderHero();  }
    catch (error) { toast('This audio file could not play in this browser.'); console.warn('Playback error:',error); }
  }
  function pauseAudio() { audio.pause(); state.stopped = false; renderHero();  }
  function stopAudio() { audio.pause(); try { audio.currentTime = 0; } catch {} state.stopped = true; updateSeek(); renderHero(); }
  function togglePlay() { if (!state.currentId || audio.paused) playAudio(); else pauseAudio(); }
  async function skip(direction, ended = false) {
    if (!state.queue.length) return;
    const idx = state.queue.indexOf(state.currentId);
    if (direction < 0 && !ended && audio.currentTime > 3) { audio.currentTime = 0; return; }
    let nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= state.queue.length) {
      if (state.repeat === 'all') nextIdx = (nextIdx + state.queue.length) % state.queue.length;
      else { if (ended) stopAudio(); else if (direction < 0) audio.currentTime = 0; else { stopAudio(); toast('End of queue'); } return; }
    }
    const nextId = state.queue[nextIdx]; if (!nextId) return;
    await selectTrack(nextId,true,false);
  }
  function updateSeek() {
    const len = Number.isFinite(audio.duration) ? audio.duration : (byId(state.currentId)?.duration || 0);
    const pos = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    $('elapsedTime').textContent = fmt(pos); $('durationTime').textContent = fmt(len);
    $('seekInput').value = len ? String(Math.min(100,(pos / len)*100)) : '0';
  }
  function updateControls() {
    $('shuffleBtn').classList.toggle('active',state.shuffle);
    $('shuffleBtn').setAttribute('aria-pressed',String(state.shuffle));
    $('repeatBtn').classList.toggle('active',state.repeat !== 'off');
    $('repeatBtn').setAttribute('aria-label',state.repeat === 'one' ? 'Repeat one' : state.repeat === 'all' ? 'Repeat all' : 'Repeat off');
    $('repeatBtn').title = state.repeat === 'one' ? 'Repeat one' : state.repeat === 'all' ? 'Repeat all' : 'Repeat off';
    $('repeatBtn').setAttribute('aria-pressed',String(state.repeat !== 'off'));
    $('repeatOneIndicator').hidden = state.repeat !== 'one';
    $('muteBtn').innerHTML = icon(audio.muted || audio.volume === 0 ? 'mute' : 'volume');
    $('muteBtn').setAttribute('aria-label',audio.muted ? 'Unmute' : 'Mute');
  }
  async function saveTrack(track) { await store.putTrack(track); }
  async function setFavorite(id) {
    const t = byId(id); if (!t) return;
    t.favorite = !t.favorite;
    try { await saveTrack(t); renderAll(); }
    catch { t.favorite = !t.favorite; toast('Could not save that change.'); }
  }
  function openTrackDialog(id) {
    const t = byId(id); if (!t) return;
    state.menuTrackId = id;
    $('trackDialogTitle').textContent = t.title;
    const playlist = state.view === 'playlist' ? byPlaylistId(state.playlistId) : null;
    $('trackDialogBody').innerHTML = `<button data-action="favorite">${t.favorite ? 'Remove from favorites' : 'Add to favorites'} ${icon('heart')}</button>`+
      (state.playlists.length ? '<div class="menu-caption">ADD TO PLAYLIST</div>'+
       state.playlists.slice().sort(sortByName).map(p => `<button data-action="toggle-playlist" data-target-id="${p.id}" class="${p.trackIds.includes(id) ? 'is-added':''}"><span>${escapeHtml(p.name)}</span>${p.trackIds.includes(id) ? icon('check') : icon('plus')}</button>`).join('') : '')+
      (playlist ? `<button data-action="remove-current">Remove from this playlist ${icon('x')}</button>` : '')+
      `<div class="menu-caption">SONG</div><button data-action="edit">Edit song info ${icon('pencil')}</button>`+
      (t.offlineSaved ? `<button data-action="remove-offline">Remove offline copy ${icon('x')}</button>` : `<button data-action="save-offline">Keep available offline ${icon('download')}</button>`)+
      (t.album ? `<button data-action="save-album">Keep this album offline ${icon('download')}</button>` : '')+
      `<div class="menu-caption">LIBRARY</div><button data-action="remove-library" class="warn">Remove song from library ${icon('x')}</button>`;
    dialogOpen($('trackDialog'));
  }
  async function handleTrackAction(button) {
    const action = button.dataset.action, id = state.menuTrackId;
    const t = byId(id); if (!t) return;
    if (action === 'favorite') { await setFavorite(id); $('trackDialog').close(); return; }
    if (action === 'edit') { $('trackDialog').close(); openEditDialog(id); return; }
    if (action === 'save-offline') { $('trackDialog').close(); await saveForOffline([t]); return; }
    if (action === 'remove-offline') { $('trackDialog').close(); await removeOffline([t]); return; }
    if (action === 'save-album') { $('trackDialog').close(); await saveForOffline(state.tracks.filter(x=>x.album && x.album===t.album));return; }
    if (action === 'toggle-playlist') {
      const p = byPlaylistId(button.dataset.targetId); if (!p) return;
      const already = p.trackIds.includes(id);
      p.trackIds = already ? p.trackIds.filter(x => x !== id) : [...p.trackIds,id];
      try { await store.putPlaylist(p); analytics(already ? 'playlist_remove_track' : 'playlist_add_track'); }
      catch { toast('Could not update playlist.'); return; }
      renderAll(); openTrackDialog(id); return;
    }
    if (action === 'remove-current') {
      const p = byPlaylistId(state.playlistId); if (!p) return;
      p.trackIds = p.trackIds.filter(x => x !== id);
      try { await store.putPlaylist(p); analytics('playlist_remove_track'); }
      catch { toast('Could not update playlist.'); return; }
      $('trackDialog').close(); renderAll(); return;
    }
    if (action === 'remove-library') {
      if (!confirm(`Remove "${t.title}" from Music Player's catalog? The original file will not be deleted.`)) return;
      try {
        await store.deleteTrack(id); await store.deleteOffline(id);
        state.tracks = state.tracks.filter(x => x.id !== id); state.sessionFiles.delete(id);
        for (const p of state.playlists) if (p.trackIds.includes(id)) { p.trackIds = p.trackIds.filter(x => x !== id); await store.putPlaylist(p); }
        state.queue = state.queue.filter(x => x !== id); state.queueBase = state.queueBase.filter(x => x !== id);
        if (state.currentId === id) resetAudio();
        $('trackDialog').close(); renderAll(); analytics('music_remove'); toast('Removed from library.');
      } catch { toast('Could not remove that song.'); }
    }
  }
  function resetAudio() {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (state.objectUrl) { URL.revokeObjectURL(state.objectUrl); state.objectUrl = null; }
    state.currentId = null; state.stopped = true;
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    updateSeek();
  }
  function openEditDialog(id) {
    const t=byId(id); if (!t) return;
    $('editTrackId').value=t.id;
    for (const key of ['title','artist','album','genre','year','trackNumber']) {
      $('edit'+key.charAt(0).toUpperCase()+key.slice(1)).value=t[key] || '';
    }
    dialogOpen($('editTrackDialog'));
    $('editTitle').focus();
  }
  async function saveSongInfo(event) {
    event.preventDefault();
    const t=byId($('editTrackId').value); if (!t) return;
    const updated={...t,manualEdits:{...t.manualEdits}};
    for (const key of ['title','artist','album','genre','year','trackNumber']) {
      const value=$('edit'+key.charAt(0).toUpperCase()+key.slice(1)).value.trim();
      updated[key]=value;
      updated.manualEdits[key]=true;
    }
    if (!updated.title) { $('editTitle').focus();return; }
    try {
      await store.putTrack(updated);
      Object.assign(t,updated);
      if (t.id===state.currentId && 'mediaSession' in navigator && 'MediaMetadata' in window) {
        navigator.mediaSession.metadata = new MediaMetadata({title:t.title,artist:t.artist || 'Unknown artist',album:t.album || 'Music Player'});
      }
      $('editTrackDialog').close(); renderAll(); toast('Song information saved.');
      analytics('song_info_edit');
    } catch (error) {console.warn('Song edit failed:',error);toast('Could not save changes.');}
  }
  // A local copy is optional. This is intentionally separate from track metadata
  // and is never enabled silently, particularly for large collections.
  async function saveForOffline(tracks, quiet = false) {
    if (!store.db) {toast('Offline copies need persistent browser storage. Open the HTTPS app.');return;}
    if (state.offlineTask || state.importing) { if (!quiet) toast('Finish the current import first.'); return; }
    const targets=tracks.filter(t=>!t.offlineSaved && !t.blob);
    if (!targets.length) { if (!quiet) toast('These songs are already available offline.');return; }
    if (!quiet && !confirm(`Save local offline copies of ${targets.length} ${targets.length===1?'song':'songs'}? This uses additional browser storage. Original files will not be changed.`)) return;
    state.offlineTask=true;state.importing=true;state.importCancelled=false;
    const errors=[];let done=0,saved=0,skipped=0;
    $('importErrors').hidden=true;
    for (const t of targets) {
      if(state.importCancelled)break;
      const file=await sourceFile(t,true);
      if (!file) {skipped++;errors.push('Could not access '+t.title);}
      else {
        try {
          await store.putOffline(t.id,file);
          const updated={...t,offlineSaved:true};
          try {await store.putTrack(updated);Object.assign(t,updated);saved++;}
          catch (e) { await store.deleteOffline(t.id);throw e; }
        } catch(e) {errors.push(`${t.title}: ${e?.name==='QuotaExceededError'?'Storage full':e?.message || 'Save failed'}`);}
      }
      done++;
      if(done%10===0 || done===targets.length) {
        reportImportProgress('Saving offline copies',done,targets.length,`${saved} saved · ${skipped+errors.length} unavailable or failed`);
        await tick();
      }
    }
    state.offlineTask=false;renderAll();
    concludeImport(`${saved} saved for offline listening${errors.length ? ` · ${errors.length} failed` : ''}.`,errors);
    analytics('offline_music_save',{file_count:saved});
  }
  async function removeOffline(tracks) {
    const targets=tracks.filter(t=>t.offlineSaved);
    if (!targets.length) return;
    if (targets.length>1 && !confirm(`Remove ${targets.length} saved offline copies? Original files will remain untouched.`))return;
    let removed=0;
    for(const t of targets){
      try {
        await store.deleteOffline(t.id);
        const updated={...t,offlineSaved:false}; await store.putTrack(updated);Object.assign(t,updated);
        removed++;
      } catch(e){console.warn('Could not remove offline copy:',e);}
    }
    renderAll();toast(`${removed} offline ${removed===1?'copy':'copies'} removed.`);
    analytics('offline_music_remove',{file_count:removed});
  }
  function openPlaylistDialog(id = null) {
    state.editingPlaylistId = id;
    $('playlistDialogTitle').textContent = id ? 'Rename playlist' : 'New playlist';
    $('playlistNameInput').value = id ? byPlaylistId(id)?.name || '' : '';
    dialogOpen($('playlistDialog')); $('playlistNameInput').focus();
  }
  async function savePlaylist(e) {
    e.preventDefault();
    const name = $('playlistNameInput').value.trim(); if (!name) return;
    if (state.editingPlaylistId) {
      const p = byPlaylistId(state.editingPlaylistId); if (!p) return;
      p.name = name;
      try { await store.putPlaylist(p); $('playlistDialog').close(); renderAll(); toast('Playlist renamed.'); }
      catch { toast('Could not rename playlist.'); }
    } else {
      const p = {id:uid(),name,trackIds:[],createdAt:Date.now()};
      try { await store.putPlaylist(p); state.playlists.push(p); $('playlistDialog').close(); switchView('playlist',p.id); analytics('playlist_create'); toast('Playlist created.'); }
      catch { toast('Could not create playlist.'); }
    }
  }
  async function deletePlaylist() {
    const p = byPlaylistId(state.playlistId); if (!p) return;
    if (!confirm(`Delete playlist "${p.name}"? Your songs will stay in your library.`)) return;
    try { await store.deletePlaylist(p.id); state.playlists = state.playlists.filter(x => x.id !== p.id); switchView('all'); analytics('playlist_delete'); toast('Playlist deleted.'); }
    catch { toast('Could not delete playlist.'); }
  }
  function candidateFiles(files) {
    return [...files].filter(f => f && (supported.test(f.name) || f.type.startsWith('audio/')) && f.size > 0);
  }
  function readTagText(bytes) {
    if (!bytes?.length) return '';
    let body=bytes.slice(1),encoding=bytes[0];
    try {
      if (encoding===0) return new TextDecoder('windows-1252').decode(body).split('\0')[0].trim();
      if (encoding===3) return new TextDecoder('utf-8').decode(body).split('\0')[0].trim();
      if (encoding===1 || encoding===2) {
        let charset=encoding===2?'utf-16be':'utf-16le';
        if(body[0]===254 && body[1]===255){charset='utf-16be';body=body.slice(2);}
        else if(body[0]===255 && body[1]===254){charset='utf-16le';body=body.slice(2);}
        return new TextDecoder(charset).decode(body).split('\0')[0].trim();
      }
    }catch{}
    return '';
  }
  async function id3Metadata(file) {
    if (!/\.mp3$/i.test(file.name)) return {};
    const tags={};
    try {
      const header=new Uint8Array(await file.slice(0,10).arrayBuffer());
      if(header.length===10 && String.fromCharCode(...header.slice(0,3))==='ID3') {
        const ver=header[3];
        if(ver>=2 && ver<=4) {
          const safe=(arr,i)=>arr[i]*2097152+arr[i+1]*16384+arr[i+2]*128+arr[i+3];
          const size=safe(header,6), max=Math.min(file.size,10+size,1024*1024);
          const data=new Uint8Array(await file.slice(0,max).arrayBuffer());
          let i=10;
          if(ver===3 && (header[5]&0x40) && i+4<data.length) {
            const n=data[i]*16777216+data[i+1]*65536+data[i+2]*256+data[i+3];
            i+=n+4;
          }
          if(ver===4 && (header[5]&0x40) && i+4<data.length) i+=safe(data,i);
          const names=ver===2?{TT2:'title',TP1:'artist',TAL:'album',TCO:'genre',TRK:'trackNumber',TYE:'year'}:{TIT2:'title',TPE1:'artist',TALB:'album',TCON:'genre',TRCK:'trackNumber',TYER:'year',TDRC:'year'};
          const width=ver===2?6:10;
          while(i+width<=data.length) {
            const id=String.fromCharCode(...data.slice(i,i+(ver===2?3:4)));
            if(!/^[A-Z0-9]{3,4}$/.test(id)) break;
            const len=ver===2 ? data[i+3]*65536+data[i+4]*256+data[i+5] :
              ver===4 ? safe(data,i+4) : data[i+4]*16777216+data[i+5]*65536+data[i+6]*256+data[i+7];
            if(!len || i+width+len>data.length) break;
            const field=names[id];
            if(field && !tags[field]) tags[field]=readTagText(data.slice(i+width,i+width+len));
            i+=width+len;
          }
        }
      }
      // ID3v1 tags at the end of MP3s are common in older CD-ripped libraries.
      if((!tags.artist||!tags.title||!tags.album) && file.size>=128) {
        const end=new Uint8Array(await file.slice(-128).arrayBuffer());
        if(String.fromCharCode(...end.slice(0,3))==='TAG') {
          const text=(start,length)=>new TextDecoder('windows-1252').decode(end.slice(start,start+length)).replace(/\0/g,'').trim();
          tags.title ||= text(3,30);tags.artist ||= text(33,30);
          tags.album ||= text(63,30);tags.year ||= text(93,4);
        }
      }
    } catch(error) { console.warn('Could not read local MP3 tags:',error); }
    return tags;
  }
  function basicFilename(file) {
    const name = file.name.replace(/\.[^.]+$/,'').replace(/_/g,' ').trim();
    const parts = name.split(/\s+-\s+/);
    return parts.length > 1 ? {artist:parts.shift().trim(),title:parts.join(' - ').trim()} : {title:name};
  }
  // Every new entry is a reference unless the user explicitly opts to retain
  // offline copies. Processing is incremental so large libraries stay responsive.
  async function importEntries(entries, source, scanning = false) {
    if (state.importing && !scanning) {toast('Finish the current import first.');return;}
    state.importing=true;
    if(!scanning) state.importCancelled=false;
    $('importErrors').hidden = true;
    const candidates=entries.filter(e=>e && ((e.file && candidateFiles([e.file]).length) ||
      (!e.file && e.handle?.kind==='file' && supported.test(e.handle.name))));
    if(!candidates.length){concludeImport('No supported audio files found.');return;}
    let added=0,linked=0,duplicates=0,failed=0,offlineSaved=0,offlineFailed=0;
    const errors=[];
    const existing=new Map(state.tracks.map(t=>[`${t.filename}|${t.size}|${t.modified}`,t]));
    reportImportProgress('Adding music',0,candidates.length,'Reading tags and saving references…');
    try {
      for(let idx=0;idx<candidates.length;idx++){
        if(state.importCancelled) break;
        const entry=candidates[idx];
        try {
          const file=entry.file || await entry.handle.getFile();
          const fingerprint=finger(file);
          const old=existing.get(fingerprint);
          if(old && (state.sessionFiles.has(old.id) || old.handle) && !entry.handle) {
            duplicates++;
          } else {
            const tags=await id3Metadata(file);
            const derived=basicFilename(file);
            const t=old?{...old}:{
              id:uid(),filename:file.name,title:tags.title||derived.title||file.name,
              artist:tags.artist||derived.artist||'Unknown artist',album:tags.album||'',
              genre:tags.genre||'',year:tags.year||'',trackNumber:tags.trackNumber||'',
              size:file.size,modified:file.lastModified,addedAt:Date.now()+idx,
              duration:0,favorite:false
            };
            // Preserve intentional edits. On reconnect, fill missing metadata
            // from existing tags without overwriting a user-edited value.
            if(old) for (const key of ['title','artist','album','genre','year','trackNumber']) {
              if(!t.manualEdits?.[key] && tags[key] && (!t[key] || (key==='artist'&&t[key]==='Unknown artist'))) t[key]=tags[key];
            }
            delete t.blob;delete t.handle;
            if(entry.handle)t.handle=entry.handle;
            try {await store.putTrack(t);}
            catch(e) {
              // Some browsers cannot serialize picker handles. Keep the catalog
              // and this-session file reference rather than losing the import.
              if(!entry.handle || !['DataCloneError','NotSupportedError'].includes(e?.name))throw e;
              delete t.handle;await store.putTrack(t);
            }
            if(old){
              if(state.currentId===old.id)resetAudio();
              Object.assign(old,t);delete old.blob;delete old.handle;
              if(t.handle)old.handle=t.handle;
              linked++;
            } else {state.tracks.push(t);existing.set(fingerprint,t);added++;}
            // A selected File is only an in-memory reference, not an audio copy.
            state.sessionFiles.set(t.id,file);
            if (state.keepNewOffline && !t.offlineSaved) {
              try {
                await store.putOffline(t.id,file);
                const withCopy={...t,offlineSaved:true};
                await store.putTrack(withCopy);
                Object.assign(t,withCopy);offlineSaved++;
              } catch(e) {
                try{await store.deleteOffline(t.id);}catch{}
                offlineFailed++;
                errors.push(`${file.name}: offline copy ${e?.name==='QuotaExceededError'?'exceeds storage limit':'failed'}`);
              }
            }
          }
        } catch(e) {
          failed++;console.warn('Could not add music:',e);
          errors.push(`${entry.file?.name || entry.handle?.name || 'File'}: ${e?.name==='QuotaExceededError'?'storage full':e?.message || 'could not be accessed'}`);
        }
        const done=idx+1;
        state.lastImportDone=done;state.lastImportTotal=candidates.length;
        if(done%12===0 || done===candidates.length){
          reportImportProgress('Adding music',done,candidates.length,
            `${added} new · ${linked} reconnected · ${duplicates} already added · ${failed} failed${offlineSaved?` · ${offlineSaved} offline`:''}`);
          await tick();
        }
      }
      if(added+linked)analytics('music_import',{source,file_count:added+linked});
      renderAll();
      const message=`${added} added · ${linked} reconnected · ${duplicates} already linked · ${failed} failed`+
        (state.keepNewOffline?` · ${offlineSaved} saved offline${offlineFailed?` (${offlineFailed} copy failures)`:''}`:'');
      concludeImport(message,errors);
      if(state.importCancelled)toast('Import stopped. Completed songs are kept.');
      else toast(`${added} songs added${failed?` · ${failed} failed`:''}.`);
    } catch(error){
      console.error('Import stopped unexpectedly:',error);
      errors.push(error.message || 'Unexpected import error');
      concludeImport(`${added} added before interruption`,errors);
    } finally {state.importing=false;}
  }
  async function importFiles(files,source){
    await importEntries(candidateFiles(files).map(file=>({file})),source);
  }
  function handleEntries(handles){return handles.filter(h=>h?.kind==='file').map(handle=>({handle}));}
  async function collectFolder(dir,limit=100000){
    const handles=[];
    async function walk(folder){
      for await(const entry of folder.values()){
        if(state.importCancelled)break;
        if(entry.kind==='directory') await walk(entry);
        else if(supported.test(entry.name))handles.push(entry);
        if(handles.length>limit)throw new Error('Folder contains too many files. Select smaller folders.');
        if(handles.length && handles.length%75===0){
          reportImportProgress('Scanning folder',handles.length,0,`${handles.length.toLocaleString()} music files found`);
          await tick();
        }
      }
    }
    await walk(dir);return handles;
  }
  async function chooseFiles(){
    if(state.importing)return toast('Finish the current import first.');
    if(window.showOpenFilePicker){
      try{
        const handles=await window.showOpenFilePicker({multiple:true,types:[{
          description:'Music files',accept:{'audio/mpeg':['.mp3'],'audio/mp4':['.m4a'],'audio/aac':['.aac'],'audio/wav':['.wav'],'audio/ogg':['.ogg','.oga','.opus'],'audio/flac':['.flac'],'audio/aiff':['.aiff','.aif']}
        }]});
        await importEntries(handleEntries(handles),'files');return;
      }catch(error){
        if(error.name==='AbortError')return;
        console.warn('System file picker unavailable:',error);
        toast('Trying standard file selection.');
      }
    }
    $('filesInput').click();
  }
  async function chooseFolder(){
    if(state.importing)return toast('Finish the current import first.');
    if(window.showDirectoryPicker){
      try{
        const dir=await window.showDirectoryPicker({mode:'read'});
        state.importing=true;state.importCancelled=false;
        reportImportProgress('Scanning folder',0,0,'Finding music files…');
        const handles=await collectFolder(dir);
        if(state.importCancelled){concludeImport(`Scan stopped after finding ${handles.length} files.`);return;}
        // Already marked as importing during directory scanning.
        await importEntries(handleEntries(handles),'folder',true);return;
      }catch(error){
        state.importing=false;
        if(error.name==='AbortError')return;
        console.warn('Directory selection unavailable:',error);
        concludeImport(`Could not scan folder: ${error.message || 'Unknown error'}`,[error.message||'Folder error']);
        toast('Try standard folder selection.');
      }
    }
    $('folderInput').click();
  }
  function updateStorage() {
    const legacy=state.tracks.filter(t=>Boolean(t.blob));
    const offline=state.tracks.filter(t=>t.offlineSaved);
    const temporary=state.tracks.filter(t=>!t.blob&&!t.offlineSaved&&!t.handle).length;
    const linked=state.tracks.length-legacy.length-temporary-offline.length;
    const bytes=legacy.concat(offline).reduce((n,t)=>n+(t.size||0),0);
    $('storageValue').textContent=`${state.tracks.length.toLocaleString()} songs · ${offline.length} offline · ${temporary} temporary`;
    $('storageWarning').textContent=state.persistence==='session'
      ? 'Browser storage unavailable: saved songs and playlists may not persist.'
      : `${shortSize(bytes)} in local audio copies (${offline.length} chosen offline, ${legacy.length} legacy). `+
        `New music is reference-only unless offline copies are enabled. Files without stored handles need reconnecting after a restart. `+
        `Browser storage can be cleared or evicted; your original files are never changed.`;
    $('offlineModeToggle').checked=state.keepNewOffline;
    $('offlineModeToggle').disabled=!store.db;
    $('clearOfflineBtn').disabled=!offline.length;
  }
  async function clearLibrary() {
    if (!confirm('Clear every imported song and playlist from this Music Player? Original files will remain untouched.')) return;
    try { resetAudio(); await store.clear(); state.tracks=[];state.playlists=[];state.queue=[];state.queueBase=[];state.sessionFiles.clear(); $('settingsDialog').close(); switchView('all'); analytics('library_clear'); toast('Library cleared.'); }
    catch { toast('Could not clear all files.'); }
  }
  function installInstructions() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'In Safari, tap Share → Add to Home Screen. Open once online to cache the player. In Settings you can opt to keep copies of selected songs offline; otherwise, choose the original files again after reopening.';
    if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium/.test(ua)) return 'In Safari, choose File → Add to Dock. The interface can reopen offline, but reselect music files after reopening.';
    return 'Use your browser’s Install app option (often in the address bar or browser menu). Once installed and cached, you can launch it without visiting the website. Linked originals must remain available.';
  }
  async function requestInstall() {
    analytics('install_click',{platform:/iPad|iPhone|iPod/.test(navigator.userAgent)?'ios':'desktop_or_other'});
    if (state.installPrompt) {
      const prompt = state.installPrompt; state.installPrompt = null;
      await prompt.prompt();
      try { const choice = await prompt.userChoice; if (choice?.outcome === 'accepted') analytics('install_prompt_accepted'); }
      catch {} return;
    }
    $('installInstructions').textContent = installInstructions(); dialogOpen($('installDialog'));
  }
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const actions = {play:()=>playAudio(),pause:()=>pauseAudio(),stop:()=>stopAudio(),previoustrack:()=>skip(-1),nexttrack:()=>skip(1),seekbackward:details=>{audio.currentTime=Math.max(0,audio.currentTime-(details.seekOffset || 10));},seekforward:details=>{audio.currentTime=Math.min(audio.duration || Infinity,audio.currentTime+(details.seekOffset || 10));},seekto:details=>{if(Number.isFinite(details.seekTime)) audio.currentTime=details.seekTime;}};
    for (const [action,fn] of Object.entries(actions)) try { navigator.mediaSession.setActionHandler(action,fn); } catch {}
  }
  function initEvents() {
    $('addFilesBtn').onclick = $('emptyAddBtn').onclick = () => chooseFiles();
    $('addFolderBtn').onclick = () => chooseFolder();
    $('filesInput').addEventListener('change',async e => { const files=[...e.target.files]; e.target.value=''; await importFiles(files,'files'); });
    $('folderInput').addEventListener('change',async e => { const files=[...e.target.files]; e.target.value=''; await importFiles(files,'folder'); });
    $('navAll').onclick = () => switchView('all'); $('navFavorites').onclick = () => switchView('favorites');
    $('playlistNav').addEventListener('click',e => { const btn=e.target.closest('[data-playlist-id]'); if (btn) switchView('playlist',btn.dataset.playlistId); });
    $('newPlaylistBtn').onclick = () => openPlaylistDialog();
    $('playlistForm').addEventListener('submit',savePlaylist);
    $('editTrackForm').addEventListener('submit',saveSongInfo);
    $('keepPlaylistOfflineBtn').onclick=async()=>{const playlist=byPlaylistId(state.playlistId);if(playlist)await saveForOffline(state.tracks.filter(t=>playlist.trackIds.includes(t.id)));};
    $('renamePlaylistBtn').onclick = () => openPlaylistDialog(state.playlistId);
    $('deletePlaylistBtn').onclick = deletePlaylist;
    $('searchInput').addEventListener('input',e => { state.search=e.target.value;state.listLimit=150;renderTracks(); });
    $('moreTracksBtn').onclick=()=>{state.listLimit+=150;renderTracks();};
    $('sortSelect').addEventListener('change',e => {state.sort=e.target.value;state.listLimit=150;renderTracks();});
    $('trackList').addEventListener('click',e => { const more=e.target.closest('[data-more-id]'); if (more) return openTrackDialog(more.dataset.moreId); const play=e.target.closest('[data-play-id]'); if (play) selectTrack(play.dataset.playId,true,true); });
    $('queueBody').addEventListener('click',e => { const btn=e.target.closest('[data-queue-id]'); if (btn) selectTrack(btn.dataset.queueId,true,false); });
    $('trackDialogBody').addEventListener('click',e => { const btn=e.target.closest('[data-action]'); if (btn) handleTrackAction(btn); });
    document.querySelectorAll('[data-close-dialog]').forEach(el => el.addEventListener('click',()=>$((el.dataset.closeDialog)).close()));
    $('heroActionBtn').onclick = () => state.currentId ? togglePlay() : chooseFiles();
    $('playPauseBtn').onclick = togglePlay;
    $('stopBtn').onclick = stopAudio;
    $('prevBtn').onclick = () => skip(-1); $('nextBtn').onclick = () => skip(1);
    $('favoriteCurrentBtn').onclick = () => setFavorite(state.currentId);
    $('shuffleBtn').onclick = () => {
      state.shuffle=!state.shuffle;
      state.queue=state.shuffle ? shuffleQueue(state.queueBase.length ? state.queueBase : state.queue,state.currentId) : [...state.queueBase];
      updateControls();renderQueue();
    };
    $('repeatBtn').onclick = () => { state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';updateControls(); };
    $('seekInput').addEventListener('input', e => { if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime=audio.duration*(Number(e.target.value)/100); });
    $('volumeInput').addEventListener('input', e => {audio.volume=Number(e.target.value);audio.muted=false;updateControls();});
    $('muteBtn').onclick = () => {audio.muted=!audio.muted;updateControls();};
    audio.addEventListener('timeupdate',updateSeek);
    audio.addEventListener('play',renderHero);audio.addEventListener('pause',renderHero);
    audio.addEventListener('ended',async () => {
      if (state.repeat === 'one') {audio.currentTime=0;await playAudio();}
      else await skip(1,true);
    });
    audio.addEventListener('loadedmetadata',async () => {
      updateSeek();
      const t=byId(state.currentId);
      if (t && Number.isFinite(audio.duration) && audio.duration > 0 && Math.abs(t.duration-audio.duration) > 1) {
        t.duration=audio.duration;
        try { await store.putTrack(t);renderTracks(); } catch {}
      }
    });
    audio.addEventListener('error',()=>{if (state.currentId) toast('Unsupported or damaged audio file. Try another song.');});
    $('mobileMenuBtn').onclick=toggleSidebar;$('mobileShade').onclick=closeSidebar;
    $('installBtn').onclick=requestInstall;
    $('settingsBtn').onclick=()=>{updateStorage();dialogOpen($('settingsDialog'));closeSidebar();};
    $('offlineModeToggle').onchange=async e=>{
      state.keepNewOffline=Boolean(e.target.checked);
      try{localStorage.setItem('music-player-save-new-offline',state.keepNewOffline?'yes':'no');}catch{}
      if(state.keepNewOffline){try{await navigator.storage?.persist?.();}catch{}}
      toast(state.keepNewOffline?'Newly added songs will also be saved offline.':'Newly added songs will use references only.');
    };
    $('clearOfflineBtn').onclick=async()=>{await removeOffline(state.tracks);updateStorage();};
    $('cancelImportBtn').onclick=()=>{state.importCancelled=true;$('importDetail').textContent='Stopping after the current file…';};
    $('dismissImportBtn').onclick=()=>{$('importStatus').hidden=true;};
    $('clearLibraryBtn').onclick=clearLibrary;
    $('downloadOfflineBtn').onclick=()=>{analytics('offline_copy_download_click');const a=document.createElement('a');a.href='./downloads/Music-Player-Offline.zip';a.download='Music-Player-Offline.zip';document.body.append(a);a.click();a.remove();};
    $('analyticsSettingsBtn').onclick=()=>window.buildifulAnalytics?.openSettings?.();
    document.addEventListener('keydown', e => {
      const target=e.target;
      if (e.key === 'Escape') closeSidebar();
      if (e.code === 'Space' && !e.repeat && !e.altKey && !e.metaKey && !e.ctrlKey && !['INPUT','TEXTAREA','SELECT','BUTTON'].includes(target.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); togglePlay(); }
    });
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;});
    window.addEventListener('appinstalled',()=>{state.installPrompt=null;analytics('app_installed');toast('Music Player installed.');});
    document.addEventListener('dragenter',e=>{if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault();state.dragDepth++;$('dropOverlay').hidden=false;});
    document.addEventListener('dragover',e=>{if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();});
    document.addEventListener('dragleave',e=>{if (!e.dataTransfer?.types?.includes('Files')) return;state.dragDepth=Math.max(0,state.dragDepth-1);if(!state.dragDepth)$('dropOverlay').hidden=true;});
    document.addEventListener('drop', async e=>{
      e.preventDefault();state.dragDepth=0;$('dropOverlay').hidden=true;
      if (!e.dataTransfer?.files?.length) return;
      const items=[...(e.dataTransfer.items||[])];
      if (items.length && items.every(item=>typeof item.getAsFileSystemHandle==='function')) {
        try {
          const handles=(await Promise.all(items.map(item=>item.getAsFileSystemHandle()))).filter(Boolean);
          state.importing=true;state.importCancelled=false;
          reportImportProgress('Scanning dropped items',0,0,'Finding music files…');
          const files=[];
          for (const handle of handles) {
            if (state.importCancelled)break;
            if (handle.kind==='directory') files.push(...handleEntries(await collectFolder(handle)));
            else files.push(...handleEntries([handle]));
          }
          if(state.importCancelled){concludeImport('Scan stopped.');return;}
          if (files.length) {await importEntries(files,'drop',true);return;}
          state.importing=false;
        } catch(error) {state.importing=false;console.warn('Drop handles unavailable:',error);}
      }
      await importFiles(e.dataTransfer.files,'drop');
    });
    window.addEventListener('pagehide',()=>{});
  }
  async function init() {
    store = await LibraryStore.create();
    if (!store.db) state.persistence = 'session';
    try { [state.tracks,state.playlists] = await Promise.all([store.tracks(),store.playlists()]); }
    catch(error) { console.error(error);state.tracks=[];state.playlists=[];toast('Could not load stored music.'); }
    state.tracks.sort((a,b)=>b.addedAt-a.addedAt);
    try{state.keepNewOffline=Boolean(store.db && localStorage.getItem('music-player-save-new-offline')==='yes');}catch{}
    audio.volume=state.volume;
    initEvents();setupMediaSession();renderAll();updateControls();updateSeek();
    if (state.persistence === 'session') toast('Temporary session: browser storage unavailable.');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline installation unavailable:',error));
    }
  }
  init().catch(error => {console.error('Music Player failed to start:',error);toast('Could not start Music Player.');});
})();
