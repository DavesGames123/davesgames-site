// ============================================================================
//  NEURAL NETWORK  ·  saver.js  ·  screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter(opts) hides the page UI and returns
//  the WebGL canvas (#view). A seeded plan (NET_SHOTS in
//  ../neuron-lab/engine/shots.js) cuts every 6 to 12 s, never the same shot
//  twice in a row:
//    avalanche  a quiet column; pulses at random points spread out
//    score      a raster that writes itself left to right over the shot,
//               on a board under the column (a camera child plane)
//    orbit      the PING column turning in its gamma rhythm
//    close      a push-in among the cells of the column
//    ring       a wave running round the ring; the camera follows it
//  The camera is on springs (stage.hold). The subject sits in the clear
//  band between the plate texts (lib/saver-clear.js). Plates: TeX, no code.
//
//  grep -n targets
//    "const SETUP"   per-shot network, stimuli and camera
//    "function tick" per-frame shot logic
// ============================================================================
import { NET_SHOTS, shotPlan } from '../neuron-lab/engine/shots.js';
import { rng } from '../neuron-lab/engine/rng.js';
import { plateBand } from '../../lib/saver-clear.js';

const smooth = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

export function installSaver(A) {
  const { W, P, stage, THREE } = A;
  let run = null;
  const fitR = R => R / Math.tan(stage.camera.fov * Math.PI / 360) / Math.max(0.2, run.fit);

  function board() {
    if (run.board) return run.board;
    const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 520;
    cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px;height:260px';
    document.body.appendChild(cv);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.renderOrder = 10; mesh.visible = false;
    stage.camera.add(mesh); if (!stage.camera.parent) stage.scene.add(stage.camera);
    run.board = { cv, tex, mesh };
    return run.board;
  }
  function placeBoard(x0, y0, x1, y1) {
    const b = run.board, cam = stage.camera, Wd = stage.W, H = stage.H, D = 50;
    const ox = cam.view && cam.view.enabled ? cam.view.offsetX : 0, oy = cam.view && cam.view.enabled ? cam.view.offsetY : 0;
    const th = Math.tan(cam.fov * Math.PI / 360) * D, tw = th * cam.aspect;
    const toX = px => ((px + ox) / Wd * 2 - 1) * tw, toY = py => (1 - (py + oy) / H * 2) * th;
    b.mesh.position.set((toX(x0) + toX(x1)) / 2, (toY(y0) + toY(y1)) / 2, -D);
    b.mesh.scale.set(toX(x1) - toX(x0), toY(y0) - toY(y1), 1);
  }
  const band = () => { const pb = run.label ? plateBand(stage.H) : null; return { x0: 0, x1: stage.W, y0: pb ? pb.t : 0, y1: stage.H - (pb ? pb.b : 0) }; };
  const cellPos = i => [W.net.pos[i * 3], W.net.pos[i * 3 + 1], W.net.pos[i * 3 + 2]];

  function net(model, N, seed, drive = 1) {
    P.model = model; P.N = N; P.seed = seed; P.drive = drive; P.wei = P.wie = P.wee = 1;
    P.tauI = A.MODELS[model].tauI; P.celsius = A.MODELS[model].celsius; P.pulses = true; P.links = true;
    A.build({ fit: false, kick: false });
  }

  const SETUP = {
    avalanche(R) {
      // a quiet PING column with strong E to E: a pulse spreads before the interneurons stop it
      net('ping', 1200, 1 + Math.floor(R() * 50), 0.1);
      P.wee = 3; W.net.scaleWeights({ ee: 3, ei: 1, ie: 1, ii: 1 });
      const s = { ms: 9, last: -1e9, focus: A.randomCellPos() };
      s.az = R() * 6.28; s.el = 0.1 + 0.3 * R();
      s.cam = () => ({ az: s.az, el: s.el, r: fitR(420), target: s.focus });
      s.tick = dt => {
        s.az += dt * 0.05;
        if (W.net.t - s.last > 70) { s.last = W.net.t; s.focus = A.randomCellPos(); A.pulseAt(s.focus, 150, 2.2); }
      };
      s.subject = () => s.focus;
      A.stepSim(30);
      return s;
    },
    score(R) {
      net('ping', 1000, 1 + Math.floor(R() * 50));
      A.stepSim(150);
      const s = { ms: 14, board: true, t0: W.net.t };
      s.az = R() * 6.28;
      s.cam = () => ({ az: s.az, el: 0.25, r: fitR(700), target: [0, 0, 0] });
      s.tick = dt => { s.az += dt * 0.07; };
      s.subject = () => [0, 0, 0];
      return s;
    },
    orbit(R) {
      net('ping', 1500, 1 + Math.floor(R() * 50));
      A.stepSim(150);
      const s = { ms: 12 };
      s.az = R() * 6.28; s.el = 0.05 + 0.3 * R();
      s.cam = () => ({ az: s.az, el: s.el, r: fitR(640), target: [0, 0, 0] });
      s.tick = dt => { s.az += dt * 0.11; };
      s.subject = () => [0, 0, 0];
      return s;
    },
    close(R) {
      net(R() < 0.6 ? 'ping' : 'balanced', 1500, 1 + Math.floor(R() * 50));
      A.stepSim(120);
      const i = Math.floor(R() * W.net.NE), p = cellPos(i);
      const s = { ms: 6, k: 0 };
      s.az = Math.atan2(p[0], p[2]) + (R() - 0.5); s.el = 0.05 + 0.2 * R();
      s.cam = () => ({ az: s.az, el: s.el, r: fitR(260 - 120 * smooth(s.k)), target: p });
      s.tick = (dt, k) => { s.k = k; s.az += dt * 0.04; };
      s.subject = () => p;
      return s;
    },
    ring(R) {
      net('ring', 1000, 1 + Math.floor(R() * 50));
      A.kick(); A.stepSim(30);
      const s = { ms: 10, ang: 0 };
      s.cam = () => { const a = s.ang; return { az: Math.PI / 2 - a + 0.9, el: 0.7, r: fitR(380), target: [520 * Math.cos(a) * 0.75, 0, 520 * Math.sin(a) * 0.75] }; };
      s.tick = () => {
        // the wave front: the mean angle of E spikes in the last 4 ms
        const S = W.net.spikes; let sx = 0, sy = 0;
        for (let q = S.length - 2; q >= 0 && S[q] > W.net.t - 4; q -= 2) { const c = S[q + 1]; if (c >= W.net.NE) continue; const p = cellPos(c); sx += p[0]; sy += p[2]; }
        if (sx || sy) { let a = Math.atan2(sy, sx); while (a - s.ang > Math.PI) a -= 2 * Math.PI; while (a - s.ang < -Math.PI) a += 2 * Math.PI; s.ang += (a - s.ang) * 0.08; }
        // kick again if the wave died
        if (W.net.t - (S.length ? S[S.length - 2] : 0) > 40) A.kick();
      };
      s.subject = () => [520 * Math.cos(s.ang), 0, 520 * Math.sin(s.ang)];
      return s;
    },
  };

  function startShot() {
    const sh = run.plan[run.i % run.plan.length];
    run.tau = 0; run.sec = sh.sec;
    run.shot = SETUP[sh.id](rng(sh.seed + 31));
    run.shot.id = sh.id;
    frameNow();
    const g = run.shot.cam();
    stage.jump({ az: g.az - 0.3, el: g.el + 0.08, r: g.r * 1.3, target: g.target });
    stage.flyTo(g, 0.9 + 0.5 * (1 - run.calm));
    board().mesh.visible = !!run.shot.board;
    if (run.shot.board) run.shot.span = run.sec * run.shot.ms * (1 - 0.35 * run.calm);
    plate(sh);
  }
  function frameNow() {
    const fb = band();
    if (run.shot.board) { fb.y1 = fb.y0 + (fb.y1 - fb.y0) * 0.5; }
    stage.frame(fb); run.fit = stage.fit; run.fb = band();
  }
  function plate(sh) {
    if (!run.label) return;
    const S = NET_SHOTS.find(q => q.id === sh.id), M = A.MODELS[P.model], n = W.net;
    const r = A.rhythm();
    const lines = [`${M.name}: ${n.N} cells, ${n.nNetCon.toLocaleString('en-US')} NetCons`, r && r.ratio > 12 ? `Rhythm ${r.f} Hz (${A.bandName(r.f)})` : 'Two-compartment Hodgkin-Huxley cells', 'NetCon network model after NEURON (neuronsimulator.org)'];
    try { run.label({ title: S.title, sub: S.sub, tex: S.tex, rules: S.rules, lines, anchor: () => anchor() }); } catch (e) { /* optional */ }
  }
  const _v = new THREE.Vector3();
  function anchor() {
    if (!run || !run.shot) return null;
    const p = run.shot.subject(); _v.set(p[0], p[1], p[2]).project(stage.camera);
    return { x: (_v.x + 1) / 2 * stage.W, y: (1 - _v.y) / 2 * stage.H, r: Math.min(stage.W, stage.H) * 0.14 };
  }
  function tick(dt) {
    if (!run) return;
    run.tau += dt;
    if (run.tau >= run.sec) { run.i++; startShot(); return; }
    const s = run.shot, k = run.tau / run.sec;
    s.tick(dt, k);
    A.stepSim(s.ms * (1 - 0.35 * run.calm) * dt);
    if ((run.bandT -= dt) <= 0) { run.bandT = 0.5; frameNow(); }
    stage.flyTo(s.cam(), 0.9 + 0.5 * (1 - run.calm));
    if (s.board) {
      const fb = run.fb, h = fb.y1 - fb.y0, y0 = fb.y0 + h * 0.52, y1 = fb.y1 - h * 0.02;
      placeBoard(stage.W * 0.05, y0, stage.W * 0.95, y1);
      if ((run.drawT -= dt) <= 0) {
        run.drawT = 1 / 30;
        A.drawRaster(run.board.cv, { t0: s.t0, span: s.span, bg: 'rgba(6,10,19,0.88)', dot: 3, pad: 14, bare: true });
        run.board.tex.needsUpdate = true;
      }
    }
  }

  window.snSaver = {
    enter(o = {}) {
      if (run) this.exit();
      const css = document.createElement('style');
      css.textContent = '#panel,#anaPanel,#dock,.topbar,#read,#hint,.credit,#nogl{display:none!important}#stage{top:0!important}#view{cursor:none}';
      document.head.appendChild(css);
      run = { css, saved: { ...P }, calm: Math.max(0, Math.min(1, o.calm == null ? 0.7 : +o.calm)), label: typeof o.label === 'function' ? o.label : null, plan: shotPlan(NET_SHOTS, (o.seed >>> 0) || 1, 80, o.calm ?? 0.7), i: 0, bandT: 0, drawT: 0, fit: 1, board: null };
      W.saver = true; W.saverTick = tick; W.R = rng(((o.seed >>> 0) || 1) + 7);
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
      run = null; W.saver = false; W.saverTick = null; W.R = Math.random;
      stage.hold = false; stage.controls.enabled = true; stage.springOn = false;
      A.build({ soft: true });
    },
    cut() { if (run) { run.i++; startShot(); } },
  };
  window.snSaver.debug = () => run ? { i: run.i, id: run.shot && run.shot.id, tau: run.tau, sec: run.sec, model: P.model, t: W.net.t, spikes: W.net.spikes.length / 2 } : null;
}
