/* ==========================================================================
   MONEY (private, encrypted) — ledger, udhaar by person, budgets
   ======================================================================== */
let finMonth = isoMonth(new Date()), budMonth = isoMonth(new Date());
const KINDS = [{ v: 'expense', l: 'Spent' }, { v: 'income', l: 'Received' }, { v: 'lent', l: 'Udhaar diya (lent)' }, { v: 'borrowed', l: 'Udhaar liya (borrowed)' }, { v: 'paidby', l: 'Paid by someone' }, { v: 'transfer', l: 'Transfer' }];
const isUdhaar = k => k === 'lent' || k === 'borrowed' || k === 'paidby';
/* v2.20 "Paid by someone": your spending (counts in its category and budgets) that someone else paid for.
   Stored as kind 'expense' + paidBy, with who / paidAmount / pays / settled like udhaar liya. No account moves
   until you pay them back; each pay-back leaves the account it was paid from. */
const isPaidBy = e => !!(e && e.kind === 'expense' && e.paidBy);
const isUdh = e => !!e && (e.kind === 'lent' || e.kind === 'borrowed' || isPaidBy(e));   // an entry with money still open with a person
const youOwe = e => !!e && (e.kind === 'borrowed' || isPaidBy(e));
const uiKind = e => isPaidBy(e) ? 'paidby' : e.kind;
const outstanding = e => Math.max(0, (e.amount || 0) - (e.paidAmount || 0));
const people = () => [...new Set(all('fin').map(e => (e.who || '').trim()).filter(Boolean))].sort();
function refreshPeopleList() {
  $('peopleDl').innerHTML = people().map(p => `<option value="${esc(p)}">`).join('');
}

function renderMoney() {
  if (!finUnlocked()) { showTab('tasks'); return; }
  const seg = prefs.moneySeg === 'budget' ? 'ledger' : prefs.moneySeg;
  $$('#moneySeg button').forEach(b => b.classList.toggle('on', b.dataset.v === seg));
  $('paneLedger').classList.toggle('hidden', seg !== 'ledger');
  $('paneUdhaar').classList.toggle('hidden', seg !== 'udhaar');
  $('panePlan').classList.toggle('hidden', seg !== 'plan');
  $('paneAccts').classList.toggle('hidden', seg !== 'accts');
  $('paneSnotes').classList.toggle('hidden', seg !== 'snotes');
  planBadge();
  const lock = $('moneyLocked');
  if (Fin.lockedOut.length) {
    lock.classList.remove('hidden');
    lock.innerHTML = `<div class="group" style="padding:14px"><b>${Fin.lockedOut.length} entr${Fin.lockedOut.length > 1 ? 'ies were' : 'y was'} saved under an older code.</b>
      <p class="hint" style="margin:6px 0 10px">Enter that older code once and they will be brought across.</p>
      <div style="display:flex;gap:8px"><input type="password" id="oldCodeIn" placeholder="Older code"><button class="btn small" id="oldCodeGo">Recover</button></div></div>`;
    $('oldCodeGo').addEventListener('click', async () => { const n = await recoverLockedOut($('oldCodeIn').value); toast(n ? `Recovered ${n}.` : 'That code did not open them.'); });
  } else lock.classList.add('hidden');
  refreshPeopleList();
  if (seg === 'ledger') renderLedger(); else if (seg === 'udhaar') renderUdhaar();
  else if (seg === 'plan') renderPlan(); else if (seg === 'accts') renderAccts(); else if (seg === 'snotes') renderSnotes(); else renderLedger();
  if (Sheets.isOpen('shInsights')) renderInsights();
  if (Sheets.isOpen('shStmt')) { try { renderStatement(); } catch (e) { RLOG.error('statement', e); } }
}
$$('#moneySeg button').forEach(b => b.addEventListener('click', () => { if (b.dataset.v === 'udhaar') Udh.person = null; setPref('moneySeg', b.dataset.v); renderMoney(); }));   // v2.25: tapping Udhaar again goes back to the people list

