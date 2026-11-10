/* ==========================================================================
   DOCUMENT FILES (v2.1) — photos / PDFs attached to a document, kept in Drive.
   A locked file is encrypted on this device with its own random key before
   upload. That key is stored in a sealed 'filekey' record, so it is protected
   by the private code and follows code changes automatically.
   ======================================================================== */
const DOCFILE_MAX = 50 * 1024 * 1024;               // v2.24: files travel in 4 MB pieces (Apps Script v26)
const ONE_MSG_MAX = 20 * 1024 * 1024;               // what an older Apps Script (one message per file) takes
const DOC_EXT_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', webp: 'image/webp', gif: 'image/gif',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain' };
const DOC_ACCEPT = 'image/*,application/pdf,.pdf,.xlsx,.xls,.csv,.docx,.doc,.txt,' + Object.values(DOC_EXT_MIME).filter(m => !/^image|pdf/.test(m)).join(',');
const extOf = n => ((String(n || '').match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '').toLowerCase();
/* v2.24: what a file is — pdf, img, xls, csv, word, txt ('' = not accepted) */
function fileKind(f) {
  const m = String((f && (f.mime || f.type)) || '').toLowerCase(), e = extOf(f && f.name);
  if (/pdf/.test(m) || e === 'pdf') return 'pdf';
  if (/^image\//.test(m) || ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif'].includes(e)) return 'img';
  if (e === 'csv' || /text\/csv/.test(m)) return 'csv';
  if (e === 'xlsx' || e === 'xls' || /spreadsheetml|ms-excel/.test(m)) return 'xls';
  if (e === 'docx' || e === 'doc' || /wordprocessingml|msword/.test(m)) return 'word';
  if (e === 'txt' || /^text\/plain/.test(m)) return 'txt';
  return '';
}
const KIND_TAG = { pdf: 'PDF', img: 'IMG', xls: 'XLS', csv: 'CSV', word: 'DOC', txt: 'TXT' };
const mimeFor = f => { const e = extOf(f.name), t = String(f.type || ''); return t && t !== 'application/octet-stream' ? t : DOC_EXT_MIME[e] || 'application/octet-stream'; };
/* ---------- v2.24: files to and from Drive in pieces (Apps Script v26); older scripts get one message ---------- */
async function callRetry(action, body, ms) {
  try { return await Sync.call(action, body, ms); }
  catch (e) { if (/unknown action|not allowed|too large|expired|unauthorized/i.test(e.message)) throw e; await new Promise(r => setTimeout(r, 1500)); return Sync.call(action, body, ms); }
}
async function driveSendBytes(body, name, mime, onProg) {
  if (!Sync.noParts) {
    try {
      const st = await Sync.call('driveUpStart', { folderId: prefs.driveFolder, name, mime, size: body.length }, 60000);
      const part = st.part || 4194304; let off = 0, res = null;
      while (off < body.length) {
        const piece = body.subarray(off, Math.min(body.length, off + part));
        res = await callRetry('driveUpPart', { up: st.up, offset: off, data: b64(piece) }, 180000);
        off += piece.length; if (onProg) onProg(off, body.length);
      }
      if (!res || !res.fileId) throw new Error('Drive did not return a file id');
      return res.fileId;
    } catch (e) { if (!/unknown action/i.test(e.message)) throw e; Sync.noParts = true; RLOG.info('Apps Script has no piece upload — one message per file'); }
  }
  if (body.length > ONE_MSG_MAX) throw new Error('larger than 20 MB — update the Apps Script to v26 for files up to 50 MB');
  const d = await Sync.call('driveUpload', { folderId: prefs.driveFolder, name, mime, data: b64(body) }, 240000);
  if (!d.fileId) throw new Error('Drive did not return a file id');
  return d.fileId;
}
async function driveFetchBytes(fileId, onProg) {
  if (!Sync.noParts) {
    try {
      let off = 0, size = null, mime = ''; const parts = [];
      do {
        const d = await callRetry('driveGetPart', { fileId, offset: off }, 180000);
        if (size === null) { size = +d.size || 0; mime = d.mime || ''; }
        const b = unb64(d.data || ''); if (!b.length && off < size) throw new Error('Drive sent an empty piece');
        parts.push(b); off += b.length; if (onProg) onProg(off, size);
      } while (off < size);
      const out = new Uint8Array(off); let p = 0; parts.forEach(b => { out.set(b, p); p += b.length; });
      return { bytes: out, mime };
    } catch (e) { if (!/unknown action/i.test(e.message)) throw e; Sync.noParts = true; }
  }
  const d = await Sync.call('driveGet', { fileId }, 240000);
  if (!d.data) throw new Error('Drive returned an empty file');
  return { bytes: unb64(d.data), mime: d.mime || '' };
}
/* the copy kept on this device: a Blob (v2.24) or, from older versions, a data: URL */
async function cachedBytes(fileId) {
  let v = null; try { v = await DB.imgGet(fileId); } catch (e) {}
  if (!v) return null;
  if (typeof v === 'string') return unb64(v.slice(v.indexOf(',') + 1));
  if (v instanceof Blob) return new Uint8Array(await v.arrayBuffer());
  if (v && v.byteLength !== undefined) return new Uint8Array(v);
  return null;
}
const PDFJS_URL = 'vendor/pdf-3.11.174.min.js';           // v2.18: libraries are served from this site (see vendor/README.md), not a CDN
const PDFJS_WORKER = 'vendor/pdf.worker-3.11.174.min.js';
const PDFLIB_URL = 'vendor/pdf-lib-1.17.1.min.js';
const PDF_PAGE_BATCH = 10;
const docPlain = new Map();                       // docfile id -> { blob, url }, memory only
const docFilesOf = docId => all('docfile').filter(f => f.docId === docId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const isPdf = f => /pdf/i.test(f.mime || '') || /\.pdf$/i.test(f.name || '');
const fmtBytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const stemOf = n => String(n || 'file').replace(/\.[^.]+$/, '');
function lockedErr() { const e = new Error('private section is locked'); e.code = 'LOCKED'; return e; }

async function aesEncBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
  return out;
}
async function aesDecBytes(key, raw) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)));
}
const importFileKey = raw => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function fileKeyOf(f) {
  if (!Fin.key) throw lockedErr();
  const k = records[f.keyId];
  if (!k) throw new Error('the key for this locked file is missing on this device — sync, then try again');
  return importFileKey(k.raw);
}

