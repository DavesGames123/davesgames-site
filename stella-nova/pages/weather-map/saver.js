// ============================================================================
//  WEATHER MAP  ·  saver.js — the screensaver (shell hook and in-page mode)
// ----------------------------------------------------------------------------
//  Two ways in, one director:
//    shell     lib/screensaver.js calls window.snSaver.enter(opts), opts =
//              { calm, seconds, caption, seed, label }. The shell draws the
//              label plate (opts.label) and the page frames its subject in
//              the clear band of that plate (plateBand from
//              lib/saver-clear.js). Class sn-saver on <html>.
//    in page   the Screensaver button or the S key (saver.toggle()). The
//              page goes full screen, the chrome goes (class wx-saver on
//              <html>, style.css), and saver.css draws a lower-third
//              broadcast plate: the place, its local time (ticking) and
//              date (Intl in the place's IANA zone), the temperature in
//              both units, the conditions and the forecast hour.
//              Esc, S, a click or a tap stops it.
//
//  Shots come from a seeded shuffle (a new order for each run): National
//  views, the regions of director.js, single cities with their neighbours,
//  and the major fronts of the current analysis. Each shot is a fitCam of
//  its points inside the clear band of the plate, for the real aspect of
//  the frame (16:9, 9:16 or the 9:16 column of the shell), never lower
//  than MIN_ALT (calm and wide). The camera flies between shots with the
//  news flight of camera.js, then holds for 8-14 s with a slow push-in or
//  pull-out and a small turn. While it holds, the forecast plays ahead
//  (a time-lapse of up to 12 h); during the next flight it eases back.
//
//  Pure parts (node tests import them, no DOM at load):
//    rng(seed), shuffle(a, rnd)
//    buildShots(seed, { fronts, calm, view }) -> [spec]
//    bandView(W, H, band) -> { w, h, inset }   the fitCam view of the band
//    shotCams(spec, view) -> { a, b }          hold start and end cameras
//    holdPose(spec, u) -> { altK, dHeading }   the hold move at u 0..1
//    anchorCity(spec) -> city                  the city the plate names
//    clockText(t, tz), dateText(t, tz), tempParts(c, units)
//    conditionsAt(app, city, t) -> { text, icon }
//    plateInfo(app, spec, wall, t) -> plate fields
//  DOM:
//    installSaver({ app, director, canvas, resize }) -> saver
//      saver.enter(opts) -> { canvas, warmupMs }, saver.exit(),
//      saver.toggle(), saver.active, saver.tick(dt) -> bool, saver.debug()
//      It also sets window.snSaver (globalThis.snSaver) = { enter, exit, cut, debug }.
//
//  grep -n targets: "export function buildShots", "export function bandView",
//  "export function shotCams", "export function plateInfo",
//  "export function installSaver", "── SHOT LIST", "── PLATE", "── TICK",
//  "MIN_ALT", "HOLD_S"
// ============================================================================
import { camState, viewProj, project, flight, flightSeconds, centralAngle, ALT_MAX } from './camera.js';
import { localParts } from './astro.js';
import { REGIONS, REGION_BY_ID, fitCam, frontShots, NEWS_TILT } from './director.js';
import { CITIES, CITY_BY_ID, nearestCity } from './data/cities.js';
import { codeText } from './data/forecast.js';
import { frontsAt } from './data/fronts.js';
import { cityTempAt, iconFor, ICONS } from './labels.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const H = 3600e3;

// MIN_ALT: the lowest camera of any shot (globe radii); HOLD_S: the hold
// after the camera lands; LAPSE_H: the most forecast hours one hold plays
export const MIN_ALT = { region: 0.1, city: 0.13, front: 0.14, national: 0.3 };
export const HOLD_S = [8, 14];
export const LAPSE_H = 12;

// ── RANDOM ───────────────────────────────────────────────────────────────
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── SHOT LIST ────────────────────────────────────────────────────────────
// A spec: { kind, id, name, points:[{lat,lon,name?,id?}], anchor (city id),
//           tilt, heading, hold (s), push (alt factor at the hold start),
//           turn (rad over the hold), lapse (h), minAlt }
const CONUS_OUT = new Set(['national', 'alaska', 'hawaii', 'puerto-rico']);
const inUS = p => p[0] >= 18 && p[0] <= 58 && p[1] >= -135 && p[1] <= -55;
const cityPts = ids => ids.map(id => CITY_BY_ID.get(id)).filter(Boolean);

