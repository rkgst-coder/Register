/* ==========================================================================
   v2.18 — encrypted backup, restore preview, security check-up
   ======================================================================== */
$('setBackupEnc').addEventListener('click', async () => {
  const m = $('setDataMsg');
  if (!Fin.key) { m.className = 'msg err'; m.textContent = 'Unlock first.'; return; }
  m.className = 'msg'; m.textContent = 'Encrypting…';
  try {
    const rows = backupRows(), body = await AutoBackup.pack(rows);
    const saved = await shareOrDownload(body, 'register-backup-' + todayISO() + '.rgbk', 'application/octet-stream');
    if (saved === false) { m.className = 'msg'; m.textContent = 'Backup not saved (cancelled).'; return; }   // v2.36
    noteOutBackup();
    m.className = 'msg ok'; m.textContent = `Encrypted backup of ${rows.length} items created. Everything in it is locked with your private code — keep that code safe, the file cannot be opened without it. ${OUT_BK_HELP} Document photos and PDFs are not inside it; they stay in your Drive folder.`;
    toast('Backup made. ' + OUT_BK_HELP, null, null, 9000);
  } catch (e) { m.className = 'msg err'; m.textContent = 'Could not make the backup: ' + (e.message || e); }
});

const RESTORE_LABELS = { task: 'Tasks', note: 'Notes', date: 'Key dates', doc: 'Documents', docfile: 'Document files', blob: 'Pictures', inbox: 'Inbox items', template: 'Templates', billpay: 'Bill payments', oldbill: 'Old bills' };
/* What would a backup file do? Counted only — nothing is changed. */
function restorePlan(arr) {
  const P = { total: arr.length, unusable: 0, fresh: 0, newer: 0, same: 0, deleted: 0, sealedRows: 0, legacyMoney: 0, byType: {}, ignored: 0 };
  arr.forEach(r => {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.type !== 'string' || !REC_ID_RX.test(r.id) || !REC_TYPE_RX.test(r.type)) { P.unusable++; return; }
    if (r.type === 'settings' || r.type === 'erased') { P.ignored++; return; }
    const sealedType = SEALED_TYPES.has(r.type);
    if (sealedType && !r.enc) P.legacyMoney++;
    if (sealedType) P.sealedRows++; else P.byType[r.type] = (P.byType[r.type] || 0) + 1;
    if (r.deleted) P.deleted++;
    const local = (sealedType ? sealed : records)[r.id], ts = +r.updatedAt || 0;
    if (!local) P.fresh++; else if (sealedType && !r.enc) P.newer++; else if (ts > (+local.updatedAt || 0)) P.newer++; else P.same++;
  });
  return P;
}
function confirmRestore(P, fileName) {
  return new Promise(res => {
    let done = false; const finish = v => { if (!done) { done = true; res(v); } };
    const grouped = {}; Object.entries(P.byType).forEach(([t, n]) => { const k = RESTORE_LABELS[t] || 'Settings & other'; grouped[k] = (grouped[k] || 0) + n; });
    const types = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    $('rsBody').innerHTML = `<p class="hint" style="margin:0 4px 6px">${esc(fileName || 'Backup file')} · ${P.total.toLocaleString('en-IN')} entries. Nothing has been changed yet.</p>
      <div class="rs-grid"><div><b>${P.fresh}</b>new on this device</div><div><b>${P.newer}</b>would replace an older copy here</div><div><b>${P.same}</b>already here, or newer here — kept</div>${P.unusable || P.ignored ? `<div><b>${P.unusable + P.ignored}</b>skipped (not usable)</div>` : ''}</div>
      <div class="group-title">What is inside</div>
      <div class="group">${types.map(([t, n]) => `<div class="chk-row"><div class="row-main"><div class="row-title">${esc(t)}</div></div><b>${n}</b></div>`).join('')}
        ${P.sealedRows ? `<div class="chk-row"><div class="row-main"><div class="row-title">${finUnlocked() ? 'Money &amp; private items' : 'Encrypted items'}</div><div class="row-sub">${P.legacyMoney ? `${P.legacyMoney} from the old app will be encrypted with your private code` : 'stay encrypted'}</div></div><b>${P.sealedRows}</b></div>` : ''}</div>
      ${P.deleted ? `<p class="hint">${P.deleted} of these are items that were deleted when the backup was made; they come back as deleted.</p>` : ''}
      <p class="hint">Restoring never removes anything on this device. A copy is replaced only when the backup's copy is newer.</p>`;
    $('rsGo').disabled = !(P.fresh + P.newer); $('rsGo').textContent = P.fresh + P.newer ? `Restore ${P.fresh + P.newer}` : 'Nothing to restore';
    $('rsGo').onclick = () => { finish(true); Sheets.close('shRestore', true); };
    Sheets.onClose.shRestore = () => finish(false);
    Sheets.open('shRestore');
  });
}

