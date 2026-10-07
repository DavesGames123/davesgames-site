// ============================================================================
//  DICE LAB  ·  saver.js — the screensaver director (window.snSaver)
// ----------------------------------------------------------------------------
//  enter(opts) { calm, seconds, caption, seed, label, labels } hides the
//  page GUI and runs a shot list. It returns { canvas, warmupMs } with the
//  page canvas (#view, in the document).
//
//  SHOTS. A seeded shuffle of six shots, shuffled again when the list runs
//  out (no shot twice in a row). The seed comes from the shell, so each run
//  differs; the counters start at zero on each load. Every throw in a shot
//  is real physics: the director steps it to rest first (presim), so it
//  knows the length, then plays the record at a slow speed.
//    mixed      a handful of mixed dice in slow motion; the camera tracks
//               the centre of the dice and frames their spread
//    graze      one d20 seen from 1.4 cm over the felt as it tumbles to rest
//    macro      settled dice with their labels; a push-in on one top face
//    pour       48 d6 poured from above; a histogram of 4d6 totals from the
//               physics batch worker fills toward the exact distribution
//    glass      glass dice under a low spot, with the caustic-like spots
//    turntable  one die in each finish turning on the felt, a slow push-in
//  Calm (0..1) slows the motion (speed x (1 - 0.4 calm)) and lengthens the
//  holds. Each shot lasts 5 to 12 s.
//
//  FRAMING. The plate band (lib/saver-clear.js plateBand, read twice a
//  second) goes into main.js occlusion(), so the view offset centres the
//  subject between the plate's top and bottom text. frameD() sizes the
//  camera distance from the subject radius and the band height.
//
//  PLATE. Title, the notation and the result, P(total) and P(>= total) from
//  the exact distribution, and a short real extract of the source (the face
//  reader or the convolution), read from dice.js and prob.js at enter.
//
//  GREP MAP
//    const SHOTS ......... the shot list
//    function frameD ..... camera distance for a subject radius
//    function shot_* ..... one setup per shot
//    function advance .... fade, set up, fade in
//    snSaver.debug ....... the probe for CDP checks
// ============================================================================
import { buildDie, orientFor, Q, mulberry32 } from './dice.js';
import { MATERIALS } from './facetex.js';

