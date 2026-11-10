/* ==========================================================================
   PRIVATE NOTES (v2.2) — notes of type 'snote', sealed like Money entries.
   They reuse the normal note editor. Pictures in them are encrypted.
   ======================================================================== */
const secretImg = new Map();                    // blob id -> object/data URL, memory only
function newSecretNote() {
  if (!Fin.key) { toast('Enter your private code first.'); return; }
  const n = put({ id: uid('sn'), type: 'snote', title: '', text: '', color: NOTE_COLORS[0], pinned: false, folder: '', docRefs: [], imgs: [], deleted: false });
  openNoteEditor(n.id);
}
function renderSnotes() {
  const notes = all('snote').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  const area = $('snArea');
  area.innerHTML = `<button class="btn ghost small" id="snNew" style="margin:0 0 12px">＋ New private note</button>`
    + (notes.length ? `<div class="notes-grid">${notes.map(n => noteCard(n, new Set())).join('')}</div>`
      : '<div class="empty"><b>No private notes</b>Encrypted with your private code. Tap + to write one.</div>');
  $('snNew').addEventListener('click', newSecretNote);
  $$('[data-note]', area).forEach(b => b.addEventListener('click', () => prefs.noteEdit ? openNoteEditor(b.dataset.note) : previewNote(b.dataset.note)));
}
function compressSmall(file, limit) {
  return loadImage(file).then(({ img }) => {
    for (const dim of [1000, 820, 650, 500]) {
      const cv = drawTo(img, dim);
      for (let q = 0.72; q >= 0.3; q -= 0.08) { const out = cv.toDataURL('image/jpeg', q); if (out.length <= limit) return out; }
    }
    throw new Error('too large');
  });
}
async function storeSecretImages(files, already) {
  if (!Fin.key) { toast('Enter your private code first.'); return []; }
  const ids = []; let failed = 0;
  const useDrive = driveOn();
  if (useDrive && files.length) toast('Encrypting and uploading…', null, null, 20000);
  for (const f of files) {
    if (already + ids.length >= IMG_PER_NOTE) { toast(`Up to ${IMG_PER_NOTE} pictures per note.`); break; }
    try {
      if (useDrive) {
        const dataUrl = await prepForDrive(f);
        const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
        const bytes = unb64(dataUrl.slice(dataUrl.indexOf(',') + 1));
        const up = await putDocBytes(bytes, todayISO() + '-private-picture', mime, true);
        ids.push(put({ id: uid('img'), type: 'blob', drive: true, fileId: up.fileId, keyId: up.keyId, mime, name: 'picture', bytes: bytes.length, deleted: false }, { render: false }).id);
      } else {
        const data = await compressSmall(f, 34000);            // stays under the Sheet's cell limit after encryption
        const raw = b64(crypto.getRandomValues(new Uint8Array(32)));
        const keyId = put({ id: uid('fk'), type: 'filekey', raw, deleted: false }, { render: false }).id;
        const encData = await aesEnc(await importFileKey(raw), data);
        ids.push(put({ id: uid('img'), type: 'blob', keyId, encData, deleted: false }, { render: false }).id);
      }
    } catch (e) { RLOG.warn('private picture failed', e.message); failed++; }
  }
  if (failed) toast(`${failed} picture(s) couldn't be stored.`);
  else if (ids.length) toast(`${ids.length} picture${ids.length > 1 ? 's' : ''} added, encrypted.`);
  return ids;
}
async function secretImgSrc(b) {
  if (secretImg.has(b.id)) return secretImg.get(b.id);
  if (!Fin.key) throw lockedErr();
  const key = await fileKeyOf(b);
  let src;
  if (b.encData) src = await aesDec(key, b.encData);
  else {
    const bytes = await aesDecBytes(key, await rawDocBytes(b));
    src = URL.createObjectURL(new Blob([bytes], { type: b.mime || 'image/jpeg' }));
  }
  secretImg.set(b.id, src);
  return src;
}
function forgetSecretImgs() {
  for (const [, v] of secretImg) if (String(v).startsWith('blob:')) URL.revokeObjectURL(v);
  secretImg.clear();
}
/* Called just before the private section locks: save what is open, then close it. */
function beforeFinanceLock() {
  try {
    const n = records[editNoteId];
    if (Sheets.isOpen('shNote') && n && n.type === 'snote') { clearTimeout(neTimer); neSave(); Sheets.close('shNote', true); }
    const v = records[viewNoteId];
    if (v && v.type === 'snote') ['shNoteView', 'shNoteMore', 'shVersions'].forEach(id => Sheets.close(id, true));
    if (Sheets.isOpen('shPlan') && typeof Plan.save === 'function') { try { Plan.save(true); } catch (e) { RLOG.warn('plan save on lock', e.message); } }
  } catch (e) { RLOG.warn('beforeFinanceLock', e.message); }
}

