/* ==========================================================================
   v2.13
   ======================================================================== */
/* ---------- quick actions: long-press +, and ?go= links (app shortcuts) ---------- */
const QUICK = [['capture', '📥', 'Capture (sort later)'], ['spend', '₹', 'Add spend', true], ['qlog', '#', 'Quick log', false, true], ['note', '🗒', 'New note'], ['task', '☑︎', 'New task'], ['scan', '📷', 'Scan document'], ['date', '📅', 'Key date'], ['ask', '🔍', 'Ask / search']];
let pendingGo = null;
function doQuick(k) {
  Sheets.closeAll();
  if (k === 'spend') { if (finUnlocked()) { showTab('money'); openAdd('money'); } else if (finConfigured()) { pendingGo = 'spend'; openVault(); } else toast('Set up Money first.'); }
  else if (k === 'note') { showTab('notes'); openAdd('note'); }
  else if (k === 'task') { showTab('tasks'); openAdd('task'); }
  else if (k === 'scan') { showTab('docs'); Scan.open(null); }
  else if (k === 'date') { showTab('dates'); openAdd('date'); }
  else if (k === 'ask') openSearch();
  else if (k === 'capture') openCapture();
  else if (k === 'qlog') openAdd('qlog');
}
function openQuick() {
  $('qaGrid').innerHTML = QUICK.filter(q => (!q[3] || finUnlocked()) && (!q[4] || qlReady())).map(([k, i, l]) => `<button data-qa="${k}"><b>${i}</b>${l}</button>`).join('');
  $$('[data-qa]').forEach(b => b.addEventListener('click', () => doQuick(b.dataset.qa)));
  Sheets.open('shQuick');
}
{ const fab = $('fab'); let t = null, long = false;
  const start = () => { long = false; clearTimeout(t); t = setTimeout(() => { long = true; if (navigator.vibrate) navigator.vibrate(15); openQuick(); }, 480); };
  const stop = () => clearTimeout(t);
  fab.addEventListener('touchstart', start, { passive: true }); fab.addEventListener('mousedown', start);
  ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach(e => fab.addEventListener(e, stop));
  fab.addEventListener('contextmenu', e => e.preventDefault());
  fab.addEventListener('click', e => { if (long) { e.stopImmediatePropagation(); e.preventDefault(); long = false; } }, true); }
function handleGo() {
  let g = null; try { g = new URLSearchParams(location.search).get('go'); } catch (e) {}
  if (!g) return;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (document.documentElement.classList.contains('decoy-on')) return;        // never skip the decoy
  if (QUICK.some(q => q[0] === g)) setTimeout(() => doQuick(g), 400);
}

/* ---------- Needs attention (Docs home) ---------- */
const EXP_PHOTO = d => d.docType === 'Photo & Signature';
function attnListsOld() {
  const docs = all('doc'), t = todayISO();
  return [
    ['Inbox to sort', all('inbox')],
    ['Expired', docs.filter(d => d.expiry && d.expiry < t)],
    ['No file attached', docs.filter(d => !docFilesOf(d.id).length)],
    ['ID documents not locked', docs.filter(d => d.docType === 'Identity' && docFilesOf(d.id).length && !d.lockFiles)],
    ['Usually expire, but no expiry date saved', docs.filter(d => !d.expiry && expiryKind(d))],
    ['Dates still to fill in', all('date').filter(d => !d.when && !d.sys)]
  ].filter(x => x[1].length);
}
function renderAttnOld() {
  const box = $('docAttn'); if (!box) return;
  if (docPath.who || window.GHOST) { box.innerHTML = ''; return; }
  const L = attnLists(), n = L.reduce((s, x) => s + x[1].length, 0);
  if (!n) { box.innerHTML = ''; return; }
  const open = box.querySelector('details') && box.querySelector('details').open;
  box.innerHTML = `<details class="attn"${open ? ' open' : ''}><summary>⚠︎ Needs attention (${n})<small class="muted" style="display:block;font-weight:400;font-size:.8125rem;margin-top:2px">${L.map(x => `${x[1].length} ${x[0].toLowerCase()}`).join(' · ')}</small></summary>
    ${L.map(([h, items]) => `<div class="attn-sec"><b>${esc(h)} (${items.length})</b>${items.slice(0, 40).map(x => x.type === 'date'
      ? `<button data-attd="${x.id}">📅 ${esc(x.label)}</button>` : x.type === 'inbox' ? `<button data-attib="1">📥 ${esc(x.text ? x.text.split('\n')[0].slice(0, 60) : 'Photo')}</button>` : `<button data-attn="${x.id}">${esc(x.title)} · ${esc(docOwners(x).join(' & '))}${x.expiry ? ' · ' + fmtDate(x.expiry, true) : ''}</button>`).join('')}${items.length > 40 ? `<small class="muted">…and ${items.length - 40} more</small>` : ''}</div>`).join('')}</details>`;
  $$('[data-attn]', box).forEach(b => b.addEventListener('click', () => openDoc(b.dataset.attn)));
  $$('[data-attd]', box).forEach(b => b.addEventListener('click', () => openDate(b.dataset.attd)));
  $$('[data-attib]', box).forEach(b => b.addEventListener('click', openInbox));
}

