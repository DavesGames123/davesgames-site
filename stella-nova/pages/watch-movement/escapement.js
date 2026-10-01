// ============================================================================
//  WATCH MOVEMENT  ·  escapement.js — escapements solved by collision
// ────────────────────────────────────────────────────────────────────────────
//  The escape wheel is always driven one way by the train. The oscillator
//  (lever or verge) moves blockers into and out of its path. solveBeats()
//  turns the wheel as far as the real outlines allow, over one beat each
//  way, and stores the wheel angle against the blocker position in tables.
//  A stone that moves into a tooth pushes the wheel back (recoil), which a
//  verge does on every swing and a lever does a little on the unlock.
//  No DOM and no THREE.
//
//  GREP MAP
//    function solveBeats ......... the generic table solver
//    function look ............... table lookup
//    function leverEscapement .... Swiss lever: geometry, tables, angles
// ============================================================================
import * as G from './geom.js';
const { TAU, pol, add, sub, rot, clamp } = G;

// hits(th, g): does the wheel at angle th meet a blocker at position g?
// The wheel is driven toward dir. g runs g0 -> g1 (table A), then back
// (table B). Each table holds the wheel angle relative to the lock at the
// start of its beat.
export function solveBeats({ hits, g0, g1, pitch, n = 160, dir = -1, step = 0.0015 }) {
  function advance(th0, g, maxTurn) {
    let th = th0;
    if (hits(th, g)) {
      // a blocker moved into a tooth: the tooth gives way, back or on
      let found = null;
      for (let k = 1; k * step < maxTurn / 2 && found === null; k++) {
        if (!hits(th0 - dir * k * step, g)) found = th0 - dir * k * step;
        else if (!hits(th0 + dir * k * step, g)) found = th0 + dir * k * step;
      }
      if (found === null) return { th, jammed: true };
      th0 = th = found;
    }
    for (;;) {
      if (Math.abs(th - th0) > maxTurn) return { th, runaway: true };
      if (hits(th + dir * step, g)) {
        let lo = th, hi = th + dir * step;            // lo clear, hi hits
        for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (hits(mid, g)) hi = mid; else lo = mid; }
        return { th: lo };
      }
      th += dir * step;
    }
  }
  let th = advance(0, g0, 2 * pitch).th;
  th = advance(th, g0, 2 * pitch).th;                  // settle the first lock
  const start = th, A = [], B = [];
  let bad = 0;
  const run = (ga, gb, tab) => {
    const base = th;
    for (let i = 0; i <= n; i++) {
      const g = ga + (gb - ga) * i / n;
      const r = advance(th, g, pitch);
      if (r.runaway || r.jammed) bad++;
      th = r.th; tab.push(th - base);
    }
  };
  run(g0, g1, A);
  const mid = th;
  run(g1, g0, B);
  // the bisection leaves ~1e-9 rad: snap the cycle to whole teeth so the
  // hands keep exact time over days (each table ends on its own lock)
  const teeth = Math.round((th - start) / pitch), cycle = teeth ? teeth * pitch : th - start;
  return { start, A, B, n, a: mid - start, b: cycle - (mid - start), cycle, bad, raw: th - start };
}

export function look(tab, u) {
  const x = clamp(u, 0, 1) * (tab.length - 1), i = Math.min(tab.length - 2, Math.floor(x)), f = x - i;
  return tab[i] + (tab[i + 1] - tab[i]) * f;
}

// ── Swiss lever ─────────────────────────────────────────────────────────────
// o: { E, psi, N, Ra, Rf, span, forkLen, jewelR, bank, stoneW, stoneL,
//      depthUp, depthDown }. psi is the direction from the escape arbor to
// the pallet arbor. The pallet arbor sits where the stone lines are
// tangent to the wheel (Ra / cos(span)); the balance is in line beyond it.
export function leverEscapement(o) {
  const { E, psi, N, Ra, Rf, span, forkLen, jewelR, bank } = o;
  // stones scale with the tooth pitch (Ra / N), from the 15-tooth, 2.3 mm
  // wheel they were tuned on; a finer wheel needs narrower stones
  const k = (Ra / N) / (2.3 / 15);
  const stoneW = o.stoneW ?? 0.30 * k, stoneL = o.stoneL ?? 1.05 * k;
  const depthUp = o.depthUp ?? -0.12 * k, depthDown = o.depthDown ?? 0.18 * k;
  const P = add(E, pol(Ra / Math.cos(span), psi));
  const Bal = add(P, pol(forkLen + jewelR, psi));
  const wheel = G.escapeProfile(N, Ra, Rf);
  const pitch = TAU / N;

  // the two stones in the world frame at fork angle g. Upstream is +angle:
  // the wheel turns toward -angle. The inner end slopes (impulse face).
  function stonePolys(g) {
    const out = [];
    for (const sgn of [1, -1]) {
      const a = psi + sgn * span;
      const r = [Math.cos(a), Math.sin(a)], t = [-r[1], r[0]];
      const at = (dep, side) => add(E, [r[0] * (Ra - dep) + t[0] * side, r[1] * (Ra - dep) + t[1] * side]);
      const poly = [at(depthDown, -stoneW / 2), at(-stoneL, -stoneW / 2), at(-stoneL, stoneW / 2), at(depthUp, stoneW / 2)];
      out.push(poly.map(p => add(P, rot(sub(p, P), g))));
    }
    return out;
  }
  const hits = (th, g) => {
    const poly = G.place(wheel, E, th);
    return stonePolys(g).some(s => G.polysOverlap(s, poly));
  };
  const T = solveBeats({ hits, g0: bank, g1: -bank, pitch });

  const forkAngle = b => clamp(-b * jewelR / forkLen, -bank, bank);
  const lift = bank * forkLen / jewelR;
  // escape angle at balance phase phi (b = amp sin phi). Beat k is the zero
  // crossing at phi = k PI; even k swings toward +b (table A).
  function escapeAngle(phi, amp) {
    const k = Math.round(phi / Math.PI), d = phi - k * Math.PI;
    const g = forkAngle(amp * Math.sin(d));
    const u = (bank - g) / (2 * bank);
    const cyc = Math.floor(k / 2), odd = k - 2 * cyc;
    return T.start + cyc * T.cycle + (odd ? T.a + look(T.B, u) : look(T.A, u));
  }
  // deepest overlap of wheel and stones at phase phi (tests)
  function depthAt(phi, amp) {
    const esc = G.place(wheel, E, escapeAngle(phi, amp)), st = stonePolys(forkAngle(amp * Math.sin(phi)));
    let d = 0;
    for (const s of st) for (const p of esc) if (G.inPoly(p, s)) d = Math.max(d, G.depthIn(p, s));
    return d;
  }
  return { E, P, Bal, psi, N, Ra, Rf, wheel, pitch, stonePolys, forkAngle, lift, escapeAngle, depthAt, tables: T, bank, jewelR, forkLen, span };
}
