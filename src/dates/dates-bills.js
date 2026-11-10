/* ==========================================================================
   KEY DATES + BILLS & INSTALMENTS
   A bill is the standing commitment; a billpay record exists only once a
   period is settled (paid or skipped) — any due period without one is pending.
   ======================================================================== */
const FIN_CATS = ['Household', 'Bills', 'Travel', 'Food', 'Health', 'Education', 'Investment', 'Salary', 'Other'];
const FIN_COLORS = { Household: '#1B4B8F', Bills: '#9C2963', Travel: '#B8860B', Food: '#B45309', Health: '#2E7D50', Education: '#3F4F8C', Investment: '#6b3f5c', Salary: '#2E7D50', Other: '#77818E', '': '#77818E' };
let billMonth = isoMonth(new Date());

/* ---------- key dates ---------- */
function nextOccurrence(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const w = new Date(d.when + 'T00:00:00'); if (isNaN(w)) return today;
  const day = w.getDate(), base = new Date(w);
  const step = REP_MONTHS[d.repeat];
  if (step) { for (let k = 1; w < today && k < 6000; k++) { const x = addMonthsKeep(base, step * k, day); w.setTime(x.getTime()); } }
  return w;
}
function countHtml(days, pastWord) {
  const cls = days < 0 ? 'past' : days <= 3 ? 'now' : days <= 14 ? 'soon' : '';
  const big = days < 0 ? '—' : days === 0 ? 'Today' : days;
  const unit = days < 0 ? (pastWord || 'passed') : days === 0 ? '' : days === 1 ? 'day' : 'days';
  return `<div class="count ${cls}" aria-label="${days < 0 ? pastWord || 'passed' : days === 0 ? 'today' : days + ' days'}">${big}<small>${unit}</small></div>`;
}
function renderDatesOld() {}

let editDateId = null;
function openDate(id) {
  const d = records[id]; if (!d) return;
  editDateId = id;
  $('deLabel').value = d.label; $('deWhen').value = d.when || ''; $('deRepeat').value = d.repeat || 'once';
  $('deCat').innerHTML = dateCats().map(c => `<option value="${c[0]}"${c[0] === dateCat(d) ? ' selected' : ''}>${c[2]} ${esc(c[1])}</option>`).join('');
  $('deLead').innerHTML = `<option value="0">As its category (${catLead(dateCat(d)) || +(prefs.dateSoonDays || 30)} days)</option>` + LEAD_OPTS.map(n => `<option value="${n}"${+d.lead === n ? ' selected' : ''}>${n} days ahead</option>`).join('');
  const w = d.when ? isoLocal(nextOccurrence(d)) : '', age = w ? dateAge(d, w) : '';
  $('deInfo').textContent = w ? `Next: ${fmtDate(w, true)} (${inDays(daysTo(w))})${age ? ', ' + age : ''}${d.docRef && records[d.docRef] ? ' · linked to the document “' + records[d.docRef].title + '”' : ''}` : 'No date yet — pick one above.';
  $('deIcs').textContent = inCal(d) ? `✓ In iPhone Calendar (sent ${fmtDate(d.calOn)}) — send again` : '📅 Add to iPhone Calendar (reminds you)';
  const tk = dateTask(d); $('deTask').textContent = tk ? '☑ In Tasks — open it' : '☑ Add as a task'; $('deTask').disabled = !d.when && !tk;
  Sheets.open('shDate');
}
$('deSave').addEventListener('click', () => {
  const d = records[editDateId]; if (!d) return;
  d.label = $('deLabel').value.trim() || d.label; d.when = $('deWhen').value || d.when || ''; d.repeat = $('deRepeat').value; d.cat = $('deCat').value; if (d.when) delete d.needsDetail;
  { const L = +$('deLead').value; if (L) d.lead = L; else delete d.lead; }
  const doc = d.docRef && records[d.docRef]; if (doc && d.when && dateCat(d) === 'docexp' && doc.expiry !== d.when) { doc.expiry = d.when; put(doc, { render: false }); }
  put(d); Sheets.close('shDate'); toast('Saved.');
});
$('deDelete').addEventListener('click', () => { const id = editDateId; Sheets.close('shDate', true); deleteWithUndo(id); });
$('deTask').addEventListener('click', () => { const d = records[editDateId]; if (!d) return; const tk = dateTask(d); Sheets.close('shDate', true); if (tk) { showTab('tasks'); openTaskEditor(tk.id); } else dateToTask(d.id); });

