// ============================================================================
//  SUBMISSIONS  ·  preset submission code for the playground (ES module, data)
// ----------------------------------------------------------------------------
//  Three presets for each reference scene. Each preset is the source text
//  of a submission, as an agent could write it after it watches the video.
//  The presets copy the motion strategies that the paper reports agents use
//  (Sec. 4.4: analytic motion 67 %, custom simulation 19 %, Blender physics
//  10 %, keyframing 3 %). Blender physics cannot run in a browser, so no
//  preset uses it. A "static" preset gets the first frame and no motion.
//
//  Rules for the preset code:
//    - It sees only the api of sandbox-worker.js. It does not import
//      scenes.js. Layout values (sizes, places, colours) are numbers that
//      an agent reads from the first frame; the page gives the submission
//      the reference camera and units.
//    - It is short enough to edit in a textarea, with comments.
//    - It uses no backticks, so it can sit in a template string here.
//
//  SUBMISSIONS = { [sceneId]: [ { id, label, strategy, note, code } ] }
//    strategy: 'analytic' | 'custom' | 'keyframe' | 'static'
//    note:     one sentence that tells what the preset gets wrong
//
//  EXPORTS   (grep -n "<anchor>" submissions.js)
//    preset table ..... "export const SUBMISSIONS"
//    strategy names ... "export const STRATEGY_LABEL"
//  PRESETS   (grep -n "id: '" submissions.js)
//    rigid-analytic, rigid-custom, rigid-keyframe,
//    deformable-analytic, deformable-custom, deformable-keyframe,
//    codim-analytic, codim-custom, codim-static,
//    flowing-analytic, flowing-custom, flowing-static
// ============================================================================

export const STRATEGY_LABEL = {
  analytic: 'Analytic motion',
  custom: 'Custom simulation',
  keyframe: 'Keyframing',
  static: 'Static',
};

// ------------------------------------------------------------------ rigid ---

const RIGID_ANALYTIC = String.raw`// Analytic motion: closed-form paths, no contact is solved.
// The ball slides down the ramp (a = g sin(theta)) and keeps its speed on
// the floor until it touches the first domino. Then each domino turns
// flat on a timer, one after the next.
function build(api) {
  const { g, rotY, rotZ, mul, apply, smooth } = api;
  // Layout, read from the first frame (metres).
  const top = [-0.597, 0.152], foot = -0.1, r = 0.07;
  const th = Math.atan2(top[1], foot - top[0]);
  const dir = [Math.cos(th), -Math.sin(th)], nrm = [Math.sin(th), Math.cos(th)];
  const s0 = 0.03, sEnd = (top[1] - r + r * Math.cos(th)) / Math.sin(th);

  // Ramp: a wedge, slope from top down to foot.
  const hz = 0.12;
  const ramp = { verts: new Float32Array([top[0], 0, -hz, top[0], top[1], -hz, foot, 0, -hz,
                                          top[0], 0, hz, top[0], top[1], hz, foot, 0, hz]),
                 faces: new Uint32Array([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]) };

  // Ball: s(t) on the ramp, then constant speed on the floor.
  const a = g * Math.sin(th);
  const tFoot = Math.sqrt(2 * (sEnd - s0) / a), vFoot = a * tFoot;
  const xFoot = top[0] + sEnd * dir[0] + r * nrm[0], xStop = 0.04 - 0.009 - r;
  const tHit = tFoot + (xStop - xFoot) / vFoot;
  const ballPose = (f, t) => {
    if (t < tFoot) {
      const s = s0 + a * t * t / 2;
      return { p: [top[0] + s * dir[0] + r * nrm[0], top[1] + s * dir[1] + r * nrm[1], 0] };
    }
    return { p: [Math.min(xStop, xFoot + vFoot * (t - tFoot)), r, 0] };
  };

  // Dominoes: hinge on the front bottom edge, fall flat 0.07 s apart.
  const hx = 0.009, hy = 0.05, hzD = 0.032, P = [hx, -hy, 0];
  const dominoes = [];
  const colors = [[0.98, 0.8, 0.36], [0.9, 0.85, 0.42], [0.72, 0.86, 0.48], [0.5, 0.85, 0.58],
                  [0.38, 0.8, 0.7], [0.38, 0.72, 0.84], [0.48, 0.62, 0.92]];
  for (let i = 0; i < 7; i++) {
    const u = Math.max(0, i - 2), x = 0.04 + i * 0.066, z = -0.006 * u * u;
    const Y = rotY(Math.atan(0.012 * u / 0.066)), q = apply(Y, P);
    const pivot = [x + q[0], hy + q[1], z + q[2]];
    dominoes.push(api.rigid('domino ' + (i + 1), api.box(hx, hy, hzD), colors[i], (f, t) => {
      const phi = Math.PI / 2 * smooth((t - tHit - 0.07 * i) / 0.2);
      const R = mul(Y, rotZ(-phi)), m = apply(R, P);
      return { p: [pivot[0] - m[0], pivot[1] - m[1], pivot[2] - m[2]], R };
    }));
  }
  return api.world([
    api.solid('ramp', ramp, [0.36, 0.42, 0.55]),
    api.rigid('ball', api.sphere(r, 2), [0.96, 0.47, 0.36], ballPose),
    ...dominoes,
  ]);
}`;