export function installSaver(A) {
  const { THREE, sc, $, saverState: SS } = A;
  const camera = sc.camera;
  const SHOTS = ['mixed', 'graze', 'macro', 'pour', 'glass', 'turntable'];
  let rnd = Math.random, calm = 0.7, label = () => {}, showLabels = true;
  let shot = null, shotT = 0, shotAt = 0, dur = 8000, count = 0, queue = [], busy = false, cutAt = 0, cuts = [];
  let camFn = null, info = null, code = {}, bandFn = null, bandT = 0, hud = null, pourStats = null;
  const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), snap: true };
  const lightKeep = { key: sc.key.intensity, spot: sc.spot.intensity, hemi: sc.hemi.intensity };

  // ── helpers ───────────────────────────────────────────────────────────────
  const pick = a => a[Math.floor(rnd() * a.length)];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const P = (sym, name, value, cls) => ({ sym, name, value, cls });
  const pct = p => p >= 0.995 ? '>99%' : (p * 100).toFixed(p < 0.01 ? 2 : 1) + '%';
  // the distance at which a sphere of radius r fills the clear band (and the
  // width), for the current fov and aspect
  function frameD(r, fill = 0.82) {
    const h = $('view').clientHeight || 1, w = $('view').clientWidth || 1, B = SS.band;
    const bandH = B ? Math.max(0.3 * h, h - B.t - B.b) : h;
    const tv = Math.tan(camera.fov * Math.PI / 360) * (bandH / h) * fill, th = Math.tan(camera.fov * Math.PI / 360) * (w / h) * fill;
    return r / Math.sin(Math.atan(Math.min(tv, th)));
  }
  function aim(pos, tgt, k) {
    if (cam.snap) { cam.pos.copy(pos); cam.tgt.copy(tgt); cam.snap = false; }
    else { cam.pos.lerp(pos, k); cam.tgt.lerp(tgt, k); }
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
  }
  const dice = () => sc.diceGroup.children.filter(m => m.visible);
  // the rail is WALL_H high at the tray edge. A camera outside the tray
  // sees a die over the rail only from above atan(h / e), with e the
  // distance from the die to the edge behind the camera. So each shot
  // looks from the tray centre side (azC) and lifts el to clear the rail.
  const WALL_H = 5.6;
  const azC = (x, z, jitter = 0) => (Math.hypot(x, z) < 2 ? rnd() * Math.PI * 2 : Math.atan2(-x, -z)) + jitter;
  function edgeDist(x, z, az) {
    const [w, d] = sc.dims, dx = Math.sin(az), dz = Math.cos(az);
    const tx = dx > 1e-6 ? (w / 2 - x) / dx : dx < -1e-6 ? (-w / 2 - x) / dx : 1e9;
    const tz = dz > 1e-6 ? (d / 2 - z) / dz : dz < -1e-6 ? (-d / 2 - z) / dz : 1e9;
    return Math.max(0.5, Math.min(tx, tz));
  }
  // camera position for subject c, radius r, azimuth az, elevation el
  function orbitPos(c, r, az, el, fill) {
    const D = frameD(r, fill), e = edgeDist(c.x, c.z, az);
    if (D * Math.cos(el) > e) el = Math.max(el, Math.atan2(WALL_H - c.y, e) + 0.06);
    return new THREE.Vector3(c.x + Math.sin(az) * Math.cos(el) * D, c.y + Math.sin(el) * D, c.z + Math.cos(az) * Math.cos(el) * D);
  }
  const lastCentre = T => { const p = T.rec[T.rec.length - 1].p, n = p.length / 7; let x = 0, z = 0; for (let i = 0; i < n; i++) { x += p[i * 7]; z += p[i * 7 + 2]; } return [x / n, z / n]; };
  function spread(c) { let r = 0; for (const m of dice()) r = Math.max(r, m.position.distanceTo(c) + buildDie(m.userData.type).R); return r; }
  function centre(out) { out.set(0, 0, 0); const D = dice(); for (const m of D) out.add(m.position); return D.length ? out.multiplyScalar(1 / D.length) : out; }
  const speedK = () => 1 - 0.4 * calm;
  function plateFor(title, sub, extra = {}) {
    info = { title, sub, ...extra };
    label(info);
  }
  function resultParams(spec, res) {
    const pmf = A.specPmf(spec), m = A.moments(pmf);
    return [P('S', 'total', String(res.total), 'm5'), P('P(S)', 'exactly', pct(A.prob(pmf, res.total)), 'm1'), P('P(\\ge S)', 'or more', pct(A.atLeast(pmf, res.total)), 'm3'), P('\\mu', 'expected', m.mean.toFixed(2), 'm6')];
  }

  // code extracts from the real source
  async function grabCode() {
    const get = async (file, name, lines = 16) => {
      try {
        const t = await (await fetch(new URL(file, import.meta.url))).text();
        const i = t.indexOf(`export function ${name}(`); if (i < 0) return null;
        const rest = t.slice(i).split('\n'); const out = [];
        for (const ln of rest) { out.push(ln); if (ln === '}') break; }
        return { lang: 'js', name: `${file} · ${name}`, text: out.slice(0, lines).join('\n') };
      } catch (e) { return null; }
    };
    code.reader = await get('dice.js', 'readDie', 18);
    code.convolve = await get('prob.js', 'convolve', 6);
    code.keep = await get('prob.js', 'keepPmf', 18);
    code.orient = await get('dice.js', 'orientFor', 6);
  }

  // ── shots ─────────────────────────────────────────────────────────────────
  // a throw, stepped to rest, then played at a speed that fits the shot
  function throwShot(text, o) {
    const spec = A.parse(text), plan = A.planDice(spec);
    const T = A.startThrow(spec, plan, { seed: (rnd() * 2 ** 32) >>> 0, presim: true, ...o });
    return { spec, T };
  }
  function fitSpeed(T, holdS, lo, hi) {
    const simT = T.simT;
    let sp = Math.min(hi, Math.max(lo, simT / Math.max(1, 8.5 - holdS))) * speedK();
    let d = (simT / sp + holdS) * 1000;
    if (d > 12000) { sp = simT / (12 - holdS); d = 12000; }
    return { speed: sp, dur: Math.max(5000, d) };
  }

  function shot_mixed() {
    const text = pick(['1d4 + 1d6 + 1d8 + 1d10 + 1d12 + 1d20', '2d6 + 1d20 + 1d8', '1d% + 1d20', '3d6 + 1d12 + 1d4', '2d20kh1 + 1d8 + 1d6', '4dF + 2d6']);
    const fin = pick([['resin'], ['marble'], ['resin', 'marble', 'bone'], ['wood', 'bone'], ['metal', 'resin']]);
    const ang = rnd() * Math.PI * 2;
    const { spec, T } = throwShot(text, { finish: fin, tray: 'medium', strength: 0.5 + rnd() * 0.35, dir: [Math.cos(ang), Math.sin(ang) * 0.6] });
    const hold = 2.4 + 2.2 * calm, f = fitSpeed(T, hold, 0.2, 0.42);
    SS.speed = f.speed; dur = f.dur;
    const c = new THREE.Vector3(), [ex, ez] = lastCentre(T), az0 = azC(ex, ez, (rnd() - 0.5) * 1.2), el = (34 + rnd() * 14) * Math.PI / 180;
    let rS = 6;
    camFn = (t, dt) => {
      // the band is narrow under the plate: frame the core of the throw
      // (at most 7 cm), not every straggler
      centre(c); rS += (Math.min(5, Math.max(3.2, spread(c) * 0.7)) - rS) * Math.min(1, dt * 2);
      aim(orbitPos(c, rS, az0 + t * 0.3, el), c, Math.min(1, dt * 2.5));
    };
    plateFor('A mixed throw', spec.text, { params: [P('n', 'dice', String(T.plan.length), 'm6'), P('t', 'slow motion', `${(1 / f.speed).toFixed(1)}× slower`, 'm1')], lines: ['Rigid bodies on felt · each die read from its rest orientation'], code: code.reader });
    T.onSettle = res => plateFor('A mixed throw', `${spec.text} = ${res.total}`, { params: resultParams(spec, res), lines: [res.cocked ? `${res.cocked} cocked die: it would be thrown again` : 'The face nearest to up is the reading'], code: spec.terms.some(t => t.keep) ? code.keep : code.reader });
  }

  function shot_graze() {
    const fin = pick(['glass', 'metal', 'resin', 'marble']);
    const ang = rnd() * Math.PI * 2;
    const { spec, T } = throwShot('1d20', { finish: fin, tray: 'medium', strength: 0.35 + rnd() * 0.25, dir: [Math.cos(ang), Math.sin(ang)] });
    const hold = 2 + 2 * calm, f = fitSpeed(T, hold, 0.16, 0.3);
    SS.speed = f.speed; dur = f.dur;
    const last = T.rec[T.rec.length - 1].p, end = new THREE.Vector3(last[0], last[1], last[2]);
    // the camera sits to the side of the path, 1.4 cm over the felt, inside
    // the tray: the side with more room
    let perp = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
    const room = v => edgeDist(end.x, end.z, Math.atan2(v.x, v.z));
    if (room(perp.clone().negate()) > room(perp)) perp.negate();
    const Dmax = Math.max(5, Math.min(13, room(perp) - 1.2));
    const along = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const m = sc.diceGroup.children[0], p = new THREE.Vector3(), [w, d] = sc.dims;
    camFn = (t, dt) => {
      p.copy(m.position);
      const D = Dmax * (0.75 + 0.25 * (1 - t));
      const base = end.clone().addScaledVector(perp, D).addScaledVector(along, -2 + 3 * t);
      base.x = Math.max(-w / 2 + 0.8, Math.min(w / 2 - 0.8, base.x)); base.z = Math.max(-d / 2 + 0.8, Math.min(d / 2 - 0.8, base.z));
      base.y = 1.4;
      aim(base, new THREE.Vector3(p.x, Math.max(0.9, p.y * 0.7), p.z), Math.min(1, dt * 3));
    };
    plateFor('A d20 comes to rest', `${MATERIALS[fin].name} d20 · seen from 1.4 cm over the felt`, { params: [P('g', 'gravity', '981 cm/s²', 'm1'), P('e', 'restitution', '0.36', 'm2'), P('\\mu', 'friction', '0.43', 'm3')], lines: ['A convex hull collider; mass and inertia from the hull'], code: code.reader });
    T.onSettle = res => {
      const r = T.reads[0];
      plateFor('A d20 comes to rest', `It reads ${r.label}`, { params: [P('v', 'face', r.label, 'm5'), P('\\theta', 'tilt', `${r.tilt.toFixed(1)}°`, 'm1'), P('P', 'any face', '1/20 = 5%', 'm3')], lines: [r.cocked ? 'Cocked: more than 10° from flat' : 'Up in the body frame: conj(q) · ŷ, then the nearest face normal'], code: code.reader });
    };
  }

  function shot_macro() {
    const text = pick(['3d6', '1d20 + 1d12 + 1d8', '2d10 + 1d4', '4d6 drop lowest', '1d% + 1d6']);
    const fin = pick(['resin', 'marble', 'bone', 'wood']);
    const { spec, T } = throwShot(text, { finish: fin, tray: 'medium', strength: 0.45 + rnd() * 0.3, dir: [1, (rnd() - 0.5) * 0.6] });
    T.playT = T.simT;                    // settled at once: the labels show
    SS.speed = 1; dur = (7 + 3 * calm) * 1000;
    const D = dice(), m = D[Math.floor(rnd() * D.length)];
    const c = new THREE.Vector3(), az = azC(m.position.x, m.position.z, (rnd() - 0.5) * 1.0), el = (50 + rnd() * 16) * Math.PI / 180;
    let first = true;
    camFn = (t, dt) => {
      centre(c);
      const u = Math.min(1, t * 1.5), e = u * u * (3 - 2 * u);
      const tg = c.clone().lerp(m.position, e);
      const r = THREE.MathUtils.lerp(Math.min(6, Math.max(3.5, spread(c) * 0.7)), buildDie(m.userData.type).R * 1.7, e);
      aim(orbitPos(tg, r, az + t * 0.25, el), tg, first ? 1 : Math.min(1, dt * 4));
      first = false;
    };
    plateFor('Reading the faces', spec.text, { params: [], code: code.reader });
    T.onSettle = res => plateFor('Reading the faces', `${spec.text} = ${res.total}`, { params: resultParams(spec, res), lines: ['A label over each die: the face whose normal is nearest to up'], code: code.reader });
  }

  function shot_pour() {
    const n = 48;
    const spec = A.parse(`${n}d6`), plan = A.planDice(spec);
    const T = A.startThrow(spec, plan, { seed: (rnd() * 2 ** 32) >>> 0, presim: true, finish: pick([['resin', 'marble'], ['bone', 'wood'], ['resin']]), tray: 'large', strength: 0.05, from: [(rnd() - 0.5) * 6, (rnd() - 0.5) * 4], dir: [1, 0.2], spin: 0.6 });
    const hold = 2.5 + 2 * calm, f = fitSpeed(T, hold, 0.3, 0.55);
    SS.speed = f.speed; dur = Math.max(9000, f.dur);
    const c = new THREE.Vector3(), az = (rnd() - 0.5) * 0.8, el = 50 * Math.PI / 180;
    camFn = (t, dt) => {
      c.set(0, 0, 0);
      const Dd = frameD(17 - 3 * t, 0.9) * (PHONE() ? 1.2 : 1);
      // aim a little right of centre on a wide frame, so the histogram
      // sits at the right and the tray at the left
      const off = wide() ? 13 : 0;
      aim(new THREE.Vector3(off + Math.sin(az) * Math.cos(el) * Dd, Math.sin(el) * Dd, Math.cos(az) * Math.cos(el) * Dd), new THREE.Vector3(off, 0, wide() ? 0 : 6), Math.min(1, dt * 2));
    };
    // the histogram: 4d6 totals from the physics batch worker
    const hs = A.parse('4d6'), pmf = A.specPmf(hs);
    pourStats = pourStats || { hist: {}, n: 0 };
    hud.show(true);
    const draw = () => hud.draw(pourStats, pmf);
    draw();
    A.runBatchRaw(4000, hs, { progress: m => { pourStats.run = m.totals; pourStats.runN = m.done; draw(); }, done: () => { for (const k in pourStats.run || {}) pourStats.hist[k] = (pourStats.hist[k] || 0) + pourStats.run[k]; pourStats.n += pourStats.runN || 0; pourStats.run = null; pourStats.runN = 0; } });
    plateFor('A pour of 48 dice', 'Sums of 4d6 from the physics batch fill toward the exact distribution', { params: [P('n', 'd6 in the pour', '48', 'm6'), P('\\mu', '4d6 mean', '14', 'm5'), P('\\sigma', '4d6 sd', moments4d6(pmf), 'm1')], lines: ['Gold: the exact convolution · bars: physics throws in a worker'], code: code.convolve });
  }
  const moments4d6 = pmf => A.moments(pmf).sd.toFixed(3);
  const wide = () => { const v = $('view'); return v.clientWidth > v.clientHeight * 1.2; };
  const PHONE = () => $('view').clientWidth < 520;

  function shot_glass() {
    const text = pick(['1d20 + 1d12 + 1d8 + 1d6', '1d20 + 1d10 + 1d4', '2d20 + 1d12']);
    const ang = rnd() * Math.PI * 2;
    const { spec, T } = throwShot(text, { finish: 'glass', tray: 'medium', strength: 0.4 + rnd() * 0.3, dir: [Math.cos(ang), Math.sin(ang) * 0.5] });
    const hold = 2.5 + 2 * calm, f = fitSpeed(T, hold, 0.2, 0.36);
    SS.speed = f.speed; dur = f.dur;
    const c = new THREE.Vector3(), [ex, ez] = lastCentre(T), az0 = azC(ex, ez, (rnd() - 0.5) * 0.9), el = (30 + rnd() * 10) * Math.PI / 180;
    // the spot shines from behind the dice, low, toward the camera side,
    // so the glass glows and throws its spots toward the lens
    sc.key.intensity = 0.7; sc.hemi.intensity = 0.15;
    sc.spot.position.set(ex - Math.sin(az0) * 18, 14, ez - Math.cos(az0) * 18);
    sc.spot.intensity = 2600; sc.spot.target.position.set(ex, 0, ez);
    SS.causticBoost = 1.6;
    let rS = 5;
    camFn = (t, dt) => {
      centre(c); rS += (Math.min(4.5, Math.max(3, spread(c) * 0.7)) - rS) * Math.min(1, dt * 2);
      sc.spot.target.position.copy(c);
      aim(orbitPos(c, rS, az0 + t * 0.35, el), c, Math.min(1, dt * 2.5));
    };
    plateFor('Glass dice', spec.text, { params: [P('n', 'index', '1.52', 'm1'), P('d', 'thickness', '1.4 cm', 'm2')], lines: ['Transmission with opaque ink · light spots thrown on the felt'], code: code.reader });
    T.onSettle = res => plateFor('Glass dice', `${spec.text} = ${res.total}`, { params: resultParams(spec, res), lines: ['Caustic-like spots: an additive disc away from the light'], code: code.reader });
  }

  function shot_turntable() {
    A.clearThrow();
    const set = [['d20', 'resin'], ['d12', 'marble'], ['d10', 'metal'], ['d8', 'glass'], ['d6', 'wood'], ['d4', 'bone']];
    shuffle(set);
    const ring = [], R = 3.6, spin0 = rnd() * Math.PI * 2;
    set.forEach(([type, fin], i) => {
      const die = buildDie(type), m = sc.addDie(type, fin, 'numbers');
      const faces = type === 'd4' ? die.faces.map((f, k) => k) : die.faces.map((f, k) => k).filter(k => die.faces[k].valued);
      const q = orientFor(die, pick(faces), rnd() * Math.PI * 2);
      let ymin = 0; for (let k = 0; k < die.hull.length; k += 3) { const pr = Q.rot(q, [die.hull[k], die.hull[k + 1], die.hull[k + 2]]); ymin = Math.min(ymin, pr[1]); }
      m.quaternion.set(q[0], q[1], q[2], q[3]); m.position.y = -ymin;
      const s = showLabels ? sc.label(MATERIALS[fin].name) : null;
      if (s) { s.userData.die = m; s.userData.R = die.R; }
      ring.push({ m, a: spin0 + i * Math.PI * 2 / set.length, q0: m.quaternion.clone() });
    });
    const spinQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    SS.speed = 1; dur = (7.5 + 3 * calm) * 1000;
    const el = (34 + rnd() * 12) * Math.PI / 180, az = rnd() * Math.PI * 2, mid = new THREE.Vector3(0, 0.7, 0);
    camFn = (t, dt) => {
      const a = t * (0.9 - 0.4 * calm);
      for (const r of ring) {
        r.m.position.x = Math.cos(r.a + a) * R; r.m.position.z = Math.sin(r.a + a) * R;
        spinQ.setFromAxisAngle(up, -a); r.m.quaternion.copy(spinQ).multiply(r.q0);
      }
      aim(orbitPos(mid, THREE.MathUtils.lerp(R + 1.6, R * 0.55, t * t * (3 - 2 * t)), az + t * 0.15, el), mid, Math.min(1, dt * 3));
    };
    plateFor('Six finishes', set.map(([t, f]) => MATERIALS[f].name.toLowerCase()).join(' · '), { params: [P('\\rho', 'resin', '1.2 g/cm³', 'm1'), P('n', 'glass index', '1.52', 'm2'), P('m', 'metal', 'metalness 1', 'm3')], lines: ['The numbers are in the face texture: no decal, no z-fighting'], code: code.orient || code.reader });
  }

  const SETUP = { mixed: shot_mixed, graze: shot_graze, macro: shot_macro, pour: shot_pour, glass: shot_glass, turntable: shot_turntable };
  function resetLook() {
    sc.key.intensity = lightKeep.key; sc.hemi.intensity = lightKeep.hemi; sc.spot.intensity = 0;
    SS.causticBoost = 1; SS.speed = 1;
    if (hud) hud.show(false);
  }
  async function advance() {
    if (busy) return; busy = true;
    try {
      const v = $('view');
      if (shot) { v.style.opacity = '0'; await new Promise(r => setTimeout(r, 480)); }
      if (!queue.length) { queue = shuffle(SHOTS.slice()); if (queue[0] === shot) queue.push(queue.shift()); }
      const k = queue.shift();
      resetLook(); cam.snap = true;
      shot = k; shotT = 0; shotAt = performance.now(); count++;
      SETUP[k]();
      sc.labelGroup.visible = showLabels;
      dur = Math.max(5000, Math.min(12000, dur));
      const now = performance.now(); if (cutAt) cuts.push(Math.round(now - cutAt)); cutAt = now;
      if (cuts.length > 40) cuts.shift();
      camFn(0, 0.016);
      requestAnimationFrame(() => { v.style.opacity = '1'; });
    } finally { busy = false; }
  }

  // the histogram HUD: an orthographic overlay drawn after the scene, so a
  // recording of the canvas keeps it
  function makeHud() {
    const scene = new THREE.Scene(), cv = document.createElement('canvas'); cv.width = 720; cv.height = 420;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
    scene.add(mesh);
    const ocam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    let on = false;
    return {
      show(v) { on = v; },
      draw(st, pmf) {
        const g = cv.getContext('2d'), W = cv.width, H = cv.height;
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(8,8,10,0.62)'; g.beginPath(); g.roundRect(0, 0, W, H, 22); g.fill();
        const hist = { ...st.hist }; let n = st.n;
        if (st.run) { for (const k in st.run) hist[k] = (hist[k] || 0) + st.run[k]; n += st.runN || 0; }
        const L = 46, R = 22, T2 = 64, B = 50, pw = W - L - R, ph = H - T2 - B, lo = pmf.lo, k = pmf.p.length, bw = pw / k;
        let top = Math.max(...pmf.p); for (const x in hist) top = Math.max(top, hist[x] / Math.max(1, n)); top *= 1.12;
        g.fillStyle = '#f1ead9'; g.font = '600 26px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.fillText('4d6 totals', L, 40);
        g.fillStyle = '#a49c8c'; g.font = '400 19px Inter, system-ui, sans-serif'; g.textAlign = 'right';
        g.fillText(`n = ${n.toLocaleString()} physics throws`, W - R, 40);
        for (let i = 0; i < k; i++) {
          const x = lo + i, v = n ? (hist[x] || 0) / n : 0, X = L + i * bw;
          g.fillStyle = 'rgba(122,186,160,0.9)';
          g.fillRect(X + bw * 0.14, T2 + ph - v / top * ph, bw * 0.72, v / top * ph);
        }
        g.strokeStyle = '#ffd27a'; g.lineWidth = 3; g.beginPath();
        for (let i = 0; i < k; i++) { const X = L + (i + 0.5) * bw, Y = T2 + ph - pmf.p[i] / top * ph; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
        g.stroke();
        g.fillStyle = '#d9d2c6'; g.font = '400 17px Inter, system-ui, sans-serif'; g.textAlign = 'center';
        for (let i = 0; i < k; i += 3) g.fillText(String(lo + i), L + (i + 0.5) * bw, H - 18);
        tex.needsUpdate = true;
      },
      render() {
        if (!on) return;
        const v = $('view'), w = v.clientWidth, h = v.clientHeight, B = SS.band || { t: 0, b: 0 };
        const bandT = B.t, bandB = h - B.b, bh = bandB - bandT;
        let ww, hh, cx, cy;
        if (w > h * 1.2) { ww = Math.min(w * 0.3, bh * 0.9 * 720 / 420); hh = ww * 420 / 720; cx = w - ww / 2 - w * 0.05; cy = h - (bandT + bh / 2); }
        else { ww = Math.min(w * 0.86, bh * 0.4 * 720 / 420); hh = ww * 420 / 720; cx = w / 2; cy = h - (bandB - hh / 2 - 8); }
        ocam.left = 0; ocam.right = w; ocam.top = h; ocam.bottom = 0; ocam.updateProjectionMatrix();
        mesh.position.set(cx, cy, 0); mesh.scale.set(ww, hh, 1);
        const r = sc.renderer, ac = r.autoClear;
        r.autoClear = false; r.clearDepth(); r.render(scene, ocam); r.autoClear = ac;
      },
    };
  }

  window.snSaver = {
    async enter(o = {}) {
      SS.on = true;
      calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      rnd = mulberry32((o.seed >>> 0) || 1);
      label = typeof o.label === 'function' ? o.label : () => {};
      showLabels = o.labels !== false;
      document.documentElement.classList.add('dice-saver');
      const st = document.createElement('style');
      st.id = 'dice-saver-style';
      st.textContent = '#stage{top:0!important}#view{cursor:none;transition:opacity 0.45s ease}';
      document.head.appendChild(st);
      A.setOpen(false); A.setAna(false);
      A.setCamMode('orbit');
      sc.controls.enabled = false;
      count = 0; cuts = []; cutAt = 0; queue = []; shot = null; pourStats = null;
      hud = hud || makeHud();
      try { bandFn = (await import('../../lib/saver-clear.js')).plateBand; } catch (e) { bandFn = null; }
      await Promise.race([grabCode(), new Promise(r => setTimeout(r, 1500))]);
      SS.cam = dt => { if (camFn && shot) camFn(Math.min(1, shotT / dur), dt); };
      SS.afterRender = () => hud && hud.render();
      SS.tick = dt => {
        if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { SS.band = bandFn($('view').clientHeight); } catch (e) { SS.band = null; } }
        if (!shot || busy) return;
        // wall clock: a slow first frame (shader compile) does not stretch
        // the shot
        shotT = performance.now() - shotAt;
        if (shotT >= dur) advance();
      };
      // wait for the physics engine, then the first shot
      const t0 = performance.now();
      while (!A.ready() && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100));
      await advance();
      return { canvas: $('view'), warmupMs: 2500 };
    },
    exit() {
      SS.on = false; SS.tick = null; SS.cam = null; SS.afterRender = null; SS.band = null;
      resetLook(); shot = null;
      document.documentElement.classList.remove('dice-saver');
      const st = document.getElementById('dice-saver-style'); if (st) st.remove();
      $('view').style.opacity = '1';
      sc.controls.enabled = true; sc.labelGroup.visible = true;
      A.fitTray(true);
    },
    debug() {
      const T = A.getT(), v = $('view');
      // the subject: the camera target (what the shot frames)
      const p = cam.tgt.clone().project(camera);
      return {
        seed: null, shot, count, shotT: Math.round(shotT), dur: Math.round(dur), cuts: cuts.slice(-12), speed: SS.speed,
        simT: T ? +T.simT.toFixed(2) : null, playT: T ? +T.playT.toFixed(2) : null, settled: T ? T.done : null, dice: dice().length,
        total: T && T.result ? T.result.total : null, title: info && info.title, sub: info && info.sub,
        pos: camera.position.toArray().map(x => +x.toFixed(2)), target: cam.tgt.toArray().map(x => +x.toFixed(2)),
        subj: { x: Math.round((p.x + 1) / 2 * v.clientWidth), y: Math.round((1 - p.y) / 2 * v.clientHeight) }, band: SS.band, w: v.clientWidth, h: v.clientHeight,
        firstPose: T && T.meshes[0] ? T.meshes[0].position.toArray().map(x => +x.toFixed(2)) : null,
      };
    },
  };
}
