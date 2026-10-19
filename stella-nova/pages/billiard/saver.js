// ============================================================================
//  POOL PHYSICS  ·  pages/billiard/saver.js — the screensaver
// ----------------------------------------------------------------------------
//  window.snSaver (the shell protocol, lib/screensaver.js). The user asked
//  for a saver that "should focus on a single game shot in 2d with very
//  little time between shots to indicate a full game", that is "visually
//  engaging and do cool badass shots like banks and combos when possible",
//  and "the chalkboard mode needs to be there in the screensaver layout".
//
//    the game ...... AI vs AI, near perfect, flair 0.9 (core/ai.js: banks,
//                    kick pots and combinations when they are makeable),
//                    SAVER_PACE: short think, aim and judge times, so the
//                    gap from the balls at rest to the next strike is a few
//                    seconds; a new rack 2 s after a game ends
//    the frame ..... one canvas (#saverCanvas), so a recording keeps it all:
//                    the 2D diagram (the large subject, with its vectors and
//                    one maths stage at a time), the chalkboard (the step
//                    cards of the shot, written in as they come, MathJax SVG
//                    drawn as images, the plain text until they load), the
//                    contact zoom in the bottom-right corner, and the live
//                    numbers or a small 3D table
//    compositions .. 'board' (diagram, chalkboard, numbers, zoom) and
//                    'board3d' (the 3D table instead of the numbers), cut
//                    every 16-24 s in a seeded order
//    framing ....... every region sits in the clear band of the label plate
//                    (plateBand of lib/saver-clear.js). 16:9: the diagram at
//                    the left, the chalkboard column at the right. 9:16: the
//                    diagram on top, the chalkboard under it.
//  The plate gets the title, the shot kind and the live values; the TeX
//  lives in the chalkboard, so the plate stays short. No code.
//
//  grep -n targets: "export const SAVER_PACE", "export function regions",
//  "function drawBoard", "function eqImage", "function drawNumbers",
//  "export function installSaver"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { MC } from './view/diagram.js';

export const COMPS = ['board', 'board3d'];
export const SAVER_PACE = 0.36;      // x the page pace: think, aim steps, judge
export const SAVER_FLAIR = 0.9;

// The rectangles of one composition in a W x H frame (CSS px) with the
// clear band { t, b, w } (or null: the whole frame).
//   diagram, board (the chalkboard), inset (the contact zoom, a square, the
//   bottom-right corner), side (the numbers, or the 3D table in 'board3d')
export function regions(W, H, band, comp) {
  const cw = band ? Math.min(W, band.w) : W, x0 = (W - cw) / 2;
  const top = band ? band.t : 0, h = Math.max(60, H - top - (band ? band.b : 0));
  const box = { x: x0 + 8, y: top, w: cw - 16, h }, g = 8;
  const out = { comp, rot: false };
  if (box.w >= box.h * 1.1) {
    // 16:9: the diagram at the left (60 %), the chalkboard column at the right
    const dw = Math.round(box.w * 0.6);
    out.diagram = { x: box.x, y: box.y, w: dw, h: box.h };
    const cx = box.x + dw + g, colW = box.w - dw - g;
    const s = Math.round(Math.min(colW * 0.5, box.h * 0.4));
    out.board = { x: cx, y: box.y, w: colW, h: box.h - s - g };
    out.inset = { x: cx + colW - s, y: box.y + box.h - s, w: s, h: s };
    out.side = { x: cx, y: box.y + box.h - s, w: colW - s - g, h: s };
  } else {
    // 9:16: the diagram across the top, the chalkboard under it
    const dh = Math.round(Math.min(box.h * 0.42, box.w * 0.6));
    out.diagram = { x: box.x, y: box.y, w: box.w, h: dh };
    const s = Math.round(Math.min(box.w * 0.42, (box.h - dh) * 0.4));
    const by = box.y + dh + g, bh = box.h - dh - g - s - g;
    out.board = { x: box.x, y: by, w: box.w, h: Math.max(40, bh) };
    out.inset = { x: box.x + box.w - s, y: box.y + box.h - s, w: s, h: s };
    out.side = { x: box.x, y: box.y + box.h - s, w: box.w - s - g, h: s };
  }
  if (comp === 'board3d') { out.three = out.side; out.side = null; }
  return out;
}

