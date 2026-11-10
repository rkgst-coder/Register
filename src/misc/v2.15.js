/* ==========================================================================
   v2.15
   ======================================================================== */
/* ---------- suggested action for an Inbox line ---------- */
const MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function findDateInOld(text) {
  const s = ' ' + String(text || '').toLowerCase() + ' ', t = todayISO(); let m;
  const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getMonth() === mo - 1 && dt.getDate() === d ? isoLocal(dt) : null; };
  const fut = (mo, d) => { const y = +t.slice(0, 4); let r = ok(y, mo, d); if (r && r < t) r = ok(y + 1, mo, d); return r; };
  if ((m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3], r = ok(y, +m[2], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { const r = ok(+m[1], +m[2], +m[3]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?\b/))) { const r = m[3] ? ok(+m[3], MON3[m[2]], +m[1]) : fut(MON3[m[2]], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/))) { const r = m[3] ? ok(+m[3], MON3[m[1]], +m[2]) : fut(MON3[m[1]], +m[2]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{1,2})[/.](\d{1,2})\b/)) && +m[2] <= 12 && +m[1] <= 31 && !/[₹]|rs/.test(s.slice(Math.max(0, s.indexOf(m[0]) - 4), s.indexOf(m[0])))) { const r = fut(+m[2], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if (/\b(today|aaj)\b/.test(s)) return { iso: t, hit: (s.match(/\b(today|aaj)\b/) || [''])[0] };
  if (/\btomorrow\b/.test(s)) return { iso: addDays(1), hit: 'tomorrow' };
  if ((m = s.match(/\bin (\d{1,3}) days?\b/))) return { iso: addDays(+m[1]), hit: m[0] };
  if ((m = s.match(/\b(?:next |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) { const w = WDAYS.indexOf(m[1]), now = new Date(t + 'T00:00:00').getDay(); let k = (w - now + 7) % 7 || 7; return { iso: addDays(k), hit: m[0] }; }
  return null;
}
function suggestInbox(i) {
  const text = String(i.text || '').trim(), first = text.split('\n')[0], low = first.toLowerCase();
  if (!text && (i.imgs || []).length) return { k: 'doc', why: 'a photo — keep it as a document' };
  if (/^\s*(₹|rs\.?|inr)?\s*\d[\d,]*(\.\d+)?\b/i.test(first) || /(₹|\brs\.?|\binr)\s*\d/i.test(first) || /\b(paid|spent|pay|bought|kharcha|kharch|diya|given)\b.*\d{2,}/i.test(low) && !findDateIn(first))
    return { k: 'money', why: 'starts with an amount — a spend' };
  const d = findDateIn(text); if (d) return { k: 'date', why: `mentions ${fmtDate(d.iso, true)} — a date`, date: d };
  if (/^(call|pay|buy|send|submit|renew|book|file|apply|get|collect|check|meet|email|mail|reply|visit|fix|order|update)\b/i.test(first)) return { k: 'task', why: 'sounds like something to do — a task' };
  if ((i.imgs || []).length) return { k: 'doc', why: 'has a photo — a document' };
  return { k: 'note', why: 'something to remember — a note' };
}

function dateLabelFrom(first, fd) {
  if (!fd) return first;
  const h = fd.hit.trim(), k = first.toLowerCase().indexOf(h);
  let out = k >= 0 ? first.slice(0, k) + first.slice(k + h.length) : first;
  return out.replace(/\s+(on|by|till|before|dated)\s*$/i, '').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
}
/* ---------- daily Inbox reminder, Tasks badge ---------- */
function inboxNudge() {
  if (window.GHOST || document.documentElement.classList.contains('decoy-on')) return;
  const n = all('inbox').length; updateInboxBadge();
  if (n <= 5) return;
  const key = 'r2_inboxNudge', today = todayISO(); let last = ''; try { last = localStorage.getItem(key) || ''; } catch (e) {}
  if (last === today) return;
  try { localStorage.setItem(key, today); } catch (e) {}
  toast(`📥 ${n} items are waiting in your Inbox.`, 'Sort now', openInbox, 9000, { once: 'inbox' });
}
function updateInboxBadge() {
  const b = $('tasksBadge'); if (!b) return;
  const n = window.GHOST ? 0 : all('inbox').length;
  b.classList.toggle('hidden', n <= 5); b.textContent = n; b.setAttribute('aria-label', `${n} items in the Inbox`);
}
setTimeout(inboxNudge, 7000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(inboxNudge, 2500); });

/* ---------- Needs attention: OK / ignore ---------- */
const ATTN_ID = 'attn-ok';
const attnCfg = () => records[ATTN_ID] && !records[ATTN_ID].deleted ? records[ATTN_ID] : { ok: {}, off: {} };
function attnSave(fn) { const c = { id: ATTN_ID, type: 'attnok', ok: {}, off: {}, ...JSON.parse(JSON.stringify(attnCfg())), deleted: false }; fn(c); put(c, { render: false }); renderAttn(); }
function attnListsAll() {
  const docs = all('doc'), t = todayISO();
  return [
    ['inbox', 'Inbox to sort', all('inbox')],
    ['exp', 'Expired', docs.filter(d => d.expiry && d.expiry < t)],
    ['nofile', 'No file attached', docs.filter(d => !d.noFile && !docFilesOf(d.id).length)],
    ['unlocked', 'ID documents not locked', docs.filter(d => d.docType === 'Identity' && docFilesOf(d.id).length && !d.lockFiles)],
    ['noexp', 'Usually expire, but no expiry date saved', docs.filter(d => !d.expiry && expiryKind(d))],
    ['datefill', 'Dates still to fill in', all('date').filter(d => !d.when && !d.sys)]
  ];
}
function attnLists() {
  const c = attnCfg();
  return attnListsAll().filter(([k]) => !c.off[k]).map(([k, h, L]) => [h, k === 'inbox' ? L : L.filter(x => !c.ok[k + ':' + x.id]), k]).filter(x => x[1].length);
}
function renderAttnBase() {
  const box = $('docAttn'); if (!box) return;
  if (docPath.who || window.GHOST) { box.innerHTML = ''; return; }
  const L = attnLists(), c = attnCfg(), n = L.reduce((s, x) => s + x[1].length, 0);
  const nOk = Object.keys(c.ok || {}).length, nOff = Object.keys(c.off || {}).filter(k => c.off[k]).length;
  if (!n && !nOk && !nOff) { box.innerHTML = ''; return; }
  const open = box.querySelector('details') && box.querySelector('details').open;
  const row = (k, x) => {
    const label = x.type === 'date' ? `📅 ${esc(x.label)}` : x.type === 'inbox' ? `📥 ${esc(x.text ? x.text.split('\n')[0].slice(0, 60) : 'Photo')}` : `${esc(x.title)} · ${esc(docOwners(x).join(' & '))}${x.expiry ? ' · ' + fmtDate(x.expiry, true) : ''}`;
    return `<div class="attn-row"><button class="attn-go" data-attk="${k}" data-attid="${x.id}">${label}</button>${k === 'inbox' ? '' : `<button class="attn-ok" data-attok="${k}:${x.id}" aria-label="Mark OK">✓ OK</button>`}</div>`;
  };
  box.innerHTML = `<details class="attn"${open ? ' open' : ''}><summary>${n ? `⚠︎ Needs attention (${n})` : '✓ Nothing needs attention'}<small class="muted" style="display:block;font-weight:400;font-size:.8125rem;margin-top:2px">${L.map(x => `${x[1].length} ${x[0].toLowerCase()}`).join(' · ') || 'Everything is marked OK.'}</small></summary>
    ${L.map(([h, items, k]) => `<div class="attn-sec"><div class="attn-head"><b>${esc(h)} (${items.length})</b>${k === 'inbox' ? '<button data-attinbox="1">Sort ›</button>' : `<button data-attall="${k}">All OK</button><button data-attoff="${k}">Stop checking this</button>`}</div>
      ${items.slice(0, 40).map(x => row(k, x)).join('')}${items.length > 40 ? `<small class="muted">…and ${items.length - 40} more</small>` : ''}</div>`).join('')}
    ${nOk || nOff ? `<div class="attn-foot muted">${nOk ? `${nOk} marked OK` : ''}${nOk && nOff ? ' · ' : ''}${nOff ? `${nOff} check${nOff > 1 ? 's' : ''} switched off` : ''} · <button class="linkbtn" id="attnReset" style="font-size:.8125rem;padding:0">Show them again</button></div>` : ''}</details>`;
  $$('[data-attid]', box).forEach(b => b.addEventListener('click', () => { const k = b.dataset.attk, id = b.dataset.attid; if (k === 'inbox') openInbox(); else if (k === 'datefill') openDate(id); else openDoc(id); }));
  $$('[data-attinbox]', box).forEach(b => b.addEventListener('click', openInbox));
  $$('[data-attok]', box).forEach(b => b.addEventListener('click', () => attnSave(c2 => { c2.ok[b.dataset.attok] = Date.now(); })));
  $$('[data-attall]', box).forEach(b => b.addEventListener('click', () => { const k = b.dataset.attall, sec = attnListsAll().find(s => s[0] === k); attnSave(c2 => { sec[2].forEach(x => { c2.ok[k + ':' + x.id] = Date.now(); }); }); }));
  $$('[data-attoff]', box).forEach(b => b.addEventListener('click', () => { const k = b.dataset.attoff; attnSave(c2 => { c2.off[k] = true; }); toast('That check is off. "Show them again" at the bottom brings it back.'); }));
  if ($('attnReset')) $('attnReset').addEventListener('click', () => attnSave(c2 => { c2.ok = {}; c2.off = {}; }));
}

/* ---------- Share into Register (iPhone Shortcut → Apps Script) ---------- */
function openShareIn() {
  const url = prefs.cloudUrl || '(connect the Sheet first — Settings → Sync)';
  $('siBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">iPhone does not let web apps appear in the Share menu. A one-time Shortcut does it: Share → <b>Save to Register</b> sends the photo or text straight to your Inbox (through your own Apps Script, v23 or later). It shows up here on the next sync.</p>
    <div class="group" style="padding:12px 14px">
      <div class="field"><label>Web App URL</label><div style="display:flex;gap:8px"><input id="siUrl" readonly value="${esc(url)}" style="flex:1;min-width:0"><button class="btn small ghost" id="siCopyUrl">Copy</button></div></div>
      <div class="field"><label>Token</label><div style="display:flex;gap:8px"><input id="siTok" readonly type="password" value="${esc(prefs.cloudToken || '')}" style="flex:1;min-width:0"><button class="btn small ghost" id="siCopyTok">Copy</button></div></div>
    </div>
    <div class="group-title">Make the Shortcut (once, about 10 minutes) — photos, PDFs, Word / Excel files, text and links</div>
    <ol class="share-steps">
      <li>Shortcuts app → <b>＋</b> → name it <code>Save to Register</code>. Tap <b>ⓘ</b> → <b>Show in Share Sheet</b> → Share Sheet Types: <b>Images, PDFs, Files, Text, URLs</b>.</li>
      <li><b>Ask for Text with Prompt</b> → <code>A line about it (optional)</code> (leave Default Answer empty). Its answer is the variable <b>Provided Input</b>.</li>
      <li><b>Repeat with Each</b> item in <b>Shortcut Input</b>.</li>
      <li>&nbsp;&nbsp;<b>Get Details of Files</b> → Detail <b>File Extension</b> of <b>Repeat Item</b>.</li>
      <li>&nbsp;&nbsp;<b>If</b> <i>File Extension</i> <b>is</b> <code>pdf</code> — for Word, Excel and text files too, tap <b>Add Condition</b>, choose <b>Any</b>, and add <code>docx</code>, <code>doc</code>, <code>xlsx</code>, <code>xls</code>, <code>csv</code>, <code>txt</code> (needs Apps Script v27):
        <ul><li><b>Base64 Encode</b> <i>Repeat Item</i> (Line Breaks: <b>None</b>) → <b>Get Name</b> of <i>Repeat Item</i></li>
          <li><b>Get Contents of URL</b> (box A)</li></ul></li>
      <li>&nbsp;&nbsp;<b>Otherwise</b> → <b>Get Images from Input</b> (<i>Repeat Item</i>) → <b>If</b> <i>Images</i> <b>has any value</b>:
        <ul><li><b>Resize Image</b> width <code>1600</code> → <b>Convert Image</b> to <b>JPEG</b> → <b>Base64 Encode</b> (Line Breaks: <b>None</b>)</li>
          <li><b>Get Contents of URL</b> (box B)</li>
          <li><b>Otherwise</b> → <b>Get Text from Input</b> (<i>Repeat Item</i>) → <b>Get Contents of URL</b> (box C) → <b>End If</b></li></ul></li>
      <li>&nbsp;&nbsp;<b>End If</b> → <b>End Repeat</b> → <b>Show Notification</b> <code>Saved to Register Inbox</code>.</li>
    </ol>
    <div class="group-title">The three “Get Contents of URL” boxes</div>
    <p class="hint" style="margin:0 4px 6px">Each: the URL above · Method <b>POST</b> · Request Body <b>JSON</b> · every field of type <b>Text</b>. Pick variables from the bar above the keyboard.</p>
    <ul class="share-steps">
      <li><b>A · PDF or file:</b> <code>token</code> = the token above · <code>action</code> = <code>inboxAdd</code> · <code>text</code> = <i>Provided Input</i> · <code>data</code> = <i>Base64 Encoded</i> · <code>mime</code> = <code>application/pdf</code> · <code>name</code> = <i>Name</i> · <code>ext</code> = <i>File Extension</i> (this tells the script what kind of file it is)</li>
      <li><b>B · photo:</b> <code>token</code> · <code>action</code> = <code>inboxAdd</code> · <code>text</code> = <i>Provided Input</i> · <code>data</code> = <i>Base64 Encoded</i> · <code>mime</code> = <code>image/jpeg</code></li>
      <li><b>C · text or link:</b> <code>token</code> · <code>action</code> = <code>inboxAdd</code> · <code>text</code> = <i>Provided Input</i>, a new line, <i>Text</i></li>
    </ul>
    <div class="group-title">So a refusal is not hidden (recommended)</div>
    <p class="hint" style="margin:0 4px 6px">The script answers “OK” even when it refuses something; the reason is inside the answer. After <b>each</b> Get Contents of URL add: <b>Get Dictionary Value</b> key <code>error</code> from <i>Contents of URL</i> → <b>If</b> <i>Dictionary Value</i> <b>has any value</b> → <b>Show Alert</b> “Register refused it: <i>Dictionary Value</i>” → <b>Stop This Shortcut</b> → <b>End If</b>.</p>
    <p class="hint" style="margin:0 4px 6px">Common answers: <code>unauthorized</code> = token does not match · <code>unknown action</code> = the new Code.gs was saved but not deployed (Deploy → Manage deployments → Edit → New version) · <code>DRIVE_FOLDER_ID is empty</code> = paste the Register folder link in the script.</p>
    <p class="hint" style="margin:0 4px 10px">If PDFs shared from WhatsApp arrive as text, make a second Shortcut <code>Save PDF to Register</code> with only box A (Share Sheet Types: PDFs, Files) — it does not need the file-type check.</p>
    <p class="hint">Photos and PDFs go into your Register Drive folder; nothing else in your Drive is touched. Deleting the item from the Inbox moves them to Drive's Trash. The token stays inside the Shortcut on your phone — do not share the Shortcut with anyone.</p>
    <button class="btn ghost block" id="siTest">Send a test item now</button><div class="msg" id="siMsg"></div>`;
  const cp = async (id, what) => { try { await navigator.clipboard.writeText($(id).value); toast(what + ' copied.'); } catch (e) { $(id).type = 'text'; $(id).select(); toast('Select and copy it.'); } };
  $('siCopyUrl').addEventListener('click', () => cp('siUrl', 'URL')); $('siCopyTok').addEventListener('click', () => cp('siTok', 'Token'));
  $('siTest').addEventListener('click', async () => {
    const m = $('siMsg'); m.className = 'msg'; m.textContent = 'Sending…';
    try { const r = await Sync.call('inboxAdd', { text: 'Test from Share setup ' + new Date().toLocaleTimeString('en-IN') }); if (r.error) throw new Error(r.error);
      await Sync.run(); m.className = 'msg ok'; m.textContent = 'Arrived — check the Inbox (top of Tasks).'; renderInboxCard(); }
    catch (e) { m.className = 'msg err'; m.textContent = /unknown action/.test(e.message) ? 'Your Apps Script is older than v21. Paste Code.gs v21 and redeploy.' : 'Failed: ' + e.message; }
  });
  Sheets.open('shShareIn');
}
$('setShareIn').addEventListener('click', () => { Sheets.close('shSettings', true); openShareIn(); });
$('setImportDocs').addEventListener('click', openImport);
$('docImportBtn').addEventListener('click', openImport);

