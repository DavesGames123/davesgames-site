// tests.mjs — City Atlas checks.  node pages/city-atlas/tests.mjs [id ...]
//
//   1 index      data/index.json lists every city of tools/cities.json, each file exists
//   2 decode     each city file inflates and parses (data.js), every section has the
//                byte length its shape needs
//   3 buildings  count, heights 2.5..900 m, footprints inside the city disc + 500 m, ring and
//                triangle indices in range; the height raster covers a sane share of the disc.
//                mesh.js (meshCheck): no degenerate triangle, each normal on its face
//                plane, walls level and outward, roofs and pitched faces up, every roof,
//                ledge and rooftop unit inside the footprint and between hmin and the top,
//                triangles at most 1.6 x (desktop) and 1.2 x (coarse pointer) the plain
//                extrusion; the build time is printed
//   4 terrain    the inner grid matches known spot heights (summits) within tolerance;
//                the water surface is at sea level on the sea, and Lake Michigan's
//                surface at Chicago is near 176 m
//   5 currents   int8 fields decode to m/s; speeds are plausible; land cells are 0;
//                meta.curMax agrees with the decoded maximum
//   6 wind       tools/wind-check.js under Deno (WebGPU): mass in a closed box, and a
//                wake with vortex shedding behind a block. Skipped (and said so) when
//                deno is not on the PATH.
//   7 windows    tools/facade-check.mjs: the facade window pattern of buildings.wgsl
//                (concrete and glass), filtered, against one sample per pixel. Far away (cells under 1.2 px)
//                the grain and the shimmer must drop to half or less; close up the
//                filtered image must stay within 0.02 RMS of the 8 x 8 supersampled truth.
//   8 page       main.js boots in jsdom without WebGPU (the fallback shows), worker.js runs
//                in this thread; the head, the foot, the keys T C W L I M Esc, the overlay
//                drawer, the about sheet, the atlas, a city switch and the saver hook.
//                Skipped (and said so) when jsdom does not load (NODE_PATH).
//   9 modules    the DOM-free modules of app/: text formats, the quality rule, the
//                first view, the seeded tour and its plate, the foot and drawer HTML.
// Exit code 1 when any check fails.
//
// grep: function check  const SPOTS  function spot  function meshCheck  function windCheck  function windowCheck
//       function pageCheck  function moduleCheck

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseCity, inflate, buildingsOf } from './data.js';
import { buildMesh, heightRaster, LOD_SIZES, STRIDE } from './mesh.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const only = process.argv.slice(2);
let fails = 0, passes = 0;
function check(ok, msg) {
  if (ok) { passes++; } else { fails++; console.log(`  FAIL ${msg}`); }
  return ok;
}

// Known summits (m above sea level) inside the inner 12 km grids. The grid
// is 23 m and bilinear, so a summit reads a little low: the test takes the
// highest grid value within 150 m and allows -70 / +25 m.
// Sugarloaf is 396 m, but the terrain tiles themselves read 305 m at zoom
// 13 and 279-281 m at zoom 14-15 (SRTM fill on the steep granite dome), so
// its check is against the source (src) and the gap is printed.
const SPOTS = [
  { city: 'hong-kong', name: 'Victoria Peak', lat: 22.2759, lon: 114.1455, h: 552 },
  { city: 'rio-de-janeiro', name: 'Sugarloaf', lat: -22.9486, lon: -43.1566, h: 396, src: 305 },
  { city: 'rio-de-janeiro', name: 'Corcovado', lat: -22.9519, lon: -43.2105, h: 710 },
  { city: 'san-francisco', name: 'Twin Peaks', lat: 37.7544, lon: -122.4477, h: 282 },
  { city: 'cape-town', name: "Lion's Head", lat: -33.9351, lon: 18.3889, h: 669 },
];

const M_PER_DEG = 6371000 * Math.PI / 180;
function local(meta, lat, lon) {
  return { x: (lon - meta.lon) * M_PER_DEG * Math.cos(meta.lat * Math.PI / 180), y: (lat - meta.lat) * M_PER_DEG };
}
function spot(c, lat, lon, radius, arr = 't_in') {
  const a = c.arrays[arr], n = a.shape[0], half = c.meta.grid.inner.half, cell = 2 * half / n;
  const p = local(c.meta, lat, lon);
  let best = -Infinity;
  for (let j = 0; j < n; j++) {
    const y = -half + (j + 0.5) * cell;
    if (Math.abs(y - p.y) > radius) continue;
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * cell;
      if (Math.hypot(x - p.x, y - p.y) <= radius) best = Math.max(best, a[j * n + i] * 0.1);
    }
  }
  return best;
}

