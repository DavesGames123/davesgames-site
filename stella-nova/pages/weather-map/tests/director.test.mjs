// WEATHER MAP · tests/director.test.mjs — package DIRECTOR: region framing
// at 16:9 and 9:16, flight continuity (no jumps), the forecast lapse,
// declutter determinism, the temperature text and count-up, and a run of
// createLabels on a small fake DOM (no browser).
import { readFileSync } from 'node:fs';
import { REGIONS, REGION_BY_ID, fitCam, regionCam, frontShots, tourOrder, createDirector, clearBox, VIEW_16x9 } from '../director.js';
import { maxRankFor, declutter, fmtTemp, countUp, labelSize, cityTempAt, iconFor, createLabels, ICONS, LABEL_DX, LABEL_DY } from '../labels.js';
import { viewProj, project, centralAngle, camState } from '../camera.js';
import { CITIES, CITY_BY_ID, STATES } from '../data/cities.js';
import { parseCodsus } from '../data/fronts.js';
import { unpackGrid } from '../data/grid.js';
import { WMO, codeText } from '../data/forecast.js';

const page = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, page), 'utf8');

const VIEWS = [
  { tag: '16:9', w: 1600, h: 900 },
  { tag: '9:16', w: 900, h: 1600 },
  { tag: 'phone 9:19.5', w: 390, h: 844 },
];

// every point inside the view, with the label body (named points) inside
// on the right
function framed(cam, pts, v) {
  const m = viewProj(cam, v.w, v.h);
  const bad = [];
  for (const p of pts) {
    const q = project(m, p.lat, p.lon);
    const lw = p.name ? labelSize(p, v.w < 520).w : 0;
    if (!q.visible || q.x < 4 || q.y < 4 || q.y > v.h - 4 || q.x + LABEL_DX + lw > v.w + 2) bad.push(`${p.id || '?'}@${q.x.toFixed(0)},${q.y.toFixed(0)}`);
  }
  return bad;
}

