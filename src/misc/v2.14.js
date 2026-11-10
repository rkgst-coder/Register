/* ==========================================================================
   v2.14
   ======================================================================== */
/* ---------- 1. a document's due date lives in Dates too ---------- */
const DUE_KINDS = [['expiry', 'Expiry'], ['renewal', 'Renewal'], ['deadline', 'Deadline'], ['lastdate', 'Last date']];
const dueWord = k => ({ expiry: 'expiry', renewal: 'renewal', deadline: 'deadline', lastdate: 'last date' })[k || 'expiry'] || 'expiry';
const dueKindOpts = sel => DUE_KINDS.map(([v, l]) => `<option value="${v}"${v === (sel || 'expiry') ? ' selected' : ''}>${l}</option>`).join('');
function syncDocDate(d) {
  if (!d || d.deleted) return null;
  const x = all('date').find(z => z.docRef === d.id);
  const label = `${d.title} — ${docOwners(d).join(' & ')} — ${dueWord(d.dueKind)}`;
  if (!d.expiry) { if (x && x.when) { x.when = ''; x.needsDetail = true; put(x, { render: false }); } return x || null; }
  if (x) { if (x.when !== d.expiry || x.label !== label) { x.when = d.expiry; x.label = label; delete x.needsDetail; put(x, { render: false }); } return x; }
  return put({ id: uid('d'), type: 'date', label, when: d.expiry, repeat: 'once', cat: 'docexp', docRef: d.id, deleted: false }, { render: false });
}
function syncAllDocDates() {
  const cfg = records[DATE_CFG]; if (window.GHOST || (cfg && cfg.dues214)) return;
  all('doc').filter(d => d.expiry).forEach(syncDocDate);
  put({ ...(cfg || { id: DATE_CFG, type: 'datecfg', hidden: [], custom: [], updatedAt: 1 }), dues214: true, deleted: false }, { render: false, keepTime: true });
}


