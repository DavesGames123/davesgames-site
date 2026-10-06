// ============================================================================
//  VOLUME NOISE  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label }. enter() hides the page
//  GUI (html.vn-saver; the shell uses sn-saver for its generic mode),
//  and starts a shot director. It resolves to
//  { canvas, warmupMs } when the textures are ready; the canvas is the page
//  canvas #gl, which stays in the document.
//
//  SHOTS. A seeded shuffle of a deck of shot kinds. opts.seed changes for
//  each run, so each run plays a new order with new values. Nothing is
//  kept between loads. A new deck is shuffled when the old one ends.
//    sky ..... a cloud-layer fly-through: coverage, time of day (dawn, noon,
//              dusk sun height and tint), sun bearing, wind, height, heading
//    cube .... the volume cube of one channel, orbiting, with a push-in
//    slice ... a z sweep through one channel
//    tiles ... a pull-back from one tile to the 3 x 3 grid; the seam lines
//              come on half way
//  Each shot holds 5 to 12 s (calm 1 is the longest), with a fade through
//  black at each cut. At enter, the texture seed is the original (0) or a
//  random seed, and the textures are generated again for that seed.
//
//  FRAMING. main.js clearArea() reads S.band, the clear band between the
//  plate's top and bottom text (lib/saver-clear.js plateBand), every 250 ms.
//
//  PLATE. opts.label gets the shot title, its values, and a real excerpt of
//  shaders/noise.wgsl (the head of worley_cells, or the octave loop of
//  perlin_fbm), cut from the loaded source text.
//
//  grep -n: "function makeShot"  "function tick"  "function plate"  "enter(opts)"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { CHANNELS } from './gpu.js';

const DECK = ['sky', 'sky', 'sky', 'cube', 'cube', 'slice', 'tiles', 'tiles'];
// Channels that read well in each view (indices into CHANNELS).
const CUBE_CHANS = [0, 1, 2, 4, 5, 7, 8, 9, 11];
const FLAT_CHANS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);

// A real excerpt of shaders/noise.wgsl: lines [from, to) of function name.
// Short, so the plate's code box leaves a taller clear band.
function fnExtract(src, name, from, to) {
  const i = src.indexOf('fn ' + name + '(');
  if (i < 0) return '';
  const lines = src.slice(i, src.indexOf('\n}', i) + 2).split('\n');
  const part = lines.slice(from, to);
  return (from > 0 ? '…\n' : '') + part.join('\n') + (to < lines.length ? '\n…' : '');
}

