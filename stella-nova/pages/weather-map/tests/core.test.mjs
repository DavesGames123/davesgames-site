// WEATHER MAP · tests/core.test.mjs — package CORE: astro.js, camera.js,
// the pure parts of render/core.js and render/globe.js, the WGSL (naga on
// the module exactly as globe.js joins it), and the page shell.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { sunDir, subSolar, localParts, latLonToXYZ, xyzToLatLon, gmstRad } from '../astro.js';
import { camState, viewProj, project, pick, flight, flightSeconds, lerpCam, slerpLatLon, centralAngle, eyeFrame, mul, invert } from '../camera.js';
import { packFrame, frameSun, backingSize, qualityFor, FRAME_FLOATS } from '../render/core.js';
import { packGlobe, texPlan, GLOBE_SHADERS, MIP_WGSL, GLOBE_FLOATS, ATMO_EARTH } from '../render/globe.js';

const page = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, page), 'utf8');
const near = (a, b, e) => Math.abs(a - b) <= e;
const R2D = 180 / Math.PI;

export default function (ok) {
  // ── astro ──
  const dec = t => Math.asin(sunDir(t)[1]) * R2D;
  ok('astro: June solstice declination +23.44', near(dec(Date.UTC(2026, 5, 21, 8, 24)), 23.44, 0.05), dec(Date.UTC(2026, 5, 21, 8, 24)).toFixed(3));
  ok('astro: December solstice declination -23.44', near(dec(Date.UTC(2026, 11, 21, 20, 50)), -23.44, 0.05), dec(Date.UTC(2026, 11, 21, 20, 50)).toFixed(3));
  ok('astro: March equinox declination 0', near(dec(Date.UTC(2026, 2, 20, 14, 46)), 0, 0.05), dec(Date.UTC(2026, 2, 20, 14, 46)).toFixed(3));
  // equation of time: Feb 11 about -14.2 min (sun 3.55 deg east at 12:00 UTC), Nov 3 about +16.4 min
  const feb = subSolar(Date.UTC(2026, 1, 11, 12)), nov = subSolar(Date.UTC(2026, 10, 3, 12));
  ok('astro: sub-solar lon on Feb 11 12:00 UTC is +3.55 (EoT)', near(feb.lon, 3.55, 0.3), feb.lon.toFixed(2));
  ok('astro: sub-solar lon on Nov 3 12:00 UTC is -4.1 (EoT)', near(nov.lon, -4.1, 0.3), nov.lon.toFixed(2));
  const s = sunDir(Date.now());
  ok('astro: sunDir is a unit vector', near(Math.hypot(...s), 1, 1e-9));
  // the sun is overhead in the Pacific near 20:00 UTC (lon about -120)
  const pac = subSolar(Date.UTC(2026, 9, 15, 20));
  ok('astro: sub-solar point at 20:00 UTC is near lon -120', near(pac.lon, -120 - 3.5, 1.5), pac.lon.toFixed(2));
  ok('astro: gmst in [0, 2pi)', gmstRad(Date.now()) >= 0 && gmstRad(Date.now()) < 2 * Math.PI);
  const ll = xyzToLatLon(latLonToXYZ(40.7, -74.0));
  ok('astro: lat/lon -> xyz -> lat/lon', near(ll.lat, 40.7, 1e-9) && near(ll.lon, -74, 1e-9));
  const z = latLonToXYZ(0, 90);
  ok('astro: lon 90 E is -z (contract axes)', near(z[2], -1, 1e-12) && near(z[0], 0, 1e-12));
  const ny = localParts(Date.UTC(2026, 6, 4, 16, 5, 9), 'America/New_York');
  ok('astro: localParts New York 12:05:09 EDT', ny.h === 12 && ny.mi === 5 && ny.s === 9 && ny.d === 4 && ny.mo === 7 && ny.y === 2026 && ny.tzAbbr === 'EDT', JSON.stringify(ny));
  const hi = localParts(Date.UTC(2026, 0, 1, 3), 'Pacific/Honolulu');
  ok('astro: localParts Honolulu crosses the date', hi.d === 31 && hi.mo === 12 && hi.h === 17 && hi.weekday === 'Wed', JSON.stringify(hi));
  const bad = localParts(Date.UTC(2026, 0, 1, 3), 'Not/AZone');
  ok('astro: unknown zone falls back to UTC', bad.h === 3 && bad.tzAbbr === 'UTC', JSON.stringify(bad));
  const mid = localParts(Date.UTC(2026, 0, 1, 5), 'America/New_York');
  ok('astro: midnight is hour 0', mid.h === 0, JSON.stringify(mid));

  // ── camera ──
  const I = invert(mul(viewProj(camState(10, 20, 1)).proj, viewProj(camState(10, 20, 1)).view));
  ok('camera: invert', I.every(Number.isFinite));
  const W = 1280, H = 720;
  for (const cam of [camState(38.5, -97, 0.95, 0, 0), camState(40, -75, 0.3, 0.5, 0.4), camState(21, -157, 0.12, 0.9, -1.2), camState(64, -150, 2.5, 0, 0)]) {
    const m = viewProj(cam, W, H);
    const c = project(m, cam.lat, cam.lon);
    ok(`camera: target projects to the centre (tilt ${cam.tilt})`, near(c.x, W / 2, 1e-3 * W) && near(c.y, H / 2, 1e-3 * H) && c.visible, `${c.x.toFixed(2)},${c.y.toFixed(2)}`);
    const p0 = pick(m, W / 2, H / 2);
    ok(`camera: pick at the centre returns the target (tilt ${cam.tilt})`, p0 && near(p0.lat, cam.lat, 1e-3) && near(centralAngle(p0, cam), 0, 1e-4));
    let worst = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const x = (i % 20 + 0.5) / 20 * W, y = (Math.floor(i / 20) + 0.5) / 20 * H;
      const q = pick(m, x, y);
      if (!q) continue;
      const pr = project(m, q.lat, q.lon);
      if (!pr.visible) { worst = Infinity; continue; }
      worst = Math.max(worst, Math.hypot(pr.x - x, pr.y - y)); n++;
    }
    ok(`camera: pick -> project round trip (alt ${cam.alt})`, n > 50 && worst < 0.05, `${n} px, worst ${worst.toFixed(4)} px`);
    const anti = project(m, -cam.lat, cam.lon + 180);
    ok(`camera: antipode is hidden (alt ${cam.alt})`, !anti.visible);
    const dp = project(m, cam.lat, cam.lon, 1.0026);
    ok(`camera: overlay shell depth inside 0..1 and in front of the ground`, dp.depth > 0 && dp.depth < 1 && dp.depth < c.depth + 1e-6, `${dp.depth} ${c.depth}`);
  }
  const { eye, up } = eyeFrame(camState(0, 0, 1, 0, 0));
  ok('camera: tilt 0 heading 0 looks down with north up', near(eye[0], 2, 1e-12) && near(up[1], 1, 1e-12));
  const out = pick(viewProj(camState(0, 0, 3), W, H), 2, 2);
  ok('camera: pick off the globe is null', out === null);
  const A = camState(38.5, -97, 0.95, 0.3, 0), B = camState(21.3, -157.8, 0.15, 0.5, 0.2);
  const f = flight(A, B);
  const f0 = f(0), f1 = f(1), fm = f(0.5);
  ok('camera: flight starts at from', near(f0.lat, A.lat, 1e-9) && near(f0.lon, A.lon, 1e-9) && near(f0.alt, A.alt, 1e-9) && near(f0.tilt, A.tilt, 1e-9));
  ok('camera: flight ends at to', near(f1.lat, B.lat, 1e-9) && near(f1.lon, B.lon, 1e-9) && near(f1.alt, B.alt, 1e-9) && near(f1.heading, B.heading, 1e-9));
  ok('camera: long flight rises above both ends', fm.alt > Math.max(A.alt, B.alt), fm.alt.toFixed(3));
  let jump = 0, prev = f(0);
  for (let i = 1; i <= 200; i++) { const c = f(i / 200); jump = Math.max(jump, centralAngle(prev, c) * R2D, Math.abs(Math.log(c.alt / prev.alt))); prev = c; }
  ok('camera: flight is continuous', jump < 1.5, jump.toFixed(3));
  const short = flight(camState(40, -75, 0.35), camState(41, -73, 0.3));
  ok('camera: short hop does not climb', short(0.5).alt <= 0.36, short(0.5).alt.toFixed(3));
  const fs = flightSeconds(A, B);
  ok('camera: flightSeconds within 1.5..8', fs >= 1.5 && fs <= 8, fs.toFixed(2));
  const lc = lerpCam({ ...A, heading: 3.0 }, { ...A, heading: -3.0 }, 0.5);
  ok('camera: lerpCam turns the short way', Math.abs(Math.abs(lc.heading) - Math.PI) < 0.01, lc.heading.toFixed(3));
  const sl = slerpLatLon({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 0.5);
  ok('camera: slerp crosses the date line', near(Math.abs(sl.lon), 180, 1e-6));

  // ── core helpers ──
  ok('core: qualityFor', qualityFor({ coarse: true, minSide: 390 }) === 0 && qualityFor({ coarse: true, minSide: 820 }) === 1 && qualityFor({ coarse: false, minSide: 1080 }) === 2);
  const b1 = backingSize(3840, 2160, 2, 2), b2 = backingSize(390, 844, 3, 0), b3 = backingSize(1200, 800, 1, 2);
  ok('core: backing capped at 2560x1440', b1.w === 2560 && b1.h === 1440, JSON.stringify(b1));
  ok('core: phone dpr capped (1.5) and portrait', b2.w === 585 && b2.h === 1266, JSON.stringify(b2));
  ok('core: small desktop unchanged', b3.w === 1200 && b3.h === 800);
  const cam = camState(38.5, -97, 0.95, 0.3, 0);
  const m = viewProj(cam, 1200, 800);
  const fr = { m, sun: [0, 1, 0], time: 3, t: Date.UTC(2026, 9, 15, 18), now: Date.UTC(2026, 9, 15, 12), w: 2400, h: 1600, dpr: 2, quality: 2, exposure: 1.1, lightMode: 'day', cam, focus: null };
  const P = packFrame(fr);
  ok('core: packFrame size matches struct Frame (208 bytes)', P.length === FRAME_FLOATS && FRAME_FLOATS * 4 === 208);
  ok('core: packFrame layout', P[0] === m.viewProj[0] && P[16] === m.invViewProj[0] && near(P[32], m.eye[0], 1e-6) && P[35] === 3 && P[39] === 1 && P[40] === 2400 && P[43] === 2 && near(P[44], 1.1, 1e-6) && near(P[46], 38.5, 1e-5) && near(P[48], 6, 1e-6) && near(P[49], 18, 1e-6));
  const sr = frameSun({ lightMode: 'real', t: Date.UTC(2026, 5, 21) }, cam);
  ok('core: real light mode uses astro.sunDir', sr.every((v, i) => v === sunDir(Date.UTC(2026, 5, 21))[i]));
  const sd = frameSun({ lightMode: 'day' }, cam), tg = latLonToXYZ(cam.lat, cam.lon);
  ok('core: day light mode lights the camera target', sd[0] * tg[0] + sd[1] * tg[1] + sd[2] * tg[2] > 0.85);
  // CONUS corners are all lit in day mode
  const lit = [[49, -124], [49, -67], [25, -80], [32, -117]].every(([a, o]) => { const q = latLonToXYZ(a, o); return q[0] * sd[0] + q[1] * sd[1] + q[2] * sd[2] > 0.3; });
  ok('core: day light mode lights all of CONUS', lit);

  // ── globe helpers ──
  const G = packGlobe({ has: { day: true, detail: false, night: true, height: false, water: true, cloud: false }, detailB: { lat0: 15, lat1: 60, lon0: -170, lon1: -50 }, cloudB: null }, { quality: 1, t: 0, lightMode: 'real' });
  ok('globe: packGlobe size matches struct Globe (96 bytes)', G.length === GLOBE_FLOATS && GLOBE_FLOATS * 4 === 96);
  ok('globe: packGlobe flags and steps', G[8] === 1 && G[9] === 0 && G[12] === 1 && G[14] === 1 && G[19] === 16);
  ok('globe: atmosphere top is 1.0157 radii', near(1 + ATMO_EARTH.heightKm / ATMO_EARTH.radiusKm, 1.0157, 1e-4));
  const tp0 = texPlan(0), tp2 = texPlan(2, 8192);
  ok('globe: texPlan phone skips the 8k day map', tp0.dayHigh === null && tp0.night.maxW === 2048);
  ok('globe: texPlan desktop keeps 8k', tp2.dayHigh.maxW === 8192);

  // ── WGSL ──
  const naga = join(homedir(), '.cargo/bin/naga');
  const tmp = mkdtempSync(join(tmpdir(), 'wx-core-'));
  const joined = GLOBE_SHADERS.map(p => read(p)).join('\n');
  const files = { 'globe-module.wgsl': joined, 'mip.wgsl': MIP_WGSL, 'frame.wgsl': read('shaders/frame.wgsl') };
  for (const [name, code] of Object.entries(files)) {
    const fp = join(tmp, name);
    writeFileSync(fp, code);
    if (!existsSync(naga)) { ok(`wgsl: ${name} (naga missing, not checked)`, true); continue; }
    let msg = '';
    try { execFileSync(naga, [fp], { stdio: 'pipe' }); } catch (e) { msg = String(e.stderr || e.message).slice(0, 400); }
    ok(`wgsl: naga validates ${name}`, !msg, msg);
  }
  // Tint: no mixed && / || and no mixed * / ^ in one expression without
  // parentheses. Heuristic per line: flag lines that hold both operators.
  for (const p of ['shaders/frame.wgsl', 'shaders/globe.wgsl']) {
    const bad = read(p).split('\n').map((l, i) => [l.replace(/\/\/.*$/, ''), i + 1]).filter(([l]) => (l.includes('&&') && l.includes('||')) || (/\^/.test(l) && /\*/.test(l)));
    ok(`wgsl: ${p} has no mixed operators for Tint`, !bad.length, bad.map(b => b[1]).join(','));
  }
  const globe = read('shaders/globe.wgsl');
  ok('wgsl: globe entry points vsFull, fsGlobe, fsVeil', /fn vsFull/.test(globe) && /fn fsGlobe/.test(globe) && /fn fsVeil/.test(globe));
  ok('wgsl: frame.wgsl defines no PI (atmo-common does)', !/\bconst PI\b/.test(read('shaders/frame.wgsl')));

  // ── page shell ──
  const html = read('index.html');
  const iG = html.indexOf('../../lib/gpu-guard.js'), iW = html.indexOf('../../lib/wishlist.js'), iS = html.indexOf('../../lib/stats-beacon.js');
  ok('shell: head scripts gpu-guard, wishlist, stats-beacon in order', iG > 0 && iG < iW && iW < iS && iS < html.indexOf('</head>'));
  ok('shell: #nogpu is hidden by default', /id="nogpu" hidden/.test(html));
  const css = read('style.css');
  ok('shell: stylesheet has [hidden]{display:none!important}', css.includes('[hidden]{display:none!important}'));
  ok('shell: no banned fonts', !/Playfair|Cormorant|JetBrains/i.test(html + css));
  ok('shell: Inter is vendored', html.includes('../../vendor/fonts/inter.adf13477.css') && existsSync(new URL('../../vendor/fonts/inter.adf13477.css', page)));
  for (const p of GLOBE_SHADERS) ok(`shell: shader file exists ${p}`, existsSync(new URL(p, page)));
  ok('shell: main.js owns window.WX', /window\.WX\s*=\s*app/.test(read('main.js')));
}
