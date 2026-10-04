"use strict";

const randInt = n => Math.floor(Math.random() * n);

function showHome(){
  setTradeSheet(false);
  setObserveSheet(false);
  document.getElementById('homeView').hidden = false;
  document.getElementById('practiceView').hidden = true;
  refreshOfflineStatus();
  renderWeeklyCheckin();
}
function showPractice(){
  setTradeSheet(false);
  document.getElementById('homeView').hidden = true;
  document.getElementById('practiceView').hidden = false;
}
function setTradeSheet(on){
  const sheet = document.getElementById('tradeSheet');
  const btn = document.getElementById('tradeToggle');
  if (sheet) sheet.hidden = !on;
  if (btn){ btn.classList.toggle('active', !!on); btn.setAttribute('aria-expanded', String(!!on)); }
  if (on) document.getElementById('newOrderDetails').open = !positions.length;
  if (!on && sheet?.contains(document.activeElement)) document.activeElement.blur();
}
function toggleTradeSheet(){
  const sheet = document.getElementById('tradeSheet');
  setTradeSheet(sheet.hidden);
}

function applyBlind(on){
  document.body.classList.toggle('trainer-blind', on);
  const ls = document.querySelector('.legend-symbol');
  if (ls) ls.textContent = on ? '???' : (DATA && DATA.meta.symbol) || '';
  document.getElementById('symbolBadge').textContent =
    on ? `盲测 · ${activeTF}` : (DATA ? `${DATA.meta.symbol} · ${activeTF}` : '日线 / 小时');
  document.title = on ? '盘感练习 · 盲测中' : '盘感练习';
}

function enterReplay(ts){
  replayT = ts;
  renderJournal();
  refreshAll();
}

let replayTimer = null;
function stopPlay(){
  if (replayTimer){ clearInterval(replayTimer); replayTimer = null; }
}
function setReplayT(ts){
  const times = sessionTimes();
  if (!times.length) return;
  let lo = 0, hi = times.length - 1, pos = 0;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (times[mid] <= ts){ pos = mid; lo = mid + 1; } else hi = mid - 1;
  }
  replayT = times[pos];
  checkStopAndLiquidate();
  checkAccountBlowup();
  refreshAll({ light: true });
}
function stepReplay(dir){
  const times = sessionTimes();
  const i = times.indexOf(replayT);
  const ni = Math.max(0, Math.min(times.length - 1, (i < 0 ? times.length - 1 : i) + dir));
  setReplayT(times[ni]);
}

