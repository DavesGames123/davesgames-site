// ============================================================================
//  PLANETARY GEARBOX  ·  scene.js — the 3D parts of one gear set, and pose
// ────────────────────────────────────────────────────────────────────────────
//  build(B, L) makes every part of the layout L (layout.js) with the builder
//  B (kit.js) and returns:
//    pose(ang) ...... turns each member to its angle (gears.js poseAngles)
//                     and places and spins each planet (gears.js planetAngle)
//    box ............ { c0, c1, R0, R1 }: centre z and radius, assembled and
//                     fully exploded, for the camera
//  The teeth are true involutes from gears.js toothOutline. A ring is a
//  smooth rim with a toothed band inside it, cut by an external outline of
//  the same tooth count (an internal tooth space is that outline's tooth).
//
//  GREP MAP
//    function spider ......... carrier plate outline: hub, arms, pin bosses
//    function gear ........... an external gear body
//    function ringGear ....... toothed band and rim
//    function band ........... a brake band with its lining and ears
//    const KINDS ............. one builder per layout kind
//    export function build ... all parts, then pose
// ============================================================================
import * as THREE from 'three';
import { lathe, tubeWall, rod, circlePath, slabXY, outlineShape, merge } from './kit.js';
import { toothOutline, planetAngle, MODELS, TAU } from './gears.js';

const PITCH_COL = { sun: 0xffd27a, planet: 0x9fd0ff, ring: 0xff9f80 };
// A pin end stands this far (mm) out from its carrier plate. The pin and
// the plate hole have the same radius: an end 0.1 mm inside the hole made
// the pin end and the hole bevel fight in the depth buffer.
const PIN_OUT = 0.4;

