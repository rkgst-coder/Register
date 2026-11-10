const T = require('./_log')('money.test');
/* Money arithmetic on made-up data: the Ledger, Plan and Accounts must agree with each other, month by month. */
let load;
try { ({ load } = require('./harness')); } catch (e) { T.crash(e); }
const path = require('path');
const h = load(path.join(__dirname, '..', 'app.js'), '2026-11-10T12:00:00+05:30');
if (h.errs.length) T.crash(new Error('app.js did not load: ' + h.errs.join('; ')));
const lines = JSON.parse(h.run(`(() => { const R = []; const add = r => { records[r.id] = Object.assign({ deleted: false, updatedAt: 1, createdAt: 1 }, r); };
  add({ id: 'plan-cfg', type: 'plancfg', startMonth: '2026-08', defAcct: 'a_sbi' });
  add({ id: 'a_sbi', type: 'acct', kind: 'bank', name: 'SBI', open: 100000 });
  add({ id: 'a_cash', type: 'acct', kind: 'cash', name: 'Cash', open: 5000 });
  add({ id: 'a_card', type: 'acct', kind: 'card', name: 'Card', open: 2000 });
  add({ id: 'a_mf', type: 'acct', kind: 'mf', name: 'MF', open: 50000 });
  let n = 0; const f = o => add(Object.assign({ id: 'f' + (++n), type: 'fin', who: '', paidAmount: 0, settled: false }, o));
  // September
  f({ kind: 'income', amount: 80000, date: '2026-09-01', acct: 'a_sbi', desc: 'Salary', category: 'Salary' });
  f({ kind: 'expense', amount: 12000, date: '2026-09-05', acct: 'a_sbi', desc: 'Rent', category: 'Rent' });
  f({ kind: 'expense', amount: 3000, date: '2026-09-07', acct: 'a_card', desc: 'Fuel', category: 'Fuel' });
  f({ kind: 'expense', amount: 1500, date: '2026-09-09', desc: 'No account tagged', category: 'Food' });
  f({ kind: 'expense', amount: 5000, date: '2026-09-10', acct: 'a_sbi', desc: 'SIP typed as spending', category: 'Investment', invTo: 'a_mf' });
  f({ kind: 'transfer', amount: 10000, date: '2026-09-11', acct: 'a_sbi', to: 'a_mf', desc: 'To MF' });
  f({ kind: 'transfer', amount: 2000, date: '2026-09-12', acct: 'a_sbi', to: 'a_card', desc: 'Card bill' });
  f({ kind: 'transfer', amount: 4000, date: '2026-09-13', acct: 'a_sbi', to: 'a_cash', desc: 'ATM' });
  f({ kind: 'expense', amount: 2500, date: '2026-09-15', paidBy: 1, who: 'Amit', desc: 'Dinner paid by Amit', category: 'Food', paidAmount: 0 });
  f({ kind: 'lent', amount: 6000, date: '2026-09-16', acct: 'a_sbi', who: 'Raj', desc: 'Lent', paidAmount: 2000, pays: [{ date: '2026-10-03', amt: 2000, acct: 'a_cash' }] });
  f({ kind: 'expense', amount: 700, date: '2026-09-30', acct: 'a_sbi', desc: 'Unrecorded spending (balance check)', category: 'Adjustment' });
  // October
  f({ kind: 'income', amount: 80000, date: '2026-10-01', acct: 'a_sbi', desc: 'Salary', category: 'Salary' });
  f({ kind: 'expense', amount: 900, date: '2026-10-04', acct: 'a_cash', desc: 'Veg', category: 'Food' });
  storeVer++;
  const c = planCfg(), T = [], ok = (n, v, d) => T.push([n, !!v, d || '']);
  const rows = planCompute(c, '2026-11', 'actual');
  for (const ym of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    const M = monthFigures(all('fin').filter(e => (e.date || '').slice(0, 7) === ym)), r = rows.find(x => x.ym === ym);
    ok(ym + ' Plan spending = Ledger spent', Math.abs(r.exp - M.out) < 0.01, r.exp + ' vs ' + M.out);
    if (ym < '2026-11') { const B = balancesOn(c, monthEnd(ym)); ok(ym + ' Plan money = Accounts as-on money', Math.abs(B.money - r.worth) < 0.01, r.worth + ' vs ' + B.money); }
    { const W = monthWalk(c, ym); ok(ym + ' walk adds up', W && Math.abs(W.gap) < 0.01, W ? JSON.stringify({ open: W.open, inc: W.inc, spent: W.spent, invest: W.invest, udh: W.udh, other: W.other, close: W.close, gap: W.gap, unrec: W.unrec, paidBy: W.paidBy }) : 'null');
      ok(ym + ' walk spent + paidBy = Ledger spent', W && Math.abs(W.spent + W.paidBy - M.out) < 0.01); }
  }
  // saved = change in money (accounts + udhaar), month on month, when nothing is estimated
  for (let i = 1; i < rows.length - 1; i++) ok(rows[i].ym + ' received − spent − Δmoney = 0', Math.abs((rows[i].inc - rows[i].exp) - (rows[i].worth - rows[i - 1].worth)) < 0.01, (rows[i].inc - rows[i].exp) + ' vs ' + (rows[i].worth - rows[i - 1].worth));
  {
    const A = id => acctById(id);
    let P = closePlan([{ a: A('a_sbi'), d: -4700 }, { a: A('a_cash'), d: 4000 }], true);
    ok('ATM case: one move 4000, spending 700, no income', P.moves.length === 1 && P.moves[0].amt === 4000 && P.moves[0].from.id === 'a_sbi' && P.spend.length === 1 && P.spend[0].amt === 700 && !P.income.length, JSON.stringify(P.moves.map(m => m.amt)) + JSON.stringify(P.spend.map(m => m.amt)));
    P = closePlan([{ a: A('a_sbi'), d: -4700 }, { a: A('a_cash'), d: 4000 }], false);
    ok('unpaired: spending 4700 and income 4000', !P.moves.length && P.spend[0].amt === 4700 && P.income[0].amt === 4000);
    P = closePlan([{ a: A('a_sbi'), d: -2000.5 }, { a: A('a_card'), d: 2000.5 }, { a: A('a_cash'), d: -310.25 }], true);
    ok('card bill + cash spend', P.moves.length === 1 && P.moves[0].to.id === 'a_card' && P.spend.length === 1 && P.spend[0].amt === 310.25 && !P.income.length);
    P = closePlan([{ a: A('a_sbi'), d: 500 }, { a: A('a_cash'), d: 120 }], true);
    ok('both over: two incomes', !P.moves.length && !P.spend.length && P.income.length === 2);
    // net is the same whatever the pairing
    const D = [{ a: A('a_sbi'), d: -9000 }, { a: A('a_cash'), d: 2500 }, { a: A('a_card'), d: 1000 }];
    const n = Q => Q.income.reduce((t, x) => t + x.amt, 0) - Q.spend.reduce((t, x) => t + x.amt, 0);
    ok('net identical paired / unpaired', n(closePlan(D, true)) === n(closePlan(D, false)) && n(closePlan(D, true)) === -5500);
  }
  
  // the Ledger's own row for money coming back, and the fund link
  ok('fund got the linked Investment entry', planCompute(c, '2026-09', 'actual').slice(-1)[0].accts.a_mf === 65000);
  // one clock: stamps follow the server's time, small differences are ignored
  clockLearn(Date.now() + 180000, Date.now() - 100, Date.now() + 100);
  ok('a clock 3 minutes behind is learned', Math.abs(clockOff - 180000) < 500, String(clockOff));
  const t = put({ id: 'tclock1', type: 'task', title: 'x' }, { render: false });
  ok('changes are stamped in server time', Math.abs(t.updatedAt - (Date.now() + 180000)) < 1500);
  const before = t.updatedAt; clockLearn(Date.now() + 2000, Date.now() - 100, Date.now() + 100);
  ok('under 5 seconds counts as no difference', clockOff === 0, String(clockOff));
  put(t, { render: false }); ok('a stamp never goes backwards', t.updatedAt > before);
  clockLearn(Date.now() - 7200000, Date.now() - 9000, Date.now()); ok('a slow answer is not used to set the clock', clockOff === 0);
  clockLearn(Date.now() - 7200000, Date.now() - 100, Date.now() + 100); ok('a clock 2 hours ahead is learned', Math.abs(clockOff + 7200000) < 500);
  clockLearn(Date.now(), Date.now() - 100, Date.now() + 100);
  return JSON.stringify(T);
})()`));
lines.forEach(([n, v, d]) => T.ok(n, v, d));
T.done();
