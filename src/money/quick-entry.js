/* ==========================================================================
   MONEY — quick text entry ("250 chai"), repeat-last / recent
   ======================================================================== */
const MQ_KIND = { income: /^(received|recd|rcvd|got|income|salary|refund|cashback)$/i, lent: /^(lent|gave|diya|loaned)$/i, borrowed: /^(borrowed|took|liya)$/i, paidby: /^(paidby|pb)$/i, transfer: /^(transfer|tfr)$/i };
const MQ_KEEP = /^(salary|refund|cashback)$/i;                 // also a good description
const MQ_FILL = /^(for|on|to|at|from|in|of|the)$/i;
const MQ_MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
function knownPeople() {
  const m = new Map(), add = n => { n = String(n || '').trim(); if (n && !m.has(n.toLowerCase())) m.set(n.toLowerCase(), n); };
  all('fin').forEach(e => add(e.who));
  try { docPeople().forEach(add); } catch (e) {}
  Object.keys(PERSON_ALIAS).forEach(k => { if (!m.has(k)) m.set(k, PERSON_ALIAS[k]); });
  return m;
}
function findAcct(word, forced) {
  if (!hasAccts()) return null;
  const L = accts(), w = normName(word); if (w.length < 2) return null;
  const exact = L.filter(a => normName(a.name) === w); if (exact.length === 1) return exact[0];
  if (forced) {                                               // "@hdfc": any account whose name contains it
    const hits = L.filter(a => normName(a.name).includes(w)); if (!hits.length) return null;
    const last = lastAcct('expense'); return hits.find(a => a.id === last) || hits[0];
  }
  // a plain word counts only when it is a whole word of exactly one account's name ("icici", "cash"), never a person's name
  const tok = String(word).toLowerCase();
  if (tok.length < 3 || knownPeople().has(tok)) return null;
  const hits = L.filter(a => String(a.name).toLowerCase().split(/[^a-z0-9]+/).includes(tok));
  return hits.length === 1 ? hits[0] : null;
}
function parseMoneyLine(text) {
  const out = { amount: NaN, kind: 'expense', desc: '', who: '', acct: null, to: null, cat: '', date: todayISO(), ambiguous: '' };
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) { out.error = 'Type a line first.'; return out; }
  let toks = raw.split(' ');
  if (/^\+/.test(toks[0])) { out.kind = 'income'; toks[0] = toks[0].slice(1); if (!toks[0]) toks.shift(); }
  toks = toks.filter(t => !/^(₹|rs\.?|inr)$/i.test(t));
  const used = new Set();
  const isNum = t => /\d/.test(t) && /^(₹|rs\.?|inr)?[\d.,+\-*/x×÷()%]+(₹|rs|\/-)?$/i.test(t);
  const numVal = t => calcAmount(t.replace(/^(₹|rs\.?|inr)/i, '').replace(/(rs|\/-|₹)$/i, ''));
  const dayMon = t => { const m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/); return m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12 ? m : null; };
  const pastISO = (iso, hasYear) => { if (!iso || hasYear || iso <= todayISO()) return iso; const y = +iso.slice(0, 4) - 1, d = new Date(y, +iso.slice(5, 7) - 1, +iso.slice(8, 10)); return d.getMonth() === +iso.slice(5, 7) - 1 ? isoLocal(d) : iso; };
  // the amount: the first number that is not a date ("15/9"), unless it is the only number
  const nums = toks.map((t, i) => [t, i]).filter(([t]) => isNum(t) && !isNaN(numVal(t)));
  const dayBeforeMon = i => /^\d{1,2}$/.test(toks[i]) && i + 1 < toks.length && new RegExp('^' + MQ_MON + '$', 'i').test(toks[i + 1]);   // "15 sep"
  const plain = nums.filter(([t, i]) => !dayMon(t) && !dayBeforeMon(i));
  const ai = plain.length ? plain[0][1] : nums.length === 1 ? nums[0][1] : -1;
  if (ai < 0) { out.error = 'No amount found — start with a number, like “250 chai”.'; return out; }
  out.amount = Math.round(numVal(toks[ai]) * 100) / 100; used.add(ai);
  if (!(out.amount > 0)) { out.error = 'The amount must be more than ₹0.'; return out; }
  // what kind: a word near the start
  if (out.kind === 'expense') for (let i = 0; i < Math.min(toks.length, 3); i++) {
    if (used.has(i)) continue; const k = Object.keys(MQ_KIND).find(x => MQ_KIND[x].test(toks[i]));
    if (k) { out.kind = k; if (!MQ_KEEP.test(toks[i])) used.add(i); break; }
  }
  // dates: today / yday / 15sep / 15-sep / sep15 / 15 sep / 15/9 (a day already past this year, not next year)
  for (let i = 0; i < toks.length; i++) {
    if (used.has(i)) continue; const t = toks[i].toLowerCase().replace(/[,]$/, '');
    let iso = null, yr = false;
    if (/^(today|tod)$/.test(t)) iso = todayISO();
    else if (/^(yday|yest|yesterday)$/.test(t)) iso = addDays(-1);
    else if (dayMon(t)) { iso = parseDateToken(t); yr = !!dayMon(t)[3]; }
    else if (new RegExp('^\\d{1,2}(st|nd|rd|th)?-?' + MQ_MON + '(-?\\d{2,4})?$').test(t) || new RegExp('^' + MQ_MON + '-?\\d{1,2}$').test(t)) { iso = parseDateToken(t.replace(/(st|nd|rd|th)(?=[a-z])/, '')); yr = /\d{2,4}$/.test(t) && /[a-z]-?\d{2,4}$/.test(t) && !new RegExp('^' + MQ_MON + '-?\\d{1,2}$').test(t); }
    else if (new RegExp('^' + MQ_MON + '$').test(t) && i > 0 && !used.has(i - 1) && /^\d{1,2}(st|nd|rd|th)?$/.test(toks[i - 1])) { iso = parseDateToken(toks[i - 1].replace(/\D/g, '') + t.slice(0, 3)); if (iso) used.add(i - 1); }
    if (iso) { out.date = pastISO(iso, yr); used.add(i); }
  }
  // #category, @account
  const ats = [];
  toks.forEach((t, i) => {
    if (used.has(i)) return;
    if (/^#\S+/.test(t)) { const c = FIN_CATS.find(x => x.toLowerCase().startsWith(t.slice(1).toLowerCase())); if (c) { out.cat = c; used.add(i); } }
    else if (/^@\S+/.test(t)) { const a = findAcct(t.slice(1), true); if (a) { ats.push(a); used.add(i); } }
  });
  // plain words that name one account, or (for udhaar) a person you know
  const people = knownPeople();
  toks.forEach((t, i) => {
    if (used.has(i) || MQ_FILL.test(t)) return;
    const w = t.replace(/[.,;:!?]+$/, '');
    if (isUdhaar(out.kind) && !out.who && people.has(w.toLowerCase())) { out.who = people.get(w.toLowerCase()); used.add(i); return; }
    if (ats.length < 2) { const a = findAcct(w, false); if (a && !ats.includes(a)) { ats.push(a); used.add(i); } }
  });
  if (ats[0]) out.acct = ats[0].id;
  if (out.kind === 'transfer') { if (ats[1]) out.to = ats[1].id; }
  let rest = toks.filter((t, i) => !used.has(i));
  while (rest.length && MQ_FILL.test(rest[0])) rest.shift();
  while (rest.length && MQ_FILL.test(rest[rest.length - 1])) rest.pop();
  if (isUdhaar(out.kind) && !out.who && rest.length) { const w = rest.pop(); out.who = w.charAt(0).toUpperCase() + w.slice(1); }   // "lent 2000 Ravi": the last word is the person
  out.desc = rest.filter(t => !(out.kind === 'transfer' && MQ_FILL.test(t))).join(' ').trim();
  if (!out.cat && out.kind !== 'transfer') out.cat = guessFinCat(out.desc);
  if (out.kind === 'transfer' && hasAccts() && (!out.acct || !out.to)) out.error = 'A transfer needs two accounts, like “transfer 5000 @sbi @hdfc”.';
  if (out.kind === 'transfer' && !hasAccts()) out.error = 'Set up your accounts first (Money → Accounts) to record transfers.';
  if (isUdhaar(out.kind) && !out.who) out.error = 'Who is it with? Add the name, like “lent 2000 Ravi”.';
  return out;
}
function moneyLineText(q) {
  const k = (KINDS.find(x => x.v === q.kind) || KINDS[0]).l.replace(/ \(.*\)$/, '');
  const route = q.kind === 'transfer' ? `${acctName(q.acct)} → ${acctName(q.to)}` : q.acct ? (q.kind === 'expense' || q.kind === 'lent' ? 'from ' : 'into ') + acctName(q.acct) : '';
  return [`<b>${esc(k)} ${esc(fmtMoney(q.amount))}</b>`, q.desc ? esc(q.desc) : '', q.who ? '👤 ' + esc(q.who) : '', q.cat ? esc(q.cat) : '', q.date !== todayISO() ? '📅 ' + esc(fmtDate(q.date, true)) : '', route ? esc(route) : ''].filter(Boolean).join(' · ');
}
/* v2.21 (D4): split a bill — you paid the whole amount; your share is spending, each other share is udhaar diya */
const splitNames = () => [...new Set(String(($('afSplit') && $('afSplit').value) || '').split(/[,;&]+|\band\b/i).map(x => x.trim()).filter(Boolean).map(x => x.charAt(0).toUpperCase() + x.slice(1)))].slice(0, 12);
function splitShares(total, n) { const share = Math.floor(total / (n + 1) * 100) / 100; return { share, mine: Math.round((total - share * n) * 100) / 100 }; }
function splitSave(x) {
  const names = splitNames(), T = +x.amount;
  if (!(T > 0)) { toast('Enter an amount.'); return null; }
  const { share, mine } = splitShares(T, names.length), desc = String(x.desc || '').trim() || 'Shared bill';
  const me = saveMoneyEntry({ amount: mine, kind: 'expense', desc: desc + ` (my share of ${rs(T)})`, cat: x.cat, date: x.date, acct: x.acct });
  if (!me) return null;
  const made = [me.id];
  names.forEach(p => { const e = saveMoneyEntry({ amount: share, kind: 'lent', desc: desc + ' (split)', who: p, date: x.date, acct: me.acct || x.acct }); if (e) made.push(e.id); });
  toast(`Split ${rs(T)}: your share ${rs(mine)}, ${names.join(', ')} owe${names.length === 1 ? 's' : ''} ${rs(share)} each.`, 'Undo', () => { made.forEach(id => softDelete(id, { render: false })); scheduleRender(); }, 8000);
  return me;
}
/* one place that writes a Ledger entry — used by the quick line and the form */
function saveMoneyEntry(x) {
  const fail = (msg, el) => { toast(msg); if (x.fromForm && el && $(el)) $(el).focus(); return null; };
  const amt = +x.amount;
  if (!isFinite(amt) || !(amt > 0)) return fail('Enter an amount.', 'afAmt');
  const kind = KINDS.some(k => k.v === x.kind) ? x.kind : 'expense', who = String(x.who || '').trim();
  if (isUdhaar(kind) && !who) return fail(kind === 'paidby' ? 'Who paid for it?' : 'Who is it with?', 'afWho');
  let acct = x.acct || undefined, to = kind === 'transfer' ? (x.to || undefined) : undefined;
  if (kind === 'paidby') {                                     // v2.20: someone else paid — no account moves today
    const date = ISO_DATE_RX.test(x.date || '') ? x.date : todayISO();
    return put({ id: x.id || uid('f'), type: 'fin', desc: String(x.desc || '').trim().slice(0, 200) || 'Spent', amount: Math.round(amt * 100) / 100, kind: 'expense', paidBy: 1,
      category: FIN_CATS.includes(x.cat) ? x.cat : '', date, who, recurring: false, paidAmount: 0, settled: false, deleted: false });
  }
  if (hasAccts()) {
    if (!acct || !acctById(acct)) { const l = lastAcct(isUdhaar(kind) ? 'udhaar' : kind), la = l && acctById(l); acct = la && !la.archived ? l : (defAcct(planCfg()) || undefined); }
    if (kind === 'transfer') { if (!to || !acctById(to)) return fail('A transfer needs two accounts.'); if (acct === to) return fail('Pick two different accounts.'); }
  } else { if (kind === 'transfer') return fail('Set up your accounts first (Money → Accounts).'); acct = undefined; to = undefined; }
  if (acct) { rememberAcct(isUdhaar(kind) ? 'udhaar' : kind, acct); if (to) rememberAcct('transferTo', to); }
  const date = ISO_DATE_RX.test(x.date || '') ? x.date : todayISO();
  const desc = String(x.desc || '').trim().slice(0, 200) || (kind === 'expense' ? 'Spent' : kind === 'income' ? 'Received' : kind === 'transfer' ? 'Transfer' : 'Udhaar');
  return put({ id: x.id || uid('f'), type: 'fin', desc, amount: Math.round(amt * 100) / 100, kind, category: kind === 'transfer' ? '' : (FIN_CATS.includes(x.cat) ? x.cat : ''), date,
    who: isUdhaar(kind) ? who : '', acct, to, recurring: !!x.recurring, paidAmount: 0, settled: false, deleted: false, ...(kind === 'expense' && x.goal && records[x.goal] ? { goal: x.goal } : {}) });
}
/* the last distinct entries you made (what, type, category, account), newest first */
function moneyRecents() {
  const seen = new Set(), out = [];
  all('fin').filter(e => !e.planRef && !e.recurSrc && !e.billRef && +e.amount > 0).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).some(e => {
    const k = [String(e.desc || '').toLowerCase().trim(), e.kind, e.category || '', e.acct || '', e.to || '', String(e.who || '').toLowerCase()].join('|');
    if (!seen.has(k)) { seen.add(k); out.push(e); }
    return out.length >= 8;
  });
  return out;
}

