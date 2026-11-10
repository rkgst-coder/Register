const T = require('./_log')('ui.test');
/* The real app in a real browser at iPhone size, on made-up data: month summary, one-tap check-up, udhaar payments,
   fund link, and the backup reminder. Needs Playwright (npm ci) and a Chromium/Chrome. */
let chromium, http, fs, path;
try { http = require('http'); fs = require('fs'); path = require('path'); } catch (e) { T.crash(e); }
try { ({ chromium } = require('playwright')); } catch (e) { T.info('playwright missing: ' + e.message); console.error('ui.test: Playwright is not installed. Run: npm ci'); process.exit(1); }
const ROOT = path.join(__dirname, '..'), SHOTS = path.join(__dirname, 'shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(buf); });
});
const shot = async (page, name) => { try { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) { T.info('screenshot ' + name + ': ' + e.message); } };
async function fresh(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  return { ctx, page, errs };
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const exe = process.env.CHROME_PATH || (fs.existsSync('/usr/bin/google-chrome') && !process.env.CI ? '/usr/bin/google-chrome' : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8')) && (fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];

  /* ---- 1. month summary and the one-tap check-up ---- */
  { const { ctx, page, errs } = await fresh(browser);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    hideDecoy();
    await setupFinance('test-code-1234');
    const add = r => put(Object.assign({ deleted: false }, r), { render: false });
    add({ id: 'plan-cfg', type: 'plancfg', startMonth: '2026-08', defAcct: 'a_sbi' });
    add({ id: 'a_sbi', type: 'acct', kind: 'bank', name: 'RK SBI', open: 100000 });
    add({ id: 'a_cash', type: 'acct', kind: 'cash', name: 'RKC', open: 5000 });
    add({ id: 'a_card', type: 'acct', kind: 'card', name: 'Card', open: 2000 });
    add({ id: 'a_mf', type: 'acct', kind: 'mf', name: 'MF', open: 50000 });
    let n = 0; const f = o => add(Object.assign({ id: 'ftest' + (++n), type: 'fin', who: '', paidAmount: 0, settled: false }, o));
    f({ kind: 'income', amount: 80000, date: '2026-10-01', acct: 'a_sbi', desc: 'Salary', category: 'Salary' });
    f({ kind: 'expense', amount: 12000, date: '2026-10-05', acct: 'a_sbi', desc: 'Rent', category: 'Household' });
    f({ kind: 'expense', amount: 2500, date: '2026-10-15', paidBy: 1, who: 'Amit', desc: 'Dinner', category: 'Food' });
    f({ kind: 'transfer', amount: 10000, date: '2026-10-11', acct: 'a_sbi', to: 'a_mf', desc: 'To MF' });
    ['2026-08', '2026-09'].forEach(m => add({ id: 'pm-' + m, type: 'planmonth', v: 3, month: m, items: {}, extra: [], checked: {}, closed: true }));
    setPref('moneySeg', 'ledger'); finMonth = '2026-10'; showTab('money'); renderMoney();
  });
  await page.waitForTimeout(600);
  const flag = await page.locator('[data-lf="sum"]').innerText().catch(() => '');
  T.ok('Ledger shows the summary row for October', /October 2026/.test(flag) && /balances not checked/.test(flag), flag.replace(/\n/g, ' | '));
  await shot(page, 'shot1-ledger');
  await page.locator('[data-lf="sum"]').click(); await page.waitForTimeout(500);
  let txt = await page.locator('#pshBody').innerText();
  T.ok('summary: spent 14,500 with paid-by 2,500', /Spent\s*₹14,500/.test(txt) && /paid by someone for you\s*[\s\S]*₹2,500/.test(txt));
  T.ok('summary: not-checked banner', /Balances not checked/.test(txt));
  await shot(page, 'shot2-summary-before');
  await page.locator('#mcGo').click(); await page.waitForTimeout(500);
  T.ok('check-up sheet opened', /Monthly check-up/.test(await page.locator('#pshTitle').innerText()));
  // app says: SBI 158000, cash 5000, card owed 2000. Reality: 4000 withdrawn, 700 of it spent in cash; 1800 UPI not entered; card bill 2000 paid from bank; 900 new card spend
  await page.fill('#ck_a_sbi', '150200'); await page.fill('#ck_a_cash', '8300'); await page.fill('#ck_a_card', '900');
  await page.locator('#pmAll').click(); await page.waitForTimeout(500);
  txt = await page.locator('#mcPlan').innerText();
  T.ok('plan lists moves and one net spending', /Moved RK SBI → RKC/.test(txt) && /Moved RK SBI → Card/.test(txt) && /Spending not entered: ₹3,400/.test(txt) && !/Income not entered/.test(txt), txt.replace(/\n+/g, ' | ').slice(0, 420));
  await shot(page, 'shot3-plan');
  await page.locator('#mcPair').uncheck(); await page.waitForTimeout(200);
  txt = await page.locator('#mcPlan').innerText();
  T.ok('unticked: spending 7,800 and income 4,400', /Spending not entered: ₹7,800/.test(txt) && /Income not entered: ₹4,400/.test(txt));
  await page.locator('#mcPair').check(); await page.waitForTimeout(200);
  await page.locator('#mcOk').click(); await page.waitForTimeout(700);
  const R = await page.evaluate(() => { const c = planCfg(), row = planCompute(c, '2026-10', 'actual').slice(-1)[0], W = monthWalk(c, '2026-10');
    const M = monthFigures(all('fin').filter(e => (e.date || '').slice(0, 7) === '2026-10'));
    return { sbi: row.accts.a_sbi, cash: row.accts.a_cash, card: row.accts.a_card, out: M.out, inc: M.inc, unrec: W.unrec, gap: W.gap, nOff: W.nOff, nChecked: W.nChecked, closed: pmGet('2026-10').closed, planExp: row.exp, n: all('fin').length }; });
  T.ok('accounts now match what was typed', R.sbi === 150200 && R.cash === 8300 && R.card === -900, JSON.stringify(R));
  T.ok('spent 17,900 = 14,500 + 3,400; income unchanged', R.out === 17900 && R.inc === 80000 && R.unrec === 3400 && R.planExp === 17900);
  T.ok('month marked checked, nothing off', R.closed === true && R.nOff === 0 && R.nChecked === 3 && Math.abs(R.gap) < 0.01);
  txt = await page.locator('#pshBody').innerText();
  T.ok('summary after: matched line and split', /3 of 3 accounts matched/.test(txt) && /not entered[\s\S]*₹3,400/.test(txt) && /entered by you\s*₹12,000/.test(txt), '');
  await shot(page, 'shot4-summary-after');
  // undo
  await page.locator('.toast button, #toast button').first().click().catch(() => {}); await page.waitForTimeout(500);
  const U = await page.evaluate(() => ({ n: all('fin').length, closed: pmGet('2026-10').closed }));
  T.ok('Undo removes the 3 entries and re-opens the month', U.n === R.n - 3 && U.closed === false, JSON.stringify(U));
  // all-match path
  await page.evaluate(() => { planMonthSheet('2026-10'); }); await page.waitForTimeout(300);
  await page.fill('#ck_a_sbi', '158000'); await page.fill('#ck_a_cash', '5000'); await page.fill('#ck_a_card', '2000');
  await page.locator('#pmAll').click(); await page.waitForTimeout(500);
  txt = await page.locator('#pshBody').innerText();
  T.ok('all matching: straight to summary, nothing recorded', /3 of 3 accounts matched/.test(txt) && (await page.evaluate(() => all('fin').length)) === U.n);
  // Plan tab and old per-row Fix still render
  await page.evaluate(() => { Sheets.close('shPlan', true); setPref('moneySeg', 'plan'); renderMoney(); }); await page.waitForTimeout(400);
  T.ok('Plan tab renders', /Oct/.test(await page.locator('#panePlan').innerText()));
  await page.evaluate(() => { planMonthSheet('2026-10'); }); await page.waitForTimeout(300);
  await page.fill('#ck_a_sbi', '157000'); await page.locator('[data-fix="a_sbi"]').click(); await page.waitForTimeout(300);
  T.ok('old one-account Fix still opens', /What was it/.test(await page.locator('#fixBox').innerText()));

    T.ok('page and app.js are the same version, the one in sw.js', await page.evaluate(() => APP_VERSION + '/' + PAGE_VERSION) === want + '/' + want);
    T.ok('no errors on the page (month)', errs.length === 0, errs.join(' ; ').slice(0, 300));
    await ctx.close(); }

  /* ---- 2. udhaar as a ledger, fund link ---- */
  { const { ctx, page, errs } = await fresh(browser);
  await page.goto(BASE + '/index.html'); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    hideDecoy(); await setupFinance('test-code-1234');
    const add = r => put(Object.assign({ deleted: false }, r), { render: false });
    add({ id: 'plan-cfg', type: 'plancfg', startMonth: '2026-08', defAcct: 'a_sbi' });
    add({ id: 'a_sbi', type: 'acct', kind: 'bank', name: 'RK SBI', open: 100000 });
    add({ id: 'a_cash', type: 'acct', kind: 'cash', name: 'RKC', open: 5000 });
    add({ id: 'a_mf', type: 'acct', kind: 'mf', name: 'MF', open: 50000 });
    const f = (id, o) => add(Object.assign({ id, type: 'fin', who: '', paidAmount: 0, settled: false }, o));
    f('f_sal', { kind: 'income', amount: 80000, date: '2026-10-01', acct: 'a_sbi', desc: 'Salary', category: 'Salary' });
    f('f_l1', { kind: 'lent', amount: 6000, date: '2026-09-16', acct: 'a_sbi', who: 'Raj', desc: 'Hospital' });
    f('f_l2', { kind: 'lent', amount: 3000, date: '2026-10-02', acct: 'a_sbi', who: 'Raj', desc: 'Trip' });
    f('f_old', { kind: 'lent', amount: 2000, date: '2026-09-01', acct: 'a_sbi', who: 'Sam', desc: 'Old style', paidAmount: 800 });
    f('f_inv', { kind: 'expense', amount: 5000, date: '2026-10-10', acct: 'a_sbi', desc: 'SIP', category: 'Investment' });
    setPref('moneySeg', 'udhaar'); showTab('money'); Udh.person = 'raj'; renderMoney();
  });
  await page.waitForTimeout(500);
  // 1. person-level payment
  await page.locator('#udPay').click(); await page.waitForTimeout(300);
  await page.fill('#ppAmt', '99999'); await page.locator('#pshSave').click(); await page.waitForTimeout(200);
  T.ok('over-payment refused', /Only ₹9,000 is open/.test(await page.locator('#pshMsg').innerText()));
  await page.fill('#ppAmt', '7000'); await page.fill('#ppDate', '2026-10-20'); await page.selectOption('#ppAcct', 'a_cash');
  await page.locator('#pshSave').click(); await page.waitForTimeout(500);
  let R = await page.evaluate(() => ({ l1: records.f_l1, l2: records.f_l2 }));
  T.ok('7,000 goes to the oldest first, dated 20 Oct', R.l1.settled && R.l1.pays[0].date === '2026-10-20' && R.l1.pays[0].amt === 6000 && R.l1.pays[0].acct === 'a_cash' && R.l2.paidAmount === 1000 && !R.l2.settled && R.l2.pays[0].amt === 1000, JSON.stringify([R.l1.pays, R.l2.pays]));
  await shot(page, 'u1-person');
  // 2. Ledger rows
  await page.evaluate(() => { setPref('moneySeg', 'ledger'); finMonth = '2026-10'; renderMoney(); }); await page.waitForTimeout(500);
  const rows = await page.locator('#finList [data-finpay]').allInnerTexts();
  T.ok('Ledger: two pay-back rows on 20 Oct', rows.length === 2 && rows.every(t => /Raj paid back/.test(t) && /into RKC/.test(t)), rows.map(t => t.replace(/\n+/g, ' | ')).join(' || '));
  const hero = await page.locator('#ledHero').innerText();
  T.ok('pay-backs are not counted as income', /In\s*₹80,000/.test(hero.replace(/\n/g, ' ')), hero.replace(/\n+/g, ' | '));
  await shot(page, 'u2-ledger');
  // 3. tap a pay row → entry ledger → change the date
  await page.locator('#finList [data-finpay="f_l2"]').click(); await page.waitForTimeout(400);
  T.ok('tapping the row opens that entry’s ledger', /Received back/.test(await page.locator('#ulBody').innerText()));
  await page.locator('#ulBody [data-ulpay="0"]').click(); await page.waitForTimeout(200);
  await page.fill('#upDate', '2026-10-25'); await page.locator('#upOk').click(); await page.waitForTimeout(400);
  T.ok('payment date corrected to 25 Oct', await page.evaluate(() => records.f_l2.pays[0].date) === '2026-10-25' && /25 Oct/.test(await page.locator('#ulBody').innerText()));
  await shot(page, 'u3-entry-ledger');
  // undated legacy payment → set date
  await page.evaluate(() => openUdhLedger('f_old')); await page.waitForTimeout(300);
  T.ok('old payment shows “date not recorded” with Set date', /date not recorded/.test(await page.locator('#ulBody').innerText()) && await page.locator('#ulBody [data-ulpay="-1"]').count() === 1);
  await page.locator('#ulBody [data-ulpay="-1"]').click(); await page.fill('#upDate', '2026-09-20'); await page.locator('#upOk').click(); await page.waitForTimeout(400);
  R = await page.evaluate(() => records.f_old);
  T.ok('undated 800 became a dated payment; total unchanged', R.pays.length === 1 && R.pays[0].date === '2026-09-20' && R.pays[0].amt === 800 && R.paidAmount === 800 && !/date not recorded/.test(''), JSON.stringify(R.pays));
  T.ok('…and the ledger no longer says “date not recorded”', !/date not recorded/.test(await page.locator('#ulBody').innerText()));
  await page.evaluate(() => Sheets.close('shUdhLed', true));
  // 4. Settle with a chosen date
  await page.evaluate(() => openSettle('f_l2')); await page.waitForTimeout(300);
  await page.fill('#stAmt', '500'); await page.fill('#stDate', '2026-09-30'); await page.locator('#stOk').click(); await page.waitForTimeout(300);
  T.ok('date before the udhaar is refused', await page.evaluate(() => records.f_l2.paidAmount) === 1000);
  await page.fill('#stDate', '2026-11-05'); await page.locator('#stOk').click(); await page.waitForTimeout(400);
  R = await page.evaluate(() => records.f_l2);
  T.ok('part-payment of 500 recorded on 5 Nov', R.paidAmount === 1500 && R.pays[1].date === '2026-11-05' && R.pays[1].amt === 500 && !R.settled, JSON.stringify(R.pays));
  const pl = await page.evaluate(() => udhPersonRows('raj').map(r => [r.date, r.what, r.v, r.bal]));
  T.ok('person ledger: running balance ends at 1,500', pl[pl.length - 1][3] === 1500 && pl.every((r, i) => !i || r[0] >= pl[i - 1][0]), JSON.stringify(pl));
  // 5. account balances follow the dates
  R = await page.evaluate(() => { const c = planCfg(); return { oct: planCompute(c, '2026-10', 'actual').slice(-1)[0].accts, nov: planCompute(c, '2026-11', 'actual').slice(-1)[0].accts }; });
  T.ok('cash got 7,000 in Oct; 500 more in Nov on the bank', R.oct.a_cash === 12000 && R.nov.a_sbi - R.oct.a_sbi === 500, JSON.stringify(R));
  // 6. Investment link
  await page.evaluate(() => { finMonth = '2026-10'; renderMoney(); }); await page.waitForTimeout(400);
  T.ok('Ledger flags 1 unlinked investment entry', /1 investment entry is not linked/.test(await page.locator('[data-lf="inv"]').innerText()));
  const before = await page.evaluate(() => planCompute(planCfg(), '2026-10', 'actual').slice(-1)[0]);
  await page.locator('[data-lf="inv"]').click(); await page.waitForTimeout(300);
  T.ok('the only fund is pre-selected', await page.locator('#pshBody [data-inv="f_inv"] select').inputValue() === 'a_mf');
  await shot(page, 'u4-invlink');
  await page.locator('#pshSave').click(); await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ row: planCompute(planCfg(), '2026-10', 'actual').slice(-1)[0], n: invUnlinked().length, M: monthFigures(all('fin').filter(e => (e.date || '').slice(0, 7) === '2026-10')), prev: planCompute(planCfg(), '2026-09', 'actual').slice(-1)[0] }));
  T.ok('fund +5,000, bank unchanged, spending unchanged, flag gone', after.row.accts.a_mf - before.accts.a_mf === 5000 && after.row.accts.a_sbi === before.accts.a_sbi && after.row.exp === before.exp && after.n === 0 && after.M.inv === 5000 && after.row.invIn === before.invIn, JSON.stringify({ mf: after.row.accts.a_mf, invIn: after.row.invIn }));
  T.ok('received − spent = change in money (Oct)', Math.abs((after.row.inc - after.row.exp) - (after.row.worth - after.prev.worth)) < 0.01, (after.row.inc - after.row.exp) + ' vs ' + (after.row.worth - after.prev.worth));
  // 7. editor
  await page.evaluate(() => openFin('f_inv')); await page.waitForTimeout(300);
  T.ok('editor shows “Goes into (fund)” = MF', await page.locator('#feInvWrap').isVisible() && await page.locator('#feInvTo').inputValue() === 'a_mf');
  await page.selectOption('#feCat', 'Food'); await page.waitForTimeout(100);
  T.ok('hidden for other categories', !(await page.locator('#feInvWrap').isVisible()));
  await page.selectOption('#feCat', 'Investment'); await page.selectOption('#feInvTo', '-'); await page.locator('#feSave').click(); await page.waitForTimeout(300);
  T.ok('“not in any fund” is remembered and not flagged again', await page.evaluate(() => records.f_inv.invTo === '-' && invUnlinked().length === 0));
  // 8. statement text still works
  T.ok('share statement text has dated payments', /20 Oct/.test(await page.evaluate(() => udhStatementText(udhGroups().find(g => g.k === 'raj')))));

    /* ---- 3. backup outside Google ---- */
    const B = await page.evaluate(() => { const r = {};
      localStorage.removeItem('r2_lastOutBackup'); localStorage.removeItem('r2_lastBackup'); localStorage.removeItem('r2_autobk');
      r.none = lastOutBackup();
      localStorage.setItem('r2_autobk', JSON.stringify([{ fileId: 'x', date: '2026-11-01', at: Date.now(), count: 5 }])); localStorage.setItem('r2_lastBackup', String(Date.now()));
      r.driveOnly = lastOutBackup();
      noteOutBackup(); r.after = Date.now() - lastOutBackup();
      return r; });
    T.ok('no outside backup yet → 0', B.none === 0);
    T.ok('a Drive backup alone does not count as outside Google', B.driveOnly === 0);
    T.ok('saving a file counts', B.after >= 0 && B.after < 5000);
    await page.evaluate(() => openDataHealth()); await page.waitForTimeout(400);
    T.ok('Data health shows “Backup outside Google”', /Backup outside Google/.test(await page.locator('#shHealth').innerText()));
    T.ok('no errors on the page (udhaar)', errs.length === 0, errs.join(' ; ').slice(0, 300));
    await ctx.close(); }
  await browser.close(); server.close();
  T.done();
})().catch(T.crash);
