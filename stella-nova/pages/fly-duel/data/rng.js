// ============================================================================
//  FLY DUEL  ·  seeded random numbers  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  All randomness on the page comes from this file, so a seed gives the same
//  game, the same wiring and the same training run on every machine.
//  mulberry32 is a small 32-bit generator. It is not for cryptography.
//
//  EXPORTS   (jump with grep -n "<anchor>" data/rng.js)
//      mulberry32 ..... "export function mulberry32"  seed -> () => [0,1)
//      rngNext ........ "export function rngNext"     pure step on a state
//      hashSeed ....... "export function hashSeed"    string -> uint32
//      shuffle ........ "export function shuffle"     Fisher-Yates, new array
//      randInt ........ "export function randInt"     integer in [0, n)
// ============================================================================

// One mulberry32 step. The state is a uint32. Returns [value, nextState].
export function rngNext(state) {
  const a = (state + 0x6D2B79F5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

// Closure form. Each call gives the next float in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit hash with a final avalanche mix. Same string, same seed.
export function hashSeed(str) {
  let h = 0x811C9DC5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Integer in [0, n).
export function randInt(rng, n) { return Math.floor(rng() * n); }

// Fisher-Yates shuffle. Returns a new array. The input array does not change.
export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
