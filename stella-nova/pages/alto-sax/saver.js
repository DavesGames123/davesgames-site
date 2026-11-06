// ============================================================================
//  ALTO SAX MECHANISM  ·  saver.js — the screensaver hook and its director
// ----------------------------------------------------------------------------
//  This module sets window.snSaver = { enter, exit, debug, cut } (the
//  protocol is in lib/screensaver.js). index.html loads it before main.js.
//
//  enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }
//      Waits for window.altoSax (main.js), hides the page GUI (html.as-saver)
//      and starts the director. The canvas is the page's own WebGL canvas.
//  exit()      stops the director, releases every key, shows the GUI again.
//  debug()     the director state (shot, step, camera, plan head).
//  cut(key)    cuts now. key (optional) forces the next shot: 'run',
//              'group', 'press', a group id (for example 'oct') or a touch
//              id (for example 't_lbb').
//
//  SHOTS (seeded, a new plan each run, 6 to 12 s each)
//    run ..... a scale, an arpeggio, octaves or a chromatic run through the
//              chart; the whole instrument in a slow orbit
//    group ... one mechanism isolated and exploded; its touch pieces press
//              one at a time; the camera stays on the group
//    press ... one touch piece and its linkage path, close up
//  The plan never shows one group twice in a row, and never three shots of
//  one kind in a row. plateBand(h) from lib/saver-clear.js gives the clear
//  band of the label plate. bandFrame() moves the camera back and shifts
//  the view, so the subject sits in that band.
//
//  The plan and the director have no DOM: tests.mjs runs them in node.
//
//  GREP MAP
//    export function makePlan ..... the seeded shot list
//    export function runNotes ..... the note list of a run shot
//    export function bandFrame .... distance factor and view shift for the band
//    export function startSaver ... the director: tick, cut, plate
//    function plate ............... the label text for the shell plate
//    window.snSaver ............... the browser hook
// ============================================================================
import * as M from './model.js';

const hasDOM = typeof document !== 'undefined';
export const DUR = [6, 12];
export const KINDS = ['run', 'group', 'press'];
export const SAVER_GROUPS = ['oct', 'lh', 'palm', 'table', 'side', 'rh', 'rp', 'neck'];
// the camera azimuth (degrees, 0 = front) that faces each group
export const GROUP_AZ = { oct: 160, lh: -20, palm: -75, table: 65, side: 80, rh: -15, rp: -40, neck: -45 };

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickOf = (r, a) => a[Math.floor(r() * a.length) % a.length];

// The notes of a run shot. Every note is in the chart (Bb3 to F#6).
export const PATTERNS = {
  major: [0, 2, 4, 5, 7, 9, 11, 12],
  minor: [0, 2, 3, 5, 7, 8, 10, 12],
  arpeggio: [0, 4, 7, 12, 16, 19, 24],
  octaves: [0, 12, 0, 12, 0, 12],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  break: [-2, -1, 0, 1, 2, 3, 4],   // across the octave break at C#5 / D5
};
export function runNotes(pattern, start) {
  const p = PATTERNS[pattern] || PATTERNS.major;
  return p.map(d => start + d).filter(n => n >= M.LOW && n <= M.HIGH);
}
function runStart(r, pattern) {
  const p = PATTERNS[pattern], span = Math.max(...p), lo = Math.min(...p, 0);
  if (pattern === 'break') return 73;
  return M.LOW - lo + Math.floor(r() * Math.max(1, M.HIGH - M.LOW - span + 1));
}

