// ============================================================================
//  PLANET FORGE  ·  erode.js — river and talus erosion on the height map (no DOM)
// ----------------------------------------------------------------------------
//  Noise alone makes mountains with no drainage: every slope is the same
//  fBm. Real ranges are cut by valley networks that join downhill. This
//  pass runs on the whole equirect height map in finish (maps.js), after
//  the stripes are joined, so the workers' split stays bit-exact.
//
//  1. DRAINAGE (Barnes et al. 2014, priority-flood + epsilon). Seeds: the
//     sea, or on a dry world the lowest 0.3 % of cells (basins). A heap
//     floods the map upward; each cell drains to the cell that reached it
//     (8 neighbours, the column wraps at the date line, the row above row
//     0 is row 0 shifted W/2 across the pole). The order is the flood order.
//  2. AREA  A = upstream area in km^2 (cell areas shrink as cos(lat)).
//  3. VALLEYS: each channel is cut to a depth that grows with log(A)
//     (0.8 km for the trunk rivers at erosion.flow 1), downstream first, so
//     no river runs uphill to its outlet. The sides come from a blur of the
//     cut (V-shaped valleys). The cut material runs down the drainage to
//     the sea or basin that drains it and is laid there (up to the sea
//     level; the rest is spread over all seed cells), so the map loses no
//     mass (tests.mjs checks the budget). This is a stand-in for many
//     steps of the stream-power law, which needs geologic time to show.
//  4. TALUS: where a slope is steeper than the angle of repose, half the
//     excess moves downhill (mass-conserving, two sweeps).
//  Out: the eroded height (same 0..1 scale, clamped to the input range),
//  flow (log upstream area, 0..1) and slope (km/km) per texel. maps.js
//  uses them for rivers, snow on gentle slopes and bare rock on cliffs.
//  Maps wider than 2048 erode at 2048 and add the upsampled change.
//  The drainage tree also goes out at the erosion width (rec: the texel
//  each texel drains to, flowE: its flow, ew: the width), so maps.js can
//  draw channels as joined segments at any map width.
//
//  grep -n targets: "export function erode", "function flood",
//  "function carve", "function blurWrap", "function talus", "class Heap"
// ============================================================================

const MAXW = 2048;
const N4 = [1, 3, 4, 6];   // the edge neighbours in neighbours() order

class Heap {
  constructor(n) { this.k = new Float64Array(n); this.v = new Int32Array(n); this.n = 0; }
  push(key, val) {
    let i = this.n++; const k = this.k, v = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], n = --this.n, key = k[n], val = v[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= key) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = key; v[i] = val;
    return top;
  }
}

// The 8 neighbours of texel i with the wrap and pole rules; writes into nb.
function neighbours(i, W, H, nb) {
  const x = i % W, y = (i - x) / W;
  let c = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    let yy = y + dy, xx = x + dx;
    if (yy < 0) { yy = 0; xx += W / 2; } else if (yy >= H) { yy = H - 1; xx += W / 2; }
    xx = ((xx % W) + W) % W;
    nb[c++] = yy * W + xx;
  }
}

// The same 8 neighbours, with a fast path off the pole rows (no wrap
// arithmetic past the date line). Same order and the same indices as
// neighbours(), so the results stay bit-exact.
function neighboursFast(i, W, H, nb) {
  const x = i % W, y = (i - x) / W;
  if (y === 0 || y === H - 1) { neighbours(i, W, H, nb); return; }
  const b = i - x, xm = x ? x - 1 : W - 1, xp = x + 1 < W ? x + 1 : 0;
  nb[0] = b - W + xm; nb[1] = b - W + x; nb[2] = b - W + xp;
  nb[3] = b + xm; nb[4] = b + xp;
  nb[5] = b + W + xm; nb[6] = b + W + x; nb[7] = b + W + xp;
}

// The 8 neighbour distances of a texel in row y (off the pole rows they
// depend only on the row). Values come from dist(), so they are bit-exact.
function rowDists(y, W, H, R, out, nb) {
  const i = y * W + 1;
  neighbours(i, W, H, nb);
  for (let q = 0; q < 8; q++) out[q] = dist(i, nb[q], W, H, R);
}

// Distance (km) between texels i and j (small steps on the sphere).
function dist(i, j, W, H, R) {
  const xi = i % W, yi = (i - xi) / W, xj = j % W, yj = (j - xj) / W;
  let dx = Math.abs(xi - xj); dx = Math.min(dx, W - dx);
  const lat = Math.PI * (0.5 - (yi + yj + 1) / (2 * H));
  const ex = dx * 2 * Math.PI * R * Math.max(Math.cos(lat), 0.02) / W, ny = Math.abs(yi - yj) * Math.PI * R / H;
  return Math.max(Math.hypot(ex, ny), 1e-3);
}

