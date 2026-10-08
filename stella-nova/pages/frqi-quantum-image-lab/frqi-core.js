// ============================================================================
//  FRQI CORE  ·  frqi-core.js — pure FRQI maths and animation timing (no DOM)
// ----------------------------------------------------------------------------
//  main.js and tests.mjs import this module. It holds no state and touches no
//  DOM, so node can run every function.
//
//  FRQI state for an image of N pixels (basis order as in main.js: the color
//  qubit is the high half, so index i is |0⟩|i⟩ and N+i is |1⟩|i⟩):
//      |φ⟩ = (1/√N) Σᵢ (cos θᵢ|0⟩ + sin θᵢ|1⟩) ⊗ |i⟩ ,  θᵢ = (pixelᵢ/255)·π/2
//  A measurement gives |c⟩|i⟩ with P = |amp|²/N. For each pixel, the |1⟩ share
//  of its two counts estimates P₁(i) = sin²θᵢ, and arcsin√P₁ gives θᵢ back.
//
//  RUN TIMELINE (one Sample press, times in ms)
//      0 ─ sampleMs ──────────▶ shots drawn at shotsAt() (sine ease)
//      sampleMs ─ +flightMs ──▶ each pixel cell flies from the register tape
//                               to its (row, col) cell, start staggered by i
//      runMs() = sampleMs + flightMs  ≤ TARGET_MS on the page
//
//  grep -n targets
//      encode ........... "export function encodeFRQI"
//      probabilities .... "export function stateProbs"
//      decode ........... "export function decodeP1"
//      counts → image ... "export function reconstruct"
//      sampler .......... "export function buildCdf"
//      shot schedule .... "export function shotsAt"
//      register tape .... "export function tapeCols"
//      flight ........... "export function flightWindow"
//      saver plan ....... "export function saverPlan"
//      phone profile .... "export function glPixelRatio", "export function reconTypeScale"
// ============================================================================

export const HALF_PI = Math.PI / 2;
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// Pixel intensity 0..255 to the FRQI angle θ in [0, π/2].
export const thetaOf = v => (v / 255) * HALF_PI;

// Encode a grayscale image: per pixel, a0 = cos θ (|0⟩) and a1 = sin θ (|1⟩).
// The 1/√N factor is left out here; stateProbs applies it.
export function encodeFRQI(img) {
  const n = img.length, a0 = new Float64Array(n), a1 = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = thetaOf(img[i]); a0[i] = Math.cos(t); a1[i] = Math.sin(t); }
  return { a0, a1 };
}

// Outcome probabilities of the 2N basis states from real a0, a1 per pixel:
// P(|0⟩|i⟩) = a0ᵢ²/N at index i, P(|1⟩|i⟩) = a1ᵢ²/N at index N+i. The sum is
// normalised to 1, so a state with phase-only changes keeps its numbers.
export function stateProbs(a0, a1) {
  const n = a0.length, p = new Float64Array(2 * n);
  let s = 0;
  for (let i = 0; i < n; i++) { p[i] = a0[i] * a0[i]; p[n + i] = a1[i] * a1[i]; s += p[i] + p[n + i]; }
  if (s > 0) for (let k = 0; k < 2 * n; k++) p[k] /= s;
  return p;
}

// P₁ back to intensity. 'frqi' inverts sin²θ exactly; 'linear' uses P₁ as
// brightness.
export function decodeP1(p, mode = 'frqi') {
  p = clamp01(p);
  return mode === 'linear' ? p * 255 : (Math.asin(Math.sqrt(p)) / HALF_PI) * 255;
}

// Turn 2N outcome counts (or probabilities) into an image: per pixel the |1⟩
// share of its pair, decoded. per holds the total weight of each pixel.
export function reconstruct(counts, n, mode = 'frqi') {
  const vest = new Float32Array(n), per = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c0 = counts[i], c1 = counts[n + i], t = c0 + c1;
    vest[i] = decodeP1(t > 0 ? c1 / t : 0, mode); per[i] = t;
  }
  return { vest, per };
}