const RIGID_CUSTOM = String.raw`// Custom simulation: a small solver, written for this scene.
// The ball rolls (a = 5/7 g sin(theta)), hits the first domino with an
// impulse and rolls back. Each domino is a hinge on its front edge with a
// gravity torque. A domino that reaches the next one passes its spin on
// and then rests against it.
function build(api) {
  const { g, fps, frames, rotY, rotZ, mul, apply } = api;
  const sub = 20, dt = 1 / (fps * sub);
  const top = [-0.597, 0.152], foot = -0.1, hz = 0.12, r = 0.07, mb = 0.25;
  const th = Math.atan2(top[1], foot - top[0]);
  const dir = [Math.cos(th), -Math.sin(th)], nrm = [Math.sin(th), Math.cos(th)];
  const ramp = { verts: new Float32Array([top[0], 0, -hz, top[0], top[1], -hz, foot, 0, -hz,
                                          top[0], 0, hz, top[0], top[1], hz, foot, 0, hz]),
                 faces: new Uint32Array([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]) };

  // Dominoes: half size, mass, hinge data, and places on a gentle curve.
  const hx = 0.009, hy = 0.05, md = 0.06, N = 7, P = [hx, -hy, 0];
  const ell = Math.hypot(hx, hy), a0 = Math.atan2(hx, hy), I = md * 4 * ell * ell / 3;
  const phiC = Math.asin((0.066 - 2 * hx) / (2 * hy));   // the top touches the next domino
  const dom = [];
  for (let i = 0; i < N; i++) {
    const u = Math.max(0, i - 2);
    dom.push({ x: 0.04 + i * 0.066, z: -0.006 * u * u, Y: rotY(Math.atan(0.012 * u / 0.066)), phi: 0, w: 0, hit: false, poses: [] });
  }

  // Ball state: on the ramp (s along the slope) or on the floor (x).
  let onRamp = true, s = 0.03, sp = 0, x = 0, vx = 0, roll = 0;
  const sEnd = (top[1] - r + r * Math.cos(th)) / Math.sin(th);
  const xFoot = top[0] + sEnd * dir[0] + r * nrm[0];
  const ballPoses = [];
  const ballAt = () => onRamp ? [top[0] + s * dir[0] + r * nrm[0], top[1] + s * dir[1] + r * nrm[1], 0] : [x, r, 0];

  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let k = 0; k < sub; k++) {
      if (onRamp) {
        sp += 5 / 7 * g * Math.sin(th) * dt; s += sp * dt; roll += sp * dt / r;
        if (s >= sEnd) { onRamp = false; x = xFoot; vx = sp * Math.cos(th); }
      } else {
        // Rolling drag; at the ramp foot the slope pushes the ball back out.
        if (x < xFoot) vx += 5 / 7 * g * Math.sin(th) * Math.cos(th) * dt;
        vx *= 1 - 1.2 * dt; x += vx * dt; roll += vx * dt / r;
        const d0 = dom[0];
        if (!d0.hit && vx > 0 && x + r >= d0.x - hx) {
          // Impulse at the ball centre height, restitution 0.35.
          const J = 1.35 * vx / (r * r / I + 1 / mb);
          vx -= J / mb; d0.w = J * r / I; d0.hit = true;
        }
        if (d0.hit && vx > 0 && x >= d0.x) vx = -0.25 * vx;   // the fallen pile stops the ball
      }
      for (let i = 0; i < N; i++) {
        const d = dom[i];
        if (d.phi > 0 || d.w > 0) {
          d.w += 3 * g * Math.sin(d.phi - a0) / (4 * ell) * dt;
          d.phi += d.w * dt;
          if (d.phi < 0) { d.phi = 0; d.w = 0; }
        }
        const nx = dom[i + 1];
        if (nx) {
          if (!nx.hit && d.phi >= phiC) { nx.hit = true; nx.w = Math.max(nx.w, 0.85 * d.w); d.w *= 0.4; }
          const lim = phiC + 0.55 * nx.phi;
          if (nx.hit && d.phi > lim) { d.phi = lim; d.w = Math.min(d.w, 0.55 * nx.w); }
        } else if (d.phi > Math.PI / 2) { d.phi = Math.PI / 2; d.w *= -0.2; }
      }
    }
    ballPoses.push({ p: ballAt(), R: rotZ(-roll) });
    for (const d of dom) {
      const R = mul(d.Y, rotZ(-d.phi)), q = apply(d.Y, P), m = apply(R, P);
      d.poses.push({ p: [d.x + q[0] - m[0], hy + q[1] - m[1], d.z + q[2] - m[2]], R });
    }
  }
  const colors = [[0.98, 0.8, 0.36], [0.9, 0.85, 0.42], [0.72, 0.86, 0.48], [0.5, 0.85, 0.58],
                  [0.38, 0.8, 0.7], [0.38, 0.72, 0.84], [0.48, 0.62, 0.92]];
  return api.world([
    api.solid('ramp', ramp, [0.36, 0.42, 0.55]),
    api.rigid('ball', api.sphere(r, 2), [0.96, 0.47, 0.36], (f) => ballPoses[f]),
    ...dom.map((d, i) => api.rigid('domino ' + (i + 1), api.box(hx, hy, 0.032), colors[i], (f) => d.poses[f])),
  ]);
}`;

