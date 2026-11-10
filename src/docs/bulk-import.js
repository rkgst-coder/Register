/* ==========================================================================
   BULK IMPORT (v2.9) — read the Docs folder named in the Apps Script (IMPORT_FOLDER_ID),
   turn file names like TAX_Rahul_ITR-Ack_AY2025-26.pdf into documents, copy the files
   into the Register folder on the server (nothing is downloaded to the phone).
   ======================================================================== */
const IMPORT_MAP = { ID: 'Identity', EDU: 'Education', EXAM: 'Exam', TAX: 'Tax', FIN: 'Financial', SALARY: 'Financial', MED: 'Medical', OFF: 'Official',
  PROPERTY: 'Property', CERT: 'Certificate', PHOTO: 'Photo & Signature', SIGNATURE: 'Photo & Signature', DOC: 'Other',
  CASE: 'Case', EVIDENCE: 'Case', MISC: 'Other', PERSONAL: 'Other', UNKNOWN: 'Other', ACAD: 'Education', MARKSHEET: 'Education', BANK: 'Financial', INS: 'Insurance', INSURANCE: 'Insurance',
  VEH: 'Vehicle', VEHICLE: 'Vehicle', WARRANTY: 'Warranty', MEMBER: 'Membership', MEMBERSHIP: 'Membership', OFFICE: 'Official', OFFICIAL: 'Official', IDS: 'Identity', MEDICAL: 'Medical', EXAMS: 'Exam' };
