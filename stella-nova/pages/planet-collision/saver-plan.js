// ============================================================================
//  PLANET COLLISION  ·  saver-plan.js — the screensaver reel, the shots and
//  the plate text (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  saver.js plays it; tests.mjs checks it.
//
//  REEL. A seeded shuffle of RUNS: every preset of scenarios.js and five
//  random draws (roll: true; the seed of the draw comes from the saver's
//  own seeded random function, so the reel differs from one saver seed to
//  the next). The same run never plays twice in a row, also across the
//  end of one bag and the start of the next.
//
//  SHOTS. One run is one take, cut into shots of CUT_MIN-CUT_MAX s:
//    approach  the two bodies, a slow push-in; ends at first contact
//              (event 'contact') plus HOLD s, not before CUT_MIN
//    impact    the contact point, close, at x1/4: the slow-motion push-in
//    splash    the melt splash from the side
//    cutaway   the bodies cut open (temperature or material colours): the
//              iron cores sink and merge
//    ejecta    a fly-through: the eye starts low and close and pulls back
//              through the debris while it turns
//    disk      high above: the re-accretion and the disk, at x4
//  The order is approach, impact, then splash, cutaway (in 2 runs of 3)
//  and ejecta in a seeded order, then disk. fn pickNext moves 'ejecta'
//  to the front when the escaping mass passes EJECTA_FRAC (data-driven).
//  Each shot gets a seeded length in [min, max], a side (the sign of its
//  turn) and, for the cutaway, a colour mode.
//  A shot is an offset of the auto-framed view (view.js): yaw (rad, times
//  the side), pitch (rad), zoom, push (the share of zoom lost over the
//  shot; negative pulls back), sweep (rad of turn over the shot), speed
//  (the page speed 1/4..4), follow ('pair' the auto frame, 'contact' the
//  first contact point).
//
//  PLATE (fn plateInfo). The lib/screensaver.js label: the run title, the
//  bodies, the impact speed in km/s and in v_esc, the angle, live numbers
//  from the stats and the outcome, and three TeX equations chosen by the
//  shot (escape speed, specific impact energy, Tillotson, SPH momentum,
//  temperature, the escape and disk tests). No code on the plate.
//
//  grep -n targets: "export const RUNS", "export const SHOTS",
//  "export function makeReel", "export function shotPlan",
//  "export function shotDone", "export function pickNext",
//  "export function runScenario", "export function plateInfo"
// ============================================================================
import { PRESETS, presetByKey, randomScenario } from './scenarios.js';
import { UNIT } from './data.js';
import { M_MOON } from './analysis.js';

export const CUT_MIN = 5, CUT_MAX = 12, HOLD = 0.8, EJECTA_FRAC = 0.02;

export const RUNS = PRESETS.map(p => ({ key: p.key, preset: p.key }))
  .concat(['roll-a', 'roll-b', 'roll-c', 'roll-d', 'roll-e'].map(key => ({ key, roll: true })));

