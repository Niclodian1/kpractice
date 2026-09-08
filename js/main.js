"use strict";

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

async function prefetchAll(){
  const list = CATALOG.symbols || [];
  const btn = document.getElementById('prefetchBtn');
  btn.disabled = true;
  let ok = 0, fail = 0;
  for (let i = 0; i < list.length; i++){
    const s = list[i];
    setLoading(true, `下载 ${s.id} (${i + 1}/${list.length})`);
    document.getElementById('offlineStatus').textContent = `正在下载 ${s.id} · ${i + 1}/${list.length}`;
    try {
      const r = await fetch('data/' + s.id.toLowerCase() + '.json', { cache: 'reload' });
      if (!r.ok) throw new Error(String(r.status));
      await r.arrayBuffer();
      ok++;
    } catch {
      fail++;
    }
  }
  setLoading(false);
  btn.disabled = false;
  document.getElementById('offlineStatus').textContent =
    fail ? `已缓存 ${ok} 个品种，${fail} 个失败。连着 Wi-Fi 再试一次。`
         : `已缓存 ${ok} 个品种。断网后仍可练习（需从 HTTPS 加到主屏幕，或电脑服务还开着）。`;
  toast(fail ? `完成，失败 ${fail}` : '全部品种已下载');
}

function setupChrome(){
  document.getElementById('themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.getElementById('themeBtn').textContent = next === 'dark' ? '浅色' : '深色';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', next === 'dark' ? '#0d0d0d' : '#f4f3ef');
    applyTheme();
  });
  document.getElementById('maPeriods').addEventListener('change', () => { rebuildMA(); toast('MA 已更新'); });
  document.getElementById('overlayToggle').addEventListener('click', e => {
    const b = e.target.closest('button[data-ov]'); if (!b) return;
    b.classList.toggle('active');
    const on = b.classList.contains('active');
    const ov = b.dataset.ov;
    if (ov === 'ma'){
      maSeries.forEach(it => it.series.applyOptions({ visible: on }));
      document.getElementById('maPeriods').style.display = on ? '' : 'none';
    } else {
      const el = document.getElementById(ov === 'macd' ? 'macd' : 'volume');
      el.style.display = on ? '' : 'none';
    }
  });
  document.getElementById('prefetchBtn').addEventListener('click', prefetchAll);
  if (!isStandalone()){
    document.getElementById('installHint').hidden = false;
  }
}

async function registerSW(){
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext){
    document.getElementById('offlineStatus').textContent =
      '当前是 HTTP 局域网。可以练，但 iOS 不能缓存成离线 App。要真离线请放到 GitHub Pages（HTTPS）再「添加到主屏幕」。';
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
  } catch (e){
    console.warn('SW', e);
  }
}

async function boot(){
  try {
    await hydratePersist();
    await loadCatalog();
    setupChrome();
    setupJournal();
    setupTrainer();
    await registerSW();
    const n = (CATALOG.symbols || []).length;
    const mb = ((CATALOG.symbols || []).reduce((a, s) => a + (s.bytes || 0), 0) / 1e6).toFixed(1);
    const status = document.getElementById('offlineStatus');
    if (window.isSecureContext){
      status.textContent = `${n} 个品种 · 约 ${mb} MB（仅日线/小时线）。建议先点「下载全部品种」，再断网练习。`;
    }
  } catch (e){
    alert(e.message || String(e));
  }
}

boot();
