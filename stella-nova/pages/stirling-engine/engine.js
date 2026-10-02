// ============================================================================
//  STIRLING ENGINE  ·  engine.js — kinematics, gas volumes, the Schmidt cycle
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE: tests.mjs runs this file in Node. scene.js builds the
//  3D parts from the same numbers, so the model and the analysis agree.
//
//  FRAME. Units are millimetres. The crankshaft lies on the x axis at y = 0.
//  The cylinders stand on +y. A crank throw at angle a has its pin at
//  (y, z) = (r cos a, r sin a). The power throw sits at the crank angle
//  theta. The displacer throw leads it by the phase angle alpha.
//
//  GAS. The Schmidt model: each space keeps one temperature (hot space Th,
//  cold space Tc, regenerator the log mean Tr), and the pressure is the
//  same everywhere:  P = M / (Vh/Th + Vr/Tr + Vc/Tc).  M is fixed by a cold
//  fill at 1 atm, so the engine is a sealed charge of air.
//
//  GREP MAP
//    function sliderCrank ...... crank pin and small end for one throw
//    function gammaGeom ........ the gamma layout (two cylinders)
//    function betaGeom ......... the beta layout (one cylinder, coaxial)
//    function makeEngine ....... E.kin, E.gas, E.cycle, E.process
//      E.kin(th, al) ........... part positions for a crank angle
//      E.gas(k, Th) ............ space volumes, masses, pressure
//      E.cycle(al, Th) ......... one turn sampled: P-V loop, W, Qh, Qc
// ============================================================================
export const D = Math.PI / 180, TAU = Math.PI * 2;
export const PHASE_MIN = 30, PHASE_MAX = 150;
export const TC = 300;          // cold end, K
export const P0 = 101325;       // fill pressure and the crankcase, Pa
const PI = Math.PI;

// one slider-crank: throw radius r, rod length l, throw angle a
export function sliderCrank(r, l, a) {
  const py = r * Math.cos(a), pz = r * Math.sin(a);
  const y = py + Math.sqrt(l * l - pz * pz);
  return { py, pz, y, rod: Math.atan2(-pz, y - py) };
}
export const pathLength = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); return s; };
export const regenTemp = (Th, Tc) => Math.abs(Th - Tc) < 1e-6 ? Th : (Th - Tc) / Math.log(Th / Tc);

// ── layouts ─────────────────────────────────────────────────────────────────
function gammaGeom() {
  return {
    id: 'gamma', name: 'Gamma engine', kind: 'two cylinders · 90° crank',
    blurb: 'The displacer and the power piston live in separate cylinders, joined by a transfer pipe. The displacer only shuttles the air between the hot and cold ends; the power piston takes the work.',
    shaft: { x0: -72, x1: 116, r: 5 },
    bearings: [-58, 58],
    flywheel: { x: 95, R: 55, w: 12 },
    base: { x0: -116, x1: 150, z0: -62, z1: 56, top: -66, h: 10 },
    frame: { x0: -102, x1: 66, y0: -66, y1: 122, z0: -50, z1: -42 },
    disp: { x: -35, r: 14, l: 60, bore: 25, wall: 1.6, dR: 24.4, dLen: 70, rodR: 3, rodLen: 70, floor: 110, head: 220 },
    pow: { x: 35, xs: [35], r: 12, l: 55, bore: 16, pinToCrown: 20, pLen: 30, head: 90, cylY0: 36 },
    regen: { x: -84, y0: 126, y1: 212, rOut: 10, rIn: 7.5, cap: 4, porosity: 0.72 },
    pipes: {
      hot: { pts: [[-50, 223, 0], [-50, 238, 0], [-84, 238, 0], [-84, 210, 0]], rIn: 2.6, rOut: 3.6, bend: 7 },
      cold: { pts: [[-84, 128, 0], [-84, 114, 0], [-60.5, 114, 0]], rIn: 2.6, rOut: 3.6, bend: 7 },
      transfer: { pts: [[-9.5, 114, 0], [35, 114, 0], [35, 99, 0]], rIn: 2.6, rOut: 3.6, bend: 8 },
    },
    cooler: { y0: 122, y1: 154, fins: 6, R: 36 },
    hotcap: { y0: 166, R: 28.5, top: 6 },
    heater: { y0: 174, y1: 206, R0: 29, R1: 34 },
  };
}
function betaGeom() {
  const g = {
    id: 'beta', name: 'Beta engine', kind: 'one cylinder · coaxial',
    blurb: 'The displacer and the power piston share one cylinder, the displacer rod running through the piston. The two can overlap in stroke, so the beta packs more swept volume into less dead space.',
    shaft: { x0: -54, x1: 96, r: 5 },
    bearings: [-40, 40],
    flywheel: { x: 75, R: 55, w: 12 },
    base: { x0: -100, x1: 128, z0: -62, z1: 56, top: -66, h: 10 },
    frame: { x0: -80, x1: 48, y0: -66, y1: 112, z0: -50, z1: -42 },
    disp: { x: 0, r: 14, l: 34, bore: 25, wall: 1.6, dR: 24.4, dLen: 70, rodR: 3, rodLen: 0, head: 0 },
    pow: { x: 0, xs: [-14, 14], r: 12, l: 62, bore: 25, pinToBottom: 6, pinToCrown: 36, pLen: 30, cylY0: 50 },
    regen: { x: -52, y0: 128, y1: 0, rOut: 10, rIn: 7.5, cap: 4, porosity: 0.72 },
    cooler: { y0: 0, y1: 0, fins: 6, R: 36 },
    hotcap: { y0: 0, R: 28.5, top: 6 },
    heater: { y0: 0, y1: 0, R0: 29, R1: 34 },
  };
  // the displacer rod is as short as it can be: 3 mm between the displacer
  // and the piston crown at the worst crank angle of the worst phase
  const d = g.disp, p = g.pow;
  let need = -1e9, top = -1e9, crownMax = -1e9;
  for (let al = PHASE_MIN; al <= PHASE_MAX; al += 1) for (let t = 0; t < 360; t += 1) {
    const cl = sliderCrank(d.r, d.l, (t + al) * D).y, cr = sliderCrank(p.r, p.l, t * D).y + p.pinToCrown;
    need = Math.max(need, cr - cl); crownMax = Math.max(crownMax, cr);
  }
  d.rodLen = Math.ceil(need + 3);
  for (let t = 0; t < 360; t += 1) top = Math.max(top, sliderCrank(d.r, d.l, t * D).y + d.rodLen + d.dLen);
  d.head = Math.ceil(top + 4);
  const portY = Math.ceil(crownMax + 5);
  g.portY = portY;
  g.cooler.y0 = portY + 6; g.cooler.y1 = portY + 38;
  g.hotcap.y0 = d.head - 54;
  g.heater.y0 = d.head - 46; g.heater.y1 = d.head - 14;
  g.regen.y1 = d.head - 8;
  g.frame.y1 = portY - 4;
  g.pipes = {
    hot: { pts: [[-15, d.head + 3, 0], [-15, d.head + 18, 0], [-52, d.head + 18, 0], [-52, g.regen.y1 - 2, 0]], rIn: 2.6, rOut: 3.6, bend: 7 },
    cold: { pts: [[-52, g.regen.y0 + 2, 0], [-52, portY, 0], [-25.5, portY, 0]], rIn: 2.6, rOut: 3.6, bend: 7 },
  };
  return g;
}

