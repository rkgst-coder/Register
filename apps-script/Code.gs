/**
 * REGISTER — data API (v27, "Register 2")
 * ---------------------------------------------------------------------------
 * What changed from v26 (app v2.35)
 *   • Share into Register takes Word, Excel, CSV and text files as well as
 *     photos and PDFs. The Shortcut sends the file's extension as "ext"
 *     (or a name that ends in it); the file keeps its real type. Anything
 *     else is still treated as a photo, exactly as before.
 *   • Nothing else changed. No new permission: paste, save, and deploy a
 *     new version (Deploy → Manage deployments → Edit → New version).
 *
 * What changed from v25 (app v2.24)
 *   • Files up to 50 MB: the app sends and fetches a file in 4 MB pieces
 *     (driveUpStart / driveUpPart / driveGetPart). Uploads use Drive's own
 *     resumable upload, so this version asks for one more permission
 *     ("Connect to an external service") — run setup once and allow it.
 *     Single-message upload / download (older app versions) still work.
 *   • Push reports when your change replaced a change made on another device
 *     in the meantime ("overwrote"), so the app can let you choose.
 *   • NO IDs, KEYS OR TOKEN IN THE CODE. All three live in Script Properties
 *     (Project Settings → Script Properties): SECRET, DRIVE_FOLDER_ID and
 *     (optional) IMPORT_FOLDER_ID. A new version is a plain copy-paste.
 *     The three lines below stay blank; if you do fill one, Script Properties
 *     still win.
 *   • setup now lists which of the three are set (never their values).
 *
 * What changed from v24 (app v2.19)
 *   • The 7 AM email is gone. The daily trigger stays: it only empties rows
 *     deleted more than 45 days ago (keeps the Sheet small).
 *   • SECRET can live in Script Properties (Project Settings → Script
 *     properties → SECRET), so the token is not inside the code. If it is set
 *     there, the SECRET line below is ignored — you can blank it.
 *   • Emergency erase of the whole Register folder needs a proof made from your
 *     emergency erase code (set from the app), not only the token. Stored as a
 *     hash in Script Properties (ERASE_PROOF).
 *   • Uploads larger than about 22 MB are refused with a clear message.
 *
 * What changed from v23
 *   • driveEmptyFolder: emergency erase moves every file in the Register folder
 *     (backups made by other devices too) to Drive's Trash.
 *   • Daily email: expiry dates of deleted documents are no longer listed.
 *
 * What changed from v22
 *   • Share into Register takes PDFs too: send mime "application/pdf" (and an
 *     optional file name); the file keeps its name and type.
 *
 * What changed from v21 (security and reliability audit)
 *   • SECRET must be set: the placeholder or an empty token is refused.
 *     Run makeToken once for a long random token if yours is short.
 *   • DRIVE_FOLDER_ID must be set: with it empty, no Drive file can be read,
 *     written or deleted (before, every file in your Drive could be).
 *   • Writes are flushed before the lock is released, so two devices syncing at
 *     the same moment can no longer overwrite or miss each other's rows.
 *   • Rows deleted more than 45 days ago are shrunk to a small marker instead of
 *     being removed, so a phone that was offline for months cannot bring deleted
 *     items back.
 *   • Pull reads only the rows that changed (faster with a big Sheet).
 *   • Titles starting with "=" are stored as text, not formulas.
 *   • Daily email: monthly/yearly dates on the 29th–31st are right; a document
 *     due date is listed once, with the right word (renewal / deadline / last date).
 *   • Share into Register: a failed save no longer leaves a stray photo in Drive.
 *   • Import: a file already moved on an earlier try counts as done.
 *
 * What changed from v20
 *   • inboxAdd: "Share into Register" — an iPhone Shortcut sends a photo and/or a
 *     line; the photo is saved in the Register folder and an Inbox item appears
 *     in the app on the next sync. Same token as the app.
 *
 * What changed from v19
 *   • driveCheck: Register asks once a month whether each of its files still
 *     exists (ok / in Trash / deleted / moved out of the Register folder).
 *     Only states come back, never file contents.
 *   • driveRestore: takes a Register file back out of Drive's Trash.
 *
 * What changed from v18
 *   • Import MOVES a file from your Docs folder into the Register folder (same
 *     file, no second copy). Old Register versions still get a copy.
 *   • driveTidyImport: sends the Docs-folder originals of files Register already
 *     copied (v18 imports) to Drive's Trash — only files inside the Docs folder
 *     or one of its sub-folders, never anything in the Register folder.
 *
 * What changed from v17
 *   • IMPORT_FOLDER_ID: optional. Your existing Drive "Docs" folder. Register can
 *     list it and COPY files from it into the Register folder (bulk import in
 *     Register → Settings → Data). Nothing in that folder is changed or deleted,
 *     and no other folder can be listed or copied from.
 *
 * What changed from v16 (in v17)
 *   • DRIVE_FOLDER_ID: the script only reads, writes and deletes files inside
 *     your Register folder. Before, anyone holding the /exec URL and token
 *     could read ANY file in your Drive by its ID.
 *   • makeToken(): prints a long random token you can use for SECRET.
 *   • Everything else is the same as v16.
 *
 * Columns in Records2:  id | type | updatedAt | deleted | serverAt | summary | payload
 *
 * SETUP (once)
 *   0. Project Settings (⚙) → Script Properties → add:
 *        SECRET            your token (the same as Register → Settings → Token)
 *        DRIVE_FOLDER_ID   the Register Drive folder link or ID
 *        IMPORT_FOLDER_ID  optional — your old Docs folder, for bulk import
 *   1. Paste this over Code.gs and Save. Nothing to fill in.
 *   2. Project Settings → Time zone → (GMT+05:30) India Standard Time.
 *   3. Run  setup  from the function dropdown and accept the permission prompt
 *      (Sheets, Drive, Triggers). It also installs the daily 7 AM clean-up (no email).
 *   4. Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy.
 *      Editing the existing deployment keeps the SAME /exec URL.
 */

