/* ==========================================================================
   v2.23 — press and hold on categories / folders (Documents, Dates, Notes)
   ======================================================================== */
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function pickTargetSheet(title, names, label, hint, onGo) {
  planSheet(title, `<p class="hint" style="margin:0 4px 10px">${hint}</p>
    <div class="field"><label>Keep this one</label><select id="mgInto">${names.map(n => `<option value="${esc(n[0])}">${esc(n[1])}</option>`).join('')}</select></div>`,
    () => onGo($('mgInto').value) !== false, label);
}
/* Documents: categories inside a person */
const docsOfGroups = (who, names) => all('doc').filter(d => (!who || docOwners(d).includes(who)) && names.includes(docGroup(d)));
function mergeDocGroups(names, into) {
  const last = DOC_GROUPS.length ? DOC_GROUPS[DOC_GROUPS.length - 1][0] : '';
  const snap = JSON.parse(JSON.stringify(DOC_GROUPS));
  const others = names.filter(n => n !== into), types = new Set([...DOC_GROUPS.filter(g => others.includes(g[0])).flatMap(g => g[1]), ...all('doc').filter(d => others.includes(docGroup(d))).map(d => d.docType).filter(Boolean)]);
  docCfgEdit(c => { const t = c.groups.find(x => x.n === into); if (!t) return;
    c.groups.forEach(g => { if (g !== t) g.t = g.t.filter(x => !types.has(x)); });
    types.forEach(x => { if (!t.t.includes(x)) t.t.push(x); });                 // also the types that only fell into the last one by default
    c.groups = c.groups.filter(g => g === t || g.n === last || !others.includes(g.n)); });
  if (names.includes(docPath.grp)) docPath.grp = into;
  selEnd(); toast(`Merged into "${into}".`, 'Undo', () => docCfgEdit(c => { c.groups = snap.map(g => ({ n: g[0], t: g[1].slice(), i: g[2] })); }), 7000);
}
SEL_ACTS.dgrp = () => {
  const n = Sel.ids.size, who = docPath.who, A = [];
  if (n === 1) A.push({ l: '✎ Rename', fn: ids => { const g = DOC_GROUPS.find(x => x[0] === ids[0]); selEnd(); catNameSheet('Rename category', ids[0], g ? g[2] : '📁', (nm, i) => { renameDocGroup(ids[0], nm); docCfgEdit(c => { const x = c.groups.find(y => y.n === nm); if (x) x.i = i; }); toast('Renamed.'); }); } });
  if (n > 1) A.push({ l: '⇄ Merge', fn: ids => pickTargetSheet(`Merge ${n} categories`, ids.map(x => [x, `${groupIcon(x)} ${x}`]), 'Merge',
    'All their documents go into the one you keep (for everyone — categories are shared by all people). Nothing is deleted.', into => { mergeDocGroups(ids, into); }) });
  A.push({ l: '⇢ Move', fn: ids => { const L = docsOfGroups(who, ids).map(d => d.id); selEnd(); openDocMove(L, `${who ? who + "'s " : ''}${ids.join(', ')}`); } });
  A.push({ l: '🖨 Print', fn: ids => { const L = docsOfGroups(who, ids); selEnd(); printDocsSheet(L, `${who ? who + ' — ' : ''}${ids.join(', ')}`); } });
  A.push({ l: '⤓ Keep', fn: ids => { const L = docsOfGroups(who, ids); selEnd(); keepOffline(L, ids.join(', ')); } });
  A.push({ l: '🗑', danger: true, fn: ids => {
    const last = DOC_GROUPS[DOC_GROUPS.length - 1][0], del = ids.filter(x => x !== last), k = docsOfGroups(null, del).length;
    if (!del.length) { toast(`"${last}" is where everything else goes — it cannot be deleted. Rename it instead.`); return; }
    if (!confirm(`Delete ${del.length === 1 ? `the category "${del[0]}"` : `${del.length} categories`}?${k ? `\n\nTheir ${plural(k, 'document')} stay safe and show under "${last}".` : ''}${del.length < ids.length ? `\n("${last}" stays — it holds everything else.)` : ''}\nRecently deleted keeps them for 30 days.`)) return;
    del.forEach(x => deleteDocGroup(x, true)); selEnd(); toast(`Deleted ${plural(del.length, 'category').replace('categorys', 'categories')} — in Recently deleted for 30 days.`); } });
  return A;
};
/* Documents: people on the first page */
SEL_ACTS.dwho = () => {
  const n = Sel.ids.size, A = [];
  if (n === 1) A.push({ l: '✎ Rename', fn: ids => { selEnd(); planSheet('Rename person', `<div class="field"><label>Name</label><input id="rpName" value="${esc(ids[0])}" maxlength="40" autocomplete="off"></div>`, () => { const v = $('rpName').value.trim(); if (!v) { planMsg('Type a name.', true); return false; } renamePerson(ids[0], v); return true; }, 'Save'); } });
  if (n > 1) A.push({ l: '⇄ Merge', fn: ids => pickTargetSheet(`Merge ${n} people`, ids.map(x => [x, '👤 ' + x]), 'Merge', 'Everyone else’s documents move to the person you keep (e.g. the same person saved under two spellings).', into => { ids.filter(x => x !== into).forEach(x => renamePerson(x, into, true)); selEnd(); toast(`Merged into ${into}.`); }) });
  A.push({ l: '⇢ Move', fn: ids => { const L = all('doc').filter(d => ids.some(p => docOwners(d).includes(p))).map(d => d.id); selEnd(); openDocMove(L, `All documents of ${ids.join(', ')}`); } });
  A.push({ l: '🖨 Print', fn: ids => { const L = all('doc').filter(d => ids.some(p => docOwners(d).includes(p))); selEnd(); printDocsSheet(L, ids.join(', ')); } });
  A.push({ l: '⤓ Keep', fn: ids => { const L = all('doc').filter(d => ids.some(p => docOwners(d).includes(p))); selEnd(); keepOffline(L, ids.join(', ')); } });
  if (n === 1) A.push({ l: '⤓ .zip', fn: ids => { selEnd(); exportPersonZip(ids[0]); } });
  return A;
};
/* Dates: categories */
function mergeDateCats(keys, into) {
  const cats = dateCats(), cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false }, others = keys.filter(k => k !== into);
  all('date').forEach(d => { if (others.includes(dateCat(d))) { d.cat = into; put(d, { render: false }); } });
  cfg.merged = { ...(cfg.merged || {}) }; Object.keys(cfg.merged).forEach(k => { if (others.includes(cfg.merged[k])) cfg.merged[k] = into; });
  others.forEach(k => { cfg.merged[k] = into; if ((cfg.custom || []).some(x => x.k === k)) cfg.custom = cfg.custom.filter(x => x.k !== k); else cfg.hidden = [...new Set([...(cfg.hidden || []), k])]; });
  cfg.hidMig = true; put(cfg); if (others.includes(datePath)) datePath = into;
  const c = cats.find(x => x[0] === into); selEnd(); toast(`Merged into "${c ? c[1] : into}".`);
}
SEL_ACTS.dcat = () => {
  const n = Sel.ids.size, A = [], nm = k => { const c = dateCats().find(x => x[0] === k); return c ? `${c[2]} ${c[1]}` : k; };
  if (n === 1) A.push({ l: '✎ Rename', fn: ids => { selEnd(); renameDateCat(ids[0]); } });
  if (n > 1) A.push({ l: '⇄ Merge', fn: ids => pickTargetSheet(`Merge ${n} categories`, ids.map(k => [k, nm(k)]), 'Merge', 'All their dates move into the one you keep. Nothing is deleted.', into => mergeDateCats(ids, into)) });
  A.push({ l: '🖨 Print', fn: ids => { const L = dateRows(all('date').filter(d => ids.includes(dateCat(d)))); selEnd(); printDatesList(L, ids.map(nm).join(', ')); } });
  A.push({ l: '🗑', danger: true, fn: ids => {
    const k = all('date').filter(d => ids.includes(dateCat(d))).length;
    if (!confirm(`Delete ${ids.length === 1 ? 'this category' : ids.length + ' categories'}${k ? ` and their ${plural(k, 'date')}` : ''}?\n\nThey go to Settings → Recently deleted for 30 days. Restoring a category brings its dates back too.`)) return;
    const bins = ids.map(x => deleteDateCat(x, true)).filter(Boolean); selEnd();
    toast(`Deleted ${ids.length === 1 ? 'the category' : ids.length + ' categories'}.`, 'Undo', () => bins.forEach(b => records[b] && restoreCatbin(records[b])), 7000); } });
  return A;
};
/* Notes: folders */
function setNotesFolder(from, to) { let n = 0; all('note').forEach(x => { if (from.includes(noteFolder(x))) { x.folder = to; put(x, { render: false }); n++; } }); return n; }
SEL_ACTS.nfold = () => {
  const n = Sel.ids.size, A = [];
  if (n === 1) A.push({ l: '✎ Rename', fn: ids => { selEnd(); planSheet('Rename folder', `<div class="field"><label>Name</label><input id="nfName" value="${esc(ids[0])}" maxlength="60" autocomplete="off"></div>`, () => { const v = $('nfName').value.trim().slice(0, 60); if (!v) { planMsg('Type a name.', true); return false; } setNotesFolder(ids, v); if (activeFolder === ids[0]) activeFolder = v; scheduleRender(); toast('Renamed.'); return true; }, 'Save'); } });
  if (n > 1) A.push({ l: '⇄ Merge', fn: ids => pickTargetSheet(`Merge ${n} folders`, ids.map(x => [x, '📁 ' + x]), 'Merge', 'All their notes go into the folder you keep.', into => { setNotesFolder(ids.filter(x => x !== into), into); selEnd(); scheduleRender(); toast(`Merged into ${into}.`); }) });
  A.push({ l: '📤 Unfile', fn: ids => { const before = all('note').filter(x => ids.includes(noteFolder(x))).map(x => [x.id, x.folder]); const k = setNotesFolder(ids, ''); selEnd(); scheduleRender();
    toast(`${plural(k, 'note')} moved out — the folder${ids.length > 1 ? 's are' : ' is'} gone, the notes stay.`, 'Undo', () => { before.forEach(([id, f]) => { const x = records[id]; if (x) { x.folder = f; put(x, { render: false }); } }); scheduleRender(); }, 7000); } });
  return A;
};

