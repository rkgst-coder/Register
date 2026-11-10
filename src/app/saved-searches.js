/* ==========================================================================
   v2.19 — saved searches (kept in the Sheet, so every device has them)
   ======================================================================== */
const SAVEDQ_ID = 'saved-q';
const savedQ = () => { const r = records[SAVEDQ_ID]; return r && !r.deleted && Array.isArray(r.list) ? r.list.filter(x => typeof x === 'string') : []; };
function setSavedQ(list) { const r = records[SAVEDQ_ID]; put({ ...(r || { id: SAVEDQ_ID, type: 'savedq' }), list: [...new Set(list)].slice(0, 20), deleted: false }, { render: false }); }
function savedSearchUI(q, box) {
  if (window.GHOST) return;
  const L = savedQ(), qq = String(q || '').trim();
  if (!qq) {
    if (!L.length) return;
    box.insertAdjacentHTML('afterbegin', `<div class="sug-panel" style="padding-bottom:0"><div class="sug-t"><span>Saved searches</span></div><div class="sug-chips">${L.map((s, i) => `<button data-svq="${i}">☆ ${esc(s)}</button>`).join('')}</div></div>`);
    $$('[data-svq]', box).forEach(b => {
      b.addEventListener('click', () => { $('searchIn').value = L[+b.dataset.svq]; runSearch(); });
      let t = null; b.addEventListener('contextmenu', e => e.preventDefault());
      b.addEventListener('touchstart', () => { t = setTimeout(() => { t = 'x'; if (confirm(`Remove the saved search “${L[+b.dataset.svq]}”?`)) { setSavedQ(L.filter((x, i) => i !== +b.dataset.svq)); runSearch(); } }, 600); }, { passive: true });
      b.addEventListener('touchend', e => { if (t === 'x') e.preventDefault(); clearTimeout(t); t = null; });
    });
    box.insertAdjacentHTML('beforeend', '<p class="hint" style="margin:8px 4px">Press and hold a saved search to remove it.</p>');
    return;
  }
  const on = L.some(x => x.toLowerCase() === qq.toLowerCase());
  box.insertAdjacentHTML('afterbegin', `<div style="display:flex;justify-content:flex-end;padding:6px 10px 0"><button class="linkbtn" id="svqBtn" style="font-size:.8125rem">${on ? '★ Saved — remove' : '☆ Save this search'}</button></div>`);
  $('svqBtn').addEventListener('click', () => { setSavedQ(on ? L.filter(x => x.toLowerCase() !== qq.toLowerCase()) : [qq, ...L]); toast(on ? 'Saved search removed.' : 'Saved — it shows when you open search.'); runSearch(); });
}

