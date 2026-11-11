/* ==========================================================================
   v2.19 — what changed, and the long-press hint
   ======================================================================== */
/* v2.20: items marked priv are shown only while Money is open */
const WHATS_NEW = [
  { t: '<b>Fixed — a person’s ledger</b>: when part of a payment was “extra when settling” and that extra was later paid back, the ledger left the repayment out, so its total disagreed with the person’s screen. It is now listed.', priv: true },
  { t: '<b>Settled udhaar</b>: people with nothing open now sit in the “Settled udhaar” fold, not at the bottom of the people list.', priv: true },
  { t: '<b>Fixed — a month that is over</b>: once a month is marked checked, a planned item you did not tick (e.g. an ATM withdrawal) is taken as not having happened. Before, the Plan and the account statement still counted it. In a month not yet checked, it now says “planned · not ticked”.', priv: true },
  { t: '<b>Fixed — monthly check-up</b>: each day-to-day estimate now shows how much of it was used, from its own account first. Before, every estimate showed the same total (e.g. “₹368 spent” three times).', priv: true },
  { t: '<b>Work out the month</b> treats a short account and an over account as one transfer only when money really moves between them (bank → cash, a card’s bill account → the card, or a regular or past transfer). Before, it could pair a card with an unrelated account.', priv: true },
  { t: '<b>Udhaar give (estimate)</b>: udhaar you really give that person now reduces the planned amount, rupee for rupee, from the month the plan item was made until 2 months after the planned month. Before, one entry near the month removed the whole estimate, and anything earlier was counted twice.', priv: true },
  { t: '<b>Bank interest</b>: a bank or salary account can have an interest rate (or a fixed ₹), credited every month or every 3 months. The plan adds it as income from this month on, and the monthly check-up lists it to tick with the real amount.', priv: true },
  { t: '<b>Fixed</b>: opening Register from the decoy screen could show a blank yellowish screen (the app was still blurred from being in the background).' },
  { t: '<b>One clock for sync</b>: when the same item is changed on two devices, the newer change wins. That used to trust each device’s own clock; now every change is stamped in Google’s time, so a phone or PC with a wrong clock can no longer win or lose unfairly. Data health tells you if this device’s clock is off.' },
  { t: '<b>Backup outside Google</b>: the monthly reminder and Data health now watch for a backup file saved outside your Google account (iCloud Drive, On My iPhone, the PC). The weekly Drive backup no longer silences the reminder, and a copy saved on one device counts on all.' },
  { t: '<b>Udhaar payments have their own date</b>: Settle and Settle all now ask for the date the money moved. On a person’s screen, <b>＋ Payment</b> records one amount against the oldest open entries first. In an entry’s ledger, tap ✎ or “Set date” on a payment to correct or add its date.', priv: true },
  { t: '<b>The Ledger shows udhaar coming back</b>: each payment is its own row (↩) on the day it happened, with the account. It is not counted as income or spending.', priv: true },
  { t: '<b>Investment spending → fund</b>: an entry in the “Investment” category can name the fund it went into, so it reaches that fund in Accounts. The Ledger lists older ones to link.', priv: true },
  { t: '<b>Share into Register</b> takes Word, Excel and text files too (needs Apps Script v27 and one more condition in the Shortcut — Settings → Share into Register).' },
  { t: '<b>A month in one look</b>: the Ledger now always shows “📒 … — where the money went” for the month on screen: what you spent (entered by you, and not entered), what you received, and how bank + cash − card dues went from the start of the month to the end.', priv: true },
  { t: '<b>Monthly check-up → “Work out the month”</b>: type what each account showed on the last day and tap once. All accounts are compared together, so cash you withdrew or a card bill you paid is recorded as a transfer, not as spending and income. Only the net is recorded as spending not entered.', priv: true },
  { t: '<b>Fixed</b>: Plan’s “Spending” now includes what someone else paid for you (as the Ledger already did); a past month’s “Money you have” uses the udhaar open at the end of that month, not today’s; the check-up’s “spent” next to an estimate no longer counts investments.', priv: true },
  { t: '<b>Data health</b>: <b>Compare with the Sheet</b> downloads everything again and lists anything the Sheet has that this device is not showing, and why (Copy report to send it). A device line you no longer use has <b>Forget</b>. Wording says “this device” instead of “this iPhone” on computers too.' },
  { t: '<b>A device that fell behind catches up first</b>: if this device has not synced for 30 minutes, opening a task, note, date, document or entry first gets the latest from your other devices. If it has not synced for 6 hours (offline, or a network that blocks Google), a banner at the top says so, with Sync now.' },
  { t: '<b>“Changed on two devices” is easier to read</b>: when each version was changed, steps as a ticked list, dates as dates, Open / Done instead of code.' },
  { t: '<b>More room to write on iPhone</b>: while the keyboard is up in a note, the title, folder and ‹ › bar step aside, the toolbar becomes one row that stays at the top (swipe it sideways for more buttons), and the note fills the screen. Tapping a toolbar button no longer closes the keyboard.' },
  { t: '<b>Paste from Excel</b> (or Google Sheets, Numbers, a web table) into a note: the cells land in separate cells — inside a table they fill from the cell you are in, adding rows and columns as needed; elsewhere they become a new table. No more picture of the cells. Ctrl+Shift+V works the same.' },
  { t: '<b>Table options</b> now float as a small “＋ Row · ▦ ⋯” at the right, just above the table, while you are in it — the note no longer jumps when they appear or go. ▦ ⋯ has every option.' },
  { t: '<b>🔐 Card code</b> (PNote tables): an optional second code just for 🔒 values — card and account numbers. Each 🔒 value is encrypted again with it, so the private code alone does not show them. Face ID can open it on a device where Money already uses Face ID. It locks again after 60 seconds, when Register goes to the background, and when Money locks. Add it from a PNote table: “＋ Card code”. It cannot be recovered if forgotten.', priv: true },
  { t: '<b>Tasks</b>: clearer priority colours — rose for High, sand for Medium, blue for Low — with darker versions in dark mode.' },
  { t: '<b>Tables in notes</b>: tap inside a table for “＋ Row” and “▦ ⋯” (rows, columns, delete). Tab moves to the next cell; Tab in the last cell adds a row.' },
  { t: '<b>Note toolbar</b>: on a computer, rest the pointer on a button to see what it does. On iPhone, press and hold a button to see its name.' },
  { t: '<b>Tasks</b> are tinted by priority — red High, gold Medium, blue Low — and open sorted <b>by priority</b>, then by date. The other orders are still in the chips.' },
  { t: '<b>Notes</b> show just their headings, in even tiles. A note without a heading shows its first line.' },
  { t: '<b>Search</b> opens with the keyboard ready on iPhone.' },
  { t: '<b>Fixed</b>: editing a task (or anything else) quickly while it was syncing made Register say it was “changed on two devices” when it was not. Any such entries already in the list are your own edits — tap Keep “In use”.' },
  { t: '<b>Locked documents open without opening Money</b>: the code typed for a 🔒 document unlocks documents only — Money, PNote and Plan stay hidden — and they lock again when you close the document (or after 3 minutes).' },
  { t: '<b>Documents</b>: a tidier top — ＋ Add, the year, and ⋯ More (People & categories, Family checklist, Keep on this device). A person’s or category’s actions are under one ⋯ button.' },
  { t: '<b>Next / previous</b>: swipe left or right (or use ‹ ›) to go through the list you opened from — documents (also the “needs attention” list), notes, tasks and Money entries. The one you leave is saved first.' },
  { t: 'Tap a <b>month name</b> (Ledger, Budgets, Bills, a month in Plan) to jump with the month wheel.' },
  { t: '<b>▦ Tables in PNote</b>: add a table to a private note — e.g. card numbers, expiry dates, document numbers. 🔒 columns show dots until tapped (tap again quickly to copy). Expiry dates go to Dates. <b>Card & account details</b> moved from Documents into PNote → “Cards & accounts”.', priv: true },
  { t: '<b>👥 Who holds what</b> in Plan: for any month, each person’s accounts (you choose the groups), and udhaar with the people you pick.', priv: true },
  { t: '<b>Goals</b> can now count their own accounts (e.g. a PPF or a separate savings account) plus payments made towards them — pick “Towards a goal” on a spending entry.', priv: true },
  { t: '<b>Balance check → “More than one thing”</b>: split a difference into parts, e.g. spent ₹150 and got ₹50 interest.', priv: true }
];
function showWhatsNew() {
  const L = WHATS_NEW.filter(x => !x.priv || finUnlocked());
  $('nwBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Register ${APP_VERSION}</p>${L.length ? `<ul class="nw-list">${L.map(x => `<li>${x.t}</li>`).join('')}</ul>` : '<p class="hint" style="margin:0 4px">Nothing new to show here.</p>'}`;
  if (!Sheets.isOpen('shNews')) Sheets.open('shNews');
}
function afterAppShown() {
  if (window.GHOST || document.documentElement.classList.contains('decoy-on')) return;
  const seen = lsGet('r2_seenVer'), had = !!seen || Object.keys(records).length > 3;
  if (seen !== APP_VERSION) { const vis = WHATS_NEW.some(x => !x.priv || finUnlocked()); if (!had || vis) lsSet('r2_seenVer', APP_VERSION); if (had && vis) setTimeout(() => { if (!Sheets.top()) showWhatsNew(); }, 900); return; }   // v2.25: private-only news waits for the unlock
  const n = (+(lsGet('r2_shown') || 0)) + 1; lsSet('r2_shown', String(n));
  if (prefs.todayAuto !== false && lsGet('r2_todayAuto') !== todayISO()) {        // v2.20: Today opens by itself on the first open of each day
    lsSet('r2_todayAuto', todayISO()); setTimeout(() => { if (!Sheets.top() && !document.documentElement.classList.contains('decoy-on')) openToday(); }, 700); return;
  }
  if (n >= 2 && !lsFlag('r2_hintPlus')) setTimeout(showPlusHint, 1600);
}
function showPlusHint() {
  if (lsFlag('r2_hintPlus') || Sheets.top() || document.querySelector('.hint-bubble') || document.documentElement.classList.contains('decoy-on')) return;
  const b = document.createElement('div'); b.className = 'hint-bubble'; b.setAttribute('role', 'note');
  b.innerHTML = 'Tip: <b>press and hold +</b> for quick actions — Capture, Add spend, Scan, New note.<button type="button">Got it</button>';
  document.body.appendChild(b);
  const done = () => { lsSetFlag('r2_hintPlus'); b.remove(); };
  b.querySelector('button').addEventListener('click', done);
  setTimeout(() => { if (b.isConnected) b.remove(); }, 15000);           // shown again next time until you tap "Got it" or use it
}
{ const oq = openQuick; openQuick = function () { lsSetFlag('r2_hintPlus'); const b = document.querySelector('.hint-bubble'); if (b) b.remove(); return oq(); }; }

