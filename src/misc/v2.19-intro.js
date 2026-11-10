/* ==========================================================================
   v2.19 — quick money entry, insights, reminders, family, data health
   ======================================================================== */

/* ---------- small helpers ---------- */
const clampDay = v => { const n = parseInt(String(v == null ? '' : v).trim(), 10); return n >= 1 && n <= 31 && /^\d{1,2}$/.test(String(v).trim()) ? n : 0; };
const normName = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function waitAge(t) { const n = t.waitingSince ? -daysUntilISO(t.waitingSince) : 0; return n <= 0 ? 'since today' : n === 1 ? '1 day' : n + ' days'; }
let pendingAfterUnlock = null;                  // something to open once the private section is unlocked
function needUnlock(then, scope) { if (Fin.key) { then(); return; } Fin.wantScope = scope || null; if (!finConfigured()) { toast('Set up the private section first — tap “Register” three times.'); return; } pendingAfterUnlock = then; openVault('unlock'); }

/* ---------- a job with a progress sheet (zip export, making scans searchable) ---------- */
const Job = { stop: false, running: false };
function jobOpen(title) { Job.stop = false; Job.running = true; $('jbTitle').textContent = title; $('jbMsg').className = 'msg'; $('jbMsg').textContent = 'Starting…'; $('jbBar').style.width = '0'; $('jbNote').innerHTML = ''; $('jbStop').textContent = 'Stop'; Sheets.open('shWork'); }
function jobStep(i, n, msg) { $('jbBar').style.width = (n ? Math.min(100, Math.round(i / n * 100)) : 0) + '%'; if (msg != null) $('jbMsg').textContent = msg; }
function jobDone(msg, err) { Job.running = false; $('jbBar').style.width = '100%'; $('jbMsg').className = 'msg ' + (err ? 'err' : 'ok'); $('jbMsg').textContent = msg; $('jbStop').textContent = 'Close'; }
$('jbStop').addEventListener('click', () => { if (!Job.running) { Sheets.close('shWork', true); return; } Job.stop = true; $('jbStop').textContent = 'Stopping…'; });
Sheets.onClose.shWork = () => { Job.stop = true; };

