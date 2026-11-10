/* ==========================================================================
   v2.27 — NEXT / PREVIOUS: swipe left or right (or ‹ ›) to go through the list an item was opened from.
   Docs, the Attention list, notes, private notes, tasks and Money entries. Moving on saves the current one first:
   documents, tasks and notes save themselves as they close; a Money entry is saved only if it is valid (else it stays).
   ======================================================================== */
const Nav = { kind: null, ids: [], id: null };
const NAV_SHEETS = { doc: ['shDoc', 'shDocView'], note: ['shNoteView', 'shNote'], task: ['shTask'], fin: ['shFin'] };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-doc],[data-attid],[data-note],[data-task],[data-fin],[data-udl]'); if (!t) return;
  if (e.target.closest('.sheet') && !t.closest('#docList,#docAttn')) return;            // buttons inside an open sheet are not lists
  let kind, ids, id;
  if (t.dataset.attid) { if (t.dataset.attk === 'inbox' || t.dataset.attk === 'datefill') return;
    const sec = t.closest('.attn-sec') || t.parentNode; kind = 'doc'; ids = $$('[data-attid]', sec).map(x => x.dataset.attid); id = t.dataset.attid; }
  else if (t.dataset.doc) { kind = 'doc'; ids = $$('[data-doc]', t.closest('#docList') || t.closest('section') || document).map(x => x.dataset.doc); id = t.dataset.doc; }
  else if (t.dataset.note) { kind = 'note'; ids = $$('[data-note]', t.closest('section') || document).map(x => x.dataset.note); id = t.dataset.note; }
  else if (t.dataset.task) { kind = 'task'; ids = $$('[data-task]', t.closest('section') || document).map(x => x.dataset.task); id = t.dataset.task; }
  else if (t.dataset.fin) { kind = 'fin'; ids = $$('[data-fin]', t.closest('[id]') || document).map(x => x.dataset.fin); id = t.dataset.fin; }
  else return;
  Nav.kind = kind; Nav.ids = [...new Set(ids)].filter(x => records[x]); Nav.id = id;
  setTimeout(navShow, 60);
}, true);
function navOpenSheet() { const top = Sheets.top(); return Nav.kind && top && NAV_SHEETS[Nav.kind].includes(top) ? top : null; }
function navCurrent() { const sh = navOpenSheet(); if (!sh) return null;
  return sh === 'shDoc' ? editDocId : sh === 'shDocView' ? viewDocId : sh === 'shNoteView' ? viewNoteId : sh === 'shNote' ? (typeof editNoteId !== 'undefined' ? editNoteId : Nav.id) : sh === 'shTask' ? editTaskId : sh === 'shFin' ? editFinId : null; }
function navShow() {
  $$('.navx').forEach(x => x.classList.add('hidden'));
  const sh = navOpenSheet(), cur = navCurrent(); if (!sh || !cur) return;
  const i = Nav.ids.indexOf(cur); if (i < 0 || Nav.ids.length < 2) return;
  const card = $(sh).querySelector('.sheet-card'); let bar = card.querySelector('.navx');
  if (!bar) { bar = document.createElement('div'); bar.className = 'navx'; bar.innerHTML = '<button type="button" class="navp" aria-label="Previous">‹</button><span></span><button type="button" class="navn" aria-label="Next">›</button>';
    const head = card.querySelector('.sheet-head'); head.after(bar);
    bar.querySelector('.navp').addEventListener('click', () => navGo(-1)); bar.querySelector('.navn').addEventListener('click', () => navGo(1)); }
  bar.classList.remove('hidden');
  bar.querySelector('span').textContent = `${i + 1} of ${Nav.ids.length}`;
  bar.querySelector('.navp').disabled = i === 0; bar.querySelector('.navn').disabled = i === Nav.ids.length - 1;
}
function navGo(d) {
  const sh = navOpenSheet(), cur = navCurrent(); if (!sh || !cur) return;
  Nav.ids = Nav.ids.filter(x => records[x] && !records[x].deleted);
  const i = Nav.ids.indexOf(cur), next = Nav.ids[i + d]; if (i < 0 || !next) { toast(d > 0 ? 'That was the last one.' : 'This is the first one.'); return; }
  const open = () => { Nav.id = next;
    if (sh === 'shDoc') openDoc(next); else if (sh === 'shDocView') { if (typeof showDoc === 'function' && !docFilesOf(next).length) { Sheets.close('shDocView', true); openDoc(next); } else openDocView(next); }
    else if (sh === 'shNoteView') previewNote(next); else if (sh === 'shNote') openNoteEditor(next);
    else if (sh === 'shTask') openTaskEditor(next); else if (sh === 'shFin') openFin(next);
    setTimeout(navShow, 80); };
  if (sh === 'shFin') { $('feSave').click(); if (Sheets.isOpen('shFin')) return; setTimeout(open, 60); return; }      // not valid: stay and show why
  if (sh === 'shDoc' || sh === 'shTask' || sh === 'shNote') { Sheets.close(sh); setTimeout(open, 120); return; }     // saves itself as it closes
  open();
}
/* swipe on the sheet: left = next, right = previous; not from the screen edges (iPhone back gesture), text boxes or sideways tables */
Object.values(NAV_SHEETS).flat().forEach(id => {
  const card = $(id) && $(id).querySelector('.sheet-card'); if (!card) return;
  let x0 = null, y0 = 0;
  card.addEventListener('touchstart', e => {
    const t = e.touches[0], tg = e.target;
    if (e.touches.length > 1 || t.clientX < 24 || t.clientX > window.innerWidth - 24 || tg.closest('input,textarea,select,[contenteditable],.tw,.navx,.dv-body img,.sheet-head') ) { x0 = null; return; }
    x0 = t.clientX; y0 = t.clientY;
  }, { passive: true });
  card.addEventListener('touchend', e => {
    if (x0 == null || !navOpenSheet()) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Math.abs(dx) > 2 * Math.abs(dy)) navGo(dx < 0 ? 1 : -1);
  });
});
['shDoc', 'shDocView', 'shNoteView', 'shNote', 'shTask', 'shFin'].forEach(id => { const prev = Sheets.onOpen[id]; Sheets.onOpen[id] = () => { if (prev) prev(); setTimeout(navShow, 60); }; });
/* v2.27: documents-only unlock ends when no document screen is open (wrapped last, after every other close handler is set) */
['shDocView', 'shDoc'].forEach(id => { const prev = Sheets.onClose[id]; Sheets.onClose[id] = () => { if (prev) { try { prev(); } catch (e) { RLOG.warn('onClose ' + id, e.message); } } DocUnlock.closed(); }; });

