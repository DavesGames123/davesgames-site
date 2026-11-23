// stellar.js: the stellar physics of the catalogue stars (pass3-fusion-stars.md 2, 3; spec 11.3). Pure, no GL.
// The builder (catalogue.js) gives each star a structure (mass, L, R, Teff, energy source), a variability
// class and a table of discrete modes. lightcurve.js sums the modes per frame. No noise and no random number
// in time: phases come from a Weyl sequence and a static hash of the star.
//
// Exports (grep -n "^export"):
//   MS (constants), lumOfMass(M), radiusOfMass(M), teffOfLR(L, R), massFromLogL(logL), massFromTeff(T),
//   burningOf(M), seismic(M, R, T, L), displayTau(tauTrue, timeBaseSec), displayDm(dmTrue, capMag),
//   LC_CLASS (code -> name), structureOf(star, h) -> structure, lightCurveOf(star, structure, opts) -> lc,
//   p2p95(lc, scale) -> 95 % peak-to-peak (mag) of the mode sum, idHash(id) -> [0, 1)
//
// Units: M, L, R in solar units; T in K; frequencies in Hz unless the name ends in Uhz; times in s.

import { hash3 } from './catalogue.js';   // circular import: used at call time only

export const MS = {
  teffSun: 5772, numaxSunUhz: 3090, dnuSunUhz: 135.1, kb95Ppm: 4.7, teffKb: 5777,
  qDays: 0.033, day: 86400,
  solarRedEdgeK: 6800, flareMaxK: 4400,
  timeBaseSec: 1.5, tauRefSec: 300, varCapMag: 0.60, dmFloorMag: 1e-4,   // varCapMag 0.60, not 0.30: see the note below
  burstA: 0.35, burstRiseSec: 0.6, burstDecaySec: 5.0, burstTeffK: 8000,
  cepheidTrueDays: [5.366, 35.56],     // delta Cep and l Car (2.10; open decision 21: the time law)
};

// Display cap (fusion-stars attempt 1, a deviation from 11.3 [I]): 0.30 mag p2p did not show. Catalogue star
// cores are clipped by the stretch, so only the halo and the spikes breathe, and a spike's visible length goes
// as sqrt(F). At 0.30 mag the spike tips moved by about 1 px (frames r1 of captures/pass3/fusion-stars-a1).
// 0.60 mag (x 1.74 in flux) keeps the log law and the order of all amplitudes, and the peak breath x 1.32 is
// still inside the 1.4 bound of SmStarBound.
export const LC_CLASS = ['quiet', 'solar-like', 'delta Scuti', 'SPB', 'beta Cephei', 'wind', 'accretion', 'Cepheid'];

// ---- Main-sequence relations, zero age, solar metal (2.1) [R forms; I coefficients] ----
export function lumOfMass(M) {
  if (M < 0.43) return 0.23 * Math.pow(M, 2.3);
  if (M < 2) return Math.pow(M, 4);
  if (M < 55) return 1.4 * Math.pow(M, 3.5);
  return 32000 * M;
}
export function radiusOfMass(M) { return M <= 1.66 ? Math.pow(M, 0.945) : 1.219 * Math.pow(M, 0.555); }
export function teffOfLR(L, R) { return MS.teffSun * Math.pow(L / (R * R), 0.25); }

function bisectLogM(f, target) {            // f(M) rises with M; 80 steps on log M in [0.08, 150]
  let lo = Math.log(0.08), hi = Math.log(150);
  for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (f(Math.exp(mid)) < target) lo = mid; else hi = mid; }
  return Math.exp(0.5 * (lo + hi));
}
export function massFromLogL(logL) { return bisectLogM((M) => Math.log10(lumOfMass(M)), logL); }
export function massFromTeff(T) { return bisectLogM((M) => teffOfLR(lumOfMass(M), radiusOfMass(M)), T); }

// Burning mode and envelope (2.2).
export function burningOf(M) {
  if (M < 0.08) return 'none';
  if (M < 0.35) return 'pp-full';      // pp chain, fully convective
  if (M < 1.3) return 'pp-env';        // pp chain, radiative core, convective envelope
  return 'cno';                        // CNO cycle, convective core, radiative envelope
}

