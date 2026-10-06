// ============================================================================
//  ENIGMA ROTORS  ·  scene.js — the rotor stack, pawls, lamps and keys
// ----------------------------------------------------------------------------
//  build(B, id) makes one machine with kit.js and returns sc: { pose(t),
//  box, keys, rec(i), xray(v), setKey(i, ch) }. The positions and the
//  current path come from mech.js, so the rotors and wires that main.js
//  moves are the ones the tests check.
//
//  TIME. t counts key presses. Press i runs over t in [i, i + 1):
//    f 0.00-0.30  the key goes down, the pawls push, the rotors step
//    f 0.30-0.97  the current flows: the wire path shows, the lamp lights
//    f 0.30-0.60  the pawls go back; from f 0.60 they rest on the new
//                 notch state
//
//  LAYOUT (mm, world = B.root frame, no turn). The rotor axis is world x;
//  the operator looks from +z, y is up. Left to right along x:
//    reflector B (UKW) .. x -78 .. -58
//    rotor L, M, R ...... x0 -55, -25, 5; each 26 wide, pitch 30
//    entry wheel (ETW) .. x 35 .. 49
//  Rotor part frame: local +Y on world +x, local +X on world +y (the
//  window, absolute contact 0). Absolute contact a sits at angle
//  phi = a * STEP from local +X toward local +Z (world -z, the back).
//  Rotor profile along local Y: notch ring 0.4-4, alphabet tyre 4.5-14,
//  thumbwheel 15-20, ratchet 21-25.6, core 0-26. Pins stand out of the
//  left face, pads out of the right face, on radius RC.
//  Pawls sit at the back, at absolute place KP. In front: the lamp deck
//  (QWERTZ rows), then the keyboard. Every part face that is near another
//  face is 0.3 mm or more away from it; the letter decals are 0.35-0.4 mm
//  above their surface and use polygonOffset.
//
//  GREP MAP
//    const KP / RC / STEP ...... pawl place, contact radius, one step
//    function letterTex ........ the tyre band and the A-Z atlas
//    function rotorPart ........ core, tyre, letters, notch ring,
//                                thumbwheel, ratchet, contacts
//    function build ............ the parts and sc.pose
//      pose(t) ................. steps, pawls, key, lamp, wire path
// ============================================================================
import * as THREE from 'three';
import { slab, rod, tube, merge, circle } from './kit.js';
import { unit, makeEnigma, ALPHA, L2N, N } from './mech.js';

export const STEP = Math.PI * 2 / N;
export const KP = 7, RC = 24;
const AP = KP * STEP;                      // the pawl angle
const X0 = [-55, -25, 5], W = 26, UKW_X = -78, ETW_X = 35;
export const ROWS = ['QWERTZUIO', 'ASDFGHJK', 'PYXCVBNML'];
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const md = x => ((x % N) + N) % N;
// a shape point at radius r and angle phi (slab maps shape (x, y) to local
// (x, -y), so phi from local +X toward +Z is shape angle -phi)
const P = (r, f) => new THREE.Vector2(r * Math.cos(f), -r * Math.sin(f));
// local (x, z) of radius r, angle phi
const at = (r, f) => [r * Math.cos(f), r * Math.sin(f)];

