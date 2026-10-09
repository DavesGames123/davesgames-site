// ============================================================================
//  NEURON LAB  ·  saver.js  ·  screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter(opts) hides the page UI, keeps the
//  WebGL canvas (#view) and returns it. A seeded shot plan
//  (engine/shots.js LAB_SHOTS) cuts every 6 to 12 s with no shot twice in
//  a row:
//    bap      close-up on a dendrite while soma spikes run back into it
//    orbit    the whole cell turning, synapses firing far out
//    synapse  a distal Exp2Syn, the camera drifts back toward the soma
//    phase    tonic firing; a V-n phase plane on a board next to the cell
//    gates    tonic firing; m, h, n on the board
//    axon     the camera rides the spike down the axon
//    netchain   six full cells in a line; the camera follows the spike
//               from cell to cell down the chain (netmode.js, DEMOS.chain)
//    netring    one kick, a ring that keeps itself going; a slow orbit
//    netinhibit a ring with one inhibitory cell that silences it
//    netrandom  random cells and random wiring, the raster on a board
//  Network shots run the Network mode (netmode.js); a one-cell shot turns
//  it off. exit() puts back the mode the user had.
//  The camera is on springs the whole time (stage.hold), so it moves with
//  a continuous velocity. The subject sits in the clear band between the
//  plate texts (lib/saver-clear.js plateBand). Plates carry TeX, no code.
//
//  grep -n targets
//    "const SETUP"       per-shot cell, stimuli and camera
//    "function tick"     per-frame shot logic
//    "function board"    the plot board (a camera child plane)
// ============================================================================
import { LAB_SHOTS, shotPlan } from './engine/shots.js';
import { rng } from './engine/rng.js';
import { plateBand } from '../../lib/saver-clear.js';

const TONIC = { pyramidal: 1.5, purkinje: 1.5, motor: 7, granule: 0.06 };
const PULSE = { pyramidal: 1.5, purkinje: 2.5, motor: 6, granule: 0.15 };
const smooth = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

