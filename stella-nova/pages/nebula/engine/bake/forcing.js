// forcing.js: the turbulent driving modes of phase A (spec 2.5). CPU only, no GL.
// Owner: row A4. Unity twin: StarMapForcingModes.cs (row U4). Both must give the same mode table.
//
// Exports (grep -n "^export"):
//   pcg32(seed, seq = 54) -> rng          PCG32 (XSH RR 64/32), pcg32_srandom_r(seed, seq)
//   boxMuller(rng) -> number              one N(0, 1) value from two draws (cos branch only)
//   buildModes(comp, tier, rng?) -> Float32Array(768 * 4)
//   ouUpdate(modes, rng, dt, T)           Ornstein-Uhlenbeck step of every mode, in place
//   modeAt(modes, m) -> { k, amp, re, im }   read helper for tests and the dev page
//   forceAt(modes, x, y, z, forceAmp) -> [fx, fy, fz]   CPU sum, the same as the Force kernel
//   GOLDEN, selfTest() -> { pass, lines }  golden values shared with StarMapForcingModesTests
//
// ALGORITHM (the C# port must follow each step in this order):
//   1. rng = pcg32(comp.seed, 54). State and increment are unsigned 64-bit.
//   2. Mode m (0..255): direction on a Fibonacci sphere,
//        dz = 1 - (2 m + 1) / 256, r = sqrt(1 - dz^2), phi = m * pi (3 - sqrt 5),
//        dir = (r cos phi, r sin phi, dz).
//      Wavelength, log-uniform over [500, 1600] px by the golden-ratio sequence (no random draw):
//        u = frac((m + 0.5) * 0.6180339887498949), lambda = exp(ln 500 + u (ln 1600 - ln 500)).
//      k = (2 pi / lambda) dir in rad/px. Then kx = round(kx / k0) k0 with k0 = 2 pi / 5760
//      (round half away from zero), so every mode is periodic in x. |k| and lambda come again from
//      the rounded vector. ampRaw = exp(-((ln lambda - ln 900) / 0.5)^2).
//   3. Initial vectors, mode by mode: re = P(g), im = P(g), with g = (boxMuller x 3) in the order
//      re.x, re.y, re.z, im.x, im.y, im.z. P = zeta (I - k k^T / k^2) + (1 - zeta) k k^T / k^2.
//   4. Normalization: amp = ampRaw * a0 / sqrt(sum(ampRaw^2) * (2 zeta^2 + (1 - zeta)^2)),
//      a0 = sqrt(mach^3 / (L * ouT)), L = peakPx / pxPerL (in l). The space rms of |f| is then
//      forceAmp * a0 (in c_n / t_u). With mach 6, L 90 and ouT 7.5: a0 = 0.566.
//   5. ouUpdate: a = exp(-dt / T), b = sqrt(1 - a^2); re = a re + b P(g), im = a im + b P(g),
//      the same draw order as step 3, mode 0 first.
//   All math is in float64. The table is stored as float32.
//
// TABLE LAYOUT (768 texels of RGBA32F, one row): texel 3m = (kx, ky, kz, amp),
//   3m + 1 = (re.x, re.y, re.z, 0), 3m + 2 = (im.x, im.y, im.z, zeta).
// The Force kernel computes f(x) = forceAmp sum_m amp (re cos(k . x) - im sin(k . x)), x in px.

const MASK64 = 0xffffffffffffffffn;
const MUL = 6364136223846793005n;

export function pcg32(seed, seq = 54) {
  let state = 0n;
  const inc = ((BigInt(seq) << 1n) | 1n) & MASK64;
  const step = () => { state = (state * MUL + inc) & MASK64; };
  const rng = {
    nextU32() {
      const old = state;
      step();
      const xs = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
      const rot = Number(old >> 59n);
      return ((xs >>> rot) | (xs << ((32 - rot) & 31))) >>> 0;
    },
    // A snapshot of the stream, so that pass 2 (2.9) can start phase B from the same forcing.
    save() { return state; },
    load(s) { state = BigInt(s); },
  };
  step();
  state = (state + (BigInt(seed) & MASK64)) & MASK64;
  step();
  return rng;
}

