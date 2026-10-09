// ============================================================================
//  PLANET FORGE  ·  maps.js — from a planet recipe to PBR maps (no DOM)
// ----------------------------------------------------------------------------
//  Pass 1, sampleRows: every texel of a 2:1 equirect map gets its unit
//  vector (noise.js texelDir) and the generator's sample. Rows are
//  independent, so the page splits them across workers (pool.js).
//  Pass 2, finish: river and talus erosion (erode.js) on rocky worlds,
//  then rivers, snow by slope and cliff rock in the colour maps (lava
//  rivers come from channels: capsules round the drainage segments), then the
//  tangent-space normal map and the ambient occlusion (lava seas also get
//  a soft halo round the hot lava, function halo). All of these need
//  the whole height field.
//
//  MAPS (id: format, meaning)
//    albedo      RGB8 sRGB    base colour
//    height      gray16       0..1 over the planet's height range (JSON has km)
//    normal      RGB8         tangent space, OpenGL (+Y = north, +X = east)
//    normalObj   RGB8         object space (planet frame, +Y = north pole)
//    roughness   gray8        perceptual roughness
//    metallic    gray8        0 everywhere here (bare rock, ice, water, gas)
//    specular    gray8        F0 = 0.08 s (UE convention: 0.5 is F0 0.04,
//                             water 0.25, ice 0.23); the sea and ice mask
//    ao          gray8        cavity occlusion from the height field
//    orm         RGB8         packed AO, roughness, metallic (glTF order)
//    emissive    RGB8 sRGB    lava, vents, thermal glow, city lights
//    nightMask   gray8        1 where the emission is city light (night only)
//    clouds      RGBA8        white (cloud colour) with alpha = cover
//    flow        RGB8         gas giants: zonal wind, meridional wind, band
//    rings       RGBA8        1024 x 64 strip, inner -> outer (if rings on)
//
//  NORMALS  central differences on the sphere: east-west distance
//  2 dphi cos(lat) R, north-south 2 dtheta R; the column wraps at the date
//  line, and the row above row 0 is row 0 shifted by W/2 (across the
//  pole). So the map has no seam at the date line and no spike at a pole.
//  n = normalize(-bump dh/de, -bump dh/dn, 1).
//
//  AO  for three radii (2, 8, 24 texels at the equator) the height is box
//  blurred (the horizontal radius grows as 1/cos(lat), wrapping at the
//  date line); a texel below its blurred neighbourhood is occluded by the
//  slope (blur - h) / distance. ao = 1 - 0.55 * mean(occlusion).
//
//  grep -n targets: "export const MAP_INFO", "export function prepare",
//  "export function sampleRows", "export function finish", "export function channels", "function normals",
//  "function ambient", "function halo", "export function generate", "export function mapImage",
//  "export function hashMaps", "export function shrinkMaps"
// ============================================================================
import { prepareRocky, lavaColour } from './rocky.js';
import { prepareGas, ringProfile } from './gas.js';
import { texelDir, texelFrame, clamp, smooth, setBand, simplex3 } from './noise.js';
const _p = [0, 0, 0], _lc = [0, 0, 0];
import { erode } from './erode.js';

export const MAP_INFO = [
  { id: 'albedo', label: 'Base colour', note: 'sRGB' },
  { id: 'height', label: 'Height', note: '16-bit' },
  { id: 'normal', label: 'Normal (tangent)', note: 'OpenGL +Y' },
  { id: 'normalObj', label: 'Normal (object)', note: 'planet frame' },
  { id: 'roughness', label: 'Roughness', note: 'linear' },
  { id: 'metallic', label: 'Metallic', note: 'linear' },
  { id: 'specular', label: 'Specular', note: 'F0 = 0.08 s' },
  { id: 'ao', label: 'Ambient occlusion', note: 'linear' },
  { id: 'orm', label: 'ORM packed', note: 'AO · R · M' },
  { id: 'emissive', label: 'Emissive', note: 'sRGB' },
  { id: 'nightMask', label: 'Night lights mask', note: 'linear' },
  { id: 'clouds', label: 'Clouds', note: 'RGBA, alpha' },
  { id: 'flow', label: 'Band / flow', note: 'u · v · band' },
  { id: 'rings', label: 'Rings', note: 'RGBA strip' },
];

// The height quantiles use the full band, whatever the last map width was.
export function prepare(P) { setBand(0); return P.kind === 'gas' ? prepareGas(P) : prepareRocky(P); }