const RIGID_KEYFRAME = String.raw`// Keyframing: a few poses by hand, straight lines between them, keyed on
// whole half seconds. The ball goes from the top of the ramp to its end
// place on a straight line (it cuts through the ramp). All dominoes fall
// at the same time, after the ball stops.
function build(api) {
  const { keys, rotY, rotZ, mul, apply } = api;
  const top = [-0.597, 0.152], foot = -0.1, hz = 0.12, r = 0.07;
  const ramp = { verts: new Float32Array([top[0], 0, -hz, top[0], top[1], -hz, foot, 0, -hz,
                                          top[0], 0, hz, top[0], top[1], hz, foot, 0, hz]),
                 faces: new Uint32Array([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]) };

  // Ball keys: [time in s, centre].
  const ballKeys = [[0, [-0.548, 0.212, 0]], [1.5, [-0.05, r, 0]]];

  // Domino keys: [time in s, angle]. All dominoes use the same keys.
  const fallKeys = [[1.5, 0], [2.0, Math.PI / 2]];
  const hx = 0.009, hy = 0.05, P = [hx, -hy, 0];
  const colors = [[0.98, 0.8, 0.36], [0.9, 0.85, 0.42], [0.72, 0.86, 0.48], [0.5, 0.85, 0.58],
                  [0.38, 0.8, 0.7], [0.38, 0.72, 0.84], [0.48, 0.62, 0.92]];
  const dominoes = colors.map((c, i) => {
    const u = Math.max(0, i - 2), x = 0.04 + i * 0.066, z = -0.006 * u * u;
    const Y = rotY(Math.atan(0.012 * u / 0.066)), q = apply(Y, P);
    return api.rigid('domino ' + (i + 1), api.box(hx, hy, 0.032), c, (f, t) => {
      const R = mul(Y, rotZ(-keys(fallKeys, t))), m = apply(R, P);
      return { p: [x + q[0] - m[0], hy + q[1] - m[1], z + q[2] - m[2]], R };
    });
  });
  return api.world([
    api.solid('ramp', ramp, [0.36, 0.42, 0.55]),
    api.rigid('ball', api.sphere(r, 2), [0.96, 0.47, 0.36], (f, t) => ({ p: keys(ballKeys, t) })),
    ...dominoes,
  ]);
}`;

// ------------------------------------------------------------- deformable ---

const DEFORM_ANALYTIC = String.raw`// Analytic motion: a rigid box on a path made of formulas.
// Free fall onto the block edge, a turn about that edge, a short fall to
// the floor and an exponential slide to rest. A damped sine squashes the
// box when it lands. The jelly never bends; it only scales.
function build(api) {
  const { g, rotX, rotZ, mul, smooth } = api;
  const h = 0.12, c0 = [0.02, 0.44, 0], v0 = [0.1, -0.4];
  const edge = [-0.02, 0.14];                        // left top edge of the block
  const end = [-0.34, h, -0.03];                     // rest place, read from the last frame
  // Phase 1: free fall until the lowest corner reaches the block top.
  const drop = c0[1] - h * 1.15 - edge[1];
  const t1 = (v0[1] + Math.sqrt(v0[1] * v0[1] + 2 * g * drop)) / g;
  const p1 = [c0[0] + v0[0] * t1, c0[1] + v0[1] * t1 - g * t1 * t1 / 2];
  // Phase 2: the centre turns on a circle about the edge, to 150 degrees.
  const rr = Math.hypot(p1[0] - edge[0], p1[1] - edge[1]), a1 = Math.atan2(p1[1] - edge[1], p1[0] - edge[0]);
  const a2 = 2.6, t2 = t1 + 0.3;
  const p2 = [edge[0] + rr * Math.cos(a2), edge[1] + rr * Math.sin(a2)];
  // Phase 3: fall to the floor. Phase 4: slide to rest.
  const t3 = t2 + Math.sqrt(2 * Math.max(0, p2[1] - h) / g), x3 = p2[0] - 0.05;
  const pose = (f, t) => {
    let p, ang;
    if (t < t1) {
      p = [c0[0] + v0[0] * t, c0[1] + v0[1] * t - g * t * t / 2, 0];
      ang = 0.18;
    } else if (t < t2) {
      const a = a1 + (a2 - a1) * smooth((t - t1) / (t2 - t1));
      p = [edge[0] + rr * Math.cos(a), edge[1] + rr * Math.sin(a), 0];
      ang = 0.18 + (a - a1);
    } else if (t < t3) {
      const s = (t - t2) / (t3 - t2);
      p = [p2[0] + (x3 - p2[0]) * s, p2[1] + (h - p2[1]) * s * s, 0];
      ang = 0.18 + (a2 - a1) + (Math.PI / 2 - 0.18 - (a2 - a1)) * s;
    } else {
      const s = 1 - Math.exp(-(t - t3) / 0.3);
      p = [x3 + (end[0] - x3) * s, h, end[2] * s];
      ang = Math.PI / 2;
    }
    // Squash after each landing: a damped sine on the y scale.
    const land = t > t3 ? t - t3 : t > t1 ? t - t1 : -1;
    const k = land >= 0 ? 0.12 * Math.exp(-land * 5) * Math.cos(land * 25) : 0;
    const S = [1 + k / 2, 0, 0, 0, 1 - k, 0, 0, 0, 1 + k / 2];
    return { p: [p[0], t > t3 ? h * (1 - k) : p[1], p[2]], R: mul(S, mul(rotZ(ang), rotX(0.12))) };
  };
  const block = api.box(0.17, 0.07, 0.2);
  return api.world([
    api.solid('block', block, [0.34, 0.4, 0.52], [0.15, 0.07, 0]),
    api.rigid('jelly', api.box(h, h, h), [0.93, 0.38, 0.62], pose),
  ]);
}`;