// ── letter textures ─────────────────────────────────────────────────────────
let TEXC = null;
function letterTex() {
  if (TEXC) return TEXC;
  // tyre band: letter t centred at u = 0.25 - t/26 (CylinderGeometry u),
  // glyph up along -u (toward the back at the window), dark on clear
  const c = document.createElement('canvas'); c.width = 2048; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 2048, 128);
  g.fillStyle = '#16171b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 58px Inter, Helvetica, Arial, sans-serif';
  for (let t = 0; t < N; t++) {
    const fr = v => ((v % 1) + 1) % 1, u = fr(0.25 - t / N);
    for (const x of [u * 2048, u * 2048 - 2048, u * 2048 + 2048]) {
      if (x < -60 || x > 2108) continue;
      g.save(); g.translate(x, 64); g.rotate(-Math.PI / 2); g.fillText(ALPHA[t], 0, 2); g.restore();
    }
    g.fillRect(fr(0.25 - (t + 0.5) / N) * 2048 - 1, 6, 2, 14);
  }
  const band = new THREE.CanvasTexture(c); band.colorSpace = THREE.SRGBColorSpace; band.anisotropy = 4;
  // A-Z atlas, 6 x 5 cells, light glyphs on clear
  const a = document.createElement('canvas'); a.width = a.height = 512;
  const h = a.getContext('2d');
  h.clearRect(0, 0, 512, 512);
  h.fillStyle = '#f4ead2'; h.textAlign = 'center'; h.textBaseline = 'middle'; h.font = 'bold 60px Inter, Helvetica, Arial, sans-serif';
  for (let t = 0; t < N; t++) h.fillText(ALPHA[t], (t % 6 + 0.5) * 512 / 6, (Math.floor(t / 6) + 0.5) * 512 / 5 + 2);
  const atlas = new THREE.CanvasTexture(a); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  TEXC = { band, atlas };
  return TEXC;
}
const decalMat = (map, o = {}) => new THREE.MeshStandardMaterial({ map, transparent: false, alphaTest: 0.45, metalness: 0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, ...o });
// a disc decal facing +y at height y with letter t from the atlas
function letterDisc(r, y, t) {
  const g = new THREE.CircleGeometry(r, 32), uv = g.attributes.uv, col = t % 6, row = Math.floor(t / 6);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 6, 1 - (row + 1 - uv.getY(i)) / 5);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return g;
}

// ── shapes ──────────────────────────────────────────────────────────────────
function notchShape(r, rn, fn) {
  const s = new THREE.Shape(), n = 156, w = STEP / 2;
  s.moveTo(...P(rn, fn - w).toArray());
  s.lineTo(...P(rn, fn + w).toArray());
  for (let i = 0; i <= n; i++) { const f = fn + w + (Math.PI * 2 - 2 * w) * i / n; s.lineTo(...P(r, f).toArray()); }
  s.closePath();
  s.holes.push(circle(33));
  return s;
}
function ratchetShape(r0, r1) {
  const s = new THREE.Shape();
  // teeth face the push: the drop is at the leading edge of each tooth
  for (let i = 0; i < N; i++) {
    const f = i * STEP + STEP / 2;
    const a = P(r0, f), b = P(r1, f + 0.9 * STEP);
    if (i === 0) s.moveTo(a.x, a.y); else s.lineTo(a.x, a.y);
    s.lineTo(b.x, b.y);
  }
  s.closePath();
  s.holes.push(circle(33));
  return s;
}
function wheelShape(r, depth) {
  const s = new THREE.Shape(), n = N * 10;
  for (let i = 0; i <= n; i++) { const f = i / n * Math.PI * 2, rr = r - depth * (0.5 - 0.5 * Math.cos(N * f)); i ? s.lineTo(...P(rr, f).toArray()) : s.moveTo(...P(rr, f).toArray()); }
  s.holes.push(circle(33));
  return s;
}
// 26 rods on radius RC, each rod(r, y0, y1)
function contacts(r, y0, y1) {
  const gs = [];
  for (let c = 0; c < N; c++) { const g = rod(r, y0, y1, 14), [x, z] = at(RC, c * STEP); g.translate(x, 0, z); gs.push(g); }
  return merge(gs);
}

// ── a rotor ─────────────────────────────────────────────────────────────────
// k 0 L, 1 M, 2 R. The tyre, letters and notch ring turn by the ring
// setting against the core.
function rotorPart(B, k, name, ringN, notchN) {
  const p = B.part(['rotorL', 'rotorM', 'rotorR'][k], { info: ['rotorL', 'rotorM', 'rotorR'][k], label: `${['Left', 'Middle', 'Right'][k]} rotor ${name}`, labelAt: [64, 13, 0], u: [1, 0, 0], e0: [0, 1, 0], at: [X0[k], 0, 0], explode: [[-36, 0, 0], [-12, 0, 0], [12, 0, 0]][k], st: 0.1 + 0.08 * k, en: 0.7 + 0.08 * k });
  const T = letterTex();
  B.mesh(p, rod(36, 0, W, 104), 'rubber');
  B.mesh(p, tube(5.4, 10, -1.2, W + 1.2, 40), 'bolt');
  B.mesh(p, slab(wheelShape(50, 1.8), 15, 5, 0.5), 'alu');
  B.mesh(p, slab(ratchetShape(37, 42), 21, 4.6, 0.3), 'steel');
  B.mesh(p, contacts(1.3, -0.9, 0.6), 'brass');
  B.mesh(p, contacts(2.0, W - 0.6, W + 0.5), 'brass');
  // ring-set group: tyre, letters, notch ring
  const ringRot = ringN * STEP;
  const ty = B.mesh(p, tube(34, 46, 4.5, 14, 104), 'plate'); ty.rotation.y = ringRot;
  const nr = B.mesh(p, slab(notchShape(44, 38, (notchN + KP) * STEP), 0.4, 3.6, 0.3), 'bronze'); nr.rotation.y = ringRot;
  const band = new THREE.CylinderGeometry(46.35, 46.35, 8.4, 156, 1, true); band.translate(0, 9.25, 0);
  const lm = B.mesh(p, band, 'plate', { shadow: false }); lm.rotation.y = ringRot;
  lm.material = p.mats.letters = decalMat(T.band, { metalness: 0.2, roughness: 0.5 });
  return p;
}

