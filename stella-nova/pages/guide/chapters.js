// ============================================================================
//  STATION GUIDE  ·  chapters.js — the six lesson figures
// ----------------------------------------------------------------------------
//  Each figure is one function that takes its <figure> element, makes a
//  Board (board.js), wires its own controls, and registers a frame step
//  with GD.figure. Figures read names, sprites, tags and links from the
//  catalog only. They show no quantity from the game.
//
//  The crew and foundry motion is an illustration. It is not the game's
//  task choice or production code.
//
//  SECTION MAP   (jump with grep -n "<anchor>" chapters.js)
//      shared helpers ..... "function wallRect"
//      hero station ....... "function heroFigure"
//      1 placement ........ "function placementFigure"
//      2 enclosure ........ "function enclosureFigure"
//      3 decompression .... "function decompressFigure"
//      4 foundry flow ..... "function foundryFigure"
//      4b chain strip ..... "function chainStrip"
//      5 crew ............. "function crewFigure"
//      6 tiers ............ "function tiersFigure"
// ============================================================================
(function () {
  var esc = GD.esc;
  function $(sel, root) { return (root || document).querySelector(sel); }

  // ---- shared helpers -----------------------------------------------------------
  // Wall outline of a rectangle; skip is a list of "x,y" keys to leave open.
  function wallRect(b, x0, y0, x1, y1, skip, slug) {
    skip = skip || [];
    for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) {
      if (x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      if (skip.indexOf(x + ',' + y) >= 0) continue;
      b.add(slug || 'structure-white', x, y, 0);
    }
  }
  function status(fig, html, bad) { var s = $('.fig-status', fig); s.innerHTML = html; s.classList.toggle('bad', !!bad); }
  function ores() { return GD.D.entries.filter(function (e) { return e.category === 'resources' && e.tier === 'Ores' && e.sprite; }); }
  function ingotOf(ore) {
    var id = (ore.links.usedIn || []).filter(function (i) { var e = GD.get(i); return e && e.tier === 'Ingots'; })[0];
    return id ? GD.get(id) : null;
  }
  function chip(e, extra) {
    var im = e.sprite ? '<img src="../../' + e.sprite + '" alt="">' : '<i>' + esc((e.fields && e.fields.Symbol) || e.name.charAt(0)) + '</i>';
    return '<a class="wk" href="' + GD.wiki(e.id) + '"' + (extra || '') + '>' + im + '<span>' + esc(e.name) + '</span></a>';
  }
  GD.chip = chip;
  function insideCells(b) { return Object.keys(b.enclosure().inside).map(function (s) { var p = s.split(','); return [+p[0], +p[1]]; }); }

  // ---- hero station ---------------------------------------------------------------
  function heroFigure(fig) {
    var cv = $('canvas', fig), b = new Board(cv, 22, 14);
    var X = 10, Y = 6;
    function a(t, x, y, r) { b.add(t, x + X, y + Y, r); }
    for (var x = -6; x <= 7; x++) { a('structure-white', x, -5); a('structure-white', x, 6); }
    for (var y = -4; y <= 5; y++) { if (y !== 0) a('structure-white', -6, y); if ([-3, -2, 2, 3].indexOf(y) < 0) a('structure-white', 7, y); }
    for (x = -5; x <= 6; x++) if (x !== 0 && x !== 2 && x !== 3) a('structure-white', x, 0);
    a('structure-core', 0, 0); a('foundry', 2, -1, 2); a('assembler', 7, -3); a('component-lab', 7, 2);
    a('hydroponics-garden', -5, 1); a('hydroponics-plot', 2, 2); a('hydroponics-bed', -5, -4); a('hydroponics-bed', -2, -4);
    a('research-bench', 1, -4, 1); a('docking', -2, -6); a('docking', 2, -6); a('thruster', -9, -2); a('thruster', -9, 2); a('hopper', -6, 0); a('flag-mast', 0, 7);
    GD.figure(fig, function (t) {
      b.items = [];
      b.draw(t, function (g, z) {
        // a slow scan line for life
        var yy = ((t * 0.12) % 1) * b.H;
        var gr = g.createLinearGradient(0, yy - 40, 0, yy);
        gr.addColorStop(0, 'rgba(150,200,255,0)'); gr.addColorStop(1, 'rgba(150,200,255,0.06)');
        g.fillStyle = gr; g.fillRect(0, yy - 40, b.W, 40);
      });
    });
  }

  // ---- 1 placement -------------------------------------------------------------------
  function placementFigure(fig) {
    var cv = $('canvas', fig), b = new Board(cv, 13, 8), pick = 'structure-white', rot = 0, ghost = null;
    var PAL = ['structure-white', 'docking', 'hydroponics-bed', 'foundry'];
    function seed() {
      b.clear();
      wallRect(b, 3, 1, 9, 6, ['3,4', '9,3']);
      b.add('structure-core', 3, 4);
      status(fig, 'Pick a module and tap a cell. Wall the gap on the right to seal the room for furniture.');
    }
    var pal = $('.fig-pal', fig);
    pal.innerHTML = PAL.map(function (s) {
      var t = GD.mod(s); if (!t) return '';
      return '<button class="pk" data-s="' + s + '"><img src="../../' + (s === 'structure-white' ? t.e.sprites[3] : t.e.sprites[0]) + '" alt=""><span>' + esc(t.e.name) + '</span><em>' + esc(tagLine(t)) + '</em></button>';
    }).join('');
    function tagLine(t) {
      if (t.p.furniture) return 'Furniture';
      if (t.p.exterior) return 'Exterior';
      if (t.p.interior) return 'Interior';
      if (t.p.directional) return 'Has a facing';
      return 'Structural';
    }
    function setPick(s) { pick = s; rot = 0; pal.querySelectorAll('.pk').forEach(function (x) { x.classList.toggle('on', x.dataset.s === s); }); $('[data-a=rot]', fig).disabled = !GD.mod(s).p.directional; }
    pal.addEventListener('click', function (e) { var x = e.target.closest('.pk'); if (x) setPick(x.dataset.s); });
    $('[data-a=rot]', fig).onclick = function () { rot = (rot + 1) % 4; };
    $('[data-a=reset]', fig).onclick = seed;
    function at(ev) {
      var c = b.cellAt(ev), t = GD.mod(pick), d = GD.dims(t, rot);
      return [c[0] - Math.floor((d[0] - 1) / 2), c[1] - Math.floor((d[1] - 1) / 2), c];
    }
    cv.addEventListener('pointermove', function (ev) { if (ev.pointerType !== 'mouse') return; var p = at(ev); ghost = { x: p[0], y: p[1], r: b.check(pick, p[0], p[1], rot) }; });
    cv.addEventListener('pointerleave', function () { ghost = null; });
    cv.addEventListener('click', function (ev) {
      var p = at(ev), hit = b.at(p[2][0], p[2][1]);
      if (hit) {
        if (hit.t === 'structure-core') { status(fig, 'The core is the anchor. It stays.', true); return; }
        b.removeMod(hit); status(fig, 'Removed <b>' + esc(GD.mod(hit.t).e.name) + '</b>.'); return;
      }
      var r = b.check(pick, p[0], p[1], rot);
      if (r.ok) { b.add(pick, p[0], p[1], rot); status(fig, 'Placed <b>' + esc(GD.mod(pick).e.name) + '</b>.'); }
      else status(fig, '<b>' + esc(GD.mod(pick).e.name) + '</b>: ' + esc(r.why), true);
    });
    seed(); setPick('structure-white');
    GD.figure(fig, function (t) {
      b.draw(t, function () {
        if (!ghost) return;
        var tt = GD.mod(pick), d = GD.dims(tt, rot);
        for (var j = 0; j < d[1]; j++) for (var i = 0; i < d[0]; i++) b.cellBox(ghost.x + i, ghost.y + j, ghost.r.ok ? 'rgba(110,230,170,.6)' : 'rgba(255,100,100,.7)', ghost.r.ok ? 'rgba(110,230,170,.12)' : 'rgba(255,90,90,.16)');
        if (ghost.x >= 0 && ghost.y >= 0) { b.drawModule({ t: pick, x: ghost.x, y: ghost.y, r: rot }, 0.55); b.drawFacing({ t: pick, x: ghost.x, y: ghost.y, r: rot }); }
      });
    });
  }

  // ---- 2 enclosure ---------------------------------------------------------------------
  function enclosureFigure(fig) {
    var cv = $('canvas', fig), b = new Board(cv, 13, 7), GAPS = ['6,1', '10,3', '4,5'], stock = [];
    var res = ores().slice(0, 4);
    function seed() { b.clear(); wallRect(b, 2, 1, 10, 5, GAPS); stock = []; report(); }
    function gapsOpen() { return GAPS.filter(function (s) { var p = s.split(','); return !b.at(+p[0], +p[1]); }); }
    function report() {
      var g = gapsOpen().length;
      if (b.enclosure().count) status(fig, '<b>Sealed.</b> The enclosed cells now hold storage.');
      else status(fig, g ? 'Tap the marked gaps to close the wall.' : 'The wall is open somewhere. Close it to seal the room.', false);
    }
    cv.addEventListener('click', function (ev) {
      var c = b.cellAt(ev), hit = b.at(c[0], c[1]);
      if (hit) b.removeMod(hit);
      else if (GAPS.indexOf(c.join(',')) >= 0 || b.check('structure-white', c[0], c[1], 0).ok) b.add('structure-white', c[0], c[1], 0);
      report();
    });
    $('[data-a=reset]', fig).onclick = seed;
    seed();
    var seen = '';
    GD.figure(fig, function (t) {
      var E = b.enclosure(), key = Object.keys(E.inside).join('|');
      if (key !== seen) {
        seen = key;
        // Drop one resource sprite onto each enclosed cell; remove the rest.
        b.items = insideCells(b).map(function (c, i) { return { path: res[i % res.length].sprite, x: c[0] + 0.5, y: c[1] + 0.5, s: 0.55, a: 0, born: t + i * 0.03 }; });
      }
      b.items.forEach(function (it) { it.a = Math.max(0, Math.min(1, (t - it.born) * 3)); it.rot = Math.sin(t * 1.3 + it.x) * 0.08; });
      b.draw(t, function (g, z) {
        gapsOpen().forEach(function (s) {
          var p = s.split(','), pu = 0.5 + 0.5 * Math.sin(t * 4);
          g.setLineDash([4, 3]); b.cellBox(+p[0], +p[1], 'rgba(255,200,50,' + (0.45 + pu * 0.5) + ')', 'rgba(255,200,50,' + (0.06 + pu * 0.08) + ')'); g.setLineDash([]);
        });
      });
    });
  }

  // ---- 3 decompression ------------------------------------------------------------------
  function decompressFigure(fig) {
    var cv = $('canvas', fig), b = new Board(cv, 13, 7), res = GD.D.entries.filter(function (e) { return e.category === 'resources' && e.sprite && (e.tier === 'Ingots' || e.tier === 'Alloys'); }).slice(0, 8);
    function seed() {
      b.clear(); wallRect(b, 3, 1, 9, 5);
      b.items = insideCells(b).map(function (c, i) { return { path: res[i % res.length].sprite, x: c[0] + 0.5, y: c[1] + 0.5, vx: 0, vy: 0, s: 0.6, a: 1, cell: c.join(',') }; });
      status(fig, 'Tap any wall of the sealed room.');
    }
    cv.addEventListener('click', function (ev) {
      var c = b.cellAt(ev), hit = b.at(c[0], c[1]);
      if (!hit) return;
      b.removeMod(hit);
      var E = b.enclosure(), n = 0;
      b.items.forEach(function (it) {
        if (it.vx || it.vy || E.inside[it.cell]) return;
        var dx = it.x - (c[0] + 0.5), dy = it.y - (c[1] + 0.5), d = Math.hypot(dx, dy) || 1;
        var sp = 4 + Math.random() * 5;
        // Items fly out through the breach first, then scatter.
        it.vx = (-dx / d) * sp * 0.6 + (Math.random() - 0.5) * 2; it.vy = (-dy / d) * sp * 0.6 + (Math.random() - 0.5) * 2;
        it.vr = (Math.random() - 0.5) * 6; it.delay = d * 0.05; n++;
      });
      status(fig, n ? '<b>Breach.</b> The room opened and the stock ejects into space.' : 'Removed a wall. No sealed room opened.', !!n);
    });
    $('[data-a=reset]', fig).onclick = seed;
    seed();
    GD.figure(fig, function (t, dt) {
      b.items.forEach(function (it) {
        if (!it.vx && !it.vy) { it.rot = Math.sin(t + it.x * 3) * 0.05; return; }
        if (it.delay > 0) { it.delay -= dt; return; }
        it.x += it.vx * dt; it.y += it.vy * dt; it.rot = (it.rot || 0) + it.vr * dt;
        it.vx *= 0.995; it.vy *= 0.995;
        var out = it.x < -1 || it.y < -1 || it.x > b.cols + 1 || it.y > b.rows + 1;
        if (out) it.a = 0;
      });
      b.draw(t);
    });
  }

  // ---- 4 foundry flow ---------------------------------------------------------------------
  function foundryFigure(fig) {
    var cv = $('canvas', fig), b = new Board(cv, 12, 9), F = null, all = ores(), ore = all[0], timer = 0, moving = null;
    var portrait = (GD.D.entries.filter(function (e) { return e.category === 'portraits'; })[2] || {}).sprite;
    var chips = $('.fig-pal', fig);
    chips.innerHTML = all.map(function (o, i) { return '<button class="ore' + (i === 0 ? ' on' : '') + '" data-i="' + i + '" title="' + esc(o.name) + '"><img src="../../' + o.sprite + '" alt=""><span>' + esc(o.name) + '</span></button>'; }).join('');
    chips.addEventListener('click', function (e) { var x = e.target.closest('.ore'); if (!x) return; ore = all[+x.dataset.i]; chips.querySelectorAll('.ore').forEach(function (y) { y.classList.toggle('on', y === x); }); });
    function seed() {
      b.clear();
      wallRect(b, 1, 0, 10, 8, []);
      for (var x = 2; x <= 9; x++) for (var y = 4; y <= 5; y++) if (x !== 5 && x !== 6) b.add('structure-white', x, y, 0);
      b.add('foundry', 5, 4, 2); F = b.mods[b.mods.length - 1];
      b.items = [];
      for (var i = 0; i < 5; i++) addOre([2 + i * 2 % 8, 1 + (i % 3)]);
      report();
    }
    function sideRoom(r) { return r === 0 ? 'top' : r === 2 ? 'bottom' : null; }
    function roomOf(y) { return y < 4 ? 'top' : y > 5 ? 'bottom' : null; }
    function addOre(c) {
      if (b.items.some(function (it) { return !it.fly && Math.floor(it.x) === c[0] && Math.floor(it.y) === c[1]; })) return false;
      b.items.push({ path: ore.sprite, ore: ore, x: c[0] + 0.5, y: c[1] + 0.5, s: 0.6, kind: 'ore' });
      return true;
    }
    function report() {
      var out = sideRoom(F.r);
      if (!out) status(fig, 'The output faces a wall. Rotate the foundry so that it faces a room.', true);
      else status(fig, 'Output: the <b>' + out + '</b> room. The other room feeds the foundry. Tap the input room to add ore.');
    }
    cv.addEventListener('click', function (ev) {
      var c = b.cellAt(ev), out = sideRoom(F.r), room = roomOf(c[1]);
      if (b.at(c[0], c[1])) return;
      if (!b.enclosure().inside[c.join(',')]) return;
      if (out && room === out) { status(fig, 'That is the output room. Add ore on the other side.', true); return; }
      addOre(c);
    });
    $('[data-a=rot]', fig).onclick = function () { F.r = (F.r + 1) % 4; b.rev++; report(); };
    $('[data-a=reset]', fig).onclick = seed;
    seed();
    var pIm = GD.img(portrait);
    GD.figure(fig, function (t, dt) {
      var out = sideRoom(F.r), inRoom = out === 'top' ? 'bottom' : out === 'bottom' ? 'top' : null;
      timer += dt;
      if (!moving && out && timer > 1.1) {
        timer = 0;
        var src = b.items.filter(function (it) { return it.kind === 'ore' && roomOf(Math.floor(it.y)) === inRoom; })[0];
        if (src) { moving = { it: src, t0: t, from: [src.x, src.y] }; src.fly = true; }
      }
      if (moving) {
        var k = Math.min(1, (t - moving.t0) / 0.8), fx = 6, fy = 5;
        moving.it.x = moving.from[0] + (fx - moving.from[0]) * k; moving.it.y = moving.from[1] + (fy - moving.from[1]) * k; moving.it.s = 0.6 * (1 - k * 0.6);
        if (k >= 1) {
          b.items.splice(b.items.indexOf(moving.it), 1);
          var ing = ingotOf(moving.it.ore), free = insideCells(b).filter(function (c) { return roomOf(c[1]) === out && !b.items.some(function (it) { return Math.floor(it.x) === c[0] && Math.floor(it.y) === c[1]; }); });
          if (ing && ing.sprite && free.length) {
            var dst = free[Math.floor(Math.random() * free.length)];
            b.items.push({ path: ing.sprite, x: fx, y: fy, s: 0.25, kind: 'ingot', to: [dst[0] + 0.5, dst[1] + 0.5], t0: t });
          }
          moving = null; F.glow = t;
        }
      }
      b.items.forEach(function (it) {
        if (it.to) { var q = Math.min(1, (t - it.t0) / 0.7); it.x += (it.to[0] - it.x) * q * 0.25; it.y += (it.to[1] - it.y) * q * 0.25; it.s = Math.min(0.6, it.s + dt); }
      });
      // Keep the output room from filling up: the oldest ingot fades out.
      var ing2 = b.items.filter(function (it) { return it.kind === 'ingot'; });
      if (ing2.length > 7) b.items.splice(b.items.indexOf(ing2[0]), 1);
      b.draw(t, function (g, z) {
        var glow = F.glow ? Math.max(0, 1 - (t - F.glow) * 1.5) : 0;
        if (glow > 0) { g.save(); g.globalAlpha = glow; g.shadowColor = '#ff9a4a'; g.shadowBlur = 30; g.strokeStyle = '#ffb36b'; g.lineWidth = 2; GD.rr(g, 5 * z, 4 * z, 2 * z, 2 * z, 8); g.stroke(); g.restore(); }
        // The worker with the Smelt job, docked beside the foundry on the input side.
        if (GD.ok(pIm) && inRoom) {
          var wy = inRoom === 'top' ? 3.5 : 6.5, wx = 7.5 + Math.sin(t * 2) * 0.05, r = z * 0.42;
          g.save(); g.beginPath(); g.arc(wx * z, wy * z, r, 0, 7); g.closePath(); g.clip();
          g.drawImage(pIm, wx * z - r, wy * z - r, 2 * r, 2 * r); g.restore();
          g.beginPath(); g.arc(wx * z, wy * z, r + 1.5, 0, 7); g.strokeStyle = '#ff9a4a'; g.lineWidth = 2; g.stroke();
        }
      });
    });
  }

  // ---- 4b chain strip -----------------------------------------------------------------------
  function chainStrip(el) {
    var slugs = ['foundry', 'assembler', 'component-lab', 'fuel-processor'];
    el.innerHTML = slugs.map(function (s, i) {
      var t = GD.mod(s); if (!t) return '';
      var f = t.e.fields;
      return (i ? '<span class="arrow" aria-hidden="true"><svg viewBox="0 0 24 12"><path d="M1 6h20M16 1l5 5-5 5"/></svg></span>' : '') +
        '<a class="stage-card" href="' + GD.wiki(t.e.id) + '"><span class="sc-art"><img src="../../' + t.e.sprites[0] + '" alt=""></span><b>' + esc(t.e.name) + '</b>' +
        '<small>' + esc(f.Input || '') + ' → ' + esc(f.Output || '') + '</small></a>';
    }).join('');
  }

  // ---- 5 crew ---------------------------------------------------------------------------------
  function crewFigure(fig) {
    var cv = $('canvas', fig), b = new Board(cv, 16, 9);
    var jobs = GD.D.entries.filter(function (e) { return e.category === 'jobs'; });
    var COL = { search: '#b896ff', collect: '#64c8f0', construct: '#ffc832', mine: '#ff9a4a', harvest: '#6fe0a8', metallurgy: '#ff6a6a', research: '#96c8ff' };
    // Work spots, in cell units, one per job (an illustration).
    var SPOT = { harvest: [3.5, 3.5], metallurgy: [10, 3.1], research: [6.5, 5.6], construct: [14.5, 3.5], mine: [0.9, 6.8], collect: [14.6, 7.8], search: [8, 0.4] };
    var on = {}; jobs.forEach(function (j) { on[j.slug] = true; });
    function seed() {
      b.clear();
      wallRect(b, 2, 1, 13, 7);
      b.add('hydroponics-bed', 3, 2); b.add('research-bench', 4, 4, 1); b.add('structure-core', 13, 4);
      b.mods = b.mods.filter(function (m) { return !(m.t === 'structure-white' && m.x === 13 && m.y === 4); });
      b.add('foundry', 9, 2, 2);
      b.E = null;
    }
    seed();
    var planned = [[14, 3], [14, 4]], rock = ores()[0], floaters = ores().slice(1, 4);
    var ports = GD.D.entries.filter(function (e) { return e.category === 'portraits'; }).slice(0, 6);
    var crew = ports.map(function (p, i) { return { im: GD.img(p.sprite), x: 4 + i * 1.4, y: 3 + (i % 2), job: null, wait: Math.random() * 1.5, tx: 0, ty: 0 }; });
    var chips = $('.fig-pal', fig);
    chips.innerHTML = jobs.map(function (j) { return '<button class="job on" data-j="' + j.slug + '" style="--jc:' + (COL[j.slug] || '#96c8ff') + '"><i></i>' + esc(j.name) + '</button>'; }).join('');
    chips.addEventListener('click', function (e) {
      var x = e.target.closest('.job'); if (!x) return;
      on[x.dataset.j] = !on[x.dataset.j]; x.classList.toggle('on', on[x.dataset.j]);
      crew.forEach(function (c) { if (c.job && !on[c.job]) { c.job = null; c.wait = 0; } });
      report();
    });
    function report() {
      var n = jobs.filter(function (j) { return on[j.slug]; }).length;
      status(fig, n ? 'Citizens move between the jobs that are on. Ring colour = present job.' : 'All jobs are off, so the crew idles.', !n);
    }
    report();
    GD.figure(fig, function (t, dt) {
      var live = jobs.filter(function (j) { return on[j.slug]; });
      crew.forEach(function (c, i) {
        if (!c.job || c.arrived) {
          c.wait -= dt;
          if (c.wait <= 0) {
            if (live.length) { var j = live[Math.floor(Math.random() * live.length)].slug; c.job = j; var s = SPOT[j] || [8, 4]; c.tx = s[0] + (Math.random() - 0.5) * 0.9; c.ty = s[1] + (Math.random() - 0.5) * 0.6; }
            else { c.job = null; c.tx = 5 + Math.random() * 6; c.ty = 2.5 + Math.random() * 3.5; }
            c.arrived = false; c.wait = 1.4 + Math.random() * 1.8;
          }
        }
        var dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy), sp = (c.job ? 3.2 : 0.8) * dt;
        if (d > 0.05) { c.x += dx / d * Math.min(sp, d); c.y += dy / d * Math.min(sp, d); } else c.arrived = true;
      });
      b.items = [{ path: rock.sprite, x: 0.9, y: 7.6, s: 1.5, rot: t * 0.1 }].concat(floaters.map(function (f, i) { return { path: f.sprite, x: 14.3 + i * 0.45, y: 8.2 - (i % 2) * 0.4 + Math.sin(t + i) * 0.08, s: 0.45, rot: t * (0.3 + i * 0.1) }; }));
      b.draw(t, function (g, z) {
        planned.forEach(function (p) { b.drawModule({ t: 'structure-white', x: p[0], y: p[1], r: 0 }, 0.3); g.setLineDash([3, 3]); b.cellBox(p[0], p[1], 'rgba(255,200,50,.6)'); g.setLineDash([]); });
        crew.forEach(function (c) {
          var r = z * 0.36, col = c.job ? (COL[c.job] || '#96c8ff') : '#7f91ad', X = c.x * z, Y = c.y * z;
          if (c.arrived && c.job) { g.beginPath(); g.arc(X, Y, r + 4 + 3 * Math.sin(t * 6), 0, 7); g.strokeStyle = col; g.globalAlpha = 0.35; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1; }
          g.save(); g.beginPath(); g.arc(X, Y, r, 0, 7); g.clip();
          if (GD.ok(c.im)) g.drawImage(c.im, X - r, Y - r, 2 * r, 2 * r); else { g.fillStyle = '#243040'; g.fill(); }
          g.restore();
          g.beginPath(); g.arc(X, Y, r + 1.5, 0, 7); g.strokeStyle = col; g.lineWidth = 2; g.stroke();
        });
      });
    });
  }

  // ---- 6 tiers -------------------------------------------------------------------------------------
  function tiersFigure(fig) {
    var COLS = [['Ores', ['Ores']], ['Ingots', ['Ingots']], ['Alloys', ['Alloys']], ['Components', ['Components']], ['Products', ['Propellants', 'Consumables', 'Exotics']]];
    var res = GD.D.entries.filter(function (e) { return e.category === 'resources'; });
    var grid = $('.tiers', fig), svg = $('.tier-lines', fig), det = $('.tier-detail', fig), sel = null;
    grid.innerHTML = COLS.map(function (c) {
      var list = res.filter(function (e) { return c[1].indexOf(e.tier) >= 0; });
      return '<div class="tcol' + (list.length > 12 ? ' wide' : '') + '"><h4>' + c[0] + '</h4><div class="tlist">' + list.map(function (e) {
        var im = e.sprite ? '<img src="../../' + e.sprite + '" alt="" loading="lazy">' : '<i>' + esc(e.fields.Symbol || '·') + '</i>';
        return '<button class="tn" data-id="' + e.id + '">' + im + '<span>' + esc(e.name) + '</span></button>';
      }).join('') + '</div></div>';
    }).join('');
    function walk(id, key, set) {
      var e = GD.get(id); if (!e) return;
      (e.links[key] || []).forEach(function (n) { if (n.indexOf('resources/') === 0 && !set[n]) { set[n] = id; walk(n, key, set); } });
    }
    function lines(up, down) {
      var box = grid.getBoundingClientRect(), paths = '';
      svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);
      svg.style.width = box.width + 'px'; svg.style.height = box.height + 'px';
      if (window.matchMedia('(max-width: 760px)').matches) { svg.innerHTML = ''; return; }
      function pos(id) { var n = grid.querySelector('[data-id="' + id + '"]'); if (!n) return null; var r = n.getBoundingClientRect(); return [r.left - box.left, r.top - box.top + r.height / 2, r.right - box.left]; }
      function edge(a, b2, col) {
        var p = pos(a), q = pos(b2); if (!p || !q) return;
        var x1 = p[2], y1 = p[1], x2 = q[0], y2 = q[1];
        if (x2 < x1) { x1 = p[0]; x2 = q[2]; }
        var mx = (x1 + x2) / 2;
        paths += '<path d="M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2 + '" stroke="' + col + '"/>';
      }
      // Each node in a set links to the node that reached it.
      Object.keys(up).forEach(function (n) { edge(n, up[n], 'rgba(255,200,50,.55)'); });
      Object.keys(down).forEach(function (n) { edge(down[n], n, 'rgba(111,224,168,.55)'); });
      svg.innerHTML = paths;
    }
    function select(id) {
      sel = id;
      var up = {}, down = {};
      if (id) { walk(id, 'madeFrom', up); walk(id, 'usedIn', down); }
      grid.querySelectorAll('.tn').forEach(function (n) {
        var i = n.dataset.id;
        n.className = 'tn' + (!id ? '' : i === id ? ' sel' : up[i] ? ' up' : down[i] ? ' down' : ' dim');
      });
      grid.classList.toggle('has-sel', !!id);
      lines(up, down);
      if (!id) { det.innerHTML = '<p class="fine">Select a resource. <b class="gold">Gold</b> marks what it is made from, <b class="green">green</b> marks what it feeds.</p>'; return; }
      var e = GD.get(id), mods = (e.links.usedIn || []).filter(function (x) { return x.indexOf('modules/') === 0; }).map(GD.get).filter(Boolean);
      var feeds = (e.links.usedIn || []).filter(function (x) { return x.indexOf('resources/') === 0; }).map(GD.get).filter(Boolean);
      var from = (e.links.madeFrom || []).map(GD.get).filter(Boolean), by = (e.links.unlockedBy || []).map(GD.get).filter(Boolean);
      det.innerHTML = '<div class="td-h">' + (e.sprite ? '<img src="../../' + e.sprite + '" alt="">' : '') + '<div><small>' + esc(e.tier || '') + (e.group ? ' · ' + esc(e.group) : '') + (e.fields.Symbol ? ' · ' + esc(e.fields.Symbol) : '') + '</small><h4>' + esc(e.name) + '</h4><a class="more" href="' + GD.wiki(e.id) + '">Open in the wiki →</a></div><button class="x" aria-label="Clear">×</button></div>' +
        (from.length ? '<h5>Made from</h5><div class="wks">' + from.map(function (x) { return chip(x); }).join('') + '</div>' : '') +
        (feeds.length ? '<h5>Feeds</h5><div class="wks">' + feeds.map(function (x) { return chip(x); }).join('') + '</div>' : '') +
        (mods.length ? '<h5>Builds modules</h5><div class="wks">' + mods.map(function (x) { return chip(x); }).join('') + '</div>' : '') +
        (by.length ? '<h5>Unlocked by research</h5><div class="wks">' + by.map(function (x) { return chip(x); }).join('') + '</div>' : '');
    }
    grid.addEventListener('click', function (e) { var n = e.target.closest('.tn'); if (n) select(n.dataset.id === sel ? null : n.dataset.id); });
    det.addEventListener('click', function (e) { if (e.target.closest('.x')) select(null); });
    window.addEventListener('resize', function () { if (sel) select(sel); else lines({}, {}); });
    select('resources/steel');
  }

  window.CH = { hero: heroFigure, placement: placementFigure, enclosure: enclosureFigure, decompress: decompressFigure, foundry: foundryFigure, chain: chainStrip, crew: crewFigure, tiers: tiersFigure };
})();
