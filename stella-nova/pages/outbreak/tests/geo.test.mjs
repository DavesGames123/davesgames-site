// geo and camera (package E): axis convention, arcs, Equal Earth, flights
import { readFileSync } from 'node:fs';
import { sphere, flat, gcDist, arcPoints, arcAt, equalEarthRaw, EE_SCALE, latLonOf, slerpLL } from '../geo.js';
import { pose, flight, ease, spring, pathDeg } from '../camera.js';

const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const nearV = (a, b, e = 1e-9) => a.every((v, i) => near(v, b[i], e));
const len = v => Math.hypot(v[0], v[1], v[2]);

export default function (ok) {
  // Axis convention: x = cos lat cos lon, y = sin lat, z = -cos lat sin lon.
  ok('geo: sphere(0,0) = +x', nearV(sphere(0, 0), [1, 0, 0]));
  ok('geo: sphere(0,90) = -z', nearV(sphere(0, 90), [0, 0, -1]));
  ok('geo: sphere(90,0) = +y', nearV(sphere(90, 0), [0, 1, 0]));
  ok('geo: sphere h scales the radius', near(len(sphere(33, -71, 0.25)), 1.25));
  const ll = latLonOf(sphere(-37.8, 144.9));
  ok('geo: latLonOf inverts sphere', near(ll[0], -37.8, 1e-9) && near(ll[1], 144.9, 1e-9), ll.join());

  // Flat map: width 4, equirect height 2.
  ok('geo: equirect corners', nearV(flat(90, 180), [2, 1, 0]) && nearV(flat(-90, -180, 0.1), [-2, -1, 0.1]));
  ok('geo: equal earth equator width 4', near(flat(0, 180, 0, 'equalearth')[0], 2, 1e-12));

  // Equal Earth against PROJ 9.8 (map-projections/tests/proj-ref.json).
  const ref = JSON.parse(readFileSync(new URL('../../map-projections/tests/proj-ref.json', import.meta.url), 'utf8'));
  const ee = ref.cases.find(c => c.key === 'equal-earth');
  let worst = 0;
  for (const [lon, lat, x, y] of ee.rows) {
    const p = equalEarthRaw(lon * Math.PI / 180, lat * Math.PI / 180);
    worst = Math.max(worst, Math.abs(p[0] - x), Math.abs(p[1] - y));
    const f = flat(lat, lon, 0, 'equalearth');
    worst = Math.max(worst, Math.abs(f[0] - x * EE_SCALE), Math.abs(f[1] - y * EE_SCALE));
  }
  ok('geo: equal earth matches PROJ 9.8', ee.rows.length >= 3 && worst < 1e-9, `${ee.rows.length} rows, worst ${worst.toExponential(2)}`);

  // Great-circle distance: London to New York about 5570 km.
  const km = gcDist(51.5074, -0.1278, 40.7128, -74.006) * 6371;
  ok('geo: gcDist London-New York', Math.abs(km - 5570) < 15, km.toFixed(0));
  ok('geo: gcDist quarter turn', near(gcDist(0, 0, 0, 90), Math.PI / 2, 1e-12));

  // Arcs end at their endpoints and peak at t = 0.5.
  const a = { lat: 51.5, lon: -0.1 }, b = { lat: 35.7, lon: 139.7 }, lift = 0.25, n = 33;
  for (const mode of ['globe', 'equirect', 'equalearth']) {
    const pts = arcPoints(a, b, n, lift, mode);
    const p0 = [pts[0], pts[1], pts[2]], pn = [pts[3 * n - 3], pts[3 * n - 2], pts[3 * n - 1]];
    const ea = mode === 'globe' ? sphere(a.lat, a.lon) : flat(a.lat, a.lon, 0, mode);
    const eb = mode === 'globe' ? sphere(b.lat, b.lon) : flat(b.lat, b.lon, 0, mode);
    ok(`geo: ${mode} arc ends at its endpoints`, nearV(p0, ea, 1e-6) && nearV(pn, eb, 1e-6));
    const h = i => mode === 'globe' ? len([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]]) - 1 : pts[3 * i + 2];
    let top = 0;
    for (let i = 1; i < n; i++) if (h(i) > h(top)) top = i;
    const ang = gcDist(a.lat, a.lon, b.lat, b.lon);
    ok(`geo: ${mode} arc peaks at t = 0.5`, top === (n - 1) / 2 && Math.abs(h(top) - lift * ang) < 1e-6, `top ${top}, h ${h(top).toFixed(4)}`);
  }
  // Globe arc stays on the great circle: the mid point is the slerp mid point.
  const mid = arcAt(a, b, 0.5, 0, 'globe'), mll = slerpLL(a, b, 0.5);
  ok('geo: globe arc mid point on the great circle', nearV(mid, sphere(mll[0], mll[1]), 1e-9)
    && near(gcDist(a.lat, a.lon, mll[0], mll[1]), gcDist(mll[0], mll[1], b.lat, b.lon), 1e-9));
  const anti = arcPoints({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, 9, 0.1, 'globe');
  ok('geo: antipodal arc has no NaN', anti.every(Number.isFinite));

  // Camera pose: tilt 0 on the globe puts the camera at 1 + alt on the radius.
  const p = pose({ lat: 0, lon: 0, alt: 1.5, tilt: 0, heading: 0 }, 'globe');
  ok('camera: globe pose top-down', nearV(p.pos, [2.5, 0, 0]) && nearV(p.target, [1, 0, 0]) && nearV(p.up, [0, 1, 0]));
  const q = pose({ lat: 20, lon: 40, alt: 0.8, tilt: 35, heading: 70 }, 'globe');
  const view = [0, 1, 2].map(i => q.target[i] - q.pos[i]);
  ok('camera: up is a unit vector at right angles to the view', near(len(q.up), 1, 1e-12)
    && near(view[0] * q.up[0] + view[1] * q.up[1] + view[2] * q.up[2], 0, 1e-12)
    && near(len(view), 0.8, 1e-12));
  const fp = pose({ lat: 0, lon: 90, alt: 2, tilt: 0, heading: 0 }, 'flat');
  ok('camera: flat pose above the map', nearV(fp.pos, [1, 0, 2]) && nearV(fp.up, [0, 1, 0]));

  // ease and spring.
  ok('camera: ease ends and mid', ease(0) === 0 && ease(1) === 1 && near(ease(0.5), 0.5) && ease(-1) === 0 && ease(2) === 1);
  let x = 0, v = 0, over = false, mono = true, prev = 0;
  for (let i = 0; i < 600; i++) {
    ({ x, v } = spring(x, 1, v, 1 / 60, 6));
    if (x > 1 + 1e-12) over = true;
    if (x < prev - 1e-12) mono = false;
    prev = x;
  }
  ok('camera: spring settles with no overshoot', !over && mono && near(x, 1, 1e-6), x.toFixed(8));
  const big = spring(0, 1, 0, 10, 6);
  ok('camera: spring is stable for a large dt', Number.isFinite(big.x) && big.x <= 1 && big.x > 0.99);

  // Flights hold their angular speed cap.
  const pairs = [
    [{ lat: 51.5, lon: -0.1, alt: 1, tilt: 0, heading: 0 }, { lat: -33.9, lon: 151.2, alt: 0.6, tilt: 30, heading: 200 }],
    [{ lat: 10, lon: 170, alt: 2, tilt: 10, heading: 350 }, { lat: -5, lon: -170, alt: 1, tilt: 0, heading: 10 }],
    [{ lat: 0, lon: 0, alt: 1, tilt: 0, heading: 0 }, { lat: 0.5, lon: 0.5, alt: 1.2, tilt: 0, heading: 0 }],
  ];
  for (const mode of ['globe', 'flat']) {
    for (const cap of [20, 45]) {
      let worstRate = 0, endOk = true, startOk = true, hdOk = true;
      for (const [f, t] of pairs) {
        const fl = flight(f, t, { maxDegPerSec: cap, mode });
        const steps = 2000, dt = fl.dur / steps;
        let last = fl.at(0), lastH = last.heading;
        startOk = startOk && near(last.lat, f.lat, 1e-9) && near(last.lon, f.lon, 1e-9) && near(last.alt, f.alt, 1e-9);
        for (let i = 1; i <= steps; i++) {
          const c = fl.at(i * dt);
          worstRate = Math.max(worstRate, pathDeg(last, c, mode) / dt);
          const dh = Math.abs(((c.heading - lastH + 540) % 360) - 180);
          if (dh > 5) hdOk = false;
          last = c; lastH = c.heading;
        }
        const e = fl.at(fl.dur + 1);
        endOk = endOk && near(e.lat, t.lat, 1e-9) && near(e.lon, t.lon, 1e-9) && near(e.alt, t.alt, 1e-9) && near(e.tilt, t.tilt, 1e-9);
      }
      ok(`camera: ${mode} flight holds ${cap} deg/s`, worstRate <= cap * 1.001, `peak ${worstRate.toFixed(2)}`);
      ok(`camera: ${mode} flight starts and ends on its cams`, startOk && endOk);
      ok(`camera: ${mode} flight heading turns the short way`, hdOk);
    }
  }
  ok('camera: short flight uses minDur', near(flight(pairs[2][0], pairs[2][1], { minDur: 1.2 }).dur, 1.2));
}
