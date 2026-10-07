// ============================================================================
//  DICE LAB  ·  recog.js — camera recognition, a second check on the reader
// ----------------------------------------------------------------------------
//  The physics reader (dice.js readDie) knows each die's rotation. This file
//  reads the dice from pixels only, and the page compares the two.
//
//  1. CAMERA. An orthographic camera looks straight down at the felt, K px
//     per cm. Image x is world +x, image y is world +z. Two frames go into
//     a render target: the tray with no dice (the background) and the tray
//     with the dice. Shadows (of the dice and the rim), the labels and the
//     glass spots are off for both frames (a light box, as on a real
//     dice-reading rig).
//  2. FIND. A pixel is foreground when its RGB differs from the background
//     by more than DIFF. Connected regions (4-neighbour) larger than a
//     third of the smallest die are blobs. A blob that holds more than one
//     die centre is split by the nearest centre; this uses the physics
//     positions, so the page reports how many blobs it had to split.
//  3. TYPE. The die type of a blob comes from the nearest body. The page
//     says so; the number comes from the pixels alone.
//  4. NUMBER. Templates come from the die's own face atlas (facetex.js):
//     for each face that can be up (for a d4, each face that can be down),
//     a small software rasteriser draws the top view of the die at yaw 0,
//     K px per cm, in luminance, with Lambert shading from above. The
//     image patch around the blob centre is sampled at 60 yaw angles (6°
//     steps), and each template is scored by normalised cross-correlation
//     (NCC) over its own mask. The best two get a 1° and 1.5 px refine. The
//     best (face, yaw) wins. A template holds only the top face (n.y >
//     0.97), whose look depends least on the light; a d4 has no top face,
//     so it keeps its three upper faces.
//
//  GREP MAP
//    function templates ......... the per-face top views
//    function blobs ............. background difference + regions
//    function ncc ............... one template at one yaw
//    export function createRecognizer  the whole pass
// ============================================================================
import { buildDie, orientFor, Q, V } from './dice.js';
import { makeAtlas } from './facetex.js';

const K = 40;          // px per cm
const DIFF = 24;       // |dR| + |dG| + |dB| for a foreground pixel

// luminance of an atlas (0..1), cached on the atlas
function atlasLum(A) {
  if (A.lum) return A.lum;
  const d = A.color.getContext('2d').getImageData(0, 0, A.size, A.size).data, L = new Float32Array(A.size * A.size);
  for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  A.lum = L;
  return L;
}

// templates: one per face that can rest up; each is { face, pts: Float32Array
// [dx, dy, value]*, n }
const tplCache = new Map();
function templates(die, finish, style) {
  const key = `${die.type}|${finish}|${style}`;
  if (tplCache.has(key)) return tplCache.get(key);
  const A = makeAtlas(die, finish, style), L = atlasLum(A), S = A.size, cols = die.cols;
  const list = [];
  const cand = die.type === 'd4' ? die.faces.map((f, i) => i) : die.faces.map((f, i) => i).filter(i => die.faces[i].valued);
  for (const u of cand) {
    const q = orientFor(die, u, 0), qi = Q.conj(q);
    const R = Math.ceil(die.R * K) + 1, buf = new Map();
    for (const f of die.faces) {
      const n = Q.rot(q, f.n);
      // only the top face (its look depends least on the light); a d4 has
      // no top face, so it keeps its three upper faces
      if (n[1] < (die.type === 'd4' ? 0.12 : 0.97)) continue;
      const shade = 0.35 + 0.65 * n[1];
      const P = f.inset.map(p => Q.rot(q, p));            // world, centre at 0
      const xs = P.map(p => p[0] * K), ys = P.map(p => p[2] * K);
      const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
      const inside = (x, y) => { let s = 0; for (let k = 0; k < xs.length; k++) { const j = (k + 1) % xs.length; const c = (xs[j] - xs[k]) * (y - ys[k]) - (ys[j] - ys[k]) * (x - xs[k]); if (c > 0) s |= 1; else if (c < 0) s |= 2; if (s === 3) return false; } return true; };
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        // the point on the face plane under pixel (x, y), in the body frame
        const wx = x / K, wz = y / K;
        // plane: n . p = n . P0  ->  y from x, z
        const yy = (V.dot(n, P[0]) - n[0] * wx - n[2] * wz) / n[1];
        const pb = Q.rot(qi, [wx, yy, wz]);
        const [ux, uy] = f.to2(pb);
        const ax = Math.min(S - 1, Math.max(0, Math.round(((f.cell % cols) + 0.5 + ux) * S / cols))), ay = Math.min(S - 1, Math.max(0, Math.round((Math.floor(f.cell / cols) + 0.5 - uy) * S / cols)));
        buf.set(y * 4096 + x, L[ay * S + ax] * shade);
      }
    }
    const pts = new Float32Array(buf.size * 3); let k = 0;
    for (const [key2, v] of buf) { const y = Math.round(key2 / 4096), x = key2 - y * 4096; pts[k++] = x; pts[k++] = y; pts[k++] = v; }
    // centre the template values (NCC needs mean and norm)
    let m = 0; for (let i = 2; i < pts.length; i += 3) m += pts[i]; m /= buf.size;
    let s2 = 0; for (let i = 2; i < pts.length; i += 3) { pts[i] -= m; s2 += pts[i] * pts[i]; }
    list.push({ face: u, value: die.faces[u].value, label: die.faces[u].label, pts, n: buf.size, norm: Math.sqrt(s2) || 1, R });
  }
  tplCache.set(key, list);
  return list;
}

