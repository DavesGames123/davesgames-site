// ============================================================================
//  PUMPS  ·  tests.mjs — node stella-nova/pages/pumps/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js against the geometry, not against its own formulas:
//    gear ...... the two involute outlines never overlap and touch at
//                every angle; each contact lies on one line through P that
//                is tangent to both base circles; the contact nearest P is
//                |u| of gearU(); q from the energy rule at the real contact
//                equals flow(); contact ratio > 1; the mean flow gives V
//                and the ripple equals the closed form
//    vane ...... q equals the rate at which the chambers open to the
//                outlet lose fluid area (a finite step); the mean of q
//                over a turn is V / 2 pi; V is within 1% of n b (A_max -
//                A_min); no chamber opens to both ports; each chamber
//                passes inlet, sealed, outlet, sealed; the flow steps 2n
//                times a turn (a vane crosses a kidney edge); 9 vanes
//                ripple less than 8 or 10; the rotor clears the ring by
//                0.3 mm or more; each vane keeps 4 mm in its slot
//    roots ..... the two rotor outlines never overlap and touch at every
//                angle; the contact is 2a |sin 2 psi| from P; q from the
//                energy rule at the real contact equals flow(); V equals
//                the carried volume 2 b (pi Ra^2 - rotor area); the mean
//                flow gives V and the ripple equals the closed form
//    pockets ... on each rotor at least one tip seals on the casing at
//                every angle; each pocket goes inlet, sealed, outlet
// ============================================================================
import * as M from './mech.js';

const { TAU, D } = M;
let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else if (process.argv.includes('-v')) console.log('ok  ', msg); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
// a state sequence over one turn, read twice round (the last state of the
// turn is the first one again)
const cyc = s => { const t = s[s.length - 1] === s[0] ? s.slice(0, -1) : s; return t.concat(t).join(' '); };
const meanFlow = (u, N = 7200) => { let s = 0; for (let j = 0; j < N; j++) s += M.flow(u, TAU * (j + 0.5) / N); return s / N; };

// ── gear pump ───────────────────────────────────────────────────────────────
{
  const u = M.unit('gear'), G = M.gearDims(u), outline = M.gearOutline(u, 160, 24);
  const eps = (2 * Math.sqrt(G.Ra ** 2 - G.rb ** 2) - 2 * G.r * Math.sin(u.alpha)) / G.pb;
  ok(eps > 1.1, `gear: contact ratio ${eps.toFixed(3)} > 1.1`);
  ok(M.toothHalf(u, G.Ra) * G.Ra * 2 > 1, `gear: tip land ${(M.toothHalf(u, G.Ra) * G.Ra * 2).toFixed(2)} mm > 1 mm`);
  let pen = -Infinity, gapMax = 0, offLine = 0, uErr = 0, qErr = 0, nC = 0;
  for (let j = 0; j < 90; j++) {
    const th = TAU / u.Z * 2 * j / 90, F = M.gearFrames(u, th, G);
    // overlap: the outline of each gear in the other
    let best = -Infinity;
    for (const [x, y] of outline) {
      const w = M.fromFrame(F.B, x, y), d1 = M.gearDepth(u, ...M.toFrame(F.A, ...w), G);
      const v = M.fromFrame(F.A, x, y), d2 = M.gearDepth(u, ...M.toFrame(F.B, ...v), G);
      pen = Math.max(pen, d1, d2); best = Math.max(best, d1);
    }
    // contacts: the deepest point of each leading flank of A in B
    const C = [];
    for (let k = 0; k < u.Z; k++) {
      const at = rr => { const a = TAU * k / u.Z + M.toothHalf(u, rr, G), w = M.fromFrame(F.A, rr * Math.cos(a), rr * Math.sin(a)); return { w, d: M.gearDepth(u, ...M.toFrame(F.B, ...w), G) }; };
      let lo = G.rb, hi = G.Ra, bi = 0, bd = -Infinity;
      for (let i = 0; i <= 200; i++) { const d = at(lo + (hi - lo) * i / 200).d; if (d > bd) { bd = d; bi = i; } }
      let a = lo + (hi - lo) * Math.max(0, bi - 1) / 200, b = lo + (hi - lo) * Math.min(200, bi + 1) / 200;
      for (let i = 0; i < 80; i++) { const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3; if (at(m1).d < at(m2).d) a = m1; else b = m2; }
      const c = at((a + b) / 2);
      if (c.d > -1e-7) C.push(c.w);
    }
    nC += C.length;
    if (!C.length) { gapMax = Infinity; continue; }
    // all contacts on one line through P = (0, 0), tangent to the base circles
    const far = C.reduce((p, q) => (Math.hypot(...q) > Math.hypot(...p) ? q : p)), L = Math.hypot(...far), dx = far[0] / L, dy = far[1] / L;
    for (const c of C) offLine = Math.max(offLine, Math.abs(c[0] * dy - c[1] * dx));
    offLine = Math.max(offLine, Math.abs(Math.abs(G.r * dy) - G.rb));
    // the contact nearest P seals
    const cn = C.reduce((p, q) => (Math.hypot(...q) < Math.hypot(...p) ? q : p));
    uErr = Math.max(uErr, Math.abs(Math.hypot(...cn) - Math.abs(M.gearU(u, th, G))));
    const r1 = Math.hypot(cn[0] - G.r, cn[1]), r2 = Math.hypot(cn[0] + G.r, cn[1]);
    qErr = Math.max(qErr, rel(u.b / 2 * (2 * G.Ra ** 2 - r1 * r1 - r2 * r2), M.flow(u, th)));
  }
  ok(pen < 1e-6, `gear: outlines never overlap (deepest ${pen.toExponential(2)} mm)`);
  ok(gapMax === 0 && nC >= 90, `gear: a flank contact at every angle (${nC} contacts over 90 angles)`);
  ok(offLine < 1e-4, `gear: contacts on the line of action, tangent to rb (worst ${offLine.toExponential(2)} mm)`);
  ok(uErr < 1e-5, `gear: nearest contact |PC| = |u| (worst ${uErr.toExponential(2)} mm)`);
  ok(qErr < 1e-9, `gear: energy rule at the real contact = flow() (worst ${qErr.toExponential(2)})`);
  const V = M.displacement(u), q = M.flowCurve(u, 72000), R = M.rippleOf(u);
  ok(rel(meanFlow(u) * TAU, V) < 1e-4, `gear: mean flow x 2 pi = V = ${(V / 1000).toFixed(2)} cm3`);
  ok(rel((Math.max(...q) - Math.min(...q)) / (V / TAU), R.theory) < 1e-3, `gear: ripple ${(R.theory * 100).toFixed(2)}% = (pb^2/4) / (Ra^2 - r^2 - pb^2/12)`);
}