// Per-texel buffers for rows y0..y1 of a W x W/2 map.
export function sampleRows(ctx, W, y0, y1) {
  const H = W / 2, n = W * (y1 - y0);
  const o = {
    y0, y1, W,
    height: new Float32Array(n), albedo: new Uint8Array(n * 4), mat: new Uint8Array(n * 4),
    emissive: new Uint8Array(n * 4), cloud: new Uint8Array(n * 4),
  };
  const p = [0, 0, 0], s = {};
  // octaves above about W / 8 cycles per radian alias at this width
  setBand(W / 16);
  const cc = ctx.P.clouds && ctx.P.clouds.color || [1, 1, 1];
  const cr = Math.round(clamp(cc[0]) * 255), cg = Math.round(clamp(cc[1]) * 255), cb = Math.round(clamp(cc[2]) * 255);
  let i = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++, i++) {
    texelDir(x, y, W, H, p);
    ctx.sample(p, s);
    o.height[i] = s.h;
    const j = i * 4;
    o.albedo[j] = Math.round(s.r * 255); o.albedo[j + 1] = Math.round(s.g * 255); o.albedo[j + 2] = Math.round(s.b * 255);
    // alpha: the snow potential for finish (rocky), 255 = none to apply (gas)
    o.albedo[j + 3] = s.snow === undefined ? 255 : Math.round(clamp(s.snow) * 254);
    // mat: roughness, metallic, specular, flow band (AO comes in pass 2)
    o.mat[j] = Math.round(clamp(s.rough) * 255); o.mat[j + 1] = Math.round(clamp(s.metal) * 255);
    o.mat[j + 2] = Math.round(clamp(s.spec) * 255); o.mat[j + 3] = Math.round(clamp(s.fb) * 255);
    // emissive as sRGB of a radiance up to 1 (values above 1 clip)
    o.emissive[j] = enc(s.er); o.emissive[j + 1] = enc(s.eg); o.emissive[j + 2] = enc(s.eb); o.emissive[j + 3] = s.night ? 255 : 0;
    // cloud: alpha, flow u, flow v, and (unused) 255
    o.cloud[j] = Math.round(clamp(s.cloud) * 255); o.cloud[j + 1] = Math.round(clamp(s.fu) * 255);
    o.cloud[j + 2] = Math.round(clamp(s.fv) * 255); o.cloud[j + 3] = 255;
  }
  o.cloudRGB = [cr, cg, cb];
  return o;
}
const enc = v => { v = clamp(v); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255); };

// Join row stripes (any order) into whole maps.
export function assemble(W, parts) {
  const H = W / 2, n = W * H;
  const M = { W, H, height: new Float32Array(n), albedo: new Uint8Array(n * 4), mat: new Uint8Array(n * 4), emissive: new Uint8Array(n * 4), cloud: new Uint8Array(n * 4) };
  for (const s of parts) {
    const off = s.y0 * W;
    M.height.set(s.height, off);
    for (const k of ['albedo', 'mat', 'emissive', 'cloud']) M[k].set(s[k], off * 4);
    M.cloudRGB = s.cloudRGB;
  }
  return M;
}

// Pass 2: normals (RGBA8: n.xyz, 8-bit height in alpha) and AO (one byte
// per texel; render.js packs it into the material texture).
export function finish(M, P, ctx) {
  const km = ctx ? ctx.kmPerUnit * (ctx.hMax - ctx.hMin) : P.relief;
  M.reliefKm = km;
  if (P.kind !== 'gas' && ctx) {
    const sea = P.ocean.level > 0 ? (ctx.seaH - ctx.hMin) / (ctx.hMax - ctx.hMin) : null;
    const er = erode(M.height, M.W, M.H, { reliefKm: km, radiusKm: P.radiusKm, sea, flow: P.atmo.on ? P.erosion.flow : 0, talus: P.erosion.talus });
    M.height = er.height; M.erosion = { cut: er.cut, net: er.net };
    surface(M, P, er, sea);
    if ((P.ocean.liquid | 0) === 1 && P.ocean.level > 0) halo(M);
  }
  M.normal = normals(M.height, M.W, M.H, km, P.radiusKm, P.bump);
  M.ao = ambient(M.height, M.W, M.H, km, P.radiusKm);
  M.stats = stats(M);
  return M;
}

