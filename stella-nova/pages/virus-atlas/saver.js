// ============================================================================
//  VIRUS ATLAS  ·  saver.js — the screensaver tour (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm, seconds, caption, seed, label }. shots.js plan() gives a seeded
//  shuffle of shots, 5 to 12 s each, so every run differs:
//    assemble  a capsid, the TMV rod or the HIV cone builds from subunits
//    peel      the near half lifts off, unit by unit; the camera turns in
//    explode   the shell opens along its 5-fold axes and closes
//    axes      the camera looks down a 5-fold, then a 3-fold, then a
//              2-fold axis, with the axis markers on
//    spikes    a push-in on one swaying spike of a virion
//    grow      a prion or amyloid fibril grows at both ends
//    slice     a plane sweeps through a large particle
//    protein   one protein assembles and turns, with a push-in
//    ladder    the zoom from a 4 nm protein to the 300 nm TMV rod
//  The camera is the saver's while it runs (app.A.camLock): it turns at
//  a steady rate and eases its zoom, with no snaps.
//
//  FRAME  main.js adds the plate's clear band (plateBand from
//  lib/saver-clear.js) to its occlusion, so the view offset centres the
//  subject in the band, and fitDistance() sizes it for the band.
//
//  PLATE  name, a shot line, PDB ID, disease, size and chains; TeX for the
//  T number of an icosahedral capsid (T = h^2 + hk + k^2, N = 60 T) and
//  the screw of a rod or a fibril. No code on the plate.
//
//  EXIT  puts back the user's entry, mode and toggles.
//
//  grep -n targets: "const SETUP", "function nextShot", "function tick",
//                   "function plate", "window.snSaver"
// ============================================================================
import * as THREE from 'three';
import { plan } from './shots.js';
import { entryByKey, pdbsOf, CREDIT, TEX } from './catalog.js';
import { easeInOut, smooth } from './symmetry.js';

