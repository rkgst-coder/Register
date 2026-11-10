/* ==========================================================================
   APP — tabs, search, privacy (decoy + private section), settings, import, boot
   ======================================================================== */
let currentTab = 'tasks';
const TAB_SCREENS = { tasks: 'scr-tasks', notes: 'scr-notes', dates: 'scr-dates', docs: 'scr-docs', money: 'scr-money' };
function showTab(tab) {
  if (tab === 'money' && !finUnlocked()) tab = 'tasks';
  if (currentTab !== tab) $('main').scrollTop = 0;
  currentTab = tab;
  if (tab !== 'money') setPref('lastTab', tab);
  Object.entries(TAB_SCREENS).forEach(([k, id]) => $(id).classList.toggle('on', k === tab));
  document.documentElement.classList.toggle('on-money', tab === 'money');
  if (Sel.kind) selEnd(); document.documentElement.classList.remove('fab-hide');   // v2.20: Money's section bar sits fixed above the tab bar
  $$('.tab').forEach(t => { const on = t.dataset.tab === tab; t.classList.toggle('on', on); t.setAttribute('aria-current', on ? 'page' : 'false'); });
  renderAll();
}
$$('.tab').forEach(t => t.addEventListener('click', () => {
  if (t.dataset.tab === currentTab) { $('main').scrollTo({ top: 0, behavior: 'smooth' }); if (currentTab === 'notes' && activeFolder !== '__all__') { activeFolder = '__all__'; renderNotes(); } if (currentTab === 'dates' && datePath) { datePath = null; renderDates(); } if (currentTab === 'docs' && (docPath.who || activeDocFolder !== '__all__')) { activeDocFolder = '__all__'; docPath = { who: null, grp: null }; renderDocs(); } return; }
  showTab(t.dataset.tab);
}));
function renderAll() {
  if (typeof updateTodayBadge === 'function') setTimeout(updateTodayBadge, 0);
  const n = new Date();
  $('todayLbl').textContent = n.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  updateDateBadge();
  if (currentTab === 'tasks') renderTasks();
  else if (currentTab === 'notes') renderNotes();
  else if (currentTab === 'dates') renderDatesTab();
  else if (currentTab === 'docs') renderDocs();
  else if (currentTab === 'money') renderMoney();
}

/* ---------- search ---------- */
function hl(text, q) {
  const s = String(text || ''), i = s.toLowerCase().indexOf(q);
  if (i < 0) return esc(s.slice(0, 80));
  const from = Math.max(0, i - 25);
  return (from ? '…' : '') + esc(s.slice(from, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length, i + q.length + 50));
}
function runSearchBase() {
  const q = $('searchIn').value.trim().toLowerCase(), box = $('searchRes');
  if (!q) { box.innerHTML = '<div class="empty">Type to search tasks, steps, notes, dates and documents (try “aadhar ruchi”), or ask: “when does Ruchi\'s passport expire?”, “birthdays this month”' + (finUnlocked() ? ', “spent on food in August” — and Money' : '') + '.</div>'; return; }
  const hits = [], has = s => String(s || '').toLowerCase().includes(q);
  all('task').forEach(t => {
    if (has(t.title)) hits.push({ k: 'Task', id: t.id, t: hl(t.title, q), s: t.status === 'done' ? 'done' : relDay(t.dueDate) });
    else if (has(t.notes)) hits.push({ k: 'Task', id: t.id, t: esc(t.title) + '<br><small class="muted">' + hl(t.notes, q) + '</small>' });
    else { const st = (t.subs || []).find(s => has(s.text) || has(s.notes)); if (st) hits.push({ k: 'Step', id: t.id, t: hl(st.text, q) + '<br><small class="muted">in ' + esc(t.title) + '</small>' }); }
  });
  if (finUnlocked()) all('snote').forEach(n => { if (has(n.title) || has(n.text) || has(n.folder) || (n.tables || []).some(t => has(t.title) || (t.rows || []).some(r => r.c.some((v, i) => t.cols[i] && !t.cols[i].s && has(v))))) hits.push({ k: 'Private', id: n.id, t: has(n.title) ? hl(n.title, q) : esc(n.title || 'Untitled') + '<br><small class="muted">' + hl(n.text, q) + '</small>', s: 'private note' }); });
  all('note').forEach(n => { if (has(n.title) || has(n.text) || has(n.folder)) hits.push({ k: 'Note', id: n.id, t: has(n.title) ? hl(n.title, q) : esc(n.title || 'Untitled') + '<br><small class="muted">' + hl(n.text, q) + '</small>', s: n.folder || '' }); });
  all('date').forEach(d => { if (has(d.label)) hits.push({ k: 'Date', id: d.id, t: hl(d.label, q), s: d.when ? fmtDate(isoLocal(nextOccurrence(d))) : 'no date yet' }); });
  { const norm = s => String(s || '').toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence');
    const toks = norm(q).split(/\s+/).filter(Boolean), docHits = [];
    all('doc').forEach(d => {
      const own = docOwners(d), files = docFilesOf(d.id).map(f => f.name + ' ' + (f.txt || '')).join(' ');
      const hay = norm([d.title, own.join(' '), d.who, d.docType, docGroup(d), d.number, d.numTail, d.notes, d.issuer, d.fy ? 'fy ' + d.fy + ' ' + d.fy : '', docYears(d).join(' '), files].join(' | '));
      if (!toks.every(tk => hay.includes(tk) || (PERSON_ALIAS[tk] && hay.includes(PERSON_ALIAS[tk].toLowerCase())))) return;
      const sub = [docGroup(d) + ' › ' + d.docType, d.fy ? 'FY ' + d.fy : '', docNumShown(d)].filter(Boolean).join(' · ');
      const plainHay = norm([d.title, own.join(' '), d.who, d.docType, docGroup(d), d.number, d.numTail, d.notes, d.issuer, docFilesOf(d.id).map(f => f.name).join(' ')].join(' '));
      const sn = toks.some(tk => !plainHay.includes(tk)) ? docTextSnippet(d, toks) : null;      // found inside a PDF's words
      docHits.push({ k: 'Doc', id: d.id, own, t: hl(d.title, toks[0]) + ` · <b>${esc(own.join(' & '))}</b><br><small class="muted">${esc(sub)}</small>${sn ? `<br><small class="muted">📄 ${sn.html}</small>` : ''}`, s: own.join(' & ') });
    });
    const ordL = orderPeople(docHits.map(h => h.own[0]));
    docHits.sort((a, b) => ordL.indexOf(a.own[0]) - ordL.indexOf(b.own[0])).forEach(h => hits.push(h)); }
  if (finUnlocked()) all('fin').forEach(f => { if (has(f.desc) || has(f.who)) hits.push({ k: '₹', id: f.id, t: hl(f.desc + (f.who ? ' · ' + f.who : ''), q), s: fmtMoney(f.amount) }); });
  const ans = askAnswer($('searchIn').value);
  if (ans) (ans.items || []).slice().reverse().forEach(h => hits.unshift({ ...h, ask: true }));
  box.innerHTML = (ans ? `<div class="ask-card"><div class="ask-h">Answer · from your data on this phone</div><div class="ask-a">${esc(ans.text)}</div></div>` : '') + (hits.length ? hits.filter((h, i, a) => a.findIndex(x => x.id === h.id && x.k === h.k) === i).slice(0, 80).map(h => `<button class="sr" data-k="${h.k}" data-id="${h.id}"><span class="k">${h.k}</span><span class="t" style="white-space:normal">${h.t}</span><span class="s">${esc(h.s || '')}</span></button>`).join('')
    : ans ? '' : '<div class="empty">No matches.</div>');
  $$('.sr', box).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.id, k = b.dataset.k; Sheets.close('shSearch', true);
    if (k === 'Task' || k === 'Step') { showTab('tasks'); previewTask(id); }
    else if (k === 'Note') { showTab('notes'); previewNote(id); }
    else if (k === 'Private') { setPref('moneySeg', 'snotes'); showTab('money'); previewNote(id); }
    else if (k === 'Date') { setPref('dateSeg', 'dates'); datePath = null; showTab('dates'); openDate(id); }
    else if (k === 'Bill') { setPref('dateSeg', 'bills'); showTab('dates'); openBill(id); }
    else if (k === 'Doc') { showTab('docs'); showDoc(id); }
    else if (k === '₹') { const f = records[id]; if (f && f.date) finMonth = f.date.slice(0, 7); setPref('moneySeg', 'ledger'); showTab('money'); openFin(id); }
  }));
}
function openSearch() { const i = $('searchIn'); i.value = ''; runSearch(); Sheets.open('shSearch'); try { i.focus({ preventScroll: true }); } catch (e) { i.focus(); } setTimeout(() => { if (document.activeElement !== i) i.focus(); }, 300); }   // v2.28: focus during the tap so iPhone shows the keyboard
$('searchOpen').addEventListener('click', openSearch);
$('searchIn').addEventListener('input', runSearch);

