/* ==========================================================================
   v2.19 — a person's documents as one .zip (files + index.csv)
   Stored, not compressed: photos and PDFs are already compressed.
   ======================================================================== */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  if (files.length > 65000) throw new Error('too many files for one zip');
  const parts = [], cen = []; let off = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF, dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  for (const f of files) {
    const name = te.encode(f.name), data = f.data, crc = crc32(data);
    if (off + 30 + name.length + data.length > 0xFFFFFFFF) throw new Error('the zip would be larger than 4 GB');
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
    c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = cen.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true); e.setUint16(20, 0, true);
  return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
const zipSafe = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || 'untitled';
async function exportPersonZip(p) {
  if (window.GHOST) { ghostCrash(true); return; }
  const docs = all('doc').filter(d => docOwners(d).includes(p)).sort((a, b) => docGroup(a).localeCompare(docGroup(b)) || a.title.localeCompare(b.title));
  if (!docs.length) { toast(`No documents for ${p}.`); return; }
  const fs = docs.flatMap(d => docFilesOf(d.id).map(f => ({ f, d })));
  const lockedSkip = fs.filter(x => x.f.locked && !Fin.key).length;
  jobOpen(`${p}'s documents`);
  const files = [], names = new Set(), bad = [], root = zipSafe(p);
  const uniq = n => { let x = n, k = 2; const dot = n.lastIndexOf('.'), a = dot > 0 ? n.slice(0, dot) : n, b = dot > 0 ? n.slice(dot) : ''; while (names.has(x.toLowerCase())) x = `${a} (${k++})${b}`; names.add(x.toLowerCase()); return x; };
  let bytes = 0, i = 0;
  const todo = fs.filter(x => !(x.f.locked && !Fin.key));
  for (const { f, d } of todo) {
    if (Job.stop) { jobDone('Stopped. Nothing was saved.', true); return; }
    jobStep(i, todo.length, `File ${++i} of ${todo.length}: ${f.name}`);
    try {
      if (!driveOn() && !(await DB.imgGet(f.fileId).catch(() => null))) throw new Error('the Drive folder is not set up');
      const { blob } = await docFileBlob(f), data = new Uint8Array(await blob.arrayBuffer());
      bytes += data.length;
      if (bytes > 300 * 1048576) throw Object.assign(new Error('more than 300 MB — too big for the phone to zip at once'), { stopAll: true });
      files.push({ name: uniq(`${root}/${zipSafe(docGroup(d))}/${zipSafe(d.title)}/${zipSafe(f.fy ? 'FY ' + f.fy + ' - ' + f.name : f.name)}`), data });
    } catch (e) { if (e.stopAll) { jobDone('Stopped: ' + e.message + '. Use Share on fewer documents.', true); return; } bad.push(`${f.name}: ${e.code === 'LOCKED' ? 'locked' : e.message}`); }
  }
  const csvRows = [['Document', 'Belongs to', 'Type', 'Category', 'FY', 'Number', 'Expiry / due', 'Issuer', 'Notes', 'Files']].concat(docs.map(d => [d.title, docOwners(d).join(' & '), d.docType, docGroup(d), d.fy || '', d.number || (d.numEnc ? '•••• ' + (d.numTail || '') : ''), d.expiry || '', d.issuer || '', d.notes || '', docFilesOf(d.id).length]));
  files.push({ name: uniq(`${root}/index.csv`), data: te.encode('﻿' + csvRows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n') });
  if (Fin.key) { const r = records[emId(p)]; if (r && !r.deleted) files.push({ name: uniq(`${root}/Emergency sheet.txt`), data: te.encode(emText(p, r)) }); }
  let zip;
  try { zip = zipStore(files); } catch (e) { jobDone('Could not make the zip: ' + e.message, true); return; }
  const name = `${root} documents ${todayISO()}.zip`, file = new File([zip], name, { type: 'application/zip' });
  const nDoc = files.filter(x => !/\/(index\.csv|Emergency sheet\.txt)$/.test(x.name)).length;
  jobDone(`Ready: ${nDoc} file${nDoc === 1 ? '' : 's'} + index${files.some(x => /Emergency sheet/.test(x.name)) ? ' + emergency sheet' : ''}, ${fmtBytes(zip.size)}.${bad.length ? ` Not included: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '…' : ''}.` : ''}${lockedSkip ? ` ${lockedSkip} locked file${lockedSkip > 1 ? 's were' : ' was'} left out — open Money first to include them.` : ''}`, bad.length > 0);
  $('jbNote').innerHTML = `<div class="btn-row"><button class="btn brass" id="jbShare">Share or save the zip</button></div><p class="hint">The zip is not encrypted. Keep it somewhere safe.</p>`;
  $('jbShare').addEventListener('click', async () => {        // a fresh tap: iPhone only shares straight after one
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; RLOG.warn('zip share', e.message); }
    dl(zip, name);
  });
}

