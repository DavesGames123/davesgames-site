// ============================================================================
//  FLY DUEL 3D  ·  thrown dice and counter dice  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  The dice of Dice Lab (stella-nova/pages/dice) on the fly's mat. This
//  module imports the Dice Lab modules read-only: dice.js (shapes, face
//  table, face reader readDie, orientFor) and physics.js (the Rapier tray
//  and the throw). It never changes them.
//
//  THROWS. roll(rolls, { p, at, seed }) throws one real die per roll on
//  the mat of fly p. With Rapier (vendor rapier3d-compat 0.21.0, loaded on
//  the first throw) the throw is a Dice Lab simulation: simulateThrow()
//  runs the tray to rest at once and keeps the poses, and the scene plays
//  the poses back. readDie() reads the face that lands up. The engine
//  value is the true result (the rules rolled it), so the face atlas of
//  that die is drawn again with two labels swapped: the face that landed
//  up shows the engine value, and the face that had that value shows the
//  old label of the top face. The labels stay one permutation of the die.
//  Without Rapier (not loaded yet, or no WASM) the die does a scripted
//  tumble: a seeded arc and spin that ends at orientFor() of the face
//  with the engine value.
//
//  Units. Dice Lab works in cm. DIE_S world units per cm (a d20 is about
//  0.23 world units across). The tray is the 'medium' tray (32 x 22 cm),
//  turned to the seat and centred on the mat, with no visible walls: the
//  dice stay on the mat.
//
//  COUNTERS. counterDice: a small d6 (a d20 when the count is over 6) on
//  the top right corner of a permanent shows permanent.counters, one die
//  per counter kind (at most two). On a change the die hops and turns to
//  the face of the new value.
//
//  API
//      createDice({ reduced, coarse, physics: true }) -> { group,
//        warm() / ready (Promise: 'rapier' | 'scripted', starts the load), roll(rolls, { p, at:
//        Vector3, yaw, seed }) -> Promise<[{ die, value, landed, face,
//        mode }]>, setCounters(key, counters, holder), update(dt),
//        rolling, stats(), dispose() }
//      relabel(labels, top, value) -> labels (pure)
//      dieType(sides) -> Dice Lab type ('d6', 'd20', ...)
//
//  GREP MAP
//      grep -n 'export function relabel'   the label swap
//      grep -n 'function atlasCanvas'      the face atlas (own drawing)
//      grep -n 'function dieMesh'          Dice Lab mesh -> three mesh
//      grep -n 'async function loadRapier' vendor Rapier, once
//      grep -n 'function physicsThrow'     simulateThrow and the read
//      grep -n 'function scriptedThrow'    the tumble without Rapier
//      grep -n 'export function createDice'
// ============================================================================
import * as THREE from 'three';
import { buildDie, readDie, orientFor, DIE_TYPES, mulberry32 } from '../../../dice/dice.js';
import { createPhysics, simulateThrow } from '../../../dice/physics.js';
import { FLY, MONO } from '../tokens.js';

export const DIE_S = 0.12;          // world units per cm (thrown dice)
export const COUNTER_S = 0.075;     // world units per cm (counter dice)
const RAPIER_URL = new URL('../../../../vendor/rapier3d-compat@0.21.0/rapier.mjs', import.meta.url).href;

export function dieType(sides) {
  const t = `d${sides | 0}`;
  return DIE_TYPES[t] && t !== 'd100' ? t : 'd6';
}

