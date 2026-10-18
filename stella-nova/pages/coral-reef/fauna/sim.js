// ============================================================================
//  CORAL REEF  ·  fauna/sim.js  ·  how the creatures move (DOM-free)
// ----------------------------------------------------------------------------
//  Every animal is an agent in flat typed arrays (no object per animal), so
//  a phone moves a few hundred and a desktop a few thousand each frame.
//
//    const S = createSim({ sdf, sdfScale, maxAgents, simEvery, seed })
//    S.addGroup(group, chunkKey, grid) -> agents added (0 when full)
//        group: a spawn group (fauna/spawn.js); grid: the chunk ground
//        (spawn.js groundGrid) for the crawlers and the floor of the swimmers
//    S.removeChunk(key)                frees the agents of a chunk
//    S.step(dt, { t, rovs: [{ p, look }], current: [x, z] })
//    S.count, S.groups (Map id -> group), S.capacity, S.stats
//    arrays: px py pz (Float64, world m), vx vy vz, yaw, pitch, size, phase,
//            glow (startle 0..1), spec (species slot), alive, cyc (gait)
//
//  BEHAVIOUR (species.js habit)
//    school ... boids on the near neighbours only (function flock): each
//               fish finds up to KNN = 6 nearest in its perception radius
//               and field of view (a spatial hash per group, 2x2x2 cells),
//               then separation, alignment and cohesion on them. Each fish
//               has its own speed, turn rate, depth offset and wander
//               (trait, turn, offY), and the turn force has a limit, so
//               the headings change smoothly. The group goal wanders round
//               the home; a pull to the centre acts only outside the group
//               radius. Squid pods (anim CEPH): looser rules, a drag (they
//               hover) and short jets in a new direction at random times.
//               Before (2026-10-18) each fish matched the mean velocity of
//               the whole group and had the same goal force, so a school
//               moved as one rigid array.
//    swim ..... one goal that wanders far; hover: a slow drift at home;
//    drift .... the current plus a slow bob; still: no motion
//    crawl .... walk and pause on the ground (function stepCrawl): a walk
//               of 4-20 s at the own speed, then a pause of 3-15 s. The
//               heading turns only while it walks, at most 0.5 rad/s, to
//               a wanted heading (a new one at each walk, or to the home).
//               A blocked step stops the walk and picks a new heading; it
//               never spins in place. The height and the pitch follow a
//               smoothed ground (a slow spring). Before (2026-10-18) the
//               yaw turned 90 degrees on each blocked frame and snapped to
//               the home, so the isopods thrashed on slopes.
//  THE GAIT. cyc (Float64) is the integral of the gait rate: 1 for most
//    kinds, the speed ratio for fish, eels and walkers. fauna/index.js
//    sends fract(cyc * rate) to the shader, so a change of speed changes
//    the beat rate and never makes the phase jump (uTime * rate did).
//  THE ROCK. A swimmer checks the solid (sdf in m) once each simEvery
//    frames (round robin) and steers away under CLEAR + 0.6 m. If the
//    check finds it nearer than CLEAR / 2 it goes back to its last safe
//    point and turns round, so no swimmer is ever in rock (it moves less
//    than 5 cm between two checks). The ground grid keeps it over the
//    floor each frame.
//  THE ROVS (species.js light): 'flee' parts round the vehicles (a school
//    opens a hole), 'attract' comes to the lit spot in front of the lamps
//    in the dark (deeper than 150 m), 'curious' comes to about 4 m and
//    circles, 'ignore' does nothing. A startle sets glow (the photophores
//    flash).
//
//  grep -n targets: "export function createSim", "function stepGroup",
//  "function rockCheck", "function reactRovs", "function flock"
// ============================================================================
import { CLEAR, rngOf } from './spawn.js';
import { ANIM } from './species.js';

const KNN = 6, TB = 4096;

const SURF = 55;

