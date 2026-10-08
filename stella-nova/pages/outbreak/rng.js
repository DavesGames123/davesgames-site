// ============================================================================
//  OUTBREAK  ·  rng.js — seeded random numbers (no DOM)
// ----------------------------------------------------------------------------
//  mulberry32, the same generator as the other Stella Nova savers. One
//  stream per consumer: the model, the director and the visuals each make
//  their own, so a visual draw never changes the epidemic of a seed.
//    makeRng(seed) -> { next() in [0, 1), int(n), pick(arr), shuffle(arr),
//                       poisson(mean), binom(n, p), state() }
//  seed: uint32; 0 becomes 1.
//
//  grep -n targets: "export function makeRng", "poisson", "binom"
// ============================================================================
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => { const u = 1 - next(), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  // Knuth below 30, a rounded normal above (the model uses draws only
  // while counts are small; large flows are taken at their mean)
  const poisson = m => {
    if (!(m > 0)) return 0;
    if (m < 30) { const L = Math.exp(-m); let k = 0, p = 1; do { k++; p *= next(); } while (p > L); return k - 1; }
    return Math.max(0, Math.round(m + Math.sqrt(m) * normal()));
  };
  const binom = (n, p) => {
    n = Math.floor(n); if (n <= 0 || !(p > 0)) return 0; if (p >= 1) return n;
    if (n < 40) { let k = 0; for (let i = 0; i < n; i++) if (next() < p) k++; return k; }
    const m = n * p;
    if (m < 30) return Math.min(n, poisson(m));
    if (n - m < 30) return n - Math.min(n, poisson(n - m));
    return Math.max(0, Math.min(n, Math.round(m + Math.sqrt(m * (1 - p)) * normal())));
  };
  return {
    next, normal, poisson, binom,
    int: n => Math.floor(next() * n),
    pick: a => a[Math.floor(next() * a.length)],
    shuffle: a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    state: () => s,
  };
}
