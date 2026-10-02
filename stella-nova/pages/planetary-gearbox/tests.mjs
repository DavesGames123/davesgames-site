// ============================================================================
//  PLANETARY GEARBOX  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks gears.js and layout.js, with no browser:
//    willis ...... every solved mode satisfies the Willis equation of each set
//    ratios ...... the six simple modes and the Simpson gears equal their
//                  closed forms (3.2, 1.4545, 2.4545, −2.2, ...)
//    mesh ........ at random angles, every planet sits in a sun tooth space
//                  and a ring tooth space (sweep over all tooth counts the
//                  sliders allow, all planet counts that fit)
//    spacing ..... planetChoices only offers counts with (Zs + Zr)/N whole
//                  and clear planet tips
//    outline ..... the involute outline closes, keeps Z teeth, and stays
//                  between the root and tip circles
//    explode ..... no two part envelopes overlap at any explode value, for
//                  both sets and every slider count (pins may slide in
//                  their plates only along the axis)
// ============================================================================
import { makeSet, planetChoices, bestPlanets, meshError, MODELS, SIMPSON_GEARS, simpleMode, solveSpeeds, poseAngles, ratioOf, toothOutline, TAU } from './gears.js';
import { layout, envAt, envOverlap, explodeK } from './layout.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { c ? pass++ : fail++; if (!c || process.env.V) console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ── ratios and Willis ────────────────────────────────────────────────────────
{
  const S = makeSet(30, 18, 3), k = S.k, ks = [k];
  const want = { RS: 1 + k, SR: 1 + 1 / k, SC: k / (1 + k), CS: -k, CR: -1 / k, RC: 1 / (1 + k) };
  for (const key in want) {
    const md = simpleMode(key[0], key[1]), sp = solveSpeeds(MODELS.simple, ks, md, 1);
    ok(near(ratioOf(sp, md), want[key]), `simple ${key[0]} held, ${key[1]} in`, `i = ${ratioOf(sp, md).toFixed(4)}`);
    ok(near((sp.S - sp.C) + k * (sp.R - sp.C), 0), `Willis holds (${key})`);
  }
  const d = solveSpeeds(MODELS.simple, ks, simpleMode(null, 'S'), 1);
  ok(near(d.S, 1) && near(d.C, 1) && near(d.R, 1), 'lock two: all turn as one');
  const k2 = [k, k], wantG = { 1: 2 + 1 / k, 2: 1 + 1 / k, 3: 1, R: -k };
  for (const g in wantG) {
    const md = SIMPSON_GEARS[g], sp = solveSpeeds(MODELS.simpson, k2, md, 1);
    ok(near(ratioOf(sp, md), wantG[g]), `Simpson gear ${g}`, `i = ${ratioOf(sp, md).toFixed(4)}`);
    ok(near(sp.S - sp.C1 + k * (sp.R1 - sp.C1), 0) && near(sp.S - sp.C2 + k * (sp.C1 - sp.C2), 0), `Willis holds in both sets (gear ${g})`);
  }
  const n = solveSpeeds(MODELS.simpson, k2, SIMPSON_GEARS.N, 1);
  ok(near(n.C1, 0) && near(n.R1, 1) && near(n.S, -k), 'neutral: output still, sun backward', `ωS = ${n.S.toFixed(3)}`);
}

