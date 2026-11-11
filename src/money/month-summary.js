/* ==========================================================================
   v2.34 — A MONTH IN ONE LOOK
   One definition of "spent" (the Ledger's): spending entries, without the
   Investment category, including what someone else paid for you.
   monthWalk()      start of month → end of month for bank + cash − card dues
   monthClose()     the summary sheet: spent, how the money moved, categories
   monthCloseAll()  closing balances of all accounts compared together: opposite
                    differences are moves between your own accounts; only the
                    net is unrecorded spending (or income)
   ======================================================================== */
const handAcct = a => !!a && (isLiquid(a.kind) || a.kind === 'card');
const r2 = n => Math.round(n * 100) / 100;
function monthWalk(c, ym) {
  const cur = isoMonth(new Date());
  if (!c || !ym || ym < c.startMonth || ym > cur || !accts(true).length) return null;
  let rows; try { rows = planCompute(c, ym, 'actual'); } catch (e) { RLOG.warn('walk', e.message); return null; }
  const row = rows[rows.length - 1]; if (!row || row.ym !== ym) return null;
  const prev = rows.length > 1 ? rows[rows.length - 2].accts : null, list = accts(true).filter(handAcct);
  const W = { ym, open: 0, close: 0, inc: 0, spent: 0, invest: 0, loans: 0, udh: 0, other: 0, ended: ym < cur, accts: list, closeBy: {}, interest: row.interest || 0 };
  list.forEach(a => { W.open += prev ? (prev[a.id] || 0) : (isLiab(a.kind) ? -(+a.open || 0) : (+a.open || 0)); W.closeBy[a.id] = row.accts[a.id] || 0; W.close += row.accts[a.id] || 0; });
  ledgerFlows(c).forEach(f => {
    if (f.ym !== ym || !handAcct(acctById(f.acct))) return;
    if (f.cat === 'inc') W.inc += f.amt;
    else if (f.cat === 'exp') { if (f.e && f.e.category === 'Investment') W.invest += f.amt; else W.spent -= f.amt; }
    else if (f.cat === 'udh') W.udh += f.amt;
    else { const o = acctById(f.cat === 'out' ? f.e.to : f.e.acct);
      if (handAcct(o)) return;                                               // between bank, cash and card: both sides are here, they cancel
      if (o && isInvest(o.kind)) W.invest += f.amt; else if (o && o.kind === 'loan') W.loans += f.amt; else W.other += f.amt; }
  });
  W.gap = r2(W.close - (W.open + W.inc - W.spent + W.invest + W.loans + W.udh + W.other));
  const F = all('fin').filter(e => (e.date || '').slice(0, 7) === ym);
  W.unrec = F.filter(e => e.kind === 'expense' && e.category === 'Adjustment' && !isPaidBy(e)).reduce((t, e) => t + (+e.amount || 0), 0);
  W.unrecInc = F.filter(e => e.kind === 'income' && e.category === 'Adjustment').reduce((t, e) => t + (+e.amount || 0), 0);
  W.paidBy = F.filter(e => isPaidBy(e) && e.category !== 'Investment').reduce((t, e) => t + (+e.amount || 0), 0);
  const pm = pmGet(ym), ck = (pm && pm.checked) || {};
  W.closed = !!(pm && pm.closed);
  W.nChecked = list.filter(a => !a.archived && !isBlank(ck[a.id])).length;
  W.nOff = list.filter(a => !a.archived && !isBlank(ck[a.id]) && Math.abs((isLiab(a.kind) ? -(+ck[a.id]) : +ck[a.id]) - (row.accts[a.id] || 0)) >= 0.5).length;
  W.nAccts = list.filter(a => !a.archived).length;
  return W;
}
function monthClose(ym) {
  const c = planCfg(), cur = isoMonth(new Date());
  const F = all('fin').filter(e => (e.date || '').slice(0, 7) === ym), M = monthFigures(F), bud = budgets(), byC = {};
  F.filter(e => e.kind === 'expense' && e.category !== 'Investment').forEach(e => { const k = e.category === 'Adjustment' ? 'Not entered (balance check)' : e.category || 'Other'; byC[k] = (byC[k] || 0) + (+e.amount || 0); });
  const cats = Object.entries(byC).sort((a, b) => b[1] - a[1]);
  const over = Object.entries(bud).filter(([k, b]) => (byC[k] || 0) > b).map(([k, b]) => `${esc(k)} ${rsShort(byC[k])} of ${rsShort(b)}`);
  const budTot = Object.values(bud).reduce((s, x) => s + x, 0), pend = ledgerPending(ym);
  const U = ym < cur ? udhaarAsOf(monthEnd(ym)) : udhaarSplit();
  const prevM = monthFigures(all('fin').filter(e => (e.date || '').slice(0, 7) === monthAdd(ym, -1)));
  const W = monthWalk(c, ym);
  const line = (k, v, cls, sub) => `<div class="pl-row"><span class="r-name">${k}${sub ? `<small class="dq-sub">${sub}</small>` : ''}</span><b class="mono ${cls || ''}">${v}</b></div>`;
  const sg = (n, plusWord, minusWord) => Math.abs(n) < 0.5 ? '' : line(n > 0 ? plusWord : minusWord, (n > 0 ? '+' : '−') + rs(Math.abs(n)), n > 0 ? 'pos' : 'neg');
  const unrec = W ? W.unrec : F.filter(e => e.kind === 'expense' && e.category === 'Adjustment').reduce((t, e) => t + (+e.amount || 0), 0);
  let status = '', walk = '';
  if (W) {
    const end = fmtDate(monthEnd(ym), true);
    status = !W.ended ? `<p class="hint">${esc(monthLong(ym))} is still running: this is what is in the Ledger so far. The balances can be checked with your bank after ${end}.</p>`
      : !W.nChecked ? `<button class="plan-banner" id="mcGo"><b>Balances not checked with your bank yet.</b> “Spent” only counts what you entered. Type your closing balances to find what was not entered ›</button>`
      : W.nOff ? `<button class="plan-banner" id="mcGo"><b>${W.nOff} account${W.nOff > 1 ? 's do' : ' does'} not match what you typed.</b> Open the check-up to finish ›</button>`
      : `<p class="hint pos">✓ ${W.nChecked} of ${W.nAccts} account${W.nAccts > 1 ? 's' : ''} matched with your closing balances${W.nChecked < W.nAccts ? ' (the others were left blank)' : ''}.</p>`;
    walk = `<h4 class="plan-sub">How your money moved · bank + cash − card dues</h4><div class="group pl-group">
      ${line('Start of ' + monthShort(ym), rs(W.open))}
      ${W.inc >= 0.5 ? line('Received', '+' + rs(W.inc), 'pos') : ''}
      ${W.spent >= 0.5 ? line('Spent from your accounts', '−' + rs(W.spent), 'neg') : ''}
      ${sg(W.invest, 'Taken out of investments', 'Put into investments')}
      ${sg(W.loans, 'Loan money received', 'Paid towards loans')}
      ${sg(W.udh, 'Udhaar: came in (net)', 'Udhaar: went out (net)')}
      ${sg(W.other + W.gap, 'Other moves in', 'Other moves out')}
      ${line(W.ended ? 'End of ' + monthShort(ym) : 'Now', rs(W.close), '', W.ended ? 'what the app says you had on ' + end : '')}</div>`;
  }
  const mine = M.out - unrec - (W ? W.paidBy : 0);
  planSheet(monthLong(ym) + ' — summary', `${status}<div class="group pl-group">
      ${line('<b>Spent</b>', rs(M.out), 'neg')}
      ${unrec >= 0.5 || (W && W.paidBy >= 0.5) ? line('&nbsp;&nbsp;entered by you', rs(mine)) : ''}
      ${unrec >= 0.5 ? line('&nbsp;&nbsp;not entered', rs(unrec), '', 'found by the balance check') : ''}
      ${W && W.paidBy >= 0.5 ? line('&nbsp;&nbsp;paid by someone for you', rs(W.paidBy), '', 'your spending; your accounts move when you pay them back') : ''}
      ${line('Received', rs(M.inc), 'pos')}${M.inv ? line(M.inv < 0 ? 'Taken out of investments' : 'Into investments', rs(Math.abs(M.inv))) : ''}${line(M.net < 0 ? 'Spent more than received' : 'Left over (received − spent)', rs(Math.abs(M.net)), M.net < 0 ? 'neg' : 'pos')}
      ${prevM.out ? line('Spent vs the month before', (M.out >= prevM.out ? '+' : '−') + rs(Math.abs(M.out - prevM.out))) : ''}
      ${W && W.interest >= 1 ? line('Loan interest inside your EMIs', rs(W.interest), '', 'not in “Spent”; Plan counts it') : ''}
      ${budTot ? line('Budgets', `${rs(Object.keys(bud).reduce((s, k) => s + (byC[k] || 0), 0))} of ${rs(budTot)}`) : ''}</div>
    ${over.length ? `<p class="hint" style="color:var(--seal)">Over budget: ${over.join(' · ')}</p>` : ''}
    ${walk}
    ${cats.length ? `<h4 class="plan-sub">Where it went</h4><div class="group pl-group">${cats.slice(0, 8).map(([k, v]) => line(esc(k), rs(v) + ` <small class="muted">${M.out ? Math.round(v / M.out * 100) : 0}%</small>`)).join('')}</div>` : ''}
    <h4 class="plan-sub">Udhaar open${ym < cur ? ' at the end of ' + monthShort(ym) : ''}</h4><div class="group pl-group">${line('Owed to you', rs(U.owed), 'pos')}${line('You owe', rs(U.owe), 'neg')}${pend.length ? line('Regular items never recorded', String(pend.length)) : ''}</div>
    <p class="hint">${F.length} Ledger entr${F.length === 1 ? 'y' : 'ies'} in ${esc(monthLong(ym))}. Investments and moves between your own accounts are not spending.</p>`, () => true, 'Done');
  if ($('mcGo')) $('mcGo').addEventListener('click', () => planMonthSheet(ym));
}
/* Differences between what you typed and what the app says, turned into the fewest entries. */
function closePlan(D, pair) {
  const neg = D.filter(x => x.d < 0).map(x => ({ a: x.a, left: -x.d })).sort((x, y) => y.left - x.left);
  const pos = D.filter(x => x.d > 0).map(x => ({ a: x.a, left: x.d })).sort((x, y) => y.left - x.left);
  const moves = [];
  if (pair) neg.forEach(n => pos.forEach(p => { if (!pairOk(n.a, p.a)) return; const t = r2(Math.min(n.left, p.left)); if (t >= 0.005) { moves.push({ from: n.a, to: p.a, amt: t }); n.left = r2(n.left - t); p.left = r2(p.left - t); } }));
  return { moves, spend: neg.filter(n => n.left >= 0.005).map(n => ({ a: n.a, amt: r2(n.left) })), income: pos.filter(p => p.left >= 0.005).map(p => ({ a: p.a, amt: r2(p.left) })) };
}
function monthCloseAll(c, ym) {
  if (planMonthSave(ym, true) === false) return;
  const box = $('mcBox'); if (!box) return;
  const pm = pmGet(ym) || pmNew(ym), ck = pm.checked || {}, row = planCompute(c, ym, 'actual').slice(-1)[0];
  const typed = accts().filter(a => handAcct(a) && !isBlank(ck[a.id]));
  if (!typed.length) { planMsg('Type what at least one account showed on ' + fmtDate(monthEnd(ym), true) + ' first.', true); return; }
  const D = typed.map(a => ({ a, d: r2((isLiab(a.kind) ? -(+ck[a.id]) : +ck[a.id]) - (row.accts[a.id] || 0)) })).filter(x => Math.abs(x.d) >= 0.5);
  const blank = accts().filter(a => handAcct(a) && isBlank(ck[a.id])).map(a => a.name);
  const done = () => { const p = pmGet(ym) || pmNew(ym); if (!p.closed) { p.closed = true; put(p, { render: false }); } };
  if (!D.length) { done(); toast(`${monthLong(ym)}: everything you typed matches. Nothing was left out.`); monthClose(ym); scheduleRender(); return; }
  const draw = () => {
    const pair = !$('mcPair') || $('mcPair').checked, P = closePlan(D, pair);
    const sp = P.spend.reduce((t, x) => t + x.amt, 0), inc = P.income.reduce((t, x) => t + x.amt, 0);
    const li = (t, v, cls) => `<div class="pl-row"><span class="r-name">${t}</span><b class="mono ${cls || ''}">${v}</b></div>`;
    box.innerHTML = `<div class="fix-box" id="mcPlan"><b>${esc(monthLong(ym))}: what your balances say</b>
      ${D.map(x => li(esc(x.a.name), `${x.d < 0 ? '−' : '+'}${rs(Math.abs(x.d))}`, x.d < 0 ? 'neg' : 'pos')).join('')}
      <b style="margin-top:6px">What will be recorded on ${fmtDate(monthEnd(ym), true)}</b>
      ${P.moves.map(m => li(`Moved ${esc(m.from.name)} → ${esc(m.to.name)}<small class="dq-sub">a transfer — not spending</small>`, rs(m.amt))).join('')}
      ${P.spend.map(x => li(`Spending not entered · ${esc(x.a.name)}`, '−' + rs(x.amt), 'neg')).join('')}
      ${P.income.map(x => li(`Income not entered · ${esc(x.a.name)}`, '+' + rs(x.amt), 'pos')).join('')}
      ${D.some(n => n.d < 0 && D.some(p => p.d > 0 && pairOk(n.a, p.a))) ? `<label class="switch-row"><span>Short in one account, over in another = money moved between them<small>e.g. cash withdrawn from the bank, a card bill paid. Switch off if they are unrelated.</small></span><input type="checkbox" class="sw" id="mcPair"${pair ? ' checked' : ''}></label>` : ''}
      <div class="hint">${sp >= 0.5 ? `Spending not entered: <b>${rs(sp)}</b>. ` : ''}${inc >= 0.5 ? `Income not entered: <b>${rs(inc)}</b>. ` : ''}${blank.length ? `Not checked (left blank): ${esc(blank.join(', '))}. ` : ''}You can open any of these entries in the Ledger later and give it a category.</div>
      <div class="btn-row" style="margin-top:8px"><button class="btn small" id="mcOk">Record</button><button class="btn small ghost" id="mcNo">Cancel</button></div></div>`;
    if ($('mcPair')) $('mcPair').addEventListener('change', draw);
    $('mcNo').addEventListener('click', () => { box.innerHTML = ''; });
    $('mcOk').addEventListener('click', () => {
      const date = monthEnd(ym), base = { type: 'fin', who: '', recurring: false, paidAmount: 0, settled: false, deleted: false, date }, ids = [];
      const add = r => { const id = uid('f'); ids.push(id); put({ ...base, ...r, id }, { render: false }); };
      P.moves.forEach(m => add({ desc: 'Transfer (balance check)', amount: m.amt, kind: 'transfer', category: '', acct: m.from.id, to: m.to.id }));
      P.spend.forEach(x => add({ desc: 'Unrecorded spending (balance check)', amount: x.amt, kind: 'expense', category: 'Adjustment', acct: x.a.id }));
      P.income.forEach(x => add({ desc: 'Unrecorded income (balance check)', amount: x.amt, kind: 'income', category: 'Adjustment', acct: x.a.id }));
      const was = !!(pmGet(ym) || {}).closed; done();
      RLOG.info('month close', ym, 'moves', P.moves.length, 'spend', P.spend.length, 'income', P.income.length);
      toast(`${monthLong(ym)}: ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} recorded.`, 'Undo', () => { ids.forEach(id => softDelete(id, { render: false })); const p = pmGet(ym); if (p && !was) { p.closed = false; put(p, { render: false }); } scheduleRender(); }, 9000);
      monthClose(ym); scheduleRender();
    });
    box.scrollIntoView({ block: 'nearest' });
  };
  draw();
}