// carrier plate outline: a hub, an arm to each pin and a round boss on each
// pin. The outline is star-shaped about the axis, so it is sampled by angle.
function spiderShape(S, hubR, armW) {
  const n = 720, pts = [];
  for (let k = 0; k < n; k++) {
    const th = k / n * TAU;
    let r = hubR;
    for (const ps of S.psi) {
      let d = th - ps; d = Math.atan2(Math.sin(d), Math.cos(d));
      const sd = S.a * Math.sin(d);
      if (Math.abs(sd) <= S.bo) r = Math.max(r, S.a * Math.cos(d) + Math.sqrt(S.bo * S.bo - sd * sd));
      if (Math.abs(d) < Math.PI / 2) r = Math.max(r, Math.min(S.a, armW / Math.max(1e-6, Math.abs(Math.sin(d)))));
    }
    pts.push(new THREE.Vector2(r * Math.cos(th), r * Math.sin(th)));
  }
  // Remove the points on the straight arm edges. The triangulation made
  // slivers of three such points on the plate faces, and the slivers lay
  // over other cap triangles in one plane (z-fighting). A point that is
  // less than 1e-5 mm from the chord of its neighbours is on a line.
  const keep = [];
  for (let k = 0; k < n; k++) {
    const a = keep.length ? keep[keep.length - 1] : pts[n - 1], b = pts[k], c = pts[(k + 1) % n];
    const cx = c.x - a.x, cy = c.y - a.y, len = Math.hypot(cx, cy);
    if (len > 0 && Math.abs(cx * (b.y - a.y) - cy * (b.x - a.x)) / len < 1e-5) continue;
    keep.push(b);
  }
  // A concave corner (hub to arm) is where the bevel offset folds: the
  // 0.2 mm arc steps next to it moved out past the corner and crossed.
  // Remove the points less than 1.5 mm from such a corner (the new chord
  // is at most 0.03 mm from the old outline). Of two corner points closer
  // than 1.5 mm, only the sharper one stays.
  const m = keep.length, turn = k => {
    const a = keep[(k + m - 1) % m], b = keep[k], c = keep[(k + 1) % m];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    return (ux * vy - uy * vx) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
  };
  const tk = keep.map((q, k) => turn(k)), corners = keep.filter((q, k) => tk[k] < -0.17);
  const near = (q, c) => c !== q && c.distanceTo(q) < 1.5;
  return new THREE.Shape(keep.filter((q, k) => corners.every(c => !near(q, c) || (corners.includes(q) && tk[k] < tk[keep.indexOf(c)]))));
}
const pinHoles = (S, r) => S.psi.map(p => circlePath(r, S.a * Math.cos(p), S.a * Math.sin(p)));
// hex bolt heads on a circle, facing +z (dir 1) or -z (dir -1) from face z
function bolts(n, R, rh, z, dir, a0 = 0) {
  const gs = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + i / n * TAU, g = rod(rh, dir > 0 ? z - 0.2 : z - 2.2, dir > 0 ? z + 2.2 : z + 0.2, 6, 0.3);
    g.rotateZ(a); g.translate(R * Math.cos(a), R * Math.sin(a), 0); gs.push(g);
  }
  return merge(gs);
}
// an external gear body: Z teeth of module m from z0 to z1, optional bore
function gear(Z, m, z0, z1, bore, o = {}) {
  const pts = toothOutline(Z, m, { steps: Z > 60 ? 6 : 8, back: 0.05 * m, ...o });
  return slabXY(outlineShape(pts, bore ? [circlePath(bore)] : []), z0, z1 - z0, Math.min(0.45, 0.18 * m), 48);
}
// ring: a toothed band (cut by an external outline of Zr teeth whose teeth
// are the ring's spaces) inside a smooth turned rim
function ringGear(B, p, S, z0, z1) {
  const cutter = toothOutline(S.Zr, S.m, { add: 1.25 * S.m, ded: S.m, back: -0.05 * S.m, steps: 6 });
  const hole = new THREE.Path(cutter.map(q => new THREE.Vector2(q[0], q[1])).reverse());
  const band = new THREE.Shape(); band.absarc(0, 0, S.rrR + 1.2, 0, TAU, false); band.holes.push(hole);
  B.mesh(p, slabXY(band, z0 + 0.3, z1 - z0 - 0.6, 0.35, 160), 'ring');
  B.mesh(p, tubeWall(S.rrR + 1, S.rrO, z0, z1, 160, 0.8), 'ring');
  // two fine turned grooves on the outside of the rim
  const gz = (z1 - z0) * 0.22;
  B.mesh(p, merge([tubeWall(S.rrO - 0.35, S.rrO + 0.02, z0 + gz - 0.4, z0 + gz + 0.4, 160, 0.1), tubeWall(S.rrO - 0.35, S.rrO + 0.02, z1 - gz - 0.4, z1 - gz + 0.4, 160, 0.1)]), 'groove', { pick: false });
  B.pitchCircle(p, S.rr, z1 + 0.15, PITCH_COL.ring);
}
// a brake band: lining and steel strap round the drum, open at the bottom,
// with an ear at each end
function band(B, p, r, z0, z1) {
  const gap = 14 * Math.PI / 180, ph0 = gap, len = TAU - 2 * gap;
  B.mesh(p, lathe([[[r + 1.3, z0]], [[r + 1.3, z1]], [[r, z1]], [[r, z0]]], 128, ph0, len), 'lining');
  B.mesh(p, lathe([[[r + 3.4, z0 + 0.3]], [[r + 3.4, z1 - 0.3]], [[r + 1.3, z1 - 0.3]], [[r + 1.3, z0 + 0.3]]], 128, ph0, len), 'band');
  const ears = [];
  for (const sg of [-1, 1]) {
    // the ear end faces stand 0.4 mm inside the strap end faces (z0 + 0.3,
    // z1 - 0.3): at the same z, the two faces z-fought where they overlap
    const e = new THREE.BoxGeometry(5, 8.5, z1 - z0 - 1.4);
    const a = -Math.PI / 2 + sg * (gap + 0.02);
    e.translate(0, r + 6.6, 0); e.rotateZ(a - Math.PI / 2); e.translate(0, 0, (z0 + z1) / 2);
    ears.push(e);
  }
  // the anchor strut between the two ears
  const strut = rod(1.6, z0 + 3, z1 - 3, 16); strut.translate(0, -(r + 8), 0);
  B.mesh(p, merge([...ears.map(e => e.toNonIndexed())]), 'band');
  B.mesh(p, strut, 'pin', { pick: false });
}
const flange = (B, p, R, z0, z1, dir) => {
  B.mesh(p, rod(R, z0, z1, 64, 0.8), 'shaft');
  B.mesh(p, bolts(6, R * 0.68, Math.max(1.6, R * 0.12), dir > 0 ? z1 : z0, dir, Math.PI / 6), 'dark', { pick: false });
};

