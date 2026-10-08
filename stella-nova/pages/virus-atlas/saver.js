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
//  Any shot but the ladder and the axes may also morph its view.
//
//  CAMERA  (app.A.camLock) moves: orbit, pushin (to a point on the
//  surface), pullout, crane (pole to equator), arc (a fast half turn),
//  dutch (an orbit with a slow roll), flyby (the target slides past).
//  The camera position eases toward its goal each frame, so a new goal
//  never snaps it.
//
//  FRAME  main.js adds the plate's clear band (plateBand from
//  lib/saver-clear.js) to its occlusion, so the view offset centres the
//  subject in the band, and fitDistance() sizes it for the band.
//
//  PLATE  name, the shot line, PDB ID, disease, the view (and the morph
//  target), the colour scheme; TeX for the T number of a capsid
//  (T = h^2 + hk + k^2, N = 60 T) and the screw of a rod or fibril.
//  A morph says that it is a change of drawing style. No code.
//
//  EXIT  puts back the user's entry, mode, view, colours and toggles.
//
//  grep -n targets: "const SETUP", "const CAMS", "function nextShot",
//                   "function tick", "function plate", "window.snSaver"
// ============================================================================
import * as THREE from 'three';
import { plan, PEELS, EXES } from './shots.js';
import { entryByKey, pdbsOf, CREDIT, TEX } from './catalog.js';
import { SCHEMES, PALETTES, LIGHTS } from './colors.js';
import { easeInOut, smooth } from './symmetry.js';

export function installSaver(app) {
  const { G, A, V } = app;
  let S = null;

  const camDir = (az, el) => new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const viewDir = () => V.camera.position.clone().sub(app.controls.target).normalize();
  const ramp = (t, a, b) => smooth((t - a) / Math.max(1e-3, b - a));

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
    G.axes = !!st.axes;
    // colour, palette and light change at the cut
    G.color = sh.scheme; app.setPalette(sh.pal); app.setLight(sh.light);
    const cam = st.cam && !st.ladder ? { ...CAMS.orbit(r), ...st.cam } : CAMS[sh.cam](r);
    S.shot = { ...st, sh, kind: sh.kind, entry: sh.entry, dur: sh.dur, t: 0, ready: false, cam, morphed: false, rep: sh.rep };
    S.target = null; S.zoomMul = 1;
    if (st.ladder) {
      G.rep = sh.rep;
      await app.enterLadder({ u: 0, play: false });
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
      let dir;
      if (sh.dirAt) dir = sh.dirAt(sh.t, sh.dur);
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
      const want = tgt.clone().addScaledVector(dir, app.fitDistance(B.r) * zoom);
      if (!S.camPos || sh.t < dt * 1.5) { S.camPos = want.clone(); S.camTgt = tgt.clone(); }
      const k = 1 - Math.exp(-dt * 3);
      S.camPos.lerp(want, k); S.camTgt.lerp(tgt, k);
      V.camera.position.copy(S.camPos); app.controls.target.copy(S.camTgt);
      V.camera.up.set(0, 1, 0);
      V.camera.lookAt(S.camTgt);
      if (c.roll) V.camera.rotateZ(c.roll * Math.sin(Math.PI * u));
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
    const scheme = (SCHEMES.find(x => x.id === P.scheme) || {}).label || P.scheme;
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
      if (sh.kind === 'peel' || sh.kind === 'inside' || sh.kind === 'explode' || sh.kind === 'implode') notes.push('The motion shows the symmetry; it is not a measured path of assembly or disassembly.');
      notes.push('Data: ' + ids.map(id => 'PDB ' + id).join(', ') + ' — ' + c[1].split(',')[0] + ' et al. ' + c[2] + '.');
      info = { title: e.name, sub: sh.sub,
        params: [{ name: 'PDB', value: ids.join(' + ') }, { name: 'disease', value: e.disease }, { name: 'drawn as', value: view }, { name: 'colour', value: scheme.replace(/^By /, '').toLowerCase() }],
        tex, lines: [notes.join(' ')] };
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
      Object.assign(G, { orbit: k.orbit, axes: k.axes, sway: k.sway, breathe: k.breathe, rep: k.rep, color: k.color });
      app.setPalette(k.pal); app.setLight('studio');
      if (k.mode === 'ladder') app.enterLadder({ u: 0, play: false });
      else app.show(k.key, { instant: true });
    },
    cut(kind) { if (S) { const i = S.plan.findIndex((s, j) => j >= S.i && s.kind === kind); if (i >= 0) S.i = i; nextShot(); } },
    debug() {
      return S && S.shot ? { kind: S.shot.kind, entry: S.shot.entry, t: S.shot.t, dur: S.shot.dur, ready: S.shot.ready, rep: S.shot.rep,
        scheme: S.shot.sh.scheme, pal: S.shot.sh.pal, light: S.shot.sh.light, cam: S.shot.sh.cam, peel: S.shot.sh.peel, band: app.occ } : null;
    },
  };
  // the light rig and palette names, for debug() readers
  window.snSaver.names = { palettes: Object.keys(PALETTES), lights: Object.keys(LIGHTS) };
}
