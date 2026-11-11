const T = require('./_log')('udhaar-plan.test');
/* v2.37: a person's ledger agrees with their total; a checked month drops what was not ticked; savings interest. */
let load, path;
try { ({ load } = require('./harness')); path = require('path'); } catch (e) { T.crash(e); }
const h = load(path.join(__dirname, '..', 'app.js'), '2026-11-11T12:00:00+05:30');
if (h.errs.length) T.crash(new Error('app.js did not load: ' + h.errs.join('; ')));
const res = JSON.parse(h.run(`(() => {
  const R = [], ok = (n, v, d) => R.push([n, !!v, d || '']);
  const add = r => { records[r.id] = Object.assign({ deleted: false, updatedAt: 1, createdAt: 1 }, r); };
  add({ id: 'plan-cfg', type: 'plancfg', startMonth: '2026-08', defAcct: 'a_sbi' });
  add({ id: 'a_sbi', type: 'acct', kind: 'bank', name: 'RK SBI', open: 100000 });
  add({ id: 'a_cash', type: 'acct', kind: 'cash', name: 'RKC', open: 5000 });
  let n = 0; const f = (o, id) => add(Object.assign({ id: id || 'f' + (++n), type: 'fin', paidAmount: 0, settled: false, createdAt: ++n }, o));
  /* Jiten, as in the screenshot */
  f({ kind: 'borrowed', who: 'Jiten', amount: 4000, date: '2026-08-24', desc: '4', paidAmount: 4000, settled: true });
  f({ kind: 'borrowed', who: 'Jiten', amount: 2500, date: '2026-08-26', desc: 'Lent', paidAmount: 1000, pays: [{ date: '2026-11-01', amt: 750 }, { date: '2026-11-11', amt: 250 }] });
  f({ kind: 'borrowed', who: 'Jiten', amount: 250, date: '2026-09-15', desc: 'Aise Hi', paidAmount: 250, settled: true, pays: [{ date: '2026-10-10', amt: 100 }, { date: '2026-10-10', amt: 50 }, { date: '2026-10-19', amt: 100 }] }, 'j_o');
  f({ kind: 'borrowed', who: 'Jiten', amount: 3000, date: '2026-09-17', desc: 'Aise Hi' });
  f({ kind: 'lent', who: 'Jiten', amount: 400, date: '2026-09-22', desc: 'Aise Hi', paidAmount: 400, settled: true, pays: [{ date: '2026-10-09', amt: 250 }, { date: '2026-10-10', amt: 150 }] });
  f({ kind: 'lent', who: 'Jiten', amount: 250, date: '2026-10-19', desc: 'Extra when settling: Aise Hi', origin: 'j_o', paidAmount: 250, settled: true });
  /* someone else, with a dated repayment of the extra */
  f({ kind: 'lent', who: 'Raj', amount: 1000, date: '2026-09-01', paidAmount: 1000, settled: true, pays: [{ date: '2026-09-20', amt: 1000 }] }, 'r_o');
  f({ kind: 'borrowed', who: 'Raj', amount: 300, date: '2026-09-20', desc: 'Extra when settling', origin: 'r_o', paidAmount: 100, pays: [{ date: '2026-10-05', amt: 100 }] });
  storeVer++;
  const G = udhGroups();
  G.forEach(g => { const rows = udhPersonRows(g.k), last = rows.length ? rows[rows.length - 1].bal : 0;
    ok(g.name + ': ledger balance = person total', Math.abs(last - g.bal) < 0.01, last + ' vs ' + g.bal); });
  const J = udhPersonRows('jiten');
  ok('Jiten: you owe 4,500', Math.abs(J[J.length - 1].bal + 4500) < 0.01);
  ok('Jiten: the extra 250 being settled is a row', J.some(r => r.id && records[r.id] && records[r.id].origin === 'j_o' && r.v === -250));
  ok('Jiten: the extra is not counted twice as given', J.filter(r => r.id && records[r.id] && records[r.id].origin === 'j_o' && r.v > 0).length === 1);
  const Rj = udhPersonRows('raj');
  ok('Raj: dated repayment of the extra on 5 Oct', Rj.some(r => r.date === '2026-10-05' && r.v === 100));

  /* a checked month: the ATM withdrawal you did not tick did not happen */
  add({ id: 'rc_atm', type: 'recur', kind: 'transfer', name: 'ATM withdrawal', amt: 4000, every: 1, start: '2026-08', from: 'a_sbi', to: 'a_cash' });
  ['2026-08', '2026-09'].forEach(m => add({ id: 'pm-' + m, type: 'planmonth', v: 3, month: m, items: { 'r:rc_atm': { done: false, skip: true } }, extra: [], checked: {}, closed: true }));
  add({ id: 'pm-2026-10', type: 'planmonth', v: 3, month: '2026-10', items: {}, extra: [], checked: {}, closed: true });
  storeVer++;
  const c = planCfg();
  const P = planCompute(c, '2026-10'), A = planCompute(c, '2026-10', 'actual');
  ok('checked Oct: Plan RKC = actual RKC', P[P.length - 1].accts.a_cash === A[A.length - 1].accts.a_cash, P[P.length - 1].accts.a_cash + ' vs ' + A[A.length - 1].accts.a_cash);
  let S = stmtData(c, 'a_cash', '2026-10', '2026-10');
  const lines = m => (m.inn || []).concat(m.out || []).map(l => l.label).join(' | ');
  ok('checked Oct: no ATM line in the RKC statement', !/ATM/.test(lines(S.months[0])), lines(S.months[0]));
  records['pm-2026-10'].closed = false; storeVer++;
  S = stmtData(c, 'a_cash', '2026-10', '2026-10');
  ok('Oct not checked: the line says “planned · not ticked”', /ATM withdrawal.*planned · not ticked/.test(lines(S.months[0])), lines(S.months[0]));
  records['pm-2026-10'].closed = true; storeVer++;
  ok('the current month still plans it', planCompute(c, '2026-11').slice(-1)[0].accts.a_cash - planCompute(c, '2026-11', 'actual').slice(-1)[0].accts.a_cash === 4000);

  /* savings interest */
  records.a_sbi.int = { rate: 3.6, amt: 0, every: 1, from: '2026-11' }; storeVer++;
  let rows = planCompute(c, '2027-01');
  const nov = rows.find(r => r.ym === '2026-11'), dec = rows.find(r => r.ym === '2026-12'), oct = rows.find(r => r.ym === '2026-10');
  const startDec = nov.accts.a_sbi;
  ok('Dec estimate = start balance × 3.6% ÷ 12', dec.intEst.a_sbi === Math.round(startDec * 0.003), dec.intEst.a_sbi + ' vs ' + Math.round(startDec * 0.003));
  ok('no interest before the month it was set', !oct.intEst.a_sbi);
  ok('the estimate is income', dec.inc >= dec.intEst.a_sbi);
  f({ kind: 'income', amount: 211, date: '2026-11-30', acct: 'a_sbi', desc: 'Int.Pd', category: 'Interest' }); storeVer++;
  const it = planItems(c, '2026-11').find(i => i.key === 'int:a_sbi');
  ok('interest you entered counts as done, at its amount', it && it.done && it.a === 211);
  ok('…and is not added twice', planCompute(c, '2026-11').slice(-1)[0].inc === planCompute(c, '2026-11', 'actual').slice(-1)[0].inc, String(planCompute(c, '2026-11').slice(-1)[0].inc));
  records.a_sbi.int = { rate: 0, amt: 300, every: 3, from: '2026-11' }; storeVer++;
  rows = planCompute(c, '2027-04');
  ok('every 3 months: Dec and Mar only, fixed ₹300', rows.filter(r => r.ym > '2026-11').map(r => r.intEst.a_sbi || 0).join(',') === '300,0,0,300,0', rows.filter(r => r.ym > '2026-11').map(r => r.intEst.a_sbi || 0).join(','));
  delete records.a_sbi.int; storeVer++;
  return JSON.stringify(R);
})()`));
res.forEach(([n, v, d]) => T.ok(n, v, d));
T.done();
