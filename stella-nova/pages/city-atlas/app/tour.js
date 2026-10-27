// ============================================================================
//  TOUR  ·  city-atlas/app/tour.js — the screensaver shots and plate content
// ----------------------------------------------------------------------------
//  The seeded parts of the screensaver tour (app/saver.js runs it): the rng,
//  the shuffle, one shot (city, orbit, light and overlays) and the content
//  of the label plate (title, numbers, lines, TeX). CODE names the shader
//  extract that the plate shows for each primary overlay. tests.mjs checks
//  that the buildings.wgsl anchor of CODE.none is in the shader. No DOM.
//
//  grep -n targets
//    seeded rng ........... "export function mulberry32"
//    shuffle .............. "export function shuffle"
//    one shot ............. "export function saverShot"
//    shader extracts ...... "export const CODE"
//    extract lines ........ "export function extract"
//    plate content ........ "export function plateOf"
// ============================================================================

import { fmt, compass, stamp, latLon, KNOTS } from './text.js';
import { currentSource } from './sources.js';

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(a, r) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// One shot of city c (index i): orbit, light and overlays, all from rng r.
// A shot lasts 8 to 15 s; calm (0..1) makes it longer and the orbit slower.
export function saverShot(r, c, i, calm) {
  const lights = [['golden', 0.36], ['dusk', 0.28], ['day', 0.2], ['night', 0.16]];
  let x = r(), light = 'golden';
  for (const [k, w] of lights) { if ((x -= w) <= 0) { light = k; break; } }
  const has = !!c.current;
  // primary overlay: terrain, currents, wind or none; terrain often rides along
  const pick = r();
  let primary = pick < 0.3 ? 'terrain' : pick < 0.62 && has ? 'ocean' : pick < 0.88 ? 'wind' : 'none';
  if (primary === 'ocean' && !has) primary = 'terrain';
  return {
    i, light, primary,
    terrain: primary === 'terrain' || r() < 0.45,
    exag: primary === 'terrain' ? 1.6 + r() * 1.4 : 1.25 + r() * 0.5,
    ocean: primary === 'ocean',
    wind: primary === 'wind',
    yaw0: r() * Math.PI * 2,
    yawRate: (r() < 0.5 ? -1 : 1) * (0.028 + r() * 0.02) / (1 + calm * 0.6),
    pitch: 0.34 + r() * 0.24,
    distK: 1.7 + r() * 0.9,
    seconds: (8 + r() * 4) * (1 + calm * 0.3),
    heat: r() < 0.2,
  };
}

// [shader file, first line, line count, caption] of the extract per primary overlay.
export const CODE = {
  wind: ['lbm.wgsl', 'let Q = pxx * pxx', 12, 'Smagorinsky BGK collision'],
  ocean: ['tracers.wgsl', 'fn stepOf(u: vec2f)', 10, 'current streak step'],
  terrain: ['terrain.wgsl', '  let w = waterAt(p);', 12, 'water over the sea floor'],
  none: ['buildings.wgsl', '  // lit windows after dusk', 13, 'lit windows after dusk'],
};

export function extract(src, from, lines) {
  const a = src.split('\n');
  const i = a.findIndex((l) => l.includes(from));
  return i < 0 ? '' : a.slice(i, i + lines).join('\n');
}

// The plate of shot sh over city meta m with overlay state ov at data hour h:
// { title, sub, params, lines, tex, rules } (app/saver.js adds the code).
export function plateOf(m, ov, sh, h) {
  const b = m.buildings;
  const params = [
    { sym: 'N', name: 'buildings', value: fmt(b.count) },
    { sym: 'h_{\\max}', name: 'tallest', value: `${fmt(b.tallest)} m` },
  ];
  if (ov.terrain.on) params.push({ sym: 'E', name: 'relief', value: `× ${fmt(ov.terrain.exag, 1)}` });
  if (ov.ocean.on && m.current) params.push({ sym: 'u_{\\max}', name: 'fastest water', value: `${fmt(m.curMax * KNOTS, 1)} kn`, cls: 'm1' });
  if (ov.wind.on) params.push({ sym: 'U', name: 'wind', value: `${fmt(ov.wind.speed, 1)} m/s from ${compass(ov.wind.dirFrom)}`, cls: 'm1' });
  const lines = [`${m.country}. ${latLon(m, 2)}.`];
  if (ov.ocean.on && m.current) lines.push(`Surface currents, ${stamp(m, h)}. ${currentSource(m).short}.`);
  if (ov.wind.on) lines.push('Wind: a simplified 2D lattice Boltzmann simulation around the buildings.');
  const tex = sh.primary === 'wind'
    ? [String.raw`f_q(\mathbf{x}+\mathbf{c}_q,t+1)=f_q-\frac{1}{\tau}\big(f_q-f_q^{\mathrm{eq}}(\rho,\mathbf{u})\big)`]
    : sh.primary === 'ocean' ? [String.raw`\mathbf{x}_{n+1}=\mathbf{x}_n+\Delta t\,\hat{\mathbf{u}}\big(\mathbf{x}_n+\tfrac{\Delta t}{2}\hat{\mathbf{u}}(\mathbf{x}_n)\big)`]
      : sh.primary === 'terrain' ? [String.raw`z=E\,h(x,y),\qquad h<0:\ \text{sea floor}`] : [];
  return {
    title: m.title,
    sub: `${m.region} · ${sh.primary === 'none' ? 'buildings' : sh.primary === 'ocean' ? 'ocean currents' : sh.primary}`,
    params, lines, tex, rules: [['\\mathbf{u}', 'm1'], ['\\hat{\\mathbf{u}}', 'm1']],
  };
}