const BYTES = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4 };

async function testCity(id) {
  const path = `${HERE}data/${id}.bin`;
  if (!check(existsSync(path), `${id}: ${path} missing`)) return null;
  const raw = await inflate(readFileSync(path));
  const c = parseCity(raw);
  const m = c.meta;
  console.log(`${id}: ${(statSync(path).size / 1e6).toFixed(2)} MB, ${m.buildings.count} buildings, tallest ${m.buildings.tallest} m, current ${m.current ? m.current.sources.join('+') : 'none'}`);
  // 2 decode
  const head = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + new DataView(raw.buffer, raw.byteOffset).getUint32(4, true))));
  for (const s of head.sections) {
    const need = s.shape.reduce((a, b) => a * b, 1) * BYTES[s.dtype];
    check(need === s.length, `${id}: section ${s.name} length ${s.length} != shape ${s.shape} x ${BYTES[s.dtype]}`);
  }
  for (const k of ['t_in', 's_in', 't_out', 's_out', 'wf_in', 'wf_out', 'lc_in', 'lc_out', 'rough', 'b_h', 'b_xy', 'b_tri']) {
    check(!!c.arrays[k], `${id}: section ${k} missing`);
  }
  // 3 buildings
  const b = buildingsOf(c);
  check(b.n >= 300, `${id}: only ${b.n} buildings`);
  let hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < b.n; i++) { hmin = Math.min(hmin, b.h[i] / 10); hmax = Math.max(hmax, b.h[i] / 10); }
  check(hmin >= 2.4 && hmax <= 900, `${id}: heights ${hmin}..${hmax} m outside 2.5..900`);
  const R = m.r * 1000 + 500;
  let far = 0, verts = 0, badTri = 0, ring = 0, tp = 0;
  for (let i = 0; i < b.n; i++) {
    let cnt = 0;
    for (let k = 0; k < b.rings[i]; k++) cnt += b.ringLen[ring + k];
    for (let k = 0; k < cnt; k++) {
      const x = b.xy[2 * (verts + k)] * 0.5, y = b.xy[2 * (verts + k) + 1] * 0.5;
      if (Math.hypot(x, y) > R) far++;
    }
    for (let t = 0; t < b.ntri[i] * 3; t++) if (b.tri[tp + t] >= cnt) badTri++;
    tp += b.ntri[i] * 3;
    verts += cnt;
    ring += b.rings[i];
  }
  check(verts * 2 === b.xy.length, `${id}: ring lengths sum ${verts} != xy rows ${b.xy.length / 2}`);
  check(tp === b.tri.length, `${id}: triangle count ${tp} != ${b.tri.length}`);
  check(far === 0, `${id}: ${far} vertices outside the disc (r + 500 m)`);
  check(badTri === 0, `${id}: ${badTri} roof indices out of range`);
  const t0 = performance.now();
  buildMesh(b, { detail: 1, lat: m.lat });
  const buildMs = performance.now() - t0;
  const mesh = buildMesh(b, { detail: 1, lat: m.lat, debug: true });
  const t1 = performance.now();
  const meshLo = buildMesh(b, { detail: 0, lat: m.lat });
  const buildLoMs = performance.now() - t1;
  const i16 = new Int16Array(mesh.vertices);
  let maxIdx = 0;
  for (const v of mesh.indices) if (v > maxIdx) maxIdx = v;
  check(maxIdx < mesh.count, `${id}: mesh index ${maxIdx} >= vertex count ${mesh.count}`);
  check(i16.length === mesh.count * (STRIDE / 2), `${id}: mesh vertex buffer size`);
  // LOD: the buildings go in largest first, so lod[k] is a prefix of the index buffer
  const lod = mesh.lod || [];
  let mono = lod.length === LOD_SIZES.length;
  for (let k = 1; k < lod.length; k++) if (lod[k] < lod[k - 1]) mono = false;
  check(mono && lod[lod.length - 1] === mesh.indices.length, `${id}: LOD prefixes ${JSON.stringify(lod)} not rising to ${mesh.indices.length}`);
  meshCheck(id, b, mesh, meshLo, buildMs, buildLoMs);
  const ras = heightRaster(b, m.bHalf, 512);
  let covered = 0;
  for (const v of ras) if (v > 0) covered++;
  const share = covered / ras.length;
  check(share > 0.02 && share < 0.75, `${id}: building raster covers ${(share * 100).toFixed(1)} % of its square`);
  // 4 terrain
  const t = c.arrays.t_in;
  let tmin = Infinity, tmax = -Infinity;
  for (const v of t) { tmin = Math.min(tmin, v); tmax = Math.max(tmax, v); }
  check(tmin * 0.1 > -500 && tmax * 0.1 < 2000, `${id}: inner ground ${tmin / 10}..${tmax / 10} m`);
  for (const sp of SPOTS.filter((s) => s.city === id)) {
    const got = spot(c, sp.lat, sp.lon, 150);
    const ref = sp.src ?? sp.h;
    const ok = got >= ref - 70 && got <= ref + 25;
    check(ok, `${id}: ${sp.name} ${got.toFixed(0)} m, known ${sp.h} m`);
    console.log(`  spot ${sp.name}: grid ${got.toFixed(0)} m, known ${sp.h} m${sp.src ? ` (source tiles ${sp.src} m)` : ''} ${ok ? 'ok' : 'FAIL'}`);
  }
  // water surface: sea level on the sea (outer grid edge cells that are water)
  const so = c.arrays.s_out, wo = c.arrays.wf_out, no = so.shape[0], wn = wo.shape[0], wk = wn / no;
  let seaN = 0, seaBad = 0;
  for (let i = 0; i < no; i++) for (const j of [0, no - 1]) {
    for (const [a, bb] of [[i, j], [j, i]]) {
      const k = bb * no + a;
      const wv = wo[Math.floor((bb + 0.5) * wk) * wn + Math.floor((a + 0.5) * wk)];
      if (wv > 200 && c.arrays.t_out[k] < -50) { seaN++; if (Math.abs(so[k] * 0.1) > 1.0) seaBad++; }
    }
  }
  if (seaN) check(seaBad === 0, `${id}: ${seaBad} of ${seaN} deep sea cells at the edge with a water level off 0 m`);
  if (id === 'chicago') {
    const lv = spot(c, 41.88, -87.60, 60, 's_in');
    check(lv > 170 && lv < 182, `chicago: Lake Michigan surface ${lv} m (expect about 176 m)`);
    console.log(`  Lake Michigan surface: ${lv.toFixed(1)} m (about 176 m)`);
  }
  // 5 currents
  if (m.current) {
    for (const [k, sc] of [['cur_in', m.curScaleIn], ['cur_out', m.curScaleOut]]) {
      const a = c.arrays[k];
      if (!check(!!a, `${id}: ${k} missing`)) continue;
      const [T, n] = a.shape;
      check(T === 49 && a.shape[3] === 2, `${id}: ${k} shape ${a.shape}`);
      let mx = 0, landMoving = 0;
      const wf = k === 'cur_in' ? c.arrays.wf_in : c.arrays.wf_out;
      const wn = wf.shape[0], f = wn / n;
      // a cell with no water at all under it must be still
      const dry = new Uint8Array(n * n);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        let w = 0;
        for (let bj = Math.floor(j * f); bj < Math.min(wn, Math.ceil((j + 1) * f)); bj++) {
          for (let bi = Math.floor(i * f); bi < Math.min(wn, Math.ceil((i + 1) * f)); bi++) w = Math.max(w, wf[bj * wn + bi]);
        }
        dry[j * n + i] = w === 0 ? 1 : 0;
      }
      for (let h = 0; h < T; h++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const o = ((h * n + j) * n + i) * 2;
        const s = Math.hypot(a[o], a[o + 1]) * sc;
        mx = Math.max(mx, s);
        if (dry[j * n + i] && s > 1e-6) landMoving++;
      }
      check(mx > 0.02 && mx < 3.5, `${id}: ${k} max speed ${mx.toFixed(3)} m/s`);
      check(landMoving === 0, `${id}: ${k} has ${landMoving} moving cells on dry land`);
      if (k === 'cur_in' && m.current.tidal) check(Math.abs(mx - m.curMax) < 0.05 + 0.02 * mx, `${id}: decoded max ${mx.toFixed(3)} vs meta.curMax ${m.curMax}`);
    }
  }
  return c;
}