/* ---------- logging first: every invocation can write to the "Log" tab ---------- */
const LOG_SHEET = 'Log';
const LOG_MAX_ROWS = 500;
function log_(level, msg) {
  try {
    console.log('[' + level + '] ' + msg);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(LOG_SHEET);
    if (!sh) { sh = ss.insertSheet(LOG_SHEET); sh.appendRow(['time', 'level', 'message']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), level, String(msg).slice(0, 2000)]);
    const extra = sh.getLastRow() - 1 - LOG_MAX_ROWS;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) { console.error('log failed: ' + e); }
}

/* ---------- config: the ONLY two lines you need to fill in ---------- */
// v26: leave these three BLANK — put the values in Project Settings → Script Properties instead (they win over these lines).
const SECRET = '';             // Script Property: SECRET
const DRIVE_FOLDER_ID = '';    // Script Property: DRIVE_FOLDER_ID
const IMPORT_FOLDER_ID = '';   // Script Property: IMPORT_FOLDER_ID (optional)
function prop_(k) { try { return String(PropertiesService.getScriptProperties().getProperty(k) || '').trim(); } catch (e) { return ''; } }

/* v25: the token from Script Properties wins over the line above */
function secret_() {
  let p = '';
  try { p = PropertiesService.getScriptProperties().getProperty('SECRET') || ''; } catch (e) {}
  return String(p || SECRET || '');
}
/* v26: the folder can live in Script Properties too (wins over the line above) */
function driveFolder_() { return folderIdFrom_(prop_('DRIVE_FOLDER_ID') || DRIVE_FOLDER_ID); }
function importFolderId_() { return folderIdFrom_(prop_('IMPORT_FOLDER_ID') || IMPORT_FOLDER_ID); }
function sha_(str) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8)); }
const MAX_UPLOAD_B64 = 30000000;     // about 22 MB of file in ONE message (older app versions)
const MAX_FILE = 52 * 1024 * 1024;   // v26: files sent in pieces — about 50 MB
const PART = 4 * 1024 * 1024;        // v26: piece size (a multiple of 256 KB, as Drive requires)

const SHEET_NAME = 'Records2';
const HEAD = ['id', 'type', 'updatedAt', 'deleted', 'serverAt', 'summary', 'payload'];
const C = { id: 1, type: 2, updatedAt: 3, deleted: 4, serverAt: 5, summary: 6, payload: 7 };
const MAX_CELL = 49000;              // Sheets hard limit is 50,000 characters per cell
const PURGE_AFTER_DAYS = 45;         // app empties its trash after 30 days
const TZ = 'Asia/Kolkata';
const PURGED = '(deleted)';          // v22: summary of a row whose content was removed

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    sh.getRange('G:G').setWrap(false);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }   // v22: writes land before the next caller reads
  }
}

/* ==========================================================================
   SYNC
   ======================================================================== */

