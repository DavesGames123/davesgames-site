// ============================================================================
//  COLLAPSE CITY  ·  saver.js — the screensaver hook and the shot director
// ----------------------------------------------------------------------------
//  This module sets window.snSaver = { enter(opts), exit(), debug(), cut(key) }
//  (lib/screensaver.js has the protocol). index.html loads it before main.js.
//
//  enter({ calm, seconds, caption, seed, label }) -> { canvas, warmupMs }
//      Hides the page GUI (class wfc-saver on <html>) and gives the page
//      canvas #view, which is in the document. When main.js is ready
//      (window.__wfc.ready), it attaches a director. main.js then takes
//      the camera, the generation focus and the display clock from
//      director.tick(dt) each frame.
//  exit()  detaches the director; the page goes back to Fly-over.
//
//  THE DIRECTOR has no DOM, so tests.mjs runs it in node.
//  makePlan(seed, n, calm) -> [shot]
//      A seeded bag of the five shot keys, shuffled again when empty, never
//      the same key twice in a row. shot = { key, dur (6 to 12 s), turn,
//      sway, phase, jumpA, jumpD, side }.
//  startSaver(env, opts) -> { tick(dt) -> pose, cut(key), debug(), plate() }
//      env = { heightAt(x, z), stats() -> Float32Array, band() -> band|null,
//              aspect() -> w / h }
//      pose = { eye, yaw, pitch, fov, focus, radius, rate, snap, fade, oy,
//               boost, shot }
//        rate   null: the display clock follows the solver; a number: the
//               clock runs at that many slots per second (the watch shot)
//        snap   true for one tick: the clock jumps to the solver count
//        fade   canvas opacity 0..1 (a cut fades out, warms, fades in)
//        oy     NDC shift of the view centre, into the plate band
//        boost  generation budget factor (the warm phase is high)
//
//  SHOTS
//    street   glide at 2.4 m over the lowest path; steers round walls
//    rooftop  walk at eye height on the tallest roof near the cut point
//    flyover  high glide at about 44 m, looking down
//    watch    jump to fresh ground; the camera orbits above while each
//             slot falls in at a slow clock
//    bridge   glide at 11 m or more, between the towers
//
//  GREP MAP
//    export const KEYS ............ the shot keys
//    export function makePlan ..... the seeded bag
//    export function bandShift .... plate band -> oy
//    export function startSaver ... the director
//    function begin ............... the start of a shot after the warm phase
//    function steer ............... wall look-ahead for the low shots
//    window.snSaver ............... the browser hook
// ============================================================================

const hasDOM = typeof document !== 'undefined' && typeof window !== 'undefined';
export const KEYS = ['street', 'rooftop', 'flyover', 'watch', 'bridge'];
export const DUR = [6, 12];
const SUBS = {
  street: 'Street level: the solver builds the block ahead of the camera',
  rooftop: 'On the roofs: every slot is one module that fits all six neighbours',
  flyover: 'From above: the city grows at the edge of the generation radius',
  watch: 'Fresh ground: each slot falls in the order the solver chose it',
  bridge: 'Between the towers: walkways and roofs at mid height',
};
export const TEX = String.raw`H(s) = -\sum_{m \in D(s)} p_m \log p_m`;

