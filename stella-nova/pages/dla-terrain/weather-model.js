// ============================================================================
//  DLA TERRAIN  ·  weather-model.js — a small 2D atmosphere over the world
//  (package SKY). DOM-free ES module: sky-state.js runs it, in a module
//  worker (weather-worker.js) in the page and inline in node.
// ----------------------------------------------------------------------------
//  GRID   N x N cells (N = 64) over a square of side D centred on the world
//         (D = 2.2 x world size, 40 .. 140 km). Fixed step DT = 60 s of
//         weather time. Fields per cell:
//           q    water vapour g/kg of the low air (advected by the low wind)
//           hs   upwind ground height m: the height that the air came from
//                (advected by the low wind, relaxes to the ground over a
//                6 km fetch). h - hs is the orographic lift of the air.
//           c    cloud water 0 .. 1.6 (advected by the cloud-level wind)
//           r    precipitation 0 .. 1 (falls out of c and of cumulus)
//           cu   convective cloud 0 .. 1 (cumulus .. cumulonimbus)
//           cape convective energy 0 .. 1 (sun heating x instability)
//           an   anvil and blow-off cirrus 0 .. 1 (upper wind)
//           fog  valley fog 0 .. 1 (forms on clear calm nights in low ground)
//  WIND   the synoptic (upper) wind of the preset. The low wind backs by
//         25 deg and slows to 0.55 x (surface friction, northern hemisphere)
//         and the terrain steers it: on steep ground the part of the wind
//         across the contours is taken away (blocked flow goes round the
//         hills). Clouds move with the mid wind (the mean of the two).
//  CLOUD  A statistical cloud scheme: the lift of the air (orographic
//         h - hs, the large-scale lift of the preset, frontal lift at the
//         front line) less the lifting condensation level 125 (T - Td) m
//         gives the saturation excess E; cloud water relaxes to (E + 600) /
//         1000 (forms in 10 min, dries in 20 min, faster in lee descent).
//  RAIN   r relaxes to (c - 1.05) x 1.8 plus showers from deep cumulus. Rain
//         takes water out of q, so the air that crossed a range is drier:
//         the rain shadow comes from that and from the descent on the lee.
//  CONVECTION  the sun heats the land (more on slopes that face it) and
//         builds cape at a rate set by the instability of the preset. Cells
//         grow where cape is over the inhibition, the air is moist and a
//         fixed thermal seed field (hot spots) and lift help them; growth
//         feeds on itself, so cells are discrete. Deep cells (cu > 0.55)
//         are thunderstorms only when the instability is over 0.55; they
//         make anvils (an) that the upper wind carries off.
//  FRONTS A change of preset starts a front at the upwind edge. It moves
//         along the wind of the new air mass at its set speed (frontSpeed).
//         Behind the line the new preset forcing holds. A wetter air mass
//         sends its lift and cirrus ahead (cirrus, then a deck, then rain
//         at the line); a drier one clears behind the line. Each front adds
//         a band of lift at its line.
//  FOG    forms at night under a clear sky, in calm, moist air, most in
//         valleys (cold air pools); burns off after sunrise and in wind.
//  OUTPUT snapshot(): Float32Array N*N*12, per cell
//           A cover, type (0 deck .. 1 towers), top m (world y), precip
//           B storm, fog, base m (world y), cirrus
//           C fog top m (world y), low wind x, low wind z, freezing level m
//         and meta { t, minBase, maxTop, cells (storm cells) }.
//  IDEAS  the semi-Lagrangian advection follows pages/storm-globe/solver.js;
//         the time interpolation between snapshots follows the forecast
//         morph of pages/weather-map/render/fronts.js.
//
//  grep -n targets: "export const DT", "export const FORCING",
//  "export function frontSpeed", "export function terrainCells",
//  "export function createModel",
//  "function forcingAt", "function winds", "step(env)", "snapshot()",
//  "export function sampleSnap", "export function stormCells"
// ============================================================================

export const N = 64;
export const DT = 60;              // s of weather time per step
export const CH = 12;              // floats per cell in a snapshot
const LAPSE = 0.0065;              // K per m

