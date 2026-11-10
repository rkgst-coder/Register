/* ==========================================================================
   v2.29 — CARD CODE: a second code for 🔒 values in PNote tables
   The note is already encrypted with the private code. With a card code set,
   each 🔒 value inside it is encrypted AGAIN with a key from the card code
   (PBKDF2-SHA-256, 600,000 rounds, its own salt), so the private code alone
   does not show card numbers. Face ID (where Money's Face ID is on) can open
   it instead of typing. It locks again after 60 seconds, when Register goes
   to the background, and when Money locks. Forgotten card code = those values
   cannot be read; the rest of the note is not affected.
   ======================================================================== */
const CK_ID = '__cardkey__', CK_PRE = '§c1:', CK_ITERS = 600000, CK_HOLD = 60000;
const Card = { key: null, salt: null, plain: new Map(), t: null, fails: 0, waitTill: 0, after: null };
const ckRec = () => { const r = records[CK_ID]; return r && !r.deleted && r.salt && r.check ? r : null; };
const isCk = v => typeof v === 'string' && v.startsWith(CK_PRE);
const tbHasSecret = t => (t.cols || []).some(c => c.s);
const cardOpen = () => !!(Card.key || !ckRec());          // no card code set: 🔒 values open as before
async function cardDerive(code, salt, iters) {           // not cached: the key lives only while the card code is open
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: +iters || CK_ITERS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function cardHold() {
  clearTimeout(Card.t);
  Card.t = setTimeout(() => { if (Sheets.isOpen('shTbl')) { cardHold(); return; } cardLock(); }, CK_HOLD);   // stays open while a table is being edited
}
function cardLock(silent) {
  if (!Card.key && !Card.plain.size) return;
  Card.key = null; Card.salt = null; Card.plain.clear(); clearTimeout(Card.t);
  if (typeof TB !== 'undefined') TB.shown.clear();
  if (!silent && Sheets.isOpen('shNoteView') && records[viewNoteId] && records[viewNoteId].type === 'snote') previewNote(viewNoteId);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) cardLock(true); });
