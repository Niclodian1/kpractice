"use strict";

const curModeKey = () => (TR.active && !TR.revealed) ? 'trainer' : 'replay';
const acctBal = () => {
  const a = acctLoad(), m = curModeKey();
  return typeof a[m] === 'number' ? a[m] : INIT_CAPITAL;
};
const acctAdj = d => {
  const a = acctLoad(), m = curModeKey();
  const base = typeof a[m] === 'number' ? a[m] : INIT_CAPITAL;
  a[m] = +(base + d).toFixed(6);
  acctSave(a);
  persistFlush();
};
const acctReset = () => { const a = acctLoad(); a[curModeKey()] = INIT_CAPITAL; acctSave(a); persistFlush(); };

let positions = [];
let posSeq = 1;
const posById = id => positions.find(p => p.id === id);
const posLayoutOk = pos => (pos.sym === currentSym) && pos.tf === activeTF;

function curBar(){
  const cs = candlesFor();
  return cs.length ? cs[cs.length - 1] : null;
}
const posCapital = pos => pos.entries.reduce((a, e) => a + e.capital, 0);
// 现金保证金=首笔开仓从余额划扣的部分; 其后加仓只允许用本笔浮盈, 从未扣过余额。
const posCashCapital = pos => pos.entries.length ? pos.entries[0].capital : 0;
const posFloatAddCapital = pos => pos.entries.slice(1).reduce((a, e) => a + e.capital, 0);
function posAvgEntry(pos){
  const nv = pos.entries.reduce((a, e) => a + e.price * e.capital * e.leverage, 0);
  const dn = pos.entries.reduce((a, e) => a + e.capital * e.leverage, 0);
  return dn ? nv / dn : 0;
}
function pnlOf(pos, price){
  const dir = pos.side === '多' ? 1 : -1;
  return pos.entries.reduce((a, e) => a + (price - e.price) / e.price * dir * e.leverage * e.capital, 0);
}
function posValue(pos, price){
  return pos.entries.reduce((a, e) => a + e.capital * e.leverage / e.price, 0) * price;
}
function addBudget(pos){
  if (!pos) return { u:0, used:0, avail:0 };
  const bar = curBar();
  const u = bar ? pnlOf(pos, bar.close) : 0;
  const used = pos.entries.slice(1).reduce((a, e) => a + e.capital, 0);
  return { u, used, avail: Math.max(0, u - used) };
}
const acctEquity = () => {
  const bar = curBar();
  const cur = positions.filter(p => posLayoutOk(p));
  // 净值 = 可用现金 + 已扣现金保证金 + 浮动盈亏。
  // 浮盈加仓的保证金来自 float, 若再计入 used 会与 floatPnl 重复, 虚增净值。
  const cashUsed = cur.reduce((a, p) => a + posCashCapital(p), 0);
  const floatPnl = bar ? cur.reduce((a, p) => a + pnlOf(p, bar.close), 0) : 0;
  return acctBal() + cashUsed + floatPnl;
};

const POS_COLORS = ['#f5a623', '#4a90d9', '#b45cd6', '#2fbf8f', '#e05c78', '#8a9299'];
const posColor = pos => POS_COLORS[(pos.id - 1) % POS_COLORS.length];
const posColorById = pid => POS_COLORS[(pid - 1) % POS_COLORS.length];
let posPriceLines = [];

