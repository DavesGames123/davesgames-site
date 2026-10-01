// ============================================================================
//  WATCH MOVEMENT  ·  scenes/shared.js — subassemblies more than one scene uses
// ────────────────────────────────────────────────────────────────────────────
//  Each function takes the builder B (kit.js) and adds whole parts: a wheel
//  on its arbor, a barrel with its mainspring, a Swiss lever, a balance with
//  its hairspring, the motion works, and the dial painters. Functions that
//  move every frame return an update(p) for the scene's pose().
//
//  GREP MAP
//    function wheelArbor ...... wheel + pinion + arbor as one part
//    function barrelParts ..... drum, cover, arbor, animated mainspring
//    function leverParts ...... pallet lever with its stones and fork
//    function balanceParts .... balance, roller, screws, animated hairspring
//    function motionWorks ..... cannon pinion, minute wheel, hour wheel
//    function handParts ....... hour, minute and seconds hands
//    function paintRoman / paintBaton / paintEnglish  dial art
// ============================================================================
import * as G from '../geom.js';
import { circ, hole, bevelFor } from '../kit.js';
const { TAU, D, pol } = G;
const local = (p, o) => [p[0] - o[0], p[1] - o[1]];

// a wheel on its arbor; spokes = { rIn, rim, n, w } or null
export function wheelArbor(B, o) {
  const p = B.part(o.id, o.layer || 'train', o.at, { label: o.label, labelZ: o.labelZ ?? Math.max(o.wheel.z, o.pinion ? o.pinion.z : -9) + 0.3, parent: o.parent, info: o.info });
  const w = o.wheel, Rf = G.rootR(w.N, w.m), th = w.t ?? 0.26;
  const holes = w.spokes ? G.spokeWindows(w.spokes.rIn, Rf - w.spokes.rim, w.spokes.n, w.spokes.w).map(h => h.reverse()) : (w.holeR ? [hole(w.holeR)] : []);
  B.add(p, B.slab(w.profile || G.wheelProfile(w.N, w.m), holes, w.z - th / 2, w.z + th / 2, w.mat || 'gilt', bevelFor(w.m)));
  if (o.pinion) B.add(p, B.slab(G.pinionProfile(o.pinion.N, o.pinion.m), [], o.pinion.z - (o.pinion.t ?? 0.34) / 2, o.pinion.z + (o.pinion.t ?? 0.34) / 2, 'steel', 0.01));
  if (w.spokes) B.add(p, B.cyl(w.spokes.rIn * 0.75, w.z - th / 2 - 0.04, w.z + th / 2 + 0.04, 'steel'));
  if (o.arbor) B.add(p, B.cyl(o.arbor[2] ?? 0.22, o.arbor[0], o.arbor[1], 'steel', 18));
  return p;
}

// barrel drum (teeth on its rim when N is given), lift-off cover, arbor and
// a mainspring ribbon that tightens round the arbor as it winds
export function barrelParts(B, o) {
  const { at, zLo, zHi, rDrum } = o, layer = o.layer || 'train';
  const bar = B.part('barrel', layer, at, { label: o.label ?? 'Barrel', labelZ: zHi });
  if (o.N) B.add(bar, B.slab(G.wheelProfile(o.N, o.m), [hole(rDrum - 0.3, 96)], zLo, zLo + 0.32, 'gilt', bevelFor(o.m)));
  B.add(bar,
    B.slab(circ(rDrum, 120), [hole(rDrum - 0.3, 120)], zLo + (o.N ? 0.3 : 0), zHi - 0.12, o.drumMat || 'gilt'),
    B.slab(circ(rDrum - 0.29, 96), [hole(1.25, 32)], zLo, zLo + 0.14, o.drumMat || 'gilt'));
  const cover = B.part('barrelCover', layer, at, { lift: 0.55, info: 'barrel' });
  B.add(cover, B.slab(circ(rDrum, 120), [hole(1.25, 32)], zHi - 0.14, zHi, o.drumMat || 'gilt', 0.03));
  const arbor = B.part('barrelArbor', layer, at, { info: 'mainspring' });
  B.add(arbor, B.cyl(1.15, zLo + 0.1, zHi, 'steel', 32), B.cyl(0.55, o.arborLo ?? -0.4, o.arborHi ?? zHi + 1.3, 'steel'));
  const sp = B.part('mainspring', layer, at, { label: 'Mainspring', labelZ: zHi });
  const rib = B.ribbon(1400, zLo + 0.25, zHi - 0.2, 'spring');
  B.add(sp, rib);
  const rw = rDrum - 0.33;
  return {
    bar, cover, arbor,
    // w: 0 run down .. 1 fully wound; arb and drum: the two end angles
    update(w, arb, drum) {
      const ra = 4.1 / 7.25 * rw + (1.45 - 4.1 / 7.25 * rw) * w, rb = 6.75 / 6.92 * rw + (3.7 / 6.92 * rw - 6.75 / 6.92 * rw) * w, turns = 7 + 6 * w;
      rib.userData.update(s => {
        let r;
        if (s < 0.03) r = 1.18 + (ra - 1.18) * (s / 0.03);
        else if (s > 0.97) r = rb + (rw - rb) * ((s - 0.97) / 0.03);
        else r = ra + (rb - ra) * ((s - 0.03) / 0.94);
        const a = arb * (1 - s) + drum * s + turns * TAU * s;
        return [r * Math.cos(a), r * Math.sin(a)];
      });
    },
  };
}

