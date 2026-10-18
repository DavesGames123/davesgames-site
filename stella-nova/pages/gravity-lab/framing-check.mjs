// ============================================================================
//  GRAVITY LAB  ·  framing-check.mjs — the action framing on the CPU (node)
// ----------------------------------------------------------------------------
//  tests.mjs runs it (the A tests); node framing-check.mjs [key] runs it
//  alone and prints the numbers of each run.
//
//  runFraming(spec, X, o) runs one experiment on the CPU (lab.js Lab with
//  the CPU backends, the page's data path: a particle readback every
//  READ_S s, focus.js sampleRows and partsInFrame), the director
//  (director.js direct) and four cameras (stepCam): 16:9 and 9:16, full
//  screen and inside a saver plate band. It returns per run:
//    minW, meanW   the share of the action weight (the calm sample of
//                  focus.js) that projects inside the screen or band, on
//                  calm frames 1.5 s or more after a change of focus
//    pairOut       frames with a pair body out of the screen (1 s after
//                  the pair took the camera)
//    aimRate       the largest eased aim step per second over the distance
//                  (stepCam easeStep; the carried motion of a moving goal
//                  is not in it: trackRate has both)
//    zoomRate      the largest |d log(distance)| per second
//    jerk          the largest change of the aim step between two frames,
//                  over the distance (shake)
//    saver         the same with the saver shots (saver-plan.js shotPlan,
//                  shotFrame): the weight share of establish and top shots
//                  in the band, the subject of the close shots in the band
//
//  grep -n targets: "export function runFraming", "export function escapeRun",
//  "export const SCREENS"
// ============================================================================
import * as N from './nbody.js';
import * as L from './lab.js';
import * as F from './frame.js';
import * as D from './director.js';
import * as Z from './size.js';
import * as FO from './focus.js';
import * as SP from './saver-plan.js';
import { dominant } from './items.js';

export const SCREENS = [
  { name: '16:9', W: 1600, H: 900, band: null }, { name: '16:9 saver', W: 1600, H: 900, band: { t: 0.2 * 900, b: 0.3 * 900 } },
  { name: '9:16', W: 540, H: 960, band: null }, { name: '9:16 saver', W: 540, H: 960, band: { t: 0.22 * 960, b: 0.34 * 960 } },
];
const TR = 420;

function eyeOf(c, az, el) {
  return [c.target[0] + c.dist * Math.cos(el) * Math.cos(az), c.target[1] + c.dist * Math.cos(el) * Math.sin(az), c.target[2] + c.dist * Math.sin(el)];
}
function camOf(c, az, el) { return { eye: eyeOf(c, az, el), target: c.target, up: [0, 0, 1], fovy: D.DIR.FOV, shiftY: c.shiftY }; }
const boxOf = S => [0, S.W, S.band ? S.band.t : 0, S.band ? S.H - S.band.b : S.H];

