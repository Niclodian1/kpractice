"use strict";

const TRKEY = 'kpractice_stats_v1';
const TSKEY = 'kpractice_sessions_v1';
const ACCT_KEY = 'kpractice_account_v1';
const INIT_CAPITAL = 100000;
const HISTORY_KEY = 'kpractice_history_v2';
const SNAPSHOT_KEY = 'kpractice_active_v1';
const PREFS_KEY = 'kpractice_preferences_v1';
let savedHistory = { updatedAt: 0, sessions: [] };
let savedPractice = null;
let persistQueue = Promise.resolve();

const TR_EMPTY = () => ({ sessions:0, orders:0, wins:0, grossWin:0, grossLoss:0, pnlSum:0, pnlPctSum:0, perSymbol:{} });

function lsGet(key, fallback){
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function lsSet(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e){ return false; }
}

let statsState = { ...TR_EMPTY(), ...lsGet(TRKEY, {}) };
let accountState = lsGet(ACCT_KEY, {}) || {};
const trStatsLoad = () => JSON.parse(JSON.stringify(statsState));
const trStatsSave = s => { statsState = s; return lsSet(TRKEY, s); };
const tsLoad = () => savedHistory.sessions;
const tsSave = arr => {
  savedHistory = { updatedAt: Math.max(Date.now(), savedHistory.updatedAt + 1), sessions: arr, stats: trStatsLoad() };
  const backup = lsSet(HISTORY_KEY, savedHistory);
  return idbSet(HISTORY_KEY, savedHistory).then(ok => {
    if (!ok && !backup) toast('历史保存失败，请立即导出明细备份');
    return ok || backup;
  });
};
const acctLoad = () => ({ ...accountState });
const acctSave = o => { accountState = o; return lsSet(ACCT_KEY, o); };

const DB_NAME = 'kpractice';
const DB_STORE = 'kv';
function idbOpen(){
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function idbSet(key, val){
  const snapshot = JSON.parse(JSON.stringify(val));
  persistQueue = persistQueue.then(async () => {
    let db;
    try {
      db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(snapshot, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
      });
      return true;
    } catch { return false; }
    finally { if (db) db.close(); }
  });
  return persistQueue;
}
async function idbGet(key){
  try {
    const db = await idbOpen();
    const val = await new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const q = tx.objectStore(DB_STORE).get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return val;
  } catch { return undefined; }
}

async function hydratePersist(){
  const [stats, legacy, acct, history, snapshot] = await Promise.all(
    [TRKEY, TSKEY, ACCT_KEY, HISTORY_KEY, SNAPSHOT_KEY].map(idbGet));
  const localHistory = lsGet(HISTORY_KEY, null);
  const versions = [history, localHistory].filter(h => h && Array.isArray(h.sessions));
  if (versions.length){
    savedHistory = versions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (savedHistory.stats) trStatsSave(savedHistory.stats);
  } else {
    const local = lsGet(TSKEY, []) || [];
    savedHistory.sessions = Array.isArray(legacy) && legacy.length > local.length ? legacy : local;
    if (stats && !lsGet(TRKEY, null)) trStatsSave(stats);
    await tsSave(savedHistory.sessions);
  }
  if (acct && !lsGet(ACCT_KEY, null)) acctSave(acct);
  const localSnapshot = lsGet(SNAPSHOT_KEY, null);
  savedPractice = [snapshot, localSnapshot].filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  // An archived session must never be resumed after a crash during settlement.
  if (savedPractice?.tr && tsLoad().some(s => s.id === savedPractice.tr.sessionId)) savedPractice = null;
}
function persistFlush(){
  idbSet(TRKEY, trStatsLoad());
  idbSet(ACCT_KEY, acctLoad());
}

function writePracticeSnapshot(value){
  savedPractice = { ...JSON.parse(JSON.stringify(value)), updatedAt: Math.max(Date.now(), (savedPractice?.updatedAt || 0) + 1) };
  const backup = lsSet(SNAPSHOT_KEY, savedPractice);
  idbSet(SNAPSHOT_KEY, savedPractice).then(ok => {
    if (!ok && !backup) toast('进度保存失败，请保留当前页面');
  });
}
function savePractice(){
  if (!trLocked() || replayT == null || !TR.startTs) return;
  writePracticeSnapshot({ version: 1, tr: { ...TR }, replayT, positions, posSeq,
    account: acctLoad(), drawings: drawRecs, range: chart?.timeScale().getVisibleLogicalRange() });
}
function clearPracticeSnapshot(){
  writePracticeSnapshot({ version: 1, tr: null });
  updateResumeCard();
}
function updateResumeCard(){
  const card = document.getElementById('resumeCard');
  if (!card) return;
  card.hidden = !savedPractice?.tr;
  if (savedPractice?.tr) document.getElementById('resumeInfo').textContent =
    `盲测 · ${savedPractice.tr.tf} · ${savedPractice.tr.step}/${savedPractice.tr.maxStep} 根 · ${savedPractice.positions.length} 笔持仓`;
}