/** Rows changed on the server after `since` (server clock, ms). */
function pull_(body) {
  return withLock_(function () {
    const sh = getSheet_();
    const last = sh.getLastRow();
    const now = Date.now();
    if (last < 2) return { ok: true, records: [], serverTime: now };
    const since = Number(body.since || 0);
    const out = [];
    const take = function (r) {
      if (!r[0] || (Number(r[C.serverAt - 1]) || 0) <= since) return;
      out.push({
        id: String(r[0]), type: String(r[1]),
        updatedAt: Number(r[C.updatedAt - 1]) || 0,
        deleted: r[C.deleted - 1] === true || r[C.deleted - 1] === 'TRUE',
        payload: String(r[C.payload - 1] || '')
      });
    };
    // v22: read the serverAt column first, then only the runs of rows that changed
    const sa = sh.getRange(2, C.serverAt, last - 1, 1).getValues(), runs = [];
    for (let i = 0; i < sa.length; ) {
      if ((Number(sa[i][0]) || 0) <= since) { i++; continue; }
      let j = i; while (j + 1 < sa.length && (Number(sa[j + 1][0]) || 0) > since) j++;
      runs.push([i, j]); i = j + 1;
    }
    if (runs.length > 40) sh.getRange(2, 1, last - 1, HEAD.length).getValues().forEach(take);   // scattered: one big read is quicker
    else runs.forEach(function (x) { sh.getRange(x[0] + 2, 1, x[1] - x[0] + 1, HEAD.length).getValues().forEach(take); });
    return { ok: true, records: out, serverTime: now };
  });
}

/** Upsert, newest updatedAt wins. Reports anything it refused. */
function push_(body) {
  const rows = body.records || [];
  if (!rows.length) return { ok: true, written: 0, stale: [], rejected: [], serverTime: Date.now() };

  return withLock_(function () {
    const sh = getSheet_();
    const last = sh.getLastRow();
    const index = {};                                   // id -> { row, updatedAt }
    if (last >= 2) {
      const meta = sh.getRange(2, 1, last - 1, C.updatedAt).getValues();
      for (let i = 0; i < meta.length; i++) {
        if (meta[i][0]) index[String(meta[i][0])] = { row: i + 2, updatedAt: Number(meta[i][2]) || 0 };
      }
    }
    const now = Date.now();
    const appends = [], stale = [], rejected = [], overwrote = [];
    const seen = {};
    let written = 0;

    rows.forEach(function (r) {
      if (!r || !r.id) return;
      const payload = String(r.payload || '');
      if (payload.length > MAX_CELL) { rejected.push(r.id); return; }
      const sm = String(r.summary || '').slice(0, 200);
      const vals = [r.id, r.type || '', Number(r.updatedAt) || 0, !!r.deleted, now,
                    /^[=+\-@]/.test(sm) ? "'" + sm : sm, payload];   // v22: a title starting with "=" stays text
      const at = index[r.id];
      if (at) {
        if (vals[2] < at.updatedAt) { stale.push(r.id); return; }   // server copy is newer
        // v26: this device last saw an older copy, and another device changed it since — hand that version back
        if (r.baseAt != null && Number(r.baseAt) > 0 && Number(r.baseAt) < at.updatedAt && vals[2] > at.updatedAt) {
          try { const old = String(sh.getRange(at.row, C.payload).getValue() || ''); if (old && old.length <= MAX_CELL) overwrote.push({ id: r.id, payload: old }); } catch (e) {}
        }
        sh.getRange(at.row, 1, 1, HEAD.length).setValues([vals]);
        at.updatedAt = vals[2];
        written++;
      } else if (seen[r.id] !== undefined) {
        const k = seen[r.id];                           // same id twice in one batch: the newer one wins
        if (vals[2] >= appends[k][2]) appends[k] = vals; else stale.push(r.id);
      } else {
        seen[r.id] = appends.length;
        appends.push(vals);
        written++;
      }
    });
    if (appends.length) {
      sh.getRange(sh.getLastRow() + 1, 1, appends.length, HEAD.length).setValues(appends);
    }
    return { ok: true, written: written, stale: stale, rejected: rejected, overwrote: overwrote, serverTime: now };
  });
}

/** One-off migration: hand back the OLD v15 "Records" and "Meta" tabs untouched. */
function legacy_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = { ok: true, records: [], meta: {} };
  const sh = ss.getSheetByName('Records');
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
      if (r[0]) out.records.push({ id: String(r[0]), type: String(r[1]), payload: String(r[2] || ''),
        updatedAt: Number(r[3]) || 0, deleted: r[4] === true || r[4] === 'TRUE' });
    });
  }
  const mt = ss.getSheetByName('Meta');
  if (mt && mt.getLastRow() >= 2) {
    mt.getRange(2, 1, mt.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) out.meta[r[0]] = r[1]; });
  }
  return out;
}

