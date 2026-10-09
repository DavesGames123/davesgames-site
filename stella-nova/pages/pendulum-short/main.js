// ============================================================================
//  PENDULUM IN 100 LINES  ·  pages/pendulum-short/main.js — page controller
// ----------------------------------------------------------------------------
//  CREDIT. Ten Minute Physics #06 "pendulumShort" by Matthias Müller, MIT
//  License (the notice is kept at the top of sim.js, which holds the
//  upstream PBD loop). The credit bar (widgets/ten-minute-physics/kit.js)
//  names the author on the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): copies, drive, mass and
//  start patterns, dragging, this renderer, the sim kit GUI and the saver.
//
//  grep -n targets: "function rebuild", "function draw",
//  "function bindPointer", "window.__pend"
// ============================================================================
import * as SM from './sim.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { page2d, background, lutColor } from '../../widgets/sim-kit/page2d.js';
import { installSaver } from './saver.js';

TMP.page({ n: '06', title: 'Pendulum in 100 Lines', file: '06-pendulumShort.html', video: 'XPZEeS70zzU', year: 2021, licence: 'MIT' });

const PHONE = isPhone();
const canvas = document.getElementById('view');
const S = SM.createSim();
let kit, P, veil = 1;

function rebuild() { SM.buildScene(S, kit.state, SM.sceneRng(kit.seed)); veil = 1; }

function colorOf(c, i, ch, lut, pal) {
  const st = kit.state, nc = S.chains.length;
  if (st.colorBy === 'copy' && lut) return lutColor(lut, nc > 1 ? 0.12 + 0.86 * c / (nc - 1) : 0.7);
  if (st.colorBy === 'speed' && lut) return lutColor(lut, 0.12 + 0.88 * Math.min(1, Math.hypot(ch.vx[i], ch.vy[i]) / 6));
  return pal[(nc > 1 ? c : i - 1) % pal.length];
}

function draw(ctx, v) {
  const st = kit.state, t = K.themeById(st.theme), s = v.s;
  background(ctx, t, P.w, P.h, st.grid ? v : null, 0.1);
  const pal = K.paletteColors(st.palette), lut = st.colorBy === 'palette' ? null : P.lut(st.cmap);
  const px = v.X(S.pivot.x), py = v.Y(S.pivot.y);
  // the drive rail
  if (st.driveA > 0) { ctx.strokeStyle = t.wall; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(v.X(S.pivot.x0 - st.driveA - 0.03), py); ctx.lineTo(v.X(S.pivot.x0 + st.driveA + 0.03), py); ctx.stroke(); ctx.globalAlpha = 1; }
  // trails
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  S.chains.forEach((ch, c) => {
    const nb = ch.x.length - 1, N = Math.min(ch.tN, S.TL);
    if (N < 2) return;
    for (let i = st.trailAll ? 0 : nb - 1; i < nb; i++) {
      const col = colorOf(c, i + 1, ch, lut, pal);
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, s * 0.004);
      const seg = 24;
      for (let a = 0; a < N - 1; a += seg) {
        ctx.globalAlpha = 0.85 * ((a + seg / 2) / N) ** 1.5;
        ctx.beginPath();
        for (let k = a; k <= Math.min(N - 1, a + seg); k++) { const j = ((ch.tN - N + k) % S.TL) * nb + i; const X = v.X(ch.tx[j]), Y = v.Y(ch.ty[j]); k === a ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
        ctx.stroke();
      }
    }
  });
  ctx.globalAlpha = 1;
  // rods and bobs
  S.chains.forEach((ch, c) => {
    const nb = ch.x.length - 1, fade = S.chains.length > 1 ? 0.75 : 1;
    if (st.rods) {
      ctx.strokeStyle = t.wall; ctx.globalAlpha = 0.55 * fade; ctx.lineWidth = Math.max(1.5, s * 0.008);
      ctx.beginPath(); ctx.moveTo(v.X(ch.x[0]), v.Y(ch.y[0])); for (let i = 1; i <= nb; i++) ctx.lineTo(v.X(ch.x[i]), v.Y(ch.y[i])); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (let i = 1; i <= nb; i++) {
      const X = v.X(ch.x[i]), Y = v.Y(ch.y[i]), R = Math.max(2, s * 0.03 * Math.sqrt(ch.m[i])), col = colorOf(c, i, ch, lut, pal);
      if (st.glow) { const g = ctx.createRadialGradient(X, Y, 0, X, Y, R * 3); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.3 * fade; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R * 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
      const g = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.1, X, Y, R);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, col);
      ctx.globalAlpha = fade; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
  });
  // the pivot
  ctx.fillStyle = t.wall; ctx.beginPath(); ctx.arc(px, py, Math.max(3, s * 0.012), 0, 7); ctx.fill();
  if (veil > 0) { ctx.fillStyle = t.bg; ctx.globalAlpha = veil; ctx.fillRect(0, 0, P.w, P.h); ctx.globalAlpha = 1; }
}

function bindPointer() {
  let last = null;
  canvas.addEventListener('pointerdown', e => {
    if (!P.view || kit.saver) return;
    const [x, y] = P.toWorld(e), g = SM.pick(S, x, y);
    if (!g) return;
    canvas.setPointerCapture(e.pointerId); S.grab = g; last = [x, y];
  });
  canvas.addEventListener('pointermove', e => { if (!S.grab) return; const [x, y] = P.toWorld(e); S.grab.x = x; S.grab.y = y; last = [x, y]; });
  const up = () => { S.grab = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

kit = mount({
  schema: SM.makeSchema(PHONE), title: 'Pendulum in 100 Lines', sub: 'Position based dynamics: predict, correct, update', panelTitle: 'Scene', guard: SM.guard,
  footer: 'Upstream demo: Ten Minute Physics #06 by Matthias Müller (MIT). Copies, drive, patterns, look and GUI: davesgames.io.',
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

window.__pend = { S, get kit() { return kit; }, canvas, rebuild, P };
installSaver(window.__pend);
