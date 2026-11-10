/* ==========================================================================
   LEDGER ACCOUNTS (v2.4) — every entry says which account; Transfer moves
   money between your own accounts and is never income or spending.
   ======================================================================== */
function lastAcct(kind) { try { return (JSON.parse(localStorage.getItem('r2_lastAcct') || '{}'))[kind] || null; } catch (e) { return null; } }
function rememberAcct(kind, id) { try { const m = JSON.parse(localStorage.getItem('r2_lastAcct') || '{}'); m[kind] = id; localStorage.setItem('r2_lastAcct', JSON.stringify(m)); } catch (e) {} }
const hasAccts = () => Fin.key && typeof accts === 'function' && accts().length > 0;
const acctLabelFor = k => k === 'income' ? 'Received into' : k === 'expense' ? 'Paid from' : k === 'lent' ? 'Given from' : k === 'borrowed' ? 'Received into' : k === 'paidby' ? 'Paying back from' : 'From';
function acctPick(prefix, kind, acct, to) {
  const wrap = $(prefix + 'AcctWrap'); if (!wrap) return;
  const on = hasAccts(); wrap.classList.toggle('hidden', !on);
  if (!on) return;
  const c = planCfg(), def = defAcct(c);
  const liquidish = a => a.kind !== 'loan';
  $(prefix + 'AcctLbl').textContent = acctLabelFor(kind);
  const fromF = kind === 'transfer' ? liquidish : a => !isInvest(a.kind) && a.kind !== 'loan', okAc = (id, f) => { const a = acctById(id); return a && !a.archived && f(a) ? id : null; };
  $(prefix + 'Acct').innerHTML = acctOptions(acct || okAc(lastAcct(kind), fromF) || def, fromF);
  $(prefix + 'ToWrap').classList.toggle('hidden', kind !== 'transfer');
  if (kind === 'transfer') {
    const firstOther = (accts().find(a => a.id !== $(prefix + 'Acct').value && liquidish(a)) || {}).id;
    $(prefix + 'To').innerHTML = acctOptions(to || okAc(lastAcct('transferTo'), liquidish) || firstOther, liquidish);
  }
  const cat = $(prefix + 'CatWrap'); if (cat) cat.classList.toggle('hidden', kind === 'transfer');
}
function finRoute(e) {
  if (!hasAccts()) return '';
  if (e.kind === 'transfer') return `<span class="fin-route">${esc(acctName(e.acct))} → ${esc(acctName(e.to))}</span>`;
  return e.acct && acctById(e.acct) ? `<span class="fin-route">${e.kind === 'expense' || e.kind === 'lent' ? 'from' : 'into'} ${esc(acctName(e.acct))}</span>` : '';
}

/* v2.36: monthly reminder to keep a copy OUTSIDE Google. The weekly Drive backup lives in the same Google account as the
   Sheet, so it does not count here (before, it silenced this reminder). Any device saving a copy counts for all devices. */
const OUT_BK_HELP = 'On iPhone choose “Save to Files” → iCloud Drive or On My iPhone. On a computer it lands in Downloads — move it somewhere that is not Google Drive.';
function lastOutBackup() {
  const legacy = AutoBackup.list().length ? 0 : +(lsGet('r2_lastBackup') || 0);                 // before v2.36 one stamp covered both kinds
  return Math.max(0, +(lsGet('r2_lastOutBackup') || 0), legacy, ...all('device').map(d => +d.outBk || 0));
}
function noteOutBackup() {
  const t = Date.now(); lsSet('r2_lastOutBackup', String(t)); lsSet('r2_lastBackup', String(t));
  try { const id = 'dev-' + deviceId(), r = records[id]; if (r && !r.deleted && Sync.on()) { r.outBk = t; put(r, { render: false }); } } catch (e) { RLOG.warn('backup note', e.message); }
}
function backupNudge() {
  try {
    const last = lastOutBackup(), shown = +localStorage.getItem('r2_backupNudge') || 0, now = Date.now();
    if (now - last < 30 * 86400000 || now - shown < 3 * 86400000) return;
    localStorage.setItem('r2_backupNudge', String(now));
    toast(last ? 'Over a month since a backup was saved outside Google.' : 'No backup has been saved outside Google yet.', 'Save one', () => $(Fin.key ? 'setBackupEnc' : 'setBackup').click(), 9000, { once: 'backup' });
  } catch (e) {}
}
$('setEraseCode').addEventListener('click', openEraseSetup);
$('setErase').addEventListener('click', openErase);

