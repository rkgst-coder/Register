/* ==========================================================================
   NOTES — board, folders, markdown, Word/Notepad-style editor
   ======================================================================== */
const NOTE_COLORS = ['note-c1', 'note-c2', 'note-c3', 'note-c4', 'note-c5'];
const NOTE_HEX = { 'note-c1': '#FBF9F2', 'note-c2': '#F3E7C9', 'note-c3': '#EFE1E6', 'note-c4': '#DCE7DD', 'note-c5': '#DDE6EF' };
const ncls = c => 'nc' + ((NOTE_COLORS.indexOf(c) + 1) || 1);
let activeFolder = '__all__';
const noteFolder = n => (n.folder || '').trim();
const folderList = () => [...new Set(all('note').map(noteFolder).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/* ---------- markdown (small, safe: everything is escaped first) ---------- */
function mdInline(s) {
  const keep = [];
  const hold = h => { keep.push(h); return '\u0000' + (keep.length - 1) + '\u0000'; };
  s = esc(s).replace(/\u0000/g, '');                       // the NUL is this function's own placeholder marker
  s = s.replace(/`([^`]+)`/g, (m, c) => hold(`<code>${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)\)/g, (m, t, u) => hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`));
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, u => hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`));
  s = s.replace(/(^|[\s(])(\+?\d[\d -]{8,}\d)(?=$|[\s),.])/g, (m, p, n) => !telOk(n) ? m : p + hold(`<a href="tel:${n.replace(/[ -]/g, '')}">${n}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
       .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, '$1<i>$2</i>')
       .replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>').replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
}
function md(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n');
  const out = []; let i = 0;
  const isList = l => /^(\s*)([-*+]|\d+[.)])\s+/.test(l);
  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  while (i < L.length) {
    const line = L[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    let m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) { out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = []; while (i < L.length && /^>\s?/.test(L[i])) buf.push(mdInline(L[i++].replace(/^>\s?/, '')));
      out.push(`<blockquote>${buf.join('<br>')}</blockquote>`); continue;
    }
    if (line.includes('|') && i + 1 < L.length && isTableSep(L[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()));
      const head = cells(line); i += 2; const rows = [];
      while (i < L.length && L[i].includes('|') && L[i].trim()) rows.push(cells(L[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (isList(line)) {
      // nested lists by indentation (2 spaces or a tab = one level)
      const stack = []; let html = '';
      while (i < L.length && (isList(L[i]) || (/^\s{2,}\S/.test(L[i]) && stack.length))) {
        const lm = L[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!lm) { html += '<br>' + mdInline(L[i].trim()); i++; continue; }
        const lvl = Math.floor(lm[1].replace(/\t/g, '  ').length / 2);
        const tag = /\d/.test(lm[2]) ? 'ol' : 'ul';
        while (stack.length > lvl + 1) html += `</li></${stack.pop()}>`;
        if (stack.length === lvl + 1 && stack[lvl] !== tag) html += `</li></${stack.pop()}>`;
        if (stack.length < lvl + 1) { while (stack.length < lvl + 1) { html += `<${tag}${tag === 'ol' && stack.length === lvl ? ` start="${parseInt(lm[2], 10) || 1}"` : ''}>`; stack.push(tag); } }
        else html += '</li>';
        const cb = lm[3].match(/^\[([ xX])\]\s*(.*)$/);
        html += cb ? `<li class="cb" data-ln="${i}" role="checkbox" aria-checked="${cb[1] !== ' '}">${cb[1] !== ' ' ? '☑' : '☐'} ${cb[1] !== ' ' ? `<del>${mdInline(cb[2])}</del>` : mdInline(cb[2])}`
                   : `<li>${mdInline(lm[3])}`;
        i++;
      }
      while (stack.length) html += `</li></${stack.pop()}>`;
      out.push(html); continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < L.length && L[i].trim() && !isList(L[i]) && !/^(#{1,3}\s|>|```)/.test(L[i]) && !/^\s*(-{3,}|\*{3,})\s*$/.test(L[i])
           && !(L[i].includes('|') && i + 1 < L.length && isTableSep(L[i + 1]))) buf.push(mdInline(L[i++]));
    out.push(`<p>${buf.join('<br>')}</p>`);
  }
  return out.join('');
}
const plainText = s => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~=|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*[-+]\s+(\[[ xX]\]\s*)?/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();

/* ---------- duplicates ---------- */
const normText = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function dupGroups() {
  const by = {};
  all('note').forEach(n => { const t = normText((n.title || '') + ' ' + (n.text || '')); if (t.length < 12) return; (by[t.slice(0, 300)] = by[t.slice(0, 300)] || []).push(n); });
  return Object.values(by).filter(g => g.length > 1);
}

