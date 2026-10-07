// ============================================================================
//  PHOTON CAUSTICS 2D  ·  flight.js — photons in flight at a slowed c
// ----------------------------------------------------------------------------
//  The light image (render2d.js) adds whole photon paths: there, light is
//  instant. This module shows the same light at a slowed speed c, so the
//  eye can follow it. The light emits pulses of photons; each frame each
//  photon goes the light distance c dt, that is c dt / n in a medium of
//  index n (optics2d.advance). So a pulse slows down and its wave front
//  bends where it goes into glass or water.
//
//  PULSES. A new pulse starts each time the light clock passes SPACING
//  (light distance), so the pulse rate is c / SPACING and c = 0 stops all.
//  A pulse of a beam is a flat wave front across the beam; it starts
//  where the beam comes into the view, not at the far world box.
//
//  DRAW. build() writes triangles for render2d.drawFlight: per vertex
//  x y r g b a qx qy (q: the place in the soft disc or strip, -1..1).
//    trail ... a strip from the head back to the light distance L - TRAIL,
//              alpha falls to 0 at the tail. In a medium the trail is
//              shorter by 1/n: the photon went less far in that time.
//    head .... a soft disc at the photon.
//
//  The top-down pool (topdown.js) gives its own emit and advance, and a
//  size for each head (larger is nearer the eye).
//
//  EXPORTS
//    createFlight({ phone, per, emit, advance }) -> { step, build, clear, count, pulses }
//      step(scene, D, P) ... emit and move the photons by the light
//                            distance D = c dt
//      build(px) ........... vertex data, px = world units per CSS px
// ============================================================================
import { emitPulse, advance } from './optics2d.js';

export const SPACING = 0.75;   // light distance between pulses
export const TRAIL = 0.32;     // trail length, as a light distance

export function createFlight(opt = {}) {
  const PER = opt.per || (opt.phone ? 70 : 100), MAX = opt.phone ? 1800 : 3000;
  const emit = opt.emit || emitPulse, move = opt.advance || advance;
  let photons = [], clock = SPACING, verts = new Float32Array(0), pulses = 0;
  return {
    get count() { return photons.length; },
    get pulses() { return pulses; },
    clear() { photons = []; clock = SPACING; },
    step(scene, D, P) {
      clock += D;
      if (clock >= SPACING) {
        clock %= SPACING;
        if (photons.length < MAX) { photons.push(...emit(scene, PER, Math.random, P)); pulses++; }
      }
      if (D <= 0) return;
      let j = 0;
      for (const ph of photons) {
        move(scene, ph, D);
        // keep a photon while any of its trail shows
        if (ph.L - TRAIL < ph.end) photons[j++] = ph;
      }
      photons.length = j;
    },
    // px: world units per CSS pixel. Returns { verts, count } (vertices).
    build(px) {
      const hw = 0.8 * px, hr0 = 2.3 * px;
      let need = 0;
      for (const ph of photons) if (ph.trail) need += (ph.trail.length / 3 + 2) * 6 + 6;
      if (verts.length < need * 8) verts = new Float32Array(Math.ceil(need * 1.4) * 8);
      let k = 0;
      const put = (x, y, c, a, qx, qy) => { verts[k++] = x; verts[k++] = y; verts[k++] = c[0]; verts[k++] = c[1]; verts[k++] = c[2]; verts[k++] = a; verts[k++] = qx; verts[k++] = qy; };
      const seg = (x0, y0, a0, x1, y1, a1, c) => {
        let dx = x1 - x0, dy = y1 - y0; const l = Math.hypot(dx, dy); if (l < 1e-9) return;
        const nx = -dy / l * hw, ny = dx / l * hw;
        put(x0 + nx, y0 + ny, c, a0, 0, 1); put(x1 + nx, y1 + ny, c, a1, 0, 1); put(x0 - nx, y0 - ny, c, a0, 0, -1);
        put(x1 + nx, y1 + ny, c, a1, 0, 1); put(x1 - nx, y1 - ny, c, a1, 0, -1); put(x0 - nx, y0 - ny, c, a0, 0, -1);
      };
      for (const ph of photons) {
        const tr = ph.trail; if (!tr) continue;
        const c = ph.col, m = Math.max(c[0], c[1], c[2]) || 1;
        const col = [0.45 + 0.55 * c[0] / m, 0.45 + 0.55 * c[1] / m, 0.45 + 0.55 * c[2] / m];
        const Lh = Math.min(ph.L, ph.end), L0 = ph.L - TRAIL, w = Math.min(1, ph.w * 1.2);
        const alpha = L => w * Math.max(0, 1 - (ph.L - L) / TRAIL);
        // from the head back along the corners
        let hx = ph.x, hy = ph.y, hl = Lh;
        for (let i = tr.length - 3; i >= 0 && hl > L0; i -= 3) {
          let x = tr[i], y = tr[i + 1], l = tr[i + 2];
          if (l >= hl) { hx = x; hy = y; hl = l; continue; }
          if (l < L0) { const f = (hl - L0) / (hl - l); x = hx + (x - hx) * f; y = hy + (y - hy) * f; l = L0; }
          seg(x, y, alpha(l), hx, hy, alpha(hl), col);
          hx = x; hy = y; hl = l;
        }
        if (ph.end === Infinity) {
          const a = w, hr = hr0 * (ph.size || 1);
          put(ph.x - hr, ph.y - hr, col, a, -1, -1); put(ph.x + hr, ph.y - hr, col, a, 1, -1); put(ph.x - hr, ph.y + hr, col, a, -1, 1);
          put(ph.x + hr, ph.y - hr, col, a, 1, -1); put(ph.x + hr, ph.y + hr, col, a, 1, 1); put(ph.x - hr, ph.y + hr, col, a, -1, 1);
        }
        // drop corners the trail no longer reaches (keep one for the tail)
        let cut = 0; while (cut + 5 < tr.length && tr[cut + 5] < L0) cut += 3;
        if (cut) tr.splice(0, cut);
      }
      return { verts, count: k / 8 };
    },
  };
}
