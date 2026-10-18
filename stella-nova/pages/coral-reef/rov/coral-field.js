// ============================================================================
//  CORAL REEF  ·  ROV  ·  the coral term of the ROV distance field (DOM-free)
// ----------------------------------------------------------------------------
//  The ROV autopilot (pilot.js) and the tether keep a clearance from the
//  rock with rock.sdf. The corals grow to 8 m (reef.js SPECIES_SCALE), so
//  the ROVs must keep clear of them too. This is a dense grid (cell 0.5 m)
//  over the plot with the distance to the nearest coral particle, filled
//  from the reef (or its page mirror: count, px, py, pz) as particles come
//  in, a few thousand per frame. dist() is in the units of the ROV field
//  (rock.sdf, a bound that is 0.4 x metres): the field equals `clear` at
//  `clearM` metres from a particle centre, so the ROVs keep about clearM
//  metres from the coral skeleton.
//
//    const C = createCoralField({ radius, ymin, ymax, clear, clearM = 1.3 });
//    C.sync(reef, maxN = 3000) -> particles read this call (a new reef with
//                         fewer particles clears the grid)
//    C.dist(x, y, z)      the coral term (trilinear); far from coral: big
//    C.occupied           cells with coral, C.seen particles read
//
//  grep -n targets: "export function createCoralField"
// ============================================================================

export function createCoralField({ radius = 30, ymin = -6, ymax = 18, cell = 0.5, reach = 2.5, clear = 0.92, clearM = 1.3, margin = 0.2 } = {}) {
  const ext = radius * 1.08;
  const nx = Math.ceil(2 * ext / cell) + 1, nz = nx, ny = Math.ceil((ymax - ymin) / cell) + 1;
  const x0 = -ext, z0 = -ext, y0 = ymin;
  const FAR = reach;
  const D = new Float32Array(nx * ny * nz).fill(FAR);
  const occ = new Uint8Array(nx * ny * nz);
  const K = Math.ceil(reach / cell);
  const k = clear / Math.max(0.1, clearM - margin);     // metres -> field units
  const big = (FAR - margin) * k;
  let seen = 0, occupied = 0;
  const at = (i, j, l) => (l * ny + j) * nx + i;

  function mark(i, j, l) {
    const q = at(i, j, l);
    if (occ[q]) return;
    occ[q] = 1; occupied++;
    for (let dl = -K; dl <= K; dl++) {
      const L = l + dl; if (L < 0 || L >= nz) continue;
      for (let dj = -K; dj <= K; dj++) {
        const J = j + dj; if (J < 0 || J >= ny) continue;
        for (let di = -K; di <= K; di++) {
          const I = i + di; if (I < 0 || I >= nx) continue;
          const d = Math.hypot(di, dj, dl) * cell;
          const o = at(I, J, L);
          if (d < D[o]) D[o] = d;
        }
      }
    }
  }
  function clearAll() { D.fill(FAR); occ.fill(0); seen = 0; occupied = 0; }

  function sync(reef, maxN = 3000) {
    if (!reef || !reef.px) return 0;
    const n = reef.count || 0;
    if (n < seen) clearAll();
    const end = Math.min(n, seen + maxN);
    for (let g = seen; g < end; g++) {
      const i = Math.round((reef.px[g] - x0) / cell), j = Math.round((reef.py[g] - y0) / cell), l = Math.round((reef.pz[g] - z0) / cell);
      if (i >= 0 && i < nx && j >= 0 && j < ny && l >= 0 && l < nz) mark(i, j, l);
    }
    const did = end - seen;
    seen = end;
    return did;
  }

  // The coral term at (x, y, z): the grid distance (metres, trilinear)
  // less the margin, in field units.
  function dist(x, y, z) {
    if (!occupied) return big;
    const gx = (x - x0) / cell, gy = (y - y0) / cell, gz = (z - z0) / cell;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= nx - 1 || gy >= ny - 1 || gz >= nz - 1) return big;
    const i = Math.floor(gx), j = Math.floor(gy), l = Math.floor(gz);
    const fx = gx - i, fy = gy - j, fz = gz - l;
    const o = at(i, j, l), sy = nx, sz = nx * ny;
    const c00 = D[o] + (D[o + 1] - D[o]) * fx, c10 = D[o + sy] + (D[o + sy + 1] - D[o + sy]) * fx;
    const c01 = D[o + sz] + (D[o + sz + 1] - D[o + sz]) * fx, c11 = D[o + sz + sy] + (D[o + sz + sy + 1] - D[o + sz + sy]) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
    return (c0 + (c1 - c0) * fz - margin) * k;
  }
  return { sync, dist, clear: clearAll, get seen() { return seen; }, get occupied() { return occupied; }, k, cell, dims: [nx, ny, nz] };
}