/* ---------- privacy: decoy screen ---------- */
function showDecoy() {
  Sheets.closeAll(); addDraft = null;
  if (!$('lightbox').classList.contains('hidden')) $('lbClose').click();
  document.documentElement.classList.add('decoy-on');
  $('decoy').classList.remove('hidden'); $('decoy').setAttribute('aria-hidden', 'false');
  $('app').setAttribute('aria-hidden', 'true');
}
let legacyOffer = false;
function offerLegacy() {
  if (!legacyOffer) return; legacyOffer = false;
  setTimeout(() => { if (confirm('Found your data from the previous Register on this device. Bring it into the new version?')) importLegacyLocal(); else { try { localStorage.setItem('r2_legacyDone', '1'); } catch (e) {} } }, 500);
}
function hideDecoy() {
  if ($('alPin')) $('alPin').classList.add('hidden');
  document.documentElement.classList.remove('decoy-on');
  $('decoy').classList.add('hidden'); $('decoy').setAttribute('aria-hidden', 'true');
  $('app').removeAttribute('aria-hidden');
  scheduleRender();
  offerLegacy();
  if (window.__booted && typeof afterAppShown === 'function') afterAppShown();
}
let decoyTaps = 0, decoyT = null;
$('decoyKey').addEventListener('click', () => {
  decoyTaps++; clearTimeout(decoyT); decoyT = setTimeout(() => { decoyTaps = 0; }, 2000);
  if (decoyTaps >= 3) { decoyTaps = 0; decoyUnlock(); }
});
$('decoyRetry').addEventListener('click', () => { const b = $('decoyRetry'); b.disabled = true; b.textContent = 'Retrying…'; setTimeout(() => { b.disabled = false; b.textContent = 'Retry'; }, 1500); });
function hideNow() { lockFinance(true); showDecoy(); }
$('hideBtn').addEventListener('click', hideNow);
let hiddenAt = 0, lastTouch = Date.now();
function flushEdits() {
  try {
    if (typeof teTimer !== 'undefined' && teTimer) { clearTimeout(teTimer); teTimer = null; teSave(); }
    if (typeof neTimer !== 'undefined' && neTimer) { clearTimeout(neTimer); neTimer = null; neSave(); }
    ['shDoc', 'shDate', 'shBill'].forEach(id => { if (Sheets.isOpen(id) && AutoSheet.changed(id)) AutoSheet.save(id); });
  } catch (e) { RLOG.warn('flushEdits', e.message); }
}
window.addEventListener('pagehide', flushEdits);
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));
setInterval(() => { if (finUnlocked() && document.visibilityState === 'visible' && Date.now() - Math.max(lastTouch, Fin.unlockedAt || 0) > (+prefs.moneyIdle || 5) * 60000) { lockFinance(); } }, 30000);   // idle 5 min → lock Money
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = nowMs();
    flushEdits();
    if (finUnlocked()) document.documentElement.classList.add('app-hidden');
    RLOG.flush();
    if (+prefs.decoyReturn === 0) hideNow();          // also keeps the app-switcher preview blank
  } else {
    document.documentElement.classList.remove('app-hidden');
    const secs = +prefs.decoyReturn;
    if (secs > 0 && hiddenAt && nowMs() - hiddenAt >= secs * 1000) hideNow();
    else if (secs < 0 && hiddenAt && nowMs() - hiddenAt >= 300000) lockFinance(true);   // decoy off: still relock money after 5 min
    scheduleRender();                                  // dates roll over at midnight
  }
});

