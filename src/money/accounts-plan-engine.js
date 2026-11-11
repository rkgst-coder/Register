/* ==========================================================================
   ACCOUNTS + PLAN (v2.4). All records here are sealed (encrypted).
     acct       anything that holds money: bank, salary a/c, cash, wallet,
                mutual fund, FD/PPF/NPS, credit card, loan, other
     recur      recurring item: income into an account, expense out of one,
                or a transfer between two. "budget" expenses are day-to-day
                spending estimates that the Ledger replaces as you spend.
     planmonth  per month: amount changes, ticks (done), one-off items,
                balance checks, closed flag
     plancfg    start month, default account, year display, show-until
     goal       amount by a month, measured against net worth
   Truth: the Ledger (Money → Ledger) is what actually happened. Ticking a
   planned item as done writes it into the Ledger. Opening balances are as
   on the last day of the month before the plan starts.
   ======================================================================== */
const PLAN_CFG_ID = 'plan-cfg';
const PLAN_MAX_MONTHS = 240;
const Plan = { year: null, save: null };
const ACCT_KINDS = [['bank', 'Bank account'], ['salary', 'Salary account'], ['cash', 'Cash in hand'], ['wallet', 'Wallet / UPI'], ['mf', 'Mutual fund'],
  ['fd', 'FD / PPF / NPS'], ['card', 'Credit card'], ['loan', 'Loan'], ['other', 'Other']];
