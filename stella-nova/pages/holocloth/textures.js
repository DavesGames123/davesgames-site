// ============================================================================
//  HOLOCLOTH  ·  textures.js
//  Ported from upstream src/textures.ts (github.com/dmitrykurash/holocloth).
//  Copyright (c) 2026 Dmitry Kurash, MIT License, see LICENSE.
//  Port changes: TypeScript types are removed. The port adds two canvas
//  generators that replace the upstream JPEG assets:
//    makeScratchHeight  replaces public/bump-scratches.jpg (the default bump)
//    makePosterCanvas   replaces public/holo-bg-2.jpg (the default cloth art)
//
//    grep -n 'function heightToNormalTexture'  Sobel height to normal map
//    grep -n 'function normalMapFromImage'     uploaded bump to normal map
//    grep -n 'function makeScratchHeight'      procedural scratch bump
//    grep -n 'function makePosterCanvas'       procedural cloth poster
// ============================================================================
import * as THREE from 'three';

/** Deterministic pseudo-random for texture generation */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Height field of a fine fabric weave: interleaved warp/weft threads,
 * per-thread thickness variation and micro grain.
 */
function weaveHeight(size, threads, rand) {
  const h = new Float32Array(size * size);
  // per-thread random thickness so the weave doesn't look machine-perfect
  const warpVar = new Float32Array(threads + 1);
  const weftVar = new Float32Array(threads + 1);
  for (let i = 0; i <= threads; i++) {
    warpVar[i] = 0.85 + rand() * 0.3;
    weftVar[i] = 0.85 + rand() * 0.3;
  }
  const grain = new Float32Array(size * size);
  for (let i = 0; i < grain.length; i++) grain[i] = rand();

  for (let y = 0; y < size; y++) {
    const v = (y / size) * threads;
    const vi = Math.floor(v);
    const vf = v - vi;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * threads;
      const ui = Math.floor(u);
      const uf = u - ui;
      // thread cross-section profile (half-sine bump per thread)
      const warp = Math.sin(uf * Math.PI) * warpVar[ui % (threads + 1)];
      const weft = Math.sin(vf * Math.PI) * weftVar[vi % (threads + 1)];
      // plain weave: alternate which thread lies on top
      const over = (ui + vi) % 2 === 0;
      const height = over
        ? warp * 0.62 + weft * 0.38
        : weft * 0.62 + warp * 0.38;
      const g = grain[y * size + x];
      h[y * size + x] = height * 0.85 + g * 0.15;
    }
  }
  return h;
}

/** Sobel a height field into a tangent-space normal map texture. */
function heightToNormalTexture(h, size, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function makeWeaveNormalMap(size = 512, threads = 64, seed = 1337) {
  const rand = mulberry32(seed);
  const h = weaveHeight(size, threads, rand);
  return heightToNormalTexture(h, size, 1.6);
}

/** Convert an uploaded grayscale height/bump image into a normal map. */
export function normalMapFromImage(img, size = 512, strength = 1.6) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) {
    // perceptual luminance as height
    h[i] = (data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722) / 255;
  }
  return heightToNormalTexture(h, size, strength);
}

/** Subtle grain map used as roughness variation — keeps the matte finish alive. */
export function makeGrainRoughnessMap(size = 256, seed = 4242) {
  const rand = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let i = 0; i < size * size; i++) {
    // mid-gray with mild noise; roughnessMap multiplies material.roughness
    const v = Math.round(215 + (rand() - 0.5) * 70);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}


// ---------------------------------------------------------------------------
// Port additions. Everything below is new in the port, not upstream code.
// ---------------------------------------------------------------------------

/**
 * Scratch height field for the default bump map. Upstream loads
 * bump-scratches.jpg: a near-white field with thin gray scratches at random
 * angles. This canvas draws the same kind of field. The bright field is the
 * base height, and each scratch is a shallow groove. normalMapFromImage()
 * turns it into the normal map, the same path the upstream JPEG takes.
 */
