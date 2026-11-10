/* ==========================================================================
   v2.17.1
   ======================================================================== */
/* ---------- G4: a deleted document's expiry date goes to Recently deleted with it ---------- */
function softDelete(id, opt) {
  const r = records[id]; softDeleteBase(id, opt);
  if (r && r.type === 'doc' && !window.GHOST) all('date').filter(x => x.docRef === id).forEach(x => { x.viaDoc = id; softDeleteBase(x.id, { render: false }); });
}
function restore(id) {
  const r = records[id]; restoreBase(id);
  if (r && r.type === 'doc') Object.values(records).filter(x => x.type === 'date' && x.deleted && x.viaDoc === id).forEach(x => { delete x.viaDoc; restoreBase(x.id); });
}
/* ---------- G1–G3: files in Drive that nothing uses any more go to Drive's Trash ---------- */
const BLOB_OWNERS = ['note', 'snote', 'inbox'];
function blobUsedElsewhere(b, exceptId) {
  return Object.values(records).some(r => r.id !== exceptId && BLOB_OWNERS.includes(r.type) && !r.deleted && (r.imgs || []).includes(b));
}
function trashBlob(b, why) {
  const r = records[b]; if (!r || r.type !== 'blob') return;
  if (!r.deleted) softDeleteBase(b, { render: false });
  if (r.drive && r.fileId && !r.gone) { driveDelete(r.fileId); r.gone = 1; put(r, { render: false }); RLOG.info('drive file to trash', why || '', b); }
}
/* Inbox 🗑: after the 7-second Undo, its photos and PDFs go to Drive's Trash (restoring the item brings them back) */
function trashInboxFiles(id) {
  const i = records[id]; if (!i || !i.deleted || window.GHOST) return;
  (i.imgs || []).forEach(b => { if (!blobUsedElsewhere(b, id)) trashBlob(b, 'inbox deleted'); });
}
function restoreInboxFiles(i) {
  (i.imgs || []).forEach(b => { const r = records[b]; if (!r || !r.deleted) return; delete r.gone; restoreBase(b); if (r.drive && r.fileId && Sync.on()) Sync.call('driveRestore', { fileId: r.fileId }).catch(() => {}); });
}
/* sweep: runs once per session after a sync, only when every note (private ones too) can be read */
let blobSweepDone = false;
function sweepOrphans() {
  if (window.GHOST || blobSweepDone) return;
  if (Sync.on() && !window.__synced) return;
  const cutoff = nowMs() - 30 * 86400000;
  // expiry dates of documents that are deleted or gone (G4, for items from before v2.17.1)
  all('date').forEach(x => { if (!x.docRef) return; const d = records[x.docRef]; if (!d || d.deleted) { x.viaDoc = x.docRef; softDeleteBase(x.id, { render: false }); } });
  if (finConfigured() && (!Fin.key || (Fin.lockedOut || []).length)) return;   // private notes cannot be read yet: photos wait
  blobSweepDone = true;
  const used = new Set(Object.values(records).filter(r => BLOB_OWNERS.includes(r.type) && (!r.deleted || (r.deletedAt || 0) > cutoff)).flatMap(r => r.imgs || []));
  let n = 0;
  Object.values(records).forEach(b => {
    if (b.type !== 'blob' || n >= 200) return;
    if (!b.deleted && !used.has(b.id) && (b.createdAt || 0) < nowMs() - 2 * 86400000) { trashBlob(b.id, 'not used'); n++; }
    else if (b.deleted && b.drive && b.fileId && !b.gone && !used.has(b.id)) { trashBlob(b.id, 'removed earlier'); n++; }
  });
  if (n) { RLOG.info('unused Drive files moved to Trash', n); scheduleRender(); }
}
function binRestore(id) {
  const r = records[id]; binRestoreV2171(id);
  if (r && r.type === 'inbox' && !r.deleted) restoreInboxFiles(r);
}
/* ---------- P5: one record per archive (two devices archiving at once no longer lose one) ---------- */
const archIndex = () => {
  const L = ((records[ARCH_ID] && !records[ARCH_ID].deleted && records[ARCH_ID].list) || []).map(a => ({ ...a }));
  all('archent').forEach(r => { if (!L.some(a => a.fileId === r.fileId)) L.push({ fy: r.fy, fileId: r.fileId, n: r.n, enc: r.enc, at: r.at, salt: r.salt, iters: r.iters, _rid: r.id }); });
  return L.sort((a, b) => (a.at || 0) - (b.at || 0));
};
function archForget(a) {
  if (a._rid) { const r = records[a._rid]; if (r) { r.deleted = true; r.deletedAt = 1; put(r, { render: false }); } return; }
  const idx = records[ARCH_ID]; if (idx) put({ ...idx, list: (idx.list || []).filter(x => x.fileId !== a.fileId) }, { render: false });
}
setTimeout(() => { try { sweepOrphans(); } catch (e) { RLOG.warn('sweep', e.message); } }, 12000);