async function enterTrainer(){
  if (positions.length){ alert('当前有未平仓持仓, 请先平仓再开始练习'); return; }
  if (!TR.active && savedPractice?.tr && !confirm('开始新练习会替换上次未完成的进度，继续吗？')) return;
  stopPlay();
  reviewSession = null;
  document.getElementById('reviewNav').hidden = true;
  const btn = document.getElementById('trainerBtn');
  btn.disabled = true; btn.textContent = '随机定位中…';
  setLoading(true, '随机定位中…');
  try {
    TR.LOOKBACK = 200;
    const need = TR.LOOKBACK + TR.maxStep + 5;
    const minBars = Math.min(need, 280);
    const symSel = document.getElementById('trSymSel').value || '';
    const mktSel = document.getElementById('trMktSel').value || '';
    const tfSel = document.getElementById('trTfSel').value || '';
    TR.startIdx = 0; TR.startTs = null; TR.endReason = '';

    let pool = (symSel ? [catSym(symSel)].filter(Boolean) : symbolsByMarket(mktSel)).slice();
    if (!navigator.onLine && offlineReady){
      await refreshOfflineStatus();
      pool = pool.filter(s => offlineItems.get(s.id));
      if (!pool.length){ toast('所选范围没有离线数据，请选择已缓存品种'); return; }
    }
    if (tfSel) pool = pool.filter(s => (s.timeframes || []).includes(tfSel) && (s.bars[tfSel] || 0) >= minBars);
    else pool = pool.filter(s => (s.timeframes || []).some(tf => (s.bars[tf] || 0) >= minBars));
    if (!pool.length){
      alert(tfSel && tfSel !== '1D'
        ? `${tfSel} 目前仅加密品种有小时线。请改选加密，或用日线练习。`
        : '该「市场 × 级别」组合暂无足够长度的数据');
      updateTrainerUI();
      return;
    }

    for (let tries = 0; tries < 30; tries++){
      const meta = pool[randInt(pool.length)];
      setLoading(true, '加载K线…');
      await loadSymbol(meta.id);
      let tfs = (DATA.meta.timeframes || []).filter(tf => (DATA.levels[tf] && DATA.levels[tf].candles.length >= minBars));
      if (tfSel && !tfs.includes(tfSel)) continue;
      if (!tfs.length) continue;
      const tf = tfSel || tfs[randInt(tfs.length)];
      const candles = DATA.levels[tf].candles;
      const len = candles.length;
      let lookback = 200;
      let maxStep = TR.maxStep;
      if (len < lookback + maxStep + 5){
        lookback = Math.min(lookback, Math.max(40, len - maxStep - 5));
        maxStep = Math.min(maxStep, Math.max(20, len - lookback - 5));
      }
      if (len < lookback + maxStep + 5) continue;
      TR.initCapital = readStartCapital();
      TR.step = 0; TR.session = []; TR.curve = [{ step: 0, eq: TR.initCapital }];
      TR.revealed = false; TR.active = true; TR.quality = ''; TR.structure = ''; TR.turn = '';
      TR.signals = []; TR.durationMs = 0; TR.clockAt = Date.now();
      if (typeof clearDrawings === 'function') clearDrawings();
      TR.startWallTs = Date.now();
      TR.sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      TR.endCapital = TR.initCapital;
      acctReset();
      activeTF = tf;
      TR.sym = meta.id; TR.tf = tf;
      TR.LOOKBACK = lookback;
      TR.maxStep = maxStep;
      const lo = lookback, hi = len - maxStep - 2;
      let startIdx = null;
      for (let k = 0; k < 24; k++){
        const idx = lo + randInt(Math.max(1, hi - lo));
        if (candles[idx][2] > candles[idx][3]){ startIdx = idx; break; }
      }
      if (startIdx == null) continue;
      TR.startIdx = startIdx;
      TR.startTs = candles[TR.startIdx][0];
      applyBlind(true);
      showPractice();
      syncMarginInput();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      ensureCharts();
      applyTheme();
      trainerChartLock(true);
      document.getElementById('trainerBanner').style.display = 'none';
      enterReplay(TR.startTs);
      recordEquity();
      updateTrainerUI();
      requestAnimationFrame(() => { applySeries(); lockViewport(); alignPanes(); });
      return;
    }
    alert('随机定位失败。可改选日线，或先在「离线数据」中下载所需品种。');
    TR.active = false;
    updateTrainerUI();
    showHome();
  } catch (e){
    alert('练习器启动失败: ' + e.message);
    TR.active = false;
    updateTrainerUI();
    showHome();
  } finally {
    setLoading(false);
    const btn2 = document.getElementById('trainerBtn');
    if (!TR.active){ btn2.disabled = false; btn2.textContent = '开始练习'; }
  }
}

function trainerStep(){
  if (!trLocked()) return;
  stopPlay();
  TR.step++;
  stepReplay(1);
  if (!trLocked()) { updateTrainerUI(); return; }
  if (TR.step >= TR.maxStep){ revealTrainer(true); return; }
  recordEquity();
  updateTrainerUI();
  keepNowInView();
}

function revealTrainer(auto, note){
  if (!TR.active || TR.revealed) return;
  flushPracticeClock();
  TR.clockAt = 0;
  while (positions.length) closePosObj(positions[0], 1, auto ? '步数走满, 按现价强平' : '结束练习, 按现价强平', undefined, true, { silent: true });
  const endCapital = acctBal();
  TR.endReason = (note && String(note).includes('爆仓')) ? '账户爆仓'
    : (auto ? '步数走满' : '结束练习');
  recordEquity();
  TR.revealed = true;
  stopPlay();
  replayT = null;
  trainerChartLock(false);
  applyBlind(false);
  TR.endCapital = endCapital;
  recordSession();
  archiveSession(TR.endReason === '账户爆仓' ? '爆仓' : '完成');
  renderJournal();
  refreshAll();
  if (chart) chart.timeScale().fitContent();
  showAnswerBanner();
  updateTrainerUI();
}