/* expiry-type documents (tighter than v2.12: no photos, no bills, no receipts) */
function expiryKind(d) {
  if (EXP_PHOTO(d)) return false;
  const t = String(d.title || '');
  if (/receiv|slip|form|application|bill|receipt|compilation|details|merged|statement/i.test(t)) return false;
  if (/\b(pan|aadha\w*|voter|ration|birth|debit|credit|atm)\b/i.test(t)) return false;
  return /passport|driving licen[cs]e|\bdl\b|insurance|policy|\bpuc\b|\brc\b|rent agreement|agreement|warranty|membership|visa|permit|cghs card|i ?card|id card|inspector card/i.test(t)
    || ['Insurance', 'Vehicle', 'Warranty', 'Membership'].includes(d.docType);
}
function tidySeededExpiry() {
  const cfg = records[DATE_CFG]; if (!cfg || cfg.tidy213) return;
  all('date').forEach(x => { if (x.docRef && !x.when && x.needsDetail) { const d = records[x.docRef]; if (!d || d.deleted || !expiryKind(d)) softDelete(x.id, { render: false }); } });
  put({ ...cfg, tidy213: true }, { render: false, keepTime: true });
}

/* ---------- Money report (PDF, made on the phone) ---------- */
const RP = { kind: 'month' };
function openReport() {
  const cur = todayISO().slice(0, 7), fy = fyOf(todayISO());
  chipGroup($('rpKind'), [{ v: 'month', l: 'Month' }, { v: 'fy', l: 'Financial year' }], RP.kind, v => { RP.kind = v; $('rpMonthW').classList.toggle('hidden', v !== 'month'); $('rpFyW').classList.toggle('hidden', v !== 'fy'); });
  $('rpMonth').value = monthAdd(cur, -1); $('rpMonth').max = cur;
  const ys = [...new Set(all('fin').map(e => (e.date || '').slice(0, 10)).filter(Boolean).map(fyOf).concat(fy))].sort().reverse();
  $('rpFy').innerHTML = ys.map(y => `<option value="${y}">FY ${y}${y === fy ? ' (so far)' : ''}</option>`).join('');
  $('rpMonthW').classList.toggle('hidden', RP.kind !== 'month'); $('rpFyW').classList.toggle('hidden', RP.kind !== 'fy');
  $('rpMsg').textContent = ''; Sheets.open('shReport');
}
function reportData(from, to, label) {
  const inR = e => { const d = (e.date || '').slice(0, 10); return d >= from && d <= to; };
  const F = all('fin').filter(inR), sum = L => L.reduce((s, e) => s + (+e.amount || 0), 0);
  const inc = F.filter(e => e.kind === 'income'), exp = F.filter(e => e.kind === 'expense' && e.category !== 'Investment'), inv = F.filter(e => e.kind === 'expense' && e.category === 'Investment');
  const grp = (L, key) => { const m = {}; L.forEach(e => { const k = key(e) || 'Other'; (m[k] = m[k] || { n: 0, a: 0 }); m[k].n++; m[k].a += +e.amount || 0; }); return Object.entries(m).sort((a, b) => b[1].a - a[1].a); };
  const c = planCfg(), asOf = to > todayISO() ? todayISO() : to;
  let interest = 0;                                                           // worked out from your loans, as on the dashboard
  try { if (c && accts(true).some(a => a.kind === 'loan')) planCompute(c, asOf.slice(0, 7), 'actual').forEach(r => { if (r.ym >= from.slice(0, 7) && r.ym <= to.slice(0, 7)) interest += r.interest || 0; }); } catch (e) { RLOG.warn('report interest', e.message); }
  let bal = null;
  if (c && accts().length && asOf >= monthEnd(monthAdd(c.startMonth, -1))) { const B = balancesOn(c, asOf); bal = { B, rows: accts(true).filter(a => !a.archived || Math.abs(B.accts[a.id] || 0) >= 1).map(a => [a.name, bucketOf(a.kind), B.accts[a.id] || 0]) }; }
  const udh = {}; all('fin').filter(e => isUdh(e) && !e.settled && outstanding(e) > 0).forEach(e => { const k = e.who || '—'; udh[k] = (udh[k] || 0) + (e.kind === 'lent' ? 1 : -1) * outstanding(e); });
  const invT = F.filter(e => e.kind === 'transfer').reduce((s, e) => { const T = acctById(e.to), Fr = acctById(e.acct); return s + (T && isInvest(T.kind) ? +e.amount || 0 : 0) - (Fr && isInvest(Fr.kind) ? +e.amount || 0 : 0); }, 0);   // SIPs moved into funds, as on the dashboard
  return { label, from, to, asOf, interest, inc: sum(inc), exp: sum(exp), inv: sum(inv) + invT, incBy: grp(inc, e => e.category && e.category !== 'Other' ? e.category : e.desc), expBy: grp(exp, e => e.category), top: exp.slice().sort((a, b) => b.amount - a.amount).slice(0, 12), bal, udh: Object.entries(udh).filter(x => Math.abs(x[1]) >= 1), n: F.length };
}
async function makeReportPdf(R) {
  try { await loadScript(PDFLIB_URL); } catch (e) { throw new Error('the PDF tool ' + e.message); }
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create(), F = await pdf.embedFont(StandardFonts.Helvetica), FB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = s => String(s == null ? '' : s).replace(/₹/g, 'Rs ').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  const money = n => clean(rs(n)), W = 595.28, H = 841.89, M = 44, ink = rgb(.1, .12, .15), soft = rgb(.42, .45, .5), line = rgb(.85, .85, .85), brass = rgb(.55, .42, .12);
  let pg = pdf.addPage([W, H]), y = H - M, pageNo = 1;
  const newPage = () => { foot(); pg = pdf.addPage([W, H]); y = H - M; pageNo++; };
  const foot = () => pg.drawText(clean(`Register - money report - ${R.label} - page ${pageNo}`), { x: M, y: 24, size: 8, font: F, color: soft });
  const need = h => { if (y - h < 50) newPage(); };
  const text = (s, x, size, font, color, maxW) => { let t = clean(s); if (maxW) while (t.length > 3 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2); if (maxW && t !== clean(s)) t = t.slice(0, -1) + '...'; pg.drawText(t, { x, y, size, font, color: color || ink }); };
  const right = (s, xr, size, font, color) => { const t = clean(s); pg.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y, size, font, color: color || ink }); };
  const h2 = s => { need(40); y -= 18; text(s, M, 13, FB, brass); y -= 8; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .8, color: brass }); y -= 16; };
  const table = (cols, rows, opt) => {
    const widths = cols.map(c => c[1]), xs = []; let x = M; widths.forEach(w => { xs.push(x); x += w; });
    const drawHead = () => { need(20); cols.forEach((c, i) => c[2] === 'r' ? right(c[0], xs[i] + widths[i] - 4, 9, FB, soft) : text(c[0], xs[i], 9, FB, soft)); y -= 6; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .5, color: line }); y -= 12; };
    drawHead();
    rows.forEach((r, ri) => { if (y < 62) { newPage(); drawHead(); }
      const bold = opt && opt.boldLast && ri === rows.length - 1;
      r.forEach((v, i) => cols[i][2] === 'r' ? right(v, xs[i] + widths[i] - 4, 10, bold ? FB : F) : text(v, xs[i], 10, bold ? FB : F, ink, widths[i] - 8)); y -= 15; });
    y -= 4;
  };
  // heading
  text('Money report', M, 22, FB); y -= 20;
  text(`${R.label}  (${fmtDate(R.from, true)} - ${fmtDate(R.to, true)})`, M, 11, F, soft); y -= 14;
  text(`Made on ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} from ${R.n} Ledger entries. Actual figures only, no estimates.`, M, 9, F, soft); y -= 10;
  h2('Summary');
  table([['', 330], ['Amount', 177, 'r']], [['Income received', money(R.inc)], ['Spending (excluding investments)', money(R.exp)], ...(R.interest >= 1 ? [['Loan interest (worked out from your loans)', money(R.interest)]] : []), ['Put into investments', money(R.inv)], [R.interest >= 1 ? 'Saved (income - spending - loan interest)' : 'Saved (income - spending)', money(R.inc - R.exp - (R.interest || 0))], ['Left after investments', money(R.inc - R.exp - (R.interest || 0) - R.inv)]], { boldLast: false });
  h2('Income');
  table([['Source', 280], ['Entries', 60, 'r'], ['Amount', 167, 'r']], R.incBy.length ? [...R.incBy.map(([k, v]) => [k, String(v.n), money(v.a)]), ['Total', '', money(R.inc)]] : [['No income recorded', '', '']], { boldLast: R.incBy.length > 0 });
  h2('Spending by category');
  table([['Category', 230], ['Entries', 55, 'r'], ['Share', 55, 'r'], ['Amount', 167, 'r']], R.expBy.length ? [...R.expBy.map(([k, v]) => [k, String(v.n), R.exp ? Math.round(v.a * 100 / R.exp) + '%' : '', money(v.a)]), ['Total', '', '', money(R.exp)]] : [['No spending recorded', '', '', '']], { boldLast: R.expBy.length > 0 });
  if (R.top.length) { h2('Biggest spends'); table([['Date', 70], ['What', 250], ['Category', 90], ['Amount', 97, 'r']], R.top.map(e => [fmtDate(e.date, true), e.desc || '-', e.category || '-', money(e.amount)])); }
  if (R.bal) {
    h2(`Balances on ${fmtDate(R.asOf, true)}`);
    const kindW = { bank: 'Bank', cash: 'Cash', invest: 'Investment', card: 'Card', loan: 'Loan' };
    table([['Account', 260], ['Kind', 100], ['Balance', 147, 'r']], [...R.bal.rows.map(([n, k, v]) => [n, kindW[k] || k, (k === 'card' || k === 'loan') && v < 0 ? (k === 'card' ? 'due ' : 'owed ') + money(-v) : money(v)]), ['Money you have (bank + cash + investments + udhaar - card dues)', '', money(R.bal.B.money)]], { boldLast: true });
  }
  if (R.udh.length) { h2('Open udhaar (today)'); table([['Person', 300], ['', 207, 'r']], R.udh.map(([p, v]) => [p, v >= 0 ? 'owes you ' + money(v) : 'you owe ' + money(-v)])); }
  foot();
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
$('rpGo').addEventListener('click', async () => {
  const m = $('rpMsg'); let from, to, label;
  if (RP.kind === 'month') { const ym = $('rpMonth').value; if (!/^\d{4}-\d{2}$/.test(ym)) { m.className = 'msg err'; m.textContent = 'Pick a month.'; return; } from = ym + '-01'; to = monthEnd(ym); label = monthLong(ym); }
  else { const f = $('rpFy').value, s = +f.slice(0, 4); from = s + '-04-01'; to = (s + 1) + '-03-31'; label = 'FY ' + f; }
  m.className = 'msg'; m.textContent = 'Making the PDF…';
  try {
    const R = reportData(from, to, label), blob = await makeReportPdf(R), name = `Money report ${label}.pdf`;
    const file = new File([blob], name, { type: 'application/pdf' });
    m.className = 'msg ok'; m.textContent = `Ready — ${R.n} entries.`;
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    dl(blob, name);
  } catch (e) { RLOG.error('report', e); m.className = 'msg err'; m.textContent = 'Could not make the report: ' + e.message; }
});