// o: { sec (real seconds), dt, saver (bool), onFrame (each page camera
// each frame: { t, s, S, cam, d, fr, sys, sample, lab, rNow, trails }) }
export function runFraming(spec, X, o = {}) {
  const SEC = o.sec ?? 16, DT = o.dt ?? 1 / 30;
  const lab = new L.Lab(spec, (cap, sp) => sp.self ? new L.CpuSelf(cap, sp) : new L.CpuRestricted(cap));
  const sys = lab.sys, ext = spec.view.extent, dir = D.makeDirector();
  const P = spec.self || spec.particles, group = P && P.group;
  const meta = (spec.bodies || []).map(b => ({ rDraw: b.rDraw || b.r || 0.01, r0: b.r || 0, m0: b.m }));
  const trails = meta.map(() => ({ pts: new Float32Array(3 * TR), n: 0, head: 0, last: null }));
  const rnd = N.rng((spec.seed || 1) * 7 + 3), az = 2 * Math.PI * rnd(), el = 0.15 + 1.0 * rnd();
  const cams = SCREENS.map(() => ({ cut: true }));
  const res = { minW: 1, sumW: 0, nW: 0, pairOut: 0, pairChecked: 0, aimRate: 0, zoomRate: 0, jerk: 0, worst: '', frames: 0, pairFrames: 0, gone: 0 };
  const prev = SCREENS.map(() => null);
  let sample = null, readAt = -Infinity, fk = '', fAt = 0, t = 0;
  // the saver: its own director and cameras, shots on a seeded clock
  const sv = o.saver ? { rnd: N.rng((spec.seed || 1) * 13 + 5), d: D.makeDirector(), cams: SCREENS.map(() => ({ cut: true })), minW: 1, sumW: 0, nW: 0, subjOut: 0, subjChecked: 0 } : null;
  if (sv) { sv.shots = SP.shotPlan(sv.rnd, !!spec.self); sv.si = 0; sv.at = 0; }
  for (let k = 0; k < SEC / DT; k++) {
    for (const e of lab.frame(spec.rate * DT)) { D.noteEvent(dir, e, ext); if (sv) D.noteEvent(sv.d, e, ext); }
    t += DT;
    for (let i = 0; i < 3 * sys.n; i++) if (!isFinite(sys.x[i])) return Object.assign(res, { dead: true });
    const fr = F.frameOf(sys, spec.view, -1), mMax = Z.heaviest(sys), rNow = [];
    if (P && P.n && t - readAt >= FO.FOCUS.READ_S) { readAt = t; sample = FO.sampleRows(lab.be.readback().body, lab.cap, lab.t, fr); }
    for (let i = 0; i < sys.n; i++) {
      const m = meta[i], grow = m.r0 > 0 ? sys.R[i] / m.r0 : 1;
      rNow.push(Z.drawRadius(m.rDraw * (grow > 0 && isFinite(grow) ? grow : 1), sys.m[i], mMax, ext, sys.R[i]));
      const T = trails[i]; if (!sys.alive[i]) continue;
      const p = F.toFrame(fr, sys.pos(i));
      if (T.last && Math.hypot(p[0] - T.last[0], p[1] - T.last[1], p[2] - T.last[2]) < ext * 0.0025) continue;
      T.pts.set(p, 3 * T.head); T.head = (T.head + 1) % TR; T.n = Math.min(TR, T.n + 1); T.last = p;
    }
    const inF = sample ? FO.partsInFrame(sample, fr, lab.t, group, ext) : null;
    const opt = { view: spec.view, ext, rNow, parts: !!(P && P.n), trail: i => D.ringTail(trails[i], D.DIR.TRAIL_K), spec, focus: X && X.focus, sample: inF, pending: !!(P && P.n) && !sample, t: lab.t };
    const d = D.direct(dir, sys, fr, DT, opt);
    res.frames++;
    const key = d.mode + ':' + d.i + ':' + d.j;
    if (key !== fk) { fk = key; fAt = t; }
    if (d.mode !== 'calm') res.pairFrames++;
    // the page cameras
    for (let s = 0; s < SCREENS.length; s++) {
      const S = SCREENS[s], c = D.stepCam(cams[s], d, S.W, S.H, S.band, DT);
      if (o.onFrame) o.onFrame({ t, s, S, cam: camOf(c, az, el), d, fr, sys, sample: inF, lab, rNow, trails });
      const cur = { target: c.target.slice(), dist: c.dist };
      const pv = prev[s];
      if (pv && t > 0.5) {
        res.aimRate = Math.max(res.aimRate, (c.easeStep || 0) / cur.dist / DT);
        res.trackRate = Math.max(res.trackRate || 0, Math.hypot(cur.target[0] - pv.target[0], cur.target[1] - pv.target[1], cur.target[2] - pv.target[2]) / cur.dist / DT);
        res.zoomRate = Math.max(res.zoomRate, Math.abs(Math.log(cur.dist / pv.dist)) / DT);
        if (pv.step) { const j = Math.hypot(...[0, 1, 2].map(q => (cur.target[q] - pv.target[q]) - pv.step[q])) / cur.dist; res.jerk = Math.max(res.jerk, j); }
        cur.step = [0, 1, 2].map(q => cur.target[q] - pv.target[q]);
      }
      prev[s] = cur;
      if (t < 3 || t - fAt < 1.5) continue;
      const cam = camOf(c, az, el), proj = p => D.project(cam, p, S.W, S.H), box = boxOf(S);
      if (d.mode === 'calm' && d.calm && d.calm.sample) {
        const w = FO.weightInView(d.calm.sample, proj, box);
        res.sumW += w; res.nW++;
        if (w < res.minW) { res.minW = w; res.worst = `${S.name} t ${t.toFixed(1)}`; }
      } else if (d.mode !== 'calm' && t - fAt >= 1.0) {
        for (const i of (d.j >= 0 ? [d.i, d.j] : [d.i])) {
          res.pairChecked++;
          const q = proj(F.toFrame(fr, sys.pos(i)));
          if (!q || q.x < box[0] || q.x > box[1] || q.y < box[2] || q.y > box[3]) res.pairOut++;
        }
      }
      // never aim at a body that has left
      if (d.mode !== 'calm' && d.gone && (d.gone[d.i] || (d.j >= 0 && d.gone[d.j]))) res.gone++;
    }
    // the saver
    if (sv) {
      const ds = D.direct(sv.d, sys, fr, DT, opt);
      const sk = ds.mode + ':' + ds.i + ':' + ds.j; if (sk !== sv.fk) { sv.fk = sk; sv.fAt = t; }
      let sh = sv.shots[sv.si], el0 = (t - sv.at);
      if (el0 >= sh.len) { sv.si = (sv.si + 1) % sv.shots.length; sv.at = t; sh = sv.shots[sv.si]; el0 = 0; for (const c of sv.cams) c.cut = true; if (sv.si === 0) sv.shots = SP.shotPlan(sv.rnd, !!spec.self); }
      const u = Math.min(1, el0 / sh.len);
      // the subject (app/saver.js cutTo): picked at the cut (the largest
      // pull, not a fast body); the pair's first body while a pair has the
      // camera. The close framing: the pair, or the subject and its trail.
      if (el0 === 0 || sv.subject === undefined) {
        const dom = dominant(sys), om = (i, j) => { const r = N.v3.sub(sys.pos(i), sys.pos(j)), v = N.v3.sub(sys.vel(i), sys.vel(j)); return N.v3.len(N.v3.cross(r, v)) / Math.max(1e-300, N.v3.dot(r, r)); };
        const st = []; for (let i = 0; i < sys.n; i++) st.push({ i, alive: !!sys.alive[i] && !(ds.gone && ds.gone[i]), m: sys.m[i], a: Math.hypot(sys.a[3 * i], sys.a[3 * i + 1], sys.a[3 * i + 2]), dom: !!dom && dom.i === i, fast: !!dom && dom.i !== i && SP.tooFast(om(i, dom.i), spec.rate) });
        sv.subject = ds.mode !== 'calm' ? ds.i : sys.n ? SP.pickSubject(st, sv.rnd) : -1;
      }
      if (ds.mode !== 'calm' && sv.subject !== ds.i && sv.subject !== ds.j) sv.subject = ds.i;
      let close = ds;
      const sub = sv.subject;
      if (ds.mode === 'calm' && sh.kind !== 'establish' && sh.kind !== 'top' && sub >= 0 && sys.alive[sub] && !(ds.gone && ds.gone[sub])) {
        const f = D.frameSet(sys, fr, [sub], ext, rNow, i => D.ringTail(trails[i], D.DIR.TRAIL_K));
        close = { mode: 'one', i: sub, j: -1, target: f.target, radius: Math.min(ds.calm.radius, Math.max(f.radius, 0.12 * ext)) };
      }
      const g = SP.shotFrame(sh, u, ds, close, 0.7);
      for (let s = 0; s < SCREENS.length; s++) {
        const S = SCREENS[s]; if (!S.band) continue;
        const c = D.stepCam(sv.cams[s], g.frame, S.W, S.H, S.band, DT, g.zoomK);
        if (t < 3 || el0 < 1.5 || t - sv.fAt < 1.5) continue;
        const cam = camOf(c, g.az, g.el), proj = p => D.project(cam, p, S.W, S.H), box = boxOf(S);
        if ((sh.kind === 'establish' || sh.kind === 'top') && ds.mode === 'calm' && ds.calm.sample) {
          const w = FO.weightInView(ds.calm.sample, proj, box); sv.sumW += w; sv.nW++; sv.minW = Math.min(sv.minW, w);
        } else if (g.frame.i >= 0 && sh.kind !== 'push') {
          sv.subjChecked++;
          const q = proj(F.toFrame(fr, sys.pos(g.frame.i)));
          if (!q || q.x < box[0] || q.x > box[1] || q.y < box[2] || q.y > box[3]) sv.subjOut++;
        }
      }
    }
  }
  res.meanW = res.nW ? res.sumW / res.nW : 1;
  if (sv) res.saver = { minW: sv.nW ? sv.minW : 1, meanW: sv.nW ? sv.sumW / sv.nW : 1, nW: sv.nW, subjOut: sv.subjOut, subjChecked: sv.subjChecked };
  res.lab = lab;
  return res;
}

