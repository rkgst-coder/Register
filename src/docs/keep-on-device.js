/* ==========================================================================
   v2.24 — "Keep on this device": download document files once, open instantly
   A file opened once is already kept; this fetches the rest in one go.
   Locked files are kept still locked (encrypted) — they open after unlocking.
   ======================================================================== */
const Off = { keys: new Set() };
async function offRefresh() { try { Off.keys = new Set(await DB.imgKeys()); } catch (e) { RLOG.warn('offline list', e.message); } }
const fileOnDevice = f => !!(f && f.fileId && Off.keys.has(f.fileId));
function docOffline(d) { if (window.GHOST) return false; const fs = docFilesOf(d.id); return fs.length > 0 && fs.every(fileOnDevice); }
const offFiles = () => all('docfile').filter(f => f.fileId && records[f.docId] && !records[f.docId].deleted);
function offLabel() { const L = offFiles(), n = L.filter(fileOnDevice).length; return L.length ? `${n} of ${L.length}` : '›'; }
async function keepOffline(docs, label) {
  if (window.GHOST) { ghostCrash(true); return; }
  docs = (docs || []).filter(Boolean);
  const fs = docs.flatMap(d => docFilesOf(d.id)).filter(f => f.fileId && !fileOnDevice(f));
  if (!fs.length) { toast(docs.some(d => docFilesOf(d.id).length) ? 'Already on this device ✓' : 'No files there to keep.'); return; }
  if (!Sync.on()) { toast('Connect sync first — the files come from your Drive folder.'); return; }
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  const total = fs.reduce((t, f) => t + (+f.bytes || 0), 0);
  jobOpen(`Keeping ${label || 'documents'} on this device`);
  let i = 0, ok = 0; const bad = [];
  for (const f of fs) {
    if (Job.stop) break;
    const head = `File ${i + 1} of ${fs.length}: ${f.name} (${fmtBytes(+f.bytes || 0)})`;
    jobStep(i, fs.length, head);
    try { await rawDocBytes(f, (a, t) => jobStep(i + (t ? a / t : 0), fs.length, `${head} · ${Math.round(a / (t || 1) * 100)}%`)); Off.keys.add(f.fileId); ok++; }
    catch (e) { bad.push(`${f.name}: ${e.message}`); }
    i++;
  }
  jobDone(`${Job.stop ? 'Stopped. ' : ''}${ok} file${ok === 1 ? '' : 's'} (${fmtBytes(total)} in all) now open without waiting.${bad.length ? ' Not kept: ' + bad.slice(0, 5).join('; ') + (bad.length > 5 ? ` … and ${bad.length - 5} more` : '') : ''}`, !!bad.length);
  scheduleRender();
}
async function offSize() {
  let n = 0, bytes = 0;
  for (const f of offFiles()) { if (!fileOnDevice(f)) continue; n++;
    try { const v = await DB.imgGet(f.fileId); bytes += typeof v === 'string' ? Math.round((v.length - v.indexOf(',')) * 0.75) : v instanceof Blob ? v.size : (+f.bytes || 0); } catch (e) {} }
  return { n, bytes };
}
async function dropOffline() {
  const L = offFiles().filter(fileOnDevice);
  if (!L.length) { toast('Nothing kept on this device.'); return; }
  if (!confirm(`Remove the ${L.length} downloaded file${L.length > 1 ? 's' : ''} from this device?\n\nThey stay safe in your Drive folder and download again when you open them.`)) return;
  for (const f of L) { try { await DB.imgDel(f.fileId); } catch (e) {} Off.keys.delete(f.fileId); const v = docPlain.get(f.id); if (v) { URL.revokeObjectURL(v.url); docPlain.delete(f.id); } }
  toast('Removed from this device. Your files are still in Drive.'); scheduleRender(); if (Sheets.isOpen('shPlan')) openOffline();
}
async function openOffline() {
  await offRefresh();
  const L = offFiles(), have = L.filter(fileOnDevice), miss = L.filter(f => !fileOnDevice(f)), need = miss.reduce((t, f) => t + (+f.bytes || 0), 0);
  let est = null; try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) {}
  planSheet('Files on this device', `<p class="hint" style="margin:0 4px 10px">A document opens instantly when its file is kept here; otherwise it is fetched from your Drive folder first. Locked files stay locked here too.</p>
    <div class="group"><div class="set-row"><span>Kept here</span><span class="v">${have.length} of ${L.length} files</span></div>
    <div class="set-row"><span>Space used</span><span class="v" id="offSz">counting…</span></div>
    ${miss.length ? `<div class="set-row"><span>Still to download</span><span class="v">${miss.length} · ${fmtBytes(need)}</span></div>` : ''}
    ${est && est.quota ? `<div class="set-row"><span>Free for the app</span><span class="v">${fmtBytes(Math.max(0, est.quota - (est.usage || 0)))}</span></div>` : ''}</div>
    <div class="btn-row" style="flex-wrap:wrap">${miss.length ? '<button class="btn brass" type="button" id="offAll">📱 Keep all on this device</button>' : '<span class="hint">✓ Every file is on this device.</span>'}${have.length ? '<button class="btn ghost" type="button" id="offDrop" style="color:var(--seal)">Remove downloaded copies</button>' : ''}</div>
    <p class="hint">Tip: for one person or category, open it in Documents and tap “📱 Keep on this device”, or press and hold folders / documents and choose ⤓ Keep. Big downloads are best on Wi-Fi.</p>`, () => true, 'Done');
  if ($('offAll')) $('offAll').addEventListener('click', () => { Sheets.close('shPlan', true); keepOffline(all('doc'), 'all documents'); });
  if ($('offDrop')) $('offDrop').addEventListener('click', dropOffline);
  offSize().then(r => { if ($('offSz')) $('offSz').textContent = fmtBytes(r.bytes); });
}
setTimeout(() => offRefresh().then(() => scheduleRender()), 1200);

