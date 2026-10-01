// ============================================================================
//  HUMAN SKULL  ·  arrange.js — where each part goes, and how it gets there
// ────────────────────────────────────────────────────────────────────────────
//  layoutFor(name, parts, aspect) returns one { pos, quat } per part: the
//  place of that part at full spread (explode = 1). The page mixes it with
//  the home place by the explode amount e:  pos = home + (full - home) * e.
//
//    anatomy   hand-set offsets per bone; the teeth ride on their jaw and
//              fan out from the centre of their arch, out of the sockets
//    symmetry  a specimen board facing the viewer: the midline bones in a
//              centre column, each left/right pair mirrored in its row
//    region    four clusters (cranial, facial, dentition, hyoid), each still
//              in its anatomical shape, in a row (wide screen) or 2 x 2
//    tray      a catalogue: every part laid flat (its thinnest axis up) on
//              a specimen tray, sorted by surface area, in shelf rows
//
//  MOTION  (createMotion)
//    A part follows an anchor that eases from the old place to the new one
//    along a small arc towards the camera. A spring (zeta about 0.55) pulls
//    the part to the anchor, so it lands with a slight overshoot. Starts are
//    staggered: outer parts lead when the skull opens, inner parts lead
//    when it closes. A dragged part keeps its speed on release and springs
//    back.
//
//  GREP MAP
//    const ANATOMY ........... offsets for the anatomical explode
//    function layoutSymmetry .. the mirrored board
//    function layoutRegion .... the four clusters
//    function layoutTray ...... the catalogue tray and its slots
//    export function createMotion  anchors, springs, stagger, drag
// ============================================================================
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q0 = new THREE.Quaternion();

// ── anatomy ─────────────────────────────────────────────────────────────────
// offset at full spread, mm; s = -1 on the right side, +1 on the left
const ANATOMY = {
  frontal: () => V(0, 70, 52), parietal: s => V(56 * s, 62, -12), occipital: () => V(0, 8, -88),
  temporal: s => V(74 * s, -4, -6), sphenoid: () => V(0, -6, -2), ethmoid: () => V(0, 22, 48),
  vomer: () => V(0, -18, 26), nasal: s => V(12 * s, 22, 96), lacrimal: s => V(34 * s, 14, 62),
  zygomatic: s => V(72 * s, -14, 44), maxilla: s => V(34 * s, -40, 70), palatine: s => V(28 * s, -54, 18),
  concha: s => V(20 * s, -26, 58), mandible: () => V(0, -112, 48), hyoid: () => V(0, -175, 30),
};
function layoutAnatomy(parts) {
  const base = k => k.replace(/-(r|l)$/, '');
  const sgn = p => p.m.side === 'right' ? -1 : p.m.side === 'left' ? 1 : 0;
  const off = {};
  for (const p of parts) if (p.m.group !== 'dentition') off[p.m.key] = ANATOMY[base(p.m.key)](sgn(p));
  // the arch centre of each jaw, in x and z
  const arch = { upper: V(0, 0, 0), lower: V(0, 0, 0) }, n = { upper: 0, lower: 0 };
  for (const p of parts) if (p.m.fdi) { const j = p.m.fdi[0] <= '2' ? 'upper' : 'lower'; arch[j].add(p.home); n[j]++; }
  for (const j in arch) arch[j].multiplyScalar(1 / n[j]);
  const maxMid = off['maxilla-r'].clone().add(off['maxilla-l']).multiplyScalar(0.5);
  return parts.map(p => {
    let o;
    if (p.m.fdi) {
      const upper = p.m.fdi[0] <= '2';
      const a = upper ? arch.upper : arch.lower;
      const rad = V(p.home.x - a.x, 0, p.home.z - a.z + 10).multiplyScalar(1.25);
      o = (upper ? maxMid.clone() : off.mandible.clone()).add(rad).add(V(0, upper ? -20 : 22, upper ? 4 : 8));
    } else o = off[p.m.key];
    return { pos: p.home.clone().add(o), quat: Q0.clone() };
  });
}