function savePreferences(){
  const ids = ['trSymSel', 'trMktSel', 'trTfSel', 'trStepsInput', 'maPeriods'];
  const prefs = { theme: themeKey(), values: Object.fromEntries(ids.map(id => [id, document.getElementById(id).value])),
    overlays: Object.fromEntries([...document.querySelectorAll('[data-ov]')].map(b => [b.dataset.ov, b.classList.contains('active')])) };
  if (!lsSet(PREFS_KEY, prefs)) toast('偏好设置未能保存');
}
function restorePreferences(){
  const prefs = lsGet(PREFS_KEY, {});
  if (THEMES[prefs.theme]) document.documentElement.dataset.theme = prefs.theme;
  document.getElementById('themeBtn').textContent = themeKey() === 'dark' ? '浅色' : '深色';
  document.querySelector('meta[name="theme-color"]').content = t().plane;
  for (const [id, value] of Object.entries(prefs.values || {})){
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  document.getElementById('trMktSel').disabled = !!document.getElementById('trSymSel').value;
  for (const b of document.querySelectorAll('[data-ov]')){
    b.classList.toggle('active', prefs.overlays?.[b.dataset.ov] !== false);
  }
  applyOverlayPreferences();
}

function lotKey(e){
  return `${e.t}|${e.price}|${e.leverage}|${e.logic || ''}`;
}
function mergeLots(a, b){
  const out = [];
  const seen = new Set();
  for (const e of [...(a || []), ...(b || [])]){
    if (!e) continue;
    const k = lotKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
function groupTradesByPid(recs){
  const map = new Map();
  for (const r of recs || []){
    const id = r.pid != null ? r.pid : `${r.entry_time}|${r.side}|${r.entry}`;
    const prev = map.get(id);
    if (!prev){
      map.set(id, {
        ...r,
        pnl_u: +r.pnl_u || 0,
        capital: +r.capital || 0,
        adds: r.adds || 0,
        entries: (r.entries || []).slice(),
        entry_ts_list: (r.entry_ts_list || []).slice(),
        entry_prices: (r.entry_prices || []).slice(),
      });
      continue;
    }
    prev.pnl_u += +r.pnl_u || 0;
    prev.capital += +r.capital || 0;
    prev.entries = mergeLots(prev.entries, r.entries);
    if ((r.entry_ts_list || []).length > (prev.entry_ts_list || []).length){
      prev.entry_ts_list = (r.entry_ts_list || []).slice();
      prev.entry_prices = (r.entry_prices || []).slice();
    }
    prev.adds = Math.max(prev.adds || 0, r.adds || 0, Math.max(0, (prev.entries || []).length - 1));
    prev.exit_time = r.exit_time;
    prev.exit_ts = r.exit_ts;
    prev.exit_price = r.exit_price;
    prev.exit_logic = [prev.exit_logic, r.exit_logic].filter(Boolean).join(' / ');
    prev.exit_reason = r.exit_reason;
    prev.partial = false;
    prev.ratio = 1;
    prev.result = prev.pnl_u > 0 ? '盈' : (prev.pnl_u < 0 ? '亏' : '平');
    prev.pnl_pct_capital = +(prev.pnl_u / Math.max(prev.capital, 1e-9) * 100).toFixed(2);
  }
  for (const t of map.values()){
    if (t.entries && t.entries.length)
      t.adds = Math.max(t.adds || 0, t.entries.length - 1);
  }
  return [...map.values()];
}

function csvEscape(v){
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}
function csvJoin(arr){
  return arr.map(v => v == null ? '' : String(v)).join(';');
}
function tradeLots(t){
  if (Array.isArray(t.entries) && t.entries.length){
    return t.entries.map(e => ({
      t: e.t, price: e.price, capital: e.capital, leverage: e.leverage, logic: e.logic || '',
    }));
  }
  const times = t.entry_ts_list || [];
  const prices = t.entry_prices || [];
  if (times.length > 1){
    return times.map((ts, i) => ({
      t: typeof ts === 'number' && typeof fmtTimeReal === 'function' ? fmtTimeReal(ts) : ts,
      price: prices[i] ?? '',
      capital: i === 0 ? t.capital : '',
      leverage: t.leverage,
      logic: i === 0 ? (t.logic || '') : '加仓',
    }));
  }
  return [];
}
function csvRowsForTrade(head, t){
  const lots = tradeLots(t);
  const adds = lots.slice(1);
  const cash = lots.length ? +(lots[0].capital || t.capital || 0) : +t.capital || 0;
  const working = lots.length ? lots.reduce((s, e) => s + (+e.capital || 0), 0) : cash;
  const addCount = Math.max(t.adds || 0, adds.length);
  const summary = {
    ...head,
    pid: t.pid, kind: '持仓', lot: lots.length || 1,
    side: t.side, leverage: t.leverage, capital: t.capital,
    time: t.entry_time, price: t.entry,
    entry_time: t.entry_time, entry: t.entry,
    exit_time: t.exit_time, exit_price: t.exit_price,
    stop: t.stop, adds: addCount, ratio: t.ratio, partial: t.partial,
    pnl_u: t.pnl_u, pnl_pct_capital: t.pnl_pct_capital, result: t.result,
    exit_reason: t.exit_reason, entry_logic: t.logic, exit_logic: t.exit_logic,
    cash_capital: cash, working_capital: working || cash,
    add_times: csvJoin(adds.map(e => e.t)),
    add_prices: csvJoin(adds.map(e => e.price)),
    add_capitals: csvJoin(adds.map(e => e.capital)),
    add_logics: csvJoin(adds.map(e => e.logic)),
  };
  const extra = adds.map((e, i) => ({
    ...head,
    pid: t.pid, kind: '加仓', lot: i + 2,
    side: t.side, leverage: e.leverage ?? t.leverage, capital: e.capital,
    time: e.t, price: e.price,
    entry_time: e.t, entry: e.price,
    exit_time: t.exit_time, exit_price: t.exit_price,
    stop: t.stop, adds: addCount, ratio: '', partial: '',
    pnl_u: '', pnl_pct_capital: '', result: '',
    exit_reason: '', entry_logic: e.logic, exit_logic: '',
    cash_capital: '', working_capital: '',
    add_times: '', add_prices: '', add_capitals: '', add_logics: '',
  }));
  return [summary, ...extra];
}
function buildTrainerCsv(){
  const sessions = tsLoad();
  const cols = [
    'session_id','session_time','symbol','tf','start_time','steps','condition',
    'session_capital','session_end_capital','session_pnl',
    'pid','kind','lot','side','leverage','capital','time','price',
    'entry_time','entry','exit_time','exit_price',
    'stop','adds','ratio','partial','pnl_u','pnl_pct_capital','result',
    'exit_reason','entry_logic','exit_logic',
    'cash_capital','working_capital','add_times','add_prices','add_capitals','add_logics',
  ];
  const rows = [];
  for (const s of sessions){
    const head = {
      session_id: s.id,
      session_time: s.ts ? new Date(s.ts).toISOString() : '',
      symbol: s.sym, tf: s.tf,
      start_time: s.startTs != null ? fmtTs(s.startTs, s.tf) : '',
      steps: s.steps, condition: s.cond,
      session_capital: s.capital, session_end_capital: s.endCapital, session_pnl: s.pnl,
    };
    const trades = groupTradesByPid(s.trades || []);
    if (!trades.length){
      rows.push({ ...head, kind: '持仓' });
      continue;
    }
    for (const t of trades) rows.push(...csvRowsForTrade(head, t));
  }
  return '\ufeff' + cols.join(',') + '\n' +
    rows.map(r => cols.map(c => csvEscape(r[c])).join(',')).join('\n');
}

async function exportTrainerCsv(){
  const sessions = tsLoad();
  if (!sessions.length){ toast('暂无练习记录'); return; }
  const csv = buildTrainerCsv();
  const name = `practice_trades_${new Date().toISOString().slice(0,10)}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const file = new File([blob], name, { type: 'text/csv' });
  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], title: '练习明细' });
      return;
    }
  } catch (e){
    if (e && e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('已生成 CSV，若未弹出分享请用 Safari 打开此页');
}