/* ---------- privacy: private Money section (3 taps on "Register") ---------- */
let wmTaps = 0, wmT = null, vaultMode = 'unlock';
$('wordmark').addEventListener('click', () => {
  wmTaps++; clearTimeout(wmT); wmT = setTimeout(() => { wmTaps = 0; }, 2000);
  if (wmTaps < 3) return;
  wmTaps = 0;
  if (window.GHOST) { ghostCrash(true); return; }
  if (finUnlocked()) { showTab('money'); return; }
  if (Fin.key && Fin.scope === 'docs') lockFinance(true);              // v2.27: opening Money always asks for the code
  Fin.wantScope = null;
  openVault();
});
function openVault(mode) {
  if (window.GHOST) { ghostCrash(true); return; }
  vaultMode = mode || (finConfigured() ? 'unlock' : 'setup');
  if (vaultMode === 'setup' && Sync.on() && !Sync.lastOk) {
    toast('Syncing first, so this device picks up your existing code…'); Sync.run().then(ok => { if (ok) openVault(); }); return;
  }
  $('vaCode').value = ''; $('vaCode2').value = ''; $('vaErr').textContent = '';
  const setup = vaultMode === 'setup', change = vaultMode === 'change';
  $('vaTitle').textContent = setup ? 'Private section' : change ? 'New code' : 'Restricted';
  $('vaSub').textContent = setup ? 'Choose an access code. Money entries are encrypted with it — if it is forgotten, they cannot be read.' : change ? 'Enter the new code twice. Everything is re-encrypted with it.' : 'Enter the access code.';
  if (setup && !Sync.on()) $('vaSub').textContent += ' Already use Register on another device? Connect sync first (Settings → Sync), so this device uses the same code.';
  $('vaCode2').classList.toggle('hidden', !(setup || change));
  $('vaOk').textContent = setup ? 'Set code' : change ? 'Change code' : 'Unlock';
  const bioOn = vaultMode === 'unlock' && Bio.on();
  $('vaBio').classList.toggle('hidden', !bioOn);
  Sheets.open('shVault');
  if (bioOn) bioAuto(); else setTimeout(() => $('vaCode').focus(), 320);
}
async function vaultSubmit() {
  const c = $('vaCode').value, c2 = $('vaCode2').value, err = $('vaErr');
  if (vaultMode === 'bioconfirm') {
    try { await Bio.confirm(); Sheets.close('shVault', true); toast('Face ID unlock is on for this device. Next time, opening Money asks for Face ID.'); }
    catch (e) { RLOG.warn('face id confirm', e.name, e.message); err.textContent = e.name === 'NotAllowedError' ? 'Face ID was cancelled or timed out — tap Confirm again.' : (e.message || 'Could not turn on Face ID.'); }
    return;
  }
  if (!c) { err.textContent = 'Enter the code.'; return; }
  if (vaultMode === 'bio') {
    const fk = records[FINKEY_ID];
    try { const k = await deriveFinKey(c, fk.salt, fk.iters); if (await aesDec(k, fk.check) !== 'register-ok') throw new Error('x'); }
    catch (e) { const w = VaultLimit.fail(); err.textContent = w ? `Incorrect code. Wait ${VaultLimit.say(w)}.` : 'Incorrect code.'; return; }
    VaultLimit.reset();
    try { const r = await Bio.enable(c); if (r === 'confirm') { vaultMode = 'bioconfirm'; $('vaSub').textContent = 'Almost done — tap the button below and look at the phone once more.'; $('vaOk').textContent = 'Confirm with Face ID'; return; }
      Sheets.close('shVault', true); toast('Face ID unlock is on for this device.'); }
    catch (e) { RLOG.warn('face id setup', e.name, e.message); err.textContent = e.name === 'NotAllowedError' ? 'Face ID was cancelled or timed out. Check that iCloud Keychain (Passwords) is on, then try again.' : e.name === 'InvalidStateError' ? 'A Register passkey already exists — try again.' : (e.message || 'Could not turn on Face ID.'); }
    return;
  }
  if (vaultMode !== 'unlock') {
    if (c.length < FIN_MIN_CODE) { err.textContent = `Use at least ${FIN_MIN_CODE} characters — a short phrase you can remember is best.`; return; }
    if (c !== c2) { err.textContent = "The two entries don't match."; return; }
    $('vaOk').disabled = true;
    try {
      if (vaultMode === 'setup') await setupFinance(c); else await changeFinanceCode(c);
    } finally { $('vaOk').disabled = false; }
    Sheets.close('shVault', true);
    toast(vaultMode === 'setup' ? 'Private section ready.' : 'Code changed. Other devices will ask for the new one.');
    afterFinanceUnlock(); return;
  }
  const wait = VaultLimit.wait(); if (wait) { err.textContent = `Too many wrong tries. Try again in ${VaultLimit.say(wait)}.`; return; }
  $('vaOk').disabled = true; err.textContent = 'Checking…';
  const ok = await unlockFinance(c);
  $('vaOk').disabled = false;
  if (ok) VaultLimit.reset(); else { const w = VaultLimit.fail(); err.textContent = w ? `Incorrect code. Too many wrong tries — wait ${VaultLimit.say(w)}.` : 'Incorrect code.'; }
  if (!ok) { const card = $('vaultCard'); card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 400); $('vaCode').value = ''; return; }
  Sheets.close('shVault', true);
  afterFinanceUnlock();
}
const VaultLimit = {
  get() { try { return JSON.parse(localStorage.getItem('r2_vf') || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } },
  set(v) { try { localStorage.setItem('r2_vf', JSON.stringify(v)); } catch (e) {} },
  wait() { const v = this.get(); return Math.max(0, v.until - Date.now()); },
  fail() { const v = this.get(); v.n++; if (v.n >= 5) v.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, v.n - 5)); this.set(v); return this.wait(); },
  reset() { this.set({ n: 0, until: 0 }); },
  say(ms) { const s = Math.ceil(ms / 1000); return s >= 60 ? Math.ceil(s / 60) + ' min' : s + ' sec'; }
};
/* v2.27: a code typed for a locked document opens documents only — Money, PNote and Plan stay hidden — and locks again
   once no document screen is open (checked every 20 s) or after 3 minutes. */