// A binary and a body thrown out at three times the escape speed: the
// framing must stay on the binary. Returns { r0, rEnd, dEnd, aimOff }.
export function escapeRun(sec = 20, DT = 1 / 30) {
  const B = [
    { name: 'A', kind: 'star', m: 1, r: 0.01, x: [-0.25, 0, 0], v: [0, -1, 0], color: [1, 1, 1], rDraw: 0.02 },
    { name: 'B', kind: 'star', m: 1, r: 0.01, x: [0.25, 0, 0], v: [0, 1, 0], color: [1, 1, 1], rDraw: 0.02 },
    { name: 'C', kind: 'rock', m: 0.3, r: 0.01, x: [0, 1.2, 0], v: [0, 3 * Math.sqrt(2 * 2 / 1.2), 0], color: [1, 1, 1], rDraw: 0.01 },
  ];
  N.toCOM(B);
  const sys = new N.System(B, { eta: 0.01 }), view = { center: 'com', extent: 3, tilt: 40 }, ext = 3, dir = D.makeDirector();
  const spec = { key: 'escape', view, bodies: B };
  let r0 = 0, rEnd = 0, rMax = 0, dEnd = 0, aimOff = 0;
  for (let k = 0; k < sec / DT; k++) {
    sys.advance(0.4 * DT, 1);
    for (const e of sys.drain()) D.noteEvent(dir, e, ext);
    const fr = F.frameOf(sys, view, -1);
    const d = D.direct(dir, sys, fr, DT, { view, ext, rNow: [0.02, 0.02, 0.01], parts: false, trail: () => [], spec });
    if (k === 10) r0 = d.calm.radius;
    rEnd = d.calm.radius;
    const c = F.toFrame(fr, sys.pos(2)), bin = [F.toFrame(fr, sys.pos(0)), F.toFrame(fr, sys.pos(1))];
    const mid = [0, 1, 2].map(q => (bin[0][q] + bin[1][q]) / 2);
    dEnd = Math.hypot(c[0] - mid[0], c[1] - mid[1], c[2] - mid[2]);
    if (dEnd > 2 * ext) { rMax = Math.max(rMax, d.calm.radius); aimOff = Math.max(aimOff, Math.hypot(d.calm.target[0] - mid[0], d.calm.target[1] - mid[1], d.calm.target[2] - mid[2])); }
  }
  return { r0, rEnd, rMax, dEnd, aimOff };
}