export function installSaver(app) {
  const { G, A, V } = app;
  let S = null;

  const camDir = (az, el) => new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));

  // Each setup(shot, r) returns { sub, tex?, cam: { az, spin, el0, el1, z0, z1 },
  // at?(t, dur) per-frame extras, dirAt?(t, dur) a camera direction }.
  const SETUP = {
    assemble(sh, r) {
      return { sub: 'builds itself from its subunits', start: 'asm',
        cam: { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.08, 0.14), el0: r.range(0.15, 0.45), el1: r.range(0.2, 0.5), z0: 1.2, z1: 0.98 } };
    },
    peel(sh, r) {
      let done = false;
      return { sub: 'the near half lifts off, one subunit at a time', start: 'full',
        cam: { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.05, 0.09), el0: r.range(0.1, 0.35), el1: r.range(0.3, 0.6), z0: 1.05, z1: 0.92 },
        at(t, dur) { if (!done && t > dur * 0.18) { done = true; app.setPeel(true, V.camera.position.clone().sub(app.controls.target).normalize()); } } };
    },
    explode(sh, r) {
      let st = 0;
      return { sub: 'opens along its 5-fold axes, then closes', start: 'full',
        cam: { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.06, 0.12), el0: r.range(0.2, 0.5), el1: r.range(0.1, 0.4), z0: 1.25, z1: 1.3 },
        at(t, dur) {
          if (st === 0 && t > dur * 0.15) { st = 1; app.setExplode(true); }
          if (st === 1 && t > dur * 0.68) { st = 2; app.setExplode(false); }
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
    spikes(sh, r) {
      let tgt = null, dir0 = null;
      return { sub: 'a push-in on one spike; spikes sway on their stalks (illustration)', start: 'asm',
        cam: { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * 0.05, el0: r.range(0.1, 0.4), el1: 0.25, z0: 1.05, z1: 1.05 },
        at(t, dur) {
          const B = app.cur; if (!B || !B.parts[0]) return;
          if (!tgt) {
            // the spike nearest the camera
            const p = B.parts[0], cd = V.camera.position.clone().normalize();
            let best = 0, bk = 0;
            for (let k = 0; k < p.m; k++) { const v = new THREE.Vector3(p.ops[12 * k + 3], p.ops[12 * k + 7], p.ops[12 * k + 11]).normalize(); const d = v.dot(cd); if (d > best) { best = d; bk = k; } }
            dir0 = new THREE.Vector3(p.ops[12 * bk + 3], p.ops[12 * bk + 7], p.ops[12 * bk + 11]).normalize();
            tgt = dir0.clone().multiplyScalar(B.r * 0.86);
          }
          const s = smooth((t - dur * 0.25) / (dur * 0.65));
          S.target = new THREE.Vector3().lerpVectors(new THREE.Vector3(), tgt, s);
          S.zoomMul = 1 - 0.72 * s;
        } };
    },
    grow(sh, r) {
      return { sub: 'grows at both ends: each new chain takes the fold of the layer below (an illustration of templating)', start: 'asm',
        cam: { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.06, 0.1), el0: r.range(0.05, 0.3), el1: r.range(0.2, 0.5), z0: 1.0, z1: 0.85 } };
    },
    slice(sh, r) {
      let done = false;
      return { sub: 'a plane cuts through to show the inside', start: 'full',
        cam: { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.05, 0.08), el0: r.range(0.1, 0.3), el1: r.range(0.3, 0.6), z0: 1.05, z1: 0.95 },
        at(t, dur) { if (!done && t > dur * 0.12) { done = true; app.setSlice(true, V.camera.position.clone().sub(app.controls.target).normalize()); } } };
    },
    protein(sh, r) {
      return { sub: 'chain by chain, then a slow turn', start: 'asm',
        cam: { az: r.range(0, 6.28), spin: r.pick([-1, 1]) * r.range(0.12, 0.2), el0: r.range(0.0, 0.35), el1: r.range(0.25, 0.6), z0: 1.15, z1: 0.75 } };
    },
    ladder() {
      return { sub: 'true relative sizes, from a 4 nm protein to the 300 nm TMV rod', ladder: true, cam: {} };
    },
  };

  async function nextShot() {
    if (!S) return;
    const sh = S.plan[S.i++ % S.plan.length];
    const token = ++S.token;
    const r = rngFrom(sh.seed);
    // reset the toggles of the last shot
    app.setPeel(false); app.setSlice(false); app.setExplode(false);
    A.peel = A.slice = 0;
    const st = SETUP[sh.kind](sh, r);
    G.axes = !!st.axes;
    S.shot = { ...st, kind: sh.kind, entry: sh.entry, dur: sh.dur, t: 0, ready: false };
    S.target = null; S.zoomMul = 1;
    if (st.ladder) {
      await app.enterLadder({ u: 0, play: false });
    } else {
      await app.show(sh.entry, { instant: st.start === 'full' });
      if (st.start === 'full') A.asm = 1;
    }
    if (!S || token !== S.token) return;
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

  function tick(dt) {
    if (!S || !S.shot) return;
    const sh = S.shot;
    if (!sh.ready) return;
    sh.t += dt;
    if (sh.ladder) {
      A.ladderU = Math.min(1, smooth(sh.t / sh.dur) * 0.96 + 0.02);
    } else if (app.cur) {
      if (sh.at) sh.at(sh.t, sh.dur);
      const c = sh.cam, B = app.cur;
      const u = Math.min(1, sh.t / sh.dur);
      let dir;
      if (sh.dirAt) dir = sh.dirAt(sh.t, sh.dur);
      else dir = camDir(c.az + c.spin * sh.t, c.el0 + (c.el1 - c.el0) * easeInOut(u));
      const zoom = (c.z0 + (c.z1 - c.z0) * easeInOut(u)) * (S.zoomMul || 1);
      const tgt = S.target || new THREE.Vector3();
      // smooth the camera so a new target never snaps
      const want = tgt.clone().addScaledVector(dir, app.fitDistance(B.r) * zoom);
      if (!S.camPos || sh.t < dt * 1.5) { S.camPos = want.clone(); S.camTgt = tgt.clone(); }
      const k = 1 - Math.exp(-dt * 3);
      S.camPos.lerp(want, k); S.camTgt.lerp(tgt, k);
      V.camera.position.copy(S.camPos); app.controls.target.copy(S.camTgt); V.camera.lookAt(S.camTgt);
    }
    if (sh.t >= sh.dur) { sh.ready = false; nextShot(); }
    S.plateT += dt;
    if (S.plateT > 1) { S.plateT = 0; plate(); }
  }

  function plate() {
    if (!S || !S.label || !S.shot) return;
    const sh = S.shot;
    let info;
    if (sh.ladder) {
      info = { title: 'Scale ladder', sub: sh.sub,
        params: [{ name: 'view width', value: (A.ladderW || 0) >= 1000 ? ((A.ladderW / 1000).toFixed(2) + ' µm') : ((A.ladderW || 0).toFixed(0) + ' nm') }, { name: 'red blood cell', value: '7.5 µm' }, { name: 'E. coli', value: '≈ 2 µm' }],
        lines: ['Eleven PDB structures side by side at true scale.'] };
    } else {
      const e = entryByKey(sh.entry), ids = pdbsOf(e), B = app.cur;
      const chains = B ? B.parts.reduce((a, p) => a + p.m * p.d.info.chains.filter(c => p.d.info.entities[c[2]].role !== 'glycan').length, 0) : 0;
      const tex = [];
      if (e.T) { tex.push(`${TEX.T} = ${e.T.T}${e.T.hand ? '\\,' + e.T.hand : ''}`); tex.push(`N = 60\\,T = ${60 * e.T.T}`); }
      if (e.look === 'rod' || e.look === 'fibril') tex.push(TEX.helix);
      if (e.look === 'fibril') tex.push(TEX.crossBeta);
      const c = CREDIT[ids[0]];
      info = { title: e.name, sub: sh.sub,
        params: [{ name: 'PDB', value: ids.join(' + ') }, { name: 'disease', value: e.disease }, { name: 'size', value: e.size }, { name: 'chains', value: chains.toLocaleString() }],
        tex, lines: [(e.illus ? 'Contains an illustration. ' : '') + 'Data: ' + ids.map(id => 'PDB ' + id).join(', ') + ' — ' + c[1].split(',')[0] + ' et al. ' + c[2] + '.'] };
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
        keep: { key: G.key, mode: G.mode, orbit: G.orbit, axes: G.axes, sway: G.sway, breathe: G.breathe } };
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
      app.setPeel(false); app.setSlice(false); app.setExplode(false);
      Object.assign(G, { orbit: k.orbit, axes: k.axes, sway: k.sway, breathe: k.breathe });
      if (k.mode === 'ladder') app.enterLadder({ u: 0, play: false });
      else app.show(k.key, { instant: true });
    },
    cut(kind) { if (S) { const i = S.plan.findIndex((s, j) => j >= S.i && s.kind === kind); if (i >= 0) S.i = i; nextShot(); } },
    debug() { return S && S.shot ? { kind: S.shot.kind, entry: S.shot.entry, t: S.shot.t, dur: S.shot.dur, ready: S.shot.ready, band: app.occ } : null; },
  };
}
