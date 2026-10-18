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
//            glow (startle 0..1), spec (species slot), alive
//
//  BEHAVIOUR (species.js habit)
//    school ... boids: the pull to the centre, the match of the mean speed,
//               the push from the neighbours in the group list, and a goal
//               that wanders round the home of the school
//    swim ..... one goal that wanders far; hover: a slow drift at home;
//    drift .... the current plus a slow bob; crawl: a random walk on the
//               ground (the chunk grid); still: no motion
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
//  "function rockCheck", "function reactRovs"
// ============================================================================
import { CLEAR, rngOf } from './spawn.js';

const SURF = 55;

export function createSim({ sdf = null, sdfScale = 0.4, maxAgents = 1000, simEvery = 3, seed = 1 } = {}) {
  const N = maxAgents;
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
  const sx = new Float64Array(N), sy = new Float64Array(N), sz = new Float64Array(N);     // last safe point
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  const yaw = new Float32Array(N), pitch = new Float32Array(N), size = new Float32Array(N), phase = new Float32Array(N), glow = new Float32Array(N);
  const spec = new Int32Array(N).fill(-1), grp = new Int32Array(N).fill(-1), alive = new Uint8Array(N);
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
      idx.push(i);
    }
    const c = g.centre.slice();
    const G = {
      id, sp, chunk, feature: g.feature, members: Int32Array.from(idx), habit: sp.habit, benthic, onCoral: !!(g.members[0] && g.members[0].onCoral),
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
    if (G.habit === 'crawl') {
      for (let q = 0; q < n; q++) {
        const i = M[q]; if (!alive[i]) continue;
        yaw[i] += (R() - 0.5) * dt * 0.8;
        const hx = G.home[0] - px[i], hz = G.home[2] - pz[i];
        if (hx * hx + hz * hz > 64) yaw[i] = Math.atan2(hx, hz);
        const nx = px[i] + Math.sin(yaw[i]) * spd * dt, nz = pz[i] + Math.cos(yaw[i]) * spd * dt;
        const gr = G.grid, inside = !gr || (nx > gr.x0 + 0.5 && nx < gr.x0 + 31.5 && nz > gr.z0 + 0.5 && nz < gr.z0 + 31.5);
        const gy = inside ? groundOf(G, nx, nz) : -Infinity, gy0 = groundOf(G, px[i], pz[i]);
        if (gy > -Infinity && Math.abs(gy - gy0) < spd * dt * 3 + 0.02 && SURF - gy >= sp.depth[0] && SURF - gy <= sp.depth[1]) { px[i] = nx; pz[i] = nz; py[i] = gy; }
        else yaw[i] += Math.PI * 0.5;
        if (near) reactRovs(i, G, o.rovs, depth, 0.2);
        glow[i] = Math.max(0, glow[i] - dt);
      }
      return;
    }
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
    for (let q = 0; q < n; q++) {
      const i = M[q]; if (!alive[i]) continue;
      let ax = 0, ay = 0, az = 0;
      if (G.habit === 'school') {
        ax += (cx - px[i]) * 0.25 + (mx - vx[i]) * 0.9; ay += (cy - py[i]) * 0.25 + (my - vy[i]) * 0.9; az += (cz - pz[i]) * 0.25 + (mz - vz[i]) * 0.9;
        // separation from two list neighbours and one random member
        for (const j of [M[(q + 1) % n], M[(q + n - 1) % n], M[(q * 7 + frame) % n]]) {
          if (j === i || !alive[j]) continue;
          const dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j], d2 = dx * dx + dy * dy + dz * dz, sep = size[i] * 1.6;
          if (d2 < sep * sep && d2 > 1e-8) { const d = Math.sqrt(d2), f = (sep - d) / sep * 2.5; ax += dx / d * f; ay += dy / d * f; az += dz / d * f; }
        }
        const gx = tx - cx, gy = ty - cy, gz = tz - cz, gd = Math.hypot(gx, gy, gz) || 1;
        ax += gx / gd * 0.35; ay += gy / gd * 0.35; az += gz / gd * 0.35;
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
      const vmax = spd * (glow[i] > 0.5 ? 2.2 : 1.3), vmin = G.habit === 'school' || G.habit === 'swim' ? spd * 0.35 : 0;
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
      if (v > 0.01) {
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
    for (const G of groups.values()) stepGroup(G, dt, o);
  }

  return {
    addGroup, removeChunk, step,
    get count() { return count; }, get capacity() { return N; }, get freeSlots() { return free.length; },
    groups, byChunk, species: specList, stats,
    px, py, pz, vx, vy, vz, yaw, pitch, size, phase, glow, spec, grp, alive,
  };
}