/* ---------- board ---------- */
function sortNotes(list, by) {
  const c = [...list];
  if (by === 'pinned') c.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  else if (by === 'recent') c.sort((a, b) => b.updatedAt - a.updatedAt);
  else if (by === 'az') c.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else c.sort((a, b) => b.createdAt - a.createdAt);
  return c;
}
function noteCard(n, dups) {
  const title = (n.title || '').trim();
  const first = title ? '' : (plainText(n.text).split('\n').map(x => x.trim()).find(Boolean) || '').slice(0, 80);   // v2.28: heading only; no heading → its first line
  return `<button class="note-card ${ncls(n.color)} ${n.pinned ? 'pinned' : ''}" data-note="${n.id}" aria-label="Note: ${esc(title || first || 'untitled')}">
    <div class="nt">${title ? esc(title) : `<span class="muted" style="font-style:italic;font-weight:400">${esc(first || 'Untitled')}</span>`}</div>
    <div class="nf">${n.folder && activeFolder === '__all__' ? `<span class="pill">📁 ${esc(n.folder)}</span>` : ''}${(n.imgs || []).length ? `<span>🖼 ${n.imgs.length}</span>` : ''}${(n.docRefs || []).length ? `<span>📎 ${n.docRefs.length}</span>` : ''}${(() => { const all_ = (String(n.text || '').match(/^\s*[-*+] \[[ xX]\]/gm) || []).length, done = (String(n.text || '').match(/^\s*[-*+] \[[xX]\]/gm) || []).length; return all_ ? `<span class="${done === all_ ? 'pos' : ''}">☑ ${done}/${all_}</span>` : ''; })()}${dups.has(n.id) ? '<span class="pill neg">duplicate?</span>' : ''}<span>${timeAgo(n.updatedAt)}</span></div>
  </button>`;
}
function renderNotes() {
  const notes = all('note');
  $('noteSub').textContent = notes.length ? notes.length + '' : '';
  chipGroup($('noteSortChips'), [{ v: 'pinned', l: 'Pinned first' }, { v: 'recent', l: 'Recently edited' }, { v: 'created', l: 'Newest' }, { v: 'az', l: 'A–Z' }],
    prefs.noteSort, v => { setPref('noteSort', v); renderNotes(); });
  const dups = new Set(); dupGroups().forEach(g => g.forEach(n => dups.add(n.id)));
  const area = $('notesArea');
  if (!notes.length) { area.innerHTML = '<div class="empty"><b>No notes yet</b>Tap + and choose Note — or paste something straight in.</div>'; return; }
  let html = '';
  if (activeFolder === '__all__') {
    const fs = folderList();
    if (fs.length) html += `<div class="folders">${fs.map(f => { const inside = notes.filter(n => noteFolder(n) === f);
      return `<button class="folder" data-folder="${esc(f)}"><b>📁 ${esc(f)}</b><span>${inside.length} note${inside.length > 1 ? 's' : ''} · ${timeAgo(Math.max(...inside.map(n => n.updatedAt)))}</span></button>`; }).join('')}</div>`;
    const loose = sortNotes(notes.filter(n => !noteFolder(n)), prefs.noteSort);
    html += loose.length ? `<div class="notes-grid">${loose.map(n => noteCard(n, dups)).join('')}</div>` : '';
  } else {
    const list = sortNotes(notes.filter(n => noteFolder(n) === activeFolder), prefs.noteSort);
    html += `<div class="back-row"><button class="chip" id="folderBack">‹ All notes</button><b style="font-size:16px">📁 ${esc(activeFolder)}</b><span class="muted">${list.length}</span></div>`;
    html += list.length ? `<div class="notes-grid">${list.map(n => noteCard(n, dups)).join('')}</div>` : '<div class="empty">This folder is empty.</div>';
  }
  area.innerHTML = html;
  $$('[data-folder]', area).forEach(b => { if (!window.GHOST) bindHold(b, 'nfold', b.dataset.folder); b.addEventListener('click', () => { if (folderSkip(b)) return; activeFolder = b.dataset.folder; renderNotes(); $('main').scrollTop = 0; }); });
  const back = $('folderBack'); if (back) back.addEventListener('click', () => { activeFolder = '__all__'; renderNotes(); });
  $$('[data-note]', area).forEach(b => { bindHold(b, 'note', b.dataset.note); onTap(b, () => prefs.noteEdit ? openNoteEditor(b.dataset.note) : previewNote(b.dataset.note)); });
  selPaint();
}