export function makePlan(seed, n = 120, { phone = false } = {}) {
  const r = rng(seed), out = [];
  const touches = M.TOUCHES.map(t => t.id);
  let lastGroup = null;
  while (out.length < n) {
    let kind = pickOf(r, KINDS);
    const k1 = out.length > 1 && out[out.length - 1].kind === out[out.length - 2].kind ? out[out.length - 1].kind : null;
    if (kind === k1) kind = KINDS[(KINDS.indexOf(kind) + 1 + Math.floor(r() * 2)) % KINDS.length];
    const dur = +(DUR[0] + r() * (DUR[1] - DUR[0])).toFixed(2);
    const shot = { kind, dur, dir: r() < 0.5 ? -1 : 1, el: +(6 + r() * 16).toFixed(1), zoom: +(0.95 + r() * 0.3).toFixed(3), seed: 1 + Math.floor(r() * 999998) };
    if (kind === 'run') {
      const pattern = pickOf(r, Object.keys(PATTERNS));
      const notes = runNotes(pattern, runStart(r, pattern));
      shot.pattern = pattern; shot.notes = notes; shot.step = +(Math.max(0.55, Math.min(1.2, shot.dur / (notes.length + 1)))).toFixed(2);
      shot.az0 = Math.round(-35 + r() * 80); shot.group = null;
    } else if (kind === 'group') {
      let g = pickOf(r, SAVER_GROUPS);
      if (g === lastGroup) g = SAVER_GROUPS[(SAVER_GROUPS.indexOf(g) + 1 + Math.floor(r() * 3)) % SAVER_GROUPS.length];
      shot.group = g; shot.explode = +(phone ? 0.35 + r() * 0.3 : 0.4 + r() * 0.5).toFixed(2);
      shot.step = +(1.3 + r() * 0.9).toFixed(2);
      shot.az0 = Math.round(GROUP_AZ[g] - 25 + r() * 50);
    } else {
      let t = pickOf(r, touches);
      if (M.TOUCH[t].group === lastGroup) t = touches[(touches.indexOf(t) + 3 + Math.floor(r() * 5)) % touches.length];
      shot.touch = t; shot.group = M.TOUCH[t].group;
      shot.az0 = Math.round(GROUP_AZ[shot.group] - 20 + r() * 40);
    }
    lastGroup = shot.group;
    out.push(shot);
  }
  return out;
}

// h: canvas CSS height; band: plateBand(h) or null
export function bandFrame(h, band) {
  if (!band || !(h > 0)) return { k: 1, dy: 0 };
  const clear = Math.max(h * 0.3, h - band.t - band.b);
  return { k: Math.min(2.2, Math.max(1, h / clear)), dy: (band.b - band.t) / 2 };
}

