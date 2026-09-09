"use strict";

const randInt = n => Math.floor(Math.random() * n);

function showHome(){
  document.getElementById('homeView').hidden = false;
  document.getElementById('practiceView').hidden = true;
}
function showPractice(){
  document.getElementById('homeView').hidden = true;
  document.getElementById('practiceView').hidden = false;
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
  stopPlay();
  const btn = document.getElementById('trainerBtn');
  btn.disabled = true; btn.textContent = '随机定位中…';
  setLoading(true, '随机定位中…');
  try {
    const need = TR.LOOKBACK + TR.maxStep + 5;
    const symSel = document.getElementById('trSymSel').value || '';
    const mktSel = document.getElementById('trMktSel').value || '';
    const tfSel = document.getElementById('trTfSel').value || '';
    TR.startIdx = 0; TR.startTs = null; TR.endReason = '';

    let pool = (symSel ? [catSym(symSel)].filter(Boolean) : symbolsByMarket(mktSel)).slice();
    if (tfSel) pool = pool.filter(s => (s.timeframes || []).includes(tfSel) && (s.bars[tfSel] || 0) >= need);
    else pool = pool.filter(s => (s.timeframes || []).some(tf => (s.bars[tf] || 0) >= need));
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
      let tfs = (DATA.meta.timeframes || []).filter(tf => (DATA.levels[tf] && DATA.levels[tf].candles.length >= need));
      if (tfSel && !tfs.includes(tfSel)) continue;
      if (!tfs.length) continue;
      const tf = tfSel || tfs[randInt(tfs.length)];
      const candles = DATA.levels[tf].candles;
      const len = candles.length;
      TR.step = 0; TR.session = []; TR.revealed = false; TR.active = true;
      TR.startWallTs = Date.now();
      TR.endCapital = INIT_CAPITAL;
      acctReset();
      activeTF = tf;
      TR.sym = meta.id; TR.tf = tf;
      TR.startIdx = TR.LOOKBACK + randInt(len - TR.LOOKBACK - TR.maxStep - 2);
      TR.startTs = candles[TR.startIdx][0];
      applyBlind(true);
      showPractice();
      syncMarginInput();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      ensureCharts();
      trainerChartLock(true);
      document.getElementById('trainerBanner').style.display = 'none';
      enterReplay(TR.startTs);
      updateTrainerUI();
      requestAnimationFrame(() => { applySeries(); lockViewport(); alignPanes(); });
      return;
    }
    alert('随机定位失败。可改选日线，或先点「下载全部品种」。');
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
  stepReplay(1);
  TR.step++;
  if (TR.step >= TR.maxStep){ revealTrainer(true); return; }
  updateTrainerUI();
  lockViewport();
}

function revealTrainer(auto, note){
  if (!TR.active || TR.revealed) return;
  while (positions.length) closePosObj(positions[0], 1, auto ? '步数走满, 揭示强平' : '主动揭示, 按现价强平', undefined, true);
  const endCapital = acctBal();
  TR.endReason = (note && String(note).includes('爆仓')) ? '账户爆仓'
    : (auto ? '步数走满' : '手动揭示');
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
  TR.active = false; TR.revealed = false; TR.session = []; TR.startTs = null;
  replayT = null;
  trainerChartLock(false);
  applyBlind(false);
  document.getElementById('trainerBanner').style.display = 'none';
  positions = [];
  showHome();
  renderTrainerStats();
  renderTrainerSessions();
  updateTrainerUI();
}

function quitTrainer(){
  if (!TR.active) return;
  if (TR.revealed){ endTrainer(); return; }
  if (!confirm('放弃本次练习? 未平仓仓位退还保证金；本局标记为「放弃」')) return;
  for (const p of positions) acctAdj(posCapital(p));
  positions = [];
  TR.endCapital = acctBal();
  archiveSession('放弃');
  endTrainer();
  toast('已放弃本局（未计入统计）');
}

