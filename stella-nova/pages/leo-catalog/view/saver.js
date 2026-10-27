// ============================================================================
//  LEO CATALOG  ·  view/saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  enter() hides every DOM element except canvas#scene: panels, chip,
//  reticle, splash and the city, station and sat labels. The clear colour
//  becomes opaque black, because the canvas has alpha over the page
//  background. The hook waits for boot (startXR sets __leoXR), then turns
//  on a slow autoRotate and sets SIM.speed to 240x (calm 0) .. 60x (calm 1),
//  so the orbits sweep and the terminator moves. A tour eases the camera
//  with flyTo between four views (distance and latitude), about three per
//  dwell, each move 7 s long. opts.seed sets the view order. Each move also
//  puts one object in focus (its orbit drawn) and names it on the label plate
//  with its TLE elements. The hook makes
//  no network request: the catalog comes from the boot snapshot. No exit():
//  the shell reloads the page on stop.
//
//  installSaver(ctx) sets window.snSaver. ctx is the page state:
//    renderer, camera, controls, canvas, OVERLAY, SIM, sats(), positions(),
//    satPoints(), selectedIdx(), select(idx), chipLocked(), unlockChip(),
//    flyTo(pos, lookAt, ms), applyRate(frac)
//
//  grep -n targets: "export function installSaver", "const VIEWS",
//  "const focusSat", "const pickFocus", "const plate", "const orbitAnchor", "const focus",
//  "const tour", "const ready"
// ============================================================================
import * as THREE from 'three';
import { fmt, fmtRate, rateSpeedToFrac } from '../core/format.js';
import { EARTH_R_KM, MU, orbitalElements } from '../core/tle.js';
import { hideCityLabels } from './labels.js';
import { maybeRebuildTrail } from './trails.js';