// ── sliding-vane pump ───────────────────────────────────────────────────────
// n = 8 has a 45 deg pitch, so its lands must be 45 deg or more: p0 24 deg
for (const nV of [9, 8]) {
  const u = { ...M.unit('vane'), n: nV, ...(nV === 8 ? { p0: 24 * D } : {}) }, P = M.vanePorts(u), be = P.beta, tag = `vane n=${nV}`;
  // fluid area of the chambers open to the outlet
  const open = th => M.vanePose(u, th).chambers.filter(c => c.state === 'outlet').map(c => c.i);
  const Vout = th => open(th).reduce((s, i) => s + M.chamberArea(u, th + i * be), 0);
  let err = 0, tested = 0;
  for (let j = 0; j < 720; j++) {
    const th = TAU * (j + 0.37) / 720, h = 1e-5, a = open(th - h).join(), b = open(th + h).join();
    if (a !== b || a !== open(th).join()) continue;
    const q = -(Vout(th + h) - Vout(th - h)) / (2 * h) * u.b;
    err = Math.max(err, rel(M.flow(u, th), q)); tested++;
  }
  ok(tested > 600 && err < 1e-5, `${tag}: q = rate of outlet fluid area loss (${tested} angles, worst ${err.toExponential(2)})`);
  const V = M.displacement(u);
  ok(rel(meanFlow(u) * TAU, V) < 1e-4, `${tag}: mean flow x 2 pi = V = ${(V / 1000).toFixed(2)} cm3`);
  const As = Array.from({ length: 3600 }, (_, j) => M.chamberArea(u, TAU * j / 3600));
  const Vext = u.n * u.b * (Math.max(...As) - Math.min(...As));
  ok(rel(V, Vext) < 0.01, `${tag}: V within 1% of n b (A_max - A_min) = ${(Vext / 1000).toFixed(2)} cm3`);
  // chamber states over a turn
  let both = 0, seqOk = true;
  const seq = Array.from({ length: u.n }, () => []);
  for (let j = 0; j < 3600; j++) {
    const ch = M.vanePose(u, TAU * j / 3600).chambers;
    for (const c of ch) { if (c.state === 'both') both++; const s = seq[c.i]; if (s[s.length - 1] !== c.state) s.push(c.state); }
  }
  for (const s of seq) if (!cyc(s).includes('inlet sealed outlet sealed inlet')) seqOk = false;
  ok(both === 0, `${tag}: no chamber opens to both ports`);
  ok(seqOk, `${tag}: each chamber goes inlet, sealed, outlet, sealed`);
  const q = M.flowCurve(u, 36000), m = V / TAU;
  let steps = 0;
  for (let j = 1; j < q.length; j++) if (Math.abs(q[j] - q[j - 1]) > 0.003 * m) steps++;
  ok(steps === 2 * nV, `${tag}: ${steps} flow steps a turn, one each time a vane crosses p0 or pi - p0`);
  if (nV === 9) {
    let gap = Infinity, ext = 0;
    for (let j = 0; j < 3600; j++) { const r = M.rho(u, TAU * j / 3600); gap = Math.min(gap, r - u.r); ext = Math.max(ext, r - u.r); }
    ok(gap >= 0.3 - 1e-9, `${tag}: rotor clears the ring by ${gap.toFixed(2)} mm`);
    ok(ext + 0.3 <= u.vaneL - 4, `${tag}: vane out by ${ext.toFixed(1)} mm of ${u.vaneL} mm, 4 mm or more in the slot`);
    // lands one pitch + 2 deg for the even neighbours
    const r9 = M.rippleOf(u).theory, r8 = M.rippleOf({ ...u, n: 8, p0: 24.5 * D }).theory, r10 = M.rippleOf({ ...u, n: 10, p0: 19 * D }).theory;
    ok(r9 < r8 && r9 < r10, `${tag}: odd n ripples less than n = 8 and 10 (${(r9 * 100).toFixed(2)}% < ${(r8 * 100).toFixed(2)}%, ${(r10 * 100).toFixed(2)}%)`);
  }
}

