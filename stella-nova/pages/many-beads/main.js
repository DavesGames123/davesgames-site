// ============================================================================
//  MANY BEADS  ·  pages/many-beads/main.js — the page controller
// ----------------------------------------------------------------------------
//  CREDIT. Ten Minute Physics #05 "manyBeads" by Matthias Müller, MIT
//  License (the notice is kept at the top of sim.js, which holds the
//  upstream bead steps and collision). The credit bar names the author on
//  the page and on the saver plate.
//
//  OUR ADDITIONS (davesgames.io, not upstream): wires, start patterns,
//  shake/add/kick, this renderer, the sim kit GUI and the saver.
//
//  grep -n targets: "function rebuild", "function draw",
//  "function bindPointer", "window.__beads"
// ============================================================================
import * as SM from './sim.js';
import { mount, isPhone, core as K } from '../../widgets/sim-kit/ui.js';
import { page2d, background, lutColor } from '../../widgets/sim-kit/page2d.js';
import { installSaver } from './saver.js';

TMP.page({ n: '05', title: 'Many Beads', file: '05-manyBeads.html', video: 'qISgdDhdCro', year: 2021, licence: 'MIT' });

const PHONE = isPhone();
const canvas = document.getElementById('view');
const S = SM.createSim();
const [CX, CY] = SM.CENTER;
let kit, P, veil = 1;

function rebuild() { SM.buildScene(S, kit.state, SM.sceneRng(kit.seed)); veil = 1; }

function colorOf(b, lut, pal) {
  const st = kit.state;
  if (st.colorBy === 'speed' && lut) return lutColor(lut, 0.15 + 0.85 * Math.min(1, Math.hypot(b.vx, b.vy) / 6));
  if (st.colorBy === 'mass' && lut) { const ms = S.b.map(x => x.m), lo = Math.min(...ms), hi = Math.max(...ms); return lutColor(lut, 0.15 + 0.85 * (hi > lo ? (b.m - lo) / (hi - lo) : 0.5)); }
  if (st.colorBy === 'wire') return pal[b.w % pal.length];
  return pal[b.c % pal.length];
}

function draw(ctx, v) {
  const st = kit.state, t = K.themeById(st.theme), s = v.s, d = P.dpr;
  background(ctx, t, P.w, P.h, null);
  const pal = K.paletteColors(st.palette), lut = st.colorBy === 'palette' || st.colorBy === 'wire' ? null : P.lut(st.cmap);
  for (const R of S.wires) for (const [wd, a] of [[9, 0.07], [3.5, 0.18], [1.4, 0.85]]) { ctx.strokeStyle = t.wall; ctx.globalAlpha = a; ctx.lineWidth = wd * d; ctx.beginPath(); ctx.arc(v.X(CX), v.Y(CY), R * s, 0, 7); ctx.stroke(); }
  ctx.globalAlpha = 1;
  // gravity arrow at the centre
  const ga = st.tilt * Math.PI / 180 + S.gang, gl = 0.18 * s;
  ctx.strokeStyle = t.dim; ctx.globalAlpha = 0.5; ctx.lineWidth = 2 * d; ctx.beginPath(); ctx.moveTo(v.X(CX), v.Y(CY)); ctx.lineTo(v.X(CX) + gl * Math.sin(ga), v.Y(CY) + gl * Math.cos(ga)); ctx.stroke(); ctx.globalAlpha = 1;
  // trails
  if (st.trail > 1) for (const b of S.b) {
    const N = Math.min(b.tN, S.TL); if (N < 2) continue;
    ctx.strokeStyle = colorOf(b, lut, pal); ctx.lineCap = 'round';
    for (let k = 1; k < N; k++) { const j0 = (b.tN - N + k - 1) % S.TL, j1 = (b.tN - N + k) % S.TL; ctx.globalAlpha = 0.45 * k / N; ctx.lineWidth = Math.max(1, b.r * s * 1.2 * k / N); ctx.beginPath(); ctx.moveTo(v.X(b.tx[j0]), v.Y(b.ty[j0])); ctx.lineTo(v.X(b.tx[j1]), v.Y(b.ty[j1])); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  for (const b of S.b) {
    const X = v.X(b.x), Y = v.Y(b.y), R = Math.max(2, b.r * s), col = colorOf(b, lut, pal);
    if (st.glow) { const g = ctx.createRadialGradient(X, Y, 0, X, Y, R * 2.4); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 0.28; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R * 2.4, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    if (st.flash && b.hit > 0) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.5 * b.hit; ctx.beginPath(); ctx.arc(X, Y, R * (1.2 + 0.6 * b.hit), 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
    const g = ctx.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.1, X, Y, R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, col);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, R, 0, 7); ctx.fill();
  }
  if (veil > 0) { ctx.fillStyle = t.bg; ctx.globalAlpha = veil; ctx.fillRect(0, 0, P.w, P.h); ctx.globalAlpha = 1; }
}

function bindPointer() {
  canvas.addEventListener('pointerdown', e => {
    if (!P.view || kit.saver) return;
    const [x, y] = P.toWorld(e), g = SM.pick(S, x, y);
    if (g) { canvas.setPointerCapture(e.pointerId); S.grab = g; return; }
    if (!SM.addBead(S, kit.state, x, y, K.rng(K.newSeed()))) kit.say('Tap on a wire, in a free spot, to add a bead');
  });
  canvas.addEventListener('pointermove', e => { if (!S.grab) return; const [x, y] = P.toWorld(e); S.grab.x = x; S.grab.y = y; });
  const up = () => { S.grab = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
}

kit = mount({
  schema: SM.makeSchema(PHONE), title: 'Many Beads', sub: 'Beads on a wire that collide with each other', panelTitle: 'Scene', guard: SM.guard,
  footer: 'Upstream demo: Ten Minute Physics #05 by Matthias Müller (MIT). Wires, cradle, shake, look and GUI: davesgames.io.',
  actions: { act(id) { const r = K.rng(K.newSeed()); if (id === 'shake') SM.shake(S, r); else if (id === 'kick') SM.kick(S, r); else { const a = 2 * Math.PI * r(); if (!SM.addBead(S, kit.state, CX + S.wires[0] * Math.cos(a), CY + S.wires[0] * Math.sin(a), r)) kit.say('No room for another bead there'); } } },
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

window.__beads = { S, get kit() { return kit; }, canvas, rebuild, P };
installSaver(window.__beads);