// bilinear luminance sample of an image (Float32 lum, w, h)
function samp(I, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 0;
  const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, i = yi * w + xi;
  return I[i] * (1 - fx) * (1 - fy) + I[i + 1] * fx * (1 - fy) + I[i + w] * (1 - fx) * fy + I[i + w + 1] * fx * fy;
}
// NCC of template T at yaw a, centre (cx, cy)
function ncc(T, I, w, h, cx, cy, a) {
  const c = Math.cos(a), s = Math.sin(a), P = T.pts;
  let si = 0, sii = 0, sti = 0;
  for (let k = 0; k < P.length; k += 3) {
    const dx = P[k], dy = P[k + 1];
    // yaw a about world up turns (x, z) to (x c + z s, -x s + z c)
    const v = samp(I, w, h, cx + dx * c + dy * s, cy - dx * s + dy * c);
    si += v; sii += v * v; sti += v * P[k + 2];
  }
  const n = T.n, varI = sii - si * si / n;
  return varI > 1e-9 ? sti / (Math.sqrt(varI) * T.norm) : 0;
}

function blobs(fg, bgd, w, h, minArea) {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(fg[i * 4] - bgd[i * 4]) + Math.abs(fg[i * 4 + 1] - bgd[i * 4 + 1]) + Math.abs(fg[i * 4 + 2] - bgd[i * 4 + 2]);
    mask[i] = d > DIFF ? 1 : 0;
  }
  // close holes (glass dice let the felt through): dilate twice, then
  // erode twice (a closing of radius 2 px)
  const step = (src, grow) => {
    const o = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; o[i] = grow ? src[i] | src[i - 1] | src[i + 1] | src[i - w] | src[i + w] : src[i] & src[i - 1] & src[i + 1] & src[i - w] & src[i + w]; }
    return o;
  };
  const cl = step(step(step(step(mask, true), true), false), false);
  const lab = new Int32Array(w * h).fill(-1), out = [];
  const st = [];
  for (let i = 0; i < w * h; i++) {
    if (!cl[i] || lab[i] >= 0) continue;
    const id = out.length, px = [];
    lab[i] = id; st.push(i);
    while (st.length) {
      const j = st.pop(); px.push(j);
      const x = j % w, y = (j / w) | 0;
      if (x > 0 && cl[j - 1] && lab[j - 1] < 0) { lab[j - 1] = id; st.push(j - 1); }
      if (x < w - 1 && cl[j + 1] && lab[j + 1] < 0) { lab[j + 1] = id; st.push(j + 1); }
      if (y > 0 && cl[j - w] && lab[j - w] < 0) { lab[j - w] = id; st.push(j - w); }
      if (y < h - 1 && cl[j + w] && lab[j + w] < 0) { lab[j + w] = id; st.push(j + w); }
    }
    out.push({ id, px });
  }
  return { list: out.filter(b => b.px.length >= minArea), lab, mask: cl };
}

