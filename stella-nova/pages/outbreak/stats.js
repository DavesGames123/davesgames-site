// ============================================================================
//  OUTBREAK  ·  stats.js — live numbers for the HUD and the director (no DOM)
// ----------------------------------------------------------------------------
//  createStats(D) -> Stats reads the real sim state (model.js) and keeps a
//  short memory, so the shot director (director.js) can pick its subject
//  from what happens and the saver HUD (render/hud.js) can show it.
//    update(sim, events)  once per frame: counts the infected flights out
//                         of each city (air events, not blocked) by day,
//                         and keeps I per node for the last DAYS whole days
//    reset()              a new run
//    growth(sim)   -> { node, rate /1/day, doubling /days, I } | null
//                     the fastest-growing city: ln(I now / I GROW_DAYS
//                     days ago) / GROW_DAYS, among cities with at least
//                     GROW_MIN_I infectious people
//    exporter(sim) -> { node, count, days } | null  the city with the most
//                     infected flights out in the last EXPORT_DAYS days
//    regions(sim)  -> [{ reached, cities, I, pop }] by World Bank region
//    tipped(sim)   -> { region, day, reached, cities } | null  the newest
//                     region that tipped over: half or more of its cities
//                     reached (3 cities or more), or I / pop >= TIP_PREV
//    curve(sim)    -> { inc, peakInc, peakDay, reff, peaked, below1 }
//    hud(sim)      -> { day, infected, cases, today, deaths, cities,
//                       countries, reff } straight from sim.totals() and
//                       sim.history (today = the last history.inc)
//  tickCounter(shown, target, dt) moves a shown HUD number toward its
//  target, so the counters tick up and never jump: an exponential approach
//  at COUNT_RATE per second, with a floor step so the last digits finish.
//  A target below the shown value (a new run) snaps at once.
//
//  grep -n targets: "export const COUNT_RATE", "export function tickCounter",
//                   "export function createStats", "growth(sim)", "exporter(sim)",
//                   "tipped(sim)", "curve(sim)", "hud(sim)", "export function fmtDays"
// ============================================================================

export const COUNT_RATE = 5;        // 1/s, the approach of a shown counter
export const DAYS = 8;              // days of I kept per node
export const GROW_DAYS = 3;         // days of the growth window
export const GROW_MIN_I = 50;       // infectious people for a growth reading
export const EXPORT_DAYS = 10;      // days of the export window
export const TIP_FRAC = 0.5, TIP_MIN = 3, TIP_PREV = 1e-3;

export function tickCounter(shown, target, dt, rate = COUNT_RATE) {
  if (!Number.isFinite(target)) return shown;
  if (!Number.isFinite(shown) || target <= shown) return target;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const step = Math.max((target - shown) * k, Math.min(target - shown, Math.max(1, target * 1e-4) * rate * dt));
  const v = shown + step;
  return target - v < 0.5 ? target : v;
}

// Days as text for the plate: 3.1 days, 12 days.
export function fmtDays(d) { return d < 10 ? `${d.toFixed(1)} days` : `${Math.round(d)} days`; }