// the Swiss lever at esc.P: two ruby stones, arms, lever, fork horns
export function leverParts(B, esc, o) {
  const z = o.z, s = esc.Ra / 2.3;
  const p = B.part('pallet', o.layer || 'train', esc.P, { label: o.label ?? 'Pallet lever', labelZ: z + 0.5, parent: o.parent });
  const stones = esc.stonePolys(0).map(st => st.map(q => local(q, esc.P)));
  const u = pol(1, esc.psi), nrm = [-u[1], u[0]], fe = [u[0] * esc.forkLen, u[1] * esc.forkLen];
  for (const st of stones) {
    const base = [(st[1][0] + st[2][0]) / 2, (st[1][1] + st[2][1]) / 2];
    B.add(p, B.slab(G.capsule([0, 0], base, 0.5 * s), [], z - 0.1 * s, z + 0.06 * s, 'steel', 0.015));
    B.add(p, B.slab(st, [], z - 0.16 * s, z + 0.2 * s, 'ruby', 0.01));
  }
  B.add(p, B.slab(G.capsule([0, 0], [u[0] * (esc.forkLen - 0.45 * s), u[1] * (esc.forkLen - 0.45 * s)], 0.42 * s), [], z - 0.1 * s, z + 0.06 * s, 'steel', 0.015));
  for (const sg of [1, -1]) {
    const a = [fe[0] - u[0] * 0.5 * s + nrm[0] * sg * 0.32 * s, fe[1] - u[1] * 0.5 * s + nrm[1] * sg * 0.32 * s];
    const b = [fe[0] + u[0] * 0.35 * s + nrm[0] * sg * 0.42 * s, fe[1] + u[1] * 0.35 * s + nrm[1] * sg * 0.42 * s];
    B.add(p, B.slab(G.capsule(a, b, 0.26 * s), [], z - 0.1 * s, z + 0.06 * s, 'steel', 0.015));
  }
  B.add(p, B.slab(circ(0.55 * s, 24), [], z - 0.1 * s, z + 0.06 * s, 'steel', 0.015), B.cyl(0.18 * s, o.arbor[0], o.arbor[1], 'steel'));
  return p;
}

// escape wheel with its pinion on one arbor
export function escapeWheel(B, esc, o) {
  const p = B.part('escape', o.layer || 'train', esc.E, { label: o.label ?? 'Escape wheel', labelZ: o.z + 0.4, parent: o.parent });
  const s = esc.Ra / 2.3;
  B.add(p,
    B.slab(esc.wheel, G.spokeWindows(0.55 * s, (esc.Rf - 0.3 * s), 5, 0.3 * s).map(h => h.reverse()), o.z - 0.11, o.z + 0.11, 'steel', 0.012),
    B.slab(G.pinionProfile(o.pinion.N, o.pinion.m), [], o.pinion.z - 0.17, o.pinion.z + 0.17, 'steel', 0.01),
    B.cyl(0.4 * s, o.z - 0.15, o.z + 0.15, 'steel'),
    B.cyl(0.2 * s, o.arbor[0], o.arbor[1], 'steel'));
  return p;
}