/* ==========================================================================
   DRIVE FILES — private files, bytes proxied through here.
   With DRIVE_FOLDER_ID set, only files inside that folder can be touched.
   ======================================================================== */
function folderIdFrom_(v) {
  const m = String(v || '').trim().match(/[-\w]{25,}/);
  return m ? m[0] : '';
}
function folderAllowed_(fid) {
  const want = driveFolder_();
  return !!want && fid === want;                        // v22: no folder set → nothing is allowed
}
function fileAllowed_(file) {
  const want = driveFolder_();
  if (!want) return false;
  const it = file.getParents();
  while (it.hasNext()) if (it.next().getId() === want) return true;
  return false;
}
function driveUpload_(body) {
  const fid = folderIdFrom_(body.folderId);
  if (!fid) return { error: 'no folder id' };
  if (!driveFolder_()) return { error: 'DRIVE_FOLDER_ID is not set — add it in Apps Script → Project Settings → Script Properties (the Register folder link)' };
  if (!folderAllowed_(fid)) { log_('WARN', 'upload refused: not the Register folder'); return { error: 'folder not allowed — DRIVE_FOLDER_ID in Script Properties must match the folder in Register Settings' }; }
  if (!body.data) return { error: 'no image data' };
  if (String(body.data).length > MAX_UPLOAD_B64) return { error: 'file too large for the script (about 22 MB at most)' };
  const blob = Utilities.newBlob(Utilities.base64Decode(body.data), body.mime || 'image/jpeg',
                                 body.name || ('register-' + Date.now()));
  const file = DriveApp.getFolderById(fid).createFile(blob);
  return { ok: true, fileId: file.getId() };
}
function driveGet_(body) {
  if (!body.fileId) return { error: 'no file id' };
  if (!driveFolder_()) return { error: 'DRIVE_FOLDER_ID is not set — add it in Apps Script → Project Settings → Script Properties (the Register folder link)' };
  const file = DriveApp.getFileById(body.fileId);
  if (!fileAllowed_(file)) { log_('WARN', 'read refused: file outside the Register folder'); return { error: 'file not allowed' }; }
  const blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}
/* ---------- v26: files in 4 MB pieces (up to about 50 MB) ---------- */
function upKey_(id) { return 'up_' + String(id).replace(/[^\w-]/g, '').slice(0, 60); }
function driveUpStart_(body) {
  const fid = folderIdFrom_(body.folderId);
  if (!fid || !folderAllowed_(fid)) return { error: 'folder not allowed — DRIVE_FOLDER_ID in Script Properties must match the folder in Register Settings' };
  const size = Number(body.size) || 0;
  if (!(size > 0)) return { error: 'empty file' };
  if (size > MAX_FILE) return { error: 'file too large (50 MB at most)' };
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true, followRedirects: false,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': body.mime || 'application/octet-stream', 'X-Upload-Content-Length': String(size) },
    payload: JSON.stringify({ name: String(body.name || ('register-' + Date.now())).slice(0, 200), parents: [fid] })
  });
  const loc = res.getHeaders()['Location'] || res.getHeaders()['location'];
  if (res.getResponseCode() !== 200 || !loc) return { error: 'Drive did not start the upload (HTTP ' + res.getResponseCode() + ')' };
  const id = Utilities.getUuid();
  CacheService.getScriptCache().put(upKey_(id), JSON.stringify({ loc: loc, size: size }), 21600);   // the upload address never leaves the script
  return { ok: true, up: id, part: PART };
}
function driveUpPart_(body) {
  const raw = CacheService.getScriptCache().get(upKey_(body.up));
  if (!raw) return { error: 'upload expired — try again' };
  const u = JSON.parse(raw), off = Number(body.offset) || 0;
  const bytes = Utilities.base64Decode(String(body.data || ''));
  if (!bytes.length) return { error: 'empty piece' };
  const end = off + bytes.length - 1;
  if (end >= u.size) return { error: 'piece past the end of the file' };
  const res = UrlFetchApp.fetch(u.loc, { method: 'put', muteHttpExceptions: true, followRedirects: false, contentType: 'application/octet-stream', payload: bytes,
    headers: { 'Content-Range': 'bytes ' + off + '-' + end + '/' + u.size } });
  const code = res.getResponseCode();
  if (code === 308) return { ok: true, done: false, next: end + 1 };
  if (code === 200 || code === 201) {
    CacheService.getScriptCache().remove(upKey_(body.up));
    let id = ''; try { id = JSON.parse(res.getContentText()).id; } catch (e) {}
    if (!id) return { error: 'Drive did not return a file id' };
    return { ok: true, done: true, fileId: id };
  }
  return { error: 'Drive refused the piece (HTTP ' + code + ')' };
}
function driveGetPart_(body) {
  if (!body.fileId) return { error: 'no file id' };
  if (!driveFolder_()) return { error: 'DRIVE_FOLDER_ID is not set — add it in Apps Script → Project Settings → Script Properties (the Register folder link)' };
  const file = DriveApp.getFileById(body.fileId);
  if (!fileAllowed_(file)) { log_('WARN', 'read refused: file outside the Register folder'); return { error: 'file not allowed' }; }
  const size = file.getSize(), off = Math.max(0, Number(body.offset) || 0);
  if (size === 0) return { ok: true, size: 0, mime: file.getMimeType(), data: '' };
  if (off >= size) return { error: 'offset past the end of the file' };
  const end = Math.min(size, off + PART) - 1;
  const res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(body.fileId) + '?alt=media', {
    muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + off + '-' + end } });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 206) return { error: 'Drive refused the read (HTTP ' + code + ')' };
  const bytes = res.getBlob().getBytes();
  if (code === 200 && off > 0) return { error: 'Drive ignored the range' };
  return { ok: true, size: size, mime: file.getMimeType(), offset: off, data: Utilities.base64Encode(code === 200 ? bytes.slice(0, end - off + 1) : bytes) };
}
function driveDelete_(body) {
  if (!body.fileId) return { error: 'no file id' };
  const file = DriveApp.getFileById(body.fileId);
  if (!fileAllowed_(file)) { log_('WARN', 'delete refused: file outside the Register folder'); return { error: 'file not allowed' }; }
  file.setTrashed(true);                                // recoverable from Drive's bin
  return { ok: true };
}

