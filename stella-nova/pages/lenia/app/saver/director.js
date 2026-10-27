// ============================================================================
//  LENIA  ·  app/saver/director.js — the shell screensaver hook
// ----------------------------------------------------------------------------
//  window.snSaver for lib/screensaver.js. enter() hides the GUI, copies
//  each WebGPU frame into #saver-cv, and runs the scene and shot director.
//  main.js imports this file for that one effect.
//
//  GREP MAP
//    grep -n 'window.snSaver'     the hook
//    grep -n 'const SAVER_CODES'  the saver creatures
//    grep -n 'const SHOTS'        shot order per scene kind
//    grep -n 'const stage'        stamp the copies of a scene
//    grep -n 'const showScene'    start a scene
//    grep -n 'const nextShot'     start a shot (a hard cut)
//    grep -n 'const pose'         the camera target
//    grep -n 'const readGrid'     the tracker read
//    grep -n 'function drive'     the saver loop and the fades
// ============================================================================
import { resample } from '../../engine.js';
import { wrap, wrapDelta } from '../torus.js';
import { cellsOf, rotate } from '../catalog.js';
import { mulberry, saverGrid, gridCentroid, gridPeaks } from './grid.js';
import { $, S, det } from '../state.js';
import { selectCreature, placeCreature } from '../creature.js';
import { openBrowser } from '../browser.js';
import { setOpen, setPlaying, setFollow } from '../controls.js';
import { sizeWorld } from '../world.js';
import { shownTime } from '../frame.js';
import { saverLabel, trackAt } from './label.js';

// Shell screensaver hook (lib/screensaver.js). enter() waits for the first
// creature, hides the GUI and gives #gl the full window. A 2D canvas over
// #gl takes a copy of each frame and is the canvas to record: it can fade to
// black across a scene change, which the WebGPU pass cannot.
// WORLD. The saver runs at detail 1 with a short side of 256 cells, so the
// world is about 8 creatures across and a step costs about 5x less than at
// detail 2 and 128 cells.
// SCENES. A seeded shuffle of SAVER_CODES gives one creature per scene. A
// glider scene stamps 1 to 6 copies with random turns, so the copies roam
// and meet. A grower (a chain creature that fills the world) gets one stamp.
// A creature set that dies is stamped again behind a fade. A set that fills
// the world after a collision (2.5x its start mass) ends the scene.
// SHOTS. A scene is 3 shots of 6 to 10 s with hard cuts between them (see
// SHOTS). The camera does not lock on the creature: it pushes in, lets the
// creature cross the frame, waits ahead of its path, or holds wide.
// TRACKER. engine.stats() gives one centroid for all cells, which is the
// empty space between two copies. The saver reads the world 5 times a
// second into a grid of R/2 blocks (saverGrid) and follows the centroid of
// the blocks near one creature (saverTrack).
// The subject sits in the clear band of the label plate (plateBand,
// lib/saver-clear.js) through the view offset, read in frame().
const SAVER_CODES = ['O2u', 'OG2g', 'HN+m', 'OV2u', '2S1f', 'O4t', 'PN+i', 'P4al', 'K4s', 'HN+bs'];
// Shot order per scene kind. The first shot of a scene is the first entry.
const SHOTS = {
  one: [['push', 'ahead', 'drift'], ['ahead', 'push', 'wide'], ['drift', 'push', 'ahead']],
  herd: [['wide', 'push', 'drift'], ['push', 'wide', 'ahead'], ['wide', 'drift', 'push']],
  grow: [['wide', 'pan', 'push'], ['push', 'pan', 'wide']],
};

