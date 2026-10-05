// ============================================================================
//  MECH TOUR  ·  camera moves and part close-ups for the mechanism savers
// ────────────────────────────────────────────────────────────────────────────
//  The mechanism pages (differential, planetary-gearbox, stirling-engine,
//  wankel-engine, four-stroke-engine) each have their own kit.js and
//  stage.js, with the same part and camera shape. Their snSaver tours use
//  this module for two things: the camera move of each tour step, and the
//  close-ups of single exploded parts. It needs only what the five kits
//  share:
//    B.parts[id] = { info, holder, root, mats, explode | ex }   one part
//    PARTS[info] = { name, group, role, specs }                 parts.js
//    stage.fly, stage.flyTo({ az, el, r, target, t }), stage.camera,
//    stage.controls, stage.orbit
//    cards.C.hover                                   the glow, by info id
//
//  CAMERA MOVES. A step starts from a base pose (az, el, r, target): the
//  page's view preset, read from stage.fly after the page's setView, or the
//  frame of one part (az within 30 degrees of the last view's base az; a
//  flat part is seen 15-35 degrees off the normal of its broad face).
//  begin() picks a move that is not the last move and
//  turns the base by a seeded offset (az +-20, el +-8 degrees). The camera
//  flies to the move's first pose in FLY s, then the move runs over the
//  rest of the hold. Moves stay within about 35 degrees of the base az, so
//  a hold never turns a unit round to its back. The stage auto-orbit is off
//  while the director runs. Each run seeds its own move weights and a lens
//  (fov 24-38 degrees, r scaled so the framing holds).
//      orbit ... an arc of 30-60 degrees (a part: 60-140, a circle round it)
//      push .... the radius closes from 1.3 to 0.8
//      pull .... the radius opens from 0.75 to 1.25, a reveal
//      crane ... the elevation rises or falls by 28 degrees
//      truck ... the target slides along the explode axis
//      graze ... a low pass at 5-8 degrees elevation
//      top ..... a view from 72-80 degrees elevation that turns 30 degrees
//      rack .... a cut to a wide view, then a fast push to the detail
//
//  EXPLODED INSPECTION. Each unit gets a seeded spread (0.8-1.5 times the
//  explode offsets) and one of three modes: 'flyby' (parts in order along
//  the explode axis, each with a truck move), 'circle' (an orbit round each
//  part), or 'mixed' (any move). stackStep() is a pull-back on the whole
//  exploded stack.
//
//  A part's top node is holder (holder > root) or root (four-stroke: root >
//  holder). A part can ride inside another part, so own() walks the top
//  node and stops at the top node of any other part.
//
//  EXPORTS  (grep the name to find it)
//      createTour(o) ..... one saver run:
//        begin(base, o) .. start a step from a base pose; o.kind 'view' |
//                          'part' | 'stack', o.move forces a move,
//                          o.exploded scales r by the unit's spread
//        fromFly(o) ...... begin() from the fly the page's setView started
//        tick(dt) ........ run the move (call each frame)
//        unit() .......... new unit: seeded spread and inspection mode
//        pick(n) ......... n part info ids, prefer ids first, seeded
//        show(info) ...... frame one instance, glow it, ghost the rest
//        clear() ......... undo the glow and the ghost (call before a swap)
//        plate(info, sub)  plate fields: part name, group, role, specs
//        log ............. [{ move, az, el, r }] per step, for the checks
// ============================================================================
const GHOST = 0.12, D = Math.PI / 180;
const MOVES = ['orbit', 'push', 'pull', 'crane', 'truck', 'graze', 'top', 'rack'];
const sm = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

