"use strict";

let reviewSession = null;
let reviewIndex = -1;
let restoringPractice = false;

function renderPositionSummary(){
  const el = document.getElementById('positionSummary');
  if (!el || !trLocked()) return;
  const bar = curBar();
  const pnl = bar ? positions.reduce((n, p) => n + pnlOf(p, bar.close), 0) : 0;
  const long = positions.filter(p => p.side === '多').length;
  const short = positions.length - long;
  const eq = acctEquity();
  const notional = posGrossNotional();
  const lev = effectiveLeverage();
  el.innerHTML = `<span>${positions.length ? `多 ${long} / 空 ${short}` : '暂无持仓'}</span>
    <span style="color:${pnl >= 0 ? 'var(--up)' : 'var(--down)'}">浮盈 ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}U</span>
    <span>净值 ${eq.toFixed(1)}U</span>
    <span data-sum-lev>杠杆 ${formatLev(lev)}${notional ? ` · ${notional.toFixed(0)}U` : ''}</span>`;
}

function restoreDrawings(records){
  clearDrawings();
  setDrawTool('none');
  drawRecs = JSON.parse(JSON.stringify(records || []));
  drawRecs.forEach(addDrawnLine);
  syncDrawOverlay();
  applyChartGestures();
}

async function resumePractice(){
  if (restoringPractice || TR.active || !savedPractice?.tr) return;
  restoringPractice = true;
  const snapshot = JSON.parse(JSON.stringify(savedPractice));
  setLoading(true, '恢复上次练习…');
  try {
    await loadSymbol(snapshot.tr.sym);
    const candles = DATA.levels[snapshot.tr.tf]?.candles;
    const startIdx = candles?.findIndex(c => c[0] === snapshot.tr.startTs) ?? -1;
    const cursor = candles?.findIndex(c => c[0] === snapshot.replayT) ?? -1;
    if (startIdx < 0 || cursor !== startIdx + snapshot.tr.step) throw new Error('当前数据无法对应原进度，请重新下载该品种后重试');
    Object.assign(TR, snapshot.tr, {
      startIdx, active: true, revealed: false,
      durationMs: snapshot.tr.durationMs || 0,
      clockAt: Date.now(),
      signals: Array.isArray(snapshot.tr.signals) ? snapshot.tr.signals : [],
      initCapital: snapshot.tr.initCapital || INIT_CAPITAL,
    });
    activeTF = TR.tf;
    replayT = snapshot.replayT;
    positions = snapshot.positions;
    posSeq = snapshot.posSeq;
    acctSave(snapshot.account);
    reviewSession = null;
    applyBlind(true);
    showPractice();
    await new Promise(r => requestAnimationFrame(r));
    ensureCharts();
    applyTheme();
    trainerChartLock(true);
    restoreDrawings(snapshot.drawings);
    renderJournal();
    syncMarginInput();
    refreshAll();
    if (snapshot.range) chart.timeScale().setVisibleLogicalRange(snapshot.range);
    else lockViewport();
    updateTrainerUI();
    toast('已恢复进度、持仓与画线');
  } catch (e){
    TR.active = false;
    positions = [];
    replayT = null;
    showHome();
    updateTrainerUI();
    toast(e.message || '恢复失败，请联网后重试');
  } finally {
    restoringPractice = false;
    setLoading(false);
  }
}

function renderLogicStats(){
  const el = document.getElementById('logicStats');
  if (!el) return;
  const groups = new Map();
  const sessions = tsLoad().filter(s => s.cond !== '放弃');
  for (const s of sessions){
    for (const trade of groupTradesByPid(s.trades)){
      const labels = [...new Set(String(trade.logic || '未记录逻辑').split('、'))];
      for (const label of labels){
        const stats = groups.get(label) || { n: 0, wins: 0, pnl: 0 };
        stats.n++; stats.wins += trade.pnl_u > 0 ? 1 : 0; stats.pnl += trade.pnl_u;
        groups.set(label, stats);
      }
    }
  }
  if (!sessions.length){ el.textContent = ''; return; }
  const drawdown = sessions.reduce((n, s) => Math.max(n, maxDrawdown(s.curve)), 0);
  const withSig = sessions.filter(s => sessionSignals(s).length);
  const noSig = sessions.filter(s => !sessionSignals(s).length);
  const avgPct = arr => arr.length ? arr.reduce((n, s) => n + sessionPnlPct(s), 0) / arr.length : 0;
  let watchNoEntry = 0, signalEntry = 0;
  for (const s of sessions){
    const entryTs = new Set();
    for (const t of s.trades || []){
      if (t.entry_ts != null) entryTs.add(t.entry_ts);
      for (const ts of t.entry_ts_list || []) entryTs.add(ts);
    }
    for (const g of sessionSignals(s)){
      if (entryTs.has(g.t)) signalEntry++;
      else watchNoEntry++;
    }
  }
  el.innerHTML = `<details><summary>按开单逻辑复盘 · 历史单局最大回撤 ${drawdown.toFixed(2)}%</summary>
    <p class="hint">基于已保存且完成的练习；多选逻辑分别计入各分类。</p>
    ${[...groups].sort((a, b) => b[1].n - a[1].n).map(([label, g]) =>
      `<div>${escapeHtml(label)}：${g.n} 笔 · 胜率 ${(g.wins / g.n * 100).toFixed(0)}% · ${g.pnl.toFixed(1)}U</div>`).join('')}
    <p class="hint">有无信号K</p>
    <div>有信号K：${withSig.length} 局 · 平均盈亏 ${avgPct(withSig) >= 0 ? '+' : ''}${avgPct(withSig).toFixed(2)}%</div>
    <div>无信号K：${noSig.length} 局 · 平均盈亏 ${avgPct(noSig) >= 0 ? '+' : ''}${avgPct(noSig).toFixed(2)}%</div>
    <div>信号K上进场 ${signalEntry} 次 · 信号后观察未进 ${watchNoEntry} 次</div>
    </details>`;
}