// After erosion: rivers along the drainage, snow where the slope holds it,
// bare rock on cliffs, then alpha back to 255. Slopes are measured against
// the 90th percentile of land slope, so the look does not change with the
// map width.
function surface(M, P, er, sea) {
  const n = M.W * M.H, pal = P.palette, liq = P.ocean.liquid | 0;
  const land = i => sea == null || M.height[i] > sea + 1e-4;
  const sl = []; for (let i = 0; i < n; i += 13) if (land(i)) sl.push(er.slope[i]);
  sl.sort((a, b) => a - b);
  const s90 = Math.max(sl[Math.floor(sl.length * 0.9)] || 1e-6, 1e-6);
  const ice = pal.ice.map(v => v * 255), rock = pal.rock.map(v => v * 255), deep = pal.deep.map(v => v * 255);
  const riv = P.rivers.amount, bb = [1, 0.42, 0.08];
  // lava rivers: a channel field from the drainage segments (continuous at
  // any zoom); water rivers keep the per-texel flow threshold
  const chan = liq === 1 && riv > 0 && er.rec ? channels(er, M.W, M.H) : null;
  for (let i = 0; i < n; i++) {
    const j = i * 4, a = M.albedo[j + 3];
    if (a === 255) continue;
    M.albedo[j + 3] = 255;
    if (!land(i)) continue;
    const s = er.slope[i] / s90;
    // cliffs: bare rock where the slope is twice the usual steep slope
    const cliff = smooth(1.4, 2.6, s) * 0.6;
    if (cliff > 0) for (let c = 0; c < 3; c++) M.albedo[j + c] += (rock[c] - M.albedo[j + c]) * cliff;
    // rivers: the trunk channels of the drainage
    const r = riv > 0 ? (chan ? chan[i] : smooth(0.62, 0.8, er.flow[i])) * riv * (1 - a / 254) : 0;   // frozen rivers stay under snow
    if (r > 0) {
      if (liq === 1) {
        // lava channels: hot at the vents (the heads), cooling downstream
        // (1230 K to 980 K by the flow, scaled by the heating; the thin,
        // jagged heads stay dark); a
        // stretch roofed over (a lava tube, about a fifth of the length)
        // glows only through its skylights. The channel field is 1 on the
        // axis and falls to 0 at the bank.
        texelDir(i % M.W, (i / M.W) | 0, M.W, M.H, _p);
        const fl = er.flow[i], heatK = P.lava ? P.lava.heat : 0.6;
        const T = 1150 + 80 * heatK - 170 * smooth(0.7, 1.0, fl) + 50 * simplex3(_p[0] * 30, _p[1] * 30, _p[2] * 30, 911);
        const tube = smooth(0.42, 0.55, simplex3(_p[0] * 22, _p[1] * 22, _p[2] * 22, 913));
        const sky = smooth(0.55, 0.8, simplex3(_p[0] * 45, _p[1] * 45, _p[2] * 45, 917));
        // only the flow fields fed now glow; the rest are cooled, dark channels
        const fed = smooth(-0.15, 0.25, simplex3(_p[0] * 1.6, _p[1] * 1.6, _p[2] * 1.6, 919) + 0.6 * (heatK - 0.5));
        const g = Math.min(1, r * 1.5) * Math.pow(T / 1500, 4) * 0.8 * (1 - tube * (1 - 0.6 * sky)) * fed * smooth(0.62, 0.75, fl);
        lavaColour(T, _lc);
        M.emissive[j] = Math.max(M.emissive[j], enc(_lc[0] * g)); M.emissive[j + 1] = Math.max(M.emissive[j + 1], enc(_lc[1] * g)); M.emissive[j + 2] = Math.max(M.emissive[j + 2], enc(_lc[2] * g));
        // the channel floor: dark red skin; a tube roof is black crust
        for (let c = 0; c < 3; c++) M.albedo[j + c] += (bb[c] * 90 * (1 - tube) + 8 * tube - M.albedo[j + c]) * r * 0.6;
      } else {
        for (let c = 0; c < 3; c++) M.albedo[j + c] += (deep[c] - M.albedo[j + c]) * r * 0.85;
        if (M.mat) { M.mat[j] += (25 - M.mat[j]) * r; M.mat[j + 2] += (64 - M.mat[j + 2]) * r; }
      }
    }
    // snow: the temperature potential, held by gentle slopes, shed by steep ones
    const snow = (a / 254) * smooth(2.2, 0.9, s);
    if (snow > 0) {
      for (let c = 0; c < 3; c++) M.albedo[j + c] += (ice[c] - M.albedo[j + c]) * snow * 0.95;
      if (M.mat) { M.mat[j] += (140 - M.mat[j]) * snow; M.mat[j + 2] += (71 - M.mat[j + 2]) * snow; }
    }
  }
}

