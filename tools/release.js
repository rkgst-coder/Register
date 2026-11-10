/* Set the version number in all four places at once, then rebuild app.js.
     node tools/release.js 2.37.0                                                                                  */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), LOG = path.join(__dirname, 'build.log');
function log(level, msg) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + level + ' ' + msg + '\n'); } catch (e) {} (level === 'ERROR' ? console.error : console.log)(msg); }
log('INFO', 'release start ' + process.argv.slice(2).join(' '));
let cp;
try { cp = require('child_process'); } catch (e) { log('ERROR', 'cannot load child_process: ' + e.message); process.exit(1); }
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) { log('ERROR', 'give the new version, e.g. node tools/release.js 2.37.0'); process.exit(1); }
const edits = [['src/core/logging.js', /const APP_VERSION = '[^']+'/, `const APP_VERSION = '${v}'`], ['sw.js', /const VERSION = '[^']+'/, `const VERSION = '${v}'`],
  ['index.html', /(<meta name="app-version" content=")[^"]+/, '$1' + v], ['index.html', /app\.js\?v=[0-9.]+/, 'app.js?v=' + v]];
for (const [f, rx, to] of edits) {
  const p = path.join(ROOT, f); let s;
  try { s = fs.readFileSync(p, 'utf8'); } catch (e) { log('ERROR', 'cannot read ' + f + ': ' + e.message); process.exit(1); }
  if (!rx.test(s)) { log('ERROR', 'version line not found in ' + f + ' — nothing more was changed'); process.exit(1); }
  fs.writeFileSync(p, s.replace(rx, to)); log('INFO', f + ' → ' + v);
}
try { cp.execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' }); } catch (e) { log('ERROR', 'build failed after the version change'); process.exit(1); }
