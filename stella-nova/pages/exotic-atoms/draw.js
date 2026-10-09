// ============================================================================
//  EXOTIC ATOMS  ·  draw.js — overlays on a 2D context (no DOM)
// ----------------------------------------------------------------------------
//  The page, the saver, the node tests and the thumbnail script share these.
//  A view is the camera of circular-rydberg/cloud.js: orthographic, yaw
//  about z, then pitch about x, { yaw, pitch, scale (px per a), cx, cy }.
//  A pose { tilt, prec } turns the atom first: tilt about x, then a
//  precession about z (the Larmor demo). Units of positions: the scaled
//  atomic unit a of the species.
//
//  GREP MAP
//    export function poseRot ...... rotate a point by the pose
//    export function posePts ...... rotate a whole cloud (new array)
//    export function proj ......... pose + camera -> screen
//    export function lutColor ..... a 768-byte LUT -> css colour
//    export function drawFieldLines   streamlines (meridional or 3D)
//    export function drawFieldSlice   |B| image and arrows on y = 0
//    export function drawAxis ..... an arrow along a body axis
//    export function drawRing ..... the Bohr orbit
//    export function drawScaleBar
//    export function drawNucleus
//    export function drawLadder ... level diagram for the climb
//    export function drawPhoton ... a photon wave train, by wavelength
//    export function drawRuler .... log size ruler, fm to mm
// ============================================================================
import { project } from '../circular-rydberg/cloud.js';
import { SCALES, fmtLen } from './climb.js';

export function poseRot(pose, x, y, z) {
  if (!pose || (!pose.tilt && !pose.prec)) return [x, y, z];
  const ct = Math.cos(pose.tilt || 0), st = Math.sin(pose.tilt || 0);
  const y1 = ct * y - st * z, z1 = st * y + ct * z;
  const cp = Math.cos(pose.prec || 0), sp = Math.sin(pose.prec || 0);
  return [cp * x - sp * y1, sp * x + cp * y1, z1];
}
export function posePts(pts, pose, out) {
  if (!pose || (!pose.tilt && !pose.prec)) return pts;
  out = out && out.length === pts.length ? out : new Float32Array(pts.length);
  const ct = Math.cos(pose.tilt || 0), st = Math.sin(pose.tilt || 0), cp = Math.cos(pose.prec || 0), sp = Math.sin(pose.prec || 0);
  for (let i = 0; i < pts.length; i += 4) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2], y1 = ct * y - st * z, z1 = st * y + ct * z;
    out[i] = cp * x - sp * y1; out[i + 1] = sp * x + cp * y1; out[i + 2] = z1; out[i + 3] = pts[i + 3];
  }
  return out;
}
export const proj = (view, pose, x, y, z) => { const p = poseRot(pose, x, y, z); return project(view, p[0], p[1], p[2]); };
export function lutColor(lut, t, a = 1) {
  const i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
  return `rgba(${lut[i]},${lut[i + 1]},${lut[i + 2]},${a})`;
}

// field lines. lines: from bfield.fieldLines (rho, z pairs) drawn in
// `planes` meridional planes, or trace3D (x, y, z triples). Colour by
// log |B| between lo and hi through lut.
export function drawFieldLines(g, lines, view, { lut, pose = null, planes = 6, alpha = 0.85, lw = 1.4, lo = null, hi = null, reveal = 1, phase0 = 0 } = {}) {
  if (!lines || !lines.length) return;
  let mn = Infinity, mx = -Infinity;
  for (const L of lines) for (const v of L.mag) if (v > 0) { const q = Math.log10(v); if (q < mn) mn = q; if (q > mx) mx = q; }
  if (lo != null) mn = lo; if (hi != null) mx = hi;
  const span = Math.max(1e-6, mx - mn);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = lw;
  const seg = (P, mags) => {
    const n = mags.length, cut = Math.max(2, Math.floor(n * reveal)), mid = n >> 1, a0 = Math.max(0, mid - (cut >> 1)), a1 = Math.min(n, mid + (cut >> 1));
    for (let k = a0 + 1; k < a1; k++) {
      const t = mags[k] > 0 ? (Math.log10(mags[k]) - mn) / span : 0;
      g.strokeStyle = lutColor(lut, 0.15 + 0.85 * Math.max(0, Math.min(1, t)), alpha);
      g.beginPath(); g.moveTo(P[(k - 1) * 2], P[(k - 1) * 2 + 1]); g.lineTo(P[k * 2], P[k * 2 + 1]); g.stroke();
    }
  };
  for (const L of lines) {
    if (L.is3D) {
      const n = L.length / 3, P = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { const s = proj(view, pose, L[k * 3], L[k * 3 + 1], L[k * 3 + 2]); P[k * 2] = s[0]; P[k * 2 + 1] = s[1]; }
      seg(P, L.mag);
    } else {
      const n = L.length / 2;
      for (let p = 0; p < planes; p++) {
        const ph = phase0 + p / planes * 2 * Math.PI, c = Math.cos(ph), s = Math.sin(ph), P = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) { const q = proj(view, pose, L[k * 2] * c, L[k * 2] * s, L[k * 2 + 1]); P[k * 2] = q[0]; P[k * 2 + 1] = q[1]; }
        seg(P, L.mag);
      }
    }
  }
}

