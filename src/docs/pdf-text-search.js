/* ==========================================================================
   v2.19 — words inside PDFs become searchable (PDFs from the iPhone Files
   scanner already carry their text). Locked files are never indexed.
   ======================================================================== */
const SCAN_TXT_MAX = 20000;
async function pdfText(blob) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, ...pdfWorkerOpt() }).promise;
  let out = '';
  try {
    for (let n = 1; n <= Math.min(doc.numPages, 60) && out.length < SCAN_TXT_MAX; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      out += tc.items.map(x => x.str || '').join(' ') + '\n';
    }
  } finally { try { doc.destroy(); } catch (e) {} }
  return out.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, SCAN_TXT_MAX);
}
async function indexFile(f, blob) {
  if (!f || f.deleted || f.locked || !['pdf', 'xls', 'csv', 'word', 'txt'].includes(fileKind(f))) return false;
  let txt = '';
  if (!isPdf(f)) txt = (await officeText(f, blob)).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, SCAN_TXT_MAX);
  else try { txt = await pdfText(blob); } catch (e) { if (e && e.name === 'PasswordException') txt = ''; else throw e; }
  const r = records[f.id]; if (!r || r.deleted || r.locked) return false;
  if (txt) { r.txt = txt; delete r.txtNone; } else { r.txtNone = 1; delete r.txt; }
  put(r, { render: false }); return !!txt;
}
function indexSoon(id, bytes) { setTimeout(() => { const f = records[id]; if (f) indexFile(f, new Blob([bytes], { type: f.mime || 'application/pdf' })).catch(e => RLOG.warn('file text', e.message)); }, 600); }
function scanIdxStats() {
  const L = all('docfile').filter(f => ['pdf', 'xls', 'csv', 'word', 'txt'].includes(fileKind(f)) && records[f.docId] && !records[f.docId].deleted);
  const open = L.filter(f => !f.locked);
  return { total: L.length, locked: L.length - open.length, done: open.filter(f => f.txt).length, none: open.filter(f => f.txtNone).length, todo: open.filter(f => !f.txt && !f.txtNone).length };
}
const scanIdxLabel = () => { const s = scanIdxStats(); return s.todo ? s.todo + ' to do' : s.total ? '✓' : '›'; };
async function indexAllScans() {
  const L = all('docfile').filter(f => ['pdf', 'xls', 'csv', 'word', 'txt'].includes(fileKind(f)) && !f.locked && !f.txt && !f.txtNone && records[f.docId] && !records[f.docId].deleted);
  if (!L.length) { toast(scanIdxStats().total ? 'All PDFs are already searchable.' : 'No PDFs in Docs yet.'); return; }
  jobOpen('Making PDFs searchable');
  let ok = 0, none = 0, i = 0; const bad = [];
  for (const f of L) {
    if (Job.stop) break;
    jobStep(i, L.length, `PDF ${++i} of ${L.length}: ${f.name}`);
    try { const { blob } = await docFileBlob(f); (await indexFile(f, blob)) ? ok++ : none++; }
    catch (e) { bad.push(f.name + ': ' + e.message); }
  }
  jobDone(`${Job.stop ? 'Stopped. ' : ''}${ok} PDF${ok === 1 ? '' : 's'} can now be searched by their words${none ? `; ${none} are photos without a text layer (scan them in the iPhone Files app to get searchable PDFs)` : ''}.${bad.length ? ' Could not read: ' + bad.slice(0, 4).join('; ') : ''}`, bad.length > 0);
}
function docTextSnippet(d, toks) {
  for (const f of docFilesOf(d.id)) { if (!f.txt) continue; const low = f.txt.toLowerCase(), t = toks.find(x => low.includes(x)); if (t) return { f, html: hl(f.txt.replace(/\s+/g, ' '), t) }; }
  return null;
}


