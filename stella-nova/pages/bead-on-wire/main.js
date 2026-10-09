// ============================================================================
//  BEAD ON A WIRE  ·  pages/bead-on-wire/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. Ten Minute Physics #05 "bead" by Matthias Müller, MIT License
//  (the notice is kept at the top of sim.js, which holds the upstream PBD
//  bead and the analytic bead). The credit bar names the author on the
//  page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): wire shapes, several
//  beads, force arrows, this renderer, the sim kit GUI and the saver.
//
//  grep -n targets: "function rebuild", "function draw",
//  "function bindPointer", "window.__bead"
// ============================================================================
import * as SM from './sim.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { page2d, background, lutColor } from '../../widgets/sim-kit/page2d.js';
import { installSaver } from './saver.js';

TMP.page({ n: '05', title: 'Bead on a Wire', file: '05-bead.html', video: 'qISgdDhdCro', year: 2021, licence: 'MIT' });

const PHONE = isPhone();
const canvas = document.getElementById('view');
const S = SM.createSim();
let kit, P, veil = 1, wire = null;

function rebuild() { SM.buildScene(S, kit.state, SM.sceneRng(kit.seed)); wire = SM.wirePoints(S); veil = 1; }
const twinsShown = () => kit.state.analytic && S.C.type === 'circle' && Math.abs(kit.state.tilt) < 1e-9;

function beadColor(b, twin, lut, pal) {
  const st = kit.state;
  if (st.colorBy === 'speed' && lut && !twin) return lutColor(lut, 0.15 + 0.85 * Math.min(1, Math.hypot(b.vx, b.vy) / 8));
  if (st.colorBy === 'force' && lut) return lutColor(lut, 0.15 + 0.85 * Math.min(1, b.force / (6 * st.g)));
  return twin ? pal[(2 + b.c) % pal.length] : pal[b.c % pal.length];
}

function arrow(ctx, x, y, dx, dy, col, w) {
  const L = Math.hypot(dx, dy); if (L < 2) return;
  const ux = dx / L, uy = dy / L, hd = Math.min(12 * w, L * 0.4);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2 * w;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx - ux * hd, y + dy - uy * hd); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx - ux * hd - uy * hd * 0.5, y + dy - uy * hd + ux * hd * 0.5); ctx.lineTo(x + dx - ux * hd + uy * hd * 0.5, y + dy - uy * hd - ux * hd * 0.5); ctx.fill();
}