const DocUnlock = { t: null, at: 0,
  DOC_SHEETS: ['shDocView', 'shDoc', 'shDocShare', 'shScan', 'shCrop', 'shVault'],
  start() { this.at = Date.now(); this.tick(); },
  tick() { clearTimeout(this.t); this.t = setTimeout(() => { if (!Fin.key || Fin.scope !== 'docs') return;
    const busy = this.DOC_SHEETS.some(id => Sheets.isOpen(id));
    if (!busy || Date.now() - this.at > 180000) { lockFinance(true); toast('Locked documents closed again.'); } else this.tick(); }, 20000); },
  closed() { if (Fin.key && Fin.scope === 'docs' && !this.DOC_SHEETS.some(id => Sheets.isOpen(id))) setTimeout(() => { if (Fin.scope === 'docs' && !this.DOC_SHEETS.some(id => Sheets.isOpen(id))) lockFinance(true); }, 1500); }
};
Sheets.onClose.shVault = () => { if (!Fin.key) { Fin.wantScope = null; pendingAfterUnlock = null; } };   // cancelled
function afterFinanceUnlock() {
  if (Fin.wantScope === 'docs') {                                          // v2.27: documents only
    Fin.scope = 'docs'; Fin.wantScope = null;
    $('moneyTab').classList.add('hidden'); document.documentElement.classList.remove('fin-open');
    sealDocNumbers(); flushPendingPosts(); healFileKeys();
    DocUnlock.start();
    if (pendingAfterUnlock) { const f = pendingAfterUnlock; pendingAfterUnlock = null; docReturn = null; setTimeout(() => { try { f(); } catch (e) { RLOG.error('after unlock', e); } }, 350); return; }
    const back = docReturn; docReturn = null;
    if (back) openDocView(back);
    return;
  }
  Fin.scope = null;
  if (lsGet('r2_seenVer') !== APP_VERSION && !window.GHOST && !document.documentElement.classList.contains('decoy-on')) { lsSet('r2_seenVer', APP_VERSION); setTimeout(() => { if (!Sheets.top()) showWhatsNew(); }, 1200); }   // v2.25
  $('moneyTab').classList.remove('hidden'); document.documentElement.classList.add('fin-open');
  if (typeof finAfterUnlock === 'function') finAfterUnlock();
  sealDocNumbers();
  setTimeout(() => AutoBackup.maybe(), 4000);
  if (Fin.codeLen && Fin.codeLen < FIN_MIN_CODE && !window.__shortCodeNag) { window.__shortCodeNag = true; setTimeout(() => toast(`Your private code is short and could be guessed. Change it to ${FIN_MIN_CODE}+ characters — a short phrase works well.`, 'Change', () => openVault('change'), 9000, { once: 'shortCode' }), 2500); }
  flushPendingPosts(); healFileKeys(); rollAfterSync(); settleErasedWin().catch(e => RLOG.warn('erased win', e.message)); if (typeof syncAllAcctDates === 'function') setTimeout(() => { try { syncAllAcctDates(); } catch (e) { RLOG.warn('acct dates', e.message); } }, 2500); setTimeout(() => { try { sweepOrphans(); } catch (e) { RLOG.warn('sweep', e.message); } }, 8000); setTimeout(backupNudge, 1500);
  if (pendingGo === 'spend') { pendingGo = null; setTimeout(() => { showTab('money'); openAdd('money'); }, 350); }
  if (pendingAfterUnlock) { const f = pendingAfterUnlock; pendingAfterUnlock = null; docReturn = null; setTimeout(() => { try { f(); } catch (e) { RLOG.error('after unlock', e); } }, 350); return; }
  const back = docReturn; docReturn = null;
  if (back && Sheets.isOpen('shDocView')) { openDocView(back); return; }
  showTab('money');
}
function onFinanceLocked(silent) {
  if (typeof cardLock === 'function') cardLock(true);                   // v2.29
  ['stmBody', 'ulBody', 'tbBody'].forEach(id => { if ($(id)) $(id).innerHTML = ''; });   // v2.25
  if ($('vtBody')) $('vtBody').innerHTML = ''; if ($('docVault')) $('docVault').innerHTML = '';   // v2.23: nothing readable left on screen
  $('moneyTab').classList.add('hidden'); clearFinFilter();
  Bio.pending = null;                                                    // a half-finished Face ID setup keeps no code
  if (!$('lightbox').classList.contains('hidden')) $('lbClose').click();
  if (Sheets.isOpen('shDoc')) { const d = records[editDocId]; if (d && (d.lockFiles || d.numEnc)) { $('doNumber').value = d.numEnc ? '•••• ' + (d.numTail || '') : ''; $('doNumber').disabled = true; } }
  const sd = records[Scan.docId], lockedScan = (Scan.replace && Scan.replace.locked) || (sd && sd.lockFiles);
  ['shFin', 'shSettle', 'shBudget', 'shInsights', 'shUdhLed', 'shStmt', 'shTbl', 'shEmerg', 'shCards', 'shDocView', 'shDocShare', 'shPlan', ...(lockedScan ? ['shScan', 'shCrop'] : [])].forEach(id => Sheets.close(id, true));
  pendingAfterUnlock = null;
  forgetLockedPlain(); forgetSecretImgs();
  if (currentTab === 'money') showTab(prefs.lastTab || 'tasks');
  if (!silent) toast('Private section locked.');
}
$('vaOk').addEventListener('click', vaultSubmit);
const Bio = {
  KEY: 'r2_bio',
  supported() { return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext); },
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  on() { const b = this.get(); return !!(b && finConfigured() && records[FINKEY_ID] && b.kid === records[FINKEY_ID].kid); },
  forget() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
  rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); },
  async wrapKey(prfOut) {
    const base = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('register-bio-v1'), info: te.encode('private-code') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async prf(rawId, salt) {
    const a = await navigator.credentials.get({ publicKey: { challenge: this.rnd(32), allowCredentials: [{ type: 'public-key', id: rawId }], userVerification: 'required', timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } } });
    const r = a.getClientExtensionResults(); if (!r.prf || !r.prf.results || !r.prf.results.first) throw new Error('Face ID unlock is not supported on this device.');
    return r.prf.results.first;
  },
  async enable(code) {
    const salt = this.rnd(32);
    const cred = await navigator.credentials.create({ publicKey: { challenge: this.rnd(32), rp: { name: 'Register' }, user: { id: this.rnd(16), name: 'register-private', displayName: 'Register private section' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000,
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' }, extensions: { prf: { eval: { first: salt } } } } });
    const ext = cred.getClientExtensionResults();
    if (!ext.prf || ext.prf.enabled === false) throw new Error('Face ID unlock is not supported on this device (needs iOS 18 or later).');
    const p = { id: b64(cred.rawId), salt: b64(salt) };
    if (ext.prf.results && ext.prf.results.first) { await this.finish(code, p, ext.prf.results.first); return 'done'; }
    this.pending = { code, ...p }; return 'confirm';            // Safari needs a second tap to read the key (one Face ID per tap)
  },
  async confirm() { const p = this.pending; if (!p) throw new Error('Start again from Settings.'); const out = await this.prf(unb64(p.id), unb64(p.salt)); await this.finish(p.code, p, out); this.pending = null; },
  async finish(code, p, out) { const box = await aesEnc(await this.wrapKey(out), code); localStorage.setItem(this.KEY, JSON.stringify({ id: p.id, salt: p.salt, box, kid: records[FINKEY_ID].kid })); },
  async unlock() {
    const b = this.get(); if (!b) return false;
    const code = await aesDec(await this.wrapKey(await this.prf(unb64(b.id), unb64(b.salt))), b.box);
    const ok = await unlockFinance(code);
    if (!ok) this.forget();
    return ok;
  }
};
let bioAutoRun = false;
function bioAuto() { bioAutoRun = true; $('vaBio').click(); }       // still inside the tap that opened Money, so Face ID may start at once
$('vaBio').addEventListener('click', async () => {
  const auto = bioAutoRun; bioAutoRun = false;
  const err = $('vaErr'); err.textContent = '';
  try { if (await Bio.unlock()) { VaultLimit.reset(); Sheets.close('shVault', true); afterFinanceUnlock(); } else { err.textContent = 'The code changed — enter it once, then turn Face ID on again in Settings.'; $('vaBio').classList.add('hidden'); } }
  catch (e) { RLOG.warn('face id unlock', e.name, e.message); if (auto && e.name === 'NotAllowedError') return; err.textContent = e.name === 'NotAllowedError' ? 'Face ID cancelled — tap Unlock with Face ID, or type the code.' : (e.message || 'Face ID failed.'); }
});
$('setBio').addEventListener('click', () => {
  if (!finUnlocked() && !Bio.on()) { toast('Open Money with your private code first, then turn this on.'); return; }
  if (Bio.on()) { Bio.forget(); $('setBioV').textContent = 'Off'; toast('Face ID unlock turned off on this device.'); return; }
  Sheets.close('shSettings', true);
  vaultMode = 'bio'; $('vaCode').value = ''; $('vaErr').textContent = ''; $('vaCode2').classList.add('hidden'); $('vaBio').classList.add('hidden');
  $('vaTitle').textContent = 'Face ID'; $('vaSub').textContent = 'Enter your private code once. Then Face ID (or fingerprint / Windows Hello) opens Money on this device.'; $('vaOk').textContent = 'Turn on';
  Sheets.open('shVault'); setTimeout(() => $('vaCode').focus(), 320);
});
['vaCode', 'vaCode2'].forEach(i => $(i).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); vaultSubmit(); } }));