/* ---------- bills ---------- */
function billDueIn(b, ym) {
  const start = b.startMonth || isoMonth(new Date(b.createdAt));
  const diff = monthDiff(start, ym);
  if (diff < 0 || diff % (b.freq || 1) !== 0) return false;
  if (b.total && diff / (b.freq || 1) >= b.total) return false;
  return true;
}
let payIdx = null, payIdxVer = -1;
function payIndex() {
  if (payIdx && payIdxVer === storeVer) return payIdx;
  payIdx = { at: new Map(), paid: new Map() }; payIdxVer = storeVer;
  all('billpay').forEach(p => { payIdx.at.set(p.billId + '|' + p.period, p); if (p.status === 'paid') payIdx.paid.set(p.billId, (payIdx.paid.get(p.billId) || 0) + 1); });
  return payIdx;
}
const payFor = (bid, ym) => payIndex().at.get(bid + '|' + ym);
const billPaidCount = b => payIndex().paid.get(b.id) || 0;
function overduePeriods(b, upto) {
  const start = b.startMonth || isoMonth(new Date(b.createdAt)), out = [];
  for (let ym = start; monthDiff(ym, upto) > 0; ym = monthAdd(ym, 1)) if (billDueIn(b, ym) && !payFor(b.id, ym)) out.push(ym);
  return out;
}
function pendingCount() {
  const now = isoMonth(new Date()); let n = 0;
  all('bill').forEach(b => { if (billDueIn(b, now) && !payFor(b.id, now)) n++; n += overduePeriods(b, now).length; });
  return n;
}
let billSeen = isoMonth(new Date());
function renderBills() {
  { const nowM = isoMonth(new Date()); if (nowM !== billSeen) { if (billMonth === billSeen) billMonth = nowM; billSeen = nowM; } }   // new month while the app stayed open
  $('billMonthLbl').textContent = monthLong(billMonth);
  const now = isoMonth(new Date()), bills = all('bill'), rows = [];
  if (billMonth === now) bills.forEach(b => overduePeriods(b, now).forEach(ym => rows.push({ b, ym, state: 'overdue' })));
  bills.forEach(b => { if (!billDueIn(b, billMonth)) return; const p = payFor(b.id, billMonth); rows.push({ b, ym: billMonth, state: p ? (p.status === 'skipped' ? 'skipped' : 'paid') : 'pending', pay: p }); });
  // pending first (by due day), then settled
  const order = { overdue: 0, pending: 1, paid: 2, skipped: 3 };
  rows.sort((a, c) => order[a.state] - order[c.state] || (a.b.dueDay || 99) - (c.b.dueDay || 99));
  const day = new Date().getDate();
  $('billList').innerHTML = rows.length ? rows.map(r => {
    const b = r.b, paidN = billPaidCount(b);
    const hist = []; for (let i = 5; i >= 0; i--) { const ym = monthAdd(now, -i); if (!billDueIn(b, ym)) { hist.push(''); continue; } const p = payFor(b.id, ym); hist.push(p ? (p.status === 'skipped' ? 's' : 'p') : (ym === now ? '' : 'm')); }
    const amt = r.pay && r.pay.status === 'paid' ? r.pay.amount : b.amount;
    const dueD = b.dueDay ? Math.min(b.dueDay, new Date(+billMonth.slice(0, 4), +billMonth.slice(5, 7), 0).getDate()) : 0;
    const late = r.state === 'pending' && billMonth === now && dueD && dueD < day;
    const settled = r.state === 'paid' || r.state === 'skipped';
    return swipeHtml(`<div class="row bill ${r.state}">
      <div class="row-main"><div class="row-title">${esc(b.label)} ${r.state === 'overdue' ? `<span class="pill neg">${monthShort(r.ym)}</span>` : ''}</div>
        <div class="row-sub">${dueD ? `<span class="${late ? 'warn' : ''}">due ${ordinal(dueD)}</span>` : ''}<span>${b.freq == 1 ? 'monthly' : 'every ' + b.freq + ' months'}</span>
          ${b.total ? `<span>${paidN}/${b.total} paid</span>` : ''}${r.state === 'paid' && r.pay ? `<span class="pos">✓ paid ${fmtDate(r.pay.paidOn)}</span>` : ''}${r.state === 'skipped' ? '<span>skipped</span>' : ''}${r.pay && r.pay.postPending ? '<span class="warn">money entry waiting</span>' : ''}</div>
        ${b.total ? `<div class="emi"><i style="width:${Math.min(100, Math.round(paidN / b.total * 100))}%"></i></div>` : ''}
        <div class="hist" aria-hidden="true">${hist.map(h => `<i class="${h}"></i>`).join('')}</div></div>
      <div class="row-end"><span class="amt">${amt ? fmtMoney(amt) : '—'}</span>
        ${settled ? `<button class="btn small ghost" data-unpay="${b.id}|${r.ym}">Undo</button>` : `<button class="btn small" data-pay="${b.id}|${r.ym}">Pay</button>`}</div></div>`,
      settled ? '' : '✓ Paid', '', `data-bill="${b.id}|${r.ym}"`);
  }).join('') : '<div class="empty"><b>Nothing due</b>Add electricity, rent, EMIs or insurance with +.</div>';
  { const many = billMonth === now ? bills.map(b => [b, overduePeriods(b, now)]).filter(([, l]) => l.length > 1) : [];
    if (many.length) $('billList').insertAdjacentHTML('afterbegin', many.map(([b, l]) => `<button class="linkbtn bill-bulk" data-bulk="${b.id}">Mark ${l.length} earlier months of ${esc(b.label)} as paid</button>`).join(''));
    $$('[data-bulk]', $('billList')).forEach(x => x.addEventListener('click', () => bulkPaid(x.dataset.bulk))); }
  $$('[data-bill]', $('billList')).forEach(w => {
    const [id, ym] = w.dataset.bill.split('|'); const settled = !!payFor(id, ym);
    bindSwipe(w, settled ? null : () => settlePay(id, ym, 'paid', null), null);
    onTap(w, e => {
      if (e.target.closest('[data-pay]')) return askPay(id, ym);
      if (e.target.closest('[data-unpay]')) return undoPay(id, ym);
      openBill(id);
    });
  });
}
$('billPrev').addEventListener('click', () => { billMonth = monthAdd(billMonth, -1); renderBills(); });
/* v2.27: tapping a month name opens the month wheel */
function monthJump(id, get, set) { const el = $(id); if (!el) return; const sync = () => { el.value = get(); };
  el.addEventListener('focus', sync); el.addEventListener('pointerdown', sync); el.addEventListener('change', () => { if (ymOk(el.value)) set(el.value); }); }
