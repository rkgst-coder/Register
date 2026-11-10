/* ==========================================================================
   v2.22 — Notes: a Word-like editor. What you see while writing is the formatted text (bold is bold, lists are
   lists). The note is still saved as the same plain markdown as before, so sync, search, versions, export and
   older devices are unchanged. Settings live in the note's ••• menu (switch back to plain markdown any time).
   ======================================================================== */
const richActive = () => prefs.noteRich !== false && !!$('neRich');
const RICH = { busy: false, hits: [], idx: -1 };
function richFocus() { const r = $('neRich'); if (r && document.activeElement !== r) r.focus(); }
function richSetup() {
  const r = $('neRich'); if (!r) return;
  const on = richActive();
  r.style.display = on ? '' : 'none'; ta().style.display = on ? 'none' : '';
  $('nePrevBtn').classList.toggle('hidden', on);
  if (on) richRender();
  if ($('nmMode')) $('nmMode').querySelector('span').textContent = on ? 'Plain text' : 'Formatted';
}
function richRender() {
  const r = $('neRich'); if (!r) return;
  r.innerHTML = mdToRich(ta().value) || '<div><br></div>';
}
function richSync() {
  if (RICH.busy) return;
  const v = richToMd($('neRich'));
  if (v === ta().value) return;
  ta().value = v; neQueue(); undoOnType(); updateCount();
}

/* ---- markdown → editable HTML (one block per line, so line breaks survive the round trip) ---- */
function mdToRich(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n'), out = [];
  const isList = l => /^(\s*)([-*+]|\d+[.)])\s+/.test(l), isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const inl = t => mdInline(t).replace(/ target="_blank" rel="noopener noreferrer"/g, '');
  let i = 0;
  while (i < L.length) {
    const line = L[i];
    if (/^```/.test(line)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out.push(`<pre>${esc(b.join('\n')) || '<br>'}</pre>`); continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    let m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) { out.push(`<h${m[1].length}>${inl(m[2]) || '<br>'}</h${m[1].length}>`); i++; continue; }
    if (/^>\s?/.test(line)) { const b = []; while (i < L.length && /^>\s?/.test(L[i])) b.push(`<div>${inl(L[i++].replace(/^>\s?/, '')) || '<br>'}</div>`); out.push(`<blockquote>${b.join('')}</blockquote>`); continue; }
    if (line.includes('|') && i + 1 < L.length && isSep(L[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inl(c.trim()) || '<br>');
      const rows = [cells(line)]; i += 2; while (i < L.length && L[i].includes('|') && L[i].trim()) rows.push(cells(L[i++]));
      out.push(`<table><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    if (isList(line)) {
      // build nested lists; a deeper list goes inside the item above it
      const stack = []; let html = '';
      const close = () => { html += `</li></${stack.pop().tag}>`; };
      while (i < L.length && (isList(L[i]) || (/^\s{2,}\S/.test(L[i]) && stack.length))) {
        const lm = L[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!lm) { html += '<br>' + inl(L[i].trim()); i++; continue; }
        const lvl = Math.floor(lm[1].replace(/\t/g, '  ').length / 2), tag = /\d/.test(lm[2]) ? 'ol' : 'ul';
        while (stack.length > lvl + 1) close();
        if (stack.length === lvl + 1 && stack[lvl].tag !== tag) close();
        if (stack.length < lvl + 1) { while (stack.length < lvl + 1) { html += `<${tag}${tag === 'ol' && stack.length === lvl && parseInt(lm[2], 10) > 1 ? ` start="${parseInt(lm[2], 10)}"` : ''}>`; stack.push({ tag }); } }
        else html += '</li>';
        const cb = lm[3].match(/^\[([ xX])\]\s?(.*)$/);
        html += cb ? `<li class="ck" data-ck="${cb[1] === ' ' ? 0 : 1}">${inl(cb[2]) || '<br>'}` : `<li>${inl(lm[3]) || '<br>'}`;
        i++;
      }
      while (stack.length) close();
      out.push(html); continue;
    }
    out.push(`<div>${inl(line) || '<br>'}</div>`); i++;
  }
  return out.join('');
}

