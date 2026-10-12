// ============================================================================
//  VIRUS ATLAS  ·  saver.js — the screensaver: build, look, take apart
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm, seconds, caption, seed, label }. shots.js plan() gives the
//  beats: for each virus (a seeded shuffle of 12, no repeat until all have
//  played) a build, an inspection or an axes beat, and a take-apart. Each
//  beat is 5 to 12 s and starts with a camera cut. BEATS (const BEATS):
//    build    regions.js explodePlan run backwards: every part starts out
//             on its line (5-, 3-, 2-fold axes, radial, or its capsomer
//             direction) at size 0, grows as it flies in (glsl.js
//             uSelFade) and lands in its stagger order. A membrane grows
//             first. The camera orbits slowly and closes in as the shell
//             closes.
//    inspect  one region lifts out, the rest shrinks to a dark ghost; the
//             camera pushes in on the region, turns slowly round its axis,
//             and pulls back as the region rejoins. The view may morph to
//             the backbone tube while the region is out.
//    axes     glowing symmetry axes (view.js makeAxes): the camera looks
//             down a 5-fold axis, then turns to the nearest 3-fold axis.
//    apart    the parts fly out along other lines and shrink to nothing.
//             The data of the next virus loads during the inspection
//             (app.preload), and the GPU build of the next virus happens
//             on the empty screen after the take-apart (show drop: true).
//
//  LOOK  one curated look per virus (saver-look.js LOOKS: colour scheme,
//  palette, light rig, backdrop gradient). The page view stays the same:
//  the backdrop and the rigs are on only in the saver.
//
//  CAMERA  each beat gives pose(u) = { tgt, dir, dist, up }. A critically
//  damped spring follows it; a beat start snaps it (a cut). Turns stay
//  under 15 deg/s and zooms under 0.6 per s (saver-probe.mjs measures it).
//  A long subject (the TMV rod, the HIV cone) lies along the long side of
//  the clear band (saver-look.js fitLong).
//
//  FRAME  main.js adds the plate's clear band (plateBand from
//  lib/saver-clear.js) to its occlusion; the view offset centres the
//  subject in the band and the fit distances size it for the band. The
//  plate holds the same facts for all beats of one virus, so the band
//  does not jump inside a beat.
//
//  PLATE  name; the beat line; family, diameter, subunits, assembly unit,
//  PDB ID; TeX for the T number or the helix; one note line. No code.
//
//  EXIT  puts back the user's entry, view, colours, light and toggles.
//
//  grep -n targets: "const BEATS", "function nextShot", "function tick",
//    "function plate", "window.snSaver", "function tourCtx", "function frameOf"
// ============================================================================
import * as THREE from 'three';
import { plan, EX_STYLES } from './shots.js';
import { entryByKey, pdbsOf, CREDIT, TEX } from './catalog.js';
import { easeInOut, smooth } from './symmetry.js';
import { unitTable, capsomers, regionsOf, explodePlan, partCentre, selTable, regionExtent, REGION_NAMES } from './regions.js';
import { VIRUSES, lookById, rigOf, repOf, fitLong } from './saver-look.js';