(async function boot() {
  try {
    if (PAGE_VERSION !== APP_VERSION) { RLOG.warn('version mismatch', 'page ' + PAGE_VERSION + ' / app.js ' + APP_VERSION); setTimeout(() => toast('Part of the app is still updating.', 'Reload', () => location.reload(), 20000), 1500); }
    await loadPrefs();
    applyLook();
    if (prefs.decoyLaunch) showDecoy(); else hideDecoy();
    await loadAll();
    await purgeOldTrash();
    retireBills();
    Sync.lastOk = (await DB.get('lastSync')) || 0;
    if (Sync.lastOk && !(await DB.get('firstSync'))) await DB.set('firstSync', Sync.lastOk);   // installs from before v2.7
    window.__synced = !!(await DB.get('firstSync'));
    Sync.status(Sync.on() ? (Sync.lastOk ? 'ok' : '') : '', Sync.on() ? 'Last synced ' + timeAgo(Sync.lastOk) : 'Local only');
    showTab(prefs.startTab === 'last' ? prefs.lastTab : prefs.startTab || 'tasks');
    handleGo();
    window.__booted = true; if (!document.documentElement.classList.contains('decoy-on')) afterAppShown();
    // first run after upgrading on the same address: offer to bring the old data across
    // v1 kept the Sheet URL/token and Drive folder in localStorage — carry them over
    if (!prefs.cloudUrl) {
      try { const c = JSON.parse(localStorage.getItem('reg_cloud') || '{}'); if (c.url && c.token && scriptUrlOk(normaliseScriptUrl(c.url))) { setPref('cloudUrl', normaliseScriptUrl(c.url)); setPref('cloudToken', c.token); RLOG.info('adopted v1 sync settings'); } } catch (e) {}
    }
    if (!prefs.driveFolder && localStorage.getItem('reg_driveFolder')) setPref('driveFolder', localStorage.getItem('reg_driveFolder'));
    const needsMigrate = (localStorage.getItem('reg_recs') && localStorage.getItem('r2_legacyDone') !== '1' && localStorage.getItem('reg_devKey'))
                      || (Sync.on() && localStorage.getItem('r2_legacySheetDone') !== '1' && localStorage.getItem('reg_devKey'));
    if (Sync.on()) {
      Sync.run().then(async () => {
        if (!needsMigrate) return;
        const r = await autoMigrate(false);
        if (r.total) toast(`Brought in ${r.total} items from the old version.`, null, null, 5000);
      });
    } else if (localStorage.getItem('reg_recs') && localStorage.getItem('r2_legacyDone') !== '1') {
      if (localStorage.getItem('reg_devKey')) autoMigrate(false).then(r => { if (r.total) toast(`Brought in ${r.total} items from the old version.`, null, null, 5000); });
      else { legacyOffer = true; if (!document.documentElement.classList.contains('decoy-on')) offerLegacy(); }   // passphrase-era data: ask
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(p => { window.__persist = !!p; RLOG.info('persistent storage', p); }).catch(() => { window.__persist = false; });
    setInterval(() => { if (document.visibilityState === 'visible' && !Sheets.top()) $('todayLbl').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }, 60000);
  } catch (e) {
    RLOG.error('boot failed', e);
    hideDecoy();
    $('main').innerHTML = `<div class="empty"><b>Register could not start</b>${esc(e.message || e)}<br><br><button class="btn" id="bootLog">Download log</button></div>`;
    try { $('bootLog').addEventListener('click', () => shareOrDownload(RLOG.text(), 'register-log.txt')); } catch (e2) {}
  }
})();

/* service worker: offline + update notice */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready.', 'Reload', () => location.reload(), 15000); });
    });
  }).catch(e => RLOG.warn('sw register failed', e.message));
}


/* v2.21: selection bar buttons */
if ($('selX')) $('selX').addEventListener('click', selEnd);

/* v2.21 (A3): hide + while scrolling down, show it on the way up or near the top/bottom */
{ let lastY = 0, tick = false; const m = $('main');
  m.addEventListener('scroll', () => { if (tick) return; tick = true; requestAnimationFrame(() => { tick = false;
    const y = m.scrollTop, dy = y - lastY, nearEnd = y + m.clientHeight >= m.scrollHeight - 4;
    if (y < 60 || dy < -6) document.documentElement.classList.remove('fab-hide');
    else if (dy > 6 && !nearEnd) document.documentElement.classList.add('fab-hide');
    lastY = y; }); }, { passive: true }); }