// Solar-like scaling relations (2.4, 2.5) [R].
export function seismic(M, R, T, L) {
  const numaxUhz = MS.numaxSunUhz * M / (R * R) / Math.sqrt(T / MS.teffSun);
  const dnuUhz = MS.dnuSunUhz * Math.sqrt(M) / Math.pow(R, 1.5);
  const ampRel = MS.kb95Ppm * 1e-6 * (L / M) * Math.pow(T / MS.teffKb, -2);       // dL/L per radial mode
  const gammaUhz = 0.66 * Math.pow(numaxUhz, 0.88);
  const granPpm = 3382 * Math.pow(numaxUhz, -0.609);
  const b1Uhz = 0.317 * Math.pow(numaxUhz, 0.970), b2Uhz = 0.948 * Math.pow(numaxUhz, 0.992);
  return { numaxUhz, dnuUhz, ampRel, gammaUhz, granPpm, b1Uhz, b2Uhz };
}

// Display compression (3.1, 3.2).
export function displayTau(tauTrue, timeBaseSec = MS.timeBaseSec) { return timeBaseSec * Math.pow(tauTrue / MS.tauRefSec, 0.25); }
export function displayDm(dmTrue, capMag = MS.varCapMag) {
  if (!(dmTrue > MS.dmFloorMag)) return 0;
  return capMag * Math.min(1, Math.max(0, Math.log10(dmTrue / MS.dmFloorMag) / 4));
}

// Static hash of a star id in [0, 1) (FNV-1a 32 into the PCG3D Hash3). Not a time-domain random number.
export function idHash(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return hash3(h & 0xffff, h >>> 16, 331);
}

const LOG_UNI = (lo, hi, u) => lo * Math.pow(hi / lo, Math.min(1, Math.max(0, u)));

// ---- Structure (2.3) ----
// star: the builder entry { id, kind, teffK, logL?, jet? }. h: three static hash values in [0, 1).
export function structureOf(star, h) {
  const T = star.teffK;
  const s = { mass: null, lum: null, radius: null, teff: T, teffDerived: null, burning: 'none', stage: '', cls: 0 };
  const ms = (M) => {
    s.mass = M; s.lum = lumOfMass(M); s.radius = radiusOfMass(M);
    s.teffDerived = teffOfLR(s.lum, s.radius); s.burning = burningOf(M); s.stage = 'main sequence';
  };
  switch (star.kind) {
    case 5: ms(massFromTeff(T)); s.cls = 0; s.stage = 'seat (held constant)'; return s;
    case 4:
      s.burning = 'accretion'; s.stage = 'protostar';
      s.cls = star.jet ? 6 : 0; return s;
    case 6:
      s.mass = 5 + 2 * h[0]; s.lum = 2000 * (1 + h[1]); s.radius = Math.sqrt(s.lum) * Math.pow(MS.teffSun / T, 2);
      s.burning = 'core-He'; s.stage = 'classical Cepheid (supergiant)'; s.cls = 7; return s;
    case 2:
      ms(massFromLogL(star.logL ?? 5.5));
      s.burning = 'core-He'; s.stage = 'Wolf-Rayet (evolved, wind photosphere)'; s.cls = 5; return s;
    case 3: case 7: case 8:
      ms(massFromLogL(star.logL ?? 4));
      s.cls = hotClass(T, s.mass); return s;
    default: break;
  }
  // kind 0: spiked field star of the giant mix (2.3 bin table).
  if (T < 4900) {
    s.mass = 1.0 + 0.6 * h[0]; s.lum = LOG_UNI(50, 500, h[1]);
    s.radius = Math.sqrt(s.lum) * Math.pow(MS.teffSun / T, 2);
    s.burning = 'shell-H'; s.stage = 'red giant'; s.cls = 1;
  } else if (T < 6200) {
    s.mass = 1.2 + 0.8 * h[0]; s.lum = LOG_UNI(30, 80, h[1]);
    s.radius = Math.sqrt(s.lum) * Math.pow(MS.teffSun / T, 2);
    s.burning = 'core-He'; s.stage = 'clump giant'; s.cls = 1;
  } else if (T < 9000) {
    ms(massFromTeff(T));
    if (T > 6300 && T < 8600 && s.mass >= 1.5 && s.mass <= 2.5 && h[2] < 0.5) s.cls = 2;
    else s.cls = T < MS.solarRedEdgeK ? 1 : 0;
  } else {
    ms(massFromTeff(T));
    s.cls = hotClass(T, s.mass);
  }
  return s;
}