/* ---------- bulk import (v18): list the Docs folder, copy chosen files into the Register folder ---------- */
function importFolder_() {
  const id = importFolderId_();
  if (!id) return null;
  return DriveApp.getFolderById(id);
}
function driveListImport_() {
  const f = importFolder_();
  if (!f) return { error: 'IMPORT_FOLDER_ID is not set — add it in Apps Script → Project Settings → Script Properties (your Docs folder link)' };
  const out = [], it = f.getFiles();
  while (it.hasNext()) {
    const x = it.next();
    if (x.isTrashed()) continue;
    out.push({ id: x.getId(), name: x.getName(), mime: x.getMimeType(), size: x.getSize(), modified: x.getLastUpdated().getTime() });
  }
  return { ok: true, folder: f.getName(), files: out };
}
function driveCopyIn_(body) {
  const src = importFolder_(), dst = driveFolder_();
  if (!src) return { error: 'IMPORT_FOLDER_ID is not set (Script Properties)' };
  if (!dst) return { error: 'DRIVE_FOLDER_ID is not set (Script Properties)' };
  const target = DriveApp.getFolderById(dst), srcId = src.getId(), done = [];
  (body.files || []).slice(0, 10).forEach(function (r) {
    try {
      const file = DriveApp.getFileById(r.id);
      let inside = false, already = false; const ps = file.getParents();
      while (ps.hasNext()) { const pid = ps.next().getId(); if (pid === srcId) inside = true; if (pid === dst) already = true; }
      if (already && !inside) { done.push({ id: r.id, fileId: file.getId(), bytes: file.getSize(), mime: file.getMimeType(), moved: true }); return; }   // v22: moved on an earlier try whose answer was lost
      if (!inside) { done.push({ id: r.id, error: 'not in the Docs folder' }); return; }
      if (body.move) {
        try { file.moveTo(target); done.push({ id: r.id, fileId: file.getId(), bytes: file.getSize(), mime: file.getMimeType(), moved: true }); return; }
        catch (me) { log_('WARN', 'move failed, copying instead: ' + (me.message || me)); }   // e.g. a file shared with you, not owned
      }
      const copy = file.makeCopy(String(r.name || file.getName()).slice(0, 200), target);
      done.push({ id: r.id, fileId: copy.getId(), bytes: copy.getSize(), mime: copy.getMimeType() });
    } catch (e) { done.push({ id: r.id, error: String(e.message || e) }); }
  });
  log_('INFO', 'import ' + (body.move ? 'moved' : 'copied') + ' ' + done.filter(function (d) { return d.fileId; }).length + ' of ' + done.length);
  return { ok: true, done: done };
}

