"use strict";

let chart, volumeChart, macdChart;
let candleSeries, volumeSeries, macdHistSeries, macdLineSeries, macdSignalSeries;
const MA_COLORS = ['#f5a623', '#4a90d9', '#b45cd6', '#2fbf8f', '#e05c78', '#8a9299'];
const maSeries = [];

function chartOptions(){
  const T = t();
  return {
    layout: {
      background: { type: LightweightCharts.ColorType.Solid, color: T.surface },
      textColor: T.ink2, fontSize: 11, fontFamily: FONT, attributionLogo: false,
      localization: { timeFormatter: fmtTime },
    },
    grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: T.border, lineStyle: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: T.ink2, labelTextColor: T.surface },
      horzLine: { color: T.border, labelBackgroundColor: T.ink2, labelTextColor: T.surface },
    },
    rightPriceScale: { borderColor: T.border },
    timeScale: { borderColor: T.border, timeVisible: activeTF !== '1D', secondsVisible: false, rightOffset: 3 },
    autoSize: true,
  };
}

function ensureCharts(){
  if (chart) return;
  chart = LightweightCharts.createChart(document.getElementById('chart'), chartOptions());
  candleSeries = chart.addCandlestickSeries({
    upColor: t().up, downColor: t().down,
    borderUpColor: t().up, borderDownColor: t().down,
    wickUpColor: t().up, wickDownColor: t().down,
  });
  volumeChart = LightweightCharts.createChart(document.getElementById('volume'), {
    ...chartOptions(),
    grid: { vertLines: { visible: false }, horzLines: { color: t().grid } },
    timeScale: { ...chartOptions().timeScale, visible: false },
  });
  volumeSeries = volumeChart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: '',
    lastValueVisible: false, priceLineVisible: false,
  });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.04 } });
  macdChart = LightweightCharts.createChart(document.getElementById('macd'), {
    ...chartOptions(),
    grid: { vertLines: { visible: false }, horzLines: { color: t().grid } },
    timeScale: { ...chartOptions().timeScale, visible: false },
  });
  macdHistSeries = macdChart.addHistogramSeries({
    priceScaleId: '', lastValueVisible: false, priceLineVisible: false,
  });
  macdLineSeries = macdChart.addLineSeries({
    color: t().ink2, lineWidth: 1, priceScaleId: '',
    lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
  });
  macdSignalSeries = macdChart.addLineSeries({
    color: t().muted, lineWidth: 1, priceScaleId: '',
    lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
  });
  macdHistSeries.priceScale().applyOptions({ scaleMargins: { top: 0.25, bottom: 0.05 } });
  attachDrawOverlay();
  setupDrawing();

  const syncAll = r => {
    if (!r) return;
    chart.timeScale().setVisibleLogicalRange(r);
    volumeChart.timeScale().setVisibleLogicalRange(r);
    macdChart.timeScale().setVisibleLogicalRange(r);
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(syncAll);
  volumeChart.timeScale().subscribeVisibleLogicalRangeChange(syncAll);
  macdChart.timeScale().subscribeVisibleLogicalRangeChange(syncAll);
  chart.timeScale().subscribeVisibleLogicalRangeChange(enforcePracticeBounds);

  window.addEventListener('resize', () => requestAnimationFrame(alignPanes));
  chart.subscribeCrosshairMove(param => {
    const oh = document.getElementById('legendOhlc');
    const ch = document.getElementById('legendChg');
    const dt = document.getElementById('legendDate');
    const dist = document.getElementById('legendDist');
    const d = param.seriesData && param.seriesData.get(candleSeries);
    if (!param.time || !d){
      oh.textContent = '—'; ch.textContent = ''; dt.textContent = '—';
      if (dist) dist.textContent = '';
      return;
    }
    dt.textContent = fmtTime(d.time);
    oh.textContent = `O ${fmt(d.open)}  H ${fmt(d.high)}  L ${fmt(d.low)}  C ${fmt(d.close)}`;
    const cs = candlesFor(), i = idxMap[d.time];
    const prev = i > 0 ? cs[i - 1].close : null;
    if (prev){
      const pct = (d.close - prev) / prev * 100;
      ch.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      ch.style.color = pct >= 0 ? 'var(--up)' : 'var(--down)';
    } else ch.textContent = '';
    const last = cs.length ? cs[cs.length - 1] : null;
    if (dist && last){
      let px = d.close;
      if (param.point){
        const p = candleSeries.coordinateToPrice(param.point.y);
        if (p != null) px = p;
      }
      const dp = px - last.close;
      const dd = Math.abs(dp) >= 1 ? 2 : Math.abs(dp) >= 0.01 ? 4 : 8;
      const pp = last.close ? dp / last.close * 100 : 0;
      const nb = cs.length - 1 - (i ?? cs.length - 1);
      dist.textContent = `距最新 ${dp >= 0 ? '+' : ''}${dp.toFixed(dd)} (${pp >= 0 ? '+' : ''}${pp.toFixed(2)}%)${nb ? ` · ${nb}根` : ''}`;
      dist.style.color = dp >= 0 ? 'var(--up)' : 'var(--down)';
    } else if (dist) dist.textContent = '';
  });
}

