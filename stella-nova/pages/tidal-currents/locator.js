// locator.js — the small locator globe: where on Earth the map is.
//
// An orthographic globe, drawn on a 2D canvas. Land and large lakes come
// from data/world.json (Natural Earth 1:50m, simplified). A graticule every
// 30 degrees. An outline shows the view extent, with the aspect of the view.
// A tiny outline grows to a minimum size and gets a ring
// so that it stays visible. setTarget() turns the globe to a new center over
// about 0.9 s.
//
// grep: function createLocator  function project  function outline  function drawRing

const D2R = Math.PI / 180;

export function createLocator(canvas, worldUrl) {
  const cx2 = canvas.getContext('2d');
  let world = null;
  let center = { lon: -100, lat: 40 };
  let from = center, to = center, t0 = 0;
  const TURN_MS = 900;
  let corners = null;
  let raf = 0;

  fetch(worldUrl).then((r) => (r.ok ? r.json() : null)).then((w) => {
    if (!w) return;
    const s = w.scale || 1;
    const unpack = (flat) => {
      const pts = new Float32Array(flat.length);
      for (let i = 0; i < flat.length; i++) pts[i] = flat[i] / s;
      return pts;
    };
    world = { land: w.land.map(unpack), lakes: (w.lakes || []).map(unpack) };
    draw();
  }).catch(() => { /* no land: the globe still shows the marker */ });

  // Orthographic projection about center c. Returns [x, y, visible].
  function project(lon, lat, c) {
    const l = (lon - c.lon) * D2R, p = lat * D2R, p0 = c.lat * D2R;
    const cosp = Math.cos(p);
    const x = cosp * Math.sin(l);
    const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cosp * Math.cos(l);
    const vis = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cosp * Math.cos(l) >= 0;
    if (vis) return [x, y, true];
    const n = Math.hypot(x, y) || 1;           // hidden: pin it to the limb
    return [x / n, y / n, false];
  }

  function drawRing(pts, c, R, ox, oy) {
    let any = false;
    cx2.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y, v] = project(pts[i], pts[i + 1], c);
      if (v) any = true;
      const sx = ox + x * R, sy = oy - y * R;
      if (i === 0) cx2.moveTo(sx, sy); else cx2.lineTo(sx, sy);
    }
    cx2.closePath();
    return any;
  }

  // The view extent as screen points: each edge of the lon/lat box sampled,
  // so that the outline follows the curve of the globe.
  function outline(quad, c, R, ox, oy) {
    const out = [];
    const N = 8;
    for (let e = 0; e < 4; e++) {
      const [a0, b0] = quad[e], [a1, b1] = quad[(e + 1) % 4];
      for (let i = 0; i < N; i++) {
        const [x, y] = project(a0 + (a1 - a0) * i / N, b0 + (b1 - b0) * i / N, c);
        out.push([ox + x * R, oy - y * R]);
      }
    }
    return out;
  }

  function draw() {
    raf = 0;
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    const now = performance.now();
    let c = to;
    if (now - t0 < TURN_MS) {
      const k = (now - t0) / TURN_MS;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      let dl = to.lon - from.lon;
      if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
      c = { lon: from.lon + dl * e, lat: from.lat + (to.lat - from.lat) * e };
      raf = requestAnimationFrame(draw);
    }
    center = c;
    const px = w / 100;                           // one hairline unit
    const R = Math.min(w, h) / 2 - 1.5 * px;
    const ox = w / 2, oy = h / 2;
    cx2.clearRect(0, 0, w, h);

    // sphere
    cx2.save();
    cx2.beginPath();
    cx2.arc(ox, oy, R, 0, Math.PI * 2);
    const g = cx2.createRadialGradient(ox - R * 0.35, oy - R * 0.4, R * 0.1, ox, oy, R);
    g.addColorStop(0, 'rgba(34, 44, 58, 0.95)');
    g.addColorStop(1, 'rgba(8, 11, 16, 0.95)');
    cx2.fillStyle = g;
    cx2.fill();
    cx2.clip();

    // graticule, every 30 degrees
    cx2.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    cx2.lineWidth = Math.max(0.6, 0.5 * px);
    for (let lon = -180; lon < 180; lon += 30) {
      cx2.beginPath();
      let pen = false;
      for (let lat = -90; lat <= 90; lat += 5) {
        const [x, y, v] = project(lon, lat, c);
        if (!v) { pen = false; continue; }
        if (pen) cx2.lineTo(ox + x * R, oy - y * R); else cx2.moveTo(ox + x * R, oy - y * R);
        pen = true;
      }
      cx2.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      cx2.beginPath();
      let pen = false;
      for (let lon = -180; lon <= 180; lon += 5) {
        const [x, y, v] = project(lon, lat, c);
        if (!v) { pen = false; continue; }
        if (pen) cx2.lineTo(ox + x * R, oy - y * R); else cx2.moveTo(ox + x * R, oy - y * R);
        pen = true;
      }
      cx2.stroke();
    }

    // land, then lakes cut back to the sea color
    if (world) {
      cx2.fillStyle = 'rgba(178, 180, 172, 0.42)';
      cx2.strokeStyle = 'rgba(235, 236, 230, 0.34)';
      cx2.lineWidth = Math.max(0.5, 0.45 * px);
      for (const ring of world.land) {
        if (drawRing(ring, c, R, ox, oy)) { cx2.fill(); cx2.stroke(); }
      }
      cx2.fillStyle = 'rgba(20, 27, 36, 0.95)';
      for (const ring of world.lakes) {
        if (drawRing(ring, c, R, ox, oy)) { cx2.fill(); cx2.stroke(); }
      }
    }
    cx2.restore();

    // limb hairline
    cx2.beginPath();
    cx2.arc(ox, oy, R, 0, Math.PI * 2);
    cx2.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    cx2.lineWidth = Math.max(0.7, 0.6 * px);
    cx2.stroke();

    // the view extent: its outline, and a ring when the outline is tiny
    if (corners) {
      const pts = outline(corners, c, R, ox, oy);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      // A tiny outline grows about its center to a minimum size. The growth
      // is uniform, so the outline keeps the aspect of the view.
      const grow = size > 0 ? Math.max(1, 5 * px / size) : 1;
      cx2.strokeStyle = '#ffd36b';
      cx2.shadowColor = 'rgba(255, 200, 90, 0.9)';
      cx2.shadowBlur = 4 * px;
      cx2.lineWidth = Math.max(1, 1.1 * px);
      cx2.lineJoin = 'round';
      cx2.beginPath();
      pts.forEach(([x, y], i) => {
        const sx = mx + (x - mx) * grow, sy = my + (y - my) * grow;
        if (i === 0) cx2.moveTo(sx, sy); else cx2.lineTo(sx, sy);
      });
      cx2.closePath();
      cx2.stroke();
      if (size < 8 * px) {
        cx2.beginPath();
        cx2.arc(mx, my, 9 * px, 0, Math.PI * 2);
        cx2.lineWidth = Math.max(0.6, 0.5 * px);
        cx2.strokeStyle = 'rgba(255, 211, 107, 0.55)';
        cx2.stroke();
      }
      cx2.shadowBlur = 0;
    }
  }

  function request() { if (!raf) raf = requestAnimationFrame(draw); }

  return {
    // Turn to lon/lat. corners: the view extent as four [lon, lat].
    setTarget(lon, lat, viewCorners, instant = false) {
      corners = viewCorners;
      const next = { lon, lat: Math.max(-60, Math.min(60, lat)) };
      if (instant || (Math.abs(next.lon - to.lon) < 0.01 && Math.abs(next.lat - to.lat) < 0.01)) {
        to = next; from = next; t0 = 0;
      } else {
        from = center; to = next; t0 = performance.now();
      }
      request();
    },
    setCorners(viewCorners) { corners = viewCorners; request(); },
    resize(cssPx) {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const n = Math.max(16, Math.round(cssPx * dpr));
      if (canvas.width !== n) { canvas.width = n; canvas.height = n; }
      request();
    },
  };
}
