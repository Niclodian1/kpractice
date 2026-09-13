"use strict";

function setupChrome(){
  document.getElementById('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.getElementById('themeBtn').textContent = next === 'dark' ? '浅色' : '深色';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', next === 'dark' ? '#0d0d0d' : '#f4f3ef');
    applyTheme();
    savePreferences();
  });
  document.getElementById('maPeriods').addEventListener('change', () => { rebuildMA(); savePreferences(); });
  document.getElementById('maComma').addEventListener('click', () => {
    const el = document.getElementById('maPeriods');
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + ',' + el.value.slice(end);
    el.focus();
    try { el.setSelectionRange(start + 1, start + 1); } catch {}
  });
  document.getElementById('overlayToggle').addEventListener('click', e => {
    const b = e.target.closest('button[data-ov]'); if (!b) return;
    b.classList.toggle('active');
    applyOverlayPreferences();
    savePreferences();
  });
}

async function registerSW(){
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    await navigator.serviceWorker.register('sw.js');
    let timeout;
    try {
      await Promise.race([navigator.serviceWorker.ready,
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('离线准备超时')), 12000); })]);
      offlineReady = true;
    } finally { clearTimeout(timeout); }
  } catch (e){ console.warn('SW', e); }
}

async function boot(){
  try {
    await hydratePersist();
    await loadCatalog();
    setupChrome();
    setupJournal();
    setupTrainer();
    restorePreferences();
    setupExperience();
    setupOffline();
    await registerSW();
    await refreshOfflineStatus();
  } catch (e){
    toast(e.message || String(e));
  }
}

boot();