function endTrainer(){
  reviewSession = null;
  setObserveSheet(false);
  document.getElementById('reviewNav').hidden = true;
  TR.active = false; TR.revealed = false; TR.session = []; TR.curve = []; TR.startTs = null;
  replayT = null;
  trainerChartLock(false);
  applyBlind(false);
  document.getElementById('trainerBanner').style.display = 'none';
  positions = [];
  showHome();
  updateResumeCard();
  renderTrainerStats();
  renderTrainerSessions();
  updateTrainerUI();
}

function quitTrainer(){
  if (!TR.active) return;
  if (TR.revealed){ endTrainer(); return; }
  if (!confirm('放弃本次练习? 未平仓仓位退还保证金；本局标记为「放弃」')) return;
  flushPracticeClock();
  TR.clockAt = 0;
  for (const p of positions) acctAdj(posCashCapital(p));
  positions = [];
  TR.endCapital = acctBal();
  TR.endReason = '放弃';
  archiveSession('放弃');
  endTrainer();
  toast('已放弃本局（未计入统计）');
}

function showAnswerBanner(){
  const el = document.getElementById('trainerBanner');
  const grouped = groupTradesByPid(TR.session);
  const n = grouped.length;
  const cap0 = sessionCapital();
  const endCap = typeof TR.endCapital === 'number' ? TR.endCapital : acctBal();
  const tot = +(endCap - cap0).toFixed(2);
  const pct = cap0 ? tot / cap0 * 100 : 0;
  const dd = maxDrawdown(TR.curve);
  el.innerHTML =
    `<b>本局答案：${DATA.meta.symbol} · ${TR.tf}</b>` +
    `<span>起点 <b>${fmtTimeReal(TR.startTs)}</b> · 走了 ${TR.step} 根 · ${TR.endReason || '—'} · 用时 ${formatDuration(TR.durationMs)}</span>` +
    `<span>开单 <b>${n}</b> 笔 · 本金 ${cap0.toLocaleString()}U → ${endCap.toLocaleString()}U</span>` +
    `<span>净 <b style="color:${tot >= 0 ? 'var(--up)' : 'var(--down)'}">${tot >= 0 ? '+' : ''}${tot.toFixed(1)}U（${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）</b> · 最大回撤 ${dd.toFixed(2)}%</span>` +
    equitySparkSvg(TR.curve, 280, 56, cap0) +
    signalListHtml(TR.signals, TR.tf) +
    sessionTagPickerHtml(TR);
  el.style.display = 'flex';
}

function chipBtn(field, val, label, current){
  return `<button type="button" class="chip${current === val ? ' active' : ''}" data-tag="${field}" data-val="${escapeHtml(val)}">${escapeHtml(label)}</button>`;
}
function sessionTagPickerHtml(s){
  return `<div class="quality-rate">
    <div class="logic-label">这局是好练习题吗？</div>
    <div class="chips">${chipBtn('quality', 'good', '好题', s.quality)}${chipBtn('quality', 'poor', '没意义', s.quality)}</div>
    <div class="logic-label">题目结构（可选）</div>
    <div class="chips tag-row">${STRUCTURE_TAGS.map(v => chipBtn('structure', v, v, s.structure)).join('')}</div>
    <div class="logic-label">趋势转换（可选）</div>
    <div class="chips tag-row">${TURN_TAGS.map(v => chipBtn('turn', v, v, s.turn)).join('')}</div>
  </div>`;
}
function signalListHtml(signals, tf){
  const list = sessionSignals({ signals });
  if (!list.length) return '<p class="hint">本局未标记信号K</p>';
  return `<div class="signal-list"><div class="logic-label">信号K ${list.length} 根</div>${
    list.map(g => `<div>${escapeHtml(fmtTs(g.t, tf))} · ${g.note ? escapeHtml(g.note) : '已标记，无观察备注'}</div>`).join('')
  }</div>`;
}

