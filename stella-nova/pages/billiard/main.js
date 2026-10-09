// ============================================================================
//  BILLIARD  ·  pages/billiard/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. Ten Minute Physics #03 "billiard" by Matthias Müller, MIT
//  License (the notice is kept at the top of sim.js, which holds the
//  upstream ball and wall collisions). The credit bar names the author on
//  the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): layouts, tables, pockets,
//  bumpers, the cue shot, the speed histogram, this renderer, the sim kit
//  GUI and the saver.
//
//  grep -n targets: "function rebuild", "function draw", "function histogram",
//  "function bindPointer", "window.__bil"
// ============================================================================
import * as SM from './sim.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { page2d, background, lutColor } from '../../widgets/sim-kit/page2d.js';
import { installSaver } from './saver.js';

TMP.page({ n: '03', title: 'Billiard', file: '03-billiard.html', video: 'ThhdlMbGT5g', year: 2021, licence: 'MIT' });

const PHONE = isPhone();
const canvas = document.getElementById('view');
const S = SM.createSim(PHONE ? 220 : 420);
let kit, P, veil = 1, aim = null, vmax = 3;
// classic pool ball colours (1-8 solid, 9-15 stripe)
const POOL = ['#f5f1e6', '#f2c32b', '#1f4fb5', '#d1342c', '#5b2a86', '#f07a25', '#1f7a3a', '#7a1f2a', '#151515'];

function rebuild() { SM.buildScene(S, kit.state, SM.sceneRng(kit.seed)); veil = 1; let m = 0; for (let i = 0; i < S.n; i++) m = Math.max(m, Math.hypot(S.vx[i], S.vy[i])); vmax = Math.max(1.5, m); }

function colorOf(i, lut, pal) {
  const st = kit.state;
  if (i === S.big) return pal[3 % pal.length];
  if (st.colorBy === 'pool' || (st.layout === 'break' && st.colorBy === 'palette')) return POOL[S.c[i] % 9];
  if (st.colorBy === 'speed' && lut) return lutColor(lut, 0.12 + 0.88 * Math.min(1, Math.hypot(S.vx[i], S.vy[i]) / vmax));
  if (st.colorBy === 'mass' && lut) return lutColor(lut, 0.15 + 0.85 * Math.min(1, (S.r[i] - st.rMin) / Math.max(1e-6, st.rMax - st.rMin)));
  if (st.colorBy === 'side') return pal[S.side[i] ? 3 : 0];
  return pal[S.c[i] % pal.length];
}