export function createTour({ THREE, stage, cards, cur, rnd, prefer = [], skip = [], fill = 0.45, fly = 1.2, hold = 5000 }) {
  const top = q => (q.holder && q.holder.parent === q.root ? q.root : q.holder || q.root);
  const parts = () => Object.values(cur().B.parts);
  const own = q => {
    const tops = new Set(parts().map(top)), out = [];
    const walk = ob => { for (const c of ob.children) { if (tops.has(c)) continue; if (c.isMesh) out.push(c); walk(c); } };
    walk(top(q));
    return out;
  };
  // One instance: the first part with this info id that has meshes. Two
  // spiders or two side gears far apart would make a wide, empty frame.
  const inst = info => parts().find(q => q.info === info && own(q).length);
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const exOf = q => q.explode ? new THREE.Vector3(...q.explode) : q.ex ? q.ex.clone() : new THREE.Vector3();
  const FB = new THREE.Box3(), FS = new THREE.Vector3(), FC = new THREE.Vector3();
  let ghosted = false;

  // ── the run's camera language ─────────────────────────────────────────────
  const W = Object.fromEntries(MOVES.map(m => [m, 0.25 + rnd()]));
  const fovC = 24 + 14 * rnd();
  let last = null, mv = null, mode = 'mixed', spreadK = 1, front = null;
  const log = [];
  const choose = (kind, force) => {
    if (force && force !== last) return force;
    const pool = MOVES.filter(m => m !== last && !(kind === 'part' && m === 'top') && !(kind === 'stack' && (m === 'push' || m === 'rack')));
    let s = 0; for (const m of pool) s += W[m];
    let x = rnd() * s; for (const m of pool) { x -= W[m]; if (x <= 0) return m; }
    return pool[pool.length - 1];
  };
  const axis = () => {
    let best = new THREE.Vector3(1, 0, 0), bl = 0;
    for (const q of parts()) { const v = exOf(q), l = v.length(); if (l > bl) { bl = l; best = v.normalize(); } }
    return best;
  };
  const pose = (m, u) => {
    const b = m.b, P = { az: b.az, el: b.el, r: b.r, t: b.t.clone() }, s = sm(u);
    switch (m.move) {
      case 'orbit': P.az = b.az + m.dir * m.range * (u - 0.5); break;
      case 'push': P.r = b.r * (1.3 - 0.5 * s); break;
      case 'pull': P.r = b.r * (0.75 + 0.5 * s); break;
      case 'crane': P.el = b.el + m.dir * (28 * s - 14); P.az = b.az + 8 * m.dir * (u - 0.5); break;
      case 'truck': P.t.addScaledVector(m.ax, m.len * (2 * u - 1)); P.az = b.az + 6 * m.dir * (u - 0.5); break;
      case 'graze': P.el = 5 + 3 * u; P.az = b.az + m.dir * 24 * (u - 0.5); P.r = b.r * 0.9; break;
      case 'top': P.el = 72 + 8 * u; P.az = b.az + m.dir * 30 * u; break;
      case 'rack': P.r = b.r * (1.8 - 1.05 * sm(u / 0.45)); break;
    }
    P.el = Math.max(2, Math.min(82, P.el));
    return P;
  };
  const apply = P => {
    const c = stage.controls, cam = stage.camera;
    c.target.copy(P.t);
    cam.position.setFromSpherical(new THREE.Spherical(P.r, (90 - P.el) * D, P.az * D)).add(P.t);
  };
  const lens = () => {
    const cam = stage.camera, f = fovC + 4 * (rnd() - 0.5);
    cam.fov = f; cam.updateProjectionMatrix();
    return Math.tan(15 * D) / Math.tan(f / 2 * D);   // r factor: framing of the 30 degree preset
  };

  const T = {
    own, log,
    get mode() { return mode; },
    begin(base, o = {}) {
      stage.orbit = false;
      const kind = o.kind || 'view', move = choose(kind, o.move);
      last = move;
      if (kind !== 'part') front = base.az;
      const k = lens();
      const b = { az: base.az + (kind === 'part' ? 0 : 40 * (rnd() - 0.5)), el: Math.max(3, Math.min(75, base.el + 16 * (rnd() - 0.5))), r: base.r * k * (o.exploded || kind === 'stack' ? spreadK : 1), t: base.target.clone() };
      mv = { move, b, dir: rnd() < 0.5 ? -1 : 1, t: 0, range: kind === 'part' ? 60 + 80 * rnd() : 30 + 30 * rnd(),
        ax: o.axis || axis(), len: 0.3 * base.r * Math.tan(15 * D) };
      const P = pose(mv, 0);
      log.push({ move, az: Math.round(P.az), el: Math.round(P.el), r: Math.round(P.r) });
      if (move === 'rack') { stage.fly = null; apply(P); mv.flyT = 0; }
      else { stage.flyTo({ az: P.az, el: P.el, r: P.r, target: P.t, t: fly }); mv.flyT = fly; }
    },
    fromFly(o = {}) {
      const f = stage.fly;
      if (!f) return;
      T.begin({ az: f.s1.theta / D, el: 90 - f.s1.phi / D, r: f.s1.radius, target: f.t1.clone() }, o);
    },
    tick(dt) {
      if (!mv) return;
      mv.t += dt;
      if (stage.fly) return;
      const span = Math.max(0.5, hold / 1000 - mv.flyT);
      apply(pose(mv, Math.min(1, (mv.t - mv.flyT) / span)));
    },
    unit() {
      mode = ['flyby', 'circle', 'mixed'][Math.floor(rnd() * 3)];
      spreadK = 0.8 + 0.7 * rnd();
      for (const q of parts()) {
        if (q.explode) { q._ex0 = q._ex0 || q.explode.slice(); q.explode = q._ex0.map(v => v * spreadK); }
        else if (q.ex) { q._ex0 = q._ex0 || q.ex.clone(); q.ex.copy(q._ex0).multiplyScalar(spreadK); }
      }
      return { mode, spread: spreadK };
    },
    pick(n) {
      const P = cur().PARTS, seen = new Set();
      const have = parts().map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k) && !skip.some(s => s instanceof RegExp ? s.test(k) : s === k) && inst(k));
      const isPref = k => prefer.some(s => s instanceof RegExp ? s.test(k) : s === k);
      const pref = shuf(have.filter(isPref)), rest = shuf(have.filter(k => !isPref(k)));
      const nPref = Math.min(pref.length, Math.max(n - 2, Math.ceil(n * 0.6)));
      let out = [...pref.slice(0, nPref), ...rest, ...pref.slice(nPref)].slice(0, n);
      // a fly-by visits the parts in order along the explode axis
      if (mode === 'flyby') {
        const ax = axis(), at = k => { FB.makeEmpty(); for (const m of own(inst(k))) FB.expandByObject(m); return FB.isEmpty() ? 0 : FB.getCenter(FC).dot(ax); };
        const d = out.map(k => [k, at(k)]).sort((a, b) => a[1] - b[1]);
        out = (rnd() < 0.5 ? d : d.reverse()).map(x => x[0]);
      }
      return out;
    },
    show(info) {
      const q = inst(info);
      if (!q) return;
      if (cards) cards.C.hover = info;
      ghost(q);
      FB.makeEmpty(); for (const m of own(q)) FB.expandByObject(m);
      if (FB.isEmpty()) return;
      const cam = stage.camera, R = Math.max(8, FB.getSize(FS).length() / 2);
      const h = Math.tan(15 * D) * Math.min(1, cam.aspect);
      // near the front of the last view, not where the last close-up ended
      const s0 = new THREE.Spherical().setFromVector3(cam.position.clone().sub(stage.controls.target));
      const az0 = front != null ? front : s0.theta / D;
      let az = az0 + 60 * (rnd() - 0.5), el = 14 + 24 * rnd();
      // A flat part (a gear, a disc, a plate): look at its broad face, from
      // the side of the face nearer the front, 15-35 degrees off its normal.
      const sz = FS.toArray(), lo = sz.indexOf(Math.min(...sz)), off = 15 + 20 * rnd();
      if (sz[lo] < 0.55 * Math.max(...sz)) {
        const near = (a, b) => Math.abs(Math.atan2(Math.sin((a - b) * D), Math.cos((a - b) * D)));
        const toward = (n, f) => { const d = Math.atan2(Math.sin((f - n) * D), Math.cos((f - n) * D)); return n + Math.sign(d || 1) * off; };
        if (lo === 0) { const n = near(90, az0) < near(-90, az0) ? 90 : -90; az = toward(n, az0); }
        else if (lo === 2) { const n = near(0, az0) < near(180, az0) ? 0 : 180; az = toward(n, az0); }
        else el = 50 + 22 * rnd();
      }
      const force = mode === 'flyby' ? 'truck' : mode === 'circle' ? 'orbit' : null;
      T.begin({ az, el, r: R / (fill * h), target: FB.getCenter(FC).clone() },
        { kind: 'part', move: force === last ? null : force });
    },
    clear() {
      if (cards) cards.C.hover = null;
      if (ghosted) ghost(null);
    },
    plate(info, sub) {
      const P = cur().PARTS[info] || { name: info, group: '', role: '', specs: [] }, q = inst(info);
      const lines = (String(P.role || '').match(/[^.!?]+[.!?]+/g) || [P.role || '']).slice(0, 2).map(s => s.trim()).filter(Boolean);
      return { title: P.name, sub: [P.group, sub].filter(Boolean).join(' · '), lines,
        params: (P.specs || []).slice(0, 4).map(([k, v]) => ({ name: k, value: String(v) })),
        meshes: q ? own(q) : [] };
    },
  };
  function ghost(keep) {
    for (const q of parts()) for (const k in q.mats) {
      const m = q.mats[k], g = keep && q !== keep;
      const b = m.userData.ghost0 || (m.userData.ghost0 = { t: m.transparent, o: m.opacity, d: m.depthWrite });
      const t = g || b.t;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
      m.opacity = g ? GHOST * b.o : b.o;
      m.depthWrite = g ? false : b.d;
    }
    ghosted = !!keep;
  }
  return T;
}
