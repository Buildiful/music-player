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
    toastTimer: null, dragDepth: 0
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

  // IndexedDB holds local copies of imported files. No music data is uploaded.
  class LibraryStore {
    constructor(db) { this.db = db; this.memoryTracks = new Map(); this.memoryPlaylists = new Map(); }
    static async create() {
      if (!('indexedDB' in window)) return new LibraryStore(null);
      try {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('buildiful-music-player-v1', 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', {keyPath:'id'});
            if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', {keyPath:'id'});
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
        const map = store === 'tracks' ? this.memoryTracks : this.memoryPlaylists;
        if (method === 'getAll') return Promise.resolve([...map.values()]);
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
    async clear() { await this.operation('tracks','readwrite','clear'); await this.operation('playlists','readwrite','clear'); }
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
    const title = state.view === 'playlist' ? (byPlaylistId(state.playlistId)?.name || 'Playlist') : state.view === 'favorites' ? 'Favorites' : 'All songs';
    $('viewTitle').textContent = title;
    $('viewEyebrow').textContent = state.view === 'playlist' ? 'YOUR PLAYLIST' : 'YOUR LIBRARY';
    $('viewDescription').textContent = `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;
    $('playlistActions').hidden = state.view !== 'playlist';
    $('trackList').innerHTML = tracks.map((t, i) => `<div class="track-row ${t.id === state.currentId ? 'is-playing':''}" role="listitem" data-id="${t.id}">
        <span class="track-index">${i+1}</span><div class="track-cover" aria-hidden="true">${icon('music')}</div>
        <button class="track-main" data-play-id="${t.id}" title="Play ${escapeHtml(t.title)}"><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(t.artist || 'Unknown artist')}</span></button>
        ${t.favorite ? `<span class="track-fav" title="Favorite">${icon('heart')}</span>` : ''}
        <span class="track-duration">${t.duration ? fmt(t.duration) : '—'}</span>
        <button class="icon-btn row-action" aria-label="Options for ${escapeHtml(t.title)}" data-more-id="${t.id}">${icon('more')}</button></div>`).join('');
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
    state.view = view; state.playlistId = playlistId;
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
  async function selectTrack(id, playNow = true, resetQueue = false) {
    const t = byId(id); if (!t) return;
    if (resetQueue || state.queue.length === 0 || !state.queue.includes(id)) setQueueFromView(id);
    if (state.currentId !== id) {
      audio.pause();
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.currentId = id;
      state.objectUrl = URL.createObjectURL(t.blob);
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
      if (!t) { $('filesInput').click(); return; }
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
      `<div class="menu-caption">LIBRARY</div><button data-action="remove-library" class="warn">Remove song from library ${icon('x')}</button>`;
    dialogOpen($('trackDialog'));
  }
  async function handleTrackAction(button) {
    const action = button.dataset.action, id = state.menuTrackId;
    const t = byId(id); if (!t) return;
    if (action === 'favorite') { await setFavorite(id); $('trackDialog').close(); return; }
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
      if (!confirm(`Remove "${t.title}" from this device's Music Player library? The original file will not be deleted.`)) return;
      try {
        await store.deleteTrack(id);
        state.tracks = state.tracks.filter(x => x.id !== id);
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
  async function id3Metadata(file) {
    // Small, local-only ID3v2 reader: MP3 title, artist, album (falls back to filename).
    if (!/\.mp3$/i.test(file.name)) return {};
    try {
      const data = new Uint8Array(await file.slice(0,Math.min(file.size,262144)).arrayBuffer());
      if (String.fromCharCode(...data.slice(0,3)) !== 'ID3') return {};
      const version = data[3]; if (version !== 3 && version !== 4) return {};
      const synchsafe = (v, i) => (v[i]<<21)|(v[i+1]<<14)|(v[i+2]<<7)|v[i+3];
      const tagEnd = Math.min(data.length,10+synchsafe(data,6));
      const tags = {};
      const decoded = bytes => {
        if (bytes.length < 2) return '';
        const enc = bytes[0]; let body = bytes.slice(1);
        try {
          if (enc === 0) return new TextDecoder('iso-8859-1').decode(body).replace(/\0/g,'').trim();
          if (enc === 3) return new TextDecoder('utf-8').decode(body).replace(/\0/g,'').trim();
          if (enc === 1 || enc === 2) {
            let charset = 'utf-16be';
            if (enc === 1 && body[0] === 255 && body[1] === 254) { charset = 'utf-16le'; body = body.slice(2); }
            else if (body[0] === 254 && body[1] === 255) body = body.slice(2);
            return new TextDecoder(charset).decode(body).replace(/\0/g,'').trim();
          }
        } catch {}
        return '';
      };
      let i = 10;
      while (i+10 <= tagEnd) {
        const frame = String.fromCharCode(...data.slice(i,i+4));
        if (!/^[A-Z0-9]{4}$/.test(frame)) break;
        const size = version === 4 ? synchsafe(data,i+4) : ((data[i+4]<<24)>>>0)+(data[i+5]<<16)+(data[i+6]<<8)+data[i+7];
        if (!size || i+10+size > tagEnd) break;
        if (['TIT2','TPE1','TALB'].includes(frame)) tags[frame] = decoded(data.slice(i+10,i+10+size));
        i += 10+size;
      }
      return {title:tags.TIT2,artist:tags.TPE1,album:tags.TALB};
    } catch { return {}; }
  }
  function basicFilename(file) {
    const name = file.name.replace(/\.[^.]+$/,'').replace(/_/g,' ').trim();
    const parts = name.split(/\s+-\s+/);
    return parts.length > 1 ? {artist:parts.shift().trim(),title:parts.join(' - ').trim()} : {title:name};
  }
  async function importFiles(files, source) {
    const candidates = candidateFiles(files);
    if (!candidates.length) { toast('No supported audio files found.'); return; }
    let added = 0, duplicates = 0, failures = 0;
    const existing = new Set(state.tracks.map(t => `${t.filename}|${t.size}|${t.modified}`));
    toast(`Adding ${candidates.length} ${candidates.length === 1 ? 'song' : 'songs'}…`);
    for (const file of candidates) {
      const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
      if (existing.has(fingerprint)) { duplicates++; continue; }
      const derived = basicFilename(file), tags = await id3Metadata(file);
      const t = {id:uid(),filename:file.name, title:tags.title || derived.title || file.name,
        artist:tags.artist || derived.artist || 'Unknown artist',album:tags.album || '',
        size:file.size,modified:file.lastModified,addedAt:Date.now()+added, duration:0,
        favorite:false,blob:file};
      try { await store.putTrack(t); state.tracks.push(t); existing.add(fingerprint); added++; }
      catch(error) { failures++; console.warn('Local import failed:',error); }
    }
    renderAll();
    if (added) { analytics('music_import',{source:source === 'folder' ? 'folder' : source === 'drop' ? 'drop' : 'files',file_count:added}); toast(`${added} ${added === 1 ? 'song' : 'songs'} added${duplicates ? ` · ${duplicates} already in library` : ''}.`); }
    else if (failures) toast('Storage is full or unavailable. Try fewer files.');
    else toast('Those songs are already in your library.');
    if (failures && added) setTimeout(() => toast(`${failures} file(s) could not be saved. Check device storage.`), 3000);
  }
  function updateStorage() {
    const bytes = state.tracks.reduce((n, t) => n+t.size,0);
    $('storageValue').textContent = `${state.tracks.length} ${state.tracks.length === 1 ? 'song' : 'songs'} · ${shortSize(bytes)}`;
    $('storageWarning').textContent = state.persistence === 'session'
      ? 'Temporary session: browser storage is unavailable. Songs may disappear when you close this page.'
      : 'Clearing browser data also clears this library.';
  }
  async function clearLibrary() {
    if (!confirm('Clear every imported song and playlist from this Music Player? Original files will remain untouched.')) return;
    try { resetAudio(); await store.clear(); state.tracks=[];state.playlists=[];state.queue=[];state.queueBase=[]; $('settingsDialog').close(); switchView('all'); analytics('library_clear'); toast('Library cleared.'); }
    catch { toast('Could not clear all files.'); }
  }
  function installInstructions() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'In your browser, open the Share menu, choose “Add to Home Screen”, turn on “Open as Web App”, and tap Add. Open it once online so the app can be saved for offline use.';
    if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium/.test(ua)) return 'In Safari, choose File → Add to Dock. Once the app is cached, it can reopen offline.';
    return 'Use your browser’s Install app option (often in the address bar or browser menu). Once installed and cached, you can launch it without visiting the website.';
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
    $('addFilesBtn').onclick = $('emptyAddBtn').onclick = () => $('filesInput').click();
    $('addFolderBtn').onclick = () => $('folderInput').click();
    $('filesInput').addEventListener('change',async e => { const files=[...e.target.files]; e.target.value=''; await importFiles(files,'files'); });
    $('folderInput').addEventListener('change',async e => { const files=[...e.target.files]; e.target.value=''; await importFiles(files,'folder'); });
    $('navAll').onclick = () => switchView('all'); $('navFavorites').onclick = () => switchView('favorites');
    $('playlistNav').addEventListener('click',e => { const btn=e.target.closest('[data-playlist-id]'); if (btn) switchView('playlist',btn.dataset.playlistId); });
    $('newPlaylistBtn').onclick = () => openPlaylistDialog();
    $('playlistForm').addEventListener('submit',savePlaylist);
    $('renamePlaylistBtn').onclick = () => openPlaylistDialog(state.playlistId);
    $('deletePlaylistBtn').onclick = deletePlaylist;
    $('searchInput').addEventListener('input',e => { state.search=e.target.value;renderTracks(); });
    $('sortSelect').addEventListener('change',e => {state.sort=e.target.value;renderTracks();});
    $('trackList').addEventListener('click',e => { const more=e.target.closest('[data-more-id]'); if (more) return openTrackDialog(more.dataset.moreId); const play=e.target.closest('[data-play-id]'); if (play) selectTrack(play.dataset.playId,true,true); });
    $('queueBody').addEventListener('click',e => { const btn=e.target.closest('[data-queue-id]'); if (btn) selectTrack(btn.dataset.queueId,true,false); });
    $('trackDialogBody').addEventListener('click',e => { const btn=e.target.closest('[data-action]'); if (btn) handleTrackAction(btn); });
    document.querySelectorAll('[data-close-dialog]').forEach(el => el.addEventListener('click',()=>$((el.dataset.closeDialog)).close()));
    $('heroActionBtn').onclick = () => state.currentId ? togglePlay() : $('filesInput').click();
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
    document.addEventListener('drop',e=>{e.preventDefault();state.dragDepth=0;$('dropOverlay').hidden=true;if(e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files,'drop');});
    window.addEventListener('pagehide',()=>{});
  }
  async function init() {
    store = await LibraryStore.create();
    if (!store.db) state.persistence = 'session';
    try { [state.tracks,state.playlists] = await Promise.all([store.tracks(),store.playlists()]); }
    catch(error) { console.error(error);state.tracks=[];state.playlists=[];toast('Could not load stored music.'); }
    state.tracks.sort((a,b)=>b.addedAt-a.addedAt);
    audio.volume=state.volume;
    initEvents();setupMediaSession();renderAll();updateControls();updateSeek();
    if (state.persistence === 'session') toast('Temporary session: browser storage unavailable.');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost','127.0.0.1'].includes(location.hostname))) {
      navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline installation unavailable:',error));
    }
  }
  init().catch(error => {console.error('Music Player failed to start:',error);toast('Could not start Music Player.');});
})();
