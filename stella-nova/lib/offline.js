// ============================================================================
//  OFFLINE  ·  registers the service worker and shows the live-data notice
// ----------------------------------------------------------------------------
//  Classic script. The shell (stella-nova/index.html) loads it last.
//
//  1. Registers ../sw.js with the site root as scope. The worker keeps the
//     whole site in Cache Storage (see the sw.js header). On file:// and
//     in browsers with no service worker, this script does nothing. On a
//     local server (localhost, 127.0.0.1) it unregisters the worker, unless
//     the shell URL had ?sw=1 once (?sw=0 undoes it). Then it registers
//     ../sw.js?local=1. Edits on disk are not in the manifest index hashes,
//     so a cache-first worker would hide them from a dev server.
//  2. When the worker is active and the shell has loaded, it waits
//     WARM_DELAY_MS, then sends { type: 'sn-warm' }. The worker then
//     downloads the lazy files (meshes, photos, big data) in the
//     background. It does not send the message when the browser asks to
//     save data or the connection is 3g or slower: then each lazy file is
//     kept when a page first asks for it.
//  3. When a live-data request fails and the worker answers with its last
//     good copy, the worker posts { type: 'sn-live-fallback' }. This script
//     shows a notice with the source and the date of that copy.
//
//  4. A new worker version takes control at once (skipWaiting in sw.js).
//     The shell code in an open tab (lib/*.js, among them the screensaver
//     recorder) is then the old version. If the tab had a worker before
//     and the shell loaded less than RELOAD_WINDOW_MS ago, the shell
//     reloads at once: that is the first load after a deploy, before the
//     user has done anything. Later it does not reload by itself. It sets
//     snOffline.stale, and the screensaver reloads before it records
//     (lib/screensaver.js startFromMenu). Page swaps get the new files.
//
//  window.snOffline.status() gives a promise of the worker cache counts:
//  { version, core, coreTotal, lazy, lazyTotal, warming }. Test scripts use it.
//
//  grep -n targets
//    register ............. "serviceWorker.register"
//    background pass ...... "function warmLater"
//    live-data notice ..... "function showLiveNotice"
//    new version .......... "function onNewWorker"
// ============================================================================
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  var SW = navigator.serviceWorker;
  var WARM_DELAY_MS = 8000;
  var RELOAD_WINDOW_MS = 30000;
  var T0 = Date.now();
  var stale = false;
  var base = document.baseURI;

  // Local server: no worker unless opted in, so edits on disk show at once.
  // ?sw=1 on the shell URL opts in (kept in localStorage), ?sw=0 opts out.
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var optIn = false;
  try {
    if (/[?&]sw=1(&|$)/.test(location.search)) localStorage.setItem('sn-sw-local', '1');
    if (/[?&]sw=0(&|$)/.test(location.search)) localStorage.removeItem('sn-sw-local');
    optIn = localStorage.getItem('sn-sw-local') === '1';
  } catch (e) {}
  if (LOCAL && !optIn) {
    SW.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
    return;
  }

  window.snOffline = {
    get stale() { return stale; },
    status: function () {
      return SW.ready.then(function (reg) {
        return new Promise(function (resolve) {
          var ch = new MessageChannel();
          ch.port1.onmessage = function (e) { resolve(e.data); };
          reg.active.postMessage({ type: 'sn-status' }, [ch.port2]);
        });
      });
    }
  };

  function slowLink() {
    var c = navigator.connection;
    return !!(c && (c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType || '')));
  }

  function warmLater() {
    if (slowLink()) return;
    SW.ready.then(function (reg) {
      setTimeout(function () { if (reg.active) reg.active.postMessage({ type: 'sn-warm' }); }, WARM_DELAY_MS);
    });
  }

  var notice = null, noticeTimer = 0;
  function showLiveNotice(d) {
    var src = d.url;
    try { var u = new URL(d.url); src = u.origin === location.origin ? u.pathname.split('/').slice(-3).join('/') : u.hostname; } catch (e) {}
    var when = d.saved ? new Date(d.saved).toLocaleString() : 'an earlier visit';
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'sn-offline-notice';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;max-width:min(420px,calc(100vw - 24px));' +
        'padding:8px 12px;border-radius:8px;background:rgba(10,12,18,.92);color:#e8ecf4;border:1px solid rgba(255,200,120,.45);' +
        'font:12px/1.4 system-ui,sans-serif;pointer-events:none';
      document.body.appendChild(notice);
    }
    notice.textContent = 'Offline: live data from ' + src + ' is the saved copy from ' + when + '.';
    notice.style.display = 'block';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { notice.style.display = 'none'; }, 10000);
  }

  SW.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'sn-live-fallback') showLiveNotice(e.data);
  });
  // addEventListener does not start the client message queue (onmessage
  // does). Without this call the notice waits until the load event.
  SW.startMessages();

  // A tab with no worker at load gets its first one now: its code is
  // current, so only a change from one worker to another counts.
  var hadWorker = !!SW.controller;
  function onNewWorker() {
    if (!hadWorker) { hadWorker = true; return; }
    stale = true;
    var saver = window.snScreensaver && window.snScreensaver.running;
    if (!saver && Date.now() - T0 < RELOAD_WINDOW_MS) location.reload();
  }
  SW.addEventListener('controllerchange', onNewWorker);

  function register() {
    SW.register(new URL(LOCAL ? '../sw.js?local=1' : '../sw.js', base).href, { scope: new URL('../', base).href })
      .then(warmLater)
      .catch(function (err) { console.warn('service worker not registered:', err && err.message); });
  }
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
})();