export function installSaver(A) {
  const { L, P, stage, THREE } = A;
  let run = null;

  // the plot board: a plane in front of the camera, drawn from a 2D canvas
  function board() {
    if (run.board) return run.board;
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 620;
    cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:450px;height:310px';
    document.body.appendChild(cv);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.renderOrder = 10; mesh.visible = false;
    stage.camera.add(mesh);
    if (!stage.camera.parent) stage.scene.add(stage.camera);
    run.board = { cv, tex, mesh };
    return run.board;
  }
  // place the board over a rect of the rendered canvas (CSS px)
  function placeBoard(x0, y0, x1, y1) {
    const b = run.board, cam = stage.camera, W = stage.W, H = stage.H, D = 50;
    const ox = cam.view && cam.view.enabled ? cam.view.offsetX : 0, oy = cam.view && cam.view.enabled ? cam.view.offsetY : 0;
    const th = Math.tan(cam.fov * Math.PI / 360) * D, tw = th * cam.aspect;
    const toX = px => ((px + ox) / W * 2 - 1) * tw, toY = py => (1 - (py + oy) / H * 2) * th;
    const ax = toX(x0), bx = toX(x1), ay = toY(y0), by = toY(y1);
    b.mesh.position.set((ax + bx) / 2, (ay + by) / 2, -D);
    b.mesh.scale.set(bx - ax, ay - by, 1);
  }

  const band = () => {
    const H = stage.H, W = stage.W, pb = run.label ? plateBand(H) : null;
    return { x0: 0, x1: W, y0: pb ? pb.t : 0, y1: H - (pb ? pb.b : 0) };
  };
  const nodePos = i => [L.cell.pos[i * 3], L.cell.pos[i * 3 + 1], L.cell.pos[i * 3 + 2]];
  const isDend = k => k !== 'axon' && k !== 'ais' && k !== 'soma';
  const fovK = () => 1 / Math.tan(stage.camera.fov * Math.PI / 360);

  const NET = A.NET;
  function netOff() { if (NET && NET.on) NET.disable({ hash: false }); }
  function loadType(type, seed) {
    netOff();
    P.type = type; P.seed = seed; P.dfrac = 0.35; P.hold = false;
    A.loadCell({ keep: false, defaults: false, fit: false });
    A.clearMarkers(true);
  }
  function clamp(node, amp, hold) {
    const m = A.place('iclamp', node, true);
    if (hold) { m.pp.del = L.cell.t; m.pp.dur = 1e9; m.pp.amp = amp; }
    return m;
  }
  function pulse(m, amp, dur = 2) { m.pp.del = L.cell.t + 0.1; m.pp.dur = dur; m.pp.amp = amp; m.flash = 1; }
  function burst(m, w, n) { m.nc.weight = w; m.ns.number = n; m.ns.interval = 5; m.ns.burst(L.cell, L.cell.t + 0.1); m.flash = 1; }

  const SETUP = {
    bap(R) {
      const type = ['pyramidal', 'purkinje', 'motor'][Math.floor(R() * 3)];
      loadType(type, 1 + Math.floor(R() * 40));
      const s = { type, ms: 3.2, period: 28, last: -1e9 };
      s.cl = clamp(0, PULSE[type]);
      s.focus = A.farNode(isDend, 0.45 + 0.25 * R());
      A.place('probe', 0, true);
      const B = L.B, r = B.R * (0.42 + 0.12 * R());
      s.az = R() * 6.28; s.el = 0.05 + 0.35 * R();
      s.cam = () => ({ az: s.az, el: s.el, r: r * fovK() / 2.4 / run.fit, target: nodePos(s.focus) });
      s.tick = (dt, k) => { s.az += dt * 0.05; if (L.cell.t - s.last > s.period) { s.last = L.cell.t; pulse(s.cl, PULSE[type]); } };
      s.subject = () => nodePos(s.focus);
      return s;
    },
    orbit(R) {
      const type = ['pyramidal', 'purkinje', 'motor', 'granule'][Math.floor(R() * 4)];
      loadType(type, 1 + Math.floor(R() * 40));
      const s = { type, ms: 5, syns: [], lastS: -1e9 };
      s.cl = clamp(0, PULSE[type]);
      const c = L.cell;
      for (let q = 0; q < 5; q++) { let i; do { i = Math.floor(R() * c.n); } while (!isDend(c.sections[c.sec[i]].kind)); const m = A.place('syn', i, true); m.next = c.t + 5 + q * 9; s.syns.push(m); }
      s.az = R() * 6.28; s.el = 0.1 + 0.2 * R();
      s.cam = () => ({ az: s.az, el: s.el, r: L.B.R * fovK() * 1.0 / run.fit, target: L.B.c });
      s.tick = dt => {
        s.az += dt * 0.12;
        for (const m of s.syns) if (c.t > m.next) { burst(m, 0.03, 3); m.next = c.t + 30 + R() * 30; }
        if (c.t - s.lastS > 45) { s.lastS = c.t; pulse(s.cl, PULSE[type]); }
      };
      s.subject = () => L.B.c;
      return s;
    },
    synapse(R) {
      const type = ['pyramidal', 'purkinje'][Math.floor(R() * 2)];
      loadType(type, 1 + Math.floor(R() * 40));
      const s = { type, ms: 3, last: -1e9 };
      s.node = A.farNode(isDend, 0.92);
      s.m = A.place('syn', s.node, true);
      A.place('probe', s.node, true); A.place('probe', 0, true);
      s.az = R() * 6.28; s.el = 0.15 + 0.2 * R();
      const p0 = nodePos(s.node), p1 = nodePos(0);
      s.k = 0;
      s.cam = () => { const k = smooth(s.k); return { az: s.az, el: s.el, r: L.B.R * (0.22 + 0.5 * k) * fovK() / run.fit, target: p0.map((x, i) => x + (p1[i] - x) * k * 0.7) }; };
      s.tick = (dt, k) => { s.k = k; s.az += dt * 0.04; if (L.cell.t - s.last > 32) { s.last = L.cell.t; burst(s.m, 0.06, 5); } };
      s.subject = () => nodePos(s.node);
      return s;
    },
    phase(R) { return tonicShot(R, 'phase'); },
    gates(R) { return tonicShot(R, 'gates'); },
    axon(R) {
      const type = ['pyramidal', 'motor'][Math.floor(R() * 2)];
      loadType(type, 1 + Math.floor(R() * 40));
      const s = { type, ms: 2.4, last: -1e9 };
      s.cl = clamp(0, PULSE[type]);
      const c = L.cell, ax = []; for (let i = 0; i < c.n; i++) if (c.sections[c.sec[i]].name === 'axon' || c.sections[c.sec[i]].kind === 'ais') ax.push(i);
      s.focus = nodePos(0);
      s.az = R() * 6.28; s.el = 0.2;
      s.cam = () => ({ az: s.az, el: s.el, r: L.B.R * 0.3 * fovK() / run.fit, target: s.focus });
      s.tick = dt => {
        s.az += dt * 0.06;
        if (c.t - s.last > 22) { s.last = c.t; pulse(s.cl, PULSE[type]); }
        // the spike front: the farthest axon node above -20 mV
        let best = -1; for (const i of ax) if (c.v[i] > -20 && (best < 0 || c.dist[i] > c.dist[best])) best = i;
        if (best >= 0) s.focus = nodePos(best);
      };
      s.subject = () => s.focus;
      return s;
    },
    netchain(R) { return netShot(R, 'chain'); },
    netring(R) { return netShot(R, 'ring'); },
    netinhibit(R) { return netShot(R, 'inhibit'); },
    netrandom(R) { return netShot(R, 'random'); },
  };
  // A network shot. The camera follows the cell that fired last (chain) or
  // orbits the whole circuit.
  function netShot(R, kind) {
    const seed = 1 + Math.floor(R() * 9000);
    if (kind === 'random') {
      const pick = a => a[Math.floor(R() * a.length)];
      NET.N.w = { count: 5 + Math.floor(R() * 4), layout: pick(['ring', 'layer', 'cluster', 'line']), preset: pick(['chain', 'ring', 'ff', 'ei', 'random', 'loop']), p: 0.3 + 0.2 * R(), wE: 2.2 + 1.2 * R(), wI: 2 + R(), fracE: 0.75, velocity: 0.25 + 0.3 * R() };
      const n = NET.N.w.count, types = Array.from({ length: n }, () => pick(['pyramidal', 'pyramidal', 'purkinje', 'motor', 'granule']));
      NET.enable(NET.make({ seed, types }), { hash: false, jump: true, fit: false });
      NET.N.auto = true; NET.N.kickEvery = 60 + 60 * R();
    } else NET.runDemo(kind, { hash: false, jump: true, fit: false, seed });
    const net = NET.N.net, B = NET.worldBounds();
    const s = { net: true, ms: kind === 'ring' ? 4 : 3.2, follow: kind === 'chain', board: kind === 'random', kind: 'raster', last: 0 };
    s.az = R() * 6.28; s.el = 0.35 + 0.25 * R(); s.spin = (R() < 0.5 ? -1 : 1) * (0.05 + 0.05 * R());
    s.focus = net.world(0, 0);
    s.cam = () => s.follow
      ? { az: s.az, el: s.el, r: B.R * 0.85 * fovK() / run.fit, target: s.focus }
      : { az: s.az, el: s.el, r: B.R * 1.15 * fovK() / run.fit, target: B.c };
    s.tick = dt => {
      s.az += dt * s.spin;
      if (s.follow && net.spikes.length) { const i = net.spikes[net.spikes.length - 1]; const w = net.world(i, 0); s.focus = s.focus.map((x, k) => x + (w[k] - x) * Math.min(1, dt * 1.5)); }
    };
    s.subject = () => (s.follow ? s.focus : B.c);
    // warm up so spikes are already in flight when the cut lands
    NET.step(8, 40);
    return s;
  }
  function tonicShot(R, kind) {
    const type = ['pyramidal', 'purkinje', 'motor', 'granule'][Math.floor(R() * 4)];
    loadType(type, 1 + Math.floor(R() * 40));
    const s = { type, ms: 6, kind, board: true };
    clamp(0, TONIC[type], true);
    A.place('probe', 0, true);
    s.az = R() * 6.28; s.el = 0.15;
    s.cam = () => ({ az: s.az, el: s.el, r: L.B.R * fovK() * 1.05 / run.fit, target: L.B.c });
    s.tick = dt => { s.az += dt * 0.08; };
    s.subject = () => L.B.c;
    // warm up through the first spikes so the cycle is on screen at once
    A.stepSim(60); A.resetHistory(); A.stepSim(40);
    return s;
  }

  function startShot() {
    const sh = run.plan[run.i % run.plan.length];
    run.tau = 0; run.sec = sh.sec;
    const R = rng(sh.seed + 17);
    run.shot = SETUP[sh.id](R);
    run.shot.id = sh.id;
    const fb = band();
    if (run.shot.board) { fb.x1 = stage.W * 0.52; }
    stage.frame(fb); run.fit = stage.fit;
    run.frameB = fb;
    const g = run.shot.cam();
    // start a little wider and to the side, then the springs settle in
    stage.jump({ az: g.az - 0.35, el: g.el + 0.1, r: g.r * 1.35, target: g.target });
    stage.flyTo(g, 0.9 + 0.5 * (1 - run.calm));
    const b = board(); b.mesh.visible = !!run.shot.board;
    plate(sh);
  }
  function plate(sh) {
    if (!run.label) return;
    const S = LAB_SHOTS.find(q => q.id === sh.id), C = A.CELLS.find(c => c.id === run.shot.type);
    let lines;
    if (run.shot.net) {
      const net = NET.N.net, nI = net.conns.filter(c => c.ty === 'i').length;
      lines = [`${net.n} full cable cells · ${net.conns.length} NetCons (${net.conns.length - nI} excitatory, ${nI} inhibitory)`, `${net.total} compartments · conduction ${net.velocity.toFixed(2)} m/s · hh.mod channels`, 'Method after NEURON (neuronsimulator.org)'];
    } else lines = [`${C.name} (procedural shape)`, `hh.mod channels at ${P.celsius.toFixed(1)} °C, Δt = 0.025 ms · ${L.cell.n} compartments`, 'Method after NEURON (neuronsimulator.org)'];
    try { run.label({ title: S.title, sub: S.sub, tex: S.tex, rules: S.rules, lines, anchor: () => anchor() }); } catch (e) { /* the plate is optional */ }
  }
  const _v = new THREE.Vector3();
  function anchor() {
    if (!run || !run.shot) return null;
    const p = run.shot.subject(); _v.set(p[0], p[1], p[2]).project(stage.camera);
    return { x: (_v.x + 1) / 2 * stage.W, y: (1 - _v.y) / 2 * stage.H, r: Math.min(stage.W, stage.H) * 0.12 };
  }

  function tick(dt) {
    if (!run) return;
    run.tau += dt;
    if (run.tau >= run.sec) { run.i++; startShot(); return; }
    const k = run.tau / run.sec, s = run.shot;
    s.tick(dt, k);
    if (s.net) NET.step(s.ms * (1 - 0.35 * run.calm) * dt, 8);
    else A.stepSim(s.ms * (1 - 0.35 * run.calm) * dt);
    // keep the band current (the plate can reflow)
    if ((run.bandT -= dt) <= 0) {
      run.bandT = 0.5; const fb = band(); if (s.board) fb.x1 = stage.W * 0.52;
      stage.frame(fb); run.fit = stage.fit; run.frameB = fb;
    }
    stage.flyTo(s.cam(), 0.9 + 0.5 * (1 - run.calm));
    if (s.board) {
      const b = run.board, fb = run.frameB, W = stage.W;
      const bw = Math.min(W * 0.44, (fb.y1 - fb.y0) * 1.5), bh = bw / 1.45;
      const cx = W * 0.74, cy = (fb.y0 + fb.y1) / 2;
      placeBoard(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2);
      if ((run.drawT -= dt) <= 0) {
        run.drawT = 1 / 30;
        const opts = { bg: 'rgba(6,10,19,0.86)', lw: 3 };
        if (s.net) NET.drawRaster(b.cv, null, { ...opts, force: true, lw: 4 });
        else if (s.kind === 'phase') A.drawPhase(b.cv, opts); else A.drawGates(b.cv, opts);
        b.tex.needsUpdate = true;
      }
    }
  }

  window.snSaver = {
    enter(o = {}) {
      if (run) this.exit();
      const css = document.createElement('style');
      css.textContent = '#panel,#anaPanel,#dock,.topbar,#read,#hint,#marks,.credit,#nogl{display:none!important}#stage{top:0!important}#view{cursor:none}';
      document.head.appendChild(css);
      const saved = { ...P };
      const netSaved = NET && NET.on ? NET.hashState().net : null;
      run = { css, saved, netSaved, calm: Math.max(0, Math.min(1, o.calm == null ? 0.7 : +o.calm)), label: typeof o.label === 'function' ? o.label : null, plan: shotPlan(LAB_SHOTS, (o.seed >>> 0) || 1, 80, o.calm ?? 0.7), i: 0, bandT: 0, drawT: 0, fit: 1, board: null };
      L.saver = true; L.saverTick = tick;
      stage.hold = true; stage.controls.enabled = false; stage.controls.autoRotate = false;
      stage.resize();
      startShot();
      return { canvas: stage.renderer.domElement, warmupMs: 500 };
    },
    exit() {
      if (!run) return;
      run.css.remove();
      if (run.board) { stage.camera.remove(run.board.mesh); run.board.tex.dispose(); run.board.mesh.geometry.dispose(); run.board.mesh.material.dispose(); run.board.cv.remove(); }
      Object.assign(P, run.saved);
      const ns = run.netSaved;
      run = null; L.saver = false; L.saverTick = null;
      stage.hold = false; stage.controls.enabled = true; stage.springOn = false;
      netOff();
      A.loadCell({ keep: false });
      if (ns && NET) { try { NET.enable(NET.make({ types: ns.types, conns: ns.conns, place: ns.pos, velocity: ns.vel }), { hash: false }); } catch (e) { /* stay in one-cell mode */ } }
      A.layout();
    },
    cut() { if (run) { run.i++; startShot(); } },
  };
  window.snSaver.debug = () => run ? { i: run.i, id: run.shot && run.shot.id, tau: run.tau, sec: run.sec, type: run.shot && run.shot.type, t: L.cell.t } : null;
}
