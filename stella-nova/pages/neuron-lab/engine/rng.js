// ============================================================================
//  NEURON LAB ENGINE  ·  rng.js  ·  seeded random numbers
// ----------------------------------------------------------------------------
//  mulberry32: a small 32-bit generator. The same seed gives the same
//  morphology, wiring and NetStim times on every machine.
//    "export function rng"     uniform [0, 1)
//    "export function gauss"   normal, Box-Muller
// ============================================================================
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(R) { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()); }
