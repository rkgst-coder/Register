/* ==========================================================================
   QUICK ADD — one sheet for everything, opened by the + button.
   Picks the type that matches the tab you're on.
   ======================================================================== */
const ADD_TYPES = [
  { k: 'task', i: '☑︎', l: 'Task' }, { k: 'note', i: '🗒', l: 'Note' },
  { k: 'date', i: '📅', l: 'Key date' }, { k: 'doc', i: '📁', l: 'Document' }, { k: 'money', i: '₹', l: 'Money', priv: true }, { k: 'qlog', i: '#', l: 'Quick log', ql: true }
];
let addKind = 'task';
const AF = {};          // per-form state (chip choices)
const FOOD_W = ['food', 'lunch', 'dinner', 'breakfast', 'swiggy', 'zomato', 'restaurant', 'tea', 'chai', 'coffee', 'snack', 'nashta', 'samosa', 'milk', 'doodh', 'vegetable', 'sabzi', 'fruit'];
const guessFinCat = d => {
  const t = ' ' + String(d || '').toLowerCase() + ' ', h = ws => ws.some(w => t.includes(w));
  if (h(FOOD_W)) return 'Food';
  if (h(['petrol', 'fuel', 'uber', 'ola', 'train', 'flight', 'bus', 'cab', 'toll', 'hotel', 'irctc'])) return 'Travel';
  if (h(['electric', 'light bill', 'bill', 'recharge', 'wifi', 'broadband', 'gas', 'water', 'dth', 'mobile'])) return 'Bills';
  if (h(['doctor', 'medicine', 'hospital', 'pharmacy', 'test', 'lab'])) return 'Health';
  if (h(['school', 'fee', 'fees', 'book', 'tuition', 'course'])) return 'Education';
  if (h(['sip', 'mutual', 'fd', 'ppf', 'nps', 'stock', 'share'])) return 'Investment';
  if (h(['salary', 'pay credited'])) return 'Salary';
  if (h(['grocery', 'groceries', 'kirana', 'house', 'maid', 'rent', 'repair', 'dmart'])) return 'Household';
  return '';
};