function finRow(e, showDate) {
  const sign = e.kind === 'income' ? '+' : e.kind === 'expense' ? '−' : e.kind === 'transfer' ? '↔ ' : '';
  const cls = e.kind === 'income' ? 'pos' : e.kind === 'expense' ? 'neg' : '';
  const part = isUdh(e) && !e.settled && (e.paidAmount || 0) > 0;
  return swipeHtml(`<div class="row fin-row ${e.settled ? 'muted' : ''}">
    <div class="row-main"><div class="row-title">${esc(e.desc || '—')}${e.who ? ` <span class="muted">· ${esc(e.who)}</span>` : ''}</div>
      <div class="row-sub">${showDate !== false ? `<span>${fmtDate(e.date)}</span>` : ''}${isUdh(e) ? `<span class="pill">${e.kind === 'lent' ? 'lent' : isPaidBy(e) ? 'paid by ' + esc(e.who || 'someone') : 'borrowed'}</span>` : ''}
        ${e.category ? `<span><i class="cat-dot" style="background:${FIN_COLORS[e.category] || '#777'}"></i> ${esc(e.category)}</span>` : ''}${e.recurring ? '<span>🔁 monthly</span>' : ''}
        ${finRoute(e)}${part ? `<span>${fmtMoney(e.paidAmount)} paid back</span>` : ''}${e.settled && isUdh(e) ? '<span class="pos">settled</span>' : ''}</div></div>
    <div class="row-end"><span class="amt ${cls}">${sign}${fmtMoney(e.amount)}</span></div></div>`, '', 'Delete 🗑', `data-fin="${e.id}"`);
}
function wireFinRows(root) {
  $$('[data-fin]', root).forEach(w => { const id = w.dataset.fin; bindSwipe(w, null, () => deleteWithUndo(id)); bindHold(w, 'fin', id); onTap(w, () => openFin(id)); });
}
/* v2.19 (B2): one rule everywhere — spending in the "Investment" category is money put into investments, shown on its own line, not as spending */
/* v2.26: transfers into a mutual fund / FD set to count as investment count too (money taken out is subtracted) */
const invCounts = a => !!a && isInvest(a.kind) && (a.invCount != null ? !!a.invCount : a.kind === 'mf');
function monthFigures(list) {
  let inc = 0, out = 0, inv = 0;
  list.forEach(e => { const a = +e.amount || 0; if (e.kind === 'income') inc += a; else if (e.kind === 'expense') { if (e.category === 'Investment') inv += a; else out += a; }
    else if (e.kind === 'transfer' && typeof acctById === 'function') { const t = invCounts(acctById(e.to)), f = invCounts(acctById(e.acct)); if (t && !f) inv += a; else if (f && !t) inv -= a; } });
  return { inc, out, inv, net: inc - out };
}
/* account balances as chips (Bank · Cash · Card dues, then each account) — same figures as Accounts and the dashboard */
let stripCache = { ver: -1, day: '', html: '' };
function renderAcctStrip() {
  const box = $('acctStrip'); if (!box) return;
  const c = planCfg(), t = todayISO();
  if (!c || !accts().length) { box.innerHTML = `<button class="ac-chip ac-setup" id="acSetupGo"><span>Balances</span><b>Set up accounts ›</b></button>`; $('acSetupGo').addEventListener('click', () => { setPref('moneySeg', 'accts'); renderMoney(); }); return; }
  if (stripCache.ver !== storeVer || stripCache.day !== t || !stripCache.html) {
    let B; try { B = balancesOn(c, t); } catch (e) { RLOG.warn('strip', e.message); box.innerHTML = ''; return; }
    const chip = (attrs, k, v, cls) => `<button class="ac-chip ${cls || ''}" ${attrs}><span>${k}</span><b>${v}</b></button>`;
    const tot = [chip('data-acs="bank"', 'Bank', rsShort(B.bank), B.bank < 0 ? 'neg' : ''), chip('data-acs="cash"', 'Cash', rsShort(B.cash), B.cash < 0 ? 'neg' : ''),
      ...(B.card ? [chip('data-acs="card"', 'Card dues', '−' + rsShort(B.card), 'neg')] : []), ...(Math.abs(B.invest) >= 1 ? [chip('data-acs="invest"', 'Investments', rsShort(B.invest))] : [])];
    const each = accts().filter(a => a.kind !== 'loan').map(a => { const v = B.accts[a.id] || 0, k = bucketOf(a.kind);
      return chip(`data-acid="${a.id}"`, esc(a.name), k === 'card' ? (v < 0 ? 'due ' + rsShort(-v) : rsShort(v)) : rsShort(v), (k === 'card' && v < 0) || (k !== 'card' && v < 0) ? 'neg sub' : 'sub'); });
    stripCache = { ver: storeVer, day: t, html: tot.join('') + (each.length ? '<i class="ac-sep" aria-hidden="true"></i>' + each.join('') : '') };
  }
  box.innerHTML = stripCache.html;
  $$('[data-acs]', box).forEach(b => b.addEventListener('click', () => { setPref('moneySeg', 'accts'); renderMoney(); }));
  $$('[data-acid]', box).forEach(b => b.addEventListener('click', () => acctSheet(b.dataset.acid)));
}
function renderLedHero(M) {
  const box = $('ledHero'); if (!box) return;
  const both = M.inc + M.out, pin = both ? Math.round(M.inc / both * 1000) / 10 : 0, pout = both ? Math.round((100 - pin) * 10) / 10 : 0;
  box.innerHTML = `<div class="led-hero"><div class="lh-k">Net this month</div>
    <div class="lh-v ${M.net < 0 ? 'neg' : M.net > 0 ? 'pos' : ''}">${M.net < 0 ? '−' : ''}${rsShort(Math.abs(M.net))}</div>
    <div class="io-bar" role="img" aria-label="In ${rs(M.inc)}, out ${rs(M.out)}">${both ? `<i class="io-in" style="width:${pin}%"></i><i class="io-out" style="width:${pout}%"></i>` : ''}</div>
    <div class="io-lbl"><span><i class="dot-in"></i>In <b>${rsShort(M.inc)}</b></span><span><i class="dot-out"></i>Out <b>${rsShort(M.out)}</b></span></div>
    ${Math.abs(M.inv) >= 0.5 ? `<div class="lh-inv"><span>${M.inv < 0 ? 'Taken out of investments' : 'Into investments'}</span><b>${rsShort(Math.abs(M.inv))}</b></div>
    <div class="lh-note">Investments are not counted as spending. Counted: “Investment” spending, and transfers into accounts set to count as investment.</div>` : ''}</div>`;
}
function renderLedger() {
  $('finMonthLbl').textContent = monthLong(finMonth);
  const month = all('fin').filter(e => (e.date || '').slice(0, 7) === finMonth);
  renderAcctStrip();
  renderLedHero(monthFigures(month));
  renderLedFlags();
  renderLedgerList();
}
/* ---------- v2.21: D1 regular items not yet in the Ledger · D2 old udhaar · D3 last month's summary ---------- */
function itemDay(it) {
  const k = it.key || '', id = k.slice(k.indexOf(':') + 1);
  if (k.startsWith('r:')) { const r = records[id]; return r && +r.day || 0; }
  if (k.startsWith('sip:')) { const a = acctById(id); return a && a.sip && +a.sip.day || 0; }
  if (k.startsWith('emi:')) { const a = acctById(id); return a && +a.emiDay || 0; }
  return 0;
}
function ledgerPending(ym) {
  const c = planCfg(); if (!c || ym < c.startMonth) return [];
  const cur = isoMonth(new Date()), dom = new Date().getDate();
  let items = []; try { items = planItems(c, ym); } catch (e) { RLOG.warn('pending', e.message); return []; }
  return items.filter(it => !it.done && !it.budget && !it.extra && +it.a > 0 && it.kind !== 'udhback' && (ym < cur || !itemDay(it) || itemDay(it) <= dom));
}
const UDH_OLD_DAYS = 30;
function oldUdhaar() {
  const t = todayISO();
  return all('fin').filter(e => isUdh(e) && !e.settled && outstanding(e) > 0 && e.date && -daysUntilISO(e.date) >= UDH_OLD_DAYS)
    .map(e => ({ e, days: -daysUntilISO(e.date) })).sort((a, b) => b.days - a.days);
}
function renderLedFlags() {
  const box = $('ledFlags'); if (!box) return;
  const cur = isoMonth(new Date()), out = [];
  if (finMonth === cur) {
    const P = ledgerPending(cur);
    if (P.length) out.push(`<button class="led-flag" data-lf="pend"><span>🔁 <b>${P.length} regular item${P.length > 1 ? 's' : ''} not in the Ledger yet</b><small>${P.slice(0, 3).map(it => esc(it.label) + ' ' + rsShort(it.a)).join(' · ')}${P.length > 3 ? ' …' : ''}</small></span><i>Record ›</i></button>`);
    const O = oldUdhaar();
    if (O.length) { const tot = O.reduce((s, x) => s + (x.e.kind === 'lent' ? 1 : -1) * outstanding(x.e), 0);
      out.push(`<button class="led-flag udh" data-lf="udh"><span>⏳ <b>${O.length} udhaar open for ${UDH_OLD_DAYS}+ days</b><small>${O.slice(0, 3).map(x => `${esc(x.e.who || '?')} ${x.e.kind === 'lent' ? 'owes you' : 'you owe'} ${rsShort(outstanding(x.e))} · ${x.days} days`).join(' · ')}</small></span><i>Udhaar ›</i></button>`); }
    const prev = monthAdd(cur, -1);
    if (new Date().getDate() <= 10 && lsGet('r2_close_' + prev) !== '1' && all('fin').some(e => (e.date || '').slice(0, 7) === prev))
      out.push(`<button class="led-flag close" data-lf="close"><span>📒 <b>${esc(monthLong(prev))} — month summary</b><small>Spending, budgets, top categories and open udhaar</small></span><i>Open ›</i></button>`);
  }
  { const n = invUnlinked().length; if (n) out.push(`<button class="led-flag" data-lf="inv"><span>💹 <b>${n} investment entr${n === 1 ? 'y is' : 'ies are'} not linked to a fund</b><small>The money left your bank but is in no fund in Accounts</small></span><i>Link ›</i></button>`); }   // v2.35
  { const F = all('fin').filter(e => (e.date || '').slice(0, 7) === finMonth);                                      // v2.34: the summary of the month shown, always
    if (F.length) { const M = monthFigures(F), W = monthWalk(planCfg(), finMonth);
      out.push(`<button class="led-flag close" data-lf="sum"><span>📒 <b>${esc(monthLong(finMonth))} — where the money went</b><small>Spent ${rsShort(M.out)} · received ${rsShort(M.inc)}${W && W.ended && !W.nChecked ? ' · balances not checked yet' : ''}</small></span><i>Open ›</i></button>`); } }
  box.innerHTML = out.join('');
  $$('[data-lf]', box).forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.lf;
    if (k === 'sum') { monthClose(finMonth); return; }
    if (k === 'inv') { invLinkSheet(); return; }
    if (k === 'pend') planMonthSheet(cur);
    else if (k === 'udh') { setPref('moneySeg', 'udhaar'); renderMoney(); }
    else if (k === 'close') { const prev = monthAdd(cur, -1); lsSet('r2_close_' + prev, '1'); monthClose(prev); renderLedFlags(); }
  }));
}
/* v2.19 (B4): typing in the search box redraws only the list, a moment after you stop typing */
function renderLedgerList() {
  const entries = all('fin'), month = entries.filter(e => (e.date || '').slice(0, 7) === finMonth);
  const FQ = finFilterState(), filtering = FQ.active;
  $('finFilterDot').classList.toggle('hidden', !(filtering || FQ.allMonths));
  const shown = (FQ.allMonths ? entries.slice() : month).filter(FQ.match);
  if (!FQ.cat && (!FQ.kind || FQ.kind === 'udhaar')) entries.forEach(e => { if (!isUdh(e) || !FQ.match(e)) return;   // v2.35: money paid back is a row of its own, on its own date
    (e.pays || []).forEach((p, i) => { if (+p.amt && p.date && (FQ.allMonths || p.date.slice(0, 7) === finMonth)) shown.push({ _pay: 1, id: e.id + '|p' + i, of: e, p, date: p.date, kind: 'payback', createdAt: (e.createdAt || 0) + i + 1 }); }); });
  const LIMIT = 300, cut = shown.length > LIMIT;
  const byDay = {};
  shown.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt).slice(0, LIMIT).forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const days = Object.keys(byDay);
  const sumOf = (L, k) => L.filter(e => e.kind === k).reduce((t, e) => t + (+e.amount || 0), 0), ud = shown.filter(isUdh).length;
  $('finFSum').textContent = filtering ? (shown.length ? `${shown.length} entr${shown.length === 1 ? 'y' : 'ies'}${FQ.allMonths ? ' across all months' : ' this month'} · Spent ${fmtMoney(sumOf(shown, 'expense'))} · Received ${fmtMoney(sumOf(shown, 'income'))}${ud ? ` · ${ud} udhaar` : ''}${cut ? ` · showing the newest ${LIMIT}` : ''}` : '') : '';
  $('finFSum').classList.toggle('hidden', !$('finFSum').textContent);
  const dayHead = d => { const L = byDay[d], sp = sumOf(L, 'expense'), rc = sumOf(L, 'income');
    return `<div class="day-head"><span>${FQ.allMonths ? fmtDate(d, true) : relDay(d)}</span><span class="day-tot">${sp ? `<b class="neg">−${fmtMoney(sp)}</b>` : ''}${rc ? `<b class="pos">+${fmtMoney(rc)}</b>` : ''}</span></div>`; };
  $('finList').innerHTML = days.length ? days.map(d => `${dayHead(d)}<div class="group fin-day">${byDay[d].map(e => e._pay ? payRow(e) : finRow(e, false)).join('')}</div>`).join('')
    : filtering ? '<div class="empty"><b>No matches</b>Try a shorter word, or tick “Search all months”.</div>' : '<div class="empty"><b>Nothing this month</b>Tap + to record spending, income or udhaar.</div>';
  wireFinRows($('finList')); selPaint();
  $$('[data-finpay]', $('finList')).forEach(w => onTap(w, () => openUdhLedger(w.dataset.finpay)));
}
/* the filter lives in its own controls; locking Money clears it */
function finFilterState() {
  const q = $('finQ').value.trim().toLowerCase(), cat = $('finCatF').value, kind = $('finKindF').value, allMonths = $('finAllM').checked;
  const match = e => (!q || (String(e.desc || '') + ' ' + String(e.who || '') + ' ' + String(e.category || '')).toLowerCase().includes(q))
    && (!cat || (cat === '__none' ? !e.category : e.category === cat))
    && (!kind || (kind === 'udhaar' ? isUdh(e) : e.kind === kind));
  return { q, cat, kind, allMonths, match, active: !!(q || cat || kind) };
}
function initFinFilter() {
  $('finCatF').innerHTML = '<option value="">All categories</option>' + FIN_CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + '<option value="__none">No category</option>';
  $('finKindF').innerHTML = '<option value="">All types</option><option value="expense">Spent</option><option value="income">Received</option><option value="udhaar">Udhaar</option><option value="transfer">Transfer</option>';
  let t = null;
  $('finQ').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderLedgerList, 160); });
  ['finCatF', 'finKindF', 'finAllM'].forEach(id => $(id).addEventListener('change', renderLedgerList));
  $('finFilterBtn').addEventListener('click', () => {
    const p = $('finFilterPanel'), open = p.classList.toggle('hidden') === false;
    $('finFilterBtn').setAttribute('aria-expanded', String(open)); $('finFilterBtn').classList.toggle('on', open);
    if (open) setTimeout(() => $('finQ').focus(), 50);
  });
  $('finClearF').addEventListener('click', () => { clearFinFilter(); renderLedgerList(); });
  $('finInsBtn').addEventListener('click', openInsights);
}
function clearFinFilter() { $('finQ').value = ''; $('finCatF').value = ''; $('finKindF').value = ''; $('finAllM').checked = false; if ($('finFilterDot')) $('finFilterDot').classList.add('hidden'); }
initFinFilter();
$('finPrev').addEventListener('click', () => { finMonth = monthAdd(finMonth, -1); renderLedger(); });
monthJump('finMonthPick', () => finMonth, v => { finMonth = v; renderLedger(); });   // v2.27
$('finNext').addEventListener('click', () => { finMonth = monthAdd(finMonth, 1); renderLedger(); });