// The building mesh against its footprints (mesh.tris from debug: building,
// part, centre x, centre y per triangle).
function inRings(b, i, x, y, ringStart, ptStart) {
  // even-odd over all rings; a point on an edge (0.01 m) counts as inside
  let inside = false, p = ptStart[i];
  for (let k = 0; k < b.rings[i]; k++) {
    const len = b.ringLen[ringStart[i] + k];
    for (let e = 0; e < len; e++) {
      const a = p + e, c = p + ((e + 1) % len);
      const ax = b.xy[2 * a] * 0.5, ay = b.xy[2 * a + 1] * 0.5, cx = b.xy[2 * c] * 0.5, cy = b.xy[2 * c + 1] * 0.5;
      const ex = cx - ax, ey = cy - ay, L2 = ex * ex + ey * ey;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)) : 0;
      if (Math.hypot(ax + t * ex - x, ay + t * ey - y) < 0.01) return true;
      if ((ay > y) !== (cy > y) && x < ax + (y - ay) / (cy - ay) * ex) inside = !inside;
    }
    p += len;
  }
  return inside;
}

function meshCheck(id, b, mesh, meshLo, buildMs, buildLoMs) {
  const ringStart = new Uint32Array(b.n), ptStart = new Uint32Array(b.n);
  let plain = 0;
  { let r = 0, p = 0; for (let i = 0; i < b.n; i++) { ringStart[i] = r; ptStart[i] = p; let c = 0; for (let k = 0; k < b.rings[i]; k++) c += b.ringLen[r + k]; plain += c * 2 + b.ntri[i]; r += b.rings[i]; p += c; } }
  const i16 = new Int16Array(mesh.vertices), i8 = new Int8Array(mesh.vertices);
  const V = (v) => { const o = v * (STRIDE / 2); return [i16[o] * 0.5, i16[o + 1] * 0.5, i16[o + 2] * 0.1]; };
  const N = (v) => { const o = v * STRIDE + 12; return [i8[o] / 127, i8[o + 1] / 127, i8[o + 2] / 127]; };
  const T = mesh.tris, nt = mesh.indices.length / 3;
  check(T && T.length === nt * 4, `${id}: debug triangle list ${T && T.length} != ${nt} x 4`);
  const bad = { degenerate: 0, plane: 0, wallLevel: 0, wallOut: 0, roofUp: 0, outside: 0, zRange: 0, nan: 0 };
  const seen = new Set();
  // source footprint edges of 2 m or more that fail the in / out probe
  const srcBad = new Set();
  let excused = 0;
  for (let i = 0; i < b.n; i++) {
    let p = ptStart[i];
    for (let k = 0; k < b.rings[i]; k++) {
      const len = b.ringLen[ringStart[i] + k];
      for (let e = 0; e < len; e++) {
        const a = p + e, c = p + ((e + 1) % len);
        const ax = b.xy[2 * a] * 0.5, ay = b.xy[2 * a + 1] * 0.5, cx = b.xy[2 * c] * 0.5, cy = b.xy[2 * c + 1] * 0.5, L = Math.hypot(cx - ax, cy - ay);
        if (L < 2) continue;
        const nx = (cy - ay) / L, ny = -(cx - ax) / L, mx = (ax + cx) / 2, my = (ay + cy) / 2;
        if (!inRings(b, i, mx - 0.2 * nx, my - 0.2 * ny, ringStart, ptStart) || inRings(b, i, mx + 0.2 * nx, my + 0.2 * ny, ringStart, ptStart)) {
          srcBad.add(`${i}:${Math.min(ax, cx)}:${Math.max(ax, cx)}:${Math.min(ay, cy)}:${Math.max(ay, cy)}`);
        }
      }
      p += len;
    }
  }
  for (let t = 0; t < nt; t++) {
    const ia = mesh.indices[3 * t], ib = mesh.indices[3 * t + 1], ic = mesh.indices[3 * t + 2];
    const A = V(ia), B = V(ib), C = V(ic), n = N(ia);
    const i = T[4 * t], part = T[4 * t + 1], cx = T[4 * t + 2], cy = T[4 * t + 3];
    if (![...A, ...B, ...C, ...n].every(Number.isFinite)) { bad.nan++; continue; }
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const area = Math.hypot(...g) / 2;
    if (area < 1e-3) { bad.degenerate++; continue; }
    const nl = Math.hypot(...n);
    if (area > 0.25 && Math.abs(g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / (2 * area * nl) < 0.9) bad.plane++;
    const hM = b.h[i] / 10, hmin = b.hmin ? b.hmin[i] / 10 : 0;
    const mid = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
    if (part === 0 || part === 3) {
      if (Math.abs(n[2]) > 0.01) bad.wallLevel++;
      const nh = Math.hypot(n[0], n[1]) || 1, nx = n[0] / nh, ny = n[1] / nh;
      if (Number.isFinite(cx)) { if ((mid[0] - cx) * nx + (mid[1] - cy) * ny <= 0) bad.wallOut++; }
      else {
        // the wall's foot: the two xy points furthest apart; probe 0.2 m in
        // and out of its middle. Walls under 2 m are not probed (on the 0.5 m
        // grid a probe there can cross the next edge). A wall on a source
        // edge that fails the same probe (a footprint that crosses itself)
        // is the data, not the mesh: it counts as excused.
        let s0 = A, s1 = B, dmax = Math.hypot(A[0] - B[0], A[1] - B[1]);
        for (const [p, q] of [[A, C], [B, C]]) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > dmax) { dmax = d; s0 = p; s1 = q; } }
        if (dmax >= 2) {
          const mx = (s0[0] + s1[0]) / 2, my = (s0[1] + s1[1]) / 2;
          if (!inRings(b, i, mx - 0.2 * nx, my - 0.2 * ny, ringStart, ptStart) || inRings(b, i, mx + 0.2 * nx, my + 0.2 * ny, ringStart, ptStart)) {
            if (srcBad.has(`${i}:${Math.min(s0[0], s1[0])}:${Math.max(s0[0], s1[0])}:${Math.min(s0[1], s1[1])}:${Math.max(s0[1], s1[1])}`)) excused++;
            else bad.wallOut++;
          }
        }
      }
    } else if (n[2] < 0.2) bad.roofUp++;
    if (part !== 0) {
      for (const P of [A, B, C]) {
        const key = `${i}:${P[0]}:${P[1]}`;
        if (!seen.has(key)) { seen.add(key); if (!inRings(b, i, P[0], P[1], ringStart, ptStart)) bad.outside++; }
        const zt = part >= 3 ? hM + 8.05 : hM + 0.05;
        if (P[2] < hmin - 0.05 || P[2] > zt) bad.zRange++;
      }
    }
  }
  for (const [k, v] of Object.entries(bad)) check(v === 0, `${id}: mesh ${k} ${v} of ${nt} triangles`);
  const tri = nt, triLo = meshLo.indices.length / 3;
  check(tri <= plain * 1.6, `${id}: ${tri} triangles over 1.6 x the plain ${plain}`);
  check(triLo <= plain * 1.2, `${id}: coarse-pointer tier ${triLo} triangles over 1.2 x the plain ${plain}`);
  console.log(`  mesh: ${tri} triangles (${(tri / plain).toFixed(2)} x plain ${plain}) in ${buildMs.toFixed(0)} ms; coarse tier ${triLo} (${(triLo / plain).toFixed(2)} x) in ${buildLoMs.toFixed(0)} ms; ${JSON.stringify(mesh.forms)}; ${excused} wall triangles on ${srcBad.size} self-crossing source edges`);
}