export function boxMuller(rng) {
  const u1 = (rng.nextU32() + 0.5) / 4294967296;
  const u2 = (rng.nextU32() + 0.5) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// P g for the unit vector n = k / |k|: zeta (g - n (n . g)) + (1 - zeta) n (n . g).
function project(n, g, zeta) {
  const d = n[0] * g[0] + n[1] * g[1] + n[2] * g[2];
  return [zeta * (g[0] - n[0] * d) + (1 - zeta) * n[0] * d,
          zeta * (g[1] - n[1] * d) + (1 - zeta) * n[1] * d,
          zeta * (g[2] - n[2] * d) + (1 - zeta) * n[2] * d];
}

function gauss3(rng) { return [boxMuller(rng), boxMuller(rng), boxMuller(rng)]; }

function roundHalfAway(v) { return v < 0 ? -Math.round(-v) : Math.round(v); }

export function buildModes(comp, tier, rng) {
  const f = comp.forcing;
  const N = f.modes;
  if (N !== 256) throw new Error(`[forcing] the table holds 256 modes, composition asks for ${N}`);
  const r = rng || pcg32(comp.seed);
  const zeta = f.zeta;
  const W = 5760;   // CONTENT_W: the x period of the box in px (2.1)
  const k0 = 2 * Math.PI / W;
  const lnA = Math.log(f.lambdaPx[0]), lnB = Math.log(f.lambdaPx[1]), lnP = Math.log(f.peakPx);
  const ga = Math.PI * (3 - Math.sqrt(5));
  const ks = [], raw = [];
  for (let m = 0; m < N; m++) {
    const dz = 1 - (2 * m + 1) / N;
    const rr = Math.sqrt(Math.max(0, 1 - dz * dz));
    const phi = m * ga;
    const u = ((m + 0.5) * 0.6180339887498949) % 1;
    const lam = Math.exp(lnA + u * (lnB - lnA));
    const kk = 2 * Math.PI / lam;
    const k = [kk * rr * Math.cos(phi), kk * rr * Math.sin(phi), kk * dz];
    k[0] = roundHalfAway(k[0] / k0) * k0;
    const kl = Math.hypot(k[0], k[1], k[2]);
    const lam2 = 2 * Math.PI / kl;
    ks.push(k);
    raw.push(Math.exp(-Math.pow((Math.log(lam2) - lnP) / f.width, 2)));
  }
  let s2 = 0;
  for (const a of raw) s2 += a * a;
  const L = f.peakPx / comp.units.pxPerL;
  const a0 = Math.sqrt(Math.pow(f.mach, 3) / (L * f.ouT));
  const norm = a0 / Math.sqrt(s2 * (2 * zeta * zeta + (1 - zeta) * (1 - zeta)));
  const out = new Float32Array(768 * 4);
  for (let m = 0; m < N; m++) {
    const k = ks[m];
    const kl = Math.hypot(k[0], k[1], k[2]);
    const n = [k[0] / kl, k[1] / kl, k[2] / kl];
    const re = project(n, gauss3(r), zeta);
    const im = project(n, gauss3(r), zeta);
    const o = m * 12;
    out[o] = k[0]; out[o + 1] = k[1]; out[o + 2] = k[2]; out[o + 3] = raw[m] * norm;
    out[o + 4] = re[0]; out[o + 5] = re[1]; out[o + 6] = re[2]; out[o + 7] = 0;
    out[o + 8] = im[0]; out[o + 9] = im[1]; out[o + 10] = im[2]; out[o + 11] = zeta;
  }
  return out;
}

export function ouUpdate(modes, rng, dt, T) {
  const a = Math.exp(-dt / T);
  const b = Math.sqrt(Math.max(0, 1 - a * a));
  for (let m = 0; m < 256; m++) {
    const o = m * 12;
    const kl = Math.hypot(modes[o], modes[o + 1], modes[o + 2]);
    const n = [modes[o] / kl, modes[o + 1] / kl, modes[o + 2] / kl];
    const zeta = modes[o + 11];
    const gr = project(n, gauss3(rng), zeta);
    const gi = project(n, gauss3(rng), zeta);
    for (let c = 0; c < 3; c++) {
      modes[o + 4 + c] = a * modes[o + 4 + c] + b * gr[c];
      modes[o + 8 + c] = a * modes[o + 8 + c] + b * gi[c];
    }
  }
  return modes;
}

export function modeAt(modes, m) {
  const o = m * 12;
  return { k: [modes[o], modes[o + 1], modes[o + 2]], amp: modes[o + 3],
           re: [modes[o + 4], modes[o + 5], modes[o + 6]], im: [modes[o + 8], modes[o + 9], modes[o + 10]] };
}

export function forceAt(modes, x, y, z, forceAmp = 1) {
  const f = [0, 0, 0];
  for (let m = 0; m < 256; m++) {
    const o = m * 12;
    const ph = modes[o] * x + modes[o + 1] * y + modes[o + 2] * z;
    const c = Math.cos(ph), s = Math.sin(ph), a = modes[o + 3];
    for (let i = 0; i < 3; i++) f[i] += a * (modes[o + 4 + i] * c - modes[o + 8 + i] * s);
  }
  return [f[0] * forceAmp, f[1] * forceAmp, f[2] * forceAmp];
}

// Golden values. seed 20261119, stream 54. StarMapForcingModesTests asserts the same numbers.
// Reference: pcg32(42, 54) gives 0xa15c02b7, 0x7b47f409, 0xba1d3330 (the PCG demo values).
// u32: the first 6 outputs. gauss: the first 4 boxMuller values of a new stream.
// mode0, mode255: k (rad/px) and amp of buildModes(composition.json) with a new stream.
export const GOLDEN = {
  seed: 20261119,
  u32: [3043937808, 4265032642, 4116124021, 3860231146, 3478381543, 1194705463],
  gauss: [0.8290139848, 0.2346348002, -0.1143234362, -1.4658560630],
  mode0: { k: [0.001090831, 0.000000000, 0.008737962], amp: 0.047544081 },
  mode255: { k: [0.000000000, 0.000224301, -0.004355053], amp: 0.024324985 },
  kxStep: 2 * Math.PI / 5760,
};

export function selfTest(comp) {
  const lines = [];
  let pass = true;
  const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
  const r = pcg32(GOLDEN.seed);
  const u = []; for (let i = 0; i < 6; i++) u.push(r.nextU32());
  const okU = u.every((v, i) => v === GOLDEN.u32[i]);
  lines.push(`pcg32 u32 ${u.join(', ')} ${okU ? 'ok' : 'FAIL'}`); pass = pass && okU;
  const r2 = pcg32(GOLDEN.seed);
  const g = []; for (let i = 0; i < 4; i++) g.push(boxMuller(r2));
  const okG = g.every((v, i) => near(v, GOLDEN.gauss[i], 1e-9));
  lines.push(`boxMuller ${g.map((v) => v.toFixed(10)).join(', ')} ${okG ? 'ok' : 'FAIL'}`); pass = pass && okG;
  if (comp) {
    const modes = buildModes(comp, 'U');
    for (const [name, m] of [['mode0', 0], ['mode255', 255]]) {
      const md = modeAt(modes, m);
      const gd = GOLDEN[name];
      const ok = md.k.every((v, i) => near(v, gd.k[i], 1e-6)) && near(md.amp, gd.amp, 1e-6);
      lines.push(`${name} k ${md.k.map((v) => v.toFixed(9)).join(', ')} amp ${md.amp.toFixed(9)} ${ok ? 'ok' : 'FAIL'}`);
      pass = pass && ok;
    }
    let bad = 0;
    for (let m = 0; m < 256; m++) {
      const n = modes[m * 12] / GOLDEN.kxStep;
      if (Math.abs(n - Math.round(n)) > 1e-3 || Math.abs(n) > 12.5) bad++;
    }
    lines.push(`k_x quantized to 2 pi / 5760 with |n| <= 12: ${bad === 0 ? 'ok' : `FAIL (${bad} modes)`}`);
    pass = pass && bad === 0;
    // Seam: the force at x = 0 and x = 5760 must be the same.
    const fa = forceAt(modes, 0, 500, 900), fb = forceAt(modes, 5760, 500, 900);
    const seam = Math.hypot(fa[0] - fb[0], fa[1] - fb[1], fa[2] - fb[2]);
    lines.push(`force seam |f(0) - f(5760)| = ${seam.toExponential(2)} ${seam < 1e-4 ? 'ok' : 'FAIL'}`);
    pass = pass && seam < 1e-4;
  }
  return { pass, lines };
}
