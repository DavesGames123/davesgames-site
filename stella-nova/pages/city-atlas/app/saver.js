// ============================================================================
//  SAVER  ·  city-atlas/app/saver.js — the screensaver tour (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls enter(). The page hides
//  its text (style.css SAVER) and tours the cities: a seeded shuffle, each
//  shot a slow orbit around the city centre at a flattering height and light,
//  with the overlays varied but calm. A shot lasts 8 to 15 s (calm: longer).
//  The next city loads (worker) and uploads (GPU) during the shot, so the
//  cut, a short fade through black, never waits. The camera frames the city
//  in the clear band of the label plate (lib/saver-clear.js plateBand).
//  app/tour.js makes the shots and the plate content.
//
//  grep -n targets
//    saver values ......... "export const sv"
//    one shot ............. "const saverShot"
//    start a shot ......... "async function saverStart"
//    per frame ............ "export function saverTick"
//    plate refresh ........ "export function platePulse"
//    plate and code ....... "function saverPlate"
//    hook ................. "export function installSaver"
// ============================================================================

import { S, ov, cam, lastHour, pageUrl } from './state.js';
import { canvas, fadeEl } from './dom.js';
import { wait, clamp } from './text.js';
import { sunAzOf, ease } from './view.js';
import { mulberry32, shuffle, saverShot as shotOf, CODE, extract, plateOf } from './tour.js';
import { slotFor, trimSlots } from './loader.js';
import { buildOverlay } from './foot.js';
import { pushWind } from './drawer.js';
import { setCaption, setAtlas, setLayers } from './sheets.js';
import { setPlaying } from './controls.js';

// label: the plate callback of the shell (or null), plateT: time of the last
// plate, rate: clock speed factor, offsetY: image shift toward the clear band
export const sv = { label: null, plateT: 0, rate: 1, offsetY: 0 };
const tour = { order: [], k: 0, shot: null, next: null, rnd: null, calm: 0, band: null, bandAt: -1e9, bandFn: null, cutting: false };

// One shot: app/tour.js saverShot, from the seeded rng.
const saverShot = (i) => shotOf(tour.rnd, S.cities[i], i, tour.calm);

async function saverStart(shot, first) {
  const c = S.cities[shot.i];
  const s = await slotFor(shot.i, { full: true });
  // fade to black, then switch
  if (!first) { fadeEl.classList.remove('clear'); await wait(650); }
  const meta = S.meta = s.meta;
  S.locIndex = shot.i;
  S.renderer.show(s);
  trimSlots([c.id, tour.next ? S.cities[tour.next.i].id : '']);
  ov.view.light = shot.light;
  ov.terrain.on = shot.terrain; ov.terrain.exag = shot.exag;
  ov.ocean.on = shot.ocean && !!meta.current;
  ov.wind.on = shot.wind; ov.wind.heat = shot.heat; ov.wind.live = false;
  ov.wind.slice = 12;
  const p = meta.wind?.prevail;
  if (p) { ov.wind.dirFrom = p.dir; ov.wind.speed = clamp(Math.round(p.speed * 2) / 2, 3, 8); }
  pushWind();
  // overlays start at their target, no fade-in from zero
  for (const k of ['terrain', 'ocean', 'wind']) ov[k].amt = ov[k].on ? 1 : 0;
  S.sunAz = sunAzOf(meta);
  const R = meta.r * 1000;
  cam.target = [0, 0, meta.groundRef || 0];
  cam.yaw = shot.yaw0; cam.pitch = shot.pitch; cam.dist = R * shot.distK;
  S.hour = tour.rnd() * lastHour();
  buildOverlay();
  shot.t0 = performance.now();
  tour.shot = shot;
  sv.plateT = 0;
  saverPlate();
  requestAnimationFrame(() => fadeEl.classList.add('clear'));
  // pick and preload the next city
  tour.k = (tour.k + 1) % tour.order.length;
  if (tour.k === 0) tour.order = shuffle(tour.order.slice(), tour.rnd);
  tour.next = saverShot(tour.order[tour.k]);
  setTimeout(() => slotFor(tour.next.i, { full: true }).catch(() => {}), 1500);
}