export function installSaver(ctx) {
  const { S } = ctx;
  let run = null;

  function makeShot(kind, r, calm) {
    const dur = (5 + 4 * calm + r() * 3) + (kind === 'sky' ? 1.5 * calm : 0);
    const pick = a => a[Math.floor(r() * a.length)];
    // A channel that none of the last three shots used.
    const pickChan = a => {
      let c = pick(a);
      for (let i = 0; i < 8 && run.recent.includes(c); i++) c = pick(a);
      run.recent = [c, ...run.recent].slice(0, 3);
      return c;
    };
    if (kind === 'sky') {
      const tod = pick(['dawn', 'noon', 'dusk']);
      const sunEl = tod === 'noon' ? lerp(42, 66, r()) : lerp(3, 10, r());
      const sunAz = r() * 360;
      // Heading: into the sun, across it, or with it behind.
      const rel = pick([0, 0, 70, -70, 180]) + lerp(-25, 25, r());
      const above = r() < 0.25;
      return { kind, dur, tod, sunEl, sunAz, cov: lerp(0.28, 0.6, r()), dens: lerp(0.8, 1.35, r()), ero: lerp(0.2, 0.45, r()),
        wind: lerp(8, 40, r()), alt: above ? lerp(4.4, 5.4, r()) : lerp(0.3, 1.1, r()),
        pitch: above ? lerp(-0.22, -0.08, r()) : lerp(0.14, 0.38, r()),
        yaw: (sunAz + rel) * Math.PI / 180, yawRate: lerp(-0.025, 0.025, r()),
        speed: lerp(0.15, 0.4, r()), x: r() * 36, z: r() * 36,
        tint: tod === 'dawn' ? [1.04, 0.93, 0.98] : tod === 'dusk' ? [1.08, 0.9, 0.84] : [1, 1, 1] };
    }
    if (kind === 'cube') {
      const chan = pickChan(CUBE_CHANS);
      const inward = r() < 0.7;
      return { kind, dur, chan, thr: S.cubeThr[chan] + lerp(-0.04, 0.04, r()), gain: lerp(0.9, 1.8, r()), ice: r() < 0.5,
        yaw: r() * 6.283, yawRate: (r() < 0.5 ? -1 : 1) * lerp(0.1, 0.22, r()), pitch: lerp(0.2, 0.75, r()),
        d0: inward ? 2.6 : 1.8, d1: inward ? 1.8 : 2.5 };
    }
    if (kind === 'slice') {
      return { kind, dur, chan: pickChan(FLAT_CHANS), z: r(), zRate: (r() < 0.5 ? -1 : 1) * lerp(0.04, 0.1, r()), ice: r() < 0.4 };
    }
    return { kind: 'tiles', dur, chan: pickChan(FLAT_CHANS), z: r(), zRate: lerp(-0.01, 0.01, r()), ice: r() < 0.4 };
  }

  // Apply the shot at time t (s) into it. Called every frame by main.js.
  function apply(sh, t, dt, slow) {
    const k = Math.min(1, t / sh.dur);
    if (sh.kind === 'sky') {
      S.view = 'clouds';
      Object.assign(S, { cov: sh.cov, dens: sh.dens, ero: sh.ero, sunEl: sh.sunEl, sunAz: sh.sunAz, wind: sh.wind, tint: sh.tint });
      const L = S.look;
      L.yaw = sh.yaw + sh.yawRate * t; L.pitch = sh.pitch; L.alt = sh.alt;
      const d = sh.speed * slow * t;
      L.x = sh.x + Math.sin(L.yaw) * d; L.z = sh.z + Math.cos(L.yaw) * d;
    } else if (sh.kind === 'cube') {
      S.view = 'volume'; S.chan = sh.chan; S.thr = sh.thr; S.gain = sh.gain; S.ice = sh.ice;
      S.orbit.yaw = sh.yaw + sh.yawRate * slow * t; S.orbit.pitch = sh.pitch; S.orbit.dist = lerp(sh.d0, sh.d1, ease(k));
    } else if (sh.kind === 'slice') {
      S.view = 'slice'; S.chan = sh.chan; S.ice = sh.ice;
      S.z = (((sh.z + sh.zRate * slow * t) % 1) + 1) % 1;
    } else {
      S.view = 'tiles'; S.chan = sh.chan; S.ice = sh.ice;
      S.z = (((sh.z + sh.zRate * t) % 1) + 1) % 1;
      // Hold one tile, pull back to three over the middle, hold the grid.
      const p = ease(Math.min(1, Math.max(0, (k - 0.15) / 0.6)));
      S.span = lerp(1, 3, p);
      S.seams = p > 0.5;
    }
    // Fade through black at the cut.
    S.fade = Math.min(1, t / 0.6, (sh.dur - t) / 0.5);
    S.fade = Math.max(0, S.fade);
  }

  function plate() {
    if (!run || !run.label) return;
    const sh = run.shot, src = (ctx.shaderSource() || {}).noise || '';
    const c = CHANNELS[sh.chan] || CHANNELS[0];
    const perlinish = sh.kind === 'sky' || /Perlin/.test(c.name);
    // worley_cells: the signature down to the nearest-point update.
    // perlin_fbm: the octave loop (weight *= weight is the original's).
    const code = perlinish
      ? { lang: 'wgsl', name: 'shaders/noise.wgsl · perlin_fbm', text: fnExtract(src, 'perlin_fbm', 5, 12) }
      : { lang: 'wgsl', name: 'shaders/noise.wgsl · worley_cells', text: fnExtract(src, 'worley_cells', 0, 9) };
    const P = S.prm, f2 = v => v.toFixed(2);
    const tex = c.tex === 'detail' ? '32³' : P.shapeRes + '³';
    const seedLine = P.seed ? 'Seed ' + P.seed + ': a new hash table and Perlin slice' : 'Seed 0: the values of the original tool';
    let info;
    if (sh.kind === 'sky') {
      info = { title: 'Cloud layer · ' + sh.tod, sub: 'The main.cpp shape and erosion textures in a ray-marched cloud layer',
        params: [
          { sym: 'c', name: 'coverage', value: f2(sh.cov), cls: 'm1' },
          { sym: '\\theta_\\odot', name: 'sun height', value: sh.sunEl.toFixed(0) + '°', cls: 'm5' },
          { sym: 'v', name: 'wind', value: sh.wind.toFixed(0) + ' m/s', cls: 'm3' },
          { sym: 'e', name: 'erosion', value: f2(sh.ero), cls: 'm2' },
        ],
        lines: ['Beer-Powder light, two Henyey-Greenstein lobes, 1.5 to 4 km layer', seedLine] };
    } else {
      const title = sh.kind === 'cube' ? 'Volume · ' + c.name : sh.kind === 'slice' ? 'Slice sweep · ' + c.name : 'Tiling · ' + c.name;
      const sub = sh.kind === 'cube' ? 'One channel of a tileable 3D texture, ray-marched in a unit cube'
        : sh.kind === 'slice' ? 'One z slice of a tileable 3D texture, moving through the volume'
        : 'One slice repeated 3 × 3: no seam in value or in slope';
      info = { title, sub,
        params: [
          { sym: 'N', name: 'texels', value: tex, cls: 'm6' },
          { sym: 'f', name: 'Perlin frequency', value: String(P.perlinFreq), cls: 'm1' },
          { sym: 'n', name: c.tex === 'detail' ? 'detail cells' : 'Worley cells', value: String(c.tex === 'detail' ? P.detailCells : P.gbaCells), cls: 'm2' },
          { sym: 's', name: 'seed', value: String(P.seed), cls: 'm4' },
        ],
        lines: [c.note, seedLine] };
    }
    info.code = code;
    run.label(info);
  }

  function tick(dt) {
    if (!run) return;
    const now = performance.now();
    // Keep the last band while the plate fades between two titles (no band).
    if (now - run.bandAt > 250) { run.bandAt = now; const b = plateBand(innerHeight); if (b) S.band = b; }
    S.time += dt;
    run.t += dt;
    if (run.t >= run.shot.dur) nextShot();
    apply(run.shot, run.t, dt, run.slow);
  }

  function nextShot() {
    if (!run.deck.length) {
      run.deck = DECK.slice();
      for (let j = run.deck.length - 1; j > 0; j--) { const q = Math.floor(run.r() * (j + 1)); [run.deck[j], run.deck[q]] = [run.deck[q], run.deck[j]]; }
      // No kind twice in a row, also across the deck boundary.
      const d = run.deck, prev = run.shot ? run.shot.kind : null;
      for (let i = 0; i < d.length; i++) {
        const before = i ? d[i - 1] : prev;
        if (d[i] !== before) continue;
        const j = d.findIndex((k, q) => q > i && k !== before);
        if (j > 0) [d[i], d[j]] = [d[j], d[i]];
      }
    }
    run.shot = makeShot(run.deck.shift(), run.r, run.calm);
    run.t = 0; run.count++;
    plate();
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      document.documentElement.classList.add('vn-saver');
      const r = rng(opts.seed || 1);
      run = { r, calm, slow: 1 - 0.5 * calm, deck: [], shot: null, t: 0, count: 0, bandAt: -1e9, recent: [],
        label: typeof opts.label === 'function' ? opts.label : null };
      S.saver = true; S.playing = true; S.sweep = false; S.seams = false;
      const seed = r() < 0.45 ? 0 : 1 + Math.floor(r() * 999);
      return ctx.ready.then(async () => {
        if (seed !== S.prm.seed || S.prm.shapeRes !== 128) await ctx.regen({ seed, shapeRes: 128 });
        nextShot();
        S.saverTick = tick;
        return { canvas: ctx.canvas, warmupMs: 600 };
      });
    },
    exit() {
      run = null; S.saverTick = null; S.saver = false; S.band = null; S.fade = 1; S.tint = [1, 1, 1];
      document.documentElement.classList.remove('vn-saver');
      ctx.syncUI();
    },
    debug() {
      if (!run) return null;
      const sh = run.shot;
      return { kind: sh.kind, t: +run.t.toFixed(2), dur: +sh.dur.toFixed(2), count: run.count, deckLeft: run.deck.slice(),
        view: S.view, chan: S.chan, fade: +S.fade.toFixed(2), span: +S.span.toFixed(2), seed: S.prm.seed, band: S.band };
    },
  };
}