const DEFORM_CUSTOM = String.raw`// Custom simulation: position based dynamics on a 7 x 7 x 7 lattice.
// Every pair of nodes nearer than 1.75 cells is a soft distance
// constraint. The floor and the block push nodes out, with friction.
// Only the six outer sides are drawn.
function build(api) {
  const { fps, frames, g, rotX, rotZ, mul, apply } = api;
  const N = 7, size = 0.24, sp = size / (N - 1), nn = N * N * N;
  const sub = 20, dt = 1 / (fps * sub), stiff = 0.15, mu = 0.2;
  const c0 = [0.02, 0.44, 0], R0 = mul(rotZ(0.18), rotX(0.12));
  const id = (i, j, k) => (k * N + j) * N + i;
  const x = new Float64Array(nn * 3), p = new Float64Array(nn * 3), v = new Float64Array(nn * 3);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const q = apply(R0, [i * sp - size / 2, j * sp - size / 2, k * sp - size / 2]), n = id(i, j, k) * 3;
    x[n] = q[0] + c0[0]; x[n + 1] = q[1] + c0[1]; x[n + 2] = q[2] + c0[2];
    v[n] = 0.1; v[n + 1] = -0.4;
  }
  // Constraints: [a, b, rest length].
  const cons = [];
  for (let a = 0; a < nn; a++) for (let b = a + 1; b < nn; b++) {
    const l = Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1], x[a * 3 + 2] - x[b * 3 + 2]);
    if (l < 1.75 * sp) cons.push([a * 3, b * 3, l]);
  }
  // Floor and block: push a node out on the shortest axis, then friction.
  const blk = { c: [0.15, 0.07, 0], h: [0.17, 0.07, 0.2] };
  const collide = (k) => {
    let n = -1, pen = 0;
    if (x[k + 1] < 0) { pen = -x[k + 1]; n = 1; x[k + 1] = 0; }
    else {
      const d = [0, 1, 2].map((a) => blk.h[a] - Math.abs(x[k + a] - blk.c[a]));
      if (d[0] > 0 && d[1] > 0 && d[2] > 0) {
        n = d[1] <= d[0] && d[1] <= d[2] ? 1 : d[0] <= d[2] ? 0 : 2;
        pen = d[n]; x[k + n] += Math.sign(x[k + n] - blk.c[n]) * pen;
      }
    }
    if (n >= 0) for (let a = 0; a < 3; a++) if (a !== n) x[k + a] -= (x[k + a] - p[k + a]) * mu;
  };
  // Surface faces of the lattice. Inner nodes stay in the mesh, unused.
  const faces = [];
  for (let a = 0; a < 3; a++) for (const s of [0, N - 1]) for (let u = 0; u < N - 1; u++) for (let w = 0; w < N - 1; w++) {
    const at = (uu, ww) => { const c = [0, 0, 0]; c[a] = s; c[(a + 1) % 3] = uu; c[(a + 2) % 3] = ww; return id(c[0], c[1], c[2]); };
    faces.push(at(u, w), at(u + 1, w), at(u + 1, w + 1), at(u, w), at(u + 1, w + 1), at(u, w + 1));
  }
  const jelly = api.mesh('jelly', { verts: new Float32Array(x), faces: new Uint32Array(faces) }, [0.93, 0.38, 0.62]);
  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let st = 0; st < sub; st++) {
      for (let k = 0; k < nn * 3; k++) { p[k] = x[k]; if (k % 3 === 1) v[k] -= g * dt; x[k] += v[k] * dt; }
      for (const [a, b, l0] of cons) {
        const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
        const l = Math.hypot(dx, dy, dz), s = stiff * (l - l0) / (2 * l);
        x[a] -= dx * s; x[a + 1] -= dy * s; x[a + 2] -= dz * s;
        x[b] += dx * s; x[b + 1] += dy * s; x[b + 2] += dz * s;
      }
      for (let k = 0; k < nn * 3; k += 3) collide(k);
      for (let k = 0; k < nn * 3; k++) v[k] = (x[k] - p[k]) / dt * (1 - 1.5 * dt);
    }
    api.at(jelly, f).set(x);
  }
  const block = api.box(0.17, 0.07, 0.2);
  return api.world([api.solid('block', block, [0.34, 0.4, 0.52], [0.15, 0.07, 0]), jelly]);
}`;

