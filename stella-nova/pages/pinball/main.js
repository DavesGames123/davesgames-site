// ============================================================================
//  PINBALL  ·  pages/pinball/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. Ten Minute Physics #04 "pinball" by Matthias Müller, MIT
//  License (the notice is kept at the top of sim.js, which holds the
//  upstream collisions and flippers). The credit bar names the author on
//  the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): bumper layouts, the
//  autopilot, the drain, combos, this renderer, the sim kit GUI and the
//  saver.
//
//  Input: Z / M or the left / right arrow keys flip; a tap on the left or
//  right half of the table flips that side; a key or a tap takes the
//  flippers from the autopilot for 4 s. Drag a ball to move it.
//
//  grep -n targets: "function rebuild", "function draw", "function bindInput",
//  "window.__pin"
// ============================================================================
import * as SM from './sim.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { page2d, background, lutColor } from '../../widgets/sim-kit/page2d.js';
import { installSaver } from './saver.js';

TMP.page({ n: '04', title: 'Pinball', file: '04-pinball.html', video: 'NhVUCsXp-Uo', year: 2021, licence: 'MIT' });

const PHONE = isPhone();
const canvas = document.getElementById('view');
const S = SM.createSim();
let kit, P, veil = 1;

function rebuild() { SM.buildScene(S, kit.state, SM.sceneRng(kit.seed)); veil = 1; }

