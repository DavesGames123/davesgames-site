// ============================================================================
//  POOL PHYSICS  ·  view/scene3d.js — the 3D table (three.js r160)
// ----------------------------------------------------------------------------
//  The same table as core/table.js, in metres. The user asked for a table
//  "lit up less brightly", a "better felt texture", pockets that are
//  "well carved", shadows that "draw accurately directly underneath the
//  ball", vectors "centered within the ball", balls with "fingerprint
//  smudge" and roughness from real image textures, a cue that does not
//  intersect the table, and a "more visually interesting" table.
//
//    cloth ....... a CC0 felt scan (artwork/felt-*.jpg, ambientCG Fabric
//                  034): grey fibres tinted green by the material, the
//                  normal map for the fibre relief, sheen and a little
//                  anisotropy for the nap
//    rails ....... polished rosewood (tex/rosewood-*, clearcoat), pearl
//                  diamond inlays flush in the wood, a dark leather cover
//                  round each pocket cut
//    pockets ..... the rail, the slate and the apron are cut through at
//                  each hole; the cut follows the jaw lines back to the
//                  hole circle (function pocketCut); a leather liner lines
//                  the back of the cut and a drop bag hangs under it.
//                  Nothing stands in the mouth (tests/scene.test.mjs casts
//                  rays down into each hole and along each mouth)
//    body ........ mahogany apron with a brass bead, four turned legs on a
//                  plinth frame, a dark rug on a plank floor (room hint)
//    light ....... a three-shade lamp; three spots (one casts shadows on
//                  a phone), PCF shadows, a shadow camera fitted to the
//                  table (focus), a small bias; a contact shadow (an
//                  ambient occlusion disc, function contactShadows) under
//                  each ball touches its contact point
//    balls ....... a printed decal, clearcoat, and a roughness map of real
//                  fingerprints and smudges (artwork/ball-smudge-rough.jpg,
//                  ambientCG Fingerprints 003 and Surface Imperfections
//                  003), offset per ball so no two look the same
//    cue ......... core/cue.js cuePose: lifted over the rail and the
//                  balls, the tip on the ball face, a bridge under it
//    overlays .... the aim line, the ghost ball, and the arrows of v and a,
//                  which start at the ball centre and draw over the ball
//  Axes: table (x, y, z up) -> three (X = x, Y = z, Z = -y). A ball
//  orientation (w, x, y, z) of core/physics.js -> three (w, x, z, -y).
//
//  createScene(canvas, T, { phone }) -> V or null (no WebGL)
//    V.resize(w, h, dpr)   V.render()   V.pick(px, py) -> { x, y } or null
//    V.setBalls(list)      list: [{ n, x, y, q, drop: { p, hx, hy } }]
//    V.setCue({ x, y, phi, a, b, back, alpha }, S)   or null
//    V.setOverlay({ aim, ghost, arrows: [{ from, vec, m }] })
//    V.camMode(mode) 'auto' | 'broadcast' | 'behind' | 'overhead' | 'free'
//    V.focus({ phase, cx, cy, phi })   V.update(dt)   V.onUserOrbit
//    V.table, V.contact, V.arrows, V.cuePose   (read by the tests)
//  buildTableGroup(T, mats, phone) and pocketCut(T, p) are exported for
//  the tests.
//
//  grep -n targets: "function ballTexture", "const feltMaterial",
//  "export function pocketCut", "function railInner", "function bedOutline",
//  "export function buildTableGroup",
//  "function buildLamp", "function buildCue", "function contactShadows",
//  "function camTarget", "export function createScene"
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { diamonds, ballColor, isStripe, cushionPolys } from '../core/table.js';
import { cuePose, cueRadius } from '../core/cue.js';

const TEX = new URL('../tex/', import.meta.url).href;
const ART = new URL('../artwork/', import.meta.url).href;
export const BED_Y = 0;            // the cloth (three Y)

const canvas2d = (w, h) => {
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext && c.getContext('2d');
    return g ? { c, g } : null;
  } catch (e) { return null; }
};

