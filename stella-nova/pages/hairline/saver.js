// ============================================================================
//  HAIRLINE  ·  saver.js — the window.snSaver hook (screensaver tour)
// ----------------------------------------------------------------------------
//  Our own code around hairline by Lucas Marques (MIT, vendor/
//  LICENSE-hairline.txt). Protocol: lib/screensaver.js.
//
//  enter(opts) hides the page, mounts one large figure with play: true in a
//  full-window stage, and puts #saverCanvas over it. mirror.js paints the
//  figure SVG into that canvas each frame, so the recorder gets it. The
//  live figure stays on screen under the canvas, so its IntersectionObserver
//  keeps it running.
//
//  SHOTS. A seeded shuffle of the 33 figures, shuffled again each round.
//  Each shot: one figure, a palette from a shuffled bag, an intensity of
//  0.35-0.9, 6-11 s (calm = longer), then a cut. The label names the
//  figure, what it is, the palette and the live caption from onRead.
//
//  FRAMING. The figure is the largest 5:4 box in the clear band of the
//  shell label plate (lib/saver-clear.js plateBand), checked each 250 ms.
//  With no plate, a band of 76% of the height.
//
//  GREP MAP
//    grep -n 'export function installSaver'  the hook
//    grep -n 'export function shuffle'       the seeded shuffle (tested)
//    grep -n 'export function fitBox'        the 5:4 box in a band (tested)
//    grep -n 'export function planShot'      one shot from the rng (tested)
//    grep -n 'function cut'                  mount the next shot
// ============================================================================
import * as H from './vendor/hairline.js';
import { FIGURES, PALETTES, CREDIT } from './catalog.js';
import { mirror } from './mirror.js';
import { plateBand } from '../../lib/saver-clear.js';

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The largest 5:4 box that fits a band of the window, centred in it.
// band = { t, b } px from the top and bottom. Width at most 92% of W.
export function fitBox(W, Hh, band) {
  const t = band ? band.t : Hh * 0.12, b = band ? band.b : Hh * 0.12;
  const bh = Math.max(Hh * 0.3, Hh - t - b);
  let w = Math.min(W * 0.92, bh * 1.25), h = w / 1.25;
  if (h > bh) { h = bh; w = h * 1.25; }
  return { x: (W - w) / 2, y: t + (bh - h) / 2, w, h };
}

export function planShot(rng, calm, fig, pal) {
  return {
    fn: fig.fn, name: fig.name, what: fig.what, palette: pal,
    intensity: Math.round((0.35 + rng() * 0.55) * 100) / 100,
    seconds: 6 + calm * 3 + rng() * 2,
  };
}

export function installSaver(page) {
  let S = null;

  function bag(rng) { return { figs: shuffle(FIGURES, rng), pals: shuffle(PALETTES, rng), i: 0, j: 0 }; }

  function next() {
    if (S.bag.i >= S.bag.figs.length) S.bag.figs = shuffle(FIGURES, S.rng), S.bag.i = 0;
    if (S.bag.j >= S.bag.pals.length) S.bag.pals = shuffle(PALETTES, S.rng), S.bag.j = 0;
    return planShot(S.rng, S.calm, S.bag.figs[S.bag.i++], S.bag.pals[S.bag.j++]);
  }

  function place() {
    const band = plateBand(innerHeight);
    const b = fitBox(innerWidth, innerHeight, band);
    S.box = b;
    Object.assign(S.host.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px' });
  }

  function label(shot, caption) {
    if (!S.label) return;
    S.label({
      title: shot.name,
      sub: CREDIT,
      lines: [shot.what, `${shot.fn}(el, { intensity: ${shot.intensity}, play: true }) · palette ${shot.palette.label}` + (caption ? ` · read-out ${caption}` : '')],
    });
  }

  function cut() {
    if (!S) return;
    if (S.fig) S.fig.destroy();
    const shot = next();
    S.shot = shot;
    for (const [k, v] of Object.entries(shot.palette.vars)) S.stage.style.setProperty('--hairline-' + k, v);
    S.stage.style.background = shot.palette.vars.plate;
    place();
    S.fig = H[shot.fn](S.host, {
      intensity: shot.intensity, theme: shot.palette.theme, play: true,
      onRead: t => { if (S && S.shot === shot) label(shot, t); },
    });
    label(shot, '');
    S.timer = setTimeout(cut, shot.seconds * 1000);
  }

  window.snSaver = {
    enter(opts = {}) {
      if (S) this.exit();
      const calm = Math.max(0, Math.min(1, opts.calm ?? 0.6));
      const rng = mulberry((opts.seed ?? Date.now()) ^ 0x4a17);
      const stage = document.createElement('div');
      stage.id = 'saverStage';
      const host = document.createElement('div');
      host.className = 'saver-fig';
      stage.appendChild(host);
      const canvas = document.createElement('canvas');
      canvas.id = 'saverCanvas';
      stage.appendChild(canvas);
      document.body.appendChild(stage);
      document.documentElement.classList.add('saver-on');
      page.pause(true);
      S = { calm, rng, stage, host, canvas, label: opts.label, bag: null, fig: null, shot: null, timer: 0, box: null };
      S.bag = bag(rng);
      cut();
      S.band = setInterval(place, 250);
      S.mirror = mirror(host, canvas, {
        vars: () => S.shot.palette.vars,
        box: () => S.box,
        stroke: () => page.stroke(),
      });
      return { canvas, warmupMs: 600 };
    },
    exit() {
      if (!S) return;
      clearTimeout(S.timer); clearInterval(S.band); S.mirror.stop();
      if (S.fig) S.fig.destroy();
      if (S.label) S.label(null);
      S.stage.remove();
      S = null;
      document.documentElement.classList.remove('saver-on');
      page.pause(false);
    },
  };
}
