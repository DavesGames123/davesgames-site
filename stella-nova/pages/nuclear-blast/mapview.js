// ============================================================================
//  NUCLEAR BLAST  ·  mapview.js — the 2D place map
// ----------------------------------------------------------------------------
//  A Web Mercator map on a 2D canvas (geo.js), drawn from the Natural Earth
//  coastlines and borders and, where a City Atlas city covers the view, its
//  land cover, water and building footprints (places.js). On it: ground
//  zero, the effect rings as geodesic circles with their radius in km, the
//  shock front while the burst plays, and a scale bar.
//
//  Input: drag to pan, wheel or pinch to zoom, click (or tap) to place
//  ground zero (opts.onPick), hover for the distance and the overpressure
//  there (opts.onHover). The map draws only when something changed.
//
//  GREP MAP
//    function draw ............ the layers, in order
//    function drawRings ....... rings, labels, ground zero, shock front
//    function drawScale ....... the scale bar
//    pointer handlers ......... pan, pinch, click, hover
// ============================================================================
import * as G from './geo.js';

const INK = { sea: '#0a111c', grid: 'rgba(140,160,190,0.06)', coast: 'rgba(170,190,215,0.75)', border: 'rgba(170,190,215,0.28)', dot: '#cfd6e2', label: 'rgba(214,220,232,0.86)', halo: 'rgba(8,10,16,0.85)' };

