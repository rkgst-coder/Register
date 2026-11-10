/* ==========================================================================
   v2.17
   ======================================================================== */
const V17_PAL = ['#9C2963', '#1B4B8F', '#2E7D50', '#B45309', '#6d5a8a', '#2c6e6a', '#8a4b12', '#3F4F8C', '#5b6e2f', '#6b3f5c'];
const ownHtml = s => esc(s);

/* ---------- 1. Today ---------- */
function todayData() {
  const t = todayISO(), nowM = isoMonth(new Date());
  const tasks = all('task').filter(x => x.status !== 'done' && x.dueDate && x.dueDate <= t).sort((a, b) => (a.dueDate + (a.dueTime || '99')).localeCompare(b.dueDate + (b.dueTime || '99')));
  const steps = []; all('task').filter(x => x.status !== 'done').forEach(x => (x.subs || []).map(normSub).forEach(s => { if (!s.done && s.dueDate && s.dueDate <= t) steps.push({ s, t: x }); }));
  const dates = dateRows(all('date').filter(d => d.when)).filter(x => x.days >= 0 && x.days <= 7);
  const bills = all('bill').map(b => ({ b, late: overduePeriods(b, nowM).length, now: billDueIn(b, nowM) && !payFor(b.id, nowM) })).filter(x => x.late || x.now);
  const docs = all('doc').filter(d => d.expiry && daysUntilISO(d.expiry) <= 30 && daysUntilISO(d.expiry) >= -10).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const inbox = all('inbox').length, sug = dateSuggestions().length;
  return { tasks, steps, dates, bills, docs, inbox, sug };
}
function updateTodayBadge() {
  const b = $('todayBadge'); if (!b) return;
  if (window.GHOST) { b.classList.add('hidden'); return; }
  const t = todayISO(), n = all('task').filter(x => x.status !== 'done' && x.dueDate && x.dueDate <= t).length + all('date').filter(d => d.when && isoLocal(nextOccurrence(d)) === t).length;
  b.textContent = n; b.classList.toggle('hidden', !n);
}
function openToday() {
  const D = window.GHOST ? { tasks: [], steps: [], dates: [], bills: [], docs: [], inbox: 0, sug: 0 } : todayData(), t = todayISO();
  const row = (k, id, title, sub, when, neg) => `<button class="td-row" data-tdk="${k}" data-tdid="${esc(id)}"><span class="t">${title}${sub ? `<small>${sub}</small>` : ''}</span>${when ? `<span class="w${neg ? ' neg' : ''}">${when}</span>` : ''}</button>`;
  const sec = (h, rows) => rows.length ? `<div class="group-title">${h}</div><div class="group">${rows.join('')}</div>` : '';
  let html = `<div class="td-h">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;
  html += sec(`☑︎ Tasks due (${D.tasks.length})`, D.tasks.map(x => row('task', x.id, esc(x.title), x.priority === 'High' ? 'High priority' : '', (x.dueDate < t ? 'overdue · ' : '') + (x.dueTime ? fmtTime12(x.dueTime) : relDay(x.dueDate)), x.dueDate < t)));
  html += sec(`↳ Steps due (${D.steps.length})`, D.steps.slice(0, 20).map(x => row('task', x.t.id, esc(x.s.text), 'in ' + esc(x.t.title), x.s.dueDate < t ? 'overdue' : 'today', x.s.dueDate < t)));
  html += sec(`📅 Dates · next 7 days (${D.dates.length})`, D.dates.map(x => row('date', x.d.id, esc(x.d.label), '', x.days === 0 ? 'today' : inDays(x.days), false)));
  html += sec(`🧾 Bills to pay (${D.bills.length})`, D.bills.map(x => row('bill', x.b.id, esc(x.b.label), x.late ? `${x.late} month${x.late > 1 ? 's' : ''} missed` : '', x.b.dueDay ? 'due on ' + x.b.dueDay : 'this month', !!x.late)));
  html += sec(`📁 Documents expiring · 30 days (${D.docs.length})`, D.docs.map(d => { const n = daysUntilISO(d.expiry); return row('doc', d.id, esc(d.title), esc(docOwners(d).join(' & ')), n < 0 ? 'expired' : inDays(n), n < 0); }));
  const more = [];
  if (D.inbox) more.push(row('inbox', 'x', `📥 ${D.inbox} item${D.inbox > 1 ? 's' : ''} in the Inbox to sort`, '', 'Sort ›'));
  if (D.sug) more.push(row('sug', 'x', `📅 ${D.sug} date${D.sug > 1 ? 's' : ''} found in your notes & tasks`, 'Add them to Dates, or say no', 'Review ›'));
  html += sec('To sort', more);
  if (!D.tasks.length && !D.steps.length && !D.dates.length && !D.bills.length && !D.docs.length && !more.length) html += '<div class="td-clear">☀︎<br><b>All clear for today.</b><br>Nothing due, nothing waiting.</div>';
  html += `<div class="btn-row" style="margin-top:14px;flex-wrap:wrap"><button class="btn ghost small" id="tdAdd">＋ Task for today</button><button class="btn ghost small" id="tdCap">📥 Capture</button><button class="btn ${weeklyDue() ? 'brass' : 'ghost'} small" id="tdWeek">🗓 Weekly review${weeklyDue() ? ' · due' : ''}</button></div>`;
  $('tdBody').innerHTML = html;
  $$('[data-tdk]', $('tdBody')).forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.tdk, id = b.dataset.tdid; Sheets.close('shToday', true);
    if (k === 'task') { showTab('tasks'); previewTask(id); }
    else if (k === 'date') { setPref('dateSeg', 'dates'); datePath = null; showTab('dates'); openDate(id); }
    else if (k === 'bill') { setPref('dateSeg', 'bills'); showTab('dates'); openBill(id); }
    else if (k === 'doc') { showTab('docs'); showDoc(id); }
    else if (k === 'inbox') openInbox();
    else if (k === 'sug') openDateSug();
  }));
  $('tdAdd').addEventListener('click', () => { Sheets.close('shToday', true); showTab('tasks'); openAdd('task'); setTimeout(() => { if ($('afTitle')) { $('afTitle').value = ' today'; $('afTitle').setSelectionRange(0, 0); taskGuess(); } }, 60); });
  $('tdCap').addEventListener('click', () => { Sheets.close('shToday', true); openCapture(); });
  $('tdWeek').addEventListener('click', () => { Sheets.close('shToday', true); openWeekly(); });
  if (!Sheets.isOpen('shToday')) Sheets.open('shToday');
}
$('todayFab').addEventListener('click', openToday);
function updateTodayTile() { const n = $('todayNum'); if (n) n.textContent = String(new Date().getDate()); }
updateTodayTile();
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateTodayTile(); });

/* ---------- 2. "Call CA tomorrow 5pm high" ---------- */
const fmtTime12 = hm => { const [h, m] = String(hm).split(':').map(Number); if (isNaN(h)) return ''; return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
function parseQuickAdd(text) {
  const out = parseQuickAddOld(text); let s = ' ' + out.title + ' ';
  // time: 5pm, 5 pm, 5:30pm, 17:30, at 5
  let m = s.match(/\s(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)(?=[\s,.]|$)/i);
  if (m && +m[1] >= 1 && +m[1] <= 12 && (!m[2] || +m[2] < 60)) { const h = (+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0); out.dueTime = String(h).padStart(2, '0') + ':' + (m[2] || '00'); s = s.replace(m[0], ' '); }
  else if ((m = s.match(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=[\s,.]|$)/))) { out.dueTime = String(+m[1]).padStart(2, '0') + ':' + m[2]; s = s.replace(m[0], ' '); }
  else if ((m = s.match(/\sat\s+(\d{1,2})(?=[\s,.]|$)/i)) && +m[1] >= 1 && +m[1] <= 12) { const h = +m[1]; out.dueTime = String(h <= 7 ? h + 12 : h).padStart(2, '0') + ':00'; s = s.replace(m[0], ' '); }
  // priority: only as the last word(s), or "priority high" anywhere ("high court" stays in the title)
  if (!out.priority) {
    if ((m = s.match(/\s(?:priority\s+(high|low|medium)|(high|low|medium)\s+priority)(?=[\s,.]|$)/i))) { const w = (m[1] || m[2]).toLowerCase(); out.priority = w === 'high' ? 'High' : w === 'low' ? 'Low' : 'Medium'; s = s.replace(m[0], ' '); }
    else if ((m = s.match(/\s(high|urgent|asap|important|low)\s*$/i))) { out.priority = /low/i.test(m[1]) ? 'Low' : 'High'; s = s.replace(new RegExp('\\s' + m[1] + '\\s*$', 'i'), ' '); }
  }
  // date: today, tomorrow, day after tomorrow, next week, weekdays, in 3 days, 15 Oct, 15/10
  if (!out.dueDate) {
    if ((m = s.match(/\s(?:on\s+|by\s+)?day after tomorrow(?=[\s,.]|$)/i))) { out.dueDate = addDays(2); s = s.replace(m[0], ' '); }
    else if ((m = s.match(/\s(?:by\s+)?next week(?=[\s,.]|$)/i))) { out.dueDate = addDays(7); s = s.replace(m[0], ' '); }
    else { const f = findDateIn(s); if (f && f.hit) { const i = s.toLowerCase().indexOf(f.hit.trim()); if (i >= 0) { out.dueDate = f.iso; s = (s.slice(0, i) + ' ' + s.slice(i + f.hit.trim().length)).replace(/\s(?:on|by|due)\s*$/i, ' ').replace(/\s(?:on|by|due)\s+(?=\s)/i, ' '); } } }
  }
  if (out.dueTime && !out.dueDate) { const now = new Date(), [h, mi] = out.dueTime.split(':').map(Number); out.dueDate = h * 60 + mi > now.getHours() * 60 + now.getMinutes() ? todayISO() : addDays(1); }
  out.title = s.replace(/\s(?:on|by|at|due)\s*$/i, ' ').replace(/\s{2,}/g, ' ').trim();
  return out;
}
function taskGuess() {
  const el = $('afTitle'); if (!el) return;
  const q = parseQuickAdd(el.value), g = classify(q.title);
  const cat = AF.cat !== 'auto' ? AF.cat : q.category || g.category;
  const prio = AF.prio !== 'auto' ? AF.prio : q.priority || g.priority;
  const due = q.dueDate || AF.due;
  $('afGuess').innerHTML = q.title ? `<b>${esc(q.title)}</b><br>${prio} priority${due ? ' · 📅 ' + relDay(due) : ''}${q.dueTime ? ' · ⏰ ' + fmtTime12(q.dueTime) : ''}` : 'Type it the way you say it: “Call CA tomorrow 5pm high”, “Pay LIC on 15 Oct”, “Submit report Friday”.';
}

/* ---------- 3. Face ID for the whole app, and auto-lock times ---------- */
async function pinHash(pin, salt) {
  const k = await crypto.subtle.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 200000, hash: 'SHA-256' }, k, 256)));
}
const AppLock = {
  KEY: 'r2_applock', fails: 0,
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { if (v) localStorage.setItem(this.KEY, JSON.stringify(v)); else localStorage.removeItem(this.KEY); } catch (e) {} },
  on() { return !!this.get(); },
  async enable(pin) {
    const cred = await navigator.credentials.create({ publicKey: { challenge: Bio.rnd(32), rp: { name: 'Register' }, user: { id: Bio.rnd(16), name: 'register-app', displayName: 'Register app lock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000,
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' } } });
    const salt = b64(Bio.rnd(16));
    this.set({ id: b64(cred.rawId), salt, hash: await pinHash(pin, salt), at: Date.now() });
  },
  check() {                                              // called inside the tap, so Face ID can start at once
    const a = this.get();
    return navigator.credentials.get({ publicKey: { challenge: Bio.rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(a.id) }], userVerification: 'required', timeout: 60000 } });
  },
  async pinOk(pin) { const a = this.get(); return !!a && (await pinHash(pin, a.salt)) === a.hash; }
};
/* v2.18: the PIN's wrong-try counter is kept on the device, so closing and reopening the app no longer resets it */
const PinLimit = {
  get() { try { return JSON.parse(localStorage.getItem('r2_pf') || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } },
  set(v) { try { localStorage.setItem('r2_pf', JSON.stringify(v)); } catch (e) {} },
  wait() { const v = this.get(); return Math.max(0, v.until - Date.now()); },
  fail() { const v = this.get(); v.n++; if (v.n >= 5) v.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, v.n - 5)); this.set(v); return this.wait(); },
  reset() { this.set({ n: 0, until: 0 }); }
};
function decoyUnlock() {
  if (!AppLock.on()) { hideDecoy(); return; }
  if (AppLock.fails >= 2 || !Bio.supported()) { if (PinLimit.wait()) return; $('alPin').classList.remove('hidden'); setTimeout(() => $('alPinIn').focus(), 50); return; }
  AppLock.check().then(() => { AppLock.fails = 0; hideDecoy(); }, e => { AppLock.fails++; RLOG.warn('app lock', e.name || e.message); });
}
{ const go = async () => {
    const v = $('alPinIn').value; $('alPinIn').value = '';
    if (PinLimit.wait()) { $('alPin').classList.add('hidden'); return; }
    if (await AppLock.pinOk(v)) { PinLimit.reset(); AppLock.fails = 0; $('alPin').classList.add('hidden'); hideDecoy(); }
    else if (PinLimit.fail()) $('alPin').classList.add('hidden');
  };
  $('alPinGo').addEventListener('click', go);
  $('alPinIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }); }
$('setAppLock').addEventListener('click', () => {
  if (AppLock.on()) { if (confirm('Turn off Face ID for opening Register on this device?')) { AppLock.set(null); $('setAppLockV').textContent = 'Off'; toast('Face ID to open is off.'); } return; }
  if (!Bio.supported()) { toast('Face ID needs the app installed on the Home Screen (iOS 16 or later).'); return; }
  $('alPin1').value = ''; $('alPin2').value = ''; $('alMsg').textContent = ''; Sheets.open('shAppLock');
});
$('alOn').addEventListener('click', async () => {
  const p1 = $('alPin1').value, p2 = $('alPin2').value, m = $('alMsg');
  if (!/^\d{4,}$/.test(p1)) { m.className = 'msg err'; m.textContent = 'Use 4 or more digits.'; return; }
  if (p1 !== p2) { m.className = 'msg err'; m.textContent = 'The two PINs do not match.'; return; }
  try {
    await AppLock.enable(p1);
    setPref('decoyLaunch', true); if ($('setDecoy')) $('setDecoy').checked = true;
    Sheets.close('shAppLock', true); $('setAppLockV').textContent = 'On'; toast('Face ID to open is on. The decoy screen comes first, then Face ID.');
  } catch (e) { m.className = 'msg err'; m.textContent = e.name === 'NotAllowedError' ? 'Face ID was cancelled — try again.' : (e.message || 'Could not turn on Face ID.'); }
});
$('setAppIdle').addEventListener('change', () => setPref('appIdle', +$('setAppIdle').value));
$('setMoneyIdle').addEventListener('change', () => setPref('moneyIdle', +$('setMoneyIdle').value));
setInterval(() => { const m = +prefs.appIdle; if (m > 0 && document.visibilityState === 'visible' && !document.documentElement.classList.contains('decoy-on') && Date.now() - lastTouch > m * 60000) hideNow(); }, 15000);

/* ---------- 4. merge documents · 6. people & categories · 7. new types · 8. move many ---------- */
const DOC_CFG = 'doc-cfg';
const DOC_GROUPS0 = DOC_GROUPS.map(g => [g[0], g[1].slice(), g[2]]), DOC_TYPES0 = DOC_TYPES.slice();
let docCfgStamp = null;
const docCfg = () => !window.GHOST && records[DOC_CFG] && !records[DOC_CFG].deleted ? records[DOC_CFG] : null;
function syncDocCfg() {
  const c = docCfg(), stamp = c ? c.updatedAt + ':' + (c.groups || []).length : 'none';
  if (stamp === docCfgStamp) return; docCfgStamp = stamp;
  DOC_GROUPS = c && c.groups && c.groups.length ? c.groups.map(g => [g.n, (g.t || []).slice(), g.i || '📁']) : DOC_GROUPS0.map(g => [g[0], g[1].slice(), g[2]]);
  DOC_TYPES = [...new Set([...DOC_TYPES0, ...((c && c.types) || [])])];
  const last = DOC_GROUPS[DOC_GROUPS.length - 1];
  DOC_TYPES.forEach(t => { if (!DOC_GROUPS.some(g => g[1].includes(t))) last[1].push(t); });
  DOC_TYPES.forEach((t, i) => { if (!DOC_COLORS[t]) DOC_COLORS[t] = V17_PAL[i % V17_PAL.length]; });
}
function docCfgEdit(fn) {
  syncDocCfg();
  const c0 = docCfg() || {};
  const c = { id: DOC_CFG, type: 'doccfg', people: [], ...JSON.parse(JSON.stringify(c0)), deleted: false };
  c.groups = DOC_GROUPS.map(g => ({ n: g[0], t: g[1].slice(), i: g[2] })); c.types = DOC_TYPES.filter(t => !DOC_TYPES0.includes(t));
  fn(c); put(c, { render: false }); docCfgStamp = null; syncDocCfg(); scheduleRender();
}
const docCfgPeople = () => ((docCfg() || {}).people || []);
function allDocPeople() { return orderPeople([...all('doc').flatMap(docOwners), ...docCfgPeople()]); }
function addDocType(name, grp) {
  name = String(name || '').trim(); if (!name) return null;
  const hit = DOC_TYPES.find(t => t.toLowerCase() === name.toLowerCase()); if (hit) return hit;
  docCfgEdit(c => { c.types.push(name); const g = c.groups.find(x => x.n === grp) || c.groups[c.groups.length - 1]; g.t.push(name); });
  return name;
}
function addDocGroup(name, icon) {
  name = String(name || '').trim(); if (!name) return;
  if (DOC_GROUPS.some(g => g[0].toLowerCase() === name.toLowerCase())) { toast('That category already exists.'); return; }
  docCfgEdit(c => { const t = DOC_TYPES.some(x => x.toLowerCase() === name.toLowerCase()) ? null : name;
    if (t) c.types.push(t); c.groups.splice(c.groups.length - 1, 0, { n: name, i: icon || '📁', t: t ? [t] : [] }); });
}
function renameDocGroup(old, nu) {
  nu = String(nu || '').trim(); if (!nu || nu === old) return;
  const into = DOC_GROUPS.find(g => g[0].toLowerCase() === nu.toLowerCase() && g[0] !== old);
  if (into && !confirm(`"${into[0]}" already exists. Put everything from "${old}" into "${into[0]}"?`)) return;
  docCfgEdit(c => { const g = c.groups.find(x => x.n === old); if (!g) return;
    if (into) { const t = c.groups.find(x => x.n === into[0]); t.t.push(...g.t); c.groups = c.groups.filter(x => x !== g); } else g.n = nu; });
  if (docPath.grp === old) docPath.grp = into ? into[0] : nu;
}
function deleteDocGroup(name, quiet) {
  const gi = DOC_GROUPS.findIndex(g => g[0] === name); if (gi < 0) return;
  if (gi === DOC_GROUPS.length - 1) { toast(`"${name}" is where everything else goes — it cannot be deleted. Rename it instead.`); return; }
  const g = DOC_GROUPS[gi], n = all('doc').filter(d => g[1].includes(d.docType)).length, other = DOC_GROUPS[DOC_GROUPS.length - 1][0];
  if (!quiet && !confirm(`Delete the category "${name}"?${n ? `\n\nIts ${n} document${n > 1 ? 's' : ''} stay safe and show under "${other}".` : ''}\nRecently deleted keeps it for 30 days — restoring it puts everything back.`)) return;
  put({ id: uid('cb'), type: 'catbin', what: 'docgrp', grp: { n: g[0], t: g[1].slice(), i: g[2] }, deleted: true, deletedAt: nowMs() }, { render: false });
  docCfgEdit(c => { const x = c.groups.find(y => y.n === name); c.groups[c.groups.length - 1].t.push(...x.t); c.groups = c.groups.filter(y => y !== x); });
  if (docPath.grp === name) docPath.grp = null;
  if (!quiet) toast(`Deleted "${name}" — in Recently deleted for 30 days.`);
}
function setTypeGroup(type, grp) { docCfgEdit(c => { c.groups.forEach(g => { g.t = g.t.filter(t => t !== type); }); (c.groups.find(g => g.n === grp) || c.groups[c.groups.length - 1]).t.push(type); }); }
function renamePerson(old, nu, quiet) {
  nu = normWho(nu); if (!nu || nu === old) return;
  if (/&/.test(nu)) { toast('One name only.'); return; }
  const merging = allDocPeople().includes(nu);
  if (merging && !quiet && !confirm(`"${nu}" already exists. Move all of ${old}'s documents to ${nu}?`)) return;
  all('doc').forEach(d => { const o = docOwners(d); if (!o.includes(old)) return; d.who = normWho([...new Set(o.map(p => p === old ? nu : p))].join(' & ')); put(d, { render: false }); if (d.expiry && typeof syncDocDate === 'function') syncDocDate(d); });
  docCfgEdit(c => { c.people = [...new Set((c.people || []).map(p => p === old ? nu : p))]; });
  if (docPath.who === old) docPath.who = nu;
}
function movePersonAll(from) { openDocMove(all('doc').filter(d => docOwners(d).includes(from)).map(d => d.id), `All of ${from}'s documents`); }
function moveDocs(ids, who, grp) {
  syncDocCfg(); let n = 0;
  const g = grp ? DOC_GROUPS.find(x => x[0] === grp) : null;
  let gType = g ? g[1][0] : null;
  if (g && !gType) { gType = addDocType(g[0], g[0]); }
  ids.forEach(id => { const d = records[id]; if (!d || d.deleted) return;
    if (who) d.who = normWho(who);
    if (g && !g[1].includes(d.docType)) d.docType = gType;
    put(d, { render: false }); n++; if (d.expiry && typeof syncDocDate === 'function') syncDocDate(d); });
  if (who && !allDocPeople().includes(normWho(who))) docCfgEdit(c => { c.people = [...new Set([...(c.people || []), normWho(who)])]; });
  docSel = null; scheduleRender(); toast(`Moved ${n} document${n === 1 ? '' : 's'}.`);
}
function openDocMove(ids, what) {
  syncDocCfg(); if (!ids.length) { toast('Nothing to move.'); return; }
  const people = allDocPeople();
  $('daTitle').textContent = 'Move';
  $('daBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">${esc(what || `${ids.length} document${ids.length > 1 ? 's' : ''}`)} → choose where they go. Files stay attached.</p>
    <div class="field"><label>Person (main folder)</label><select id="daWho"><option value="">— keep as it is —</option>${people.map(p => `<option value="${esc(p)}">👤 ${esc(p)}</option>`).join('')}<option value="__new">＋ New person…</option></select>
      <input id="daWhoNew" class="hidden" placeholder="Name" autocomplete="off" style="margin-top:8px"></div>
    <div class="field"><label>Category (sub-folder)</label><select id="daGrp"><option value="">— keep as it is —</option>${DOC_GROUPS.map(g => `<option value="${esc(g[0])}">${g[2]} ${esc(g[0])}</option>`).join('')}</select></div>
    <p class="hint">A document shared by two people (“Rahul &amp; Ruchi”) gets only the person you pick.</p>
    <button class="btn block brass" id="daGo">Move ${ids.length}</button>`;
  $('daWho').addEventListener('change', () => $('daWhoNew').classList.toggle('hidden', $('daWho').value !== '__new'));
  $('daGo').addEventListener('click', () => {
    const w = $('daWho').value === '__new' ? $('daWhoNew').value.trim() : $('daWho').value, gp = $('daGrp').value;
    if (!w && !gp) { toast('Pick a person or a category.'); return; }
    Sheets.close('shDocAct', true); moveDocs(ids, w, gp);
  });
  Sheets.open('shDocAct');
}
async function mergeDocs(keepId, ids) {
  const k = records[keepId]; if (!k) return;
  const others = ids.filter(id => id !== keepId).map(id => records[id]).filter(Boolean);
  let files = 0;
  others.forEach(o => {
    docFilesOf(o.id).forEach(f => { f.docId = keepId; if (f.fy && !k.byYear) k.byYear = true; put(f, { render: false }); files++; });
    ['expiry', 'issuer', 'fy', 'folder', 'dueKind'].forEach(p => { if (!k[p] && o[p]) k[p] = o[p]; });
    if (!k.number && !k.numEnc) { if (o.number) k.number = o.number; else if (o.numEnc) { k.numEnc = o.numEnc; k.numTail = o.numTail; } }
    if (o.notes && o.notes.trim() && !(k.notes || '').includes(o.notes.trim())) k.notes = [k.notes, o.notes].filter(x => x && x.trim()).join('\n\n');
    if (o.lockFiles) k.lockFiles = true;
    all('date').filter(x => x.docRef === o.id).forEach(x => softDelete(x.id, { render: false }));
    o.mergedInto = keepId; softDelete(o.id, { render: false });
  });
  put(k, { render: false }); if (k.expiry && typeof syncDocDate === 'function') syncDocDate(k);
  docSel = null; scheduleRender();
  const loose = k.lockFiles && docFilesOf(k.id).some(f => !f.locked);
  if (loose && Fin.key) { try { await convertDocFiles(k); } catch (e) { RLOG.warn('merge lock', e.message); } }
  toast(`Merged into "${k.title}" — ${docFilesOf(k.id).length} file${docFilesOf(k.id).length === 1 ? '' : 's'}.${loose && !Fin.key ? ' Some files are not locked yet: unlock, then “Finish locking” in the document.' : ''}`, 'Open', () => { showTab('docs'); showDoc(k.id); }, 7000);
}
function openDocMerge(ids) {
  const docs = ids.map(id => records[id]).filter(d => d && !d.deleted);
  if (docs.length < 2) { toast('Pick two or more documents to merge.'); return; }
  $('daTitle').textContent = 'Merge';
  $('daBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">All files come under one entry. Pick the entry to keep — its name, person and type stay; empty details (number, expiry, issuer) are filled from the others. The other entries go to Recently deleted.</p>
    <div class="group">${docs.map((d, i) => `<label class="dm-opt"><input type="radio" name="dmKeep" value="${d.id}"${i === 0 ? ' checked' : ''}><span><b>${esc(d.title)}</b><br><small class="muted">${esc(docOwners(d).join(' & '))} · ${esc(d.docType)} · ${docFilesOf(d.id).length} file${docFilesOf(d.id).length === 1 ? '' : 's'}${d.lockFiles ? ' · 🔒' : ''}</small></span></label>`).join('')}</div>
    <button class="btn block brass" id="dmGo">Merge ${docs.length} into one</button>`;
  $('dmGo').addEventListener('click', () => { const keep = (document.querySelector('[name="dmKeep"]:checked') || {}).value; Sheets.close('shDocAct', true); mergeDocs(keep, docs.map(d => d.id)); });
  Sheets.open('shDocAct');
}
const GROUP_ICONS = ['📁', '🎓', '🪪', '📜', '🏛', '🗂', '💰', '🩺', '🏠', '🚗', '🖼', '📄', '✈️', '⚖️', '🧾', '🏦', '👪', '🛡'];
function openDocFolders() {
  syncDocCfg();
  const docs = all('doc'), people = allDocPeople();
  $('dfBody').innerHTML = `<div class="group-title">People — main folders</div><div class="group">${people.map(p => { const n = docs.filter(d => docOwners(d).includes(p)).length;
      return `<div class="df-row"><b>👤 ${esc(p)}</b><span class="muted">${n}</span><button data-dfren="${esc(p)}">Rename</button>${n ? `<button data-dfmv="${esc(p)}">Move all…</button>` : `<button data-dfrm="${esc(p)}">Remove</button>`}</div>`; }).join('')}
      <div class="df-row"><input id="dfNewP" placeholder="New person" autocomplete="off" style="flex:1;min-width:0"><button id="dfAddP">＋ Add</button></div></div>
    <p class="hint" style="margin:4px 4px 12px">Renaming to a name that already exists merges the two people.</p>
    <div class="group-title">Categories — sub-folders</div><div class="group">${DOC_GROUPS.map((g, gi) => { const n = docs.filter(d => g[1].includes(d.docType)).length;
      return `<div class="df-row"><b>${g[2]} ${esc(g[0])}</b><span class="muted">${n}</span><button data-dgren="${esc(g[0])}">Rename</button>${gi < DOC_GROUPS.length - 1 ? `<button data-dgdel="${esc(g[0])}">Delete</button>` : ''}
        <div class="df-types">${g[1].map(t => `<button data-dtype="${esc(t)}" title="Move this type to another category">${esc(t)}</button>`).join('') || '<small>no types</small>'}</div></div>`; }).join('')}
      <div class="df-row"><select id="dfIcon" style="width:auto">${GROUP_ICONS.map(i => `<option>${i}</option>`).join('')}</select><input id="dfNewG" placeholder="New category" autocomplete="off" style="flex:1;min-width:0"><button id="dfAddG">＋ Add</button></div></div>
    <p class="hint" style="margin:4px 4px 12px">A category holds document types. Tap a type to move it to another category. The last category takes everything that belongs nowhere else.</p>
    <div class="group-title">Move a type</div><div class="group" style="padding:10px 14px"><div class="new-type" style="margin:0"><select id="dfT">${DOC_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select><span>→</span><select id="dfG">${DOC_GROUPS.map(g => `<option value="${esc(g[0])}">${g[2]} ${esc(g[0])}</option>`).join('')}</select><button class="btn small" id="dfTGo">Move</button></div></div>`;
  const re = () => openDocFolders();
  $$('[data-dfren]', $('dfBody')).forEach(b => b.addEventListener('click', () => { const nu = prompt(`New name for ${b.dataset.dfren}`, b.dataset.dfren); if (nu) { renamePerson(b.dataset.dfren, nu); setTimeout(re, 50); } }));
  $$('[data-dfmv]', $('dfBody')).forEach(b => b.addEventListener('click', () => { Sheets.close('shDocFolders', true); movePersonAll(b.dataset.dfmv); }));
  $$('[data-dfrm]', $('dfBody')).forEach(b => b.addEventListener('click', () => { docCfgEdit(c => { c.people = (c.people || []).filter(p => p !== b.dataset.dfrm); }); setTimeout(re, 50); }));
  $('dfAddP').addEventListener('click', () => { const v = normWho($('dfNewP').value); if (!v || /&/.test(v)) return; docCfgEdit(c => { c.people = [...new Set([...(c.people || []), v])]; }); toast(`Added ${v}.`); setTimeout(re, 50); });
  $$('[data-dgren]', $('dfBody')).forEach(b => b.addEventListener('click', () => { const nu = prompt(`New name for "${b.dataset.dgren}"`, b.dataset.dgren); if (nu) { renameDocGroup(b.dataset.dgren, nu); setTimeout(re, 50); } }));
  $$('[data-dgdel]', $('dfBody')).forEach(b => b.addEventListener('click', () => { deleteDocGroup(b.dataset.dgdel); setTimeout(re, 50); }));
  $$('[data-dtype]', $('dfBody')).forEach(b => b.addEventListener('click', () => { $('dfT').value = b.dataset.dtype; $('dfG').focus(); $('dfT').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  $('dfAddG').addEventListener('click', () => { addDocGroup($('dfNewG').value, $('dfIcon').value); setTimeout(re, 50); });
  $('dfTGo').addEventListener('click', () => { setTypeGroup($('dfT').value, $('dfG').value); toast(`"${$('dfT').value}" is now in ${$('dfG').value}.`); setTimeout(re, 50); });
  if (!Sheets.isOpen('shDocFolders')) Sheets.open('shDocFolders');
}
function renderDocs() {
  syncDocCfg(); renderDocsBase(); renderVaultCard();
  const fbox = $('docFolders'); if (!fbox || window.GHOST) return;
  const crumb = fbox.querySelector('.doc-crumb'); if (!crumb) return;
  let items = [];   // v2.27: one ⋯ menu instead of a row of buttons
  if (docPath.who && !docPath.grp) {
    items = [['new', '＋ Document here'], ['gnew', '＋ New category'], ['ren', '✎ Rename person'], ['mv', '⇢ Move all…'], ...(FAM_PEOPLE.includes(docPath.who) ? [['chk', '✅ Checklist']] : []), ['em', '🆘 Emergency sheet'], ['zip', '⤓ Download all (zip)'], ['off', '📱 Keep on this device']];
    if (!all('doc').some(d => docOwners(d).includes(docPath.who))) fbox.insertAdjacentHTML('beforeend', '<div class="empty">No documents for this person yet.</div>');
  } else if (docPath.grp) {
    items = [['gnew2', '＋ Document here'], ['gren', '✎ Rename category'], ['gmv', '⇢ Move these…'], ['off', '📱 Keep on this device'], ['gdel', '🗑 Delete category', 'danger']];
  }
  if (!items.length) return;
  const more = document.createElement('button'); more.className = 'crumb-more'; more.setAttribute('aria-label', 'Actions'); more.setAttribute('aria-haspopup', 'menu'); more.textContent = '⋯';
  crumb.appendChild(more);
  const acts = { querySelectorAll: () => [] };
  const who = docPath.who, grp = docPath.grp, here = () => all('doc').filter(d => docOwners(d).includes(who) && (!grp || docGroup(d) === grp)).map(d => d.id);
  const run = a => {
    if (a === 'ren') { const nu = prompt(`New name for ${who}`, who); if (nu) renamePerson(who, nu); }
    else if (a === 'mv') movePersonAll(who);
    else if (a === 'new') openAdd('doc');
    else if (a === 'gren') { const g = DOC_GROUPS.find(x => x[0] === grp); catNameSheet('Rename category', grp, g ? g[2] : '📁', (n, i) => { renameDocGroup(grp, n); docCfgEdit(c => { const x = c.groups.find(y => y.n === n); if (x) x.i = i; }); toast('Renamed.'); }); }
    else if (a === 'gnew') catNameSheet('New document category', '', '📁', (n, i) => { addDocGroup(n, i); toast(`Added "${n}". Documents of type “${n}” go here.`); });
    else if (a === 'gnew2') openAdd('doc');
    else if (a === 'gmv') openDocMove(here(), `${who}'s ${grp}`);
    else if (a === 'gdel') deleteDocGroup(grp);
    else if (a === 'chk') openFamily(who);
    else if (a === 'em') openEmergency(who);
    else if (a === 'zip') exportPersonZip(who);
    else if (a === 'off') keepOffline(here().map(id => records[id]), grp ? `${who}'s ${grp}` : `${who}'s documents`);
  };
  more.addEventListener('click', () => popMenu(more, items.map(([k, l, cls]) => ({ l, cls, fn: () => run(k) }))));
}
/* v2.27: a small menu under a button */
function popMenu(anchor, items) {
  const old = $('popMenu'); if (old) { old.remove(); if (old.dataset.for === anchor.id + anchor.className) return; }
  const m = document.createElement('div'); m.className = 'pop-menu'; m.id = 'popMenu'; m.setAttribute('role', 'menu'); m.dataset.for = anchor.id + anchor.className;
  m.innerHTML = items.map((x, i) => `<button role="menuitem" data-pm="${i}" class="${x.cls || ''}">${esc(x.l)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(), W = m.offsetWidth || 240, H = m.offsetHeight || 200;
  m.style.top = Math.max(8, Math.min(window.innerHeight - H - 8, r.bottom + 6)) + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, r.right - W)) + 'px';
  const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (!m.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  $$('[data-pm]', m).forEach(b => b.addEventListener('click', () => { close(); try { items[+b.dataset.pm].fn(); } catch (e) { RLOG.error('menu', e); } }));
}
$('docMoreBtn').addEventListener('click', () => popMenu($('docMoreBtn'), [
  { l: '🗂 People & categories', fn: openDocFolders }, { l: '✅ Family checklist', fn: () => openFamily() },
  { l: '📱 Keep on this device…', fn: () => keepOffline(all('doc'), 'all documents') }]));
function renderSelBar() {
  renderSelBarBase();
  if (!docSel) return;
  const n = docSel.size; $('docSelMove').disabled = !n; $('docSelMerge').disabled = n < 2;
}
$('docSelMove').addEventListener('click', () => docSel && openDocMove([...docSel]));
$('docSelMerge').addEventListener('click', () => docSel && openDocMerge([...docSel]));
$('docSelOff').addEventListener('click', () => { if (!docSel || !docSel.size) { toast('Pick documents first.'); return; } const L = [...docSel].map(id => records[id]); docSel = null; renderDocs(); keepOffline(L, L.length + ' documents'); });
$('docFoldersBtn').addEventListener('click', openDocFolders);
$('docFamBtn').addEventListener('click', () => openFamily());
$('docAddBtn').addEventListener('click', () => openAdd('doc'));
function openDoc(id) {
  syncDocCfg(); openDocBase(id);
  const d = records[id]; if (!d) return;
  const draw = sel => {
    chipGroup($('doType'), DOC_TYPES, sel, () => {}, t => DOC_COLORS[t]);
    $('doType').insertAdjacentHTML('beforeend', '<button class="chip" id="doTypeNew" type="button">＋ New type</button>');
    $('doTypeNew').addEventListener('click', () => { $('doNewTypeW').classList.toggle('hidden'); $('doNewType').focus(); });
  };
  draw(d.docType);
  $('doNewTypeW').classList.add('hidden'); $('doNewType').value = '';
  const cur = DOC_GROUPS.find(g => g[1].includes(d.docType));
  $('doNewTypeGrp').innerHTML = DOC_GROUPS.map(g => `<option value="${esc(g[0])}"${(docPath.grp || (cur && cur[0])) === g[0] ? ' selected' : ''}>${g[2]} ${esc(g[0])}</option>`).join('');
  $('doNewTypeAdd').onclick = () => { const t = addDocType($('doNewType').value, $('doNewTypeGrp').value); if (!t) return; draw(t); $('doNewTypeW').classList.add('hidden'); $('doNewType').value = ''; toast(`Type "${t}" added in ${(DOC_GROUPS.find(g => g[1].includes(t)) || [''])[0]}.`); };
}

/* ---------- 5. PDFs in the Inbox ---------- */
const isPdfBlob = b => !!(b && (/pdf/i.test(b.mime || '') || /\.pdf$/i.test(b.name || '')));
const isFileBlob = b => isPdfBlob(b) || (!!b && ['xls', 'csv', 'word', 'txt'].includes(fileKind(b)));   // v2.35: a shared Word / Excel / text file
function capShow() { $('capImgs').innerHTML = CAP.files.map((f, i) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name || '') ? `<span class="cap-pdf">📄 ${esc(f.name || 'file.pdf')}</span>` : `<img src="${URL.createObjectURL(f)}" alt="photo ${i + 1}">`).join(''); }
const fileToDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error || new Error('could not read the file')); r.readAsDataURL(f); });
async function storePdfs(files) {
  const ids = [], bad = [];
  for (const f of files) {
    try {
      if (!driveOn()) throw new Error('PDFs need the Drive folder (Settings → Sync)');
      if (f.size > ONE_MSG_MAX) throw new Error('larger than 20 MB');
      let url = await fileToDataUrl(f); if (!/^data:application\/pdf/.test(url)) url = 'data:application/pdf;base64,' + url.slice(url.indexOf(',') + 1);
      const name = (f.name || 'file.pdf').replace(/[^\w.\- ()]/g, '_'), fileId = await driveUpload(url, todayISO() + '-' + name);
      memImg.set(fileId, url); DB.imgSet(fileId, url).catch(() => {});
      ids.push(put({ id: uid('img'), type: 'blob', drive: true, fileId, name, mime: 'application/pdf', bytes: f.size, deleted: false }, { render: false }).id);
    } catch (e) { RLOG.warn('inbox pdf', e.message); bad.push(`${f.name || 'PDF'}: ${e.message}`); }
  }
  if (bad.length) toast('Not saved: ' + bad.join('; '), null, null, 7000);
  return ids;
}
function ibThumb(b) { const r = records[b]; return isFileBlob(r) ? `<button class="ib-pdf" data-ibpdf="${b}">📄 ${esc(r.name || 'PDF')}</button>` : `<img data-blob="${b}" alt="photo">`; }
async function openBlobPdf(id) {
  try { const r = records[id], src = await imgSrc(r), blob = await (await fetch(src)).blob();
    if (!isPdfBlob(r)) { dl(new Blob([blob], { type: DOC_EXT_MIME[extOf(r.name)] || blob.type }), r.name || 'file'); return; }   // v2.35: Word / Excel / text — saved to open in its own app
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 120000); }
  catch (e) { toast('Could not open the PDF: ' + e.message); }
}
function inboxDone(i, keepImgs, keep) {
  if (keep && keep.length) { i.imgs = keep; i.text = ''; put(i, { render: false }); toast('PDFs stay in the Inbox — send them to a Document.'); renderInboxCard(); return; }
  inboxDoneBase(i, keepImgs);
}

/* ---------- 9. dates found in notes and tasks (you accept or decline) ---------- */
const DSUG_ID = 'date-sug';
const dsugCfg = () => records[DSUG_ID] && !records[DSUG_ID].deleted ? records[DSUG_ID] : { dec: {} };
function datesInText(text) {
  const s = String(text || ''), low = s.toLowerCase(), t = todayISO(), out = [], taken = [];
  const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? isoLocal(dt) : null; };
  const next = (mo, d) => { const y = +t.slice(0, 4); for (let k = 0; k < 5; k++) { const r = ok(y + k, mo, d); if (r && r >= t) return r; } return null; };
  const add = (m, iso, noYear) => {
    const a = m.index, b = a + m[0].length; if (!iso || taken.some(([x, y]) => a < y && b > x)) return; taken.push([a, b]);
    if (!noYear && iso < t) return;
    const ls = s.lastIndexOf('\n', a) + 1, le = s.indexOf('\n', b);
    out.push({ iso, noYear, hit: s.slice(a, b), line: s.slice(ls, le < 0 ? s.length : le).trim() });
  };
  let m;
  const R1 = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d.])/g, R2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g, R3 = new RegExp(DRX1.source, 'g'), R4 = new RegExp(DRX2.source, 'g');
  while ((m = R2.exec(low))) add(m, ok(+m[1], +m[2], +m[3]));
  while ((m = R1.exec(low))) add(m, ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]));
  while ((m = R3.exec(low))) add(m, m[3] ? ok(+m[3], MON3[m[2].slice(0, 3)], +m[1]) : next(MON3[m[2].slice(0, 3)], +m[1]), !m[3]);
  while ((m = R4.exec(low))) add(m, m[3] ? ok(+m[3], MON3[m[1].slice(0, 3)], +m[2]) : next(MON3[m[1].slice(0, 3)], +m[2]), !m[3]);
  return out;
}
function dateSuggestions() {
  if (window.GHOST) return [];
  const dec = dsugCfg().dec || {}, seen = new Set(), out = [], dates = all('date');
  const scan = (src, kind, title, text) => datesInText(text).forEach(h => {
    const key = src.id + '|' + (h.noYear ? h.iso.slice(5) : h.iso) + '|' + h.hit.toLowerCase().replace(/\s+/g, ' ');
    if (dec[key] || seen.has(key)) return; seen.add(key);
    let label = h.line.replace(new RegExp('(?:\\b(?:on|by|due|dated?|till|until|from|before|dt\\.?)\\s+)?' + h.hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    label = label.replace(/\s(?:on|by|due|dated?|till|until|from|before)\s*$/i, ' ').replace(/^[\s\-–—•*:;,.]+|[\s\-–—•*:;,.]+$/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 70) || title || 'Date';
    if (dates.some(d => (d.when === h.iso || (h.noYear && (d.when || '').slice(5) === h.iso.slice(5))) && d.label.toLowerCase() === label.toLowerCase())) return;
    out.push({ key, iso: h.iso, noYear: h.noYear, label, src: src.id, kind, title: title || '' });
  });
  all('note').forEach(n => scan(n, 'note', n.title || 'Note', (n.title || '') + '\n' + (n.text || '')));
  all('task').filter(x => x.status !== 'done' && !x.fromDate).forEach(x => scan(x, 'task', x.title, [x.title, x.notes || '', ...(x.subs || []).map(s => (s.text || '') + ' ' + (s.notes || ''))].join('\n')));
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}
function dsugDecide(keys, how) {
  const c = { id: DSUG_ID, type: 'datesug', dec: {}, ...JSON.parse(JSON.stringify(dsugCfg())), deleted: false };
  keys.forEach(k => { c.dec[k] = how; }); put(c, { render: false });
}
function dsugAdd(list) {
  const made = [];
  list.forEach(x => { const cat = guessDateCat({ label: x.label });
    made.push(put({ id: uid('d'), type: 'date', label: x.label, when: x.iso, repeat: YEARLY_CATS.includes(cat) || (x.noYear && /birthday|anniversar|bday/i.test(x.label)) ? 'yearly' : 'once', cat, srcRef: x.src, deleted: false }, { render: false })); });
  dsugDecide(list.map(x => x.key), 'ok'); scheduleRender();
  return made;
}
function dsugRowsHtml(list) {
  return list.map(x => `<div class="attn-row" data-dsk="${esc(x.key)}"><button class="attn-go" data-dsopen="${esc(x.src)}" data-dskind="${x.kind}">📅 ${esc(x.label)} · <b>${fmtDate(x.iso, true)}</b>${x.noYear ? ' (every year?)' : ''}<small class="ds-from">from ${x.kind} “${esc(x.title.slice(0, 50))}”</small></button><button class="attn-ok" data-dsadd="1">＋ Add</button><button class="attn-ok" data-dsno="1" aria-label="Not a date to keep">✕</button></div>`).join('');
}
function bindDsug(root, list, after) {
  const byKey = new Map(list.map(x => [x.key, x]));
  $$('[data-dsk]', root).forEach(r => {
    const x = byKey.get(r.dataset.dsk); if (!x) return;
    r.querySelector('[data-dsadd]').addEventListener('click', () => { const [d] = dsugAdd([x]); toast(`Added to Dates: ${x.label}.`, 'Edit', () => { showTab('dates'); openDate(d.id); }); after(); });
    r.querySelector('[data-dsno]').addEventListener('click', () => { dsugDecide([x.key], 'no'); after(); });
    r.querySelector('[data-dsopen]').addEventListener('click', () => { Sheets.closeAll(); if (x.kind === 'note') { showTab('notes'); previewNote(x.src); } else { showTab('tasks'); previewTask(x.src); } });
  });
}
function openDateSug() {
  const L = dateSuggestions();
  $('dsgBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Dates written inside your notes and tasks (not task due dates). Nothing goes into Dates until you tap ＋ Add. ✕ means "not needed" — it will not be suggested again.</p>`
    + (L.length ? `<div class="btn-row" style="margin:0 0 10px"><button class="btn ghost small" id="dsgAll">＋ Add all ${L.length}</button><button class="btn ghost small" id="dsgNone">✕ Decline all</button></div><div class="group attn">${dsugRowsHtml(L)}</div>` : '<div class="empty">No new dates found in your notes and tasks.</div>');
  bindDsug($('dsgBody'), L, openDateSug);
  if ($('dsgAll')) $('dsgAll').addEventListener('click', () => { if (confirm(`Add all ${L.length} to Dates?`)) { dsugAdd(L); openDateSug(); } });
  if ($('dsgNone')) $('dsgNone').addEventListener('click', () => { if (confirm(`Decline all ${L.length}? They will not be suggested again.`)) { dsugDecide(L.map(x => x.key), 'no'); openDateSug(); } });
  if (!Sheets.isOpen('shDateSug')) Sheets.open('shDateSug');
}
/* Needs attention, with the new "Dates found" section */
function renderAttn() {
  renderAttnBase();
  const box = $('docAttn'); if (!box || docPath.who || window.GHOST) return;
  const L = dateSuggestions(); if (!L.length) return;
  let det = box.querySelector('details.attn');
  if (!det) { box.innerHTML = '<details class="attn"><summary>⚠︎ Needs attention</summary></details>'; det = box.querySelector('details.attn'); }
  const sum = det.querySelector('summary'); const n0 = +(((sum.textContent.match(/\((\d+)\)/) || [])[1]) || 0);
  sum.firstChild.textContent = `⚠︎ Needs attention (${n0 + L.length})`;
  const sm = sum.querySelector('small'); if (sm) sm.textContent = (sm.textContent && !/Everything is marked OK/.test(sm.textContent) ? sm.textContent + ' · ' : '') + `${L.length} date${L.length > 1 ? 's' : ''} found in notes & tasks`;
  const sec = document.createElement('div'); sec.className = 'attn-sec';
  sec.innerHTML = `<div class="attn-head"><b>Dates found in notes &amp; tasks (${L.length})</b><button data-dsgall="1">Review all ›</button></div>${dsugRowsHtml(L.slice(0, 15))}${L.length > 15 ? `<small class="muted">…and ${L.length - 15} more</small>` : ''}`;
  const foot = det.querySelector('.attn-foot'); foot ? det.insertBefore(sec, foot) : det.appendChild(sec);
  bindDsug(sec, L, renderAttn);
  sec.querySelector('[data-dsgall]').addEventListener('click', openDateSug);
}

/* ---------- 10. search suggestions ---------- */
const RECENT_Q = 'r2_recentQ';
const recentQ = () => { try { return JSON.parse(localStorage.getItem(RECENT_Q) || '[]'); } catch (e) { return []; } };
function rememberQ(q) { q = String(q || '').trim(); if (q.length < 2 || window.GHOST) return; try { localStorage.setItem(RECENT_Q, JSON.stringify([q, ...recentQ().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8))); } catch (e) {} }
function searchPool() {
  if (window.GHOST) return [];
  syncDocCfg();
  const P = new Set();
  allDocPeople().forEach(p => P.add(p)); DOC_GROUPS.forEach(g => P.add(g[0])); DOC_TYPES.forEach(t => P.add(t));
  all('doc').forEach(d => P.add(d.title)); all('task').filter(t => t.status !== 'done').forEach(t => P.add(t.title)); all('note').forEach(n => n.title && P.add(n.title)); all('date').forEach(d => P.add(d.label));
  (dateCats() || []).forEach(c => P.add(c[1]));
  return [...P].filter(x => x && x.length < 60);
}
function searchSuggest(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const words = q.split(/\s+/), last = words[words.length - 1], head = words.slice(0, -1).join(' ');
  const hits = searchPool().filter(x => { const l = x.toLowerCase(); return l !== q && (l.startsWith(q) || l.split(/[^a-z0-9]+/).some(w => w.startsWith(last))); })
    .sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 8);
  return hits.map(h => h.toLowerCase().startsWith(q) || !head ? h : head + ' ' + h);
}
function runSearch() {
  runSearchBase();
  const q = $('searchIn').value, box = $('searchRes'); if (window.GHOST) return;
  const pick = s => { $('searchIn').value = s; rememberQ(s); runSearch(); $('searchIn').focus(); };
  if (!q.trim()) {
    const rec = recentQ(), fin = finUnlocked();
    const tries = ['expiring soon', 'birthdays this month', 'what is due this week', 'documents of ' + (allDocPeople()[1] || DOC_ME).toLowerCase(), ...(fin ? ['spent this month', 'balance this month', 'who owes me'] : [])];
    const people = allDocPeople().slice(0, 6), cats = DOC_GROUPS.slice(0, 8).map(g => g[0]);
    box.insertAdjacentHTML('afterbegin', `<div class="sug-panel">${rec.length ? `<div class="sug-t"><span>Recent</span><button class="linkbtn" id="sugClr" style="font-size:.75rem;padding:0">Clear</button></div><div class="sug-chips">${rec.map(s => `<button data-sug="${esc(s)}">🕘 ${esc(s)}</button>`).join('')}</div>` : ''}
      <div class="sug-t"><span>Try</span></div><div class="sug-chips">${tries.map(s => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="sug-t"><span>People</span></div><div class="sug-chips">${people.map(s => `<button data-sug="${esc(s)}">👤 ${esc(s)}</button>`).join('')}</div>
      <div class="sug-t"><span>Document categories</span></div><div class="sug-chips">${cats.map(s => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`);
    if ($('sugClr')) $('sugClr').addEventListener('click', () => { try { localStorage.removeItem(RECENT_Q); } catch (e) {} runSearch(); });
  } else {
    const L = searchSuggest(q);
    if (L.length) box.insertAdjacentHTML('afterbegin', `<div class="sug-row">${L.map(s => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>`);
    $$('.sr', box).forEach(b => b.addEventListener('click', () => rememberQ(q), { capture: true }));
  }
  $$('[data-sug]', box).forEach(b => b.addEventListener('click', () => pick(b.dataset.sug)));
  savedSearchUI(q, box);
  searchCards(q, box);
}
$('searchIn').addEventListener('keydown', e => { if (e.key === 'Enter') rememberQ($('searchIn').value); });

/* ---------- 11. Date categories: deleting goes to Recently deleted (restore brings its dates back) ---------- */
BIN_TYPES.catbin = 'Category';
function catbinLabel(r) {
  if (r.what === 'datecat') return `${r.cat.i || '📁'} ${esc(r.cat.n)}<small class="muted"> · Dates category${(r.dateIds || []).length ? ` · ${r.dateIds.length} date${r.dateIds.length > 1 ? 's' : ''}` : ''}</small>`;
  return `${r.grp.i || '📁'} ${esc(r.grp.n)}<small class="muted"> · Documents category</small>`;
}
function binItems() { return binItemsBase().filter(r => !(r.catBin && records[r.catBin] && records[r.catBin].deleted && records[r.catBin].deletedAt > 1) && !(r.viaDoc && records[r.viaDoc] && records[r.viaDoc].deleted)); }   // shown with their category / document
function restoreCatbin(r) {
  if (r.what === 'datecat') {
    const c = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
    if (r.cat.custom) { if (!(c.custom || []).some(x => x.k === r.cat.k)) c.custom = [...(c.custom || []), { k: r.cat.k, n: r.cat.n, i: r.cat.i || '📁' }]; }
    else c.hidden = (c.hidden || []).filter(h => h !== r.cat.k);
    put(c, { render: false });
    (r.dateIds || []).forEach(id => { const d = records[id]; if (d && d.deleted) { delete d.catBin; d.deleted = false; delete d.deletedAt; put(d, { render: false }); } });
  } else {
    docCfgEdit(c => { const back = r.grp.t.filter(t => DOC_TYPES.includes(t)); c.groups.forEach(g => { g.t = g.t.filter(t => !back.includes(t)); });
      let n = r.grp.n; while (c.groups.some(g => g.n === n)) n += ' (2)';
      c.groups.splice(c.groups.length - 1, 0, { n, i: r.grp.i, t: back }); });
  }
  r.deleted = true; r.deletedAt = 1; put(r, { render: false });                  // done with it
  scheduleRender(); toast('Category restored.'); if (Sheets.isOpen('shBin')) openBin();
}
function binRestoreV2171(id) { const r = records[id]; if (r && r.type === 'catbin') { restoreCatbin(r); return; } binRestoreV216(id); }
function deleteDateCat(key, quiet) {
  const cats = dateCats(), c = cats.find(x => x[0] === key); if (!c) return;
  const own = all('date').filter(d => dateCat(d) === key), custom = (dateCfg().custom || []).some(x => x.k === key);
  if (!quiet && !confirm(`Delete the category "${c[1]}"${own.length ? ` and its ${own.length} date${own.length === 1 ? '' : 's'}` : ''}?\n\nIt goes to Settings → Recently deleted for 30 days. Restoring the category brings its dates back too.`)) return;
  const bin = put({ id: uid('cb'), type: 'catbin', what: 'datecat', cat: { k: key, n: c[1], i: c[2], custom }, dateIds: own.map(d => d.id), deleted: true, deletedAt: nowMs() }, { render: false });
  own.forEach(d => { d.catBin = bin.id; softDelete(d.id, { render: false }); });
  const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
  if (custom) cfg.custom = cfg.custom.filter(x => x.k !== key); else cfg.hidden = [...new Set([...(cfg.hidden || []), key])];
  datePath = null; put(cfg); if (!quiet) toast(`Deleted "${c[1]}".`, 'Undo', () => restoreCatbin(records[bin.id])); return bin.id;
}
function newDateCat() { catNameSheet('New category', '', '📁', (n, i) => newDateCatNamed(n, i)); }
function newDateCatNamed(n, icon) {
  const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
  const builtin = DATE_CATS.find(x => x[1].toLowerCase() === n.toLowerCase());
  if (builtin && (cfg.hidden || []).includes(builtin[0])) { cfg.hidden = cfg.hidden.filter(h => h !== builtin[0]); if (cfg.merged) { cfg.merged = { ...cfg.merged }; delete cfg.merged[builtin[0]]; } put(cfg); toast(`"${builtin[1]}" is back.`); return; }
  if (dateCats().some(x => x[1].toLowerCase() === n.toLowerCase())) { toast('That category already exists.'); return; }
  cfg.custom = [...(cfg.custom || []), { k: 'c' + Date.now().toString(36), n, i: icon || '📁' }]; put(cfg); toast(`Added "${n}".`);
}
/* categories hidden by older versions show up in Recently deleted once, so they can be restored */
function migrateHiddenCats() {
  const cfg = records[DATE_CFG]; if (!cfg || cfg.deleted || cfg.hidMig || window.GHOST || !(cfg.hidden || []).length) return;
  cfg.hidden.forEach(k => { const b = DATE_CATS.find(x => x[0] === k); if (!b) return;
    const ds = Object.values(records).filter(d => d.type === 'date' && d.deleted && d.deletedAt > nowMs() - 30 * 86400000 && d.cat === k);
    const bin = put({ id: uid('cb'), type: 'catbin', what: 'datecat', cat: { k, n: b[1], i: b[2], custom: false }, dateIds: ds.map(d => d.id), deleted: true, deletedAt: nowMs() }, { render: false });
    ds.forEach(d => { d.catBin = bin.id; put(d, { render: false }); }); });
  put({ ...cfg, hidMig: true }, { render: false, keepTime: true });
}
function renderDates() {
  if (!window.GHOST && (!Sync.on() || window.__synced)) migrateHiddenCats();
  renderDatesBase();
  const home = $('dateHome'); if (!home || datePath || window.GHOST) return;
  const n = dateSuggestions().length;
  if (n) { home.insertAdjacentHTML('afterbegin', `<button class="ds-banner" id="dsBanner"><span>📅 <b>${n} date${n > 1 ? 's' : ''}</b> found in your notes &amp; tasks</span><b>Review ›</b></button>`); $('dsBanner').addEventListener('click', openDateSug); }
}
setTimeout(updateTodayBadge, 1500);