function flood(h, W, H, sea) {
  const n = W * H, rec = new Int32Array(n).fill(-1), order = new Int32Array(n), done = new Uint8Array(n), hf = new Float64Array(h);
  const heap = new Heap(n + 8 * W);
  let seeds = 0;
  if (sea != null) { for (let i = 0; i < n; i++) if (h[i] <= sea) { heap.push(h[i], i); done[i] = 1; seeds++; } }
  if (!seeds) {
    // dry: the lowest 0.3 % of cells are the basins
    const s = Float32Array.from(h).sort(), cut = s[Math.floor(n * 0.003)];
    for (let i = 0; i < n; i++) if (h[i] <= cut) { heap.push(h[i], i); done[i] = 1; }
  }
  const nb = new Int32Array(8);
  let k = 0;
  while (heap.n) {
    const c = heap.pop(); order[k++] = c;
    neighboursFast(c, W, H, nb);
    for (let q = 0; q < 8; q++) {
      const j = nb[q]; if (done[j]) continue;
      done[j] = 1; rec[j] = c;
      hf[j] = Math.max(hf[j], hf[c] + 1e-9);
      heap.push(hf[j], j);
    }
  }
  return { rec, order: order.subarray(0, k) };
}

// Valley carving. Each channel is cut to a depth that grows with the log
// of its upstream area (target dT), downstream first, so a river never runs
// uphill to its outlet. The valley sides come from a blur of the cut
// (delta = min(cut, 1.6 blur(cut))): deep at the channel, sloping out.
// All cut material runs down the drainage to its seed (sea, basin) and is
// laid there up to the sea level; the rest is spread over all seed cells.
function carve(hk, W, H, rec, order, area, A, depthKm, seaKm) {
  const n = W * H, hc = Float64Array.from(hk);
  let amax = 1;
  for (let i = 0; i < n; i++) amax = Math.max(amax, A[i] / area[i]);
  const l0 = Math.log(8), l1 = Math.max(Math.log(amax) * 0.8, l0 + 1);
  for (let t = 0; t < order.length; t++) {
    const i = order[t], r = rec[i];
    if (r < 0) continue;
    const l = Math.log(A[i] / area[i]);
    const dT = depthKm * Math.min(1, Math.max(0, (l - l0) / (l1 - l0)));
    hc[i] = Math.min(hk[i], Math.max(hk[i] - dT, hc[r] + 1e-6));
  }
  const C = new Float64Array(n);
  for (let i = 0; i < n; i++) C[i] = hc[i] - hk[i];
  const B = blurWrap(C, W, H, 2);
  const q = new Float64Array(n);
  let cut = 0;
  for (let i = 0; i < n; i++) {
    if (rec[i] < 0) continue;
    const d = Math.min(C[i], 1.6 * B[i], 0);
    hk[i] += d; q[i] -= d * area[i]; cut -= d * area[i];
  }
  for (let t = order.length - 1; t >= 0; t--) { const i = order[t]; if (rec[i] >= 0) q[rec[i]] += q[i]; }
  let left = 0, seedA = 0;
  for (let i = 0; i < n; i++) if (rec[i] < 0) {
    seedA += area[i];
    const room = seaKm == null ? Infinity : Math.max(seaKm - 0.01 - hk[i], 0);
    const dz = Math.min(q[i] / area[i], room);
    hk[i] += dz; left += q[i] - dz * area[i];
  }
  if (left > 0) for (let i = 0; i < n; i++) if (rec[i] < 0) hk[i] += left / seedA;
  return cut;
}

// 5 x 5 box blur, x wraps, y clamps (twice: a soft tent).
function blurWrap(src, W, H, r) {
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float64Array(W * H), o = new Float64Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -r; k <= r; k++) s += a[y * W + (x + k + W) % W]; t[y * W + x] = s / (2 * r + 1); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[Math.min(H - 1, Math.max(0, y + k)) * W + x]; o[y * W + x] = s / (2 * r + 1); }
    a = o;
  }
  return a;
}

// The distances come from a per-row table (rowDists) off the pole rows,
// and from dist() on them; the sweep order is unchanged (bit-exact).
function talus(hk, W, H, R, area, tanMax, sweeps) {
  const nb = new Int32Array(8), n = W * H, D = new Float64Array(8), tmp = new Int32Array(8);
  for (let s = 0; s < sweeps; s++) for (let y = 0; y < H; y++) {
    const pole = y === 0 || y === H - 1;
    if (!pole) rowDists(y, W, H, R, D, tmp);
    for (let i = y * W, e = i + W; i < e; i++) {
      neighboursFast(i, W, H, nb);
      if (pole) for (let q = 0; q < 8; q++) D[q] = dist(i, nb[q], W, H, R);
      let lo = -1, best = 0, d = 0;
      for (let q = 0; q < 8; q++) { const j = nb[q], g = (hk[i] - hk[j]) / D[q] - tanMax; if (g > best) { best = g; lo = j; d = D[q]; } }
      if (lo < 0) continue;
      // move volume v so the slope comes back half way to tanMax
      const dz = 0.25 * best * d, v = dz * Math.min(area[i], area[lo]);
      hk[i] -= v / area[i]; hk[lo] += v / area[lo];
    }
  }
}