/* v21: Share into Register — an iPhone Shortcut posts a photo and/or text; it becomes an Inbox item */
const SHARE_EXT_MIME = {   // v27
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  csv: 'text/csv', txt: 'text/plain'
};
function inboxAdd_(body) {
  const now = Date.now(), rnd = function () { return Math.random().toString(36).slice(2, 10); };
  const text = String(body.text || '').slice(0, 4000), recs = [], imgs = [];
  let file = null;
  if (body.data) {
    const fid = driveFolder_();
    if (!fid) return { error: 'DRIVE_FOLDER_ID is not set (Script Properties)' };
    // v27: a known file extension (sent as "ext", or at the end of the name) decides the type; otherwise as before
    const extIn = String(body.ext || (String(body.name || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const byExt = SHARE_EXT_MIME[extIn];
    const mime = byExt || (/^(image\/(jpeg|png|heic|webp)|application\/pdf)$/i.test(String(body.mime || '')) ? String(body.mime).toLowerCase() : 'image/jpeg');
    const ext = byExt ? '.' + extIn : mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg';
    const given = String(body.name || '').replace(/[^\w.\- ()]/g, '_').replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 80);
    const name = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') + '-' + (given || 'shared-' + rnd()) + ext;
    const raw = String(body.data).replace(/^data:[^,]*,/, '').replace(/\s/g, '');
    if (raw.length > 22000000) return { error: 'file too large (15 MB at most)' };
    const blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, name);
    file = DriveApp.getFolderById(fid).createFile(blob);
    const b = { id: 'img' + now.toString(36) + rnd(), type: 'blob', drive: true, fileId: file.getId(), name: name, mime: mime, bytes: file.getSize(), deleted: false, createdAt: now, updatedAt: now };
    recs.push(b); imgs.push(b.id);
  }
  if (!text && !imgs.length) return { error: 'nothing to save' };
  const ib = { id: 'ib' + now.toString(36) + rnd(), type: 'inbox', text: text, imgs: imgs, via: 'share', deleted: false, createdAt: now, updatedAt: now };
  recs.push(ib);
  let r;
  try { r = push_({ records: recs.map(function (x) { return { id: x.id, type: x.type, updatedAt: now, deleted: false, summary: x.type === 'inbox' ? text.slice(0, 80) : x.name, payload: JSON.stringify(x) }; }) }); }
  catch (e) { if (file) { try { file.setTrashed(true); } catch (e2) {} } throw e; }   // v22: no stray photo if the Sheet was busy
  log_('INFO', 'inbox item added from share' + (imgs.length ? ' (file)' : ''));
  return { ok: true, id: ib.id, written: r.written };
}

/* v25: the emergency erase proof — a value made in the app from your erase code. Only its hash is kept here. */
function eraseProofSet_(body) {
  const props = PropertiesService.getScriptProperties(), cur = props.getProperty('ERASE_PROOF');
  const proof = String(body.proof || '');
  if (proof.length < 20) return { error: 'bad proof' };
  if (cur && sha_(String(body.oldProof || '')) !== cur) { log_('WARN', 'erase proof change refused: old proof does not match'); return { error: 'erase proof mismatch' }; }
  props.setProperty('ERASE_PROOF', sha_(proof));
  log_('INFO', 'erase proof ' + (cur ? 'changed' : 'set'));
  return { ok: true };
}
/* v24: emergency erase — every file in the Register folder goes to Drive's Trash (recoverable there for 30 days) */
function driveEmptyFolder_(body) {
  const fid = driveFolder_();
  if (!fid) return { error: 'DRIVE_FOLDER_ID is not set (Script Properties)' };
  if (body.confirm !== 'ERASE') return { error: 'confirmation missing' };
  const want = PropertiesService.getScriptProperties().getProperty('ERASE_PROOF');   // v25: the token alone is not enough
  if (!want) return { error: 'erase proof not set — save your emergency erase code again in the app' };
  if (sha_(String(body.proof || '')) !== want) { log_('WARN', 'emergency erase refused: wrong proof'); return { error: 'erase proof does not match' }; }
  const it = DriveApp.getFolderById(fid).getFiles(), t0 = Date.now(); let n = 0;
  while (it.hasNext() && Date.now() - t0 < 240000) { const f = it.next(); if (!f.isTrashed()) { f.setTrashed(true); n++; } }
  log_('WARN', 'emergency erase: ' + n + ' files moved to Drive Trash');
  return { ok: true, trashed: n, more: it.hasNext() };
}
/* v20: is each Register file still there? */
function driveCheck_(body) {
  const out = [];
  (body.ids || []).slice(0, 150).forEach(function (id) {
    let st = 'ok';
    try {
      const f = DriveApp.getFileById(id);
      if (!fileAllowed_(f)) st = 'outside';               // v22: nothing is said about files outside the Register folder
      else if (f.isTrashed()) st = 'trash';
    } catch (e) { st = 'missing'; }
    out.push({ id: id, st: st });
  });
  return { ok: true, states: out };
}
function driveRestore_(body) {
  if (!body.fileId) return { error: 'no file id' };
  const file = DriveApp.getFileById(body.fileId);
  if (!fileAllowed_(file)) return { error: 'file not allowed' };
  file.setTrashed(false);
  return { ok: true };
}
/* v19: trash Docs-folder originals that Register already holds a copy of */
function driveTidyImport_(body) {
  const src = importFolder_(), dst = driveFolder_();
  if (!src) return { error: 'IMPORT_FOLDER_ID is not set (Script Properties)' };
  const srcId = src.getId(), done = [];
  const underSrc = function (file) {
    const ps = file.getParents();
    while (ps.hasNext()) {
      const p = ps.next(), pid = p.getId();
      if (pid === dst) return false;
      if (pid === srcId) return true;                     // v22: only files directly in the Docs folder (the ones import lists)
    }
    return false;
  };
  (body.ids || []).slice(0, 100).forEach(function (id) {
    try {
      let file;
      try { file = DriveApp.getFileById(id); } catch (e) { done.push({ id: id, missing: true }); return; }
      if (file.isTrashed()) { done.push({ id: id, missing: true }); return; }
      if (!underSrc(file)) { done.push({ id: id, error: 'not in the Docs folder' }); return; }
      file.setTrashed(true);
      done.push({ id: id, ok: true });
    } catch (e) { done.push({ id: id, error: String(e.message || e) }); }
  });
  log_('INFO', 'tidy trashed ' + done.filter(function (d) { return d.ok; }).length + ' of ' + done.length);
  return { ok: true, done: done };
}

/* ==========================================================================
   HANDLERS
   ======================================================================== */
function doGet() {
  // Nothing is served over GET any more; this only confirms the deployment is alive.
  return json_({ ok: true, app: 'register' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ error: 'bad json' }); }
  if (!body || typeof body !== 'object') return json_({ error: 'bad json' });
  const sec = secret_();
  if (!sec || sec === 'PASTE-YOUR-TOKEN-HERE') return json_({ error: 'server not configured: add SECRET (your token) in Apps Script → Project Settings → Script Properties' });
  if (typeof body.token !== 'string' || body.token !== sec) { console.warn('unauthorized ' + String(body.action || '')); return json_({ error: 'unauthorized' }); }   // v22: not written to the Log sheet

  try {
    switch (body.action) {
      case 'ping':          return json_({ ok: true, v: 27, parts: true, serverTime: Date.now() });
      case 'pull':          return json_(pull_(body));
      case 'push':          return json_(push_(body));
      case 'legacy':        return json_(legacy_());
      case 'driveUpload':   return json_(driveUpload_(body));
      case 'driveGet':      return json_(driveGet_(body));
      case 'driveUpStart':  return json_(driveUpStart_(body));
      case 'driveUpPart':   return json_(driveUpPart_(body));
      case 'driveGetPart':  return json_(driveGetPart_(body));
      case 'driveDelete':   return json_(driveDelete_(body));
      case 'driveListImport': return json_(driveListImport_());
      case 'driveCopyIn':   return json_(driveCopyIn_(body));
      case 'driveTidyImport': return json_(driveTidyImport_(body));
      case 'driveCheck':    return json_(driveCheck_(body));
      case 'inboxAdd':      return json_(inboxAdd_(body));
      case 'driveEmptyFolder': return json_(driveEmptyFolder_(body));
      case 'eraseProofSet': return json_(eraseProofSet_(body));
      case 'driveRestore':  return json_(driveRestore_(body));
      default:              return json_({ error: 'unknown action: ' + body.action });
    }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    log_('ERROR', (body.action || '?') + ': ' + msg);
    return json_({ error: msg });
  }
}

