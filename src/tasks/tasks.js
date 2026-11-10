/* ==========================================================================
   TASKS
   ======================================================================== */
const CATS = ['Work', 'Personal', 'Finance', 'Errands'];
const OLD_CAT_MAP = { Learning: 'Personal', Tech: 'Work', Home: 'Errands' };
const PRIOS = ['High', 'Medium', 'Low'];
const PRIO_COLOR = { High: 'var(--seal)', Medium: 'var(--brass)', Low: '#4A6FA5' };
const catColor = c => `var(--cat-${CATS.includes(c) ? c : 'Work'})`;
const fixCat = c => CATS.includes(c) ? c : (OLD_CAT_MAP[c] || 'Work');
let activeCat = 'All';
const openSteps = new Set();         // view state only — which tasks show their steps

/* ---------- quick-add syntax: #cat !prio @date ---------- */
function parseQuickAddOld(text) {
  const out = { title: text, category: null, priority: null, dueDate: null };
  out.title = text
    .replace(/#(\w+)/g, (m, w) => {
      const c = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      if (CATS.includes(c)) { out.category = c; return ''; }
      if (OLD_CAT_MAP[c]) { out.category = OLD_CAT_MAP[c]; return ''; }
      return m;
    })
    .replace(/!(high|medium|med|low|h|m|l)\b/gi, (m, w) => { const p = w.toLowerCase()[0]; out.priority = p === 'h' ? 'High' : p === 'l' ? 'Low' : 'Medium'; return ''; })
    .replace(/@(\S+)/g, (m, w) => { const d = parseDateToken(w); if (d) { out.dueDate = d; return ''; } return m; })
    .replace(/\s{2,}/g, ' ').trim();
  return out;
}

