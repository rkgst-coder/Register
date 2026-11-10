/* ==========================================================================
   v2.21 — press and hold to select (tasks, notes, dates, Ledger); actions in a bar above the tabs
   ======================================================================== */
const Sel = { kind: null, ids: new Set() };
const SEL_ACTS = {};          // kind → () => [{ l, fn(ids), danger }]
const SEL_RAW = new Set(['dgrp', 'dwho', 'dcat', 'nfold']);   // v2.23: categories / folders — their ids are names, not records
/* a folder button: press and hold selects it; while selecting, a tap adds it instead of opening it */
function folderSkip(b) { if (b._swiped) return true; if (Sel.kind && b.dataset.selk === Sel.kind) { selToggle(b.dataset.selid); return true; } return false; }
function bindHold(el, kind, id) {
  el.dataset.selk = kind; el.dataset.selid = id;
  let t = null, x0 = 0, y0 = 0;
  const go = () => { t = null; el._swiped = true; setTimeout(() => { el._swiped = false; }, 500); if (Sel.kind && Sel.kind !== kind) selEnd(); if (!Sel.kind) { Sel.kind = kind; Sel.ids = new Set(); } selToggle(id); try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} };
  el.addEventListener('touchstart', e => { const p = e.touches[0]; x0 = p.clientX; y0 = p.clientY; clearTimeout(t); t = setTimeout(go, 480); }, { passive: true });
  el.addEventListener('touchmove', e => { const p = e.touches[0]; if (t && (Math.abs(p.clientX - x0) > 8 || Math.abs(p.clientY - y0) > 8)) { clearTimeout(t); t = null; } }, { passive: true });
  ['touchend', 'touchcancel'].forEach(ev => el.addEventListener(ev, () => { clearTimeout(t); t = null; }, { passive: true }));
  el.addEventListener('contextmenu', e => { e.preventDefault(); go(); });
}
function selToggle(id) {
  if (!Sel.kind) return;
  Sel.ids.has(id) ? Sel.ids.delete(id) : Sel.ids.add(id);
  if (!Sel.ids.size) { selEnd(); return; }
  selPaint();
}
function selPaint() {
  $$('[data-selk]').forEach(el => el.classList.toggle('sel-on', !!Sel.kind && el.dataset.selk === Sel.kind && Sel.ids.has(el.dataset.selid)));
  document.documentElement.classList.toggle('selecting', !!Sel.kind);
  const bar = $('selBar'); if (!bar) return;
  bar.classList.toggle('hidden', !Sel.kind);
  if (!Sel.kind) return;
  $('selN').textContent = `${Sel.ids.size} selected`;
  const acts = (SEL_ACTS[Sel.kind] || (() => []))();
  $('selActs').innerHTML = acts.map((a, i) => `<button type="button" data-sela="${i}" class="${a.danger ? 'danger' : ''}">${a.l}</button>`).join('');
  $$('[data-sela]', bar).forEach(b => b.addEventListener('click', () => { const a = acts[+b.dataset.sela], ids = [...Sel.ids].filter(id => SEL_RAW.has(Sel.kind) || records[id]); a.fn(ids); }));
}
function selEnd() { Sel.kind = null; Sel.ids = new Set(); selPaint(); }
function selAll(kind, ids) { Sel.kind = kind; Sel.ids = new Set(ids); selPaint(); }
/* delete many at once, with one Undo */
function deleteManyWithUndo(ids, what) {
  ids.forEach(id => softDelete(id, { render: false })); selEnd(); scheduleRender();
  toast(`Deleted ${ids.length} ${what}${ids.length === 1 ? '' : 's'}.`, 'Undo', () => { ids.forEach(id => restore(id)); scheduleRender(); }, 7000);
}

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