/* ==========================================================================
   DAILY MAINTENANCE — empties rows deleted long ago (v25: no email any more)
   ======================================================================== */
function dailyMaintenance() {
  try { purgeDeleted_(); } catch (e) { log_('ERROR', 'purge: ' + e); }
}

function purgeDeleted_() {
  withLock_(function () {
    const sh = getSheet_();
    const last = sh.getLastRow();
    if (last < 2) return;
    const cutoff = Date.now() - PURGE_AFTER_DAYS * 86400000;
    const vals = sh.getRange(2, 1, last - 1, C.summary).getValues();
    // v22: the row stays as a small marker (a phone offline for months still learns it was deleted);
    // its content is removed. serverAt is kept, so devices that already know do not download it again.
    const hit = function (r) { return r[0] && (r[C.deleted - 1] === true || r[C.deleted - 1] === 'TRUE') && (Number(r[C.serverAt - 1]) || 0) < cutoff && r[C.summary - 1] !== PURGED; };
    let n = 0;
    for (let i = 0; i < vals.length; ) {
      if (!hit(vals[i])) { i++; continue; }
      let j = i; while (j + 1 < vals.length && hit(vals[j + 1])) j++;
      const block = [];
      for (let k = i; k <= j; k++) block.push([PURGED, JSON.stringify({ id: String(vals[k][0]), type: String(vals[k][1]), updatedAt: Number(vals[k][2]) || 0, deleted: true, deletedAt: 1, purged: 1 })]);
      sh.getRange(i + 2, C.summary, block.length, 2).setValues(block);
      n += block.length; i = j + 1;
    }
    if (n) log_('INFO', 'emptied ' + n + ' deleted rows');
  });
}

