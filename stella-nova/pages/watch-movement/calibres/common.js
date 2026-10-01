// ============================================================================
//  WATCH MOVEMENT  ·  calibres/common.js — the running watch, any calibre
// ────────────────────────────────────────────────────────────────────────────
//  A calibre gives four things: escAngle(phi, amp), the escape wheel angle
//  at balance phase phi; chain(thE), every train angle from the escape
//  angle; spent(ch, C0), the mainspring turns released since the reference
//  pose C0; and the beat length. makeRunner() turns them into createState,
//  step and pose. The balance angle is amp * sin(phi); one beat is PI of
//  phase. The reserve is in mainspring turns: reserve0 - spent + wound.
//  No DOM and no THREE.
// ============================================================================
import { TAU } from '../geom.js';

export function makeRunner(o) {
  const C0 = o.chain(o.startE);
  const secondsOf = thE => (thE - o.startE) / o.cycleE * 2 * o.beat;
  const reserveOf = (s, ch) => s.reserve0 - o.spent(ch, C0) + s.wound;
  const ampFor = o.ampFor || (r => r <= 0 ? 0 : o.amp0 * Math.min(1, 0.62 + 0.38 * r / 2));

  function createState(clockSeconds = 0, frac = 0.85) {
    const beats = 2 * Math.round(clockSeconds / (2 * o.beat));
    const s = { phi: beats * Math.PI - Math.PI / 2 + 1e-3, wound: 0, reserve0: 0, amp: 0, stopped: false, t: 0, rotor: 0, rotorV: 0 };
    const ch = o.chain(o.escAngle(s.phi, o.lift * 2));
    s.reserve0 = o.reserveTurns * frac + o.spent(ch, C0);
    s.amp = ampFor(o.reserveTurns * frac);
    return s;
  }

  // dt in watch seconds; wind in mainspring turns (>= 0)
  function step(s, dt, wind = 0) {
    s.t += dt;
    if (o.preStep) wind += o.preStep(s, dt) || 0;
    if (wind) {
      s.wound += wind;
      const r = reserveOf(s, o.chain(o.escAngle(s.phi, s.amp)));
      if (r > o.reserveTurns) s.wound -= r - o.reserveTurns;      // the bridle slips
    }
    const r = reserveOf(s, o.chain(o.escAngle(s.phi, s.amp)));
    s.amp += (ampFor(r) - s.amp) * Math.min(1, dt * 1.5);
    s.stopped = r <= 0 || s.amp < o.lift * 1.05;
    if (!s.stopped) s.phi += TAU * o.fBal * dt;
    else {
      const k = Math.round(s.phi / Math.PI), d = s.phi - k * Math.PI;
      if (Math.abs(d) > 1e-4) s.phi = k * Math.PI + d * Math.max(0, 1 - dt * 3);
      if (r > 0.02) { s.amp = Math.max(s.amp, o.lift * 1.2); s.stopped = false; }
    }
  }

  function pose(s) {
    const thE = o.escAngle(s.phi, s.amp);
    const ch = o.chain(thE);
    const balance = s.amp * Math.sin(s.phi);
    const out = {
      ...ch, balance, reserve: reserveOf(s, ch), seconds: secondsOf(thE), beats: Math.round(s.phi / Math.PI),
      hands: { hour: ch.hour - C0.hour, minute: ch.cannon - C0.cannon, second: ch.second !== undefined ? ch.second - C0.second : 0 },
    };
    if (o.extra) Object.assign(out, o.extra(s, ch, out));
    return out;
  }
  return { createState, step, pose, C0, secondsOf, reserveOf };
}