/* ---------- offline keyword classifier (unchanged rules from v1) ---------- */
const CAT_WORDS = {
  Finance: ['bill', 'pay', 'payment', 'emi', 'loan', 'tax', 'gst', 'bank', 'insurance', 'premium', 'invoice', 'salary', 'rent', 'fee', 'fees', 'refund', 'investment', 'sip', 'mutual', 'fd', 'interest', 'recharge', 'credit', 'debit', 'installment', 'instalment', 'budget', 'money', 'cash', 'account', 'itc', 'tds', 'return'],
  Errands: ['buy', 'purchase', 'shop', 'shopping', 'grocery', 'groceries', 'pick up', 'pickup', 'drop', 'collect', 'market', 'order', 'deliver', 'delivery', 'courier', 'post', 'repair', 'service', 'servicing', 'fuel', 'petrol', 'laundry', 'haircut', 'appointment'],
  Personal: ['family', 'wife', 'son', 'daughter', 'mother', 'father', 'doctor', 'hospital', 'medicine', 'health', 'gym', 'exercise', 'birthday', 'anniversary', 'call', 'visit', 'temple', 'puja', 'school', 'homework', 'read', 'book', 'learn', 'course', 'study', 'friend', 'holiday', 'trip', 'travel', 'home', 'kitchen'],
  Work: ['office', 'file', 'filing', 'report', 'letter', 'draft', 'case', 'summons', 'notice', 'scn', 'audit', 'inspection', 'meeting', 'email', 'mail', 'send', 'submit', 'approve', 'review', 'sir', 'madam', 'department', 'officer', 'statement', 'panchanama', 'search', 'investigation', 'memo', 'noting']
};
const HIGH_WORDS = ['urgent', 'asap', 'immediately', 'today', 'critical', 'emergency', 'deadline', 'last date', 'overdue', 'now'];
const LOW_WORDS = ['someday', 'eventually', 'sometime', 'later', 'whenever', 'low priority', 'if time', 'maybe'];
const STRONG = {
  Finance: ['emi', 'gst', 'tds', 'itc', 'tax', 'loan', 'premium', 'invoice', 'salary', 'sip', 'recharge', 'instalment', 'installment'],
  Personal: ['doctor', 'hospital', 'medicine', 'birthday', 'anniversary', 'school', 'gym', 'wife', 'son', 'daughter', 'temple', 'puja'],
  Errands: ['grocery', 'groceries', 'shopping', 'courier', 'petrol', 'laundry', 'haircut'],
  Work: ['scn', 'panchanama', 'summons', 'audit', 'inspection', 'noting', 'assessee', 'commissionerate']
};
function classifyOld(title) {
  const t = ' ' + String(title || '').toLowerCase() + ' ';
  const hit = w => t.includes(' ' + w) || t.includes(w + ' ');
  let best = 'Work', bestScore = 0;
  for (const cat in CAT_WORDS) {
    let score = 0;
    CAT_WORDS[cat].forEach(w => { if (hit(w)) score++; });
    (STRONG[cat] || []).forEach(w => { if (hit(w)) score += 3; });
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  let prio = 'Medium';
  if (HIGH_WORDS.some(w => t.includes(w))) prio = 'High'; else if (LOW_WORDS.some(w => t.includes(w))) prio = 'Low';
  return { category: bestScore ? best : 'Work', priority: prio, matched: bestScore > 0 };
}

/* ---------- task helpers ---------- */
function normSub(s) { return { text: s.text || '', done: !!s.done, dueDate: s.dueDate || null, priority: PRIOS.includes(s.priority) ? s.priority : 'Medium', notes: s.notes || '', ...(+s.day ? { day: +s.day } : {}) }; }
const subOverdue = s => s.dueDate && !s.done && s.dueDate < todayISO();
const isOverdue = t => t.dueDate && t.status !== 'done' && t.dueDate < todayISO();
function newTask(fields) {
  return put({ id: uid('t'), type: 'task', title: '', category: 'Work', priority: 'Medium', dueDate: null, status: 'active',
    notes: '', repeat: 'none', subs: [], deleted: false, ...fields });
}
/* Add months, keeping the day (31 Jan → 28/29 Feb → 31 Mar); day = the original day of the month. */
function addMonthsKeep(d, n, day) {
  const y = d.getFullYear(), m = d.getMonth() + n, last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day || d.getDate(), last));
}
function shiftISO(iso, repeat, day) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return iso;
  if (repeat === 'daily') d.setDate(d.getDate() + 1); else if (repeat === 'weekly') d.setDate(d.getDate() + 7); else if (repeat === 'monthly') return isoLocal(addMonthsKeep(d, 1, day));
  else if (repeat === 'weekdays') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
  else if (repeat === 'yearly') return isoLocal(addMonthsKeep(d, 12, day));
  else { const m = /^e(\d+)([dwm])$/.exec(String(repeat || '')); if (m) { const n = Math.max(1, +m[1]); if (m[2] === 'm') return isoLocal(addMonthsKeep(d, n, day)); d.setDate(d.getDate() + n * (m[2] === 'w' ? 7 : 1)); } }
  return isoLocal(d);
}
function spawnRepeatOld(t) {
  const clone = { ...t, id: uid('t'), status: 'active', createdAt: nowMs(),
    subs: (t.subs || []).map(s => { const n = normSub(s); return { ...n, done: false, dueDate: shiftISO(n.dueDate, t.repeat) }; }) };
  delete clone.completedOn; delete clone.completedAt; delete clone._dirty; delete clone.spawnedId;
  const day = t.repeatDay || +(t.dueDate || todayISO()).slice(8, 10); clone.repeatDay = day;
  let nx = shiftISO(t.dueDate || todayISO(), t.repeat, day); const today = todayISO();
  for (let i = 0; nx < today && i < 1000; i++) nx = shiftISO(nx, t.repeat, day);      // completed late: next one is not already overdue
  clone.dueDate = nx;
  t.spawnedId = clone.id;
  put(clone, { render: false });
  return clone;
}
function setStatus(t, st) {
  const was = t.status; let spawned = null;
  t.status = st;
  if (st === 'waiting' && was !== 'waiting') t.waitingSince = todayISO(); else if (st !== 'waiting') delete t.waitingSince;   // v2.19: waiting on someone
  if (st === 'done') {
    t.completedOn = todayISO(); t.completedAt = nowMs();
    const already = t.spawnedId && records[t.spawnedId] && !records[t.spawnedId].deleted;   // reopened and done again: keep the one copy
    if (was !== 'done' && t.repeat && t.repeat !== 'none' && !already) spawned = spawnRepeat(t).id;
  } else { delete t.completedOn; delete t.completedAt; }
  put(t);
  return spawned;
}
function completeWithUndo(id) {
  const t = records[id]; if (!t) return;
  const prev = t.status;
  const spawned = setStatus(t, 'done');
  toast(`Done: ${t.title.slice(0, 32)}` + (spawned ? ' — next one scheduled' : ''), 'Undo', () => {
    setStatus(records[id], prev);
    if (spawned) { softDelete(spawned); delete records[id].spawnedId; put(records[id], { render: false }); }
  });
}
function cycleTask(id) {
  const t = records[id]; if (!t) return;
  if (t.status === 'active') setStatus(t, 'inprogress');
  else if (t.status === 'inprogress' || t.status === 'waiting') completeWithUndo(id);
  else setStatus(t, 'active');
}
function deleteWithUndo(id, label) {
  const r = records[id]; if (!r) return;
  softDelete(id);
  toast(`Deleted "${String(label || r.title || r.label || r.desc || 'item').slice(0, 28)}"`, 'Undo', () => restore(id));
}