function draw(ctx, v) {
  const st = kit.state, t = K.themeById(st.theme), s = v.s, d = P.dpr;
  background(ctx, t, P.w, P.h, st.grid ? v : null, 0.2);
  const pal = K.paletteColors(st.palette), lut = st.colorBy === 'palette' ? null : P.lut(st.cmap);
  // the wire: a soft glow, then the wire itself
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [wd, a] of [[10, 0.08], [4, 0.2], [1.6, 0.9]]) {
    ctx.strokeStyle = t.wall; ctx.globalAlpha = a; ctx.lineWidth = wd * d; ctx.beginPath();
    wire.forEach((p, k) => k ? ctx.lineTo(v.X(p[0]), v.Y(p[1])) : ctx.moveTo(v.X(p[0]), v.Y(p[1]))); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!S.C.closed) for (const p of [wire[0], wire[wire.length - 1]]) { ctx.fillStyle = t.wall; ctx.fillRect(v.X(p[0]) - 3 * d, v.Y(p[1]) - 8 * d, 6 * d, 16 * d); }
  const twins = twinsShown() ? S.twins : [];
  // trails
  for (const [b, tw] of S.beads.map(b => [b, false]).concat(twins.map(a => [a, true]))) {
    const N = Math.min(b.tN, S.TL); if (N < 2) continue;
    ctx.strokeStyle = beadColor(b, tw, null, pal); ctx.lineWidth = Math.max(1, s * 0.012);
    const seg = 16;
    for (let a = 0; a < N - 1; a += seg) { ctx.globalAlpha = 0.7 * ((a + seg / 2) / N) ** 1.3; ctx.beginPath(); for (let k = a; k <= Math.min(N - 1, a + seg); k++) { const j = (b.tN - N + k) % S.TL; k === a ? ctx.moveTo(v.X(b.tx[j]), v.Y(b.ty[j])) : ctx.lineTo(v.X(b.tx[j]), v.Y(b.ty[j])); } ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  // beads, twins, force arrows
  const fScale = s * 0.35 / (3 * st.g);
  for (const [b, tw] of twins.map(a => [a, true]).concat(S.beads.map(b => [b, false]))) {
    const X = v.X(b.x), Y = v.Y(b.y), R = Math.max(3, s * 0.06 * (tw ? 0.85 : 1)), col = beadColor(b, tw, lut, pal);
    if (st.arrows) {
      // along the wire's push: the last PBD correction, or toward the centre for the analytic twin
      let ux, uy;
      if (tw) { const dx = S.C.cx - b.x, dy = S.C.cy - b.y, L = Math.hypot(dx, dy) || 1; ux = dx / L * Math.sign(b.force || 1); uy = dy / L * Math.sign(b.force || 1); }
      else { ux = b.nx || 0; uy = b.ny || 0; }
      const f = Math.min(Math.abs(b.force) * fScale, s * 0.6);
      if (!tw || S.beads.length === 1) arrow(ctx, X, Y, ux * f, -uy * f, col, d * (tw ? 0.7 : 1));
    }
    if (st.glow) { const g = ctx.createRadialGradient(X, Y, 0, X, Y, R * 3); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.3; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R * 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    const g = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.1, X, Y, R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, col);
    ctx.globalAlpha = tw ? 0.8 : 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    if (tw) { ctx.strokeStyle = col; ctx.lineWidth = 1.5 * d; ctx.beginPath(); ctx.arc(X, Y, R * 1.35, 0, 7); ctx.stroke(); }
  }
  // the upstream readout: constraint force of the PBD bead and the analytic one
  if (!kit.saver && S.beads.length) {
    ctx.font = `${12 * d}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.fillStyle = t.ink; ctx.globalAlpha = 0.85;
    const x0 = v.rect.x + 8 * d, y0 = v.rect.y + 14 * d;
    ctx.fillText(`PBD force ${S.beads[0].force.toFixed(2)} N`, x0, y0);
    if (twins.length) ctx.fillText(`Analytic force ${twins[0].force.toFixed(2)} N`, x0, y0 + 18 * d);
    ctx.globalAlpha = 1;
  }
  if (veil > 0) { ctx.fillStyle = t.bg; ctx.globalAlpha = veil; ctx.fillRect(0, 0, P.w, P.h); ctx.globalAlpha = 1; }
}

function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    if (!P.view || kit.saver) return;
    const [x, y] = P.toWorld(e), g = SM.pick(S, x, y);
    if (!g) return;
    canvas.setPointerCapture(e.pointerId); S.grab = g;
  });
  canvas.addEventListener('pointermove', e => { if (!S.grab) return; const [x, y] = P.toWorld(e); S.grab.x = x; S.grab.y = y; });
  const up = () => { S.grab = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

kit = mount({
  schema: SM.makeSchema(PHONE), title: 'Bead on a Wire', sub: 'Position based dynamics against the analytic solution', panelTitle: 'Scene', guard: SM.guard,
  footer: 'Upstream demo: Ten Minute Physics #05 by Matthias Müller (MIT). Wire shapes, several beads, look and GUI: davesgames.io.',
  actions: {},
});
kit.on('change', (out, st, why) => {
  if (why === 'scene' || why === 'group' || why === 'saver') return;
  if (Object.keys(out).some(k => SM.REBUILD.has(k))) rebuild(); else SM.applyParams(S, kit.state);
});
kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SM.REBUILD.has(k))) rebuild(); else SM.applyParams(S, kit.state); });
kit.on('reset', rebuild);
P = page2d({ canvas, kit, world: () => ({ w: SM.W, h: SM.H }), step: h => SM.step(S, h), draw: (ctx, v, dt) => { veil = Math.max(0, veil - dt / 0.45); draw(ctx, v); } });
if (!kit.fromHash) kit.newScene(); else rebuild();
bindPointer();
addEventListener('pagehide', () => { kit.playing = false; });

window.__bead = { S, get kit() { return kit; }, canvas, rebuild, P };
installSaver(window.__bead);
