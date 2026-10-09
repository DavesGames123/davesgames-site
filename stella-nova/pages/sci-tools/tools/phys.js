// ============================================================================
//  SCIENCE TOOLKIT  ·  tools/phys.js  ·  physics and engineering
// ----------------------------------------------------------------------------
//  Tool definitions for the "phys" category (contract: tools/units.js).
//  Inputs with units go through core/units.js. Constants are CODATA 2022.
//
//  GREP MAP
//    grep -n "projectile:"  "shm:"  "photon:"  "blackbody:"  "relativity:"
//    grep -n "doppler:"  "resistor:"  "combine:"  "rlc:"  "optics:"  "db:"
//    grep -n "export function ellipK"   complete elliptic integral (AGM)
//    grep -n "export function eng"      "4.7k" style values
//    grep -n "export const COLORS"      resistor colour code (IEC 60062)
// ============================================================================
import { qty, dimEq, dimName, constQty } from '../core/units.js';
import { integrate } from '../core/numeric.js';
import { fmt, esc, num, plot, linspace } from '../kit.js';

const K = (id) => constQty(id).v;
const D = (o) => { const d = [0, 0, 0, 0, 0, 0, 0]; for (const [k, v] of Object.entries(o)) d[['m', 'kg', 's', 'A', 'K', 'mol', 'cd'].indexOf(k)] = v; return d; };
const DIMS = {
  length: D({ m: 1 }), time: D({ s: 1 }), speed: D({ m: 1, s: -1 }), accel: D({ m: 1, s: -2 }), mass: D({ kg: 1 }), freq: D({ s: -1 }),
  energy: D({ kg: 1, m: 2, s: -2 }), power: D({ kg: 1, m: 2, s: -3 }), volt: D({ kg: 1, m: 2, s: -3, A: -1 }), wavenumber: D({ m: -1 }), temp: D({ K: 1 }), stiff: D({ kg: 1, s: -2 }), one: D({}),
  ohm: D({ kg: 1, m: 2, s: -3, A: -2 }), henry: D({ kg: 1, m: 2, s: -2, A: -2 }), farad: D({ kg: -1, m: -2, s: 4, A: 2 }),
};
function q(text, dim, what) {
  const Q = qty(text);
  if (!dimEq(Q.d, DIMS[dim])) throw new Error(`${what} must be a ${dim === 'one' ? 'pure number' : dim}, not ${dimName(Q.d)}.`);
  return Q.v;
}
const blank = (s) => !String(s ?? '').trim();
const PHYS_REF = 'CODATA 2022 constants (NIST).';

// Complete elliptic integral of the first kind K(k) by the AGM.
export function ellipK(k) {
  let a = 1, b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-16 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return Math.PI / (2 * a);
}