window.snSaver = {
  async enter(opts) {
    const calm = Math.max(0, Math.min(1, +opts.calm || 0));
    while (S.idx < 0) await new Promise(r => setTimeout(r, 50));
    S.saver = true;
    const st = document.createElement('style');
    st.textContent = 'html.saver #panel,html.saver #gear,html.saver #toast,html.saver #cursor,html.saver #dock,html.saver #status,'
      + 'html.saver #browser,html.saver #nogpu{display:none!important}'
      + 'html.saver #gl{left:0!important;width:100%!important;transition:none!important}'
      + 'html.saver #saver-cv{position:fixed;inset:0;width:100%;height:100%;z-index:30;cursor:none;background:#000}';
    document.head.appendChild(st); document.documentElement.classList.add('saver');
    setOpen(false); openBrowser(false);
    if (S.applySize) S.applySize();
    const gl = $('gl');
    if (!S.engine) return { canvas: gl, warmupMs: 0 };
    const E = S.engine;
    const cv = document.createElement('canvas'); cv.id = 'saver-cv'; document.body.appendChild(cv);
    const c2 = cv.getContext('2d', { alpha: false });
    let plateBand = null;
    import('../../../../lib/saver-clear.js').then(m => { plateBand = m.plateBand; }).catch(() => { /* no band: the canvas centre */ });

    const rnd = mulberry(opts.seed);
    const pick = a => a[Math.floor(rnd() * a.length)];
    // A seeded shuffle, so each run plays a new order from a new start.
    const list = SAVER_CODES.map(code => S.creatures.findIndex(c => c.code === code)).filter(i => i >= 0);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const FADE = 1.0;
    const shotLen = () => 6 + 4 * calm * 0.5 + rnd() * 3;
    let k = -1, t = 0, last = 0, dead = 0, tIn = -1e9, sceneT = 0;
    let scene = null, shot = null, si = 0, grid = null, gridBusy = false, gridF = 0, band = null, bandAt = -1e9;
    let mass0 = 0;   // the mass of the set soon after the stamp
    let simRate = 1, simT0 = 0, wall0 = 0;   // sim time units per second, measured
    const cam = { x: 0, y: 0, z: 1 };
    const track = { p: null, v: { x: 0, y: 0 }, t: 0 };
    S.saverTrack = track;
    const Rc = () => E.info.R;

    // The pixel size of a cell at zoom 1, and the clear band in CSS px.
    const px1 = () => E.cellPx() / E.view.zoom;
    const bandBox = () => {
      const w = gl.clientWidth, h = gl.clientHeight;
      const bt = band ? Math.min(band.t, h * 0.4) : 0, bb = band ? Math.min(band.b, h * 0.4) : 0;
      return { w: band && band.w ? Math.min(w, band.w) : w, h: Math.max(80, h - bt - bb), oy: (bt - bb) / 2 };
    };
    // The zoom at which the creature fills f of the short side of the clear
    // band. The size is the start patch (1.2 to 1.6 R for most gliders).
    const size = () => Math.max(S.c.w, S.c.h) * S.rule.scale * det();
    const zFor = f => { const bx = bandBox(); return Math.max(1, Math.min(7, f * Math.min(bx.w, bx.h) / (size() * px1()))); };
    // Half the clear band in cells at zoom z, along a unit direction d.
    const halfSpan = (z, d) => { const bx = bandBox(), c = px1() * z; return 0.5 * Math.min(Math.abs(d.x) > 1e-6 ? bx.w / Math.abs(d.x) : 1e9, Math.abs(d.y) > 1e-6 ? bx.h / Math.abs(d.y) : 1e9) / c; };

    // Stamp the scene: n copies of the creature at random places and turns,
    // kept 5 R apart on the torus.
    const stage = () => {
      if (scene.n <= 1) { placeCreature(); mass0 = 0; return; }
      const { W, H } = E.info, base = resample(cellsOf(S.c), S.rule.scale * det());
      const gap = 5 * Rc(), pts = [];
      for (let tries = 0; pts.length < scene.n && tries < 200; tries++) {
        const p = { x: rnd() * W, y: rnd() * H };
        if (pts.every(q => Math.hypot(wrapDelta(p.x - q.x, W), wrapDelta(p.y - q.y, H)) > gap)) pts.push(p);
      }
      E.clear();
      for (const p of pts) E.stamp(rotate(base, Math.floor(rnd() * 4)), Math.round(p.x), Math.round(p.y));
      S.time = 0; S.acc = 0; S.stats = null; S.vel = { x: 0, y: 0 }; mass0 = 0;
      track.p = { x: pts[0].x, y: pts[0].y }; track.v = { x: 0, y: 0 }; track.t = 0;
    };
    const showScene = () => {
      k = (k + 1) % list.length;
      setPlaying(true);
      S.worldShort = 256; S.detail = 1;
      selectCreature(list[k]);
      sizeWorld(true);
      setFollow(false);
      const grow = S.c.cls === 'grow';
      const { W, H } = E.info, room = Math.floor(W * H / (36 * Rc() * Rc()));
      const n = grow ? 1 : Math.max(1, Math.min(room, 4, rnd() < 0.3 ? 1 : 2 + Math.floor(rnd() * 3)));
      const kind = grow ? 'grow' : n > 1 ? 'herd' : 'one';
      scene = { n, kind, shots: pick(SHOTS[kind]) };
      track.p = { x: W / 2, y: H / 2 }; track.v = { x: 0, y: 0 }; track.t = 0;
      stage();
      grid = null;
      S.speed = 3.5 * (1 - 0.3 * calm);
      t = 0; sceneT = 0; dead = 0; tIn = -1e9; si = -1; mass0 = 0;
      saverLabel(opts.label);
      nextShot();
    };
    // Start a shot: choose its subject, then put the camera on its first
    // pose with no ease (a hard cut).
    const nextShot = () => {
      si++;
      const type = scene.shots[si % scene.shots.length], dur = shotLen();
      const { W, H } = E.info;
      // A herd or grower shot takes a new creature (or part) to look at. An
      // ahead or drift shot keeps the creature, which has a velocity.
      if (grid && si > 0 && scene.kind !== 'one' && type !== 'ahead' && type !== 'drift') {
        const pk = gridPeaks(grid);
        if (pk.length) { const p = pick(pk), c = gridCentroid(grid, p, 1.6 * Rc()) || p; track.p = { x: c.x, y: c.y }; track.v = { x: 0, y: 0 }; track.t = shownTime(); }
      }
      const P = track.p ? trackAt(track) : { x: W / 2, y: H / 2 };
      const sp = Math.hypot(track.v.x, track.v.y);
      const dir = sp > 1e-3 ? { x: track.v.x / sp, y: track.v.y / sp } : (a => ({ x: Math.cos(a), y: Math.sin(a) }))(rnd() * Math.PI * 2);
      const zc = zFor(0.75);
      shot = { type, dur, t: 0, dir, zc, fix: null, pan: null };
      // ahead: the camera waits on the path, half a shot in front of the
      // creature, at a zoom that holds the whole crossing in the clear band.
      // The band is wide and short, so a path that is mostly vertical gets
      // a drift. With no clear motion it is a push-in.
      if (shot.type === 'ahead') {
        const travel = sp * simRate * dur;
        if (travel < 1.5 * Rc()) shot.type = 'push';
        else if (Math.abs(dir.y) > 0.6) shot.type = 'drift';
        else {
          const h1 = halfSpan(1, dir), z = Math.max(1, Math.min(zc, (h1 - 0.6 * size()) / (0.55 * travel)));
          shot.fix = { x: wrap(P.x + dir.x * travel * 0.5, W), y: wrap(P.y + dir.y * travel * 0.5, H), z };
        }
      }
      // drift: the sweep is along x, where the band has room.
      if (shot.type === 'drift') shot.dir = { x: rnd() < 0.5 ? -1 : 1, y: 0 };
      if (type === 'wide') shot.fix = { x: P.x, y: P.y, z: 1 };
      if (type === 'pan') {
        const a = rnd() * Math.PI * 2, z = Math.max(1.3, zc * 0.7);
        shot.pan = { x: P.x, y: P.y, vx: Math.cos(a) * halfSpan(z, { x: 1, y: 0 }) * 0.9 / dur, vy: Math.sin(a) * halfSpan(z, { x: 0, y: 1 }) * 0.9 / dur, z };
      }
      const p0 = pose(0);
      cam.x = p0.x; cam.y = p0.y; cam.z = p0.z;
    };
    const ease = s => s * s * (3 - 2 * s);
    // The camera target at shot time ts.
    const pose = ts => {
      const s = Math.min(1, ts / shot.dur), { W, H } = E.info;
      const P = track.p ? trackAt(track) : { x: W / 2, y: H / 2 };
      switch (shot.type) {
        case 'push': return { x: P.x, y: P.y, z: Math.max(1, shot.zc * (0.45 + 0.55 * ease(s))) };
        case 'drift': {
          // The creature crosses the frame: the camera holds an offset that
          // goes from one side to the other, a creature radius inside the band.
          const z = Math.max(1, shot.zc * 0.55), o = (0.5 - s) * 2 * Math.max(0, halfSpan(z, shot.dir) - 0.6 * size() - 4);
          return { x: wrap(P.x + shot.dir.x * o, W), y: wrap(P.y + shot.dir.y * o, H), z };
        }
        case 'ahead': return shot.fix;
        case 'wide': return { x: shot.fix.x, y: shot.fix.y, z: 1 + 0.25 * s };
        case 'pan': return { x: wrap(shot.pan.x + shot.pan.vx * ts, W), y: wrap(shot.pan.y + shot.pan.vy * ts, H), z: shot.pan.z };
      }
      return { x: P.x, y: P.y, z: 1 };
    };
    // Read the world into the block grid and move the tracker to the
    // centroid near its last point. A lost creature goes to the nearest peak.
    const readGrid = () => {
      if (gridBusy) return;
      gridBusy = true;
      const ts = S.time, B = Math.max(4, Math.round(Rc() / 2)), sc = scene;
      E.readState().then(A => {
        const { W, H } = E.info;
        if (sc !== scene || A.length !== W * H) return;
        grid = saverGrid(A, W, H, B);
        const prev = track.p ? { x: wrap(track.p.x + track.v.x * (ts - track.t), W), y: wrap(track.p.y + track.v.y * (ts - track.t), H) } : { x: W / 2, y: H / 2 };
        let c = gridCentroid(grid, prev, 1.6 * Rc());
        if (!c) {
          const pk = gridPeaks(grid);
          if (!pk.length) return;
          pk.sort((a, b) => Math.hypot(wrapDelta(a.x - prev.x, W), wrapDelta(a.y - prev.y, H)) - Math.hypot(wrapDelta(b.x - prev.x, W), wrapDelta(b.y - prev.y, H)));
          c = gridCentroid(grid, pk[0], 1.6 * Rc()) || pk[0];
          track.v = { x: 0, y: 0 };
        } else if (track.p && ts - track.t > 1e-3) {
          const vx = wrapDelta(c.x - track.p.x, W) / (ts - track.t), vy = wrapDelta(c.y - track.p.y, H) / (ts - track.t);
          // A grower spreads: its centroid speed is not a motion to follow.
          const g = scene.kind === 'grow' ? 0 : 0.15;
          track.v = { x: track.v.x * (1 - g) + vx * g, y: track.v.y * (1 - g) + vy * g };
        }
        track.p = { x: c.x, y: c.y }; track.t = ts;
      }).catch(() => {}).finally(() => { gridBusy = false; });
    };

    // The state of the director, for the headless probe.
    window.snSaver.debug = () => ({ code: S.c && S.c.code, scene: scene && { n: scene.n, kind: scene.kind }, shot: shot && { type: shot.type, t: +shot.t.toFixed(1), dur: +shot.dur.toFixed(1) },
      cam: { x: Math.round(cam.x), y: Math.round(cam.y), z: +cam.z.toFixed(2) }, track: track.p && { x: Math.round(track.p.x), y: Math.round(track.p.y), vx: +track.v.x.toFixed(2), vy: +track.v.y.toFixed(2) },
      world: [E.info.W, E.info.H], simRate: +simRate.toFixed(2), band: bandBox(), steps: S.stepCap, mass: S.stats && +S.stats.mass.toFixed(1) });
    showScene();
    (function drive(now) {
      requestAnimationFrame(drive);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      t += dt; sceneT += dt; shot.t += dt;
      if (now - wall0 > 2000) { if (wall0) simRate = 0.5 * simRate + 0.5 * Math.max(0.05, (S.time - simT0) / ((now - wall0) / 1000)); wall0 = now; simT0 = S.time; }
      if (now - bandAt > 250 && plateBand) { bandAt = now; band = plateBand(innerHeight); }
      S.saverOcc = { x: 0, y: bandBox().oy };
      if (sceneT > 0.5 && ++gridF % 12 === 0) readGrid();
      if (shot.t > shot.dur) {
        if (si + 1 >= scene.shots.length) { showScene(); t = 0; } else nextShot();
      }
      // A creature set that dies leaves an empty world: stamp it again. The
      // copy goes to black across the 1 s wait and fades in on the new stamp.
      // A set that fills the world after a collision ends the scene.
      if (S.stats && !mass0 && S.time > 1) mass0 = S.stats.mass;
      const bloom = scene.kind !== 'grow' && mass0 > 0 && S.stats && S.stats.mass > 2.5 * mass0;
      if (S.stats && (S.stats.mass < 1e-3 || bloom) && S.time > 2) {
        if ((dead += dt) > 1) { if (bloom) showScene(); else { stage(); tIn = t; } dead = 0; }
      } else dead = 0;
      // Ease the camera to the pose. A fixed pose holds still.
      const p = pose(shot.t), { W, H } = E.info, a = 1 - Math.exp(-dt * 3), az = 1 - Math.exp(-dt * 2);
      cam.x = wrap(cam.x + wrapDelta(p.x - cam.x, W) * a, W); cam.y = wrap(cam.y + wrapDelta(p.y - cam.y, H) * a, H);
      cam.z += (p.z - cam.z) * az;
      E.setView({ cx: cam.x, cy: cam.y, zoom: cam.z });
      if (cv.width !== gl.width || cv.height !== gl.height) { cv.width = gl.width; cv.height = gl.height; }
      c2.drawImage(gl, 0, 0);
      const left = scene.shots.length - si - 1;
      const f = Math.max(0, 1 - t / FADE, left ? 0 : 1 - (shot.dur - shot.t) / FADE, Math.min(1, dead), 1 - (t - tIn) / FADE);
      if (f > 0) { c2.fillStyle = `rgba(0,0,0,${Math.min(1, f)})`; c2.fillRect(0, 0, cv.width, cv.height); }
    })(0);
    return { canvas: cv, warmupMs: 1500 };
  },
};
