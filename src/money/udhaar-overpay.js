/* ==========================================================================
   UDHAAR — paying back more than is owed creates the opposite entry
   ======================================================================== */
$('stAmt').addEventListener('input', () => {
  const e = records[settleId]; if (!e) return;
  const rem = outstanding(e), amt = calcAmount($('stAmt').value), who = e.who || 'them';
  $('stHint').textContent = !isNaN(amt) && amt > rem + 0.005
    ? `${fmtMoney(amt - rem)} more than owed. It will be recorded as ${e.kind === 'lent' ? `udhaar liya: you owe ${who}` : `udhaar diya: ${who} owes you`} ${fmtMoney(amt - rem)}.`
    : 'Leave the full amount to settle it, type a smaller part-payment, or a larger amount if more changed hands.';
});

/* entry editor */
let editFinId = null;
function openFin(id) {
  const e = records[id]; if (!e) return;
  editFinId = id;
  $('feAmt').value = e.amount; $('feDesc').value = e.desc || ''; $('feWho').value = e.who || ''; $('feDate').value = e.date || '';
  $('feCat').innerHTML = ['', ...FIN_CATS].map(c => `<option value="${c}" ${c === (e.category || '') ? 'selected' : ''}>${c || '— none —'}</option>`).join('');
  $('fePaid').value = e.paidAmount || 0; $('feSettled').value = e.settled ? 'yes' : 'no'; $('feRecur').checked = !!e.recurring;
  $('feGoal').innerHTML = goalOptions(e.goal || ''); $('feGoalWrap').classList.toggle('hidden', !all('goal').length || uiKind(e) !== 'expense');   // v2.27
  const sync = k => { $('feWhoWrap').classList.toggle('hidden', !isUdhaar(k)); $('fePaidWrap').classList.toggle('hidden', !isUdhaar(k)); $('feGoalWrap').classList.toggle('hidden', !all('goal').length || k !== 'expense'); acctPick('fe', k, k === e.kind ? e.acct : null, e.to); if ($('feInvWrap')) invPickDraw(); };
  chipGroup($('feKind'), KINDS, uiKind(e), sync); sync(uiKind(e));
  invPickDraw(e.invTo || '');   // v2.35
  Sheets.open('shFin');
}
$('feSave').addEventListener('click', () => {
  const e = records[editFinId]; if (!e) return;
  const a = calcAmount($('feAmt').value);
  if (isNaN(a) || a <= 0) { toast(String($('feAmt').value).trim() ? `"${String($('feAmt').value).trim().slice(0, 20)}" is not an amount — nothing was saved.` : 'Enter an amount — nothing was saved.'); $('feAmt').focus(); return; }   // v2.19 (B3)
  { const p = calcAmount($('fePaid').value); if (isUdhaar(chipValue($('feKind')) || e.kind) && String($('fePaid').value).trim() && (isNaN(p) || p < 0)) { toast('"Paid back so far" is not an amount — nothing was saved.'); $('fePaid').focus(); return; } }
  if ((chipValue($('feKind')) || e.kind) === 'transfer' && !$('feAcctWrap').classList.contains('hidden') && $('feTo').value === $('feAcct').value) { toast('Pick two different accounts.'); return; }   // checked before anything changes
  e.amount = a;
  { const k = chipValue($('feKind')) || uiKind(e); if (k === 'paidby') { e.kind = 'expense'; e.paidBy = 1; } else { e.kind = k; delete e.paidBy; } }
  e.desc = $('feDesc').value.trim(); e.who = $('feWho').value.trim();
  if (isPaidBy(e) && !e.who) { toast('Who paid for it? Add the name.'); $('feWho').focus(); return; }
  e.date = $('feDate').value || e.date; e.category = $('feCat').value; e.recurring = $('feRecur').checked;
  { const gl = e.kind === 'expense' && !e.paidBy ? $('feGoal').value : ''; if (gl && records[gl]) e.goal = gl; else delete e.goal; }   // v2.27
  if (e.kind === 'expense' && !e.paidBy && e.category === 'Investment' && $('feInvTo') && $('feInvTo').value) e.invTo = $('feInvTo').value; else delete e.invTo;   // v2.35
  const oldPaid = +e.paidAmount || 0;
  e.paidAmount = Math.max(0, Math.min(calcAmount($('fePaid').value) || 0, e.amount)); e.settled = $('feSettled').value === 'yes';
  if (e.settled) e.paidAmount = e.amount;
  if (isUdh(e) && Math.abs(e.paidAmount - oldPaid) >= 0.005 && (e.pays || []).length + (hasAccts() ? 1 : 0) > 0) {   // keep the account side in step (B15)
    let d = e.paidAmount - oldPaid; const pays = (e.pays || []).slice();
    if (d > 0) pays.push({ date: todayISO(), amt: +d.toFixed(2), acct: $('feAcctWrap').classList.contains('hidden') ? (pays.length ? pays[pays.length - 1].acct : null) : $('feAcct').value });
    else { d = -d; while (d > 0.005 && pays.length) { const q = pays[pays.length - 1]; if (+q.amt <= d + 0.005) { d -= +q.amt; pays.pop(); } else { q.amt = +((+q.amt - d).toFixed(2)); d = 0; } } }
    pays.forEach(q => { if (!q.acct) delete q.acct; }); e.pays = pays;   // v2.35: a part-payment keeps its date even with no account
  }
  if (!$('feAcctWrap').classList.contains('hidden')) { e.acct = $('feAcct').value; if (e.kind === 'transfer') { if ($('feTo').value === e.acct) { toast('Pick two different accounts.'); return; } e.to = $('feTo').value; e.category = ''; } else delete e.to; }
  put(e); Sheets.close('shFin'); toast('Saved.');
});
$('feDelete').addEventListener('click', () => { const id = editFinId; Sheets.close('shFin', true); deleteWithUndo(id); });
wireCalc($('feAmt')); wireCalc($('stAmt')); wireCalc($('payAmt')); wireCalc($('bgAmt'));

/* monthly entries roll into the current month when Money is opened */
function rollRecurringOld() {
  const thisM = isoMonth(new Date());
  const seen = new Set(Object.values(records).filter(e => e.type === 'fin').map(e => (e.recurSrc || e.id) + '|' + (e.date || '').slice(0, 7)));   // deleted copies count too
  let made = 0;
  all('fin').filter(e => e.recurring).forEach(e => {
    const src = e.recurSrc || e.id;
    if ((e.date || '').slice(0, 7) >= thisM || seen.has(src + '|' + thisM)) return;
    const day = Math.min(+(e.date || '').slice(8, 10) || 1, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
    const n = { ...e, id: uid('f'), date: thisM + '-' + String(day).padStart(2, '0'), recurSrc: src, settled: false, paidAmount: 0, createdAt: nowMs() };
    delete n._dirty; delete n.pays; delete n.planRef; delete n.billRef; if (n.kind !== 'transfer') delete n.to; put(n, { render: false }); seen.add(src + '|' + thisM); made++;
  });
  if (made) toast(`${made} monthly entr${made === 1 ? 'y' : 'ies'} added for this month.`);
}