// The labels of a die after the engine value is put on the top face.
export function relabel(labels, top, value) {
  const out = labels.slice(), want = String(value);
  const j = out.indexOf(want);
  if (j < 0) { out[top] = want; return out; }
  [out[top], out[j]] = [out[j], out[top]];
  return out;
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

// The face atlas of a die with its own labels (our drawing of the Dice
// Lab cell layout: cell i is face i in its right/up basis, the last cell
// is the bevel). Crisp flat colours, a hard ink, no blur.
const CELL = 128;
function atlasCanvas(die, labels, base, ink) {
  const size = die.cols * CELL, cv = makeCanvas(size, size);
  const g = cv?.getContext?.('2d');
  if (!g) return null;
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  die.faces.forEach((f, i) => {
    const ox = (i % die.cols) * CELL, oy = Math.floor(i / die.cols) * CELL;
    const P = f.poly.map(p => f.to2(p)).map(([x, y]) => [ox + (0.5 + x) * CELL, oy + (0.5 - y) * CELL]);
    const cx = ox + CELL / 2, cy = oy + CELL / 2;
    let rin = 1e9;
    P.forEach((a, k) => { const b = P[(k + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1; rin = Math.min(rin, Math.abs((cx - a[0]) * ey - (cy - a[1]) * ex) / l); });
    const s = labels[i];
    if (!s) return;
    g.save();
    g.fillStyle = ink;
    const size2 = Math.max(10, rin * (s.length > 1 ? 1.0 : 1.25));
    g.font = `700 ${Math.round(size2)}px ${MONO}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s, cx, cy + size2 * 0.04);
    if ((s === '6' || s === '9') && die.type !== 'd6') g.fillRect(cx - size2 * 0.22, cy + size2 * 0.42, size2 * 0.44, Math.max(2, size2 * 0.07));
    g.restore();
  });
  return cv;
}

// A three mesh of a Dice Lab die (cm), scaled by s.
const geoCache = new Map();
function dieGeometry(type) {
  if (geoCache.has(type)) return geoCache.get(type);
  const die = buildDie(type), m = die.mesh;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setIndex(m.index);
  geoCache.set(type, g);
  return g;
}
function dieMesh(type, labels, colour, ink) {
  const die = buildDie(type);
  const cv = atlasCanvas(die, labels, colour, ink);
  const tex = cv ? new THREE.CanvasTexture(cv) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; }
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : new THREE.Color(colour), roughness: 0.32, metalness: 0.0 });
  const mesh = new THREE.Mesh(dieGeometry(type), mat);
  mesh.castShadow = true;
  mesh.userData.labels = labels;
  return { mesh, die, tex, mat };
}
function redraw(d, labels, colour, ink) {
  const cv = atlasCanvas(d.die, labels, colour, ink);
  d.mesh.userData.labels = labels;
  if (!cv) return;
  d.tex?.dispose();
  d.tex = new THREE.CanvasTexture(cv); d.tex.colorSpace = THREE.SRGBColorSpace; d.tex.anisotropy = 4;
  d.mat.map = d.tex; d.mat.color.set(0xffffff); d.mat.needsUpdate = true;
}

// ------------------------------------------------------------------ Rapier
let rapierP = null;
async function loadRapier() {
  if (!rapierP) {
    rapierP = (async () => {
      const R = (await import(/* @vite-ignore */ RAPIER_URL)).default;
      await R.init({});
      return R;
    })().catch(() => null);
  }
  return rapierP;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

// A Dice Lab throw to rest. Returns the poses (every 2 steps), the read
// of each die and the sim time.
function physicsThrow(PH, types, seed) {
  let res = simulateThrow(PH, types, { seed, strength: 0.45, dir: [0, -1], record: 2 });
  // a cocked die: throw it again (Dice Lab rethrow) and read again
  for (let k = 0; k < 2 && res.reads.some(r => r.cocked); k++) {
    PH.rethrow(PH.dice.filter((o, i) => res.reads[i].cocked), seed + 101 * (k + 1));
    const more = [];
    let n = 0;
    while (PH.t < 12) { const rest = PH.step(); if (++n % 2 === 0) more.push(PH.poses()); if (rest) break; }
    more.push(PH.poses());
    res = { reads: PH.read(), t: res.t + PH.t, frames: res.frames.concat(more) };
  }
  return res;
}

// The scripted tumble: an arc from the hand to a seeded spot, spins that
// end at the face of the value.
function scriptedThrow(die, value, rnd) {
  let face = die.faces.findIndex(f => f.valued && f.label === String(value));
  if (die.type === 'd4') face = die.faces.findIndex(f => f.value === value);
  if (face < 0) face = 0;
  const end = orientFor(die, face, rnd() * Math.PI * 2);
  const from = [(rnd() - 0.5) * 6, 9, 8];
  const to = [(rnd() - 0.5) * 10, die.R * 0.75, -2 - rnd() * 6];
  const axis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
  return { face, end: new THREE.Quaternion(end[0], end[1], end[2], end[3]), from, to, axis, turns: 2 + Math.floor(rnd() * 3), dur: 1.1 };
}

// ================================================================ create
export function createDice({ reduced = false, coarse = false, physics = true } = {}) {
  const group = new THREE.Group(); group.name = 'dice';
  const live = [];        // thrown dice: { mesh, tray, frames, t, dur, hold, ... }
  const counters = new Map();   // key -> [{ kind, d, value, ... }]
  let PH = null, mode = 'scripted', readyP = null;
  // Rapier loads on the first warm() (the first roll, or a record with
  // dice), not when the scene starts: a game with no dice cards never
  // loads the WASM. Throws before the load ends use the scripted tumble.
  function warm() {
    if (!readyP) {
      readyP = (physics ? loadRapier() : Promise.resolve(null)).then(R => {
        if (R) { try { PH = createPhysics(R, { tray: 'medium' }); mode = 'rapier'; } catch { PH = null; } }
        return mode;
      });
    }
    return readyP;
  }
  let nThrows = 0;

  // rolls: [{ die, value }]. o.p: seat; o.at: world centre of the tray;
  // o.yaw: seat yaw (the throw goes from the seat to the centre).
  function roll(rolls, o = {}) {
    warm();
    const p = o.p ?? 0, seed = (o.seed ?? (1 + nThrows * 7919)) >>> 0, rnd = mulberry32(seed);
    nThrows++;
    const types = rolls.map(r => dieType(r.die));
    const tray = new THREE.Group();
    tray.position.copy(o.at || _v.set(0, 2, 0));
    tray.rotation.y = o.yaw ?? 0;
    tray.scale.setScalar(DIE_S);
    group.add(tray);
    const colour = FLY[p] || '#39d0f0', ink = '#05070c';
    const made = rolls.map((r, i) => {
      const die = buildDie(types[i]);
      const labels = die.faces.map(f => f.label);
      const d = dieMesh(types[i], labels, colour, ink);
      tray.add(d.mesh);
      return { ...d, roll: r, labels };
    });
    let frames = null, simT = 0, out;
    if (PH && mode === 'rapier') {
      const res = physicsThrow(PH, types, seed);
      frames = res.frames; simT = res.t;
      out = made.map((d, i) => {
        const rd = res.reads[i];
        const landed = rd.label;
        const labels = d.die.type === 'd4' ? d.labels : relabel(d.labels, rd.face, d.roll.value);
        if (d.die.type !== 'd4') redraw(d, labels, colour, ink);
        return { die: d.roll.die, value: d.roll.value, landed, face: rd.face, mode: 'rapier', cocked: !!rd.cocked };
      });
    } else {
      out = made.map(d => {
        const sc = scriptedThrow(d.die, d.roll.value, rnd);
        d.script = sc;
        return { die: d.roll.die, value: d.roll.value, landed: String(d.roll.value), face: sc.face, mode: 'scripted' };
      });
    }
    const play = reduced ? 0 : frames ? Math.min(2.2, simT) : 1.1;
    const entry = { tray, made, frames, simT, t: 0, play, hold: 1.8, fade: 0.35, out };
    let resolve;
    entry.done = new Promise(r => { resolve = r; });
    entry.resolve = resolve;
    pose(entry, reduced ? 1 : 0);
    live.push(entry);
    return entry.done.then(() => out);
  }

  // Pose a throw at playback fraction k (0..1).
  function pose(e, k) {
    if (e.frames) {
      const F = e.frames, x = k * (F.length - 1), i = Math.min(F.length - 2, Math.floor(x)), f = x - i;
      e.made.forEach((d, j) => {
        const a = F[Math.max(0, i)], b = F[Math.min(F.length - 1, i + 1)], o = j * 7;
        if (!a) return;
        d.mesh.position.set(a[o] + (b[o] - a[o]) * f, a[o + 1] + (b[o + 1] - a[o + 1]) * f, a[o + 2] + (b[o + 2] - a[o + 2]) * f);
        _q.set(a[o + 3], a[o + 4], a[o + 5], a[o + 6]); _q2.set(b[o + 3], b[o + 4], b[o + 5], b[o + 6]);
        d.mesh.quaternion.slerpQuaternions(_q, _q2, f);
      });
    } else {
      e.made.forEach(d => {
        const s = d.script, kk = Math.min(1, k);
        const ease = 1 - Math.pow(1 - kk, 2);
        d.mesh.position.set(s.from[0] + (s.to[0] - s.from[0]) * ease, s.to[1] + (s.from[1] - s.to[1]) * (1 - ease) + Math.abs(Math.sin(kk * Math.PI * 2.5)) * (1 - kk) * 4, s.from[2] + (s.to[2] - s.from[2]) * ease);
        _q.setFromAxisAngle(s.axis, (1 - kk) * s.turns * Math.PI * 2);
        d.mesh.quaternion.copy(s.end).premultiply(_q);
      });
    }
  }

  // ------------------------------------------------------------ counters
  // key: a permanent uid. counters: { kind: n } or null. holder: the
  // object whose world matrix carries the dice (a card mesh), or null.
  const KIND_COLOUR = ['#e9e4d6', '#3ee89a', '#ffb347', '#b58ad0', '#6cc4e8'];
  function kindColour(kind) { let h = 0; for (const c of String(kind)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return KIND_COLOUR[h % KIND_COLOUR.length]; }
  function setCounters(key, cs, holder) {
    const list = counters.get(key) || [];
    const kinds = cs ? Object.keys(cs).filter(k => cs[k] > 0).sort().slice(0, 2) : [];
    // remove dice of kinds that are gone
    for (const c of list.slice()) if (!kinds.includes(c.kind)) { group.remove(c.d.mesh); c.d.mat.dispose(); c.d.tex?.dispose(); list.splice(list.indexOf(c), 1); }
    kinds.forEach((kind, i) => {
      const n = Math.max(1, cs[kind] | 0), type = n > 6 ? 'd20' : 'd6';
      let c = list.find(x => x.kind === kind);
      if (c && c.type !== type) { group.remove(c.d.mesh); c.d.mat.dispose(); c.d.tex?.dispose(); list.splice(list.indexOf(c), 1); c = null; }
      if (!c) {
        const die = buildDie(type);
        const d = dieMesh(type, die.faces.map(f => f.label), kindColour(kind), '#05070c');
        d.mesh.scale.setScalar(COUNTER_S);
        group.add(d.mesh);
        c = { kind, type, d, die, value: null, from: new THREE.Quaternion(), to: new THREE.Quaternion(), t: 1, slot: i };
        list.push(c);
      }
      c.slot = i; c.holder = holder;
      const v = Math.min(type === 'd6' ? 6 : 20, n);
      if (v !== c.value) {
        const face = c.die.faces.findIndex(f => f.valued && f.label === String(v));
        const q = orientFor(c.die, Math.max(0, face), 0.3);
        c.from.copy(c.d.mesh.quaternion); c.to.set(q[0], q[1], q[2], q[3]);
        c.t = c.value == null || reduced ? 1 : 0;
        if (c.t >= 1) c.d.mesh.quaternion.copy(c.to);
        c.value = v; c.n = n;
      }
    });
    if (kinds.length) counters.set(key, list); else counters.delete(key);
  }
  const _m = new THREE.Vector3(), _hq = new THREE.Quaternion(), _yaw = new THREE.Quaternion(), _e = new THREE.Euler();
  function placeCounters(dt) {
    for (const list of counters.values()) {
      for (const c of list) {
        const h = c.holder;
        const R = c.die.R * COUNTER_S;
        if (h) {
          h.updateWorldMatrix(true, false);
          // the top right corner of the card face, in the card frame (+z
          // is out of the face), then up by the die radius
          _m.set(0.17 - c.slot * 0.2, 0.26, 0).applyMatrix4(h.matrixWorld);
          _m.y += R * 0.8;
          h.getWorldQuaternion(_hq);
          _e.setFromQuaternion(_hq, 'YXZ');
          _yaw.setFromAxisAngle(_v.set(0, 1, 0), _e.y);
        } else { _m.set(0, -10, 0); _yaw.identity(); }
        if (c.t < 1) c.t = Math.min(1, c.t + dt / 0.55);
        const k = c.t, hop = Math.sin(Math.PI * k) * 0.22;
        c.d.mesh.position.copy(_m); c.d.mesh.position.y += hop;
        c.d.mesh.quaternion.slerpQuaternions(c.from, c.to, k < 1 ? k * k * (3 - 2 * k) : 1).premultiply(_yaw);
      }
    }
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i];
      e.t += dt;
      const k = e.play > 0 ? Math.min(1, e.t / e.play) : 1;
      pose(e, k);
      if (e.t > e.play + e.hold) {
        const f = Math.min(1, (e.t - e.play - e.hold) / e.fade);
        e.tray.scale.setScalar(DIE_S * (1 - f) + 1e-4);
        if (f >= 1) {
          group.remove(e.tray);
          for (const d of e.made) { d.mat.dispose(); d.tex?.dispose(); }
          live.splice(i, 1);
          e.resolve();
        }
      }
    }
    placeCounters(dt);
  }

  return {
    group, roll, update, setCounters, warm,
    get ready() { return warm(); },
    get mode() { return mode; },
    get rolling() { return live.length > 0; },
    stats: () => ({ thrown: live.reduce((n, e) => n + e.made.length, 0), counters: [...counters.values()].reduce((n, l) => n + l.length, 0), mode, throws: nThrows }),
    counterDice: key => (counters.get(key) || []).map(c => ({ kind: c.kind, type: c.type, value: c.value, n: c.n, mesh: c.d.mesh })),
    topLabels: () => live.flatMap(e => e.made.map(d => {
      // the label on the face that is up now (the face reader of Dice Lab)
      const q = d.mesh.quaternion;
      const rd = readDie(d.die, [q.x, q.y, q.z, q.w]);
      return d.mesh.userData.labels[rd.face];
    })),
    dispose() {
      for (const e of live) { for (const d of e.made) { d.mat.dispose(); d.tex?.dispose(); } e.resolve(); }
      live.length = 0;
      for (const list of counters.values()) for (const c of list) { c.d.mat.dispose(); c.d.tex?.dispose(); }
      counters.clear();
      try { PH?.free(); } catch { /* freed */ }
    },
  };
}