/* ---------- rendering ---------- */
function stepHtml(s, i, tid) {
  const od = subOverdue(s), today = s.dueDate === todayISO() && !s.done;
  return `<div class="step ${s.done ? 'done' : ''}">
    <button class="check ${s.done ? 'done' : ''}" data-step="${tid}|${i}" aria-label="${s.done ? 'Mark step not done' : 'Mark step done'}: ${esc(s.text)}">${s.done ? '✓' : ''}</button>
    <div style="flex:1;min-width:0"><div class="step-text">${esc(s.text)}</div>
      ${s.dueDate || s.notes ? `<div class="step-meta ${od || today ? 'warn' : ''}">${s.dueDate ? relDay(s.dueDate) + (od ? ' · overdue' : '') : ''}${s.notes ? ' 📝' : ''}</div>` : ''}
    </div></div>`;
}
function taskRow(t, showCat) {
  const subs = (t.subs || []).map(normSub);
  const done = subs.filter(s => s.done).length, late = subs.filter(subOverdue).length;
  const open = prefs.stepsOpen ? !openSteps.has('!' + t.id) : (openSteps.has(t.id) || (late > 0 && !openSteps.has('!' + t.id)));
  const od = isOverdue(t), dueToday = t.dueDate === todayISO();
  const st = t.status === 'done' ? 'done' : t.status === 'inprogress' ? 'inprog' : t.status === 'waiting' ? 'wait' : '';
  const inner = `<div class="row task ${t.status === 'done' ? 'done' : 'tp-' + (PRIOS.includes(t.priority) ? t.priority : 'Medium')}" data-id="${t.id}">
    <i class="prio-bar" style="background:${PRIO_COLOR[t.priority] || 'var(--brass)'}"></i>
    <button class="check ${st}" data-cycle="${t.id}" aria-label="${t.status === 'done' ? 'Reopen' : t.status === 'inprogress' || t.status === 'waiting' ? 'Mark done' : 'Start'}: ${esc(t.title)}">${t.status === 'done' ? '✓' : t.status === 'waiting' ? '⏳' : ''}</button>
    <div class="row-main">
      <div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">
        ${t.dueDate ? `<span class="${od || dueToday ? 'warn' : ''}">📅 ${relDay(t.dueDate)}${t.dueTime ? ' ' + fmtTime12(t.dueTime) : ''}${od ? ' · overdue' : ''}</span>` : ''}
        ${t.status === 'inprogress' ? '<span>◐ in progress</span>' : ''}
        ${t.status === 'waiting' ? `<span class="wait-pill">⏳ waiting${t.waitingOn ? ' on ' + esc(t.waitingOn) : ''}${t.waitingSince ? ' · ' + waitAge(t) : ''}</span>` : ''}
        ${t.status === 'done' && t.completedOn ? `<span>✓ ${fmtDate(t.completedOn)}</span>` : ''}
        ${t.repeat && t.repeat !== 'none' ? `<span>🔁 ${esc(taskRepWord(t.repeat))}</span>` : ''}
        ${subs.length ? `<button class="toggle-steps" data-steps="${t.id}" aria-expanded="${open}">☑ ${done}/${subs.length} ${open ? '▾' : '▸'}</button>` : ''}
        ${late ? `<span class="warn">⚠ ${late} step${late > 1 ? 's' : ''} overdue</span>` : ''}
        ${t.notes ? '<span aria-label="has notes">📝</span>' : ''}
      </div>
      ${subs.length && open ? `<div class="steps">${subs.map((s, i) => stepHtml(s, i, t.id)).join('')}</div>` : ''}
    </div></div>`;
  return swipeHtml(inner, t.status === 'done' ? '↺ Reopen' : '✓ Done', t.status === 'done' ? 'Delete 🗑' : '⏰ Snooze', `data-task="${t.id}"`);
}
function wireTaskRows(root) {
  $$('[data-task]', root).forEach(w => {
    const id = w.dataset.task;
    const isDone = records[id] && records[id].status === 'done';
    bindSwipe(w, () => { const t = records[id]; if (!t) return; t.status === 'done' ? setStatus(t, 'active') : completeWithUndo(id); },
                 () => deleteWithUndo(id), isDone ? null : { short: () => snoozeSheet([id]), shortLbl: '⏰ Snooze', farLbl: 'Delete 🗑' });
    bindHold(w, 'task', id);
    onTap(w, e => {
      if (e.target.closest('[data-cycle]')) { cycleTask(id); return; }
      const st = e.target.closest('[data-step]');
      if (st) { toggleStep(st.dataset.step); return; }
      if (e.target.closest('[data-steps]')) {
        const t = records[id], isOpen = e.target.closest('[data-steps]').getAttribute('aria-expanded') === 'true';
        if (isOpen) { openSteps.delete(id); openSteps.add('!' + id); } else { openSteps.add(id); openSteps.delete('!' + id); }
        renderTasks(); return;
      }
      previewTask(id);
    });
  });
}
function toggleStep(key) {
  const [id, i] = key.split('|'); const t = records[id]; if (!t) return;
  t.subs = (t.subs || []).map(normSub); if (!t.subs[+i]) return;
  t.subs[+i].done = !t.subs[+i].done;
  openSteps.add(id); openSteps.delete('!' + id);
  put(t);
  if (Sheets.isOpen('shTaskView')) previewTask(id);
}

