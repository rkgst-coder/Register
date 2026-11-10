/* ==========================================================================
   v2.16 — audit fixes
   ======================================================================== */
/* ---------- tasks: whole-word classifier (no "now" inside "acknowledge", no "son" inside "reason") ---------- */
const CLS_RX = new Map();
function clsRx(w, whole) {
  const k = (whole ? 'w:' : 's:') + w;
  if (!CLS_RX.has(k)) CLS_RX.set(k, new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (whole ? '(?![a-z0-9])' : '')));
  return CLS_RX.get(k);
}
function classify(title) {
  const t = ' ' + String(title || '').toLowerCase() + ' ';
  const start = w => clsRx(w, false).test(t), whole = w => clsRx(w, true).test(t);   // word start: "pay" still finds "payment"
  let best = 'Work', bestScore = 0;
  for (const cat in CAT_WORDS) {
    let score = 0;
    CAT_WORDS[cat].forEach(w => { if (start(w)) score++; });
    (STRONG[cat] || []).forEach(w => { if (start(w)) score += 3; });
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  let prio = 'Medium';
  if (HIGH_WORDS.some(whole)) prio = 'High'; else if (LOW_WORDS.some(whole)) prio = 'Low';
  return { category: bestScore ? best : 'Work', priority: prio, matched: bestScore > 0 };
}
/* repeating task: steps move by the same number of periods as the task, so they are not overdue at once */
function spawnRepeat(t) {
  const day = t.repeatDay || +(t.dueDate || todayISO()).slice(8, 10), today = todayISO();
  let nx = shiftISO(t.dueDate || today, t.repeat, day), k = 1;
  for (let i = 0; nx < today && i < 1000; i++, k++) nx = shiftISO(nx, t.repeat, day);      // completed late: next one is not already overdue
  const shiftK = (iso, dd) => { let x = iso; for (let i = 0; x && i < k; i++) x = shiftISO(x, t.repeat, dd); return x; };
  const clone = { ...t, id: uid('t'), status: 'active', createdAt: nowMs(), dueDate: nx, repeatDay: day,
    subs: (t.subs || []).map(s => { const n = normSub(s), dd = n.dueDate ? (+s.day || +n.dueDate.slice(8, 10)) : 0;
      return { ...n, done: false, dueDate: n.dueDate ? shiftK(n.dueDate, dd) : null, ...(dd && t.repeat === 'monthly' ? { day: dd } : {}) }; }) };
  delete clone.completedOn; delete clone.completedAt; delete clone._dirty; delete clone.spawnedId;
  t.spawnedId = clone.id;
  put(clone, { render: false });
  return clone;
}

/* ---------- Recently deleted: restore / delete for good ---------- */
function binRestoreV216(id) {
  const r = records[id]; if (!r) return;
  if (r.type === 'docfile' && r.locked && !Fin.key) { toast('This file is locked — unlock first, then restore it.'); return; }
  restore(id);
  if (r.type === 'docfile') { if (r.keyId && records[r.keyId] && records[r.keyId].deleted) restore(r.keyId); if (Sync.on()) Sync.call('driveRestore', { fileId: r.fileId }).catch(() => {}); }
  if (r.type === 'fin' || r.type === 'snote') scheduleRender();
  toast('Restored.'); openBin();
}
async function purgeNow(ids, again) {
  ids = [...ids, ...ids.flatMap(id => (records[id] && records[id].type === 'catbin' && records[id].dateIds) || []).filter(x => records[x] && records[x].deleted)];   // a category's dates go with it
  const gone = [], wait = [];
  ids.forEach(id => { const r = records[id]; if (!r) return;
    if (!again && r.type === 'docfile' && r.fileId) driveDelete(r.fileId);
    if (!again && r.type === 'doc') all('docfile').forEach(f => { if (f.docId === id) { driveDelete(f.fileId); softDelete(f.id, { render: false }); } });
    if (!again && Sync.on()) { r.deletedAt = 1; put(r, { render: false }); wait.push(id); }   // v2.23: tell every device it is gone for good (they drop it on their next clean-up), then remove it here once the Sheet has it
    else gone.push(id); });
  if (wait.length) Sync.run().then(() => { const done = wait.filter(id => records[id] && records[id].deleted && !records[id]._dirty); if (done.length) purgeNow(done, true); }).catch(() => {});   // offline: they stay hidden and go after the next sync
  await Promise.all(gone.map(id => persistQ[id]).filter(Boolean));               // a queued save must not write it back after the delete
  gone.forEach(id => { delete records[id]; delete sealed[id]; delete persistQ[id]; });
  storeVer++;
  try { await DB.delMany(gone); } catch (e) { RLOG.warn('purge', e.message); }
  scheduleRender();
}
/* a locked file's key that was removed while the file itself is still in use comes back after unlocking */
function healFileKeys() {
  let n = 0;
  [...all('docfile'), ...all('blob')].forEach(f => { const k = f.keyId && records[f.keyId]; if (k && k.deleted) { restore(f.keyId); n++; } });
  if (n) RLOG.info('restored file keys still in use', n);
}

/* ---------- Dates ---------- */
function parseDateCell(v) {
  if (v instanceof Date && !isNaN(v)) { const t = new Date(v.getTime() + 43200000); return { v: isoLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate())) }; }   // Excel dates arrive a few seconds before midnight in IST
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^29\s*[-/.\s]\s*(0?2|feb[a-z]*)$/.test(s) || /^feb[a-z]*\s+29$/.test(s)) return { v: '1904-02-29', noYear: true };   // 29 Feb without a year: a leap placeholder year
  return parseDateCellOld(v);
}
function icsFold(line) {
  const out = []; let cur = '', n = 0;
  for (const ch of line) { const b = te.encode(ch).length; if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; }
  out.push(cur); return out.join('\r\n ');
}
function icsText(list) {
  const e = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n'), stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Register//Dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  list.forEach(d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.when || '')) return;
    const nx = new Date(d.when + 'T00:00:00'); nx.setDate(nx.getDate() + 1);
    const day = +d.when.slice(8, 10), mo = +d.when.slice(5, 7);
    L.push('BEGIN:VEVENT', `UID:${d.id}@register`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d.when.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${isoLocal(nx).replace(/-/g, '')}`, `SUMMARY:${e(d.label)}`);
    // same rule as the app: a day the month does not have moves to its last day
    if (d.repeat === 'yearly') L.push(mo === 2 && day === 29 ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1' : 'RRULE:FREQ=YEARLY');
    else if (REP_MONTHS[d.repeat]) { const iv = REP_MONTHS[d.repeat] > 1 ? ';INTERVAL=' + REP_MONTHS[d.repeat] : ''; L.push(day >= 29 ? 'RRULE:FREQ=MONTHLY' + iv + ';BYMONTHDAY=' + Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',') + ';BYSETPOS=-1' : 'RRULE:FREQ=MONTHLY' + iv); }
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR'); return L.map(icsFold).join('\r\n') + '\r\n';
}
/* placeholders ("set the date") made twice — e.g. on two devices before they synced — keep one */
function dedupeSeedDates() {
  const by = new Map();
  all('date').forEach(d => { const k = String(d.label || '').trim().toLowerCase(); if (!k) return; (by.get(k) || by.set(k, []).get(k)).push(d); });
  let n = 0;
  by.forEach(L => {
    if (L.length < 2) return;
    const empty = d => !d.when && !d.docRef, keep = L.find(d => !empty(d)) || L.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
    L.forEach(d => { if (d !== keep && empty(d)) { d.deleted = true; d.deletedAt = 1; put(d, { render: false }); n++; } });
  });
  if (n) RLOG.info('removed duplicate date placeholders', n);
}

/* ---------- Inbox: dates in a line (no "1.5 kg", "5 pm", "10 marks", "maybe", "2 decks") ---------- */
const DMON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?(?![a-z])';
const DRX1 = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*' + DMON + '(?:,?\\s*(\\d{4}))?\\b'), DRX2 = new RegExp('\\b' + DMON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b');
function findDateIn(text) {
  const s = ' ' + String(text || '').toLowerCase() + ' ', t = todayISO(); let m;
  const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getMonth() === mo - 1 && dt.getDate() === d ? isoLocal(dt) : null; };
  const fut = (mo, d) => { const y = +t.slice(0, 4); let r = ok(y, mo, d); if (r && r < t) r = ok(y + 1, mo, d); return r; };
  if ((m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d.])/))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3], r = ok(y, +m[2], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { const r = ok(+m[1], +m[2], +m[3]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(DRX1))) { const r = m[3] ? ok(+m[3], MON3[m[2].slice(0, 3)], +m[1]) : fut(MON3[m[2].slice(0, 3)], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(DRX2))) { const r = m[3] ? ok(+m[3], MON3[m[1].slice(0, 3)], +m[2]) : fut(MON3[m[1].slice(0, 3)], +m[2]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/(^|[^\d.,])(\d{1,2})([/.])(\d{1,2})(?![\d./,])/))) {
    const at = m.index + m[1].length, before = s.slice(Math.max(0, at - 4), at), after = s.slice(at + m[0].length - m[1].length);
    const dotOk = m[3] === '/' || (m[4].length === 2 && !/^\s*(kg|kgs|g|gm|gms|l|ltr|ml|lakh|lac|cr|crore|%|km|hrs?|min|am|pm|x|rs)\b/.test(after));
    if (dotOk && +m[4] >= 1 && +m[4] <= 12 && +m[2] >= 1 && +m[2] <= 31 && !/[₹]|rs/.test(before)) { const r = fut(+m[4], +m[2]); if (r) return { iso: r, hit: m[0].slice(m[1].length) }; }
  }
  if (/\b(today|aaj)\b/.test(s)) return { iso: t, hit: (s.match(/\b(today|aaj)\b/) || [''])[0] };
  if (/\btomorrow\b/.test(s)) return { iso: addDays(1), hit: 'tomorrow' };
  if ((m = s.match(/\bin (\d{1,3}) days?\b/))) return { iso: addDays(+m[1]), hit: m[0] };
  if ((m = s.match(/\b(?:next |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) { const w = WDAYS.indexOf(m[1]), now = new Date(t + 'T00:00:00').getDay(); const k = (w - now + 7) % 7 || 7; return { iso: addDays(k), hit: m[0] }; }
  return null;
}
const YEARLY_CATS = ['birthday', 'anniv', 'remember'];

/* ---------- Money ---------- */
/* udhaar as it stood on a past day (not today's figures) */
function udhaarAsOf(iso) {
  if (iso >= todayISO()) return udhaarSplit();
  let owed = 0, owe = 0;
  all('fin').filter(e => isUdh(e) && finDate(e) && finDate(e) <= iso).forEach(e => {
    const pays = e.pays || [], pp = pays.reduce((t, p) => t + (+p.amt || 0), 0);
    const rest = Math.max(0, (+e.paidAmount || 0) - pp);                         // paid back before instalments were recorded: date unknown
    const left = Math.max(0, (+e.amount || 0) - pays.filter(p => (p.date || '') <= iso).reduce((t, p) => t + (+p.amt || 0), 0) - rest);
    if (e.kind === 'lent') owed += left; else owe += left;
  });
  return { owed, owe };
}
/* a monthly entry is copied once per month; the copy's id is fixed so two devices make the same one */
function rollRecurring() {
  const thisM = isoMonth(new Date());
  const seen = new Set(Object.values(records).filter(e => e.type === 'fin').map(e => (e.recurSrc || e.id) + '|' + (e.date || '').slice(0, 7)));   // deleted copies count too
  let made = 0;
  all('fin').filter(e => e.recurring).forEach(e => {
    const src = e.recurSrc || e.id, id = 'rr_' + src + '_' + thisM.replace('-', '');
    if ((e.date || '').slice(0, 7) >= thisM || seen.has(src + '|' + thisM) || records[id] || sealed[id]) return;
    const day = Math.min(+(e.date || '').slice(8, 10) || 1, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
    const n = { ...e, id, date: thisM + '-' + String(day).padStart(2, '0'), recurSrc: src, settled: false, paidAmount: 0, createdAt: nowMs() };
    delete n._dirty; delete n.pays; delete n.planRef; delete n.billRef; if (n.kind !== 'transfer') delete n.to; put(n, { render: false }); seen.add(src + '|' + thisM); made++;
  });
  if (made) toast(`${made} monthly entr${made === 1 ? 'y' : 'ies'} added for this month.`);
}
function rollAfterSync() {
  const then = () => { if (Fin.key) { rollRecurring(); dropAfterUnlock(); } };
  if (Sync.on() && navigator.onLine && !window.GHOST) Sync.run().then(then, then);
  else { rollRecurring(); dropAfterUnlock(); }
}

