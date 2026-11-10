/* ==========================================================================
   v2.32 — A DEVICE THAT FELL BEHIND: catch up first
   • Opening something to edit when this device has not synced for 30 minutes
     (or a catch-up sync is running) first gets the latest from the Sheet.
   • A banner says so while it catches up, and stays (with Sync now) when this
     device has not synced for 6 hours — offline, or the network blocks Google.
   ======================================================================== */
const STALE_EDIT = 30 * 60000, STALE_WARN = 6 * 3600000;
const SyncGate = { catching: false };
{
  const run0 = Sync.run.bind(Sync);
  Sync.run = async function (manual) {
    let mine = false;
    if (!this.busy && this.on() && navigator.onLine && !window.GHOST && (!this.lastOk || Date.now() - this.lastOk > STALE_EDIT)) { SyncGate.catching = mine = true; syncBanner(); }
    try { return await run0(manual); } finally { if (mine) SyncGate.catching = false; syncBanner(); }
  };
  const st0 = Sync.status.bind(Sync);
  Sync.status = function (...a) { st0(...a); syncBanner(); };
}
function syncBanner() {
  const b = $('syncBanner'); if (!b) return;
  let html = '';
  if (Sync.on() && !window.GHOST) {
    const age = Sync.lastOk ? Date.now() - Sync.lastOk : Infinity, since = Sync.lastOk ? 'last synced ' + timeAgo(Sync.lastOk) : 'never synced';
    if (SyncGate.catching) html = '<span>⟳ Getting the latest from your other devices…</span>';
    else if (age > STALE_WARN && !Sync.busy) html = `<span>⚠︎ ${navigator.onLine ? 'This device' : 'Offline — this device'} ${esc(since)}. Your other devices may have newer changes; edits made here can clash with them.</span><button type="button" class="btn small" id="syncBannerGo">Sync now</button>`;
  }
  b.innerHTML = html; b.classList.toggle('hidden', !html); b.classList.toggle('warn', /⚠/.test(html));
  const g = $('syncBannerGo'); if (g) g.addEventListener('click', () => Sync.run(true));
}
function needsCatchUp(id) {
  if (window.GHOST || !Sync.on() || !navigator.onLine || !id) return false;
  if (records[id] && records[id]._dirty) return false;                      // already changed here: nothing to wait for
  return SyncGate.catching || !Sync.lastOk || Date.now() - Sync.lastOk > STALE_EDIT;
}
async function catchUp() {
  toast('Getting the latest from your other devices first…', null, null, 2500);
  if (!Sync.busy) Sync.run();
  const t0 = Date.now();
  while (Sync.busy && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 150));
}
['openTaskEditor', 'openNoteEditor', 'openDate', 'openFin', 'openDoc'].forEach(name => {
  const f = window[name]; if (typeof f !== 'function') return;
  window[name] = function (id, ...rest) {
    if (!needsCatchUp(id)) return f.call(this, id, ...rest);
    catchUp().then(() => { if (!records[id] || !records[id].deleted) f.call(this, id, ...rest); else toast('That item was deleted on another device.'); });
  };
});
['online', 'offline'].forEach(e => window.addEventListener(e, syncBanner));
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncBanner(); });
setInterval(syncBanner, 60000);
setTimeout(syncBanner, 3000);

/* v2.33: remove a leftover device line (an old browser, a reset install). Nothing else is touched;
   if that device syncs again, its line simply comes back. */
function forgetDevice(id) {
  const r = records[id]; if (!r || r.type !== 'device') return;
  const keep = { ...r };
  put({ ...r, deleted: true }, { render: false });
  toast(`“${r.name || 'Device'}” removed from the list. If it syncs again it comes back.`, 'Undo', () => { put({ ...keep, deleted: false }, { render: false }); if (Sheets.isOpen('shHealth')) openDataHealth(); }, 7000);
  if (Sheets.isOpen('shHealth')) openDataHealth();
}

