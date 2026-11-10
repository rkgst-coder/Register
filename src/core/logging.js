/* ==========================================================================
   LOGGING — initialised before anything else so even a crash during start-up
   leaves a trail. A browser can't write to a file on its own, so the log is a
   rolling buffer (last 400 lines) kept in localStorage and downloadable from
   Settings → Diagnostics → Download log as register-log-YYYY-MM-DD.txt.
   ======================================================================== */
'use strict';
const APP_VERSION = '2.36.0';
/* index.html names the app.js it was built with; a mismatch means one of the two files was not updated */
const PAGE_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || '';
const LOG_KEY = 'r2_log';
const LOG_MAX = 400;
const RLOG = (() => {
  let buf = [];
  try { buf = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { buf = []; }
  let t = null;
  const flush = () => { if (window.__erasing) return; try { localStorage.setItem(LOG_KEY, JSON.stringify(buf.slice(-LOG_MAX))); } catch (e) {} };
  const write = (level, args) => {
    const msg = args.map(a => a instanceof Error ? (a.message + (a.stack ? ' | ' + a.stack.split('\n')[1] : ''))
                          : typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })()
                          : String(a)).join(' ');
    buf.push(new Date().toISOString() + ' ' + level + ' ' + msg.slice(0, 600));
    if (buf.length > LOG_MAX * 1.2) buf = buf.slice(-LOG_MAX);
    clearTimeout(t); t = setTimeout(flush, 300);
    (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)('[register]', msg);
  };
  return {
    info: (...a) => write('INFO', a), warn: (...a) => write('WARN', a), error: (...a) => write('ERROR', a),
    text: () => buf.join('\n'), flush
  };
})();
window.addEventListener('error', e => RLOG.error('uncaught:', e.message, '@', (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => RLOG.error('unhandled promise:', e.reason));
window.addEventListener('pagehide', () => RLOG.flush());
RLOG.info('start v' + APP_VERSION, navigator.userAgent.slice(0, 120),
          'standalone=' + (window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches));