// ── symmetry: the mirrored board ───────────────────────────────────────────
const SYM_ROWS = [
  { mid: ['frontal'], pairs: ['parietal'] },
  { mid: ['occipital'], pairs: ['temporal'] },
  { mid: ['sphenoid'], pairs: ['zygomatic', 'maxilla'] },
  { mid: ['ethmoid', 'vomer'], pairs: ['nasal', 'lacrimal', 'palatine', 'concha'] },
  { mid: ['mandible', 'hyoid'], pairs: [], teeth: true },
];
function layoutSymmetry(parts) {
  const byKey = Object.fromEntries(parts.map(p => [p.m.key, p]));
  const out = parts.map(p => ({ pos: p.home.clone(), quat: Q0.clone() }));
  const ext = p => p.m.ext, G = 12;
  // first pass: row heights and the widest midline item
  const rows = SYM_ROWS.map(r => {
    const mids = r.mid.map(k => byKey[k]);
    const midH = mids.reduce((s, p) => s + ext(p)[1], 0) + G * (mids.length - 1);
    const midW = Math.max(...mids.map(p => ext(p)[0]));
    let h = midH;
    for (const k of r.pairs) h = Math.max(h, ext(byKey[k + '-l'])[1]);
    if (r.teeth) h = Math.max(h, 2 * 31 + 10);
    return { ...r, mids, midH, midW, h };
  });
  const total = rows.reduce((s, r) => s + r.h, 0) + 18 * (rows.length - 1);
  let y = total / 2;
  for (const r of rows) {
    const cy = y - r.h / 2;
    // midline parts stacked in the centre column
    let my = cy + r.midH / 2;
    for (const p of r.mids) { out[p.i].pos.set(0, my - ext(p)[1] / 2, 0); my -= ext(p)[1] + G; }
    // pairs outward from the column, mirrored
    let x = r.midW / 2 + 16;
    for (const k of r.pairs) {
      const L = byKey[k + '-l'], R = byKey[k + '-r'], w = Math.max(ext(L)[0], ext(R)[0]);
      out[L.i].pos.set(x + w / 2, cy, 0); out[R.i].pos.set(-(x + w / 2), cy, 0);
      x += w + G;
    }
    if (r.teeth) {
      // upper teeth on the top line, lower on the bottom, incisors inside
      for (const jaw of ['upper', 'lower']) {
        let tx = r.midW / 2 + 16;
        const q = jaw === 'upper' ? ['1', '2'] : ['4', '3'];
        for (let n = 1; n <= 7; n++) {
          const R = byKey['tooth-' + q[0] + n], L = byKey['tooth-' + q[1] + n];
          const w = Math.max(ext(L)[0], ext(R)[0]);
          const ty = cy + (jaw === 'upper' ? 1 : -1) * (r.h / 4 + 2);
          out[L.i].pos.set(tx + w / 2, ty, 0); out[R.i].pos.set(-(tx + w / 2), ty, 0);
          tx += w + 5;
        }
      }
    }
    y -= r.h + 18;
  }
  return out;
}