/* v2.21 (A5): what the record count is made of — your items, trash, and the app's own records */
const RECORD_WORDS = { task: 'tasks', note: 'notes', date: 'dates', doc: 'documents', docfile: 'document files', inbox: 'inbox items', template: 'templates', bill: 'bills' };
function recordSplit() {
  const out = { live: 0, trash: 0, sys: 0, enc: Object.keys(sealed).length, byType: {} };
  Object.values(records).forEach(r => {
    if (SEALED_TYPES.has(r.type)) return;
    if (r.deleted) { if (r.deletedAt > 1 && RECORD_WORDS[r.type]) out.trash++; else out.sys++; return; }
    if (RECORD_WORDS[r.type]) { out.live++; out.byType[r.type] = (out.byType[r.type] || 0) + 1; } else out.sys++;
  });
  return out;
}
/* Looks only at this device: nothing is sent anywhere. */
function securityChecks() {
  const out = [], unlocked = finUnlocked(), fk = records[FINKEY_ID];
  const add = (state, t, d, act) => out.push({ state, t, d, act });
  if (!unlocked) { /* v2.20: the private section is not mentioned while it is locked */ }
  else {
    if (Fin.codeLen && Fin.codeLen < 12) add('warn', 'Private code is short', `It is ${Fin.codeLen} characters. A phrase of four or more words is much harder to guess.`, { label: 'Change code', fn: () => openVault('change') });
    else if (Fin.codeLen) add('ok', 'Private code length', `${Fin.codeLen} characters.`);
    const it = fk ? (+fk.iters || FIN_ITERS) : FIN_ITERS_NEW;
    if (it < FIN_ITERS_NEW) add('warn', 'Older key setting', `Your code is stretched ${it.toLocaleString('en-IN')} times; new codes use ${FIN_ITERS_NEW.toLocaleString('en-IN')}. Changing the code upgrades it — your other devices will ask for the new code.`, unlocked ? { label: 'Change code', fn: () => openVault('change') } : null);
    else add('ok', 'Key setting', 'Uses the current strength.');
  }
  if (Sync.on()) {
    const tl = String(prefs.cloudToken || '').length;
    if (tl < 24) add('warn', 'Sync token is short', `It is ${tl} characters, so it can be guessed. Anyone who has it can read everything in the Sheet that is not encrypted, and the Drive files. In Apps Script run makeToken, paste the long token into SECRET and into Settings → Token, then deploy a new version.`);
    else add('ok', 'Sync token', 'Long enough.');
  } else add('info', 'Sync', 'Not connected — nothing leaves this device.');
  if (unlocked) add('info', 'What is encrypted', 'Money, Plan, private notes (PNote), the Emergency sheet, locked document files and locked document numbers are encrypted with your private code. Tasks, notes, dates and other document details are plain text in your Google Sheet — keep official case details out of them.');
  if ((Fin.tampered || []).length) add('warn', `${Fin.tampered.length} private entr${Fin.tampered.length > 1 ? 'ies' : 'y'} failed the integrity check`, 'Their outer details in the Sheet do not match the encrypted copy. They are not shown. Review them in Settings → Backup & Data → Data health.', { label: 'Data health', fn: () => { Sheets.close('shSecCheck', true); openDataHealth(); } });
  const ids = all('doc').filter(d => d.docType === 'Identity' && !d.lockFiles && (d.number || docFilesOf(d.id).length));
  if (ids.length) add('warn', `${ids.length} ID document${ids.length > 1 ? 's' : ''} not locked`, 'Numbers (Aadhaar, PAN…) are in your Sheet as plain text and the files in Drive are not encrypted. Open each one and switch on “Lock files”: ' + ids.slice(0, 4).map(d => d.title).join(', ') + (ids.length > 4 ? '…' : '') + '.', { label: 'Open first', fn: () => { Sheets.close('shSecCheck', true); Sheets.close('shSettings', true); showTab('docs'); openDoc(ids[0].id); } });
  else if (all('doc').some(d => d.docType === 'Identity')) add('ok', 'ID documents', 'All locked.');
  const last = lastOutBackup(), days = last ? Math.floor((Date.now() - last) / 86400000) : null;   // v2.36: a copy outside Google
  if (days == null || days > 30) add('warn', days == null ? 'No backup saved outside Google' : `Last backup ${days} days ago`, 'A backup file is your way back if the phone is lost.', unlocked ? { label: 'Encrypted backup', fn: () => $('setBackupEnc').click() } : { label: 'Download backup', fn: () => $('setBackup').click() });
  else add('ok', 'Backup', days === 0 ? 'Made today.' : `Made ${days} day${days > 1 ? 's' : ''} ago.`);
  if (driveOn()) { if (prefs.autoBackup) add('ok', 'Weekly Drive backup', 'On.'); else add('warn', 'Weekly Drive backup is off', 'It keeps encrypted copies in your Drive folder. Turn it on in Settings → Data' + (unlocked ? ' (needs Money unlocked)' : '') + '.'); }
  if (AppLock.on()) add('ok', 'Face ID to open', 'On. It is a screen lock: it stops someone opening the app. What is stored on the phone is protected by the iPhone passcode, not by this lock.'); else add('warn', 'Face ID to open is off', 'Anyone who opens the app past the decoy screen sees your tasks, notes and documents.', { label: 'Turn on', fn: () => { Sheets.close('shSecCheck', true); $('setAppLock').click(); } });
  if (prefs.decoyLaunch) add('ok', 'Decoy screen', 'Shown when the app opens.'); else add('warn', 'Decoy screen is off at launch', 'The app opens straight onto your data.', { label: 'Turn on', fn: () => { setPref('decoyLaunch', true); if ($('setDecoy')) $('setDecoy').checked = true; } });
  if (+prefs.appIdle > 0) add('ok', 'Idle lock', `After ${prefs.appIdle} minute${+prefs.appIdle > 1 ? 's' : ''}.`); else add('warn', 'The app never locks when idle', 'If you leave it open, it stays open.', { label: 'Lock after 5 min', fn: () => { setPref('appIdle', 5); if ($('setAppIdle')) $('setAppIdle').value = '5'; } });
  return out;
}
function openSecCheck() {
  const L = securityChecks(), warn = L.filter(c => c.state === 'warn').length;
  $('scBody').innerHTML = `<div class="sc-sum">${warn ? `${warn} thing${warn > 1 ? 's' : ''} worth fixing` : 'Nothing to fix'}</div><div class="group">${L.sort((a, b) => (b.state === 'warn') - (a.state === 'warn')).map((c, i) => `<div class="chk-row"><span class="sc-ic ${c.state}" aria-hidden="true">${c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : 'i'}</span><div class="row-main"><div class="row-title">${esc(c.t)}</div><div class="row-sub" style="white-space:normal">${esc(c.d)}</div></div>${c.act ? `<button class="btn small sc-act" data-sca="${i}">${esc(c.act.label)}</button>` : ''}</div>`).join('')}</div>
    <p class="hint">This looks only at settings on this device. It cannot see your Google account or Sheet.</p>`;
  $$('[data-sca]', $('scBody')).forEach(b => b.addEventListener('click', () => { const c = L[+b.dataset.sca]; c.act.fn(); if (Sheets.isOpen('shSecCheck')) openSecCheck(); }));
  if (!Sheets.isOpen('shSecCheck')) Sheets.open('shSecCheck');
}
$('setSecCheck').addEventListener('click', openSecCheck);

