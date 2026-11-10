const T = require('./_log')('apps-script.test');
/* The Apps Script's "Share into Register" handler, run against stand-ins for Google's services. */
let fs, vm, path;
try { fs = require('fs'); vm = require('vm'); path = require('path'); } catch (e) { T.crash(e); }
let saved = null;
const ctx = { Utilities: { formatDate: () => '2026-11-11', newBlob: (b, m, n) => ({ b, m, n }), base64Decode: s => Buffer.from(s, 'base64') },
  DriveApp: { getFolderById: () => ({ createFile: b => { saved = b; return { getId: () => 'F1', getSize: () => 3, setTrashed() {} }; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'DRIVE_FOLDER_ID' ? 'A'.repeat(30) : '' }) },
  console, Math, Date, JSON, String, Number, SpreadsheetApp: {}, LockService: {}, ContentService: {}, CacheService: {}, UrlFetchApp: {}, ScriptApp: {}, Logger: { log() {} } };
vm.createContext(ctx);
const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
try { vm.runInContext(code + ';push_ = function (b) { return { written: b.records.length }; }; log_ = function () {};', ctx); } catch (e) { T.crash(e); }
const share = b => { saved = null; const r = vm.runInContext('inboxAdd_(' + JSON.stringify(Object.assign({ data: 'QUJD' }, b)) + ')', ctx); return { r, name: saved && saved.n, mime: saved && saved.m }; };
let x = share({ mime: 'application/pdf', name: 'Report', ext: 'docx' }); T.ok('Word file keeps its type', /Report\.docx$/.test(x.name) && /wordprocessingml/.test(x.mime), x.name);
x = share({ mime: 'application/pdf', name: 'Sheet', ext: 'xlsx' }); T.ok('Excel file keeps its type', /Sheet\.xlsx$/.test(x.name) && /spreadsheetml/.test(x.mime), x.name);
x = share({ mime: 'application/pdf', name: 'ITR-Ack' }); T.ok('PDF as before (older Shortcut, no ext)', /ITR-Ack\.pdf$/.test(x.name) && x.mime === 'application/pdf', x.name);
x = share({ mime: 'image/jpeg' }); T.ok('photo as before', /\.jpg$/.test(x.name) && x.mime === 'image/jpeg', x.name);
x = share({ mime: 'application/pdf', name: 'x', ext: 'exe' }); T.ok('an unknown extension is not trusted', /x\.pdf$/.test(x.name) && x.mime === 'application/pdf', x.name);
x = share({ name: 'notes.txt' }); T.ok('extension at the end of the name works too', /notes\.txt$/.test(x.name) && x.mime === 'text/plain', x.name);
x = share({ data: '', text: '' }); T.ok('nothing to save is refused', x.r && x.r.error === 'nothing to save');
T.ok('no token, folder id or key is written in the code', /const SECRET = '';/.test(code) && /const DRIVE_FOLDER_ID = '';/.test(code) && /const IMPORT_FOLDER_ID = '';/.test(code));
T.done();
