/* ==========================================================================
   REMINDERS IN DATES — card statement / due days, FD & PPF maturity, premiums
   (dates made here carry sysSrc + srcRef; deleting one by hand is respected)
   ======================================================================== */
function monthlyBase(day) {                                   // a January date: January has every day, so 29th–31st stay right in later months
  const t = todayISO(), y = +t.slice(0, 4), jan = `${y}-01-${String(day).padStart(2, '0')}`;
  return jan <= t ? jan : `${y - 1}-01-${String(day).padStart(2, '0')}`;
}
function sysDate(id, want, force) {
  const d = records[id];
  if (!want) { if (d && !d.deleted) { d.sysOff = true; softDeleteBase(id, { render: false }); } return; }
  if (d && d.deleted && !d.sysOff && !force) return;          // you deleted it from Dates yourself: not brought back until you save the account again
  if (d && !d.deleted && d.label === want.label && d.when === want.when && d.repeat === want.repeat && d.cat === want.cat && d.srcRef === want.srcRef) return;
  const rec = { ...(d || {}), id, type: 'date', label: want.label, when: want.when, repeat: want.repeat, cat: want.cat, srcRef: want.srcRef, sysSrc: want.sysSrc, deleted: false };
  delete rec.deletedAt; delete rec.sysOff; delete rec.needsDetail;
  put(rec, { render: false });
}
function acctDateWants(a) {
  const W = {}, on = a && !a.deleted && !a.archived && a.remind !== false;
  if (!on) return W;
  if (a.kind === 'card' && clampDay(a.stmtDay)) W.stmt = { label: `${a.name} — card statement`, when: monthlyBase(clampDay(a.stmtDay)), repeat: 'monthly', cat: 'bank' };
  if (a.kind === 'card' && clampDay(a.dueDay)) W.due = { label: `${a.name} — card payment due`, when: monthlyBase(clampDay(a.dueDay)), repeat: 'monthly', cat: 'bank' };
  if (a.kind === 'fd' && ISO_DATE_RX.test(a.matures || '')) W.mat = { label: `${a.name} — matures`, when: a.matures, repeat: 'once', cat: 'bank' };
  return W;
}
function syncAcctDates(a, force) {
  if (!a || !a.id) return;
  const W = acctDateWants(a);
  ['stmt', 'due', 'mat'].forEach(k => sysDate('ad-' + a.id + '-' + k, W[k] ? { ...W[k], srcRef: a.id, sysSrc: 'acct' } : null, force));
}
function recurDateWant(r) {
  if (!r || r.deleted || !r.remind || !ISO_DATE_RX.test(r.remindDate || '')) return null;
  const ev = +r.every || 1, repeat = ({ 1: 'monthly', 2: 'm2', 3: 'm3', 6: 'm6', 12: 'yearly' })[ev] || 'once', day = +r.remindDate.slice(8, 10);
  let when = r.remindDate;
  if (repeat === 'once') { for (let k = 0; when < todayISO() && k < 600; k++) when = isoLocal(addMonthsKeep(new Date(when + 'T00:00:00'), ev, day)); }   // every 2, 3 or 6 months: the next one
  if (r.end && when.slice(0, 7) > r.end) return null;
  return { label: r.name, when, repeat, cat: /insur|premium|\blic\b|policy|mediclaim/i.test(r.name) ? 'insurance' : 'bank', srcRef: r.id, sysSrc: 'recur' };
}
function syncAllAcctDates() {
  if (!Fin.key || window.GHOST) return;
  accts(true).forEach(a => syncAcctDates(a, false));
  all('recur').forEach(r => sysDate('rd-' + r.id, recurDateWant(r), false));
  all('vault').forEach(v => sysDate('vd-' + v.id, vaultDateWant(v), false));   // v2.24: card / policy expiry from Card & account details
  all('snote').forEach(n => { if ((n.tables || []).length) tbSyncDates(n); });   // v2.27: expiry dates from PNote tables
  if (!(Fin.lockedOut || []).length) all('date').forEach(d => { if (d.sysSrc && (d.sysSrc === 'acct' || d.sysSrc === 'recur' || d.sysSrc === 'vault' || d.sysSrc === 'snote')) { const s = records[d.srcRef]; if (!s || s.deleted) sysDate(d.id, null); } });
}
{ const sd = softDelete, rs0 = restore;
  softDelete = function (id, opt) { const r = records[id]; sd(id, opt); if (r && (r.type === 'acct' || r.type === 'recur')) setTimeout(() => { try { syncAllAcctDates(); } catch (e) { RLOG.warn('acct dates', e.message); } }, 0); };
  restore = function (id) { const r = records[id]; rs0(id); if (r && (r.type === 'acct' || r.type === 'recur')) setTimeout(() => { try { if (r.type === 'acct') syncAcctDates(records[id], true); else sysDate('rd-' + id, recurDateWant(records[id]), true); } catch (e) { RLOG.warn('acct dates', e.message); } }, 0); };
}