const DEFORM_KEYFRAME = String.raw`// Keyframing: three poses at guessed times, straight lines between them.
// The box drops onto the block, waits there, then glides to its last
// pose. It moves through the block corner, and it never squashes.
function build(api) {
  const { keys, rotX, rotZ, mul } = api;
  const h = 0.12;
  const posKeys = [[0, [0.02, 0.44, 0]], [0.5, [0.06, 0.26, 0]], [2.0, [-0.34, h, -0.03]]];
  const angKeys = [[0, 0.18], [0.5, 0.18], [2.0, Math.PI / 2]];
  const block = api.box(0.17, 0.07, 0.2);
  return api.world([
    api.solid('block', block, [0.34, 0.4, 0.52], [0.15, 0.07, 0]),
    api.rigid('jelly', api.box(h, h, h), [0.93, 0.38, 0.62],
      (f, t) => ({ p: keys(posKeys, t), R: mul(rotZ(keys(angKeys, t)), rotX(0.12)) })),
  ]);
}`;

// ------------------------------------------------------------------ codim ---

const CODIM_ANALYTIC = String.raw`// Analytic motion: each cloth vertex falls on a straight line to a
// "draped" place that a formula gives: over the ball top, down its side,
// then out on the floor. There are no folds and no swing; the cloth
// shrinks where real cloth would fold.
function build(api) {
  const { g, rotX, rotY, mul, apply, clamp } = api;
  const n = 33, size = 0.8, R = 0.2, skin = 0.006, Rs = R + skin;
  const R0 = mul(rotY(0.35), rotX(0.12)), c0 = [0.06, 0.52, 0.02];
  const sheet = api.sheet(n, size);
  const start = new Float32Array(n * n * 3), goal = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    const q = apply(R0, [sheet.verts[i * 3], 0, sheet.verts[i * 3 + 2]]);
    const P = [q[0] + c0[0], q[1] + c0[1], q[2] + c0[2]];
    start.set(P, i * 3);
    // Arc length from the ball top = flat distance from the ball axis.
    const s = Math.hypot(P[0], P[2]), ux = P[0] / (s || 1), uz = P[2] / (s || 1);
    let rad, y;
    if (s / Rs <= Math.PI / 2) { rad = Rs * Math.sin(s / Rs); y = R + Rs * Math.cos(s / Rs); }
    else {
      y = R - (s - Rs * Math.PI / 2); rad = Rs;
      if (y < skin) { rad += skin - y; y = skin; }
    }
    goal.set([ux * rad, y, uz * rad], i * 3);
  }
  const cloth = api.mesh('cloth', { verts: start, faces: sheet.faces }, [0.3, 0.78, 0.74]);
  for (let f = 0; f < api.frames; f++) {
    const t = f / api.fps, fall = g * t * t / 2, out = api.at(cloth, f);
    for (let i = 0; i < n * n; i++) {
      const k = i * 3, drop = Math.max(1e-3, start[k + 1] - goal[k + 1]);
      const s = clamp(fall / drop);
      for (let a = 0; a < 3; a++) out[k + a] = start[k + a] + (goal[k + a] - start[k + a]) * s;
    }
  }
  return api.world([
    api.solid('ball', api.sphere(R, 3), [0.95, 0.7, 0.36], [0, R, 0]),
    cloth,
  ]);
}`;

