/* ==========================================================================
   v2.25 — ACCOUNT STATEMENT: month by month, what came in from where and went out to where
   ======================================================================== */
const stmtXferLabel = (label, other, arrow) => { const n = other ? other.name : ''; return !n || String(label).includes(n) ? String(label) : `${label} ${arrow} ${n}`; };
/* One Ledger movement on one account, as a statement line. */
function stmtFlowLine(f) {
  const e = f.e || {}, desc = String(e.desc || '').trim(), base = { amt: f.amt, src: 'actual', ids: e.id ? [e.id] : [] };
  if (f.cat === 'inc') return { ...base, label: desc || e.category || 'Income' };
  if (f.cat === 'exp') return { ...base, label: e.planRef && desc ? desc : e.category === 'Investment' ? 'Investment' + (desc ? ' · ' + desc : '') : e.category ? 'Spending: ' + e.category : 'Spending: other' };
  if (f.cat === 'out') { const T = acctById(e.to); return { ...base, label: e.planRef && desc ? stmtXferLabel(desc, T, '→') : 'To ' + (T ? T.name : '—'), peer: e.to || null }; }
  if (f.cat === 'in') { const F = acctById(e.acct); return { ...base, label: e.planRef && desc ? stmtXferLabel(desc, F, '←') : 'From ' + (F ? F.name : '—'), peer: e.acct || null }; }
  if (f.cat === 'inv') { const F = acctById(e.acct); return { ...base, label: 'Investment' + (desc ? ' · ' + desc : '') + (F ? ' ← ' + F.name : ''), peer: e.acct || null }; }   // v2.35
  if (f.cat === 'udh') { const who = String(e.who || '').trim() || '?';   // v2.26.1: one name per stream, same as the plan's
    return { ...base, label: e.kind === 'lent' ? (f.amt < 0 ? `Udhaar to ${who}` : `${who} (udhaar back)`) : (f.amt > 0 ? `Borrowed from ${who}` : `Paid back to ${who}`), grp: 'udh' }; }
  return { ...base, label: desc || 'Other' };
}
const Stmt = { acct: null, from: null, to: null, focus: null, person: '' };
/* The figures behind a statement. acct '*' = all accounts except loans. */
function stmtData(c, acct, fromYm, toYm) {
  const log = { open: {}, months: {} }, rows = planCompute(c, toYm, undefined, log), cur = isoMonth(new Date());
  const all_ = acct === '*', ids = all_ ? accts(true).filter(a => a.kind !== 'loan').map(a => a.id) : [acct], inSet = new Set(ids);
  const sum = o => ids.reduce((s, id) => s + (o && o[id] || 0), 0);
  const months = rows.filter(r => r.ym >= fromYm).map(r => {
    const raw = [].concat(...ids.map(id => (log.months[r.ym] || {})[id] || []));
    const m = new Map(); let between = 0;
    raw.forEach(l => {
      if (all_ && l.peer && inSet.has(l.peer)) { between += l.amt; return; }   // money moved between your own accounts
      const k = (l.amt > 0 ? '+' : '-') + l.label;
      if (!m.has(k)) m.set(k, { label: l.label, amt: 0, n: 0, ids: [], src: l.src, peer: l.peer || null });
      const g = m.get(k); g.amt += l.amt; g.n++; g.ids.push(...(l.ids || [])); if (l.src !== g.src) g.src = 'mixed';
    });
    if (Math.abs(between) >= 0.5) m.set('~between', { label: 'Between your own accounts', amt: between, n: 1, ids: [], src: 'actual', peer: null });
    const lines = [...m.values()].filter(g => Math.abs(g.amt) >= 0.005).sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
    return { ym: r.ym, open: sum(log.open[r.ym]), close: sum(r.accts), inn: lines.filter(g => g.amt > 0), out: lines.filter(g => g.amt < 0),
      when: r.ym < cur ? 'actual' : r.ym === cur ? 'this month' : 'plan', neg: ids.some(id => r.neg.includes(id)) };
  });
  const tot = side => { const m = new Map(); months.forEach(x => x[side].forEach(g => { m.set(g.label, (m.get(g.label) || 0) + g.amt); })); return [...m.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); };
  return { months, inTot: tot('inn'), outTot: tot('out'), open: months.length ? months[0].open : 0, close: months.length ? months[months.length - 1].close : 0, ids };
}
/* v2.26: udhaar as a statement — what is owed to you (net), month by month. Ledger entries by their dates; later months from the plan
   (Udhaar back instalments and Udhaar give estimates). person = name key ('' = everyone). */
