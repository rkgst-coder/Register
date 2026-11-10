/* ==========================================================================
   ACCOUNTS TAB
   ======================================================================== */
function lsFlag(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
function lsSetFlag(k) { try { localStorage.setItem(k, '1'); } catch (e) {} }
function renderAccts() {
  const body = $('acctBody'); if (!body) return;
  let c = planCfg();
  if (c && c.v !== 3) { migratePlanV3(); c = planCfg(); }
  if (c) cleanZeroTicks();
  planBadge();
  if (!c) {
    const start0 = isoMonth(new Date());
    body.innerHTML = `<div class="group plan-card"><h3 class="plan-h">Set up your accounts</h3>
      <p class="hint" style="margin:0 0 12px">Pick the month you want to start from. You'll then enter what each account held on the last day of the month before it.</p>
      <div class="field"><label>Start from</label><input type="month" id="psStart" value="${start0}"></div>
      <p class="hint" id="psAsOn" style="margin:-6px 4px 12px">Opening balances will be as on ${fmtDate(monthEnd(monthAdd(start0, -1)), true)}.</p>
      <button class="btn brass block" id="psGo">Continue</button></div>`;
    $('psStart').addEventListener('change', () => { const v = $('psStart').value; if (/^\d{4}-\d{2}$/.test(v)) $('psAsOn').textContent = 'Opening balances will be as on ' + fmtDate(monthEnd(monthAdd(v, -1)), true) + '.'; });
    $('psGo').addEventListener('click', () => {
      const start = $('psStart').value; if (!/^\d{4}-\d{2}$/.test(start)) { toast('Pick a month.'); return; }
      put({ id: PLAN_CFG_ID, type: 'plancfg', v: 3, startMonth: start, yearMode: 'fy', showUntil: null, defAcct: null, deleted: false }, { render: false });
      [['My salary account', 'salary'], ["Wife's salary account", 'salary'], ['Bank account', 'bank'], ['Cash in hand', 'cash']].forEach(([n, k], i) =>
        put({ id: uid('ac'), type: 'acct', name: n, kind: k, open: 0, order: i, deleted: false }, { render: false }));
      const c2 = planCfg(); c2.defAcct = accts().find(a => a.kind === 'bank').id; put(c2, { render: false });
      openingSheet();
    });
    return;
  }
  const cur = isoMonth(new Date()), asOn = fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true);
  const now = cur >= c.startMonth, B = balancesOn(c, todayISO());       // same figures as the Ledger dashboard
  const endYm = planHorizon(c), proj = planCompute(c, endYm), endRow = proj[proj.length - 1];
  const nowBal = id => B.accts[id] || 0;
  const firstNeg = id => { const r = proj.find(x => x.neg.includes(id)); return r ? r.ym : null; };
  const U = { owed: B.owed, owe: B.owe }, cardNow = B.card, loanNow = B.loan, liqNow = B.bank + B.cash, investNow = B.invest;
  const worthNow = B.money, handNow = B.hand;
  const heroWhen = now ? 'as on ' + fmtDate(todayISO(), true) : 'opening, as on ' + asOn;
  const guide = !lsFlag('r2_acctGuideHidden') ? `<div class="group plan-card acct-guide"><div class="plan-hero-top" style="justify-content:space-between"><b>How this works</b><button class="linkbtn" id="acGuideHide">Hide</button></div>
      <ol><li><b>Opening balances</b> — once. What each account held on ${asOn}.</li>
      <li><b>Recurring</b> — once. Salary, household spending, transfers, card bill. SIPs and EMIs go inside their fund / loan account.</li>
      <li><b>Monthly check-up</b> — after each month ends: tick what came in and went out, and (optional) compare balances with your bank.</li></ol>
      <p class="hint" style="margin:0">Everyday spending goes in Ledger with + as before.</p></div>` : '';
  const pend = planPendingMonths();
  const sortMode = prefs.acctSort || 'order', sortLbl = { order: 'My order', amount: 'Amount ↓', az: 'A → Z' };
  const sorted = l => sortMode === 'amount' ? l.slice().sort((x, y) => Math.abs(nowBal(y.id)) - Math.abs(nowBal(x.id))) : sortMode === 'az' ? l.slice().sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })) : l;
  const groups = [['Bank, cash and wallets', a => isLiquid(a.kind)], ['Investments', a => isInvest(a.kind)], ['Credit cards and loans', a => isLiab(a.kind)]];
  const row = a => {
    const b = nowBal(a.id), neg = isLiquid(a.kind) ? firstNeg(a.id) : null;
    let sub = `<span>${kindLabel(a.kind)}</span>`;
    if (a.kind === 'loan' && +a.emi) { const k = loanInfo(a); sub += `<span>${rs(a.emi)}/month</span>${k.n ? `<span>${k.paid}/${k.n} EMIs paid</span>` : ''}<span>from ${esc(acctName(a.payFrom))}</span>`; }
    if (isInvest(a.kind) && a.sip && +a.sip.amt) sub += `<span>SIP ${rs(a.sip.amt)} from ${esc(acctName(a.sip.from))}</span>`;
    if (isInvest(a.kind) && +a.ret) sub += `<span>${a.ret}% expected</span>`;
    if (neg) sub += `<span class="st st-late" data-stmneg="${a.id}|${neg}" role="button" title="Show the statement for that month">below ₹0 in ${monthShort(neg)} ›</span>`;
    return `<button class="row plan-li" data-acct="${a.id}"><div class="row-main"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${sub}</div></div>
      <div class="row-end" style="text-align:right"><span class="amt ${b < 0 ? 'neg' : ''}">${rs(b)}</span><div class="hint" style="margin:2px 0 0">${monthShort(endYm)}: ${rsShort(endRow.accts[a.id] || 0)}</div></div></button>`;
  };
  const archived = accts(true).filter(a => a.archived);
  body.innerHTML = `
    ${guide}
    ${pend.length ? `<button class="plan-banner" id="acPend"><b>${pend.length} month${pend.length > 1 ? 's need' : ' needs'} a check-up.</b> Start with ${monthLong(pend[0])}.</button>` : ''}
    <div class="group plan-card plan-hero"><div class="eyebrow">Money you have · ${heroWhen}</div>
      <div class="plan-big ${worthNow < 0 ? 'neg' : ''}">${rsShort(worthNow)}</div>
      <div class="plan-split"><span>Bank & cash <b>${rsShort(liqNow)}</b></span><span>Investments <b>${rsShort(investNow)}</b></span>${U.owed ? `<span>Others owe you <b>+${rsShort(U.owed)}</b></span>` : ''}${U.owe ? `<span>You owe others <b>−${rsShort(U.owe)}</b></span>` : ''}${cardNow ? `<span>Card dues <b>−${rsShort(cardNow)}</b></span>` : ''}</div>
      <div class="dash-sep"></div>
      <div class="eyebrow">Money in hand</div>
      <div class="plan-big ${handNow < 0 ? 'neg' : ''}" style="font-size:1.5rem">${rsShort(handNow)}</div>
      <div class="plan-split"><span>Bank & cash <b>${rsShort(liqNow)}</b></span>${cardNow ? `<span>Card dues <b>−${rsShort(cardNow)}</b></span>` : ''}${loanNow ? `<span>Loan balance (separate) <b>${rsShort(loanNow)}</b></span>` : ''}</div>
</div>
    <div class="btn-row" style="flex-wrap:wrap;margin:0 0 12px"><button class="btn ghost small" id="acOpen">Opening balances</button><button class="btn ghost small" id="acClose">Monthly check-up</button><button class="btn ghost small" id="acXlsx">Export Excel</button></div>
    <div class="acct-sortbar"><span class="hint" style="margin:0">Sort</span><button class="chip" id="acSort" aria-label="Change sort order">${sortLbl[sortMode]}</button></div>
    ${groups.map(([t, f]) => { const l = sorted(accts().filter(f)); return l.length ? `<div class="plan-sec" style="margin-top:10px"><h3 class="plan-h">${t}</h3><div class="group">${l.map(row).join('')}</div></div>` : ''; }).join('')}
    <button class="btn ghost small" id="acAdd">＋ Add account</button>
    ${archived.length ? `<details class="fold"><summary>Archived accounts (${archived.length})</summary><div class="group">${archived.map(row).join('')}</div></details>` : ''}
    <div class="plan-sec"><h3 class="plan-h">Recurring</h3>
      ${recurs().length ? recurGroupedHtml(r => `<button class="row plan-li" data-recur="${r.id}"><div class="row-main"><div class="row-title">${esc(r.name)}${r.budget || r.kind === 'udhgive' ? ' <span class="pill">estimate</span>' : ''}</div>
        <div class="row-sub">${dupEmiOf(r) ? `<span class="st st-late">same as ${esc(dupEmiOf(r).name)} EMI — counted twice</span>` : ''}<span>${r.kind === 'udhgive' ? 'udhaar to ' + esc(r.who || '?') + ' from ' + esc(acctName(r.from)) + ' · estimate' : r.kind === 'udhback' ? 'udhaar back from ' + esc(r.who || '?') + ' into ' + esc(acctName(r.to)) + ' · ' + esc(rs(udhOwedBy(r.who))) + ' still owed' : r.kind === 'income' ? 'into ' + esc(acctName(r.to)) : r.kind === 'expense' ? 'from ' + esc(acctName(r.from)) : esc(acctName(r.from)) + ' → ' + esc(acctName(r.to))}</span>
        <span>${r.end && r.end === r.start ? 'once' : ['', 'monthly', '', 'every 3 months', '', '', 'every 6 months', '', '', '', '', '', 'yearly'][+r.every || 1] || 'every ' + r.every + ' months'}</span><span>${r.end && r.end === r.start ? monthShort(r.start) : monthShort(r.start) + (r.end ? ' – ' + monthShort(r.end) : ' onwards')}</span>${(r.steps || []).length ? `<span>then ${esc(recurStepsText(r))}</span>` : ''}</div></div>
        <span class="amt ${r.kind === 'income' || r.kind === 'udhback' ? 'pos' : r.kind === 'expense' || r.kind === 'udhgive' ? 'neg' : ''}">${rs(recurAmt(r, cur < r.start ? r.start : cur))}</span></button>`, cur) : '<p class="hint" style="margin:0 4px 8px">Nothing yet. Add salary, rent, household spending, monthly transfers or the credit-card bill.</p>'}
      <button class="btn ghost small" id="acRecAdd">＋ Add recurring item</button>
      <p class="hint">SIPs and EMIs are set inside their mutual fund and loan accounts. "Estimate" items (like household spending) are replaced by what you actually spend in the Ledger.</p></div>`;
  if ($('acPend')) $('acPend').addEventListener('click', () => planMonthSheet(pend[0]));
  $('acSort').addEventListener('click', () => { const o = ['order', 'amount', 'az']; setPref('acctSort', o[(o.indexOf(sortMode) + 1) % 3]); renderAccts(); });
  if ($('acGuideHide')) $('acGuideHide').addEventListener('click', () => { lsSetFlag('r2_acctGuideHidden'); renderAccts(); });
  $('acOpen').addEventListener('click', openingSheet);
  $('acClose').addEventListener('click', () => planMonthSheet(pend[0] || (monthAdd(cur, -1) < c.startMonth ? c.startMonth : monthAdd(cur, -1))));
  $('acXlsx').addEventListener('click', exportXlsx);
  $('acAdd').addEventListener('click', () => acctSheet(null));
  $('acRecAdd').addEventListener('click', () => recurSheet(null));
  $$('[data-stmneg]', body).forEach(t => t.addEventListener('click', ev => { ev.stopPropagation(); const [id, ym] = t.dataset.stmneg.split('|'); openStatement(id, { focus: ym, to: ym > (Stmt.to || '') ? planHorizon(c) : null }); }));   // v2.25: why it goes below ₹0
  $$('[data-acct]', body).forEach(b => b.addEventListener('click', () => acctSheet(b.dataset.acct)));
  $$('[data-recur]', body).forEach(b => b.addEventListener('click', () => recurSheet(b.dataset.recur)));
  $$('[data-rcgren]', body).forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); renameRecurGroup(b.dataset.rcgren); }));
}

/* ---------- one reusable sheet ---------- */
function planSheet(title, html, onSave, saveLabel) {
  $('pshTitle').textContent = title;
  $('pshSave').textContent = saveLabel || 'Save';
  $('pshBody').innerHTML = html + '<div class="msg" id="pshMsg"></div>';
  Plan.save = onSave;
  if (!Sheets.isOpen('shPlan')) Sheets.open('shPlan');
  $('pshBody').scrollTop = 0;
}
const planMsg = (t, err) => { const m = $('pshMsg'); if (m) { m.className = 'msg ' + (err ? 'err' : 'ok'); m.textContent = t; } };
$('pshSave').addEventListener('click', () => { if (Plan.save && Plan.save() !== false) { Plan.save = null; Sheets.close('shPlan', true); scheduleRender(); } });
Sheets.onClose.shPlan = () => { Plan.save = null; };