// small seeded PRNG (mulberry32)
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makePlan(seed, n = 120, calm = 0.6) {
  const r = rng(seed), out = [];
  let bag = [];
  while (out.length < n) {
    if (!bag.length) {
      bag = KEYS.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      const last = out.length ? out[out.length - 1].key : null;
      if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    const key = bag.pop();
    const base = key === 'watch' ? 9 : 6.5;
    const dur = Math.min(DUR[1], Math.max(DUR[0], base + r() * 4 + calm * 1.5));
    out.push({
      key, dur: +dur.toFixed(2),
      turn: +((r() - 0.5) * 0.12).toFixed(4),
      sway: +(0.03 + r() * 0.05).toFixed(4), phase: +(r() * 6.283).toFixed(3),
      jumpA: +(r() * Math.PI * 2).toFixed(3), jumpD: Math.round(key === 'watch' ? 700 + r() * 500 : 20 + r() * 50),
      side: r() < 0.5 ? -1 : 1,
    });
  }
  return out;
}

// The view centre moves to the middle of the clear band of the plate.
// h: canvas CSS height; band: plateBand(h) or null. Returns an NDC shift.
export function bandShift(h, band) {
  if (!band || !(h > 0)) return 0;
  const k = (band.t + band.b) / (0.7 * h);
  const t = k > 1 ? band.t / k : band.t, b = k > 1 ? band.b / k : band.b;
  return (b - t) / h;
}

const smooth = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export function startSaver(env, o = {}) {
  const calm = Math.max(0, Math.min(1, o.calm ?? 0.6));
  const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
  const plan = makePlan(seed, 160, calm);
  const label = typeof o.label === 'function' ? o.label : () => {};
  const H = env.heightAt || (() => 0);
  const FADE = 0.45, WARM = o.warm ?? 1.1;
  const pos = [0, 30, 0], origin = [0, 0];
  let n = 0, shot = null, t = 0, phase = 'warm', pt = 0, yaw = 0, pitch = -0.3, heading = 0, eyeY = 30;
  let roofY = 0, centre = [0, 0], az = 0, labelT = 0, bandT = 1, band = null, snap = false, fade = 0;

  function next(key) {
    let s = plan[n % plan.length]; n++;
    if (key && KEYS.includes(key) && s.key !== key) s = { ...s, key, dur: key === 'watch' ? 10 : s.dur };
    return s;
  }
  // a cut: fade out, move, warm the generation, then begin()
  function cut(key) {
    const s = next(key);
    shot = s; t = 0; pt = 0; phase = 'out';
    return s.key;
  }
  function jump() {
    const d = shot.jumpD, a = shot.jumpA;
    origin[0] = pos[0] + Math.cos(a) * d; origin[1] = pos[2] + Math.sin(a) * d;
    pos[0] = origin[0]; pos[2] = origin[1];
    if (shot.key === 'watch') { centre = [origin[0], origin[1]]; az = a; }
  }
  // mean height along a heading, over len metres from (x, z)
  function pathCost(x, z, hd, len) {
    let s = 0, m = 0;
    for (let d = 4; d <= len; d += 4) { const h = H(x - Math.sin(hd) * d, z - Math.cos(hd) * d); s += h; m = Math.max(m, h); }
    return s / (len / 4) + m * 0.25;
  }
  function begin() {
    const k = shot.key;
    if (k === 'street' || k === 'bridge') {
      let best = 0, bc = Infinity;
      for (let a = 0; a < 16; a++) {
        const hd = shot.jumpA + a * Math.PI / 8, c = pathCost(pos[0], pos[2], hd, 48);
        if (c < bc) { bc = c; best = hd; }
      }
      heading = best;
      eyeY = Math.max(H(pos[0], pos[2]) + (k === 'street' ? 2.4 : 2.5), k === 'bridge' ? 11 : 0);
      pitch = k === 'street' ? -0.05 : -0.12;
    } else if (k === 'rooftop') {
      let bx = pos[0], bz = pos[2], bh = H(pos[0], pos[2]);
      for (let dz = -24; dz <= 24; dz += 4) for (let dx = -24; dx <= 24; dx += 4) {
        const h = H(pos[0] + dx, pos[2] + dz);
        if (h > bh + 0.01) { bh = h; bx = pos[0] + dx; bz = pos[2] + dz; }
      }
      pos[0] = bx + 1; pos[2] = bz + 1; roofY = bh;
      heading = shot.jumpA; eyeY = bh + 1.7; pitch = -0.1;
    } else if (k === 'flyover') {
      heading = shot.jumpA; eyeY = H(pos[0], pos[2]) + 44; pitch = -0.42;
    } else {
      eyeY = 52; pitch = -0.78;
    }
    yaw = heading;
  }
  // look ahead for walls: turn toward the lower side when the way is blocked
  function steer(dt, clear) {
    const ahead = [6, 10, 14];
    let blocked = false;
    for (const d of ahead) if (H(pos[0] - Math.sin(heading) * d, pos[2] - Math.cos(heading) * d) > eyeY - clear) { blocked = true; break; }
    if (blocked) {
      const l = pathCost(pos[0], pos[2], heading + 0.6, 16), r = pathCost(pos[0], pos[2], heading - 0.6, 16);
      heading += (l < r ? 1 : -1) * 1.3 * dt;
    }
    return blocked;
  }

  function tick(dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    if (!shot) cut();
    if (env.band && (bandT += dt) > 0.5) { bandT = 0; try { band = env.band(); } catch (e) { band = null; } }
    snap = false;
    pt += dt;
    let boost = 1;
    if (phase === 'out') {
      fade = Math.max(0, 1 - pt / FADE);
      if (pt >= FADE) { jump(); phase = 'warm'; pt = 0; }
    } else if (phase === 'warm') {
      fade = 0; boost = 4;
      if (shot.key === 'watch') { begin(); phase = 'in'; pt = 0; snap = true; }
      else if (pt >= WARM) { begin(); phase = 'in'; pt = 0; snap = true; }
    } else if (phase === 'in') {
      fade = Math.min(1, pt / FADE);
      if (pt >= FADE) { phase = 'run'; pt = 0; }
    }
    if (phase === 'in' || phase === 'run') {
      t += dt;
      move(dt);
      if (t >= shot.dur) cut();
    }
    if ((labelT += dt) > 2) { labelT = 0; try { label(plate()); } catch (e) { /* no plate */ } }
    const aspect = env.aspect ? env.aspect() : 16 / 9;
    const k = shot.key;
    return {
      eye: pos.slice(), yaw, pitch, fov: (aspect < 1 ? 72 : 58) * Math.PI / 180,
      focus: k === 'watch' ? [centre[0], 0, centre[1]] : [pos[0] - Math.sin(yaw) * 24, 0, pos[2] - Math.cos(yaw) * 24],
      radius: k === 'watch' ? 17 : (k === 'flyover' ? 44 : 34),
      rate: k === 'watch' && phase !== 'warm' ? (60 - calm * 20) : null,
      snap: snap && k !== 'watch', fade, oy: bandShift(env.height ? env.height() : 0, band), boost, shot: k, phase,
    };
  }

  function move(dt) {
    const k = shot.key, slow = 1 - 0.35 * calm;
    if (k === 'watch') {
      az += 0.07 * slow * dt;
      // a 9:16 frame is narrow: stand back so the 68 m block fits across it
      const portrait = env.aspect && env.aspect() < 1, dist = portrait ? 84 : 62, el = 0.72;
      pos[0] = centre[0] + Math.sin(az) * Math.cos(el) * dist;
      pos[2] = centre[1] + Math.cos(az) * Math.cos(el) * dist;
      pos[1] = Math.sin(el) * dist + 4;
      yaw = az; pitch = -el;
      return;
    }
    heading += shot.turn * dt * (k === 'flyover' ? 1 : 0.4);
    let speed = 0, tgt = eyeY;
    if (k === 'street') { speed = 5.5 * slow; if (steer(dt, 1.2)) speed *= 0.6; tgt = H(pos[0], pos[2]) + 2.4; }
    else if (k === 'bridge') { speed = 6.5 * slow; steer(dt, 1.5); tgt = Math.max(11, H(pos[0], pos[2]) + 2.5); }
    else if (k === 'rooftop') { speed = 2.3 * slow; tgt = Math.max(roofY, H(pos[0], pos[2])) + 1.7; }
    else { speed = 12 * slow; tgt = Math.max(eyeY, H(pos[0], pos[2]) + 30); }
    pos[0] -= Math.sin(heading) * speed * dt;
    pos[2] -= Math.cos(heading) * speed * dt;
    // rise fast (a wall ahead), sink slowly
    eyeY = smooth(eyeY, tgt, tgt > eyeY ? 4 : 0.8, dt);
    if (k === 'flyover') eyeY = smooth(eyeY, H(pos[0], pos[2]) + 44, 0.2, dt);
    pos[1] = eyeY;
    const sway = Math.sin(t * 0.5 + shot.phase) * shot.sway;
    yaw += angDiff(yaw, heading + sway) * (1 - Math.exp(-2.2 * dt));
  }

  function plate() {
    const s = env.stats ? env.stats() : null;
    const params = [];
    if (s) {
      params.push({ sym: 'n', name: 'slots collapsed', value: Math.round(s[0]).toLocaleString('en-US') });
      params.push({ sym: 'b', name: 'backtracks', value: String(Math.round(s[1])) });
      params.push({ sym: 'M', name: 'modules', value: String(Math.round(s[5])) });
    }
    return {
      title: 'Collapse City',
      sub: SUBS[shot ? shot.key : 'flyover'],
      tex: [TEX], params,
      lines: [
        'Each slot keeps the modules that fit all six neighbours. The solver collapses the slot with the lowest entropy, then propagates.',
        'After marian42/wavefunctioncollapse (MIT) · algorithm: Maxim Gumin, WaveFunctionCollapse (MIT)',
      ],
    };
  }

  return {
    tick, cut,
    plate: () => (shot ? plate() : null),
    debug: () => ({ seed, n, key: shot && shot.key, t, phase, dur: shot && shot.dur, pos: pos.slice(), yaw, pitch, band, plan: plan.slice(0, 10).map(s => s.key) }),
    get shot() { return shot; },
  };
}

// ---- the browser hook ------------------------------------------------------------
if (hasDOM) {
  let run = null;
  const CSS = 'html.wfc-saver body>*:not(#stage){display:none!important}html.wfc-saver #stage{position:fixed;inset:0}html.wfc-saver #view{cursor:none;transition:opacity .45s linear}';
  window.snSaver = {
    enter(o = {}) {
      if (run) window.snSaver.exit();
      window.snSaverActive = true;
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      document.documentElement.classList.add('wfc-saver');
      const canvas = document.getElementById('view');
      const R = run = { st, alive: true, dir: null };
      (async () => {
        let bandFn = null;
        try { bandFn = (await import('../../lib/saver-clear.js')).plateBand; } catch (e) { bandFn = null; }
        for (let n = 0; n < 200 && R.alive && !(window.__wfc && window.__wfc.ready); n++) await new Promise(r => setTimeout(r, 50));
        if (!R.alive || !window.__wfc) return;
        const app = await window.__wfc.ready;
        if (!R.alive || !app) return;
        const env = {
          heightAt: (x, z) => app.heightAt(x, z),
          stats: () => app.stats(),
          band: () => (bandFn ? bandFn(canvas.clientHeight) : null),
          aspect: () => canvas.clientWidth / Math.max(1, canvas.clientHeight),
          height: () => canvas.clientHeight,
        };
        R.dir = startSaver(env, { ...o, label: o.label });
        app.attachSaver(R.dir);
      })().catch(e => console.error('wfc-city saver', e));
      return { canvas, warmupMs: 3500 };
    },
    exit() {
      const R = run; if (!R) return;
      run = null; R.alive = false;
      try { if (window.__wfc && window.__wfc.app) window.__wfc.app.detachSaver(); } catch (e) { /* not ready */ }
      R.st.remove();
      document.documentElement.classList.remove('wfc-saver');
      const c = document.getElementById('view'); if (c) c.style.opacity = '';
      window.snSaverActive = false;
    },
    debug: () => (run && run.dir ? run.dir.debug() : null),
    cut: key => (run && run.dir ? run.dir.cut(key) : null),
  };
}
