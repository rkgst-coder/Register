/* ==========================================================================
   v2.35 — UDHAAR AS A PROPER LEDGER, INVESTMENTS THAT REACH THEIR FUND
   • every payment carries the date the money moved (Settle asks for it; older
     payments can have their date set from the entry's ledger)
   • the Ledger shows each payment as its own row on that date
   • ＋ Payment on a person: one amount against the oldest open entries first
   • "Investment" spending can name the fund it went into (invTo; '-' = none)
   ======================================================================== */
const payDateOk = (v, min) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && v <= todayISO() && (!min || v >= min);
function payRow(x) {
  const e = x.of, p = x.p, inn = e.kind === 'lent', who = String(e.who || '').trim() || 'someone', left = outstanding(e);
  return `<div class="row fin-row" data-finpay="${e.id}" role="button" tabindex="0">
    <div class="row-main"><div class="row-title">↩ ${inn ? esc(who) + ' paid back' : 'Paid back to ' + esc(who)}${e.desc ? ` <span class="muted">· ${esc(e.desc)}</span>` : ''}</div>
      <div class="row-sub"><span class="pill">udhaar back</span>${p.acct && acctById(p.acct) ? `<span>${inn ? 'into' : 'from'} ${esc(acctName(p.acct))}</span>` : ''}<span>${e.settled || left < 0.005 ? 'settled' : fmtMoney(left) + ' still open'}</span></div></div>
    <div class="row-end"><span class="amt ${inn ? 'pos' : 'neg'}">${inn ? '+' : '−'}${fmtMoney(p.amt)}</span></div></div>`;
}
/* Set or correct the date of one payment on an entry (pi = its place in e.pays; -1 = the part with no date yet). */
function udhPayDateEdit(id, pi) {
  const e = records[id], box = $('ulPayEd'); if (!e || !box) return;
  const pays = e.pays || [], p = pi >= 0 ? pays[pi] : null;
  const undated = +((e.paidAmount || 0) - pays.reduce((t, q) => t + (+q.amt || 0), 0)).toFixed(2);
  if (pi >= 0 ? !p : undated <= 0.005) return;
  const has = typeof hasAccts === 'function' && hasAccts(), cur = p ? p.acct || '' : (isPaidBy(e) ? '' : e.acct || '');
  box.innerHTML = `<div class="fix-box"><b>${p ? 'Payment of ' + esc(fmtMoney(p.amt)) : esc(fmtMoney(undated)) + ' with no date'}</b>
    <div class="field"><label>Date the money moved</label><input type="date" id="upDate" value="${p && p.date ? p.date : ''}" max="${todayISO()}" min="${e.date || ''}"></div>
    ${has ? `<div class="field"><label>${e.kind === 'lent' ? 'Received into' : 'Paid from'}</label><select id="upAcct"><option value="">Account not known</option>${acctOptions(cur, a => !isInvest(a.kind) && a.kind !== 'loan')}</select></div>
    <div class="hint">Changing the date or account moves this money in your account balances. If that month's balances were already matched with your bank, check that month again.</div>` : ''}
    <div class="btn-row"><button class="btn small" id="upOk">Save</button><button class="btn small ghost" id="upNo">Cancel</button></div></div>`;
  if (has && !cur) $('upAcct').value = '';
  $('upNo').addEventListener('click', () => { box.innerHTML = ''; });
  $('upOk').addEventListener('click', () => {
    const d = $('upDate').value, a = has ? $('upAcct').value : (p ? p.acct || '' : '');
    if (!payDateOk(d, e.date)) { toast(!d ? 'Pick the date.' : d > todayISO() ? 'The date cannot be in the future.' : 'The date cannot be before the udhaar itself.'); return; }
    const list = pays.map(q => ({ ...q }));
    if (p) { list[pi].date = d; if (a) list[pi].acct = a; else delete list[pi].acct; }
    else list.push(a ? { date: d, amt: undated, acct: a } : { date: d, amt: undated });
    e.pays = list; put(e); toast('Date saved.');
    if (Sheets.isOpen('shUdhLed') && UdhLed.id === id) renderUdhLedger(id);   // opened from the Ledger, the Udhaar pane is not there to redraw it
  });
  box.scrollIntoView({ block: 'nearest' });
}
/* One payment with a person: goes against the oldest open entries first (entries dated after the payment are left alone). */
function udhPersonPay(g, kind, amt, date, acct) {
  const list = g.open.filter(e => udhKindIs(e, kind) && outstanding(e) > 0 && (e.date || '') <= date).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
  const owed = list.reduce((t, e) => t + outstanding(e), 0);
  if (amt > owed + 0.005) throw new Error(`Only ${rs(owed)} is open ${kind === 'lent' ? 'from' : 'with'} ${g.name} up to ${fmtDate(date, true)}. For anything extra, use Settle on an entry.`);
  const snap = list.map(e => ({ id: e.id, paid: e.paidAmount || 0, pays: (e.pays || []).slice(), settled: !!e.settled }));
  let left = amt;
  list.forEach(e => {
    if (left <= 0.005) return;
    const take = +Math.min(left, outstanding(e)).toFixed(2);
    e.pays = (e.pays || []).concat([acct ? { date, amt: take, acct } : { date, amt: take }]);
    e.paidAmount = +(((e.paidAmount || 0) + take).toFixed(2));
    if (e.paidAmount >= (+e.amount || 0) - 0.005) { e.paidAmount = e.amount; e.settled = true; }
    left = +(left - take).toFixed(2); put(e, { render: false });
  });
  return snap;
}
function udhPersonPaySheet(g) {
  const tot = k => g.open.filter(e => udhKindIs(e, k)).reduce((t, e) => t + outstanding(e), 0), L = tot('lent'), B = tot('borrowed');
  if (L < 0.005 && B < 0.005) { toast('Nothing is open with ' + g.name + '.'); return; }
  const has = typeof hasAccts === 'function' && hasAccts() && planCfg(), both = L >= 0.005 && B >= 0.005, k0 = L >= B ? 'lent' : 'borrowed';
  planSheet('Payment · ' + g.name, `<div class="group pl-group">
      ${both ? `<div class="pl-row"><span class="r-name">Who paid</span><select id="ppKind"><option value="lent"${k0 === 'lent' ? ' selected' : ''}>${esc(g.name)} paid me (owes ${rs(L)})</option><option value="borrowed"${k0 === 'borrowed' ? ' selected' : ''}>I paid ${esc(g.name)} (I owe ${rs(B)})</option></select></div>`
        : `<div class="pl-row"><span class="r-name">${k0 === 'lent' ? `${esc(g.name)} pays you` : `You pay ${esc(g.name)}`}<small class="dq-sub">${rs(k0 === 'lent' ? L : B)} open</small></span></div>`}
      <div class="pl-row src"><span class="r-name">Amount</span>${amtIn('ppAmt', '')}</div>
      <div class="pl-row"><span class="r-name">Date the money moved</span><input type="date" id="ppDate" value="${todayISO()}" max="${todayISO()}"></div>
      ${has ? `<div class="pl-row"><span class="r-name" id="ppAcctLbl">${k0 === 'lent' ? 'Received into' : 'Paid from'}</span><select id="ppAcct">${acctOptions(lastAcct('udhaar') || defAcct(planCfg()), a => !isInvest(a.kind) && a.kind !== 'loan')}</select></div>` : ''}</div>
    <p class="hint">A part-payment is fine. It goes against the oldest open entries first, and shows in the Ledger and in ${esc(g.name)}'s ledger on this date.</p>`,
    () => {
      try {
        const kind = both ? $('ppKind').value : k0, amt = readAmt('ppAmt', 'Amount', true), date = $('ppDate').value || todayISO(), acct = has ? $('ppAcct').value : null;
        if (!(amt > 0)) throw new Error('Enter the amount.');
        if (!payDateOk(date)) throw new Error('The date cannot be in the future.');
        const snap = udhPersonPay(g, kind, Math.round(amt * 100) / 100, date, acct);
        if (acct) rememberAcct('udhaar', acct);
        toast(`${rs(amt)} recorded with ${g.name}.`, 'Undo', () => snap.forEach(x => { const e = records[x.id]; if (!e) return; e.paidAmount = x.paid; e.pays = x.pays; e.settled = x.settled; put(e); }), 8000);
        return true;
      } catch (err) { planMsg(err.message, true); return false; }
    }, 'Record');
  if (both && has) $('ppKind').addEventListener('change', () => { $('ppAcctLbl').textContent = $('ppKind').value === 'lent' ? 'Received into' : 'Paid from'; });
}
/* "Investment" spending → which fund */
const invFunds = () => accts().filter(a => isInvest(a.kind));
function invPickDraw(sel) {
  let w = $('feInvWrap');
  if (!w) {
    const c = $('feCat') && $('feCat').closest('.field'); if (!c) return;
    w = document.createElement('div'); w.className = 'field'; w.id = 'feInvWrap'; w.innerHTML = '<label>Goes into (fund)</label><select id="feInvTo"></select>';
    (c.parentNode.classList.contains('grid2') ? c.parentNode : c).insertAdjacentElement('afterend', w);
    $('feCat').addEventListener('change', () => invPickDraw());
  }
  const on = chipValue($('feKind')) === 'expense' && $('feCat').value === 'Investment' && invFunds().length > 0;
  w.classList.toggle('hidden', !on);
  if (sel !== undefined || !$('feInvTo').options.length) $('feInvTo').innerHTML = `<option value="-">— not in any fund —</option>` + invFunds().map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  if (!on) $('feInvTo').value = '';
  else if (!$('feInvTo').value) $('feInvTo').value = '-';
}
const invUnlinked = () => { const c = planCfg(); return !c || !invFunds().length ? [] : all('fin').filter(e => e.kind === 'expense' && !e.paidBy && e.category === 'Investment' && !e.invTo && (e.date || '').slice(0, 7) >= c.startMonth).sort((a, b) => (b.date || '').localeCompare(a.date || '')); };
function invLinkSheet() {
  const L = invUnlinked().slice(0, 80), F = invFunds();
  const guess = e => { const m = F.filter(a => a.sip && Math.abs((+a.sip.amt || 0) - (+e.amount || 0)) < 1); return m.length === 1 ? m[0].id : F.length === 1 ? F[0].id : ''; };
  planSheet('Investment entries → fund', `<p class="hint" style="margin:0 4px 8px">These were entered as spending in the “Investment” category, so the money left your bank but did not reach any fund in Accounts. Pick the fund for each. Past fund balances will go up from that date (a statement value you typed for a month still wins).</p>
    <div class="group pl-group">${L.map(e => { const g = guess(e); return `<div class="pl-row" data-inv="${e.id}"><span class="r-name">${esc(e.desc || 'Investment')}<small class="dq-sub">${fmtDate(e.date, true)} · ${rs(e.amount)}${e.acct && acctById(e.acct) ? ' · from ' + esc(acctName(e.acct)) : ''}</small></span>
      <select><option value="">Decide later</option>${F.map(a => `<option value="${a.id}"${a.id === g ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="-">Not in any fund</option></select></div>`; }).join('')}</div>`,
    () => { let n = 0; $$('[data-inv]', $('pshBody')).forEach(r => { const v = r.querySelector('select').value, e = records[r.dataset.inv]; if (v && e) { e.invTo = v; put(e, { render: false }); n++; } }); if (n) toast(`${n} entr${n === 1 ? 'y' : 'ies'} updated.`); return true; }, 'Save');
}

/* ==========================================================================
   v2.37 — savings interest (estimate) and a few helpers
   ======================================================================== */
const acctInt = a => a && (a.kind === 'bank' || a.kind === 'salary') && a.int && (+a.int.rate > 0 || +a.int.amt > 0)
  ? { rate: +a.int.rate || 0, amt: +a.int.amt || 0, every: +a.int.every === 3 ? 3 : 1, from: a.int.from || null } : null;
/* the interest the plan expects in month ym, per account (what the engine works out from the balance at the start of the month) */
function intEstimates(c, ym) {
  try { const r = planCompute(c, ym, 'plan').slice(-1)[0]; return (r && r.ym === ym && r.intEst) || {}; } catch (e) { RLOG.warn('interest estimate', e.message); return {}; }
}