/* ---------- Archive old years (to an encrypted file in Drive) ---------- */
const ARCH_ID = 'archive-index';

function archCandidates(fy) {
  const s = +fy.slice(0, 4), from = s + '-04-01', to = (s + 1) + '-03-31', inFy = iso => iso && iso >= from && iso <= to;
  const tasks = all('task').filter(t => t.status === 'done' && inFy(t.completedOn || (t.completedAt ? isoLocal(new Date(t.completedAt)) : '')));
  let fins = [], blocked = 0;
  if (finUnlocked()) {
    const c = planCfg(), start = c ? c.startMonth + '-01' : '9999';
    all('fin').filter(e => inFy((e.date || '').slice(0, 10))).forEach(e => {
      const pays = (e.pays || []).map(p => p.date || '');
      const ok = e.date < start && pays.every(d => d < start) && !(isUdh(e) && !e.settled && outstanding(e) > 0);
      ok ? fins.push(e) : blocked++;
    });
  }
  return { tasks, fins, blocked };
}
function openArchive() {
  const cur = fyOf(todayISO()), s = +cur.slice(0, 4), fys = [];
  for (let y = s - 2; y >= s - 15; y--) fys.push(y + '-' + String((y + 1) % 100).padStart(2, '0'));
  const rows = fys.map(f => ({ f, ...archCandidates(f) })).filter(r => r.tasks.length || r.fins.length || r.blocked);
  const idx = archIndex();
  $('arBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Moves finished tasks${finUnlocked() ? ' and old Ledger entries' : ''} of a whole financial year into one ${finUnlocked() ? 'encrypted ' : ''}file in your Drive folder, so the app stays fast. You can look at or bring back an archive any time. The current and the last FY stay in the app.${finUnlocked() ? ' Ledger entries from before your plan starts are archived; later ones stay, because your balances are worked out from them.' : ' Open Money first to archive old Ledger entries too.'}</p>
    <div class="group-title">Ready to archive</div>
    <div class="group">${rows.length ? rows.map(r => `<div class="chk-row"><div class="row-main"><div class="row-title">FY ${r.f}</div><div class="row-sub"><span>${r.tasks.length} done task${r.tasks.length === 1 ? '' : 's'}</span>${finUnlocked() ? `<span>${r.fins.length} Ledger entr${r.fins.length === 1 ? 'y' : 'ies'}</span>` : ''}${r.blocked ? `<span class="muted">${r.blocked} kept (used by your plan or open udhaar)</span>` : ''}</div></div>
      ${r.tasks.length + r.fins.length ? `<button class="btn small" data-arch="${r.f}">Archive</button>` : ''}</div>`).join('') : '<div class="empty">Nothing old enough to archive yet.</div>'}</div>
    ${idx.length ? `<div class="group-title">Archives in Drive</div><div class="group">${idx.map((a, i) => `<div class="chk-row"><div class="row-main"><div class="row-title">FY ${esc(a.fy)}${a.enc ? ' 🔒' : ''}</div><div class="row-sub"><span>${a.n} items</span><span>${fmtDate(isoLocal(new Date(a.at)), true)}</span></div></div>
      <button class="btn small ghost" data-arv="${i}">View</button><button class="btn small ghost" data-arr="${i}">Bring back</button></div>`).join('')}</div>` : ''}
    <div id="arView"></div>`;
  $$('[data-arch]').forEach(b => b.addEventListener('click', () => archiveFy(b.dataset.arch)));
  $$('[data-arv]').forEach(b => b.addEventListener('click', () => archView(+b.dataset.arv, false)));
  $$('[data-arr]').forEach(b => b.addEventListener('click', () => archView(+b.dataset.arr, true)));
  $('arMsg').textContent = '';
  Sheets.open('shArchive');
}
async function archiveFy(fy) {
  const m = $('arMsg'), C = archCandidates(fy), items = [...C.tasks, ...C.fins];
  if (!items.length) return;
  if (!Sync.on() || !driveOn()) { m.className = 'msg err'; m.textContent = 'Connect the Sheet and the Drive folder first (Settings).'; return; }
  if (!confirm(`Archive FY ${fy}: ${C.tasks.length} done tasks${C.fins.length ? ' and ' + C.fins.length + ' Ledger entries' : ''}?\n\nThey move into one file in your Drive folder and leave the app on every device. You can bring them back from here.`)) return;
  m.className = 'msg'; m.textContent = 'Saving the archive to Drive…';
  try {
    const plain = JSON.stringify({ app: 'register-archive', v: 1, fy, at: Date.now(), items: items.map(r => { const x = { ...r }; delete x._dirty; delete x._tooBig; return x; }) });
    const enc = !!Fin.key, body = enc ? await aesEnc(Fin.key, plain) : plain;
    const data = b64(te.encode(body));
    if (data.length > 30000000) throw new Error('this year is too large for one archive file (about 22 MB at most)');   // v2.19 (B10)
    const d = await Sync.call('driveUpload', { folderId: prefs.driveFolder, name: `Register archive FY ${fy}${enc ? ' (encrypted)' : ''}.json`, mime: 'application/json', data }, 240000);
    if (!d.fileId) throw new Error('Drive did not return a file id');
    const back = await Sync.call('driveGet', { fileId: d.fileId }, 240000);           // read it back before removing anything
    if (!back.data || back.data !== data) throw new Error('the saved archive could not be read back');
    { const at = Date.now(); put({ id: 'arch-' + fy + '-' + at.toString(36), type: 'archent', fy, fileId: d.fileId, n: items.length, enc, at, ...(enc ? { salt: Fin.salt, iters: Fin.iters } : {}), deleted: false }, { render: false }); }
    items.forEach(r => { r.deleted = true; r.deletedAt = 1; r.archived = fy; put(r, { render: false }); });
    Sync.run(); scheduleRender();
    openArchive(); $('arMsg').className = 'msg ok'; $('arMsg').textContent = `Archived ${items.length} items from FY ${fy}.`;
  } catch (e) { RLOG.error('archive', e); m.className = 'msg err'; m.textContent = 'Nothing was removed. ' + (e.message || e); }
}
async function archView(i, restoreIt) {
  const a = archIndex()[i], box = $('arView'), m = $('arMsg'); if (!a) return;
  if (a.enc && !Fin.key) { m.className = 'msg err'; m.textContent = 'This archive is encrypted — open Money first.'; return; }
  m.className = 'msg'; m.textContent = 'Reading the archive from Drive…';
  try {
    const d = await Sync.call('driveGet', { fileId: a.fileId }, 240000); if (!d.data) throw new Error('empty file');
    let txt = td.decode(unb64(d.data));
    if (a.enc) {
      let key = Fin.key;
      if (a.salt && a.salt !== Fin.salt) {
        const old = prompt(`FY ${a.fy} was archived under your previous private code. Enter that code to open it:`);
        if (!old) { m.textContent = ''; return; }
        key = await deriveFinKey(old, a.salt, a.iters || FIN_ITERS);
      }
      try { txt = await aesDec(key, txt); } catch (e) { throw new Error(a.salt && a.salt !== Fin.salt ? 'that is not the code this archive was saved with' : 'it was saved under a different private code'); }
    }
    const A = JSON.parse(txt), items = A.items || [];
    if (restoreIt) {
      if (!confirm(`Bring back ${items.length} items from FY ${a.fy}?`)) { m.textContent = ''; return; }
      items.forEach(r => { const x = { ...r, deleted: false }; delete x.deletedAt; delete x.archived; put(x, { render: false }); });
      archForget(a);
      scheduleRender(); openArchive(); $('arMsg').className = 'msg ok'; $('arMsg').textContent = `Brought back ${items.length} items. The file stays in Drive.`; return;
    }
    m.textContent = '';
    const t = items.filter(r => r.type === 'task'), f = items.filter(r => r.type === 'fin');
    box.innerHTML = `<div class="group-title">FY ${esc(a.fy)} · read only</div><div class="group">${t.map(x => `<div class="chk-row"><span class="pill">Task</span><div class="row-main"><div class="row-title">${esc(x.title)}</div><div class="row-sub">done ${esc(x.completedOn || '')}</div></div></div>`).join('')}
      ${f.map(x => `<div class="chk-row"><span class="pill">₹</span><div class="row-main"><div class="row-title">${esc(x.desc || x.category || 'Entry')}</div><div class="row-sub">${esc(fmtDate(x.date, true))} · ${esc(x.kind)}${x.category ? ' · ' + esc(x.category) : ''}</div></div><b>${rs(x.amount)}</b></div>`).join('')}</div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { m.className = 'msg err'; m.textContent = 'Could not read the archive: ' + (e.message || e); }
}
$('setArchive').addEventListener('click', () => { Sheets.close('shSettings', true); openArchive(); });

/* ---------- Dates: export to Excel, import back (bulk entry) ---------- */
const DI = { plan: null };
const catName = k => (dateCats().concat(DATE_CATS).find(c => c[0] === k) || [0, 'Other'])[1];
const REP_W = { once: 'Once', yearly: 'Every year', monthly: 'Every month', m2: 'Every 2 months', m3: 'Every 3 months', m6: 'Every 6 months' };
/* v2.19 (S7): Dates go out and come back as CSV — opens in Excel, and nothing has to parse an Excel file */
const csvCell = c => { let v = String(c == null ? '' : c); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
function dateExport() {
  const order = dateCats().map(c => c[0]);
  const L = all('date').filter(d => !d.sys).sort((a, b) => order.indexOf(dateCat(a)) - order.indexOf(dateCat(b)) || a.label.localeCompare(b.label));
  const fmt = w => { if (!w) return ''; const [y, m, d] = w.split('-'); return +y <= 1904 ? `${d}-${m}` : `${d}-${m}-${y}`; };
  const rows = [['Category', 'Name', 'Date (DD-MM-YYYY)', 'Repeats', 'ID (leave as it is)'], ...L.map(d => [catName(dateCat(d)), d.label, fmt(d.when), REP_W[d.repeat] || 'Once', d.id])];
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  shareOrDownload(csv, `Register dates ${todayISO()}.csv`, 'text/csv');
}
function parseDateCellOld(v) {
  if (v == null || v === '') return { v: '' };
  if (v instanceof Date && !isNaN(v)) return { v: isoLocal(new Date(v.getFullYear(), v.getMonth(), v.getDate())) };
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return { v: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }; }
  const s = String(v).trim(); let m;
  const mk = (y, mo, d) => { y = +y; mo = +mo; d = +d; if (y < 100) y += y < 50 ? 2000 : 1900; const dt = new Date(y, mo - 1, d); return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? { v: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` } : { err: `"${s}" is not a real date` }; };
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return mk(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) return mk(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/))) return mk(1900, m[2], m[1]).v ? { v: mk(1900, m[2], m[1]).v, noYear: true } : { err: `"${s}" is not a real date` };
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]*(\d{2,4})?$/)) && MON[m[2].slice(0, 4).toLowerCase()] || (m && MON[m[2].slice(0, 3).toLowerCase()])) { const mo = MON[m[2].slice(0, 4).toLowerCase()] || MON[m[2].slice(0, 3).toLowerCase()]; return m[3] ? mk(m[3], mo, m[1]) : { ...mk(1900, mo, m[1]), noYear: true }; }
  if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})?$/)) && MON[m[1].slice(0, 3).toLowerCase()]) { const mo = MON[m[1].slice(0, 3).toLowerCase()]; return m[3] ? mk(m[3], mo, m[2]) : { ...mk(1900, mo, m[2]), noYear: true }; }
  return { err: `"${s}" — write the date as DD-MM-YYYY` };
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function dateReadFile(file) {
  if (!(/\.csv$/i.test(file.name || '') || /csv|text\/plain/.test(file.type || ''))) throw new Error('please choose a CSV file. In Excel: File → Save As → CSV (Comma delimited), then pick that file');
  if (file.size > 2 * 1024 * 1024) throw new Error('the file is larger than 2 MB — that is not a dates list');
  const rows = parseCsv((await file.text()).replace(/^﻿/, '')).map(r => r.map(c => String(c).replace(/^'(?=[=+\-@])/, '')));
  const hi = rows.findIndex(r => r.some(c => /name|what|label/i.test(String(c))) && r.some(c => /date|when/i.test(String(c))));
  if (hi < 0) throw new Error('no header row with "Name" and "Date" columns');
  const H = rows[hi].map(c => String(c).toLowerCase()), col = re => H.findIndex(h => re.test(h));
  const cC = col(/categor/), cN = col(/name|what|label/), cD = col(/date|when/), cR = col(/repeat/), cI = col(/^id\b|\bid\b/);
  return rows.slice(hi + 1).map((r, i) => ({ line: hi + i + 2, cat: cC >= 0 ? String(r[cC] || '').trim() : '', name: String(r[cN] || '').trim(), date: r[cD], rep: cR >= 0 ? String(r[cR] || '').trim() : '', id: cI >= 0 ? String(r[cI] || '').trim() : '' })).filter(r => r.name).slice(0, 5000);
}
function dateImportPlan(rows) {
  const cats = [...DATE_CATS, ...(dateCfg().custom || []).map(x => [x.k, x.n, x.i])], norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const findCat = n => { const k = norm(n); if (!k) return null; return cats.find(c => norm(c[1]) === k || c[0] === k || norm(c[1]).replace(/s$/, '') === k.replace(/s$/, '') || norm(c[1]).startsWith(k)) || null; };
  const existing = all('date').filter(d => !d.sys), byId = new Map(existing.map(d => [d.id, d])), byKey = new Map();
  existing.forEach(d => { const k = norm(d.label); if (!byKey.has(k)) byKey.set(k, d); });
  const P = { add: [], upd: [], same: [], err: [], newCats: [], seen: new Set() };
  rows.forEach(r => {
    const d0 = (r.id && byId.get(r.id)) || byKey.get(norm(r.name)); if (d0) P.seen.add(d0.id);   // a row with a bad date never removes its entry
    const pd = parseDateCell(r.date); if (pd.err) { P.err.push(`Row ${r.line} (${r.name}): ${pd.err}`); return; }
    let cat = findCat(r.cat), catKey = cat ? cat[0] : null;
    if (!cat && r.cat) { const nc = P.newCats.find(x => norm(x.n) === norm(r.cat)); catKey = nc ? nc.k : 'c' + Math.random().toString(36).slice(2, 8); if (!nc) P.newCats.push({ k: catKey, n: r.cat, i: '📁' }); }
    const repRaw = r.rep.toLowerCase(), rep = /\b6\b|six|half/.test(repRaw) ? 'm6' : /\b3\b|three|quarter/.test(repRaw) ? 'm3' : /\b2\b|two|bi-?month/.test(repRaw) ? 'm2' : /month/.test(repRaw) ? 'monthly' : /year|annual|every ?yr/.test(repRaw) ? 'yearly' : /once|one/.test(repRaw) ? 'once' : null;
    const d = (r.id && byId.get(r.id)) || byKey.get(norm(r.name));
    const c = catKey || (d ? dateCat(d) : guessDateCat({ label: r.name }));
    const repeat = rep || (d ? d.repeat : ['birthday', 'anniv', 'remember'].includes(c) ? 'yearly' : 'once');
    const when = pd.v && pd.noYear && repeat !== 'yearly' ? null : pd.v;
    if (pd.noYear && repeat !== 'yearly') { P.err.push(`Row ${r.line} (${r.name}): a date without a year only works for yearly dates`); return; }
    if (d) { P.seen.add(d.id);
      const ch = d.label !== r.name || (d.when || '') !== (when || '') || d.repeat !== repeat || dateCat(d) !== c;
      (ch ? P.upd : P.same).push({ d, label: r.name, when: when || '', repeat, cat: c }); }
    else P.add.push({ label: r.name, when: when || '', repeat, cat: c });
  });
  P.gone = existing.filter(d => !P.seen.has(d.id) && !d.docRef);
  P.goneDoc = existing.filter(d => !P.seen.has(d.id) && d.docRef);
  return P;
}
function showDateImport(P) {
  DI.plan = P;
  $('diPrev').innerHTML = `<div class="imp-sum"><div><b>${P.add.length}</b>new</div><div><b>${P.upd.length}</b>changed</div><div><b>${P.same.length}</b>unchanged</div><div><b>${P.err.length}</b>with problems</div></div>
    ${P.newCats.length ? `<p class="hint">New categories: ${P.newCats.map(c => esc(c.n)).join(', ')}</p>` : ''}
    ${P.gone.length + P.goneDoc.length ? `<div class="group"><label class="switch-row"><span>Remove ${P.gone.length + P.goneDoc.length} entr${P.gone.length + P.goneDoc.length === 1 ? 'y' : 'ies'} that are not in the file<small>They go to Recently deleted for 30 days. ${P.gone.slice(0, 6).concat(P.goneDoc.slice(0, 2)).map(d => esc(d.label)).join(', ')}${P.gone.length + P.goneDoc.length > 8 ? '…' : ''}</small></span><input type="checkbox" class="sw" id="diDel"></label></div>` : ''}
    ${P.err.length ? `<details class="fold" open><summary>Rows with problems (${P.err.length}) — fix them in the file, or import the rest</summary>${P.err.map(e => `<div class="imp-skip">${esc(e)}</div>`).join('')}</details>` : ''}
    ${P.upd.length ? `<details class="fold"><summary>Changed (${P.upd.length})</summary>${P.upd.map(u => `<div class="imp-skip">${esc(u.label)}: ${esc(u.d.when ? fmtDate(u.d.when, true) : 'no date')} → <b>${esc(u.when ? fmtDate(u.when, true) : 'no date')}</b></div>`).join('')}</details>` : ''}
    ${P.add.length ? `<details class="fold"><summary>New (${P.add.length})</summary>${P.add.map(a => `<div class="imp-skip">${esc(catName(a.cat) || '')} · ${esc(a.label)} · ${esc(a.when ? fmtDate(a.when, true) : 'no date')}</div>`).join('')}</details>` : ''}`;
  $('diGo').disabled = !(P.add.length || P.upd.length || P.gone.length || P.goneDoc.length || P.newCats.length);
}
function runDateImport() {
  const P = DI.plan; if (!P) return;
  const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
  if (P.newCats.length) cfg.custom = [...(cfg.custom || []), ...P.newCats];
  const used = new Set([...P.add, ...P.upd].map(x => x.cat)); cfg.hidden = (cfg.hidden || []).filter(h => !used.has(h));
  put(cfg, { render: false });
  P.add.forEach(a => put({ id: uid('d'), type: 'date', label: a.label, when: a.when, repeat: a.repeat, cat: a.cat, needsDetail: !a.when || undefined, deleted: false }, { render: false }));
  P.upd.forEach(u => { const d = u.d; d.label = u.label; d.when = u.when; d.repeat = u.repeat; d.cat = u.cat; if (d.when) delete d.needsDetail; else d.needsDetail = true;
    const doc = d.docRef && records[d.docRef]; if (doc && d.when && u.cat === 'docexp' && doc.expiry !== d.when) { doc.expiry = d.when; put(doc, { render: false }); }
    put(d, { render: false }); });
  let del = 0; if ($('diDel') && $('diDel').checked) [...P.gone, ...P.goneDoc].forEach(d => { softDelete(d.id, { render: false }); del++; });
  Sheets.close('shDateImp'); scheduleRender();
  toast(`Imported: ${P.add.length} new, ${P.upd.length} changed${del ? `, ${del} removed` : ''}.`, null, null, 5000);
  DI.plan = null;
}
$('diExport').addEventListener('click', dateExport);
$('diPick').addEventListener('click', () => $('diFile').click());
$('diFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const m = $('diMsg'); m.className = 'msg'; m.textContent = 'Reading…'; $('diPrev').innerHTML = '';
  try { const rows = await dateReadFile(f); if (!rows.length) throw new Error('no rows with a Name'); showDateImport(dateImportPlan(rows)); m.textContent = `${rows.length} rows read from ${f.name}.`; }
  catch (err) { m.className = 'msg err'; m.textContent = 'Could not read the file: ' + err.message; }
});
$('diGo').addEventListener('click', runDateImport);
function openDateImport() { DI.plan = null; $('diPrev').innerHTML = ''; $('diMsg').textContent = ''; $('diGo').disabled = true; Sheets.open('shDateImp'); }

