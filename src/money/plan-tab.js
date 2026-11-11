/* ==========================================================================
   PLAN TAB (simplified): show-until, year table, months, goals, settings
   ======================================================================== */
function renderPlan() {
  const body = $('planBody'), c = planCfg();
  planBadge();
  if (c && c.v !== 3) migratePlanV3();
  if (c) cleanZeroTicks();
  if (!c || !accts().length) { body.innerHTML = `<div class="empty"><b>Start in Accounts</b>Set up your accounts and opening balances first; the plan is built from them.</div><button class="btn brass block" id="plGoAcct">Go to Accounts</button>`;
    $('plGoAcct').addEventListener('click', () => { setPref('moneySeg', 'accts'); renderMoney(); }); return; }
  const mode = c.yearMode || 'fy', cur = isoMonth(new Date());
  const rows = planCompute(c, planHorizon(c)), years = planYears(rows, mode);
  const curKey = yearKey(cur < c.startMonth ? c.startMonth : cur, mode);
  if (Plan.year == null || !years.some(y => y.k === Plan.year)) Plan.year = years.some(y => y.k === curKey) ? curKey : years[0].k;
  const Y = years.find(y => y.k === Plan.year), L = Y.last, pend = planPendingMonths();
  const startKey = yearKey(c.startMonth, mode);
  const untilOpts = Array.from({ length: 21 }, (_, i) => startKey + i).map(k => { const em = mode === 'fy' ? (k + 1) + '-03' : k + '-12';
    return `<option value="${em}"${c.showUntil === em ? ' selected' : ''}>${yearLabel(k, mode)}</option>`; }).join('');
  const hidden = c.showUntil ? (() => { const auto = planAutoEnd(c); return auto > c.showUntil ? monthsBetween(c.showUntil, auto) : 0; })() : 0;
  const nowRow = rows.filter(r => r.ym <= cur).slice(-1)[0] || rows[0];
  const status = r => r.neg.length ? `<span class="st st-late" data-stmneg="${r.neg[0]}|${r.ym}" role="button" title="${esc(r.neg.map(acctName).join(', '))} below ₹0 — tap for the statement">below ₹0 ›</span>`
    : r.ended ? (r.closed ? '<span class="st st-ok">Checked</span>' : r.pending ? '<span class="st st-warn">Check-up due</span>' : '<span class="st st-part">Done</span>') : r.cur ? '<span class="st">This month</span>' : '<span class="st">Planned</span>';
  const yrows = rows.filter(r => yearKey(r.ym, mode) === Plan.year);
  const goals = all('goal').sort((a, b) => (a.by || '').localeCompare(b.by || ''));
  body.innerHTML = `<div class="plan-until"><label for="plUntil">Show plan until</label><select id="plUntil"><option value=""${c.showUntil ? '' : ' selected'}>Automatic</option>${untilOpts}</select>
      ${hidden ? `<span class="hint" style="margin:0">${hidden} planned month(s) lie beyond this.</span>` : ''}</div>
    ${pend.length ? `<button class="plan-banner" id="plPend"><b>${pend.length} month${pend.length > 1 ? 's need' : ' needs'} a check-up.</b> Start with ${monthLong(pend[0])}.</button>` : ''}
    ${(() => { const ov = monthOverrides(c).filter(x => x.diff); return ov.length ? `<button class="plan-banner" id="plOvr"><b>${ov.length} month${ov.length > 1 ? 's use' : ' uses'} an amount set for that month only</b>, different from Recurring (${esc([...new Set(ov.map(x => x.label))].slice(0, 3).join(', '))}). Review ›</button>` : ''; })()}
    <div class="group plan-card plan-hero"><div class="plan-hero-top"><span class="eyebrow">Money you'll have at end of</span><select id="plYear" aria-label="Year">${years.map(y => `<option value="${y.k}"${y.k === Plan.year ? ' selected' : ''}>${y.label}</option>`).join('')}</select><span class="muted">${monthLong(L.ym)}</span></div>
      <div class="plan-big ${L.worth < 0 ? 'neg' : ''}">${rsShort(L.worth)}</div>
      <div class="plan-split"><span>Bank & cash <b>${rsShort(L.liquid)}</b></span><span>Investments <b>${rsShort(L.invest)}</b>${accts().some(a => isInvest(a.kind) && +a.ret) ? '<i class="est">estimate</i>' : ''}</span>${L.cardDue ? `<span>Card dues <b>−${rsShort(L.cardDue)}</b></span>` : ''}${L.udh ? `<span>Udhaar <b>${rsShort(L.udh)}</b></span>` : ''}${L.loanBal ? `<span>Loan balance <b>${rsShort(L.loanBal)}</b></span>` : ''}</div>
      ${L.loanBal ? `<div class="hint" style="margin:4px 0 0">After loans: ${rsShort(L.afterLoans)}</div>` : ''}
</div>
    <button class="btn ghost block" id="plHold" style="margin:0 0 10px">👥 Who holds what</button>
    <details class="fold plan-acc"><summary>Accounts at end of ${Y.label}<span class="muted"> · statements</span></summary><div class="group">${
      accts(true).filter(a => !a.archived || Math.abs(L.accts[a.id] || 0) >= 0.5).map(a => { const v = L.accts[a.id] || 0, nm = L.neg.includes(a.id);
        return `<button class="row plan-li" data-plstmt="${a.id}"><div class="row-main"><div class="row-title">${esc(a.name)}</div><div class="row-sub"><span>${kindLabel(a.kind)}</span>${nm ? '<span class="st st-late">below ₹0</span>' : ''}</div></div><span class="amt ${v < 0 ? 'neg' : ''}">${rs(v)}</span><span class="chev" aria-hidden="true">›</span></button>`; }).join('')}
      ${(() => { let v = L.udh; try { v = stmtDataUdh(c, L.ym, L.ym, '').close; } catch (e) { RLOG.warn('udh row', e.message); }
        return `<button class="row plan-li" data-plstmt="udh"><div class="row-main"><div class="row-title">Udhaar (net)</div><div class="row-sub"><span>owed to you − you owe · all people</span></div></div><span class="amt ${v < 0 ? 'neg' : ''}">${rs(v)}</span><span class="chev" aria-hidden="true">›</span></button>`; })()}
      <button class="row plan-li" data-plstmt="*"><div class="row-main"><div class="row-title">All accounts</div><div class="row-sub"><span>everything except loans and udhaar</span></div></div><span class="chev" aria-hidden="true">›</span></button></div>
      <p class="hint">Tap one for its statement up to ${monthLong(L.ym)}: every month, what came in from where and went out to where.</p></details>
    <div class="plan-sec"><h3 class="plan-h">Year by year</h3><div class="tw"><table class="pt"><thead><tr><th>Year</th><th>Income</th><th>Spending</th><th>Saved</th><th>Into invest.</th><th>Bank & cash</th><th>Investments</th><th>Money you have</th><th>Loan balance</th><th>Checked</th></tr></thead><tbody>${
      years.map(y => `<tr class="${y.k === Plan.year ? 'hl' : ''}" data-year="${y.k}"><td>${y.label}${y.neg ? ' <span class="tag warn">!</span>' : ''}</td><td>${rsShort(y.inc)}</td><td>${rsShort(y.exp)}</td><td class="${y.inc - y.exp < 0 ? 'neg' : ''}">${rsShort(y.inc - y.exp)}</td><td>${y.invIn ? rsShort(y.invIn) : '–'}</td>
        <td class="${y.last.liquid < 0 ? 'neg' : ''}">${rsShort(y.last.liquid)}</td><td>${rsShort(y.last.invest)}</td><td><b>${rsShort(y.last.worth)}</b></td><td>${y.last.loanBal ? rsShort(y.last.loanBal) : '–'}</td><td>${y.ended ? y.closed + '/' + y.ended : '–'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="plan-sec"><h3 class="plan-h">Months · ${Y.label}</h3><div class="tw"><table class="pt pt-click"><thead><tr><th>Month</th><th>Income</th><th>Spending</th><th>Saved</th><th>Into invest.</th><th>Money you have</th><th>Status</th></tr></thead><tbody>${
      yrows.map(r => `<tr data-ym="${r.ym}" class="${r.cur ? 'hl' : ''}" tabindex="0"><td>${monthShort(r.ym)}</td><td>${r.inc ? rs(r.inc) : '–'}</td><td>${r.exp ? rs(r.exp) : '–'}</td><td class="${r.net < 0 ? 'neg' : 'pos'}">${rs(r.net)}</td><td>${r.invIn ? rs(r.invIn) : '–'}</td><td>${rs(r.worth)}</td><td>${status(r)}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Tap a past month for its check-up, or any month to change amounts or add a one-off. "Money you have" = bank + cash + investments + udhaar net − card dues (udhaar as it stood at the end of each past month). Loans are shown separately.</p></div>
    <div class="plan-sec"><h3 class="plan-h">Goals</h3>${goals.length ? goals.map(g => {
      const own = goalMode(g) === 'own', nowB = own ? balancesOn(c, todayISO()).accts : null;   // v2.27
      const nowV = own ? goalValue(g, null, nowB) : nowRow.worth, paid = own ? goalPaidTo(g) : 0;
      const hit = rows.find(r => r.ym >= cur && goalValue(g, r) >= (+g.amt || 0)) || (nowV >= (+g.amt || 0) ? { ym: cur } : null), pct = g.amt ? Math.max(0, Math.min(100, nowV / g.amt * 100)) : 0;
      const st = !hit ? ['Not reached in plan', 'st-warn'] : hit.ym <= g.by ? ['On track', 'st-ok'] : ['Late', 'st-late'];
      const need = goalMonthly(g, rows, cur);
      const from = own ? [goalLinked(g).map(acctName).join(' + '), paid ? 'paid ' + rsShort(paid) : ''].filter(Boolean).join(' · ') : 'all your money (not linked)';
      return `<button class="goal-row" data-goal="${g.id}"><div class="goal-top"><b>${esc(g.name)}</b><span class="st ${st[1]}">${st[0]}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="hint" style="margin:4px 0 0">${rsShort(nowV)} of ${rsShort(g.amt)} now (${pct.toFixed(0)}%) · counts ${esc(from)} · wanted by ${monthLong(g.by)} · plan reaches it ${hit ? 'in ' + monthLong(hit.ym) : 'after ' + monthLong(rows[rows.length - 1].ym)}</div>${need}</button>`; }).join('')
      + '<p class="hint">A goal counts its own accounts plus payments made towards it (set in the goal). A goal with nothing linked counts all your money, so such goals share the same money.</p>' : '<p class="hint" style="margin:0 4px 8px">No goals yet.</p>'}
      <button class="btn ghost small" id="plGoalAdd">＋ Add goal</button></div>
    <div class="plan-sec"><div class="btn-row" style="flex-wrap:wrap"><button class="btn ghost small" id="plSettings">Plan settings</button><button class="btn ghost small" id="plXlsx">Export Excel</button></div>
      <p class="hint">Started ${monthLong(c.startMonth)} · opening balances as on ${fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true)} · ${mode === 'fy' ? 'financial years (Apr–Mar)' : 'calendar years'}.</p></div>`;
  $('plYear').addEventListener('change', e => { Plan.year = +e.target.value; renderPlan(); });
  $('plUntil').addEventListener('change', e => { c.showUntil = e.target.value || null; put(c, { render: false }); Plan.year = null; renderPlan(); });
  if ($('plPend')) $('plPend').addEventListener('click', () => planMonthSheet(pend[0]));
  if ($('plOvr')) $('plOvr').addEventListener('click', () => overrideSheet());   // v2.26.1
  $('plHold').addEventListener('click', () => { Hold.edit = false; holdersSheet(isoMonth(new Date())); });   // v2.27
  $$('[data-year]', body).forEach(tr => tr.addEventListener('click', () => { Plan.year = +tr.dataset.year; renderPlan(); }));
  $$('[data-ym]', body).forEach(tr => { const go = () => planMonthSheet(tr.dataset.ym); tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); });
  $('plGoalAdd').addEventListener('click', () => planGoalSheet(null));
  $$('[data-plstmt]', body).forEach(b => b.addEventListener('click', () => openStatement(b.dataset.plstmt, { to: L.ym, person: '' })));   // v2.25
  $$('[data-stmneg]', body).forEach(t => t.addEventListener('click', ev => { ev.stopPropagation(); const [id, ym] = t.dataset.stmneg.split('|'); openStatement(id, { focus: ym, to: planHorizon(c) }); }));

  $$('[data-goal]', body).forEach(b => b.addEventListener('click', () => planGoalSheet(b.dataset.goal)));
  $('plSettings').addEventListener('click', planSettingsSheet);
  $('plXlsx').addEventListener('click', exportXlsx);
}
/* v2.25: what saving a month gets a goal there on time, on top of what the plan already saves */
function goalMonthly(g, rows, cur) {
  const amt = +g.amt || 0; if (!amt || !ymOk(g.by)) return '';
  if (g.by < cur) return '';
  const at = rows.find(r => r.ym === g.by) || null, last = rows[rows.length - 1];
  const base = goalValue(g, at || last) || 0, gap = amt - base, n = Math.max(1, monthsBetween(cur, g.by) + 1);
  if (gap <= 0.5) return '<div class="hint" style="margin:2px 0 0">Nothing extra needed — the plan gets there on time.</div>';
  return `<div class="hint goal-need" style="margin:2px 0 0">Save <b>${rs(Math.ceil(gap / n / 100) * 100)} a month</b> more than the plan (${n} month${n > 1 ? 's' : ''}) to reach it by ${monthLong(g.by)}.${at ? '' : ' The plan does not reach that month, so this uses its last month.'}</div>`;
}
/* v2.27: a goal counts the balance of its own accounts plus payments made towards it (Ledger spending marked with the goal).
   An account can belong to one goal only. A goal with neither counts all your money, as before. */
function goalTaken(exceptId) { const t = {}; all('goal').forEach(g => { if (g.id !== exceptId) (g.links || []).forEach(a => { t[a] = g.name; }); }); return t; }
function goalOptions(sel) { return `<option value="">— none —</option>` + all('goal').map(g => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${esc(g.name)}</option>`).join(''); }
const goalLinked = g => (g.links || []).filter(id => acctById(id));
const goalPaidTo = (g, ym) => all('fin').filter(e => e.goal === g.id && e.kind === 'expense' && (!ym || (e.date || '').slice(0, 7) <= ym)).reduce((t, e) => t + (+e.amount || 0), 0);
const goalMode = g => goalLinked(g).length || all('fin').some(e => e.goal === g.id) ? 'own' : 'all';
function goalValue(g, row, nowBal) {   // row: a plan month row; nowBal: today's balances (B.accts) for "now"
  if (goalMode(g) === 'all') return row ? row.worth : null;
  const acc = goalLinked(g).reduce((t, id) => t + ((nowBal || (row && row.accts) || {})[id] || 0), 0);
  return acc + goalPaidTo(g, nowBal ? null : row && row.ym);
}
/* v2.27: "Who holds what" — money held by each person (groups of accounts) at the end of a month, plus udhaar with chosen people */
function holderGroups(c) {
  if (Array.isArray(c.holders)) return c.holders.map(h => ({ ...h, accts: (h.accts || []).filter(id => acctById(id)) }));
  const A = accts(), used = new Set(), pick = f => A.filter(a => !used.has(a.id) && f(a)).map(a => (used.add(a.id), a.id));
  const has = (a, w) => new RegExp('(^|\\s)' + w + '(\\s|$)', 'i').test(a.name);
  return [
    { id: 'h1', name: 'Rahul — accounts', accts: pick(a => /^rk\s*(sbi|hdfc)$/i.test(a.name.trim()) || (a.kind === 'mf' && /mutual/i.test(a.name))) },
    { id: 'h2', name: 'Rahul — cash', accts: pick(a => a.kind === 'cash' && /^rk/i.test(a.name)) },
    { id: 'h3', name: 'Moni', accts: pick(a => has(a, 'moni')) },
    { id: 'h4', name: 'Papa', accts: pick(a => has(a, 'papa')) },
    { id: 'h5', name: 'Mummy', accts: pick(a => has(a, 'mummy')) }
  ].filter(h => h.accts.length);
}
const Hold = { ym: null, edit: false, draft: null };
const hdCollect = () => $$('.hd-g', $('pshBody')).map((el, i) => ({ id: el.dataset.hg, name: el.querySelector('.hdName').value.trim() || 'Group ' + (i + 1), accts: $$('[data-ha]', el).filter(b => b.checked).map(b => b.dataset.ha) }));
function holdersSheet(ym) {
  const c = planCfg(); if (!c) return;
  const cur = isoMonth(new Date());
  Hold.ym = ym || Hold.ym || cur;
  const G = Hold.edit && Hold.draft ? Hold.draft : holderGroups(c), people = udhGroups().sort((a, b) => a.name.localeCompare(b.name)), sel = new Set(Hold.edit && Hold.selDraft ? Hold.selDraft : c.holderUdh || []);
  const rows = planCompute(c, Hold.ym < c.startMonth ? c.startMonth : Hold.ym), row = rows[rows.length - 1];
  const bal = Hold.ym === cur ? balancesOn(c, todayISO()).accts : row.accts;
  const val = ids => ids.reduce((t, id) => t + (bal[id] || 0), 0);
  const inG = new Set(G.flatMap(h => h.accts)), rest = accts(true).filter(a => a.kind !== 'loan' && !inG.has(a.id) && Math.abs(bal[a.id] || 0) >= 0.5);
  const udhOf = k => { try { return stmtDataUdh(c, Hold.ym, Hold.ym, k).close; } catch (e) { return 0; } };
  const when = Hold.ym < cur ? 'end of ' + monthLong(Hold.ym) + ' (actual)' : Hold.ym === cur ? 'today' : 'end of ' + monthLong(Hold.ym) + ' (plan)';
  let html;
  if (!Hold.edit) {
    const udhRows = [...sel].map(k => { const g = people.find(p => p.k === k); return g ? [g.name, udhOf(k)] : null; }).filter(Boolean);
    const line = (n, sub, v, cls) => `<div class="pl-row"><span class="r-name">${esc(n)}${sub ? `<small class="dq-sub">${esc(sub)}</small>` : ''}</span><b class="mono ${cls || (v < 0 ? 'neg' : '')}">${rs(v)}</b></div>`;
    const tot = G.reduce((t, h) => t + val(h.accts), 0);
    html = `<div class="field"><label>Month</label>${monthIn('hdYm', Hold.ym)}</div>
      <p class="hint" style="margin:-6px 4px 10px">Balances at ${esc(when)}.</p>
      ${G.map(h => `<h4 class="plan-sub">${esc(h.name)}</h4><div class="group pl-group">${h.accts.map(id => { const a = acctById(id); return line(a ? a.name : '?', a ? kindLabel(a.kind) : '', bal[id] || 0); }).join('') || '<p class="hint" style="margin:8px">No accounts in this group.</p>'}
        ${h.accts.length > 1 ? `<div class="pl-row" style="border-top:1px solid var(--line)"><span class="r-name"><b>Total · ${esc(h.name)}</b></span><b class="mono ${val(h.accts) < 0 ? 'neg' : ''}">${rs(val(h.accts))}</b></div>` : ''}</div>`).join('') || '<div class="group pl-group"><p class="hint" style="margin:8px">No groups yet — tap Edit groups.</p></div>'}
      ${G.length > 1 ? `<div class="group pl-group" style="margin-top:6px">${line('Total of all groups', '', tot, 'pos')}</div>` : ''}
      <h4 class="plan-sub">Udhaar (net) · people you chose</h4>
      <div class="group pl-group">${udhRows.length ? udhRows.map(([n, v]) => line(n, v > 0 ? 'owes you' : v < 0 ? 'you owe' : 'settled', v)).join('') + (udhRows.length > 1 ? line('Net', '', udhRows.reduce((t, x) => t + x[1], 0)) : '') : '<p class="hint" style="margin:8px">Nobody chosen — tap Edit groups.</p>'}</div>
      ${rest.length ? `<details class="fold"><summary>Not in any group (${rest.length})</summary><div class="group pl-group">${rest.map(a => line(a.name, kindLabel(a.kind), bal[a.id] || 0)).join('')}</div></details>` : ''}
      <button class="btn ghost small" id="hdEdit" style="margin-top:10px">✎ Edit groups</button>`;
  } else {
    const owner = {}; G.forEach(h => h.accts.forEach(id => { owner[id] = h.id; }));
    html = `<p class="hint" style="margin:0 4px 10px">Each account can be in one group. Loans are left out.</p>
      <div id="hdGroups">${G.map((h, i) => `<div class="group pl-group hd-g" data-hg="${esc(h.id)}" style="padding:10px 12px;margin-bottom:10px">
        <div style="display:flex;gap:8px;align-items:center"><input class="hdName" value="${esc(h.name)}" aria-label="Group name"><button class="icon-btn hdDel" aria-label="Remove group">✕</button></div>
        ${accts().filter(a => a.kind !== 'loan').map(a => `<label class="switch-row"><span>${esc(a.name)}<small>${kindLabel(a.kind)}</small></span><input type="checkbox" class="sw" data-ha="${a.id}"${owner[a.id] === h.id ? ' checked' : ''}></label>`).join('')}</div>`).join('')}</div>
      <button class="linkbtn" id="hdAdd">＋ Add a group</button>
      <h4 class="plan-sub">Udhaar: people to show</h4>
      <div class="group pl-group">${people.map(p => `<label class="switch-row"><span>${esc(p.name)}</span><input type="checkbox" class="sw" data-hp="${esc(p.k)}"${sel.has(p.k) ? ' checked' : ''}></label>`).join('') || '<p class="hint" style="margin:8px">No udhaar yet.</p>'}</div>`;
  }
  planSheet('Who holds what', html, () => {
    if (!Hold.edit) return true;
    const gs = hdCollect();
    const seen = new Set(); for (const g of gs) for (const a of g.accts) { if (seen.has(a)) { planMsg(`${acctName(a)} is ticked in two groups — keep it in one.`, true); return false; } seen.add(a); }
    c.holders = gs; c.holderUdh = $$('[data-hp]', $('pshBody')).filter(b => b.checked).map(b => b.dataset.hp); put(c, { render: false });
    Hold.edit = false; Hold.draft = null; Hold.selDraft = null; setTimeout(() => holdersSheet(), 0); return false;
  }, Hold.edit ? 'Save' : 'Done');
  if ($('hdYm')) $('hdYm').addEventListener('change', e => { if (ymOk(e.target.value)) holdersSheet(e.target.value); });
  if ($('hdEdit')) $('hdEdit').addEventListener('click', () => { Hold.edit = true; Hold.draft = null; Hold.selDraft = null; holdersSheet(); });
  if ($('hdAdd')) $('hdAdd').addEventListener('click', () => { Hold.draft = hdCollect(); Hold.draft.push({ id: uid('h'), name: 'New group', accts: [] }); Hold.selDraft = $$('[data-hp]', $('pshBody')).filter(b => b.checked).map(b => b.dataset.hp); holdersSheet(); });
  $$('.hdDel', $('pshBody')).forEach(b => b.addEventListener('click', () => b.closest('.hd-g').remove()));
}
Sheets.onClose.shPlan = (prev => () => { Hold.edit = false; Hold.draft = null; Hold.selDraft = null; if (prev) prev(); })(Sheets.onClose.shPlan);
function planGoalSheet(id) {
  const g = id ? records[id] : { name: '', amt: '', by: '' }, c = planCfg(), cur = isoMonth(new Date());
  const past = planCompute(c, cur < c.startMonth ? c.startMonth : cur).filter(r => r.exp > 0).slice(-6);
  const avg = past.length ? past.reduce((s, r) => s + r.exp, 0) / past.length : 0;
  const html = `${id ? '' : `<div class="wrapchips" style="margin-bottom:12px">${['Emergency fund', 'House / property', "Children's education"].map(n => `<button class="chip" data-gq="${esc(n)}">${n}</button>`).join('')}</div>`}
    <div class="field"><label>Goal</label><input id="pgName" value="${esc(g.name)}"></div>
    <div class="grid2"><div class="field"><label>Amount ₹</label>${amtIn('pgAmt', g.amt)}</div><div class="field"><label>Wanted by</label>${monthIn('pgBy', g.by)}</div></div>
    ${avg ? `<button class="linkbtn" id="pgSix">Use 6 months of spending (${rs(avg * 6)})</button>` : ''}
    <h4 class="plan-sub">Counts from</h4>
    <div class="group pl-group">${(() => { const taken = goalTaken(id); return accts().filter(a => a.kind !== 'loan' && a.kind !== 'card').map(a => { const other = taken[a.id];
      return `<label class="switch-row"><span>${esc(a.name)}<small>${other ? 'used by “' + esc(other) + '”' : kindLabel(a.kind)}</small></span><input type="checkbox" class="sw" data-pgl="${a.id}"${(g.links || []).includes(a.id) ? ' checked' : ''}${other ? ' disabled' : ''}></label>`; }).join(''); })()}</div>
    <p class="hint">Tick the account(s) where this goal's money is kept — e.g. a separate savings account, an FD or PPF. Money you put into them (transfers, SIPs) counts. Payments you make towards the goal count too: pick the goal on that spending entry in the Ledger (“Towards a goal”). Leave all unticked to measure the goal against all your money, as before.</p>
    ${id ? '<button class="btn danger block" id="pgDel" style="margin-top:14px">Delete goal</button>' : ''}`;
  planSheet(id ? 'Goal' : 'New goal', html, () => {
    try {
      const name = $('pgName').value.trim(); if (!name) throw new Error('Name the goal.');
      const by = $('pgBy').value; if (!ymOk(by)) throw new Error('Pick the month you want it by.');
      const rec = id ? records[id] : { id: uid('gl'), type: 'goal', deleted: false };
      const links = $$('[data-pgl]', $('pshBody')).filter(b => b.checked && !b.disabled).map(b => b.dataset.pgl);
      Object.assign(rec, { name, amt: readAmt('pgAmt', 'Amount', true), by, links }); put(rec, { render: false }); toast('Goal saved.'); return true;
    } catch (e) { planMsg(e.message, true); return false; }
  });
  $$('[data-gq]', $('pshBody')).forEach(b => b.addEventListener('click', () => { $('pgName').value = b.dataset.gq; }));
  if ($('pgSix')) $('pgSix').addEventListener('click', () => { $('pgAmt').value = Math.round(avg * 6); if (!$('pgName').value) $('pgName').value = 'Emergency fund'; });
  if (id) $('pgDel').addEventListener('click', () => { Sheets.close('shPlan', true); deleteWithUndo(id, g.name); });
}
function planSettingsSheet() {
  const c = planCfg(); if (!c) return;
  const html = `<div class="field"><label>Plan starts</label>${monthIn('ptStart', c.startMonth)}</div>
    <p class="hint" style="margin:-6px 4px 12px">Opening balances are as on the last day of the month before. Change them in Accounts → Opening balances.</p>
    <div class="field"><label>Default account</label><select id="ptDef">${acctOptions(defAcct(c), a => isLiquid(a.kind) || a.kind === 'card')}</select></div>
    <p class="hint" style="margin:-6px 4px 12px">Used when a Ledger entry has no account (older entries) and pre-selected for new items.</p>
    <div class="field"><label>Show years as</label><div class="seg" id="ptMode"><button data-m="fy" class="${(c.yearMode || 'fy') === 'fy' ? 'on' : ''}">Financial (Apr–Mar)</button><button data-m="cal" class="${c.yearMode === 'cal' ? 'on' : ''}">Calendar (Jan–Dec)</button></div></div>
    <div class="group"><label class="switch-row"><span>Remind me to do the monthly check-up<small>Adds "${CHECKUP_LABEL}" on the 1st of every month to Key dates (and the daily email, if you use it).</small></span><input type="checkbox" class="sw" id="ptRemind"${checkupDate() ? ' checked' : ''}></label></div>`;
  planSheet('Plan settings', html, () => {
    setCheckupReminder($('ptRemind').checked);
    const start = $('ptStart').value; if (!ymOk(start)) { planMsg('Pick a start month.', true); return false; }
    if (start < c.startMonth && archIndex().length && !confirm(ARCH_START_WARN)) return false;
    Object.assign(c, { startMonth: start, defAcct: $('ptDef').value, yearMode: $('ptMode').querySelector('.on').dataset.m }); put(c, { render: false }); Plan.year = null; toast('Saved.'); return true;
  });
  $$('#ptMode button').forEach(b => b.addEventListener('click', () => $$('#ptMode button').forEach(x => x.classList.toggle('on', x === b))));
}

/* ---------- Excel export (SheetJS, loaded on first use, then kept offline) ---------- */
const XLSX_URL = 'vendor/xlsx.full-0.18.5.min.js';
async function exportXlsx() {
  const c = planCfg();
  try { await loadScript(XLSX_URL); } catch (e) { toast('Excel export needs internet the first time.'); return; }
  const X = window.XLSX, wb = X.utils.book_new(), cur = isoMonth(new Date());
  const add = (name, rows, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
  if (c && accts(true).length) {
    const rows = planCompute(c, planHorizon(c)), now = cur < c.startMonth ? null : planCompute(c, cur, 'actual').slice(-1)[0];
    const today = balancesOn(c, todayISO());
    add('Accounts', [['Account', 'Type', 'Opening (' + monthEnd(monthAdd(c.startMonth, -1)) + ')', now ? 'Today ' + todayISO() + ' (actual)' : 'Today (plan not started: opening)', 'Plan ' + rows[rows.length - 1].ym, 'Archived']].concat(
      accts(true).map(a => [a.name, kindLabel(a.kind), a.kind === 'loan' && loanSched(a) ? -Math.round(loanOwed(a, monthAdd(c.startMonth, -1))) : isLiab(a.kind) ? -(+a.open || 0) : +a.open || 0, Math.round(today.accts[a.id] || 0), Math.round(rows[rows.length - 1].accts[a.id] || 0), a.archived ? 'yes' : '']))
      .concat([[], ['Money you have (bank + cash + investments + udhaar net − card dues)', '', '', Math.round(today.money)], ['Money in hand (bank + cash − card dues)', '', '', Math.round(today.hand)], ['Bank & wallets', '', '', Math.round(today.bank)], ['Cash', '', '', Math.round(today.cash)], ['Investments', '', '', Math.round(today.invest)],
        ['Card dues', '', '', -Math.round(today.card)], ['Loan balance (separate)', '', '', Math.round(today.loan)], ['Others owe you', '', '', Math.round(today.owed)], ['You owe others', '', '', -Math.round(today.owe)]]), [30, 16, 18, 22, 16, 9]);
    const loans = accts(true).filter(a => a.kind === 'loan');
    if (loans.length) add('Loans', [['Loan', 'EMI', 'Paid from', 'First EMI', 'Last EMI', 'Loan amount', 'EMIs total', 'EMIs paid', 'EMIs left', 'Paid so far', 'Still to pay (EMIs)', 'Interest rate %', 'Principal owed now']].concat(
      loans.map(a => { const k = loanInfo(a); return [a.name, +a.emi || 0, acctName(a.payFrom), a.start || '', a.end || '', +a.amount || '', k.n || '', k.paid || 0, k.left == null ? '' : k.left, k.paidAmt || 0, k.leftAmt == null ? '' : k.leftAmt, k.rate == null ? '' : +k.rate.toFixed(2), k.outstanding == null ? '' : Math.round(k.outstanding)]; })),
      [18, 10, 16, 10, 10, 12, 10, 10, 10, 12, 14, 12, 16]);
    add('Months', [['Month', 'Income', 'Spending', 'Saved', 'Into investments', ...accts(true).map(a => a.name), 'Udhaar net', 'Money you have', 'Money in hand', 'Loan balance', 'After loans', 'Status']].concat(
      rows.map(r => [r.ym, Math.round(r.inc), Math.round(r.exp), Math.round(r.net), Math.round(r.invIn), ...accts(true).map(a => Math.round(r.accts[a.id] || 0)), Math.round(r.udh), Math.round(r.worth), Math.round(r.hand), Math.round(r.loanBal), Math.round(r.afterLoans),
        r.ended ? (r.closed ? 'Checked' : r.pending ? 'Check-up due' : 'Done') : r.cur ? 'This month' : 'Planned'])), [9, 12, 12, 12, 14, ...accts(true).map(() => 16), 12, 14, 13, 13, 13, 12]);
    add('Recurring', [['Name', 'Type', 'Amount', 'From', 'Into', 'Every (months)', 'First', 'Last', 'Estimate', 'Amount changes']].concat(
      recurs().map(r => [r.name, r.kind, +r.amt, r.from ? acctName(r.from) : '', r.to ? acctName(r.to) : '', +r.every || 1, r.start, r.end || '', r.budget ? 'yes' : '', (r.steps || []).map(x => x.a + ' from ' + x.month).join('; ')])), [24, 10, 12, 20, 20, 8, 9, 9, 9, 30]);
  }
  add('Ledger', [['Date', 'Description', 'Type', 'Category', 'Account', 'To account', 'Person', 'Amount', 'Outstanding (udhaar)']].concat(
    all('fin').sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => [e.date, e.desc, e.kind, e.category || '', e.acct ? acctName(e.acct) : '', e.to ? acctName(e.to) : '', e.who || '', +e.amount, isUdh(e) ? outstanding(e) : ''])), [11, 30, 10, 12, 20, 20, 14, 12, 12]);
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  shareOrDownload(out, 'register-money-' + todayISO() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
/* kept for the CSV button on older layouts */
function planCsv(c, rows) {
  const csv = [['Month', 'Income', 'Spending', 'Net worth']].concat(rows.map(r => [r.ym, Math.round(r.inc), Math.round(r.exp), Math.round(r.worth)])).map(r => r.join(',')).join('\n');
  shareOrDownload('﻿' + csv, 'register-plan-' + todayISO() + '.csv', 'text/csv');
}