// balance wheel, roller with impulse jewel, timing screws, hairspring.
// o: { at, R, z, zFork, jewelR, psi, hsZ, hsR, coils, studAngle, staff }
export function balanceParts(B, o) {
  const s = o.R / 5, layer = o.layer || 'balance';
  const bal = B.part('balance', layer, o.at, { label: 'Balance wheel', labelZ: o.z + 0.6, parent: o.parent });
  B.add(bal, B.slab(circ(o.R, 140), [hole(o.R - 0.45 * s, 140)], o.z - 0.2 * s, o.z + 0.2 * s, o.mat || 'glucydur', 0.04));
  const arms = o.arms ?? 3;
  for (let k = 0; k < arms; k++) {
    const a = 90 * D + k * TAU / arms;
    B.add(bal, B.slab(G.capsule([0, 0], pol(o.R - 0.3 * s, a), 0.55 * s), [], o.z - 0.08 * s, o.z + 0.08 * s, o.mat || 'glucydur', 0.02));
  }
  if (o.screws !== 0) for (let k = 0; k < (o.screws ?? 14); k++) {
    const a = (k + 0.5) / (o.screws ?? 14) * TAU;
    const m = B.cyl(0.2 * s, -0.21 * s, 0.21 * s, k % 7 === 3 ? 'steel' : 'gilt', 12);
    m.geometry.rotateY(Math.PI / 2);
    m.position.set(...pol(o.R + 0.19 * s, a), o.z); m.rotation.z = a;
    B.add(bal, m);
  }
  B.add(bal, B.cyl(0.17 * s, o.staff[0], o.staff[1], 'steel'), B.cyl(0.55 * s, o.hsZ - 0.1, o.hsZ + 0.12, 'steel'));
  if (o.jewelR) {
    B.add(bal, B.slab(circ(o.jewelR + 0.35 * s, 40), [], o.zFork - 0.45 * s, o.zFork - 0.3 * s, 'steel', 0.015),
      B.cyl(0.5 * s, o.zFork + 0.2 * s, o.zFork + 0.35 * s, 'steel'));
    const pin = B.cyl(0.11 * s, o.zFork - 0.3 * s, o.zFork + 0.12 * s, 'ruby', 12);
    pin.position.set(...pol(o.jewelR, o.psi + Math.PI), 0);
    B.add(bal, pin);
  }
  const hs = B.part('hairspring', layer, o.at, { label: 'Hairspring', labelZ: o.hsZ + 0.3, parent: o.parent });
  const N = o.coils ?? 13, rib = B.ribbon(N * 48, o.hsZ - 0.07 * s, o.hsZ + 0.07 * s, 'hair');
  B.add(hs, rib);
  const r0 = 0.62 * s, r1 = o.hsR ?? 3.75 * s, th0 = (o.studAngle ?? 60 * D) - N * TAU;
  return {
    bal, hs,
    update(b) {
      rib.userData.update(t => { const r = r0 + (r1 - r0) * t, a = th0 + N * TAU * t + b * (1 - t); return [r * Math.cos(a), r * Math.sin(a)]; });
    },
  };
}

// motion works under the dial: cannon pinion on the centre arbor, minute
// wheel and pinion, hour wheel with its pipe
export function motionWorks(B, o) {
  const { C, M, cannon, minute, hour, z, dialLo } = o, layer = o.layer || 'motion';
  const cp = B.part('cannon', layer, C, { label: 'Cannon pinion', labelZ: z.cannon - 0.6 });
  B.add(cp, B.slab(G.pinionProfile(cannon.N, cannon.m), [], z.cannon - 0.15, z.cannon + 0.15, 'steel', 0.01), B.cyl(0.48 * o.s, dialLo - 0.62, z.cannon, 'steel'));
  const mw = B.part('minuteWheel', layer, M, { label: 'Minute wheel', labelZ: z.minute - 0.6 });
  B.add(mw, B.slab(G.wheelProfile(minute.N, minute.m), G.spokeWindows(0.6 * o.s, G.rootR(minute.N, minute.m) - 0.32 * o.s, 4, 0.36 * o.s).map(h => h.reverse()), z.minute - 0.12, z.minute + 0.12, 'brass', 0.015),
    B.slab(G.pinionProfile(minute.p, minute.pm), [], z.hour - 0.17, z.minute - 0.1, 'steel', 0.01),
    B.cyl(0.18 * o.s, z.hour - 0.3, o.plateLo, 'steel'));
  const hw = B.part('hourWheel', layer, C, { label: 'Hour wheel', labelZ: z.hour - 0.8 });
  B.add(hw, B.slab(G.wheelProfile(hour.N, hour.m), G.spokeWindows(1.15 * o.s, G.rootR(hour.N, hour.m) - 0.3 * o.s, 4, 0.4 * o.s).map(h => h.reverse()), z.hour - 0.12, z.hour + 0.12, 'brass', 0.015),
    B.ring(0.52 * o.s, 0.85 * o.s, dialLo - 0.35, z.hour, 'brass'));
  return { cp, mw, hw };
}