const CODIM_CUSTOM = String.raw`// Custom simulation: position based cloth on a 21 x 21 grid.
// Stretch, shear and bend are distance constraints (bend is soft).
// The ball and the floor push vertices out, with friction. The grid is
// coarser than the real cloth, so the folds are wider.
function build(api) {
  const { fps, frames, g, rotX, rotY, mul, apply } = api;
  const n = 21, size = 0.8, sub = 15, dt = 1 / (fps * sub), R = 0.2, skin = 0.008, mu = 0.6;
  const R0 = mul(rotY(0.35), rotX(0.12)), c0 = [0.06, 0.52, 0.02];
  const sheet = api.sheet(n, size), nn = n * n;
  const x = new Float64Array(nn * 3), p = new Float64Array(nn * 3), v = new Float64Array(nn * 3);
  for (let i = 0; i < nn; i++) {
    const q = apply(R0, [sheet.verts[i * 3], 0, sheet.verts[i * 3 + 2]]);
    x[i * 3] = q[0] + c0[0]; x[i * 3 + 1] = q[1] + c0[1]; x[i * 3 + 2] = q[2] + c0[2];
  }
  // Constraints [a, b, rest, stiffness]: bend first, stretch last.
  const cons = [], at = (i, j) => (j * n + i) * 3;
  const add = (a, b, k) => cons.push([a, b, Math.hypot(x[a] - x[b], x[a + 1] - x[b + 1], x[a + 2] - x[b + 2]), k]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i + 2 < n) add(at(i, j), at(i + 2, j), 0.05);
    if (j + 2 < n) add(at(i, j), at(i, j + 2), 0.05);
    if (i + 1 < n && j + 1 < n) { add(at(i, j), at(i + 1, j + 1), 1); add(at(i + 1, j), at(i, j + 1), 1); }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i + 1 < n) add(at(i, j), at(i + 1, j), 1);
    if (j + 1 < n) add(at(i, j), at(i, j + 1), 1);
  }
  // Contact with the ball (centre [0, R, 0]) and the floor, then friction.
  const rub = (k, nx, ny, nz) => {
    const ex = x[k] - p[k], ey = x[k + 1] - p[k + 1], ez = x[k + 2] - p[k + 2], dn = ex * nx + ey * ny + ez * nz;
    x[k] -= (ex - dn * nx) * mu; x[k + 1] -= (ey - dn * ny) * mu; x[k + 2] -= (ez - dn * nz) * mu;
  };
  const contact = (k) => {
    const dx = x[k], dy = x[k + 1] - R, dz = x[k + 2], d = Math.hypot(dx, dy, dz);
    if (d < R + skin) { const s = (R + skin) / d; x[k] = dx * s; x[k + 1] = R + dy * s; x[k + 2] = dz * s; rub(k, dx / d, dy / d, dz / d); }
    if (x[k + 1] < skin) { x[k + 1] = skin; rub(k, 0, 1, 0); }
  };
  const cloth = api.mesh('cloth', { verts: new Float32Array(x), faces: sheet.faces }, [0.3, 0.78, 0.74]);
  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let st = 0; st < sub; st++) {
      for (let k = 0; k < nn * 3; k++) { p[k] = x[k]; if (k % 3 === 1) v[k] -= g * dt; x[k] += v[k] * dt; }
      for (const [a, b, l0, kk] of cons) {
        const dx = x[a] - x[b], dy = x[a + 1] - x[b + 1], dz = x[a + 2] - x[b + 2];
        const l = Math.hypot(dx, dy, dz) || 1e-9, s = kk * (l - l0) / (2 * l);
        x[a] -= dx * s; x[a + 1] -= dy * s; x[a + 2] -= dz * s;
        x[b] += dx * s; x[b + 1] += dy * s; x[b + 2] += dz * s;
      }
      for (let k = 0; k < nn * 3; k += 3) contact(k);
      for (let k = 0; k < nn * 3; k++) v[k] = (x[k] - p[k]) / dt * (1 - 0.8 * dt);
    }
    api.at(cloth, f).set(x);
  }
  return api.world([api.solid('ball', api.sphere(R, 3), [0.95, 0.7, 0.36], [0, R, 0]), cloth]);
}`;

const CODIM_STATIC = String.raw`// Static: the first frame only. The sheet and the ball are in the right
// places, but the sheet never falls. Many failed runs look like this.
function build(api) {
  const { rotX, rotY, mul, apply } = api;
  const n = 33, R0 = mul(rotY(0.35), rotX(0.12)), c0 = [0.06, 0.52, 0.02];
  const sheet = api.sheet(n, 0.8);
  for (let i = 0; i < n * n; i++) {
    const q = apply(R0, [sheet.verts[i * 3], 0, sheet.verts[i * 3 + 2]]);
    sheet.verts.set([q[0] + c0[0], q[1] + c0[1], q[2] + c0[2]], i * 3);
  }
  return api.world([
    api.solid('ball', api.sphere(0.2, 3), [0.95, 0.7, 0.36], [0, 0.2, 0]),
    api.mesh('cloth', sheet, [0.3, 0.78, 0.74]),
  ]);
}`;

// ---------------------------------------------------------------- flowing ---

// The tank and the water column are the same in all three presets.
const FLOW_TANK = String.raw`
// Tank: back wall, two end walls and a low front lip (thin boxes).
function tank(api) {
  const t = 0.012, H = 0.34, c = [0.4, 0.46, 0.58];
  return [
    api.solid('tank back', api.box(0.464, H / 2, t / 2), c, [0, H / 2, -0.176]),
    api.solid('tank left', api.box(t / 2, H / 2, 0.182), c, [-0.446, H / 2, 0]),
    api.solid('tank right', api.box(t / 2, H / 2, 0.182), c, [0.446, H / 2, 0]),
    api.solid('tank lip', api.box(0.464, 0.02, t / 2), c, [0, 0.02, 0.176]),
  ];
}
// Water column: 11 x 16 x 11 particles, spacing d, at the left end.
const d = 0.026, nx = 11, ny = 16, nz = 11, N = nx * ny * nz;
const X0 = -0.44, X1 = 0.44, Z0 = -0.17, Z1 = 0.17;
function column() {
  const P = new Float64Array(N * 3);
  let q = 0;
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    P[q++] = X0 + d * (i + 0.5); P[q++] = d * (j + 0.5); P[q++] = -nz * d / 2 + d * (k + 0.5);
  }
  return P;
}
`;