/* ---- editable HTML → markdown ---- */
const RICH_BLOCK = /^(DIV|P|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR|SECTION|ARTICLE|HEADER|FOOTER)$/;
function richInline(n) {
  if (n.nodeType === 3) return n.nodeValue.replace(/ /g, ' ').replace(/​/g, '');
  if (n.nodeType !== 1) return '';
  const tag = n.tagName, kids = () => [...n.childNodes].map(richInline).join('');
  if (tag === 'BR') return '\n';
  if (tag === 'IMG' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'TITLE') return '';
  if (tag === 'CODE' && n.parentNode && n.parentNode.tagName !== 'PRE') return '`' + n.textContent.replace(/`/g, "'") + '`';
  const wrap = (mk, inner, mk2) => { const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/); return m[2] ? m[1] + mk + m[2] + (mk2 || mk) + m[3] : inner; };
  if (tag === 'A') { const href = n.getAttribute('href') || '', t = kids(); if (!href || /^tel:/i.test(href) || t.replace(/\s/g, '') === href.replace(/\s/g, '') || !/^(https?:|mailto:)/i.test(href)) return t; return `[${t}](${href})`; }
  const st = n.style || {}, fw = String(st.fontWeight || ''), bg = String(st.backgroundColor || '');
  let inner = kids();
  if (RICH_BLOCK.test(tag)) inner = '\n' + inner;                       // a block inside a line starts a new line
  if (tag === 'B' || tag === 'STRONG' || fw === 'bold' || +fw >= 600) inner = wrap('**', inner);
  if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') inner = wrap('*', inner);
  if (tag === 'U' || /underline/.test(st.textDecoration || st.textDecorationLine || '')) inner = wrap('++', inner);
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(st.textDecoration || st.textDecorationLine || '')) inner = wrap('~~', inner);
  if (tag === 'MARK' || (bg && !/transparent|rgba\(0, 0, 0, 0\)|inherit|initial/.test(bg))) inner = wrap('==', inner);
  return inner;
}
const richKids = el => [...el.childNodes].map(richInline).join('');
function richLines(el) {
  const lines = [];
  let buf = null;                                                        // loose inline content waiting to become a line
  const flush = () => { if (buf != null) { lines.push(...buf.split('\n')); buf = null; } };
  const addInline = t => { buf = (buf == null ? '' : buf) + t; };
  [...el.childNodes].forEach(c => {
    if (c.nodeType === 3 || (c.nodeType === 1 && !RICH_BLOCK.test(c.tagName))) {
      if (c.nodeType === 1 && c.tagName === 'BR') { addInline(''); flush(); return; }
      addInline(richInline(c)); return;
    }
    if (c.nodeType !== 1) return;
    flush();
    const tag = c.tagName;
    if (tag === 'HR') { lines.push('---'); return; }
    if (/^H[1-6]$/.test(tag)) { const lv = Math.min(3, +tag[1]); lines.push('#'.repeat(lv) + ' ' + richKids(c).replace(/\n+/g, ' ').trim()); return; }
    if (tag === 'UL' || tag === 'OL') { lines.push(...richList(c, 0)); return; }
    if (tag === 'BLOCKQUOTE') { richLines(c).forEach(l => lines.push('> ' + l)); return; }
    if (tag === 'PRE') { lines.push('```', ...c.textContent.replace(/\n$/, '').split('\n'), '```'); return; }
    if (tag === 'TABLE') {
      const rows = [...c.querySelectorAll('tr')].map(tr => [...tr.children].map(td => richInline(td).replace(/\n+/g, ' ').replace(/\|/g, '/').trim()));
      if (rows.length) { const w = Math.max(...rows.map(r => r.length)); const fix = r => '| ' + [...r, ...Array(w - r.length).fill('')].join(' | ') + ' |';
        lines.push(fix(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(fix)); }
      return;
    }
    if (tag === 'LI') { lines.push(...richList({ tagName: 'UL', children: [c], getAttribute: () => null }, 0)); return; }
    // DIV / P: a line (or several, if it holds blocks or line breaks)
    if ([...c.children].some(k => RICH_BLOCK.test(k.tagName))) { lines.push(...richLines(c)); return; }
    let t = richKids(c); if (c.lastChild && c.lastChild.nodeType === 1 && c.lastChild.tagName === 'BR') t = t.replace(/\n$/, '');
    lines.push(...t.split('\n'));
  });
  flush();
  return lines;
}
function richList(list, level) {
  const out = [], pad = '  '.repeat(level), ol = list.tagName === 'OL';
  let n = parseInt(list.getAttribute && list.getAttribute('start'), 10) || 1;
  [...list.children].forEach(li => {
    if (li.tagName === 'UL' || li.tagName === 'OL') { out.push(...richList(li, level + 1)); return; }
    if (li.tagName !== 'LI') return;
    const subs = [], text = [...li.childNodes].map(k => { if (k.nodeType === 1 && (k.tagName === 'UL' || k.tagName === 'OL')) { subs.push(k); return ''; } return richInline(k); }).join('').replace(/\n+$/, '');
    const ck = li.classList && li.classList.contains('ck');
    const mk = ol ? `${n++}. ` : ck ? `- [${li.dataset.ck === '1' ? 'x' : ' '}] ` : '- ';
    out.push(pad + mk + text.trim().replace(/\n/g, '\n' + pad + '  '));
    subs.forEach(sl => out.push(...richList(sl, level + 1)));
  });
  return out;
}
function richToMd(root) {
  if (!root) return '';
  const lines = richLines(root);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

/* ---- the block the caret is in ---- */
function richBlock() {
  const r = $('neRich'), sel = getSelection(); if (!sel.rangeCount) return null;
  let n = sel.anchorNode; if (!n || !r.contains(n)) return null;
  while (n && n !== r && !(n.nodeType === 1 && /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|TD)$/.test(n.tagName))) n = n.parentNode;
  return n;
}
function richTextBeforeCaret(block) {
  const sel = getSelection(); if (!sel.rangeCount || !block) return '';
  const rg = document.createRange(); rg.setStart(block, 0); rg.setEnd(sel.anchorNode, sel.anchorOffset);
  return rg.toString();
}
function richDeleteBeforeCaret(block) {
  const sel = getSelection(); const rg = document.createRange(); rg.setStart(block, 0); rg.setEnd(sel.anchorNode, sel.anchorOffset);
  sel.removeAllRanges(); sel.addRange(rg); document.execCommand('delete');
}
function richMakeCheck() {
  const li = richBlock(); if (li && li.tagName === 'LI') { li.className = 'ck'; li.dataset.ck = '0'; }
}
/* "1." / "-" / "[]" / "#" / ">" at the start of a line, then space or Tab → list, checklist, heading or quote (like Word) */
function richAutoFormat(trigger) {
  const b = richBlock(); if (!b) return false;
  const pre = richTextBeforeCaret(b).replace(/ /g, ' ');
  const m = (trigger === 'tab' ? pre + ' ' : pre).match(/^(\d+[.)]|[-*•]|\[ ?\]|#{1,3}|>) $/);
  if (!m) return false;
  const k = m[1], inList = !!b.closest('li');
  if (inList && !/^#|^>/.test(k)) return false;
  richDeleteBeforeCaret(b);
  if (/^\d/.test(k)) document.execCommand('insertOrderedList');
  else if (/^\[/.test(k)) { document.execCommand('insertUnorderedList'); richMakeCheck(); }
  else if (/^[-*•]$/.test(k)) document.execCommand('insertUnorderedList');
  else if (k[0] === '#') document.execCommand('formatBlock', false, 'h' + k.length);
  else if (k === '>') document.execCommand('formatBlock', false, 'blockquote');
  return true;
}
function richToggleBlock(tag) {
  const b = richBlock(), cur = b && b.closest && b.closest(tag);
  document.execCommand('formatBlock', false, cur ? 'div' : tag);
}
function richCmd(k) {
  richFocus();
  const sel = getSelection(), txt = sel.rangeCount ? sel.toString() : '';
  const ex = (c, v) => document.execCommand(c, false, v);
  if (k === 'bold') ex('bold'); else if (k === 'italic') ex('italic'); else if (k === 'underline') ex('underline');
  else if (k === 'strike') ex('strikeThrough');
  else if (k === 'mark') { if (txt) ex('insertHTML', `<mark>${esc(txt)}</mark>`); else toast('Select some text to highlight.'); }
  else if (k === 'code') { if (txt) ex('insertHTML', `<code>${esc(txt)}</code>`); else ex('insertHTML', '<code>code</code>'); }
  else if (k === 'link') { const u = (prompt('Link address', 'https://') || '').trim(); if (/^(https?:|mailto:)/i.test(u) && u.length > 8) { if (txt) ex('createLink', u); else ex('insertHTML', `<a href="${esc(u)}">${esc(u)}</a>`); } }
  else if (k === 'h2') richToggleBlock('h2');
  else if (k === 'h1') richToggleBlock('h1');
  else if (k === 'ul') ex('insertUnorderedList');
  else if (k === 'ol') ex('insertOrderedList');
  else if (k === 'check') { const b = richBlock(); if (b && b.tagName === 'LI' && b.classList.contains('ck')) { b.classList.remove('ck'); delete b.dataset.ck; } else { if (!(b && b.closest('ul'))) ex('insertUnorderedList'); richMakeCheck(); } }
  else if (k === 'quote') richToggleBlock('blockquote');
  else if (k === 'indent') ex('indent'); else if (k === 'outdent') ex('outdent');
  else if (k === 'hr') ex('insertHTML', '<hr><div><br></div>');
  else if (k === 'table') ex('insertHTML', '<table><tbody>' + '<tr><td><br></td><td><br></td><td><br></td></tr>'.repeat(3) + '</tbody></table><div><br></div>');
  else if (k === 'stamp') ex('insertText', stampNow() + ' — ');
  else if (k === 'clear') ex('removeFormat');
  richSync();
}
if ($('neRich')) {
  const r = $('neRich');
  r.addEventListener('input', e => {
    if (e.inputType === 'insertText' && e.data === ' ') richAutoFormat('space');
    if (e.inputType === 'insertParagraph') { const b = richBlock(); if (b && b.tagName === 'LI' && b.classList.contains('ck') && !b.textContent.trim()) b.dataset.ck = '0'; }
    if (!r.firstChild) r.innerHTML = '<div><br></div>';
    richSync();
  });
  r.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (e.key === 'Tab') {
      e.preventDefault();
      if (tblTab(e.shiftKey)) return;                                     // v2.28: next / previous cell; Tab in the last cell adds a row
      if (!e.shiftKey && richAutoFormat('tab')) { richSync(); return; }
      const inList = !!(richBlock() && richBlock().closest('li'));
      if (inList) document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      else if (!e.shiftKey) document.execCommand('insertText', false, '    ');
      richSync(); return;
    }
    if (!mod) return;
    const map = { b: 'bold', i: 'italic', u: 'underline', k: 'link' };
    if (map[k]) { e.preventDefault(); richCmd(map[k]); return; }
    if (e.shiftKey && (k === 'x' || k === '5')) { e.preventDefault(); richCmd('strike'); return; }
    if (e.shiftKey && k === 'h') { e.preventDefault(); richCmd('mark'); return; }
    if (e.shiftKey && (k === '7' || k === '&')) { e.preventDefault(); richCmd('ol'); return; }
    if (e.shiftKey && (k === '8' || k === '*')) { e.preventDefault(); richCmd('ul'); return; }
    if (e.altKey && ['1', '2', '3'].includes(k)) { e.preventDefault(); richToggleBlock('h' + k); richSync(); return; }
    if (k === 'f') { e.preventDefault(); openFind(); return; }
    if (k === 'z') { setTimeout(richSync, 0); }
  });
  // tick a checklist item by tapping its box
  r.addEventListener('click', e => {
    const li = e.target.closest && e.target.closest('li.ck'); if (!li) return;
    if (e.clientX - li.getBoundingClientRect().left < 2) { li.dataset.ck = li.dataset.ck === '1' ? '0' : '1'; richSync(); }
  });
  r.addEventListener('paste', e => {
    const cd = e.clipboardData; if (!cd) return;
    const grid = clipGrid(cd);                                             // v2.30: from Excel / Sheets / a web table → cells
    if (grid) { e.preventDefault(); if (grid.length === 1 && grid[0].length === 1) document.execCommand('insertText', false, grid[0][0]); else tblPasteGrid(grid); return; }
    const files = [...(cd.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addNoteImages(files); return; }
    const html = cd.getData('text/html'), text = cd.getData('text/plain');
    e.preventDefault();
    let mdText = text;
    if (html) { try { const doc = document.implementation.createHTMLDocument(''); doc.body.innerHTML = html; mdText = richToMd(doc.body); } catch (err) { mdText = text; } }
    if (!mdText) return;
    if (!/\n/.test(mdText) && !/[*_~=`#>\[]/.test(mdText)) document.execCommand('insertText', false, mdText);
    else document.execCommand('insertHTML', false, mdToRich(mdText));
    richSync();
  });
  document.addEventListener('selectionchange', () => { if (document.activeElement === r) { const t = getSelection().toString(); const s = wordStats(ta().value); $('neCount').textContent = `${s.words.toLocaleString('en-IN')} words · ${s.chars.toLocaleString('en-IN')} characters · ${s.mins} min read${t ? ` · ${wordStats(t).words} selected` : ''}`; } });
}
/* ---- find & replace inside the formatted editor ---- */
function richTextNodes() { const r = $('neRich'), w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT), L = []; let n, pos = 0; while ((n = w.nextNode())) { L.push({ n, s: pos }); pos += n.nodeValue.length; } return { L, all: L.map(x => x.n.nodeValue).join('') }; }
function richFindRun() {
  const q = $('neFindIn').value.toLowerCase(); RICH.hits = []; RICH.idx = -1;
  if (q) { const { all } = richTextNodes(), v = all.toLowerCase(); let p = v.indexOf(q); while (p >= 0) { RICH.hits.push(p); p = v.indexOf(q, p + Math.max(1, q.length)); } }
  findHits = RICH.hits;
  $('neFindCount').textContent = q ? (RICH.hits.length ? `0/${RICH.hits.length}` : 'none') : '';
}
function richSelectAt(p, len) {
  const { L } = richTextNodes(), at = off => { for (const x of L) if (off <= x.s + x.n.nodeValue.length) return [x.n, off - x.s]; const z = L[L.length - 1]; return [z.n, z.n.nodeValue.length]; };
  const [a, ao] = at(p), [b, bo] = at(p + len), rg = document.createRange(); rg.setStart(a, ao); rg.setEnd(b, bo);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
  (a.parentElement || $('neRich')).scrollIntoView({ block: 'center' });
}
function richFindGo(dir) {
  if (!RICH.hits.length) return;
  RICH.idx = (RICH.idx + dir + RICH.hits.length) % RICH.hits.length;
  richSelectAt(RICH.hits[RICH.idx], $('neFindIn').value.length);
  $('neFindCount').textContent = `${RICH.idx + 1}/${RICH.hits.length}`;
}
function richReplaceOne() {
  const q = $('neFindIn').value; if (!q || !RICH.hits.length) return;
  if (RICH.idx < 0) RICH.idx = 0;
  richFocus(); richSelectAt(RICH.hits[RICH.idx], q.length);
  document.execCommand('insertText', false, $('neReplIn').value); richSync();
  const keep = RICH.idx; richFindRun(); if (RICH.hits.length) { RICH.idx = Math.min(keep, RICH.hits.length) - 1; richFindGo(1); }
}
/* ---- switch between formatted and plain markdown (per device) ---- */
if ($('nmMode')) $('nmMode').addEventListener('click', () => {
  if (richActive()) richSync();
  setPref('noteRich', !richActive()); richSetup();
  toast(richActive() ? 'Formatted editing — bold shows as bold while you write.' : 'Plain text editing — formatting shows as markdown (**bold**).');
});