export function makeScratchHeight(size = 1024, seed = 9107) {
  const rand = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = 'round';
  // draw each scratch in the 3x3 tile copies, so the map tiles seamlessly
  const stroke = (x0, y0, x1, y1, bend) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const dx = ox * size, dy = oy * size;
        ctx.beginPath();
        ctx.moveTo(x0 + dx, y0 + dy);
        ctx.quadraticCurveTo((x0 + x1) / 2 + bend + dx, (y0 + y1) / 2 - bend + dy, x1 + dx, y1 + dy);
        ctx.stroke();
      }
    }
  };
  // two dominant scratch directions plus a random scatter, like handled foil
  const families = [-1.05, -0.55, 0.3];
  for (let i = 0; i < 520; i++) {
    const fam = rand();
    const base = fam < 0.45 ? families[0] : fam < 0.75 ? families[1] : families[2] + rand() * 3;
    const ang = base + (rand() - 0.5) * 0.35;
    const len = size * (0.04 + Math.pow(rand(), 2.2) * 0.55);
    const x0 = rand() * size, y0 = rand() * size;
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const g = Math.round(150 + rand() * 90);
    ctx.strokeStyle = `rgba(${g},${g},${g},${0.18 + rand() * 0.5})`;
    ctx.lineWidth = 0.6 + Math.pow(rand(), 3) * 1.8;
    stroke(x0, y0, x1, y1, (rand() - 0.5) * len * 0.08);
  }
  // fine pits and dust
  for (let i = 0; i < 2600; i++) {
    const g = Math.round(170 + rand() * 70);
    ctx.fillStyle = `rgba(${g},${g},${g},${0.25 + rand() * 0.5})`;
    const r = 0.4 + Math.pow(rand(), 4) * 1.6;
    ctx.fillRect(rand() * size, rand() * size, r, r);
  }
  return c;
}

/**
 * Default cloth art. Upstream starts with holo-bg-2.jpg, a 2:3 poster: a
 * soft pastel gradient, a line rosette of four circles, corner marks, and a
 * block of type at the base. The foil shader tints and covers most of it,
 * so the port draws the same layout on a canvas and ships no poster file.
 */
