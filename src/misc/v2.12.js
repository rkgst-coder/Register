/* ==========================================================================
   v2.12
   ======================================================================== */
/* ---------- ghost app (decoy → Retry twice): empty Register, every save "crashes" ---------- */
function ghostCrash(force) {
  const ua = navigator.userActivation;
  if (!force && ua && !ua.isActive) return;
  $('ghostErr').classList.remove('hidden');
}
$('ghostOk').addEventListener('click', () => $('ghostErr').classList.add('hidden'));
function enterGhost() {
  window.GHOST = true;
  Sheets.closeAll(); addDraft = null;
  if (!$('lightbox').classList.contains('hidden')) $('lbClose').click(); $('toast') && $('toast').classList.remove('show');
  document.documentElement.classList.remove('decoy-on');
  $('decoy').classList.add('hidden'); $('decoy').setAttribute('aria-hidden', 'true'); $('app').removeAttribute('aria-hidden');
  try { if (navigator.setAppBadge) navigator.clearAppBadge(); } catch (e) {}
  showTab('tasks'); renderAll();
}
{ let taps = [];
  $('decoyRetry').addEventListener('click', () => { const n = Date.now(); taps = taps.filter(x => n - x < 8000); taps.push(n); if (taps.length >= 2) { taps = []; setTimeout(enterGhost, 1600); } }); }

/* ---------- Recently deleted ---------- */
const BIN_TYPES = { inbox: 'Inbox item', task: 'Task', note: 'Note', date: 'Date', doc: 'Document', docfile: 'File', snote: 'Private note', fin: 'Money entry', vault: 'Card / account detail' };
function binItemsBase() {
  if (window.GHOST) return [];
  const cutoff = nowMs() - 30 * 86400000;
  return Object.values(records).filter(r => r.deleted && r.deletedAt && r.deletedAt > cutoff && BIN_TYPES[r.type] && (!SEALED_TYPES.has(r.type) || finUnlocked())
    && !(r.type === 'docfile' && (!records[r.docId] || records[r.docId].deleted))).sort((a, b) => b.deletedAt - a.deletedAt);
}
function binLabel(r) {
  if (r.type === 'catbin') return catbinLabel(r);
  if (r.type === 'docfile') { const d = records[r.docId]; return `${esc(r.name || 'file')}<small class="muted"> · from ${esc(d ? d.title : 'a document')}</small>`; }
  if (r.type === 'doc') { const n = docFilesOf(r.id).length; return `${esc(r.title)}<small class="muted"> · ${esc(docOwners(r).join(' & '))}${n ? ` · 📎 ${n}` : ''}</small>`; }
  if (r.type === 'fin') return esc((r.desc || 'Entry') + ' · ' + rs(r.amount));
  return esc(r.title || r.label || r.desc || '(untitled)');
}
function openBin() {
  const L = binItems();
  $('binList').innerHTML = L.length ? L.map(r => { const left = Math.max(1, 30 - Math.floor((nowMs() - r.deletedAt) / 86400000));
    return `<div class="chk-row"><span class="pill">${BIN_TYPES[r.type]}</span><div class="row-main"><div class="row-title">${binLabel(r)}</div><div class="row-sub">deleted ${timeAgo(r.deletedAt)} · ${left} day${left > 1 ? 's' : ''} left</div></div>
      <button class="btn small ghost" data-binr="${r.id}">Restore</button><button class="icon-btn" data-bind="${r.id}" aria-label="Delete now" style="width:34px;height:34px;font-size:14px">✕</button></div>`; }).join('')
    : '<div class="empty">Nothing deleted in the last 30 days.</div>';
  $$('[data-binr]', $('binList')).forEach(b => b.addEventListener('click', () => binRestore(b.dataset.binr)));
  $$('[data-bind]', $('binList')).forEach(b => b.addEventListener('click', () => { if (confirm('Delete this for good? Its files in Drive go to Drive\'s Trash.')) { purgeNow([b.dataset.bind]); openBin(); } }));
  $('binEmpty').classList.toggle('hidden', !L.length);
  Sheets.open('shBin');
}
function binRestoreOld(id) {
  const r = records[id]; if (!r) return;
  restore(id);
  if (r.type === 'docfile') { if (r.keyId && records[r.keyId] && records[r.keyId].deleted) restore(r.keyId); if (Sync.on()) Sync.call('driveRestore', { fileId: r.fileId }).catch(() => {}); }
  if (r.type === 'fin' || r.type === 'snote') scheduleRender();
  toast('Restored.'); openBin();
}
async function purgeNowOld(ids) {
  ids.forEach(id => { const r = records[id]; if (!r) return;
    if (r.type === 'docfile' && r.fileId) driveDelete(r.fileId);
    if (r.type === 'doc') all('docfile').forEach(f => { if (f.docId === id) { driveDelete(f.fileId); softDelete(f.id, { render: false }); } });
    r.deletedAt = 1; put(r, { render: false }); });
  ids.forEach(id => { delete records[id]; delete sealed[id]; });
  storeVer++;
  try { await DB.delMany(ids); } catch (e) {}
  scheduleRender();
}
$('binEmpty').addEventListener('click', () => { const L = binItems(); if (L.length && confirm(`Delete all ${L.length} items for good?`)) { purgeNow(L.map(r => r.id)); openBin(); } });
$('setBin').addEventListener('click', () => { Sheets.close('shSettings', true); openBin(); });
$('trashOpen').addEventListener('click', openBin);