// |B| on the x-z plane of the atom (y = 0, both half-planes), drawn as an
// image with the affine map of the orthographic camera; arrows optional.
// F: bfield.solveAxisym result. mk(w, h) makes a scratch canvas.
export function drawFieldSlice(g, F, view, { lut, pose = null, alpha = 0.55, mag = true, arrows = false, mk, every = 3 } = {}) {
  if (!F) return;
  const nt = F.nt, ntz = F.ntz, W = 2 * nt - 1, H = ntz;
  // plane basis: u along +x (rho), v along +z
  const o = proj(view, pose, 0, 0, 0), ex = proj(view, pose, 1, 0, 0), ez = proj(view, pose, 0, 0, 1);
  const ux = ex[0] - o[0], uy = ex[1] - o[1], vx = ez[0] - o[0], vy = ez[1] - o[1];
  if (mag && mk) {
    let mn = Infinity, mx = -Infinity; const L = new Float32Array(W * H);
    for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
      const k = Math.abs(i - (nt - 1)), b = Math.hypot(F.Br[k * ntz + j], F.Bz[k * ntz + j]), q = b > 0 ? Math.log10(b) : -99;
      L[j * W + i] = q; if (q > -99) { if (q < mn) mn = q; if (q > mx) mx = q; }
    }
    mn = Math.max(mn, mx - 3.5);
    const cv = mk(W, H), cg = cv.getContext('2d'), img = cg.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const t = Math.max(0, Math.min(1, (L[j * W + i] - mn) / (mx - mn || 1))), c = Math.round(t * 255) * 3, p = ((H - 1 - j) * W + i) * 4;
      // fade to the grid edge so the slice has no hard border
      const ex = Math.abs(i - (nt - 1)) / (nt - 1), ez = Math.abs(j - (ntz - 1) / 2) / ((ntz - 1) / 2), fade = Math.max(0, 1 - Math.pow(Math.max(ex, ez), 6));
      img.data[p] = lut[c]; img.data[p + 1] = lut[c + 1]; img.data[p + 2] = lut[c + 2]; img.data[p + 3] = Math.round(255 * alpha * Math.pow(t, 1.2) * fade);
    }
    cg.putImageData(img, 0, 0);
    // image pixel (i, jj) -> plane (x, z) = (-E + i hr, E - jj hz)
    g.save();
    const a = ux * F.hr, b = uy * F.hr, c2 = -vx * F.hz, d = -vy * F.hz;
    const e = o[0] - ux * F.E + vx * F.E, f = o[1] - uy * F.E + vy * F.E;
    g.transform(a, b, c2, d, e, f);
    g.imageSmoothingEnabled = true;
    g.drawImage(cv, -0.5, -0.5);
    g.restore();
  }
  if (arrows) {
    let mx = 0;
    for (let k = 0; k < F.Br.length; k++) mx = Math.max(mx, Math.hypot(F.Br[k], F.Bz[k]));
    const len = Math.hypot(ux, uy) * F.hr * every * 0.8;
    g.lineWidth = 1.2;
    for (let i = -(nt - 1); i <= nt - 1; i += every) for (let j = 0; j < ntz; j += every) {
      const k = Math.abs(i), br = F.Br[k * ntz + j] * Math.sign(i || 1), bz = F.Bz[k * ntz + j], m = Math.hypot(br, bz);
      if (!m) continue;
      const x = i * F.hr, z = -F.E + j * F.hz, p0 = proj(view, pose, x, 0, z), p1 = proj(view, pose, x + br / m, 0, z + bz / m);
      let dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      const t = Math.max(0, Math.min(1, 1 + Math.log10(m / mx) / 3.5)), L = len * (0.35 + 0.65 * t);
      g.strokeStyle = lutColor(lut, 0.3 + 0.7 * t, 0.9);
      const x1 = p0[0] + dx * L, y1 = p0[1] + dy * L;
      g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(x1, y1);
      g.moveTo(x1, y1); g.lineTo(x1 - dx * 4 - dy * 3, y1 - dy * 4 + dx * 3);
      g.moveTo(x1, y1); g.lineTo(x1 - dx * 4 + dy * 3, y1 - dy * 4 - dx * 3); g.stroke();
    }
  }
}
export function drawAxis(g, view, pose, dir, len, { col = '#9fd0ff', label = '', lw = 2 } = {}) {
  const a = proj(view, pose, 0, 0, 0), b = proj(view, pose, dir[0] * len, dir[1] * len, dir[2] * len);
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw;
  g.beginPath(); g.moveTo(a[0] - ux * d, a[1] - uy * d); g.lineTo(b[0], b[1]); g.stroke();
  g.beginPath(); g.moveTo(b[0] + ux * 9, b[1] + uy * 9); g.lineTo(b[0] - uy * 5, b[1] + ux * 5); g.lineTo(b[0] + uy * 5, b[1] - ux * 5); g.fill();
  if (label) { g.font = '500 13px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(label, b[0] + 12, b[1] + 4); }
}
export function drawRing(g, view, pose, R, { col = 'rgba(255,214,102,0.8)', lw = 1.5 } = {}) {
  g.strokeStyle = col; g.lineWidth = lw; g.setLineDash([5, 4]); g.beginPath();
  for (let k = 0; k <= 120; k++) { const a = k / 120 * 2 * Math.PI, p = proj(view, pose, R * Math.cos(a), R * Math.sin(a), 0); k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }
  g.stroke(); g.setLineDash([]);
}
export function drawNucleus(g, view, { col = 'rgba(255,240,220,0.9)', r = 2.2 } = {}) {
  g.fillStyle = col; g.beginPath(); g.arc(view.cx, view.cy, r, 0, 2 * Math.PI); g.fill();
}
// a round length near a fifth of the width; aM = metres per scaled unit
export function drawScaleBar(g, w, h, view, aM, { col = 'rgba(232,234,240,0.8)', right = 16, bottom = 18 } = {}) {
  const target = w * 0.2 / view.scale * aM, pow = Math.pow(10, Math.floor(Math.log10(target)));
  const len = [1, 2, 5, 10].map(k => k * pow).filter(x => x <= target).pop() || pow, px = len / aM * view.scale;
  g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(w - right - px, h - bottom); g.lineTo(w - right, h - bottom); g.stroke();
  g.fillStyle = col; g.font = '11px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(fmtLen(len), w - right, h - bottom - 7);
  return { len, px };
}

// ------------------------------------------------------------- the climb
// The level diagram: the binding energy on a log axis (top = 0, ionized).
// levels: [{ n, label, eV (binding, > 0) }]; cur: index; photons: recent
// steps [{ i0, i1, rgb, k (0..1 age) }].
export function drawLadder(g, x, y, w, h, { levels, cur, photons = [], title = '', ion = 0, eMin, eMax } = {}) {
  const lo = Math.log10(eMin), hi = Math.log10(eMax);
  const Y = e => y + 40 + (h - 52) * (Math.log10(e) - lo) / (hi - lo);   // deep levels at the bottom
  g.save();
  g.font = '500 12px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(232,234,240,0.75)'; g.textAlign = 'left';
  if (title) g.fillText(title, x, y + 8);
  // the continuum band at the top
  const grd = g.createLinearGradient(0, y + 14, 0, y + 36);
  grd.addColorStop(0, `rgba(255,170,110,${0.18 + 0.4 * ion})`); grd.addColorStop(1, 'rgba(255,170,110,0)');
  g.fillStyle = grd; g.fillRect(x, y + 14, w, 22);
  g.fillStyle = 'rgba(232,234,240,0.55)'; g.font = '11px Inter, system-ui, sans-serif'; g.fillText('ionized', x + w - 46, y + 28);
  let lastY = -1e9;
  levels.forEach((L, i) => {
    if (L.eV < eMin || L.eV > eMax) return;
    const yy = Y(L.eV), on = i === cur, past = i < cur;
    if (!on && Math.abs(yy - lastY) < 2.2 && i !== levels.length - 1) return;
    lastY = yy;
    g.strokeStyle = on ? 'rgba(255,214,140,1)' : past ? 'rgba(255,170,110,0.55)' : 'rgba(200,205,220,0.28)';
    g.lineWidth = on ? 2.4 : 1;
    g.beginPath(); g.moveTo(x + (on ? 0 : 10), yy); g.lineTo(x + w - (on ? 0 : 10), yy); g.stroke();
    if (on || L.tag) { g.fillStyle = on ? 'rgba(255,224,170,1)' : 'rgba(200,205,220,0.6)'; g.font = `${on ? 600 : 400} 11px Inter, system-ui, sans-serif`; g.fillText(L.label, x + w + 6, yy + 4); }
  });
  for (const p of photons) {
    if (p.i1 >= levels.length) continue;
    const a = levels[p.i0], b = levels[p.i1]; if (!a || !b) continue;
    const y0 = Y(Math.min(eMax, Math.max(eMin, a.eV))), y1 = p.ion ? y + 24 : Y(Math.min(eMax, Math.max(eMin, b.eV))), xx = x + w * (0.25 + 0.5 * (p.slot || 0));
    const al = Math.max(0, 1 - p.k);
    g.strokeStyle = `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},${al})`; g.fillStyle = g.strokeStyle; g.lineWidth = 2;
    const yt = y0 + (y1 - y0) * Math.min(1, p.k * 3);
    g.beginPath(); g.moveTo(xx, y0); g.lineTo(xx, yt); g.stroke();
    g.beginPath(); g.moveTo(xx, yt - 6); g.lineTo(xx - 4, yt + 2); g.lineTo(xx + 4, yt + 2); g.fill();
  }
  g.restore();
}
// A photon wave train from (x0, y0) toward (x1, y1); k = 0..1 progress.
// The drawn wavelength grows with log(lambda), so UV is tight and radio
// is long; rgb from physics.photonRGB.
export function drawPhoton(g, x0, y0, x1, y1, k, lam, rgb, { label = '', amp = 13 } = {}) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const wl = Math.max(5, Math.min(90, 7 + 9 * (Math.log10(lam) + 7.3)));   // px per wavelength
  const len = Math.min(L * 0.7, wl * 6), head = k * (L + len * 0.4);
  g.save(); g.lineWidth = 2; g.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = pass ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.25)`;
    g.lineWidth = pass ? 2.4 : 8;
    g.beginPath(); let started = false;
    for (let s = 0; s <= len; s += 1.5) {
      const d = head - s; if (d < 0 || d > L) continue;
      const env = Math.exp(-((s - len / 2) ** 2) / (2 * (len / 4) ** 2)), off = amp * env * Math.sin(2 * Math.PI * (d / wl));
      const px = x0 + ux * d + nx * off, py = y0 + uy * d + ny * off;
      started ? g.lineTo(px, py) : g.moveTo(px, py); started = true;
    }
    g.stroke();
  }
  if (label && head - len / 2 < L) {
    const d = Math.max(0, Math.min(L, head - len / 2));
    g.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`; g.font = '500 12px Inter, system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(label, x0 + ux * d + nx * (amp + 14), y0 + uy * d + ny * (amp + 14));
  }
  g.restore();
}

