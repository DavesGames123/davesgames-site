// ============================================================================
//  PLANT GROWTH  ·  the 2D diagram of space colonisation (#diagram)
// ----------------------------------------------------------------------------
//  A flat plant (grow.js, flat: true) grows one step at a time on a 2D
//  canvas. Each step shows, for the node with the most attractors: the
//  influence radius d_i (dashed), the lines to its attractors, the mean
//  direction (an arrow), and the kill distance d_k round the new nodes.
//  Then the step runs, the new segments draw in, and the dead attractors
//  fade. When the plant stops, a new seed starts after a pause.
//  It draws only while the drawer is open (setOn).
// ============================================================================
import { createPlant } from './grow.js';

export function createDiagram(canvas) {
  const g = canvas.getContext('2d');
  let on = false, raf = 0, seed = 3, plant = null, phase = 0, t0 = 0, focus = -1, pulls = [], born = 0, dead = new Map();
  const PH = [1100, 700];   // ms: show the pulls, then grow
  function reset() {
    plant = createPlant({ species: 'oak', seed: seed++, flat: true, n: 150, crown: 1, D: 0.45, di: 2.3, dk: 0.7, maxNodes: 900 });
    phase = 0; t0 = performance.now(); dead.clear(); pick();
  }
  function pick() {
    focus = -1; pulls = [];
    if (!plant.reached) return;
    for (let v = 0; v < plant.count; v++) { const q = plant.pullsOf(v); if (q.length > pulls.length) { pulls = q; focus = v; } }
  }
  function size() {
    const r = canvas.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * d)), h = Math.max(10, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, d };
  }
  function draw(now) {
    raf = on ? requestAnimationFrame(draw) : 0;
    if (!plant) reset();
    const { w, h, d } = size();
    const sc = Math.min(w / 11.5, h / 11), ox = w / 2, oy = h - 0.4 * sc;
    const X = x => ox + x * sc, Y = y => oy - y * sc;
    const el = now - t0;
    if (phase === 0 && el > (plant.reached ? PH[0] : 160)) {
      const before = new Uint8Array(plant.alive);
      born = plant.count; plant.step();
      for (let a = 0; a < plant.nAttractors; a++) if (before[a] && !plant.alive[a]) dead.set(a, now);
      phase = 1; t0 = now;
    } else if (phase === 1 && el > (plant.reached ? PH[1] : 160)) {
      if (plant.done) { phase = 2; t0 = now; } else { phase = 0; t0 = now; pick(); }
    } else if (phase === 2 && el > 2600) reset();
    const k = phase === 1 ? Math.min(1, el / (PH[1] * 0.8)) : 1;

    g.fillStyle = '#f2efe6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#dfe6cf'; g.fillRect(0, oy, w, h - oy);
    // attractors
    const A = plant.attractors;
    for (let a = 0; a < plant.nAttractors; a++) {
      let al = 1;
      if (!plant.alive[a]) { const td = dead.get(a); al = td ? Math.max(0, 1 - (now - td) / 900) : 0; if (al <= 0) continue; }
      g.globalAlpha = al; g.fillStyle = plant.alive[a] ? '#7a8a6a' : '#c84a3a';
      g.beginPath(); g.arc(X(A[a * 3]), Y(A[a * 3 + 1]), 2.6 * d, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // branches (pipe radius, drawn at least 1 px)
    g.lineCap = 'round'; g.strokeStyle = '#5b4636';
    for (let i = 1; i < plant.count; i++) {
      const p = plant.parent[i], f = i >= born && phase === 1 ? k : 1;
      const x0 = X(plant.pos[p * 3]), y0 = Y(plant.pos[p * 3 + 1]);
      const x1 = X(plant.pos[i * 3]), y1 = Y(plant.pos[i * 3 + 1]);
      g.lineWidth = Math.max(1.2 * d, plant.radius[i] * sc * 2.2);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f); g.stroke();
    }
    // the kill distance round the new nodes
    if (phase === 1) {
      g.fillStyle = 'rgba(220,70,60,0.16)'; g.strokeStyle = 'rgba(200,74,58,0.6)'; g.lineWidth = d;
      for (let i = born; i < plant.count; i++) { g.beginPath(); g.arc(X(plant.pos[i * 3]), Y(plant.pos[i * 3 + 1]), plant.dk * sc * k, 0, 7); g.fill(); g.stroke(); }
    }
    // the focus node: influence radius, pulls, mean direction
    if (phase === 0 && focus >= 0) {
      const fx = X(plant.pos[focus * 3]), fy = Y(plant.pos[focus * 3 + 1]);
      const show = Math.min(1, el / 400);
      g.setLineDash([6 * d, 5 * d]); g.strokeStyle = '#4a8ad0'; g.lineWidth = 1.6 * d;
      g.beginPath(); g.arc(fx, fy, plant.di * sc * show, 0, 7); g.stroke(); g.setLineDash([]);
      g.strokeStyle = 'rgba(74,138,208,0.75)'; g.lineWidth = 1.2 * d;
      let mx = 0, my = 0;
      for (const a of pulls) {
        const ax = A[a * 3] - plant.pos[focus * 3], ay = A[a * 3 + 1] - plant.pos[focus * 3 + 1], l = Math.hypot(ax, ay) || 1;
        mx += ax / l; my += ay / l;
        g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + ax * sc * show, fy - ay * sc * show); g.stroke();
      }
      const ml = Math.hypot(mx, my) || 1, L = plant.D * sc * 2.4 * show;
      const ex = fx + mx / ml * L, ey = fy - my / ml * L;
      g.strokeStyle = '#e0602a'; g.fillStyle = '#e0602a'; g.lineWidth = 3 * d;
      g.beginPath(); g.moveTo(fx, fy); g.lineTo(ex, ey); g.stroke();
      const an = Math.atan2(ey - fy, ex - fx), hs = 9 * d;
      g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - hs * Math.cos(an - 0.45), ey - hs * Math.sin(an - 0.45)); g.lineTo(ex - hs * Math.cos(an + 0.45), ey - hs * Math.sin(an + 0.45)); g.fill();
      g.fillStyle = '#2a3a1a'; g.beginPath(); g.arc(fx, fy, 4 * d, 0, 7); g.fill();
    }
    g.fillStyle = '#4a5a3a'; g.font = `${12 * d}px Inter, system-ui, sans-serif`;
    g.fillText(`step ${plant.iter} · ${plant.count} nodes · ${plant.aliveCount} attractors`, 10 * d, 18 * d);
  }
  return {
    setOn(v) { on = !!v; if (on && !raf) raf = requestAnimationFrame(draw); },
  };
}