export function makePosterCanvas(width = 1024, height = 1536, seed = 311) {
  const rand = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  const W = width, H = height;

  // 1. pastel gradient field: soft color blobs over a pale base
  ctx.fillStyle = '#c9d4f4';
  ctx.fillRect(0, 0, W, H);
  const blobs = [
    [0.12, 0.08, 0.55, '#fbe9f1'],
    [0.85, 0.12, 0.55, '#8f7cf0'],
    [0.62, 0.30, 0.45, '#5d74f2'],
    [0.30, 0.38, 0.45, '#7fb2ff'],
    [0.48, 0.55, 0.40, '#7fe6f2'],
    [0.95, 0.52, 0.40, '#c9a6f5'],
    [0.10, 0.60, 0.40, '#9fd0ff'],
    [0.18, 0.78, 0.42, '#f8e27a'],
    [0.55, 0.76, 0.35, '#b9e6c8'],
    [0.85, 0.82, 0.45, '#f7a9c8'],
    [0.35, 0.95, 0.50, '#ff9a6b'],
    [0.80, 0.98, 0.40, '#f58fb0'],
  ];
  for (const [x, y, r, col] of blobs) {
    const g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W);
    g.addColorStop(0, col);
    g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // print grain
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  // 2. line rosette: four circles, pinched dark joints, a center cluster
  const S = W / 400; // layout measured on a 400 x 600 grid
  const cx = [115, 285], cy = [175, 340], R = 110;
  ctx.strokeStyle = '#0c0c14';
  ctx.lineWidth = 1.2 * S;
  for (const y of cy) for (const x of cx) {
    ctx.beginPath();
    ctx.arc(x * S, y * S, R * S, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#0c0c14';
  const star = (x, y, r) => {
    // concave four-point joint, like two arcs pinched together
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a0 = (k * Math.PI) / 2, a1 = a0 + Math.PI / 2;
      const px = x + Math.cos(a0) * r, py = y + Math.sin(a0) * r;
      const qx = x + Math.cos(a1) * r, qy = y + Math.sin(a1) * r;
      if (k === 0) ctx.moveTo(px, py);
      ctx.quadraticCurveTo(x, y, qx, qy);
    }
    ctx.fill();
  };
  const hx = 200, hy = 257.5, dx = 72.8, dy = 70;
  star(hx * S, (175 - dy) * S, 11 * S);
  star(hx * S, (340 + dy) * S, 11 * S);
  star((115 - dx) * S, hy * S, 11 * S);
  star((285 + dx) * S, hy * S, 11 * S);
  star((115 + dx) * S, hy * S, 9 * S);
  star((285 - dx) * S, hy * S, 9 * S);
  star(hx * S, (175 + dy) * S, 9 * S);
  star(hx * S, (340 - dy) * S, 9 * S);
  // center cluster: a dark diamond with four pale lenses
  star(hx * S, hy * S, 26 * S);
  ctx.fillStyle = '#8fe4f4';
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.arc((hx + Math.cos(a) * 9) * S, (hy + Math.sin(a) * 9) * S, 5.6 * S, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. corner marks: a small orbit badge, a label, a disc
  ctx.strokeStyle = '#1b1c40';
  ctx.fillStyle = '#1b1c40';
  ctx.lineWidth = 1.2 * S;
  ctx.beginPath();
  ctx.ellipse(30 * S, 42 * S, 16 * S, 8 * S, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(30 * S, 42 * S, 3 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 ${6 * S}px ui-monospace, Menlo, monospace`;
  ctx.fillText('HOLOCLOTH', 12 * S, 20 * S);
  ctx.fillText('N° 0185', 360 * S, 20 * S);
  ctx.font = `500 ${3.4 * S}px ui-monospace, Menlo, monospace`;
  ctx.fillText('VERLET FIELD', 52 * S, 38 * S);
  ctx.fillText('ZERO GRAVITY', 52 * S, 43 * S);
  ctx.fillText('SERIES 03', 52 * S, 48 * S);
  ctx.beginPath();
  ctx.arc(376 * S, 42 * S, 11 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9d4f4';
  ctx.beginPath();
  ctx.arc(376 * S, 42 * S, 2.4 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1c40';
  ctx.fillRect(310 * S, 40 * S, 44 * S, 0.8 * S);

  // 4. type block at the base: dot-matrix type, red over dark. The lines
  // are drawn solid on a scratch canvas, then sampled on a dot grid.
  const lines = [
    'EVERY FOLD IN THE FOIL IS A',
    'WAVE THAT FORGOT TO MOVE.',
    'THIS ONE KEPT ITS COLOR.',
    'WITH FINE FLAKES AND A',
    'LITTLE GEL IN THE WEAVE',
    'AND NO RESPECT FOR GRAVITY.',
  ];
  const tc = document.createElement('canvas');
  tc.width = W; tc.height = H;
  const tx = tc.getContext('2d');
  tx.font = `700 ${19 * S}px ui-monospace, Menlo, Consolas, monospace`;
  tx.fillStyle = '#000';
  for (let i = 0; i < lines.length; i++) {
    const y = (478 + i * 20.5) * S;
    // stretch each line to the text column width, like justified type
    const m = tx.measureText(lines[i]).width;
    tx.save();
    tx.translate(14 * S, y);
    tx.scale((372 * S) / m, 1);
    tx.fillText(lines[i], 0, 0);
    tx.restore();
  }
  const y0 = Math.floor(455 * S), y1 = Math.ceil(595 * S);
  const td = tx.getImageData(0, y0, W, y1 - y0).data;
  const step = Math.max(3, Math.round(1.05 * S));
  const dotR = step * 0.36;
  for (let y = 0; y < y1 - y0; y += step) {
    const line = Math.floor(((y + y0) / S - 460) / 20.5);
    ctx.fillStyle = line < 2 ? 'rgba(226,40,46,0.9)' : line < 4 ? 'rgba(92,30,60,0.8)' : 'rgba(60,24,70,0.8)';
    for (let x = 0; x < W; x += step) {
      if (td[(y * W + x) * 4 + 3] < 128) continue;
      ctx.beginPath();
      ctx.arc(x, y + y0, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}
