/* ==========================================================================
   v2.30 — paste a grid (Excel, Google Sheets, Numbers, a web page table)
   into a note: inside a table it fills the cells from the one you are in
   (adding rows and columns as needed); elsewhere it becomes a new table.
   Excel also puts a picture of the cells on the clipboard — the cells win.
   ======================================================================== */
function tsvParse(text) {
  const rows = [], t = String(text).replace(/\r\n?/g, '\n');
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"' && cell === '') { q = true; continue; }
    if (ch === '\t') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every(c => !c.trim())) rows.pop();
  return rows.map(r => r.map(c => c.replace(/\s*\n\s*/g, ' ').trim()));
}
function clipGrid(cd) {
  const html = cd.getData('text/html') || '', text = cd.getData('text/plain') || '';
  if (/<table/i.test(html)) {
    try {
      const doc = document.implementation.createHTMLDocument(''); doc.body.innerHTML = html;
      doc.querySelectorAll('style,script,meta,title,link').forEach(x => x.remove());
      const t = doc.querySelector('table');
      const all_ = doc.body.textContent.replace(/\s+/g, ''), inT = t.textContent.replace(/\s+/g, '');
      if (inT.length < all_.length * 0.9) return null;                    // a table with writing around it (Word, a web page): pasted as before
      const rows = [...t.querySelectorAll('tr')].map(tr => [...tr.children].filter(c => /^T[DH]$/.test(c.tagName)).map(c => c.textContent.replace(/\s+/g, ' ').trim()));
      const g = rows.filter(r => r.length);
      if (g.length) return g;
    } catch (e) { RLOG.warn('paste table', e.message); }
  }
  if (/\t/.test(text) || (/\n./.test(text.trim()) && /<table/i.test(html))) { const g = tsvParse(text); if (g.length) return g; }
  return null;
}
const gridToMd = g => { const w = Math.max(...g.map(r => r.length)), fix = r => '| ' + [...r, ...Array(w - r.length).fill('')].map(c => String(c).replace(/\|/g, '/')).join(' | ') + ' |';
  return [fix(g[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...g.slice(1).map(fix)].join('\n'); };
function tblPasteGrid(g) {
  const r = $('neRich'), td = tblCell(false), cellHtml = v => esc(v) || '<br>';
  if (!td) {                                                               // a new table at the caret
    const w = Math.max(...g.map(x => x.length));
    document.execCommand('insertHTML', false, `<table><tbody>${g.map(row => `<tr>${Array.from({ length: w }, (_, i) => `<td>${cellHtml(row[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table><div><br></div>`);
    richSync(); toast(`Pasted as a table — ${g.length} row${g.length > 1 ? 's' : ''} × ${w} column${w > 1 ? 's' : ''}.`); return;
  }
  const table = td.closest('table'), rows0 = [...table.querySelectorAll('tr')], ri = rows0.indexOf(td.parentNode), ci = [...td.parentNode.children].indexOf(td);
  const t = table.cloneNode(true), rows = [...t.querySelectorAll('tr')], body = rows[0].parentNode;
  const w0 = Math.max(...rows.map(x => x.children.length)), gw = Math.max(...g.map(x => x.length)), w = Math.max(w0, ci + gw);
  rows.forEach(x => { while (x.children.length < w) { const c = document.createElement('td'); c.innerHTML = '<br>'; x.appendChild(c); } });
  while (rows.length < ri + g.length) { const n = document.createElement('tr'); for (let i = 0; i < w; i++) { const c = document.createElement('td'); c.innerHTML = '<br>'; n.appendChild(c); } body.appendChild(n); rows.push(n); }
  g.forEach((row, a) => row.forEach((v, b) => { rows[ri + a].children[ci + b].innerHTML = cellHtml(v); }));
  t.setAttribute('data-tbnew', '1');
  const sel = getSelection(), rg = document.createRange(); rg.selectNode(table); sel.removeAllRanges(); sel.addRange(rg);
  document.execCommand('insertHTML', false, t.outerHTML);                // one undoable step
  const nt = r.querySelector('table[data-tbnew]');
  if (nt) { nt.removeAttribute('data-tbnew'); const last = nt.querySelectorAll('tr')[ri + g.length - 1]; if (last && last.children[ci + gw - 1]) tblCaret(last.children[ci + gw - 1]); }
  richSync(); tblBarSync();
}
window.addEventListener('resize', () => { const td = TBL.cell; if (td && td.isConnected && !$('neTblBar').classList.contains('hidden')) tblBarPlace(td.closest('table')); });