monthJump('billMonthPick', () => billMonth, v => { billMonth = v; renderBills(); });
$('billNext').addEventListener('click', () => { billMonth = monthAdd(billMonth, 1); renderBills(); });

let payTarget = null;
function askPay(id, ym) {
  const b = records[id]; if (!b) return;
  payTarget = { id, ym };
  $('payTitle').textContent = b.label;
  $('paySub').textContent = monthLong(ym) + (b.amount ? ' · expected ' + fmtMoney(b.amount) : '');
  $('payAmt').value = b.amount || '';
  Sheets.open('shPay');
}
function settlePay(id, ym, status, typed) {
  const b = records[id]; if (!b) return;
  const amount = status === 'paid' ? ((typed != null && !isNaN(typed) && typed > 0) ? typed : (b.amount || 0)) : 0;
  const pay = { id: uid('bp'), type: 'billpay', billId: id, period: ym, status, amount, paidOn: todayISO(), deleted: false };
  if (status === 'paid' && b.autoPost && amount > 0) {
    if (finUnlocked()) postBillToMoney(b, pay);
    else pay.postPending = true;                 // written into Money next time it is unlocked
  }
  put(pay);
  toast(status === 'paid' ? `${b.label} — marked paid${amount ? ' ' + fmtMoney(amount) : ''}.` : 'Skipped for this period.', 'Undo', () => undoPay(id, ym, true));
}
/* Mark every overdue month of a bill as paid in one go (for an EMI that started before you began using the app). Not posted to Money. */
function bulkPaid(id) {
  const b = records[id]; if (!b) return;
  const l = overduePeriods(b, isoMonth(new Date())); if (!l.length) return;
  if (!confirm(`Mark ${l.length} earlier months of "${b.label}" as paid? ${finUnlocked() ? ' They are not written into Money.' : ''}`)) return;
  const made = l.map(ym => put({ id: uid('bp'), type: 'billpay', billId: id, period: ym, status: 'paid', amount: b.amount || 0, paidOn: monthEnd(ym), bulk: true, deleted: false }, { render: false }).id);
  scheduleRender();
  toast(`${l.length} months marked paid.`, 'Undo', () => { made.forEach(x => softDelete(x, { render: false })); scheduleRender(); });
}
function retireBills() {
  const l = all('bill'); if (!l.length) return;
  l.forEach(b => put({ ...records[b.id], type: 'oldbill', retiredOn: todayISO() }, { render: false }));
  RLOG.info('bills retired (v2.8)', l.length);
}
function postBillToMoney(b, pay) {
  put({ id: uid('f'), type: 'fin', desc: b.label + ' — ' + monthShort(pay.period), amount: pay.amount, kind: 'expense', category: b.category || 'Bills',
        date: pay.paidOn, who: '', recurring: false, settled: false, billRef: b.id, deleted: false }, { render: false });
}
function flushPendingPosts() {
  all('billpay').filter(p => p.postPending).forEach(p => { const b = records[p.billId]; if (b) postBillToMoney(b, p); delete p.postPending; put(p, { render: false }); });
}
$('payOk').addEventListener('click', () => { if (!payTarget) return; Sheets.close('shPay'); settlePay(payTarget.id, payTarget.ym, 'paid', calcAmount($('payAmt').value)); });
$('paySkip').addEventListener('click', () => { if (!payTarget) return; Sheets.close('shPay'); settlePay(payTarget.id, payTarget.ym, 'skipped'); });
$('payAmt').addEventListener('keydown', e => { if (e.key === 'Enter') $('payOk').click(); });
function undoPay(id, ym, quiet) {
  const p = payFor(id, ym); if (!p) return;
  softDelete(p.id);
  if (!quiet) toast('Marked unpaid again.', 'Undo', () => restore(p.id));
}