// ── one builder per layout kind ─────────────────────────────────────────────
const KINDS = {
  sun(B, p, L) {
    const S = L.sets[0], G = L.g, b = G.b;
    B.mesh(p, gear(S.Zs, S.m, -b / 2, b / 2, 0), 'sun');
    B.mesh(p, rod(G.sh, -G.Lin + 7.5, -b / 2 + 0.5), 'shaft');
    flange(B, p, G.flangeR, -G.Lin, -G.Lin + 8, -1);
    B.pitchCircle(p, S.rs, b / 2 + 0.15, PITCH_COL.sun);
    p.labelAt = [0, S.rs * 0.2, b / 2];
  },
  longSun(B, p, L) {
    const S = L.sets[0], G = L.g;
    B.mesh(p, gear(S.Zs, S.m, G.zS0, G.zS1, 0), 'sun');
    B.mesh(p, rod(G.sh, G.zS1 - 0.5, G.zEnd), 'shaft');
    for (const T of L.sets) B.pitchCircle(p, S.rs, T.z + T.b / 2 + 0.15 + (T.z > 0 ? 0 : 0), PITCH_COL.sun);
    p.labelAt = [0, S.rsT, 0];
  },
  planet(B, p, L) {
    const S = L.sets[p.L.set], e = p.L.env[0];
    B.mesh(p, gear(S.Zp, S.m, e.z0, e.z1, S.bore), 'planet');
    // a needle cage in the bore, seen at each face. It stands 0.25 mm out
    // from the gear face and clear of the pin, so no two faces touch
    B.mesh(p, merge([tubeWall(S.pr + 0.08, S.bore + 0.9, e.z0 - 0.25, e.z0 + 1.2, 48, 0.2), tubeWall(S.pr + 0.08, S.bore + 0.9, e.z1 - 1.2, e.z1 + 0.25, 48, 0.2)]), 'brass', { pick: false });
    B.pitchCircle(p, S.rp, e.z1 + 0.15, PITCH_COL.planet);
    p.labelAt = [0, 0, e.z1];
  },
  ring(B, p, L) {
    const S = L.sets[p.L.set], e = p.L.env[0];
    ringGear(B, p, S, e.z0, e.z1);
    p.labelAt = [0, S.rrO + 2, e.z1];
  },
  pins(B, p, L) {
    const S = L.sets[0], G = L.g;
    B.mesh(p, merge(S.psi.map(ps => { const g = rod(S.pr, -G.zp1 - PIN_OUT, G.zp1 + PIN_OUT, 24, 0.4); g.translate(S.a * Math.cos(ps), S.a * Math.sin(ps), 0); return g; })), 'pin');
  },
  plateBack(B, p, L) {
    const S = L.sets[0], G = L.g;
    const sh = spiderShape(S, Math.max(G.sh + 7, S.rsR * 0.62), Math.max(S.pr + 1.5, 0.62 * S.bo));
    sh.holes.push(circlePath(G.sh + 1.5), ...pinHoles(S, S.pr));
    B.mesh(p, slabXY(sh, -G.zp1, G.t, 0.7), 'carrier');
  },
  plateFront(B, p, L) {
    const S = L.sets[0], G = L.g;
    const sh = spiderShape(S, Math.max(G.sh * 1.9, S.rsR * 0.62), Math.max(S.pr + 1.5, 0.62 * S.bo));
    sh.holes.push(...pinHoles(S, S.pr));
    B.mesh(p, slabXY(sh, G.zp0, G.t, 0.7), 'carrier');
    B.mesh(p, rod(G.sh * 1.7, G.zp1 - 0.5, G.zp1 + 8, 64, 1), 'carrier');
    B.mesh(p, rod(G.sh + 1, G.zp1 + 7, G.zp1 + G.Lout - 7.5), 'shaft');
    flange(B, p, G.flangeR, G.zp1 + G.Lout - 8, G.zp1 + G.Lout, 1);
    p.labelAt = [0, S.a * 0.55, G.zp1];
  },
  inWeb(B, p, L) {
    const S = L.sets[0], G = L.g;
    const web = new THREE.Shape(); web.absarc(0, 0, S.rrO, 0, TAU, false);
    for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * TAU, rr = 0.6 * S.rrO; web.holes.push(circlePath(0.15 * S.rrO, rr * Math.cos(a), rr * Math.sin(a))); }
    B.mesh(p, slabXY(web, G.zWeb0, G.zWeb1 - G.zWeb0, 0.6, 160), 'web');
    B.mesh(p, tubeWall(S.rrO - 5, S.rrO, G.zWeb1 - 0.3, G.zS0, 160, 0.5), 'web');
    B.mesh(p, rod(G.sh + 1, G.zWeb0 - G.Lin + 7.5, G.zWeb0 + 0.5), 'shaft');
    B.mesh(p, rod(G.sh * 2.2, G.zWeb0 - 6, G.zWeb0 + 0.3, 48, 0.8), 'shaft');
    flange(B, p, G.flangeR, G.zWeb0 - G.Lin, G.zWeb0 - G.Lin + 8, -1);
    p.labelAt = [0, 0, G.zWeb0 - G.Lin];
  },
  c1Front(B, p, L) {
    const S = L.sets[0], G = L.g, z0 = G.zS0 - 1 - G.t;
    const sh = spiderShape(S, Math.max(G.sh * 1.9, S.rsR * 0.62), Math.max(S.pr + 1.5, 0.62 * S.bo));
    sh.holes.push(...pinHoles(S, S.pr));
    B.mesh(p, slabXY(sh, z0, G.t, 0.6), 'carrier');
    B.mesh(p, merge(S.psi.map(ps => { const g = rod(S.pr, z0 - PIN_OUT, -G.Gap + 1 + G.t + PIN_OUT, 24, 0.4); g.translate(S.a * Math.cos(ps), S.a * Math.sin(ps), 0); return g; })), 'pin');
    p.labelAt = [0, S.a * 0.5, z0];
  },
  outDrum(B, p, L) {
    const S = L.sets[0], R = L.sets[1], G = L.g;
    const plate = new THREE.Shape(); plate.absarc(0, 0, G.rD1, 0, TAU, false);
    plate.holes.push(circlePath(S.rsT + 2), ...pinHoles(S, S.pr));
    B.mesh(p, slabXY(plate, -G.Gap + 1, G.t, 0.6, 160), 'drum');
    B.mesh(p, tubeWall(G.rD0, G.rD1, -G.Gap + 1 + G.t - 0.3, G.Gap - G.tf + 0.3, 160, 0.3), 'drum');
    B.mesh(p, tubeWall(R.rrT - 0.2 * R.m, G.rD1, G.Gap - G.tf, G.Gap, 160, 0.5), 'drum');
    B.mesh(p, gear(G.ZT, G.mT, -7, 7, G.rD1 - 0.6, { steps: 5 }), 'planet');
    B.pitchCircle(p, G.rT, 7.15, PITCH_COL.planet);
    p.labelAt = [0, G.rT + 2, 0];
  },
  c2Front(B, p, L) {
    const S = L.sets[1], G = L.g;
    const sh = spiderShape(S, S.rsT + 6, Math.max(S.pr + 1.5, 0.62 * S.bo));
    sh.holes.push(circlePath(S.rsT + 2), ...pinHoles(S, S.pr));
    B.mesh(p, slabXY(sh, G.Gap - 1 - G.t, G.t, 0.6), 'carrier');
  },
  c2Drum(B, p, L) {
    const S = L.sets[1], G = L.g;
    const plate = new THREE.Shape(); plate.absarc(0, 0, G.rC2, 0, TAU, false); plate.holes.push(circlePath(G.sh + 1.5));
    B.mesh(p, slabXY(plate, G.zC2, G.t, 0.6, 160), 'carrier');
    B.mesh(p, tubeWall(G.rC2 - 4, G.rC2, G.zC2b - 0.3, G.zC2b + G.Ld, 160, 0.5), 'drum');
    B.mesh(p, merge(S.psi.map(ps => { const g = rod(S.pr, G.Gap - 1 - G.t - PIN_OUT, G.zC2 + 0.5, 24, 0.4); g.translate(S.a * Math.cos(ps), S.a * Math.sin(ps), 0); return g; })), 'pin');
    p.labelAt = [0, G.rC2, G.zC2b + G.Ld / 2];
  },
  sunDrum(B, p, L) {
    const G = L.g;
    B.mesh(p, tubeWall(G.sh, G.rSD, G.zSD, G.zSD + G.t, 128, 0.5), 'drum');
    B.mesh(p, tubeWall(G.rSD - 4, G.rSD, G.zSD + G.t - 0.3, G.zSD + G.t + G.Lsd, 128, 0.5), 'drum');
  },
  band(B, p) {
    band(B, p, p.L.r, p.L.z0, p.L.z1);
    p.labelAt = [0, p.L.r + 4, (p.L.z0 + p.L.z1) / 2];
  },
};

export function build(B, L) {
  for (const q of L.parts) {
    const p = B.part(q.id, q);
    KINDS[q.kind](B, p, L);
  }
  const model = MODELS[L.id];
  function pose(ang) {
    for (const id in B.parts) {
      const q = B.parts[id], pz = q.L.pose;
      if (pz.planet) {
        const [j, i] = pz.planet, S = L.sets[j], ms = model.sets[j];
        const thS = ang[ms.s], thC = ang[ms.c], phi = thC + S.psi[i], r = S.a + (q.L.ex.dr || 0) * q.k;
        q.root.position.set(r * Math.cos(phi), r * Math.sin(phi), 0);
        q.root.rotation.z = planetAngle(S, i, thS, thC);
      } else if (pz.m) q.root.rotation.z = ang[pz.m] + (pz.ring !== undefined ? L.sets[pz.ring].r0 : 0);
    }
  }
  const bx = b => ({ c: (b.z0 + b.z1) / 2, R: Math.max(b.R, (b.z1 - b.z0) / 2, 0.9 * Math.hypot(b.R, (b.z1 - b.z0) / 2)) });
  return { pose, box: { a: bx(L.box0), e: bx(L.box1) } };
}
