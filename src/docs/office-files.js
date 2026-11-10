/* ==========================================================================
   v2.24 — Excel, Word and text files in Documents: preview + words for search
   Excel / CSV show as a table (the Excel library is already in the app),
   .docx and .txt as text. Every one can be opened in Excel / Word / Numbers /
   Pages through the share sheet, or saved to Files.
   ======================================================================== */
async function xlsxLib() { await loadScript(XLSX_URL); return window.XLSX; }
function xmlText(x) {
  return String(x || '').replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
}
async function docxText(blob) {
  const X = await xlsxLib(), z = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const i = z.FullPaths.findIndex(p => /\/word\/document\.xml$/i.test(p)); if (i < 0) throw new Error('not a .docx file');
  return xmlText(new TextDecoder().decode(z.FileIndex[i].content));
}
async function officeText(f, blob) {
  const k = fileKind(f);
  if (k === 'txt' || k === 'csv') return await blob.text();
  if (k === 'word') return extOf(f.name) === 'doc' ? '' : await docxText(blob);
  if (k === 'xls') { const X = await xlsxLib(), wb = X.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' }); return wb.SheetNames.map(n => n + '\n' + X.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n'); }
  return '';
}
const OFFICE_ROWS = 300, OFFICE_COLS = 40;
async function renderOfficeInto(box, f, blob) {
  const k = fileKind(f), app = { xls: 'Excel / Numbers', csv: 'Excel / Numbers', word: 'Word / Pages', txt: 'Files' }[k] || 'another app';
  const bar = `<div class="dv-acts"><span class="dv-tag">${KIND_TAG[k] || 'FILE'} · ${fmtBytes(blob.size)}</span><button type="button" class="btn ghost small" data-dvopen>↗ Open in ${app}</button><button type="button" class="btn ghost small" data-dvsave>⤓ Save</button></div>`;
  const wire = () => {
    const o = box.querySelector('[data-dvopen]'), sv = box.querySelector('[data-dvsave]');
    if (o) o.addEventListener('click', async () => { const file = new File([blob], f.name, { type: f.mime || blob.type || 'application/octet-stream' });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: f.name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      dl(file, f.name); });
    if (sv) sv.addEventListener('click', () => dl(blob, f.name));
  };
  box.innerHTML = bar + '<div class="dv-wait">Opening…</div>';
  let body = '';
  try {
    if (k === 'txt') { const t = await blob.text(); body = `<pre class="dv-txt">${esc(t.slice(0, 200000))}</pre>${t.length > 200000 ? '<p class="hint">Showing the first part — open it for the rest.</p>' : ''}`; }
    else if (k === 'word') {
      if (extOf(f.name) === 'doc') body = '<div class="dv-wait">An older Word file (.doc) — it cannot be shown here. Tap “Open in Word / Pages”.</div>';
      else { const t = await docxText(blob); body = `<div class="dv-doc">${t.split('\n').filter(x => x.trim()).slice(0, 2000).map(x => `<p>${esc(x)}</p>`).join('') || '<p class="muted">(no text)</p>'}</div><p class="hint">Text only — tables, pictures and formatting show when you open it in Word or Pages.</p>`; }
    } else if (k === 'xls' || k === 'csv') {
      const X = await xlsxLib(), wb = k === 'csv' ? X.read(await blob.text(), { type: 'string', raw: true }) : X.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
      const one = n => { const ws = wb.Sheets[n]; if (!ws || !ws['!ref']) return '<p class="muted">(empty sheet)</p>';
        const r = X.utils.decode_range(ws['!ref']), cut = r.e.r - r.s.r + 1 > OFFICE_ROWS || r.e.c - r.s.c + 1 > OFFICE_COLS;
        const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', range: { s: r.s, e: { r: Math.min(r.e.r, r.s.r + OFFICE_ROWS - 1), c: Math.min(r.e.c, r.s.c + OFFICE_COLS - 1) } } });
        return `<div class="dv-sheet"><table>${rows.map((row, i) => `<tr>${row.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>${cut ? `<p class="hint">Showing the first ${OFFICE_ROWS} rows and ${OFFICE_COLS} columns — open it for everything.</p>` : ''}`; };
      const names = wb.SheetNames;
      body = (names.length > 1 ? `<div class="wrapchips dv-tabs">${names.map((n, i) => `<button type="button" class="chip${i ? '' : ' on'}" data-dvsh="${i}">${esc(n)}</button>`).join('')}</div>` : '') + `<div class="dv-shbox">${one(names[0])}</div>`;
      box.innerHTML = bar + body; wire();
      $$('[data-dvsh]', box).forEach(b => b.addEventListener('click', () => { $$('[data-dvsh]', box).forEach(x => x.classList.toggle('on', x === b)); box.querySelector('.dv-shbox').innerHTML = one(names[+b.dataset.dvsh]); }));
      return;
    }
  } catch (e) { body = `<div class="dv-wait">Could not show it here (${esc(e.message)}). Tap “Open in ${app}”.</div>`; }
  box.innerHTML = bar + body; wire();
}