let editBillId = null;
function openBill(id) {
  const b = records[id]; if (!b) return;
  editBillId = id;
  $('beLabel').value = b.label; $('beAmt').value = b.amount || ''; $('beDay').value = b.dueDay || '';
  $('beFreq').value = String(b.freq || 1); $('beEmi').value = b.total || '';
  $('beStart').value = b.startMonth || isoMonth(new Date(b.createdAt));
  $('beCat').innerHTML = ['', ...FIN_CATS].map(c => `<option value="${c}" ${c === (b.category || '') ? 'selected' : ''}>${c || '— none —'}</option>`).join('');
  $('bePost').checked = !!b.autoPost;
  Sheets.open('shBill');
}
$('beSave').addEventListener('click', () => {
  const b = records[editBillId]; if (!b) return;
  b.label = $('beLabel').value.trim() || b.label;
  b.amount = calcAmount($('beAmt').value) || 0; b.dueDay = Math.min(31, parseInt($('beDay').value, 10) || 0);
  b.freq = parseInt($('beFreq').value, 10) || 1; b.total = parseInt($('beEmi').value, 10) || 0;
  b.startMonth = $('beStart').value || b.startMonth; b.category = $('beCat').value; b.autoPost = $('bePost').checked;
  put(b); Sheets.close('shBill'); toast('Saved.');
});
$('beDelete').addEventListener('click', () => { const id = editBillId; Sheets.close('shBill', true); deleteWithUndo(id); });

function renderDatesTab() {
  const seg = 'dates';                                  // v2.8: Bills & EMIs moved out — Money → Recurring
  $$('#dateSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === seg));
  $('billsPane').classList.toggle('hidden', seg !== 'bills');
  $('datesPane').classList.toggle('hidden', seg !== 'dates');
  if (seg === 'bills') renderBills(); else renderDates();
}
$$('#dateSeg button').forEach(b => b.addEventListener('click', () => { setPref('dateSeg', b.dataset.v); renderDatesTab(); }));