// o: { canvas, places (promise), onPick(lon, lat), onHover(lon, lat | null) }
export function createMap(o) {
  const cv = o.canvas, M = { lon: 10, lat: 25, z: 1.6, P: null, city: null, gz: null, rings: [], front: 0, dirty: true, visible: true };
  o.places.then(P => { M.P = P; M.dirty = true; });
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const size = () => {
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (r.width !== W || r.height !== H || d !== dpr) { W = r.width; H = r.height; dpr = d; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); M.dirty = true; }
  };
  // screen <-> lon, lat
  const center = () => G.project(M.lon, M.lat, M.z);
  M.toScreen = (lon, lat) => { const c = center(), p = G.project(lon, lat, M.z); return { x: W / 2 + p.x - c.x, y: H / 2 + p.y - c.y }; };
  M.toLonLat = (x, y) => { const c = center(); return G.unproject(c.x + x - W / 2, c.y + y - H / 2, M.z); };
  M.setView = (lon, lat, z) => { M.lon = lon; M.lat = Math.max(-80, Math.min(80, lat)); M.z = Math.max(1, Math.min(17, z)); M.dirty = true; };
  // fit a radius (m) around a point into the view
  M.fit = (lon, lat, R) => { const z = Math.log2(2 * Math.PI * G.R_EARTH * Math.cos(lat * Math.PI / 180) / 256 / (R * 2.6 / Math.max(200, Math.min(W, H)))); M.setView(lon, lat, z); };
  M.setGZ = gz => { M.gz = gz; M.dirty = true; };
  M.setRings = rings => { M.rings = rings; M.dirty = true; };
  M.setFront = f => { if (Math.abs(f - M.front) > 0.5) { M.front = f; M.dirty = true; } };
  M.setCity = c => { M.city = c; M.dirty = true; };

  function polyline(run) {
    const p = run.p, c = center(), s = 256 * Math.pow(2, M.z), ox = W / 2 - c.x, oy = H / 2 - c.y;
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) {
      const la = Math.max(-85, Math.min(85, p[i + 1])) * Math.PI / 180;
      const x = (p[i] + 180) / 360 * s + ox, y = (1 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / Math.PI) / 2 * s + oy;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  function visibleBox() { const a = M.toLonLat(0, 0), b = M.toLonLat(W, H); return { x0: a.lon, x1: b.lon, y0: b.lat, y1: a.lat }; }
  function drawCityImage(img, cx, cy, half) {
    // the city frame: metres east and north of the centre; a small square, so
    // the Mercator stretch across it is uniform
    const nw = G.fromLocal(-half, -half, cx, cy), se = G.fromLocal(half, half, cx, cy);
    const a = M.toScreen(nw.lon, nw.lat), b = M.toScreen(se.lon, se.lat);
    if (b.x < 0 || a.x > W || b.y < 0 || a.y > H) return;
    ctx.drawImage(img, a.x, a.y, b.x - a.x, b.y - a.y);
  }
  function drawRings() {
    const gz = M.gz; if (!gz) return;
    const mpp = G.metresPerPixel(gz.lat, M.z), c = M.toScreen(gz.lon, gz.lat);
    // fills, largest first, then strokes and labels
    const rs = M.rings.filter(r => r.R > 0 && r.on).sort((a, b) => b.R - a.R);
    for (const r of rs) {
      const path = G.ringPath(gz.lon, gz.lat, r.R, 160);
      ctx.beginPath(); path.forEach((q, i) => { const s = M.toScreen(q.lon, q.lat); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.closePath();
      ctx.fillStyle = r.col + '1f'; ctx.fill();
      ctx.setLineDash(r.dash ? [6, 4] : []); ctx.lineWidth = 2; ctx.strokeStyle = r.col; ctx.stroke(); ctx.setLineDash([]);
    }
    // labels at the ring edge: the first free angle of ANG, so no two
    // labels overlap; a ring with no free place keeps its legend row only
    ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const ANG = [-0.35, 0.35, -0.9, 0.9, -1.3, 1.3, -0.05], taken = [];
    for (const r of [...rs].reverse()) {
      const px = r.R / mpp;
      if (px < 6) continue;
      const txt = `${r.name} · ${fmtKm(r.R)}`, w = ctx.measureText(txt).width + 12;
      for (const a of ANG) {
        const x = c.x + px * Math.cos(a), y = c.y + px * Math.sin(a), bx = [x - 3, y - 10, x + w + 6, y + 10];
        if (bx[2] > W - 4 || bx[1] < 4 || bx[3] > H - 4) continue;
        if (taken.some(q => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue;
        taken.push(bx);
        ctx.fillStyle = INK.halo; roundRect(x + 4, y - 9, w, 18, 9); ctx.fill();
        ctx.strokeStyle = r.col; ctx.lineWidth = 1; roundRect(x + 4, y - 9, w, 18, 9); ctx.stroke();
        ctx.fillStyle = '#f2ece0'; ctx.fillText(txt, x + 10, y + 0.5);
        ctx.fillStyle = r.col; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 6.283); ctx.fill();
        break;
      }
    }
    // shock front while the burst plays
    if (M.front > 0) {
      const path = G.ringPath(gz.lon, gz.lat, M.front, 160);
      ctx.beginPath(); path.forEach((q, i) => { const s = M.toScreen(q.lon, q.lat); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
    }
    // ground zero
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(c.x - 9, c.y); ctx.lineTo(c.x + 9, c.y); ctx.moveTo(c.x, c.y - 9); ctx.lineTo(c.x, c.y + 9); ctx.stroke();
    ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, 6.283); ctx.stroke();
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  let scalePx = 0;
  function drawScale() {
    const lat = M.gz ? M.gz.lat : M.lat, mpp = G.metresPerPixel(lat, M.z), L = G.niceScale(mpp * 120), px = L / mpp;
    const x = 16, y = H - (o.scaleInset ? o.scaleInset() : 16);
    scalePx = px;
    ctx.fillStyle = INK.halo; ctx.fillRect(x - 6, y - 22, px + 12, 30);
    ctx.strokeStyle = '#e6e9f0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 6); ctx.stroke();
    ctx.fillStyle = '#e6e9f0'; ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(fmtKm(L), x + 2, y - 9);
  }
  function draw() {
    size();
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = INK.sea; ctx.fillRect(0, 0, W, H);
    // graticule, every 10 degrees (1 degree when close)
    const B = visibleBox(), step = M.z > 7 ? 1 : 10;
    ctx.strokeStyle = INK.grid; ctx.lineWidth = 1;
    for (let lon = Math.ceil(B.x0 / step) * step; lon <= B.x1; lon += step) { const a = M.toScreen(lon, 0); ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, H); ctx.stroke(); }
    for (let lat = Math.ceil(B.y0 / step) * step; lat <= B.y1; lat += step) { const a = M.toScreen(0, lat); ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke(); }
    // the City Atlas city: land cover and water, then footprints when close
    const C = M.city;
    if (C) {
      ctx.imageSmoothingEnabled = true;
      drawCityImage(C.outer.canvas, C.meta.lon, C.meta.lat, C.outer.half);
      if (M.z > 10.5) drawCityImage(C.inner.canvas, C.meta.lon, C.meta.lat, C.inner.half);
      if (M.z > 12) drawCityImage(C.foot.canvas, C.meta.lon, C.meta.lat, C.foot.half);
    }
    const P = M.P;
    if (P) {
      // The Natural Earth lines are simplified to about 4 km: fade them out
      // as the view closes in, and drop them over a City Atlas raster
      const pad = 2, fade = C && M.z > 8.5 && G.distance(M.lon, M.lat, C.meta.lon, C.meta.lat) < C.outer.half * 0.7 ? 0 : clamp01((11 - M.z) / 3) * 0.75 + 0.25;
      ctx.lineJoin = 'round'; ctx.globalAlpha = fade;
      ctx.strokeStyle = INK.border; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      for (const r of P.borders) if (r.x1 >= B.x0 - pad && r.x0 <= B.x1 + pad && r.y1 >= B.y0 - pad && r.y0 <= B.y1 + pad) polyline(r);
      ctx.setLineDash([]);
      ctx.strokeStyle = INK.coast; ctx.lineWidth = M.z > 9 ? 1.6 : 1.1;
      for (const r of P.coast) if (r.x1 >= B.x0 - pad && r.x0 <= B.x1 + pad && r.y1 >= B.y0 - pad && r.y0 <= B.y1 + pad) polyline(r);
      ctx.globalAlpha = 1;
      // place names: the largest first, none overlapping
      const max = M.z < 3 ? 40 : M.z < 6 ? 120 : 220, boxes = [];
      ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
      let shown = 0;
      for (const c of P.cities) {
        if (shown >= max) break;
        if (c.lon < B.x0 || c.lon > B.x1 || c.lat < B.y0 || c.lat > B.y1) continue;
        const s = M.toScreen(c.lon, c.lat), w = ctx.measureText(c.name).width;
        const bx = [s.x - 3, s.y - 7, s.x + w + 10, s.y + 7];
        if (boxes.some(q => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) continue;
        boxes.push(bx); shown++;
        ctx.fillStyle = INK.dot; ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, 6.283); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = INK.halo; ctx.strokeText(c.name, s.x + 6, s.y);
        ctx.fillStyle = INK.label; ctx.fillText(c.name, s.x + 6, s.y);
      }
    }
    drawRings();
    drawScale();
    // attribution at the lower right; above the scale bar when the two would meet
    ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = 'rgba(200,205,220,0.55)'; ctx.textAlign = 'right';
    let att = C ? 'Natural Earth · © OpenStreetMap contributors, Overture Maps (ODbL) · ESA WorldCover' : 'Natural Earth';
    if (ctx.measureText(att).width > W - 16) att = '© OpenStreetMap, Overture (ODbL) · WorldCover · Natural Earth';
    const ay = H - (o.scaleInset ? o.scaleInset() : 16) + 4;
    ctx.fillText(att, W - 8, W - 8 - ctx.measureText(att).width < 16 + scalePx + 16 ? ay - 32 : ay);
    ctx.textAlign = 'left';
  }
  M.frame = () => { if (!M.visible) return; size(); if (M.dirty) { M.dirty = false; draw(); } };
  M.redraw = () => { M.dirty = true; };

  // ── pointer handlers: pan, pinch, click, hover ──
  const pts = new Map();
  let drag = null, pinch = null, moved = false;
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, c: center(), t: performance.now() };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: M.z }; drag = null; }
  });
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect();
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
      zoomAt(mx, my, pinch.z + Math.log2(d / Math.max(1, pinch.d)) - M.z); moved = true; return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      if (moved) { const q = G.unproject(drag.c.x - dx, drag.c.y - dy, M.z); M.setView(q.lon, q.lat, M.z); }
      return;
    }
    if (o.onHover && e.pointerType === 'mouse') { const q = M.toLonLat(e.clientX - r.left, e.clientY - r.top); o.onHover(q.lon, q.lat, e.clientX - r.left, e.clientY - r.top); }
  });
  const end = e => {
    const r = cv.getBoundingClientRect();
    if (drag && !moved && pts.size === 1 && performance.now() - drag.t < 700 && o.onPick) { const q = M.toLonLat(e.clientX - r.left, e.clientY - r.top); o.onPick(q.lon, q.lat); }
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) drag = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); drag = null; pinch = null; });
  cv.addEventListener('pointerleave', () => { if (o.onHover) o.onHover(null); });
  function zoomAt(x, y, dz) {
    const before = M.toLonLat(x, y);
    M.z = Math.max(1, Math.min(17, M.z + dz));
    const p = G.project(before.lon, before.lat, M.z), q = G.unproject(p.x - (x - W / 2), p.y - (y - H / 2), M.z);
    M.setView(q.lon, q.lat, M.z);
  }
  M.zoomBy = dz => zoomAt(W / 2, H / 2, dz);
  cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, -e.deltaY * (e.deltaMode ? 0.05 : 0.0022)); }, { passive: false });
  return M;
}
const clamp01 = x => Math.max(0, Math.min(1, x));
export function fmtKm(m) { return m >= 10000 ? (m / 1000).toFixed(0) + ' km' : m >= 1000 ? (m / 1000).toFixed(1) + ' km' : (m / 1000).toFixed(2) + ' km'; }