// ── region: four clusters ───────────────────────────────────────────────────
export const REGIONS = [
  { group: 'cranial', label: 'Cranial', unit: 'bones' },
  { group: 'facial', label: 'Facial', unit: 'bones' },
  { group: 'dentition', label: 'Dentition', unit: 'teeth' },
  { group: 'hyoid', label: 'Hyoid', unit: 'bone' },
];
function layoutRegion(parts, aspect) {
  const out = parts.map(p => ({ pos: p.home.clone(), quat: Q0.clone() }));
  const spread = { cranial: 1.16, facial: 1.32, dentition: 1.75, hyoid: 1 };
  const box = {};
  for (const R of REGIONS) {
    const ps = parts.filter(p => p.m.group === R.group);
    const c = ps.reduce((s, p) => s.add(p.home), V(0, 0, 0)).multiplyScalar(1 / ps.length);
    const b = new THREE.Box3();
    for (const p of ps) {
      const pos = p.home.clone().sub(c).multiplyScalar(spread[R.group]);
      out[p.i].pos.copy(pos);
      const h = V(...p.m.ext).multiplyScalar(0.5);
      b.expandByPoint(pos.clone().sub(h)); b.expandByPoint(pos.clone().add(h));
    }
    box[R.group] = { b, ps };
  }
  // anchor each cluster: a row on a wide screen, two by two on a tall one
  const size = g => box[g].b.getSize(V(0, 0, 0));
  const place = (g, x, y) => {
    const c = box[g].b.getCenter(V(0, 0, 0));
    for (const p of box[g].ps) out[p.i].pos.add(V(x - c.x, y - c.y, -c.z));
    box[g].at = V(x, y, 0);
  };
  const gap = 46;
  if (aspect >= 1.05) {
    const w = ['cranial', 'facial'].map(g => size(g).x), dw = Math.max(size('dentition').x, size('hyoid').x);
    const total = w[0] + w[1] + dw + 2 * gap;
    let x = -total / 2;
    place('cranial', x + w[0] / 2, 0); x += w[0] + gap;
    place('facial', x + w[1] / 2, 0); x += w[1] + gap;
    const dh = size('dentition').y, hh = size('hyoid').y;
    place('dentition', x + dw / 2, (hh + gap * 1.2) / 2);
    place('hyoid', x + dw / 2, -(dh + gap * 1.2) / 2);
  } else {
    const top = Math.max(size('cranial').y, size('facial').y), bot = Math.max(size('dentition').y, size('hyoid').y);
    const wl = Math.max(size('cranial').x, size('dentition').x), wr = Math.max(size('facial').x, size('hyoid').x);
    const vg = gap * 1.6;
    const xl = -(wl + wr + gap) / 2 + wl / 2, xr = xl + wl / 2 + gap + wr / 2;
    const yt = (top + bot + vg) / 2 - top / 2, yb = yt - top / 2 - vg - bot / 2;
    place('cranial', xl, yt); place('facial', xr, yt); place('dentition', xl, yb); place('hyoid', xr, yb);
  }
  // label points: just above each cluster
  const labels = REGIONS.map(R => ({ ...R, n: box[R.group].ps.length, at: box[R.group].at.clone().add(V(0, size(R.group).y / 2 + 14, 0)) }));
  return { out, labels };
}

// ── tray: lay each part flat, shelf-pack by size ───────────────────────────
function flatQuat(p) {
  const [x, y, z] = p.m.ext, q = new THREE.Quaternion();
  if (y <= x && y <= z) return { q, foot: [x, z], h: y };
  if (x <= z) {
    // thinnest across: roll about z so the outer face looks up
    q.setFromAxisAngle(V(0, 0, 1), (p.m.side === 'right' ? -1 : 1) * Math.PI / 2);
    return { q, foot: [y, z], h: x };
  }
  q.setFromAxisAngle(V(1, 0, 0), -Math.PI / 2);        // front face up, top away
  return { q, foot: [x, y], h: z };
}
export const TRAY_Y = -150;
function layoutTray(parts, aspect) {
  const items = parts.map(p => ({ p, ...flatQuat(p) })).sort((a, b) => b.p.m.area - a.p.m.area);
  const G = 16, LAB = 14;                         // gap, and room for the slot label
  const area = items.reduce((s, it) => s + (it.foot[0] + G) * (it.foot[1] + G + LAB), 0);
  const want = Math.min(1.9, Math.max(0.72, aspect * 1.05));
  const W = Math.sqrt(area * want) * 1.08;
  const rows = [];
  let row = { items: [], w: 0, d: 0 };
  for (const it of items) {
    if (row.items.length && row.w + it.foot[0] + G > W) { rows.push(row); row = { items: [], w: 0, d: 0 }; }
    row.items.push(it); row.w += it.foot[0] + G; row.d = Math.max(row.d, it.foot[1]);
  }
  rows.push(row);
  const D = rows.reduce((s, r) => s + r.d + G + LAB, 0) - G;
  const out = parts.map(() => null), slots = [];
  let z = -D / 2, n = 1;
  for (const r of rows) {
    let x = -(r.w - G) / 2;
    for (const it of r.items) {
      const cx = x + it.foot[0] / 2, cz = z + r.d / 2;
      out[it.p.i] = { pos: V(cx, TRAY_Y + it.h / 2 + 0.5, cz), quat: it.q };
      slots.push({ n: n++, i: it.p.i, x: cx, z: z + r.d + 7, w: it.foot[0] });
      x += it.foot[0] + G;
    }
    z += r.d + G + LAB;
  }
  const maxW = Math.max(...rows.map(r => r.w - G));
  return { out, slots, size: [maxW + 70, D + 70] };
}