// "4.7k", "10u", "2M2", "100n", "4k7", "1.5 kΩ" -> number.
const ENG = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
export function eng(text) {
  const t = String(text).trim().replace(/\s*(Ω|ohm|ohms|F|H)$/i, '').replace(/\s+/g, '');
  let m = /^(\d+)([pnuµμmkKMG])(\d+)$/.exec(t);
  if (m) return Number(`${m[1]}.${m[3]}`) * ENG[m[2]];
  m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([pnuµμmkKMG]?)$/i.exec(t);
  if (!m) throw new Error(`"${text}" is not a value. Write 4.7k, 10u, 2M2 or 1e3.`);
  return Number(m[1]) * ENG[m[2]];
}
const engText = (x, unit = '') => {
  if (x === 0) return `0 ${unit}`.trim();
  const e = Math.floor(Math.log10(Math.abs(x)) / 3) * 3, cl = Math.max(-12, Math.min(9, e));
  const p = { '-12': 'p', '-9': 'n', '-6': 'µ', '-3': 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' }[cl];
  return `${fmt(x / 10 ** cl, 6)} ${p}${unit}`;
};

// IEC 60062 colour code: [name, digit, multiplier exponent, tolerance %, tempco ppm/K].
export const COLORS = [
  ['black', 0, 0, null, 250], ['brown', 1, 1, 1, 100], ['red', 2, 2, 2, 50], ['orange', 3, 3, 0.05, 15], ['yellow', 4, 4, 0.02, 25],
  ['green', 5, 5, 0.5, 20], ['blue', 6, 6, 0.25, 10], ['violet', 7, 7, 0.1, 5], ['grey', 8, 8, 0.01, 1], ['white', 9, 9, null, null],
  ['gold', null, -1, 5, null], ['silver', null, -2, 10, null], ['none', null, null, 20, null],
];
const CBY = Object.fromEntries(COLORS.map(c => [c[0], c]));
CBY.gray = CBY.grey; CBY.purple = CBY.violet;
const HEX = { black: '#111', brown: '#7b4a1e', red: '#d32f2f', orange: '#f57c00', yellow: '#fbc02d', green: '#2e7d32', blue: '#1565c0', violet: '#7b1fa2', grey: '#8a8a8a', white: '#f5f5f5', gold: '#c9a227', silver: '#b0b0b0', none: 'transparent' };
// IEC 60063 E-series.
const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
const E96 = [1.00, 1.02, 1.05, 1.07, 1.10, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.30, 1.33, 1.37, 1.40, 1.43, 1.47, 1.50, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.00, 2.05, 2.10, 2.15, 2.21, 2.26, 2.32, 2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.80, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24, 3.32, 3.40, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12, 4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23, 5.36, 5.49, 5.62, 5.76, 5.90, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98, 7.15, 7.32, 7.50, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66, 8.87, 9.09, 9.31, 9.53, 9.76];
export function nearestE(x, series) {
  const e = Math.floor(Math.log10(x)), m = x / 10 ** e;
  let best = null;
  for (const v of [...series, 10]) if (!best || Math.abs(Math.log(v / m)) < Math.abs(Math.log(best / m))) best = v;
  return Number((best * 10 ** e).toPrecision(3));
}
export function decodeBands(list) {
  const b = list.map(s => { const c = CBY[s.toLowerCase()]; if (!c) throw new Error(`"${s}" is not a colour of the code.`); return c; });
  if (b.length < 3 || b.length > 6) throw new Error('Give 3 to 6 bands.');
  const nd = b.length >= 5 ? 3 : 2;
  const digits = b.slice(0, nd);
  if (digits.some(c => c[1] == null)) throw new Error(`The first ${nd} bands must be digit colours (black to white).`);
  const mult = b[nd];
  if (mult[2] == null) throw new Error('"none" cannot be a multiplier.');
  const value = Number(digits.map(c => c[1]).join('')) * 10 ** mult[2];
  const tol = b.length >= 4 ? b[nd + 1][3] : 20;
  if (tol == null) throw new Error(`${b[nd + 1][0]} is not a tolerance colour.`);
  return { value, tol, tempco: b.length === 6 ? b[5][4] : null };
}
export function encodeBands(value, digits = 2) {
  if (!(value > 0)) throw new Error('The value must be greater than 0.');
  const e = Math.floor(Math.log10(value)) - (digits - 1);
  const sig = Math.round(value / 10 ** e);
  let ex = e, s = sig;
  if (s >= 10 ** digits) { s = Math.round(s / 10); ex += 1; }
  if (ex < -2 || ex > 9) throw new Error('The value is outside the range of the colour code.');
  const ds = String(s).padStart(digits, '0').split('').map(Number);
  return [...ds.map(d => COLORS[d][0]), COLORS.find(c => c[2] === ex)[0]];
}

const swatches = (names) => `<div class="bands" style="display:flex;gap:6px;align-items:center;margin-top:10px">${names.map(n => `<span title="${esc(n)}" style="display:inline-block;width:26px;height:44px;border-radius:4px;border:1px solid #2f4046;background:${HEX[n]}"></span>`).join('')}<span class="dim" style="margin-left:6px">${esc(names.join(' · '))}</span></div>`;

export const TOOLS = {
  projectile: {
    inputs: [
      { k: 'v', label: 'Launch speed v₀', def: '20 m/s' }, { k: 'a', label: 'Launch angle θ', def: '45 deg' },
      { k: 'h', label: 'Launch height h₀', def: '0 m' }, { k: 'g', label: 'Gravity g', def: '9.80665 m/s^2' },
    ],
    examples: [{ label: 'from a 10 m cliff', v: { v: '15 m/s', a: '30 deg', h: '10 m' } }, { label: 'on the Moon', v: { v: '20 m/s', a: '45 deg', g: '1.62 m/s^2' } }],
    run({ v, a, h, g }) {
      const V = q(v, 'speed', 'v₀'), th = q(a, 'one', 'θ'), H = q(h, 'length', 'h₀'), G = q(g, 'accel', 'g');
      if (!(G > 0)) throw new Error('g must be greater than 0.');
      const vx = V * Math.cos(th), vy = V * Math.sin(th);
      const T = (vy + Math.sqrt(vy * vy + 2 * G * H)) / G;
      if (!Number.isFinite(T) || T < 0) throw new Error('The projectile never reaches the ground (h₀ below 0 and too slow).');
      const R = vx * T, tTop = Math.max(0, vy / G), Hmax = H + (vy > 0 ? vy * vy / (2 * G) : 0);
      const vyE = vy - G * T, vEnd = Math.hypot(vx, vyE);
      const rows = [['Range', `${fmt(R, 8)} m`], ['Time of flight', `${fmt(T, 8)} s`], ['Maximum height', `${fmt(Hmax, 8)} m`, `at t = ${fmt(tTop, 6)} s`], ['Impact speed', `${fmt(vEnd, 8)} m/s`], ['Impact angle', `${fmt(Math.atan2(-vyE, vx) * 180 / Math.PI, 6)}° below the horizontal`]];
      if (H === 0) rows.push(['Check: v₀² sin 2θ / g', `${fmt(V * V * Math.sin(2 * th) / G, 8)} m`]);
      const ts = linspace(0, T, 200);
      const svg = plot([{ x: ts.map(t => vx * t), y: ts.map(t => H + vy * t - G * t * t / 2) }], { xlabel: 'x (m)', ylabel: 'y (m)', title: 'Trajectory (no air drag)' });
      return { rows, svg, copy: rows[0][1] };
    },
    tex: ['x(t) = v_0\\cos\\theta\\,t,\\quad y(t) = h_0 + v_0\\sin\\theta\\,t - \\tfrac12 g t^2', 't_f = \\frac{v_0\\sin\\theta + \\sqrt{v_0^2\\sin^2\\theta + 2gh_0}}{g},\\quad R = v_0\\cos\\theta\\,t_f'],
    how: 'Uniform gravity and no air drag. The time of flight is the positive root of y(t) = 0. Angles take units (deg, rad).',
    refs: ['D. Halliday, R. Resnick and J. Walker, Fundamentals of Physics, 10th ed. (2014), §4-6.', 'g_n = 9.806 65 m/s² (standard gravity, CGPM 1901).'],
  },

  shm: {
    inputs: [
      { k: 'mode', label: 'Oscillator', type: 'select', def: 'pendulum', opts: [['spring', 'Mass on a spring'], ['pendulum', 'Simple pendulum']] },
      { k: 'k', label: 'Spring constant k', def: '50 N/m' }, { k: 'm', label: 'Mass m', def: '0.5 kg' },
      { k: 'L', label: 'Pendulum length L', def: '1 m' }, { k: 'g', label: 'Gravity g', def: '9.80665 m/s^2' },
      { k: 'A', label: 'Amplitude (length, or angle for a pendulum)', def: '30 deg' },
    ],
    examples: [{ label: 'spring, 5 cm', v: { mode: 'spring', A: '5 cm' } }, { label: 'pendulum at 90°', v: { mode: 'pendulum', A: '90 deg' } }],
    run({ mode, k, m, L, g, A }) {
      const rows = [];
      let w;
      if (mode === 'spring') {
        const Ks = q(k, 'stiff', 'k'), M = q(m, 'mass', 'm');
        w = Math.sqrt(Ks / M);
        rows.push(['Angular frequency ω', `${fmt(w, 8)} rad/s`], ['Frequency f', `${fmt(w / (2 * Math.PI), 8)} Hz`], ['Period T', `${fmt(2 * Math.PI / w, 8)} s`]);
        if (!blank(A)) {
          const a = q(A, 'length', 'Amplitude');
          rows.push(['Maximum speed ωA', `${fmt(w * a, 8)} m/s`], ['Maximum acceleration ω²A', `${fmt(w * w * a, 8)} m/s²`], ['Energy ½kA²', `${fmt(0.5 * Ks * a * a, 8)} J`]);
        }
      } else {
        const Lp = q(L, 'length', 'L'), G = q(g, 'accel', 'g');
        w = Math.sqrt(G / Lp);
        const T0 = 2 * Math.PI / w;
        rows.push(['Small-angle period T₀', `${fmt(T0, 8)} s`], ['Small-angle frequency', `${fmt(1 / T0, 8)} Hz`]);
        if (!blank(A)) {
          const th = q(A, 'one', 'Amplitude');
          if (!(Math.abs(th) < Math.PI)) throw new Error('The amplitude must be below 180°.');
          const T = 4 * Math.sqrt(Lp / G) * ellipK(Math.sin(th / 2));
          rows.push(['Exact period at this amplitude', `${fmt(T, 8)} s`, `${fmt(100 * (T / T0 - 1), 5)} % longer than T₀`], ['Maximum speed', `${fmt(Math.sqrt(2 * G * Lp * (1 - Math.cos(th))), 8)} m/s`]);
        }
      }
      return { rows, copy: rows[0][1] };
    },
    tex: ['\\omega = \\sqrt{k/m},\\quad T = 2\\pi\\sqrt{m/k}', 'T_0 = 2\\pi\\sqrt{L/g},\\qquad T = 4\\sqrt{L/g}\\;K\\!\\big(\\sin\\tfrac{\\theta_0}{2}\\big)', 'K(k) = \\frac{\\pi}{2\\,\\mathrm{AGM}\\big(1,\\sqrt{1-k^2}\\big)}'],
    how: 'The spring is an ideal Hooke spring. For the pendulum the small-angle period is shown, and with an amplitude the exact period of the rigid point pendulum, from the complete elliptic integral K computed by the arithmetic–geometric mean.',
    refs: ['L. D. Landau and E. M. Lifshitz, Mechanics, 3rd ed. (1976), §11.', 'NIST DLMF §19.8 (AGM for K), dlmf.nist.gov/19.8.'],
  },

  photon: {
    inputs: [{ k: 'x', label: 'Wavelength, frequency, energy or wavenumber', def: '532 nm', w: 2, hint: 'for example 532 nm, 5.6e14 Hz, 2.33 eV, 18797 1/cm' }],
    examples: [{ label: 'FM radio', v: { x: '100 MHz' } }, { label: 'Cu Kα X-ray', v: { x: '8.048 keV' } }, { label: 'CO2 laser', v: { x: '943 1/cm' } }],
    run({ x }) {
      const Q = qty(x), h = K('h'), c = K('c');
      let E;
      if (dimEq(Q.d, DIMS.length)) E = h * c / Q.v;
      else if (dimEq(Q.d, DIMS.freq)) E = h * Q.v;
      else if (dimEq(Q.d, DIMS.energy)) E = Q.v;
      else if (dimEq(Q.d, DIMS.wavenumber)) E = h * c * Q.v;
      else throw new Error(`Give a wavelength, a frequency, an energy or a wavenumber, not ${dimName(Q.d)}.`);
      if (!(E > 0)) throw new Error('The value must be greater than 0.');
      const lam = h * c / E, nu = E / h;
      const band = lam < 1e-11 ? 'gamma ray' : lam < 1e-8 ? 'X-ray' : lam < 3.8e-7 ? 'ultraviolet' : lam < 7.5e-7 ? 'visible light' : lam < 1e-3 ? 'infrared' : lam < 1 ? 'microwave' : 'radio';
      const rows = [
        ['Wavelength λ', `${fmt(lam * 1e9, 10)} nm`, `${fmt(lam, 10)} m`], ['Frequency ν', `${fmt(nu / 1e12, 10)} THz`, `${fmt(nu, 10)} Hz`],
        ['Energy E', `${fmt(E / K('qe'), 10)} eV`, `${fmt(E, 10)} J`], ['Wavenumber ν̃', `${fmt(1 / lam / 100, 10)} cm⁻¹`],
        ['Momentum p = h/λ', `${fmt(h / lam, 8)} kg·m/s`], ['Molar energy', `${fmt(E * K('NA') / 1000, 8)} kJ/mol`], ['Band', band],
      ];
      return { rows, copy: rows.map(r => `${r[0]}\t${r[1]}`).join('\n') };
    },
    tex: ['E = h\\nu = \\frac{hc}{\\lambda} = hc\\,\\tilde\\nu,\\qquad p = \\frac{h}{\\lambda}'],
    how: 'The dimension of the input decides what it is: a length is a wavelength in vacuum, 1/time a frequency, an energy an energy, 1/length a wavenumber. h and c are exact in the SI.',
    refs: [PHYS_REF, 'ISO 21348:2007 (spectral band names, approximate limits).'],
  },

  blackbody: {
    inputs: [
      { k: 'T', label: 'Temperature', def: '5772 K' },
      { k: 'l1', label: 'Band from λ₁ (optional)', def: '380 nm' }, { k: 'l2', label: 'to λ₂', def: '750 nm' },
    ],
    examples: [{ label: 'tungsten lamp', v: { T: '2800 K' } }, { label: 'human skin', v: { T: '34 degC', l1: '8 µm', l2: '14 µm' } }, { label: 'CMB', v: { T: '2.7255 K', l1: '', l2: '' } }],
    run({ T, l1, l2 }) {
      const t = q(T, 'temp', 'T');
      if (!(t > 0)) throw new Error('T must be greater than 0 K.');
      const h = K('h'), c = K('c'), k = K('kB'), sigma = K('sigma'), b = K('b'), bnu = K('bnu');
      const B = (lam) => 2 * h * c * c / lam ** 5 / Math.expm1(h * c / (lam * k * t));
      const lp = b / t;
      const rows = [
        ['Peak wavelength (Wien)', `${fmt(lp * 1e9, 8)} nm`], ['Peak frequency', `${fmt(bnu * t / 1e12, 8)} THz`, 'the peak of B_ν is not at c/λ_peak'],
        ['Radiant exitance σT⁴', `${fmt(sigma * t ** 4, 8)} W/m²`], ['Spectral radiance at the peak', `${fmt(B(lp) * 1e-9, 8)} W·m⁻²·sr⁻¹·nm⁻¹`],
      ];
      if (!blank(l1) && !blank(l2)) {
        const a = q(l1, 'length', 'λ₁'), z = q(l2, 'length', 'λ₂');
        // Fraction of σT⁴ in [a, z]: π ∫ B dλ / σT⁴.
        const frac = Math.PI * integrate(B, Math.min(a, z), Math.max(a, z), { tol: 1e-12 }).value / (sigma * t ** 4);
        rows.push(['Fraction of the power in the band', `${fmt(100 * frac, 8)} %`]);
      }
      const ls = linspace(lp * 0.08, lp * 6, 400);
      const svg = plot([{ x: ls.map(x => x * 1e9), y: ls.map(x => B(x) * 1e-9) }], { xlabel: 'wavelength (nm)', ylabel: 'B_λ (W m⁻² sr⁻¹ nm⁻¹)', vlines: [{ x: lp * 1e9 }], title: `Planck spectrum at ${fmt(t, 6)} K` });
      return { rows, svg, copy: rows[0][1] };
    },
    tex: ['B_\\lambda(T) = \\frac{2hc^2}{\\lambda^5}\\,\\frac{1}{e^{hc/\\lambda k_\\mathrm{B} T} - 1}', '\\lambda_\\text{max} = \\frac{b}{T},\\quad \\nu_\\text{max} = b\'\\,T,\\quad M = \\sigma T^4 = \\pi\\int_0^\\infty B_\\lambda\\,d\\lambda'],
    how: 'Planck\'s law for an ideal black body. The Wien constants b and b′ and σ are exact CODATA values. The band fraction integrates B_λ by adaptive Gauss–Kronrod quadrature and divides by σT⁴/π.',
    refs: [PHYS_REF, 'M. Planck, Ann. Phys. 309, 553 (1901).'],
  },

  relativity: {
    inputs: [
      { k: 'kind', label: 'Input is', type: 'select', def: 'beta', opts: [['beta', 'β = v/c'], ['v', 'speed v'], ['gamma', 'Lorentz factor γ'], ['ke', 'kinetic energy (needs the mass)']] },
      { k: 'x', label: 'Value', def: '0.6' },
      { k: 'm', label: 'Rest mass (optional)', def: '1 $me', hint: 'kg, u, or a constant: $me, $mp' },
      { k: 't', label: 'Proper time or length (optional)', def: '1 s' },
    ],
    examples: [{ label: 'LHC proton 6.8 TeV', v: { kind: 'ke', x: '6.8 TeV', m: '1 $mp', t: '' } }, { label: 'muon at 0.998 c', v: { kind: 'beta', x: '0.998', m: '1 $mmu', t: '2.197 µs' } }],
    run({ kind, x, m, t }) {
      const c = K('c');
      let beta, gamma;
      const mass = blank(m) ? null : q(m, 'mass', 'The mass');
      if (kind === 'beta') beta = q(x, 'one', 'β');
      else if (kind === 'v') beta = q(x, 'speed', 'v') / c;
      else if (kind === 'gamma') { gamma = q(x, 'one', 'γ'); if (!(gamma >= 1)) throw new Error('γ must be 1 or more.'); beta = Math.sqrt(1 - 1 / (gamma * gamma)); }
      else {
        if (mass == null) throw new Error('A kinetic energy needs the rest mass.');
        const ke = q(x, 'energy', 'The kinetic energy');
        gamma = 1 + ke / (mass * c * c); beta = Math.sqrt(1 - 1 / (gamma * gamma));
      }
      if (!(beta >= 0 && beta < 1)) throw new Error('The speed must be from 0 to below c.');
      if (gamma == null) gamma = 1 / Math.sqrt((1 - beta) * (1 + beta));
      const rows = [['γ', fmt(gamma, 12)], ['β = v/c', fmt(beta, 12)], ['v', `${fmt(beta * c, 10)} m/s`], ['1 − β', fmt(kind === 'gamma' || kind === 'ke' ? 1 / (gamma * gamma * (1 + beta)) : 1 - beta, 8)], ['Rapidity artanh β', fmt(Math.atanh(beta), 10)]];
      if (!blank(t)) {
        const Q = qty(t);
        if (dimEq(Q.d, DIMS.time)) rows.push(['Dilated time γ τ', `${fmt(gamma * Q.v, 10)} s`]);
        else if (dimEq(Q.d, DIMS.length)) rows.push(['Contracted length L/γ', `${fmt(Q.v / gamma, 10)} m`]);
        else throw new Error('The last field takes a time or a length.');
      }
      if (mass != null) {
        const E0 = mass * c * c, eV = K('qe');
        rows.push(['Rest energy mc²', `${fmt(E0 / eV / 1e6, 10)} MeV`], ['Total energy γmc²', `${fmt(gamma * E0 / eV / 1e6, 10)} MeV`], ['Kinetic energy (γ − 1)mc²', `${fmt((gamma - 1) * E0 / eV / 1e6, 10)} MeV`], ['Momentum γmv', `${fmt(gamma * mass * beta * c / (eV * 1e6 / c), 10)} MeV/c`]);
      }
      return { rows, copy: rows[0][1] };
    },
    tex: ['\\gamma = \\frac{1}{\\sqrt{1-\\beta^2}},\\quad \\beta = \\frac vc', 'E = \\gamma mc^2,\\quad E_k = (\\gamma - 1)mc^2,\\quad p = \\gamma m v,\\quad E^2 = (pc)^2 + (mc^2)^2', '\\Delta t = \\gamma\\,\\Delta\\tau,\\qquad L = L_0/\\gamma'],
    how: 'Special relativity for one speed. γ is computed as 1/√((1−β)(1+β)) so it keeps precision near β = 1. With a mass, the energies and the momentum follow. Masses can be constants: $me, $mp, $mn, $mmu.',
    refs: [PHYS_REF, 'J. D. Jackson, Classical Electrodynamics, 3rd ed. (1999), ch. 11.'],
  },

  doppler: {
    inputs: [
      { k: 'mode', label: 'Kind', type: 'select', def: 'light', opts: [['light', 'Light (relativistic, along the line of sight)'], ['z', 'Redshift z ↔ speed'], ['sound', 'Sound in a medium']] },
      { k: 'v', label: 'Speed (+ = apart) or β', def: '0.1', hint: 'light: β or a speed; sound: source speed (+ = away)' },
      { k: 'f', label: 'Emitted frequency or wavelength', def: '656.28 nm' },
      { k: 'vo', label: 'Observer speed (sound, + = away)', def: '0 m/s' },
      { k: 'cs', label: 'Speed of sound', def: '343 m/s' },
      { k: 'z', label: 'Redshift z (for z ↔ speed)', def: '0.5' },
    ],
    examples: [{ label: 'ambulance passing', v: { mode: 'sound', v: '-25 m/s', f: '700 Hz' } }, { label: 'z = 2 quasar', v: { mode: 'z', z: '2' } }],
    run({ mode, v, f, vo, cs, z }) {
      const c = K('c');
      if (mode === 'z') {
        const Z = num(z);
        if (!(Z > -1)) throw new Error('z must be greater than −1.');
        const s = (1 + Z) ** 2, beta = (s - 1) / (s + 1);
        return { rows: [['β (relativistic, radial)', fmt(beta, 10)], ['v', `${fmt(beta * c / 1000, 10)} km/s`], ['Low-speed estimate cz', `${fmt(Z * c / 1000, 8)} km/s`, 'valid only for z ≪ 1'], ['1 + z', fmt(1 + Z, 10)]], copy: fmt(beta, 10) };
      }
      const F = qty(f);
      const isLen = dimEq(F.d, DIMS.length);
      if (!isLen && !dimEq(F.d, DIMS.freq)) throw new Error('Give a frequency or a wavelength.');
      if (mode === 'light') {
        const V = qty(v);
        const beta = dimEq(V.d, DIMS.one) ? V.v : dimEq(V.d, DIMS.speed) ? V.v / c : NaN;
        if (!(Math.abs(beta) < 1)) throw new Error('β must be between −1 and 1.');
        const k = Math.sqrt((1 + beta) / (1 - beta));
        const out = isLen ? F.v * k : F.v / k;
        const rows = [[isLen ? 'Observed wavelength' : 'Observed frequency', isLen ? `${fmt(out * 1e9, 10)} nm` : `${fmt(out, 10)} Hz`], ['Redshift z', fmt(k - 1, 10)], ['Factor √((1+β)/(1−β))', fmt(k, 10)]];
        return { rows, copy: rows[0][1] };
      }
      const C = q(cs, 'speed', 'The speed of sound'), Vs = q(v, 'speed', 'The source speed'), Vo = q(vo, 'speed', 'The observer speed');
      if (Math.abs(Vs) >= C) throw new Error('The source is at or above the speed of sound: there is a shock, not a Doppler shift.');
      const f0 = isLen ? C / F.v : F.v;
      const fo = f0 * (C - Vo) / (C + Vs);
      return { rows: [['Observed frequency', `${fmt(fo, 10)} Hz`], ['Ratio f′/f', fmt(fo / f0, 10)], ['Observed wavelength in the medium', `${fmt((C + Vs) / f0, 8)} m`]], copy: `${fmt(fo, 10)} Hz` };
    },
    tex: ['\\frac{\\lambda_\\text{obs}}{\\lambda_\\text{emit}} = 1 + z = \\sqrt{\\frac{1+\\beta}{1-\\beta}}', 'f\' = f\\,\\frac{c_s - v_o}{c_s + v_s}\\quad\\text{(sound, + = moving apart)}'],
    how: 'Light: the relativistic longitudinal Doppler shift, with β positive for a source moving away (redshift). Redshift to speed inverts it; this is a kinematic speed, not a cosmological recession speed. Sound: the classical formula in a still medium, with both speeds along the line between source and observer.',
    refs: [PHYS_REF, 'A. P. French, Special Relativity (1968), ch. 6.', 'D. Halliday, R. Resnick and J. Walker, Fundamentals of Physics, 10th ed., §17-7.'],
  },

  resistor: {
    inputs: [
      { k: 'mode', label: 'Direction', type: 'select', def: 'decode', opts: [['decode', 'Colours → value'], ['encode', 'Value → colours']] },
      { k: 'bands', label: 'Bands (decode)', def: 'yellow violet red gold', w: 2, hint: '4, 5 or 6 colour names, first band first' },
      { k: 'val', label: 'Value (encode)', def: '4.7k', hint: '4.7k, 220, 1M5' },
    ],
    examples: [{ label: '5 band 1 %', v: { mode: 'decode', bands: 'brown black black red brown' } }, { label: 'value to colours', v: { mode: 'encode', val: '68k' } }],
    run({ mode, bands, val }) {
      if (mode === 'decode') {
        const r = decodeBands(String(bands).split(/[\s,]+/).filter(Boolean));
        const rows = [['Resistance', `${engText(r.value, 'Ω')} ± ${r.tol} %`], ['Range', `${engText(r.value * (1 - r.tol / 100), 'Ω')} to ${engText(r.value * (1 + r.tol / 100), 'Ω')}`]];
        if (r.tempco) rows.push(['Temperature coefficient', `${r.tempco} ppm/K`]);
        return { rows, html: swatches(String(bands).split(/[\s,]+/).filter(Boolean).map(s => CBY[s.toLowerCase()][0])), copy: engText(r.value, 'Ω') };
      }
      const v = eng(val);
      const b4 = encodeBands(v, 2), b5 = encodeBands(v, 3);
      const rows = [['4 bands (5 %)', [...b4, 'gold'].join(' ')], ['5 bands (1 %)', [...b5, 'brown'].join(' ')], ['Nearest E12', engText(nearestE(v, E12), 'Ω')], ['Nearest E24', engText(nearestE(v, E24), 'Ω')], ['Nearest E96', engText(nearestE(v, E96), 'Ω')]];
      return { rows, html: swatches([...b4, 'gold']) + swatches([...b5, 'brown']), copy: rows[0][1] };
    },
    tex: ['R = (d_1 d_2 [d_3])_{10} \\times 10^{m}\\ \\Omega \\pm t\\,\\%'],
    how: 'Colours are read from the band nearest an end: two or three digit bands, a multiplier, then tolerance and, on six-band parts, the temperature coefficient. Gold and silver multiply by 0.1 and 0.01. The E-series are the IEC preferred values.',
    refs: ['IEC 60062:2016, Marking codes for resistors and capacitors.', 'IEC 60063:2015, Preferred number series for resistors and capacitors.'],
  },

  combine: {
    inputs: [
      { k: 'kind', label: 'Components', type: 'select', def: 'R', opts: [['R', 'Resistors (Ω)'], ['C', 'Capacitors (F)'], ['L', 'Inductors (H)']] },
      { k: 'v', label: 'Values', def: '100, 220, 470', w: 2, hint: '4.7k, 10u, 2M2 style; commas or spaces' },
    ],
    examples: [{ label: 'capacitors', v: { kind: 'C', v: '10u 22u 4.7u' } }, { label: 'two equal resistors', v: { kind: 'R', v: '1k 1k' } }],
    run({ kind, v }) {
      const xs = String(v).split(/[\s,;]+/).filter(Boolean).map(eng);
      if (!xs.length) throw new Error('Enter at least one value.');
      if (xs.some(x => !(x > 0))) throw new Error('Every value must be greater than 0.');
      const sum = xs.reduce((a, b) => a + b, 0), inv = 1 / xs.reduce((a, b) => a + 1 / b, 0);
      const unit = { R: 'Ω', C: 'F', L: 'H' }[kind];
      const series = kind === 'C' ? inv : sum, parallel = kind === 'C' ? sum : inv;
      const rows = [['Series', engText(series, unit)], ['Parallel', engText(parallel, unit)], ['Count', String(xs.length)]];
      if (kind === 'L') rows.push(['Note', 'Inductors are taken as uncoupled (no mutual inductance).']);
      return { rows, copy: rows[0][1] };
    },
    tex: ['R_s = \\sum R_i,\\quad \\frac1{R_p} = \\sum\\frac1{R_i}\\qquad (L \\text{ the same})', '\\frac1{C_s} = \\sum \\frac1{C_i},\\quad C_p = \\sum C_i'],
    how: 'Resistors and inductors add in series and add as reciprocals in parallel; capacitors do the opposite. Values take engineering suffixes (p, n, u, m, k, M, G) and the 4k7 notation.',
    refs: ['P. Horowitz and W. Hill, The Art of Electronics, 3rd ed. (2015), ch. 1.'],
  },

  rlc: {
    inputs: [
      { k: 'R', label: 'R', def: '100', hint: 'Ω; 4.7k style' }, { k: 'L', label: 'L', def: '10m', hint: 'H; 10m = 10 mH' }, { k: 'C', label: 'C', def: '1u', hint: 'F; 1u = 1 µF' },
    ],
    examples: [{ label: 'RC only', v: { R: '10k', L: '', C: '100n' } }, { label: 'RL only', v: { R: '50', L: '2m', C: '' } }, { label: 'high Q', v: { R: '1', L: '1m', C: '1n' } }],
    run({ R, L, C }) {
      const r = blank(R) ? null : eng(R), l = blank(L) ? null : eng(L), c = blank(C) ? null : eng(C);
      const rows = [];
      if (r != null && c != null) rows.push(['RC time constant τ = RC', `${engText(r * c, 's')}`, `cut-off f = 1/(2πRC) = ${engText(1 / (2 * Math.PI * r * c), 'Hz')}`]);
      if (r != null && l != null) rows.push(['RL time constant τ = L/R', `${engText(l / r, 's')}`, `cut-off f = R/(2πL) = ${engText(r / (2 * Math.PI * l), 'Hz')}`]);
      let svg;
      if (l != null && c != null) {
        const w0 = 1 / Math.sqrt(l * c), f0 = w0 / (2 * Math.PI);
        rows.push(['Resonant frequency f₀', engText(f0, 'Hz')], ['ω₀', `${fmt(w0, 8)} rad/s`], ['Characteristic impedance √(L/C)', engText(Math.sqrt(l / c), 'Ω')]);
        if (r != null) {
          const Qs = Math.sqrt(l / c) / r, zeta = 1 / (2 * Qs);
          rows.push(['Q (series RLC)', fmt(Qs, 6)], ['Q (parallel RLC)', fmt(1 / Qs, 6)], ['Damping ratio ζ (series)', fmt(zeta, 6), zeta < 1 ? 'underdamped' : zeta === 1 ? 'critically damped' : 'overdamped'], ['Bandwidth f₀/Q (series)', engText(f0 / Qs, 'Hz')]);
          const fs = linspace(Math.log10(f0) - 2, Math.log10(f0) + 2, 400);
          svg = plot([{ x: fs, y: fs.map(lf => { const w = 2 * Math.PI * 10 ** lf; return Math.hypot(r, w * l - 1 / (w * c)); }) }], { xlabel: 'log₁₀ f (Hz)', ylabel: '|Z| (Ω), log scale', logy: true, vlines: [{ x: Math.log10(f0) }], title: 'Series RLC impedance' });
        }
      }
      if (!rows.length) throw new Error('Give at least two of R, L and C.');
      return { rows, svg, copy: rows[0][1] };
    },
    tex: ['\\tau_{RC} = RC,\\quad \\tau_{RL} = \\frac LR,\\quad \\omega_0 = \\frac1{\\sqrt{LC}}', 'Q_\\text{series} = \\frac1R\\sqrt{\\frac LC},\\quad \\zeta = \\frac1{2Q},\\quad \\Delta f = \\frac{f_0}{Q}'],
    how: 'Ideal lumped components. The series Q is that of R, L and C in one loop; the parallel Q is its inverse for the same three parts in parallel. The plot is |Z| = √(R² + (ωL − 1/ωC)²) of the series circuit.',
    refs: ['P. Horowitz and W. Hill, The Art of Electronics, 3rd ed. (2015), §1.7.', 'IEEE Std 100, The Authoritative Dictionary of IEEE Standards Terms (Q factor).'],
  },

  optics: {
    inputs: [
      { k: 'mode', label: 'Element', type: 'select', def: 'lens', opts: [['lens', 'Thin lens'], ['mirror', 'Spherical mirror'], ['maker', "Lensmaker's equation"]] },
      { k: 'f', label: 'Focal length f (mirror: or R/2)', def: '10 cm' }, { k: 'do', label: 'Object distance dₒ', def: '30 cm' }, { k: 'di', label: 'Image distance dᵢ', def: '' },
      { k: 'n', label: 'Index n (lensmaker)', def: '1.5' }, { k: 'r1', label: 'R₁ (lensmaker)', def: '20 cm' }, { k: 'r2', label: 'R₂ (lensmaker)', def: '-20 cm' },
    ],
    examples: [{ label: 'magnifying glass', v: { mode: 'lens', f: '10 cm', do: '6 cm', di: '' } }, { label: 'concave mirror', v: { mode: 'mirror', f: '15 cm', do: '45 cm', di: '' } }, { label: 'biconvex lens', v: { mode: 'maker' } }],
    run({ mode, f, do: dO, di, n, r1, r2 }) {
      if (mode === 'maker') {
        const N = num(n), R1 = q(r1, 'length', 'R₁'), R2 = q(r2, 'length', 'R₂');
        const P = (N - 1) * (1 / R1 - 1 / R2);
        if (P === 0) throw new Error('These surfaces give no focusing power.');
        return { rows: [['Focal length f', `${fmt(100 / P, 8)} cm`, P > 0 ? 'converging' : 'diverging'], ['Optical power', `${fmt(P, 8)} D (dioptres)`]], copy: `${fmt(100 / P, 8)} cm` };
      }
      const vals = { f, do: dO, di };
      const empty = Object.keys(vals).filter(k => blank(vals[k]));
      if (empty.length !== 1) throw new Error('Leave exactly one of f, dₒ and dᵢ empty.');
      const v = {};
      for (const k of Object.keys(vals)) if (!blank(vals[k])) v[k] = q(vals[k], 'length', k);
      const x = empty[0];
      if (x === 'f') v.f = 1 / (1 / v.do + 1 / v.di);
      else if (x === 'do') v.do = 1 / (1 / v.f - 1 / v.di);
      else v.di = 1 / (1 / v.f - 1 / v.do);
      if (!Number.isFinite(v[x])) throw new Error('The image is at infinity (the object is at the focal point).');
      const m = -v.di / v.do;
      const real = v.di > 0;
      const rows = [[{ f: 'Focal length f', do: 'Object distance dₒ', di: 'Image distance dᵢ' }[x], `${fmt(v[x] * 100, 8)} cm`], ['Magnification m = −dᵢ/dₒ', fmt(m, 8)], ['Image', `${real ? 'real' : 'virtual'}, ${m < 0 ? 'inverted' : 'upright'}, ${Math.abs(m) > 1 ? 'enlarged' : Math.abs(m) < 1 ? 'reduced' : 'same size'}`, mode === 'mirror' ? (real ? 'in front of the mirror' : 'behind the mirror') : (real ? 'on the far side of the lens' : 'on the object side')], ['Power 1/f', `${fmt(1 / v.f, 8)} D`]];
      return { rows, copy: rows[0][1] };
    },
    tex: ['\\frac1f = \\frac1{d_o} + \\frac1{d_i},\\qquad m = -\\frac{d_i}{d_o}', '\\frac1f = (n-1)\\Big(\\frac1{R_1} - \\frac1{R_2}\\Big),\\qquad f_\\text{mirror} = \\frac R2'],
    how: 'Thin lenses and mirrors in the paraxial limit, with the "real is positive" sign convention: distances to real objects and images are positive, a converging lens or concave mirror has f > 0, and a virtual image has dᵢ < 0. In the lensmaker\'s equation, R is positive when the centre of curvature is on the outgoing side.',
    refs: ['E. Hecht, Optics, 5th ed. (2017), §5.2 and §5.4.'],
  },

  db: {
    inputs: [
      { k: 'mode', label: 'Convert', type: 'select', def: 'pr', opts: [['pr', 'Power ratio → dB'], ['ar', 'Amplitude ratio → dB'], ['dbp', 'dB → power and amplitude ratios'], ['w', 'Power → dBm, dBW'], ['dbm', 'dBm → power'], ['v', 'Voltage (RMS) → dBV, dBu'], ['dbv', 'dBV → voltage']] },
      { k: 'x', label: 'Value', def: '2' },
    ],
    examples: [{ label: '1 mW', v: { mode: 'w', x: '1 mW' } }, { label: '-3 dB', v: { mode: 'dbp', x: '-3' } }, { label: '0 dBu', v: { mode: 'v', x: '0.775 V' } }],
    run({ mode, x }) {
      const L = (r) => 10 * Math.log10(r);
      let rows;
      if (mode === 'pr' || mode === 'ar') {
        const r = num(x);
        if (!(r > 0)) throw new Error('A ratio must be greater than 0.');
        const dB = mode === 'pr' ? L(r) : 2 * L(r);
        rows = [['Level', `${fmt(dB, 10)} dB`], ['Nepers (amplitude)', `${fmt(dB * Math.LN10 / 20, 10)} Np`]];
      } else if (mode === 'dbp') {
        const d = num(x);
        rows = [['Power ratio', fmt(10 ** (d / 10), 10)], ['Amplitude ratio', fmt(10 ** (d / 20), 10)]];
      } else if (mode === 'w') {
        const P = q(x, 'power', 'The power');
        if (!(P > 0)) throw new Error('The power must be greater than 0.');
        rows = [['dBm', `${fmt(10 * Math.log10(P / 1e-3), 10)} dBm`], ['dBW', `${fmt(10 * Math.log10(P), 10)} dBW`]];
      } else if (mode === 'dbm') {
        const d = num(x);
        rows = [['Power', engText(1e-3 * 10 ** (d / 10), 'W')], ['dBW', `${fmt(d - 30, 10)} dBW`]];
      } else if (mode === 'v') {
        const V = qty(x);
        if (!dimEq(V.d, DIMS.volt)) throw new Error('Give a voltage, for example 0.775 V.');
        rows = [['dBV (re 1 V)', `${fmt(20 * Math.log10(V.v), 10)} dBV`], ['dBu (re 0.7746 V)', `${fmt(20 * Math.log10(V.v / Math.sqrt(0.6)), 10)} dBu`]];
      } else {
        const d = num(x);
        rows = [['Voltage (RMS)', engText(10 ** (d / 20), 'V')], ['dBu', `${fmt(d - 20 * Math.log10(Math.sqrt(0.6)), 10)} dBu`]];
      }
      return { rows, copy: rows[0][1] };
    },
    tex: ['L_P = 10\\log_{10}\\frac{P}{P_0}\\ \\mathrm{dB},\\qquad L_F = 20\\log_{10}\\frac{F}{F_0}\\ \\mathrm{dB}', 'P_0 = 1\\ \\mathrm{mW}\\ (\\mathrm{dBm}),\\quad V_0 = 1\\ \\mathrm{V}\\ (\\mathrm{dBV}),\\quad V_0 = \\sqrt{0.6}\\ \\mathrm{V}\\ (\\mathrm{dBu})'],
    how: 'A power ratio uses 10 log₁₀ and a field (amplitude) ratio uses 20 log₁₀, so a field ratio of 2 is 6.02 dB and a power ratio of 2 is 3.01 dB. dBu refers to √0.6 V, the voltage of 1 mW in 600 Ω.',
    refs: ['IEC 60027-3:2002, Logarithmic and related quantities, and their units.', 'ISO 80000-3:2019, Annex C (neper, bel).'],
  },
};