function practiceEntries(){
  const out = [];
  for (const pos of positions){
    pos.entries.forEach((e, i) => out.push({
      time: e.t, price: e.price, side: pos.side, isAdd: i > 0, pid: pos.id, color: posColor(pos),
    }));
  }
  for (const r of TR.session){
    const live = positions.find(p => p.id === r.pid);
    if (!live){
      (r.entry_ts_list || []).forEach((t0, i) => out.push({
        time: t0, price: (r.entry_prices || [])[i] ?? r.entry, side: r.side, isAdd: i > 0,
        pid: r.pid, color: posColorById(r.pid), closed: true,
      }));
    }
    if (r.exit_ts != null) out.push({
      time: r.exit_ts, price: r.exit_price, side: r.side, isExit: true, pid: r.pid,
      color: r.pnl_u >= 0 ? t().up : t().down,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

const fmtLogic = (s, n=16) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };

function selectedLogic(root){
  if (!root) return '';
  return [...root.querySelectorAll('.chip.active')].map(b => b.dataset.logic).join('、');
}
function clearLogic(root){
  if (!root) return;
  root.querySelectorAll('.chip.active').forEach(b => b.classList.remove('active'));
}
function syncMarginInput(){
  const el = document.getElementById('jCapital');
  if (!el) return;
  const bal = acctBal();
  el.value = bal > 0 ? String(+bal.toFixed(2)) : '0';
}
function recordEquity(){
  if (!TR.active || TR.revealed) return;
  const eq = +acctEquity().toFixed(2);
  if (!Array.isArray(TR.curve)) TR.curve = [];
  const last = TR.curve[TR.curve.length - 1];
  if (last && last.step === TR.step) last.eq = eq;
  else TR.curve.push({ step: TR.step, eq });
}
function equitySparkSvg(curve, w, h){
  w = w || 280; h = h || 56;
  if (!curve || curve.length < 2) return '';
  const ys = curve.map(p => p.eq);
  const min = Math.min(...ys, INIT_CAPITAL);
  const max = Math.max(...ys, INIT_CAPITAL);
  const span = max - min || 1;
  const n = curve.length;
  const pts = curve.map((p, i) => {
    const x = n === 1 ? w / 2 : i / (n - 1) * w;
    const y = h - (p.eq - min) / span * (h - 6) - 3;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const last = ys[ys.length - 1];
  const col = last >= INIT_CAPITAL ? 'var(--up)' : 'var(--down)';
  const y0 = h - (INIT_CAPITAL - min) / span * (h - 6) - 3;
  return `<svg class="eq-spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <line x1="0" y1="${y0.toFixed(1)}" x2="${w}" y2="${y0.toFixed(1)}" stroke="var(--border)" stroke-dasharray="4 3"/>
    <polyline fill="none" stroke="${col}" stroke-width="1.7" points="${pts}"/>
  </svg>`;
}

function renderJournal(){
  const box = document.getElementById('jPositions');
  if (!box) return;
  document.getElementById('journalMode').textContent =
    inReplay() ? `· ${activeTF} @ ${fmtTime(replayT)}` : '';
  document.getElementById('jOpen').disabled = !inReplay();
  const bar = curBar();
  let html = '';
  const mine = positions.filter(p => posLayoutOk(p));
  const floatSum = bar ? mine.reduce((a, p) => a + pnlOf(p, bar.close), 0) : 0;
  const cashUsed = mine.reduce((a, p) => a + posCashCapital(p), 0);
  const addUsed = mine.reduce((a, p) => a + posFloatAddCapital(p), 0);
  const eq = acctEquity();
  const eqCol = eq > INIT_CAPITAL ? 'var(--up)' : (eq < INIT_CAPITAL ? 'var(--down)' : 'var(--ink-2)');
  html += `<div data-acct style="border:1px dashed var(--border);border-radius:8px;padding:8px;margin-top:6px;font-size:12px;">
    可用 <b data-abal>${acctBal().toFixed(2)}U</b> · 占用 <span data-aused>${cashUsed.toFixed(0)}</span>U${addUsed ? ` · 浮盈加仓 ${addUsed.toFixed(0)}U` : ''}<br>
    浮动 <span data-fsum style="font-weight:700;color:${floatSum >= 0 ? 'var(--up)' : 'var(--down)'}">${floatSum >= 0 ? '+' : ''}${floatSum.toFixed(2)}U</span>
    · 净值 <b data-aeq style="color:${eqCol}">${eq.toFixed(2)}U</b>
    ${positions.length ? '<button class="btn" data-act="close-all" type="button" style="margin-top:6px;width:100%;">一键全平</button>' : ''}
    ${equitySparkSvg(TR.curve)}
  </div>`;
  for (const pos of positions){
    const ok = posLayoutOk(pos);
    const cap = posCapital(pos);
    const u = ok && bar ? pnlOf(pos, bar.close) : 0;
    const pct = cap ? u / cap * 100 : 0;
    const col = u >= 0 ? 'var(--up)' : 'var(--down)';
    const pv = ok && bar ? posValue(pos, bar.close) : cap;
    const lastLev = pos.entries[pos.entries.length - 1].leverage;
    const addN = pos.entries.length - 1;
    html += `<div class="pos-card" data-pid="${pos.id}">
      <b>#${pos.id} ${pos.side}</b>${addN > 0 ? ` · 加仓×${addN}` : ''} · 均价 ${fmt(posAvgEntry(pos))} · 止损 ${pos.stop ?? '—'}<br>
      <span style="opacity:.85">持仓金额 ${pv.toFixed(1)} U</span><br>
      <span data-float="${pos.id}" style="font-size:15px;font-weight:700;color:${col}">浮动 ${u >= 0 ? '+' : ''}${u.toFixed(1)}U (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span><br>
      ${pos.entries.map((e, i) =>
        `<span style="opacity:.72">${i + 1}) ${e.price} · ${e.leverage}x · ${e.capital}U · ${fmtLogic(e.logic)}</span>`
      ).join('<br>')}
      <div class="row-btns" style="margin-top:8px;">
        <button class="btn primary" data-act="add-one" data-pid="${pos.id}" type="button">一键加仓</button>
        <button class="btn" data-act="add-toggle" data-pid="${pos.id}" type="button">加仓</button>
        <button class="btn" data-act="close-toggle" data-pid="${pos.id}" type="button">平仓</button>
      </div>
      <div class="sec-add" style="display:none;flex-direction:column;gap:6px;margin-top:6px;">
        <div data-budget="${pos.id}" style="font-size:11px;opacity:.8;"></div>
        <label>本金U(≤浮盈)<input type="number" class="inp-add-cap" inputmode="decimal" min="0" step="0.01"></label>
        <label>杠杆<input type="number" class="inp-add-lev" inputmode="numeric" value="${lastLev}" min="1" max="125"></label>
        <label>加仓价<input type="number" class="inp-add-price" inputmode="decimal" placeholder="当前收盘"></label>
        <label>止损（空=不变）<input type="number" class="inp-add-stop" inputmode="decimal"></label>
        <label>加仓逻辑（空=浮盈加仓）<textarea class="inp-add-logic" rows="2" placeholder="浮盈加仓"></textarea></label>
        <button class="btn primary" data-act="add-ok" data-pid="${pos.id}" type="button">确认加仓</button>
      </div>
      <div class="sec-exit" style="display:none;flex-direction:column;gap:6px;margin-top:6px;">
        <label>平仓比例%<input type="number" class="inp-exit-ratio" inputmode="numeric" value="100" min="1" max="100"></label>
        <label>平仓逻辑（必填）<textarea class="inp-exit-logic" rows="2"></textarea></label>
        <button class="btn primary" data-act="close-ok" data-pid="${pos.id}" type="button">确认平仓</button>
      </div>
    </div>`;
  }
  if (!positions.length){
    html += `<p class="hint" style="margin-top:8px;">暂无持仓。可同时开多笔不同方向。</p>`;
  }
  box.innerHTML = html;
  refreshPositionLines();
}

function updateLivePnl(){
  const jm = document.getElementById('journalMode');
  if (jm) jm.textContent = inReplay() ? `· ${activeTF} @ ${fmtTime(replayT)}` : '';
  const bar = curBar();
  if (!bar) return;
  const balEl = document.querySelector('[data-abal]');
  if (balEl){
    const mine = positions.filter(p => posLayoutOk(p));
    const floatSum = mine.reduce((a, p) => a + pnlOf(p, bar.close), 0);
    const cashUsed = mine.reduce((a, p) => a + posCashCapital(p), 0);
    const eq = acctBal() + cashUsed + floatSum;
    const fsEl = document.querySelector('[data-fsum]');
    const eqEl = document.querySelector('[data-aeq]');
    const usEl = document.querySelector('[data-aused]');
    balEl.textContent = acctBal().toFixed(2) + 'U';
    if (usEl) usEl.textContent = cashUsed.toFixed(0);
    if (fsEl){
      fsEl.textContent = (floatSum >= 0 ? '+' : '') + floatSum.toFixed(2) + 'U';
      fsEl.style.color = floatSum >= 0 ? 'var(--up)' : 'var(--down)';
    }
    if (eqEl){
      eqEl.textContent = eq.toFixed(2) + 'U';
      eqEl.style.color = eq > INIT_CAPITAL ? 'var(--up)' : (eq < INIT_CAPITAL ? 'var(--down)' : '');
    }
  }
  for (const pos of positions){
    if (!posLayoutOk(pos)) continue;
    const u = pnlOf(pos, bar.close);
    const cap = posCapital(pos);
    const f = document.querySelector(`[data-float="${pos.id}"]`);
    if (f){
      f.textContent = `浮动 ${u >= 0 ? '+' : ''}${u.toFixed(1)}U (${cap ? (u / cap * 100 >= 0 ? '+' : '') + (u / cap * 100).toFixed(1) : '0.0'}%)`;
      f.style.color = u >= 0 ? 'var(--up)' : 'var(--down)';
    }
    const bd = document.querySelector(`[data-budget="${pos.id}"]`);
    if (bd){
      const b = addBudget(pos);
      bd.innerHTML = `浮盈 <b style="color:${b.u >= 0 ? 'var(--up)' : 'var(--down)'}">${b.u >= 0 ? '+' : ''}${b.u.toFixed(2)}U</b> · 已加 ${b.used.toFixed(2)}U · 还可加 <b>${b.avail.toFixed(2)}U</b>`;
    }
  }
}

function makeRec(pos, r, exitPrice, exitTs, pnl, exitLogic, reason){
  const capClosed = posCashCapital(pos) * r;
  return {
    symbol: DATA.meta.symbol, tf: activeTF,
    mode: TR.active && !TR.revealed ? 'trainer' : 'replay',
    pid: pos.id,
    side: pos.side, leverage: pos.entries[0].leverage, capital: +capClosed.toFixed(2),
    entry_ts: pos.entries[0].t, exit_ts: exitTs,
    entry_ts_list: pos.entries.map(e => e.t), entry_prices: pos.entries.map(e => e.price),
    entry_time: fmtTimeReal(pos.entries[0].t), entry: +posAvgEntry(pos).toFixed(2),
    exit_time: fmtTimeReal(exitTs), exit_price: exitPrice,
    stop: pos.stop ?? '', logic: pos.entries[0].logic,
    adds: pos.entries.length - 1, ratio: +r.toFixed(2), partial: r < 1,
    entries: pos.entries.map(e => ({ t: fmtTimeReal(e.t), price: e.price, capital: e.capital, leverage: e.leverage, logic: e.logic })),
    exit_logic: exitLogic,
    pnl_u: +pnl.toFixed(2), pnl_pct_capital: +(pnl / Math.max(capClosed, 1e-9) * 100).toFixed(2),
    result: pnl > 0 ? '盈' : (pnl < 0 ? '亏' : '平'),
    exit_reason: reason + (r < 1 ? ` ${Math.round(r * 100)}%` : ''),
  };
}

function closePosObj(pos, r, exitLogic, reason = '手动平仓', force = false, opts = {}){
  if (!force && !posLayoutOk(pos)){
    alert(`该持仓绑定 ${pos.sym} ${pos.tf}，请在本局内结算。`);
    return false;
  }
  const bar = curBar();
  if (!bar) return false;
  const pnl = pnlOf(pos, bar.close) * r;
  const rec = makeRec(pos, r, bar.close, bar.time, pnl, exitLogic, reason);
  if (TR.active && !TR.revealed) TR.session.push(rec);
  acctAdj(posCashCapital(pos) * r + pnl);
  if (r >= 1) positions = positions.filter(p => p !== pos);
  else pos.entries.forEach(e => { e.capital = +(e.capital * (1 - r)).toFixed(6); });
  if (!opts.silent){
    renderJournal();
    syncMarginInput();
    refreshAll({ light: true });
    recordEquity();
    updateTrainerUI();
  }
  return true;
}
function addMaxFloat(pos){
  if (!inReplay()){ alert('请先开始练习'); return; }
  if (!posLayoutOk(pos)){ alert(`该持仓绑定 ${pos.sym} ${pos.tf}`); return; }
  const bar = curBar();
  if (!bar) return;
  const bd = addBudget(pos);
  if (bd.avail <= 0){
    alert(bd.u <= 0 ? '本笔暂无浮盈，无法加仓' : '浮盈已全部用于加仓');
    return;
  }
  // 加仓本金来自本笔浮盈, 不能 acctAdj(-cap): 余额可能为 0。
  // 也绝不能把它当成新的现金保证金, 否则净值 = 余额+占用+浮动 会把浮盈计两次。
  pos.entries.push({
    t: bar.time,
    price: bar.close,
    capital: +bd.avail.toFixed(2),
    leverage: pos.entries[pos.entries.length - 1].leverage,
    logic: '浮盈加仓',
  });
  renderJournal();
  refreshAll({ light: true });
  recordEquity();
  updateTrainerUI();
}
function closeAllPositions(){
  const mine = positions.filter(p => posLayoutOk(p));
  if (!mine.length){ alert('没有可平持仓'); return; }
  for (const pos of [...mine])
    closePosObj(pos, 1, '一键全平', '一键全平', false, { silent: true });
  renderJournal();
  syncMarginInput();
  refreshAll({ light: true });
  recordEquity();
  updateTrainerUI();
}

function checkStopAndLiquidate(){
  const bar = curBar();
  const mine = positions.filter(p => posLayoutOk(p));
  if (!bar || !mine.length) return;
  let changed = false;
  for (const pos of mine){
    const cap = posCapital(pos);
    const cash = posCashCapital(pos);
    const hitStop = pos.stop != null &&
      ((pos.side === '多' && bar.low <= pos.stop) ||
       (pos.side === '空' && bar.high >= pos.stop));
    const liq = pnlOf(pos, bar.close) <= -cap;
    if (!hitStop && !liq) continue;
    const px = hitStop ? pos.stop : bar.close;
    const pnl = hitStop ? pnlOf(pos, pos.stop) : -cap;
    const rec = makeRec(pos, 1, px, bar.time, Math.max(pnl, -cash), '', hitStop ? '触发止损' : '单笔爆仓');
    if (TR.active && !TR.revealed) TR.session.push(rec);
    acctAdj(cash + Math.max(pnl, -cash));
    positions = positions.filter(p => p !== pos);
    changed = true;
  }
  if (changed){
    renderJournal();
    syncMarginInput();
    recordEquity();
  }
}

function checkAccountBlowup(){
  if (!inReplay()) return false;
  if (acctEquity() > 0) return false;
  for (const pos of [...positions].filter(p => posLayoutOk(p)))
    closePosObj(pos, 1, '账户净值归零, 全部强平', '账户爆仓', true);
  acctSave({ ...acctLoad(), [curModeKey()]: 0 });
  persistFlush();
  if (TR.active && !TR.revealed){
    revealTrainer(true, '💥 账户爆仓, 练习强制结束');
  }
  return true;
}

function refreshPositionLines(){
  if (!candleSeries) return;
  for (const l of posPriceLines){
    try { candleSeries.removePriceLine(l.line); } catch {}
  }
  posPriceLines = [];
  if (!inReplay() || !positions.length) return;
  for (const pos of positions){
    const color = posColor(pos);
    posPriceLines.push({ pid: pos.id, kind: 'entry', line: candleSeries.createPriceLine({
      price: posAvgEntry(pos), color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true, title: `#${pos.id}`,
    })});
    if (pos.stop != null){
      posPriceLines.push({ pid: pos.id, kind: 'stop', line: candleSeries.createPriceLine({
        price: pos.stop, color: t().down, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true, title: `${pos.id}损`,
      })});
    }
  }
}

function setupJournal(){
  document.getElementById('jLogicPicks').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chip.classList.toggle('active');
  });
  document.getElementById('jOpen').addEventListener('click', () => {
    if (!inReplay()){ alert('请先开始练习'); return; }
    const logic = selectedLogic(document.getElementById('jLogicPicks'));
    const bar = curBar();
    if (!bar) return;
    const maxBal = acctBal();
    const margin = +(document.getElementById('jCapital').value) || maxBal;
    if (margin > maxBal + 1e-9){
      alert(`余额不足: 当前可用 ${maxBal.toFixed(2)}U`);
      return;
    }
    if (margin <= 0){ alert('保证金须大于 0'); return; }
    acctAdj(-margin);
    positions.push({
      id: posSeq++,
      sym: currentSym, tf: activeTF,
      side: document.getElementById('jSide').value,
      stop: document.getElementById('jStop').value ? +document.getElementById('jStop').value : null,
      entries: [{
        t: bar.time,
        price: +document.getElementById('jEntry').value || bar.close,
        capital: margin,
        leverage: Math.min(125, +document.getElementById('jLeverage').value || 10),
        logic,
      }],
    });
    clearLogic(document.getElementById('jLogicPicks'));
    renderJournal();
    syncMarginInput();
    refreshAll({ light: true });
    setTradeSheet(true);
    recordEquity();
    updateTrainerUI();
  });

  document.getElementById('jPositions').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'close-all'){
      closeAllPositions();
      return;
    }
    const card = b.closest('.pos-card');
    const pos = card ? posById(+card.dataset.pid) : null;
    if (!pos) return;
    const q = sel => card.querySelector(sel);
    const showOnly = secName => {
      for (const s of card.querySelectorAll('.sec-add,.sec-exit')) s.style.display = 'none';
      if (secName) q(secName).style.display = 'flex';
    };
    switch (b.dataset.act){
      case 'add-one':
        addMaxFloat(pos);
        break;
      case 'add-toggle': {
        const bd = addBudget(pos);
        if (bd.avail <= 0){
          alert(bd.u <= 0 ? '本笔暂无浮盈，无法加仓' : `浮盈已全部用于加仓`);
          return;
        }
        showOnly(q('.sec-add').style.display === 'none' ? '.sec-add' : null);
        const capInp = q('.inp-add-cap');
        if (capInp) capInp.value = bd.avail.toFixed(2);
        break;
      }
      case 'close-toggle':
        showOnly(q('.sec-exit').style.display === 'none' ? '.sec-exit' : null);
        break;
      case 'add-ok': {
        const logic = q('.inp-add-logic').value.trim() || '浮盈加仓';
        const bar = curBar(); if (!bar) return;
        const bd = addBudget(pos);
        const wantCap = +q('.inp-add-cap').value || 0;
        if (wantCap <= 0){ alert('请填写加仓本金'); return; }
        if (wantCap > bd.avail + 1e-9){
          alert(`只能用本笔浮盈加仓，还可加 ${bd.avail.toFixed(2)}U`);
          return;
        }
        pos.entries.push({
          t: bar.time,
          price: +q('.inp-add-price').value || bar.close,
          capital: wantCap,
          leverage: Math.min(125, +q('.inp-add-lev').value || pos.entries[pos.entries.length - 1].leverage),
          logic,
        });
        const ns = q('.inp-add-stop').value;
        if (ns) pos.stop = +ns;
        renderJournal();
        refreshAll({ light: true });
        recordEquity();
        break;
      }
      case 'close-ok': {
        const logic = q('.inp-exit-logic').value.trim();
        if (!logic){ alert('平仓逻辑必填'); return; }
        let ratio = (+q('.inp-exit-ratio').value || 100) / 100;
        ratio = Math.min(1, Math.max(0.01, ratio));
        closePosObj(pos, ratio, logic);
        break;
      }
    }
  });
}