// node framing-check.mjs [key]
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('framing-check.mjs')) {
  const XI = await import('./experiments/index.js');
  const only = process.argv[2];
  for (const [key, ex] of Object.entries(XI.EXPERIMENTS)) {
    if (only && key !== only) continue;
    for (const v of ex.variants) {
      const t0 = Date.now(), sp = XI.build(key, 1, { n: 400, variant: v });
      const r = runFraming(sp, ex, { sec: 16, saver: true });
      const s = r.saver || {};
      console.log(`${key}/${v}${ex.focus ? ' (hook)' : ''}: weight in view min ${r.minW.toFixed(2)} mean ${r.meanW.toFixed(2)} [${r.worst}] (${r.nW}); pair out ${r.pairOut}/${r.pairChecked}, pair ${(100 * r.pairFrames / r.frames).toFixed(0)}%; aim ${r.aimRate.toFixed(2)}/s track ${(r.trackRate||0).toFixed(2)}/s zoom ${r.zoomRate.toFixed(2)}/s jerk ${r.jerk.toExponential(1)}; saver min ${(s.minW ?? 1).toFixed(2)} mean ${(s.meanW ?? 1).toFixed(2)} (${s.nW}), subject out ${s.subjOut}/${s.subjChecked}${r.dead ? ' DEAD' : ''} [${Date.now() - t0} ms]`);
    }
  }
  console.log('escape', escapeRun());
}