export const SHOTS = {
  approach: { min: 5, max: 12, yaw: 0.0, pitch: 0.30, zoom: 1.00, push: 0.18, sweep: 0.10, speed: 2, follow: 'pair', until: 'contact' },
  impact:   { min: 5, max: 8,  yaw: 0.85, pitch: 0.14, zoom: 0.40, push: 0.22, sweep: 0.05, speed: 0.25, follow: 'contact' },
  splash:   { min: 5, max: 9,  yaw: -0.7, pitch: 0.38, zoom: 0.78, push: 0.14, sweep: 0.12, speed: 1, follow: 'pair' },
  cutaway:  { min: 5, max: 8,  yaw: 1.6, pitch: 0.06, zoom: 0.70, push: 0.10, sweep: 0.0, speed: 1, follow: 'pair', cut: true },
  ejecta:   { min: 6, max: 10, yaw: 2.3, pitch: -0.22, zoom: 0.50, push: -1.1, sweep: 0.6, speed: 2, follow: 'pair' },
  disk:     { min: 6, max: 12, yaw: 0.3, pitch: 1.18, zoom: 1.25, push: 0.10, sweep: 0.25, speed: 4, follow: 'pair' },
};

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// A seeded order of all runs; `last` (a run key) never comes first.
export function makeReel(rnd, last = null) {
  const a = RUNS.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (last && a[0].key === last) a.push(a.shift());
  return a;
}
// The scenario of a run: a preset, or a random draw seeded from rnd.
export function runScenario(run, rnd) {
  if (run.preset) return { sc: presetByKey(run.preset), seed: 1 + Math.floor(rnd() * 9999) };
  const seed = 1 + Math.floor(rnd() * 999999);
  return { sc: randomScenario(seed), seed };
}
// The shots of one run.
export function shotPlan(rnd) {
  const mid = ['splash', 'ejecta'];
  if (rnd() < 2 / 3) mid.push('cutaway');
  for (let i = mid.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mid[i], mid[j]] = [mid[j], mid[i]]; }
  return ['approach', 'impact', ...mid, 'disk'].map(kind => {
    const S = SHOTS[kind], len = S.min + (S.max - S.min) * rnd();
    return Object.assign({ kind, len, side: rnd() < 0.5 ? -1 : 1, mode: kind === 'cutaway' ? (rnd() < 0.5 ? 1 : 4) : 0 }, S);
  });
}
// Is the shot over? el: seconds in the shot; ev: { contactAt (s in the
// shot, or null) }.
export function shotDone(sh, el, ev) {
  if (el >= CUT_MAX) return true;
  if (el < CUT_MIN) return false;
  if (sh.until === 'contact') return ev.contactAt !== null && el >= Math.max(CUT_MIN, ev.contactAt + HOLD);
  return el >= sh.len;
}
// The index of the next shot in shots after i: 'ejecta' jumps ahead when
// the escaping mass share esc is over EJECTA_FRAC, but never before the
// impact shot (a fast impactor counts as escaping at first contact).
export function pickNext(shots, i, esc) {
  if (i + 1 >= shots.length) return -1;
  const afterImpact = shots.slice(0, i + 1).some(s => s.kind === 'impact');
  if (esc > EJECTA_FRAC && afterImpact) for (let k = i + 1; k < shots.length - 1; k++) if (shots[k].kind === 'ejecta') {
    const [s] = shots.splice(k, 1); shots.splice(i + 1, 0, s); break;
  }
  return i + 1;
}

const TEX = {
  vesc: ['v_\\mathrm{esc} = \\sqrt{\\dfrac{2G\\,(M_T+M_I)}{R_T+R_I}}', 'v_esc = √(2G(M_T + M_I)/(R_T + R_I))'],
  qr: ['Q_R = \\dfrac{\\mu\\, v_\\mathrm{imp}^{2}}{2\\,(M_T+M_I)},\\quad \\mu = \\dfrac{M_T M_I}{M_T+M_I}', 'Q_R = μ v_imp² / 2(M_T + M_I)'],
  till: ['P = \\left[a + \\dfrac{b}{E/(E_0\\eta^{2})+1}\\right]\\rho E + A\\mu + B\\mu^{2}', 'P = [a + b/(E/(E₀η²) + 1)] ρE + Aμ + Bμ²'],
  sph: ['\\dfrac{d\\mathbf{v}_i}{dt} = -\\sum_j m_j\\left(\\dfrac{P_i}{\\rho_i^{2}}+\\dfrac{P_j}{\\rho_j^{2}}+\\Pi_{ij}\\right)\\nabla_i W_{ij} - \\nabla\\phi_i', 'dv_i/dt = −Σ m_j (P_i/ρ_i² + P_j/ρ_j² + Π_ij) ∇W_ij − ∇φ_i'],
  temp: ['T = T_0 + \\dfrac{u - u_\\mathrm{cold}(\\rho)}{c_v}', 'T = T₀ + (u − u_cold(ρ))/c_v'],
  esc: ['\\tfrac12 |\\mathbf{v}-\\mathbf{V}|^{2} - \\dfrac{G M_p}{r} \\ge 0 \\;\\Rightarrow\\; \\text{escapes}', '½|v − V|² − GM_p/r ≥ 0 → escapes'],
  disk: ['q = a\\,(1-e) > R_p \\;\\Rightarrow\\; \\text{disk}', 'q = a(1 − e) > R_p → disk'],
};
const SHOT_TEX = {
  approach: ['vesc', 'qr', 'till'], impact: ['till', 'sph', 'qr'], splash: ['sph', 'temp', 'till'],
  cutaway: ['till', 'temp', 'sph'], ejecta: ['esc', 'disk', 'vesc'], disk: ['disk', 'esc', 'qr'],
};
const fmtM = x => (x >= 0.1 ? x.toFixed(2) : x >= 0.001 ? x.toFixed(4) : x.toExponential(1));
const pct = x => (100 * x).toFixed(x < 0.1 ? 1 : 0) + ' %';

