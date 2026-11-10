/* Register build. The app the phone loads is still ONE file, app.js. Its source lives in src/ (one file per part of
   the app); src/manifest.json lists them in order and this script joins them, byte for byte, into app.js.
     node tools/build.js           write app.js from src/
     node tools/build.js --check   change nothing; fail if app.js is not what src/ builds, if a file has a syntax
                                   error, or if the four version numbers (app.js, sw.js, index.html ×2) differ      */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), LOG = path.join(__dirname, 'build.log');
function log(level, msg) { const line = new Date().toISOString() + ' ' + level + ' ' + msg; try { fs.appendFileSync(LOG, line + '\n'); } catch (e) {} (level === 'ERROR' ? console.error : console.log)(msg); }
log('INFO', 'build start ' + process.argv.slice(2).join(' '));
let vm;
try { vm = require('vm'); } catch (e) { log('ERROR', 'cannot load vm: ' + e.message); process.exit(1); }
function fail(msg) { log('ERROR', msg); process.exit(1); }
function read(p) { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch (e) { fail('cannot read ' + p + ': ' + e.message); } }
function build() {
  let manifest; try { manifest = JSON.parse(read('src/manifest.json')); } catch (e) { fail('src/manifest.json is not valid JSON: ' + e.message); }
  const onDisk = [];
  (function walk(d) { fs.readdirSync(path.join(ROOT, 'src', d)).forEach(n => { const r = d ? d + '/' + n : n; if (fs.statSync(path.join(ROOT, 'src', r)).isDirectory()) walk(r); else if (n.endsWith('.js')) onDisk.push(r); }); })('');
  const missing = onDisk.filter(f => !manifest.files.includes(f));
  if (missing.length) fail('in src/ but not in src/manifest.json (it would be left out of the app): ' + missing.join(', '));
  return manifest.files.map(f => { const s = read('src/' + f); try { new vm.Script(s, { filename: 'src/' + f }); } catch (e) { fail('syntax error in src/' + f + ': ' + e.message); } return s; }).join('');
}
function versions(app) {
  const pick = (s, rx, where) => { const m = s.match(rx); if (!m) fail('version not found in ' + where); return m[1]; };
  const html = read('index.html');
  return { 'app.js APP_VERSION': pick(app, /const APP_VERSION = '([^']+)'/, 'app.js'), 'sw.js VERSION': pick(read('sw.js'), /const VERSION = '([^']+)'/, 'sw.js'),
    'index.html app-version': pick(html, /<meta name="app-version" content="([^"]+)"/, 'index.html meta'), 'index.html app.js?v=': pick(html, /app\.js\?v=([0-9.]+)"/, 'index.html script') };
}
const out = build();
try { new vm.Script(out, { filename: 'app.js' }); } catch (e) { fail('the joined app.js has a syntax error: ' + e.message); }
const dup = (out.match(/^(?:async )?function ([A-Za-z0-9_$]+)/gm) || []).map(x => x.split(' ').pop()).filter((n, i, a) => a.indexOf(n) !== i);
if (dup.length) fail('the same function is declared twice (the later one silently wins): ' + [...new Set(dup)].join(', '));
const V = versions(out), uniq = [...new Set(Object.values(V))];
if (uniq.length !== 1) fail('version numbers differ: ' + JSON.stringify(V));
if (process.argv.includes('--check')) {
  if (read('app.js') !== out) fail('app.js is not what src/ builds. Run: node tools/build.js');
  log('INFO', 'check ok: app.js matches src/ (' + out.length + ' characters), version ' + uniq[0]);
} else { fs.writeFileSync(path.join(ROOT, 'app.js'), out); log('INFO', 'wrote app.js (' + out.length + ' characters), version ' + uniq[0]); }
