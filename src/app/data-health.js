/* ==========================================================================
   v2.19 — Data health: one place to see that everything is safe
   ======================================================================== */
async function openDataHealth() {
  if (window.GHOST) { ghostCrash(true); return; }
  const rows = [], add = (state, t, d, act) => rows.push({ state, t, d, act });
  const dirty = Object.values(records).filter(r => r._dirty && !SEALED_TYPES.has(r.type) && !LOCAL_ONLY_TYPES.has(r.type)).length + Object.values(sealed).filter(s => s._dirty).length;
  if (!Sync.on()) add('warn', 'Sync is off', 'Everything stays on this device only. A lost phone means lost data unless you keep backup files.', { label: 'Set up', fn: () => { Sheets.close('shHealth', true); openSettings(); setShowPage('sync'); } });
  else {
    const age = Sync.lastOk ? Date.now() - Sync.lastOk : Infinity;
    add(age > 3 * 86400000 ? 'warn' : 'ok', 'Last sync', `${Sync.lastOk ? timeAgo(Sync.lastOk) : 'never'}${dirty ? ` · ${dirty} change${dirty > 1 ? 's' : ''} waiting to upload` : ' · everything uploaded'}.`, { label: 'Sync now', fn: async () => { await Sync.run(true); openDataHealth(); } });
    add('info', 'Compare with the Sheet', 'Downloads everything again and lists anything the Sheet has that this device is not showing (and the reverse). Nothing is deleted.', { label: 'Check', fn: () => { Sheets.close('shHealth', true); sheetCompare(); } });   // v2.33
    if (Sync.incomplete) add('warn', 'Long items still arriving', `${Sync.incomplete} long item${Sync.incomplete > 1 ? 's' : ''} from another device did not arrive complete. They will on a later sync.`);
  }
  const lastDl = lastOutBackup(), drv = AutoBackup.list().slice(-1)[0];                                            // v2.36: the copy outside Google is what is watched
  const bkDays = lastDl ? Math.floor((Date.now() - lastDl) / 86400000) : null;
  add(bkDays == null || bkDays > 35 ? 'warn' : 'ok', 'Backup outside Google', `${lastDl ? (bkDays === 0 ? 'Saved today' : 'Saved ' + bkDays + ' day' + (bkDays > 1 ? 's' : '') + ' ago') : 'Never saved'}. The Sheet, the Drive folder and the weekly Drive backup are all in one Google account; this file is the copy that survives losing it.${drv ? ` Drive copy: ${fmtDate(drv.date, true)} (${drv.count} items).` : prefs.autoBackup ? '' : ' Weekly Drive backup is off.'}`,
    { label: 'Save a copy', fn: () => $(Fin.key ? 'setBackupEnc' : 'setBackup').click() });
  const big = [...Object.values(records).filter(r => r._tooBig && !r.deleted && !SEALED_TYPES.has(r.type)), ...Object.values(sealed).filter(s => s._tooBig && !s.deleted)];
  const chunked = Object.values(records).filter(r => r._chunked && !r.deleted).length + Object.values(sealed).filter(s => s._chunked && !s.deleted).length;
  if (big.length) add('warn', `${big.length} item${big.length > 1 ? 's' : ''} not in the Sheet`, 'Too large even when split. They are only on this device: ' + big.slice(0, 5).map(r => (records[r.id] && (records[r.id].title || records[r.id].label || records[r.id].desc)) || r.type).join(', ') + (big.length > 5 ? '…' : '') + '. Shorten or split them.');
  else add('ok', 'Item sizes', chunked ? `${chunked} long item${chunked > 1 ? 's are' : ' is'} stored in parts — that is fine.` : 'Everything fits in the Sheet.');
  let pers = null, est = null;
  try { if (navigator.storage && navigator.storage.persisted) pers = await navigator.storage.persisted(); } catch (e) {}
  try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) {}
  const mb = n => (n / 1048576).toFixed(n > 104857600 ? 0 : 1) + ' MB';
  add(pers === false ? 'warn' : pers ? 'ok' : 'info', 'Storage on this device', `${pers ? 'Kept: the browser will not clear it to save space.' : pers === false ? 'Not marked as permanent: under low storage the browser may clear it. Keep sync and backups on.' : 'This browser does not say.'}${est && est.usage ? ` Using ${mb(est.usage)}${est.quota ? ' of ' + mb(est.quota) : ''}.` : ''}`,
    pers === false && navigator.storage && navigator.storage.persist ? { label: 'Ask again', fn: async () => { try { window.__persist = await navigator.storage.persist(); } catch (e) {} openDataHealth(); } } : null);
  const dc = DriveChk.get(), bad = DriveChk.bad().length;
  if (driveOn()) add(bad ? 'warn' : 'ok', 'Files in Drive', `${dc ? 'Checked ' + timeAgo(dc.at) : 'Not checked yet'}${bad ? ` · ${bad} missing` : ''}.`, { label: bad ? 'Review' : 'Check now', fn: () => { Sheets.close('shHealth', true); openDriveChk(); if (!bad) DriveChk.run(true); } });
  if (finConfigured()) {
    if (!Fin.key) { /* v2.20: nothing about the private section while it is locked */ }
    else {
      if (Fin.lockedOut.length) add('warn', `${Fin.lockedOut.length} private entr${Fin.lockedOut.length > 1 ? 'ies' : 'y'} under an older code`, 'Open Money — it asks for the older code once and brings them across.', { label: 'Open Money', fn: () => { Sheets.close('shHealth', true); showTab('money'); } });
      if (Fin.tampered.length) add('warn', `${Fin.tampered.length} private entr${Fin.tampered.length > 1 ? 'ies' : 'y'} failed the integrity check`, 'The details next to the encrypted copy in the Sheet do not match it (id, date, deleted). They are hidden. If you restored an old backup or edited the Sheet by hand, accepting is safe; otherwise someone may have changed the Sheet.', { label: 'Accept all', fn: async () => { let k = 0; for (const id of Fin.tampered.slice()) if (await acceptTampered(id)) k++; toast(`${k} accepted.`); scheduleRender(); openDataHealth(); } });
      if (!Fin.lockedOut.length && !Fin.tampered.length) add('ok', 'Private entries', `All ${Object.keys(sealed).length} encrypted entries open and pass the integrity check.`);
    }
  }
  const sc = scanIdxStats();
  if (sc.total) add(sc.todo ? 'info' : 'ok', 'Searchable files', `${sc.done} of ${sc.total} PDFs can be searched by their words${sc.none ? ` (${sc.none} are photos without text)` : ''}${sc.locked ? `; ${sc.locked} locked PDF${sc.locked > 1 ? 's are' : ' is'} not indexed` : ''}.`, sc.todo ? { label: 'Index ' + sc.todo, fn: () => { Sheets.close('shHealth', true); indexAllScans(); } } : null);
  { const c = recordSplit(), by = Object.entries(c.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${RECORD_WORDS[t] || t}`).join(', ');
    add('info', 'This device', `Register v${APP_VERSION}. Your items: ${c.live.toLocaleString('en-IN')}${by ? ' (' + by + ')' : ''}. In Recently deleted: ${c.trash}. App and system records (pictures, settings, sync pieces${finUnlocked() ? ', private entries' : ''}): ${(c.sys + c.enc).toLocaleString('en-IN')}.`); }
  try { healthExtra(add); } catch (e) { RLOG.warn('health extra', e.message); }   // v2.24: devices, changed on two devices, files on this device
  const warn = rows.filter(r => r.state === 'warn').length;
  $('hlBody').innerHTML = `<div class="sc-sum">${warn ? `${warn} thing${warn > 1 ? 's' : ''} to look at` : 'All good'}</div><div class="group">${rows.map((c, i) => `<div class="hl-row"><span class="sc-ic ${c.state}" aria-hidden="true">${c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : 'i'}</span><div class="row-main"><div class="row-title">${esc(c.t)}</div><div class="row-sub">${esc(c.d)}</div></div>${c.act ? `<button class="btn small ghost" data-hla="${i}">${esc(c.act.label)}</button>` : ''}</div>`).join('')}</div>
    <p class="hint">Looks at this device and its last sync. Nothing is sent anywhere.</p>`;
  $$('[data-hla]', $('hlBody')).forEach(b => b.addEventListener('click', () => rows[+b.dataset.hla].act.fn()));
  $('setHealthV').textContent = warn ? warn + ' to look at' : '✓';
  if (!Sheets.isOpen('shHealth')) Sheets.open('shHealth');
}

