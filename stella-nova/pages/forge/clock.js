// ============================================================================
//  PLANET FORGE  ·  clock.js — the time rate and the planet clock (no DOM)
// ----------------------------------------------------------------------------
//  The view runs a simulated clock. The rate is a time-lapse factor: the
//  simulated seconds that pass in one real second. 1 is real time, 3600 is
//  one hour per second, 86400 one day per second. The slider is
//  logarithmic from RATE_MIN to RATE_MAX.
//
//  What the clock drives (main.js frame, saver.js):
//    spin   the planet turns once per DAY_S / P.spin simulated seconds
//           (P.spin 1 = a 24 h day, a gas giant at 2.4 = a 10 h day)
//    sun    with "moving sun" on, the sun goes round the planet once per
//           YEAR_DAYS days. A 30-day year is a legibility choice: with a
//           365-day year the sun would not move in a time-lapse.
//    clouds the cloud field (clouds.js, clouds.wgsl) evolves in simulated
//           hours: cyclones live a few days, fronts move in hours.
//
//  EXPORTS  RATE_MIN, RATE_MAX, RATE_DEFAULT, RATE_PRESETS, DAY_S, YEAR_DAYS,
//           sliderToRate, rateToSlider, rateLabel, createClock
// ============================================================================

export const RATE_MIN = 1, RATE_MAX = 4 * 86400, RATE_DEFAULT = 360;
export const DAY_S = 86400, YEAR_DAYS = 30;
export const RATE_PRESETS = [
  { label: 'real time', rate: 1 },
  { label: '1 min/s', rate: 60 },
  { label: '6 min/s', rate: 360 },
  { label: '1 h/s', rate: 3600 },
  { label: '1 day/s', rate: 86400 },
  { label: '4 days/s', rate: 4 * 86400 },
];

const LR = Math.log(RATE_MAX / RATE_MIN);
export function sliderToRate(x) { return RATE_MIN * Math.exp(Math.min(1, Math.max(0, x)) * LR); }
export function rateToSlider(r) { return Math.log(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) / RATE_MIN) / LR; }

// "6 min/s", "1 h/s", "2.5 days/s": the simulated time in one real second.
export function rateLabel(r) {
  const f = (v, u) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + u + '/s';
  if (r < 60) return f(r, 's');
  if (r < 3600) return f(r / 60, 'min');
  if (r < 86400) return f(r / 3600, 'h');
  return f(r / 86400, r < 1.5 * 86400 ? 'day' : 'days');
}

// The clock. tick(dt, opts) advances it by dt real seconds:
// opts = { rate, spinOn, spin (P.spin), sunOn }. State: simS (simulated
// seconds), spinAngle (rad), sunAz (deg). Spin and sun only move while on.
export function createClock(state = {}) {
  const c = { simS: 0, spinAngle: 0, sunAz: 50, ...state };
  c.tick = (dt, o = {}) => {
    const ds = dt * (o.rate ?? RATE_DEFAULT);
    c.simS += ds;
    if (o.spinOn !== false) c.spinAngle = (c.spinAngle + ds / DAY_S * 2 * Math.PI * (o.spin ?? 1)) % (2 * Math.PI);
    if (o.sunOn) c.sunAz = (c.sunAz + ds / (DAY_S * YEAR_DAYS) * 360) % 360;
    return c;
  };
  c.hours = () => c.simS / 3600;
  return c;
}
