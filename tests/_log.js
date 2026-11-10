/* Every test file opens its log before anything else, so a crash still leaves a trail (tests/<name>.log). */
const fs = require('fs'), path = require('path');
module.exports = function (name) {
  const file = path.join(__dirname, name + '.log'); try { fs.writeFileSync(file, new Date().toISOString() + ' start\n'); } catch (e) {}
  const write = (lvl, m) => { try { fs.appendFileSync(file, new Date().toISOString() + ' ' + lvl + ' ' + m + '\n'); } catch (e) {} };
  const results = [];
  const api = {
    info: m => { write('INFO', m); },
    ok: (title, pass, detail) => { results.push(!!pass); const line = (pass ? 'ok   ' : 'FAIL ') + title + (detail ? '  ' + detail : ''); write(pass ? 'INFO' : 'ERROR', line); console.log(line); },
    crash: e => { write('ERROR', 'crash: ' + (e && e.stack || e)); console.error(name + ': crashed — ' + (e && e.message || e)); process.exit(1); },
    done: () => { const bad = results.filter(x => !x).length; write('INFO', `done: ${results.length - bad} passed, ${bad} failed`); console.log(`${name}: ${results.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0); }
  };
  process.on('uncaughtException', api.crash);
  return api;
};