const FLOW_ANALYTIC = String.raw`// Analytic motion: the shallow-water dam-break formula (Ritter).
// Depth h(x, t) = (2 c0 - (x - xd) / t)^2 / (9 g), c0 = sqrt(g h0).
// Each particle keeps its share of the water to its left and its height
// fraction. The formula ignores the walls, so there is no wave up the
// far wall and no slosh back, and the thin front never reaches the wall.
function build(api) {` + FLOW_TANK + String.raw`
  const { g, fps, frames } = api;
  const h0 = ny * d, xd = X0 + nx * d, c0 = Math.sqrt(g * h0), M = 96, dx = (X1 - X0) / M;
  const P = column(), water = api.points('water', N, d / 2, [0.32, 0.62, 1.0]);
  const cum = new Float64Array(M + 1);
  for (let f = 0; f < frames; f++) {
    const t = Math.max(f / fps, 1e-4), out = api.at(water, f);
    // Depth on a grid, then the running total of the water (area).
    for (let m = 0; m < M; m++) {
      const xm = X0 + (m + 0.5) * dx, u = (xm - xd) / t;
      const h = u <= -c0 ? h0 : u >= 2 * c0 ? 0 : (2 * c0 - u) ** 2 / (9 * g);
      cum[m + 1] = cum[m] + h * dx;
    }
    const A = cum[M], A0 = h0 * nx * d;
    for (let i = 0; i < N; i++) {
      const k = i * 3, share = (P[k] - X0) / (nx * d) * A;
      let m = 0; while (m < M - 1 && cum[m + 1] < share) m++;
      const s = (share - cum[m]) / ((cum[m + 1] - cum[m]) || 1), x = X0 + (m + s) * dx;
      const h = (cum[m + 1] - cum[m]) / dx * (A0 / A);
      out[k] = Math.min(X1 - d / 2, Math.max(X0 + d / 2, x));
      out[k + 1] = Math.max(d / 2, P[k + 1] / h0 * h);
      out[k + 2] = P[k + 2];
    }
  }
  return api.world([...tank(api), water]);
}`;

const FLOW_CUSTOM = String.raw`// Custom simulation: particles that push apart when they are nearer
// than their spacing d (position based, Gauss-Seidel), with gravity and
// the tank walls. It flows like water, but it has no pressure solve and
// nothing holds the particles together, so the wave up the far wall is
// too tall.
function build(api) {` + FLOW_TANK + String.raw`
  const { g, fps, frames } = api;
  const sub = 4, iters = 2, dt = 1 / (fps * sub), r = d / 2;
  const x = column(), p = new Float64Array(N * 3), v = new Float64Array(N * 3);
  // A perfect stack never falls sideways: move each particle a little.
  const rand = api.rng(7);
  for (let k = 0; k < N * 3; k++) if (k % 3 !== 1) x[k] += (rand() - 0.5) * 0.1 * d;
  const water = api.points('water', N, r, [0.32, 0.62, 1.0]);
  // Grid for neighbours: cell size d, counting sort of particles.
  const gx = Math.ceil((X1 - X0) / d), gy = 40, gz = Math.ceil((Z1 - Z0) / d), G = gx * gy * gz;
  const start = new Int32Array(G + 1), cell = new Int32Array(N), list = new Int32Array(N);
  const cellOf = (k) => {
    const i = Math.min(gx - 1, Math.max(0, Math.floor((x[k] - X0) / d)));
    const j = Math.min(gy - 1, Math.max(0, Math.floor(x[k + 1] / d)));
    const l = Math.min(gz - 1, Math.max(0, Math.floor((x[k + 2] - Z0) / d)));
    return (l * gy + j) * gx + i;
  };
  const walls = (k) => {
    x[k] = Math.min(X1 - r, Math.max(X0 + r, x[k]));
    x[k + 1] = Math.max(r, x[k + 1]);
    x[k + 2] = Math.min(Z1 - r, Math.max(Z0 + r, x[k + 2]));
  };
  for (let f = 0; f < frames; f++) {
    if (f > 0) for (let st = 0; st < sub; st++) {
      for (let k = 0; k < N * 3; k += 3) {
        p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
        v[k + 1] -= g * dt;
        x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt;
        walls(k);
      }
      start.fill(0);
      for (let i = 0; i < N; i++) { cell[i] = cellOf(i * 3); start[cell[i] + 1]++; }
      for (let c = 0; c < G; c++) start[c + 1] += start[c];
      const fill = start.slice(0, G);
      for (let i = 0; i < N; i++) list[fill[cell[i]]++] = i;
      for (let it = 0; it < iters; it++) for (let i = 0; i < N; i++) {
        const k = i * 3, c = cell[i], ci = c % gx, cj = Math.floor(c / gx) % gy, cl = Math.floor(c / (gx * gy));
        for (let a = Math.max(0, cl - 1); a <= Math.min(gz - 1, cl + 1); a++)
          for (let b = Math.max(0, cj - 1); b <= Math.min(gy - 1, cj + 1); b++)
            for (let e = Math.max(0, ci - 1); e <= Math.min(gx - 1, ci + 1); e++) {
              const cc = (a * gy + b) * gx + e;
              for (let s = start[cc]; s < start[cc + 1]; s++) {
                const j = list[s]; if (j <= i) continue;
                const m = j * 3, dx = x[k] - x[m], dy = x[k + 1] - x[m + 1], dz = x[k + 2] - x[m + 2];
                const l2 = dx * dx + dy * dy + dz * dz;
                if (l2 >= d * d || l2 < 1e-14) continue;
                const l = Math.sqrt(l2), s2 = 0.5 * (d - l) / l;
                x[k] += dx * s2; x[k + 1] += dy * s2; x[k + 2] += dz * s2;
                x[m] -= dx * s2; x[m + 1] -= dy * s2; x[m + 2] -= dz * s2;
              }
            }
      }
      for (let k = 0; k < N * 3; k += 3) walls(k);
      for (let k = 0; k < N * 3; k++) v[k] = (x[k] - p[k]) / dt * 0.999;
    }
    api.at(water, f).set(x);
  }
  return api.world([...tank(api), water]);
}`;