export function createSim({ sdf = null, sdfScale = 0.4, maxAgents = 1000, simEvery = 3, seed = 1 } = {}) {
  const N = maxAgents;
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
  const sx = new Float64Array(N), sy = new Float64Array(N), sz = new Float64Array(N);     // last safe point
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  const yaw = new Float32Array(N), pitch = new Float32Array(N), size = new Float32Array(N), phase = new Float32Array(N), glow = new Float32Array(N);
  const spec = new Int32Array(N).fill(-1), grp = new Int32Array(N).fill(-1), alive = new Uint8Array(N);
  // per-animal traits (school): speed factor, turn rate, depth offset, jet timer
  const cyc = new Float64Array(N), wantYaw = new Float32Array(N), gy0 = new Float32Array(N);
  const trait = new Float32Array(N), turn = new Float32Array(N), offY = new Float32Array(N), jet = new Float32Array(N);
  // the neighbour hash (one group at a time): bucket heads with a stamp, links
  const head = new Int32Array(TB), stampOf = new Int32Array(TB), link = new Int32Array(N);
  const nbI = new Int32Array(KNN), nbD = new Float32Array(KNN);
  let stamp = 0;
  const free = []; for (let i = N - 1; i >= 0; i--) free.push(i);
  const groups = new Map(), byChunk = new Map(), specSlots = new Map(), specList = [];
  const R = rngOf(seed ^ 0x51A1);
  let gid = 1, frame = 0, count = 0;
  const stats = { added: 0, removed: 0, rockChecks: 0, rockHits: 0, full: 0 };
  const solid = sdf ? (x, y, z) => sdf(x, y, z) / sdfScale : null;

  function slotOf(sp) {
    let s = specSlots.get(sp.id);
    if (s === undefined) { s = specList.length; specList.push(sp); specSlots.set(sp.id, s); }
    return s;
  }

  function addGroup(g, chunk, grid) {
    const sp = g.sp, n = g.members.length;
    if (free.length < n) { stats.full++; if (!free.length) return 0; }
    const id = gid++, idx = [];
    const benthic = sp.habit === 'crawl' || sp.habit === 'still';
    for (const m of g.members) {
      if (!free.length) break;
      const i = free.pop();
      px[i] = sx[i] = m.x; py[i] = sy[i] = m.y; pz[i] = sz[i] = m.z;
      const sp0 = benthic ? 0 : sp.speed || 0.2;
      vx[i] = Math.sin(m.yaw) * sp0 * 0.5; vz[i] = Math.cos(m.yaw) * sp0 * 0.5; vy[i] = 0;
      yaw[i] = m.yaw; pitch[i] = 0; size[i] = m.size; phase[i] = R(); glow[i] = 0;
      spec[i] = slotOf(sp); grp[i] = id; alive[i] = 1;
      cyc[i] = R() * 10; wantYaw[i] = m.yaw; gy0[i] = m.y;
      trait[i] = 0.82 + 0.36 * R(); turn[i] = 0.7 + 0.6 * R(); jet[i] = R() * 3;
      const al = sp.alt || [1, 6]; offY[i] = (R() - 0.5) * Math.min(4, (al[1] - al[0]) * 0.5);
      idx.push(i);
    }
    const c = g.centre.slice();
    const ceph = sp.anim === ANIM.CEPH || sp.anim === 'CEPH';
    const perc = Math.max(ceph ? 3.5 : 2.5, (sp.size[1] || 0.2) * 10);
    const G = {
      id, sp, chunk, ceph, perc, radius: 3 + Math.sqrt(idx.length) * 0.6, feature: g.feature, members: Int32Array.from(idx), habit: sp.habit, benthic, onCoral: !!(g.members[0] && g.members[0].onCoral),
      home: c, target: c.slice(), retarget: 0, centre: c.slice(), vel: [0, 0, 0], grid,
    };
    groups.set(id, G);
    if (!byChunk.has(chunk)) byChunk.set(chunk, []);
    byChunk.get(chunk).push(id);
    count += idx.length; stats.added += idx.length;
    return idx.length;
  }

  function removeChunk(key) {
    const ids = byChunk.get(key); if (!ids) return 0;
    let n = 0;
    for (const id of ids) {
      const G = groups.get(id); if (!G) continue;
      for (const i of G.members) { if (!alive[i]) continue; alive[i] = 0; spec[i] = -1; grp[i] = -1; free.push(i); n++; }
      groups.delete(id);
    }
    byChunk.delete(key);
    count -= n; stats.removed += n;
    return n;
  }

  const groundOf = (G, x, z) => (G.grid ? G.grid.ground(x, z) : -Infinity);

  function rockCheck(i, G) {
    if (!solid) return;
    stats.rockChecks++;
    const d = solid(px[i], py[i], pz[i]);
    if (d < CLEAR * 0.5) {
      stats.rockHits++;
      // back to the last safe point; if that is the same point (a coral grew
      // round the spawn), rise out of it
      if (px[i] === sx[i] && py[i] === sy[i] && pz[i] === sz[i]) sy[i] += 0.5;
      px[i] = sx[i]; py[i] = sy[i]; pz[i] = sz[i];
      vx[i] = -vx[i] * 0.6; vz[i] = -vz[i] * 0.6; vy[i] = Math.abs(vy[i]) * 0.6 + 0.05;
    } else {
      sx[i] = px[i]; sy[i] = py[i]; sz[i] = pz[i];
      if (d < CLEAR + 0.6) { vy[i] += 0.25; vx[i] += (G.centre[0] - px[i]) * 0.05; vz[i] += (G.centre[2] - pz[i]) * 0.05; }
    }
  }

  function reactRovs(i, G, rovs, depth, k) {
    const L = G.sp.light;
    if (!rovs || L === 'ignore') return;
    for (const r of rovs) {
      const dx = px[i] - r.p[0], dy = py[i] - r.p[1], dz = pz[i] - r.p[2], d = Math.hypot(dx, dy, dz) || 1e-3;
      if (L === 'flee') {
        const rad = 2.2 + size[i] * 3;
        if (d < rad) { const f = (1 - d / rad) * 3.2 * k; vx[i] += dx / d * f; vy[i] += dy / d * f * 0.5; vz[i] += dz / d * f; glow[i] = 1; }
      } else if (L === 'attract' && depth > 150 && d < 14) {
        const lx = r.p[0] + r.look[0] * 3, ly = r.p[1] + r.look[1] * 3, lz = r.p[2] + r.look[2] * 3;
        const ex = lx - px[i], ey = ly - py[i], ez = lz - pz[i], e = Math.hypot(ex, ey, ez) || 1e-3;
        if (d > 1.2) { const f = 0.25 * k; vx[i] += ex / e * f; vy[i] += ey / e * f; vz[i] += ez / e * f; }
        else { vx[i] += dx / d * 0.6 * k; vy[i] += dy / d * 0.6 * k; vz[i] += dz / d * 0.6 * k; }
      } else if (L === 'curious' && d < 16) {
        const want = 4, f = (d - want) / want * 0.15 * k;
        vx[i] -= dx / d * f; vy[i] -= dy / d * f * 0.4; vz[i] -= dz / d * f;
        vx[i] += -dz / d * 0.05 * k; vz[i] += dx / d * 0.05 * k;
      }
    }
  }

  // the near-neighbour boids of one school member: returns the steer in
  // FL[0..2]. The hash of the group is built in stepGroup (cell = G.perc).
  const FL = new Float64Array(3);
  const hkey = (a, b, c) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & (TB - 1);
  function flock(i, G) {
    const c = G.perc, x = px[i], y = py[i], z = pz[i];
    const v = Math.hypot(vx[i], vy[i], vz[i]) || 1e-6, fx = vx[i] / v, fy = vy[i] / v, fz = vz[i] / v;
    let k = 0;
    const bx = Math.floor(x / c - 0.5), by = Math.floor(y / c - 0.5), bz = Math.floor(z / c - 0.5);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let e = 0; e < 2; e++) {
      const h = hkey(bx + a, by + b, bz + e);
      if (stampOf[h] !== stamp) continue;
      for (let j = head[h]; j >= 0; j = link[j]) {
        if (j === i) continue;
        const dx = px[j] - x, dy = py[j] - y, dz = pz[j] - z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > c * c || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        if ((dx * fx + dy * fy + dz * fz) / d < -0.5 && d > size[i] * 2) continue;     // the blind cone behind
        if (k < KNN) { nbI[k] = j; nbD[k] = d; k++; }
        else { let w = 0; for (let q = 1; q < KNN; q++) if (nbD[q] > nbD[w]) w = q; if (d < nbD[w]) { nbI[w] = j; nbD[w] = d; } }
      }
    }
    FL[0] = FL[1] = FL[2] = 0;
    if (!k) return 0;
    const ceph = G.ceph, sepR = Math.max(0.2, size[i] * (ceph ? 2.2 : 2.4)) * (0.4 + 0.5 * turn[i]);
    const wA = ceph ? 0.25 : 0.9, wC = ceph ? 0.1 : 0.35, wS = ceph ? 1.6 : 2.4;
    let ax = 0, ay = 0, az = 0, mx = 0, my = 0, mz = 0, qx = 0, qy = 0, qz = 0;
    for (let q = 0; q < k; q++) {
      const j = nbI[q], d = nbD[q];
      const vj = Math.hypot(vx[j], vy[j], vz[j]) || 1e-6;
      mx += vx[j] / vj; my += vy[j] / vj; mz += vz[j] / vj; qx += px[j]; qy += py[j]; qz += pz[j];
      if (d < sepR) { const f = (sepR - d) / sepR * wS / d; ax -= (px[j] - x) * f; ay -= (py[j] - y) * f; az -= (pz[j] - z) * f; }
    }
    // alignment on the heading only: each keeps its own speed
    ax += (mx / k * v - vx[i]) * wA; ay += (my / k * v - vy[i]) * wA * 0.6; az += (mz / k * v - vz[i]) * wA;
    // cohesion only past a comfort distance, so the school does not pack
    const cx = qx / k - x, cy = qy / k - y, cz = qz / k - z, cd = Math.hypot(cx, cy, cz) || 1e-6, ck = wC * Math.max(0, 1 - sepR * 2.5 / cd);
    ax += cx * ck; ay += cy * ck * 0.5; az += cz * ck;
    FL[0] = ax; FL[1] = ay; FL[2] = az;
    return k;
  }

  // the walkers on the ground: walk and pause, rate-limited turns, a smooth
  // height and pitch. jet[i] is the walk (> 0) or pause (< 0) clock.
  function stepCrawl(G, dt, o, near, depth) {
    const sp = G.sp, M = G.members, spd = sp.speed || 0.02, gr = G.grid;
    for (let q = 0; q < M.length; q++) {
      const i = M[q]; if (!alive[i]) continue;
      if (jet[i] > 0) { jet[i] -= dt; if (jet[i] <= 0) jet[i] = -(3 + R() * 12); }
      else {
        jet[i] += dt;
        if (jet[i] >= 0) {
          jet[i] = 4 + R() * 16;
          const hx = G.home[0] - px[i], hz = G.home[2] - pz[i];
          wantYaw[i] = hx * hx + hz * hz > 36 ? Math.atan2(hx, hz) + (R() - 0.5) * 0.8 : yaw[i] + (R() - 0.5) * 2.4;
        }
      }
      let v = 0;
      if (jet[i] > 0) {
        // ease in and out of the walk; the turn only while it walks
        v = spd * trait[i] * Math.min(1, jet[i] * 0.7, 1.5 + jet[i]);
        let dy = wantYaw[i] - yaw[i]; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
        const yaw0 = yaw[i];
        yaw[i] += Math.max(-0.5 * dt, Math.min(0.5 * dt, dy)) * Math.min(1, v / spd);
        const nx = px[i] + Math.sin(yaw[i]) * v * dt, nz = pz[i] + Math.cos(yaw[i]) * v * dt;
        const inside = !gr || (nx > gr.x0 + 0.5 && nx < gr.x0 + 31.5 && nz > gr.z0 + 0.5 && nz < gr.z0 + 31.5);
        const gy = inside ? groundOf(G, nx, nz) : -Infinity;
        const steep = gy > -Infinity && Math.abs(gy - groundOf(G, px[i], pz[i])) > Math.max(v * dt * 1.5, 1e-4) + 0.003;
        if (gy > -Infinity && !steep && SURF - gy >= sp.depth[0] && SURF - gy <= sp.depth[1]) { px[i] = nx; pz[i] = nz; }
        else { v = 0; yaw[i] = yaw0; jet[i] = -(1 + R() * 3); wantYaw[i] = yaw[i] + (R() < 0.5 ? 1 : -1) * (1.2 + R() * 1.4); }
      }
      vx[i] = Math.sin(yaw[i]) * v; vz[i] = Math.cos(yaw[i]) * v; vy[i] = 0;
      // the height and the pitch follow a smoothed ground
      const g = groundOf(G, px[i], pz[i]);
      if (g > -Infinity) {
        gy0[i] += (g - gy0[i]) * Math.min(1, dt * 3); py[i] = gy0[i];
        const L = Math.max(0.3, size[i]), ga = groundOf(G, px[i] + Math.sin(yaw[i]) * L, pz[i] + Math.cos(yaw[i]) * L), gb = groundOf(G, px[i] - Math.sin(yaw[i]) * L, pz[i] - Math.cos(yaw[i]) * L);
        const want = ga > -Infinity && gb > -Infinity ? -Math.atan2(ga - gb, 2 * L) : 0;
        pitch[i] += (Math.max(-0.6, Math.min(0.6, want)) - pitch[i]) * Math.min(1, dt * 1.5);
      }
      if (near) reactRovs(i, G, o.rovs, depth, 0.2);
      glow[i] = Math.max(0, glow[i] - dt);
    }
  }

  // the gait clock (THE GAIT in the header)
  function gait(G, dt) {
    const sp = G.sp, M = G.members, a = sp.anim, spd = sp.speed || 0.2;
    const fish = a === ANIM.FISH || a === ANIM.EEL || a === 'FISH' || a === 'EEL', walk = G.habit === 'crawl';
    for (let q = 0; q < M.length; q++) {
      const i = M[q]; if (!alive[i]) continue;
      let r = 1;
      if (fish || walk) {
        const v = Math.hypot(vx[i], vy[i], vz[i]);
        r = walk ? Math.min(1.5, v / Math.max(0.003, spd)) : Math.min(2.5, 0.6 + v / Math.max(0.05, size[i]) * 0.5);
      }
      cyc[i] += dt * r;
    }
  }

  function stepGroup(G, dt, o) {
    const sp = G.sp, M = G.members, n = M.length;
    if (G.habit === 'still' || G.onCoral) return;
    // the centre and the mean velocity
    let cx = 0, cy = 0, cz = 0, mx = 0, my = 0, mz = 0, m = 0;
    for (let q = 0; q < n; q++) { const i = M[q]; if (!alive[i]) continue; cx += px[i]; cy += py[i]; cz += pz[i]; mx += vx[i]; my += vy[i]; mz += vz[i]; m++; }
    if (!m) return;
    cx /= m; cy /= m; cz /= m; mx /= m; my /= m; mz /= m;
    G.centre[0] = cx; G.centre[1] = cy; G.centre[2] = cz;
    const depth = SURF - cy;
    // a rov near the group? (a cheap test before the per-animal reaction)
    let near = false;
    if (o.rovs) for (const r of o.rovs) if (Math.hypot(cx - r.p[0], cy - r.p[1], cz - r.p[2]) < 24) near = true;
    const spd = sp.speed || 0.2;
    if (G.habit === 'crawl') { stepCrawl(G, dt, o, near, depth); gait(G, dt); return; }
    // swimmers: retarget the group goal now and then
    G.retarget -= dt;
    if (G.retarget <= 0) {
      const r = G.habit === 'school' ? 10 : G.habit === 'swim' ? 18 : 3;
      const a = R() * Math.PI * 2, rr = r * Math.sqrt(R());
      const tx = G.home[0] + Math.cos(a) * rr, tz = G.home[2] + Math.sin(a) * rr;
      const alt = sp.alt || [1, 6], gy = groundOf(G, tx, tz) > -Infinity ? groundOf(G, tx, tz) : G.home[1] - alt[0];
      let ty = gy + alt[0] + (alt[1] - alt[0]) * R();
      ty = Math.min(ty, SURF - sp.depth[0] - 0.3); ty = Math.max(ty, SURF - sp.depth[1] + 0.3);
      G.target = [tx, ty, tz];
      G.retarget = 6 + R() * 10;
    }
    const tx = G.target[0], ty = G.target[1], tz = G.target[2];
    const cur = o.current || [0, 0];
    if (G.habit === 'school') {
      stamp++;
      const c = G.perc;
      for (let q = 0; q < n; q++) {
        const i = M[q]; if (!alive[i]) continue;
        const h = hkey(Math.floor(px[i] / c), Math.floor(py[i] / c), Math.floor(pz[i] / c));
        if (stampOf[h] !== stamp) { stampOf[h] = stamp; head[h] = -1; }
        link[i] = head[h]; head[h] = i;
      }
    }
    const gdx = tx - cx, gdy = ty - cy, gdz = tz - cz, gdd = Math.hypot(gdx, gdy, gdz) || 1;
    for (let q = 0; q < n; q++) {
      const i = M[q]; if (!alive[i]) continue;
      let ax = 0, ay = 0, az = 0;
      if (G.habit === 'school') {
        const ceph = G.ceph, pref = spd * trait[i];
        const k = flock(i, G);
        ax += FL[0]; ay += FL[1]; az += FL[2];
        // the group goal (each member its own weight) and a slow wander
        const wg = spd * (ceph ? 0.25 : 0.6) * trait[i];
        ax += gdx / gdd * wg; az += gdz / gdd * wg;
        const wa = o.t * (0.13 + 0.1 * turn[i]) + phase[i] * 40, wn = spd * (ceph ? 0.25 : 0.35);
        ax += Math.sin(wa) * wn; az += Math.cos(wa * 1.3 + 1.7) * wn; ay += Math.sin(wa * 0.7 + 3.1) * wn * 0.3;
        // the depth preference: the goal height plus this member's offset
        ay += (ty + offY[i] - py[i]) * 0.12;
        // outside the group radius (or alone): back to the centre
        const ox = cx - px[i], oy = cy - py[i], oz = cz - pz[i], od = Math.hypot(ox, oy, oz) || 1;
        const over = od - G.radius * (ceph ? 1.3 : 1);
        if (over > 0 || !k) { const f = spd * Math.min(3, 0.4 + Math.max(0, over) * 0.3); ax += ox / od * f; ay += oy / od * f * 0.5; az += oz / od * f; }
        // the turn limit: no snap, a slow fish turns slowly
        const am = Math.hypot(ax, ay, az), amax = spd * (ceph ? 1.5 : 1.2 + turn[i]);
        if (am > amax) { const s = amax / am; ax *= s; ay *= s; az *= s; }
        const v0 = Math.hypot(vx[i], vy[i], vz[i]) || 1e-6;
        if (!ceph) {
          // the steer turns the fish; its own speed control sets the speed
          const al = (ax * vx[i] + ay * vy[i] + az * vz[i]) / (v0 * v0) * 0.7;
          ax -= vx[i] * al; ay -= vy[i] * al; az -= vz[i] * al;
        }
        if (ceph) {
          // hover with drag, then a short jet in a new direction
          jet[i] -= dt;
          const drag = Math.exp(-dt * 0.9); vx[i] *= drag; vy[i] *= drag; vz[i] *= drag;
          if (jet[i] <= 0) {
            jet[i] = 1.2 + R() * 3.8;
            const a0 = v0 > 0.02 ? Math.atan2(vx[i], vz[i]) : yaw[i], a1 = a0 + (R() - 0.5) * 2.2;
            const p1 = (R() - 0.5) * 0.6, j0 = pref * (0.9 + 0.8 * R());
            vx[i] += Math.sin(a1) * Math.cos(p1) * j0; vz[i] += Math.cos(a1) * Math.cos(p1) * j0; vy[i] += Math.sin(p1) * j0;
          }
        } else {
          // keep the own preferred speed along the own heading
          const f = (pref - v0) * 2 / v0; ax += vx[i] * f; ay += vy[i] * f; az += vz[i] * f;
        }
      } else if (G.habit === 'swim') {
        const gx = tx - px[i], gy = ty - py[i], gz = tz - pz[i], gd = Math.hypot(gx, gy, gz) || 1;
        ax += gx / gd * 0.4; ay += gy / gd * 0.4; az += gz / gd * 0.4;
        ax += (cx - px[i]) * 0.05; az += (cz - pz[i]) * 0.05;
      } else if (G.habit === 'hover') {
        ax += (G.home[0] - px[i]) * 0.02 + (R() - 0.5) * 0.08; ay += (ty - py[i]) * 0.03 + (R() - 0.5) * 0.04; az += (G.home[2] - pz[i]) * 0.02 + (R() - 0.5) * 0.08;
      } else {     // drift
        ax += cur[0] * 0.15 + (G.home[0] - px[i]) * 0.01; az += cur[1] * 0.15 + (G.home[2] - pz[i]) * 0.01;
        ay += Math.sin(o.t * 0.3 + phase[i] * 6.28) * 0.01 + (ty - py[i]) * 0.01;
      }
      if (near) reactRovs(i, G, o.rovs, depth, 1);
      vx[i] += ax * dt; vy[i] += ay * dt; vz[i] += az * dt;
      // speed limits
      const v = Math.hypot(vx[i], vy[i], vz[i]);
      const vmax = spd * (glow[i] > 0.5 ? 2.2 : G.ceph ? 1.9 : 1.3), vmin = G.ceph ? 0 : G.habit === 'school' || G.habit === 'swim' ? spd * 0.35 : 0;
      if (v > vmax) { const k = vmax / v; vx[i] *= k; vy[i] *= k; vz[i] *= k; }
      else if (v < vmin && v > 1e-6) { const k = vmin / v; vx[i] *= k; vy[i] *= k; vz[i] *= k; }
      vy[i] *= 0.98;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      // stay in the depth range and over the floor
      const yTop = SURF - sp.depth[0], yBot = SURF - sp.depth[1];
      if (py[i] > yTop) { py[i] = yTop; vy[i] = -Math.abs(vy[i]) * 0.5; }
      if (py[i] < yBot) { py[i] = yBot; vy[i] = Math.abs(vy[i]) * 0.5; }
      const gfl = groundOf(G, px[i], pz[i]);
      if (gfl > -Infinity && py[i] < gfl + CLEAR) { py[i] = gfl + CLEAR; vy[i] = Math.abs(vy[i]) * 0.5 + 0.02; }
      if ((i + frame) % simEvery === 0) rockCheck(i, G);
      // heading from the velocity (slow turns)
      if (v > (G.ceph ? spd * 0.12 : 0.01)) {
        const want = Math.atan2(vx[i], vz[i]);
        let dy = want - yaw[i]; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
        yaw[i] += dy * Math.min(1, dt * 4);
        pitch[i] += (Math.atan2(-vy[i], Math.hypot(vx[i], vz[i])) * 0.7 - pitch[i]) * Math.min(1, dt * 3);
      }
      glow[i] = Math.max(0, glow[i] - dt * 0.7);
    }
  }

  function step(dt, o = {}) {
    frame++;
    dt = Math.min(dt, 0.1);
    for (const G of groups.values()) { stepGroup(G, dt, o); if (G.habit !== 'crawl') gait(G, dt); }
  }

  return {
    addGroup, removeChunk, step,
    get count() { return count; }, get capacity() { return N; }, get freeSlots() { return free.length; },
    groups, byChunk, species: specList, stats,
    px, py, pz, vx, vy, vz, yaw, pitch, size, phase, glow, spec, grp, alive, cyc,
  };
}