// ── the engine ──────────────────────────────────────────────────────────────
export function makeEngine(id) {
  const g = id === 'beta' ? betaGeom() : gammaGeom();
  const d = g.disp, p = g.pow, beta = g.id === 'beta';
  const A = PI * d.bore * d.bore, Arod = PI * d.rodR * d.rodR, Ap = PI * p.bore * p.bore;
  const ann = PI * (d.bore * d.bore - d.dR * d.dR) * d.dLen;
  const pipeV = k => g.pipes[k] ? PI * g.pipes[k].rIn ** 2 * pathLength(g.pipes[k].pts) : 0;
  const rg = g.regen;
  const Vregen = PI * rg.rIn * rg.rIn * (rg.y1 - rg.y0 - 2 * rg.cap) * rg.porosity;
  const dead = { hotPipe: pipeV('hot'), coldPipe: pipeV('cold'), transfer: pipeV('transfer'), ann, regen: Vregen };

  // positions of the moving parts at crank angle th, phase al (radians)
  function kin(th, al) {
    const dk = sliderCrank(d.r, d.l, th + al), pk = sliderCrank(p.r, p.l, th);
    const dispBottom = dk.y + d.rodLen, dispTop = dispBottom + d.dLen;
    const crown = pk.y + p.pinToCrown;
    return { th, al, dk, pk, clevis: dk.y, dispBottom, dispTop, pin: pk.y, crown };
  }
  // the gas spaces, in path order hot end -> cold end. Each space: volume
  // (mm^3) and kind (h, r, c). scene.js maps gas particles onto this order.
  function spaces(k) {
    const S = [];
    S.push({ id: 'hot', kind: 'h', V: A * (d.head - k.dispTop) + ann / 2 });
    S.push({ id: 'hotPipe', kind: 'h', V: dead.hotPipe });
    S.push({ id: 'regen', kind: 'r', V: dead.regen });
    S.push({ id: 'coldPipe', kind: 'c', V: dead.coldPipe });
    if (beta) S.push({ id: 'cold', kind: 'c', V: (A - Arod) * (k.dispBottom - k.crown) + ann / 2 });
    else {
      S.push({ id: 'cold', kind: 'c', V: (A - Arod) * (k.dispBottom - d.floor) + ann / 2 });
      S.push({ id: 'transfer', kind: 'c', V: dead.transfer });
      S.push({ id: 'power', kind: 'c', V: Ap * (p.head - k.crown) });
    }
    return S;
  }
  const sum = (S, kind) => S.reduce((s, q) => s + (!kind || q.kind === kind ? q.V : 0), 0);

  // cold fill at 1 atm, mean volume at a 90° phase: M = P0 Vmean / Tc
  let vm = 0;
  for (let t = 0; t < 360; t += 2) vm += sum(spaces(kin(t * D, 90 * D)));
  vm /= 180;
  const M = P0 * vm / TC;

  // the gas at one pose: volumes, masses (fractions) and pressure
  function gas(k, Th, Tc = TC) {
    const S = spaces(k), Tr = regenTemp(Th, Tc);
    const T = q => q.kind === 'h' ? Th : q.kind === 'c' ? Tc : Tr;
    let den = 0; for (const q of S) { q.T = T(q); den += q.V / q.T; }
    for (const q of S) q.m = q.V / q.T / den;
    const Vh = sum(S, 'h'), Vc = sum(S, 'c'), Vr = sum(S, 'r');
    return { S, Vh, Vc, Vr, V: Vh + Vc + Vr, P: M / den, Tr, mh: Vh / Th / den, mc: Vc / Tc / den, mr: Vr / Tr / den };
  }

  // swept volumes (for the process test and the readout)
  let vhMin = 1e18, vhMax = -1e18, vpMin = 1e18, vpMax = -1e18;
  for (let t = 0; t < 360; t += 1) {
    const k = kin(t * D, 0), gs = gas(k, 600);
    vhMin = Math.min(vhMin, gs.Vh); vhMax = Math.max(vhMax, gs.Vh);
    vpMin = Math.min(vpMin, gs.V); vpMax = Math.max(vpMax, gs.V);
  }
  const sweptD = A * 2 * d.r, sweptP = Ap * 2 * p.r * (beta ? 1 : 1);

  // which of the four processes the crank is in. The rates are scaled by
  // the two swept volumes: a gas shuttle that is faster than the volume
  // change is heating or cooling, otherwise expansion or compression.
  function process(th, al, Th) {
    const h = 0.5 * D, a = gas(kin(th - h, al), Th), b = gas(kin(th + h, al), Th);
    const dV = (b.V - a.V) / (2 * h) / (sweptP / 2), dH = (b.Vh - a.Vh) / (2 * h) / (sweptD / 2);
    if (Math.abs(dH) > Math.abs(dV)) return dH > 0 ? 'heat' : 'cool';
    return dV > 0 ? 'expand' : 'compress';
  }

  // one turn: the P-V loop and the energy per cycle (J)
  function cycle(al, Th, Tc = TC, N = 360) {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const th = i / N * TAU, k = kin(th, al), gs = gas(k, Th, Tc);
      pts.push({ th, V: gs.V, P: gs.P, Vh: gs.Vh, Vc: gs.Vc, proc: process(th, al, Th) });
    }
    let W = 0, Qh = 0, Qc = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N], Pm = (a.P + b.P) / 2;
      W += Pm * (b.V - a.V); Qh += Pm * (b.Vh - a.Vh); Qc += Pm * (b.Vc - a.Vc);
    }
    const s = 1e-9;   // Pa * mm^3 -> J
    let Pmin = 1e18, Pmax = -1e18, Vmin = 1e18, Vmax = -1e18, Pmean = 0;
    for (const q of pts) { Pmin = Math.min(Pmin, q.P); Pmax = Math.max(Pmax, q.P); Vmin = Math.min(Vmin, q.V); Vmax = Math.max(Vmax, q.V); Pmean += q.P / N; }
    return { pts, W: W * s, Qh: Qh * s, Qc: Qc * s, eta: Qh > 0 ? W / Qh : 0, Pmin, Pmax, Pmean, Vmin, Vmax };
  }

  // the shaft torque from the gas on the power piston (N m), by virtual
  // work: T = (P - P0) Ap dy/dth. The displacer rod adds (P - P0) Arod.
  function torque(th, al, Th) {
    const h = 0.25 * D, k = kin(th, al), gs = gas(k, Th);
    const dyp = (kin(th + h, al).pin - kin(th - h, al).pin) / (2 * h);
    const dyd = (kin(th + h, al).clevis - kin(th - h, al).clevis) / (2 * h);
    return (gs.P - P0) * (Ap * dyp + Arod * dyd) * 1e-9;   // Pa * mm^2 * mm -> N m
  }

  return { g, id: g.id, beta, A, Ap, Arod, M, dead, sweptD, sweptP, kin, spaces, gas, cycle, process, torque };
}
export const VARIANTS = [
  { id: 'gamma', name: 'Gamma', kind: 'two cylinders' },
  { id: 'beta', name: 'Beta', kind: 'one cylinder' },
];
export const PROC = {
  heat: { name: 'Heating', sub: 'volume nearly constant · gas shuttled to the hot end', col: '#e8a25c' },
  expand: { name: 'Expansion', sub: 'gas mostly hot · the piston is pushed out', col: '#e07a7a' },
  cool: { name: 'Cooling', sub: 'volume nearly constant · gas shuttled to the cold end', col: '#6fb0e6' },
  compress: { name: 'Compression', sub: 'gas mostly cold · the flywheel pushes the piston in', col: '#7fc8b0' },
};