export function layoutFor(name, parts, aspect) {
  if (name === 'anatomy') return { out: layoutAnatomy(parts) };
  if (name === 'symmetry') return { out: layoutSymmetry(parts) };
  if (name === 'region') return layoutRegion(parts, aspect);
  if (name === 'tray') return layoutTray(parts, aspect);
  throw new Error('layout ' + name);
}

// ── motion ──────────────────────────────────────────────────────────────────
const easeInOut = t => t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export function createMotion(parts, o) {
  const M = parts.map(p => ({
    pos: p.home.clone(), vel: V(0, 0, 0), quat: new THREE.Quaternion(),
    from: p.home.clone(), to: p.home.clone(), qFrom: new THREE.Quaternion(), qTo: new THREE.Quaternion(),
    t0: 0, dur: 0.001, lift: 0, anchor: p.home.clone(), drag: null, phase: (p.i * 2.39996) % (Math.PI * 2),
  }));
  const liftDir = V(0, 0, 1);
  // move every part to targets[i] = { pos, quat }; order: 'out' | 'in' | null
  function go(targets, now, { stagger = 0.55, dur = 1.05, order = 'out' } = {}) {
    const dist = parts.map(p => p.home.length() + (p.m.group === 'dentition' ? 40 : 0));
    const rank = parts.map((_, i) => i).sort((a, b) => order === 'in' ? dist[a] - dist[b] : dist[b] - dist[a]);
    const at = new Array(parts.length);
    rank.forEach((i, r) => { at[i] = r / Math.max(1, parts.length - 1); });
    for (let i = 0; i < M.length; i++) {
      const m = M[i], t = targets[i];
      m.from.copy(m.anchor); m.qFrom.copy(m.quat);
      m.to.copy(t.pos); m.qTo.copy(t.quat);
      const d = m.from.distanceTo(m.to);
      m.t0 = now + (order ? at[i] * stagger : 0);
      m.dur = o.reduced ? 0.001 : dur * (0.75 + Math.min(0.5, d / 600));
      m.lift = Math.min(36, d * 0.14);
    }
  }
  // set targets with no ease (the slider): the springs do the smoothing
  function snap(targets) {
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      m.to.copy(targets[i].pos); m.qTo.copy(targets[i].quat);
      m.from.copy(m.to); m.qFrom.copy(m.qTo); m.t0 = -1e9; m.dur = 0.001; m.lift = 0;
    }
  }
  // per frame: anchors, springs, the idle float
  const tmp = V(0, 0, 0), acc = V(0, 0, 0), fq = new THREE.Quaternion(), fe = new THREE.Euler();
  function step(now, dt, { float = 0, camDir } = {}) {
    if (camDir) liftDir.copy(camDir);
    const w = o.reduced ? 30 : 13, z = 0.56, n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < M.length; i++) {
      const m = M[i], mesh = parts[i].mesh;
      const k = easeInOut((now - m.t0) / m.dur);
      m.anchor.lerpVectors(m.from, m.to, k).addScaledVector(liftDir, Math.sin(Math.PI * k) * m.lift);
      m.quat.slerpQuaternions(m.qFrom, m.qTo, k);
      if (m.drag) { m.vel.copy(m.drag).sub(m.pos).multiplyScalar(1 / Math.max(dt, 1e-3)); m.pos.copy(m.drag); }
      else for (let s = 0; s < n; s++) {
        acc.copy(m.anchor).sub(m.pos).multiplyScalar(w * w).addScaledVector(m.vel, -2 * z * w);
        m.vel.addScaledVector(acc, h); m.pos.addScaledVector(m.vel, h);
      }
      mesh.position.copy(m.pos);
      mesh.quaternion.copy(m.quat);
      if (float > 0.001 && !m.drag) {
        const t = now * 0.65 + m.phase;
        mesh.position.y += Math.sin(t) * 1.7 * float;
        fe.set(Math.sin(t * 0.8) * 0.012 * float, Math.cos(t * 0.6) * 0.016 * float, 0);
        mesh.quaternion.multiply(fq.setFromEuler(fe));
      }
      parts[i].settle = tmp.copy(m.anchor).sub(m.pos).length();
    }
  }
  return { M, go, snap, step };
}