// Preset forcing: the boundary and initial conditions of the model.
// rh relative humidity of the inflow, instab 0..1, lift m of large-scale
// ascent (negative = subsidence), wind m/s (low air), dir rad added to the
// world's prevailing direction, temp C offset, fogT fog tendency 0..1,
// cirrus 0..1, cape0 initial cape.
export const FORCING = Object.freeze({
  'clear':        { rh: 0.55, instab: 0.25, lift: -250, wind: 3,  dir: 0,     temp: 2,   fogT: 0, cirrus: 0.25, cape0: 0.0 },
  'fair':         { rh: 0.62, instab: 0.45, lift: -60,  wind: 4,  dir: 0,     temp: 1,   fogT: 0, cirrus: 0.35, cape0: 0.1 },
  'cloudy':       { rh: 0.74, instab: 0.40, lift: 450,  wind: 6,  dir: 0.1,   temp: 0,   fogT: 0, cirrus: 0.5,  cape0: 0.1 },
  'overcast':     { rh: 0.86, instab: 0.15, lift: 700,  wind: 6,  dir: 0.15,  temp: -2,  fogT: 0, cirrus: 0.2,  cape0: 0.0 },
  'fog':          { rh: 0.97, instab: 0.0,  lift: -150, wind: 1,  dir: 0,     temp: -3,  fogT: 1, cirrus: 0.0,  cape0: 0.0 },
  'drizzle':      { rh: 0.92, instab: 0.10, lift: 900,  wind: 5,  dir: 0.2,   temp: -3,  fogT: 0.2, cirrus: 0.1, cape0: 0.0 },
  'rain':         { rh: 0.93, instab: 0.35, lift: 1100, wind: 8,  dir: 0.25,  temp: -4,  fogT: 0, cirrus: 0.1,  cape0: 0.1 },
  'thunderstorm': { rh: 0.84, instab: 1.0,  lift: 120,  wind: 9,  dir: 0.35,  temp: -1,  fogT: 0, cirrus: 0.6,  cape0: 0.4 },
  'snow':         { rh: 0.90, instab: 0.15, lift: 1250,  wind: 4,  dir: -0.5,  temp: -14, fogT: 0, cirrus: 0.1,  cape0: 0.0 },
  'blizzard':     { rh: 0.92, instab: 0.20, lift: 1100,  wind: 15, dir: -0.6,  temp: -20, fogT: 0, cirrus: 0.0,  cape0: 0.0 },
  'golden-haze':  { rh: 0.55, instab: 0.30, lift: -150, wind: 2,  dir: 0,     temp: 3,   fogT: 0.1, cirrus: 0.6, cape0: 0.05 },
});
const FKEYS = ['rh', 'instab', 'lift', 'wind', 'dir', 'temp', 'fogT', 'cirrus', 'cape0'];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// smoothstep that also takes a > b (a falling edge)
const ss = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const qsat = (T, hAbove) => 3.8 * Math.exp(17.27 * T / (T + 237.3)) * Math.exp(hAbove / 8500);
const dewPoint = (q, hAbove) => { const a = Math.log(Math.max(q, 1e-4) / (3.8 * Math.exp(hAbove / 8500))); return 237.3 * a / (17.27 - a); };
function hash2(i, j, s) {
  let x = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// The speed of a front that brings preset id (m/s of weather time).
export function frontSpeed(id) {
  const f = FORCING[id] || FORCING.clear;
  return clamp(0.8 * upperSpeed(f.wind), 7, 16);
}
const upperSpeed = (w) => w * 1.3 + 2;
export function forcingFor(id, over) {
  const f = { ...(FORCING[id] || FORCING.clear) };
  if (over) {
    // the UI sliders of sky-state.js (cover, rain, storm, wind, temp) map
    // onto the forcing, so an override still drives the model
    if (typeof over.wind === 'number') f.wind = over.wind;
    if (typeof over.temp === 'number') f.temp = over.temp;
    if (typeof over.cover === 'number') { f.lift = -300 + over.cover * 1100; f.rh = Math.max(f.rh, 0.45 + 0.45 * over.cover); }
    if (typeof over.rain === 'number' && over.rain > 0) { f.lift = Math.max(f.lift, 800 + 400 * over.rain); f.rh = Math.max(f.rh, 0.9); }
    if (typeof over.storm === 'number') { f.instab = Math.max(f.instab, over.storm); f.cape0 = Math.max(f.cape0, over.storm * 0.6); }
  }
  return f;
}

// The model grid of a terrain: mean height per cell (n x n) over the domain,
// D = 2.2 x the world size (40 .. 140 km). Outside the world the edge height
// falls to sea level over 6 km. Cheap (a strided mean), so it runs on the
// main thread and only n x n floats go to the worker.
export function terrainCells(ter, n = N) {
  const ws = ter ? ter.worldSize : 16000;
  const D = clamp(ws * 2.2, 40000, 140000), x0 = -D / 2, cs = D / n;
  const sea = ter ? ter.seaLevel || 0 : 0;
  const tn = ter ? ter.n : 0, H = ter ? ter.height : null;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * cs, z = x0 + (j + 0.5) * cs;
    let hv = sea;
    if (H) {
      const half = cs / 2, ox = -ws / 2;
      const out = Math.max(Math.abs(x) - ws / 2, Math.abs(z) - ws / 2, 0);
      const xi = clamp(x, ox, -ox), zi = clamp(z, ox, -ox);
      const a0 = clamp(Math.floor((xi - half - ox) / ws * tn), 0, tn - 1), a1 = clamp(Math.ceil((xi + half - ox) / ws * tn), 0, tn - 1);
      const b0 = clamp(Math.floor((zi - half - ox) / ws * tn), 0, tn - 1), b1 = clamp(Math.ceil((zi + half - ox) / ws * tn), 0, tn - 1);
      const st = Math.max(1, Math.floor((a1 - a0) / 6));
      let s = 0, k = 0;
      for (let b = b0; b <= b1; b += st) for (let a = a0; a <= a1; a += st) { s += H[b * tn + a]; k++; }
      const hm = Math.max(s / Math.max(k, 1), sea);
      hv = sea + (hm - sea) * Math.exp(-out / 6000);
    }
    h[j * n + i] = hv;
  }
  return { h, D, sea, n };
}