const IMPORT_SKIP = { VIDEO: 'not a PDF or photo' };
const IMPORT_OK_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp', 'xlsx', 'xls', 'csv', 'docx', 'doc', 'txt'];
const splitCamel = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').replace(/-/g, ' - ').replace(/\s+/g, ' ').trim();
const isDateTok = t => /^(AY|FY)?(19|20)\d{2}(-\d{2}){0,2}$/i.test(t) || /^(YYYY|Undated)$/i.test(t);   // "1234" (last digits of an account) is not a year
function fyFromToken(t) {
  let m;
  const fy = s => s + '-' + String((s + 1) % 100).padStart(2, '0');
  if ((m = t.match(/^AY(\d{4})-\d{2}$/i))) return fy(+m[1] - 1);           // assessment year → the financial year before it
  if ((m = t.match(/^FY(\d{4})-\d{2}$/i))) return fy(+m[1]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return fyOf(t);
  if ((m = t.match(/^(\d{4})-(\d{2})$/))) { const Y = +m[1], N = +m[2]; return N === (Y + 1) % 100 ? fy(Y) : N >= 1 && N <= 12 ? fyOf(`${Y}-${m[2]}-01`) : fy(Y); }   // 2024-25 is an FY, 2024-03 is March 2024
  if ((m = t.match(/^(\d{4})$/))) return fy(+m[1]);                           // a plain year: the FY that starts in it
  return null;
}
function parseDocName(name) {
  const ext = ((name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase(), base = name.replace(/\.[^.]+$/, '');
  if (!IMPORT_OK_EXT.includes(ext)) return { skip: 'not a PDF, photo, Excel, Word or text file' };
  const tk = base.split('_').filter(Boolean); if (!tk.length) return { skip: 'no name' };
  const pre = tk[0].toUpperCase();
  if (IMPORT_SKIP[pre]) return { skip: IMPORT_SKIP[pre] };
  if (tk.some(t => /^(Dup\d*|Copy\d*)$/i.test(t))) return { skip: 'duplicate copy' };
  const type = IMPORT_MAP[pre] || 'Other', noPerson = ['CASE', 'EVIDENCE', 'UNKNOWN'].includes(pre);
  let rest = tk.slice(1), who = '', fy = null, unknown = false, unsorted = false;
  rest = rest.filter(t => { if (/^(Unknown|ThirdParty|Unconfirmed)$/i.test(t)) { unknown = unknown || /^Unknown$/i.test(t); return false; } if (/^(Unlabeled|Unlabelled)$/i.test(t)) { unsorted = true; return false; } return true; });
  const nameTok = t => (/^[A-Z][a-z]+(-[A-Z][a-z]+)*$/.test(t) || /^(family|parents)$/i.test(t) || !!PERSON_ALIAS[t.toLowerCase()]) && !/^(Photo|Picsart|WhatsApp|Scan|Doc|Passport)$/i.test(t);
  if (!noPerson && (rest.filter(t => !isDateTok(t)).length >= 2 || pre === 'SIGNATURE' || unsorted) && rest.length && nameTok(rest[0])) who = normWho(rest.shift().replace(/-/g, ' & '));
  const junk = t => /^(New|Old\d*|\d{1,2}|Final|Draft|All)$/i.test(t);
  while (rest.length > 1 && junk(rest[rest.length - 1])) rest.pop();
  if (rest.length && isDateTok(rest[rest.length - 1])) fy = fyFromToken(rest.pop());
  while (rest.length && isDateTok(rest[rest.length - 1])) rest.pop();
  while (rest.length > 1 && junk(rest[rest.length - 1])) rest.pop();
  if (rest.length === 1 && /^\d{1,2}$/.test(rest[0])) rest = [];
  let head = rest.join(' ');
  if (pre === 'TAX' && rest.length) { head = rest[0].split('-')[0]; if (/^ITR\d*$/i.test(head)) head = 'ITR'; }
  let title = rest.length ? splitCamel(head) : '';
  if (unsorted) title = 'Unsorted photos';
  else if (pre === 'PHOTO') title = /photo$/i.test(title) ? title : (title || 'Photo') + ' photo';
  if (pre === 'SIGNATURE') title = 'Signature';
  if (!title) title = splitCamel(base.replace(/_/g, ' '));
  if (unknown && !unsorted) title += ' — unknown person';
  return { type: unsorted ? 'Photo & Signature' : type, who, fy, title, label: splitCamel(tk.slice(1).join(' ')) || base };
}
function planImport(files) {
  const groups = new Map(), skipped = [];
  const done = new Set(all('docfile').map(f => f.srcId).filter(Boolean)), declined = impDeclined();
  files.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
    if (done.has(f.id)) { skipped.push({ name: f.name, why: 'already imported' }); return; }
    if (declined.has(f.id)) { skipped.push({ name: f.name, why: 'you chose not to import', declined: true }); return; }
    const p = parseDocName(f.name);
    if (p.skip) { skipped.push({ name: f.name, why: p.skip }); return; }
    const key = [p.type, docOwners(p).join('&'), p.title.toLowerCase()].join('|');
    if (!groups.has(key)) groups.set(key, { key, type: p.type, who: p.who, title: p.title, files: [] });
    groups.get(key).files.push({ ...f, fy: p.fy, label: p.label });
  });
  const list = [...groups.values()].map(g => {
    const ys = [...new Set(g.files.map(f => f.fy).filter(Boolean))];
    g.byYear = g.files.length > 1 && ys.length > 0;
    g.fy = !g.byYear && ys.length === 1 ? ys[0] : null;
    g.years = ys.sort().reverse();
    g.into = all('doc').find(d => d.title.toLowerCase() === g.title.toLowerCase() && docOwners(d).join('&') === docOwners(g).join('&') && d.docType === g.type) || null;
    return g;
  }).sort((a, b) => a.type.localeCompare(b.type) || a.who.localeCompare(b.who) || a.title.localeCompare(b.title));
  return { list, skipped };
}
let importPlan = null;
function openImport() {
  Sheets.closeAll();
  $('impBody').innerHTML = `<p class="hint">Reads the Docs folder set as <b>IMPORT_FOLDER_ID</b> in your Apps Script (v18), and moves the chosen files into your Register folder (no second copy). Files without a person go under Rahul.</p>
    <button class="btn ghost block hidden" id="impTidy" style="margin-bottom:8px"></button>
    <button class="btn block" id="impRead">Read the Docs folder</button><div class="msg" id="impMsg"></div><div id="impList"></div>`;
  $('impRead').addEventListener('click', readImport);
  $('impTidy').addEventListener('click', tidyImported); renderTidyBtn();
  Sheets.open('shImport');
}
async function readImport() {
  const m = $('impMsg');
  if (!Sync.on()) { m.className = 'msg err'; m.textContent = 'Connect the Google Sheet first (Settings → Sync).'; return; }
  if (!driveOn()) { m.className = 'msg err'; m.textContent = 'Set the Register Drive folder first (Settings → Sync → Drive folder).'; return; }
  m.className = 'msg'; m.textContent = 'Reading…';
  let d;
  try { d = await Sync.call('driveListImport', {}, 120000); }
  catch (e) { m.className = 'msg err'; m.textContent = /unknown action/.test(e.message) ? 'Your Apps Script is older than v18. Paste Code.gs v18, fill IMPORT_FOLDER_ID and redeploy.' : e.message; return; }
  importPlan = planImport(d.files || []);
  const P = importPlan, nf = P.list.reduce((s, g) => s + g.files.length, 0);
  m.className = 'msg ok'; m.textContent = `"${d.folder}": ${(d.files || []).length} files → ${P.list.length} documents (${nf} files). ${P.skipped.length} skipped.`;
  const byWhy = {}; P.skipped.forEach(s => { (byWhy[s.why] = byWhy[s.why] || []).push(s.name); });
  $('impList').innerHTML = `<div class="btn-row" style="margin:8px 0"><button class="btn ghost small" id="impAll">Tick all</button><button class="btn ghost small" id="impNone">Untick all</button></div>
    <div class="group">${P.list.map((g, i) => `<label class="imp-row"><input type="checkbox" data-imp="${i}" checked><span><b>${esc(g.title)}</b>${g.who ? ' · ' + esc(g.who) : ''}
      <small>${esc(docOwners({ who: g.who }).join(' & '))} › ${esc(docGroup({ docType: g.type }))} · ${esc(g.type)} · ${g.files.length} file${g.files.length > 1 ? 's' : ''}${g.byYear ? ' · by year: ' + g.years.join(', ') : g.fy ? ' · FY ' + g.fy : ''}${g.into ? ' · adds to your existing document' : ''}</small>
      <small>${g.files.map(f => esc(f.name)).join('<br>')}</small></span></label>`).join('')}</div>
    <details class="fold"><summary>Skipped (${P.skipped.length})</summary>${Object.entries(byWhy).map(([w, l]) => `<div class="imp-skip"><b>${esc(w)}</b> (${l.length}): ${l.map(esc).join(', ')}</div>`).join('')}</details>
    ${P.skipped.some(s => s.declined) ? '<button class="linkbtn" id="impUndo" style="margin:6px 4px">Offer the files I said no to again</button>' : ''}
    <p class="hint" style="margin:8px 4px 0">Unticked documents will not be offered again. You can bring them back from the Skipped list.</p>
    <div class="imp-bar"><button class="btn block" id="impGo">Import ticked documents</button></div>`;
  if (!P.list.length) { $('impList').querySelector('.btn-row').remove(); $('impList').querySelector('.imp-bar').remove(); $('impList').querySelector('.group').outerHTML = '<div class="empty">Nothing new to import.</div>'; $$('#impList > p.hint').forEach(x => x.remove()); }
  if ($('impAll')) $('impAll').addEventListener('click', () => $$('[data-imp]').forEach(c => { c.checked = true; }));
  if ($('impNone')) $('impNone').addEventListener('click', () => $$('[data-imp]').forEach(c => { c.checked = false; }));
  if ($('impGo')) $('impGo').addEventListener('click', runImport);
  if ($('impUndo')) $('impUndo').addEventListener('click', () => { impUndecline(); toast('Those files will be offered again.'); readImport(); });
  ImpCheck.refresh(d.files || []);
}
async function runImport() {
  const pick = $$('[data-imp]').filter(c => c.checked).map(c => importPlan.list[+c.dataset.imp]);
  const no = $$('[data-imp]').filter(c => !c.checked).map(c => importPlan.list[+c.dataset.imp]);
  if (!pick.length && !no.length) { toast('Nothing to import.'); return; }
  impDecline(no.flatMap(g => g.files.map(f => f.id)));                 // unticked: do not offer again
  if (!pick.length) { ImpCheck.set({ at: Date.now(), n: 0 }); scheduleRender(); $('impMsg').className = 'msg ok'; $('impMsg').textContent = `${no.length} document${no.length > 1 ? 's' : ''} will not be offered again.`; return; }
  const m = $('impMsg'), go = $('impGo'); go.disabled = true;
  const have = new Set(Object.values(records).filter(r => r.type === 'docfile' && !r.deleted).flatMap(r => [r.srcId, r.fileId]).filter(Boolean));
  pick.forEach(g => { g.files = g.files.filter(f => !have.has(f.id)); });                  // already in Register (a second tap, or an earlier run)
  const total = pick.reduce((s, g) => s + g.files.length, 0); let n = 0, ok = 0; const bad = [], toLock = new Set();
  for (const g of pick) {
    if (!g.files.length) continue;
    let d = g.into && records[g.into.id] && !records[g.into.id].deleted ? records[g.into.id] : null;
    if (!d) d = g.into = put({ id: uid('doc'), type: 'doc', title: g.title, who: normWho(g.who), docType: g.type, number: '', expiry: null, issuer: '', notes: '', folder: '', fy: g.fy || null, byYear: g.byYear, deleted: false }, { render: false });
    else if (g.byYear && !d.byYear) { d.byYear = true; put(d, { render: false }); }
    for (let i = 0; i < g.files.length; i += 5) {
      const batch = g.files.slice(i, i + 5);
      m.className = 'msg'; m.textContent = `Copying ${Math.min(n + batch.length, total)} of ${total}… keep the app open.`;
      let res;
      try { res = await Sync.call('driveCopyIn', { move: true, files: batch.map(f => ({ id: f.id, name: f.name })) }, 300000); }
      catch (e) { batch.forEach(f => bad.push(f.name + ': ' + e.message)); n += batch.length; continue; }
      (res.done || []).forEach(r => {
        const f = batch.find(x => x.id === r.id); n++;
        if (!r.fileId) { bad.push((f ? f.name : r.id) + ': ' + (r.error || 'failed')); return; }
        put({ id: uid('df'), type: 'docfile', docId: d.id, name: f.name, mime: r.mime || f.mime, bytes: r.bytes || f.size || 0, fileId: r.fileId, srcId: f.id, srcGone: r.fileId === f.id || undefined, locked: false,
              fy: d.byYear ? (f.fy || undefined) : undefined, deleted: false }, { render: false });
        ok++; if (d.lockFiles) toLock.add(d.id);
      });
    }
  }
  for (const id of toLock) { const d = records[id]; if (d && Fin.key) { try { await convertDocFiles(d); } catch (e) { RLOG.warn('import lock', e.message); } } }
  const unlockedIn = [...toLock].filter(id => docFilesOf(id).some(f => !f.locked)).length;
  scheduleRender(); go.disabled = false;
  if (unlockedIn) bad.push(`${unlockedIn} locked document${unlockedIn > 1 ? 's' : ''} got files that are not locked yet — unlock, then "Finish locking" in that document`);
  m.className = bad.length ? 'msg err' : 'msg ok';
  m.textContent = `Imported ${ok} of ${total} files into ${pick.length} documents.` + (bad.length ? ' Not copied: ' + bad.slice(0, 8).join('; ') + (bad.length > 8 ? ` … and ${bad.length - 8} more.` : '') : ' Lock sensitive ones (Aadhaar, PAN…) from each document\'s editor.');
  toast(`Imported ${ok} files.`); renderTidyBtn();
  ImpCheck.set({ at: Date.now(), n: bad.length });
  const keep = [m.className, m.textContent];
  try { await readImport(); } catch (e) {}                                   // the list now shows only what is left
  m.className = keep[0]; m.textContent = keep[1];
}

/* ---------- v2.10: declined files (synced) and the "new files" notice ---------- */
const IMPSKIP_ID = 'import-declined';
const impDeclined = () => new Set(((records[IMPSKIP_ID] && !records[IMPSKIP_ID].deleted && records[IMPSKIP_ID].ids) || []));
function impDecline(ids) {
  if (!ids.length) return;
  const cur = impDeclined(); ids.forEach(i => cur.add(i));
  put({ ...(records[IMPSKIP_ID] || { id: IMPSKIP_ID, type: 'impskip' }), ids: [...cur], deleted: false }, { render: false });
}
function impUndecline() { const r = records[IMPSKIP_ID]; if (r) { r.ids = []; put(r, { render: false }); } }
const ImpCheck = {
  KEY: 'r2_impcheck',
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(this.KEY, JSON.stringify(v)); } catch (e) {} },
  newCount(files) { const P = planImport(files); return P.list.reduce((s, g) => s + g.files.length, 0); },
  async maybe(force) {
    if (window.GHOST) return;
    if (!Sync.on() || !driveOn() || !navigator.onLine) return;
    const c = this.get();
    if (this.busy || (!force && c && (c.off || Date.now() - c.at < 6 * 3600000))) return;   // at most every 6 hours; stays quiet if the script has no Docs folder
    this.busy = true;
    try {
      const d = await Sync.call('driveListImport', {}, 60000);
      this.set({ at: Date.now(), n: this.newCount(d.files || []) });
    } catch (e) { this.set({ at: Date.now(), n: 0, off: /unknown action|IMPORT_FOLDER_ID/.test(e.message || '') }); }
    finally { this.busy = false; }
    if (currentTab === 'docs') renderDocs();
  },
  refresh(files) { this.set({ at: Date.now(), n: this.newCount(files) }); }
};