function rateSession(field, value, sessionId){
  const allowed = {
    quality: ['good', 'poor'],
    structure: STRUCTURE_TAGS,
    turn: TURN_TAGS,
  };
  if (!allowed[field] || (value && !allowed[field].includes(value))) return;
  const id = sessionId || reviewSession?.id || TR.sessionId;
  if (!id) return;
  const mine = String(reviewSession?.id || TR.sessionId) === String(id);
  const arr = tsLoad();
  const s = arr.find(x => String(x.id) === String(id));
  const next = s && s[field] === value ? '' : value;
  if (mine){
    TR[field] = next;
    if (reviewSession) reviewSession[field] = next;
  }
  if (!s){
    if (mine && document.getElementById('trainerBanner')?.style.display !== 'none' && (!reviewSession || reviewIndex < 0))
      showAnswerBanner();
    return;
  }
  if (s[field] === next){
    if (mine && document.getElementById('trainerBanner')?.style.display !== 'none' && (!reviewSession || reviewIndex < 0))
      showAnswerBanner();
    return;
  }
  s[field] = next;
  tsSave(arr);
  persistFlush();
  if (mine && document.getElementById('trainerBanner')?.style.display !== 'none' && (!reviewSession || reviewIndex < 0))
    showAnswerBanner();
  renderTrainerSessions();
}

function currentSignal(){
  const bar = curBar();
  if (!bar || !Array.isArray(TR.signals)) return null;
  return TR.signals.find(s => s.t === bar.time) || null;
}
function upsertSignal(note, opts = {}){
  const bar = curBar();
  if (!bar || !trLocked()) return;
  if (!Array.isArray(TR.signals)) TR.signals = [];
  if (opts.remove){
    TR.signals = TR.signals.filter(s => s.t !== bar.time);
  } else {
    const prev = TR.signals.find(s => s.t === bar.time);
    if (prev) prev.note = note || '';
    else TR.signals.push({ t: bar.time, note: note || '' });
    TR.signals.sort((a, b) => a.t - b.t);
  }
  if (typeof applySeries === 'function') applySeries();
  updateTrainerUI();
  savePractice();
}
function setObserveSheet(on){
  const sheet = document.getElementById('observeSheet');
  if (sheet) sheet.hidden = !on;
  if (on){
    const bar = curBar();
    document.getElementById('observeBarLabel').textContent = bar
      ? `当前 ${fmtTime(bar.time)}  O ${fmt(bar.open)} H ${fmt(bar.high)} L ${fmt(bar.low)} C ${fmt(bar.close)}`
      : '当前K线';
    document.getElementById('observeNote').value = currentSignal()?.note || '';
  }
}
function openObserveSheet(){
  if (!trLocked() || !curBar()) return;
  if (!currentSignal()) upsertSignal('');
  setObserveSheet(true);
}

function sessionTradeCount(){
  const pids = new Set(TR.session.map(r => r.pid));
  for (const p of positions) pids.add(p.id);
  return pids.size;
}

function updateTrainerUI(){
  const inRun = trLocked();
  document.getElementById('trainerProgress').textContent =
    `${TR.step}/${TR.maxStep} · ${sessionTradeCount()}笔`;
  document.getElementById('trainerNext').hidden = !inRun;
  document.getElementById('trainerNext').disabled = !inRun;
  document.getElementById('trainerQuit').hidden = !inRun;
  document.getElementById('trainerEnd').hidden = !(TR.active && TR.revealed);
  document.getElementById('trainerEnd').textContent = reviewSession ? '返回历史' : '结束';
  document.getElementById('trainerAgain').hidden = !(TR.active && TR.revealed) || !!reviewSession;
  document.getElementById('tradeToggle').hidden = !inRun;
  document.getElementById('positionSummary').hidden = !inRun;
  const signalBar = document.getElementById('signalBar');
  if (signalBar) signalBar.hidden = !inRun;
  const sig = currentSignal();
  const signalBtn = document.getElementById('signalBtn');
  if (signalBtn){
    signalBtn.classList.toggle('active', !!sig);
    signalBtn.textContent = sig ? (sig.note ? '信号·观' : '信号K') : '信号K';
  }
  const tradeBtn = document.getElementById('tradeToggle');
  if (tradeBtn){
    const nPos = positions.length;
    tradeBtn.textContent = nPos ? `交易 ${nPos}` : '交易';
  }
  const btn = document.getElementById('trainerBtn');
  btn.disabled = TR.active;
  btn.textContent = !TR.active ? '开始练习' : (TR.revealed ? '练习完成' : '练习中…');
  renderPositionSummary();
}