// Classes of hot main-sequence stars (2.3). Deviation [I]: the beta Cephei strip starts at 20 kK, not
// 22 kK, so that `rn` (B2 V, 21 kK) is in it, as the note's own class table says.
function hotClass(T, M) {
  if (T > 31000) return 5;
  if (T >= 20000 && M >= 8 && M <= 25) return 4;
  if (T > 11000 && T < 20000 && M >= 3 && M < 8) return 3;
  return 0;
}

// ---- Mode tables (2.4-2.10, 3) ----
const V2 = [1.00, 1.54, 0.62];
const PHI = 0.6180340;
const MAG = 2.5 / Math.LN10;                       // dm (mag) = 1.0857 dL/L for small dL/L

// Returns { cls, nu: [Hz display], amp: [mag display], phase: [rad], tauTrue, tauDisp, cStar, dmTrue, dmDisp,
//   burstPeriod, burstA, ... }. opts = { timeBaseSec, varCapMag, jetPeriodSec }.
export function lightCurveOf(star, st, opts) {
  opts = opts || {};
  const o = idHash(star.id)[0];
  const lc = { cls: st.cls, nu: [], amp: [], phase: [], tauTrue: 0, tauDisp: 0, cStar: 1, dmTrue: 0, dmDisp: 0,
               burstPeriod: 0, burstA: 0, numaxUhz: null, dnuUhz: null };
  const modes = [];                                 // [nuTrueHz, ampRel]
  let dmTrue = 0;
  const T = st.teff, M = st.mass, R = st.radius;
  switch (st.cls) {
    case 1: {
      const z = seismic(M, R, T, st.lum);
      lc.numaxUhz = z.numaxUhz; lc.dnuUhz = z.dnuUhz;
      const eps = z.dnuUhz > 50 ? 1.4 : 0.601 + 0.632 * Math.log10(z.dnuUhz);
      const D0 = (z.dnuUhz > 50 ? 0.067 : 0.122) * z.dnuUhz / 6;
      const sig = z.gammaUhz / 2.3548;
      const nMax = Math.round(z.numaxUhz / z.dnuUhz - eps);
      for (let n = Math.max(1, nMax - 2); n <= nMax + 2; n++) {
        for (let l = 0; l <= 2; l++) {
          const nu = z.dnuUhz * (n + l / 2 + eps) - l * (l + 1) * D0;
          modes.push([nu * 1e-6, z.ampRel * Math.sqrt(V2[l]) * Math.exp(-((nu - z.numaxUhz) ** 2) / (2 * sig * sig))]);
        }
      }
      // Granulation stand-in (2.5): three tones with Harvey weights, rms 0.5 min(1, a_gran / dL_osc) of the modes.
      const oscRms = Math.sqrt(modes.reduce((a, m) => a + m[1] * m[1] / 2, 0));
      const g = [[z.b1Uhz / 1.618, z.b1Uhz], [z.b1Uhz, z.b1Uhz], [z.b2Uhz, z.b2Uhz]].map(([nu, b]) => [nu, 1 / Math.sqrt(1 + (nu / b) ** 4)]);
      const gRms = Math.sqrt(g.reduce((a, m) => a + m[1] * m[1] / 2, 0));
      const want = 0.5 * Math.min(1, z.granPpm * 1e-6 / Math.max(oscRms, 1e-12)) * oscRms;
      for (const [nu, w] of g) modes.push([nu * 1e-6, w * want / gRms]);
      lc.tauTrue = 1 / (z.numaxUhz * 1e-6);
      dmTrue = -1;                                   // from the true mode sum, below
      break;
    }
    case 2: case 4: {
      const P0 = MS.qDays * MS.day / Math.sqrt(M / (R * R * R));
      const f0 = 1 / P0;
      const set = st.cls === 4
        ? [[1.0, 1.0], [0.9752, 0.35], [0.9781, 0.25], [0.9810, 0.40], [1.0834, 0.30], [1.2494, 0.10]]
        : [[1.0, 1.0], [1 / 0.773, 0.5], [1.11, 0.3], [1.19, 0.25], [1.37, 0.2]];
      for (const [r, a] of set) modes.push([f0 * r, a]);
      lc.tauTrue = P0; dmTrue = st.cls === 4 ? 0.02 : 0.005;
      break;
    }
    case 3: {
      const amps = [1, 0.8, 0.6, 0.45, 0.3];
      for (let k = 0; k < 5; k++) modes.push([1 / ((1.2 + 0.07 * k) * MS.day), amps[k]]);
      lc.tauTrue = 1.2 * MS.day; dmTrue = 0.003;
      break;
    }
    case 5: {
      const wr = star.kind === 2;
      const nuc = (wr ? 1.5 : 3) / MS.day;
      for (const r of [0.5, 1.0, 1.618]) modes.push([nuc * r, 1 / (1 + r * r)]);
      lc.tauTrue = 1 / nuc; dmTrue = wr ? 0.02 : 0.002;
      break;
    }
    case 6:
      lc.burstPeriod = opts.jetPeriodSec || 30; lc.burstA = MS.burstA;
      lc.tauDisp = lc.burstPeriod; lc.tauTrue = 0;
      return lc;
    case 7: {
      const P = (star.cepheidTrueDays || MS.cepheidTrueDays[0]) * MS.day;
      const A = [0.36, 0.13, 0.06], ph = [0, 4.1, 2.1];
      lc.tauTrue = P; dmTrue = -1;
      // dm = sum A_k cos(2 pi k t / P + phi_k); written as sin(... + phi_k + pi / 2). Amplitudes in mag here.
      for (let k = 0; k < 3; k++) modes.push([(k + 1) / P, A[k] / MAG, ph[k] + Math.PI / 2]);
      break;
    }
    default:
      return lc;
  }
  lc.tauDisp = displayTau(lc.tauTrue, opts.timeBaseSec);
  lc.cStar = lc.tauTrue / lc.tauDisp;
  modes.forEach((m, j) => {
    lc.nu.push(m[0] * lc.cStar);                    // tau_d = tau_true / C, so nu_d = nu_true C (note 3.1 writes / C: a typo)
    lc.amp.push(MAG * m[1]);                         // true amplitude in mag for now
    lc.phase.push(m.length > 2 ? m[2] + 2 * Math.PI * o : 2 * Math.PI * (((PHI * (j + 1) + o) % 1 + 1) % 1));
  });
  if (dmTrue < 0) dmTrue = p2p95(lc, 1);
  const shape = p2p95(lc, 1);
  lc.dmTrue = dmTrue;
  lc.dmDisp = displayDm(dmTrue, opts.varCapMag);
  const k = shape > 0 ? lc.dmDisp / shape : 0;
  for (let j = 0; j < lc.amp.length; j++) lc.amp[j] *= k;
  return lc;
}

// 95 % peak-to-peak (2.5 to 97.5 percentile) of the mode sum in mag, times scale. 3,000 samples over the
// first 600 display seconds, the window of check A5: the rotation-split triplet of beta Cephei beats over
// about 1,000 s, so a window of a few periods misses its beat. Deterministic.
export function p2p95(lc, scale) {
  const N = 3000, span = 600;
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * span / N;
    let s = 0;
    for (let j = 0; j < lc.nu.length; j++) s += lc.amp[j] * Math.sin(2 * Math.PI * lc.nu[j] * t + lc.phase[j]);
    v[i] = s;
  }
  v.sort();
  return (v[Math.floor(0.975 * N)] - v[Math.floor(0.025 * N)]) * (scale ?? 1);
}
