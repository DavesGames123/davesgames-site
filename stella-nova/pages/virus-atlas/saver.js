// ============================================================================
//  VIRUS ATLAS  ·  saver.js — the screensaver tour (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm, seconds, caption, seed, label }. shots.js plan() draws each
//  shot from seeded weighted bags: the effect, the entry, the view and
//  a second view to morph into, the colour scheme, palette, light rig,
//  camera move, peel order, explode axes and slice style. Shots last 5
//  to 12 s, so every run differs. Effects (SETUP):
//    assemble  builds from its subunits
//    peel      subunits lift off by the camera side, latitude, symmetry
//              copy, outer shell, spiral or random tiles; some close again
//    inside    the near half or the outer shell peels, then the camera
//              goes in to the inner surface or the inner shell
//    explode   opens along 5-, 3- or 2-fold axes (or radially), closes
//    implode   starts open, closes
//    slice     a plane cuts to the centre, or a thin slab sweeps through
//    axes      down a 5-fold, a 3-fold, then a 2-fold axis
//    spikes    a push-in on one swaying spike of a virion
//    grow      a fibril grows at both ends
//    morph     one view turns into another, mid-shot (a drawing change)
//    protein   one protein builds and turns
//    ladder    the zoom from a 4 nm protein to the 300 nm TMV rod
//    exview    the exploded view (regions.js explodePlan): the parts leave
//              one group at a time along 5-, 3-, 2-fold, radial lines or
//              capsomer by capsomer, hold apart while the camera flies to
//              one part and then to its neighbour, and close again (or
//              stay open for the next shot of a chapter)
//    inspect   one region (regions.js regionsOf) lifts out; the rest turns
//              to a ghost or moves away; the camera pushes in and turns
//              round it; the view morphs to a tube or space-filling and
//              the colour to chain or secondary structure; the plate names
//              the region, its chains, symmetry and size; then it rejoins
//  Any shot but the ladder and the axes may also morph its view.
//  CHAPTERS (shots.js): 3 shots on one capsid with no cut between them
//  (cont): the entry, the camera and the open shell carry over.
//
//  CAMERA  (app.A.camLock) moves: orbit, pushin (to a point on the
//  surface), pullout, crane (pole to equator), arc (a fast half turn),
//  dutch (an orbit with a slow roll), flyby (the target slides past).
//  exview and inspect give a pose(t) instead (target, direction,
//  distance), blended between key poses with easeInOut, log distance
//  and a slerp of the direction. A critically damped spring follows the
//  goal, so a new goal never snaps the camera; only a cut does.
//
//  FRAME  main.js adds the plate's clear band (plateBand from
//  lib/saver-clear.js) to its occlusion, so the view offset centres the
//  subject in the band, and fitDistance() sizes it for the band.
//
//  PLATE  name, the shot line, PDB ID, disease, the view (and the morph
//  target), the colour scheme; TeX for the T number of a capsid
//  (T = h^2 + hk + k^2, N = 60 T) and the screw of a rod or fibril.
//  A morph says that it is a change of drawing style. No code. An
//  exploded view names its axis set and stagger; an inspection names
//  the region, its chains, its size in nm and its symmetry (TeX), and
//  says that the lift and the ghost are a drawing aid.
//
//  EXIT  puts back the user's entry, mode, view, colours and toggles.
//
//  grep -n targets: "const SETUP", "const CAMS", "function nextShot",
//                   "function tick", "function plate", "window.snSaver",
//                   "function tourCtx", "function blendPose"
// ============================================================================
import * as THREE from 'three';
import { plan, PEELS, EXES } from './shots.js';
import { entryByKey, pdbsOf, CREDIT, TEX } from './catalog.js';
import { SCHEMES, PALETTES, LIGHTS } from './colors.js';
import { easeInOut, smooth } from './symmetry.js';
import { unitTable, capsomers, regionsOf, explodePlan, explodeAmount, partCentre, selTable, regionExtent, REGION_NAMES, TIMELINE } from './regions.js';
import { EX_STYLES, STAGGERS } from './shots.js';

