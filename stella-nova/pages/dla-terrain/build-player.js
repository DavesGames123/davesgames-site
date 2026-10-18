// ============================================================================
//  DLA TERRAIN  ·  build-player.js — "Watch it build": the player (CORE)
// ----------------------------------------------------------------------------
//  createBuildPlayer(env) -> player. main.js owns it. Every generation is
//  recorded (build.js createRecorder: the snapshots, shrunk to 512). When
//  the player is active, the snapshots do not go to the screen as they
//  come: the player shows the stage of its own clock t (build.js stateAt),
//  slowly, and the camera frames each stage (build.js camFor).
//
//  env = { app, cam, world, tg() (gpu/terrain-gpu.js), setTerrainAll(view),
//    overlay() (render/build.js module or null), ui, coarse, setMap(snap,
//    label) }
//  player.rec              the recorder of the newest generation
//  player.begin()          a generation starts (rec reset); active when
//                          app.buildMode or opts.force
//  player.record(p)        a progress message of the worker
//  player.finish(terrain)  the 'done' message
//  player.start(opts)      play the recorded timeline from 0 (a replay):
//                          opts = { speed, saver, yaw0 }
//  player.stop()           leave the build view: the final terrain (or the
//                          newest snapshot) goes on screen
//  player.tick(dt)         per frame: the clock (held while the generator
//                          is behind), the ground, the overlay, the walkers,
//                          the camera. Returns the state or null.
//  player.seek(t), seekSeg(i), step(d), togglePlay(), setSpeed(v),
//    cycleSpeed(), userCamera() (the user took the camera: the player gives
//    it back at the next stage)
//  player.info()           { t, total, i, name, caption, playing, held,
//                          ended, speed } for the bar and the saver plate
//
//  grep -n targets: "export function createBuildPlayer", "function applyGround",
//  "function applyOverlay", "function steerCamera"
// ============================================================================
import {
  SEGMENTS, TOTAL_S, SPEEDS, createRecorder, locate, ready, stateAt, camFor, walkers, timeOfSeg,
  treeField, raysField, flowField, erosionField, climateField, captionOf,
} from './build.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MODE = { tree: 1, rays: 2, flow: 3, erosion: 4, climate: 5 };
const DIM = { tree: 0.6, rays: 0.4, flow: 0.38, erosion: 0, climate: 0 };
const NWALK = 64;