/* v2.25: Udhaar in three levels — people (net) → one person's entries (Settle here) → one entry's ledger */
const Udh = { person: null };                                              // the open person, by key (name ignoring case and extra spaces)
const udhKey = n => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase() || '(no name)';
const udhSign = e => e.kind === 'lent' ? 1 : -1;
function udhGroups() {
  const ud = all('fin').filter(isUdh), m = new Map();
  ud.forEach(e => {
    const k = udhKey(e.who);
    if (!m.has(k)) m.set(k, { k, name: '', newest: '', list: [] });
    const g = m.get(k); g.list.push(e);
    const stamp = (e.date || '') + '|' + String(e.createdAt || 0).padStart(15, '0');
    if (stamp >= g.newest) { g.newest = stamp; g.name = String(e.who || '').trim().replace(/\s+/g, ' ') || '(no name)'; }   // shown with the latest spelling
  });
  return [...m.values()].map(g => {
    const open = g.list.filter(e => !e.settled);
    return { ...g, open, done: g.list.filter(e => e.settled), bal: open.reduce((s, e) => s + udhSign(e) * outstanding(e), 0) };
  });
}
function renderUdhaar() {
  const ud = all('fin').filter(isUdh);
  const open = ud.filter(e => !e.settled);
  const owed = open.filter(e => e.kind === 'lent').reduce((s, e) => s + outstanding(e), 0);
  const owe = open.filter(youOwe).reduce((s, e) => s + outstanding(e), 0);
  $('udOwed').textContent = rsShort(owed); $('udOwe').textContent = rsShort(owe);
  { const u = owed - owe; $('udNet').textContent = (u < 0 ? '−' : u > 0 ? '+' : '') + rsShort(Math.abs(u)); $('udNet').className = 'n ' + (u < 0 ? 'neg' : u > 0 ? 'pos' : ''); }   // v2.19: moved here from the Ledger
  const G = udhGroups(), cur = Udh.person && G.find(g => g.k === Udh.person);
  if (Udh.person && !cur) Udh.person = null;
  $('udSum').classList.toggle('hidden', !!cur);
  $('udSettledFold').classList.toggle('hidden', !!cur);
  if (cur) renderUdhPerson(cur); else renderUdhPeople(G);
  const done = ud.filter(e => e.settled).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 60);
  $('udSettled').innerHTML = done.length ? done.map(e => finRow(e)).join('') : '<div class="empty">None yet.</div>';
  wireFinRows($('udSettled'));
  if (Sheets.isOpen('shUdhLed')) { if (UdhLed.person) renderUdhPersonLedger(UdhLed.person); else if (UdhLed.id) renderUdhLedger(UdhLed.id); }
}
function renderUdhPeople(G) {
  const act = G.filter(g => g.open.length).sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal) || a.name.localeCompare(b.name));
  const done = G.filter(g => !g.open.length).sort((a, b) => b.newest.localeCompare(a.newest));
  const row = g => {
    const n = g.open.length, settled = !n;
    const sub = settled ? `settled · ${g.done.length} entr${g.done.length === 1 ? 'y' : 'ies'}`
      : `${g.bal > 0.005 ? 'owes you' : g.bal < -0.005 ? 'you owe' : 'evens out'} · ${n} open entr${n === 1 ? 'y' : 'ies'}`;
    return `<button class="row udh-p${settled ? ' udh-done' : ''}" data-udp="${esc(g.k)}"><div class="avatar" aria-hidden="true">${esc(g.name.slice(0, 1).toUpperCase())}</div>
      <div class="row-main"><div class="row-title">${esc(g.name)}</div><div class="row-sub"><span>${sub}</span></div></div>
      <span class="amt ${settled || Math.abs(g.bal) < 0.005 ? '' : g.bal > 0 ? 'pos' : 'neg'}">${settled ? '₹0' : fmtMoney(g.bal)}</span><span class="chev" aria-hidden="true">›</span></button>`;
  };
  $('udList').innerHTML = (act.length ? act.map(row).join('') : '<div class="empty"><b>No open udhaar</b>Nobody owes anything right now.</div>')
    + (done.length ? `<div class="udh-sh">Settled</div>${done.map(row).join('')}` : '');
  $$('[data-udp]', $('udList')).forEach(b => b.addEventListener('click', () => { Udh.person = b.dataset.udp; renderUdhaar(); window.scrollTo(0, 0); }));
}
function renderUdhPerson(g) {
  const p = g.name, list = g.open.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')), bal = g.bal;
  const line = (e, settled) => `
        <div class="pline udh-line${settled ? ' udh-done' : ''}" data-udl="${e.id}" role="button" tabindex="0"><span class="d">${fmtDate(e.date)}${!settled && e.date && -daysUntilISO(e.date) >= UDH_OLD_DAYS ? ` <b class="warn">· ${-daysUntilISO(e.date)} days</b>` : ''} · ${esc(e.desc || '')}${isPaidBy(e) ? ' (paid for you)' : ''}${!settled && (e.paidAmount || 0) > 0 ? ` · ${fmtMoney(e.paidAmount)} back` : ''}</span>
          <span class="amt ${e.kind === 'lent' ? 'pos' : 'neg'}" style="font-size:13.5px">${fmtMoney(settled ? e.amount : outstanding(e))}</span>
          ${settled ? '<span class="tag">settled</span>' : `<button class="btn small ghost" data-settle="${e.id}">Settle</button>`}<button class="icon-btn" data-fe="${e.id}" aria-label="Edit entry" style="width:32px;height:32px;font-size:14px">✎</button></div>`;
  const done = g.done.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('udList').innerHTML = `<div class="udh-back"><button class="linkbtn" id="udBack">‹ All people</button></div>
    <div class="person">
      <div class="person-head"><div class="avatar" aria-hidden="true">${esc(p.slice(0, 1).toUpperCase())}</div>
        <div class="row-main"><div class="row-title">${esc(p)}</div><div class="row-sub">${list.length ? `${bal > 0.005 ? 'owes you' : bal < -0.005 ? 'you owe' : 'evens out'} · ${list.length} open entr${list.length > 1 ? 'ies' : 'y'}` : 'all settled'}</div></div>
        <span class="amt ${Math.abs(bal) < 0.005 ? '' : bal >= 0 ? 'pos' : 'neg'}">${fmtMoney(bal)}</span></div>
      <div class="person-lines">${list.map(e => line(e, false)).join('') || '<div class="hint" style="margin:4px 0">Nothing open.</div>'}
        ${list.length > 1 ? `<button class="linkbtn" data-settleall="1">Settle all with ${esc(p)}</button>` : ''}
        ${done.length ? `<div class="udh-sh" style="margin:10px 0 2px">Settled</div>${done.map(e => line(e, true)).join('')}` : ''}</div>
      <p class="hint" style="margin:8px 0 0 46px">Tap an entry for its ledger.</p>
      <div class="btn-row" style="margin:8px 0 0 46px">${list.length ? '<button class="btn small" id="udPay">＋ Payment</button>' : ''}<button class="btn ghost small" id="udFull">📒 Full ledger</button><button class="btn ghost small" id="udShare">⇪ Share statement</button>${typeof accts === 'function' && accts().length && planCfg() ? '<button class="btn ghost small" id="udStmt">📒 Month by month</button>' : ''}</div></div>`;
  $('udBack').addEventListener('click', () => { Udh.person = null; renderUdhaar(); });
  $('udShare').addEventListener('click', () => shareUdhStatement(g));
  $('udFull').addEventListener('click', () => openUdhPersonLedger(g.k));   // v2.26.1
  if ($('udPay')) $('udPay').addEventListener('click', () => udhPersonPaySheet(g));   // v2.35
  if ($('udStmt')) $('udStmt').addEventListener('click', () => openStatement('udh', { person: g.k }));   // v2.26
  $$('[data-settle]', $('udList')).forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); openSettle(b.dataset.settle); }));
  $$('[data-fe]', $('udList')).forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); openFin(b.dataset.fe); }));
  $$('[data-udl]', $('udList')).forEach(r => { const go = () => openUdhLedger(r.dataset.udl); r.addEventListener('click', go); r.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === r) go(); }); });
  const sa = $('udList').querySelector('[data-settleall]');
  if (sa) sa.addEventListener('click', () => udhSettleAll(p, list));
}
function udhSettleAll(p, list) {
  const settleAll = (acct, when) => {
    const snap = list.map(e => ({ id: e.id, paid: e.paidAmount || 0, pays: (e.pays || []).slice(), settled: !!e.settled })), today = when || todayISO();
    list.forEach(e => { const rest = outstanding(e); if (rest > 0) e.pays = (e.pays || []).concat([acct ? { date: today, amt: +rest.toFixed(2), acct } : { date: today, amt: +rest.toFixed(2) }]); e.paidAmount = e.amount; e.settled = true; put(e, { render: false }); });
    scheduleRender();
    toast(`Settled everything with ${p}.`, 'Undo', () => snap.forEach(s => { const e = records[s.id]; e.paidAmount = s.paid; e.pays = s.pays; e.settled = s.settled; put(e); }));
  };
  if (typeof accts === 'function' && accts().length && typeof planSheet === 'function') {
    const net = list.reduce((s, e) => s + udhSign(e) * outstanding(e), 0);
    planSheet('Settle all with ' + p, `<p class="hint">${net >= 0 ? `${esc(p)} pays you ${fmtMoney(net)}` : `You pay ${esc(p)} ${fmtMoney(-net)}`} for ${list.length} entries.</p>
      <div class="field"><label>${net >= 0 ? 'Received into' : 'Paid from'}</label><select id="saAcct">${acctOptions(lastAcct('udhaar') || defAcct(planCfg()), a => isLiquid(a.kind) || a.kind === 'card')}</select></div>
      <div class="field"><label>Date</label><input type="date" id="saDate" value="${todayISO()}" max="${todayISO()}"></div>`,
      () => { const w = $('saDate').value || todayISO(), last = list.reduce((m, e) => (e.date || '') > m ? e.date : m, '');
        if (!payDateOk(w, last)) { planMsg(w > todayISO() ? 'The date cannot be in the future.' : 'The date cannot be before the latest entry (' + fmtDate(last, true) + ').', true); return false; }
        rememberAcct('udhaar', $('saAcct').value); settleAll($('saAcct').value, w); return true; }, 'Settle all');
  } else { if (!confirm(`Mark all ${list.length} entries with ${p} as settled?`)) return; settleAll(null); }
}
/* One entry's ledger: the udhaar amount, each settlement, and what is left after each. */
function udhLedgerRows(e) {
  const who = e.who || 'them', rows = [];
  const first = e.kind === 'lent' ? `Given to ${who}` : isPaidBy(e) ? `${who} paid for you` : `Borrowed from ${who}`;
  rows.push({ date: e.date || '', what: first + (e.desc ? ' — ' + e.desc : ''), udh: +e.amount || 0, set: 0 });
  const pays = (e.pays || []).filter(p => +p.amt).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const back = e.kind === 'lent' ? 'Received back' : 'Paid back';
  const diff = +((e.paidAmount || 0) - pays.reduce((s, p) => s + (+p.amt || 0), 0)).toFixed(2);
  if (diff > 0.005) rows.push({ date: '', what: back + ' (date not recorded)', udh: 0, set: diff, pi: -1 });   // usually paid before payments were recorded with a date
  pays.forEach(p => rows.push({ pi: (e.pays || []).indexOf(p), date: p.date || '', what: back + (p.acct && acctById(p.acct) ? ' · ' + acctName(p.acct) : '') + (p.planRef ? ' (instalment)' : ''), udh: 0, set: +p.amt }));
  if (diff < -0.005) rows.push({ date: '', what: 'Correction (amount edited)', udh: 0, set: diff });
  let left = 0; rows.forEach(r => { left += r.udh - r.set; r.left = left; });
  return rows;
}
/* v2.26.1: an "Extra when settling" entry and the entry it came from. New extras store origin; older ones are found by person, type and date. */
function udhOriginOf(x) {
  if (!x || !udhIsExtra(x)) return null;
  if (x.origin) return records[x.origin] && !records[x.origin].deleted ? records[x.origin] : null;
  const k = udhKey(x.who), want = x.kind === 'lent' ? (e => e.kind === 'borrowed' || isPaidBy(e)) : (e => e.kind === 'lent');
  const c = all('fin').filter(e => e.id !== x.id && isUdh(e) && udhKey(e.who) === k && want(e) && e.settled && (e.date || '') <= (x.date || '9'));
  return c.find(e => (e.pays || []).some(p => p.date === x.date)) || c.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null;
}
const udhExtrasOf = e => all('fin').filter(x => udhIsExtra(x) && udhOriginOf(x) === e);
const UdhLed = { id: null, person: null };
function openUdhLedger(id) { UdhLed.id = id; UdhLed.person = null; renderUdhLedger(id); if (!Sheets.isOpen('shUdhLed')) Sheets.open('shUdhLed'); }
function openUdhPersonLedger(k) { UdhLed.id = null; UdhLed.person = k; renderUdhPersonLedger(k); if (!Sheets.isOpen('shUdhLed')) Sheets.open('shUdhLed'); }
function renderUdhLedger(id) {
  if (UdhLed.person) return renderUdhPersonLedger(UdhLed.person);
  const e = records[id]; if (!e || e.deleted) { Sheets.close('shUdhLed'); return; }
  const rows = udhLedgerRows(e), tu = rows.reduce((s, r) => s + r.udh, 0), ts = rows.reduce((s, r) => s + r.set, 0), rem = outstanding(e);
  const o = udhOriginOf(e), extras = udhExtrasOf(e);
  let chain = '';
  if (o) {   // this entry is the extra paid over what was owed: show where it came from
    const or = udhLedgerRows(o), lastPay = (o.pays || []).filter(p => p.date === e.date).reduce((t, p) => t + (+p.amt || 0), 0);
    const paidWord = o.kind === 'lent' ? `${esc(o.who || 'They')} paid you` : 'You paid';
    chain = `<div class="group udh-chain"><div class="udh-sh" style="padding:0 0 4px">How this started</div>
      <div class="tw"><table class="pt udh-led"><tbody>${or.map(r => `<tr><td>${r.date ? fmtDate(r.date) : '—'}</td><td>${esc(r.what)}</td><td>${r.udh ? rs(r.udh) : '–'}</td><td>${r.set ? rs(r.set) : '–'}</td><td>${rs(r.left)}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint" style="margin:6px 0 0">${e.date ? fmtDate(e.date) + ': ' : ''}${paidWord} <b>${esc(fmtMoney(lastPay + (+e.amount || 0)))}</b> — ${esc(fmtMoney(lastPay))} settled that, and the extra <b>${esc(fmtMoney(e.amount))}</b> became this entry (${e.kind === 'lent' ? `${esc(e.who || 'they')} now owes you` : 'you now owe'}).</p>
      <button class="linkbtn" data-ulopen="${o.id}">Open the first entry ›</button></div>`;
  }
  const carried = extras.map(x => `<p class="hint" style="margin:6px 0 0">${x.date ? fmtDate(x.date) + ': ' : ''}${esc(fmtMoney(x.amount))} more than owed was paid — it became a new entry (${x.kind === 'lent' ? `${esc(x.who || 'they')} owes you` : 'you owe'} ${esc(fmtMoney(outstanding(x)))} on it now). <button class="linkbtn" data-ulopen="${x.id}" style="display:inline;padding:0">Open ›</button></p>`).join('');
  $('ulTitle').textContent = e.who || 'Udhaar';
  $('ulBody').innerHTML = `${chain}<div class="fin-sum fin-sum3" style="margin:0 0 10px">
      <div class="stat"><div class="n">${rsShort(tu)}</div><div class="l">Udhaar</div></div>
      <div class="stat"><div class="n pos">${rsShort(ts)}</div><div class="l">Settled</div></div>
      <div class="stat"><div class="n ${rem > 0.005 ? (e.kind === 'lent' ? 'pos' : 'neg') : ''}">${rsShort(rem)}</div><div class="l">Remaining</div></div></div>
    <div class="tw"><table class="pt udh-led"><thead><tr><th>Date</th><th>Particulars</th><th>Udhaar</th><th>Settled</th><th>Remaining</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.date ? fmtDate(r.date) : '—'}${r.pi != null ? ` <button class="linkbtn" data-ulpay="${r.pi}" style="display:inline;padding:0" aria-label="${r.date ? 'Change the date' : 'Set the date'}">${r.date ? '✎' : 'Set date'}</button>` : ''}</td><td>${esc(r.what)}</td><td>${r.udh ? rs(r.udh) : '–'}</td><td>${r.set ? rs(r.set) : '–'}</td><td>${rs(r.left)}</td></tr>`).join('')}
      <tr class="tot"><td></td><td><b>Total</b></td><td><b>${rs(tu)}</b></td><td><b>${rs(ts)}</b></td><td><b>${rs(Math.max(0, tu - ts))}</b></td></tr></tbody></table></div>
    <div id="ulPayEd"></div>
    ${carried}
    <p class="hint">${e.settled ? 'Fully settled.' : e.kind === 'lent' ? `${esc(e.who || 'They')} still owes you ${esc(fmtMoney(rem))}.` : `You still owe ${esc(e.who || 'them')} ${esc(fmtMoney(rem))}.`} To record a payment, use Settle on the person's screen.</p>
    <button class="btn ghost small" data-ulperson="${esc(udhKey(e.who))}">📒 Full ledger with ${esc(e.who || 'them')}</button>`;
  udhLedWire();
}
function udhLedWire() {
  $$('[data-ulopen]', $('ulBody')).forEach(b => b.addEventListener('click', () => openUdhLedger(b.dataset.ulopen)));
  $$('[data-ulperson]', $('ulBody')).forEach(b => b.addEventListener('click', () => openUdhPersonLedger(b.dataset.ulperson)));
  $$('[data-ulentry]', $('ulBody')).forEach(b => b.addEventListener('click', () => openUdhLedger(b.dataset.ulentry)));
  $$('[data-ulpay]', $('ulBody')).forEach(b => b.addEventListener('click', () => udhPayDateEdit(UdhLed.id, +b.dataset.ulpay)));   // v2.35
}
/* v2.26.1: everything with one person by date, one running balance (+ they owe you, − you owe). A payment that went over
   what was owed shows as one payment, split into the part that settled and the extra. */
