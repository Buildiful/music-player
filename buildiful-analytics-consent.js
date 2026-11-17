/* Optional GA4. No Google script is loaded, and no analytics events are sent, before opt-in. */
(() => {
  'use strict';
  const element = document.currentScript;
  const measurementId = element?.dataset.measurementId || '';
  const toolName = element?.dataset.toolName || 'Music Player';
  const privacyUrl = element?.dataset.privacyUrl || './privacy.html';
  const KEY = 'buildiful.analytics.consent.v1';
  let accepted = false, loaded = false;
  const localFile = location.protocol === 'file:';
  const safeStorage = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
    set(choice) { try { localStorage.setItem(KEY,JSON.stringify({choice,timestamp:new Date().toISOString()})); } catch {} }
  };
  // Only fixed, anonymous action types and simple counts/enum values are allowed.
  const events = new Set([
    'music_import','music_remove','playlist_create','playlist_delete',
    'playlist_add_track','playlist_remove_track',
    'library_clear','install_click','install_prompt_accepted',
    'app_installed','offline_copy_download_click',
    'song_info_edit','offline_music_save','offline_music_remove'
  ]);
  function permittedParams(event, details) {
    const out = {tool_name:toolName};
    if (['music_import','offline_music_save','offline_music_remove'].includes(event)) {
      if (Number.isInteger(details.file_count)) out.file_count = Math.min(10000,Math.max(0,details.file_count));
    }
    if (event === 'music_import') {
      if (['files','folder','drop'].includes(details.source)) out.import_source = details.source;
    }
    if (event === 'install_click' && ['ios','desktop_or_other'].includes(details.platform)) out.platform = details.platform;
    return out;
  }
  function track(event, details = {}) {
    if (!accepted || !loaded || !events.has(event) || typeof window.gtag !== 'function') return;
    window.gtag('event',event,permittedParams(event,details));
  }
  function loadAnalytics() {
    if (loaded || !accepted || localFile || !/^G-[A-Z0-9]+$/.test(measurementId)) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js',new Date());
    window.gtag('set',{allow_google_signals:false,allow_ad_personalization_signals:false});
    window.gtag('config',measurementId,{
      send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false,
      page_location:location.origin+location.pathname,page_path:location.pathname,
      page_title:document.title
    });
    window.gtag('event','page_view',{
      page_location:location.origin+location.pathname,page_path:location.pathname,
      page_title:document.title,tool_name:toolName
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.onerror = () => { console.info('Optional analytics is unavailable offline.'); };
    document.head.append(script);
  }
  function closePrompt() { document.getElementById('buildiful-consent-banner')?.remove(); }
  function setChoice(choice) {
    const wasAccepted = accepted;
    safeStorage.set(choice);
    accepted = choice === 'accepted';
    closePrompt();
    if (accepted) loadAnalytics();
    else if (wasAccepted && loaded) {
      // A loaded Google tag cannot be removed reliably. Reload to end collection.
      try { window.gtag?.('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}); } catch {}
      location.reload();
    }
  }
  function openSettings() {
    if (localFile) { window.alert('Analytics is disabled for downloaded offline copies.'); return; }
    closePrompt();
    const styleId = 'buildiful-consent-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');style.id=styleId;
      style.textContent = `
      #buildiful-consent-banner{position:fixed;z-index:10000;bottom:18px;left:18px;width:min(420px,calc(100vw - 36px));padding:20px;border:1px solid #b0c6d4;border-radius:13px;box-shadow:0 20px 65px #0007;background:#fff;color:#1b303e;font:13px/1.5 system-ui,-apple-system,sans-serif}
      #buildiful-consent-banner strong{font-size:15px;display:block;margin-bottom:7px}
      #buildiful-consent-banner p{margin:0 0 14px;color:#50687a}
      #buildiful-consent-banner a{color:#245778}
      #buildiful-consent-banner .actions{display:flex;gap:8px;justify-content:flex-end;align-items:center}
      #buildiful-consent-banner button{border:1px solid #c1d0da;background:#f5f8fa;border-radius:7px;padding:9px 13px;color:#223d50;cursor:pointer;font:600 12px system-ui,-apple-system,sans-serif}
      #buildiful-consent-banner button[data-choice="accepted"]{background:#153b52;border-color:#153b52;color:white}
      #buildiful-consent-banner a{margin-right:auto;font-size:12px}`;
      document.head.append(style);
    }
    const div = document.createElement('div');div.id='buildiful-consent-banner';div.setAttribute('role','dialog');div.setAttribute('aria-label','Optional analytics');
    const strong=document.createElement('strong');strong.textContent='Help improve Music Player?';
    const p=document.createElement('p');p.textContent='Allow optional usage analytics? Your music files, filenames, and playlists are never sent. The player works without analytics.';
    const actions=document.createElement('div');actions.className='actions';
    const link=document.createElement('a');link.href=privacyUrl;link.textContent='Privacy';
    const decline=document.createElement('button');decline.type='button';decline.textContent='No thanks';decline.dataset.choice='declined';
    const allow=document.createElement('button');allow.type='button';allow.textContent='Allow';allow.dataset.choice='accepted';
    decline.onclick=()=>setChoice('declined');allow.onclick=()=>setChoice('accepted');
    actions.append(link,decline,allow);div.append(strong,p,actions);document.body.append(div);
  }
  window.buildifulAnalytics = {track,openSettings,get accepted(){return accepted;}};
  if (localFile) return;
  const saved = safeStorage.get();
  if (saved?.choice === 'accepted') {accepted=true;loadAnalytics();}
  else if (saved?.choice !== 'declined') openSettings();
})();
