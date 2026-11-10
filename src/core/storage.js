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
    imgDel: key => tx('imgs', 'readwrite', s => { s.delete(key); }),
    imgKeys: () => tx('imgs', 'readonly', s => req(s.getAllKeys()))
  };
})();

/* Small synchronous settings mirror (kv 'prefs'), so the UI never waits on IDB. */
const PREF_DEFAULTS = {
  theme: 'auto', text: 'default', contrast: false, left: false,
  startTab: 'tasks', stepsOpen: true, noteEdit: false,
  decoyLaunch: true, decoyReturn: 60, appIdle: 0, moneyIdle: 5,
  cloudUrl: '', cloudToken: '', driveFolder: '',
  lastTab: 'tasks', dateSeg: 'bills', moneySeg: 'ledger', noteSort: 'pinned', taskMode: 'prio'
};
let prefs = { ...PREF_DEFAULTS };
async function loadPrefs() {
  try { const p = await DB.get('prefs'); if (p) prefs = { ...PREF_DEFAULTS, ...p }; } catch (e) { RLOG.error('prefs load', e); }
  if (!prefs.v28prio) { prefs.v28prio = 1; prefs.taskMode = 'prio'; DB.set('prefs', prefs).catch(() => {}); }   // v2.28: tasks open sorted by priority, then date
  // the decoy must be decided before IDB answers, so its flags also live in localStorage
  try { localStorage.setItem('r2_decoy', prefs.decoyLaunch ? '1' : '0'); } catch (e) {}
}
function setPref(k, v) {
  prefs[k] = v;
  if (k === 'decoyLaunch') { try { localStorage.setItem('r2_decoy', v ? '1' : '0'); } catch (e) {} }
  DB.set('prefs', prefs).catch(e => RLOG.error('prefs save', e));
}