// Cumulative distribution for the sampler.
export function buildCdf(probs) {
  const c = new Float64Array(probs.length);
  let a = 0;
  for (let i = 0; i < probs.length; i++) { a += probs[i]; c[i] = a; }
  return c;
}
// Draw one outcome for a uniform u in [0,1) by binary search on the CDF.
// It never returns an index with zero probability.
export function sampleCdf(cdf, u) {
  const top = cdf[cdf.length - 1]; u *= top;
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (u < cdf[m]) hi = m; else lo = m + 1; }
  return lo;
}

// Page timing. Sample time comes from the Time slider (seconds); the flight
// follows it. TARGET_MS is the ceiling for a full run at the default slider.
export const PAGE_SAMPLE_MS = 1200, PAGE_FLIGHT_MS = 1300, TARGET_MS = 3000;
export const runMs = (sampleMs, flightMs) => sampleMs + flightMs;

// Shots drawn by time t of a run of length T: a sine ease, so the first and
// the last shots come slowly and the middle fast. Monotone, and equal to
// shots at t >= T.
export function shotsAt(t, T, shots) {
  if (T <= 0 || t >= T) return shots;
  if (t <= 0) return 0;
  return Math.min(shots, Math.floor(shots * (0.5 - 0.5 * Math.cos(Math.PI * t / T))));
}

// The register tape: the N measured pixels in index order |i⟩, wrapped into
// lines of tapeCols cells. The wrap is not the image width (except at 2×2),
// so the flight to the grid is a real rearrangement.
export function tapeCols(n, cols) {
  if (n <= 16) return n;
  return Math.min(n, cols * 4);
}

export const easeInOutCubic = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// Flight window of pixel i in [0, flightMs]: starts are staggered by index
// across STAGGER of the window, and every flight lasts the rest.
export const STAGGER = 0.5;
export function flightWindow(i, n, flightMs) {
  const t0 = (n > 1 ? i / (n - 1) : 0) * STAGGER * flightMs;
  return { t0, t1: t0 + (1 - STAGGER) * flightMs };
}
// Progress 0..1 of pixel i at flight time tf (ms since the flight began).
export function flightU(i, n, flightMs, tf) {
  const w = flightWindow(i, n, flightMs);
  return clamp01((tf - w.t0) / (w.t1 - w.t0));
}

// Position and size of a flying cell at raw progress u: eased, on a
// quadratic arc that bows up by LIFT of the distance. from/to = {x, y, s}.
export const LIFT = 0.22;
export function flightPos(u, from, to) {
  const e = easeInOutCubic(clamp01(u)), dx = to.x - from.x, dy = to.y - from.y;
  const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2 - LIFT * Math.hypot(dx, dy);
  const a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, c = e * e;
  return { x: a * from.x + b * cx + c * to.x, y: a * from.y + b * cy + c * to.y, s: from.s + (to.s - from.s) * e };
}

// Screensaver plan for one image with `layers` circuit slabs. calm 0..1
// (1 slowest). finishMs is the time from the image fade-in to a finished
// reconstruction: build + hold + sample + flight.
export const SAVER_TARGET_MS = 9000;
export function saverPlan(calm, layers) {
  calm = clamp01(calm);
  const steps = Math.max(1, layers - 1);
  const stepMs = Math.max(90, Math.min(500, (2200 + 1800 * calm) / steps));
  const buildMs = stepMs * steps, holdMs = 350 + 250 * calm;
  const sampleMs = 1000 + 600 * calm, flightMs = 1200 + 800 * calm;
  return { stepMs, buildMs, holdMs, sampleMs, flightMs, finishMs: buildMs + holdMs + sampleMs + flightMs };
}

// The pixel ratio of the 3D stack. A touch screen draws at most 1.5x,
// because the bloom chain runs at the full canvas size. A desktop keeps 2x.
export function glPixelRatio(dpr, coarse) { return Math.min(dpr || 1, coarse ? 1.5 : 2); }

// The type scale of the reconstruction panel at a width of W CSS px. Below
// 520 px (a phone) the 9 px titles and tape label become 12 px.
export const RECON_PHONE_W = 520;
export function reconTypeScale(W) { return W < RECON_PHONE_W ? 4 / 3 : 1; }