/* Encrypt (if asked) and upload. Returns { fileId, keyId }. */
async function putDocBytes(bytes, name, mime, lock) {   // putDocBytes.onProg(sent, total) may be set by the caller
  let body = bytes, upMime = mime, keyId = null;
  try {
    if (lock) {
      if (!Fin.key) throw lockedErr();
      const raw = b64(crypto.getRandomValues(new Uint8Array(32)));
      keyId = put({ id: uid('fk'), type: 'filekey', raw, deleted: false }, { render: false }).id;
      body = await aesEncBytes(await importFileKey(raw), bytes);
      upMime = 'application/octet-stream';
    }
    const fileId = await driveSendBytes(body, lock ? name + '.locked' : name, upMime, putDocBytes.onProg);
    DB.imgSet(fileId, new Blob([body], { type: upMime })).catch(() => {});   // locked files are cached as ciphertext only
    return { fileId, keyId };
  } catch (e) {
    if (keyId && records[keyId]) softDelete(keyId, { render: false });
    throw e;
  }
}
async function rawDocBytes(f, onProg) {
  const have = await cachedBytes(f.fileId);
  if (have) return have;
  if (!Sync.on()) throw new Error('sync is not set up, so the file cannot be fetched from Drive');
  const { bytes, mime } = await driveFetchBytes(f.fileId, onProg);
  try { await DB.imgSet(f.fileId, new Blob([bytes], { type: mime || 'application/octet-stream' })); } catch (e) { RLOG.warn('keep copy', e.message); }
  return bytes;
}
async function docFileBlob(f) {
  if (f.locked && !Fin.key) throw lockedErr();                            // before the cache: a file locked on another device stays locked here
  if (docPlain.has(f.id)) { const v = docPlain.get(f.id); docPlain.delete(f.id); docPlain.set(f.id, v); return v; }
  let bytes = await rawDocBytes(f);
  if (f.locked) {
    try { bytes = await aesDecBytes(await fileKeyOf(f), bytes); }
    catch (e) { if (e.code === 'LOCKED') throw e; throw new Error(/key/.test(e.message) ? e.message : 'could not decrypt this file'); }
  }
  const blob = new Blob([bytes], { type: f.mime || 'application/octet-stream' });
  const v = { blob, url: URL.createObjectURL(blob) };
  docPlain.set(f.id, v);
  while (docPlain.size > 12) { const [k, o] = docPlain.entries().next().value; docPlain.delete(k); setTimeout(() => URL.revokeObjectURL(o.url), 60000); }   // keep memory small on the iPhone
  return v;
}
function forgetLockedPlain() {
  for (const [id, v] of docPlain) {
    const f = records[id];
    if (!f || f.locked) { URL.revokeObjectURL(v.url); docPlain.delete(id); }
  }
}
async function fileToBytes(file) {
  if (/^image\//.test(file.type) && !/gif|svg/.test(file.type)) {
    const dataUrl = await prepForDrive(file);                 // very large photos are shrunk to 2400 px JPEG
    return { bytes: unb64(dataUrl.slice(dataUrl.indexOf(',') + 1)), mime: dataUrl.slice(5, dataUrl.indexOf(';')) };
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime: mimeFor(file) };
}
function docFileBadge(d) {
  const n = docFilesOf(d.id).length;
  const ys = d.byYear ? docYears(d).filter(y => y !== d.fy) : [];
  return (d.who ? `<span>👤 ${esc(docOwners(d).join(' & '))}</span>` : '') + (d.fy ? `<span>FY ${esc(d.fy)}</span>` : '') + (ys.length ? `<span>${ys.length === 1 ? 'FY ' + ys[0] : ys.length + ' years · latest ' + ys[0]}</span>` : '') + (n ? `<span>📎 ${n}</span>` : '') + (d.lockFiles ? '<span aria-label="files locked">🔒</span>' : '');
}
/* Long ID numbers show only their last 4 characters on screen (Aadhaar, PAN, passport, licence). */
const docNumShown = d => d.number ? maskNo(d.number) : d.numEnc ? '•••• ' + (d.numTail || '') : '';
async function docNumFull(d) { if (d.number) return d.number; if (!d.numEnc) return ''; if (!Fin.key) throw lockedErr(); return aesDec(Fin.key, d.numEnc); }
async function sealDocNumber(d) {
  if (!Fin.key) return false;
  if (d.lockFiles && d.number) { d.numEnc = await aesEnc(Fin.key, d.number); d.numTail = d.number.replace(/[\s-]/g, '').slice(-4); d.number = ''; return true; }
  if (!d.lockFiles && d.numEnc) { try { d.number = await aesDec(Fin.key, d.numEnc); } catch (e) { return false; } delete d.numEnc; delete d.numTail; return true; }
  return false;
}
async function sealDocNumbers() { for (const d of all('doc')) if (d.lockFiles && d.number && await sealDocNumber(d)) put(d, { render: false }); }
function maskNo(n) { const s = String(n || '').trim(); return s.replace(/[\s-]/g, '').length >= 8 ? '•••• ' + s.replace(/[\s-]/g, '').slice(-4) : s; }
function showDoc(id) { if (docFilesOf(id).length) openDocView(id); else openDoc(id); }