function windCheck() {
  if (!existsSync(`${HERE}tools/wind-check.js`)) { console.log('wind: SKIPPED (tools/wind-check.js not present)'); return; }
  let deno = null;
  try { deno = execFileSync('which', ['deno']).toString().trim(); } catch { /* none */ }
  if (!deno) { console.log('wind: SKIPPED (deno not on PATH; the GPU solver checks need Deno WebGPU)'); return; }
  try {
    const out = execFileSync(deno, ['run', '-A', `${HERE}tools/wind-check.js`, '--json'], { encoding: 'utf8', timeout: 300000 });
    const lines = out.trim().split('\n');
    for (const l of lines.slice(0, -1)) console.log(`wind: ${l}`);
    const r = JSON.parse(lines[lines.length - 1]);
    check(r.mass.rel < 1e-4, `wind: mass change ${r.mass.rel}`);
    check(r.wake.ratio < 0.6, `wind: wake ratio ${r.wake.ratio}`);
    check(r.wake.shedSd > 0.03, `wind: shedding sd ${r.wake.shedSd}`);
    check(r.wake.nan === 0, `wind: ${r.wake.nan} NaN cells`);
  } catch (err) {
    check(false, `wind: wind-check.js failed: ${err.stdout || err.message}`);
  }
}

async function windowCheck() {
  const wgsl = readFileSync(`${HERE}shaders/buildings.wgsl`, 'utf8');
  // facade-check.mjs reads the materials from matOf; the filter lines must be as it ports them
  for (const k of ['pulseBox(bx, fw.x, M.pane.x, M.pane.y) * pulseBox(fy, fw.y, M.pane.z, M.pane.w) * upper',
    'let fw = vec2f(fu / max(run, 0.01) * bays, fz / M.cell.y);', 'smoothstep(0.4, 0.7, max(fw.x, fw.y))']) {
    check(wgsl.includes(k), `windows: buildings.wgsl lacks ${k} (facade-check.mjs is out of step)`);
  }
  // the saver plate shows an extract of fs from this anchor (app/tour.js CODE)
  const anchor = /none: \['buildings\.wgsl', '([^']+)'/.exec(readFileSync(`${HERE}app/tour.js`, 'utf8'));
  check(anchor && wgsl.includes(anchor[1]), `windows: the saver code anchor ${anchor && anchor[1]} is not in buildings.wgsl`);
  const { measure, materials } = await import('./tools/facade-check.mjs');
  check(materials().length === 5, `windows: ${materials().length} materials read from matOf, want 5`);
  for (const [mat, name] of [[1, 'concrete'], [0, 'glass']]) {
    for (const r of measure(undefined, 48, mat)) {
      const p = r.point, f = r.filter, t = r.truth;
      console.log(`windows: ${name} ${r.d} m, ${r.pxCell.toFixed(2)} px per cell: grain ${p.nbr.toFixed(3)} -> ${f.nbr.toFixed(3)}, shimmer ${p.flicker.toFixed(4)} -> ${f.flicker.toFixed(4)} (truth ${t.nbr.toFixed(3)}, ${t.flicker.toFixed(4)})`);
      if (r.pxCell < 1.2) {
        check(f.nbr <= 0.5 * p.nbr, `windows: ${name} ${r.d} m grain ${f.nbr} not under half of ${p.nbr}`);
        check(f.flicker <= 0.5 * p.flicker, `windows: ${name} ${r.d} m shimmer ${f.flicker} not under half of ${p.flicker}`);
      }
      if (r.pxCell > 5) check(f.err < 0.02, `windows: ${name} ${r.d} m filtered image ${f.err} RMS from the truth`);
      check(f.flicker <= t.flicker * 1.1 + 0.002, `windows: ${name} ${r.d} m shimmer ${f.flicker} above the truth ${t.flicker}`);
    }
  }
}

