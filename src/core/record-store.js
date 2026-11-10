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
const SEALED_TYPES = new Set(['fin', 'budget', 'filekey', 'snote', 'plancfg', 'planmonth', 'invest', 'loan', 'goal', 'acct', 'recur', 'subscfg', 'emerg', 'dropkey', 'vault']);   // v2.23: + Card & account details   // v2.20: + the quick-log opening key   // v2.19: + subscriptions settings, Emergency sheet
const FINKEY_ID = '__finkey__';
let records = {};          // id -> plaintext record (money records only while unlocked)
let sealed = {};           // id -> sealed form of money records (always present)
const persistQ = {};       // id -> promise chain, keeps writes for one id in order

/* ---------- private-section encryption (AES-GCM, key from the access code) ---------- */
const te = new TextEncoder(), td = new TextDecoder();
const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const t = atob(s), a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a; };   // v2.24: a plain loop — fast enough for 50 MB
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
function stripLocal(r) { const o = { ...r }; delete o._dirty; delete o._base; return o; }
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
const finUnlocked = () => !!Fin.key && Fin.scope !== 'docs';   // v2.27: a documents-only unlock never counts as Money being open

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
  reseal.forEach(r => { r.updatedAt = Math.max(r.updatedAt, stampMs()); put(r, { render: false, keepTime: true }); });
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
  Fin.key = null; Fin.salt = null; Fin.kid = null; Fin.iters = FIN_ITERS; Fin.lockedOut = []; Fin.tampered = []; Fin.tamperedRows = null; keyCache.clear(); Fin.scope = null; Fin.wantScope = null; clearTimeout(DocUnlock.t);
  try { const pa = document.getElementById('printArea'); if (pa) pa.innerHTML = ''; } catch (e) {}
  for (const id in records) if (SEALED_TYPES.has(records[id].type)) delete records[id];
  storeVer++;
  document.documentElement.classList.remove('fin-open');          // v2.20: hides every .priv-only mention
  if (typeof onFinanceLocked === 'function') onFinanceLocked(silent);
}

/* ---------- v2.18: nothing that arrives from the Sheet, a backup or an old install is trusted ----------
   A record's id and type end up inside HTML attributes, and a few short fields (category, priority, repeat,
   year …) are printed in lists. Anything outside the shapes the app itself creates is dropped or reset. */
const REC_ID_RX = /^[A-Za-z0-9_.:@\-]{1,120}$/, REC_TYPE_RX = /^[a-z][a-z0-9_]{0,30}$/;
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/, FY_RX = /^\d{4}-\d{2}$/, HM_RX = /^\d{2}:\d{2}$/;
const TASK_STATUS = ['active', 'inprogress', 'waiting', 'done'], TASK_REPEAT = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'], DATE_REPEAT = ['once', 'yearly', 'monthly', 'm2', 'm3', 'm6'];
/* v2.23: every 2, 3 and 6 months */
const REP_MONTHS = { monthly: 1, m2: 2, m3: 3, m6: 6, yearly: 12 };
const REP_OPTS = [['once', 'Once'], ['yearly', 'Every year'], ['monthly', 'Every month'], ['m2', 'Every 2 months'], ['m3', 'Every 3 months (quarterly)'], ['m6', 'Every 6 months']];
const repWord = r => ({ yearly: 'yearly', monthly: 'monthly', m2: 'every 2 months', m3: 'quarterly', m6: 'every 6 months' })[r] || '';
/* Returns the record (fixed in place) or null when it must not be kept. */
function cleanRec(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.id !== 'string' || !REC_ID_RX.test(r.id) || typeof r.type !== 'string' || !REC_TYPE_RX.test(r.type)) return null;
  const pick = (v, list, dflt) => list.includes(v) ? v : dflt, dateOr = (v, dflt) => typeof v === 'string' && ISO_DATE_RX.test(v) ? v : dflt;
  if (r.type === 'task' || r.type === 'template') {
    r.category = fixCat(r.category); r.priority = pick(r.priority, PRIOS, 'Medium');
    if (Array.isArray(r.subs)) r.subs.forEach(s => { if (s && typeof s === 'object') { s.priority = pick(s.priority, PRIOS, 'Medium'); if (s.dueDate != null) s.dueDate = dateOr(s.dueDate, null); } });
    if (r.type === 'task') {
      r.status = pick(r.status, TASK_STATUS, 'active'); r.repeat = /^e([1-9]\d?)([dwm])$/.test(String(r.repeat)) ? r.repeat : pick(r.repeat, TASK_REPEAT, 'none');   // v2.24: + weekdays, yearly, every N days / weeks / months (e3d, e2w, e6m)
      if (r.dueDate != null) r.dueDate = dateOr(r.dueDate, null);
      if (r.dueTime != null && !(typeof r.dueTime === 'string' && HM_RX.test(r.dueTime))) delete r.dueTime;
      if (r.waitingOn != null && typeof r.waitingOn !== 'string') delete r.waitingOn;
    }
  } else if (r.type === 'date') {
    r.repeat = pick(r.repeat, DATE_REPEAT, 'once'); if (r.when != null && r.when !== '') r.when = dateOr(r.when, '');
    if (r.lead != null && !(+r.lead > 0 && +r.lead <= 366)) delete r.lead;
  } else if (r.type === 'doc' || r.type === 'docfile') {
    if (r.fy != null && !(typeof r.fy === 'string' && FY_RX.test(r.fy))) r.fy = null;
    if (r.type === 'doc') { if (r.expiry != null && r.expiry !== '') r.expiry = dateOr(r.expiry, null); if (typeof r.docType !== 'string') r.docType = 'Other'; }
    if (r.history != null) r.history = Array.isArray(r.history) ? r.history.filter(h => h && typeof h === 'object' && ISO_DATE_RX.test(h.expiry || '')).map(h => ({ expiry: h.expiry, number: typeof h.number === 'string' ? h.number : '', renewedOn: dateOr(h.renewedOn, '') })).slice(-10) : undefined;
    if (r.prevUntil != null) r.prevUntil = dateOr(r.prevUntil, undefined);
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
const trashed = () => window.GHOST ? [] : Object.values(records).filter(r => r.deleted && r.deletedAt && r.type !== 'chunk' && r.type !== 'blob' && r.type !== 'billpay' && r.type !== 'finkey' && r.type !== 'cardkey' && r.type !== 'docfile' && r.type !== 'filekey' && r.type !== 'planmonth' && r.type !== 'plancfg' && r.type !== 'erasekey' && r.type !== 'erased' && r.type !== 'qlog' && r.type !== 'dropkey');

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
  { const prev = records[rec.id]; if (prev && !prev._dirty && prev.updatedAt) rec._base = prev.updatedAt; else if (prev && prev._base) rec._base = prev._base; }   // v2.24: the Sheet's version this edit started from
  if (opt.bump) rec.updatedAt = (rec.updatedAt || 0) + 1;                       // re-seal: keeps its place in time
  else if (!opt.keepTime) rec.updatedAt = Math.max(stampMs(), (rec.updatedAt || 0) + 1);   // v2.36: Google's time, not this device's; still never goes backwards
  storeVer++;
  rec._dirty = 1;
  if (rec.deleted === undefined) rec.deleted = false;
  if (!rec.createdAt) rec.createdAt = nowMs();
  if (SEALED_TYPES.has(rec.type) && !Fin.key) { RLOG.error('put sealed while locked', rec.id); toast('Unlock first.'); return rec; }
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

