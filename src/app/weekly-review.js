/* ==========================================================================
   v2.19 — Weekly review
   ======================================================================== */
function openWeekly() {
  if (window.GHOST) { ghostCrash(true); return; }
  const t = todayISO(), wk = addDays(-6), next = addDays(7), next14 = addDays(14), T = all('task');
  const doneWk = T.filter(x => x.status === 'done' && x.completedOn && x.completedOn >= wk);
  const overdue = T.filter(isOverdue).sort(byDueThenPrio), waiting = T.filter(x => x.status === 'waiting').sort((a, b) => String(a.waitingSince || '').localeCompare(String(b.waitingSince || '')));
  const dueNext = T.filter(x => x.status !== 'done' && x.dueDate && x.dueDate >= t && x.dueDate <= next).sort(byDueThenPrio);
  const dates = dateRows(all('date').filter(d => d.when)).filter(x => x.days >= 0 && x.days <= 14);
  const docs = all('doc').filter(d => d.expiry && daysUntilISO(d.expiry) <= 30 && daysUntilISO(d.expiry) >= -10).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const inbox = all('inbox').length, notesWk = all('note').filter(n => (n.updatedAt || 0) >= Date.now() - 7 * 86400000).length;
  const row = (k, id, title, sub, when, neg) => `<button class="td-row" data-wk="${k}" data-wkid="${esc(id)}"><span class="t">${title}${sub ? `<small>${sub}</small>` : ''}</span>${when ? `<span class="w${neg ? ' neg' : ''}">${when}</span>` : ''}</button>`;
  const sec = (h, rows, empty) => `<div class="group-title">${h}</div>` + (rows.length ? `<div class="group">${rows.join('')}</div>` : `<p class="hint" style="margin:0 4px 6px">${empty}</p>`);
  let money = '';
  if (Fin.key) {
    const F = all('fin').filter(e => (e.date || '') >= wk && (e.date || '') <= t), M = monthFigures(F), byC = {};
    F.filter(e => e.kind === 'expense' && e.category !== 'Investment').forEach(e => { const c = e.category || 'Other'; byC[c] = (byC[c] || 0) + (+e.amount || 0); });
    const top = Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const subs = detectSubs().length;
    money = `<div class="group-title">₹ Money · last 7 days</div><div class="wk-grid"><div><span class="wk-n">${rsShort(M.out)}</span><br>spent</div><div><span class="wk-n">${rsShort(M.inc)}</span><br>received</div>${M.inv ? `<div><span class="wk-n">${rsShort(M.inv)}</span><br>into investments</div>` : ''}</div>
      ${top.length ? `<p class="hint" style="margin:-4px 4px 8px">Most on ${top.map(([c, a]) => `${esc(c)} ${rsShort(a)}`).join(' · ')}.</p>` : ''}${subs ? `<button class="linkbtn" id="wkSubs">${subs} payment${subs > 1 ? 's look' : ' looks'} like a subscription — review ›</button>` : ''}`;
  }
  const last = +(lsGet('r2_lastReview') || 0);
  $('wkBody').innerHTML = `<div class="td-h">Week of ${fmtDate(wk, true)} – ${fmtDate(t, true)}</div>
    <div class="wk-grid"><div><span class="wk-n">${doneWk.length}</span><br>tasks done</div><div><span class="wk-n ${overdue.length ? 'neg' : ''}">${overdue.length}</span><br>overdue</div><div><span class="wk-n">${waiting.length}</span><br>waiting on others</div><div><span class="wk-n">${inbox}</span><br>in the Inbox</div></div>
    ${sec(`⚠︎ Overdue (${overdue.length})`, overdue.slice(0, 15).map(x => row('task', x.id, esc(x.title), x.priority === 'High' ? 'High priority' : '', fmtDate(x.dueDate), true)), 'Nothing overdue.')}
    ${sec(`⏳ Waiting on (${waiting.length})`, waiting.slice(0, 15).map(x => row('task', x.id, esc(x.title), x.waitingOn ? 'on ' + esc(x.waitingOn) : '', x.waitingSince ? waitAge(x) : '', x.waitingSince && -daysUntilISO(x.waitingSince) > 7)), 'Nobody to chase.')}
    ${sec(`☑︎ Due in the next 7 days (${dueNext.length})`, dueNext.slice(0, 15).map(x => row('task', x.id, esc(x.title), x.priority === 'High' ? 'High priority' : '', relDay(x.dueDate), false)), 'Nothing due.')}
    ${sec(`📅 Dates · next 14 days (${dates.length})`, dates.slice(0, 15).map(x => row('date', x.d.id, esc(x.d.label), '', x.days === 0 ? 'today' : inDays(x.days), false)), 'No dates coming up.')}
    ${docs.length ? sec(`📁 Documents expiring (${docs.length})`, docs.slice(0, 10).map(d => row('doc', d.id, esc(d.title), esc(docOwners(d).join(' & ')), daysUntilISO(d.expiry) < 0 ? 'expired' : inDays(daysUntilISO(d.expiry)), daysUntilISO(d.expiry) < 0)), '') : ''}
    ${money}
    <div class="group-title">✓ Done this week (${doneWk.length})</div>${doneWk.length ? `<p class="hint" style="margin:0 4px 8px">${doneWk.slice(0, 12).map(x => esc(x.title)).join(' · ')}${doneWk.length > 12 ? ' …' : ''}</p>` : '<p class="hint" style="margin:0 4px 8px">Nothing marked done this week.</p>'}
    ${notesWk ? `<p class="hint" style="margin:0 4px 8px">${notesWk} note${notesWk > 1 ? 's' : ''} written or changed this week.</p>` : ''}
    <div class="btn-row" style="margin-top:14px">${inbox ? '<button class="btn ghost small" id="wkInbox">📥 Sort the Inbox</button>' : ''}<button class="btn small brass" id="wkDone">Mark this week reviewed</button></div>
    <p class="hint">${last ? 'Last reviewed ' + timeAgo(last) + '.' : 'Not reviewed before on this device.'} A short look every Sunday keeps nothing slipping.</p>`;
  $$('[data-wk]', $('wkBody')).forEach(b => b.addEventListener('click', () => { const k = b.dataset.wk, id = b.dataset.wkid; Sheets.close('shWeekly', true);
    if (k === 'task') { showTab('tasks'); previewTask(id); } else if (k === 'date') { datePath = null; showTab('dates'); openDate(id); } else if (k === 'doc') { showTab('docs'); showDoc(id); } }));
  if ($('wkInbox')) $('wkInbox').addEventListener('click', () => { Sheets.close('shWeekly', true); openInbox(); });
  if ($('wkSubs')) $('wkSubs').addEventListener('click', () => { Sheets.close('shWeekly', true); setPref('moneySeg', 'ledger'); showTab('money'); openInsights(); setTimeout(() => { const s = $('subsBox'); if (s) s.scrollIntoView({ block: 'start' }); }, 300); });
  $('wkDone').addEventListener('click', () => { lsSet('r2_lastReview', String(Date.now())); Sheets.close('shWeekly'); toast('Week reviewed. See you next week.'); });
  if (!Sheets.isOpen('shWeekly')) Sheets.open('shWeekly');
}
const weeklyDue = () => { const last = +(lsGet('r2_lastReview') || 0); return !last || Date.now() - last > 6.5 * 86400000; };

