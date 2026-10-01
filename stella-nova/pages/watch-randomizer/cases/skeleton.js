// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/skeleton.js — skeleton clocks under a dome
// ────────────────────────────────────────────────────────────────────────────
//  build(B, spec, cal, dims, zF, zB) adds the case parts to the movement's
//  builder and returns { PARTS, toggles, pose(p, S, dt, now), has }. zF is
//  the dial face plane, zB the back of the movement (movement frame: mm, y
//  to 12, z out of the back, the dial faces -z; seen from the dial +x is 9).
//
//  Two pierced brass frames (front, behind the chapter ring; back, behind
//  the movement) joined by four turned pillars. The frame outline is a
//  gothic arch, a lancet, or a round-topped scroll; its piercings are
//  circles and teardrops placed from spec.case.pattern, mirrored about the
//  centre line, each kept clear of the edge, the centre opening, the
//  pillars and each other. A chapter ring replaces the dial, so the motion
//  works and the plate show through. A turned oval base and a glass dome.
//
//  GREP MAP
//    function frameOutline ..... the arch silhouette
//    function piercings ........ the hole layout (seeded, symmetric)
//    function build ............ frames, pillars, chapter ring, base, dome
// ============================================================================
import * as THREE from 'three';
import * as G from '../../watch-movement/geom.js';
import { circ, hole } from '../../watch-movement/kit.js';
import { dialRadius } from './common.js';
import { layout } from '../types/skeleton.js';
const { TAU } = G;

// the silhouette: straight sides from yb up to y = 0, then the arch
function frameOutline(kind, Lt) {
  const W = kind === 'lancet' ? Lt.Wf * 0.86 : Lt.Wf, yb = Lt.yb, pts = [[-W / 2, yb], [W / 2, yb]];
  if (kind === 'scroll') {
    for (let i = 0; i <= 64; i++) { const a = Math.PI * i / 64; pts.push([W / 2 * Math.cos(a), W / 2 * Math.sin(a) * 1.08]); }
  } else {
    const rho = kind === 'lancet' ? W * 1.15 : W * 0.9, cx = rho - W / 2, top = Math.sqrt(rho * rho - cx * cx);
    const aR = Math.atan2(top, cx);                  // right arch: centred at (-cx, 0), from angle 0 up to the apex
    for (let i = 0; i <= 40; i++) { const a = aR * i / 40; pts.push([-cx + rho * Math.cos(a), rho * Math.sin(a)]); }
    for (let i = 40; i >= 0; i--) { const a = aR * i / 40; pts.push([cx - rho * Math.cos(a), rho * Math.sin(a)]); }
  }
  return pts;
}
const teardrop = (c, ang, w, len) => {
  const out = [];
  for (let i = 0; i <= 16; i++) { const a = ang + Math.PI / 2 + Math.PI * i / 16; out.push([c[0] + w / 2 * Math.cos(a), c[1] + w / 2 * Math.sin(a)]); }
  out.push([c[0] + len * Math.cos(ang), c[1] + len * Math.sin(ang)]);
  return out;
};
function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
  return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
}
const edgeDist = (p, poly) => { let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length])); return d; };

// circles and teardrops, seeded, mirrored about x = 0
function piercings(outline, Lt, hc, keep, seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5 >>> 0) / 4294967296);
  const step = Lt.Wf / 8.5, m = step * 0.16, placed = [...keep], holes = [];
  const fits = (pts, c, br) => pts.every(p => G.inPoly(p, outline) && edgeDist(p, outline) > m) &&
    Math.hypot(c[0], c[1]) - br > hc + m && placed.every(q => Math.hypot(q[0] - c[0], q[1] - c[1]) > q[2] + br + m);
  for (let y = Lt.yb + step * 0.7; y < Lt.archTop + step; y += step * 0.82) {
    for (let x = 0; x < Lt.Wf / 2; x += step * 0.9) {
      const c = [x + (rnd() - 0.5) * step * 0.3, y + (rnd() - 0.5) * step * 0.3];
      const onAxis = c[0] < step * 0.4;
      if (onAxis) c[0] = 0;
      const tear = !onAxis && rnd() < 0.55, r = step * (0.18 + rnd() * 0.14);
      let shape, br;
      if (tear) { const ang = Math.atan2(c[1], c[0]) + (rnd() - 0.5) * 1.2, len = step * (0.55 + rnd() * 0.25), w = step * 0.36; shape = teardrop(c, ang, w, len); br = len; }
      else { shape = circ(r, 28, c); br = r; }
      if (!fits(shape, c, br)) continue;
      placed.push([c[0], c[1], br]); holes.push(shape.slice().reverse());
      if (!onAxis) { placed.push([-c[0], c[1], br]); holes.push(shape.map(([px, py]) => [-px, py])); }
    }
  }
  return holes;
}
function turn(B, prof, mat, x, y, z, seg = 48) {
  const g = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(Math.max(0.01, r), h)), seg);
  const m = B.mesh(g, mat); m.position.set(x, y, z); return m;
}

