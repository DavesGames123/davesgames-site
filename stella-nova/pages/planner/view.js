// ============================================================================
//  STATION PLANNER  ·  view.js — camera and canvas drawing
// ----------------------------------------------------------------------------
//  This classic script owns the camera and paints one frame from the PL
//  layout and the UI state that main.js keeps. It loads each module sprite
//  once, makes tinted copies for the wall pieces, and draws on request only
//  (VW.ask schedules one frame).
//
//  CAMERA
//      cam = {x, y, z}: x,y is the world cell at the canvas centre, z is
//      pixels per cell. screen = (world - cam) * z + half canvas size.
//
//  FRAME ORDER  (function draw)
//      space and stars ▶ grid ▶ room floors ▶ hull ▶ furniture ▶ turrets
//      ▶ facing marks ▶ labels ▶ problems ▶ selection ▶ ghost or run preview
//      The screensaver sets m.a (module alpha), UI.saver (no problem marks)
//      and UI.fade (a dark veil on top). Nothing else sets them.
//
//  WALL PIECES  (function wallPiece)
//      A one-cell structural module picks a sprite from its side contacts
//      with other solid cells: none or three or four sides = block (--4),
//      two opposite sides or one side = straight (--2), two adjacent sides
//      = corner (--1). The corner sprite joins west and south at rest.
//
//  SECTION MAP   (jump with grep -n "<anchor>" view.js)
//      sprite loading ..... "function loadSprites"
//      tint cache ......... "function tinted"
//      camera ............. "function toWorld"
//      background ......... "function drawSpace"
//      module body ........ "function drawModule"
//      wall pieces ........ "function wallPiece"
//      facing mark ........ "function drawFacing"
//      frame .............. "function draw"
// ============================================================================
(function () {
  var cv, cx, W = 0, H = 0, DPR = 1, queued = false, stars = null;
  var cam = { x: 0.5, y: 0.5, z: 34 };
  var ZMIN = 8, ZMAX = 140;

  // Per-type colour accents for tiles without a sprite, by palette section.
  var ACC = { Structure: '#9fb3cf', Production: '#ff9a4a', Research: '#96c8ff', Utility: '#ffc832', Habitat: '#6fd3a6', Decorations: '#e58bd0', Antimatter: '#b896ff' };
  function accent(t) { return ACC[t.section] || '#7f91ad'; }

  // ---- sprite loading --------------------------------------------------------
  function loadSprites() {
    PL.TYPES.forEach(function (t) {
      t.imgs = t.sprites.map(function (p) {
        var im = new Image();
        im.onload = function () { tintCache = {}; ask(); };
        im.src = '../../' + p;
        return im;
      });
      t.img = t.imgs[0] || null;
    });
  }
  function ready(im) { return im && im.complete && im.naturalWidth > 0; }

  // ---- tint cache -----------------------------------------------------------
  // A tinted copy of a sprite: the colour lies only on the sprite pixels.
  var tintCache = {};
  function tinted(im, col, a) {
    var key = im.src + '|' + col + '|' + a;
    if (tintCache[key]) return tintCache[key];
    var c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    var g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = a; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    tintCache[key] = c;
    return c;
  }

  // ---- camera ---------------------------------------------------------------
  function toWorld(sx, sy) { return [(sx - W / 2) / cam.z + cam.x, (sy - H / 2) / cam.z + cam.y]; }
  function toScreen(wx, wy) { return [(wx - cam.x) * cam.z + W / 2, (wy - cam.y) * cam.z + H / 2]; }
  function zoomAt(sx, sy, f) {
    var a = toWorld(sx, sy);
    cam.z = Math.max(ZMIN, Math.min(ZMAX, cam.z * f));
    var b = toWorld(sx, sy);
    cam.x += a[0] - b[0]; cam.y += a[1] - b[1];
    ask();
  }
  function fit() {
    var xs = [], ys = [];
    PL.S.mods.forEach(function (m) { PL.cellsOf(m).forEach(function (c) { xs.push(c[0]); ys.push(c[1]); }); });
    if (!xs.length) { cam.x = 0.5; cam.y = 0.5; cam.z = 34; ask(); return; }
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs) + 1, y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys) + 1;
    var pad = W < 600 ? 1.6 : 3;
    cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
    cam.z = Math.max(ZMIN, Math.min(64, Math.min((W - (W < 760 ? 0 : 130)) / (x1 - x0 + pad * 2), (H - (W < 760 ? 120 : 110)) / (y1 - y0 + pad * 2))));
    if (W < 760) cam.y += 30 / cam.z;
    ask();
  }

  function resize() {
    var r = cv.parentNode.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    stars = null;
    ask();
  }

  function ask() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; draw(); }); }

  // ---- background -------------------------------------------------------------
  function makeStars() {
    var c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(c.width * 0.5, c.height * 0.42, 0, c.width * 0.5, c.height * 0.5, Math.max(c.width, c.height) * 0.75);
    grd.addColorStop(0, '#111a2c'); grd.addColorStop(0.55, '#0b0f19'); grd.addColorStop(1, '#07090e');
    g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var n = Math.round(c.width * c.height / 5200);
    for (var i = 0; i < n; i++) {
      var a = rnd() * 0.55 + 0.08, s = rnd() < 0.06 ? 1.6 : 0.8;
      g.fillStyle = rnd() < 0.15 ? 'rgba(255,214,140,' + a + ')' : 'rgba(190,215,255,' + a + ')';
      g.fillRect(rnd() * c.width, rnd() * c.height, s * DPR, s * DPR);
    }
    return c;
  }
  function drawSpace() {
    if (!stars) stars = makeStars();
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.drawImage(stars, 0, 0);
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function drawGrid() {
    var z = cam.z, a = toWorld(0, 0), b = toWorld(W, H);
    var x0 = Math.floor(a[0]), x1 = Math.ceil(b[0]), y0 = Math.floor(a[1]), y1 = Math.ceil(b[1]);
    if (z >= 12) {
      cx.beginPath();
      for (var x = x0; x <= x1; x++) { var sx = Math.round(toScreen(x, 0)[0]) + 0.5; cx.moveTo(sx, 0); cx.lineTo(sx, H); }
      for (var y = y0; y <= y1; y++) { var sy = Math.round(toScreen(0, y)[1]) + 0.5; cx.moveTo(0, sy); cx.lineTo(W, sy); }
      cx.strokeStyle = 'rgba(150,200,255,' + Math.min(0.07, (z - 12) / 300 + 0.03) + ')'; cx.lineWidth = 1; cx.stroke();
    }
    cx.beginPath();
    for (x = Math.ceil(x0 / 8) * 8; x <= x1; x += 8) { sx = Math.round(toScreen(x, 0)[0]) + 0.5; cx.moveTo(sx, 0); cx.lineTo(sx, H); }
    for (y = Math.ceil(y0 / 8) * 8; y <= y1; y += 8) { sy = Math.round(toScreen(0, y)[1]) + 0.5; cx.moveTo(0, sy); cx.lineTo(W, sy); }
    cx.strokeStyle = 'rgba(150,200,255,0.1)'; cx.stroke();
    // origin cross
    var o = toScreen(0, 0);
    cx.strokeStyle = 'rgba(255,200,50,0.18)'; cx.beginPath(); cx.moveTo(o[0], 0); cx.lineTo(o[0], H); cx.moveTo(0, o[1]); cx.lineTo(W, o[1]); cx.stroke();
  }

  function drawFloors(E) {
    var z = cam.z;
    Object.keys(E.inside).forEach(function (s) {
      var p = s.split(','), x = +p[0], y = +p[1], q = toScreen(x, y);
      if (q[0] > W || q[1] > H || q[0] + z < 0 || q[1] + z < 0) return;
      cx.fillStyle = ((x + y) & 1) ? 'rgba(80,190,255,0.10)' : 'rgba(80,190,255,0.075)';
      cx.fillRect(q[0], q[1], z + 0.5, z + 0.5);
    });
  }

  // ---- module body ------------------------------------------------------------
  function rr(x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
  }
  // Draw an image centred in a screen rect after q quarter turns, kept whole.
  function blit(im, rx, ry, rw, rh, q, padF) {
    var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    var bw = (q & 1) ? rh : rw, bh = (q & 1) ? rw : rh;
    var pad = padF === undefined ? 0.04 : padF;
    var s = Math.min(bw * (1 - pad) / iw, bh * (1 - pad) / ih);
    cx.save();
    cx.translate(rx + rw / 2, ry + rh / 2);
    cx.rotate(q * Math.PI / 2);
    cx.drawImage(im, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
    cx.restore();
  }
  // One extra quarter turn when the sprite is long the other way from the
  // footprint at rest, so a tall sprite does not shrink into a wide box.
  function spriteTurn(t, im) {
    var iw = im.naturalWidth, ih = im.naturalHeight;
    if (t.w > t.h && ih > iw * 1.15) return 1;
    if (t.h > t.w && iw > ih * 1.15) return 1;
    return 0;
  }

  function wallPiece(t, m, E) {
    var s = E.solid, x = m.x, y = m.y;
    var n = !!s[PL.key(x, y - 1)], e = !!s[PL.key(x + 1, y)], so = !!s[PL.key(x, y + 1)], w = !!s[PL.key(x - 1, y)];
    var c = n + e + so + w, v = t.imgs, q = 0, im;
    if (c === 2 && n && so) { im = v[1]; q = 1; }
    else if (c === 2 && e && w) { im = v[1]; q = 0; }
    else if (c === 2) {
      im = v[0];
      if (w && so) q = 0; else if (n && w) q = 1; else if (e && n) q = 2; else q = 3;
    } else if (c === 1) { im = v[1]; q = (n || so) ? 1 : 0; }
    else im = v[3] || v[0];
    return { im: im || t.img, q: q };
  }

  var WALL_TINT = { 'structure-white': ['#c8d6ea', 0.18], 'structure-orange': ['#ff9440', 0.6], 'structure-core': ['#8f7cff', 0.5] };

  function drawModule(m, E, alpha) {
    var t = PL.T[m.t]; if (!t) return;
    var d = PL.dims(t, m.r), p = toScreen(m.x, m.y), rw = d[0] * cam.z, rh = d[1] * cam.z;
    if (p[0] > W || p[1] > H || p[0] + rw < 0 || p[1] + rh < 0) return;
    cx.globalAlpha = alpha === undefined ? 1 : alpha;
    if (t.wall && t.imgs.length >= 2 && ready(t.imgs[0])) {
      var wp = E ? wallPiece(t, m, E) : { im: t.imgs[3] || t.img, q: 0 };
      var tint = WALL_TINT[t.slug];
      var im = ready(wp.im) ? wp.im : t.img;
      blit(tint ? tinted(im, tint[0], tint[1]) : im, p[0], p[1], rw, rh, wp.q, 0);
      if (t.core) {
        cx.fillStyle = '#1a1430'; cx.font = '600 ' + Math.round(cam.z * 0.55) + 'px "Space Grotesk", sans-serif';
        cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('◉', p[0] + rw / 2, p[1] + rh / 2 + 1);
      }
    } else if (ready(t.img)) {
      var turn = spriteTurn(t, t.img);
      // Footprint plate under the sprite, so the true shape stays clear.
      rr(p[0] + 1, p[1] + 1, rw - 2, rh - 2, Math.min(8, cam.z * 0.18));
      cx.fillStyle = 'rgba(20,28,44,0.55)'; cx.fill();
      cx.strokeStyle = 'rgba(150,200,255,0.16)'; cx.lineWidth = 1; cx.stroke();
      blit(t.img, p[0], p[1], rw, rh, (m.r + turn) & 3, 0.06);
    } else {
      var col = accent(t);
      rr(p[0] + 2, p[1] + 2, rw - 4, rh - 4, Math.min(10, cam.z * 0.22));
      var g = cx.createLinearGradient(p[0], p[1], p[0] + rw, p[1] + rh);
      g.addColorStop(0, 'rgba(30,40,62,0.95)'); g.addColorStop(1, 'rgba(16,21,33,0.95)');
      cx.fillStyle = g; cx.fill();
      cx.strokeStyle = col; cx.globalAlpha *= 0.85; cx.lineWidth = 1.5; cx.stroke();
      cx.globalAlpha = alpha === undefined ? 1 : alpha;
      var fs = Math.max(9, Math.min(rw, rh) * 0.42);
      cx.font = fs + 'px "Space Grotesk", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillStyle = col;
      cx.fillText(t.symbol, p[0] + rw / 2, p[1] + rh / 2 + 1);
    }
    cx.globalAlpha = 1;
  }

  // A dark plate under the wall cells that joins each wall to its solid
  // side contacts, so a run of wall pieces reads as one hull.
  function drawHullBand(E) {
    var z = cam.z, b = z * 0.34;
    cx.fillStyle = 'rgba(120,138,168,0.6)';
    PL.S.mods.forEach(function (m) {
      var t = PL.T[m.t]; if (!t || !t.wall) return;
      var p = toScreen(m.x, m.y);
      if (p[0] > W + z || p[1] > H + z || p[0] < -2 * z || p[1] < -2 * z) return;
      var c = [p[0] + z / 2, p[1] + z / 2];
      cx.fillRect(c[0] - b, c[1] - b, 2 * b, 2 * b);
      if (E.solid[PL.key(m.x + 1, m.y)]) cx.fillRect(c[0], c[1] - b, z, 2 * b);
      if (E.solid[PL.key(m.x, m.y + 1)]) cx.fillRect(c[0] - b, c[1], 2 * b, z);
    });
  }

  // ---- facing mark ------------------------------------------------------------
  // r = 0 faces north, 1 east, 2 south, 3 west.
  function drawFacing(m, col) {
    var t = PL.T[m.t]; if (!t || !t.p.directional) return;
    var d = PL.dims(t, m.r), p = toScreen(m.x, m.y), rw = d[0] * cam.z, rh = d[1] * cam.z;
    var cxm = p[0] + rw / 2, cym = p[1] + rh / 2, s = Math.max(4, Math.min(9, cam.z * 0.22));
    var ex = [[0, -rh / 2], [rw / 2, 0], [0, rh / 2], [-rw / 2, 0]][m.r];
    cx.save();
    cx.translate(cxm + ex[0], cym + ex[1]);
    cx.rotate(m.r * Math.PI / 2);
    cx.beginPath(); cx.moveTo(0, -s * 1.1); cx.lineTo(s, s * 0.2); cx.lineTo(-s, s * 0.2); cx.closePath();
    cx.fillStyle = col || '#ffc832'; cx.shadowColor = 'rgba(255,200,50,0.6)'; cx.shadowBlur = 6; cx.fill();
    cx.restore();
  }

  function label(m) {
    var t = PL.T[m.t], d = PL.dims(t, m.r), p = toScreen(m.x, m.y), rw = d[0] * cam.z, rh = d[1] * cam.z;
    if (rw < 64 && rh < 64) return;
    var fs = Math.max(10, Math.min(13, cam.z * 0.3));
    cx.font = '500 ' + fs + 'px "IBM Plex Mono", monospace';
    var txt = t.name, tw = cx.measureText(txt).width;
    if (tw > rw - 6) return;
    var lx = p[0] + rw / 2, ly = p[1] + rh - fs * 0.9;
    rr(lx - tw / 2 - 6, ly - fs * 0.75, tw + 12, fs * 1.5, 5);
    cx.fillStyle = 'rgba(8,11,18,0.78)'; cx.fill();
    cx.fillStyle = '#eef3fb'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(txt, lx, ly + 0.5);
  }

  function outline(m, col, dash, glow) {
    var t = PL.T[m.t], d = PL.dims(t, m.r), p = toScreen(m.x, m.y), rw = d[0] * cam.z, rh = d[1] * cam.z;
    cx.save();
    rr(p[0] - 1.5, p[1] - 1.5, rw + 3, rh + 3, Math.min(10, cam.z * 0.2));
    cx.setLineDash(dash || []); cx.lineWidth = 2; cx.strokeStyle = col;
    if (glow) { cx.shadowColor = col; cx.shadowBlur = 12; }
    cx.stroke(); cx.restore();
  }

  function cellBox(x, y, ok) {
    var q = toScreen(x, y), z = cam.z;
    cx.fillStyle = ok ? 'rgba(110,230,170,0.14)' : 'rgba(255,90,90,0.2)';
    cx.fillRect(q[0] + 1, q[1] + 1, z - 2, z - 2);
    cx.strokeStyle = ok ? 'rgba(110,230,170,0.55)' : 'rgba(255,100,100,0.7)';
    cx.lineWidth = 1; cx.strokeRect(q[0] + 1.5, q[1] + 1.5, z - 3, z - 3);
  }

  // ---- frame ---------------------------------------------------------------------
  function draw() {
    if (!cv) return;
    var U = window.UI || {}, vis = U.visible || { hull: true, furniture: true, turret: true };
    drawSpace();
    drawGrid();
    var E = PL.enclosure();
    drawFloors(E);
    var movingU = U.drag && U.drag.kind === 'move' ? U.drag.m.u : 0;
    if (vis.hull) drawHullBand(E);
    ['hull', 'furniture', 'turret'].forEach(function (L) {
      if (!vis[L]) return;
      PL.S.mods.forEach(function (m) {
        var t = PL.T[m.t]; if (!t || t.layer !== L) return;
        drawModule(m, E, m.u === movingU ? 0.25 : (U.dimOthers && U.dimOthers !== L ? 0.4 : m.a === undefined ? 1 : m.a));
      });
    });
    PL.S.mods.forEach(function (m) { var t = PL.T[m.t]; if (t && vis[t.layer] && m.u !== movingU && !(m.a < 0.95)) drawFacing(m); });
    if (cam.z >= 26) PL.S.mods.forEach(function (m) { var t = PL.T[m.t]; if (t && vis[t.layer] && !t.wall && m.u !== movingU && !(m.a < 0.95)) label(m); });
    if (!U.saver) PL.problems().forEach(function (pr) { if (vis[PL.T[pr.m.t].layer]) outline(pr.m, 'rgba(255,96,96,0.9)', [5, 4]); });
    if (U.hoverU && U.tool !== 'build') { var hm = PL.find(U.hoverU); if (hm) outline(hm, U.tool === 'erase' ? 'rgba(255,96,96,0.95)' : 'rgba(150,200,255,0.65)'); }
    if (U.sel) { var sm = PL.find(U.sel); if (sm && sm.u !== movingU) outline(sm, '#ffc832', null, true); }
    // Ghost of the module to place, or of a module in a move.
    var gh = U.ghost;
    if (gh) {
      var t = PL.T[gh.t], d = PL.dims(t, gh.r);
      for (var j = 0; j < d[1]; j++) for (var i = 0; i < d[0]; i++) cellBox(gh.x + i, gh.y + j, gh.ok);
      drawModule({ t: gh.t, x: gh.x, y: gh.y, r: gh.r }, null, 0.72);
      drawFacing({ t: gh.t, x: gh.x, y: gh.y, r: gh.r }, gh.ok ? '#ffc832' : '#ff6060');
    }
    if (U.run) U.run.cells.forEach(function (c) { cellBox(c[0], c[1], c[2]); if (c[2]) drawModule({ t: U.run.t, x: c[0], y: c[1], r: 0 }, null, 0.6); });
    if (U.fade > 0) { cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = 'rgba(7,9,14,' + U.fade + ')'; cx.fillRect(0, 0, cv.width, cv.height); cx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  }

  function init(canvas) {
    cv = canvas; cx = cv.getContext('2d');
    loadSprites();
    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(cv.parentNode);
  }

  window.VW = {
    init: init, ask: ask, cam: cam, toWorld: toWorld, toScreen: toScreen, zoomAt: zoomAt, fit: fit,
    size: function () { return [W, H]; }, accent: accent, ready: ready, spriteTurn: spriteTurn
  };
})();