/* ---------- 3. zoom: pinch, drag, double-tap, wheel, buttons ---------- */
const LB = { s: 1, x: 0, y: 0, pts: new Map(), last: null, moved: false, tapT: 0 };
function lbApply() { $('lbImg').style.transform = `translate(${LB.x}px,${LB.y}px) scale(${LB.s})`; $('lbPct').textContent = Math.round(LB.s * 100) + '%'; }
function lbReset() { LB.s = 1; LB.x = 0; LB.y = 0; lbApply(); }
function lbZoomAt(ns, cx, cy) {
  const im = $('lbImg'), r = im.getBoundingClientRect(), s0 = LB.s;
  ns = Math.max(1, Math.min(8, ns)); if (ns === s0) return;
  const ox = r.left - LB.x, oy = r.top - LB.y;                        // untransformed top-left
  const px = (cx - ox - LB.x) / s0, py = (cy - oy - LB.y) / s0;        // point in image space
  LB.s = ns; LB.x = cx - ox - px * ns; LB.y = cy - oy - py * ns;
  if (ns === 1) { LB.x = 0; LB.y = 0; }
  lbApply();
}
openLightbox = function (src) { $('lbImg').src = src; lbReset(); $('lightbox').classList.remove('hidden'); };
{ const lb = $('lightbox'), im = $('lbImg');
  lb.insertAdjacentHTML('beforeend', '<div id="lbTools"><button id="lbOut" aria-label="Zoom out">−</button><span id="lbPct">100%</span><button id="lbIn" aria-label="Zoom in">+</button><button id="lbFit" aria-label="Fit to screen">⤢</button></div>');
  const mid = () => { const r = lb.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  $('lbIn').addEventListener('click', e => { e.stopPropagation(); lbZoomAt(LB.s * 1.6, ...mid()); });
  $('lbOut').addEventListener('click', e => { e.stopPropagation(); lbZoomAt(LB.s / 1.6, ...mid()); });
  $('lbFit').addEventListener('click', e => { e.stopPropagation(); lbReset(); });
  lb.addEventListener('wheel', e => { e.preventDefault(); lbZoomAt(LB.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
  lb.addEventListener('pointerdown', e => { if (e.target.closest('#lbTools') || e.target.id === 'lbClose') return; lb.setPointerCapture(e.pointerId); LB.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); LB.moved = false;
    if (LB.pts.size === 2) { const [a, b] = [...LB.pts.values()]; LB.last = { d: Math.hypot(a.x - b.x, a.y - b.y), s: LB.s }; } });
  lb.addEventListener('pointermove', e => {
    const p = LB.pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 3) LB.moved = true;
    p.x = e.clientX; p.y = e.clientY;
    if (LB.pts.size === 2 && LB.last) { const [a, b] = [...LB.pts.values()]; lbZoomAt(LB.last.s * Math.hypot(a.x - b.x, a.y - b.y) / LB.last.d, (a.x + b.x) / 2, (a.y + b.y) / 2); }
    else if (LB.pts.size === 1 && LB.s > 1) { LB.x += dx; LB.y += dy; lbApply(); }
  });
  const up = e => {
    if (!LB.pts.has(e.pointerId)) return; LB.pts.delete(e.pointerId); if (LB.pts.size < 2) LB.last = null;
    if (LB.pts.size || LB.moved || e.target.closest('#lbTools')) return;
    const now = Date.now();
    if (now - LB.tapT < 320) { LB.tapT = 0; LB.s > 1 ? lbReset() : lbZoomAt(2.5, e.clientX, e.clientY); return; }
    LB.tapT = now;
    if (e.target === lb && LB.s === 1) setTimeout(() => { if (LB.tapT === now) $('lbClose').click(); }, 330);
  };
  lb.addEventListener('pointerup', up); lb.addEventListener('pointercancel', e => { LB.pts.delete(e.pointerId); LB.last = null; });
  im.addEventListener('dragstart', e => e.preventDefault()); }
async function zoomPdfPage(doc, n, cv) {
  openLightbox(cv.toDataURL('image/jpeg', .9));
  try { const page = await doc.getPage(n), v1 = page.getViewport({ scale: 1 }), sc = Math.min(4, 2600 / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale: sc });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (!$('lightbox').classList.contains('hidden')) { const s = LB.s, x = LB.x, y = LB.y; $('lbImg').src = c.toDataURL('image/jpeg', .9); LB.s = s; LB.x = x; LB.y = y; lbApply(); } }
  catch (e) { RLOG.warn('pdf zoom', e.message); }
}

/* ---------- 2. Inbox: capture now, sort later ---------- */
const CAP = { files: [] };
function openCapture(text) {
  CAP.files = []; $('capText').value = text || ''; $('capImgs').innerHTML = ''; Sheets.open('shCapture');
  setTimeout(() => $('capText').focus(), 320);
}
function capShowOld() { $('capImgs').innerHTML = CAP.files.map((f, i) => `<img src="${URL.createObjectURL(f)}" alt="photo ${i + 1}">`).join(''); }
$('capCam').addEventListener('click', () => $('capFileCam').click());
$('capLib').addEventListener('click', () => $('capFileLib').click());
$('capPdf').addEventListener('click', () => $('capFilePdf').click());
['capFileCam', 'capFileLib', 'capFilePdf'].forEach(id => $(id).addEventListener('change', e => { CAP.files.push(...e.target.files); e.target.value = ''; capShow(); }));
$('capSave').addEventListener('click', async () => {
  const text = $('capText').value.trim();
  if (!text && !CAP.files.length) { toast('Write a line or add a photo.'); return; }
  const b = $('capSave'); b.disabled = true;
  try {
    const pdfF = CAP.files.filter(f => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name || '')), picF = CAP.files.filter(f => !pdfF.includes(f));
    const imgs = [...(picF.length ? await storeImages(picF, 0) : []), ...(pdfF.length ? await storePdfs(pdfF) : [])];
    if (!imgs.length && !text) return;
    put({ id: uid('ib'), type: 'inbox', text, imgs, deleted: false });
    CAP.files = []; Sheets.close('shCapture', true); toast('Saved to Inbox.', 'Open', openInbox);
  } finally { b.disabled = false; }
});
addMic($('capText'));
const inboxItems = () => all('inbox').sort((a, b) => b.createdAt - a.createdAt);
function renderInboxCard() {
  const box = $('inboxCard'); if (!box) return;
  const n = window.GHOST ? 0 : inboxItems().length;
  box.innerHTML = n ? `<button class="inbox-card" id="inboxGo"><span>📥 <b>Inbox · ${n} to sort</b><br><small class="muted">${esc(inboxItems().slice(0, 2).map(i => i.text ? i.text.split('\n')[0].slice(0, 40) : '📷 photo').join(' · '))}</small></span><b>Sort ›</b></button>` : '';
  if ($('inboxGo')) $('inboxGo').addEventListener('click', openInbox);
}
function openInbox() {
  const L = inboxItems(), fin = finUnlocked();
  $('ibList').innerHTML = L.length ? L.map(i => { const sg = suggestInbox(i); return `<div class="ib-item" data-ib="${i.id}" data-sug="${sg.k}">
      ${i.text ? `<div class="ib-t">${esc(i.text)}</div>` : ''}${(i.imgs || []).length ? `<div class="ib-imgs">${i.imgs.map(ibThumb).join('')}</div>` : ''}
      <div class="ib-m">${timeAgo(i.createdAt)}${i.via ? ' · shared from another app' : ''}</div>${sg.k !== 'money' || fin ? `<div class="ib-sug">Suggested: ${esc(sg.why)}</div>` : ''}
      <div class="ib-acts"><button data-ibto="note">🗒 Note</button><button data-ibto="task">☑︎ Task</button><button data-ibto="doc">📁 Document</button><button data-ibto="date">📅 Date</button>${fin ? '<button data-ibto="money">₹ Spend</button>' : ''}<button data-ibto="del" class="danger">🗑</button></div></div>`; }).join('')
    : '<div class="empty"><b>Inbox is empty</b>Press and hold + → Capture, or tap ＋ Capture above.</div>';
  $$('#ibList [data-ib]').forEach(el => { const b = el.querySelector(`[data-ibto="${el.dataset.sug}"]`); if (b) { b.classList.add('sug'); b.parentElement.prepend(b); } });
  hydrateImgs($('ibList'));
  $$('#ibList img[data-blob]').forEach(im => im.addEventListener('click', () => im.src && openLightbox(im.src)));
  $$('#ibList [data-ibpdf]').forEach(b => b.addEventListener('click', () => openBlobPdf(b.dataset.ibpdf)));
  $$('[data-ibto]').forEach(b => b.addEventListener('click', () => inboxTo(b.closest('[data-ib]').dataset.ib, b.dataset.ibto)));
  if (!Sheets.isOpen('shInbox')) Sheets.open('shInbox');
}
$('ibNew').addEventListener('click', () => openCapture());
function inboxDoneBase(i, keepImgs) {
  if (keepImgs && (i.imgs || []).length) { i.text = ''; put(i, { render: false }); toast('Photos stay in the Inbox — sort them next.'); }
  else softDelete(i.id, { render: false });
  renderInboxCard();
}
async function inboxTo(id, to) {
  const i = records[id]; if (!i) return;
  const text = i.text || '', first = text.split('\n')[0].trim(), all_ = (i.imgs || []).filter(b => records[b] && !records[b].deleted);
  const pdfs = all_.filter(b => isFileBlob(records[b])), imgs = to === 'doc' ? all_ : all_.filter(b => !pdfs.includes(b));
  if (to === 'del') { softDelete(id); setTimeout(() => trashInboxFiles(id), 7500); toast('Deleted — in Recently deleted for 30 days.', 'Undo', () => { restore(id); openInbox(); }); openInbox(); renderInboxCard(); return; }
  Sheets.close('shInbox', true);
  if (to === 'note') {
    const n = newNote(text, first.slice(0, 60) || (imgs.length ? 'Photo' : ''), false, '');
    if (imgs.length) { n.imgs = imgs.slice(0, IMG_PER_NOTE); put(n, { render: false }); }
    inboxDone(i, false, pdfs); showTab('notes'); openNoteEditor(n.id); return;
  }
  if (to === 'task') {
    let noteTxt = text.split('\n').slice(1).join('\n').trim();
    if (imgs.length) { const n = newNote(text, 'Photos — ' + (first || 'task'), false, ''); n.imgs = imgs.slice(0, IMG_PER_NOTE); put(n, { render: false }); noteTxt = (noteTxt ? noteTxt + '\n' : '') + `Photos are in the note "${n.title}".`; }
    const t = newTask({ title: first || 'Task from Inbox', notes: noteTxt });
    inboxDone(i, false, pdfs); showTab('tasks'); openTaskEditor(t.id); return;
  }
  if (to === 'doc') {
    const d = put({ id: uid('doc'), type: 'doc', title: first.slice(0, 60) || ((records[pdfs[0]] || {}).name || '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.pdf$/i, '').slice(0, 60) || 'Document from Inbox', who: '', docType: 'Other', number: '', expiry: null, issuer: '', notes: text.split('\n').slice(1).join('\n'), folder: '', fy: null, deleted: false });
    showTab('docs'); openDoc(d.id);
    if (imgs.length) {
      const files = [], okIds = [];
      for (const b of imgs) { try { const src = await imgSrc(records[b]); const blob = await (await fetch(src)).blob(); files.push(new File([blob], (records[b] && records[b].name) || (isPdfBlob(records[b]) ? 'file.pdf' : 'photo.jpg'), { type: isPdfBlob(records[b]) ? 'application/pdf' : (isFileBlob(records[b]) && DOC_EXT_MIME[extOf(records[b].name)]) || blob.type || 'image/jpeg' })); okIds.push(b); } catch (e) { RLOG.warn('inbox photo', e.message); } }
      const before = docFilesOf(d.id).length;
      if (files.length) await addDocFiles(d.id, files);
      const attached = files.length > 0 && docFilesOf(d.id).length - before >= files.length;
      if (attached) okIds.forEach(b => { if (blobUsedElsewhere(b, i.id)) softDelete(b, { render: false }); else trashBlob(b, 'moved to a document'); });   // the document has its own copy
      const left = imgs.filter(b => !(attached && okIds.includes(b)));
      if (left.length) { i.imgs = left; put(i, { render: false }); toast(`${left.length} photo${left.length > 1 ? 's' : ''} could not be attached — kept in the Inbox.`); return; }
    }
    inboxDone(i, false); toast('Set the type and person, then Save.'); return;
  }
  if (to === 'date') {
    const fd = findDateIn(text), lbl = dateLabelFrom(first, fd) || 'Date from Inbox';
    const dc = guessDateCat({ label: lbl });
    const x = put({ id: uid('d'), type: 'date', label: lbl, when: fd ? fd.iso : '', repeat: YEARLY_CATS.includes(dc) ? 'yearly' : 'once', cat: dc, needsDetail: fd ? undefined : true, deleted: false });
    inboxDone(i, true); showTab('dates'); openDate(x.id); return;
  }
  if (to === 'money') {
    showTab('money'); openAdd('money');
    const m = text.match(/(\d[\d,]*(?:\.\d+)?)/), rest = text.replace(m ? m[1] : '', '').replace(/\s+/g, ' ').trim();
    setTimeout(() => { if (m && $('afAmt')) { $('afAmt').value = m[1].replace(/,/g, ''); $('afAmt').dispatchEvent(new Event('input')); } if ($('afTitle')) { $('afTitle').value = rest.slice(0, 80); $('afTitle').dispatchEvent(new Event('input')); } }, 60);
    inboxDone(i, true); return;
  }
}

/* ---------- 5. crop & straighten (scans, and saved photos / PDFs later) ---------- */
const CR = { page: null, rot: 0, ang: 0, q: null, base: null, work: null, done: null };
function crWorkCanvas() {
  const src = CR.base, r = ((CR.rot % 360) + 360) % 360, a = (r + CR.ang) * Math.PI / 180, W = src.width, H = src.height;
  const cw = Math.round(Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))), ch = Math.round(Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a)));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.translate(cw / 2, ch / 2); x.rotate(a); x.drawImage(src, -W / 2, -H / 2);
  return c;
}
function crDraw() {
  CR.work = crWorkCanvas();
  const cv = $('crCv'), k = Math.min(1, 900 / Math.max(CR.work.width, CR.work.height));
  cv.width = Math.round(CR.work.width * k); cv.height = Math.round(CR.work.height * k); cv.getContext('2d').drawImage(CR.work, 0, 0, cv.width, cv.height);
  const wrap = $('crWrap'), maxH = Math.max(240, window.innerHeight * .55); wrap.style.maxWidth = Math.min(cv.width, maxH * cv.width / cv.height) + 'px';
  crSvg();
}
function crSvg() {
  const svg = $('crSvg'), W = $('crCv').width, H = $('crCv').height, q = CR.q;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  const P = q.map(([u, v]) => [u * W, v * H]), rr = Math.max(10, Math.min(W, H) * .035);
  svg.innerHTML = `<polygon points="${P.map(p => p.join(',')).join(' ')}"/>${P.map((p, i) => `<circle data-cr="${i}" cx="${p[0]}" cy="${p[1]}" r="${rr}"/>`).join('')}`;
}
{ const svg = $('crSvg'); let drag = null;
  svg.addEventListener('pointerdown', e => { const c = e.target.closest('[data-cr]'); if (!c) return; drag = +c.dataset.cr; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (drag == null) return; const r = svg.getBoundingClientRect();
    CR.q[drag] = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; crSvg(); });
  const end = () => { drag = null; }; svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end); }
