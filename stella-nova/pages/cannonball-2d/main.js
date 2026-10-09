// ============================================================================
//  CANNONBALL 2D  ·  pages/cannonball-2d/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. Ten Minute Physics #01 "cannonball2d" by Matthias Müller, MIT
//  License (the notice is kept at the top of sim.js, which holds the
//  upstream Euler step). The credit bar (widgets/ten-minute-physics/kit.js)
//  names the author on the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): the cannons, pegs, many
//  balls, this renderer, the sim kit GUI (widgets/sim-kit) and the saver.
//
//  Flow: the sim kit (mount) owns the GUI state; page2d owns the canvas,
//  the clear rect and the fixed-step loop. A change to a key in
//  sim.REBUILD builds a new scene; every other key is a live set.
//
//  grep -n targets
//    scene build .......... "function rebuild"
//    drawing .............. "function draw"
//    pointer .............. "function bindPointer"
//    saver hooks .......... "window.__cb2"
// ============================================================================
import * as SM from './sim.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { page2d, background, lutColor } from '../../widgets/sim-kit/page2d.js';
import { installSaver } from './saver.js';

TMP.page({ n: '01', title: 'Cannonball 2D', file: '01-cannonball2d.html', video: 'oPuSvdBGrpE', year: 2021, licence: 'MIT' });

const PHONE = isPhone();
const SCHEMA = SM.makeSchema(PHONE);
const canvas = document.getElementById('view');
const S = SM.createSim(PHONE ? 80 : 160);
let kit, P, veil = 1, aim = null;

function rebuild() { SM.buildScene(S, kit.state, SM.sceneRng(kit.seed)); veil = 1; for (let k = 0; k < 2; k++) SM.fire(S); }

function ballColor(i, lut, pal) {
  const st = kit.state;
  if (st.colorBy === 'palette' || !lut) return pal[S.c[i] % pal.length];
  let t;
  if (st.colorBy === 'speed') t = Math.min(1, Math.hypot(S.vx[i], S.vy[i]) / 24);
  else if (st.colorBy === 'height') t = Math.min(1, S.y[i] / SM.H);
  else t = Math.min(1, (0.5 * (S.vx[i] ** 2 + S.vy[i] ** 2) + S.P.g * S.y[i]) / (0.5 * 24 * 24));
  return lutColor(lut, 0.12 + 0.88 * t);
}