export function build(B, id) {
  const u = unit(id), E = makeEnigma(u);
  const tex = letterTex();
  // reflector and entry wheel
  const ukw = B.part('ukw', { info: 'ukw', label: 'Reflector B', labelAt: [56, 10, 0], u: [1, 0, 0], e0: [0, 1, 0], at: [UKW_X, 0, 0], explode: [-60, 0, 0], st: 0.05, en: 0.6 });
  B.mesh(ukw, rod(38, 0, 20, 96), 'rubber');
  B.mesh(ukw, tube(36, 41, 2, 17, 96), 'cast');
  B.mesh(ukw, contacts(2.0, 19.4, 20.5), 'brass');
  B.mesh(ukw, tube(5.4, 10, -1.2, 21.2, 40), 'bolt');
  const etw = B.part('etw', { info: 'etw', label: 'Entry wheel', labelAt: [56, 7, 0], u: [1, 0, 0], e0: [0, 1, 0], at: [ETW_X, 0, 0], explode: [36, 0, 0], st: 0.3, en: 0.9 });
  B.mesh(etw, rod(38, 0, 14, 96), 'rubber');
  B.mesh(etw, tube(36, 41, 2, 12, 96), 'cast');
  B.mesh(etw, contacts(1.3, -0.9, 0.6), 'brass');
  B.mesh(etw, tube(5.4, 10, -1.2, 15.2, 40), 'bolt');
  const rotors = [0, 1, 2].map(k => rotorPart(B, k, u.rotors[k], E.ring[k], E.notch[k]));
  // axle
  const axle = B.part('axle', { info: 'axle', u: [1, 0, 0], e0: [0, 1, 0], at: [0, 0, 0], explode: [0, 0, 0] });
  B.mesh(axle, rod(5, -89, 60, 32), 'shaft');

  // pawls: a bar from the tip (local X 0) out to X 50; local Y along x.
  // Its outer end (radius 89-94) stays clear of the pawl bar (80.5-86.5).
  const PAWL = [[26.4, 30.2], [-3.6, 8.4], [-33.6, -21.6]];   // pawl 1 (R), 2 (M), 3 (L)
  const pawlShape = () => { const s = new THREE.Shape([[0, -2.6], [5, -2.6], [50, -3.4], [50, 3.4], [5, 2.6], [0, 1.2]].map(q => new THREE.Vector2(...q))); return s; };
  const e0p = [0, Math.cos(AP), -Math.sin(AP)], tang = new THREE.Vector3(0, Math.sin(AP), Math.cos(AP)), rad = new THREE.Vector3(...e0p);
  const pawls = PAWL.map(([x0, x1], j) => {
    const p = B.part('pawl' + (j + 1), { info: 'pawl', label: j === 1 ? 'Pawls' : null, labelAt: [46, (x1 - x0) / 2, 0], u: [1, 0, 0], e0: e0p, at: [x0, 0, 0], explode: [0, -10, -46], st: 0.35, en: 0.95 });
    B.mesh(p, slab(pawlShape(), 0, x1 - x0, 0.4), 'steel');
    return { p, x0 };
  });
  const bar = B.part('pawlBar', { info: 'pawl', explode: [0, -14, -64], st: 0.35, en: 1 });
  const bg = new THREE.BoxGeometry(70, 6, 6);
  B.mesh(bar, bg, 'cast');
  const barPos = rad.clone().multiplyScalar(83.5).setX(-1.5);

  // window index: a bar above the rotors with a pointer at each window
  const idx = B.part('index', { info: 'index', label: 'Windows', labelAt: [10, 60, -16], explode: [0, 40, 0], st: 0.2, en: 0.8 });
  { const g = new THREE.BoxGeometry(150, 4, 4); g.translate(-14.5, 56, -16); B.mesh(idx, g, 'paint'); }
  for (const x0 of X0) {
    const arm = new THREE.BoxGeometry(3, 2.6, 11); arm.translate(x0 + 9.25, 55, -9.5); B.mesh(idx, arm, 'paint');
    const cone = new THREE.ConeGeometry(2.4, 5, 4); cone.rotateX(Math.PI); cone.translate(x0 + 9.25, 51.5, -4.5); B.mesh(idx, cone, 'red');
  }

  // case: base, side plates
  const cs = B.part('case', { info: 'case', label: 'Case', labelAt: [-108, -70, 200], explode: [0, -70, 0], st: 0, en: 0.5 });
  const box = (w, h, d, x, y, z, mat, p = cs) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return B.mesh(p, g, mat); };
  box(224, 8, 326, 0, -80, 75, 'paint');
  box(6, 140, 132, -89, -8, -20, 'cast');
  box(6, 140, 132, 60, -8, -20, 'cast');

  // lamp deck and lamps
  const lb = B.part('lamps', { info: 'lamps', label: 'Lamp board', labelAt: [0, -36, 50], explode: [0, -24, 50], st: 0.05, en: 0.55 });
  box(210, 40, 88, 0, -60, 100, 'paint', lb);
  const lampAt = {}, keyAt = {};
  ROWS.forEach((row, r) => [...row].forEach((ch, j) => { const x = (j - (row.length - 1) / 2) * 21 + (r === 1 ? 0 : 0); lampAt[ch] = [x, 76 + r * 24]; keyAt[ch] = [x, 166 + r * 24]; }));
  const bez = [], lens = [], dec = [];
  for (const ch of ALPHA) {
    const [x, z] = lampAt[ch];
    const b = tube(7.5, 9, -40.6, -37.4, 32); b.translate(x, 0, z); bez.push(b);
    const l = rod(7.1, -40.9, -38.6, 32); l.translate(x, 0, z); lens.push(l);
    const d = letterDisc(6.4, -38.2, L2N(ch)); d.translate(x, 0, z); dec.push(d);
  }
  B.mesh(lb, merge(bez), 'steel');
  B.mesh(lb, merge(lens), 'rubber');
  const ld = B.mesh(lb, merge(dec), 'plate', { shadow: false, pick: false });
  ld.material = lb.mats.letters = decalMat(tex.atlas, { color: 0xb8ae98 });
  const glow = B.mesh(lb, rod(7.4, -41.2, -38.0, 32), 'plate', { shadow: false, pick: false });
  glow.material = lb.mats.glow = new THREE.MeshStandardMaterial({ color: 0xffe6a8, emissive: 0xffc35a, emissiveIntensity: 2.4, roughness: 0.4, metalness: 0 });
  glow.visible = false;
  const litDec = B.mesh(lb, letterDisc(6.4, -37.6, 0), 'plate', { shadow: false, pick: false });
  const litUV = [...ALPHA].map((_, t) => { const g = letterDisc(6.4, 0, t), a = g.attributes.uv.array.slice(); g.dispose(); return a; });
  litDec.material = lb.mats.litDec = decalMat(tex.atlas, { color: 0x3a2205, emissive: 0x000000 });
  litDec.visible = false;

  // keyboard: one group per key so the pressed key moves down
  const kb = B.part('keys', { info: 'keys', label: 'Keyboard', labelAt: [0, -46, 236], explode: [0, -40, 96], st: 0, en: 0.5 });
  box(210, 20, 86, 0, -70, 191, 'paint', kb);
  const keyG = {};
  for (const ch of ALPHA) {
    const g = new THREE.Group(), [x, z] = keyAt[ch];
    g.position.set(x, 0, z); kb.root.add(g); keyG[ch] = g;
    B.mesh(kb, rod(2, -60.6, -52, 12), 'steel', { parent: g });
    B.mesh(kb, rod(8, -52.2, -47.5, 32), 'rubber', { parent: g });
    B.mesh(kb, tube(8.3, 9.3, -52.6, -47.9, 32), 'steel', { parent: g });
    const d = B.mesh(kb, letterDisc(6.2, -47.1, L2N(ch)), 'plate', { parent: g, shadow: false, pick: false });
    d.material = kb.mats.letters || (kb.mats.letters = decalMat(tex.atlas));
  }

  // the wire path: segments (unit cylinders) and contact dots
  const path = B.part('path', { info: 'path', label: 'Current path', labelAt: [ETW_X + 16, 30, 0], labelWorld: true, explode: [0, 0, 0] });
  const matF = path.mats.fwd = new THREE.MeshStandardMaterial({ color: 0xffc26a, emissive: 0xff9a2a, emissiveIntensity: 1.6, roughness: 0.4 });
  const matB = path.mats.back = new THREE.MeshStandardMaterial({ color: 0x8fd0ff, emissive: 0x3aa0ff, emissiveIntensity: 1.6, roughness: 0.4 });
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), dotG = new THREE.SphereGeometry(2.5, 14, 10);
  const segs = [], dots = [];
  const addSeg = m => { const s = B.mesh(path, cyl.clone(), 'plate', { shadow: false }); s.material = m; segs.push(s); return s; };
  const addDot = m => { const s = B.mesh(path, dotG.clone(), 'plate', { shadow: false }); s.material = m; dots.push(s); return s; };
  cyl.dispose(); dotG.dispose();
  for (let i = 0; i < 19; i++) addSeg(i < 10 ? matF : matB);
  for (let i = 0; i < 16; i++) addDot(i < 8 ? matF : matB);
  // one place per contact stage: [x, absolute contact]
  const Y = new THREE.Vector3(0, 1, 0), va = new THREE.Vector3(), vb = new THREE.Vector3();
  const pt = (x, a) => { const f = a * STEP; return new THREE.Vector3(x, RC * Math.cos(f), -RC * Math.sin(f)); };
  const placeSeg = (s, A, Bp, r = 0.9) => {
    va.subVectors(Bp, A); const L = va.length();
    s.position.copy(A).addScaledVector(va, 0.5);
    s.quaternion.setFromUnitVectors(Y, L > 1e-6 ? va.normalize() : Y);
    s.scale.set(r, Math.max(1e-3, L), r);
  };

  // series of presses, built on demand
  const base = [...u.tape.toUpperCase()].filter(ch => L2N(ch) >= 0), over = new Map(), recs = [];
  const Eq = makeEnigma(u);
  const tapeAt = i => over.has(i) ? over.get(i) : base[i % base.length];
  const rec = i => { i = Math.max(0, Math.floor(i)); while (recs.length <= i) recs.push({ i: recs.length, ...Eq.press(tapeAt(recs.length)) }); return recs[i]; };
  const setKey = (i, ch) => {
    i = Math.max(0, Math.floor(i)); over.set(i, ch.toUpperCase());
    if (recs.length > i) { recs.length = i; Eq.reset(); for (let k = 0; k < i; k++) Eq.press(tapeAt(k)); }
  };
  let shownKey = null, xrayV = -1;
  const xrayMats = [];
  for (const p of [ukw, etw, ...rotors]) for (const k in p.mats) if (k !== 'brass' && k !== 'letters') xrayMats.push(p.mats[k]);
  // the case side plates fade too: in the wiring view (explode 0.6) the
  // left plate stands between reflector B and the left rotor, and the
  // wires from the reflector go through it
  xrayMats.push(cs.mats.cast);

  const disp = [0, 0, 0];
  const sc = {
    pose(t) {
      t = Math.max(0, t);
      const i = Math.floor(t), f = t - i, R = rec(i);
      const k = smooth(f / 0.3);
      for (let j = 0; j < 3; j++) {
        const d = md(R.pos[j] - R.before[j]);
        disp[j] = R.before[j] + d * k;
        rotors[j].spin((disp[j] - E.ring[j]) * STEP);
      }
      // pawls: push one tooth and back; engaged when the neighbour's notch
      // is under the tip (pawl 1 has no neighbour)
      const push = (f < 0.3 ? smooth(f / 0.3) : f < 0.6 ? 1 - smooth((f - 0.3) / 0.3) : 0) * 2 * Math.PI * 40 / N;
      const after = smooth((f - 0.6) / 0.2);
      pawls.forEach(({ p, x0 }, j) => {
        const nb = j === 0 ? -1 : 3 - j;                     // pawl 2 rides on R (2), pawl 3 on M (1)
        const e0 = nb < 0 || R.before[nb] === E.notch[nb] ? 1 : 0, e1 = nb < 0 || R.pos[nb] === E.notch[nb] ? 1 : 0;
        const eng = e0 + (e1 - e0) * after, rr = 44.4 - 5.2 * eng;
        p.root.position.set(x0, 0, 0).addScaledVector(rad, rr).addScaledVector(tang, push);
      });
      bar.root.position.copy(barPos).addScaledVector(tang, push);
      // key
      const kd = f < 0.15 ? smooth(f / 0.15) : f < 0.6 ? 1 : 1 - smooth((f - 0.6) / 0.25);
      const kc = N2Lc(R.key);
      if (shownKey && shownKey !== kc) keyG[shownKey].position.y = 0;
      keyG[kc].position.y = -5 * kd; shownKey = kc;
      // lamp
      const lit = f >= 0.3 && f < 0.97, lc = N2Lc(R.out);
      glow.visible = litDec.visible = lit;
      if (lit) { const [x, z] = lampAt[lc]; glow.position.set(x, 0, z); litDec.geometry.attributes.uv.array.set(litUV[R.out]); litDec.geometry.attributes.uv.needsUpdate = true; litDec.position.set(x, 0, z); }
      // wire path
      const show = f >= 0.3;
      for (const s of segs) s.visible = show;
      for (const s of dots) s.visible = show;
      if (show) {
        const a = R.a;
        const hx = q => q.holder.position.x;
        const xl = j => X0[j] + hx(rotors[j]), xr = j => X0[j] + W + hx(rotors[j]);
        const eL = ETW_X + hx(etw), eR = ETW_X + 14 + hx(etw), uR = UKW_X + 20 + hx(ukw);
        const F = [pt(eR, a[0]), pt(eL, a[0]), pt(xr(2), a[0]), pt(xl(2), a[1]), pt(xr(1), a[1]), pt(xl(1), a[2]), pt(xr(0), a[2]), pt(xl(0), a[3]), pt(uR, a[3]), pt(uR - 12, a[3])];
        const Bk = [pt(uR - 12, a[4]), pt(uR, a[4]), pt(xl(0), a[4]), pt(xr(0), a[5]), pt(xl(1), a[5]), pt(xr(1), a[6]), pt(xl(2), a[6]), pt(xr(2), a[7]), pt(eL, a[7]), pt(eR, a[7])];
        for (let s = 0; s < 9; s++) placeSeg(segs[s], F[s], F[s + 1]);
        // the reflector chord joins the two halves
        placeSeg(segs[9], F[9], Bk[0]);
        // the return wire is thinner, so two wires that cross never share a wall
        for (let s = 0; s < 9; s++) placeSeg(segs[10 + s], Bk[s], Bk[s + 1], 0.7);
        [1, 2, 3, 4, 5, 6, 7, 8].forEach((q, n) => dots[n].position.copy(F[q]));
        [1, 2, 3, 4, 5, 6, 7, 8].forEach((q, n) => dots[8 + n].position.copy(Bk[q]));
      }
      return { i, f, R, disp: disp.slice(), lit, show };
    },
    // x-ray: the rotor bodies fade so the wires inside show (0..1)
    xray(v) {
      if (Math.abs(v - xrayV) < 1e-3) return;
      xrayV = v;
      const fade = v > 0.002;
      for (const m of xrayMats) {
        if (m.transparent !== fade) { m.transparent = fade; m.needsUpdate = true; }
        m.opacity = 1 - 0.84 * v; m.depthWrite = v < 0.4;
      }
    },
    resetXray() { xrayV = -1; },
    rec, setKey, tapeAt, E, u, lampAt, keyAt,
    box: { c: [0, -11, 75], R: 205 },
    keys: { rotors: [-12, 0, 0], window: [-12, 46, 0], lamps: [0, -38, 100], keys: [0, -48, 190], pawls: [-2, -8, -60] },
  };
  return sc;
}
const N2Lc = n => ALPHA[md(n)];