// An equirectangular ball decal: the colour, the stripe band, two number
// circles on the equator (as printed on a real set).
function ballTexture(n) {
  const k = canvas2d(512, 256);
  if (!k) return null;
  const { c, g } = k, col = ballColor(n);
  g.fillStyle = isStripe(n) ? '#f2efe6' : col; g.fillRect(0, 0, 512, 256);
  if (isStripe(n)) { g.fillStyle = col; g.fillRect(0, 128 - 52, 512, 104); }
  if (n > 0) {
    for (const u of [128, 384]) {
      g.fillStyle = '#f7f4ea'; g.beginPath(); g.arc(u, 128, 30, 0, 2 * Math.PI); g.fill();
      g.fillStyle = '#111'; g.font = `bold ${n > 9 ? 30 : 36}px Inter, Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), u, 130);
      if (n === 6 || n === 9) { g.fillRect(u - 9, 152, 18, 3); }
    }
  } else {
    // the cue ball: a few small red dots (a "measles" pattern) show the spin
    g.fillStyle = '#c0392b';
    for (const [u, v] of [[64, 128], [192, 128], [320, 128], [448, 128], [128, 40], [384, 216], [0, 0]]) { g.beginPath(); g.arc(u, v, 6, 0, 2 * Math.PI); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function rngOf(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// table (x, y) polygon -> a THREE.Shape in the same plane
const shapeOf = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; };
const pathOf = pts => { const s = new THREE.Path(); pts.forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; };
// extrude a plan shape up from y0 by h (three Y); table y -> three -Z
function slab(shape, y0, h, mat, bevel = 0, curve = 24) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: curve });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ── pockets ──────────────────────────────────────────────────────────────────
// The cut of a pocket in plan: the hole circle (radius rc) and the corridor
// between the two jaw lines, from the nose tips back to the circle. Returns
// { cx, cy, rc, inside(x, y), jaws: [[tip, back], [tip, back]], open: [a0, a1] }
// where open is the angle range (round the hole centre) that faces the
// table: the liner and the leather cover leave it free.
export function pocketCut(T, p) {
  const rc = p.r + (p.kind === 'corner' ? 0.004 : 0.003), cx = p.hx, cy = p.hy;
  const jaws = T.segs.filter(s => s.kind === 'jaw' && Math.hypot((s.ax + s.bx) / 2 - p.mx, (s.ay + s.by) / 2 - p.my) < 0.12);
  // each jaw line from the nose tip outward, extended until it passes the circle
  const lines = jaws.map(j => {
    const ext = 0.25;
    return [[j.ax, j.ay], [j.ax + j.tx * ext, j.ay + j.ty * ext]];
  });
  const quad = lines.length === 2 ? [lines[0][0], lines[0][1], lines[1][1], lines[1][0]] : null;
  const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  // the corridor is cut only up to the hole: beyond the circle centre it stops
  const ox = p.ox, oy = p.oy;
  const inside = (x, y) => {
    if (Math.hypot(x - cx, y - cy) < rc) return true;
    if (!quad || !inPoly(x, y, quad)) return false;
    return (x - cx) * ox + (y - cy) * oy < 0;
  };
  // the open side: the angles round the centre whose ray at radius rc + 2 cm
  // lies inside the inner rectangle of the cushion backs or in the corridor
  const ix = T.hx + T.spec.cushionW, iy = T.hy + T.spec.cushionW;
  const isOpen = a => { const x = cx + Math.cos(a) * (rc + 0.003), y = cy + Math.sin(a) * (rc + 0.003); return (Math.abs(x) < ix && Math.abs(y) < iy) || (quad && inPoly(x, y, quad)); };
  const N = 180, flags = [];
  for (let k = 0; k < N; k++) flags.push(isOpen(k / N * 2 * Math.PI));
  // the longest run of open angles (wrapping)
  let best = [0, 0], run = 0, start = 0;
  for (let k = 0; k < 2 * N; k++) {
    if (flags[k % N]) { if (!run) start = k; run++; if (run > best[1] - best[0] && run <= N) best = [start, start + run]; } else run = 0;
  }
  const open = [best[0] / N * 2 * Math.PI, best[1] / N * 2 * Math.PI];
  return { cx, cy, rc, inside, jaws: lines, open, p };
}

// The inner outline of the rail: the cushion-back rectangle joined with
// each pocket cut. Walking the rectangle, a run of points inside a cut is
// replaced by the outline of the cut, traced round its hole centre on the
// side away from the table (the cut is star-shaped from that centre).
function railInner(T, cuts) {
  const ix = T.hx + T.spec.cushionW, iy = T.hy + T.spec.cushionW, step = 0.003, out = [];
  // start half way along a long side: no cut there
  const x0 = T.hx * 0.5, perim = [[x0, -iy], [ix, -iy], [ix, iy], [-ix, iy], [-ix, -iy], [x0, -iy]];
  const reach = (c, a) => { const dx = Math.cos(a), dy = Math.sin(a); let r = 0; while (r < 0.4 && c.inside(c.cx + dx * r, c.cy + dy * r)) r += 0.0005; return r; };
  let cur = null, entry = 0;
  for (let k = 0; k < 5; k++) {
    const [ax, ay] = perim[k], [bx, by] = perim[k + 1], L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / step);
    for (let i = 0; i < n; i++) {
      const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
      const c = cuts.find(q => q.inside(x, y));
      if (c && !cur) { cur = c; entry = Math.atan2(y - c.cy, x - c.cx); continue; }
      if (c) continue;
      if (cur) {
        const exit = Math.atan2(y - cur.cy, x - cur.cx);
        let d = exit - entry; while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI;
        // go round the outer side: the middle direction points out of the table
        const pa = cur.p, mid = entry + d / 2;
        if (Math.cos(mid) * pa.ox + Math.sin(mid) * pa.oy < 0) d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
        const m = Math.max(12, Math.ceil(Math.abs(d) * 80));
        for (let j = 0; j <= m; j++) { const a = entry + d * j / m, r = reach(cur, a); out.push([cur.cx + Math.cos(a) * r, cur.cy + Math.sin(a) * r]); }
        cur = null;
      }
      out.push([x, y]);
    }
  }
  return out;
}

// The outline of the rectangle |x| < ix, |y| < iy less the hole circles
// (radius rc + extra): the perimeter, and round each circle the arc that
// lies inside the rectangle. A hole that crosses the outline cannot be a
// THREE.Path hole (the triangulation drops it), so it is part of the outline.
function bedOutline(ix, iy, cuts, extra) {
  const x0 = ix * 0.45, step = 0.003, out = [], perim = [[x0, -iy], [ix, -iy], [ix, iy], [-ix, iy], [-ix, -iy], [x0, -iy]];
  const inRect = (x, y) => Math.abs(x) <= ix + 1e-9 && Math.abs(y) <= iy + 1e-9;
  const hole = (x, y) => cuts.find(c => Math.hypot(x - c.cx, y - c.cy) < c.rc + extra);
  let inside = null, entry = null;
  for (let k = 0; k < 5; k++) {
    const [ax, ay] = perim[k], [bx, by] = perim[k + 1], L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / step);
    for (let i = 0; i < n; i++) {
      const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n, c = hole(x, y);
      if (c && !inside) { inside = c; entry = Math.atan2(y - c.cy, x - c.cx); continue; }
      if (c) continue;
      if (inside) {
        // the arc from the entry angle to the exit angle that stays in the rectangle
        const c0 = inside, r = c0.rc + extra, exit = Math.atan2(y - c0.cy, x - c0.cx);
        let d = exit - entry; while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI;
        const mid = a => inRect(c0.cx + Math.cos(a) * r, c0.cy + Math.sin(a) * r);
        if (!mid(entry + d / 2)) d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
        const m = Math.max(6, Math.ceil(Math.abs(d) * r / step));
        for (let j = 0; j <= m; j++) { const a = entry + d * j / m; out.push([c0.cx + Math.cos(a) * r, c0.cy + Math.sin(a) * r]); }
        inside = null;
      }
      out.push([x, y]);
    }
  }
  return out;
}

// an arc band (a flat ring sector) from radius r0 to r1 over angles a0..a1, in plan
function arcBand(cx, cy, r0, r1, a0, a1, segs = 40) {
  const pts = [];
  for (let k = 0; k <= segs; k++) { const a = a0 + (a1 - a0) * k / segs; pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]); }
  for (let k = segs; k >= 0; k--) { const a = a0 + (a1 - a0) * k / segs; pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]); }
  return shapeOf(pts);
}

// ── the table ────────────────────────────────────────────────────────────────
export function buildTableGroup(T, mats, phone) {
  const grp = new THREE.Group(), cw = T.spec.cushionW, rw = T.spec.railW, CUSH_H = T.spec.cushionTop, RAIL_TOP = T.spec.railTop;
  const ix = T.hx + cw, iy = T.hy + cw, ox = ix + rw, oy = iy + rw;
  const cuts = T.pockets.map(p => pocketCut(T, p));
  grp.userData.cuts = cuts;
  // the bed: the cloth to the cushion backs, less the pocket holes (they
  // cross the outline, so the outline itself goes round them)
  const bedPts = bedOutline(ix, iy, cuts, -0.003);
  const bed = shapeOf(bedPts);
  const bg = new THREE.ShapeGeometry(bed, 40); bg.rotateX(-Math.PI / 2);
  // planar UVs in metres for the felt
  { const pos = bg.attributes.position, uv = bg.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i)); }
  const bedMesh = new THREE.Mesh(bg, mats.cloth); bedMesh.receiveShadow = true; bedMesh.name = 'cloth'; grp.add(bedMesh);
  // the slate under the cloth (cut through at the holes)
  grp.add(Object.assign(slab(shapeOf(bedPts), -0.03, 0.0295, mats.slate), { name: 'slate' }));
  // cushions: the rubber with the cloth over it, cut along the jaw lines
  for (const q of cushionPolys(T)) {
    const m = slab(shapeOf(q), 0, CUSH_H, mats.cushion, 0.0025, 4);
    // planar UVs for the felt on the cushions too
    const pos = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + pos.getY(i) * 0.7, -pos.getZ(i) + pos.getY(i) * 0.7);
    m.name = 'cushion'; grp.add(m);
  }
  // the rail: wood from under the cloth to the rail top, cut at each pocket
  const rail = new THREE.Shape(); const rr = 0.035;
  rail.moveTo(-ox + rr, -oy); rail.lineTo(ox - rr, -oy); rail.quadraticCurveTo(ox, -oy, ox, -oy + rr); rail.lineTo(ox, oy - rr); rail.quadraticCurveTo(ox, oy, ox - rr, oy);
  rail.lineTo(-ox + rr, oy); rail.quadraticCurveTo(-ox, oy, -ox, oy - rr); rail.lineTo(-ox, -oy + rr); rail.quadraticCurveTo(-ox, -oy, -ox + rr, -oy);
  rail.holes.push(pathOf(railInner(T, cuts).reverse()));
  const railMesh = slab(rail, -0.03, RAIL_TOP + 0.03 - 0.002, mats.wood, 0.002);
  railMesh.name = 'rail'; grp.add(railMesh);
  // pockets: a leather cover on the rail round the back of the cut, the
  // liner of the cut, the drop bag under the hole
  for (const c of cuts) {
    const a0 = c.open[1], a1 = c.open[0] + 2 * Math.PI;          // the closed (back) side
    const cover = slab(arcBand(c.cx, c.cy, c.rc - 0.001, c.rc + 0.024, a0, a1), RAIL_TOP - 0.003, 0.0045, mats.leather, 0.0015, 4);
    cover.name = 'pocket-cover'; grp.add(cover);
    // the liner of the cut above the bed: only the back arc (the mouth stays open)
    const lin = new THREE.Mesh(new THREE.CylinderGeometry(c.rc - 0.0008, c.rc - 0.0008, RAIL_TOP + 0.03, 48, 1, true, a0 + Math.PI / 2, a1 - a0), mats.leatherIn);
    lin.position.set(c.cx, (RAIL_TOP - 0.03) / 2, -c.cy); lin.name = 'pocket-liner'; grp.add(lin);
    // the drop: a leather bag under the hole, full round, below the slate
    const bag = new THREE.Mesh(new THREE.CylinderGeometry(c.rc - 0.0008, c.rc * 0.82, 0.15, 40, 1, true), mats.leatherIn);
    bag.position.set(c.cx, -0.03 - 0.075, -c.cy); bag.name = 'pocket-bag'; grp.add(bag);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(c.rc * 0.82, 40), mats.leatherIn);
    bottom.rotation.x = -Math.PI / 2; bottom.position.set(c.cx, -0.18, -c.cy); bottom.name = 'pocket-bottom'; grp.add(bottom);
  }
  // diamonds: pearl inlays flush in the wood, each in a thin dark ring
  const dShape = shapeOf([[0, 0.012], [0.006, 0], [0, -0.012], [-0.006, 0]]);
  const dGeo = new THREE.ShapeGeometry(dShape); dGeo.rotateX(-Math.PI / 2);
  const rGeo = new THREE.ShapeGeometry(shapeOf([[0, 0.0145], [0.0078, 0], [0, -0.0145], [-0.0078, 0]])); rGeo.rotateX(-Math.PI / 2);
  for (const q of diamonds(T)) {
    const ring = new THREE.Mesh(rGeo, mats.inlayRim), d = new THREE.Mesh(dGeo, mats.pearl);
    for (const m of [ring, d]) { m.position.set(q.x, RAIL_TOP + (m === d ? 0.0004 : 0.0002), -q.y); if (q.side === 'long') m.rotation.y = Math.PI / 2; m.receiveShadow = true; grp.add(m); }
  }
  // the apron under the rail (below the slate), a brass bead along its top;
  // the long sides open at the side pockets so the drop bags hang free
  const APRON = 0.19, ay0 = -0.03 - APRON, at = 0.045;
  const board = (x0, x1, z0, z1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, APRON, z1 - z0), mats.apron); m.position.set((x0 + x1) / 2, ay0 + APRON / 2, (z0 + z1) / 2); m.castShadow = !phone; m.receiveShadow = true; m.name = 'apron'; grp.add(m); };
  const sideGap = T.pockets.find(p => p.kind === 'side').r + 0.02;
  for (const s of [-1, 1]) {
    board(-ox, -sideGap, s > 0 ? oy - at : -oy, s > 0 ? oy : -oy + at);
    board(sideGap, ox, s > 0 ? oy - at : -oy, s > 0 ? oy : -oy + at);
    board(s > 0 ? ox - at : -ox, s > 0 ? ox : -ox + at, -oy + at, oy - at);
  }
  // the bead: four thin brass strips on the outer face of the apron top (open at the side pockets)
  const strip = (x0, x1, z0, z1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.006, z1 - z0), mats.brass); m.position.set((x0 + x1) / 2, -0.034, (z0 + z1) / 2); m.name = 'bead'; grp.add(m); };
  for (const sz of [-1, 1]) { const z0 = sz * (oy + 0.002); strip(-ox - 0.002, -sideGap, Math.min(z0, z0 - sz * 0.006), Math.max(z0, z0 - sz * 0.006)); strip(sideGap, ox + 0.002, Math.min(z0, z0 - sz * 0.006), Math.max(z0, z0 - sz * 0.006)); }
  for (const sx of [-1, 1]) { const x0 = sx * (ox + 0.002); strip(Math.min(x0, x0 - sx * 0.006), Math.max(x0, x0 - sx * 0.006), -oy, oy); }
  // four turned legs (a lathe profile) on a dark plinth frame
  const floorY = -T.spec.bedH;
  const legH = -floorY + ay0;
  const prof = [[0, 0], [0.075, 0], [0.075, 0.05], [0.06, 0.07], [0.05, 0.12], [0.042, 0.3], [0.05, 0.42], [0.065, 0.46], [0.055, 0.5], [0.062, legH - 0.05], [0.07, legH - 0.02], [0.07, legH], [0, legH]].map(([r, y]) => new THREE.Vector2(r, y));
  const legGeo = new THREE.LatheGeometry(prof, phone ? 16 : 28);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(legGeo, mats.apron);
    leg.position.set(sx * (ox - 0.16), floorY, sz * (oy - 0.14));
    leg.castShadow = !phone; leg.receiveShadow = true; leg.name = 'leg'; grp.add(leg);
  }
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2 * (ox - 0.16), 0.05, 0.06), mats.plinth);
  for (const sz of [-1, 1]) { const m = plinth.clone(); m.position.set(0, floorY + 0.12, sz * (oy - 0.14)); m.receiveShadow = true; grp.add(m); }
  // the floor and a rug (a hint of the room)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), mats.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; floor.receiveShadow = true; floor.name = 'floor'; grp.add(floor);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2 * ox + 1.6, 2 * oy + 1.4), mats.rug);
  rug.rotation.x = -Math.PI / 2; rug.position.y = floorY + 0.002; rug.receiveShadow = true; rug.name = 'rug'; grp.add(rug);
  return grp;
}

// A three-shade billiard lamp: a dark metal bar, three cone shades with warm
// bulbs, a spot light under each. Shadows: the shadow camera fits the table
// (focus), PCF with a small radius (the bulb size), a small bias.
function buildLamp(scene, phone) {
  const grp = new THREE.Group(), body = new THREE.Group(), y = 1.0;
  grp.add(body);
  const metal = new THREE.MeshStandardMaterial({ color: 0x1d2a22, metalness: 0.6, roughness: 0.45 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.05), metal); bar.position.set(0, y + 0.16, 0); body.add(bar);
  const lights = [];
  [-0.55, 0, 0.55].forEach((x, k) => {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.19, 0.16, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x14402c, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }));
    shade.position.set(x, y + 0.07, 0); body.add(shade);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), new THREE.MeshBasicMaterial({ color: 0xd9ccb4 }));
    bulb.rotation.x = Math.PI / 2; bulb.position.set(x, y + 0.005, 0); body.add(bulb);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12), metal); rod.position.set(x, y + 0.2, 0); body.add(rod);
    // dimmer than before (the user: "the table lit up less brightly")
    const L = new THREE.SpotLight(0xffe8cc, phone ? 16 : 13, 4, 1.0, 0.8, 1.6);
    L.position.set(x, y - 0.01, 0); L.target.position.set(x * 1.15, 0, 0);
    const shadow = !phone || k === 1;
    L.castShadow = shadow;
    if (shadow) {
      const ms = phone ? 1024 : 2048;
      L.shadow.mapSize.set(ms, ms);
      // the shadow camera covers the table, not the room: three lights share
      // it on a desktop (0.8 of the cone each), one light on a phone (all of it)
      L.shadow.focus = phone ? 1 : 0.8;
      L.shadow.camera.near = 0.55; L.shadow.camera.far = 1.35;
      L.shadow.bias = -0.00012; L.shadow.normalBias = 0.0006;
      L.shadow.radius = phone ? 2 : 3;
    }
    grp.add(L, L.target); lights.push(L);
  });
  scene.add(grp);
  return { lights, body };
}

// The cue: tip, ferrule, maple shaft, ebony butt with a ring and a bumper.
// Built along +x from the tip at x = 0. 148 cm (core/cue.js cueRadius).
function buildCue(mats) {
  const grp = new THREE.Group();
  const part = (r0, r1, len, x0, mat) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 24); g.rotateZ(-Math.PI / 2); g.translate(x0 + len / 2, 0, 0);
    const m = new THREE.Mesh(g, mat); m.castShadow = true; grp.add(m); return m;
  };
  part(0.0063, 0.0064, 0.008, 0, mats.tip);
  part(0.0064, 0.0065, 0.022, 0.008, mats.ferrule);
  part(0.0065, 0.0105, 0.72, 0.03, mats.maple);
  part(0.0105, 0.011, 0.02, 0.75, mats.ferrule);
  part(0.011, 0.0145, 0.70, 0.77, mats.ebony);
  part(0.0145, 0.0146, 0.01, 1.47, mats.tip);
  return grp;
}

// The bridge under the cue: a V rest on a small foot (on the cloth or the
// rail), its height set to the cue at that point.
function buildBridge(mats) {
  const grp = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.006, 20), mats.bridge); foot.position.y = 0.003; grp.add(foot);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 10), mats.bridge); grp.add(post);
  const vL = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, 0.004), mats.bridge), vR = vL.clone();
  vL.rotation.x = 0.6; vR.rotation.x = -0.6; grp.add(vL, vR);
  grp.userData = { post, vL, vR };
  for (const m of [foot, post, vL, vR]) m.castShadow = true;
  return grp;
}

// Contact shadows: an ambient occlusion disc on the cloth under each ball.
// The lamp shadow of a ball falls a little off its foot (the light is not
// straight above); this dark core sits exactly under the contact point.
function contactShadows(scene, R) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { k: { value: 0.62 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float k; varying vec2 vUv; void main(){ float r = length(vUv); float a = k * pow(clamp(1.0 - r, 0.0, 1.0), 2.2); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
  });
  const geo = new THREE.PlaneGeometry(2.5 * R, 2.5 * R); geo.rotateX(-Math.PI / 2);
  const out = [];
  for (let n = 0; n < 16; n++) { const m = new THREE.Mesh(geo, mat); m.visible = false; m.renderOrder = 1; m.name = 'contact-shadow'; scene.add(m); out.push(m); }
  return out;
}

export function createScene(canvas, T, { phone = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, powerPreference: 'high-performance' });
  } catch (e) { return null; }
  if (!renderer.getContext()) return null;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;      // PCF takes shadow.radius (PCFSoft does not)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060708);
  scene.fog = new THREE.Fog(0x060708, 5, 12);
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.05, 30);
  camera.position.set(0, 2.1, 2.3);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.5; controls.maxDistance = 6.5; controls.maxPolarAngle = 1.42;
  controls.target.set(0, 0, 0);

  const loader = new THREE.TextureLoader();
  const tex = (base, f, srgb = true, rep = [1, 1]) => {
    try {
      const t = loader.load(base + f);
      t.userData.url = base + f;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 8;
      return t;
    } catch (e) { return null; }
  };
  // the felt: one tile is 0.3 m of cloth (planar UVs in metres)
  const FELT = 1 / 0.3;
  const feltMap = tex(ART, 'felt-color.jpg', true, [FELT, FELT]), feltN = tex(ART, 'felt-normal.jpg', false, [FELT, FELT]);
  const feltMaterial = (color) => new THREE.MeshPhysicalMaterial({
    color, map: feltMap, normalMap: feltN, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.94,
    sheen: 0.35, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x2a6e4c), anisotropy: 0.2, anisotropyRotation: 0,
  });
  const rose = (rep) => new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tex(TEX, 'rosewood-color.jpg', true, rep), normalMap: tex(TEX, 'rosewood-normal.jpg', false, rep), roughnessMap: tex(TEX, 'rosewood-rough.jpg', false, rep), roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08 });
  const mats = {
    wood: rose([1.4, 1.4]),
    apron: new THREE.MeshPhysicalMaterial({ color: 0xc8b6a8, map: tex(TEX, 'mahogany-color.jpg', true, [2, 2]), normalMap: tex(TEX, 'mahogany-normal.jpg', false, [2, 2]), roughnessMap: tex(TEX, 'mahogany-rough.jpg', false, [2, 2]), roughness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    cloth: feltMaterial(0x1f6a46),
    cushion: feltMaterial(0x1c6342),
    slate: new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.85 }),
    leather: new THREE.MeshPhysicalMaterial({ color: 0x2b1a12, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.5 }),
    leatherIn: new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.9, side: THREE.DoubleSide }),
    pearl: new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.22, iridescence: 0.7, clearcoat: 1 }),
    inlayRim: new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.5 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.9, roughness: 0.35 }),
    plinth: new THREE.MeshStandardMaterial({ color: 0x0f0b09, roughness: 0.7 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x5a4a40, map: tex(TEX, 'ebony-color.jpg', true, [10, 40]), roughness: 0.7 }),
    rug: new THREE.MeshStandardMaterial({ color: 0x3a1c1a, roughness: 1 }),
    bridge: new THREE.MeshStandardMaterial({ color: 0x24272a, metalness: 0.5, roughness: 0.4 }),
    tip: new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.9 }),
    ferrule: new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.35 }),
    maple: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex(TEX, 'maple-color.jpg', true, [6, 0.2]), roughness: 0.4 }),
    ebony: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex(TEX, 'ebony-color.jpg', true, [4, 0.2]), roughness: 0.35 }),
  };
  const table = buildTableGroup(T, mats, phone);
  scene.add(table);
  const { lights, body: lampBody } = buildLamp(scene, phone);
  scene.add(new THREE.HemisphereLight(0x7d8a96, 0x140e0a, 0.16));

  // balls: the decal, clearcoat, and real fingerprints and smudges in the roughness
  const geo = new THREE.SphereGeometry(T.R, phone ? 32 : 48, phone ? 20 : 32);
  const smudge = tex(ART, 'ball-smudge-rough.jpg', false, [2, 1]);
  const balls = [], qBase = [], rng = rngOf(11);
  for (let n = 0; n < 16; n++) {
    // the decal number faces up at rest, each ball turned a little about the vertical
    qBase.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (n * 2.39996) % (2 * Math.PI), 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)));
    const map = ballTexture(n);
    const rough = smudge ? smudge.clone() : null;
    if (rough) { rough.offset.set(rng(), rng()); rough.needsUpdate = true; }
    const mat = new THREE.MeshPhysicalMaterial({ color: map ? 0xffffff : ballColor(n), map, roughness: 0.32, roughnessMap: rough, clearcoat: 1, clearcoatRoughness: 0.16, clearcoatRoughnessMap: rough });
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.visible = false; m.name = 'ball-' + n;
    scene.add(m); balls.push(m);
  }
  const contact = contactShadows(scene, T.R);
  const cue = buildCue(mats); cue.visible = false; scene.add(cue);
  const bridge = buildBridge(mats); bridge.visible = false; scene.add(bridge);

  // overlays: they draw over the balls (no depth test), the arrows from the ball centre
  const ovl = new THREE.Group(); ovl.renderOrder = 10; scene.add(ovl);
  const aimMat = new THREE.LineDashedMaterial({ color: 0x62c4ff, dashSize: 0.025, gapSize: 0.018, transparent: true, opacity: 0.9 });
  const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const aimLine = new THREE.Line(aimGeo, aimMat); aimLine.visible = false; ovl.add(aimLine);
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(T.R, 24, 16), new THREE.MeshBasicMaterial({ color: 0x62c4ff, wireframe: true, transparent: true, opacity: 0.45 }));
  ghost.visible = false; ovl.add(ghost);
  const arrowPool = [];
  const colorOf = m => ({ m1: 0x62c4ff, m2: 0xff9a62, m3: 0x86dc7c, m4: 0xe889dc, m5: 0xffd666, m6: 0xa8a4ff })[m] || 0xffffff;
  function arrow(k) {
    if (arrowPool[k]) return arrowPool[k];
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 8), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.024, 12), mat);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 10, 8), mat);   // the ball centre
    for (const m of [shaft, head, dot]) m.renderOrder = 11;
    g.add(shaft, head, dot); g.userData = { shaft, head, dot }; ovl.add(g); arrowPool[k] = g;
    return g;
  }
  const up = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), X1 = new THREE.Vector3(1, 0, 0);

  const V = { renderer, scene, camera, controls, balls, lights, lamp: lampBody, table, contact, cue, bridge, arrows: arrowPool, mode: 'auto', onUserOrbit: null, cuePose: null };
  let w = 1, h = 1;
  let lastSize = '';
  V.resize = (W, H, dpr) => {
    // the same size again would reset the drawing buffer (the saver calls it every frame)
    const key = `${Math.round(W)}x${Math.round(H)}@${dpr}`;
    if (key === lastSize) return;
    lastSize = key;
    w = Math.max(1, W); h = Math.max(1, H);
    renderer.setPixelRatio(Math.min(dpr || 1, phone ? 1.75 : 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  V.setBalls = list => {
    for (let n = 0; n < 16; n++) { balls[n].visible = false; contact[n].visible = false; }
    for (const b of list) {
      const m = balls[b.n];
      let x = b.x, y = b.y, Y = T.R;
      if (b.drop) { const p = b.drop.p; if (p >= 1) continue; x += (b.drop.hx - x) * Math.min(1, p * 1.6); y += (b.drop.hy - y) * Math.min(1, p * 1.6); Y = T.R - 0.16 * p * p; }
      m.visible = true;
      m.position.set(x, BED_Y + Y, -y);
      if (b.q) m.quaternion.set(b.q[1], b.q[3], -b.q[2], b.q[0]).multiply(qBase[b.n]); else m.quaternion.copy(qBase[b.n]);
      // the contact shadow: right under the ball on the cloth, not while it drops
      if (!b.drop) { const c = contact[b.n]; c.visible = true; c.position.set(x, BED_Y + 0.0006, -y); }
    }
  };
  // c: { x, y, phi, a, b, back, alpha }; S: the physics state (the other balls)
  V.setCue = (c, S) => {
    if (!c) { cue.visible = false; bridge.visible = false; V.cuePose = null; return; }
    const P = cuePose(T, S || { on: new Uint8Array(16) }, c);
    V.cuePose = P;
    cue.visible = true;
    cue.position.set(P.tip[0], BED_Y + P.tip[2], -P.tip[1]);
    tmpV.set(P.u[0], P.u[2], -P.u[1]);
    tmpQ.setFromUnitVectors(X1, tmpV);
    cue.quaternion.copy(tmpQ);
    const al = c.alpha ?? 1;
    cue.traverse(o => { if (o.material) { o.material.transparent = al < 1; o.material.opacity = al; } });
    // the bridge: from its base (cloth or rail top) up to the bottom of the cue
    const B = P.bridge, top = B.z - cueRadius(B.s) - 0.001, base = B.base;
    bridge.visible = al > 0.5;
    bridge.position.set(B.x, BED_Y + base, -B.y);
    bridge.rotation.y = P.phi;
    const hgt = Math.max(0.004, top - base), { post, vL, vR } = bridge.userData;
    post.scale.y = hgt; post.position.y = hgt / 2;
    vL.position.set(0, hgt, 0.006); vR.position.set(0, hgt, -0.006);
  };
  V.setOverlay = o => {
    o = o || {};
    if (o.aim) {
      const [a, b] = o.aim, pos = aimGeo.attributes.position;
      pos.setXYZ(0, a[0], BED_Y + 0.0015, -a[1]); pos.setXYZ(1, b[0], BED_Y + 0.0015, -b[1]); pos.needsUpdate = true;
      aimLine.computeLineDistances(); aimLine.visible = true; aimMat.opacity = o.aimAlpha ?? 0.9;
    } else aimLine.visible = false;
    if (o.ghost) { ghost.visible = true; ghost.position.set(o.ghost[0], BED_Y + T.R, -o.ghost[1]); ghost.material.opacity = 0.45 * (o.ghostAlpha ?? 1); } else ghost.visible = false;
    const A = o.arrows || [];
    for (let k = 0; k < arrowPool.length; k++) if (arrowPool[k]) arrowPool[k].visible = false;
    A.forEach((r, k) => {
      const L = Math.hypot(r.vec[0], r.vec[1]);
      if (L < 0.01) return;
      const g = arrow(k), { shaft, head } = g.userData;
      shaft.material.color.setHex(colorOf(r.m));
      const len = Math.max(0.03, L);
      shaft.scale.set(1, len - 0.024, 1); shaft.position.set(0, (len - 0.024) / 2, 0); head.position.set(0, len - 0.012, 0);
      // from the ball centre, in the plane of the centres (ball-centre height)
      g.position.set(r.from[0], BED_Y + T.R, -r.from[1]);
      tmpV.set(r.vec[0] / L, 0, -r.vec[1] / L); g.quaternion.setFromUnitVectors(up, tmpV);
      g.visible = true;
    });
  };
  // the camera: presets and the auto director
  let focus = { phase: 'idle', cx: 0, cy: 0, phi: 0 };
  V.focus = f => { focus = Object.assign(focus, f); };
  V.camMode = m => { V.mode = m; };
  let userOrbit = false;
  controls.addEventListener('start', () => { userOrbit = true; if (V.mode !== 'free') { V.mode = 'free'; if (V.onUserOrbit) V.onUserOrbit(); } });
  controls.addEventListener('end', () => { userOrbit = false; });
  function camTarget() {
    const asp = w / h, fov = camera.fov * Math.PI / 180;
    const fitX = (T.hx + 0.25) / Math.tan(Math.atan(Math.tan(fov / 2) * asp)), fitY = (T.hy + 0.25) / Math.tan(fov / 2);
    let mode = V.mode;
    if (mode === 'auto') mode = focus.phase === 'aim' || focus.phase === 'plan' ? 'behind' : 'broadcast';
    if (mode === 'behind') {
      const d = [Math.cos(focus.phi), Math.sin(focus.phi)];
      return { p: [focus.cx - d[0] * 1.05, 0.42, -(focus.cy - d[1] * 1.05)], t: [focus.cx + d[0] * 0.55, 0.0, -(focus.cy + d[1] * 0.55)] };
    }
    lampBody.visible = mode !== 'overhead';
    if (mode === 'overhead') { const dist = Math.max(fitX, fitY) * 1.02; return asp >= 1 ? { p: [0, dist, 0.001], t: [0, 0, 0] } : { p: [0.001, dist * 1.15, 0], t: [0, 0, 0], roll: true }; }
    if (asp < 0.9) {
      // a portrait pane: along the table from behind the head rail
      const dist = (T.hy + 0.3) / Math.tan(Math.atan(Math.tan(fov / 2) * asp)) * 1.05 + T.hx;
      return { p: [-dist * 0.82, dist * 0.62, 0], t: [0.1, 0, 0] };
    }
    const dist = Math.max(fitX, fitY * 1.4) * 1.02;
    return { p: [0, dist * 0.72, dist * 0.72], t: [0, -0.05, 0] };
  }
  V.snapCamera = () => { const c = camTarget(); camera.position.set(...c.p); controls.target.set(...c.t); camera.up.set(0, 1, 0); controls.update(); };
  V.update = dt => {
    if (V.mode !== 'free' && !userOrbit) {
      const c = camTarget(), k = 1 - Math.exp(-dt / 0.55);
      camera.position.x += (c.p[0] - camera.position.x) * k; camera.position.y += (c.p[1] - camera.position.y) * k; camera.position.z += (c.p[2] - camera.position.z) * k;
      controls.target.x += (c.t[0] - controls.target.x) * k; controls.target.y += (c.t[1] - controls.target.y) * k; controls.target.z += (c.t[2] - controls.target.z) * k;
    }
    controls.update();
  };
  V.render = () => renderer.render(scene, camera);
  // a tap on the cloth: the table point under the pointer
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BED_Y + T.R)), hit = new THREE.Vector3();
  V.pick = (px, py) => {
    ray.setFromCamera(new THREE.Vector2(px / w * 2 - 1, -(py / h) * 2 + 1), camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, y: -hit.z };
  };
  V.dispose = () => { renderer.dispose(); };
  return V;
}