export function installSaver(app) {
  const { G, A, V } = app;
  let S = null;
  const _up = new THREE.Vector3(0, 1, 0);
  const V3 = a => new THREE.Vector3(a[0], a[1], a[2]);
  const lin = (u, a, b) => Math.min(1, Math.max(0, (u - a) / Math.max(1e-3, b - a)));
  const sm = (u, a, b) => smooth(lin(u, a, b));
  const camDir = (az, el) => new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const logLerp = (a, b, s) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * s);

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
  function setTour(o) {
    A.tour = Object.assign(A.tour || { exT: 0, exStag: 0, exAmp: 0, iso: 0, ghost: 0.3, lift: 0, liftDir: new THREE.Vector3(0, 1, 0), away: 0, fade: 0, mem: null }, o);
  }
  // explode plans of every part; keys flipped for 'type' in a build, so
  // the pentamers land first and the faces fill in after
  function plansFor(B, ex, stag, pole, build) {
    const C = tourCtx(B), look = B.entry.look, mode = ex === 'cap' ? 'cap' : +ex;
    return C.parts.map(P => {
      const pl = explodePlan(P.T, { mode, stagger: stag, pole, axes: P.axes, caps: P.caps, look });
      if (build && stag === 'type') { pl.keys = pl.keys.map(k => 1 - k); pl.groups.forEach(g => { g.key = 1 - g.key; }); }
      return pl;
    });
  }

  // ── framing ─────────────────────────────────────────────────────────────
  // a long subject (rod, cone: axis y) lies along the long side of the band
  function frameOf(B) {
    const e = B.entry;
    if ((e.look === 'rod' || e.look === 'cone') && B.bounds) {
      const s = B.bounds.size, L = s[1] / 2, rr = Math.max(s[0], s[2]) / 2;
      return { long: true, L, rr };
    }
    return { long: false };
  }
  const view = () => { const { w, h } = app.size(); return { w, h, occ: app.occ, fov: V.camera.fov }; };
  // the whole subject at scale k (k > 1: room for parts in flight)
  function wholeDist(B, k = 1) {
    const f = frameOf(B);
    if (f.long) return fitLong(f.L * k, f.rr * k, view()).dist;
    return app.fitDistance(B.r * k);
  }
  // the camera up of a long subject: its axis across a landscape band
  function upFor(B, dir) {
    const f = frameOf(B);
    if (!f.long || !fitLong(f.L, f.rr, view()).across) return _up.clone();
    const u = new THREE.Vector3().crossVectors(dir, _up);
    return u.lengthSq() < 1e-6 ? new THREE.Vector3(1, 0, 0) : u.normalize();
  }
  // an orbit about y: azimuth az0 + spin t, elevation el0 -> el1
  const orbit = (az0, spin, el0, el1, dur) => u => camDir(az0 + spin * u * dur, el0 + (el1 - el0) * smooth(u));

  // ── the beats: setup(sh, r) -> { sub, init(), at(u), pose(u) } ─────────
  const BEATS = {
    build(sh, r) {
      let st = null;
      const spin = r.pick([-1, 1]) * r.range(0.09, 0.13), az0 = r.range(0, 6.28), el0 = r.range(0.15, 0.45), el1 = r.range(0.05, 0.3);
      return {
        sub: 'assembles ' + howOf(sh.entry, sh.ex, sh.stag),
        init() {
          const B = app.cur, V0 = VIRUSES[sh.entry], stag = 0.72;
          const dirFn = orbit(az0, spin, el0, el1, sh.dur);
          const pole = dirFn(0.6), plans = plansFor(B, sh.ex, sh.stag, [pole.x, pole.y, pole.z], true);
          tourCtx(B).parts.forEach((P, i) => P.part.setSel(selTable(P.T, plans[i])));
          setTour({ exT: 1, exStag: stag, exAmp: V0.amp, iso: 0, ghost: 1, lift: 0, away: 0, fade: 1, mem: B.membrane ? 0 : null });
          st = { B, dirFn, amp: V0.amp };
        },
        at(u) {
          if (!st) return;
          setTour({ exT: 1 - lin(u, 0.0, 0.84), mem: st.B.membrane ? lin(u, 0, 0.3) : null });
        },
        pose(u) {
          const d = st.dirFn(u), open = 1 - sm(u, 0.35, 0.95);
          return { tgt: new THREE.Vector3(), dir: d, dist: wholeDist(st.B, 1 + st.amp * 0.85 * open), up: upFor(st.B, d) };
        },
      };
    },

    inspect(sh, r) {
      let st = null;
      const name = REGION_NAMES[sh.region] || sh.region;
      return {
        sub: name.replace(/^./, c => c.toUpperCase()) + ' lifts out',
        init() {
          const B = app.cur, C = tourCtx(B), look = B.entry.look;
          const reg = C.regions.find(x => x.kind === sh.region) || C.regions[0];
          if (!reg) return;
          const P0 = C.parts[reg.part];
          // an instance that faces the camera side of the orbit
          const want = camDir(r.range(0, 6.28), r.range(0.1, 0.5));
          let inst;
          if (reg.inst[0].axis) {
            const sc = reg.inst.map(x => ({ x, f: V3(x.axis).dot(want) })).sort((a, b) => b.f - a.f);
            inst = sc[Math.floor(r.next() * Math.min(3, sc.length))].x;
          } else inst = r.pick(reg.inst);
          C.parts.forEach((P, i) => P.part.setSel(selTable(P.T, null, i === reg.part ? inst.units : [], inst.centre)));
          const cxz = Math.hypot(inst.centre[0], inst.centre[2]);
          const axis = inst.axis ? V3(inst.axis).normalize() : cxz > 1.5 ? new THREE.Vector3(inst.centre[0], 0, inst.centre[2]).normalize() : want.clone();
          const ext = regionExtent(P0.T, inst.units, inst.centre, inst.units.length > 60 ? 3 : 1);
          const lift = look === 'capsid' || look === 'cone' ? 0.16 * B.r : look === 'virion' ? 0.2 * B.r : Math.max(4, ext * 0.6);
          setTour({ exT: 0, exStag: 0, exAmp: 0, iso: 0, ghost: 0.18, lift: 0, away: 0, fade: 0, mem: null, liftDir: axis.clone() });
          const side = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) < 0.95 ? _up : new THREE.Vector3(1, 0, 0)).normalize();
          const tilt = r.range(0.3, 0.5), spin = r.pick([-1, 1]) * r.range(0.45, 0.7);
          // near: the region fills the band, but no more than 5 times closer than
          // the whole, so the push-in stays under 0.6 per s
          const far = wholeDist(B), near = Math.max(app.fitDistance(ext * 1.12 + 1), far / 5);
          st = { B, reg, inst, ext, lift, axis, side, tilt, spin, near, far, P0 };
          if (sh.detail) st.detail = sh.detail;
          if (S.shot) S.shot.region = { reg, inst, ext, plans: null };
        },
        at(u) {
          if (!st) return;
          // the rest fades before the push-in and comes back after the pull-back,
          // so the whole shell is never closer than its fit
          const iso = sm(u, 0.02, 0.16) - sm(u, 0.91, 1.0);
          // a virion envelope draws back while a spike is out
          setTour({ iso, lift: st.lift * iso, mem: st.B.membrane && st.B.entry.look === 'virion' ? 1 - 0.45 * iso : null });
          if (st.detail && !st.morphed && u > 0.36) { st.morphed = true; app.setRep(st.detail, 1.6); }
          if (st.detail && st.morphed && !st.back && u > 0.54) { st.back = true; app.setRep(repOf(sh.entry), 1.4); }
        },
        pose(u) {
          const k = sm(u, 0.12, 0.5) - sm(u, 0.57, 0.89);
          const d = st.axis.clone().addScaledVector(st.side, st.tilt).normalize().applyAxisAngle(st.axis, st.spin * (u - 0.5));
          const c = V3(st.inst.centre).addScaledVector(st.axis, A.tour ? A.tour.lift : 0);
          return { tgt: c.multiplyScalar(k), dir: d, dist: logLerp(st.far, st.near, k), up: upFor(st.B, d) };
        },
      };
    },

    axes(sh, r) {
      let seq = null;
      return {
        sub: 'down a 5-fold axis, then a 3-fold axis',
        init() {
          const B = app.cur, ax = B ? B.axes : [];
          const all = o => ax.filter(a => a.order === o).map(a => V3(a.dir));
          const f = all(5);
          const d5 = (f[Math.floor(r.next() * f.length)] || new THREE.Vector3(0, 1, 0)).clone().multiplyScalar(r.pick([1, -1])).normalize();
          const d3 = (all(3).map(v => v.dot(d5) < 0 ? v.negate() : v).sort((p, q) => q.dot(d5) - p.dot(d5))[0] || d5.clone()).normalize();
          seq = { B, d5, d3 };
          A.tour = null;
          G.axes = true; app.applyLook();
        },
        pose(u) {
          const s = sm(u, 0.3, 0.78);
          const q = new THREE.Quaternion().setFromUnitVectors(seq.d5, seq.d3), qs = new THREE.Quaternion().slerp(q, s);
          const d = seq.d5.clone().applyQuaternion(qs);
          return { tgt: new THREE.Vector3(), dir: d, dist: wholeDist(seq.B, 1.3) * (1 - 0.06 * smooth(u)), up: Math.abs(d.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : _up.clone() };
        },
      };
    },

    apart(sh, r) {
      let st = null;
      const spin = r.pick([-1, 1]) * r.range(0.08, 0.12), az0 = r.range(0, 6.28), el0 = r.range(0.0, 0.4), el1 = r.range(0.2, 0.5);
      return {
        sub: 'comes apart ' + howOf(sh.entry, sh.ex, sh.stag),
        init() {
          const B = app.cur, V0 = VIRUSES[sh.entry], dirFn = orbit(az0, spin, el0, el1, sh.dur);
          const pole = dirFn(0.3), plans = plansFor(B, sh.ex, sh.stag, [pole.x, pole.y, pole.z], false);
          tourCtx(B).parts.forEach((P, i) => P.part.setSel(selTable(P.T, plans[i])));
          setTour({ exT: 0, exStag: 0.6, exAmp: V0.amp, iso: 0, ghost: 1, lift: 0, away: 0, fade: 1, mem: B.membrane ? 1 : null });
          st = { B, dirFn, amp: V0.amp };
        },
        at(u) {
          if (!st) return;
          setTour({ exT: lin(u, 0.06, 0.97), mem: st.B.membrane ? 1 - lin(u, 0.6, 0.95) : null });
        },
        pose(u) {
          const d = st.dirFn(u);
          return { tgt: new THREE.Vector3(), dir: d, dist: wholeDist(st.B, 1 + st.amp * 1.05 * sm(u, 0.04, 0.5)), up: upFor(st.B, d) };
        },
      };
    },
  };
  // how the parts move, for the plate line
  function howOf(key, ex, stag) {
    const look = (entryByKey(key) || {}).look;
    if (look === 'rod') return 'subunit by subunit along the rod';
    if (look === 'virion') return 'spike by spike on its envelope';
    const s = ex === 'cap' ? 'capsomer by capsomer' : ex === '-1' ? 'along radial lines' : 'along its ' + EX_STYLES[ex];
    return s + (stag === 'type' ? ', pentamers first' : stag === 'ring' ? ', ring by ring' : '');
  }

  async function nextShot() {
    if (!S) return;
    const sh = S.plan[S.i++ % S.plan.length];
    const token = ++S.token;
    const r = rngFrom(sh.seed);
    const st = BEATS[sh.kind](sh, r);
    const look = lookById(sh.look);
    S.shot = { ...st, sh, kind: sh.kind, entry: sh.entry, dur: sh.dur, t: 0, ready: false };
    if (sh.kind !== 'axes' && G.axes) { G.axes = false; app.applyLook(); }
    if (sh.kind === 'build') {
      // a new virus: the screen is empty (the take-apart before ended with
      // every part at size 0), so the GPU build is not seen
      if (!A.tour) setTour({ exT: 1, exStag: 0.72, fade: 1 });
      G.color = look.scheme; app.setPalette(look.pal); app.setLight(rigOf(look));
      if (app.setBackdrop) { app.setBackdrop(look.back); S.bc = null; }
      S.back = look.back;
      await app.show(sh.entry, { instant: true, rep: repOf(sh.entry), drop: true });
      if (!S || token !== S.token) return;
      A.asm = 1;
    } else if (sh.kind === 'apart') {
      app.setRep(repOf(sh.entry), 0.6);
    }
    // a failed load: skip ahead, and wait a little after many failures
    if (!app.cur || app.cur.entry.key !== sh.entry) {
      S.fails = (S.fails || 0) + 1;
      if (S.fails < 40) setTimeout(() => { if (S && token === S.token) nextShot(); }, S.fails > 6 ? 1000 : 0);
      return;
    }
    S.fails = 0;
    if (sh.kind === 'build') app.applyLook();
    S.shot.init();
    // the inspection holds: fetch the next virus now
    if (sh.kind === 'inspect' || sh.kind === 'axes') {
      const nx = S.plan.slice(S.i).find(x => x.kind === 'build');
      if (nx && app.preload) app.preload(nx.entry);
    }
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
    const u = Math.min(1, sh.t / sh.dur);
    if (app.cur) {
      if (sh.at) sh.at(u);
      const pose = sh.pose(u);
      const want = pose.tgt.clone().addScaledVector(pose.dir, pose.dist);
      // a beat starts with a cut; inside a beat a critically damped spring
      // follows the pose
      if (!S.camPos || sh.t < dt * 1.5) { S.camPos = want.clone(); S.camTgt = pose.tgt.clone(); S.camV = new THREE.Vector3(); S.tgtV = new THREE.Vector3(); S.upV = pose.up.clone(); }
      const w = 4, h = Math.min(dt, 0.05);
      for (const [x, v, goal] of [[S.camPos, S.camV, want], [S.camTgt, S.tgtV, pose.tgt]]) {
        v.addScaledVector(goal.clone().sub(x), w * w * h).multiplyScalar(Math.max(0, 1 - 2 * w * h));
        x.addScaledVector(v, h);
      }
      S.upV.lerp(pose.up, Math.min(1, 6 * h)).normalize();
      V.camera.position.copy(S.camPos); app.controls.target.copy(S.camTgt);
      V.camera.up.copy(S.upV);
      V.camera.lookAt(S.camTgt);
      // the backdrop centre follows the clear band
      if (app.setBackdrop && S.back) {
        const { w: W, h: H } = app.size(), o = app.occ;
        const cx = 0.5 + (o.l - o.r) / (2 * W), cy = 1 - (o.t + (H - o.t - o.b) / 2) / H;
        if (W > 0 && H > 0 && (!S.bc || Math.abs(S.bc[0] - cx) + Math.abs(S.bc[1] - cy) > 1e-3)) { S.bc = [cx, cy]; app.setBackdrop({ cx, cy }); }
      }
    }
    if (sh.t >= sh.dur) { sh.ready = false; nextShot(); }
  }

  function plate() {
    if (!S || !S.label || !S.shot) return;
    const sh = S.shot, e = entryByKey(sh.entry), V0 = VIRUSES[sh.entry] || {}, ids = pdbsOf(e);
    const tex = [];
    if (e.T) tex.push(`${TEX.T} = ${e.T.T}${e.T.hand ? '\\,' + e.T.hand : ''}`);
    if (e.look === 'rod') tex.push(TEX.helix);
    const c = CREDIT[ids[0]];
    const notes = [];
    if (e.illus) notes.push('Contains an illustration.');
    notes.push('The flights show the symmetry, not a measured assembly path.');
    notes.push('Data: ' + ids.map(id => 'PDB ' + id).join(', ') + ' — ' + c[1].split(',')[0] + ' et al. ' + c[2] + '.');
    const params = [
      { name: 'family', value: V0.family || '' },
      { name: 'size', value: e.size },
      { name: 'subunits', value: e.copies ? e.copies.n + ' ' + e.copies.text.replace(/ chains$/, '') : e.parts.map(p => p.count).join(' + ') + ' spikes' },
      { name: 'built from', value: V0.unit || '' },
      { name: 'PDB', value: ids.join(' + ') },
    ];
    let sub = sh.sub;
    if (sh.kind === 'inspect' && sh.region) {
      const rg = sh.region.reg;
      sub = rg.label.replace(/^./, ch => ch.toUpperCase()) + ', ≈ ' + (2 * sh.region.ext).toFixed(0) + ' nm';
    }
    const info = { title: e.name, sub, params, tex, lines: [notes.join(' ')] };
    info.anchor = () => {
      const { w, h } = app.size(), o = app.occ;
      const cw = w - o.l - o.r, ch = h - o.t - o.b;
      return { x: o.l + cw / 2, y: o.t + ch / 2, w: Math.min(cw, ch) * 0.8, h: Math.min(cw, ch) * 0.8, lead: false };
    };
    try { S.label(info); } catch (err) { /* the shell is gone */ }
  }

  window.snSaver = {
    enter(o = {}) {
      if (S) this.exit();
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      document.documentElement.classList.add('sn-saver');
      S = { plan: plan((o.seed >>> 0) || ((Date.now() & 0xffffff) + 1), calm, 240), i: 0, token: 0, shot: null, back: null,
        label: o.labels !== false && typeof o.label === 'function' ? o.label : null,
        keep: { key: G.key, mode: G.mode, orbit: G.orbit, axes: G.axes, sway: G.sway, breathe: G.breathe, rep: G.rep, color: G.color, pal: G.pal } };
      G.orbit = false; G.sway = true; G.breathe = true; G.axes = false;
      A.camLock = true; A.ladderPlay = false;
      import('../../lib/saver-clear.js').then(m => {
        if (!S) return;
        let band = null, at = -1e9;
        app.setBand(h => {
          const now = performance.now();
          if (now - at > 250) { at = now; band = m.plateBand(h) || band; }
          return band ? { t: band.t, b: band.b } : null;
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
      if (app.setBackdrop) app.setBackdrop(null);
      document.documentElement.classList.remove('sn-saver');
      A.camLock = false;
      V.camera.up.set(0, 1, 0);
      A.tour = null;
      Object.assign(G, { orbit: k.orbit, axes: k.axes, sway: k.sway, breathe: k.breathe, rep: k.rep, color: k.color });
      app.setPalette(k.pal); app.setLight('studio');
      if (k.mode === 'ladder') app.enterLadder({ u: 0, play: false });
      else app.show(k.key, { instant: true, drop: true });
    },
    cut(kind) { if (S) { const i = S.plan.findIndex((s, j) => j >= S.i && s.kind === kind); if (i >= 0) S.i = i; nextShot(); } },
    debug() {
      const s = S && S.shot;
      if (!s) return null;
      const lk = lookById(s.sh.look);
      return { kind: s.kind, entry: s.entry, t: s.t, dur: s.dur, ready: s.ready, cycle: s.sh.cycle, beat: S.i, look: lk.id,
        rep: repOf(s.entry), scheme: lk.scheme, pal: lk.pal, light: lk.rig, ex: s.sh.ex, stag: s.sh.stag, region: s.sh.region, band: app.occ,
        tour: A.tour ? { exT: A.tour.exT, iso: A.tour.iso, fade: A.tour.fade } : null };
    },
    // the region an inspection has lifted out (for node checks)
    region() { return S && S.shot && S.shot.region || null; },
  };
}
