// ============================================================================
//  TRIPLE PENDULUM  ·  pages/triple-pendulum/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. Ten Minute Physics #06 "pendulum" by Matthias Müller, MIT
//  License (the notice is kept at the top of sim.js, which holds the
//  upstream PBD and analytic steps). The credit bar names the author on
//  the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): random chains, the second
//  copy, dragging, this renderer, the sim kit GUI and the saver.
//
//  The pendulum coordinates have the pivot at (0, 0); the view adds
//  (W/2, H/2).
//
//  grep -n targets: "function rebuild", "function draw",
//  "function bindPointer", "window.__tri"
// ============================================================================
import * as SM from './sim.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { page2d, background, lutColor } from '../../widgets/sim-kit/page2d.js';
import { installSaver } from './saver.js';

TMP.page({ n: '06', title: 'Triple Pendulum', file: '06-pendulum.html', video: 'XPZEeS70zzU', year: 2021, licence: 'MIT' });

const PHONE = isPhone();
const canvas = document.getElementById('view');
const S = SM.createSim();
const OX = SM.W / 2, OY = SM.H / 2;
let kit, P, veil = 1;

function rebuild() { SM.buildScene(S, kit.state, SM.sceneRng(kit.seed)); veil = 1; }
const shown = p => p.kind !== 'analytic' || (kit.state.analytic && SM.subsOf(kit.state) >= 100);

function colorOf(p, i, lut, pal) {
  if (kit.state.colorBy === 'speed' && lut) return lutColor(lut, 0.15 + 0.85 * Math.min(1, Math.hypot(p.vx[i], p.vy[i]) / 5));
  return pal[{ pbd: 0, analytic: 2, twin: 3 }[p.kind] % pal.length];
}

function draw(ctx, v) {
  const st = kit.state, t = K.themeById(st.theme), s = v.s;
  background(ctx, t, P.w, P.h, st.grid ? v : null, 0.08);
  const pal = K.paletteColors(st.palette), lut = st.colorBy === 'palette' ? null : P.lut(st.cmap);
  const X = x => v.X(x + OX), Y = y => v.Y(y + OY);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of S.list) {
    if (!shown(p)) continue;
    const N = Math.min(p.tN, S.TL), e = p.x.length - 1, col = colorOf(p, e, null, pal);
    if (N < 2) continue;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, s * 0.0035);
    const seg = 32;
    for (let a = 0; a < N - 1; a += seg) {
      ctx.globalAlpha = 0.9 * ((a + seg / 2) / N) ** 1.4; ctx.beginPath();
      for (let k = a; k <= Math.min(N - 1, a + seg); k++) { const j = (p.tN - N + k) % S.TL; k === a ? ctx.moveTo(X(p.tx[j]), Y(p.ty[j])) : ctx.lineTo(X(p.tx[j]), Y(p.ty[j])); }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  for (const p of S.list) {
    if (!shown(p)) continue;
    const ghost = p.kind === 'analytic' ? 0.85 : 1;
    if (st.rods) { ctx.strokeStyle = t.wall; ctx.globalAlpha = 0.5 * ghost; ctx.lineWidth = Math.max(2, s * 0.009); ctx.beginPath(); ctx.moveTo(X(0), Y(0)); for (let i = 1; i < p.x.length; i++) ctx.lineTo(X(p.x[i]), Y(p.y[i])); ctx.stroke(); ctx.globalAlpha = 1; }
    for (let i = 1; i < p.x.length; i++) {
      const cx = X(p.x[i]), cy = Y(p.y[i]), R = Math.max(2, s * 0.03 * Math.sqrt(p.m[i]) + 1.5), col = colorOf(p, i, lut, pal);
      if (st.glow) { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.3; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, col);
      ctx.globalAlpha = ghost; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = t.wall; ctx.beginPath(); ctx.arc(X(0), Y(0), Math.max(3, s * 0.01), 0, 7); ctx.fill();
  // legend: which colour is which solver
  if (!kit.saver) {
    const items = S.list.filter(shown).map(p => [colorOf(p, 1, null, pal), { pbd: 'PBD', analytic: 'Analytic', twin: 'PBD copy' }[p.kind]]);
    const d = P.dpr; ctx.font = `${12 * d}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle';
    items.forEach(([c, label], k) => { const x0 = v.rect.x + 8 * d, y0 = v.rect.y + (14 + 18 * k) * d; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x0 + 5 * d, y0, 5 * d, 0, 7); ctx.fill(); ctx.fillStyle = t.ink; ctx.globalAlpha = 0.8; ctx.fillText(label, x0 + 16 * d, y0); ctx.globalAlpha = 1; });
  }
  if (veil > 0) { ctx.fillStyle = t.bg; ctx.globalAlpha = veil; ctx.fillRect(0, 0, P.w, P.h); ctx.globalAlpha = 1; }
}

function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    if (!P.view || kit.saver) return;
    const [x, y] = P.toWorld(e), g = SM.pick(S, x - OX, y - OY);
    if (!g) return;
    canvas.setPointerCapture(e.pointerId); S.grab = g;
  });
  canvas.addEventListener('pointermove', e => { if (!S.grab) return; const [x, y] = P.toWorld(e); S.grab.x = x - OX; S.grab.y = y - OY; });
  const up = () => { S.grab = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

kit = mount({
  schema: SM.makeSchema(PHONE), title: 'Triple Pendulum', sub: 'Position based dynamics against the analytic solution', panelTitle: 'Scene', guard: SM.guard,
  footer: 'Upstream demo: Ten Minute Physics #06 by Matthias Müller (MIT). Random chains, the copy, look and GUI: davesgames.io.',
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

window.__tri = { S, get kit() { return kit; }, canvas, rebuild, P };
installSaver(window.__tri);