export function createRecognizer(sc) {
  const { THREE, renderer, scene } = sc;
  let rt = null;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300);
  cam.up.set(0, 0, -1);
  cam.position.set(0, 120, 0); cam.lookAt(0, 0, 0);

  function grab(W, H) {
    const buf = new Uint8Array(W * H * 4);
    renderer.setRenderTarget(rt); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    renderer.setRenderTarget(null);
    // GL rows run bottom-up: flip to image rows
    const out = new Uint8Array(W * H * 4), row = W * 4;
    for (let y = 0; y < H; y++) out.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    return out;
  }

  // entries: [{ mesh, type, finish, style, read }]; returns a report
  function run(entries) {
    const [w, d] = sc.dims, W = Math.round(w * K), H = Math.round(d * K);
    if (!rt || rt.width !== W || rt.height !== H) { if (rt) rt.dispose(); rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 }); rt.texture.colorSpace = THREE.SRGBColorSpace; }
    Object.assign(cam, { left: -w / 2, right: w / 2, top: d / 2, bottom: -d / 2 }); cam.updateProjectionMatrix();
    // the light box: no die shadows, no labels, no glass spots
    const keep = { labels: sc.labelGroup.visible, fx: sc.fxGroup.visible, dice: sc.diceGroup.visible, bg: scene.background };
    const casters = [...sc.diceGroup.children, ...sc.tray.children], casts = casters.map(m => m.castShadow);
    casters.forEach(m => { m.castShadow = false; });
    sc.labelGroup.visible = false; sc.fxGroup.visible = false;
    sc.diceGroup.visible = false;
    const bgd = grab(W, H);
    sc.diceGroup.visible = true;
    const fg = grab(W, H);
    casters.forEach((m, i) => { m.castShadow = casts[i]; });
    sc.labelGroup.visible = keep.labels; sc.fxGroup.visible = keep.fx; sc.diceGroup.visible = keep.dice;
    const t0 = performance.now();
    // luminance of the dice frame
    const I = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) I[i] = (0.2126 * fg[i * 4] + 0.7152 * fg[i * 4 + 1] + 0.0722 * fg[i * 4 + 2]) / 255;
    const minR = Math.min(...entries.map(e => buildDie(e.type).R));
    const B = blobs(fg, bgd, W, H, Math.PI * (minR * K) ** 2 * 0.25);
    // projected centres of the bodies (for the type and for splits only)
    const cen = entries.map(e => [(e.mesh.position.x + w / 2) * K, (e.mesh.position.z + d / 2) * K]);
    const owner = entries.map(() => -1);
    cen.forEach(([x, y], i) => {
      const xi = Math.round(x), yi = Math.round(y);
      let id = xi >= 0 && yi >= 0 && xi < W && yi < H ? B.lab[yi * W + xi] : -1;
      if (id < 0 || !B.list.some(b => b.id === id)) {
        // nearest blob centroid within the die radius
        let best = -1, bd = (buildDie(entries[i].type).R * K * 1.2) ** 2;
        for (const b of B.list) { if (!b.c) { let sx = 0, sy = 0; for (const j of b.px) { sx += j % W; sy += (j / W) | 0; } b.c = [sx / b.px.length, sy / b.px.length]; } const dd = (b.c[0] - x) ** 2 + (b.c[1] - y) ** 2; if (dd < bd) { bd = dd; best = b.id; } }
        id = best;
      }
      owner[i] = id;
    });
    let split = 0;
    const results = entries.map((e, i) => {
      const die = buildDie(e.type);
      const blob = B.list.find(b => b.id === owner[i]);
      if (!blob) return { i, found: false };
      const mates = owner.map((o, j) => o === owner[i] ? j : -1).filter(j => j >= 0);
      let sx = 0, sy = 0, n = 0;
      for (const j of blob.px) {
        const x = j % W, y = (j / W) | 0;
        if (mates.length > 1) {
          let near = -1, nd = 1e18;
          for (const m of mates) { const dd = (cen[m][0] - x) ** 2 + (cen[m][1] - y) ** 2; if (dd < nd) { nd = dd; near = m; } }
          if (near !== i) continue;
        }
        sx += x; sy += y; n++;
      }
      if (mates.length > 1) split++;
      if (!n) return { i, found: false };
      const cx = sx / n, cy = sy / n;
      const T = templates(die, e.finish, e.style);
      let best = null;
      const STEP = Math.PI / 30;
      // coarse pass over 60 yaws for each template, keep the best two
      const per = T.map(t => { let bs = -2, ba = 0; for (let a = 0; a < 2 * Math.PI; a += STEP) { const s = ncc(t, I, W, H, cx, cy, a); if (s > bs) { bs = s; ba = a; } } return { t, s: bs, a: ba }; }).sort((p, q) => q.s - p.s);
      // refine the best two: yaw +-6 deg in 1 deg steps, centre +-1.5 px
      const scoreAtXY = (t, a, ox, oy) => { const s = ncc(t, I, W, H, cx + ox, cy + oy, a); if (!best || s > best.s) best = { s, t, a, ox, oy }; };
      for (const c of per.slice(0, 2)) for (let da = -STEP; da <= STEP + 1e-9; da += STEP / 6) for (const ox of [-1.5, 0, 1.5]) for (const oy of [-1.5, 0, 1.5]) scoreAtXY(c.t, c.a + da, ox, oy);
      const second = per.find(p => p.t.label !== best.t.label);
      return { i, found: true, cx, cy, label: best.t.label, value: best.t.value, score: best.s, margin: best.s - (second ? second.s : 0), yaw: best.a, merged: mates.length > 1 };
    });
    const ms = performance.now() - t0;
    // the annotated image (half size)
    const img = document.createElement('canvas'); img.width = Math.round(W / 2); img.height = Math.round(H / 2);
    const g = img.getContext('2d'), id = new ImageData(new Uint8ClampedArray(fg.buffer.slice(0)), W, H);
    const full = document.createElement('canvas'); full.width = W; full.height = H; full.getContext('2d').putImageData(id, 0, 0);
    g.drawImage(full, 0, 0, img.width, img.height);
    return { W, H, K, blobs: B.list.length, split, results, ms, image: img, grab: { fg, bgd } };
  }
  return { run, K, dispose() { if (rt) rt.dispose(); } };
}