function showAnswerBanner(){
  const el = document.getElementById('trainerBanner');
  const grouped = groupTradesByPid(TR.session);
  const n = grouped.length;
  const tot = grouped.reduce((a, r) => a + r.pnl_u, 0);
  const pct = grouped.reduce((a, r) => a + (r.pnl_pct_capital || 0), 0);
  el.innerHTML =
    `<b>本局答案：${DATA.meta.symbol} · ${TR.tf}</b>` +
    `<span>起点 <b>${fmtTimeReal(TR.startTs)}</b> · 走了 ${TR.step} 根 · ${TR.endReason || '—'}</span>` +
    `<span>开单 <b>${n}</b> 笔 · 净 <b style="color:${tot >= 0 ? 'var(--up)' : 'var(--down)'}">${tot >= 0 ? '+' : ''}${tot.toFixed(1)}U (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</b></span>`;
  el.style.display = 'flex';
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
  document.getElementById('trainerReveal').hidden = !inRun;
  document.getElementById('trainerQuit').hidden = !inRun;
  document.getElementById('trainerEnd').hidden = !(TR.active && TR.revealed);
  document.getElementById('trainerAgain').hidden = !(TR.active && TR.revealed);
  const btn = document.getElementById('trainerBtn');
  btn.disabled = TR.active;
  btn.textContent = !TR.active ? '开始练习' : (TR.revealed ? '练习完成' : '练习中…');
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
  const cap0 = INIT_CAPITAL;
  const endCap = typeof TR.endCapital === 'number' ? TR.endCapital : acctBal();
  const s = {
    id: Date.now(),
    ts: TR.startWallTs || Date.now(),
    sym: TR.sym, tf: TR.tf,
    startTs: TR.startTs,
    steps: TR.step,
    capital: cap0,
    endCapital: +endCap.toFixed(2),
    pnl: +(endCap - cap0).toFixed(2),
    cond,
    trades: TR.session.slice(),
  };
  let arr = tsLoad();
  arr.unshift(s);
  if (arr.length > 100) arr = arr.slice(0, 100);
  tsSave(arr);
  persistFlush();
  renderTrainerSessions();
}

function renderTrainerSessions(){
  const box = document.getElementById('trHistory');
  if (!box) return;
  const arr = tsLoad();
  if (!arr.length){
    box.innerHTML = '<div class="hint">暂无历史练习局。</div>';
    return;
  }
  box.innerHTML = arr.map(s => {
    const condTag = s.cond === '爆仓' ? '<b style="color:var(--down)">爆仓</b>'
      : s.cond === '放弃' ? '<span style="color:var(--muted)">放弃</span>'
      : '<span style="color:var(--up)">完成</span>';
    const col = s.pnl >= 0 ? 'var(--up)' : 'var(--down)';
    return `<div class="ts-item" data-tsid="${s.id}">
      <div class="ts-head" data-toggle="1">
        <span>${new Date(s.ts).toLocaleString('zh-CN', { hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })} · ${s.sym || '?'} ${s.tf || ''}</span>
        <span>${groupTradesByPid(s.trades || []).length}笔 · <b style="color:${col}">${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(1)}U</b> ${condTag}</span>
      </div>
      <div class="ts-detail" hidden>
        <div>本金 ${s.capital.toLocaleString()}U → 终值 <b>${s.endCapital.toLocaleString()}U</b> · 步数 ${s.steps}</div>
        ${(() => {
          const trades = groupTradesByPid(s.trades || []);
          return trades.length ? '<table><tr style="opacity:.6"><td>时间</td><td>方向</td><td>入场→出场</td><td style="text-align:right">盈亏U</td></tr>' +
          trades.map(t0 => `<tr><td>${t0.exit_time || ''}</td><td>${t0.side}${t0.adds > 0 ? '+'+t0.adds : ''}</td><td>${t0.entry}→${t0.exit_price}</td><td style="text-align:right;color:${t0.pnl_u >= 0 ? 'var(--up)' : 'var(--down)'}">${t0.pnl_u >= 0 ? '+' : ''}${(+t0.pnl_u).toFixed(1)}</td></tr>`).join('') + '</table>'
          : '<div style="opacity:.6">本局未开单。</div>';
        })()}
      </div>
    </div>`;
  }).join('');
}

function renderTrainerStats(){
  const g = document.getElementById('trStatsGrid');
  if (!g) return;
  const st = trStatsLoad();
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
    const head = e.target.closest('.ts-head');
    if (!head) return;
    const d = head.parentElement.querySelector('.ts-detail');
    if (d) d.hidden = !d.hidden;
  });
  document.getElementById('trainerNext').addEventListener('click', trainerStep);
  document.getElementById('trainerReveal').addEventListener('click', () => revealTrainer(false));
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
    }
  });
  document.getElementById('trExport').addEventListener('click', () => exportTrainerCsv());
  window.addEventListener('keydown', e => {
    if (!trLocked()) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === ' '){ e.preventDefault(); trainerStep(); }
  });
  window.addEventListener('beforeunload', e => {
    if (trLocked()){ e.preventDefault(); e.returnValue = ''; }
  });
  renderTrainerStats();
  renderTrainerSessions();
  updateTrainerUI();
}