const FLOW_STATIC = String.raw`// Static: the water column in its first frame, held still. The layout
// and the particle count are right, but the dam never breaks.
function build(api) {` + FLOW_TANK + String.raw`
  const water = api.points('water', N, d / 2, [0.32, 0.62, 1.0]);
  const P = column();
  for (let f = 0; f < api.frames; f++) api.at(water, f).set(P);
  return api.world([...tank(api), water]);
}`;

// ------------------------------------------------------------------ table ---

export const SUBMISSIONS = {
  rigid: [
    { id: 'rigid-analytic', label: 'Formula paths', strategy: 'analytic', code: RIGID_ANALYTIC,
      note: 'The ball slides instead of rolling, so it arrives early, stops dead and does not spin. The dominoes fall flat on a timer instead of resting on each other.' },
    { id: 'rigid-custom', label: 'Hinge solver', strategy: 'custom', code: RIGID_CUSTOM,
      note: 'Rolling, impulses and hinge torques are close, but the motion stays in one plane: the ball does not drift sideways and the dominoes do not slide.' },
    { id: 'rigid-keyframe', label: 'Two keyframes', strategy: 'keyframe', code: RIGID_KEYFRAME,
      note: 'The ball moves on a straight line through the ramp, too slowly, and all seven dominoes fall at once, half a second late.' },
  ],
  deformable: [
    { id: 'deformable-analytic', label: 'Rigid box on a path', strategy: 'analytic', code: DEFORM_ANALYTIC,
      note: 'The path and the end place are close, but the cube is rigid: a sine wave scales it instead of real squash.' },
    { id: 'deformable-custom', label: 'Lattice solver', strategy: 'custom', code: DEFORM_CUSTOM,
      note: 'The soft lattice falls, squashes and tips off like the jelly, but it has no volume constraint, and the tip-off is so sensitive that it lands a little off.' },
    { id: 'deformable-keyframe', label: 'Two keyframes', strategy: 'keyframe', code: DEFORM_KEYFRAME,
      note: 'The poses are right, but the timing is a guess: it waits on the block, glides through its corner, and never squashes.' },
  ],
  codim: [
    { id: 'codim-analytic', label: 'Drape formula', strategy: 'analytic', code: CODIM_ANALYTIC,
      note: 'The cloth ends near the right shape, but each vertex falls on its own straight line: no folds, no swing, and the cloth shrinks to fit.' },
    { id: 'codim-custom', label: 'Cloth solver', strategy: 'custom', code: CODIM_CUSTOM,
      note: 'A real cloth simulation with the right contacts, but on a coarser grid (21 x 21), so the folds are wider.' },
    { id: 'codim-static', label: 'First frame only', strategy: 'static', code: CODIM_STATIC,
      note: 'The first frame is exact, but the sheet hangs in the air for the whole clip.' },
  ],
  flowing: [
    { id: 'flowing-analytic', label: 'Dam-break formula', strategy: 'analytic', code: FLOW_ANALYTIC,
      note: 'The textbook formula has no walls: nothing washes up the far wall or comes back, and the water only thins out to a flat layer.' },
    { id: 'flowing-custom', label: 'Particle solver', strategy: 'custom', code: FLOW_CUSTOM,
      note: 'The particles only push apart, with no pressure solve, so the splash up the far wall is too tall.' },
    { id: 'flowing-static', label: 'First frame only', strategy: 'static', code: FLOW_STATIC,
      note: 'The column is in the right place with the right particles, but the dam never breaks.' },
  ],
};