function openAdd(kind) {
  if (!kind && currentTab === 'money' && finUnlocked()) {
    if (prefs.moneySeg === 'snotes') { newSecretNote(); return; }
    if (prefs.moneySeg === 'plan' && planCfg()) { const c = planCfg(), cur = isoMonth(new Date()); planMonthSheet(cur < c.startMonth ? c.startMonth : cur); return; }
  }
  if (!kind) {
    const tab = currentTab;
    kind = tab === 'notes' ? 'note' : tab === 'dates' ? 'date' : tab === 'docs' ? 'doc' : tab === 'money' ? 'money' : 'task';
  }
  if (kind === 'money' && !finUnlocked()) kind = 'task';
  addKind = kind;
  if (kind === 'qlog' && !qlReady()) kind = 'task';
  $('addTypes').innerHTML = ADD_TYPES.filter(t => (!t.priv || finUnlocked()) && (!t.ql || qlReady())).map(t =>
    `<button data-k="${t.k}" class="${t.k === kind ? 'on' : ''}" aria-pressed="${t.k === kind}"><b>${t.i}</b>${t.l}</button>`).join('');
  $$('#addTypes button').forEach(b => b.addEventListener('click', () => { addKind = b.dataset.k; $$('#addTypes button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); renderAddForm(true); }));
  renderAddForm(true);
  if (addDraft && !window.GHOST && addDraft.kind === addKind) {
    const dr = addDraft; Object.entries(dr.vals).forEach(([id, v]) => { const el = $(id); if (el) { el.value = v; el.dispatchEvent(new Event('input')); } });
    setTimeout(() => toast('Unsaved text restored.', 'Clear', () => { addDraft = null; renderAddForm(true); }), 350);
  }
  Sheets.open('shAdd');
}
let addDraft = null;
Sheets.onClose.shAdd = () => {
  const vals = {}; $$('#addForm input, #addForm textarea').forEach(x => { if (x.id && x.type !== 'file' && x.type !== 'checkbox' && String(x.value).trim() && x.value !== x.defaultValue) vals[x.id] = x.value; });
  addDraft = Object.keys(vals).length ? { kind: addKind, vals } : null;
};
$('fab').addEventListener('click', () => openAdd());

function dueChips(el, val, onPick) {
  const opts = [{ v: '', l: 'No date' }, { v: addDays(0), l: 'Today' }, { v: addDays(1), l: 'Tomorrow' }, { v: addDays(3), l: 'In 3 days' }, { v: addDays(7), l: 'Next week' }, { v: 'pick', l: 'Pick…' }];
  chipGroup(el, opts, opts.some(o => o.v === val) ? val : 'pick', v => onPick(v));
}

function renderAddForm(focus) { Dictate.stop(); renderAddForm0(focus); ['afTitle', 'afBody'].forEach(i => { if ($(i) && addKind !== 'money' && addKind !== 'qlog') addMic($(i)); }); }
function renderAddForm0(focus) {
  const f = $('addForm'); Object.keys(AF).forEach(k => delete AF[k]);
  const k = addKind;
  if (k === 'task') {
    f.innerHTML = `<div class="field"><input id="afTitle" placeholder="What needs doing?" autocomplete="off" enterkeyhint="done"></div>
      <div class="wrapchips" id="afSyntax" style="margin:-6px 0 6px"></div>
      <div class="guess" id="afGuess"></div>
      <div class="field" style="margin-top:12px"><label>Due</label><div class="wrapchips" id="afDue"></div>
        <input type="date" id="afDate" class="hidden" style="margin-top:8px"></div>
      <div class="field"><label>Priority</label><div class="wrapchips" id="afPrio"></div></div>
      <button class="linkbtn" id="afTpl">⧉ Start from a template</button>`;
    AF.due = ''; AF.cat = 'auto'; AF.prio = 'auto';
    $('afSyntax').innerHTML = ['!high', '!low', '@today', '@tomorrow', '@mon', '@15sep'].map(s => `<button class="chip" style="padding:5px 10px;font-size:13px">${s}</button>`).join('');
    $$('#afSyntax .chip').forEach(c => c.addEventListener('click', () => {
      const tok = c.textContent, inp = $('afTitle'); let v = inp.value;
      if (tok[0] === '#') v = v.replace(/#\w+/g, ''); else if (tok[0] === '!') v = v.replace(/![a-z]+/gi, ''); else v = v.replace(/@\S+/g, '');
      inp.value = (v.trim() + ' ' + tok).trim() + ' '; inp.focus(); taskGuess();
    }));
    dueChips($('afDue'), '', v => { if (v === 'pick') { $('afDate').classList.remove('hidden'); $('afDate').focus(); AF.due = $('afDate').value; } else { $('afDate').classList.add('hidden'); AF.due = v; } taskGuess(); });
    $('afDate').addEventListener('change', () => { AF.due = $('afDate').value; taskGuess(); });
    chipGroup($('afPrio'), [{ v: 'auto', l: 'Auto' }, ...PRIOS.map(p => ({ v: p, l: p }))], 'auto', v => { AF.prio = v; taskGuess(); }, p => p === 'auto' ? 'var(--ink-faint)' : PRIO_COLOR[p]);
    $('afTitle').addEventListener('input', taskGuess);
    $('afTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveAdd(true); } });
    $('afTpl').addEventListener('click', openTemplates);
    taskGuess();
  } else if (k === 'qlog') {
    f.innerHTML = `<div class="field"><label>Value</label><input id="afQlVal" inputmode="decimal" placeholder="0" autocomplete="off" aria-label="Value"></div>
      <div class="field"><label>Note</label><input id="afTitle" placeholder="What it is" autocomplete="off" enterkeyhint="done"></div>
      <div class="field"><label>When</label><div class="wrapchips" id="afWhen"></div><input type="date" id="afDate" class="hidden" style="margin-top:8px"></div>`;
    AF.when = todayISO();
    chipGroup($('afWhen'), [{ v: todayISO(), l: 'Today' }, { v: addDays(-1), l: 'Yesterday' }, { v: 'pick', l: 'Pick…' }], AF.when, v => {
      if (v === 'pick') { $('afDate').classList.remove('hidden'); $('afDate').value = AF.when; } else { $('afDate').classList.add('hidden'); AF.when = v; } });
    $('afDate').addEventListener('change', () => { AF.when = $('afDate').value || todayISO(); });
    wireCalc($('afQlVal'));
    $('afTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveAdd(false); } });
  } else if (k === 'note') {
    f.innerHTML = `<div class="field"><input id="afTitle" placeholder="Title (optional)" autocomplete="off"></div>
      <div class="field"><textarea id="afBody" rows="7" placeholder="Write or paste anything… markdown works"></textarea></div>
      <div class="btn-row" style="margin-top:0"><button class="btn ghost small" id="afPaste">📋 Paste from clipboard</button><button class="btn ghost small" id="afFull">✎ Open full editor</button></div>
      <div class="field"><label>Folder</label><div class="ne-folder" style="margin:0"><select id="afFolder" aria-label="Folder"></select><input id="afFolderNew" class="hidden" placeholder="New folder name"></div></div>`;
    folderPick($('afFolder'), $('afFolderNew'), activeFolder !== '__all__' ? activeFolder : '', folderList(), null);
    $('afPaste').addEventListener('click', async () => {
      try { const t = await navigator.clipboard.readText(); if (t) { $('afBody').value += ($('afBody').value ? '\n' : '') + t; toast('Pasted.'); } else toast('Clipboard is empty.'); }
      catch (e) { $('afBody').focus(); toast('Tap and hold in the box, then Paste.'); }
    });
    $('afFull').addEventListener('click', () => { const t = $('afBody').value, ti = $('afTitle').value; Sheets.close('shAdd', true); newNote(t, ti || null, true, pickedFolder($('afFolder'), $('afFolderNew'))); });
  } else if (k === 'date') {
    f.innerHTML = `<div class="field"><input id="afTitle" placeholder="e.g. Car insurance renewal" autocomplete="off"></div>
      <div class="field"><label>Date</label><input type="date" id="afDate"></div>
      <div class="field"><label>Repeats</label><div class="wrapchips" id="afRep"></div></div>`;
    AF.rep = YEARLY_CATS.includes(datePath) ? 'yearly' : 'once'; AF.repSet = false; chipGroup($('afRep'), REP_OPTS.map(([v, l]) => ({ v, l: l.replace(' (quarterly)', '') })), AF.rep, v => { AF.rep = v; AF.repSet = true; });
    f.insertAdjacentHTML('beforeend', `<div class="field"><label>Category</label><select id="afDateCat"><option value=""${datePath ? '' : ' selected'}>✨ Auto — from the name</option>${dateCats().map(c => `<option value="${c[0]}"${c[0] === datePath ? ' selected' : ''}>${c[2]} ${esc(c[1])}</option>`).join('')}</select></div><p class="hint">The date can be left empty and filled in later.</p>`);
  } else if (k === 'bill') {
    f.innerHTML = `<div class="field"><input id="afTitle" placeholder="e.g. Electricity, Home loan EMI" autocomplete="off"></div>
      <div class="grid2"><div class="field"><label>Expected ₹</label><input id="afAmt" inputmode="decimal" placeholder="blank if it varies"><div class="guess" id="afAmtHint"></div></div>
        <div class="field"><label>Due day</label><input id="afDay" inputmode="numeric" placeholder="1–31"></div></div>
      <div class="field"><label>Every</label><div class="wrapchips" id="afFreq"></div></div>
      <div class="grid2"><div class="field"><label>Number of instalments (EMIs only)</label><input id="afEmi" inputmode="numeric" placeholder="blank = ongoing"></div>
        <div class="field"><label>First due month</label><input type="month" id="afStart" value="${isoMonth(new Date())}"></div></div>`;
    AF.freq = '1'; chipGroup($('afFreq'), [{ v: '1', l: 'Month' }, { v: '2', l: '2 months' }, { v: '3', l: 'Quarter' }, { v: '6', l: '6 months' }, { v: '12', l: 'Year' }], '1', v => AF.freq = v);
    wireCalc($('afAmt'), $('afAmtHint'));
  } else if (k === 'doc') {
    f.innerHTML = `<div class="field"><input id="afTitle" placeholder="e.g. Car insurance — Creta" autocomplete="off"></div>
      <div class="field"><label>Type</label><div class="wrapchips" id="afType"></div></div>
      <div class="grid2"><div class="field"><label>Number / ID</label><input id="afNum" autocapitalize="characters"></div>
        <div class="field"><label><select id="afDueKind" style="width:auto;padding:0;border:0;background:none;font:inherit;color:inherit">${dueKindOpts()}</select> (optional)</label><input type="date" id="afDate"></div></div>
      <div class="grid2"><div class="field"><label>Belongs to</label><input id="afDocWho" list="afWhoDl" autocomplete="off" placeholder="Blank = Rahul" value="${esc(docPath.who && docPath.who !== DOC_ME ? docPath.who : '')}"><datalist id="afWhoDl">${docPeople().map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
        <div class="field"><label>Year (FY, optional)</label><select id="afFy">${fyOptions('', '— none —')}</select></div></div>
      <div class="field"><label>File (optional)</label><div class="btn-row" style="margin:0;flex-wrap:wrap"><button type="button" class="btn ghost small" id="afDocFileBtn">＋ Photo, PDF, Excel, Word</button><button type="button" class="btn ghost small" id="afDocScanBtn">📷 Scan</button><span class="hint" id="afDocFileN" style="margin:0;align-self:center"></span></div>
        <input type="file" id="afDocFile" class="vh" accept="${DOC_ACCEPT}" multiple tabindex="-1" aria-hidden="true"></div>
      <div class="group"><label class="switch-row"><span>Details only — no file needed<small>e.g. a debit card's number and expiry. It won’t show under “No file attached”.</small></span><input type="checkbox" class="sw" id="afNoFile"></label></div>`;
    AF.files = [];
    $('afDocFileBtn').addEventListener('click', () => $('afDocFile').click());
    $('afDocFile').addEventListener('change', e => { AF.files = [...e.target.files]; $('afDocFileN').textContent = AF.files.length ? `${AF.files.length} file${AF.files.length > 1 ? 's' : ''} chosen` : ''; if (AF.files.length) $('afNoFile').checked = false; });
    $('afDocScanBtn').addEventListener('click', () => { const t = $('afTitle').value.trim(); if (!t) { $('afTitle').focus(); toast('Type the document name first.'); return; } saveAdd(false, true); });
    AF.type = docNewType(); chipGroup($('afType'), DOC_TYPES, AF.type, v => AF.type = v, t => DOC_COLORS[t]);
    if (docPath.who) f.insertAdjacentHTML('afterbegin', `<p class="hint" style="margin:0 4px 8px">Adding to <b>👤 ${esc(docPath.who)}</b>${docPath.grp ? ` › <b>${groupIcon(docPath.grp)} ${esc(docPath.grp)}</b>` : ''} — change below if needed.</p>`);   // v2.22: the folder you are in fills the person and type
  } else if (k === 'money') {
    const descs = [...new Set(all('fin').sort((a, b) => b.createdAt - a.createdAt).map(e => e.desc).filter(Boolean))].slice(0, 40);
    const recent = moneyRecents();
    f.innerHTML = `<div class="qe"><input id="afQuick" placeholder="Quick: 250 chai · +50000 salary · lent 2000 Ravi" aria-label="Quick entry — type a line" autocomplete="off" autocapitalize="off" enterkeyhint="done"><button class="btn small" id="afQuickGo" type="button">Add</button></div>
      <div class="qe-hint" id="afQuickHint" aria-live="polite"></div>
      ${recent.length ? `<div class="rec-row" id="afRecent"><span class="rec-l">Repeat</span>${recent.map((e, i) => `<button type="button" data-rec="${i}" aria-label="Repeat ${esc(e.desc || 'entry')} ${rs(e.amount)}">${esc((e.desc || KINDS.find(x => x.v === e.kind).l).slice(0, 22))}<b>${rsShort(e.amount)}</b></button>`).join('')}</div>` : ''}
      <input class="big-amt" id="afAmt" inputmode="decimal" placeholder="₹0" aria-label="Amount — sums like 250+120 work">
      <div class="guess" id="afAmtHint" style="text-align:center"></div>
      <div class="field" style="margin-top:10px"><div class="wrapchips" id="afKind"></div></div>
      <div class="field"><label>For</label><input id="afTitle" list="descDl" placeholder="What was it?" autocomplete="off"><datalist id="descDl">${descs.map(d => `<option value="${esc(d)}">`).join('')}</datalist></div>
      <div class="field hidden" id="afWhoWrap"><label id="afWhoLbl">Person</label><input id="afWho" list="peopleDl" placeholder="Who?" autocomplete="off"></div>
      <div class="field" id="afSplitWrap"><label>Split with (optional)</label><input id="afSplit" placeholder="e.g. Ravi, Amit — each owes you an equal share" autocomplete="off"><div class="guess" id="afSplitHint"></div></div>
      <div class="grid2 hidden" id="afAcctWrap"><div class="field"><label id="afAcctLbl">Paid from</label><select id="afAcct"></select></div><div class="field hidden" id="afToWrap"><label>To</label><select id="afTo"></select></div></div>
      <div class="field" id="afCatWrap"><label>Category</label><div class="wrapchips" id="afCat"></div></div>
      ${all('goal').length ? `<div class="field" id="afGoalWrap"><label>Towards a goal (optional)</label><select id="afGoal">${goalOptions('')}</select></div>` : ''}
      <div class="field"><label>Date</label><div class="wrapchips" id="afWhen"></div><input type="date" id="afDate" class="hidden" style="margin-top:8px"></div>
      <div class="group"><label class="switch-row">Repeats every month<input type="checkbox" class="sw" id="afRecur"></label></div>`;
    AF.kind = 'expense'; AF.cat = ''; AF.when = todayISO();
    const kindChips = sel => chipGroup($('afKind'), KINDS, sel, v => { AF.kind = v; if ($('afGoalWrap')) $('afGoalWrap').classList.toggle('hidden', v !== 'expense'); $('afWhoWrap').classList.toggle('hidden', !isUdhaar(v)); acctPick('af', v); if (v === 'paidby') $('afAcctWrap').classList.add('hidden'); if ($('afSplitWrap')) $('afSplitWrap').classList.toggle('hidden', v !== 'expense'); { const g = $('afRecur') && $('afRecur').closest('.group'); if (g) g.classList.toggle('hidden', v === 'paidby'); } $('afWhoLbl') && ($('afWhoLbl').textContent = v === 'paidby' ? 'Who paid for it' : 'Person'); });
    kindChips('expense');
    acctPick('af', 'expense');
    const catChips = sel => chipGroup($('afCat'), [{ v: '', l: 'None' }, ...FIN_CATS.map(c => ({ v: c, l: c }))], sel, v => { AF.cat = v; AF.catTouched = true; }, c => FIN_COLORS[c]);
    catChips('');
    $('afTitle').addEventListener('input', () => { if (AF.catTouched) return; const g = guessFinCat($('afTitle').value); if (g !== AF.cat) { AF.cat = g; catChips(g); } });
    const whenChips = sel => chipGroup($('afWhen'), [{ v: todayISO(), l: 'Today' }, { v: addDays(-1), l: 'Yesterday' }, { v: 'pick', l: 'Pick…' }], sel, v => {
      if (v === 'pick') { $('afDate').classList.remove('hidden'); $('afDate').value = AF.when; } else { $('afDate').classList.add('hidden'); AF.when = v; } });
    whenChips(todayISO());
    $('afDate').addEventListener('change', () => { AF.when = $('afDate').value || todayISO(); });
    wireCalc($('afAmt'), $('afAmtHint'));
    { const sh = () => { const n = splitNames().length, T = calcAmount($('afAmt').value); $('afSplitHint').textContent = n && T > 0 ? (({ share, mine }) => `You ${rs(mine)} · ${n === 1 ? 'they' : 'each'} ${rs(share)} (recorded as udhaar diya)`)(splitShares(T, n)) : ''; };
      $('afSplit').addEventListener('input', sh); $('afAmt').addEventListener('input', sh); }
    /* fill the form from a parsed line or a recent entry; the date shown is the one used */
    AF.fill = (x) => {
      $('afAmt').value = x.amount > 0 ? x.amount : ''; $('afAmt').dispatchEvent(new Event('input'));
      $('afTitle').value = x.desc || ''; $('afWho').value = x.who || '';
      AF.kind = x.kind === 'expense' && x.paidBy ? 'paidby' : x.kind || 'expense'; kindChips(AF.kind); $('afWhoWrap').classList.toggle('hidden', !isUdhaar(AF.kind)); acctPick('af', AF.kind, x.acct || null, x.to || null); if (AF.kind === 'paidby') $('afAcctWrap').classList.add('hidden');
      AF.cat = x.kind === 'transfer' ? '' : (x.cat || ''); AF.catTouched = !!x.cat; catChips(AF.cat);
      AF.when = x.date || todayISO();
      if (AF.when === todayISO() || AF.when === addDays(-1)) whenChips(AF.when); else { whenChips('pick'); $('afDate').classList.remove('hidden'); $('afDate').value = AF.when; }
    };
    $$('[data-rec]', f).forEach(b => b.addEventListener('click', () => { const e = recent[+b.dataset.rec]; AF.fill({ amount: e.amount, kind: e.kind, paidBy: e.paidBy, desc: e.desc, who: e.who, acct: e.acct, to: e.to, cat: e.category, date: todayISO() }); $('afAmt').focus(); toast('Filled in — change anything, then Save.'); }));
    const qHint = () => { const v = $('afQuick').value, q = parseMoneyLine(v);
      $('afQuickHint').innerHTML = !v.trim() ? 'Type it as you say it — amount first or last. @account, #category, yday or 15sep work too.'
        : q.error ? esc(q.error) : `${moneyLineText(q)} <button type="button" id="afQuickFill">Edit first</button>`;
      if ($('afQuickFill')) $('afQuickFill').addEventListener('click', () => { AF.fill(parseMoneyLine($('afQuick').value)); $('afQuick').value = ''; qHint(); }); };
    $('afQuick').addEventListener('input', qHint); qHint();
    const quickSave = () => {
      const q = parseMoneyLine($('afQuick').value);
      if (q.error) { toast(q.error); $('afQuick').focus(); return; }
      const rec = saveMoneyEntry(q); if (!rec) return;
      addDraft = null; Sheets.close('shAdd', true);
      toast(`Recorded ${fmtMoney(rec.amount)}${rec.desc ? ' · ' + rec.desc.slice(0, 24) : ''}.`, 'Undo', () => softDelete(rec.id), 7000);
    };
    $('afQuickGo').addEventListener('click', quickSave);
    $('afQuick').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quickSave(); } });
  }
  const first = f.querySelector(k === 'money' ? '#afQuick' : k === 'qlog' ? '#afQlVal' : '#afTitle');
  if (focus && first) setTimeout(() => first.focus(), 320);
}

function taskGuessOld() {
  const el = $('afTitle'); if (!el) return;
  const q = parseQuickAdd(el.value), g = classify(q.title);
  const cat = AF.cat !== 'auto' ? AF.cat : q.category || g.category;
  const prio = AF.prio !== 'auto' ? AF.prio : q.priority || g.priority;
  const due = q.dueDate || AF.due;
  $('afGuess').innerHTML = q.title ? `Files as <b style="color:${catColor(cat)}">${cat}</b> · ${prio}${due ? ' · due ' + relDay(due) : ''}` : 'Tip: type #work, !high or @tomorrow — or use the chips.';
}

function saveAdd(another, thenScan) {
  const k = addKind, v = id => ($(id) ? $(id).value.trim() : '');
  if (k === 'task') {
    const q = parseQuickAdd(v('afTitle')); if (!q.title) { $('afTitle').focus(); return; }
    const g = classify(q.title);
    newTask({ title: q.title, category: fixCat(AF.cat !== 'auto' ? AF.cat : q.category || g.category), priority: AF.prio !== 'auto' ? AF.prio : q.priority || g.priority,
              dueDate: q.dueDate || AF.due || null, dueTime: q.dueTime || undefined, autoFiled: AF.cat === 'auto' && !q.category && g.matched });
    toast('Task added.');
  } else if (k === 'note') {
    const ti = v('afTitle'), body = $('afBody').value;
    if (!ti && !body.trim()) { $('afBody').focus(); return; }
    const fo = pickedFolder($('afFolder'), $('afFolderNew')); newNote(body, ti || null, false, fo); toast(fo ? 'Note saved in ' + fo + '.' : 'Note saved.');
  } else if (k === 'date') {
    const l = v('afTitle'), d = v('afDate');
    if (!l) { $('afTitle').focus(); return; }
    const dc = ($('afDateCat') && $('afDateCat').value) || guessDateCat({ label: l }), rp = AF.repSet ? AF.rep : YEARLY_CATS.includes(dc) ? 'yearly' : AF.rep;   // birthdays repeat every year
    put({ id: uid('d'), type: 'date', label: l, when: d || '', repeat: rp, cat: dc, needsDetail: !d || undefined, deleted: false }); toast(d ? 'Key date added.' : 'Added — set the date later.');
  } else if (k === 'bill') {
    const l = v('afTitle'); if (!l) { $('afTitle').focus(); return; }
    put({ id: uid('bill'), type: 'bill', label: l, amount: calcAmount(v('afAmt')) || 0, freq: +AF.freq || 1, dueDay: Math.min(31, parseInt(v('afDay'), 10) || 0),
          total: parseInt(v('afEmi'), 10) || 0, category: 'Bills', autoPost: false, startMonth: /^\d{4}-\d{2}$/.test(v('afStart')) ? v('afStart') : isoMonth(new Date()), deleted: false });
    toast('Bill added.');
  } else if (k === 'doc') {
    const l = v('afTitle'); if (!l) { $('afTitle').focus(); return; }
    const files = AF.files || [], noFile = !!($('afNoFile') && $('afNoFile').checked) && !files.length && !thenScan;
    const newDoc = put({ id: uid('doc'), type: 'doc', title: l, docType: AF.type, number: v('afNum'), expiry: v('afDate') || null, issuer: '', notes: '', folder: docFolderForNew(), fy: v('afFy') || null, who: normWho(v('afDocWho')), dueKind: $('afDueKind') ? $('afDueKind').value : 'expiry', ...(noFile ? { noFile: true } : {}), deleted: false });
    if (files.length) setTimeout(() => { openDoc(newDoc.id); addDocFiles(newDoc.id, files).catch(e => { RLOG.error('add doc files', e); toast('The file could not be added — try again here.'); }); }, 400);   // the editor shows the upload progress
    if (thenScan) setTimeout(() => Scan.open(newDoc.id), 400); { const nd = all('doc').sort((a, b) => b.createdAt - a.createdAt)[0]; if (nd && nd.expiry) { syncDocDate(nd); toast('Document added — the ' + dueWord(nd.dueKind) + ' is in Dates too.'); } }
    toast(docFolderForNew() ? 'Document added to ' + docFolderForNew() + '.' : 'Document added.');
  } else if (k === 'qlog') {
    const val = calcAmount(v('afQlVal'));
    if (isNaN(val) || !(val > 0)) { $('afQlVal').focus(); return; }
    quickLogSave(Math.round(val * 100) / 100, v('afTitle'), AF.when || todayISO()).then(ok => toast(ok ? 'Logged.' : 'Could not log — try again.'), e => { RLOG.error('quick log', e); toast('Could not log — try again.'); });
  } else if (k === 'money' && AF.kind === 'expense' && splitNames().length) {
    const useAcct = !$('afAcctWrap').classList.contains('hidden');
    if (!splitSave({ amount: calcAmount(v('afAmt')), desc: v('afTitle'), cat: AF.cat || '', date: AF.when || todayISO(), acct: useAcct ? $('afAcct').value : undefined })) return;
  } else if (k === 'money') {
    const useAcct = !$('afAcctWrap').classList.contains('hidden');
    const rec = saveMoneyEntry({ amount: calcAmount(v('afAmt')), kind: AF.kind, desc: v('afTitle'), who: v('afWho'), cat: AF.kind === 'transfer' ? '' : AF.cat || '',
      date: AF.when || todayISO(), acct: useAcct ? $('afAcct').value : undefined, to: useAcct && AF.kind === 'transfer' ? $('afTo').value : undefined, recurring: $('afRecur').checked, fromForm: true,
      goal: AF.kind === 'expense' && $('afGoal') ? $('afGoal').value : '' });
    if (!rec) return;
    toast(`Recorded ${fmtMoney(rec.amount)}.`, 'Undo', () => softDelete(rec.id));
  }
  addDraft = null;
  if (another) renderAddForm(true); else Sheets.close('shAdd', true);
}
$('addSave').addEventListener('click', () => saveAdd(false));
$('addAnother').addEventListener('click', () => saveAdd(true));

