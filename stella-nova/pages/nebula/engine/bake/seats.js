// seats.js: legibility seat choice from the pass-1 luma, and the seat sources of pass 2 (spec 2.9).
// Owner: row A6. Spec: nebula-spec.md 2.4 (seat_N row), 2.9, 3.1, 7.4 (table).
//
// Exports (grep -n "^export"):
//   TOUR_SCROLLS                                       the 5 tour scrolls (0, 0.25, 0.5, 0.75, 1)
//   siteLuma(previewLuma, site, radiusPx) -> number    maximum over the scrolls of the disc mean, or -1
//   pickSeats(previewLuma, sites, comp) -> { kept, candidates, clamped }
//   seatQhat(rhoBar, comp) -> { qhat, clamped }
//   seatSources(kept, state, comp, ctx?) -> Source[]   (the array also has .clamped = [site ids])
//
// previewLuma (the pass-1 Preview-tier composite through the display chain of 3.4.2, map off):
//   { width: 960, height: 540, viewW: 1920, scrolls: [0, 0.25, 0.5, 0.75, 1],
//     frames: [Float32Array(width * height)] (display Y, one frame per scroll), rowsFromTop: false }
//   viewW is the frame width in canvas units. Rows go from the bottom unless rowsFromTop is true.
// sites: [{ id, x, y }] in content px (y up). A site sits on the route plane, p = 1, so its screen x at
// scroll s is x - s (3.1), with s = t (5760 - viewW).
// Only luma decides. The site type is never read (C4).

import { CONTENT_W, CONTENT_H, clampView, scrollRange, depthOf } from '../params.js';
import { readFloat } from '../gl/passes.js';

export const TOUR_SCROLLS = [0, 0.25, 0.5, 0.75, 1];

// B1 V type (2.1 table, seat_N row of 2.4). The influence radius is [I], the same as ro (B1 V).
const SEAT_STAR = { logQfuv: 47.9, logL: 4.0, teffK: 25000, influencePx: 600 };

// Mean display Y inside radiusPx (content px) of the site, at every scroll where the site centre is on
// screen; returns the maximum. -1 when the site is on screen at no scroll.
export function siteLuma(previewLuma, site, radiusPx) {
  const { width, height, frames } = previewLuma;
  const viewW = previewLuma.viewW || 1920;
  const scrolls = previewLuma.scrolls || TOUR_SCROLLS;
  const S = scrollRange(clampView(viewW));
  const sx = width / viewW, sy = height / CONTENT_H;
  const r2 = radiusPx * radiusPx;
  let best = -1;
  for (let f = 0; f < scrolls.length; f++) {
    const img = frames[f];
    if (!img) continue;
    const xs = site.x - scrolls[f] * S;
    if (xs < 0 || xs > viewW) continue;
    const i0 = Math.max(0, Math.floor((xs - radiusPx) * sx)), i1 = Math.min(width - 1, Math.ceil((xs + radiusPx) * sx));
    const j0 = Math.max(0, Math.floor((site.y - radiusPx) * sy)), j1 = Math.min(height - 1, Math.ceil((site.y + radiusPx) * sy));
    let sum = 0, n = 0;
    for (let j = j0; j <= j1; j++) {
      const yc = (j + 0.5) / sy - site.y;
      const row = previewLuma.rowsFromTop ? height - 1 - j : j;
      for (let i = i0; i <= i1; i++) {
        const xc = (i + 0.5) / sx - xs;
        if (xc * xc + yc * yc > r2) continue;
        sum += img[row * width + i]; n++;
      }
    }
    if (n > 0 && sum / n > best) best = sum / n;
  }
  return best;
}

// 2.9 step 3. Candidates: sites above the trigger. Kept: at most seats.max, the highest first
// (ties: the earlier site first). clamped is filled by seatSources, because it needs the restored density.
export function pickSeats(previewLuma, sites, comp) {
  const cfg = comp.seats || {};
  const trigger = Number.isFinite(cfg.lumaTrigger) ? cfg.lumaTrigger : 0.30;
  const radius = Number.isFinite(cfg.radiusPx) ? cfg.radiusPx : 34;
  const max = Number.isFinite(cfg.max) ? cfg.max : 15;
  const all = (sites || []).map((s, index) => ({ id: s.id, x: s.x, y: s.y, index, luma: siteLuma(previewLuma, s, radius) }));
  const cand = all.filter((s) => s.luma > trigger);
  cand.sort((a, b) => (b.luma - a.luma) || (a.index - b.index));
  const kept = cand.slice(0, max).map((s) => ({ id: s.id, x: s.x, y: s.y, luma: s.luma }));
  const keptIds = new Set(kept.map((s) => s.id));
  const candidates = cand.map((s) => ({ id: s.id, luma: s.luma, kept: keptIds.has(s.id) }));
  return { kept, candidates, clamped: [] };
}