function parseMaPeriods(){
  const raw = document.getElementById('maPeriods').value.trim();
  if (!raw) return [];
  return [...new Set(raw.split(/[,，\s]+/).map(Number).filter(n => n >= 1 && n <= 2000))].slice(0, 6);
}
function sma(closes, period){
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++){
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
function rebuildMA(){
  if (!chart) return;
  const periods = parseMaPeriods();
  const cs = candlesFor();
  const closes = cs.map(c => c.close);
  while (maSeries.length < periods.length){
    const s = chart.addLineSeries({
      lineWidth: 1.4, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    maSeries.push({ period: 0, series: s });
  }
  while (maSeries.length > periods.length){
    const { series } = maSeries.pop();
    chart.removeSeries(series);
  }
  periods.forEach((p, i) => {
    const item = maSeries[i];
    item.period = p;
    item.series.applyOptions({ color: MA_COLORS[i % MA_COLORS.length] });
    const vals = sma(closes, p);
    item.series.setData(cs.map((c, j) => vals[j] != null ? { time: c.time, value: vals[j] } : null).filter(Boolean));
  });
}

function buildVolData(){
  const T = t(), cs = candlesFor(), vols = volArrFor();
  return cs.map((c, i) => ({ time: c.time, value: vols[i], color: c.close >= c.open ? T.up : T.down }));
}
function buildMacdData(){
  const T = t(), m = macdFor(), cs = candlesFor();
  return {
    hist: cs.map((c, i) => ({ time: c.time, value: m.hist[i], color: m.hist[i] >= 0 ? T.up : T.down })),
    diff: cs.map((c, i) => ({ time: c.time, value: m.diff[i] })),
    dea:  cs.map((c, i) => ({ time: c.time, value: m.dea[i] })),
  };
}
function buildMarkers(){
  const out = [];
  practiceEntries().forEach(e => {
    const long = e.side === '多';
    if (e.isExit){
      out.push({ time: e.time, position: long ? 'aboveBar' : 'belowBar',
        color: e.color, shape: 'square', text: `#${e.pid}`, size: 0.5 });
    } else {
      out.push({ time: e.time, position: long ? 'belowBar' : 'aboveBar',
        color: e.color, shape: long ? 'arrowUp' : 'arrowDown',
        text: `#${e.pid}${e.isAdd ? '+' : ''}`, size: 0.5 });
    }
  });
  out.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  return out;
}
function buildMaps(){
  const cs = candlesFor();
  idxMap = {};
  cs.forEach((c, i) => { idxMap[c.time] = i; });
}

function applySeries(){
  if (!chart) return;
  candleSeries.setData(candlesFor());
  candleSeries.setMarkers(buildMarkers());
  volumeSeries.setData(buildVolData());
  const md = buildMacdData();
  macdHistSeries.setData(md.hist);
  macdLineSeries.setData(md.diff);
  macdSignalSeries.setData(md.dea);
  buildMaps();
  rebuildMA();
  refreshDrawOverlay();
}

function applyTheme(){
  if (!chart) return;
  chart.applyOptions(chartOptions());
  candleSeries.applyOptions({
    upColor: t().up, downColor: t().down,
    borderUpColor: t().up, borderDownColor: t().down,
    wickUpColor: t().up, wickDownColor: t().down,
  });
  volumeChart.applyOptions({ ...chartOptions(), grid: { vertLines: { visible: false }, horzLines: { color: t().grid } }, timeScale: { ...chartOptions().timeScale, visible: false } });
  macdChart.applyOptions({ ...chartOptions(), grid: { vertLines: { visible: false }, horzLines: { color: t().grid } }, timeScale: { ...chartOptions().timeScale, visible: false } });
  macdLineSeries.applyOptions({ color: t().ink2 });
  macdSignalSeries.applyOptions({ color: t().muted });
  applySeries();
  refreshDrawOverlay();
  requestAnimationFrame(alignPanes);
}

let drawTool = 'none';
let drawPending = null;
const drawnLines = [];
let drawRecs = [];
let drawOverlayPrim = null;
const refreshDrawOverlay = () => { if (drawOverlayPrim && drawOverlayPrim._req) drawOverlayPrim._req(); };

function applyChartGestures(){
  if (!chart) return;
  const pan = drawTool === 'none';
  const o = { handleScroll: pan, handleScale: pan };
  chart.applyOptions(o); volumeChart.applyOptions(o); macdChart.applyOptions(o);
}
function trainerChartLock(on){
  if (!chart) return;
  applyChartGestures();
  chart.timeScale().applyOptions({
    tickMarkFormatter: on
      ? (ts => trLabel(typeof ts === 'object' && ts != null ? (ts.time ?? ts) : ts))
      : undefined,
  });
}

function timeToX(t){
  const ts = chart.timeScale();
  const x = ts.timeToCoordinate(t);
  if (x != null) return x;
  const cs = candlesFor();
  if (!cs.length) return null;
  if (cs.length === 1) return ts.timeToCoordinate(cs[0].time);
  const tF = cs[0].time, tS = cs[1].time, tL = cs[cs.length - 1].time, tP = cs[cs.length - 2].time;
  const xF = ts.timeToCoordinate(tF), xS = ts.timeToCoordinate(tS);
  const xL = ts.timeToCoordinate(tL), xP = ts.timeToCoordinate(tP);
  if (xF == null || xL == null) return null;
  if (t >= tL && xP != null && tL !== tP) return xL + (t - tL) / (tL - tP) * (xL - xP);
  if (t <= tF && xS != null && tS !== tF) return xF + (t - tF) / (tS - tF) * (xS - xF);
  return xF + (t - tF) / (tL - tF) * (xL - xF);
}
function xToTime(x){
  const t0 = chart.timeScale().coordinateToTime(x);
  if (t0 != null) return t0;
  const cs = candlesFor();
  if (cs.length < 2) return cs[0] ? cs[0].time : null;
  const tF = cs[0].time, tL = cs[cs.length - 1].time;
  const xF = chart.timeScale().timeToCoordinate(tF);
  const xL = chart.timeScale().timeToCoordinate(tL);
  if (xF == null || xL == null || xL === xF) return t0;
  return tF + (x - xF) / (xL - xF) * (tL - tF);
}
function cursorPrice(y){ return candleSeries.coordinateToPrice(y); }
function drawPx(p){
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  return +Number(p).toFixed(d);
}
function setDrawHint(s){
  const el = document.getElementById('drawHint');
  if (el) el.textContent = s || '';
}
function addDrawnLine(rec){
  if (rec.type !== 'sandr' || !candleSeries) return;
  const s = candleSeries.createPriceLine({
    price: rec.p, color: rec.color || '#f5a623', lineWidth: 1.6,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: '阻/支',
  });
  drawnLines.push({ type: 'sandr', series: s });
}
function clearDrawings(){
  drawRecs = [];
  drawPending = null;
  window._pendingTrend = null;
  window._trendLines = [];
  while (drawnLines.length){
    const l = drawnLines.pop();
    try { candleSeries.removePriceLine(l.series); } catch {}
  }
  refreshDrawOverlay();
  setDrawHint('');
}
function attachDrawOverlay(){
  if (drawOverlayPrim || !candleSeries) return;
  class DrawRenderer {
    constructor(prim){ this._prim = prim; }
    draw(target){
      const series = this._prim._series;
      target.useMediaCoordinateSpace(scope => {
        const ctx = scope.context;
        ctx.lineCap = 'round';
        const X = t0 => timeToX(t0);
        const Y = p => series.priceToCoordinate(p);
        const trends = window._trendLines || [];
        ctx.lineWidth = 2;
        for (const r of trends){
          const x1 = X(r.t1), y1 = Y(r.p1), x2 = X(r.t2), y2 = Y(r.p2);
          if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
          ctx.strokeStyle = r.color || '#4a90d9';
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.fillStyle = r.color || '#4a90d9';
          ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();
        }
        const pend = window._pendingTrend;
        if (pend){
          const qx1 = X(pend.t1), qy1 = Y(pend.p1), qx2 = X(pend.t2), qy2 = Y(pend.p2);
          if (qx1 != null && qy1 != null && qx2 != null && qy2 != null){
            ctx.lineWidth = 2; ctx.strokeStyle = pend.color || '#4a90d9';
            ctx.globalAlpha = 0.85; ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(qx1, qy1); ctx.lineTo(qx2, qy2); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = pend.color || '#4a90d9';
            ctx.beginPath(); ctx.arc(qx2, qy2, 3, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      });
    }
  }
  class DrawView {
    constructor(prim){ this._prim = prim; this._renderer = new DrawRenderer(prim); }
    update(){}
    renderer(){ return this._renderer; }
  }
  class DrawPrimitive {
    constructor(series, ch){ this._series = series; this._chart = ch; this._view = new DrawView(this); this._req = null; }
    attached(p){ this._req = p.requestUpdate; }
    updateAllViews(){}
    paneViews(){ return [this._view]; }
  }
  drawOverlayPrim = new DrawPrimitive(candleSeries, chart);
  candleSeries.attachPrimitive(drawOverlayPrim);
}
function setupDrawing(){
  if (setupDrawing._ok) return;
  setupDrawing._ok = true;
  document.querySelectorAll('#drawToggle button').forEach(b =>
    b.addEventListener('click', () => {
      drawTool = b.dataset.tool;
      document.querySelectorAll('#drawToggle button').forEach(x => x.classList.toggle('active', x === b));
      drawPending = null;
      window._pendingTrend = null;
      refreshDrawOverlay();
      applyChartGestures();
      setDrawHint(drawTool === 'trend' ? '点两个点画趋势线' : (drawTool === 'sandr' ? '点一下画水平线' : ''));
    }));
  document.getElementById('drawClear').addEventListener('click', () => {
    clearDrawings();
    drawTool = 'none';
    document.querySelectorAll('#drawToggle button').forEach(x =>
      x.classList.toggle('active', x.dataset.tool === 'none'));
    applyChartGestures();
  });
  const chartEl = document.getElementById('chart');
  let downPos = null;
  const pick = (clientX, clientY) => {
    const rect = chartEl.getBoundingClientRect();
    const cx = clientX - rect.left, cy = clientY - rect.top;
    let axisW = 60;
    try { axisW = chart.priceScale('right').width(); } catch {}
    if (cx >= chartEl.clientWidth - axisW) return null;
    const tRaw = xToTime(cx), pRaw = cursorPrice(cy);
    if (tRaw == null || pRaw == null) return null;
    return { t: tRaw, p: drawPx(pRaw) };
  };
  chartEl.addEventListener('pointerdown', e => {
    if (drawTool === 'none') return;
    downPos = { x: e.clientX, y: e.clientY };
  });
  chartEl.addEventListener('pointermove', e => {
    if (drawTool !== 'trend' || !drawPending) return;
    const pt = pick(e.clientX, e.clientY);
    if (!pt) return;
    window._pendingTrend = { t1: drawPending.t, p1: drawPending.p, t2: pt.t, p2: pt.p, color: '#4a90d9' };
    refreshDrawOverlay();
  });
  chartEl.addEventListener('pointerup', e => {
    if (drawTool === 'none' || !downPos) return;
    if (Math.abs(e.clientX - downPos.x) + Math.abs(e.clientY - downPos.y) > 8){ downPos = null; return; }
    downPos = null;
    const pt = pick(e.clientX, e.clientY);
    if (!pt) return;
    if (drawTool === 'sandr'){
      const rec = { type: 'sandr', p: pt.p, color: '#f5a623' };
      drawRecs.push(rec);
      addDrawnLine(rec);
      setDrawHint('水平线 ' + pt.p);
    } else if (drawTool === 'trend'){
      if (!drawPending){
        drawPending = pt;
        setDrawHint('再点终点');
      } else {
        const rec = { type: 'trend', t1: drawPending.t, p1: drawPending.p, t2: pt.t, p2: pt.p, color: '#4a90d9' };
        drawRecs.push(rec);
        window._trendLines = drawRecs.filter(r => r.type === 'trend');
        drawPending = null;
        window._pendingTrend = null;
        refreshDrawOverlay();
        setDrawHint('');
      }
    }
  });
}

const RIGHT_PAD = 8;
const MIN_BARS = 12;
let _lvLocking = false;

function practiceRangeLimits(){
  const n = candlesFor().length;
  return { n, minFrom: 0, maxTo: n + RIGHT_PAD };
}
function clampPracticeRange(r, pinRightIfNeeded){
  if (!trLocked() || !r || !chart) return;
  const { n, minFrom, maxTo } = practiceRangeLimits();
  if (!n) return;
  let from = r.from, to = r.to;
  if (!isFinite(from) || !isFinite(to)) return;
  if (pinRightIfNeeded && n - 1 > to - 0.2){
    const shift = (n - 1 + RIGHT_PAD) - to;
    from += shift;
    to += shift;
  }
  let span = to - from;
  const maxSpan = Math.max(MIN_BARS, maxTo - minFrom);
  if (span < MIN_BARS){
    const mid = (from + to) / 2;
    from = mid - MIN_BARS / 2;
    to = mid + MIN_BARS / 2;
    span = MIN_BARS;
  } else if (span > maxSpan){
    const mid = (from + to) / 2;
    from = mid - maxSpan / 2;
    to = mid + maxSpan / 2;
    span = maxSpan;
  }
  if (from < minFrom){ to += minFrom - from; from = minFrom; }
  if (to > maxTo){ from -= (to - maxTo); to = maxTo; }
  if (from < minFrom) from = minFrom;
  if (to > maxTo) to = maxTo;
  if (to - from < MIN_BARS) from = Math.max(minFrom, to - MIN_BARS);
  if (Math.abs(from - r.from) < 0.04 && Math.abs(to - r.to) < 0.04) return;
  _lvLocking = true;
  chart.timeScale().setVisibleLogicalRange({ from, to });
  requestAnimationFrame(() => { _lvLocking = false; });
}
function lockViewport(){
  if (!trLocked() || !chart) return;
  const { n, minFrom, maxTo } = practiceRangeLimits();
  if (!n) return;
  const w = Math.min(80, n);
  _lvLocking = true;
  chart.timeScale().setVisibleLogicalRange({
    from: Math.max(minFrom, n - w),
    to: maxTo,
  });
  requestAnimationFrame(() => { _lvLocking = false; });
}
function keepNowInView(){
  if (!trLocked() || !chart) return;
  const r = chart.timeScale().getVisibleLogicalRange();
  if (!r || !isFinite(r.from) || !isFinite(r.to)){ lockViewport(); return; }
  clampPracticeRange(r, true);
}
function enforcePracticeBounds(r){
  if (!trLocked() || !r || _lvLocking || !TR.sym || !chart) return;
  clampPracticeRange(r, false);
}

function alignPanes(){
  if (!chart) return;
  const Wm = chart.timeScale().width();
  if (!Wm || Wm < 80) return;
  const setW = (id, ch) => {
    const el = document.getElementById(id);
    if (!el || el.style.display === 'none') return;
    let ps = 0;
    try { ps = ch.priceScale('right').width(); } catch { return; }
    if (!ps || ps < 8) return;
    const target = Math.max(80, Math.round(Wm + ps));
    if (Math.abs(el.clientWidth - target) > 1) el.style.width = target + 'px';
  };
  setW('volume', volumeChart);
  setW('macd', macdChart);
}

function refreshAll(opts = {}){
  applySeries();
  updateLivePnl();
  if (typeof refreshPositionLines === 'function') refreshPositionLines();
  requestAnimationFrame(alignPanes);
  if (trLocked()) requestAnimationFrame(keepNowInView);
}