/* ---------- share several documents ---------- */
let docSel = null, shareTitle = null;
/* v2.21: press and hold a document to start selecting (the Documents tab keeps its own Share / Move / Merge bar) */
function docHold(w, id) {
  let t = null, x0 = 0, y0 = 0;
  const go = () => { t = null; w._swiped = true; setTimeout(() => { w._swiped = false; }, 500); if (!docSel) docSel = new Set(); if (!docSel.has(id)) docSel.add(id); renderDocs(); };
  w.addEventListener('touchstart', e => { const p = e.touches[0]; x0 = p.clientX; y0 = p.clientY; clearTimeout(t); t = setTimeout(go, 480); }, { passive: true });
  w.addEventListener('touchmove', e => { const p = e.touches[0]; if (t && (Math.abs(p.clientX - x0) > 8 || Math.abs(p.clientY - y0) > 8)) { clearTimeout(t); t = null; } }, { passive: true });
  ['touchend', 'touchcancel'].forEach(ev => w.addEventListener(ev, () => { clearTimeout(t); t = null; }, { passive: true }));
  w.addEventListener('contextmenu', e => { e.preventDefault(); go(); });
}
function toggleDocSel(id) { if (!docSel) return; docSel.has(id) ? docSel.delete(id) : docSel.add(id); renderDocs(); }
function renderSelBarBase() {
  const bar = $('docSelBar'); bar.classList.toggle('hidden', !docSel); document.documentElement.classList.toggle('doc-selecting', !!docSel);
  $('docSelBtn').textContent = docSel ? '✕ Stop selecting' : '☑ Select';
  if (!docSel) return;
  const n = docSel.size, files = [...docSel].reduce((s, id) => s + docFilesOf(id).length, 0);
  $('docSelN').textContent = n ? `${n} document${n > 1 ? 's' : ''} · ${files} file${files === 1 ? '' : 's'}` : 'Tap documents to pick';
  $('docSelShare').disabled = !files;
}
$('docSelBtn').addEventListener('click', () => { docSel = docSel ? null : new Set(); renderDocs(); });
$('docSelCancel').addEventListener('click', () => { docSel = null; renderDocs(); });
$('docSelShare').addEventListener('click', () => {
  const ids = [...docSel], docs = ids.map(id => records[id]).filter(Boolean), fs = ids.flatMap(id => docFilesOf(id));
  const who = [...new Set(docs.flatMap(docOwners))];
  shareTitle = `${who.join(' & ')} - ${docs.slice(0, 3).map(d => d.title).join(', ')}${docs.length > 3 ? ` +${docs.length - 3}` : ''}`.slice(0, 80);
  $('dsFiles').innerHTML = fs.map(f => { const d = records[f.docId]; return `<label class="switch-row"><span>${f.locked ? '🔒 ' : ''}${esc(d.title)}<small class="dq-sub">${esc(docOwners(d).join(' & '))} · ${esc(f.name)}${f.fy ? ' · FY ' + f.fy : ''}</small></span><input type="checkbox" class="sw" data-dsf="${f.id}" checked></label>`; }).join('');
  $('dsWm').checked = false; $('dsText').value = ''; $('dsTextWrap').classList.add('hidden');
  resetShare(); dsModeInit(fs.length); Sheets.open('shDocShare');
});
function dsModeInit(n) {
  $('dsModeW').classList.toggle('hidden', n < 2); AF_DS.mode = 'sep';
  chipGroup($('dsMode'), [{ v: 'sep', l: 'Separate files' }, { v: 'one', l: 'One PDF' }], 'sep', v => { AF_DS.mode = v; resetShare(); });
}
const AF_DS = { mode: 'sep' };
async function mergeToPdf(files, name) {
  try { await loadScript(PDFLIB_URL); } catch (e) { throw new Error('the PDF tool ' + e.message); }
  const { PDFDocument } = window.PDFLib, out = await PDFDocument.create(), skipped = [];
  for (const f of files) {
    try {
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        const src = await PDFDocument.load(await f.arrayBuffer());
        (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
      } else {
        let bytes = new Uint8Array(await f.arrayBuffer()), img;
        if (/png/i.test(f.type)) img = await out.embedPng(bytes);
        else if (/jpe?g/i.test(f.type)) img = await out.embedJpg(bytes);
        else { const c = await blobToJpeg(f); img = await out.embedJpg(c); }
        const W = 595.28, H = W * img.height / img.width, p = out.addPage([W, H]); p.drawImage(img, { x: 0, y: 0, width: W, height: H });
      }
    } catch (e) { skipped.push(f.name + (/encrypt/i.test(e.message || '') ? ' (password-protected)' : '')); }
  }
  if (!out.getPageCount()) throw new Error('none of the files could be combined');
  return { file: new File([await out.save()], name.replace(/[\\/:*?"<>|]/g, '-') + '.pdf', { type: 'application/pdf' }), skipped };
}
async function blobToJpeg(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('not a picture')); i.src = url; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    const d = c.toDataURL('image/jpeg', .9); return unb64(d.slice(d.indexOf(',') + 1)); } finally { URL.revokeObjectURL(url); }
}

/* ---------- monthly check: every Register file still in Drive (Code.gs v20) ---------- */
const DriveChk = {
  KEY: 'r2_drivechk', busy: false,
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(this.KEY, JSON.stringify(v)); } catch (e) {} },
  files() { return all('docfile').filter(f => f.fileId && records[f.docId] && !records[f.docId].deleted); },
  bad() { const c = this.get(); return ((c && c.bad) || []).filter(b => records[b.id] && !records[b.id].deleted && records[records[b.id].docId] && !records[records[b.id].docId].deleted); },
  async run(manual) {
    if (window.GHOST) return;
    if (!Sync.on() || !driveOn()) { if (manual) toast('Connect the Sheet and Drive folder first (Settings).'); return; }
    if (!navigator.onLine) { if (manual) toast('You are offline.'); return; }
    if (this.busy) return; this.busy = true;
    const fs = this.files(), bad = []; let err = null;
    try {
      for (let i = 0; i < fs.length; i += 100) {
        const b = fs.slice(i, i + 100);
        if (manual && $('dcMsg')) { $('dcMsg').className = 'msg'; $('dcMsg').textContent = `Checking ${Math.min(i + b.length, fs.length)} of ${fs.length}…`; }
        const r = await Sync.call('driveCheck', { ids: b.map(f => f.fileId) }, 180000);
        (r.states || []).forEach(s => { if (s.st !== 'ok') b.filter(f => f.fileId === s.id).forEach(f => bad.push({ id: f.id, st: s.st })); });
      }
    } catch (e) { err = e; }
    this.busy = false;
    if (err) { const old = /unknown action/.test(err.message || ''); this.set({ at: old ? Date.now() : Date.now() - 29 * 86400000, bad: (this.get() || {}).bad || [], old });
      if (manual) { const m = old ? 'Your Apps Script is older than v20. Paste Code.gs v20 and redeploy.' : 'Check failed: ' + err.message; if ($('dcMsg')) { $('dcMsg').className = 'msg err'; $('dcMsg').textContent = m; } else toast(m); } return; }
    this.set({ at: Date.now(), n: fs.length, bad });
    if (manual) { if (Sheets.isOpen('shDriveChk')) renderDriveChk(); else toast(bad.length ? `${bad.length} file${bad.length > 1 ? 's' : ''} need attention — see Docs.` : `All ${fs.length} files are in Drive.`); }
    if (currentTab === 'docs') renderDocs();
  },
  maybe() { const c = this.get(); if (!c || (!c.old && Date.now() - c.at > 30 * 86400000) || (c.old && Date.now() - c.at > 7 * 86400000)) { if (!this.sched) { this.sched = true; setTimeout(() => { this.sched = false; this.run(false); }, 4000); } } }
};
const DC_SAY = { trash: 'In Drive\'s Trash', missing: 'Deleted from Drive (gone for good)', outside: 'Moved out of the Register folder' };
function renderDriveChkNote() {
  const box = $('docChkNote'); if (!box) return;
  const n = DriveChk.bad().length;
  box.innerHTML = n ? `<button class="imp-note" id="docChkGo" style="border-left:4px solid var(--seal)"><span>⚠︎ <b>${n} file${n > 1 ? 's' : ''}</b> missing from Drive</span><b>Review ›</b></button>` : '';
  if ($('docChkGo')) $('docChkGo').addEventListener('click', openDriveChk);
  DriveChk.maybe();
}
function openDriveChk() { $('dcMsg').textContent = ''; renderDriveChk(); Sheets.open('shDriveChk'); }
function renderDriveChk() {
  const c = DriveChk.get(), L = DriveChk.bad();
  $('dcMsg').className = 'msg' + (L.length ? '' : ' ok');
  $('dcMsg').textContent = c ? `Last checked ${timeAgo(c.at)}${c.n != null ? ` · ${c.n} files` : ''}. ${L.length ? L.length + ' need attention.' : 'All files found.'}` : 'Not checked yet — tap Check again.';
  $('dcList').innerHTML = L.map(b => { const f = records[b.id], d = records[f.docId];
    return `<div class="chk-row"><div class="row-main"><div class="row-title">${esc(d.title)} <span class="muted">· ${esc(docOwners(d).join(' & '))}</span></div><div class="row-sub"><span>${esc(f.name)}</span><span class="warn">${DC_SAY[b.st] || b.st}</span></div></div>
      ${b.st === 'trash' ? `<button class="btn small" data-dcr="${f.id}">Restore</button>` : `<button class="btn small ghost" data-dco="${d.id}">Open</button>`}</div>`; }).join('');
  $$('[data-dcr]', $('dcList')).forEach(b => b.addEventListener('click', async () => {
    const f = records[b.dataset.dcr]; b.disabled = true;
    try { const r = await Sync.call('driveRestore', { fileId: f.fileId }); if (r.error) throw new Error(r.error); toast('Restored from Drive\'s Trash.'); DriveChk.set({ ...DriveChk.get(), bad: DriveChk.bad().filter(x => x.id !== f.id) }); renderDriveChk(); renderDocs(); }
    catch (e) { b.disabled = false; toast(/unknown action/.test(e.message) ? 'Update the Apps Script to v20.' : 'Could not restore: ' + e.message); }
  }));
  $$('[data-dco]', $('dcList')).forEach(b => b.addEventListener('click', () => { Sheets.close('shDriveChk', true); openDoc(b.dataset.dco); }));
}
$('dcRun').addEventListener('click', () => DriveChk.run(true));
$('setDriveChk').addEventListener('click', () => { Sheets.close('shSettings', true); openDriveChk(); DriveChk.run(true); });

