// lightcurve.js: the per-frame light curves of the catalogue stars (pass3-fusion-stars.md 5.2; spec 11.3).
// Pure, no GL. The Unity twin is StarMapLightCurves.cs (not built in this pass).
//
// Exports (grep -n "^export"):
//   starColourJs(T)                         the StarColour of nebula-math.hlsli, from the same 64-entry table
//   prepareLightCurves(cat, order) -> list  one record per star in draw order (order = depth permutation)
//   starVarRow(list, t, animate, out)       fills out (Float32Array(256 * 4)) with (F_r, F_g, F_b, F_lum)
//
// t: display seconds. animate false: every star is quiescent, so the row is constant and the frames repeat.
// The light of star i: F0 (m colQ + f colF), m = 10^(-0.4 dm), dm = sum a_j sin(2 pi nu_j t + phi_j),
// f = the accretion burst of class 6 (2.9). The 4th channel is the luminance flux F0 (m + f).

import { STAR_COLOUR_TABLE as SC } from '../shaders/star-colour-table.js';
import { MS } from './stellar.js';

const TWO_PI = 2 * Math.PI;
const LUMA = [0.2126, 0.7152, 0.0722];

export function starColourJs(T) {
  const f = Math.min(1, Math.max(0, (Math.log10(Math.max(T, 1)) - SC.logTMin) / (SC.logTMax - SC.logTMin))) * (SC.count - 1);
  const i0 = Math.min(Math.floor(f), SC.count - 2), w = f - i0;
  const a = SC.rgb[i0], b = SC.rgb[i0 + 1];
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}
const luma = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

// Burst colour (2.9): the hot accretion spot (8000 K), reddened by the own A_V of the protostar, scaled to
// the luma of the quiescent colour. Reddening exp(-0.921 A_V (0.55 / lambda)^1.7), lambda (0.61, 0.53,
// 0.46) um for the display channels [I].
function burstColour(colQ, ownAv) {
  const c = starColourJs(MS.burstTeffK);
  const lam = [0.61, 0.53, 0.46];
  const r = c.map((v, k) => v * Math.exp(-0.921 * (ownAv || 0) * Math.pow(0.55 / lam[k], 1.7)));
  const k = luma(colQ) / Math.max(1e-9, luma(r));
  return r.map((v) => v * k);
}

// cat: the buildCatalogue result (cat.lc in packed order, cat.stars packed). order[i] = packed index of
// the star drawn at slot i (the depth sort of compositor.js).
export function prepareLightCurves(cat, order) {
  const out = [];
  if (!cat || !cat.lc) return out;
  for (let i = 0; i < cat.starCount; i++) {
    const src = order ? order[i] : i;
    const lc = cat.lc[src];
    const F0 = cat.stars[8 * src + 3], T = cat.stars[8 * src + 4];
    const colQ = starColourJs(T);
    out.push({
      F0, colQ, colF: lc.cls === 6 ? burstColour(colQ, lc.ownAv) : [0, 0, 0],
      nu: Float64Array.from(lc.nu), amp: Float64Array.from(lc.amp), phase: Float64Array.from(lc.phase),
      burstPeriod: lc.burstPeriod, burstA: lc.burstA,
    });
  }
  return out;
}

export function starVarRow(list, t, animate, out) {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let dm = 0, f = 0;
    if (animate) {
      for (let j = 0; j < s.nu.length; j++) dm += s.amp[j] * Math.sin(TWO_PI * s.nu[j] * t + s.phase[j]);
      if (s.burstPeriod > 0) {
        const tau = t - s.burstPeriod * Math.floor(t / s.burstPeriod);
        f = s.burstA * (1 - Math.exp(-tau / MS.burstRiseSec)) * Math.exp(-tau / MS.burstDecaySec);
      }
    }
    const m = Math.pow(10, -0.4 * dm);
    const q = s.colQ, c = s.colF;
    out[4 * i + 0] = s.F0 * (m * q[0] + f * c[0]);
    out[4 * i + 1] = s.F0 * (m * q[1] + f * c[1]);
    out[4 * i + 2] = s.F0 * (m * q[2] + f * c[2]);
    out[4 * i + 3] = s.F0 * (m + f);
  }
  for (let i = 4 * list.length; i < out.length; i++) out[i] = 0;
  return out;
}
