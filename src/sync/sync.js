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
    const t = setTimeout(() => ctl.abort(), timeoutMs || 45000), t0 = Date.now();
    try {
      const res = await fetch(prefs.cloudUrl, {
        method: 'POST', signal: ctl.signal, redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },     // no CORS preflight
        body: JSON.stringify({ action, token: prefs.cloudToken, ...(payload || {}) })
      });
      const txt = await res.text();
      let d; try { d = JSON.parse(txt); } catch (e) {
        // v2.21: say what Google actually sent (status + page title), so the log shows the real cause. No body or token is logged.
        const ttl = (String(txt).match(/<title>([^<]{0,80})/i) || [])[1] || '', st = res.status || 0;
        const err = new Error(`Not JSON from script (HTTP ${st}${ttl ? ' · ' + ttl.trim() : ''})`);
        err.transient = st === 0 || st >= 500 || st === 429 || /error|busy|try again|too many|unavailable/i.test(ttl) || st === 200;
        throw err;
      }
      if (d && d.serverTime && !payload) clockLearn(+d.serverTime, t0, Date.now());   // v2.36: only light calls (ping) — a big pull or push takes too long to time
      else if (d && d.serverTime && Date.now() - t0 < 4000) clockLearn(+d.serverTime, t0, Date.now());
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
    if (!navigator.onLine) { this.status('err', 'Offline — changes are saved on this device'); if (manual) toast('Offline. Everything is saved here and will sync later.'); return false; }
    if (this.busy) { this.again = true; return false; }
    this.busy = true; this.status('busy', 'Syncing…');
    try {
      this.fresh = !(await DB.get('firstSync'));
      if (this.fresh) await this.pull();                   // first sync of this device: take the Sheet's copies first
      await this.push();
      const got = await this.pull();
      await this.push();                                   // anything re-sealed during the pull
      this.lastOk = nowMs(); DB.set('lastSync', this.lastOk); window.__synced = true; this.retried = false;
      if (!(await DB.get('firstSync'))) await DB.set('firstSync', this.lastOk);   // first time this device synced with this Sheet
      this.status('ok', 'Synced ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      if (manual) toast(got ? `Synced — ${got} update${got === 1 ? '' : 's'} received.` : 'Synced — all up to date.');
      conflictsSave().catch(e => RLOG.warn('conflicts', e.message)); deviceSeen();
      if (got) purgeOldTrash().catch(() => {});            // v2.23: "Empty" done on another device clears it here too
      return true;
    } catch (e) {
      // v2.21: a dropped connection or a busy Google server is tried once more, quietly, before it counts as an error
      const msg = String(e && e.message || e || ''), net = e && e.transient || /load failed|fetch is aborted|aborted|failed to fetch|networkerror|network error/i.test(msg);
      if (net && !manual && !this.retried) { this.retried = true; RLOG.warn('sync hiccup, trying again:', msg); this.status('busy', 'Syncing…'); setTimeout(() => this.run(), 6000); return false; }
      RLOG.error('sync failed:', msg);
      this.status('err', 'Sync error — saved on this device. ' + (e.message || ''));
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
    const baseAt = records[id] && records[id]._base || undefined;            // v2.24: lets the script tell us when another device changed it meanwhile
    if (s) return { id, type: s.type, updatedAt: s.updatedAt, deleted: !!s.deleted, summary: '', baseAt, payload: JSON.stringify(noBig(s)) };
    const r = records[id];
    const summary = r.type === 'blob' ? (r.name || 'image') : (r.title || r.label || '');
    return { id, type: r.type, updatedAt: r.updatedAt, deleted: !!r.deleted, summary, baseAt, payload: JSON.stringify(noBig(r)) };
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
      (d.overwrote || []).forEach(o => { try { const x = JSON.parse(o.payload); if (x && !x._chunks && CONFLICT_TYPES.has(x.type)) conflictStash(o.id, x, 'other'); } catch (e) {} });   // v2.24: ours replaced another device's newer change
      const clean = [];
      batch.forEach(row => {
        if (row.chunkOf) { if (rejected.has(row.id) || stale.has(row.id)) badChunk.add(row.chunkOf); return; }
        const cur = sealed[row.id] || records[row.id];
        if (!cur || cur.updatedAt !== row.updatedAt) {           // edited again meanwhile — stays dirty
          // v2.27.1: but the Sheet now holds THIS device's copy, so the next push starts from it (not a "changed on two devices")
          if (cur && !stale.has(row.id) && !rejected.has(row.id) && !row.stubN) { const r = records[row.id]; if (r && r._dirty) { r._base = row.updatedAt; persist(r); } }
          return; }
        if (stale.has(row.id) && CONFLICT_TYPES.has(cur.type)) conflictStash(row.id, records[row.id] ? stripLocal(records[row.id]) : stripLocal(cur), 'mine');   // v2.24: the Sheet kept the other device's — keep ours to choose
        if (stale.has(row.id) && (cur.type === 'note' || cur.type === 'snote')) {   // v2.19 (B6): the Sheet has a newer copy from another device — keep ours to compare
          const plain = records[row.id]; if (plain && (plain.type === 'note' || plain.type === 'snote')) (this.conflicts = this.conflicts || {})[row.id] = { id: plain.id, type: plain.type, title: plain.title, text: plain.text, folder: plain.folder, color: plain.color, docRefs: plain.docRefs, imgs: plain.imgs };
        }
        if (row.stubN && badChunk.has(row.id)) { cur._tooBig = true; if (records[row.id]) records[row.id]._tooBig = true; return; }   // a part did not arrive: the stub is not trusted, stays dirty
        cur._dirty = 0;
        if (records[row.id]) records[row.id]._dirty = 0;
        if (!rejected.has(row.id)) delete cur._tooBig;
        if (row.stubN) { cur._chunked = row.stubN; if (records[row.id]) records[row.id]._chunked = row.stubN; } else { delete cur._chunked; if (records[row.id]) delete records[row.id]._chunked; }
        if (rejected.has(row.id)) { cur._tooBig = true; if (!this.warnedBig) { this.warnedBig = true; toast(`"${(cur.title || cur.label || 'An item').slice(0, 30)}" is too large to sync (Sheet cell limit). It stays on this device.`); } }
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