// Lava worlds: a soft halo round the hot lava (a box blur of the
// emission, radius W / 512 texels, twice, so about a tent), added at 22 %
// in linear light. The view has no bloom pass; this is the glow of the
// lava on the ground and the fumes next to it.
function halo(M) {
  const W = M.W, H = M.H, n = W * H, r = Math.max(2, Math.round(W / 512)), dec = new Float32Array(256);
  for (let k = 0; k < 256; k++) { const v = k / 255; dec[k] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) a[i] = dec[M.emissive[i * 4 + c]];
    for (let pass = 0; pass < 2; pass++) {
      // rows (wrap at the date line), then columns (clamped at the poles)
      for (let y = 0; y < H; y++) {
        const o = y * W; let sum = 0;
        for (let k = -r; k <= r; k++) sum += a[o + ((k % W) + W) % W];
        for (let x = 0; x < W; x++) { b[o + x] = sum / (2 * r + 1); sum += a[o + (x + r + 1) % W] - a[o + ((x - r) % W + W) % W]; }
      }
      for (let x = 0; x < W; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += b[Math.min(H - 1, Math.max(0, k)) * W + x];
        for (let y = 0; y < H; y++) { a[y * W + x] = sum / (2 * r + 1); sum += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x]; }
      }
    }
    for (let i = 0; i < n; i++) { const j = i * 4 + c; M.emissive[j] = enc(dec[M.emissive[j]] + 0.22 * a[i]); }
  }
}

// Lava channels as a distance field. Each drainage texel with flow over
// CH_T0 (at the erosion width ew) is a segment from its centre to the
// centre of the texel it drains to, in map texels. The channel is a
// capsule round that segment: half width CH_W0..CH_W1 erosion texels
// (wider downstream), at least CH_MIN map texels, and the east-west
// distance is shrunk by cos(lat), so the width on the ground does not
// change with latitude. Value: strength (smooth in flow, so a tributary
// fades in) x smooth bank falloff. Joined segments leave no gaps, so
// the channel does not break into dots at diagonal steps or when the
// map is wider than the erosion grid.
const CH_T0 = 0.6, CH_T1 = 0.8, CH_W0 = 0.35, CH_W1 = 0.9, CH_MIN = 0.8;
export function channels(er, W, H) {
  const out = new Float32Array(W * H), ew = er.ew, eh = ew / 2, f = W / ew;
  const rec = er.rec, fl = er.flowE;
  for (let i = 0; i < ew * eh; i++) {
    const v = fl[i];
    if (v <= CH_T0 || rec[i] < 0) continue;
    const s = smooth(CH_T0, CH_T1, v), t = Math.min(1, (v - CH_T0) / (1 - CH_T0));
    const xi = i % ew, yi = (i - xi) / ew, j = rec[i], xj = j % ew, yj = (j - xj) / ew;
    let ax = (xi + 0.5) * f, ay = (yi + 0.5) * f, dx = (xj - xi), dy = (yj - yi) * f;
    if (dx > eh) dx -= ew; else if (dx < -eh) dx += ew;
    dx *= f;
    if (Math.abs(yj - yi) > 1) { dx = 0; dy = 0; }   // across the pole: a dot
    const cl = Math.max(Math.sin((ay / H) * Math.PI), 0.05);
    // a channel narrower than CH_MIN texels is drawn CH_MIN wide and dimmer
    // by the width ratio (the same coverage at any map width)
    const hw0 = (CH_W0 + (CH_W1 - CH_W0) * t) * f, hw = Math.max(CH_MIN, hw0), cov = s * hw0 / hw, reach = hw + 1;
    const y0 = Math.max(0, Math.floor(Math.min(ay, ay + dy) - reach)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, ay + dy) + reach));
    const rx = reach / cl;
    const x0 = Math.floor(Math.min(ax, ax + dx) - rx), x1 = Math.ceil(Math.max(ax, ax + dx) + rx);
    // segment in ground-scaled texels (x times cos(lat))
    const sx = dx * cl, sy = dy, L2 = sx * sx + sy * sy;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - ay;
      for (let x = x0; x <= x1; x++) {
        const px = (x + 0.5 - ax) * cl;
        const u = L2 > 0 ? Math.min(1, Math.max(0, (px * sx + py * sy) / L2)) : 0;
        const d = Math.hypot(px - u * sx, py - u * sy);
        if (d >= hw + 0.75) continue;
        const val = cov * smooth(hw + 0.75, hw - 0.5, d);
        const k = y * W + (((x % W) + W) % W);
        if (val > out[k]) out[k] = val;
      }
    }
  }
  return out;
}

