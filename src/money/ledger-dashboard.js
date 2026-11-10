/* ==========================================================================
   LEDGER DASHBOARD (v2.3) — savings today, expected savings for a period,
   and income / spending / investment over time.
   ======================================================================== */
const Dash = { kind: 'fy', key: null, asOn: null };
function dashSeries(upto) {
  const c = planCfg(), cur = isoMonth(new Date());
  if (c && c.v === 3 && accts().length) {
    const h = planHorizon(c), end = upto && upto > h ? upto : h;
    return { plan: c, rows: planCompute(c, end).map(r => ({ ym: r.ym, inc: r.inc, exp: r.exp, inv: r.invIn, planned: r.ym > cur || r.planned, r })) };
  }
  const by = {};
  all('fin').forEach(e => {
    const ym = (e.date || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(ym)) return;
    const o = by[ym] = by[ym] || { ym, inc: 0, exp: 0, inv: 0, planned: false };
    if (e.kind === 'income') o.inc += +e.amount || 0;
    else if (e.kind === 'expense') { if (e.category === 'Investment') o.inv += +e.amount || 0; else o.exp += +e.amount || 0; }
  });
  return { plan: null, rows: Object.values(by).sort((a, b) => a.ym.localeCompare(b.ym)) };
}
function dashChart(pts) {
  if (!pts.length) return '<p class="hint" style="margin:8px 4px">Nothing to chart for this period yet.</p>';
  const W = 640, H = 230, L = 58, R = 10, T = 12, B = 30;
  const max = Math.max(1, ...pts.map(p => Math.max(p.inc, p.exp, p.inv)));
  const e = Math.pow(10, Math.floor(Math.log10(max / 4))); let step = e;
  for (const k of [1, 2, 2.5, 5, 10]) { step = k * e; if (max / step <= 4) break; }
  const top = Math.ceil(max / step) * step, y = v => T + (H - T - B) * (1 - Math.max(0, v) / top);
  const bw = (W - L - R) / pts.length, gw = Math.min(42, bw * 0.78), w = gw / 3;
  const ax = v => v >= 1e7 ? (v / 1e7).toFixed(v % 1e7 ? 1 : 0) + ' Cr' : v >= 1e5 ? (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + ' L' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(v);
  let g = '';
  for (let v = 0; v <= top + step / 2; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="dg"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="dt">${ax(v)}</text>`;
  const every = Math.ceil(pts.length / 8);
  pts.forEach((p, i) => {
    const x0 = L + bw * i + (bw - gw) / 2, op = p.planned ? ' opacity="0.45"' : '';
    [['inc', 'var(--forest)'], ['exp', 'var(--seal)'], ['inv', 'var(--brass)']].forEach(([k, col], j) => {
      const h = Math.max(0, y(0) - y(p[k]));
      if (h > 0) g += `<rect x="${(x0 + j * w).toFixed(1)}" y="${y(p[k]).toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${h.toFixed(1)}" style="fill:${col}"${op}><title>${p.label}: ${k === 'inc' ? 'income' : k === 'exp' ? 'spending' : 'into investments'} ${rs(p[k])}${p.planned ? ' (includes planned)' : ''}</title></rect>`;
    });
    if (i % every === 0) g += `<text x="${(L + bw * i + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="dt">${p.label}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Income, spending and investment chart">${g}</svg>`;
}
function renderDash() {
  const box = $('ledgerDash'); if (!box) return;
  if (!['fy', 'upto'].includes(Dash.kind)) { Dash.kind = 'fy'; Dash.key = null; }
  const cur = isoMonth(new Date());
  const { plan: c, rows } = dashSeries(Dash.kind === 'upto' && /^\d{4}-\d{2}$/.test(Dash.key || '') ? Dash.key : null);
  const startYm = c ? c.startMonth : (rows[0] ? rows[0].ym : cur);
  const ymode = c ? (c.yearMode || 'fy') : 'fy';
  const months = rows.map(r => r.ym); if (!months.includes(cur)) months.push(cur); months.sort();
  const opts = { month: [...new Set(months)].reverse(), fy: [...new Set(months.map(m => yearKey(m, 'fy')))], cal: [...new Set(months.map(m => yearKey(m, 'cal')))] };
  if (Dash.kind === 'upto') { if (!/^\d{4}-\d{2}$/.test(Dash.key || '') || Dash.key < startYm) { const fyEnd = (+cur.slice(5) >= 4 ? +cur.slice(0, 4) + 1 : +cur.slice(0, 4)) + '-03'; Dash.key = fyEnd < startYm ? startYm : fyEnd; } }
  else if (Dash.kind !== 'all') { const list = opts[Dash.kind]; if (Dash.key == null || !list.some(k => String(k) === String(Dash.key))) Dash.key = Dash.kind === 'month' ? cur : yearKey(cur, Dash.kind); }
  const inP = ym => Dash.kind === 'all' || (Dash.kind === 'upto' ? ym >= startYm && ym <= Dash.key : false) || (Dash.kind !== 'upto' && (Dash.kind === 'month' ? ym === Dash.key : yearKey(ym, Dash.kind) === +Dash.key));
  const per = rows.filter(r => inP(r.ym));
  const pLabel = Dash.kind === 'upto' ? monthShort(startYm) + ' up to ' + monthLong(Dash.key) : Dash.kind === 'all' ? 'the whole plan' : Dash.kind === 'month' ? monthLong(Dash.key) : yearLabel(+Dash.key, Dash.kind);
  let c1 = '', cInc = '', cAcc = '';
  if (c) {
    if (!/^\d{4}-\d{2}$/.test(Dash.asOn || '')) Dash.asOn = cur;
    const B = balancesOn(c, Dash.asOn === cur ? todayISO() : monthEnd(Dash.asOn)), U = { owed: B.owed, owe: B.owe };
    const line = (k, v, cls) => `<div class="dash-line"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`;
    c1 = `<div class="dash-card"><div class="k" style="display:flex;justify-content:space-between;gap:8px;align-items:center">Balances as on<input type="month" id="dashAsOn" value="${Dash.asOn}" aria-label="As on month" style="width:auto;padding:4px 6px;font-size:.8125rem"></div>
      <div class="v ${B.money < 0 ? 'neg' : ''}">${rsShort(B.money)}</div><div class="s muted" style="margin:-2px 0 6px">Money you have · ${esc(B.label)}</div>
      ${line('Total in bank (incl. wallets)', rs(B.bank), B.bank < 0 ? 'neg' : '')}${line('Cash', rs(B.cash), B.cash < 0 ? 'neg' : '')}${line('Investments', rs(B.invest))}
      ${B.card ? line('Card dues', '−' + rs(B.card), 'neg') : ''}
      <div class="dash-sep"></div>
      ${line('Others owe you (udhaar)', '+' + rs(U.owed))}${U.owe ? line('You owe others (udhaar)', '−' + rs(U.owe), 'neg') : ''}
      <div class="dash-sep"></div>
      ${line('Money in hand (bank + cash − card dues)', rs(B.hand), B.hand < 0 ? 'neg' : '')}${B.loan ? line('Loan balance (separate)', rs(B.loan)) : ''}
      <div class="s muted" style="margin-top:6px">${B.mode === 'plan' ? 'A future month shows the plan for its last day (includes estimates, and udhaar instalments still to come).' : Dash.asOn === cur ? 'This month: actual up to today. No estimates.' : 'Actual at the end of the month: opening balances + Ledger. No estimates.'} Money you have = bank + cash + investments + udhaar net − card dues. Loans are not taken out.</div></div>`;
    cAcc = (() => { const L = accts(true).filter(a => !a.archived || Math.abs(B.accts[a.id] || 0) >= 1), ord = ['bank', 'cash', 'invest', 'card', 'loan'];
      if (!L.length) return ''; L.sort((a, b) => ord.indexOf(bucketOf(a.kind)) - ord.indexOf(bucketOf(b.kind)) || (B.accts[b.id] || 0) - (B.accts[a.id] || 0));
      return `<div class="dash-card dash-accts"><div class="k">Each account · ${esc(B.mode === 'plan' ? 'plan' : 'actual')} · ${esc(monthLong(Dash.asOn))}</div>${L.map(a => { const v = B.accts[a.id] || 0, k = bucketOf(a.kind);
        return line(esc(a.name) + `<small>${k === 'card' ? 'card' : k === 'loan' ? 'loan' : k === 'invest' ? 'investment' : k === 'cash' ? 'cash' : 'bank'}</small>`, (k === 'card' || k === 'loan') && v < 0 ? (k === 'card' ? 'due ' : 'owed ') + rs(-v) : rs(v), v < 0 && k !== 'loan' && k !== 'card' ? 'neg' : ''); }).join('')}</div>`; })();
    const ms = (() => { if (Dash.kind === 'month') return [Dash.key]; const all = []; const end = Dash.kind === 'upto' && Dash.key > planHorizon(c) ? Dash.key : planHorizon(c); for (let ym = c.startMonth, i = 0; ym <= end && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) if (inP(ym)) all.push(ym); return all; })();
    const inc = incomeSummary(c, ms), tot = k => inc.filter(x => !x.udh).reduce((s, x) => s + x[k], 0);   // udhaar coming back is not income
    cInc = `<div class="dash-card"><div class="k">Income · ${esc(pLabel)}</div>
      ${inc.length ? `<div class="tw" style="box-shadow:none;margin-top:6px"><table class="pt"><thead><tr><th>Source</th><th>Expected</th><th>Received</th><th>Not received</th><th>Still to come</th></tr></thead><tbody>
        ${inc.map(x => `<tr><td>${esc(x.name)}</td><td>${x.expected ? rs(x.expected) : '–'}</td><td class="pos">${x.received ? rs(x.received) : '–'}</td><td class="${x.overdue ? 'neg' : ''}">${x.overdue ? rs(x.overdue) : '–'}</td><td>${x.upcoming ? rs(x.upcoming) : '–'}</td></tr>`).join('')}
        <tr class="hl"><td>Total income</td><td>${rs(tot('expected'))}</td><td>${rs(tot('received'))}</td><td>${rs(tot('overdue'))}</td><td>${rs(tot('upcoming'))}</td></tr></tbody></table></div>
        <div class="s muted" style="margin-top:6px">Expected = from your recurring items (udhaar instalments are money coming back, not income). Received = ticked in the check-up or found in the Ledger. Not received = months already over but not ticked. Still to come = this month and later.</div>`
      : '<div class="s muted">No income planned or recorded in this period.</div>'}</div>`;
  } else {
    const net = rows.reduce((s, r) => s + r.inc - r.exp - r.inv, 0);
    c1 = `<div class="dash-card"><div class="k">Ledger net · all time</div><div class="v ${net < 0 ? 'neg' : ''}">${rsShort(net)}</div>
      <div class="s muted">Income − spending in the Ledger. Set up Money → Accounts to see balances by bank, cash and investments.</div></div>`;
  }
  const sInc = per.reduce((s, r) => s + r.inc, 0), sExp = per.reduce((s, r) => s + r.exp, 0), sInv = per.reduce((s, r) => s + r.inv, 0);
  const planned = per.some(r => r.planned), endRow = per.length && per[per.length - 1].r;
  const c2 = `<div class="dash-card"><div class="k">${planned ? 'Expected savings' : 'Savings'} · ${esc(pLabel)}</div><div class="v ${sInc - sExp < 0 ? 'neg' : ''}">${rsShort(sInc - sExp)}</div>
    <div class="s">Income ${rsShort(sInc)} − spending ${rsShort(sExp)}${sInv ? ` · of which ${rsShort(sInv)} into investments` : ''}</div>
    ${endRow ? `<div class="s">Money you'll have at end of ${monthLong(endRow.ym)}: <b>${rsShort(endRow.worth)}</b>${endRow.loanBal ? ` · loan balance ${rsShort(endRow.loanBal)}` : ''}</div>` : ''}
    <div class="s muted">${planned ? 'Includes planned months; the Ledger replaces them as months pass.' : c ? 'All figures in this period are actual.' : 'From Ledger entries.'}</div></div>`;
  let pts = per.map(r => ({ label: monthShort(r.ym), inc: r.inc, exp: r.exp, inv: r.inv, planned: r.planned }));
  if (pts.length > 24) {
    const by = new Map();
    per.forEach(r => { const k = yearKey(r.ym, ymode); const o = by.get(k) || { label: yearLabel(k, ymode).replace('FY ', ''), inc: 0, exp: 0, inv: 0, planned: false }; o.inc += r.inc; o.exp += r.exp; o.inv += r.inv; o.planned = o.planned || r.planned; by.set(k, o); });
    pts = [...by.values()];
  }
  const keyOpts = Dash.kind === 'upto' ? `<label class="dash-upto">from ${monthShort(startYm)} to <input type="month" id="dashKey" value="${Dash.key}" min="${startYm}" max="${monthAdd(startYm, PLAN_MAX_MONTHS - 1)}" aria-label="Up to month"></label>` : Dash.kind === 'all' ? '' : `<select id="dashKey" aria-label="Period">${opts[Dash.kind].map(k => `<option value="${k}"${String(k) === String(Dash.key) ? ' selected' : ''}>${Dash.kind === 'month' ? monthLong(k) : yearLabel(k, Dash.kind)}</option>`).join('')}</select>`;
  box.innerHTML = `<div class="dash">
    <div class="btn-row" style="margin:0 0 8px"><button class="btn ghost small" id="dashReport">📄 Money report (PDF)</button></div>
    <div class="dash-per"><div class="seg" id="dashKind" style="margin:0;flex:1;min-width:230px">${[['fy', 'Financial year'], ['upto', 'Up to month']].map(([k, l]) => `<button data-k="${k}" class="${Dash.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>${keyOpts}</div>
    <div class="dash-cards">${c1}${cAcc || c2}</div>
    ${cAcc ? c2 : ''}
    ${cInc}
  </div>`;
  $$('#dashKind button').forEach(b => b.addEventListener('click', () => { Dash.kind = b.dataset.k; Dash.key = null; renderDash(); }));
  const ks = $('dashKey'); if (ks) ks.addEventListener('change', () => { if (Dash.kind !== 'upto' || /^\d{4}-\d{2}$/.test(ks.value)) { Dash.key = ks.value; renderDash(); } });
  if ($('dashReport')) $('dashReport').addEventListener('click', openReport);
  const ao = $('dashAsOn'); if (ao) ao.addEventListener('change', () => { Dash.asOn = ao.value || cur; renderDash(); });
}