/* ---------- Ask (offline answers from your own data; nothing leaves the phone) ---------- */
const ASK_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function askRange(q, future) {
  const t = todayISO(), ym = t.slice(0, 7), mEnd = m => monthEnd(m), mk = (from, to, label) => ({ from, to, label });
  let m;
  if (/\btoday\b|\baaj\b/.test(q)) return mk(t, t, 'today');
  if (/\btomorrow\b|\bkal\b/.test(q)) return mk(addDays(1), addDays(1), 'tomorrow');
  if ((m = q.match(/\b(?:next|coming|in)\s+(\d{1,3})\s+days?\b/))) return mk(t, addDays(+m[1]), `the next ${m[1]} days`);
  if (/\bthis week\b/.test(q)) return future === false ? mk(addDays(-6), t, 'the last 7 days') : mk(t, addDays(6), 'the next 7 days');
  if (/\bnext week\b/.test(q)) return mk(addDays(7), addDays(13), 'next week');
  if (/\bthis month\b/.test(q)) return mk(ym + '-01', mEnd(ym), monthLong(ym));
  if (/\bnext month\b/.test(q)) { const n = monthAdd(ym, 1); return mk(n + '-01', mEnd(n), monthLong(n)); }
  if (/\blast month\b|\bprevious month\b/.test(q)) { const n = monthAdd(ym, -1); return mk(n + '-01', mEnd(n), monthLong(n)); }
  if ((m = q.match(/\bfy\s*(\d{2,4})\s*-\s*(\d{2})\b/))) { const s = +m[1] < 100 ? 2000 + +m[1] : +m[1]; return mk(s + '-04-01', (s + 1) + '-03-31', `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`); }
  if (/\b(this|current) (fy|financial year)\b/.test(q)) { const f = fyOf(t), s = +f.slice(0, 4); return mk(s + '-04-01', (s + 1) + '-03-31', 'FY ' + f); }
  if (/\b(last|previous) (fy|financial year)\b/.test(q)) { const s = +fyOf(t).slice(0, 4) - 1; return mk(s + '-04-01', (s + 1) + '-03-31', `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`); }
  if (/\bthis year\b/.test(q)) { const y = t.slice(0, 4); return mk(y + '-01-01', y + '-12-31', y); }
  for (let i = 0; i < 12; i++) {
    if (i === 4 && !/\b(in|of|during|since|till|until|by|for)\s+may\b|\bmay\s+\d{4}\b/.test(q)) continue;      // "may" is usually not the month
    const re = new RegExp('\\b(' + ASK_MONTHS[i] + '|' + ASK_MONTHS[i].slice(0, 3) + ')\\b(?:\\s+(\\d{4}))?');
    if ((m = q.match(re))) {
      let y = m[2] ? +m[2] : +t.slice(0, 4); const mm = String(i + 1).padStart(2, '0');
      if (!m[2]) { if (future === true && `${y}-${mm}` < ym) y++; if (future === false && `${y}-${mm}` > ym) y--; }   // null: this year's month
      const k = `${y}-${mm}`; return mk(k + '-01', mEnd(k), monthLong(k));
    }
  }
  if (/\b(upcoming|coming up|coming|soon|next)\b/.test(q)) return mk(t, addDays(30), 'the next 30 days');
  return null;
}
const ASK_STOP = new Set('when what which how much many who whom is are was were the a an of in on for my me i did do does will to from list show all any there have has had due expire expires expired expiry expiring renew renewal valid validity date dates this next last month week year years today tomorrow days day upcoming coming up s spent spend spending expense expenses income earned received total balance balances owe owes owed udhaar documents document docs doc file files birthday birthdays anniversary anniversaries task tasks todo note notes fy financial get got pay paid overdue pending open still left kab kitna ka ki ke hai and or with by at be it its his her their our we you your'.split(' '));
function askPeople(q) {
  const out = new Set(), known = docPeople().map(p => p.toLowerCase());
  q.split(/[^a-z]+/).forEach(w => { if (!w) return; if (PERSON_ALIAS[w]) out.add(PERSON_ALIAS[w]); else if (known.includes(w)) out.add(w.charAt(0).toUpperCase() + w.slice(1)); });
  return [...out];
}
const inRange = (iso, R) => !R || (iso >= R.from && iso <= R.to);
const daysTo = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
const inDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : n < 60 ? `in ${n} days` : n < 730 ? `in ${Math.round(n / 30.4)} months` : `in ${(n / 365.25).toFixed(1)} years`;
function askAnswer(raw) {
  const q = ' ' + raw.toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence').replace(/[?.!,']/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const isQ = /^ (when|what|which|how|who|list|show|any|is|are|do|does|did|total|kab|kitna|kitne|kya)\b/.test(q);
  const has = re => re.test(q);
  if (!isQ && !has(/\b(expire|expiry|expiring|birthdays?|anniversar\w*|spent|spend|income|owes?|udhaar|balance|overdue|upcoming|coming up)\b/)) return null;
  const who = askPeople(q), words = q.trim().split(' ').filter(w => w.length > 1 && !ASK_STOP.has(w) && !PERSON_ALIAS[w] && !who.some(p => p.toLowerCase() === w) && !/^\d+$/.test(w) && !ASK_MONTHS.includes(w) && !ASK_MONTHS.some(m => m.slice(0, 3) === w));
  const ans = (text, items) => ({ text, items: items || [] });
  const docHay = d => (d.title + ' ' + d.docType + ' ' + docGroup(d) + ' ' + d.issuer).toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence');
  const whoOk = d => !who.length || docOwners(d).some(p => who.includes(p));
  const dItem = d => ({ k: 'Doc', id: d.id, t: esc(d.title) + ' · <b>' + esc(docOwners(d).join(' & ')) + '</b>', s: d.expiry ? fmtDate(d.expiry, true) : '' });
  // ----- money (only with Money open) -----
  if (has(/\b(spent|spend|spending|expenses?|income|earned|received|salary|owes?|owed|udhaar|balance|balances|savings?)\b/)) {
    if (!finUnlocked()) return isQ ? ans('I can answer things like:\n• When does Ruchi\'s passport expire?\n• Birthdays this month · What is coming up next week?\n• Which documents have no file? · Overdue tasks') : null;   // v2.20: nothing about Money while it is locked
    if (has(/\b(owes?|owed|udhaar)\b/)) {
      const names = [...who.flatMap(p => [p, ...Object.keys(PERSON_ALIAS).filter(k => PERSON_ALIAS[k] === p)]), ...words].map(w => w.toLowerCase());   // "Moni" finds entries saved as Ruchi, and the other way round
      const hitWho = s => { s = String(s || '').toLowerCase(); return names.some(w => s.split(/[^a-z0-9]+/).includes(w) || (w.length > 3 && s.includes(w))); };
      const L = all('fin').filter(e => isUdh(e) && !e.settled && outstanding(e) > 0 && (!names.length || hitWho(e.who)));
      if (!L.length) return ans('No open udhaar' + (who.length || words.length ? ' for ' + [...who, ...words].join(', ') : '') + '.');
      const by = {}; L.forEach(e => { const k = e.who || '—'; by[k] = (by[k] || 0) + (e.kind === 'lent' ? 1 : -1) * outstanding(e); });
      return ans(Object.entries(by).map(([p, v]) => v >= 0 ? `${p} owes you ${rs(v)}` : `You owe ${p} ${rs(-v)}`).join('\n'), L.slice(0, 12).map(e => ({ k: '₹', id: e.id, t: esc(e.desc || 'Udhaar') + ' · ' + esc(e.who || ''), s: rs(outstanding(e)) })));
    }
    if (has(/\bsavings?\b/) && !has(/\bbalances?\b/)) {
      const R = askRange(q, false) || (() => { const ym = todayISO().slice(0, 7); return { from: ym + '-01', to: monthEnd(ym), label: monthLong(ym) }; })();
      const F = all('fin').filter(e => inRange(e.date || '', R)), s = k => F.filter(e => e.kind === k && (k !== 'expense' || e.category !== 'Investment')).reduce((t, e) => t + (+e.amount || 0), 0);
      const i = s('income'), x = s('expense');
      return ans(`${R.label}: income ${rs(i)} − spending ${rs(x)} = ${i - x >= 0 ? 'saved' : 'overspent'} ${rs(Math.abs(i - x))} (Ledger entries only).`);
    }
    if (has(/\bbalances?\b/)) {
      const c = planCfg(); if (!c || !accts().length) return ans('Set up Money → Accounts first.');
      const R = askRange(q, null), B = balancesOn(c, R ? R.to : todayISO());
      const L = accts(true).filter(a => !words.length || words.some(w => a.name.toLowerCase().includes(w)));
      if (!L.length) return ans(`No account matches "${words.join(' ')}".`);
      return ans(L.map(a => `${a.name}: ${rs(B.accts[a.id] || 0)}`).join('\n') + `\n(${B.label})`);
    }
    const inc = has(/\b(income|earned|received|salary)\b/), R = askRange(q, false) || (() => { const ym = todayISO().slice(0, 7); return { from: ym + '-01', to: monthEnd(ym), label: monthLong(ym) }; })();
    const cat = FIN_CATS.find(c => words.includes(c.toLowerCase()) || (c === 'Food' && words.some(w => /food|khana|grocer/.test(w))));
    const rest = words.filter(w => !cat || w !== cat.toLowerCase());
    const L = all('fin').filter(e => e.kind === (inc ? 'income' : 'expense') && inRange(e.date || '', R) && (!cat || e.category === cat) && (cat || !rest.length || rest.some(w => (String(e.desc || '') + ' ' + (e.who || '')).toLowerCase().includes(w))));
    const sum = L.reduce((s, e) => s + (+e.amount || 0), 0);
    return ans(`${inc ? 'Received' : 'Spent'} ${rs(sum)}${cat ? ' on ' + cat : rest.length ? ' on "' + rest.join(' ') + '"' : ''} in ${R.label} — ${L.length} entr${L.length === 1 ? 'y' : 'ies'} in the Ledger.`,
      L.sort((a, b) => b.amount - a.amount).slice(0, 12).map(e => ({ k: '₹', id: e.id, t: esc(e.desc || e.category || 'Entry'), s: rs(e.amount) + ' · ' + fmtDate(e.date) })));
  }
  // ----- document expiry -----
  if (has(/\b(expire|expires|expired|expiry|expiring|renew|renewal|valid|validity)\b/)) {
    const R = askRange(q, true);
    let L = all('doc').filter(d => whoOk(d) && (!words.length || words.some(w => docHay(d).includes(w))));
    const noDate = L.filter(d => !d.expiry && words.length);
    L = L.filter(d => d.expiry && (R ? inRange(d.expiry, R) : true)).sort((a, b) => a.expiry.localeCompare(b.expiry));
    if (!L.length && !noDate.length) return ans(`Nothing ${R ? 'expires in ' + R.label : 'with an expiry date'}${who.length ? ' for ' + who.join(', ') : ''}${words.length ? ' matching "' + words.join(' ') + '"' : ''}.`);
    const lines = L.slice(0, 8).map(d => { const n = daysTo(d.expiry); return `${docOwners(d).join(' & ')}'s ${d.title} ${n < 0 ? 'expired' : 'expires'} on ${fmtDate(d.expiry, true)} (${inDays(n)})`; });
    if (noDate.length) lines.push(`No expiry date saved for: ${noDate.slice(0, 5).map(d => docOwners(d).join(' & ') + "'s " + d.title).join(', ')}`);
    if (L.length > 8) lines.push(`…and ${L.length - 8} more below.`);
    return ans(lines.join('\n'), [...L, ...noDate].slice(0, 20).map(dItem));
  }
  // ----- dates: birthdays, anniversaries, anything coming up -----
  const wantBday = has(/\bbirthdays?\b|\bjanamdin\b/), wantAnn = has(/\banniversar\w*\b/);
  if (wantBday || wantAnn || has(/\b(upcoming|coming up|dates?)\b/)) {
    const R = askRange(q, true) || (who.length || words.length ? null : { from: todayISO(), to: addDays(30), label: 'the next 30 days' });
    let L = all('date').filter(d => d.when).map(d => ({ d, w: isoLocal(nextOccurrence(d)) }));
    if (wantBday) L = L.filter(x => dateCat(x.d) === 'birthday'); else if (wantAnn) L = L.filter(x => dateCat(x.d) === 'anniv');
    if (who.length) L = L.filter(x => who.some(p => x.d.label.toLowerCase().includes(p.toLowerCase()) || (p === 'Rahul' && /\b(my|rk)\b/i.test(x.d.label))));
    if (words.length) L = L.filter(x => words.some(w => x.d.label.toLowerCase().includes(w)) || who.length);
    L = L.filter(x => inRange(x.w, R)).sort((a, b) => a.w.localeCompare(b.w));
    const unset = all('date').filter(d => !d.when && (!wantBday || dateCat(d) === 'birthday') && who.some(p => d.label.toLowerCase().includes(p.toLowerCase())));
    if (!L.length) return ans(unset.length ? `The date is not filled in yet for: ${unset.map(d => d.label).join(', ')}.` : `Nothing${R ? ' in ' + R.label : ''}${who.length ? ' for ' + who.join(', ') : ''}.`, unset.map(d => ({ k: 'Date', id: d.id, t: esc(d.label), s: 'set the date' })));
    return ans(L.slice(0, 10).map(x => { const n = daysTo(x.w), age = dateAge(x.d, x.w); return `${x.d.label} — ${fmtDate(x.w, true)} (${inDays(n)})${age ? ', ' + age : ''}`; }).join('\n'),
      L.slice(0, 20).map(x => ({ k: 'Date', id: x.d.id, t: esc(x.d.label), s: fmtDate(x.w) })));
  }
  // ----- tasks -----
  if (has(/\b(tasks?|to-?dos?|overdue|pending)\b/)) {
    const R = askRange(q, true);
    let L = all('task').filter(t => t.status !== 'done');
    if (has(/\boverdue\b/)) L = L.filter(isOverdue); else if (R) L = L.filter(t => t.dueDate && inRange(t.dueDate, R));
    if (words.length) L = L.filter(t => words.some(w => (t.title + ' ' + (t.category || '')).toLowerCase().includes(w)));
    L.sort((a, b) => String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')));
    return ans(`${L.length} open task${L.length === 1 ? '' : 's'}${has(/\boverdue\b/) ? ' overdue' : R ? ' due in ' + R.label : ''}.`, L.slice(0, 20).map(t => ({ k: 'Task', id: t.id, t: esc(t.title), s: t.dueDate ? fmtDate(t.dueDate) : '' })));
  }
  // ----- documents: counts, missing files, not locked -----
  if (has(/\b(documents?|docs?|files?)\b/)) {
    let L = all('doc').filter(whoOk);
    if (has(/\b(no|without|missing) (file|files|attachment)\b/)) { L = L.filter(d => !docFilesOf(d.id).length); return ans(`${L.length} document${L.length === 1 ? ' has' : 's have'} no file attached${who.length ? ' for ' + who.join(', ') : ''}.`, L.slice(0, 30).map(dItem)); }
    if (has(/\b(not locked|unlocked)\b/)) { L = L.filter(d => d.docType === 'Identity' && docFilesOf(d.id).length && !d.lockFiles); return ans(`${L.length} ID document${L.length === 1 ? ' is' : 's are'} not locked.`, L.slice(0, 30).map(dItem)); }
    if (words.length) L = L.filter(d => words.some(w => docHay(d).includes(w)));
    const by = {}; L.forEach(d => { const g = docGroup(d); by[g] = (by[g] || 0) + 1; });
    return ans(`${L.length} document${L.length === 1 ? '' : 's'}${who.length ? ' for ' + who.join(', ') : ''}${words.length ? ' matching "' + words.join(' ') + '"' : ''}: ${Object.entries(by).map(([g, n]) => g + ' ' + n).join(', ') || '—'}.`, L.slice(0, 20).map(dItem));
  }
  if (has(/\bnotes?\b/)) {
    let L = all('note'); if (words.length) L = L.filter(n => words.some(w => (n.title + ' ' + n.text + ' ' + (n.folder || '')).toLowerCase().includes(w)));
    return ans(`${L.length} note${L.length === 1 ? '' : 's'}${words.length ? ' about "' + words.join(' ') + '"' : ''}.`, L.slice(0, 20).map(n => ({ k: 'Note', id: n.id, t: esc(n.title || 'Untitled'), s: n.folder || '' })));
  }
  return isQ ? ans('I can answer things like:\n• When does Ruchi\'s passport expire?\n• Birthdays this month · What is coming up next week?\n' + (finUnlocked() ? '• How much did I spend on food in August? · Who owes me udhaar?\n' : '') + '• Which documents have no file? · Overdue tasks') : null;
}