/* ---------- preview (read-only, typeset) ---------- */
let viewNoteId = null;
function previewNote(id) {
  const n = records[id]; if (!n) return;
  viewNoteId = id;
  $('nvHead').textContent = n.type === 'snote' ? '🔒 Private note' : (noteFolder(n) || 'Note');
  $('nvMeta').textContent = [n.pinned ? '📌 Pinned' : '', 'Edited ' + timeAgo(n.updatedAt), wordStats(n.text).words + ' words'].filter(Boolean).join(' · ');
  $('nvTitle').textContent = n.title || 'Untitled';
  $('nvBody').innerHTML = (n.text ? md(n.text) : (n.tables || []).length ? '' : '<p class="muted"><i>Empty note — tap Edit to start writing.</i></p>') + (n.type === 'snote' && typeof tbHtml === 'function' ? tbHtml(n) : '');
  if (n.type === 'snote' && typeof tbWire === 'function') tbWire($('nvBody'), n);
  const imgs = (n.imgs || []).map(i => records[i]).filter(b => b && !b.deleted);
  $('nvImgs').innerHTML = imgs.map(b => `<div class="img"><img data-blob="${b.id}" alt="loading"></div>`).join('') +
    `<div class="action-grid" style="width:100%">
      <button data-na="edit"><b>✎</b>Edit</button><button data-na="pin"><b>📌</b>${n.pinned ? 'Unpin' : 'Pin'}</button>
      ${n.type === 'snote' ? '<button data-na="tbl"><b>▦</b>Add table</button>' : ''}<button data-na="share"><b>⤴︎</b>Share</button><button data-na="del" class="danger"><b>🗑</b>Delete</button></div>`;
  hydrateImgs($('nvImgs'));
  $$('img[data-blob]', $('nvImgs')).forEach(im => im.addEventListener('click', () => im.src && openLightbox(im.src)));
  $$('[data-na]', $('nvImgs')).forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.na, nn = records[id];
    if (a === 'edit') { Sheets.close('shNoteView', true); openNoteEditor(id); }
    else if (a === 'pin') { nn.pinned = !nn.pinned; put(nn); previewNote(id); }
    else if (a === 'share') shareNote(nn);
    else if (a === 'tbl') openTable(id, null);
    else if (a === 'del') { Sheets.close('shNoteView', true); deleteNote(id); }
  }));
  // tick checklist items straight from the reading view
  $$('li.cb', $('nvBody')).forEach(li => li.addEventListener('click', () => { toggleCheckLine(id, +li.dataset.ln); previewNote(id); }));
  Sheets.open('shNoteView');
}
$('nvEdit').addEventListener('click', () => { Sheets.close('shNoteView', true); openNoteEditor(viewNoteId); });
function toggleCheckLine(id, ln) {
  const n = records[id]; if (!n) return;
  const lines = (n.text || '').split('\n');
  if (lines[ln] == null) return;
  lines[ln] = lines[ln].replace(/\[([ xX])\]/, (m, c) => c === ' ' ? '[x]' : '[ ]');
  n.text = lines.join('\n'); put(n, { render: false });
}

