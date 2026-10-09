// ============================================================================
//  PLANET FORGE  ·  maps.js — from a planet recipe to PBR maps (no DOM)
// ----------------------------------------------------------------------------
//  Pass 1, sampleRows: every texel of a 2:1 equirect map gets its unit
//  vector (noise.js texelDir) and the generator's sample. Rows are
//  independent, so the page splits them across workers (pool.js).
//  Pass 2, finish: the tangent-space normal map and the ambient occlusion,
//  which both need the whole height field.
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
//  "export function sampleRows", "export function finish", "function normals",
//  "function ambient", "export function generate", "export function mapImage",
//  "export function hashMaps", "export function shrinkMaps"
// ============================================================================
import { prepareRocky } from './rocky.js';
import { prepareGas, ringProfile } from './gas.js';
import { texelDir, texelFrame, clamp, setBand } from './noise.js';

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
  // octaves above about W / 10 cycles per radian alias at this width
  setBand(W / 24);
  const cc = ctx.P.clouds && ctx.P.clouds.color || [1, 1, 1];
  const cr = Math.round(clamp(cc[0]) * 255), cg = Math.round(clamp(cc[1]) * 255), cb = Math.round(clamp(cc[2]) * 255);
  let i = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++, i++) {
    texelDir(x, y, W, H, p);
    ctx.sample(p, s);
    o.height[i] = s.h;
    const j = i * 4;
    o.albedo[j] = Math.round(s.r * 255); o.albedo[j + 1] = Math.round(s.g * 255); o.albedo[j + 2] = Math.round(s.b * 255); o.albedo[j + 3] = 255;
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
  M.normal = normals(M.height, M.W, M.H, km, P.radiusKm, P.bump);
  M.ao = ambient(M.height, M.W, M.H, km, P.radiusKm);
  M.stats = stats(M);
  return M;
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
    for (let x = 0; x < W; x++) {
      const gx = (hAt(h, W, H, x + 1, y) - hAt(h, W, H, x - 1, y)) * reliefKm / dE;
      const gy = (hAt(h, W, H, x, y - 1) - hAt(h, W, H, x, y + 1)) * reliefKm / dN;
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
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1), x0 = (x * 2) % w, x1 = (x * 2 + 1) % w;
      d[(y * nw + x) * 4 + c] = (src[(y0 * w + x0) * 4 + c] + src[(y0 * w + x1) * 4 + c] + src[(y1 * w + x0) * 4 + c] + src[(y1 * w + x1) * 4 + c] + 2) >> 2;
    }
    out.push({ w: nw, h: nh, data: d }); w = nw; h = nh; src = d;
  }
  return out;
}

// Downsample an RGBA8 map by an integer factor (GPU texture cap).
export function shrink(data, W, H, f) {
  if (f <= 1) return data;
  const nw = W / f, nh = H / f, d = new Uint8Array(nw * nh * 4), k = f * f;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += data[((y * f + j) * W + x * f + i) * 4 + c];
    d[(y * nw + x) * 4 + c] = Math.round(s / k);
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
