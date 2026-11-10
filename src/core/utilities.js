/* ==========================================================================
   UTILITIES
   ======================================================================== */
const $ = id => document.getElementById(id);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowMs = () => Date.now();
/* v2.36: ONE CLOCK. "Newest wins" compares updatedAt stamps made by different devices, so a phone whose clock is wrong
   used to win (clock ahead) or lose (clock behind) unfairly. Every answer from the Apps Script carries Google's time;
   this device remembers how far its own clock is from it and stamps changes in Google's time. Differences under
   5 seconds are treated as none (they are network delay, not a wrong clock). Only stamps use this — reminders,
   dates and "x minutes ago" keep using the device's own clock. */
let clockOff = 0; try { clockOff = +localStorage.getItem('r2_clockOff') || 0; if (!isFinite(clockOff)) clockOff = 0; } catch (e) { clockOff = 0; }
const stampMs = () => Date.now() + clockOff;
function clockLearn(serverTime, t0, t1) {
  if (!(serverTime > 1e12) || !(t1 >= t0) || t1 - t0 > 8000) return;          // a slow answer says little about the clock
  const raw = Math.round(serverTime - (t0 + t1) / 2), off = Math.abs(raw) < 5000 ? 0 : raw;
  if (off === clockOff || (off !== 0 && clockOff !== 0 && Math.abs(off - clockOff) < 2000)) return;
  RLOG.info('clock: this device is', Math.round(off / 1000), 's', off >= 0 ? 'behind' : 'ahead of', 'the server (was', Math.round(clockOff / 1000), 's)');
  clockOff = off; try { localStorage.setItem('r2_clockOff', String(off)); } catch (e) {}
}
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
/* v2.20: messages queue up and show one after another — a second one no longer hides the first.
   An Undo toast for a newer action replaces an older Undo toast (only the latest action can be undone).
   opts.once = a key: the toast gets "Don't show again", and once tapped that toast never appears again. */
let toastTimer = null, toastFn = null, toastCur = null;
const toastQ = [];
const toastMuted = k => { try { return (JSON.parse(localStorage.getItem('r2_toastMute') || '[]')).includes(k); } catch (e) { return false; } };
function toastMute(k) { try { const L = JSON.parse(localStorage.getItem('r2_toastMute') || '[]'); if (!L.includes(k)) L.push(k); localStorage.setItem('r2_toastMute', JSON.stringify(L)); } catch (e) {} }
function toast(msg, actLabel, act, ms, opts) {
  if (window.GHOST) return;
  opts = opts || {};
  if (opts.once && toastMuted(opts.once)) return;
  const t = { msg, actLabel, act, ms, once: opts.once };
  if ((toastCur && toastCur.msg === msg) || toastQ.some(x => x.msg === msg)) return;   // already showing or waiting
  if (!toastCur) { toastShow(t); return; }
  if (t.once) { toastQ.push(t); return; }                                     // reminders wait their turn, one after another
  if (toastCur.once) toastQ.unshift(toastCur);                                // feedback on what you just did shows now; the reminder comes back after it
  toastShow(t);
}
function toastShow(t) {
  clearTimeout(toastTimer); toastCur = t;
  $('toastMsg').textContent = t.msg;
  const b = $('toastAct');
  if (t.actLabel) { b.textContent = t.actLabel; b.classList.remove('hidden'); toastFn = t.act; } else { b.classList.add('hidden'); toastFn = null; }
  const m = $('toastMute'); if (m) m.classList.toggle('hidden', !t.once);
  const c = $('toastClose'); if (c) c.classList.toggle('hidden', !t.once && !toastQ.length);
  $('toast').classList.add('show');
  toastTimer = setTimeout(toastNext, t.ms || (t.actLabel ? 6000 : 2800) + (t.once ? 3000 : 0));
}
function toastNext() {
  clearTimeout(toastTimer); toastCur = null; toastFn = null;
  $('toast').classList.remove('show');
  if (toastQ.length) setTimeout(() => { if (!toastCur && toastQ.length) toastShow(toastQ.shift()); }, 320);
}
$('toastAct').addEventListener('click', () => { const f = toastFn; toastNext(); if (f) f(); });
if ($('toastMute')) $('toastMute').addEventListener('click', () => { if (toastCur && toastCur.once) toastMute(toastCur.once); toastNext(); });
if ($('toastClose')) $('toastClose').addEventListener('click', toastNext);

/* ---------- downloads + share ---------- */
function dl(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
/* On iPhone the share sheet is the natural "Save to Files / send" path. Falls back to a download. */
let shareBusy = false;                         // v2.21: a second tap while the share sheet is opening is ignored
async function shareOrDownload(text, name, mime) {
  if (shareBusy) return; shareBusy = true;
  const blob = new Blob([text], { type: mime || 'text/plain' });
  try {
    const file = new File([blob], name, { type: mime || 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return false; RLOG.warn('share failed', e); }
  finally { shareBusy = false; }
  dl(blob, name);
  return true;
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
/* opt (v2.21): { short, shortLbl, farLbl } — a short swipe left does `short` (e.g. Snooze), a long one does `left` (Delete) */
function bindSwipe(wrap, right, left, opt) {
  const row = wrap.querySelector('.row'); if (!row) return;
  let x0 = 0, y0 = 0, dx = 0, dir = null, on = false;
  const FAR = 170, lblR = wrap.querySelector('.swipe-bg .r');
  if (opt && opt.short) wrap.classList.add('two');
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
    if (opt && opt.short && lblR) { const far = dx < -FAR; wrap.classList.toggle('far', far); lblR.textContent = far ? opt.farLbl : opt.shortLbl; }
  }, { passive: false });
  row.addEventListener('touchend', () => {
    if (!on) return; on = false;
    row.classList.add('anim');
    if (Math.abs(dx) > 8) { wrap._swiped = true; setTimeout(() => { wrap._swiped = false; }, 400); }
    if (dx > 90 && right) { row.style.transform = ''; setTimeout(right, 160); }
    else if (opt && opt.short && dx < -FAR && left) { row.style.transform = `translateX(-${row.offsetWidth}px)`; setTimeout(left, 200); }
    else if (opt && opt.short && dx < -70) { row.style.transform = ''; setTimeout(opt.short, 160); }
    else if (!(opt && opt.short) && dx < -90 && left) { row.style.transform = `translateX(-${row.offsetWidth}px)`; setTimeout(left, 200); }
    else row.style.transform = '';
    setTimeout(() => { wrap.classList.remove('go-r', 'go-l', 'far'); if (opt && opt.short && lblR) lblR.textContent = opt.shortLbl; }, 240);
  });
}
/* Tap handler that ignores the click which ends a swipe. v2.21: while selecting, a tap picks the item instead. */
function onTap(wrap, fn) { wrap.addEventListener('click', e => { if (wrap._swiped) return; if (Sel.kind && wrap.dataset.selk === Sel.kind) { selToggle(wrap.dataset.selid); return; } fn(e); }); }

