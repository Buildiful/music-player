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
    listLimit: 150, keepNewOffline: false, offlineTask: false,
    storageGroup:'song', storageSearch:'', storageLimit:100, storageSelected:new Set(),
    relinkCandidates:[], relinkLimit:100, relinkWorking:false, relinkCancelled:false, relinkSingleId:null
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
  // SHA-256 of two short samples + file size: useful for safe relinking when filenames change.
  // This is a local-only lookup hint, not a full-file authenticity check.
  async function audioSignature(file) {
    if (!globalThis.crypto?.subtle || !Number.isFinite(file.size) || typeof file.slice !== 'function') return null;
    const sample=32768;
    try {
      const first=new Uint8Array(await file.slice(0,Math.min(sample,file.size)).arrayBuffer());
      const last=file.size>sample?new Uint8Array(await file.slice(Math.max(sample,file.size-sample)).arrayBuffer()):new Uint8Array();
      const buffer=new Uint8Array(8+first.length+last.length);
      new DataView(buffer.buffer).setBigUint64(0,BigInt(file.size),false);
      buffer.set(first,8);buffer.set(last,8+first.length);
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));
      return [...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
    } catch (error) { console.warn('Audio signature unavailable:',error);return null; }
  }

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
      `<div class="menu-caption">SONG</div><button data-action="edit">Edit song info ${icon('pencil')}</button><button data-action="relink">Relink file ${icon('folder')}</button>`+
      (t.offlineSaved ? `<button data-action="remove-offline">Remove offline copy ${icon('x')}</button>` : `<button data-action="save-offline">Keep available offline ${icon('download')}</button>`)+
      (t.album ? `<button data-action="save-album">Keep this album offline ${icon('download')}</button>` : '')+
      (t.blob ? `<button data-action="remove-legacy" ${(!t.handle&&!state.sessionFiles.has(t.id)&&!t.offlineSaved)?'disabled title="Relink the original file first"':''}>Remove old stored copy ${icon('x')}</button>` : '')+
      `<div class="menu-caption">LIBRARY</div><button data-action="remove-library" class="warn">Remove song from library ${icon('x')}</button>`;
    dialogOpen($('trackDialog'));
  }
  async function handleTrackAction(button) {
    const action = button.dataset.action, id = state.menuTrackId;
    const t = byId(id); if (!t) return;
    if (action === 'favorite') { await setFavorite(id); $('trackDialog').close(); return; }
    if (action === 'edit') { $('trackDialog').close(); openEditDialog(id); return; }
    if (action === 'relink') { $('trackDialog').close(); await pickSingleRelink(id); return; }
    if (action === 'save-offline') { $('trackDialog').close(); await saveForOffline([t]); return; }
    if (action === 'remove-offline') { $('trackDialog').close(); await removeOffline([t]); return; }
    if (action === 'save-album') { $('trackDialog').close(); await saveForOffline(state.tracks.filter(x=>x.album && x.album===t.album));return; }
    if (action === 'remove-legacy') { $('trackDialog').close(); await removeLegacyCopy(t); return; }
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
  async function removeLegacyCopy(track){
    if(!track.blob)return;
    const hasReference=Boolean(track.handle||state.sessionFiles.has(track.id));
    if(!hasReference&&!track.offlineSaved){toast('Relink the original file before removing this old copy.');return;}
    if(!confirm(`Remove the old stored copy of “${track.title}”? The original file is not affected. Confirm you can still access the linked original or saved offline version.`))return;
    const update={...track};delete update.blob;
    try{
      await store.putTrack(update);
      delete track.blob;
      renderAll();toast('Old stored copy removed.');analytics('legacy_copy_remove',{file_count:1});
    }catch(error){console.warn('Old-copy removal error:',error);toast('Could not remove the old copy.');}
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
            const signature=await audioSignature(file);
            const derived=basicFilename(file);
            const t=old?{...old}:{
              id:uid(),filename:file.name,title:tags.title||derived.title||file.name,
              artist:tags.artist||derived.artist||'Unknown artist',album:tags.album||'',
              genre:tags.genre||'',year:tags.year||'',trackNumber:tags.trackNumber||'',
              size:file.size,modified:file.lastModified,addedAt:Date.now()+idx,
              duration:0,favorite:false,signature
            };
            // Preserve intentional edits. On reconnect, fill missing metadata
            // from existing tags without overwriting a user-edited value.
            if(old) for (const key of ['title','artist','album','genre','year','trackNumber']) {
              if(!t.manualEdits?.[key] && tags[key] && (!t[key] || (key==='artist'&&t[key]==='Unknown artist'))) t[key]=tags[key];
            }
            if(signature)t.signature=signature;
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
  async function collectFolder(dir,limit=100000,cancelled=()=>state.importCancelled){
    const handles=[];
    async function walk(folder){
      for await(const entry of folder.values()){
        if(cancelled())break;
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
    // The Storage Manager offers targeted removal, instead of all-or-nothing cleanup.
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
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice?.outcome === 'accepted') analytics('install_prompt_accepted');
        return;
      } catch (error) { console.warn('Native install prompt unavailable:',error); }
      // The browser may already have displayed its own banner; show instructions. 
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
    $('manageStorageBtn').onclick=()=>openStorageManager();
    $('storageBtn').onclick=()=>{openStorageManager();closeSidebar();};
    $('relinkBtn').onclick=()=>{openRelinkDialog();closeSidebar();};
    $('cancelImportBtn').onclick=()=>{state.importCancelled=true;$('importDetail').textContent='Stopping after the current file…';};
    $('dismissImportBtn').onclick=()=>{$('importStatus').hidden=true;};
    $('clearLibraryBtn').onclick=clearLibrary;
    $('downloadOfflineBtn').onclick=()=>{analytics('offline_copy_download_click');const a=document.createElement('a');a.href='./downloads/Music-Player-Offline.zip';a.download='Music-Player-Offline.zip';document.body.append(a);a.click();a.remove();};
    $('analyticsSettingsBtn').onclick=()=>window.buildifulAnalytics?.openSettings?.();
    initLibraryManagementEvents();
    document.addEventListener('keydown', e => {
      const target=e.target;
      if (e.key === 'Escape') closeSidebar();
      if (e.code === 'Space' && !e.repeat && !e.altKey && !e.metaKey && !e.ctrlKey && !['INPUT','TEXTAREA','SELECT','BUTTON'].includes(target.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); togglePlay(); }
    });
    // Preserve the browser's native install UI; the in-app Install button can also prompt.
    window.addEventListener('beforeinstallprompt',e=>{state.installPrompt=e;});
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
  // --- Storage manager: only browser copies are removable; never touch source music. ---
  const offlineTracks=()=>state.tracks.filter(t=>t.offlineSaved);
  const storedBytes=tracks=>tracks.reduce((sum,t)=>sum+(Number(t.size)||0),0);
  function storageEntries(){
    const tracks=offlineTracks();
    if(state.storageGroup==='song')return tracks.map(t=>({key:t.id,title:t.title,subtitle:t.artist||'Unknown artist',ids:[t.id],bytes:t.size||0}));
    const groups=new Map();
    const append=(key,title,id)=>{
      if(!groups.has(key))groups.set(key,{key,title,ids:new Set()});
      groups.get(key).ids.add(id);
    };
    if(state.storageGroup==='album')for(const t of tracks)append('album:'+(t.album||'Unknown album'),t.album||'Unknown album',t.id);
    else {
      const inPlaylist=new Set();
      for(const p of state.playlists){
        const ids=new Set(p.trackIds);
        for(const t of tracks)if(ids.has(t.id)){append('playlist:'+p.id,p.name,t.id);inPlaylist.add(t.id);}
      }
      for(const t of tracks)if(!inPlaylist.has(t.id))append('playlist:none','Not in a playlist',t.id);
    }
    return [...groups.values()].map(g=>({key:g.key,title:g.title,ids:[...g.ids],subtitle:`${g.ids.size} song${g.ids.size===1?'':'s'}`,bytes:storedBytes([...g.ids].map(byId).filter(Boolean))}));
  }
  function filteredStorageEntries(){
    const query=state.storageSearch.trim().toLocaleLowerCase();
    return storageEntries().filter(e=>!query||`${e.title} ${e.subtitle||''}`.toLocaleLowerCase().includes(query)).sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base'}));
  }
  function renderStorageManager(){
    const saved=offlineTracks();
    const legacy=state.tracks.filter(t=>t.blob);
    const bytes=storedBytes(saved)+storedBytes(legacy);
    $('storageManagerTotals').textContent=`${saved.length.toLocaleString()} offline copies · ~${shortSize(bytes)}`;
    const entryList=filteredStorageEntries(), shown=entryList.slice(0,state.storageLimit);
    const available=new Set(saved.map(t=>t.id));
    for(const id of [...state.storageSelected])if(!available.has(id))state.storageSelected.delete(id);
    $('storageEntryList').innerHTML=shown.map((entry,i)=>{
      const checked=entry.ids.every(id=>state.storageSelected.has(id));
      return `<div class="manager-entry"><label><input type="checkbox" data-storage-key="${i}" ${checked?'checked':''}><span class="entry-main"><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.subtitle||'Saved offline')}</small></span></label><span class="entry-size">${shortSize(entry.bytes)}</span></div>`;
    }).join('')||'<p class="manager-notice">No offline copies match this view.</p>';
    $('storageMoreBtn').hidden=entryList.length<=shown.length;
    $('storageMoreBtn').textContent=`Show more (${Math.max(0,entryList.length-shown.length).toLocaleString()} remaining)`;
    $('storageSelectionText').textContent=`${state.storageSelected.size.toLocaleString()} selected · ${shortSize(storedBytes([...state.storageSelected].map(byId).filter(Boolean)))}`;
    $('storageRemoveBtn').disabled=state.storageSelected.size===0;
    $('storageSelectShownBtn').disabled=!shown.length;
    $('storageLegacyNotice').hidden=!legacy.length;
    $('storageLegacyNotice').textContent=legacy.length?`${legacy.length} legacy audio ${legacy.length===1?'copy is':'copies are'} kept separately for safety. Relink the original files, then use the song’s ••• menu to safely remove these older copies. Original files are never deleted.`:'';
  }
  async function openStorageManager(){
    if($('settingsDialog').open)$('settingsDialog').close();
    state.storageLimit=100;state.storageSelected.clear();state.storageSearch='';$('storageSearch').value='';
    dialogOpen($('storageDialog'));renderStorageManager();analytics('storage_manager_open');
    $('storageQuotaText').textContent='Checking available browser storage…';
    try{
      const estimate=await navigator.storage?.estimate?.();
      $('storageQuotaText').textContent=estimate?.quota?`Origin usage ${shortSize(estimate.usage||0)} / browser quota ${shortSize(estimate.quota)} (approx.)`:'Browser storage allowance varies by device';
    }catch{$('storageQuotaText').textContent='Browser storage allowance varies by device';}
  }
  async function removeSelectedOffline(){
    const targets=[...state.storageSelected].map(byId).filter(t=>t?.offlineSaved);
    if(!targets.length)return;
    if(!confirm(`Remove ${targets.length} offline ${targets.length===1?'copy':'copies'} (~${shortSize(storedBytes(targets))}) from this browser? Your original music files and playlists will remain.`))return;
    const button=$('storageRemoveBtn');button.disabled=true;
    let removed=0;const failures=[];
    for(const t of targets){
      try{
        // Flip the metadata flag first; if deleting the blob fails, restore the flag.
        await store.putTrack({...t,offlineSaved:false});
        try{await store.deleteOffline(t.id);}catch(e){await store.putTrack(t);throw e;}
        t.offlineSaved=false;state.storageSelected.delete(t.id);removed++;
      }catch(error){failures.push(t.title);console.warn('Offline removal failed',error);}
    }
    renderAll();renderStorageManager();
    toast(`${removed} offline ${removed===1?'copy':'copies'} removed${failures.length?` · ${failures.length} failed`:''}.`);
    analytics('offline_music_remove',{file_count:removed});
  }

  // --- Library relink: create reversible suggestions, never silently substitute files. ---
  function openRelinkDialog(){
    state.relinkLimit=100;state.relinkCandidates=[];state.relinkSingleId=null;
    $('relinkSummary').textContent='Choose a folder or files to locate moved or renamed tracks. For uncertain matches, use a song’s ••• menu → Relink file.';
    $('relinkMatchList').innerHTML='';$('relinkApplyBtn').disabled=true;
    dialogOpen($('relinkDialog'));
  }
  async function writeRelink(track, entry, explicit=false){
    const file=entry.file||await entry.handle.getFile();
    if(!supported.test(file.name))throw new Error('Not a supported audio file.');
    if(explicit && !confirm(`Reconnect “${track.title}” to “${file.name}”? Your edited song details and playlists will be kept.`))return false;
    const previous={...track};
    const signature=await audioSignature(file);
    const updated={...track,filename:file.name,size:file.size,modified:file.lastModified,signature:signature||track.signature};
    if(entry.handle)updated.handle=entry.handle;
    else delete updated.handle; // Safari: temporary File for this session only.
    try{await store.putTrack(updated);}
    catch(error){
      if(!entry.handle||!['DataCloneError','NotSupportedError'].includes(error.name))throw error;
      delete updated.handle;await store.putTrack(updated);
    }
    if(state.currentId===track.id)resetAudio();
    Object.assign(track,updated);
    if(!updated.handle)delete track.handle;
    state.sessionFiles.set(track.id,file);
    return true;
  }
  async function pickSingleRelink(id){
    if(state.importing||state.relinkWorking){toast('Finish the current task first.');return;}
    if(window.showOpenFilePicker){
      try{
        const handles=await window.showOpenFilePicker({multiple:false,types:[{description:'Music files',accept:{'audio/mpeg':['.mp3'],'audio/mp4':['.m4a'],'audio/wav':['.wav'],'audio/flac':['.flac'],'audio/ogg':['.ogg','.oga','.opus']}}]});
        if(handles[0]){await singleRelinkEntry(id,{handle:handles[0]});return;}
      }catch(error){if(error.name==='AbortError')return;console.warn('File picker fallback:',error);}
    }
    state.relinkSingleId=id;$('relinkSingleInput').click();
  }
  async function singleRelinkEntry(id,entry){
    const track=byId(id);if(!track)return;
    try{if(await writeRelink(track,entry,true)){renderAll();toast('Song reconnected.');analytics('library_relink',{file_count:1,source:'manual'});}}
    catch(error){console.warn('Could not relink song:',error);toast(error?.message||'Could not access file.');}
  }
  function buildRelinkIndex(){
    const index={exact:new Map(), nameSize:new Map(), sizeDate:new Map(), signatures:new Map(), sizes:new Set()};
    const add=(map,key,track)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(track);};
    for(const t of state.tracks){
      index.sizes.add(t.size);
      add(index.exact,`${t.filename}|${t.size}|${t.modified}`,t);
      add(index.nameSize,`${t.filename}|${t.size}`,t);
      add(index.sizeDate,`${t.size}|${t.modified}`,t);
      if(t.signature)add(index.signatures,`${t.size}|${t.signature}`,t);
    }
    return index;
  }
  function matchRelinkFile(file,signature,index){
    const valid=tracks=>tracks.filter(t=>!signature||!t.signature||t.signature===signature);
    const strategies=[
      ['filename, size & date',valid(index.exact.get(finger(file))||[])],
      ...(signature?[['audio signature',index.signatures.get(`${file.size}|${signature}`)||[]]]:[]),
      ['filename & size',valid(index.nameSize.get(`${file.name}|${file.size}`)||[])],
      ['size & date',valid(index.sizeDate.get(`${file.size}|${file.lastModified}`)||[])]
    ];
    for(const [method,found] of strategies)if(found.length)return {ids:found.map(t=>t.id),method};
    return {ids:[],method:'No confident match'};
  }
  async function scanRelink(entries){
    if(state.relinkWorking||state.importing){toast('Finish the current task first.');return;}
    const candidates=entries.filter(e=>e.handle?supported.test(e.handle.name):supported.test(e.file?.name));
    if(!candidates.length){toast('Choose MP3 or another supported audio file.');return;}
    state.relinkWorking=true;state.relinkCancelled=false;state.relinkCandidates=[];
    $('relinkStopBtn').hidden=false;$('relinkApplyBtn').disabled=true;
    $('relinkProgress').hidden=false;$('relinkProgress').max=candidates.length;$('relinkProgress').value=0;
    const index=buildRelinkIndex();let errors=0;
    try{
      for(let i=0;i<candidates.length;i++){
        if(state.relinkCancelled)break;
        const entry=candidates[i];
        try{
          const file=entry.file||await entry.handle.getFile();
          // Skip hashing when no catalog song has the same size.
          const signature=index.sizes.has(file.size)?await audioSignature(file):null;
          const matched=matchRelinkFile(file,signature,index);
          state.relinkCandidates.push({entry,file,ids:matched.ids,method:matched.method,selectedId:matched.ids.length===1?matched.ids[0]:null});
        }catch(error){errors++;console.warn('Relink scan error:',error);}
        if(i%12===0||i===candidates.length-1){
          $('relinkProgress').value=i+1;
          $('relinkSummary').textContent=`Scanning ${i+1} / ${candidates.length} · ${errors} unreadable`;
          await tick();
        }
      }
      // Avoid mapping two different chosen files to a single track automatically.
      const seen=new Map();
      for(const c of state.relinkCandidates)if(c.selectedId)seen.set(c.selectedId,(seen.get(c.selectedId)||0)+1);
      for(const c of state.relinkCandidates)if(c.selectedId&&seen.get(c.selectedId)>1){c.ids=[c.selectedId];c.selectedId=null;c.method='Duplicate candidate: choose one file';}
      renderRelinkCandidates();
    }finally{state.relinkWorking=false;$('relinkStopBtn').hidden=true;renderRelinkCandidates();}
  }
  function renderRelinkCandidates(){
    const items=state.relinkCandidates;
    const clear=items.filter(c=>c.selectedId).length;
    const ambiguous=items.filter(c=>!c.selectedId&&c.ids.length).length;
    const unmatched=items.filter(c=>!c.ids.length).length;
    $('relinkSummary').textContent=`${clear} selected match${clear===1?'':'es'} · ${ambiguous} need review · ${unmatched} unmatched. Unmatched songs can be reconnected from their ••• menu.`;
    const shown=items.slice(0,state.relinkLimit);
    $('relinkMatchList').innerHTML=shown.map((c,i)=>{
      const options=c.ids.map(id=>`<option value="${escapeHtml(id)}" ${id===c.selectedId?'selected':''}>${escapeHtml(byId(id)?.title||'Unknown song')} — ${escapeHtml(byId(id)?.artist||'Unknown artist')}</option>`).join('');
      return `<div class="manager-entry"><div class="entry-main"><strong>${escapeHtml(c.file.name)}</strong><small>${escapeHtml(c.method)} · ${c.ids.length?`${c.ids.length} candidate${c.ids.length===1?'':'s'}`:'Not linked'}</small></div>${c.ids.length?`<select class="manager-choice" data-relink-index="${i}" aria-label="Matching song for ${escapeHtml(c.file.name)}"><option value="">Do not relink</option>${options}</select>`:'<span class="entry-error">No match</span>'}</div>`;
    }).join('')||'<p class="manager-notice">No matches to review.</p>';
    $('relinkMoreBtn').hidden=items.length<=shown.length;
    $('relinkMoreBtn').textContent=`Show more (${Math.max(0,items.length-shown.length).toLocaleString()} remaining)`;
    $('relinkApplyBtn').disabled=!items.some(c=>c.selectedId)||state.relinkWorking;
    $('relinkApplyBtn').textContent=`Apply ${items.filter(c=>c.selectedId).length} reviewed matches`;
  }
  async function applyRelinkCandidates(){
    if(state.relinkWorking)return;
    const selected=state.relinkCandidates.filter(c=>c.selectedId);
    if(!selected.length)return;
    const ids=selected.map(c=>c.selectedId);
    if(new Set(ids).size!==ids.length){toast('Two files target the same song. Choose one for each.');return;}
    if(!confirm(`Reconnect ${selected.length} songs using the reviewed files? Song edits, favorites and playlists will remain.`))return;
    state.relinkWorking=true;state.relinkCancelled=false;
    $('relinkStopBtn').hidden=false;$('relinkApplyBtn').disabled=true;
    $('relinkProgress').hidden=false;$('relinkProgress').max=selected.length;$('relinkProgress').value=0;
    let linked=0;const failed=[];
    try{
      for(let i=0;i<selected.length;i++){
        if(state.relinkCancelled)break;
        const c=selected[i],t=byId(c.selectedId);
        try{if(t&&await writeRelink(t,c.entry))linked++;}catch(error){failed.push(c.file.name);console.warn('Relink write failure:',error);}
        if(i%12===0||i===selected.length-1){$('relinkProgress').value=i+1;$('relinkSummary').textContent=`Reconnecting ${i+1}/${selected.length} · ${linked} complete`;await tick();}
      }
    }finally{state.relinkWorking=false;$('relinkStopBtn').hidden=true;}
    state.relinkCandidates=state.relinkCandidates.filter(c=>!selected.includes(c));
    renderAll();renderRelinkCandidates();
    toast(`${linked} songs reconnected${failed.length?` · ${failed.length} failed`:''}.`);
    if(linked)analytics('library_relink',{file_count:linked,source:'reviewed'});
  }
  async function pickRelinkFiles(){
    if(state.relinkWorking)return;
    if(window.showOpenFilePicker){
      try{
        const handles=await window.showOpenFilePicker({multiple:true,types:[{description:'Music files',accept:{'audio/mpeg':['.mp3'],'audio/mp4':['.m4a'],'audio/wav':['.wav'],'audio/ogg':['.ogg','.oga','.opus'],'audio/flac':['.flac']}}]});
        await scanRelink(handleEntries(handles));return;
      }catch(error){if(error.name==='AbortError')return;console.warn('Relink file picker fallback:',error);}
    }
    $('relinkFilesInput').click();
  }
  async function pickRelinkFolder(){
    if(state.relinkWorking)return;
    if(window.showDirectoryPicker){
      try{
        const folder=await window.showDirectoryPicker({mode:'read'});
        state.relinkWorking=true;state.relinkCancelled=false;
        $('relinkSummary').textContent='Finding files in this folder…';$('relinkStopBtn').hidden=false;
        const handles=await collectFolder(folder,100000,()=>state.relinkCancelled);
        state.relinkWorking=false;$('relinkStopBtn').hidden=true;
        if(!state.relinkCancelled)await scanRelink(handleEntries(handles));
        else $('relinkSummary').textContent='Folder scan stopped.';
        return;
      }catch(error){state.relinkWorking=false;$('relinkStopBtn').hidden=true;if(error.name==='AbortError')return;console.warn('Folder picker fallback:',error);}
    }
    $('relinkFolderInput').click();
  }
  function initLibraryManagementEvents(){
    $('storageGroup').onchange=e=>{state.storageGroup=e.target.value;state.storageLimit=100;renderStorageManager();};
    $('storageSearch').oninput=e=>{state.storageSearch=e.target.value;state.storageLimit=100;renderStorageManager();};
    $('storageEntryList').onchange=e=>{
      const el=e.target.closest('[data-storage-key]');if(!el)return;
      const row=filteredStorageEntries().slice(0,state.storageLimit)[Number(el.dataset.storageKey)];if(!row)return;
      for(const id of row.ids)el.checked?state.storageSelected.add(id):state.storageSelected.delete(id);
      renderStorageManager();
    };
    $('storageSelectShownBtn').onclick=()=>{for(const row of filteredStorageEntries().slice(0,state.storageLimit))for(const id of row.ids)state.storageSelected.add(id);renderStorageManager();};
    $('storageClearSelectionBtn').onclick=()=>{state.storageSelected.clear();renderStorageManager();};
    $('storageMoreBtn').onclick=()=>{state.storageLimit+=100;renderStorageManager();};
    $('storageRemoveBtn').onclick=removeSelectedOffline;
    $('relinkPickFilesBtn').onclick=pickRelinkFiles;
    $('relinkPickFolderBtn').onclick=pickRelinkFolder;
    $('relinkStopBtn').onclick=()=>{state.relinkCancelled=true;$('relinkSummary').textContent='Stopping after the current file…';};
    $('relinkMatchList').onchange=e=>{
      const select=e.target.closest('[data-relink-index]');if(!select)return;
      const item=state.relinkCandidates[Number(select.dataset.relinkIndex)];
      if(item){item.selectedId=select.value||null;renderRelinkCandidates();}
    };
    $('relinkMoreBtn').onclick=()=>{state.relinkLimit+=100;renderRelinkCandidates();};
    $('relinkApplyBtn').onclick=applyRelinkCandidates;
    $('relinkFilesInput').onchange=async e=>{const files=[...e.target.files];e.target.value='';await scanRelink(candidateFiles(files).map(file=>({file})));};
    $('relinkFolderInput').onchange=async e=>{const files=[...e.target.files];e.target.value='';await scanRelink(candidateFiles(files).map(file=>({file})));};
    $('relinkSingleInput').onchange=async e=>{const file=e.target.files[0];e.target.value='';const id=state.relinkSingleId;state.relinkSingleId=null;if(file&&id)await singleRelinkEntry(id,{file});};
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