// The plate of the shot. g: { sc, setup, stats, out, peak, n, shot,
// warp (sim s per wall s), slow (bool) }. Returns the lib/screensaver.js
// label (without the anchor).
export function plateInfo(g) {
  const B = g.setup.bodies, im = g.setup.impact, st = g.stats, o = g.out, k = g.shot ? g.shot.kind : 'approach';
  const tName = B[0].name, iName = B[1] ? B[1].name : '';
  const vk = im.vImp * UNIT.V / 1000;
  const QR = im.QR * UNIT.V * UNIT.V;
  const tH = st ? st.tSec / 3600 : 0;
  const toContact = st ? Math.max(0, (im.tContact - st.t) * UNIT.T / 60) : im.tContact * UNIT.T / 60;
  const disk = o ? o.Md / M_MOON : 0;
  let line;
  switch (k) {
    case 'approach': line = `${iName} falls toward ${tName} at ${vk.toFixed(1)} km/s. Contact in about ${toContact.toFixed(0)} min.`; break;
    case 'impact': line = `First contact. Shock pressure up to ${st ? Math.round(g.peak.P).toLocaleString('en-US') : '-'} GPa. Slow motion.`; break;
    case 'splash': line = `The melt splash: ${pct(g.peak.melt)} of the particles are over their melting point.`; break;
    case 'cutaway': line = `Cut open (${g.shot.mode === 1 ? 'temperature' : 'iron, rock and ice'}): the iron cores sink and merge.`; break;
    case 'ejecta': line = o ? `Ejecta: ${pct(o.Me / o.Mtot)} of the mass escapes, ${disk.toFixed(2)} Moon masses stay in orbit.` : 'Ejecta leave the impact site.'; break;
    default: line = o ? `${tH.toFixed(1)} h: the largest body holds ${pct(o.Mp / o.Mtot)} of the mass; the disk ${disk.toFixed(2)} Moon masses.` : `${tH.toFixed(1)} h of simulated time.`;
  }
  const warp = g.warp > 0 ? (g.warp >= 60 ? `1 s = ${(g.warp / 60).toFixed(1)} min` : `1 s = ${g.warp.toFixed(0)} s`) + (g.slow ? ' (slow motion)' : '') : '';
  const keys = SHOT_TEX[k] || SHOT_TEX.approach;
  const params = [
    { sym: 'M_T', name: tName, value: fmtM(B[0].M) + ' M⊕', cls: 'm1' },
    { sym: 'M_I', name: iName, value: fmtM(B[1] ? B[1].M : 0) + ' M⊕', cls: 'm2' },
    { sym: 'v_\\mathrm{imp}', name: 'impact speed', value: `${vk.toFixed(1)} km/s = ${(im.vImp / im.vesc).toFixed(2)} v_esc`, cls: 'm5' },
    { sym: '\\theta', name: 'impact angle', value: `${im.theta.toFixed(0)}°`, cls: 'm3' },
  ];
  if (o) params.push({ sym: 'M_p', name: 'largest body', value: pct(o.Mp / o.Mtot), cls: 'm6' });
  else params.push({ sym: 'Q_R', name: 'impact energy per kg', value: QR.toExponential(1).replace('e+', '×10^') + ' J/kg', cls: 'm4' });
  if (g.peak && g.peak.T99 > 0 && k !== 'approach') params.push({ sym: 'T_{99}', name: 'peak temperature', value: Math.round(g.peak.T99).toLocaleString('en-US') + ' K', cls: 'm2' });
  return {
    title: g.sc.title,
    sub: `${tName} and ${iName}: a giant impact in smoothed particle hydrodynamics`,
    params,
    tex: keys.map(x => TEX[x][0]),
    eq: keys.map(x => TEX[x][1]),
    rules: [['M_T', 'm1'], ['M_I', 'm2'], ['v_\\mathrm{imp}', 'm5'], ['M_p', 'm6'], ['Q_R', 'm4']],
    lines: [line, `${g.n.toLocaleString('en-US')} SPH particles · self-gravity and the Tillotson equation of state on the GPU${warp ? ' · ' + warp : ''}`],
  };
}

// The reel's titles, for a check (all runs have a title).
export function runTitle(run) { return run.preset ? presetByKey(run.preset).title : 'a random collision'; }