/* ---------- creation / deletion ---------- */
function newNote(text, title, open, folder) {
  const inFolder = folder != null ? folder : activeFolder !== '__all__' ? activeFolder : '';
  const t = text || '';
  const n = put({ id: uid('n'), type: 'note', title: title != null ? title : (t.split('\n')[0] || '').replace(/^#+\s*/, '').trim().slice(0, 60),
    text: t, color: NOTE_COLORS[Math.floor(Math.random() * 5)], pinned: false, folder: inFolder, docRefs: [], imgs: [], deleted: false });
  if (open !== false) openNoteEditor(n.id);
  return n;
}
function deleteNote(id) {
  const n = records[id]; if (!n) return;
  softDelete(id);
  toast(`Deleted "${(n.title || 'note').slice(0, 26)}"`, 'Undo', () => restore(id));
}

/* ---------- editor ---------- */
let editNoteId = null, neTimer = null, neOriginal = null, nePreview = false;
const ta = () => $('neBody');
function wordStats(text) {
  const t = String(text || '');
  const words = (t.match(/[A-Za-z0-9ऀ-ॿ઀-૿'’-]+/g) || []).length;
  return { words, chars: t.length, mins: Math.max(1, Math.round(words / 200)) };
}
function updateCount() {
  const el = ta(), s = wordStats(el.value);
  const selTxt = el.value.slice(el.selectionStart, el.selectionEnd);
  const sel = selTxt ? ` · ${wordStats(selTxt).words} selected` : '';
  $('neCount').textContent = `${s.words.toLocaleString('en-IN')} words · ${s.chars.toLocaleString('en-IN')} characters · ${s.mins} min read${sel}`;
}
function openNoteEditor(id) {
  const n = records[id]; if (!n) return;
  editNoteId = id; neOriginal = { title: n.title || '', text: n.text || '' }; nePreview = false;
  $('neTitle').value = n.title || '';
  ta().value = n.text || '';
  ta().style.display = ''; $('nePreview').style.display = 'none';
  $('neSaved').textContent = 'Note';
  $('neFind').classList.add('hidden');
  resetUndo(); renderEditorImgs(); updateCount(); neFolderInit(); richSetup();
  Sheets.open('shNote');
  if (!n.text && !n.title) setTimeout(() => $('neTitle').focus(), 350);
}
function neSave() {
  const n = records[editNoteId]; if (!n) return;
  if (n.title === $('neTitle').value && n.text === ta().value) return;
  n.title = $('neTitle').value; n.text = ta().value;
  put(n, { render: false });
  $('neSaved').textContent = 'Saved ✓';
  clearTimeout(neSave.t); neSave.t = setTimeout(() => { $('neSaved').textContent = 'Note'; }, 1200);
}
const neQueue = () => { clearTimeout(neTimer); neTimer = setTimeout(neSave, 400); };
$('neTitle').addEventListener('input', neQueue);
ta().addEventListener('input', () => { neQueue(); undoOnType(); updateCount(); });
document.addEventListener('selectionchange', () => { if (document.activeElement === ta()) updateCount(); });
Sheets.onClose.shNote = async () => {
  Dictate.stop(); { const nf = $('neFolderNew'); if (!nf.classList.contains('hidden') && nf.value.trim()) nf.blur(); }
  clearTimeout(neTimer); neSave();
  const n = records[editNoteId];
  if (n && n.type !== 'snote' && neOriginal && (neOriginal.text !== n.text || neOriginal.title !== n.title) && (neOriginal.text || neOriginal.title)) await saveVersion(n.id, neOriginal);
  if (n && !n.title.trim() && !n.text.trim() && !(n.imgs || []).length) { softDelete(n.id, { render: false }); RLOG.info('discarded empty note'); }
  scheduleRender();
};

/* paste pictures straight into the body */
ta().addEventListener('paste', e => {
  const grid = e.clipboardData && clipGrid(e.clipboardData);
  if (grid && !(grid.length === 1 && grid[0].length === 1)) { e.preventDefault(); insertText('\n' + gridToMd(grid) + '\n'); return; }   // v2.30
  const files = [...(e.clipboardData && e.clipboardData.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); addNoteImages(files); }
});

/* ---- undo / redo (own history, so toolbar actions are undoable too) ---- */
let undoStack = [], redoStack = [], undoPrev = '', undoT = null;
function resetUndo() { undoStack = []; redoStack = []; undoPrev = ta().value; clearTimeout(undoT); }
function undoPush(v) { undoStack.push(v); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
function undoCommit() { clearTimeout(undoT); const v = ta().value; if (v !== undoPrev) { undoPush(undoPrev); undoPrev = v; } }
function undoOnType() { clearTimeout(undoT); undoT = setTimeout(undoCommit, 600); }
function setBody(v, selStart, selEnd) {
  ta().value = v; undoPrev = v; if (richActive()) richRender();
  if (selStart != null) ta().setSelectionRange(selStart, selEnd != null ? selEnd : selStart);
  neQueue(); updateCount();
}
$('neUndo').addEventListener('click', () => { if (richActive()) { richFocus(); document.execCommand('undo'); richSync(); return; } undoCommit(); if (!undoStack.length) return toast('Nothing to undo.'); redoStack.push(ta().value); const p = undoStack.pop(); setBody(p, p.length); });
$('neRedo').addEventListener('click', () => { if (richActive()) { richFocus(); document.execCommand('redo'); richSync(); return; } if (!redoStack.length) return toast('Nothing to redo.'); undoStack.push(ta().value); const n = redoStack.pop(); setBody(n, n.length); });

/* ---- formatting toolbar (keeps focus + selection in the textarea) ---- */
$$('#neBar button').forEach(b => {
  let x0 = 0, y0 = 0;
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  // a tap (not a scroll of the toolbar) acts without stealing the keyboard/selection from the text
  b.addEventListener('touchend', e => { const t = e.changedTouches[0]; if (Math.abs(t.clientX - x0) < 10 && Math.abs(t.clientY - y0) < 10) { e.preventDefault(); b.click(); } });
});
function lineBounds(v, s, e) { const a = v.lastIndexOf('\n', s - 1) + 1; let b = v.indexOf('\n', e); if (b < 0) b = v.length; return [a, b]; }
function wrapSel(before, after, placeholder) {
  undoCommit();
  const el = ta(), v = el.value, s = el.selectionStart, e = el.selectionEnd, sel = v.slice(s, e) || placeholder || 'text';
  const nv = v.slice(0, s) + before + sel + after + v.slice(e);
  undoPush(v); setBody(nv, s + before.length, s + before.length + sel.length);
}
function prefixLines(fn) {
  undoCommit();
  const el = ta(), v = el.value, [a, b] = lineBounds(v, el.selectionStart, el.selectionEnd);
  const lines = v.slice(a, b).split('\n').map(fn);
  const block = lines.join('\n');
  undoPush(v); setBody(v.slice(0, a) + block + v.slice(b), a, a + block.length);
}
function insertText(txt) {
  undoCommit();
  const el = ta(), v = el.value, s = el.selectionStart, e = el.selectionEnd;
  undoPush(v); setBody(v.slice(0, s) + txt + v.slice(e), s + txt.length);
}
const stampNow = () => new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
$$('#neBar [data-md]').forEach(b => b.addEventListener('click', () => {
  if (nePreview) togglePreview();
  const k = b.dataset.md;
  if (richActive()) { if (k === 'table' && tblCell(true)) { tblMenu(b); return; } richCmd(k); return; }
  if (k === 'bold') wrapSel('**', '**'); else if (k === 'italic') wrapSel('*', '*'); else if (k === 'underline') wrapSel('++', '++');
  else if (k === 'strike') wrapSel('~~', '~~'); else if (k === 'mark') wrapSel('==', '==');
  else if (k === 'code') wrapSel('`', '`'); else if (k === 'link') wrapSel('[', '](https://)', 'link text');
  else if (k === 'h2') prefixLines(l => l.startsWith('## ') ? l.slice(3) : '## ' + l.replace(/^#+\s*/, ''));
  else if (k === 'ul') prefixLines(l => /^\s*[-*+] /.test(l) ? l.replace(/^(\s*)[-*+] /, '$1') : '- ' + l);
  else if (k === 'ol') { let n = 0; prefixLines(l => /^\s*\d+[.)] /.test(l) ? l.replace(/^(\s*)\d+[.)] /, '$1') : (++n) + '. ' + l); }
  else if (k === 'check') prefixLines(l => /^\s*[-*+] \[[ xX]\] /.test(l) ? l.replace(/^(\s*)[-*+] \[[ xX]\] /, '$1') : '- [ ] ' + l.replace(/^\s*[-*+] /, ''));
  else if (k === 'quote') prefixLines(l => l.startsWith('> ') ? l.slice(2) : '> ' + l);
  else if (k === 'indent') prefixLines(l => '  ' + l);
  else if (k === 'outdent') prefixLines(l => l.replace(/^( {1,2}|\t)/, ''));
  else if (k === 'hr') insertText('\n---\n');
  else if (k === 'table') insertText('\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n');
  else if (k === 'stamp') insertText(stampNow() + ' — ');
}));

/* ---- lists carry on when you press Return (like Word) ---- */
ta().addEventListener('beforeinput', e => {
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  const el = ta(), v = el.value, s = el.selectionStart;
  if (s !== el.selectionEnd) return;
  const a = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(a, s);
  const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )(.*)$/);
  if (!m) return;
  e.preventDefault();
  undoCommit(); undoPush(v);
  if (!m[5].trim()) {                                    // empty item → end the list
    setBody(v.slice(0, a) + v.slice(s), a);
    return;
  }
  let marker = m[2];
  if (m[3]) marker = (parseInt(m[3], 10) + 1) + m[4] + ' ';
  else if (/\[[ xX]\]/.test(marker)) marker = marker[0] + ' [ ] ';
  const ins = '\n' + m[1] + marker;
  setBody(v.slice(0, s) + ins + v.slice(s), s + ins.length);
});
/* hardware-keyboard shortcuts (iPad / Magic Keyboard) */
ta().addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); prefixLines(l => e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l); return; }
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); wrapSel('**', '**'); } else if (k === 'i') { e.preventDefault(); wrapSel('*', '*'); }
  else if (k === 'f') { e.preventDefault(); openFind(); }
  else if (k === 'z') { e.preventDefault(); $(e.shiftKey ? 'neRedo' : 'neUndo').click(); }
});