// Neighbour fetch with the date-line wrap and the across-the-pole rule.
function hAt(h, W, H, x, y) {
  if (y < 0) { y = 0; x += W / 2; } else if (y >= H) { y = H - 1; x += W / 2; }
  x = ((x % W) + W) % W;
  return h[y * W + x];
}

function normals(h, W, H, reliefKm, radiusKm, bump) {
  const out = new Uint8Array(W * H * 4);
  const dTh = Math.PI / H, dPh = 2 * Math.PI / W;
  for (let y = 0; y < H; y++) {
    const th = (y + 0.5) * dTh, cl = Math.sin(th);
    const dE = 2 * dPh * Math.max(cl, 1e-4) * radiusKm, dN = 2 * dTh * radiusKm;
    // east-west differences over sx texels, so the step covers about one
    // texel of ground near the poles too (no singular rows there)
    const sx = Math.max(1, Math.min(W / 4, Math.round(1 / Math.max(cl, 1e-4))));
    const dEs = dE * sx;
    const inner = y > 0 && y < H - 1, row = y * W;
    for (let x = 0; x < W; x++) {
      // off the pole rows: direct indices (the same values as hAt)
      let gx, gy;
      if (inner && x >= sx && x < W - sx) {
        gx = (h[row + x + sx] - h[row + x - sx]) * reliefKm / dEs;
        gy = (h[row - W + x] - h[row + W + x]) * reliefKm / dN;
      } else {
        gx = (hAt(h, W, H, x + sx, y) - hAt(h, W, H, x - sx, y)) * reliefKm / dEs;
        gy = (hAt(h, W, H, x, y - 1) - hAt(h, W, H, x, y + 1)) * reliefKm / dN;
      }
      let nx = -gx * bump, ny = -gy * bump, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const j = (y * W + x) * 4;
      out[j] = Math.round((nx * 0.5 + 0.5) * 255); out[j + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[j + 2] = Math.round((nz * 0.5 + 0.5) * 255); out[j + 3] = Math.round(clamp(h[y * W + x]) * 255);
    }
  }
  return out;
}

// Box blur with wrap in x (radius rx per row) and clamp in y, by prefix sums.
function blur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), pre = new Float64Array(W * 3 + 1);
  for (let y = 0; y < H; y++) {
    const cl = Math.sin((y + 0.5) / H * Math.PI);
    const rx = Math.min(W / 2 - 1, Math.max(1, Math.round(r / Math.max(cl, 1e-3))));
    // prefix over three copies of the row for the wrap
    pre[0] = 0;
    for (let i = 0; i < W * 3; i++) pre[i + 1] = pre[i] + src[y * W + (i % W)];
    for (let x = 0; x < W; x++) { const a = x + W - rx, b = x + W + rx + 1; tmp[y * W + x] = (pre[b] - pre[a]) / (b - a); }
  }
  const col = new Float64Array(H + 1);
  for (let x = 0; x < W; x++) {
    col[0] = 0;
    for (let y = 0; y < H; y++) col[y + 1] = col[y] + tmp[y * W + x];
    for (let y = 0; y < H; y++) { const a = Math.max(0, y - r), b = Math.min(H, y + r + 1); out[y * W + x] = (col[b] - col[a]) / (b - a); }
  }
  return out;
}