/* ---------- look & feel ---------- */
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyLook() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && darkMQ.matches);
  const h = document.documentElement;
  h.setAttribute('data-theme', dark ? 'dark' : 'light');
  h.setAttribute('data-text', prefs.text || 'default');
  h.setAttribute('data-contrast', prefs.contrast ? 'high' : 'normal');
  h.setAttribute('data-hand', prefs.left ? 'left' : 'right');
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = dark ? '#111418' : '#F2EEE3';
  try { localStorage.setItem('r2_look', JSON.stringify({ theme: prefs.theme, text: prefs.text })); } catch (e) {}
}
darkMQ.addEventListener && darkMQ.addEventListener('change', applyLook);

/* ---------- settings ---------- */
$('settingsBtn').addEventListener('click', openSettings);
function openSettings() {
  if (window.GHOST) { ghostCrash(true); return; }
  $('setDecoy').checked = !!prefs.decoyLaunch; $('setDecoyReturn').value = String(prefs.decoyReturn);
  $('setAppLockV').textContent = AppLock.on() ? 'On' : 'Off'; $('setAppIdle').value = String(+prefs.appIdle || 0); $('setMoneyIdle').value = String(+prefs.moneyIdle || 5); $('setMoneyIdleRow').classList.toggle('hidden', !finUnlocked());
  $('setVaultCode').classList.toggle('hidden', !finUnlocked()); $('setVaultLock').classList.toggle('hidden', !finUnlocked());
  $('setBio').classList.toggle('hidden', !finUnlocked() || !Bio.supported()); $('setBioV').textContent = Bio.on() ? 'On' : 'Off';
  ['setAutoBkRow', 'setAutoBkNow', 'setAutoBkTest', 'setBackupEnc'].forEach(i => $(i).classList.toggle('hidden', !finUnlocked()));
  { const w = securityChecks().filter(c => c.state === 'warn').length; $('setSecCheckV').textContent = w ? w + ' to review' : '✓'; }
  $('setIconBadge').checked = !!prefs.iconBadge; $('setDateDays').value = String(prefs.dateBadgeDays || 7); $('setDateSoon').value = String(prefs.dateSoonDays || 30);
  $('setBioDiag').classList.add('hidden'); if (finUnlocked() && Bio.supported()) bioDiag().then(s => { if (s) { $('setBioDiag').textContent = s; $('setBioDiag').classList.remove('hidden'); } });
  $('setDictLang').value = prefs.dictLang || 'en-IN';
  $('setAutoBk').checked = !!prefs.autoBackup; $('setAutoBkInfo').textContent = AutoBackup.info();
  $('setUrl').value = prefs.cloudUrl; $('setToken').value = prefs.cloudToken; $('setDrive').value = prefs.driveFolder;
  $('setTheme').value = prefs.theme; $('setText').value = prefs.text; $('setContrast').checked = !!prefs.contrast; $('setLeft').checked = !!prefs.left;
  $('setStart').value = prefs.startTab; $('setTodayAuto').checked = prefs.todayAuto !== false; $('setSteps').checked = !!prefs.stepsOpen; $('setNoteEdit').checked = !!prefs.noteEdit;
  $('setVer').textContent = 'v' + APP_VERSION;
  { const c = recordSplit(); $('setCount').textContent = `${c.live.toLocaleString('en-IN')} items · ${c.trash} in trash · ${c.sys + c.enc} other`; }
  const dirty = Object.values(records).filter(r => r._dirty && !SEALED_TYPES.has(r.type)).length + Object.values(sealed).filter(s => s._dirty).length;
  const big = Object.values(records).filter(r => r._tooBig && !r.deleted && !SEALED_TYPES.has(r.type)).length + Object.values(sealed).filter(s => s._tooBig && !s.deleted).length;
  $('setSyncInfo').textContent = Sync.on() ? `Last synced ${Sync.lastOk ? timeAgo(Sync.lastOk) : 'never'}${dirty ? ` · ${dirty} change${dirty > 1 ? 's' : ''} waiting to upload` : big ? ` · ${big} item${big > 1 ? 's are' : ' is'} too large for the Sheet and only on this device (shorten or split ${big > 1 ? 'them' : 'it'})` : ' · everything uploaded'}` : 'Not connected — everything stays on this device.';
  $('setSyncMsg').textContent = ''; $('setDriveMsg').textContent = ''; $('setDataMsg').textContent = '';
  const hasOld = !!localStorage.getItem('reg_recs');
  $('setLegacyLocal').classList.toggle('hidden', !hasOld);
  Sheets.open('shSettings');
}
$('setDecoy').addEventListener('change', () => { setPref('decoyLaunch', $('setDecoy').checked); toast($('setDecoy').checked ? 'Decoy on — tap “Register” three times to get in.' : 'Decoy off at launch.'); });
$('setDecoyReturn').addEventListener('change', () => setPref('decoyReturn', +$('setDecoyReturn').value));
$('setHideNow').addEventListener('click', hideNow);
$('setVaultCode').addEventListener('click', () => { Sheets.close('shSettings', true); openVault('change'); });
$('setVaultLock').addEventListener('click', () => { lockFinance(); Sheets.close('shSettings'); });
$('setTheme').addEventListener('change', () => { setPref('theme', $('setTheme').value); applyLook(); });
$('setText').addEventListener('change', () => { setPref('text', $('setText').value); applyLook(); });
$('setContrast').addEventListener('change', () => { setPref('contrast', $('setContrast').checked); applyLook(); });
$('setLeft').addEventListener('change', () => { setPref('left', $('setLeft').checked); applyLook(); });
$('setStart').addEventListener('change', () => setPref('startTab', $('setStart').value));
$('setTodayAuto').addEventListener('change', () => setPref('todayAuto', $('setTodayAuto').checked));
$('setUnmute').addEventListener('click', () => { try { localStorage.removeItem('r2_toastMute'); } catch (e) {} toast('Hidden reminders will show again.'); });
$('setSteps').addEventListener('change', () => { setPref('stepsOpen', $('setSteps').checked); openSteps.clear(); scheduleRender(); });
$('setNoteEdit').addEventListener('change', () => setPref('noteEdit', $('setNoteEdit').checked));
$('setDictLang').addEventListener('change', () => setPref('dictLang', $('setDictLang').value));
$('setConnect').addEventListener('click', async () => {
  const url = normaliseScriptUrl($('setUrl').value), token = $('setToken').value.trim(), msg = $('setSyncMsg');
  $('setUrl').value = url;
  if (!scriptUrlOk(url)) { msg.className = 'msg err'; msg.textContent = 'That should be the https://script.google.com/macros/s/…/exec URL.'; return; }
  if (!token) { msg.className = 'msg err'; msg.textContent = 'Enter the token.'; return; }
  const oldUrl = prefs.cloudUrl;
  // v2.19 (S8): once this device has synced with a Sheet, switching to another script address must be deliberate
  if (oldUrl && oldUrl !== url && (await DB.get('firstSync'))
      && !confirm('This is a different Apps Script address from the one this device syncs with.\n\nYour token and data will be sent to the new address from now on. Only continue if you set up that script yourself.')) { $('setUrl').value = oldUrl; msg.className = 'msg'; msg.textContent = 'Kept the current address.'; return; }
  setPref('cloudUrl', url); setPref('cloudToken', token);
  msg.className = 'msg'; msg.textContent = 'Connecting…';
  try {
    const d = await Sync.call('ping');
    if (!d.v || d.v < 16) throw new Error('This is the old script — paste the new Code.gs (v16) and redeploy.');
    if (oldUrl !== url) {                                                        // new Sheet → fetch everything, and everything local must reach it
      await DB.set('cursor', 0); await DB.set('firstSync', 0); window.__synced = false;
      Object.values(records).forEach(r => { if (!SEALED_TYPES.has(r.type)) r._dirty = 1; }); Object.values(sealed).forEach(s => { s._dirty = 1; });
      await DB.putMany([...Object.values(records).filter(r => !SEALED_TYPES.has(r.type)), ...Object.values(sealed)]);
    }
    msg.textContent = 'Connected. Syncing…';
    const ok = await Sync.run();
    msg.className = 'msg ' + (ok ? 'ok' : 'err'); msg.textContent = ok ? 'Connected and synced.' : 'Connected, but the sync failed — see Download log.';
    if (ok) { msg.textContent += ' Checking for data from the old version…'; const r = await autoMigrate(true); msg.textContent = r.text; msg.className = 'msg ' + (r.ok ? 'ok' : 'err'); }
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'Could not connect: ' + e.message; RLOG.error('connect', e.message); }
});
$('setDisconnect').addEventListener('click', () => {
  if (!confirm('Disconnect sync? Everything stays on this device.')) return;
  setPref('cloudUrl', ''); setPref('cloudToken', ''); $('setUrl').value = ''; $('setToken').value = '';
  Sync.status('', 'Local only'); $('setSyncMsg').textContent = 'Disconnected.';
});
$('syncBtn').addEventListener('click', () => Sync.run(true));
$('setDriveSave').addEventListener('click', () => {
  const raw = $('setDrive').value.trim(), m = $('setDriveMsg');
  if (!raw) { setPref('driveFolder', ''); m.textContent = 'Cleared — pictures will be shrunk into the Sheet.'; return; }
  const id = parseFolderId(raw); if (!id) { m.className = 'msg err'; m.textContent = "Couldn't find a folder ID in that."; return; }
  setPref('driveFolder', id); $('setDrive').value = id; m.className = 'msg ok'; m.textContent = 'Saved. Tap Test to check it works.';
});
$('setDriveTest').addEventListener('click', async () => {
  const m = $('setDriveMsg');
  if (!driveOn()) { m.className = 'msg err'; m.textContent = 'Connect the Sheet and save a folder first.'; return; }
  m.className = 'msg'; m.textContent = 'Testing…';
  try {
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const id = await driveUpload(px, 'register-test.png'); memImg.delete(id); await DB.imgDel(id);
    await driveFetch(id); await driveDelete(id);
    m.className = 'msg ok'; m.textContent = 'Working — upload, read and delete all succeeded.';
  } catch (e) { m.className = 'msg err'; m.textContent = 'Failed: ' + e.message; }
});
$('setTpl').addEventListener('click', () => { Sheets.close('shSettings', true); openTemplates(); });
$('setLog').addEventListener('click', () => { RLOG.flush(); shareOrDownload(RLOG.text() + '\n', 'register-log-' + todayISO() + '.txt', 'text/plain'); });