/* ---------- Dates: categories, badge, Calendar ---------- */
const DATE_CATS = [['birthday', 'Birthdays', '🎂'], ['anniv', 'Anniversaries', '💍'], ['remember', 'Death anniversaries', '🪔'], ['docexp', 'Document expiry', '🪪'],
  ['insurance', 'Insurance & premiums', '🛡'], ['vehicle', 'Vehicle', '🚗'], ['tax', 'Tax deadlines', '🧾'], ['bank', 'Bank & investments', '🏦'],
  ['subs', 'Subscriptions & renewals', '🔁'], ['home', 'Home & property', '🏠'], ['health', 'Health', '🩺'], ['kids', 'Children & school', '🎒'],
  ['office', 'Office', '🏛'], ['exams', 'Exams & applications', '📝'], ['travel', 'Travel', '✈️'], ['festival', 'Festivals', '🎉'],
  ['govt', 'Government & IDs', '📜'], ['warranty', 'Warranties', '🧰'], ['member', 'Memberships', '🏋'], ['goals', 'Personal & goals', '🎯'], ['other', 'Other', '📌']];
const DATE_SEEDS = {
  anniv: [['Marriage anniversary — Rahul & Ruchi', 'yearly'], ['Marriage anniversary — Papa & Mummy', 'yearly']],
  insurance: [['Car insurance renewal', 'yearly'], ['Health insurance renewal', 'yearly'], ['LIC premium', 'yearly'], ['Term insurance premium', 'yearly']],
  vehicle: [['PUC renewal', 'once'], ['Car service', 'once'], ['Two-wheeler insurance renewal', 'yearly']],
  tax: [['ITR filing last date', 'yearly'], ['Advance tax — June instalment', 'yearly'], ['Advance tax — September instalment', 'yearly'], ['Advance tax — December instalment', 'yearly'], ['Advance tax — March instalment', 'yearly'], ['Form 16 from office', 'yearly'], ['Tax-saving proofs to office', 'yearly']],
  bank: [['FD maturity', 'once'], ['PPF yearly deposit', 'yearly'], ['Bank KYC update', 'once'], ['Locker rent', 'yearly']],
  subs: [['Mobile recharge', 'monthly'], ['Broadband renewal', 'once'], ['OTT subscription', 'yearly'], ['Cloud storage / domain renewal', 'yearly']],
  home: [['Rent agreement renewal', 'once'], ['Property tax', 'yearly'], ['Society maintenance', 'monthly']],
  health: [['Annual health check-up', 'yearly'], ['Dental check-up', 'once'], ['Eye check-up', 'once'], ['CGHS card renewal', 'once']],
  kids: [['School fees', 'once'], ['School admission', 'once'], ['School exams', 'once'], ['Child vaccination', 'once']],
  office: [['APAR / self-appraisal', 'yearly'], ['Annual property return (IPR)', 'yearly'], ['Annual increment', 'yearly']],
  exams: [['Exam date', 'once'], ['Application last date', 'once']],
  travel: [['Train ticket booking opens', 'once'], ['Trip starts', 'once']],
  festival: [['Diwali', 'once'], ['Holi', 'once'], ['Raksha Bandhan', 'once'], ['Karwa Chauth', 'once'], ['Navratri', 'once']],
  govt: [['Aadhaar document update', 'once'], ['Voter list check', 'once']],
  member: [['Gym membership renewal', 'yearly']]
};
const DATE_CFG = 'date-cfg';
const dateCfg = () => !window.GHOST && records[DATE_CFG] && !records[DATE_CFG].deleted ? records[DATE_CFG] : { hidden: [], custom: [] };
const dateCats = () => { const c = dateCfg(), nm = c.names || {}, ic = c.icons || {}; return [...DATE_CATS.slice(0, -1), ...(c.custom || []).map(x => [x.k, x.n, x.i || '📁']), DATE_CATS[DATE_CATS.length - 1]].filter(x => !(c.hidden || []).includes(x[0])).map(x => [x[0], nm[x[0]] || x[1], ic[x[0]] || x[2]]); };
/* v2.22: one small sheet to name (or rename) a category, with an optional emoji */
function catNameSheet(title, name, icon, onSave) {
  planSheet(title, `<div class="grid2" style="grid-template-columns:72px 1fr"><div class="field"><label>Icon</label><input id="cnIcon" value="${esc(icon || '📁')}" maxlength="4" style="text-align:center;font-size:1.25rem" autocomplete="off"></div>
    <div class="field"><label>Name</label><input id="cnName" value="${esc(name || '')}" maxlength="40" autocomplete="off" enterkeyhint="done"></div></div>`,
    () => { const n = $('cnName').value.trim(), i = [...($('cnIcon').value.trim() || '📁')].slice(0, 2).join(''); if (!n) { planMsg('Type a name.', true); return false; } return onSave(n, i) !== false; }, 'Save');
  setTimeout(() => { const el = $('cnName'); if (el) { el.focus(); el.select(); } }, 300);
}
function renameDateCat(key) {
  const c0 = dateCats().find(x => x[0] === key); if (!c0) return;
  catNameSheet('Rename category', c0[1], c0[2], (n, i) => {
    if (dateCats().some(x => x[0] !== key && x[1].toLowerCase() === n.toLowerCase())) { planMsg('That name is already used.', true); return false; }
    const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
    if ((cfg.custom || []).some(x => x.k === key)) cfg.custom = cfg.custom.map(x => x.k === key ? { ...x, n, i } : x);
    else { cfg.names = { ...(cfg.names || {}), [key]: n }; cfg.icons = { ...(cfg.icons || {}), [key]: i }; }
    put(cfg); toast('Renamed.');
  });
}
const allDateCatKeys = () => [...DATE_CATS.map(x => x[0]), ...(dateCfg().custom || []).map(x => x.k)];
function guessDateCat(d) {
  const l = String(d.label || '').toLowerCase();
  if (d.sys === 'checkup') return 'bank';
  if (/birthday|bday|janam/.test(l)) return 'birthday';
  if (/punya|death|barsi|shraddh/.test(l)) return 'remember';
  if (/anniversar/.test(l)) return 'anniv';
  if (d.docRef || /expir/.test(l)) return 'docexp';
  if (/insurance|premium|\blic\b|policy/.test(l)) return 'insurance';
  if (/\bpuc\b|service|\brc\b|vehicle|car\b/.test(l)) return 'vehicle';
  if (/\bitr\b|tax|form ?16|tds/.test(l)) return 'tax';
  if (/\bfd\b|ppf|kyc|locker|sip|bank/.test(l)) return 'bank';
  if (/recharge|broadband|ott|netflix|subscription|domain/.test(l)) return 'subs';
  if (/rent|property|society|maintenance/.test(l)) return 'home';
  if (/check-?up|doctor|dental|vaccin|cghs|health/.test(l)) return 'health';
  if (/school|fees|admission/.test(l)) return 'kids';
  if (/apar|acr|ipr|increment|office/.test(l)) return 'office';
  if (/exam|admit|application/.test(l)) return 'exams';
  if (/diwali|holi|rakhi|raksha|navratri|karwa|eid|christmas|festival/.test(l)) return 'festival';
  if (/warranty/.test(l)) return 'warranty';
  if (/gym|club|membership/.test(l)) return 'member';
  return 'other';
}
const dateCat = d => { const k = d.cat && allDateCatKeys().includes(d.cat) ? d.cat : guessDateCat(d), m = dateCfg().merged || {}; return m[k] && m[k] !== k ? m[k] : k; };   // v2.23: a merged category's dates show in the one it went into
/* v2.21 (C2): how many days ahead a date shows in “Coming up” — its own setting, else its category's, else Settings */
const LEAD_OPTS = [3, 7, 15, 30, 45, 60, 90];
const catLead = k => +((dateCfg().lead || {})[k] || 0);
const dateLead = d => +(d.lead || 0) || catLead(dateCat(d)) || +(prefs.dateSoonDays || 30);
function setCatLead(k, n) { const c = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false }; c.lead = { ...(c.lead || {}) }; if (n) c.lead[k] = n; else delete c.lead[k]; put(c); }
function dateAge(d, w) {
  if (d.repeat !== 'yearly' || !d.when || !/birthday|anniversar/i.test(d.label)) return '';
  const y0 = +d.when.slice(0, 4), y1 = +w.slice(0, 4); if (y0 <= 1904 || y1 <= y0) return '';
  return /anniversar/i.test(d.label) ? `${y1 - y0} years` : `turns ${y1 - y0}`;
}
const EXP_RX = /passport|licen[cs]e|\bdl\b|insurance|policy|\bpuc\b|\brc\b|registration|agreement|warranty|membership|visa|permit|cghs|card/i, EXP_NO = /pan|aadha|voter|ration|birth|debit|credit|atm/i;
function seedDates() {
  const cfg = records[DATE_CFG];
  if (cfg && cfg.seeded) return;
  const have = new Set(all('date').map(d => d.label.toLowerCase())), add = (label, cat, repeat, x) => { if (have.has(label.toLowerCase())) return; have.add(label.toLowerCase());
    const sid = 'ds-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);   // the same id on every device
    put(Object.assign({ id: records[sid] ? uid('d') : sid, type: 'date', label, when: '', repeat, cat, needsDetail: true, deleted: false }, x || {}), { render: false }); };
  const people = orderPeople([...PERSON_ORDER, ...all('doc').flatMap(docOwners)]).filter(p => !/^(family|landlord|parents|dggi|presentation)$/i.test(p));
  people.forEach(p => add(`${p}'s birthday`, 'birthday', 'yearly'));
  const linked = new Set(all('date').map(d => d.docRef).filter(Boolean));
  all('doc').filter(d => !linked.has(d.id) && expiryKind(d)).forEach(d =>
    add(`${d.title} — ${docOwners(d).join(' & ')} — expiry`, d.docType === 'Warranty' ? 'warranty' : 'docexp', 'once', d.expiry ? { when: d.expiry, needsDetail: false, docRef: d.id } : { docRef: d.id }));
  Object.entries(DATE_SEEDS).forEach(([k, L]) => L.forEach(([l, r]) => add(l, k, r)));
  put({ ...(cfg || { id: DATE_CFG, type: 'datecfg', hidden: [], custom: [], updatedAt: 1 }), seeded: true, deleted: false }, { render: false, keepTime: true });   // a flag never overwrites your categories on other devices
}
let datePath = null;
function dateRows(list) {
  const t0 = new Date(todayISO() + 'T00:00:00');
  return list.map(d => { if (!d.when) return { d, w: null, days: null }; const w = nextOccurrence(d); return { d, w, days: Math.round((w - t0) / 86400000) }; })
    .sort((a, b) => (a.days == null) - (b.days == null) || (a.days < 0) - (b.days < 0) || (a.days || 0) - (b.days || 0) || a.d.label.localeCompare(b.d.label));
}
/* v2.20: a date sent to iPhone Calendar is marked, until its date, repeat or name changes */
const calSig = d => `${d.when || ''}|${d.repeat || 'once'}|${d.label || ''}`;
const inCal = d => !!(d && d.when && d.calSig && d.calSig === calSig(d));
function markInCal(list) {
  const t = todayISO();
  list.forEach(x => { const d = records[x.id]; if (!d || d.deleted || d.type !== 'date') return; d.calSig = calSig(x); d.calOn = t; put(d, { render: false }); });
  scheduleRender();
}
/* v2.20: a date as a task (due on the day it next falls); the date remembers it so it is not added twice */
const dateTask = d => { const t = d && d.taskId && records[d.taskId]; return t && !t.deleted && t.status !== 'done' ? t : null; };
function dateToTask(id) {
  const d = records[id]; if (!d) return;
  const have = dateTask(d);
  if (have) { toast('Already in Tasks.', 'Open', () => { Sheets.closeAll(); showTab('tasks'); openTaskEditor(have.id); }); return; }
  const w = d.when ? isoLocal(nextOccurrence(d)) : null;
  const t = newTask({ title: d.label, dueDate: w, priority: 'Medium', notes: 'From Dates', fromDate: d.id });
  d.taskId = t.id; put(d, { render: false }); scheduleRender();
  toast(`Added to Tasks${w ? ' — due ' + relDay(w) : ''}.`, 'Change', () => { Sheets.closeAll(); showTab('tasks'); openTaskEditor(t.id); }, 7000);
}
function dateRowHtml({ d, w, days }, showCat, withTask) {
  const cat = dateCats().find(c => c[0] === dateCat(d)), age = w ? dateAge(d, isoLocal(w)) : '';
  const tk = dateTask(d);
  return swipeHtml(`<div class="row">
      ${days == null ? '<div class="count past" aria-label="no date">?<small>no date</small></div>' : countHtml(days)}
      <div class="row-main"><div class="row-title">${esc(d.label)}</div>
        <div class="row-sub">${w ? `<span>${dateFmt(w, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>` : '<span class="warn">set the date</span>'}${age ? `<span>${age}</span>` : ''}
        ${d.repeat && d.repeat !== 'once' ? `<span class="pill">${esc(repWord(d.repeat) || d.repeat)}</span>` : ''}${showCat && cat ? `<span>${cat[2]} ${esc(cat[1])}</span>` : ''}${inCal(d) ? '<span class="pill cal-in">📅 in Calendar</span>' : ''}${tk ? '<span class="pill">☑ in Tasks</span>' : ''}</div></div>
      ${withTask && w && !tk ? `<button class="d-task" data-dtask="${d.id}" aria-label="Add ${esc(d.label)} to Tasks">＋ Task</button>` : '<span class="chev">›</span>'}</div>`, '', 'Delete 🗑', `data-date="${d.id}"`);
}
function renderDatesBase() {
  if (!window.GHOST && (!Sync.on() || window.__synced)) { seedDates(); tidySeededExpiry(); syncAllDocDates(); dedupeSeedDates(); }   // a new device waits for its first sync
  const dates = all('date'), cats = dateCats(), home = $('dateHome');
  if (datePath && !cats.some(c => c[0] === datePath)) datePath = null;
  let list = [];
  if (!datePath) {
    const days = +(prefs.dateBadgeDays || 7), soonN = +(prefs.dateSoonDays || 30), soon = dateRows(dates.filter(d => d.when)).filter(x => x.days >= 0 && x.days <= dateLead(x.d));
    home.innerHTML = `<div class="date-top">${soon.length ? `<div class="group-title">Coming up</div><div class="group" id="dateSoon">${soon.map(x => dateRowHtml(x, true, true)).join('')}</div>` : `<p class="hint" style="margin:0 4px 8px">Nothing in the next ${soonN} days.</p>`}</div>`;
    home.innerHTML += `<div class="group-title" id="dateCatTitle" style="margin-top:4px">Categories</div><div class="folders">${cats.map(([k, n, i]) => { const own = dates.filter(d => dateCat(d) === k), set = own.filter(d => d.when).length, near = dateRows(own.filter(d => d.when)).filter(x => x.days >= 0 && x.days <= days).length;
      return `<button class="folder" data-dcat="${k}"><b>${i} ${esc(n)}</b><span>${own.length} · ${set} dated</span>${near ? `<small class="warn">${near} within ${days} days</small>` : ''}</button>`; }).join('')}</div>
      <div class="date-cat-actions"><button class="btn ghost small" id="dateNewCat">＋ New category</button><button class="btn ghost small" id="dateIcsAll">📅 All to iPhone Calendar</button><button class="btn ghost small" id="dateImp">⤓ Import / export (CSV)</button></div>`;
  } else {
    const c = cats.find(x => x[0] === datePath);
    list = dateRows(dates.filter(d => dateCat(d) === datePath));
    home.innerHTML = `<div class="doc-crumb"><button class="chip" data-dback="1">‹ All categories</button><b>${c[2]} ${esc(c[1])}</b><span class="muted">${list.length}</span></div>
      <div class="set-row date-lead"><span>Show in Coming up</span><select id="dateCatLead"><option value="0">Default (${+(prefs.dateSoonDays || 30)} days)</option>${LEAD_OPTS.map(n => `<option value="${n}"${catLead(datePath) === n ? ' selected' : ''}>${n} days ahead</option>`).join('')}</select></div>
      <div class="date-cat-actions"><button class="btn ghost small" id="dateAddHere">＋ Add here</button><button class="btn ghost small" id="dateIcsCat">📅 To Calendar</button><button class="btn ghost small" id="dateRenCat">✎ Rename</button><button class="btn ghost small" id="dateDelCat" style="color:var(--seal)">Delete category</button></div>`;
  }
  $('dateList').innerHTML = list.map(x => dateRowHtml(x, !datePath)).join('') || (datePath ? '<div class="empty">Nothing here yet — tap “Add here”.</div>' : '');
  $('dateList').classList.toggle('hidden', !$('dateList').innerHTML); setTimeout(selPaint, 0);
  $$('[data-date]', $('datesPane')).forEach(w => { const id = w.dataset.date; bindSwipe(w, null, () => deleteWithUndo(id)); bindHold(w, 'date', id); onTap(w, e => { if (e && e.target && e.target.closest('[data-dtask]')) { dateToTask(id); return; } openDate(id); }); });
  $$('[data-dcat]', home).forEach(b => { if (!window.GHOST) bindHold(b, 'dcat', b.dataset.dcat); b.addEventListener('click', () => { if (folderSkip(b)) return; datePath = b.dataset.dcat; renderDates(); $('main').scrollTop = 0; }); });
  $$('[data-dback]', home).forEach(b => b.addEventListener('click', () => { if (SEL_RAW.has(Sel.kind)) selEnd(); datePath = null; renderDates(); }));
  const on = (id, f) => { if ($(id)) $(id).addEventListener('click', f); };
  on('dateAddHere', () => openAdd('date'));
  if ($('dateCatLead')) $('dateCatLead').addEventListener('change', () => { setCatLead(datePath, +$('dateCatLead').value); toast('Saved.'); });
  on('dateNewCat', newDateCat);
  on('dateRenCat', () => renameDateCat(datePath));
  on('dateUnhide', () => { const c = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false }; c.hidden = []; put(c); toast('Hidden categories are back.'); });
  on('dateDelCat', () => deleteDateCat(datePath));
  on('dateDelCatOld', () => {
    const own = dates.filter(d => dateCat(d) === datePath), c = cats.find(x => x[0] === datePath);
    if (!confirm(`Delete the category "${c[1]}"${own.length ? ` and its ${own.length} entr${own.length === 1 ? 'y' : 'ies'}` : ''}?\n\nEntries can be brought back from Settings → Recently deleted for 30 days.`)) return;
    own.forEach(d => softDelete(d.id, { render: false }));
    const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
    if ((cfg.custom || []).some(x => x.k === datePath)) cfg.custom = cfg.custom.filter(x => x.k !== datePath); else cfg.hidden = [...new Set([...(cfg.hidden || []), datePath])];
    datePath = null; put(cfg); toast(`Deleted "${c[1]}".`);
  });
  on('dateIcsAll', () => icsSaveNew(dates.filter(d => d.when), 'Register dates'));
  on('dateImp', openDateImport);
  on('dateIcsCat', () => icsSaveNew(dates.filter(d => d.when && dateCat(d) === datePath), (cats.find(x => x[0] === datePath) || [0, 'Dates'])[1]));
}
function dateNearCount() {
  if (window.GHOST) return 0;
  const n = +(prefs.dateBadgeDays || 7), ids = new Set();
  dateRows(all('date').filter(d => d.when)).forEach(x => { if (x.days >= 0 && x.days <= n) ids.add(x.d.docRef || x.d.id); });
  all('doc').forEach(d => { if (d.expiry && !ids.has(d.id)) { const k = daysTo(d.expiry); if (k >= 0 && k <= n) ids.add(d.id); } });
  return ids.size;
}
function updateDateBadge() {
  const n = dateNearCount(), b = $('datesBadge');
  b.classList.toggle('hidden', !n); b.textContent = n; b.setAttribute('aria-label', `${n} date${n === 1 ? '' : 's'} in the next ${prefs.dateBadgeDays || 7} days`);
  try { if (prefs.iconBadge && navigator.setAppBadge) { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } } catch (e) {}
}
function dateNudge() {
  if (window.GHOST || document.documentElement.classList.contains('decoy-on')) return;
  const key = 'r2_dateNudge', today = todayISO(); let last = ''; try { last = localStorage.getItem(key) || ''; } catch (e) {}
  if (last === today) return;
  const n = +(prefs.dateBadgeDays || 7), L = dateRows(all('date').filter(d => d.when)).filter(x => x.days >= 0 && x.days <= n);
  if (!L.length) return;
  try { localStorage.setItem(key, today); } catch (e) {}
  toast(`📅 ${L.slice(0, 2).map(x => `${x.d.label} (${inDays(x.days)})`).join(', ')}${L.length > 2 ? ` +${L.length - 2} more` : ''}`, 'See', () => { datePath = null; showTab('dates'); }, 8000, { once: 'dateNudge' });
}
function icsTextOld(list) {
  const e = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n'), stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Register//Dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  list.forEach(d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.when || '')) return;
    const nx = new Date(d.when + 'T00:00:00'); nx.setDate(nx.getDate() + 1);
    L.push('BEGIN:VEVENT', `UID:${d.id}@register`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d.when.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${isoLocal(nx).replace(/-/g, '')}`, `SUMMARY:${e(d.label)}`);
    if (d.repeat === 'yearly') L.push('RRULE:FREQ=YEARLY'); else if (d.repeat === 'monthly') L.push('RRULE:FREQ=MONTHLY');
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
}
function icsSave(list, name, skipped) {
  if (!list.length) { toast('No dates filled in yet.'); return; }
  dl(new Blob([icsText(list)], { type: 'text/calendar' }), name.replace(/[\\/:*?"<>|]/g, '-') + '.ics');
  markInCal(list);
  toast(`${list.length} date${list.length > 1 ? 's' : ''} sent to Calendar${skipped ? ` (${skipped} already there, left out)` : ''} — tap “Add All” if asked. Reminders: 9 AM the day before and 9 AM on the day.`, null, null, 7000);
}
/* only the dates not sent before, so iPhone Calendar does not get them twice */
function icsSaveNew(list, name) {
  if (!list.length) { toast('No dates filled in yet.'); return; }
  const fresh = list.filter(d => !inCal(d));
  if (!fresh.length) { toast(`All ${list.length} are already in Calendar.`, 'Send all again', () => icsSave(list, name), 8000); return; }
  icsSave(fresh, name, list.length - fresh.length);
}
$('deIcs').addEventListener('click', () => { const d = records[editDateId]; if (!d) return; const w = $('deWhen').value; if (!w) { toast('Set the date first.'); return; } icsSave([{ ...d, when: w, label: $('deLabel').value.trim() || d.label, repeat: $('deRepeat').value }], d.label); });
$('setIconBadge').addEventListener('change', async () => {
  const on = $('setIconBadge').checked;
  if (on && window.Notification && Notification.permission !== 'granted') { try { await Notification.requestPermission(); } catch (e) {} }
  setPref('iconBadge', on && (!window.Notification || Notification.permission === 'granted'));
  if (on && !prefs.iconBadge) { $('setIconBadge').checked = false; toast('iPhone did not allow it. Settings → Notifications → Register → allow Badges, then try again.', null, null, 7000); }
  updateDateBadge();
});
$('setDateDays').addEventListener('change', () => { setPref('dateBadgeDays', +$('setDateDays').value); updateDateBadge(); });
$('setDateSoon').addEventListener('change', () => { setPref('dateSoonDays', +$('setDateSoon').value); scheduleRender(); });
setTimeout(dateNudge, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateDateBadge(); setTimeout(dateNudge, 1500); } });