// env = { setTouches(ids, o), setIsolate(g, amount), sphere(g) -> { c, r },
//         lookAt({ c, az, el, dist, dy }), fov (degrees), height() }
export function startSaver(env, o = {}) {
  const calm = Math.max(0, Math.min(1, o.calm ?? 0.6)), label = typeof o.label === 'function' ? o.label : () => {};
  const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
  const plan = makePlan(seed, 160, { phone: !!o.phone });
  let n = 0, shot = null, t = 0, stepI = -1, alive = true, band = o.band || null, bandT = 0, bandFn = o.band ? () => o.band : null, forced = null;
  const cam = { az: 0, el: 12, dist: 1000, c: { x: 0, y: 0, z: 0 } };
  if (!bandFn && hasDOM) import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
  let sp = null;

  function forcedShot(key) {
    const r = rng(seed + n * 7919), base = { dur: +(DUR[0] + r() * 4).toFixed(2), dir: 1, el: 12, zoom: 1.05, seed: 1 };
    if (key === 'run') return { ...base, kind: 'run', pattern: 'major', notes: runNotes('major', 60), step: 0.8, az0: 20, group: null };
    if (key === 'group' || M.GROUP[key]) { const g = M.GROUP[key] ? key : 'oct'; return { ...base, kind: 'group', group: g, explode: 0.6, step: 1.6, az0: GROUP_AZ[g] }; }
    if (key === 'press' || M.TOUCH[key]) { const tt = M.TOUCH[key] ? key : 't_lbb'; return { ...base, kind: 'press', touch: tt, group: M.TOUCH[tt].group, az0: GROUP_AZ[M.TOUCH[tt].group] }; }
    return null;
  }
  function cut(key) {
    if (!alive) return;
    const f = key ? forcedShot(key) : null;
    shot = f || plan[n % plan.length]; n++; t = 0; stepI = -1; forced = f ? key : null;
    if (shot.kind === 'run') { env.setIsolate(null, 0); sp = env.sphere(null); }
    else if (shot.kind === 'group') { env.setIsolate(shot.group, shot.explode); sp = env.sphere(shot.group); }
    else { env.setIsolate(null, 0); env.setTouches([shot.touch], { last: shot.touch }); sp = pressSphere(shot.touch); }
    cam.az = shot.az0; cam.el = shot.el;
    step(0, true);
    label(plate());
  }
  function pressSphere(tid) {
    // the touch and the keys it moves
    const mv = M.movedBy(tid, []), g = env.sphere(M.TOUCH[tid].group);
    const r = Math.max(60, Math.min(g.r, 70 + 28 * mv.keys.length));
    const p = env.touchPoint ? env.touchPoint(tid) : null;
    return { c: p ? { x: (p.x + g.c.x) / 2, y: (p.y + g.c.y) / 2, z: (p.z + g.c.z) / 2 } : g.c, r };
  }
  function step(dt, first = false) {
    if (shot.kind === 'run') {
      const i = Math.min(shot.notes.length - 1, Math.floor(t / shot.step));
      if (i !== stepI) {
        stepI = i;
        const f = M.MAIN_FINGERINGS.find(x => x.note === shot.notes[i]);
        if (f) env.setTouches(f.touches, {});
        if (!first) label(plate());
      }
    } else if (shot.kind === 'group') {
      const ts = M.TOUCHES.filter(x => x.group === shot.group);
      if (!ts.length) return;
      const i = Math.floor(t / shot.step), within = t - i * shot.step;
      const idx = i % ts.length, down = within < shot.step * 0.72;
      const key = idx * 2 + (down ? 0 : 1);
      if (key !== stepI) { stepI = key; env.setTouches(down ? [ts[idx].id] : [], { last: down ? ts[idx].id : null }); if (!first) label(plate()); }
    }
  }
  function tick(dt) {
    if (!alive || !shot) return;
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { band = bandFn(env.height ? env.height() : 0); } catch (e) { band = null; } }
    t += dt;
    step(dt);
    const rate = (shot.kind === 'run' ? 6 : 9) * (1 - 0.5 * calm);
    const s = Math.min(1, t / shot.dur), e = s * s * (3 - 2 * s);
    const fov = (env.fov || 32) * Math.PI / 180, bf = bandFrame(env.height ? env.height() : 0, band);
    const base = sp.r / Math.sin(fov / 2);
    cam.az = shot.az0 + shot.dir * rate * t;
    cam.el = shot.el + (shot.kind === 'press' ? 6 : 0) * (e - 0.5);
    cam.dist = base * shot.zoom * bf.k * (1.08 - 0.1 * e);
    cam.c = sp.c;
    env.lookAt({ c: sp.c, az: cam.az, el: cam.el, dist: cam.dist, dy: bf.dy });
    if (t >= shot.dur) cut();
  }
  function plate() {
    const s = shot;
    if (s.kind === 'run') {
      const cur = s.notes[Math.max(0, stepI)], nm = M.PRETTY(M.noteName(cur)), r = M.solve((M.MAIN_FINGERINGS.find(x => x.note === cur) || { touches: [] }).touches);
      const title = { major: 'Major scale', minor: 'Minor scale', arpeggio: 'Arpeggio', octaves: 'Octaves', chromatic: 'Chromatic run', break: 'Across the break' }[s.pattern] || 'Fingering run';
      return { title, sub: `from written ${M.PRETTY(M.noteName(s.notes[0]))} · alto saxophone in E♭`,
        lines: [`${nm}: first open hole ${r.vent ? M.HOLE[r.vent].name.replace(/\s*\(.*\)$/, '') : 'the bell end'}`, r.octave ? `octave key: ${r.octave} pip open` : 'octave key up'],
        eq: ['f ≈ c / 2L', 'sounds 9 semitones below written'] };
    }
    if (s.kind === 'group') {
      const g = M.GROUP[s.group], ts = M.TOUCHES.filter(x => x.group === s.group);
      const tt = stepI >= 0 && ts.length && stepI % 2 === 0 ? ts[(stepI / 2) % ts.length] : null;
      const lines = [];
      if (tt) { const mv = M.movedBy(tt.id, []); lines.push(`${tt.name.replace(/\s*\(.*\)$/, '')} moves ${mv.keys.map(k => M.KEY[k].name).join(' → ')}`); }
      else lines.push(M.KEYS.filter(k => k.group === s.group).map(k => k.name).slice(0, 5).join(' · '));
      return { title: g.name, sub: 'mechanism isolated and exploded', lines, eq: [GROUP_EQ[s.group] || ''] };
    }
    const mv = M.movedBy(s.touch, []);
    return { title: M.TOUCH[s.touch].name.replace(/\s*\(.*\)$/, ''), sub: `${M.GROUP[s.group].name} · moves ${mv.keys.length} part${mv.keys.length > 1 ? 's' : ''}`,
      lines: [mv.keys.map(k => M.KEY[k].name).join(' → ')], eq: [GROUP_EQ[s.group] || ''] };
  }
  function dispose() { alive = false; try { env.setTouches([], {}); env.setIsolate(null, 0); } catch (e) { /* page gone */ } }
  cut();
  return {
    tick, dispose, cut, plate: () => (shot ? plate() : null),
    debug: () => ({ seed, n, t: +t.toFixed(2), kind: shot && shot.kind, group: shot && shot.group, touch: shot && shot.touch, pattern: shot && shot.pattern, step: stepI, forced, band, cam: { ...cam }, plan: plan.slice(0, 10).map(x => x.kind + ':' + (x.group || x.pattern || '')) }),
    get shot() { return shot; },
  };
}
const GROUP_EQ = {
  oct: 'G open → neck pip (A5 up) · G closed → body pip (D5–G♯5)',
  lh: 'B, A, G close the C♯ pad · A closes the bis cup',
  palm: 'palm D, E♭, F + octave → D6, E♭6, F6',
  table: 'low C♯, B, B♭ hold the G♯ cup shut',
  side: 'B + side C = C · B + side B♭ = B♭',
  rh: 'F, E, D close the F♯ cup · F♯ cup closes B♭',
  rp: 'low C sprung open · low E♭ sprung closed',
  neck: 'reed + mouthpiece = pressure valve',
};

