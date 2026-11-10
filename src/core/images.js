/* ==========================================================================
   IMAGES
   With a Drive folder set: full-size file in your Drive, bytes proxied back
   through the script and cached on this device (IndexedDB) so each picture is
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
  if (url && typeof url !== 'string') { try { url = url instanceof Blob ? await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(url); }) : null; } catch (e) { url = null; } }   // v2.24: a document file kept as a Blob
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