/* ---- printing a set of documents (list, with photos of the files if wanted) ---- */
function printDocsSheet(docs, title) {
  if (!docs.length) { toast('No documents there.'); return; }
  const imgN = docs.reduce((s, d) => s + docFilesOf(d.id).filter(f => /^image\//.test(f.mime || '') || /\.(jpe?g|png|webp|heic)$/i.test(f.name || '')).length, 0);
  planSheet('Print ' + plural(docs.length, 'document'), `<p class="hint" style="margin:0 4px 10px">${esc(title)}. On iPhone: Print → pinch out on the preview → Save to Files to keep it as a PDF.</p>
    <label class="switch-row">Show full numbers<input type="checkbox" class="sw" id="prFull"></label>
    ${imgN ? `<label class="switch-row">Include photos of the files (${imgN})<input type="checkbox" class="sw" id="prImg"></label>` : ''}
    <p class="hint">PDF files are listed by name — open the document to print those.${docs.some(d => d.numEnc) && !Fin.key ? ' Locked numbers stay hidden until you unlock.' : ''}</p>`,
    () => { printDocs(docs, title, $('prFull').checked, $('prImg') && $('prImg').checked); return true; }, '🖨 Print');
}
async function printDocs(docs, title, full, pics) {
  docs = docs.slice().sort((a, b) => docOwners(a).join().localeCompare(docOwners(b).join()) || docGroup(a).localeCompare(docGroup(b)) || a.title.localeCompare(b.title));
  const td = 'border:1px solid #999;padding:5px 6px;vertical-align:top;font-size:12px', rows = [];
  for (const d of docs) {
    let num = docNumShown(d);
    if (full) { try { num = (await docNumFull(d)) || num; } catch (e) {} }
    const fs = docFilesOf(d.id);
    rows.push(`<tr><td style="${td}"><b>${esc(d.title)}</b></td><td style="${td}">${esc(docOwners(d).join(' & '))}</td><td style="${td}">${esc(docGroup(d))} · ${esc(d.docType || '')}</td><td style="${td};font-family:monospace">${esc(num || '')}</td><td style="${td}">${d.expiry ? esc(fmtDate(d.expiry, true)) : ''}</td><td style="${td}">${esc(d.issuer || '')}${d.notes ? `<div style="color:#555">${esc(String(d.notes).slice(0, 300))}</div>` : ''}${fs.length ? `<div style="color:#555">📎 ${esc(fs.map(f => f.name).join(', ')).slice(0, 300)}</div>` : ''}</td></tr>`);
  }
  let imgs = '';
  if (pics) {
    jobOpen('Getting the photos'); let i = 0;
    const L = docs.flatMap(d => docFilesOf(d.id).filter(f => /^image\//.test(f.mime || '') || /\.(jpe?g|png|webp|heic)$/i.test(f.name || '')).map(f => ({ f, d })));
    for (const { f, d } of L) {
      if (Job.stop) break;
      jobStep(i, L.length, `Photo ${++i} of ${L.length}`);
      try { const { blob } = await docFileBlob(f); const src = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
        imgs += `<div style="page-break-inside:avoid;margin:12px 0"><p style="font-size:12px;margin:0 0 4px"><b>${esc(d.title)}</b> — ${esc(f.name || '')}</p><img src="${src}" style="max-width:100%;max-height:900px"></div>`; }
      catch (e) { imgs += `<p style="font-size:12px;color:#a00">${esc(d.title)} — ${esc(f.name || '')}: could not load (${esc(e.code === 'LOCKED' ? 'locked' : e.message || 'error')})</p>`; }
    }
    jobDone(Job.stop ? 'Stopped.' : 'Ready to print.', !!Job.stop);
  }
  $('printArea').innerHTML = `<div style="font-family:Georgia,serif;padding:10px"><h1 style="font-size:20px">Documents — ${esc(title)}</h1>
    <table style="border-collapse:collapse;width:100%"><tr>${['Document', 'Belongs to', 'Category · type', 'Number', 'Expiry / due', 'Issuer · notes · files'].map(h => `<th style="${td};background:#eee;text-align:left">${h}</th>`).join('')}</tr>${rows.join('')}</table>
    ${imgs}<hr><p style="color:#666;font-size:11px">Printed ${new Date().toLocaleString('en-IN')} from Register. ${full ? 'Contains full numbers — keep this paper safe.' : ''}</p></div>`;
  setTimeout(() => window.print(), 150);
}
function printDatesList(rows, title) {
  if (!rows.length) { toast('No dates there.'); return; }
  const td = 'border:1px solid #999;padding:5px 6px;font-size:12px';
  $('printArea').innerHTML = `<div style="font-family:Georgia,serif;padding:10px"><h1 style="font-size:20px">Dates — ${esc(title)}</h1>
    <table style="border-collapse:collapse;width:100%"><tr>${['Name', 'Next', 'Repeats', 'Category'].map(h => `<th style="${td};background:#eee;text-align:left">${h}</th>`).join('')}</tr>
    ${rows.map(x => { const c = dateCats().find(k => k[0] === dateCat(x.d)); return `<tr><td style="${td}">${esc(x.d.label)}</td><td style="${td}">${x.d.when ? esc(fmtDate(isoLocal(nextOccurrence(x.d)), true)) : '—'}</td><td style="${td}">${esc(repWord(x.d.repeat) || 'once')}</td><td style="${td}">${c ? esc(c[1]) : ''}</td></tr>`; }).join('')}</table>
    <hr><p style="color:#666;font-size:11px">Printed ${new Date().toLocaleString('en-IN')} from Register.</p></div>`;
  setTimeout(() => window.print(), 120);
}

