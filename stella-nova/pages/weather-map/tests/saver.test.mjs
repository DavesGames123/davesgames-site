// WEATHER MAP · tests/saver.test.mjs — package SAVER: the seeded shot list
// (varies per run, holds 8-14 s), framing of every shot inside the clear
// band for 16:9, 9:16 and the shell 9:16 column (calm and wide), the plate
// clock and date in IANA zones, and a two-minute run of installSaver on a
// fake DOM in shell mode and in page mode (no browser).
import { readFileSync } from 'node:fs';
import { buildShots, bandView, shotCams, holdPose, plateInfo, clockText, dateText, tempParts, conditionsAt, anchorCity, MIN_ALT, HOLD_S, installSaver } from '../saver.js';
import { viewProj, project, centralAngle, camState } from '../camera.js';
import { CITY_BY_ID } from '../data/cities.js';
import { parseCodsus } from '../data/fronts.js';
import { unpackGrid } from '../data/grid.js';

const page = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, page), 'utf8');

// The views: shell plate bands (lib/screensaver.js poster: about 24% top,
// 30% bottom), the shell 9:16 column on a landscape screen, the in-page
// lower third, and a phone.
const VIEWS = [
  { tag: 'shell 16:9', W: 1920, H: 1080, band: { t: 260, b: 320, w: 1920 } },
  { tag: 'shell 9:16', W: 1080, H: 1920, band: { t: 420, b: 560, w: 1080 } },
  { tag: 'shell 9:16 column', W: 1920, H: 1080, band: { t: 230, b: 300, w: 1080 * 9 / 16 } },
  { tag: 'page 16:9', W: 1600, H: 900, band: { t: 45, b: 190, w: 1600 } },
  { tag: 'page 9:16', W: 900, H: 1600, band: { t: 80, b: 330, w: 900 } },
  { tag: 'phone', W: 390, H: 844, band: { t: 42, b: 230, w: 390 } },
];

function outside(cam, pts, v) {
  const m = viewProj(cam, v.w, v.h), I = v.inset, bad = [];
  for (const p of pts) {
    const q = project(m, p.lat, p.lon);
    if (!q.visible || q.x < I.l - 2 || q.x > v.w - I.r + 2 || q.y < I.t - 2 || q.y > v.h - I.b + 2) bad.push(`${p.id || p.lat.toFixed(1) + ',' + p.lon.toFixed(1)}@${q.x.toFixed(0)},${q.y.toFixed(0)}`);
  }
  return bad;
}

// A small fake DOM: elements with classList, children, querySelector
// (one child per selector), getBoundingClientRect and event lists.
function fakeEl(tag = 'div') {
  const cls = new Set(), q = {};
  const el = {
    tagName: tag.toUpperCase(), hidden: false, textContent: '', innerHTML: '', id: '', attrs: {}, children: [],
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c) },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); },
    get className() { return [...cls].join(' '); },
    setAttribute(k, v) { el.attrs[k] = v; },
    append(...c) { el.children.push(...c); },
    querySelector(s) { return q[s] || (q[s] = fakeEl()); },
    getBoundingClientRect: () => ({ top: 900 - 170, bottom: 900 - 32, left: 32, right: 640, width: 608, height: 138 }),
    q,
  };
  return el;
}

function fakeWindow(W, H) {
  const ev = {}, docEv = {};
  let now = 0;
  const doc = {
    documentElement: fakeEl('html'), body: fakeEl('body'),
    createElement: t => fakeEl(t),
    fullscreenEnabled: false, fullscreenElement: null,
    addEventListener: (k, f) => { (docEv[k] = docEv[k] || []).push(f); },
    removeEventListener: (k, f) => { docEv[k] = (docEv[k] || []).filter(x => x !== f); },
  };
  const g = {
    document: doc, innerWidth: W, innerHeight: H,
    addEventListener: (k, f) => { (ev[k] = ev[k] || []).push(f); },
    removeEventListener: (k, f) => { ev[k] = (ev[k] || []).filter(x => x !== f); },
    requestAnimationFrame: f => { f(now); return 1; },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: f => { f(); return 1; }, clearTimeout: () => {},
  };
  g.window = g; g.parent = g;
  return { g, ev, doc, advance: ms => { now += ms; } };
}

function withGlobals(g, fn) {
  const keep = {};
  for (const k of Object.keys(g)) { keep[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: g[k], configurable: true, writable: true }); }
  try { return fn(); }
  finally { for (const k of Object.keys(g)) { if (keep[k]) Object.defineProperty(globalThis, k, keep[k]); else delete globalThis[k]; } }
}