export function installSaver(ctx) {
  const { renderer, camera, controls, canvas, OVERLAY, SIM } = ctx;
  window.snSaver = { enter(opts) {
    const calm = Math.max(0, Math.min(1, opts && opts.calm != null ? +opts.calm : 0.7));
    const secs = Math.max(20, +(opts && opts.seconds) || 60);
    let seed = ((opts && opts.seed) | 0) >>> 0;
    const st = document.createElement('style');
    st.textContent = 'body>*:not(#scene){display:none!important}canvas#scene{cursor:none}';
    document.head.appendChild(st);
    renderer.setClearColor(0x000000, 1);
    OVERLAY.cities = false; OVERLAY.satlabels = false;
    const VIEWS = [            // radius (scene units, Earth = 1), polar angle
      { r: 3.4, phi: 1.42 }, { r: 2.3, phi: 0.95 }, { r: 2.7, phi: 2.05 }, { r: 4.6, phi: 0.55 },
    ];
    let vi = seed % VIEWS.length;
    // The plate (opts.label) names one object in focus and its TLE elements.
    // Each tour move picks the next class in FOCUS_CATS and a seeded object of
    // that class from the loaded snapshot. selectedIdx (with no chip lock)
    // makes propagateAll() draw the glyph larger and maybeRebuildTrail() draw
    // one orbit of it. The elements come from orbitalElements() and the
    // satrec: a = (μ/n²)^(1/3), T = 2π/n, apogee and perigee a(1 ± e) − R⊕.
    // The live lines come from satellite.propagate() at SIM.time.
    const label = opts && opts.labels !== false && typeof opts.label === 'function' ? opts.label : null;
    const FOCUS_CATS = ['station', 'payload', 'starlink', 'rocket', 'debris'];
    const CAT_NAME = { station: 'crewed station', payload: 'payload', starlink: 'Starlink', rocket: 'rocket body', debris: 'debris' };
    let fi = seed % FOCUS_CATS.length;
    const D = 180 / Math.PI;
    // The record in focus, or null when there is none or it has no satrec.
    const focusSat = () => {
      const sats = ctx.sats(), i = ctx.selectedIdx();
      return i >= 0 && sats[i] && sats[i].satrec ? sats[i] : null;
    };
    const pickFocus = () => {
      const sats = ctx.sats();
      for (let k = 0; k < FOCUS_CATS.length; k++) {
        const cat = FOCUS_CATS[(fi + k) % FOCUS_CATS.length], pool = [];
        for (let i = 0; i < sats.length; i++) if (sats[i].cat === cat && sats[i].satrec && !sats[i]._isStorm) pool.push(i);
        if (!pool.length) continue;
        fi = (fi + k + 1) % FOCUS_CATS.length;
        seed = (seed * 1103515245 + 12345) >>> 0;
        // A station dwell shows the ISS first when the snapshot has it.
        const iss = cat === 'station' ? pool.find(i => sats[i].noradId === 25544) : undefined;
        return iss !== undefined ? iss : pool[seed % pool.length];
      }
      return -1;
    };
    const plate = () => {
      const s = focusSat();
      if (!label || !s) return;
      const r = s.satrec, oe = orbitalElements(r);
      const a = oe.apogee / 2 + oe.perigee / 2 + EARTH_R_KM;
      const yr = r.epochyr < 57 ? 2000 + r.epochyr : 1900 + r.epochyr;
      const ep = new Date(Date.UTC(yr, 0, 1) + (r.epochdays - 1) * 86400000);
      const pv = satellite.propagate(r, SIM.time);
      let live = 'SGP4 has no solution at this time.', alt = '—';
      if (pv.position) {
        const geo = satellite.eciToGeodetic(pv.position, satellite.gstime(SIM.time));
        const v = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : NaN;
        alt = fmt(geo.height, 0) + ' km';
        live = 'Now: lat ' + fmt(geo.latitude * D, 1) + '°, lon ' + fmt(geo.longitude * D, 1) + '°, |v| ' + fmt(v, 2) + ' km/s';
      }
      const nObj = ctx.sats().reduce((c, q) => c + (q.satrec ? 1 : 0), 0);
      // params, new TeX for the element formulas (the page has no TeX or math
      // colour classes, so no rules), and the plain eq fallback.
      label({
        title: s.name,
        sub: 'NORAD ' + s.noradId + ', ' + CAT_NAME[s.cat] + ', TLE epoch ' + ep.toISOString().slice(0, 10),
        params: [
          { sym: 'h', name: 'altitude now', value: alt },
          { sym: 'a', name: 'semi-major axis', value: fmt(a, 0) + ' km' },
          { sym: 'e', name: 'eccentricity', value: r.ecco.toFixed(5) },
          { sym: 'i', name: 'inclination', value: fmt(oe.incDeg, 2) + '°' },
          { sym: 'T', name: 'period', value: fmt(oe.periodMin, 1) + ' min' },
        ],
        lines: [live,
          'Sim ' + SIM.time.toISOString().slice(0, 16).replace('T', ' ') + ' UTC, ' + fmtRate(SIM.speed) + ', ' + nObj.toLocaleString() + ' objects'],
        tex: ['n = \\frac{2\\pi}{T}, \\qquad a = \\left(\\frac{\\mu}{n^2}\\right)^{1/3}',
          'r_{\\text{apo}},\\ r_{\\text{peri}} = a\\,(1 \\pm e) - R_\\oplus',
          '\\text{TLE} \\xrightarrow{\\text{SGP4}} (\\vec r, \\vec v)_{\\text{ECI}} \\to \\text{ECEF at GMST}'],
        eq: ['n = 2π / T,   a = (μ / n²)^1/3',
             'r_apo, r_peri = a (1 ± e) − R⊕',
             'TLE → SGP4 → r, v (ECI) → ECEF at GMST'],
        anchor: orbitAnchor,
      });
    };
    // The orbit in focus on screen, for the shell's label plate. Earth (radius
    // 1 in scene units) sits at the origin, and the orbit lies inside the
    // sphere of radius a (1 + e) / R_earth. The centre is the projected
    // origin; the radius is that sphere's silhouette, fpx tan(asin(R / d)),
    // with d the camera distance. The key point is the object itself, from
    // the positions buffer that propagateAll() fills (satPoints space). When
    // the camera is inside that sphere, the anchor is the object alone.
    const _ov = new THREE.Vector3();
    const orbitAnchor = () => {
      const s = focusSat();
      if (!s) return null;
      const rr = s.satrec, R = Math.pow(MU / Math.pow(rr.no / 60, 2), 1 / 3) * (1 + rr.ecco) / EARTH_R_KM;
      const b = renderer.domElement.getBoundingClientRect(), d = camera.position.length();
      const P = v => { v.project(camera); return v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1 ? null : { x: b.left + (v.x + 1) / 2 * b.width, y: b.top + (1 - v.y) / 2 * b.height }; };
      const pts = [];
      const k = ctx.selectedIdx() * 3, positions = ctx.positions(), satPoints = ctx.satPoints();
      if (positions && Math.abs(positions[k]) < 1e3) {
        satPoints.updateMatrixWorld();
        const q = P(_ov.set(positions[k], positions[k + 1], positions[k + 2]).applyMatrix4(satPoints.matrixWorld));
        if (q) pts.push(q);
      }
      // A high orbit (GEO, Molniya) holds the camera: anchor on the object.
      if (d <= R * 1.02) return pts.length ? { x: pts[0].x, y: pts[0].y, r: 14, pts } : null;
      const c = P(_ov.set(0, 0, 0));
      if (!c) return null;
      const fpx = (b.height / 2) / Math.tan(camera.fov * Math.PI / 360);
      return { x: c.x, y: c.y, r: fpx * Math.tan(Math.asin(R / d)), pts: pts.length ? pts : [c] };
    };
    const focus = () => {
      const idx = pickFocus();
      if (idx < 0) return;
      ctx.select(idx);
      maybeRebuildTrail();
      plate();
    };
    const tour = () => {
      if (ctx.chipLocked()) ctx.unlockChip();
      focus();
      vi = (vi + 1 + (seed = (seed * 1103515245 + 12345) >>> 0) % 2) % VIEWS.length;
      const sph = new THREE.Spherical().setFromVector3(camera.position);
      const to = new THREE.Vector3().setFromSpherical(new THREE.Spherical(VIEWS[vi].r, VIEWS[vi].phi, sph.theta + 0.6));
      ctx.flyTo(to, new THREE.Vector3(0, 0, 0), 7000);
    };
    return new Promise(res => {
      const t0 = performance.now();
      const ready = () => {
        if (!window.__leoXR && performance.now() - t0 < 20000) { setTimeout(ready, 250); return; }
        hideCityLabels();
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.8 * (1 - 0.6 * calm);
        SIM.playing = true;
        ctx.applyRate(rateSpeedToFrac(240 - 180 * calm));
        setInterval(tour, Math.max(12, secs / 3) * 1000);
        focus();
        if (label) setInterval(plate, 1000);
        res({ canvas, warmupMs: 2500 });
      };
      ready();
    });
  } };
}