export function installSaver(app) {
  const { G, A, V } = app;
  let S = null;

  const camDir = (az, el) => new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const viewDir = () => V.camera.position.clone().sub(app.controls.target).normalize();
  const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-3, b - a));
  const lin = (t, a, b) => Math.min(1, Math.max(0, (t - a) / Math.max(1e-3, b - a)));
  const V3 = a => new THREE.Vector3(a[0], a[1], a[2]);

  // ── the tour data of the entry on screen (cached on it) ─────────────────
  function tourCtx(B) {
    if (B._tour) return B._tour;
    const e = B.entry;
    const parts = B.parts.map(p => {
      const T = unitTable(p.d, p.ops), axes = p.axes && p.axes.length ? p.axes : [];
      return { part: p, T, axes, caps: e.look === 'capsid' || e.look === 'cone' ? capsomers(T, e, axes) : [] };
    });
    B._tour = { parts, regions: regionsOf(e, parts.map(P => ({ d: P.part.d, ops: P.part.ops, axes: P.axes, T: P.T, caps: P.caps }))) };
    return B._tour;
  }
  const exAmpOf = (look, ex) => look === 'virion' ? 0.3 : look === 'cone' ? 0.32 : ex === 'cap' ? 0.55 : ex === -1 ? 0.42 : 0.5;
  // A pose: { tgt, dir (unit, target to camera), dist }. Blend a -> b by s.
  function blendPose(a, b, s) {
    s = easeInOut(s);
    if (s <= 0) return a; if (s >= 1) return b;
    const q = new THREE.Quaternion().setFromUnitVectors(a.dir, b.dir), qs = new THREE.Quaternion().slerp(q, s);
    return { tgt: a.tgt.clone().lerp(b.tgt, s), dir: a.dir.clone().applyQuaternion(qs), dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * s) };
  }
  // keys: [[u, poseFn(u)] ...] in time order; hold each key, blend between
  function keyPose(u, keys) {
    if (u <= keys[0][0]) return keys[0][1](u);
    for (let i = 0; i < keys.length - 1; i++) {
      const [u0, f0] = keys[i], [u1, f1] = keys[i + 1];
      if (u <= u1) return blendPose(f0(u), f1(u), (u - u0) / Math.max(1e-3, u1 - u0));
    }
    return keys[keys.length - 1][1](u);
  }
  const sideOf = d => { const s = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.95 ? _up : new THREE.Vector3(1, 0, 0)); return s.normalize(); };
  // the whole particle, turning slowly about y from the start direction
  const wholePose = (dir0, spin, rMul) => u => {
    const B = app.cur, d = dir0.clone().applyAxisAngle(_up, spin * u);
    return { tgt: new THREE.Vector3(), dir: d, dist: app.fitDistance((B ? B.r : 30) * rMul(u)) };
  };
  // the open shell carries over a chapter: S.ex = { plans, stag, amp, ex }
  function setTour(o) {
    A.tour = Object.assign(A.tour || { exT: 0, exStag: 0, exAmp: 0, iso: 0, ghost: 0.3, lift: 0, liftDir: new THREE.Vector3(0, 1, 0), away: 0 }, o);
  }

  // camera moves: base { az, spin, el0, el1, z0, z1 } plus per-frame extras
  const CAMS = {
    orbit: r => ({ az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.07, 0.13), el0: r.range(0.1, 0.45), el1: r.range(0.15, 0.5), z0: 1.08, z1: 0.96 }),
    pushin: r => ({ az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.03, 0.06), el0: r.range(0.1, 0.4), el1: r.range(0.2, 0.5), z0: 1.15, z1: 0.5, push: 0.55 }),
    pullout: r => ({ az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.04, 0.07), el0: r.range(0.2, 0.5), el1: r.range(0.0, 0.3), z0: 0.5, z1: 1.12, push: -0.55 }),
    crane: r => { const up = r.pick([-1, 1]); return { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.03, 0.06), el0: up * 1.1, el1: -up * 0.15, z0: 1.05, z1: 0.92 }; },
    arc: r => ({ az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.3, 0.42), el0: r.range(-0.2, 0.2), el1: r.range(0.3, 0.6), z0: 1.0, z1: 0.9, ease: true }),
    dutch: r => ({ az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.05, 0.09), el0: r.range(0.1, 0.4), el1: r.range(0.1, 0.4), z0: 1.0, z1: 0.88, roll: r.pick([-1, 1]) * r.range(0.25, 0.45) }),
    flyby: r => ({ az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.02, 0.05), el0: r.range(0.0, 0.3), el1: r.range(0.1, 0.4), z0: 0.78, z1: 0.72, slide: r.pick([-1, 1]) }),
  };

  // Each setup(shot, r) returns { sub, start: 'asm' | 'full', axes?,
  // ladder?, cam?, init?(), at?(t, dur), dirAt?(t, dur) }
  const SETUP = {
    assemble() { return { sub: 'builds itself from its subunits', start: 'asm' }; },
    peel(sh, r) {
      const reach = sh.peel === 3 ? r.range(0.35, 0.55) : r.range(0.45, 0.8);
      let n = null;
      return { sub: 'subunits lift off by ' + PEELS[sh.peel] + (sh.reclose ? ', then the shell closes again' : ''), start: 'full',
        init() { A.peelMode = sh.peel; A.peelReach = reach; A.spiral = r.range(3, 7); },
        at(t, dur) {
          if (!n && t > dur * 0.1) { n = sh.peel === 2 || sh.peel === 3 || sh.peel === 5 ? viewDir() : viewDir().lerp(new THREE.Vector3(0, 1, 0), 0.25).normalize(); A.peelN.copy(n); }
          // the order shows best when the threshold walks slowly
          const up = ramp(t, dur * 0.1, dur * (sh.reclose ? 0.5 : 0.8)), down = sh.reclose ? ramp(t, dur * 0.66, dur * 0.95) : 0;
          A.peelT = Math.max(0, up - down);
        } };
    },
    inside(sh, r) {
      const shell = sh.peel === 3;
      let done = false;
      return { sub: shell ? 'the outer shell lifts off to show the shell inside' : 'the near half lifts off; the camera goes in to the inner surface', start: 'full', inside: true,
        init() { A.peelMode = shell ? 3 : 0; A.peelReach = shell ? 0.5 : 0.5; },
        at(t, dur) {
          if (!done && t > dur * 0.08) { done = true; A.peelN.copy(viewDir()); }
          A.peelT = ramp(t, dur * 0.08, dur * 0.4);
          // in to the inside: the camera ends 0.55 R from the centre (inside
          // the shell), or 1.7 R out for the inner shell
          const B = app.cur, f = B ? (shell ? 1.7 : 0.55) * B.r / Math.max(1e-3, app.fitDistance(B.r)) : 1;
          S.zoomMul = 1 + (f - 1) * ramp(t, dur * 0.35, dur * 0.95);
        } };
    },
    explode(sh) {
      return { sub: 'opens along its ' + EXES[sh.ex] + ', then closes', start: 'full',
        init() { A.exOrder = sh.ex; },
        at(t, dur) { A.explodeT = t > dur * 0.15 && t < dur * 0.68 ? 1 : 0; } };
    },
    implode(sh) {
      return { sub: 'closes up along its ' + EXES[sh.ex], start: 'full',
        init() { A.exOrder = sh.ex; A.explode = A.explodeT = 1; },
        at(t, dur) { A.explodeT = t < dur * 0.25 ? 1 : 0; } };
    },
    slice(sh, r) {
      const slab = sh.slice === 'slab';
      let n = null;
      return { sub: slab ? 'a thin slab sweeps through to show the cross-section' : 'a plane cuts through to show the inside', start: 'full',
        init() { A.slab = slab ? app.cur.r * r.range(0.08, 0.14) : 0; },
        at(t, dur) {
          if (!n) { n = viewDir(); A.sliceN.copy(n); }
          A.sliceT = slab ? 0.05 + 1.9 * ramp(t, dur * 0.05, dur * 0.95) : ramp(t, dur * 0.1, dur * 0.35);
        } };
    },
    axes(sh, r) {
      // init() runs once the entry is on screen: its axes are known then
      let seq = null;
      const labels = ['looking down a 5-fold axis', 'looking down a 3-fold axis', 'looking down a 2-fold axis'];
      return { sub: labels[0], axes: true, start: 'full', cam: { z0: 1.08, z1: 1.0 },
        init() {
          const ax = app.cur ? app.cur.axes : [];
          const all = o => ax.filter(a => a.order === o).map(a => new THREE.Vector3(...a.dir));
          const f = all(5);
          const d5 = (f[Math.floor(r.next() * f.length)] || new THREE.Vector3(0, 1, 0)).clone().multiplyScalar(r.pick([1, -1]));
          // the nearest 3-fold and 2-fold to that 5-fold, so the turns are short
          const near = o => all(o).map(v => v.dot(d5) < 0 ? v.negate() : v).sort((p, q) => q.dot(d5) - p.dot(d5))[0] || d5.clone();
          seq = [d5, near(3), near(2)];
        },
        dirAt(t, dur) {
          if (!seq) return new THREE.Vector3(0, 0, 1);
          const f = Math.min(2.999, 3 * t / dur), i = Math.floor(f), local = f - i;
          // hold 60% of each third, then turn to the next axis
          const s = i < 2 ? easeInOut((local - 0.6) / 0.4) : 0;
          const a = seq[i].clone().normalize(), b = seq[Math.min(2, i + 1)].clone().normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(a, b);
          const qs = new THREE.Quaternion().slerp(q, s);
          if (S && S.shot) S.shot.sub = labels[Math.min(2, s > 0.5 ? i + 1 : i)];
          return a.applyQuaternion(qs);
        } };
    },
    spikes() {
      let tgt = null;
      return { sub: 'a push-in on one spike; spikes sway on their stalks (illustration)', start: 'asm',
        at(t, dur) {
          const B = app.cur; if (!B || !B.parts[0]) return;
          if (!tgt) {
            // the spike nearest the camera
            const p = B.parts[0], cd = V.camera.position.clone().normalize();
            let best = -2, bk = 0;
            for (let k = 0; k < p.m; k++) { const v = new THREE.Vector3(p.ops[12 * k + 3], p.ops[12 * k + 7], p.ops[12 * k + 11]).normalize(); const d = v.dot(cd); if (d > best) { best = d; bk = k; } }
            tgt = new THREE.Vector3(p.ops[12 * bk + 3], p.ops[12 * bk + 7], p.ops[12 * bk + 11]).normalize().multiplyScalar(B.r * 0.86);
          }
          const s = smooth((t - dur * 0.25) / (dur * 0.65));
          S.target = new THREE.Vector3().lerpVectors(new THREE.Vector3(), tgt, s);
          S.zoomMul = 1 - 0.72 * s;
        } };
    },
    grow() { return { sub: 'grows at both ends: each new chain takes the fold of the layer below (an illustration of templating)', start: 'asm' }; },
    morph() { return { sub: 'one drawing style turns into another', start: 'full' }; },
    protein() { return { sub: 'chain by chain, then a slow turn', start: 'asm' }; },
    ladder() { return { sub: 'true relative sizes, from a 4 nm protein to the 300 nm TMV rod', ladder: true }; },

    // ── the exploded view ────────────────────────────────────────────────
    exview(sh, r) {
      const ex = sh.ex === 'cap' ? 'cap' : +sh.ex, stag = 0.6;
      let keys = null;
      const what = sh.ex === 'cap' ? 'separates capsomer by capsomer' : ex === -1 ? 'separates along radial lines' : 'separates along its ' + EX_STYLES[sh.ex];
      return { sub: what + ', ' + STAGGERS[sh.stag] + (sh.hold ? '' : ', then closes'), start: 'full', tour: true,
        init() {
          const B = app.cur, C = tourCtx(B), look = B.entry.look, amp = exAmpOf(look, ex);
          const camD = viewDir(), pole = [camD.x, camD.y, camD.z];
          const plans = C.parts.map(P => explodePlan(P.T, { mode: ex, stagger: sh.stag, pole, axes: P.axes, caps: P.caps, look }));
          C.parts.forEach((P, i) => P.part.setSel(selTable(P.T, plans[i])));
          S.ex = { plans, stag, amp, ex: sh.ex, stagName: sh.stag };
          setTour({ exT: 0, exStag: stag, exAmp: amp, iso: 0, lift: 0, away: 0 });
          // two parts to visit: the one that faces the camera, then a neighbour
          const P0 = C.parts[0], gs = plans[0].groups.filter(g => g.units.length);
          const facing = gs.map(g => ({ g, f: V3(g.centre).normalize().dot(camD) + 0.15 * r.next() })).sort((a, b) => b.f - a.f);
          const ga = facing[Math.min(facing.length - 1, Math.floor(r.next() * Math.min(3, facing.length)))].g;
          const ca = V3(ga.centre);
          const gb = gs.filter(g => g !== ga && V3(g.centre).normalize().dot(camD) > 0.1).sort((p, q) => V3(p.centre).distanceTo(ca) - V3(q.centre).distanceTo(ca))[0] || ga;
          const R = B.r, A0 = amp * R;
          const visit = g => {
            const ext = regionExtent(P0.T, g.units, g.centre, 3);
            const side = sideOf(V3(g.dir)), tilt = r.pick([-1, 1]) * 0.45;
            return u => {
              const c = V3(partCentre(P0.T, plans[0], g.units, A.tour.exT, stag, A0));
              const d = V3(g.dir).normalize().addScaledVector(side, tilt).normalize().applyAxisAngle(V3(g.dir).normalize(), 0.5 * (u - 0.5));
              return { tgt: c, dir: d, dist: app.fitDistance(ext * 2.1 + 1) };
            };
          };
          const open = () => 1 + amp * explodeAmount(A.tour ? A.tour.exT : 0, 0.5, stag);
          const whole = wholePose(camD, r.pick([-1, 1]) * 0.5, open);
          const va = visit(ga), vb = visit(gb);
          keys = sh.hold
            ? [[0.30, whole], [0.44, va], [0.54, va], [0.64, vb], [0.74, vb], [0.92, whole]]
            : [[0.32, whole], [0.44, va], [0.52, va], [0.61, vb], [0.68, vb], [0.82, whole]];
        },
        at(t, dur) {
          const u = t / dur;
          setTour({ exT: TIMELINE.exview(u, sh.hold) });
          if (S.shot) S.shot.phase = u < 0.38 ? 'open' : u < 0.72 ? 'parts' : sh.hold ? 'open' : 'close';
        },
        pose(t, dur) { return keys ? keyPose(t / dur, keys) : null; } };
    },

    // ── inspect one region ───────────────────────────────────────────────
    inspect(sh, r) {
      let keys = null, R0 = null, done = false;
      const name = REGION_NAMES[sh.region] || sh.region;
      return { sub: name + (sh.iso === 'away' ? ' lifts out while the rest moves away' : ' lifts out while the rest fades to a ghost'), start: 'full', tour: true,
        init() {
          const B = app.cur, C = tourCtx(B), look = B.entry.look;
          const reg = C.regions.find(x => x.kind === sh.region) || C.regions[0];
          if (!reg) return;
          const P0 = C.parts[reg.part], camD = viewDir();
          // an instance that faces the camera (a short flight), else any
          let inst;
          if (reg.inst[0].axis) {
            const sc = reg.inst.map(x => ({ x, f: V3(x.axis).dot(camD) + 0.25 * r.next() })).sort((a, b) => b.f - a.f);
            inst = sc[Math.min(sc.length - 1, Math.floor(r.next() * Math.min(3, sc.length)))].x;
          } else inst = r.pick(reg.inst);
          const fromEx = sh.fromEx && S.ex && A.tour;
          const plans = fromEx ? S.ex.plans : null, stag = fromEx ? S.ex.stag : 0, amp = fromEx ? S.ex.amp : 0;
          C.parts.forEach((P, i) => P.part.setSel(selTable(P.T, plans ? plans[i] : null, i === reg.part ? inst.units : [], inst.centre)));
          const flat = new THREE.Vector3(camD.x, 0, camD.z).normalize();
          // a rod or fibril part off the axis: look at it from its own side
          const cxz = Math.hypot(inst.centre[0], inst.centre[2]);
          const axis = inst.axis ? V3(inst.axis).normalize() : look === 'protein' ? camD.clone()
            : cxz > 1.5 ? new THREE.Vector3(inst.centre[0], 0, inst.centre[2]).normalize() : flat;
          const ext = regionExtent(P0.T, inst.units, inst.centre, inst.units.length > 60 ? 3 : 1);
          const lift = look === 'capsid' || look === 'cone' ? 0.16 * B.r : look === 'virion' ? 0.22 * B.r : 0;
          const away = sh.iso === 'away' ? (look === 'rod' || look === 'fibril' ? ext * 1.6 + 4 : 0.55 * B.r) : 0;
          setTour({ exT: fromEx ? 1 : 0, exStag: stag, exAmp: amp, iso: 0, ghost: sh.iso === 'away' ? 0.55 : 0.22, lift: 0, away: 0, liftDir: axis.clone() });
          R0 = { reg, inst, ext, lift, away, axis, fromEx, plans, stag, ampN: amp * B.r, P0 };
          const side = sideOf(axis), spin = r.pick([-1, 1]) * r.range(1.0, 1.5), tilt = r.range(0.35, 0.6);
          const centreAt = () => {
            const c = plans ? V3(partCentre(P0.T, plans[reg.part], inst.units, A.tour.exT, stag, R0.ampN)) : V3(inst.centre);
            return c.addScaledVector(axis, A.tour.lift);
          };
          const near = u => {
            const k = lin(u, 0.3, 0.76) - 0.5;
            const d = axis.clone().addScaledVector(side, tilt).normalize().applyAxisAngle(axis, spin * k);
            return { tgt: centreAt(), dir: d, dist: app.fitDistance(ext * 1.12 + 1) };
          };
          const rMul = () => 1 + (A.tour ? A.tour.exAmp * explodeAmount(A.tour.exT, 0.5, A.tour.exStag) : 0);
          const whole = wholePose(camD, r.pick([-1, 1]) * 0.4, rMul);
          keys = [[0.1, whole], [0.32, near], [0.74, near], [0.95, whole]];
        },
        at(t, dur) {
          if (!R0) return;
          const u = t / dur;
          const iso = TIMELINE.iso(u);
          setTour({ iso, lift: R0.lift * iso, away: R0.away * iso, exT: TIMELINE.inspectEx(u, R0.fromEx) });
          if (!done && u > 0.4) {
            done = true;
            G.color = sh.dscheme; app.applyLook();
            if (S.shot) { S.shot.region = R0; S.shot.colorNow = sh.dscheme; }
            plate();
          }
        },
        pose(t, dur) { return keys ? keyPose(t / dur, keys) : null; } };
    },
  };

  function resetFx() {
    app.setPeel(false); app.setSlice(false); app.setExplode(false);
    A.peel = A.slice = A.explode = 0; A.peelT = A.sliceT = A.explodeT = 0;
    A.peelMode = 0; A.peelReach = 0.5; A.exOrder = 0; A.slab = 0; A.hiK = -1;
  }

  async function nextShot() {
    if (!S) return;
    const sh = S.plan[S.i++ % S.plan.length];
    const token = ++S.token;
    const r = rngFrom(sh.seed);
    resetFx();
    const st = SETUP[sh.kind](sh, r);
    // the open shell and the tour table carry over only into a fromEx shot
    if (!(st.tour && sh.fromEx)) A.tour = null;
    if (!st.tour) S.ex = null;
    G.axes = !!st.axes;
    // colour, palette and light change at the cut (a chapter shot keeps them)
    G.color = sh.scheme; app.setPalette(sh.pal); app.setLight(sh.light);
    const cam = st.cam && !st.ladder ? { ...CAMS.orbit(r), ...st.cam } : CAMS[sh.cam](r);
    const keep = sh.cont && app.cur && app.cur.entry.key === sh.entry && G.mode === 'entry';
    if (keep) {
      // no cut: the camera move starts where the camera is
      const d = viewDir();
      cam.az = Math.atan2(d.x, d.z); cam.el0 = Math.asin(Math.max(-1, Math.min(1, d.y)));
    }
    S.shot = { ...st, sh, kind: sh.kind, entry: sh.entry, dur: sh.dur, t: 0, ready: false, cam, morphed: false, rep: sh.rep, cont: keep };
    S.target = null; S.zoomMul = 1;
    if (st.ladder) {
      G.rep = sh.rep;
      await app.enterLadder({ u: 0, play: false });
    } else if (keep) {
      app.setRep(sh.rep, 0.8);
      if (st.start === 'asm') app.startAssembly(0);
    } else {
      await app.show(sh.entry, { instant: st.start === 'full', rep: sh.rep });
      if (st.start === 'full') A.asm = 1;
    }
    if (!S || token !== S.token) return;
    if (app.cur) app.applyLook();
    if (S.shot.init) S.shot.init();
    S.shot.ready = true;
    S.shot.t = 0;
    plate();
  }
  function rngFrom(seed) {
    let a = seed >>> 0 || 1;
    const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { next, range: (lo, hi) => lo + (hi - lo) * next(), pick: arr => arr[Math.floor(next() * arr.length)] };
  }

  const _up = new THREE.Vector3(0, 1, 0);
  function tick(dt) {
    if (!S || !S.shot) return;
    const sh = S.shot;
    if (!sh.ready) return;
    sh.t += dt;
    // a morph to the second view, mid-shot
    if (sh.sh.repTo && !sh.morphed && sh.t > sh.dur * sh.sh.morphAt) {
      sh.morphed = true; sh.rep = sh.sh.repTo;
      app.setRep(sh.sh.repTo, Math.min(2.6, sh.dur * 0.3));
      plate();
    }
    if (sh.ladder) {
      A.ladderU = Math.min(1, smooth(sh.t / sh.dur) * 0.96 + 0.02);
    } else if (app.cur) {
      if (sh.at) sh.at(sh.t, sh.dur);
      const c = sh.cam, B = app.cur;
      const u = Math.min(1, sh.t / sh.dur), eu = easeInOut(u);
      const pose = sh.pose ? sh.pose(sh.t, sh.dur) : null;
      let dir;
      if (pose) dir = pose.dir;
      else if (sh.dirAt) dir = sh.dirAt(sh.t, sh.dur);
      else dir = camDir(c.az + c.spin * (c.ease ? eu * sh.dur : sh.t), c.el0 + (c.el1 - c.el0) * eu);
      const zoom = (c.z0 + (c.z1 - c.z0) * eu) * (S.zoomMul || 1);
      let tgt = S.target || new THREE.Vector3();
      // push in to (or pull out from) a point on the surface, toward the camera side
      if (c.push && !S.target) {
        const p = c.push > 0 ? smooth(u) : 1 - smooth(u);
        if (!sh.pushDir) sh.pushDir = dir.clone();
        tgt = sh.pushDir.clone().multiplyScalar(B.r * Math.abs(c.push) * p);
      }
      if (c.slide && !S.target) {
        if (!sh.slideDir) sh.slideDir = new THREE.Vector3().crossVectors(dir, _up).normalize();
        tgt = sh.slideDir.clone().multiplyScalar(B.r * 0.45 * c.slide * (2 * u - 1));
      }
      if (pose) tgt = pose.tgt;
      const want = tgt.clone().addScaledVector(dir, pose ? pose.dist : app.fitDistance(B.r) * zoom);
      // a cut snaps the camera; inside a shot (and across a chapter) a
      // critically damped spring follows the goal
      if (!S.camPos || (!sh.cont && sh.t < dt * 1.5)) { S.camPos = want.clone(); S.camTgt = tgt.clone(); S.camV = new THREE.Vector3(); S.tgtV = new THREE.Vector3(); }
      const w = 4, h = Math.min(dt, 0.05);
      for (const [x, v, goal] of [[S.camPos, S.camV, want], [S.camTgt, S.tgtV, tgt]]) {
        v.addScaledVector(goal.clone().sub(x), w * w * h).multiplyScalar(Math.max(0, 1 - 2 * w * h));
        x.addScaledVector(v, h);
      }
      V.camera.position.copy(S.camPos); app.controls.target.copy(S.camTgt);
      V.camera.up.set(0, 1, 0);
      V.camera.lookAt(S.camTgt);
      if (c.roll && !pose) V.camera.rotateZ(c.roll * Math.sin(Math.PI * u));
    }
    if (sh.t >= sh.dur) { sh.ready = false; nextShot(); }
    S.plateT += dt;
    if (S.plateT > 1) { S.plateT = 0; plate(); }
  }

  const REP_NAME = r => (app.REP_LABEL[r] || r).replace(' (one per residue)', '');
  function plate() {
    if (!S || !S.label || !S.shot) return;
    const sh = S.shot, P = sh.sh;
    const view = P.repTo ? (sh.morphed ? REP_NAME(P.rep) + ' → ' + REP_NAME(P.repTo) : REP_NAME(P.rep)) : REP_NAME(P.rep);
    let info;
    if (sh.ladder) {
      info = { title: 'Scale ladder', sub: sh.sub,
        params: [{ name: 'view width', value: (A.ladderW || 0) >= 1000 ? ((A.ladderW / 1000).toFixed(2) + ' µm') : ((A.ladderW || 0).toFixed(0) + ' nm') }, { name: 'drawn as', value: view }, { name: 'red blood cell', value: '7.5 µm' }, { name: 'E. coli', value: '≈ 2 µm' }],
        lines: ['Eleven PDB structures side by side at true scale.'] };
    } else {
      const e = entryByKey(sh.entry), ids = pdbsOf(e);
      const tex = [];
      if (e.T) { tex.push(`${TEX.T} = ${e.T.T}${e.T.hand ? '\\,' + e.T.hand : ''}`); tex.push(`N = 60\\,T = ${60 * e.T.T}`); }
      if (e.look === 'rod' || e.look === 'fibril') tex.push(TEX.helix);
      if (e.look === 'fibril') tex.push(TEX.crossBeta);
      const c = CREDIT[ids[0]];
      const notes = [];
      if (e.illus) notes.push('Contains an illustration.');
      if (P.repTo) notes.push('The change of view is a change of drawing style, not a change in the virus.');
      if (sh.kind === 'peel' || sh.kind === 'inside' || sh.kind === 'explode' || sh.kind === 'implode' || sh.kind === 'exview') notes.push('The motion shows the symmetry; it is not a measured path of assembly or disassembly.');
      if (sh.kind === 'inspect') notes.push('The lift and the ghost are a drawing aid: in the particle the region stays in its place.');
      notes.push('Data: ' + ids.map(id => 'PDB ' + id).join(', ') + ' — ' + c[1].split(',')[0] + ' et al. ' + c[2] + '.');
      const colour = (SCHEMES.find(x => x.id === (sh.colorNow || P.scheme)) || {}).label || P.scheme;
      let params = [{ name: 'PDB', value: ids.join(' + ') }, { name: 'disease', value: e.disease }, { name: 'drawn as', value: view }, { name: 'colour', value: colour.replace(/^By /, '').toLowerCase() }];
      let sub = sh.sub;
      if (sh.kind === 'exview') params = [{ name: 'PDB', value: ids.join(' + ') }, { name: 'explode', value: EX_STYLES[P.ex] || '' }, { name: 'order', value: STAGGERS[P.stag] || '' }, { name: 'drawn as', value: view }];
      if (sh.kind === 'inspect' && sh.region) {
        // the region on the plate: what it is, its chains, symmetry, size
        const g = sh.region, rg = g.reg;
        sub = rg.label.replace(/^./, ch => ch.toUpperCase()) + ' of ' + e.name;
        params = [{ name: 'chains', value: rg.chains }, { name: 'size', value: '≈ ' + (2 * g.ext).toFixed(1) + ' nm across' }, { name: 'drawn as', value: view }, { name: 'colour', value: colour.replace(/^By /, '').toLowerCase() }];
        tex.length = 0;
        if (/^C_\d$/.test(rg.sym)) tex.push('\\text{symmetry}\\ ' + rg.sym);
        if (rg.tex) tex.push(rg.tex);
      }
      info = { title: e.name, sub, params, tex, lines: [notes.join(' ')] };
    }
    info.anchor = () => {
      const { w, h } = app.size(), o = app.occ;
      const cw = w - o.l - o.r, ch = h - o.t - o.b;
      return { x: o.l + cw / 2, y: o.t + ch / 2, w: Math.min(cw, ch) * 0.8, h: Math.min(cw, ch) * 0.8, lead: false };
    };
    try { S.label(info); } catch (e) { /* the shell is gone */ }
  }

  window.snSaver = {
    enter(o = {}) {
      if (S) this.exit();
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      document.documentElement.classList.add('sn-saver');
      S = { plan: plan((o.seed >>> 0) || ((Date.now() & 0xffffff) + 1), calm, 240), i: 0, token: 0, shot: null, plateT: 0,
        label: o.labels !== false && typeof o.label === 'function' ? o.label : null,
        keep: { key: G.key, mode: G.mode, orbit: G.orbit, axes: G.axes, sway: G.sway, breathe: G.breathe, rep: G.rep, color: G.color, pal: G.pal } };
      G.orbit = false; G.sway = true; G.breathe = true;
      A.camLock = true; A.ladderPlay = false;
      import('../../lib/saver-clear.js').then(m => {
        if (!S) return;
        let band = null, at = -1e9;
        app.setBand(h => {
          const now = performance.now();
          if (now - at > 250) { at = now; band = m.plateBand(h) || band; }
          if (!band) return null;
          let t = band.t, b = band.b; const k = (t + b) / (0.8 * h);
          if (k > 1) { t /= k; b /= k; }
          return { t, b };
        });
      }).catch(() => { /* no shell: the full frame */ });
      app.addHook(tick);
      nextShot();
      return { canvas: V.renderer.domElement, warmupMs: 1200 };
    },
    exit() {
      if (!S) return;
      try { S.label && S.label(null); } catch (e) { /* the shell is gone */ }
      const k = S.keep;
      S = null;
      app.removeHook(tick);
      app.setBand(null);
      document.documentElement.classList.remove('sn-saver');
      A.camLock = false;
      V.camera.up.set(0, 1, 0);
      resetFx();
      A.tour = null;
      Object.assign(G, { orbit: k.orbit, axes: k.axes, sway: k.sway, breathe: k.breathe, rep: k.rep, color: k.color });
      app.setPalette(k.pal); app.setLight('studio');
      if (k.mode === 'ladder') app.enterLadder({ u: 0, play: false });
      else app.show(k.key, { instant: true });
    },
    cut(kind) { if (S) { const i = S.plan.findIndex((s, j) => j >= S.i && s.kind === kind); if (i >= 0) S.i = i; nextShot(); } },
    debug() {
      return S && S.shot ? { kind: S.shot.kind, entry: S.shot.entry, t: S.shot.t, dur: S.shot.dur, ready: S.shot.ready, rep: S.shot.rep,
        scheme: S.shot.sh.scheme, pal: S.shot.sh.pal, light: S.shot.sh.light, cam: S.shot.sh.cam, peel: S.shot.sh.peel, band: app.occ,
        cont: !!S.shot.cont, ex: S.shot.sh.ex, stag: S.shot.sh.stag, hold: !!S.shot.sh.hold, region: S.shot.sh.region, tour: A.tour ? { exT: A.tour.exT, iso: A.tour.iso } : null } : null;
    },
    // the region an inspection has lifted out (for node checks)
    region() { return S && S.shot && S.shot.region || null; },
  };
  // the light rig and palette names, for debug() readers
  window.snSaver.names = { palettes: Object.keys(PALETTES), lights: Object.keys(LIGHTS) };
}
