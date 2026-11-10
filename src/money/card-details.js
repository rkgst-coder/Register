/* ==========================================================================
   v2.23 — Card & account details: encrypted entries, each with its own fields
   (card: number / expiry / CVV; bill: consumer no.; bank: account / IFSC …)
   Sealed with the private code like the Emergency sheet; hidden while locked.
   Fields marked 🔒 stay as •••• until Show, and are never printed.
   ======================================================================== */
const VAULT_KINDS = [
  ['card', '💳', 'Debit / credit cards', [['Card number'], ['Name on card'], ['Valid till (MM/YY)'], ['CVV', 1], ['PIN', 1]]],
  ['bank', '🏦', 'Bank accounts', [['Account number'], ['IFSC'], ['Branch'], ['Customer ID'], ['Net-banking user ID'], ['Password', 1]]],
  ['bill', '⚡', 'Bills & utilities', [['Consumer number'], ['Account number'], ['Registered mobile']]],
  ['phone', '📱', 'Mobile & internet', [['Number'], ['Account / customer ID'], ['Plan']]],
  ['policy', '🛡', 'Insurance & policies', [['Policy number'], ['Insurer'], ['Renewal date']]],
  ['id', '🪪', 'IDs & registrations', [['Number'], ['Issued on'], ['Valid till']]],
  ['login', '🌐', 'Website & app logins', [['Website'], ['User ID'], ['Password', 1]]],
  ['other', '🗂', 'Other', [['Number']]]
];
const VSHORT = { card: 'Card', bank: 'Bank account', bill: 'Bill / utility', phone: 'Mobile / internet', policy: 'Policy', id: 'ID / registration', login: 'Login', other: 'Other' };
const vKind = k => VAULT_KINDS.find(x => x[0] === k) || VAULT_KINDS[VAULT_KINDS.length - 1];
const vaultAll = () => finUnlocked() && !window.GHOST ? all('vault') : [];
let vtEdit = null, vtQ = '', vtShown = new Set(), vtTimer = null;
function renderVaultCard() {
  const box = $('docVault'); if (!box) return;
  box.innerHTML = ''; return;   // v2.27: moved to Money → PNote → “Cards & accounts”
  if (window.GHOST || !finUnlocked()) { box.innerHTML = ''; return; }
  const n = vaultAll().length;
  box.innerHTML = `<button type="button" class="vault-card priv-only" id="vaultGo"><span class="vc-i">🔐</span><span class="vc-t"><b>Card &amp; account details</b><small>${n ? plural(n, 'entry').replace('entrys', 'entries') + ' · ' : ''}encrypted · numbers, CVV, consumer no.</small></span><span class="chev">›</span></button>`;
  $('vaultGo').addEventListener('click', () => openCards());
}
function openCards(editId) {
  if (window.GHOST) { ghostCrash(true); return; }
  if (!finUnlocked()) { toast('Card & account details are now in Money → PNote → “Cards & accounts”. Open Money first.'); return; }
  { vaultToNote(); const n = all('snote').find(x => x.fromVault); if (n) { setPref('moneySeg', 'snotes'); showTab('money'); previewNote(n.id); return; } }   // v2.27
  vtShown = new Set();
  if (editId !== undefined) vaultEditor(editId); else vaultList();
  if (!Sheets.isOpen('shCards')) Sheets.open('shCards');
}
function vaultList() {
  vtEdit = null;
  $('vtTitle').textContent = 'Card & account details'; $('vtSave').textContent = 'Done'; $('vtBack').textContent = 'Close';
  const q = vtQ.trim().toLowerCase(), L = vaultAll().filter(e => !q || [e.title, e.who, vKind(e.kind)[2], ...(e.fields || []).filter(f => !f.s).flatMap(f => [f.l, f.v])].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const card = e => `<div class="vt-card" data-vt="${e.id}"><div class="vt-h"><b>${esc(e.title || 'Untitled')}</b>${e.who ? `<small>👤 ${esc(e.who)}</small>` : ''}<button type="button" class="vt-ed" data-vte="${e.id}" aria-label="Edit ${esc(e.title || '')}">✎ Edit</button></div>
    ${(e.fields || []).filter(f => f.v).map((f, i) => { const k = e.id + ':' + i, show = !f.s || vtShown.has(k);
      return `<div class="vt-f"><span class="vt-l">${f.s ? '🔒 ' : ''}${esc(f.l || 'Field')}</span><span class="vt-v mono">${show ? esc(f.v) : '••••••'}</span>${f.s ? `<button type="button" data-vts="${k}">${show ? 'Hide' : 'Show'}</button>` : ''}<button type="button" data-vtc="${k}" aria-label="Copy ${esc(f.l || '')}">⧉</button></div>`; }).join('')}
    ${e.notes ? `<div class="vt-n">${esc(e.notes)}</div>` : ''}</div>`;
  const groups = VAULT_KINDS.map(k => [k, L.filter(e => vKind(e.kind)[0] === k[0])]).filter(g => g[1].length);
  $('vtBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Encrypted with your private code — the Google Sheet only sees scrambled text. Fields marked 🔒 (CVV, PIN, passwords) stay hidden until you tap Show, and are never printed.</p>
    ${vaultAll().length > 4 ? `<input id="vtQ" type="search" placeholder="Search name, number…" value="${esc(vtQ)}" autocomplete="off" style="margin-bottom:10px">` : ''}
    ${groups.map(([k, es]) => `<div class="group-title">${k[1]} ${esc(k[2])}</div>${es.map(card).join('')}`).join('') || `<div class="empty">${q ? 'Nothing matches.' : 'Nothing saved yet — pick what to add below.'}</div>`}
    <div class="group-title">＋ Add</div><div class="wrapchips">${VAULT_KINDS.map(k => `<button type="button" class="chip" data-vtn="${k[0]}">${k[1]} ${esc(VSHORT[k[0]])}</button>`).join('')}</div>
    ${vaultAll().length ? '<div class="btn-row"><button class="btn ghost" type="button" id="vtPrint">🖨 Print / PDF (🔒 fields left out)</button></div>' : ''}`;
  const b = $('vtBody');
  if ($('vtQ')) $('vtQ').addEventListener('input', () => { vtQ = $('vtQ').value; const pos = $('vtQ').selectionStart; vaultList(); const el = $('vtQ'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} });
  $$('[data-vte]', b).forEach(x => x.addEventListener('click', () => vaultEditor(x.dataset.vte)));
  $$('[data-vtn]', b).forEach(x => x.addEventListener('click', () => vaultEditor(null, x.dataset.vtn)));
  $$('[data-vts]', b).forEach(x => x.addEventListener('click', () => { const k = x.dataset.vts; vtShown.has(k) ? vtShown.delete(k) : vtShown.add(k); clearTimeout(vtTimer); vtTimer = setTimeout(() => { vtShown.clear(); if (Sheets.isOpen('shCards') && !vtEdit) vaultList(); }, 30000); vaultList(); }));
  $$('[data-vtc]', b).forEach(x => x.addEventListener('click', async () => { const [id, i] = x.dataset.vtc.split(':'), e = records[id], f = e && (e.fields || []).filter(f => f.v)[+i]; if (!f) return;
    try { await navigator.clipboard.writeText(f.v); if (f.s) { clipArm(); toast(`Copied ${f.l || 'it'} — wiped from the clipboard the next time you tap in Register after 30 s.`); } else toast(`Copied ${f.l || 'it'}.`); } catch (er) { toast('Could not copy here.'); } }));
  if ($('vtPrint')) $('vtPrint').addEventListener('click', () => printVault(L));
}
function vaultEditor(id, kind) {
  const e0 = id && records[id], k = vKind(e0 ? e0.kind : kind);
  const e = e0 ? JSON.parse(JSON.stringify(e0)) : { kind: k[0], title: '', who: '', fields: k[3].map(([l, s]) => ({ l, v: '', s: !!s })), notes: '' };
  vtEdit = id || 'new';
  $('vtTitle').textContent = e0 ? 'Edit' : 'New · ' + VSHORT[k[0]]; $('vtSave').textContent = 'Save'; $('vtBack').textContent = '‹ Back';
  const people = typeof allDocPeople === 'function' ? allDocPeople() : [];
  const row = f => `<div class="vt-row"><input class="vt-rl" value="${esc(f.l || '')}" placeholder="Field name" aria-label="Field name" maxlength="40"><input class="vt-rv${f.s ? ' vt-sec' : ''}" value="${esc(f.v || '')}" placeholder="Value" aria-label="Value" maxlength="300" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="vt-lock${f.s ? ' on' : ''}" aria-label="Hide this field" title="Hide (🔒) — never printed">${f.s ? '🔒' : '🔓'}</button><button type="button" class="em-rm" aria-label="Remove field">✕</button></div>`;
  $('vtBody').innerHTML = `<div class="field"><label>Name</label><input id="vtName" value="${esc(e.title || '')}" placeholder="${{ card: 'e.g. SBI debit card', bank: 'e.g. SBI savings', bill: 'e.g. Electricity bill', phone: 'e.g. Jio — Rahul', policy: 'e.g. Star health policy', id: 'e.g. Car RC', login: 'e.g. Income-tax portal' }[k[0]] || 'Name'}" maxlength="80" autocomplete="off"></div>
    <div class="grid2"><div class="field"><label>Kind</label><select id="vtKind">${VAULT_KINDS.map(x => `<option value="${x[0]}"${x[0] === k[0] ? ' selected' : ''}>${x[1]} ${esc(x[2])}</option>`).join('')}</select></div>
      <div class="field"><label>Belongs to</label><input id="vtWho" value="${esc(e.who || '')}" list="vtPeople" placeholder="Optional" maxlength="40" autocomplete="off"><datalist id="vtPeople">${people.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div></div>
    <div class="group-title">Fields <span class="muted" style="font-weight:400;text-transform:none">· 🔒 = hidden &amp; not printed</span></div>
    <div id="vtRows">${(e.fields || []).map(row).join('')}</div>
    <div class="btn-row" style="margin:4px 0 0"><button class="btn ghost small" type="button" id="vtAddF">＋ Field</button></div>
    <div class="group-title">Notes</div><textarea id="vtNotes" rows="3" placeholder="Anything else — branch, helpline, which phone it is linked to…" maxlength="2000">${esc(e.notes || '')}</textarea>
    <label class="switch-row">Expiry / renewal date in Dates<input type="checkbox" class="sw" id="vtDate"${e.noDate ? '' : ' checked'}></label>
    <p class="hint" style="margin:-4px 4px 10px">Uses a field like “Valid till”, “Expiry” or “Renewal date” (08/29, 31/08/2029 …). Only the name and the date go to Dates — no numbers.</p>
    ${e0 ? '<div class="btn-row"><button class="btn ghost" type="button" id="vtDel" style="color:var(--seal)">🗑 Delete this entry</button></div>' : ''}<div class="msg" id="vtMsg"></div>`;
  const wire = () => { $$('#vtRows .em-rm').forEach(x => { x.onclick = () => x.closest('.vt-row').remove(); });
    $$('#vtRows .vt-lock').forEach(x => { x.onclick = () => { const on = !x.classList.contains('on'); x.classList.toggle('on', on); x.textContent = on ? '🔒' : '🔓'; x.parentNode.querySelector('.vt-rv').classList.toggle('vt-sec', on); }; }); };
  $('vtAddF').addEventListener('click', () => { $('vtRows').insertAdjacentHTML('beforeend', row({ l: '', v: '', s: false })); wire(); const r = $$('#vtRows .vt-rl'); r[r.length - 1].focus(); });
  if ($('vtDel')) $('vtDel').addEventListener('click', () => { const x = records[id]; if (!x) return; softDelete(id, { render: false }); vaultList(); toast('Deleted.', 'Undo', () => { restore(id); if (Sheets.isOpen('shCards') && !vtEdit) vaultList(); }, 7000); renderVaultCard(); });
  $('vtKind').addEventListener('change', () => { const nk = vKind($('vtKind').value), has = $$('#vtRows .vt-rv').some(x => x.value.trim());
    if (!has) { $('vtRows').innerHTML = nk[3].map(([l, s]) => row({ l, v: '', s: !!s })).join(''); wire(); } });
  wire();
  setTimeout(() => { if (!e0 && $('vtName')) $('vtName').focus(); }, 300);
}
function vaultRead() {
  const fields = $$('#vtRows .vt-row').map(r => ({ l: r.querySelector('.vt-rl').value.trim().slice(0, 40), v: r.querySelector('.vt-rv').value.trim().slice(0, 300), s: r.querySelector('.vt-lock').classList.contains('on') })).filter(f => f.l || f.v).slice(0, 40);
  return { title: $('vtName').value.trim().slice(0, 80), kind: $('vtKind').value, who: normWho($('vtWho').value.trim()).slice(0, 40), fields, notes: $('vtNotes').value.slice(0, 2000), noDate: $('vtDate') && !$('vtDate').checked ? true : undefined };
}
$('vtSave').addEventListener('click', () => {
  if (!vtEdit) { Sheets.close('shCards', true); $('vtBody').innerHTML = ''; return; }
  if (!Fin.key) { toast('The private section locked — open it again to save.'); return; }
  const v = vaultRead(); if (!v.title) { const m = $('vtMsg'); m.className = 'msg err'; m.textContent = 'Give it a name (e.g. “SBI debit card”).'; $('vtName').focus(); return; }
  const id = vtEdit === 'new' ? uid('vt') : vtEdit, r = records[id];
  const saved = put({ ...(r || { id, type: 'vault' }), ...v, deleted: false }, { render: false });
  const dw = vaultDateWant(saved); sysDate('vd-' + id, dw, true);
  toast(dw ? `Saved (encrypted). “${dw.label}” is in Dates for ${fmtDate(dw.when, true)}.` : 'Saved (encrypted).'); vaultList(); renderVaultCard();
});
$('vtBack').addEventListener('click', () => { if (vtEdit) vaultList(); else { Sheets.close('shCards', true); $('vtBody').innerHTML = ''; } });
function printVault(list) {
  const td = 'border:1px solid #999;padding:5px 6px;font-size:12px;vertical-align:top';
  $('printArea').innerHTML = `<div style="font-family:Georgia,serif;padding:10px"><h1 style="font-size:20px">Card &amp; account details</h1>
    ${VAULT_KINDS.map(k => { const es = list.filter(e => vKind(e.kind)[0] === k[0]); if (!es.length) return '';
      return `<h2 style="font-size:15px;margin:14px 0 6px">${esc(k[2])}</h2><table style="border-collapse:collapse;width:100%">${es.map(e => `<tr><td style="${td};width:30%"><b>${esc(e.title)}</b>${e.who ? `<br><span style="color:#555">${esc(e.who)}</span>` : ''}</td><td style="${td}">${(e.fields || []).filter(f => f.v).map(f => `${esc(f.l)}: ${f.s ? '<i style="color:#888">not printed</i>' : `<span style="font-family:monospace">${esc(f.v)}</span>`}`).join('<br>')}${e.notes ? `<div style="color:#555;margin-top:4px">${esc(e.notes)}</div>` : ''}</td></tr>`).join('')}</table>`; }).join('')}
    <hr><p style="color:#666;font-size:11px">Printed ${new Date().toLocaleString('en-IN')} from Register. Hidden (🔒) fields are left out. Keep this paper safe.</p></div>`;
  setTimeout(() => window.print(), 120);
}