// Seat Qhat = (r_b / 10)^3 rho_bar^2 / 3, clamped to seats.qhatClamp (2.9 step 4).
export function seatQhat(rhoBar, comp) {
  const cfg = comp.seats || {};
  const rb = Number.isFinite(cfg.rbPx) ? cfg.rbPx : 56;
  const [lo, hi] = cfg.qhatClamp || [26, 300];
  const raw = Math.pow(rb / 10, 3) * rhoBar * rhoBar / 3;
  const qhat = Math.min(hi, Math.max(lo, raw));
  return { qhat, raw, clamped: raw < lo || raw > hi };
}

// Mean rho inside a sphere of radius r px at (x, y, z). Voxel centres inside the sphere count.
// state.rhoAt(x, y, z) (a CPU function, for tests) is used when present. Otherwise the GPU path reads
// the R channel of the restored U texture (state.U, else registry state.uName, else 'U0').
function meanRho(state, ctx, x, y, z, r) {
  if (typeof state.rhoAt === 'function') {
    let sum = 0, n = 0;
    for (let dz = -r; dz <= r; dz += 10) for (let dy = -r; dy <= r; dy += 10) for (let dx = -r; dx <= r; dx += 10) {
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const yy = y + dy, zz = z + dz;
      if (yy < 0 || yy > CONTENT_H || zz < 0 || zz > 1920) continue;
      sum += state.rhoAt(((x + dx) % CONTENT_W + CONTENT_W) % CONTENT_W, yy, zz); n++;
    }
    return n ? sum / n : 0;
  }
  if (!ctx) throw new Error('[seats] seatSources needs ctx (or state.ctx, or state.rhoAt) to read U');
  const u = state.U && state.U.tex ? state.U : ctx.registry.get(state.uName || 'U0');
  if (!u) throw new Error('[seats] no live U texture for the seat density');
  const cx = CONTENT_W / u.w, cy = CONTENT_H / u.h, cz = 1920 / u.d;
  const j0 = Math.max(0, Math.floor((y - r) / cy)), j1 = Math.min(u.h - 1, Math.floor((y + r) / cy));
  const k0 = Math.max(0, Math.floor((z - r) / cz)), k1 = Math.min(u.d - 1, Math.floor((z + r) / cz));
  const i0 = Math.floor((x - r) / cx), i1 = Math.floor((x + r) / cx);
  // Split the x range at the seam so that each read is one rectangle.
  const spans = [];
  for (let i = i0; i <= i1;) {
    const iw = ((i % u.w) + u.w) % u.w;
    const len = Math.min(i1 - i + 1, u.w - iw);
    spans.push({ i, iw, len });
    i += len;
  }
  let sum = 0, n = 0;
  for (let k = k0; k <= k1; k++) {
    const zc = (k + 0.5) * cz - z;
    for (const sp of spans) {
      const h = j1 - j0 + 1;
      const data = readFloat(ctx, u, k, [sp.iw, j0, sp.len, h]);
      for (let jj = 0; jj < h; jj++) {
        const yc = (j0 + jj + 0.5) * cy - y;
        for (let ii = 0; ii < sp.len; ii++) {
          const xc = (sp.i + ii + 0.5) * cx - x;
          if (xc * xc + yc * yc + zc * zc > r * r) continue;
          sum += data[(jj * sp.len + ii) * 4]; n++;
        }
      }
    }
  }
  return n ? sum / n : 0;
}

// One seat_N source per kept site (2.4 seat_N row): site position at p 1.00, qMode 'qhat', B1 V type,
// the seat wind of comp.seats.wind. Call it after the restore from Snap. The returned array also carries
// .clamped = [site ids] for report.seats.clamped ("needs a route move").
export function seatSources(kept, state, comp, ctx) {
  const cfg = comp.seats || {};
  const rb = Number.isFinite(cfg.rbPx) ? cfg.rbPx : 56;
  const wind = Object.assign({ v: 6, rPx: 15, rho: 0.02, ejecta: false, step: 360 }, cfg.wind || {});
  const z = depthOf(1);
  const out = [];
  out.clamped = [];
  (kept || []).forEach((site, n) => {
    const rhoBar = meanRho(state, ctx || state.ctx, site.x, site.y, z, rb);
    const q = seatQhat(rhoBar, comp);
    if (q.clamped) out.clamped.push(site.id);
    out.push({
      id: `seat_${n + 1}`, kind: 'Seat', siteId: site.id,
      pos: [site.x, site.y, 1.0], qMode: 'qhat', qhat: q.qhat,
      logQfuv: SEAT_STAR.logQfuv, logL: SEAT_STAR.logL, teffK: SEAT_STAR.teffK, influencePx: SEAT_STAR.influencePx,
      wind: { ...wind },
      rhoBar, qhatRaw: q.raw, clamped: q.clamped,
    });
  });
  return out;
}