/* ---------- backup / restore / import ---------- */
function backupRows() {
  const out = [];
  for (const id in records) if (!SEALED_TYPES.has(records[id].type) && !LOCAL_ONLY_TYPES.has(records[id].type)) out.push(stripLocal(records[id]));
  for (const id in sealed) out.push(stripLocal(sealed[id]));
  return out;
}
$('setBackup').addEventListener('click', async () => {
  if (await shareOrDownload(JSON.stringify(backupRows(), null, 1), 'register-backup-' + todayISO() + '.json', 'application/json') === false) return;   // v2.36: cancelled
  noteOutBackup();
  $('setDataMsg').className = 'msg ok'; $('setDataMsg').textContent = finUnlocked() ? 'Backup created. Money entries inside it stay encrypted.' : 'Backup created.';
});
$('setRestore').addEventListener('click', () => $('restoreFile').click());
/* The whole backup (every record, money already sealed) is encrypted again with the private key, so the Drive file is unreadable without the code. */
const AutoBackup = {
  list() { try { return JSON.parse(localStorage.getItem('r2_autobk') || '[]'); } catch (e) { return []; } },
  save(l) { try { localStorage.setItem('r2_autobk', JSON.stringify(l)); } catch (e) {} },
  info() { const l = this.list(), last = l[l.length - 1]; return !driveOn() ? 'Needs the Drive folder in Sync settings.' : last ? `Last: ${fmtDate(last.date, true)} · ${last.count} items · ${l.length} kept` : 'No Drive backup yet.'; },
  due() { const l = this.list(), last = l[l.length - 1]; return !last || Date.now() - last.at > 7 * 86400000; },
  /* the encrypted envelope, shared by the Drive backup and "Download encrypted backup" */
  async pack(rows) { const fk = records[FINKEY_ID]; return JSON.stringify({ v: 1, app: APP_VERSION, at: Date.now(), salt: fk.salt, iters: fk.iters || FIN_ITERS, enc: await aesEnc(Fin.key, JSON.stringify(rows)) }); },
  async maybe() { if (prefs.autoBackup && Fin.key && driveOn() && navigator.onLine && this.due()) { try { await this.run(); } catch (e) { RLOG.warn('auto backup', e.message); } } },
  async run(say) {
    if (!Fin.key) throw new Error('Unlock first.');
    if (!driveOn()) throw new Error('Set the Drive folder in Settings → Sync first.');
    const rows = backupRows(), body = await this.pack(rows);
    const name = 'register-backup-' + todayISO() + '.rgbk', data = b64(te.encode(body));
    if (data.length > 30000000) throw new Error('The backup is larger than the Apps Script accepts (about 22 MB). Use "Download encrypted backup" instead.');   // v2.19 (B10)
    const d = await Sync.call('driveUpload', { folderId: prefs.driveFolder, name, mime: 'application/octet-stream', data }, 240000);
    if (!d.fileId) throw new Error('Drive did not return a file id');
    const l = this.list(); l.push({ fileId: d.fileId, date: todayISO(), at: Date.now(), count: rows.length, name });
    while (l.length > 8) { const old = l.shift(); try { await Sync.call('driveDelete', { fileId: old.fileId }, 60000); } catch (e) { RLOG.warn('old backup delete', e.message); } }
    this.save(l); try { localStorage.setItem('r2_lastBackup', String(Date.now())); } catch (e) {}
    RLOG.info('drive backup', name, rows.length);
    return rows.length;
  },
  async test() {
    const last = this.list().slice(-1)[0]; if (!last) throw new Error('No Drive backup yet.');
    if (!Fin.key) throw new Error('Unlock first.');
    const d = await Sync.call('driveGet', { fileId: last.fileId }, 240000);
    const pack = JSON.parse(td.decode(unb64(d.data)));
    const key = pack.salt === Fin.salt ? Fin.key : null; if (!key) throw new Error('This backup was made under your previous private code. Restore it (download it from Drive, then Restore) and enter that code.');
    const rows = JSON.parse(await aesDec(key, pack.enc));
    if (!Array.isArray(rows) || !rows.every(r => r && r.id && r.type)) throw new Error('The backup file is damaged.');
    return { rows: rows.length, date: last.date };
  }
};
$('setAutoBk').addEventListener('change', () => { setPref('autoBackup', $('setAutoBk').checked); if ($('setAutoBk').checked) AutoBackup.maybe().then(() => { $('setAutoBkInfo').textContent = AutoBackup.info(); }); });
$('setAutoBkNow').addEventListener('click', async () => {
  const m = $('setDataMsg'); m.className = 'msg'; m.textContent = 'Backing up…';
  try { const n = await AutoBackup.run(); m.className = 'msg ok'; m.textContent = `Backed up ${n} items to Drive (encrypted).`; $('setAutoBkInfo').textContent = AutoBackup.info(); }
  catch (e) { m.className = 'msg err'; m.textContent = e.message; }
});
$('setAutoBkTest').addEventListener('click', async () => {
  const m = $('setDataMsg'); m.className = 'msg'; m.textContent = 'Downloading and checking…';
  try { const r = await AutoBackup.test(); m.className = 'msg ok'; m.textContent = `The backup of ${fmtDate(r.date, true)} opens correctly: ${r.rows} items.`; }
  catch (e) { m.className = 'msg err'; m.textContent = e.message; }
});
$('restoreFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    let arr; try { arr = JSON.parse(rd.result); } catch (err) { toast('That file is not a Register backup.'); return; }
    let oldCode = null;
    if (arr && arr.enc && arr.salt) {
      let key = Fin.key && arr.salt === Fin.salt ? Fin.key : null;
      if (!key) { oldCode = prompt('This backup is encrypted. Enter the private code that was in use when it was made:'); if (!oldCode) return;
        try { key = await deriveFinKey(oldCode, arr.salt, arr.iters); } catch (err) { key = null; } }
      try { arr = JSON.parse(await aesDec(key, arr.enc)); } catch (err) { toast('Wrong code, or the file is damaged.'); return; } }
    if (!Array.isArray(arr)) { toast('Unexpected file format.'); return; }
    if (!(await confirmRestore(restorePlan(arr), f.name))) { toast('Restore cancelled. Nothing was changed.'); return; }
    await importRecords(arr, 'backup file');
    if (oldCode && Fin.key && Fin.lockedOut.length) { const n = await recoverLockedOut(oldCode); if (n) toast(`Money entries from the backup re-sealed under your current code (${n}).`); }
  };
  rd.readAsText(f);
});