function recordSession(){
  const st = trStatsLoad();
  st.sessions++;
  for (const r of groupTradesByPid(TR.session)){
    st.orders++;
    if (r.pnl_u > 0) st.wins++;
    if (r.pnl_u >= 0) st.grossWin += r.pnl_u; else st.grossLoss += r.pnl_u;
    st.pnlSum += r.pnl_u;
    st.pnlPctSum += r.pnl_pct_capital || 0;
    const ps = st.perSymbol[r.symbol] || (st.perSymbol[r.symbol] = { orders:0, wins:0, pnl:0 });
    ps.orders++; if (r.pnl_u > 0) ps.wins++; ps.pnl += r.pnl_u;
  }
  trStatsSave(st);
  persistFlush();
  renderTrainerStats();
}

function archiveSession(cond){
  if (!TR.sym) return;
  const cap0 = sessionCapital();
  const endCap = typeof TR.endCapital === 'number' ? TR.endCapital : acctBal();
  const s = {
    id: TR.sessionId || Date.now(),
    ts: TR.startWallTs || Date.now(),
    sym: TR.sym, tf: TR.tf,
    startTs: TR.startTs,
    steps: TR.step,
    maxStep: TR.maxStep,
    drawings: JSON.parse(JSON.stringify(drawRecs)),
    capital: cap0,
    endCapital: +endCap.toFixed(2),
    pnl: +(endCap - cap0).toFixed(2),
    cond,
    reason: TR.endReason || cond,
    quality: TR.quality || '',
    structure: TR.structure || '',
    turn: TR.turn || '',
    durationMs: TR.durationMs || 0,
    signals: JSON.parse(JSON.stringify(TR.signals || [])),
    trades: TR.session.slice(),
    curve: (TR.curve || []).slice(),
  };
  const arr = [s, ...tsLoad().filter(old => old.id !== s.id)];
  tsSave(arr).then(ok => {
    if (ok && savedPractice?.tr?.sessionId === s.id) clearPracticeSnapshot();
  });
  persistFlush();
  renderTrainerSessions();
  renderLogicStats();
  renderWeeklyCheckin();
}

let historyLimit = 20;
function renderTrainerSessions(){
  const box = document.getElementById('trHistory');
  if (!box) return;
  const arr = tsLoad();
  const openId = box.querySelector('details[open]')?.dataset.tsid;
  document.getElementById('historyMore').hidden = arr.length <= historyLimit;
  if (!arr.length){ box.innerHTML = '<p class="hint">暂无历史练习局。</p>'; return; }
  box.innerHTML = arr.slice(0, historyLimit).map(s => {
    const trades = groupTradesByPid(s.trades || []);
    const qText = sessionQualityText(s.quality);
    const pct = sessionPnlPct(s);
    const dd = maxDrawdown(s.curve);
    const tags = [qText, s.structure, s.turn].filter(Boolean).join(' · ');
    return `<details class="ts-item" data-tsid="${escapeHtml(s.id)}">
      <summary class="ts-head"><span>${escapeHtml(s.sym)} · ${escapeHtml(s.tf)} · ${new Date(s.ts).toLocaleDateString('zh-CN')}</span>
      <span>${escapeHtml(s.reason || s.cond)}${tags ? ' · ' + escapeHtml(tags) : ''} · ${trades.length} 笔 · <b style="color:${s.pnl >= 0 ? 'var(--up)' : 'var(--down)'}">${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(1)}U（${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）</b> · 回撤 ${dd.toFixed(1)}%</span></summary>
      <div class="ts-detail"><div>本金 ${(s.capital || 0).toLocaleString()}U → ${(s.endCapital || 0).toLocaleString()}U · ${s.steps} 根 · 用时 ${formatDuration(s.durationMs)}</div>
      <div>最终盈亏 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% · 最大回撤 ${dd.toFixed(2)}%</div>${equitySparkSvg(s.curve, 280, 56, s.capital)}
      ${signalListHtml(s.signals, s.tf)}
      ${sessionTagPickerHtml(s)}
      <button class="btn" data-review="-1" type="button">回看本局 K 线</button>
      ${trades.map((trade, i) => `<button class="btn review-trade" data-review="${i}" type="button">
      <span>第 ${i + 1} 笔 · ${escapeHtml(trade.side)} · ${escapeHtml(trade.entry_time)} → ${escapeHtml(trade.exit_time)}</span>
      <span>${escapeHtml(trade.entry)} → ${escapeHtml(trade.exit_price)} · ${(+trade.pnl_u).toFixed(2)}U · ${formatR(trade.r_mult)} · 最大 ${formatR(trade.max_r)}</span>
      <span>入场：${escapeHtml(trade.logic || '未记录')} · 出场：${escapeHtml(trade.exit_logic || trade.exit_reason || '未记录')}</span></button>`).join('')}
      </div></details>`;
  }).join('');
  if (openId){
    const el = box.querySelector(`.ts-item[data-tsid="${CSS.escape(openId)}"]`);
    if (el) el.open = true;
  }
}