/* ---- preview toggle ---- */
function togglePreview() {
  nePreview = !nePreview;
  if (nePreview) { $('nePreview').innerHTML = md(ta().value); $$('li.cb', $('nePreview')).forEach(li => li.addEventListener('click', () => { const lines = ta().value.split('\n'); const ln = +li.dataset.ln; lines[ln] = lines[ln].replace(/\[([ xX])\]/, (m, c) => c === ' ' ? '[x]' : '[ ]'); setBody(lines.join('\n')); $('nePreview').innerHTML = md(ta().value); togglePreview(); togglePreview(); })); }
  $('nePreview').style.display = nePreview ? '' : 'none'; ta().style.display = nePreview || richActive() ? 'none' : ''; $('neRich').style.display = nePreview || !richActive() ? 'none' : '';
  $('nePrevBtn').textContent = nePreview ? '✎' : '👁';
}
$('nePrevBtn').addEventListener('click', togglePreview);

/* ---- find & replace ---- */
let findHits = [], findIdx = -1;
function openFind() {
  $('neFind').classList.remove('hidden');
  const el = ta(); const sel = el.value.slice(el.selectionStart, el.selectionEnd);
  if (sel && sel.length < 60) $('neFindIn').value = sel;
  $('neFindIn').focus(); runFind();
}
function runFind() {
  if (richActive()) { richFindRun(); return; }
  const q = $('neFindIn').value; findHits = []; findIdx = -1;
  if (q) { const v = ta().value.toLowerCase(), ql = q.toLowerCase(); let p = v.indexOf(ql); while (p >= 0) { findHits.push(p); p = v.indexOf(ql, p + Math.max(1, ql.length)); } }
  $('neFindCount').textContent = q ? (findHits.length ? `0/${findHits.length}` : 'none') : '';
}
function gotoHit(dir) {
  if (richActive()) { richFindGo(dir); return; }
  if (!findHits.length) return;
  findIdx = (findIdx + dir + findHits.length) % findHits.length;
  const p = findHits[findIdx], len = $('neFindIn').value.length, el = ta();
  el.focus(); el.setSelectionRange(p, p + len);
  // bring the match into view inside the textarea
  const before = el.value.slice(0, p).split('\n').length;
  el.scrollTop = Math.max(0, (before - 3) * parseFloat(getComputedStyle(el).lineHeight || 24));
  $('neFindCount').textContent = `${findIdx + 1}/${findHits.length}`;
}
$('neFindBtn').addEventListener('click', () => $('neFind').classList.contains('hidden') ? openFind() : $('neFind').classList.add('hidden'));
$('neFindIn').addEventListener('input', runFind);
$('neFindIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gotoHit(1); } });
$('neFindNext').addEventListener('click', () => gotoHit(1));
$('neFindPrev').addEventListener('click', () => gotoHit(-1));
$('neFindClose').addEventListener('click', () => $('neFind').classList.add('hidden'));
$('neRepl').addEventListener('click', () => {
  if (richActive()) { richReplaceOne(); return; }
  const q = $('neFindIn').value; if (!q || !findHits.length) return;
  if (findIdx < 0) findIdx = 0;
  const p = findHits[findIdx], v = ta().value, r = $('neReplIn').value;
  undoCommit(); undoPush(v); setBody(v.slice(0, p) + r + v.slice(p + q.length), p + r.length);
  runFind(); if (findHits.length) { findIdx = -1; gotoHit(1); }
});
$('neReplAll').addEventListener('click', () => {
  const q = $('neFindIn').value; if (!q || !findHits.length) return;
  const n = findHits.length, v = ta().value;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  undoCommit(); undoPush(v); setBody(v.replace(re, () => $('neReplIn').value));
  runFind(); toast(`Replaced ${n} match${n > 1 ? 'es' : ''}.`, 'Undo', () => $('neUndo').click());
});

/* ---- pictures ---- */
$('neImgBtn').addEventListener('click', () => $('neImgFile').click());
$('neImgFile').addEventListener('change', e => { if (e.target.files.length) addNoteImages([...e.target.files]); e.target.value = ''; });
async function addNoteImages(files) {
  const n = records[editNoteId]; if (!n) return;
  n.imgs = n.imgs || [];
  const ids = n.type === 'snote' ? await storeSecretImages(files, n.imgs.length) : await storeImages(files, n.imgs.length);
  if (ids.length) { n.imgs.push(...ids); put(n, { render: false }); }
  renderEditorImgs();
}
function renderEditorImgs() {
  const n = records[editNoteId]; if (!n) return;
  const imgs = (n.imgs || []).map(i => records[i]).filter(b => b && !b.deleted);
  $('neImgs').innerHTML = imgs.map(b => `<div class="img"><img data-blob="${b.id}" alt="loading"><button data-rm="${b.id}" aria-label="Remove picture">✕</button></div>`).join('');
  $('neImgInfo').textContent = imgs.length ? `${imgs.length}/${IMG_PER_NOTE} pictures${imgs.some(b => b.drive) ? ' · stored in Drive' : ''}` : '';
  hydrateImgs($('neImgs'));
  $$('img[data-blob]', $('neImgs')).forEach(im => im.addEventListener('click', () => im.src && openLightbox(im.src)));
  $$('[data-rm]', $('neImgs')).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.rm, rec = records[id];
    n.imgs = (n.imgs || []).filter(x => x !== id); put(n, { render: false });
    softDelete(id, { render: false });
    renderEditorImgs();
    toast('Picture removed', 'Undo', () => { restore(id); n.imgs.push(id); put(n, { render: false }); renderEditorImgs(); });
    if (rec && rec.drive) setTimeout(() => { if (records[id] && records[id].deleted) driveDelete(rec.fileId); }, 7000);
  }));
}

