// ============================================================================
//  STATS BEACON  ·  lib/stats-beacon.js — send visit counts to the sn-stats Worker
// ----------------------------------------------------------------------------
//  The Worker (pages/stats/worker/worker.js) turns each event into totals.
//  This script sends only the facts in the worker.js METRICS list: no
//  cookie, no stored id, no page text, no input values, no full URLs.
//  It sends NOTHING when one of these is true:
//    - STATS_URL is empty (the Worker is not deployed yet)
//    - the browser sets Global Privacy Control or Do Not Track
//    - localStorage 'sn-stats-optout' is '1' (the #stats page sets it)
//    - navigator.webdriver is true (test and crawler browsers)
//    - the page is on file://
//
//  Three roles, from where the script runs:
//    shell   stella-nova/index.html. markTab calls snStats.page(id), and
//            adoptFrame calls snStats.frame(iframe, id) for load time,
//            errors and outside-link clicks in the page.
//    page    a pages/<key>/index.html opened without the shell. The
//            script reports that one page.
//    framed  a page inside the shell. The script does nothing, because
//            the shell reports it.
//
//  Session: sessionStorage 'sn-st' = { d: pages seen, p: last page,
//  e: the provisional end, if one was sent }. It ends when the tab closes,
//  and it never leaves the browser. A tab with no 'sn-st' sends one
//  'visit' event (device facts, WebGPU probe).
//
//  Visit end: pagehide does not fire on every tab close (iOS Safari skips
//  it), so the end goes out when the tab becomes hidden: one 'end' (exit
//  page, depth) and the final engaged-time bin. If the tab comes back,
//  or the same tab loads the site again, the beacon sends the same events
//  with undo: 1, and the Worker takes them away. Each visit then keeps
//  one exit and one bin per view.
//
//  Screensaver: while <body> has the class sn-saver-on, page changes are
//  not pageviews. The run sends one saver event with its length.
//
//  Batches go out with navigator.sendBeacon as text/plain (no CORS
//  preflight), FLUSH_MS after an event, and at once on hide or unload.
//
//  It sets window.snStats = { page, frame, enabled, optOut, optedOut, url }.
//  url is the Worker base URL ('' when not deployed). The #stats page reads
//  it, so STATS_URL is the one place to set the endpoint.
//
//  grep -n targets
//    endpoint ............. "var STATS_URL"
//    privacy gate ......... "function blocked"
//    visit facts .......... "function visitFacts"
//    page change .......... "function page"
//    frame hooks .......... "function frame"
//    engaged time ......... "function closeEng"
// ============================================================================
(function () {
  if (window.snStats) return;
  // After "wrangler deploy", put the printed workers.dev URL here.
  var STATS_URL = '';
  var LOCAL_URL = 'http://127.0.0.1:8789';
  var OPT_KEY = 'sn-stats-optout';
  var SKIP = { stats: 1 };
  var FLUSH_MS = 2500;
  var MAX_ERRS = 5;

  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var base = local ? LOCAL_URL : STATS_URL;

  function optedOut() { try { return localStorage.getItem(OPT_KEY) === '1'; } catch (e) { return false; } }
  function optOut(on) { try { if (on) localStorage.setItem(OPT_KEY, '1'); else localStorage.removeItem(OPT_KEY); } catch (e) {} }
  function blocked() {
    var n = navigator;
    return !base || location.protocol === 'file:' || n.globalPrivacyControl === true ||
      n.doNotTrack === '1' || window.doNotTrack === '1' || n.webdriver === true || optedOut();
  }
  function noop() {}
  var api = { page: noop, frame: noop, enabled: false, optOut: optOut, optedOut: optedOut, url: base };
  window.snStats = api;

  var top;
  try { top = window.top === window; } catch (e) { top = false; }
  if (!top || blocked()) return;
  var m = /\/pages\/([^/]+)\//.exec(location.pathname);
  var role = m ? 'page' : 'shell';
  if (role === 'page' && (m[1] === 'home' || SKIP[m[1]])) return;
  api.enabled = true;

  // ── queue ───────────────────────────────────────────────────────────
  var q = [], timer = 0;
  function push(e) { q.push(e); if (!timer) timer = setTimeout(flush, FLUSH_MS); }
  function flush() {
    clearTimeout(timer); timer = 0;
    while (q.length) {
      var body = JSON.stringify({ v: 1, ev: q.splice(0, 40) });
      var sent = false;
      try { sent = navigator.sendBeacon(base + '/e', new Blob([body], { type: 'text/plain' })); } catch (e) {}
      if (!sent) { try { fetch(base + '/e', { method: 'POST', body: body, keepalive: true, mode: 'no-cors', headers: { 'Content-Type': 'text/plain' } }); } catch (e) {} }
    }
  }

  // ── session ─────────────────────────────────────────────────────────
  var S = null;
  try { S = JSON.parse(sessionStorage.getItem('sn-st') || 'null'); } catch (e) {}
  var newVisit = !S;
  if (!S) S = { d: 0, p: '', e: null };
  function save() { try { sessionStorage.setItem('sn-st', JSON.stringify(S)); } catch (e) {} }
  save();

  // ── visit facts ─────────────────────────────────────────────────────
  function band(x, edges, labels) { for (var i = 0; i < edges.length; i++) if (x < edges[i]) return labels[i]; return labels[labels.length - 1]; }
  function mq(s) { try { return matchMedia(s).matches; } catch (e) { return false; } }
  function visitFacts() {
    var e = { t: 'visit' };
    try { var r = document.referrer && new URL(document.referrer); if (r && r.host !== location.host) e.ref = r.hostname; } catch (x) {}
    try {
      var sp = new URLSearchParams(location.search);
      if (sp.get('utm_source')) e.us = sp.get('utm_source');
      if (sp.get('utm_medium')) e.um = sp.get('utm_medium');
      if (sp.get('utm_campaign')) e.uc = sp.get('utm_campaign');
    } catch (x) {}
    var coarse = mq('(pointer:coarse)'), short = Math.min(screen.width, screen.height);
    e.dev = coarse ? (short < 600 ? 'mobile' : 'tablet') : 'desktop';
    e.lang = navigator.language || '';
    e.scr = band(screen.width, [360, 414, 768, 1024, 1280, 1440, 1920, 2560, 3840],
      ['<360', '360-413', '414-767', '768-1023', '1024-1279', '1280-1439', '1440-1919', '1920-2559', '2560-3839', '3840+']);
    var d = window.devicePixelRatio || 1;
    e.dpr = d < 1.25 ? '1' : d < 1.75 ? '1.5' : d < 2.5 ? '2' : '3+';
    e.dark = mq('(prefers-color-scheme: dark)') ? 1 : 0;
    e.rm = mq('(prefers-reduced-motion: reduce)') ? 1 : 0;
    e.touch = navigator.maxTouchPoints > 0 ? 1 : 0;
    e.mode = mq('(display-mode: standalone)') || navigator.standalone ? 'app' : role;
    e.sw = navigator.serviceWorker && navigator.serviceWorker.controller ? 1 : 0;
    try {
      var c = document.createElement('canvas'), gl = c.getContext('webgl2');
      e.gl2 = gl ? 1 : 0;
      if (gl) { var x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
    } catch (x) { e.gl2 = 0; }
    return e;
  }
  // WebGPU: an adapter only (no device), and only its vendor name.
  function probeGpu() {
    if (!navigator.gpu) return Promise.resolve({ gpu: 'no' });
    var t = new Promise(function (res) { setTimeout(function () { res({ gpu: 'fail' }); }, 2000); });
    var p = navigator.gpu.requestAdapter().then(function (a) {
      if (!a) return { gpu: 'no' };
      var v = a.info && a.info.vendor;
      return { gpu: 'yes', gv: v || '' };
    }, function () { return { gpu: 'fail' }; });
    return Promise.race([p, t]);
  }
  if (newVisit) {
    var facts = visitFacts();
    probeGpu().then(function (g) { facts.gpu = g.gpu; if (g.gv) facts.gv = g.gv; push(facts); });
  }

  // ── engaged time ────────────────────────────────────────────────────
  var cur = null;
  function visible() { return document.visibilityState === 'visible'; }
  function tick() { if (cur && cur.since) { var n = Date.now(); cur.acc += n - cur.since; cur.since = n; } }
  function closeEng(last) {
    if (!cur) return;
    tick();
    var s = Math.round(cur.acc / 1000);
    cur.acc = 0;
    if (s > 0 || cur.first || last) {
      cur.tot += s;
      push({ t: 'eng', p: cur.p, s: s, first: cur.first ? 1 : 0, last: last ? 1 : 0, tot: cur.tot });
      cur.first = false;
    }
  }
  // Provisional end of the visit (see the header), and its undo.
  function endVisit() {
    if (!cur || S.e) return;
    closeEng(true);
    S.e = { p: cur.p, d: S.d, tot: cur.tot };
    push({ t: 'end', p: cur.p, depth: S.d });
    save();
  }
  function undoEnd(keepBin) {
    if (!S.e) return;
    push({ t: 'end', p: S.e.p, depth: S.e.d, undo: 1 });
    if (!keepBin) push({ t: 'eng', p: S.e.p, s: 0, undo: 1, tot: S.e.tot });
    S.e = null;
    save();
  }
  // The same tab loaded the site again (reload, or a page link): the
  // visit goes on. The earlier view did end, so its time bin stays.
  undoEnd(true);

  // ── page change ─────────────────────────────────────────────────────
  var saver = 0, held = '';
  function page(id) {
    if (saver) { held = id; return; }
    if (cur && cur.p === id) return;
    undoEnd(false);
    if (cur) closeEng(true);
    cur = null;
    if (!id || SKIP[id]) return;
    var now = new Date();
    push({ t: 'pv', p: id, from: S.p || '', wd: now.getDay(), lh: now.getHours(), ctx: role });
    S.d++; S.p = id; save();
    cur = { p: id, acc: 0, tot: 0, since: visible() ? Date.now() : 0, first: true };
  }
  api.page = page;

  // ── errors and outside links ────────────────────────────────────────
  var errs = {};
  var GPU_RE = /gpu|webgpu|webgl|adapter|device.?lost|wgsl|shader/i;
  function onErr(msg, kind) {
    var p = cur ? cur.p : '';
    errs[p] = (errs[p] || 0) + 1;
    if (errs[p] > MAX_ERRS) return;
    msg = String(msg || '');
    push({ t: 'err', p: p, k: GPU_RE.test(msg) ? 'gpu' : kind, msg: msg.slice(0, 200) });
  }
  function onClick(ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;
    var u;
    try { u = new URL(a.href); } catch (x) { return; }
    if (!/^https?:$/.test(u.protocol) || u.host === location.host) return;
    var e = { t: 'out', p: cur ? cur.p : '', host: u.hostname };
    if (u.hostname === 'store.steampowered.com') e.med = u.searchParams.get('utm_medium') || 'untagged';
    push(e); flush();
  }
  function hook(w) {
    if (!w || w.__snStatsHooked) return;
    w.__snStatsHooked = true;
    w.addEventListener('error', function (e) { if (e && e.message) onErr(e.message, 'js'); });
    w.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; onErr(r && (r.message || r), 'promise'); });
    w.document.addEventListener('click', onClick, true);
  }
  function timing(w, id) {
    if (saver || !cur || cur.p !== id) return;
    try {
      var nav = w.performance.getEntriesByType('navigation')[0];
      var ms = nav && nav.loadEventStart > 0 ? nav.loadEventStart : w.performance.now();
      push({ t: 'load', p: id, ms: Math.round(ms), ttfb: nav ? Math.round(nav.responseStart) : undefined });
    } catch (x) {}
  }
  // The shell calls this on each iframe load.
  function frame(iframe, id) {
    var w;
    try { w = iframe.contentWindow; if (!w || w.location.href === 'about:blank') return; } catch (x) { return; }
    hook(w);
    timing(w, id);
  }
  api.frame = frame;
  hook(window);

  // ── screensaver ─────────────────────────────────────────────────────
  if (role === 'shell' && window.MutationObserver) {
    var watch = function () {
      var on = document.body.classList.contains('sn-saver-on');
      if (on && !saver) {
        if (cur) { closeEng(true); held = cur.p; cur = null; }
        saver = Date.now();
        push({ t: 'saver', start: 1 });
      } else if (!on && saver) {
        push({ t: 'saver', s: Math.round((Date.now() - saver) / 1000) });
        saver = 0;
        var h = held; held = '';
        if (h) page(h);
      }
    };
    if (document.body) new MutationObserver(watch).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // ── visibility and unload ───────────────────────────────────────────
  document.addEventListener('visibilitychange', function () {
    if (visible()) {
      if (cur) {
        if (S.e && S.e.p === cur.p) { undoEnd(false); cur.first = false; }
        cur.since = Date.now();
      }
    } else {
      endVisit();
      if (cur) cur.since = 0;
      flush();
    }
  });
  window.addEventListener('pagehide', function () { endVisit(); flush(); });

  if (role === 'page') {
    page(m[1]);
    if (document.readyState === 'complete') timing(window, m[1]);
    else window.addEventListener('load', function () { setTimeout(function () { timing(window, m[1]); }, 0); });
  }
})();