export function createBuildPlayer(env) {
  const p = {
    rec: createRecorder({ maxN: 512 }), active: false, t: 0, speed: 1, playing: true, held: false, ended: false,
    saver: false, yaw0: 0, state: null, camFree: -1, gKey: null, oKey: null, seg: -1, river: null, flat: null,
  };
  const tg = () => env.tg();

  p.begin = (opts = {}) => {
    p.rec.reset();
    p.river = null;
    if (env.app.buildMode || opts.force) p.start(opts);
  };
  p.record = m => p.rec.add(m);
  p.finish = t => p.rec.finish(t);

  p.start = (opts = {}) => {
    p.active = true; p.t = 0; p.playing = true; p.ended = false; p.held = false;
    p.saver = !!opts.saver;
    if (opts.speed) p.speed = opts.speed;
    p.yaw0 = opts.yaw0 ?? env.cam.orbit.yaw;
    p.gKey = null; p.oKey = null; p.seg = -1; p.camFree = -1;
    const o = env.overlay();
    if (o) { o.setField(null); o.setParams({ mode: 0, veil: 0 }); }
  };
  p.stop = () => {
    if (!p.active) return;
    p.active = false;
    const o = env.overlay();
    if (o) { o.setField(null); o.setParams({ mode: 0, veil: 0, amount: 0 }); }
    const g = tg();
    if (!g) return;
    if (p.rec.terrain) env.setTerrainAll(g.finish(p.rec.terrain));
    else {
      const last = p.rec.order[p.rec.order.length - 1];
      if (last) { g.cpu = null; env.setTerrainAll(g.snapshot(last.snap, last.stage)); }
    }
    p.gKey = null; p.oKey = null;
  };

  p.seek = t => { if (!Number.isFinite(t)) return; p.t = clamp(t, 0, TOTAL_S); p.ended = p.t >= TOTAL_S; p.camFree = -1; };
  p.seekSeg = i => p.seek(timeOfSeg(clamp(i, 0, SEGMENTS.length - 1), 0));
  p.step = d => {
    const L = locate(p.t);
    // Prev in the first 1.5 s of a stage goes to the stage before
    if (d < 0) p.seekSeg(p.t - L.t0 > 1.5 ? L.i : L.i - 1);
    else p.seekSeg(Math.min(SEGMENTS.length - 1, L.i + 1));
  };
  p.togglePlay = () => {
    if (p.ended) { p.seek(0); p.playing = true; return; }
    p.playing = !p.playing;
  };
  p.setSpeed = v => { p.speed = clamp(+v || 1, 0.25, 8); };
  p.cycleSpeed = () => { const k = SPEEDS.indexOf(p.speed); p.setSpeed(SPEEDS[(k + 1) % SPEEDS.length]); return p.speed; };
  p.userCamera = () => { p.camFree = locate(p.t).i; };

  p.info = () => {
    const st = p.state || stateAt(p.rec, p.t);
    const c = captionOf(st);
    return { t: p.t, total: TOTAL_S, i: st.i, u: st.u, name: c.name, caption: c.caption, label: c.label, playing: p.playing, held: p.held, ended: p.ended, speed: p.speed };
  };

  // ── ground: a flat plain for DLA, then the recorded snapshots
  function applyGround(st) {
    const g = tg();
    const gr = st.ground;
    if (!g || gr.key === p.gKey) return;
    // a frame that is not there yet (the ground keeps what it shows)
    if (gr.kind === 'frame' && !gr.frame) return;
    if (gr.kind === 'final' && !p.rec.terrain) return;
    p.gKey = gr.key;
    const secs = clamp(st.seg.dur * (gr.blend || 0.1) / p.speed, 0.25, 8);
    let view;
    if (gr.kind === 'final') {
      view = g.finish(p.rec.terrain, secs);
      env.setMap(p.rec.terrain, 'Done');
    } else {
      let snap;
      if (gr.kind === 'flat') snap = flatSnap();
      else if (gr.kind === 'snapFinal' && p.rec.terrain) {
        const t = p.rec.terrain;
        snap = { n: t.n, height: t.height, biome: t.biome, moisture: t.moisture, worldSize: t.worldSize, seaLevel: t.seaLevel, heightScale: t.heightScale };
      } else snap = gr.frame.snap;
      g.cpu = null;
      view = g.snapshot(snap, st.seg.id, secs);
      view.cpu = null;
      if (gr.kind !== 'flat') env.setMap(snap, st.seg.name);
    }
    env.setTerrainAll(view);
  }
  function flatSnap() {
    const first = p.rec.order[0];
    const ws = (first && first.snap.worldSize) || (tg() && tg().worldSize) || 16000;
    const sea = first && Number.isFinite(first.snap.seaLevel) ? first.snap.seaLevel : 0;
    if (!p.flat || p.flat.worldSize !== ws || p.flat.seaLevel !== sea) {
      p.flat = { n: 16, height: new Float32Array(256).fill(Math.max(sea, 0) + 25), worldSize: ws, seaLevel: sea };
    }
    return p.flat;
  }

  // ── overlay: the field texture (rebuilt when the key changes) + params
  function applyOverlay(st, dt) {
    const o = env.overlay();
    if (!o) return;
    const ov = st.overlay;
    const ws = (tg() && tg().worldSize) || 16000;
    if (ov.key !== p.oKey) {
      p.oKey = ov.key;
      let f = null;
      const N = env.coarse ? 512 : 1024;
      try {
        if (ov.kind === 'tree') f = treeField(ov.frame.snap.dla, ws, N);
        else if (ov.kind === 'rays') f = raysField(ov.frame.snap, ws, N);
        else if (ov.kind === 'flow') f = flowField(ov.frame.snap);
        else if (ov.kind === 'erosion') f = erosionField(ov.frame.snap, ov.base);
        else if (ov.kind === 'climate') f = climateField(ov.frame.snap);
      } catch (e) { console.warn('dla-terrain: build overlay', e); f = null; }
      o.setField(f);
    }
    o.setParams({
      mode: ov.kind ? MODE[ov.kind] : 0, reveal: ov.reveal, amount: ov.amount, amount2: ov.amount2,
      veil: st.veil, dim: DIM[ov.kind] || 0, time: p.t,
    });
    if (ov.kind === 'tree' && ov.frame) {
      const w = walkers(ov.frame.snap.dla, ov.reveal, NWALK, performance.now() / 1000, ws);
      o.setWalkers(w, NWALK);
    } else o.setWalkers(null, 0);
  }

  // ── camera: ease the orbit to the plan of the stage
  function riverTarget() {
    if (p.river) return p.river;
    const f = p.rec.frames('rivers');
    const fr = f.length ? f[f.length - 1] : null;
    if (!fr || !fr.snap.flow) return null;
    const s = fr.snap, n = s.n, ws = s.worldSize || 16000, sea = s.seaLevel ?? 0;
    let best = -1, bv = -1;
    for (let j = Math.floor(n * 0.2); j < n * 0.8; j += 2) for (let i = Math.floor(n * 0.2); i < n * 0.8; i += 2) {
      const k = j * n + i;
      if (s.height[k] < sea + 5) continue;
      const v = s.flow[k];
      if (v > bv) { bv = v; best = k; }
    }
    if (best < 0) return null;
    const x = ((best % n) + 0.5) / n * ws - ws / 2, z = (Math.floor(best / n) + 0.5) / n * ws - ws / 2;
    p.river = [x, z];
    return p.river;
  }
  function steerCamera(st, dt) {
    const cam = env.cam, world = env.world;
    if (p.camFree === st.i && !p.saver) return;
    if (p.camFree !== -1 && p.camFree !== st.i) p.camFree = -1;
    if (cam.mode !== 'orbit') { cam.mode = 'orbit'; env.app.camMode = 'orbit'; }
    cam.orbitGoal = null;
    const portrait = innerHeight > innerWidth * 1.05;
    const c = camFor(st.i, st.u, { yaw0: p.yaw0, t: p.t, portrait });
    const ws = world.size;
    let tx = 0, tz = 0;
    if (c.low) { const r = riverTarget(); if (r) { const k = st.seg.id === 'rivers' ? clamp(st.u / 0.6, 0, 1) : 1; tx = r[0] * 0.75 * k; tz = r[1] * 0.75 * k; } }
    const ty = Math.max(world.heightAt(tx, tz), world.seaLevel);
    const o = cam.orbit, k = 1 - Math.exp(-dt * (p.seg !== st.i ? 1.2 : 1.6));
    let dy = c.yaw - o.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    o.yaw += dy * k;
    o.pitch += (c.pitch - o.pitch) * k;
    const want = Math.min(c.distK * ws, c.distMax || Infinity) * (env.distK ? env.distK() : 1);
    o.dist += (want - o.dist) * k;
    o.target = [o.target[0] + (tx - o.target[0]) * k, o.target[1] + (ty - o.target[1]) * k, o.target[2] + (tz - o.target[2]) * k];
  }

  p.tick = dt => {
    if (!p.active) return null;
    // the clock: held while the data of the moment has not come yet
    p.held = !ready(p.rec, p.t);
    if (p.playing && !p.held && !p.ended) {
      const nt = p.t + dt * p.speed;
      // never run into a stage whose data is not there
      p.t = ready(p.rec, Math.min(nt, TOTAL_S)) ? Math.min(nt, TOTAL_S) : p.t;
      if (p.t >= TOTAL_S) p.ended = true;
    }
    const st = stateAt(p.rec, p.t);
    p.state = st;
    applyGround(st);
    applyOverlay(st, dt);
    steerCamera(st, dt);
    p.seg = st.i;
    return st;
  };
  return p;
}