async function openHistoryReview(id, index = -1){
  if (TR.active || restoringPractice) return;
  const session = tsLoad().find(s => String(s.id) === String(id));
  if (!session) return;
  restoringPractice = true;
  setLoading(true, '加载复盘 K 线…');
  try {
    await loadSymbol(session.sym);
    const startIdx = DATA.levels[session.tf]?.candles.findIndex(c => c[0] === session.startTs) ?? -1;
    if (startIdx < 0) throw new Error('找不到这局对应的数据，请下载该品种后重试');
    reviewSession = session;
    reviewIndex = index;
    Object.assign(TR, { active: true, revealed: true, sym: session.sym, tf: session.tf,
      startIdx, startTs: session.startTs, step: session.steps, maxStep: session.steps,
      sessionId: session.id, quality: session.quality || '',
      structure: session.structure || '', turn: session.turn || '',
      durationMs: session.durationMs || 0, clockAt: 0,
      signals: JSON.parse(JSON.stringify(session.signals || [])),
      initCapital: session.capital || INIT_CAPITAL,
      session: session.trades || [], curve: session.curve || [], endCapital: session.endCapital, endReason: session.reason });
    activeTF = session.tf;
    replayT = null;
    positions = [];
    applyBlind(false);
    showPractice();
    await new Promise(r => requestAnimationFrame(r));
    ensureCharts();
    applyTheme();
    trainerChartLock(false);
    restoreDrawings(session.drawings);
    refreshAll();
    updateTrainerUI();
    document.getElementById('reviewNav').hidden = false;
    focusReviewTrade(index);
  } catch (e){
    TR.active = false; reviewSession = null;
    showHome(); updateTrainerUI();
    toast(e.message || '复盘加载失败');
  } finally { setLoading(false); restoringPractice = false; }
}

function focusReviewTrade(index){
  if (!reviewSession) return;
  const trades = groupTradesByPid(reviewSession.trades);
  reviewIndex = Math.max(-1, Math.min(trades.length - 1, index));
  document.getElementById('reviewPrev').disabled = reviewIndex <= -1;
  document.getElementById('reviewNext').disabled = reviewIndex >= trades.length - 1;
  document.getElementById('reviewLabel').textContent = reviewIndex < 0 ? '本局全貌' : `第 ${reviewIndex + 1}/${trades.length} 笔`;
  showAnswerBanner();
  if (reviewIndex < 0){ chart.timeScale().fitContent(); return; }
  const trade = trades[reviewIndex];
  const candles = candlesFor();
  const from = candles.findIndex(c => c.time === trade.entry_ts);
  const to = candles.findIndex(c => c.time === trade.exit_ts);
  if (from >= 0 && to >= 0) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, from - 12), to: to + 12 });
  const banner = document.getElementById('trainerBanner');
  banner.innerHTML = `<b>第 ${reviewIndex + 1} 笔 · ${escapeHtml(trade.side)} · ${(+trade.pnl_u).toFixed(2)}U</b>
    <span>${escapeHtml(trade.entry_time)} → ${escapeHtml(trade.exit_time)}</span>
    <span>入场：${escapeHtml(trade.logic || '未记录')}</span>
    <span>出场：${escapeHtml(trade.exit_logic || trade.exit_reason || '未记录')}</span>`;
}

function applyOverlayPreferences(){
  const isOn = ov => document.querySelector(`[data-ov="${ov}"]`).classList.contains('active');
  for (const b of document.querySelectorAll('[data-ov]')) b.setAttribute('aria-pressed', String(isOn(b.dataset.ov)));
  maSeries.forEach(it => it.series.applyOptions({ visible: isOn('ma') }));
  for (const [ov, id] of [['macd', 'macd'], ['vol', 'volume']]) document.getElementById(id).style.display = isOn(ov) ? '' : 'none';
  requestAnimationFrame(alignPanes);
}

function setupExperience(){
  updateResumeCard();
  document.getElementById('resumeBtn').addEventListener('click', resumePractice);
  document.getElementById('discardResumeBtn').addEventListener('click', () => {
    if (confirm('删除这局未完成的进度？历史战绩会保留。')) clearPracticeSnapshot();
  });
  document.getElementById('positionSummary').addEventListener('click', () => setTradeSheet(true));
  document.getElementById('reviewPrev').addEventListener('click', () => focusReviewTrade(reviewIndex - 1));
  document.getElementById('reviewNext').addEventListener('click', () => focusReviewTrade(reviewIndex + 1));
  document.getElementById('chartSettingsBtn').addEventListener('click', () => {
    const panel = document.getElementById('chartSettings');
    setChartSettingsOpen(panel.hidden);
  });
  for (const id of ['trSymSel', 'trMktSel', 'trTfSel', 'trStepsInput', 'trCapitalInput']) document.getElementById(id).addEventListener('change', savePreferences);
  const resize = () => {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty('--app-height', `${viewport?.height || innerHeight}px`);
    document.documentElement.style.setProperty('--viewport-top', `${viewport?.offsetTop || 0}px`);
    const controls = document.getElementById('trainerCtl');
    if (!document.getElementById('practiceView').hidden) document.documentElement.style.setProperty('--controls-height', `${controls.offsetHeight}px`);
    requestAnimationFrame(alignPanes);
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);
  new ResizeObserver(resize).observe(document.getElementById('trainerCtl'));
  resize();
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ setTradeSheet(false); setObserveSheet(false); }
  });
}