async function cardPlainAll() {                           // decrypt every sealed 🔒 value (in memory only, for 60 s)
  if (!Card.key) return;
  for (const n of all('snote')) for (const t of (n.tables || [])) for (const r of (t.rows || [])) for (const v of r.c)
    if (isCk(v) && !Card.plain.has(v)) { try { Card.plain.set(v, await aesDec(Card.key, v.slice(CK_PRE.length))); } catch (e) { RLOG.warn('card value not readable with this card code'); } }   // left sealed, never overwritten
}
async function cardSealTable(t) {                         // 🔒 columns → sealed; other columns → plain
  const r0 = ckRec(); if (!Card.key || !r0 || r0.salt !== Card.salt) { cardLock(true); throw new Error('The card code was changed on another device — unlock again.'); }
  for (const r of (t.rows || [])) for (let i = 0; i < r.c.length; i++) {
    const v = r.c[i], c = t.cols[i];
    if (c && c.s && v && !isCk(v)) { const enc = CK_PRE + await aesEnc(Card.key, String(v)); Card.plain.set(enc, String(v)); r.c[i] = enc; }
    else if (c && !c.s && isCk(v) && Card.plain.has(v)) r.c[i] = Card.plain.get(v);   // unreadable values stay as they are
  }
}
async function cardSealAll() {                            // after unlocking: anything still plain (older device, moved card details) gets sealed
  if (!Card.key || !finUnlocked()) return 0;
  let k = 0;
  for (const n of all('snote')) {
    if (!(n.tables || []).length) continue;
    const before = JSON.stringify(n.tables);
    for (const t of n.tables) await cardSealTable(t);
    if (JSON.stringify(n.tables) !== before) { put(n, { render: false }); k++; }
  }
  return k;
}
async function cardOpenWith(key, salt) {
  Card.key = key; Card.salt = salt; Card.fails = 0; cardHold();
  await cardPlainAll(); await cardSealAll();
  const f = Card.after; Card.after = null; if (f) f();
}
async function cardTry(code) {
  const r = ckRec(); if (!r) return false;
  const key = await cardDerive(code, r.salt, r.iters);
  try { if (await aesDec(key, r.check) !== 'register-card-ok') return false; } catch (e) { return false; }
  await cardOpenWith(key, r.salt); return true;
}
/* Face ID: the card code is kept on THIS device only, locked by Face ID (same passkey as Money's Face ID, different salt) */
const CardBio = {
  KEY: 'r2_cardbio',
  get() { try { const b = JSON.parse(localStorage.getItem(this.KEY) || 'null'); const r = ckRec(); return b && r && b.ck === r.salt && Bio.get() && Bio.get().id === b.id ? b : null; } catch (e) { return null; } },
  forget() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
  async wrap(out) { const base = await crypto.subtle.importKey('raw', out, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('register-card-v1'), info: te.encode('card-code') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); },
  async enable(code) { const bio = Bio.get(); if (!bio) throw new Error('Turn on Face ID for Money first (Settings).');
    const salt = Bio.rnd(32), out = await Bio.prf(unb64(bio.id), salt);
    localStorage.setItem(this.KEY, JSON.stringify({ id: bio.id, salt: b64(salt), ck: ckRec().salt, box: await aesEnc(await this.wrap(out), code) })); },
  async unlock() { const b = this.get(); if (!b) return false;
    const code = await aesDec(await this.wrap(await Bio.prf(unb64(b.id), unb64(b.salt))), b.box);
    const ok = await cardTry(code); if (!ok) this.forget(); return ok; }
};
/* ask for the card code — Face ID first when this device has it (called inside the tap, so Face ID can start at once) */
function cardAsk(then) {
  if (cardOpen()) { then && then(); return; }
  Card.after = then || null;
  if (CardBio.get()) {
    CardBio.unlock().then(ok => { if (!ok) cardCodeSheet(); }).catch(e => { RLOG.warn('card face id', e.name, e.message); cardCodeSheet(e.name === 'NotAllowedError' ? 'Face ID cancelled — type the card code instead.' : ''); });
    return;
  }
  cardCodeSheet();
}
function cardCodeSheet(msg) {
  planSheet('🔐 Card code', `<p class="hint" style="margin:0 4px 10px">🔒 values (card and account numbers) need the card code. They lock again after 60 seconds.</p>
    <div class="field"><label>Card code</label><input id="ckIn" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"></div>
    ${Bio.get() && !CardBio.get() ? '<label class="switch-row">Use Face ID for this next time<input type="checkbox" class="sw" id="ckBio" checked></label>' : ''}`, () => {
    const c = $('ckIn').value;
    if (Date.now() < Card.waitTill) { planMsg('Too many wrong tries. Wait a minute.', true); return false; }
    if (!c) { planMsg('Type the card code.', true); return false; }
    const wantBio = $('ckBio') && $('ckBio').checked;
    $('pshSave').disabled = true; planMsg('Checking…');
    cardTry(c).then(async ok => {
      $('pshSave').disabled = false;
      if (!ok) { Card.fails++; if (Card.fails >= 5) { Card.waitTill = Date.now() + 60000; Card.fails = 0; } planMsg('That is not the card code.', true); return; }
      Sheets.close('shPlan', true);
      if (wantBio) toast('Use Face ID for the card code on this device?', 'Turn on', () => CardBio.enable(c).then(() => toast('Face ID opens the card code on this device now.')).catch(e => toast(e.name === 'NotAllowedError' ? 'Face ID cancelled.' : (e.message || 'Could not turn on Face ID.'))), 12000);
    });
    return false;
  }, 'Unlock');
  if (msg) planMsg(msg, true);
  setTimeout(() => $('ckIn') && $('ckIn').focus(), 250);
}
function cardLine(n) {
  if (!(n.tables || []).some(tbHasSecret)) return '';
  const r = ckRec();
  return `<div class="ck-line"><span>${r ? (Card.key ? '🔓 Card code open — locks in a minute' : '🔐 🔒 values need the card code') : '🔒 values open with the private code only'}</span><button class="btn ghost small" type="button" data-ckm="1">${r ? 'Card code ⋯' : '＋ Card code'}</button></div>`;
}
function cardMenu(anchor, noteId) {
  const r = ckRec(), refresh = () => { if (Sheets.isOpen('shNoteView')) previewNote(noteId); };
  if (!r) { cardSetSheet(null, refresh); return; }
  const items = [];
  if (Card.key) items.push({ l: '🔐 Lock now', fn: () => { cardLock(); refresh(); } });
  items.push({ l: '✎ Change card code', fn: () => cardAsk(() => cardSetSheet('change', refresh)) });
  if (Bio.get()) items.push(CardBio.get() ? { l: 'Face ID for card code: turn off', fn: () => { CardBio.forget(); toast('Face ID for the card code is off on this device.'); } }
    : { l: 'Face ID for card code: turn on', fn: () => { Card.after = null; cardCodeSheet(); } });
  items.push({ l: 'Remove card code', cls: 'danger', fn: () => cardAsk(() => cardRemove(refresh)) });
  popMenu(anchor, items);
}
function cardSetSheet(mode, done) {
  planSheet(mode ? 'Change card code' : 'Add a card code', `<p class="hint" style="margin:0 4px 10px">${mode ? '' : 'A second code just for 🔒 values in PNote tables — card numbers, account numbers. Someone who knows (or sees) your private code still cannot see them. '}At least 8 characters, different from your private code. <b>It cannot be recovered</b> — if you forget it, the 🔒 values are lost (the rest of the notes are not).</p>
    <div class="field"><label>New card code</label><input id="ckN1" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></div>
    <div class="field"><label>Again</label><input id="ckN2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></div>`, () => {
    const a = $('ckN1').value, b = $('ckN2').value;
    if (a.length < 8) { planMsg('At least 8 characters.', true); return false; }
    if (a !== b) { planMsg('The two do not match.', true); return false; }
    $('pshSave').disabled = true; planMsg('Setting it up…');
    cardSet(a).then(res => { $('pshSave').disabled = false;
      if (res === 'same') { planMsg('Use a code different from your private code.', true); return; }
      Sheets.close('shPlan', true); toast(mode ? 'Card code changed.' : 'Card code on. 🔒 values now need it (or Face ID).'); if (done) done(); })
      .catch(e => { $('pshSave').disabled = false; RLOG.error('card code', e); planMsg('Could not set it: ' + (e.message || e), true); });
    return false;
  }, mode ? 'Change' : 'Turn on');
  setTimeout(() => $('ckN1') && $('ckN1').focus(), 250);
}
async function cardSet(code) {
  const fk = records[FINKEY_ID];
  if (fk) { try { const k = await deriveFinKey(code, fk.salt, fk.iters); if (await aesDec(k, fk.check) === 'register-ok') return 'same'; } catch (e) {} }
  if (ckRec()) await cardPlainAll();                                       // changing: read everything with the old key first
  const old = new Map(Card.plain);
  // every sealed value back to plain (in memory), then seal with the new key
  const notes = all('snote').filter(n => (n.tables || []).length);
  notes.forEach(n => n.tables.forEach(t => t.rows.forEach(r => { r.c = r.c.map(v => isCk(v) ? (old.has(v) ? old.get(v) : v) : v); })));
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))), key = await cardDerive(code, salt, CK_ITERS);
  put({ id: CK_ID, type: 'cardkey', salt, iters: CK_ITERS, check: await aesEnc(key, 'register-card-ok'), createdAt: nowMs(), deleted: false }, { render: false });
  CardBio.forget();
  Card.plain.clear(); Card.key = key; Card.salt = salt; cardHold();
  for (const n of notes) { for (const t of n.tables) await cardSealTable(t); put(n, { render: false }); }
  return 'ok';
}
async function cardRemove(done) {
  if (!Card.key) return;
  await cardPlainAll();
  for (const n of all('snote')) { if (!(n.tables || []).some(t => t.rows.some(r => r.c.some(isCk)))) continue;
    n.tables.forEach(t => t.rows.forEach(r => { r.c = r.c.map(v => isCk(v) ? (Card.plain.get(v) ?? v) : v); })); put(n, { render: false }); }
  const r = records[CK_ID]; if (r) { r.deleted = true; r.deletedAt = nowMs(); put(r, { render: false }); }
  CardBio.forget(); cardLock(true); toast('Card code removed. 🔒 values open with the private code again.'); if (done) done();
}

