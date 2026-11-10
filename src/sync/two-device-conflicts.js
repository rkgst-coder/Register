/* ==========================================================================
   v2.24 — the same item changed on two devices: keep both, you choose
   (notes keep their "conflict copy" as before; this covers tasks, dates,
   documents, Money entries, accounts, card details …)
   Needs Apps Script v26 for the "your change replaced theirs" half.
   ======================================================================== */
const CONFLICT_TYPES = new Set(['task', 'date', 'doc', 'fin', 'vault', 'acct', 'recur', 'emerg', 'bill', 'goal', 'loan', 'invest', 'template']);
const Conf = { list: null, fresh: [] };
async function confLoad() { if (Conf.list) return Conf.list; try { Conf.list = (await DB.get('conflicts')) || []; } catch (e) { Conf.list = []; } return Conf.list; }
function conflictStash(id, data, side) { if (window.GHOST || !data) return; Conf.fresh.push({ id, type: data.type, side, data, at: nowMs() }); }
async function conflictsSave() {
  if (!Conf.fresh.length) return;
  const L = await confLoad(), fresh = Conf.fresh.splice(0);
  fresh.forEach(c => { const i = L.findIndex(x => x.id === c.id); if (i >= 0) L.splice(i, 1); L.push(c); });
  while (L.length > 60) L.shift();
  await DB.set('conflicts', L);
  RLOG.warn('changed on two devices', fresh.length);
  toast(`${fresh.length} item${fresh.length > 1 ? 's were' : ' was'} changed on two devices.`, 'Review', openConflicts, 12000);
}
const CONF_SKIP = new Set(['completedAt', 'updatedAt', 'createdAt', 'deletedAt', 'id', 'type', '_dirty', '_base', '_chunked', '_tooBig', 'enc', 'iv', 'salt', 'kid', 'it', 'tag', 'v']);
const recTitle = r => String((r && (r.title || r.label || r.desc || r.name || r.who)) || '(untitled)').slice(0, 80);
async function confPlain(c) {          // the other version, readable (private ones need the code)
  const d = c.data; if (!d) return null;
  if (SEALED_TYPES.has(d.type) && d.enc) { if (!Fin.key) return { locked: true }; try { return await unsealWith(Fin.key, d); } catch (e) { return { bad: true }; } }
  return d;
}
function confDiff(a, b, type) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter(k => !CONF_SKIP.has(k) && !k.startsWith('_'));
  const show = (v, k) => { if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—'; if (type === 'vault' && k === 'fields') return (v || []).map(f => f.l + ': ' + (f.s ? '••••' : f.v)).join(' · ');
    // v2.32: in words, not code — steps as a list, dates as dates, yes / no
    if (k === 'subs' && Array.isArray(v)) return v.map(x => (x && x.done ? '☑ ' : '☐ ') + String(x && x.text || '').slice(0, 60)).join('\n');
    if (k === 'status' && CONF_STATUS[v]) return CONF_STATUS[v];
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number' && v > 1e12) return new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (typeof v === 'string' && ISO_DATE_RX.test(v)) return fmtDate(v, true);
    if (Array.isArray(v) && v.every(x => typeof x !== 'object')) return v.join(', ');
    if (typeof v === 'object') v = JSON.stringify(v); return String(v).slice(0, 300); };
  const W = { completedOn: 'Completed on', waitingOn: 'Waiting on', waitingSince: 'Waiting since', pinned: 'Pinned', folder: 'Folder', title: 'Title', label: 'Name', priority: 'Priority', notes: 'Notes', dueDate: 'Due', dueTime: 'Time', status: 'Status', when: 'Date', repeat: 'Repeats', amount: 'Amount', desc: 'Details', category: 'Category', number: 'Number', expiry: 'Expiry', who: 'Belongs to', deleted: 'Deleted', subs: 'Steps', fields: 'Fields', docType: 'Type', issuer: 'Issuer', kind: 'Kind', date: 'Date', cat: 'Category', name: 'Name' };
  return keys.filter(k => JSON.stringify(a ? a[k] : undefined) !== JSON.stringify(b ? b[k] : undefined)).map(k => ({ k: W[k] || k.charAt(0).toUpperCase() + k.slice(1), a: show(a && a[k], k), b: show(b && b[k], k) }));
}
const CONF_STATUS = { active: 'Open', inprogress: 'In progress', waiting: 'Waiting', done: 'Done' };
const confWhen = ts => 'changed ' + new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
async function openConflicts() {
  if (window.GHOST) return;
  const L = await confLoad(), rows = [];
  for (const c of L.slice().reverse()) {
    const live = records[c.id], other = await confPlain(c);
    if (other && other.locked) { rows.push({ c, locked: true }); continue; }
    if (!other || other.bad) continue;
    const diff = confDiff(live || { deleted: true }, other, c.type);
    if (!diff.length) { L.splice(L.indexOf(c), 1); continue; }
    rows.push({ c, live, other, diff });
  }
  await DB.set('conflicts', L);
  const word = { task: 'Task', date: 'Date', doc: 'Document', fin: 'Money entry', vault: 'Card / account detail', acct: 'Account', recur: 'Recurring item', emerg: 'Emergency sheet', bill: 'Bill', goal: 'Goal', loan: 'Loan', invest: 'Investment', template: 'Template' };
  planSheet('Changed on two devices', `<p class="hint" style="margin:0 4px 10px">These were edited on this device and on another one before they synced. The version shown in the app now is <b>In use</b>. Pick the other one if it is the right one — nothing is lost until you choose.</p>
    ${rows.length ? rows.map((x, i) => x.locked ? `<div class="cf-card"><b>${esc(word[x.c.type] || x.c.type)}</b><p class="hint">Private — unlock to compare.</p></div>`
      : `<div class="cf-card"><div class="cf-h"><b>${esc(recTitle(x.live || x.other))}</b><span class="pill">${esc(word[x.c.type] || x.c.type)}</span></div>
        <div class="cf-g"><div class="cf-c cf-hd">In use<small>${x.live && x.live.updatedAt ? esc(confWhen(x.live.updatedAt)) : ''}</small></div><div class="cf-c cf-hd">${x.c.side === 'mine' ? 'This device’s edit' : 'Other device’s edit'}<small>${x.other && x.other.updatedAt ? esc(confWhen(x.other.updatedAt)) : ''}</small></div>
        ${x.diff.slice(0, 12).map(d => `<div class="cf-k">${esc(d.k)}</div><div class="cf-c">${esc(d.a)}</div><div class="cf-c">${esc(d.b)}</div>`).join('')}</div>
        <div class="btn-row" style="margin:6px 0 0"><button class="btn ghost small" type="button" data-cfk="${i}">Keep “In use”</button><button class="btn brass small" type="button" data-cfo="${i}">Use the other</button></div></div>`).join('')
      : '<div class="empty">Nothing to review.</div>'}`, () => true, 'Done');
  const drop = async c => { const L2 = await confLoad(); const j = L2.indexOf(c); if (j >= 0) L2.splice(j, 1); await DB.set('conflicts', L2); };
  $$('[data-cfk]', $('pshBody')).forEach(b => b.addEventListener('click', async () => { await drop(rows[+b.dataset.cfk].c); openConflicts(); }));
  $$('[data-cfo]', $('pshBody')).forEach(b => b.addEventListener('click', async () => { const x = rows[+b.dataset.cfo];
    if (SEALED_TYPES.has(x.c.type) && !Fin.key) { toast('Unlock first.'); return; }
    const o = { ...x.other }; delete o._dirty; delete o._base; delete o.enc; put(o); await drop(x.c); toast('Done — the other version is in use now.'); openConflicts(); }));
}