/* Accepts v1 backups (plaintext money + settings.vaultCode) and v2 backups (sealed money). */
async function importRecords(arr, from) {
  const msg = $('setDataMsg');
  let oldCode = null; const plainMoney = [], rows = [];
  arr.forEach(r => {
    if (!r || !r.id || !r.type) return;
    if (r.type === 'settings') { if (r.vaultCode) oldCode = String(r.vaultCode); return; }
    if (typeof r.id !== 'string' || !REC_ID_RX.test(r.id) || typeof r.type !== 'string' || !REC_TYPE_RX.test(r.type)) return;   // the code is never stored in plaintext again
    if (LOCAL_ONLY_TYPES.has(r.type) || r._chunks) return;
    if (SEALED_TYPES.has(r.type) && !r.enc) plainMoney.push(r); else rows.push({ ...r, updatedAt: r.updatedAt || nowMs() });
  });
  // plain records + already-sealed money
  const n1 = await mergeRemote(rows, true);
  // money from the old app arrives in plaintext → encrypt it with the private code
  let n2 = 0;
  if (plainMoney.length) {
    if (!finUnlocked()) {
      if (finConfigured()) {
        let ok = oldCode ? await unlockFinance(oldCode) : false;
        while (!ok) { const c = prompt(`Enter your private-section code to import ${plainMoney.length} money entries (Cancel to skip them).`); if (c == null) break; ok = await unlockFinance(c); }
      } else if (oldCode) {
        await setupFinance(oldCode);
        toast('Your old Financial code now opens the private Money section.', null, null, 5000);
      } else {
        const c = prompt(`Choose a private-section code to protect ${plainMoney.length} money entries (Cancel to skip them).`);
        if (c) await setupFinance(c);
      }
    }
    if (finUnlocked()) {
      plainMoney.forEach(r => {
        const local = records[r.id];
        if (local && local.updatedAt >= (r.updatedAt || 0)) return;
        const rec = { ...r, updatedAt: r.updatedAt || nowMs() }; delete rec._dirty;
        put(rec, { render: false, keepTime: true }); n2++;
      });
      $('moneyTab').classList.remove('hidden');
    }
  }
  const total = n1 + n2;
  RLOG.info('import from', from, 'records', total, 'money', n2);
  if (msg) { msg.className = 'msg ok'; msg.textContent = `Imported ${total} item${total === 1 ? '' : 's'} from the ${from}${plainMoney.length && !n2 ? ' (money entries skipped)' : ''}.`; }
  toast(`Imported ${total} item${total === 1 ? '' : 's'}.`);
  scheduleRender(); Sync.soon(500);
  return total;
}

