// Texture steps of the nature asset build. Needs sharp (pass it in).
// grep -n names: pushPull, coverage, keepCoverage, writeMaterialTextures,
// writeGroundSet.
//
// Albedo files are RGBA WebP: rgb colour, a = alpha mask (255 when the
// material is opaque). Colour under transparent texels is filled by
// push-pull so mips and filtering show no dark fringes. Each smaller size
// rescales its alpha so that the share of texels over the 0.5 cutoff
// stays the same as at the top size (foliage does not thin out with
// distance).
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Fill rgb of texels with alpha < 0.5 from the nearest opaque colour, by
// a push-pull pyramid. buf: Uint8Array RGBA, w x h.
export function pushPull(buf, w, h) {
  const levels = [];
  let cw = w, ch = h;
  let C = new Float32Array(w * h * 3), W = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = buf[i * 4 + 3] >= 128 ? 1 : 0;
    W[i] = a; C[i * 3] = buf[i * 4] * a; C[i * 3 + 1] = buf[i * 4 + 1] * a; C[i * 3 + 2] = buf[i * 4 + 2] * a;
  }
  levels.push({ C, W, w: cw, h: ch });
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1);
    const NC = new Float32Array(nw * nh * 3), NW = new Float32Array(nw * nh);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x, j = Math.min(nh - 1, y >> 1) * nw + Math.min(nw - 1, x >> 1);
      NW[j] += W[i]; NC[j * 3] += C[i * 3]; NC[j * 3 + 1] += C[i * 3 + 1]; NC[j * 3 + 2] += C[i * 3 + 2];
    }
    C = NC; W = NW; cw = nw; ch = nh;
    levels.push({ C, W, w: cw, h: ch });
  }
  // push: normalise from coarse to fine, fill empty texels from the parent
  for (let l = levels.length - 1; l >= 0; l--) {
    const L = levels[l];
    const P = levels[l + 1];
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const i = y * L.w + x;
      if (L.W[i] > 0) { const k = 1 / L.W[i]; L.C[i * 3] *= k; L.C[i * 3 + 1] *= k; L.C[i * 3 + 2] *= k; L.W[i] = 1; }
      else if (P) {
        const j = Math.min(P.h - 1, y >> 1) * P.w + Math.min(P.w - 1, x >> 1);
        L.C[i * 3] = P.C[j * 3]; L.C[i * 3 + 1] = P.C[j * 3 + 1]; L.C[i * 3 + 2] = P.C[j * 3 + 2];
      }
    }
  }
  const L0 = levels[0];
  for (let i = 0; i < w * h; i++) {
    if (buf[i * 4 + 3] >= 128) continue;
    buf[i * 4] = Math.round(L0.C[i * 3]); buf[i * 4 + 1] = Math.round(L0.C[i * 3 + 1]); buf[i * 4 + 2] = Math.round(L0.C[i * 3 + 2]);
  }
  return buf;
}

export function coverage(buf, scale = 1) {
  let n = 0; const t = 127.5 / scale;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] >= t) n++;
  return n / (buf.length / 4);
}

// Scale alpha so the coverage at the 0.5 cutoff matches target.
export function keepCoverage(buf, target) {
  if (target <= 0 || target >= 1) return 1;
  let lo = 0.5, hi = 6;
  for (let it = 0; it < 24; it++) {
    const mid = (lo + hi) / 2;
    if (coverage(buf, mid) < target) lo = mid; else hi = mid;
  }
  const s = (lo + hi) / 2;
  for (let i = 3; i < buf.length; i += 4) buf[i] = Math.min(255, Math.round(buf[i] * s));
  return s;
}

const Q = { albedo: 82, normal: 88, orm: 78 };