function udhEvents() {
  const ev = [];
  all('fin').filter(isUdh).forEach(e => {
    const who = String(e.who || '').trim() || '?', k = udhKey(e.who), s = udhSign(e), d = finDate(e);
    if (!d) return;
    const first = e.kind === 'lent' ? `Given to ${who}` : isPaidBy(e) ? `${who} paid for you` : `Borrowed from ${who}`;
    const back = e.kind === 'lent' ? `${who} paid back` : `Paid back to ${who}`;
    ev.push({ k, ym: d.slice(0, 7), label: first, amt: s * (+e.amount || 0), id: e.id });
    const pays = (e.pays || []).filter(p => +p.amt);
    pays.forEach(p => { const pd = (p.date || d).slice(0, 10); ev.push({ k, ym: pd.slice(0, 7), label: back, amt: -s * (+p.amt || 0), id: e.id }); });
    const rest = +((e.paidAmount || 0) - pays.reduce((t, p) => t + (+p.amt || 0), 0)).toFixed(2);
    if (Math.abs(rest) > 0.005) ev.push({ k, ym: d.slice(0, 7), label: back + ' (date not recorded)', amt: -s * rest, id: e.id });
    if (e.settled) { const gap = +((+e.amount || 0) - (e.paidAmount || 0)).toFixed(2); if (Math.abs(gap) > 0.005) ev.push({ k, ym: d.slice(0, 7), label: `Marked settled with ${who}`, amt: -s * gap, id: e.id }); }
  });
  return ev;
}
function stmtDataUdh(c, fromYm, toYm, person) {
  const log = { open: {}, months: {}, udh: {} }, rows = planCompute(c, toYm, undefined, log), cur = isoMonth(new Date());
  const ok = k => !person || k === person;
  const ev = udhEvents().filter(x => ok(x.k));
  let open = ev.filter(x => x.ym < fromYm).reduce((t, x) => t + x.amt, 0);
  Object.keys(log.udh).filter(ym => ym < fromYm).forEach(ym => log.udh[ym].forEach(l => { if (ok(udhKey(l.who))) open += l.amt; }));
  const months = [];
  for (let ym = fromYm, i = 0; ym <= toYm && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) {
    const m = new Map(), addL = (label, amt, src, id) => { const key = (amt > 0 ? '+' : '-') + label; if (!m.has(key)) m.set(key, { label, amt: 0, n: 0, ids: [], src, peer: null }); const g = m.get(key); g.amt += amt; g.n++; if (id) g.ids.push(id); if (g.src !== src) g.src = 'mixed'; };
    ev.filter(x => x.ym === ym).forEach(x => addL(x.label, x.amt, 'actual', x.id));
    (log.udh[ym] || []).filter(l => ok(udhKey(l.who))).forEach(l => addL(l.label, l.amt, l.src));
    const lines = [...m.values()].filter(g => Math.abs(g.amt) >= 0.005).sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
    const close = open + lines.reduce((t, g) => t + g.amt, 0);
    months.push({ ym, open, close, inn: lines.filter(g => g.amt > 0), out: lines.filter(g => g.amt < 0), when: ym < cur ? 'actual' : ym === cur ? 'this month' : 'plan', neg: false });
    open = close;
  }
  const tot = side => { const mm = new Map(); months.forEach(x => x[side].forEach(g => mm.set(g.label, (mm.get(g.label) || 0) + g.amt))); return [...mm.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); };
  return { months, inTot: tot('inn'), outTot: tot('out'), open: months.length ? months[0].open : 0, close: months.length ? months[months.length - 1].close : 0, ids: [] };
}
function openStatement(acct, opts) {
  const c = planCfg(); if (!c || !accts().length) { toast('Set up Money → Accounts first.'); return; }
  opts = opts || {};
  Stmt.acct = acct || Stmt.acct || '*';
  if (Stmt.acct !== '*' && Stmt.acct !== 'udh' && !acctById(Stmt.acct)) Stmt.acct = '*';
  if (opts.person != null) Stmt.person = opts.person;
  Stmt.from = opts.from || Stmt.from || c.startMonth;
  Stmt.to = opts.to || Stmt.to || planHorizon(c);
  Stmt.focus = opts.focus || null;
  renderStatement();
  if (!Sheets.isOpen('shStmt')) Sheets.open('shStmt');
  if (Stmt.focus) setTimeout(() => { const el = $('stm-' + Stmt.focus); if (el) el.scrollIntoView({ block: 'start' }); }, 250);
}
function renderStatement() {
  const c = planCfg(), body = $('stmBody'); if (!c || !body) return;
  const cap = monthAdd(c.startMonth, PLAN_MAX_MONTHS - 1);
  if (!ymOk(Stmt.from) || Stmt.from < c.startMonth) Stmt.from = c.startMonth;
  if (!ymOk(Stmt.to) || Stmt.to > cap) Stmt.to = planHorizon(c);
  if (Stmt.to < Stmt.from) Stmt.to = Stmt.from;
  const isU = Stmt.acct === 'udh';
  const D = isU ? stmtDataUdh(c, Stmt.from, Stmt.to, Stmt.person || '') : stmtData(c, Stmt.acct, Stmt.from, Stmt.to), A = isU || Stmt.acct === '*' ? null : acctById(Stmt.acct);
  const W = isU ? { inn: 'Owed to you goes up', out: 'Owed to you goes down', open: 'Owed to you (net)', note: ' Udhaar: a positive figure is owed to you, negative is what you owe. Past months from your udhaar entries and their payment dates; later months from Udhaar back instalments and Udhaar give estimates.' }
    : { inn: 'Received from', out: 'Paid to', open: 'Opening', note: '' };
  $('stmTitle').textContent = isU ? 'Udhaar' + (Stmt.person ? ' · ' + ((udhGroups().find(g => g.k === Stmt.person) || {}).name || Stmt.person) : '') : A ? A.name : 'All accounts';
  const amt = v => Math.round(Math.abs(v)).toLocaleString('en-IN');
  const item = g => g.peer && acctById(g.peer) && g.peer !== Stmt.acct
    ? `<button class="stm-i stm-link" data-stmacct="${g.peer}">${esc(g.label)} <b>${amt(g.amt)}</b></button>`
    : `<span class="stm-i${g.src === 'est' ? ' est' : ''}">${esc(g.label)}${g.n > 1 && g.src === 'actual' ? ` <small>(${g.n})</small>` : ''} <b>${amt(g.amt)}</b></span>`;
  const entries = x => { const ids = [...new Set([].concat(...x.inn.concat(x.out).map(g => g.ids)))].map(id => records[id]).filter(e => e && !e.deleted);
    return ids.length ? `<details class="stm-ent"><summary>Ledger entries (${ids.length})</summary>${ids.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => `<button class="stm-e" data-stmfe="${e.id}"><span>${fmtDate(e.date)} · ${esc(e.desc || kindWord(e))}</span><b>${rs(e.amount)}</b></button>`).join('')}</details>` : ''; };
  const month = x => `<div class="stm-m${x.neg ? ' bad' : ''}" id="stm-${x.ym}"><div class="stm-h"><b>${esc(monthLong(x.ym))}</b><span class="tag${x.when === 'plan' ? '' : x.when === 'actual' ? ' ok' : ' cur'}">${x.when}</span>${x.neg ? '<span class="st st-late">below ₹0</span>' : ''}</div>
      <div class="stm-g"><div class="stm-c op"><span class="k">Opening</span><b class="${x.open < 0 ? 'neg' : ''}">${rs(x.open)}</b></div>
        <div class="stm-c in"><span class="k">${W.inn}</span><div class="stm-l">${x.inn.map(item).join('') || '<span class="muted">—</span>'}</div></div>
        <div class="stm-c out"><span class="k">${W.out}</span><div class="stm-l">${x.out.map(item).join('') || '<span class="muted">—</span>'}</div></div>
        <div class="stm-c cl"><span class="k">Closing</span><b class="${x.close < 0 ? 'neg' : ''}">${rs(x.close)}</b></div></div>${entries(x)}</div>`;
  const totIn = D.inTot.reduce((s, x) => s + x[1], 0), totOut = D.outTot.reduce((s, x) => s - x[1], 0);
  const tl = ([l, v], cls) => `<div class="dash-line"><span>${esc(l)}</span><b class="${cls}">${v > 0 ? '+' : '−'} ${rs(Math.abs(v))}</b></div>`;
  const opts = `<option value="*"${Stmt.acct === '*' ? ' selected' : ''}>All accounts</option>` + accts(true).map(a => `<option value="${a.id}"${a.id === Stmt.acct ? ' selected' : ''}>${esc(a.name)}${a.archived ? ' (archived)' : ''}</option>`).join('')
    + `<option value="udh"${isU ? ' selected' : ''}>Udhaar (net)</option>`;
  const people = isU ? udhGroups().sort((a, b) => a.name.localeCompare(b.name)) : [];
  if (isU) { const pk = new Set(people.map(g => g.k)); recurs().filter(r => r.kind === 'udhgive' && r.who).forEach(r => { const k = udhKey(r.who); if (!pk.has(k)) { pk.add(k); people.push({ k, name: r.who.trim() }); } }); }
  body.innerHTML = `<div class="stm-ctl"><div class="field"><label>Account</label><select id="stmAcct">${opts}</select></div>
      ${isU ? `<div class="field"><label>Person</label><select id="stmPerson"><option value="">All people</option>${people.map(g => `<option value="${esc(g.k)}"${g.k === Stmt.person ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>` : ''}
      <div class="grid2"><div class="field"><label>From</label><input type="month" id="stmFrom" value="${Stmt.from}" min="${c.startMonth}"></div><div class="field"><label>To</label><input type="month" id="stmTo" value="${Stmt.to}" min="${c.startMonth}" max="${cap}"></div></div></div>
    <div class="dash-card stm-sum"><div class="k">Summary · ${esc(monthShort(Stmt.from))} to ${esc(monthLong(Stmt.to))}</div>
      <div class="dash-line"><span>${W.open} at start of ${esc(monthShort(Stmt.from))}</span><b>${rs(D.open)}</b></div>
      <div class="dash-sep"></div><div class="stm-sh">${W.inn} · ${rs(totIn)}</div>${D.inTot.map(x => tl(x, 'pos')).join('') || '<div class="hint" style="margin:2px 0">Nothing.</div>'}
      <div class="dash-sep"></div><div class="stm-sh">${W.out} · ${rs(totOut)}</div>${D.outTot.map(x => tl(x, 'neg')).join('') || '<div class="hint" style="margin:2px 0">Nothing.</div>'}
      <div class="dash-sep"></div><div class="dash-line"><span><b>${isU ? W.open : 'Closing'} at end of ${esc(monthLong(Stmt.to))}</b></span><b class="${D.close < 0 ? 'neg' : ''}">${rs(D.close)}</b></div></div>
    <p class="hint">Past months: from your Ledger. This month: Ledger so far plus planned items not yet ticked. Later months: your plan (recurring items, SIPs, EMIs, one-offs). “Estimate” lines are budgets and expected investment growth.${Stmt.acct === '*' ? ' All accounts leaves out loans and udhaar, so its closing can differ from “Money you have”.' : ''}${W.note}</p>
    <div class="btn-row" style="margin:0 0 10px"><button class="btn ghost small" id="stmXlsx">⤓ Export Excel (all accounts, this period)</button></div>
    ${D.months.map(month).join('')}`;
  if ($('stmPerson')) $('stmPerson').addEventListener('change', e => { Stmt.person = e.target.value; renderStatement(); });
  $('stmXlsx').addEventListener('click', exportStatementsXlsx);
  $('stmAcct').addEventListener('change', e => { Stmt.acct = e.target.value; Stmt.focus = null; if (Stmt.acct !== 'udh') Stmt.person = ''; renderStatement(); });
  $('stmFrom').addEventListener('change', e => { if (ymOk(e.target.value)) { Stmt.from = e.target.value; renderStatement(); } });
  $('stmTo').addEventListener('change', e => { if (ymOk(e.target.value)) { Stmt.to = e.target.value; renderStatement(); } });
  $$('[data-stmacct]', body).forEach(b => b.addEventListener('click', () => { Stmt.acct = b.dataset.stmacct; const ym = b.closest('.stm-m').id.slice(4); renderStatement(); setTimeout(() => { const el = $('stm-' + ym); if (el) el.scrollIntoView({ block: 'start' }); }, 50); }));
  $$('[data-stmfe]', body).forEach(b => b.addEventListener('click', () => openFin(b.dataset.stmfe)));
}
const kindWord = e => (KINDS.find(k => k.v === e.kind) || {}).l || 'Entry';
/* v2.26: every account's month-by-month statement for the chosen period, one sheet each */
async function exportStatementsXlsx() {
  const c = planCfg(); if (!c) return;
  try { await loadScript(XLSX_URL); } catch (e) { toast('Excel export needs internet the first time.'); return; }
  const X = window.XLSX, wb = X.utils.book_new(), from = Stmt.from, to = Stmt.to, used = new Set();
  const sheetName = n => { let b = String(n).replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet', x = b, i = 2; while (used.has(x.toLowerCase())) x = b.slice(0, 25) + ' ' + i++; used.add(x.toLowerCase()); return x; };
  const add = (name, rows, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, sheetName(name)); };
  const txt = l => l.map(g => `${g.label} ${Math.round(Math.abs(g.amt))}`).join('; ');
  const sumOf = l => Math.round(l.reduce((t, g) => t + g.amt, 0));
  const sheet = (D, inL, outL) => [['Month', 'Basis', 'Opening', inL, 'Total in', outL, 'Total out', 'Closing']].concat(D.months.map(x => [monthShort(x.ym), x.when, Math.round(x.open), txt(x.inn), sumOf(x.inn), txt(x.out), -sumOf(x.out), Math.round(x.close)]));
  const list = [...accts(true).filter(a => !a.archived).map(a => [a.id, a.name]), ['*', 'All accounts']], sum = [['Statement', 'Opening ' + monthShort(from), 'Total in', 'Total out', 'Closing ' + monthShort(to)]], tabs = [];
  list.forEach(([id, name]) => { const D = stmtData(c, id, from, to), ti = D.inTot.reduce((t, x) => t + x[1], 0), tout = D.outTot.reduce((t, x) => t - x[1], 0);
    sum.push([name, Math.round(D.open), Math.round(ti), Math.round(tout), Math.round(D.close)]); tabs.push([name, sheet(D, 'Received from', 'Paid to')]); });
  const U = stmtDataUdh(c, from, to, '');
  sum.push(['Udhaar (net, owed to you)', Math.round(U.open), Math.round(U.inTot.reduce((t, x) => t + x[1], 0)), Math.round(-U.outTot.reduce((t, x) => t + x[1], 0)), Math.round(U.close)]);
  sum.push([], ['Period ' + monthShort(from) + ' to ' + monthShort(to) + '. Past months: Ledger. This month: Ledger so far + planned items not yet ticked. Later months: the plan (estimates marked “estimate”).']);
  add('Summary', sum, [30, 16, 14, 14, 16]);
  tabs.forEach(([n, rows]) => add(n, rows, [10, 11, 13, 60, 12, 60, 12, 13]));
  add('Udhaar', sheet(U, 'Owed to you goes up', 'Owed to you goes down'), [10, 11, 13, 60, 12, 60, 12, 13]);
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  shareOrDownload(out, `register-statements-${from}-to-${to}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
$('pshBody').addEventListener('click', e => { const b = e.target.closest('[data-openstmt]'); if (b) openStatement(b.dataset.openstmt); });
const amtIn = (id, v, ph) => `<input id="${id}" inputmode="decimal" autocomplete="off" value="${isBlank(v) ? '' : esc(String(v))}" placeholder="${ph || '₹'}">`;
function readAmt(id, label, required, allowNeg) {
  const raw = $(id).value;
  if (isBlank(raw)) { if (!required) return null; throw new Error(`${label}: enter an amount.`); }
  const n = num(raw); if (!isFinite(n) || (!allowNeg && n < 0)) throw new Error(`${label}: "${raw}" is not a valid amount.`);
  return Math.round(n * 100) / 100;
}
const monthIn = (id, v) => `<input type="month" id="${id}" value="${esc(v || '')}">`;
const ymOk = v => /^\d{4}-\d{2}$/.test(v || '');

/* ---------- opening balances: all accounts on one screen ---------- */
function openingSheet() {
  const c = planCfg(); if (!c) return;
  const html = `<div class="field"><label>Plan starts</label>${monthIn('obStart', c.startMonth)}</div>
    <h4 class="plan-sub" id="obAsOn">Balances as on ${fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true)}</h4>
    <div class="group pl-group" id="obList">${accts(true).map(a => obRow(a)).join('')}</div>
    <button class="linkbtn" id="obAdd">＋ Add another account</button>
    <p class="hint">Cards and loans: enter what you <b>owe</b> (a positive number). Mutual funds: current value from your statement. Leave blank for zero. Udhaar comes from the Udhaar tab by itself.</p>`;
  planSheet('Opening balances', html, () => {
    try {
      const start = $('obStart').value; if (!ymOk(start)) throw new Error('Pick the month the plan starts.');
      const rows = $$('[data-ob]', $('obList'));
      const edits = rows.map(r => {
        const id = r.dataset.ob, name = r.querySelector('.r-lbl').value.trim(), kind = r.querySelector('.r-kind').value;
        const open = readAmt('obA_' + id, name || 'Account') || 0;
        return { id, name, kind, open };
      }).filter(x => x.name || x.open);
      if (edits.some(x => !x.name)) throw new Error('Every account needs a name.');
      edits.forEach((x, i) => { const a = acctById(x.id) || { id: x.id, type: 'acct', deleted: false, order: 100 + i }; Object.assign(a, { name: x.name, kind: x.kind, open: x.open }); put(a, { render: false }); });
      if (c.startMonth && start < c.startMonth && archIndex().length && !confirm(ARCH_START_WARN)) return false;
      c.startMonth = start; if (!acctById(c.defAcct)) c.defAcct = defAcct(c); put(c, { render: false });
      toast('Opening balances saved.'); return true;
    } catch (e) { planMsg(e.message, true); return false; }
  });
  $('obStart').addEventListener('change', () => { const v = $('obStart').value; if (ymOk(v)) $('obAsOn').textContent = 'Balances as on ' + fmtDate(monthEnd(monthAdd(v, -1)), true); });
  $('obAdd').addEventListener('click', () => { $('obList').insertAdjacentHTML('beforeend', obRow({ id: uid('ac'), name: '', kind: 'bank', open: '' })); $('obList').lastElementChild.querySelector('.r-lbl').focus(); });
}
function obRow(a) {
  return `<div class="pl-row ob-row" data-ob="${a.id}"><input class="r-lbl" value="${esc(a.name)}" placeholder="e.g. SBI savings" aria-label="Account name">
    <select class="r-kind" aria-label="Type">${ACCT_KINDS.map(([k, l]) => `<option value="${k}"${k === a.kind ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${amtIn('obA_' + a.id, a.open === 0 ? '' : a.open)}</div>`;
}

/* ---------- one account ---------- */
function acctSheet(id) {
  const c = planCfg(); const a = id ? acctById(id) : { name: '', kind: 'bank', open: '' };
  const isDef = id && defAcct(c) === id;
  const used = id && (all('fin').some(e => e.acct === id || e.to === id || (e.pays || []).some(p => p.acct === id) || (isDef && !e.acct && e.kind !== 'transfer'))
    || recurs().some(r => r.from === id || r.to === id)
    || accts(true).some(x => (x.sip && x.sip.from === id) || x.payFrom === id)
    || all('planmonth').some(m => (m.extra || []).some(x => x.from === id || x.to === id))
    || (isDef && accts().length > 1));                 // the default account also receives entries saved without one
  const kindSel = `<select id="asKind">${ACCT_KINDS.map(([k, l]) => `<option value="${k}"${k === a.kind ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const html = `${id ? `<button class="btn ghost block" data-openstmt="${id}" style="margin-bottom:12px">📒 Statement — month by month</button>` : ''}<div class="field"><label>Name</label><input id="asName" value="${esc(a.name)}" placeholder="e.g. HDFC savings"></div>
    <div class="grid2"><div class="field"><label>Type</label>${kindSel}</div><div class="field"><label id="asOpenLbl">Opening balance ₹</label>${amtIn('asOpen', a.open === 0 ? '' : a.open)}</div></div>
    <p class="hint" style="margin:-8px 4px 12px">As on ${fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true)}.</p>
    <div id="asMore"></div>
    <div class="group" style="margin-top:12px"><label class="switch-row"><span>Archive this account<small>Hidden from lists and pickers; its history stays.</small></span><input type="checkbox" class="sw" id="asArch"${a.archived ? ' checked' : ''}></label></div>
    ${id ? (used ? `<p class="hint">${isDef ? 'This is your default account: entries saved without an account are counted here. It can be archived but not deleted.' : 'This account has entries, so it can be archived but not deleted.'}</p>` : '<button class="btn danger block" id="asDel">Delete account</button>') : ''}`;
  planSheet(id ? 'Account' : 'New account', html, () => {
    try {
      const name = $('asName').value.trim(); if (!name) throw new Error('Give the account a name.');
      const kind = $('asKind').value, rec = id ? acctById(id) : { id: uid('ac'), type: 'acct', deleted: false, order: 100 };
      Object.assign(rec, { name, kind, open: readAmt('asOpen', 'Opening balance', false, !isLiab(kind)) || 0, archived: $('asArch').checked });
      if (isInvest(kind)) {
        const ret = readAmt('asRet', 'Expected return') || 0; if (ret > 40) throw new Error('Expected return above 40% a year looks like a typo.');
        const sipAmt = readAmt('asSip', 'SIP amount') || 0, sipStart = $('asSipStart').value, sipEnd = $('asSipEnd').value || null;
        if (sipAmt && !ymOk(sipStart)) throw new Error('Pick the month the SIP starts.');
        if (sipEnd && sipEnd < sipStart) throw new Error('SIP stop month is before the start.');
        const sAuto = !!($('asSipAuto') && $('asSipAuto').checked), sDayRaw = $('asSipDay') ? $('asSipDay').value.trim() : '', sDay = clampDay(sDayRaw);
        if (sAuto && !sDay) throw new Error('SIP day: the day of the month it is debited, 1 to 31.');
        const was = rec.sip || {};
        rec.ret = ret; rec.sip = sipAmt ? { amt: sipAmt, from: $('asSipFrom').value, start: sipStart, end: sipEnd, auto: sAuto || undefined, day: sDay || undefined, autoFrom: sAuto ? (was.auto && was.autoFrom ? was.autoFrom : isoMonth(new Date())) : undefined } : null;
        rec.values = readMonthRows('asVals');
        if ($('asInvCount')) rec.invCount = $('asInvCount').checked;   // v2.26
      }
      if (kind === 'loan') {
        const emi = readAmt('asEmi', 'EMI') || 0, start = $('asStart').value, end = $('asEnd').value;
        if (emi && (!ymOk(start) || !ymOk(end))) throw new Error('Pick the first and last EMI months.');
        if (emi && end < start) throw new Error('Last EMI is before the first.');
        Object.assign(rec, { emi, amount: readAmt('asAmt', 'Loan amount') || 0, rate: readAmt('asRate', 'Interest rate') || 0, start: start || null, end: end || null, payFrom: $('asPay').value });
        const eAuto = !!($('asEmiAuto') && $('asEmiAuto').checked), eDay = clampDay($('asEmiDay') ? $('asEmiDay').value.trim() : '');
        if (eAuto && !eDay) throw new Error('EMI day: the day of the month it is debited, 1 to 31.');
        if (eAuto) { rec.emiAutoFrom = rec.emiAuto && rec.emiAutoFrom ? rec.emiAutoFrom : isoMonth(new Date()); rec.emiAuto = true; rec.emiDay = eDay; } else { delete rec.emiAuto; delete rec.emiAutoFrom; if (eDay) rec.emiDay = eDay; else delete rec.emiDay; }
      }
      if (kind === 'card') {                                   // v2.19: statement and due days become monthly dates
        const sRaw = $('asStmt').value.trim(), dRaw = $('asDue').value.trim(), sd = clampDay(sRaw), dd = clampDay(dRaw);
        if (sRaw && !sd) throw new Error('Statement day: a day of the month, 1 to 31.');
        if (dRaw && !dd) throw new Error('Payment due day: a day of the month, 1 to 31.');
        rec.stmtDay = sd || null; rec.dueDay = dd || null; rec.remind = $('asRemind').checked;
        if ($('asBillMode')) { const bm = $('asBillMode').querySelector('.on').dataset.bm, bamt = bm === 'fixed' ? readAmt('asBillAmt', 'Bill amount each month', true) : null;   // v2.26
          if (bm === 'fixed' && !(bamt > 0)) throw new Error('Enter the amount you will pay on the card each month.');
          rec.billPlan = { mode: bm, from: bm === 'off' ? null : $('asBillFrom').value || null, amt: bamt || null }; }
      } else { delete rec.stmtDay; delete rec.dueDay; delete rec.billPlan; }
      if (kind === 'fd') { const m = $('asMat').value; rec.matures = ISO_DATE_RX.test(m) ? m : null; rec.remind = $('asRemind').checked; } else delete rec.matures;
      if ((kind === 'bank' || kind === 'salary') && $('asIRate')) {           // v2.37: savings interest
        const r = readAmt('asIRate', 'Interest rate') || 0, amt = readAmt('asIAmt', 'Interest each time') || 0, every = +($('asIEvery').querySelector('.on') || {}).dataset.ie || 1;
        if (r > 15) throw new Error('Interest above 15% a year on a bank account looks like a typo.');
        if (r || amt) rec.int = { rate: r || 0, amt: amt || 0, every: every === 3 ? 3 : 1, from: rec.int && rec.int.from ? rec.int.from : isoMonth(new Date()) }; else delete rec.int;
      } else delete rec.int;
      if (kind !== 'card' && kind !== 'fd') delete rec.remind;
      put(rec, { render: false }); syncAcctDates(rec, true);
      toast((kind === 'card' && rec.remind && (rec.stmtDay || rec.dueDay)) || (kind === 'fd' && rec.remind && rec.matures) ? 'Account saved — the dates are in Dates too.' : 'Account saved.'); return true;
    } catch (e) { planMsg(e.message, true); return false; }
  });
  const more = () => {
    const k = $('asKind').value;
    $('asOpenLbl').textContent = isLiab(k) ? 'Amount owed then ₹' : isInvest(k) ? 'Value then ₹' : 'Opening balance ₹';
    let h = '';
    if (isInvest(k)) {
      const s = a.sip || {};
      h = (k === 'fd' ? `<h4 class="plan-sub">Maturity</h4><div class="field"><label>Matures on (FD, PPF, NPS…)</label><input type="date" id="asMat" value="${esc(a.matures || '')}"></div>
        <div class="group"><label class="switch-row"><span>Remind me in Dates<small>Adds the maturity date to Dates (Bank &amp; investments).</small></span><input type="checkbox" class="sw" id="asRemind"${a.remind === false ? '' : ' checked'}></label></div>` : '') + `<h4 class="plan-sub">SIP</h4><div class="grid2"><div class="field"><label>Monthly SIP ₹</label>${amtIn('asSip', s.amt)}</div><div class="field"><label>Debited from</label><select id="asSipFrom">${acctOptions(s.from || defAcct(c), x => isLiquid(x.kind) || x.kind === 'card')}</select></div></div>
        <div class="grid2"><div class="field"><label>SIP from</label>${monthIn('asSipStart', s.start || c.startMonth)}</div><div class="field"><label>SIP stops (optional)</label>${monthIn('asSipEnd', s.end)}</div></div>
        <div class="grid2"><label class="switch-row" style="background:var(--card);border-radius:10px"><span>Auto-record<small>Written into the Ledger on its day</small></span><input type="checkbox" class="sw" id="asSipAuto"${s.auto ? ' checked' : ''}></label><div class="field"><label>SIP day</label><input id="asSipDay" inputmode="numeric" placeholder="1–31" value="${esc(String(s.day || ''))}"></div></div>
        <div class="group"><label class="switch-row"><span>Count money put in here as investment<small>Ledger “Into investments”: transfers into this account count; money taken out is subtracted. Turn off for an FD that only parks money.</small></span><input type="checkbox" class="sw" id="asInvCount"${invCounts({ kind: k, invCount: a.invCount }) ? ' checked' : ''}></label></div>
        <div class="field"><label>Expected return % a year (optional)</label>${amtIn('asRet', a.ret || '', '0 = no growth shown')}</div>
        <p class="hint" style="margin:-6px 4px 10px">An assumption, shown as an estimate. Market returns vary.</p>
        <h4 class="plan-sub">Value from your statement <small>replaces the estimate from that month</small></h4>
        <div class="group pl-group"><div class="pl-list" id="asVals">${(a.values || []).map(v => monthRow(v)).join('')}</div><button class="linkbtn" id="asValAdd">＋ Add value</button></div>`;
    } else if (k === 'loan') {
      h = `<h4 class="plan-sub">Loan</h4><div class="grid2"><div class="field"><label>EMI ₹</label>${amtIn('asEmi', a.emi)}</div><div class="field"><label>EMI paid from</label><select id="asPay">${acctOptions(a.payFrom || defAcct(c), x => isLiquid(x.kind))}</select></div></div>
        <div class="grid2"><div class="field"><label>First EMI</label>${monthIn('asStart', a.start)}</div><div class="field"><label>Last EMI</label>${monthIn('asEnd', a.end)}</div></div>
        <div class="grid2"><label class="switch-row" style="background:var(--card);border-radius:10px"><span>Auto-record<small>EMI goes out of the bank on its day</small></span><input type="checkbox" class="sw" id="asEmiAuto"${a.emiAuto ? ' checked' : ''}></label><div class="field"><label>EMI day</label><input id="asEmiDay" inputmode="numeric" placeholder="1–31" value="${esc(String(a.emiDay || ''))}"></div></div>
        <div class="grid2"><div class="field"><label>Loan amount ₹ (optional)</label>${amtIn('asAmt', a.amount || '')}</div><div class="field"><label>Interest % (optional)</label>${amtIn('asRate', a.rate || '', 'worked out if blank')}</div></div>
        <div class="group pl-group" id="asLoanInfo"></div>
        <p class="hint">With EMI and dates filled, the amount owed follows the loan schedule; the opening figure above is only used if they are blank.</p>`;
    } else if (k === 'bank' || k === 'salary') { const I = a.int || {};   // v2.37
      h = `<h4 class="plan-sub">Interest <small>an estimate in the plan, until it is in the Ledger</small></h4>
        <div class="grid2"><div class="field"><label>Interest % a year</label>${amtIn('asIRate', I.rate || '', 'e.g. 2.7')}</div><div class="field"><label>or ₹ each time (fixed)</label>${amtIn('asIAmt', I.amt || '', 'optional')}</div></div>
        <div class="seg" id="asIEvery" style="margin:0 0 8px">${[[1, 'Credited every month'], [3, 'Every 3 months (Mar, Jun, Sep, Dec)']].map(([v, l]) => `<button type="button" data-ie="${v}" class="${(I.every || 1) === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <p class="hint">From this month on the plan adds the interest as income into this account: the fixed ₹ if you give one, otherwise the balance at the start of the month × rate. It shows in the monthly check-up as “Interest · ${esc(a.name || 'this account')}” — tick it with the real amount from your passbook. Interest you enter in the Ledger yourself (category Interest) counts too.</p>`;
    } else if (k === 'card') h = `<p class="hint">Spending on the card adds to what you owe. Paying the bill is a Transfer from your bank to this card (add it under Recurring or in the Ledger).</p>
      <h4 class="plan-sub">Statement and due date</h4>
      <div class="grid2"><div class="field"><label>Statement day</label><input id="asStmt" inputmode="numeric" placeholder="1–31" value="${esc(String(a.stmtDay || ''))}"></div><div class="field"><label>Payment due day</label><input id="asDue" inputmode="numeric" placeholder="1–31" value="${esc(String(a.dueDay || ''))}"></div></div>
      <div class="group"><label class="switch-row"><span>Remind me in Dates<small>“Statement” and “payment due” every month, in Bank &amp; investments. Only the card's name goes into Dates — no amounts.</small></span><input type="checkbox" class="sw" id="asRemind"${a.remind === false ? '' : ' checked'}></label></div>
      ${(() => { const bp = a.billPlan || {}, m = bp.mode || 'full', rec = id && recurs().some(r => r.kind === 'transfer' && r.to === id);
        return `<h4 class="plan-sub">In the plan, the bill is paid</h4>
      <div class="seg" id="asBillMode" style="margin:0 0 10px">${[['full', 'Whole bill'], ['fixed', 'Fixed amount'], ['off', 'Not paid']].map(([v, l]) => `<button type="button" data-bm="${v}" class="${m === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grid2"><div class="field" id="asBillFromW"><label>Paid from</label><select id="asBillFrom">${acctOptions(bp.from || defAcct(c), x => isLiquid(x.kind))}</select></div><div class="field" id="asBillAmtW"><label>Each month ₹</label>${amtIn('asBillAmt', bp.amt || '')}</div></div>
      <p class="hint">An estimate for this month onwards: each month the plan pays what the card owed at the start of the month (or the fixed amount), less anything you already paid into it that month. Past months are never changed.${rec ? ' <b>Not used now:</b> a recurring transfer into this card is set, and that is used instead.' : ' Adding a recurring “Credit-card bill” transfer replaces it.'}</p>`; })()}`;
    $('asMore').innerHTML = h;
    if ($('asValAdd')) $('asValAdd').addEventListener('click', () => { $('asVals').insertAdjacentHTML('beforeend', monthRow({})); wireMonthRows('asVals'); });
    if ($('asBillMode')) { const bs = () => { const v = $('asBillMode').querySelector('.on').dataset.bm; $('asBillFromW').classList.toggle('hidden', v === 'off'); $('asBillAmtW').classList.toggle('hidden', v !== 'fixed'); };
      $$('#asBillMode button').forEach(b => b.addEventListener('click', () => { $$('#asBillMode button').forEach(x => x.classList.toggle('on', x === b)); bs(); })); bs(); }   // v2.26
    if (isInvest(k)) wireMonthRows('asVals');
    if ($('asIEvery')) $$('#asIEvery button').forEach(b => b.addEventListener('click', () => $$('#asIEvery button').forEach(x => x.classList.toggle('on', x === b))));   // v2.37
    if (k === 'loan') {
      const info = () => {
        const d = { emi: num($('asEmi').value), amount: num($('asAmt').value), rate: num($('asRate').value), start: $('asStart').value, end: $('asEnd').value };
        if (!(d.emi > 0) || !ymOk(d.start) || !ymOk(d.end) || d.end < d.start) { $('asLoanInfo').innerHTML = '<p class="hint" style="margin:8px 0">Enter EMI and the first and last EMI months to see the figures.</p>'; return; }
        const i = loanInfo(d), yrs = Math.floor(i.n / 12), mo = i.n % 12;
        const line = (x, y) => `<div class="pl-row"><span class="r-name">${x}</span><b class="mono">${y}</b></div>`;
        $('asLoanInfo').innerHTML = line('Tenure', `${i.n} EMIs (${[yrs ? yrs + ' yr' : '', mo ? mo + ' mo' : ''].filter(Boolean).join(' ')})`)
          + line('Paid till now', `${i.paid} EMIs · ${rs(i.paidAmt)}`) + line('Left', `${i.left} EMIs · ${rs(i.leftAmt)}`) + line('Total you will pay', rs(i.total))
          + (i.rate != null ? line('Interest in total', rs(i.interest)) + line(+d.rate ? 'Interest rate' : 'Implied interest rate', i.rate.toFixed(2) + '% a year') + line('Principal still owed', rs(i.outstanding)) : line('Still to pay (incl. interest)', rs(i.leftAmt)));
      };
      ['asEmi', 'asAmt', 'asRate', 'asStart', 'asEnd'].forEach(x => $(x).addEventListener('input', info)); info();
    }
  };
  $('asKind').addEventListener('change', more); more();
  if ($('asDel')) $('asDel').addEventListener('click', () => { Sheets.close('shPlan', true); deleteWithUndo(id, a.name); });
}
function monthRow(v) { return `<div class="pl-row" data-mrow><input type="month" class="r-lbl" value="${esc(v.month || '')}" aria-label="Month"><input class="r-amt" inputmode="decimal" value="${isBlank(v.a) ? '' : esc(String(v.a))}" placeholder="₹" aria-label="Amount"><button class="icon-btn r-rm" aria-label="Remove" style="width:32px;height:32px;font-size:13px">✕</button></div>`; }
function wireMonthRows(id) { $$('.r-rm', $(id)).forEach(b => { b.onclick = () => b.closest('.pl-row').remove(); }); }
function readMonthRows(id) {
  const box = $(id); if (!box) return [];
  return $$('[data-mrow]', box).map(r => ({ month: r.querySelector('.r-lbl').value, raw: r.querySelector('.r-amt').value })).filter(x => x.month || !isBlank(x.raw)).map(x => {
    const a = num(x.raw); if (!ymOk(x.month)) throw new Error('Every value needs a month.'); if (!isFinite(a) || a < 0) throw new Error(`"${x.raw}" is not a valid amount.`); return { month: x.month, a };
  });
}

/* ---------- one recurring item ---------- */
function recurSheet(id, preset) {
  Plan.dupOk = false;
  const c = planCfg(), cur = isoMonth(new Date());
  const r = id ? records[id] : Object.assign({ name: '', kind: 'expense', amt: '', from: defAcct(c), to: defAcct(c), start: cur < c.startMonth ? c.startMonth : cur, end: '', every: 1, budget: false }, preset || {});
  const presets = [['Salary', { name: 'Salary', kind: 'income' }], ['Household spending', { name: 'Household spending', kind: 'expense', budget: true }], ['Rent', { name: 'Rent', kind: 'expense' }],
    ['Monthly transfer', { name: 'Transfer', kind: 'transfer' }], ['Credit-card bill', { name: 'Credit-card bill', kind: 'transfer', to: (accts().find(a => a.kind === 'card') || {}).id }], ['Yearly premium', { name: 'Insurance premium', kind: 'expense', every: 12, remind: true }]];
  const html = `${id ? '' : `<div class="wrapchips" style="margin-bottom:12px">${presets.map(([l], i) => `<button class="chip" data-pre="${i}">${l}</button>`).join('')}</div>`}
    <div class="grid2"><div class="field"><label>Category (your own name)</label><input id="rcGroup" list="rcGroupDl" value="${esc(r.group || '')}" placeholder="e.g. Salary, House" autocomplete="off"><datalist id="rcGroupDl">${recurGroups().map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
      <div class="field"><label>Name</label><input id="rcName" value="${esc(r.name)}" placeholder="e.g. Rahul's salary"></div></div>
    <div class="field"><label>Type</label><div class="seg" id="rcKind" style="margin:0">${[['income', 'Income'], ['expense', 'Expense'], ['transfer', 'Transfer'], ['udhback', 'Udhaar back'], ['udhgive', 'Udhaar give']].map(([k, l]) => `<button data-k="${k}" class="${r.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field" id="rcWhoW"><label>Who is paying back</label><select id="rcWho">${(() => { const ps = udhPersons(); if (r.who && !ps.some(x => x[0] === r.who)) ps.unshift([r.who, 0]); return ps.length ? ps.map(([n, a]) => `<option value="${esc(n)}"${n === r.who ? ' selected' : ''}>${esc(n)} · owes ${rs(a)}</option>`).join('') : '<option value="">Nobody owes you in Udhaar</option>'; })()}</select>
      <p class="hint" style="margin:4px 0 0">Each instalment you tick in the check-up is recorded as money paid back in Udhaar: the account goes up and what they owe goes down. It is not counted as income. In the plan, instalments continue as long as they owe — including udhaar you plan to give them (Udhaar give).</p></div>
    <div class="field" id="rcGiveW"><label>Udhaar to (person)</label><input id="rcGiveWho" list="peopleDl" value="${esc(r.kind === 'udhgive' ? r.who || '' : '')}" placeholder="e.g. X" autocomplete="off">
      <p class="hint" style="margin:4px 0 0"><b>An estimate for the plan only.</b> In the months set here the plan takes the amount out of the account and adds it to what this person owes, so their Udhaar back instalments can carry on. Nothing is written to the Ledger: when you really give the money, add it in Udhaar as usual — in the current month that replaces the estimate.</p></div>
    <div class="grid2"><div class="field"><label>Amount ₹</label>${amtIn('rcAmt', r.amt)}</div><div class="field"><label>How often</label><select id="rcEvery">${(() => { const once = !!(id && r.start && r.end === r.start); return [[1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Every year']].map(([v, l]) => `<option value="${v}"${!once && +r.every === v ? ' selected' : ''}>${l}</option>`).join('') + `<option value="once"${once ? ' selected' : ''}>Once (one month only)</option>`; })()}</select></div></div>
    <div class="grid2"><div class="field" id="rcFromW"><label>From account</label><select id="rcFrom">${acctOptions(r.from)}</select></div><div class="field" id="rcToW"><label>Into account</label><select id="rcTo">${acctOptions(r.to)}</select></div></div>
    <div class="grid2"><div class="field"><label id="rcStartLbl">First month</label>${monthIn('rcStart', r.start)}</div><div class="field" id="rcEndW"><label>Last month (optional)</label>${monthIn('rcEnd', r.end)}</div></div>
    <div class="group" id="rcBudgetW"><label class="switch-row"><span>Estimate only<small>For day-to-day spending: the Ledger replaces it as you spend. Can't be ticked.</small></span><input type="checkbox" class="sw" id="rcBudget"${r.budget ? ' checked' : ''}></label></div>
    <div class="group" id="rcAutoW"><label class="switch-row"><span>Auto-record each month<small>Written into the Ledger by itself on the chosen day, as if you ticked it. Untick it in that month's check-up if it did not happen.</small></span><input type="checkbox" class="sw" id="rcAuto"${r.auto ? ' checked' : ''}></label>
      <div class="set-row" id="rcDayW">On day<input id="rcDay" inputmode="numeric" value="${esc(String(r.day || 1))}" style="width:70px;text-align:right" aria-label="Day of month"></div></div>
    <div class="group" id="rcRemW"><label class="switch-row"><span>Remind me in Dates<small>For premiums, renewals and fees: the next due date goes into Dates (no amount).</small></span><input type="checkbox" class="sw" id="rcRemind"${r.remind ? ' checked' : ''}></label>
      <div class="set-row" id="rcRemDW"><span>Next due date</span><input type="date" id="rcRemDate" value="${esc(r.remindDate || '')}" style="width:auto;margin-left:auto" aria-label="Next due date"></div></div>
    ${(() => { const n = id ? monthOverrides(c, 'r:' + id).length : 0; return n ? `<p class="hint" style="margin:0 4px 10px"><b>${n} month${n > 1 ? 's have' : ' has'} an amount set for that month only</b> — those months ignore the amounts here. <button class="linkbtn" id="rcOvr" style="display:inline;padding:0">Review ›</button></p>` : ''; })()}
    <h4 class="plan-sub">Amount changes from a month onwards</h4>
    <div id="rcSteps">${(r.steps || []).map(monthRow).join('')}</div>
    <button class="btn ghost small" id="rcStepAdd">＋ Add a change (e.g. raise)</button>
    <p class="hint">The amount above is used from the first month. Each change applies from its month until the next change. Example: ₹50,000 from Oct 2026, then ₹55,000 from Apr 2027. To change just one month, open that month instead.</p>
    ${id ? '<button class="btn danger block" id="rcDel" style="margin-top:12px">Delete recurring item</button>' : ''}`;
  planSheet(id ? 'Recurring item' : 'New recurring item', html, () => {
    try {
      const kind = $('rcKind').querySelector('.on').dataset.k, once = $('rcEvery').value === 'once', start = $('rcStart').value, end = once ? start : $('rcEnd').value || null;
      let name = $('rcName').value.trim();
      if (!name && kind === 'udhgive' && $('rcGiveWho').value.trim()) name = 'Udhaar to ' + $('rcGiveWho').value.trim().replace(/\s+/g, ' ');   // v2.26.1
      if (!name) throw new Error('Give it a name.');
      if (!ymOk(start)) throw new Error('Pick the first month.'); if (end && end < start) throw new Error('Last month is before the first.');
      const from = $('rcFrom').value, to = $('rcTo').value;
      if (kind === 'transfer' && from === to) throw new Error('From and Into must be different accounts.');
      const rec = id ? records[id] : { id: uid('rc'), type: 'recur', deleted: false };
      const steps = readMonthRows('rcSteps').sort((x, y) => x.month < y.month ? -1 : 1);
      steps.forEach((x, i) => { if (x.month <= start) throw new Error('A change must be after the first month (' + monthShort(start) + ').'); if (end && x.month > end) throw new Error('A change is after the last month.'); if (i && steps[i - 1].month === x.month) throw new Error('Two changes in ' + monthShort(x.month) + '.'); });
      const who = kind === 'udhback' ? $('rcWho').value : kind === 'udhgive' ? $('rcGiveWho').value.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
      if (kind === 'udhback' && !who) throw new Error('Pick who is paying back. Add the udhaar in the Udhaar tab first.');
      if (kind === 'udhgive' && !who) throw new Error('Who will you give the udhaar to?');
      const day = Math.min(28, Math.max(1, parseInt($('rcDay').value, 10) || 1));
      const auto = $('rcAuto').checked && kind !== 'udhgive' && !(kind === 'expense' && $('rcBudget').checked);
      const autoFrom = auto ? (rec_autoFrom(id) || isoMonth(new Date())) : null;
      const remind = $('rcRemind').checked, remindDate = $('rcRemDate').value;
      if (remind && !ISO_DATE_RX.test(remindDate)) throw new Error('Pick the next due date for the reminder.');
      const draft = { remind, remindDate: remind ? remindDate : null, auto, autoFrom, day, who, steps, name, kind, amt: readAmt('rcAmt', 'Amount', true), every: once ? 1 : +$('rcEvery').value, start, end, from: kind === 'income' || kind === 'udhback' ? null : from, to: kind === 'expense' || kind === 'udhgive' ? null : to, budget: kind === 'expense' && $('rcBudget').checked };
      const dup = dupEmiOf(draft);
      if (dup && !Plan.dupOk) { Plan.dupOk = true; throw new Error(`This looks like the EMI already set inside the "${dup.name}" account (${rs(dup.emi)} from ${acctName(dup.payFrom)}). Saving it would count the EMI twice. Tap Save again only if this is a different payment.`); }
      Plan.dupOk = false;
      Object.assign(rec, draft);
      { const g = $('rcGroup').value.trim().slice(0, 40); const hit = recurGroups().find(x => x.toLowerCase() === g.toLowerCase()); if (g) rec.group = hit || g; else delete rec.group; }
      put(rec, { render: false }); sysDate('rd-' + rec.id, recurDateWant(rec), true); toast(rec.remind ? 'Saved — the next due date is in Dates.' : 'Saved.');
      if (rec.auto) setTimeout(() => { const n = autoRecord(); if (n) { toast(`${n} month${n > 1 ? 's' : ''} recorded automatically.`); scheduleRender(); } }, 50);
      return true;
    } catch (e) { planMsg(e.message, true); return false; }
  });
  const sync = () => { const k = $('rcKind').querySelector('.on').dataset.k, once = $('rcEvery').value === 'once'; $('rcEndW').classList.toggle('hidden', once); $('rcStartLbl').textContent = once ? 'Month' : 'First month'; $('rcName').placeholder = k === 'udhgive' ? 'Optional — e.g. Udhaar to X' : "e.g. Rahul's salary"; $('rcDayW').classList.toggle('hidden', !$('rcAuto').checked); $('rcRemDW').classList.toggle('hidden', !$('rcRemind').checked); $('rcFromW').classList.toggle('hidden', k === 'income' || k === 'udhback'); $('rcWhoW').classList.toggle('hidden', k !== 'udhback'); $('rcGiveW').classList.toggle('hidden', k !== 'udhgive'); $('rcAutoW').classList.toggle('hidden', k === 'udhgive'); $('rcToW').classList.toggle('hidden', k === 'expense' || k === 'udhgive'); $('rcBudgetW').classList.toggle('hidden', k !== 'expense'); };
  $$('#rcKind button').forEach(b => b.addEventListener('click', () => { $$('#rcKind button').forEach(x => x.classList.toggle('on', x === b)); sync(); }));
  $('rcAuto').addEventListener('change', sync); $('rcRemind').addEventListener('change', sync); $('rcEvery').addEventListener('change', sync);
  $$('[data-pre]', $('pshBody')).forEach(b => b.addEventListener('click', () => { const p = presets[+b.dataset.pre][1]; Plan.save = null; recurSheet(null, p); }));
  sync();
  wireMonthRows('rcSteps');
  $('rcStepAdd').addEventListener('click', () => { $('rcSteps').insertAdjacentHTML('beforeend', monthRow({})); wireMonthRows('rcSteps'); });
  if ($('rcOvr')) $('rcOvr').addEventListener('click', () => overrideSheet('r:' + id));
  if (id) $('rcDel').addEventListener('click', () => { Sheets.close('shPlan', true); deleteWithUndo(id, r.name); });
}

/* ---------- auto-record: recurring items marked "Auto-record" tick themselves on their day ---------- */
const rec_autoFrom = id => { const r = id && records[id]; return r && r.auto ? r.autoFrom || r.start : null; };
function autoRecord() {
  const c = planCfg(); if (!c || !Fin.key) return 0;
  const cur = isoMonth(new Date()), today = todayISO(); let n = 0;
  recurs().filter(r => r.auto && r.kind !== 'udhgive' && !(r.kind === 'expense' && r.budget)).forEach(r => {
    const from = [r.start, c.startMonth, r.autoFrom || r.start].sort().pop();                     // not before the month auto-record was switched on
    for (let ym = from, i = 0; ym <= cur && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) {
      if (!recurDue(r, ym)) continue;
      const d = ym + '-' + String(r.day || 1).padStart(2, '0'); if (d > today) continue;
      const key = 'r:' + r.id, it = planItems(c, ym).find(x => x.key === key);
      const pm = pmGet(ym) || pmNew(ym), o = { ...((pm.items || {})[key] || {}) };
      if (!it || it.done || it.matched || o.skip || it.lost || !it.a) { if (it && it.lost && !o.skip) { pm.items = { ...(pm.items || {}), [key]: { ...o, skip: true } }; delete pm.items[key].done; delete pm.items[key].ledgerId; put(pm, { render: false }); } continue; }
      if (it.kind === 'udhback' && udhOwedBy(it.who) < it.a - 0.005) continue;      // nothing (or not enough) left to pay back
      try { o.ledgerId = writeTick(c, ym, { ...it, ledgerId: null, date: d, fixedId: 'fa' + ym.replace('-', '') + '_' + key.replace(/[^\w]/g, '') }, it.a); o.done = true; o.auto = true; }
      catch (e) { RLOG.warn('auto-record', r.id, ym, e.message); continue; }
      pm.items = { ...(pm.items || {}), [key]: o }; put(pm, { render: false }); n++;
    }
  });
  // v2.21 (A4): SIPs and EMIs set inside an account record themselves too, on their day, from the month auto-record was switched on
  accts(true).forEach(a => {
    const jobs = [];
    if (isInvest(a.kind) && a.sip && a.sip.auto && +a.sip.amt && a.sip.day) jobs.push(['sip:' + a.id, a.sip.day, a.sip.autoFrom || a.sip.start]);
    if (a.kind === 'loan' && a.emiAuto && +a.emi && a.emiDay) jobs.push(['emi:' + a.id, a.emiDay, a.emiAutoFrom || a.start]);
    jobs.forEach(([key, day, from0]) => {
      const from = [from0, c.startMonth].filter(Boolean).sort().pop();
      for (let ym = from, i = 0; ym <= cur && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) {
        const last = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(), d = ym + '-' + String(Math.min(day, last)).padStart(2, '0'); if (d > today) continue;
        const it = planItems(c, ym).find(x => x.key === key); if (!it) continue;
        const pm = pmGet(ym) || pmNew(ym), o = { ...((pm.items || {})[key] || {}) };
        if (it.done || it.matched || o.skip || it.lost || !it.a) { if (it.lost && !o.skip) { pm.items = { ...(pm.items || {}), [key]: { ...o, skip: true } }; delete pm.items[key].done; delete pm.items[key].ledgerId; put(pm, { render: false }); } continue; }
        try { o.ledgerId = writeTick(c, ym, { ...it, ledgerId: null, date: d, fixedId: 'fa' + ym.replace('-', '') + '_' + key.replace(/[^\w]/g, '') }, it.a); o.done = true; o.auto = true; }
        catch (e) { RLOG.warn('auto-record', key, ym, e.message); continue; }
        pm.items = { ...(pm.items || {}), [key]: o }; put(pm, { render: false }); n++;
      }
    });
  });
  return n;
}
/* ---------- a Key date reminds you of the monthly check-up (it also appears in the daily email) ---------- */
const CHECKUP_LABEL = 'Monthly review';
const checkupDate = () => all('date').find(d => d.sys === 'checkup');
function setCheckupReminder(on) {
  const d = checkupDate();
  if (on && !d) { const nx = monthAdd(isoMonth(new Date()), 1) + '-01'; put({ id: uid('d'), type: 'date', label: CHECKUP_LABEL, when: nx, repeat: 'monthly', sys: 'checkup', deleted: false }, { render: false }); }
  else if (!on && d) softDelete(d.id, { render: false });
}
/* Called by the app each time the private section is unlocked. */
function finAfterUnlock() {
  try { const moved = vaultToNote(); if (moved) setTimeout(() => toast(`${moved} card & account detail${moved > 1 ? 's' : ''} moved to PNote → “Cards & accounts” (the old copies are in Recently deleted).`), 1500); } catch (e) { RLOG.error('vault move', e); }   // v2.27
  try {
    cleanZeroTicks();
    const go = () => { const n = autoRecord(); if (n) { toast(`${n} recurring entr${n > 1 ? 'ies' : 'y'} recorded automatically.`); scheduleRender(); } };
    if (typeof Sync !== 'undefined' && Sync.on() && navigator.onLine) Sync.run().finally(go); else go();   // sync first, so two devices don't both record
  } catch (e) { RLOG.error('finAfterUnlock', e); }
}

/* ---------- balance check: "What was it?" ---------- */
const udhKindIs = (e, kind) => kind === 'borrowed' ? youOwe(e) : e.kind === kind;
function udhOpen(kind, who) {
  return all('fin').filter(e => udhKindIs(e, kind) && !e.settled && outstanding(e) > 0 && (e.who || '').trim().toLowerCase() === (who || '').trim().toLowerCase())
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
}
function udhPeople(kind) {
  const m = new Map();
  all('fin').filter(e => udhKindIs(e, kind) && !e.settled && outstanding(e) > 0 && (e.who || '').trim()).forEach(e => { const k = e.who.trim(); m.set(k, (m.get(k) || 0) + outstanding(e)); });
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
/* Money paid back on someone's oldest open udhaar entries (kind 'lent' = they pay you, 'borrowed' = you pay them). */
function udhPayBack(kind, who, acct, amt, date) {
  const owed = udhOpen(kind, who).reduce((s, e) => s + outstanding(e), 0);
  if (amt > owed + 0.005) throw new Error(`Only ${rs(owed)} is open with ${who}.`);
  let left = amt;
  udhOpen(kind, who).forEach(e => {
    if (left <= 0.005) return;
    const take = Math.min(left, outstanding(e));
    e.pays = (e.pays || []).concat([{ date, amt: +take.toFixed(2), acct }]);
    e.paidAmount = +(((e.paidAmount || 0) + take).toFixed(2)); e.settled = e.paidAmount >= (+e.amount || 0) - 0.005;
    left -= take; put(e, { render: false });
  });
}
function fixWhat(c, ym, a, diff, rowEl) {
  const out = diff < 0, amt = Math.abs(diff), cur = isoMonth(new Date()), date = ym === cur ? todayISO() : monthEnd(ym);
  const others = accts().filter(x => x.id !== a.id && (isLiquid(x.kind) || x.kind === 'card' || isInvest(x.kind)));
  const lentP = udhPeople('lent'), borP = udhPeople('borrowed');
  const opt = (v, l, sub) => `<label class="fix-opt"><input type="radio" name="fixWhat" value="${v}"><span>${l}${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  const box = document.createElement('div'); box.className = 'fix-box'; box.id = 'fixBox';
  box.innerHTML = `<b>${esc(a.name)}: bank ${out ? 'lower' : 'higher'} by ${rs(amt)}. What was it?</b>
    ${opt('flow', out ? 'Spending I did not enter' : 'Income I did not enter', out ? 'e.g. UPI, card, charges, cash withdrawal spent' : 'e.g. interest, refund, cashback')}
    <div class="fix-sub" data-for="flow"><select id="fxCat">${FIN_CATS.map(k => `<option${k === (out ? 'Household' : 'Other') ? ' selected' : ''}>${k}</option>`).join('')}</select><input id="fxDesc" placeholder="What (optional)"></div>
    ${others.length ? opt('xfer', out ? 'Moved to another of my accounts' : 'Came from another of my accounts', 'Not spending or income') : ''}
    <div class="fix-sub" data-for="xfer"><select id="fxAcct">${others.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
    ${opt('udh', out ? 'Udhaar: I gave or repaid money' : 'Udhaar: money given back to me or borrowed', '')}
    <div class="fix-sub" data-for="udh"><select id="fxUdh">${out
      ? `<option value="lend">I lent to someone (new udhaar)</option>${borP.map(([n, v]) => `<option value="repay|${esc(n)}">I repaid ${esc(n)} (I owe ${rs(v)})</option>`).join('')}`
      : `${lentP.map(([n, v]) => `<option value="back|${esc(n)}">${esc(n)} paid me back (owes ${rs(v)})</option>`).join('')}<option value="borrow">I borrowed from someone (new udhaar)</option>`}</select>
      <input id="fxWho" placeholder="Name" list="peopleDl"></div>
    ${opt('split', 'More than one thing', `Split ${rs(amt)} into parts — e.g. spent ${rs(amt + 50)} and got ₹50 interest`)}
    <div class="fix-sub" data-for="split"><div id="fxParts"></div><button class="linkbtn" id="fxAddPart">＋ Add a part</button><div class="hint" id="fxLeft" style="margin:4px 0 0"></div></div>
    ${opt('open', 'The opening balance was wrong', 'Changes the balance on ' + fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true) + ' — every month shifts. Only if the starting figure was typed wrong.')}
    ${opt('unk', "Don't know", `Recorded as unrecorded ${out ? 'spending' : 'income'} (category Adjustment)`)}
    <div class="btn-row" style="margin-top:8px"><button class="btn small" id="fxOk">Record</button><button class="btn small ghost" id="fxCancel">Cancel</button></div>`;
  const old = $('fixBox'); if (old) old.remove();
  rowEl.insertAdjacentElement('afterend', box);
  const sync = () => { const v = (box.querySelector('input[name=fixWhat]:checked') || {}).value;
    $$('.fix-sub', box).forEach(x => x.classList.toggle('hidden', x.dataset.for !== v));
    const u = $('fxUdh'); $('fxWho').classList.toggle('hidden', !(v === 'udh' && u && (u.value === 'lend' || u.value === 'borrow'))); };
  $$('input[name=fixWhat]', box).forEach(r => r.addEventListener('change', sync)); $('fxUdh').addEventListener('change', sync); sync();
  // v2.27: split one difference into several entries
  const partKinds = [['exp', 'Spending'], ['inc', 'Income'], ...(others.length ? [['xout', 'Moved to my account'], ['xin', 'Came from my account']] : [])];
  const partRow = (k, v) => `<div class="fx-part"><select class="fxK">${partKinds.map(([x, l]) => `<option value="${x}"${x === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input class="fxA" inputmode="decimal" placeholder="₹" value="${v || ''}"><select class="fxC">${FIN_CATS.map(x => `<option${x === (k === 'inc' ? 'Other' : 'Household') ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <select class="fxO hidden">${others.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><input class="fxD" placeholder="What (optional)"><button class="icon-btn fxX" aria-label="Remove part">✕</button></div>`;
  const sgn = k => (k === 'inc' || k === 'xin') ? 1 : -1;
  const parts = () => $$('.fx-part', box).map(r => ({ k: r.querySelector('.fxK').value, a: calcAmount(r.querySelector('.fxA').value), cat: r.querySelector('.fxC').value, o: r.querySelector('.fxO').value, d: r.querySelector('.fxD').value.trim(), r }));
  const left = () => { const sum = parts().reduce((t, p) => t + (isNaN(p.a) ? 0 : sgn(p.k) * p.a), 0); return +(diff - sum).toFixed(2); };
  const upd = () => { parts().forEach(p => { p.r.querySelector('.fxC').classList.toggle('hidden', p.k === 'xout' || p.k === 'xin'); p.r.querySelector('.fxO').classList.toggle('hidden', !(p.k === 'xout' || p.k === 'xin')); });
    const l = left(); $('fxLeft').textContent = Math.abs(l) < 0.005 ? '✓ Fully explained' : `${rs(Math.abs(l))} still to explain (${l < 0 ? 'more going out' : 'more coming in'})`; $('fxLeft').className = 'hint ' + (Math.abs(l) < 0.005 ? 'pos' : ''); };
  const wire = () => { $$('.fx-part', box).forEach(r => { r.querySelectorAll('select,input').forEach(x => { x.oninput = upd; x.onchange = upd; }); r.querySelector('.fxX').onclick = () => { r.remove(); upd(); }; }); upd(); };
  $('fxParts').innerHTML = partRow(out ? 'exp' : 'inc', amt) + partRow(out ? 'inc' : 'exp', '');
  $('fxAddPart').addEventListener('click', () => { $('fxParts').insertAdjacentHTML('beforeend', partRow('exp', '')); wire(); }); wire();
  box.querySelector('input[value=unk]').checked = true; sync();
  $('fxCancel').addEventListener('click', () => box.remove());
  $('fxOk').addEventListener('click', () => {
    const v = (box.querySelector('input[name=fixWhat]:checked') || {}).value;
    const base = { type: 'fin', who: '', recurring: false, paidAmount: 0, settled: false, deleted: false, date };
    try {
      if (v === 'flow') put({ ...base, id: uid('f'), desc: $('fxDesc').value.trim() || (out ? 'Spending (balance check)' : 'Income (balance check)'), amount: amt, kind: out ? 'expense' : 'income', category: $('fxCat').value, acct: a.id }, { render: false });
      else if (v === 'xfer') { const o = $('fxAcct').value; put({ ...base, id: uid('f'), desc: 'Transfer (balance check)', amount: amt, kind: 'transfer', category: '', acct: out ? a.id : o, to: out ? o : a.id }, { render: false }); }
      else if (v === 'udh') {
        const [k, who0] = $('fxUdh').value.split('|'), who = who0 || $('fxWho').value.trim();
        if (!who) throw new Error('Type the name.');
        if (k === 'lend' || k === 'borrow') put({ ...base, id: uid('f'), desc: 'Udhaar (balance check)', amount: amt, kind: k === 'lend' ? 'lent' : 'borrowed', category: '', acct: a.id, who }, { render: false });
        else udhPayBack(k === 'back' ? 'lent' : 'borrowed', who, a.id, amt, date);
      } else if (v === 'split') {
        const P = parts().filter(p => !isNaN(p.a) && p.a > 0);
        if (P.length < 1) throw new Error('Enter at least one part.');
        if (Math.abs(left()) >= 0.005) throw new Error(`The parts must add up to ${out ? '−' : '+'}${rs(amt)}. ${rs(Math.abs(left()))} is still to explain.`);
        P.forEach(p => {
          if (p.k === 'exp' || p.k === 'inc') put({ ...base, id: uid('f'), desc: p.d || (p.k === 'exp' ? 'Spending (balance check)' : 'Income (balance check)'), amount: p.a, kind: p.k === 'exp' ? 'expense' : 'income', category: p.cat, acct: a.id }, { render: false });
          else put({ ...base, id: uid('f'), desc: p.d || 'Transfer (balance check)', amount: p.a, kind: 'transfer', category: '', acct: p.k === 'xout' ? a.id : p.o, to: p.k === 'xout' ? p.o : a.id }, { render: false });
        });
      } else if (v === 'open') { a.open = Math.round(((+a.open || 0) + (isLiab(a.kind) ? -diff : diff)) * 100) / 100; put(a, { render: false }); }
      else put({ ...base, id: uid('f'), desc: out ? 'Unrecorded spending (balance check)' : 'Unrecorded income (balance check)', amount: amt, kind: out ? 'expense' : 'income', category: 'Adjustment', acct: a.id }, { render: false });
    } catch (e) { planMsg(e.message, true); return; }
    toast(`${a.name}: ${rs(amt)} recorded.`);
    planMonthSheet(ym);
  });
  box.scrollIntoView({ block: 'nearest' });
}

/* ---------- a month: tick what happened, change amounts, one-offs, balance check ---------- */
function writeTick(c, ym, it, amt) {
  const cur = isoMonth(new Date());
  if (it.kind === 'udhback') {
    const ref = ym + '|' + it.key, have = all('fin').reduce((s, e) => s + (e.pays || []).filter(p => p.planRef === ref).reduce((t, p) => t + (+p.amt || 0), 0), 0);
    if (Math.abs(have - amt) >= 0.005) applyUdhPays(ref, it.who, it.to, amt, it.date || (ym === cur ? todayISO() : monthEnd(ym)));
    return 'udh:' + ref;
  }
  const old = it.ledgerId && records[it.ledgerId] && !records[it.ledgerId].deleted ? records[it.ledgerId] : null;
  if (old) { if (Math.abs((+old.amount || 0) - amt) >= 0.005) { old.amount = amt; put(old, { render: false }); } return old.id; }
  const same = it.fixedId && records[it.fixedId];                     // auto-record uses one id per month on every device
  if (same && !same.deleted) return same.id;
  const rec = { id: it.fixedId || uid('f'), type: 'fin', who: '', recurring: false, paidAmount: 0, settled: false, deleted: false };
  Object.assign(rec, { desc: it.label, amount: amt, kind: it.kind, category: it.kind === 'income' ? (it.cat || (/salary/i.test(it.label) ? 'Salary' : '')) : (it.cat || ''),
    acct: it.kind === 'income' ? it.to : it.from, to: it.kind === 'transfer' ? it.to : undefined, date: it.date || (ym === cur ? todayISO() : monthEnd(ym)), planRef: ym + '|' + it.key });
  put(rec, { render: false });
  return rec.id;
}
function planMonthSheet(ym) {
  const c = planCfg(); if (!c) return;
  if (!accts().length) { toast('Add your accounts first (Money → Accounts).'); return; }
  if (ym < c.startMonth) ym = c.startMonth;
  const cur = isoMonth(new Date()), items = planItems(c, ym), pm = pmGet(ym) || pmNew(ym);
  if (items.some(it => it.rate && !it.changed && !it.done)) { const E = intEstimates(c, ym); items.forEach(it => { if (it.rate && !it.changed && !it.done) it.a = E[it.to] || 0; }); }   // v2.37
  const canTick = ym <= cur;
  const matchedIds = new Set(items.filter(i => i.matched).map(i => i.matched));
  const monthFl = ledgerFlows(c).filter(f => f.ym === ym);
  const spent = monthFl.filter(f => budgetSpendable(f, matchedIds)).reduce((s, f) => s - f.amt, 0);   // v2.34: same rule as the engine
  const bUse = budgetUse(items, monthFl, matchedIds);                                                    // v2.37: per estimate, not the total on every row
  const route = it => it.kind === 'udhback' ? 'from ' + esc(it.who) + ' into ' + esc(acctName(it.to)) + ' · udhaar' : it.kind === 'income' ? 'into ' + esc(acctName(it.to)) : it.kind === 'expense' ? 'from ' + esc(acctName(it.from)) : esc(acctName(it.from)) + ' → ' + esc(acctName(it.to));
  const itemRow = it => `<div class="pl-row src" data-it="${esc(it.key)}"><span class="r-name">${esc(it.label)}<small class="dq-sub">${route(it)}${it.changed ? ' · changed this month' : ''}${it.matched ? ' · found in Ledger' : ''}</small></span>
      ${amtIn('mi_' + it.key.replace(/[^\w]/g, '_'), it.a)}
      ${it.budget ? `<span class="r-act" title="Day-to-day spending counted against this estimate">${rs(bUse[it.key] || 0)} of it used</span>` : `<label class="r-act"><input type="checkbox" data-done ${it.done ? 'checked' : ''}${canTick && !it.matched ? '' : ' disabled'}> Done</label>`}
      ${it.extra ? `<button class="icon-btn r-rm" data-xrm="${esc(it.key)}" aria-label="Remove" style="width:32px;height:32px;font-size:13px">✕</button>` : ''}</div>`;
  const grp = (t, list) => list.length ? `<h4 class="plan-sub">${t}</h4>${list.some(i => i.budget) ? `<p class="hint" style="margin:0 4px 6px">Day-to-day spending in ${esc(monthLong(ym))}: <b>${rs(spent)}</b>. Each estimate counts what was spent from its own account first; spending from accounts without an estimate fills the rest.</p>` : ''}<div class="group pl-group">${list.map(itemRow).join('')}</div>` : '';
  const now = ym < cur ? planCompute(c, ym, 'actual').slice(-1)[0] : null;
  const chk = now ? accts().filter(a => !isInvest(a.kind) && a.kind !== 'loan').map(a => {
    const app = now.accts[a.id] || 0, stated = (pm.checked || {})[a.id];
    return `<div class="pl-row src" data-chk="${a.id}"><span class="r-name">${esc(a.name)}<small class="dq-sub">app says ${rs(isLiab(a.kind) ? -app : app)}${isLiab(a.kind) ? ' owed' : ''}</small></span>${amtIn('ck_' + a.id, stated, isLiab(a.kind) ? 'owed' : 'bank shows')}<button class="btn small ghost" data-fix="${a.id}">Fix</button></div>`;
  }).join('') + accts().filter(a => isInvest(a.kind)).map(a => {
    const v = (a.values || []).find(x => x.month === ym);
    return `<div class="pl-row src" data-val="${a.id}"><span class="r-name">${esc(a.name)}<small class="dq-sub">value at month end</small></span>${amtIn('cv_' + a.id, v ? v.a : '', 'statement value')}</div>`;
  }).join('') : '';
  const html = `<div class="month-nav" style="margin-bottom:10px"><button id="pmPrev" aria-label="Previous month">‹</button><span class="mj"><b>${monthLong(ym)}</b><input type="month" class="mj-in" id="pmPick" value="${ym}" min="${c.startMonth}" aria-label="Pick a month"></span><button id="pmNext" aria-label="Next month">›</button></div>
    <p class="hint" style="margin:0 4px 6px">${ym < cur ? 'Monthly check-up: tick what actually came in and went out, correcting amounts if they differed. Each tick is written into the Ledger. Once the month is marked checked, anything left unticked is taken as not having happened.' : ym === cur ? 'This month: tick items as they happen. Unticked items still count in the plan. The balance check opens after the month ends.' : 'Future month: change amounts for this month only. Ticking opens when the month arrives.'}</p>
    ${grp('Income', items.filter(i => i.kind === 'income'))}
    ${grp('Udhaar coming back', items.filter(i => i.kind === 'udhback'))}
    ${grp('Payments, SIPs, EMIs and transfers', items.filter(i => i.kind !== 'income' && i.kind !== 'udhback' && !i.budget))}
    ${grp('Day-to-day spending (estimate)', items.filter(i => i.budget))}
    <button class="linkbtn" id="pmAdd">＋ Add a one-off for this month</button><div id="pmAddBox"></div>
    ${now ? `<h4 class="plan-sub">Balance check (optional) · end of ${monthLong(ym)}</h4><div class="group pl-group">${chk}</div>
      <p class="hint" style="margin:4px 4px 0">Type what each account showed on ${fmtDate(monthEnd(ym), true)} (bank, cash in hand, card dues), then tap the button. All accounts are compared together, so cash you withdrew or a card bill you paid is not counted as spending. Leave an account blank to skip it.</p>
      <button class="btn" id="pmAll" style="margin:8px 0 0;width:100%">Work out ${monthLong(ym)}</button><div id="mcBox"></div>
      <p class="hint" style="margin:6px 4px 0">“Fix” on a row does one account at a time and asks what the difference was.</p>
      <div class="group" style="margin-top:10px"><label class="switch-row"><span>Check-up done<small>Removes ${monthLong(ym)} from the "needs a check-up" count.</small></span><input type="checkbox" class="sw" id="pmClosed"${pm.closed ? ' checked' : ''}></label></div>` : ''}`;
  planSheet(ym < cur ? 'Monthly check-up' : 'Month', html, (quiet) => planMonthSave(ym, quiet));
  const root = $('pshBody');
  $$('[data-xrm]', root).forEach(b => b.addEventListener('click', () => { const x = b.dataset.xrm.slice(2); const p = pmGet(ym); if (!p) return;
    const e = (p.extra || []).find(y => y.id === x); if (e && e.ledgerId && records[e.ledgerId]) softDelete(e.ledgerId, { render: false });
    p.extra = p.extra.filter(y => y.id !== x); put(p, { render: false }); planMonthSheet(ym); }));
  $('pmAdd').addEventListener('click', () => {
    $('pmAddBox').innerHTML = `<div class="group pl-group" style="margin-top:6px"><div class="pl-row"><select id="pxKind"><option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option></select><input id="pxLbl" class="r-lbl" placeholder="e.g. School fees, Bonus"></div>
      <div class="pl-row"><select id="pxFrom" aria-label="From">${acctOptions(defAcct(c))}</select><span id="pxArrow">→</span><select id="pxTo" aria-label="Into">${acctOptions(defAcct(c))}</select>${amtIn('pxAmt', '')}</div>
      <button class="btn small" id="pxOk">Add</button></div>`;
    const sync = () => { const k = $('pxKind').value; $('pxFrom').classList.toggle('hidden', k === 'income'); $('pxTo').classList.toggle('hidden', k === 'expense'); $('pxArrow').classList.toggle('hidden', k !== 'transfer'); };
    $('pxKind').addEventListener('change', sync); sync();
    $('pxOk').addEventListener('click', () => {
      try {
        if (planMonthSave(ym, true) === false) return;
        const k = $('pxKind').value, a = readAmt('pxAmt', 'Amount', true), label = $('pxLbl').value.trim() || (k === 'income' ? 'One-off income' : k === 'expense' ? 'One-off expense' : 'Transfer');
        if (k === 'transfer' && $('pxFrom').value === $('pxTo').value) throw new Error('Pick two different accounts.');
        const p = pmGet(ym) || pmNew(ym); p.extra = (p.extra || []).concat([{ id: uid('x'), kind: k, label, a, from: k === 'income' ? null : $('pxFrom').value, to: k === 'expense' ? null : $('pxTo').value }]);
        put(p, { render: false }); planMonthSheet(ym);
      } catch (e) { planMsg(e.message, true); }
    });
  });
  $$('[data-fix]', root).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.fix, a = acctById(id), raw = $('ck_' + id).value;
    if (isBlank(raw)) { planMsg('Type what the bank shows first.', true); return; }
    const stated = num(raw); if (!isFinite(stated)) { planMsg('Not a valid amount.', true); return; }
    if (planMonthSave(ym, true) === false) return;
    const app = planCompute(c, ym, 'actual').slice(-1)[0].accts[id] || 0;
    const target = isLiab(a.kind) ? -stated : stated, diff = Math.round((target - app) * 100) / 100;
    if (Math.abs(diff) < 0.5) { planMsg(`${a.name} already matches.`); return; }
    fixWhat(c, ym, a, diff, b.closest('.pl-row'));
  }));
  if ($('pmAll')) $('pmAll').addEventListener('click', () => { try { monthCloseAll(c, ym); } catch (e) { RLOG.error('month close', e); planMsg(e.message, true); } });   // v2.34
  const go = d => { if (planMonthSave(ym, true) !== false) planMonthSheet(monthAdd(ym, d)); };
  $('pmPrev').addEventListener('click', () => { if (ym > c.startMonth) go(-1); else planMsg('This is the first month of the plan.', true); });
  $('pmNext').addEventListener('click', () => go(1));
  $('pmPick').addEventListener('change', e => { const v = e.target.value; if (ymOk(v) && v !== ym) { if (v < c.startMonth) { planMsg('That is before the plan starts.', true); e.target.value = ym; return; } if (planMonthSave(ym, true) !== false) planMonthSheet(v); } });   // v2.27
}
function planMonthSave(ym, quiet) {
  const c = planCfg(), root = $('pshBody'); if (!root || !c) return true;
  let p = null, wrote = false;
  try {
    const items = planItems(c, ym), base = {}; items.forEach(it => { base[it.key] = it; });
    p = pmGet(ym) ? { ...pmGet(ym), items: { ...(pmGet(ym).items || {}) }, extra: (pmGet(ym).extra || []).map(x => ({ ...x })), checked: { ...(pmGet(ym).checked || {}) } } : pmNew(ym);
    const orig = {}; recurs().forEach(r => { orig['r:' + r.id] = recurAmt(r, ym); }); accts().forEach(a => { if (a.sip) orig['sip:' + a.id] = +a.sip.amt || 0; if (a.kind === 'loan') orig['emi:' + a.id] = +a.emi || 0; });
    { const E = accts().some(a => acctInt(a) && !acctInt(a).amt) ? intEstimates(c, ym) : {}; accts().forEach(a => { const I = acctInt(a); if (I) orig['int:' + a.id] = I.amt || E[a.id] || 0; }); }   // v2.37
    // 1) read and check every row; nothing is written yet
    const rows = [], udhWant = new Map();
    for (const row of $$('[data-it]', root)) {
      const key = row.dataset.it, it = base[key]; if (!it) continue;
      const raw = row.querySelector('input:not([type=checkbox])').value;
      let a = isBlank(raw) ? 0 : num(raw); if (!isFinite(a) || a < 0) throw new Error(`${it.label}: "${raw}" is not a valid amount.`);
      a = Math.round(a * 100) / 100;
      const cb = row.querySelector('[data-done]'), done = !!(cb && cb.checked);
      if (it.kind === 'udhback' && done && a && !it.matched) {
        const k = it.who.trim().toLowerCase(), ref = ym + '|' + key;
        const mine = all('fin').reduce((s, e) => s + (e.pays || []).filter(q => q.planRef === ref).reduce((t, q) => t + (+q.amt || 0), 0), 0);
        const room = udhWant.has(k) ? udhWant.get(k) : udhOwedBy(it.who);
        if (a > room + mine + 0.005) throw new Error(`${it.label}: ${it.who} owes only ${rs(room + mine)} in Udhaar, not ${rs(a)}.`);
        udhWant.set(k, room + mine - a);
      }
      rows.push({ key, it, a, done });
    }
    const checked = {}; $$('[data-chk]', root).forEach(r => { const id = r.dataset.chk, raw = $('ck_' + id).value; if (!isBlank(raw)) { const v = num(raw); if (!isFinite(v)) throw new Error('Balance check: not a valid amount.'); checked[id] = v; } });
    const vals = []; $$('[data-val]', root).forEach(r => { const id = r.dataset.val, raw = $('cv_' + id).value;
      if (!isBlank(raw)) { const v = num(raw); if (!isFinite(v) || v < 0) throw new Error(`${acctById(id).name}: not a valid value.`); vals.push([id, v]); } else vals.push([id, null]); });
    // 2) write
    rows.forEach(({ key, it, a, done }) => {
      if (it.extra) {
        const x = p.extra.find(y => 'x:' + y.id === key); x.a = a;
        if (done && a) { x.ledgerId = writeTick(c, ym, { ...it, ledgerId: x.ledgerId }, a); wrote = true; }
        else if (!done && x.ledgerId && records[x.ledgerId]) { softDelete(x.ledgerId, { render: false }); x.ledgerId = null; }
        x.done = done && !!a;
      } else {
        const o = { ...(p.items[key] || {}) };
        if (Math.abs(a - (orig[key] || 0)) >= 0.005) o.a = a; else delete o.a;
        if (it.matched) { /* already in the Ledger as your own entry */ }
        else if (done && a) { o.ledgerId = writeTick(c, ym, { ...it, ledgerId: o.ledgerId }, a); o.done = true; delete o.skip; wrote = true; }
        if (!it.matched && !(done && a)) {
          if (it.kind === 'udhback') removeUdhPays(ym + '|' + key);
          if (o.ledgerId && records[o.ledgerId]) softDelete(o.ledgerId, { render: false });
          if (o.done) o.skip = true;                                // unticked by you: auto-record leaves it alone
          delete o.ledgerId; delete o.done;
        }
        if (Object.keys(o).length) p.items[key] = o; else delete p.items[key];
      }
    });
    const shown = new Set($$('[data-chk]', root).map(r => r.dataset.chk));
    p.checked = { ...Object.fromEntries(Object.entries(p.checked || {}).filter(([k]) => !shown.has(k))), ...checked };
    vals.forEach(([id, v]) => { const a = acctById(id); const list = (a.values || []).filter(x => x.month !== ym); if (v != null) list.push({ month: ym, a: v });
      if (JSON.stringify(list) !== JSON.stringify(a.values || [])) { a.values = list.sort((x, y) => x.month.localeCompare(y.month)); put(a, { render: false }); } });
    if ($('pmClosed')) p.closed = $('pmClosed').checked;
    put(p, { render: false });
    if (!quiet) toast('Saved ' + monthLong(ym) + '.');
    return true;
  } catch (e) {
    if (wrote && p) { try { put(p, { render: false }); } catch (e2) { RLOG.error('month save rollback', e2); } }   // keep links to what was written
    planMsg(e.message, true); return false;
  }
}