export function saverTick(dt, t) {
  const sh = tour.shot;
  if (!sh) return;
  cam.yaw += sh.yawRate * dt;
  // frame the city in the clear band of the plate: shift the image so the
  // target sits at the middle of the band, and zoom to its height
  if (tour.bandFn && t - tour.bandAt > 700) { tour.bandAt = t; tour.band = tour.bandFn(window.innerHeight); }
  const h = window.innerHeight;
  if (tour.band && h > 0) {
    const mid = (tour.band.t + (h - tour.band.b)) / 2;
    sv.offsetY = ease(sv.offsetY, 1 - (2 * mid) / h, dt, 0.8);
    const k = clamp((h - tour.band.t - tour.band.b) / (h * 0.62), 0.8, 1.2);
    cam.dist = ease(cam.dist, S.meta.r * 1000 * sh.distK / k, dt, 1.2);
  } else sv.offsetY = ease(sv.offsetY, 0, dt, 0.8);
  if (!tour.cutting && (t - sh.t0) / 1000 > sh.seconds && tour.next) {
    tour.cutting = true;
    const nx = tour.next;
    slotFor(nx.i, { full: true }).then(() => saverStart(nx, false)).catch(() => {}).finally(() => { tour.cutting = false; });
  }
}

// After a drawn frame: the plate refreshes once a second in the saver.
export function platePulse(t) {
  if (S.saver && sv.label && t - sv.plateT >= 1000) { sv.plateT = t; saverPlate(); }
}

// The plate: title, the city, the overlay numbers, and a real extract of
// the shader that draws the primary overlay.
const codeCache = new Map();
async function shaderText(name) {
  if (!codeCache.has(name)) codeCache.set(name, fetch(pageUrl(`shaders/${name}`)).then((r) => r.text()).catch(() => ''));
  return codeCache.get(name);
}
let saverCode = null;
function saverPlate() {
  if (!sv.label || !S.meta || !tour.shot) return;
  const sh = tour.shot;
  const plate = plateOf(S.meta, ov, sh, S.hour);
  const k = CODE[sh.primary] || CODE.none;
  try {
    sv.label({
      ...plate,
      code: saverCode && saverCode.key === sh.primary ? saverCode.code : undefined,
    });
  } catch { /* the plate is optional */ }
  if (!saverCode || saverCode.key !== sh.primary) {
    shaderText(k[0]).then((src) => {
      const text = extract(src, k[1], k[2]);
      if (text) { saverCode = { key: sh.primary, code: { lang: 'wgsl', name: `${k[0]} · ${k[3]}`, text } }; sv.plateT = 0; }
    });
  }
}

// started: the promise of main.js start(); enter() waits for it.
export function installSaver(started) {
  window.snSaver = {
    async enter(opts) {
      const calm = clamp(+opts.calm || 0, 0, 1);
      await started;
      S.saver = true;
      sv.label = opts.labels === false || typeof opts.label !== 'function' ? null : opts.label;
      tour.calm = calm;
      tour.rnd = mulberry32((opts.seed >>> 0) || 1);
      tour.order = shuffle(S.cities.map((_, i) => i), tour.rnd);
      tour.k = 0;
      sv.rate = 0.5 / (1 + calm);
      import('../../../lib/saver-clear.js').then((m) => { tour.bandFn = m.plateBand; }).catch(() => { /* no band */ });
      document.body.classList.add('saver', 'idle');
      setCaption(false); setAtlas(false); setLayers(false);
      setPlaying(true);
      if (S.renderer) {
        ++S.switchToken;
        await saverStart(saverShot(tour.order[0]), true);
      }
      return { canvas, warmupMs: 1800 };
    },
    exit() {
      S.saver = false;
      sv.label = null;
      sv.offsetY = 0;
      document.body.classList.remove('saver');
    },
  };
}