function draw(ctx, v) {
  const st = kit.state, t = K.themeById(st.theme), cw = P.w, ch = P.h, s = v.s;
  background(ctx, t, cw, ch, st.grid ? v : null, 1);
  // the box
  ctx.save();
  ctx.strokeStyle = t.wall; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, s * 0.04);
  ctx.beginPath(); ctx.moveTo(v.X(0), v.Y(st.ceiling ? SM.H : SM.H * 0.15)); ctx.lineTo(v.X(0), v.Y(0)); ctx.lineTo(v.X(SM.W), v.Y(0)); ctx.lineTo(v.X(SM.W), v.Y(st.ceiling ? SM.H : SM.H * 0.15));
  if (st.ceiling) { ctx.moveTo(v.X(0), v.Y(SM.H)); ctx.lineTo(v.X(SM.W), v.Y(SM.H)); }
  ctx.stroke(); ctx.restore();
  ctx.fillStyle = t.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)'; ctx.fillRect(v.X(0), v.Y(0), SM.W * s, ch - v.Y(0));
  const pal = K.paletteColors(st.palette), lut = st.colorBy === 'palette' ? null : P.lut(st.cmap);
  // pegs and bumpers
  for (const p of S.pegs) {
    const X = v.X(p.x), Y = v.Y(p.y), R = p.r * s;
    if (p.hit) { ctx.fillStyle = t.accent; ctx.globalAlpha = 0.3 * p.hit; ctx.beginPath(); ctx.arc(X, Y, R * (1.15 + 0.5 * p.hit), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    const g = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.35, R * 0.1, X, Y, R);
    g.addColorStop(0, p.bumper ? t.accent : t.wall); g.addColorStop(1, t.dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
  }
  // trails
  if (S.tx && st.trail > 1) {
    const L = S.tlen, N = Math.min(S.tN, L);
    ctx.lineCap = 'round';
    for (let i = 0; i < S.n; i++) {
      const col = ballColor(i, lut, pal);
      for (let k = 1; k < N; k++) {
        const a = (S.tN - N + k - 1) % L, b = (S.tN - N + k) % L;
        const x0 = S.tx[i * L + a], y0 = S.ty[i * L + a], x1 = S.tx[i * L + b], y1 = S.ty[i * L + b];
        if (!(x0 === x0 && x1 === x1) || Math.abs(x1 - x0) > 2 || Math.abs(y1 - y0) > 2) continue;
        ctx.globalAlpha = 0.5 * k / N; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, S.r[i] * s * 0.7 * k / N);
        ctx.beginPath(); ctx.moveTo(v.X(x0), v.Y(y0)); ctx.lineTo(v.X(x1), v.Y(y1)); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  // balls
  for (let i = 0; i < S.n; i++) {
    const X = v.X(S.x[i]), Y = v.Y(S.y[i]), R = Math.max(1.5, S.r[i] * s), col = ballColor(i, lut, pal);
    if (st.glow) { const g = ctx.createRadialGradient(X, Y, 0, X, Y, R * 3); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R * 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    const g = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.1, X, Y, R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, col); g.addColorStop(1, col);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
  }
  // cannons
  if (S.bins.length) {
    ctx.strokeStyle = t.wall; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(1, s * 0.05); ctx.beginPath();
    for (const bx of S.bins) { ctx.moveTo(v.X(bx), v.Y(0)); ctx.lineTo(v.X(bx), v.Y(S.binH)); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (const c of S.cannons) {
    if (c.hopper) {
      const X = v.X(c.x), Y = v.Y(c.y), w = 0.9 * s;
      ctx.fillStyle = t.wall; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(X - w, Y - 0.6 * s); ctx.lineTo(X + w, Y - 0.6 * s); ctx.lineTo(X + 0.25 * s, Y + 0.1 * s); ctx.lineTo(X - 0.25 * s, Y + 0.1 * s); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      continue;
    }
    const a = st.angle * Math.PI / 180, X = v.X(c.x), Y = v.Y(c.y), L = 1.1 * s * (1 - 0.15 * c.recoil), Wd = 0.34 * s;
    ctx.save(); ctx.translate(X, Y); ctx.scale(c.dir, 1); ctx.rotate(-a);
    ctx.fillStyle = t.wall; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-0.2 * s, -Wd / 2, L, Wd, Wd / 2) : ctx.rect(-0.2 * s, -Wd / 2, L, Wd); ctx.fill();
    if (c.recoil > 0.3) { ctx.fillStyle = t.accent; ctx.globalAlpha = c.recoil * 0.5; ctx.beginPath(); ctx.arc(L + Wd * 0.3, 0, Wd * 0.45 * (1 + c.recoil), 0, 7); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = t.wall; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(X, Y, 0.36 * s, Math.PI, 0); ctx.fill(); ctx.globalAlpha = 1;
  }
  // the fling aim
  if (aim) { ctx.strokeStyle = t.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(v.X(aim.x0), v.Y(aim.y0)); ctx.lineTo(v.X(aim.x1), v.Y(aim.y1)); ctx.stroke(); ctx.setLineDash([]); }
  if (veil > 0) { ctx.fillStyle = t.bg; ctx.globalAlpha = veil; ctx.fillRect(0, 0, cw, ch); ctx.globalAlpha = 1; }
}

function bindPointer() {
  let last = null;
  canvas.addEventListener('pointerdown', e => {
    if (!P.view || kit.saver) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = P.toWorld(e), i = SM.pick(S, x, y);
    if (i >= 0) { S.grab = i; last = [x, y, performance.now()]; }
    else aim = { x0: x, y0: y, x1: x, y1: y };
  });
  canvas.addEventListener('pointermove', e => {
    if (!P.view) return;
    const [x, y] = P.toWorld(e);
    if (S.grab >= 0) { const now = performance.now(), dt = Math.max(0.008, (now - last[2]) / 1000); const i = S.grab; S.vx[i] = (x - last[0]) / dt; S.vy[i] = (y - last[1]) / dt; S.x[i] = Math.max(S.r[i], Math.min(SM.W - S.r[i], x)); S.y[i] = Math.max(S.r[i], y); last = [x, y, now]; }
    else if (aim) { aim.x1 = x; aim.y1 = y; }
  });
  const up = () => {
    if (S.grab >= 0) { const i = S.grab; const sp = Math.hypot(S.vx[i], S.vy[i]); if (sp > 30) { S.vx[i] *= 30 / sp; S.vy[i] *= 30 / sp; } S.grab = -1; }
    if (aim) {
      const dx = aim.x0 - aim.x1, dy = aim.y0 - aim.y1, k = 3.2;
      const x = Math.max(0.3, Math.min(SM.W - 0.3, aim.x0)), y = Math.max(0.3, aim.y0);
      SM.addBall(S, x, y, Math.max(-30, Math.min(30, dx * k)), Math.max(-30, Math.min(30, dy * k)), Math.max(0.05, kit.state.r));
      aim = null;
    }
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

kit = mount({
  schema: SCHEMA, title: 'Cannonball 2D', sub: 'Gravity and one explicit Euler step per frame', panelTitle: 'Scene', guard: SM.guard,
  footer: 'Upstream demo: Ten Minute Physics #01 by Matthias Müller (MIT). Cannons, pegs, many balls, look and GUI: davesgames.io.',
  actions: { fire(n) { for (let k = 0; k < +n; k++) SM.fire(S); }, clear() { S.n = 0; S.head = 0; } },
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

window.__cb2 = { S, get kit() { return kit; }, canvas, rebuild, P };
installSaver(window.__cb2);