function ambient(h, W, H, reliefKm, radiusKm) {
  const ao = new Float32Array(W * H);
  const radii = [2, 8, 24].map(r => Math.max(1, Math.round(r * W / 2048)));
  const texKm = Math.PI * radiusKm / H;
  for (const r of radii) {
    const b = blur(h, W, H, r), dist = r * texKm * 0.6;
    for (let i = 0; i < W * H; i++) ao[i] += clamp((b[i] - h[i]) * reliefKm / dist * 4);
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = Math.round(clamp(1 - 0.55 * ao[i] / radii.length) * 255);
  return out;
}

const dec = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
function stats(M) {
  let al = 0, cl = 0; const n = M.W * M.H, em = [0, 0, 0];
  for (let i = 0; i < n; i += 7) {
    al += (M.albedo[i * 4] + M.albedo[i * 4 + 1] + M.albedo[i * 4 + 2]) / 765; cl += M.cloud[i * 4] / 255;
    if (M.emissive && !M.emissive[i * 4 + 3]) for (let c = 0; c < 3; c++) em[c] += dec(M.emissive[i * 4 + c]);
  }
  const k = Math.ceil(n / 7);
  // meanEmis: the mean linear emission without city lights (the haze glow, render.js)
  return { meanAlbedo: al / k, cloudCover: cl / k, meanEmis: em.map(v => v / k) };
}

// Whole planet, synchronously (node tests, the Deno thumbnail).
export function generate(P, W) {
  const ctx = prepare(P);
  const M = assemble(W, [sampleRows(ctx, W, 0, W / 2)]);
  return finish(M, P, ctx);
}

// One exportable image: { width, height, channels, depth, data }.
export function mapImage(M, P, id) {
  const { W, H } = M, n = W * H;
  const gray8 = f => { const d = new Uint8Array(n); for (let i = 0; i < n; i++) d[i] = f(i); return { width: W, height: H, channels: 1, depth: 8, data: d }; };
  const rgb = f => { const d = new Uint8Array(n * 3); for (let i = 0; i < n; i++) f(i, d, i * 3); return { width: W, height: H, channels: 3, depth: 8, data: d }; };
  switch (id) {
    case 'albedo': return rgb((i, d, j) => { d[j] = M.albedo[i * 4]; d[j + 1] = M.albedo[i * 4 + 1]; d[j + 2] = M.albedo[i * 4 + 2]; });
    case 'height': {
      const d = new Uint16Array(n);
      for (let i = 0; i < n; i++) d[i] = Math.round(clamp(M.height[i]) * 65535);
      return { width: W, height: H, channels: 1, depth: 16, data: d };
    }
    case 'normal': return rgb((i, d, j) => { d[j] = M.normal[i * 4]; d[j + 1] = M.normal[i * 4 + 1]; d[j + 2] = M.normal[i * 4 + 2]; });
    case 'normalObj': {
      const e = [0, 0, 0], no = [0, 0, 0], p = [0, 0, 0];
      return rgb((i, d, j) => {
        const x = i % W, y = (i / W) | 0;
        texelFrame(x, y, W, H, e, no); texelDir(x, y, W, H, p);
        const tx = M.normal[i * 4] / 127.5 - 1, ty = M.normal[i * 4 + 1] / 127.5 - 1, tz = M.normal[i * 4 + 2] / 127.5 - 1;
        let ox = e[0] * tx + no[0] * ty + p[0] * tz, oy = e[1] * tx + no[1] * ty + p[1] * tz, oz = e[2] * tx + no[2] * ty + p[2] * tz;
        const l = Math.hypot(ox, oy, oz) || 1;
        d[j] = Math.round((ox / l * 0.5 + 0.5) * 255); d[j + 1] = Math.round((oy / l * 0.5 + 0.5) * 255); d[j + 2] = Math.round((oz / l * 0.5 + 0.5) * 255);
      });
    }
    case 'roughness': return gray8(i => M.mat[i * 4]);
    case 'metallic': return gray8(i => M.mat[i * 4 + 1]);
    case 'specular': return gray8(i => M.mat[i * 4 + 2]);
    case 'ao': return gray8(i => M.ao[i]);
    case 'orm': return rgb((i, d, j) => { d[j] = M.ao[i]; d[j + 1] = M.mat[i * 4]; d[j + 2] = M.mat[i * 4 + 1]; });
    case 'emissive': return rgb((i, d, j) => { d[j] = M.emissive[i * 4]; d[j + 1] = M.emissive[i * 4 + 1]; d[j + 2] = M.emissive[i * 4 + 2]; });
    case 'nightMask': return gray8(i => M.emissive[i * 4 + 3]);
    case 'clouds': {
      const d = new Uint8Array(n * 4), c = M.cloudRGB || [255, 255, 255];
      for (let i = 0; i < n; i++) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = M.cloud[i * 4]; }
      return { width: W, height: H, channels: 4, depth: 8, data: d };
    }
    case 'flow': return rgb((i, d, j) => { d[j] = M.cloud[i * 4 + 1]; d[j + 1] = M.cloud[i * 4 + 2]; d[j + 2] = M.mat[i * 4 + 3]; });
    case 'rings': {
      const strip = ringProfile(P, 1024), h = 64, d = new Uint8Array(1024 * h * 4);
      for (let y = 0; y < h; y++) d.set(strip, y * 1024 * 4);
      return { width: 1024, height: h, channels: 4, depth: 8, data: d };
    }
  }
  return null;
}