// ---- the browser hook ------------------------------------------------------------------
if (hasDOM && typeof window !== 'undefined') {
  let run = null, app = null;
  const waitApp = async () => {
    const t0 = performance.now();
    while (!(window.altoSax && window.altoSax.renderer) && performance.now() - t0 < 12000) await new Promise(r => setTimeout(r, 100));
    return window.altoSax && window.altoSax.renderer ? window.altoSax : null;
  };
  window.snSaver = {
    async enter(o = {}) {
      if (run) window.snSaver.exit();
      app = await waitApp();
      if (!app) throw new Error('alto-sax: the 3D view did not start');
      window.snSaverActive = true;
      try { window.dispatchEvent(new CustomEvent('sn-saver-enter')); } catch (e) { /* old browser */ }
      app.saver(true);
      const phone = typeof matchMedia === 'function' && matchMedia('(max-width:768px), (pointer:coarse)').matches;
      const env = {
        setTouches: app.setTouches, setIsolate: app.setIsolate, sphere: app.sphere, lookAt: app.lookAt,
        touchPoint: id => app.S.touchPoint(id), fov: app.camera.fov, height: () => app.renderer.domElement.clientHeight,
      };
      run = startSaver(env, { ...o, phone });
      app.onFrame = dt => run && run.tick(dt);
      return { canvas: app.renderer.domElement, warmupMs: 1200 };
    },
    exit() {
      if (!run) return;
      const r = run; run = null; r.dispose();
      if (app) app.saver(false);
      window.snSaverActive = false;
      try { window.dispatchEvent(new CustomEvent('sn-saver-exit')); } catch (e) { /* old browser */ }
    },
    debug: () => (run ? run.debug() : null),
    cut: key => { if (run) run.cut(key); },
  };
}
