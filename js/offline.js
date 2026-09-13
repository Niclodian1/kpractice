"use strict";

const DATA_CACHE = 'kpractice-data-v1';
let offlineReady = false;
let downloadController = null;
let failedDownloads = [];
let offlineItems = new Map();
const symbolUrl = s => new URL(`data/${s.id.toLowerCase()}.json`, location.href).href;

async function refreshOfflineStatus(){
  const status = document.getElementById('offlineStatus');
  const btn = document.getElementById('prefetchBtn');
  if (!window.isSecureContext || !('caches' in window)){
    status.textContent = '当前连接可在线练习。离线下载需要通过 HTTPS 打开应用。';
    btn.disabled = true;
    return;
  }
  try {
    const cache = await caches.open(DATA_CACHE);
    const all = CATALOG.symbols || [];
    offlineItems = new Map(await Promise.all(all.map(async s => {
      const hit = await cache.match(symbolUrl(s));
      if (!hit) return [s.id, null];
      const bytes = Number(hit.headers.get('x-kpractice-bytes') || hit.headers.get('content-length')) || (await hit.blob()).size;
      return [s.id, { bytes }];
    })));
    const cached = [...offlineItems.values()].filter(Boolean);
    const mb = cached.reduce((sum, item) => sum + item.bytes, 0) / 1e6;
    status.textContent = `已缓存 ${cached.length}/${all.length} 个品种 · ${mb.toFixed(1)} MB。${offlineReady ? '已缓存品种可离线练习。' : '应用离线准备尚未完成，请联网重新打开后重试。'}`;
    btn.disabled = !!downloadController || !offlineReady;
    const market = document.getElementById('offlineMarket').value;
    document.getElementById('offlineList').innerHTML = all.filter(s => !market || s.market === market).map(s =>
      `<div class="offline-item"><span>${escapeHtml(s.name)}</span><span>${offlineItems.get(s.id) ? '已缓存' : '未下载'} · ${((offlineItems.get(s.id)?.bytes || s.bytes || 0) / 1e6).toFixed(2)} MB</span></div>`).join('');
  } catch {
    status.textContent = '无法读取离线空间，请检查浏览器存储权限后重试。';
    btn.disabled = true;
  }
}

async function prefetchAll(retry = false){
  if (downloadController || !offlineReady) return;
  const market = document.getElementById('offlineMarket').value;
  const list = retry ? failedDownloads.slice() : symbolsByMarket(market).filter(s => !offlineItems.get(s.id));
  if (!list.length){ toast('所选品种均已缓存'); return; }
  const controller = new AbortController();
  downloadController = controller;
  failedDownloads = [];
  const btn = document.getElementById('prefetchBtn');
  const cancel = document.getElementById('cancelDownload');
  const retryBtn = document.getElementById('retryDownload');
  const progress = document.getElementById('downloadProgress');
  const status = document.getElementById('downloadStatus');
  btn.disabled = true; cancel.hidden = false; retryBtn.hidden = true;
  progress.hidden = false; progress.max = list.length; progress.value = 0;
  let completed = 0;
  try {
    const cache = await caches.open(DATA_CACHE);
    for (let i = 0; i < list.length && !controller.signal.aborted; i++){
      const s = list[i];
      status.textContent = `正在下载 ${s.name} · ${i + 1}/${list.length}`;
      const requestController = new AbortController();
      const abort = () => requestController.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 30000);
      try {
        const response = await fetch(symbolUrl(s), { cache: 'reload', headers: { 'X-Kpractice-Refresh': '1' }, signal: requestController.signal });
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        const data = JSON.parse(await blob.text());
        if (!data.meta || !data.levels) throw new Error('数据格式不完整');
        if (controller.signal.aborted) break;
        await cache.put(symbolUrl(s), new Response(blob, { headers: { 'Content-Type': 'application/json', 'X-Kpractice-Bytes': String(blob.size) } }));
        if (!(await cache.match(symbolUrl(s)))) throw new Error('未写入缓存');
        completed++;
      } catch {
        if (!controller.signal.aborted) failedDownloads.push(s);
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abort);
      }
      progress.value = i + 1;
    }
    status.textContent = `${controller.signal.aborted ? '已取消，已完成的下载保留' : '下载完成'} · 新增 ${completed} 个${failedDownloads.length ? ` · 失败 ${failedDownloads.length} 个` : ''}`;
    toast(status.textContent);
  } catch (e){
    status.textContent = '下载未完成，无法写入离线空间。可稍后重新下载未缓存品种。';
    toast(status.textContent);
  } finally {
    downloadController = null;
    cancel.hidden = true;
    retryBtn.hidden = !failedDownloads.length;
    await refreshOfflineStatus();
  }
}

function setupOffline(){
  document.getElementById('prefetchBtn').addEventListener('click', () => prefetchAll());
  document.getElementById('cancelDownload').addEventListener('click', () => downloadController?.abort());
  document.getElementById('retryDownload').addEventListener('click', () => prefetchAll(true));
  document.getElementById('offlineMarket').addEventListener('change', refreshOfflineStatus);
  window.addEventListener('online', refreshOfflineStatus);
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    offlineReady = !!navigator.serviceWorker.controller;
    refreshOfflineStatus();
  });
}