// Which maps a planet has (flow for giants, rings when on).
export function mapIds(P) {
  return MAP_INFO.map(m => m.id).filter(id => (id !== 'flow' || P.kind === 'gas') && (id !== 'rings' || (P.rings && P.rings.on)));
}

// FNV-1a over every map buffer, as 8 hex digits.
export function hashMaps(M) {
  let h = 0x811c9dc5;
  const eat = a => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); } };
  for (const k of ['height', 'albedo', 'mat', 'emissive', 'cloud', 'normal', 'ao']) if (M[k]) eat(M[k]);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Box-filter mip chain of an RGBA8 W x H image (x wraps). For GPU upload.
export function mipChain(data, W, H, maxLevels = 16) {
  const out = [{ w: W, h: H, data }];
  let w = W, h = H, src = data;
  while ((w > 1 || h > 1) && out.length < maxLevels) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), d = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      const r0 = Math.min(h - 1, y * 2) * w * 4, r1 = Math.min(h - 1, y * 2 + 1) * w * 4;
      let o = y * nw * 4;
      for (let x = 0; x < nw; x++) {
        const a0 = r0 + ((x * 2) % w) * 4, a1 = r0 + ((x * 2 + 1) % w) * 4, b0 = r1 + ((x * 2) % w) * 4, b1 = r1 + ((x * 2 + 1) % w) * 4;
        d[o] = (src[a0] + src[a1] + src[b0] + src[b1] + 2) >> 2;
        d[o + 1] = (src[a0 + 1] + src[a1 + 1] + src[b0 + 1] + src[b1 + 1] + 2) >> 2;
        d[o + 2] = (src[a0 + 2] + src[a1 + 2] + src[b0 + 2] + src[b1 + 2] + 2) >> 2;
        d[o + 3] = (src[a0 + 3] + src[a1 + 3] + src[b0 + 3] + src[b1 + 3] + 2) >> 2;
        o += 4;
      }
    }
    out.push({ w: nw, h: nh, data: d }); w = nw; h = nh; src = d;
  }
  return out;
}

// Downsample an RGBA8 map by an integer factor (GPU texture cap).
export function shrink(data, W, H, f) {
  if (f <= 1) return data;
  const nw = W / f, nh = H / f, d = new Uint8Array(nw * nh * 4), k = f * f;
  const acc = new Uint32Array(4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    for (let j = 0; j < f; j++) {
      let a = ((y * f + j) * W + x * f) * 4;
      for (let i = 0; i < f; i++, a += 4) { acc[0] += data[a]; acc[1] += data[a + 1]; acc[2] += data[a + 2]; acc[3] += data[a + 3]; }
    }
    const o = (y * nw + x) * 4;
    d[o] = Math.round(acc[0] / k); d[o + 1] = Math.round(acc[1] / k); d[o + 2] = Math.round(acc[2] / k); d[o + 3] = Math.round(acc[3] / k);
  }
  return d;
}

// A nearest-sample copy of a map set at width tw (preview thumbnails).
export function shrinkMaps(M, tw) {
  const th = tw / 2, n = tw * th, s = M.W / tw;
  const o = { W: tw, H: th, height: new Float32Array(n), albedo: new Uint8Array(n * 4), mat: new Uint8Array(n * 4), emissive: new Uint8Array(n * 4), cloud: new Uint8Array(n * 4), normal: new Uint8Array(n * 4), ao: new Uint8Array(n), cloudRGB: M.cloudRGB };
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x, j = Math.floor(y * s + s / 2) * M.W + Math.floor(x * s + s / 2);
    o.height[i] = M.height[j]; o.ao[i] = M.ao[j];
    for (const k of ['albedo', 'mat', 'emissive', 'cloud', 'normal']) for (let c = 0; c < 4; c++) o[k][i * 4 + c] = M[k][j * 4 + c];
  }
  return o;
}