/* ---------- v2.11: note folder picker (editor and quick add) ---------- */
function folderPick(sel, inp, cur, list, onSet) {
  const fs = [...new Set([...list, cur].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">No folder</option>${fs.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('')}<option value="__new">＋ New folder…</option>`;
  inp.classList.add('hidden'); inp.value = '';
  sel.onchange = () => { if (sel.value === '__new') { inp.classList.remove('hidden'); inp.focus(); } else { inp.classList.add('hidden'); onSet && onSet(sel.value); } };
  const commit = () => { const v = inp.value.trim(); if (!v) return; folderPick(sel, inp, v, list.concat(v), onSet); onSet && onSet(v); };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
  inp.onblur = commit;
}
const pickedFolder = (sel, inp) => sel.value === '__new' ? inp.value.trim() : sel.value;
function neFolderInit() {
  const n = records[editNoteId]; if (!n) return;
  const list = [...new Set(all(n.type).map(noteFolder).filter(Boolean))];
  folderPick($('neFolder'), $('neFolderNew'), noteFolder(n), list, v => { const x = records[editNoteId]; if (!x || noteFolder(x) === v) return; x.folder = v; put(x, { render: false }); scheduleRender(); toast(v ? 'Moved to ' + v + '.' : 'Removed from folder.'); });
  $('neMic').classList.toggle('hidden', n.type === 'snote');
}

/* ---------- v2.11: voice typing ---------- */
const Dictate = {
  SR: window.SpeechRecognition || window.webkitSpeechRecognition,
  cur: null,
  stop() { if (this.cur) { try { this.cur.rec.stop(); } catch (e) {} } },
  start(el, btn, insert) {
    if (this.cur) { const same = this.cur.btn === btn; this.stop(); if (same) return; }
    if (!this.SR) { toast('Voice typing is not available here — use the 🎤 on the iPhone keyboard instead.', null, null, 6000); return; }
    const rec = new this.SR(); rec.lang = prefs.dictLang || 'en-IN'; rec.continuous = true; rec.interimResults = true;
    const live = btn.closest('.sheet-body') && btn.closest('.sheet-body').querySelector('.mic-live');
    this.cur = { rec, btn }; btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], txt = r[0].transcript.trim(); if (!txt) continue;
        if (r.isFinal) { const v = el.value, s = el.selectionStart != null ? el.selectionStart : v.length;
          const pre = s > 0 && !/\s$/.test(v.slice(0, s)) ? ' ' : ''; insert(pre + txt); }
        else interim += txt + ' ';
      }
      if (live) live.textContent = interim ? '🎤 ' + interim : '';
    };
    rec.onerror = e => { RLOG.warn('dictation', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone blocked. Allow it for this app (iPhone Settings → Apps → Safari → Microphone), or use the keyboard 🎤.', null, null, 7000);
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice typing stopped (' + e.error + ').'); };
    rec.onend = () => { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); if (live) live.textContent = ''; if (this.cur && this.cur.rec === rec) this.cur = null; };
    try { rec.start(); } catch (e) { rec.onend(); toast('Could not start voice typing.'); }
  }
};
function insertAtCursor(el, txt) {
  const s = el.selectionStart != null ? el.selectionStart : el.value.length, e = el.selectionEnd != null ? el.selectionEnd : s;
  el.setRangeText(txt, s, e, 'end'); el.dispatchEvent(new Event('input', { bubbles: true }));
}
function addMic(el) {
  if (!el || el.parentElement.classList.contains('has-mic')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'mic-btn'; b.textContent = '🎤'; b.setAttribute('aria-label', 'Speak to type');
  const w = document.createElement('div'); w.className = 'has-mic'; el.parentNode.insertBefore(w, el); w.appendChild(el); w.appendChild(b);
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', () => Dictate.start(el, b, t => insertAtCursor(el, t)));
}
{ const sc = Sheets.close.bind(Sheets); Sheets.close = (id, silent) => { if (Dictate.cur && $(id) && $(id).contains(Dictate.cur.btn)) Dictate.stop(); return sc(id, silent); }; }

/* ---------- v2.11: scan pages to a PDF ---------- */
const Scan = {
  pages: [], mode: 'doc', docId: null,
  open(docId) {
    this.pages = []; this.docId = docId || null; this.replace = null; if (this.mode === 'orig' && !docId) this.mode = 'doc';
    $('scTitleW').classList.toggle('hidden', !!docId);
    $('scTitle').value = 'Scan ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    $('scMsg').textContent = ''; this.render();
    chipGroup($('scMode'), [{ v: 'doc', l: 'Document' }, { v: 'bw', l: 'Black & white' }, { v: 'orig', l: 'Original' }], this.mode, v => { this.mode = v; this.render(); });
    Sheets.open('shScan');
  },
  async add(files) {
    for (const f of files) {
      try {
        const url = URL.createObjectURL(f), img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
        const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); this.pages.push({ src: c, rot: 0 });
      } catch (e) { toast('That photo could not be read.'); }
    }
    this.render();
  },
  process(p, maxSide) {
    const r = p.rot % 360, sw = p.src.width, sh = p.src.height, k = maxSide ? Math.min(1, maxSide / Math.max(sw, sh)) : 1;
    const w = Math.round(sw * k), h = Math.round(sh * k), c = document.createElement('canvas'), x = c.getContext('2d');
    c.width = r % 180 ? h : w; c.height = r % 180 ? w : h;
    x.translate(c.width / 2, c.height / 2); x.rotate(r * Math.PI / 180); x.drawImage(p.src, -w / 2, -h / 2, w, h); x.setTransform(1, 0, 0, 1, 0, 0);
    if (this.mode !== 'orig') scanFilter(x, c.width, c.height, this.mode);
    return c;
  },
  render() {
    $('scPages').innerHTML = this.pages.map((p, i) => `<div class="scan-page"><img src="${this.process(p, 260).toDataURL('image/jpeg', .7)}" alt="Page ${i + 1}"><button class="sp-b sp-rot" data-sprot="${i}" aria-label="Rotate page ${i + 1}">↻</button><button class="sp-b sp-crop" data-spcrop="${i}" aria-label="Crop page ${i + 1}">✂</button><button class="sp-b sp-del" data-spdel="${i}" aria-label="Remove page ${i + 1}">✕</button><span>${i + 1}</span></div>`).join('');
    $$('[data-sprot]').forEach(b => b.addEventListener('click', () => { this.pages[+b.dataset.sprot].rot += 90; this.render(); }));
    $$('[data-spdel]').forEach(b => b.addEventListener('click', () => { this.pages.splice(+b.dataset.spdel, 1); this.render(); }));
    $$('[data-spcrop]').forEach(b => b.addEventListener('click', () => openCrop(this.pages[+b.dataset.spcrop], () => this.render())));
    $('scSave').disabled = !this.pages.length;
    $('scCount').textContent = this.pages.length ? `${this.pages.length} page${this.pages.length > 1 ? 's' : ''}` : 'No pages yet — tap Add page and take a photo of each page.';
  },
  async save() {
    if (!this.pages.length) return;
    $('scMsg').className = 'msg'; $('scMsg').textContent = 'Making the PDF…';
    await new Promise(r => setTimeout(r, 30));
    const pages = this.pages.map(p => { const c = this.process(p, 2000), d = c.toDataURL('image/jpeg', this.mode === 'orig' ? .82 : .78); return { bytes: unb64(d.slice(d.indexOf(',') + 1)), w: c.width, h: c.height }; });
    const rep1 = this.replace, asImg = rep1 && !isPdf(rep1) && pages.length === 1;
    const file = asImg ? new File([pages[0].bytes], 'photo.jpg', { type: 'image/jpeg' }) : new File([jpegsToPdf(pages)], 'scan.pdf', { type: 'application/pdf' });
    if (file.size > DOCFILE_MAX) { $('scMsg').className = 'msg err'; $('scMsg').textContent = 'Too large for one file — save fewer pages at a time.'; return; }
    let id = this.docId;
    if (!id) {
      const d = put({ id: uid('doc'), type: 'doc', title: $('scTitle').value.trim() || 'Scan', who: docPath.who && docPath.who !== DOC_ME ? docPath.who : '', docType: docNewType(), number: '', expiry: null, issuer: '', notes: '', folder: '', fy: null, deleted: false });
      id = d.id;
    }
    Sheets.close('shScan', true);
    if (!Sheets.isOpen('shDoc') || editDocId !== id) openDoc(id);
    if (rep1 && rep1.fy && $('doFileFy')) $('doFileFy').value = rep1.fy;
    const before = docFilesOf(id).length; await addDocFiles(id, [file]);
    if (rep1 && docFilesOf(id).length > before) { softDelete(rep1.id, { render: false }); setTimeout(() => driveDelete(rep1.fileId), 1500); if (rep1.keyId && records[rep1.keyId]) softDelete(rep1.keyId, { render: false }); renderDocEditFiles(); $('doFileMsg').className = 'msg ok'; $('doFileMsg').textContent = 'Edited file saved; the old one is in Drive\'s Trash.'; }
    this.replace = null;
  }
};
function scanFilter(x, w, h, mode) {
  const im = x.getImageData(0, 0, w, h), p = im.data, n = w * h, g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = .299 * p[i * 4] + .587 * p[i * 4 + 1] + .114 * p[i * 4 + 2];
  if (mode === 'bw') {                                         // adaptive threshold against the local average (handles shadows)
    const I = new Float64Array((w + 1) * (h + 1)), R = Math.max(8, Math.round(Math.min(w, h) / 16));
    for (let y = 0; y < h; y++) { let s = 0; for (let xx = 0; xx < w; xx++) { s += g[y * w + xx]; I[(y + 1) * (w + 1) + xx + 1] = I[y * (w + 1) + xx + 1] + s; } }
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const x0 = Math.max(0, xx - R), x1 = Math.min(w, xx + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + xx] < m * 0.88 ? 0 : 255, j = (y * w + xx) * 4; p[j] = p[j + 1] = p[j + 2] = v;
    }
  } else {                                                     // "Document": grey, stretched so paper is white and ink is dark
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[g[i] | 0]++;
    let lo = 0, hi = 255, acc = 0; for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * .02) break; }
    acc = 0; for (; hi > 0; hi--) { acc += hist[hi]; if (acc > n * .10) break; }
    const span = Math.max(20, hi - lo);
    for (let i = 0; i < n; i++) { let v = (g[i] - lo) / span; v = Math.max(0, Math.min(1, v)); v = Math.pow(v, 1.4) * 255; const j = i * 4; p[j] = p[j + 1] = p[j + 2] = v; }
  }
  x.putImageData(im, 0, 0);
}
/* smallest possible PDF: one JPEG per page, page width A4 (595 pt), height from the photo */
function jpegsToPdf(pages) {
  const te2 = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = b => { if (typeof b === 'string') b = te2.encode(b); parts.push(b); len += b.length; };
  const obj = (id, body) => { offs[id] = len; push(`${id} 0 obj\n${body}\nendobj\n`); };
  push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]));
  const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((pg, i) => {
    const P = 3 + i * 3, W = 595.28, H = +(W * pg.h / pg.w).toFixed(2), cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(P, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${P + 1} 0 R >> >> /Contents ${P + 2} 0 R >>`);
    offs[P + 1] = len; push(`${P + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`);
    push(pg.bytes); push('\nendstream\nendobj\n');
    obj(P + 2, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
  });
  const total = 3 + n * 3, x0 = len;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`; for (let i = 1; i < total; i++) xref += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${x0}\n%%EOF\n`);
  const out = new Uint8Array(len); let o = 0; parts.forEach(b => { out.set(b, o); o += b.length; }); return out;
}
$('scAdd').addEventListener('click', () => $('scFile').click());
$('scFile').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) Scan.add(f); });
$('scPick').addEventListener('click', () => $('scFile2').click());
$('scFile2').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) Scan.add(f); });
$('scSave').addEventListener('click', () => Scan.save().catch(e => { RLOG.error('scan', e); $('scMsg').className = 'msg err'; $('scMsg').textContent = 'Could not make the PDF: ' + e.message; }));
$('doScanBtn').addEventListener('click', () => Scan.open(editDocId));
$('docScanBtn').addEventListener('click', () => Scan.open(null));

/* ---------- v2.11: clean imported originals out of the Docs folder (Code.gs v19) ---------- */
const tidyList = () => all('docfile').filter(f => f.srcId && f.srcId !== f.fileId && !f.srcGone && records[f.docId] && !records[f.docId].deleted);
async function tidyImported() {
  const L = tidyList(), m = $('impMsg');
  if (!L.length) { toast('Nothing to clean — no imported originals are left in the Docs folder.'); return; }
  if (!confirm(`Remove ${L.length} files from your Docs folder that are already in Register?\n\nOnly files Register has a copy of are touched. They go to Google Drive's Trash (recoverable for 30 days).`)) return;
  let gone = 0, miss = 0; const bad = [];
  for (let i = 0; i < L.length; i += 50) {
    const batch = L.slice(i, i + 50);
    m.className = 'msg'; m.textContent = `Cleaning ${Math.min(i + batch.length, L.length)} of ${L.length}…`;
    let res;
    try { res = await Sync.call('driveTidyImport', { ids: batch.map(f => f.srcId) }, 300000); }
    catch (e) { m.className = 'msg err'; m.textContent = /unknown action/.test(e.message) ? 'Your Apps Script is older than v19. Paste Code.gs v19 and redeploy.' : e.message; return; }
    (res.done || []).forEach(r => { const f = batch.find(x => x.srcId === r.id); if (!f) return;
      if (r.ok || r.missing) { f.srcGone = true; put(f, { render: false }); r.ok ? gone++ : miss++; } else bad.push(f.name + ': ' + (r.error || 'refused')); });
  }
  m.className = bad.length ? 'msg err' : 'msg ok';
  m.textContent = `Moved ${gone} file${gone === 1 ? '' : 's'} to Drive's Trash${miss ? `, ${miss} were already gone` : ''}.` + (bad.length ? ' Not touched: ' + bad.slice(0, 6).join('; ') : '');
  renderTidyBtn();
}
function renderTidyBtn() { const b = $('impTidy'); if (!b) return; const n = tidyList().length; b.classList.toggle('hidden', !n); b.textContent = `🧹 Remove ${n} already-imported file${n === 1 ? '' : 's'} from the Docs folder`; }

/* ---------- v2.11: Face ID helpers ---------- */
async function bioDiag() {
  const out = [];
  if (!window.PublicKeyCredential) return 'This browser has no passkey support.';
  try { if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) out.push('No Face ID / Touch ID / Windows Hello found on this device.'); } catch (e) {}
  try { if (PublicKeyCredential.getClientCapabilities) { const c = await PublicKeyCredential.getClientCapabilities(); if (c && c['extension:prf'] === false) out.push('This browser cannot do passkey PRF (needs iOS 18+ Safari / home-screen app).'); } } catch (e) {}
  return out.join(' ');
}
$('neMic').addEventListener('click', () => Dictate.start(ta(), $('neMic'), txt => { if (richActive()) { richFocus(); document.execCommand('insertText', false, txt); richSync(); } else insertText(txt); }));
addMic($('teNotes'));