function renderWeeklyCheckin(){
  const countEl = document.getElementById('weekCheckinCount');
  if (!countEl) return;
  const w = weeklyCheckin();
  const left = Math.max(0, w.goal - w.count);
  const fmt = ts => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  document.getElementById('weekCheckinRange').textContent = `${fmt(w.start)} – ${fmt(w.end - 1)}`;
  countEl.innerHTML = `${w.count} <small>/ ${w.goal}</small>`;
  document.getElementById('weekCheckinBar').style.width = `${Math.min(100, w.count / w.goal * 100)}%`;
  document.getElementById('weekCheckinDots').innerHTML = Array.from({ length: w.goal }, (_, i) =>
    `<span class="${i < w.count ? 'on' : ''}"></span>`).join('');
  document.getElementById('weekCheckinDays').innerHTML = [...'一二三四五六日'].map((n, i) =>
    `<div>${n}<b>${w.days[i] || 0}</b></div>`).join('');
  const streak = w.streak ? ` · 连续 ${w.streak} 周达标` : '';
  document.getElementById('weekCheckinHint').textContent = w.done
    ? `本周已打卡 ${w.count} 局${streak}`
    : `还差 ${left} 局 · 走完或爆仓计入，放弃不计${streak}`;
}

function renderTrainerStats(){
  const g = document.getElementById('trStatsGrid');
  if (!g) return;
  const st = trStatsLoad();
  renderLogicStats();
  document.getElementById('trStatMode').textContent = `共 ${st.sessions} 局`;
  const perSymEl = document.getElementById('trPerSym');
  if (!st.orders){
    g.innerHTML = '<div><span class="k">暂无数据</span><span class="v">开始第一次盲测</span></div>';
    perSymEl.innerHTML = '';
    return;
  }
  const avgU = st.pnlSum / st.orders;
  const avgPct = st.pnlPctSum / st.orders;
  const pf = st.grossLoss < 0 ? (st.grossWin / Math.abs(st.grossLoss)).toFixed(2) : '—';
  const cell = (k, v) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`;
  g.innerHTML =
    cell('开单', `<strong>${st.orders}</strong> 笔`) +
    cell('胜率', `<strong>${(st.wins / st.orders * 100).toFixed(1)}%</strong>`) +
    cell('平均盈亏', `<strong style="color:${avgU >= 0 ? 'var(--up)' : 'var(--down)'}">${avgU >= 0 ? '+' : ''}${avgU.toFixed(1)}U</strong>`) +
    cell('平均收益', `${avgPct >= 0 ? '+' : ''}${avgPct.toFixed(2)}%`) +
    cell('累计净利', `${st.pnlSum >= 0 ? '+' : ''}${st.pnlSum.toFixed(0)}U`) +
    cell('盈利因子PF', pf);
  perSymEl.innerHTML = Object.entries(st.perSymbol)
    .sort((a, b) => b[1].orders - a[1].orders)
    .map(([s, v]) =>
      `<span style="margin-right:10px;">${s}: ${v.orders}笔 · 胜${v.orders ? (v.wins / v.orders * 100).toFixed(0) : 0}% · ${v.pnl >= 0 ? '+' : ''}${v.pnl.toFixed(0)}U</span>`
    ).join('');
}

function setupTrainer(){
  document.getElementById('trainerBtn').addEventListener('click', () => {
    if (TR.active) return;
    const steps = Math.min(500, Math.max(20, +document.getElementById('trStepsInput').value || 200));
    TR.maxStep = steps;
    enterTrainer();
  });
  const symSel = document.getElementById('trSymSel');
  symSel.innerHTML = '<option value="">随机</option>' +
    (CATALOG.symbols || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  symSel.addEventListener('change', () => {
    document.getElementById('trMktSel').disabled = !!symSel.value;
  });
  document.getElementById('trHistory').addEventListener('click', e => {
    const rate = e.target.closest('[data-tag]');
    if (rate){
      e.preventDefault();
      e.stopPropagation();
      const item = rate.closest('[data-tsid]');
      if (item) rateSession(rate.dataset.tag, rate.dataset.val, item.dataset.tsid);
      return;
    }
    const btn = e.target.closest('[data-review]');
    if (!btn) return;
    const id = btn.closest('[data-tsid]').dataset.tsid;
    openHistoryReview(id, Number(btn.dataset.review));
  });
  document.getElementById('trainerBanner').addEventListener('click', e => {
    const rate = e.target.closest('[data-tag]');
    if (rate) rateSession(rate.dataset.tag, rate.dataset.val);
  });
  document.getElementById('signalBtn').addEventListener('click', () => {
    if (!currentSignal()) upsertSignal('');
    else openObserveSheet();
    updateTrainerUI();
  });
  document.getElementById('observeBtn').addEventListener('click', openObserveSheet);
  document.getElementById('observeClose').addEventListener('click', () => setObserveSheet(false));
  document.getElementById('observeBackdrop').addEventListener('click', () => setObserveSheet(false));
  document.getElementById('observeSave').addEventListener('click', () => {
    upsertSignal(document.getElementById('observeNote').value.trim());
    setObserveSheet(false);
  });
  document.getElementById('observeSkip').addEventListener('click', () => {
    upsertSignal(currentSignal()?.note || '');
    setObserveSheet(false);
  });
  document.getElementById('observeClear').addEventListener('click', () => {
    upsertSignal('', { remove: true });
    setObserveSheet(false);
  });
  document.getElementById('historyMore').addEventListener('click', () => { historyLimit += 20; renderTrainerSessions(); });
  document.getElementById('tradeToggle').addEventListener('click', toggleTradeSheet);
  document.getElementById('tradeSheetClose').addEventListener('click', () => setTradeSheet(false));
  document.getElementById('tradeSheetBackdrop').addEventListener('click', () => setTradeSheet(false));
  document.getElementById('trainerNext').addEventListener('click', trainerStep);
  document.getElementById('trainerQuit').addEventListener('click', quitTrainer);
  document.getElementById('trainerEnd').addEventListener('click', endTrainer);
  document.getElementById('trainerAgain').addEventListener('click', () => {
    document.getElementById('trainerBanner').style.display = 'none';
    positions = [];
    const steps = Math.min(500, Math.max(20, +document.getElementById('trStepsInput').value || 200));
    TR.maxStep = steps;
    enterTrainer();
  });
  document.getElementById('trStatsClear').addEventListener('click', () => {
    if (confirm('确认清零全部练习战绩与历史明细?')){
      trStatsSave(TR_EMPTY());
      tsSave([]);
      persistFlush();
      renderTrainerStats();
      renderTrainerSessions();
      renderWeeklyCheckin();
    }
  });
  document.getElementById('trExport').addEventListener('click', () => exportTrainerCsv());
  window.addEventListener('keydown', e => {
    if (!trLocked()) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === ' '){ e.preventDefault(); trainerStep(); }
  });
  window.addEventListener('pagehide', () => { pausePracticeClock(); savePractice(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){ pausePracticeClock(); savePractice(); }
    else resumePracticeClock();
  });
  renderTrainerStats();
  renderTrainerSessions();
  renderWeeklyCheckin();
  updateTrainerUI();
}