const kindLabel = k => (ACCT_KINDS.find(x => x[0] === k) || ['', 'Other'])[1];
const isLiab = k => k === 'card' || k === 'loan';
const isInvest = k => k === 'mf' || k === 'fd';
const isLiquid = k => ['bank', 'salary', 'cash', 'wallet', 'other'].includes(k);
const pmId = ym => 'pm-' + ym;
const pmGet = ym => { const r = records[pmId(ym)]; return r && !r.deleted ? r : null; };
const pmNew = ym => ({ id: pmId(ym), type: 'planmonth', v: 3, month: ym, items: {}, extra: [], checked: {}, closed: false, deleted: false });
const num = v => { const n = typeof v === 'number' ? v : calcAmount(String(v == null ? '' : v).replace(/[₹,\s]/g, '').replace(/^−/, '-')); return isFinite(n) ? n : NaN; };
const isBlank = v => v == null || String(v).trim() === '';
const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const monthEnd = ym => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0); return ym + '-' + String(d.getDate()).padStart(2, '0'); };
const yearKey = (ym, mode) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return mode === 'fy' ? (m >= 4 ? y : y - 1) : y; };
const yearLabel = (k, mode) => mode === 'fy' ? `FY ${k}-${String((k + 1) % 100).padStart(2, '0')}` : String(k);
function rs(n) { n = Math.round(Number(n) || 0) || 0; return (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN'); }
function rsShort(n) {
  n = Number(n) || 0; if (Math.abs(n) < 0.5) n = 0; const s = n < 0 ? '−' : '', a = Math.abs(n);
  if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L';
  return s + '₹' + Math.round(a).toLocaleString('en-IN');
}
const planCfg = () => { const c = records[PLAN_CFG_ID]; return c && !c.deleted ? c : null; };
const accts = (withArchived) => all('acct').filter(a => withArchived || !a.archived)
  .sort((a, b) => ACCT_KINDS.findIndex(k => k[0] === a.kind) - ACCT_KINDS.findIndex(k => k[0] === b.kind) || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
const acctById = id => { const a = records[id]; return a && a.type === 'acct' && !a.deleted ? a : null; };
const acctName = id => { const a = acctById(id); return a ? a.name : '—'; };
const defAcct = c => { const a = acctById(c && c.defAcct); if (a && !a.archived) return a.id; const l = accts().find(x => isLiquid(x.kind)) || accts()[0]; return l ? l.id : null; };
function acctOptions(sel, filter) {
  return accts(true).filter(a => a.id === sel || (!a.archived && (!filter || filter(a)))).map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}${a.archived ? ' (archived)' : ''}</option>`).join('');   // the entry's own account is always listed
}
const RK_ORDER = ['income', 'udhback', 'udhgive', 'transfer', 'expense'];
/* v2.22: recurring items under your own categories (e.g. "Salary" → Rahul's salary, Ruchi's salary) */
const recurGroups = () => [...new Set(all('recur').map(r => String(r.group || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
function recurGroupedHtml(rowFn, cur) {
  const L = recurs(), gs = recurGroups(), monthly = r => { const a = recurAmt(r, cur < r.start ? r.start : cur) / (+r.every || 1); return r.kind === 'income' || r.kind === 'udhback' ? a : r.kind === 'expense' || r.kind === 'udhgive' ? -a : 0; };
  if (!gs.length) return `<div class="group">${L.map(rowFn).join('')}</div>`;
  const sec = (name, items) => { const net = items.reduce((t, r) => t + monthly(r), 0);
    return `<details class="rc-grp"><summary><b>${esc(name || 'Not in a category')}</b><span class="muted">${items.length} item${items.length > 1 ? 's' : ''}</span>${net ? `<span class="amt ${net > 0 ? 'pos' : 'neg'}">${net > 0 ? '+' : '−'}${rsShort(Math.abs(net))}/mo</span>` : ''}${name ? `<button type="button" class="linkbtn" data-rcgren="${esc(name)}">✎</button>` : ''}</summary><div class="group">${items.map(rowFn).join('')}</div></details>`; };
  return gs.map(g => sec(g, L.filter(r => r.group === g))).join('') + (L.some(r => !r.group) ? sec('', L.filter(r => !r.group)) : '');
}
function renameRecurGroup(old) {
  catNameSheet('Rename category', old, '', (n) => { all('recur').filter(r => r.group === old).forEach(r => { r.group = n; put(r, { render: false }); }); toast('Renamed.'); });
  const ic = $('cnIcon'); if (ic) ic.closest('.field').classList.add('hidden');
}
const recurs = () => all('recur').sort((a, b) => RK_ORDER.indexOf(a.kind) - RK_ORDER.indexOf(b.kind) || (a.createdAt || 0) - (b.createdAt || 0));
function recurDue(r, ym) {
  if (!r.start || ym < r.start || (r.end && ym > r.end)) return false;
  return monthsBetween(r.start, ym) % (+r.every || 1) === 0;
}

/* ---------- loans ---------- */
function loanInfo(l, atYm) {
  const cur = atYm || isoMonth(new Date());
  const n = l.start && l.end ? monthsBetween(l.start, l.end) + 1 : 0;
  const paidAt = ym => !l.start || ym < l.start ? 0 : Math.min(n || Infinity, monthsBetween(l.start, ym) + 1);   // counts this month's EMI, like loanOwed
  const paid = paidAt(cur);
  const emi = +l.emi || 0, P = +l.amount || 0;
  const out = { n, paid, left: n ? Math.max(0, n - paid) : null, emi, total: n * emi, paidAmt: paid * emi, leftAmt: n ? Math.max(0, n - paid) * emi : null, rate: null, interest: null, outstanding: null, r: null };
  let r = null;
  if (+l.rate > 0) r = +l.rate / 1200;
  else if (P > 0 && n > 0 && emi * n > P) {
    let lo = 1e-9, hi = 0.1;
    for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2, pv = emi * (1 - Math.pow(1 + m, -n)) / m; if (pv > P) lo = m; else hi = m; }
    r = (lo + hi) / 2;
  }
  if (r && P > 0) {
    out.r = r; out.rate = r * 1200; out.interest = Math.max(0, emi * n - P);
    const bal = k => Math.max(0, P * Math.pow(1 + r, k) - emi * (Math.pow(1 + r, k) - 1) / r);
    out.outstanding = bal(paid); out.balAfter = k => bal(Math.min(Math.max(0, k), n));
  }
  out.paidBy = paidAt;
  return out;
}
const loanSched = l => !!(+l.emi && l.start && l.end);
/* What you owe on a loan at the end of month ym (after that month's EMI). */
function loanOwed(l, ym) {
  const k = loanInfo(l, ym);
  const done = !l.start || ym < l.start ? 0 : Math.min(k.n, monthsBetween(l.start, ym) + 1);
  if (k.balAfter) return k.balAfter(done);
  if (k.n) return Math.max(0, k.n - done) * k.emi;
  return +l.open || 0;
}

/* ---------- ledger → movements ---------- */
const finDate = e => (e.date || '').slice(0, 10);
/* All actual money movements from the Ledger, as { ym, date, acct, amt, cat } with the sign seen by that account. */
function ledgerFlows(c) {
  const out = [], start = c.startMonth, dflt = (acctById(c.defAcct) || {}).id || defAcct(c);   // untagged entries stay on the default even if it is archived
  const push = (date, acct, amt, cat, e) => { if (!acct || !acctById(acct) || !date || date.slice(0, 7) < start) return; out.push({ ym: date.slice(0, 7), date, acct, amt, cat, e }); };
  all('fin').forEach(e => {
    const a = +e.amount || 0, d = finDate(e), acct = e.acct || (e.kind !== 'transfer' && e.date && e.date.slice(0, 7) >= start ? dflt : null);
    if (e.kind === 'income') push(d, acct, a, 'inc', e);
    else if (isPaidBy(e)) {                                                    // v2.20: no account at purchase; pay-backs leave the account they came from
      (e.pays || []).forEach(p => push(p.date, p.acct || null, -(+p.amt || 0), 'udh', e));
    }
    else if (e.kind === 'expense') { push(d, acct, -a, 'exp', e);
      if (e.category === 'Investment' && e.invTo && acct && acctById(acct)) { const t = acctById(e.invTo); if (t && isInvest(t.kind)) push(d, t.id, a, 'inv', e); } }   // v2.35: the fund it went into
    else if (e.kind === 'transfer') { push(d, e.acct, -a, 'out', e); push(d, e.to, a, 'in', e); }
    else if (e.kind === 'lent' || e.kind === 'borrowed') {
      const s = e.kind === 'lent' ? -1 : 1;
      push(d, acct, s * a, 'udh', e);
      (e.pays || []).forEach(p => push(p.date, p.acct || acct, -s * (+p.amt || 0), 'udh', e));
      const pp = (e.pays || []).reduce((t, p) => t + (+p.amt || 0), 0), rest = Math.max(0, (+e.paidAmount || 0) - pp);
      if (rest > 0.005) push(d, acct, -s * rest, 'udh', e);                   // paid back before instalments were recorded
    }
  });
  return out;
}
function udhaarSplit() {
  let owed = 0, owe = 0;
  all('fin').filter(e => isUdh(e) && !e.settled).forEach(e => { if (e.kind === 'lent') owed += outstanding(e); else owe += outstanding(e); });
  return { owed, owe };
}
const bucketOf = k => k === 'cash' ? 'cash' : isInvest(k) ? 'invest' : k === 'card' ? 'card' : k === 'loan' ? 'loan' : 'bank';
/* Balances at the end of a given day. Up to today: opening + Ledger only. A future date: the plan for that month. */
function balancesOn(c, dateISO) {
  const cur = isoMonth(new Date()), ym = dateISO.slice(0, 7), list = accts(true);
  let bal = {}, mode = 'actual', label, udhBack = 0;
  if (ym < c.startMonth) {
    list.forEach(a => { bal[a.id] = a.kind === 'loan' ? -(loanSched(a) ? loanOwed(a, monthAdd(c.startMonth, -1)) : +a.open || 0) : isLiab(a.kind) ? -(+a.open || 0) : +a.open || 0; });
    mode = 'opening'; label = 'opening balances, as on ' + fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true);
  } else if (ym > cur) {
    const pr = planCompute(c, ym).slice(-1)[0]; bal = { ...pr.accts }; udhBack = pr.udhBack || 0; mode = 'plan'; label = 'plan for end of ' + monthLong(ym);
  } else if (ym < cur && dateISO >= monthEnd(ym)) {
    bal = { ...planCompute(c, ym, 'actual').slice(-1)[0].accts };      // a whole month that is over: same figures as the check-up
    label = 'actual, as on ' + fmtDate(monthEnd(ym), true);
  } else {
    const endRow = planCompute(c, ym, 'actual').slice(-1)[0];
    if (ym === c.startMonth) list.forEach(a => { bal[a.id] = isLiab(a.kind) ? -(+a.open || 0) : +a.open || 0; });
    else bal = { ...planCompute(c, monthAdd(ym, -1), 'actual').slice(-1)[0].accts };
    ledgerFlows(c).forEach(f => { const a = acctById(f.acct); if (a && !(a.kind === 'loan' && loanSched(a)) && f.ym === ym && f.date <= dateISO) bal[f.acct] = (bal[f.acct] || 0) + f.amt; });
    list.forEach(a => { if (a.kind === 'loan' && loanSched(a)) bal[a.id] = endRow.accts[a.id]; });   // loans follow their schedule
    label = 'actual, as on ' + fmtDate(dateISO, true);
  }
  const out = { bank: 0, cash: 0, invest: 0, card: 0, loan: 0, mode, label, accts: bal };
  list.forEach(a => { const v = bal[a.id] || 0, b = bucketOf(a.kind);
    if (b === 'card') { if (v > 0) out.bank += v; else out.card += -v; } else if (b === 'loan') out.loan += Math.max(0, -v); else out[b] += v; });
  const U = mode === 'plan' ? udhaarSplit() : udhaarAsOf(dateISO); out.owed = Math.max(0, U.owed - udhBack); out.owe = U.owe;   // a past day uses that day's udhaar
  out.money = out.bank + out.cash + out.invest + out.owed - out.owe - out.card;
  out.hand = out.bank + out.cash - out.card;
  return out;
}
/* Income per source over some months: expected, received, overdue (ended months not received), still to come. */
function incomeSummary(c, months) {
  const cur = isoMonth(new Date()), g = new Map(), matched = new Set(), linked = new Set();
  const get = n => { if (!g.has(n)) g.set(n, { name: n, expected: 0, received: 0, overdue: 0, upcoming: 0 }); return g.get(n); };
  months.forEach(ym => {
    if (ym < c.startMonth) return;
    planItems(c, ym).filter(it => it.kind === 'income' || it.kind === 'udhback').forEach(it => {
      const x = get(it.extra ? 'One-off income' : it.kind === 'udhback' ? it.label + ' (udhaar back)' : it.label); if (it.kind === 'udhback') x.udh = true;
      x.expected += it.a;
      if (it.done) { x.received += it.a; if (it.matched) matched.add(it.matched); if (it.ledgerId) linked.add(it.ledgerId); }
      else if (ym < cur) x.overdue += it.a; else x.upcoming += it.a;
    });
  });
  const set = new Set(months);
  all('fin').filter(e => e.kind === 'income' && set.has((e.date || '').slice(0, 7)) && (e.date || '').slice(0, 7) >= c.startMonth && !e.planRef && !matched.has(e.id))
    .forEach(e => { get(e.category === 'Adjustment' ? 'Balance-check adjustments' : 'Other income (Ledger)').received += +e.amount || 0; });
  return [...g.values()];
}
function cleanZeroTicks() {
  let n = 0;
  all('fin').forEach(e => { if (e.planRef && !(+e.amount)) { softDelete(e.id, { render: false }); n++; } });
  if (n) RLOG.info('removed empty plan entries', n);
}
/* A recurring item that repeats a loan's EMI would count the EMI twice. */
function dupEmiOf(r) {
  if (!r || !(r.kind === 'expense' || r.kind === 'transfer')) return null;
  return accts().find(a => a.kind === 'loan' && +a.emi && Math.abs(+a.emi - (+r.amt || 0)) < 1 && (a.payFrom === r.from || !a.payFrom)
    && (r.kind === 'expense' || r.to === a.id)) || null;
}
/* Amount of a recurring item in a month: the base amount, or the latest "changes from" step on or before it. */
function recurAmt(r, ym) {
  let a = +r.amt || 0;
  (r.steps || []).slice().sort((x, y) => x.month < y.month ? -1 : 1).forEach(s => { if (ym >= s.month) a = +s.a || 0; });
  return a;
}
function recurStepsText(r) {
  return (r.steps || []).slice().sort((x, y) => x.month < y.month ? -1 : 1).map(s => rs(s.a) + ' from ' + monthShort(s.month)).join(', ');
}
/* ---------- udhaar received back in instalments (recurring kind 'udhback') ---------- */
const udhOpenLent = who => all('fin').filter(e => e.kind === 'lent' && !e.settled && outstanding(e) > 0 && (e.who || '').trim().toLowerCase() === (who || '').trim().toLowerCase())
  .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
const udhOwedBy = who => udhOpenLent(who).reduce((s, e) => s + outstanding(e), 0);
function udhPersons() {
  const m = new Map();
  all('fin').filter(e => e.kind === 'lent' && !e.settled && outstanding(e) > 0 && (e.who || '').trim()).forEach(e => { const k = e.who.trim(); m.set(k, (m.get(k) || 0) + outstanding(e)); });
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
/* Undo the instalment payments written for one plan tick. */
function removeUdhPays(ref) {
  all('fin').filter(e => (e.pays || []).some(p => p.planRef === ref)).forEach(e => {
    const back = e.pays.filter(p => p.planRef === ref).reduce((s, p) => s + (+p.amt || 0), 0);
    e.pays = e.pays.filter(p => p.planRef !== ref);
    e.paidAmount = Math.max(0, +(((e.paidAmount || 0) - back).toFixed(2)));
    e.settled = e.paidAmount >= (+e.amount || 0) - 0.005;
    put(e, { render: false });
  });
}
/* Record an instalment as money paid back against the person's oldest open udhaar entries. */
function applyUdhPays(ref, who, acct, amt, date) {
  removeUdhPays(ref);
  const owed = udhOwedBy(who);
  if (amt > owed + 0.005) throw new Error(`${who} owes only ${rs(owed)} in Udhaar, not ${rs(amt)}.`);
  let left = amt;
  udhOpenLent(who).forEach(e => {
    if (left <= 0.005) return;
    const take = Math.min(left, outstanding(e));
    e.pays = (e.pays || []).concat([{ date, amt: +take.toFixed(2), acct, planRef: ref }]);
    e.paidAmount = +(((e.paidAmount || 0) + take).toFixed(2));
    e.settled = e.paidAmount >= (+e.amount || 0) - 0.005;
    left -= take; put(e, { render: false });
  });
}
function udhaarNet() {
  return all('fin').filter(e => isUdh(e) && !e.settled).reduce((s, e) => s + (e.kind === 'lent' ? 1 : -1) * outstanding(e), 0);
}

/* ---------- planned items of a month ---------- */
function planItems(c, ym) {
  const pm = pmGet(ym), items = [];
  recurs().forEach(r => { if (r.kind !== 'udhgive' && recurDue(r, ym)) items.push({ key: 'r:' + r.id, label: r.name, kind: r.kind, who: r.who || '', a: recurAmt(r, ym), from: r.kind === 'udhback' ? null : r.from, to: r.to, budget: !!r.budget && r.kind === 'expense', cat: r.cat || '' }); });
  accts(true).forEach(a => {
    if (a.archived && a.kind !== 'loan') return;                        // archived funds: no SIP; a loan keeps its EMIs until its last month
    if (isInvest(a.kind) && a.sip && +a.sip.amt && a.sip.start && ym >= a.sip.start && (!a.sip.end || ym <= a.sip.end))
      items.push({ key: 'sip:' + a.id, label: 'SIP · ' + a.name, kind: 'transfer', a: +a.sip.amt, from: a.sip.from, to: a.id });
    if (a.kind === 'loan' && +a.emi && a.start && ym >= a.start && (!a.end || ym <= a.end))
      items.push({ key: 'emi:' + a.id, label: 'EMI · ' + a.name, kind: 'transfer', a: +a.emi, from: a.payFrom, to: a.id });
    const I = acctInt(a);                                                   // v2.37: savings interest, an estimate until it is in the Ledger
    if (I && !a.archived && ym >= (I.from || c.startMonth) && (I.every === 1 || +ym.slice(5) % 3 === 0))
      items.push({ key: 'int:' + a.id, label: 'Interest · ' + a.name, kind: 'income', a: I.amt || 0, rate: I.amt ? 0 : I.rate, every: I.every, to: a.id, cat: 'Interest', interest: true });
  });
  (pm ? pm.extra || [] : []).forEach(x => items.push({ key: 'x:' + x.id, label: x.label || 'One-off', kind: x.kind, a: +x.a || 0, from: x.from, to: x.to, extra: true, cat: x.cat || '' }));
  items.forEach(it => { const o = pm && pm.items && pm.items[it.key]; if (o) { if (!isBlank(o.a)) it.a = +o.a; it.done = !!o.done; it.ledgerId = o.ledgerId || null; it.changed = !isBlank(o.a); } });
  (pm ? pm.extra || [] : []).forEach(x => { const it = items.find(i => i.key === 'x:' + x.id); if (it && x.done) { it.done = true; it.ledgerId = x.ledgerId; } });
  items.forEach(it => {
    if (!it.done) return;
    if (it.kind === 'udhback') {
      const ref = ym + '|' + it.key, paid = all('fin').reduce((s, e) => s + (e.pays || []).filter(p => p.planRef === ref).reduce((t, p) => t + (+p.amt || 0), 0), 0);
      if (paid > 0) it.a = paid; else { it.done = false; it.ledgerId = null; it.lost = true; }
      return;
    }
    const L = it.ledgerId && records[it.ledgerId];
    if (L && !L.deleted) it.a = +L.amount || 0;             // what is really in the Ledger
    else { it.done = false; it.ledgerId = null; it.lost = true; }   // its Ledger entry was deleted: planned again
  });
  // an entry you typed into the Ledger yourself (same month, type, account and amount) counts as done
  const used = new Set(), dflt = (acctById(c.defAcct) || {}).id || defAcct(c), ac = e => e.acct || (e.kind !== 'transfer' ? dflt : null);   // untagged entries sit on the default account
  const mine = all('fin').filter(e => !e.planRef && (e.date || '').slice(0, 7) === ym && ac(e));                     // later dates this month count too — they are already in the balances
  items.forEach(it => {                                                    // v2.37: interest you entered yourself (any amount) counts as done
    if (it.done || !it.interest) return;
    const m = mine.find(e => !used.has(e.id) && e.kind === 'income' && ac(e) === it.to && (e.category === 'Interest' || /interest/i.test(e.desc || '')));
    if (m) { used.add(m.id); it.done = true; it.matched = m.id; it.a = +m.amount || 0; }
  });
  items.forEach(it => {
    if (it.done || it.kind !== 'udhback' || !it.a) return;
    const hit = all('fin').some(e => e.kind === 'lent' && (e.who || '').trim().toLowerCase() === it.who.trim().toLowerCase() &&
      (e.pays || []).some(p => !p.planRef && (p.date || '').slice(0, 7) === ym && Math.abs((+p.amt || 0) - it.a) < 1));
    if (hit) { it.done = true; it.matched = 'udh'; }
  });
  items.forEach(it => {
    if (it.done || it.budget || !it.a || it.kind === 'udhback') return;
    const m = mine.find(e => !used.has(e.id) && Math.abs((+e.amount || 0) - it.a) < 1 && (e.kind === it.kind &&
      (it.kind === 'income' ? ac(e) === it.to : it.kind === 'expense' ? ac(e) === it.from : e.acct === it.from && e.to === it.to)
      || it.kind === 'transfer' && e.kind === 'expense' && e.category === 'Investment' && ac(e) === it.from && isInvest((acctById(it.to) || {}).kind)));   // a SIP typed in as "Investment" spending
    if (m) { used.add(m.id); it.done = true; it.matched = m.id; }
  });
  return items;
}

/* ---------- the engine ----------
   mode 'plan'   : Ledger so far + everything planned that is not ticked
   mode 'actual' : Ledger only (and statement values), up to today        */
function planCompute(c, toMonth, mode, log) {          // v2.25: log (optional) collects every change to every account, for the statement
  const actual = mode === 'actual', cur = isoMonth(new Date());
  const L = !log ? null : (id, ym, line) => { if (!id || !line.amt || Math.abs(line.amt) < 0.005) return; const m = log.months[ym] = log.months[ym] || {}; (m[id] = m[id] || []).push(line); };
  if (log && !log.udh) log.udh = {};
  if (actual && toMonth > cur) toMonth = cur;
  const list = accts(true), bal = {}, udh = udhaarNet();
  list.forEach(a => { bal[a.id] = a.kind === 'loan' && loanSched(a) ? -loanOwed(a, monthAdd(c.startMonth, -1)) : isLiab(a.kind) ? -(+a.open || 0) : (+a.open || 0); });
  const flows = ledgerFlows(c), byYm = {};
  flows.forEach(f => { (byYm[f.ym] = byYm[f.ym] || []).push(f); });
  const rows = [], udhLeft = new Map(); let udhBack = 0, udhGive = 0, intEst = {};
  const gives = recurs().filter(r => r.kind === 'udhgive' && (r.who || '').trim()), cardPlans = cardBillPlans(c);   // v2.26
  const giveDone = udhGiveMatches(gives, toMonth);                         // v2.26.1: planned gives already covered by real udhaar
  const paidByYm = {}, pastUdh = {};                                       // v2.34
  all('fin').forEach(e => { if (isPaidBy(e) && e.category !== 'Investment') { const m = finDate(e).slice(0, 7); if (m >= c.startMonth) paidByYm[m] = (paidByYm[m] || 0) + (+e.amount || 0); } });
  for (let ym = c.startMonth, i = 0; ym <= toMonth && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) {
    let inc = 0, exp = 0, invIn = 0, interest = 0, growth = 0, pending = 0, planned = false; intEst = {};
    const items = planItems(c, ym), fl = byYm[ym] || [], bal0 = { ...bal };
    if (log) log.open[ym] = bal0;
    // actual movements
    fl.forEach(f => {
      const a = acctById(f.acct); if (!a) return;
      if (a.kind === 'loan' && loanSched(a)) return;                        // a scheduled loan follows its schedule
      bal[f.acct] += f.amt;
      if (L) L(f.acct, ym, stmtFlowLine(f));
      if (f.cat === 'inc') inc += f.amt;
      else if (f.cat === 'exp') { if (f.e && f.e.category === 'Investment') invIn -= f.amt; else exp -= f.amt; }   // same split as the PDF report
      else if (f.cat === 'in' && isInvest(a.kind)) invIn += f.amt;
      else if (f.cat === 'out' && isInvest(a.kind)) invIn += f.amt;          // negative: money taken out
    });
    exp += paidByYm[ym] || 0;                                               // v2.34: paid by someone for you is your spending (as in the Ledger); no account moves until you pay them back
    // planned movements not yet ticked
    const matchedIds = new Set(items.filter(i => i.matched).map(i => i.matched));
    const bUse = budgetUse(items, fl, matchedIds);                            // v2.37: each estimate takes its own account's spending first
    // v2.26: udhaar you plan to give (estimate) — from this month on; real udhaar given this month replaces it
    if (!actual && ym >= cur) gives.forEach(r => {
      if (!recurDue(r, ym) || giveDone.has(r.id + '|' + ym)) return;
      const amt = recurAmt(r, ym), k = r.who.trim().toLowerCase();
      if (amt <= 0.005) return;
      if (!udhLeft.has(k)) udhLeft.set(k, udhOwedBy(r.who));
      udhLeft.set(k, udhLeft.get(k) + amt); udhGive += amt; planned = true;
      const F = acctById(r.from);
      if (F && !(F.kind === 'loan' && loanSched(F))) { bal[F.id] -= amt; if (L) L(F.id, ym, { label: `Udhaar to ${r.who.trim()} (estimate)`, amt: -amt, src: 'est', grp: 'udh' }); }
      if (log) (log.udh[ym] = log.udh[ym] || []).push({ who: r.who.trim(), label: `Given to ${r.who.trim()} (estimate)`, amt, src: 'est' });
    });
    const closedPast = ym < cur && !!(pmGet(ym) || {}).closed;               // v2.37: a checked month — what you did not tick did not happen
    items.forEach(it => { if (!it.interest) return; if (it.rate && !it.changed && !it.done) it.a = Math.round(Math.max(0, bal0[it.to] || 0) * it.rate / 1200 * (it.every || 1)); intEst[it.to] = it.a; });
    if (!actual) items.forEach(it => {
      if (it.done) return;
      if (!it.budget && closedPast) return;
      let amt = it.a;
      if (it.budget) { if (ym < cur) return; const use = ym === cur ? (bUse[it.key] || 0) : 0; amt = it.a - use; }
      if (!amt) return;
      if (!it.budget && ym < cur) pending++;
      planned = true;
      const F = acctById(it.from), T = acctById(it.to);
      if (it.kind === 'udhback') {
        const k = it.who.trim().toLowerCase(); if (!udhLeft.has(k)) udhLeft.set(k, udhOwedBy(it.who));
        amt = Math.min(amt, udhLeft.get(k)); if (amt <= 0) return;
        udhLeft.set(k, udhLeft.get(k) - amt); udhBack += amt;
        if (log) (log.udh[ym] = log.udh[ym] || []).push({ who: it.who.trim(), label: `${it.who.trim()} paid back (plan)`, amt: -amt, src: 'plan' });
        if (T && !(T.kind === 'loan' && loanSched(T))) { bal[T.id] += amt; if (L) L(T.id, ym, { label: (it.who || '?') + ' (udhaar back)', amt, src: 'plan', grp: 'udh' }); }
        return;
      }
      const free = x => x && !(x.kind === 'loan' && loanSched(x));
      const est = it.budget || it.rate ? ' (estimate)' : '', nt = ym < cur ? ' (planned · not ticked)' : '';   // v2.37
      if (it.kind === 'income') { if (free(T)) { bal[T.id] += amt; if (L) L(T.id, ym, { label: it.label + est + nt, amt, src: it.rate ? 'est' : 'plan' }); } inc += amt; }
      else if (it.kind === 'expense') { if (free(F)) { bal[F.id] -= amt; if (L) L(F.id, ym, { label: it.label + est + nt, amt: -amt, src: it.budget ? 'est' : 'plan' }); } exp += amt; }
      else {
        if (free(F)) { bal[F.id] -= amt; if (L) L(F.id, ym, { label: stmtXferLabel(it.label, T, '→') + nt, amt: -amt, src: 'plan', peer: T ? T.id : null }); }
        if (free(T)) { bal[T.id] += amt; if (L) L(T.id, ym, { label: stmtXferLabel(it.label, F, '←') + nt, amt, src: 'plan', peer: F ? F.id : null }); }
        if (T && isInvest(T.kind)) invIn += amt;
        if (F && isInvest(F.kind)) invIn -= amt;
      }
    });
    // v2.26: credit-card bill (estimate) — from this month on, pays what the card owed at the start of the month, less what was already paid into it
    if (!actual && ym >= cur) cardPlans.forEach(P => {
      const due = -(bal0[P.card.id] || 0); if (due <= 0.5) return;
      const paid = fl.filter(f => f.acct === P.card.id && f.amt > 0 && f.cat === 'in').reduce((t, f) => t + f.amt, 0);
      let amt = Math.max(0, due - paid); if (P.mode === 'fixed') amt = Math.min(amt, P.amt);
      if (amt <= 0.5) return;
      bal[P.card.id] += amt; bal[P.from.id] -= amt; planned = true;
      if (L) { L(P.card.id, ym, { label: `Bill paid (estimate) ← ${P.from.name}`, amt, src: 'est', peer: P.from.id }); L(P.from.id, ym, { label: `${P.card.name} bill (estimate)`, amt: -amt, src: 'est', peer: P.card.id }); }
    });
    // growth, statement values, loans
    list.forEach(a => {
      if (isInvest(a.kind)) {
        const before = bal[a.id];
        if (!actual && +a.ret && !a.archived && ym >= cur) { const g = before * (+a.ret) / 1200; bal[a.id] += g; growth += g; if (L) L(a.id, ym, { label: `Growth (estimate, ${a.ret}% a year)`, amt: g, src: 'est' }); }   // estimate only for months not yet over
        const v = (a.values || []).find(x => x.month === ym);
        if (v && isFinite(+v.a)) { growth += +v.a - bal[a.id]; if (L) L(a.id, ym, { label: 'Matched to statement value', amt: +v.a - bal[a.id], src: 'actual' }); bal[a.id] = +v.a; }
      } else if (a.kind === 'loan' && loanSched(a)) {
        const owedBefore = loanOwed(a, monthAdd(ym, -1));
        const k = loanInfo(a, ym);
        let iThis = 0;
        if (k.r && ym >= a.start && ym <= a.end) { iThis = owedBefore * k.r; interest += iThis; }
        const was = bal[a.id];
        bal[a.id] = -loanOwed(a, ym);
        if (L) { L(a.id, ym, { label: 'Interest added', amt: -iThis, src: 'plan' }); L(a.id, ym, { label: 'EMI paid' + (a.payFrom && acctById(a.payFrom) ? ' ← ' + acctName(a.payFrom) : ''), amt: bal[a.id] - was + iThis, src: 'plan', peer: a.payFrom || null }); }
      }                                                                     // other loans: opening − what you paid into them
    });
    let assets = 0, liabs = 0, cardDue = 0, loanBal = 0, liquid = 0, invest = 0, cardPos = 0; const neg = [];
    list.forEach(a => {
      const v = bal[a.id];
      if (isLiab(a.kind)) { if (v > 0) { assets += v; if (a.kind === 'card') cardPos += v; } else { liabs += -v; if (a.kind === 'loan') loanBal += -v; else cardDue += -v; } } else assets += v;
      if (isLiquid(a.kind)) { liquid += v; if (v < -0.5 && !a.archived) neg.push(a.id); }
      if (isInvest(a.kind)) invest += v;
    });
    exp += interest;
    const pm = pmGet(ym);
    let udhBase = udh;                                                      // v2.34: a month that is over uses the udhaar open on its last day
    if (ym < cur) { if (pastUdh[ym] == null) { const a = udhaarAsOf(monthEnd(ym)); pastUdh[ym] = a.owed - a.owe; } udhBase = pastUdh[ym]; }
    const U = udhBase - udhBack + udhGive;                                  // v2.26: udhaar you plan to give is still your money, now owed to you
    rows.push({ ym, inc, exp, interest, invIn, growth, net: inc - exp, accts: { ...bal }, assets, liabs, cardDue, loanBal, liquid, invest, udh: U, udhBack, udhGive,
      worth: assets - cardDue + U, hand: liquid + cardPos - cardDue, afterLoans: assets - cardDue + U - loanBal,
      pending, planned, closed: !!(pm && pm.closed), neg, ended: ym < cur, cur: ym === cur, intEst });
  }
  return rows;
}
/* v2.26.1: amounts typed for one month only (in a month's sheet, or left over from the old plan) replace the recurring
   amount in that month — including later raises. This lists them so they can be cleared. Ticked months are real Ledger entries and are left alone. */
function recurOfKey(key, ym) {
  if (key.startsWith('r:')) { const r = records[key.slice(2)]; if (!r || r.deleted || r.type !== 'recur' || !recurDue(r, ym)) return null; return { label: r.name, a: recurAmt(r, ym) }; }
  if (key.startsWith('sip:')) { const a = acctById(key.slice(4)); if (!a || !a.sip) return null; return { label: 'SIP · ' + a.name, a: +a.sip.amt || 0 }; }
  if (key.startsWith('emi:')) { const a = acctById(key.slice(4)); if (!a || !+a.emi) return null; return { label: 'EMI · ' + a.name, a: +a.emi || 0 }; }
  return null;
}
function monthOverrides(c, onlyKey) {
  const out = [];
  all('planmonth').forEach(pm => {
    if (!pm.month || pm.month < c.startMonth) return;
    Object.entries(pm.items || {}).forEach(([key, o]) => {
      if (!o || isBlank(o.a) || o.done || (onlyKey && key !== onlyKey)) return;
      const R = recurOfKey(key, pm.month); if (!R) return;
      out.push({ ym: pm.month, key, label: R.label, own: +o.a, rec: R.a, diff: Math.abs(+o.a - R.a) >= 0.5, pm });
    });
  });
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.ym.localeCompare(b.ym));
}
function overrideSheet(onlyKey) {
  const c = planCfg(), L = monthOverrides(c, onlyKey);
  if (!L.length) { toast('No month has its own amount.'); return; }
  const by = {}; L.forEach(x => { (by[x.key] = by[x.key] || []).push(x); });
  const html = `<p class="hint" style="margin:0 0 10px">These months use an amount typed for that month only. It replaces the recurring amount there — so later raises or changes in Recurring do not reach them. Clearing makes those months follow Recurring again. Months already ticked in a check-up are not listed.</p>
    ${Object.entries(by).map(([key, xs]) => { const nd = xs.filter(x => x.diff).length;
      return `<div class="group" style="padding:10px 12px;margin-bottom:10px"><label class="switch-row" style="padding:0"><span><b>${esc(xs[0].label)}</b><small>${xs.length} month${xs.length > 1 ? 's' : ''} · ${nd ? nd + ' differ from Recurring' : 'same as Recurring now, but will not follow later changes'}</small></span><input type="checkbox" class="sw" data-ovk="${esc(key)}" checked></label>
        <div class="tw"><table class="pt"><thead><tr><th>Month</th><th>This month only</th><th>Recurring</th></tr></thead><tbody>${xs.map(x => `<tr class="${x.diff ? 'hl' : ''}"><td>${monthShort(x.ym)}</td><td>${rs(x.own)}</td><td>${rs(x.rec)}${x.diff ? ' <span class="tag warn">differs</span>' : ''}</td></tr>`).join('')}</tbody></table></div></div>`; }).join('')}`;
  planSheet('Amounts for one month only', html, () => {
    const keys = $$('[data-ovk]', $('pshBody')).filter(b => b.checked).map(b => b.dataset.ovk);
    if (!keys.length) { planMsg('Tick at least one item to clear.', true); return false; }
    const pms = new Map(); L.filter(x => keys.includes(x.key)).forEach(x => { if (!pms.has(x.pm.id)) pms.set(x.pm.id, JSON.parse(JSON.stringify(x.pm.items || {}))); });
    let n = 0;
    L.filter(x => keys.includes(x.key)).forEach(x => { const o = { ...(x.pm.items[x.key] || {}) }; delete o.a; const items = { ...(x.pm.items || {}) }; if (Object.keys(o).length) items[x.key] = o; else delete items[x.key]; x.pm.items = items; n++; });
    pms.forEach((_, id) => put(records[id], { render: false }));
    scheduleRender();
    toast(`Cleared ${n} month${n > 1 ? 's' : ''} — they follow Recurring now.`, 'Undo', () => { pms.forEach((items, id) => { records[id].items = items; put(records[id], { render: false }); }); scheduleRender(); }, 8000);
    return true;
  }, 'Clear ticked');
}
/* v2.26.1: each real udhaar given to a person uses up the nearest planned "Udhaar give" to them within 2 months either side
   (whatever the amounts), so giving earlier, later, more or less never counts twice. Overflow from settling does not count. */
const udhIsExtra = e => !!(e && (e.origin || /^Extra when settling/.test(e.desc || '')));
function udhGiveMatches(gives, toMonth) {
  const done = new Set(), byP = {};
  gives.forEach(r => { const k = udhKey(r.who); (byP[k] = byP[k] || []).push(r); });
  Object.keys(byP).forEach(k => {
    const occ = [], lim = monthAdd(toMonth, 2);
    byP[k].forEach(r => { for (let ym = r.start, i = 0; ym && ym <= lim && (!r.end || ym <= r.end) && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) if (recurDue(r, ym)) occ.push({ key: r.id + '|' + ym, ym }); });
    if (!occ.length) return;
    all('fin').filter(e => e.kind === 'lent' && e.date && udhKey(e.who) === k && !udhIsExtra(e)).map(e => e.date.slice(0, 7)).sort().forEach(m => {
      let best = null, bd = 3;
      occ.forEach(o => { if (done.has(o.key)) return; const dd = Math.abs(monthsBetween(m, o.ym)); if (dd <= 2 && (dd < bd || (dd === bd && o.ym < best.ym))) { bd = dd; best = o; } });
      if (best) done.add(best.key);
    });
  });
  return done;
}
/* v2.26: how the plan pays each credit card. Default: the whole bill from the default account. Off when a recurring transfer into the card exists. */
function cardBillPlans(c) {
  const dflt = acctById(defAcct(c));
  return accts().filter(a => a.kind === 'card').map(a => {
    const p = a.billPlan || {}, mode = p.mode || 'full';
    if (mode === 'off' || recurs().some(r => r.kind === 'transfer' && r.to === a.id)) return null;
    const from = acctById(p.from) || dflt;
    if (!from || from.id === a.id || from.archived || from.kind === 'card' || from.kind === 'loan') return null;
    if (mode === 'fixed' && !(+p.amt > 0)) return null;
    return { card: a, from, mode, amt: +p.amt || 0 };
  }).filter(Boolean);
}
function planYears(rows, mode) {
  const by = new Map();
  rows.forEach(r => {
    const k = yearKey(r.ym, mode);
    if (!by.has(k)) by.set(k, { k, label: yearLabel(k, mode), inc: 0, exp: 0, invIn: 0, months: 0, closed: 0, ended: 0, pending: 0, last: null, planned: false, neg: false });
    const y = by.get(k);
    y.inc += r.inc; y.exp += r.exp; y.invIn += r.invIn; y.months++; y.last = r; y.planned = y.planned || r.planned; y.neg = y.neg || r.neg.length > 0;
    if (r.ended) { y.ended++; if (r.closed) y.closed++; } y.pending += r.pending;
  });
  return [...by.values()];
}
function planAutoEnd(c) {
  const cur = isoMonth(new Date());
  let end = monthAdd(cur > c.startMonth ? cur : c.startMonth, 11);
  const bump = ym => { if (ym && ym > end) end = ym; };
  recurs().forEach(r => bump(r.end)); accts().forEach(a => { bump(a.end); if (a.sip) bump(a.sip.end); });
  all('goal').forEach(g => bump(g.by));
  Object.values(records).forEach(r => { if (r.type === 'planmonth' && !r.deleted && ((r.extra || []).length || Object.keys(r.items || {}).length)) bump(r.month); });
  const mode = c.yearMode || 'fy', k = yearKey(end, mode);
  bump(mode === 'fy' ? (k + 1) + '-03' : k + '-12');
  const cap = monthAdd(c.startMonth, PLAN_MAX_MONTHS - 1);
  return end > cap ? cap : end;
}
function planHorizon(c) {
  if (c.showUntil && /^\d{4}-\d{2}$/.test(c.showUntil)) return c.showUntil < c.startMonth ? monthAdd(c.startMonth, 11) : c.showUntil;
  return planAutoEnd(c);
}
function planPendingMonths() {
  const c = planCfg(); if (!c || !Fin.key || !accts().length) return [];
  const cur = isoMonth(new Date()), out = [];
  for (let ym = c.startMonth, i = 0; ym < cur && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) {
    const pm = pmGet(ym);
    if (pm && pm.closed) continue;
    if (planItems(c, ym).some(it => !it.done && !it.budget && it.a)) out.push(ym);
  }
  return out;
}
function planBadge() {
  const n = planPendingMonths().length;
  ['plan', 'accts'].forEach(v => { const b = document.querySelector(`#moneySeg [data-v="${v}"]`); if (!b) return;
    const lbl = v === 'plan' ? 'Plan' : 'Accounts';
    b.innerHTML = lbl + (n && v === 'accts' ? ` <span class="seg-badge" aria-label="${n} months need a check-up">${n}</span>` : ''); });
}

