/* ==========================================================================
   v2.33 — COMPARE WITH THE SHEET: a full re-download, with a report of what
   differs and why. Private (Money) rows are only counted, never listed.
   ======================================================================== */
async function sheetCompare() {
  if (!Sync.on()) { toast('Sync is not set up.'); return; }
  if (!navigator.onLine) { toast('Offline — connect to the internet first.'); return; }
  planSheet('Compare with the Sheet', '<p class="hint">Uploading what is waiting, then downloading everything from the Sheet…</p>', () => true, 'Done');
  const W = s => { if ($('pshBody')) $('pshBody').innerHTML = s + '<div class="msg" id="pshMsg"></div>'; };
  try {
    await Sync.run(true);                                          // our own changes first, so nothing local is lost
    while (Sync.busy) await new Promise(r => setTimeout(r, 200));
    Sync.busy = true;
    let d;
    try { d = await Sync.call('pull', { since: 0 }); } finally { Sync.busy = false; }
    const rows = d.records || [], sheet = new Map(), why = [];
    let priv = 0, bad = 0;
    for (const row of rows) {
      let rec; try { rec = JSON.parse(row.payload); } catch (e) { bad++; continue; }
      if (!rec || !rec.id) { bad++; continue; }
      if (SEALED_TYPES.has(rec.type)) { priv++; continue; }
      if (rec._chunks || rec.purged || !RECORD_WORDS[rec.type]) continue;
      sheet.set(rec.id, { rec, sheetAt: +row.updatedAt || 0 });
    }
    // what this device thinks before the merge
    const pre = new Map(); sheet.forEach((x, id) => { const l = records[id]; pre.set(id, l ? { del: !!l.deleted, at: l.updatedAt || 0, dirty: !!l._dirty } : null); });
    const n = await mergeRemote(rows);
    await DB.set('cursor', d.serverTime || nowMs());
    scheduleRender();
    // after: anything live on the Sheet but not live here?
    const missing = [];
    sheet.forEach((x, id) => {
      if (x.rec.deleted) return;
      const l = records[id];
      if (l && !l.deleted) return;
      const p = pre.get(id);
      const reason = !l ? (cleanRec({ ...x.rec }) ? 'not saved on this device' : 'refused as malformed')
        : p && p.del && p.at >= (x.rec.updatedAt || 0) ? `deleted here ${p.at > (x.rec.updatedAt || 0) ? 'later than' : 'at the same time as'} the Sheet's copy${p.dirty ? ' (not uploaded yet)' : ''}`
        : 'deleted here';
      missing.push({ id, type: x.rec.type, title: String(x.rec.title || x.rec.label || x.rec.name || x.rec.text || '(untitled)').split('\n')[0].slice(0, 60), reason, rec: x.rec });
    });
    // here but not on the Sheet
    const notUp = Object.values(records).filter(r => RECORD_WORDS[r.type] && !r.deleted && !sheet.has(r.id) && !SEALED_TYPES.has(r.type));
    const byType = {}; sheet.forEach(x => { if (!x.rec.deleted) byType[x.rec.type] = (byType[x.rec.type] || 0) + 1; });
    const here = recordSplit();
    const word = t => RECORD_WORDS[t] || t;
    const lines = [
      `Register v${APP_VERSION} · ${new Date().toLocaleString('en-IN')}`,
      `Sheet rows: ${rows.length} (private, not listed: ${priv}${bad ? ', unreadable: ' + bad : ''}) · updated now: ${n}`,
      `Live on the Sheet: ${Object.entries(byType).map(([t, k]) => k + ' ' + word(t)).join(', ')}`,
      `Live on this device: ${here.live} (${Object.entries(here.byType).map(([t, k]) => k + ' ' + word(t)).join(', ')})`,
      `On the Sheet but not shown here: ${missing.length}`, ...missing.map(m => `  • ${word(m.type).replace(/s$/, '')}: ${m.title} — ${m.reason}`),
      `Here but not on the Sheet: ${notUp.length}`, ...notUp.slice(0, 30).map(r => `  • ${word(r.type).replace(/s$/, '')}: ${String(r.title || r.label || r.name || '(untitled)').slice(0, 60)}${r._dirty ? ' — waiting to upload' : r._tooBig ? ' — too big for the Sheet' : ''}`)
    ];
    const report = lines.join('\n');
    RLOG.info('sheet compare', missing.length, 'missing,', notUp.length, 'not uploaded');
    W(`<p class="hint" style="margin:0 4px 10px">${missing.length || notUp.length ? 'Differences found — details below.' : '✓ This device and the Sheet match.'}</p>
      <pre class="cmp-rep">${esc(report)}</pre>
      <div class="btn-row">${missing.some(m => /deleted here/.test(m.reason)) ? '<button class="btn brass small" type="button" id="cmpBring">Bring back the Sheet’s copies</button>' : ''}<button class="btn ghost small" type="button" id="cmpCopy">Copy report</button></div>`);
    $('cmpCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(report); toast('Report copied — paste it to Claude.'); } catch (e) { toast('Could not copy — take a screenshot instead.'); } });
    if ($('cmpBring')) $('cmpBring').addEventListener('click', () => {
      let k = 0;
      missing.filter(m => /deleted here/.test(m.reason)).forEach(m => { const r = { ...m.rec }; delete r._dirty; delete r._base; put(r); k++; });   // a fresh time, so every device takes it
      toast(`${k} item${k > 1 ? 's' : ''} brought back.`); Sheets.close('shPlan', true); scheduleRender();
    });
  } catch (e) {
    RLOG.error('sheet compare', e);
    W(`<p class="msg err">Could not compare: ${esc(e.message || String(e))}</p>`);
  }
}

