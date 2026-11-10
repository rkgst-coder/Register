/* ==========================================================================
   v2.19 — Family: document checklist (Papa, Mummy, Ruchi)
   ======================================================================== */
const FAM_ID = 'fam-check', FAM_PEOPLE = ['Papa', 'Mummy', 'Ruchi'];
const FAM_DEFAULT = {
  Papa: ['Aadhaar card', 'PAN card', 'Passport', 'Voter ID', 'Driving licence', 'Bank passbook / KYC', 'Pension / PPO', 'Health insurance', 'Life insurance / LIC', 'Will / Nominee', 'Property papers', 'Photo & signature'],
  Mummy: ['Aadhaar card', 'PAN card', 'Passport', 'Voter ID', 'Bank passbook / KYC', 'Health insurance', 'Life insurance / LIC', 'Will / Nominee', 'Photo & signature'],
  Ruchi: ['Aadhaar card', 'PAN card', 'Passport', 'Voter ID', 'Driving licence', 'Bank passbook / KYC', 'Marriage certificate', 'Education certificates / Marksheet', 'Health insurance', 'Life insurance / LIC', 'Photo & signature']
};
const FAM_GENERIC = new Set(['card', 'details', 'detail', 'certificate', 'certificates', 'copy', 'papers', 'paper', 'policy', 'document', 'documents', 'the', 'of', 'and', 'id', 'no', 'number']);
const famCfg = () => { const r = records[FAM_ID]; return r && !r.deleted ? r : null; };
const famList = p => { const c = famCfg(); const L = c && c.lists && Array.isArray(c.lists[p]) ? c.lists[p] : null; return (L || FAM_DEFAULT[p] || FAM_DEFAULT.Ruchi).filter(x => typeof x === 'string' && x.trim()); };
const famNorm = w => { w = String(w || '').toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence'); return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w; };
function famWordsOf(part) {
  const ws = String(part).replace(/&/g, ' ').split(/[^A-Za-z0-9ऀ-ॿ]+/).map(famNorm).filter(Boolean);
  const sig = ws.filter(w => !FAM_GENERIC.has(w)); return sig.length ? sig : ws;
}
function famMatch(item, d) {
  const hay = new Set([d.title, d.docType, docGroup(d), d.issuer].join(' ').split(/[^A-Za-z0-9ऀ-ॿ]+/).map(famNorm).filter(Boolean));
  const hit = w => hay.has(w) || (w.length > 3 && [...hay].some(h => h.startsWith(w)));
  return String(item).split('/').map(x => x.trim()).filter(Boolean).some(part => famWordsOf(part).every(hit));
}
const FAM_TYPE = [[/aadha|pan\b|passport|voter|licen|ration/i, 'Identity'], [/insurance|\blic\b|mediclaim/i, 'Insurance'], [/bank|kyc|passbook|pension|ppo|fd\b/i, 'Financial'],
  [/property|house|flat|land/i, 'Property'], [/marriage|birth|death|caste/i, 'Certificate'], [/education|marksheet|degree|10th|12th/i, 'Education'], [/photo|signature/i, 'Photo & Signature'], [/vehicle|\brc\b|car/i, 'Vehicle']];
const famType = item => { const h = FAM_TYPE.find(([rx]) => rx.test(item)); return h && DOC_TYPES.includes(h[1]) ? h[1] : 'Other'; };
function famStatus(p) {
  const docs = all('doc').filter(d => docOwners(d).includes(p));
  return famList(p).map(item => {
    const m = docs.filter(d => famMatch(item, d)), withFile = m.find(d => docFilesOf(d.id).length);
    return { item, doc: withFile || m[0] || null, st: withFile ? 'ok' : m.length ? 'part' : 'no' };
  });
}
let famWho = 'Papa', famEdit = false;
function openFamily(p) {
  if (window.GHOST) { ghostCrash(true); return; }
  if (p) famWho = p; if (!FAM_PEOPLE.includes(famWho)) famWho = FAM_PEOPLE[0];
  const S = famStatus(famWho), ok = S.filter(x => x.st === 'ok').length;
  const chips = FAM_PEOPLE.map(x => { const s = famStatus(x), n = s.filter(y => y.st === 'ok').length; return `<button class="chip ${x === famWho ? 'on' : ''}" data-fp="${esc(x)}">${esc(x)} <span class="n">${n}/${s.length}</span></button>`; }).join('');
  $('fcTitle').textContent = 'Family checklist';
  $('fcBody').innerHTML = `<div class="wrapchips" style="margin-bottom:12px">${chips}</div>
    ${famEdit ? `<p class="hint" style="margin:0 4px 8px">One document per line. Words after “/” are other names for the same thing (e.g. “Life insurance / LIC”).</p>
      <textarea id="fcText" rows="12">${esc(famList(famWho).join('\n'))}</textarea>
      <div class="btn-row"><button class="btn ghost" id="fcReset">Default list</button><button class="btn brass" id="fcSave">Save list</button></div>`
    : `<div class="group" style="padding:12px 14px;margin-bottom:12px"><b>${esc(famWho)}</b> · ${ok} of ${S.length} with a file<div class="fc-prog"><i style="width:${S.length ? Math.round(ok / S.length * 100) : 0}%"></i></div>
      <div class="hint" style="margin:4px 0 0">✓ entry with a file · … entry but no file yet · ✗ not in Docs</div></div>
      <div class="group">${S.map((x, i) => `<button class="fc-row" data-fi="${i}"><span class="fc-st ${x.st}" aria-label="${x.st === 'ok' ? 'done' : x.st === 'part' ? 'no file' : 'missing'}">${x.st === 'ok' ? '✓' : x.st === 'part' ? '…' : '✗'}</span>
        <span class="row-main"><span class="row-title" style="display:block">${esc(x.item.split('/')[0].trim())}</span><span class="row-sub">${x.doc ? esc(x.doc.title) + (x.st === 'part' ? ' · add the file' : '') : 'Tap to add'}</span></span><span class="chev">›</span></button>`).join('')}</div>
      <div class="btn-row" style="flex-wrap:wrap"><button class="btn ghost small" id="fcEdit">✎ Edit ${esc(famWho)}'s list</button><button class="btn ghost small" id="fcEm">🆘 Emergency sheet</button><button class="btn ghost small" id="fcZip">⤓ ${esc(famWho)}'s documents (.zip)</button></div>`}`;
  $$('[data-fp]', $('fcBody')).forEach(b => b.addEventListener('click', () => { famWho = b.dataset.fp; famEdit = false; openFamily(); }));
  $$('[data-fi]', $('fcBody')).forEach(b => b.addEventListener('click', () => {
    const x = S[+b.dataset.fi]; Sheets.close('shFamily', true); showTab('docs');
    if (x.doc) { x.st === 'ok' ? showDoc(x.doc.id) : openDoc(x.doc.id); return; }
    const d = put({ id: uid('doc'), type: 'doc', title: x.item.split('/')[0].trim(), who: famWho, docType: famType(x.item), number: '', expiry: null, issuer: '', notes: '', folder: '', fy: null, deleted: false });
    openDoc(d.id); toast('Added — attach the photo or PDF, then Save.');
  }));
  const on = (id, f) => { if ($(id)) $(id).addEventListener('click', f); };
  on('fcEdit', () => { famEdit = true; openFamily(); });
  on('fcEm', () => { Sheets.close('shFamily', true); openEmergency(famWho); });
  on('fcZip', () => { Sheets.close('shFamily', true); exportPersonZip(famWho); });
  on('fcReset', () => { $('fcText').value = (FAM_DEFAULT[famWho] || []).join('\n'); });
  on('fcSave', () => {
    const L = [...new Set($('fcText').value.split('\n').map(x => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 60);
    const c = famCfg() || { id: FAM_ID, type: 'famcheck', lists: {} };
    put({ ...c, lists: { ...(c.lists || {}), [famWho]: L }, deleted: false }, { render: false }); famEdit = false; openFamily(); toast(`${famWho}'s list saved.`);
  });
  if (!Sheets.isOpen('shFamily')) Sheets.open('shFamily');
}