// ── mesh phases over every slider count ──────────────────────────────────────
{
  let worst = 0, sets = 0, bad = '';
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let Zs = 12; Zs <= 44; Zs++) for (let Zp = 12; Zp <= 30; Zp++) for (const N of planetChoices(Zs, Zp)) for (const psi0 of [0, Math.PI / N]) {
    const S = makeSet(Zs, Zp, N, 2, psi0); sets++;
    for (let t = 0; t < 12; t++) {
      const f = { S: (rnd() - 0.5) * 400, C: (rnd() - 0.5) * 400 }, a = poseAngles('simple', [S.k], f);
      const e = meshError(S, a.S, a.C, a.R), w = Math.max(e.sun, e.ring);
      if (w > worst) { worst = w; bad = `${Zs}/${Zp}/${N}`; }
    }
  }
  ok(worst < 1e-6, 'every planet in mesh with sun and ring', `${sets} sets, worst ${worst.toExponential(1)} pitch at ${bad}`);
  // the Simpson pose keeps both sets in mesh
  const F = makeSet(30, 18, 3, 2, 0), R = makeSet(30, 18, 3, 2, Math.PI / 3);
  let w2 = 0;
  for (let t = 0; t < 50; t++) {
    const a = poseAngles('simpson', [F.k, R.k], { S: t * 7.3, C1: -t * 2.9 });
    const e1 = meshError(F, a.S, a.C1, a.R1), e2 = meshError(R, a.S, a.C2, a.C1);
    w2 = Math.max(w2, e1.sun, e1.ring, e2.sun, e2.ring);
  }
  ok(w2 < 1e-6, 'Simpson: both sets in mesh', `worst ${w2.toExponential(1)}`);
  // a wrong planet count would not assemble: the check must see it
  const W = makeSet(30, 18, 3); W.psi = [0, TAU / 3 + 0.05, 2 * TAU / 3];
  ok(meshError(W, 0, 0, 0).ring > 0.05, 'mesh check catches a misplaced planet');
}

// ── spacing and outline ──────────────────────────────────────────────────────
{
  let okAll = true;
  for (let Zs = 12; Zs <= 44; Zs++) for (let Zp = 12; Zp <= 30; Zp++) {
    const ch = planetChoices(Zs, Zp), Zr = Zs + 2 * Zp;
    if (!ch.length || !bestPlanets(Zs, Zp)) okAll = false;
    for (const N of ch) if ((Zs + Zr) % N || (Zs + Zp) * Math.sin(Math.PI / N) <= Zp + 2.5) okAll = false;
  }
  ok(okAll, 'planet counts: whole spacing, clear tips, at least one choice');
  for (const [Z, m] of [[12, 2.5], [30, 2.5], [66, 2.5], [96, 2]]) {
    const pts = toothOutline(Z, m), r = m * Z / 2;
    const rad = pts.map(p => Math.hypot(p[0], p[1]));
    const lo = Math.min(...rad), hi = Math.max(...rad);
    let turns = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; turns += Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]); }
    let tips = 0; for (let i = 0; i < rad.length; i++) if (rad[i] > hi - 1e-6 && !(rad[(i + rad.length - 1) % rad.length] > hi - 1e-6)) tips++;
    ok(near(turns, TAU, 1e-6) && lo >= Math.max(r - 1.25 * m, 0.3 * r) - 1e-9 && near(hi, r + m, 1e-9) && tips === Z, `outline Z=${Z}: one loop, ${tips} tips, root ${lo.toFixed(2)} tip ${hi.toFixed(2)}`);
  }
}

// ── explode: no envelope overlaps ────────────────────────────────────────────
{
  const sweep = (L) => {
    const P = L.parts;
    for (let s = 0; s <= 300; s++) {
      const e = s / 300, E = P.map(p => envAt(p, e));
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const a = P[i], b = P[j], slide = (a.slide || []).includes(b.id) || (b.slide || []).includes(a.id);
        for (const A of E[i]) for (const B of E[j]) if (envOverlap(A, B)) {
          if (slide && near((a.ex.dr || 0) * explodeK(a, e), (b.ex.dr || 0) * explodeK(b, e))) continue;
          return `${a.id} / ${b.id} at e = ${e.toFixed(3)}`;
        }
      }
    }
    return null;
  };
  for (const id of ['simple', 'simpson']) {
    let first = null, n = 0;
    for (let Zs = 12; Zs <= 44; Zs += 2) for (let Zp = 12; Zp <= 30; Zp += 2) for (const N of planetChoices(Zs, Zp)) {
      n++;
      const r = sweep(layout(id, Zs, Zp, N));
      if (r && !first) first = `${Zs}/${Zp}/${N}: ${r}`;
    }
    ok(!first, `${id}: explode path clear`, first || `${n} tooth sets, 301 steps each`);
  }
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
