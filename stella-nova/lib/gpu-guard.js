// ============================================================================
//  GPU GUARD  ·  lib/gpu-guard.js — release a page's GPU work on demand
// ────────────────────────────────────────────────────────────────────────────
//  The shell (stella-nova/index.html) shows each page in one iframe and swaps
//  it on every nav click. A fast series of clicks crashed the site in Safari:
//  the old pages kept their WebGPU devices and WebGL contexts until garbage
//  collection, and Safari's GPU process ran out of memory first.
//
//  This classic script loads FIRST in every page, before the page's own code.
//  It records every WebGPU device and WebGL context the page makes, and
//  window.__snRelease() frees them all at once:
//    - each GPUDevice gets destroy()
//    - each WebGL context gets WEBGL_lose_context.loseContext()
//    - requestAnimationFrame stops scheduling, so frame loops end
//  The shell calls __snRelease before it unloads a page (releaseFrame), and
//  the guard also runs it on pagehide. A device that resolves after release
//  is destroyed at once. Pages need no change and keep their own cleanup.
//
//  It also stops text selection on canvas, svg and video (see the end).
//
//  grep: function release  requestDevice  getContext  requestAnimationFrame  selectstart
// ============================================================================
(function () {
  if (window.__snGuard) return;
  window.__snGuard = true;
  var devices = new Set();
  var contexts = new Set();
  var released = false;
  var GL = /^(webgl|webgl2|experimental-webgl)$/;

  var A = window.GPUAdapter && window.GPUAdapter.prototype;
  if (A && A.requestDevice) {
    var requestDevice = A.requestDevice;
    A.requestDevice = function () {
      return requestDevice.apply(this, arguments).then(function (device) {
        if (released) { try { device.destroy(); } catch (e) {} }
        else devices.add(device);
        return device;
      });
    };
  }

  function wrapGetContext(proto) {
    if (!proto || !proto.getContext) return;
    var getContext = proto.getContext;
    proto.getContext = function (type) {
      var ctx = getContext.apply(this, arguments);
      if (ctx && GL.test(type)) contexts.add(ctx);
      return ctx;
    };
  }
  wrapGetContext(window.HTMLCanvasElement && window.HTMLCanvasElement.prototype);
  wrapGetContext(window.OffscreenCanvas && window.OffscreenCanvas.prototype);

  var raf = window.requestAnimationFrame;
  if (raf) {
    window.requestAnimationFrame = function (cb) {
      return released ? 0 : raf.call(window, cb);
    };
  }

  function release() {
    if (released) return;
    released = true;
    devices.forEach(function (d) { try { d.destroy(); } catch (e) {} });
    devices.clear();
    contexts.forEach(function (c) {
      try { var x = c.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {}
    });
    contexts.clear();
  }

  window.__snRelease = release;
  window.__snGuardStats = function () { return { devices: devices.size, contexts: contexts.size, released: released }; };
  window.addEventListener('pagehide', release);

  // No highlight on visualizations. A drag or double-click on a canvas,
  // svg or video must not start a text selection, and a long press must
  // not open the iOS callout. The guard loads first in every page, so
  // this rule reaches every visualization. Text in inputs is not changed.
  var css = document.createElement('style');
  css.textContent = 'canvas,svg,video{-webkit-user-select:none;user-select:none;' +
    '-webkit-touch-callout:none;-webkit-user-drag:none;-webkit-tap-highlight-color:transparent}';
  (document.head || document.documentElement).appendChild(css);
  document.addEventListener('selectstart', function (e) {
    var t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (t && t.closest && t.closest('canvas,svg,video')) e.preventDefault();
  }, true);
})();
