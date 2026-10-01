// ============================================================================
//  STATION GUIDE  ·  board.js — a small grid board for the lesson figures
// ----------------------------------------------------------------------------
//  This classic script gives each figure one Board: a fixed grid of cells
//  on a 2D canvas. A board holds placed modules, free items (resource
//  sprites that drift or fly), and draws them with the real catalog sprites.
//  It knows the same planner rules as the Station Planner page, written
//  again here so the two pages stay independent:
//      overlap · attach to the hull · furniture on enclosed floor ·
//      interior (no open side) · exterior (one open side)
//  The rules come from the catalog placement tags. They are a teaching
//  aid, not the game's own rule code.
//
//  ENCLOSURE
//      A flood fill starts on the board edge and moves through cells that
//      no hull module holds. Each empty cell that it does not reach is
//      enclosed. The board edge counts as open space.
//
//  SECTION MAP   (jump with grep -n "<anchor>" board.js)
//      catalog lookup ..... "var GD ="
//      sprite cache ....... "function img"
//      board object ....... "function Board"
//      enclosure .......... "Board.prototype.enclosure"
//      rules .............. "Board.prototype.check"
//      drawing ............ "Board.prototype.draw"
//      wall pieces ........ "function wallPiece"
//      frame loop ......... "function loop"
// ============================================================================
(function () {
  var D = window.SN_DATA || { entries: [] };
  var byId = {};
  D.entries.forEach(function (e) { byId[e.id] = e; });

  // ---- catalog lookup --------------------------------------------------------
  var GD = window.GD = {
    D: D, byId: byId,
    get: function (id) { return byId[id] || null; },
    mod: function (slug) {
      var e = byId['modules/' + slug]; if (!e) return null;
      if (e._t) return e._t;
      var w = 1, h = 1;
      e.placement.footprint.forEach(function (c) { w = Math.max(w, c[0] + 1); h = Math.max(h, c[1] + 1); });
      var p = e.placement;
      e._t = { slug: slug, e: e, w: w, h: h, p: p, layer: p.furniture ? 'furniture' : (p.turret ? 'turret' : 'hull'), wall: p.structural && w === 1 && h === 1 };
      return e._t;
    },
    wiki: function (id) { return '../wiki/index.html#/e/' + encodeURIComponent(id); },
    esc: function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  };

  // ---- sprite cache ------------------------------------------------------------
  var cache = {}, tints = {};
  function img(path) {
    if (!path) return null;
    if (cache[path]) return cache[path];
    var im = new Image();
    im.src = '../../' + path;
    cache[path] = im;
    return im;
  }
  function ok(im) { return im && im.complete && im.naturalWidth > 0; }
  function tinted(im, col, a) {
    var key = im.src + col + a;
    if (tints[key]) return tints[key];
    var c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    var g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    g.globalCompositeOperation = 'source-atop'; g.globalAlpha = a; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    tints[key] = c;
    return c;
  }
  GD.img = img; GD.ok = ok;

  function k(x, y) { return x + ',' + y; }
  function dims(t, r) { return (r & 1) ? [t.h, t.w] : [t.w, t.h]; }
  GD.dims = dims; GD.key = k;

  // ---- board object --------------------------------------------------------------
  function Board(canvas, cols, rows) {
    this.cv = canvas; this.cx = canvas.getContext('2d');
    this.cols = cols; this.rows = rows; this.cell = 32;
    this.mods = []; this.items = []; this.marks = {}; this.rev = 0; this.E = null;
    this.visible = true;
    this.resize();
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(canvas.parentNode);
    else window.addEventListener('resize', function () { self.resize(); });
  }
  Board.prototype.resize = function () {
    var w = this.cv.parentNode.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cell = Math.max(14, Math.floor(w / this.cols));
    this.W = this.cell * this.cols; this.H = this.cell * this.rows;
    this.cv.width = this.W * dpr; this.cv.height = this.H * dpr;
    this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    this.dpr = dpr;
  };
  Board.prototype.add = function (slug, x, y, r) { this.mods.push({ t: slug, x: x, y: y, r: r || 0 }); this.rev++; this.E = null; };
  Board.prototype.clear = function () { this.mods = []; this.items = []; this.rev++; this.E = null; };
  Board.prototype.cellsOf = function (m) {
    var t = GD.mod(m.t), d = dims(t, m.r), out = [];
    for (var y = 0; y < d[1]; y++) for (var x = 0; x < d[0]; x++) out.push([m.x + x, m.y + y]);
    return out;
  };
  Board.prototype.at = function (x, y) {
    for (var i = this.mods.length - 1; i >= 0; i--) {
      var m = this.mods[i], t = GD.mod(m.t), d = dims(t, m.r);
      if (x >= m.x && y >= m.y && x < m.x + d[0] && y < m.y + d[1]) return m;
    }
    return null;
  };
  Board.prototype.removeMod = function (m) { this.mods = this.mods.filter(function (q) { return q !== m; }); this.rev++; this.E = null; };
  Board.prototype.cellAt = function (ev) {
    var r = this.cv.getBoundingClientRect();
    return [Math.floor((ev.clientX - r.left) / this.cell), Math.floor((ev.clientY - r.top) / this.cell)];
  };

  // ---- enclosure -------------------------------------------------------------------
  Board.prototype.enclosure = function () {
    if (this.E) return this.E;
    var solid = {}, any = {}, self = this;
    this.mods.forEach(function (m) {
      var t = GD.mod(m.t);
      self.cellsOf(m).forEach(function (c) { any[k(c[0], c[1])] = m; if (t.layer !== 'furniture') solid[k(c[0], c[1])] = 1; });
    });
    var out = {}, q = [], C = this.cols, R = this.rows;
    function push(x, y) { var s = k(x, y); if (x < 0 || y < 0 || x >= C || y >= R || out[s] || solid[s]) return; out[s] = 1; q.push([x, y]); }
    for (var x = 0; x < C; x++) { push(x, 0); push(x, R - 1); }
    for (var y = 0; y < R; y++) { push(0, y); push(C - 1, y); }
    while (q.length) { var p = q.pop(); push(p[0] + 1, p[1]); push(p[0] - 1, p[1]); push(p[0], p[1] + 1); push(p[0], p[1] - 1); }
    var inside = {}, n = 0;
    for (y = 0; y < R; y++) for (x = 0; x < C; x++) { var s = k(x, y); if (!out[s] && !solid[s]) { inside[s] = 1; n++; } }
    this.E = { solid: solid, any: any, inside: inside, count: n };
    return this.E;
  };
  Board.prototype.open = function (x, y) {
    var E = this.enclosure(), s = k(x, y);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return true;
    return !E.solid[s] && !E.inside[s];
  };

  // ---- rules -------------------------------------------------------------------------
  Board.prototype.check = function (slug, x, y, r) {
    var t = GD.mod(slug), d = dims(t, r), E = this.enclosure(), cells = [], mine = {}, i, self = this;
    for (var j = 0; j < d[1]; j++) for (i = 0; i < d[0]; i++) { cells.push([x + i, y + j]); mine[k(x + i, y + j)] = 1; }
    for (i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c[0] < 0 || c[1] < 0 || c[0] >= this.cols || c[1] >= this.rows) return { ok: false, why: 'Off the board' };
      if (E.any[k(c[0], c[1])]) return { ok: false, why: 'Cell already in use' };
    }
    if (t.layer === 'furniture') {
      for (i = 0; i < cells.length; i++) if (!E.inside[k(cells[i][0], cells[i][1])]) return { ok: false, why: 'Furniture needs enclosed floor' };
      return { ok: true };
    }
    var ring = [];
    cells.forEach(function (c) { [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) { var nx = c[0] + dd[0], ny = c[1] + dd[1]; if (!mine[k(nx, ny)]) ring.push([nx, ny]); }); });
    if (Object.keys(E.solid).length && !ring.some(function (c) { return E.solid[k(c[0], c[1])]; })) return { ok: false, why: 'Must touch the station' };
    if (t.p.interior && ring.some(function (c) { return self.open(c[0], c[1]); })) return { ok: false, why: 'Interior: must be inside walls' };
    if (t.p.exterior && !ring.some(function (c) { return self.open(c[0], c[1]); })) return { ok: false, why: 'Exterior: must touch open space' };
    return { ok: true };
  };

  // ---- drawing -------------------------------------------------------------------------
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  GD.rr = rr;
  function blit(g, im, rx, ry, rw, rh, q, pad) {
    var iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    var bw = (q & 1) ? rh : rw, bh = (q & 1) ? rw : rh, s = Math.min(bw * (1 - pad) / iw, bh * (1 - pad) / ih);
    g.save(); g.translate(rx + rw / 2, ry + rh / 2); g.rotate(q * Math.PI / 2);
    g.drawImage(im, -iw * s / 2, -ih * s / 2, iw * s, ih * s); g.restore();
  }
  GD.blit = blit;
  // Wall piece by side contacts: block, straight or corner (corner joins W+S at rest).
  function wallPiece(sprites, s, x, y) {
    var n = !!s[k(x, y - 1)], e = !!s[k(x + 1, y)], so = !!s[k(x, y + 1)], w = !!s[k(x - 1, y)], c = n + e + so + w;
    if (c === 2 && n && so) return [sprites[1], 1];
    if (c === 2 && e && w) return [sprites[1], 0];
    if (c === 2) return [sprites[0], (w && so) ? 0 : (n && w) ? 1 : (e && n) ? 2 : 3];
    if (c === 1) return [sprites[1], (n || so) ? 1 : 0];
    return [sprites[3] || sprites[0], 0];
  }
  var TINT = { 'structure-white': ['#c8d6ea', 0.18], 'structure-core': ['#8f7cff', 0.5] };

  Board.prototype.drawModule = function (m, alpha) {
    var g = this.cx, t = GD.mod(m.t), d = dims(t, m.r), z = this.cell, px = m.x * z, py = m.y * z, rw = d[0] * z, rh = d[1] * z;
    var E = this.enclosure(), sp = t.e.sprites;
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    if (t.wall && sp.length >= 2) {
      var wp = wallPiece(sp, E.solid, m.x, m.y), im = img(wp[0]);
      if (ok(im)) { var tt = TINT[t.slug]; blit(g, tt ? tinted(im, tt[0], tt[1]) : im, px, py, rw, rh, wp[1], 0); }
      if (t.slug === 'structure-core') { g.fillStyle = '#1a1430'; g.font = '600 ' + Math.round(z * 0.55) + 'px "Space Grotesk", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('◉', px + rw / 2, py + rh / 2 + 1); }
    } else if (sp.length && ok(img(sp[0]))) {
      var si = img(sp[0]), turn = (t.w > t.h && si.naturalHeight > si.naturalWidth * 1.15) || (t.h > t.w && si.naturalWidth > si.naturalHeight * 1.15) ? 1 : 0;
      rr(g, px + 1, py + 1, rw - 2, rh - 2, Math.min(8, z * 0.18)); g.fillStyle = 'rgba(20,28,44,0.55)'; g.fill();
      blit(g, si, px, py, rw, rh, (m.r + turn) & 3, 0.06);
    } else {
      rr(g, px + 2, py + 2, rw - 4, rh - 4, 6); g.fillStyle = 'rgba(24,32,50,0.95)'; g.fill();
      g.strokeStyle = '#96c8ff'; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = '#96c8ff'; g.font = Math.round(Math.min(rw, rh) * 0.45) + 'px "Space Grotesk", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t.e.fields.Symbol || '◇', px + rw / 2, py + rh / 2 + 1);
    }
    g.globalAlpha = 1;
  };
  // Facing mark: r 0 north, 1 east, 2 south, 3 west.
  Board.prototype.drawFacing = function (m, col) {
    var g = this.cx, t = GD.mod(m.t); if (!t.p.directional) return;
    var d = dims(t, m.r), z = this.cell, rw = d[0] * z, rh = d[1] * z, cx = m.x * z + rw / 2, cy = m.y * z + rh / 2, s = Math.max(4, z * 0.2);
    var ex = [[0, -rh / 2], [rw / 2, 0], [0, rh / 2], [-rw / 2, 0]][m.r];
    g.save(); g.translate(cx + ex[0], cy + ex[1]); g.rotate(m.r * Math.PI / 2);
    g.beginPath(); g.moveTo(0, -s * 1.1); g.lineTo(s, s * 0.2); g.lineTo(-s, s * 0.2); g.closePath();
    g.fillStyle = col || '#ffc832'; g.shadowColor = 'rgba(255,200,50,0.6)'; g.shadowBlur = 6; g.fill(); g.restore();
  };
  Board.prototype.cellBox = function (x, y, col, fill) {
    var g = this.cx, z = this.cell;
    if (fill) { g.fillStyle = fill; g.fillRect(x * z + 1, y * z + 1, z - 2, z - 2); }
    g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(x * z + 1.5, y * z + 1.5, z - 3, z - 3);
  };

  Board.prototype.draw = function (t, after) {
    var g = this.cx, z = this.cell, W = this.W, H = this.H, E = this.enclosure(), self = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var grd = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    grd.addColorStop(0, '#111a2c'); grd.addColorStop(1, '#07090e');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // stars, fixed per board
    if (!this.stars) { var s = 11 + this.cols * 7 + this.rows, st = []; for (var i = 0; i < 70; i++) { s = (s * 16807) % 2147483647; var a = s / 2147483647; s = (s * 16807) % 2147483647; st.push([a, s / 2147483647, (i % 5) / 10 + 0.1]); } this.stars = st; }
    this.stars.forEach(function (p) { g.fillStyle = 'rgba(190,215,255,' + p[2] + ')'; g.fillRect(p[0] * W, p[1] * H, 1, 1); });
    g.beginPath();
    for (var x = 0; x <= this.cols; x++) { g.moveTo(x * z + 0.5, 0); g.lineTo(x * z + 0.5, H); }
    for (var y = 0; y <= this.rows; y++) { g.moveTo(0, y * z + 0.5); g.lineTo(W, y * z + 0.5); }
    g.strokeStyle = 'rgba(150,200,255,0.06)'; g.lineWidth = 1; g.stroke();
    Object.keys(E.inside).forEach(function (s) {
      var p = s.split(','), cx0 = +p[0], cy0 = +p[1];
      g.fillStyle = ((cx0 + cy0) & 1) ? 'rgba(80,190,255,0.13)' : 'rgba(80,190,255,0.09)';
      g.fillRect(cx0 * z, cy0 * z, z, z);
    });
    // hull band joins wall pieces
    g.fillStyle = 'rgba(120,138,168,0.6)';
    var b = z * 0.34;
    this.mods.forEach(function (m) {
      var tt = GD.mod(m.t); if (!tt.wall) return;
      var c = [m.x * z + z / 2, m.y * z + z / 2];
      g.fillRect(c[0] - b, c[1] - b, 2 * b, 2 * b);
      if (E.solid[k(m.x + 1, m.y)]) g.fillRect(c[0], c[1] - b, z, 2 * b);
      if (E.solid[k(m.x, m.y + 1)]) g.fillRect(c[0] - b, c[1], 2 * b, z);
    });
    ['hull', 'turret', 'furniture'].forEach(function (L) { self.mods.forEach(function (m) { if (GD.mod(m.t).layer === L) self.drawModule(m, m.alpha); }); });
    this.mods.forEach(function (m) { self.drawFacing(m); });
    // free items
    this.items.forEach(function (it) {
      var im = img(it.path); if (!ok(im)) return;
      var sz = z * (it.s || 0.62);
      g.save(); g.globalAlpha = it.a === undefined ? 1 : it.a; g.translate(it.x * z, it.y * z); g.rotate(it.rot || 0);
      var sc = Math.min(sz / im.naturalWidth, sz / im.naturalHeight);
      g.drawImage(im, -im.naturalWidth * sc / 2, -im.naturalHeight * sc / 2, im.naturalWidth * sc, im.naturalHeight * sc);
      g.restore();
    });
    if (after) after(g, z, t);
  };

  // ---- frame loop ---------------------------------------------------------------------
  // Each figure registers a step(t, dt) function. Only figures on screen run.
  var figs = [];
  GD.figure = function (el, step) {
    var f = { el: el, step: step, on: true };
    figs.push(f);
    if (window.IntersectionObserver) new IntersectionObserver(function (es) { es.forEach(function (e) { f.on = e.isIntersecting; }); }, { rootMargin: '120px' }).observe(el);
    return f;
  };
  var last = 0;
  function loop(t) {
    var dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t;
    figs.forEach(function (f) { if (f.on) f.step(t / 1000, dt); });
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.Board = Board;
})();