/* ---------- move plans made in v2.2 / v2.3 onto accounts ---------- */
function migratePlanV3() {
  const c = planCfg(); if (!c || c.v >= 3 || !Fin.key) return false;
  const cur = isoMonth(new Date()), map = {};
  const kindOf = { a1: 'salary', a2: 'salary', a3: 'bank', a4: 'cash' };
  (c.accounts && c.accounts.length ? c.accounts : [{ id: 'a3', name: 'Bank account' }]).forEach((a, i) => {
    const id = 'acc-' + a.id; map[a.id] = id;
    put({ id, type: 'acct', name: a.name, kind: kindOf[a.id] || 'bank', open: +((c.open || {})[a.id] || (a.id === 'a3' && !c.open ? c.openingCash : 0)) || 0, order: i, deleted: false }, { render: false });
  });
  const def = map[c.defAcct] || map.a3 || Object.values(map)[0];
  if (+(c.open || {}).mf) put({ id: 'acc-mf', type: 'acct', name: 'Mutual funds', kind: 'mf', open: +c.open.mf, ret: +c.mfRet || 0, deleted: false }, { render: false });
  if (+(c.open || {}).udh) put({ id: 'acc-udh', type: 'acct', name: 'Udhaar (opening figure)', kind: 'other', open: +c.open.udh, deleted: false }, { render: false });
  const extraAdd = {};
  const addExtra = (ym, x) => { (extraAdd[ym] = extraAdd[ym] || []).push({ id: uid('x'), ...x }); };
  all('invest').forEach(v => {
    const id = 'acc-' + v.id;
    put({ id, type: 'acct', name: v.name, kind: 'mf', open: 0, ret: +v.ret || 0, values: v.values || [], sip: +v.monthly ? { amt: +v.monthly, from: map[v.acct] || def, start: v.start, end: v.end || null } : null, deleted: false }, { render: false });
    (v.lumps || []).forEach(x => addExtra(x.month, { kind: 'transfer', label: 'Lump sum · ' + v.name, a: +x.a, from: map[v.acct] || def, to: id }));
    (v.redeems || []).forEach(x => addExtra(x.month, { kind: 'transfer', label: 'Redeem · ' + v.name, a: +x.a, from: id, to: map[v.acct] || def }));
    softDelete(v.id, { render: false });
  });
  all('loan').forEach(l => {
    put({ id: 'acc-' + l.id, type: 'acct', name: l.name, kind: 'loan', emi: +l.emi || 0, amount: +l.amount || 0, start: l.start, end: l.end, payFrom: map[l.acct] || def, open: 0, deleted: false }, { render: false });
    softDelete(l.id, { render: false });
  });
  // income sources and planned spending become recurring items; month-by-month differences stay as changes
  const months = Object.values(records).filter(r => r.type === 'planmonth' && !r.deleted && r.v !== 3).sort((a, b) => a.month.localeCompare(b.month));
  const mode = vals => { const f = {}; vals.forEach(v => { f[v] = (f[v] || 0) + 1; }); return +Object.keys(f).sort((a, b) => f[b] - f[a])[0]; };
  const srcRec = {};
  (c.sources || []).filter(s => s.active !== false).forEach(s => {
    const vals = months.map(m => m.inc && m.inc[s.id] && m.inc[s.id].a).filter(v => !isBlank(v));
    const id = uid('rc'); srcRec[s.id] = { id, amt: vals.length ? mode(vals) : 0 };
    put({ id, type: 'recur', name: s.name, kind: 'income', amt: srcRec[s.id].amt, to: map[s.acct] || def, start: c.startMonth, end: null, every: 1, deleted: false }, { render: false });
  });
  const exps = months.map(m => m.expPlan).filter(v => !isBlank(v));
  let hh = null;
  if (exps.length) { hh = { id: uid('rc'), amt: mode(exps) }; put({ id: hh.id, type: 'recur', name: 'Household spending', kind: 'expense', budget: true, amt: hh.amt, from: def, start: c.startMonth, end: null, every: 1, deleted: false }, { render: false }); }
  const tick = (ym, kind, amt, acct, label, planRef) => put({ id: uid('f'), type: 'fin', desc: label, amount: amt, kind, category: kind === 'income' ? 'Salary' : '', acct,
    date: ym === cur ? todayISO() : monthEnd(ym), planRef, who: '', recurring: false, paidAmount: 0, settled: false, deleted: false }, { render: false }).id;
  months.forEach(m => {
    const nm = pmNew(m.month);
    Object.entries(m.inc || {}).forEach(([sid, x]) => {
      const r = srcRec[sid]; if (!r || isBlank(x.a)) return;
      const key = 'r:' + r.id, o = {};
      if (+x.a !== r.amt) o.a = +x.a;
      if (x.act && +x.a && m.month <= cur) { o.done = true; o.ledgerId = tick(m.month, 'income', +x.a, map[(c.sources.find(s => s.id === sid) || {}).acct] || def, (c.sources.find(s => s.id === sid) || {}).name || 'Income', m.month + '|' + key); }
      if (Object.keys(o).length) nm.items[key] = o;
    });
    // months that had no figure for a source: skip the recurring item there
    (c.sources || []).forEach(s => { const r = srcRec[s.id]; if (r && !(m.inc && m.inc[s.id] && !isBlank(m.inc[s.id].a))) nm.items['r:' + r.id] = { a: 0 }; });
    if (hh) { if (isBlank(m.expPlan)) nm.items['r:' + hh.id] = { a: 0 }; else if (+m.expPlan !== hh.amt) nm.items['r:' + hh.id] = { a: +m.expPlan }; }
    (m.extraInc || []).forEach(x => { const e = { id: uid('x'), kind: 'income', label: x.label, a: +x.a, to: def }; if (x.act && +x.a && m.month <= cur) { e.done = true; e.ledgerId = tick(m.month, 'income', +x.a, def, x.label, m.month + '|x:' + e.id); } nm.extra.push(e); });
    (m.extraExp || []).forEach(x => nm.extra.push({ id: uid('x'), kind: 'expense', label: x.label, a: +x.a, from: def }));
    (extraAdd[m.month] || []).forEach(x => nm.extra.push(x)); delete extraAdd[m.month];
    put(nm, { render: false });
  });
  Object.entries(extraAdd).forEach(([ym, list]) => { const nm = pmGet(ym) || pmNew(ym); nm.extra = (nm.extra || []).concat(list); put(nm, { render: false }); });
  Object.assign(c, { v: 3, defAcct: def });
  put(c, { render: false });
  RLOG.info('plan moved to accounts (v3)');
  toast('Your plan was moved onto accounts. Check Money → Accounts.', null, null, 6000);
  return true;
}