async function moduleCheck() {
  const tx = await import('./app/text.js');
  const got = [tx.compass(359), tx.compass(-90), tx.compass(202.5), tx.latLon({ lat: -33.9, lon: 18.42 }, 2), tx.hoursOf(null), tx.hoursOf({ current: { hours: 25 } }),
    tx.stamp({ current: { startUTC: '2026-09-24T00:00:00Z' }, tz: 'America/New_York' }, 5.7), tx.stamp(null, 0), tx.titleCase('EAST RIVER'), tx.esc('<a&"b">')].join(' | ');
  check(got === 'N | W | SSW | 33.90° S, 18.42° E | 48 | 24 | 24 Sept 01:00 GMT-4 | 24 Sept 00:00 UTC | East River | &lt;a&amp;&quot;b&quot;&gt;', `modules: text.js ${got}`);
  const { stepQuality, med } = await import('./app/quality.js');
  const q = { level: 0, good: 0 };
  const seq = [20, 20, 20, 20, 20, 20, 3, 3, 3, 9].map((g) => (q.level = stepQuality(q, g)) + ':' + q.good).join(' ');
  check(seq === '1:0 2:0 3:0 4:0 5:0 5:0 5:1 5:2 4:0 4:0' && med([0, 5, 1, 9]) === 5 && med([]) === 0, `modules: quality.js ${seq}`);
  const v = await import('./app/view.js');
  const dv = v.defaultView({ r: 2, _bearing: 90, groundRef: 5 }, 400, 800);
  check(Math.abs(dv.dist - 8151.525) < 1e-3 && dv.target[2] === 5 && Math.abs(dv.yaw - Math.PI / 2) < 1e-12 && v.defaultView({ r: 2 }, 1600, 800).dist === 4100, `modules: view.js defaultView ${JSON.stringify(dv)}`);
  check(v.contourStep({ terrain: { max: 700 }, groundRef: 0 }) === 50 && v.contourStep({ terrain: { max: 30 } }) === 5 && v.sunAzOf({ _bearing: 330 }) === 25, 'modules: view.js contour step or sun');
  const t = await import('./app/tour.js');
  const r = t.mulberry32(7);
  check([r(), r(), r()].map((x) => x.toFixed(6)).join(' ') === '0.011705 0.061958 0.976908', 'modules: tour.js mulberry32(7)');
  check(t.shuffle(index.map((_, i) => i), t.mulberry32(7)).join() === '13,17,20,5,11,10,9,4,14,19,2,16,7,3,15,6,8,12,18,1,0' || index.length !== 21, 'modules: tour.js shuffle');
  const sh = t.saverShot(t.mulberry32(3), { current: {} }, 0, 0.5);
  check(sh.light === 'day' && sh.primary === 'terrain' && sh.terrain && Math.abs(sh.seconds - 10.410979) < 1e-6 && Math.abs(sh.yawRate - 0.028941) < 1e-6, `modules: tour.js saverShot ${JSON.stringify(sh)}`);
  const src = readFileSync(`${HERE}shaders/buildings.wgsl`, 'utf8');
  check(t.extract(src, t.CODE.none[1], t.CODE.none[2]).split('\n').length === t.CODE.none[2], 'modules: tour.js extract of the lit windows');
  const m = { title: 'X', region: 'R', country: 'C', lat: 1, lon: -2, buildings: { count: 1234, tallest: 300 }, curMax: 1, current: { sources: ['HYCOM'] } };
  const ov = { terrain: { on: true, exag: 2 }, ocean: { on: true }, wind: { on: true, speed: 5, dirFrom: 270, live: false } };
  const pl = t.plateOf(m, ov, { primary: 'ocean' }, 3);
  check(pl.sub === 'R · ocean currents' && pl.params.map((p) => p.sym).join() === 'N,h_{\\max},E,u_{\\max},U' && pl.lines[1] === 'Surface currents, 24 Sept 03:00 UTC. HYCOM ESPC-D-V02.' && pl.tex.length === 1, `modules: tour.js plateOf ${JSON.stringify(pl)}`);
  const f = await import('./app/forms.js');
  const ph = f.paramsHTML(m, ov);
  check(['buildings', 'tallest', 'current data', 'fastest water', 'wind', 'relief'].join() === [...ph.matchAll(/<small>([^<]+)<\/small>/g)].map((x) => x[1]).join() && ph.includes('1.9 kn') && ph.includes('5.0 m/s W'), `modules: forms.js paramsHTML ${ph}`);
  check(f.notesHTML(m, ov) === 'R. Real relief, sea floor in blue; streaks follow the surface current; streaks follow a simulated wind.<span class="src">© OpenStreetMap contributors · Overture Maps · ESA WorldCover · HYCOM ESPC-D-V02</span>', 'modules: forms.js notesHTML');
  check(f.windTop({ wind: { speed: 5 } }) === 11 && f.windTop({ wind: { speed: 1 } }) === 2.5, 'modules: forms.js windTop');
  const { captionHTML } = await import('./app/sources.js');
  const cap = captionHTML({ ...m, blurb: 'B', r: 2, fHalf: 3200, terrain: { max: 10, deepest: -20 }, wind: { prevail: { dir: 90 }, mean: 4 }, buildings: { count: 10, tagged: 5, tallest: 30, over100: 0 } });
  check(cap.includes('<span>With a mapped height</span><span>50 %</span>') && cap.includes('id="capCredits"') && cap.includes('HYCOM.org'), 'modules: sources.js captionHTML');
}

