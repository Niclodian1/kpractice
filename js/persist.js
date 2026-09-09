"use strict";

const TRKEY = 'kpractice_stats_v1';
const TSKEY = 'kpractice_sessions_v1';
const ACCT_KEY = 'kpractice_account_v1';
const INIT_CAPITAL = 100000;

const TR_EMPTY = () => ({ sessions:0, orders:0, wins:0, grossWin:0, grossLoss:0, pnlSum:0, pnlPctSum:0, perSymbol:{} });

function lsGet(key, fallback){
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function lsSet(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch (e){ toast('本地存储已满或不可用'); }
}

const trStatsLoad = () => ({ ...TR_EMPTY(), ...lsGet(TRKEY, {}) });
const trStatsSave = s => lsSet(TRKEY, s);
const tsLoad = () => lsGet(TSKEY, []) || [];
const tsSave = arr => lsSet(TSKEY, arr);
const acctLoad = () => lsGet(ACCT_KEY, {}) || {};
const acctSave = o => lsSet(ACCT_KEY, o);

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
async function idbSet(key, val){
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
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
  const [stats, sessions, acct] = await Promise.all([idbGet(TRKEY), idbGet(TSKEY), idbGet(ACCT_KEY)]);
  const lsSessions = tsLoad();
  if (Array.isArray(sessions) && sessions.length > lsSessions.length) tsSave(sessions);
  if (stats && typeof stats === 'object' && (stats.orders || 0) > (trStatsLoad().orders || 0)) trStatsSave(stats);
  if (acct && typeof acct === 'object' && Object.keys(acct).length && !Object.keys(acctLoad()).length) acctSave(acct);
}
function persistFlush(){
  idbSet(TRKEY, trStatsLoad());
  idbSet(TSKEY, tsLoad());
  idbSet(ACCT_KEY, acctLoad());
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
      });
      continue;
    }
    prev.pnl_u += +r.pnl_u || 0;
    prev.capital += +r.capital || 0;
    prev.adds = Math.max(prev.adds || 0, r.adds || 0);
    prev.exit_time = r.exit_time;
    prev.exit_price = r.exit_price;
    prev.exit_logic = [prev.exit_logic, r.exit_logic].filter(Boolean).join(' / ');
    prev.exit_reason = r.exit_reason;
    prev.partial = false;
    prev.ratio = 1;
    prev.result = prev.pnl_u > 0 ? '盈' : (prev.pnl_u < 0 ? '亏' : '平');
    prev.pnl_pct_capital = +(prev.pnl_u / Math.max(prev.capital, 1e-9) * 100).toFixed(2);
  }
  return [...map.values()];
}

function csvEscape(v){
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}
function buildTrainerCsv(){
  const sessions = tsLoad();
  const cols = [
    'session_id','session_time','symbol','tf','start_time','steps','condition',
    'session_capital','session_end_capital','session_pnl',
    'side','leverage','capital','entry_time','entry','exit_time','exit_price',
    'stop','adds','ratio','partial','pnl_u','pnl_pct_capital','result',
    'exit_reason','entry_logic','exit_logic',
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
      rows.push({ ...head });
      continue;
    }
    for (const t of trades){
      rows.push({
        ...head,
        side: t.side, leverage: t.leverage, capital: t.capital,
        entry_time: t.entry_time, entry: t.entry,
        exit_time: t.exit_time, exit_price: t.exit_price,
        stop: t.stop, adds: t.adds, ratio: t.ratio, partial: t.partial,
        pnl_u: t.pnl_u, pnl_pct_capital: t.pnl_pct_capital, result: t.result,
        exit_reason: t.exit_reason, entry_logic: t.logic, exit_logic: t.exit_logic,
      });
    }
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