/* ---------- editor: file list, add, remove, lock ---------- */
function renderDocEditFiles() {
  const d = records[editDocId]; if (!d) return;
  const fs = docFilesOf(d.id);
  $('doLock').checked = !!d.lockFiles;
  const mismatch = fs.filter(f => !!f.locked !== !!d.lockFiles).length;
  const row = f => `<div class="dfile">
      <span class="dficon" aria-hidden="true">${f.locked ? '🔒' : KIND_TAG[fileKind(f)] || 'FILE'}</span>
      <span class="dfname">${esc(f.name)}<small>${fmtBytes(f.bytes || 0)}${f.locked ? ' · locked' : ''}</small>${d.byYear ? `<select class="dffy" data-dffy="${f.id}" aria-label="Year">${fyOptions(f.fy || '', 'No year')}</select>` : ''}</span>
      ${/^image\//.test(f.mime || '') || isPdf(f) ? `<button class="icon-btn dfedit" data-dfed="${f.id}" aria-label="Crop or straighten ${esc(f.name)}">✂</button>` : ''}<button class="icon-btn" data-dfrm="${f.id}" aria-label="Remove ${esc(f.name)}" style="width:34px;height:34px;font-size:14px">✕</button></div>`;
  const groups = d.byYear ? [...new Set(fs.map(f => f.fy || ''))].sort().reverse() : [null];
  $('doFiles').innerHTML = (fs.length ? groups.map(g => (g === null ? '' : `<div class="dfyear">${g ? 'FY ' + g : 'No year'}</div>`) + fs.filter(f => g === null || (f.fy || '') === g).map(row).join('')).join('')
    : '<div class="hint" style="margin:0 4px 4px">No files yet.</div>')
    + (mismatch ? `<button class="linkbtn" id="doFinish">Finish ${d.lockFiles ? 'locking' : 'unlocking'} (${mismatch} left)</button>` : '');
  $$('[data-dfrm]', $('doFiles')).forEach(b => b.addEventListener('click', () => removeDocFile(b.dataset.dfrm)));
  $$('[data-dfed]', $('doFiles')).forEach(b => b.addEventListener('click', () => editDocFile(b.dataset.dfed)));
  $$('[data-dffy]', $('doFiles')).forEach(s => s.addEventListener('change', () => { const f = records[s.dataset.dffy]; f.fy = s.value || undefined; put(f, { render: false }); renderDocEditFiles(); scheduleRender(); }));
  const fin = $('doFinish'); if (fin) fin.addEventListener('click', () => convertDocFiles(d));
}
async function addDocFiles(docId, files) {
  const d = records[docId]; if (!d) return;
  const msg = $('doFileMsg');
  if (!driveOn()) { msg.className = 'msg err'; msg.textContent = 'Files are kept in your Google Drive folder. Set it in Settings (Drive folder), tap Test, then try again.'; return; }
  if (d.lockFiles && !Fin.key) { msg.className = 'msg err'; msg.textContent = 'This document locks its files — unlock first.'; return; }
  let ok = 0; const bad = [], fyPick = d.byYear ? $('doFileFy').value : null;   // read once: the editor may show another document before the uploads finish
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    msg.className = 'msg'; msg.textContent = `Uploading ${i + 1} of ${files.length}…`;
    try {
      const kind = fileKind(file);
      if (!kind) throw new Error('only photos, PDFs, Excel, Word and text files can be added');
      if (file.size > DOCFILE_MAX) throw new Error('larger than 50 MB');
      const { bytes, mime } = await fileToBytes(file);
      if (bytes.length > DOCFILE_MAX) throw new Error('larger than 50 MB');
      const ext = /jpeg/.test(mime) ? '.jpg' : /png/.test(mime) ? '.png' : /pdf/.test(mime) ? '.pdf' : extOf(file.name) ? '.' + extOf(file.name) : '';
      putDocBytes.onProg = bytes.length > 3e6 ? (a, t) => { msg.textContent = `Uploading ${i + 1} of ${files.length}… ${Math.round(a / t * 100)}%`; } : null;
      const fy = fyPick;
      const base = ((d.title || 'Document') + (fy ? ' FY ' + fy : '')).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60) || 'Document';
      const taken = new Set(docFilesOf(docId).map(x => (x.name || '').toLowerCase()));
      let name = base + ext, k = 2;
      while (taken.has(name.toLowerCase())) name = `${base} (${k++})${ext}`;
      const up = await putDocBytes(bytes, todayISO() + '-' + name, mime, !!d.lockFiles);
      const nf = put({ id: uid('df'), type: 'docfile', docId, name, mime, bytes: bytes.length, fileId: up.fileId, keyId: up.keyId, locked: !!d.lockFiles, fy: fy || undefined, deleted: false }, { render: false });
      if (!d.lockFiles && fileKind(nf) !== 'img') indexSoon(nf.id, bytes);   // v2.19: words inside the PDF become searchable (v2.24: Excel, Word and text too)
      ok++;
    } catch (e) { RLOG.warn('doc file add failed', e.message); bad.push(`${file.name || 'file'}: ${e.message}`); }
    finally { putDocBytes.onProg = null; }
  }
  msg.className = bad.length ? 'msg err' : 'msg ok';
  msg.textContent = (ok ? `${ok} file${ok > 1 ? 's' : ''} added${d.lockFiles ? ' and locked' : ''}. ` : '') + (bad.length ? 'Not added: ' + bad.join('; ') : '');
  renderDocEditFiles(); scheduleRender();
}
function removeDocFile(id) {
  const f = records[id]; if (!f) return;
  softDelete(id, { render: false });
  renderDocEditFiles(); scheduleRender();
  toast('File removed', 'Undo', () => { restore(id); renderDocEditFiles(); });
  setTimeout(() => {
    const r = records[id];
    if (r && r.deleted) { driveDelete(r.fileId); if (r.keyId && records[r.keyId]) softDelete(r.keyId, { render: false }); }
  }, 7000);
}
/* Re-upload every file whose locked state differs from the document's setting. */
async function convertDocFiles(d) {
  const want = !!d.lockFiles, msg = $('doFileMsg');
  const fs = docFilesOf(d.id).filter(f => !!f.locked !== want);
  if (!fs.length) { msg.className = 'msg ok'; msg.textContent = want ? 'New files for this document will be locked.' : 'New files will not be locked.'; renderDocEditFiles(); return; }
  if (!driveOn()) { msg.className = 'msg err'; msg.textContent = 'Drive is not set up, so existing files cannot be converted yet.'; renderDocEditFiles(); return; }
  let n = 0;
  for (const f of fs) {
    msg.className = 'msg'; msg.textContent = `${want ? 'Locking' : 'Unlocking'} file ${++n} of ${fs.length}…`;
    try {
      const { blob } = await docFileBlob(f);
      const up = await putDocBytes(new Uint8Array(await blob.arrayBuffer()), todayISO() + '-' + f.name, f.mime, want);
      const oldFile = f.fileId, oldKey = f.keyId;
      f.fileId = up.fileId; f.keyId = up.keyId; f.locked = want;
      put(f, { render: false });
      driveDelete(oldFile);                                   // also clears this device's cached copy
      if (oldKey && records[oldKey]) softDelete(oldKey, { render: false });
    } catch (e) {
      RLOG.warn('lock convert failed', e.message);
      msg.className = 'msg err'; msg.textContent = `Stopped at file ${n}: ${e.message}. Tap "Finish" to retry.`;
      renderDocEditFiles(); scheduleRender(); return;
    }
  }
  msg.className = 'msg ok'; msg.textContent = want ? 'Files are now locked.' : 'Files are no longer locked.';
  renderDocEditFiles(); scheduleRender();
}
$('doFileBtn').addEventListener('click', () => $('doFileIn').click());
$('doByYear').addEventListener('change', () => {
  const d = records[editDocId]; if (!d) return;
  d.byYear = $('doByYear').checked; put(d, { render: false });
  if (d.byYear) docFilesOf(d.id).forEach(f => { if (!f.fy) { f.fy = d.fy || fyOf(f.createdAt ? isoLocal(new Date(f.createdAt)) : todayISO()); put(f, { render: false }); } });   // existing files get a year to start with
  $('doFileFyW').classList.toggle('hidden', !d.byYear); renderDocEditFiles(); scheduleRender();
});
$('doFileIn').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) addDocFiles(editDocId, files); });
$('doLock').addEventListener('change', () => {
  const d = records[editDocId]; if (!d) return;
  const want = $('doLock').checked;
  if (!Fin.key) { $('doLock').checked = !want; if (finConfigured()) needUnlock(() => { if (editDocId === d.id && Sheets.isOpen('shDoc')) { $('doLock').checked = want; $('doLock').dispatchEvent(new Event('change')); } }, 'docs'); else toast('Set up the private section first — tap “Register” three times.'); return; }   // v2.27: asks for the code here (documents only)
  d.lockFiles = want; put(d, { render: false });
  sealDocNumber(d).then(ch => { if (ch) put(d, { render: false }); });
  convertDocFiles(d);
});