// hands: o = { C, dialLo, hour: [style, len, w], minute: [...], second: { at, len } | null, mat }
export function handParts(B, o) {
  const mk = (id, at, z, spec, hubR) => {
    const p = B.part(id, 'hands', at, {});
    for (const [out, holes] of B.hand(spec[0], spec[1], spec[2])) B.add(p, B.slab(out, holes, z, z + 0.09, o.mat || 'blued', 0.01));
    B.add(p, B.cyl(hubR, z - 0.05, z + 0.12, o.mat || 'blued'));
    return p;
  };
  const out = { hour: mk('hourHand', o.C, o.dialLo - 0.35, o.hour, o.hubR ?? 1.0), minute: mk('minuteHand', o.C, o.dialLo - 0.6, o.minute, (o.hubR ?? 1.0) * 0.72) };
  if (o.second) {
    const p = B.part('secondHand', 'hands', o.second.at, {});
    const L = o.second.len, w = o.second.w ?? 0.18;
    B.add(p, B.slab([[-w / 2, -L * 0.3], [w / 2, -L * 0.3], [w * 0.28, L], [-w * 0.28, L]], [], o.second.z, o.second.z + 0.08, o.second.mat || o.mat || 'blued', 0),
      B.cyl(o.second.hub ?? 0.36, o.second.z - 0.04, o.second.z + 0.12, o.second.mat || o.mat || 'blued'));
    out.second = p;
  }
  return out;
}