// Write one material's maps at the given sizes. src = { diff, nor, arm,
// alpha } file paths (alpha may be null). Returns { files: { albedo:
// [paths by size], normal, orm }, alpha: bool, coverage }.
export async function writeMaterialTextures(sharp, src, outDir, base, sizes, force = false) {
  mkdirSync(outDir, { recursive: true });
  const out = { albedo: [], normal: [], orm: [], alpha: false, coverage: 1 };
  const top = sizes[0];
  // Albedo with alpha at the top size.
  const diff = sharp(src.diff).removeAlpha().resize(top, top, { fit: 'fill' });
  const rgb = await diff.raw().toBuffer();
  const rgba = new Uint8Array(top * top * 4);
  for (let i = 0; i < top * top; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  if (src.alpha) {
    const a = await sharp(src.alpha).greyscale().resize(top, top, { fit: 'fill' }).raw().toBuffer();
    const ch = a.length / (top * top);
    let min = 255;
    for (let i = 0; i < top * top; i++) { const v = a[i * ch]; rgba[i * 4 + 3] = v; if (v < min) min = v; }
    out.alpha = min < 128;
    if (!out.alpha) for (let i = 0; i < top * top; i++) rgba[i * 4 + 3] = 255;
  }
  if (out.alpha) { pushPull(rgba, top, top); out.coverage = coverage(rgba); }
  for (const s of sizes) {
    const f = path.join(outDir, `${base}_albedo_${s}.webp`);
    out.albedo.push(f);
    if (!force && existsSync(f)) continue;
    let img;
    if (s === top) img = rgba;
    else {
      img = new Uint8Array(await sharp(Buffer.from(rgba.buffer), { raw: { width: top, height: top, channels: 4 } }).resize(s, s, { kernel: 'lanczos3' }).raw().toBuffer());
      if (out.alpha) keepCoverage(img, out.coverage);
    }
    await sharp(Buffer.from(img.buffer, img.byteOffset, img.byteLength), { raw: { width: s, height: s, channels: 4 } })
      .webp({ quality: Q.albedo, alphaQuality: 90, effort: 5 }).toFile(f);
  }
  for (const [k, file, q] of [['normal', src.nor, Q.normal], ['orm', src.arm, Q.orm]]) {
    for (const s of sizes) {
      const f = path.join(outDir, `${base}_${k}_${s}.webp`);
      out[k].push(file ? f : null);
      if (!file || (!force && existsSync(f))) continue;
      await sharp(file).removeAlpha().resize(s, s, { fit: 'fill', kernel: 'lanczos3' }).webp({ quality: q, effort: 5 }).toFile(f);
    }
  }
  return out;
}

// Ground PBR set at 1024: albedo (rgb, a = 255), normal (GL, +y up),
// orm (r ambient occlusion, g roughness, b height from the displacement
// map, a 255). src = { color, normal, ao, rough, arm, disp }.
export async function writeGroundSet(sharp, src, outDir, id, size = 1024) {
  mkdirSync(outDir, { recursive: true });
  const f = { albedo: path.join(outDir, `${id}_albedo.webp`), normal: path.join(outDir, `${id}_normal.webp`), orm: path.join(outDir, `${id}_orm.webp`) };
  await sharp(src.color).removeAlpha().resize(size, size, { fit: 'fill' }).webp({ quality: 84, effort: 5 }).toFile(f.albedo);
  await sharp(src.normal).removeAlpha().resize(size, size, { fit: 'fill' }).webp({ quality: 88, effort: 5 }).toFile(f.normal);
  const grey = async (p, ch = 0) => {
    if (!p) return null;
    const { data, info } = await sharp(p).resize(size, size, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const o = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) o[i] = data[i * info.channels + Math.min(ch, info.channels - 1)];
    return o;
  };
  let ao, rough;
  if (src.arm) { ao = await grey(src.arm, 0); rough = await grey(src.arm, 1); }
  else { ao = await grey(src.ao); rough = await grey(src.rough); }
  const disp = await grey(src.disp);
  // Stretch the height to 0..255 so height blending has range.
  let lo = 255, hi = 0;
  if (disp) for (const v of disp) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const orm = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    orm[i * 3] = ao ? ao[i] : 255;
    orm[i * 3 + 1] = rough ? rough[i] : 200;
    orm[i * 3 + 2] = disp ? Math.round(((disp[i] - lo) / Math.max(1, hi - lo)) * 255) : 128;
  }
  await sharp(orm, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 82, effort: 5 }).toFile(f.orm);
  return f;
}

export function fileBytes(f) { return statSync(f).size; }