/* The previous version (v1) kept encrypted data in this browser's localStorage. */
async function legacyKeyFrom(meta, explain) {
  const dev = localStorage.getItem('reg_devKey');
  if (dev) return crypto.subtle.importKey('raw', unb64(dev), 'AES-GCM', false, ['decrypt']);
  if (meta && meta.wrapPass && meta.saltPass) {
    const pass = prompt('The old app used a passphrase. Enter it to unlock your old data:');
    if (!pass) return null;
    try {
      const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
      const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(meta.saltPass), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const raw = unb64(meta.wrapPass);
      const mk = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, kek, raw.slice(12));
      return crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['decrypt']);
    } catch (e) { toast('That passphrase did not work.'); return null; }
  }
  const code = prompt(explain
    ? 'Your old Sheet data is encrypted with the old app\'s device key, which is not on this device.\n\nIf you have the pairing code (REGKEY-…), paste it here. Otherwise tap Cancel and open Register once on the iPhone that used the old app — it will unlock and upload everything automatically.'
    : 'Paste the pairing code from the old app (REGKEY-…):');
  if (!code) return null;
  try { const body = code.trim().replace(/^REGKEY-/i, '').replace(/\s+/g, ''); return crypto.subtle.importKey('raw', unb64(body + '='.repeat((4 - body.length % 4) % 4)), 'AES-GCM', false, ['decrypt']); }
  catch (e) { toast("That doesn't look like a pairing code."); return null; }
}
async function decryptLegacy(key, payloads) {
  const out = []; let bad = 0;
  for (const p of payloads) { try { out.push(JSON.parse(await aesDec(key, p))); } catch (e) { bad++; } }
  if (bad) RLOG.warn('legacy undecryptable', bad);
  return { out, bad };
}
async function importLegacyLocal() {
  const raw = localStorage.getItem('reg_recs'); if (!raw) { toast('No data from the old app on this device.'); return 0; }
  let meta = {}; try { meta = JSON.parse(localStorage.getItem('reg_meta') || '{}'); } catch (e) {}
  const key = await legacyKeyFrom(meta); if (!key) return 0;
  let packed; try { packed = JSON.parse(raw); } catch (e) { toast('Old data is unreadable.'); return 0; }
  const { out, bad } = await decryptLegacy(key, Object.values(packed));
  if (!out.length) { toast('Could not decrypt the old data with that key.'); return 0; }
  const n = await importRecords(out, 'old app');
  try { localStorage.setItem('r2_legacyDone', '1'); } catch (e) {}
  if (bad) toast(`${bad} old item(s) could not be read.`);
  return n;
}
$('setLegacyLocal').addEventListener('click', importLegacyLocal);

/* Accepts the full /exec URL, the /dev URL, or just the deployment ID (AKfy…). */
function normaliseScriptUrl(v) {
  v = String(v || '').trim();
  if (/^https?:\/\//i.test(v)) return v.replace(/\/dev(\?.*)?$/, '/exec');
  const id = (v.match(/[-\w]{30,}/) || [])[0];
  return id ? `https://script.google.com/macros/s/${id}/exec` : v;
}

/* Bring v1 data across automatically, once:
   1. data the old app left in this browser (decrypted with the key it also left here)
   2. the old encrypted "Records" tab in the Sheet — readable only where the old key exists.
   Nothing here overwrites newer data: every item keeps whichever copy is newest. */
let migrating = false;
async function autoMigrate(fromConnect) {
  if (migrating) return { ok: true, text: 'Already importing…' };
  migrating = true;
  let total = 0, notes = [];
  try {
    const devKey = localStorage.getItem('reg_devKey');
    // 1 — this device's old local data
    if (localStorage.getItem('reg_recs') && localStorage.getItem('r2_legacyDone') !== '1' && devKey) {
      const key = await crypto.subtle.importKey('raw', unb64(devKey), 'AES-GCM', false, ['decrypt']);
      let packed = {}; try { packed = JSON.parse(localStorage.getItem('reg_recs')); } catch (e) {}
      const { out } = await decryptLegacy(key, Object.values(packed));
      if (out.length) { total += await importRecords(out, 'old app on this device'); }
      try { localStorage.setItem('r2_legacyDone', '1'); } catch (e) {}
    }
    // 2 — the old Sheet tab
    const haveData = Object.values(records).some(r => !r.deleted && r.type !== 'finkey');
    // another device already migrated and this one received it through Records2 → nothing to do
    if (Sync.on() && !devKey && haveData) { try { localStorage.setItem('r2_legacySheetDone', '1'); } catch (e) {} }
    if (Sync.on() && localStorage.getItem('r2_legacySheetDone') !== '1') {
      let d = null;
      try { d = await Sync.call('legacy', {}, 90000); } catch (e) { notes.push('Could not read the old tab: ' + e.message); }
      if (d && d.records && d.records.length) {
        const meta = d.meta || {};
        let key = null;
        if (devKey) key = await crypto.subtle.importKey('raw', unb64(devKey), 'AES-GCM', false, ['decrypt']);
        else if (fromConnect) key = await legacyKeyFrom(meta, true);
        if (key) {
          const { out, bad } = await decryptLegacy(key, d.records.map(r => r.payload).filter(Boolean));
          if (out.length) {
            total += await importRecords(out, 'old Sheet tab');
            try { localStorage.setItem('r2_legacySheetDone', '1'); } catch (e) {}
            if (bad) notes.push(`${bad} old row(s) were written with a different key and were skipped.`);
          } else notes.push('The old Sheet rows did not open with the key on this device.');
        } else notes.push(`The old Sheet tab has ${d.records.length} encrypted rows. Its key lives only on the device that used the old app — open Register there once and they will come across to every device.`);
      } else if (d) { try { localStorage.setItem('r2_legacySheetDone', '1'); } catch (e) {} }
    }
  } catch (e) { RLOG.error('autoMigrate', e); notes.push('Import error: ' + e.message); }
  finally { migrating = false; }
  if (total) Sync.soon(300);
  RLOG.info('autoMigrate', total, notes.join(' | '));
  const text = (total ? `Connected — brought in ${total} item${total === 1 ? '' : 's'} from the old version.` : 'Connected and synced.') + (notes.length ? ' ' + notes.join(' ') : '');
  return { ok: !notes.length || !!total, text, total };
}
$('setLegacySheet').addEventListener('click', async () => {
  const m = $('setDataMsg');
  if (!Sync.on()) { m.className = 'msg err'; m.textContent = 'Connect the Sheet first (same script, updated to v16).'; return; }
  m.className = 'msg'; m.textContent = 'Fetching the old tab…';
  try {
    const d = await Sync.call('legacy', {}, 90000);
    if (!d.records || !d.records.length) { m.textContent = 'The old “Records” tab is empty or missing.'; return; }
    const key = await legacyKeyFrom(d.meta || {}); if (!key) { m.textContent = 'Cancelled.'; return; }
    const { out, bad } = await decryptLegacy(key, d.records.map(r => r.payload).filter(Boolean));
    if (!out.length) { m.className = 'msg err'; m.textContent = 'None of the old rows opened with that key.'; return; }
    await importRecords(out, 'old Sheet tab');
    if (bad) toast(`${bad} old row(s) could not be read.`);
  } catch (e) { m.className = 'msg err'; m.textContent = 'Failed: ' + e.message; }
});

/* hardware keyboard: / search, n new */
document.addEventListener('keydown', e => {
  if (Sheets.top() || ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement || {}).tagName)) return;
  if (e.key === '/') { e.preventDefault(); openSearch(); } else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAdd(); }
});

/* ---------- boot ---------- */