/* ---------- viewer ---------- */
let viewDocId = null, docReturn = null;
/* v2.21 (C1): a renewed document keeps its history — the old expiry and number are listed, its old files are marked "earlier copy" */
/* v2.22: copy a document's number straight from the list (a locked number needs the private section open) */
async function copyDocNumber(id) {
  const d = records[id]; if (!d) return;
  try { const n = await docNumFull(d); if (!n) { toast('No number saved.'); return; } await navigator.clipboard.writeText(n); toast(`Copied ${d.title.slice(0, 28)} number.`); }
  catch (e) { toast(e && e.code === 'LOCKED' || d.numEnc ? 'This number is locked — unlock first.' : 'Could not copy — open the document and tap Show.'); }
}
function renewDoc(id) {
  const d = records[id]; if (!d || !d.expiry) return;
  const plainNo = !d.numEnc;
  planSheet('Renewed — ' + d.title, `<p class="hint" style="margin:0 4px 10px">The current details move to “Earlier”, with its files marked as earlier copies. Nothing is deleted.</p>
    <div class="field"><label>New ${esc(dueWord(d.dueKind || 'expiry'))} date</label><input type="date" id="rnExp" min="${todayISO()}"></div>
    ${plainNo ? `<div class="field"><label>New number (leave blank if the same)</label><input id="rnNum" autocapitalize="characters" autocomplete="off"></div>` : ''}`,
    () => {
      const ex = $('rnExp').value; if (!ISO_DATE_RX.test(ex)) { planMsg('Pick the new date.', true); return false; }
      if (ex <= d.expiry) { planMsg('The new date should be after ' + fmtDate(d.expiry, true) + '.', true); return false; }
      const nn = plainNo && $('rnNum') ? $('rnNum').value.trim() : '', today = todayISO();
      d.history = [...(d.history || []), { expiry: d.expiry, number: plainNo ? (d.number || '') : '', renewedOn: today }].slice(-10);
      docFilesOf(id).forEach(f => { if (!f.prevUntil) { f.prevUntil = d.expiry; put(f, { render: false }); } });
      d.expiry = ex; if (nn) d.number = nn;
      put(d); try { syncDocDate(d); } catch (e) { RLOG.warn('renew date', e.message); }
      setTimeout(() => { if (Sheets.isOpen('shDocView')) openDocView(id); toast('Renewed. Attach the new copy?', 'Add file', () => { Sheets.closeAll(); openDoc(id); }, 8000); }, 50);
      return true;
    }, 'Save');
}
function openDocView(id) {
  const d = records[id]; if (!d) return;
  viewDocId = id;
  $('dvTitle').textContent = d.title;
  const days = d.expiry ? daysUntilISO(d.expiry) : null;
  $('dvMeta').innerHTML = (d.who ? `<span>👤 ${esc(docOwners(d).join(' & '))}</span>` : '') + `<span>${esc(d.docType || '')}</span>` + (docNumShown(d) ? `<span class="mono" id="dvNum">${esc(docNumShown(d))}</span>`
      + (d.numEnc || maskNo(d.number) !== d.number ? '<button class="linkbtn" id="dvNumShow" style="padding:0 2px">Show</button>' : '') + '<button class="linkbtn" id="dvNumCopy" style="padding:0 2px">Copy</button>' : '')
    + (d.expiry ? `<span class="${days < 0 ? 'warn' : ''}">${days < 0 ? 'expired' : 'expires'} ${fmtDate(d.expiry, true)}</span><button class="linkbtn" id="dvRenew" style="padding:0 2px">↻ Renewed</button>` : '')
    + ((d.history || []).length ? `<span class="dv-hist">Earlier: ${d.history.slice().reverse().map(h => `till ${fmtDate(h.expiry, true)}${h.number ? ' · ' + esc(maskNo(h.number)) : ''}`).join('; ')}</span>` : '');
  if ($('dvRenew')) $('dvRenew').addEventListener('click', () => renewDoc(id));
  const sh = $('dvNumShow'); if (sh) sh.addEventListener('click', async () => { const on = sh.textContent === 'Show';
    if (!on) { $('dvNum').textContent = docNumShown(d); sh.textContent = 'Show'; return; }
    try { $('dvNum').textContent = await docNumFull(d); sh.textContent = 'Hide'; } catch (e) { toast('Locked.'); } });
  const cp = $('dvNumCopy'); if (cp) cp.addEventListener('click', async () => { try { await navigator.clipboard.writeText(await docNumFull(d)); toast('Number copied.'); } catch (e) { toast('Could not copy — tap Show and select it.'); } });
  const fs = docFilesOf(id).sort((a, b) => !!a.prevUntil - !!b.prevUntil);          // v2.21: the current copy first, earlier copies after
  $('dvFiles').innerHTML = fs.length ? fs.map(f => `<figure class="dv-file" data-dvf="${f.id}"><figcaption>${f.locked ? '🔒 ' : ''}${esc(f.name)}${f.prevUntil ? ` <span class="pill">earlier copy · till ${fmtDate(f.prevUntil, true)}</span>` : ''}</figcaption>
      <div class="dv-body"><div class="dv-wait">${f.locked && !Fin.key ? 'Locked. Enter the code to view.' : 'Loading…'}</div></div></figure>`).join('')
    : '<div class="empty"><b>No files</b>Tap Edit to attach a photo or PDF.</div>';
  $('dvUnlock').classList.toggle('hidden', !(fs.some(f => f.locked) && !Fin.key));
  $('dvShare').classList.toggle('hidden', !fs.length);
  Sheets.open('shDocView');
  if (d.byYear && fs.length) docViewByYear(d, fs); else fs.forEach(f => { if (!f.locked || Fin.key) showDocFile(f); });
}
function docViewByYear(d, fs) {
  const years = [...new Set(fs.map(f => f.fy || ''))].sort().reverse(), first = docYear !== 'All' && years.includes(docYear) ? docYear : years[0];
  const fig = f => `<figure class="dv-file" data-dvf="${f.id}"><figcaption>${f.locked ? '🔒 ' : ''}${esc(f.name)}</figcaption>
      <div class="dv-body"><div class="dv-wait">${f.locked && !Fin.key ? 'Locked. Enter the code to view.' : 'Tap to load'}</div></div></figure>`;
  $('dvFiles').innerHTML = years.map(y => { const list = fs.filter(f => (f.fy || '') === y);
    return `<details class="dv-year" data-dvy="${esc(y)}"${y === first ? ' open' : ''}><summary>${y ? 'FY ' + y : 'No year'} · ${list.length} file${list.length > 1 ? 's' : ''}</summary>${list.map(fig).join('')}</details>`; }).join('');
  const load = y => fs.filter(f => (f.fy || '') === y).forEach(f => { if (!f.locked || Fin.key) showDocFile(f); });
  $$('.dv-year', $('dvFiles')).forEach(det => det.addEventListener('toggle', () => { if (det.open && !det.dataset.loaded) { det.dataset.loaded = '1'; load(det.dataset.dvy); } }));
  const open = $('dvFiles').querySelector('.dv-year[open]'); if (open) { open.dataset.loaded = '1'; load(open.dataset.dvy); }
}
async function showDocFile(f) {
  const box = document.querySelector(`[data-dvf="${f.id}"] .dv-body`); if (!box) return;
  try {
    const { blob, url } = await docFileBlob(f);
    if (viewDocId !== f.docId || !box.isConnected) return;
    if (isPdf(f)) { await renderPdfInto(box, blob); return; }
    if (fileKind(f) !== 'img') { await renderOfficeInto(box, f, blob); return; }   // v2.24: Excel, Word, text
    box.innerHTML = `<img alt="${esc(f.name)}" src="${url}">`;
    box.addEventListener('click', e => { if (e.target.tagName === 'IMG') openLightbox(e.target.src); });
  } catch (e) {
    RLOG.warn('doc view failed', e.message);
    box.innerHTML = `<div class="dv-wait err">${e.code === 'LOCKED' ? 'Locked. Enter the code to view.' : 'Could not open: ' + esc(e.message)}</div>`;
  }
}
function loadScript(src) {
  src = new URL(src, location.href).href;                 // document.scripts reports absolute URLs
  return new Promise((res, rej) => {
    const had = [...document.scripts].find(s => s.src === src);
    if (had && had.dataset.ok) return res();
    const s = document.createElement('script'); s.crossOrigin = 'anonymous'; s.src = src; s.async = true;
    s.onload = () => { s.dataset.ok = '1'; res(); };
    s.onerror = () => { s.remove(); rej(new Error('needs internet the first time')); };
    document.head.appendChild(s);
  });
}
let pdfjsReady = null;
function pdfjs() {
  pdfjsReady = pdfjsReady || (async () => {
    await loadScript(PDFJS_URL);
    const src = await (await fetch(PDFJS_WORKER)).text();       // a worker must be same-origin, so run it from a blob
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    try { window.__pdfWorker = new window.pdfjsLib.PDFWorker({ name: 'register' }); } catch (e) { RLOG.warn('pdf worker', e.message); }   // one worker, reused by every PDF
    return window.pdfjsLib;
  })().catch(e => { pdfjsReady = null; throw e; });
  return pdfjsReady;
}
async function renderPdfInto(box, blob, password) {
  box.innerHTML = '<div class="dv-wait">Opening PDF…</div>';
  let lib, doc;
  try { lib = await pdfjs(); }
  catch (e) { box.innerHTML = `<div class="dv-wait">The PDF viewer could not load (${esc(e.message)}). Use Share, then "Save to Files", to open it.</div>`; return; }
  try { doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), password: password || undefined, isEvalSupported: false, ...pdfWorkerOpt() }).promise; pdfOpenDocs.add(doc); }
  catch (e) {
    if (e && e.name === 'PasswordException') {
      box.innerHTML = `<div class="dv-pass"><div class="hint" style="margin:0 0 8px">${password ? 'That password did not work. ' : ''}This PDF has its own password (e-Aadhaar PDFs do). It is not saved.</div>
        <div style="display:flex;gap:8px"><input type="password" placeholder="PDF password" autocapitalize="characters" autocomplete="off" style="flex:1;min-width:0"><button class="btn small">Open</button></div></div>`;
      const inp = box.querySelector('input'), go = () => renderPdfInto(box, blob, inp.value);
      box.querySelector('button').addEventListener('click', go);
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
      return;
    }
    box.innerHTML = `<div class="dv-wait err">Could not read this PDF: ${esc(e.message || String(e))}</div>`; return;
  }
  box.innerHTML = '';
  box.onclick = e => { if (e.target.tagName === 'CANVAS') zoomPdfPage(doc, [...box.querySelectorAll('canvas.dv-page')].indexOf(e.target) + 1, e.target); };
  const width = Math.max(280, Math.min(box.clientWidth || 600, 900));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let next = 1;
  const batch = async () => {
    const more = box.querySelector('.dv-more'); if (more) more.remove();
    const end = Math.min(doc.numPages, next + PDF_PAGE_BATCH - 1);
    for (; next <= end; next++) {
      const page = await doc.getPage(next);
      const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width * dpr });
      const cv = document.createElement('canvas'); cv.className = 'dv-page'; cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.setAttribute('aria-label', `Page ${next} of ${doc.numPages}`);
      box.appendChild(cv);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
    if (next <= doc.numPages) {
      const b = document.createElement('button'); b.className = 'dv-more'; b.textContent = `Show more pages (${doc.numPages - next + 1} left)`;
      b.addEventListener('click', ev => { ev.stopPropagation(); batch(); }); box.appendChild(b);
    }
  };
  await batch();
}
$('dvEdit').addEventListener('click', () => { const id = viewDocId; Sheets.close('shDocView', true); openDoc(id); });
$('dvUnlock').addEventListener('click', () => { docReturn = viewDocId; Fin.wantScope = 'docs'; openVault('unlock'); });   // v2.27: documents only
$('dvShare').addEventListener('click', () => openDocShare());

