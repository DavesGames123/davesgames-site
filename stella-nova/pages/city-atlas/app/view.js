// ============================================================================
//  VIEW  ·  city-atlas/app/view.js — the first view of a city
// ----------------------------------------------------------------------------
//  The camera looks at the skyline from the side with the most water, so the
//  first view of each city is the classic one from the harbour. The sun
//  stands 55 degrees round from that bearing. Also the contour step and the
//  exponential ease that the camera and the overlay fades use. No DOM.
//
//  grep -n targets
//    harbour bearing ...... "export function waterBearing"
//    sun azimuth .......... "export const sunAzOf"
//    default camera ....... "export function defaultView"
//    contour step ......... "export function contourStep"
//    ease ................. "export function ease"
// ============================================================================

// c: the worker's base stage ({ meta, arrays }). Degrees from north.
export function waterBearing(c) {
  const a = c.arrays.wf_in, n = a.shape[0], half = c.meta.grid.inner.half, R = c.meta.r * 1000;
  let best = 200, bestW = -1;
  for (let deg = 0; deg < 360; deg += 10) {
    const s = Math.sin(deg * Math.PI / 180), co = Math.cos(deg * Math.PI / 180);
    let w = 0;
    for (const f of [0.7, 1.0, 1.3, 1.7, 2.1]) {
      const x = s * R * f, y = co * R * f;
      const i = Math.floor((x + half) / (2 * half) * n), j = Math.floor((y + half) / (2 * half) * n);
      if (i >= 0 && j >= 0 && i < n && j < n) w += a.data[j * n + i] / 255;
    }
    if (w > bestW + 0.01) { bestW = w; best = deg; }
  }
  return best;
}

export const sunAzOf = (m) => ((m._bearing ?? 200) + 55) % 360;

// A portrait screen sees less across, so the camera backs off to keep the disc in view.
export function defaultView(m, w, h) {
  const R = (m?.r || 2.4) * 1000;
  const yawDeg = m?._bearing ?? 200;
  const aspect = w / Math.max(1, h);
  const k = Math.max(1, Math.pow(1.25 / aspect, 0.75));
  return { target: [0, 0, (m?.groundRef || 0)], yaw: yawDeg * Math.PI / 180, pitch: 0.42, dist: R * 2.05 * k };
}

export function contourStep(m) {
  const relief = Math.max(10, (m.terrain.max || 50) - (m.groundRef || 0));
  return relief > 600 ? 50 : relief > 200 ? 20 : relief > 60 ? 10 : 5;
}

export function ease(cur, goal, dt, tau) { return cur + (goal - cur) * (1 - Math.exp(-dt / tau)); }
