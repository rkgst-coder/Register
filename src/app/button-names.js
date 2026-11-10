/* ==========================================================================
   v2.28 — what a button does: its name shows on hover (computer), and on the
   note toolbars a press-and-hold shows it on iPhone
   ======================================================================== */
document.addEventListener('mouseover', e => {
  const b = e.target.closest && e.target.closest('button[aria-label]:not([title]),a[aria-label]:not([title])');
  if (b) b.title = b.getAttribute('aria-label');
});
(() => {
  let timer = null, shown = false;
  document.addEventListener('touchstart', e => {
    const b = e.target.closest && e.target.closest('#neBar button[aria-label],#neTblBar button[aria-label]'); if (!b) return;
    shown = false; clearTimeout(timer);
    timer = setTimeout(() => { shown = true; toast(b.getAttribute('aria-label')); }, 550);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach(ev => document.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
  document.addEventListener('click', e => { if (shown && e.target.closest && e.target.closest('#neBar,#neTblBar')) { shown = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);   // a hold only shows the name
})();