export function createModel(opts = {}) {
  const n = opts.n || N, nn = n * n;
  const F = () => new Float32Array(nn);
  const m = {
    n, t: 0, seed: (opts.seed ?? 1) | 0,
    D: 40000, x0: -20000, cs: 40000 / n, sea: 0,
    prevail: opts.prevail ?? 0.0,      // world direction the wind blows toward, rad (0 = +x, east)
    base: forcingFor('fair'), baseId: 'fair', fronts: [],
    // terrain
    h: F(), hS: F(), hB: F(), hLow: F(), vi: F(), gx: F(), gz: F(), land: F(), seedF: F(),
    // state
    q: F(), hs: F(), c: F(), r: F(), cu: F(), cape: F(), an: F(), fog: F(), acc: F(),
    // per step
    f: Object.fromEntries(FKEYS.map((k) => [k, F()])), ul: [F(), F()], uu: [F(), F()], lift: F(), ciF: F(),
    tmp: F(), qbc: F(), Ts: F(), cover: F(), T0: F(),
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // thermal hot spots: value noise of about 3 cells
    const s = 3.2, fi = i / s, fj = j / s, i0 = Math.floor(fi), j0 = Math.floor(fj), u = fi - i0, v = fj - j0;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = hash2(i0, j0, m.seed), b = hash2(i0 + 1, j0, m.seed), c = hash2(i0, j0 + 1, m.seed), d = hash2(i0 + 1, j0 + 1, m.seed);
    m.seedF[j * n + i] = (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv;
  }

  // ── terrain ───────────────────────────────────────────────────────────────
  // ter = { height Float32Array (tn x tn, m), n, worldSize, seaLevel } or null
  // ter: { height, n, worldSize, seaLevel } or null; cells: terrainCells()
  m.setTerrain = (ter) => m.setCells(terrainCells(ter, n));
  m.setCells = (cells) => {
    m.D = cells.D; m.x0 = -m.D / 2; m.cs = m.D / n; m.sea = cells.sea;
    for (let k = 0; k < nn; k++) { m.h[k] = cells.h[k]; m.land[k] = cells.h[k] > m.sea + 2 ? 1 : 0; }
    const box = (src, dst, r) => {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        let s = 0, k = 0;
        for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) { s += src[clamp(j + b, 0, n - 1) * n + clamp(i + a, 0, n - 1)]; k++; }
        dst[j * n + i] = s / k;
      }
    };
    box(m.h, m.hS, 1);
    const big = F();
    box(m.h, big, Math.max(2, Math.round(2500 / m.cs)));
    // the ground under the cloud bases: smoothed over about 6 km, so a deck
    // is nearly level and the peaks stand up into it and through it
    box(m.h, m.hB, Math.max(3, Math.round(6000 / m.cs)));
    const rl = Math.max(1, Math.round(1800 / m.cs));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      m.vi[k] = clamp((big[k] - m.h[k]) / 300, 0, 1);
      let lo = 1e9;
      for (let b = -rl; b <= rl; b++) for (let a = -rl; a <= rl; a++) lo = Math.min(lo, m.h[clamp(j + b, 0, n - 1) * n + clamp(i + a, 0, n - 1)]);
      m.hLow[k] = Math.max(lo, m.sea);
      const iL = clamp(i - 1, 0, n - 1), iR = clamp(i + 1, 0, n - 1), jU = clamp(j - 1, 0, n - 1), jD = clamp(j + 1, 0, n - 1);
      m.gx[k] = (m.hS[j * n + iR] - m.hS[j * n + iL]) / ((iR - iL) * m.cs || 1);
      m.gz[k] = (m.hS[jD * n + i] - m.hS[jU * n + i]) / ((jD - jU) * m.cs || 1);
    }
  };
  m.setTerrain(null);

  // ── fronts and forcing ──────────────────────────────────────────────────
  // A new preset: a front from the upwind edge, or (reset) the new state
  // everywhere at once.
  m.setPreset = (id, over, reset) => {
    const P = forcingFor(id, over);
    if (reset) { m.base = P; m.baseId = id; m.fronts = []; return; }
    const last = m.fronts.length ? m.fronts[m.fronts.length - 1].P : m.base;
    if (FKEYS.every((k) => Math.abs(last[k] - P[k]) < 1e-6)) return;
    const dir = m.prevail + P.dir;
    m.fronts.push({ id, P, nx: Math.cos(dir), nz: Math.sin(dir), s: -0.75 * m.D, v: frontSpeed(id), t0: m.t });
  };
  m.frontPos = () => m.fronts.map((f) => ({ id: f.id, s: f.s, v: f.v, nx: f.nx, nz: f.nz }));

  // forcing for every cell: the base folded with the fronts
  function forcingAt() {
    const f = m.f, W = 3000, Llead = 0.45 * m.D, Lci = 0.7 * m.D, NK = FKEYS.length;
    const fa = FKEYS.map((key) => f[key]);
    const iLift = FKEYS.indexOf('lift'), iRh = FKEYS.indexOf('rh'), iCi = FKEYS.indexOf('cirrus'), iIns = FKEYS.indexOf('instab');
    for (let q = 0; q < NK; q++) fa[q].fill(m.base[FKEYS[q]]);
    m.lift.fill(0); m.ciF.fill(0);
    for (const fr of m.fronts) {
      const P = FKEYS.map((key) => fr.P[key]);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = m.x0 + (i + 0.5) * m.cs, z = m.x0 + (j + 0.5) * m.cs;
        const d = x * fr.nx + z * fr.nz - fr.s;              // m ahead of the line
        const phi = 1 - ss(-W, W, d);
        const wetter = P[iLift] + 900 * P[iRh] > fa[iLift][k] + 900 * fa[iRh][k];
        const phiL = wetter ? 1 - ss(-W, Llead, d) : phi;
        const phiC = P[iCi] > fa[iCi][k] ? 1 - ss(0, Lci, d) : phi;
        // the band of lift at the line (squall line / frontal rain band)
        const dRh = Math.abs(P[iRh] - fa[iRh][k]) + Math.abs(P[iIns] - fa[iIns][k]) * 0.5;
        const e = d / 3500;
        m.lift[k] += 450 * Math.min(dRh * 3, 1) * Math.exp(-e * e);
        for (let q = 0; q < NK; q++) {
          const u = q === iLift || q === iRh ? phiL : q === iCi ? phiC : phi;
          fa[q][k] += (P[q] - fa[q][k]) * u;
        }
      }
    }
  }

  // ── winds: low (backed, slowed, steered) and upper ───────────────────────
  function winds() {
    const f = m.f, BACK = 25 * Math.PI / 180, cb = Math.cos(BACK), sb = Math.sin(BACK);
    for (let k = 0; k < nn; k++) {
      const dir = m.prevail + f.dir[k];
      const U = upperSpeed(f.wind[k]);
      const ux = Math.cos(dir), uz = Math.sin(dir);
      m.uu[0][k] = ux * U; m.uu[1][k] = uz * U;
      // back by 25 deg: rotate counter-clockwise seen from above in the
      // (east, north) plane; north is -z
      const e = ux, no = -uz;
      const e2 = e * cb - no * sb, n2 = e * sb + no * cb;
      let lx = e2 * f.wind[k], lz = -n2 * f.wind[k];
      const g2 = m.gx[k] * m.gx[k] + m.gz[k] * m.gz[k], sl = Math.sqrt(g2);
      if (sl > 1e-4) {
        // blocked flow: take away the part across the contours
        const sp = Math.hypot(lx, lz);
        const block = ss(0.03, 0.25, sl) * (1 - ss(9, 20, sp)) * 0.75;
        const nx = m.gx[k] / sl, nz = m.gz[k] / sl, along = lx * nx + lz * nz;
        lx -= block * along * nx; lz -= block * along * nz;
        const sp2 = Math.hypot(lx, lz);
        if (sp2 > 1e-3) { const g = sp * (1 - 0.3 * block) / sp2; lx *= g; lz *= g; }
      }
      m.ul[0][k] = lx; m.ul[1][k] = lz;
    }
  }

  // bilinear sample of field a at world x, z. bc: a value for points out of
  // the domain (inflow), or null to clamp to the edge.
  function samp(a, x, z, bc) {
    const gx = (x - m.x0) / m.cs - 0.5, gz = (z - m.x0) / m.cs - 0.5;
    if (bc !== null && (gx < -0.5 || gz < -0.5 || gx > n - 0.5 || gz > n - 0.5)) return bc;
    const cx = clamp(gx, 0, n - 1), cz = clamp(gz, 0, n - 1);
    const i0 = Math.min(Math.floor(cx), n - 2), j0 = Math.min(Math.floor(cz), n - 2);
    const u = cx - i0, v = cz - j0, k = j0 * n + i0;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + n] * (1 - u) + a[k + n + 1] * u) * v;
  }
  // semi-Lagrangian advection of a by wind (wx, wz) scaled by k, over dt
  function advect(a, wx, wz, k, dt, bcArr, bcConst) {
    const out = m.tmp;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const c = j * n + i;
      const x = m.x0 + (i + 0.5) * m.cs - wx[c] * k * dt, z = m.x0 + (j + 0.5) * m.cs - wz[c] * k * dt;
      out[c] = samp(a, x, z, bcArr ? bcArr[c] : bcConst);
    }
    a.set(out);
  }

  // env = { sunX, sunY, sunZ, baseC (sea-level air C, no weather offset), diurnal -1..1 }
  m.step = (env, dtStep = DT) => {
    const dt = dtStep;
    m.t += dt;
    for (const fr of m.fronts) fr.s += fr.v * dt;
    // a front that has crossed the whole domain becomes the base
    while (m.fronts.length && m.fronts[0].s > 0.75 * m.D + 4000) { m.base = m.fronts[0].P; m.baseId = m.fronts[0].id; m.fronts.shift(); }
    forcingAt();
    winds();
    const f = m.f, sun = env.sunY;
    // temperatures and the inflow vapour
    for (let k = 0; k < nn; k++) {
      const T0 = env.baseC + env.diurnal * (0.8 + 4.2 * (1 - m.cover[k])) + f.temp[k];
      m.T0[k] = T0;
      // the inflow vapour follows the daily mean, not the hour: the
      // relative humidity falls in the afternoon and the bases rise
      m.qbc[k] = f.rh[k] * qsat(env.baseC + f.temp[k], 0);
    }
    // advection
    const mid = m.mid || (m.mid = [new Float32Array(nn), new Float32Array(nn)]);
    for (let k = 0; k < nn; k++) { mid[0][k] = 0.5 * (m.ul[0][k] + m.uu[0][k]); mid[1][k] = 0.5 * (m.ul[1][k] + m.uu[1][k]); }
    advect(m.q, m.ul[0], m.ul[1], 1, dt, m.qbc, 0);
    advect(m.hs, m.ul[0], m.ul[1], 1, dt, m.h, 0);
    // c, r, cape and fog flow in from the edge as they are there (zero
    // gradient); cells and anvils do not flow in
    advect(m.c, mid[0], mid[1], 1, dt, null, null);
    advect(m.r, mid[0], mid[1], 0.7, dt, null, null);
    advect(m.cu, mid[0], mid[1], 1, dt, null, 0);
    advect(m.cape, m.ul[0], m.ul[1], 1, dt, null, null);
    advect(m.an, m.uu[0], m.uu[1], 1, dt, null, 0);
    advect(m.fog, m.ul[0], m.ul[1], 0.15, dt, null, null);
    const night = 1 - ss(-0.05, 0.08, sun);
    const E600 = 1 - Math.exp(-dt / 600), E500 = 1 - Math.exp(-dt / 500), E1200 = 1 - Math.exp(-dt / 1200);
    const E300 = 1 - Math.exp(-dt / 300), ELand = 1 - Math.exp(-dt / 40000), ESea = 1 - Math.exp(-dt / 9000);
    // the mean convection round each cell (7 x 7): cells sink the air round
    // them
    // (compensating subsidence), so storms stay apart
    const nb = m.nb || (m.nb = new Float32Array(nn));
    const rowS = m.rowS || (m.rowS = new Float32Array(nn));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let s = 0;
      for (let a = -3; a <= 3; a++) { const ii = i + a; s += m.cu[j * n + (ii < 0 ? 0 : ii >= n ? n - 1 : ii)]; }
      rowS[j * n + i] = s;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let s = 0;
      for (let b = -3; b <= 3; b++) { const jj = j + b; s += rowS[(jj < 0 ? 0 : jj >= n ? n - 1 : jj) * n + i]; }
      nb[j * n + i] = s / 49;
    }
    for (let k = 0; k < nn; k++) {
      const h = m.h[k], above = h - m.sea, land = m.land[k];
      // the air came from height hs: its vapour falls off with that height
      const sp = Math.hypot(m.ul[0][k], m.ul[1][k]);
      m.hs[k] += (h - m.hs[k]) * (1 - Math.exp(-dt * Math.max(sp, 0.5) / 6000));
      // sea and wet ground give vapour back
      // (slow: a rain shadow lasts for the time the air needs to cross the land)
      const qTarget = land ? m.qbc[k] : Math.max(m.qbc[k], 0.9 * qsat(m.T0[k], 0));
      m.q[k] += (qTarget - m.q[k]) * (land ? ELand : ESea);
      const hsA = Math.max(m.hs[k] - m.sea, 0);
      const qAir = m.q[k] * Math.exp(-hsA / 2200);
      // valleys: cold pools on clear nights
      const pool = -4 * m.vi[k] * night * (1 - m.cover[k]);
      const Ts = m.T0[k] - LAPSE * hsA + pool;
      m.Ts[k] = Ts;
      const Td = dewPoint(qAir, hsA);
      const rh = qAir / qsat(Ts, hsA);
      const zLcl = 125 * Math.max(Ts - Td, 0);
      // decks live over the mixed layer: their condensation level follows
      // the daily mean temperature, not the hour (cumulus use zLcl)
      const zDeck = 125 * Math.max(Ts - (m.T0[k] - env.baseC - f.temp[k] > 0 ? m.T0[k] - (env.baseC + f.temp[k]) : 0) - Td, 0);
      // lift: orographic + large scale + frontal band
      const zeta = (h - m.hs[k]) + f.lift[k] + m.lift[k];
      const E = zeta - zDeck;
      const cEq = clamp((E + 600) / 1000, 0, 1.6);
      const descent = h - m.hs[k] < -80;
      m.c[k] += (cEq - m.c[k]) * (cEq > m.c[k] ? E600 : descent ? E500 : E1200);
      // convection
      const nx = -m.gx[k], nz = -m.gz[k], nl = Math.hypot(nx, 1, nz);
      const face = Math.max(0, (nx * env.sunX + env.sunY + nz * env.sunZ) / nl);
      const heat = land * face * (1 - 0.55 * m.cover[k]);
      const ins = f.instab[k];
      m.cape[k] += (heat * 1.6e-4 * (0.25 + ins) + ins * ins * 0.25e-4) * dt;
      m.cape[k] = Math.min(m.cape[k] - m.cape[k] * dt / (sun > 0 ? 28800 : 10800), 1.5);
      const cin = 0.12 + (1 - ins) * 0.45;
      const moist = ss(0.3, 0.6, rh);
      // only hot spots (the seed field) and lifted air set cells off
      const hot = ss(0.25, 0.7, m.seedF[k] + 0.3 * ss(0, 400, h - m.hs[k] + m.lift[k]));
      const sink = 1 - 0.8 * ss(0.05, 0.25, nb[k] - 0.5 * m.cu[k]);
      const trig = Math.max(m.cape[k] - cin, 0) * moist * hot * sink;
      const grow = trig * 5e-3 * (0.1 + m.cu[k]) * dt;
      // the depth a cell can reach is set by the instability
      const cuMax = 0.35 + 0.65 * ss(0.2, 0.7, ins);
      const g = Math.min(grow, Math.max(cuMax - m.cu[k], 0));
      m.cu[k] += g;
      m.cape[k] = Math.max(m.cape[k] - g * 0.9, 0);
      m.cu[k] -= m.cu[k] * dt / 2700;
      const storm = ss(0.55, 0.85, m.cu[k]) * ss(0.55, 0.8, ins);
      // anvils from storms, blown off by the upper wind
      m.an[k] = Math.min(1, m.an[k] + storm * dt / 500 - m.an[k] * dt / 2400);
      // precipitation: from the deck and from deep cumulus
      const rEq = Math.max(m.c[k] - 1.05, 0) * 1.8 + ss(0.45, 0.95, m.cu[k]) * (0.4 + 0.6 * storm);
      m.r[k] += (clamp(rEq, 0, 1) - m.r[k]) * E300;
      m.q[k] = Math.max(m.q[k] * (1 - m.r[k] * dt / 20000), 0.05);
      m.c[k] = Math.max(m.c[k] - m.r[k] * dt / 3600, 0);
      m.acc[k] += m.r[k] * dt;
      // valley fog
      const calm = 1 - ss(2, 6, sp);
      // fog relaxes to the level that the night allows here (forms in an
      // hour, thins slowly), the fog preset keeps it up everywhere
      const fogEq = Math.max(night * (1 - m.cover[k]) * calm * ss(0.45, 0.8, rh) * (0.1 + 0.9 * ss(0.02, 0.4, m.vi[k])) * land,
        f.fogT[k] * (0.7 + 0.3 * m.vi[k]));
      const burn = ss(0.0, 0.45, sun) * (1 - 0.85 * f.fogT[k]) / 2600 + ss(4, 10, sp) / 1200;
      m.fog[k] += (fogEq - m.fog[k]) * (1 - Math.exp(-dt / (fogEq > m.fog[k] ? 3600 : 5400)));
      m.fog[k] = clamp(m.fog[k] - m.fog[k] * burn * dt, 0, 1);
      // diagnostics for the cover of the next step
      const cs = ss(0.05, 1.0, m.c[k]), cc = 0.92 * ss(0.02, 0.4, m.cu[k]);
      m.cover[k] = 1 - (1 - cs) * (1 - cc);
      m.tmp[k] = zLcl;
    }
    (m.zLcl || (m.zLcl = new Float32Array(nn))).set(m.tmp);
  };

  // ── output ──────────────────────────────────────────────────────────────
  m.snapshot = (out) => {
    const o = out || new Float32Array(nn * CH);
    let minBase = 1e9, maxTop = -1e9;
    const zl = m.zLcl || m.tmp;
    for (let k = 0; k < nn; k++) {
      const cs = ss(0.05, 1.0, m.c[k]), cc = 0.92 * ss(0.02, 0.4, m.cu[k]);
      const cover = 1 - (1 - cs) * (1 - cc);
      const type = cc / Math.max(cs + cc, 1e-3);
      const ground = Math.max(m.hB[k], m.sea);
      const base = ground + clamp(zl[k], 250, 2600);
      const ins = m.f.instab[k];
      const dS = 450 + 1600 * Math.min(m.c[k], 1.4);
      const dC = 350 + 10500 * Math.pow(m.cu[k], 1.6) * (0.25 + 0.75 * ins);
      const top = base + dS * (1 - type) + dC * type;
      const storm = ss(0.55, 0.85, m.cu[k]) * ss(0.55, 0.8, ins);
      const fz = m.h[k] + m.Ts[k] / LAPSE;
      const o0 = k * CH;
      o[o0] = cover; o[o0 + 1] = type; o[o0 + 2] = top; o[o0 + 3] = clamp(m.r[k], 0, 1);
      o[o0 + 4] = storm; o[o0 + 5] = m.fog[k]; o[o0 + 6] = base; o[o0 + 7] = clamp(m.ciF[k] + m.f.cirrus[k] + m.an[k], 0, 1);
      o[o0 + 8] = m.hLow[k] + 25 + 260 * m.fog[k] + 300 * m.f.fogT[k] * m.fog[k];
      o[o0 + 9] = m.ul[0][k]; o[o0 + 10] = m.ul[1][k]; o[o0 + 11] = fz;
      if (cover > 0.02) { minBase = Math.min(minBase, base); maxTop = Math.max(maxTop, top); }
    }
    if (minBase > maxTop) { minBase = m.sea + 1500; maxTop = minBase + 600; }
    return { t: m.t, data: o, minBase, maxTop, n, D: m.D, x0: m.x0, cells: stormCells(o, n, m.x0, m.D / n) };
  };

  // the state, to move a model to a worker
  const STATE = ['q', 'hs', 'c', 'r', 'cu', 'cape', 'an', 'fog', 'acc', 'cover'];
  m.getState = () => ({ t: m.t, base: m.base, baseId: m.baseId, fronts: m.fronts.map((f) => ({ ...f })), prevail: m.prevail, fields: Object.fromEntries(STATE.map((k) => [k, m[k].slice()])), zLcl: m.zLcl ? m.zLcl.slice() : null, Ts: m.Ts.slice(), f: Object.fromEntries(FKEYS.map((k) => [k, m.f[k].slice()])), ul: m.ul.map((a) => a.slice()), ciF: m.ciF.slice() });
  m.setState = (s) => {
    m.t = s.t; m.base = s.base; m.baseId = s.baseId; m.fronts = s.fronts.map((f) => ({ ...f })); m.prevail = s.prevail;
    for (const k of STATE) m[k].set(s.fields[k]);
    if (s.zLcl) m.zLcl = Float32Array.from(s.zLcl);
    m.Ts.set(s.Ts); for (const k of FKEYS) m.f[k].set(s.f[k]); m.ul[0].set(s.ul[0]); m.ul[1].set(s.ul[1]); m.ciF.set(s.ciF);
  };

  // A fresh state for the base forcing: vapour at the inflow value, the
  // cape of the preset, then a spin-up. env: one env (run `steps` steps
  // with it) or an array of envs, one per step (render the hours before
  // now, so an afternoon starts with its cumulus grown from the morning).
  m.init = (env, steps = 90) => {
    const list = Array.isArray(env) ? env : null;
    const e0 = list ? list[0] : env;
    forcingAt();
    for (let k = 0; k < nn; k++) {
      const T0 = e0.baseC + m.f.temp[k];
      m.q[k] = m.f.rh[k] * qsat(T0, 0);
      m.hs[k] = m.h[k]; m.c[k] = 0; m.r[k] = 0; m.cu[k] = m.f.cape0[k] * 0.5 * m.seedF[k]; m.cape[k] = m.f.cape0[k];
      m.an[k] = 0; m.fog[k] = m.f.fogT[k] * 0.8; m.acc[k] = 0; m.cover[k] = 0.5;
    }
    // spin-up steps of 3 DT: the model is stable at that step (semi-
    // Lagrangian advection, relaxations by exp), and it is 3 x cheaper
    const t0 = m.t, n2 = list ? list.length : steps;
    for (let i = 0; i < n2; i++) m.step(list ? list[i] : env, 3 * DT);
    m.t = t0;
    m.acc.fill(0);
  };
  return m;
}