const CR_FULL = () => [[0, 0], [1, 0], [1, 1], [0, 1]];
function openCrop(page, done) {
  CR.page = page; CR.done = done; CR.base = page.orig || page.src; CR.rot = page.orig ? (page.crop ? page.crop.rot : 0) + (page.rot || 0) : (page.rot || 0);
  CR.ang = page.crop ? page.crop.ang : 0; CR.q = page.crop && !(page.orig && page.rot) ? page.crop.q.map(p => p.slice()) : CR_FULL();   // turned since: corners start from the full page
  $('crAng').value = CR.ang; $('crAngV').textContent = CR.ang + '°';
  Sheets.open('shCrop'); setTimeout(crDraw, 60);
}
$('crAng').addEventListener('input', () => { CR.ang = +$('crAng').value; $('crAngV').textContent = CR.ang + '°'; crDraw(); });
$('crL').addEventListener('click', () => { CR.rot -= 90; CR.q = CR_FULL(); crDraw(); });
$('crR').addEventListener('click', () => { CR.rot += 90; CR.q = CR_FULL(); crDraw(); });
$('crReset').addEventListener('click', () => { CR.rot = 0; CR.ang = 0; $('crAng').value = 0; $('crAngV').textContent = '0°'; CR.q = CR_FULL(); crDraw(); });
$('crAuto').addEventListener('click', () => { const q = findEdges(CR.work); if (q) { CR.q = q; crSvg(); } else toast('Could not find the page edges — drag the corners.'); });
/* rough automatic page finder: the largest bright region against a darker background */
function findEdges(c) {
  const k = Math.min(1, 320 / Math.max(c.width, c.height)), w = Math.max(8, Math.round(c.width * k)), h = Math.max(8, Math.round(c.height * k));
  const t = document.createElement('canvas'); t.width = w; t.height = h; const x = t.getContext('2d'); x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h); let sum = 0;
  for (let i = 0; i < w * h; i++) { g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]; sum += g[i]; }
  const hist = new Uint32Array(256); for (let i = 0; i < w * h; i++) hist[g[i] | 0]++;
  let best = 0, th = sum / (w * h), tot = w * h, sB = 0, wB = 0, all = 0; for (let i = 0; i < 256; i++) all += i * hist[i];
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (all - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = i; } }
  const on = (xx, yy) => g[yy * w + xx] > th;
  let n = 0; const P = [[1e9, null], [-1e9, null], [-1e9, null], [1e9, null]];   // tl: min x+y, tr: max x-y, br: max x+y, bl: min x-y
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (on(xx, yy)) { n++; const s = xx + yy, df = xx - yy;
    if (s < P[0][0]) P[0] = [s, [xx, yy]]; if (df > P[1][0]) P[1] = [df, [xx, yy]]; if (s > P[2][0]) P[2] = [s, [xx, yy]]; if (df < P[3][0]) P[3] = [df, [xx, yy]]; }
  if (n < w * h * .15 || n > w * h * .97 || P.some(p => !p[1])) return null;
  return P.map(p => [p[1][0] / (w - 1), p[1][1] / (h - 1)]);
}
function warpQuad(src, q) {
  const S = q.map(([u, v]) => [u * (src.width - 1), v * (src.height - 1)]), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.round(Math.max(dist(S[0], S[1]), dist(S[3], S[2]))), H = Math.round(Math.max(dist(S[0], S[3]), dist(S[1], S[2])));
  const k = Math.min(1, 2400 / Math.max(W, H)); W = Math.max(2, Math.round(W * k)); H = Math.max(2, Math.round(H * k));
  const [x0, y0] = S[0], [x1, y1] = S[1], [x2, y2] = S[2], [x3, y3] = S[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; }
  else { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0; }
  const sd = src.getContext('2d').getImageData(0, 0, src.width, src.height), sp = sd.data, SW = src.width, SH = src.height;
  const out = document.createElement('canvas'); out.width = W; out.height = H; const ox = out.getContext('2d'), od = ox.createImageData(W, H), op = od.data;
  for (let j = 0; j < H; j++) { const v = j / (H - 1 || 1);
    for (let i = 0; i < W; i++) { const u = i / (W - 1 || 1), z = g * u + h * v + 1, sx = (a * u + b * v + c) / z, sy = (d * u + e * v + f) / z;
      const X = Math.max(0, Math.min(SW - 1.001, sx)), Y = Math.max(0, Math.min(SH - 1.001, sy)), xi = X | 0, yi = Y | 0, fx = X - xi, fy = Y - yi;
      const i00 = (yi * SW + xi) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4, o = (j * W + i) * 4;
      for (let ch = 0; ch < 3; ch++) op[o + ch] = (sp[i00 + ch] * (1 - fx) + sp[i10 + ch] * fx) * (1 - fy) + (sp[i01 + ch] * (1 - fx) + sp[i11 + ch] * fx) * fy;
      op[o + 3] = 255; } }
  ox.putImageData(od, 0, 0); return out;
}
$('crDone').addEventListener('click', async () => {
  const b = $('crDone'); b.disabled = true; await new Promise(r => setTimeout(r, 20));
  try {
    const full = CR.q.every((p, i) => Math.abs(p[0] - CR_FULL()[i][0]) < .002 && Math.abs(p[1] - CR_FULL()[i][1]) < .002);
    const out = full ? CR.work : warpQuad(CR.work, CR.q), pg = CR.page;
    pg.orig = CR.base; pg.crop = { rot: CR.rot, ang: CR.ang, q: CR.q.map(p => p.slice()) }; pg.src = out; pg.rot = 0;
    Sheets.close('shCrop', true); if (CR.done) CR.done();
  } finally { b.disabled = false; }
});
/* edit a saved photo or PDF later: its pages come back into the scanner */
async function editDocFile(fid) {
  const f = records[fid]; if (!f) return;
  const msg = $('doFileMsg'); msg.className = 'msg'; msg.textContent = 'Opening the file…';
  try {
    const { blob } = await docFileBlob(f), pages = [];
    if (isPdf(f)) {
      const lib = await pdfjs(), doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, ...pdfWorkerOpt() }).promise;
      if (doc.numPages > 30) throw new Error('more than 30 pages — too many to edit here');
      for (let n = 1; n <= doc.numPages; n++) { const p = await doc.getPage(n), v1 = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: Math.min(3, 2000 / Math.max(v1.width, v1.height)) });
        const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: x, viewport: vp }).promise; pages.push({ src: c, rot: 0 }); }
      try { doc.destroy(); } catch (e) {}
    } else {
      const url = URL.createObjectURL(blob), img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('not a picture')); i.src = url; });
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); pages.push({ src: c, rot: 0 });
    }
    msg.textContent = '';
    Scan.openEdit(f, pages);
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'Could not open it for editing: ' + (e.code === 'LOCKED' ? 'it is locked — unlock first' : e.message); }
}
Scan.openEdit = function (f, pages) {
  this.open(f.docId); this.replace = f; this.mode = 'orig'; this.pages = pages;
  chipGroup($('scMode'), [{ v: 'doc', l: 'Document' }, { v: 'bw', l: 'Black & white' }, { v: 'orig', l: 'Original' }], 'orig', v => { this.mode = v; this.render(); });
  this.render(); $('scMsg').className = 'msg'; $('scMsg').textContent = `Editing "${f.name}". Saving replaces it (the old file goes to Drive's Trash).`;
};

