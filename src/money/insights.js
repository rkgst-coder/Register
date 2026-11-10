/* ==========================================================================
   MONEY — insights sheet: dashboard, net worth, budgets, subscriptions
   ======================================================================== */
function openInsights() { renderInsights(); if (!Sheets.isOpen('shInsights')) Sheets.open('shInsights'); }
function renderInsights() {
  if (!Fin.key) return;
  try { renderDash(); } catch (e) { RLOG.error('dashboard', e); }
  try { renderUsual(); } catch (e) { RLOG.error('usual', e); if ($('usualBox')) $('usualBox').innerHTML = ''; }
  try { renderBudgets(); } catch (e) { RLOG.error('budgets', e); }
  try { renderSubs(); } catch (e) { RLOG.error('subscriptions', e); $('subsBox').innerHTML = ''; }
}
$('finXlsxBtn').addEventListener('click', exportXlsx);
$('insToPlan').addEventListener('click', () => { Sheets.close('shInsights'); setPref('moneySeg', 'plan'); renderMoney(); setTimeout(() => { const el = document.querySelector('#planBody .plan-acc'); if (el) { el.open = true; el.scrollIntoView({ block: 'start' }); } }, 200); });
/* ---------- subscriptions: the same thing paid every month (±10%) for 3 months or more ---------- */
const SUBS_ID = 'subs-cfg';
const subsCfg = () => { const r = records[SUBS_ID]; return r && !r.deleted ? r : null; };
const subKey = d => String(d || '').toLowerCase().replace(/\d+/g, ' ').replace(/[^a-zऀ-ॿ]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 1).slice(0, 3).join(' ');
function detectSubs() {
  const cur = isoMonth(new Date()), from = monthAdd(cur, -13), no = new Set((subsCfg() || {}).no || []);
  const covered = new Set(all('recur').map(r => subKey(r.name)).filter(Boolean));
  const g = new Map();
  all('fin').forEach(e => {
    if (e.kind !== 'expense' || e.planRef || e.billRef) return;
    const ym = (e.date || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(ym) || ym < from || ym > cur) return;
    const k = subKey(e.desc); if (!k || k === 'spent') return;
    (g.get(k) || g.set(k, []).get(k)).push(e);
  });
  const out = [];
  g.forEach((L, k) => {
    if (no.has(k) || covered.has(k) || L.some(e => e.recurring)) return;
    const byM = new Map(); L.forEach(e => { const ym = e.date.slice(0, 7); byM.set(ym, (byM.get(ym) || []).concat([e])); });
    const end = byM.has(cur) ? cur : byM.has(monthAdd(cur, -1)) ? monthAdd(cur, -1) : null; if (!end) return;
    const run = []; for (let ym = end; byM.has(ym); ym = monthAdd(ym, -1)) run.push(ym);
    if (run.length < 3 || run.some(ym => byM.get(ym).length > 2)) return;   // tea three times a week is not a subscription
    const amts = run.map(ym => byM.get(ym).reduce((s, e) => s + (+e.amount || 0), 0)), med = amts.slice().sort((a, b) => a - b)[Math.floor(amts.length / 2)];
    if (!(med > 0) || amts.some(a => Math.abs(a - med) > med * 0.10)) return;
    const last = L.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    out.push({ k, name: last.desc, amt: med, months: run.length, acct: last.acct, cat: last.category, day: +last.date.slice(8, 10) || 1, lastId: last.id });
  });
  return out.sort((a, b) => b.amt - a.amt);
}
/* v2.25: each category this month against its average over the 6 months before (months with no spending at all are skipped) */
function usualSpending(ym) {
  const by = {}; let any = new Set();
  all('fin').filter(e => e.kind === 'expense' && +e.amount > 0 && e.date).forEach(e => {
    const m = e.date.slice(0, 7), c = e.category || 'Other'; any.add(m);
    (by[c] = by[c] || {})[m] = (by[c][m] || 0) + (+e.amount || 0);
  });
  const prev = []; for (let i = 1, m = monthAdd(ym, -1); i <= 24 && prev.length < 6; i++, m = monthAdd(m, -1)) if (any.has(m)) prev.push(m);
  const rows = Object.keys(by).map(c => { const now = by[c][ym] || 0, avg = prev.length ? prev.reduce((s, m) => s + (by[c][m] || 0), 0) / prev.length : 0; return { c, now, avg }; })
    .filter(r => r.now > 0 || r.avg >= 1).sort((a, b) => b.now - a.now || b.avg - a.avg);
  return { rows, n: prev.length };
}
function renderUsual() {
  const box = $('usualBox'); if (!box) return;
  const ym = finMonth, cur = isoMonth(new Date()), U = usualSpending(ym), head = `<h3 class="plan-h">${esc(monthLong(ym))}${ym === cur ? ' so far' : ''} vs your usual</h3>`;
  if (!U.n) { box.innerHTML = `<div class="plan-sec">${head}<p class="hint">Shows once there is spending from earlier months to compare.</p></div>`; return; }
  const part = ym === cur ? new Date().getDate() / +monthEnd(ym).slice(8) : 1;
  const line = r => {
    const d = r.now - r.avg, pct = r.avg >= 1 ? Math.round(d / r.avg * 100) : null, high = r.avg >= 1 && r.now > r.avg * 1.25 && d >= 500;
    const note = r.avg < 1 ? 'new this month' : Math.abs(d) < Math.max(200, r.avg * .1) ? 'about usual' : `${d > 0 ? '↑' : '↓'} ${rs(Math.abs(d))} (${Math.abs(pct)}%) ${d > 0 ? 'above' : 'below'} usual`;
    return `<div class="usual-row"><span>${esc(r.c)}</span><b>${rs(r.now)}</b><small class="${high ? 'up' : d < 0 && r.avg >= 1 ? 'dn' : ''}">usually ${rs(r.avg)} · ${note}${high && part < 1 && r.now > r.avg ? ' — already, with the month not over' : ''}</small></div>`;
  };
  box.innerHTML = `<div class="plan-sec">${head}<div class="group" style="padding:4px 14px">${U.rows.slice(0, 12).map(line).join('')}</div>
    <p class="hint">“Usually” = average of the last ${U.n} month${U.n > 1 ? 's' : ''} with spending. Follows the month shown in the Ledger.</p></div>`;
}
function renderSubs() {
  const box = $('subsBox'); if (!box) return;
  const L = detectSubs(), no = ((subsCfg() || {}).no || []).length;
  box.innerHTML = `<div class="plan-sec"><h3 class="plan-h">Looks like subscriptions</h3>${L.length ? `<div class="group">${L.map((x, i) => `<div class="subs-row"><div class="row-main"><div class="row-title">${esc(x.name)}</div><div class="row-sub"><span>${rs(x.amt)} a month</span><span>${x.months} months in a row</span>${x.acct && acctById(x.acct) ? `<span>${esc(acctName(x.acct))}</span>` : ''}</div></div>
      <button class="btn small" data-sub-make="${i}">Make recurring</button><button class="icon-btn" data-sub-no="${i}" aria-label="Not a subscription" style="width:34px;height:34px;font-size:14px">✕</button></div>`).join('')}</div>
      <p class="hint">Found in the Ledger: the same payment every month for 3 months or more, within 10%. “Make recurring” adds it to your plan${planCfg() ? '' : ' (or marks it to repeat every month)'} so it is counted ahead of time.</p>`
    : `<p class="hint" style="margin:0 4px">Nothing new — no payment repeats every month in the Ledger that is not already planned.${no ? ` ${no} dismissed.` : ''}</p>`}
    ${no ? '<button class="linkbtn" id="subUndo">Show dismissed ones again</button>' : ''}</div>`;
  $$('[data-sub-make]', box).forEach(b => b.addEventListener('click', () => {
    const x = L[+b.dataset.subMake], c = planCfg();
    if (c && accts().length) { recurSheet(null, { name: x.name, kind: 'expense', amt: x.amt, from: x.acct && acctById(x.acct) ? x.acct : defAcct(c), every: 1, start: monthAdd(isoMonth(new Date()), 1), cat: x.cat || 'Bills' }); return; }
    const e = records[x.lastId]; if (!e) return;
    e.recurring = true; put(e); renderSubs(); toast(`“${x.name}” now repeats every month in the Ledger.`, 'Undo', () => { e.recurring = false; put(e); renderSubs(); });
  }));
  $$('[data-sub-no]', box).forEach(b => b.addEventListener('click', () => {
    const x = L[+b.dataset.subNo], c = subsCfg() || { id: SUBS_ID, type: 'subscfg', no: [], deleted: false };
    put({ ...c, no: [...new Set([...(c.no || []), x.k])], deleted: false }); renderSubs();
  }));
  if ($('subUndo')) $('subUndo').addEventListener('click', () => { const c = subsCfg(); if (c) { put({ ...c, no: [] }); renderSubs(); } });
}

