// ============================================================================
//  STORM GLOBE  ·  saver.js  ·  window.snSaver, the screensaver tour
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts), opts = { calm,
//  seconds, caption, seed, label }. enter hides the GUI (html.sn-saver),
//  then plays shots in a seeded shuffle (a new order each run). A shot
//  holds 9-17 s after the camera lands (calm makes it longer). Two shots
//  within NEAR_DEG of each other are joined by an eased great-circle
//  flight (camera.js FLY limits its angular speed and acceleration);
//  others by a fade through black (the globe and the overlays both fade,
//  so a recording has the fade).
//
//  Camera: every shot frames a ground radius (SHOT_KM) on the narrow side
//  of the plate's clear band, never below the automatic floor
//  (main.js frameAltFor, camera.js MIN_R_KM), so a portrait phone gets
//  more altitude. Turns and drifts are in degrees per second (not per
//  frame); a storm is followed through the critically damped spring of
//  main.js followStop; the eye shot pushes in by one smootherstep from
//  1.18x to 1x of its altitude over the hold. The altitude reads the
//  band at least half the view high (main.js clearArea): the subject
//  sits in the band, and its surroundings may run on under the plate.
//  The band is held for a shot (frameBand), so the view offset moves
//  only between shots.
//
//  Shots:
//    eye     a storm: the camera comes down over it and circles the eye
//            while the magma flow spirals in (time plays at 1 h/s)
//    track   a storm's track as a time-lapse: from 24 h before to the end
//            of the forecast at 8 h/s, the camera following the centre
//    wide    the global circulation from far out, slowly turning
//    vort    the same at mid range in the vorticity colours
//    low     a deep extratropical low (GFS) in pressure with isobars
//    event   a NASA EONET event (a volcano, a fire, a flood, ...)
//  With no active storms the list is lows, wind maxima and events.
//  The globe is framed in the clear band of the label plate (plateBand).
//  The plate names the subject with its numbers and the data time. It
//  shows no code: the user wants the storms alone on the plate.
//
//  snSaver.debug() returns the director state for CDP checks;
//  snSaver.cut(kind) starts the next shot of that kind (CDP probes).
//
//  grep -n targets: "const KINDS", "const shotFor", "const plate",
//                   "const frameBand", "SHOT_KM", "NEAR_DEG"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { KT } from './sources.js';

// SHOT_KM: the ground radius each shot frames on the narrow side of the
// clear band; NEAR_DEG: a flight joins two shots closer than this
const SHOT_KM = { eye: 1000, track: 1600, low: 1700, event: 1100, vort: 2400 };
const NEAR_DEG = 100;

export function installSaver(SG) {
  const ST = SG.ST, CAM = SG.CAM, TL = SG.TL;
  let run = null;

  window.snSaver = {
    enter(opts = {}) {
      if (run) this.exit();
      const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7));
      let seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
      const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      const label = typeof opts.label === 'function' ? opts.label : null;
      SG.stopTour();
      const saved = { cam: { ...ST.cam }, t: ST.t, playing: ST.playing, speed: ST.speed, field: ST.field, layers: { ...ST.layers }, sel: ST.sel };
      ST.saver = true;
      document.documentElement.classList.add('sn-saver');
      ST.layers.labels = false; ST.layers.particles = true; ST.layers.tracks = true; ST.layers.cones = true;
      SG.setPlaying(false);

      // the shot list: every storm twice (eye and track), lows, events, wide views
      const storms = ST.stops.filter(o => o.kind === 'storm'), lows = ST.stops.filter(o => o.kind === 'low' || o.kind === 'jet');
      const events = ST.stops.filter(o => o.kind === 'event').slice(0, 5);
      const KINDS = [];
      for (const o of storms) KINDS.push({ kind: 'eye', o }, { kind: 'track', o });
      for (const o of lows.slice(0, 3)) KINDS.push({ kind: o.kind === 'low' ? 'low' : 'vort', o });
      for (const o of events.slice(0, storms.length ? 2 : 5)) KINDS.push({ kind: 'event', o });
      KINDS.push({ kind: 'wide', o: null }, { kind: 'wide', o: null });
      if (!storms.length) KINDS.push({ kind: 'vort', o: null });
      shuffle(KINDS);
      const hold = () => (9 + 5 * calm + rnd() * 3) * 1000;
      run = { KINDS, i: -1, shot: null, t0: 0, fading: 0, fadeT0: 0, next: null, saved, label, calm, band: null, bandAt: -1e9, shots: 0 };

      const frameBand = () => {
        const now = performance.now();
        // keep the last band while the plate cross-fades (plateBand is
        // null then), so the subject does not jump to the full frame
        // the band holds for the whole shot: it only grows its covers (a
        // longer plate text), so the view offset does not wander while
        // the plate text changes; begin() clears it for the next shot
        if (now - run.bandAt > 250) {
          run.bandAt = now; const pb = plateBand(innerHeight), ob = run.band;
          if (pb) run.band = !ob || run.bandShot !== run.shots ? pb : { t: Math.max(ob.t, pb.t), b: Math.max(ob.b, pb.b), w: Math.min(ob.w, pb.w) };
          if (pb && now - run.t0 > 150) run.bandFresh = true;
          run.bandShot = run.shots;
        }
        const b = run.band, W = innerWidth, Hh = innerHeight;
        const top = b ? b.t : 0, bot = b ? b.b : 0;
        const w = b ? Math.min(W, b.w) : W, l = (W - w) / 2;
        ST.viewOverride = { l, r: l + w, t: top, b: Math.max(top + 0.3 * Hh, Hh - bot) };
        return (ST.viewOverride.b - ST.viewOverride.t) / Hh;
      };
      // the live refresh rebuilds ST.stops (new storm records, new
      // forecasts): read a stop through its id, so the camera follows the
      // storm the globe draws, not the record the shot list was made from
      const cur = o => (o && ST.stops.find(q => q.id === o.id)) || o;
      const posOf = o => o ? SG.stopPos(cur(o)) : null;
      const altFor = kind => SG.frameAltFor(SHOT_KM[kind]);

      // shotFor: the camera, time and colour of one shot
      const shotFor = k => {
        const fill = frameBand(), o = cur(k.o);
        const s = { kind: k.kind, o, dur: hold(), field: 0, speed: 1, play: true, title: '', follow: !!(o && o.kind === 'storm') };
        // spin, drift: degrees per second; the time of the shot is set in
        // begin(), and the camera position is taken again there
        if (k.kind === 'eye') {
          const p = posOf(o), alt = altFor('eye');
          s.cam = { lat: p.lat, lon: p.lon, alt: alt * 1.18, tilt: 34 + rnd() * 12, heading: rnd() * 360 };
          s.altA = alt * 1.18; s.altB = alt;
          s.spin = (rnd() < 0.5 ? -1 : 1) * (2.2 + 1.5 * (1 - calm));
          s.t12 = rnd();
          s.title = SG.stopTitle(o);
        } else if (k.kind === 'track') {
          const path = o.s._path || TL.stormPath(o.s);
          s.tStart = Math.max(ST.t0, Math.min(path[0].t, ST.dataTime - 24 * 3600e3));
          s.tEnd = Math.min(ST.t1, path[path.length - 1].t);
          s.speed = Math.max(3, (s.tEnd - s.tStart) / 3600e3 / (s.dur / 1000));
          const p = SG.stopPos(o, s.tStart);
          s.cam = { lat: p.lat, lon: p.lon, alt: altFor('track'), tilt: 18 + 12 * rnd(), heading: 0 };
          s.title = SG.stopTitle(o) + ', track';
        } else if (k.kind === 'wide') {
          const lat = (rnd() - 0.5) * 50, lon = rnd() * 360 - 180;
          s.cam = { lat, lon, alt: SG.wideAlt(fill * 0.9), tilt: 0, heading: 0 };
          s.drift = (rnd() < 0.5 ? -1 : 1) * (2 + 1.5 * (1 - calm));
          s.title = 'The global circulation';
          s.field = rnd() < 0.3 ? 1 : 0; s.follow = false;
        } else if (k.kind === 'vort') {
          const p = o ? posOf(o) : { lat: 45 * (rnd() < 0.5 ? -1 : 1), lon: rnd() * 360 - 180 };
          s.cam = { lat: p.lat, lon: p.lon, alt: Math.max(0.9, altFor('vort')), tilt: 12, heading: 0 };
          s.field = 1; s.drift = 1.5; s.title = o ? SG.stopTitle(o) : 'Vortices of the westerlies';
        } else if (k.kind === 'low') {
          const p = posOf(o);
          s.cam = { lat: p.lat, lon: p.lon, alt: altFor('low'), tilt: 22 + 10 * rnd(), heading: rnd() * 40 - 20 };
          s.field = 2; s.spin = 1.5; s.title = SG.stopTitle(o);
        } else {
          const p = posOf(o);
          s.cam = { lat: p.lat, lon: p.lon, alt: altFor('event'), tilt: 26 + 12 * rnd(), heading: rnd() * 360 };
          s.spin = 2; s.title = SG.stopTitle(o);
        }
        return s;
      };
      const begin = (s, viaFlight) => {
        run.shot = s; run.t0 = performance.now(); run.shots++; run.fol = null; run.bandFresh = false;
        ST.field = s.field; SG.buildLegend();
        ST.speed = s.speed;
        // track: its own start; the others: near data time (eye shots up to
        // 12 h either side, inside the storm's life)
        if (s.kind === 'track') SG.setTime(s.tStart);
        else if (s.kind === 'eye') { const p = s.o.s._path || TL.stormPath(s.o.s); SG.setTime(Math.max(p[0].t, Math.min(p[p.length - 1].t - 3 * 3600e3, ST.dataTime + (s.t12 - 0.5) * 24 * 3600e3))); }
        else SG.setTime(ST.dataTime);
        // the subject where it is at the shot's own time
        if (s.o && s.kind !== 'track') { const p = posOf(s.o); s.cam.lat = p.lat; s.cam.lon = p.lon; }
        SG.setPlaying(s.play);
        if (s.o) SG.select(s.o.id, false); else SG.select(null);
        s.flyDur = 0;
        if (viaFlight) { s.flyDur = SG.flyTo(s.cam, 0, 3) * 1000; s.dur += s.flyDur; }
        else { ST.fly = null; Object.assign(ST.cam, s.cam); }
        plate();
      };
      const next = (force = false) => {
        run.i = (run.i + 1) % run.KINDS.length;
        const s = shotFor(run.KINDS[run.i]);
        const near = !force && run.shot && CAM.arc(ST.cam, s.cam) < NEAR_DEG * Math.PI / 180 && s.kind !== 'track';
        if (near) begin(s, true);
        else { run.next = s; run.fading = 1; run.fadeT0 = performance.now(); }
      };

      // per-frame director (main.js frame calls SG.saverTick)
      SG.saverTick = now => {
        if (!run) return;
        frameBand();
        if (run.fading) {
          const k = (now - run.fadeT0) / 650;
          if (run.fading === 1) { ST.fade = Math.max(0, 1 - k); if (k >= 1) { begin(run.next, false); run.next = null; run.fading = 2; run.fadeT0 = now; } }
          // at black, wait (up to 0.9 s) for the new plate band, then put
          // the view offset on it at once and fade in
          else if (!run.bandFresh && now - run.t0 < 900) { ST.fade = 0; run.fadeT0 = now; }
          else { if (k < 0.05) { frameBand(); SG.snapOffset(); } ST.fade = Math.min(1, k); if (k >= 1) { run.fading = 0; ST.fade = 1; } }
        }
        const s = run.shot; if (!s) return;
        const e = (now - run.t0) / 1000, dt = SG.frameDt;
        if (!ST.fly) {
          if (s.spin) ST.cam.heading += s.spin * dt;
          if (s.drift) ST.cam.lon = ((ST.cam.lon + s.drift * dt + 540) % 360) - 180;
          if (s.follow && s.o) SG.followStop(cur(s.o), run);
          if (s.kind === 'eye') { const k = Math.max(0, (e * 1000 - s.flyDur) / Math.max(1, s.dur - s.flyDur)); ST.cam.alt = s.altA + (s.altB - s.altA) * CAM.ease(k); }
        }
        if (s.kind === 'track' && ST.t >= s.tEnd) SG.setPlaying(false);
        if (e * 1000 > s.dur && !run.fading) next();
      };
      const plate = () => {
        if (!label || !run || !run.shot) return;
        const s = run.shot, o = cur(s.o), lines = [], params = [];
        const p = o ? SG.stopPos(o) : null;
        if (o && o.kind === 'storm') {
          const st = p.st, kt = st ? st.vmax : o.s.vmax;
          params.push({ sym: 'v_{max}', name: 'max wind', value: `${Math.round(kt)} kt · ${Math.round(kt * KT * 3.6)} km/h`, cls: 'm2' });
          const pm = st && st.pmin != null ? st.pmin : o.s.pmin;
          if (pm) params.push({ sym: 'p_c', name: 'pressure', value: Math.round(pm) + ' hPa', cls: 'm1' });
          params.push({ sym: '\\text{cat}', name: 'Saffir-Simpson', value: SG.catLabel(kt), cls: 'm5' });
          lines.push(`${o.s.basin} · ${o.s.source} · ${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`);
          if (st && st.dir != null) lines.push(`moving ${Math.round(st.dir)}° at ${Math.round(st.spdKt)} kt${st.fc ? ' (forecast)' : ''}`);
        } else if (o && o.kind === 'low') {
          params.push({ sym: 'p', name: 'central pressure', value: Math.round(o.l.hpa) + ' hPa', cls: 'm1' });
          params.push({ sym: 'v', name: 'wind nearby', value: Math.round(o.l.wind) + ' m/s', cls: 'm2' });
          lines.push('A deep low in the GFS sea-level pressure; isobars every 4 hPa');
        } else if (o && o.kind === 'jet') {
          params.push({ sym: 'v', name: '10 m wind', value: Math.round(o.l.wind) + ' m/s', cls: 'm2' });
        } else if (o && o.kind === 'event') {
          lines.push(`${o.e.catTitle} · NASA EONET · ${new Date(o.e.t).toISOString().slice(0, 10)}`);
          if (o.e.mag) params.push({ sym: 'A', name: o.e.unit || 'size', value: Math.round(o.e.mag).toLocaleString('en'), cls: 'm5' });
        } else {
          lines.push(ST.field === 1 ? 'Colour: cyclonic (warm) and anticyclonic (blue) vorticity' : 'Colour: 10 m wind speed on the magma scale');
        }
        params.push({ sym: 't', name: 'time', value: TL.relLabel(ST.t, ST.dataTime), cls: 'm6' });
        lines.push(`Winds: NOAA GFS ${TL.fmtTime(ST.dataTime)}${SG.snap.meta.sample ? ' (sample data)' : ''}; solver ${SG.solver.nx}×${SG.solver.ny} on the sphere`);
        label({
          title: s.title,
          sub: TL.fmtTime(ST.t) + (ST.t > ST.dataTime + 60e3 ? ' · forecast' : ' · observed'),
          params, lines,
          anchor: () => { const v = ST.viewOverride; return v ? { x: (v.l + v.r) / 2, y: (v.t + v.b) / 2, r: (v.b - v.t) * 0.35 } : null; },
        });
      };
      run.plateTimer = setInterval(plate, 1000);
      ST.fade = 0;
      next();
      if (!run.shot && run.next) { begin(run.next, false); run.next = null; run.fading = 2; run.fadeT0 = performance.now(); }
      this.cut = kind => {
        if (!run) return false;
        const j = run.KINDS.findIndex(k => k.kind === kind);
        if (j < 0) return false;
        run.i = j - 1; run.fading = 0; ST.fade = 1; next(true);
        return true;
      };
      this.debug = () => run && {
        shot: run.shot && run.shot.kind, title: run.shot && run.shot.title, i: run.i, n: run.KINDS.length, shots: run.shots,
        order: run.KINDS.map(k => k.kind + (k.o ? ':' + k.o.id : '')),
        held: +((performance.now() - run.t0) / 1000).toFixed(1), dur: run.shot && +(run.shot.dur / 1000).toFixed(1),
        cam: { lat: +ST.cam.lat.toFixed(2), lon: +ST.cam.lon.toFixed(2), alt: +ST.cam.alt.toFixed(3), tilt: +ST.cam.tilt.toFixed(1), heading: +ST.cam.heading.toFixed(1) },
        kinds: [...new Set(run.KINDS.map(k => k.kind))],
        flying: !!ST.fly, fade: +ST.fade.toFixed(2), field: ST.field, t: new Date(ST.t).toISOString(), band: ST.viewOverride,
      };
      return { canvas: SG.canvas(), warmupMs: 1200 };
    },
    exit() {
      if (!run) return;
      clearInterval(run.plateTimer);
      const s = run.saved;
      document.documentElement.classList.remove('sn-saver');
      ST.saver = false; ST.viewOverride = null; ST.fade = 1; ST.fly = null;
      Object.assign(ST.cam, s.cam); Object.assign(ST.layers, s.layers);
      ST.field = s.field; ST.speed = s.speed; SG.buildLegend();
      SG.setTime(s.t); SG.setPlaying(s.playing); SG.select(s.sel);
      SG.saverTick = null;
      run.label && run.label(null);
      run = null;
    },
  };
}
