/* ==========================================================================
   v2.19 — Emergency sheet (encrypted with the private code): where the
   originals are kept, nominees, and a note. One per person.
   ======================================================================== */
const emId = p => 'em-' + (normName(p) || 'x').slice(0, 40);
let emWho = null;
function openEmergency(p) {
  if (window.GHOST) { ghostCrash(true); return; }
  if (!Fin.key) { needUnlock(() => openEmergency(p)); return; }
  emWho = p; const r = records[emId(p)], e = r && !r.deleted ? r : { places: [], nominees: [], notes: '' };
  const row = (sec, a, b, pa, pb) => `<div class="em-row" data-em="${sec}"><input value="${esc(a || '')}" placeholder="${pa}" aria-label="${pa}"><input value="${esc(b || '')}" placeholder="${pb}" aria-label="${pb}"><button type="button" class="em-rm" aria-label="Remove row">✕</button></div>`;
  const docs = all('doc').filter(d => docOwners(d).includes(p)).map(d => d.title), missing = docs.filter(t => !(e.places || []).some(x => x.what === t));
  $('emTitle').textContent = 'Emergency sheet · ' + p;
  $('emBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Encrypted with your private code — not readable in the Sheet. Fill what someone would need in an emergency.</p>
    <div class="group-title">Where the originals are kept</div><div id="emPlaces">${(e.places || []).map(x => row('places', x.what, x.where, 'Document', 'Kept where?')).join('')}</div>
    <div class="btn-row" style="margin:4px 0 0;flex-wrap:wrap"><button class="btn ghost small" type="button" id="emAddP">＋ Row</button>${missing.length ? `<button class="btn ghost small" type="button" id="emAllP">＋ All ${missing.length} of ${esc(p)}'s documents</button>` : ''}</div>
    <div class="group-title">Nominees</div><div id="emNoms">${(e.nominees || []).map(x => row('nominees', x.what, x.who, 'Account / policy', 'Nominee')).join('')}</div>
    <div class="btn-row" style="margin:4px 0 0"><button class="btn ghost small" type="button" id="emAddN">＋ Row</button></div>
    <div class="group-title">Notes</div><textarea id="emNotes" rows="5" placeholder="Locker number and branch, who to call, where the will is…">${esc(e.notes || '')}</textarea>
    <div class="btn-row"><button class="btn ghost" type="button" id="emPrint">🖨 Print / PDF</button></div>
    ${r && r.updatedAt ? `<p class="hint">Last saved ${timeAgo(r.updatedAt)}.</p>` : ''}`;
  const wire = () => $$('.em-rm', $('emBody')).forEach(b => { b.onclick = () => b.closest('.em-row').remove(); });
  const add = (box, sec, a, pa, pb) => { $(box).insertAdjacentHTML('beforeend', row(sec, a, '', pa, pb)); wire(); };
  $('emAddP').addEventListener('click', () => add('emPlaces', 'places', '', 'Document', 'Kept where?'));
  $('emAddN').addEventListener('click', () => add('emNoms', 'nominees', '', 'Account / policy', 'Nominee'));
  if ($('emAllP')) $('emAllP').addEventListener('click', () => { missing.forEach(t => add('emPlaces', 'places', t, 'Document', 'Kept where?')); $('emAllP').remove(); });
  $('emPrint').addEventListener('click', () => { const v = emRead(); printEmergency(p, v); });
  wire();
  if (!Sheets.isOpen('shEmerg')) Sheets.open('shEmerg');
}
function emRead() {
  const rows = sec => $$(`[data-em="${sec}"]`, $('emBody')).map(r => { const i = r.querySelectorAll('input'); return [i[0].value.trim().slice(0, 120), i[1].value.trim().slice(0, 200)]; }).filter(x => x[0] || x[1]);
  return { places: rows('places').map(([what, where]) => ({ what, where })), nominees: rows('nominees').map(([what, who]) => ({ what, who })), notes: $('emNotes').value.slice(0, 4000) };
}
$('emSave').addEventListener('click', () => {
  if (!Fin.key) { toast('The private section locked — open it again to save.'); return; }
  const v = emRead(), id = emId(emWho), r = records[id];
  put({ ...(r || { id, type: 'emerg' }), who: emWho, ...v, deleted: false });
  Sheets.close('shEmerg', true); toast('Emergency sheet saved (encrypted).');
});
function emText(p, v) {
  return `EMERGENCY SHEET — ${p}\nPrinted ${new Date().toLocaleString('en-IN')}\n\nWHERE THE ORIGINALS ARE KEPT\n${(v.places || []).map(x => `- ${x.what}: ${x.where}`).join('\n') || '-'}\n\nNOMINEES\n${(v.nominees || []).map(x => `- ${x.what}: ${x.who}`).join('\n') || '-'}\n\nNOTES\n${v.notes || '-'}\n`;
}
function printEmergency(p, v) {
  $('printArea').innerHTML = `<div style="font-family:Georgia,serif;padding:10px"><h1>Emergency sheet — ${esc(p)}</h1>
    <h2>Where the originals are kept</h2><table style="border-collapse:collapse;width:100%">${(v.places || []).map(x => `<tr><td style="border:1px solid #999;padding:6px">${esc(x.what)}</td><td style="border:1px solid #999;padding:6px">${esc(x.where)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table>
    <h2>Nominees</h2><table style="border-collapse:collapse;width:100%">${(v.nominees || []).map(x => `<tr><td style="border:1px solid #999;padding:6px">${esc(x.what)}</td><td style="border:1px solid #999;padding:6px">${esc(x.who)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table>
    <h2>Notes</h2><p style="white-space:pre-wrap">${esc(v.notes || '—')}</p><hr><p style="color:#666;font-size:12px">Printed ${new Date().toLocaleString('en-IN')} from Register. Keep this paper safe.</p></div>`;
  setTimeout(() => window.print(), 100);
}