/* ---------- v2.24 (S2): card / policy expiry from Card & account details → Dates ---------- */
const EXP_MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseExpiry(v) {
  const t = String(v || '').trim().toLowerCase(), last = (y, m) => isoLocal(new Date(y, m, 0)), Y = y => y < 100 ? 2000 + y : y;
  let m;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return t;
  if ((m = t.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2}|\d{4})$/))) { const d = +m[1], mo = +m[2], y = Y(+m[3]); if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return isoLocal(new Date(y, mo - 1, Math.min(d, new Date(y, mo, 0).getDate()))); return null; }
  if ((m = t.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{2}|\d{4})$/))) { const mo = +m[1], y = Y(+m[2]); return mo >= 1 && mo <= 12 ? last(y, mo) : null; }
  if ((m = t.match(/^([a-z]{3})[a-z]*\.?\s*[,'\-]?\s*(\d{2}|\d{4})$/)) && EXP_MON.includes(m[1])) return last(Y(+m[2]), EXP_MON.indexOf(m[1]) + 1);
  return null;
}
const VAULT_DATE_CAT = { card: 'bank', bank: 'bank', policy: 'insurance', id: 'govt', phone: 'subs', login: 'subs', bill: 'home', other: 'other' };
function vaultDateWant(v) {
  if (!v || v.deleted || v.noDate || !v.title) return null;
  for (const f of v.fields || []) {
    if (!f.v || f.s || !/valid|expir|renew|due|till|upto|up to|maturity/i.test(f.l || '')) continue;
    const when = parseExpiry(f.v); if (!when) continue;
    const k = vKind(v.kind)[0];
    return { label: `${v.title} — ${k === 'card' ? 'card expires' : /renew/i.test(f.l) ? 'renewal' : 'expires'}`, when, repeat: 'once', cat: VAULT_DATE_CAT[k] || 'other', srcRef: v.id, sysSrc: 'vault' };
  }
  return null;
}
{ const sd = softDelete, rs0 = restore;
  softDelete = function (id, opt) { const r = records[id]; sd(id, opt); if (r && r.type === 'vault') sysDate('vd-' + id, null); };
  restore = function (id) { const r = records[id]; rs0(id); if (r && r.type === 'vault') sysDate('vd-' + id, vaultDateWant(records[id]), true); };
}

/* ---------- v2.24 (S3): main search finds Card & account details while unlocked (🔒 fields never searched or shown) ---------- */
function searchCards(q, box) {
  q = String(q || '').trim().toLowerCase(); if (!q || q.length < 2 || !finUnlocked() || window.GHOST || !box) return;
  const L = vaultAll().filter(e => [e.title, e.who, vKind(e.kind)[2], e.notes, ...(e.fields || []).filter(f => !f.s).flatMap(f => [f.l, f.v])].join(' ').toLowerCase().includes(q)).slice(0, 8);
  if (!L.length) return;
  box.insertAdjacentHTML('afterbegin', `<div class="group-title" style="margin-top:6px">🔐 Card &amp; account details</div>${L.map(e => { const f = (e.fields || []).find(x => !x.s && x.v && String(x.v).toLowerCase().includes(q)) || (e.fields || []).find(x => !x.s && x.v);
    return `<button type="button" class="sr cf-sr" data-scv="${e.id}"><b>${esc(e.title)}</b>${f ? `<small>${esc(f.l)}: <span class="mono">${esc(f.v)}</span></small>` : ''}</button>`; }).join('')}`);
  $$('[data-scv]', box).forEach(b => b.addEventListener('click', () => { Sheets.close('shSearch', true); vtQ = ''; openCards(); setTimeout(() => { const c = document.querySelector(`[data-vt="${b.dataset.scv}"]`); if (c) { c.scrollIntoView({ block: 'center' }); c.classList.add('flash'); } }, 400); }));
}

/* ---------- v2.24 (S4): task repeats ---------- */
function taskRepWord(r) {
  const W = { daily: 'daily', weekdays: 'weekdays', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly' };
  if (W[r]) return W[r];
  const m = /^e(\d+)([dwm])$/.exec(String(r || '')); if (!m) return String(r || '');
  return `every ${m[1]} ${{ d: 'day', w: 'week', m: 'month' }[m[2]]}${+m[1] > 1 ? 's' : ''}`;
}
function teRepShow(r) {
  const sel = $('teRepeat'), has = [...sel.options].some(o => o.value === r);
  sel.value = has ? r : /^e\d+[dwm]$/.test(r) ? 'custom' : 'none';
  const m = /^e(\d+)([dwm])$/.exec(r || ''); if (m && !has) { $('teRepN').value = m[1]; $('teRepU').value = m[2]; }
  $('teRepC').classList.toggle('hidden', sel.value !== 'custom');
}
function teRepRead() {
  const v = $('teRepeat').value; if (v !== 'custom') return v;
  const n = Math.max(1, Math.min(99, parseInt($('teRepN').value, 10) || 1)), u = $('teRepU').value;
  return n === 1 ? ({ d: 'daily', w: 'weekly', m: 'monthly' })[u] : `e${n}${u}`;
}
$('teRepeat').addEventListener('change', () => $('teRepC').classList.toggle('hidden', $('teRepeat').value !== 'custom'));

/* ---------- v2.24 (S8): a copied 🔒 field is wiped from the clipboard on your next tap in Register (after 30 s) ----------
   iPhone only lets a page write the clipboard during a tap, so the wipe happens on a tap, not on a timer. */
const Clip = { armedAt: 0 };
function clipArm() { Clip.armedAt = Date.now(); }
['click', 'touchend'].forEach(ev => document.addEventListener(ev, () => {
  if (!Clip.armedAt || Date.now() - Clip.armedAt < 30000) return;
  Clip.armedAt = 0;
  try { navigator.clipboard.writeText(' ').then(() => toast('The copied 🔒 value was wiped from the clipboard.', null, null, 3000)).catch(() => {}); } catch (e) {}
}, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && Clip.armedAt) Clip.armedAt = Math.min(Clip.armedAt, Date.now() - 30000); });   // back from pasting it elsewhere: the next tap wipes it

/* ---------- v2.24 (S9): each device notes its last sync, so Data health can list them ---------- */
function deviceId() { let id = lsGet('r2_devId'); if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); lsSet('r2_devId', id); } return id; }
function deviceGuess() { const u = navigator.userAgent || ''; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(u) ? 'Android phone' : /Windows/.test(u) ? 'Windows PC' : /Macintosh/.test(u) ? 'Mac' : 'Device'; }
function deviceSeen() {
  if (window.GHOST || !Sync.on()) return;
  const id = 'dev-' + deviceId(), r = records[id], now = nowMs();
  const c = recordSplit();
  if (r && !r.deleted && r.ver === APP_VERSION && now - (r.lastSync || 0) < (r.items === c.live ? 6 * 3600000 : 1800000)) return;   // at most every 6 hours (30 min when the count changed)
  put({ ...(r || { id, type: 'device', name: deviceGuess() }), ver: APP_VERSION, lastSync: now, items: c.live, trash: c.trash, deleted: false }, { render: false });
}
function healthExtra(add) {
  if (Math.abs(clockOff) >= 60000) { const m = Math.round(Math.abs(clockOff) / 60000);   // v2.36
    add('info', 'This device’s clock', `It is about ${m >= 120 ? Math.round(m / 60) + ' hours' : m + ' minute' + (m > 1 ? 's' : '')} ${clockOff > 0 ? 'behind' : 'ahead'}. Register corrects for this when deciding which change is newer, so nothing is lost — but set the date and time to automatic on this device.`); }
  const me = 'dev-' + deviceId(), devs = all('device').sort((a, b) => (b.lastSync || 0) - (a.lastSync || 0));
  if (devs.length) {
    const old = devs.filter(d => d.ver && d.ver !== APP_VERSION && Date.now() - (d.lastSync || 0) < 60 * 86400000);
    devs.forEach(d => { const isOld = old.includes(d);
      add(isOld ? 'warn' : 'ok', `${d.id === me ? 'This device' : 'Device'}: ${d.name || 'Device'}`, `Register v${d.ver || '?'} · synced ${timeAgo(d.lastSync || 0)} · ${(+d.items || 0).toLocaleString('en-IN')} items${isOld ? ' · older version — open Register on it with internet and reload to update' : ''}.`, d.id === me ? { label: 'Rename', fn: renameDevice } : { label: 'Forget', fn: () => forgetDevice(d.id) }); });   // v2.33
  }
  function renameDevice() {
        const r = records[me]; if (!r) { toast('Sync once first.'); return; }
        planSheet('Name this device', `<div class="field"><label>Name</label><input id="dvName" value="${esc(r.name || '')}" maxlength="30" placeholder="e.g. Rahul's iPhone, Office laptop"></div>`, () => { const v = $('dvName').value.trim(); if (!v) return false; r.name = v.slice(0, 30); put(r, { render: false }); toast('Saved.'); Sheets.close('shHealth', true); return true; }, 'Save');
  }
  if (Conf.list && Conf.list.length) add('warn', 'Changed on two devices', `${Conf.list.length} item${Conf.list.length > 1 ? 's' : ''} to choose a version for.`, { label: 'Review', fn: () => { Sheets.close('shHealth', true); openConflicts(); } });
  const fl = offFiles(); if (fl.length) { const n = fl.filter(fileOnDevice).length; add('info', 'Files on this device', `${n} of ${fl.length} document files open without downloading.`, { label: 'Manage', fn: () => { Sheets.close('shHealth', true); openOffline(); } }); }
}
setTimeout(() => confLoad(), 1500);