/* ---------- share (optional watermark) ---------- */
let shareReady = null;
const shareDate = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
function openDocShare() {
  const d = records[viewDocId]; if (!d) return;
  const fs = docFilesOf(d.id);
  $('dsFiles').innerHTML = fs.map(f => `<label class="switch-row"><span>${f.locked ? '🔒 ' : ''}${esc(f.name)}</span><input type="checkbox" class="sw" data-dsf="${f.id}" checked></label>`).join('');
  $('dsWm').checked = false; $('dsText').value = ''; $('dsTextWrap').classList.add('hidden');
  shareTitle = null; resetShare(); dsModeInit(fs.length);
  Sheets.open('shDocShare');
}
function resetShare() { shareReady = null; $('dsGo').textContent = 'Share'; $('dsMsg').className = 'msg'; $('dsMsg').textContent = ''; }
$('dsWm').addEventListener('change', () => { $('dsTextWrap').classList.toggle('hidden', !$('dsWm').checked); resetShare(); });
$('shDocShare').addEventListener('input', e => { if (e.target.id !== 'dsWm') resetShare(); });
function stampCanvas(g, w, h, text) {
  const fs = Math.max(14, Math.round(Math.min(w, h) / 20));
  g.save();
  g.translate(w / 2, h / 2); g.rotate(-Math.atan2(h, w));
  g.font = `600 ${fs}px -apple-system, "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(166,54,47,0.28)';
  const unit = text + '     ', diag = Math.hypot(w, h);
  const line = unit.repeat(Math.ceil(diag / Math.max(1, g.measureText(unit).width)) + 1);
  for (let y = -diag / 2; y <= diag / 2; y += fs * 4) g.fillText(line, 0, y);
  g.restore();
  const bh = Math.round(fs * 1.9);
  g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillRect(0, h - bh, w, bh);
  g.fillStyle = '#A6362F'; g.font = `700 ${Math.round(fs * 0.8)}px -apple-system, "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h - bh / 2, w - 20);
}
async function watermarkImage(blob, text) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not a picture')); i.src = url; });
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    stampCanvas(g, cv.width, cv.height, text);
    return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('could not save the picture')), 'image/jpeg', 0.9));
  } finally { URL.revokeObjectURL(url); }
}
async function watermarkPdf(blob, text) {
  try { await loadScript(PDFLIB_URL); } catch (e) { throw new Error('the PDF tool ' + e.message); }
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
  let pdf;
  try { pdf = await PDFDocument.load(await blob.arrayBuffer()); }
  catch (e) { throw new Error(/encrypt/i.test(e.message || '') ? 'it is password-protected' : 'it could not be edited'); }
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const t = text.replace(/₹/g, 'Rs ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '-');
  const red = rgb(0.65, 0.21, 0.18);
  pdf.getPages().forEach(p => {
    const { width: w, height: h } = p.getSize();
    const size = Math.max(10, Math.min(w, h) / 22), a = Math.atan2(h, w), cos = Math.cos(a), sin = Math.sin(a);
    const unit = t + '     ', diag = Math.hypot(w, h);
    const line = unit.repeat(Math.ceil(diag / font.widthOfTextAtSize(unit, size)) + 1);
    const lw = font.widthOfTextAtSize(line, size);
    for (let k = -Math.ceil(diag / (size * 4) / 2); k <= Math.ceil(diag / (size * 4) / 2); k++) {
      const cx = w / 2 - k * size * 4 * sin, cy = h / 2 + k * size * 4 * cos;
      p.drawText(line, { x: cx - cos * lw / 2, y: cy - sin * lw / 2, size, font, color: red, opacity: 0.28, rotate: degrees(a * 180 / Math.PI) });
    }
    const bh = size * 1.9;
    p.drawRectangle({ x: 0, y: 0, width: w, height: bh, color: rgb(1, 1, 1), opacity: 0.88 });
    const bs = size * 0.8, tw = font.widthOfTextAtSize(t, bs);
    p.drawText(t, { x: Math.max(6, (w - tw) / 2), y: bh / 2 - bs * 0.35, size: bs, font, color: red });
  });
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
async function doShare(files, firstTry) {
  const title = shareTitle || (records[viewDocId] && records[viewDocId].title) || 'Document';
  try {
    if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title }); Sheets.close('shDocShare'); if (shareTitle) { docSel = null; renderDocs(); } return; }
    files.forEach(f => dl(f, f.name)); Sheets.close('shDocShare'); return;
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (e && e.name === 'NotAllowedError' && firstTry) {           // iPhone wants a fresh tap after slow preparation
      $('dsGo').textContent = 'Share now'; $('dsMsg').className = 'msg ok';
      $('dsMsg').textContent = ($('dsMsg').textContent + ' Ready. Tap "Share now".').trim(); return;
    }
    $('dsMsg').className = 'msg err'; $('dsMsg').textContent = 'Sharing failed: ' + (e.message || e);
  }
}
$('dsGo').addEventListener('click', async () => {
  if (shareReady) { await doShare(shareReady, false); return; }
  const ids = $$('[data-dsf]', $('dsFiles')).filter(c => c.checked).map(c => c.dataset.dsf);
  const msg = $('dsMsg');
  if (!ids.length) { msg.className = 'msg err'; msg.textContent = 'Pick at least one file.'; return; }
  const wm = $('dsWm').checked ? `${$('dsText').value.trim() || 'Shared copy'} · ${shareDate()}` : '';
  $('dsGo').disabled = true; msg.className = 'msg'; msg.textContent = 'Preparing…';
  const files = [], notes = [];
  try {
    for (const id of ids) {
      const f = records[id]; if (!f) continue;
      const { blob } = await docFileBlob(f);
      if (!wm) { files.push(new File([blob], f.name, { type: f.mime })); continue; }
      if (!['pdf', 'img'].includes(fileKind(f))) { notes.push(`${f.name} sent without a watermark (only photos and PDFs can carry one).`); files.push(new File([blob], f.name, { type: f.mime })); continue; }
      if (isPdf(f)) {
        try { files.push(new File([await watermarkPdf(blob, wm)], stemOf(f.name) + '-shared.pdf', { type: 'application/pdf' })); }
        catch (e) { notes.push(`${f.name} sent without a watermark because ${e.message}.`); files.push(new File([blob], f.name, { type: f.mime })); }
      } else files.push(new File([await watermarkImage(blob, wm)], stemOf(f.name) + '-shared.jpg', { type: 'image/jpeg' }));
    }
  } catch (e) {
    $('dsGo').disabled = false; msg.className = 'msg err';
    msg.textContent = e.code === 'LOCKED' ? 'These files are locked — unlock first to share them.' : 'Could not prepare: ' + e.message; return;
  }
  if (AF_DS.mode === 'one' && files.length > 1) {
    msg.textContent = 'Combining into one PDF…';
    try { const r = await mergeToPdf(files, shareTitle || (records[viewDocId] && records[viewDocId].title) || 'Documents'); files.length = 0; files.push(r.file); if (r.skipped.length) notes.push('Left out: ' + r.skipped.join(', ') + '.'); }
    catch (e) { $('dsGo').disabled = false; msg.className = 'msg err'; msg.textContent = 'Could not combine: ' + e.message; return; }
  }
  $('dsGo').disabled = false; shareReady = files;
  msg.className = notes.length ? 'msg err' : 'msg'; msg.textContent = notes.join(' ');
  if (wm && notes.some(n => /without a watermark/.test(n))) { $('dsGo').textContent = 'Share anyway'; return; }   // you asked for a watermark: confirm first
  await doShare(files, true);
});

