// ============================================================================
//  PLANT GROWTH  ·  the 2D diagram of the model (#diagram)
// ----------------------------------------------------------------------------
//  A flat tree (grow.js, flat: true) grows one year per beat on a 2D canvas.
//  The diagram shows the parts of the model:
//    - the shadow grid: each voxel is shaded by the shadow s that the leafy
//      nodes above it cast (a pyramid that spreads and fades with depth);
//    - the buds: a dot per bud, sized and coloured by the resource v the
//      Borchert-Honda pass gave it (a bright, large dot grows a long shoot);
//    - the shoots of the year in a lighter wood colour as they grow;
//    - shed branches: they flash red and fall away.
//  A new seed starts after the last year. It draws only while the drawer is
//  open (setOn).
// ============================================================================
import { createSim } from './grow.js';

export function createDiagram(canvas) {
  const g = canvas.getContext('2d');
  let on = false, raf = 0, seed = 3, sim = null, t0 = 0, buds = [], prevDead = null, flash = [];
  const BEAT = 1300;
  function reset() {
    sim = createSim({ species: 'oak', seed: seed++, flat: true, maxNodes: 2600, years: 16 });
    sim.stepYear(); sim.allocate(); buds = sim.buds(); prevDead = new Uint8Array(sim.count); flash = [];
    t0 = performance.now();
  }
  function size() {
    const r = canvas.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * d)), h = Math.max(10, Math.round(r.height * d));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, d };
  }
  function draw(now) {
    raf = on ? requestAnimationFrame(draw) : 0;
    if (!sim) reset();
    const { w, h, d } = size();
    const el = now - t0;
    if (el > BEAT) {
      if (sim.done) { if (el > BEAT * 3) reset(); }
      else {
        const before = sim.count;
        sim.stepYear(); sim.allocate();
        buds = sim.buds();
        for (let i = 0; i < before; i++) if (sim.dead[i] && !prevDead[i] && sim.died[i] < 1e3) flash.push({ i, at: now });
        prevDead = new Uint8Array(sim.count); for (let i = 0; i < sim.count; i++) prevDead[i] = sim.dead[i];
        t0 = now;
      }
    }
    const grow = Math.min(1, (now - t0) / (BEAT * 0.7));
    // fit the tree: the grid box
    const Gd = sim.grid, vox = Gd.vox;
    let x0 = Infinity, x1 = -Infinity, y1 = 0.5;
    for (let i = 0; i < sim.count; i++) { if (sim.dead[i]) continue; x0 = Math.min(x0, sim.px[i]); x1 = Math.max(x1, sim.px[i]); y1 = Math.max(y1, sim.py[i]); }
    const span = Math.max(1.2, x1 - x0, y1) * 1.18;
    const sc = Math.min(w / span, (h * 0.9) / span), ox = w / 2 - (x0 + x1) / 2 * sc, oy = h - 0.06 * h;
    const X = x => ox + x * sc, Y = y => oy - y * sc;
    g.fillStyle = '#eef0e6'; g.fillRect(0, 0, w, h);
    // the shadow grid
    const G = Gd.G, NX = Gd.NX, NY = Gd.NY;
    for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) {
      const s = G[iy * NX + ix]; if (s < 0.05) continue;
      const k = Math.min(1, s / sim.shadow.C);
      g.fillStyle = `rgba(40,60,90,${(k * 0.55).toFixed(3)})`;
      const xx = X(Gd.x0 + ix * vox), yy = Y((iy + 1) * vox);
      g.fillRect(xx, yy, vox * sc + 0.5, vox * sc + 0.5);
    }
    g.fillStyle = '#d6dcc4'; g.fillRect(0, oy, w, h - oy);
    // branches: pipe radius, this year's shoots grow in
    const Y0 = sim.year - 1;
    g.lineCap = 'round';
    for (let i = 1; i < sim.count; i++) {
      const p = sim.parent[i]; if (p < 0 || sim.dead[i]) continue;
      const young = sim.year0[i] === Y0;
      const f = young ? grow : 1;
      g.strokeStyle = young ? '#a87a46' : '#5b4636';
      g.lineWidth = Math.max(1.1 * d, sim.radius[i] * sc * 2);
      const ax = X(sim.px[p]), ay = Y(sim.py[p]);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + (X(sim.px[i]) - ax) * f, ay + (Y(sim.py[i]) - ay) * f); g.stroke();
    }
    // shed branches flash and fall
    for (const fl of flash) {
      const a = (now - fl.at) / 1100; if (a > 1) continue;
      const i = fl.i, p = sim.parent[i]; if (p < 0) continue;
      g.strokeStyle = `rgba(200,60,40,${(1 - a).toFixed(3)})`; g.lineWidth = 1.5 * d;
      const dy = a * a * 60 * d;
      g.beginPath(); g.moveTo(X(sim.px[p]), Y(sim.py[p]) + dy); g.lineTo(X(sim.px[i]), Y(sim.py[i]) + dy); g.stroke();
    }
    flash = flash.filter(fl => now - fl.at < 1100);
    // leafy nodes
    g.fillStyle = 'rgba(80,140,50,0.75)';
    for (let i = 0; i < sim.count; i++) if (sim.leafy[i] && !sim.dead[i]) { g.beginPath(); g.arc(X(sim.px[i]), Y(sim.py[i]), 2.2 * d, 0, 7); g.fill(); }
    // buds by resource
    let vmax = 1; for (const b of buds) if (b.v > vmax) vmax = b.v;
    for (const b of buds) {
      if (b.v <= 0) continue;
      const k = Math.min(1, b.v / vmax);
      g.fillStyle = `rgb(${Math.round(240 * k + 60)},${Math.round(120 + 80 * k)},${Math.round(40)})`;
      g.beginPath(); g.arc(X(sim.px[b.node]), Y(sim.py[b.node]), (1.6 + 4 * Math.sqrt(k)) * d, 0, 7); g.fill();
    }
    g.fillStyle = '#3a4a2a'; g.font = `${12 * d}px Inter, system-ui, sans-serif`;
    const st = sim.stats[sim.year - 1];
    g.fillText(`year ${sim.year} · ${st ? st.live : 0} metamers · ${buds.length} buds · ${st ? st.shed : 0} branches shed`, 10 * d, 18 * d);
  }
  return { setOn(v) { on = !!v; if (on && !raf) raf = requestAnimationFrame(draw); } };
}