export default function (ok) {
  // ── REGIONS ──
  const want = ['national', 'northeast', 'mid-atlantic', 'southeast', 'florida', 'great-lakes', 'midwest', 'plains', 'texas', 'southwest', 'rockies', 'california', 'pacific-northwest', 'alaska', 'hawaii', 'fronts', 'tour'];
  ok('director: REGIONS has every contract region', want.every(id => REGION_BY_ID.has(id)), want.filter(id => !REGION_BY_ID.has(id)).join(','));
  const real = REGIONS.filter(r => !r.auto);
  ok('director: each region has cities with known ids and a cam', real.every(r => r.cities.length > 0 && r.cities.every(id => CITY_BY_ID.has(id)) && r.cam && Number.isFinite(r.cam.alt)));
  const covered = new Set(real.flatMap(r => r.cities.map(id => CITY_BY_ID.get(id).state)));
  ok('director: every state, DC and PR is in a region', STATES.every(s => covered.has(s)), STATES.filter(s => !covered.has(s)).join(','));
  ok('director: national frames no AK, HI or PR city', REGION_BY_ID.get('national').cities.every(id => !['AK', 'HI', 'PR'].includes(CITY_BY_ID.get(id).state)));

  // ── framing at 16:9 and 9:16 ──
  for (const r of real) {
    const pts = r.cities.map(id => CITY_BY_ID.get(id));
    for (const v of VIEWS) {
      const cam = regionCam(r, v);
      const bad = framed(cam, pts, v);
      ok(`framing: ${r.name} at ${v.tag} shows all ${pts.length} cities`, bad.length === 0, bad.length ? bad.join(' ') : `alt ${cam.alt.toFixed(3)}`);
    }
    ok(`framing: ${r.name} static cam (16:9) shows all cities`, framed(r.cam, pts, VIEW_16x9).length === 0);
  }
  // a bottom sheet over 45% of a phone: the cities stay in the clear part
  {
    const v = { w: 390, h: 844, inset: { t: 60, b: 380 } };
    const r = REGION_BY_ID.get('texas'), pts = r.cities.map(id => CITY_BY_ID.get(id));
    const cam = regionCam(r, v), m = viewProj(cam, v.w, v.h), box = clearBox(v);
    const ys = pts.map(p => project(m, p.lat, p.lon).y);
    ok('framing: an inset (bottom sheet) keeps cities in the clear box', ys.every(y => y >= box.t - 1 && y <= box.b + 1), `y ${Math.min(...ys).toFixed(0)}..${Math.max(...ys).toFixed(0)}, box ${box.t.toFixed(0)}..${box.b.toFixed(0)}`);
  }
  {
    const a = regionCam(REGION_BY_ID.get('national'), VIEWS[0]), b = regionCam(REGION_BY_ID.get('national'), VIEWS[1]);
    ok('framing: portrait national is higher than landscape', b.alt > a.alt * 1.5, `${a.alt.toFixed(2)} vs ${b.alt.toFixed(2)}`);
    const c = fitCam([{ lat: 40, lon: -100 }, { lat: 40.1, lon: -99.9 }], { w: 1600, h: 900 });
    ok('framing: a tiny point set clamps to the minimum altitude', c.alt <= 0.06 && c.alt >= 0.05, c.alt.toFixed(4));
  }

  // ── tour order ──
  const t1 = tourOrder(7), t2 = tourOrder(7), t3 = tourOrder(8);
  ok('tour: the order is seeded (same seed, same order)', t1.join() === t2.join());
  ok('tour: a different seed gives another order', t1.join() !== t3.join());
  const conus = real.filter(r => !['national', 'alaska', 'hawaii', 'puerto-rico'].includes(r.id)).map(r => r.id);
  ok('tour: starts and ends at National and visits every CONUS region', t1[0] === 'national' && t1[t1.length - 1] === 'national' && conus.every(id => t1.includes(id)), t1.join(' '));
  ok('tour: never the same stop twice in a row', t1.every((id, i) => i === 0 || t1[i - 1] !== id));

  // ── flight continuity ──
  const DT = 1 / 60;
  function run(dir, app, seconds, onStep) {
    let prev = { ...app.cam };
    const worst = { ang: 0, dlog: 0, head: 0, tilt: 0 };
    for (let i = 0; i < seconds / DT; i++) {
      const c = dir.tick(DT);
      app.cam = c;
      const ang = centralAngle(prev, c) * 180 / Math.PI;
      let dh = Math.abs(c.heading - prev.heading) % (2 * Math.PI); if (dh > Math.PI) dh = 2 * Math.PI - dh;
      worst.ang = Math.max(worst.ang, ang);
      worst.dlog = Math.max(worst.dlog, Math.abs(Math.log(c.alt / prev.alt)));
      worst.head = Math.max(worst.head, dh);
      worst.tilt = Math.max(worst.tilt, Math.abs(c.tilt - prev.tilt));
      if (![c.lat, c.lon, c.alt, c.tilt, c.heading].every(Number.isFinite)) { worst.nan = true; break; }
      if (onStep) onStep(c, i);
      prev = c;
    }
    return worst;
  }
  const smooth = w => !w.nan && w.ang < 1.5 && w.dlog < 0.06 && w.head < 0.05 && w.tilt < 0.02;
  const fmt = w => `max step ${w.ang.toFixed(3)} deg, dln(alt) ${w.dlog.toFixed(4)}, tilt ${w.tilt.toFixed(4)}`;
  {
    const app = { cam: camState(38.5, -97, 0.95, 0.32, 0), t: Date.now(), data: {} };
    const dir = createDirector(app, { seed: 3, view: () => ({ w: 1600, h: 900 }) });
    dir.tour(true);
    const stops = [];
    let lapseJump = 0, lastLapse = 0, maxLapse = 0;
    const w = run(dir, app, 260, () => {
      lapseJump = Math.max(lapseJump, Math.abs(dir.lapseHours - lastLapse));
      lastLapse = dir.lapseHours; maxLapse = Math.max(maxLapse, dir.lapseHours);
      if (app.focus && stops[stops.length - 1] !== app.focus.id) stops.push(app.focus.id);
    });
    ok('flight: a full tour at 60 fps has no jumps', smooth(w), fmt(w));
    const n0 = tourOrder(3).length;
    ok('flight: the tour arrives at its stops in order', stops.length > n0 && stops.slice(0, n0).join() === tourOrder(3).join(), stops.join(' '));
    ok('lapse: the forecast runs ahead while holding and returns smoothly', maxLapse > 10 && lapseJump < 0.35, `max ${maxLapse.toFixed(1)} h, step ${lapseJump.toFixed(3)} h`);
  }
  {
    // interrupt a long flight halfway, then a stop and a hand move
    const app = { cam: { ...REGION_BY_ID.get('california').cam }, t: Date.now(), data: {} };
    const dir = createDirector(app, { view: () => ({ w: 900, h: 1600 }) });
    dir.goTo('northeast');
    const a = run(dir, app, 2.2);
    ok('flight: goTo starts a flight (busy)', dir.busy && dir.mode === 'goto');
    dir.goTo('hawaii');
    const b = run(dir, app, 9);
    ok('flight: re-targeting mid-flight is continuous', smooth(a) && smooth(b), `${fmt(a)} / ${fmt(b)}`);
    const hc = regionCam(REGION_BY_ID.get('hawaii'), { w: 900, h: 1600 });
    ok('flight: lands exactly on the region camera', !dir.busy && Math.abs(app.cam.alt - hc.alt) < 1e-9 && centralAngle(app.cam, hc) < 1e-6);
    ok('flight: arrival sets app.focus with a time zone', app.focus && app.focus.id === 'hawaii' && app.focus.tz === 'Pacific/Honolulu', JSON.stringify(app.focus));
    dir.goTo('chi');
    run(dir, app, 1);
    dir.stop();
    app.cam = { ...app.cam, lat: app.cam.lat + 0.5 };
    const c = dir.tick(DT);
    ok('flight: after stop() the director follows the hand-moved camera', !dir.busy && Math.abs(c.lat - app.cam.lat) < 1e-12 && dir.lapseHours === 0);
    ok('flight: goTo a city frames it close', dir.goTo('den') && (run(dir, app, 10), app.focus.id === 'den' && app.cam.alt < 0.2));
    ok('flight: goTo a point', dir.goTo({ lat: 30, lon: -90, alt: 0.3 }) && (run(dir, app, 10), Math.abs(app.cam.lat - 30) < 1e-9 && Math.abs(app.cam.alt - 0.3) < 1e-9));
    ok('flight: an unknown id is refused', dir.goTo('atlantis') === false);
  }

  // ── fronts ──
  const set = parseCodsus(read('data/sample/asus01.txt'));
  const shots = frontShots(set, VIEW_16x9);
  ok('fronts: the sample analysis gives front shots', shots.length >= 1 && shots.length <= 5, shots.map(s => `${s.type}@${s.cam.alt.toFixed(2)}`).join(' '));
  for (const v of VIEWS.slice(0, 2)) {
    const sh = frontShots(set, v);
    const bad = [];
    sh.forEach((s, k) => {
      const f = set.fronts[+s.id.slice(6)];
      const pts = f.pts.filter(p => p[0] >= 18 && p[0] <= 58 && p[1] >= -135 && p[1] <= -55).map(([lat, lon]) => ({ lat, lon, name: '' }));
      if (framed(s.cam, pts, v).length) bad.push(k);
    });
    ok(`fronts: each shot frames its front at ${v.tag}`, bad.length === 0, bad.join(','));
  }
  {
    const app = { cam: camState(38.5, -97, 0.95, 0.3, 0), t: set.valid, data: { fronts: { analysis: set, forecasts: [] } } };
    const dir = createDirector(app, { view: () => ({ w: 1600, h: 900 }) });
    dir.follow(true);
    const w = run(dir, app, 40);
    ok('fronts: Follow fronts flies between shots without jumps', smooth(w) && dir.mode === 'fronts' && /front/.test(app.focus && app.focus.kind), fmt(w));
    const empty = createDirector({ cam: camState(38, -97, 1), data: {} }, {});
    empty.follow(true);
    ok('fronts: no fronts falls back to National', empty.target && empty.target.id === 'national');
  }

  // ── labels: pure parts ──
  ok('labels: maxRankFor goes 1 -> 2 -> 3 as the camera comes down', maxRankFor(1.0) === 1 && maxRankFor(0.4) === 2 && maxRankFor(0.1) === 3);
  ok('labels: a narrow view needs a lower camera for more labels', maxRankFor(0.4, 390) === 1);
  ok('labels: fmtTemp F first', fmtTemp(22.2, 'F') === '72°F · 22°C', fmtTemp(22.2, 'F'));
  ok('labels: fmtTemp C first', fmtTemp(-5, 'C') === '-5°C · 23°F', fmtTemp(-5, 'C'));
  ok('labels: fmtTemp no value', fmtTemp(NaN) === '—');
  ok('labels: countUp ends exact and rises monotonic', countUp(0, 10, 0) === 0 && countUp(0, 10, 1) === 10 && countUp(0, 10, 0.3) < countUp(0, 10, 0.6));
  const codes = new Set(Object.values(WMO).flatMap(e => e.slice(1)));
  codes.add(codeText(-1).icon);
  ok('labels: an icon exists for every WMO icon name', [...codes].every(k => ICONS[k]), [...codes].filter(k => !ICONS[k]).join(','));

  // ── declutter ──
  const nat = regionCam(REGION_BY_ID.get('national'), VIEW_16x9), m = viewProj({ ...nat, alt: 0.5 }, 1600, 900);
  const cands = [];
  for (const c of CITIES) {
    const q = project(m, c.lat, c.lon);
    if (!q.visible) continue;
    const s = labelSize(c);
    cands.push({ id: c.id, x: q.x, y: q.y, rank: c.rank, pop: c.pop, w: s.w, h: s.h, shown: false });
  }
  const A = declutter(cands);
  const shuffled = cands.slice().sort((a, b) => ((a.x * 7919 + b.y) % 3) - 1 || a.id.localeCompare(b.id) * -1);
  const B = declutter(shuffled), C = declutter(cands.slice().reverse());
  ok('declutter: deterministic and order-free', A.join() === B.join() && A.join() === C.join(), `${A.length} of ${cands.length}`);
  const boxOf = c => ({ x0: c.x + LABEL_DX - 6, y0: c.y + LABEL_DY, x1: c.x + LABEL_DX + c.w, y1: c.y + LABEL_DY + c.h });
  const over = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const byId = new Map(cands.map(c => [c.id, c])), acc = A.map(id => byId.get(id));
  let overlaps = 0;
  for (let i = 0; i < acc.length; i++) for (let j = i + 1; j < acc.length; j++) if (over(boxOf(acc[i]), boxOf(acc[j]))) overlaps++;
  ok('declutter: accepted labels do not overlap', overlaps === 0 && A.length > 10, `${overlaps} overlaps`);
  const r1 = cands.filter(c => c.rank === 1).map(c => c.id), keptR1 = r1.filter(id => A.includes(id));
  const lostToLower = cands.filter(c => c.rank === 1 && !A.includes(c.id)).filter(c => acc.some(a => a.rank > 1 && over(boxOf(a), boxOf(c))));
  ok('declutter: rank wins (no rank-1 label lost to a lower rank)', lostToLower.length === 0, `${keptR1.length}/${r1.length} rank-1 kept`);
  const rejected = cands.filter(c => !A.includes(c.id));
  const grow = (b, p) => ({ x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p });
  const dotOf = c => ({ x0: c.x - 5, y0: c.y - 5, x1: c.x + 5, y1: c.y + 5 });
  const conflict = (c, a) => over(grow(boxOf(c), 4), grow(boxOf(a), 4)) || over(grow(boxOf(c), 4), dotOf(a)) || over(dotOf(c), grow(boxOf(a), 4));
  ok('declutter: each rejected label had a real conflict', rejected.every(c => acc.some(a => conflict(c, a))), `${rejected.length} rejected`);
  const loser = rejected.find(c => c.rank === 2);
  if (loser) {
    const D = declutter(cands.map(c => ({ ...c, shown: c.id === loser.id })));
    ok('declutter: a label already on screen keeps its place', D.includes(loser.id));
  }
  ok('declutter: max caps the count', declutter(cands, { max: 5 }).length === 5);

  // ── temperature over time ──
  const grid = unpackGrid(JSON.parse(read('data/sample/grid.json')));
  const curObj = JSON.parse(read('data/sample/current.json')).byId;
  const current = new Map(Object.entries(curObj));
  const tBase = grid.times[2];
  const app = { t: tBase, tBase, units: 'F', cam: camState(39, -97, 0.4), layers: { labels: true, isobars: true }, data: { grid, current } };
  const den = CITY_BY_ID.get('den'), hnl = CITY_BY_ID.get('hnl');
  ok('temp: at now the label shows the observation', cityTempAt(app, den, tBase) === current.get('den').t2m);
  const steps = [];
  for (let h = 0; h <= 24; h += 0.25) steps.push(cityTempAt(app, den, tBase + h * 3.6e6));
  const jump = Math.max(...steps.slice(1).map((v, i) => Math.abs(v - steps[i])));
  ok('temp: the time-lapse value is continuous', steps.every(Number.isFinite) && jump < 1.5, `max step ${jump.toFixed(2)} °C, range ${Math.min(...steps).toFixed(1)}..${Math.max(...steps).toFixed(1)}`);
  ok('temp: outside the grid (Honolulu) the observation holds', cityTempAt(app, hnl, tBase + 12 * 3.6e6) === current.get('hnl').t2m);
  ok('temp: icons come from codeText names', !!ICONS[iconFor(app, den, tBase)] && !!ICONS[iconFor(app, den, tBase + 12 * 3.6e6)]);

  // ── createLabels on a fake DOM ──
  const doc = fakeDoc(), root = doc.createElement('div');
  const labels = createLabels(root, app);
  const picked = [];
  labels.onPick(c => picked.push(c.id));
  const mm = viewProj(app.cam, 1600, 900);
  labels.update(mm, 1 / 60);
  const layer = root.children[0];
  const els = layer.children.filter(e => e.className === 'wxl' && !e.hidden);
  ok('dom: labels appear near the camera', els.length > 5, `${els.length} labels`);
  const denEl = layer.children.find(e => e.attrs['aria-label'] && e.attrs['aria-label'].startsWith('Denver'));
  const tempEl = denEl && denEl.q['.wxl-temp'];
  const first = tempEl && tempEl.textContent;
  for (let i = 0; i < 70; i++) labels.update(mm, 1 / 60);
  const settled = tempEl && tempEl.textContent;
  ok('dom: the temperature counts up to the value in both units', first !== settled && settled === fmtTemp(current.get('den').t2m, 'F'), `${first} -> ${settled}`);
  ok('dom: the label pops to full opacity', denEl && denEl.style.opacity === '1.000');
  app.units = 'C';
  labels.update(mm, 1 / 60);
  ok('dom: the unit order follows app.units', tempEl.textContent === fmtTemp(current.get('den').t2m, 'C'), tempEl.textContent);
  denEl.fire('click');
  ok('dom: a click calls the pick handler with the city', picked[0] === 'den');
  const hl = layer.children.filter(e => /wxm-[hl]/.test(e.className));
  labels.update(mm, 1 / 60);
  ok('dom: no fronts, no H/L marks', hl.length === 0);
  labels.setMarks([{ kind: 'iso', lat: 39, lon: -97, text: '1016' }]);
  labels.update(mm, 1 / 60);
  ok('dom: setMarks adds an isobar value', layer.children.some(e => e.className === 'wxm wxm-iso' && !e.hidden));
  app.layers.labels = false;
  labels.update(mm, 1 / 60);
  ok('dom: the labels layer toggle hides the layer', layer.hidden === true);
  ok('css: labels.css has the [hidden] rule and Inter', /\[hidden\]\{display:none!important\}/.test(read('labels.css')) && /Inter/.test(read('labels.css')) && !/Playfair|Cormorant|JetBrains/.test(read('labels.css')));
}

// A small DOM stand-in: enough for createLabels.
function fakeDoc() {
  const doc = {
    createElement(tag) {
      const el = {
        tag, className: '', hidden: false, children: [], attrs: {}, q: {}, listeners: {}, textContent: '', parent: null, _html: '',
        style: { setProperty(k, v) { this[k] = v; } },
        classList: { toggle() {} },
        ownerDocument: doc,
        set innerHTML(v) { this._html = v; this.q = {}; },
        get innerHTML() { return this._html; },
        appendChild(c) { c.parent = this; this.children.push(c); return c; },
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
        setAttribute(k, v) { this.attrs[k] = v; },
        querySelector(sel) { return this.q[sel] || (this.q[sel] = doc.createElement('span')); },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        fire(type) { for (const fn of this.listeners[type] || []) fn({ stopPropagation() {} }); },
      };
      return el;
    },
  };
  return doc;
}
