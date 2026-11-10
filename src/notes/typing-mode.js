/* ==========================================================================
   v2.31 — more room to write on iPhone: while the keyboard is up in a note,
   the title, folder and ‹ 1 of 5 › bar step aside, the toolbar becomes one
   row that stays at the top, and the writing fills the rest of the screen.
   ======================================================================== */
const NE_TOUCH = matchMedia('(pointer: coarse)').matches;
function neTyping(on) { const sh = $('shNote'); if (sh) sh.classList.toggle('ne-typing', !!on); }
function neCaretIntoView() {
  const sh = $('shNote'); if (!sh || !sh.classList.contains('ne-typing')) return;
  const s = getSelection(); if (!s.rangeCount) return;
  let rc = s.getRangeAt(0).getBoundingClientRect();
  if (!rc || (!rc.height && !rc.top)) { const n = s.anchorNode, el = n && (n.nodeType === 1 ? n : n.parentNode); if (!el || !el.getBoundingClientRect) return; rc = el.getBoundingClientRect(); }
  const body = sh.querySelector('.sheet-body'), br = body.getBoundingClientRect(), bar = $('neBar').getBoundingClientRect();
  if (rc.bottom > br.bottom - 12) body.scrollTop += rc.bottom - br.bottom + 48;          // keep the line you are typing above the keyboard
  else if (rc.top < bar.bottom + 4) body.scrollTop -= bar.bottom + 4 - rc.top + 24;       // … and below the toolbar
}
let neCaretRaf = 0;
const neCaretSoon = () => { cancelAnimationFrame(neCaretRaf); neCaretRaf = requestAnimationFrame(neCaretIntoView); };
[$('neRich'), ta()].forEach(el => {
  if (!el) return;
  el.addEventListener('focus', () => { if (NE_TOUCH) { neTyping(true); setTimeout(neCaretIntoView, 400); } });
  el.addEventListener('blur', () => setTimeout(() => { const a = document.activeElement; if (a !== $('neRich') && a !== ta()) neTyping(false); }, 250));
  el.addEventListener('input', neCaretSoon);
});
document.addEventListener('selectionchange', () => { if (document.activeElement === $('neRich')) neCaretSoon(); });
window.visualViewport && window.visualViewport.addEventListener('resize', () => setTimeout(neCaretIntoView, 120));
// tapping a toolbar button keeps the keyboard up and the caret where it was
$$('#neBar button').forEach(b => b.addEventListener('mousedown', e => { const a = document.activeElement; if (a === $('neRich') || a === ta()) e.preventDefault(); }));
{ const prev = Sheets.onClose.shNote; Sheets.onClose.shNote = () => { neTyping(false); if (prev) prev(); }; }