function udhPersonRows(k) {
  const ents = all('fin').filter(e => isUdh(e) && udhKey(e.who) === k), ev = [];
  const merged = new Set();
  ents.forEach(e => {
    const s = udhSign(e), amt = +e.amount || 0, who = String(e.who || '').trim();
    const o = udhOriginOf(e);
    if (o && udhKey(o.who) === k) {                                          // extra: joined to the payment it came from
      const p = (o.pays || []).filter(p => p.date === e.date);
      if (p.length) { merged.add(e.id); const part = p.reduce((t, x) => t + (+x.amt || 0), 0);
        ev.push({ date: e.date, ord: 2, ca: e.createdAt || 0, v: s * amt, what: `${o.kind === 'lent' ? 'Received back' : 'Paid back'} ${fmtMoney(part + amt)} (${fmtMoney(part)} settled · ${fmtMoney(amt)} extra${s > 0 ? ' — now owed to you' : ' — now you owe'})`, id: e.id, extra: part }); return; }
    }
    ev.push({ date: e.date || '', ord: 0, ca: e.createdAt || 0, v: s * amt, what: (e.kind === 'lent' ? 'Given' : isPaidBy(e) ? `${who} paid for you` : 'Borrowed') + (e.desc && !udhIsExtra(e) ? ' — ' + e.desc : udhIsExtra(e) ? ' — extra when settling' : ''), id: e.id });
    const pays = (e.pays || []).filter(p => +p.amt), back = e.kind === 'lent' ? 'Received back' : 'Paid back';
    pays.forEach(p => ev.push({ date: p.date || e.date || '', ord: 1, ca: e.createdAt || 0, v: -s * (+p.amt || 0), what: back + (p.planRef ? ' (instalment)' : ''), id: e.id, pay: p, of: e }));
    const rest = +((e.paidAmount || 0) - pays.reduce((t, p) => t + (+p.amt || 0), 0)).toFixed(2);
    if (Math.abs(rest) > 0.005) ev.push({ date: e.date || '', ord: 1, ca: e.createdAt || 0, v: -s * rest, what: back + ' (date not recorded)', id: e.id });
    if (e.settled) { const gap = +(amt - (e.paidAmount || 0)).toFixed(2); if (Math.abs(gap) > 0.005) ev.push({ date: e.date || '', ord: 1, ca: e.createdAt || 0, v: -s * gap, what: 'Marked settled', id: e.id }); }
  });
  // the settling part of a merged payment is already inside the merged row
  const out = ev.filter(x => !(x.pay && ents.some(m => merged.has(m.id) && udhOriginOf(m) === x.of && m.date === x.pay.date)))
    .map(x => { if (x.extra != null) x.v = udhSign(records[x.id]) * (+records[x.id].amount || 0) + -udhSign(udhOriginOf(records[x.id])) * x.extra; return x; });
  out.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.ord - b.ord || a.ca - b.ca);
  let bal = 0; out.forEach(x => { bal += x.v; x.bal = bal; });
  return out;
}
function renderUdhPersonLedger(k) {
  const g = udhGroups().find(x => x.k === k); if (!g) { Sheets.close('shUdhLed'); return; }
  const rows = udhPersonRows(k), gave = rows.reduce((t, r) => t + Math.max(0, r.v), 0), got = rows.reduce((t, r) => t + Math.max(0, -r.v), 0), bal = rows.length ? rows[rows.length - 1].bal : 0;
  const bw = v => Math.abs(v) < 0.005 ? 'settled' : v > 0 ? `owes you ${rs(v)}` : `you owe ${rs(-v)}`;
  $('ulTitle').textContent = g.name + ' · ledger';
  $('ulBody').innerHTML = `<div class="fin-sum fin-sum3" style="margin:0 0 10px">
      <div class="stat"><div class="n">${rsShort(gave)}</div><div class="l">You gave</div></div>
      <div class="stat"><div class="n">${rsShort(got)}</div><div class="l">You got</div></div>
      <div class="stat"><div class="n ${bal > 0.005 ? 'pos' : bal < -0.005 ? 'neg' : ''}">${rsShort(Math.abs(bal))}</div><div class="l">${Math.abs(bal) < 0.005 ? 'Settled' : bal > 0 ? 'Owes you' : 'You owe'}</div></div></div>
    <div class="tw"><table class="pt udh-led udh-pled"><thead><tr><th>Date</th><th>Particulars</th><th>You gave</th><th>You got</th><th>Balance</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-ulentry="${r.id}"><td>${r.date ? fmtDate(r.date) : '—'}</td><td>${esc(r.what)}</td><td>${r.v > 0 ? rs(r.v) : '–'}</td><td>${r.v < 0 ? rs(-r.v) : '–'}</td><td class="${r.bal > 0.005 ? 'pos' : r.bal < -0.005 ? 'neg' : ''}">${esc(bw(r.bal))}</td></tr>`).join('')}
      <tr class="tot"><td></td><td><b>Total</b></td><td><b>${rs(gave)}</b></td><td><b>${rs(got)}</b></td><td><b>${esc(bw(bal))}</b></td></tr></tbody></table></div>
    <p class="hint">“You gave” = udhaar you gave and money you paid back. “You got” = udhaar you took and money paid back to you. Tap a row for that entry.</p>`;
  udhLedWire();
}
Sheets.onClose.shUdhLed = () => { UdhLed.id = null; UdhLed.person = null; };
/* Plain-text statement for one person, to send on WhatsApp or anywhere. */
function udhStatementText(g) {
  const L = [`Udhaar statement — ${g.name}`, `As on ${fmtDate(todayISO(), true)}`, ''];
  const ents = g.list.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  ents.forEach((e, i) => {
    const head = e.kind === 'lent' ? 'I gave' : isPaidBy(e) ? 'You paid for me' : 'I borrowed';
    L.push(`${i + 1}. ${fmtDate(e.date)} · ${head} ${fmtMoney(e.amount)}${e.desc ? ' (' + e.desc + ')' : ''}`);
    udhLedgerRows(e).slice(1).forEach(r => L.push(`   ${r.date ? fmtDate(r.date) : '—'} · ${r.what.replace(/ · .*$/, '')} ${fmtMoney(r.set)}`));
    L.push(`   ${e.settled ? 'Settled' : 'Remaining ' + fmtMoney(outstanding(e))}`);
  });
  const b = g.bal;
  L.push('', Math.abs(b) < 0.005 ? 'Net: nothing due either way.' : b > 0 ? `Net: you owe me ${fmtMoney(b)}.` : `Net: I owe you ${fmtMoney(-b)}.`);
  return L.join('\n');
}
async function shareUdhStatement(g) {
  const text = udhStatementText(g);
  try { if (navigator.share) { await navigator.share({ title: 'Udhaar — ' + g.name, text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Statement copied — paste it anywhere.'); } catch (e) { toast('Sharing is not available here.'); }
}
let settleId = null;
function openSettle(id) {
  const e = records[id]; if (!e) return;
  settleId = id;
  $('stHint').textContent = 'Leave the full amount to settle it, type a smaller part-payment, or a larger amount if more changed hands.';
  { const has = typeof accts === 'function' && accts().length; $('stAcctWrap').classList.toggle('hidden', !has);
    if (has) { $('stAcctLbl').textContent = e.kind === 'lent' ? 'Received into' : 'Paid from'; $('stAcct').innerHTML = acctOptions(e.acct || lastAcct('udhaar') || defAcct(planCfg()), a => !isInvest(a.kind) && a.kind !== 'loan'); } }
  $('stTitle').textContent = e.kind === 'lent' ? `${e.who || 'They'} paid back` : `You paid ${e.who || ''}`.trim();
  $('stSub').textContent = `${e.desc || ''} · outstanding ${fmtMoney(outstanding(e))}`;
  $('stAmt').value = outstanding(e);
  if ($('stDate')) { $('stDate').value = todayISO(); $('stDate').max = todayISO(); $('stDate').min = e.date || ''; }   // v2.35
  Sheets.open('shSettle');
}
$('stOk').addEventListener('click', () => {
  const e = records[settleId]; if (!e) return;
  const when = $('stDate') && $('stDate').value ? $('stDate').value : todayISO();   // v2.35: the day the money actually moved
  if (!payDateOk(when, e.date)) { toast(when > todayISO() ? 'The date cannot be in the future.' : 'The date cannot be before the udhaar itself (' + fmtDate(e.date, true) + ').'); return; }
  const rem = outstanding(e); let amt = calcAmount($('stAmt').value);
  if (isNaN(amt) || amt <= 0) amt = rem;
  const over = amt > rem + 0.005 ? +(amt - rem).toFixed(2) : 0;
  amt = Math.min(amt, rem);
  const prev = { paid: e.paidAmount || 0, settled: !!e.settled };
  const stAcct = !$('stAcctWrap').classList.contains('hidden') ? $('stAcct').value : null;
  e.paidAmount = +(((e.paidAmount || 0) + amt).toFixed(2));
  if (e.paidAmount >= e.amount - 0.005) { e.paidAmount = e.amount; e.settled = true; }
  const prevPays = (e.pays || []).slice();
  e.pays = prevPays.concat([stAcct ? { date: when, amt, acct: stAcct } : { date: when, amt }]);   // v2.35: always dated, with or without an account
  put(e); Sheets.close('shSettle');
  let extraId = null;
  if (over) extraId = put({ id: uid('f'), type: 'fin', origin: e.id, desc: 'Extra when settling' + (e.desc ? ': ' + e.desc : ''), amount: over, kind: e.kind === 'lent' ? 'borrowed' : 'lent',
    category: '', date: when, who: e.who || '', acct: stAcct || undefined, recurring: false, paidAmount: 0, settled: false, deleted: false }).id;
  const undo = () => { e.paidAmount = prev.paid; e.settled = prev.settled; e.pays = prevPays; put(e); if (extraId) softDelete(extraId); };
  if (over) toast(`Settled. ${fmtMoney(over)} extra recorded as ${e.kind === 'lent' ? 'you owe ' : 'owed to you by '}${e.who || 'them'}.`, 'Undo', undo, 7000);
  else toast(e.settled ? 'Settled in full.' : `${fmtMoney(amt)} recorded — ${fmtMoney(outstanding(e))} still open.`, 'Undo', undo);
});

function budgets() { const b = {}; all('budget').forEach(x => { if (x.amount > 0) b[x.category] = x.amount; }); return b; }
function renderBudgets() {
  $('budMonthLbl').textContent = monthLong(budMonth);
  const month = all('fin').filter(e => e.kind === 'expense' && (e.date || '').slice(0, 7) === budMonth);
  const byCat = {}; month.forEach(e => { const c = e.category || 'Other'; byCat[c] = (byCat[c] || 0) + e.amount; });
  const bud = budgets();
  const cats = [...new Set([...Object.keys(byCat), ...Object.keys(bud)])].sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));
  const max = Math.max(1, ...Object.values(byCat));
  $('budBars').innerHTML = cats.length ? cats.map(c => {
    const spent = byCat[c] || 0, cap = bud[c] || 0, over = cap && spent > cap;
    const pct = cap ? Math.min(100, Math.round(spent / cap * 100)) : Math.round(spent / max * 100);
    return `<div class="bar-row"><div class="bar-lbl"><span>${esc(c)}${over ? ' ⚠' : ''}</span><span class="${over ? 'neg' : ''}">${fmtMoney(spent)}${cap ? ' / ' + fmtMoney(cap) : ''}</span></div>
      <div class="bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(c)}"><div class="bar-fill" style="width:${pct}%;background:${over ? 'var(--neg)' : FIN_COLORS[c] || '#77818E'}"></div></div></div>`;
  }).join('') : '<div class="empty">No spending recorded this month.</div>';
}
$('budPrev').addEventListener('click', () => { budMonth = monthAdd(budMonth, -1); renderBudgets(); });
monthJump('budMonthPick', () => budMonth, v => { budMonth = v; renderBudgets(); });
$('budNext').addEventListener('click', () => { budMonth = monthAdd(budMonth, 1); renderBudgets(); });
$('budSetBtn').addEventListener('click', () => {
  chipGroup($('bgCat'), FIN_CATS.filter(c => c !== 'Salary'), 'Household', v => { const b = all('budget').find(x => x.category === v); $('bgAmt').value = b ? b.amount : ''; });
  const b = all('budget').find(x => x.category === 'Household'); $('bgAmt').value = b ? b.amount : '';
  Sheets.open('shBudget');
});
$('bgSave').addEventListener('click', () => {
  const c = chipValue($('bgCat')), a = calcAmount($('bgAmt').value);
  if (isNaN(a) || a < 0) { toast('Enter an amount.'); return; }
  const ex = all('budget').find(x => x.category === c);
  if (ex) { ex.amount = a; put(ex); } else put({ id: uid('b'), type: 'budget', category: c, amount: a, deleted: false });
  Sheets.close('shBudget'); toast(a ? `${c} budget: ${fmtMoney(a)} a month.` : `${c} budget removed.`);
});
$('finCsvBtn').addEventListener('click', () => {
  const rows = [['Date', 'Description', 'Type', 'Category', 'Person', 'Amount', 'Paid back', 'Outstanding', 'Settled']];
  all('fin').sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(e => rows.push([e.date, e.desc, e.kind, e.category || '', e.who || '', e.amount, e.paidAmount || 0, isUdh(e) ? outstanding(e) : '', e.settled ? 'yes' : 'no']));
  const safe = c => typeof c === 'string' && /^[=+\-@\t\r]/.test(c) ? "'" + c : c;     // v2.18: Excel would run a cell that starts with = + - @ as a formula
  const csv = rows.map((r, i) => r.map(c => `"${String(c == null ? '' : i ? safe(c) : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  shareOrDownload('﻿' + csv, 'register-ledger-' + todayISO() + '.csv', 'text/csv');
});