// h: Float32Array 0..1 (W x H), opts = { reliefKm, radiusKm, sea (0..1 or null),
// flow (valley depth scale), talus (0..1) }. Returns { height, flow, slope, cut, net,
// rec, flowE, ew } (the last three at the erosion width).
export function erode(h, W, H, o) {
  if (W > MAXW) {
    const f = W / MAXW, w = MAXW, hh = w / 2, small = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += h[(y * f + j) * W + x * f + i]; small[y * w + x] = s / (f * f); }
    const r = erode(small, w, hh, o), out = new Float32Array(W * H), flow = new Float32Array(W * H), slope = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) / f - 0.5, sy = Math.min(hh - 1, Math.max(0, (y + 0.5) / f - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, y1 = Math.min(hh - 1, y0 + 1);
      const X0 = ((x0 % w) + w) % w, X1 = (X0 + 1) % w;
      const g = a => (a[y0 * w + X0] * (1 - fx) + a[y0 * w + X1] * fx) * (1 - fy) + (a[y1 * w + X0] * (1 - fx) + a[y1 * w + X1] * fx) * fy;
      const i = y * W + x;
      out[i] = h[i] + g(r.delta); flow[i] = g(r.flow); slope[i] = g(r.slope);
    }
    return { height: out, flow, slope, cut: r.cut, net: r.net, rec: r.rec, flowE: r.flowE, ew: r.ew };
  }
  const n = W * H, R = o.radiusKm, km = Math.max(o.reliefKm, 1e-3);
  let lo = 1, hi = 0;
  for (let i = 0; i < h.length; i++) { const v = h[i]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const hk = new Float64Array(n);
  for (let i = 0; i < n; i++) hk[i] = h[i] * km;
  const area = new Float64Array(n), cellA = 2 * Math.PI * R / W * (Math.PI * R / H);
  for (let y = 0; y < H; y++) { const a = cellA * Math.max(Math.sin((y + 0.5) / H * Math.PI), 0.02); for (let x = 0; x < W; x++) area[y * W + x] = a; }
  const vol = () => { let s = 0; for (let i = 0; i < n; i++) s += hk[i] * area[i]; return s; };
  const vol0 = vol();
  const { rec, order } = flood(h, W, H, o.sea);
  const A = Float64Array.from(area);
  for (let t = order.length - 1; t >= 0; t--) { const i = order[t]; if (rec[i] >= 0) A[rec[i]] += A[i]; }
  // valley depth: 0.8 km for the trunk rivers at flow 1
  const cut = (o.flow ?? 1) > 0 ? carve(hk, W, H, rec, order, area, A, 0.8 * o.flow * Math.min(1, km / 8), o.sea == null ? null : o.sea * km) : 0;
  if ((o.talus ?? 0) > 0) talus(hk, W, H, R, area, 0.7 - 0.45 * o.talus, 2);
  const vol1 = vol();
  const out = new Float32Array(n), delta = new Float32Array(n), flow = new Float32Array(n), slope = new Float32Array(n);
  let Amax = 1; for (let i = 0; i < n; i++) Amax = Math.max(Amax, A[i]);
  const amax = Math.log(Amax / cellA + 1);
  const nb = new Int32Array(8), D = new Float64Array(8), tmp = new Int32Array(8);
  for (let y = 0; y < H; y++) {
    const pole = y === 0 || y === H - 1;
    if (!pole) rowDists(y, W, H, R, D, tmp);
    for (let i = y * W, e = i + W; i < e; i++) {
      out[i] = Math.min(hi, Math.max(lo, hk[i] / km)); delta[i] = out[i] - h[i];
      flow[i] = Math.log(A[i] / area[i] + 1) / amax;
      neighboursFast(i, W, H, nb);
      if (pole) for (let q = 0; q < 8; q++) D[q] = dist(i, nb[q], W, H, R);
      let s = 0; for (let k = 0; k < 4; k++) { const q = N4[k]; s = Math.max(s, Math.abs(hk[i] - hk[nb[q]]) / D[q]); }
      slope[i] = s;
    }
  }
  return { height: out, delta, flow, slope, cut, net: vol1 - vol0, rec, flowE: flow, ew: W };
}