const prioRank = { High: 0, Medium: 1, Low: 2 };
const byDueThenPrio = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || prioRank[a.priority] - prioRank[b.priority];
function renderTasks() {
  renderInboxCard(); updateInboxBadge();
  const tasks = all('task');
  const open = tasks.filter(t => t.status !== 'done');
  // category chips
  // v2.20: no category split — every open task is in one list
  chipGroup($('taskModeChips'), [{ v: 'due', l: 'By date' }, { v: 'prio', l: 'By priority' }, { v: 'prog', l: 'In progress' }, { v: 'wait', l: `Waiting on${open.some(t => t.status === 'waiting') ? ' ' + open.filter(t => t.status === 'waiting').length : ''}` }, { v: 'new', l: 'Newest' }, { v: 'old', l: 'Oldest' }],
    prefs.taskMode, v => { setPref('taskMode', v); renderTasks(); });
  $$('#taskModeChips .chip').forEach(c => c.style.fontSize = '13px');

  let live = open.slice();
  const showCat = false;
  const today = todayISO(), weekEnd = addDays(7);
  let groups = [];
  if (prefs.taskMode === 'prio') groups = PRIOS.map(p => [p + ' priority', live.filter(t => t.priority === p).sort(byDueThenPrio)]);
  else if (prefs.taskMode === 'prog') groups = [['In progress', live.filter(t => t.status === 'inprogress').sort(byDueThenPrio)]];
  else if (prefs.taskMode === 'wait') groups = [['Waiting on', live.filter(t => t.status === 'waiting').sort((a, b) => String(a.waitingSince || '').localeCompare(String(b.waitingSince || '')) || byDueThenPrio(a, b))]];
  else if (prefs.taskMode === 'new') groups = [['Newest first', [...live].sort((a, b) => b.createdAt - a.createdAt)]];
  else if (prefs.taskMode === 'old') groups = [['Oldest first', [...live].sort((a, b) => a.createdAt - b.createdAt)]];
  else {
    const g = { o: [], t: [], m: [], w: [], l: [], n: [], x: [] };
    live.forEach(t => {
      const d = t.dueDate;
      if (t.status === 'waiting' && !(d && d < today)) g.x.push(t);              // v2.19: waiting on someone, in its own group unless overdue
      else if (!d) g.n.push(t); else if (d < today) g.o.push(t); else if (d === today) g.t.push(t);
      else if (d === addDays(1)) g.m.push(t); else if (d <= weekEnd) g.w.push(t); else g.l.push(t);
    });
    groups = [['Overdue', g.o], ['Today', g.t], ['Tomorrow', g.m], ['This week', g.w], ['Later', g.l], ['No date', g.n], ['⏳ Waiting on', g.x]]
      .map(([k, v]) => [k, v.sort(byDueThenPrio)]);
  }
  groups = groups.filter(g => g[1].length);
  $('taskList').innerHTML = groups.length ? groups.map(([k, v]) =>
    `<div class="group-title">${k} <span class="gcount">${v.length}</span></div><div class="group">${v.map(t => taskRow(t, showCat)).join('')}</div>`).join('')
    : `<div class="empty"><b>${open.length ? 'Nothing here' : 'All clear'}</b>Tap + to add a task. Try “Draft ITC letter tomorrow high”.</div>`;
  wireTaskRows($('taskList')); selPaint();

  // stats + the daily card (v2.20)
  renderTaskHero(tasks, open);
  $('taskSub').textContent = '';

  // completed (last 60 days)
  const cutoff = nowMs() - 60 * 86400000;
  const done = tasks.filter(t => t.status === 'done' && (!t.completedAt || t.completedAt > cutoff)).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  $('doneLbl').textContent = `Completed (${done.length})`;
  $('doneList').innerHTML = done.length ? done.map(t => taskRow(t, true)).join('') : '<div class="empty">Finished tasks collect here.</div>';
  wireTaskRows($('doneList'));

  // trash
  const tr = trashed().sort((a, b) => b.deletedAt - a.deletedAt);
  $('trashLbl').textContent = `Trash (${tr.length}) · emptied after 30 days`;
  $('trashList').innerHTML = tr.length ? tr.map(r => `<div class="row"><span class="pill">${esc(r.type)}</span>
      <div class="row-main"><div class="row-title">${esc(r.title || r.label || r.desc || '(untitled)')}</div><div class="row-sub">deleted ${timeAgo(r.deletedAt)}</div></div>
      <div class="row-end"><button class="btn small ghost" data-restore="${r.id}">Restore</button></div></div>`).join('')
    : '<div class="empty">Trash is empty.</div>';
  $$('[data-restore]', $('trashList')).forEach(b => b.addEventListener('click', () => { restore(b.dataset.restore); toast('Restored.'); }));
}