/* ==========================================================================
   RUN ONCE: grants permissions and installs the 7 AM daily trigger.
   ======================================================================== */
function setup() {
  getSheet_();
  DriveApp.getRootFolder().getName();                   // Drive scope
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });   // v26: "Connect to an external service" — files in pieces
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyMaintenance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyMaintenance').timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
  const sec = secret_();
  Logger.log('Script Properties — SECRET: ' + (prop_('SECRET') ? 'set (' + prop_('SECRET').length + ' characters)' : SECRET ? 'NOT set (using the line in the code)' : 'NOT set')
    + ' · DRIVE_FOLDER_ID: ' + (prop_('DRIVE_FOLDER_ID') ? 'set' : DRIVE_FOLDER_ID ? 'NOT set (using the line in the code)' : 'NOT set')
    + ' · IMPORT_FOLDER_ID: ' + (prop_('IMPORT_FOLDER_ID') ? 'set' : IMPORT_FOLDER_ID ? 'NOT set (using the line in the code)' : 'not set (optional)'));
  if (!sec || sec === 'PASTE-YOUR-TOKEN-HERE') Logger.log('SECRET is not set — the app cannot connect until you add it in Project Settings → Script Properties.');
  else if (sec.length < 24) Logger.log('SECRET is short (' + sec.length + ' characters). Run makeToken for a long one, and put it in Script Properties → SECRET and in Register → Settings → Token.');
  if (!driveFolder_()) Logger.log('DRIVE_FOLDER_ID is not set — document files, photos and backups will not work until you add it in Script Properties.');
  log_('INFO', 'setup complete (v27) — daily clean-up at 7 AM IST (no email)');
  Logger.log('Done. Now: Deploy → Manage deployments → Edit → New version → Deploy.');
}

/** Run once if you want a new, strong token: it appears in the Execution log. */
function makeToken() {
  const t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  Logger.log('New token: ' + t);
  Logger.log('Put it in Project Settings → Script properties → SECRET (or in SECRET above) AND in Register → Settings → Token, then deploy a new version.');
}

/** v25: run once to move the token out of the code. Afterwards set the SECRET line above to '' and deploy a new version. */
function moveSecretToProperties() {
  if (!SECRET || SECRET === 'PASTE-YOUR-TOKEN-HERE') { Logger.log('SECRET above is empty — nothing to move. Add SECRET in Project Settings → Script properties instead.'); return; }
  PropertiesService.getScriptProperties().setProperty('SECRET', SECRET);
  Logger.log('Done. The token is now in Script Properties. Set the SECRET line in the code to \'\' and deploy a new version.');
}

/** Run once after filling DRIVE_FOLDER_ID: confirms the folder is found. */
function checkFolder() {
  const id = driveFolder_();
  if (!id) { Logger.log('DRIVE_FOLDER_ID is not set — add it in Project Settings → Script Properties.'); return; }
  const f = DriveApp.getFolderById(id);
  Logger.log('OK — Register folder is "' + f.getName() + '". Files outside it are now refused.');
  const imp = importFolderId_();
  if (imp) { try { Logger.log('OK — import (Docs) folder is "' + DriveApp.getFolderById(imp).getName() + '".'); } catch (e) { Logger.log('IMPORT_FOLDER_ID is set but that folder cannot be opened: ' + e); } }
}