// ── dial painters (canvas in mm, origin at the centre, y down) ─────────────
const SERIF = '"STIX Two Text","Times New Roman",Georgia,serif', SANS = 'Inter,Helvetica,Arial,sans-serif';
function enamel(g, R, a = '#fbf8f0', b = '#ece5d6') {
  const bg = g.createRadialGradient(-R * 0.16, -R * 0.27, 1, 0, 0, R);
  bg.addColorStop(0, a); bg.addColorStop(1, b);
  g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
}
function track(g, r0, r1, ink, every = 5) {
  g.strokeStyle = ink; g.lineWidth = 0.09;
  for (const r of [r0, r1]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a);
    g.lineWidth = i % every ? 0.07 : 0.16;
    g.beginPath(); g.moveTo(ca * r0, sa * r0); g.lineTo(ca * r1, sa * r1); g.stroke();
  }
}
function subSeconds(g, cy, r, ink) {
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 0.07;
  for (const rr of [r * 0.85, r]) { g.beginPath(); g.arc(0, cy, rr, 0, TAU); g.stroke(); }
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a), r0 = i % 5 ? r * 0.9 : r * 0.85;
    g.lineWidth = i % 5 ? 0.05 : 0.1;
    g.beginPath(); g.moveTo(ca * r0, cy + sa * r0); g.lineTo(ca * r, cy + sa * r); g.stroke();
  }
  g.font = `${r * 0.25}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 1; i <= 6; i++) { const a = i / 6 * TAU; g.fillText(String(i * 10), Math.sin(a) * r * 0.66, cy - Math.cos(a) * r * 0.66); }
}
// Roman numerals on enamel. o: { sub: [cy, r] | null, aperture: [cy, r] | null, brand, line }
export function paintRoman(o) {
  return (g, R) => {
    enamel(g, R);
    const ink = '#1d1b22';
    track(g, R * 0.89, R * 0.938, ink);
    const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = ink; g.font = `500 ${R * 0.137}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 12; i++) {
      if (i === 6 && (o.sub || o.aperture)) continue;
      g.save(); g.rotate(i / 12 * TAU); g.translate(0, -R * 0.771); g.scale(i === 0 ? 1 : 0.94, 1.2); g.fillText(RN[i], 0, 0); g.restore();
    }
    if (o.sub) subSeconds(g, o.sub[0], o.sub[1], ink);
    if (o.aperture) {
      g.strokeStyle = '#b08a3e'; g.lineWidth = 0.35;
      g.beginPath(); g.arc(0, o.aperture[0], o.aperture[1] + 0.2, 0, TAU); g.stroke();
    }
    g.fillStyle = ink; g.font = `600 ${R * 0.062}px ${SANS}`;
    g.fillText(o.brand || 'STELLA  NOVA', 0, -R * 0.32);
    g.font = `${R * 0.038}px ${SANS}`; g.fillStyle = '#6b6672';
    g.fillText(o.line || '', 0, -R * 0.25);
  };
}
// a sunray steel dial with baton indices (a modern wristwatch)
export function paintBaton(o) {
  return (g, R) => {
    const bg = g.createRadialGradient(0, 0, 0, 0, 0, R);
    bg.addColorStop(0, '#2b3448'); bg.addColorStop(1, '#141a26');
    g.fillStyle = bg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
    for (let i = 0; i < 360; i++) {                 // sunray brushing
      const a = i / 360 * TAU;
      g.strokeStyle = `rgba(255,255,255,${0.02 + 0.03 * Math.abs(Math.sin(a * 2))})`; g.lineWidth = 0.02;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * R, -Math.cos(a) * R); g.stroke();
    }
    g.strokeStyle = '#c9ccd6';
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a);
      g.lineWidth = 0.06; g.beginPath(); g.moveTo(ca * R * 0.9, sa * R * 0.9); g.lineTo(ca * R * 0.95, sa * R * 0.95); g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      g.save(); g.rotate(a);
      const w = i % 3 ? 0.42 : 0.62, h = i % 3 ? R * 0.13 : R * 0.17;
      const grd = g.createLinearGradient(-w, 0, w, 0);
      grd.addColorStop(0, '#9aa0ad'); grd.addColorStop(0.5, '#ffffff'); grd.addColorStop(1, '#8a909d');
      g.fillStyle = grd; g.fillRect(-w / 2, -R * 0.86, w, h);
      if (i === 0) g.fillRect(-w / 2 - 0.55, -R * 0.86, w, h), g.fillRect(-w / 2 + 0.55, -R * 0.86, w, h);
      g.restore();
    }
    g.fillStyle = '#e8eaf0'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${R * 0.075}px ${SANS}`; g.fillText(o.brand || 'STELLA  NOVA', 0, -R * 0.36);
    g.font = `500 ${R * 0.05}px ${SANS}`; g.fillStyle = '#e0b765'; g.fillText(o.line || 'AUTOMATIC', 0, R * 0.36);
    g.font = `${R * 0.04}px ${SANS}`; g.fillStyle = '#9aa0ad'; g.fillText(o.line2 || '', 0, R * 0.44);
  };
}
// English enamel: Roman hours inside, Arabic minutes outside (c. 1780)
export function paintEnglish(o) {
  return (g, R) => {
    enamel(g, R, '#fffdf6', '#f1ead8');
    const ink = '#17151c';
    g.strokeStyle = ink; g.lineWidth = 0.08;
    for (const r of [R * 0.74, R * 0.8]) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 60; i++) {
      const a = i / 60 * TAU, ca = Math.sin(a), sa = -Math.cos(a);
      g.lineWidth = i % 5 ? 0.07 : 0.13; g.beginPath(); g.moveTo(ca * R * 0.74, sa * R * 0.74); g.lineTo(ca * R * 0.8, sa * R * 0.8); g.stroke();
      if (i % 5 === 0) { g.beginPath(); g.arc(ca * R * 0.77, sa * R * 0.77, 0.16, 0, TAU); g.fillStyle = ink; g.fill(); }
    }
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${R * 0.085}px ${SERIF}`;
    for (let i = 1; i <= 12; i++) {
      const a = i * 5 / 60 * TAU;
      g.save(); g.rotate(a); g.translate(0, -R * 0.88); g.fillText(String(i * 5).padStart(2, '0'), 0, 0); g.restore();
    }
    const RN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.font = `500 ${R * 0.12}px ${SERIF}`;
    for (let i = 0; i < 12; i++) { g.save(); g.rotate(i / 12 * TAU); g.translate(0, -R * 0.62); g.scale(0.92, 1.18); g.fillText(RN[i], 0, 0); g.restore(); }
    g.font = `italic ${R * 0.06}px ${SERIF}`; g.fillText(o.brand || 'Stella Nova', 0, R * 0.3);
    g.font = `italic ${R * 0.045}px ${SERIF}`; g.fillStyle = '#5a5560'; g.fillText(o.line || 'London', 0, R * 0.38);
  };
}