/* ---------- v2.21: snooze (swipe a little left) and moving many tasks at once ---------- */
function moveTasksTo(ids, iso) {
  const prev = ids.map(id => [id, records[id] && records[id].dueDate]);
  ids.forEach(id => { const t = records[id]; if (t) { t.dueDate = iso; put(t, { render: false }); } });
  selEnd(); scheduleRender();
  toast(`${ids.length === 1 ? 'Moved' : `Moved ${ids.length} tasks`} to ${relDay(iso)}.`, 'Undo', () => { prev.forEach(([id, d]) => { const t = records[id]; if (t) { t.dueDate = d || null; put(t, { render: false }); } }); scheduleRender(); }, 7000);
}
function nextWeekday(dow) { const d = new Date(); d.setHours(0, 0, 0, 0); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== dow); return isoLocal(d); }
function snoozeSheet(ids) {
  if (!ids.length) return;
  const opts = [['Tomorrow', addDays(1)], ['In 2 days', addDays(2)], ['Saturday', nextWeekday(6)], ['Next Monday', nextWeekday(1)], ['In a week', addDays(7)], ['In a month', addDays(30)]];
  planSheet(ids.length === 1 ? 'Snooze' : `Snooze ${ids.length} tasks`, `<div class="snz">${opts.map(([l, d]) => `<button type="button" data-snz="${d}"><b>${l}</b><span>${fmtDate(d, true)}</span></button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><label>Or pick a day</label><input type="date" id="snzDate" min="${todayISO()}"></div>`,
    () => { const d = $('snzDate').value; if (!d) { planMsg('Pick a day, or tap one above.', true); return false; } moveTasksTo(ids, d); return true; }, 'Move');
  $$('[data-snz]', $('pshBody')).forEach(b => b.addEventListener('click', () => { Sheets.close('shPlan', true); moveTasksTo(ids, b.dataset.snz); }));
}
SEL_ACTS.task = () => [
  { l: '✓ Done', fn: ids => { ids.forEach(id => { const t = records[id]; if (t && t.status !== 'done') setStatus(t, 'done'); }); selEnd(); toast(`${ids.length} marked done.`); } },
  { l: '⏰ Snooze', fn: ids => snoozeSheet(ids) },
  { l: 'Today', fn: ids => moveTasksTo(ids, todayISO()) },
  { l: '! High', fn: ids => { ids.forEach(id => { const t = records[id]; if (t) { t.priority = t.priority === 'High' ? 'Medium' : 'High'; put(t, { render: false }); } }); selEnd(); scheduleRender(); } },
  { l: '🗑', danger: true, fn: ids => deleteManyWithUndo(ids, 'task') }
];
SEL_ACTS.date = () => [
  { l: '📅 To Calendar', fn: ids => { icsSaveNew(ids.map(id => records[id]).filter(d => d && d.when), 'Register dates'); selEnd(); } },
  { l: '☑ As tasks', fn: ids => { let n = 0; ids.forEach(id => { const d = records[id]; if (d && d.when && !dateTask(d)) { const w = isoLocal(nextOccurrence(d)); const t = newTask({ title: d.label, dueDate: w, priority: 'Medium', notes: 'From Dates', fromDate: d.id }); d.taskId = t.id; put(d, { render: false }); n++; } }); selEnd(); scheduleRender(); toast(n ? `${n} added to Tasks.` : 'Nothing to add — they need a date, or are already in Tasks.'); } },
  { l: '🗑', danger: true, fn: ids => deleteManyWithUndo(ids, 'date') }
];
SEL_ACTS.note = () => [
  { l: '📌 Pin', fn: ids => { const pin = ids.some(id => records[id] && !records[id].pinned); ids.forEach(id => { const n = records[id]; if (n) { n.pinned = pin; put(n, { render: false }); } }); selEnd(); scheduleRender(); toast(pin ? 'Pinned.' : 'Unpinned.'); } },
  { l: '📁 Move', fn: ids => { const fs = folderList(); planSheet(`Move ${ids.length} note${ids.length > 1 ? 's' : ''}`, `<div class="field"><label>Folder</label><select id="selFold"><option value="">— No folder —</option>${fs.map(f => `<option>${esc(f)}</option>`).join('')}</select></div><div class="field"><label>Or a new folder</label><input id="selFoldNew" placeholder="Folder name"></div>`,
      () => { const f = ($('selFoldNew').value.trim() || $('selFold').value).slice(0, 60); ids.forEach(id => { const n = records[id]; if (n) { n.folder = f; put(n, { render: false }); } }); selEnd(); toast(f ? `Moved to ${f}.` : 'Moved out of folders.'); return true; }, 'Move'); } },
  { l: '🗑', danger: true, fn: ids => deleteManyWithUndo(ids, 'note') }
];
SEL_ACTS.fin = () => [
  { l: '🏷 Category', fn: ids => { planSheet(`Category for ${ids.length}`, `<div class="field"><select id="selCat"><option value="">— none —</option>${FIN_CATS.map(c => `<option>${c}</option>`).join('')}</select></div>`,
      () => { const c = $('selCat').value; ids.forEach(id => { const e = records[id]; if (e && e.kind !== 'transfer') { e.category = c; put(e, { render: false }); } }); selEnd(); toast('Category changed.'); return true; }, 'Apply'); } },
  { l: '🗑', danger: true, fn: ids => deleteManyWithUndo(ids, 'entry') }
];
SEL_ACTS.doc = () => [];

/* ---------- v2.20: the daily card at the top of Tasks ---------- */
function taskStreak(doneDays) {
  let n = 0, d = todayISO();
  if (!doneDays.has(d)) d = addDays(-1);                 // today not started yet: yesterday keeps the streak alive
  while (doneDays.has(d) && n < 999) { n++; d = addDays(-1, d); }
  return n;
}
function renderTaskHero(tasks, open) {
  if (!$('tHero')) return;
  const today = todayISO(), doneToday = tasks.filter(t => t.completedOn === today).length;
  const od = open.filter(isOverdue), dueToday = open.filter(t => t.dueDate === today);
  $('stActive').textContent = open.length; $('stToday').textContent = doneToday; $('stOverdue').textContent = od.length;
  $('tDayLbl').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const left = od.length + dueToday.length, total = left + doneToday, pct = total ? doneToday / total : 0;
  $('tArc').style.strokeDashoffset = String(125.66 * (1 - pct));
  $('tRingN').textContent = total ? `${doneToday}/${total}` : doneToday ? '✓' : '—';
  $('tRing').classList.toggle('full', total > 0 && !left);
  $('tRing').setAttribute('aria-label', total ? `${doneToday} of ${total} done for today` : 'Nothing due today');
  const cnt = {}; tasks.forEach(t => { if (t.completedOn) cnt[t.completedOn] = (cnt[t.completedOn] || 0) + 1; });
  const st = taskStreak(new Set(Object.keys(cnt)));
  const bits = [];
  if (od.length) bits.push(`<span class="warn">${od.length} overdue</span>`);
  if (dueToday.length) bits.push(`${dueToday.length} due today`);
  if (!left) bits.push(doneToday ? 'all clear for today' : 'nothing due today');
  bits.push(`${open.length} open`);
  if (st >= 2) bits.push(`<span class="streak">🔥 ${st} days</span>`);
  $('tMsg').innerHTML = bits.join(' · ');
  $('tHero').classList.toggle('all-clear', !left && doneToday > 0);
  // v2.21: many overdue at once — one decision instead of a pile of red
  const c = $('tClean');
  if (od.length >= 3) {
    c.innerHTML = `<span>${od.length} overdue</span><button type="button" data-clean="today">Move all to today</button><button type="button" data-clean="pick">Snooze all…</button>`;
    c.classList.remove('hidden');
    c.querySelector('[data-clean="today"]').addEventListener('click', () => moveTasksTo(od.map(t => t.id), todayISO()));
    c.querySelector('[data-clean="pick"]').addEventListener('click', () => snoozeSheet(od.map(t => t.id)));
  } else { c.classList.add('hidden'); c.innerHTML = ''; }
}
function quickTaskAdd(raw) {
  const q = parseQuickAdd(raw || ''); if (!q.title) return null;
  const g = classify(q.title);
  return newTask({ title: q.title, category: fixCat(q.category || g.category), priority: q.priority || g.priority, dueDate: q.dueDate || null, dueTime: q.dueTime || undefined });
}
if ($('tQuickForm')) {
  const hint = () => { const v = $('tQuick').value, q = parseQuickAdd(v);
    $('tQuickHint').innerHTML = v.trim() && q.title ? `<b>${esc(q.title)}</b> · ${esc(q.priority || classify(q.title).priority)}${q.dueDate ? ' · 📅 ' + relDay(q.dueDate) : ''}${q.dueTime ? ' ' + fmtTime12(q.dueTime) : ''}` : ''; };
  $('tQuick').addEventListener('input', hint);
  $('tQuickForm').addEventListener('submit', e => { e.preventDefault(); const t = quickTaskAdd($('tQuick').value); if (!t) { $('tQuick').focus(); return; }
    $('tQuick').value = ''; hint(); toast(`Added: ${t.title.slice(0, 40)}${t.dueDate ? ' · ' + relDay(t.dueDate) : ''}`, 'Undo', () => softDelete(t.id)); });
}

/* ---------- task preview (read-only) ---------- */
let viewTaskId = null;
/* v2.19 (B9): only things that look like phone numbers become call links — +country numbers, 0-prefixed numbers and
   10-digit Indian mobiles (6–9…). Account numbers, Aadhaar and other long numbers stay plain text. */
function telOk(raw) {
  const t = String(raw).trim(), d = t.replace(/\D/g, '');
  if (t[0] === '+') return d.length >= 10 && d.length <= 13;
  if (d[0] === '0') return d.length === 11 || d.length === 12;
  return d.length === 10 && /^[6-9]/.test(d);
}
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
                .replace(/(^|[\s(])(\+?\d[\d\s-]{8,}\d)(?![\d-])/g, (m, p, n) => !telOk(n) ? m : `${p}<a href="tel:${n.replace(/[\s-]/g, '')}">${n}</a>`);   // dates are not phone numbers
}
function previewTask(id) {
  const t = records[id]; if (!t) return;
  viewTaskId = id;
  const subs = (t.subs || []).map(normSub);
  $('tvBody').innerHTML = `
    <h2 style="font-family:var(--serif);font-size:22px;margin:0 0 10px;line-height:1.3">${esc(t.title)}</h2>
    <div class="wrapchips" style="margin-bottom:14px">
      <span class="pill" style="color:${PRIO_COLOR[t.priority]}">${esc(t.priority)}</span>
      ${t.dueDate ? `<span class="pill ${isOverdue(t) ? 'neg' : ''}">📅 ${relDay(t.dueDate)}${t.dueTime ? ' ' + fmtTime12(t.dueTime) : ''}${isOverdue(t) ? ' · overdue' : ''}</span>` : ''}
      ${t.status === 'inprogress' ? '<span class="pill">◐ in progress</span>' : ''}${t.status === 'waiting' ? `<span class="pill">⏳ waiting${t.waitingOn ? ' on ' + esc(t.waitingOn) : ''}${t.waitingSince ? ' · ' + waitAge(t) : ''}</span>` : ''}${t.status === 'done' ? `<span class="pill pos">✓ done ${fmtDate(t.completedOn)}</span>` : ''}
      ${t.repeat && t.repeat !== 'none' ? `<span class="pill">🔁 ${esc(taskRepWord(t.repeat))}</span>` : ''}
    </div>
    ${subs.length ? `<div class="flabel">Steps ${subs.filter(s => s.done).length}/${subs.length}</div><div class="group" style="padding:4px 12px">${subs.map((s, i) => stepHtml(s, i, id)).join('')}</div>` : ''}
    ${t.notes ? `<div class="flabel">Notes</div><div style="white-space:pre-wrap;line-height:1.6;margin-bottom:14px">${linkify(esc(t.notes))}</div>` : ''}
    <div class="action-grid" style="grid-template-columns:repeat(5,1fr)">
      <button data-a="done"><b>${t.status === 'done' ? '↺' : '✓'}</b>${t.status === 'done' ? 'Reopen' : 'Done'}</button>
      <button data-a="prog"><b>◐</b>${t.status === 'inprogress' ? 'Not started' : 'Start'}</button>
      <button data-a="wait"><b>⏳</b>${t.status === 'waiting' ? 'Not waiting' : 'Waiting'}</button>
      <button data-a="dup"><b>⧉</b>Duplicate</button>
      <button data-a="del" class="danger"><b>🗑</b>Delete</button>
    </div>`;
  $$('[data-step]', $('tvBody')).forEach(b => b.addEventListener('click', () => toggleStep(b.dataset.step)));
  $$('[data-a]', $('tvBody')).forEach(b => b.addEventListener('click', () => {
    const tt = records[id], a = b.dataset.a;
    if (a === 'done') { tt.status === 'done' ? setStatus(tt, 'active') : completeWithUndo(id); Sheets.close('shTaskView'); }
    else if (a === 'prog') { setStatus(tt, tt.status === 'inprogress' ? 'active' : 'inprogress'); previewTask(id); }
    else if (a === 'wait') { if (tt.status === 'waiting') { setStatus(tt, 'active'); previewTask(id); } else { Sheets.close('shTaskView', true); openTaskEditor(id); setTimeout(() => { const b = $('teStatus').querySelector('[data-v="waiting"]'); if (b) b.click(); }, 60); } }
    else if (a === 'dup') { const c = { ...tt, id: uid('t'), status: 'active', waitingSince: undefined, title: tt.title + ' (copy)', createdAt: nowMs(), subs: (tt.subs || []).map(s => ({ ...normSub(s), done: false })) }; delete c.completedOn; delete c.completedAt; delete c._dirty; delete c.spawnedId; delete c.repeatDay; put(c); Sheets.close('shTaskView'); openTaskEditor(c.id); }
    else if (a === 'del') { Sheets.close('shTaskView'); deleteWithUndo(id); }
  }));
  Sheets.open('shTaskView');
}
$('tvEdit').addEventListener('click', () => { Sheets.close('shTaskView', true); openTaskEditor(viewTaskId); });

/* ---------- task editor (saves as you go) ---------- */
let editTaskId = null, editStep = -1, teTimer = null;
function openTaskEditor(id) {
  const t = records[id]; if (!t) return;
  editTaskId = id; editStep = -1;
  $('teTitle').value = t.title || '';
  chipGroup($('teCat'), CATS, t.category, v => { t.category = v; put(t, { render: false }); }, catColor);
  chipGroup($('tePrio'), PRIOS, t.priority, v => { t.priority = v; put(t, { render: false }); }, p => PRIO_COLOR[p]);
  chipGroup($('teStatus'), [{ v: 'active', l: 'To do' }, { v: 'inprogress', l: 'In progress' }, { v: 'waiting', l: '⏳ Waiting on' }, { v: 'done', l: 'Done' }], t.status, v => { setStatus(t, v); $('teWaitW').classList.toggle('hidden', v !== 'waiting'); if (v === 'waiting') setTimeout(() => $('teWait').focus(), 50); });
  $('teWait').value = t.waitingOn || ''; $('teWaitW').classList.toggle('hidden', t.status !== 'waiting');
  $('teDue').value = t.dueDate || ''; $('teTime').value = t.dueTime || '';
  teRepShow(t.repeat || 'none');
  $('teNotes').value = t.notes || '';
  $('teDueQuick').innerHTML = [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['No date', null]]
    .map(([l, n]) => `<button class="chip" data-d="${n}">${l}</button>`).join('');
  $$('#teDueQuick .chip').forEach(b => b.addEventListener('click', () => {
    t.dueDate = b.dataset.d === 'null' ? null : addDays(+b.dataset.d); delete t.repeatDay; $('teDue').value = t.dueDate || ''; put(t, { render: false });
  }));
  renderSteps();
  Sheets.open('shTask');
}
function teSave() {
  const t = records[editTaskId]; if (!t) return;
  t.title = $('teTitle').value.trim() || t.title;
  { const nd = $('teDue').value || null; if (nd !== t.dueDate) delete t.repeatDay; t.dueDate = nd; }   // a moved date sets the new repeat day
  t.dueTime = $('teTime').value || undefined; if (!t.dueTime) delete t.dueTime;
  t.repeat = teRepRead();
  t.notes = $('teNotes').value;
  { const w = $('teWait').value.trim(); if (t.status === 'waiting' && w) t.waitingOn = w; else delete t.waitingOn; }
  put(t, { render: false });
}
const teQueue = () => { clearTimeout(teTimer); teTimer = setTimeout(teSave, 400); };
['teTitle', 'teNotes', 'teWait'].forEach(i => $(i).addEventListener('input', teQueue));
['teDue', 'teTime', 'teRepeat'].forEach(i => $(i).addEventListener('change', teSave));
$('teTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('teTitle').blur(); } });
Sheets.onClose.shTask = () => { clearTimeout(teTimer); teSave(); scheduleRender(); };

function renderSteps() {
  const t = records[editTaskId]; if (!t) return;
  t.subs = (t.subs || []).map(normSub);
  const late = t.subs.filter(subOverdue).length;
  $('teStepCount').textContent = t.subs.length ? `(${t.subs.filter(s => s.done).length}/${t.subs.length}${late ? ` · ${late} overdue` : ''})` : '';
  $('teSteps').innerHTML = t.subs.map((s, i) => `
    <div class="step ${s.done ? 'done' : ''}" style="border-bottom:.5px solid var(--line);padding:8px 0">
      <button class="check ${s.done ? 'done' : ''}" data-sc="${i}" aria-label="Toggle step">${s.done ? '✓' : ''}</button>
      <button style="flex:1;text-align:left" data-so="${i}"><div class="step-text">${esc(s.text)}</div>
        <div class="step-meta ${subOverdue(s) ? 'warn' : ''}"><span style="color:${PRIO_COLOR[s.priority]}">●</span> ${esc(s.priority)}${s.dueDate ? ' · ' + relDay(s.dueDate) : ''}${s.notes ? ' · 📝' : ''}</div></button>
      <button class="icon-btn" data-sd="${i}" aria-label="Remove step" style="width:32px;height:32px;font-size:14px">✕</button>
    </div>
    ${editStep === i ? `<div class="sub-edit">
      <div class="field"><label>Step</label><input data-sf="text" value="${esc(s.text)}"></div>
      <div class="grid2"><div class="field"><label>Due</label><input type="date" data-sf="dueDate" value="${s.dueDate || ''}"></div>
        <div class="field"><label>Priority</label><select data-sf="priority">${PRIOS.map(p => `<option ${p === s.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
      <div class="field" style="margin:0"><label>Note</label><textarea data-sf="notes" rows="2">${esc(s.notes)}</textarea></div></div>` : ''}`).join('');
  const box = $('teSteps');
  $$('[data-sc]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.sc; t.subs[i].done = !t.subs[i].done; put(t, { render: false }); renderSteps(); }));
  $$('[data-so]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.so; editStep = editStep === i ? -1 : i; renderSteps(); }));
  $$('[data-sd]', box).forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.sd, removed = t.subs.splice(i, 1)[0]; editStep = -1; put(t, { render: false }); renderSteps();
    toast('Step removed', 'Undo', () => { t.subs.splice(i, 0, removed); put(t, { render: false }); renderSteps(); });
  }));
  $$('[data-sf]', box).forEach(el => {
    const commit = () => { const s = t.subs[editStep]; if (!s) return; let v = el.value; if (el.dataset.sf === 'text') { v = v.trim(); if (!v) return; } if (el.dataset.sf === 'dueDate') v = v || null; s[el.dataset.sf] = v; put(t, { render: false }); };
    if (el.tagName === 'SELECT' || el.type === 'date') el.addEventListener('change', () => { commit(); renderSteps(); });
    else { el.addEventListener('input', commit); el.addEventListener('blur', () => renderSteps()); }
  });
}
function addStep() {
  const t = records[editTaskId]; if (!t) return;
  const raw = $('teStepIn').value.trim(); if (!raw) return;
  const q = parseQuickAdd(raw); if (!q.title) return;
  t.subs = (t.subs || []).map(normSub);
  t.subs.push(normSub({ text: q.title, dueDate: q.dueDate, priority: q.priority || 'Medium' }));
  $('teStepIn').value = ''; put(t, { render: false }); renderSteps();
}
$('teStepAdd').addEventListener('click', addStep);
$('teStepIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });
$('teDelete').addEventListener('click', () => { const id = editTaskId; Sheets.close('shTask', true); deleteWithUndo(id); });
$('teRefile').addEventListener('click', () => {
  clearTimeout(teTimer); teSave();                                         // keep what was typed in the last moment
  const t = records[editTaskId]; const g = classify(t.title);
  t.priority = g.priority; put(t, { render: false }); openTaskEditor(t.id);
  toast(`Priority set to ${g.priority}.`);
});
$('teTemplate').addEventListener('click', () => {
  const t = records[editTaskId]; teSave();
  put({ id: uid('tpl'), type: 'template', title: t.title, category: t.category, priority: t.priority, notes: t.notes || '',
        subs: (t.subs || []).map(s => ({ ...normSub(s), done: false, dueDate: null })) }, { render: false });
  toast('Saved as a template.');
});

/* ---------- templates ---------- */
function openTemplates() {
  const tpls = all('template');
  $('tplList').innerHTML = tpls.length ? tpls.map(t => `<div class="row"><div class="row-main"><div class="row-title">${esc(t.title)}</div>
      <div class="row-sub"><span>${esc(t.priority)}</span>${(t.subs || []).length ? `<span>${t.subs.length} steps</span>` : ''}</div></div>
      <div class="row-end"><button class="btn small" data-use="${t.id}">Use</button><button class="icon-btn" data-tdel="${t.id}" aria-label="Delete template">✕</button></div></div>`).join('')
    : '<div class="empty">No templates yet.</div>';
  $$('[data-use]', $('tplList')).forEach(b => b.addEventListener('click', () => {
    const t = records[b.dataset.use];
    const nt = newTask({ title: t.title, category: t.category, priority: t.priority, notes: t.notes || '', subs: (t.subs || []).map(s => ({ ...normSub(s), done: false })) });
    Sheets.close('shTpl', true); Sheets.close('shAdd', true); openTaskEditor(nt.id);
  }));
  $$('[data-tdel]', $('tplList')).forEach(b => b.addEventListener('click', () => { softDelete(b.dataset.tdel); openTemplates(); }));
  Sheets.open('shTpl');
}

