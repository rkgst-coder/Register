/* ==========================================================================
   v2.19 — Settings: a menu, five sub-screens and a search box
   ======================================================================== */
const SET_PAGES = { privacy: 'Privacy', sync: 'Sync & Drive', data: 'Backup & Data', look: 'Look & Feel', emergency: 'Emergency' };
function setShowPage(pg) {
  $('setHome').classList.toggle('hidden', !!pg);
  $$('#shSettings .set-page').forEach(p => p.classList.toggle('hidden', p.dataset.page !== pg));
  $('setBack').style.visibility = pg ? 'visible' : 'hidden';
  $('setTitle').textContent = pg ? SET_PAGES[pg] : 'Settings';
  const b = $('shSettings').querySelector('.sheet-body'); if (b) b.scrollTop = 0;
}
function setRows() {
  return $$('#shSettings .set-page').flatMap(pg => $$('.set-row, .switch-row', pg).filter(r => !r.classList.contains('hidden') && !r.closest('.hidden:not(.set-page)') && (finUnlocked() || !r.closest('.priv-only'))).map(r => {
    const c = r.cloneNode(true); $$('.v, select, input, small, .msg', c).forEach(x => x.remove());
    const sm = r.querySelector('small');
    return { r, page: pg.dataset.page, label: c.textContent.replace(/\s+/g, ' ').trim(), sub: sm ? sm.textContent.trim() : '' };
  })).filter(x => x.label);
}
function setSearch(q) {
  q = String(q || '').trim().toLowerCase();
  const box = $('setQRes'); $('setMenu').classList.toggle('hidden', !!q);
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  const words = q.split(/\s+/);
  const L = setRows().filter(x => words.every(w => (x.label + ' ' + x.sub + ' ' + SET_PAGES[x.page]).toLowerCase().includes(w))).slice(0, 25);
  box.hidden = false;
  box.innerHTML = L.length ? L.map((x, i) => `<button class="set-row sq-row" data-sq="${i}"><span>${esc(x.label)}<small>${esc(SET_PAGES[x.page])}</small></span><span class="v">›</span></button>`).join('') : '<div class="empty">No setting matches.</div>';
  $$('[data-sq]', box).forEach(b => b.addEventListener('click', () => {
    const x = L[+b.dataset.sq]; $('setQ').value = ''; setSearch(''); setShowPage(x.page);
    setTimeout(() => { x.r.scrollIntoView({ block: 'center' }); x.r.classList.add('set-hit'); setTimeout(() => x.r.classList.remove('set-hit'), 1600); }, 60);
  }));
}
$$('#setMenu [data-page]').forEach(b => b.addEventListener('click', () => setShowPage(b.dataset.page)));
$('setBack').addEventListener('click', () => setShowPage(null));
$('setQ').addEventListener('input', () => setSearch($('setQ').value));
Sheets.onOpen.shSettings = () => { $('setQ').value = ''; setSearch(''); setShowPage(null);
  try { const w = securityChecks().filter(c => c.state === 'warn').length; $('setPrivV').textContent = w ? w + ' to review' : '›'; } catch (e) {}
  $('setSyncV').textContent = Sync.on() ? (Sync.lastOk ? 'synced ' + timeAgo(Sync.lastOk) : 'connected') : 'off';
  $('setScanIdxV').textContent = scanIdxLabel(); if ($('setOffV')) $('setOffV').textContent = offLabel(); };
$('setHealth').addEventListener('click', () => { Sheets.close('shSettings', true); openDataHealth(); });
$('setWhatsNew').addEventListener('click', () => showWhatsNew());
$('setScanIdx').addEventListener('click', () => { Sheets.close('shSettings', true); indexAllScans(); });
$('setOff').addEventListener('click', () => { Sheets.close('shSettings', true); openOffline(); });