// Storm cells: local maxima of the storm field over 0.3 (x, z world m, s).
export function stormCells(o, n, x0, cs) {
  const out = [];
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const s = o[(j * n + i) * CH + 4];
    if (s < 0.3) continue;
    let max = true;
    for (let b = -1; b <= 1 && max; b++) for (let a = -1; a <= 1; a++) {
      if ((a || b) && o[((j + b) * n + i + a) * CH + 4] > s) { max = false; break; }
    }
    if (max) out.push({ x: x0 + (i + 0.5) * cs, z: x0 + (j + 0.5) * cs, s });
  }
  return out;
}

// Bilinear sample of a snapshot at world x, z: an array of CH floats.
export function sampleSnap(snap, x, z, out = new Float32Array(CH)) {
  const n = snap.n, cs = snap.D / n;
  const gx = clamp((x - snap.x0) / cs - 0.5, 0, n - 1), gz = clamp((z - snap.x0) / cs - 0.5, 0, n - 1);
  const i0 = Math.min(Math.floor(gx), n - 2), j0 = Math.min(Math.floor(gz), n - 2);
  const u = gx - i0, v = gz - j0, d = snap.data;
  const k00 = (j0 * n + i0) * CH, k10 = k00 + CH, k01 = k00 + n * CH, k11 = k01 + CH;
  for (let c = 0; c < CH; c++) out[c] = (d[k00 + c] * (1 - u) + d[k10 + c] * u) * (1 - v) + (d[k01 + c] * (1 - u) + d[k11 + c] * u) * v;
  return out;
}
