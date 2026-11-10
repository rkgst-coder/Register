/* ==========================================================================
   v2.28 — tables in notes: add / remove rows and columns
   While the caret is in a table, a bar under the toolbar offers the changes
   (▦ also opens them as a menu). Each change replaces the table in one step,
   so ↶ Undo puts it back. Tab / Shift+Tab move between cells.
   ======================================================================== */
const TBL = { cell: null };
function tblCell(useLast) {
  const r = $('neRich'), s = getSelection(); if (!r) return null;
  let n = s.rangeCount ? s.anchorNode : null;
  if (n && r.contains(n)) { n = n.nodeType === 1 ? n : n.parentNode; const td = n.closest && n.closest('td,th'); if (td && r.contains(td)) return td; if (!useLast) return null; }
  return useLast && TBL.cell && TBL.cell.isConnected && r.contains(TBL.cell) ? TBL.cell : null;
}
function tblBarSync() {
  const bar = $('neTblBar'), r = $('neRich'); if (!bar || !r) return;
  if (document.activeElement !== r) return;                              // tapping the bar itself must not hide it
  const td = tblCell(false); TBL.cell = td || null;
  bar.classList.toggle('hidden', !td);
  if (td) tblBarPlace(td.closest('table'));
}
/* v2.30: the bar floats just above the table (below it when there is no room) — the note never moves */
function tblBarPlace(table) {
  const bar = $('neTblBar'), box = bar.offsetParent; if (!box || !table) return;
  const br = box.getBoundingClientRect(), tr = table.getBoundingClientRect(), rr = $('neRich').getBoundingClientRect(), h = bar.offsetHeight || 40;
  let top = tr.top - br.top + box.scrollTop - h - 6;
  if (tr.top - h - 6 < Math.max(rr.top, br.top)) top = tr.bottom - br.top + box.scrollTop + 6;
  bar.style.top = Math.max(0, top) + 'px';
  bar.style.left = Math.max(4, rr.right - br.left - bar.offsetWidth) + 'px';   // small, at the right edge, where a line of writing seldom reaches   // small, at the table's right corner
}
function tblCaret(td) { const s = getSelection(), rg = document.createRange(); rg.selectNodeContents(td); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); TBL.cell = td; }
function tblOp(op) {
  const r = $('neRich'), td = tblCell(true);
  if (!r || !td) { toast('Tap inside a table first.'); return; }
  const table = td.closest('table'), rows0 = [...table.querySelectorAll('tr')], tr = td.parentNode;
  let ri = rows0.indexOf(tr), ci = [...tr.children].indexOf(td);
  const sel = getSelection(), rg = document.createRange();
  r.focus({ preventScroll: true });
  if (op === 'tblX') {
    rg.selectNode(table); sel.removeAllRanges(); sel.addRange(rg); document.execCommand('delete');
    TBL.cell = null; $('neTblBar').classList.add('hidden'); richSync(); toast('Table deleted — ↶ brings it back.'); return;
  }
  const t = table.cloneNode(true), rows = [...t.querySelectorAll('tr')], w = Math.max(...rows.map(x => x.children.length));
  const blank = () => { const c = document.createElement('td'); c.innerHTML = '<br>'; return c; };
  if (op === 'rowB' || op === 'rowA') {
    const n = document.createElement('tr'); for (let i = 0; i < w; i++) n.appendChild(blank());
    const at = rows[ri]; at.parentNode.insertBefore(n, op === 'rowB' ? at.nextSibling : at); if (op === 'rowB') ri++;
  } else if (op === 'colR' || op === 'colL') {
    rows.forEach(x => { while (x.children.length < w) x.appendChild(blank()); const ref = x.children[ci]; x.insertBefore(blank(), op === 'colR' ? ref.nextSibling : ref); });
    if (op === 'colR') ci++;
  } else if (op === 'rowX') {
    if (rows.length <= 1) { tblOp('tblX'); return; }
    rows[ri].remove(); ri = Math.min(ri, rows.length - 2);
  } else if (op === 'colX') {
    if (w <= 1) { tblOp('tblX'); return; }
    rows.forEach(x => { if (x.children[ci]) x.children[ci].remove(); }); ci = Math.min(ci, w - 2);
  }
  t.setAttribute('data-tbnew', '1');
  rg.selectNode(table); sel.removeAllRanges(); sel.addRange(rg);
  document.execCommand('insertHTML', false, t.outerHTML);              // one undoable step
  const nt = r.querySelector('table[data-tbnew]');
  if (nt) { nt.removeAttribute('data-tbnew'); const row = nt.querySelectorAll('tr')[ri]; const cell = row && (row.children[ci] || row.lastElementChild); if (cell) tblCaret(cell); }
  richSync(); tblBarSync();
}
function tblTab(back) {
  const td = tblCell(false); if (!td) return false;
  const cells = [...td.closest('table').querySelectorAll('td,th')], i = cells.indexOf(td);
  if (back) { if (i > 0) tblCaret(cells[i - 1]); return true; }
  if (i < cells.length - 1) { tblCaret(cells[i + 1]); return true; }
  TBL.cell = td; const tr = td.parentNode; tblCaret(tr.firstElementChild); tblOp('rowB'); return true;
}
const TBL_OPS = [['rowA', 'Add row above'], ['rowB', 'Add row below'], ['colL', 'Add column left'], ['colR', 'Add column right'], ['rowX', 'Delete row'], ['colX', 'Delete column'], ['tblX', 'Delete table']];
function tblMenu(anchor) { popMenu(anchor, TBL_OPS.map(([k, l]) => ({ l, fn: () => tblOp(k), cls: /X$/.test(k) ? 'danger' : '' }))); }
if ($('neTblBar')) {
  $$('#neTblBar [data-tb]').forEach(b => {
    b.addEventListener('pointerdown', e => e.preventDefault());           // keep the caret (and the iPhone keyboard) in the table
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => b.dataset.tb === 'more' ? tblMenu(b) : tblOp(b.dataset.tb));
  });
  document.addEventListener('selectionchange', tblBarSync);
  $('neRich').addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== $('neRich')) $('neTblBar').classList.add('hidden'); }, 200));
  { const prev = Sheets.onOpen.shNote; Sheets.onOpen.shNote = () => { if (prev) prev(); TBL.cell = null; $('neTblBar').classList.add('hidden'); }; }
}