export default function (ok) {
  const fronts = parseCodsus(read('data/sample/asus01.txt'));

  // ── SHOT LIST ──
  const lists = [1, 2, 3, 4, 5].map(s => buildShots(s, { fronts }));
  const orders = new Set(lists.map(l => l.map(s => s.id).join(',')));
  ok('saver: the shot order changes with the seed', orders.size === 5, `${orders.size} orders of 5`);
  ok('saver: the same seed gives the same order', buildShots(3, { fronts }).map(s => s.id).join() === lists[2].map(s => s.id).join());
  const firsts = new Set(lists.map(l => l[0].id));
  ok('saver: runs do not all start on the same shot', firsts.size >= 3, [...firsts].join(' '));
  const L = lists[0], kinds = new Set(L.map(s => s.kind));
  ok('saver: the list has national, region, city and front shots', ['national', 'region', 'city', 'front'].every(k => kinds.has(k)), [...kinds].join(' '));
  ok('saver: the list is long enough for a varied run', L.length >= 16 && L.length <= 30, `${L.length} shots`);
  const holds = lists.flat().map(s => s.hold);
  ok('saver: holds are 8-14 s', holds.every(h => h >= HOLD_S[0] && h <= HOLD_S[1]), `${Math.min(...holds).toFixed(1)}..${Math.max(...holds).toFixed(1)} s`);
  const calmHolds = buildShots(9, { calm: 1 }).map(s => s.hold), busyHolds = buildShots(9, { calm: 0 }).map(s => s.hold);
  ok('saver: calm makes the holds longer', calmHolds.reduce((a, b) => a + b) > busyHolds.reduce((a, b) => a + b));
  ok('saver: no shot twice in a row', lists.every(l => l.every((s, i) => i === 0 || s.id !== l[i - 1].id)));
  const frontSpecs = L.filter(s => s.kind === 'front');
  ok('saver: front shots carry the US part of the front', frontSpecs.length >= 1 && frontSpecs.every(s => s.points && s.points.length >= 2), frontSpecs.map(s => `${s.name}:${s.points ? s.points.length : 0}`).join(' '));
  ok('saver: every shot names a place', lists.flat().every(s => typeof s.name === 'string' && s.name.length > 1));
  ok('saver: region and city shots have an anchor city', lists.flat().filter(s => s.kind === 'region' || s.kind === 'city').every(s => !!anchorCity(s)));

  // ── FRAMING ──
  for (const V of VIEWS) {
    const v = bandView(V.W, V.H, V.band);
    const bad = [], low = [];
    let steep = 0, n = 0, minAlt = Infinity;
    for (const l of lists.slice(0, 3)) {
      for (const s of l) {
        const c = shotCams(s, v);
        n++;
        const pts = s.points || [s.at];
        for (const [tag, cam] of [['a', c.a], ['b', c.b], ['mid', { ...c.b, alt: c.b.alt * holdPose(s, 0.5).altK, heading: c.b.heading + holdPose(s, 0.5).dHeading }]]) {
          const o = outside(cam, pts, v);
          if (o.length) bad.push(`${s.id}/${tag}:${o.slice(0, 2).join(' ')}`);
        }
        if (c.b.alt < MIN_ALT[s.kind] - 1e-9 || c.a.alt < MIN_ALT[s.kind] - 1e-9) low.push(s.id);
        if (c.a.tilt > 0.5 || c.b.tilt > 0.5) steep++;
        minAlt = Math.min(minAlt, c.a.alt, c.b.alt);
      }
    }
    ok(`saver framing ${V.tag}: every subject point sits in the clear band`, bad.length === 0, bad.length ? `${bad.length} misses: ${bad.slice(0, 3).join(' | ')}` : `${n} shots, lowest alt ${minAlt.toFixed(3)}`);
    ok(`saver framing ${V.tag}: calm and wide (alt floor, tilt <= 0.5)`, low.length === 0 && steep === 0, low.join(' '));
  }
  // a portrait band gets more altitude than a landscape band for the same shot
  const nat = L.find(s => s.kind === 'national');
  const altL = shotCams(nat, bandView(1920, 1080, VIEWS[0].band)).b.alt, altP = shotCams(nat, bandView(1080, 1920, VIEWS[1].band)).b.alt;
  ok('saver framing: 9:16 backs off for the national view', altP > altL * 1.3, `16:9 ${altL.toFixed(2)}, 9:16 ${altP.toFixed(2)}`);
  // the band is centred: the subject centre is near the band centre
  const reg = L.find(s => s.id === 'texas') || L.find(s => s.kind === 'region');
  const v0 = bandView(1920, 1080, VIEWS[0].band), c0 = shotCams(reg, v0).b, m0 = viewProj(c0, 1920, 1080);
  const ys = reg.points.map(p => project(m0, p.lat, p.lon).y);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2, bandMid = (v0.inset.t + 1080 - v0.inset.b) / 2;
  ok('saver framing: the subject is centred in the band, not under the plate', Math.abs(mid - bandMid) < 0.12 * 1080, `${reg.id} centre ${mid.toFixed(0)} px, band centre ${bandMid.toFixed(0)} px`);

  // ── PLATE ──
  const t0 = Date.UTC(2026, 9, 15, 20, 42, 7);
  ok('plate: Chicago clock', clockText(t0, 'America/Chicago') === '3:42:07 PM', clockText(t0, 'America/Chicago'));
  ok('plate: Honolulu clock', clockText(t0, 'Pacific/Honolulu') === '10:42:07 AM', clockText(t0, 'Pacific/Honolulu'));
  ok('plate: date in the zone of the place', dateText(t0, 'America/New_York') === 'Thursday, October 15, 2026' && dateText(Date.UTC(2026, 9, 16, 3, 0), 'America/Los_Angeles') === 'Thursday, October 15, 2026', dateText(t0, 'America/New_York'));
  ok('plate: an unknown zone falls back to UTC', clockText(t0, 'Mars/Olympus') === '8:42:07 PM');
  ok('plate: both units, order from app.units', JSON.stringify(tempParts(22, 'F')) === '{"main":"72°","unit":"F","alt":"22°C"}' && tempParts(22, 'C').main === '22°' && tempParts(22, 'C').alt === '72°F');

  const grid = unpackGrid(JSON.parse(read('data/sample/grid.json')));
  const current = new Map(Object.entries(JSON.parse(read('data/sample/current.json')).byId));
  const tBase = grid.times[2];
  const app = { t: tBase, tBase, units: 'F', cam: camState(39, -97, 0.9, 0.3, 0), layers: { labels: true, fronts: true, clouds: true, temp: true }, data: { grid, current, fronts: { analysis: fronts, forecasts: [] } } };
  const den = CITY_BY_ID.get('den');
  const cityShot = { kind: 'city', id: 'den', name: 'Denver, CO', anchor: 'den' };
  const p0 = plateInfo(app, cityShot, tBase, tBase);
  ok('plate: a city shot shows the observed temperature now', p0.tempC === current.get('den').t2m && p0.temp.unit === 'F', `${p0.temp.main}${p0.temp.unit} · ${p0.temp.alt}`);
  ok('plate: conditions text and icon now', !!p0.cond && !!p0.icon, `${p0.cond} (${p0.icon})`);
  ok('plate: time and date in the city zone', p0.tz === 'America/Denver' && /^\d{1,2}:\d\d:\d\d [AP]M$/.test(p0.time) && /, 20\d\d$/.test(p0.date), `${p0.time} ${p0.tzAbbr} · ${p0.date}`);
  ok('plate: "Now" at the reference time', p0.lapse === 'Now');
  const p9 = plateInfo(app, cityShot, tBase, tBase + 9 * 3.6e6);
  ok('plate: the time-lapse shows the forecast hour', /^Forecast for .* \+9 h$/.test(p9.lapse) && Number.isFinite(p9.tempC), `${p9.lapse}, ${p9.temp.main}`);
  ok('plate: grid conditions later in the lapse', conditionsAt(app, den, tBase + 12 * 3.6e6).text.length > 0, conditionsAt(app, den, tBase + 12 * 3.6e6).text);
  const regShot = buildShots(4, {}).find(s => s.id === 'texas');
  const pr = plateInfo(app, regShot, tBase, tBase);
  ok('plate: a region shot names its anchor city', pr.place === 'Texas' && /, TX$/.test(pr.sub) && pr.tz === 'America/Chicago', `${pr.place} · ${pr.sub}`);

  // ── RUN (shell mode, fake DOM) ──
  const F = fakeWindow(1920, 1080);
  const labels = [];
  const res = withGlobals(F.g, () => {
    const appR = { ...app, cam: camState(38.5, -97, 0.95, 0.32, 0), layers: { ...app.layers }, playing: true };
    const director = { stops: 0, cams: 0, stop() { this.stops++; }, setCam() { this.cams++; } };
    const saver = installSaver({ app: appR, director, canvas: { id: 'view' } });
    const start = { ...appR.cam };
    const r = globalThis.snSaver.enter({ calm: 0.7, seed: 42, label: x => labels.push(x) });
    const okEnter = r && r.canvas && r.canvas.id === 'view' && r.warmupMs > 0 && F.doc.documentElement.classList.contains('sn-saver') && director.stops === 1;
    const shots = new Set(), cuts = [];
    let maxStep = 0, maxAltStep = 0, prev = { ...appR.cam }, tMin = Infinity, tMax = -Infinity, flips = 0, lastShot = null, frames = 0, tElapsed = 0;
    let wasFlying = true;
    for (let i = 0; i < 30 * 150; i++) {
      saver.tick(1 / 30); frames++; tElapsed += 1 / 30;
      const c = appR.cam;
      maxStep = Math.max(maxStep, centralAngle(prev, c) * 180 / Math.PI);
      maxAltStep = Math.max(maxAltStep, Math.abs(Math.log(c.alt / prev.alt)));
      prev = { ...c };
      tMin = Math.min(tMin, appR.t); tMax = Math.max(tMax, appR.t);
      const d = saver.debug();
      if (d.id !== lastShot) { cuts.push(tElapsed); lastShot = d.id; }
      shots.add(d.id);
      if (wasFlying && !d.flying && d.inBand === false) flips++;
      wasFlying = d.flying;
    }
    const gaps = cuts.slice(1).map((t, i) => t - cuts[i]);
    const dbg = saver.debug();
    globalThis.snSaver.exit();
    const restored = Math.abs(appR.cam.lat - start.lat) < 1e-9 && Math.abs(appR.cam.alt - start.alt) < 1e-9 && appR.playing === true && !F.doc.documentElement.classList.contains('sn-saver') && director.cams === 1;
    return { okEnter, maxStep, maxAltStep, tMin, tMax, shots: shots.size, flips, gaps, dbg, restored, nullLabel: labels[labels.length - 1] === null };
  });
  ok('run shell: enter returns the page canvas and hides the chrome', res.okEnter);
  ok('run shell: the camera never jumps (per frame at 30 fps)', res.maxStep < 1.2 && res.maxAltStep < 0.12, `max ${res.maxStep.toFixed(3)}°/frame, alt ${res.maxAltStep.toFixed(3)}/frame`);
  ok('run shell: a cut every 8-22 s (hold 8-14 s plus the flight)', res.gaps.length >= 7 && res.gaps.every(g => g >= 8 && g <= 23), res.gaps.map(g => g.toFixed(1)).join(' '));
  ok('run shell: the subject is in the band when the camera lands', res.flips === 0, `${res.flips} misses`);
  ok('run shell: the time-lapse stays in the forecast grid', res.tMin >= grid.times[0] && res.tMax <= grid.times[grid.times.length - 1] && res.tMax - res.tMin >= 5 * 3.6e6, `${((res.tMax - res.tMin) / 3.6e6).toFixed(1)} h span`);
  const titled = labels.filter(Boolean);
  ok('run shell: the plate names the place, its clock and date', titled.length > 5 && titled.every(x => x.title && / · .*, 20\d\d$/.test(x.sub)) && !titled.some(x => x.code), titled[0] && `${titled[0].title} — ${titled[0].sub}`);
  ok('run shell: exit restores the camera and the play state and clears the plate', res.restored && res.nullLabel);

  // ── RUN (page mode, fake DOM) ──
  const P = fakeWindow(1600, 900);
  const pres = withGlobals(P.g, () => {
    const appP = { ...app, cam: camState(38.5, -97, 0.95, 0.32, 0), layers: { ...app.layers } };
    const saver = installSaver({ app: appP, canvas: { id: 'view' } });
    const keys = P.ev.keydown || [];
    keys.forEach(f => f({ key: 's', target: { tagName: 'BODY' }, preventDefault() {} }));
    const on = saver.active && !saver.shell && P.doc.documentElement.classList.contains('wx-saver');
    for (let i = 0; i < 30 * 5; i++) saver.tick(1 / 30);
    const plate = P.doc.body.children.find(e => e.id === 'wxSaverPlate');
    const name = plate && plate.q['.wxs-name'].textContent, time = plate && plate.q['.wxs-time'].textContent, date = plate && plate.q['.wxs-date'].textContent;
    const typing = (() => { keys.forEach(f => f({ key: 's', target: { tagName: 'INPUT' }, preventDefault() {} })); return saver.active; })();
    keys.forEach(f => f({ key: 'Escape', target: { tagName: 'BODY' }, preventDefault() {} }));
    return { on, name, time, date, typing, off: !saver.active && !P.doc.documentElement.classList.contains('wx-saver') && plate.hidden };
  });
  ok('run page: the S key starts the in-page saver (class wx-saver)', pres.on);
  ok('run page: the lower third shows the place, clock and date', !!pres.name && /\d:\d\d:\d\d [AP]M/.test(pres.time || '') && /, 20\d\d$/.test(pres.date || ''), `${pres.name} · ${pres.time} · ${pres.date}`);
  ok('run page: S in a text field does not toggle it', pres.typing === true);
  ok('run page: Esc stops it and hides the plate', pres.off);
}