/* ---------- common documents quick add ---------- */
const COMMON_DOCS = [['Aadhaar card', 'Identity'], ['PAN card', 'Identity'], ['Driving licence', 'Identity'], ['Passport', 'Identity'],
  ['Voter ID', 'Identity'], ['10th marksheet', 'Education'], ['12th marksheet', 'Education'], ['Degree certificate', 'Education'], ['Vehicle RC', 'Vehicle']];
function openDocQuick() {
  const forWho = docPath.who || DOC_ME, have = new Set(all('doc').filter(d => docOwners(d).includes(forWho)).map(d => (d.title || '').trim().toLowerCase()));
  $('dqList').innerHTML = COMMON_DOCS.map(([t, ty], i) => {
    const got = have.has(t.toLowerCase());
    return `<label class="switch-row"><span>${t}<small class="dq-sub">${got ? 'Already in your list' : ty}</small></span><input type="checkbox" class="sw" data-dq="${i}"${got ? ' disabled' : ''}></label>`;
  }).join('');
  Sheets.open('shDocQuick');
}
$('docQuickBtn').addEventListener('click', openDocQuick);
$('dqAdd').addEventListener('click', () => {
  const picks = $$('[data-dq]', $('dqList')).filter(c => c.checked && !c.disabled).map(c => COMMON_DOCS[+c.dataset.dq]);
  if (!picks.length) { toast('Pick at least one.'); return; }
  picks.forEach(([t, ty]) => put({ id: uid('doc'), type: 'doc', title: t, docType: ty, number: '', expiry: null, issuer: '', notes: '', folder: docFolderForNew(), who: docPath.who && docPath.who !== DOC_ME ? docPath.who : '', deleted: false }, { render: false }));
  Sheets.close('shDocQuick'); scheduleRender();
  toast(`Added ${picks.length}. Tap one to attach its file.`);
});