// The anchor of a region: its largest rank-1 city (else its largest city).
function regionAnchor(r) {
  const cs = cityPts(r.cities);
  if (!cs.length) return null;
  cs.sort((a, b) => a.rank - b.rank || b.pop - a.pop);
  return cs[0].id;
}

// A city and its nearest neighbours (up to 5 within 7 deg), so the shot
// has labels around the subject and is not a close-up of one dot.
function neighbours(c) {
  const d = CITIES.filter(o => o.id !== c.id).map(o => ({ o, a: centralAngle(c, o) })).filter(x => x.a < 7 * Math.PI / 180);
  d.sort((x, y) => x.a - y.a);
  return [c, ...d.slice(0, 5).map(x => x.o)];
}

export function buildShots(seed, opts = {}) {
  const rnd = rng(seed), calm = clamp(opts.calm ?? 0.7, 0, 1);
  const hold = () => HOLD_S[0] + (HOLD_S[1] - HOLD_S[0] - 2) * calm + rnd() * 2;
  const look = (kind) => ({
    tilt: kind === 'national' ? 0.18 + 0.12 * rnd() : NEWS_TILT * (0.7 + 0.6 * rnd()),
    heading: (rnd() - 0.5) * 0.16,
    push: rnd() < 0.7 ? 1.06 + 0.06 * rnd() : 1 / (1.05 + 0.04 * rnd()),
    turn: (rnd() < 0.5 ? -1 : 1) * (0.015 + 0.025 * rnd()) * (1 - 0.5 * calm),
    hold: hold(),
    lapse: 6 + 6 * rnd(),
  });
  const out = [];
  const nat = REGION_BY_ID.get('national');
  for (let k = 0; k < 2; k++) out.push({ kind: 'national', id: 'national', name: 'United States', points: cityPts(nat.cities), anchor: null, minAlt: MIN_ALT.national, ...look('national') });
  for (const r of REGIONS) {
    if (r.auto || CONUS_OUT.has(r.id)) continue;
    out.push({ kind: 'region', id: r.id, name: r.name, points: cityPts(r.cities), anchor: regionAnchor(r), minAlt: MIN_ALT.region, ...look('region') });
  }
  // one of the far states per run
  const far = ['alaska', 'hawaii', 'puerto-rico'][Math.floor(rnd() * 3)];
  const farR = REGION_BY_ID.get(far);
  if (farR) out.push({ kind: 'region', id: farR.id, name: farR.name, points: cityPts(farR.cities), anchor: regionAnchor(farR), minAlt: MIN_ALT.region, ...look('region') });
  // four big cities
  const big = shuffle(CITIES.filter(c => c.rank === 1 && !['AK', 'HI', 'PR'].includes(c.state)), rnd).slice(0, 4);
  for (const c of big) out.push({ kind: 'city', id: c.id, name: `${c.name}, ${c.state}`, points: neighbours(c), anchor: c.id, minAlt: MIN_ALT.city, ...look('city') });
  // up to three major fronts
  if (opts.fronts) {
    const fr = opts.fronts.fronts || [];
    for (const s of frontShots(opts.fronts, opts.view || undefined, 3)) {
      const f = fr[+String(s.id).replace('front-', '')];
      const pts = f && f.pts ? f.pts.filter(inUS).map(([lat, lon]) => ({ lat, lon })) : [];
      const near = nearestCity(s.at.lat, s.at.lon, 8);
      out.push({ kind: 'front', id: s.id, name: s.name, points: pts.length ? pts : null, cam: s.cam, at: s.at, anchor: near ? near.id : null, minAlt: MIN_ALT.front, ...look('front') });
    }
  }
  shuffle(out, rnd);
  // no shot twice in a row (the two National views)
  for (let i = 1; i < out.length; i++) {
    if (out[i].id !== out[i - 1].id) continue;
    const j = out.findIndex((s, k) => k > i + 1 && s.id !== out[i].id);
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The fitCam view of a frame W x H with a clear band { t, b, w } (band w
// is the visible column: the 9:16 column of the shell, else W).
export function bandView(W, H, band) {
  const b = band || { t: 0, b: 0, w: W };
  const w = Math.min(W, b.w || W), side = (W - w) / 2;
  const t = clamp(b.t || 0, 0, H * 0.7), bot = clamp(b.b || 0, 0, H * 0.7 - t);
  return { w: W, h: H, inset: { t, b: bot, l: side, r: side } };
}

// The hold move: the altitude factor and the heading offset at u 0..1.
export function holdPose(spec, u) {
  const k = smooth(u);
  return { altK: spec.push + (1 - spec.push) * k, dHeading: spec.turn * (k - 1) };
}

// The cameras at the hold start (a) and end (b). b is the tight fit; a is
// pushed out (or in, for a pull-out) by spec.push and turned by -turn. A
// pull-out (push < 1) fits at 1 / push so that a is the tight fit.
export function shotCams(spec, view) {
  let pts = spec.points;
  if (!pts || !pts.length) pts = spec.at ? [spec.at] : [];
  const fit = fitCam(pts, { w: view.w, h: view.h, inset: view.inset, tilt: spec.tilt, heading: spec.heading, minAlt: spec.minAlt, slack: 1.06 });
  const base = spec.push < 1 ? fit.alt / spec.push : fit.alt;
  const b = camState(fit.lat, fit.lon, clamp(base, spec.minAlt, ALT_MAX), spec.tilt, spec.heading);
  const p0 = holdPose(spec, 0);
  const a = camState(fit.lat, fit.lon, clamp(base * p0.altK, spec.minAlt, ALT_MAX), spec.tilt, spec.heading + p0.dHeading);
  return { a, b };
}

export function anchorCity(spec) {
  if (spec.anchor && CITY_BY_ID.has(spec.anchor)) return CITY_BY_ID.get(spec.anchor);
  return null;
}

// ── PLATE ────────────────────────────────────────────────────────────────
const fmtCache = new Map();
function dtf(tz, o) {
  const k = tz + JSON.stringify(o);
  let f = fmtCache.get(k);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }); }
    catch { f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }); }
    fmtCache.set(k, f);
  }
  return f;
}