function glowLine(ctx, pts, col, w, neon, closed) {
  const d = P.dpr, pass = neon ? [[w + 16 * d, 0.07], [w + 7 * d, 0.2], [w, 1]] : [[w, 1]];
  for (const [lw, a] of pass) { ctx.strokeStyle = col; ctx.globalAlpha = a; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (closed) ctx.closePath(); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

function draw(ctx, v) {
  const st = kit.state, t = K.themeById(st.theme), s = v.s, d = P.dpr, neon = st.style === 'neon', classic = st.style === 'classic';
  background(ctx, t, P.w, P.h, null);
  const pal = K.paletteColors(st.palette), lut = st.colorBy === 'speed' ? P.lut(st.cmap) : null;
  const B = S.border.map(p => [v.X(p[0]), v.Y(p[1])]);
  // the playfield
  ctx.save(); ctx.beginPath(); B.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
  const g = ctx.createLinearGradient(0, v.Y(SM.H), 0, v.Y(0));
  if (classic) { g.addColorStop(0, '#1b2a6b'); g.addColorStop(1, '#3a0f4a'); } else { g.addColorStop(0, t.bg2); g.addColorStop(1, t.bg); }
  ctx.fillStyle = g; ctx.fill(); ctx.clip();
  // lane arrows and a grid of faint dots
  ctx.fillStyle = t.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
  for (let y = 0.3; y < SM.H; y += 0.08) for (let x = 0.06; x < 0.97; x += 0.08) { ctx.beginPath(); ctx.arc(v.X(x), v.Y(y), 1.2 * d, 0, 7); ctx.fill(); }
  ctx.restore();
  const wallCol = neon ? pal[1 % pal.length] : t.wall;
  if (S.drain) glowLine(ctx, B.slice(0, 7).concat([]), wallCol, 3 * d, neon, false), glowLine(ctx, [B[7], B[0]], wallCol, 3 * d, neon, false);
  else glowLine(ctx, B, wallCol, 3 * d, neon, true);
  // bumpers and posts
  for (const o of S.obstacles) {
    const X = v.X(o.x), Y = v.Y(o.y), R = o.r * s, col = o.post ? t.wall : pal[(S.obstacles.indexOf(o) + 2) % pal.length];
    if (o.post) { ctx.fillStyle = col; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill(); ctx.globalAlpha = 1; if (o.hit) { ctx.fillStyle = t.accent; ctx.globalAlpha = 0.6 * o.hit; ctx.beginPath(); ctx.arc(X, Y, R * 2, 0, 7); ctx.fill(); ctx.globalAlpha = 1; } continue; }
    if (neon || o.hit) { const gg = ctx.createRadialGradient(X, Y, R * 0.6, X, Y, R * (1.8 + o.hit)); gg.addColorStop(0, col); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.25 + 0.5 * o.hit; ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(X, Y, R * (1.8 + o.hit), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = classic ? '#f2f2f2' : t.bg; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, R * 0.22); ctx.beginPath(); ctx.arc(X, Y, R * 0.86, 0, 7); ctx.stroke();
    ctx.fillStyle = col; ctx.globalAlpha = 0.35 + 0.65 * o.hit; ctx.beginPath(); ctx.arc(X, Y, R * 0.45, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  // flippers
  S.flippers.forEach((f, k) => {
    const [tx, ty] = SM.flipperTip(f), col = pal[(k ? 0 : 3) % pal.length];
    const pts = [[v.X(f.x), v.Y(f.y)], [v.X(tx), v.Y(ty)]];
    if (neon) glowLine(ctx, pts, col, 2 * f.r * s, true, false);
    ctx.strokeStyle = classic ? '#f2f2f2' : col; ctx.lineCap = 'round'; ctx.lineWidth = 2 * f.r * s; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
    ctx.fillStyle = t.bg; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], f.r * s * 0.45, 0, 7); ctx.fill();
  });
  // trails and balls
  for (const b of S.balls) {
    const col = lut ? lutColor(lut, 0.15 + 0.85 * Math.min(1, Math.hypot(b.vx, b.vy) / 5)) : pal[b.c % pal.length];
    const N = Math.min(b.tN, S.TL);
    for (let k = 1; k < N; k++) { const j0 = (b.tN - N + k - 1) % S.TL, j1 = (b.tN - N + k) % S.TL; if (Math.abs(b.ty[j1] - b.ty[j0]) > 0.3) continue; ctx.strokeStyle = col; ctx.globalAlpha = 0.5 * k / N; ctx.lineWidth = Math.max(1, b.r * s * 1.6 * k / N); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(v.X(b.tx[j0]), v.Y(b.ty[j0])); ctx.lineTo(v.X(b.tx[j1]), v.Y(b.ty[j1])); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const X = v.X(b.x), Y = v.Y(b.y), R = Math.max(2, b.r * s);
    const gb = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.1, X, Y, R);
    gb.addColorStop(0, '#ffffff'); gb.addColorStop(0.35, classic ? '#c9ced6' : col); gb.addColorStop(1, classic ? '#6b7280' : col);
    ctx.fillStyle = gb; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
  }
  // score
  ctx.font = `600 ${18 * d}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = t.ink; ctx.globalAlpha = 0.9;
  ctx.fillText(String(S.score).padStart(6, '0'), v.X(0.5), v.Y(SM.H - 0.07));
  if (S.combo > 1) { ctx.font = `${12 * d}px Inter, system-ui, sans-serif`; ctx.fillStyle = t.accent; ctx.fillText('combo ×' + S.combo, v.X(0.5), v.Y(SM.H - 0.12)); }
  ctx.globalAlpha = 1; ctx.textAlign = 'start';
  if (veil > 0) { ctx.fillStyle = t.bg; ctx.globalAlpha = veil; ctx.fillRect(0, 0, P.w, P.h); ctx.globalAlpha = 1; }
}

function bindInput() {
  const press = (k, on) => { S.keys[k] = on; if (on) S.manualT = 4; };
  addEventListener('keydown', e => { if (kit.saver || e.target.closest && e.target.closest('input, select, textarea')) return; const k = e.key.toLowerCase(); if (k === 'z' || k === 'arrowleft') press(0, true); if (k === 'm' || k === 'arrowright') press(1, true); });
  addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k === 'z' || k === 'arrowleft') S.keys[0] = false; if (k === 'm' || k === 'arrowright') S.keys[1] = false; });
  const touches = new Map();
  canvas.addEventListener('pointerdown', e => {
    if (!P.view || kit.saver) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = P.toWorld(e), g = SM.pick(S, x, y);
    if (g) { S.grab = g; touches.set(e.pointerId, 'grab'); return; }
    const side = x < 0.5 ? 0 : 1; press(side, true); touches.set(e.pointerId, side);
  });
  canvas.addEventListener('pointermove', e => { if (touches.get(e.pointerId) === 'grab' && S.grab) { const [x, y] = P.toWorld(e); S.grab.x = Math.max(0.03, Math.min(0.97, x)); S.grab.y = Math.max(0.3, Math.min(SM.H - 0.03, y)); } });
  const up = e => { const k = touches.get(e.pointerId); if (k === 'grab') S.grab = null; else if (k != null) S.keys[k] = false; touches.delete(e.pointerId); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

kit = mount({
  schema: SM.makeSchema(PHONE), title: 'Pinball', sub: 'Bumpers, flippers and the closest-segment border', panelTitle: 'Table', guard: SM.guard,
  footer: 'Upstream demo: Ten Minute Physics #04 by Matthias Müller (MIT). Layouts, autopilot, drain, look and GUI: davesgames.io.',
  actions: { act(id) { const r = K.rng(K.newSeed()); if (id === 'launch') SM.launch(S, kit.state, r); else SM.nudge(S, r); } },
});
kit.on('change', (out, st, why) => {
  if (why === 'scene' || why === 'group' || why === 'saver') return;
  if (Object.keys(out).some(k => SM.REBUILD.has(k))) rebuild(); else SM.applyParams(S, kit.state);
});
kit.on('scene', (seed, st, out, group) => { if (!group || Object.keys(out || {}).some(k => SM.REBUILD.has(k))) rebuild(); else SM.applyParams(S, kit.state); });
kit.on('reset', rebuild);
P = page2d({ canvas, kit, world: () => ({ w: SM.W, h: SM.H }), step: h => SM.step(S, h), draw: (ctx, v, dt) => { veil = Math.max(0, veil - dt / 0.45); draw(ctx, v); } });
if (!kit.fromHash) kit.newScene(); else rebuild();
bindInput();
addEventListener('pagehide', () => { kit.playing = false; });

window.__pin = { S, get kit() { return kit; }, canvas, rebuild, P };
installSaver(window.__pin);