export function createStats(D) {
  const nodes = (D && D.nodes) || [], N = nodes.length;
  const NR = (D && D.regions && D.regions.length) || 7;
  const region = Int32Array.from(nodes, n => n.region | 0), pop = Float64Array.from(nodes, n => n.pop || 1);
  const cities = new Int32Array(NR), rpop = new Float64Array(NR);
  for (let i = 0; i < N; i++) { cities[region[i]]++; rpop[region[i]] += pop[i]; }
  const ring = Array.from({ length: DAYS }, () => new Float64Array(N));   // I at the start of each whole day
  const ringDay = new Float64Array(DAYS).fill(-1);
  const exp = Array.from({ length: EXPORT_DAYS }, () => new Float64Array(N));
  const expDay = new Float64Array(EXPORT_DAYS).fill(-1);
  const tipDay = new Float64Array(NR).fill(-1);
  let lastWhole = -1, lastSim = null, tipOrder = [];

  function reset() {
    for (const r of ring) r.fill(0); ringDay.fill(-1);
    for (const e of exp) e.fill(0); expDay.fill(-1);
    tipDay.fill(-1); tipOrder = []; lastWhole = -1;
  }

  const st = {
    reset,
    update(sim, events) {
      if (!sim) return;
      if (sim !== lastSim) { reset(); lastSim = sim; }
      const whole = Math.floor(sim.day);
      if (whole !== lastWhole) {
        const k = ((whole % DAYS) + DAYS) % DAYS;
        ring[k].set(sim.I); ringDay[k] = whole;
        lastWhole = whole;
        // tipping: check once per whole day
        const R = st.regions(sim);
        for (let r = 0; r < NR; r++) {
          if (tipDay[r] >= 0) continue;
          const g = R[r];
          if ((g.cities >= TIP_MIN && g.reached >= TIP_FRAC * g.cities) || (g.pop > 0 && g.I / g.pop >= TIP_PREV)) { tipDay[r] = whole; tipOrder.push(r); }
        }
      }
      if (events) for (const ev of events) {
        if (ev.kind !== 'air' || ev.blocked || !(ev.from >= 0)) continue;
        const d = Math.floor(ev.day), k = ((d % EXPORT_DAYS) + EXPORT_DAYS) % EXPORT_DAYS;
        if (expDay[k] !== d) { exp[k].fill(0); expDay[k] = d; }
        exp[k][ev.from]++;
      }
    },
    growth(sim) {
      if (!sim || lastWhole < GROW_DAYS) return null;
      const k0 = (((lastWhole - GROW_DAYS) % DAYS) + DAYS) % DAYS;
      if (ringDay[k0] !== lastWhole - GROW_DAYS) return null;
      const now = ring[((lastWhole % DAYS) + DAYS) % DAYS], then = ring[k0];
      let best = -1, br = 0;
      for (let i = 0; i < N; i++) {
        if (!(now[i] >= GROW_MIN_I) || !(then[i] > 0)) continue;
        const r = Math.log(now[i] / then[i]) / GROW_DAYS;
        if (r > br) { br = r; best = i; }
      }
      return best < 0 ? null : { node: best, rate: br, doubling: Math.LN2 / br, I: now[best] };
    },
    exporter(sim) {
      if (!sim) return null;
      const d0 = Math.floor(sim.day) - EXPORT_DAYS;
      let best = -1, bc = 0;
      const tot = new Float64Array(N);
      for (let k = 0; k < EXPORT_DAYS; k++) if (expDay[k] > d0) { const e = exp[k]; for (let i = 0; i < N; i++) tot[i] += e[i]; }
      for (let i = 0; i < N; i++) if (tot[i] > bc) { bc = tot[i]; best = i; }
      return best < 0 ? null : { node: best, count: bc, days: EXPORT_DAYS };
    },
    regions(sim) {
      const out = Array.from({ length: NR }, (_, r) => ({ reached: 0, cities: cities[r], I: 0, pop: rpop[r] }));
      if (!sim) return out;
      for (let i = 0; i < N; i++) { const g = out[region[i]]; g.I += sim.I[i]; if (sim.firstDay[i] >= 0) g.reached++; }
      return out;
    },
    tipped(sim) {
      if (!sim || !tipOrder.length) return null;
      const r = tipOrder[tipOrder.length - 1], R = st.regions(sim)[r];
      return { region: r, day: tipDay[r], reached: R.reached, cities: R.cities, count: tipOrder.length };
    },
    curve(sim) {
      const h = sim && sim.history, inc = h && h.inc && h.inc.length ? h.inc : [];
      let peakInc = 0, peakDay = 0;
      for (let k = 0; k < inc.length; k++) if (inc[k] > peakInc) { peakInc = inc[k]; peakDay = h.day[k]; }
      const last = inc.length ? inc[inc.length - 1] : 0, day = sim ? sim.day : 0;
      const reff = h && h.reff && h.reff.length ? h.reff[h.reff.length - 1] : null;
      return { inc: last, peakInc, peakDay, reff, peaked: peakInc > 100 && day - peakDay >= 3 && last < 0.8 * peakInc, below1: Number.isFinite(reff) && reff < 1 };
    },
    hud(sim) {
      if (!sim) return { day: 0, infected: 0, cases: 0, today: 0, deaths: 0, cities: 0, countries: 0, reff: null };
      const t = sim.totals(), h = sim.history;
      let c = 0;
      const cs = new Set();
      for (let i = 0; i < N; i++) if (sim.firstDay[i] >= 0) { c++; cs.add(nodes[i].iso3 || nodes[i].country); }
      const r = h.reff && h.reff.length ? h.reff[h.reff.length - 1] : null;
      return { day: sim.day, infected: t.E + t.I, cases: t.cases, today: h.inc && h.inc.length ? h.inc[h.inc.length - 1] : 0,
        deaths: t.deaths, cities: c, countries: cs.size, reff: Number.isFinite(r) ? r : null };
    },
  };
  return st;
}