// '3:42:07 PM'
export function clockText(t, tz = 'UTC', seconds = true) {
  return dtf(tz, { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).format(new Date(t));
}
// 'Thursday, October 15, 2026'
export function dateText(t, tz = 'UTC') {
  return dtf(tz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(t));
}
// 'Thu 11 PM'
export function hourText(t, tz = 'UTC') {
  return dtf(tz, { weekday: 'short', hour: 'numeric' }).format(new Date(t));
}

// { main: '72°', unit: 'F', alt: '22°C' }; units 'F' or 'C' first
export function tempParts(c, units = 'F') {
  if (!Number.isFinite(c)) return { main: '–', unit: '', alt: '' };
  const f = Math.round(c * 9 / 5 + 32), cc = Math.round(c);
  return units === 'C' ? { main: `${cc}°`, unit: 'C', alt: `${f}°F` } : { main: `${f}°`, unit: 'F', alt: `${cc}°C` };
}

// The text of a labels.js icon name (the grid code has no text of its own).
const ICON_TEXT = {
  'clear-day': 'Sunny', 'clear-night': 'Clear', 'mostly-clear-day': 'Mostly sunny', 'mostly-clear-night': 'Mostly clear',
  'partly-cloudy-day': 'Partly cloudy', 'partly-cloudy-night': 'Partly cloudy', overcast: 'Cloudy', fog: 'Fog',
  drizzle: 'Drizzle', 'freezing-rain': 'Freezing rain', rain: 'Rain', 'heavy-rain': 'Heavy rain', snow: 'Snow',
  'heavy-snow': 'Heavy snow', 'showers-day': 'Showers', 'showers-night': 'Showers', thunder: 'Thunderstorms',
  'thunder-hail': 'Thunderstorms with hail',
};

// The conditions of a city at t: the observed weather code near now, else
// the labels.js icon made from the grid.
export function conditionsAt(app, city, t) {
  if (!city) return { text: '', icon: '' };
  const cur = app.data && app.data.current && app.data.current.get ? app.data.current.get(city.id) : null;
  const now = Number.isFinite(app.tBase) ? app.tBase : t;
  if (cur && Number.isFinite(cur.code) && Math.abs(t - now) < 90 * 60e3) {
    const c = codeText(cur.code, cur.isDay !== false);
    return { text: c.text, icon: c.icon };
  }
  let icon = 'unknown';
  try { icon = iconFor(app, city, t); } catch { /* no data yet */ }
  return { text: ICON_TEXT[icon] || '', icon };
}

// The plate fields of a shot. wall: the real time now (the clock ticks on
// it); t: the map time (ahead of now during the time-lapse).
export function plateInfo(app, spec, wall, t) {
  const city = anchorCity(spec);
  const cam = app.cam || {};
  const tz = (city && city.tz) || (nearestCity(cam.lat ?? 38, cam.lon ?? -97, 30) || {}).tz || 'America/Chicago';
  let c = NaN;
  if (city) { try { c = cityTempAt(app, city, t); } catch { c = NaN; } }
  const cond = conditionsAt(app, city, t);
  const ahead = (t - wall) / H;
  const lp = localParts(wall, tz);
  return {
    place: spec ? spec.name : 'United States',
    sub: city && spec.kind !== 'city' ? `${city.name}, ${city.state}` : '',
    kind: spec ? spec.kind : '',
    tz, tzAbbr: lp.tzAbbr,
    time: clockText(wall, tz), timeShort: clockText(wall, tz, false), date: dateText(wall, tz),
    temp: tempParts(c, app.units), tempC: c,
    cond: cond.text, icon: cond.icon,
    lapse: ahead >= 0.5 ? `Forecast for ${hourText(t, tz)} · +${Math.round(ahead)} h` : (ahead <= -0.5 ? `Observed ${hourText(t, tz)}` : 'Now'),
  };
}

// The shell poster payload (no code extract: the weather is the subject).
function shellLabel(p) {
  const params = [];
  if (p.temp.main !== '–') params.push({ sym: 'T', name: p.sub || 'temperature', value: `${p.temp.main}${p.temp.unit} · ${p.temp.alt}`, cls: 'm2' });
  if (p.cond) params.push({ sym: '\\text{wx}', name: 'conditions', value: p.cond, cls: 'm5' });
  params.push({ sym: 't', name: 'map time', value: p.lapse, cls: 'm6' });
  return {
    title: p.place,
    sub: `${p.time} ${p.tzAbbr} · ${p.date}`,
    params,
    lines: ['Weather data by Open-Meteo.com (CC BY 4.0) · fronts NOAA WPC'],
  };
}

// ── DOM ──────────────────────────────────────────────────────────────────
const PLATE_HTML = `
  <div class="wxs-bar"></div>
  <div class="wxs-main">
    <div class="wxs-place"><span class="wxs-name"></span><span class="wxs-sub"></span></div>
    <div class="wxs-when"><span class="wxs-time"></span><span class="wxs-tz"></span><span class="wxs-date"></span></div>
  </div>
  <div class="wxs-wx">
    <span class="wxs-icon"></span>
    <span class="wxs-temp"><b></b><i></i><small></small></span>
    <span class="wxs-cond"></span>
  </div>
  <div class="wxs-strip"><span class="wxs-lapse"></span><span class="wxs-credit">Weather data by Open-Meteo.com (CC BY 4.0)</span></div>`;

export function installSaver(ctx) {
  const app = ctx.app, director = ctx.director || null;
  const doc = document, root = doc.documentElement;
  let run = null, plateEl = null, exitEl = null;

  const resize = () => requestAnimationFrame(() => {
    try { if (typeof ctx.resize === 'function') ctx.resize(); else if (app.core && app.core.resize) app.core.resize(); } catch (e) { console.warn(e); }
  });

  function ensurePlate() {
    if (plateEl) return plateEl;
    plateEl = doc.createElement('div');
    plateEl.id = 'wxSaverPlate';
    plateEl.className = 'wxs-plate';
    plateEl.hidden = true;
    plateEl.setAttribute('aria-live', 'off');
    plateEl.innerHTML = PLATE_HTML;
    exitEl = doc.createElement('div');
    exitEl.id = 'wxSaverHint';
    exitEl.className = 'wxs-hint';
    exitEl.hidden = true;
    exitEl.textContent = 'Esc, S or a click stops the screensaver';
    doc.body.append(plateEl, exitEl);
    return plateEl;
  }

  // The clear band: the shell plate band, or above our own lower third.
  function readBand() {
    const W = innerWidth, Hh = innerHeight;
    if (run.shell) {
      let pb = null;
      try { pb = (ctx.plateBand || plateBand)(Hh); } catch { pb = null; }
      if (pb) run.lastBand = pb;
      return run.lastBand || { t: Hh * 0.24, b: Hh * 0.3, w: W };
    }
    const r = plateEl && !plateEl.hidden ? plateEl.getBoundingClientRect() : null;
    const b = r && r.height > 0 ? Hh - r.top + 12 : Hh * 0.26;
    return { t: Math.max(16, Hh * 0.05), b, w: W };
  }

  function view() { return bandView(innerWidth, innerHeight, readBand()); }

  function newList() {
    const set = app.data && app.data.fronts ? frontsAt(app.data.fronts, baseTime()) : null;
    const list = buildShots(run.seed++, { calm: run.calm, fronts: set, view: { w: innerWidth, h: innerHeight } });
    // the next list does not start with the shot that ended the last one
    if (run.list && run.list.length && list.length > 1 && list[0].id === run.list[run.list.length - 1].id) list.push(list.shift());
    run.list = list; run.i = -1;
  }

  // The reference now: app.tBase (main.js), held inside the grid times.
  function baseTime() {
    let t = Number.isFinite(app.tBase) ? app.tBase : Date.now();
    const g = app.data && app.data.grid;
    if (g && g.times && g.times.length) t = clamp(t, g.times[0], g.times[g.times.length - 1]);
    return t;
  }
  function lapseSpan(spec) {
    const g = app.data && app.data.grid;
    let span = Math.min(LAPSE_H, spec.lapse);
    if (g && g.times && g.times.length) span = clamp((g.times[g.times.length - 1] - baseTime()) / H, 0, span);
    return span;
  }

  function nextShot() {
    if (!run.list || run.i + 1 >= run.list.length) newList();
    run.i++;
    const spec = run.list[run.i];
    const cams = shotCams(spec, view());
    const from = { ...app.cam };
    run.shot = { spec, cams, from, fl: flight(from, cams.a), flDur: flightSeconds(from, cams.a), u: 0, hold: 0, lapseFrom: run.lapse };
    run.shots++;
    plate(true);
  }

  // ── TICK ──
  // main.js calls tick(dt) every frame. While the saver runs it writes
  // app.cam and app.t and returns true; main.js then skips its own camera
  // and clock for that frame.
  function tick(dt) {
    if (!run) return false;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const s = run.shot;
    if (!s) { nextShot(); return true; }
    if (s.u < 1) {
      s.u = Math.min(1, s.u + dt / s.flDur);
      Object.assign(app.cam, s.fl(0.5 - 0.5 * Math.cos(Math.PI * s.u)));
      run.lapse = s.lapseFrom * (1 - smooth(s.u));
    } else {
      s.hold += dt;
      const u = s.hold / s.spec.hold, p = holdPose(s.spec, u), b = s.cams.b;
      Object.assign(app.cam, { lat: b.lat, lon: b.lon, tilt: b.tilt, alt: clamp(b.alt * p.altK, s.spec.minAlt, ALT_MAX), heading: b.heading + p.dHeading });
      run.lapse = lapseSpan(s.spec) * smooth(u);
      if (u >= 1) nextShot();
    }
    app.t = baseTime() + run.lapse * H;
    return true;
  }

  function plate(cut) {
    if (!run || !run.shot) return;
    const p = plateInfo(app, run.shot.spec, Date.now(), app.t);
    run.plate = p;
    if (run.shell) { if (run.label) try { run.label(shellLabel(p)); } catch (e) { console.warn(e); } return; }
    const el = ensurePlate(), q = c => el.querySelector(c);
    const write = () => {
      q('.wxs-name').textContent = p.place;
      q('.wxs-sub').textContent = p.sub;
      q('.wxs-sub').hidden = !p.sub;
      q('.wxs-icon').innerHTML = ICONS[p.icon] || '';
      q('.wxs-temp b').textContent = p.temp.main;
      q('.wxs-temp i').textContent = p.temp.unit;
      q('.wxs-temp small').textContent = p.temp.alt;
      q('.wxs-cond').textContent = p.cond;
      q('.wxs-wx').hidden = p.temp.main === '–' && !p.cond;
    };
    q('.wxs-time').textContent = p.time;
    q('.wxs-tz').textContent = p.tzAbbr;
    q('.wxs-date').textContent = p.date;
    q('.wxs-lapse').textContent = p.lapse;
    if (cut && run.plateName !== p.place) {
      run.plateName = p.place;
      el.classList.add('swap');
      clearTimeout(run.swapT);
      run.swapT = setTimeout(() => { write(); el.classList.remove('swap'); }, 380);
    } else if (!el.classList.contains('swap')) write();
  }

  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
    if (run && run.shell) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); saver.toggle(); }
    else if (run && e.key === 'Escape') { e.preventDefault(); saver.exit(); }
  }
  function onPointer(e) {
    if (!run || run.shell || performance.now() - run.at < 600) return;
    e.preventDefault(); e.stopPropagation();
    saver.exit();
  }
  function onMove() {
    if (!run || run.shell || !exitEl) return;
    exitEl.hidden = false; exitEl.classList.add('on');
    clearTimeout(run.hintT);
    run.hintT = setTimeout(() => exitEl && exitEl.classList.remove('on'), 1800);
  }
  function onFullscreen() { if (run && !run.shell && run.wentFull && !doc.fullscreenElement) saver.exit(); }

  addEventListener('keydown', onKey);

  const saver = {
    get active() { return !!run; },
    get shell() { return !!(run && run.shell); },
    enter(opts = {}) {
      if (run) saver.exit();
      const shell = typeof opts.label === 'function' || !!opts.shell;
      const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
      run = {
        shell, label: typeof opts.label === 'function' ? opts.label : null, calm: clamp(opts.calm ?? 0.7, 0, 1), seed,
        list: null, i: -1, shot: null, shots: 0, lapse: 0, at: performance.now(), lastBand: null,
        saved: { cam: { ...app.cam }, t: app.t, playing: app.playing, layers: { ...app.layers } },
      };
      if (director && director.stop) director.stop();
      app.saver = true;
      app.playing = false;
      if (app.layers) Object.assign(app.layers, { labels: true, fronts: true, clouds: true });
      root.classList.add(shell ? 'sn-saver' : 'wx-saver');
      if (!shell) {
        const el = ensurePlate();
        el.hidden = false; el.classList.remove('swap');
        requestAnimationFrame(() => el.classList.add('on'));
        if (doc.fullscreenEnabled && !doc.fullscreenElement && root.requestFullscreen) {
          root.requestFullscreen().then(() => { if (run) run.wentFull = true; }).catch(() => {});
        }
        addEventListener('pointerdown', onPointer, true);
        addEventListener('pointermove', onMove);
        doc.addEventListener('fullscreenchange', onFullscreen);
      }
      run.plateTimer = setInterval(() => plate(false), shell ? 1000 : 250);
      resize();
      // the first shot starts on the next tick, after the layout settles
      if (typeof ctx.onEnter === 'function') try { ctx.onEnter(run); } catch (e) { console.warn(e); }
      return { canvas: ctx.canvas, warmupMs: 1800 };
    },
    exit() {
      if (!run) return;
      const r = run;
      run = null;
      clearInterval(r.plateTimer); clearTimeout(r.swapT); clearTimeout(r.hintT);
      root.classList.remove('sn-saver', 'wx-saver');
      removeEventListener('pointerdown', onPointer, true);
      removeEventListener('pointermove', onMove);
      doc.removeEventListener('fullscreenchange', onFullscreen);
      if (plateEl) { plateEl.classList.remove('on', 'swap'); plateEl.hidden = true; }
      if (exitEl) { exitEl.classList.remove('on'); exitEl.hidden = true; }
      if (r.label) try { r.label(null); } catch { /* shell gone */ }
      if (r.wentFull && doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
      Object.assign(app.cam, r.saved.cam);
      app.t = r.saved.t; app.playing = r.saved.playing;
      if (app.layers) Object.assign(app.layers, r.saved.layers);
      app.saver = false;
      if (director && director.setCam) director.setCam(app.cam);
      resize();
      if (typeof ctx.onExit === 'function') try { ctx.onExit(); } catch (e) { console.warn(e); }
    },
    toggle() { if (run) saver.exit(); else saver.enter({}); },
    tick,
    // the next shot of a kind ('national' | 'region' | 'city' | 'front')
    cut(kind) {
      if (!run) return false;
      if (!run.list) newList();
      const j = run.list.findIndex((s, k) => k > run.i && (!kind || s.kind === kind));
      if (j < 0) return false;
      run.i = j - 1; nextShot();
      return true;
    },
    debug() {
      if (!run) return null;
      const s = run.shot;
      const v = view();
      let inBand = null;
      if (s && s.spec.points) {
        const m = viewProj(app.cam, v.w, v.h);
        inBand = s.spec.points.every(p => { const q = project(m, p.lat, p.lon); return q.visible && q.y >= v.inset.t && q.y <= v.h - v.inset.b; });
      }
      return { shell: run.shell, seed: run.seed, i: run.i, n: run.list ? run.list.length : 0, shots: run.shots, kind: s && s.spec.kind, id: s && s.spec.id, flying: !!(s && s.u < 1), hold: s ? +s.hold.toFixed(2) : 0, lapse: +run.lapse.toFixed(2), cam: { ...app.cam }, band: v.inset, inBand, plate: run.plate };
    },
  };

  globalThis.snSaver = {
    enter: opts => saver.enter(opts),
    exit: () => saver.exit(),
    cut: kind => saver.cut(kind),
    debug: () => saver.debug(),
  };
  return saver;
}