// The page in jsdom: no GPU, so renderer.js fails and the fallback shows; the
// worker runs here (a fake self catches its onmessage), fetch reads the files.
async function pageCheck() {
  let JSDOM;
  try { ({ JSDOM } = createRequire(import.meta.url)('jsdom')); } catch { console.log('page: SKIPPED (jsdom not on NODE_PATH)'); return; }
  const html = readFileSync(`${HERE}index.html`, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const w = new JSDOM(html, { url: 'https://site.test/stella-nova/pages/city-atlas/index.html#chicago', pretendToBeVisual: true }).window;
  w.Element.prototype.scrollIntoView = () => {};
  const g = globalThis, store = new Map(), raf = [];
  const mm = (q) => ({ matches: false, media: q, addEventListener() {} });
  Object.assign(g, {
    window: w, document: w.document, location: w.location, history: w.history, innerWidth: 1024, innerHeight: 768,
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    matchMedia: mm, requestAnimationFrame: (f) => raf.push(f), cancelAnimationFrame: () => {},
  });
  Object.assign(w, { matchMedia: mm, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame });
  const realFetch = g.fetch;
  g.fetch = async (u) => {
    const b = readFileSync(fileURLToPath(String(u)));
    return { ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b.toString(), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  let onmsg = null;
  g.Worker = class extends w.EventTarget {
    constructor(url) {
      super();
      const self = { postMessage: (data) => setTimeout(() => { const e = new w.Event('message'); e.data = data; this.dispatchEvent(e); }) };
      this.ready = (async () => { g.self = self; await import(String(url)); onmsg = self.onmessage; })();
    }
    postMessage(data) { this.ready.then(() => onmsg({ data })); }
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const $ = (id) => w.document.getElementById(id);
    const until = async (f) => { for (let t = Date.now(); !f(); await new Promise((r) => setTimeout(r, 20))) { if (Date.now() - t > 60000) throw new Error('timeout'); raf.splice(0).forEach((cb) => cb(0)); } };
    const key = (k) => w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    await import(pathToFileURL(`${HERE}main.js`).href);
    await until(() => w.__cityAtlas?.ready);
    check($('ttl').textContent === 'Chicago', `page: title ${$('ttl').textContent}, want Chicago`);
    check(!$('fallback').hidden && w.document.body.classList.contains('no-gpu'), 'page: no WebGPU fallback shown');
    check(/buildings/.test($('params').innerHTML) && /relief/.test($('params').innerHTML), 'page: foot params lack buildings or relief');
    check($('locCount').textContent === `${index.findIndex((c) => c.id === 'chicago') + 1} / ${index.length}`, `page: city count ${$('locCount').textContent}`);
    check($('chipTerrain').getAttribute('aria-pressed') === 'true' && $('chipWind').getAttribute('aria-pressed') === 'true', 'page: terrain and wind not on at load');
    key('t');
    check($('chipTerrain').getAttribute('aria-pressed') === 'false' && !/relief/.test($('params').innerHTML), 'page: T does not turn terrain off');
    key('l');
    check(!$('layers').hidden && $('layersBody').querySelectorAll('.lg').length === 4, 'page: L does not open the four overlay groups');
    $('wdSpeed').value = '7.5';
    $('wdSpeed').dispatchEvent(new w.Event('input'));
    check($('wdSpeedOut').textContent === '7.5 m/s' && /7\.5 m\/s/.test($('params').innerHTML), `page: wind speed ${$('wdSpeedOut').textContent}`);
    key('i');
    check(!$('caption').hidden && $('capBody').querySelector('#capCredits') && $('atlas').hidden, 'page: I does not open the about sheet with credits');
    key('m');
    check(!$('atlas').hidden && $('caption').hidden && $('atlasBody').querySelectorAll('.a-item').length === index.length, 'page: M does not open the atlas of every city');
    key('Escape');
    check($('atlas').hidden && $('caption').hidden && $('layers').hidden, 'page: Esc leaves a sheet open');
    await w.__cityAtlas.go('miami');
    check($('ttl').textContent === 'Miami' && w.location.hash === '#miami' && store.get('city-atlas.city') === 'miami', 'page: switch to Miami');
    key('c');
    check($('chipOcean').getAttribute('aria-pressed') === 'true' && !$('scrub').classList.contains('off'), 'page: C does not show the Miami currents');
    const r = await w.snSaver.enter({ calm: 0.5, seed: 7, label: () => {} });
    check(r.canvas === $('map') && w.document.body.classList.contains('saver'), 'page: saver enter');
    w.snSaver.exit();
    check(!w.document.body.classList.contains('saver'), 'page: saver exit');
    console.log(`page: jsdom boot, ${w.document.querySelectorAll('.lbl').length} labels, ${index.length} cities in the atlas`);
  } catch (err) {
    check(false, `page: ${err.stack || err}`);
  } finally {
    console.warn = warn;
    g.fetch = realFetch;
  }
}

const cities = JSON.parse(readFileSync(`${HERE}tools/cities.json`, 'utf8'));
const index = existsSync(`${HERE}data/index.json`) ? JSON.parse(readFileSync(`${HERE}data/index.json`, 'utf8')) : [];
check(index.length === cities.length, `index lists ${index.length} cities, cities.json ${cities.length}`);
let total = 0;
for (const c of cities) {
  if (only.length && !only.includes(c.id)) continue;
  await testCity(c.id);
  if (existsSync(`${HERE}data/${c.id}.bin`)) total += statSync(`${HERE}data/${c.id}.bin`).size;
}
console.log(`data: ${(total / 1e6).toFixed(1)} MB in the city files checked`);
windCheck();
await windowCheck();
await moduleCheck();
if (!only.length) await pageCheck();
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