/* ---- options sheet ---- */
$('neMore').addEventListener('click', () => {
  const n = records[editNoteId]; if (!n) return;
  neSave();
  $('nmFolder').value = n.folder || '';
  $('folderDl').innerHTML = folderList().map(f => `<option value="${esc(f)}">`).join('');
  $('nmSwatches').innerHTML = NOTE_COLORS.map(c => `<button class="swatch ${n.color === c ? 'on' : ''}" data-c="${c}" style="background:${NOTE_HEX[c]}" aria-label="Colour ${c.slice(-1)}"></button>`).join('');
  $$('[data-c]', $('nmSwatches')).forEach(s => s.addEventListener('click', () => { n.color = s.dataset.c; put(n, { render: false }); $$('.swatch', $('nmSwatches')).forEach(x => x.classList.toggle('on', x === s)); }));
  const docs = all('doc');
  $('nmDocs').innerHTML = docs.length ? docs.map(d => `<button class="chip ${(n.docRefs || []).includes(d.id) ? 'on' : ''}" data-doc="${d.id}">📎 ${esc(d.title)}</button>`).join('') : '<span class="hint">No documents yet.</span>';
  $$('[data-doc]', $('nmDocs')).forEach(c => c.addEventListener('click', () => {
    n.docRefs = n.docRefs || []; const id = c.dataset.doc;
    n.docRefs = n.docRefs.includes(id) ? n.docRefs.filter(x => x !== id) : [...n.docRefs, id];
    c.classList.toggle('on'); put(n, { render: false });
  }));
  $('nmPin').querySelector('span').textContent = n.pinned ? 'Unpin' : 'Pin';
  ['nmTask', 'nmVersions', 'nmClone', 'nmDup'].forEach(x => $(x).classList.toggle('hidden', n.type === 'snote'));
  Sheets.open('shNoteMore');
});
$('nmFolder').addEventListener('change', () => { const n = records[editNoteId]; n.folder = $('nmFolder').value.trim(); put(n, { render: false }); });
$('nmPin').addEventListener('click', () => { const n = records[editNoteId]; n.pinned = !n.pinned; put(n, { render: false }); $('nmPin').querySelector('span').textContent = n.pinned ? 'Unpin' : 'Pin'; toast(n.pinned ? 'Pinned.' : 'Unpinned.'); });
$('nmCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(ta().value); toast('Copied to clipboard.'); } catch (e) { toast('Could not copy — select the text instead.'); } });
$('nmShare').addEventListener('click', () => shareNote(records[editNoteId]));
$('nmExport').addEventListener('click', async () => { const n = records[editNoteId]; shareOrDownload(await noteMarkdown(n), safeName(n) + '.md', 'text/markdown'); });
$('nmTxt').addEventListener('click', () => { const n = records[editNoteId]; shareOrDownload((n.title ? n.title + '\n\n' : '') + plainText(n.text) + '\n', safeName(n) + '.txt', 'text/plain'); });
$('nmPrint').addEventListener('click', () => printNote(records[editNoteId]));
$('nmTask').addEventListener('click', () => {
  const n = records[editNoteId]; const title = (n.title || n.text || '').split('\n')[0].trim().slice(0, 90) || 'Follow up on note';
  const g = classify(title);
  const t = newTask({ title, category: g.category, priority: g.priority, notes: 'From note: ' + (n.title || '') + '\n\n' + (n.text || '').slice(0, 500), linkedNote: n.id });
  Sheets.closeAll(); showTab('tasks'); openTaskEditor(t.id);
});
$('nmClone').addEventListener('click', () => {
  const n = records[editNoteId];
  Sheets.close('shNoteMore', true); Sheets.close('shNote');
  const c = newNote(n.text, (n.title || 'Untitled') + ' (copy)', false);
  c.folder = n.folder; c.color = n.color; put(c, { render: false });
  openNoteEditor(c.id); toast('Duplicated.');
});
$('nmDelete').addEventListener('click', () => { const id = editNoteId; Sheets.close('shNoteMore', true); Sheets.close('shNote', true); deleteNote(id); });
$('nmDup').addEventListener('click', openDuplicates);
$('nmVersions').addEventListener('click', openVersions);

const safeName = n => ((n.title || 'note').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'note');
async function noteMarkdown(n) {
  let out = '# ' + (n.title || 'Untitled note') + '\n\n';
  if (n.folder) out += '_Folder: ' + n.folder + '_\n\n';
  out += (n.text || '') + '\n\n---\n_Exported ' + new Date().toLocaleString('en-IN') + ' from Register_\n';
  return out;
}
async function shareNote(n) {
  const text = (n.title ? n.title + '\n\n' : '') + (n.text || '');
  try { if (navigator.share) { await navigator.share({ title: n.title || 'Note', text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Copied — paste it anywhere.'); } catch (e) { toast('Sharing is not available here.'); }
}
async function printNote(n) {
  const imgs = (n.imgs || []).map(i => records[i]).filter(b => b && !b.deleted);
  const srcs = []; for (const b of imgs) { try { srcs.push(await imgSrc(b)); } catch (e) {} }
  $('printArea').innerHTML = `<div style="font-family:Georgia,serif;padding:10px"><h1>${esc(n.title || 'Untitled note')}</h1>${n.folder ? `<p style="color:#666"><i>${esc(n.folder)}</i></p>` : ''}
    <div class="md">${md(n.text || '')}</div>${srcs.map(s => `<img src="${s}" style="max-width:100%;margin:10px 0">`).join('')}
    <hr><p style="color:#666;font-size:12px">Printed ${new Date().toLocaleString('en-IN')}</p></div>`;
  setTimeout(() => window.print(), 100);     // iPhone: print sheet → pinch out → Save to Files as PDF
}

/* ---- version history (kept on this device) ---- */
async function saveVersion(id, v) {
  try {
    const key = 'ver:' + id, list = (await DB.get(key)) || [];
    if (list.length && list[0].text === v.text && list[0].title === v.title) return;
    list.unshift({ at: nowMs(), title: v.title, text: v.text });
    await DB.set(key, list.slice(0, 10));
  } catch (e) { RLOG.warn('version save failed', e); }
}
async function openVersions() {
  const n = records[editNoteId]; neSave();
  const list = (await DB.get('ver:' + n.id)) || [];
  $('verList').innerHTML = list.length ? list.map((v, i) => `<div class="ver"><div class="d"><b>${new Date(v.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>
      <div>${esc((v.title || 'Untitled') + ' — ' + plainText(v.text).slice(0, 80))}</div><div>${wordStats(v.text).words} words</div></div>
      <button class="btn small ghost" data-vv="${i}">View</button><button class="btn small" data-vr="${i}">Restore</button></div>`).join('')
    : '<div class="empty">No earlier versions yet. A version is saved each time you close a note after changing it.</div>';
  $$('[data-vr]', $('verList')).forEach(b => b.addEventListener('click', async () => {
    const v = list[+b.dataset.vr];
    await saveVersion(n.id, { title: n.title, text: n.text });
    n.title = v.title; n.text = v.text; put(n, { render: false });
    $('neTitle').value = n.title; undoCommit(); undoPush(ta().value); setBody(n.text);
    neOriginal = { title: n.title, text: n.text };
    Sheets.close('shVersions', true); Sheets.close('shNoteMore', true);
    toast('Version restored. The previous text was kept as a version.');
  }));
  $$('[data-vv]', $('verList')).forEach(b => b.addEventListener('click', () => {
    const v = list[+b.dataset.vv];
    $('nvHead').textContent = 'Earlier version'; $('nvMeta').textContent = new Date(v.at).toLocaleString('en-IN');
    $('nvTitle').textContent = v.title || 'Untitled'; $('nvBody').innerHTML = md(v.text); $('nvImgs').innerHTML = '';
    viewNoteId = n.id; Sheets.open('shNoteView');
  }));
  Sheets.open('shVersions');
}

/* ---- duplicates ---- */
function openDuplicates() {
  const groups = dupGroups();
  $('dupBody').innerHTML = groups.length ? groups.map((g, i) => `<div class="group-title">Group ${i + 1} · ${g.length} similar</div><div class="group">${g.map(n => `
    <div class="row"><div class="row-main"><div class="row-title">${esc(n.title || 'Untitled')}</div><div class="row-sub">edited ${timeAgo(n.updatedAt)}${n.folder ? ' · ' + esc(n.folder) : ''}</div></div>
    <div class="row-end"><button class="btn small ghost" data-do="${n.id}">Open</button><button class="btn small danger" data-dd="${n.id}">Delete</button></div></div>`).join('')}</div>`).join('')
    : '<div class="empty"><b>No duplicates</b>Nothing looks repeated.</div>';
  $$('[data-do]', $('dupBody')).forEach(b => b.addEventListener('click', () => { Sheets.closeAll(); previewNote(b.dataset.do); }));
  $$('[data-dd]', $('dupBody')).forEach(b => b.addEventListener('click', () => { deleteNote(b.dataset.dd); openDuplicates(); }));
  Sheets.open('shDup');
}