export function build(B, spec, cal, dims, zF, zB) {
  const c = spec.case, own = dialRadius(cal), pend = cal.pendulum || null, Lt = layout(spec, own, pend);
  const { dialR, yb, rx } = Lt, baseMat = c.base.endsWith('marble') ? 'paint' : 'wood';
  const tF = Math.max(1.4, own * 0.06), zFf = zF + 1.5, zBf = Math.max(zB + 2, pend ? pend.pivot[2] + 6 : -1e9);
  const zc = (zF + zBf + tF) / 2, rz = (zBf + tF - zF) / 2 + Math.max(10, own * 0.4);
  const k = v => v * Lt.Wf / 9;
  B.layer('caseFront', -k(0.3)); B.layer('caseMid', 0); B.layer('caseBack', k(0.3)); B.layer('dome', -k(0.6));
  B.root.position.y = -(Lt.top + Lt.bottom) / 2;

  // ── frames ──
  const outline = frameOutline(c.frame, Lt), hc = own + 3;
  const pil = [[hc + Lt.Wf * 0.08, hc * 0.25], [-(hc + Lt.Wf * 0.08), hc * 0.25], [Lt.Wf * 0.36, yb + Lt.Wf * 0.12], [-Lt.Wf * 0.36, yb + Lt.Wf * 0.12]]
    .map(([x, y]) => [Math.sign(x) * Math.min(Math.abs(x), (c.frame === 'lancet' ? Lt.Wf * 0.86 : Lt.Wf) / 2 - 6), y]);
  const holes = [hole(hc, 128), ...piercings(outline, Lt, hc, pil.map(([x, y]) => [x, y, 5]), c.pattern)];
  const front = B.part('frameFront', 'caseFront', [0, 0], { label: 'Front frame', labelAt: [Lt.Wf * 0.35, Lt.archTop * 0.6], labelZ: zFf, info: 'frames' });
  B.add(front, B.slab(outline, holes, zFf, zFf + tF, 'polished', 0.3));
  const back = B.part('frameBack', 'caseBack', [0, 0], { label: 'Back frame', labelAt: [-Lt.Wf * 0.35, Lt.archTop * 0.6], labelZ: zBf, info: 'frames' });
  B.add(back, B.slab(outline, holes, zBf, zBf + tF, 'polished', 0.3));
  // ── pillars, front to back ──
  const pp = B.part('pillars', 'caseMid', [0, 0], { label: 'Pillars', labelAt: pil[2], labelZ: zc });
  const len = zBf - (zFf + tF), pr = Math.max(1.6, own * 0.07);
  for (const [x, y] of pil) {
    const g = new THREE.LatheGeometry([[0.01, 0], [pr * 1.5, 0], [pr * 1.5, len * 0.08], [pr * 0.95, len * 0.16], [pr * 1.25, len * 0.5], [pr * 0.95, len * 0.84], [pr * 1.5, len * 0.92], [pr * 1.5, len], [0.01, len]].map(([r, h]) => new THREE.Vector2(r, h)), 40);
    g.rotateX(Math.PI / 2);
    const m = B.mesh(g, 'polished'); m.position.set(x, y, zFf + tF);
    B.add(pp, m);
    for (const zz of [zFf - 0.9, zBf + tF]) { const nut = B.cyl(pr * 1.6, zz, zz + 0.9, 'polished', 6); nut.position.set(x, y, 0); B.add(pp, nut); }
  }
  // ── chapter ring ──
  const dial = B.part('dial', 'caseMid', [0, 0], { label: 'Chapter ring', labelAt: [0, -dialR * 0.9], labelZ: zF });
  const ringIn = own + 1.5, dh = [hole(ringIn, 160)];
  B.add(dial, B.slab(circ(dialR + 0.5, 180), dh, zF + 0.3, zF + 1.2, 'polished', 0.3), B.dialFace(dialR, zF, dh, dims.paint));
  // ── base and feet ──
  const base = B.part('base', 'caseMid', [0, 0], { label: 'Base', labelAt: [rx, yb - Lt.baseH / 2], labelZ: zc });
  const bh = Lt.baseH, br = rx + 6;
  const bm = turn(B, [[0.01, 0], [br + 4, 0], [br + 4, bh * 0.22], [br + 2, bh * 0.3], [br + 2, bh * 0.62], [br, bh * 0.7], [br - 1, bh * 0.9], [br - 3, bh], [0.01, bh]], baseMat, 0, yb - bh, zc, 128);
  bm.scale.z = (rz + 8) / br;
  B.add(base, bm);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    B.add(base, turn(B, [[0.01, 0], [3, 0], [4.4, 2], [4, 4], [2.6, 5], [0.01, 5.2]], 'polished', Math.cos(a) * (br - 3), yb - bh - 5.2, zc + Math.sin(a) * (rz + 4), 32));
  }
  const rim = turn(B, [[br - 3.5, 0], [br - 1.6, 0], [br - 1.6, 2.2], [br - 3.5, 2.2]], 'polished', 0, yb - 0.2, zc, 128);
  rim.scale.z = (rz + 6) / br;
  B.add(base, rim);
  // ── the glass dome ──
  const dm = B.part('dome', 'dome', [0, 0], { label: 'Glass dome', labelAt: [-rx, Lt.archTop * 0.4], labelZ: zc - rz });
  const H = Lt.top - 2 - yb, hc0 = Math.max(H - rx * 0.85, H * 0.4), prof = [[rx, 0], [rx, hc0]];
  for (let i = 1; i <= 24; i++) { const a = i / 24 * Math.PI / 2; prof.push([rx * Math.cos(a), hc0 + (H - hc0) * Math.sin(a)]); }
  const dg = new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(Math.max(0.01, r), h)), 128);
  const dmesh = B.mesh(dg, 'glass'); dmesh.position.set(0, yb + 1.8, zc); dmesh.scale.z = rz / rx; dmesh.userData.noShadow = true;
  B.add(dm, dmesh);

  const PARTS = {
    frames: { name: c.frame === 'gothic' ? 'Gothic frames' : c.frame === 'lancet' ? 'Lancet frames' : 'Scroll frames', group: 'Case',
      role: 'Two brass plates sawn and filed into open scrollwork, so almost nothing hides the wheels. Skeleton clocks were made to show a fine train, and stood under glass to keep the dust off.',
      specs: [['Metal', c.metal], ['Height', `${(Lt.archTop - yb).toFixed(0)} mm`], ['Piercings', String(holes.length - 1)]] },
    pillars: { name: 'Pillars', group: 'Case', role: 'Four turned pillars hold the two frames apart, pinned with nuts.', specs: [['Count', '4']] },
    dial: { name: 'Chapter ring', group: 'Display', role: 'A ring of hours in place of a dial, so the motion works and the plates show through the middle.', specs: [['Diameter', `${(dialR * 2).toFixed(0)} mm`], ['Numerals', spec.face.numerals]] },
    base: { name: 'Base', group: 'Case', role: 'A turned oval base on four feet, grooved for the dome.', specs: [['Material', c.base]] },
    dome: { name: 'Glass dome', group: 'Case', role: 'A blown glass shade over the whole clock.', specs: [['Height', `${H.toFixed(0)} mm`]] },
  };
  return { PARTS, toggles: ['frameFront', 'frameBack', 'pillars', 'base', 'dome'], pose() {}, has: {} };
}
