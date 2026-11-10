/* ==========================================================================
   DOCUMENTS
   ======================================================================== */
/* Financial years (Apr–Mar) as "2024-25"; newest first. */
const fyOf = iso => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const s = m >= 4 ? y : y - 1; return s + '-' + String((s + 1) % 100).padStart(2, '0'); };
function fyList() { const cur = +fyOf(todayISO()).slice(0, 4), out = []; for (let s = cur + 1; s >= 2000; s--) out.push(s + '-' + String((s + 1) % 100).padStart(2, '0')); return out; }
const fyOptions = (sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + (sel && !fyList().includes(sel) ? [...fyList(), sel].sort().reverse() : fyList()).map(f => `<option value="${esc(f)}"${f === sel ? ' selected' : ''}>FY ${esc(f)}</option>`).join('');
const docPeople = () => orderPeople([...PERSON_ORDER, ...all('doc').flatMap(docOwners)]);
/* ---------- v2.11: people (aliases, surnames ignored) and broad groups for the Docs tab ---------- */
const DOC_ME = 'Rahul';
const PERSON_ALIAS = Object.assign(Object.create(null), { rk: 'Rahul', rahul: 'Rahul', moni: 'Ruchi', ruchi: 'Ruchi', papa: 'Papa', naresh: 'Papa', mummy: 'Mummy', mom: 'Mummy', maa: 'Mummy', kavita: 'Mummy' });   // no "constructor" / "__proto__" look-ups
const PERSON_ORDER = ['Rahul', 'Ruchi', 'Papa', 'Mummy'];
function personOne(s) {
  const w = String(s || '').trim().split(/\s+/)[0]; if (!w) return '';
  return PERSON_ALIAS[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function whoParts(raw) {
  const out = [];
  String(raw || '').split(/\s*(?:&|,|\+|\band\b)\s*/i).map(x => x.trim()).filter(Boolean).forEach(p => {
    if (/^parents$/i.test(p)) out.push('Papa', 'Mummy'); else out.push(personOne(p));
  });
  return [...new Set(out.filter(Boolean))];
}
function docOwners(d) { const o = whoParts(d && d.who); return o.length ? o : [DOC_ME]; }
function normWho(s) { return whoParts(s).join(' & '); }
function orderPeople(list) {
  return [...new Set(list)].sort((a, b) => { const ia = PERSON_ORDER.indexOf(a), ib = PERSON_ORDER.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    if (a === 'Family') return 1; if (b === 'Family') return -1; return a.localeCompare(b); });
}
let DOC_GROUPS = [['Academic', ['Education', 'Exam'], '🎓'], ['IDs', ['Identity'], '🪪'], ['Certificates', ['Certificate'], '📜'], ['Office', ['Official'], '🏛'], ['Case files', ['Case'], '🗂'],
  ['Financial', ['Financial', 'Tax', 'Insurance'], '💰'], ['Medical', ['Medical'], '🩺'], ['Property & vehicle', ['Property', 'Vehicle', 'Warranty'], '🏠'],
  ['Photos & signature', ['Photo & Signature'], '🖼'], ['Other', ['Membership', 'Other'], '📄']];
const docGroup = d => (syncDocCfg(), DOC_GROUPS.find(g => g[1].includes(d.docType)) || DOC_GROUPS[DOC_GROUPS.length - 1])[0];
const groupIcon = n => (DOC_GROUPS.find(g => g[0] === n) || [0, 0, '📁'])[2];
let docPath = { who: null, grp: null };
const docNewType = () => { const g = DOC_GROUPS.find(x => x[0] === docPath.grp); return g ? g[1][0] : 'Identity'; };
/* one-time tidy of documents imported from CASE_/EVIDENCE_ files (typed "Other", some with a wrong person) */
let docsMigrated = false;
function migrateCaseDocs() {
  if (docsMigrated) return; docsMigrated = true;
  all('doc').forEach(d => {
    const fs = docFilesOf(d.id); if (!fs.length || d.docType !== 'Other' || d.caseMig) return;     // once per document; your own edits stay
    if (!fs.every(f => /^(CASE|EVIDENCE)_/i.test(f.name || ''))) return;
    const p = parseDocName(fs[0].name || '');
    d.docType = 'Case'; d.who = ''; d.caseMig = true; if (p && p.title) d.title = p.title;
    put(d, { render: false });
  });
}

let docWho = 'All';
const docYears = d => [...new Set([d.fy, ...(d.byYear ? docFilesOf(d.id).map(f => f.fy) : [])].filter(Boolean))].sort().reverse();
let docYear = 'All';
let DOC_TYPES = ['Identity', 'Education', 'Exam', 'Tax', 'Financial', 'Insurance', 'Medical', 'Official', 'Case', 'Property', 'Vehicle', 'Certificate', 'Photo & Signature', 'Warranty', 'Membership', 'Other'];
const DOC_COLORS = { Case: '#5a3a3a', Tax: '#8a4b12', Medical: '#2E7D50', Official: '#2d4a6b', Exam: '#7a5c1e', Certificate: '#5b6e2f', 'Photo & Signature': '#6d5a8a', Insurance: '#1B4B8F', Vehicle: '#B45309', Identity: '#9C2963', Education: '#4F6B2F', Warranty: '#3F4F8C', Membership: '#2c6e6a', Property: '#6b3f5c', Financial: '#B8860B', Other: '#77818E' };
let docFilter = 'All', activeDocFolder = '__all__';
const docFolder = d => (d.folder || '').trim();
const docFolderList = () => [...new Set(all('doc').map(docFolder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const docFolderForNew = () => activeDocFolder !== '__all__' ? activeDocFolder : '';
function renderDocsBase() {
  migrateCaseDocs(); renderDriveChkNote(); if (typeof renderAttn === 'function') setTimeout(renderAttn, 0);
  const docs = all('doc');
  { const c = ImpCheck.get(), n = c && !c.off ? c.n : 0;
    $('docImpNote').innerHTML = n && !window.GHOST ? `<button class="imp-note" id="docImpGo"><span>📥 <b>${n} new file${n > 1 ? 's' : ''}</b> in your Docs folder</span><b>Review ›</b></button>` : '';
    if ($('docImpGo')) $('docImpGo').addEventListener('click', () => { openImport(); readImport(); });
    setTimeout(() => ImpCheck.maybe(), 800); }
  $('docChips').innerHTML = ''; $('docChips').classList.add('hidden');
  const allYears = [...new Set(docs.flatMap(docYears))].sort().reverse();
  if (docYear !== 'All' && !allYears.includes(docYear)) docYear = 'All';
  $('docYearBar').innerHTML = '';   // v2.27: the year picker sits in the top row
  { const slot = $('docYearSlot'); if (slot) slot.innerHTML = allYears.length ? `<select id="docYearSel" aria-label="Financial year"><option value="All">All years</option>${allYears.map(y => `<option value="${esc(y)}"${y === docYear ? ' selected' : ''}>FY ${esc(y)}</option>`).join('')}</select>` : ''; }
  if ($('docYearSel')) $('docYearSel').addEventListener('change', e => { docYear = e.target.value; renderDocs(); });
  const shown = docs.filter(d => docYear === 'All' || docYears(d).includes(docYear));
  const people = orderPeople([...shown.flatMap(docOwners), ...(docYear === 'All' ? docCfgPeople() : [])]);
  if (docPath.who && !people.includes(docPath.who)) docPath = { who: null, grp: null };
  const mine = docPath.who ? shown.filter(d => docOwners(d).includes(docPath.who)) : [];
  if (docPath.grp && !mine.some(d => docGroup(d) === docPath.grp)) docPath.grp = null;
  const fbox = $('docFolders'), cnt = n => `${n} document${n === 1 ? '' : 's'}`;
  let list = [], showWho = false;
  if (!docPath.who) {
    fbox.innerHTML = (people.length ? `<div class="folders">${people.map(p => { const own = shown.filter(d => docOwners(d).includes(p));
      const gs = DOC_GROUPS.filter(g => own.some(d => docGroup(d) === g[0])).map(g => g[0]);
      return `<button class="folder" data-dwho="${esc(p)}"><b>👤 ${esc(p)}</b><span>${cnt(own.length)}</span><small>${esc(gs.slice(0, 4).join(' · ') + (gs.length > 4 ? ' …' : ''))}</small></button>`; }).join('')}</div>` : '');
    list = shown.filter(d => d.expiry && daysUntilISO(d.expiry) <= 30 && daysUntilISO(d.expiry) >= -10).sort((a, b) => a.expiry.localeCompare(b.expiry));   // due in 30 days, or expired in the last 10
    if (list.length) fbox.innerHTML += '<div class="group-title">Expiring in 30 days · expired in the last 10 days</div>';
    showWho = true;
  } else if (!docPath.grp) {
    const gs = DOC_GROUPS.filter(g => mine.some(d => docGroup(d) === g[0]));
    fbox.innerHTML = `<div class="doc-crumb"><button class="chip" data-dback="home">‹ Everyone</button><b>👤 ${esc(docPath.who)}</b><span class="muted">${cnt(mine.length)}</span></div>
      <div class="folders">${gs.map(g => { const n = mine.filter(d => docGroup(d) === g[0]).length; return `<button class="folder" data-dgrp="${esc(g[0])}"><b>${g[2]} ${esc(g[0])}</b><span>${cnt(n)}</span></button>`; }).join('')}</div>`;
  } else {
    fbox.innerHTML = `<div class="doc-crumb"><button class="chip" data-dback="who">‹ ${esc(docPath.who)}</button><b>${groupIcon(docPath.grp)} ${esc(docPath.grp)}</b><span class="muted">${cnt(mine.filter(d => docGroup(d) === docPath.grp).length)}</span></div>`;
    list = mine.filter(d => docGroup(d) === docPath.grp).sort((a, b) => a.docType.localeCompare(b.docType) || a.title.localeCompare(b.title) || String(b.fy || '').localeCompare(String(a.fy || '')));
    showWho = list.some(d => docOwners(d).length > 1);
  }
  $$('[data-dwho]', fbox).forEach(b => { if (!window.GHOST) bindHold(b, 'dwho', b.dataset.dwho); b.addEventListener('click', () => { if (folderSkip(b)) return; docPath = { who: b.dataset.dwho, grp: null }; renderDocs(); $('main').scrollTop = 0; }); });
  $$('[data-dgrp]', fbox).forEach(b => { if (!window.GHOST) bindHold(b, 'dgrp', b.dataset.dgrp); b.addEventListener('click', () => { if (folderSkip(b)) return; docPath.grp = b.dataset.dgrp; renderDocs(); $('main').scrollTop = 0; }); });
  $$('[data-dback]', fbox).forEach(b => b.addEventListener('click', () => { if (SEL_RAW.has(Sel.kind)) selEnd(); if (b.dataset.dback === 'home') docPath = { who: null, grp: null }; else docPath.grp = null; renderDocs(); }));
  setTimeout(selPaint, 0);
  $('docList').innerHTML = list.map(d => {
    const days = d.expiry ? daysUntilISO(d.expiry) : null;
    return swipeHtml(`<div class="row" style="border-left:4px solid ${DOC_COLORS[d.docType] || '#77818E'}">
      ${d.expiry ? countHtml(days, 'expired') : '<div class="count past" aria-label="no expiry">∞<small>no expiry</small></div>'}
      <div class="row-main"><div class="row-title">${esc(d.title)}${showWho ? ` <span class="muted" style="font-weight:400">· ${esc(docOwners(d).join(' & '))}</span>` : ''}</div>
        <div class="row-sub"><span>${esc(d.docType)}</span>${docFileBadge(d)}${docNumShown(d) ? `<span class="mono">${esc(docNumShown(d))}</span><button type="button" class="d-copy" data-dcopy="${d.id}" aria-label="Copy number of ${esc(d.title)}">⧉ Copy</button>` : ''}${d.expiry ? `<span class="${days < 0 ? 'warn' : ''}">${days < 0 ? 'expired' : 'expires'} ${fmtDate(d.expiry, true)}</span>` : ''}${d.notes ? '<span>📝</span>' : ''}${docOffline(d) ? '<span class="off-ok" aria-label="files kept on this device">📱✓</span>' : ''}</div></div>
      ${docSel ? `<span class="sel-box${docSel.has(d.id) ? ' on' : ''}" aria-label="${docSel.has(d.id) ? 'selected' : 'not selected'}">${docSel.has(d.id) ? '✓' : ''}</span>` : '<span class="chev">›</span>'}</div>`, '', 'Delete 🗑', `data-doc="${d.id}"`);
  }).join('') || (!docs.length ? '<div class="empty"><b>No documents</b>Aadhaar, PAN, marksheets, ITRs, policies — tap ＋ Add document. Attach a photo or PDF, scan it, or keep just the details. Each person gets a folder, with categories inside.</div>' : '');
  $('docList').classList.toggle('hidden', !$('docList').innerHTML);
  $$('[data-doc]', $('docList')).forEach(w => { const id = w.dataset.doc; bindSwipe(w, null, () => deleteWithUndo(id)); docHold(w, id); onTap(w, e => { if (!docSel && e && e.target && e.target.closest('[data-dcopy]')) { copyDocNumber(id); return; } docSel ? toggleDocSel(id) : showDoc(id); }); });
  if (docSel && docPath.grp && list.length) { fbox.insertAdjacentHTML('beforeend', '<button class="linkbtn" id="docSelAll" style="margin:0 4px 8px">Select all here</button>'); $('docSelAll').addEventListener('click', () => { list.forEach(d => docSel.add(d.id)); renderDocs(); }); }
  renderSelBar();
}

let editDocId = null;
function openDocBase(id) {
  const d = records[id]; if (!d) return;
  editDocId = id;
  $('doTitle').value = d.title; $('doWho').value = d.who || ''; $('docWhoDl').innerHTML = docPeople().map(p => `<option value="${esc(p)}">`).join(''); $('doNumber').value = d.number || ''; $('doExpiry').value = d.expiry || '';
  $('doNumber').disabled = false; $('doNumber').placeholder = '';
  if (d.numEnc) { $('doNumber').disabled = true; $('doNumber').placeholder = Fin.key ? 'Opening…' : 'Locked';
    if (Fin.key) docNumFull(d).then(n => { if (editDocId === id) { $('doNumber').value = n; $('doNumber').disabled = false; $('doNumber').placeholder = ''; if (Sheets.onOpen.shDoc) Sheets.onOpen.shDoc(); } })
      .catch(() => { if (editDocId === id) $('doNumber').placeholder = 'Locked under an older code — unchanged'; }); }
  $('doIssuer').value = d.issuer || ''; $('doNotes').value = d.notes || ''; $('doDueKind').innerHTML = dueKindOpts(d.dueKind);
  $('doFolder').value = d.folder || '';
  $('doFy').innerHTML = fyOptions(d.fy || '', '— none —'); $('doByYear').checked = !!d.byYear;
  $('doFileFy').innerHTML = fyOptions((docYear !== 'All' ? docYear : null) || docYears(d)[0] || fyOf(todayISO()));
  $('doFileFyW').classList.toggle('hidden', !d.byYear); $('docFolderDl').innerHTML = docFolderList().map(f => `<option value="${esc(f)}">`).join('');
  chipGroup($('doType'), DOC_TYPES, d.docType, () => {}, t => DOC_COLORS[t]);
  $('doFileMsg').textContent = ''; renderDocEditFiles(); $('doNoFile').checked = !!d.noFile;
  Sheets.open('shDoc');
}
$('doSave').addEventListener('click', async () => {
  const d = records[editDocId]; if (!d) return;
  const numLocked = $('doNumber').disabled || (d.lockFiles && !Fin.key);            // never store a locked document's number in the clear
  if (numLocked && !$('doNumber').disabled && $('doNumber').value.trim() !== (d.number || '')) toast('The number was not changed — it is locked.');
  d.title = $('doTitle').value.trim() || d.title; d.docType = chipValue($('doType')) || d.docType;
  if (!numLocked) { d.number = $('doNumber').value.trim(); if (!d.number) { delete d.numEnc; delete d.numTail; } } d.expiry = $('doExpiry').value || null; d.issuer = $('doIssuer').value.trim(); d.notes = $('doNotes').value;
  d.folder = $('doFolder').value.trim();
  d.who = normWho($('doWho').value);
  d.fy = $('doFy').value || null; d.byYear = $('doByYear').checked;
  d.dueKind = $('doDueKind').value || 'expiry';
  if ($('doNoFile').checked) d.noFile = true; else delete d.noFile;
  if (d.lockFiles && d.number) await sealDocNumber(d);
  put(d); const dx = syncDocDate(d); Sheets.close('shDoc'); toast(d.expiry && dx ? 'Saved — the ' + dueWord(d.dueKind) + ' is in Dates.' : 'Saved.');
});
$('doDelete').addEventListener('click', () => { const id = editDocId; Sheets.close('shDoc', true); deleteWithUndo(id); });
$('doRemind').addEventListener('click', () => {
  $('doSave').click();
  const d = records[editDocId];
  if (!d || !d.expiry) { toast('Set an expiry date first.'); return; }
  if (all('date').some(x => x.docRef === d.id)) { toast('Already in Key dates.'); return; }
  put({ id: uid('d'), type: 'date', label: d.title + ' — expiry', when: d.expiry, repeat: 'once', docRef: d.id, cat: 'docexp', deleted: false });
  toast('Added to Key dates.');
});

