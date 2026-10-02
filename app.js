/* ==========================================================================
   LOGGING — initialised before anything else so even a crash during start-up
   leaves a trail. A browser can't write to a file on its own, so the log is a
   rolling buffer (last 400 lines) kept in localStorage and downloadable from
   Settings → Diagnostics → Download log as register-log-YYYY-MM-DD.txt.
   ======================================================================== */
'use strict';
const APP_VERSION = '2.19.0';
/* index.html names the app.js it was built with; a mismatch means one of the two files was not updated */
const PAGE_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || '';
const LOG_KEY = 'r2_log';
const LOG_MAX = 400;
const RLOG = (() => {
  let buf = [];
  try { buf = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { buf = []; }
  let t = null;
  const flush = () => { if (window.__erasing) return; try { localStorage.setItem(LOG_KEY, JSON.stringify(buf.slice(-LOG_MAX))); } catch (e) {} };
  const write = (level, args) => {
    const msg = args.map(a => a instanceof Error ? (a.message + (a.stack ? ' | ' + a.stack.split('\n')[1] : ''))
                          : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })()
                          : String(a)).join(' ');
    buf.push(new Date().toISOString() + ' ' + level + ' ' + msg.slice(0, 600));
    if (buf.length > LOG_MAX * 1.2) buf = buf.slice(-LOG_MAX);
    clearTimeout(t); t = setTimeout(flush, 300);
    (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)('[register]', msg);
  };
  return {
    info: (...a) => write('INFO', a), warn: (...a) => write('WARN', a), error: (...a) => write('ERROR', a),
    text: () => buf.join('\n'), flush
  };
})();
window.addEventListener('error', e => RLOG.error('uncaught:', e.message, '@', (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => RLOG.error('unhandled promise:', e.reason));
window.addEventListener('pagehide', () => RLOG.flush());
RLOG.info('start v' + APP_VERSION, navigator.userAgent.slice(0, 120),
          'standalone=' + (window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches));

/* ==========================================================================
   UTILITIES
   ======================================================================== */
const $ = id => document.getElementById(id);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowMs = () => Date.now();
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Local-calendar dates. NEVER toISOString() for dates — in IST it rolls back a day.
function isoLocal(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
const todayISO = () => isoLocal(new Date());
const isoMonth = d => isoLocal(d).slice(0, 7);
const addDays = (n, from) => { const d = from ? new Date(from + 'T00:00:00') : new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return isoLocal(d); };
const daysUntilISO = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000);
/* v2.18: toLocaleDateString builds a new formatter on every call (≈0.1 ms each — seconds on a long list); these are built once */
const DTF = {};
function dateFmt(d, o) { const k = JSON.stringify(o); return (DTF[k] || (DTF[k] = new Intl.DateTimeFormat('en-IN', o))).format(d); }
function fmtDate(iso, withYear) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return '';
  const o = { day: 'numeric', month: 'short' };
  if (withYear || d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return dateFmt(d, o);
}
function relDay(iso) {
  if (!iso) return '';
  const n = daysUntilISO(iso);
  if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return dateFmt(new Date(iso + 'T00:00:00'), { weekday: 'long' });
  return fmtDate(iso);
}
const monthAdd = (ym, n) => { const d = new Date(ym + '-01T00:00:00'); d.setMonth(d.getMonth() + n); return isoMonth(d); };
const monthDiff = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
const monthLong = ym => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const monthShort = ym => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
function fmtMoney(n) { return '₹' + Math.abs(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function timeAgo(ts) {
  if (!ts) return 'never';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24); if (d < 30) return d + 'd ago';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 10 > 3 || Math.floor(n % 100 / 10) === 1) ? 0 : n % 10] || 'th');

/* ---------- amount calculator: "250+120*2" → 490. No eval(). ---------- */
function calcAmount(str) {
  const s = String(str == null ? '' : str).replace(/[₹,\s]/g, '').replace(/x/gi, '*').replace(/÷/g, '/').replace(/×/g, '*');
  if (!s) return NaN;
  if (!/^[\d.+\-*/()%]+$/.test(s)) return NaN;
  let i = 0;
  const peek = () => s[i];
  function num() {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; }
    if (peek() === '-') { i++; return -num(); }
    const m = s.slice(i).match(/^\d*\.?\d+/); if (!m) throw 0;
    i += m[0].length; let v = parseFloat(m[0]);
    if (peek() === '%') { i++; v = v / 100; }
    return v;
  }
  function term() { let v = num(); while (peek() === '*' || peek() === '/') { const o = s[i++]; const r = num(); v = o === '*' ? v * r : v / r; } return v; }
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = s[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; }
  try { const v = expr(); if (i !== s.length || !isFinite(v)) return NaN; return Math.round(v * 100) / 100; } catch (e) { return NaN; }
}
/* Live hint under an amount box when the user types a sum. */
function wireCalc(input, hintEl) {
  const upd = () => {
    const raw = input.value; const v = calcAmount(raw);
    if (hintEl) hintEl.textContent = (/[+\-*/x×÷%]/i.test(raw.replace(/^-/, '')) && !isNaN(v)) ? '= ' + fmtMoney(v) : '';
  };
  input.addEventListener('input', upd);
  input.addEventListener('blur', () => { const v = calcAmount(input.value); if (!isNaN(v) && /[+\-*/x×÷%]/i.test(input.value.replace(/^-/, ''))) { input.value = v; upd(); } });
  upd();
}

/* ---------- date words: today, tmrw, 3d, 2w, mon, nextweek, 15sep, 15/9, 2026-09-15 ---------- */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseDateToken(tok) {
  tok = String(tok || '').toLowerCase().replace(/[,]/g, '');
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (tok === 'today' || tok === 'tod') return isoLocal(d);
  if (tok === 'tomorrow' || tok === 'tmrw' || tok === 'tmr') { d.setDate(d.getDate() + 1); return isoLocal(d); }
  if (tok === 'nextweek') { d.setDate(d.getDate() + 7); return isoLocal(d); }
  if (tok === 'nextmonth') return isoLocal(addMonthsKeep(d, 1));
  if (tok === 'eom') { return isoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
  let m = tok.match(/^(\d+)d$/); if (m) { d.setDate(d.getDate() + +m[1]); return isoLocal(d); }
  m = tok.match(/^(\d+)w$/); if (m) { d.setDate(d.getDate() + 7 * m[1]); return isoLocal(d); }
  m = tok.match(/^(\d+)m$/); if (m) return isoLocal(addMonthsKeep(d, +m[1]));
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const base = tok.replace(/^next/, '');
  const di = days.findIndex(x => base.length >= 3 && x.startsWith(base));
  if (di >= 0) { const delta = ((di - d.getDay()) + 7) % 7 || 7; d.setDate(d.getDate() + delta); return isoLocal(d); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) return tok;
  const pick = (dd, mm, yy) => {
    let y = yy ? (+yy < 100 ? 2000 + +yy : +yy) : d.getFullYear();
    const out = new Date(y, mm, dd);
    if (out.getMonth() !== mm) return null;
    if (!yy && out < d) out.setFullYear(y + 1);           // "15 sep" already passed → next year
    return isoLocal(out);
  };
  m = tok.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/); if (m) return pick(+m[1], +m[2] - 1, m[3]);
  m = tok.match(/^(\d{1,2})-?([a-z]{3})[a-z]*-?(\d{2,4})?$/); if (m && MONTHS.includes(m[2])) return pick(+m[1], MONTHS.indexOf(m[2]), m[3]);
  m = tok.match(/^([a-z]{3})[a-z]*-?(\d{1,2})$/); if (m && MONTHS.includes(m[1])) return pick(+m[2], MONTHS.indexOf(m[1]));
  return null;
}

/* ---------- toast with optional action (Undo) ---------- */
let toastTimer = null, toastFn = null;
function toast(msg, actLabel, act, ms) {
  if (window.GHOST) return;
  clearTimeout(toastTimer);
  $('toastMsg').textContent = msg;
  const b = $('toastAct');
  if (actLabel) { b.textContent = actLabel; b.classList.remove('hidden'); toastFn = act; } else { b.classList.add('hidden'); toastFn = null; }
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), ms || (actLabel ? 6000 : 2800));
}
$('toastAct').addEventListener('click', () => { const f = toastFn; $('toast').classList.remove('show'); if (f) f(); });

/* ---------- downloads + share ---------- */
function dl(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
/* On iPhone the share sheet is the natural "Save to Files / send" path. Falls back to a download. */
async function shareOrDownload(text, name, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  try {
    const file = new File([blob], name, { type: mime || 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; RLOG.warn('share failed', e); }
  dl(blob, name);
}

/* ---------- bottom sheets ---------- */
const Sheets = {
  stack: [], onClose: {},
  open(id) {
    const el = $(id); if (!el) return;
    if (this.stack.includes(id)) this.stack = this.stack.filter(x => x !== id);
    this.stack.push(id);
    el.style.zIndex = 100 + this.stack.length * 2;
    el.classList.add('open');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    const card = el.querySelector('.sheet-card'); card.style.transform = '';
    const body = el.querySelector('.sheet-body'); if (body && !el.dataset.keepScroll) body.scrollTop = 0;
    if (this.onOpen[id]) { try { this.onOpen[id](); } catch (e) { RLOG.error('onOpen ' + id, e); } }
  },
  onOpen: {},
  close(id, silent) {
    const el = $(id); if (!el || !el.classList.contains('open')) return;
    el.classList.remove('open');
    this.stack = this.stack.filter(x => x !== id);
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
    if (!silent && this.onClose[id]) { try { this.onClose[id](); } catch (e) { RLOG.error('onClose ' + id, e); } }
  },
  top() { return this.stack[this.stack.length - 1]; },
  isOpen(id) { return this.stack.includes(id); },
  closeAll() { [...this.stack].reverse().forEach(id => this.close(id)); }
};
$$('.sheet').forEach(sh => {
  sh.addEventListener('click', e => { if (e.target === sh) Sheets.close(sh.id); });
  $$('[data-close]', sh).forEach(b => b.addEventListener('click', () => Sheets.close(sh.id)));
  // drag the grab handle / header down to dismiss
  const card = sh.querySelector('.sheet-card');
  let y0 = null, dy = 0;
  const start = e => {
    if (e.target.closest('button,input,select,textarea,a')) return;
    y0 = e.touches[0].clientY; dy = 0; card.style.transition = 'none';
  };
  const move = e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    card.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (y0 == null) return;
    card.style.transition = ''; y0 = null;
    if (dy > 110) Sheets.close(sh.id); else card.style.transform = '';
    setTimeout(() => { card.style.transform = ''; }, 300);
  };
  [sh.querySelector('.sheet-grab'), sh.querySelector('.sheet-head')].forEach(h => {
    if (!h) return;
    h.addEventListener('touchstart', start, { passive: true });
    h.addEventListener('touchmove', move, { passive: true });
    h.addEventListener('touchend', end);
  });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Sheets.top()) Sheets.close(Sheets.top()); });
/* Document, key-date and bill editors save themselves when dismissed (tap outside, swipe down, decoy) — like tasks and notes. */
const AutoSheet = {
  cfg: { shDoc: 'doSave', shDate: 'deSave', shBill: 'beSave' }, snap: {},
  vals(id) { return JSON.stringify($$('input,textarea,select', $(id)).filter(x => x.id && x.type !== 'file').map(x => x.type === 'checkbox' ? x.checked : x.value)
    .concat($$('.wrapchips .on, .chips .on', $(id)).map(x => x.textContent))); },
  changed(id) { return this.snap[id] != null && this.vals(id) !== this.snap[id]; },
  save(id) { this.snap[id] = this.vals(id); $(this.cfg[id]).click(); }
};
Object.keys(AutoSheet.cfg).forEach(id => {
  Sheets.onOpen[id] = () => { AutoSheet.snap[id] = AutoSheet.vals(id); };
  $(id).addEventListener('click', e => { if (e.target.closest('#' + AutoSheet.cfg[id])) AutoSheet.snap[id] = null; }, true);   // explicit Save: nothing left to do
  const prev = Sheets.onClose[id];
  Sheets.onClose[id] = () => { if (AutoSheet.changed(id)) { AutoSheet.snap[id] = null; $(AutoSheet.cfg[id]).click(); } if (prev) prev(); };
});

/* Keep sheets above the iOS keyboard. */
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const kb = Math.max(0, window.innerHeight - vv.height);
    document.documentElement.style.setProperty('--kb', (kb > 80 ? kb : 0) + 'px');
    if (window.scrollY) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
}

/* ---------- swipe rows ----------
   markup: <div class="swipe"><div class="swipe-bg"><span class="l">…</span><span class="r">…</span></div><div class="row">…</div></div>
   right = swipe towards the right (complete / pay), left = swipe left (delete). */
function swipeHtml(inner, rightLbl, leftLbl, attrs) {
  return `<div class="swipe" ${attrs || ''}><div class="swipe-bg"><span class="l">${rightLbl || ''}</span><span class="r">${leftLbl || ''}</span></div>${inner}</div>`;
}
function bindSwipe(wrap, right, left) {
  const row = wrap.querySelector('.row'); if (!row) return;
  let x0 = 0, y0 = 0, dx = 0, dir = null, on = false;
  row.addEventListener('touchstart', e => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; dir = null; on = true; row.classList.remove('anim'); }, { passive: true });
  row.addEventListener('touchmove', e => {
    if (!on) return;
    const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (!dir) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.4) dir = 'h';
      else if (Math.abs(my) > 10) { dir = 'v'; on = false; return; } else return;
    }
    if ((mx > 0 && !right) || (mx < 0 && !left)) { dx = 0; row.style.transform = ''; return; }
    dx = mx; e.preventDefault();
    row.style.transform = `translateX(${dx}px)`;
    wrap.classList.toggle('go-r', dx > 0); wrap.classList.toggle('go-l', dx < 0);
  }, { passive: false });
  row.addEventListener('touchend', () => {
    if (!on) return; on = false;
    row.classList.add('anim');
    if (Math.abs(dx) > 8) { wrap._swiped = true; setTimeout(() => { wrap._swiped = false; }, 400); }
    if (dx > 90 && right) { row.style.transform = ''; setTimeout(right, 160); }
    else if (dx < -90 && left) { row.style.transform = `translateX(-${row.offsetWidth}px)`; setTimeout(left, 200); }
    else row.style.transform = '';
    setTimeout(() => wrap.classList.remove('go-r', 'go-l'), 240);
  });
}
/* Tap handler that ignores the click which ends a swipe. */
function onTap(wrap, fn) { wrap.addEventListener('click', e => { if (wrap._swiped) return; fn(e); }); }

/* tiny chip-group helper: renders single-select chips into el */
function chipGroup(el, options, value, onPick, colorFn) {
  el.innerHTML = options.map(o => {
    const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : o;
    const dot = colorFn ? `<span class="dot" style="background:${colorFn(v)}"></span>` : '';
    return `<button class="chip ${v === value ? 'on' : ''}" data-v="${esc(v)}" aria-pressed="${v === value}">${dot}${esc(l)}</button>`;
  }).join('');
  $$('.chip', el).forEach(b => b.addEventListener('click', () => {
    $$('.chip', el).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    onPick(b.dataset.v);
  }));
}
function chipValue(el) { const b = el.querySelector('.chip.on'); return b ? b.dataset.v : null; }

/* ==========================================================================
   STORAGE — IndexedDB (no 5 MB localStorage ceiling, one write per record)
     recs : every record, keyed by id (money records are stored sealed)
     kv   : settings, sync cursor, note version history
     imgs : Drive images cached on this device, keyed by Drive file id
   ======================================================================== */
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('register2', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('recs')) db.createObjectStore('recs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('imgs')) db.createObjectStore('imgs');
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); location.reload(); };
        res(db);
      };
      r.onerror = () => { RLOG.error('IDB open failed', r.error); rej(r.error); };
      r.onblocked = () => RLOG.warn('IDB open blocked');
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => { RLOG.error('IDB tx error', store, t.error); rej(t.error); };
      t.onabort = () => { RLOG.error('IDB tx abort', store, t.error); rej(t.error || new Error('abort')); };
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    open,
    all: () => tx('recs', 'readonly', s => req(s.getAll())),
    put: rec => tx('recs', 'readwrite', s => { s.put(rec); }),
    putMany: recs => tx('recs', 'readwrite', s => { recs.forEach(r => s.put(r)); }),
    del: id => tx('recs', 'readwrite', s => { s.delete(id); }),
    delMany: ids => tx('recs', 'readwrite', s => { ids.forEach(id => s.delete(id)); }),
    clearRecs: () => tx('recs', 'readwrite', s => { s.clear(); }),
    get: key => tx('kv', 'readonly', s => req(s.get(key))),
    set: (key, val) => tx('kv', 'readwrite', s => { s.put(val, key); }),
    remove: key => tx('kv', 'readwrite', s => { s.delete(key); }),
    imgGet: key => tx('imgs', 'readonly', s => req(s.get(key))),
    imgSet: (key, val) => tx('imgs', 'readwrite', s => { s.put(val, key); }),
    imgDel: key => tx('imgs', 'readwrite', s => { s.delete(key); })
  };
})();

/* Small synchronous settings mirror (kv 'prefs'), so the UI never waits on IDB. */
const PREF_DEFAULTS = {
  theme: 'auto', text: 'default', contrast: false, left: false,
  startTab: 'tasks', stepsOpen: true, noteEdit: false,
  decoyLaunch: true, decoyReturn: 60, appIdle: 0, moneyIdle: 5,
  cloudUrl: '', cloudToken: '', driveFolder: '',
  lastTab: 'tasks', dateSeg: 'bills', moneySeg: 'ledger', noteSort: 'pinned', taskMode: 'due'
};
let prefs = { ...PREF_DEFAULTS };
async function loadPrefs() {
  try { const p = await DB.get('prefs'); if (p) prefs = { ...PREF_DEFAULTS, ...p }; } catch (e) { RLOG.error('prefs load', e); }
  // the decoy must be decided before IDB answers, so its flags also live in localStorage
  try { localStorage.setItem('r2_decoy', prefs.decoyLaunch ? '1' : '0'); } catch (e) {}
}
function setPref(k, v) {
  prefs[k] = v;
  if (k === 'decoyLaunch') { try { localStorage.setItem('r2_decoy', v ? '1' : '0'); } catch (e) {} }
  DB.set('prefs', prefs).catch(e => RLOG.error('prefs save', e));
}

/* ==========================================================================
   RECORD STORE
   Every item is a record { id, type, updatedAt, deleted, ...fields }.
   Types: task note date doc bill billpay blob template  (plain)
          fin budget                                     (sealed — private section)
          finkey                                         (salt + check value, not secret)
   `_dirty` marks a record that still has to reach the Sheet. It is only
   cleared after the server has accepted that exact version — so an edit made
   offline, or during a failed upload, is never skipped.
   ======================================================================== */
const SEALED_TYPES = new Set(['fin', 'budget', 'filekey', 'snote', 'plancfg', 'planmonth', 'invest', 'loan', 'goal', 'acct', 'recur', 'subscfg', 'emerg']);   // v2.19: + subscriptions settings, Emergency sheet
const FINKEY_ID = '__finkey__';
let records = {};          // id -> plaintext record (money records only while unlocked)
let sealed = {};           // id -> sealed form of money records (always present)
const persistQ = {};       // id -> promise chain, keeps writes for one id in order

/* ---------- private-section encryption (AES-GCM, key from the access code) ---------- */
const te = new TextEncoder(), td = new TextDecoder();
const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const FIN_ITERS = 150000, FIN_ITERS_NEW = 600000, FIN_MIN_CODE = 12;   // v2.19 (S3): new and changed codes need 12+ characters; older shorter codes still open
const Fin = { key: null, salt: null, kid: null, iters: FIN_ITERS, lockedOut: [], tampered: [] };
const keyCache = new Map();          // `${salt}|${code}` → CryptoKey, cleared on lock

async function deriveFinKey(code, salt, iters) {
  iters = +iters || FIN_ITERS;
  const ck = salt + '|' + iters + '|' + code;
  if (keyCache.has(ck)) return keyCache.get(ck);
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: iters, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keyCache.set(ck, k);
  return k;
}
async function aesEnc(key, str) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(str));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
  return b64(out);
}
async function aesDec(key, payload) {
  const raw = unb64(payload);
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)));
}
function stripLocal(r) { const o = { ...r }; delete o._dirty; return o; }
async function seal(rec, ctx) {
  ctx = ctx && ctx.key ? ctx : Fin;
  if (!ctx.key) throw new Error('private section is locked');
  return { id: rec.id, type: rec.type, updatedAt: rec.updatedAt, deleted: !!rec.deleted,
           deletedAt: rec.deletedAt || null, salt: ctx.salt, kid: ctx.kid, it: ctx.iters || FIN_ITERS,
           enc: await aesEnc(ctx.key, JSON.stringify(stripLocal(rec))) };
}
/* v2.19 (S1): the copy inside the encryption is authenticated by AES-GCM. The id, type, time and deleted flag
   written next to it in the Sheet are not, so they must match the inner copy — otherwise someone with access to
   the Sheet could move an entry to another id, mark it deleted, or replay an old one under a new time. */
function tamperErr(id) { const e = new Error('integrity check failed for ' + id); e.code = 'TAMPER'; return e; }
function sealMatches(p, s) {
  return !!p && typeof p === 'object' && p.id === s.id && p.type === s.type && (+p.updatedAt || 0) === (+s.updatedAt || 0) && !!p.deleted === !!s.deleted;
}
async function unsealWith(key, s, noCheck) {
  const p = JSON.parse(await aesDec(key, s.enc));
  if (!noCheck && !sealMatches(p, s)) throw tamperErr(s.id);
  return p;
}

const finConfigured = () => !!(records[FINKEY_ID] && !records[FINKEY_ID].deleted);
const finUnlocked = () => !!Fin.key;

async function setupFinance(code) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const kid = uid('k');
  const key = await deriveFinKey(code, salt, FIN_ITERS_NEW);
  Fin.key = key; Fin.salt = salt; Fin.kid = kid; Fin.iters = FIN_ITERS_NEW; Fin.lockedOut = []; Fin.tampered = []; Fin.unlockedAt = Date.now();
  put({ id: FINKEY_ID, type: 'finkey', salt, kid, iters: FIN_ITERS_NEW, check: await aesEnc(key, 'register-ok'), createdAt: nowMs(), deleted: false }, { render: false });
  RLOG.info('private section set up');
}
/* Returns true / false. Decrypts every sealed record into memory. */
async function unlockFinance(code) {
  const fk = records[FINKEY_ID]; if (!fk) return false;
  let key;
  try { key = await deriveFinKey(code, fk.salt, fk.iters); if (await aesDec(key, fk.check) !== 'register-ok') return false; }
  catch (e) { return false; }
  Fin.key = key; Fin.salt = fk.salt; Fin.kid = fk.kid; Fin.iters = +fk.iters || FIN_ITERS; Fin.lockedOut = []; Fin.tampered = []; Fin.codeLen = code.length; Fin.unlockedAt = Date.now();
  const reseal = [];
  for (const id in sealed) {
    const s = sealed[id];
    try {
      const k = s.salt === fk.salt ? key : await deriveFinKey(code, s.salt, s.it);
      const plain = await unsealWith(k, s);
      if (Fin.key !== key) break;                                   // locked again while this ran: keep nothing in the clear
      plain._dirty = s._dirty || 0;
      records[id] = plain;
      if (s.salt !== fk.salt) reseal.push(plain);          // written under an older code → bring it forward
    } catch (e) { if (e && e.code === 'TAMPER') Fin.tampered.push(id); else Fin.lockedOut.push(id); }
  }
  storeVer++;
  if (Fin.key !== key) { for (const id in records) if (SEALED_TYPES.has(records[id].type)) delete records[id]; return false; }
  reseal.forEach(r => { r.updatedAt = Math.max(r.updatedAt, nowMs()); put(r, { render: false, keepTime: true }); });
  if (Fin.lockedOut.length) RLOG.warn('private records under another code:', Fin.lockedOut.length);
  if (Fin.tampered.length) RLOG.warn('private records failed the integrity check:', Fin.tampered.length);
  RLOG.info('private section unlocked; records', Object.keys(sealed).length);
  return true;
}
/* Entries written under an older code: try that code, then re-save them under the current one. */
async function recoverLockedOut(oldCode) {
  let n = 0; const still = [];
  for (const id of Fin.lockedOut) {
    const s = sealed[id];
    try { const plain = await unsealWith(await deriveFinKey(oldCode, s.salt, s.it), s); records[id] = plain; put(plain, { render: false }); n++; }
    catch (e) { if (e && e.code === 'TAMPER') { if (!Fin.tampered.includes(id)) Fin.tampered.push(id); } else still.push(id); }
  }
  Fin.lockedOut = still; scheduleRender();
  return n;
}
async function changeFinanceCode(newCode) {
  if (!Fin.key) return false;
  const plains = Object.values(records).filter(r => SEALED_TYPES.has(r.type));
  const nums = [];                                       // document numbers kept encrypted (locked documents)
  for (const d of Object.values(records).filter(r => r.type === 'doc' && r.numEnc)) { try { nums.push([d, await aesDec(Fin.key, d.numEnc)]); } catch (e) { RLOG.warn('doc number not readable', d.id); } }
  const ax = records[ARCH_ID];
  if (ax && !ax.deleted && (ax.list || []).some(a => a.enc && !a.salt)) put({ ...ax, list: ax.list.map(a => a.enc && !a.salt ? { ...a, salt: Fin.salt, iters: Fin.iters } : a) }, { render: false });
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveFinKey(newCode, salt, FIN_ITERS_NEW);
  Fin.key = key; Fin.salt = salt; Fin.kid = uid('k'); Fin.iters = FIN_ITERS_NEW; Fin.codeLen = newCode.length;
  put({ ...records[FINKEY_ID], salt, kid: Fin.kid, iters: FIN_ITERS_NEW, check: await aesEnc(key, 'register-ok') }, { render: false });
  plains.forEach(r => put(r, { render: false, bump: true }));   // re-seal under the new code; +1 ms so newer edits from other devices still win
  for (const [d, n] of nums) { d.numEnc = await aesEnc(key, n); put(d, { render: false }); }
  Bio.forget();
  RLOG.info('private code changed; re-sealed', plains.length);
  return true;
}
function lockFinance(silent) {
  if (!Fin.key) return;
  if (typeof beforeFinanceLock === 'function') beforeFinanceLock();
  Fin.key = null; Fin.salt = null; Fin.kid = null; Fin.iters = FIN_ITERS; Fin.lockedOut = []; Fin.tampered = []; Fin.tamperedRows = null; keyCache.clear();
  try { const pa = document.getElementById('printArea'); if (pa) pa.innerHTML = ''; } catch (e) {}
  for (const id in records) if (SEALED_TYPES.has(records[id].type)) delete records[id];
  storeVer++;
  if (typeof onFinanceLocked === 'function') onFinanceLocked(silent);
}

/* ---------- v2.18: nothing that arrives from the Sheet, a backup or an old install is trusted ----------
   A record's id and type end up inside HTML attributes, and a few short fields (category, priority, repeat,
   year …) are printed in lists. Anything outside the shapes the app itself creates is dropped or reset. */
const REC_ID_RX = /^[A-Za-z0-9_.:@\-]{1,120}$/, REC_TYPE_RX = /^[a-z][a-z0-9_]{0,30}$/;
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/, FY_RX = /^\d{4}-\d{2}$/, HM_RX = /^\d{2}:\d{2}$/;
const TASK_STATUS = ['active', 'inprogress', 'waiting', 'done'], TASK_REPEAT = ['none', 'daily', 'weekly', 'monthly'], DATE_REPEAT = ['once', 'yearly', 'monthly'];
/* Returns the record (fixed in place) or null when it must not be kept. */
function cleanRec(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.id !== 'string' || !REC_ID_RX.test(r.id) || typeof r.type !== 'string' || !REC_TYPE_RX.test(r.type)) return null;
  const pick = (v, list, dflt) => list.includes(v) ? v : dflt, dateOr = (v, dflt) => typeof v === 'string' && ISO_DATE_RX.test(v) ? v : dflt;
  if (r.type === 'task' || r.type === 'template') {
    r.category = fixCat(r.category); r.priority = pick(r.priority, PRIOS, 'Medium');
    if (Array.isArray(r.subs)) r.subs.forEach(s => { if (s && typeof s === 'object') { s.priority = pick(s.priority, PRIOS, 'Medium'); if (s.dueDate != null) s.dueDate = dateOr(s.dueDate, null); } });
    if (r.type === 'task') {
      r.status = pick(r.status, TASK_STATUS, 'active'); r.repeat = pick(r.repeat, TASK_REPEAT, 'none');
      if (r.dueDate != null) r.dueDate = dateOr(r.dueDate, null);
      if (r.dueTime != null && !(typeof r.dueTime === 'string' && HM_RX.test(r.dueTime))) delete r.dueTime;
      if (r.waitingOn != null && typeof r.waitingOn !== 'string') delete r.waitingOn;
    }
  } else if (r.type === 'date') {
    r.repeat = pick(r.repeat, DATE_REPEAT, 'once'); if (r.when != null && r.when !== '') r.when = dateOr(r.when, '');
  } else if (r.type === 'doc' || r.type === 'docfile') {
    if (r.fy != null && !(typeof r.fy === 'string' && FY_RX.test(r.fy))) r.fy = null;
    if (r.type === 'doc') { if (r.expiry != null && r.expiry !== '') r.expiry = dateOr(r.expiry, null); if (typeof r.docType !== 'string') r.docType = 'Other'; }
  }
  return r;
}

/* ---------- load / query ---------- */
async function loadAll() {
  records = {}; sealed = {}; storeVer++;
  const rows = await DB.all(), bad = [];
  rows.forEach(r => {
    if (!r || !r.id || !r.type) return;
    if (SEALED_TYPES.has(r.type)) { if (typeof r.id === 'string' && REC_ID_RX.test(r.id)) sealed[r.id] = r; else bad.push(r.id); return; }
    if (cleanRec(r)) records[r.id] = r; else bad.push(r.id);
  });
  if (bad.length) RLOG.warn('left out of the app (unusable id or type; still stored on this device, not deleted)', bad.length);
  storeVer++;
  RLOG.info('loaded', rows.length, 'records');
}
/* v2.18: the per-type lists are rebuilt only when the store changed (storeVer), not on every call — lists render in O(items) instead of O(items × records).
   A copy is returned, so callers may still sort or splice what they get. Anything that edits `records` directly must bump storeVer. */
const allCache = { ver: -1, by: new Map() };
const all = type => {
  if (window.GHOST) return [];
  if (allCache.ver !== storeVer) { allCache.ver = storeVer; allCache.by = new Map(); }
  let l = allCache.by.get(type);
  if (!l) { l = Object.values(records).filter(r => r.type === type && !r.deleted); allCache.by.set(type, l); }
  return l.slice();
};
const trashed = () => window.GHOST ? [] : Object.values(records).filter(r => r.deleted && r.deletedAt && r.type !== 'chunk' && r.type !== 'blob' && r.type !== 'billpay' && r.type !== 'finkey' && r.type !== 'docfile' && r.type !== 'filekey' && r.type !== 'planmonth' && r.type !== 'plancfg' && r.type !== 'erasekey' && r.type !== 'erased');

/* ---------- write ---------- */
function persist(rec) {
  const snap = JSON.parse(JSON.stringify(rec));
  const id = rec.id;
  const ctx = SEALED_TYPES.has(rec.type) && Fin.key ? { key: Fin.key, salt: Fin.salt, kid: Fin.kid, iters: Fin.iters } : null;
  persistQ[id] = (persistQ[id] || Promise.resolve()).then(async () => {
    if (SEALED_TYPES.has(snap.type)) {
      const s = await seal(snap, ctx); s._dirty = snap._dirty || 0;
      sealed[id] = s; await DB.put(s);
    } else {
      await DB.put(snap);
    }
  }).catch(e => { RLOG.error('persist failed', id, e); toast('Could not save — storage error. See Settings → Download log.'); });
  return persistQ[id];
}
const persistIdle = () => Promise.all(Object.values(persistQ));

/* put(): stamp, mark dirty, save, re-render, nudge sync. */
let storeVer = 0;
function put(rec, opt) {
  if (window.GHOST) { ghostCrash(); return rec; }
  opt = opt || {};
  if (opt.bump) rec.updatedAt = (rec.updatedAt || 0) + 1;                       // re-seal: keeps its place in time
  else if (!opt.keepTime) rec.updatedAt = Math.max(nowMs(), (rec.updatedAt || 0) + 1);   // another device's clock may be ahead
  storeVer++;
  rec._dirty = 1;
  if (rec.deleted === undefined) rec.deleted = false;
  if (!rec.createdAt) rec.createdAt = nowMs();
  if (SEALED_TYPES.has(rec.type) && !Fin.key) { RLOG.error('put sealed while locked', rec.id); toast('Unlock the private section first.'); return rec; }
  records[rec.id] = rec;
  persist(rec);
  if (opt.render !== false) scheduleRender();
  if (typeof Sync !== 'undefined') Sync.soon();
  return rec;
}
function softDeleteBase(id, opt) {
  const r = records[id]; if (!r) return;
  r.deleted = true; r.deletedAt = nowMs(); put(r, opt);
}
function restoreBase(id) {
  const r = records[id]; if (!r) return;
  r.deleted = false; delete r.deletedAt; put(r);
}
async function purgeOldTrash() {
  const cutoff = nowMs() - 30 * 86400000, ids = [];
  const liveKeys = new Set(Object.values(records).filter(r => (r.type === 'docfile' || r.type === 'blob') && !r.deleted && r.keyId).map(r => r.keyId));
  for (const id in records) { const r = records[id]; if (r.deleted && !r._dirty && r.deletedAt && r.deletedAt < cutoff && !liveKeys.has(id)) ids.push(id); }
  for (const id in sealed) { const s = sealed[id]; if (s.deleted && !s._dirty && s.deletedAt && s.deletedAt < cutoff && !ids.includes(id) && !liveKeys.has(id)) ids.push(id); }
  if (!ids.length) return;
  const goneDocs = new Set(ids.filter(id => records[id] && records[id].type === 'doc'));
  ids.forEach(id => { const r = records[id]; if (r && r.type === 'docfile' && r.fileId) driveDelete(r.fileId); if (r && r.type === 'blob' && r.drive && r.fileId && !r.gone) driveDelete(r.fileId); });
  if (goneDocs.size) all('docfile').forEach(f => { if (goneDocs.has(f.docId)) { driveDelete(f.fileId); softDelete(f.id, { render: false }); } });
  ids.forEach(id => { delete records[id]; delete sealed[id]; });
  storeVer++;
  await DB.delMany(ids);
  RLOG.info('purged trash', ids.length);
}

/* ---------- render scheduling ---------- */
let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; try { renderAll(); } catch (e) { RLOG.error('render', e); } });
}

/* ==========================================================================
   SYNC with the Apps Script (Code.gs v16)
   push dirty records → pull everything the server changed since our cursor.
   Newest updatedAt wins per record, on both sides.
   ======================================================================== */
/* v2.18: the token is only ever sent to Google Apps Script (localhost is allowed for development) */
const scriptUrlOk = u => /^https:\/\/script\.google(usercontent)?\.com\//.test(String(u || '')) || (typeof location !== 'undefined' && location.hostname === 'localhost');
const Sync = {
  busy: false, again: false, timer: null, lastOk: 0, warnedBig: false,
  on() { return !!(prefs.cloudUrl && prefs.cloudToken && scriptUrlOk(prefs.cloudUrl)); },

  async call(action, payload, timeoutMs) {
    if (window.GHOST) throw new Error('Network error');
    if (!scriptUrlOk(prefs.cloudUrl)) throw new Error('The sync address is not a Google Apps Script address');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 45000);
    try {
      const res = await fetch(prefs.cloudUrl, {
        method: 'POST', signal: ctl.signal, redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },     // no CORS preflight
        body: JSON.stringify({ action, token: prefs.cloudToken, ...(payload || {}) })
      });
      const txt = await res.text();
      let d; try { d = JSON.parse(txt); } catch (e) { throw new Error('Not JSON from script (is the URL the /exec one, deployed for "Anyone"?)'); }
      if (d.error) throw new Error(d.error);
      return d;
    } finally { clearTimeout(t); }
  },

  status(state, title) {
    const dot = $('syncDot'); dot.className = 'sync-dot ' + (state || '');
    $('syncBtn').setAttribute('aria-label', 'Sync — ' + (title || state || 'local only'));
    $('syncBtn').title = title || '';
  },

  soon(ms) { if (!this.on() || window.__erasing) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), ms || 1500); },

  async run(manual) {
    if (window.GHOST) return false;
    if (!this.on()) { this.status('', 'Local only — connect a Sheet in Settings'); if (manual) toast('Sync is not set up — see Settings.'); return false; }
    if (!navigator.onLine) { this.status('err', 'Offline — changes are saved on this iPhone'); if (manual) toast('Offline. Everything is saved here and will sync later.'); return false; }
    if (this.busy) { this.again = true; return false; }
    this.busy = true; this.status('busy', 'Syncing…');
    try {
      this.fresh = !(await DB.get('firstSync'));
      if (this.fresh) await this.pull();                   // first sync of this device: take the Sheet's copies first
      await this.push();
      const got = await this.pull();
      await this.push();                                   // anything re-sealed during the pull
      this.lastOk = nowMs(); DB.set('lastSync', this.lastOk); window.__synced = true;
      if (!(await DB.get('firstSync'))) await DB.set('firstSync', this.lastOk);   // first time this device synced with this Sheet
      this.status('ok', 'Synced ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      if (manual) toast(got ? `Synced — ${got} update${got === 1 ? '' : 's'} received.` : 'Synced — all up to date.');
      return true;
    } catch (e) {
      RLOG.error('sync failed:', e.message || e);
      this.status('err', 'Sync error — saved on this iPhone. ' + (e.message || ''));
      if (manual) toast('Sync failed: ' + (e.message || 'network error') + '. Your changes are safe here.');
      return false;
    } finally {
      this.busy = false; this.fresh = false; this.conflicts = null;
      if (this.conflictsMade) { const k = this.conflictsMade; this.conflictsMade = 0; toast(`${k} note${k > 1 ? 's were' : ' was'} also changed on another device — your version is kept as a "conflict copy".`, null, null, 8000); }
      if (this.again) { this.again = false; this.soon(800); }
    }
  },

  rowFor(id) {
    const s = sealed[id];
    const noBig = x => { const p = stripLocal(x); delete p._tooBig; delete p._chunked; return p; };
    if (s) return { id, type: s.type, updatedAt: s.updatedAt, deleted: !!s.deleted, summary: '', payload: JSON.stringify(noBig(s)) };
    const r = records[id];
    const summary = r.type === 'blob' ? (r.name || 'image') : (r.title || r.label || '');
    return { id, type: r.type, updatedAt: r.updatedAt, deleted: !!r.deleted, summary, payload: JSON.stringify(noBig(r)) };
  },
  /* v2.19 (B5): one record → its row, or (when it is too big for a Sheet cell) its chunk rows followed by a small stub */
  rowsFor(id) {
    const row = this.rowFor(id);
    if (row.payload.length <= CHUNK_AT) return [row];
    const n = Math.ceil(row.payload.length / CHUNK_SIZE);
    if (chunkId(id, n - 1).length > 120 || n >= 2000) return [row];        // cannot be split: the server refuses it as before
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = { id: chunkId(id, i), type: 'chunk', of: id, i, n, v: row.updatedAt, data: row.payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), updatedAt: row.updatedAt, deleted: false };
      out.push({ id: c.id, type: 'chunk', updatedAt: c.updatedAt, deleted: false, summary: '', payload: JSON.stringify(c), chunkOf: id });
    }
    const src = sealed[id] || records[id], stub = { id, type: row.type, updatedAt: row.updatedAt, deleted: row.deleted, _chunks: n, _cv: row.updatedAt };
    if (!sealed[id] && (src.type === 'note' || src.type === 'task')) { stub.title = src.title || ''; stub.text = '(Too long for this older version of Register — update the app on this device to see it.)'; }
    out.push({ id, type: row.type, updatedAt: row.updatedAt, deleted: row.deleted, summary: row.summary, payload: JSON.stringify(stub), stubN: n });
    return out;
  },

  async push() {
    await persistIdle();
    const ids = [];
    for (const id in records) if (records[id]._dirty && !SEALED_TYPES.has(records[id].type) && !LOCAL_ONLY_TYPES.has(records[id].type)) ids.push(id);
    for (const id in sealed) if (sealed[id]._dirty) ids.push(id);
    if (!ids.length) return 0;
    // batches of ≤ ~1.5 MB so a note full of pictures can't stall everything; a big record's chunks always go before its stub
    let batch = [], size = 0, sent = 0;
    const badChunk = new Set();
    const flush = async () => {
      if (!batch.length) return;
      const d = await this.call('push', { records: batch });
      const stale = new Set(d.stale || []), rejected = new Set(d.rejected || []);
      const clean = [];
      batch.forEach(row => {
        if (row.chunkOf) { if (rejected.has(row.id) || stale.has(row.id)) badChunk.add(row.chunkOf); return; }
        const cur = sealed[row.id] || records[row.id];
        if (!cur || cur.updatedAt !== row.updatedAt) return;    // edited again meanwhile — stays dirty
        if (stale.has(row.id) && (cur.type === 'note' || cur.type === 'snote')) {   // v2.19 (B6): the Sheet has a newer copy from another device — keep ours to compare
          const plain = records[row.id]; if (plain && (plain.type === 'note' || plain.type === 'snote')) (this.conflicts = this.conflicts || {})[row.id] = { id: plain.id, type: plain.type, title: plain.title, text: plain.text, folder: plain.folder, color: plain.color, docRefs: plain.docRefs, imgs: plain.imgs };
        }
        if (row.stubN && badChunk.has(row.id)) { cur._tooBig = true; if (records[row.id]) records[row.id]._tooBig = true; return; }   // a part did not arrive: the stub is not trusted, stays dirty
        cur._dirty = 0;
        if (records[row.id]) records[row.id]._dirty = 0;
        if (!rejected.has(row.id)) delete cur._tooBig;
        if (row.stubN) { cur._chunked = row.stubN; if (records[row.id]) records[row.id]._chunked = row.stubN; } else { delete cur._chunked; if (records[row.id]) delete records[row.id]._chunked; }
        if (rejected.has(row.id)) { cur._tooBig = true; if (!this.warnedBig) { this.warnedBig = true; toast(`"${(cur.title || cur.label || 'An item').slice(0, 30)}" is too large to sync (Sheet cell limit). It stays on this iPhone.`); } }
        clean.push(SEALED_TYPES.has(cur.type) ? stripLocal(sealed[row.id]) : stripLocal(cur));
      });
      if (clean.length) await DB.putMany(clean.map(c => ({ ...c, _dirty: 0 })));
      if (stale.size) { RLOG.info('server had newer copies of', stale.size); this.refetch = true; }
      sent += batch.length; batch = []; size = 0;
    };
    for (const id of ids) {
      for (const row of this.rowsFor(id)) {
        if (size + row.payload.length > 1500000) await flush();
        batch.push(row); size += row.payload.length;
      }
    }
    await flush();
    RLOG.info('pushed', sent);
    return sent;
  },

  async pull() {
    const rf = !!this.refetch, since = rf ? 0 : ((await DB.get('cursor')) || 0);
    const d = await this.call('pull', { since });
    if (rf) this.refetch = false;                          // only once the full read really happened
    const n = await mergeRemote(d.records || []);
    await DB.set('cursor', d.serverTime || nowMs());
    if (n) RLOG.info('pulled', n, 'of', (d.records || []).length);
    return n;
  }
};

/* ---------- v2.19 (B5): a record too big for one Sheet cell travels as numbered "chunk" rows plus a small stub ---------- */
const CHUNK_AT = 45000, CHUNK_SIZE = 20000;          // a chunk's JSON can grow when quotes are escaped again, so parts stay well under the 49,000 cell limit
const chunkId = (id, i) => 'ck.' + id + '.' + i;
const LOCAL_ONLY_TYPES = new Set(['chunk']);           // kept on the device to rebuild big records; never pushed, backed up or listed
function chunkJoin(stub) {
  const n = +stub._chunks; if (!(n > 0 && n < 2000)) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const c = records[chunkId(stub.id, i)];
    if (!c || c.of !== stub.id || +c.v !== +stub._cv || typeof c.data !== 'string') return null;
    out += c.data;
  }
  try { const full = JSON.parse(out); return full && full.id === stub.id && full.type === stub.type && (+full.updatedAt || 0) === (+stub._cv || 0) ? full : null; } catch (e) { return null; }
}
/* ---------- v2.19 (B6): when another device's newer copy replaces a note you changed here, your text is kept as a copy ---------- */
function conflictCopy(local, remoteText, remoteTitle) {
  if (!local || (local.type !== 'note' && local.type !== 'snote')) return null;
  if (typeof editNoteId !== 'undefined' && editNoteId === local.id && Sheets.isOpen('shNote')) return null;   // open in the editor: what you are typing is saved over it anyway
  const lt = String(local.text || ''), lti = String(local.title || '');
  if (!lt.trim() && !lti.trim()) return null;
  if (lt === String(remoteText || '') && lti === String(remoteTitle || '')) return null;
  if (local.type === 'snote' && !Fin.key) return null;
  const c = put({ id: uid(local.type === 'snote' ? 'sn' : 'n'), type: local.type, title: (lti.trim() || 'Untitled') + ' (conflict copy ' + fmtDate(todayISO(), true) + ')', text: lt,
    color: local.color || NOTE_COLORS[0], pinned: false, folder: local.folder || '', docRefs: (local.docRefs || []).slice(), imgs: (local.imgs || []).slice(), conflictOf: local.id, deleted: false }, { render: false });
  RLOG.warn('conflict copy kept for', local.id);
  Sync.conflictsMade = (Sync.conflictsMade || 0) + 1;
  return c;
}

/* Merge rows from the server (or an import). Returns how many changed locally. */
async function mergeRemote(rows, fromImport) {
  const writes = [], gone = []; let n = 0, finkeyChanged = false, erasedAt = 0; const erasedIds = new Map();
  const parsed = [];
  for (const row of rows) {
    let rec;
    try { rec = typeof row.payload === 'string' ? JSON.parse(row.payload) : row; } catch (e) { RLOG.warn('bad payload', row.id); continue; }
    if (!rec || !rec.id || !rec.type) continue;
    if (typeof rec.id !== 'string' || !REC_ID_RX.test(rec.id) || typeof rec.type !== 'string' || !REC_TYPE_RX.test(rec.type)) { RLOG.warn('ignored a record with an unusable id or type'); continue; }
    parsed.push(rec);
  }
  // chunks first, so a stub in the same batch can be rebuilt
  for (const rec of parsed) {
    if (rec.type !== 'chunk' || fromImport) continue;
    if (typeof rec.of !== 'string' || typeof rec.data !== 'string' || rec.id !== chunkId(rec.of, +rec.i)) continue;
    const local = records[rec.id];
    if (local && (local.updatedAt || 0) >= (rec.updatedAt || 0) && +local.v === +rec.v) continue;
    rec._dirty = 0; records[rec.id] = rec; writes.push(rec);
  }
  for (let rec of parsed) {
    if (rec.type === 'chunk') continue;
    if (rec._chunks) {                                          // a stub: rebuild the real record from its chunks
      if (fromImport) continue;
      const full = chunkJoin(rec);
      if (!full) { RLOG.warn('big record not complete yet', rec.id); Sync.incomplete = (Sync.incomplete || 0) + 1; continue; }
      rec = full;
    }
    if (rec.purged) {                                          // Code.gs v22 keeps a small marker for rows deleted long ago
      const l = sealed[rec.id] || records[rec.id];
      // v2.19 (S1): an encrypted entry is only forgotten if this device also has it as deleted — a forged marker cannot remove live Money entries
      if (l && SEALED_TYPES.has(l.type) && !l.deleted) { RLOG.warn('ignored a purge marker for a live private entry', rec.id); continue; }
      if (l && !l._dirty && (l.updatedAt || 0) <= (rec.updatedAt || 0)) { delete sealed[rec.id]; delete records[rec.id]; gone.push(rec.id); n++; }
      continue;
    }
    if (rec.type === 'erased') { if (!fromImport) { erasedAt = Math.max(erasedAt, +rec.at || 1); erasedIds.set(rec.id, +rec.updatedAt || 0); } continue; }
    const isSealed = SEALED_TYPES.has(rec.type);
    if (!isSealed && !cleanRec(rec)) continue;
    const local = isSealed ? sealed[rec.id] : records[rec.id];
    const takeKey = !fromImport && rec.id === FINKEY_ID && Sync.fresh && local && local.kid !== rec.kid && !rec.deleted;   // this device's own new code never replaces the one in use
    if (local && !takeKey && (local.updatedAt || 0) >= (rec.updatedAt || 0)) continue;
    if (takeKey) RLOG.warn('this device had its own private code; using the one from the Sheet');
    rec._dirty = fromImport ? 1 : 0;
    if (isSealed) {
      if (!rec.enc) continue;                                  // a plaintext money row is never accepted from outside
      if (Fin.key && rec.salt === Fin.salt) {
        const k = Fin.key; let p;
        try { p = await unsealWith(k, rec); }
        catch (e) {
          if (e && e.code === 'TAMPER') { if (!Fin.tampered.includes(rec.id)) Fin.tampered.push(rec.id); (Fin.tamperedRows = Fin.tamperedRows || {})[rec.id] = rec; RLOG.warn('refused a private entry that failed the integrity check', rec.id); continue; }
          Fin.lockedOut.push(rec.id); sealed[rec.id] = rec; writes.push(rec); n++; continue;
        }
        if (Fin.key !== k) { sealed[rec.id] = rec; writes.push(rec); n++; continue; }
        const lp = records[rec.id];
        if (!fromImport && lp && (lp._dirty || (Sync.conflicts && Sync.conflicts[rec.id]))) conflictCopy(Sync.conflicts && Sync.conflicts[rec.id] || lp, p.deleted ? '\u0000' : p.text, p.deleted ? '\u0000' : p.title);
        sealed[rec.id] = rec; p._dirty = rec._dirty; records[rec.id] = p;
      } else {
        sealed[rec.id] = rec;
        if (Fin.key) { Fin.lockedOut.push(rec.id); delete records[rec.id]; }
      }
    } else {
      if (rec.id === FINKEY_ID && Fin.key && rec.kid !== Fin.kid) finkeyChanged = true;
      const st = Sync.conflicts && Sync.conflicts[rec.id];
      if (!fromImport && local && (local._dirty || st)) conflictCopy(st || local, rec.deleted ? '\u0000' : rec.text, rec.deleted ? '\u0000' : rec.title);
      records[rec.id] = rec;
    }
    if (Sync.conflicts) delete Sync.conflicts[rec.id];
    writes.push(rec); n++;
  }
  if (writes.length) { storeVer++; await DB.putMany(writes); }
  if (gone.length) { storeVer++; await DB.delMany(gone); }
  if (erasedAt && !fromImport && !window.__erasing) {
    const first = await DB.get('firstSync');
    if (first && first < erasedAt) { window.__erasing = true; RLOG.warn('emergency erase from another device'); await wipeDevice(); return 0; }
    // set up after the erase (or restored from a backup): our copies must win over the erase markers
    const later = [];
    for (const [id, ts] of erasedIds) {
      const l = sealed[id] || records[id]; if (!l || l.deleted || (l.updatedAt || 0) > ts) continue;
      if (records[id]) { records[id].updatedAt = ts; put(records[id], { render: false }); }
      else later.push(id);                                     // Money still locked: re-saved (and so re-sealed) after the next unlock
    }
    if (later.length) { const prev = (await DB.get('erasedWin')) || []; await DB.set('erasedWin', [...new Set([...prev, ...later])]); }
  }
  if (finkeyChanged) { lockFinance(true); toast('The private-section code was changed on another device. Unlock again with the new code.'); }
  if (n) scheduleRender();
  return n;
}
/* v2.19: private entries that must win over another device's erase markers are re-saved once Money is open */
async function settleErasedWin() {
  if (!Fin.key) return;
  const ids = (await DB.get('erasedWin')) || []; if (!ids.length) return;
  ids.forEach(id => { const r = records[id]; if (r && !r.deleted) put(r, { render: false }); });
  await DB.remove('erasedWin');
  RLOG.info('re-saved private entries over erase markers', ids.length);
}
/* v2.19 (S1): what to do with private entries that failed the integrity check */
async function acceptTampered(id) {
  const s = (Fin.tamperedRows && Fin.tamperedRows[id]) || sealed[id]; if (!s || !Fin.key) return false;
  try {
    const k = s.salt === Fin.salt ? Fin.key : null; if (!k) return false;
    const p = await unsealWith(k, s, true);
    p.id = s.id; p.type = s.type; p.deleted = !!p.deleted;           // the inner, authenticated copy decides
    sealed[id] = s; records[id] = p; put(p, { render: false });
    Fin.tampered = Fin.tampered.filter(x => x !== id); if (Fin.tamperedRows) delete Fin.tamperedRows[id];
    RLOG.warn('accepted a private entry after an integrity warning', id);
    return true;
  } catch (e) { RLOG.warn('accept tampered failed', id, e.message); return false; }
}

window.addEventListener('online', () => Sync.soon(300));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.soon(600); });
setInterval(() => { if (document.visibilityState === 'visible') Sync.soon(10); }, 120000);

/* ==========================================================================
   IMAGES
   With a Drive folder set: full-size file in your Drive, bytes proxied back
   through the script and cached on this iPhone (IndexedDB) so each picture is
   downloaded once. Without Drive: shrunk to fit one Sheet cell.
   ======================================================================== */
const IMG_MAX_CHARS = 45000, IMG_PER_NOTE = 10, DRIVE_MAXDIM = 2400, DRIVE_Q = 0.88;
const memImg = new Map();
const driveOn = () => !!(Sync.on() && prefs.driveFolder);
function parseFolderId(v) { const m = String(v || '').trim().match(/[-\w]{25,}/); return m ? m[0] : ''; }

async function driveUpload(dataUrl, name) {
  const comma = dataUrl.indexOf(',');
  const d = await Sync.call('driveUpload', { folderId: prefs.driveFolder, name, mime: dataUrl.slice(5, dataUrl.indexOf(';')), data: dataUrl.slice(comma + 1) }, 90000);
  if (!d.fileId) throw new Error('no fileId returned');
  return d.fileId;
}
async function driveFetch(fileId) {
  if (memImg.has(fileId)) return memImg.get(fileId);
  let url = null;
  try { url = await DB.imgGet(fileId); } catch (e) {}
  if (!url) {
    const d = await Sync.call('driveGet', { fileId }, 90000);
    if (!d.data) throw new Error('empty');
    url = 'data:' + (d.mime || 'image/jpeg') + ';base64,' + d.data;
    DB.imgSet(fileId, url).catch(() => {});
  }
  memImg.set(fileId, url);
  return url;
}
async function driveDelete(fileId) {
  memImg.delete(fileId); DB.imgDel(fileId).catch(() => {});
  try { await Sync.call('driveDelete', { fileId }); } catch (e) { RLOG.warn('drive delete failed', e.message); }
}
function loadImage(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('read failed'));
    fr.onload = () => { const img = new Image(); img.onload = () => res({ img, src: fr.result }); img.onerror = () => rej(new Error('not an image')); img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}
function drawTo(img, maxDim) {
  const s = Math.min(1, maxDim / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
async function compressForSheet(file) {
  const { img } = await loadImage(file);
  for (const dim of [1100, 900, 700, 520]) {
    const cv = drawTo(img, dim);
    for (let q = 0.75; q >= 0.3; q -= 0.09) { const out = cv.toDataURL('image/jpeg', q); if (out.length <= IMG_MAX_CHARS) return out; }
  }
  throw new Error('too large');
}
async function prepForDrive(file) {
  const { img, src } = await loadImage(file);
  if (Math.max(img.width, img.height) <= DRIVE_MAXDIM && src.length < 6e6 && /^data:image\/(jpeg|png)/.test(src)) return src;
  return drawTo(img, DRIVE_MAXDIM).toDataURL('image/jpeg', DRIVE_Q);
}
/* Turns files into blob records; returns their ids. */
async function storeImages(files, already) {
  const ids = []; let failed = 0, fell = 0;
  const useDrive = driveOn();
  if (useDrive && files.length) toast('Uploading to Drive…', null, null, 20000);
  for (const f of files) {
    if (already + ids.length >= IMG_PER_NOTE) { toast(`Up to ${IMG_PER_NOTE} pictures per note.`); break; }
    let done = false;
    if (useDrive) {
      try {
        const dataUrl = await prepForDrive(f);
        const name = todayISO() + '-' + (f.name || 'image').replace(/[^\w.\- ]/g, '_');
        const fileId = await driveUpload(dataUrl, name);
        memImg.set(fileId, dataUrl); DB.imgSet(fileId, dataUrl).catch(() => {});
        ids.push(put({ id: uid('img'), type: 'blob', drive: true, fileId, name, bytes: Math.round(dataUrl.length * .75), deleted: false }, { render: false }).id);
        done = true;
      } catch (e) { RLOG.warn('drive upload failed', e.message); fell++; }
    }
    if (!done) {
      try { const data = await compressForSheet(f); ids.push(put({ id: uid('img'), type: 'blob', data, deleted: false }, { render: false }).id); }
      catch (e) { failed++; }
    }
  }
  if (failed) toast(`${failed} picture(s) couldn't be stored.`);
  else if (fell) toast(`Drive refused ${fell} — stored a smaller copy instead.`);
  else if (ids.length) toast(`${ids.length} picture${ids.length > 1 ? 's' : ''} added${useDrive ? ' to Drive' : ''}.`);
  return ids;
}
async function imgSrc(b) { if (!b) return ''; if (b.keyId) return secretImgSrc(b); return b.drive ? await driveFetch(b.fileId) : (b.data || ''); }
/* Fill <img data-blob="id"> placeholders inside root. */
function hydrateImgs(root) {
  $$('img[data-blob]', root).forEach(async im => {
    const b = records[im.dataset.blob];
    try { im.src = await imgSrc(b); im.alt = 'picture'; }
    catch (e) { im.alt = 'unavailable offline'; im.parentElement && im.parentElement.classList.add('muted'); }
  });
}
var openLightbox = function (src) { $('lbImg').src = src; $('lightbox').classList.remove('hidden'); }
$('lbClose').addEventListener('click', () => { $('lightbox').classList.add('hidden'); $('lbImg').src = ''; });


/* ==========================================================================
   TASKS
   ======================================================================== */
const CATS = ['Work', 'Personal', 'Finance', 'Errands'];
const OLD_CAT_MAP = { Learning: 'Personal', Tech: 'Work', Home: 'Errands' };
const PRIOS = ['High', 'Medium', 'Low'];
const PRIO_COLOR = { High: 'var(--seal)', Medium: 'var(--brass)', Low: '#4A6FA5' };
const catColor = c => `var(--cat-${CATS.includes(c) ? c : 'Work'})`;
const fixCat = c => CATS.includes(c) ? c : (OLD_CAT_MAP[c] || 'Work');
let activeCat = 'All';
const openSteps = new Set();         // view state only — which tasks show their steps

/* ---------- quick-add syntax: #cat !prio @date ---------- */
function parseQuickAddOld(text) {
  const out = { title: text, category: null, priority: null, dueDate: null };
  out.title = text
    .replace(/#(\w+)/g, (m, w) => {
      const c = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      if (CATS.includes(c)) { out.category = c; return ''; }
      if (OLD_CAT_MAP[c]) { out.category = OLD_CAT_MAP[c]; return ''; }
      return m;
    })
    .replace(/!(high|medium|med|low|h|m|l)\b/gi, (m, w) => { const p = w.toLowerCase()[0]; out.priority = p === 'h' ? 'High' : p === 'l' ? 'Low' : 'Medium'; return ''; })
    .replace(/@(\S+)/g, (m, w) => { const d = parseDateToken(w); if (d) { out.dueDate = d; return ''; } return m; })
    .replace(/\s{2,}/g, ' ').trim();
  return out;
}

/* ---------- offline keyword classifier (unchanged rules from v1) ---------- */
const CAT_WORDS = {
  Finance: ['bill', 'pay', 'payment', 'emi', 'loan', 'tax', 'gst', 'bank', 'insurance', 'premium', 'invoice', 'salary', 'rent', 'fee', 'fees', 'refund', 'investment', 'sip', 'mutual', 'fd', 'interest', 'recharge', 'credit', 'debit', 'installment', 'instalment', 'budget', 'money', 'cash', 'account', 'itc', 'tds', 'return'],
  Errands: ['buy', 'purchase', 'shop', 'shopping', 'grocery', 'groceries', 'pick up', 'pickup', 'drop', 'collect', 'market', 'order', 'deliver', 'delivery', 'courier', 'post', 'repair', 'service', 'servicing', 'fuel', 'petrol', 'laundry', 'haircut', 'appointment'],
  Personal: ['family', 'wife', 'son', 'daughter', 'mother', 'father', 'doctor', 'hospital', 'medicine', 'health', 'gym', 'exercise', 'birthday', 'anniversary', 'call', 'visit', 'temple', 'puja', 'school', 'homework', 'read', 'book', 'learn', 'course', 'study', 'friend', 'holiday', 'trip', 'travel', 'home', 'kitchen'],
  Work: ['office', 'file', 'filing', 'report', 'letter', 'draft', 'case', 'summons', 'notice', 'scn', 'audit', 'inspection', 'meeting', 'email', 'mail', 'send', 'submit', 'approve', 'review', 'sir', 'madam', 'department', 'officer', 'statement', 'panchanama', 'search', 'investigation', 'memo', 'noting']
};
const HIGH_WORDS = ['urgent', 'asap', 'immediately', 'today', 'critical', 'emergency', 'deadline', 'last date', 'overdue', 'now'];
const LOW_WORDS = ['someday', 'eventually', 'sometime', 'later', 'whenever', 'low priority', 'if time', 'maybe'];
const STRONG = {
  Finance: ['emi', 'gst', 'tds', 'itc', 'tax', 'loan', 'premium', 'invoice', 'salary', 'sip', 'recharge', 'instalment', 'installment'],
  Personal: ['doctor', 'hospital', 'medicine', 'birthday', 'anniversary', 'school', 'gym', 'wife', 'son', 'daughter', 'temple', 'puja'],
  Errands: ['grocery', 'groceries', 'shopping', 'courier', 'petrol', 'laundry', 'haircut'],
  Work: ['scn', 'panchanama', 'summons', 'audit', 'inspection', 'noting', 'assessee', 'commissionerate']
};
function classifyOld(title) {
  const t = ' ' + String(title || '').toLowerCase() + ' ';
  const hit = w => t.includes(' ' + w) || t.includes(w + ' ');
  let best = 'Work', bestScore = 0;
  for (const cat in CAT_WORDS) {
    let score = 0;
    CAT_WORDS[cat].forEach(w => { if (hit(w)) score++; });
    (STRONG[cat] || []).forEach(w => { if (hit(w)) score += 3; });
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  let prio = 'Medium';
  if (HIGH_WORDS.some(w => t.includes(w))) prio = 'High'; else if (LOW_WORDS.some(w => t.includes(w))) prio = 'Low';
  return { category: bestScore ? best : 'Work', priority: prio, matched: bestScore > 0 };
}

/* ---------- task helpers ---------- */
function normSub(s) { return { text: s.text || '', done: !!s.done, dueDate: s.dueDate || null, priority: PRIOS.includes(s.priority) ? s.priority : 'Medium', notes: s.notes || '', ...(+s.day ? { day: +s.day } : {}) }; }
const subOverdue = s => s.dueDate && !s.done && s.dueDate < todayISO();
const isOverdue = t => t.dueDate && t.status !== 'done' && t.dueDate < todayISO();
function newTask(fields) {
  return put({ id: uid('t'), type: 'task', title: '', category: 'Work', priority: 'Medium', dueDate: null, status: 'active',
    notes: '', repeat: 'none', subs: [], deleted: false, ...fields });
}
/* Add months, keeping the day (31 Jan → 28/29 Feb → 31 Mar); day = the original day of the month. */
function addMonthsKeep(d, n, day) {
  const y = d.getFullYear(), m = d.getMonth() + n, last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day || d.getDate(), last));
}
function shiftISO(iso, repeat, day) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return iso;
  if (repeat === 'daily') d.setDate(d.getDate() + 1); else if (repeat === 'weekly') d.setDate(d.getDate() + 7); else if (repeat === 'monthly') return isoLocal(addMonthsKeep(d, 1, day));
  return isoLocal(d);
}
function spawnRepeatOld(t) {
  const clone = { ...t, id: uid('t'), status: 'active', createdAt: nowMs(),
    subs: (t.subs || []).map(s => { const n = normSub(s); return { ...n, done: false, dueDate: shiftISO(n.dueDate, t.repeat) }; }) };
  delete clone.completedOn; delete clone.completedAt; delete clone._dirty; delete clone.spawnedId;
  const day = t.repeatDay || +(t.dueDate || todayISO()).slice(8, 10); clone.repeatDay = day;
  let nx = shiftISO(t.dueDate || todayISO(), t.repeat, day); const today = todayISO();
  for (let i = 0; nx < today && i < 1000; i++) nx = shiftISO(nx, t.repeat, day);      // completed late: next one is not already overdue
  clone.dueDate = nx;
  t.spawnedId = clone.id;
  put(clone, { render: false });
  return clone;
}
function setStatus(t, st) {
  const was = t.status; let spawned = null;
  t.status = st;
  if (st === 'waiting' && was !== 'waiting') t.waitingSince = todayISO(); else if (st !== 'waiting') delete t.waitingSince;   // v2.19: waiting on someone
  if (st === 'done') {
    t.completedOn = todayISO(); t.completedAt = nowMs();
    const already = t.spawnedId && records[t.spawnedId] && !records[t.spawnedId].deleted;   // reopened and done again: keep the one copy
    if (was !== 'done' && t.repeat && t.repeat !== 'none' && !already) spawned = spawnRepeat(t).id;
  } else { delete t.completedOn; delete t.completedAt; }
  put(t);
  return spawned;
}
function completeWithUndo(id) {
  const t = records[id]; if (!t) return;
  const prev = t.status;
  const spawned = setStatus(t, 'done');
  toast(`Done: ${t.title.slice(0, 32)}` + (spawned ? ' — next one scheduled' : ''), 'Undo', () => {
    setStatus(records[id], prev);
    if (spawned) { softDelete(spawned); delete records[id].spawnedId; put(records[id], { render: false }); }
  });
}
function cycleTask(id) {
  const t = records[id]; if (!t) return;
  if (t.status === 'active') setStatus(t, 'inprogress');
  else if (t.status === 'inprogress' || t.status === 'waiting') completeWithUndo(id);
  else setStatus(t, 'active');
}
function deleteWithUndo(id, label) {
  const r = records[id]; if (!r) return;
  softDelete(id);
  toast(`Deleted "${String(label || r.title || r.label || r.desc || 'item').slice(0, 28)}"`, 'Undo', () => restore(id));
}

/* ---------- rendering ---------- */
function stepHtml(s, i, tid) {
  const od = subOverdue(s), today = s.dueDate === todayISO() && !s.done;
  return `<div class="step ${s.done ? 'done' : ''}">
    <button class="check ${s.done ? 'done' : ''}" data-step="${tid}|${i}" aria-label="${s.done ? 'Mark step not done' : 'Mark step done'}: ${esc(s.text)}">${s.done ? '✓' : ''}</button>
    <div style="flex:1;min-width:0"><div class="step-text">${esc(s.text)}</div>
      ${s.dueDate || s.notes ? `<div class="step-meta ${od || today ? 'warn' : ''}">${s.dueDate ? relDay(s.dueDate) + (od ? ' · overdue' : '') : ''}${s.notes ? ' 📝' : ''}</div>` : ''}
    </div></div>`;
}
function taskRow(t, showCat) {
  const subs = (t.subs || []).map(normSub);
  const done = subs.filter(s => s.done).length, late = subs.filter(subOverdue).length;
  const open = prefs.stepsOpen ? !openSteps.has('!' + t.id) : (openSteps.has(t.id) || (late > 0 && !openSteps.has('!' + t.id)));
  const od = isOverdue(t), dueToday = t.dueDate === todayISO();
  const st = t.status === 'done' ? 'done' : t.status === 'inprogress' ? 'inprog' : t.status === 'waiting' ? 'wait' : '';
  const inner = `<div class="row task ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
    <i class="prio-bar" style="background:${PRIO_COLOR[t.priority] || 'var(--brass)'}"></i>
    <button class="check ${st}" data-cycle="${t.id}" aria-label="${t.status === 'done' ? 'Reopen' : t.status === 'inprogress' || t.status === 'waiting' ? 'Mark done' : 'Start'}: ${esc(t.title)}">${t.status === 'done' ? '✓' : t.status === 'waiting' ? '⏳' : ''}</button>
    <div class="row-main">
      <div class="row-title">${esc(t.title)}</div>
      <div class="row-sub">
        ${showCat ? `<span><i class="cat-dot" style="background:${catColor(t.category)}"></i> ${esc(t.category)}</span>` : ''}
        ${t.dueDate ? `<span class="${od || dueToday ? 'warn' : ''}">📅 ${relDay(t.dueDate)}${t.dueTime ? ' ' + fmtTime12(t.dueTime) : ''}${od ? ' · overdue' : ''}</span>` : ''}
        ${t.status === 'inprogress' ? '<span>◐ in progress</span>' : ''}
        ${t.status === 'waiting' ? `<span class="wait-pill">⏳ waiting${t.waitingOn ? ' on ' + esc(t.waitingOn) : ''}${t.waitingSince ? ' · ' + waitAge(t) : ''}</span>` : ''}
        ${t.status === 'done' && t.completedOn ? `<span>✓ ${fmtDate(t.completedOn)}</span>` : ''}
        ${t.repeat && t.repeat !== 'none' ? `<span>🔁 ${esc(t.repeat)}</span>` : ''}
        ${subs.length ? `<button class="toggle-steps" data-steps="${t.id}" aria-expanded="${open}">☑ ${done}/${subs.length} ${open ? '▾' : '▸'}</button>` : ''}
        ${late ? `<span class="warn">⚠ ${late} step${late > 1 ? 's' : ''} overdue</span>` : ''}
        ${t.notes ? '<span aria-label="has notes">📝</span>' : ''}
      </div>
      ${subs.length && open ? `<div class="steps">${subs.map((s, i) => stepHtml(s, i, t.id)).join('')}</div>` : ''}
    </div></div>`;
  return swipeHtml(inner, t.status === 'done' ? '↺ Reopen' : '✓ Done', 'Delete 🗑', `data-task="${t.id}"`);
}
function wireTaskRows(root) {
  $$('[data-task]', root).forEach(w => {
    const id = w.dataset.task;
    bindSwipe(w, () => { const t = records[id]; if (!t) return; t.status === 'done' ? setStatus(t, 'active') : completeWithUndo(id); },
                 () => deleteWithUndo(id));
    onTap(w, e => {
      if (e.target.closest('[data-cycle]')) { cycleTask(id); return; }
      const st = e.target.closest('[data-step]');
      if (st) { toggleStep(st.dataset.step); return; }
      if (e.target.closest('[data-steps]')) {
        const t = records[id], isOpen = e.target.closest('[data-steps]').getAttribute('aria-expanded') === 'true';
        if (isOpen) { openSteps.delete(id); openSteps.add('!' + id); } else { openSteps.add(id); openSteps.delete('!' + id); }
        renderTasks(); return;
      }
      previewTask(id);
    });
  });
}
function toggleStep(key) {
  const [id, i] = key.split('|'); const t = records[id]; if (!t) return;
  t.subs = (t.subs || []).map(normSub); if (!t.subs[+i]) return;
  t.subs[+i].done = !t.subs[+i].done;
  openSteps.add(id); openSteps.delete('!' + id);
  put(t);
  if (Sheets.isOpen('shTaskView')) previewTask(id);
}

const prioRank = { High: 0, Medium: 1, Low: 2 };
const byDueThenPrio = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || prioRank[a.priority] - prioRank[b.priority];
function renderTasks() {
  renderInboxCard(); updateInboxBadge();
  const tasks = all('task');
  const open = tasks.filter(t => t.status !== 'done');
  // category chips
  chipGroup($('catChips'), ['All', ...CATS].map(c => ({ v: c, l: `${c} ${c === 'All' ? open.length : open.filter(t => t.category === c).length}` })),
    activeCat, v => { activeCat = v; renderTasks(); }, c => c === 'All' ? 'var(--ink-faint)' : catColor(c));
  chipGroup($('taskModeChips'), [{ v: 'due', l: 'By date' }, { v: 'prio', l: 'By priority' }, { v: 'prog', l: 'In progress' }, { v: 'wait', l: `Waiting on${open.some(t => t.status === 'waiting') ? ' ' + open.filter(t => t.status === 'waiting').length : ''}` }, { v: 'new', l: 'Newest' }],
    prefs.taskMode, v => { setPref('taskMode', v); renderTasks(); });
  $$('#taskModeChips .chip').forEach(c => c.style.fontSize = '13px');

  let live = open.filter(t => activeCat === 'All' || t.category === activeCat);
  const showCat = activeCat === 'All';
  const today = todayISO(), weekEnd = addDays(7);
  let groups = [];
  if (prefs.taskMode === 'prio') groups = PRIOS.map(p => [p + ' priority', live.filter(t => t.priority === p).sort(byDueThenPrio)]);
  else if (prefs.taskMode === 'prog') groups = [['In progress', live.filter(t => t.status === 'inprogress').sort(byDueThenPrio)]];
  else if (prefs.taskMode === 'wait') groups = [['Waiting on', live.filter(t => t.status === 'waiting').sort((a, b) => String(a.waitingSince || '').localeCompare(String(b.waitingSince || '')) || byDueThenPrio(a, b))]];
  else if (prefs.taskMode === 'new') groups = [['Newest first', [...live].sort((a, b) => b.createdAt - a.createdAt)]];
  else {
    const g = { o: [], t: [], m: [], w: [], l: [], n: [], x: [] };
    live.forEach(t => {
      const d = t.dueDate;
      if (t.status === 'waiting' && !(d && d < today)) g.x.push(t);              // v2.19: waiting on someone, in its own group unless overdue
      else if (!d) g.n.push(t); else if (d < today) g.o.push(t); else if (d === today) g.t.push(t);
      else if (d === addDays(1)) g.m.push(t); else if (d <= weekEnd) g.w.push(t); else g.l.push(t);
    });
    groups = [['Overdue', g.o], ['Today', g.t], ['Tomorrow', g.m], ['This week', g.w], ['Later', g.l], ['No date', g.n], ['⏳ Waiting on', g.x]]
      .map(([k, v]) => [k, v.sort(byDueThenPrio)]);
  }
  groups = groups.filter(g => g[1].length);
  $('taskList').innerHTML = groups.length ? groups.map(([k, v]) =>
    `<div class="group-title">${k} <span class="gcount">${v.length}</span></div><div class="group">${v.map(t => taskRow(t, showCat)).join('')}</div>`).join('')
    : `<div class="empty"><b>${open.length ? 'Nothing here' : 'All clear'}</b>Tap + to add a task. Try “Draft ITC letter #work !high @tomorrow”.</div>`;
  wireTaskRows($('taskList'));

  // stats
  $('stActive').textContent = open.length;
  $('stToday').textContent = tasks.filter(t => t.completedOn === today).length;
  const od = tasks.filter(isOverdue).length;
  $('stOverdue').textContent = od; $('stOverdueBox').classList.toggle('warn', od > 0);
  $('taskSub').textContent = '';

  // completed (last 60 days)
  const cutoff = nowMs() - 60 * 86400000;
  const done = tasks.filter(t => t.status === 'done' && (!t.completedAt || t.completedAt > cutoff)).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  $('doneLbl').textContent = `Completed (${done.length})`;
  $('doneList').innerHTML = done.length ? done.map(t => taskRow(t, true)).join('') : '<div class="empty">Finished tasks collect here.</div>';
  wireTaskRows($('doneList'));

  // trash
  const tr = trashed().sort((a, b) => b.deletedAt - a.deletedAt);
  $('trashLbl').textContent = `Trash (${tr.length}) · emptied after 30 days`;
  $('trashList').innerHTML = tr.length ? tr.map(r => `<div class="row"><span class="pill">${esc(r.type)}</span>
      <div class="row-main"><div class="row-title">${esc(r.title || r.label || r.desc || '(untitled)')}</div><div class="row-sub">deleted ${timeAgo(r.deletedAt)}</div></div>
      <div class="row-end"><button class="btn small ghost" data-restore="${r.id}">Restore</button></div></div>`).join('')
    : '<div class="empty">Trash is empty.</div>';
  $$('[data-restore]', $('trashList')).forEach(b => b.addEventListener('click', () => { restore(b.dataset.restore); toast('Restored.'); }));
}

/* ---------- task preview (read-only) ---------- */
let viewTaskId = null;
/* v2.19 (B9): only things that look like phone numbers become call links — +country numbers, 0-prefixed numbers and
   10-digit Indian mobiles (6–9…). Account numbers, Aadhaar and other long numbers stay plain text. */
function telOk(raw) {
  const t = String(raw).trim(), d = t.replace(/\D/g, '');
  if (t[0] === '+') return d.length >= 10 && d.length <= 13;
  if (d[0] === '0') return d.length === 11 || d.length === 12;
  return d.length === 10 && /^[6-9]/.test(d);
}
function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
                .replace(/(^|[\s(])(\+?\d[\d\s-]{8,}\d)(?![\d-])/g, (m, p, n) => !telOk(n) ? m : `${p}<a href="tel:${n.replace(/[\s-]/g, '')}">${n}</a>`);   // dates are not phone numbers
}
function previewTask(id) {
  const t = records[id]; if (!t) return;
  viewTaskId = id;
  const subs = (t.subs || []).map(normSub);
  $('tvBody').innerHTML = `
    <h2 style="font-family:var(--serif);font-size:22px;margin:0 0 10px;line-height:1.3">${esc(t.title)}</h2>
    <div class="wrapchips" style="margin-bottom:14px">
      <span class="stamp" style="background:${catColor(t.category)}">${esc(t.category)}</span>
      <span class="pill" style="color:${PRIO_COLOR[t.priority]}">${esc(t.priority)}</span>
      ${t.dueDate ? `<span class="pill ${isOverdue(t) ? 'neg' : ''}">📅 ${relDay(t.dueDate)}${t.dueTime ? ' ' + fmtTime12(t.dueTime) : ''}${isOverdue(t) ? ' · overdue' : ''}</span>` : ''}
      ${t.status === 'inprogress' ? '<span class="pill">◐ in progress</span>' : ''}${t.status === 'waiting' ? `<span class="pill">⏳ waiting${t.waitingOn ? ' on ' + esc(t.waitingOn) : ''}${t.waitingSince ? ' · ' + waitAge(t) : ''}</span>` : ''}${t.status === 'done' ? `<span class="pill pos">✓ done ${fmtDate(t.completedOn)}</span>` : ''}
      ${t.repeat && t.repeat !== 'none' ? `<span class="pill">🔁 ${esc(t.repeat)}</span>` : ''}
    </div>
    ${subs.length ? `<div class="flabel">Steps ${subs.filter(s => s.done).length}/${subs.length}</div><div class="group" style="padding:4px 12px">${subs.map((s, i) => stepHtml(s, i, id)).join('')}</div>` : ''}
    ${t.notes ? `<div class="flabel">Notes</div><div style="white-space:pre-wrap;line-height:1.6;margin-bottom:14px">${linkify(esc(t.notes))}</div>` : ''}
    <div class="action-grid" style="grid-template-columns:repeat(5,1fr)">
      <button data-a="done"><b>${t.status === 'done' ? '↺' : '✓'}</b>${t.status === 'done' ? 'Reopen' : 'Done'}</button>
      <button data-a="prog"><b>◐</b>${t.status === 'inprogress' ? 'Not started' : 'Start'}</button>
      <button data-a="wait"><b>⏳</b>${t.status === 'waiting' ? 'Not waiting' : 'Waiting'}</button>
      <button data-a="dup"><b>⧉</b>Duplicate</button>
      <button data-a="del" class="danger"><b>🗑</b>Delete</button>
    </div>`;
  $$('[data-step]', $('tvBody')).forEach(b => b.addEventListener('click', () => toggleStep(b.dataset.step)));
  $$('[data-a]', $('tvBody')).forEach(b => b.addEventListener('click', () => {
    const tt = records[id], a = b.dataset.a;
    if (a === 'done') { tt.status === 'done' ? setStatus(tt, 'active') : completeWithUndo(id); Sheets.close('shTaskView'); }
    else if (a === 'prog') { setStatus(tt, tt.status === 'inprogress' ? 'active' : 'inprogress'); previewTask(id); }
    else if (a === 'wait') { if (tt.status === 'waiting') { setStatus(tt, 'active'); previewTask(id); } else { Sheets.close('shTaskView', true); openTaskEditor(id); setTimeout(() => { const b = $('teStatus').querySelector('[data-v="waiting"]'); if (b) b.click(); }, 60); } }
    else if (a === 'dup') { const c = { ...tt, id: uid('t'), status: 'active', waitingSince: undefined, title: tt.title + ' (copy)', createdAt: nowMs(), subs: (tt.subs || []).map(s => ({ ...normSub(s), done: false })) }; delete c.completedOn; delete c.completedAt; delete c._dirty; delete c.spawnedId; delete c.repeatDay; put(c); Sheets.close('shTaskView'); openTaskEditor(c.id); }
    else if (a === 'del') { Sheets.close('shTaskView'); deleteWithUndo(id); }
  }));
  Sheets.open('shTaskView');
}
$('tvEdit').addEventListener('click', () => { Sheets.close('shTaskView', true); openTaskEditor(viewTaskId); });

/* ---------- task editor (saves as you go) ---------- */
let editTaskId = null, editStep = -1, teTimer = null;
function openTaskEditor(id) {
  const t = records[id]; if (!t) return;
  editTaskId = id; editStep = -1;
  $('teTitle').value = t.title || '';
  chipGroup($('teCat'), CATS, t.category, v => { t.category = v; put(t, { render: false }); }, catColor);
  chipGroup($('tePrio'), PRIOS, t.priority, v => { t.priority = v; put(t, { render: false }); }, p => PRIO_COLOR[p]);
  chipGroup($('teStatus'), [{ v: 'active', l: 'To do' }, { v: 'inprogress', l: 'In progress' }, { v: 'waiting', l: '⏳ Waiting on' }, { v: 'done', l: 'Done' }], t.status, v => { setStatus(t, v); $('teWaitW').classList.toggle('hidden', v !== 'waiting'); if (v === 'waiting') setTimeout(() => $('teWait').focus(), 50); });
  $('teWait').value = t.waitingOn || ''; $('teWaitW').classList.toggle('hidden', t.status !== 'waiting');
  $('teDue').value = t.dueDate || ''; $('teTime').value = t.dueTime || '';
  $('teRepeat').value = t.repeat || 'none';
  $('teNotes').value = t.notes || '';
  $('teDueQuick').innerHTML = [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['No date', null]]
    .map(([l, n]) => `<button class="chip" data-d="${n}">${l}</button>`).join('');
  $$('#teDueQuick .chip').forEach(b => b.addEventListener('click', () => {
    t.dueDate = b.dataset.d === 'null' ? null : addDays(+b.dataset.d); delete t.repeatDay; $('teDue').value = t.dueDate || ''; put(t, { render: false });
  }));
  renderSteps();
  Sheets.open('shTask');
}
function teSave() {
  const t = records[editTaskId]; if (!t) return;
  t.title = $('teTitle').value.trim() || t.title;
  { const nd = $('teDue').value || null; if (nd !== t.dueDate) delete t.repeatDay; t.dueDate = nd; }   // a moved date sets the new repeat day
  t.dueTime = $('teTime').value || undefined; if (!t.dueTime) delete t.dueTime;
  t.repeat = $('teRepeat').value;
  t.notes = $('teNotes').value;
  { const w = $('teWait').value.trim(); if (t.status === 'waiting' && w) t.waitingOn = w; else delete t.waitingOn; }
  put(t, { render: false });
}
const teQueue = () => { clearTimeout(teTimer); teTimer = setTimeout(teSave, 400); };
['teTitle', 'teNotes', 'teWait'].forEach(i => $(i).addEventListener('input', teQueue));
['teDue', 'teTime', 'teRepeat'].forEach(i => $(i).addEventListener('change', teSave));
$('teTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('teTitle').blur(); } });
Sheets.onClose.shTask = () => { clearTimeout(teTimer); teSave(); scheduleRender(); };

function renderSteps() {
  const t = records[editTaskId]; if (!t) return;
  t.subs = (t.subs || []).map(normSub);
  const late = t.subs.filter(subOverdue).length;
  $('teStepCount').textContent = t.subs.length ? `(${t.subs.filter(s => s.done).length}/${t.subs.length}${late ? ` · ${late} overdue` : ''})` : '';
  $('teSteps').innerHTML = t.subs.map((s, i) => `
    <div class="step ${s.done ? 'done' : ''}" style="border-bottom:.5px solid var(--line);padding:8px 0">
      <button class="check ${s.done ? 'done' : ''}" data-sc="${i}" aria-label="Toggle step">${s.done ? '✓' : ''}</button>
      <button style="flex:1;text-align:left" data-so="${i}"><div class="step-text">${esc(s.text)}</div>
        <div class="step-meta ${subOverdue(s) ? 'warn' : ''}"><span style="color:${PRIO_COLOR[s.priority]}">●</span> ${esc(s.priority)}${s.dueDate ? ' · ' + relDay(s.dueDate) : ''}${s.notes ? ' · 📝' : ''}</div></button>
      <button class="icon-btn" data-sd="${i}" aria-label="Remove step" style="width:32px;height:32px;font-size:14px">✕</button>
    </div>
    ${editStep === i ? `<div class="sub-edit">
      <div class="field"><label>Step</label><input data-sf="text" value="${esc(s.text)}"></div>
      <div class="grid2"><div class="field"><label>Due</label><input type="date" data-sf="dueDate" value="${s.dueDate || ''}"></div>
        <div class="field"><label>Priority</label><select data-sf="priority">${PRIOS.map(p => `<option ${p === s.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div></div>
      <div class="field" style="margin:0"><label>Note</label><textarea data-sf="notes" rows="2">${esc(s.notes)}</textarea></div></div>` : ''}`).join('');
  const box = $('teSteps');
  $$('[data-sc]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.sc; t.subs[i].done = !t.subs[i].done; put(t, { render: false }); renderSteps(); }));
  $$('[data-so]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.so; editStep = editStep === i ? -1 : i; renderSteps(); }));
  $$('[data-sd]', box).forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.sd, removed = t.subs.splice(i, 1)[0]; editStep = -1; put(t, { render: false }); renderSteps();
    toast('Step removed', 'Undo', () => { t.subs.splice(i, 0, removed); put(t, { render: false }); renderSteps(); });
  }));
  $$('[data-sf]', box).forEach(el => {
    const commit = () => { const s = t.subs[editStep]; if (!s) return; let v = el.value; if (el.dataset.sf === 'text') { v = v.trim(); if (!v) return; } if (el.dataset.sf === 'dueDate') v = v || null; s[el.dataset.sf] = v; put(t, { render: false }); };
    if (el.tagName === 'SELECT' || el.type === 'date') el.addEventListener('change', () => { commit(); renderSteps(); });
    else { el.addEventListener('input', commit); el.addEventListener('blur', () => renderSteps()); }
  });
}
function addStep() {
  const t = records[editTaskId]; if (!t) return;
  const raw = $('teStepIn').value.trim(); if (!raw) return;
  const q = parseQuickAdd(raw); if (!q.title) return;
  t.subs = (t.subs || []).map(normSub);
  t.subs.push(normSub({ text: q.title, dueDate: q.dueDate, priority: q.priority || 'Medium' }));
  $('teStepIn').value = ''; put(t, { render: false }); renderSteps();
}
$('teStepAdd').addEventListener('click', addStep);
$('teStepIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });
$('teDelete').addEventListener('click', () => { const id = editTaskId; Sheets.close('shTask', true); deleteWithUndo(id); });
$('teRefile').addEventListener('click', () => {
  clearTimeout(teTimer); teSave();                                         // keep what was typed in the last moment
  const t = records[editTaskId]; const g = classify(t.title);
  t.category = g.category; t.priority = g.priority; put(t, { render: false }); openTaskEditor(t.id);
  toast(g.matched ? `Re-filed under ${g.category}.` : 'No strong match — left as Work.');
});
$('teTemplate').addEventListener('click', () => {
  const t = records[editTaskId]; teSave();
  put({ id: uid('tpl'), type: 'template', title: t.title, category: t.category, priority: t.priority, notes: t.notes || '',
        subs: (t.subs || []).map(s => ({ ...normSub(s), done: false, dueDate: null })) }, { render: false });
  toast('Saved as a template.');
});

/* ---------- templates ---------- */
function openTemplates() {
  const tpls = all('template');
  $('tplList').innerHTML = tpls.length ? tpls.map(t => `<div class="row"><div class="row-main"><div class="row-title">${esc(t.title)}</div>
      <div class="row-sub"><span><i class="cat-dot" style="background:${catColor(t.category)}"></i> ${esc(t.category)}</span><span>${esc(t.priority)}</span>${(t.subs || []).length ? `<span>${t.subs.length} steps</span>` : ''}</div></div>
      <div class="row-end"><button class="btn small" data-use="${t.id}">Use</button><button class="icon-btn" data-tdel="${t.id}" aria-label="Delete template">✕</button></div></div>`).join('')
    : '<div class="empty">No templates yet.</div>';
  $$('[data-use]', $('tplList')).forEach(b => b.addEventListener('click', () => {
    const t = records[b.dataset.use];
    const nt = newTask({ title: t.title, category: t.category, priority: t.priority, notes: t.notes || '', subs: (t.subs || []).map(s => ({ ...normSub(s), done: false })) });
    Sheets.close('shTpl', true); Sheets.close('shAdd', true); openTaskEditor(nt.id);
  }));
  $$('[data-tdel]', $('tplList')).forEach(b => b.addEventListener('click', () => { softDelete(b.dataset.tdel); openTemplates(); }));
  Sheets.open('shTpl');
}

/* ==========================================================================
   NOTES — board, folders, markdown, Word/Notepad-style editor
   ======================================================================== */
const NOTE_COLORS = ['note-c1', 'note-c2', 'note-c3', 'note-c4', 'note-c5'];
const NOTE_HEX = { 'note-c1': '#FBF9F2', 'note-c2': '#F3E7C9', 'note-c3': '#EFE1E6', 'note-c4': '#DCE7DD', 'note-c5': '#DDE6EF' };
const ncls = c => 'nc' + ((NOTE_COLORS.indexOf(c) + 1) || 1);
let activeFolder = '__all__';
const noteFolder = n => (n.folder || '').trim();
const folderList = () => [...new Set(all('note').map(noteFolder).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/* ---------- markdown (small, safe: everything is escaped first) ---------- */
function mdInline(s) {
  const keep = [];
  const hold = h => { keep.push(h); return '\u0000' + (keep.length - 1) + '\u0000'; };
  s = esc(s).replace(/\u0000/g, '');                       // the NUL is this function's own placeholder marker
  s = s.replace(/`([^`]+)`/g, (m, c) => hold(`<code>${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+|tel:[^)\s]+)\)/g, (m, t, u) => hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`));
  s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, u => hold(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`));
  s = s.replace(/(^|[\s(])(\+?\d[\d -]{8,}\d)(?=$|[\s),.])/g, (m, p, n) => !telOk(n) ? m : p + hold(`<a href="tel:${n.replace(/[ -]/g, '')}">${n}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
       .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, '$1<i>$2</i>')
       .replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
}
function md(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n');
  const out = []; let i = 0;
  const isList = l => /^(\s*)([-*+]|\d+[.)])\s+/.test(l);
  const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  while (i < L.length) {
    const line = L[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    let m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) { out.push(`<h${m[1].length}>${mdInline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = []; while (i < L.length && /^>\s?/.test(L[i])) buf.push(mdInline(L[i++].replace(/^>\s?/, '')));
      out.push(`<blockquote>${buf.join('<br>')}</blockquote>`); continue;
    }
    if (line.includes('|') && i + 1 < L.length && isTableSep(L[i + 1])) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => mdInline(c.trim()));
      const head = cells(line); i += 2; const rows = [];
      while (i < L.length && L[i].includes('|') && L[i].trim()) rows.push(cells(L[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (isList(line)) {
      // nested lists by indentation (2 spaces or a tab = one level)
      const stack = []; let html = '';
      while (i < L.length && (isList(L[i]) || (/^\s{2,}\S/.test(L[i]) && stack.length))) {
        const lm = L[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!lm) { html += '<br>' + mdInline(L[i].trim()); i++; continue; }
        const lvl = Math.floor(lm[1].replace(/\t/g, '  ').length / 2);
        const tag = /\d/.test(lm[2]) ? 'ol' : 'ul';
        while (stack.length > lvl + 1) html += `</li></${stack.pop()}>`;
        if (stack.length === lvl + 1 && stack[lvl] !== tag) html += `</li></${stack.pop()}>`;
        if (stack.length < lvl + 1) { while (stack.length < lvl + 1) { html += `<${tag}${tag === 'ol' && stack.length === lvl ? ` start="${parseInt(lm[2], 10) || 1}"` : ''}>`; stack.push(tag); } }
        else html += '</li>';
        const cb = lm[3].match(/^\[([ xX])\]\s*(.*)$/);
        html += cb ? `<li class="cb" data-ln="${i}" role="checkbox" aria-checked="${cb[1] !== ' '}">${cb[1] !== ' ' ? '☑' : '☐'} ${cb[1] !== ' ' ? `<del>${mdInline(cb[2])}</del>` : mdInline(cb[2])}`
                   : `<li>${mdInline(lm[3])}`;
        i++;
      }
      while (stack.length) html += `</li></${stack.pop()}>`;
      out.push(html); continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < L.length && L[i].trim() && !isList(L[i]) && !/^(#{1,3}\s|>|```)/.test(L[i]) && !/^\s*(-{3,}|\*{3,})\s*$/.test(L[i])
           && !(L[i].includes('|') && i + 1 < L.length && isTableSep(L[i + 1]))) buf.push(mdInline(L[i++]));
    out.push(`<p>${buf.join('<br>')}</p>`);
  }
  return out.join('');
}
const plainText = s => String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~=|]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*[-+]\s+(\[[ xX]\]\s*)?/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();

/* ---------- duplicates ---------- */
const normText = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function dupGroups() {
  const by = {};
  all('note').forEach(n => { const t = normText((n.title || '') + ' ' + (n.text || '')); if (t.length < 12) return; (by[t.slice(0, 300)] = by[t.slice(0, 300)] || []).push(n); });
  return Object.values(by).filter(g => g.length > 1);
}

/* ---------- board ---------- */
function sortNotes(list, by) {
  const c = [...list];
  if (by === 'pinned') c.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  else if (by === 'recent') c.sort((a, b) => b.updatedAt - a.updatedAt);
  else if (by === 'az') c.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else c.sort((a, b) => b.createdAt - a.createdAt);
  return c;
}
function noteCard(n, dups) {
  const title = (n.title || '').trim();
  const snip = plainText(n.text).slice(0, 220);
  return `<button class="note-card ${ncls(n.color)} ${n.pinned ? 'pinned' : ''}" data-note="${n.id}" aria-label="Note: ${esc(title || 'untitled')}">
    <div class="nt">${title ? esc(title) : '<span class="muted" style="font-style:italic;font-weight:400">Untitled</span>'}</div>
    ${snip ? `<div class="nx">${esc(snip)}</div>` : ''}
    <div class="nf">${n.folder && activeFolder === '__all__' ? `<span class="pill">📁 ${esc(n.folder)}</span>` : ''}${(n.imgs || []).length ? `<span>🖼 ${n.imgs.length}</span>` : ''}${(n.docRefs || []).length ? `<span>📎 ${n.docRefs.length}</span>` : ''}${dups.has(n.id) ? '<span class="pill neg">duplicate?</span>' : ''}<span>${timeAgo(n.updatedAt)}</span></div>
  </button>`;
}
function renderNotes() {
  const notes = all('note');
  $('noteSub').textContent = notes.length ? notes.length + '' : '';
  chipGroup($('noteSortChips'), [{ v: 'pinned', l: 'Pinned first' }, { v: 'recent', l: 'Recently edited' }, { v: 'created', l: 'Newest' }, { v: 'az', l: 'A–Z' }],
    prefs.noteSort, v => { setPref('noteSort', v); renderNotes(); });
  const dups = new Set(); dupGroups().forEach(g => g.forEach(n => dups.add(n.id)));
  const area = $('notesArea');
  if (!notes.length) { area.innerHTML = '<div class="empty"><b>No notes yet</b>Tap + and choose Note — or paste something straight in.</div>'; return; }
  let html = '';
  if (activeFolder === '__all__') {
    const fs = folderList();
    if (fs.length) html += `<div class="folders">${fs.map(f => { const inside = notes.filter(n => noteFolder(n) === f);
      return `<button class="folder" data-folder="${esc(f)}"><b>📁 ${esc(f)}</b><span>${inside.length} note${inside.length > 1 ? 's' : ''} · ${timeAgo(Math.max(...inside.map(n => n.updatedAt)))}</span></button>`; }).join('')}</div>`;
    const loose = sortNotes(notes.filter(n => !noteFolder(n)), prefs.noteSort);
    html += loose.length ? `<div class="notes-grid">${loose.map(n => noteCard(n, dups)).join('')}</div>` : '';
  } else {
    const list = sortNotes(notes.filter(n => noteFolder(n) === activeFolder), prefs.noteSort);
    html += `<div class="back-row"><button class="chip" id="folderBack">‹ All notes</button><b style="font-size:16px">📁 ${esc(activeFolder)}</b><span class="muted">${list.length}</span></div>`;
    html += list.length ? `<div class="notes-grid">${list.map(n => noteCard(n, dups)).join('')}</div>` : '<div class="empty">This folder is empty.</div>';
  }
  area.innerHTML = html;
  $$('[data-folder]', area).forEach(b => b.addEventListener('click', () => { activeFolder = b.dataset.folder; renderNotes(); $('main').scrollTop = 0; }));
  const back = $('folderBack'); if (back) back.addEventListener('click', () => { activeFolder = '__all__'; renderNotes(); });
  $$('[data-note]', area).forEach(b => b.addEventListener('click', () => prefs.noteEdit ? openNoteEditor(b.dataset.note) : previewNote(b.dataset.note)));
}

/* ---------- preview (read-only, typeset) ---------- */
let viewNoteId = null;
function previewNote(id) {
  const n = records[id]; if (!n) return;
  viewNoteId = id;
  $('nvHead').textContent = n.type === 'snote' ? '🔒 Private note' : (noteFolder(n) || 'Note');
  $('nvMeta').textContent = [n.pinned ? '📌 Pinned' : '', 'Edited ' + timeAgo(n.updatedAt), wordStats(n.text).words + ' words'].filter(Boolean).join(' · ');
  $('nvTitle').textContent = n.title || 'Untitled';
  $('nvBody').innerHTML = n.text ? md(n.text) : '<p class="muted"><i>Empty note — tap Edit to start writing.</i></p>';
  const imgs = (n.imgs || []).map(i => records[i]).filter(b => b && !b.deleted);
  $('nvImgs').innerHTML = imgs.map(b => `<div class="img"><img data-blob="${b.id}" alt="loading"></div>`).join('') +
    `<div class="action-grid" style="width:100%">
      <button data-na="edit"><b>✎</b>Edit</button><button data-na="pin"><b>📌</b>${n.pinned ? 'Unpin' : 'Pin'}</button>
      <button data-na="share"><b>⤴︎</b>Share</button><button data-na="del" class="danger"><b>🗑</b>Delete</button></div>`;
  hydrateImgs($('nvImgs'));
  $$('img[data-blob]', $('nvImgs')).forEach(im => im.addEventListener('click', () => im.src && openLightbox(im.src)));
  $$('[data-na]', $('nvImgs')).forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.na, nn = records[id];
    if (a === 'edit') { Sheets.close('shNoteView', true); openNoteEditor(id); }
    else if (a === 'pin') { nn.pinned = !nn.pinned; put(nn); previewNote(id); }
    else if (a === 'share') shareNote(nn);
    else if (a === 'del') { Sheets.close('shNoteView', true); deleteNote(id); }
  }));
  // tick checklist items straight from the reading view
  $$('li.cb', $('nvBody')).forEach(li => li.addEventListener('click', () => { toggleCheckLine(id, +li.dataset.ln); previewNote(id); }));
  Sheets.open('shNoteView');
}
$('nvEdit').addEventListener('click', () => { Sheets.close('shNoteView', true); openNoteEditor(viewNoteId); });
function toggleCheckLine(id, ln) {
  const n = records[id]; if (!n) return;
  const lines = (n.text || '').split('\n');
  if (lines[ln] == null) return;
  lines[ln] = lines[ln].replace(/\[([ xX])\]/, (m, c) => c === ' ' ? '[x]' : '[ ]');
  n.text = lines.join('\n'); put(n, { render: false });
}

/* ---------- creation / deletion ---------- */
function newNote(text, title, open, folder) {
  const inFolder = folder != null ? folder : activeFolder !== '__all__' ? activeFolder : '';
  const t = text || '';
  const n = put({ id: uid('n'), type: 'note', title: title != null ? title : (t.split('\n')[0] || '').replace(/^#+\s*/, '').trim().slice(0, 60),
    text: t, color: NOTE_COLORS[Math.floor(Math.random() * 5)], pinned: false, folder: inFolder, docRefs: [], imgs: [], deleted: false });
  if (open !== false) openNoteEditor(n.id);
  return n;
}
function deleteNote(id) {
  const n = records[id]; if (!n) return;
  softDelete(id);
  toast(`Deleted "${(n.title || 'note').slice(0, 26)}"`, 'Undo', () => restore(id));
}

/* ---------- editor ---------- */
let editNoteId = null, neTimer = null, neOriginal = null, nePreview = false;
const ta = () => $('neBody');
function wordStats(text) {
  const t = String(text || '');
  const words = (t.match(/[A-Za-z0-9ऀ-ॿ઀-૿'’-]+/g) || []).length;
  return { words, chars: t.length, mins: Math.max(1, Math.round(words / 200)) };
}
function updateCount() {
  const el = ta(), s = wordStats(el.value);
  const selTxt = el.value.slice(el.selectionStart, el.selectionEnd);
  const sel = selTxt ? ` · ${wordStats(selTxt).words} selected` : '';
  $('neCount').textContent = `${s.words.toLocaleString('en-IN')} words · ${s.chars.toLocaleString('en-IN')} characters · ${s.mins} min read${sel}`;
}
function openNoteEditor(id) {
  const n = records[id]; if (!n) return;
  editNoteId = id; neOriginal = { title: n.title || '', text: n.text || '' }; nePreview = false;
  $('neTitle').value = n.title || '';
  ta().value = n.text || '';
  ta().style.display = ''; $('nePreview').style.display = 'none';
  $('neSaved').textContent = 'Note';
  $('neFind').classList.add('hidden');
  resetUndo(); renderEditorImgs(); updateCount(); neFolderInit();
  Sheets.open('shNote');
  if (!n.text && !n.title) setTimeout(() => $('neTitle').focus(), 350);
}
function neSave() {
  const n = records[editNoteId]; if (!n) return;
  if (n.title === $('neTitle').value && n.text === ta().value) return;
  n.title = $('neTitle').value; n.text = ta().value;
  put(n, { render: false });
  $('neSaved').textContent = 'Saved ✓';
  clearTimeout(neSave.t); neSave.t = setTimeout(() => { $('neSaved').textContent = 'Note'; }, 1200);
}
const neQueue = () => { clearTimeout(neTimer); neTimer = setTimeout(neSave, 400); };
$('neTitle').addEventListener('input', neQueue);
ta().addEventListener('input', () => { neQueue(); undoOnType(); updateCount(); });
document.addEventListener('selectionchange', () => { if (document.activeElement === ta()) updateCount(); });
Sheets.onClose.shNote = async () => {
  Dictate.stop(); { const nf = $('neFolderNew'); if (!nf.classList.contains('hidden') && nf.value.trim()) nf.blur(); }
  clearTimeout(neTimer); neSave();
  const n = records[editNoteId];
  if (n && n.type !== 'snote' && neOriginal && (neOriginal.text !== n.text || neOriginal.title !== n.title) && (neOriginal.text || neOriginal.title)) await saveVersion(n.id, neOriginal);
  if (n && !n.title.trim() && !n.text.trim() && !(n.imgs || []).length) { softDelete(n.id, { render: false }); RLOG.info('discarded empty note'); }
  scheduleRender();
};

/* paste pictures straight into the body */
ta().addEventListener('paste', e => {
  const files = [...(e.clipboardData && e.clipboardData.items || [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  if (files.length) { e.preventDefault(); addNoteImages(files); }
});

/* ---- undo / redo (own history, so toolbar actions are undoable too) ---- */
let undoStack = [], redoStack = [], undoPrev = '', undoT = null;
function resetUndo() { undoStack = []; redoStack = []; undoPrev = ta().value; clearTimeout(undoT); }
function undoPush(v) { undoStack.push(v); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
function undoCommit() { clearTimeout(undoT); const v = ta().value; if (v !== undoPrev) { undoPush(undoPrev); undoPrev = v; } }
function undoOnType() { clearTimeout(undoT); undoT = setTimeout(undoCommit, 600); }
function setBody(v, selStart, selEnd) {
  ta().value = v; undoPrev = v;
  if (selStart != null) ta().setSelectionRange(selStart, selEnd != null ? selEnd : selStart);
  neQueue(); updateCount();
}
$('neUndo').addEventListener('click', () => { undoCommit(); if (!undoStack.length) return toast('Nothing to undo.'); redoStack.push(ta().value); const p = undoStack.pop(); setBody(p, p.length); });
$('neRedo').addEventListener('click', () => { if (!redoStack.length) return toast('Nothing to redo.'); undoStack.push(ta().value); const n = redoStack.pop(); setBody(n, n.length); });

/* ---- formatting toolbar (keeps focus + selection in the textarea) ---- */
$$('#neBar button').forEach(b => {
  let x0 = 0, y0 = 0;
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  // a tap (not a scroll of the toolbar) acts without stealing the keyboard/selection from the text
  b.addEventListener('touchend', e => { const t = e.changedTouches[0]; if (Math.abs(t.clientX - x0) < 10 && Math.abs(t.clientY - y0) < 10) { e.preventDefault(); b.click(); } });
});
function lineBounds(v, s, e) { const a = v.lastIndexOf('\n', s - 1) + 1; let b = v.indexOf('\n', e); if (b < 0) b = v.length; return [a, b]; }
function wrapSel(before, after, placeholder) {
  undoCommit();
  const el = ta(), v = el.value, s = el.selectionStart, e = el.selectionEnd, sel = v.slice(s, e) || placeholder || 'text';
  const nv = v.slice(0, s) + before + sel + after + v.slice(e);
  undoPush(v); setBody(nv, s + before.length, s + before.length + sel.length);
}
function prefixLines(fn) {
  undoCommit();
  const el = ta(), v = el.value, [a, b] = lineBounds(v, el.selectionStart, el.selectionEnd);
  const lines = v.slice(a, b).split('\n').map(fn);
  const block = lines.join('\n');
  undoPush(v); setBody(v.slice(0, a) + block + v.slice(b), a, a + block.length);
}
function insertText(txt) {
  undoCommit();
  const el = ta(), v = el.value, s = el.selectionStart, e = el.selectionEnd;
  undoPush(v); setBody(v.slice(0, s) + txt + v.slice(e), s + txt.length);
}
const stampNow = () => new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
$$('#neBar [data-md]').forEach(b => b.addEventListener('click', () => {
  if (nePreview) togglePreview();
  const k = b.dataset.md;
  if (k === 'bold') wrapSel('**', '**'); else if (k === 'italic') wrapSel('*', '*');
  else if (k === 'strike') wrapSel('~~', '~~'); else if (k === 'mark') wrapSel('==', '==');
  else if (k === 'code') wrapSel('`', '`'); else if (k === 'link') wrapSel('[', '](https://)', 'link text');
  else if (k === 'h2') prefixLines(l => l.startsWith('## ') ? l.slice(3) : '## ' + l.replace(/^#+\s*/, ''));
  else if (k === 'ul') prefixLines(l => /^\s*[-*+] /.test(l) ? l.replace(/^(\s*)[-*+] /, '$1') : '- ' + l);
  else if (k === 'ol') { let n = 0; prefixLines(l => /^\s*\d+[.)] /.test(l) ? l.replace(/^(\s*)\d+[.)] /, '$1') : (++n) + '. ' + l); }
  else if (k === 'check') prefixLines(l => /^\s*[-*+] \[[ xX]\] /.test(l) ? l.replace(/^(\s*)[-*+] \[[ xX]\] /, '$1') : '- [ ] ' + l.replace(/^\s*[-*+] /, ''));
  else if (k === 'quote') prefixLines(l => l.startsWith('> ') ? l.slice(2) : '> ' + l);
  else if (k === 'indent') prefixLines(l => '  ' + l);
  else if (k === 'outdent') prefixLines(l => l.replace(/^( {1,2}|\t)/, ''));
  else if (k === 'hr') insertText('\n---\n');
  else if (k === 'table') insertText('\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n');
  else if (k === 'stamp') insertText(stampNow() + ' — ');
}));

/* ---- lists carry on when you press Return (like Word) ---- */
ta().addEventListener('beforeinput', e => {
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  const el = ta(), v = el.value, s = el.selectionStart;
  if (s !== el.selectionEnd) return;
  const a = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(a, s);
  const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )(.*)$/);
  if (!m) return;
  e.preventDefault();
  undoCommit(); undoPush(v);
  if (!m[5].trim()) {                                    // empty item → end the list
    setBody(v.slice(0, a) + v.slice(s), a);
    return;
  }
  let marker = m[2];
  if (m[3]) marker = (parseInt(m[3], 10) + 1) + m[4] + ' ';
  else if (/\[[ xX]\]/.test(marker)) marker = marker[0] + ' [ ] ';
  const ins = '\n' + m[1] + marker;
  setBody(v.slice(0, s) + ins + v.slice(s), s + ins.length);
});
/* hardware-keyboard shortcuts (iPad / Magic Keyboard) */
ta().addEventListener('keydown', e => {
  if (e.key === 'Tab') { e.preventDefault(); prefixLines(l => e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l); return; }
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); wrapSel('**', '**'); } else if (k === 'i') { e.preventDefault(); wrapSel('*', '*'); }
  else if (k === 'f') { e.preventDefault(); openFind(); }
  else if (k === 'z') { e.preventDefault(); $(e.shiftKey ? 'neRedo' : 'neUndo').click(); }
});

/* ---- preview toggle ---- */
function togglePreview() {
  nePreview = !nePreview;
  if (nePreview) { $('nePreview').innerHTML = md(ta().value); $$('li.cb', $('nePreview')).forEach(li => li.addEventListener('click', () => { const lines = ta().value.split('\n'); const ln = +li.dataset.ln; lines[ln] = lines[ln].replace(/\[([ xX])\]/, (m, c) => c === ' ' ? '[x]' : '[ ]'); setBody(lines.join('\n')); $('nePreview').innerHTML = md(ta().value); togglePreview(); togglePreview(); })); }
  $('nePreview').style.display = nePreview ? '' : 'none'; ta().style.display = nePreview ? 'none' : '';
  $('nePrevBtn').textContent = nePreview ? '✎' : '👁';
}
$('nePrevBtn').addEventListener('click', togglePreview);

/* ---- find & replace ---- */
let findHits = [], findIdx = -1;
function openFind() {
  $('neFind').classList.remove('hidden');
  const el = ta(); const sel = el.value.slice(el.selectionStart, el.selectionEnd);
  if (sel && sel.length < 60) $('neFindIn').value = sel;
  $('neFindIn').focus(); runFind();
}
function runFind() {
  const q = $('neFindIn').value; findHits = []; findIdx = -1;
  if (q) { const v = ta().value.toLowerCase(), ql = q.toLowerCase(); let p = v.indexOf(ql); while (p >= 0) { findHits.push(p); p = v.indexOf(ql, p + Math.max(1, ql.length)); } }
  $('neFindCount').textContent = q ? (findHits.length ? `0/${findHits.length}` : 'none') : '';
}
function gotoHit(dir) {
  if (!findHits.length) return;
  findIdx = (findIdx + dir + findHits.length) % findHits.length;
  const p = findHits[findIdx], len = $('neFindIn').value.length, el = ta();
  el.focus(); el.setSelectionRange(p, p + len);
  // bring the match into view inside the textarea
  const before = el.value.slice(0, p).split('\n').length;
  el.scrollTop = Math.max(0, (before - 3) * parseFloat(getComputedStyle(el).lineHeight || 24));
  $('neFindCount').textContent = `${findIdx + 1}/${findHits.length}`;
}
$('neFindBtn').addEventListener('click', () => $('neFind').classList.contains('hidden') ? openFind() : $('neFind').classList.add('hidden'));
$('neFindIn').addEventListener('input', runFind);
$('neFindIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gotoHit(1); } });
$('neFindNext').addEventListener('click', () => gotoHit(1));
$('neFindPrev').addEventListener('click', () => gotoHit(-1));
$('neFindClose').addEventListener('click', () => $('neFind').classList.add('hidden'));
$('neRepl').addEventListener('click', () => {
  const q = $('neFindIn').value; if (!q || !findHits.length) return;
  if (findIdx < 0) findIdx = 0;
  const p = findHits[findIdx], v = ta().value, r = $('neReplIn').value;
  undoCommit(); undoPush(v); setBody(v.slice(0, p) + r + v.slice(p + q.length), p + r.length);
  runFind(); if (findHits.length) { findIdx = -1; gotoHit(1); }
});
$('neReplAll').addEventListener('click', () => {
  const q = $('neFindIn').value; if (!q || !findHits.length) return;
  const n = findHits.length, v = ta().value;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  undoCommit(); undoPush(v); setBody(v.replace(re, () => $('neReplIn').value));
  runFind(); toast(`Replaced ${n} match${n > 1 ? 'es' : ''}.`, 'Undo', () => $('neUndo').click());
});

/* ---- pictures ---- */
$('neImgBtn').addEventListener('click', () => $('neImgFile').click());
$('neImgFile').addEventListener('change', e => { if (e.target.files.length) addNoteImages([...e.target.files]); e.target.value = ''; });
async function addNoteImages(files) {
  const n = records[editNoteId]; if (!n) return;
  n.imgs = n.imgs || [];
  const ids = n.type === 'snote' ? await storeSecretImages(files, n.imgs.length) : await storeImages(files, n.imgs.length);
  if (ids.length) { n.imgs.push(...ids); put(n, { render: false }); }
  renderEditorImgs();
}
function renderEditorImgs() {
  const n = records[editNoteId]; if (!n) return;
  const imgs = (n.imgs || []).map(i => records[i]).filter(b => b && !b.deleted);
  $('neImgs').innerHTML = imgs.map(b => `<div class="img"><img data-blob="${b.id}" alt="loading"><button data-rm="${b.id}" aria-label="Remove picture">✕</button></div>`).join('');
  $('neImgInfo').textContent = imgs.length ? `${imgs.length}/${IMG_PER_NOTE} pictures${imgs.some(b => b.drive) ? ' · stored in Drive' : ''}` : '';
  hydrateImgs($('neImgs'));
  $$('img[data-blob]', $('neImgs')).forEach(im => im.addEventListener('click', () => im.src && openLightbox(im.src)));
  $$('[data-rm]', $('neImgs')).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.rm, rec = records[id];
    n.imgs = (n.imgs || []).filter(x => x !== id); put(n, { render: false });
    softDelete(id, { render: false });
    renderEditorImgs();
    toast('Picture removed', 'Undo', () => { restore(id); n.imgs.push(id); put(n, { render: false }); renderEditorImgs(); });
    if (rec && rec.drive) setTimeout(() => { if (records[id] && records[id].deleted) driveDelete(rec.fileId); }, 7000);
  }));
}

/* ---- options sheet ---- */
$('neMore').addEventListener('click', () => {
  const n = records[editNoteId]; if (!n) return;
  neSave();
  $('nmFolder').value = n.folder || '';
  $('folderDl').innerHTML = folderList().map(f => `<option value="${esc(f)}">`).join('');
  $('nmSwatches').innerHTML = NOTE_COLORS.map(c => `<button class="swatch ${n.color === c ? 'on' : ''}" data-c="${c}" style="background:${NOTE_HEX[c]}" aria-label="Colour ${c.slice(-1)}"></button>`).join('');
  $$('[data-c]', $('nmSwatches')).forEach(s => s.addEventListener('click', () => { n.color = s.dataset.c; put(n, { render: false }); $$('.swatch', $('nmSwatches')).forEach(x => x.classList.toggle('on', x === s)); }));
  const docs = all('doc');
  $('nmDocs').innerHTML = docs.length ? docs.map(d => `<button class="chip ${(n.docRefs || []).includes(d.id) ? 'on' : ''}" data-doc="${d.id}">📎 ${esc(d.title)}</button>`).join('') : '<span class="hint">No documents yet.</span>';
  $$('[data-doc]', $('nmDocs')).forEach(c => c.addEventListener('click', () => {
    n.docRefs = n.docRefs || []; const id = c.dataset.doc;
    n.docRefs = n.docRefs.includes(id) ? n.docRefs.filter(x => x !== id) : [...n.docRefs, id];
    c.classList.toggle('on'); put(n, { render: false });
  }));
  $('nmPin').querySelector('span').textContent = n.pinned ? 'Unpin' : 'Pin';
  ['nmTask', 'nmVersions', 'nmClone', 'nmDup'].forEach(x => $(x).classList.toggle('hidden', n.type === 'snote'));
  Sheets.open('shNoteMore');
});
$('nmFolder').addEventListener('change', () => { const n = records[editNoteId]; n.folder = $('nmFolder').value.trim(); put(n, { render: false }); });
$('nmPin').addEventListener('click', () => { const n = records[editNoteId]; n.pinned = !n.pinned; put(n, { render: false }); $('nmPin').querySelector('span').textContent = n.pinned ? 'Unpin' : 'Pin'; toast(n.pinned ? 'Pinned.' : 'Unpinned.'); });
$('nmCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(ta().value); toast('Copied to clipboard.'); } catch (e) { toast('Could not copy — select the text instead.'); } });
$('nmShare').addEventListener('click', () => shareNote(records[editNoteId]));
$('nmExport').addEventListener('click', async () => { const n = records[editNoteId]; shareOrDownload(await noteMarkdown(n), safeName(n) + '.md', 'text/markdown'); });
$('nmTxt').addEventListener('click', () => { const n = records[editNoteId]; shareOrDownload((n.title ? n.title + '\n\n' : '') + plainText(n.text) + '\n', safeName(n) + '.txt', 'text/plain'); });
$('nmPrint').addEventListener('click', () => printNote(records[editNoteId]));
$('nmTask').addEventListener('click', () => {
  const n = records[editNoteId]; const title = (n.title || n.text || '').split('\n')[0].trim().slice(0, 90) || 'Follow up on note';
  const g = classify(title);
  const t = newTask({ title, category: g.category, priority: g.priority, notes: 'From note: ' + (n.title || '') + '\n\n' + (n.text || '').slice(0, 500), linkedNote: n.id });
  Sheets.closeAll(); showTab('tasks'); openTaskEditor(t.id);
});
$('nmClone').addEventListener('click', () => {
  const n = records[editNoteId];
  Sheets.close('shNoteMore', true); Sheets.close('shNote');
  const c = newNote(n.text, (n.title || 'Untitled') + ' (copy)', false);
  c.folder = n.folder; c.color = n.color; put(c, { render: false });
  openNoteEditor(c.id); toast('Duplicated.');
});
$('nmDelete').addEventListener('click', () => { const id = editNoteId; Sheets.close('shNoteMore', true); Sheets.close('shNote', true); deleteNote(id); });
$('nmDup').addEventListener('click', openDuplicates);
$('nmVersions').addEventListener('click', openVersions);

const safeName = n => ((n.title || 'note').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'note');
async function noteMarkdown(n) {
  let out = '# ' + (n.title || 'Untitled note') + '\n\n';
  if (n.folder) out += '_Folder: ' + n.folder + '_\n\n';
  out += (n.text || '') + '\n\n---\n_Exported ' + new Date().toLocaleString('en-IN') + ' from Register_\n';
  return out;
}
async function shareNote(n) {
  const text = (n.title ? n.title + '\n\n' : '') + (n.text || '');
  try { if (navigator.share) { await navigator.share({ title: n.title || 'Note', text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Copied — paste it anywhere.'); } catch (e) { toast('Sharing is not available here.'); }
}
async function printNote(n) {
  const imgs = (n.imgs || []).map(i => records[i]).filter(b => b && !b.deleted);
  const srcs = []; for (const b of imgs) { try { srcs.push(await imgSrc(b)); } catch (e) {} }
  $('printArea').innerHTML = `<div style="font-family:Georgia,serif;padding:10px"><h1>${esc(n.title || 'Untitled note')}</h1>${n.folder ? `<p style="color:#666"><i>${esc(n.folder)}</i></p>` : ''}
    <div class="md">${md(n.text || '')}</div>${srcs.map(s => `<img src="${s}" style="max-width:100%;margin:10px 0">`).join('')}
    <hr><p style="color:#666;font-size:12px">Printed ${new Date().toLocaleString('en-IN')}</p></div>`;
  setTimeout(() => window.print(), 100);     // iPhone: print sheet → pinch out → Save to Files as PDF
}

/* ---- version history (kept on this device) ---- */
async function saveVersion(id, v) {
  try {
    const key = 'ver:' + id, list = (await DB.get(key)) || [];
    if (list.length && list[0].text === v.text && list[0].title === v.title) return;
    list.unshift({ at: nowMs(), title: v.title, text: v.text });
    await DB.set(key, list.slice(0, 10));
  } catch (e) { RLOG.warn('version save failed', e); }
}
async function openVersions() {
  const n = records[editNoteId]; neSave();
  const list = (await DB.get('ver:' + n.id)) || [];
  $('verList').innerHTML = list.length ? list.map((v, i) => `<div class="ver"><div class="d"><b>${new Date(v.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>
      <div>${esc((v.title || 'Untitled') + ' — ' + plainText(v.text).slice(0, 80))}</div><div>${wordStats(v.text).words} words</div></div>
      <button class="btn small ghost" data-vv="${i}">View</button><button class="btn small" data-vr="${i}">Restore</button></div>`).join('')
    : '<div class="empty">No earlier versions yet. A version is saved each time you close a note after changing it.</div>';
  $$('[data-vr]', $('verList')).forEach(b => b.addEventListener('click', async () => {
    const v = list[+b.dataset.vr];
    await saveVersion(n.id, { title: n.title, text: n.text });
    n.title = v.title; n.text = v.text; put(n, { render: false });
    $('neTitle').value = n.title; undoCommit(); undoPush(ta().value); setBody(n.text);
    neOriginal = { title: n.title, text: n.text };
    Sheets.close('shVersions', true); Sheets.close('shNoteMore', true);
    toast('Version restored. The previous text was kept as a version.');
  }));
  $$('[data-vv]', $('verList')).forEach(b => b.addEventListener('click', () => {
    const v = list[+b.dataset.vv];
    $('nvHead').textContent = 'Earlier version'; $('nvMeta').textContent = new Date(v.at).toLocaleString('en-IN');
    $('nvTitle').textContent = v.title || 'Untitled'; $('nvBody').innerHTML = md(v.text); $('nvImgs').innerHTML = '';
    viewNoteId = n.id; Sheets.open('shNoteView');
  }));
  Sheets.open('shVersions');
}

/* ---- duplicates ---- */
function openDuplicates() {
  const groups = dupGroups();
  $('dupBody').innerHTML = groups.length ? groups.map((g, i) => `<div class="group-title">Group ${i + 1} · ${g.length} similar</div><div class="group">${g.map(n => `
    <div class="row"><div class="row-main"><div class="row-title">${esc(n.title || 'Untitled')}</div><div class="row-sub">edited ${timeAgo(n.updatedAt)}${n.folder ? ' · ' + esc(n.folder) : ''}</div></div>
    <div class="row-end"><button class="btn small ghost" data-do="${n.id}">Open</button><button class="btn small danger" data-dd="${n.id}">Delete</button></div></div>`).join('')}</div>`).join('')
    : '<div class="empty"><b>No duplicates</b>Nothing looks repeated.</div>';
  $$('[data-do]', $('dupBody')).forEach(b => b.addEventListener('click', () => { Sheets.closeAll(); previewNote(b.dataset.do); }));
  $$('[data-dd]', $('dupBody')).forEach(b => b.addEventListener('click', () => { deleteNote(b.dataset.dd); openDuplicates(); }));
  Sheets.open('shDup');
}

/* ==========================================================================
   KEY DATES + BILLS & INSTALMENTS
   A bill is the standing commitment; a billpay record exists only once a
   period is settled (paid or skipped) — any due period without one is pending.
   ======================================================================== */
const FIN_CATS = ['Household', 'Bills', 'Travel', 'Food', 'Health', 'Education', 'Investment', 'Salary', 'Other'];
const FIN_COLORS = { Household: '#1B4B8F', Bills: '#9C2963', Travel: '#B8860B', Food: '#B45309', Health: '#2E7D50', Education: '#3F4F8C', Investment: '#6b3f5c', Salary: '#2E7D50', Other: '#77818E', '': '#77818E' };
let billMonth = isoMonth(new Date());

/* ---------- key dates ---------- */
function nextOccurrence(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const w = new Date(d.when + 'T00:00:00'); if (isNaN(w)) return today;
  const day = w.getDate(), base = new Date(w);
  if (d.repeat === 'yearly') { for (let k = 1; w < today && k < 500; k++) { const x = addMonthsKeep(base, 12 * k, day); w.setTime(x.getTime()); } }
  else if (d.repeat === 'monthly') { for (let k = 1; w < today && k < 6000; k++) { const x = addMonthsKeep(base, k, day); w.setTime(x.getTime()); } }
  return w;
}
function countHtml(days, pastWord) {
  const cls = days < 0 ? 'past' : days <= 3 ? 'now' : days <= 14 ? 'soon' : '';
  const big = days < 0 ? '—' : days === 0 ? 'Today' : days;
  const unit = days < 0 ? (pastWord || 'passed') : days === 0 ? '' : days === 1 ? 'day' : 'days';
  return `<div class="count ${cls}" aria-label="${days < 0 ? pastWord || 'passed' : days === 0 ? 'today' : days + ' days'}">${big}<small>${unit}</small></div>`;
}
function renderDatesOld() {}

let editDateId = null;
function openDate(id) {
  const d = records[id]; if (!d) return;
  editDateId = id;
  $('deLabel').value = d.label; $('deWhen').value = d.when || ''; $('deRepeat').value = d.repeat || 'once';
  $('deCat').innerHTML = dateCats().map(c => `<option value="${c[0]}"${c[0] === dateCat(d) ? ' selected' : ''}>${c[2]} ${esc(c[1])}</option>`).join('');
  const w = d.when ? isoLocal(nextOccurrence(d)) : '', age = w ? dateAge(d, w) : '';
  $('deInfo').textContent = w ? `Next: ${fmtDate(w, true)} (${inDays(daysTo(w))})${age ? ', ' + age : ''}${d.docRef && records[d.docRef] ? ' · linked to the document “' + records[d.docRef].title + '”' : ''}` : 'No date yet — pick one above.';
  Sheets.open('shDate');
}
$('deSave').addEventListener('click', () => {
  const d = records[editDateId]; if (!d) return;
  d.label = $('deLabel').value.trim() || d.label; d.when = $('deWhen').value || d.when || ''; d.repeat = $('deRepeat').value; d.cat = $('deCat').value; if (d.when) delete d.needsDetail;
  const doc = d.docRef && records[d.docRef]; if (doc && d.when && dateCat(d) === 'docexp' && doc.expiry !== d.when) { doc.expiry = d.when; put(doc, { render: false }); }
  put(d); Sheets.close('shDate'); toast('Saved.');
});
$('deDelete').addEventListener('click', () => { const id = editDateId; Sheets.close('shDate', true); deleteWithUndo(id); });

/* ---------- bills ---------- */
function billDueIn(b, ym) {
  const start = b.startMonth || isoMonth(new Date(b.createdAt));
  const diff = monthDiff(start, ym);
  if (diff < 0 || diff % (b.freq || 1) !== 0) return false;
  if (b.total && diff / (b.freq || 1) >= b.total) return false;
  return true;
}
let payIdx = null, payIdxVer = -1;
function payIndex() {
  if (payIdx && payIdxVer === storeVer) return payIdx;
  payIdx = { at: new Map(), paid: new Map() }; payIdxVer = storeVer;
  all('billpay').forEach(p => { payIdx.at.set(p.billId + '|' + p.period, p); if (p.status === 'paid') payIdx.paid.set(p.billId, (payIdx.paid.get(p.billId) || 0) + 1); });
  return payIdx;
}
const payFor = (bid, ym) => payIndex().at.get(bid + '|' + ym);
const billPaidCount = b => payIndex().paid.get(b.id) || 0;
function overduePeriods(b, upto) {
  const start = b.startMonth || isoMonth(new Date(b.createdAt)), out = [];
  for (let ym = start; monthDiff(ym, upto) > 0; ym = monthAdd(ym, 1)) if (billDueIn(b, ym) && !payFor(b.id, ym)) out.push(ym);
  return out;
}
function pendingCount() {
  const now = isoMonth(new Date()); let n = 0;
  all('bill').forEach(b => { if (billDueIn(b, now) && !payFor(b.id, now)) n++; n += overduePeriods(b, now).length; });
  return n;
}
let billSeen = isoMonth(new Date());
function renderBills() {
  { const nowM = isoMonth(new Date()); if (nowM !== billSeen) { if (billMonth === billSeen) billMonth = nowM; billSeen = nowM; } }   // new month while the app stayed open
  $('billMonthLbl').textContent = monthLong(billMonth);
  const now = isoMonth(new Date()), bills = all('bill'), rows = [];
  if (billMonth === now) bills.forEach(b => overduePeriods(b, now).forEach(ym => rows.push({ b, ym, state: 'overdue' })));
  bills.forEach(b => { if (!billDueIn(b, billMonth)) return; const p = payFor(b.id, billMonth); rows.push({ b, ym: billMonth, state: p ? (p.status === 'skipped' ? 'skipped' : 'paid') : 'pending', pay: p }); });
  // pending first (by due day), then settled
  const order = { overdue: 0, pending: 1, paid: 2, skipped: 3 };
  rows.sort((a, c) => order[a.state] - order[c.state] || (a.b.dueDay || 99) - (c.b.dueDay || 99));
  const day = new Date().getDate();
  $('billList').innerHTML = rows.length ? rows.map(r => {
    const b = r.b, paidN = billPaidCount(b);
    const hist = []; for (let i = 5; i >= 0; i--) { const ym = monthAdd(now, -i); if (!billDueIn(b, ym)) { hist.push(''); continue; } const p = payFor(b.id, ym); hist.push(p ? (p.status === 'skipped' ? 's' : 'p') : (ym === now ? '' : 'm')); }
    const amt = r.pay && r.pay.status === 'paid' ? r.pay.amount : b.amount;
    const dueD = b.dueDay ? Math.min(b.dueDay, new Date(+billMonth.slice(0, 4), +billMonth.slice(5, 7), 0).getDate()) : 0;
    const late = r.state === 'pending' && billMonth === now && dueD && dueD < day;
    const settled = r.state === 'paid' || r.state === 'skipped';
    return swipeHtml(`<div class="row bill ${r.state}">
      <div class="row-main"><div class="row-title">${esc(b.label)} ${r.state === 'overdue' ? `<span class="pill neg">${monthShort(r.ym)}</span>` : ''}</div>
        <div class="row-sub">${dueD ? `<span class="${late ? 'warn' : ''}">due ${ordinal(dueD)}</span>` : ''}<span>${b.freq == 1 ? 'monthly' : 'every ' + b.freq + ' months'}</span>
          ${b.total ? `<span>${paidN}/${b.total} paid</span>` : ''}${r.state === 'paid' && r.pay ? `<span class="pos">✓ paid ${fmtDate(r.pay.paidOn)}</span>` : ''}${r.state === 'skipped' ? '<span>skipped</span>' : ''}${r.pay && r.pay.postPending ? '<span class="warn">money entry waiting</span>' : ''}</div>
        ${b.total ? `<div class="emi"><i style="width:${Math.min(100, Math.round(paidN / b.total * 100))}%"></i></div>` : ''}
        <div class="hist" aria-hidden="true">${hist.map(h => `<i class="${h}"></i>`).join('')}</div></div>
      <div class="row-end"><span class="amt">${amt ? fmtMoney(amt) : '—'}</span>
        ${settled ? `<button class="btn small ghost" data-unpay="${b.id}|${r.ym}">Undo</button>` : `<button class="btn small" data-pay="${b.id}|${r.ym}">Pay</button>`}</div></div>`,
      settled ? '' : '✓ Paid', '', `data-bill="${b.id}|${r.ym}"`);
  }).join('') : '<div class="empty"><b>Nothing due</b>Add electricity, rent, EMIs or insurance with +.</div>';
  { const many = billMonth === now ? bills.map(b => [b, overduePeriods(b, now)]).filter(([, l]) => l.length > 1) : [];
    if (many.length) $('billList').insertAdjacentHTML('afterbegin', many.map(([b, l]) => `<button class="linkbtn bill-bulk" data-bulk="${b.id}">Mark ${l.length} earlier months of ${esc(b.label)} as paid</button>`).join(''));
    $$('[data-bulk]', $('billList')).forEach(x => x.addEventListener('click', () => bulkPaid(x.dataset.bulk))); }
  $$('[data-bill]', $('billList')).forEach(w => {
    const [id, ym] = w.dataset.bill.split('|'); const settled = !!payFor(id, ym);
    bindSwipe(w, settled ? null : () => settlePay(id, ym, 'paid', null), null);
    onTap(w, e => {
      if (e.target.closest('[data-pay]')) return askPay(id, ym);
      if (e.target.closest('[data-unpay]')) return undoPay(id, ym);
      openBill(id);
    });
  });
}
$('billPrev').addEventListener('click', () => { billMonth = monthAdd(billMonth, -1); renderBills(); });
$('billNext').addEventListener('click', () => { billMonth = monthAdd(billMonth, 1); renderBills(); });

let payTarget = null;
function askPay(id, ym) {
  const b = records[id]; if (!b) return;
  payTarget = { id, ym };
  $('payTitle').textContent = b.label;
  $('paySub').textContent = monthLong(ym) + (b.amount ? ' · expected ' + fmtMoney(b.amount) : '');
  $('payAmt').value = b.amount || '';
  Sheets.open('shPay');
}
function settlePay(id, ym, status, typed) {
  const b = records[id]; if (!b) return;
  const amount = status === 'paid' ? ((typed != null && !isNaN(typed) && typed > 0) ? typed : (b.amount || 0)) : 0;
  const pay = { id: uid('bp'), type: 'billpay', billId: id, period: ym, status, amount, paidOn: todayISO(), deleted: false };
  if (status === 'paid' && b.autoPost && amount > 0) {
    if (finUnlocked()) postBillToMoney(b, pay);
    else pay.postPending = true;                 // written into Money next time it is unlocked
  }
  put(pay);
  toast(status === 'paid' ? `${b.label} — marked paid${amount ? ' ' + fmtMoney(amount) : ''}.` : 'Skipped for this period.', 'Undo', () => undoPay(id, ym, true));
}
/* Mark every overdue month of a bill as paid in one go (for an EMI that started before you began using the app). Not posted to Money. */
function bulkPaid(id) {
  const b = records[id]; if (!b) return;
  const l = overduePeriods(b, isoMonth(new Date())); if (!l.length) return;
  if (!confirm(`Mark ${l.length} earlier months of "${b.label}" as paid? They are not written into Money.`)) return;
  const made = l.map(ym => put({ id: uid('bp'), type: 'billpay', billId: id, period: ym, status: 'paid', amount: b.amount || 0, paidOn: monthEnd(ym), bulk: true, deleted: false }, { render: false }).id);
  scheduleRender();
  toast(`${l.length} months marked paid.`, 'Undo', () => { made.forEach(x => softDelete(x, { render: false })); scheduleRender(); });
}
function retireBills() {
  const l = all('bill'); if (!l.length) return;
  l.forEach(b => put({ ...records[b.id], type: 'oldbill', retiredOn: todayISO() }, { render: false }));
  RLOG.info('bills retired (v2.8)', l.length);
}
function postBillToMoney(b, pay) {
  put({ id: uid('f'), type: 'fin', desc: b.label + ' — ' + monthShort(pay.period), amount: pay.amount, kind: 'expense', category: b.category || 'Bills',
        date: pay.paidOn, who: '', recurring: false, settled: false, billRef: b.id, deleted: false }, { render: false });
}
function flushPendingPosts() {
  all('billpay').filter(p => p.postPending).forEach(p => { const b = records[p.billId]; if (b) postBillToMoney(b, p); delete p.postPending; put(p, { render: false }); });
}
$('payOk').addEventListener('click', () => { if (!payTarget) return; Sheets.close('shPay'); settlePay(payTarget.id, payTarget.ym, 'paid', calcAmount($('payAmt').value)); });
$('paySkip').addEventListener('click', () => { if (!payTarget) return; Sheets.close('shPay'); settlePay(payTarget.id, payTarget.ym, 'skipped'); });
$('payAmt').addEventListener('keydown', e => { if (e.key === 'Enter') $('payOk').click(); });
function undoPay(id, ym, quiet) {
  const p = payFor(id, ym); if (!p) return;
  softDelete(p.id);
  if (!quiet) toast('Marked unpaid again.', 'Undo', () => restore(p.id));
}

let editBillId = null;
function openBill(id) {
  const b = records[id]; if (!b) return;
  editBillId = id;
  $('beLabel').value = b.label; $('beAmt').value = b.amount || ''; $('beDay').value = b.dueDay || '';
  $('beFreq').value = String(b.freq || 1); $('beEmi').value = b.total || '';
  $('beStart').value = b.startMonth || isoMonth(new Date(b.createdAt));
  $('beCat').innerHTML = ['', ...FIN_CATS].map(c => `<option value="${c}" ${c === (b.category || '') ? 'selected' : ''}>${c || '— none —'}</option>`).join('');
  $('bePost').checked = !!b.autoPost;
  Sheets.open('shBill');
}
$('beSave').addEventListener('click', () => {
  const b = records[editBillId]; if (!b) return;
  b.label = $('beLabel').value.trim() || b.label;
  b.amount = calcAmount($('beAmt').value) || 0; b.dueDay = Math.min(31, parseInt($('beDay').value, 10) || 0);
  b.freq = parseInt($('beFreq').value, 10) || 1; b.total = parseInt($('beEmi').value, 10) || 0;
  b.startMonth = $('beStart').value || b.startMonth; b.category = $('beCat').value; b.autoPost = $('bePost').checked;
  put(b); Sheets.close('shBill'); toast('Saved.');
});
$('beDelete').addEventListener('click', () => { const id = editBillId; Sheets.close('shBill', true); deleteWithUndo(id); });

function renderDatesTab() {
  const seg = 'dates';                                  // v2.8: Bills & EMIs moved out — Money → Recurring
  $$('#dateSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === seg));
  $('billsPane').classList.toggle('hidden', seg !== 'bills');
  $('datesPane').classList.toggle('hidden', seg !== 'dates');
  if (seg === 'bills') renderBills(); else renderDates();
}
$$('#dateSeg button').forEach(b => b.addEventListener('click', () => { setPref('dateSeg', b.dataset.v); renderDatesTab(); }));

/* ==========================================================================
   DOCUMENTS
   ======================================================================== */
/* Financial years (Apr–Mar) as "2024-25"; newest first. */
const fyOf = iso => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const s = m >= 4 ? y : y - 1; return s + '-' + String((s + 1) % 100).padStart(2, '0'); };
function fyList() { const cur = +fyOf(todayISO()).slice(0, 4), out = []; for (let s = cur + 1; s >= 2000; s--) out.push(s + '-' + String((s + 1) % 100).padStart(2, '0')); return out; }
const fyOptions = (sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + (sel && !fyList().includes(sel) ? [...fyList(), sel].sort().reverse() : fyList()).map(f => `<option value="${esc(f)}"${f === sel ? ' selected' : ''}>FY ${esc(f)}</option>`).join('');
const docPeople = () => orderPeople([...PERSON_ORDER, ...all('doc').flatMap(docOwners)]);
/* ---------- v2.11: people (aliases, surnames ignored) and broad groups for the Docs tab ---------- */
const DOC_ME = 'Rahul';
const PERSON_ALIAS = Object.assign(Object.create(null), { rk: 'Rahul', rahul: 'Rahul', moni: 'Ruchi', ruchi: 'Ruchi', papa: 'Papa', naresh: 'Papa', mummy: 'Mummy', mom: 'Mummy', maa: 'Mummy', kavita: 'Mummy' });   // no "constructor" / "__proto__" look-ups
const PERSON_ORDER = ['Rahul', 'Ruchi', 'Papa', 'Mummy'];
function personOne(s) {
  const w = String(s || '').trim().split(/\s+/)[0]; if (!w) return '';
  return PERSON_ALIAS[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
function whoParts(raw) {
  const out = [];
  String(raw || '').split(/\s*(?:&|,|\+|\band\b)\s*/i).map(x => x.trim()).filter(Boolean).forEach(p => {
    if (/^parents$/i.test(p)) out.push('Papa', 'Mummy'); else out.push(personOne(p));
  });
  return [...new Set(out.filter(Boolean))];
}
function docOwners(d) { const o = whoParts(d && d.who); return o.length ? o : [DOC_ME]; }
function normWho(s) { return whoParts(s).join(' & '); }
function orderPeople(list) {
  return [...new Set(list)].sort((a, b) => { const ia = PERSON_ORDER.indexOf(a), ib = PERSON_ORDER.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    if (a === 'Family') return 1; if (b === 'Family') return -1; return a.localeCompare(b); });
}
let DOC_GROUPS = [['Academic', ['Education', 'Exam'], '🎓'], ['IDs', ['Identity'], '🪪'], ['Certificates', ['Certificate'], '📜'], ['Office', ['Official'], '🏛'], ['Case files', ['Case'], '🗂'],
  ['Financial', ['Financial', 'Tax', 'Insurance'], '💰'], ['Medical', ['Medical'], '🩺'], ['Property & vehicle', ['Property', 'Vehicle', 'Warranty'], '🏠'],
  ['Photos & signature', ['Photo & Signature'], '🖼'], ['Other', ['Membership', 'Other'], '📄']];
const docGroup = d => (syncDocCfg(), DOC_GROUPS.find(g => g[1].includes(d.docType)) || DOC_GROUPS[DOC_GROUPS.length - 1])[0];
const groupIcon = n => (DOC_GROUPS.find(g => g[0] === n) || [0, 0, '📁'])[2];
let docPath = { who: null, grp: null };
const docNewType = () => { const g = DOC_GROUPS.find(x => x[0] === docPath.grp); return g ? g[1][0] : 'Identity'; };
/* one-time tidy of documents imported from CASE_/EVIDENCE_ files (typed "Other", some with a wrong person) */
let docsMigrated = false;
function migrateCaseDocs() {
  if (docsMigrated) return; docsMigrated = true;
  all('doc').forEach(d => {
    const fs = docFilesOf(d.id); if (!fs.length || d.docType !== 'Other' || d.caseMig) return;     // once per document; your own edits stay
    if (!fs.every(f => /^(CASE|EVIDENCE)_/i.test(f.name || ''))) return;
    const p = parseDocName(fs[0].name || '');
    d.docType = 'Case'; d.who = ''; d.caseMig = true; if (p && p.title) d.title = p.title;
    put(d, { render: false });
  });
}

let docWho = 'All';
const docYears = d => [...new Set([d.fy, ...(d.byYear ? docFilesOf(d.id).map(f => f.fy) : [])].filter(Boolean))].sort().reverse();
let docYear = 'All';
let DOC_TYPES = ['Identity', 'Education', 'Exam', 'Tax', 'Financial', 'Insurance', 'Medical', 'Official', 'Case', 'Property', 'Vehicle', 'Certificate', 'Photo & Signature', 'Warranty', 'Membership', 'Other'];
const DOC_COLORS = { Case: '#5a3a3a', Tax: '#8a4b12', Medical: '#2E7D50', Official: '#2d4a6b', Exam: '#7a5c1e', Certificate: '#5b6e2f', 'Photo & Signature': '#6d5a8a', Insurance: '#1B4B8F', Vehicle: '#B45309', Identity: '#9C2963', Education: '#4F6B2F', Warranty: '#3F4F8C', Membership: '#2c6e6a', Property: '#6b3f5c', Financial: '#B8860B', Other: '#77818E' };
let docFilter = 'All', activeDocFolder = '__all__';
const docFolder = d => (d.folder || '').trim();
const docFolderList = () => [...new Set(all('doc').map(docFolder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const docFolderForNew = () => activeDocFolder !== '__all__' ? activeDocFolder : '';
function renderDocsBase() {
  migrateCaseDocs(); renderDriveChkNote(); if (typeof renderAttn === 'function') setTimeout(renderAttn, 0);
  const docs = all('doc');
  { const c = ImpCheck.get(), n = c && !c.off ? c.n : 0;
    $('docImpNote').innerHTML = n && !window.GHOST ? `<button class="imp-note" id="docImpGo"><span>📥 <b>${n} new file${n > 1 ? 's' : ''}</b> in your Docs folder</span><b>Review ›</b></button>` : '';
    if ($('docImpGo')) $('docImpGo').addEventListener('click', () => { openImport(); readImport(); });
    setTimeout(() => ImpCheck.maybe(), 800); }
  $('docChips').innerHTML = ''; $('docChips').classList.add('hidden');
  const allYears = [...new Set(docs.flatMap(docYears))].sort().reverse();
  if (docYear !== 'All' && !allYears.includes(docYear)) docYear = 'All';
  $('docYearBar').innerHTML = allYears.length ? `<div class="doc-yearbar"><span class="muted">Year</span><select id="docYearSel" aria-label="Financial year"><option value="All">All years</option>${allYears.map(y => `<option value="${esc(y)}"${y === docYear ? ' selected' : ''}>FY ${esc(y)}</option>`).join('')}</select></div>` : '';
  if ($('docYearSel')) $('docYearSel').addEventListener('change', e => { docYear = e.target.value; renderDocs(); });
  const shown = docs.filter(d => docYear === 'All' || docYears(d).includes(docYear));
  const people = orderPeople([...shown.flatMap(docOwners), ...(docYear === 'All' ? docCfgPeople() : [])]);
  if (docPath.who && !people.includes(docPath.who)) docPath = { who: null, grp: null };
  const mine = docPath.who ? shown.filter(d => docOwners(d).includes(docPath.who)) : [];
  if (docPath.grp && !mine.some(d => docGroup(d) === docPath.grp)) docPath.grp = null;
  const fbox = $('docFolders'), cnt = n => `${n} document${n === 1 ? '' : 's'}`;
  let list = [], showWho = false;
  if (!docPath.who) {
    fbox.innerHTML = (people.length ? `<div class="folders">${people.map(p => { const own = shown.filter(d => docOwners(d).includes(p));
      const gs = DOC_GROUPS.filter(g => own.some(d => docGroup(d) === g[0])).map(g => g[0]);
      return `<button class="folder" data-dwho="${esc(p)}"><b>👤 ${esc(p)}</b><span>${cnt(own.length)}</span><small>${esc(gs.slice(0, 4).join(' · ') + (gs.length > 4 ? ' …' : ''))}</small></button>`; }).join('')}</div>` : '');
    list = shown.filter(d => d.expiry && daysUntilISO(d.expiry) <= 30 && daysUntilISO(d.expiry) >= -10).sort((a, b) => a.expiry.localeCompare(b.expiry));   // due in 30 days, or expired in the last 10
    if (list.length) fbox.innerHTML += '<div class="group-title">Expiring in 30 days · expired in the last 10 days</div>';
    showWho = true;
  } else if (!docPath.grp) {
    const gs = DOC_GROUPS.filter(g => mine.some(d => docGroup(d) === g[0]));
    fbox.innerHTML = `<div class="doc-crumb"><button class="chip" data-dback="home">‹ Everyone</button><b>👤 ${esc(docPath.who)}</b><span class="muted">${cnt(mine.length)}</span></div>
      <div class="folders">${gs.map(g => { const n = mine.filter(d => docGroup(d) === g[0]).length; return `<button class="folder" data-dgrp="${esc(g[0])}"><b>${g[2]} ${esc(g[0])}</b><span>${cnt(n)}</span></button>`; }).join('')}</div>`;
  } else {
    fbox.innerHTML = `<div class="doc-crumb"><button class="chip" data-dback="who">‹ ${esc(docPath.who)}</button><b>${groupIcon(docPath.grp)} ${esc(docPath.grp)}</b><span class="muted">${cnt(mine.filter(d => docGroup(d) === docPath.grp).length)}</span></div>`;
    list = mine.filter(d => docGroup(d) === docPath.grp).sort((a, b) => a.docType.localeCompare(b.docType) || a.title.localeCompare(b.title) || String(b.fy || '').localeCompare(String(a.fy || '')));
    showWho = list.some(d => docOwners(d).length > 1);
  }
  $$('[data-dwho]', fbox).forEach(b => b.addEventListener('click', () => { docPath = { who: b.dataset.dwho, grp: null }; renderDocs(); $('main').scrollTop = 0; }));
  $$('[data-dgrp]', fbox).forEach(b => b.addEventListener('click', () => { docPath.grp = b.dataset.dgrp; renderDocs(); $('main').scrollTop = 0; }));
  $$('[data-dback]', fbox).forEach(b => b.addEventListener('click', () => { if (b.dataset.dback === 'home') docPath = { who: null, grp: null }; else docPath.grp = null; renderDocs(); }));
  $('docList').innerHTML = list.map(d => {
    const days = d.expiry ? daysUntilISO(d.expiry) : null;
    return swipeHtml(`<div class="row" style="border-left:4px solid ${DOC_COLORS[d.docType] || '#77818E'}">
      ${d.expiry ? countHtml(days, 'expired') : '<div class="count past" aria-label="no expiry">∞<small>no expiry</small></div>'}
      <div class="row-main"><div class="row-title">${esc(d.title)}${showWho ? ` <span class="muted" style="font-weight:400">· ${esc(docOwners(d).join(' & '))}</span>` : ''}</div>
        <div class="row-sub"><span>${esc(d.docType)}</span>${docFileBadge(d)}${docNumShown(d) ? `<span class="mono">${esc(docNumShown(d))}</span>` : ''}${d.expiry ? `<span class="${days < 0 ? 'warn' : ''}">${days < 0 ? 'expired' : 'expires'} ${fmtDate(d.expiry, true)}</span>` : ''}${d.notes ? '<span>📝</span>' : ''}</div></div>
      ${docSel ? `<span class="sel-box${docSel.has(d.id) ? ' on' : ''}" aria-label="${docSel.has(d.id) ? 'selected' : 'not selected'}">${docSel.has(d.id) ? '✓' : ''}</span>` : '<span class="chev">›</span>'}</div>`, '', 'Delete 🗑', `data-doc="${d.id}"`);
  }).join('') || (!docs.length ? '<div class="empty"><b>No documents</b>Aadhaar, PAN, marksheets, ITRs, policies — tap + to add, 📷 Scan, or Import from Drive. Each person gets a folder, with groups inside.</div>' : '');
  $('docList').classList.toggle('hidden', !$('docList').innerHTML);
  $$('[data-doc]', $('docList')).forEach(w => { const id = w.dataset.doc; bindSwipe(w, null, () => deleteWithUndo(id)); onTap(w, () => docSel ? toggleDocSel(id) : showDoc(id)); });
  if (docSel && docPath.grp && list.length) { fbox.insertAdjacentHTML('beforeend', '<button class="linkbtn" id="docSelAll" style="margin:0 4px 8px">Select all here</button>'); $('docSelAll').addEventListener('click', () => { list.forEach(d => docSel.add(d.id)); renderDocs(); }); }
  renderSelBar();
}

let editDocId = null;
function openDocBase(id) {
  const d = records[id]; if (!d) return;
  editDocId = id;
  $('doTitle').value = d.title; $('doWho').value = d.who || ''; $('docWhoDl').innerHTML = docPeople().map(p => `<option value="${esc(p)}">`).join(''); $('doNumber').value = d.number || ''; $('doExpiry').value = d.expiry || '';
  $('doNumber').disabled = false; $('doNumber').placeholder = '';
  if (d.numEnc) { $('doNumber').disabled = true; $('doNumber').placeholder = Fin.key ? 'Opening…' : 'Locked — enter your private code to see or change';
    if (Fin.key) docNumFull(d).then(n => { if (editDocId === id) { $('doNumber').value = n; $('doNumber').disabled = false; $('doNumber').placeholder = ''; if (Sheets.onOpen.shDoc) Sheets.onOpen.shDoc(); } })
      .catch(() => { if (editDocId === id) $('doNumber').placeholder = 'Locked under an older code — unchanged'; }); }
  $('doIssuer').value = d.issuer || ''; $('doNotes').value = d.notes || ''; $('doDueKind').innerHTML = dueKindOpts(d.dueKind);
  $('doFolder').value = d.folder || '';
  $('doFy').innerHTML = fyOptions(d.fy || '', '— none —'); $('doByYear').checked = !!d.byYear;
  $('doFileFy').innerHTML = fyOptions((docYear !== 'All' ? docYear : null) || docYears(d)[0] || fyOf(todayISO()));
  $('doFileFyW').classList.toggle('hidden', !d.byYear); $('docFolderDl').innerHTML = docFolderList().map(f => `<option value="${esc(f)}">`).join('');
  chipGroup($('doType'), DOC_TYPES, d.docType, () => {}, t => DOC_COLORS[t]);
  $('doFileMsg').textContent = ''; renderDocEditFiles();
  Sheets.open('shDoc');
}
$('doSave').addEventListener('click', async () => {
  const d = records[editDocId]; if (!d) return;
  const numLocked = $('doNumber').disabled || (d.lockFiles && !Fin.key);            // never store a locked document's number in the clear
  if (numLocked && !$('doNumber').disabled && $('doNumber').value.trim() !== (d.number || '')) toast('The number was not changed — open Money first to edit a locked document\'s number.');
  d.title = $('doTitle').value.trim() || d.title; d.docType = chipValue($('doType')) || d.docType;
  if (!numLocked) { d.number = $('doNumber').value.trim(); if (!d.number) { delete d.numEnc; delete d.numTail; } } d.expiry = $('doExpiry').value || null; d.issuer = $('doIssuer').value.trim(); d.notes = $('doNotes').value;
  d.folder = $('doFolder').value.trim();
  d.who = normWho($('doWho').value);
  d.fy = $('doFy').value || null; d.byYear = $('doByYear').checked;
  d.dueKind = $('doDueKind').value || 'expiry';
  if (d.lockFiles && d.number) await sealDocNumber(d);
  put(d); const dx = syncDocDate(d); Sheets.close('shDoc'); toast(d.expiry && dx ? 'Saved — the ' + dueWord(d.dueKind) + ' is in Dates.' : 'Saved.');
});
$('doDelete').addEventListener('click', () => { const id = editDocId; Sheets.close('shDoc', true); deleteWithUndo(id); });
$('doRemind').addEventListener('click', () => {
  $('doSave').click();
  const d = records[editDocId];
  if (!d || !d.expiry) { toast('Set an expiry date first.'); return; }
  if (all('date').some(x => x.docRef === d.id)) { toast('Already in Key dates.'); return; }
  put({ id: uid('d'), type: 'date', label: d.title + ' — expiry', when: d.expiry, repeat: 'once', docRef: d.id, cat: 'docexp', deleted: false });
  toast('Added to Key dates.');
});

/* ==========================================================================
   DOCUMENT FILES (v2.1) — photos / PDFs attached to a document, kept in Drive.
   A locked file is encrypted on this device with its own random key before
   upload. That key is stored in a sealed 'filekey' record, so it is protected
   by the private code and follows code changes automatically.
   ======================================================================== */
const DOCFILE_MAX = 15 * 1024 * 1024;
const PDFJS_URL = 'vendor/pdf-3.11.174.min.js';           // v2.18: libraries are served from this site (see vendor/README.md), not a CDN
const PDFJS_WORKER = 'vendor/pdf.worker-3.11.174.min.js';
const PDFLIB_URL = 'vendor/pdf-lib-1.17.1.min.js';
const PDF_PAGE_BATCH = 10;
const docPlain = new Map();                       // docfile id -> { blob, url }, memory only
const docFilesOf = docId => all('docfile').filter(f => f.docId === docId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const isPdf = f => /pdf/i.test(f.mime || '') || /\.pdf$/i.test(f.name || '');
const fmtBytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const stemOf = n => String(n || 'file').replace(/\.[^.]+$/, '');
function lockedErr() { const e = new Error('private section is locked'); e.code = 'LOCKED'; return e; }

async function aesEncBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
  return out;
}
async function aesDecBytes(key, raw) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12)));
}
const importFileKey = raw => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function fileKeyOf(f) {
  if (!Fin.key) throw lockedErr();
  const k = records[f.keyId];
  if (!k) throw new Error('the key for this locked file is missing on this device — sync, then try again');
  return importFileKey(k.raw);
}

/* Encrypt (if asked) and upload. Returns { fileId, keyId }. */
async function putDocBytes(bytes, name, mime, lock) {
  let body = bytes, upMime = mime, keyId = null;
  try {
    if (lock) {
      if (!Fin.key) throw lockedErr();
      const raw = b64(crypto.getRandomValues(new Uint8Array(32)));
      keyId = put({ id: uid('fk'), type: 'filekey', raw, deleted: false }, { render: false }).id;
      body = await aesEncBytes(await importFileKey(raw), bytes);
      upMime = 'application/octet-stream';
    }
    const data = b64(body);
    const d = await Sync.call('driveUpload', { folderId: prefs.driveFolder, name: lock ? name + '.locked' : name, mime: upMime, data }, 240000);
    if (!d.fileId) throw new Error('Drive did not return a file id');
    DB.imgSet(d.fileId, 'data:' + upMime + ';base64,' + data).catch(() => {});   // locked files are cached as ciphertext only
    return { fileId: d.fileId, keyId };
  } catch (e) {
    if (keyId && records[keyId]) softDelete(keyId, { render: false });
    throw e;
  }
}
async function rawDocBytes(f) {
  let url = null;
  try { url = await DB.imgGet(f.fileId); } catch (e) {}
  if (!url) {
    if (!Sync.on()) throw new Error('sync is not set up, so the file cannot be fetched from Drive');
    const d = await Sync.call('driveGet', { fileId: f.fileId }, 240000);
    if (!d.data) throw new Error('Drive returned an empty file');
    url = 'data:' + (d.mime || 'application/octet-stream') + ';base64,' + d.data;
    DB.imgSet(f.fileId, url).catch(() => {});
  }
  return unb64(url.slice(url.indexOf(',') + 1));
}
async function docFileBlob(f) {
  if (f.locked && !Fin.key) throw lockedErr();                            // before the cache: a file locked on another device stays locked here
  if (docPlain.has(f.id)) { const v = docPlain.get(f.id); docPlain.delete(f.id); docPlain.set(f.id, v); return v; }
  let bytes = await rawDocBytes(f);
  if (f.locked) {
    try { bytes = await aesDecBytes(await fileKeyOf(f), bytes); }
    catch (e) { if (e.code === 'LOCKED') throw e; throw new Error(/key/.test(e.message) ? e.message : 'could not decrypt this file'); }
  }
  const blob = new Blob([bytes], { type: f.mime || 'application/octet-stream' });
  const v = { blob, url: URL.createObjectURL(blob) };
  docPlain.set(f.id, v);
  while (docPlain.size > 12) { const [k, o] = docPlain.entries().next().value; docPlain.delete(k); setTimeout(() => URL.revokeObjectURL(o.url), 60000); }   // keep memory small on the iPhone
  return v;
}
function forgetLockedPlain() {
  for (const [id, v] of docPlain) {
    const f = records[id];
    if (!f || f.locked) { URL.revokeObjectURL(v.url); docPlain.delete(id); }
  }
}
async function fileToBytes(file) {
  if (/^image\//.test(file.type) && !/gif|svg/.test(file.type)) {
    const dataUrl = await prepForDrive(file);                 // very large photos are shrunk to 2400 px JPEG
    return { bytes: unb64(dataUrl.slice(dataUrl.indexOf(',') + 1)), mime: dataUrl.slice(5, dataUrl.indexOf(';')) };
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'application/pdf' };
}
function docFileBadge(d) {
  const n = docFilesOf(d.id).length;
  const ys = d.byYear ? docYears(d).filter(y => y !== d.fy) : [];
  return (d.who ? `<span>👤 ${esc(docOwners(d).join(' & '))}</span>` : '') + (d.fy ? `<span>FY ${esc(d.fy)}</span>` : '') + (ys.length ? `<span>${ys.length === 1 ? 'FY ' + ys[0] : ys.length + ' years · latest ' + ys[0]}</span>` : '') + (n ? `<span>📎 ${n}</span>` : '') + (d.lockFiles ? '<span aria-label="files locked">🔒</span>' : '');
}
/* Long ID numbers show only their last 4 characters on screen (Aadhaar, PAN, passport, licence). */
const docNumShown = d => d.number ? maskNo(d.number) : d.numEnc ? '•••• ' + (d.numTail || '') : '';
async function docNumFull(d) { if (d.number) return d.number; if (!d.numEnc) return ''; if (!Fin.key) throw lockedErr(); return aesDec(Fin.key, d.numEnc); }
async function sealDocNumber(d) {
  if (!Fin.key) return false;
  if (d.lockFiles && d.number) { d.numEnc = await aesEnc(Fin.key, d.number); d.numTail = d.number.replace(/[\s-]/g, '').slice(-4); d.number = ''; return true; }
  if (!d.lockFiles && d.numEnc) { try { d.number = await aesDec(Fin.key, d.numEnc); } catch (e) { return false; } delete d.numEnc; delete d.numTail; return true; }
  return false;
}
async function sealDocNumbers() { for (const d of all('doc')) if (d.lockFiles && d.number && await sealDocNumber(d)) put(d, { render: false }); }
function maskNo(n) { const s = String(n || '').trim(); return s.replace(/[\s-]/g, '').length >= 8 ? '•••• ' + s.replace(/[\s-]/g, '').slice(-4) : s; }
function showDoc(id) { if (docFilesOf(id).length) openDocView(id); else openDoc(id); }

/* ---------- editor: file list, add, remove, lock ---------- */
function renderDocEditFiles() {
  const d = records[editDocId]; if (!d) return;
  const fs = docFilesOf(d.id);
  $('doLock').checked = !!d.lockFiles;
  const mismatch = fs.filter(f => !!f.locked !== !!d.lockFiles).length;
  const row = f => `<div class="dfile">
      <span class="dficon" aria-hidden="true">${f.locked ? '🔒' : isPdf(f) ? 'PDF' : 'IMG'}</span>
      <span class="dfname">${esc(f.name)}<small>${fmtBytes(f.bytes || 0)}${f.locked ? ' · locked' : ''}</small>${d.byYear ? `<select class="dffy" data-dffy="${f.id}" aria-label="Year">${fyOptions(f.fy || '', 'No year')}</select>` : ''}</span>
      ${/^image\//.test(f.mime || '') || isPdf(f) ? `<button class="icon-btn dfedit" data-dfed="${f.id}" aria-label="Crop or straighten ${esc(f.name)}">✂</button>` : ''}<button class="icon-btn" data-dfrm="${f.id}" aria-label="Remove ${esc(f.name)}" style="width:34px;height:34px;font-size:14px">✕</button></div>`;
  const groups = d.byYear ? [...new Set(fs.map(f => f.fy || ''))].sort().reverse() : [null];
  $('doFiles').innerHTML = (fs.length ? groups.map(g => (g === null ? '' : `<div class="dfyear">${g ? 'FY ' + g : 'No year'}</div>`) + fs.filter(f => g === null || (f.fy || '') === g).map(row).join('')).join('')
    : '<div class="hint" style="margin:0 4px 4px">No files yet.</div>')
    + (mismatch ? `<button class="linkbtn" id="doFinish">Finish ${d.lockFiles ? 'locking' : 'unlocking'} (${mismatch} left)</button>` : '');
  $$('[data-dfrm]', $('doFiles')).forEach(b => b.addEventListener('click', () => removeDocFile(b.dataset.dfrm)));
  $$('[data-dfed]', $('doFiles')).forEach(b => b.addEventListener('click', () => editDocFile(b.dataset.dfed)));
  $$('[data-dffy]', $('doFiles')).forEach(s => s.addEventListener('change', () => { const f = records[s.dataset.dffy]; f.fy = s.value || undefined; put(f, { render: false }); renderDocEditFiles(); scheduleRender(); }));
  const fin = $('doFinish'); if (fin) fin.addEventListener('click', () => convertDocFiles(d));
}
async function addDocFiles(docId, files) {
  const d = records[docId]; if (!d) return;
  const msg = $('doFileMsg');
  if (!driveOn()) { msg.className = 'msg err'; msg.textContent = 'Files are kept in your Google Drive folder. Set it in Settings (Drive folder), tap Test, then try again.'; return; }
  if (d.lockFiles && !Fin.key) { msg.className = 'msg err'; msg.textContent = 'This document locks its files. Enter your private code first (tap "Register" three times).'; return; }
  let ok = 0; const bad = [], fyPick = d.byYear ? $('doFileFy').value : null;   // read once: the editor may show another document before the uploads finish
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    msg.className = 'msg'; msg.textContent = `Uploading ${i + 1} of ${files.length}…`;
    try {
      const pdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name || '');
      if (!pdf && !/^image\//.test(file.type)) throw new Error('only photos and PDFs can be added');
      if (file.size > DOCFILE_MAX) throw new Error('larger than 15 MB');
      const { bytes, mime } = await fileToBytes(file);
      if (bytes.length > DOCFILE_MAX) throw new Error('larger than 15 MB');
      const ext = /jpeg/.test(mime) ? '.jpg' : /png/.test(mime) ? '.png' : /pdf/.test(mime) ? '.pdf' : '';
      const fy = fyPick;
      const base = ((d.title || 'Document') + (fy ? ' FY ' + fy : '')).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 60) || 'Document';
      const taken = new Set(docFilesOf(docId).map(x => (x.name || '').toLowerCase()));
      let name = base + ext, k = 2;
      while (taken.has(name.toLowerCase())) name = `${base} (${k++})${ext}`;
      const up = await putDocBytes(bytes, todayISO() + '-' + name, mime, !!d.lockFiles);
      const nf = put({ id: uid('df'), type: 'docfile', docId, name, mime, bytes: bytes.length, fileId: up.fileId, keyId: up.keyId, locked: !!d.lockFiles, fy: fy || undefined, deleted: false }, { render: false });
      if (/pdf/i.test(mime) && !d.lockFiles) indexSoon(nf.id, bytes);          // v2.19: words inside the PDF become searchable
      ok++;
    } catch (e) { RLOG.warn('doc file add failed', e.message); bad.push(`${file.name || 'file'}: ${e.message}`); }
  }
  msg.className = bad.length ? 'msg err' : 'msg ok';
  msg.textContent = (ok ? `${ok} file${ok > 1 ? 's' : ''} added${d.lockFiles ? ' and locked' : ''}. ` : '') + (bad.length ? 'Not added: ' + bad.join('; ') : '');
  renderDocEditFiles(); scheduleRender();
}
function removeDocFile(id) {
  const f = records[id]; if (!f) return;
  softDelete(id, { render: false });
  renderDocEditFiles(); scheduleRender();
  toast('File removed', 'Undo', () => { restore(id); renderDocEditFiles(); });
  setTimeout(() => {
    const r = records[id];
    if (r && r.deleted) { driveDelete(r.fileId); if (r.keyId && records[r.keyId]) softDelete(r.keyId, { render: false }); }
  }, 7000);
}
/* Re-upload every file whose locked state differs from the document's setting. */
async function convertDocFiles(d) {
  const want = !!d.lockFiles, msg = $('doFileMsg');
  const fs = docFilesOf(d.id).filter(f => !!f.locked !== want);
  if (!fs.length) { msg.className = 'msg ok'; msg.textContent = want ? 'New files for this document will be locked.' : 'New files will not be locked.'; renderDocEditFiles(); return; }
  if (!driveOn()) { msg.className = 'msg err'; msg.textContent = 'Drive is not set up, so existing files cannot be converted yet.'; renderDocEditFiles(); return; }
  let n = 0;
  for (const f of fs) {
    msg.className = 'msg'; msg.textContent = `${want ? 'Locking' : 'Unlocking'} file ${++n} of ${fs.length}…`;
    try {
      const { blob } = await docFileBlob(f);
      const up = await putDocBytes(new Uint8Array(await blob.arrayBuffer()), todayISO() + '-' + f.name, f.mime, want);
      const oldFile = f.fileId, oldKey = f.keyId;
      f.fileId = up.fileId; f.keyId = up.keyId; f.locked = want;
      put(f, { render: false });
      driveDelete(oldFile);                                   // also clears this device's cached copy
      if (oldKey && records[oldKey]) softDelete(oldKey, { render: false });
    } catch (e) {
      RLOG.warn('lock convert failed', e.message);
      msg.className = 'msg err'; msg.textContent = `Stopped at file ${n}: ${e.message}. Tap "Finish" to retry.`;
      renderDocEditFiles(); scheduleRender(); return;
    }
  }
  msg.className = 'msg ok'; msg.textContent = want ? 'Files are now locked.' : 'Files are no longer locked.';
  renderDocEditFiles(); scheduleRender();
}
$('doFileBtn').addEventListener('click', () => $('doFileIn').click());
$('doByYear').addEventListener('change', () => {
  const d = records[editDocId]; if (!d) return;
  d.byYear = $('doByYear').checked; put(d, { render: false });
  if (d.byYear) docFilesOf(d.id).forEach(f => { if (!f.fy) { f.fy = d.fy || fyOf(f.createdAt ? isoLocal(new Date(f.createdAt)) : todayISO()); put(f, { render: false }); } });   // existing files get a year to start with
  $('doFileFyW').classList.toggle('hidden', !d.byYear); renderDocEditFiles(); scheduleRender();
});
$('doFileIn').addEventListener('change', e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) addDocFiles(editDocId, files); });
$('doLock').addEventListener('change', () => {
  const d = records[editDocId]; if (!d) return;
  const want = $('doLock').checked;
  if (!Fin.key) { $('doLock').checked = !want; toast('Enter your private code first — tap "Register" three times.'); return; }
  d.lockFiles = want; put(d, { render: false });
  sealDocNumber(d).then(ch => { if (ch) put(d, { render: false }); });
  convertDocFiles(d);
});

/* ---------- viewer ---------- */
let viewDocId = null, docReturn = null;
function openDocView(id) {
  const d = records[id]; if (!d) return;
  viewDocId = id;
  $('dvTitle').textContent = d.title;
  const days = d.expiry ? daysUntilISO(d.expiry) : null;
  $('dvMeta').innerHTML = (d.who ? `<span>👤 ${esc(docOwners(d).join(' & '))}</span>` : '') + `<span>${esc(d.docType || '')}</span>` + (docNumShown(d) ? `<span class="mono" id="dvNum">${esc(docNumShown(d))}</span>`
      + (d.numEnc || maskNo(d.number) !== d.number ? '<button class="linkbtn" id="dvNumShow" style="padding:0 2px">Show</button>' : '') + '<button class="linkbtn" id="dvNumCopy" style="padding:0 2px">Copy</button>' : '')
    + (d.expiry ? `<span class="${days < 0 ? 'warn' : ''}">${days < 0 ? 'expired' : 'expires'} ${fmtDate(d.expiry, true)}</span>` : '');
  const sh = $('dvNumShow'); if (sh) sh.addEventListener('click', async () => { const on = sh.textContent === 'Show';
    if (!on) { $('dvNum').textContent = docNumShown(d); sh.textContent = 'Show'; return; }
    try { $('dvNum').textContent = await docNumFull(d); sh.textContent = 'Hide'; } catch (e) { toast('Locked — tap "Register" three times and enter your private code.'); } });
  const cp = $('dvNumCopy'); if (cp) cp.addEventListener('click', async () => { try { await navigator.clipboard.writeText(await docNumFull(d)); toast('Number copied.'); } catch (e) { toast('Could not copy — tap Show and select it.'); } });
  const fs = docFilesOf(id);
  $('dvFiles').innerHTML = fs.length ? fs.map(f => `<figure class="dv-file" data-dvf="${f.id}"><figcaption>${f.locked ? '🔒 ' : ''}${esc(f.name)}</figcaption>
      <div class="dv-body"><div class="dv-wait">${f.locked && !Fin.key ? 'Locked. Enter the code to view.' : 'Loading…'}</div></div></figure>`).join('')
    : '<div class="empty"><b>No files</b>Tap Edit to attach a photo or PDF.</div>';
  $('dvUnlock').classList.toggle('hidden', !(fs.some(f => f.locked) && !Fin.key));
  $('dvShare').classList.toggle('hidden', !fs.length);
  Sheets.open('shDocView');
  if (d.byYear && fs.length) docViewByYear(d, fs); else fs.forEach(f => { if (!f.locked || Fin.key) showDocFile(f); });
}
function docViewByYear(d, fs) {
  const years = [...new Set(fs.map(f => f.fy || ''))].sort().reverse(), first = docYear !== 'All' && years.includes(docYear) ? docYear : years[0];
  const fig = f => `<figure class="dv-file" data-dvf="${f.id}"><figcaption>${f.locked ? '🔒 ' : ''}${esc(f.name)}</figcaption>
      <div class="dv-body"><div class="dv-wait">${f.locked && !Fin.key ? 'Locked. Enter the code to view.' : 'Tap to load'}</div></div></figure>`;
  $('dvFiles').innerHTML = years.map(y => { const list = fs.filter(f => (f.fy || '') === y);
    return `<details class="dv-year" data-dvy="${esc(y)}"${y === first ? ' open' : ''}><summary>${y ? 'FY ' + y : 'No year'} · ${list.length} file${list.length > 1 ? 's' : ''}</summary>${list.map(fig).join('')}</details>`; }).join('');
  const load = y => fs.filter(f => (f.fy || '') === y).forEach(f => { if (!f.locked || Fin.key) showDocFile(f); });
  $$('.dv-year', $('dvFiles')).forEach(det => det.addEventListener('toggle', () => { if (det.open && !det.dataset.loaded) { det.dataset.loaded = '1'; load(det.dataset.dvy); } }));
  const open = $('dvFiles').querySelector('.dv-year[open]'); if (open) { open.dataset.loaded = '1'; load(open.dataset.dvy); }
}
async function showDocFile(f) {
  const box = document.querySelector(`[data-dvf="${f.id}"] .dv-body`); if (!box) return;
  try {
    const { blob, url } = await docFileBlob(f);
    if (viewDocId !== f.docId || !box.isConnected) return;
    if (isPdf(f)) { await renderPdfInto(box, blob); return; }
    box.innerHTML = `<img alt="${esc(f.name)}" src="${url}">`;
    box.addEventListener('click', e => { if (e.target.tagName === 'IMG') openLightbox(e.target.src); });
  } catch (e) {
    RLOG.warn('doc view failed', e.message);
    box.innerHTML = `<div class="dv-wait err">${e.code === 'LOCKED' ? 'Locked. Enter the code to view.' : 'Could not open: ' + esc(e.message)}</div>`;
  }
}
function loadScript(src) {
  src = new URL(src, location.href).href;                 // document.scripts reports absolute URLs
  return new Promise((res, rej) => {
    const had = [...document.scripts].find(s => s.src === src);
    if (had && had.dataset.ok) return res();
    const s = document.createElement('script'); s.crossOrigin = 'anonymous'; s.src = src; s.async = true;
    s.onload = () => { s.dataset.ok = '1'; res(); };
    s.onerror = () => { s.remove(); rej(new Error('needs internet the first time')); };
    document.head.appendChild(s);
  });
}
let pdfjsReady = null;
function pdfjs() {
  pdfjsReady = pdfjsReady || (async () => {
    await loadScript(PDFJS_URL);
    const src = await (await fetch(PDFJS_WORKER)).text();       // a worker must be same-origin, so run it from a blob
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    try { window.__pdfWorker = new window.pdfjsLib.PDFWorker({ name: 'register' }); } catch (e) { RLOG.warn('pdf worker', e.message); }   // one worker, reused by every PDF
    return window.pdfjsLib;
  })().catch(e => { pdfjsReady = null; throw e; });
  return pdfjsReady;
}
async function renderPdfInto(box, blob, password) {
  box.innerHTML = '<div class="dv-wait">Opening PDF…</div>';
  let lib, doc;
  try { lib = await pdfjs(); }
  catch (e) { box.innerHTML = `<div class="dv-wait">The PDF viewer could not load (${esc(e.message)}). Use Share, then "Save to Files", to open it.</div>`; return; }
  try { doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), password: password || undefined, isEvalSupported: false, ...pdfWorkerOpt() }).promise; pdfOpenDocs.add(doc); }
  catch (e) {
    if (e && e.name === 'PasswordException') {
      box.innerHTML = `<div class="dv-pass"><div class="hint" style="margin:0 0 8px">${password ? 'That password did not work. ' : ''}This PDF has its own password (e-Aadhaar PDFs do). It is not saved.</div>
        <div style="display:flex;gap:8px"><input type="password" placeholder="PDF password" autocapitalize="characters" autocomplete="off" style="flex:1;min-width:0"><button class="btn small">Open</button></div></div>`;
      const inp = box.querySelector('input'), go = () => renderPdfInto(box, blob, inp.value);
      box.querySelector('button').addEventListener('click', go);
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
      return;
    }
    box.innerHTML = `<div class="dv-wait err">Could not read this PDF: ${esc(e.message || String(e))}</div>`; return;
  }
  box.innerHTML = '';
  box.onclick = e => { if (e.target.tagName === 'CANVAS') zoomPdfPage(doc, [...box.querySelectorAll('canvas.dv-page')].indexOf(e.target) + 1, e.target); };
  const width = Math.max(280, Math.min(box.clientWidth || 600, 900));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let next = 1;
  const batch = async () => {
    const more = box.querySelector('.dv-more'); if (more) more.remove();
    const end = Math.min(doc.numPages, next + PDF_PAGE_BATCH - 1);
    for (; next <= end; next++) {
      const page = await doc.getPage(next);
      const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width * dpr });
      const cv = document.createElement('canvas'); cv.className = 'dv-page'; cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.setAttribute('aria-label', `Page ${next} of ${doc.numPages}`);
      box.appendChild(cv);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
    if (next <= doc.numPages) {
      const b = document.createElement('button'); b.className = 'dv-more'; b.textContent = `Show more pages (${doc.numPages - next + 1} left)`;
      b.addEventListener('click', ev => { ev.stopPropagation(); batch(); }); box.appendChild(b);
    }
  };
  await batch();
}
$('dvEdit').addEventListener('click', () => { const id = viewDocId; Sheets.close('shDocView', true); openDoc(id); });
$('dvUnlock').addEventListener('click', () => { docReturn = viewDocId; openVault('unlock'); });
$('dvShare').addEventListener('click', () => openDocShare());

/* ---------- share (optional watermark) ---------- */
let shareReady = null;
const shareDate = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
function openDocShare() {
  const d = records[viewDocId]; if (!d) return;
  const fs = docFilesOf(d.id);
  $('dsFiles').innerHTML = fs.map(f => `<label class="switch-row"><span>${f.locked ? '🔒 ' : ''}${esc(f.name)}</span><input type="checkbox" class="sw" data-dsf="${f.id}" checked></label>`).join('');
  $('dsWm').checked = false; $('dsText').value = ''; $('dsTextWrap').classList.add('hidden');
  shareTitle = null; resetShare(); dsModeInit(fs.length);
  Sheets.open('shDocShare');
}
function resetShare() { shareReady = null; $('dsGo').textContent = 'Share'; $('dsMsg').className = 'msg'; $('dsMsg').textContent = ''; }
$('dsWm').addEventListener('change', () => { $('dsTextWrap').classList.toggle('hidden', !$('dsWm').checked); resetShare(); });
$('shDocShare').addEventListener('input', e => { if (e.target.id !== 'dsWm') resetShare(); });
function stampCanvas(g, w, h, text) {
  const fs = Math.max(14, Math.round(Math.min(w, h) / 20));
  g.save();
  g.translate(w / 2, h / 2); g.rotate(-Math.atan2(h, w));
  g.font = `600 ${fs}px -apple-system, "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(166,54,47,0.28)';
  const unit = text + '     ', diag = Math.hypot(w, h);
  const line = unit.repeat(Math.ceil(diag / Math.max(1, g.measureText(unit).width)) + 1);
  for (let y = -diag / 2; y <= diag / 2; y += fs * 4) g.fillText(line, 0, y);
  g.restore();
  const bh = Math.round(fs * 1.9);
  g.fillStyle = 'rgba(255,255,255,0.88)'; g.fillRect(0, h - bh, w, bh);
  g.fillStyle = '#A6362F'; g.font = `700 ${Math.round(fs * 0.8)}px -apple-system, "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h - bh / 2, w - 20);
}
async function watermarkImage(blob, text) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not a picture')); i.src = url; });
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    stampCanvas(g, cv.width, cv.height, text);
    return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('could not save the picture')), 'image/jpeg', 0.9));
  } finally { URL.revokeObjectURL(url); }
}
async function watermarkPdf(blob, text) {
  try { await loadScript(PDFLIB_URL); } catch (e) { throw new Error('the PDF tool ' + e.message); }
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
  let pdf;
  try { pdf = await PDFDocument.load(await blob.arrayBuffer()); }
  catch (e) { throw new Error(/encrypt/i.test(e.message || '') ? 'it is password-protected' : 'it could not be edited'); }
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const t = text.replace(/₹/g, 'Rs ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '-');
  const red = rgb(0.65, 0.21, 0.18);
  pdf.getPages().forEach(p => {
    const { width: w, height: h } = p.getSize();
    const size = Math.max(10, Math.min(w, h) / 22), a = Math.atan2(h, w), cos = Math.cos(a), sin = Math.sin(a);
    const unit = t + '     ', diag = Math.hypot(w, h);
    const line = unit.repeat(Math.ceil(diag / font.widthOfTextAtSize(unit, size)) + 1);
    const lw = font.widthOfTextAtSize(line, size);
    for (let k = -Math.ceil(diag / (size * 4) / 2); k <= Math.ceil(diag / (size * 4) / 2); k++) {
      const cx = w / 2 - k * size * 4 * sin, cy = h / 2 + k * size * 4 * cos;
      p.drawText(line, { x: cx - cos * lw / 2, y: cy - sin * lw / 2, size, font, color: red, opacity: 0.28, rotate: degrees(a * 180 / Math.PI) });
    }
    const bh = size * 1.9;
    p.drawRectangle({ x: 0, y: 0, width: w, height: bh, color: rgb(1, 1, 1), opacity: 0.88 });
    const bs = size * 0.8, tw = font.widthOfTextAtSize(t, bs);
    p.drawText(t, { x: Math.max(6, (w - tw) / 2), y: bh / 2 - bs * 0.35, size: bs, font, color: red });
  });
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
async function doShare(files, firstTry) {
  const title = shareTitle || (records[viewDocId] && records[viewDocId].title) || 'Document';
  try {
    if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, title }); Sheets.close('shDocShare'); if (shareTitle) { docSel = null; renderDocs(); } return; }
    files.forEach(f => dl(f, f.name)); Sheets.close('shDocShare'); return;
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    if (e && e.name === 'NotAllowedError' && firstTry) {           // iPhone wants a fresh tap after slow preparation
      $('dsGo').textContent = 'Share now'; $('dsMsg').className = 'msg ok';
      $('dsMsg').textContent = ($('dsMsg').textContent + ' Ready. Tap "Share now".').trim(); return;
    }
    $('dsMsg').className = 'msg err'; $('dsMsg').textContent = 'Sharing failed: ' + (e.message || e);
  }
}
$('dsGo').addEventListener('click', async () => {
  if (shareReady) { await doShare(shareReady, false); return; }
  const ids = $$('[data-dsf]', $('dsFiles')).filter(c => c.checked).map(c => c.dataset.dsf);
  const msg = $('dsMsg');
  if (!ids.length) { msg.className = 'msg err'; msg.textContent = 'Pick at least one file.'; return; }
  const wm = $('dsWm').checked ? `${$('dsText').value.trim() || 'Shared copy'} · ${shareDate()}` : '';
  $('dsGo').disabled = true; msg.className = 'msg'; msg.textContent = 'Preparing…';
  const files = [], notes = [];
  try {
    for (const id of ids) {
      const f = records[id]; if (!f) continue;
      const { blob } = await docFileBlob(f);
      if (!wm) { files.push(new File([blob], f.name, { type: f.mime })); continue; }
      if (isPdf(f)) {
        try { files.push(new File([await watermarkPdf(blob, wm)], stemOf(f.name) + '-shared.pdf', { type: 'application/pdf' })); }
        catch (e) { notes.push(`${f.name} sent without a watermark because ${e.message}.`); files.push(new File([blob], f.name, { type: f.mime })); }
      } else files.push(new File([await watermarkImage(blob, wm)], stemOf(f.name) + '-shared.jpg', { type: 'image/jpeg' }));
    }
  } catch (e) {
    $('dsGo').disabled = false; msg.className = 'msg err';
    msg.textContent = e.code === 'LOCKED' ? 'Enter your private code first to share locked files.' : 'Could not prepare: ' + e.message; return;
  }
  if (AF_DS.mode === 'one' && files.length > 1) {
    msg.textContent = 'Combining into one PDF…';
    try { const r = await mergeToPdf(files, shareTitle || (records[viewDocId] && records[viewDocId].title) || 'Documents'); files.length = 0; files.push(r.file); if (r.skipped.length) notes.push('Left out: ' + r.skipped.join(', ') + '.'); }
    catch (e) { $('dsGo').disabled = false; msg.className = 'msg err'; msg.textContent = 'Could not combine: ' + e.message; return; }
  }
  $('dsGo').disabled = false; shareReady = files;
  msg.className = notes.length ? 'msg err' : 'msg'; msg.textContent = notes.join(' ');
  if (wm && notes.some(n => /without a watermark/.test(n))) { $('dsGo').textContent = 'Share anyway'; return; }   // you asked for a watermark: confirm first
  await doShare(files, true);
});

/* ---------- common documents quick add ---------- */
const COMMON_DOCS = [['Aadhaar card', 'Identity'], ['PAN card', 'Identity'], ['Driving licence', 'Identity'], ['Passport', 'Identity'],
  ['Voter ID', 'Identity'], ['10th marksheet', 'Education'], ['12th marksheet', 'Education'], ['Degree certificate', 'Education'], ['Vehicle RC', 'Vehicle']];
function openDocQuick() {
  const forWho = docPath.who || DOC_ME, have = new Set(all('doc').filter(d => docOwners(d).includes(forWho)).map(d => (d.title || '').trim().toLowerCase()));
  $('dqList').innerHTML = COMMON_DOCS.map(([t, ty], i) => {
    const got = have.has(t.toLowerCase());
    return `<label class="switch-row"><span>${t}<small class="dq-sub">${got ? 'Already in your list' : ty}</small></span><input type="checkbox" class="sw" data-dq="${i}"${got ? ' disabled' : ''}></label>`;
  }).join('');
  Sheets.open('shDocQuick');
}
$('docQuickBtn').addEventListener('click', openDocQuick);
$('dqAdd').addEventListener('click', () => {
  const picks = $$('[data-dq]', $('dqList')).filter(c => c.checked && !c.disabled).map(c => COMMON_DOCS[+c.dataset.dq]);
  if (!picks.length) { toast('Pick at least one.'); return; }
  picks.forEach(([t, ty]) => put({ id: uid('doc'), type: 'doc', title: t, docType: ty, number: '', expiry: null, issuer: '', notes: '', folder: docFolderForNew(), who: docPath.who && docPath.who !== DOC_ME ? docPath.who : '', deleted: false }, { render: false }));
  Sheets.close('shDocQuick'); scheduleRender();
  toast(`Added ${picks.length}. Tap one to attach its file.`);
});

/* ==========================================================================
   MONEY (private, encrypted) — ledger, udhaar by person, budgets
   ======================================================================== */
let finMonth = isoMonth(new Date()), budMonth = isoMonth(new Date());
const KINDS = [{ v: 'expense', l: 'Spent' }, { v: 'income', l: 'Received' }, { v: 'lent', l: 'Udhaar diya (lent)' }, { v: 'borrowed', l: 'Udhaar liya (borrowed)' }, { v: 'transfer', l: 'Transfer' }];
const isUdhaar = k => k === 'lent' || k === 'borrowed';
const outstanding = e => Math.max(0, (e.amount || 0) - (e.paidAmount || 0));
const people = () => [...new Set(all('fin').map(e => (e.who || '').trim()).filter(Boolean))].sort();
function refreshPeopleList() {
  $('peopleDl').innerHTML = people().map(p => `<option value="${esc(p)}">`).join('');
}

function renderMoney() {
  if (!finUnlocked()) { showTab('tasks'); return; }
  const seg = prefs.moneySeg === 'budget' ? 'ledger' : prefs.moneySeg;
  $$('#moneySeg button').forEach(b => b.classList.toggle('on', b.dataset.v === seg));
  $('paneLedger').classList.toggle('hidden', seg !== 'ledger');
  $('paneUdhaar').classList.toggle('hidden', seg !== 'udhaar');
  $('panePlan').classList.toggle('hidden', seg !== 'plan');
  $('paneAccts').classList.toggle('hidden', seg !== 'accts');
  $('paneSnotes').classList.toggle('hidden', seg !== 'snotes');
  planBadge();
  const lock = $('moneyLocked');
  if (Fin.lockedOut.length) {
    lock.classList.remove('hidden');
    lock.innerHTML = `<div class="group" style="padding:14px"><b>${Fin.lockedOut.length} entr${Fin.lockedOut.length > 1 ? 'ies were' : 'y was'} saved under an older code.</b>
      <p class="hint" style="margin:6px 0 10px">Enter that older code once and they will be brought across.</p>
      <div style="display:flex;gap:8px"><input type="password" id="oldCodeIn" placeholder="Older code"><button class="btn small" id="oldCodeGo">Recover</button></div></div>`;
    $('oldCodeGo').addEventListener('click', async () => { const n = await recoverLockedOut($('oldCodeIn').value); toast(n ? `Recovered ${n}.` : 'That code did not open them.'); });
  } else lock.classList.add('hidden');
  refreshPeopleList();
  if (seg === 'ledger') renderLedger(); else if (seg === 'udhaar') renderUdhaar();
  else if (seg === 'plan') renderPlan(); else if (seg === 'accts') renderAccts(); else if (seg === 'snotes') renderSnotes(); else renderLedger();
  if (Sheets.isOpen('shInsights')) renderInsights();
}
$$('#moneySeg button').forEach(b => b.addEventListener('click', () => { setPref('moneySeg', b.dataset.v); renderMoney(); }));

function finRow(e, showDate) {
  const sign = e.kind === 'income' ? '+' : e.kind === 'expense' ? '−' : e.kind === 'transfer' ? '↔ ' : '';
  const cls = e.kind === 'income' ? 'pos' : e.kind === 'expense' ? 'neg' : '';
  const part = isUdhaar(e.kind) && !e.settled && (e.paidAmount || 0) > 0;
  return swipeHtml(`<div class="row fin-row ${e.settled ? 'muted' : ''}">
    <div class="row-main"><div class="row-title">${esc(e.desc || '—')}${e.who ? ` <span class="muted">· ${esc(e.who)}</span>` : ''}</div>
      <div class="row-sub">${showDate !== false ? `<span>${fmtDate(e.date)}</span>` : ''}${isUdhaar(e.kind) ? `<span class="pill">${e.kind === 'lent' ? 'lent' : 'borrowed'}</span>` : ''}
        ${e.category ? `<span><i class="cat-dot" style="background:${FIN_COLORS[e.category] || '#777'}"></i> ${esc(e.category)}</span>` : ''}${e.recurring ? '<span>🔁 monthly</span>' : ''}
        ${finRoute(e)}${part ? `<span>${fmtMoney(e.paidAmount)} paid back</span>` : ''}${e.settled && isUdhaar(e.kind) ? '<span class="pos">settled</span>' : ''}</div></div>
    <div class="row-end"><span class="amt ${cls}">${sign}${fmtMoney(e.amount)}</span></div></div>`, '', 'Delete 🗑', `data-fin="${e.id}"`);
}
function wireFinRows(root) {
  $$('[data-fin]', root).forEach(w => { const id = w.dataset.fin; bindSwipe(w, null, () => deleteWithUndo(id)); onTap(w, () => openFin(id)); });
}
/* v2.19 (B2): one rule everywhere — spending in the "Investment" category is money put into investments, shown on its own line, not as spending */
function monthFigures(list) {
  let inc = 0, out = 0, inv = 0;
  list.forEach(e => { const a = +e.amount || 0; if (e.kind === 'income') inc += a; else if (e.kind === 'expense') { if (e.category === 'Investment') inv += a; else out += a; } });
  return { inc, out, inv, net: inc - out };
}
/* account balances as chips (Bank · Cash · Card dues, then each account) — same figures as Accounts and the dashboard */
let stripCache = { ver: -1, day: '', html: '' };
function renderAcctStrip() {
  const box = $('acctStrip'); if (!box) return;
  const c = planCfg(), t = todayISO();
  if (!c || !accts().length) { box.innerHTML = `<button class="ac-chip ac-setup" id="acSetupGo"><span>Balances</span><b>Set up accounts ›</b></button>`; $('acSetupGo').addEventListener('click', () => { setPref('moneySeg', 'accts'); renderMoney(); }); return; }
  if (stripCache.ver !== storeVer || stripCache.day !== t || !stripCache.html) {
    let B; try { B = balancesOn(c, t); } catch (e) { RLOG.warn('strip', e.message); box.innerHTML = ''; return; }
    const chip = (attrs, k, v, cls) => `<button class="ac-chip ${cls || ''}" ${attrs}><span>${k}</span><b>${v}</b></button>`;
    const tot = [chip('data-acs="bank"', 'Bank', rsShort(B.bank), B.bank < 0 ? 'neg' : ''), chip('data-acs="cash"', 'Cash', rsShort(B.cash), B.cash < 0 ? 'neg' : ''),
      ...(B.card ? [chip('data-acs="card"', 'Card dues', '−' + rsShort(B.card), 'neg')] : []), ...(Math.abs(B.invest) >= 1 ? [chip('data-acs="invest"', 'Investments', rsShort(B.invest))] : [])];
    const each = accts().filter(a => a.kind !== 'loan').map(a => { const v = B.accts[a.id] || 0, k = bucketOf(a.kind);
      return chip(`data-acid="${a.id}"`, esc(a.name), k === 'card' ? (v < 0 ? 'due ' + rsShort(-v) : rsShort(v)) : rsShort(v), (k === 'card' && v < 0) || (k !== 'card' && v < 0) ? 'neg sub' : 'sub'); });
    stripCache = { ver: storeVer, day: t, html: tot.join('') + (each.length ? '<i class="ac-sep" aria-hidden="true"></i>' + each.join('') : '') };
  }
  box.innerHTML = stripCache.html;
  $$('[data-acs]', box).forEach(b => b.addEventListener('click', () => { setPref('moneySeg', 'accts'); renderMoney(); }));
  $$('[data-acid]', box).forEach(b => b.addEventListener('click', () => acctSheet(b.dataset.acid)));
}
function renderLedHero(M) {
  const box = $('ledHero'); if (!box) return;
  const both = M.inc + M.out, pin = both ? Math.round(M.inc / both * 1000) / 10 : 0, pout = both ? Math.round((100 - pin) * 10) / 10 : 0;
  box.innerHTML = `<div class="led-hero"><div class="lh-k">Net this month</div>
    <div class="lh-v ${M.net < 0 ? 'neg' : M.net > 0 ? 'pos' : ''}">${M.net < 0 ? '−' : ''}${rsShort(Math.abs(M.net))}</div>
    <div class="io-bar" role="img" aria-label="In ${rs(M.inc)}, out ${rs(M.out)}">${both ? `<i class="io-in" style="width:${pin}%"></i><i class="io-out" style="width:${pout}%"></i>` : ''}</div>
    <div class="io-lbl"><span><i class="dot-in"></i>In <b>${rsShort(M.inc)}</b></span><span><i class="dot-out"></i>Out <b>${rsShort(M.out)}</b></span></div>
    <div class="lh-inv"><span>Into investments</span><b>${rsShort(M.inv)}</b></div>
    <div class="lh-note">Investments are not counted as spending — same as the dashboard and the PDF report.</div></div>`;
}
function renderLedger() {
  $('finMonthLbl').textContent = monthLong(finMonth);
  const month = all('fin').filter(e => (e.date || '').slice(0, 7) === finMonth);
  renderAcctStrip();
  renderLedHero(monthFigures(month));
  renderLedgerList();
}
/* v2.19 (B4): typing in the search box redraws only the list, a moment after you stop typing */
function renderLedgerList() {
  const entries = all('fin'), month = entries.filter(e => (e.date || '').slice(0, 7) === finMonth);
  const FQ = finFilterState(), filtering = FQ.active;
  $('finFilterDot').classList.toggle('hidden', !(filtering || FQ.allMonths));
  const shown = (FQ.allMonths ? entries.slice() : month).filter(FQ.match);
  const LIMIT = 300, cut = shown.length > LIMIT;
  const byDay = {};
  shown.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt).slice(0, LIMIT).forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const days = Object.keys(byDay);
  const sumOf = (L, k) => L.filter(e => e.kind === k).reduce((t, e) => t + (+e.amount || 0), 0), ud = shown.filter(e => isUdhaar(e.kind)).length;
  $('finFSum').textContent = filtering ? (shown.length ? `${shown.length} entr${shown.length === 1 ? 'y' : 'ies'}${FQ.allMonths ? ' across all months' : ' this month'} · Spent ${fmtMoney(sumOf(shown, 'expense'))} · Received ${fmtMoney(sumOf(shown, 'income'))}${ud ? ` · ${ud} udhaar` : ''}${cut ? ` · showing the newest ${LIMIT}` : ''}` : '') : '';
  $('finFSum').classList.toggle('hidden', !$('finFSum').textContent);
  const dayHead = d => { const L = byDay[d], sp = sumOf(L, 'expense'), rc = sumOf(L, 'income');
    return `<div class="day-head"><span>${FQ.allMonths ? fmtDate(d, true) : relDay(d)}</span><span class="day-tot">${sp ? `<b class="neg">−${fmtMoney(sp)}</b>` : ''}${rc ? `<b class="pos">+${fmtMoney(rc)}</b>` : ''}</span></div>`; };
  $('finList').innerHTML = days.length ? days.map(d => `${dayHead(d)}<div class="group fin-day">${byDay[d].map(e => finRow(e, false)).join('')}</div>`).join('')
    : filtering ? '<div class="empty"><b>No matches</b>Try a shorter word, or tick “Search all months”.</div>' : '<div class="empty"><b>Nothing this month</b>Tap + to record spending, income or udhaar.</div>';
  wireFinRows($('finList'));
}
/* the filter lives in its own controls; locking Money clears it */
function finFilterState() {
  const q = $('finQ').value.trim().toLowerCase(), cat = $('finCatF').value, kind = $('finKindF').value, allMonths = $('finAllM').checked;
  const match = e => (!q || (String(e.desc || '') + ' ' + String(e.who || '') + ' ' + String(e.category || '')).toLowerCase().includes(q))
    && (!cat || (cat === '__none' ? !e.category : e.category === cat))
    && (!kind || (kind === 'udhaar' ? isUdhaar(e.kind) : e.kind === kind));
  return { q, cat, kind, allMonths, match, active: !!(q || cat || kind) };
}
function initFinFilter() {
  $('finCatF').innerHTML = '<option value="">All categories</option>' + FIN_CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + '<option value="__none">No category</option>';
  $('finKindF').innerHTML = '<option value="">All types</option><option value="expense">Spent</option><option value="income">Received</option><option value="udhaar">Udhaar</option><option value="transfer">Transfer</option>';
  let t = null;
  $('finQ').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderLedgerList, 160); });
  ['finCatF', 'finKindF', 'finAllM'].forEach(id => $(id).addEventListener('change', renderLedgerList));
  $('finFilterBtn').addEventListener('click', () => {
    const p = $('finFilterPanel'), open = p.classList.toggle('hidden') === false;
    $('finFilterBtn').setAttribute('aria-expanded', String(open)); $('finFilterBtn').classList.toggle('on', open);
    if (open) setTimeout(() => $('finQ').focus(), 50);
  });
  $('finClearF').addEventListener('click', () => { clearFinFilter(); renderLedgerList(); });
  $('finInsBtn').addEventListener('click', openInsights);
}
function clearFinFilter() { $('finQ').value = ''; $('finCatF').value = ''; $('finKindF').value = ''; $('finAllM').checked = false; if ($('finFilterDot')) $('finFilterDot').classList.add('hidden'); }
initFinFilter();
$('finPrev').addEventListener('click', () => { finMonth = monthAdd(finMonth, -1); renderLedger(); });
$('finNext').addEventListener('click', () => { finMonth = monthAdd(finMonth, 1); renderLedger(); });

function renderUdhaar() {
  const ud = all('fin').filter(e => isUdhaar(e.kind));
  const open = ud.filter(e => !e.settled);
  const owed = open.filter(e => e.kind === 'lent').reduce((s, e) => s + outstanding(e), 0);
  const owe = open.filter(e => e.kind === 'borrowed').reduce((s, e) => s + outstanding(e), 0);
  $('udOwed').textContent = rsShort(owed); $('udOwe').textContent = rsShort(owe);
  { const u = owed - owe; $('udNet').textContent = (u < 0 ? '−' : u > 0 ? '+' : '') + rsShort(Math.abs(u)); $('udNet').className = 'n ' + (u < 0 ? 'neg' : u > 0 ? 'pos' : ''); }   // v2.19: moved here from the Ledger
  const byP = {};
  open.forEach(e => { const p = (e.who || '').trim() || '(no name)'; (byP[p] = byP[p] || []).push(e); });
  const ps = Object.keys(byP).map(p => ({ p, list: byP[p], bal: byP[p].reduce((s, e) => s + (e.kind === 'lent' ? 1 : -1) * outstanding(e), 0) }))
    .sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal));
  $('udList').innerHTML = ps.length ? ps.map(({ p, list, bal }) => `<div class="person">
      <div class="person-head"><div class="avatar" aria-hidden="true">${esc(p.slice(0, 1).toUpperCase())}</div>
        <div class="row-main"><div class="row-title">${esc(p)}</div><div class="row-sub">${bal >= 0 ? 'owes you' : 'you owe'} · ${list.length} entr${list.length > 1 ? 'ies' : 'y'}</div></div>
        <span class="amt ${bal >= 0 ? 'pos' : 'neg'}">${fmtMoney(bal)}</span></div>
      <div class="person-lines">${list.sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => `
        <div class="pline"><span class="d">${fmtDate(e.date)} · ${esc(e.desc || '')}${(e.paidAmount || 0) > 0 ? ` · ${fmtMoney(e.paidAmount)} back` : ''}</span>
          <span class="amt ${e.kind === 'lent' ? 'pos' : 'neg'}" style="font-size:13.5px">${fmtMoney(outstanding(e))}</span>
          <button class="btn small ghost" data-settle="${e.id}">Settle</button><button class="icon-btn" data-fe="${e.id}" aria-label="Edit entry" style="width:32px;height:32px;font-size:14px">✎</button></div>`).join('')}
        ${list.length > 1 ? `<button class="linkbtn" data-settleall="${esc(p)}">Settle all with ${esc(p)}</button>` : ''}</div></div>`).join('')
    : '<div class="empty"><b>No open udhaar</b>Nobody owes anything right now.</div>';
  $$('[data-settle]', $('udList')).forEach(b => b.addEventListener('click', () => openSettle(b.dataset.settle)));
  $$('[data-fe]', $('udList')).forEach(b => b.addEventListener('click', () => openFin(b.dataset.fe)));
  $$('[data-settleall]', $('udList')).forEach(b => b.addEventListener('click', () => {
    const p = b.dataset.settleall, list = byP[p];
    const settleAll = acct => {
      const snap = list.map(e => ({ id: e.id, paid: e.paidAmount || 0, pays: (e.pays || []).slice(), settled: !!e.settled })), today = todayISO();
      list.forEach(e => { const rest = outstanding(e); if (rest > 0 && acct) e.pays = (e.pays || []).concat([{ date: today, amt: +rest.toFixed(2), acct }]); e.paidAmount = e.amount; e.settled = true; put(e, { render: false }); });
      scheduleRender();
      toast(`Settled everything with ${p}.`, 'Undo', () => snap.forEach(s => { const e = records[s.id]; e.paidAmount = s.paid; e.pays = s.pays; e.settled = s.settled; put(e); }));
    };
    if (typeof accts === 'function' && accts().length && typeof planSheet === 'function') {
      const net = list.reduce((s, e) => s + (e.kind === 'lent' ? 1 : -1) * outstanding(e), 0);
      planSheet('Settle all with ' + p, `<p class="hint">${net >= 0 ? `${esc(p)} pays you ${fmtMoney(net)}` : `You pay ${esc(p)} ${fmtMoney(-net)}`} for ${list.length} entries.</p>
        <div class="field"><label>${net >= 0 ? 'Received into' : 'Paid from'}</label><select id="saAcct">${acctOptions(lastAcct('udhaar') || defAcct(planCfg()), a => isLiquid(a.kind) || a.kind === 'card')}</select></div>`,
        () => { rememberAcct('udhaar', $('saAcct').value); settleAll($('saAcct').value); return true; }, 'Settle all');
    } else { if (!confirm(`Mark all ${list.length} entries with ${p} as settled?`)) return; settleAll(null); }
  }));
  const done = ud.filter(e => e.settled).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 60);
  $('udSettled').innerHTML = done.length ? done.map(e => finRow(e)).join('') : '<div class="empty">None yet.</div>';
  wireFinRows($('udSettled'));
}
let settleId = null;
function openSettle(id) {
  const e = records[id]; if (!e) return;
  settleId = id;
  $('stHint').textContent = 'Leave the full amount to settle it, type a smaller part-payment, or a larger amount if more changed hands.';
  { const has = typeof accts === 'function' && accts().length; $('stAcctWrap').classList.toggle('hidden', !has);
    if (has) { $('stAcctLbl').textContent = e.kind === 'lent' ? 'Received into' : 'Paid from'; $('stAcct').innerHTML = acctOptions(e.acct || lastAcct('udhaar') || defAcct(planCfg()), a => !isInvest(a.kind) && a.kind !== 'loan'); } }
  $('stTitle').textContent = e.kind === 'lent' ? `${e.who || 'They'} paid back` : `You paid ${e.who || ''}`.trim();
  $('stSub').textContent = `${e.desc || ''} · outstanding ${fmtMoney(outstanding(e))}`;
  $('stAmt').value = outstanding(e);
  Sheets.open('shSettle');
}
$('stOk').addEventListener('click', () => {
  const e = records[settleId]; if (!e) return;
  const rem = outstanding(e); let amt = calcAmount($('stAmt').value);
  if (isNaN(amt) || amt <= 0) amt = rem;
  const over = amt > rem + 0.005 ? +(amt - rem).toFixed(2) : 0;
  amt = Math.min(amt, rem);
  const prev = { paid: e.paidAmount || 0, settled: !!e.settled };
  const stAcct = !$('stAcctWrap').classList.contains('hidden') ? $('stAcct').value : null;
  e.paidAmount = +(((e.paidAmount || 0) + amt).toFixed(2));
  if (e.paidAmount >= e.amount - 0.005) { e.paidAmount = e.amount; e.settled = true; }
  const prevPays = (e.pays || []).slice();
  if (stAcct) e.pays = prevPays.concat([{ date: todayISO(), amt, acct: stAcct }]);
  put(e); Sheets.close('shSettle');
  let extraId = null;
  if (over) extraId = put({ id: uid('f'), type: 'fin', desc: 'Extra when settling' + (e.desc ? ': ' + e.desc : ''), amount: over, kind: e.kind === 'lent' ? 'borrowed' : 'lent',
    category: '', date: todayISO(), who: e.who || '', acct: stAcct || undefined, recurring: false, paidAmount: 0, settled: false, deleted: false }).id;
  const undo = () => { e.paidAmount = prev.paid; e.settled = prev.settled; e.pays = prevPays; put(e); if (extraId) softDelete(extraId); };
  if (over) toast(`Settled. ${fmtMoney(over)} extra recorded as ${e.kind === 'lent' ? 'you owe ' : 'owed to you by '}${e.who || 'them'}.`, 'Undo', undo, 7000);
  else toast(e.settled ? 'Settled in full.' : `${fmtMoney(amt)} recorded — ${fmtMoney(outstanding(e))} still open.`, 'Undo', undo);
});

function budgets() { const b = {}; all('budget').forEach(x => { if (x.amount > 0) b[x.category] = x.amount; }); return b; }
function renderBudgets() {
  $('budMonthLbl').textContent = monthLong(budMonth);
  const month = all('fin').filter(e => e.kind === 'expense' && (e.date || '').slice(0, 7) === budMonth);
  const byCat = {}; month.forEach(e => { const c = e.category || 'Other'; byCat[c] = (byCat[c] || 0) + e.amount; });
  const bud = budgets();
  const cats = [...new Set([...Object.keys(byCat), ...Object.keys(bud)])].sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));
  const max = Math.max(1, ...Object.values(byCat));
  $('budBars').innerHTML = cats.length ? cats.map(c => {
    const spent = byCat[c] || 0, cap = bud[c] || 0, over = cap && spent > cap;
    const pct = cap ? Math.min(100, Math.round(spent / cap * 100)) : Math.round(spent / max * 100);
    return `<div class="bar-row"><div class="bar-lbl"><span>${esc(c)}${over ? ' ⚠' : ''}</span><span class="${over ? 'neg' : ''}">${fmtMoney(spent)}${cap ? ' / ' + fmtMoney(cap) : ''}</span></div>
      <div class="bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(c)}"><div class="bar-fill" style="width:${pct}%;background:${over ? 'var(--neg)' : FIN_COLORS[c] || '#77818E'}"></div></div></div>`;
  }).join('') : '<div class="empty">No spending recorded this month.</div>';
}
$('budPrev').addEventListener('click', () => { budMonth = monthAdd(budMonth, -1); renderBudgets(); });
$('budNext').addEventListener('click', () => { budMonth = monthAdd(budMonth, 1); renderBudgets(); });
$('budSetBtn').addEventListener('click', () => {
  chipGroup($('bgCat'), FIN_CATS.filter(c => c !== 'Salary'), 'Household', v => { const b = all('budget').find(x => x.category === v); $('bgAmt').value = b ? b.amount : ''; });
  const b = all('budget').find(x => x.category === 'Household'); $('bgAmt').value = b ? b.amount : '';
  Sheets.open('shBudget');
});
$('bgSave').addEventListener('click', () => {
  const c = chipValue($('bgCat')), a = calcAmount($('bgAmt').value);
  if (isNaN(a) || a < 0) { toast('Enter an amount.'); return; }
  const ex = all('budget').find(x => x.category === c);
  if (ex) { ex.amount = a; put(ex); } else put({ id: uid('b'), type: 'budget', category: c, amount: a, deleted: false });
  Sheets.close('shBudget'); toast(a ? `${c} budget: ${fmtMoney(a)} a month.` : `${c} budget removed.`);
});
$('finCsvBtn').addEventListener('click', () => {
  const rows = [['Date', 'Description', 'Type', 'Category', 'Person', 'Amount', 'Paid back', 'Outstanding', 'Settled']];
  all('fin').sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(e => rows.push([e.date, e.desc, e.kind, e.category || '', e.who || '', e.amount, e.paidAmount || 0, isUdhaar(e.kind) ? outstanding(e) : '', e.settled ? 'yes' : 'no']));
  const safe = c => typeof c === 'string' && /^[=+\-@\t\r]/.test(c) ? "'" + c : c;     // v2.18: Excel would run a cell that starts with = + - @ as a formula
  const csv = rows.map((r, i) => r.map(c => `"${String(c == null ? '' : i ? safe(c) : c).replace(/"/g, '""')}"`).join(',')).join('\n');
  shareOrDownload('﻿' + csv, 'register-ledger-' + todayISO() + '.csv', 'text/csv');
});

/* ==========================================================================
   PRIVATE NOTES (v2.2) — notes of type 'snote', sealed like Money entries.
   They reuse the normal note editor. Pictures in them are encrypted.
   ======================================================================== */
const secretImg = new Map();                    // blob id -> object/data URL, memory only
function newSecretNote() {
  if (!Fin.key) { toast('Enter your private code first.'); return; }
  const n = put({ id: uid('sn'), type: 'snote', title: '', text: '', color: NOTE_COLORS[0], pinned: false, folder: '', docRefs: [], imgs: [], deleted: false });
  openNoteEditor(n.id);
}
function renderSnotes() {
  const notes = all('snote').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  const area = $('snArea');
  area.innerHTML = `<button class="btn ghost small" id="snNew" style="margin:0 0 12px">＋ New private note</button>`
    + (notes.length ? `<div class="notes-grid">${notes.map(n => noteCard(n, new Set())).join('')}</div>`
      : '<div class="empty"><b>No private notes</b>Encrypted with your private code. Tap + to write one.</div>');
  $('snNew').addEventListener('click', newSecretNote);
  $$('[data-note]', area).forEach(b => b.addEventListener('click', () => prefs.noteEdit ? openNoteEditor(b.dataset.note) : previewNote(b.dataset.note)));
}
function compressSmall(file, limit) {
  return loadImage(file).then(({ img }) => {
    for (const dim of [1000, 820, 650, 500]) {
      const cv = drawTo(img, dim);
      for (let q = 0.72; q >= 0.3; q -= 0.08) { const out = cv.toDataURL('image/jpeg', q); if (out.length <= limit) return out; }
    }
    throw new Error('too large');
  });
}
async function storeSecretImages(files, already) {
  if (!Fin.key) { toast('Enter your private code first.'); return []; }
  const ids = []; let failed = 0;
  const useDrive = driveOn();
  if (useDrive && files.length) toast('Encrypting and uploading…', null, null, 20000);
  for (const f of files) {
    if (already + ids.length >= IMG_PER_NOTE) { toast(`Up to ${IMG_PER_NOTE} pictures per note.`); break; }
    try {
      if (useDrive) {
        const dataUrl = await prepForDrive(f);
        const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
        const bytes = unb64(dataUrl.slice(dataUrl.indexOf(',') + 1));
        const up = await putDocBytes(bytes, todayISO() + '-private-picture', mime, true);
        ids.push(put({ id: uid('img'), type: 'blob', drive: true, fileId: up.fileId, keyId: up.keyId, mime, name: 'picture', bytes: bytes.length, deleted: false }, { render: false }).id);
      } else {
        const data = await compressSmall(f, 34000);            // stays under the Sheet's cell limit after encryption
        const raw = b64(crypto.getRandomValues(new Uint8Array(32)));
        const keyId = put({ id: uid('fk'), type: 'filekey', raw, deleted: false }, { render: false }).id;
        const encData = await aesEnc(await importFileKey(raw), data);
        ids.push(put({ id: uid('img'), type: 'blob', keyId, encData, deleted: false }, { render: false }).id);
      }
    } catch (e) { RLOG.warn('private picture failed', e.message); failed++; }
  }
  if (failed) toast(`${failed} picture(s) couldn't be stored.`);
  else if (ids.length) toast(`${ids.length} picture${ids.length > 1 ? 's' : ''} added, encrypted.`);
  return ids;
}
async function secretImgSrc(b) {
  if (secretImg.has(b.id)) return secretImg.get(b.id);
  if (!Fin.key) throw lockedErr();
  const key = await fileKeyOf(b);
  let src;
  if (b.encData) src = await aesDec(key, b.encData);
  else {
    const bytes = await aesDecBytes(key, await rawDocBytes(b));
    src = URL.createObjectURL(new Blob([bytes], { type: b.mime || 'image/jpeg' }));
  }
  secretImg.set(b.id, src);
  return src;
}
function forgetSecretImgs() {
  for (const [, v] of secretImg) if (String(v).startsWith('blob:')) URL.revokeObjectURL(v);
  secretImg.clear();
}
/* Called just before the private section locks: save what is open, then close it. */
function beforeFinanceLock() {
  try {
    const n = records[editNoteId];
    if (Sheets.isOpen('shNote') && n && n.type === 'snote') { clearTimeout(neTimer); neSave(); Sheets.close('shNote', true); }
    const v = records[viewNoteId];
    if (v && v.type === 'snote') ['shNoteView', 'shNoteMore', 'shVersions'].forEach(id => Sheets.close(id, true));
    if (Sheets.isOpen('shPlan') && typeof Plan.save === 'function') { try { Plan.save(true); } catch (e) { RLOG.warn('plan save on lock', e.message); } }
  } catch (e) { RLOG.warn('beforeFinanceLock', e.message); }
}

/* ==========================================================================
   ACCOUNTS + PLAN (v2.4). All records here are sealed (encrypted).
     acct       anything that holds money: bank, salary a/c, cash, wallet,
                mutual fund, FD/PPF/NPS, credit card, loan, other
     recur      recurring item: income into an account, expense out of one,
                or a transfer between two. "budget" expenses are day-to-day
                spending estimates that the Ledger replaces as you spend.
     planmonth  per month: amount changes, ticks (done), one-off items,
                balance checks, closed flag
     plancfg    start month, default account, year display, show-until
     goal       amount by a month, measured against net worth
   Truth: the Ledger (Money → Ledger) is what actually happened. Ticking a
   planned item as done writes it into the Ledger. Opening balances are as
   on the last day of the month before the plan starts.
   ======================================================================== */
const PLAN_CFG_ID = 'plan-cfg';
const PLAN_MAX_MONTHS = 240;
const Plan = { year: null, save: null };
const ACCT_KINDS = [['bank', 'Bank account'], ['salary', 'Salary account'], ['cash', 'Cash in hand'], ['wallet', 'Wallet / UPI'], ['mf', 'Mutual fund'],
  ['fd', 'FD / PPF / NPS'], ['card', 'Credit card'], ['loan', 'Loan'], ['other', 'Other']];
const kindLabel = k => (ACCT_KINDS.find(x => x[0] === k) || ['', 'Other'])[1];
const isLiab = k => k === 'card' || k === 'loan';
const isInvest = k => k === 'mf' || k === 'fd';
const isLiquid = k => ['bank', 'salary', 'cash', 'wallet', 'other'].includes(k);
const pmId = ym => 'pm-' + ym;
const pmGet = ym => { const r = records[pmId(ym)]; return r && !r.deleted ? r : null; };
const pmNew = ym => ({ id: pmId(ym), type: 'planmonth', v: 3, month: ym, items: {}, extra: [], checked: {}, closed: false, deleted: false });
const num = v => { const n = typeof v === 'number' ? v : calcAmount(String(v == null ? '' : v).replace(/[₹,\s]/g, '').replace(/^−/, '-')); return isFinite(n) ? n : NaN; };
const isBlank = v => v == null || String(v).trim() === '';
const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const monthEnd = ym => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0); return ym + '-' + String(d.getDate()).padStart(2, '0'); };
const yearKey = (ym, mode) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return mode === 'fy' ? (m >= 4 ? y : y - 1) : y; };
const yearLabel = (k, mode) => mode === 'fy' ? `FY ${k}-${String((k + 1) % 100).padStart(2, '0')}` : String(k);
function rs(n) { n = Math.round(Number(n) || 0) || 0; return (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN'); }
function rsShort(n) {
  n = Number(n) || 0; if (Math.abs(n) < 0.5) n = 0; const s = n < 0 ? '−' : '', a = Math.abs(n);
  if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(2) + ' L';
  return s + '₹' + Math.round(a).toLocaleString('en-IN');
}
const planCfg = () => { const c = records[PLAN_CFG_ID]; return c && !c.deleted ? c : null; };
const accts = (withArchived) => all('acct').filter(a => withArchived || !a.archived)
  .sort((a, b) => ACCT_KINDS.findIndex(k => k[0] === a.kind) - ACCT_KINDS.findIndex(k => k[0] === b.kind) || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
const acctById = id => { const a = records[id]; return a && a.type === 'acct' && !a.deleted ? a : null; };
const acctName = id => { const a = acctById(id); return a ? a.name : '—'; };
const defAcct = c => { const a = acctById(c && c.defAcct); if (a && !a.archived) return a.id; const l = accts().find(x => isLiquid(x.kind)) || accts()[0]; return l ? l.id : null; };
function acctOptions(sel, filter) {
  return accts(true).filter(a => a.id === sel || (!a.archived && (!filter || filter(a)))).map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}${a.archived ? ' (archived)' : ''}</option>`).join('');   // the entry's own account is always listed
}
const RK_ORDER = ['income', 'udhback', 'transfer', 'expense'];
const recurs = () => all('recur').sort((a, b) => RK_ORDER.indexOf(a.kind) - RK_ORDER.indexOf(b.kind) || (a.createdAt || 0) - (b.createdAt || 0));
function recurDue(r, ym) {
  if (!r.start || ym < r.start || (r.end && ym > r.end)) return false;
  return monthsBetween(r.start, ym) % (+r.every || 1) === 0;
}

/* ---------- loans ---------- */
function loanInfo(l, atYm) {
  const cur = atYm || isoMonth(new Date());
  const n = l.start && l.end ? monthsBetween(l.start, l.end) + 1 : 0;
  const paidAt = ym => !l.start || ym < l.start ? 0 : Math.min(n || Infinity, monthsBetween(l.start, ym) + 1);   // counts this month's EMI, like loanOwed
  const paid = paidAt(cur);
  const emi = +l.emi || 0, P = +l.amount || 0;
  const out = { n, paid, left: n ? Math.max(0, n - paid) : null, emi, total: n * emi, paidAmt: paid * emi, leftAmt: n ? Math.max(0, n - paid) * emi : null, rate: null, interest: null, outstanding: null, r: null };
  let r = null;
  if (+l.rate > 0) r = +l.rate / 1200;
  else if (P > 0 && n > 0 && emi * n > P) {
    let lo = 1e-9, hi = 0.1;
    for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2, pv = emi * (1 - Math.pow(1 + m, -n)) / m; if (pv > P) lo = m; else hi = m; }
    r = (lo + hi) / 2;
  }
  if (r && P > 0) {
    out.r = r; out.rate = r * 1200; out.interest = Math.max(0, emi * n - P);
    const bal = k => Math.max(0, P * Math.pow(1 + r, k) - emi * (Math.pow(1 + r, k) - 1) / r);
    out.outstanding = bal(paid); out.balAfter = k => bal(Math.min(Math.max(0, k), n));
  }
  out.paidBy = paidAt;
  return out;
}
const loanSched = l => !!(+l.emi && l.start && l.end);
/* What you owe on a loan at the end of month ym (after that month's EMI). */
function loanOwed(l, ym) {
  const k = loanInfo(l, ym);
  const done = !l.start || ym < l.start ? 0 : Math.min(k.n, monthsBetween(l.start, ym) + 1);
  if (k.balAfter) return k.balAfter(done);
  if (k.n) return Math.max(0, k.n - done) * k.emi;
  return +l.open || 0;
}

/* ---------- ledger → movements ---------- */
const finDate = e => (e.date || '').slice(0, 10);
/* All actual money movements from the Ledger, as { ym, date, acct, amt, cat } with the sign seen by that account. */
function ledgerFlows(c) {
  const out = [], start = c.startMonth, dflt = (acctById(c.defAcct) || {}).id || defAcct(c);   // untagged entries stay on the default even if it is archived
  const push = (date, acct, amt, cat, e) => { if (!acct || !acctById(acct) || !date || date.slice(0, 7) < start) return; out.push({ ym: date.slice(0, 7), date, acct, amt, cat, e }); };
  all('fin').forEach(e => {
    const a = +e.amount || 0, d = finDate(e), acct = e.acct || (e.kind !== 'transfer' && e.date && e.date.slice(0, 7) >= start ? dflt : null);
    if (e.kind === 'income') push(d, acct, a, 'inc', e);
    else if (e.kind === 'expense') push(d, acct, -a, 'exp', e);
    else if (e.kind === 'transfer') { push(d, e.acct, -a, 'out', e); push(d, e.to, a, 'in', e); }
    else if (e.kind === 'lent' || e.kind === 'borrowed') {
      const s = e.kind === 'lent' ? -1 : 1;
      push(d, acct, s * a, 'udh', e);
      (e.pays || []).forEach(p => push(p.date, p.acct || acct, -s * (+p.amt || 0), 'udh', e));
      const pp = (e.pays || []).reduce((t, p) => t + (+p.amt || 0), 0), rest = Math.max(0, (+e.paidAmount || 0) - pp);
      if (rest > 0.005) push(d, acct, -s * rest, 'udh', e);                   // paid back before instalments were recorded
    }
  });
  return out;
}
function udhaarSplit() {
  let owed = 0, owe = 0;
  all('fin').filter(e => isUdhaar(e.kind) && !e.settled).forEach(e => { if (e.kind === 'lent') owed += outstanding(e); else owe += outstanding(e); });
  return { owed, owe };
}
const bucketOf = k => k === 'cash' ? 'cash' : isInvest(k) ? 'invest' : k === 'card' ? 'card' : k === 'loan' ? 'loan' : 'bank';
/* Balances at the end of a given day. Up to today: opening + Ledger only. A future date: the plan for that month. */
function balancesOn(c, dateISO) {
  const cur = isoMonth(new Date()), ym = dateISO.slice(0, 7), list = accts(true);
  let bal = {}, mode = 'actual', label, udhBack = 0;
  if (ym < c.startMonth) {
    list.forEach(a => { bal[a.id] = a.kind === 'loan' ? -(loanSched(a) ? loanOwed(a, monthAdd(c.startMonth, -1)) : +a.open || 0) : isLiab(a.kind) ? -(+a.open || 0) : +a.open || 0; });
    mode = 'opening'; label = 'opening balances, as on ' + fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true);
  } else if (ym > cur) {
    const pr = planCompute(c, ym).slice(-1)[0]; bal = { ...pr.accts }; udhBack = pr.udhBack || 0; mode = 'plan'; label = 'plan for end of ' + monthLong(ym);
  } else if (ym < cur && dateISO >= monthEnd(ym)) {
    bal = { ...planCompute(c, ym, 'actual').slice(-1)[0].accts };      // a whole month that is over: same figures as the check-up
    label = 'actual, as on ' + fmtDate(monthEnd(ym), true);
  } else {
    const endRow = planCompute(c, ym, 'actual').slice(-1)[0];
    if (ym === c.startMonth) list.forEach(a => { bal[a.id] = isLiab(a.kind) ? -(+a.open || 0) : +a.open || 0; });
    else bal = { ...planCompute(c, monthAdd(ym, -1), 'actual').slice(-1)[0].accts };
    ledgerFlows(c).forEach(f => { const a = acctById(f.acct); if (a && !(a.kind === 'loan' && loanSched(a)) && f.ym === ym && f.date <= dateISO) bal[f.acct] = (bal[f.acct] || 0) + f.amt; });
    list.forEach(a => { if (a.kind === 'loan' && loanSched(a)) bal[a.id] = endRow.accts[a.id]; });   // loans follow their schedule
    label = 'actual, as on ' + fmtDate(dateISO, true);
  }
  const out = { bank: 0, cash: 0, invest: 0, card: 0, loan: 0, mode, label, accts: bal };
  list.forEach(a => { const v = bal[a.id] || 0, b = bucketOf(a.kind);
    if (b === 'card') { if (v > 0) out.bank += v; else out.card += -v; } else if (b === 'loan') out.loan += Math.max(0, -v); else out[b] += v; });
  const U = mode === 'plan' ? udhaarSplit() : udhaarAsOf(dateISO); out.owed = Math.max(0, U.owed - udhBack); out.owe = U.owe;   // a past day uses that day's udhaar
  out.money = out.bank + out.cash + out.invest + out.owed - out.owe - out.card;
  out.hand = out.bank + out.cash - out.card;
  return out;
}
/* Income per source over some months: expected, received, overdue (ended months not received), still to come. */
function incomeSummary(c, months) {
  const cur = isoMonth(new Date()), g = new Map(), matched = new Set(), linked = new Set();
  const get = n => { if (!g.has(n)) g.set(n, { name: n, expected: 0, received: 0, overdue: 0, upcoming: 0 }); return g.get(n); };
  months.forEach(ym => {
    if (ym < c.startMonth) return;
    planItems(c, ym).filter(it => it.kind === 'income' || it.kind === 'udhback').forEach(it => {
      const x = get(it.extra ? 'One-off income' : it.kind === 'udhback' ? it.label + ' (udhaar back)' : it.label); if (it.kind === 'udhback') x.udh = true;
      x.expected += it.a;
      if (it.done) { x.received += it.a; if (it.matched) matched.add(it.matched); if (it.ledgerId) linked.add(it.ledgerId); }
      else if (ym < cur) x.overdue += it.a; else x.upcoming += it.a;
    });
  });
  const set = new Set(months);
  all('fin').filter(e => e.kind === 'income' && set.has((e.date || '').slice(0, 7)) && (e.date || '').slice(0, 7) >= c.startMonth && !e.planRef && !matched.has(e.id))
    .forEach(e => { get(e.category === 'Adjustment' ? 'Balance-check adjustments' : 'Other income (Ledger)').received += +e.amount || 0; });
  return [...g.values()];
}
function cleanZeroTicks() {
  let n = 0;
  all('fin').forEach(e => { if (e.planRef && !(+e.amount)) { softDelete(e.id, { render: false }); n++; } });
  if (n) RLOG.info('removed empty plan entries', n);
}
/* A recurring item that repeats a loan's EMI would count the EMI twice. */
function dupEmiOf(r) {
  if (!r || !(r.kind === 'expense' || r.kind === 'transfer')) return null;
  return accts().find(a => a.kind === 'loan' && +a.emi && Math.abs(+a.emi - (+r.amt || 0)) < 1 && (a.payFrom === r.from || !a.payFrom)
    && (r.kind === 'expense' || r.to === a.id)) || null;
}
/* Amount of a recurring item in a month: the base amount, or the latest "changes from" step on or before it. */
function recurAmt(r, ym) {
  let a = +r.amt || 0;
  (r.steps || []).slice().sort((x, y) => x.month < y.month ? -1 : 1).forEach(s => { if (ym >= s.month) a = +s.a || 0; });
  return a;
}
function recurStepsText(r) {
  return (r.steps || []).slice().sort((x, y) => x.month < y.month ? -1 : 1).map(s => rs(s.a) + ' from ' + monthShort(s.month)).join(', ');
}
/* ---------- udhaar received back in instalments (recurring kind 'udhback') ---------- */
const udhOpenLent = who => all('fin').filter(e => e.kind === 'lent' && !e.settled && outstanding(e) > 0 && (e.who || '').trim().toLowerCase() === (who || '').trim().toLowerCase())
  .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
const udhOwedBy = who => udhOpenLent(who).reduce((s, e) => s + outstanding(e), 0);
function udhPersons() {
  const m = new Map();
  all('fin').filter(e => e.kind === 'lent' && !e.settled && outstanding(e) > 0 && (e.who || '').trim()).forEach(e => { const k = e.who.trim(); m.set(k, (m.get(k) || 0) + outstanding(e)); });
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
/* Undo the instalment payments written for one plan tick. */
function removeUdhPays(ref) {
  all('fin').filter(e => (e.pays || []).some(p => p.planRef === ref)).forEach(e => {
    const back = e.pays.filter(p => p.planRef === ref).reduce((s, p) => s + (+p.amt || 0), 0);
    e.pays = e.pays.filter(p => p.planRef !== ref);
    e.paidAmount = Math.max(0, +(((e.paidAmount || 0) - back).toFixed(2)));
    e.settled = e.paidAmount >= (+e.amount || 0) - 0.005;
    put(e, { render: false });
  });
}
/* Record an instalment as money paid back against the person's oldest open udhaar entries. */
function applyUdhPays(ref, who, acct, amt, date) {
  removeUdhPays(ref);
  const owed = udhOwedBy(who);
  if (amt > owed + 0.005) throw new Error(`${who} owes only ${rs(owed)} in Udhaar, not ${rs(amt)}.`);
  let left = amt;
  udhOpenLent(who).forEach(e => {
    if (left <= 0.005) return;
    const take = Math.min(left, outstanding(e));
    e.pays = (e.pays || []).concat([{ date, amt: +take.toFixed(2), acct, planRef: ref }]);
    e.paidAmount = +(((e.paidAmount || 0) + take).toFixed(2));
    e.settled = e.paidAmount >= (+e.amount || 0) - 0.005;
    left -= take; put(e, { render: false });
  });
}
function udhaarNet() {
  return all('fin').filter(e => isUdhaar(e.kind) && !e.settled).reduce((s, e) => s + (e.kind === 'lent' ? 1 : -1) * outstanding(e), 0);
}

/* ---------- planned items of a month ---------- */
function planItems(c, ym) {
  const pm = pmGet(ym), items = [];
  recurs().forEach(r => { if (recurDue(r, ym)) items.push({ key: 'r:' + r.id, label: r.name, kind: r.kind, who: r.who || '', a: recurAmt(r, ym), from: r.kind === 'udhback' ? null : r.from, to: r.to, budget: !!r.budget && r.kind === 'expense', cat: r.cat || '' }); });
  accts(true).forEach(a => {
    if (a.archived && a.kind !== 'loan') return;                        // archived funds: no SIP; a loan keeps its EMIs until its last month
    if (isInvest(a.kind) && a.sip && +a.sip.amt && a.sip.start && ym >= a.sip.start && (!a.sip.end || ym <= a.sip.end))
      items.push({ key: 'sip:' + a.id, label: 'SIP · ' + a.name, kind: 'transfer', a: +a.sip.amt, from: a.sip.from, to: a.id });
    if (a.kind === 'loan' && +a.emi && a.start && ym >= a.start && (!a.end || ym <= a.end))
      items.push({ key: 'emi:' + a.id, label: 'EMI · ' + a.name, kind: 'transfer', a: +a.emi, from: a.payFrom, to: a.id });
  });
  (pm ? pm.extra || [] : []).forEach(x => items.push({ key: 'x:' + x.id, label: x.label || 'One-off', kind: x.kind, a: +x.a || 0, from: x.from, to: x.to, extra: true, cat: x.cat || '' }));
  items.forEach(it => { const o = pm && pm.items && pm.items[it.key]; if (o) { if (!isBlank(o.a)) it.a = +o.a; it.done = !!o.done; it.ledgerId = o.ledgerId || null; it.changed = !isBlank(o.a); } });
  (pm ? pm.extra || [] : []).forEach(x => { const it = items.find(i => i.key === 'x:' + x.id); if (it && x.done) { it.done = true; it.ledgerId = x.ledgerId; } });
  items.forEach(it => {
    if (!it.done) return;
    if (it.kind === 'udhback') {
      const ref = ym + '|' + it.key, paid = all('fin').reduce((s, e) => s + (e.pays || []).filter(p => p.planRef === ref).reduce((t, p) => t + (+p.amt || 0), 0), 0);
      if (paid > 0) it.a = paid; else { it.done = false; it.ledgerId = null; it.lost = true; }
      return;
    }
    const L = it.ledgerId && records[it.ledgerId];
    if (L && !L.deleted) it.a = +L.amount || 0;             // what is really in the Ledger
    else { it.done = false; it.ledgerId = null; it.lost = true; }   // its Ledger entry was deleted: planned again
  });
  // an entry you typed into the Ledger yourself (same month, type, account and amount) counts as done
  const used = new Set(), dflt = (acctById(c.defAcct) || {}).id || defAcct(c), ac = e => e.acct || (e.kind !== 'transfer' ? dflt : null);   // untagged entries sit on the default account
  const mine = all('fin').filter(e => !e.planRef && (e.date || '').slice(0, 7) === ym && ac(e));                     // later dates this month count too — they are already in the balances
  items.forEach(it => {
    if (it.done || it.kind !== 'udhback' || !it.a) return;
    const hit = all('fin').some(e => e.kind === 'lent' && (e.who || '').trim().toLowerCase() === it.who.trim().toLowerCase() &&
      (e.pays || []).some(p => !p.planRef && (p.date || '').slice(0, 7) === ym && Math.abs((+p.amt || 0) - it.a) < 1));
    if (hit) { it.done = true; it.matched = 'udh'; }
  });
  items.forEach(it => {
    if (it.done || it.budget || !it.a || it.kind === 'udhback') return;
    const m = mine.find(e => !used.has(e.id) && Math.abs((+e.amount || 0) - it.a) < 1 && (e.kind === it.kind &&
      (it.kind === 'income' ? ac(e) === it.to : it.kind === 'expense' ? ac(e) === it.from : e.acct === it.from && e.to === it.to)
      || it.kind === 'transfer' && e.kind === 'expense' && e.category === 'Investment' && ac(e) === it.from && isInvest((acctById(it.to) || {}).kind)));   // a SIP typed in as "Investment" spending
    if (m) { used.add(m.id); it.done = true; it.matched = m.id; }
  });
  return items;
}

/* ---------- the engine ----------
   mode 'plan'   : Ledger so far + everything planned that is not ticked
   mode 'actual' : Ledger only (and statement values), up to today        */
function planCompute(c, toMonth, mode) {
  const actual = mode === 'actual', cur = isoMonth(new Date());
  if (actual && toMonth > cur) toMonth = cur;
  const list = accts(true), bal = {}, udh = udhaarNet();
  list.forEach(a => { bal[a.id] = a.kind === 'loan' && loanSched(a) ? -loanOwed(a, monthAdd(c.startMonth, -1)) : isLiab(a.kind) ? -(+a.open || 0) : (+a.open || 0); });
  const flows = ledgerFlows(c), byYm = {};
  flows.forEach(f => { (byYm[f.ym] = byYm[f.ym] || []).push(f); });
  const rows = [], udhLeft = new Map(); let udhBack = 0;
  for (let ym = c.startMonth, i = 0; ym <= toMonth && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) {
    let inc = 0, exp = 0, invIn = 0, interest = 0, growth = 0, pending = 0, planned = false;
    const items = planItems(c, ym), fl = byYm[ym] || [];
    // actual movements
    fl.forEach(f => {
      const a = acctById(f.acct); if (!a) return;
      if (a.kind === 'loan' && loanSched(a)) return;                        // a scheduled loan follows its schedule
      bal[f.acct] += f.amt;
      if (f.cat === 'inc') inc += f.amt;
      else if (f.cat === 'exp') { if (f.e && f.e.category === 'Investment') invIn -= f.amt; else exp -= f.amt; }   // same split as the PDF report
      else if (f.cat === 'in' && isInvest(a.kind)) invIn += f.amt;
      else if (f.cat === 'out' && isInvest(a.kind)) invIn += f.amt;          // negative: money taken out
    });
    // planned movements not yet ticked
    const matchedIds = new Set(items.filter(i => i.matched).map(i => i.matched));
    const ledgerSpend = fl.filter(f => f.cat === 'exp' && !(f.e && (f.e.planRef || matchedIds.has(f.e.id) || f.e.category === 'Investment'))).reduce((s, f) => s - f.amt, 0);
    let spendLeft = Math.max(0, ledgerSpend);                                 // shared by all spending estimates, not taken off each one
    if (!actual) items.forEach(it => {
      if (it.done) return;
      let amt = it.a;
      if (it.budget) { if (ym < cur) return; const use = ym === cur ? Math.min(spendLeft, it.a) : 0; spendLeft -= use; amt = it.a - use; }
      if (!amt) return;
      if (!it.budget && ym < cur) pending++;
      planned = true;
      const F = acctById(it.from), T = acctById(it.to);
      if (it.kind === 'udhback') {
        const k = it.who.trim().toLowerCase(); if (!udhLeft.has(k)) udhLeft.set(k, udhOwedBy(it.who));
        amt = Math.min(amt, udhLeft.get(k)); if (amt <= 0) return;
        udhLeft.set(k, udhLeft.get(k) - amt); udhBack += amt;
        if (T && !(T.kind === 'loan' && loanSched(T))) bal[T.id] += amt;
        return;
      }
      const free = x => x && !(x.kind === 'loan' && loanSched(x));
      if (it.kind === 'income') { if (free(T)) bal[T.id] += amt; inc += amt; }
      else if (it.kind === 'expense') { if (free(F)) bal[F.id] -= amt; exp += amt; }
      else {
        if (free(F)) bal[F.id] -= amt;
        if (free(T)) bal[T.id] += amt;
        if (T && isInvest(T.kind)) invIn += amt;
        if (F && isInvest(F.kind)) invIn -= amt;
      }
    });
    // growth, statement values, loans
    list.forEach(a => {
      if (isInvest(a.kind)) {
        const before = bal[a.id];
        if (!actual && +a.ret && !a.archived && ym >= cur) { const g = before * (+a.ret) / 1200; bal[a.id] += g; growth += g; }   // estimate only for months not yet over
        const v = (a.values || []).find(x => x.month === ym);
        if (v && isFinite(+v.a)) { growth += +v.a - bal[a.id]; bal[a.id] = +v.a; }
      } else if (a.kind === 'loan' && loanSched(a)) {
        const owedBefore = loanOwed(a, monthAdd(ym, -1));
        const k = loanInfo(a, ym);
        if (k.r && ym >= a.start && ym <= a.end) interest += owedBefore * k.r;
        bal[a.id] = -loanOwed(a, ym);
      }                                                                     // other loans: opening − what you paid into them
    });
    let assets = 0, liabs = 0, cardDue = 0, loanBal = 0, liquid = 0, invest = 0, cardPos = 0; const neg = [];
    list.forEach(a => {
      const v = bal[a.id];
      if (isLiab(a.kind)) { if (v > 0) { assets += v; if (a.kind === 'card') cardPos += v; } else { liabs += -v; if (a.kind === 'loan') loanBal += -v; else cardDue += -v; } } else assets += v;
      if (isLiquid(a.kind)) { liquid += v; if (v < -0.5 && !a.archived) neg.push(a.id); }
      if (isInvest(a.kind)) invest += v;
    });
    exp += interest;
    const pm = pmGet(ym);
    rows.push({ ym, inc, exp, interest, invIn, growth, net: inc - exp, accts: { ...bal }, assets, liabs, cardDue, loanBal, liquid, invest, udh: udh - udhBack, udhBack,
      worth: assets - cardDue + udh - udhBack, hand: liquid + cardPos - cardDue, afterLoans: assets - cardDue + udh - udhBack - loanBal,
      pending, planned, closed: !!(pm && pm.closed), neg, ended: ym < cur, cur: ym === cur });
  }
  return rows;
}
function planYears(rows, mode) {
  const by = new Map();
  rows.forEach(r => {
    const k = yearKey(r.ym, mode);
    if (!by.has(k)) by.set(k, { k, label: yearLabel(k, mode), inc: 0, exp: 0, invIn: 0, months: 0, closed: 0, ended: 0, pending: 0, last: null, planned: false, neg: false });
    const y = by.get(k);
    y.inc += r.inc; y.exp += r.exp; y.invIn += r.invIn; y.months++; y.last = r; y.planned = y.planned || r.planned; y.neg = y.neg || r.neg.length > 0;
    if (r.ended) { y.ended++; if (r.closed) y.closed++; } y.pending += r.pending;
  });
  return [...by.values()];
}
function planAutoEnd(c) {
  const cur = isoMonth(new Date());
  let end = monthAdd(cur > c.startMonth ? cur : c.startMonth, 11);
  const bump = ym => { if (ym && ym > end) end = ym; };
  recurs().forEach(r => bump(r.end)); accts().forEach(a => { bump(a.end); if (a.sip) bump(a.sip.end); });
  all('goal').forEach(g => bump(g.by));
  Object.values(records).forEach(r => { if (r.type === 'planmonth' && !r.deleted && ((r.extra || []).length || Object.keys(r.items || {}).length)) bump(r.month); });
  const mode = c.yearMode || 'fy', k = yearKey(end, mode);
  bump(mode === 'fy' ? (k + 1) + '-03' : k + '-12');
  const cap = monthAdd(c.startMonth, PLAN_MAX_MONTHS - 1);
  return end > cap ? cap : end;
}
function planHorizon(c) {
  if (c.showUntil && /^\d{4}-\d{2}$/.test(c.showUntil)) return c.showUntil < c.startMonth ? monthAdd(c.startMonth, 11) : c.showUntil;
  return planAutoEnd(c);
}
function planPendingMonths() {
  const c = planCfg(); if (!c || !Fin.key || !accts().length) return [];
  const cur = isoMonth(new Date()), out = [];
  for (let ym = c.startMonth, i = 0; ym < cur && i < PLAN_MAX_MONTHS; ym = monthAdd(ym, 1), i++) {
    const pm = pmGet(ym);
    if (pm && pm.closed) continue;
    if (planItems(c, ym).some(it => !it.done && !it.budget && it.a)) out.push(ym);
  }
  return out;
}
function planBadge() {
  const n = planPendingMonths().length;
  ['plan', 'accts'].forEach(v => { const b = document.querySelector(`#moneySeg [data-v="${v}"]`); if (!b) return;
    const lbl = v === 'plan' ? 'Plan' : 'Accounts';
    b.innerHTML = lbl + (n && v === 'accts' ? ` <span class="seg-badge" aria-label="${n} months need a check-up">${n}</span>` : ''); });
}

/* ---------- move plans made in v2.2 / v2.3 onto accounts ---------- */
function migratePlanV3() {
  const c = planCfg(); if (!c || c.v >= 3 || !Fin.key) return false;
  const cur = isoMonth(new Date()), map = {};
  const kindOf = { a1: 'salary', a2: 'salary', a3: 'bank', a4: 'cash' };
  (c.accounts && c.accounts.length ? c.accounts : [{ id: 'a3', name: 'Bank account' }]).forEach((a, i) => {
    const id = 'acc-' + a.id; map[a.id] = id;
    put({ id, type: 'acct', name: a.name, kind: kindOf[a.id] || 'bank', open: +((c.open || {})[a.id] || (a.id === 'a3' && !c.open ? c.openingCash : 0)) || 0, order: i, deleted: false }, { render: false });
  });
  const def = map[c.defAcct] || map.a3 || Object.values(map)[0];
  if (+(c.open || {}).mf) put({ id: 'acc-mf', type: 'acct', name: 'Mutual funds', kind: 'mf', open: +c.open.mf, ret: +c.mfRet || 0, deleted: false }, { render: false });
  if (+(c.open || {}).udh) put({ id: 'acc-udh', type: 'acct', name: 'Udhaar (opening figure)', kind: 'other', open: +c.open.udh, deleted: false }, { render: false });
  const extraAdd = {};
  const addExtra = (ym, x) => { (extraAdd[ym] = extraAdd[ym] || []).push({ id: uid('x'), ...x }); };
  all('invest').forEach(v => {
    const id = 'acc-' + v.id;
    put({ id, type: 'acct', name: v.name, kind: 'mf', open: 0, ret: +v.ret || 0, values: v.values || [], sip: +v.monthly ? { amt: +v.monthly, from: map[v.acct] || def, start: v.start, end: v.end || null } : null, deleted: false }, { render: false });
    (v.lumps || []).forEach(x => addExtra(x.month, { kind: 'transfer', label: 'Lump sum · ' + v.name, a: +x.a, from: map[v.acct] || def, to: id }));
    (v.redeems || []).forEach(x => addExtra(x.month, { kind: 'transfer', label: 'Redeem · ' + v.name, a: +x.a, from: id, to: map[v.acct] || def }));
    softDelete(v.id, { render: false });
  });
  all('loan').forEach(l => {
    put({ id: 'acc-' + l.id, type: 'acct', name: l.name, kind: 'loan', emi: +l.emi || 0, amount: +l.amount || 0, start: l.start, end: l.end, payFrom: map[l.acct] || def, open: 0, deleted: false }, { render: false });
    softDelete(l.id, { render: false });
  });
  // income sources and planned spending become recurring items; month-by-month differences stay as changes
  const months = Object.values(records).filter(r => r.type === 'planmonth' && !r.deleted && r.v !== 3).sort((a, b) => a.month.localeCompare(b.month));
  const mode = vals => { const f = {}; vals.forEach(v => { f[v] = (f[v] || 0) + 1; }); return +Object.keys(f).sort((a, b) => f[b] - f[a])[0]; };
  const srcRec = {};
  (c.sources || []).filter(s => s.active !== false).forEach(s => {
    const vals = months.map(m => m.inc && m.inc[s.id] && m.inc[s.id].a).filter(v => !isBlank(v));
    const id = uid('rc'); srcRec[s.id] = { id, amt: vals.length ? mode(vals) : 0 };
    put({ id, type: 'recur', name: s.name, kind: 'income', amt: srcRec[s.id].amt, to: map[s.acct] || def, start: c.startMonth, end: null, every: 1, deleted: false }, { render: false });
  });
  const exps = months.map(m => m.expPlan).filter(v => !isBlank(v));
  let hh = null;
  if (exps.length) { hh = { id: uid('rc'), amt: mode(exps) }; put({ id: hh.id, type: 'recur', name: 'Household spending', kind: 'expense', budget: true, amt: hh.amt, from: def, start: c.startMonth, end: null, every: 1, deleted: false }, { render: false }); }
  const tick = (ym, kind, amt, acct, label, planRef) => put({ id: uid('f'), type: 'fin', desc: label, amount: amt, kind, category: kind === 'income' ? 'Salary' : '', acct,
    date: ym === cur ? todayISO() : monthEnd(ym), planRef, who: '', recurring: false, paidAmount: 0, settled: false, deleted: false }, { render: false }).id;
  months.forEach(m => {
    const nm = pmNew(m.month);
    Object.entries(m.inc || {}).forEach(([sid, x]) => {
      const r = srcRec[sid]; if (!r || isBlank(x.a)) return;
      const key = 'r:' + r.id, o = {};
      if (+x.a !== r.amt) o.a = +x.a;
      if (x.act && +x.a && m.month <= cur) { o.done = true; o.ledgerId = tick(m.month, 'income', +x.a, map[(c.sources.find(s => s.id === sid) || {}).acct] || def, (c.sources.find(s => s.id === sid) || {}).name || 'Income', m.month + '|' + key); }
      if (Object.keys(o).length) nm.items[key] = o;
    });
    // months that had no figure for a source: skip the recurring item there
    (c.sources || []).forEach(s => { const r = srcRec[s.id]; if (r && !(m.inc && m.inc[s.id] && !isBlank(m.inc[s.id].a))) nm.items['r:' + r.id] = { a: 0 }; });
    if (hh) { if (isBlank(m.expPlan)) nm.items['r:' + hh.id] = { a: 0 }; else if (+m.expPlan !== hh.amt) nm.items['r:' + hh.id] = { a: +m.expPlan }; }
    (m.extraInc || []).forEach(x => { const e = { id: uid('x'), kind: 'income', label: x.label, a: +x.a, to: def }; if (x.act && +x.a && m.month <= cur) { e.done = true; e.ledgerId = tick(m.month, 'income', +x.a, def, x.label, m.month + '|x:' + e.id); } nm.extra.push(e); });
    (m.extraExp || []).forEach(x => nm.extra.push({ id: uid('x'), kind: 'expense', label: x.label, a: +x.a, from: def }));
    (extraAdd[m.month] || []).forEach(x => nm.extra.push(x)); delete extraAdd[m.month];
    put(nm, { render: false });
  });
  Object.entries(extraAdd).forEach(([ym, list]) => { const nm = pmGet(ym) || pmNew(ym); nm.extra = (nm.extra || []).concat(list); put(nm, { render: false }); });
  Object.assign(c, { v: 3, defAcct: def });
  put(c, { render: false });
  RLOG.info('plan moved to accounts (v3)');
  toast('Your plan was moved onto accounts. Check Money → Accounts.', null, null, 6000);
  return true;
}

/* ==========================================================================
   ACCOUNTS TAB
   ======================================================================== */
function lsFlag(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
function lsSetFlag(k) { try { localStorage.setItem(k, '1'); } catch (e) {} }
function renderAccts() {
  const body = $('acctBody'); if (!body) return;
  let c = planCfg();
  if (c && c.v !== 3) { migratePlanV3(); c = planCfg(); }
  if (c) cleanZeroTicks();
  planBadge();
  if (!c) {
    const start0 = isoMonth(new Date());
    body.innerHTML = `<div class="group plan-card"><h3 class="plan-h">Set up your accounts</h3>
      <p class="hint" style="margin:0 0 12px">Pick the month you want to start from. You'll then enter what each account held on the last day of the month before it.</p>
      <div class="field"><label>Start from</label><input type="month" id="psStart" value="${start0}"></div>
      <p class="hint" id="psAsOn" style="margin:-6px 4px 12px">Opening balances will be as on ${fmtDate(monthEnd(monthAdd(start0, -1)), true)}.</p>
      <button class="btn brass block" id="psGo">Continue</button></div>`;
    $('psStart').addEventListener('change', () => { const v = $('psStart').value; if (/^\d{4}-\d{2}$/.test(v)) $('psAsOn').textContent = 'Opening balances will be as on ' + fmtDate(monthEnd(monthAdd(v, -1)), true) + '.'; });
    $('psGo').addEventListener('click', () => {
      const start = $('psStart').value; if (!/^\d{4}-\d{2}$/.test(start)) { toast('Pick a month.'); return; }
      put({ id: PLAN_CFG_ID, type: 'plancfg', v: 3, startMonth: start, yearMode: 'fy', showUntil: null, defAcct: null, deleted: false }, { render: false });
      [['My salary account', 'salary'], ["Wife's salary account", 'salary'], ['Bank account', 'bank'], ['Cash in hand', 'cash']].forEach(([n, k], i) =>
        put({ id: uid('ac'), type: 'acct', name: n, kind: k, open: 0, order: i, deleted: false }, { render: false }));
      const c2 = planCfg(); c2.defAcct = accts().find(a => a.kind === 'bank').id; put(c2, { render: false });
      openingSheet();
    });
    return;
  }
  const cur = isoMonth(new Date()), asOn = fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true);
  const now = cur >= c.startMonth, B = balancesOn(c, todayISO());       // same figures as the Ledger dashboard
  const endYm = planHorizon(c), proj = planCompute(c, endYm), endRow = proj[proj.length - 1];
  const nowBal = id => B.accts[id] || 0;
  const firstNeg = id => { const r = proj.find(x => x.neg.includes(id)); return r ? r.ym : null; };
  const U = { owed: B.owed, owe: B.owe }, cardNow = B.card, loanNow = B.loan, liqNow = B.bank + B.cash, investNow = B.invest;
  const worthNow = B.money, handNow = B.hand;
  const heroWhen = now ? 'as on ' + fmtDate(todayISO(), true) : 'opening, as on ' + asOn;
  const guide = !lsFlag('r2_acctGuideHidden') ? `<div class="group plan-card acct-guide"><div class="plan-hero-top" style="justify-content:space-between"><b>How this works</b><button class="linkbtn" id="acGuideHide">Hide</button></div>
      <ol><li><b>Opening balances</b> — once. What each account held on ${asOn}.</li>
      <li><b>Recurring</b> — once. Salary, household spending, transfers, card bill. SIPs and EMIs go inside their fund / loan account.</li>
      <li><b>Monthly check-up</b> — after each month ends: tick what came in and went out, and (optional) compare balances with your bank.</li></ol>
      <p class="hint" style="margin:0">Everyday spending goes in Ledger with + as before.</p></div>` : '';
  const pend = planPendingMonths();
  const sortMode = prefs.acctSort || 'order', sortLbl = { order: 'My order', amount: 'Amount ↓', az: 'A → Z' };
  const sorted = l => sortMode === 'amount' ? l.slice().sort((x, y) => Math.abs(nowBal(y.id)) - Math.abs(nowBal(x.id))) : sortMode === 'az' ? l.slice().sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })) : l;
  const groups = [['Bank, cash and wallets', a => isLiquid(a.kind)], ['Investments', a => isInvest(a.kind)], ['Credit cards and loans', a => isLiab(a.kind)]];
  const row = a => {
    const b = nowBal(a.id), neg = isLiquid(a.kind) ? firstNeg(a.id) : null;
    let sub = `<span>${kindLabel(a.kind)}</span>`;
    if (a.kind === 'loan' && +a.emi) { const k = loanInfo(a); sub += `<span>${rs(a.emi)}/month</span>${k.n ? `<span>${k.paid}/${k.n} EMIs paid</span>` : ''}<span>from ${esc(acctName(a.payFrom))}</span>`; }
    if (isInvest(a.kind) && a.sip && +a.sip.amt) sub += `<span>SIP ${rs(a.sip.amt)} from ${esc(acctName(a.sip.from))}</span>`;
    if (isInvest(a.kind) && +a.ret) sub += `<span>${a.ret}% expected</span>`;
    if (neg) sub += `<span class="st st-late">below ₹0 in ${monthShort(neg)}</span>`;
    return `<button class="row plan-li" data-acct="${a.id}"><div class="row-main"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${sub}</div></div>
      <div class="row-end" style="text-align:right"><span class="amt ${b < 0 ? 'neg' : ''}">${rs(b)}</span><div class="hint" style="margin:2px 0 0">${monthShort(endYm)}: ${rsShort(endRow.accts[a.id] || 0)}</div></div></button>`;
  };
  const archived = accts(true).filter(a => a.archived);
  body.innerHTML = `
    ${guide}
    ${pend.length ? `<button class="plan-banner" id="acPend"><b>${pend.length} month${pend.length > 1 ? 's need' : ' needs'} a check-up.</b> Start with ${monthLong(pend[0])}.</button>` : ''}
    <div class="group plan-card plan-hero"><div class="eyebrow">Money you have · ${heroWhen}</div>
      <div class="plan-big ${worthNow < 0 ? 'neg' : ''}">${rsShort(worthNow)}</div>
      <div class="plan-split"><span>Bank & cash <b>${rsShort(liqNow)}</b></span><span>Investments <b>${rsShort(investNow)}</b></span>${U.owed ? `<span>Others owe you <b>+${rsShort(U.owed)}</b></span>` : ''}${U.owe ? `<span>You owe others <b>−${rsShort(U.owe)}</b></span>` : ''}${cardNow ? `<span>Card dues <b>−${rsShort(cardNow)}</b></span>` : ''}</div>
      <div class="dash-sep"></div>
      <div class="eyebrow">Money in hand</div>
      <div class="plan-big ${handNow < 0 ? 'neg' : ''}" style="font-size:1.5rem">${rsShort(handNow)}</div>
      <div class="plan-split"><span>Bank & cash <b>${rsShort(liqNow)}</b></span>${cardNow ? `<span>Card dues <b>−${rsShort(cardNow)}</b></span>` : ''}${loanNow ? `<span>Loan balance (separate) <b>${rsShort(loanNow)}</b></span>` : ''}</div>
</div>
    <div class="btn-row" style="flex-wrap:wrap;margin:0 0 12px"><button class="btn ghost small" id="acOpen">Opening balances</button><button class="btn ghost small" id="acClose">Monthly check-up</button><button class="btn ghost small" id="acXlsx">Export Excel</button></div>
    <div class="acct-sortbar"><span class="hint" style="margin:0">Sort</span><button class="chip" id="acSort" aria-label="Change sort order">${sortLbl[sortMode]}</button></div>
    ${groups.map(([t, f]) => { const l = sorted(accts().filter(f)); return l.length ? `<div class="plan-sec" style="margin-top:10px"><h3 class="plan-h">${t}</h3><div class="group">${l.map(row).join('')}</div></div>` : ''; }).join('')}
    <button class="btn ghost small" id="acAdd">＋ Add account</button>
    ${archived.length ? `<details class="fold"><summary>Archived accounts (${archived.length})</summary><div class="group">${archived.map(row).join('')}</div></details>` : ''}
    <div class="plan-sec"><h3 class="plan-h">Recurring</h3>
      ${recurs().length ? `<div class="group">${recurs().map(r => `<button class="row plan-li" data-recur="${r.id}"><div class="row-main"><div class="row-title">${esc(r.name)}${r.budget ? ' <span class="pill">estimate</span>' : ''}</div>
        <div class="row-sub">${dupEmiOf(r) ? `<span class="st st-late">same as ${esc(dupEmiOf(r).name)} EMI — counted twice</span>` : ''}<span>${r.kind === 'udhback' ? 'udhaar back from ' + esc(r.who || '?') + ' into ' + esc(acctName(r.to)) + ' · ' + esc(rs(udhOwedBy(r.who))) + ' still owed' : r.kind === 'income' ? 'into ' + esc(acctName(r.to)) : r.kind === 'expense' ? 'from ' + esc(acctName(r.from)) : esc(acctName(r.from)) + ' → ' + esc(acctName(r.to))}</span>
        <span>${['', 'monthly', '', 'every 3 months', '', '', 'every 6 months', '', '', '', '', '', 'yearly'][+r.every || 1] || 'every ' + r.every + ' months'}</span><span>${monthShort(r.start)}${r.end ? ' – ' + monthShort(r.end) : ' onwards'}</span>${(r.steps || []).length ? `<span>then ${esc(recurStepsText(r))}</span>` : ''}</div></div>
        <span class="amt ${r.kind === 'income' || r.kind === 'udhback' ? 'pos' : r.kind === 'expense' ? 'neg' : ''}">${rs(recurAmt(r, cur < r.start ? r.start : cur))}</span></button>`).join('')}</div>` : '<p class="hint" style="margin:0 4px 8px">Nothing yet. Add salary, rent, household spending, monthly transfers or the credit-card bill.</p>'}
      <button class="btn ghost small" id="acRecAdd">＋ Add recurring item</button>
      <p class="hint">SIPs and EMIs are set inside their mutual fund and loan accounts. "Estimate" items (like household spending) are replaced by what you actually spend in the Ledger.</p></div>`;
  if ($('acPend')) $('acPend').addEventListener('click', () => planMonthSheet(pend[0]));
  $('acSort').addEventListener('click', () => { const o = ['order', 'amount', 'az']; setPref('acctSort', o[(o.indexOf(sortMode) + 1) % 3]); renderAccts(); });
  if ($('acGuideHide')) $('acGuideHide').addEventListener('click', () => { lsSetFlag('r2_acctGuideHidden'); renderAccts(); });
  $('acOpen').addEventListener('click', openingSheet);
  $('acClose').addEventListener('click', () => planMonthSheet(pend[0] || (monthAdd(cur, -1) < c.startMonth ? c.startMonth : monthAdd(cur, -1))));
  $('acXlsx').addEventListener('click', exportXlsx);
  $('acAdd').addEventListener('click', () => acctSheet(null));
  $('acRecAdd').addEventListener('click', () => recurSheet(null));
  $$('[data-acct]', body).forEach(b => b.addEventListener('click', () => acctSheet(b.dataset.acct)));
  $$('[data-recur]', body).forEach(b => b.addEventListener('click', () => recurSheet(b.dataset.recur)));
}

/* ---------- one reusable sheet ---------- */
function planSheet(title, html, onSave, saveLabel) {
  $('pshTitle').textContent = title;
  $('pshSave').textContent = saveLabel || 'Save';
  $('pshBody').innerHTML = html + '<div class="msg" id="pshMsg"></div>';
  Plan.save = onSave;
  if (!Sheets.isOpen('shPlan')) Sheets.open('shPlan');
  $('pshBody').scrollTop = 0;
}
const planMsg = (t, err) => { const m = $('pshMsg'); if (m) { m.className = 'msg ' + (err ? 'err' : 'ok'); m.textContent = t; } };
$('pshSave').addEventListener('click', () => { if (Plan.save && Plan.save() !== false) { Plan.save = null; Sheets.close('shPlan', true); scheduleRender(); } });
Sheets.onClose.shPlan = () => { Plan.save = null; };
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
  const html = `<div class="field"><label>Name</label><input id="asName" value="${esc(a.name)}" placeholder="e.g. HDFC savings"></div>
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
        rec.ret = ret; rec.sip = sipAmt ? { amt: sipAmt, from: $('asSipFrom').value, start: sipStart, end: sipEnd } : null;
        rec.values = readMonthRows('asVals');
      }
      if (kind === 'loan') {
        const emi = readAmt('asEmi', 'EMI') || 0, start = $('asStart').value, end = $('asEnd').value;
        if (emi && (!ymOk(start) || !ymOk(end))) throw new Error('Pick the first and last EMI months.');
        if (emi && end < start) throw new Error('Last EMI is before the first.');
        Object.assign(rec, { emi, amount: readAmt('asAmt', 'Loan amount') || 0, rate: readAmt('asRate', 'Interest rate') || 0, start: start || null, end: end || null, payFrom: $('asPay').value });
      }
      if (kind === 'card') {                                   // v2.19: statement and due days become monthly dates
        const sRaw = $('asStmt').value.trim(), dRaw = $('asDue').value.trim(), sd = clampDay(sRaw), dd = clampDay(dRaw);
        if (sRaw && !sd) throw new Error('Statement day: a day of the month, 1 to 31.');
        if (dRaw && !dd) throw new Error('Payment due day: a day of the month, 1 to 31.');
        rec.stmtDay = sd || null; rec.dueDay = dd || null; rec.remind = $('asRemind').checked;
      } else { delete rec.stmtDay; delete rec.dueDay; }
      if (kind === 'fd') { const m = $('asMat').value; rec.matures = ISO_DATE_RX.test(m) ? m : null; rec.remind = $('asRemind').checked; } else delete rec.matures;
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
        <div class="field"><label>Expected return % a year (optional)</label>${amtIn('asRet', a.ret || '', '0 = no growth shown')}</div>
        <p class="hint" style="margin:-6px 4px 10px">An assumption, shown as an estimate. Market returns vary.</p>
        <h4 class="plan-sub">Value from your statement <small>replaces the estimate from that month</small></h4>
        <div class="group pl-group"><div class="pl-list" id="asVals">${(a.values || []).map(v => monthRow(v)).join('')}</div><button class="linkbtn" id="asValAdd">＋ Add value</button></div>`;
    } else if (k === 'loan') {
      h = `<h4 class="plan-sub">Loan</h4><div class="grid2"><div class="field"><label>EMI ₹</label>${amtIn('asEmi', a.emi)}</div><div class="field"><label>EMI paid from</label><select id="asPay">${acctOptions(a.payFrom || defAcct(c), x => isLiquid(x.kind))}</select></div></div>
        <div class="grid2"><div class="field"><label>First EMI</label>${monthIn('asStart', a.start)}</div><div class="field"><label>Last EMI</label>${monthIn('asEnd', a.end)}</div></div>
        <div class="grid2"><div class="field"><label>Loan amount ₹ (optional)</label>${amtIn('asAmt', a.amount || '')}</div><div class="field"><label>Interest % (optional)</label>${amtIn('asRate', a.rate || '', 'worked out if blank')}</div></div>
        <div class="group pl-group" id="asLoanInfo"></div>
        <p class="hint">With EMI and dates filled, the amount owed follows the loan schedule; the opening figure above is only used if they are blank.</p>`;
    } else if (k === 'card') h = `<p class="hint">Spending on the card adds to what you owe. Paying the bill is a Transfer from your bank to this card (add it under Recurring or in the Ledger).</p>
      <h4 class="plan-sub">Statement and due date</h4>
      <div class="grid2"><div class="field"><label>Statement day</label><input id="asStmt" inputmode="numeric" placeholder="1–31" value="${esc(String(a.stmtDay || ''))}"></div><div class="field"><label>Payment due day</label><input id="asDue" inputmode="numeric" placeholder="1–31" value="${esc(String(a.dueDay || ''))}"></div></div>
      <div class="group"><label class="switch-row"><span>Remind me in Dates<small>“Statement” and “payment due” every month, in Bank &amp; investments. Only the card's name goes into Dates — no amounts.</small></span><input type="checkbox" class="sw" id="asRemind"${a.remind === false ? '' : ' checked'}></label></div>`;
    $('asMore').innerHTML = h;
    if ($('asValAdd')) $('asValAdd').addEventListener('click', () => { $('asVals').insertAdjacentHTML('beforeend', monthRow({})); wireMonthRows('asVals'); });
    if (isInvest(k)) wireMonthRows('asVals');
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
    <div class="field"><label>Name</label><input id="rcName" value="${esc(r.name)}"></div>
    <div class="field"><label>Type</label><div class="seg" id="rcKind" style="margin:0">${[['income', 'Income'], ['expense', 'Expense'], ['transfer', 'Transfer'], ['udhback', 'Udhaar back']].map(([k, l]) => `<button data-k="${k}" class="${r.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field" id="rcWhoW"><label>Who is paying back</label><select id="rcWho">${(() => { const ps = udhPersons(); if (r.who && !ps.some(x => x[0] === r.who)) ps.unshift([r.who, 0]); return ps.length ? ps.map(([n, a]) => `<option value="${esc(n)}"${n === r.who ? ' selected' : ''}>${esc(n)} · owes ${rs(a)}</option>`).join('') : '<option value="">Nobody owes you in Udhaar</option>'; })()}</select>
      <p class="hint" style="margin:4px 0 0">Each instalment you tick in the check-up is recorded as money paid back in Udhaar: the account goes up and what they owe goes down. It is not counted as income.</p></div>
    <div class="grid2"><div class="field"><label>Amount ₹</label>${amtIn('rcAmt', r.amt)}</div><div class="field"><label>How often</label><select id="rcEvery">${[[1, 'Every month'], [2, 'Every 2 months'], [3, 'Every 3 months'], [6, 'Every 6 months'], [12, 'Every year']].map(([v, l]) => `<option value="${v}"${+r.every === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="grid2"><div class="field" id="rcFromW"><label>From account</label><select id="rcFrom">${acctOptions(r.from)}</select></div><div class="field" id="rcToW"><label>Into account</label><select id="rcTo">${acctOptions(r.to)}</select></div></div>
    <div class="grid2"><div class="field"><label>First month</label>${monthIn('rcStart', r.start)}</div><div class="field"><label>Last month (optional)</label>${monthIn('rcEnd', r.end)}</div></div>
    <div class="group" id="rcBudgetW"><label class="switch-row"><span>Estimate only<small>For day-to-day spending: the Ledger replaces it as you spend. Can't be ticked.</small></span><input type="checkbox" class="sw" id="rcBudget"${r.budget ? ' checked' : ''}></label></div>
    <div class="group" id="rcAutoW"><label class="switch-row"><span>Auto-record each month<small>Written into the Ledger by itself on the chosen day, as if you ticked it. Untick it in that month's check-up if it did not happen.</small></span><input type="checkbox" class="sw" id="rcAuto"${r.auto ? ' checked' : ''}></label>
      <div class="set-row" id="rcDayW">On day<input id="rcDay" inputmode="numeric" value="${esc(String(r.day || 1))}" style="width:70px;text-align:right" aria-label="Day of month"></div></div>
    <div class="group" id="rcRemW"><label class="switch-row"><span>Remind me in Dates<small>For premiums, renewals and fees: the next due date goes into Dates (no amount).</small></span><input type="checkbox" class="sw" id="rcRemind"${r.remind ? ' checked' : ''}></label>
      <div class="set-row" id="rcRemDW"><span>Next due date</span><input type="date" id="rcRemDate" value="${esc(r.remindDate || '')}" style="width:auto;margin-left:auto" aria-label="Next due date"></div></div>
    <h4 class="plan-sub">Amount changes from a month onwards</h4>
    <div id="rcSteps">${(r.steps || []).map(monthRow).join('')}</div>
    <button class="btn ghost small" id="rcStepAdd">＋ Add a change (e.g. raise)</button>
    <p class="hint">The amount above is used from the first month. Each change applies from its month until the next change. Example: ₹50,000 from Oct 2026, then ₹55,000 from Apr 2027. To change just one month, open that month instead.</p>
    ${id ? '<button class="btn danger block" id="rcDel" style="margin-top:12px">Delete recurring item</button>' : ''}`;
  planSheet(id ? 'Recurring item' : 'New recurring item', html, () => {
    try {
      const name = $('rcName').value.trim(); if (!name) throw new Error('Give it a name.');
      const kind = $('rcKind').querySelector('.on').dataset.k, start = $('rcStart').value, end = $('rcEnd').value || null;
      if (!ymOk(start)) throw new Error('Pick the first month.'); if (end && end < start) throw new Error('Last month is before the first.');
      const from = $('rcFrom').value, to = $('rcTo').value;
      if (kind === 'transfer' && from === to) throw new Error('From and Into must be different accounts.');
      const rec = id ? records[id] : { id: uid('rc'), type: 'recur', deleted: false };
      const steps = readMonthRows('rcSteps').sort((x, y) => x.month < y.month ? -1 : 1);
      steps.forEach((x, i) => { if (x.month <= start) throw new Error('A change must be after the first month (' + monthShort(start) + ').'); if (end && x.month > end) throw new Error('A change is after the last month.'); if (i && steps[i - 1].month === x.month) throw new Error('Two changes in ' + monthShort(x.month) + '.'); });
      const who = kind === 'udhback' ? $('rcWho').value : '';
      if (kind === 'udhback' && !who) throw new Error('Pick who is paying back. Add the udhaar in the Udhaar tab first.');
      const day = Math.min(28, Math.max(1, parseInt($('rcDay').value, 10) || 1));
      const auto = $('rcAuto').checked && !(kind === 'expense' && $('rcBudget').checked);
      const autoFrom = auto ? (rec_autoFrom(id) || isoMonth(new Date())) : null;
      const remind = $('rcRemind').checked, remindDate = $('rcRemDate').value;
      if (remind && !ISO_DATE_RX.test(remindDate)) throw new Error('Pick the next due date for the reminder.');
      const draft = { remind, remindDate: remind ? remindDate : null, auto, autoFrom, day, who, steps, name, kind, amt: readAmt('rcAmt', 'Amount', true), every: +$('rcEvery').value, start, end, from: kind === 'income' || kind === 'udhback' ? null : from, to: kind === 'expense' ? null : to, budget: kind === 'expense' && $('rcBudget').checked };
      const dup = dupEmiOf(draft);
      if (dup && !Plan.dupOk) { Plan.dupOk = true; throw new Error(`This looks like the EMI already set inside the "${dup.name}" account (${rs(dup.emi)} from ${acctName(dup.payFrom)}). Saving it would count the EMI twice. Tap Save again only if this is a different payment.`); }
      Plan.dupOk = false;
      Object.assign(rec, draft);
      put(rec, { render: false }); sysDate('rd-' + rec.id, recurDateWant(rec), true); toast(rec.remind ? 'Saved — the next due date is in Dates.' : 'Saved.');
      if (rec.auto) setTimeout(() => { const n = autoRecord(); if (n) { toast(`${n} month${n > 1 ? 's' : ''} recorded automatically.`); scheduleRender(); } }, 50);
      return true;
    } catch (e) { planMsg(e.message, true); return false; }
  });
  const sync = () => { const k = $('rcKind').querySelector('.on').dataset.k; $('rcDayW').classList.toggle('hidden', !$('rcAuto').checked); $('rcRemDW').classList.toggle('hidden', !$('rcRemind').checked); $('rcFromW').classList.toggle('hidden', k === 'income' || k === 'udhback'); $('rcWhoW').classList.toggle('hidden', k !== 'udhback'); $('rcToW').classList.toggle('hidden', k === 'expense'); $('rcBudgetW').classList.toggle('hidden', k !== 'expense'); };
  $$('#rcKind button').forEach(b => b.addEventListener('click', () => { $$('#rcKind button').forEach(x => x.classList.toggle('on', x === b)); sync(); }));
  $('rcAuto').addEventListener('change', sync); $('rcRemind').addEventListener('change', sync);
  $$('[data-pre]', $('pshBody')).forEach(b => b.addEventListener('click', () => { const p = presets[+b.dataset.pre][1]; Plan.save = null; recurSheet(null, p); }));
  sync();
  wireMonthRows('rcSteps');
  $('rcStepAdd').addEventListener('click', () => { $('rcSteps').insertAdjacentHTML('beforeend', monthRow({})); wireMonthRows('rcSteps'); });
  if (id) $('rcDel').addEventListener('click', () => { Sheets.close('shPlan', true); deleteWithUndo(id, r.name); });
}

/* ---------- auto-record: recurring items marked "Auto-record" tick themselves on their day ---------- */
const rec_autoFrom = id => { const r = id && records[id]; return r && r.auto ? r.autoFrom || r.start : null; };
function autoRecord() {
  const c = planCfg(); if (!c || !Fin.key) return 0;
  const cur = isoMonth(new Date()), today = todayISO(); let n = 0;
  recurs().filter(r => r.auto && !(r.kind === 'expense' && r.budget)).forEach(r => {
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
  try {
    cleanZeroTicks();
    const go = () => { const n = autoRecord(); if (n) { toast(`${n} recurring entr${n > 1 ? 'ies' : 'y'} recorded automatically.`); scheduleRender(); } };
    if (typeof Sync !== 'undefined' && Sync.on() && navigator.onLine) Sync.run().finally(go); else go();   // sync first, so two devices don't both record
  } catch (e) { RLOG.error('finAfterUnlock', e); }
}

/* ---------- balance check: "What was it?" ---------- */
function udhOpen(kind, who) {
  return all('fin').filter(e => e.kind === kind && !e.settled && outstanding(e) > 0 && (e.who || '').trim().toLowerCase() === (who || '').trim().toLowerCase())
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));
}
function udhPeople(kind) {
  const m = new Map();
  all('fin').filter(e => e.kind === kind && !e.settled && outstanding(e) > 0 && (e.who || '').trim()).forEach(e => { const k = e.who.trim(); m.set(k, (m.get(k) || 0) + outstanding(e)); });
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
    ${opt('open', 'The opening balance was wrong', 'Corrects the opening balance; no income or spending')}
    ${opt('unk', "Don't know", `Recorded as unrecorded ${out ? 'spending' : 'income'} (category Adjustment)`)}
    <div class="btn-row" style="margin-top:8px"><button class="btn small" id="fxOk">Record</button><button class="btn small ghost" id="fxCancel">Cancel</button></div>`;
  const old = $('fixBox'); if (old) old.remove();
  rowEl.insertAdjacentElement('afterend', box);
  const sync = () => { const v = (box.querySelector('input[name=fixWhat]:checked') || {}).value;
    $$('.fix-sub', box).forEach(x => x.classList.toggle('hidden', x.dataset.for !== v));
    const u = $('fxUdh'); $('fxWho').classList.toggle('hidden', !(v === 'udh' && u && (u.value === 'lend' || u.value === 'borrow'))); };
  $$('input[name=fixWhat]', box).forEach(r => r.addEventListener('change', sync)); $('fxUdh').addEventListener('change', sync); sync();
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
  Object.assign(rec, { desc: it.label, amount: amt, kind: it.kind, category: it.kind === 'income' ? (/salary/i.test(it.label) ? 'Salary' : '') : (it.cat || ''),
    acct: it.kind === 'income' ? it.to : it.from, to: it.kind === 'transfer' ? it.to : undefined, date: it.date || (ym === cur ? todayISO() : monthEnd(ym)), planRef: ym + '|' + it.key });
  put(rec, { render: false });
  return rec.id;
}
function planMonthSheet(ym) {
  const c = planCfg(); if (!c) return;
  if (!accts().length) { toast('Add your accounts first (Money → Accounts).'); return; }
  if (ym < c.startMonth) ym = c.startMonth;
  const cur = isoMonth(new Date()), items = planItems(c, ym), pm = pmGet(ym) || pmNew(ym);
  const canTick = ym <= cur;
  const matchedIds = new Set(items.filter(i => i.matched).map(i => i.matched));
  const flows = ledgerFlows(c).filter(f => f.ym === ym && f.cat === 'exp' && !(f.e && (f.e.planRef || matchedIds.has(f.e.id))));
  const spent = flows.reduce((s, f) => s - f.amt, 0);
  const route = it => it.kind === 'udhback' ? 'from ' + esc(it.who) + ' into ' + esc(acctName(it.to)) + ' · udhaar' : it.kind === 'income' ? 'into ' + esc(acctName(it.to)) : it.kind === 'expense' ? 'from ' + esc(acctName(it.from)) : esc(acctName(it.from)) + ' → ' + esc(acctName(it.to));
  const itemRow = it => `<div class="pl-row src" data-it="${esc(it.key)}"><span class="r-name">${esc(it.label)}<small class="dq-sub">${route(it)}${it.changed ? ' · changed this month' : ''}${it.matched ? ' · found in Ledger' : ''}</small></span>
      ${amtIn('mi_' + it.key.replace(/[^\w]/g, '_'), it.a)}
      ${it.budget ? `<span class="r-act">${rs(spent)} spent</span>` : `<label class="r-act"><input type="checkbox" data-done ${it.done ? 'checked' : ''}${canTick && !it.matched ? '' : ' disabled'}> Done</label>`}
      ${it.extra ? `<button class="icon-btn r-rm" data-xrm="${esc(it.key)}" aria-label="Remove" style="width:32px;height:32px;font-size:13px">✕</button>` : ''}</div>`;
  const grp = (t, list) => list.length ? `<h4 class="plan-sub">${t}</h4><div class="group pl-group">${list.map(itemRow).join('')}</div>` : '';
  const now = ym < cur ? planCompute(c, ym, 'actual').slice(-1)[0] : null;
  const chk = now ? accts().filter(a => !isInvest(a.kind) && a.kind !== 'loan').map(a => {
    const app = now.accts[a.id] || 0, stated = (pm.checked || {})[a.id];
    return `<div class="pl-row src" data-chk="${a.id}"><span class="r-name">${esc(a.name)}<small class="dq-sub">app says ${rs(isLiab(a.kind) ? -app : app)}${isLiab(a.kind) ? ' owed' : ''}</small></span>${amtIn('ck_' + a.id, stated, isLiab(a.kind) ? 'owed' : 'bank shows')}<button class="btn small ghost" data-fix="${a.id}">Fix</button></div>`;
  }).join('') + accts().filter(a => isInvest(a.kind)).map(a => {
    const v = (a.values || []).find(x => x.month === ym);
    return `<div class="pl-row src" data-val="${a.id}"><span class="r-name">${esc(a.name)}<small class="dq-sub">value at month end</small></span>${amtIn('cv_' + a.id, v ? v.a : '', 'statement value')}</div>`;
  }).join('') : '';
  const html = `<div class="month-nav" style="margin-bottom:10px"><button id="pmPrev" aria-label="Previous month">‹</button><b>${monthLong(ym)}</b><button id="pmNext" aria-label="Next month">›</button></div>
    <p class="hint" style="margin:0 4px 6px">${ym < cur ? 'Monthly check-up: tick what actually came in and went out, correcting amounts if they differed. Each tick is written into the Ledger.' : ym === cur ? 'This month: tick items as they happen. Unticked items still count in the plan. The balance check opens after the month ends.' : 'Future month: change amounts for this month only. Ticking opens when the month arrives.'}</p>
    ${grp('Income', items.filter(i => i.kind === 'income'))}
    ${grp('Udhaar coming back', items.filter(i => i.kind === 'udhback'))}
    ${grp('Payments, SIPs, EMIs and transfers', items.filter(i => i.kind !== 'income' && i.kind !== 'udhback' && !i.budget))}
    ${grp('Day-to-day spending (estimate)', items.filter(i => i.budget))}
    <button class="linkbtn" id="pmAdd">＋ Add a one-off for this month</button><div id="pmAddBox"></div>
    ${now ? `<h4 class="plan-sub">Balance check (optional) · end of ${monthLong(ym)}</h4><div class="group pl-group">${chk}</div>
      <p class="hint" style="margin:4px 4px 0">Only if you want the app to match your bank exactly. Type the balance your bank showed on ${fmtDate(monthEnd(ym), true)}. If it differs from "app says", tap Fix and the difference is recorded as unrecorded spending or income. Leave blank to skip.</p>
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
  const go = d => { if (planMonthSave(ym, true) !== false) planMonthSheet(monthAdd(ym, d)); };
  $('pmPrev').addEventListener('click', () => { if (ym > c.startMonth) go(-1); else planMsg('This is the first month of the plan.', true); });
  $('pmNext').addEventListener('click', () => go(1));
}
function planMonthSave(ym, quiet) {
  const c = planCfg(), root = $('pshBody'); if (!root || !c) return true;
  let p = null, wrote = false;
  try {
    const items = planItems(c, ym), base = {}; items.forEach(it => { base[it.key] = it; });
    p = pmGet(ym) ? { ...pmGet(ym), items: { ...(pmGet(ym).items || {}) }, extra: (pmGet(ym).extra || []).map(x => ({ ...x })), checked: { ...(pmGet(ym).checked || {}) } } : pmNew(ym);
    const orig = {}; recurs().forEach(r => { orig['r:' + r.id] = recurAmt(r, ym); }); accts().forEach(a => { if (a.sip) orig['sip:' + a.id] = +a.sip.amt || 0; if (a.kind === 'loan') orig['emi:' + a.id] = +a.emi || 0; });
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

/* ==========================================================================
   PLAN TAB (simplified): show-until, year table, months, goals, settings
   ======================================================================== */
function renderPlan() {
  const body = $('planBody'), c = planCfg();
  planBadge();
  if (c && c.v !== 3) migratePlanV3();
  if (c) cleanZeroTicks();
  if (!c || !accts().length) { body.innerHTML = `<div class="empty"><b>Start in Accounts</b>Set up your accounts and opening balances first; the plan is built from them.</div><button class="btn brass block" id="plGoAcct">Go to Accounts</button>`;
    $('plGoAcct').addEventListener('click', () => { setPref('moneySeg', 'accts'); renderMoney(); }); return; }
  const mode = c.yearMode || 'fy', cur = isoMonth(new Date());
  const rows = planCompute(c, planHorizon(c)), years = planYears(rows, mode);
  const curKey = yearKey(cur < c.startMonth ? c.startMonth : cur, mode);
  if (Plan.year == null || !years.some(y => y.k === Plan.year)) Plan.year = years.some(y => y.k === curKey) ? curKey : years[0].k;
  const Y = years.find(y => y.k === Plan.year), L = Y.last, pend = planPendingMonths();
  const startKey = yearKey(c.startMonth, mode);
  const untilOpts = Array.from({ length: 21 }, (_, i) => startKey + i).map(k => { const em = mode === 'fy' ? (k + 1) + '-03' : k + '-12';
    return `<option value="${em}"${c.showUntil === em ? ' selected' : ''}>${yearLabel(k, mode)}</option>`; }).join('');
  const hidden = c.showUntil ? (() => { const auto = planAutoEnd(c); return auto > c.showUntil ? monthsBetween(c.showUntil, auto) : 0; })() : 0;
  const nowRow = rows.filter(r => r.ym <= cur).slice(-1)[0] || rows[0];
  const status = r => r.neg.length ? `<span class="st st-late" title="${esc(r.neg.map(acctName).join(', '))} below ₹0">below ₹0</span>`
    : r.ended ? (r.closed ? '<span class="st st-ok">Checked</span>' : r.pending ? '<span class="st st-warn">Check-up due</span>' : '<span class="st st-part">Done</span>') : r.cur ? '<span class="st">This month</span>' : '<span class="st">Planned</span>';
  const yrows = rows.filter(r => yearKey(r.ym, mode) === Plan.year);
  const goals = all('goal').sort((a, b) => (a.by || '').localeCompare(b.by || ''));
  body.innerHTML = `<div class="plan-until"><label for="plUntil">Show plan until</label><select id="plUntil"><option value=""${c.showUntil ? '' : ' selected'}>Automatic</option>${untilOpts}</select>
      ${hidden ? `<span class="hint" style="margin:0">${hidden} planned month(s) lie beyond this.</span>` : ''}</div>
    ${pend.length ? `<button class="plan-banner" id="plPend"><b>${pend.length} month${pend.length > 1 ? 's need' : ' needs'} a check-up.</b> Start with ${monthLong(pend[0])}.</button>` : ''}
    <div class="group plan-card plan-hero"><div class="plan-hero-top"><span class="eyebrow">Money you'll have at end of</span><select id="plYear" aria-label="Year">${years.map(y => `<option value="${y.k}"${y.k === Plan.year ? ' selected' : ''}>${y.label}</option>`).join('')}</select><span class="muted">${monthLong(L.ym)}</span></div>
      <div class="plan-big ${L.worth < 0 ? 'neg' : ''}">${rsShort(L.worth)}</div>
      <div class="plan-split"><span>Bank & cash <b>${rsShort(L.liquid)}</b></span><span>Investments <b>${rsShort(L.invest)}</b>${accts().some(a => isInvest(a.kind) && +a.ret) ? '<i class="est">estimate</i>' : ''}</span>${L.cardDue ? `<span>Card dues <b>−${rsShort(L.cardDue)}</b></span>` : ''}${L.udh ? `<span>Udhaar <b>${rsShort(L.udh)}</b></span>` : ''}${L.loanBal ? `<span>Loan balance <b>${rsShort(L.loanBal)}</b></span>` : ''}</div>
      ${L.loanBal ? `<div class="hint" style="margin:4px 0 0">After loans: ${rsShort(L.afterLoans)}</div>` : ''}
</div>
    <div class="plan-sec"><h3 class="plan-h">Year by year</h3><div class="tw"><table class="pt"><thead><tr><th>Year</th><th>Income</th><th>Spending</th><th>Saved</th><th>Into invest.</th><th>Bank & cash</th><th>Investments</th><th>Money you have</th><th>Loan balance</th><th>Checked</th></tr></thead><tbody>${
      years.map(y => `<tr class="${y.k === Plan.year ? 'hl' : ''}" data-year="${y.k}"><td>${y.label}${y.neg ? ' <span class="tag warn">!</span>' : ''}</td><td>${rsShort(y.inc)}</td><td>${rsShort(y.exp)}</td><td class="${y.inc - y.exp < 0 ? 'neg' : ''}">${rsShort(y.inc - y.exp)}</td><td>${y.invIn ? rsShort(y.invIn) : '–'}</td>
        <td class="${y.last.liquid < 0 ? 'neg' : ''}">${rsShort(y.last.liquid)}</td><td>${rsShort(y.last.invest)}</td><td><b>${rsShort(y.last.worth)}</b></td><td>${y.last.loanBal ? rsShort(y.last.loanBal) : '–'}</td><td>${y.ended ? y.closed + '/' + y.ended : '–'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="plan-sec"><h3 class="plan-h">Months · ${Y.label}</h3><div class="tw"><table class="pt pt-click"><thead><tr><th>Month</th><th>Income</th><th>Spending</th><th>Saved</th><th>Into invest.</th><th>Money you have</th><th>Status</th></tr></thead><tbody>${
      yrows.map(r => `<tr data-ym="${r.ym}" class="${r.cur ? 'hl' : ''}" tabindex="0"><td>${monthShort(r.ym)}</td><td>${r.inc ? rs(r.inc) : '–'}</td><td>${r.exp ? rs(r.exp) : '–'}</td><td class="${r.net < 0 ? 'neg' : 'pos'}">${rs(r.net)}</td><td>${r.invIn ? rs(r.invIn) : '–'}</td><td>${rs(r.worth)}</td><td>${status(r)}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Tap a past month for its check-up, or any month to change amounts or add a one-off. "Money you have" = bank + cash + investments + udhaar net − card dues (udhaar at today's figure). Loans are shown separately.</p></div>
    <div class="plan-sec"><h3 class="plan-h">Goals</h3>${goals.length ? goals.map(g => {
      const hit = rows.find(r => r.worth >= (+g.amt || 0)), pct = g.amt ? Math.max(0, Math.min(100, nowRow.worth / g.amt * 100)) : 0;
      const st = !hit ? ['Not reached in plan', 'st-warn'] : hit.ym <= g.by ? ['On track', 'st-ok'] : ['Late', 'st-late'];
      return `<button class="goal-row" data-goal="${g.id}"><div class="goal-top"><b>${esc(g.name)}</b><span class="st ${st[1]}">${st[0]}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="hint" style="margin:4px 0 0">${rsShort(nowRow.worth)} of ${rsShort(g.amt)} now (${pct.toFixed(0)}%) · wanted by ${monthLong(g.by)} · plan reaches it ${hit ? 'in ' + monthLong(hit.ym) : 'after ' + monthLong(rows[rows.length - 1].ym)}</div></button>`; }).join('')
      + '<p class="hint">Goals are checked against savings (loans not subtracted). Each goal is checked on its own, so two goals can count the same money.</p>' : '<p class="hint" style="margin:0 4px 8px">No goals yet.</p>'}
      <button class="btn ghost small" id="plGoalAdd">＋ Add goal</button></div>
    <div class="plan-sec"><div class="btn-row" style="flex-wrap:wrap"><button class="btn ghost small" id="plSettings">Plan settings</button><button class="btn ghost small" id="plXlsx">Export Excel</button></div>
      <p class="hint">Started ${monthLong(c.startMonth)} · opening balances as on ${fmtDate(monthEnd(monthAdd(c.startMonth, -1)), true)} · ${mode === 'fy' ? 'financial years (Apr–Mar)' : 'calendar years'}.</p></div>`;
  $('plYear').addEventListener('change', e => { Plan.year = +e.target.value; renderPlan(); });
  $('plUntil').addEventListener('change', e => { c.showUntil = e.target.value || null; put(c, { render: false }); Plan.year = null; renderPlan(); });
  if ($('plPend')) $('plPend').addEventListener('click', () => planMonthSheet(pend[0]));
  $$('[data-year]', body).forEach(tr => tr.addEventListener('click', () => { Plan.year = +tr.dataset.year; renderPlan(); }));
  $$('[data-ym]', body).forEach(tr => { const go = () => planMonthSheet(tr.dataset.ym); tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); });
  $('plGoalAdd').addEventListener('click', () => planGoalSheet(null));
  $$('[data-goal]', body).forEach(b => b.addEventListener('click', () => planGoalSheet(b.dataset.goal)));
  $('plSettings').addEventListener('click', planSettingsSheet);
  $('plXlsx').addEventListener('click', exportXlsx);
}
function planGoalSheet(id) {
  const g = id ? records[id] : { name: '', amt: '', by: '' }, c = planCfg(), cur = isoMonth(new Date());
  const past = planCompute(c, cur < c.startMonth ? c.startMonth : cur).filter(r => r.exp > 0).slice(-6);
  const avg = past.length ? past.reduce((s, r) => s + r.exp, 0) / past.length : 0;
  const html = `${id ? '' : `<div class="wrapchips" style="margin-bottom:12px">${['Emergency fund', 'House / property', "Children's education"].map(n => `<button class="chip" data-gq="${esc(n)}">${n}</button>`).join('')}</div>`}
    <div class="field"><label>Goal</label><input id="pgName" value="${esc(g.name)}"></div>
    <div class="grid2"><div class="field"><label>Amount ₹</label>${amtIn('pgAmt', g.amt)}</div><div class="field"><label>Wanted by</label>${monthIn('pgBy', g.by)}</div></div>
    ${avg ? `<button class="linkbtn" id="pgSix">Use 6 months of spending (${rs(avg * 6)})</button>` : ''}
    ${id ? '<button class="btn danger block" id="pgDel" style="margin-top:14px">Delete goal</button>' : ''}`;
  planSheet(id ? 'Goal' : 'New goal', html, () => {
    try {
      const name = $('pgName').value.trim(); if (!name) throw new Error('Name the goal.');
      const by = $('pgBy').value; if (!ymOk(by)) throw new Error('Pick the month you want it by.');
      const rec = id ? records[id] : { id: uid('gl'), type: 'goal', deleted: false };
      Object.assign(rec, { name, amt: readAmt('pgAmt', 'Amount', true), by }); put(rec, { render: false }); toast('Goal saved.'); return true;
    } catch (e) { planMsg(e.message, true); return false; }
  });
  $$('[data-gq]', $('pshBody')).forEach(b => b.addEventListener('click', () => { $('pgName').value = b.dataset.gq; }));
  if ($('pgSix')) $('pgSix').addEventListener('click', () => { $('pgAmt').value = Math.round(avg * 6); if (!$('pgName').value) $('pgName').value = 'Emergency fund'; });
  if (id) $('pgDel').addEventListener('click', () => { Sheets.close('shPlan', true); deleteWithUndo(id, g.name); });
}
function planSettingsSheet() {
  const c = planCfg(); if (!c) return;
  const html = `<div class="field"><label>Plan starts</label>${monthIn('ptStart', c.startMonth)}</div>
    <p class="hint" style="margin:-6px 4px 12px">Opening balances are as on the last day of the month before. Change them in Accounts → Opening balances.</p>
    <div class="field"><label>Default account</label><select id="ptDef">${acctOptions(defAcct(c), a => isLiquid(a.kind) || a.kind === 'card')}</select></div>
    <p class="hint" style="margin:-6px 4px 12px">Used when a Ledger entry has no account (older entries) and pre-selected for new items.</p>
    <div class="field"><label>Show years as</label><div class="seg" id="ptMode"><button data-m="fy" class="${(c.yearMode || 'fy') === 'fy' ? 'on' : ''}">Financial (Apr–Mar)</button><button data-m="cal" class="${c.yearMode === 'cal' ? 'on' : ''}">Calendar (Jan–Dec)</button></div></div>
    <div class="group"><label class="switch-row"><span>Remind me to do the monthly check-up<small>Adds "${CHECKUP_LABEL}" on the 1st of every month to Key dates (and the daily email, if you use it).</small></span><input type="checkbox" class="sw" id="ptRemind"${checkupDate() ? ' checked' : ''}></label></div>`;
  planSheet('Plan settings', html, () => {
    setCheckupReminder($('ptRemind').checked);
    const start = $('ptStart').value; if (!ymOk(start)) { planMsg('Pick a start month.', true); return false; }
    if (start < c.startMonth && archIndex().length && !confirm(ARCH_START_WARN)) return false;
    Object.assign(c, { startMonth: start, defAcct: $('ptDef').value, yearMode: $('ptMode').querySelector('.on').dataset.m }); put(c, { render: false }); Plan.year = null; toast('Saved.'); return true;
  });
  $$('#ptMode button').forEach(b => b.addEventListener('click', () => $$('#ptMode button').forEach(x => x.classList.toggle('on', x === b))));
}

/* ---------- Excel export (SheetJS, loaded on first use, then kept offline) ---------- */
const XLSX_URL = 'vendor/xlsx.full-0.18.5.min.js';
async function exportXlsx() {
  const c = planCfg();
  try { await loadScript(XLSX_URL); } catch (e) { toast('Excel export needs internet the first time.'); return; }
  const X = window.XLSX, wb = X.utils.book_new(), cur = isoMonth(new Date());
  const add = (name, rows, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, name); };
  if (c && accts(true).length) {
    const rows = planCompute(c, planHorizon(c)), now = cur < c.startMonth ? null : planCompute(c, cur, 'actual').slice(-1)[0];
    const today = balancesOn(c, todayISO());
    add('Accounts', [['Account', 'Type', 'Opening (' + monthEnd(monthAdd(c.startMonth, -1)) + ')', now ? 'Today ' + todayISO() + ' (actual)' : 'Today (plan not started: opening)', 'Plan ' + rows[rows.length - 1].ym, 'Archived']].concat(
      accts(true).map(a => [a.name, kindLabel(a.kind), a.kind === 'loan' && loanSched(a) ? -Math.round(loanOwed(a, monthAdd(c.startMonth, -1))) : isLiab(a.kind) ? -(+a.open || 0) : +a.open || 0, Math.round(today.accts[a.id] || 0), Math.round(rows[rows.length - 1].accts[a.id] || 0), a.archived ? 'yes' : '']))
      .concat([[], ['Money you have (bank + cash + investments + udhaar net − card dues)', '', '', Math.round(today.money)], ['Money in hand (bank + cash − card dues)', '', '', Math.round(today.hand)], ['Bank & wallets', '', '', Math.round(today.bank)], ['Cash', '', '', Math.round(today.cash)], ['Investments', '', '', Math.round(today.invest)],
        ['Card dues', '', '', -Math.round(today.card)], ['Loan balance (separate)', '', '', Math.round(today.loan)], ['Others owe you', '', '', Math.round(today.owed)], ['You owe others', '', '', -Math.round(today.owe)]]), [30, 16, 18, 22, 16, 9]);
    const loans = accts(true).filter(a => a.kind === 'loan');
    if (loans.length) add('Loans', [['Loan', 'EMI', 'Paid from', 'First EMI', 'Last EMI', 'Loan amount', 'EMIs total', 'EMIs paid', 'EMIs left', 'Paid so far', 'Still to pay (EMIs)', 'Interest rate %', 'Principal owed now']].concat(
      loans.map(a => { const k = loanInfo(a); return [a.name, +a.emi || 0, acctName(a.payFrom), a.start || '', a.end || '', +a.amount || '', k.n || '', k.paid || 0, k.left == null ? '' : k.left, k.paidAmt || 0, k.leftAmt == null ? '' : k.leftAmt, k.rate == null ? '' : +k.rate.toFixed(2), k.outstanding == null ? '' : Math.round(k.outstanding)]; })),
      [18, 10, 16, 10, 10, 12, 10, 10, 10, 12, 14, 12, 16]);
    add('Months', [['Month', 'Income', 'Spending', 'Saved', 'Into investments', ...accts(true).map(a => a.name), 'Udhaar net', 'Money you have', 'Money in hand', 'Loan balance', 'After loans', 'Status']].concat(
      rows.map(r => [r.ym, Math.round(r.inc), Math.round(r.exp), Math.round(r.net), Math.round(r.invIn), ...accts(true).map(a => Math.round(r.accts[a.id] || 0)), Math.round(r.udh), Math.round(r.worth), Math.round(r.hand), Math.round(r.loanBal), Math.round(r.afterLoans),
        r.ended ? (r.closed ? 'Checked' : r.pending ? 'Check-up due' : 'Done') : r.cur ? 'This month' : 'Planned'])), [9, 12, 12, 12, 14, ...accts(true).map(() => 16), 12, 14, 13, 13, 13, 12]);
    add('Recurring', [['Name', 'Type', 'Amount', 'From', 'Into', 'Every (months)', 'First', 'Last', 'Estimate', 'Amount changes']].concat(
      recurs().map(r => [r.name, r.kind, +r.amt, r.from ? acctName(r.from) : '', r.to ? acctName(r.to) : '', +r.every || 1, r.start, r.end || '', r.budget ? 'yes' : '', (r.steps || []).map(x => x.a + ' from ' + x.month).join('; ')])), [24, 10, 12, 20, 20, 8, 9, 9, 9, 30]);
  }
  add('Ledger', [['Date', 'Description', 'Type', 'Category', 'Account', 'To account', 'Person', 'Amount', 'Outstanding (udhaar)']].concat(
    all('fin').sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(e => [e.date, e.desc, e.kind, e.category || '', e.acct ? acctName(e.acct) : '', e.to ? acctName(e.to) : '', e.who || '', +e.amount, isUdhaar(e.kind) ? outstanding(e) : ''])), [11, 30, 10, 12, 20, 20, 14, 12, 12]);
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  shareOrDownload(out, 'register-money-' + todayISO() + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
/* kept for the CSV button on older layouts */
function planCsv(c, rows) {
  const csv = [['Month', 'Income', 'Spending', 'Net worth']].concat(rows.map(r => [r.ym, Math.round(r.inc), Math.round(r.exp), Math.round(r.worth)])).map(r => r.join(',')).join('\n');
  shareOrDownload('﻿' + csv, 'register-plan-' + todayISO() + '.csv', 'text/csv');
}

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

/* ==========================================================================
   EMERGENCY ERASE (v2.3) — needs a separate erase code, the word ERASE and a
   10-second countdown. Cloud copies are overwritten with empty "erased" rows
   (other devices clear their copy on their next sync) and Drive files are
   sent to Drive's bin.
   ======================================================================== */
const ERASE_ID = '__erasekey__', ERASE_ITERS = 200000;
let eraseTimer = null;
const eraseRec = () => { const r = records[ERASE_ID]; return r && !r.deleted && r.type === 'erasekey' ? r : null; };
async function eraseHash(code, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: ERASE_ITERS, hash: 'SHA-256' }, base, 256));
}
/* v2.19 (S2): a second value made from the erase code — the Apps Script keeps only its hash and needs it to empty the Register folder. Not stored anywhere in the Sheet. */
async function eraseProof(code, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode('register-erase-proof|' + salt), iterations: ERASE_ITERS, hash: 'SHA-256' }, base, 256));
}
function eraseSheet(title, html) { $('erTitle').textContent = title; $('erBody').innerHTML = html; if (!Sheets.isOpen('shErase')) Sheets.open('shErase'); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function openEraseSetup() {
  if (!finConfigured()) { toast('Set up the private section first (tap "Register" three times).'); return; }
  eraseSheet(eraseRec() ? 'Change erase code' : 'Set erase code', `<p class="hint" style="margin:0 4px 12px">Used only for emergency erase. It must be different from your private code and at least 8 characters. Keep it somewhere safe; it cannot be recovered.</p>
    <div class="field"><label>Your private code (to confirm it is you)</label><input type="password" id="erPriv" autocomplete="off"></div>
    ${eraseRec() ? '<div class="field"><label>Current erase code</label><input type="password" id="erOld" autocomplete="off"></div>' : ''}
    <div class="field"><label>New erase code</label><input type="password" id="erNew1" autocomplete="new-password"></div>
    <div class="field"><label>Repeat erase code</label><input type="password" id="erNew2" autocomplete="new-password"></div>
    <button class="btn brass block" id="erSave">Save erase code</button><div class="msg" id="erMsg"></div>`);
  $('erSave').addEventListener('click', async () => {
    const m = $('erMsg'), priv = $('erPriv').value, a = $('erNew1').value, b = $('erNew2').value, fk = records[FINKEY_ID];
    m.className = 'msg'; m.textContent = 'Checking…';
    let ok = false; try { ok = (await aesDec(await deriveFinKey(priv, fk.salt, fk.iters), fk.check)) === 'register-ok'; } catch (e) {}
    m.className = 'msg err';
    if (!ok) { m.textContent = 'The private code is not correct.'; return; }
    if (a.length < 8) { m.textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { m.textContent = "The two entries don't match."; return; }
    if (a === priv) { m.textContent = 'Choose something different from your private code.'; return; }
    const old = eraseRec(), oldCode = $('erOld') ? $('erOld').value : '';
    if (old && (await eraseHash(oldCode, old.salt)) !== old.hash) { m.textContent = 'The current erase code is not correct.'; return; }
    m.className = 'msg'; m.textContent = 'Saving…';
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    let note = '';
    if (Sync.on()) {                                        // the script learns the new proof first, so the two never disagree
      try { await Sync.call('eraseProofSet', { proof: await eraseProof(a, salt), oldProof: old ? await eraseProof(oldCode, old.salt) : '' }, 60000); }
      catch (e) {
        if (/mismatch/.test(e.message || '')) { m.className = 'msg err'; m.textContent = 'The Apps Script has a different erase code saved. In Apps Script: Project Settings → Script properties → delete ERASE_PROOF, then save here again.'; return; }
        note = /unknown action/.test(e.message || '') ? ' Update the Apps Script to v25 and save the erase code again, so erase can empty the Drive folder.' : ' The Apps Script could not be told (' + e.message + '); save it again when online.';
      }
    } else note = ' Sync is off: connect it and save the erase code again so erase can empty the Drive folder.';
    put({ id: ERASE_ID, type: 'erasekey', salt, hash: await eraseHash(a, salt), deleted: false });
    Sheets.close('shErase', true); toast('Erase code saved.' + note, null, null, note ? 9000 : 2800);
  });
}
function openErase() {
  const r = eraseRec();
  if (!r) { eraseSheet('Emergency erase', '<p class="hint" style="margin:0 4px">No erase code is set. First use "Set emergency erase code" in Settings (it asks for your private code).</p>'); return; }
  const cloud = Sync.on();
  eraseSheet('Emergency erase', `<div class="erase-warn"><b>This deletes all Register data</b> — tasks, notes, dates, documents and their files, Money, Plan and private notes. It cannot be undone from the app.</div>
    <div class="group"><label class="switch-row"><span>Also erase the Google Sheet and Drive files<small>${cloud ? "Sheet rows are overwritten; Drive files go to Drive's bin. Your other devices clear their copy when they next sync." : 'Sync is not connected, so only this device can be erased.'}</small></span><input type="checkbox" class="sw" id="erCloud"${cloud ? ' checked' : ' disabled'}></label></div>
    <div class="field"><label>Erase code</label><input type="password" id="erCode" autocomplete="off"></div>
    <div class="field"><label>Type ERASE in capital letters</label><input id="erWord" autocapitalize="characters" autocomplete="off" autocorrect="off"></div>
    <button class="btn danger block" id="erGo" disabled>Erase…</button><div class="msg" id="erMsg"></div>
    <p class="hint">Not reached by this: Google Sheets' own version history, the old "Records" archive tab from v15, and Drive's bin (emptied by Google after 30 days).</p>`);
  const upd = () => { $('erGo').disabled = !($('erCode').value && $('erWord').value === 'ERASE'); };
  ['erCode', 'erWord'].forEach(x => $(x).addEventListener('input', upd));
  $('erGo').addEventListener('click', async () => {
    const m = $('erMsg');
    if (Date.now() < +(lsGet('r2_eraseLock') || 0)) { m.className = 'msg err'; m.textContent = 'Too many wrong codes. Try again in a few minutes.'; return; }
    $('erGo').disabled = true; m.className = 'msg'; m.textContent = 'Checking…';
    if ((await eraseHash($('erCode').value, r.salt)) !== r.hash) {
      const fails = +(lsGet('r2_eraseFails') || 0) + 1; lsSet('r2_eraseFails', fails);
      if (fails >= 3) { lsSet('r2_eraseLock', Date.now() + 10 * 60000); lsSet('r2_eraseFails', 0); }
      m.className = 'msg err'; m.textContent = fails >= 3 ? 'Wrong erase code. Locked for 10 minutes.' : 'Wrong erase code.'; $('erGo').disabled = false; return;
    }
    lsSet('r2_eraseFails', 0);
    const cloudOn = $('erCloud').checked, proof = await eraseProof($('erCode').value, r.salt);
    let n = 10;
    $('erGo').outerHTML = '<button class="btn block" id="erCancel">Cancel — keep my data</button>';
    m.className = 'msg err'; m.textContent = `Erasing in ${n}…`;
    $('erCancel').addEventListener('click', () => { clearInterval(eraseTimer); eraseTimer = null; Sheets.close('shErase', true); toast('Erase cancelled. Nothing was deleted.'); });
    eraseTimer = setInterval(() => {
      n--; if (n > 0) { m.textContent = `Erasing in ${n}…`; return; }
      clearInterval(eraseTimer); eraseTimer = null; const cb = $('erCancel'); if (cb) cb.remove(); doErase(cloudOn, proof);
    }, 1000);
  });
}
Sheets.onClose.shErase = () => { if (eraseTimer) { clearInterval(eraseTimer); eraseTimer = null; toast('Erase cancelled. Nothing was deleted.'); } };
async function doErase(cloudOn, proof) {
  const m = $('erMsg'); window.__erasing = true; clearTimeout(Sync.timer);
  RLOG.warn('EMERGENCY ERASE started', cloudOn ? 'cloud+device' : 'device');
  if (cloudOn) {
    try { await wipeCloud(t => { m.textContent = t; }, proof); }
    catch (e) {
      window.__erasing = false;
      m.textContent = 'The Google Sheet could not be erased (' + (e.message || e) + '). Nothing on this device has been deleted yet.';
      $('erBody').insertAdjacentHTML('beforeend', '<div class="btn-row"><button class="btn ghost" id="erRetry">Try again</button><button class="btn danger" id="erLocal">Erase this device only</button></div>');
      $('erRetry').addEventListener('click', () => doErase(true, proof)); $('erLocal').addEventListener('click', () => doErase(false));
      return;
    }
  }
  m.textContent = 'Erasing this device…';
  await wipeDevice();
}
async function wipeCloud(say, proof) {
  say('Reading the Sheet…');
  const d = await Sync.call('pull', { since: 0 }, 180000);
  const ids = new Set((d.records || []).map(r => r.id));
  Object.keys(records).forEach(i => ids.add(i)); Object.keys(sealed).forEach(i => ids.add(i));
  const files = new Set();
  (d.records || []).forEach(r => { if (r.type === 'docfile' || r.type === 'blob') { try { const p = JSON.parse(r.payload); if (p.fileId) files.add(p.fileId); } catch (e) {} } });
  Object.values(records).forEach(r => { if (r.fileId) files.add(r.fileId); });
  (d.records || []).forEach(r => { if (r.type === 'archent') { try { const p = JSON.parse(r.payload); if (p.fileId) files.add(p.fileId); } catch (e) {} } });
  (d.records || []).forEach(r => { if (r.type === 'archidx') { try { (JSON.parse(r.payload).list || []).forEach(a => { if (a.fileId) files.add(a.fileId); }); } catch (e) {} } });
  archIndex().forEach(a => { if (a.fileId) files.add(a.fileId); });
  AutoBackup.list().forEach(b => { if (b.fileId) files.add(b.fileId); });
  let n = 0;
  for (const f of files) { say(`Removing Drive files… ${++n} of ${files.size}`); try { await Sync.call('driveDelete', { fileId: f }, 60000); } catch (e) { RLOG.warn('erase: drive file', e.message); } }
  for (let k = 0, more = true; more && k < 30; k++) {                        // everything else in the Register folder (backups from other devices…)
    say('Emptying the Register folder…');
    try { const r = await Sync.call('driveEmptyFolder', { confirm: 'ERASE', proof: proof || '' }, 300000); more = !!r.more; } catch (e) { RLOG.warn('erase: empty folder', e.message); more = false; }
  }
  const list = [...ids], now = Date.now() + 86400000, at = Date.now();
  for (let i = 0; i < list.length; i += 200) {
    const batch = list.slice(i, i + 200).map(id => ({ id, type: 'erased', updatedAt: now, deleted: false, summary: '', payload: JSON.stringify({ id, type: 'erased', updatedAt: now, at, deleted: false }) }));
    const r = await Sync.call('push', { records: batch }, 180000);
    if ((r.stale || []).length) { RLOG.warn('erase: stale rows', r.stale.length); window.__eraseStale = (window.__eraseStale || 0) + r.stale.length; }
    say(`Erasing the Sheet… ${Math.min(i + 200, list.length)} of ${list.length}`);
  }
}
async function wipeDevice() {
  window.__erasing = true;
  await new Promise(res => {
    try {
      const rq = indexedDB.open('register2');
      rq.onsuccess = () => { const db = rq.result; const names = [...db.objectStoreNames]; if (!names.length) { db.close(); return res(); }
        const t = db.transaction(names, 'readwrite'); names.forEach(n => t.objectStore(n).clear());
        t.oncomplete = () => { db.close(); res(); }; t.onerror = () => { db.close(); res(); }; };
      rq.onerror = () => res();
    } catch (e) { res(); }
  });
  records = {}; sealed = {}; storeVer++;
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) {}
  try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } catch (e) {}
  location.replace(location.pathname);
}

/* ==========================================================================
   BULK IMPORT (v2.9) — read the Docs folder named in the Apps Script (IMPORT_FOLDER_ID),
   turn file names like TAX_Rahul_ITR-Ack_AY2025-26.pdf into documents, copy the files
   into the Register folder on the server (nothing is downloaded to the phone).
   ======================================================================== */
const IMPORT_MAP = { ID: 'Identity', EDU: 'Education', EXAM: 'Exam', TAX: 'Tax', FIN: 'Financial', SALARY: 'Financial', MED: 'Medical', OFF: 'Official',
  PROPERTY: 'Property', CERT: 'Certificate', PHOTO: 'Photo & Signature', SIGNATURE: 'Photo & Signature', DOC: 'Other',
  CASE: 'Case', EVIDENCE: 'Case', MISC: 'Other', PERSONAL: 'Other', UNKNOWN: 'Other', ACAD: 'Education', MARKSHEET: 'Education', BANK: 'Financial', INS: 'Insurance', INSURANCE: 'Insurance',
  VEH: 'Vehicle', VEHICLE: 'Vehicle', WARRANTY: 'Warranty', MEMBER: 'Membership', MEMBERSHIP: 'Membership', OFFICE: 'Official', OFFICIAL: 'Official', IDS: 'Identity', MEDICAL: 'Medical', EXAMS: 'Exam' };
const IMPORT_SKIP = { VIDEO: 'not a PDF or photo' };
const IMPORT_OK_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'webp'];
const splitCamel = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').replace(/-/g, ' - ').replace(/\s+/g, ' ').trim();
const isDateTok = t => /^(AY|FY)?(19|20)\d{2}(-\d{2}){0,2}$/i.test(t) || /^(YYYY|Undated)$/i.test(t);   // "1234" (last digits of an account) is not a year
function fyFromToken(t) {
  let m;
  const fy = s => s + '-' + String((s + 1) % 100).padStart(2, '0');
  if ((m = t.match(/^AY(\d{4})-\d{2}$/i))) return fy(+m[1] - 1);           // assessment year → the financial year before it
  if ((m = t.match(/^FY(\d{4})-\d{2}$/i))) return fy(+m[1]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return fyOf(t);
  if ((m = t.match(/^(\d{4})-(\d{2})$/))) { const Y = +m[1], N = +m[2]; return N === (Y + 1) % 100 ? fy(Y) : N >= 1 && N <= 12 ? fyOf(`${Y}-${m[2]}-01`) : fy(Y); }   // 2024-25 is an FY, 2024-03 is March 2024
  if ((m = t.match(/^(\d{4})$/))) return fy(+m[1]);                           // a plain year: the FY that starts in it
  return null;
}
function parseDocName(name) {
  const ext = ((name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase(), base = name.replace(/\.[^.]+$/, '');
  if (!IMPORT_OK_EXT.includes(ext)) return { skip: 'not a PDF or photo' };
  const tk = base.split('_').filter(Boolean); if (!tk.length) return { skip: 'no name' };
  const pre = tk[0].toUpperCase();
  if (IMPORT_SKIP[pre]) return { skip: IMPORT_SKIP[pre] };
  if (tk.some(t => /^(Dup\d*|Copy\d*)$/i.test(t))) return { skip: 'duplicate copy' };
  const type = IMPORT_MAP[pre] || 'Other', noPerson = ['CASE', 'EVIDENCE', 'UNKNOWN'].includes(pre);
  let rest = tk.slice(1), who = '', fy = null, unknown = false, unsorted = false;
  rest = rest.filter(t => { if (/^(Unknown|ThirdParty|Unconfirmed)$/i.test(t)) { unknown = unknown || /^Unknown$/i.test(t); return false; } if (/^(Unlabeled|Unlabelled)$/i.test(t)) { unsorted = true; return false; } return true; });
  const nameTok = t => (/^[A-Z][a-z]+(-[A-Z][a-z]+)*$/.test(t) || /^(family|parents)$/i.test(t) || !!PERSON_ALIAS[t.toLowerCase()]) && !/^(Photo|Picsart|WhatsApp|Scan|Doc|Passport)$/i.test(t);
  if (!noPerson && (rest.filter(t => !isDateTok(t)).length >= 2 || pre === 'SIGNATURE' || unsorted) && rest.length && nameTok(rest[0])) who = normWho(rest.shift().replace(/-/g, ' & '));
  const junk = t => /^(New|Old\d*|\d{1,2}|Final|Draft|All)$/i.test(t);
  while (rest.length > 1 && junk(rest[rest.length - 1])) rest.pop();
  if (rest.length && isDateTok(rest[rest.length - 1])) fy = fyFromToken(rest.pop());
  while (rest.length && isDateTok(rest[rest.length - 1])) rest.pop();
  while (rest.length > 1 && junk(rest[rest.length - 1])) rest.pop();
  if (rest.length === 1 && /^\d{1,2}$/.test(rest[0])) rest = [];
  let head = rest.join(' ');
  if (pre === 'TAX' && rest.length) { head = rest[0].split('-')[0]; if (/^ITR\d*$/i.test(head)) head = 'ITR'; }
  let title = rest.length ? splitCamel(head) : '';
  if (unsorted) title = 'Unsorted photos';
  else if (pre === 'PHOTO') title = /photo$/i.test(title) ? title : (title || 'Photo') + ' photo';
  if (pre === 'SIGNATURE') title = 'Signature';
  if (!title) title = splitCamel(base.replace(/_/g, ' '));
  if (unknown && !unsorted) title += ' — unknown person';
  return { type: unsorted ? 'Photo & Signature' : type, who, fy, title, label: splitCamel(tk.slice(1).join(' ')) || base };
}
function planImport(files) {
  const groups = new Map(), skipped = [];
  const done = new Set(all('docfile').map(f => f.srcId).filter(Boolean)), declined = impDeclined();
  files.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
    if (done.has(f.id)) { skipped.push({ name: f.name, why: 'already imported' }); return; }
    if (declined.has(f.id)) { skipped.push({ name: f.name, why: 'you chose not to import', declined: true }); return; }
    const p = parseDocName(f.name);
    if (p.skip) { skipped.push({ name: f.name, why: p.skip }); return; }
    const key = [p.type, docOwners(p).join('&'), p.title.toLowerCase()].join('|');
    if (!groups.has(key)) groups.set(key, { key, type: p.type, who: p.who, title: p.title, files: [] });
    groups.get(key).files.push({ ...f, fy: p.fy, label: p.label });
  });
  const list = [...groups.values()].map(g => {
    const ys = [...new Set(g.files.map(f => f.fy).filter(Boolean))];
    g.byYear = g.files.length > 1 && ys.length > 0;
    g.fy = !g.byYear && ys.length === 1 ? ys[0] : null;
    g.years = ys.sort().reverse();
    g.into = all('doc').find(d => d.title.toLowerCase() === g.title.toLowerCase() && docOwners(d).join('&') === docOwners(g).join('&') && d.docType === g.type) || null;
    return g;
  }).sort((a, b) => a.type.localeCompare(b.type) || a.who.localeCompare(b.who) || a.title.localeCompare(b.title));
  return { list, skipped };
}
let importPlan = null;
function openImport() {
  Sheets.closeAll();
  $('impBody').innerHTML = `<p class="hint">Reads the Docs folder set as <b>IMPORT_FOLDER_ID</b> in your Apps Script (v18), and moves the chosen files into your Register folder (no second copy). Files without a person go under Rahul.</p>
    <button class="btn ghost block hidden" id="impTidy" style="margin-bottom:8px"></button>
    <button class="btn block" id="impRead">Read the Docs folder</button><div class="msg" id="impMsg"></div><div id="impList"></div>`;
  $('impRead').addEventListener('click', readImport);
  $('impTidy').addEventListener('click', tidyImported); renderTidyBtn();
  Sheets.open('shImport');
}
async function readImport() {
  const m = $('impMsg');
  if (!Sync.on()) { m.className = 'msg err'; m.textContent = 'Connect the Google Sheet first (Settings → Sync).'; return; }
  if (!driveOn()) { m.className = 'msg err'; m.textContent = 'Set the Register Drive folder first (Settings → Sync → Drive folder).'; return; }
  m.className = 'msg'; m.textContent = 'Reading…';
  let d;
  try { d = await Sync.call('driveListImport', {}, 120000); }
  catch (e) { m.className = 'msg err'; m.textContent = /unknown action/.test(e.message) ? 'Your Apps Script is older than v18. Paste Code.gs v18, fill IMPORT_FOLDER_ID and redeploy.' : e.message; return; }
  importPlan = planImport(d.files || []);
  const P = importPlan, nf = P.list.reduce((s, g) => s + g.files.length, 0);
  m.className = 'msg ok'; m.textContent = `"${d.folder}": ${(d.files || []).length} files → ${P.list.length} documents (${nf} files). ${P.skipped.length} skipped.`;
  const byWhy = {}; P.skipped.forEach(s => { (byWhy[s.why] = byWhy[s.why] || []).push(s.name); });
  $('impList').innerHTML = `<div class="btn-row" style="margin:8px 0"><button class="btn ghost small" id="impAll">Tick all</button><button class="btn ghost small" id="impNone">Untick all</button></div>
    <div class="group">${P.list.map((g, i) => `<label class="imp-row"><input type="checkbox" data-imp="${i}" checked><span><b>${esc(g.title)}</b>${g.who ? ' · ' + esc(g.who) : ''}
      <small>${esc(docOwners({ who: g.who }).join(' & '))} › ${esc(docGroup({ docType: g.type }))} · ${esc(g.type)} · ${g.files.length} file${g.files.length > 1 ? 's' : ''}${g.byYear ? ' · by year: ' + g.years.join(', ') : g.fy ? ' · FY ' + g.fy : ''}${g.into ? ' · adds to your existing document' : ''}</small>
      <small>${g.files.map(f => esc(f.name)).join('<br>')}</small></span></label>`).join('')}</div>
    <details class="fold"><summary>Skipped (${P.skipped.length})</summary>${Object.entries(byWhy).map(([w, l]) => `<div class="imp-skip"><b>${esc(w)}</b> (${l.length}): ${l.map(esc).join(', ')}</div>`).join('')}</details>
    ${P.skipped.some(s => s.declined) ? '<button class="linkbtn" id="impUndo" style="margin:6px 4px">Offer the files I said no to again</button>' : ''}
    <p class="hint" style="margin:8px 4px 0">Unticked documents will not be offered again. You can bring them back from the Skipped list.</p>
    <div class="imp-bar"><button class="btn block" id="impGo">Import ticked documents</button></div>`;
  if (!P.list.length) { $('impList').querySelector('.btn-row').remove(); $('impList').querySelector('.imp-bar').remove(); $('impList').querySelector('.group').outerHTML = '<div class="empty">Nothing new to import.</div>'; $$('#impList > p.hint').forEach(x => x.remove()); }
  if ($('impAll')) $('impAll').addEventListener('click', () => $$('[data-imp]').forEach(c => { c.checked = true; }));
  if ($('impNone')) $('impNone').addEventListener('click', () => $$('[data-imp]').forEach(c => { c.checked = false; }));
  if ($('impGo')) $('impGo').addEventListener('click', runImport);
  if ($('impUndo')) $('impUndo').addEventListener('click', () => { impUndecline(); toast('Those files will be offered again.'); readImport(); });
  ImpCheck.refresh(d.files || []);
}
async function runImport() {
  const pick = $$('[data-imp]').filter(c => c.checked).map(c => importPlan.list[+c.dataset.imp]);
  const no = $$('[data-imp]').filter(c => !c.checked).map(c => importPlan.list[+c.dataset.imp]);
  if (!pick.length && !no.length) { toast('Nothing to import.'); return; }
  impDecline(no.flatMap(g => g.files.map(f => f.id)));                 // unticked: do not offer again
  if (!pick.length) { ImpCheck.set({ at: Date.now(), n: 0 }); scheduleRender(); $('impMsg').className = 'msg ok'; $('impMsg').textContent = `${no.length} document${no.length > 1 ? 's' : ''} will not be offered again.`; return; }
  const m = $('impMsg'), go = $('impGo'); go.disabled = true;
  const have = new Set(Object.values(records).filter(r => r.type === 'docfile' && !r.deleted).flatMap(r => [r.srcId, r.fileId]).filter(Boolean));
  pick.forEach(g => { g.files = g.files.filter(f => !have.has(f.id)); });                  // already in Register (a second tap, or an earlier run)
  const total = pick.reduce((s, g) => s + g.files.length, 0); let n = 0, ok = 0; const bad = [], toLock = new Set();
  for (const g of pick) {
    if (!g.files.length) continue;
    let d = g.into && records[g.into.id] && !records[g.into.id].deleted ? records[g.into.id] : null;
    if (!d) d = g.into = put({ id: uid('doc'), type: 'doc', title: g.title, who: normWho(g.who), docType: g.type, number: '', expiry: null, issuer: '', notes: '', folder: '', fy: g.fy || null, byYear: g.byYear, deleted: false }, { render: false });
    else if (g.byYear && !d.byYear) { d.byYear = true; put(d, { render: false }); }
    for (let i = 0; i < g.files.length; i += 5) {
      const batch = g.files.slice(i, i + 5);
      m.className = 'msg'; m.textContent = `Copying ${Math.min(n + batch.length, total)} of ${total}… keep the app open.`;
      let res;
      try { res = await Sync.call('driveCopyIn', { move: true, files: batch.map(f => ({ id: f.id, name: f.name })) }, 300000); }
      catch (e) { batch.forEach(f => bad.push(f.name + ': ' + e.message)); n += batch.length; continue; }
      (res.done || []).forEach(r => {
        const f = batch.find(x => x.id === r.id); n++;
        if (!r.fileId) { bad.push((f ? f.name : r.id) + ': ' + (r.error || 'failed')); return; }
        put({ id: uid('df'), type: 'docfile', docId: d.id, name: f.name, mime: r.mime || f.mime, bytes: r.bytes || f.size || 0, fileId: r.fileId, srcId: f.id, srcGone: r.fileId === f.id || undefined, locked: false,
              fy: d.byYear ? (f.fy || undefined) : undefined, deleted: false }, { render: false });
        ok++; if (d.lockFiles) toLock.add(d.id);
      });
    }
  }
  for (const id of toLock) { const d = records[id]; if (d && Fin.key) { try { await convertDocFiles(d); } catch (e) { RLOG.warn('import lock', e.message); } } }
  const unlockedIn = [...toLock].filter(id => docFilesOf(id).some(f => !f.locked)).length;
  scheduleRender(); go.disabled = false;
  if (unlockedIn) bad.push(`${unlockedIn} locked document${unlockedIn > 1 ? 's' : ''} got files that are not locked yet — open Money, then "Finish locking" in that document`);
  m.className = bad.length ? 'msg err' : 'msg ok';
  m.textContent = `Imported ${ok} of ${total} files into ${pick.length} documents.` + (bad.length ? ' Not copied: ' + bad.slice(0, 8).join('; ') + (bad.length > 8 ? ` … and ${bad.length - 8} more.` : '') : ' Lock sensitive ones (Aadhaar, PAN…) from each document\'s editor.');
  toast(`Imported ${ok} files.`); renderTidyBtn();
  ImpCheck.set({ at: Date.now(), n: bad.length });
  const keep = [m.className, m.textContent];
  try { await readImport(); } catch (e) {}                                   // the list now shows only what is left
  m.className = keep[0]; m.textContent = keep[1];
}

/* ---------- v2.10: declined files (synced) and the "new files" notice ---------- */
const IMPSKIP_ID = 'import-declined';
const impDeclined = () => new Set(((records[IMPSKIP_ID] && !records[IMPSKIP_ID].deleted && records[IMPSKIP_ID].ids) || []));
function impDecline(ids) {
  if (!ids.length) return;
  const cur = impDeclined(); ids.forEach(i => cur.add(i));
  put({ ...(records[IMPSKIP_ID] || { id: IMPSKIP_ID, type: 'impskip' }), ids: [...cur], deleted: false }, { render: false });
}
function impUndecline() { const r = records[IMPSKIP_ID]; if (r) { r.ids = []; put(r, { render: false }); } }
const ImpCheck = {
  KEY: 'r2_impcheck',
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(this.KEY, JSON.stringify(v)); } catch (e) {} },
  newCount(files) { const P = planImport(files); return P.list.reduce((s, g) => s + g.files.length, 0); },
  async maybe(force) {
    if (window.GHOST) return;
    if (!Sync.on() || !driveOn() || !navigator.onLine) return;
    const c = this.get();
    if (this.busy || (!force && c && (c.off || Date.now() - c.at < 6 * 3600000))) return;   // at most every 6 hours; stays quiet if the script has no Docs folder
    this.busy = true;
    try {
      const d = await Sync.call('driveListImport', {}, 60000);
      this.set({ at: Date.now(), n: this.newCount(d.files || []) });
    } catch (e) { this.set({ at: Date.now(), n: 0, off: /unknown action|IMPORT_FOLDER_ID/.test(e.message || '') }); }
    finally { this.busy = false; }
    if (currentTab === 'docs') renderDocs();
  },
  refresh(files) { this.set({ at: Date.now(), n: this.newCount(files) }); }
};

/* ---------- v2.11: note folder picker (editor and quick add) ---------- */
function folderPick(sel, inp, cur, list, onSet) {
  const fs = [...new Set([...list, cur].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">No folder</option>${fs.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}</option>`).join('')}<option value="__new">＋ New folder…</option>`;
  inp.classList.add('hidden'); inp.value = '';
  sel.onchange = () => { if (sel.value === '__new') { inp.classList.remove('hidden'); inp.focus(); } else { inp.classList.add('hidden'); onSet && onSet(sel.value); } };
  const commit = () => { const v = inp.value.trim(); if (!v) return; folderPick(sel, inp, v, list.concat(v), onSet); onSet && onSet(v); };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
  inp.onblur = commit;
}
const pickedFolder = (sel, inp) => sel.value === '__new' ? inp.value.trim() : sel.value;
function neFolderInit() {
  const n = records[editNoteId]; if (!n) return;
  const list = [...new Set(all(n.type).map(noteFolder).filter(Boolean))];
  folderPick($('neFolder'), $('neFolderNew'), noteFolder(n), list, v => { const x = records[editNoteId]; if (!x || noteFolder(x) === v) return; x.folder = v; put(x, { render: false }); scheduleRender(); toast(v ? 'Moved to ' + v + '.' : 'Removed from folder.'); });
  $('neMic').classList.toggle('hidden', n.type === 'snote');
}

/* ---------- v2.11: voice typing ---------- */
const Dictate = {
  SR: window.SpeechRecognition || window.webkitSpeechRecognition,
  cur: null,
  stop() { if (this.cur) { try { this.cur.rec.stop(); } catch (e) {} } },
  start(el, btn, insert) {
    if (this.cur) { const same = this.cur.btn === btn; this.stop(); if (same) return; }
    if (!this.SR) { toast('Voice typing is not available here — use the 🎤 on the iPhone keyboard instead.', null, null, 6000); return; }
    const rec = new this.SR(); rec.lang = prefs.dictLang || 'en-IN'; rec.continuous = true; rec.interimResults = true;
    const live = btn.closest('.sheet-body') && btn.closest('.sheet-body').querySelector('.mic-live');
    this.cur = { rec, btn }; btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i], txt = r[0].transcript.trim(); if (!txt) continue;
        if (r.isFinal) { const v = el.value, s = el.selectionStart != null ? el.selectionStart : v.length;
          const pre = s > 0 && !/\s$/.test(v.slice(0, s)) ? ' ' : ''; insert(pre + txt); }
        else interim += txt + ' ';
      }
      if (live) live.textContent = interim ? '🎤 ' + interim : '';
    };
    rec.onerror = e => { RLOG.warn('dictation', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone blocked. Allow it for this app (iPhone Settings → Apps → Safari → Microphone), or use the keyboard 🎤.', null, null, 7000);
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice typing stopped (' + e.error + ').'); };
    rec.onend = () => { btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); if (live) live.textContent = ''; if (this.cur && this.cur.rec === rec) this.cur = null; };
    try { rec.start(); } catch (e) { rec.onend(); toast('Could not start voice typing.'); }
  }
};
function insertAtCursor(el, txt) {
  const s = el.selectionStart != null ? el.selectionStart : el.value.length, e = el.selectionEnd != null ? el.selectionEnd : s;
  el.setRangeText(txt, s, e, 'end'); el.dispatchEvent(new Event('input', { bubbles: true }));
}
function addMic(el) {
  if (!el || el.parentElement.classList.contains('has-mic')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'mic-btn'; b.textContent = '🎤'; b.setAttribute('aria-label', 'Speak to type');
  const w = document.createElement('div'); w.className = 'has-mic'; el.parentNode.insertBefore(w, el); w.appendChild(el); w.appendChild(b);
  b.addEventListener('mousedown', e => e.preventDefault());
  b.addEventListener('click', () => Dictate.start(el, b, t => insertAtCursor(el, t)));
}
{ const sc = Sheets.close.bind(Sheets); Sheets.close = (id, silent) => { if (Dictate.cur && $(id) && $(id).contains(Dictate.cur.btn)) Dictate.stop(); return sc(id, silent); }; }

/* ---------- v2.11: scan pages to a PDF ---------- */
const Scan = {
  pages: [], mode: 'doc', docId: null,
  open(docId) {
    this.pages = []; this.docId = docId || null; this.replace = null; if (this.mode === 'orig' && !docId) this.mode = 'doc';
    $('scTitleW').classList.toggle('hidden', !!docId);
    $('scTitle').value = 'Scan ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    $('scMsg').textContent = ''; this.render();
    chipGroup($('scMode'), [{ v: 'doc', l: 'Document' }, { v: 'bw', l: 'Black & white' }, { v: 'orig', l: 'Original' }], this.mode, v => { this.mode = v; this.render(); });
    Sheets.open('shScan');
  },
  async add(files) {
    for (const f of files) {
      try {
        const url = URL.createObjectURL(f), img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
        const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); this.pages.push({ src: c, rot: 0 });
      } catch (e) { toast('That photo could not be read.'); }
    }
    this.render();
  },
  process(p, maxSide) {
    const r = p.rot % 360, sw = p.src.width, sh = p.src.height, k = maxSide ? Math.min(1, maxSide / Math.max(sw, sh)) : 1;
    const w = Math.round(sw * k), h = Math.round(sh * k), c = document.createElement('canvas'), x = c.getContext('2d');
    c.width = r % 180 ? h : w; c.height = r % 180 ? w : h;
    x.translate(c.width / 2, c.height / 2); x.rotate(r * Math.PI / 180); x.drawImage(p.src, -w / 2, -h / 2, w, h); x.setTransform(1, 0, 0, 1, 0, 0);
    if (this.mode !== 'orig') scanFilter(x, c.width, c.height, this.mode);
    return c;
  },
  render() {
    $('scPages').innerHTML = this.pages.map((p, i) => `<div class="scan-page"><img src="${this.process(p, 260).toDataURL('image/jpeg', .7)}" alt="Page ${i + 1}"><button class="sp-b sp-rot" data-sprot="${i}" aria-label="Rotate page ${i + 1}">↻</button><button class="sp-b sp-crop" data-spcrop="${i}" aria-label="Crop page ${i + 1}">✂</button><button class="sp-b sp-del" data-spdel="${i}" aria-label="Remove page ${i + 1}">✕</button><span>${i + 1}</span></div>`).join('');
    $$('[data-sprot]').forEach(b => b.addEventListener('click', () => { this.pages[+b.dataset.sprot].rot += 90; this.render(); }));
    $$('[data-spdel]').forEach(b => b.addEventListener('click', () => { this.pages.splice(+b.dataset.spdel, 1); this.render(); }));
    $$('[data-spcrop]').forEach(b => b.addEventListener('click', () => openCrop(this.pages[+b.dataset.spcrop], () => this.render())));
    $('scSave').disabled = !this.pages.length;
    $('scCount').textContent = this.pages.length ? `${this.pages.length} page${this.pages.length > 1 ? 's' : ''}` : 'No pages yet — tap Add page and take a photo of each page.';
  },
  async save() {
    if (!this.pages.length) return;
    $('scMsg').className = 'msg'; $('scMsg').textContent = 'Making the PDF…';
    await new Promise(r => setTimeout(r, 30));
    const pages = this.pages.map(p => { const c = this.process(p, 2000), d = c.toDataURL('image/jpeg', this.mode === 'orig' ? .82 : .78); return { bytes: unb64(d.slice(d.indexOf(',') + 1)), w: c.width, h: c.height }; });
    const rep1 = this.replace, asImg = rep1 && !isPdf(rep1) && pages.length === 1;
    const file = asImg ? new File([pages[0].bytes], 'photo.jpg', { type: 'image/jpeg' }) : new File([jpegsToPdf(pages)], 'scan.pdf', { type: 'application/pdf' });
    if (file.size > DOCFILE_MAX) { $('scMsg').className = 'msg err'; $('scMsg').textContent = 'Too large for one file — save fewer pages at a time.'; return; }
    let id = this.docId;
    if (!id) {
      const d = put({ id: uid('doc'), type: 'doc', title: $('scTitle').value.trim() || 'Scan', who: docPath.who && docPath.who !== DOC_ME ? docPath.who : '', docType: docNewType(), number: '', expiry: null, issuer: '', notes: '', folder: '', fy: null, deleted: false });
      id = d.id;
    }
    Sheets.close('shScan', true);
    if (!Sheets.isOpen('shDoc') || editDocId !== id) openDoc(id);
    if (rep1 && rep1.fy && $('doFileFy')) $('doFileFy').value = rep1.fy;
    const before = docFilesOf(id).length; await addDocFiles(id, [file]);
    if (rep1 && docFilesOf(id).length > before) { softDelete(rep1.id, { render: false }); setTimeout(() => driveDelete(rep1.fileId), 1500); if (rep1.keyId && records[rep1.keyId]) softDelete(rep1.keyId, { render: false }); renderDocEditFiles(); $('doFileMsg').className = 'msg ok'; $('doFileMsg').textContent = 'Edited file saved; the old one is in Drive\'s Trash.'; }
    this.replace = null;
  }
};
function scanFilter(x, w, h, mode) {
  const im = x.getImageData(0, 0, w, h), p = im.data, n = w * h, g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = .299 * p[i * 4] + .587 * p[i * 4 + 1] + .114 * p[i * 4 + 2];
  if (mode === 'bw') {                                         // adaptive threshold against the local average (handles shadows)
    const I = new Float64Array((w + 1) * (h + 1)), R = Math.max(8, Math.round(Math.min(w, h) / 16));
    for (let y = 0; y < h; y++) { let s = 0; for (let xx = 0; xx < w; xx++) { s += g[y * w + xx]; I[(y + 1) * (w + 1) + xx + 1] = I[y * (w + 1) + xx + 1] + s; } }
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const x0 = Math.max(0, xx - R), x1 = Math.min(w, xx + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      const v = g[y * w + xx] < m * 0.88 ? 0 : 255, j = (y * w + xx) * 4; p[j] = p[j + 1] = p[j + 2] = v;
    }
  } else {                                                     // "Document": grey, stretched so paper is white and ink is dark
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[g[i] | 0]++;
    let lo = 0, hi = 255, acc = 0; for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * .02) break; }
    acc = 0; for (; hi > 0; hi--) { acc += hist[hi]; if (acc > n * .10) break; }
    const span = Math.max(20, hi - lo);
    for (let i = 0; i < n; i++) { let v = (g[i] - lo) / span; v = Math.max(0, Math.min(1, v)); v = Math.pow(v, 1.4) * 255; const j = i * 4; p[j] = p[j + 1] = p[j + 2] = v; }
  }
  x.putImageData(im, 0, 0);
}
/* smallest possible PDF: one JPEG per page, page width A4 (595 pt), height from the photo */
function jpegsToPdf(pages) {
  const te2 = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = b => { if (typeof b === 'string') b = te2.encode(b); parts.push(b); len += b.length; };
  const obj = (id, body) => { offs[id] = len; push(`${id} 0 obj\n${body}\nendobj\n`); };
  push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]));
  const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((pg, i) => {
    const P = 3 + i * 3, W = 595.28, H = +(W * pg.h / pg.w).toFixed(2), cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(P, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${P + 1} 0 R >> >> /Contents ${P + 2} 0 R >>`);
    offs[P + 1] = len; push(`${P + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`);
    push(pg.bytes); push('\nendstream\nendobj\n');
    obj(P + 2, `<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`);
  });
  const total = 3 + n * 3, x0 = len;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`; for (let i = 1; i < total; i++) xref += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(xref + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${x0}\n%%EOF\n`);
  const out = new Uint8Array(len); let o = 0; parts.forEach(b => { out.set(b, o); o += b.length; }); return out;
}
$('scAdd').addEventListener('click', () => $('scFile').click());
$('scFile').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) Scan.add(f); });
$('scPick').addEventListener('click', () => $('scFile2').click());
$('scFile2').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) Scan.add(f); });
$('scSave').addEventListener('click', () => Scan.save().catch(e => { RLOG.error('scan', e); $('scMsg').className = 'msg err'; $('scMsg').textContent = 'Could not make the PDF: ' + e.message; }));
$('doScanBtn').addEventListener('click', () => Scan.open(editDocId));
$('docScanBtn').addEventListener('click', () => Scan.open(null));

/* ---------- v2.11: clean imported originals out of the Docs folder (Code.gs v19) ---------- */
const tidyList = () => all('docfile').filter(f => f.srcId && f.srcId !== f.fileId && !f.srcGone && records[f.docId] && !records[f.docId].deleted);
async function tidyImported() {
  const L = tidyList(), m = $('impMsg');
  if (!L.length) { toast('Nothing to clean — no imported originals are left in the Docs folder.'); return; }
  if (!confirm(`Remove ${L.length} files from your Docs folder that are already in Register?\n\nOnly files Register has a copy of are touched. They go to Google Drive's Trash (recoverable for 30 days).`)) return;
  let gone = 0, miss = 0; const bad = [];
  for (let i = 0; i < L.length; i += 50) {
    const batch = L.slice(i, i + 50);
    m.className = 'msg'; m.textContent = `Cleaning ${Math.min(i + batch.length, L.length)} of ${L.length}…`;
    let res;
    try { res = await Sync.call('driveTidyImport', { ids: batch.map(f => f.srcId) }, 300000); }
    catch (e) { m.className = 'msg err'; m.textContent = /unknown action/.test(e.message) ? 'Your Apps Script is older than v19. Paste Code.gs v19 and redeploy.' : e.message; return; }
    (res.done || []).forEach(r => { const f = batch.find(x => x.srcId === r.id); if (!f) return;
      if (r.ok || r.missing) { f.srcGone = true; put(f, { render: false }); r.ok ? gone++ : miss++; } else bad.push(f.name + ': ' + (r.error || 'refused')); });
  }
  m.className = bad.length ? 'msg err' : 'msg ok';
  m.textContent = `Moved ${gone} file${gone === 1 ? '' : 's'} to Drive's Trash${miss ? `, ${miss} were already gone` : ''}.` + (bad.length ? ' Not touched: ' + bad.slice(0, 6).join('; ') : '');
  renderTidyBtn();
}
function renderTidyBtn() { const b = $('impTidy'); if (!b) return; const n = tidyList().length; b.classList.toggle('hidden', !n); b.textContent = `🧹 Remove ${n} already-imported file${n === 1 ? '' : 's'} from the Docs folder`; }

/* ---------- v2.11: Face ID helpers ---------- */
async function bioDiag() {
  const out = [];
  if (!window.PublicKeyCredential) return 'This browser has no passkey support.';
  try { if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) out.push('No Face ID / Touch ID / Windows Hello found on this device.'); } catch (e) {}
  try { if (PublicKeyCredential.getClientCapabilities) { const c = await PublicKeyCredential.getClientCapabilities(); if (c && c['extension:prf'] === false) out.push('This browser cannot do passkey PRF (needs iOS 18+ Safari / home-screen app).'); } } catch (e) {}
  return out.join(' ');
}
$('neMic').addEventListener('click', () => Dictate.start(ta(), $('neMic'), txt => insertText(txt)));
addMic($('teNotes'));

/* ==========================================================================
   v2.12
   ======================================================================== */
/* ---------- ghost app (decoy → Retry twice): empty Register, every save "crashes" ---------- */
function ghostCrash(force) {
  const ua = navigator.userActivation;
  if (!force && ua && !ua.isActive) return;
  $('ghostErr').classList.remove('hidden');
}
$('ghostOk').addEventListener('click', () => $('ghostErr').classList.add('hidden'));
function enterGhost() {
  window.GHOST = true;
  Sheets.closeAll(); addDraft = null;
  if (!$('lightbox').classList.contains('hidden')) $('lbClose').click(); $('toast') && $('toast').classList.remove('show');
  document.documentElement.classList.remove('decoy-on');
  $('decoy').classList.add('hidden'); $('decoy').setAttribute('aria-hidden', 'true'); $('app').removeAttribute('aria-hidden');
  try { if (navigator.setAppBadge) navigator.clearAppBadge(); } catch (e) {}
  showTab('tasks'); renderAll();
}
{ let taps = [];
  $('decoyRetry').addEventListener('click', () => { const n = Date.now(); taps = taps.filter(x => n - x < 8000); taps.push(n); if (taps.length >= 2) { taps = []; setTimeout(enterGhost, 1600); } }); }

/* ---------- Recently deleted ---------- */
const BIN_TYPES = { inbox: 'Inbox item', task: 'Task', note: 'Note', date: 'Date', doc: 'Document', docfile: 'File', snote: 'Private note', fin: 'Money entry' };
function binItemsBase() {
  if (window.GHOST) return [];
  const cutoff = nowMs() - 30 * 86400000;
  return Object.values(records).filter(r => r.deleted && r.deletedAt && r.deletedAt > cutoff && BIN_TYPES[r.type] && (!SEALED_TYPES.has(r.type) || finUnlocked())
    && !(r.type === 'docfile' && (!records[r.docId] || records[r.docId].deleted))).sort((a, b) => b.deletedAt - a.deletedAt);
}
function binLabel(r) {
  if (r.type === 'catbin') return catbinLabel(r);
  if (r.type === 'docfile') { const d = records[r.docId]; return `${esc(r.name || 'file')}<small class="muted"> · from ${esc(d ? d.title : 'a document')}</small>`; }
  if (r.type === 'doc') { const n = docFilesOf(r.id).length; return `${esc(r.title)}<small class="muted"> · ${esc(docOwners(r).join(' & '))}${n ? ` · 📎 ${n}` : ''}</small>`; }
  if (r.type === 'fin') return esc((r.desc || 'Entry') + ' · ' + rs(r.amount));
  return esc(r.title || r.label || r.desc || '(untitled)');
}
function openBin() {
  const L = binItems();
  $('binList').innerHTML = L.length ? L.map(r => { const left = Math.max(1, 30 - Math.floor((nowMs() - r.deletedAt) / 86400000));
    return `<div class="chk-row"><span class="pill">${BIN_TYPES[r.type]}</span><div class="row-main"><div class="row-title">${binLabel(r)}</div><div class="row-sub">deleted ${timeAgo(r.deletedAt)} · ${left} day${left > 1 ? 's' : ''} left</div></div>
      <button class="btn small ghost" data-binr="${r.id}">Restore</button><button class="icon-btn" data-bind="${r.id}" aria-label="Delete now" style="width:34px;height:34px;font-size:14px">✕</button></div>`; }).join('')
    : '<div class="empty">Nothing deleted in the last 30 days.</div>';
  $$('[data-binr]', $('binList')).forEach(b => b.addEventListener('click', () => binRestore(b.dataset.binr)));
  $$('[data-bind]', $('binList')).forEach(b => b.addEventListener('click', () => { if (confirm('Delete this for good? Its files in Drive go to Drive\'s Trash.')) { purgeNow([b.dataset.bind]); openBin(); } }));
  $('binEmpty').classList.toggle('hidden', !L.length);
  Sheets.open('shBin');
}
function binRestoreOld(id) {
  const r = records[id]; if (!r) return;
  restore(id);
  if (r.type === 'docfile') { if (r.keyId && records[r.keyId] && records[r.keyId].deleted) restore(r.keyId); if (Sync.on()) Sync.call('driveRestore', { fileId: r.fileId }).catch(() => {}); }
  if (r.type === 'fin' || r.type === 'snote') scheduleRender();
  toast('Restored.'); openBin();
}
async function purgeNowOld(ids) {
  ids.forEach(id => { const r = records[id]; if (!r) return;
    if (r.type === 'docfile' && r.fileId) driveDelete(r.fileId);
    if (r.type === 'doc') all('docfile').forEach(f => { if (f.docId === id) { driveDelete(f.fileId); softDelete(f.id, { render: false }); } });
    r.deletedAt = 1; put(r, { render: false }); });
  ids.forEach(id => { delete records[id]; delete sealed[id]; });
  storeVer++;
  try { await DB.delMany(ids); } catch (e) {}
  scheduleRender();
}
$('binEmpty').addEventListener('click', () => { const L = binItems(); if (L.length && confirm(`Delete all ${L.length} items for good?`)) { purgeNow(L.map(r => r.id)); openBin(); } });
$('setBin').addEventListener('click', () => { Sheets.close('shSettings', true); openBin(); });
$('trashOpen').addEventListener('click', openBin);

/* ---------- share several documents ---------- */
let docSel = null, shareTitle = null;
function toggleDocSel(id) { if (!docSel) return; docSel.has(id) ? docSel.delete(id) : docSel.add(id); renderDocs(); }
function renderSelBarBase() {
  const bar = $('docSelBar'); bar.classList.toggle('hidden', !docSel);
  $('docSelBtn').textContent = docSel ? '✕ Stop selecting' : '☑ Select';
  if (!docSel) return;
  const n = docSel.size, files = [...docSel].reduce((s, id) => s + docFilesOf(id).length, 0);
  $('docSelN').textContent = n ? `${n} document${n > 1 ? 's' : ''} · ${files} file${files === 1 ? '' : 's'}` : 'Tap documents to pick';
  $('docSelShare').disabled = !files;
}
$('docSelBtn').addEventListener('click', () => { docSel = docSel ? null : new Set(); renderDocs(); });
$('docSelCancel').addEventListener('click', () => { docSel = null; renderDocs(); });
$('docSelShare').addEventListener('click', () => {
  const ids = [...docSel], docs = ids.map(id => records[id]).filter(Boolean), fs = ids.flatMap(id => docFilesOf(id));
  const who = [...new Set(docs.flatMap(docOwners))];
  shareTitle = `${who.join(' & ')} - ${docs.slice(0, 3).map(d => d.title).join(', ')}${docs.length > 3 ? ` +${docs.length - 3}` : ''}`.slice(0, 80);
  $('dsFiles').innerHTML = fs.map(f => { const d = records[f.docId]; return `<label class="switch-row"><span>${f.locked ? '🔒 ' : ''}${esc(d.title)}<small class="dq-sub">${esc(docOwners(d).join(' & '))} · ${esc(f.name)}${f.fy ? ' · FY ' + f.fy : ''}</small></span><input type="checkbox" class="sw" data-dsf="${f.id}" checked></label>`; }).join('');
  $('dsWm').checked = false; $('dsText').value = ''; $('dsTextWrap').classList.add('hidden');
  resetShare(); dsModeInit(fs.length); Sheets.open('shDocShare');
});
function dsModeInit(n) {
  $('dsModeW').classList.toggle('hidden', n < 2); AF_DS.mode = 'sep';
  chipGroup($('dsMode'), [{ v: 'sep', l: 'Separate files' }, { v: 'one', l: 'One PDF' }], 'sep', v => { AF_DS.mode = v; resetShare(); });
}
const AF_DS = { mode: 'sep' };
async function mergeToPdf(files, name) {
  try { await loadScript(PDFLIB_URL); } catch (e) { throw new Error('the PDF tool ' + e.message); }
  const { PDFDocument } = window.PDFLib, out = await PDFDocument.create(), skipped = [];
  for (const f of files) {
    try {
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        const src = await PDFDocument.load(await f.arrayBuffer());
        (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
      } else {
        let bytes = new Uint8Array(await f.arrayBuffer()), img;
        if (/png/i.test(f.type)) img = await out.embedPng(bytes);
        else if (/jpe?g/i.test(f.type)) img = await out.embedJpg(bytes);
        else { const c = await blobToJpeg(f); img = await out.embedJpg(c); }
        const W = 595.28, H = W * img.height / img.width, p = out.addPage([W, H]); p.drawImage(img, { x: 0, y: 0, width: W, height: H });
      }
    } catch (e) { skipped.push(f.name + (/encrypt/i.test(e.message || '') ? ' (password-protected)' : '')); }
  }
  if (!out.getPageCount()) throw new Error('none of the files could be combined');
  return { file: new File([await out.save()], name.replace(/[\\/:*?"<>|]/g, '-') + '.pdf', { type: 'application/pdf' }), skipped };
}
async function blobToJpeg(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('not a picture')); i.src = url; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
    const d = c.toDataURL('image/jpeg', .9); return unb64(d.slice(d.indexOf(',') + 1)); } finally { URL.revokeObjectURL(url); }
}

/* ---------- monthly check: every Register file still in Drive (Code.gs v20) ---------- */
const DriveChk = {
  KEY: 'r2_drivechk', busy: false,
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(this.KEY, JSON.stringify(v)); } catch (e) {} },
  files() { return all('docfile').filter(f => f.fileId && records[f.docId] && !records[f.docId].deleted); },
  bad() { const c = this.get(); return ((c && c.bad) || []).filter(b => records[b.id] && !records[b.id].deleted && records[records[b.id].docId] && !records[records[b.id].docId].deleted); },
  async run(manual) {
    if (window.GHOST) return;
    if (!Sync.on() || !driveOn()) { if (manual) toast('Connect the Sheet and Drive folder first (Settings).'); return; }
    if (!navigator.onLine) { if (manual) toast('You are offline.'); return; }
    if (this.busy) return; this.busy = true;
    const fs = this.files(), bad = []; let err = null;
    try {
      for (let i = 0; i < fs.length; i += 100) {
        const b = fs.slice(i, i + 100);
        if (manual && $('dcMsg')) { $('dcMsg').className = 'msg'; $('dcMsg').textContent = `Checking ${Math.min(i + b.length, fs.length)} of ${fs.length}…`; }
        const r = await Sync.call('driveCheck', { ids: b.map(f => f.fileId) }, 180000);
        (r.states || []).forEach(s => { if (s.st !== 'ok') b.filter(f => f.fileId === s.id).forEach(f => bad.push({ id: f.id, st: s.st })); });
      }
    } catch (e) { err = e; }
    this.busy = false;
    if (err) { const old = /unknown action/.test(err.message || ''); this.set({ at: old ? Date.now() : Date.now() - 29 * 86400000, bad: (this.get() || {}).bad || [], old });
      if (manual) { const m = old ? 'Your Apps Script is older than v20. Paste Code.gs v20 and redeploy.' : 'Check failed: ' + err.message; if ($('dcMsg')) { $('dcMsg').className = 'msg err'; $('dcMsg').textContent = m; } else toast(m); } return; }
    this.set({ at: Date.now(), n: fs.length, bad });
    if (manual) { if (Sheets.isOpen('shDriveChk')) renderDriveChk(); else toast(bad.length ? `${bad.length} file${bad.length > 1 ? 's' : ''} need attention — see Docs.` : `All ${fs.length} files are in Drive.`); }
    if (currentTab === 'docs') renderDocs();
  },
  maybe() { const c = this.get(); if (!c || (!c.old && Date.now() - c.at > 30 * 86400000) || (c.old && Date.now() - c.at > 7 * 86400000)) { if (!this.sched) { this.sched = true; setTimeout(() => { this.sched = false; this.run(false); }, 4000); } } }
};
const DC_SAY = { trash: 'In Drive\'s Trash', missing: 'Deleted from Drive (gone for good)', outside: 'Moved out of the Register folder' };
function renderDriveChkNote() {
  const box = $('docChkNote'); if (!box) return;
  const n = DriveChk.bad().length;
  box.innerHTML = n ? `<button class="imp-note" id="docChkGo" style="border-left:4px solid var(--seal)"><span>⚠︎ <b>${n} file${n > 1 ? 's' : ''}</b> missing from Drive</span><b>Review ›</b></button>` : '';
  if ($('docChkGo')) $('docChkGo').addEventListener('click', openDriveChk);
  DriveChk.maybe();
}
function openDriveChk() { $('dcMsg').textContent = ''; renderDriveChk(); Sheets.open('shDriveChk'); }
function renderDriveChk() {
  const c = DriveChk.get(), L = DriveChk.bad();
  $('dcMsg').className = 'msg' + (L.length ? '' : ' ok');
  $('dcMsg').textContent = c ? `Last checked ${timeAgo(c.at)}${c.n != null ? ` · ${c.n} files` : ''}. ${L.length ? L.length + ' need attention.' : 'All files found.'}` : 'Not checked yet — tap Check again.';
  $('dcList').innerHTML = L.map(b => { const f = records[b.id], d = records[f.docId];
    return `<div class="chk-row"><div class="row-main"><div class="row-title">${esc(d.title)} <span class="muted">· ${esc(docOwners(d).join(' & '))}</span></div><div class="row-sub"><span>${esc(f.name)}</span><span class="warn">${DC_SAY[b.st] || b.st}</span></div></div>
      ${b.st === 'trash' ? `<button class="btn small" data-dcr="${f.id}">Restore</button>` : `<button class="btn small ghost" data-dco="${d.id}">Open</button>`}</div>`; }).join('');
  $$('[data-dcr]', $('dcList')).forEach(b => b.addEventListener('click', async () => {
    const f = records[b.dataset.dcr]; b.disabled = true;
    try { const r = await Sync.call('driveRestore', { fileId: f.fileId }); if (r.error) throw new Error(r.error); toast('Restored from Drive\'s Trash.'); DriveChk.set({ ...DriveChk.get(), bad: DriveChk.bad().filter(x => x.id !== f.id) }); renderDriveChk(); renderDocs(); }
    catch (e) { b.disabled = false; toast(/unknown action/.test(e.message) ? 'Update the Apps Script to v20.' : 'Could not restore: ' + e.message); }
  }));
  $$('[data-dco]', $('dcList')).forEach(b => b.addEventListener('click', () => { Sheets.close('shDriveChk', true); openDoc(b.dataset.dco); }));
}
$('dcRun').addEventListener('click', () => DriveChk.run(true));
$('setDriveChk').addEventListener('click', () => { Sheets.close('shSettings', true); openDriveChk(); DriveChk.run(true); });

/* ---------- Ask (offline answers from your own data; nothing leaves the phone) ---------- */
const ASK_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function askRange(q, future) {
  const t = todayISO(), ym = t.slice(0, 7), mEnd = m => monthEnd(m), mk = (from, to, label) => ({ from, to, label });
  let m;
  if (/\btoday\b|\baaj\b/.test(q)) return mk(t, t, 'today');
  if (/\btomorrow\b|\bkal\b/.test(q)) return mk(addDays(1), addDays(1), 'tomorrow');
  if ((m = q.match(/\b(?:next|coming|in)\s+(\d{1,3})\s+days?\b/))) return mk(t, addDays(+m[1]), `the next ${m[1]} days`);
  if (/\bthis week\b/.test(q)) return future === false ? mk(addDays(-6), t, 'the last 7 days') : mk(t, addDays(6), 'the next 7 days');
  if (/\bnext week\b/.test(q)) return mk(addDays(7), addDays(13), 'next week');
  if (/\bthis month\b/.test(q)) return mk(ym + '-01', mEnd(ym), monthLong(ym));
  if (/\bnext month\b/.test(q)) { const n = monthAdd(ym, 1); return mk(n + '-01', mEnd(n), monthLong(n)); }
  if (/\blast month\b|\bprevious month\b/.test(q)) { const n = monthAdd(ym, -1); return mk(n + '-01', mEnd(n), monthLong(n)); }
  if ((m = q.match(/\bfy\s*(\d{2,4})\s*-\s*(\d{2})\b/))) { const s = +m[1] < 100 ? 2000 + +m[1] : +m[1]; return mk(s + '-04-01', (s + 1) + '-03-31', `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`); }
  if (/\b(this|current) (fy|financial year)\b/.test(q)) { const f = fyOf(t), s = +f.slice(0, 4); return mk(s + '-04-01', (s + 1) + '-03-31', 'FY ' + f); }
  if (/\b(last|previous) (fy|financial year)\b/.test(q)) { const s = +fyOf(t).slice(0, 4) - 1; return mk(s + '-04-01', (s + 1) + '-03-31', `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`); }
  if (/\bthis year\b/.test(q)) { const y = t.slice(0, 4); return mk(y + '-01-01', y + '-12-31', y); }
  for (let i = 0; i < 12; i++) {
    if (i === 4 && !/\b(in|of|during|since|till|until|by|for)\s+may\b|\bmay\s+\d{4}\b/.test(q)) continue;      // "may" is usually not the month
    const re = new RegExp('\\b(' + ASK_MONTHS[i] + '|' + ASK_MONTHS[i].slice(0, 3) + ')\\b(?:\\s+(\\d{4}))?');
    if ((m = q.match(re))) {
      let y = m[2] ? +m[2] : +t.slice(0, 4); const mm = String(i + 1).padStart(2, '0');
      if (!m[2]) { if (future === true && `${y}-${mm}` < ym) y++; if (future === false && `${y}-${mm}` > ym) y--; }   // null: this year's month
      const k = `${y}-${mm}`; return mk(k + '-01', mEnd(k), monthLong(k));
    }
  }
  if (/\b(upcoming|coming up|coming|soon|next)\b/.test(q)) return mk(t, addDays(30), 'the next 30 days');
  return null;
}
const ASK_STOP = new Set('when what which how much many who whom is are was were the a an of in on for my me i did do does will to from list show all any there have has had due expire expires expired expiry expiring renew renewal valid validity date dates this next last month week year years today tomorrow days day upcoming coming up s spent spend spending expense expenses income earned received total balance balances owe owes owed udhaar documents document docs doc file files birthday birthdays anniversary anniversaries task tasks todo note notes fy financial get got pay paid overdue pending open still left kab kitna ka ki ke hai and or with by at be it its his her their our we you your'.split(' '));
function askPeople(q) {
  const out = new Set(), known = docPeople().map(p => p.toLowerCase());
  q.split(/[^a-z]+/).forEach(w => { if (!w) return; if (PERSON_ALIAS[w]) out.add(PERSON_ALIAS[w]); else if (known.includes(w)) out.add(w.charAt(0).toUpperCase() + w.slice(1)); });
  return [...out];
}
const inRange = (iso, R) => !R || (iso >= R.from && iso <= R.to);
const daysTo = iso => Math.round((new Date(iso + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
const inDays = n => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : n < 60 ? `in ${n} days` : n < 730 ? `in ${Math.round(n / 30.4)} months` : `in ${(n / 365.25).toFixed(1)} years`;
function askAnswer(raw) {
  const q = ' ' + raw.toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence').replace(/[?.!,']/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const isQ = /^ (when|what|which|how|who|list|show|any|is|are|do|does|did|total|kab|kitna|kitne|kya)\b/.test(q);
  const has = re => re.test(q);
  if (!isQ && !has(/\b(expire|expiry|expiring|birthdays?|anniversar\w*|spent|spend|income|owes?|udhaar|balance|overdue|upcoming|coming up)\b/)) return null;
  const who = askPeople(q), words = q.trim().split(' ').filter(w => w.length > 1 && !ASK_STOP.has(w) && !PERSON_ALIAS[w] && !who.some(p => p.toLowerCase() === w) && !/^\d+$/.test(w) && !ASK_MONTHS.includes(w) && !ASK_MONTHS.some(m => m.slice(0, 3) === w));
  const ans = (text, items) => ({ text, items: items || [] });
  const docHay = d => (d.title + ' ' + d.docType + ' ' + docGroup(d) + ' ' + d.issuer).toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence');
  const whoOk = d => !who.length || docOwners(d).some(p => who.includes(p));
  const dItem = d => ({ k: 'Doc', id: d.id, t: esc(d.title) + ' · <b>' + esc(docOwners(d).join(' & ')) + '</b>', s: d.expiry ? fmtDate(d.expiry, true) : '' });
  // ----- money (only with Money open) -----
  if (has(/\b(spent|spend|spending|expenses?|income|earned|received|salary|owes?|owed|udhaar|balance|balances|savings?)\b/)) {
    if (!finUnlocked()) return ans('Open Money with your private code first — then ask again.');
    if (has(/\b(owes?|owed|udhaar)\b/)) {
      const names = [...who.flatMap(p => [p, ...Object.keys(PERSON_ALIAS).filter(k => PERSON_ALIAS[k] === p)]), ...words].map(w => w.toLowerCase());   // "Moni" finds entries saved as Ruchi, and the other way round
      const hitWho = s => { s = String(s || '').toLowerCase(); return names.some(w => s.split(/[^a-z0-9]+/).includes(w) || (w.length > 3 && s.includes(w))); };
      const L = all('fin').filter(e => isUdhaar(e.kind) && !e.settled && outstanding(e) > 0 && (!names.length || hitWho(e.who)));
      if (!L.length) return ans('No open udhaar' + (who.length || words.length ? ' for ' + [...who, ...words].join(', ') : '') + '.');
      const by = {}; L.forEach(e => { const k = e.who || '—'; by[k] = (by[k] || 0) + (e.kind === 'lent' ? 1 : -1) * outstanding(e); });
      return ans(Object.entries(by).map(([p, v]) => v >= 0 ? `${p} owes you ${rs(v)}` : `You owe ${p} ${rs(-v)}`).join('\n'), L.slice(0, 12).map(e => ({ k: '₹', id: e.id, t: esc(e.desc || 'Udhaar') + ' · ' + esc(e.who || ''), s: rs(outstanding(e)) })));
    }
    if (has(/\bsavings?\b/) && !has(/\bbalances?\b/)) {
      const R = askRange(q, false) || (() => { const ym = todayISO().slice(0, 7); return { from: ym + '-01', to: monthEnd(ym), label: monthLong(ym) }; })();
      const F = all('fin').filter(e => inRange(e.date || '', R)), s = k => F.filter(e => e.kind === k && (k !== 'expense' || e.category !== 'Investment')).reduce((t, e) => t + (+e.amount || 0), 0);
      const i = s('income'), x = s('expense');
      return ans(`${R.label}: income ${rs(i)} − spending ${rs(x)} = ${i - x >= 0 ? 'saved' : 'overspent'} ${rs(Math.abs(i - x))} (Ledger entries only).`);
    }
    if (has(/\bbalances?\b/)) {
      const c = planCfg(); if (!c || !accts().length) return ans('Set up Money → Accounts first.');
      const R = askRange(q, null), B = balancesOn(c, R ? R.to : todayISO());
      const L = accts(true).filter(a => !words.length || words.some(w => a.name.toLowerCase().includes(w)));
      if (!L.length) return ans(`No account matches "${words.join(' ')}".`);
      return ans(L.map(a => `${a.name}: ${rs(B.accts[a.id] || 0)}`).join('\n') + `\n(${B.label})`);
    }
    const inc = has(/\b(income|earned|received|salary)\b/), R = askRange(q, false) || (() => { const ym = todayISO().slice(0, 7); return { from: ym + '-01', to: monthEnd(ym), label: monthLong(ym) }; })();
    const cat = FIN_CATS.find(c => words.includes(c.toLowerCase()) || (c === 'Food' && words.some(w => /food|khana|grocer/.test(w))));
    const rest = words.filter(w => !cat || w !== cat.toLowerCase());
    const L = all('fin').filter(e => e.kind === (inc ? 'income' : 'expense') && inRange(e.date || '', R) && (!cat || e.category === cat) && (cat || !rest.length || rest.some(w => (String(e.desc || '') + ' ' + (e.who || '')).toLowerCase().includes(w))));
    const sum = L.reduce((s, e) => s + (+e.amount || 0), 0);
    return ans(`${inc ? 'Received' : 'Spent'} ${rs(sum)}${cat ? ' on ' + cat : rest.length ? ' on "' + rest.join(' ') + '"' : ''} in ${R.label} — ${L.length} entr${L.length === 1 ? 'y' : 'ies'} in the Ledger.`,
      L.sort((a, b) => b.amount - a.amount).slice(0, 12).map(e => ({ k: '₹', id: e.id, t: esc(e.desc || e.category || 'Entry'), s: rs(e.amount) + ' · ' + fmtDate(e.date) })));
  }
  // ----- document expiry -----
  if (has(/\b(expire|expires|expired|expiry|expiring|renew|renewal|valid|validity)\b/)) {
    const R = askRange(q, true);
    let L = all('doc').filter(d => whoOk(d) && (!words.length || words.some(w => docHay(d).includes(w))));
    const noDate = L.filter(d => !d.expiry && words.length);
    L = L.filter(d => d.expiry && (R ? inRange(d.expiry, R) : true)).sort((a, b) => a.expiry.localeCompare(b.expiry));
    if (!L.length && !noDate.length) return ans(`Nothing ${R ? 'expires in ' + R.label : 'with an expiry date'}${who.length ? ' for ' + who.join(', ') : ''}${words.length ? ' matching "' + words.join(' ') + '"' : ''}.`);
    const lines = L.slice(0, 8).map(d => { const n = daysTo(d.expiry); return `${docOwners(d).join(' & ')}'s ${d.title} ${n < 0 ? 'expired' : 'expires'} on ${fmtDate(d.expiry, true)} (${inDays(n)})`; });
    if (noDate.length) lines.push(`No expiry date saved for: ${noDate.slice(0, 5).map(d => docOwners(d).join(' & ') + "'s " + d.title).join(', ')}`);
    if (L.length > 8) lines.push(`…and ${L.length - 8} more below.`);
    return ans(lines.join('\n'), [...L, ...noDate].slice(0, 20).map(dItem));
  }
  // ----- dates: birthdays, anniversaries, anything coming up -----
  const wantBday = has(/\bbirthdays?\b|\bjanamdin\b/), wantAnn = has(/\banniversar\w*\b/);
  if (wantBday || wantAnn || has(/\b(upcoming|coming up|dates?)\b/)) {
    const R = askRange(q, true) || (who.length || words.length ? null : { from: todayISO(), to: addDays(30), label: 'the next 30 days' });
    let L = all('date').filter(d => d.when).map(d => ({ d, w: isoLocal(nextOccurrence(d)) }));
    if (wantBday) L = L.filter(x => dateCat(x.d) === 'birthday'); else if (wantAnn) L = L.filter(x => dateCat(x.d) === 'anniv');
    if (who.length) L = L.filter(x => who.some(p => x.d.label.toLowerCase().includes(p.toLowerCase()) || (p === 'Rahul' && /\b(my|rk)\b/i.test(x.d.label))));
    if (words.length) L = L.filter(x => words.some(w => x.d.label.toLowerCase().includes(w)) || who.length);
    L = L.filter(x => inRange(x.w, R)).sort((a, b) => a.w.localeCompare(b.w));
    const unset = all('date').filter(d => !d.when && (!wantBday || dateCat(d) === 'birthday') && who.some(p => d.label.toLowerCase().includes(p.toLowerCase())));
    if (!L.length) return ans(unset.length ? `The date is not filled in yet for: ${unset.map(d => d.label).join(', ')}.` : `Nothing${R ? ' in ' + R.label : ''}${who.length ? ' for ' + who.join(', ') : ''}.`, unset.map(d => ({ k: 'Date', id: d.id, t: esc(d.label), s: 'set the date' })));
    return ans(L.slice(0, 10).map(x => { const n = daysTo(x.w), age = dateAge(x.d, x.w); return `${x.d.label} — ${fmtDate(x.w, true)} (${inDays(n)})${age ? ', ' + age : ''}`; }).join('\n'),
      L.slice(0, 20).map(x => ({ k: 'Date', id: x.d.id, t: esc(x.d.label), s: fmtDate(x.w) })));
  }
  // ----- tasks -----
  if (has(/\b(tasks?|to-?dos?|overdue|pending)\b/)) {
    const R = askRange(q, true);
    let L = all('task').filter(t => t.status !== 'done');
    if (has(/\boverdue\b/)) L = L.filter(isOverdue); else if (R) L = L.filter(t => t.dueDate && inRange(t.dueDate, R));
    if (words.length) L = L.filter(t => words.some(w => (t.title + ' ' + (t.category || '')).toLowerCase().includes(w)));
    L.sort((a, b) => String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')));
    return ans(`${L.length} open task${L.length === 1 ? '' : 's'}${has(/\boverdue\b/) ? ' overdue' : R ? ' due in ' + R.label : ''}.`, L.slice(0, 20).map(t => ({ k: 'Task', id: t.id, t: esc(t.title), s: t.dueDate ? fmtDate(t.dueDate) : '' })));
  }
  // ----- documents: counts, missing files, not locked -----
  if (has(/\b(documents?|docs?|files?)\b/)) {
    let L = all('doc').filter(whoOk);
    if (has(/\b(no|without|missing) (file|files|attachment)\b/)) { L = L.filter(d => !docFilesOf(d.id).length); return ans(`${L.length} document${L.length === 1 ? ' has' : 's have'} no file attached${who.length ? ' for ' + who.join(', ') : ''}.`, L.slice(0, 30).map(dItem)); }
    if (has(/\b(not locked|unlocked)\b/)) { L = L.filter(d => d.docType === 'Identity' && docFilesOf(d.id).length && !d.lockFiles); return ans(`${L.length} ID document${L.length === 1 ? ' is' : 's are'} not locked.`, L.slice(0, 30).map(dItem)); }
    if (words.length) L = L.filter(d => words.some(w => docHay(d).includes(w)));
    const by = {}; L.forEach(d => { const g = docGroup(d); by[g] = (by[g] || 0) + 1; });
    return ans(`${L.length} document${L.length === 1 ? '' : 's'}${who.length ? ' for ' + who.join(', ') : ''}${words.length ? ' matching "' + words.join(' ') + '"' : ''}: ${Object.entries(by).map(([g, n]) => g + ' ' + n).join(', ') || '—'}.`, L.slice(0, 20).map(dItem));
  }
  if (has(/\bnotes?\b/)) {
    let L = all('note'); if (words.length) L = L.filter(n => words.some(w => (n.title + ' ' + n.text + ' ' + (n.folder || '')).toLowerCase().includes(w)));
    return ans(`${L.length} note${L.length === 1 ? '' : 's'}${words.length ? ' about "' + words.join(' ') + '"' : ''}.`, L.slice(0, 20).map(n => ({ k: 'Note', id: n.id, t: esc(n.title || 'Untitled'), s: n.folder || '' })));
  }
  return isQ ? ans('I can answer things like:\n• When does Ruchi\'s passport expire?\n• Birthdays this month · What is coming up next week?\n• How much did I spend on food in August? · Who owes me udhaar?\n• Which documents have no file? · Overdue tasks') : null;
}

/* ---------- Dates: categories, badge, Calendar ---------- */
const DATE_CATS = [['birthday', 'Birthdays', '🎂'], ['anniv', 'Anniversaries', '💍'], ['remember', 'Death anniversaries', '🪔'], ['docexp', 'Document expiry', '🪪'],
  ['insurance', 'Insurance & premiums', '🛡'], ['vehicle', 'Vehicle', '🚗'], ['tax', 'Tax deadlines', '🧾'], ['bank', 'Bank & investments', '🏦'],
  ['subs', 'Subscriptions & renewals', '🔁'], ['home', 'Home & property', '🏠'], ['health', 'Health', '🩺'], ['kids', 'Children & school', '🎒'],
  ['office', 'Office', '🏛'], ['exams', 'Exams & applications', '📝'], ['travel', 'Travel', '✈️'], ['festival', 'Festivals', '🎉'],
  ['govt', 'Government & IDs', '📜'], ['warranty', 'Warranties', '🧰'], ['member', 'Memberships', '🏋'], ['goals', 'Personal & goals', '🎯'], ['other', 'Other', '📌']];
const DATE_SEEDS = {
  anniv: [['Marriage anniversary — Rahul & Ruchi', 'yearly'], ['Marriage anniversary — Papa & Mummy', 'yearly']],
  insurance: [['Car insurance renewal', 'yearly'], ['Health insurance renewal', 'yearly'], ['LIC premium', 'yearly'], ['Term insurance premium', 'yearly']],
  vehicle: [['PUC renewal', 'once'], ['Car service', 'once'], ['Two-wheeler insurance renewal', 'yearly']],
  tax: [['ITR filing last date', 'yearly'], ['Advance tax — June instalment', 'yearly'], ['Advance tax — September instalment', 'yearly'], ['Advance tax — December instalment', 'yearly'], ['Advance tax — March instalment', 'yearly'], ['Form 16 from office', 'yearly'], ['Tax-saving proofs to office', 'yearly']],
  bank: [['FD maturity', 'once'], ['PPF yearly deposit', 'yearly'], ['Bank KYC update', 'once'], ['Locker rent', 'yearly']],
  subs: [['Mobile recharge', 'monthly'], ['Broadband renewal', 'once'], ['OTT subscription', 'yearly'], ['Cloud storage / domain renewal', 'yearly']],
  home: [['Rent agreement renewal', 'once'], ['Property tax', 'yearly'], ['Society maintenance', 'monthly']],
  health: [['Annual health check-up', 'yearly'], ['Dental check-up', 'once'], ['Eye check-up', 'once'], ['CGHS card renewal', 'once']],
  kids: [['School fees', 'once'], ['School admission', 'once'], ['School exams', 'once'], ['Child vaccination', 'once']],
  office: [['APAR / self-appraisal', 'yearly'], ['Annual property return (IPR)', 'yearly'], ['Annual increment', 'yearly']],
  exams: [['Exam date', 'once'], ['Application last date', 'once']],
  travel: [['Train ticket booking opens', 'once'], ['Trip starts', 'once']],
  festival: [['Diwali', 'once'], ['Holi', 'once'], ['Raksha Bandhan', 'once'], ['Karwa Chauth', 'once'], ['Navratri', 'once']],
  govt: [['Aadhaar document update', 'once'], ['Voter list check', 'once']],
  member: [['Gym membership renewal', 'yearly']]
};
const DATE_CFG = 'date-cfg';
const dateCfg = () => !window.GHOST && records[DATE_CFG] && !records[DATE_CFG].deleted ? records[DATE_CFG] : { hidden: [], custom: [] };
const dateCats = () => { const c = dateCfg(); return [...DATE_CATS.slice(0, -1), ...(c.custom || []).map(x => [x.k, x.n, x.i || '📁']), DATE_CATS[DATE_CATS.length - 1]].filter(x => !(c.hidden || []).includes(x[0])); };
const allDateCatKeys = () => [...DATE_CATS.map(x => x[0]), ...(dateCfg().custom || []).map(x => x.k)];
function guessDateCat(d) {
  const l = String(d.label || '').toLowerCase();
  if (d.sys === 'checkup') return 'bank';
  if (/birthday|bday|janam/.test(l)) return 'birthday';
  if (/punya|death|barsi|shraddh/.test(l)) return 'remember';
  if (/anniversar/.test(l)) return 'anniv';
  if (d.docRef || /expir/.test(l)) return 'docexp';
  if (/insurance|premium|\blic\b|policy/.test(l)) return 'insurance';
  if (/\bpuc\b|service|\brc\b|vehicle|car\b/.test(l)) return 'vehicle';
  if (/\bitr\b|tax|form ?16|tds/.test(l)) return 'tax';
  if (/\bfd\b|ppf|kyc|locker|sip|bank/.test(l)) return 'bank';
  if (/recharge|broadband|ott|netflix|subscription|domain/.test(l)) return 'subs';
  if (/rent|property|society|maintenance/.test(l)) return 'home';
  if (/check-?up|doctor|dental|vaccin|cghs|health/.test(l)) return 'health';
  if (/school|fees|admission/.test(l)) return 'kids';
  if (/apar|acr|ipr|increment|office/.test(l)) return 'office';
  if (/exam|admit|application/.test(l)) return 'exams';
  if (/diwali|holi|rakhi|raksha|navratri|karwa|eid|christmas|festival/.test(l)) return 'festival';
  if (/warranty/.test(l)) return 'warranty';
  if (/gym|club|membership/.test(l)) return 'member';
  return 'other';
}
const dateCat = d => d.cat && allDateCatKeys().includes(d.cat) ? d.cat : guessDateCat(d);
function dateAge(d, w) {
  if (d.repeat !== 'yearly' || !d.when || !/birthday|anniversar/i.test(d.label)) return '';
  const y0 = +d.when.slice(0, 4), y1 = +w.slice(0, 4); if (y0 <= 1904 || y1 <= y0) return '';
  return /anniversar/i.test(d.label) ? `${y1 - y0} years` : `turns ${y1 - y0}`;
}
const EXP_RX = /passport|licen[cs]e|\bdl\b|insurance|policy|\bpuc\b|\brc\b|registration|agreement|warranty|membership|visa|permit|cghs|card/i, EXP_NO = /pan|aadha|voter|ration|birth|debit|credit|atm/i;
function seedDates() {
  const cfg = records[DATE_CFG];
  if (cfg && cfg.seeded) return;
  const have = new Set(all('date').map(d => d.label.toLowerCase())), add = (label, cat, repeat, x) => { if (have.has(label.toLowerCase())) return; have.add(label.toLowerCase());
    const sid = 'ds-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);   // the same id on every device
    put(Object.assign({ id: records[sid] ? uid('d') : sid, type: 'date', label, when: '', repeat, cat, needsDetail: true, deleted: false }, x || {}), { render: false }); };
  const people = orderPeople([...PERSON_ORDER, ...all('doc').flatMap(docOwners)]).filter(p => !/^(family|landlord|parents|dggi|presentation)$/i.test(p));
  people.forEach(p => add(`${p}'s birthday`, 'birthday', 'yearly'));
  const linked = new Set(all('date').map(d => d.docRef).filter(Boolean));
  all('doc').filter(d => !linked.has(d.id) && expiryKind(d)).forEach(d =>
    add(`${d.title} — ${docOwners(d).join(' & ')} — expiry`, d.docType === 'Warranty' ? 'warranty' : 'docexp', 'once', d.expiry ? { when: d.expiry, needsDetail: false, docRef: d.id } : { docRef: d.id }));
  Object.entries(DATE_SEEDS).forEach(([k, L]) => L.forEach(([l, r]) => add(l, k, r)));
  put({ ...(cfg || { id: DATE_CFG, type: 'datecfg', hidden: [], custom: [], updatedAt: 1 }), seeded: true, deleted: false }, { render: false, keepTime: true });   // a flag never overwrites your categories on other devices
}
let datePath = null;
function dateRows(list) {
  const t0 = new Date(todayISO() + 'T00:00:00');
  return list.map(d => { if (!d.when) return { d, w: null, days: null }; const w = nextOccurrence(d); return { d, w, days: Math.round((w - t0) / 86400000) }; })
    .sort((a, b) => (a.days == null) - (b.days == null) || (a.days < 0) - (b.days < 0) || (a.days || 0) - (b.days || 0) || a.d.label.localeCompare(b.d.label));
}
function dateRowHtml({ d, w, days }, showCat) {
  const cat = dateCats().find(c => c[0] === dateCat(d)), age = w ? dateAge(d, isoLocal(w)) : '';
  return swipeHtml(`<div class="row">
      ${days == null ? '<div class="count past" aria-label="no date">?<small>no date</small></div>' : countHtml(days)}
      <div class="row-main"><div class="row-title">${esc(d.label)}</div>
        <div class="row-sub">${w ? `<span>${dateFmt(w, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>` : '<span class="warn">set the date</span>'}${age ? `<span>${age}</span>` : ''}
        ${d.repeat && d.repeat !== 'once' ? `<span class="pill">${esc(d.repeat)}</span>` : ''}${showCat && cat ? `<span>${cat[2]} ${esc(cat[1])}</span>` : ''}</div></div>
      <span class="chev">›</span></div>`, '', 'Delete 🗑', `data-date="${d.id}"`);
}
function renderDatesBase() {
  if (!window.GHOST && (!Sync.on() || window.__synced)) { seedDates(); tidySeededExpiry(); syncAllDocDates(); dedupeSeedDates(); }   // a new device waits for its first sync
  const dates = all('date'), cats = dateCats(), home = $('dateHome');
  if (datePath && !cats.some(c => c[0] === datePath)) datePath = null;
  let list = [];
  if (!datePath) {
    const days = +(prefs.dateBadgeDays || 7), soon = dateRows(dates.filter(d => d.when)).filter(x => x.days >= 0 && x.days <= 30);
    home.innerHTML = `<div class="date-top">${soon.length ? `<div class="group-title">Coming up · next 30 days</div><div class="group" id="dateSoon">${soon.map(x => dateRowHtml(x, true)).join('')}</div>` : '<p class="hint" style="margin:0 4px 8px">Nothing in the next 30 days.</p>'}</div>`;
    home.innerHTML += `<div class="group-title" id="dateCatTitle" style="margin-top:4px">Categories</div><div class="folders">${cats.map(([k, n, i]) => { const own = dates.filter(d => dateCat(d) === k), set = own.filter(d => d.when).length, near = dateRows(own.filter(d => d.when)).filter(x => x.days >= 0 && x.days <= days).length;
      return `<button class="folder" data-dcat="${k}"><b>${i} ${esc(n)}</b><span>${own.length} · ${set} dated</span>${near ? `<small class="warn">${near} within ${days} days</small>` : ''}</button>`; }).join('')}</div>
      <div class="date-cat-actions"><button class="btn ghost small" id="dateNewCat">＋ New category</button><button class="btn ghost small" id="dateIcsAll">📅 All to iPhone Calendar</button><button class="btn ghost small" id="dateImp">⤓ Import / export (CSV)</button></div>`;
  } else {
    const c = cats.find(x => x[0] === datePath);
    list = dateRows(dates.filter(d => dateCat(d) === datePath));
    home.innerHTML = `<div class="doc-crumb"><button class="chip" data-dback="1">‹ All categories</button><b>${c[2]} ${esc(c[1])}</b><span class="muted">${list.length}</span></div>
      <div class="date-cat-actions"><button class="btn ghost small" id="dateAddHere">＋ Add here</button><button class="btn ghost small" id="dateIcsCat">📅 To Calendar</button><button class="btn ghost small" id="dateDelCat" style="color:var(--seal)">Delete category</button></div>`;
  }
  $('dateList').innerHTML = list.map(x => dateRowHtml(x, !datePath)).join('') || (datePath ? '<div class="empty">Nothing here yet — tap “Add here”.</div>' : '');
  $('dateList').classList.toggle('hidden', !$('dateList').innerHTML);
  $$('[data-date]', $('datesPane')).forEach(w => { const id = w.dataset.date; bindSwipe(w, null, () => deleteWithUndo(id)); onTap(w, () => openDate(id)); });
  $$('[data-dcat]', home).forEach(b => b.addEventListener('click', () => { datePath = b.dataset.dcat; renderDates(); $('main').scrollTop = 0; }));
  $$('[data-dback]', home).forEach(b => b.addEventListener('click', () => { datePath = null; renderDates(); }));
  const on = (id, f) => { if ($(id)) $(id).addEventListener('click', f); };
  on('dateAddHere', () => openAdd('date'));
  on('dateNewCat', newDateCat);
  on('dateUnhide', () => { const c = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false }; c.hidden = []; put(c); toast('Hidden categories are back.'); });
  on('dateDelCat', () => deleteDateCat(datePath));
  on('dateDelCatOld', () => {
    const own = dates.filter(d => dateCat(d) === datePath), c = cats.find(x => x[0] === datePath);
    if (!confirm(`Delete the category "${c[1]}"${own.length ? ` and its ${own.length} entr${own.length === 1 ? 'y' : 'ies'}` : ''}?\n\nEntries can be brought back from Settings → Recently deleted for 30 days.`)) return;
    own.forEach(d => softDelete(d.id, { render: false }));
    const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
    if ((cfg.custom || []).some(x => x.k === datePath)) cfg.custom = cfg.custom.filter(x => x.k !== datePath); else cfg.hidden = [...new Set([...(cfg.hidden || []), datePath])];
    datePath = null; put(cfg); toast(`Deleted "${c[1]}".`);
  });
  on('dateIcsAll', () => icsSave(dates.filter(d => d.when), 'Register dates'));
  on('dateImp', openDateImport);
  on('dateIcsCat', () => icsSave(dates.filter(d => d.when && dateCat(d) === datePath), (cats.find(x => x[0] === datePath) || [0, 'Dates'])[1]));
}
function dateNearCount() {
  if (window.GHOST) return 0;
  const n = +(prefs.dateBadgeDays || 7), ids = new Set();
  dateRows(all('date').filter(d => d.when)).forEach(x => { if (x.days >= 0 && x.days <= n) ids.add(x.d.docRef || x.d.id); });
  all('doc').forEach(d => { if (d.expiry && !ids.has(d.id)) { const k = daysTo(d.expiry); if (k >= 0 && k <= n) ids.add(d.id); } });
  return ids.size;
}
function updateDateBadge() {
  const n = dateNearCount(), b = $('datesBadge');
  b.classList.toggle('hidden', !n); b.textContent = n; b.setAttribute('aria-label', `${n} date${n === 1 ? '' : 's'} in the next ${prefs.dateBadgeDays || 7} days`);
  try { if (prefs.iconBadge && navigator.setAppBadge) { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } } catch (e) {}
}
function dateNudge() {
  if (window.GHOST || document.documentElement.classList.contains('decoy-on')) return;
  const key = 'r2_dateNudge', today = todayISO(); let last = ''; try { last = localStorage.getItem(key) || ''; } catch (e) {}
  if (last === today) return;
  const n = +(prefs.dateBadgeDays || 7), L = dateRows(all('date').filter(d => d.when)).filter(x => x.days >= 0 && x.days <= n);
  if (!L.length) return;
  try { localStorage.setItem(key, today); } catch (e) {}
  toast(`📅 ${L.slice(0, 2).map(x => `${x.d.label} (${inDays(x.days)})`).join(', ')}${L.length > 2 ? ` +${L.length - 2} more` : ''}`, 'See', () => { datePath = null; showTab('dates'); }, 8000);
}
function icsTextOld(list) {
  const e = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n'), stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Register//Dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  list.forEach(d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.when || '')) return;
    const nx = new Date(d.when + 'T00:00:00'); nx.setDate(nx.getDate() + 1);
    L.push('BEGIN:VEVENT', `UID:${d.id}@register`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d.when.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${isoLocal(nx).replace(/-/g, '')}`, `SUMMARY:${e(d.label)}`);
    if (d.repeat === 'yearly') L.push('RRULE:FREQ=YEARLY'); else if (d.repeat === 'monthly') L.push('RRULE:FREQ=MONTHLY');
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR'); return L.join('\r\n') + '\r\n';
}
function icsSave(list, name) {
  if (!list.length) { toast('No dates filled in yet.'); return; }
  dl(new Blob([icsText(list)], { type: 'text/calendar' }), name.replace(/[\\/:*?"<>|]/g, '-') + '.ics');
  toast(`${list.length} date${list.length > 1 ? 's' : ''} sent to Calendar — tap “Add All” if asked. Reminders: 9 AM the day before and 9 AM on the day.`, null, null, 7000);
}
$('deIcs').addEventListener('click', () => { const d = records[editDateId]; if (!d) return; const w = $('deWhen').value; if (!w) { toast('Set the date first.'); return; } icsSave([{ ...d, when: w, label: $('deLabel').value.trim() || d.label, repeat: $('deRepeat').value }], d.label); });
$('setIconBadge').addEventListener('change', async () => {
  const on = $('setIconBadge').checked;
  if (on && window.Notification && Notification.permission !== 'granted') { try { await Notification.requestPermission(); } catch (e) {} }
  setPref('iconBadge', on && (!window.Notification || Notification.permission === 'granted'));
  if (on && !prefs.iconBadge) { $('setIconBadge').checked = false; toast('iPhone did not allow it. Settings → Notifications → Register → allow Badges, then try again.', null, null, 7000); }
  updateDateBadge();
});
$('setDateDays').addEventListener('change', () => { setPref('dateBadgeDays', +$('setDateDays').value); updateDateBadge(); });
setTimeout(dateNudge, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateDateBadge(); setTimeout(dateNudge, 1500); } });

/* ==========================================================================
   v2.13
   ======================================================================== */
/* ---------- quick actions: long-press +, and ?go= links (app shortcuts) ---------- */
const QUICK = [['capture', '📥', 'Capture (sort later)'], ['spend', '₹', 'Add spend', true], ['note', '🗒', 'New note'], ['task', '☑︎', 'New task'], ['scan', '📷', 'Scan document'], ['date', '📅', 'Key date'], ['ask', '🔍', 'Ask / search']];
let pendingGo = null;
function doQuick(k) {
  Sheets.closeAll();
  if (k === 'spend') { if (finUnlocked()) { showTab('money'); openAdd('money'); } else if (finConfigured()) { pendingGo = 'spend'; openVault(); } else toast('Set up Money first.'); }
  else if (k === 'note') { showTab('notes'); openAdd('note'); }
  else if (k === 'task') { showTab('tasks'); openAdd('task'); }
  else if (k === 'scan') { showTab('docs'); Scan.open(null); }
  else if (k === 'date') { showTab('dates'); openAdd('date'); }
  else if (k === 'ask') openSearch();
  else if (k === 'capture') openCapture();
}
function openQuick() {
  $('qaGrid').innerHTML = QUICK.filter(q => !q[3] || finUnlocked()).map(([k, i, l]) => `<button data-qa="${k}"><b>${i}</b>${l}</button>`).join('');
  $$('[data-qa]').forEach(b => b.addEventListener('click', () => doQuick(b.dataset.qa)));
  Sheets.open('shQuick');
}
{ const fab = $('fab'); let t = null, long = false;
  const start = () => { long = false; clearTimeout(t); t = setTimeout(() => { long = true; if (navigator.vibrate) navigator.vibrate(15); openQuick(); }, 480); };
  const stop = () => clearTimeout(t);
  fab.addEventListener('touchstart', start, { passive: true }); fab.addEventListener('mousedown', start);
  ['touchend', 'touchcancel', 'mouseup', 'mouseleave'].forEach(e => fab.addEventListener(e, stop));
  fab.addEventListener('contextmenu', e => e.preventDefault());
  fab.addEventListener('click', e => { if (long) { e.stopImmediatePropagation(); e.preventDefault(); long = false; } }, true); }
function handleGo() {
  let g = null; try { g = new URLSearchParams(location.search).get('go'); } catch (e) {}
  if (!g) return;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (document.documentElement.classList.contains('decoy-on')) return;        // never skip the decoy
  if (QUICK.some(q => q[0] === g)) setTimeout(() => doQuick(g), 400);
}

/* ---------- Needs attention (Docs home) ---------- */
const EXP_PHOTO = d => d.docType === 'Photo & Signature';
function attnListsOld() {
  const docs = all('doc'), t = todayISO();
  return [
    ['Inbox to sort', all('inbox')],
    ['Expired', docs.filter(d => d.expiry && d.expiry < t)],
    ['No file attached', docs.filter(d => !docFilesOf(d.id).length)],
    ['ID documents not locked', docs.filter(d => d.docType === 'Identity' && docFilesOf(d.id).length && !d.lockFiles)],
    ['Usually expire, but no expiry date saved', docs.filter(d => !d.expiry && expiryKind(d))],
    ['Dates still to fill in', all('date').filter(d => !d.when && !d.sys)]
  ].filter(x => x[1].length);
}
function renderAttnOld() {
  const box = $('docAttn'); if (!box) return;
  if (docPath.who || window.GHOST) { box.innerHTML = ''; return; }
  const L = attnLists(), n = L.reduce((s, x) => s + x[1].length, 0);
  if (!n) { box.innerHTML = ''; return; }
  const open = box.querySelector('details') && box.querySelector('details').open;
  box.innerHTML = `<details class="attn"${open ? ' open' : ''}><summary>⚠︎ Needs attention (${n})<small class="muted" style="display:block;font-weight:400;font-size:.8125rem;margin-top:2px">${L.map(x => `${x[1].length} ${x[0].toLowerCase()}`).join(' · ')}</small></summary>
    ${L.map(([h, items]) => `<div class="attn-sec"><b>${esc(h)} (${items.length})</b>${items.slice(0, 40).map(x => x.type === 'date'
      ? `<button data-attd="${x.id}">📅 ${esc(x.label)}</button>` : x.type === 'inbox' ? `<button data-attib="1">📥 ${esc(x.text ? x.text.split('\n')[0].slice(0, 60) : 'Photo')}</button>` : `<button data-attn="${x.id}">${esc(x.title)} · ${esc(docOwners(x).join(' & '))}${x.expiry ? ' · ' + fmtDate(x.expiry, true) : ''}</button>`).join('')}${items.length > 40 ? `<small class="muted">…and ${items.length - 40} more</small>` : ''}</div>`).join('')}</details>`;
  $$('[data-attn]', box).forEach(b => b.addEventListener('click', () => openDoc(b.dataset.attn)));
  $$('[data-attd]', box).forEach(b => b.addEventListener('click', () => openDate(b.dataset.attd)));
  $$('[data-attib]', box).forEach(b => b.addEventListener('click', openInbox));
}

/* expiry-type documents (tighter than v2.12: no photos, no bills, no receipts) */
function expiryKind(d) {
  if (EXP_PHOTO(d)) return false;
  const t = String(d.title || '');
  if (/receiv|slip|form|application|bill|receipt|compilation|details|merged|statement/i.test(t)) return false;
  if (/\b(pan|aadha\w*|voter|ration|birth|debit|credit|atm)\b/i.test(t)) return false;
  return /passport|driving licen[cs]e|\bdl\b|insurance|policy|\bpuc\b|\brc\b|rent agreement|agreement|warranty|membership|visa|permit|cghs card|i ?card|id card|inspector card/i.test(t)
    || ['Insurance', 'Vehicle', 'Warranty', 'Membership'].includes(d.docType);
}
function tidySeededExpiry() {
  const cfg = records[DATE_CFG]; if (!cfg || cfg.tidy213) return;
  all('date').forEach(x => { if (x.docRef && !x.when && x.needsDetail) { const d = records[x.docRef]; if (!d || d.deleted || !expiryKind(d)) softDelete(x.id, { render: false }); } });
  put({ ...cfg, tidy213: true }, { render: false, keepTime: true });
}

/* ---------- Money report (PDF, made on the phone) ---------- */
const RP = { kind: 'month' };
function openReport() {
  const cur = todayISO().slice(0, 7), fy = fyOf(todayISO());
  chipGroup($('rpKind'), [{ v: 'month', l: 'Month' }, { v: 'fy', l: 'Financial year' }], RP.kind, v => { RP.kind = v; $('rpMonthW').classList.toggle('hidden', v !== 'month'); $('rpFyW').classList.toggle('hidden', v !== 'fy'); });
  $('rpMonth').value = monthAdd(cur, -1); $('rpMonth').max = cur;
  const ys = [...new Set(all('fin').map(e => (e.date || '').slice(0, 10)).filter(Boolean).map(fyOf).concat(fy))].sort().reverse();
  $('rpFy').innerHTML = ys.map(y => `<option value="${y}">FY ${y}${y === fy ? ' (so far)' : ''}</option>`).join('');
  $('rpMonthW').classList.toggle('hidden', RP.kind !== 'month'); $('rpFyW').classList.toggle('hidden', RP.kind !== 'fy');
  $('rpMsg').textContent = ''; Sheets.open('shReport');
}
function reportData(from, to, label) {
  const inR = e => { const d = (e.date || '').slice(0, 10); return d >= from && d <= to; };
  const F = all('fin').filter(inR), sum = L => L.reduce((s, e) => s + (+e.amount || 0), 0);
  const inc = F.filter(e => e.kind === 'income'), exp = F.filter(e => e.kind === 'expense' && e.category !== 'Investment'), inv = F.filter(e => e.kind === 'expense' && e.category === 'Investment');
  const grp = (L, key) => { const m = {}; L.forEach(e => { const k = key(e) || 'Other'; (m[k] = m[k] || { n: 0, a: 0 }); m[k].n++; m[k].a += +e.amount || 0; }); return Object.entries(m).sort((a, b) => b[1].a - a[1].a); };
  const c = planCfg(), asOf = to > todayISO() ? todayISO() : to;
  let interest = 0;                                                           // worked out from your loans, as on the dashboard
  try { if (c && accts(true).some(a => a.kind === 'loan')) planCompute(c, asOf.slice(0, 7), 'actual').forEach(r => { if (r.ym >= from.slice(0, 7) && r.ym <= to.slice(0, 7)) interest += r.interest || 0; }); } catch (e) { RLOG.warn('report interest', e.message); }
  let bal = null;
  if (c && accts().length && asOf >= monthEnd(monthAdd(c.startMonth, -1))) { const B = balancesOn(c, asOf); bal = { B, rows: accts(true).filter(a => !a.archived || Math.abs(B.accts[a.id] || 0) >= 1).map(a => [a.name, bucketOf(a.kind), B.accts[a.id] || 0]) }; }
  const udh = {}; all('fin').filter(e => isUdhaar(e.kind) && !e.settled && outstanding(e) > 0).forEach(e => { const k = e.who || '—'; udh[k] = (udh[k] || 0) + (e.kind === 'lent' ? 1 : -1) * outstanding(e); });
  const invT = F.filter(e => e.kind === 'transfer').reduce((s, e) => { const T = acctById(e.to), Fr = acctById(e.acct); return s + (T && isInvest(T.kind) ? +e.amount || 0 : 0) - (Fr && isInvest(Fr.kind) ? +e.amount || 0 : 0); }, 0);   // SIPs moved into funds, as on the dashboard
  return { label, from, to, asOf, interest, inc: sum(inc), exp: sum(exp), inv: sum(inv) + invT, incBy: grp(inc, e => e.category && e.category !== 'Other' ? e.category : e.desc), expBy: grp(exp, e => e.category), top: exp.slice().sort((a, b) => b.amount - a.amount).slice(0, 12), bal, udh: Object.entries(udh).filter(x => Math.abs(x[1]) >= 1), n: F.length };
}
async function makeReportPdf(R) {
  try { await loadScript(PDFLIB_URL); } catch (e) { throw new Error('the PDF tool ' + e.message); }
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create(), F = await pdf.embedFont(StandardFonts.Helvetica), FB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = s => String(s == null ? '' : s).replace(/₹/g, 'Rs ').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  const money = n => clean(rs(n)), W = 595.28, H = 841.89, M = 44, ink = rgb(.1, .12, .15), soft = rgb(.42, .45, .5), line = rgb(.85, .85, .85), brass = rgb(.55, .42, .12);
  let pg = pdf.addPage([W, H]), y = H - M, pageNo = 1;
  const newPage = () => { foot(); pg = pdf.addPage([W, H]); y = H - M; pageNo++; };
  const foot = () => pg.drawText(clean(`Register - money report - ${R.label} - page ${pageNo}`), { x: M, y: 24, size: 8, font: F, color: soft });
  const need = h => { if (y - h < 50) newPage(); };
  const text = (s, x, size, font, color, maxW) => { let t = clean(s); if (maxW) while (t.length > 3 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2); if (maxW && t !== clean(s)) t = t.slice(0, -1) + '...'; pg.drawText(t, { x, y, size, font, color: color || ink }); };
  const right = (s, xr, size, font, color) => { const t = clean(s); pg.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y, size, font, color: color || ink }); };
  const h2 = s => { need(40); y -= 18; text(s, M, 13, FB, brass); y -= 8; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .8, color: brass }); y -= 16; };
  const table = (cols, rows, opt) => {
    const widths = cols.map(c => c[1]), xs = []; let x = M; widths.forEach(w => { xs.push(x); x += w; });
    const drawHead = () => { need(20); cols.forEach((c, i) => c[2] === 'r' ? right(c[0], xs[i] + widths[i] - 4, 9, FB, soft) : text(c[0], xs[i], 9, FB, soft)); y -= 6; pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .5, color: line }); y -= 12; };
    drawHead();
    rows.forEach((r, ri) => { if (y < 62) { newPage(); drawHead(); }
      const bold = opt && opt.boldLast && ri === rows.length - 1;
      r.forEach((v, i) => cols[i][2] === 'r' ? right(v, xs[i] + widths[i] - 4, 10, bold ? FB : F) : text(v, xs[i], 10, bold ? FB : F, ink, widths[i] - 8)); y -= 15; });
    y -= 4;
  };
  // heading
  text('Money report', M, 22, FB); y -= 20;
  text(`${R.label}  (${fmtDate(R.from, true)} - ${fmtDate(R.to, true)})`, M, 11, F, soft); y -= 14;
  text(`Made on ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} from ${R.n} Ledger entries. Actual figures only, no estimates.`, M, 9, F, soft); y -= 10;
  h2('Summary');
  table([['', 330], ['Amount', 177, 'r']], [['Income received', money(R.inc)], ['Spending (excluding investments)', money(R.exp)], ...(R.interest >= 1 ? [['Loan interest (worked out from your loans)', money(R.interest)]] : []), ['Put into investments', money(R.inv)], [R.interest >= 1 ? 'Saved (income - spending - loan interest)' : 'Saved (income - spending)', money(R.inc - R.exp - (R.interest || 0))], ['Left after investments', money(R.inc - R.exp - (R.interest || 0) - R.inv)]], { boldLast: false });
  h2('Income');
  table([['Source', 280], ['Entries', 60, 'r'], ['Amount', 167, 'r']], R.incBy.length ? [...R.incBy.map(([k, v]) => [k, String(v.n), money(v.a)]), ['Total', '', money(R.inc)]] : [['No income recorded', '', '']], { boldLast: R.incBy.length > 0 });
  h2('Spending by category');
  table([['Category', 230], ['Entries', 55, 'r'], ['Share', 55, 'r'], ['Amount', 167, 'r']], R.expBy.length ? [...R.expBy.map(([k, v]) => [k, String(v.n), R.exp ? Math.round(v.a * 100 / R.exp) + '%' : '', money(v.a)]), ['Total', '', '', money(R.exp)]] : [['No spending recorded', '', '', '']], { boldLast: R.expBy.length > 0 });
  if (R.top.length) { h2('Biggest spends'); table([['Date', 70], ['What', 250], ['Category', 90], ['Amount', 97, 'r']], R.top.map(e => [fmtDate(e.date, true), e.desc || '-', e.category || '-', money(e.amount)])); }
  if (R.bal) {
    h2(`Balances on ${fmtDate(R.asOf, true)}`);
    const kindW = { bank: 'Bank', cash: 'Cash', invest: 'Investment', card: 'Card', loan: 'Loan' };
    table([['Account', 260], ['Kind', 100], ['Balance', 147, 'r']], [...R.bal.rows.map(([n, k, v]) => [n, kindW[k] || k, (k === 'card' || k === 'loan') && v < 0 ? (k === 'card' ? 'due ' : 'owed ') + money(-v) : money(v)]), ['Money you have (bank + cash + investments + udhaar - card dues)', '', money(R.bal.B.money)]], { boldLast: true });
  }
  if (R.udh.length) { h2('Open udhaar (today)'); table([['Person', 300], ['', 207, 'r']], R.udh.map(([p, v]) => [p, v >= 0 ? 'owes you ' + money(v) : 'you owe ' + money(-v)])); }
  foot();
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
$('rpGo').addEventListener('click', async () => {
  const m = $('rpMsg'); let from, to, label;
  if (RP.kind === 'month') { const ym = $('rpMonth').value; if (!/^\d{4}-\d{2}$/.test(ym)) { m.className = 'msg err'; m.textContent = 'Pick a month.'; return; } from = ym + '-01'; to = monthEnd(ym); label = monthLong(ym); }
  else { const f = $('rpFy').value, s = +f.slice(0, 4); from = s + '-04-01'; to = (s + 1) + '-03-31'; label = 'FY ' + f; }
  m.className = 'msg'; m.textContent = 'Making the PDF…';
  try {
    const R = reportData(from, to, label), blob = await makeReportPdf(R), name = `Money report ${label}.pdf`;
    const file = new File([blob], name, { type: 'application/pdf' });
    m.className = 'msg ok'; m.textContent = `Ready — ${R.n} entries.`;
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    dl(blob, name);
  } catch (e) { RLOG.error('report', e); m.className = 'msg err'; m.textContent = 'Could not make the report: ' + e.message; }
});

/* ---------- Archive old years (to an encrypted file in Drive) ---------- */
const ARCH_ID = 'archive-index';

function archCandidates(fy) {
  const s = +fy.slice(0, 4), from = s + '-04-01', to = (s + 1) + '-03-31', inFy = iso => iso && iso >= from && iso <= to;
  const tasks = all('task').filter(t => t.status === 'done' && inFy(t.completedOn || (t.completedAt ? isoLocal(new Date(t.completedAt)) : '')));
  let fins = [], blocked = 0;
  if (finUnlocked()) {
    const c = planCfg(), start = c ? c.startMonth + '-01' : '9999';
    all('fin').filter(e => inFy((e.date || '').slice(0, 10))).forEach(e => {
      const pays = (e.pays || []).map(p => p.date || '');
      const ok = e.date < start && pays.every(d => d < start) && !(isUdhaar(e.kind) && !e.settled && outstanding(e) > 0);
      ok ? fins.push(e) : blocked++;
    });
  }
  return { tasks, fins, blocked };
}
function openArchive() {
  const cur = fyOf(todayISO()), s = +cur.slice(0, 4), fys = [];
  for (let y = s - 2; y >= s - 15; y--) fys.push(y + '-' + String((y + 1) % 100).padStart(2, '0'));
  const rows = fys.map(f => ({ f, ...archCandidates(f) })).filter(r => r.tasks.length || r.fins.length || r.blocked);
  const idx = archIndex();
  $('arBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Moves finished tasks${finUnlocked() ? ' and old Ledger entries' : ''} of a whole financial year into one ${finUnlocked() ? 'encrypted ' : ''}file in your Drive folder, so the app stays fast. You can look at or bring back an archive any time. The current and the last FY stay in the app.${finUnlocked() ? ' Ledger entries from before your plan starts are archived; later ones stay, because your balances are worked out from them.' : ' Open Money first to archive old Ledger entries too.'}</p>
    <div class="group-title">Ready to archive</div>
    <div class="group">${rows.length ? rows.map(r => `<div class="chk-row"><div class="row-main"><div class="row-title">FY ${r.f}</div><div class="row-sub"><span>${r.tasks.length} done task${r.tasks.length === 1 ? '' : 's'}</span>${finUnlocked() ? `<span>${r.fins.length} Ledger entr${r.fins.length === 1 ? 'y' : 'ies'}</span>` : ''}${r.blocked ? `<span class="muted">${r.blocked} kept (used by your plan or open udhaar)</span>` : ''}</div></div>
      ${r.tasks.length + r.fins.length ? `<button class="btn small" data-arch="${r.f}">Archive</button>` : ''}</div>`).join('') : '<div class="empty">Nothing old enough to archive yet.</div>'}</div>
    ${idx.length ? `<div class="group-title">Archives in Drive</div><div class="group">${idx.map((a, i) => `<div class="chk-row"><div class="row-main"><div class="row-title">FY ${esc(a.fy)}${a.enc ? ' 🔒' : ''}</div><div class="row-sub"><span>${a.n} items</span><span>${fmtDate(isoLocal(new Date(a.at)), true)}</span></div></div>
      <button class="btn small ghost" data-arv="${i}">View</button><button class="btn small ghost" data-arr="${i}">Bring back</button></div>`).join('')}</div>` : ''}
    <div id="arView"></div>`;
  $$('[data-arch]').forEach(b => b.addEventListener('click', () => archiveFy(b.dataset.arch)));
  $$('[data-arv]').forEach(b => b.addEventListener('click', () => archView(+b.dataset.arv, false)));
  $$('[data-arr]').forEach(b => b.addEventListener('click', () => archView(+b.dataset.arr, true)));
  $('arMsg').textContent = '';
  Sheets.open('shArchive');
}
async function archiveFy(fy) {
  const m = $('arMsg'), C = archCandidates(fy), items = [...C.tasks, ...C.fins];
  if (!items.length) return;
  if (!Sync.on() || !driveOn()) { m.className = 'msg err'; m.textContent = 'Connect the Sheet and the Drive folder first (Settings).'; return; }
  if (!confirm(`Archive FY ${fy}: ${C.tasks.length} done tasks${C.fins.length ? ' and ' + C.fins.length + ' Ledger entries' : ''}?\n\nThey move into one file in your Drive folder and leave the app on every device. You can bring them back from here.`)) return;
  m.className = 'msg'; m.textContent = 'Saving the archive to Drive…';
  try {
    const plain = JSON.stringify({ app: 'register-archive', v: 1, fy, at: Date.now(), items: items.map(r => { const x = { ...r }; delete x._dirty; delete x._tooBig; return x; }) });
    const enc = !!Fin.key, body = enc ? await aesEnc(Fin.key, plain) : plain;
    const data = b64(te.encode(body));
    if (data.length > 30000000) throw new Error('this year is too large for one archive file (about 22 MB at most)');   // v2.19 (B10)
    const d = await Sync.call('driveUpload', { folderId: prefs.driveFolder, name: `Register archive FY ${fy}${enc ? ' (encrypted)' : ''}.json`, mime: 'application/json', data }, 240000);
    if (!d.fileId) throw new Error('Drive did not return a file id');
    const back = await Sync.call('driveGet', { fileId: d.fileId }, 240000);           // read it back before removing anything
    if (!back.data || back.data !== data) throw new Error('the saved archive could not be read back');
    { const at = Date.now(); put({ id: 'arch-' + fy + '-' + at.toString(36), type: 'archent', fy, fileId: d.fileId, n: items.length, enc, at, ...(enc ? { salt: Fin.salt, iters: Fin.iters } : {}), deleted: false }, { render: false }); }
    items.forEach(r => { r.deleted = true; r.deletedAt = 1; r.archived = fy; put(r, { render: false }); });
    Sync.run(); scheduleRender();
    openArchive(); $('arMsg').className = 'msg ok'; $('arMsg').textContent = `Archived ${items.length} items from FY ${fy}.`;
  } catch (e) { RLOG.error('archive', e); m.className = 'msg err'; m.textContent = 'Nothing was removed. ' + (e.message || e); }
}
async function archView(i, restoreIt) {
  const a = archIndex()[i], box = $('arView'), m = $('arMsg'); if (!a) return;
  if (a.enc && !Fin.key) { m.className = 'msg err'; m.textContent = 'This archive is encrypted — open Money first.'; return; }
  m.className = 'msg'; m.textContent = 'Reading the archive from Drive…';
  try {
    const d = await Sync.call('driveGet', { fileId: a.fileId }, 240000); if (!d.data) throw new Error('empty file');
    let txt = td.decode(unb64(d.data));
    if (a.enc) {
      let key = Fin.key;
      if (a.salt && a.salt !== Fin.salt) {
        const old = prompt(`FY ${a.fy} was archived under your previous private code. Enter that code to open it:`);
        if (!old) { m.textContent = ''; return; }
        key = await deriveFinKey(old, a.salt, a.iters || FIN_ITERS);
      }
      try { txt = await aesDec(key, txt); } catch (e) { throw new Error(a.salt && a.salt !== Fin.salt ? 'that is not the code this archive was saved with' : 'it was saved under a different private code'); }
    }
    const A = JSON.parse(txt), items = A.items || [];
    if (restoreIt) {
      if (!confirm(`Bring back ${items.length} items from FY ${a.fy}?`)) { m.textContent = ''; return; }
      items.forEach(r => { const x = { ...r, deleted: false }; delete x.deletedAt; delete x.archived; put(x, { render: false }); });
      archForget(a);
      scheduleRender(); openArchive(); $('arMsg').className = 'msg ok'; $('arMsg').textContent = `Brought back ${items.length} items. The file stays in Drive.`; return;
    }
    m.textContent = '';
    const t = items.filter(r => r.type === 'task'), f = items.filter(r => r.type === 'fin');
    box.innerHTML = `<div class="group-title">FY ${esc(a.fy)} · read only</div><div class="group">${t.map(x => `<div class="chk-row"><span class="pill">Task</span><div class="row-main"><div class="row-title">${esc(x.title)}</div><div class="row-sub">done ${esc(x.completedOn || '')}</div></div></div>`).join('')}
      ${f.map(x => `<div class="chk-row"><span class="pill">₹</span><div class="row-main"><div class="row-title">${esc(x.desc || x.category || 'Entry')}</div><div class="row-sub">${esc(fmtDate(x.date, true))} · ${esc(x.kind)}${x.category ? ' · ' + esc(x.category) : ''}</div></div><b>${rs(x.amount)}</b></div>`).join('')}</div>`;
    box.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { m.className = 'msg err'; m.textContent = 'Could not read the archive: ' + (e.message || e); }
}
$('setArchive').addEventListener('click', () => { Sheets.close('shSettings', true); openArchive(); });

/* ---------- Dates: export to Excel, import back (bulk entry) ---------- */
const DI = { plan: null };
const catName = k => (dateCats().concat(DATE_CATS).find(c => c[0] === k) || [0, 'Other'])[1];
const REP_W = { once: 'Once', yearly: 'Every year', monthly: 'Every month' };
/* v2.19 (S7): Dates go out and come back as CSV — opens in Excel, and nothing has to parse an Excel file */
const csvCell = c => { let v = String(c == null ? '' : c); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
function dateExport() {
  const order = dateCats().map(c => c[0]);
  const L = all('date').filter(d => !d.sys).sort((a, b) => order.indexOf(dateCat(a)) - order.indexOf(dateCat(b)) || a.label.localeCompare(b.label));
  const fmt = w => { if (!w) return ''; const [y, m, d] = w.split('-'); return +y <= 1904 ? `${d}-${m}` : `${d}-${m}-${y}`; };
  const rows = [['Category', 'Name', 'Date (DD-MM-YYYY)', 'Repeats', 'ID (leave as it is)'], ...L.map(d => [catName(dateCat(d)), d.label, fmt(d.when), REP_W[d.repeat] || 'Once', d.id])];
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  shareOrDownload(csv, `Register dates ${todayISO()}.csv`, 'text/csv');
}
function parseDateCellOld(v) {
  if (v == null || v === '') return { v: '' };
  if (v instanceof Date && !isNaN(v)) return { v: isoLocal(new Date(v.getFullYear(), v.getMonth(), v.getDate())) };
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return { v: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` }; }
  const s = String(v).trim(); let m;
  const mk = (y, mo, d) => { y = +y; mo = +mo; d = +d; if (y < 100) y += y < 50 ? 2000 : 1900; const dt = new Date(y, mo - 1, d); return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? { v: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` } : { err: `"${s}" is not a real date` }; };
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return mk(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) return mk(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/))) return mk(1900, m[2], m[1]).v ? { v: mk(1900, m[2], m[1]).v, noYear: true } : { err: `"${s}" is not a real date` };
  if ((m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]*(\d{2,4})?$/)) && MON[m[2].slice(0, 4).toLowerCase()] || (m && MON[m[2].slice(0, 3).toLowerCase()])) { const mo = MON[m[2].slice(0, 4).toLowerCase()] || MON[m[2].slice(0, 3).toLowerCase()]; return m[3] ? mk(m[3], mo, m[1]) : { ...mk(1900, mo, m[1]), noYear: true }; }
  if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})?$/)) && MON[m[1].slice(0, 3).toLowerCase()]) { const mo = MON[m[1].slice(0, 3).toLowerCase()]; return m[3] ? mk(m[3], mo, m[2]) : { ...mk(1900, mo, m[2]), noYear: true }; }
  return { err: `"${s}" — write the date as DD-MM-YYYY` };
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function dateReadFile(file) {
  if (!(/\.csv$/i.test(file.name || '') || /csv|text\/plain/.test(file.type || ''))) throw new Error('please choose a CSV file. In Excel: File → Save As → CSV (Comma delimited), then pick that file');
  if (file.size > 2 * 1024 * 1024) throw new Error('the file is larger than 2 MB — that is not a dates list');
  const rows = parseCsv((await file.text()).replace(/^﻿/, '')).map(r => r.map(c => String(c).replace(/^'(?=[=+\-@])/, '')));
  const hi = rows.findIndex(r => r.some(c => /name|what|label/i.test(String(c))) && r.some(c => /date|when/i.test(String(c))));
  if (hi < 0) throw new Error('no header row with "Name" and "Date" columns');
  const H = rows[hi].map(c => String(c).toLowerCase()), col = re => H.findIndex(h => re.test(h));
  const cC = col(/categor/), cN = col(/name|what|label/), cD = col(/date|when/), cR = col(/repeat/), cI = col(/^id\b|\bid\b/);
  return rows.slice(hi + 1).map((r, i) => ({ line: hi + i + 2, cat: cC >= 0 ? String(r[cC] || '').trim() : '', name: String(r[cN] || '').trim(), date: r[cD], rep: cR >= 0 ? String(r[cR] || '').trim() : '', id: cI >= 0 ? String(r[cI] || '').trim() : '' })).filter(r => r.name).slice(0, 5000);
}
function dateImportPlan(rows) {
  const cats = [...DATE_CATS, ...(dateCfg().custom || []).map(x => [x.k, x.n, x.i])], norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const findCat = n => { const k = norm(n); if (!k) return null; return cats.find(c => norm(c[1]) === k || c[0] === k || norm(c[1]).replace(/s$/, '') === k.replace(/s$/, '') || norm(c[1]).startsWith(k)) || null; };
  const existing = all('date').filter(d => !d.sys), byId = new Map(existing.map(d => [d.id, d])), byKey = new Map();
  existing.forEach(d => { const k = norm(d.label); if (!byKey.has(k)) byKey.set(k, d); });
  const P = { add: [], upd: [], same: [], err: [], newCats: [], seen: new Set() };
  rows.forEach(r => {
    const d0 = (r.id && byId.get(r.id)) || byKey.get(norm(r.name)); if (d0) P.seen.add(d0.id);   // a row with a bad date never removes its entry
    const pd = parseDateCell(r.date); if (pd.err) { P.err.push(`Row ${r.line} (${r.name}): ${pd.err}`); return; }
    let cat = findCat(r.cat), catKey = cat ? cat[0] : null;
    if (!cat && r.cat) { const nc = P.newCats.find(x => norm(x.n) === norm(r.cat)); catKey = nc ? nc.k : 'c' + Math.random().toString(36).slice(2, 8); if (!nc) P.newCats.push({ k: catKey, n: r.cat, i: '📁' }); }
    const repRaw = r.rep.toLowerCase(), rep = /month/.test(repRaw) ? 'monthly' : /year|annual|every ?yr/.test(repRaw) ? 'yearly' : /once|one/.test(repRaw) ? 'once' : null;
    const d = (r.id && byId.get(r.id)) || byKey.get(norm(r.name));
    const c = catKey || (d ? dateCat(d) : guessDateCat({ label: r.name }));
    const repeat = rep || (d ? d.repeat : ['birthday', 'anniv', 'remember'].includes(c) ? 'yearly' : 'once');
    const when = pd.v && pd.noYear && repeat !== 'yearly' ? null : pd.v;
    if (pd.noYear && repeat !== 'yearly') { P.err.push(`Row ${r.line} (${r.name}): a date without a year only works for yearly dates`); return; }
    if (d) { P.seen.add(d.id);
      const ch = d.label !== r.name || (d.when || '') !== (when || '') || d.repeat !== repeat || dateCat(d) !== c;
      (ch ? P.upd : P.same).push({ d, label: r.name, when: when || '', repeat, cat: c }); }
    else P.add.push({ label: r.name, when: when || '', repeat, cat: c });
  });
  P.gone = existing.filter(d => !P.seen.has(d.id) && !d.docRef);
  P.goneDoc = existing.filter(d => !P.seen.has(d.id) && d.docRef);
  return P;
}
function showDateImport(P) {
  DI.plan = P;
  $('diPrev').innerHTML = `<div class="imp-sum"><div><b>${P.add.length}</b>new</div><div><b>${P.upd.length}</b>changed</div><div><b>${P.same.length}</b>unchanged</div><div><b>${P.err.length}</b>with problems</div></div>
    ${P.newCats.length ? `<p class="hint">New categories: ${P.newCats.map(c => esc(c.n)).join(', ')}</p>` : ''}
    ${P.gone.length + P.goneDoc.length ? `<div class="group"><label class="switch-row"><span>Remove ${P.gone.length + P.goneDoc.length} entr${P.gone.length + P.goneDoc.length === 1 ? 'y' : 'ies'} that are not in the file<small>They go to Recently deleted for 30 days. ${P.gone.slice(0, 6).concat(P.goneDoc.slice(0, 2)).map(d => esc(d.label)).join(', ')}${P.gone.length + P.goneDoc.length > 8 ? '…' : ''}</small></span><input type="checkbox" class="sw" id="diDel"></label></div>` : ''}
    ${P.err.length ? `<details class="fold" open><summary>Rows with problems (${P.err.length}) — fix them in the file, or import the rest</summary>${P.err.map(e => `<div class="imp-skip">${esc(e)}</div>`).join('')}</details>` : ''}
    ${P.upd.length ? `<details class="fold"><summary>Changed (${P.upd.length})</summary>${P.upd.map(u => `<div class="imp-skip">${esc(u.label)}: ${esc(u.d.when ? fmtDate(u.d.when, true) : 'no date')} → <b>${esc(u.when ? fmtDate(u.when, true) : 'no date')}</b></div>`).join('')}</details>` : ''}
    ${P.add.length ? `<details class="fold"><summary>New (${P.add.length})</summary>${P.add.map(a => `<div class="imp-skip">${esc(catName(a.cat) || '')} · ${esc(a.label)} · ${esc(a.when ? fmtDate(a.when, true) : 'no date')}</div>`).join('')}</details>` : ''}`;
  $('diGo').disabled = !(P.add.length || P.upd.length || P.gone.length || P.goneDoc.length || P.newCats.length);
}
function runDateImport() {
  const P = DI.plan; if (!P) return;
  const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
  if (P.newCats.length) cfg.custom = [...(cfg.custom || []), ...P.newCats];
  const used = new Set([...P.add, ...P.upd].map(x => x.cat)); cfg.hidden = (cfg.hidden || []).filter(h => !used.has(h));
  put(cfg, { render: false });
  P.add.forEach(a => put({ id: uid('d'), type: 'date', label: a.label, when: a.when, repeat: a.repeat, cat: a.cat, needsDetail: !a.when || undefined, deleted: false }, { render: false }));
  P.upd.forEach(u => { const d = u.d; d.label = u.label; d.when = u.when; d.repeat = u.repeat; d.cat = u.cat; if (d.when) delete d.needsDetail; else d.needsDetail = true;
    const doc = d.docRef && records[d.docRef]; if (doc && d.when && u.cat === 'docexp' && doc.expiry !== d.when) { doc.expiry = d.when; put(doc, { render: false }); }
    put(d, { render: false }); });
  let del = 0; if ($('diDel') && $('diDel').checked) [...P.gone, ...P.goneDoc].forEach(d => { softDelete(d.id, { render: false }); del++; });
  Sheets.close('shDateImp'); scheduleRender();
  toast(`Imported: ${P.add.length} new, ${P.upd.length} changed${del ? `, ${del} removed` : ''}.`, null, null, 5000);
  DI.plan = null;
}
$('diExport').addEventListener('click', dateExport);
$('diPick').addEventListener('click', () => $('diFile').click());
$('diFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const m = $('diMsg'); m.className = 'msg'; m.textContent = 'Reading…'; $('diPrev').innerHTML = '';
  try { const rows = await dateReadFile(f); if (!rows.length) throw new Error('no rows with a Name'); showDateImport(dateImportPlan(rows)); m.textContent = `${rows.length} rows read from ${f.name}.`; }
  catch (err) { m.className = 'msg err'; m.textContent = 'Could not read the file: ' + err.message; }
});
$('diGo').addEventListener('click', runDateImport);
function openDateImport() { DI.plan = null; $('diPrev').innerHTML = ''; $('diMsg').textContent = ''; $('diGo').disabled = true; Sheets.open('shDateImp'); }

/* ==========================================================================
   v2.14
   ======================================================================== */
/* ---------- 1. a document's due date lives in Dates too ---------- */
const DUE_KINDS = [['expiry', 'Expiry'], ['renewal', 'Renewal'], ['deadline', 'Deadline'], ['lastdate', 'Last date']];
const dueWord = k => ({ expiry: 'expiry', renewal: 'renewal', deadline: 'deadline', lastdate: 'last date' })[k || 'expiry'] || 'expiry';
const dueKindOpts = sel => DUE_KINDS.map(([v, l]) => `<option value="${v}"${v === (sel || 'expiry') ? ' selected' : ''}>${l}</option>`).join('');
function syncDocDate(d) {
  if (!d || d.deleted) return null;
  const x = all('date').find(z => z.docRef === d.id);
  const label = `${d.title} — ${docOwners(d).join(' & ')} — ${dueWord(d.dueKind)}`;
  if (!d.expiry) { if (x && x.when) { x.when = ''; x.needsDetail = true; put(x, { render: false }); } return x || null; }
  if (x) { if (x.when !== d.expiry || x.label !== label) { x.when = d.expiry; x.label = label; delete x.needsDetail; put(x, { render: false }); } return x; }
  return put({ id: uid('d'), type: 'date', label, when: d.expiry, repeat: 'once', cat: 'docexp', docRef: d.id, deleted: false }, { render: false });
}
function syncAllDocDates() {
  const cfg = records[DATE_CFG]; if (window.GHOST || (cfg && cfg.dues214)) return;
  all('doc').filter(d => d.expiry).forEach(syncDocDate);
  put({ ...(cfg || { id: DATE_CFG, type: 'datecfg', hidden: [], custom: [], updatedAt: 1 }), dues214: true, deleted: false }, { render: false, keepTime: true });
}


/* ---------- 3. zoom: pinch, drag, double-tap, wheel, buttons ---------- */
const LB = { s: 1, x: 0, y: 0, pts: new Map(), last: null, moved: false, tapT: 0 };
function lbApply() { $('lbImg').style.transform = `translate(${LB.x}px,${LB.y}px) scale(${LB.s})`; $('lbPct').textContent = Math.round(LB.s * 100) + '%'; }
function lbReset() { LB.s = 1; LB.x = 0; LB.y = 0; lbApply(); }
function lbZoomAt(ns, cx, cy) {
  const im = $('lbImg'), r = im.getBoundingClientRect(), s0 = LB.s;
  ns = Math.max(1, Math.min(8, ns)); if (ns === s0) return;
  const ox = r.left - LB.x, oy = r.top - LB.y;                        // untransformed top-left
  const px = (cx - ox - LB.x) / s0, py = (cy - oy - LB.y) / s0;        // point in image space
  LB.s = ns; LB.x = cx - ox - px * ns; LB.y = cy - oy - py * ns;
  if (ns === 1) { LB.x = 0; LB.y = 0; }
  lbApply();
}
openLightbox = function (src) { $('lbImg').src = src; lbReset(); $('lightbox').classList.remove('hidden'); };
{ const lb = $('lightbox'), im = $('lbImg');
  lb.insertAdjacentHTML('beforeend', '<div id="lbTools"><button id="lbOut" aria-label="Zoom out">−</button><span id="lbPct">100%</span><button id="lbIn" aria-label="Zoom in">+</button><button id="lbFit" aria-label="Fit to screen">⤢</button></div>');
  const mid = () => { const r = lb.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  $('lbIn').addEventListener('click', e => { e.stopPropagation(); lbZoomAt(LB.s * 1.6, ...mid()); });
  $('lbOut').addEventListener('click', e => { e.stopPropagation(); lbZoomAt(LB.s / 1.6, ...mid()); });
  $('lbFit').addEventListener('click', e => { e.stopPropagation(); lbReset(); });
  lb.addEventListener('wheel', e => { e.preventDefault(); lbZoomAt(LB.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
  lb.addEventListener('pointerdown', e => { if (e.target.closest('#lbTools') || e.target.id === 'lbClose') return; lb.setPointerCapture(e.pointerId); LB.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); LB.moved = false;
    if (LB.pts.size === 2) { const [a, b] = [...LB.pts.values()]; LB.last = { d: Math.hypot(a.x - b.x, a.y - b.y), s: LB.s }; } });
  lb.addEventListener('pointermove', e => {
    const p = LB.pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 3) LB.moved = true;
    p.x = e.clientX; p.y = e.clientY;
    if (LB.pts.size === 2 && LB.last) { const [a, b] = [...LB.pts.values()]; lbZoomAt(LB.last.s * Math.hypot(a.x - b.x, a.y - b.y) / LB.last.d, (a.x + b.x) / 2, (a.y + b.y) / 2); }
    else if (LB.pts.size === 1 && LB.s > 1) { LB.x += dx; LB.y += dy; lbApply(); }
  });
  const up = e => {
    if (!LB.pts.has(e.pointerId)) return; LB.pts.delete(e.pointerId); if (LB.pts.size < 2) LB.last = null;
    if (LB.pts.size || LB.moved || e.target.closest('#lbTools')) return;
    const now = Date.now();
    if (now - LB.tapT < 320) { LB.tapT = 0; LB.s > 1 ? lbReset() : lbZoomAt(2.5, e.clientX, e.clientY); return; }
    LB.tapT = now;
    if (e.target === lb && LB.s === 1) setTimeout(() => { if (LB.tapT === now) $('lbClose').click(); }, 330);
  };
  lb.addEventListener('pointerup', up); lb.addEventListener('pointercancel', e => { LB.pts.delete(e.pointerId); LB.last = null; });
  im.addEventListener('dragstart', e => e.preventDefault()); }
async function zoomPdfPage(doc, n, cv) {
  openLightbox(cv.toDataURL('image/jpeg', .9));
  try { const page = await doc.getPage(n), v1 = page.getViewport({ scale: 1 }), sc = Math.min(4, 2600 / Math.max(v1.width, v1.height)), vp = page.getViewport({ scale: sc });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (!$('lightbox').classList.contains('hidden')) { const s = LB.s, x = LB.x, y = LB.y; $('lbImg').src = c.toDataURL('image/jpeg', .9); LB.s = s; LB.x = x; LB.y = y; lbApply(); } }
  catch (e) { RLOG.warn('pdf zoom', e.message); }
}

/* ---------- 2. Inbox: capture now, sort later ---------- */
const CAP = { files: [] };
function openCapture(text) {
  CAP.files = []; $('capText').value = text || ''; $('capImgs').innerHTML = ''; Sheets.open('shCapture');
  setTimeout(() => $('capText').focus(), 320);
}
function capShowOld() { $('capImgs').innerHTML = CAP.files.map((f, i) => `<img src="${URL.createObjectURL(f)}" alt="photo ${i + 1}">`).join(''); }
$('capCam').addEventListener('click', () => $('capFileCam').click());
$('capLib').addEventListener('click', () => $('capFileLib').click());
$('capPdf').addEventListener('click', () => $('capFilePdf').click());
['capFileCam', 'capFileLib', 'capFilePdf'].forEach(id => $(id).addEventListener('change', e => { CAP.files.push(...e.target.files); e.target.value = ''; capShow(); }));
$('capSave').addEventListener('click', async () => {
  const text = $('capText').value.trim();
  if (!text && !CAP.files.length) { toast('Write a line or add a photo.'); return; }
  const b = $('capSave'); b.disabled = true;
  try {
    const pdfF = CAP.files.filter(f => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name || '')), picF = CAP.files.filter(f => !pdfF.includes(f));
    const imgs = [...(picF.length ? await storeImages(picF, 0) : []), ...(pdfF.length ? await storePdfs(pdfF) : [])];
    if (!imgs.length && !text) return;
    put({ id: uid('ib'), type: 'inbox', text, imgs, deleted: false });
    CAP.files = []; Sheets.close('shCapture', true); toast('Saved to Inbox.', 'Open', openInbox);
  } finally { b.disabled = false; }
});
addMic($('capText'));
const inboxItems = () => all('inbox').sort((a, b) => b.createdAt - a.createdAt);
function renderInboxCard() {
  const box = $('inboxCard'); if (!box) return;
  const n = window.GHOST ? 0 : inboxItems().length;
  box.innerHTML = n ? `<button class="inbox-card" id="inboxGo"><span>📥 <b>Inbox · ${n} to sort</b><br><small class="muted">${esc(inboxItems().slice(0, 2).map(i => i.text ? i.text.split('\n')[0].slice(0, 40) : '📷 photo').join(' · '))}</small></span><b>Sort ›</b></button>` : '';
  if ($('inboxGo')) $('inboxGo').addEventListener('click', openInbox);
}
function openInbox() {
  const L = inboxItems(), fin = finUnlocked();
  $('ibList').innerHTML = L.length ? L.map(i => { const sg = suggestInbox(i); return `<div class="ib-item" data-ib="${i.id}" data-sug="${sg.k}">
      ${i.text ? `<div class="ib-t">${esc(i.text)}</div>` : ''}${(i.imgs || []).length ? `<div class="ib-imgs">${i.imgs.map(ibThumb).join('')}</div>` : ''}
      <div class="ib-m">${timeAgo(i.createdAt)}${i.via ? ' · shared from another app' : ''}</div>${sg.k !== 'money' || fin ? `<div class="ib-sug">Suggested: ${esc(sg.why)}</div>` : ''}
      <div class="ib-acts"><button data-ibto="note">🗒 Note</button><button data-ibto="task">☑︎ Task</button><button data-ibto="doc">📁 Document</button><button data-ibto="date">📅 Date</button>${fin ? '<button data-ibto="money">₹ Spend</button>' : ''}<button data-ibto="del" class="danger">🗑</button></div></div>`; }).join('')
    : '<div class="empty"><b>Inbox is empty</b>Press and hold + → Capture, or tap ＋ Capture above.</div>';
  $$('#ibList [data-ib]').forEach(el => { const b = el.querySelector(`[data-ibto="${el.dataset.sug}"]`); if (b) { b.classList.add('sug'); b.parentElement.prepend(b); } });
  hydrateImgs($('ibList'));
  $$('#ibList img[data-blob]').forEach(im => im.addEventListener('click', () => im.src && openLightbox(im.src)));
  $$('#ibList [data-ibpdf]').forEach(b => b.addEventListener('click', () => openBlobPdf(b.dataset.ibpdf)));
  $$('[data-ibto]').forEach(b => b.addEventListener('click', () => inboxTo(b.closest('[data-ib]').dataset.ib, b.dataset.ibto)));
  if (!Sheets.isOpen('shInbox')) Sheets.open('shInbox');
}
$('ibNew').addEventListener('click', () => openCapture());
function inboxDoneBase(i, keepImgs) {
  if (keepImgs && (i.imgs || []).length) { i.text = ''; put(i, { render: false }); toast('Photos stay in the Inbox — sort them next.'); }
  else softDelete(i.id, { render: false });
  renderInboxCard();
}
async function inboxTo(id, to) {
  const i = records[id]; if (!i) return;
  const text = i.text || '', first = text.split('\n')[0].trim(), all_ = (i.imgs || []).filter(b => records[b] && !records[b].deleted);
  const pdfs = all_.filter(b => isPdfBlob(records[b])), imgs = to === 'doc' ? all_ : all_.filter(b => !pdfs.includes(b));
  if (to === 'del') { softDelete(id); setTimeout(() => trashInboxFiles(id), 7500); toast('Deleted — in Recently deleted for 30 days.', 'Undo', () => { restore(id); openInbox(); }); openInbox(); renderInboxCard(); return; }
  Sheets.close('shInbox', true);
  if (to === 'note') {
    const n = newNote(text, first.slice(0, 60) || (imgs.length ? 'Photo' : ''), false, '');
    if (imgs.length) { n.imgs = imgs.slice(0, IMG_PER_NOTE); put(n, { render: false }); }
    inboxDone(i, false, pdfs); showTab('notes'); openNoteEditor(n.id); return;
  }
  if (to === 'task') {
    let noteTxt = text.split('\n').slice(1).join('\n').trim();
    if (imgs.length) { const n = newNote(text, 'Photos — ' + (first || 'task'), false, ''); n.imgs = imgs.slice(0, IMG_PER_NOTE); put(n, { render: false }); noteTxt = (noteTxt ? noteTxt + '\n' : '') + `Photos are in the note "${n.title}".`; }
    const t = newTask({ title: first || 'Task from Inbox', notes: noteTxt });
    inboxDone(i, false, pdfs); showTab('tasks'); openTaskEditor(t.id); return;
  }
  if (to === 'doc') {
    const d = put({ id: uid('doc'), type: 'doc', title: first.slice(0, 60) || ((records[pdfs[0]] || {}).name || '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.pdf$/i, '').slice(0, 60) || 'Document from Inbox', who: '', docType: 'Other', number: '', expiry: null, issuer: '', notes: text.split('\n').slice(1).join('\n'), folder: '', fy: null, deleted: false });
    showTab('docs'); openDoc(d.id);
    if (imgs.length) {
      const files = [], okIds = [];
      for (const b of imgs) { try { const src = await imgSrc(records[b]); const blob = await (await fetch(src)).blob(); files.push(new File([blob], (records[b] && records[b].name) || (isPdfBlob(records[b]) ? 'file.pdf' : 'photo.jpg'), { type: isPdfBlob(records[b]) ? 'application/pdf' : blob.type || 'image/jpeg' })); okIds.push(b); } catch (e) { RLOG.warn('inbox photo', e.message); } }
      const before = docFilesOf(d.id).length;
      if (files.length) await addDocFiles(d.id, files);
      const attached = files.length > 0 && docFilesOf(d.id).length - before >= files.length;
      if (attached) okIds.forEach(b => { if (blobUsedElsewhere(b, i.id)) softDelete(b, { render: false }); else trashBlob(b, 'moved to a document'); });   // the document has its own copy
      const left = imgs.filter(b => !(attached && okIds.includes(b)));
      if (left.length) { i.imgs = left; put(i, { render: false }); toast(`${left.length} photo${left.length > 1 ? 's' : ''} could not be attached — kept in the Inbox.`); return; }
    }
    inboxDone(i, false); toast('Set the type and person, then Save.'); return;
  }
  if (to === 'date') {
    const fd = findDateIn(text), lbl = dateLabelFrom(first, fd) || 'Date from Inbox';
    const dc = guessDateCat({ label: lbl });
    const x = put({ id: uid('d'), type: 'date', label: lbl, when: fd ? fd.iso : '', repeat: YEARLY_CATS.includes(dc) ? 'yearly' : 'once', cat: dc, needsDetail: fd ? undefined : true, deleted: false });
    inboxDone(i, true); showTab('dates'); openDate(x.id); return;
  }
  if (to === 'money') {
    showTab('money'); openAdd('money');
    const m = text.match(/(\d[\d,]*(?:\.\d+)?)/), rest = text.replace(m ? m[1] : '', '').replace(/\s+/g, ' ').trim();
    setTimeout(() => { if (m && $('afAmt')) { $('afAmt').value = m[1].replace(/,/g, ''); $('afAmt').dispatchEvent(new Event('input')); } if ($('afTitle')) { $('afTitle').value = rest.slice(0, 80); $('afTitle').dispatchEvent(new Event('input')); } }, 60);
    inboxDone(i, true); return;
  }
}

/* ---------- 5. crop & straighten (scans, and saved photos / PDFs later) ---------- */
const CR = { page: null, rot: 0, ang: 0, q: null, base: null, work: null, done: null };
function crWorkCanvas() {
  const src = CR.base, r = ((CR.rot % 360) + 360) % 360, a = (r + CR.ang) * Math.PI / 180, W = src.width, H = src.height;
  const cw = Math.round(Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))), ch = Math.round(Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a)));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.translate(cw / 2, ch / 2); x.rotate(a); x.drawImage(src, -W / 2, -H / 2);
  return c;
}
function crDraw() {
  CR.work = crWorkCanvas();
  const cv = $('crCv'), k = Math.min(1, 900 / Math.max(CR.work.width, CR.work.height));
  cv.width = Math.round(CR.work.width * k); cv.height = Math.round(CR.work.height * k); cv.getContext('2d').drawImage(CR.work, 0, 0, cv.width, cv.height);
  const wrap = $('crWrap'), maxH = Math.max(240, window.innerHeight * .55); wrap.style.maxWidth = Math.min(cv.width, maxH * cv.width / cv.height) + 'px';
  crSvg();
}
function crSvg() {
  const svg = $('crSvg'), W = $('crCv').width, H = $('crCv').height, q = CR.q;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  const P = q.map(([u, v]) => [u * W, v * H]), rr = Math.max(10, Math.min(W, H) * .035);
  svg.innerHTML = `<polygon points="${P.map(p => p.join(',')).join(' ')}"/>${P.map((p, i) => `<circle data-cr="${i}" cx="${p[0]}" cy="${p[1]}" r="${rr}"/>`).join('')}`;
}
{ const svg = $('crSvg'); let drag = null;
  svg.addEventListener('pointerdown', e => { const c = e.target.closest('[data-cr]'); if (!c) return; drag = +c.dataset.cr; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
  svg.addEventListener('pointermove', e => { if (drag == null) return; const r = svg.getBoundingClientRect();
    CR.q[drag] = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; crSvg(); });
  const end = () => { drag = null; }; svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end); }
const CR_FULL = () => [[0, 0], [1, 0], [1, 1], [0, 1]];
function openCrop(page, done) {
  CR.page = page; CR.done = done; CR.base = page.orig || page.src; CR.rot = page.orig ? (page.crop ? page.crop.rot : 0) + (page.rot || 0) : (page.rot || 0);
  CR.ang = page.crop ? page.crop.ang : 0; CR.q = page.crop && !(page.orig && page.rot) ? page.crop.q.map(p => p.slice()) : CR_FULL();   // turned since: corners start from the full page
  $('crAng').value = CR.ang; $('crAngV').textContent = CR.ang + '°';
  Sheets.open('shCrop'); setTimeout(crDraw, 60);
}
$('crAng').addEventListener('input', () => { CR.ang = +$('crAng').value; $('crAngV').textContent = CR.ang + '°'; crDraw(); });
$('crL').addEventListener('click', () => { CR.rot -= 90; CR.q = CR_FULL(); crDraw(); });
$('crR').addEventListener('click', () => { CR.rot += 90; CR.q = CR_FULL(); crDraw(); });
$('crReset').addEventListener('click', () => { CR.rot = 0; CR.ang = 0; $('crAng').value = 0; $('crAngV').textContent = '0°'; CR.q = CR_FULL(); crDraw(); });
$('crAuto').addEventListener('click', () => { const q = findEdges(CR.work); if (q) { CR.q = q; crSvg(); } else toast('Could not find the page edges — drag the corners.'); });
/* rough automatic page finder: the largest bright region against a darker background */
function findEdges(c) {
  const k = Math.min(1, 320 / Math.max(c.width, c.height)), w = Math.max(8, Math.round(c.width * k)), h = Math.max(8, Math.round(c.height * k));
  const t = document.createElement('canvas'); t.width = w; t.height = h; const x = t.getContext('2d'); x.drawImage(c, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h); let sum = 0;
  for (let i = 0; i < w * h; i++) { g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2]; sum += g[i]; }
  const hist = new Uint32Array(256); for (let i = 0; i < w * h; i++) hist[g[i] | 0]++;
  let best = 0, th = sum / (w * h), tot = w * h, sB = 0, wB = 0, all = 0; for (let i = 0; i < 256; i++) all += i * hist[i];
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (all - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = i; } }
  const on = (xx, yy) => g[yy * w + xx] > th;
  let n = 0; const P = [[1e9, null], [-1e9, null], [-1e9, null], [1e9, null]];   // tl: min x+y, tr: max x-y, br: max x+y, bl: min x-y
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (on(xx, yy)) { n++; const s = xx + yy, df = xx - yy;
    if (s < P[0][0]) P[0] = [s, [xx, yy]]; if (df > P[1][0]) P[1] = [df, [xx, yy]]; if (s > P[2][0]) P[2] = [s, [xx, yy]]; if (df < P[3][0]) P[3] = [df, [xx, yy]]; }
  if (n < w * h * .15 || n > w * h * .97 || P.some(p => !p[1])) return null;
  return P.map(p => [p[1][0] / (w - 1), p[1][1] / (h - 1)]);
}
function warpQuad(src, q) {
  const S = q.map(([u, v]) => [u * (src.width - 1), v * (src.height - 1)]), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.round(Math.max(dist(S[0], S[1]), dist(S[3], S[2]))), H = Math.round(Math.max(dist(S[0], S[3]), dist(S[1], S[2])));
  const k = Math.min(1, 2400 / Math.max(W, H)); W = Math.max(2, Math.round(W * k)); H = Math.max(2, Math.round(H * k));
  const [x0, y0] = S[0], [x1, y1] = S[1], [x2, y2] = S[2], [x3, y3] = S[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g = 0, h = 0;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) { a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; }
  else { const den = dx1 * dy2 - dx2 * dy1; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0; d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0; }
  const sd = src.getContext('2d').getImageData(0, 0, src.width, src.height), sp = sd.data, SW = src.width, SH = src.height;
  const out = document.createElement('canvas'); out.width = W; out.height = H; const ox = out.getContext('2d'), od = ox.createImageData(W, H), op = od.data;
  for (let j = 0; j < H; j++) { const v = j / (H - 1 || 1);
    for (let i = 0; i < W; i++) { const u = i / (W - 1 || 1), z = g * u + h * v + 1, sx = (a * u + b * v + c) / z, sy = (d * u + e * v + f) / z;
      const X = Math.max(0, Math.min(SW - 1.001, sx)), Y = Math.max(0, Math.min(SH - 1.001, sy)), xi = X | 0, yi = Y | 0, fx = X - xi, fy = Y - yi;
      const i00 = (yi * SW + xi) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4, o = (j * W + i) * 4;
      for (let ch = 0; ch < 3; ch++) op[o + ch] = (sp[i00 + ch] * (1 - fx) + sp[i10 + ch] * fx) * (1 - fy) + (sp[i01 + ch] * (1 - fx) + sp[i11 + ch] * fx) * fy;
      op[o + 3] = 255; } }
  ox.putImageData(od, 0, 0); return out;
}
$('crDone').addEventListener('click', async () => {
  const b = $('crDone'); b.disabled = true; await new Promise(r => setTimeout(r, 20));
  try {
    const full = CR.q.every((p, i) => Math.abs(p[0] - CR_FULL()[i][0]) < .002 && Math.abs(p[1] - CR_FULL()[i][1]) < .002);
    const out = full ? CR.work : warpQuad(CR.work, CR.q), pg = CR.page;
    pg.orig = CR.base; pg.crop = { rot: CR.rot, ang: CR.ang, q: CR.q.map(p => p.slice()) }; pg.src = out; pg.rot = 0;
    Sheets.close('shCrop', true); if (CR.done) CR.done();
  } finally { b.disabled = false; }
});
/* edit a saved photo or PDF later: its pages come back into the scanner */
async function editDocFile(fid) {
  const f = records[fid]; if (!f) return;
  const msg = $('doFileMsg'); msg.className = 'msg'; msg.textContent = 'Opening the file…';
  try {
    const { blob } = await docFileBlob(f), pages = [];
    if (isPdf(f)) {
      const lib = await pdfjs(), doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, ...pdfWorkerOpt() }).promise;
      if (doc.numPages > 30) throw new Error('more than 30 pages — too many to edit here');
      for (let n = 1; n <= doc.numPages; n++) { const p = await doc.getPage(n), v1 = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: Math.min(3, 2000 / Math.max(v1.width, v1.height)) });
        const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: x, viewport: vp }).promise; pages.push({ src: c, rot: 0 }); }
      try { doc.destroy(); } catch (e) {}
    } else {
      const url = URL.createObjectURL(blob), img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('not a picture')); i.src = url; });
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); pages.push({ src: c, rot: 0 });
    }
    msg.textContent = '';
    Scan.openEdit(f, pages);
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'Could not open it for editing: ' + (e.code === 'LOCKED' ? 'enter your private code first' : e.message); }
}
Scan.openEdit = function (f, pages) {
  this.open(f.docId); this.replace = f; this.mode = 'orig'; this.pages = pages;
  chipGroup($('scMode'), [{ v: 'doc', l: 'Document' }, { v: 'bw', l: 'Black & white' }, { v: 'orig', l: 'Original' }], 'orig', v => { this.mode = v; this.render(); });
  this.render(); $('scMsg').className = 'msg'; $('scMsg').textContent = `Editing "${f.name}". Saving replaces it (the old file goes to Drive's Trash).`;
};

/* ==========================================================================
   v2.15
   ======================================================================== */
/* ---------- suggested action for an Inbox line ---------- */
const MON3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function findDateInOld(text) {
  const s = ' ' + String(text || '').toLowerCase() + ' ', t = todayISO(); let m;
  const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getMonth() === mo - 1 && dt.getDate() === d ? isoLocal(dt) : null; };
  const fut = (mo, d) => { const y = +t.slice(0, 4); let r = ok(y, mo, d); if (r && r < t) r = ok(y + 1, mo, d); return r; };
  if ((m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3], r = ok(y, +m[2], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { const r = ok(+m[1], +m[2], +m[3]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?\b/))) { const r = m[3] ? ok(+m[3], MON3[m[2]], +m[1]) : fut(MON3[m[2]], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/))) { const r = m[3] ? ok(+m[3], MON3[m[1]], +m[2]) : fut(MON3[m[1]], +m[2]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{1,2})[/.](\d{1,2})\b/)) && +m[2] <= 12 && +m[1] <= 31 && !/[₹]|rs/.test(s.slice(Math.max(0, s.indexOf(m[0]) - 4), s.indexOf(m[0])))) { const r = fut(+m[2], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if (/\b(today|aaj)\b/.test(s)) return { iso: t, hit: (s.match(/\b(today|aaj)\b/) || [''])[0] };
  if (/\btomorrow\b/.test(s)) return { iso: addDays(1), hit: 'tomorrow' };
  if ((m = s.match(/\bin (\d{1,3}) days?\b/))) return { iso: addDays(+m[1]), hit: m[0] };
  if ((m = s.match(/\b(?:next |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) { const w = WDAYS.indexOf(m[1]), now = new Date(t + 'T00:00:00').getDay(); let k = (w - now + 7) % 7 || 7; return { iso: addDays(k), hit: m[0] }; }
  return null;
}
function suggestInbox(i) {
  const text = String(i.text || '').trim(), first = text.split('\n')[0], low = first.toLowerCase();
  if (!text && (i.imgs || []).length) return { k: 'doc', why: 'a photo — keep it as a document' };
  if (/^\s*(₹|rs\.?|inr)?\s*\d[\d,]*(\.\d+)?\b/i.test(first) || /(₹|\brs\.?|\binr)\s*\d/i.test(first) || /\b(paid|spent|pay|bought|kharcha|kharch|diya|given)\b.*\d{2,}/i.test(low) && !findDateIn(first))
    return { k: 'money', why: 'starts with an amount — a spend' };
  const d = findDateIn(text); if (d) return { k: 'date', why: `mentions ${fmtDate(d.iso, true)} — a date`, date: d };
  if (/^(call|pay|buy|send|submit|renew|book|file|apply|get|collect|check|meet|email|mail|reply|visit|fix|order|update)\b/i.test(first)) return { k: 'task', why: 'sounds like something to do — a task' };
  if ((i.imgs || []).length) return { k: 'doc', why: 'has a photo — a document' };
  return { k: 'note', why: 'something to remember — a note' };
}

function dateLabelFrom(first, fd) {
  if (!fd) return first;
  const h = fd.hit.trim(), k = first.toLowerCase().indexOf(h);
  let out = k >= 0 ? first.slice(0, k) + first.slice(k + h.length) : first;
  return out.replace(/\s+(on|by|till|before|dated)\s*$/i, '').replace(/\s{2,}/g, ' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
}
/* ---------- daily Inbox reminder, Tasks badge ---------- */
function inboxNudge() {
  if (window.GHOST || document.documentElement.classList.contains('decoy-on')) return;
  const n = all('inbox').length; updateInboxBadge();
  if (n <= 5) return;
  const key = 'r2_inboxNudge', today = todayISO(); let last = ''; try { last = localStorage.getItem(key) || ''; } catch (e) {}
  if (last === today) return;
  try { localStorage.setItem(key, today); } catch (e) {}
  toast(`📥 ${n} items are waiting in your Inbox.`, 'Sort now', openInbox, 9000);
}
function updateInboxBadge() {
  const b = $('tasksBadge'); if (!b) return;
  const n = window.GHOST ? 0 : all('inbox').length;
  b.classList.toggle('hidden', n <= 5); b.textContent = n; b.setAttribute('aria-label', `${n} items in the Inbox`);
}
setTimeout(inboxNudge, 7000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(inboxNudge, 2500); });

/* ---------- Needs attention: OK / ignore ---------- */
const ATTN_ID = 'attn-ok';
const attnCfg = () => records[ATTN_ID] && !records[ATTN_ID].deleted ? records[ATTN_ID] : { ok: {}, off: {} };
function attnSave(fn) { const c = { id: ATTN_ID, type: 'attnok', ok: {}, off: {}, ...JSON.parse(JSON.stringify(attnCfg())), deleted: false }; fn(c); put(c, { render: false }); renderAttn(); }
function attnListsAll() {
  const docs = all('doc'), t = todayISO();
  return [
    ['inbox', 'Inbox to sort', all('inbox')],
    ['exp', 'Expired', docs.filter(d => d.expiry && d.expiry < t)],
    ['nofile', 'No file attached', docs.filter(d => !docFilesOf(d.id).length)],
    ['unlocked', 'ID documents not locked', docs.filter(d => d.docType === 'Identity' && docFilesOf(d.id).length && !d.lockFiles)],
    ['noexp', 'Usually expire, but no expiry date saved', docs.filter(d => !d.expiry && expiryKind(d))],
    ['datefill', 'Dates still to fill in', all('date').filter(d => !d.when && !d.sys)]
  ];
}
function attnLists() {
  const c = attnCfg();
  return attnListsAll().filter(([k]) => !c.off[k]).map(([k, h, L]) => [h, k === 'inbox' ? L : L.filter(x => !c.ok[k + ':' + x.id]), k]).filter(x => x[1].length);
}
function renderAttnBase() {
  const box = $('docAttn'); if (!box) return;
  if (docPath.who || window.GHOST) { box.innerHTML = ''; return; }
  const L = attnLists(), c = attnCfg(), n = L.reduce((s, x) => s + x[1].length, 0);
  const nOk = Object.keys(c.ok || {}).length, nOff = Object.keys(c.off || {}).filter(k => c.off[k]).length;
  if (!n && !nOk && !nOff) { box.innerHTML = ''; return; }
  const open = box.querySelector('details') && box.querySelector('details').open;
  const row = (k, x) => {
    const label = x.type === 'date' ? `📅 ${esc(x.label)}` : x.type === 'inbox' ? `📥 ${esc(x.text ? x.text.split('\n')[0].slice(0, 60) : 'Photo')}` : `${esc(x.title)} · ${esc(docOwners(x).join(' & '))}${x.expiry ? ' · ' + fmtDate(x.expiry, true) : ''}`;
    return `<div class="attn-row"><button class="attn-go" data-attk="${k}" data-attid="${x.id}">${label}</button>${k === 'inbox' ? '' : `<button class="attn-ok" data-attok="${k}:${x.id}" aria-label="Mark OK">✓ OK</button>`}</div>`;
  };
  box.innerHTML = `<details class="attn"${open ? ' open' : ''}><summary>${n ? `⚠︎ Needs attention (${n})` : '✓ Nothing needs attention'}<small class="muted" style="display:block;font-weight:400;font-size:.8125rem;margin-top:2px">${L.map(x => `${x[1].length} ${x[0].toLowerCase()}`).join(' · ') || 'Everything is marked OK.'}</small></summary>
    ${L.map(([h, items, k]) => `<div class="attn-sec"><div class="attn-head"><b>${esc(h)} (${items.length})</b>${k === 'inbox' ? '<button data-attinbox="1">Sort ›</button>' : `<button data-attall="${k}">All OK</button><button data-attoff="${k}">Stop checking this</button>`}</div>
      ${items.slice(0, 40).map(x => row(k, x)).join('')}${items.length > 40 ? `<small class="muted">…and ${items.length - 40} more</small>` : ''}</div>`).join('')}
    ${nOk || nOff ? `<div class="attn-foot muted">${nOk ? `${nOk} marked OK` : ''}${nOk && nOff ? ' · ' : ''}${nOff ? `${nOff} check${nOff > 1 ? 's' : ''} switched off` : ''} · <button class="linkbtn" id="attnReset" style="font-size:.8125rem;padding:0">Show them again</button></div>` : ''}</details>`;
  $$('[data-attid]', box).forEach(b => b.addEventListener('click', () => { const k = b.dataset.attk, id = b.dataset.attid; if (k === 'inbox') openInbox(); else if (k === 'datefill') openDate(id); else openDoc(id); }));
  $$('[data-attinbox]', box).forEach(b => b.addEventListener('click', openInbox));
  $$('[data-attok]', box).forEach(b => b.addEventListener('click', () => attnSave(c2 => { c2.ok[b.dataset.attok] = Date.now(); })));
  $$('[data-attall]', box).forEach(b => b.addEventListener('click', () => { const k = b.dataset.attall, sec = attnListsAll().find(s => s[0] === k); attnSave(c2 => { sec[2].forEach(x => { c2.ok[k + ':' + x.id] = Date.now(); }); }); }));
  $$('[data-attoff]', box).forEach(b => b.addEventListener('click', () => { const k = b.dataset.attoff; attnSave(c2 => { c2.off[k] = true; }); toast('That check is off. "Show them again" at the bottom brings it back.'); }));
  if ($('attnReset')) $('attnReset').addEventListener('click', () => attnSave(c2 => { c2.ok = {}; c2.off = {}; }));
}

/* ---------- Share into Register (iPhone Shortcut → Apps Script) ---------- */
function openShareIn() {
  const url = prefs.cloudUrl || '(connect the Sheet first — Settings → Sync)';
  $('siBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">iPhone does not let web apps appear in the Share menu. A one-time Shortcut does it: Share → <b>Save to Register</b> sends the photo or text straight to your Inbox (through your own Apps Script, v23 or later). It shows up here on the next sync.</p>
    <div class="group" style="padding:12px 14px">
      <div class="field"><label>Web App URL</label><div style="display:flex;gap:8px"><input id="siUrl" readonly value="${esc(url)}" style="flex:1;min-width:0"><button class="btn small ghost" id="siCopyUrl">Copy</button></div></div>
      <div class="field"><label>Token</label><div style="display:flex;gap:8px"><input id="siTok" readonly type="password" value="${esc(prefs.cloudToken || '')}" style="flex:1;min-width:0"><button class="btn small ghost" id="siCopyTok">Copy</button></div></div>
    </div>
    <div class="group-title">Make the Shortcut (once, about 10 minutes) — photos, PDFs, text and links</div>
    <ol class="share-steps">
      <li>Shortcuts app → <b>＋</b> → name it <code>Save to Register</code>. Tap <b>ⓘ</b> → <b>Show in Share Sheet</b> → Share Sheet Types: <b>Images, PDFs, Files, Text, URLs</b>.</li>
      <li><b>Ask for Text with Prompt</b> → <code>A line about it (optional)</code> (leave Default Answer empty). Its answer is the variable <b>Provided Input</b>.</li>
      <li><b>Repeat with Each</b> item in <b>Shortcut Input</b>.</li>
      <li>&nbsp;&nbsp;<b>Get Details of Files</b> → Detail <b>File Extension</b> of <b>Repeat Item</b>.</li>
      <li>&nbsp;&nbsp;<b>If</b> <i>File Extension</i> <b>is</b> <code>pdf</code>:
        <ul><li><b>Base64 Encode</b> <i>Repeat Item</i> (Line Breaks: <b>None</b>) → <b>Get Name</b> of <i>Repeat Item</i></li>
          <li><b>Get Contents of URL</b> (box A)</li></ul></li>
      <li>&nbsp;&nbsp;<b>Otherwise</b> → <b>Get Images from Input</b> (<i>Repeat Item</i>) → <b>If</b> <i>Images</i> <b>has any value</b>:
        <ul><li><b>Resize Image</b> width <code>1600</code> → <b>Convert Image</b> to <b>JPEG</b> → <b>Base64 Encode</b> (Line Breaks: <b>None</b>)</li>
          <li><b>Get Contents of URL</b> (box B)</li>
          <li><b>Otherwise</b> → <b>Get Text from Input</b> (<i>Repeat Item</i>) → <b>Get Contents of URL</b> (box C) → <b>End If</b></li></ul></li>
      <li>&nbsp;&nbsp;<b>End If</b> → <b>End Repeat</b> → <b>Show Notification</b> <code>Saved to Register Inbox</code>.</li>
    </ol>
    <div class="group-title">The three “Get Contents of URL” boxes</div>
    <p class="hint" style="margin:0 4px 6px">Each: the URL above · Method <b>POST</b> · Request Body <b>JSON</b> · every field of type <b>Text</b>. Pick variables from the bar above the keyboard.</p>
    <ul class="share-steps">
      <li><b>A · PDF:</b> <code>token</code> = the token above · <code>action</code> = <code>inboxAdd</code> · <code>text</code> = <i>Provided Input</i> · <code>data</code> = <i>Base64 Encoded</i> · <code>mime</code> = <code>application/pdf</code> · <code>name</code> = <i>Name</i></li>
      <li><b>B · photo:</b> <code>token</code> · <code>action</code> = <code>inboxAdd</code> · <code>text</code> = <i>Provided Input</i> · <code>data</code> = <i>Base64 Encoded</i> · <code>mime</code> = <code>image/jpeg</code></li>
      <li><b>C · text or link:</b> <code>token</code> · <code>action</code> = <code>inboxAdd</code> · <code>text</code> = <i>Provided Input</i>, a new line, <i>Text</i></li>
    </ul>
    <div class="group-title">So a refusal is not hidden (recommended)</div>
    <p class="hint" style="margin:0 4px 6px">The script answers “OK” even when it refuses something; the reason is inside the answer. After <b>each</b> Get Contents of URL add: <b>Get Dictionary Value</b> key <code>error</code> from <i>Contents of URL</i> → <b>If</b> <i>Dictionary Value</i> <b>has any value</b> → <b>Show Alert</b> “Register refused it: <i>Dictionary Value</i>” → <b>Stop This Shortcut</b> → <b>End If</b>.</p>
    <p class="hint" style="margin:0 4px 6px">Common answers: <code>unauthorized</code> = token does not match · <code>unknown action</code> = the new Code.gs was saved but not deployed (Deploy → Manage deployments → Edit → New version) · <code>DRIVE_FOLDER_ID is empty</code> = paste the Register folder link in the script.</p>
    <p class="hint" style="margin:0 4px 10px">If PDFs shared from WhatsApp arrive as text, make a second Shortcut <code>Save PDF to Register</code> with only box A (Share Sheet Types: PDFs, Files) — it does not need the file-type check.</p>
    <p class="hint">Photos and PDFs go into your Register Drive folder; nothing else in your Drive is touched. Deleting the item from the Inbox moves them to Drive's Trash. The token stays inside the Shortcut on your phone — do not share the Shortcut with anyone.</p>
    <button class="btn ghost block" id="siTest">Send a test item now</button><div class="msg" id="siMsg"></div>`;
  const cp = async (id, what) => { try { await navigator.clipboard.writeText($(id).value); toast(what + ' copied.'); } catch (e) { $(id).type = 'text'; $(id).select(); toast('Select and copy it.'); } };
  $('siCopyUrl').addEventListener('click', () => cp('siUrl', 'URL')); $('siCopyTok').addEventListener('click', () => cp('siTok', 'Token'));
  $('siTest').addEventListener('click', async () => {
    const m = $('siMsg'); m.className = 'msg'; m.textContent = 'Sending…';
    try { const r = await Sync.call('inboxAdd', { text: 'Test from Share setup ' + new Date().toLocaleTimeString('en-IN') }); if (r.error) throw new Error(r.error);
      await Sync.run(); m.className = 'msg ok'; m.textContent = 'Arrived — check the Inbox (top of Tasks).'; renderInboxCard(); }
    catch (e) { m.className = 'msg err'; m.textContent = /unknown action/.test(e.message) ? 'Your Apps Script is older than v21. Paste Code.gs v21 and redeploy.' : 'Failed: ' + e.message; }
  });
  Sheets.open('shShareIn');
}
$('setShareIn').addEventListener('click', () => { Sheets.close('shSettings', true); openShareIn(); });
$('setImportDocs').addEventListener('click', openImport);
$('docImportBtn').addEventListener('click', openImport);

/* ==========================================================================
   LEDGER ACCOUNTS (v2.4) — every entry says which account; Transfer moves
   money between your own accounts and is never income or spending.
   ======================================================================== */
function lastAcct(kind) { try { return (JSON.parse(localStorage.getItem('r2_lastAcct') || '{}'))[kind] || null; } catch (e) { return null; } }
function rememberAcct(kind, id) { try { const m = JSON.parse(localStorage.getItem('r2_lastAcct') || '{}'); m[kind] = id; localStorage.setItem('r2_lastAcct', JSON.stringify(m)); } catch (e) {} }
const hasAccts = () => Fin.key && typeof accts === 'function' && accts().length > 0;
const acctLabelFor = k => k === 'income' ? 'Received into' : k === 'expense' ? 'Paid from' : k === 'lent' ? 'Given from' : k === 'borrowed' ? 'Received into' : 'From';
function acctPick(prefix, kind, acct, to) {
  const wrap = $(prefix + 'AcctWrap'); if (!wrap) return;
  const on = hasAccts(); wrap.classList.toggle('hidden', !on);
  if (!on) return;
  const c = planCfg(), def = defAcct(c);
  const liquidish = a => a.kind !== 'loan';
  $(prefix + 'AcctLbl').textContent = acctLabelFor(kind);
  const fromF = kind === 'transfer' ? liquidish : a => !isInvest(a.kind) && a.kind !== 'loan', okAc = (id, f) => { const a = acctById(id); return a && !a.archived && f(a) ? id : null; };
  $(prefix + 'Acct').innerHTML = acctOptions(acct || okAc(lastAcct(kind), fromF) || def, fromF);
  $(prefix + 'ToWrap').classList.toggle('hidden', kind !== 'transfer');
  if (kind === 'transfer') {
    const firstOther = (accts().find(a => a.id !== $(prefix + 'Acct').value && liquidish(a)) || {}).id;
    $(prefix + 'To').innerHTML = acctOptions(to || okAc(lastAcct('transferTo'), liquidish) || firstOther, liquidish);
  }
  const cat = $(prefix + 'CatWrap'); if (cat) cat.classList.toggle('hidden', kind === 'transfer');
}
function finRoute(e) {
  if (!hasAccts()) return '';
  if (e.kind === 'transfer') return `<span class="fin-route">${esc(acctName(e.acct))} → ${esc(acctName(e.to))}</span>`;
  return e.acct && acctById(e.acct) ? `<span class="fin-route">${e.kind === 'expense' || e.kind === 'lent' ? 'from' : 'into'} ${esc(acctName(e.acct))}</span>` : '';
}

/* monthly backup reminder (per device) */
function backupNudge() {
  try {
    const last = +localStorage.getItem('r2_lastBackup') || 0, shown = +localStorage.getItem('r2_backupNudge') || 0, now = Date.now();
    if (now - last < 30 * 86400000 || now - shown < 3 * 86400000) return;
    localStorage.setItem('r2_backupNudge', String(now));
    toast(last ? 'It has been over a month since your last backup.' : 'You have not downloaded a backup on this device yet.', 'Back up', () => $('setBackup').click(), 8000);
  } catch (e) {}
}
$('setBackup').addEventListener('click', () => { try { localStorage.setItem('r2_lastBackup', String(Date.now())); } catch (e) {} });
$('setEraseCode').addEventListener('click', openEraseSetup);
$('setErase').addEventListener('click', openErase);

/* ==========================================================================
   UDHAAR — paying back more than is owed creates the opposite entry
   ======================================================================== */
$('stAmt').addEventListener('input', () => {
  const e = records[settleId]; if (!e) return;
  const rem = outstanding(e), amt = calcAmount($('stAmt').value), who = e.who || 'them';
  $('stHint').textContent = !isNaN(amt) && amt > rem + 0.005
    ? `${fmtMoney(amt - rem)} more than owed. It will be recorded as ${e.kind === 'lent' ? `udhaar liya: you owe ${who}` : `udhaar diya: ${who} owes you`} ${fmtMoney(amt - rem)}.`
    : 'Leave the full amount to settle it, type a smaller part-payment, or a larger amount if more changed hands.';
});

/* entry editor */
let editFinId = null;
function openFin(id) {
  const e = records[id]; if (!e) return;
  editFinId = id;
  $('feAmt').value = e.amount; $('feDesc').value = e.desc || ''; $('feWho').value = e.who || ''; $('feDate').value = e.date || '';
  $('feCat').innerHTML = ['', ...FIN_CATS].map(c => `<option value="${c}" ${c === (e.category || '') ? 'selected' : ''}>${c || '— none —'}</option>`).join('');
  $('fePaid').value = e.paidAmount || 0; $('feSettled').value = e.settled ? 'yes' : 'no'; $('feRecur').checked = !!e.recurring;
  const sync = k => { $('feWhoWrap').classList.toggle('hidden', !isUdhaar(k)); $('fePaidWrap').classList.toggle('hidden', !isUdhaar(k)); acctPick('fe', k, k === e.kind ? e.acct : null, e.to); };
  chipGroup($('feKind'), KINDS, e.kind, sync); sync(e.kind);
  Sheets.open('shFin');
}
$('feSave').addEventListener('click', () => {
  const e = records[editFinId]; if (!e) return;
  const a = calcAmount($('feAmt').value);
  if (isNaN(a) || a <= 0) { toast(String($('feAmt').value).trim() ? `"${String($('feAmt').value).trim().slice(0, 20)}" is not an amount — nothing was saved.` : 'Enter an amount — nothing was saved.'); $('feAmt').focus(); return; }   // v2.19 (B3)
  { const p = calcAmount($('fePaid').value); if (isUdhaar(chipValue($('feKind')) || e.kind) && String($('fePaid').value).trim() && (isNaN(p) || p < 0)) { toast('"Paid back so far" is not an amount — nothing was saved.'); $('fePaid').focus(); return; } }
  if ((chipValue($('feKind')) || e.kind) === 'transfer' && !$('feAcctWrap').classList.contains('hidden') && $('feTo').value === $('feAcct').value) { toast('Pick two different accounts.'); return; }   // checked before anything changes
  e.amount = a;
  e.kind = chipValue($('feKind')) || e.kind; e.desc = $('feDesc').value.trim(); e.who = $('feWho').value.trim();
  e.date = $('feDate').value || e.date; e.category = $('feCat').value; e.recurring = $('feRecur').checked;
  const oldPaid = +e.paidAmount || 0;
  e.paidAmount = Math.max(0, Math.min(calcAmount($('fePaid').value) || 0, e.amount)); e.settled = $('feSettled').value === 'yes';
  if (e.settled) e.paidAmount = e.amount;
  if (isUdhaar(e.kind) && Math.abs(e.paidAmount - oldPaid) >= 0.005 && (e.pays || []).length + (hasAccts() ? 1 : 0) > 0) {   // keep the account side in step (B15)
    let d = e.paidAmount - oldPaid; const pays = (e.pays || []).slice();
    if (d > 0) pays.push({ date: todayISO(), amt: +d.toFixed(2), acct: $('feAcctWrap').classList.contains('hidden') ? (pays.length ? pays[pays.length - 1].acct : null) : $('feAcct').value });
    else { d = -d; while (d > 0.005 && pays.length) { const q = pays[pays.length - 1]; if (+q.amt <= d + 0.005) { d -= +q.amt; pays.pop(); } else { q.amt = +((+q.amt - d).toFixed(2)); d = 0; } } }
    e.pays = pays.filter((q, i) => q.acct || i < (e.pays || []).length);   // a new part-payment needs an account; older records stay
  }
  if (!$('feAcctWrap').classList.contains('hidden')) { e.acct = $('feAcct').value; if (e.kind === 'transfer') { if ($('feTo').value === e.acct) { toast('Pick two different accounts.'); return; } e.to = $('feTo').value; e.category = ''; } else delete e.to; }
  put(e); Sheets.close('shFin'); toast('Saved.');
});
$('feDelete').addEventListener('click', () => { const id = editFinId; Sheets.close('shFin', true); deleteWithUndo(id); });
wireCalc($('feAmt')); wireCalc($('stAmt')); wireCalc($('payAmt')); wireCalc($('bgAmt'));

/* monthly entries roll into the current month when Money is opened */
function rollRecurringOld() {
  const thisM = isoMonth(new Date());
  const seen = new Set(Object.values(records).filter(e => e.type === 'fin').map(e => (e.recurSrc || e.id) + '|' + (e.date || '').slice(0, 7)));   // deleted copies count too
  let made = 0;
  all('fin').filter(e => e.recurring).forEach(e => {
    const src = e.recurSrc || e.id;
    if ((e.date || '').slice(0, 7) >= thisM || seen.has(src + '|' + thisM)) return;
    const day = Math.min(+(e.date || '').slice(8, 10) || 1, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
    const n = { ...e, id: uid('f'), date: thisM + '-' + String(day).padStart(2, '0'), recurSrc: src, settled: false, paidAmount: 0, createdAt: nowMs() };
    delete n._dirty; delete n.pays; delete n.planRef; delete n.billRef; if (n.kind !== 'transfer') delete n.to; put(n, { render: false }); seen.add(src + '|' + thisM); made++;
  });
  if (made) toast(`${made} monthly entr${made === 1 ? 'y' : 'ies'} added for this month.`);
}

/* ==========================================================================
   QUICK ADD — one sheet for everything, opened by the + button.
   Picks the type that matches the tab you're on.
   ======================================================================== */
const ADD_TYPES = [
  { k: 'task', i: '☑︎', l: 'Task' }, { k: 'note', i: '🗒', l: 'Note' },
  { k: 'date', i: '📅', l: 'Key date' }, { k: 'doc', i: '📁', l: 'Document' }, { k: 'money', i: '₹', l: 'Money', priv: true }
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
  $('addTypes').innerHTML = ADD_TYPES.filter(t => !t.priv || finUnlocked()).map(t =>
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

function renderAddForm(focus) { Dictate.stop(); renderAddForm0(focus); ['afTitle', 'afBody'].forEach(i => { if ($(i) && addKind !== 'money') addMic($(i)); }); }
function renderAddForm0(focus) {
  const f = $('addForm'); Object.keys(AF).forEach(k => delete AF[k]);
  const k = addKind;
  if (k === 'task') {
    f.innerHTML = `<div class="field"><input id="afTitle" placeholder="What needs doing?" autocomplete="off" enterkeyhint="done"></div>
      <div class="wrapchips" id="afSyntax" style="margin:-6px 0 6px"></div>
      <div class="guess" id="afGuess"></div>
      <div class="field" style="margin-top:12px"><label>Due</label><div class="wrapchips" id="afDue"></div>
        <input type="date" id="afDate" class="hidden" style="margin-top:8px"></div>
      <div class="field"><label>Category</label><div class="wrapchips" id="afCat"></div></div>
      <div class="field"><label>Priority</label><div class="wrapchips" id="afPrio"></div></div>
      <button class="linkbtn" id="afTpl">⧉ Start from a template</button>`;
    AF.due = ''; AF.cat = 'auto'; AF.prio = 'auto';
    $('afSyntax').innerHTML = ['#work', '#personal', '#finance', '#errands', '!high', '!low', '@today', '@tomorrow', '@mon', '@15sep'].map(s => `<button class="chip" style="padding:5px 10px;font-size:13px">${s}</button>`).join('');
    $$('#afSyntax .chip').forEach(c => c.addEventListener('click', () => {
      const tok = c.textContent, inp = $('afTitle'); let v = inp.value;
      if (tok[0] === '#') v = v.replace(/#\w+/g, ''); else if (tok[0] === '!') v = v.replace(/![a-z]+/gi, ''); else v = v.replace(/@\S+/g, '');
      inp.value = (v.trim() + ' ' + tok).trim() + ' '; inp.focus(); taskGuess();
    }));
    dueChips($('afDue'), '', v => { if (v === 'pick') { $('afDate').classList.remove('hidden'); $('afDate').focus(); AF.due = $('afDate').value; } else { $('afDate').classList.add('hidden'); AF.due = v; } taskGuess(); });
    $('afDate').addEventListener('change', () => { AF.due = $('afDate').value; taskGuess(); });
    chipGroup($('afCat'), [{ v: 'auto', l: 'Auto' }, ...CATS.map(c => ({ v: c, l: c }))], 'auto', v => { AF.cat = v; taskGuess(); }, c => c === 'auto' ? 'var(--ink-faint)' : catColor(c));
    chipGroup($('afPrio'), [{ v: 'auto', l: 'Auto' }, ...PRIOS.map(p => ({ v: p, l: p }))], 'auto', v => { AF.prio = v; taskGuess(); }, p => p === 'auto' ? 'var(--ink-faint)' : PRIO_COLOR[p]);
    $('afTitle').addEventListener('input', taskGuess);
    $('afTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveAdd(true); } });
    $('afTpl').addEventListener('click', openTemplates);
    taskGuess();
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
    AF.rep = YEARLY_CATS.includes(datePath) ? 'yearly' : 'once'; AF.repSet = false; chipGroup($('afRep'), [{ v: 'once', l: 'Once' }, { v: 'yearly', l: 'Every year' }, { v: 'monthly', l: 'Every month' }], AF.rep, v => { AF.rep = v; AF.repSet = true; });
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
        <div class="field"><label>Year (FY, optional)</label><select id="afFy">${fyOptions('', '— none —')}</select></div></div>`;
    AF.type = docNewType(); chipGroup($('afType'), DOC_TYPES, AF.type, v => AF.type = v, t => DOC_COLORS[t]);
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
      <div class="field hidden" id="afWhoWrap"><label>Person</label><input id="afWho" list="peopleDl" placeholder="Who?" autocomplete="off"></div>
      <div class="grid2 hidden" id="afAcctWrap"><div class="field"><label id="afAcctLbl">Paid from</label><select id="afAcct"></select></div><div class="field hidden" id="afToWrap"><label>To</label><select id="afTo"></select></div></div>
      <div class="field" id="afCatWrap"><label>Category</label><div class="wrapchips" id="afCat"></div></div>
      <div class="field"><label>Date</label><div class="wrapchips" id="afWhen"></div><input type="date" id="afDate" class="hidden" style="margin-top:8px"></div>
      <div class="group"><label class="switch-row">Repeats every month<input type="checkbox" class="sw" id="afRecur"></label></div>`;
    AF.kind = 'expense'; AF.cat = ''; AF.when = todayISO();
    const kindChips = sel => chipGroup($('afKind'), KINDS, sel, v => { AF.kind = v; $('afWhoWrap').classList.toggle('hidden', !isUdhaar(v)); acctPick('af', v); });
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
    /* fill the form from a parsed line or a recent entry; the date shown is the one used */
    AF.fill = (x) => {
      $('afAmt').value = x.amount > 0 ? x.amount : ''; $('afAmt').dispatchEvent(new Event('input'));
      $('afTitle').value = x.desc || ''; $('afWho').value = x.who || '';
      AF.kind = x.kind || 'expense'; kindChips(AF.kind); $('afWhoWrap').classList.toggle('hidden', !isUdhaar(AF.kind)); acctPick('af', AF.kind, x.acct || null, x.to || null);
      AF.cat = x.kind === 'transfer' ? '' : (x.cat || ''); AF.catTouched = !!x.cat; catChips(AF.cat);
      AF.when = x.date || todayISO();
      if (AF.when === todayISO() || AF.when === addDays(-1)) whenChips(AF.when); else { whenChips('pick'); $('afDate').classList.remove('hidden'); $('afDate').value = AF.when; }
    };
    $$('[data-rec]', f).forEach(b => b.addEventListener('click', () => { const e = recent[+b.dataset.rec]; AF.fill({ amount: e.amount, kind: e.kind, desc: e.desc, who: e.who, acct: e.acct, to: e.to, cat: e.category, date: todayISO() }); $('afAmt').focus(); toast('Filled in — change anything, then Save.'); }));
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
  const first = f.querySelector(k === 'money' ? '#afQuick' : '#afTitle');
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

function saveAdd(another) {
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
    put({ id: uid('doc'), type: 'doc', title: l, docType: AF.type, number: v('afNum'), expiry: v('afDate') || null, issuer: '', notes: '', folder: docFolderForNew(), fy: v('afFy') || null, who: normWho(v('afDocWho')), dueKind: $('afDueKind') ? $('afDueKind').value : 'expiry', deleted: false }); { const nd = all('doc').sort((a, b) => b.createdAt - a.createdAt)[0]; if (nd && nd.expiry) { syncDocDate(nd); toast('Document added — the ' + dueWord(nd.dueKind) + ' is in Dates too.'); } }
    toast(docFolderForNew() ? 'Document added to ' + docFolderForNew() + '.' : 'Document added.');
  } else if (k === 'money') {
    const useAcct = !$('afAcctWrap').classList.contains('hidden');
    const rec = saveMoneyEntry({ amount: calcAmount(v('afAmt')), kind: AF.kind, desc: v('afTitle'), who: v('afWho'), cat: AF.kind === 'transfer' ? '' : AF.cat || '',
      date: AF.when || todayISO(), acct: useAcct ? $('afAcct').value : undefined, to: useAcct && AF.kind === 'transfer' ? $('afTo').value : undefined, recurring: $('afRecur').checked, fromForm: true });
    if (!rec) return;
    toast(`Recorded ${fmtMoney(rec.amount)}.`, 'Undo', () => softDelete(rec.id));
  }
  addDraft = null;
  if (another) renderAddForm(true); else Sheets.close('shAdd', true);
}
$('addSave').addEventListener('click', () => saveAdd(false));
$('addAnother').addEventListener('click', () => saveAdd(true));

/* ==========================================================================
   APP — tabs, search, privacy (decoy + private section), settings, import, boot
   ======================================================================== */
let currentTab = 'tasks';
const TAB_SCREENS = { tasks: 'scr-tasks', notes: 'scr-notes', dates: 'scr-dates', docs: 'scr-docs', money: 'scr-money' };
function showTab(tab) {
  if (tab === 'money' && !finUnlocked()) tab = 'tasks';
  if (currentTab !== tab) $('main').scrollTop = 0;
  currentTab = tab;
  if (tab !== 'money') setPref('lastTab', tab);
  Object.entries(TAB_SCREENS).forEach(([k, id]) => $(id).classList.toggle('on', k === tab));
  $$('.tab').forEach(t => { const on = t.dataset.tab === tab; t.classList.toggle('on', on); t.setAttribute('aria-current', on ? 'page' : 'false'); });
  renderAll();
}
$$('.tab').forEach(t => t.addEventListener('click', () => {
  if (t.dataset.tab === currentTab) { $('main').scrollTo({ top: 0, behavior: 'smooth' }); if (currentTab === 'notes' && activeFolder !== '__all__') { activeFolder = '__all__'; renderNotes(); } if (currentTab === 'dates' && datePath) { datePath = null; renderDates(); } if (currentTab === 'docs' && (docPath.who || activeDocFolder !== '__all__')) { activeDocFolder = '__all__'; docPath = { who: null, grp: null }; renderDocs(); } return; }
  showTab(t.dataset.tab);
}));
function renderAll() {
  if (typeof updateTodayBadge === 'function') setTimeout(updateTodayBadge, 0);
  const n = new Date();
  $('todayLbl').textContent = n.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  updateDateBadge();
  if (currentTab === 'tasks') renderTasks();
  else if (currentTab === 'notes') renderNotes();
  else if (currentTab === 'dates') renderDatesTab();
  else if (currentTab === 'docs') renderDocs();
  else if (currentTab === 'money') renderMoney();
}

/* ---------- search ---------- */
function hl(text, q) {
  const s = String(text || ''), i = s.toLowerCase().indexOf(q);
  if (i < 0) return esc(s.slice(0, 80));
  const from = Math.max(0, i - 25);
  return (from ? '…' : '') + esc(s.slice(from, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length, i + q.length + 50));
}
function runSearchBase() {
  const q = $('searchIn').value.trim().toLowerCase(), box = $('searchRes');
  if (!q) { box.innerHTML = '<div class="empty">Type to search tasks, steps, notes, dates and documents (try “aadhar ruchi”), or ask: “when does Ruchi\'s passport expire?”, “birthdays this month”, “spent on food in August”' + (finUnlocked() ? ' — and Money' : '') + '.</div>'; return; }
  const hits = [], has = s => String(s || '').toLowerCase().includes(q);
  all('task').forEach(t => {
    if (has(t.title)) hits.push({ k: 'Task', id: t.id, t: hl(t.title, q), s: t.status === 'done' ? 'done' : relDay(t.dueDate) });
    else if (has(t.notes)) hits.push({ k: 'Task', id: t.id, t: esc(t.title) + '<br><small class="muted">' + hl(t.notes, q) + '</small>' });
    else { const st = (t.subs || []).find(s => has(s.text) || has(s.notes)); if (st) hits.push({ k: 'Step', id: t.id, t: hl(st.text, q) + '<br><small class="muted">in ' + esc(t.title) + '</small>' }); }
  });
  if (finUnlocked()) all('snote').forEach(n => { if (has(n.title) || has(n.text) || has(n.folder)) hits.push({ k: 'Private', id: n.id, t: has(n.title) ? hl(n.title, q) : esc(n.title || 'Untitled') + '<br><small class="muted">' + hl(n.text, q) + '</small>', s: 'private note' }); });
  all('note').forEach(n => { if (has(n.title) || has(n.text) || has(n.folder)) hits.push({ k: 'Note', id: n.id, t: has(n.title) ? hl(n.title, q) : esc(n.title || 'Untitled') + '<br><small class="muted">' + hl(n.text, q) + '</small>', s: n.folder || '' }); });
  all('date').forEach(d => { if (has(d.label)) hits.push({ k: 'Date', id: d.id, t: hl(d.label, q), s: d.when ? fmtDate(isoLocal(nextOccurrence(d))) : 'no date yet' }); });
  { const norm = s => String(s || '').toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence');
    const toks = norm(q).split(/\s+/).filter(Boolean), docHits = [];
    all('doc').forEach(d => {
      const own = docOwners(d), files = docFilesOf(d.id).map(f => f.name + ' ' + (f.txt || '')).join(' ');
      const hay = norm([d.title, own.join(' '), d.who, d.docType, docGroup(d), d.number, d.numTail, d.notes, d.issuer, d.fy ? 'fy ' + d.fy + ' ' + d.fy : '', docYears(d).join(' '), files].join(' | '));
      if (!toks.every(tk => hay.includes(tk) || (PERSON_ALIAS[tk] && hay.includes(PERSON_ALIAS[tk].toLowerCase())))) return;
      const sub = [docGroup(d) + ' › ' + d.docType, d.fy ? 'FY ' + d.fy : '', docNumShown(d)].filter(Boolean).join(' · ');
      const plainHay = norm([d.title, own.join(' '), d.who, d.docType, docGroup(d), d.number, d.numTail, d.notes, d.issuer, docFilesOf(d.id).map(f => f.name).join(' ')].join(' '));
      const sn = toks.some(tk => !plainHay.includes(tk)) ? docTextSnippet(d, toks) : null;      // found inside a PDF's words
      docHits.push({ k: 'Doc', id: d.id, own, t: hl(d.title, toks[0]) + ` · <b>${esc(own.join(' & '))}</b><br><small class="muted">${esc(sub)}</small>${sn ? `<br><small class="muted">📄 ${sn.html}</small>` : ''}`, s: own.join(' & ') });
    });
    const ordL = orderPeople(docHits.map(h => h.own[0]));
    docHits.sort((a, b) => ordL.indexOf(a.own[0]) - ordL.indexOf(b.own[0])).forEach(h => hits.push(h)); }
  if (finUnlocked()) all('fin').forEach(f => { if (has(f.desc) || has(f.who)) hits.push({ k: '₹', id: f.id, t: hl(f.desc + (f.who ? ' · ' + f.who : ''), q), s: fmtMoney(f.amount) }); });
  const ans = askAnswer($('searchIn').value);
  if (ans) (ans.items || []).slice().reverse().forEach(h => hits.unshift({ ...h, ask: true }));
  box.innerHTML = (ans ? `<div class="ask-card"><div class="ask-h">Answer · from your data on this phone</div><div class="ask-a">${esc(ans.text)}</div></div>` : '') + (hits.length ? hits.filter((h, i, a) => a.findIndex(x => x.id === h.id && x.k === h.k) === i).slice(0, 80).map(h => `<button class="sr" data-k="${h.k}" data-id="${h.id}"><span class="k">${h.k}</span><span class="t" style="white-space:normal">${h.t}</span><span class="s">${esc(h.s || '')}</span></button>`).join('')
    : ans ? '' : '<div class="empty">No matches.</div>');
  $$('.sr', box).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.id, k = b.dataset.k; Sheets.close('shSearch', true);
    if (k === 'Task' || k === 'Step') { showTab('tasks'); previewTask(id); }
    else if (k === 'Note') { showTab('notes'); previewNote(id); }
    else if (k === 'Private') { setPref('moneySeg', 'snotes'); showTab('money'); previewNote(id); }
    else if (k === 'Date') { setPref('dateSeg', 'dates'); datePath = null; showTab('dates'); openDate(id); }
    else if (k === 'Bill') { setPref('dateSeg', 'bills'); showTab('dates'); openBill(id); }
    else if (k === 'Doc') { showTab('docs'); showDoc(id); }
    else if (k === '₹') { const f = records[id]; if (f && f.date) finMonth = f.date.slice(0, 7); setPref('moneySeg', 'ledger'); showTab('money'); openFin(id); }
  }));
}
function openSearch() { $('searchIn').value = ''; runSearch(); Sheets.open('shSearch'); setTimeout(() => $('searchIn').focus(), 300); }
$('searchOpen').addEventListener('click', openSearch);
$('searchIn').addEventListener('input', runSearch);

/* ---------- privacy: decoy screen ---------- */
function showDecoy() {
  Sheets.closeAll(); addDraft = null;
  if (!$('lightbox').classList.contains('hidden')) $('lbClose').click();
  document.documentElement.classList.add('decoy-on');
  $('decoy').classList.remove('hidden'); $('decoy').setAttribute('aria-hidden', 'false');
  $('app').setAttribute('aria-hidden', 'true');
}
let legacyOffer = false;
function offerLegacy() {
  if (!legacyOffer) return; legacyOffer = false;
  setTimeout(() => { if (confirm('Found your data from the previous Register on this iPhone. Bring it into the new version?')) importLegacyLocal(); else { try { localStorage.setItem('r2_legacyDone', '1'); } catch (e) {} } }, 500);
}
function hideDecoy() {
  if ($('alPin')) $('alPin').classList.add('hidden');
  document.documentElement.classList.remove('decoy-on');
  $('decoy').classList.add('hidden'); $('decoy').setAttribute('aria-hidden', 'true');
  $('app').removeAttribute('aria-hidden');
  scheduleRender();
  offerLegacy();
  if (window.__booted && typeof afterAppShown === 'function') afterAppShown();
}
let decoyTaps = 0, decoyT = null;
$('decoyKey').addEventListener('click', () => {
  decoyTaps++; clearTimeout(decoyT); decoyT = setTimeout(() => { decoyTaps = 0; }, 2000);
  if (decoyTaps >= 3) { decoyTaps = 0; decoyUnlock(); }
});
$('decoyRetry').addEventListener('click', () => { const b = $('decoyRetry'); b.disabled = true; b.textContent = 'Retrying…'; setTimeout(() => { b.disabled = false; b.textContent = 'Retry'; }, 1500); });
function hideNow() { lockFinance(true); showDecoy(); }
$('hideBtn').addEventListener('click', hideNow);
let hiddenAt = 0, lastTouch = Date.now();
function flushEdits() {
  try {
    if (typeof teTimer !== 'undefined' && teTimer) { clearTimeout(teTimer); teTimer = null; teSave(); }
    if (typeof neTimer !== 'undefined' && neTimer) { clearTimeout(neTimer); neTimer = null; neSave(); }
    ['shDoc', 'shDate', 'shBill'].forEach(id => { if (Sheets.isOpen(id) && AutoSheet.changed(id)) AutoSheet.save(id); });
  } catch (e) { RLOG.warn('flushEdits', e.message); }
}
window.addEventListener('pagehide', flushEdits);
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));
setInterval(() => { if (finUnlocked() && document.visibilityState === 'visible' && Date.now() - Math.max(lastTouch, Fin.unlockedAt || 0) > (+prefs.moneyIdle || 5) * 60000) { lockFinance(); } }, 30000);   // idle 5 min → lock Money
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = nowMs();
    flushEdits();
    if (finUnlocked()) document.documentElement.classList.add('app-hidden');
    RLOG.flush();
    if (+prefs.decoyReturn === 0) hideNow();          // also keeps the app-switcher preview blank
  } else {
    document.documentElement.classList.remove('app-hidden');
    const secs = +prefs.decoyReturn;
    if (secs > 0 && hiddenAt && nowMs() - hiddenAt >= secs * 1000) hideNow();
    else if (secs < 0 && hiddenAt && nowMs() - hiddenAt >= 300000) lockFinance(true);   // decoy off: still relock money after 5 min
    scheduleRender();                                  // dates roll over at midnight
  }
});

/* ---------- privacy: private Money section (3 taps on "Register") ---------- */
let wmTaps = 0, wmT = null, vaultMode = 'unlock';
$('wordmark').addEventListener('click', () => {
  wmTaps++; clearTimeout(wmT); wmT = setTimeout(() => { wmTaps = 0; }, 2000);
  if (wmTaps < 3) return;
  wmTaps = 0;
  if (window.GHOST) { ghostCrash(true); return; }
  if (finUnlocked()) { showTab('money'); return; }
  openVault();
});
function openVault(mode) {
  if (window.GHOST) { ghostCrash(true); return; }
  vaultMode = mode || (finConfigured() ? 'unlock' : 'setup');
  if (vaultMode === 'setup' && Sync.on() && !Sync.lastOk) {
    toast('Syncing first, so this iPhone picks up your existing code…'); Sync.run().then(ok => { if (ok) openVault(); }); return;
  }
  $('vaCode').value = ''; $('vaCode2').value = ''; $('vaErr').textContent = '';
  const setup = vaultMode === 'setup', change = vaultMode === 'change';
  $('vaTitle').textContent = setup ? 'Private section' : change ? 'New code' : 'Restricted';
  $('vaSub').textContent = setup ? 'Choose an access code. Money entries are encrypted with it — if it is forgotten, they cannot be read.' : change ? 'Enter the new code twice. Everything is re-encrypted with it.' : 'Enter the access code.';
  if (setup && !Sync.on()) $('vaSub').textContent += ' Already use Register on another device? Connect sync first (Settings → Sync), so this device uses the same code.';
  $('vaCode2').classList.toggle('hidden', !(setup || change));
  $('vaOk').textContent = setup ? 'Set code' : change ? 'Change code' : 'Unlock';
  const bioOn = vaultMode === 'unlock' && Bio.on();
  $('vaBio').classList.toggle('hidden', !bioOn);
  Sheets.open('shVault');
  if (bioOn) bioAuto(); else setTimeout(() => $('vaCode').focus(), 320);
}
async function vaultSubmit() {
  const c = $('vaCode').value, c2 = $('vaCode2').value, err = $('vaErr');
  if (vaultMode === 'bioconfirm') {
    try { await Bio.confirm(); Sheets.close('shVault', true); toast('Face ID unlock is on for this device. Next time, opening Money asks for Face ID.'); }
    catch (e) { RLOG.warn('face id confirm', e.name, e.message); err.textContent = e.name === 'NotAllowedError' ? 'Face ID was cancelled or timed out — tap Confirm again.' : (e.message || 'Could not turn on Face ID.'); }
    return;
  }
  if (!c) { err.textContent = 'Enter the code.'; return; }
  if (vaultMode === 'bio') {
    const fk = records[FINKEY_ID];
    try { const k = await deriveFinKey(c, fk.salt, fk.iters); if (await aesDec(k, fk.check) !== 'register-ok') throw new Error('x'); }
    catch (e) { const w = VaultLimit.fail(); err.textContent = w ? `Incorrect code. Wait ${VaultLimit.say(w)}.` : 'Incorrect code.'; return; }
    VaultLimit.reset();
    try { const r = await Bio.enable(c); if (r === 'confirm') { vaultMode = 'bioconfirm'; $('vaSub').textContent = 'Almost done — tap the button below and look at the phone once more.'; $('vaOk').textContent = 'Confirm with Face ID'; return; }
      Sheets.close('shVault', true); toast('Face ID unlock is on for this device.'); }
    catch (e) { RLOG.warn('face id setup', e.name, e.message); err.textContent = e.name === 'NotAllowedError' ? 'Face ID was cancelled or timed out. Check that iCloud Keychain (Passwords) is on, then try again.' : e.name === 'InvalidStateError' ? 'A Register passkey already exists — try again.' : (e.message || 'Could not turn on Face ID.'); }
    return;
  }
  if (vaultMode !== 'unlock') {
    if (c.length < FIN_MIN_CODE) { err.textContent = `Use at least ${FIN_MIN_CODE} characters — a short phrase you can remember is best.`; return; }
    if (c !== c2) { err.textContent = "The two entries don't match."; return; }
    $('vaOk').disabled = true;
    try {
      if (vaultMode === 'setup') await setupFinance(c); else await changeFinanceCode(c);
    } finally { $('vaOk').disabled = false; }
    Sheets.close('shVault', true);
    toast(vaultMode === 'setup' ? 'Private section ready.' : 'Code changed. Other devices will ask for the new one.');
    afterFinanceUnlock(); return;
  }
  const wait = VaultLimit.wait(); if (wait) { err.textContent = `Too many wrong tries. Try again in ${VaultLimit.say(wait)}.`; return; }
  $('vaOk').disabled = true; err.textContent = 'Checking…';
  const ok = await unlockFinance(c);
  $('vaOk').disabled = false;
  if (ok) VaultLimit.reset(); else { const w = VaultLimit.fail(); err.textContent = w ? `Incorrect code. Too many wrong tries — wait ${VaultLimit.say(w)}.` : 'Incorrect code.'; }
  if (!ok) { const card = $('vaultCard'); card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 400); $('vaCode').value = ''; return; }
  Sheets.close('shVault', true);
  afterFinanceUnlock();
}
const VaultLimit = {
  get() { try { return JSON.parse(localStorage.getItem('r2_vf') || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } },
  set(v) { try { localStorage.setItem('r2_vf', JSON.stringify(v)); } catch (e) {} },
  wait() { const v = this.get(); return Math.max(0, v.until - Date.now()); },
  fail() { const v = this.get(); v.n++; if (v.n >= 5) v.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, v.n - 5)); this.set(v); return this.wait(); },
  reset() { this.set({ n: 0, until: 0 }); },
  say(ms) { const s = Math.ceil(ms / 1000); return s >= 60 ? Math.ceil(s / 60) + ' min' : s + ' sec'; }
};
function afterFinanceUnlock() {
  $('moneyTab').classList.remove('hidden');
  if (typeof finAfterUnlock === 'function') finAfterUnlock();
  sealDocNumbers();
  setTimeout(() => AutoBackup.maybe(), 4000);
  if (Fin.codeLen && Fin.codeLen < FIN_MIN_CODE && !window.__shortCodeNag) { window.__shortCodeNag = true; setTimeout(() => toast(`Your private code is short and could be guessed. Change it to ${FIN_MIN_CODE}+ characters — a short phrase works well.`, 'Change', () => openVault('change'), 9000), 2500); }
  flushPendingPosts(); healFileKeys(); rollAfterSync(); settleErasedWin().catch(e => RLOG.warn('erased win', e.message)); if (typeof syncAllAcctDates === 'function') setTimeout(() => { try { syncAllAcctDates(); } catch (e) { RLOG.warn('acct dates', e.message); } }, 2500); setTimeout(() => { try { sweepOrphans(); } catch (e) { RLOG.warn('sweep', e.message); } }, 8000); setTimeout(backupNudge, 1500);
  if (pendingGo === 'spend') { pendingGo = null; setTimeout(() => { showTab('money'); openAdd('money'); }, 350); }
  if (pendingAfterUnlock) { const f = pendingAfterUnlock; pendingAfterUnlock = null; docReturn = null; setTimeout(() => { try { f(); } catch (e) { RLOG.error('after unlock', e); } }, 350); return; }
  const back = docReturn; docReturn = null;
  if (back && Sheets.isOpen('shDocView')) { openDocView(back); return; }
  showTab('money');
}
function onFinanceLocked(silent) {
  $('moneyTab').classList.add('hidden'); clearFinFilter();
  Bio.pending = null;                                                    // a half-finished Face ID setup keeps no code
  if (!$('lightbox').classList.contains('hidden')) $('lbClose').click();
  if (Sheets.isOpen('shDoc')) { const d = records[editDocId]; if (d && (d.lockFiles || d.numEnc)) { $('doNumber').value = d.numEnc ? '•••• ' + (d.numTail || '') : ''; $('doNumber').disabled = true; } }
  const sd = records[Scan.docId], lockedScan = (Scan.replace && Scan.replace.locked) || (sd && sd.lockFiles);
  ['shFin', 'shSettle', 'shBudget', 'shInsights', 'shEmerg', 'shDocView', 'shDocShare', 'shPlan', ...(lockedScan ? ['shScan', 'shCrop'] : [])].forEach(id => Sheets.close(id, true));
  pendingAfterUnlock = null;
  forgetLockedPlain(); forgetSecretImgs();
  if (currentTab === 'money') showTab(prefs.lastTab || 'tasks');
  if (!silent) toast('Private section locked.');
}
$('vaOk').addEventListener('click', vaultSubmit);
const Bio = {
  KEY: 'r2_bio',
  supported() { return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext); },
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  on() { const b = this.get(); return !!(b && finConfigured() && records[FINKEY_ID] && b.kid === records[FINKEY_ID].kid); },
  forget() { try { localStorage.removeItem(this.KEY); } catch (e) {} },
  rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); },
  async wrapKey(prfOut) {
    const base = await crypto.subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('register-bio-v1'), info: te.encode('private-code') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async prf(rawId, salt) {
    const a = await navigator.credentials.get({ publicKey: { challenge: this.rnd(32), allowCredentials: [{ type: 'public-key', id: rawId }], userVerification: 'required', timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } } });
    const r = a.getClientExtensionResults(); if (!r.prf || !r.prf.results || !r.prf.results.first) throw new Error('Face ID unlock is not supported on this device.');
    return r.prf.results.first;
  },
  async enable(code) {
    const salt = this.rnd(32);
    const cred = await navigator.credentials.create({ publicKey: { challenge: this.rnd(32), rp: { name: 'Register' }, user: { id: this.rnd(16), name: 'register-private', displayName: 'Register private section' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000,
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' }, extensions: { prf: { eval: { first: salt } } } } });
    const ext = cred.getClientExtensionResults();
    if (!ext.prf || ext.prf.enabled === false) throw new Error('Face ID unlock is not supported on this device (needs iOS 18 or later).');
    const p = { id: b64(cred.rawId), salt: b64(salt) };
    if (ext.prf.results && ext.prf.results.first) { await this.finish(code, p, ext.prf.results.first); return 'done'; }
    this.pending = { code, ...p }; return 'confirm';            // Safari needs a second tap to read the key (one Face ID per tap)
  },
  async confirm() { const p = this.pending; if (!p) throw new Error('Start again from Settings.'); const out = await this.prf(unb64(p.id), unb64(p.salt)); await this.finish(p.code, p, out); this.pending = null; },
  async finish(code, p, out) { const box = await aesEnc(await this.wrapKey(out), code); localStorage.setItem(this.KEY, JSON.stringify({ id: p.id, salt: p.salt, box, kid: records[FINKEY_ID].kid })); },
  async unlock() {
    const b = this.get(); if (!b) return false;
    const code = await aesDec(await this.wrapKey(await this.prf(unb64(b.id), unb64(b.salt))), b.box);
    const ok = await unlockFinance(code);
    if (!ok) this.forget();
    return ok;
  }
};
let bioAutoRun = false;
function bioAuto() { bioAutoRun = true; $('vaBio').click(); }       // still inside the tap that opened Money, so Face ID may start at once
$('vaBio').addEventListener('click', async () => {
  const auto = bioAutoRun; bioAutoRun = false;
  const err = $('vaErr'); err.textContent = '';
  try { if (await Bio.unlock()) { VaultLimit.reset(); Sheets.close('shVault', true); afterFinanceUnlock(); } else { err.textContent = 'The code changed — enter it once, then turn Face ID on again in Settings.'; $('vaBio').classList.add('hidden'); } }
  catch (e) { RLOG.warn('face id unlock', e.name, e.message); if (auto && e.name === 'NotAllowedError') return; err.textContent = e.name === 'NotAllowedError' ? 'Face ID cancelled — tap Unlock with Face ID, or type the code.' : (e.message || 'Face ID failed.'); }
});
$('setBio').addEventListener('click', () => {
  if (!finUnlocked() && !Bio.on()) { toast('Open Money with your private code first, then turn this on.'); return; }
  if (Bio.on()) { Bio.forget(); $('setBioV').textContent = 'Off'; toast('Face ID unlock turned off on this device.'); return; }
  Sheets.close('shSettings', true);
  vaultMode = 'bio'; $('vaCode').value = ''; $('vaErr').textContent = ''; $('vaCode2').classList.add('hidden'); $('vaBio').classList.add('hidden');
  $('vaTitle').textContent = 'Face ID'; $('vaSub').textContent = 'Enter your private code once. Then Face ID (or fingerprint / Windows Hello) opens Money on this device.'; $('vaOk').textContent = 'Turn on';
  Sheets.open('shVault'); setTimeout(() => $('vaCode').focus(), 320);
});
['vaCode', 'vaCode2'].forEach(i => $(i).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); vaultSubmit(); } }));

/* ---------- look & feel ---------- */
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyLook() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && darkMQ.matches);
  const h = document.documentElement;
  h.setAttribute('data-theme', dark ? 'dark' : 'light');
  h.setAttribute('data-text', prefs.text || 'default');
  h.setAttribute('data-contrast', prefs.contrast ? 'high' : 'normal');
  h.setAttribute('data-hand', prefs.left ? 'left' : 'right');
  const tc = document.querySelector('meta[name=theme-color]'); if (tc) tc.content = dark ? '#111418' : '#F2EEE3';
  try { localStorage.setItem('r2_look', JSON.stringify({ theme: prefs.theme, text: prefs.text })); } catch (e) {}
}
darkMQ.addEventListener && darkMQ.addEventListener('change', applyLook);

/* ---------- settings ---------- */
$('settingsBtn').addEventListener('click', openSettings);
function openSettings() {
  if (window.GHOST) { ghostCrash(true); return; }
  $('setDecoy').checked = !!prefs.decoyLaunch; $('setDecoyReturn').value = String(prefs.decoyReturn);
  $('setAppLockV').textContent = AppLock.on() ? 'On' : 'Off'; $('setAppIdle').value = String(+prefs.appIdle || 0); $('setMoneyIdle').value = String(+prefs.moneyIdle || 5); $('setMoneyIdleRow').classList.toggle('hidden', !finUnlocked());
  $('setVaultCode').classList.toggle('hidden', !finUnlocked()); $('setVaultLock').classList.toggle('hidden', !finUnlocked());
  $('setBio').classList.toggle('hidden', !finUnlocked() || !Bio.supported()); $('setBioV').textContent = Bio.on() ? 'On' : 'Off';
  ['setAutoBkRow', 'setAutoBkNow', 'setAutoBkTest', 'setBackupEnc'].forEach(i => $(i).classList.toggle('hidden', !finUnlocked()));
  { const w = securityChecks().filter(c => c.state === 'warn').length; $('setSecCheckV').textContent = w ? w + ' to review' : '✓'; }
  $('setIconBadge').checked = !!prefs.iconBadge; $('setDateDays').value = String(prefs.dateBadgeDays || 7);
  $('setBioDiag').classList.add('hidden'); if (finUnlocked() && Bio.supported()) bioDiag().then(s => { if (s) { $('setBioDiag').textContent = s; $('setBioDiag').classList.remove('hidden'); } });
  $('setDictLang').value = prefs.dictLang || 'en-IN';
  $('setAutoBk').checked = !!prefs.autoBackup; $('setAutoBkInfo').textContent = AutoBackup.info();
  $('setUrl').value = prefs.cloudUrl; $('setToken').value = prefs.cloudToken; $('setDrive').value = prefs.driveFolder;
  $('setTheme').value = prefs.theme; $('setText').value = prefs.text; $('setContrast').checked = !!prefs.contrast; $('setLeft').checked = !!prefs.left;
  $('setStart').value = prefs.startTab; $('setSteps').checked = !!prefs.stepsOpen; $('setNoteEdit').checked = !!prefs.noteEdit;
  $('setVer').textContent = 'v' + APP_VERSION;
  const n = Object.keys(records).filter(id => !SEALED_TYPES.has(records[id].type)).length + Object.keys(sealed).length;
  $('setCount').textContent = n.toLocaleString('en-IN');
  const dirty = Object.values(records).filter(r => r._dirty && !SEALED_TYPES.has(r.type)).length + Object.values(sealed).filter(s => s._dirty).length;
  const big = Object.values(records).filter(r => r._tooBig && !r.deleted && !SEALED_TYPES.has(r.type)).length + Object.values(sealed).filter(s => s._tooBig && !s.deleted).length;
  $('setSyncInfo').textContent = Sync.on() ? `Last synced ${Sync.lastOk ? timeAgo(Sync.lastOk) : 'never'}${dirty ? ` · ${dirty} change${dirty > 1 ? 's' : ''} waiting to upload` : big ? ` · ${big} item${big > 1 ? 's are' : ' is'} too large for the Sheet and only on this iPhone (shorten or split ${big > 1 ? 'them' : 'it'})` : ' · everything uploaded'}` : 'Not connected — everything stays on this iPhone.';
  $('setSyncMsg').textContent = ''; $('setDriveMsg').textContent = ''; $('setDataMsg').textContent = '';
  const hasOld = !!localStorage.getItem('reg_recs');
  $('setLegacyLocal').classList.toggle('hidden', !hasOld);
  Sheets.open('shSettings');
}
$('setDecoy').addEventListener('change', () => { setPref('decoyLaunch', $('setDecoy').checked); toast($('setDecoy').checked ? 'Decoy on — tap “Register” three times to get in.' : 'Decoy off at launch.'); });
$('setDecoyReturn').addEventListener('change', () => setPref('decoyReturn', +$('setDecoyReturn').value));
$('setHideNow').addEventListener('click', hideNow);
$('setVaultCode').addEventListener('click', () => { Sheets.close('shSettings', true); openVault('change'); });
$('setVaultLock').addEventListener('click', () => { lockFinance(); Sheets.close('shSettings'); });
$('setTheme').addEventListener('change', () => { setPref('theme', $('setTheme').value); applyLook(); });
$('setText').addEventListener('change', () => { setPref('text', $('setText').value); applyLook(); });
$('setContrast').addEventListener('change', () => { setPref('contrast', $('setContrast').checked); applyLook(); });
$('setLeft').addEventListener('change', () => { setPref('left', $('setLeft').checked); applyLook(); });
$('setStart').addEventListener('change', () => setPref('startTab', $('setStart').value));
$('setSteps').addEventListener('change', () => { setPref('stepsOpen', $('setSteps').checked); openSteps.clear(); scheduleRender(); });
$('setNoteEdit').addEventListener('change', () => setPref('noteEdit', $('setNoteEdit').checked));
$('setDictLang').addEventListener('change', () => setPref('dictLang', $('setDictLang').value));
$('setConnect').addEventListener('click', async () => {
  const url = normaliseScriptUrl($('setUrl').value), token = $('setToken').value.trim(), msg = $('setSyncMsg');
  $('setUrl').value = url;
  if (!scriptUrlOk(url)) { msg.className = 'msg err'; msg.textContent = 'That should be the https://script.google.com/macros/s/…/exec URL.'; return; }
  if (!token) { msg.className = 'msg err'; msg.textContent = 'Enter the token.'; return; }
  const oldUrl = prefs.cloudUrl;
  // v2.19 (S8): once this device has synced with a Sheet, switching to another script address must be deliberate
  if (oldUrl && oldUrl !== url && (await DB.get('firstSync'))
      && !confirm('This is a different Apps Script address from the one this device syncs with.\n\nYour token and data will be sent to the new address from now on. Only continue if you set up that script yourself.')) { $('setUrl').value = oldUrl; msg.className = 'msg'; msg.textContent = 'Kept the current address.'; return; }
  setPref('cloudUrl', url); setPref('cloudToken', token);
  msg.className = 'msg'; msg.textContent = 'Connecting…';
  try {
    const d = await Sync.call('ping');
    if (!d.v || d.v < 16) throw new Error('This is the old script — paste the new Code.gs (v16) and redeploy.');
    if (oldUrl !== url) {                                                        // new Sheet → fetch everything, and everything local must reach it
      await DB.set('cursor', 0); await DB.set('firstSync', 0); window.__synced = false;
      Object.values(records).forEach(r => { if (!SEALED_TYPES.has(r.type)) r._dirty = 1; }); Object.values(sealed).forEach(s => { s._dirty = 1; });
      await DB.putMany([...Object.values(records).filter(r => !SEALED_TYPES.has(r.type)), ...Object.values(sealed)]);
    }
    msg.textContent = 'Connected. Syncing…';
    const ok = await Sync.run();
    msg.className = 'msg ' + (ok ? 'ok' : 'err'); msg.textContent = ok ? 'Connected and synced.' : 'Connected, but the sync failed — see Download log.';
    if (ok) { msg.textContent += ' Checking for data from the old version…'; const r = await autoMigrate(true); msg.textContent = r.text; msg.className = 'msg ' + (r.ok ? 'ok' : 'err'); }
  } catch (e) { msg.className = 'msg err'; msg.textContent = 'Could not connect: ' + e.message; RLOG.error('connect', e.message); }
});
$('setDisconnect').addEventListener('click', () => {
  if (!confirm('Disconnect sync? Everything stays on this iPhone.')) return;
  setPref('cloudUrl', ''); setPref('cloudToken', ''); $('setUrl').value = ''; $('setToken').value = '';
  Sync.status('', 'Local only'); $('setSyncMsg').textContent = 'Disconnected.';
});
$('syncBtn').addEventListener('click', () => Sync.run(true));
$('setDriveSave').addEventListener('click', () => {
  const raw = $('setDrive').value.trim(), m = $('setDriveMsg');
  if (!raw) { setPref('driveFolder', ''); m.textContent = 'Cleared — pictures will be shrunk into the Sheet.'; return; }
  const id = parseFolderId(raw); if (!id) { m.className = 'msg err'; m.textContent = "Couldn't find a folder ID in that."; return; }
  setPref('driveFolder', id); $('setDrive').value = id; m.className = 'msg ok'; m.textContent = 'Saved. Tap Test to check it works.';
});
$('setDriveTest').addEventListener('click', async () => {
  const m = $('setDriveMsg');
  if (!driveOn()) { m.className = 'msg err'; m.textContent = 'Connect the Sheet and save a folder first.'; return; }
  m.className = 'msg'; m.textContent = 'Testing…';
  try {
    const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const id = await driveUpload(px, 'register-test.png'); memImg.delete(id); await DB.imgDel(id);
    await driveFetch(id); await driveDelete(id);
    m.className = 'msg ok'; m.textContent = 'Working — upload, read and delete all succeeded.';
  } catch (e) { m.className = 'msg err'; m.textContent = 'Failed: ' + e.message; }
});
$('setTpl').addEventListener('click', () => { Sheets.close('shSettings', true); openTemplates(); });
$('setLog').addEventListener('click', () => { RLOG.flush(); shareOrDownload(RLOG.text() + '\n', 'register-log-' + todayISO() + '.txt', 'text/plain'); });

/* ---------- backup / restore / import ---------- */
function backupRows() {
  const out = [];
  for (const id in records) if (!SEALED_TYPES.has(records[id].type) && !LOCAL_ONLY_TYPES.has(records[id].type)) out.push(stripLocal(records[id]));
  for (const id in sealed) out.push(stripLocal(sealed[id]));
  return out;
}
$('setBackup').addEventListener('click', () => {
  shareOrDownload(JSON.stringify(backupRows(), null, 1), 'register-backup-' + todayISO() + '.json', 'application/json');
  $('setDataMsg').className = 'msg ok'; $('setDataMsg').textContent = 'Backup created. Money entries inside it stay encrypted.';
});
$('setRestore').addEventListener('click', () => $('restoreFile').click());
/* The whole backup (every record, money already sealed) is encrypted again with the private key, so the Drive file is unreadable without the code. */
const AutoBackup = {
  list() { try { return JSON.parse(localStorage.getItem('r2_autobk') || '[]'); } catch (e) { return []; } },
  save(l) { try { localStorage.setItem('r2_autobk', JSON.stringify(l)); } catch (e) {} },
  info() { const l = this.list(), last = l[l.length - 1]; return !driveOn() ? 'Needs the Drive folder in Sync settings.' : last ? `Last: ${fmtDate(last.date, true)} · ${last.count} items · ${l.length} kept` : 'No Drive backup yet.'; },
  due() { const l = this.list(), last = l[l.length - 1]; return !last || Date.now() - last.at > 7 * 86400000; },
  /* the encrypted envelope, shared by the Drive backup and "Download encrypted backup" */
  async pack(rows) { const fk = records[FINKEY_ID]; return JSON.stringify({ v: 1, app: APP_VERSION, at: Date.now(), salt: fk.salt, iters: fk.iters || FIN_ITERS, enc: await aesEnc(Fin.key, JSON.stringify(rows)) }); },
  async maybe() { if (prefs.autoBackup && Fin.key && driveOn() && navigator.onLine && this.due()) { try { await this.run(); } catch (e) { RLOG.warn('auto backup', e.message); } } },
  async run(say) {
    if (!Fin.key) throw new Error('Unlock the private section first (the backup is encrypted with its key).');
    if (!driveOn()) throw new Error('Set the Drive folder in Settings → Sync first.');
    const rows = backupRows(), body = await this.pack(rows);
    const name = 'register-backup-' + todayISO() + '.rgbk', data = b64(te.encode(body));
    if (data.length > 30000000) throw new Error('The backup is larger than the Apps Script accepts (about 22 MB). Use "Download encrypted backup" instead.');   // v2.19 (B10)
    const d = await Sync.call('driveUpload', { folderId: prefs.driveFolder, name, mime: 'application/octet-stream', data }, 240000);
    if (!d.fileId) throw new Error('Drive did not return a file id');
    const l = this.list(); l.push({ fileId: d.fileId, date: todayISO(), at: Date.now(), count: rows.length, name });
    while (l.length > 8) { const old = l.shift(); try { await Sync.call('driveDelete', { fileId: old.fileId }, 60000); } catch (e) { RLOG.warn('old backup delete', e.message); } }
    this.save(l); try { localStorage.setItem('r2_lastBackup', String(Date.now())); } catch (e) {}
    RLOG.info('drive backup', name, rows.length);
    return rows.length;
  },
  async test() {
    const last = this.list().slice(-1)[0]; if (!last) throw new Error('No Drive backup yet.');
    if (!Fin.key) throw new Error('Unlock the private section first.');
    const d = await Sync.call('driveGet', { fileId: last.fileId }, 240000);
    const pack = JSON.parse(td.decode(unb64(d.data)));
    const key = pack.salt === Fin.salt ? Fin.key : null; if (!key) throw new Error('This backup was made under your previous private code. Restore it (download it from Drive, then Restore) and enter that code.');
    const rows = JSON.parse(await aesDec(key, pack.enc));
    if (!Array.isArray(rows) || !rows.every(r => r && r.id && r.type)) throw new Error('The backup file is damaged.');
    return { rows: rows.length, date: last.date };
  }
};
$('setAutoBk').addEventListener('change', () => { setPref('autoBackup', $('setAutoBk').checked); if ($('setAutoBk').checked) AutoBackup.maybe().then(() => { $('setAutoBkInfo').textContent = AutoBackup.info(); }); });
$('setAutoBkNow').addEventListener('click', async () => {
  const m = $('setDataMsg'); m.className = 'msg'; m.textContent = 'Backing up…';
  try { const n = await AutoBackup.run(); m.className = 'msg ok'; m.textContent = `Backed up ${n} items to Drive (encrypted).`; $('setAutoBkInfo').textContent = AutoBackup.info(); }
  catch (e) { m.className = 'msg err'; m.textContent = e.message; }
});
$('setAutoBkTest').addEventListener('click', async () => {
  const m = $('setDataMsg'); m.className = 'msg'; m.textContent = 'Downloading and checking…';
  try { const r = await AutoBackup.test(); m.className = 'msg ok'; m.textContent = `The backup of ${fmtDate(r.date, true)} opens correctly: ${r.rows} items.`; }
  catch (e) { m.className = 'msg err'; m.textContent = e.message; }
});
$('restoreFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    let arr; try { arr = JSON.parse(rd.result); } catch (err) { toast('That file is not a Register backup.'); return; }
    let oldCode = null;
    if (arr && arr.enc && arr.salt) {
      let key = Fin.key && arr.salt === Fin.salt ? Fin.key : null;
      if (!key) { oldCode = prompt('This backup is encrypted. Enter the private code that was in use when it was made:'); if (!oldCode) return;
        try { key = await deriveFinKey(oldCode, arr.salt, arr.iters); } catch (err) { key = null; } }
      try { arr = JSON.parse(await aesDec(key, arr.enc)); } catch (err) { toast('Wrong code, or the file is damaged.'); return; } }
    if (!Array.isArray(arr)) { toast('Unexpected file format.'); return; }
    if (!(await confirmRestore(restorePlan(arr), f.name))) { toast('Restore cancelled. Nothing was changed.'); return; }
    await importRecords(arr, 'backup file');
    if (oldCode && Fin.key && Fin.lockedOut.length) { const n = await recoverLockedOut(oldCode); if (n) toast(`Money entries from the backup re-sealed under your current code (${n}).`); }
  };
  rd.readAsText(f);
});

/* Accepts v1 backups (plaintext money + settings.vaultCode) and v2 backups (sealed money). */
async function importRecords(arr, from) {
  const msg = $('setDataMsg');
  let oldCode = null; const plainMoney = [], rows = [];
  arr.forEach(r => {
    if (!r || !r.id || !r.type) return;
    if (r.type === 'settings') { if (r.vaultCode) oldCode = String(r.vaultCode); return; }
    if (typeof r.id !== 'string' || !REC_ID_RX.test(r.id) || typeof r.type !== 'string' || !REC_TYPE_RX.test(r.type)) return;   // the code is never stored in plaintext again
    if (LOCAL_ONLY_TYPES.has(r.type) || r._chunks) return;
    if (SEALED_TYPES.has(r.type) && !r.enc) plainMoney.push(r); else rows.push({ ...r, updatedAt: r.updatedAt || nowMs() });
  });
  // plain records + already-sealed money
  const n1 = await mergeRemote(rows, true);
  // money from the old app arrives in plaintext → encrypt it with the private code
  let n2 = 0;
  if (plainMoney.length) {
    if (!finUnlocked()) {
      if (finConfigured()) {
        let ok = oldCode ? await unlockFinance(oldCode) : false;
        while (!ok) { const c = prompt(`Enter your private-section code to import ${plainMoney.length} money entries (Cancel to skip them).`); if (c == null) break; ok = await unlockFinance(c); }
      } else if (oldCode) {
        await setupFinance(oldCode);
        toast('Your old Financial code now opens the private Money section.', null, null, 5000);
      } else {
        const c = prompt(`Choose a private-section code to protect ${plainMoney.length} money entries (Cancel to skip them).`);
        if (c) await setupFinance(c);
      }
    }
    if (finUnlocked()) {
      plainMoney.forEach(r => {
        const local = records[r.id];
        if (local && local.updatedAt >= (r.updatedAt || 0)) return;
        const rec = { ...r, updatedAt: r.updatedAt || nowMs() }; delete rec._dirty;
        put(rec, { render: false, keepTime: true }); n2++;
      });
      $('moneyTab').classList.remove('hidden');
    }
  }
  const total = n1 + n2;
  RLOG.info('import from', from, 'records', total, 'money', n2);
  if (msg) { msg.className = 'msg ok'; msg.textContent = `Imported ${total} item${total === 1 ? '' : 's'} from the ${from}${plainMoney.length && !n2 ? ' (money entries skipped)' : ''}.`; }
  toast(`Imported ${total} item${total === 1 ? '' : 's'}.`);
  scheduleRender(); Sync.soon(500);
  return total;
}

/* The previous version (v1) kept encrypted data in this browser's localStorage. */
async function legacyKeyFrom(meta, explain) {
  const dev = localStorage.getItem('reg_devKey');
  if (dev) return crypto.subtle.importKey('raw', unb64(dev), 'AES-GCM', false, ['decrypt']);
  if (meta && meta.wrapPass && meta.saltPass) {
    const pass = prompt('The old app used a passphrase. Enter it to unlock your old data:');
    if (!pass) return null;
    try {
      const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
      const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(meta.saltPass), iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const raw = unb64(meta.wrapPass);
      const mk = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, kek, raw.slice(12));
      return crypto.subtle.importKey('raw', mk, 'AES-GCM', false, ['decrypt']);
    } catch (e) { toast('That passphrase did not work.'); return null; }
  }
  const code = prompt(explain
    ? 'Your old Sheet data is encrypted with the old app\'s device key, which is not on this device.\n\nIf you have the pairing code (REGKEY-…), paste it here. Otherwise tap Cancel and open Register once on the iPhone that used the old app — it will unlock and upload everything automatically.'
    : 'Paste the pairing code from the old app (REGKEY-…):');
  if (!code) return null;
  try { const body = code.trim().replace(/^REGKEY-/i, '').replace(/\s+/g, ''); return crypto.subtle.importKey('raw', unb64(body + '='.repeat((4 - body.length % 4) % 4)), 'AES-GCM', false, ['decrypt']); }
  catch (e) { toast("That doesn't look like a pairing code."); return null; }
}
async function decryptLegacy(key, payloads) {
  const out = []; let bad = 0;
  for (const p of payloads) { try { out.push(JSON.parse(await aesDec(key, p))); } catch (e) { bad++; } }
  if (bad) RLOG.warn('legacy undecryptable', bad);
  return { out, bad };
}
async function importLegacyLocal() {
  const raw = localStorage.getItem('reg_recs'); if (!raw) { toast('No data from the old app on this iPhone.'); return 0; }
  let meta = {}; try { meta = JSON.parse(localStorage.getItem('reg_meta') || '{}'); } catch (e) {}
  const key = await legacyKeyFrom(meta); if (!key) return 0;
  let packed; try { packed = JSON.parse(raw); } catch (e) { toast('Old data is unreadable.'); return 0; }
  const { out, bad } = await decryptLegacy(key, Object.values(packed));
  if (!out.length) { toast('Could not decrypt the old data with that key.'); return 0; }
  const n = await importRecords(out, 'old app');
  try { localStorage.setItem('r2_legacyDone', '1'); } catch (e) {}
  if (bad) toast(`${bad} old item(s) could not be read.`);
  return n;
}
$('setLegacyLocal').addEventListener('click', importLegacyLocal);

/* Accepts the full /exec URL, the /dev URL, or just the deployment ID (AKfy…). */
function normaliseScriptUrl(v) {
  v = String(v || '').trim();
  if (/^https?:\/\//i.test(v)) return v.replace(/\/dev(\?.*)?$/, '/exec');
  const id = (v.match(/[-\w]{30,}/) || [])[0];
  return id ? `https://script.google.com/macros/s/${id}/exec` : v;
}

/* Bring v1 data across automatically, once:
   1. data the old app left in this browser (decrypted with the key it also left here)
   2. the old encrypted "Records" tab in the Sheet — readable only where the old key exists.
   Nothing here overwrites newer data: every item keeps whichever copy is newest. */
let migrating = false;
async function autoMigrate(fromConnect) {
  if (migrating) return { ok: true, text: 'Already importing…' };
  migrating = true;
  let total = 0, notes = [];
  try {
    const devKey = localStorage.getItem('reg_devKey');
    // 1 — this device's old local data
    if (localStorage.getItem('reg_recs') && localStorage.getItem('r2_legacyDone') !== '1' && devKey) {
      const key = await crypto.subtle.importKey('raw', unb64(devKey), 'AES-GCM', false, ['decrypt']);
      let packed = {}; try { packed = JSON.parse(localStorage.getItem('reg_recs')); } catch (e) {}
      const { out } = await decryptLegacy(key, Object.values(packed));
      if (out.length) { total += await importRecords(out, 'old app on this device'); }
      try { localStorage.setItem('r2_legacyDone', '1'); } catch (e) {}
    }
    // 2 — the old Sheet tab
    const haveData = Object.values(records).some(r => !r.deleted && r.type !== 'finkey');
    // another device already migrated and this one received it through Records2 → nothing to do
    if (Sync.on() && !devKey && haveData) { try { localStorage.setItem('r2_legacySheetDone', '1'); } catch (e) {} }
    if (Sync.on() && localStorage.getItem('r2_legacySheetDone') !== '1') {
      let d = null;
      try { d = await Sync.call('legacy', {}, 90000); } catch (e) { notes.push('Could not read the old tab: ' + e.message); }
      if (d && d.records && d.records.length) {
        const meta = d.meta || {};
        let key = null;
        if (devKey) key = await crypto.subtle.importKey('raw', unb64(devKey), 'AES-GCM', false, ['decrypt']);
        else if (fromConnect) key = await legacyKeyFrom(meta, true);
        if (key) {
          const { out, bad } = await decryptLegacy(key, d.records.map(r => r.payload).filter(Boolean));
          if (out.length) {
            total += await importRecords(out, 'old Sheet tab');
            try { localStorage.setItem('r2_legacySheetDone', '1'); } catch (e) {}
            if (bad) notes.push(`${bad} old row(s) were written with a different key and were skipped.`);
          } else notes.push('The old Sheet rows did not open with the key on this device.');
        } else notes.push(`The old Sheet tab has ${d.records.length} encrypted rows. Its key lives only on the device that used the old app — open Register there once and they will come across to every device.`);
      } else if (d) { try { localStorage.setItem('r2_legacySheetDone', '1'); } catch (e) {} }
    }
  } catch (e) { RLOG.error('autoMigrate', e); notes.push('Import error: ' + e.message); }
  finally { migrating = false; }
  if (total) Sync.soon(300);
  RLOG.info('autoMigrate', total, notes.join(' | '));
  const text = (total ? `Connected — brought in ${total} item${total === 1 ? '' : 's'} from the old version.` : 'Connected and synced.') + (notes.length ? ' ' + notes.join(' ') : '');
  return { ok: !notes.length || !!total, text, total };
}
$('setLegacySheet').addEventListener('click', async () => {
  const m = $('setDataMsg');
  if (!Sync.on()) { m.className = 'msg err'; m.textContent = 'Connect the Sheet first (same script, updated to v16).'; return; }
  m.className = 'msg'; m.textContent = 'Fetching the old tab…';
  try {
    const d = await Sync.call('legacy', {}, 90000);
    if (!d.records || !d.records.length) { m.textContent = 'The old “Records” tab is empty or missing.'; return; }
    const key = await legacyKeyFrom(d.meta || {}); if (!key) { m.textContent = 'Cancelled.'; return; }
    const { out, bad } = await decryptLegacy(key, d.records.map(r => r.payload).filter(Boolean));
    if (!out.length) { m.className = 'msg err'; m.textContent = 'None of the old rows opened with that key.'; return; }
    await importRecords(out, 'old Sheet tab');
    if (bad) toast(`${bad} old row(s) could not be read.`);
  } catch (e) { m.className = 'msg err'; m.textContent = 'Failed: ' + e.message; }
});

/* hardware keyboard: / search, n new */
document.addEventListener('keydown', e => {
  if (Sheets.top() || ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement || {}).tagName)) return;
  if (e.key === '/') { e.preventDefault(); openSearch(); } else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAdd(); }
});

/* ---------- boot ---------- */

/* ==========================================================================
   v2.16 — audit fixes
   ======================================================================== */
/* ---------- tasks: whole-word classifier (no "now" inside "acknowledge", no "son" inside "reason") ---------- */
const CLS_RX = new Map();
function clsRx(w, whole) {
  const k = (whole ? 'w:' : 's:') + w;
  if (!CLS_RX.has(k)) CLS_RX.set(k, new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (whole ? '(?![a-z0-9])' : '')));
  return CLS_RX.get(k);
}
function classify(title) {
  const t = ' ' + String(title || '').toLowerCase() + ' ';
  const start = w => clsRx(w, false).test(t), whole = w => clsRx(w, true).test(t);   // word start: "pay" still finds "payment"
  let best = 'Work', bestScore = 0;
  for (const cat in CAT_WORDS) {
    let score = 0;
    CAT_WORDS[cat].forEach(w => { if (start(w)) score++; });
    (STRONG[cat] || []).forEach(w => { if (start(w)) score += 3; });
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  let prio = 'Medium';
  if (HIGH_WORDS.some(whole)) prio = 'High'; else if (LOW_WORDS.some(whole)) prio = 'Low';
  return { category: bestScore ? best : 'Work', priority: prio, matched: bestScore > 0 };
}
/* repeating task: steps move by the same number of periods as the task, so they are not overdue at once */
function spawnRepeat(t) {
  const day = t.repeatDay || +(t.dueDate || todayISO()).slice(8, 10), today = todayISO();
  let nx = shiftISO(t.dueDate || today, t.repeat, day), k = 1;
  for (let i = 0; nx < today && i < 1000; i++, k++) nx = shiftISO(nx, t.repeat, day);      // completed late: next one is not already overdue
  const shiftK = (iso, dd) => { let x = iso; for (let i = 0; x && i < k; i++) x = shiftISO(x, t.repeat, dd); return x; };
  const clone = { ...t, id: uid('t'), status: 'active', createdAt: nowMs(), dueDate: nx, repeatDay: day,
    subs: (t.subs || []).map(s => { const n = normSub(s), dd = n.dueDate ? (+s.day || +n.dueDate.slice(8, 10)) : 0;
      return { ...n, done: false, dueDate: n.dueDate ? shiftK(n.dueDate, dd) : null, ...(dd && t.repeat === 'monthly' ? { day: dd } : {}) }; }) };
  delete clone.completedOn; delete clone.completedAt; delete clone._dirty; delete clone.spawnedId;
  t.spawnedId = clone.id;
  put(clone, { render: false });
  return clone;
}

/* ---------- Recently deleted: restore / delete for good ---------- */
function binRestoreV216(id) {
  const r = records[id]; if (!r) return;
  if (r.type === 'docfile' && r.locked && !Fin.key) { toast('This file is locked. Open Money with your private code first, then restore it.'); return; }
  restore(id);
  if (r.type === 'docfile') { if (r.keyId && records[r.keyId] && records[r.keyId].deleted) restore(r.keyId); if (Sync.on()) Sync.call('driveRestore', { fileId: r.fileId }).catch(() => {}); }
  if (r.type === 'fin' || r.type === 'snote') scheduleRender();
  toast('Restored.'); openBin();
}
async function purgeNow(ids, again) {
  ids = [...ids, ...ids.flatMap(id => (records[id] && records[id].type === 'catbin' && records[id].dateIds) || []).filter(x => records[x] && records[x].deleted)];   // a category's dates go with it
  const gone = [], wait = [];
  ids.forEach(id => { const r = records[id]; if (!r) return;
    if (!again && r.type === 'docfile' && r.fileId) driveDelete(r.fileId);
    if (!again && r.type === 'doc') all('docfile').forEach(f => { if (f.docId === id) { driveDelete(f.fileId); softDelete(f.id, { render: false }); } });
    if (r._dirty && Sync.on()) { r.deletedAt = 1; put(r, { render: false }); wait.push(id); }   // its deletion has not reached the Sheet yet: removed right after it does
    else gone.push(id); });
  if (wait.length) Sync.run().then(() => { const done = wait.filter(id => records[id] && records[id].deleted && !records[id]._dirty); if (done.length) purgeNow(done, true); });
  await Promise.all(gone.map(id => persistQ[id]).filter(Boolean));               // a queued save must not write it back after the delete
  gone.forEach(id => { delete records[id]; delete sealed[id]; delete persistQ[id]; });
  storeVer++;
  try { await DB.delMany(gone); } catch (e) { RLOG.warn('purge', e.message); }
  scheduleRender();
}
/* a locked file's key that was removed while the file itself is still in use comes back after unlocking */
function healFileKeys() {
  let n = 0;
  [...all('docfile'), ...all('blob')].forEach(f => { const k = f.keyId && records[f.keyId]; if (k && k.deleted) { restore(f.keyId); n++; } });
  if (n) RLOG.info('restored file keys still in use', n);
}

/* ---------- Dates ---------- */
function parseDateCell(v) {
  if (v instanceof Date && !isNaN(v)) { const t = new Date(v.getTime() + 43200000); return { v: isoLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate())) }; }   // Excel dates arrive a few seconds before midnight in IST
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^29\s*[-/.\s]\s*(0?2|feb[a-z]*)$/.test(s) || /^feb[a-z]*\s+29$/.test(s)) return { v: '1904-02-29', noYear: true };   // 29 Feb without a year: a leap placeholder year
  return parseDateCellOld(v);
}
function icsFold(line) {
  const out = []; let cur = '', n = 0;
  for (const ch of line) { const b = te.encode(ch).length; if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; }
  out.push(cur); return out.join('\r\n ');
}
function icsText(list) {
  const e = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n'), stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Register//Dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  list.forEach(d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.when || '')) return;
    const nx = new Date(d.when + 'T00:00:00'); nx.setDate(nx.getDate() + 1);
    const day = +d.when.slice(8, 10), mo = +d.when.slice(5, 7);
    L.push('BEGIN:VEVENT', `UID:${d.id}@register`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d.when.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${isoLocal(nx).replace(/-/g, '')}`, `SUMMARY:${e(d.label)}`);
    // same rule as the app: a day the month does not have moves to its last day
    if (d.repeat === 'yearly') L.push(mo === 2 && day === 29 ? 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1' : 'RRULE:FREQ=YEARLY');
    else if (d.repeat === 'monthly') L.push(day >= 29 ? 'RRULE:FREQ=MONTHLY;BYMONTHDAY=' + Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',') + ';BYSETPOS=-1' : 'RRULE:FREQ=MONTHLY');
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(d.label)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
  });
  L.push('END:VCALENDAR'); return L.map(icsFold).join('\r\n') + '\r\n';
}
/* placeholders ("set the date") made twice — e.g. on two devices before they synced — keep one */
function dedupeSeedDates() {
  const by = new Map();
  all('date').forEach(d => { const k = String(d.label || '').trim().toLowerCase(); if (!k) return; (by.get(k) || by.set(k, []).get(k)).push(d); });
  let n = 0;
  by.forEach(L => {
    if (L.length < 2) return;
    const empty = d => !d.when && !d.docRef, keep = L.find(d => !empty(d)) || L.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
    L.forEach(d => { if (d !== keep && empty(d)) { d.deleted = true; d.deletedAt = 1; put(d, { render: false }); n++; } });
  });
  if (n) RLOG.info('removed duplicate date placeholders', n);
}

/* ---------- Inbox: dates in a line (no "1.5 kg", "5 pm", "10 marks", "maybe", "2 decks") ---------- */
const DMON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?(?![a-z])';
const DRX1 = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*' + DMON + '(?:,?\\s*(\\d{4}))?\\b'), DRX2 = new RegExp('\\b' + DMON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b');
function findDateIn(text) {
  const s = ' ' + String(text || '').toLowerCase() + ' ', t = todayISO(); let m;
  const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getMonth() === mo - 1 && dt.getDate() === d ? isoLocal(dt) : null; };
  const fut = (mo, d) => { const y = +t.slice(0, 4); let r = ok(y, mo, d); if (r && r < t) r = ok(y + 1, mo, d); return r; };
  if ((m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d.])/))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3], r = ok(y, +m[2], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { const r = ok(+m[1], +m[2], +m[3]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(DRX1))) { const r = m[3] ? ok(+m[3], MON3[m[2].slice(0, 3)], +m[1]) : fut(MON3[m[2].slice(0, 3)], +m[1]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(DRX2))) { const r = m[3] ? ok(+m[3], MON3[m[1].slice(0, 3)], +m[2]) : fut(MON3[m[1].slice(0, 3)], +m[2]); if (r) return { iso: r, hit: m[0] }; }
  if ((m = s.match(/(^|[^\d.,])(\d{1,2})([/.])(\d{1,2})(?![\d./,])/))) {
    const at = m.index + m[1].length, before = s.slice(Math.max(0, at - 4), at), after = s.slice(at + m[0].length - m[1].length);
    const dotOk = m[3] === '/' || (m[4].length === 2 && !/^\s*(kg|kgs|g|gm|gms|l|ltr|ml|lakh|lac|cr|crore|%|km|hrs?|min|am|pm|x|rs)\b/.test(after));
    if (dotOk && +m[4] >= 1 && +m[4] <= 12 && +m[2] >= 1 && +m[2] <= 31 && !/[₹]|rs/.test(before)) { const r = fut(+m[4], +m[2]); if (r) return { iso: r, hit: m[0].slice(m[1].length) }; }
  }
  if (/\b(today|aaj)\b/.test(s)) return { iso: t, hit: (s.match(/\b(today|aaj)\b/) || [''])[0] };
  if (/\btomorrow\b/.test(s)) return { iso: addDays(1), hit: 'tomorrow' };
  if ((m = s.match(/\bin (\d{1,3}) days?\b/))) return { iso: addDays(+m[1]), hit: m[0] };
  if ((m = s.match(/\b(?:next |on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) { const w = WDAYS.indexOf(m[1]), now = new Date(t + 'T00:00:00').getDay(); const k = (w - now + 7) % 7 || 7; return { iso: addDays(k), hit: m[0] }; }
  return null;
}
const YEARLY_CATS = ['birthday', 'anniv', 'remember'];

/* ---------- Money ---------- */
/* udhaar as it stood on a past day (not today's figures) */
function udhaarAsOf(iso) {
  if (iso >= todayISO()) return udhaarSplit();
  let owed = 0, owe = 0;
  all('fin').filter(e => isUdhaar(e.kind) && finDate(e) && finDate(e) <= iso).forEach(e => {
    const pays = e.pays || [], pp = pays.reduce((t, p) => t + (+p.amt || 0), 0);
    const rest = Math.max(0, (+e.paidAmount || 0) - pp);                         // paid back before instalments were recorded: date unknown
    const left = Math.max(0, (+e.amount || 0) - pays.filter(p => (p.date || '') <= iso).reduce((t, p) => t + (+p.amt || 0), 0) - rest);
    if (e.kind === 'lent') owed += left; else owe += left;
  });
  return { owed, owe };
}
/* a monthly entry is copied once per month; the copy's id is fixed so two devices make the same one */
function rollRecurring() {
  const thisM = isoMonth(new Date());
  const seen = new Set(Object.values(records).filter(e => e.type === 'fin').map(e => (e.recurSrc || e.id) + '|' + (e.date || '').slice(0, 7)));   // deleted copies count too
  let made = 0;
  all('fin').filter(e => e.recurring).forEach(e => {
    const src = e.recurSrc || e.id, id = 'rr_' + src + '_' + thisM.replace('-', '');
    if ((e.date || '').slice(0, 7) >= thisM || seen.has(src + '|' + thisM) || records[id] || sealed[id]) return;
    const day = Math.min(+(e.date || '').slice(8, 10) || 1, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate());
    const n = { ...e, id, date: thisM + '-' + String(day).padStart(2, '0'), recurSrc: src, settled: false, paidAmount: 0, createdAt: nowMs() };
    delete n._dirty; delete n.pays; delete n.planRef; delete n.billRef; if (n.kind !== 'transfer') delete n.to; put(n, { render: false }); seen.add(src + '|' + thisM); made++;
  });
  if (made) toast(`${made} monthly entr${made === 1 ? 'y' : 'ies'} added for this month.`);
}
function rollAfterSync() {
  if (Sync.on() && navigator.onLine && !window.GHOST) Sync.run().then(() => { if (Fin.key) rollRecurring(); }, () => { if (Fin.key) rollRecurring(); });
  else rollRecurring();
}
const ARCH_START_WARN = 'Ledger entries from before the old start month were archived. With an earlier start they are left out of your balances until you bring those archives back (Settings → Archive old years). Move the start anyway?';

/* ---------- Docs: one PDF worker for the whole session; documents are closed when the viewer closes ---------- */
const pdfOpenDocs = new Set();
const pdfWorkerOpt = () => window.__pdfWorker ? { worker: window.__pdfWorker } : {};
Sheets.onClose.shDocView = () => { pdfOpenDocs.forEach(d => { try { d.destroy(); } catch (e) {} }); pdfOpenDocs.clear(); };
/* the Scan screen: one save at a time */
Scan.save = (function (inner) {
  return async function () {
    if (this.busy) return; this.busy = true; if ($('scSave')) $('scSave').disabled = true;
    try { return await inner.call(this); } finally { this.busy = false; if ($('scSave')) $('scSave').disabled = !this.pages.length; }
  };
})(Scan.save);


/* ==========================================================================
   v2.17
   ======================================================================== */
const V17_PAL = ['#9C2963', '#1B4B8F', '#2E7D50', '#B45309', '#6d5a8a', '#2c6e6a', '#8a4b12', '#3F4F8C', '#5b6e2f', '#6b3f5c'];
const ownHtml = s => esc(s);

/* ---------- 1. Today ---------- */
function todayData() {
  const t = todayISO(), nowM = isoMonth(new Date());
  const tasks = all('task').filter(x => x.status !== 'done' && x.dueDate && x.dueDate <= t).sort((a, b) => (a.dueDate + (a.dueTime || '99')).localeCompare(b.dueDate + (b.dueTime || '99')));
  const steps = []; all('task').filter(x => x.status !== 'done').forEach(x => (x.subs || []).map(normSub).forEach(s => { if (!s.done && s.dueDate && s.dueDate <= t) steps.push({ s, t: x }); }));
  const dates = dateRows(all('date').filter(d => d.when)).filter(x => x.days >= 0 && x.days <= 7);
  const bills = all('bill').map(b => ({ b, late: overduePeriods(b, nowM).length, now: billDueIn(b, nowM) && !payFor(b.id, nowM) })).filter(x => x.late || x.now);
  const docs = all('doc').filter(d => d.expiry && daysUntilISO(d.expiry) <= 30 && daysUntilISO(d.expiry) >= -10).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const inbox = all('inbox').length, sug = dateSuggestions().length;
  return { tasks, steps, dates, bills, docs, inbox, sug };
}
function updateTodayBadge() {
  const b = $('todayBadge'); if (!b) return;
  if (window.GHOST) { b.classList.add('hidden'); return; }
  const t = todayISO(), n = all('task').filter(x => x.status !== 'done' && x.dueDate && x.dueDate <= t).length + all('date').filter(d => d.when && isoLocal(nextOccurrence(d)) === t).length;
  b.textContent = n; b.classList.toggle('hidden', !n);
}
function openToday() {
  const D = window.GHOST ? { tasks: [], steps: [], dates: [], bills: [], docs: [], inbox: 0, sug: 0 } : todayData(), t = todayISO();
  const row = (k, id, title, sub, when, neg) => `<button class="td-row" data-tdk="${k}" data-tdid="${esc(id)}"><span class="t">${title}${sub ? `<small>${sub}</small>` : ''}</span>${when ? `<span class="w${neg ? ' neg' : ''}">${when}</span>` : ''}</button>`;
  const sec = (h, rows) => rows.length ? `<div class="group-title">${h}</div><div class="group">${rows.join('')}</div>` : '';
  let html = `<div class="td-h">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>`;
  html += sec(`☑︎ Tasks due (${D.tasks.length})`, D.tasks.map(x => row('task', x.id, esc(x.title), esc(x.category) + (x.priority === 'High' ? ' · High' : ''), (x.dueDate < t ? 'overdue · ' : '') + (x.dueTime ? fmtTime12(x.dueTime) : relDay(x.dueDate)), x.dueDate < t)));
  html += sec(`↳ Steps due (${D.steps.length})`, D.steps.slice(0, 20).map(x => row('task', x.t.id, esc(x.s.text), 'in ' + esc(x.t.title), x.s.dueDate < t ? 'overdue' : 'today', x.s.dueDate < t)));
  html += sec(`📅 Dates · next 7 days (${D.dates.length})`, D.dates.map(x => row('date', x.d.id, esc(x.d.label), '', x.days === 0 ? 'today' : inDays(x.days), false)));
  html += sec(`🧾 Bills to pay (${D.bills.length})`, D.bills.map(x => row('bill', x.b.id, esc(x.b.label), x.late ? `${x.late} month${x.late > 1 ? 's' : ''} missed` : '', x.b.dueDay ? 'due on ' + x.b.dueDay : 'this month', !!x.late)));
  html += sec(`📁 Documents expiring · 30 days (${D.docs.length})`, D.docs.map(d => { const n = daysUntilISO(d.expiry); return row('doc', d.id, esc(d.title), esc(docOwners(d).join(' & ')), n < 0 ? 'expired' : inDays(n), n < 0); }));
  const more = [];
  if (D.inbox) more.push(row('inbox', 'x', `📥 ${D.inbox} item${D.inbox > 1 ? 's' : ''} in the Inbox to sort`, '', 'Sort ›'));
  if (D.sug) more.push(row('sug', 'x', `📅 ${D.sug} date${D.sug > 1 ? 's' : ''} found in your notes & tasks`, 'Add them to Dates, or say no', 'Review ›'));
  html += sec('To sort', more);
  if (!D.tasks.length && !D.steps.length && !D.dates.length && !D.bills.length && !D.docs.length && !more.length) html += '<div class="td-clear">☀︎<br><b>All clear for today.</b><br>Nothing due, nothing waiting.</div>';
  html += `<div class="btn-row" style="margin-top:14px;flex-wrap:wrap"><button class="btn ghost small" id="tdAdd">＋ Task for today</button><button class="btn ghost small" id="tdCap">📥 Capture</button><button class="btn ${weeklyDue() ? 'brass' : 'ghost'} small" id="tdWeek">🗓 Weekly review${weeklyDue() ? ' · due' : ''}</button></div>`;
  $('tdBody').innerHTML = html;
  $$('[data-tdk]', $('tdBody')).forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.tdk, id = b.dataset.tdid; Sheets.close('shToday', true);
    if (k === 'task') { showTab('tasks'); previewTask(id); }
    else if (k === 'date') { setPref('dateSeg', 'dates'); datePath = null; showTab('dates'); openDate(id); }
    else if (k === 'bill') { setPref('dateSeg', 'bills'); showTab('dates'); openBill(id); }
    else if (k === 'doc') { showTab('docs'); showDoc(id); }
    else if (k === 'inbox') openInbox();
    else if (k === 'sug') openDateSug();
  }));
  $('tdAdd').addEventListener('click', () => { Sheets.close('shToday', true); showTab('tasks'); openAdd('task'); setTimeout(() => { if ($('afTitle')) { $('afTitle').value = ' today'; $('afTitle').setSelectionRange(0, 0); taskGuess(); } }, 60); });
  $('tdCap').addEventListener('click', () => { Sheets.close('shToday', true); openCapture(); });
  $('tdWeek').addEventListener('click', () => { Sheets.close('shToday', true); openWeekly(); });
  if (!Sheets.isOpen('shToday')) Sheets.open('shToday');
}
$('todayFab').addEventListener('click', openToday);

/* ---------- 2. "Call CA tomorrow 5pm high" ---------- */
const fmtTime12 = hm => { const [h, m] = String(hm).split(':').map(Number); if (isNaN(h)) return ''; return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
function parseQuickAdd(text) {
  const out = parseQuickAddOld(text); let s = ' ' + out.title + ' ';
  // time: 5pm, 5 pm, 5:30pm, 17:30, at 5
  let m = s.match(/\s(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)(?=[\s,.]|$)/i);
  if (m && +m[1] >= 1 && +m[1] <= 12 && (!m[2] || +m[2] < 60)) { const h = (+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0); out.dueTime = String(h).padStart(2, '0') + ':' + (m[2] || '00'); s = s.replace(m[0], ' '); }
  else if ((m = s.match(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=[\s,.]|$)/))) { out.dueTime = String(+m[1]).padStart(2, '0') + ':' + m[2]; s = s.replace(m[0], ' '); }
  else if ((m = s.match(/\sat\s+(\d{1,2})(?=[\s,.]|$)/i)) && +m[1] >= 1 && +m[1] <= 12) { const h = +m[1]; out.dueTime = String(h <= 7 ? h + 12 : h).padStart(2, '0') + ':00'; s = s.replace(m[0], ' '); }
  // priority: only as the last word(s), or "priority high" anywhere ("high court" stays in the title)
  if (!out.priority) {
    if ((m = s.match(/\s(?:priority\s+(high|low|medium)|(high|low|medium)\s+priority)(?=[\s,.]|$)/i))) { const w = (m[1] || m[2]).toLowerCase(); out.priority = w === 'high' ? 'High' : w === 'low' ? 'Low' : 'Medium'; s = s.replace(m[0], ' '); }
    else if ((m = s.match(/\s(high|urgent|asap|important|low)\s*$/i))) { out.priority = /low/i.test(m[1]) ? 'Low' : 'High'; s = s.replace(new RegExp('\\s' + m[1] + '\\s*$', 'i'), ' '); }
  }
  // date: today, tomorrow, day after tomorrow, next week, weekdays, in 3 days, 15 Oct, 15/10
  if (!out.dueDate) {
    if ((m = s.match(/\s(?:on\s+|by\s+)?day after tomorrow(?=[\s,.]|$)/i))) { out.dueDate = addDays(2); s = s.replace(m[0], ' '); }
    else if ((m = s.match(/\s(?:by\s+)?next week(?=[\s,.]|$)/i))) { out.dueDate = addDays(7); s = s.replace(m[0], ' '); }
    else { const f = findDateIn(s); if (f && f.hit) { const i = s.toLowerCase().indexOf(f.hit.trim()); if (i >= 0) { out.dueDate = f.iso; s = (s.slice(0, i) + ' ' + s.slice(i + f.hit.trim().length)).replace(/\s(?:on|by|due)\s*$/i, ' ').replace(/\s(?:on|by|due)\s+(?=\s)/i, ' '); } } }
  }
  if (out.dueTime && !out.dueDate) { const now = new Date(), [h, mi] = out.dueTime.split(':').map(Number); out.dueDate = h * 60 + mi > now.getHours() * 60 + now.getMinutes() ? todayISO() : addDays(1); }
  out.title = s.replace(/\s(?:on|by|at|due)\s*$/i, ' ').replace(/\s{2,}/g, ' ').trim();
  return out;
}
function taskGuess() {
  const el = $('afTitle'); if (!el) return;
  const q = parseQuickAdd(el.value), g = classify(q.title);
  const cat = AF.cat !== 'auto' ? AF.cat : q.category || g.category;
  const prio = AF.prio !== 'auto' ? AF.prio : q.priority || g.priority;
  const due = q.dueDate || AF.due;
  $('afGuess').innerHTML = q.title ? `<b>${esc(q.title)}</b><br>Files as <b style="color:${catColor(cat)}">${cat}</b> · ${prio}${due ? ' · 📅 ' + relDay(due) : ''}${q.dueTime ? ' · ⏰ ' + fmtTime12(q.dueTime) : ''}` : 'Type it the way you say it: “Call CA tomorrow 5pm high”, “Pay LIC on 15 Oct”, “Submit report Friday”.';
}

/* ---------- 3. Face ID for the whole app, and auto-lock times ---------- */
async function pinHash(pin, salt) {
  const k = await crypto.subtle.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 200000, hash: 'SHA-256' }, k, 256)));
}
const AppLock = {
  KEY: 'r2_applock', fails: 0,
  get() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { if (v) localStorage.setItem(this.KEY, JSON.stringify(v)); else localStorage.removeItem(this.KEY); } catch (e) {} },
  on() { return !!this.get(); },
  async enable(pin) {
    const cred = await navigator.credentials.create({ publicKey: { challenge: Bio.rnd(32), rp: { name: 'Register' }, user: { id: Bio.rnd(16), name: 'register-app', displayName: 'Register app lock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000,
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' } } });
    const salt = b64(Bio.rnd(16));
    this.set({ id: b64(cred.rawId), salt, hash: await pinHash(pin, salt), at: Date.now() });
  },
  check() {                                              // called inside the tap, so Face ID can start at once
    const a = this.get();
    return navigator.credentials.get({ publicKey: { challenge: Bio.rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(a.id) }], userVerification: 'required', timeout: 60000 } });
  },
  async pinOk(pin) { const a = this.get(); return !!a && (await pinHash(pin, a.salt)) === a.hash; }
};
/* v2.18: the PIN's wrong-try counter is kept on the device, so closing and reopening the app no longer resets it */
const PinLimit = {
  get() { try { return JSON.parse(localStorage.getItem('r2_pf') || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } },
  set(v) { try { localStorage.setItem('r2_pf', JSON.stringify(v)); } catch (e) {} },
  wait() { const v = this.get(); return Math.max(0, v.until - Date.now()); },
  fail() { const v = this.get(); v.n++; if (v.n >= 5) v.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, v.n - 5)); this.set(v); return this.wait(); },
  reset() { this.set({ n: 0, until: 0 }); }
};
function decoyUnlock() {
  if (!AppLock.on()) { hideDecoy(); return; }
  if (AppLock.fails >= 2 || !Bio.supported()) { if (PinLimit.wait()) return; $('alPin').classList.remove('hidden'); setTimeout(() => $('alPinIn').focus(), 50); return; }
  AppLock.check().then(() => { AppLock.fails = 0; hideDecoy(); }, e => { AppLock.fails++; RLOG.warn('app lock', e.name || e.message); });
}
{ const go = async () => {
    const v = $('alPinIn').value; $('alPinIn').value = '';
    if (PinLimit.wait()) { $('alPin').classList.add('hidden'); return; }
    if (await AppLock.pinOk(v)) { PinLimit.reset(); AppLock.fails = 0; $('alPin').classList.add('hidden'); hideDecoy(); }
    else if (PinLimit.fail()) $('alPin').classList.add('hidden');
  };
  $('alPinGo').addEventListener('click', go);
  $('alPinIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }); }
$('setAppLock').addEventListener('click', () => {
  if (AppLock.on()) { if (confirm('Turn off Face ID for opening Register on this device?')) { AppLock.set(null); $('setAppLockV').textContent = 'Off'; toast('Face ID to open is off.'); } return; }
  if (!Bio.supported()) { toast('Face ID needs the app installed on the Home Screen (iOS 16 or later).'); return; }
  $('alPin1').value = ''; $('alPin2').value = ''; $('alMsg').textContent = ''; Sheets.open('shAppLock');
});
$('alOn').addEventListener('click', async () => {
  const p1 = $('alPin1').value, p2 = $('alPin2').value, m = $('alMsg');
  if (!/^\d{4,}$/.test(p1)) { m.className = 'msg err'; m.textContent = 'Use 4 or more digits.'; return; }
  if (p1 !== p2) { m.className = 'msg err'; m.textContent = 'The two PINs do not match.'; return; }
  try {
    await AppLock.enable(p1);
    setPref('decoyLaunch', true); if ($('setDecoy')) $('setDecoy').checked = true;
    Sheets.close('shAppLock', true); $('setAppLockV').textContent = 'On'; toast('Face ID to open is on. The decoy screen comes first, then Face ID.');
  } catch (e) { m.className = 'msg err'; m.textContent = e.name === 'NotAllowedError' ? 'Face ID was cancelled — try again.' : (e.message || 'Could not turn on Face ID.'); }
});
$('setAppIdle').addEventListener('change', () => setPref('appIdle', +$('setAppIdle').value));
$('setMoneyIdle').addEventListener('change', () => setPref('moneyIdle', +$('setMoneyIdle').value));
setInterval(() => { const m = +prefs.appIdle; if (m > 0 && document.visibilityState === 'visible' && !document.documentElement.classList.contains('decoy-on') && Date.now() - lastTouch > m * 60000) hideNow(); }, 15000);

/* ---------- 4. merge documents · 6. people & categories · 7. new types · 8. move many ---------- */
const DOC_CFG = 'doc-cfg';
const DOC_GROUPS0 = DOC_GROUPS.map(g => [g[0], g[1].slice(), g[2]]), DOC_TYPES0 = DOC_TYPES.slice();
let docCfgStamp = null;
const docCfg = () => !window.GHOST && records[DOC_CFG] && !records[DOC_CFG].deleted ? records[DOC_CFG] : null;
function syncDocCfg() {
  const c = docCfg(), stamp = c ? c.updatedAt + ':' + (c.groups || []).length : 'none';
  if (stamp === docCfgStamp) return; docCfgStamp = stamp;
  DOC_GROUPS = c && c.groups && c.groups.length ? c.groups.map(g => [g.n, (g.t || []).slice(), g.i || '📁']) : DOC_GROUPS0.map(g => [g[0], g[1].slice(), g[2]]);
  DOC_TYPES = [...new Set([...DOC_TYPES0, ...((c && c.types) || [])])];
  const last = DOC_GROUPS[DOC_GROUPS.length - 1];
  DOC_TYPES.forEach(t => { if (!DOC_GROUPS.some(g => g[1].includes(t))) last[1].push(t); });
  DOC_TYPES.forEach((t, i) => { if (!DOC_COLORS[t]) DOC_COLORS[t] = V17_PAL[i % V17_PAL.length]; });
}
function docCfgEdit(fn) {
  syncDocCfg();
  const c0 = docCfg() || {};
  const c = { id: DOC_CFG, type: 'doccfg', people: [], ...JSON.parse(JSON.stringify(c0)), deleted: false };
  c.groups = DOC_GROUPS.map(g => ({ n: g[0], t: g[1].slice(), i: g[2] })); c.types = DOC_TYPES.filter(t => !DOC_TYPES0.includes(t));
  fn(c); put(c, { render: false }); docCfgStamp = null; syncDocCfg(); scheduleRender();
}
const docCfgPeople = () => ((docCfg() || {}).people || []);
function allDocPeople() { return orderPeople([...all('doc').flatMap(docOwners), ...docCfgPeople()]); }
function addDocType(name, grp) {
  name = String(name || '').trim(); if (!name) return null;
  const hit = DOC_TYPES.find(t => t.toLowerCase() === name.toLowerCase()); if (hit) return hit;
  docCfgEdit(c => { c.types.push(name); const g = c.groups.find(x => x.n === grp) || c.groups[c.groups.length - 1]; g.t.push(name); });
  return name;
}
function addDocGroup(name, icon) {
  name = String(name || '').trim(); if (!name) return;
  if (DOC_GROUPS.some(g => g[0].toLowerCase() === name.toLowerCase())) { toast('That category already exists.'); return; }
  docCfgEdit(c => { const t = DOC_TYPES.some(x => x.toLowerCase() === name.toLowerCase()) ? null : name;
    if (t) c.types.push(t); c.groups.splice(c.groups.length - 1, 0, { n: name, i: icon || '📁', t: t ? [t] : [] }); });
}
function renameDocGroup(old, nu) {
  nu = String(nu || '').trim(); if (!nu || nu === old) return;
  const into = DOC_GROUPS.find(g => g[0].toLowerCase() === nu.toLowerCase() && g[0] !== old);
  if (into && !confirm(`"${into[0]}" already exists. Put everything from "${old}" into "${into[0]}"?`)) return;
  docCfgEdit(c => { const g = c.groups.find(x => x.n === old); if (!g) return;
    if (into) { const t = c.groups.find(x => x.n === into[0]); t.t.push(...g.t); c.groups = c.groups.filter(x => x !== g); } else g.n = nu; });
  if (docPath.grp === old) docPath.grp = into ? into[0] : nu;
}
function deleteDocGroup(name) {
  const gi = DOC_GROUPS.findIndex(g => g[0] === name); if (gi < 0) return;
  if (gi === DOC_GROUPS.length - 1) { toast(`"${name}" is where everything else goes — it cannot be deleted. Rename it instead.`); return; }
  const g = DOC_GROUPS[gi], n = all('doc').filter(d => g[1].includes(d.docType)).length, other = DOC_GROUPS[DOC_GROUPS.length - 1][0];
  if (!confirm(`Delete the category "${name}"?${n ? `\n\nIts ${n} document${n > 1 ? 's' : ''} stay safe and show under "${other}".` : ''}\nRecently deleted keeps it for 30 days — restoring it puts everything back.`)) return;
  put({ id: uid('cb'), type: 'catbin', what: 'docgrp', grp: { n: g[0], t: g[1].slice(), i: g[2] }, deleted: true, deletedAt: nowMs() }, { render: false });
  docCfgEdit(c => { const x = c.groups.find(y => y.n === name); c.groups[c.groups.length - 1].t.push(...x.t); c.groups = c.groups.filter(y => y !== x); });
  if (docPath.grp === name) docPath.grp = null;
  toast(`Deleted "${name}" — in Recently deleted for 30 days.`);
}
function setTypeGroup(type, grp) { docCfgEdit(c => { c.groups.forEach(g => { g.t = g.t.filter(t => t !== type); }); (c.groups.find(g => g.n === grp) || c.groups[c.groups.length - 1]).t.push(type); }); }
function renamePerson(old, nu) {
  nu = normWho(nu); if (!nu || nu === old) return;
  if (/&/.test(nu)) { toast('One name only.'); return; }
  const merging = allDocPeople().includes(nu);
  if (merging && !confirm(`"${nu}" already exists. Move all of ${old}'s documents to ${nu}?`)) return;
  all('doc').forEach(d => { const o = docOwners(d); if (!o.includes(old)) return; d.who = normWho([...new Set(o.map(p => p === old ? nu : p))].join(' & ')); put(d, { render: false }); if (d.expiry && typeof syncDocDate === 'function') syncDocDate(d); });
  docCfgEdit(c => { c.people = [...new Set((c.people || []).map(p => p === old ? nu : p))]; });
  if (docPath.who === old) docPath.who = nu;
}
function movePersonAll(from) { openDocMove(all('doc').filter(d => docOwners(d).includes(from)).map(d => d.id), `All of ${from}'s documents`); }
function moveDocs(ids, who, grp) {
  syncDocCfg(); let n = 0;
  const g = grp ? DOC_GROUPS.find(x => x[0] === grp) : null;
  let gType = g ? g[1][0] : null;
  if (g && !gType) { gType = addDocType(g[0], g[0]); }
  ids.forEach(id => { const d = records[id]; if (!d || d.deleted) return;
    if (who) d.who = normWho(who);
    if (g && !g[1].includes(d.docType)) d.docType = gType;
    put(d, { render: false }); n++; if (d.expiry && typeof syncDocDate === 'function') syncDocDate(d); });
  if (who && !allDocPeople().includes(normWho(who))) docCfgEdit(c => { c.people = [...new Set([...(c.people || []), normWho(who)])]; });
  docSel = null; scheduleRender(); toast(`Moved ${n} document${n === 1 ? '' : 's'}.`);
}
function openDocMove(ids, what) {
  syncDocCfg(); if (!ids.length) { toast('Nothing to move.'); return; }
  const people = allDocPeople();
  $('daTitle').textContent = 'Move';
  $('daBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">${esc(what || `${ids.length} document${ids.length > 1 ? 's' : ''}`)} → choose where they go. Files stay attached.</p>
    <div class="field"><label>Person (main folder)</label><select id="daWho"><option value="">— keep as it is —</option>${people.map(p => `<option value="${esc(p)}">👤 ${esc(p)}</option>`).join('')}<option value="__new">＋ New person…</option></select>
      <input id="daWhoNew" class="hidden" placeholder="Name" autocomplete="off" style="margin-top:8px"></div>
    <div class="field"><label>Category (sub-folder)</label><select id="daGrp"><option value="">— keep as it is —</option>${DOC_GROUPS.map(g => `<option value="${esc(g[0])}">${g[2]} ${esc(g[0])}</option>`).join('')}</select></div>
    <p class="hint">A document shared by two people (“Rahul &amp; Ruchi”) gets only the person you pick.</p>
    <button class="btn block brass" id="daGo">Move ${ids.length}</button>`;
  $('daWho').addEventListener('change', () => $('daWhoNew').classList.toggle('hidden', $('daWho').value !== '__new'));
  $('daGo').addEventListener('click', () => {
    const w = $('daWho').value === '__new' ? $('daWhoNew').value.trim() : $('daWho').value, gp = $('daGrp').value;
    if (!w && !gp) { toast('Pick a person or a category.'); return; }
    Sheets.close('shDocAct', true); moveDocs(ids, w, gp);
  });
  Sheets.open('shDocAct');
}
async function mergeDocs(keepId, ids) {
  const k = records[keepId]; if (!k) return;
  const others = ids.filter(id => id !== keepId).map(id => records[id]).filter(Boolean);
  let files = 0;
  others.forEach(o => {
    docFilesOf(o.id).forEach(f => { f.docId = keepId; if (f.fy && !k.byYear) k.byYear = true; put(f, { render: false }); files++; });
    ['expiry', 'issuer', 'fy', 'folder', 'dueKind'].forEach(p => { if (!k[p] && o[p]) k[p] = o[p]; });
    if (!k.number && !k.numEnc) { if (o.number) k.number = o.number; else if (o.numEnc) { k.numEnc = o.numEnc; k.numTail = o.numTail; } }
    if (o.notes && o.notes.trim() && !(k.notes || '').includes(o.notes.trim())) k.notes = [k.notes, o.notes].filter(x => x && x.trim()).join('\n\n');
    if (o.lockFiles) k.lockFiles = true;
    all('date').filter(x => x.docRef === o.id).forEach(x => softDelete(x.id, { render: false }));
    o.mergedInto = keepId; softDelete(o.id, { render: false });
  });
  put(k, { render: false }); if (k.expiry && typeof syncDocDate === 'function') syncDocDate(k);
  docSel = null; scheduleRender();
  const loose = k.lockFiles && docFilesOf(k.id).some(f => !f.locked);
  if (loose && Fin.key) { try { await convertDocFiles(k); } catch (e) { RLOG.warn('merge lock', e.message); } }
  toast(`Merged into "${k.title}" — ${docFilesOf(k.id).length} file${docFilesOf(k.id).length === 1 ? '' : 's'}.${loose && !Fin.key ? ' Some files are not locked yet: open Money, then “Finish locking” in the document.' : ''}`, 'Open', () => { showTab('docs'); showDoc(k.id); }, 7000);
}
function openDocMerge(ids) {
  const docs = ids.map(id => records[id]).filter(d => d && !d.deleted);
  if (docs.length < 2) { toast('Pick two or more documents to merge.'); return; }
  $('daTitle').textContent = 'Merge';
  $('daBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">All files come under one entry. Pick the entry to keep — its name, person and type stay; empty details (number, expiry, issuer) are filled from the others. The other entries go to Recently deleted.</p>
    <div class="group">${docs.map((d, i) => `<label class="dm-opt"><input type="radio" name="dmKeep" value="${d.id}"${i === 0 ? ' checked' : ''}><span><b>${esc(d.title)}</b><br><small class="muted">${esc(docOwners(d).join(' & '))} · ${esc(d.docType)} · ${docFilesOf(d.id).length} file${docFilesOf(d.id).length === 1 ? '' : 's'}${d.lockFiles ? ' · 🔒' : ''}</small></span></label>`).join('')}</div>
    <button class="btn block brass" id="dmGo">Merge ${docs.length} into one</button>`;
  $('dmGo').addEventListener('click', () => { const keep = (document.querySelector('[name="dmKeep"]:checked') || {}).value; Sheets.close('shDocAct', true); mergeDocs(keep, docs.map(d => d.id)); });
  Sheets.open('shDocAct');
}
const GROUP_ICONS = ['📁', '🎓', '🪪', '📜', '🏛', '🗂', '💰', '🩺', '🏠', '🚗', '🖼', '📄', '✈️', '⚖️', '🧾', '🏦', '👪', '🛡'];
function openDocFolders() {
  syncDocCfg();
  const docs = all('doc'), people = allDocPeople();
  $('dfBody').innerHTML = `<div class="group-title">People — main folders</div><div class="group">${people.map(p => { const n = docs.filter(d => docOwners(d).includes(p)).length;
      return `<div class="df-row"><b>👤 ${esc(p)}</b><span class="muted">${n}</span><button data-dfren="${esc(p)}">Rename</button>${n ? `<button data-dfmv="${esc(p)}">Move all…</button>` : `<button data-dfrm="${esc(p)}">Remove</button>`}</div>`; }).join('')}
      <div class="df-row"><input id="dfNewP" placeholder="New person" autocomplete="off" style="flex:1;min-width:0"><button id="dfAddP">＋ Add</button></div></div>
    <p class="hint" style="margin:4px 4px 12px">Renaming to a name that already exists merges the two people.</p>
    <div class="group-title">Categories — sub-folders</div><div class="group">${DOC_GROUPS.map((g, gi) => { const n = docs.filter(d => g[1].includes(d.docType)).length;
      return `<div class="df-row"><b>${g[2]} ${esc(g[0])}</b><span class="muted">${n}</span><button data-dgren="${esc(g[0])}">Rename</button>${gi < DOC_GROUPS.length - 1 ? `<button data-dgdel="${esc(g[0])}">Delete</button>` : ''}
        <div class="df-types">${g[1].map(t => `<button data-dtype="${esc(t)}" title="Move this type to another category">${esc(t)}</button>`).join('') || '<small>no types</small>'}</div></div>`; }).join('')}
      <div class="df-row"><select id="dfIcon" style="width:auto">${GROUP_ICONS.map(i => `<option>${i}</option>`).join('')}</select><input id="dfNewG" placeholder="New category" autocomplete="off" style="flex:1;min-width:0"><button id="dfAddG">＋ Add</button></div></div>
    <p class="hint" style="margin:4px 4px 12px">A category holds document types. Tap a type to move it to another category. The last category takes everything that belongs nowhere else.</p>
    <div class="group-title">Move a type</div><div class="group" style="padding:10px 14px"><div class="new-type" style="margin:0"><select id="dfT">${DOC_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select><span>→</span><select id="dfG">${DOC_GROUPS.map(g => `<option value="${esc(g[0])}">${g[2]} ${esc(g[0])}</option>`).join('')}</select><button class="btn small" id="dfTGo">Move</button></div></div>`;
  const re = () => openDocFolders();
  $$('[data-dfren]', $('dfBody')).forEach(b => b.addEventListener('click', () => { const nu = prompt(`New name for ${b.dataset.dfren}`, b.dataset.dfren); if (nu) { renamePerson(b.dataset.dfren, nu); setTimeout(re, 50); } }));
  $$('[data-dfmv]', $('dfBody')).forEach(b => b.addEventListener('click', () => { Sheets.close('shDocFolders', true); movePersonAll(b.dataset.dfmv); }));
  $$('[data-dfrm]', $('dfBody')).forEach(b => b.addEventListener('click', () => { docCfgEdit(c => { c.people = (c.people || []).filter(p => p !== b.dataset.dfrm); }); setTimeout(re, 50); }));
  $('dfAddP').addEventListener('click', () => { const v = normWho($('dfNewP').value); if (!v || /&/.test(v)) return; docCfgEdit(c => { c.people = [...new Set([...(c.people || []), v])]; }); toast(`Added ${v}.`); setTimeout(re, 50); });
  $$('[data-dgren]', $('dfBody')).forEach(b => b.addEventListener('click', () => { const nu = prompt(`New name for "${b.dataset.dgren}"`, b.dataset.dgren); if (nu) { renameDocGroup(b.dataset.dgren, nu); setTimeout(re, 50); } }));
  $$('[data-dgdel]', $('dfBody')).forEach(b => b.addEventListener('click', () => { deleteDocGroup(b.dataset.dgdel); setTimeout(re, 50); }));
  $$('[data-dtype]', $('dfBody')).forEach(b => b.addEventListener('click', () => { $('dfT').value = b.dataset.dtype; $('dfG').focus(); $('dfT').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  $('dfAddG').addEventListener('click', () => { addDocGroup($('dfNewG').value, $('dfIcon').value); setTimeout(re, 50); });
  $('dfTGo').addEventListener('click', () => { setTypeGroup($('dfT').value, $('dfG').value); toast(`"${$('dfT').value}" is now in ${$('dfG').value}.`); setTimeout(re, 50); });
  if (!Sheets.isOpen('shDocFolders')) Sheets.open('shDocFolders');
}
function renderDocs() {
  syncDocCfg(); renderDocsBase();
  const fbox = $('docFolders'); if (!fbox || window.GHOST) return;
  const crumb = fbox.querySelector('.doc-crumb'); if (!crumb) return;
  const acts = document.createElement('div'); acts.className = 'crumb-acts';
  if (docPath.who && !docPath.grp) {
    acts.innerHTML = `<button data-ca="ren">✎ Rename</button><button data-ca="mv">⇢ Move all…</button><button data-ca="new">＋ Document here</button>${FAM_PEOPLE.includes(docPath.who) ? '<button data-ca="chk">✅ Checklist</button>' : ''}<button data-ca="em">🆘 Emergency sheet</button><button data-ca="zip">⤓ All as .zip</button>`;
    if (!all('doc').some(d => docOwners(d).includes(docPath.who))) fbox.insertAdjacentHTML('beforeend', '<div class="empty">No documents for this person yet.</div>');
  } else if (docPath.grp) {
    acts.innerHTML = `<button data-ca="gren">✎ Rename category</button><button data-ca="gmv">⇢ Move these…</button><button data-ca="gdel">🗑 Delete category</button>`;
  }
  crumb.after(acts);
  const who = docPath.who, grp = docPath.grp, here = () => all('doc').filter(d => docOwners(d).includes(who) && (!grp || docGroup(d) === grp)).map(d => d.id);
  $$('[data-ca]', acts).forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.ca;
    if (a === 'ren') { const nu = prompt(`New name for ${who}`, who); if (nu) renamePerson(who, nu); }
    else if (a === 'mv') movePersonAll(who);
    else if (a === 'new') { const d = put({ id: uid('doc'), type: 'doc', title: '', who: who === DOC_ME ? '' : who, docType: docNewType(), number: '', expiry: null, issuer: '', notes: '', folder: '', fy: null, deleted: false }); openDoc(d.id); }
    else if (a === 'gren') { const nu = prompt(`New name for "${grp}"`, grp); if (nu) renameDocGroup(grp, nu); }
    else if (a === 'gmv') openDocMove(here(), `${who}'s ${grp}`);
    else if (a === 'gdel') deleteDocGroup(grp);
    else if (a === 'chk') openFamily(who);
    else if (a === 'em') openEmergency(who);
    else if (a === 'zip') exportPersonZip(who);
  }));
}
function renderSelBar() {
  renderSelBarBase();
  if (!docSel) return;
  const n = docSel.size; $('docSelMove').disabled = !n; $('docSelMerge').disabled = n < 2;
}
$('docSelMove').addEventListener('click', () => docSel && openDocMove([...docSel]));
$('docSelMerge').addEventListener('click', () => docSel && openDocMerge([...docSel]));
$('docFoldersBtn').addEventListener('click', openDocFolders);
$('docFamBtn').addEventListener('click', () => openFamily());
function openDoc(id) {
  syncDocCfg(); openDocBase(id);
  const d = records[id]; if (!d) return;
  const draw = sel => {
    chipGroup($('doType'), DOC_TYPES, sel, () => {}, t => DOC_COLORS[t]);
    $('doType').insertAdjacentHTML('beforeend', '<button class="chip" id="doTypeNew" type="button">＋ New type</button>');
    $('doTypeNew').addEventListener('click', () => { $('doNewTypeW').classList.toggle('hidden'); $('doNewType').focus(); });
  };
  draw(d.docType);
  $('doNewTypeW').classList.add('hidden'); $('doNewType').value = '';
  const cur = DOC_GROUPS.find(g => g[1].includes(d.docType));
  $('doNewTypeGrp').innerHTML = DOC_GROUPS.map(g => `<option value="${esc(g[0])}"${(docPath.grp || (cur && cur[0])) === g[0] ? ' selected' : ''}>${g[2]} ${esc(g[0])}</option>`).join('');
  $('doNewTypeAdd').onclick = () => { const t = addDocType($('doNewType').value, $('doNewTypeGrp').value); if (!t) return; draw(t); $('doNewTypeW').classList.add('hidden'); $('doNewType').value = ''; toast(`Type "${t}" added in ${(DOC_GROUPS.find(g => g[1].includes(t)) || [''])[0]}.`); };
}

/* ---------- 5. PDFs in the Inbox ---------- */
const isPdfBlob = b => !!(b && (/pdf/i.test(b.mime || '') || /\.pdf$/i.test(b.name || '')));
function capShow() { $('capImgs').innerHTML = CAP.files.map((f, i) => /pdf/i.test(f.type) || /\.pdf$/i.test(f.name || '') ? `<span class="cap-pdf">📄 ${esc(f.name || 'file.pdf')}</span>` : `<img src="${URL.createObjectURL(f)}" alt="photo ${i + 1}">`).join(''); }
const fileToDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error || new Error('could not read the file')); r.readAsDataURL(f); });
async function storePdfs(files) {
  const ids = [], bad = [];
  for (const f of files) {
    try {
      if (!driveOn()) throw new Error('PDFs need the Drive folder (Settings → Sync)');
      if (f.size > DOCFILE_MAX) throw new Error('larger than 15 MB');
      let url = await fileToDataUrl(f); if (!/^data:application\/pdf/.test(url)) url = 'data:application/pdf;base64,' + url.slice(url.indexOf(',') + 1);
      const name = (f.name || 'file.pdf').replace(/[^\w.\- ()]/g, '_'), fileId = await driveUpload(url, todayISO() + '-' + name);
      memImg.set(fileId, url); DB.imgSet(fileId, url).catch(() => {});
      ids.push(put({ id: uid('img'), type: 'blob', drive: true, fileId, name, mime: 'application/pdf', bytes: f.size, deleted: false }, { render: false }).id);
    } catch (e) { RLOG.warn('inbox pdf', e.message); bad.push(`${f.name || 'PDF'}: ${e.message}`); }
  }
  if (bad.length) toast('Not saved: ' + bad.join('; '), null, null, 7000);
  return ids;
}
function ibThumb(b) { const r = records[b]; return isPdfBlob(r) ? `<button class="ib-pdf" data-ibpdf="${b}">📄 ${esc(r.name || 'PDF')}</button>` : `<img data-blob="${b}" alt="photo">`; }
async function openBlobPdf(id) {
  try { const src = await imgSrc(records[id]); const blob = await (await fetch(src)).blob(); const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 120000); }
  catch (e) { toast('Could not open the PDF: ' + e.message); }
}
function inboxDone(i, keepImgs, keep) {
  if (keep && keep.length) { i.imgs = keep; i.text = ''; put(i, { render: false }); toast('PDFs stay in the Inbox — send them to a Document.'); renderInboxCard(); return; }
  inboxDoneBase(i, keepImgs);
}

/* ---------- 9. dates found in notes and tasks (you accept or decline) ---------- */
const DSUG_ID = 'date-sug';
const dsugCfg = () => records[DSUG_ID] && !records[DSUG_ID].deleted ? records[DSUG_ID] : { dec: {} };
function datesInText(text) {
  const s = String(text || ''), low = s.toLowerCase(), t = todayISO(), out = [], taken = [];
  const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? isoLocal(dt) : null; };
  const next = (mo, d) => { const y = +t.slice(0, 4); for (let k = 0; k < 5; k++) { const r = ok(y + k, mo, d); if (r && r >= t) return r; } return null; };
  const add = (m, iso, noYear) => {
    const a = m.index, b = a + m[0].length; if (!iso || taken.some(([x, y]) => a < y && b > x)) return; taken.push([a, b]);
    if (!noYear && iso < t) return;
    const ls = s.lastIndexOf('\n', a) + 1, le = s.indexOf('\n', b);
    out.push({ iso, noYear, hit: s.slice(a, b), line: s.slice(ls, le < 0 ? s.length : le).trim() });
  };
  let m;
  const R1 = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d.])/g, R2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g, R3 = new RegExp(DRX1.source, 'g'), R4 = new RegExp(DRX2.source, 'g');
  while ((m = R2.exec(low))) add(m, ok(+m[1], +m[2], +m[3]));
  while ((m = R1.exec(low))) add(m, ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]));
  while ((m = R3.exec(low))) add(m, m[3] ? ok(+m[3], MON3[m[2].slice(0, 3)], +m[1]) : next(MON3[m[2].slice(0, 3)], +m[1]), !m[3]);
  while ((m = R4.exec(low))) add(m, m[3] ? ok(+m[3], MON3[m[1].slice(0, 3)], +m[2]) : next(MON3[m[1].slice(0, 3)], +m[2]), !m[3]);
  return out;
}
function dateSuggestions() {
  if (window.GHOST) return [];
  const dec = dsugCfg().dec || {}, seen = new Set(), out = [], dates = all('date');
  const scan = (src, kind, title, text) => datesInText(text).forEach(h => {
    const key = src.id + '|' + (h.noYear ? h.iso.slice(5) : h.iso) + '|' + h.hit.toLowerCase().replace(/\s+/g, ' ');
    if (dec[key] || seen.has(key)) return; seen.add(key);
    let label = h.line.replace(new RegExp('(?:\\b(?:on|by|due|dated?|till|until|from|before|dt\\.?)\\s+)?' + h.hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    label = label.replace(/\s(?:on|by|due|dated?|till|until|from|before)\s*$/i, ' ').replace(/^[\s\-–—•*:;,.]+|[\s\-–—•*:;,.]+$/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 70) || title || 'Date';
    if (dates.some(d => (d.when === h.iso || (h.noYear && (d.when || '').slice(5) === h.iso.slice(5))) && d.label.toLowerCase() === label.toLowerCase())) return;
    out.push({ key, iso: h.iso, noYear: h.noYear, label, src: src.id, kind, title: title || '' });
  });
  all('note').forEach(n => scan(n, 'note', n.title || 'Note', (n.title || '') + '\n' + (n.text || '')));
  all('task').filter(x => x.status !== 'done').forEach(x => scan(x, 'task', x.title, [x.title, x.notes || '', ...(x.subs || []).map(s => (s.text || '') + ' ' + (s.notes || ''))].join('\n')));
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}
function dsugDecide(keys, how) {
  const c = { id: DSUG_ID, type: 'datesug', dec: {}, ...JSON.parse(JSON.stringify(dsugCfg())), deleted: false };
  keys.forEach(k => { c.dec[k] = how; }); put(c, { render: false });
}
function dsugAdd(list) {
  const made = [];
  list.forEach(x => { const cat = guessDateCat({ label: x.label });
    made.push(put({ id: uid('d'), type: 'date', label: x.label, when: x.iso, repeat: YEARLY_CATS.includes(cat) || (x.noYear && /birthday|anniversar|bday/i.test(x.label)) ? 'yearly' : 'once', cat, srcRef: x.src, deleted: false }, { render: false })); });
  dsugDecide(list.map(x => x.key), 'ok'); scheduleRender();
  return made;
}
function dsugRowsHtml(list) {
  return list.map(x => `<div class="attn-row" data-dsk="${esc(x.key)}"><button class="attn-go" data-dsopen="${esc(x.src)}" data-dskind="${x.kind}">📅 ${esc(x.label)} · <b>${fmtDate(x.iso, true)}</b>${x.noYear ? ' (every year?)' : ''}<small class="ds-from">from ${x.kind} “${esc(x.title.slice(0, 50))}”</small></button><button class="attn-ok" data-dsadd="1">＋ Add</button><button class="attn-ok" data-dsno="1" aria-label="Not a date to keep">✕</button></div>`).join('');
}
function bindDsug(root, list, after) {
  const byKey = new Map(list.map(x => [x.key, x]));
  $$('[data-dsk]', root).forEach(r => {
    const x = byKey.get(r.dataset.dsk); if (!x) return;
    r.querySelector('[data-dsadd]').addEventListener('click', () => { const [d] = dsugAdd([x]); toast(`Added to Dates: ${x.label}.`, 'Edit', () => { showTab('dates'); openDate(d.id); }); after(); });
    r.querySelector('[data-dsno]').addEventListener('click', () => { dsugDecide([x.key], 'no'); after(); });
    r.querySelector('[data-dsopen]').addEventListener('click', () => { Sheets.closeAll(); if (x.kind === 'note') { showTab('notes'); previewNote(x.src); } else { showTab('tasks'); previewTask(x.src); } });
  });
}
function openDateSug() {
  const L = dateSuggestions();
  $('dsgBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Dates written inside your notes and tasks (not task due dates). Nothing goes into Dates until you tap ＋ Add. ✕ means "not needed" — it will not be suggested again.</p>`
    + (L.length ? `<div class="btn-row" style="margin:0 0 10px"><button class="btn ghost small" id="dsgAll">＋ Add all ${L.length}</button><button class="btn ghost small" id="dsgNone">✕ Decline all</button></div><div class="group attn">${dsugRowsHtml(L)}</div>` : '<div class="empty">No new dates found in your notes and tasks.</div>');
  bindDsug($('dsgBody'), L, openDateSug);
  if ($('dsgAll')) $('dsgAll').addEventListener('click', () => { if (confirm(`Add all ${L.length} to Dates?`)) { dsugAdd(L); openDateSug(); } });
  if ($('dsgNone')) $('dsgNone').addEventListener('click', () => { if (confirm(`Decline all ${L.length}? They will not be suggested again.`)) { dsugDecide(L.map(x => x.key), 'no'); openDateSug(); } });
  if (!Sheets.isOpen('shDateSug')) Sheets.open('shDateSug');
}
/* Needs attention, with the new "Dates found" section */
function renderAttn() {
  renderAttnBase();
  const box = $('docAttn'); if (!box || docPath.who || window.GHOST) return;
  const L = dateSuggestions(); if (!L.length) return;
  let det = box.querySelector('details.attn');
  if (!det) { box.innerHTML = '<details class="attn"><summary>⚠︎ Needs attention</summary></details>'; det = box.querySelector('details.attn'); }
  const sum = det.querySelector('summary'); const n0 = +(((sum.textContent.match(/\((\d+)\)/) || [])[1]) || 0);
  sum.firstChild.textContent = `⚠︎ Needs attention (${n0 + L.length})`;
  const sm = sum.querySelector('small'); if (sm) sm.textContent = (sm.textContent && !/Everything is marked OK/.test(sm.textContent) ? sm.textContent + ' · ' : '') + `${L.length} date${L.length > 1 ? 's' : ''} found in notes & tasks`;
  const sec = document.createElement('div'); sec.className = 'attn-sec';
  sec.innerHTML = `<div class="attn-head"><b>Dates found in notes &amp; tasks (${L.length})</b><button data-dsgall="1">Review all ›</button></div>${dsugRowsHtml(L.slice(0, 15))}${L.length > 15 ? `<small class="muted">…and ${L.length - 15} more</small>` : ''}`;
  const foot = det.querySelector('.attn-foot'); foot ? det.insertBefore(sec, foot) : det.appendChild(sec);
  bindDsug(sec, L, renderAttn);
  sec.querySelector('[data-dsgall]').addEventListener('click', openDateSug);
}

/* ---------- 10. search suggestions ---------- */
const RECENT_Q = 'r2_recentQ';
const recentQ = () => { try { return JSON.parse(localStorage.getItem(RECENT_Q) || '[]'); } catch (e) { return []; } };
function rememberQ(q) { q = String(q || '').trim(); if (q.length < 2 || window.GHOST) return; try { localStorage.setItem(RECENT_Q, JSON.stringify([q, ...recentQ().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8))); } catch (e) {} }
function searchPool() {
  if (window.GHOST) return [];
  syncDocCfg();
  const P = new Set();
  allDocPeople().forEach(p => P.add(p)); DOC_GROUPS.forEach(g => P.add(g[0])); DOC_TYPES.forEach(t => P.add(t));
  all('doc').forEach(d => P.add(d.title)); all('task').filter(t => t.status !== 'done').forEach(t => P.add(t.title)); all('note').forEach(n => n.title && P.add(n.title)); all('date').forEach(d => P.add(d.label));
  (dateCats() || []).forEach(c => P.add(c[1]));
  return [...P].filter(x => x && x.length < 60);
}
function searchSuggest(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const words = q.split(/\s+/), last = words[words.length - 1], head = words.slice(0, -1).join(' ');
  const hits = searchPool().filter(x => { const l = x.toLowerCase(); return l !== q && (l.startsWith(q) || l.split(/[^a-z0-9]+/).some(w => w.startsWith(last))); })
    .sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1) || a.length - b.length).slice(0, 8);
  return hits.map(h => h.toLowerCase().startsWith(q) || !head ? h : head + ' ' + h);
}
function runSearch() {
  runSearchBase();
  const q = $('searchIn').value, box = $('searchRes'); if (window.GHOST) return;
  const pick = s => { $('searchIn').value = s; rememberQ(s); runSearch(); $('searchIn').focus(); };
  if (!q.trim()) {
    const rec = recentQ(), fin = finUnlocked();
    const tries = ['expiring soon', 'birthdays this month', 'what is due this week', 'documents of ' + (allDocPeople()[1] || DOC_ME).toLowerCase(), ...(fin ? ['spent this month', 'balance this month', 'who owes me'] : [])];
    const people = allDocPeople().slice(0, 6), cats = DOC_GROUPS.slice(0, 8).map(g => g[0]);
    box.insertAdjacentHTML('afterbegin', `<div class="sug-panel">${rec.length ? `<div class="sug-t"><span>Recent</span><button class="linkbtn" id="sugClr" style="font-size:.75rem;padding:0">Clear</button></div><div class="sug-chips">${rec.map(s => `<button data-sug="${esc(s)}">🕘 ${esc(s)}</button>`).join('')}</div>` : ''}
      <div class="sug-t"><span>Try</span></div><div class="sug-chips">${tries.map(s => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      <div class="sug-t"><span>People</span></div><div class="sug-chips">${people.map(s => `<button data-sug="${esc(s)}">👤 ${esc(s)}</button>`).join('')}</div>
      <div class="sug-t"><span>Document categories</span></div><div class="sug-chips">${cats.map(s => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`);
    if ($('sugClr')) $('sugClr').addEventListener('click', () => { try { localStorage.removeItem(RECENT_Q); } catch (e) {} runSearch(); });
  } else {
    const L = searchSuggest(q);
    if (L.length) box.insertAdjacentHTML('afterbegin', `<div class="sug-row">${L.map(s => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>`);
    $$('.sr', box).forEach(b => b.addEventListener('click', () => rememberQ(q), { capture: true }));
  }
  $$('[data-sug]', box).forEach(b => b.addEventListener('click', () => pick(b.dataset.sug)));
  savedSearchUI(q, box);
}
$('searchIn').addEventListener('keydown', e => { if (e.key === 'Enter') rememberQ($('searchIn').value); });

/* ---------- 11. Date categories: deleting goes to Recently deleted (restore brings its dates back) ---------- */
BIN_TYPES.catbin = 'Category';
function catbinLabel(r) {
  if (r.what === 'datecat') return `${r.cat.i || '📁'} ${esc(r.cat.n)}<small class="muted"> · Dates category${(r.dateIds || []).length ? ` · ${r.dateIds.length} date${r.dateIds.length > 1 ? 's' : ''}` : ''}</small>`;
  return `${r.grp.i || '📁'} ${esc(r.grp.n)}<small class="muted"> · Documents category</small>`;
}
function binItems() { return binItemsBase().filter(r => !(r.catBin && records[r.catBin] && records[r.catBin].deleted && records[r.catBin].deletedAt > 1) && !(r.viaDoc && records[r.viaDoc] && records[r.viaDoc].deleted)); }   // shown with their category / document
function restoreCatbin(r) {
  if (r.what === 'datecat') {
    const c = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
    if (r.cat.custom) { if (!(c.custom || []).some(x => x.k === r.cat.k)) c.custom = [...(c.custom || []), { k: r.cat.k, n: r.cat.n, i: r.cat.i || '📁' }]; }
    else c.hidden = (c.hidden || []).filter(h => h !== r.cat.k);
    put(c, { render: false });
    (r.dateIds || []).forEach(id => { const d = records[id]; if (d && d.deleted) { delete d.catBin; d.deleted = false; delete d.deletedAt; put(d, { render: false }); } });
  } else {
    docCfgEdit(c => { const back = r.grp.t.filter(t => DOC_TYPES.includes(t)); c.groups.forEach(g => { g.t = g.t.filter(t => !back.includes(t)); });
      let n = r.grp.n; while (c.groups.some(g => g.n === n)) n += ' (2)';
      c.groups.splice(c.groups.length - 1, 0, { n, i: r.grp.i, t: back }); });
  }
  r.deleted = true; r.deletedAt = 1; put(r, { render: false });                  // done with it
  scheduleRender(); toast('Category restored.'); if (Sheets.isOpen('shBin')) openBin();
}
function binRestoreV2171(id) { const r = records[id]; if (r && r.type === 'catbin') { restoreCatbin(r); return; } binRestoreV216(id); }
function deleteDateCat(key) {
  const cats = dateCats(), c = cats.find(x => x[0] === key); if (!c) return;
  const own = all('date').filter(d => dateCat(d) === key), custom = (dateCfg().custom || []).some(x => x.k === key);
  if (!confirm(`Delete the category "${c[1]}"${own.length ? ` and its ${own.length} date${own.length === 1 ? '' : 's'}` : ''}?\n\nIt goes to Settings → Recently deleted for 30 days. Restoring the category brings its dates back too.`)) return;
  const bin = put({ id: uid('cb'), type: 'catbin', what: 'datecat', cat: { k: key, n: c[1], i: c[2], custom }, dateIds: own.map(d => d.id), deleted: true, deletedAt: nowMs() }, { render: false });
  own.forEach(d => { d.catBin = bin.id; softDelete(d.id, { render: false }); });
  const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
  if (custom) cfg.custom = cfg.custom.filter(x => x.k !== key); else cfg.hidden = [...new Set([...(cfg.hidden || []), key])];
  datePath = null; put(cfg); toast(`Deleted "${c[1]}".`, 'Undo', () => restoreCatbin(records[bin.id]));
}
function newDateCat() {
  const n = (prompt('Name of the new category (or a deleted built-in one, to bring it back)') || '').trim(); if (!n) return;
  const cfg = { ...dateCfg(), id: DATE_CFG, type: 'datecfg', deleted: false };
  const builtin = DATE_CATS.find(x => x[1].toLowerCase() === n.toLowerCase());
  if (builtin && (cfg.hidden || []).includes(builtin[0])) { cfg.hidden = cfg.hidden.filter(h => h !== builtin[0]); put(cfg); toast(`"${builtin[1]}" is back.`); return; }
  if (dateCats().some(x => x[1].toLowerCase() === n.toLowerCase())) { toast('That category already exists.'); return; }
  cfg.custom = [...(cfg.custom || []), { k: 'c' + Date.now().toString(36), n, i: '📁' }]; put(cfg);
}
/* categories hidden by older versions show up in Recently deleted once, so they can be restored */
function migrateHiddenCats() {
  const cfg = records[DATE_CFG]; if (!cfg || cfg.deleted || cfg.hidMig || window.GHOST || !(cfg.hidden || []).length) return;
  cfg.hidden.forEach(k => { const b = DATE_CATS.find(x => x[0] === k); if (!b) return;
    const ds = Object.values(records).filter(d => d.type === 'date' && d.deleted && d.deletedAt > nowMs() - 30 * 86400000 && d.cat === k);
    const bin = put({ id: uid('cb'), type: 'catbin', what: 'datecat', cat: { k, n: b[1], i: b[2], custom: false }, dateIds: ds.map(d => d.id), deleted: true, deletedAt: nowMs() }, { render: false });
    ds.forEach(d => { d.catBin = bin.id; put(d, { render: false }); }); });
  put({ ...cfg, hidMig: true }, { render: false, keepTime: true });
}
function renderDates() {
  if (!window.GHOST && (!Sync.on() || window.__synced)) migrateHiddenCats();
  renderDatesBase();
  const home = $('dateHome'); if (!home || datePath || window.GHOST) return;
  const n = dateSuggestions().length;
  if (n) { home.insertAdjacentHTML('afterbegin', `<button class="ds-banner" id="dsBanner"><span>📅 <b>${n} date${n > 1 ? 's' : ''}</b> found in your notes &amp; tasks</span><b>Review ›</b></button>`); $('dsBanner').addEventListener('click', openDateSug); }
}
setTimeout(updateTodayBadge, 1500);


/* ==========================================================================
   v2.17.1
   ======================================================================== */
/* ---------- G4: a deleted document's expiry date goes to Recently deleted with it ---------- */
function softDelete(id, opt) {
  const r = records[id]; softDeleteBase(id, opt);
  if (r && r.type === 'doc' && !window.GHOST) all('date').filter(x => x.docRef === id).forEach(x => { x.viaDoc = id; softDeleteBase(x.id, { render: false }); });
}
function restore(id) {
  const r = records[id]; restoreBase(id);
  if (r && r.type === 'doc') Object.values(records).filter(x => x.type === 'date' && x.deleted && x.viaDoc === id).forEach(x => { delete x.viaDoc; restoreBase(x.id); });
}
/* ---------- G1–G3: files in Drive that nothing uses any more go to Drive's Trash ---------- */
const BLOB_OWNERS = ['note', 'snote', 'inbox'];
function blobUsedElsewhere(b, exceptId) {
  return Object.values(records).some(r => r.id !== exceptId && BLOB_OWNERS.includes(r.type) && !r.deleted && (r.imgs || []).includes(b));
}
function trashBlob(b, why) {
  const r = records[b]; if (!r || r.type !== 'blob') return;
  if (!r.deleted) softDeleteBase(b, { render: false });
  if (r.drive && r.fileId && !r.gone) { driveDelete(r.fileId); r.gone = 1; put(r, { render: false }); RLOG.info('drive file to trash', why || '', b); }
}
/* Inbox 🗑: after the 7-second Undo, its photos and PDFs go to Drive's Trash (restoring the item brings them back) */
function trashInboxFiles(id) {
  const i = records[id]; if (!i || !i.deleted || window.GHOST) return;
  (i.imgs || []).forEach(b => { if (!blobUsedElsewhere(b, id)) trashBlob(b, 'inbox deleted'); });
}
function restoreInboxFiles(i) {
  (i.imgs || []).forEach(b => { const r = records[b]; if (!r || !r.deleted) return; delete r.gone; restoreBase(b); if (r.drive && r.fileId && Sync.on()) Sync.call('driveRestore', { fileId: r.fileId }).catch(() => {}); });
}
/* sweep: runs once per session after a sync, only when every note (private ones too) can be read */
let blobSweepDone = false;
function sweepOrphans() {
  if (window.GHOST || blobSweepDone) return;
  if (Sync.on() && !window.__synced) return;
  const cutoff = nowMs() - 30 * 86400000;
  // expiry dates of documents that are deleted or gone (G4, for items from before v2.17.1)
  all('date').forEach(x => { if (!x.docRef) return; const d = records[x.docRef]; if (!d || d.deleted) { x.viaDoc = x.docRef; softDeleteBase(x.id, { render: false }); } });
  if (finConfigured() && (!Fin.key || (Fin.lockedOut || []).length)) return;   // private notes cannot be read yet: photos wait
  blobSweepDone = true;
  const used = new Set(Object.values(records).filter(r => BLOB_OWNERS.includes(r.type) && (!r.deleted || (r.deletedAt || 0) > cutoff)).flatMap(r => r.imgs || []));
  let n = 0;
  Object.values(records).forEach(b => {
    if (b.type !== 'blob' || n >= 200) return;
    if (!b.deleted && !used.has(b.id) && (b.createdAt || 0) < nowMs() - 2 * 86400000) { trashBlob(b.id, 'not used'); n++; }
    else if (b.deleted && b.drive && b.fileId && !b.gone && !used.has(b.id)) { trashBlob(b.id, 'removed earlier'); n++; }
  });
  if (n) { RLOG.info('unused Drive files moved to Trash', n); scheduleRender(); }
}
function binRestore(id) {
  const r = records[id]; binRestoreV2171(id);
  if (r && r.type === 'inbox' && !r.deleted) restoreInboxFiles(r);
}
/* ---------- P5: one record per archive (two devices archiving at once no longer lose one) ---------- */
const archIndex = () => {
  const L = ((records[ARCH_ID] && !records[ARCH_ID].deleted && records[ARCH_ID].list) || []).map(a => ({ ...a }));
  all('archent').forEach(r => { if (!L.some(a => a.fileId === r.fileId)) L.push({ fy: r.fy, fileId: r.fileId, n: r.n, enc: r.enc, at: r.at, salt: r.salt, iters: r.iters, _rid: r.id }); });
  return L.sort((a, b) => (a.at || 0) - (b.at || 0));
};
function archForget(a) {
  if (a._rid) { const r = records[a._rid]; if (r) { r.deleted = true; r.deletedAt = 1; put(r, { render: false }); } return; }
  const idx = records[ARCH_ID]; if (idx) put({ ...idx, list: (idx.list || []).filter(x => x.fileId !== a.fileId) }, { render: false });
}
setTimeout(() => { try { sweepOrphans(); } catch (e) { RLOG.warn('sweep', e.message); } }, 12000);


/* ==========================================================================
   v2.18 — encrypted backup, restore preview, security check-up
   ======================================================================== */
$('setBackupEnc').addEventListener('click', async () => {
  const m = $('setDataMsg');
  if (!Fin.key) { m.className = 'msg err'; m.textContent = 'Unlock the private section first — the backup is encrypted with your private code.'; return; }
  m.className = 'msg'; m.textContent = 'Encrypting…';
  try {
    const rows = backupRows(), body = await AutoBackup.pack(rows);
    await shareOrDownload(body, 'register-backup-' + todayISO() + '.rgbk', 'application/octet-stream');
    try { localStorage.setItem('r2_lastBackup', String(Date.now())); } catch (e) {}
    m.className = 'msg ok'; m.textContent = `Encrypted backup of ${rows.length} items created. Everything in it is locked with your private code — keep that code safe, the file cannot be opened without it.`;
  } catch (e) { m.className = 'msg err'; m.textContent = 'Could not make the backup: ' + (e.message || e); }
});

const RESTORE_LABELS = { task: 'Tasks', note: 'Notes', date: 'Key dates', doc: 'Documents', docfile: 'Document files', blob: 'Pictures', inbox: 'Inbox items', template: 'Templates', billpay: 'Bill payments', oldbill: 'Old bills' };
/* What would a backup file do? Counted only — nothing is changed. */
function restorePlan(arr) {
  const P = { total: arr.length, unusable: 0, fresh: 0, newer: 0, same: 0, deleted: 0, sealedRows: 0, legacyMoney: 0, byType: {}, ignored: 0 };
  arr.forEach(r => {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.type !== 'string' || !REC_ID_RX.test(r.id) || !REC_TYPE_RX.test(r.type)) { P.unusable++; return; }
    if (r.type === 'settings' || r.type === 'erased') { P.ignored++; return; }
    const sealedType = SEALED_TYPES.has(r.type);
    if (sealedType && !r.enc) P.legacyMoney++;
    if (sealedType) P.sealedRows++; else P.byType[r.type] = (P.byType[r.type] || 0) + 1;
    if (r.deleted) P.deleted++;
    const local = (sealedType ? sealed : records)[r.id], ts = +r.updatedAt || 0;
    if (!local) P.fresh++; else if (sealedType && !r.enc) P.newer++; else if (ts > (+local.updatedAt || 0)) P.newer++; else P.same++;
  });
  return P;
}
function confirmRestore(P, fileName) {
  return new Promise(res => {
    let done = false; const finish = v => { if (!done) { done = true; res(v); } };
    const grouped = {}; Object.entries(P.byType).forEach(([t, n]) => { const k = RESTORE_LABELS[t] || 'Settings & other'; grouped[k] = (grouped[k] || 0) + n; });
    const types = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
    $('rsBody').innerHTML = `<p class="hint" style="margin:0 4px 6px">${esc(fileName || 'Backup file')} · ${P.total.toLocaleString('en-IN')} entries. Nothing has been changed yet.</p>
      <div class="rs-grid"><div><b>${P.fresh}</b>new on this device</div><div><b>${P.newer}</b>would replace an older copy here</div><div><b>${P.same}</b>already here, or newer here — kept</div>${P.unusable || P.ignored ? `<div><b>${P.unusable + P.ignored}</b>skipped (not usable)</div>` : ''}</div>
      <div class="group-title">What is inside</div>
      <div class="group">${types.map(([t, n]) => `<div class="chk-row"><div class="row-main"><div class="row-title">${esc(t)}</div></div><b>${n}</b></div>`).join('')}
        ${P.sealedRows ? `<div class="chk-row"><div class="row-main"><div class="row-title">Money &amp; private items</div><div class="row-sub">${P.legacyMoney ? `${P.legacyMoney} from the old app will be encrypted with your private code` : 'stay encrypted'}</div></div><b>${P.sealedRows}</b></div>` : ''}</div>
      ${P.deleted ? `<p class="hint">${P.deleted} of these are items that were deleted when the backup was made; they come back as deleted.</p>` : ''}
      <p class="hint">Restoring never removes anything on this device. A copy is replaced only when the backup's copy is newer.</p>`;
    $('rsGo').disabled = !(P.fresh + P.newer); $('rsGo').textContent = P.fresh + P.newer ? `Restore ${P.fresh + P.newer}` : 'Nothing to restore';
    $('rsGo').onclick = () => { finish(true); Sheets.close('shRestore', true); };
    Sheets.onClose.shRestore = () => finish(false);
    Sheets.open('shRestore');
  });
}

/* Looks only at this device: nothing is sent anywhere. */
function securityChecks() {
  const out = [], unlocked = finUnlocked(), fk = records[FINKEY_ID];
  const add = (state, t, d, act) => out.push({ state, t, d, act });
  if (!finConfigured()) add('info', 'Private section', 'Not set up yet. Tap “Register” three times to choose a code for Money and private notes.');
  else {
    if (!unlocked) add('info', 'Private code strength', 'Unlock the private section to check it.');
    else if (Fin.codeLen && Fin.codeLen < 12) add('warn', 'Private code is short', `It is ${Fin.codeLen} characters. A phrase of four or more words is much harder to guess.`, { label: 'Change code', fn: () => openVault('change') });
    else if (Fin.codeLen) add('ok', 'Private code length', `${Fin.codeLen} characters.`);
    const it = fk ? (+fk.iters || FIN_ITERS) : FIN_ITERS_NEW;
    if (it < FIN_ITERS_NEW) add('warn', 'Older key setting', `Your code is stretched ${it.toLocaleString('en-IN')} times; new codes use ${FIN_ITERS_NEW.toLocaleString('en-IN')}. Changing the code upgrades it — your other devices will ask for the new code.`, unlocked ? { label: 'Change code', fn: () => openVault('change') } : null);
    else add('ok', 'Key setting', 'Uses the current strength.');
  }
  if (Sync.on()) {
    const tl = String(prefs.cloudToken || '').length;
    if (tl < 24) add('warn', 'Sync token is short', `It is ${tl} characters, so it can be guessed. Anyone who has it can read everything in the Sheet that is not Money, and the Drive files. In Apps Script run makeToken, paste the long token into SECRET and into Settings → Token, then deploy a new version.`);
    else add('ok', 'Sync token', 'Long enough.');
  } else add('info', 'Sync', 'Not connected — nothing leaves this device.');
  add('info', 'What is encrypted', 'Money, Plan, private notes (PNote), the Emergency sheet, locked document files and locked document numbers are encrypted with your private code. Tasks, notes, dates and other document details are plain text in your Google Sheet — keep official case details out of them.');
  if ((Fin.tampered || []).length) add('warn', `${Fin.tampered.length} private entr${Fin.tampered.length > 1 ? 'ies' : 'y'} failed the integrity check`, 'Their outer details in the Sheet do not match the encrypted copy. They are not shown. Review them in Settings → Backup & Data → Data health.', { label: 'Data health', fn: () => { Sheets.close('shSecCheck', true); openDataHealth(); } });
  const ids = all('doc').filter(d => d.docType === 'Identity' && !d.lockFiles && (d.number || docFilesOf(d.id).length));
  if (ids.length) add('warn', `${ids.length} ID document${ids.length > 1 ? 's' : ''} not locked`, 'Numbers (Aadhaar, PAN…) are in your Sheet as plain text and the files in Drive are not encrypted. Open each one and switch on “Lock files”: ' + ids.slice(0, 4).map(d => d.title).join(', ') + (ids.length > 4 ? '…' : '') + '.', { label: 'Open first', fn: () => { Sheets.close('shSecCheck', true); Sheets.close('shSettings', true); showTab('docs'); openDoc(ids[0].id); } });
  else if (all('doc').some(d => d.docType === 'Identity')) add('ok', 'ID documents', 'All locked.');
  const last = +(lsGet('r2_lastBackup') || 0), days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (days == null || days > 30) add('warn', days == null ? 'No backup made on this device' : `Last backup ${days} days ago`, 'A backup file is your way back if the phone is lost.', unlocked ? { label: 'Encrypted backup', fn: () => $('setBackupEnc').click() } : { label: 'Download backup', fn: () => $('setBackup').click() });
  else add('ok', 'Backup', days === 0 ? 'Made today.' : `Made ${days} day${days > 1 ? 's' : ''} ago.`);
  if (driveOn()) { if (prefs.autoBackup) add('ok', 'Weekly Drive backup', 'On.'); else add('warn', 'Weekly Drive backup is off', 'It keeps encrypted copies in your Drive folder. Turn it on in Settings → Data (needs Money unlocked).'); }
  if (AppLock.on()) add('ok', 'Face ID to open', 'On. It is a screen lock: it stops someone opening the app. What is stored on the phone is protected by the iPhone passcode, not by this lock.'); else add('warn', 'Face ID to open is off', 'Anyone who opens the app past the decoy screen sees your tasks, notes and documents.', { label: 'Turn on', fn: () => { Sheets.close('shSecCheck', true); $('setAppLock').click(); } });
  if (prefs.decoyLaunch) add('ok', 'Decoy screen', 'Shown when the app opens.'); else add('warn', 'Decoy screen is off at launch', 'The app opens straight onto your data.', { label: 'Turn on', fn: () => { setPref('decoyLaunch', true); if ($('setDecoy')) $('setDecoy').checked = true; } });
  if (+prefs.appIdle > 0) add('ok', 'Idle lock', `After ${prefs.appIdle} minute${+prefs.appIdle > 1 ? 's' : ''}.`); else add('warn', 'The app never locks when idle', 'If you leave it open, it stays open.', { label: 'Lock after 5 min', fn: () => { setPref('appIdle', 5); if ($('setAppIdle')) $('setAppIdle').value = '5'; } });
  return out;
}
function openSecCheck() {
  const L = securityChecks(), warn = L.filter(c => c.state === 'warn').length;
  $('scBody').innerHTML = `<div class="sc-sum">${warn ? `${warn} thing${warn > 1 ? 's' : ''} worth fixing` : 'Nothing to fix'}</div><div class="group">${L.sort((a, b) => (b.state === 'warn') - (a.state === 'warn')).map((c, i) => `<div class="chk-row"><span class="sc-ic ${c.state}" aria-hidden="true">${c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : 'i'}</span><div class="row-main"><div class="row-title">${esc(c.t)}</div><div class="row-sub" style="white-space:normal">${esc(c.d)}</div></div>${c.act ? `<button class="btn small sc-act" data-sca="${i}">${esc(c.act.label)}</button>` : ''}</div>`).join('')}</div>
    <p class="hint">This looks only at settings on this device. It cannot see your Google account or Sheet.</p>`;
  $$('[data-sca]', $('scBody')).forEach(b => b.addEventListener('click', () => { const c = L[+b.dataset.sca]; c.act.fn(); if (Sheets.isOpen('shSecCheck')) openSecCheck(); }));
  if (!Sheets.isOpen('shSecCheck')) Sheets.open('shSecCheck');
}
$('setSecCheck').addEventListener('click', openSecCheck);

/* ==========================================================================
   v2.19 — quick money entry, insights, reminders, family, data health
   ======================================================================== */

/* ---------- small helpers ---------- */
const clampDay = v => { const n = parseInt(String(v == null ? '' : v).trim(), 10); return n >= 1 && n <= 31 && /^\d{1,2}$/.test(String(v).trim()) ? n : 0; };
const normName = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function waitAge(t) { const n = t.waitingSince ? -daysUntilISO(t.waitingSince) : 0; return n <= 0 ? 'since today' : n === 1 ? '1 day' : n + ' days'; }
let pendingAfterUnlock = null;                  // something to open once the private section is unlocked
function needUnlock(then) { if (Fin.key) { then(); return; } if (!finConfigured()) { toast('Set up the private section first — tap “Register” three times.'); return; } pendingAfterUnlock = then; openVault('unlock'); }

/* ---------- a job with a progress sheet (zip export, making scans searchable) ---------- */
const Job = { stop: false, running: false };
function jobOpen(title) { Job.stop = false; Job.running = true; $('jbTitle').textContent = title; $('jbMsg').className = 'msg'; $('jbMsg').textContent = 'Starting…'; $('jbBar').style.width = '0'; $('jbNote').innerHTML = ''; $('jbStop').textContent = 'Stop'; Sheets.open('shWork'); }
function jobStep(i, n, msg) { $('jbBar').style.width = (n ? Math.min(100, Math.round(i / n * 100)) : 0) + '%'; if (msg != null) $('jbMsg').textContent = msg; }
function jobDone(msg, err) { Job.running = false; $('jbBar').style.width = '100%'; $('jbMsg').className = 'msg ' + (err ? 'err' : 'ok'); $('jbMsg').textContent = msg; $('jbStop').textContent = 'Close'; }
$('jbStop').addEventListener('click', () => { if (!Job.running) { Sheets.close('shWork', true); return; } Job.stop = true; $('jbStop').textContent = 'Stopping…'; });
Sheets.onClose.shWork = () => { Job.stop = true; };

/* ==========================================================================
   MONEY — quick text entry ("250 chai"), repeat-last / recent
   ======================================================================== */
const MQ_KIND = { income: /^(received|recd|rcvd|got|income|salary|refund|cashback)$/i, lent: /^(lent|gave|diya|loaned)$/i, borrowed: /^(borrowed|took|liya)$/i, transfer: /^(transfer|tfr)$/i };
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
/* one place that writes a Ledger entry — used by the quick line and the form */
function saveMoneyEntry(x) {
  const fail = (msg, el) => { toast(msg); if (x.fromForm && el && $(el)) $(el).focus(); return null; };
  const amt = +x.amount;
  if (!isFinite(amt) || !(amt > 0)) return fail('Enter an amount.', 'afAmt');
  const kind = KINDS.some(k => k.v === x.kind) ? x.kind : 'expense', who = String(x.who || '').trim();
  if (isUdhaar(kind) && !who) return fail('Who is it with?', 'afWho');
  let acct = x.acct || undefined, to = kind === 'transfer' ? (x.to || undefined) : undefined;
  if (hasAccts()) {
    if (!acct || !acctById(acct)) { const l = lastAcct(isUdhaar(kind) ? 'udhaar' : kind), la = l && acctById(l); acct = la && !la.archived ? l : (defAcct(planCfg()) || undefined); }
    if (kind === 'transfer') { if (!to || !acctById(to)) return fail('A transfer needs two accounts.'); if (acct === to) return fail('Pick two different accounts.'); }
  } else { if (kind === 'transfer') return fail('Set up your accounts first (Money → Accounts).'); acct = undefined; to = undefined; }
  if (acct) { rememberAcct(isUdhaar(kind) ? 'udhaar' : kind, acct); if (to) rememberAcct('transferTo', to); }
  const date = ISO_DATE_RX.test(x.date || '') ? x.date : todayISO();
  const desc = String(x.desc || '').trim().slice(0, 200) || (kind === 'expense' ? 'Spent' : kind === 'income' ? 'Received' : kind === 'transfer' ? 'Transfer' : 'Udhaar');
  return put({ id: uid('f'), type: 'fin', desc, amount: Math.round(amt * 100) / 100, kind, category: kind === 'transfer' ? '' : (FIN_CATS.includes(x.cat) ? x.cat : ''), date,
    who: isUdhaar(kind) ? who : '', acct, to, recurring: !!x.recurring, paidAmount: 0, settled: false, deleted: false });
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

/* ==========================================================================
   MONEY — insights sheet: dashboard, net worth, budgets, subscriptions
   ======================================================================== */
function openInsights() { renderInsights(); if (!Sheets.isOpen('shInsights')) Sheets.open('shInsights'); }
function renderInsights() {
  if (!Fin.key) return;
  try { renderDash(); } catch (e) { RLOG.error('dashboard', e); }
  try { renderNwTrend(); } catch (e) { RLOG.error('net worth', e); $('nwTrend').innerHTML = ''; }
  try { renderBudgets(); } catch (e) { RLOG.error('budgets', e); }
  try { renderSubs(); } catch (e) { RLOG.error('subscriptions', e); $('subsBox').innerHTML = ''; }
}
$('finXlsxBtn').addEventListener('click', exportXlsx);
const shortAx = v => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return s + (a >= 1e7 ? (a / 1e7).toFixed(a % 1e7 ? 1 : 0) + ' Cr' : a >= 1e5 ? (a / 1e5).toFixed(a % 1e5 ? 1 : 0) + ' L' : a >= 1000 ? Math.round(a / 1000) + 'k' : String(Math.round(a))); };
function renderNwTrend() {
  const box = $('nwTrend'); if (!box) return;
  const c = planCfg(), head = '<h3 class="plan-h">Net worth over time</h3>';
  if (!c || !accts().length) { box.innerHTML = `<div class="plan-sec">${head}<p class="hint">Set up Money → Accounts to see “money you have” month by month.</p></div>`; return; }
  const cur = isoMonth(new Date());
  let act = cur >= c.startMonth ? planCompute(c, cur, 'actual') : [];
  if (act.length > 36) act = act.slice(-36);
  const fut = planCompute(c, planHorizon(c)).filter(r => r.ym > cur).slice(0, 12);
  const P = [...act.map(r => ({ ym: r.ym, v: r.worth, plan: false })), ...fut.map(r => ({ ym: r.ym, v: r.worth, plan: true }))];
  if (P.length < 2) { box.innerHTML = `<div class="plan-sec">${head}<p class="hint">Shows once there are two months to compare.</p></div>`; return; }
  const W = 640, H = 230, L = 58, R = 16, T = 14, B = 30, n = P.length;
  let lo = Math.min(...P.map(p => p.v)), hi = Math.max(...P.map(p => p.v));
  const span0 = hi - lo || Math.max(1000, Math.abs(hi) * .2); lo -= span0 * .1; hi += span0 * .1;
  const e = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))); let step = e;
  for (const k of [1, 2, 2.5, 5, 10]) { step = k * e; if ((hi - lo) / step <= 4) break; }
  const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  const X = i => L + (W - L - R) * i / (n - 1), Y = v => T + (H - T - B) * (1 - (v - y0) / (y1 - y0));
  let g = '';
  for (let v = y0; v <= y1 + step / 2; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="nw-grid"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="nw-ax">${shortAx(v)}</text>`;
  const every = Math.ceil(n / 6);
  P.forEach((p, i) => { if (i % every === 0 || i === n - 1) g += `<text x="${X(i).toFixed(1)}" y="${H - 9}" text-anchor="middle" class="nw-ax">${monthShort(p.ym)}</text>`; });
  const lastA = P.map(p => p.plan).lastIndexOf(false);
  const path = idx => idx.map((i, k) => (k ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(P[i].v).toFixed(1)).join(' ');
  const aIdx = P.map((p, i) => i).filter(i => !P[i].plan), pIdx = lastA >= 0 ? [lastA, ...P.map((p, i) => i).filter(i => P[i].plan)] : P.map((p, i) => i);
  if (aIdx.length > 1) g += `<path class="nw-line" d="${path(aIdx)}"/>`;
  if (pIdx.length > 1) g += `<path class="nw-plan" d="${path(pIdx)}"/>`;
  if (lastA >= 0) g += `<circle class="nw-dot" cx="${X(lastA).toFixed(1)}" cy="${Y(P[lastA].v).toFixed(1)}" r="4.5"/>`;
  g += `<line class="nw-x" id="nwX" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/><circle class="nw-dot" id="nwD" r="5" cx="0" cy="0" style="display:none"/>`;
  const now = lastA >= 0 ? P[lastA] : null;
  box.innerHTML = `<div class="plan-sec">${head}
    <div class="dash-card" style="margin-bottom:8px"><div class="k">Money you have${now ? ' · ' + esc(monthLong(now.ym)) : ''}</div><div class="v ${now && now.v < 0 ? 'neg' : ''}">${now ? rsShort(now.v) : '—'}</div>
      ${act.length > 1 ? (() => { const d = act[act.length - 1].worth - act[0].worth; return `<div class="s">${d >= 0 ? 'Up' : 'Down'} ${rsShort(Math.abs(d))} since ${monthLong(act[0].ym)}</div>`; })() : ''}</div>
    <div class="nw-wrap" id="nwWrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Money you have, month by month">${g}</svg><div class="nw-tip hidden" id="nwTip"></div></div>
    <div class="nw-key"><span><i></i>actual (month end)</span>${fut.length ? '<span><i class="p"></i>plan</span>' : ''}</div>
    <details class="fold" style="margin-top:6px"><summary>Show as a table</summary><div class="tw"><table class="pt"><thead><tr><th>Month</th><th>Money you have</th><th></th></tr></thead><tbody>${P.map(p => `<tr><td>${monthShort(p.ym)}</td><td>${rs(p.v)}</td><td>${p.plan ? '<span class="tag">plan</span>' : ''}</td></tr>`).join('')}</tbody></table></div></details>
    <p class="hint">Bank + cash + investments + udhaar net − card dues, at the end of each month (this month: as of today). Loans are not taken out — same as Accounts.</p></div>`;
  const wrap = $('nwWrap'), svg = wrap.querySelector('svg'), tip = $('nwTip'), vx = $('nwX'), vd = $('nwD');
  const show = ev => {
    const r = svg.getBoundingClientRect(); if (!r.width) return;
    const sx = (ev.clientX - r.left) / r.width * W, i = Math.max(0, Math.min(n - 1, Math.round((sx - L) / (W - L - R) * (n - 1)))), p = P[i];
    vx.setAttribute('x1', X(i)); vx.setAttribute('x2', X(i)); vx.style.display = ''; vd.setAttribute('cx', X(i)); vd.setAttribute('cy', Y(p.v)); vd.style.display = '';
    const wr = wrap.getBoundingClientRect();
    tip.innerHTML = `${esc(monthLong(p.ym))}${p.plan ? ' (plan)' : ''}<br><b>${esc(rs(p.v))}</b>`;
    tip.style.left = Math.max(60, Math.min(wr.width - 60, r.left - wr.left + X(i) / W * r.width)) + 'px'; tip.style.top = (r.top - wr.top + Y(p.v) / H * r.height) + 'px';
    tip.classList.remove('hidden');
  };
  const hide = () => { tip.classList.add('hidden'); vx.style.display = 'none'; vd.style.display = 'none'; };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
}
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

/* ==========================================================================
   REMINDERS IN DATES — card statement / due days, FD & PPF maturity, premiums
   (dates made here carry sysSrc + srcRef; deleting one by hand is respected)
   ======================================================================== */
function monthlyBase(day) {                                   // a January date: January has every day, so 29th–31st stay right in later months
  const t = todayISO(), y = +t.slice(0, 4), jan = `${y}-01-${String(day).padStart(2, '0')}`;
  return jan <= t ? jan : `${y - 1}-01-${String(day).padStart(2, '0')}`;
}
function sysDate(id, want, force) {
  const d = records[id];
  if (!want) { if (d && !d.deleted) { d.sysOff = true; softDeleteBase(id, { render: false }); } return; }
  if (d && d.deleted && !d.sysOff && !force) return;          // you deleted it from Dates yourself: not brought back until you save the account again
  if (d && !d.deleted && d.label === want.label && d.when === want.when && d.repeat === want.repeat && d.cat === want.cat && d.srcRef === want.srcRef) return;
  const rec = { ...(d || {}), id, type: 'date', label: want.label, when: want.when, repeat: want.repeat, cat: want.cat, srcRef: want.srcRef, sysSrc: want.sysSrc, deleted: false };
  delete rec.deletedAt; delete rec.sysOff; delete rec.needsDetail;
  put(rec, { render: false });
}
function acctDateWants(a) {
  const W = {}, on = a && !a.deleted && !a.archived && a.remind !== false;
  if (!on) return W;
  if (a.kind === 'card' && clampDay(a.stmtDay)) W.stmt = { label: `${a.name} — card statement`, when: monthlyBase(clampDay(a.stmtDay)), repeat: 'monthly', cat: 'bank' };
  if (a.kind === 'card' && clampDay(a.dueDay)) W.due = { label: `${a.name} — card payment due`, when: monthlyBase(clampDay(a.dueDay)), repeat: 'monthly', cat: 'bank' };
  if (a.kind === 'fd' && ISO_DATE_RX.test(a.matures || '')) W.mat = { label: `${a.name} — matures`, when: a.matures, repeat: 'once', cat: 'bank' };
  return W;
}
function syncAcctDates(a, force) {
  if (!a || !a.id) return;
  const W = acctDateWants(a);
  ['stmt', 'due', 'mat'].forEach(k => sysDate('ad-' + a.id + '-' + k, W[k] ? { ...W[k], srcRef: a.id, sysSrc: 'acct' } : null, force));
}
function recurDateWant(r) {
  if (!r || r.deleted || !r.remind || !ISO_DATE_RX.test(r.remindDate || '')) return null;
  const ev = +r.every || 1, repeat = ev === 12 ? 'yearly' : ev === 1 ? 'monthly' : 'once', day = +r.remindDate.slice(8, 10);
  let when = r.remindDate;
  if (repeat === 'once') { for (let k = 0; when < todayISO() && k < 600; k++) when = isoLocal(addMonthsKeep(new Date(when + 'T00:00:00'), ev, day)); }   // every 2, 3 or 6 months: the next one
  if (r.end && when.slice(0, 7) > r.end) return null;
  return { label: r.name, when, repeat, cat: /insur|premium|\blic\b|policy|mediclaim/i.test(r.name) ? 'insurance' : 'bank', srcRef: r.id, sysSrc: 'recur' };
}
function syncAllAcctDates() {
  if (!Fin.key || window.GHOST) return;
  accts(true).forEach(a => syncAcctDates(a, false));
  all('recur').forEach(r => sysDate('rd-' + r.id, recurDateWant(r), false));
  if (!(Fin.lockedOut || []).length) all('date').forEach(d => { if (d.sysSrc && (d.sysSrc === 'acct' || d.sysSrc === 'recur')) { const s = records[d.srcRef]; if (!s || s.deleted) sysDate(d.id, null); } });
}
{ const sd = softDelete, rs0 = restore;
  softDelete = function (id, opt) { const r = records[id]; sd(id, opt); if (r && (r.type === 'acct' || r.type === 'recur')) setTimeout(() => { try { syncAllAcctDates(); } catch (e) { RLOG.warn('acct dates', e.message); } }, 0); };
  restore = function (id) { const r = records[id]; rs0(id); if (r && (r.type === 'acct' || r.type === 'recur')) setTimeout(() => { try { if (r.type === 'acct') syncAcctDates(records[id], true); else sysDate('rd-' + id, recurDateWant(records[id]), true); } catch (e) { RLOG.warn('acct dates', e.message); } }, 0); };
}

/* ==========================================================================
   v2.19 — Settings: a menu, five sub-screens and a search box
   ======================================================================== */
const SET_PAGES = { privacy: 'Privacy', sync: 'Sync & Drive', data: 'Backup & Data', look: 'Look & Feel', emergency: 'Emergency' };
function setShowPage(pg) {
  $('setHome').classList.toggle('hidden', !!pg);
  $$('#shSettings .set-page').forEach(p => p.classList.toggle('hidden', p.dataset.page !== pg));
  $('setBack').style.visibility = pg ? 'visible' : 'hidden';
  $('setTitle').textContent = pg ? SET_PAGES[pg] : 'Settings';
  const b = $('shSettings').querySelector('.sheet-body'); if (b) b.scrollTop = 0;
}
function setRows() {
  return $$('#shSettings .set-page').flatMap(pg => $$('.set-row, .switch-row', pg).filter(r => !r.classList.contains('hidden') && !r.closest('.hidden:not(.set-page)')).map(r => {
    const c = r.cloneNode(true); $$('.v, select, input, small, .msg', c).forEach(x => x.remove());
    const sm = r.querySelector('small');
    return { r, page: pg.dataset.page, label: c.textContent.replace(/\s+/g, ' ').trim(), sub: sm ? sm.textContent.trim() : '' };
  })).filter(x => x.label);
}
function setSearch(q) {
  q = String(q || '').trim().toLowerCase();
  const box = $('setQRes'); $('setMenu').classList.toggle('hidden', !!q);
  if (!q) { box.hidden = true; box.innerHTML = ''; return; }
  const words = q.split(/\s+/);
  const L = setRows().filter(x => words.every(w => (x.label + ' ' + x.sub + ' ' + SET_PAGES[x.page]).toLowerCase().includes(w))).slice(0, 25);
  box.hidden = false;
  box.innerHTML = L.length ? L.map((x, i) => `<button class="set-row sq-row" data-sq="${i}"><span>${esc(x.label)}<small>${esc(SET_PAGES[x.page])}</small></span><span class="v">›</span></button>`).join('') : '<div class="empty">No setting matches.</div>';
  $$('[data-sq]', box).forEach(b => b.addEventListener('click', () => {
    const x = L[+b.dataset.sq]; $('setQ').value = ''; setSearch(''); setShowPage(x.page);
    setTimeout(() => { x.r.scrollIntoView({ block: 'center' }); x.r.classList.add('set-hit'); setTimeout(() => x.r.classList.remove('set-hit'), 1600); }, 60);
  }));
}
$$('#setMenu [data-page]').forEach(b => b.addEventListener('click', () => setShowPage(b.dataset.page)));
$('setBack').addEventListener('click', () => setShowPage(null));
$('setQ').addEventListener('input', () => setSearch($('setQ').value));
Sheets.onOpen.shSettings = () => { $('setQ').value = ''; setSearch(''); setShowPage(null);
  try { const w = securityChecks().filter(c => c.state === 'warn').length; $('setPrivV').textContent = w ? w + ' to review' : '›'; } catch (e) {}
  $('setSyncV').textContent = Sync.on() ? (Sync.lastOk ? 'synced ' + timeAgo(Sync.lastOk) : 'connected') : 'off';
  $('setScanIdxV').textContent = scanIdxLabel(); };
$('setHealth').addEventListener('click', () => { Sheets.close('shSettings', true); openDataHealth(); });
$('setWhatsNew').addEventListener('click', () => showWhatsNew());
$('setScanIdx').addEventListener('click', () => { Sheets.close('shSettings', true); indexAllScans(); });

/* ==========================================================================
   v2.19 — Data health: one place to see that everything is safe
   ======================================================================== */
async function openDataHealth() {
  if (window.GHOST) { ghostCrash(true); return; }
  const rows = [], add = (state, t, d, act) => rows.push({ state, t, d, act });
  const dirty = Object.values(records).filter(r => r._dirty && !SEALED_TYPES.has(r.type) && !LOCAL_ONLY_TYPES.has(r.type)).length + Object.values(sealed).filter(s => s._dirty).length;
  if (!Sync.on()) add('warn', 'Sync is off', 'Everything stays on this device only. A lost phone means lost data unless you keep backup files.', { label: 'Set up', fn: () => { Sheets.close('shHealth', true); openSettings(); setShowPage('sync'); } });
  else {
    const age = Sync.lastOk ? Date.now() - Sync.lastOk : Infinity;
    add(age > 3 * 86400000 ? 'warn' : 'ok', 'Last sync', `${Sync.lastOk ? timeAgo(Sync.lastOk) : 'never'}${dirty ? ` · ${dirty} change${dirty > 1 ? 's' : ''} waiting to upload` : ' · everything uploaded'}.`, { label: 'Sync now', fn: async () => { await Sync.run(true); openDataHealth(); } });
    if (Sync.incomplete) add('warn', 'Long items still arriving', `${Sync.incomplete} long item${Sync.incomplete > 1 ? 's' : ''} from another device did not arrive complete. They will on a later sync.`);
  }
  const lastDl = +(lsGet('r2_lastBackup') || 0), drv = AutoBackup.list().slice(-1)[0];
  const bkDays = lastDl ? Math.floor((Date.now() - lastDl) / 86400000) : null;
  add(bkDays == null || bkDays > 30 ? 'warn' : 'ok', 'Last backup', `${lastDl ? (bkDays === 0 ? 'today' : bkDays + ' day' + (bkDays > 1 ? 's' : '') + ' ago') : 'never on this device'}${drv ? ` · Drive copy ${fmtDate(drv.date, true)} (${drv.count} items)` : prefs.autoBackup ? '' : ' · weekly Drive backup is off'}.`,
    { label: Fin.key ? 'Encrypted backup' : 'Backup', fn: () => $(Fin.key ? 'setBackupEnc' : 'setBackup').click() });
  const big = [...Object.values(records).filter(r => r._tooBig && !r.deleted && !SEALED_TYPES.has(r.type)), ...Object.values(sealed).filter(s => s._tooBig && !s.deleted)];
  const chunked = Object.values(records).filter(r => r._chunked && !r.deleted).length + Object.values(sealed).filter(s => s._chunked && !s.deleted).length;
  if (big.length) add('warn', `${big.length} item${big.length > 1 ? 's' : ''} not in the Sheet`, 'Too large even when split. They are only on this device: ' + big.slice(0, 5).map(r => (records[r.id] && (records[r.id].title || records[r.id].label || records[r.id].desc)) || r.type).join(', ') + (big.length > 5 ? '…' : '') + '. Shorten or split them.');
  else add('ok', 'Item sizes', chunked ? `${chunked} long item${chunked > 1 ? 's are' : ' is'} stored in parts — that is fine.` : 'Everything fits in the Sheet.');
  let pers = null, est = null;
  try { if (navigator.storage && navigator.storage.persisted) pers = await navigator.storage.persisted(); } catch (e) {}
  try { if (navigator.storage && navigator.storage.estimate) est = await navigator.storage.estimate(); } catch (e) {}
  const mb = n => (n / 1048576).toFixed(n > 104857600 ? 0 : 1) + ' MB';
  add(pers === false ? 'warn' : pers ? 'ok' : 'info', 'Storage on this device', `${pers ? 'Kept: the browser will not clear it to save space.' : pers === false ? 'Not marked as permanent: under low storage the browser may clear it. Keep sync and backups on.' : 'This browser does not say.'}${est && est.usage ? ` Using ${mb(est.usage)}${est.quota ? ' of ' + mb(est.quota) : ''}.` : ''}`,
    pers === false && navigator.storage && navigator.storage.persist ? { label: 'Ask again', fn: async () => { try { window.__persist = await navigator.storage.persist(); } catch (e) {} openDataHealth(); } } : null);
  const dc = DriveChk.get(), bad = DriveChk.bad().length;
  if (driveOn()) add(bad ? 'warn' : 'ok', 'Files in Drive', `${dc ? 'Checked ' + timeAgo(dc.at) : 'Not checked yet'}${bad ? ` · ${bad} missing` : ''}.`, { label: bad ? 'Review' : 'Check now', fn: () => { Sheets.close('shHealth', true); openDriveChk(); if (!bad) DriveChk.run(true); } });
  if (finConfigured()) {
    if (!Fin.key) add('info', 'Private entries', 'Unlock the private section to check Money, PNote and the Emergency sheet.', { label: 'Unlock', fn: () => { Sheets.close('shHealth', true); needUnlock(openDataHealth); } });
    else {
      if (Fin.lockedOut.length) add('warn', `${Fin.lockedOut.length} private entr${Fin.lockedOut.length > 1 ? 'ies' : 'y'} under an older code`, 'Open Money — it asks for the older code once and brings them across.', { label: 'Open Money', fn: () => { Sheets.close('shHealth', true); showTab('money'); } });
      if (Fin.tampered.length) add('warn', `${Fin.tampered.length} private entr${Fin.tampered.length > 1 ? 'ies' : 'y'} failed the integrity check`, 'The details next to the encrypted copy in the Sheet do not match it (id, date, deleted). They are hidden. If you restored an old backup or edited the Sheet by hand, accepting is safe; otherwise someone may have changed the Sheet.', { label: 'Accept all', fn: async () => { let k = 0; for (const id of Fin.tampered.slice()) if (await acceptTampered(id)) k++; toast(`${k} accepted.`); scheduleRender(); openDataHealth(); } });
      if (!Fin.lockedOut.length && !Fin.tampered.length) add('ok', 'Private entries', `All ${Object.keys(sealed).length} encrypted entries open and pass the integrity check.`);
    }
  }
  const sc = scanIdxStats();
  if (sc.total) add(sc.todo ? 'info' : 'ok', 'Searchable PDFs', `${sc.done} of ${sc.total} PDFs can be searched by their words${sc.none ? ` (${sc.none} are photos without text)` : ''}${sc.locked ? `; ${sc.locked} locked PDF${sc.locked > 1 ? 's are' : ' is'} not indexed` : ''}.`, sc.todo ? { label: 'Index ' + sc.todo, fn: () => { Sheets.close('shHealth', true); indexAllScans(); } } : null);
  add('info', 'This device', `Register v${APP_VERSION} · ${(Object.keys(records).filter(id => !SEALED_TYPES.has(records[id].type) && !LOCAL_ONLY_TYPES.has(records[id].type)).length + Object.keys(sealed).length).toLocaleString('en-IN')} records.`);
  const warn = rows.filter(r => r.state === 'warn').length;
  $('hlBody').innerHTML = `<div class="sc-sum">${warn ? `${warn} thing${warn > 1 ? 's' : ''} to look at` : 'All good'}</div><div class="group">${rows.map((c, i) => `<div class="hl-row"><span class="sc-ic ${c.state}" aria-hidden="true">${c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : 'i'}</span><div class="row-main"><div class="row-title">${esc(c.t)}</div><div class="row-sub">${esc(c.d)}</div></div>${c.act ? `<button class="btn small ghost" data-hla="${i}">${esc(c.act.label)}</button>` : ''}</div>`).join('')}</div>
    <p class="hint">Looks at this device and its last sync. Nothing is sent anywhere.</p>`;
  $$('[data-hla]', $('hlBody')).forEach(b => b.addEventListener('click', () => rows[+b.dataset.hla].act.fn()));
  $('setHealthV').textContent = warn ? warn + ' to look at' : '✓';
  if (!Sheets.isOpen('shHealth')) Sheets.open('shHealth');
}

/* ==========================================================================
   v2.19 — Weekly review
   ======================================================================== */
function openWeekly() {
  if (window.GHOST) { ghostCrash(true); return; }
  const t = todayISO(), wk = addDays(-6), next = addDays(7), next14 = addDays(14), T = all('task');
  const doneWk = T.filter(x => x.status === 'done' && x.completedOn && x.completedOn >= wk);
  const overdue = T.filter(isOverdue).sort(byDueThenPrio), waiting = T.filter(x => x.status === 'waiting').sort((a, b) => String(a.waitingSince || '').localeCompare(String(b.waitingSince || '')));
  const dueNext = T.filter(x => x.status !== 'done' && x.dueDate && x.dueDate >= t && x.dueDate <= next).sort(byDueThenPrio);
  const dates = dateRows(all('date').filter(d => d.when)).filter(x => x.days >= 0 && x.days <= 14);
  const docs = all('doc').filter(d => d.expiry && daysUntilISO(d.expiry) <= 30 && daysUntilISO(d.expiry) >= -10).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const inbox = all('inbox').length, notesWk = all('note').filter(n => (n.updatedAt || 0) >= Date.now() - 7 * 86400000).length;
  const row = (k, id, title, sub, when, neg) => `<button class="td-row" data-wk="${k}" data-wkid="${esc(id)}"><span class="t">${title}${sub ? `<small>${sub}</small>` : ''}</span>${when ? `<span class="w${neg ? ' neg' : ''}">${when}</span>` : ''}</button>`;
  const sec = (h, rows, empty) => `<div class="group-title">${h}</div>` + (rows.length ? `<div class="group">${rows.join('')}</div>` : `<p class="hint" style="margin:0 4px 6px">${empty}</p>`);
  let money = '';
  if (Fin.key) {
    const F = all('fin').filter(e => (e.date || '') >= wk && (e.date || '') <= t), M = monthFigures(F), byC = {};
    F.filter(e => e.kind === 'expense' && e.category !== 'Investment').forEach(e => { const c = e.category || 'Other'; byC[c] = (byC[c] || 0) + (+e.amount || 0); });
    const top = Object.entries(byC).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const subs = detectSubs().length;
    money = `<div class="group-title">₹ Money · last 7 days</div><div class="wk-grid"><div><span class="wk-n">${rsShort(M.out)}</span><br>spent</div><div><span class="wk-n">${rsShort(M.inc)}</span><br>received</div>${M.inv ? `<div><span class="wk-n">${rsShort(M.inv)}</span><br>into investments</div>` : ''}</div>
      ${top.length ? `<p class="hint" style="margin:-4px 4px 8px">Most on ${top.map(([c, a]) => `${esc(c)} ${rsShort(a)}`).join(' · ')}.</p>` : ''}${subs ? `<button class="linkbtn" id="wkSubs">${subs} payment${subs > 1 ? 's look' : ' looks'} like a subscription — review ›</button>` : ''}`;
  } else if (finConfigured()) money = '<p class="hint" style="margin:10px 4px">Open Money (tap “Register” three times) to add the week\'s spending here.</p>';
  const last = +(lsGet('r2_lastReview') || 0);
  $('wkBody').innerHTML = `<div class="td-h">Week of ${fmtDate(wk, true)} – ${fmtDate(t, true)}</div>
    <div class="wk-grid"><div><span class="wk-n">${doneWk.length}</span><br>tasks done</div><div><span class="wk-n ${overdue.length ? 'neg' : ''}">${overdue.length}</span><br>overdue</div><div><span class="wk-n">${waiting.length}</span><br>waiting on others</div><div><span class="wk-n">${inbox}</span><br>in the Inbox</div></div>
    ${sec(`⚠︎ Overdue (${overdue.length})`, overdue.slice(0, 15).map(x => row('task', x.id, esc(x.title), esc(x.category), fmtDate(x.dueDate), true)), 'Nothing overdue.')}
    ${sec(`⏳ Waiting on (${waiting.length})`, waiting.slice(0, 15).map(x => row('task', x.id, esc(x.title), x.waitingOn ? 'on ' + esc(x.waitingOn) : '', x.waitingSince ? waitAge(x) : '', x.waitingSince && -daysUntilISO(x.waitingSince) > 7)), 'Nobody to chase.')}
    ${sec(`☑︎ Due in the next 7 days (${dueNext.length})`, dueNext.slice(0, 15).map(x => row('task', x.id, esc(x.title), esc(x.category), relDay(x.dueDate), false)), 'Nothing due.')}
    ${sec(`📅 Dates · next 14 days (${dates.length})`, dates.slice(0, 15).map(x => row('date', x.d.id, esc(x.d.label), '', x.days === 0 ? 'today' : inDays(x.days), false)), 'No dates coming up.')}
    ${docs.length ? sec(`📁 Documents expiring (${docs.length})`, docs.slice(0, 10).map(d => row('doc', d.id, esc(d.title), esc(docOwners(d).join(' & ')), daysUntilISO(d.expiry) < 0 ? 'expired' : inDays(daysUntilISO(d.expiry)), daysUntilISO(d.expiry) < 0)), '') : ''}
    ${money}
    <div class="group-title">✓ Done this week (${doneWk.length})</div>${doneWk.length ? `<p class="hint" style="margin:0 4px 8px">${doneWk.slice(0, 12).map(x => esc(x.title)).join(' · ')}${doneWk.length > 12 ? ' …' : ''}</p>` : '<p class="hint" style="margin:0 4px 8px">Nothing marked done this week.</p>'}
    ${notesWk ? `<p class="hint" style="margin:0 4px 8px">${notesWk} note${notesWk > 1 ? 's' : ''} written or changed this week.</p>` : ''}
    <div class="btn-row" style="margin-top:14px">${inbox ? '<button class="btn ghost small" id="wkInbox">📥 Sort the Inbox</button>' : ''}<button class="btn small brass" id="wkDone">Mark this week reviewed</button></div>
    <p class="hint">${last ? 'Last reviewed ' + timeAgo(last) + '.' : 'Not reviewed before on this device.'} A short look every Sunday keeps nothing slipping.</p>`;
  $$('[data-wk]', $('wkBody')).forEach(b => b.addEventListener('click', () => { const k = b.dataset.wk, id = b.dataset.wkid; Sheets.close('shWeekly', true);
    if (k === 'task') { showTab('tasks'); previewTask(id); } else if (k === 'date') { datePath = null; showTab('dates'); openDate(id); } else if (k === 'doc') { showTab('docs'); showDoc(id); } }));
  if ($('wkInbox')) $('wkInbox').addEventListener('click', () => { Sheets.close('shWeekly', true); openInbox(); });
  if ($('wkSubs')) $('wkSubs').addEventListener('click', () => { Sheets.close('shWeekly', true); setPref('moneySeg', 'ledger'); showTab('money'); openInsights(); setTimeout(() => { const s = $('subsBox'); if (s) s.scrollIntoView({ block: 'start' }); }, 300); });
  $('wkDone').addEventListener('click', () => { lsSet('r2_lastReview', String(Date.now())); Sheets.close('shWeekly'); toast('Week reviewed. See you next week.'); });
  if (!Sheets.isOpen('shWeekly')) Sheets.open('shWeekly');
}
const weeklyDue = () => { const last = +(lsGet('r2_lastReview') || 0); return !last || Date.now() - last > 6.5 * 86400000; };

/* ==========================================================================
   v2.19 — saved searches (kept in the Sheet, so every device has them)
   ======================================================================== */
const SAVEDQ_ID = 'saved-q';
const savedQ = () => { const r = records[SAVEDQ_ID]; return r && !r.deleted && Array.isArray(r.list) ? r.list.filter(x => typeof x === 'string') : []; };
function setSavedQ(list) { const r = records[SAVEDQ_ID]; put({ ...(r || { id: SAVEDQ_ID, type: 'savedq' }), list: [...new Set(list)].slice(0, 20), deleted: false }, { render: false }); }
function savedSearchUI(q, box) {
  if (window.GHOST) return;
  const L = savedQ(), qq = String(q || '').trim();
  if (!qq) {
    if (!L.length) return;
    box.insertAdjacentHTML('afterbegin', `<div class="sug-panel" style="padding-bottom:0"><div class="sug-t"><span>Saved searches</span></div><div class="sug-chips">${L.map((s, i) => `<button data-svq="${i}">☆ ${esc(s)}</button>`).join('')}</div></div>`);
    $$('[data-svq]', box).forEach(b => {
      b.addEventListener('click', () => { $('searchIn').value = L[+b.dataset.svq]; runSearch(); });
      let t = null; b.addEventListener('contextmenu', e => e.preventDefault());
      b.addEventListener('touchstart', () => { t = setTimeout(() => { t = 'x'; if (confirm(`Remove the saved search “${L[+b.dataset.svq]}”?`)) { setSavedQ(L.filter((x, i) => i !== +b.dataset.svq)); runSearch(); } }, 600); }, { passive: true });
      b.addEventListener('touchend', e => { if (t === 'x') e.preventDefault(); clearTimeout(t); t = null; });
    });
    box.insertAdjacentHTML('beforeend', '<p class="hint" style="margin:8px 4px">Press and hold a saved search to remove it.</p>');
    return;
  }
  const on = L.some(x => x.toLowerCase() === qq.toLowerCase());
  box.insertAdjacentHTML('afterbegin', `<div style="display:flex;justify-content:flex-end;padding:6px 10px 0"><button class="linkbtn" id="svqBtn" style="font-size:.8125rem">${on ? '★ Saved — remove' : '☆ Save this search'}</button></div>`);
  $('svqBtn').addEventListener('click', () => { setSavedQ(on ? L.filter(x => x.toLowerCase() !== qq.toLowerCase()) : [qq, ...L]); toast(on ? 'Saved search removed.' : 'Saved — it shows when you open search.'); runSearch(); });
}

/* ==========================================================================
   v2.19 — what changed, and the long-press hint
   ======================================================================== */
const WHATS_NEW = [
  '<b>Money → Ledger</b> is simpler: a month header that stays on top, your balances as chips, this month\'s net with an in/out bar, and entries by day with a total for each day. Search and filter open from the funnel; the dashboard, net worth, budgets, subscriptions and exports from 📊.',
  '<b>Quick entry</b>: tap + in Money and type a line — “250 chai”, “+50000 salary”, “lent 2000 Ravi”, “499 netflix @hdfc yday”. Your recent entries are one tap away.',
  '<b>Investments</b> (category Investment) are shown on their own line, not as spending — the Ledger, dashboard and PDF report now agree. Budgets are back (in 📊).',
  '<b>Reminders</b>: credit-card statement and due days, FD/PPF maturity and premiums can go into Dates.',
  '<b>Family</b>: a document checklist for Papa, Mummy and Ruchi; an encrypted Emergency sheet (where originals are kept, nominees); one-tap .zip of a person\'s documents; words inside PDFs are now searchable.',
  '<b>Tasks</b>: a “Waiting on” status, a Weekly review (in ☀︎ Today), and saved searches.',
  '<b>Settings</b> are in five groups with a search box; <b>Data health</b> shows sync, backups, storage and anything that needs a look.',
  '<b>Safety</b>: private entries are checked against tampering, very long notes now sync in parts, a note changed on two devices keeps both versions, and new private codes need 12+ characters.'
];
function showWhatsNew() {
  $('nwBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Register ${APP_VERSION}</p><ul class="nw-list">${WHATS_NEW.map(x => `<li>${x}</li>`).join('')}</ul>
    <p class="hint">The 7 AM email has been switched off. Update the Apps Script to v25 for the email change and the stronger emergency erase.</p>`;
  if (!Sheets.isOpen('shNews')) Sheets.open('shNews');
}
function afterAppShown() {
  if (window.GHOST || document.documentElement.classList.contains('decoy-on')) return;
  const seen = lsGet('r2_seenVer'), had = !!seen || Object.keys(records).length > 3;
  if (seen !== APP_VERSION) { lsSet('r2_seenVer', APP_VERSION); if (had) setTimeout(() => { if (!Sheets.top()) showWhatsNew(); }, 900); return; }
  const n = (+(lsGet('r2_shown') || 0)) + 1; lsSet('r2_shown', String(n));
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

/* ==========================================================================
   v2.19 — Family: document checklist (Papa, Mummy, Ruchi)
   ======================================================================== */
const FAM_ID = 'fam-check', FAM_PEOPLE = ['Papa', 'Mummy', 'Ruchi'];
const FAM_DEFAULT = {
  Papa: ['Aadhaar card', 'PAN card', 'Passport', 'Voter ID', 'Driving licence', 'Bank passbook / KYC', 'Pension / PPO', 'Health insurance', 'Life insurance / LIC', 'Will / Nominee', 'Property papers', 'Photo & signature'],
  Mummy: ['Aadhaar card', 'PAN card', 'Passport', 'Voter ID', 'Bank passbook / KYC', 'Health insurance', 'Life insurance / LIC', 'Will / Nominee', 'Photo & signature'],
  Ruchi: ['Aadhaar card', 'PAN card', 'Passport', 'Voter ID', 'Driving licence', 'Bank passbook / KYC', 'Marriage certificate', 'Education certificates / Marksheet', 'Health insurance', 'Life insurance / LIC', 'Photo & signature']
};
const FAM_GENERIC = new Set(['card', 'details', 'detail', 'certificate', 'certificates', 'copy', 'papers', 'paper', 'policy', 'document', 'documents', 'the', 'of', 'and', 'id', 'no', 'number']);
const famCfg = () => { const r = records[FAM_ID]; return r && !r.deleted ? r : null; };
const famList = p => { const c = famCfg(); const L = c && c.lists && Array.isArray(c.lists[p]) ? c.lists[p] : null; return (L || FAM_DEFAULT[p] || FAM_DEFAULT.Ruchi).filter(x => typeof x === 'string' && x.trim()); };
const famNorm = w => { w = String(w || '').toLowerCase().replace(/aadhaar/g, 'aadhar').replace(/licen[cs]e/g, 'licence'); return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w; };
function famWordsOf(part) {
  const ws = String(part).replace(/&/g, ' ').split(/[^A-Za-z0-9ऀ-ॿ]+/).map(famNorm).filter(Boolean);
  const sig = ws.filter(w => !FAM_GENERIC.has(w)); return sig.length ? sig : ws;
}
function famMatch(item, d) {
  const hay = new Set([d.title, d.docType, docGroup(d), d.issuer].join(' ').split(/[^A-Za-z0-9ऀ-ॿ]+/).map(famNorm).filter(Boolean));
  const hit = w => hay.has(w) || (w.length > 3 && [...hay].some(h => h.startsWith(w)));
  return String(item).split('/').map(x => x.trim()).filter(Boolean).some(part => famWordsOf(part).every(hit));
}
const FAM_TYPE = [[/aadha|pan\b|passport|voter|licen|ration/i, 'Identity'], [/insurance|\blic\b|mediclaim/i, 'Insurance'], [/bank|kyc|passbook|pension|ppo|fd\b/i, 'Financial'],
  [/property|house|flat|land/i, 'Property'], [/marriage|birth|death|caste/i, 'Certificate'], [/education|marksheet|degree|10th|12th/i, 'Education'], [/photo|signature/i, 'Photo & Signature'], [/vehicle|\brc\b|car/i, 'Vehicle']];
const famType = item => { const h = FAM_TYPE.find(([rx]) => rx.test(item)); return h && DOC_TYPES.includes(h[1]) ? h[1] : 'Other'; };
function famStatus(p) {
  const docs = all('doc').filter(d => docOwners(d).includes(p));
  return famList(p).map(item => {
    const m = docs.filter(d => famMatch(item, d)), withFile = m.find(d => docFilesOf(d.id).length);
    return { item, doc: withFile || m[0] || null, st: withFile ? 'ok' : m.length ? 'part' : 'no' };
  });
}
let famWho = 'Papa', famEdit = false;
function openFamily(p) {
  if (window.GHOST) { ghostCrash(true); return; }
  if (p) famWho = p; if (!FAM_PEOPLE.includes(famWho)) famWho = FAM_PEOPLE[0];
  const S = famStatus(famWho), ok = S.filter(x => x.st === 'ok').length;
  const chips = FAM_PEOPLE.map(x => { const s = famStatus(x), n = s.filter(y => y.st === 'ok').length; return `<button class="chip ${x === famWho ? 'on' : ''}" data-fp="${esc(x)}">${esc(x)} <span class="n">${n}/${s.length}</span></button>`; }).join('');
  $('fcTitle').textContent = 'Family checklist';
  $('fcBody').innerHTML = `<div class="wrapchips" style="margin-bottom:12px">${chips}</div>
    ${famEdit ? `<p class="hint" style="margin:0 4px 8px">One document per line. Words after “/” are other names for the same thing (e.g. “Life insurance / LIC”).</p>
      <textarea id="fcText" rows="12">${esc(famList(famWho).join('\n'))}</textarea>
      <div class="btn-row"><button class="btn ghost" id="fcReset">Default list</button><button class="btn brass" id="fcSave">Save list</button></div>`
    : `<div class="group" style="padding:12px 14px;margin-bottom:12px"><b>${esc(famWho)}</b> · ${ok} of ${S.length} with a file<div class="fc-prog"><i style="width:${S.length ? Math.round(ok / S.length * 100) : 0}%"></i></div>
      <div class="hint" style="margin:4px 0 0">✓ entry with a file · … entry but no file yet · ✗ not in Docs</div></div>
      <div class="group">${S.map((x, i) => `<button class="fc-row" data-fi="${i}"><span class="fc-st ${x.st}" aria-label="${x.st === 'ok' ? 'done' : x.st === 'part' ? 'no file' : 'missing'}">${x.st === 'ok' ? '✓' : x.st === 'part' ? '…' : '✗'}</span>
        <span class="row-main"><span class="row-title" style="display:block">${esc(x.item.split('/')[0].trim())}</span><span class="row-sub">${x.doc ? esc(x.doc.title) + (x.st === 'part' ? ' · add the file' : '') : 'Tap to add'}</span></span><span class="chev">›</span></button>`).join('')}</div>
      <div class="btn-row" style="flex-wrap:wrap"><button class="btn ghost small" id="fcEdit">✎ Edit ${esc(famWho)}'s list</button><button class="btn ghost small" id="fcEm">🆘 Emergency sheet</button><button class="btn ghost small" id="fcZip">⤓ ${esc(famWho)}'s documents (.zip)</button></div>`}`;
  $$('[data-fp]', $('fcBody')).forEach(b => b.addEventListener('click', () => { famWho = b.dataset.fp; famEdit = false; openFamily(); }));
  $$('[data-fi]', $('fcBody')).forEach(b => b.addEventListener('click', () => {
    const x = S[+b.dataset.fi]; Sheets.close('shFamily', true); showTab('docs');
    if (x.doc) { x.st === 'ok' ? showDoc(x.doc.id) : openDoc(x.doc.id); return; }
    const d = put({ id: uid('doc'), type: 'doc', title: x.item.split('/')[0].trim(), who: famWho, docType: famType(x.item), number: '', expiry: null, issuer: '', notes: '', folder: '', fy: null, deleted: false });
    openDoc(d.id); toast('Added — attach the photo or PDF, then Save.');
  }));
  const on = (id, f) => { if ($(id)) $(id).addEventListener('click', f); };
  on('fcEdit', () => { famEdit = true; openFamily(); });
  on('fcEm', () => { Sheets.close('shFamily', true); openEmergency(famWho); });
  on('fcZip', () => { Sheets.close('shFamily', true); exportPersonZip(famWho); });
  on('fcReset', () => { $('fcText').value = (FAM_DEFAULT[famWho] || []).join('\n'); });
  on('fcSave', () => {
    const L = [...new Set($('fcText').value.split('\n').map(x => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 60);
    const c = famCfg() || { id: FAM_ID, type: 'famcheck', lists: {} };
    put({ ...c, lists: { ...(c.lists || {}), [famWho]: L }, deleted: false }, { render: false }); famEdit = false; openFamily(); toast(`${famWho}'s list saved.`);
  });
  if (!Sheets.isOpen('shFamily')) Sheets.open('shFamily');
}

/* ==========================================================================
   v2.19 — Emergency sheet (encrypted with the private code): where the
   originals are kept, nominees, and a note. One per person.
   ======================================================================== */
const emId = p => 'em-' + (normName(p) || 'x').slice(0, 40);
let emWho = null;
function openEmergency(p) {
  if (window.GHOST) { ghostCrash(true); return; }
  if (!Fin.key) { needUnlock(() => openEmergency(p)); return; }
  emWho = p; const r = records[emId(p)], e = r && !r.deleted ? r : { places: [], nominees: [], notes: '' };
  const row = (sec, a, b, pa, pb) => `<div class="em-row" data-em="${sec}"><input value="${esc(a || '')}" placeholder="${pa}" aria-label="${pa}"><input value="${esc(b || '')}" placeholder="${pb}" aria-label="${pb}"><button type="button" class="em-rm" aria-label="Remove row">✕</button></div>`;
  const docs = all('doc').filter(d => docOwners(d).includes(p)).map(d => d.title), missing = docs.filter(t => !(e.places || []).some(x => x.what === t));
  $('emTitle').textContent = 'Emergency sheet · ' + p;
  $('emBody').innerHTML = `<p class="hint" style="margin:0 4px 10px">Encrypted with your private code — not readable in the Sheet. Fill what someone would need in an emergency.</p>
    <div class="group-title">Where the originals are kept</div><div id="emPlaces">${(e.places || []).map(x => row('places', x.what, x.where, 'Document', 'Kept where?')).join('')}</div>
    <div class="btn-row" style="margin:4px 0 0;flex-wrap:wrap"><button class="btn ghost small" type="button" id="emAddP">＋ Row</button>${missing.length ? `<button class="btn ghost small" type="button" id="emAllP">＋ All ${missing.length} of ${esc(p)}'s documents</button>` : ''}</div>
    <div class="group-title">Nominees</div><div id="emNoms">${(e.nominees || []).map(x => row('nominees', x.what, x.who, 'Account / policy', 'Nominee')).join('')}</div>
    <div class="btn-row" style="margin:4px 0 0"><button class="btn ghost small" type="button" id="emAddN">＋ Row</button></div>
    <div class="group-title">Notes</div><textarea id="emNotes" rows="5" placeholder="Locker number and branch, who to call, where the will is…">${esc(e.notes || '')}</textarea>
    <div class="btn-row"><button class="btn ghost" type="button" id="emPrint">🖨 Print / PDF</button></div>
    ${r && r.updatedAt ? `<p class="hint">Last saved ${timeAgo(r.updatedAt)}.</p>` : ''}`;
  const wire = () => $$('.em-rm', $('emBody')).forEach(b => { b.onclick = () => b.closest('.em-row').remove(); });
  const add = (box, sec, a, pa, pb) => { $(box).insertAdjacentHTML('beforeend', row(sec, a, '', pa, pb)); wire(); };
  $('emAddP').addEventListener('click', () => add('emPlaces', 'places', '', 'Document', 'Kept where?'));
  $('emAddN').addEventListener('click', () => add('emNoms', 'nominees', '', 'Account / policy', 'Nominee'));
  if ($('emAllP')) $('emAllP').addEventListener('click', () => { missing.forEach(t => add('emPlaces', 'places', t, 'Document', 'Kept where?')); $('emAllP').remove(); });
  $('emPrint').addEventListener('click', () => { const v = emRead(); printEmergency(p, v); });
  wire();
  if (!Sheets.isOpen('shEmerg')) Sheets.open('shEmerg');
}
function emRead() {
  const rows = sec => $$(`[data-em="${sec}"]`, $('emBody')).map(r => { const i = r.querySelectorAll('input'); return [i[0].value.trim().slice(0, 120), i[1].value.trim().slice(0, 200)]; }).filter(x => x[0] || x[1]);
  return { places: rows('places').map(([what, where]) => ({ what, where })), nominees: rows('nominees').map(([what, who]) => ({ what, who })), notes: $('emNotes').value.slice(0, 4000) };
}
$('emSave').addEventListener('click', () => {
  if (!Fin.key) { toast('The private section locked — open it again to save.'); return; }
  const v = emRead(), id = emId(emWho), r = records[id];
  put({ ...(r || { id, type: 'emerg' }), who: emWho, ...v, deleted: false });
  Sheets.close('shEmerg', true); toast('Emergency sheet saved (encrypted).');
});
function emText(p, v) {
  return `EMERGENCY SHEET — ${p}\nPrinted ${new Date().toLocaleString('en-IN')}\n\nWHERE THE ORIGINALS ARE KEPT\n${(v.places || []).map(x => `- ${x.what}: ${x.where}`).join('\n') || '-'}\n\nNOMINEES\n${(v.nominees || []).map(x => `- ${x.what}: ${x.who}`).join('\n') || '-'}\n\nNOTES\n${v.notes || '-'}\n`;
}
function printEmergency(p, v) {
  $('printArea').innerHTML = `<div style="font-family:Georgia,serif;padding:10px"><h1>Emergency sheet — ${esc(p)}</h1>
    <h2>Where the originals are kept</h2><table style="border-collapse:collapse;width:100%">${(v.places || []).map(x => `<tr><td style="border:1px solid #999;padding:6px">${esc(x.what)}</td><td style="border:1px solid #999;padding:6px">${esc(x.where)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table>
    <h2>Nominees</h2><table style="border-collapse:collapse;width:100%">${(v.nominees || []).map(x => `<tr><td style="border:1px solid #999;padding:6px">${esc(x.what)}</td><td style="border:1px solid #999;padding:6px">${esc(x.who)}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table>
    <h2>Notes</h2><p style="white-space:pre-wrap">${esc(v.notes || '—')}</p><hr><p style="color:#666;font-size:12px">Printed ${new Date().toLocaleString('en-IN')} from Register. Keep this paper safe.</p></div>`;
  setTimeout(() => window.print(), 100);
}

/* ==========================================================================
   v2.19 — a person's documents as one .zip (files + index.csv)
   Stored, not compressed: photos and PDFs are already compressed.
   ======================================================================== */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  if (files.length > 65000) throw new Error('too many files for one zip');
  const parts = [], cen = []; let off = 0;
  const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF, dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  for (const f of files) {
    const name = te.encode(f.name), data = f.data, crc = crc32(data);
    if (off + 30 + name.length + data.length > 0xFFFFFFFF) throw new Error('the zip would be larger than 4 GB');
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
    c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = cen.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true); e.setUint16(20, 0, true);
  return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
const zipSafe = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80) || 'untitled';
async function exportPersonZip(p) {
  if (window.GHOST) { ghostCrash(true); return; }
  const docs = all('doc').filter(d => docOwners(d).includes(p)).sort((a, b) => docGroup(a).localeCompare(docGroup(b)) || a.title.localeCompare(b.title));
  if (!docs.length) { toast(`No documents for ${p}.`); return; }
  const fs = docs.flatMap(d => docFilesOf(d.id).map(f => ({ f, d })));
  const lockedSkip = fs.filter(x => x.f.locked && !Fin.key).length;
  jobOpen(`${p}'s documents`);
  const files = [], names = new Set(), bad = [], root = zipSafe(p);
  const uniq = n => { let x = n, k = 2; const dot = n.lastIndexOf('.'), a = dot > 0 ? n.slice(0, dot) : n, b = dot > 0 ? n.slice(dot) : ''; while (names.has(x.toLowerCase())) x = `${a} (${k++})${b}`; names.add(x.toLowerCase()); return x; };
  let bytes = 0, i = 0;
  const todo = fs.filter(x => !(x.f.locked && !Fin.key));
  for (const { f, d } of todo) {
    if (Job.stop) { jobDone('Stopped. Nothing was saved.', true); return; }
    jobStep(i, todo.length, `File ${++i} of ${todo.length}: ${f.name}`);
    try {
      if (!driveOn() && !(await DB.imgGet(f.fileId).catch(() => null))) throw new Error('the Drive folder is not set up');
      const { blob } = await docFileBlob(f), data = new Uint8Array(await blob.arrayBuffer());
      bytes += data.length;
      if (bytes > 300 * 1048576) throw Object.assign(new Error('more than 300 MB — too big for the phone to zip at once'), { stopAll: true });
      files.push({ name: uniq(`${root}/${zipSafe(docGroup(d))}/${zipSafe(d.title)}/${zipSafe(f.fy ? 'FY ' + f.fy + ' - ' + f.name : f.name)}`), data });
    } catch (e) { if (e.stopAll) { jobDone('Stopped: ' + e.message + '. Use Share on fewer documents.', true); return; } bad.push(`${f.name}: ${e.code === 'LOCKED' ? 'locked' : e.message}`); }
  }
  const csvRows = [['Document', 'Belongs to', 'Type', 'Category', 'FY', 'Number', 'Expiry / due', 'Issuer', 'Notes', 'Files']].concat(docs.map(d => [d.title, docOwners(d).join(' & '), d.docType, docGroup(d), d.fy || '', d.number || (d.numEnc ? '•••• ' + (d.numTail || '') : ''), d.expiry || '', d.issuer || '', d.notes || '', docFilesOf(d.id).length]));
  files.push({ name: uniq(`${root}/index.csv`), data: te.encode('﻿' + csvRows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n') });
  if (Fin.key) { const r = records[emId(p)]; if (r && !r.deleted) files.push({ name: uniq(`${root}/Emergency sheet.txt`), data: te.encode(emText(p, r)) }); }
  let zip;
  try { zip = zipStore(files); } catch (e) { jobDone('Could not make the zip: ' + e.message, true); return; }
  const name = `${root} documents ${todayISO()}.zip`, file = new File([zip], name, { type: 'application/zip' });
  const nDoc = files.filter(x => !/\/(index\.csv|Emergency sheet\.txt)$/.test(x.name)).length;
  jobDone(`Ready: ${nDoc} file${nDoc === 1 ? '' : 's'} + index${files.some(x => /Emergency sheet/.test(x.name)) ? ' + emergency sheet' : ''}, ${fmtBytes(zip.size)}.${bad.length ? ` Not included: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '…' : ''}.` : ''}${lockedSkip ? ` ${lockedSkip} locked file${lockedSkip > 1 ? 's were' : ' was'} left out — open Money first to include them.` : ''}`, bad.length > 0);
  $('jbNote').innerHTML = `<div class="btn-row"><button class="btn brass" id="jbShare">Share or save the zip</button></div><p class="hint">The zip is not encrypted. Keep it somewhere safe.</p>`;
  $('jbShare').addEventListener('click', async () => {        // a fresh tap: iPhone only shares straight after one
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === 'AbortError') return; RLOG.warn('zip share', e.message); }
    dl(zip, name);
  });
}

/* ==========================================================================
   v2.19 — words inside PDFs become searchable (PDFs from the iPhone Files
   scanner already carry their text). Locked files are never indexed.
   ======================================================================== */
const SCAN_TXT_MAX = 20000;
async function pdfText(blob) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, ...pdfWorkerOpt() }).promise;
  let out = '';
  try {
    for (let n = 1; n <= Math.min(doc.numPages, 60) && out.length < SCAN_TXT_MAX; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      out += tc.items.map(x => x.str || '').join(' ') + '\n';
    }
  } finally { try { doc.destroy(); } catch (e) {} }
  return out.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, SCAN_TXT_MAX);
}
async function indexFile(f, blob) {
  if (!f || f.deleted || f.locked || !isPdf(f)) return false;
  let txt = '';
  try { txt = await pdfText(blob); } catch (e) { if (e && e.name === 'PasswordException') txt = ''; else throw e; }
  const r = records[f.id]; if (!r || r.deleted || r.locked) return false;
  if (txt) { r.txt = txt; delete r.txtNone; } else { r.txtNone = 1; delete r.txt; }
  put(r, { render: false }); return !!txt;
}
function indexSoon(id, bytes) { setTimeout(() => { const f = records[id]; if (f) indexFile(f, new Blob([bytes], { type: 'application/pdf' })).catch(e => RLOG.warn('pdf text', e.message)); }, 600); }
function scanIdxStats() {
  const L = all('docfile').filter(f => isPdf(f) && records[f.docId] && !records[f.docId].deleted);
  const open = L.filter(f => !f.locked);
  return { total: L.length, locked: L.length - open.length, done: open.filter(f => f.txt).length, none: open.filter(f => f.txtNone).length, todo: open.filter(f => !f.txt && !f.txtNone).length };
}
const scanIdxLabel = () => { const s = scanIdxStats(); return s.todo ? s.todo + ' to do' : s.total ? '✓' : '›'; };
async function indexAllScans() {
  const L = all('docfile').filter(f => isPdf(f) && !f.locked && !f.txt && !f.txtNone && records[f.docId] && !records[f.docId].deleted);
  if (!L.length) { toast(scanIdxStats().total ? 'All PDFs are already searchable.' : 'No PDFs in Docs yet.'); return; }
  jobOpen('Making PDFs searchable');
  let ok = 0, none = 0, i = 0; const bad = [];
  for (const f of L) {
    if (Job.stop) break;
    jobStep(i, L.length, `PDF ${++i} of ${L.length}: ${f.name}`);
    try { const { blob } = await docFileBlob(f); (await indexFile(f, blob)) ? ok++ : none++; }
    catch (e) { bad.push(f.name + ': ' + e.message); }
  }
  jobDone(`${Job.stop ? 'Stopped. ' : ''}${ok} PDF${ok === 1 ? '' : 's'} can now be searched by their words${none ? `; ${none} are photos without a text layer (scan them in the iPhone Files app to get searchable PDFs)` : ''}.${bad.length ? ' Could not read: ' + bad.slice(0, 4).join('; ') : ''}`, bad.length > 0);
}
function docTextSnippet(d, toks) {
  for (const f of docFilesOf(d.id)) { if (!f.txt) continue; const low = f.txt.toLowerCase(), t = toks.find(x => low.includes(x)); if (t) return { f, html: hl(f.txt.replace(/\s+/g, ' '), t) }; }
  return null;
}


(async function boot() {
  try {
    if (PAGE_VERSION !== APP_VERSION) { RLOG.warn('version mismatch', 'page ' + PAGE_VERSION + ' / app.js ' + APP_VERSION); setTimeout(() => toast('Part of the app is still updating.', 'Reload', () => location.reload(), 20000), 1500); }
    await loadPrefs();
    applyLook();
    if (prefs.decoyLaunch) showDecoy(); else hideDecoy();
    await loadAll();
    await purgeOldTrash();
    retireBills();
    Sync.lastOk = (await DB.get('lastSync')) || 0;
    if (Sync.lastOk && !(await DB.get('firstSync'))) await DB.set('firstSync', Sync.lastOk);   // installs from before v2.7
    window.__synced = !!(await DB.get('firstSync'));
    Sync.status(Sync.on() ? (Sync.lastOk ? 'ok' : '') : '', Sync.on() ? 'Last synced ' + timeAgo(Sync.lastOk) : 'Local only');
    showTab(prefs.startTab === 'last' ? prefs.lastTab : prefs.startTab || 'tasks');
    handleGo();
    window.__booted = true; if (!document.documentElement.classList.contains('decoy-on')) afterAppShown();
    // first run after upgrading on the same address: offer to bring the old data across
    // v1 kept the Sheet URL/token and Drive folder in localStorage — carry them over
    if (!prefs.cloudUrl) {
      try { const c = JSON.parse(localStorage.getItem('reg_cloud') || '{}'); if (c.url && c.token && scriptUrlOk(normaliseScriptUrl(c.url))) { setPref('cloudUrl', normaliseScriptUrl(c.url)); setPref('cloudToken', c.token); RLOG.info('adopted v1 sync settings'); } } catch (e) {}
    }
    if (!prefs.driveFolder && localStorage.getItem('reg_driveFolder')) setPref('driveFolder', localStorage.getItem('reg_driveFolder'));
    const needsMigrate = (localStorage.getItem('reg_recs') && localStorage.getItem('r2_legacyDone') !== '1' && localStorage.getItem('reg_devKey'))
                      || (Sync.on() && localStorage.getItem('r2_legacySheetDone') !== '1' && localStorage.getItem('reg_devKey'));
    if (Sync.on()) {
      Sync.run().then(async () => {
        if (!needsMigrate) return;
        const r = await autoMigrate(false);
        if (r.total) toast(`Brought in ${r.total} items from the old version.`, null, null, 5000);
      });
    } else if (localStorage.getItem('reg_recs') && localStorage.getItem('r2_legacyDone') !== '1') {
      if (localStorage.getItem('reg_devKey')) autoMigrate(false).then(r => { if (r.total) toast(`Brought in ${r.total} items from the old version.`, null, null, 5000); });
      else { legacyOffer = true; if (!document.documentElement.classList.contains('decoy-on')) offerLegacy(); }   // passphrase-era data: ask
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(p => { window.__persist = !!p; RLOG.info('persistent storage', p); }).catch(() => { window.__persist = false; });
    setInterval(() => { if (document.visibilityState === 'visible' && !Sheets.top()) $('todayLbl').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }, 60000);
  } catch (e) {
    RLOG.error('boot failed', e);
    hideDecoy();
    $('main').innerHTML = `<div class="empty"><b>Register could not start</b>${esc(e.message || e)}<br><br><button class="btn" id="bootLog">Download log</button></div>`;
    try { $('bootLog').addEventListener('click', () => shareOrDownload(RLOG.text(), 'register-log.txt')); } catch (e2) {}
  }
})();

/* service worker: offline + update notice */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready.', 'Reload', () => location.reload(), 15000); });
    });
  }).catch(e => RLOG.warn('sw register failed', e.message));
}