function table(ctx, v, t) {
  const st = kit.state, s = v.s, d = P.dpr;
  if (S.table === 'pool') {
    ctx.fillStyle = '#3b2414'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(v.X(0), v.Y(SM.H), SM.W * s, SM.H * s, 0.06 * s) : ctx.rect(v.X(0), v.Y(SM.H), SM.W * s, SM.H * s); ctx.fill();
    const g = ctx.createRadialGradient(v.X(SM.W / 2), v.Y(SM.H / 2), 0, v.X(SM.W / 2), v.Y(SM.H / 2), SM.W * s * 0.6);
    g.addColorStop(0, '#1d7a4a'); g.addColorStop(1, '#0f4a2c');
    ctx.fillStyle = g; ctx.fillRect(v.X(S.x0), v.Y(S.y1), (S.x1 - S.x0) * s, (S.y1 - S.y0) * s);
    ctx.fillStyle = '#05070a'; for (const p of S.pockets) { ctx.beginPath(); ctx.arc(v.X(p.x), v.Y(p.y), p.r * s, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(v.X(SM.W * 0.25), v.Y(SM.H / 2), 2 * d, 0, 7); ctx.fill();
  } else if (S.table === 'round') {
    ctx.strokeStyle = t.wall; ctx.lineWidth = 3 * d; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(v.X(SM.W / 2), v.Y(SM.H / 2), S.R * s, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = t.dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)'; ctx.beginPath(); ctx.arc(v.X(SM.W / 2), v.Y(SM.H / 2), S.R * s, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = t.dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)'; ctx.fillRect(v.X(S.x0), v.Y(S.y1), (S.x1 - S.x0) * s, (S.y1 - S.y0) * s);
    ctx.strokeStyle = t.wall; ctx.lineWidth = 2 * d; ctx.globalAlpha = 0.7; ctx.strokeRect(v.X(S.x0), v.Y(S.y1), (S.x1 - S.x0) * s, (S.y1 - S.y0) * s); ctx.globalAlpha = 1;
  }
  if (S.wallT > 0) { ctx.strokeStyle = t.accent; ctx.globalAlpha = Math.min(1, S.wallT); ctx.lineWidth = 3 * d; ctx.beginPath(); ctx.moveTo(v.X(SM.W / 2), v.Y(S.y0)); ctx.lineTo(v.X(SM.W / 2), v.Y(S.y1)); ctx.stroke(); ctx.globalAlpha = 1; }
  for (const b of S.bumpers) {
    const X = v.X(b.x), Y = v.Y(b.y), R = b.r * s;
    if (b.hit) { ctx.fillStyle = t.accent; ctx.globalAlpha = 0.35 * b.hit; ctx.beginPath(); ctx.arc(X, Y, R * (1.2 + 0.4 * b.hit), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    const g = ctx.createRadialGradient(X - R * 0.3, Y - R * 0.3, R * 0.1, X, Y, R); g.addColorStop(0, t.accent); g.addColorStop(1, t.dark ? '#000' : '#555');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
  }
}

// The 2D speed distribution against Maxwell-Boltzmann in 2D (by kT from
// the mean kinetic energy, equal-mass approximation with the mean mass).
function histogram(ctx, v, t, lut) {
  const d = P.dpr, w = 220 * d, h = 90 * d, x0 = v.rect.x + v.rect.w - w - 10 * d, y0 = v.rect.y + 10 * d, B = 24;
  let live = 0, mm = 0, E = 0; const sp = [];
  for (let i = 0; i < S.n; i++) if (S.live[i]) { live++; mm += S.m[i]; const q = S.vx[i] ** 2 + S.vy[i] ** 2; E += 0.5 * S.m[i] * q; sp.push(Math.sqrt(q)); }
  if (live < 8) return;
  mm /= live; const kT = E / live, vM = Math.max(...sp) * 1.05 || 1, hist = new Float32Array(B);
  for (const s of sp) hist[Math.min(B - 1, Math.floor(s / vM * B))]++;
  const peak = Math.max(...hist, 1);
  ctx.fillStyle = t.dark ? 'rgba(6,8,13,0.55)' : 'rgba(255,255,255,0.6)'; ctx.fillRect(x0, y0, w, h);
  for (let k = 0; k < B; k++) { const bh = hist[k] / peak * (h - 18 * d); ctx.fillStyle = lut ? lutColor(lut, 0.15 + 0.85 * k / B) : t.accent; ctx.fillRect(x0 + k * w / B + 1, y0 + h - 6 * d - bh, w / B - 2, bh); }
  // f(v) = (m v / kT) exp(-m v^2 / 2kT), scaled to the bins
  ctx.strokeStyle = t.ink; ctx.lineWidth = 1.5 * d; ctx.beginPath();
  for (let k = 0; k <= 60; k++) { const sv = vM * k / 60, f = mm * sv / kT * Math.exp(-mm * sv * sv / (2 * kT)) * live * vM / B; const X = x0 + w * k / 60, Y = y0 + h - 6 * d - f / peak * (h - 18 * d); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
  ctx.stroke();
  ctx.font = `${10 * d}px Inter, system-ui, sans-serif`; ctx.fillStyle = t.ink; ctx.globalAlpha = 0.75; ctx.fillText('speeds · Maxwell–Boltzmann (2D)', x0 + 6 * d, y0 + 10 * d); ctx.globalAlpha = 1;
}

function draw(ctx, v) {
  const st = kit.state, t = K.themeById(st.theme), s = v.s;
  background(ctx, t, P.w, P.h, null);
  table(ctx, v, t);
  const pal = K.paletteColors(st.palette), lut = P.lut(st.cmap);
  let m = 0; for (let i = 0; i < S.n; i++) if (S.live[i]) m = Math.max(m, Math.hypot(S.vx[i], S.vy[i])); vmax = Math.max(1.2, 0.98 * vmax + 0.02 * m);
  if (S.tx && S.TL > 1) {
    const L = S.TL, N = Math.min(S.tN, L); ctx.lineCap = 'round';
    for (let i = 0; i < S.n; i++) {
      if (!S.live[i] || (S.big >= 0 && i !== S.big && st.layout === 'brownian')) continue;
      ctx.strokeStyle = colorOf(i, lut, pal); ctx.lineWidth = Math.max(1, S.r[i] * s * (i === S.big ? 0.25 : 0.6)); ctx.globalAlpha = 0.5; ctx.beginPath(); let on = false;
      for (let k = 0; k < N; k++) { const j = i * L + (S.tN - N + k) % L, x = S.tx[j], y = S.ty[j]; if (x !== x) { on = false; continue; } on ? ctx.lineTo(v.X(x), v.Y(y)) : ctx.moveTo(v.X(x), v.Y(y)); on = true; }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < S.n; i++) {
    if (!S.live[i]) continue;
    const X = v.X(S.x[i]), Y = v.Y(S.y[i]), R = Math.max(1.5, S.r[i] * s), col = colorOf(i, lut, pal);
    if (st.shine && R > 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(X + R * 0.18, Y + R * 0.22, R, 0, 7); ctx.fill();
      const g = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.08, X, Y, R);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.28, col); g.addColorStop(1, col); ctx.fillStyle = g;
    } else ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
    if ((st.colorBy === 'pool' || st.layout === 'break') && S.c[i] > 8 && R > 4) { ctx.save(); ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.clip(); ctx.fillStyle = '#f5f1e6'; ctx.fillRect(X - R, Y - R, 2 * R, R * 0.55); ctx.fillRect(X - R, Y + R * 0.45, 2 * R, R * 0.55); ctx.restore(); }
  }
  if (aim) {
    const i = aim.i, X = v.X(S.x[i]), Y = v.Y(S.y[i]), ex = v.X(aim.x), ey = v.Y(aim.y);
    ctx.strokeStyle = t.accent; ctx.lineWidth = 2 * P.dpr; ctx.setLineDash([6 * P.dpr, 6 * P.dpr]); ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(2 * X - ex, 2 * Y - ey); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#c8a26a'; ctx.lineWidth = 5 * P.dpr; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + (ex - X) * 2, ey + (ey - Y) * 2); ctx.stroke();
  }
  if (st.hist) histogram(ctx, v, t, lut);
  if (veil > 0) { ctx.fillStyle = t.bg; ctx.globalAlpha = veil; ctx.fillRect(0, 0, P.w, P.h); ctx.globalAlpha = 1; }
}

function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    if (!P.view || kit.saver) return;
    const [x, y] = P.toWorld(e); let i = SM.pick(S, x, y);
    if (S.table === 'pool' && S.cue >= 0 && S.live[S.cue]) i = S.cue;
    if (i < 0) return;
    canvas.setPointerCapture(e.pointerId); aim = { i, x, y };
  });
  canvas.addEventListener('pointermove', e => { if (!aim) return; const [x, y] = P.toWorld(e); aim.x = x; aim.y = y; });
  const up = () => { if (aim) { const i = aim.i; SM.shoot(S, i, (S.x[i] - aim.x) * 5, (S.y[i] - aim.y) * 5); aim = null; } };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', () => { aim = null; });
}

kit = mount({
  schema: SM.makeSchema(PHONE), title: 'Billiard', sub: 'Balls that collide with restitution', panelTitle: 'Scene', guard: SM.guard,
  footer: 'Upstream demo: Ten Minute Physics #03 by Matthias Müller (MIT). Tables, layouts, cue, histogram, look and GUI: davesgames.io.',
  actions: { act(id) {
    if (id === 'heat') SM.scaleSpeed(S, 1.4); else if (id === 'cool') SM.scaleSpeed(S, 0.7);
    else { const r = K.rng(K.newSeed()); const i = S.cue >= 0 && S.live[S.cue] ? S.cue : Math.floor(r() * S.n); const a = 2 * Math.PI * r(); SM.shoot(S, i, 6 * Math.cos(a), 6 * Math.sin(a)); }
  } },
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

window.__bil = { S, get kit() { return kit; }, canvas, rebuild, P };
installSaver(window.__bil);
