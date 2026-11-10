/* Loads app.js in a stand-in browser (no screen), so the Money arithmetic and the sync clock can be run with made-up data. */
const fs = require('fs'), vm = require('vm'), path = require('path');
function stub(name) {
  const f = function () {};
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'content' || k === 'className' || k === 'id') return t['_' + String(k)] || '';
      if (k === 'dataset' || k === 'style') return t['_' + k] || (t['_' + k] = {});
      if (k === 'checked' || k === 'hidden' || k === 'standalone' || k === 'matches' || k === 'onLine') return false;
      if (k === 'forEach' || k === 'map' || k === 'filter') return () => [];
      if (k in t) return t[k];
      return stub(name + '.' + String(k));
    },
    set(t, k, v) { t['_' + String(k)] = v; t[k] = v; return true; },
    apply() { return stub(name + '()'); },
    construct() { return stub('new ' + name); },
    has() { return true; }
  });
}
function load(appPath, nowISO) {
  const ls = {};
  const RealDate = Date; let fixed = nowISO ? new RealDate(nowISO).getTime() : null;
  class FDate extends RealDate { constructor(...a) { if (a.length === 0 && fixed != null) super(fixed); else super(...a); } static now() { return fixed != null ? fixed : RealDate.now(); } }
  const doc = stub('document');
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} }, Date: FDate, Math, JSON, Promise, Set, Map, WeakMap, Symbol, Object, Array, Number, String, Boolean, RegExp, Error, TypeError, Intl, isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, Proxy, Reflect,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, queueMicrotask() {},
    document: doc, navigator: { userAgent: 'node', onLine: true, standalone: false, serviceWorker: stub('sw'), storage: stub('st'), clipboard: stub('cb') },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { href: 'http://x/', search: '', hash: '', origin: 'http://x', pathname: '/', reload() {}, replace() {} },
    history: stub('history'), indexedDB: stub('idb'), crypto: require('crypto').webcrypto, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: () => new Promise(() => {}), addEventListener() {}, removeEventListener() {}, getComputedStyle: () => stub('cs'), innerWidth: 390, innerHeight: 800, visualViewport: stub('vv'),
    URL, URLSearchParams, Blob: stub('Blob'), FileReader: stub('FR'), Image: stub('Image'), IntersectionObserver: stub('IO'), MutationObserver: stub('MO'), ResizeObserver: stub('RO'), AbortController, performance: { now: () => 0 }, screen: {}, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), alert() {}, confirm: () => true, prompt: () => '',
    __setNow: iso => { fixed = new RealDate(iso).getTime(); }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const errs = [];
  process.on('unhandledRejection', e => errs.push('unhandled: ' + (e && e.message)));
  try { vm.runInContext(fs.readFileSync(appPath, 'utf8'), ctx, { filename: 'app.js' }); } catch (e) { errs.push('load: ' + e.message + ' @ ' + (e.stack || '').split('\n')[1]); }
  return { ctx, errs, run: code => vm.runInContext(code, ctx) };
}
module.exports = { load };
