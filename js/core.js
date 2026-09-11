"use strict";

const THEMES = {
  dark:  { surface:'#1a1a19', plane:'#0d0d0d', ink:'#ffffff', ink2:'#c3c2b7', muted:'#898781', grid:'#2c2c2a', border:'#383835', up:'#0ca30c', down:'#e66767' },
  light: { surface:'#fcfcfb', plane:'#f4f3ef', ink:'#0b0b0b', ink2:'#52514e', muted:'#898781', grid:'#e1e0d9', border:'#c3c2b7', up:'#008300', down:'#e34948' },
};
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
const t = () => THEMES[document.documentElement.dataset.theme];
const themeKey = () => document.documentElement.dataset.theme;

let CATALOG = { symbols: [], timeframes: ['1D', '4H', '1H'] };
let DATA = null;
let currentSym = null;
let activeTF = '1D';
let replayT = null;
let idxMap = {};

const inReplay = () => replayT != null;
const p2 = n => String(n).padStart(2, '0');

const TR = {
  active: false,
  revealed: false,
  sym: null,
  tf: null,
  startIdx: 0,
  startTs: null,
  startWallTs: null,
  endCapital: 0,
  endReason: '',
  step: 0,
  maxStep: 200,
  LOOKBACK: 200,
  session: [],
};
const trLocked = () => TR.active && !TR.revealed;

function L(){ return DATA && DATA.levels[activeTF]; }

function fmtTs(ts, tf){
  if (ts == null) return '';
  const d = new Date(ts * 1000);
  const day = `${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-${p2(d.getUTCDate())}`;
  if ((tf || activeTF) === '1D') return day;
  return `${day} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
function fmtTimeReal(ts){
  return fmtTs(ts, activeTF) || '—';
}
function trLabel(ts){
  const lv = L();
  if (!lv) return '—';
  const times = lv.candles;
  let lo = 0, hi = times.length - 1, pos = 0;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (times[mid][0] <= ts){ pos = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const off = pos - TR.startIdx;
  return off >= 0 ? `T+${off}` : `T-${-off}`;
}
function fmtTime(ts){
  if (ts == null) return '—';
  if (trLocked()) return trLabel(ts);
  return fmtTimeReal(ts);
}
const fmt = n => {
  n = Number(n);
  const d = Math.abs(n) >= 1 ? 1 : Math.abs(n) >= 0.01 ? 4 : 8;
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
};

function displayRange(){
  const lv = L();
  if (!lv || !TR.active) return { lo: 0, hi: 0 };
  const n = lv.candles.length;
  const lo = Math.max(0, TR.startIdx - TR.LOOKBACK);
  if (TR.revealed){
    return { lo, hi: Math.min(n, TR.startIdx + TR.maxStep + 1) };
  }
  let pos = TR.startIdx;
  if (replayT != null){
    const cs = lv.candles;
    let a = 0, b = n - 1;
    while (a <= b){
      const m = (a + b) >> 1;
      if (cs[m][0] <= replayT){ pos = m; a = m + 1; } else b = m - 1;
    }
  }
  return { lo, hi: pos + 1 };
}
function candlesFor(){
  const lv = L();
  if (!lv) return [];
  const { lo, hi } = displayRange();
  return lv.candles.slice(lo, hi).map(c => ({
    time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0,
  }));
}
function volArrFor(){
  return candlesFor().map(c => c.volume);
}
function sessionTimes(){
  const lv = L();
  if (!lv) return [];
  const hi = Math.min(lv.candles.length, TR.startIdx + TR.maxStep + 1);
  return lv.candles.slice(TR.startIdx, hi).map(c => c[0]);
}
function macdLocal(closes){
  const ema = (vals, period) => {
    const k = 2 / (period + 1);
    let e = null;
    return vals.map(v => { e = e == null ? v : v * k + e * (1 - k); return e; });
  };
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const diff = e12.map((x, i) => x - e26[i]);
  const dea = ema(diff, 9);
  const hist = diff.map((x, i) => x - dea[i]);
  return { diff, dea, hist };
}
function macdFor(){
  const lv = L();
  if (!lv) return { diff: [], dea: [], hist: [] };
  const { lo, hi } = displayRange();
  const warm = Math.max(0, lo - 300);
  const closes = lv.candles.slice(warm, hi).map(c => c[4]);
  const m = macdLocal(closes);
  const cut = lo - warm;
  return { diff: m.diff.slice(cut), dea: m.dea.slice(cut), hist: m.hist.slice(cut) };
}

function toast(_msg){}
function setLoading(on, text){
  const el = document.getElementById('loading');
  el.hidden = !on;
  if (text) el.querySelector('span').textContent = text;
}

async function loadCatalog(){
  const r = await fetch('data/catalog.json');
  if (!r.ok) throw new Error('缺少 data/catalog.json，请先运行 python3 tools/build_mobile_data.py');
  CATALOG = await r.json();
}
async function loadSymbol(sym){
  if (DATA && currentSym === sym) return DATA;
  const r = await fetch('data/' + String(sym).toLowerCase() + '.json');
  if (!r.ok) throw new Error('K线加载失败');
  DATA = await r.json();
  currentSym = sym;
  return DATA;
}

function catSym(id){
  return (CATALOG.symbols || []).find(s => s.id === id);
}
function symbolsByMarket(mkt){
  const all = CATALOG.symbols || [];
  return mkt ? all.filter(s => s.market === mkt) : all;
}