// ── Roots blower ────────────────────────────────────────────────────────────
{
  const u = M.unit('roots'), Ra = u.r + 2 * u.a, ol = M.rootsOutline(u, 1024);
  let pen = -Infinity, gap = 0, pcErr = 0, qErr = 0;
  for (let j = 0; j < 90; j++) {
    const th = Math.PI / 2 * j / 90 + 0.003, F = M.rootsFrames(u, th);
    let best = Infinity, bp = null;
    for (const [x, y] of ol) {
      const w = M.fromFrame(F.B, x, y), l = M.toFrame(F.A, ...w), d = M.rootsRadius(u, Math.atan2(l[1], l[0])) - Math.hypot(...l);
      pen = Math.max(pen, d);
      if (-d < best) { best = -d; bp = w; }
    }
    gap = Math.max(gap, best);
    pcErr = Math.max(pcErr, Math.abs(Math.hypot(...bp) - M.rootsPC(u, th)));
    const r1 = Math.hypot(bp[0] - u.r, bp[1]), r2 = Math.hypot(bp[0] + u.r, bp[1]);
    qErr = Math.max(qErr, Math.abs(u.b / 2 * (2 * Ra * Ra - r1 * r1 - r2 * r2) - M.flow(u, th)) / (M.displacement(u) / TAU));
  }
  ok(pen < 2e-3, `roots: rotors never overlap (deepest ${pen.toExponential(2)} mm, outline sampling)`);
  ok(gap < 2e-3, `roots: rotors touch at every angle (largest gap ${gap.toExponential(2)} mm)`);
  ok(pcErr < 0.02, `roots: contact |PC| = 2a |sin 2 psi| (worst ${pcErr.toFixed(4)} mm)`);
  ok(qErr < 2e-3, `roots: energy rule at the real contact = flow() (worst ${(qErr * 100).toFixed(3)}% of the mean)`);
  let A = 0;
  for (let i = 0; i < ol.length; i++) { const p = ol[i], q = ol[(i + 1) % ol.length]; A += (p[0] * q[1] - p[1] * q[0]) / 2; }
  const V = M.displacement(u), carried = 2 * u.b * (Math.PI * Ra * Ra - A);
  ok(rel(carried, V) < 2e-4, `roots: carried 2 b (pi Ra^2 - A) = ${(carried / 1000).toFixed(2)} cm3 = V ${(V / 1000).toFixed(2)} cm3`);
  const q = M.flowCurve(u, 7200), R = M.rippleOf(u);
  ok(rel(meanFlow(u) * TAU, V) < 1e-4, 'roots: mean flow x 2 pi = V');
  ok(rel((Math.max(...q) - Math.min(...q)) / (V / TAU), R.theory) < 1e-3, `roots: ripple ${(R.theory * 100).toFixed(2)}% = 4a^2 / (Ra^2 - r^2 - 2a^2)`);
}

// ── pockets and tip seals ───────────────────────────────────────────────────
for (const id of ['gear', 'roots']) {
  const u = M.unit(id), arc = M.casingArc(u), tips = id === 'gear' ? u.Z : 2;
  let unsealed = 0;
  const seq = {};
  for (let j = 0; j < 3600; j++) {
    const th = TAU * j / 3600, F = id === 'gear' ? M.gearFrames(u, th) : M.rootsFrames(u, th);
    for (const [Fr, out] of [[F.A, 0], [F.B, Math.PI]]) {
      let any = false;
      for (let k = 0; k < tips; k++) { const a = M.wrap(Fr.ang + TAU * k / tips - out + Math.PI) - Math.PI; if (Math.abs(a) <= arc) any = true; }
      if (!any) unsealed++;
    }
    for (const p of M.pumpPose(u, th).pockets) { const s = seq[p.side + p.k] || (seq[p.side + p.k] = []); if (s[s.length - 1] !== p.state) s.push(p.state); }
  }
  ok(unsealed === 0, `${id}: a tip seals on the casing on each rotor at every angle (arc +-${(arc / D).toFixed(1)} deg)`);
  ok(Object.values(seq).every(s => cyc(s).includes('inlet sealed outlet inlet')), `${id}: each pocket goes inlet, sealed, outlet`);
}
console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