function shuffle(r, a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function rngOf(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// The MathJax SVG of a step as an image (colours put in, sizes in px).
const CLS = Object.entries(MC).map(([k, v]) => `.${k}{fill:${v};stroke:${v};color:${v}}`).join('');
const imgCache = new Map();
function eqImage(svg, key) {
  if (imgCache.has(key)) return imgCache.get(key);
  const rec = { img: null, w: 0, h: 0, ready: false };
  imgCache.set(key, rec);
  if (imgCache.size > 120) imgCache.delete(imgCache.keys().next().value);
  try {
    const c = svg.cloneNode(true), vb = (c.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !(vb[2] > 0)) return rec;
    const em = 44;                                   // px per em in the image (drawn smaller)
    rec.w = vb[2] / 1000 * em; rec.h = vb[3] / 1000 * em;
    c.setAttribute('width', String(rec.w)); c.setAttribute('height', String(rec.h));
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    c.setAttribute('style', 'color:#eef3ee');
    let s = new XMLSerializer().serializeToString(c);
    s = s.replace(/^<svg([^>]*)>/, `<svg$1><style>${CLS}</style>`);
    const img = new Image();
    img.onload = () => { rec.ready = true; };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    rec.img = img;
  } catch (e) { /* plain text stays */ }
  return rec;
}

export function installSaver(P) {
  const APP = P.APP;
  let cv = null, ctx = null, opts = null, r = null, bag = [], cur = null, until = 0, hist = [], saved = null, clock = 0;
  let revealT = [], stepsRef = null, lastSettle = null;
  const gaps = [];                                   // balls at rest -> next strike, s (debug, tests)
  const pick = () => {
    if (!bag.length) { bag = shuffle(r, COMPS); if (cur && bag[0] === cur.comp && bag.length > 1) bag.push(bag.shift()); }
    return bag.shift();
  };
  function cut(key) {
    const comp = key && COMPS.includes(key) ? key : pick();
    cur = { comp, t0: clock };
    until = clock + 16 + 8 * r();
    hist.push({ shot: comp, t: clock });
  }
  const KIND = { pot: 'pot', bank: 'bank shot', kickpot: 'kick shot', combo: 'combination', safe: 'safety', kick: 'kick (safety)', break: 'the break', blind: 'roll' };
  function label(step) {
    if (!opts || !opts.label) return;
    const G = APP.G, p = G.players[G.turn];
    const ct = APP.ct, plan = APP.plan || {};
    const params = [];
    if (ct) params.push({ sym: '\\theta', name: 'cut angle', value: `${(ct.theta * 180 / Math.PI).toFixed(1)}°`, cls: 'm5' });
    if (plan.v) params.push({ sym: 'v_0', name: 'cue ball speed', value: `${plan.v.toFixed(2)} m/s`, cls: 'm1' });
    if (plan.err) params.push({ sym: '\\Delta\\varphi', name: 'stroke error', value: `${(plan.err.dphi * 180 / Math.PI).toFixed(3)}°`, cls: 'm6' });
    opts.label({
      title: 'Pool Physics',
      sub: `${G.type === '9' ? '9-ball' : '8-ball'} · ${p.name} · ${KIND[plan.kind] || 'thinking'}${step ? ' · ' + step.title.toLowerCase() : ''}`,
      params,
      tex: [], eq: [],
      lines: [APP.msg || 'The computer plays itself: ghost ball, throw, banks and combinations'],
    });
  }

  // ── the chalkboard: the step cards of the shot, newest at the bottom ──────
  function drawBoard(c, B, dpr) {
    const x = B.x * dpr, y = B.y * dpr, w = B.w * dpr, h = B.h * dpr;
    c.save();
    c.fillStyle = '#0e1316'; c.fillRect(x, y, w, h);
    c.strokeStyle = 'rgba(170,210,220,0.16)'; c.lineWidth = 1 * dpr; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    const steps = APP.steps || [], shown = Math.min(APP.shown, steps.length - 1);
    const rowH = Math.max(30 * dpr, Math.min(54 * dpr, (h - 10 * dpr) / 6));
    const fit = Math.max(1, Math.floor((h - 10 * dpr) / rowH));
    const first = Math.max(0, shown - fit + 1);
    const headW = Math.min(118 * dpr, w * 0.3);
    if (shown < 0) {
      text(c, 'the maths of the next shot writes itself here', x + w / 2, y + h / 2, 12 * dpr, 'rgba(238,243,238,0.45)', 'center');
    }
    for (let k = first; k <= shown; k++) {
      const st = steps[k], ry = y + 5 * dpr + (k - first) * rowH, cur = k === shown;
      const age = clock - (revealT[k] ?? -9);
      c.save();
      c.globalAlpha = cur ? 1 : 0.6;
      if (cur) { c.fillStyle = 'rgba(255,255,255,0.045)'; roundRect(c, x + 4 * dpr, ry, w - 8 * dpr, rowH - 4 * dpr, 6 * dpr); c.fill(); }
      // the number badge and the title
      c.fillStyle = 'rgba(255,255,255,0.1)'; c.beginPath(); c.arc(x + 16 * dpr, ry + 12 * dpr, 8 * dpr, 0, 2 * Math.PI); c.fill();
      text(c, String(k + 1), x + 16 * dpr, ry + 12.5 * dpr, 10 * dpr, '#eef3ee', 'center');
      text(c, ellipsis(c, st.title, headW - 10 * dpr, 10.5 * dpr), x + 10 * dpr, ry + rowH - 12 * dpr, 10.5 * dpr, 'rgba(238,243,238,0.6)', 'left');
      // the equation: written in from the left (Manim's Write)
      const ex = x + headW, ew = w - headW - 10 * dpr, eh = rowH - 10 * dpr;
      const wipe = Math.max(0, Math.min(1, age / 0.7));
      c.save(); c.beginPath(); c.rect(ex, ry, ew * (cur ? wipe : 1), rowH); c.clip();
      const svg = P.maths.svg && P.maths.svg(k);
      const im = svg ? eqImage(svg, st.tex) : null;
      if (im && im.ready && im.w > 0) {
        const k2 = Math.min(eh / im.h, ew / im.w, 1.1 * dpr);
        c.drawImage(im.img, ex, ry + (rowH - 4 * dpr - im.h * k2) / 2, im.w * k2, im.h * k2);
      } else {
        c.font = `italic ${13 * dpr}px 'STIX Two Text', 'Times New Roman', serif`; c.fillStyle = '#eef3ee'; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText(ellipsis(c, st.plain, ew, 13 * dpr, true), ex, ry + (rowH - 4 * dpr) / 2);
      }
      c.restore();
      c.restore();
    }
    c.restore();
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
  function text(c, s, X, Y, px, color, align) { c.font = `${px}px Inter, system-ui, sans-serif`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, X, Y); }
  function ellipsis(c, s, maxW, px, keepFont) {
    if (!keepFont) c.font = `${px}px Inter, system-ui, sans-serif`;
    if (!s || c.measureText(s).width <= maxW) return s || '';
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1; }
    return s.slice(0, lo) + '…';
  }
  // the live numbers: the balls that move, v and theta, and the stroke error
  function drawNumbers(c, B, dpr) {
    const x = B.x * dpr, y = B.y * dpr, w = B.w * dpr, h = B.h * dpr, S = APP.G.S;
    c.save(); c.fillStyle = '#0e1316'; c.fillRect(x, y, w, h); c.strokeStyle = 'rgba(170,210,220,0.16)'; c.lineWidth = 1 * dpr; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    const lines = [], plan = APP.plan || {};
    lines.push([`${KIND[plan.kind] || 'thinking'}`, MC.m5]);
    if (plan.err) lines.push([`Δφ ${(plan.err.dphi * 180 / Math.PI).toFixed(3)}°  δv ${plan.err.dv >= 0 ? '+' : ''}${plan.err.dv.toFixed(3)} m/s`, MC.m6]);
    for (let n = 0; n < 16 && lines.length < 6; n++) {
      if (!S.on[n]) continue;
      const v = Math.hypot(S.vx[n], S.vy[n]);
      if (v < 0.01) continue;
      lines.push([`${n === 0 ? 'cue' : 'ball ' + n}  v ${v.toFixed(2)} m/s`, n === 0 ? MC.m1 : MC.m2]);
    }
    const lh = Math.min(18 * dpr, h / Math.max(4, lines.length + 1));
    lines.forEach(([s, col], i) => text(c, ellipsis(c, s, w - 16 * dpr, lh * 0.7), x + 8 * dpr, y + lh * (i + 0.9), lh * 0.7, col, 'left'));
    c.restore();
  }

  const ctrl = {
    pace: SAVER_PACE, flair: SAVER_FLAIR,
    onStep(step) {
      if (stepsRef !== APP.steps) { stepsRef = APP.steps; revealT = []; }
      const k = APP.steps.indexOf(step); if (k >= 0) revealT[k] = clock;
      label(step);
    },
    frame(dt) {
      clock += dt;
      if (clock >= until) cut();
      // the gap between shots: the balls come to rest -> the next strike
      if (APP.phase === 'settle' && lastSettle == null) lastSettle = clock;
      if (APP.phase === 'roll' && lastSettle != null) { gaps.push(clock - lastSettle); lastSettle = null; if (gaps.length > 200) gaps.shift(); }
      if (APP.phase === 'over') lastSettle = null;
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, cv.width, cv.height);
      const band = plateBand(H), rg = regions(W, H, band, cur.comp);
      const V = P.V;
      if (rg.three && V) {
        const st = P.scene3dState();
        V.setBalls(st.balls); V.setCue(st.cue, APP.G.S); V.setOverlay(st.ov);
        V.resize(Math.round(rg.three.w), Math.round(rg.three.h), dpr);
        V.update(dt); V.render();
        try { ctx.drawImage(V.renderer.domElement, rg.three.x * dpr, rg.three.y * dpr, rg.three.w * dpr, rg.three.h * dpr); } catch (e) { /* no image in a test */ }
      }
      const d = rg.diagram, D = P.D;
      D.layout(d.w * dpr, d.h * dpr, rg.rot, 8 * dpr, d.x * dpr, d.y * dpr, { insetBox: { x: rg.inset.x * dpr, y: rg.inset.y * dpr, size: rg.inset.w * dpr } });
      const F = P.frame2d(dpr);
      F.clear = true; F.x0 = d.x * dpr; F.y0 = d.y * dpr; F.inset = false;
      ctx.save(); ctx.beginPath(); ctx.rect(d.x * dpr, d.y * dpr, d.w * dpr, d.h * dpr); ctx.clip();
      D.draw(ctx, F);
      ctx.restore();
      D.drawInset(ctx, F);
      drawBoard(ctx, rg.board, dpr);
      if (rg.side) drawNumbers(ctx, rg.side, dpr);
    },
    debug: () => ({ comp: cur && cur.comp, hist: hist.slice(), phase: APP.phase, shots: APP.G.shots, gaps: gaps.slice(), kinds: kinds.slice() }),
  };
  const kinds = [];
  window.snSaver = {
    async enter(o = {}) {
      opts = o; r = rngOf((o.seed >>> 0) || 1); bag = []; hist = []; clock = 0; gaps.length = 0; kinds.length = 0; lastSettle = null;
      cv = document.getElementById('saverCanvas');
      ctx = cv.getContext('2d');
      cv.hidden = false;
      document.documentElement.classList.add('saver');
      saved = { mode: APP.mode, pace: APP.pace, skill: APP.skill, speed: APP.speed, paused: APP.paused, takeover: APP.takeover, slowK: APP.slowK };
      APP.mode = 'ai-ai'; APP.takeover = false; APP.skill = 'perfect'; APP.speed = 1; APP.paused = false;
      APP.pace = 0.85 + 0.3 * (o.calm ?? 0.5);
      APP.slowK = 0.55;                   // a shorter slow motion at the contact
      APP.saver = ctrl;
      if (P.V) P.V.camMode('auto');
      cut();
      P.startGame(((o.seed >>> 0) % 99991) + 1, r() < 0.3 ? '9' : '8');
      label(null);
      return { canvas: cv, warmupMs: 700 };
    },
    exit() {
      if (!APP.saver) return;
      APP.saver = null;
      document.documentElement.classList.remove('saver');
      if (cv) cv.hidden = true;
      if (saved) Object.assign(APP, saved);
      if (P.V) P.V.camMode(APP.cam);
      if (opts && opts.label) opts.label(null);
      if (P.layout.reset) P.layout.reset();
      P.layout();
    },
    cut(key) { if (APP.saver) cut(key); },
    debug: () => ctrl.debug(),
  };
  ctrl.kind = k => kinds.push(k);
  return window.snSaver;
}
