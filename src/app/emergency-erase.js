/* ==========================================================================
   EMERGENCY ERASE (v2.3) — needs a separate erase code, the word ERASE and a
   10-second countdown. Cloud copies are overwritten with empty "erased" rows
   (other devices clear their copy on their next sync) and Drive files are
   sent to Drive's bin.
   ======================================================================== */
const ERASE_ID = '__erasekey__', ERASE_ITERS = 200000;
let eraseTimer = null;
const eraseRec = () => { const r = records[ERASE_ID]; return r && !r.deleted && r.type === 'erasekey' ? r : null; };
async function eraseHash(code, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: ERASE_ITERS, hash: 'SHA-256' }, base, 256));
}
/* v2.19 (S2): a second value made from the erase code — the Apps Script keeps only its hash and needs it to empty the Register folder. Not stored anywhere in the Sheet. */
async function eraseProof(code, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode('register-erase-proof|' + salt), iterations: ERASE_ITERS, hash: 'SHA-256' }, base, 256));
}
function eraseSheet(title, html) { $('erTitle').textContent = title; $('erBody').innerHTML = html; if (!Sheets.isOpen('shErase')) Sheets.open('shErase'); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function openEraseSetup() {
  if (!finConfigured()) { toast('Set up the private section first (tap "Register" three times).'); return; }
  eraseSheet(eraseRec() ? 'Change erase code' : 'Set erase code', `<p class="hint" style="margin:0 4px 12px">Used only for emergency erase. It must be different from your private code and at least 8 characters. Keep it somewhere safe; it cannot be recovered.</p>
    <div class="field"><label>Your private code (to confirm it is you)</label><input type="password" id="erPriv" autocomplete="off"></div>
    ${eraseRec() ? '<div class="field"><label>Current erase code</label><input type="password" id="erOld" autocomplete="off"></div>' : ''}
    <div class="field"><label>New erase code</label><input type="password" id="erNew1" autocomplete="new-password"></div>
    <div class="field"><label>Repeat erase code</label><input type="password" id="erNew2" autocomplete="new-password"></div>
    <button class="btn brass block" id="erSave">Save erase code</button><div class="msg" id="erMsg"></div>`);
  $('erSave').addEventListener('click', async () => {
    const m = $('erMsg'), priv = $('erPriv').value, a = $('erNew1').value, b = $('erNew2').value, fk = records[FINKEY_ID];
    m.className = 'msg'; m.textContent = 'Checking…';
    let ok = false; try { ok = (await aesDec(await deriveFinKey(priv, fk.salt, fk.iters), fk.check)) === 'register-ok'; } catch (e) {}
    m.className = 'msg err';
    if (!ok) { m.textContent = 'The private code is not correct.'; return; }
    if (a.length < 8) { m.textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { m.textContent = "The two entries don't match."; return; }
    if (a === priv) { m.textContent = 'Choose something different from your private code.'; return; }
    const old = eraseRec(), oldCode = $('erOld') ? $('erOld').value : '';
    if (old && (await eraseHash(oldCode, old.salt)) !== old.hash) { m.textContent = 'The current erase code is not correct.'; return; }
    m.className = 'msg'; m.textContent = 'Saving…';
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    let note = '';
    if (Sync.on()) {                                        // the script learns the new proof first, so the two never disagree
      try { await Sync.call('eraseProofSet', { proof: await eraseProof(a, salt), oldProof: old ? await eraseProof(oldCode, old.salt) : '' }, 60000); }
      catch (e) {
        if (/mismatch/.test(e.message || '')) { m.className = 'msg err'; m.textContent = 'The Apps Script has a different erase code saved. In Apps Script: Project Settings → Script properties → delete ERASE_PROOF, then save here again.'; return; }
        note = /unknown action/.test(e.message || '') ? ' Update the Apps Script to v25 and save the erase code again, so erase can empty the Drive folder.' : ' The Apps Script could not be told (' + e.message + '); save it again when online.';
      }
    } else note = ' Sync is off: connect it and save the erase code again so erase can empty the Drive folder.';
    put({ id: ERASE_ID, type: 'erasekey', salt, hash: await eraseHash(a, salt), deleted: false });
    Sheets.close('shErase', true); toast('Erase code saved.' + note, null, null, note ? 9000 : 2800);
  });
}
function openErase() {
  const r = eraseRec();
  if (!r) { eraseSheet('Emergency erase', '<p class="hint" style="margin:0 4px">No erase code is set. First use "Set emergency erase code" in Settings.</p>'); return; }
  const cloud = Sync.on();
  eraseSheet('Emergency erase', `<div class="erase-warn"><b>This deletes all Register data</b> — tasks, notes, dates, documents and their files${finUnlocked() ? ', Money, Plan and private notes' : ' and everything else'}. It cannot be undone from the app.</div>
    <div class="group"><label class="switch-row"><span>Also erase the Google Sheet and Drive files<small>${cloud ? "Sheet rows are overwritten; Drive files go to Drive's bin. Your other devices clear their copy when they next sync." : 'Sync is not connected, so only this device can be erased.'}</small></span><input type="checkbox" class="sw" id="erCloud"${cloud ? ' checked' : ' disabled'}></label></div>
    <div class="field"><label>Erase code</label><input type="password" id="erCode" autocomplete="off"></div>
    <div class="field"><label>Type ERASE in capital letters</label><input id="erWord" autocapitalize="characters" autocomplete="off" autocorrect="off"></div>
    <button class="btn danger block" id="erGo" disabled>Erase…</button><div class="msg" id="erMsg"></div>
    <p class="hint">Not reached by this: Google Sheets' own version history, the old "Records" archive tab from v15, and Drive's bin (emptied by Google after 30 days).</p>`);
  const upd = () => { $('erGo').disabled = !($('erCode').value && $('erWord').value === 'ERASE'); };
  ['erCode', 'erWord'].forEach(x => $(x).addEventListener('input', upd));
  $('erGo').addEventListener('click', async () => {
    const m = $('erMsg');
    if (Date.now() < +(lsGet('r2_eraseLock') || 0)) { m.className = 'msg err'; m.textContent = 'Too many wrong codes. Try again in a few minutes.'; return; }
    $('erGo').disabled = true; m.className = 'msg'; m.textContent = 'Checking…';
    if ((await eraseHash($('erCode').value, r.salt)) !== r.hash) {
      const fails = +(lsGet('r2_eraseFails') || 0) + 1; lsSet('r2_eraseFails', fails);
      if (fails >= 3) { lsSet('r2_eraseLock', Date.now() + 10 * 60000); lsSet('r2_eraseFails', 0); }
      m.className = 'msg err'; m.textContent = fails >= 3 ? 'Wrong erase code. Locked for 10 minutes.' : 'Wrong erase code.'; $('erGo').disabled = false; return;
    }
    lsSet('r2_eraseFails', 0);
    const cloudOn = $('erCloud').checked, proof = await eraseProof($('erCode').value, r.salt);
    let n = 10;
    $('erGo').outerHTML = '<button class="btn block" id="erCancel">Cancel — keep my data</button>';
    m.className = 'msg err'; m.textContent = `Erasing in ${n}…`;
    $('erCancel').addEventListener('click', () => { clearInterval(eraseTimer); eraseTimer = null; Sheets.close('shErase', true); toast('Erase cancelled. Nothing was deleted.'); });
    eraseTimer = setInterval(() => {
      n--; if (n > 0) { m.textContent = `Erasing in ${n}…`; return; }
      clearInterval(eraseTimer); eraseTimer = null; const cb = $('erCancel'); if (cb) cb.remove(); doErase(cloudOn, proof);
    }, 1000);
  });
}
Sheets.onClose.shErase = () => { if (eraseTimer) { clearInterval(eraseTimer); eraseTimer = null; toast('Erase cancelled. Nothing was deleted.'); } };
async function doErase(cloudOn, proof) {
  const m = $('erMsg'); window.__erasing = true; clearTimeout(Sync.timer);
  RLOG.warn('EMERGENCY ERASE started', cloudOn ? 'cloud+device' : 'device');
  if (cloudOn) {
    try { await wipeCloud(t => { m.textContent = t; }, proof); }
    catch (e) {
      window.__erasing = false;
      m.textContent = 'The Google Sheet could not be erased (' + (e.message || e) + '). Nothing on this device has been deleted yet.';
      $('erBody').insertAdjacentHTML('beforeend', '<div class="btn-row"><button class="btn ghost" id="erRetry">Try again</button><button class="btn danger" id="erLocal">Erase this device only</button></div>');
      $('erRetry').addEventListener('click', () => doErase(true, proof)); $('erLocal').addEventListener('click', () => doErase(false));
      return;
    }
  }
  m.textContent = 'Erasing this device…';
  await wipeDevice();
}
async function wipeCloud(say, proof) {
  say('Reading the Sheet…');
  const d = await Sync.call('pull', { since: 0 }, 180000);
  const ids = new Set((d.records || []).map(r => r.id));
  Object.keys(records).forEach(i => ids.add(i)); Object.keys(sealed).forEach(i => ids.add(i));
  const files = new Set();
  (d.records || []).forEach(r => { if (r.type === 'docfile' || r.type === 'blob') { try { const p = JSON.parse(r.payload); if (p.fileId) files.add(p.fileId); } catch (e) {} } });
  Object.values(records).forEach(r => { if (r.fileId) files.add(r.fileId); });
  (d.records || []).forEach(r => { if (r.type === 'archent') { try { const p = JSON.parse(r.payload); if (p.fileId) files.add(p.fileId); } catch (e) {} } });
  (d.records || []).forEach(r => { if (r.type === 'archidx') { try { (JSON.parse(r.payload).list || []).forEach(a => { if (a.fileId) files.add(a.fileId); }); } catch (e) {} } });
  archIndex().forEach(a => { if (a.fileId) files.add(a.fileId); });
  AutoBackup.list().forEach(b => { if (b.fileId) files.add(b.fileId); });
  let n = 0;
  for (const f of files) { say(`Removing Drive files… ${++n} of ${files.size}`); try { await Sync.call('driveDelete', { fileId: f }, 60000); } catch (e) { RLOG.warn('erase: drive file', e.message); } }
  for (let k = 0, more = true; more && k < 30; k++) {                        // everything else in the Register folder (backups from other devices…)
    say('Emptying the Register folder…');
    try { const r = await Sync.call('driveEmptyFolder', { confirm: 'ERASE', proof: proof || '' }, 300000); more = !!r.more; } catch (e) { RLOG.warn('erase: empty folder', e.message); more = false; }
  }
  const list = [...ids], now = Date.now() + 86400000, at = Date.now();
  for (let i = 0; i < list.length; i += 200) {
    const batch = list.slice(i, i + 200).map(id => ({ id, type: 'erased', updatedAt: now, deleted: false, summary: '', payload: JSON.stringify({ id, type: 'erased', updatedAt: now, at, deleted: false }) }));
    const r = await Sync.call('push', { records: batch }, 180000);
    if ((r.stale || []).length) { RLOG.warn('erase: stale rows', r.stale.length); window.__eraseStale = (window.__eraseStale || 0) + r.stale.length; }
    say(`Erasing the Sheet… ${Math.min(i + 200, list.length)} of ${list.length}`);
  }
}
async function wipeDevice() {
  window.__erasing = true;
  await new Promise(res => {
    try {
      const rq = indexedDB.open('register2');
      rq.onsuccess = () => { const db = rq.result; const names = [...db.objectStoreNames]; if (!names.length) { db.close(); return res(); }
        const t = db.transaction(names, 'readwrite'); names.forEach(n => t.objectStore(n).clear());
        t.oncomplete = () => { db.close(); res(); }; t.onerror = () => { db.close(); res(); }; };
      rq.onerror = () => res();
    } catch (e) { res(); }
  });
  records = {}; sealed = {}; storeVer++;
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) {}
  try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } catch (e) {}
  location.replace(location.pathname);
}