// log ruler from 1 fm to 1 mm with the SCALES and extra marks
// [{ name, m, col, hi }]
export function drawRuler(g, w, h, marks = []) {
  const lo = -15, hi = -3, X = m => 20 + (w - 40) * (Math.log10(m) - lo) / (hi - lo), y = h * 0.55;
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(232,234,240,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(20, y); g.lineTo(w - 20, y); g.stroke();
  g.font = '10px Inter, system-ui, sans-serif'; g.fillStyle = 'rgba(232,234,240,0.55)'; g.textAlign = 'center';
  const names = { '-15': '1 fm', '-12': '1 pm', '-9': '1 nm', '-6': '1 µm', '-3': '1 mm' };
  for (let e = lo; e <= hi; e++) { const x = X(10 ** e); g.beginPath(); g.moveTo(x, y - (e % 3 ? 3 : 7)); g.lineTo(x, y + (e % 3 ? 3 : 7)); g.stroke(); if (names[e]) g.fillText(names[e], x, y + 20); }
  const all = SCALES.map(s => ({ name: s.name, m: s.m, col: 'rgba(200,205,220,0.75)' })).concat(marks);
  all.sort((a, b) => a.m - b.m);
  let lastX = -1e9, row = 0;
  for (const s of all) {
    const x = X(s.m); row = x - lastX < 70 ? (row + 1) % 3 : 0; lastX = x;
    g.fillStyle = s.col; g.strokeStyle = s.col;
    g.beginPath(); g.arc(x, y, s.hi ? 4.5 : 3, 0, 2 * Math.PI); g.fill();
    const ty = y - 14 - row * 13;
    g.font = `${s.hi ? 600 : 400} 10px Inter, system-ui, sans-serif`; g.fillText(s.name, x, ty);
  }
}
