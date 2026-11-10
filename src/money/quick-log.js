/* ==========================================================================
   v2.20 — Quick log: a spend noted while the private section is locked.
   When the section is unlocked once, a key pair is made: the private half is stored encrypted with your code
   (type 'dropkey', synced like other private items), the public half stays on this device. A quick log is
   encrypted to that public half at once (ECDH P-256 + AES-GCM) and stored as type 'qlog'; nothing about it is
   readable without your code — not on this phone, not in the Sheet. Unlocking moves each one into the Ledger
   (its id is fixed, so two devices doing this make one entry) and removes it.
   ======================================================================== */
const DROP_LS = 'r2_qlKey', ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const qlReady = () => !window.GHOST && finConfigured() && !!lsGet(DROP_LS);
let dropBusy = false;
async function dropAfterUnlock() {
  if (!Fin.key || window.GHOST || !(window.crypto && crypto.subtle)) return;
  try {
    let keys = all('dropkey').filter(k => k.pub && k.priv);
    if (!keys.length) {
      const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']), kid = uid('qk');
      if (!Fin.key) return;
      put({ id: 'dk-' + kid, type: 'dropkey', kid, pub: await crypto.subtle.exportKey('jwk', kp.publicKey), priv: await crypto.subtle.exportKey('jwk', kp.privateKey), createdAt: nowMs(), deleted: false }, { render: false });
      keys = all('dropkey').filter(k => k.pub && k.priv);
    }
    const k = keys.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (k) lsSet(DROP_LS, JSON.stringify({ kid: k.kid, pub: { kty: k.pub.kty, crv: k.pub.crv, x: k.pub.x, y: k.pub.y } }));
    await dropDrain();
  } catch (e) { RLOG.warn('quick log key', e && e.message); }
}
async function dropSeal(obj) {
  const k = JSON.parse(lsGet(DROP_LS) || 'null'); if (!k || !k.pub) throw new Error('quick log not ready');
  const pub = await crypto.subtle.importKey('jwk', { ...k.pub, ext: true }, ECDH, false, []);
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const epk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  return { kid: k.kid, epk: { x: epk.x, y: epk.y }, enc: await aesEnc(aes, JSON.stringify(obj)) };
}
async function dropOpen(r) {
  const k = all('dropkey').find(x => x.kid === r.kid); if (!k) throw new Error('no key for ' + r.kid);
  const priv = await crypto.subtle.importKey('jwk', { ...k.priv, key_ops: ['deriveKey'] }, ECDH, false, ['deriveKey']);
  const epk = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: r.epk.x, y: r.epk.y, ext: true }, ECDH, false, []);
  const aes = await crypto.subtle.deriveKey({ name: 'ECDH', public: epk }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return JSON.parse(await aesDec(aes, r.enc));
}
/* the note is read the way the quick line in Money is: "chai", "lunch pb Ravi", "lent Ravi", "#travel" */
function dropToFin(x, id) {
  const amt = +x.v, note = String(x.n || '').trim(), q = parseMoneyLine(`${amt} ${note}`.trim());
  const base = q.error || Math.abs((+q.amount || 0) - amt) > 0.005 ? { kind: 'expense', desc: note || 'Quick log', cat: guessFinCat(note) } : q;
  return saveMoneyEntry({ ...base, amount: amt, date: ISO_DATE_RX.test(x.d || '') ? x.d : todayISO(), id });
}
async function dropDrain() {
  if (!Fin.key || dropBusy || window.GHOST) return;
  dropBusy = true; let n = 0, bad = 0;
  try {
    for (const r of all('qlog')) {
      let x; try { x = await dropOpen(r); } catch (e) { bad++; continue; }
      if (!Fin.key) break;
      const id = 'f-' + r.id;
      if (!records[id] && !sealed[id] && !dropToFin(x, id)) { bad++; continue; }
      r.deleted = true; r.deletedAt = 1; put(r, { render: false }); n++;
    }
  } finally { dropBusy = false; }
  if (n) { scheduleRender(); toast(`${n} quick log${n > 1 ? 's' : ''} added to the Ledger.`); RLOG.info('quick logs moved', n); }
  if (bad) RLOG.warn('quick logs not opened', bad);
}
async function quickLogSave(val, note, date) {
  if (window.GHOST) return true;
  const x = { v: val, n: String(note || '').slice(0, 200), d: date };
  if (Fin.key) return !!dropToFin(x, uid('f'));
  const s = await dropSeal(x);
  put({ id: uid('ql'), type: 'qlog', kid: s.kid, epk: s.epk, enc: s.enc, deleted: false });
  return true;
}
const ARCH_START_WARN = 'Ledger entries from before the old start month were archived. With an earlier start they are left out of your balances until you bring those archives back (Settings → Archive old years). Move the start anyway?';

/* ---------- Docs: one PDF worker for the whole session; documents are closed when the viewer closes ---------- */
const pdfOpenDocs = new Set();
const pdfWorkerOpt = () => window.__pdfWorker ? { worker: window.__pdfWorker } : {};
Sheets.onClose.shDocView = () => { pdfOpenDocs.forEach(d => { try { d.destroy(); } catch (e) {} }); pdfOpenDocs.clear(); };
/* the Scan screen: one save at a time */
Scan.save = (function (inner) {
  return async function () {
    if (this.busy) return; this.busy = true; if ($('scSave')) $('scSave').disabled = true;
    try { return await inner.call(this); } finally { this.busy = false; if ($('scSave')) $('scSave').disabled = !this.pages.length; }
  };
})(Scan.save);


