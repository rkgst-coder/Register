/* ==========================================================================
   v2.27 — TABLES IN PRIVATE NOTES (PNote): card numbers, expiry dates, document numbers…
   Kept inside the note, so encrypted with the private code like the rest of it.
   Columns marked 🔒 show dots until tapped and never leave the app (not shared, not printed, not searched).
   ======================================================================== */
const TB = { note: null, id: null, shown: new Set(), t: null };
const tbDateCol = l => /valid|expir|renew|due|till|upto|up to|maturity/i.test(l || '');
function tbRowName(t, r) { const i = t.cols.findIndex(c => !c.s && !tbDateCol(c.l)); return String((i >= 0 ? r.c[i] : '') || t.title || 'Entry').trim(); }
/* expiry / renewal dates from tables → Dates (name and date only) */
function tbDateWants(n) {
  const W = {};
  if (!n || n.deleted || n.type !== 'snote') return W;
  (n.tables || []).forEach(t => (t.rows || []).forEach(r => {
    const i = t.cols.findIndex((c, k) => !c.s && tbDateCol(c.l) && parseExpiry(String(r.c[k] || '')));
    if (i < 0) return;
    const when = parseExpiry(String(r.c[i])), lbl = t.cols[i].l;
    W['td-' + n.id + '-' + r.id] = { label: `${tbRowName(t, r)} — ${/renew/i.test(lbl) ? 'renewal' : /card/i.test(t.title + ' ' + t.cols.map(c => c.l).join(' ')) ? 'card expires' : 'expires'}`, when, repeat: 'once', cat: t.dateCat || 'other', srcRef: n.id, sysSrc: 'snote' };
  }));
  return W;
}
function tbSyncDates(n) {
  if (!Fin.key) return;
  const W = tbDateWants(n);
  Object.entries(W).forEach(([id, w]) => sysDate(id, w, false));
  all('date').forEach(d => { if (d.sysSrc === 'snote' && d.srcRef === n.id && !W[d.id]) sysDate(d.id, null); });
}
function tbHtml(n) {
  return cardLine(n) + (n.tables || []).map(t => `<div class="tb-wrap"><div class="tb-h"><b>▦ ${esc(t.title || 'Table')}</b><button class="btn ghost small" data-tbe="${t.id}">✎ Edit</button></div>
    <div class="tw"><table class="pt tb"><thead><tr>${t.cols.map(c => `<th>${c.s ? '🔒 ' : ''}${esc(c.l || '')}</th>`).join('')}</tr></thead><tbody>${(t.rows || []).map(r => `<tr>${t.cols.map((c, i) => {
      const v = String(r.c[i] || ''), k = t.id + ':' + r.id + ':' + i, show = !c.s || TB.shown.has(k);
      const pv = isCk(v) ? Card.plain.get(v) : v;                            // v2.29: 🔒 values sealed with the card code
      return `<td class="tb-c${c.s ? ' tb-sec' : ''}" data-tbc="${k}" title="${c.s ? 'Tap to show · double-tap to copy' : 'Tap to copy'}">${v ? (show && pv != null ? esc(pv) : '••••••') : '<span class="muted">—</span>'}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${t.cols.length}" class="muted">No rows yet.</td></tr>`}</tbody></table></div></div>`).join('');
}
function tbWire(box, n) {
  $$('[data-tbe]', box).forEach(b => b.addEventListener('click', () => openTable(n.id, b.dataset.tbe)));
  $$('[data-ckm]', box).forEach(b => b.addEventListener('click', () => cardMenu(b, n.id)));
  $$('[data-tbc]', box).forEach(td => {
    const [tid, rid, i] = td.dataset.tbc.split(':'), t = (records[n.id].tables || []).find(x => x.id === tid), r = t && t.rows.find(x => x.id === rid), c = t && t.cols[+i];
    if (!t || !r || !c) return;
    const v0 = String(r.c[+i] || ''); if (!v0) return;
    const plainOf = () => isCk(v0) ? Card.plain.get(v0) : v0;
    const copy = async () => { const v = plainOf(); if (v == null) return; try { await navigator.clipboard.writeText(v); if (c.s) { clipArm(); toast(`Copied ${c.l || 'it'} — wiped from the clipboard the next time you tap in Register after 30 s.`); } else toast(`Copied ${c.l || 'it'}.`); } catch (e) { toast('Could not copy here.'); } };
    if (!c.s) { td.addEventListener('click', copy); return; }
    let last = 0;
    td.addEventListener('click', () => { const now = Date.now(); if (now - last < 400 && TB.shown.has(td.dataset.tbc)) { copy(); return; } last = now;
      const k = td.dataset.tbc;
      if (!TB.shown.has(k) && !cardOpen()) { cardAsk(() => { TB.shown.add(k); previewNote(n.id); }); return; }   // v2.29: Face ID or the card code first
      if (!TB.shown.has(k) && isCk(v0) && !Card.plain.has(v0)) { cardPlainAll().then(() => { if (!Card.plain.has(v0)) { toast('This value was locked with a different card code.'); return; } TB.shown.add(k); previewNote(n.id); }); return; }
      TB.shown.has(k) ? TB.shown.delete(k) : TB.shown.add(k);
      clearTimeout(TB.t); TB.t = setTimeout(() => { TB.shown.clear(); if (Sheets.isOpen('shNoteView') && viewNoteId === n.id) previewNote(n.id); }, 30000);
      previewNote(n.id); });
  });
}
function openTable(noteId, tableId, tried) {
  const n = records[noteId]; if (!n || n.type !== 'snote') return;
  if (!finUnlocked()) { toast('Open Money first.'); return; }
  const t00 = tableId && (n.tables || []).find(x => x.id === tableId);
  if (t00 && tbHasSecret(t00) && !cardOpen()) { cardAsk(() => openTable(noteId, tableId)); return; }       // v2.29
  if (!tried && Card.key && t00 && (t00.rows || []).some(r => r.c.some(v => isCk(v) && !Card.plain.has(v)))) { cardPlainAll().then(() => openTable(noteId, tableId, true)); return; }
  TB.note = noteId; TB.id = tableId || null;
  const t0 = tableId && (n.tables || []).find(x => x.id === tableId);
  const t = t0 ? JSON.parse(JSON.stringify(t0)) : { id: uid('tb'), title: '', cols: [{ l: 'Name', s: false }, { l: 'Number', s: true }, { l: 'Valid till', s: false }], rows: [] };
  t.rows.forEach(r => { r.c = r.c.map(v => isCk(v) ? (Card.plain.get(v) ?? v) : v); });                 // v2.29: plain while editing
  $('tbTitleH').textContent = t0 ? 'Edit table' : 'New table';
  const colRow = (c, i) => `<div class="tb-col" data-ci="${i}"><input class="tbL" value="${esc(c.l || '')}" placeholder="Column name" maxlength="40"><button type="button" class="tb-lock${c.s ? ' on' : ''}" aria-label="Hidden column">${c.s ? '🔒' : '🔓'}</button><button type="button" class="icon-btn tbCx" aria-label="Remove column">✕</button></div>`;
  const rowBox = r => `<div class="tb-row" data-ri="${esc(r.id)}">${t.cols.map((c, i) => `<input class="tbV${c.s ? ' vt-sec' : ''}" data-col="${i}" value="${esc(String(r.c[i] || ''))}" placeholder="${esc(c.l || 'Value')}" maxlength="300" autocomplete="off">`).join('')}<button type="button" class="icon-btn tbRx" aria-label="Remove row">✕</button></div>`;
  const read = () => {   // what is on screen now
    const cols = $$('.tb-col', $('tbBody')).map(el => ({ l: el.querySelector('.tbL').value.trim().slice(0, 40), s: el.querySelector('.tb-lock').classList.contains('on') }));
    const rows = $$('.tb-row', $('tbBody')).map(el => ({ id: el.dataset.ri, c: $$('.tbV', el).map(x => x.value.trim().slice(0, 300)) }));
    return { ...t, title: $('tbName').value.trim().slice(0, 60), cols, rows };
  };
  const draw = () => {
    $('tbBody').innerHTML = `<div class="field"><label>Table name</label><input id="tbName" value="${esc(t.title || '')}" placeholder="e.g. Cards, Bank accounts, Policies" maxlength="60"></div>
      <div class="group-title">Columns <span class="muted" style="font-weight:400;text-transform:none">· 🔒 = shown as dots until tapped, never shared or printed</span></div>
      <div id="tbCols">${t.cols.map(colRow).join('')}</div><button class="linkbtn" id="tbAddC">＋ Column</button>
      <div class="group-title">Rows</div><div id="tbRows">${t.rows.map(rowBox).join('') || ''}</div><button class="btn ghost small" id="tbAddR">＋ Row</button>
      <p class="hint">A column named like “Valid till”, “Expiry” or “Renewal” (08/29, 31/08/2029…) puts that date in Dates — only the row's name and the date.</p>
      ${t0 ? '<div class="btn-row"><button class="btn ghost" type="button" id="tbDel" style="color:var(--seal)">🗑 Delete this table</button></div>' : ''}<div class="msg" id="tbMsg"></div>`;
    $$('.tb-lock', $('tbBody')).forEach(b => b.onclick = () => { Object.assign(t, read()); const i = +b.closest('.tb-col').dataset.ci; t.cols[i].s = !t.cols[i].s; draw(); });
    $$('.tbCx', $('tbBody')).forEach(b => b.onclick = () => { Object.assign(t, read()); const i = +b.closest('.tb-col').dataset.ci; if (t.cols.length < 2) return; t.cols.splice(i, 1); t.rows.forEach(r => r.c.splice(i, 1)); draw(); });
    $$('.tbRx', $('tbBody')).forEach(b => b.onclick = () => { Object.assign(t, read()); t.rows = t.rows.filter(r => r.id !== b.closest('.tb-row').dataset.ri); draw(); });
    $('tbAddC').onclick = () => { Object.assign(t, read()); if (t.cols.length >= 12) return; t.cols.push({ l: '', s: false }); t.rows.forEach(r => r.c.push('')); draw(); const L = $$('.tbL', $('tbBody')); L[L.length - 1].focus(); };
    $('tbAddR').onclick = () => { Object.assign(t, read()); if (t.rows.length >= 200) return; t.rows.push({ id: uid('r'), c: t.cols.map(() => '') }); draw(); const R = $$('.tb-row', $('tbBody')); const f = R[R.length - 1].querySelector('.tbV'); if (f) f.focus(); };
    $$('.tbL', $('tbBody')).forEach(x => x.addEventListener('change', () => { Object.assign(t, read()); draw(); }));
    if ($('tbDel')) $('tbDel').onclick = () => { if (!confirm('Delete this table?')) return; const nn = records[noteId], keep = JSON.parse(JSON.stringify(nn.tables || []));
      nn.tables = (nn.tables || []).filter(x => x.id !== t.id); put(nn, { render: false }); tbSyncDates(nn); Sheets.close('shTbl', true); if (Sheets.isOpen('shNoteView')) previewNote(noteId);
      toast('Table deleted.', 'Undo', () => { const m = records[noteId]; m.tables = keep; put(m, { render: false }); tbSyncDates(m); if (Sheets.isOpen('shNoteView')) previewNote(noteId); }, 7000); };
  };
  TB.read = read;
  draw();
  if (!Sheets.isOpen('shTbl')) Sheets.open('shTbl');
  if (!t0) setTimeout(() => $('tbName') && $('tbName').focus(), 300);
}
$('tbSave').addEventListener('click', async () => {
  const n = records[TB.note]; if (!n || !TB.read) return;
  if (!Fin.key) { toast('The private section locked — open it again to save.'); return; }
  const t = TB.read();
  if (ckRec() && tbHasSecret(t) && !cardOpen()) { toast('The card code locked — tap Save again after unlocking.'); cardAsk(() => {}); return; }
  if (ckRec() && Card.key) { try { await cardSealTable(t); } catch (e) { toast(e.message); return; } }   // v2.29: 🔒 values sealed with the card code
  if (!t.cols.some(c => c.l)) { const m = $('tbMsg'); m.className = 'msg err'; m.textContent = 'Name at least one column.'; return; }
  t.rows = t.rows.filter(r => r.c.some(v => v));
  n.tables = (n.tables || []).filter(x => x.id !== t.id).concat([t]).sort((a, b) => (n.tables || []).findIndex(x => x.id === a.id) - (n.tables || []).findIndex(x => x.id === b.id));
  put(n, { render: false }); tbSyncDates(n);
  Sheets.close('shTbl', true);
  if (Sheets.isOpen('shNoteView')) previewNote(n.id);
  toast('Table saved (encrypted).');
});
Sheets.onClose.shTbl = () => { $('tbBody').innerHTML = ''; TB.read = null; };
/* move "Card & account details" (Docs) into a private note with one table per kind — once, and again if an older device adds more */
function vaultToNote() {
  if (!finUnlocked() || window.GHOST) return 0;
  const V = all('vault').filter(v => !v.deleted); if (!V.length) return 0;
  let n = all('snote').find(x => x.fromVault);
  if (!n) n = put({ id: uid('sn'), type: 'snote', title: 'Cards & accounts', text: 'Moved here from “Card & account details” in Documents. Tap a 🔒 value to show it; tap again quickly to copy.', color: NOTE_COLORS[0], pinned: true, folder: '', docRefs: [], imgs: [], tables: [], fromVault: 1, deleted: false }, { render: false });
  n.tables = n.tables || [];
  VAULT_KINDS.forEach(k => {
    const es = V.filter(v => vKind(v.kind)[0] === k[0]); if (!es.length) return;
    let t = n.tables.find(x => x.vkind === k[0]);
    if (!t) { t = { id: uid('tb'), vkind: k[0], dateCat: VAULT_DATE_CAT[k[0]] || 'other', title: k[2], cols: [{ l: 'Name', s: false }, { l: 'Belongs to', s: false }], rows: [] }; n.tables.push(t); }
    es.forEach(v => (v.fields || []).forEach(f => { const l = (f.l || 'Field').trim(); const c = t.cols.find(x => x.l.toLowerCase() === l.toLowerCase()); if (!c) { t.cols.push({ l, s: !!f.s }); t.rows.forEach(r => r.c.push('')); } else if (f.s) c.s = true; }));
    if (es.some(v => v.notes) && !t.cols.some(c => c.l === 'Notes')) { t.cols.push({ l: 'Notes', s: false }); t.rows.forEach(r => r.c.push('')); }
    es.filter(v => !t.rows.some(r => r.id === 'v' + v.id)).forEach(v => { const c = t.cols.map(col => col.l === 'Name' ? v.title || '' : col.l === 'Belongs to' ? v.who || '' : col.l === 'Notes' ? v.notes || '' : ((v.fields || []).find(f => (f.l || '').trim().toLowerCase() === col.l.toLowerCase()) || {}).v || '');
      t.rows.push({ id: 'v' + v.id, c }); });
  });
  put(n, { render: false });
  V.forEach(v => softDelete(v.id, { render: false }));                     // kept in Recently deleted, so nothing is lost
  tbSyncDates(n);
  return V.length;
}
