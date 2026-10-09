// ============================================================================
//  THREAD ART  ·  saver-draw.js — the saver shot director and its painters
// ----------------------------------------------------------------------------
//  No DOM globals: the caller gives a canvas factory (mk), the source
//  images and the piece producer, so node tests and node contact sheets
//  run the same code as the page (saver.js is the browser glue).
//
//  createDirector(env) -> { frame(g, dt, view), cut(kind), debug(), plate() }
//    env  { seed, calm, phone, gpu, mk(w, h), source(key, px), sources,
//           producer, cache, label(info) | null }
//    view { W, H, dpr, band: { x, y, w, h } } in device px; band is the
//         clear band between the plate's top and bottom text.
//  Every shot is drawn at device px. Lines are vectors (draw.js
//  strokeLines, hairlines): a moving camera draws them again each frame
//  at its zoom; a still camera adds new lines to one cache canvas. A
//  cached thread raster is never drawn larger than its size.
//
//  Memory stays flat: canvases come from a fixed set of named pool slots
//  (resized, not made again), pieces live in the LRU PieceCache, and one
//  Replay buffer serves the candidate fan.
//
//  grep -n: "export function createDirector"  "function pool"  "const SHOTS"
//           "needle:"  "split:"  "chase:"  "layers:"  "maker:"  "push:"  "rack:"
//           "wipe:"  "gallery:"  "function boardPath"  "function rim"  "function blurPass"
//           "function lightSweep"  "function needleHead"  "function plateInfo"  "function nextShot"
// ============================================================================
import { strokeLines, errorView, lineAt } from './draw.js';
import { hairline } from './engine.js';
import { KINDS, makePlan, pieceSpec, rng, threadLength, Replay, BOARD_M, NO_GAIN } from './saver-core.js';

const TAU = Math.PI * 2;
const clamp01 = t => Math.min(1, Math.max(0, t));
const ease = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeIO = t => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const lerp = (a, b, t) => a + (b - a) * t;
const LT = [0, 0, 0];

export const TEX = [
  String.raw`(k^{*},\,j^{*}) = \arg\max_{k,\;j}\; \sum_{p\,\in\,L(c_k,\,j)} \big( 2\,\delta_k \cdot r_p - \lVert \delta_k \rVert^{2} \big)`,
  String.raw`r_p \leftarrow r_p - \delta_{k^{*}} \;\; (p \in L), \qquad c_{k^{*}} \leftarrow j^{*}`,
];

const TITLES = {
  needle: 'Threading', split: 'Target · error · thread', chase: 'Following the needle', layers: 'Colour layers',
  maker: "The maker's view", push: 'Finished piece', rack: 'From thread to image', wipe: 'Source and thread', gallery: 'Gallery',
};

// ── geometry and painters ─────────────────────────────────────────────────
/** The frame shape of a piece square (x, y, s) on g, the same as main.js framePath. */
function boardPath(g, shape, res, x, y, s, grow = 0) {
  const k = s / res, c = (res - 1) / 2, cx = x + (c + 0.5) * k, cy = y + (c + 0.5) * k;
  g.beginPath();
  if (shape === 'circle') g.arc(cx, cy, (c + 0.5) * k + grow, 0, TAU);
  else if (shape === 'square') g.rect(x - grow, y - grow, s + 2 * grow, s + 2 * grow);
  else {
    const R = (c + 0.5) * k + grow * 1.15;
    for (let i = 0; i < 6; i++) { const t = -Math.PI / 2 + (i * Math.PI) / 3; g[i ? 'lineTo' : 'moveTo'](cx + R * Math.cos(t), cy + R * Math.sin(t)); }
    g.closePath();
  }
}

/** The wall behind the pieces: a deep vignette. */
function wall(g, W, H, warm = 0) {
  g.save();
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  const gr = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
  gr.addColorStop(0, warm ? '#1d1a17' : '#151922'); gr.addColorStop(1, '#05060a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.restore();
}

/** A frame rim (wood or brass) and a soft shadow around the board. */
function rim(g, shape, res, x, y, s, dpr, style = 'wood') {
  const w = Math.max(3 * dpr, s * 0.035);
  g.save();
  // shadow, outside the board only
  const cx = x + s / 2, cy = y + s / 2;
  g.save();
  g.beginPath(); g.rect(x - s, y - s, s * 3, s * 3);
  boardPath(g, shape, res, x, y, s);
  g.clip('evenodd');
  const sh = g.createRadialGradient(cx, cy + s * 0.04, s * 0.42, cx, cy + s * 0.04, s * 0.66);
  sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(x - s * 0.2, y - s * 0.2, s * 1.4, s * 1.4);
  g.restore();
  const gr = g.createLinearGradient(x, y, x + s, y + s);
  if (style === 'brass') { gr.addColorStop(0, '#e8c77a'); gr.addColorStop(0.5, '#8a6a2c'); gr.addColorStop(1, '#d9b062'); }
  else if (style === 'ebony') { gr.addColorStop(0, '#3a3532'); gr.addColorStop(0.5, '#141210'); gr.addColorStop(1, '#2b2724'); }
  else { gr.addColorStop(0, '#a8774a'); gr.addColorStop(0.5, '#5c3a1f'); gr.addColorStop(1, '#93653c'); }
  boardPath(g, shape, res, x, y, s, w * 0.5);
  g.lineWidth = w; g.strokeStyle = gr; g.lineJoin = 'round'; g.stroke();
  boardPath(g, shape, res, x, y, s, 0.5 * dpr);
  g.lineWidth = Math.max(1, dpr); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
  g.restore();
}

function boardFill(g, p, x, y, s) {
  g.save();
  boardPath(g, p.cfg.shape, p.res, x, y, s);
  g.fillStyle = p.cfg.dark ? '#020203' : '#fbfaf6';
  g.fill();
  g.restore();
}

/** Pegs as small nails; only those inside the clip rect. */
function pegs(g, p, x, y, s, dpr, clip, hi = -1) {
  const k = s / p.res, r = Math.max(1.1 * dpr, Math.min(3.2 * dpr, k * 0.75));
  g.save();
  g.fillStyle = p.cfg.dark ? '#b9b0a0' : '#4a4038';
  for (let i = 0; i < p.P; i++) {
    const px = x + (p.pegs.x[i] + 0.5) * k, py = y + (p.pegs.y[i] + 0.5) * k;
    if (clip && (px < clip.x - r || py < clip.y - r || px > clip.x + clip.w + r || py > clip.y + clip.h + r)) continue;
    g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
  }
  if (hi >= 0) {
    const px = x + (p.pegs.x[hi] + 0.5) * k, py = y + (p.pegs.y[hi] + 0.5) * k;
    g.fillStyle = '#ffcf4a'; g.beginPath(); g.arc(px, py, r * 1.6, 0, TAU); g.fill();
  }
  g.restore();
}

/** The glowing needle head at (hx, hy). */
function needleHead(g, hx, hy, dpr, scale = 1, colour = '255,190,70') {
  const R = 16 * dpr * scale;
  g.save();
  g.globalCompositeOperation = 'source-over';
  const gr = g.createRadialGradient(hx, hy, 0, hx, hy, R);
  gr.addColorStop(0, `rgba(255,250,235,0.95)`); gr.addColorStop(0.18, `rgba(${colour},0.85)`);
  gr.addColorStop(0.5, `rgba(${colour},0.22)`); gr.addColorStop(1, `rgba(${colour},0)`);
  g.fillStyle = gr; g.beginPath(); g.arc(hx, hy, R, 0, TAU); g.fill();
  g.fillStyle = '#fffdf5'; g.beginPath(); g.arc(hx, hy, 2.2 * dpr * Math.sqrt(scale), 0, TAU); g.fill();
  g.restore();
}

/** The line in flight from peg a toward peg b (fraction f), and the needle. */
function inFlight(g, p, i, f, x, y, s, dpr, zoom = 1, scale = 1) {
  if (i < 0 || i >= p.n) return null;
  lineAt(p, i, LT);
  const k = s / p.res;
  const x0 = x + (p.pegs.x[LT[1]] + 0.5) * k, y0 = y + (p.pegs.y[LT[1]] + 0.5) * k;
  const x1 = x + (p.pegs.x[LT[2]] + 0.5) * k, y1 = y + (p.pegs.y[LT[2]] + 0.5) * k;
  const e = ease(f), hx = lerp(x0, x1, e), hy = lerp(y0, y1, e);
  const hl = hairline(p.cfg.alpha, k / zoom, { zoom });
  g.save();
  g.lineCap = 'round';
  const col = p.colHex[LT[0]];
  const tint = col === '#000000' || col === '#ffffff' ? '#ffb43c' : col;
  g.strokeStyle = tint; g.globalAlpha = 0.9; g.lineWidth = Math.max(1.2 * dpr, hl.w * 2.5);
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(hx, hy); g.stroke();
  g.restore();
  needleHead(g, hx, hy, dpr, scale);
  return { hx, hy, a: LT[1], b: LT[2], k: LT[0] };
}

/** The last lines laid, bright and fading: the thread racing peg to peg. */
function comet(g, p, i, x, y, s, dpr, m = 14) {
  const k = s / p.res;
  g.save(); g.lineCap = 'round'; g.globalCompositeOperation = 'source-over';
  for (let q = Math.max(0, i - m); q < i; q++) {
    lineAt(p, q, LT);
    const w = (q - (i - m)) / m;
    g.globalAlpha = 0.08 + 0.75 * w * w;
    g.strokeStyle = p.cfg.dark ? '#ffd27a' : '#e8891c'; g.lineWidth = (0.6 + 1.2 * w) * dpr;
    g.beginPath(); g.moveTo(x + (p.pegs.x[LT[1]] + 0.5) * k, y + (p.pegs.y[LT[1]] + 0.5) * k);
    g.lineTo(x + (p.pegs.x[LT[2]] + 0.5) * k, y + (p.pegs.y[LT[2]] + 0.5) * k); g.stroke();
  }
  g.restore();
}

/** A light band sweeping over the board (the thread sheen). u: 0..1 across. */
function lightSweep(g, p, x, y, s, u, strength = 0.5) {
  if (u <= 0 || u >= 1) return;
  g.save();
  boardPath(g, p.cfg.shape, p.res, x, y, s); g.clip();
  const cx = lerp(x - s * 0.4, x + s * 1.4, u), w = s * 0.35;
  const gr = g.createLinearGradient(cx - w, y, cx + w, y + s * 0.35);
  gr.addColorStop(0, 'rgba(255,244,220,0)'); gr.addColorStop(0.5, `rgba(255,244,220,${0.32 * strength})`); gr.addColorStop(1, 'rgba(255,244,220,0)');
  g.globalCompositeOperation = p.cfg.dark ? 'screen' : 'soft-light';
  g.fillStyle = gr; g.fillRect(x - 2, y - 2, s + 4, s + 4);
  if (!p.cfg.dark) { g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.35 * strength; g.fillRect(x - 2, y - 2, s + 4, s + 4); }
  g.restore();
}

function text(g, str, x, y, px, colour, align = 'center', weight = 500, font = 'Inter, system-ui, sans-serif') {
  g.save();
  g.font = `${weight} ${Math.round(px)}px ${font}`;
  g.fillStyle = colour; g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(str, x, y);
  g.restore();
}

/** The piece square of side s centred in rect r. */
function fitSquare(r, m = 0.92) {
  const s = Math.max(8, Math.min(r.w, r.h) * m);
  return { x: r.x + (r.w - s) / 2, y: r.y + (r.h - s) / 2, s };
}

/** Lines shown at time t on a slow start then an exponential ramp. */
function rampCount(t, dur, N, { t0 = 0.3, rate0 = 2.5, t1 = 0.9, kappa = 5, base = 0 } = {}) {
  const tA = t0 * dur, tB = t1 * dur, nA = Math.min(N, base + rate0 * Math.min(t, tA));
  if (t <= tA) return nA;
  const u = clamp01((t - tA) / Math.max(1e-3, tB - tA));
  return Math.min(N, nA + (N - nA) * (Math.expm1(kappa * u) / Math.expm1(kappa)));
}

// ── the director ───────────────────────────────────────────────────────────
export function createDirector(env) {
  const r = rng((env.seed >>> 0) ^ 0x51a7e);
  const calm = env.calm ?? 0.6;
  let planSeed = env.seed >>> 0, plan = makePlan(planSeed, 200, calm), pi = 0;
  const replay = new Replay();
  const fanBuf = new Float64Array(512);
  let shot = null, lastKind = null, count = 0, lastSrc = null, fadeT = 1, labelAt = -1e9, clock = 0, waiting = 0;
  const kindsSeen = new Set(), wanted = new Set();

  // Fixed pool slots: memory does not grow with time.
  const slots = new Map();
  let created = 0;
  function pool(name, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let c = slots.get(name);
    if (!c) { c = env.mk(w, h); created++; slots.set(name, c); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }

  function specFor(kind) {
    const sp = pieceSpec(r, kind, { sources: env.sources, gpu: env.gpu, phone: env.phone, last: lastSrc });
    lastSrc = sp.src;
    return sp;
  }
  // Ask for the pieces of the next shots.
  function feed() {
    for (let q = 0; q < 3; q++) {
      const k = plan[(pi + q) % plan.length].kind;
      if (k === 'gallery') continue;
      if (!env.producer.want(specFor(k))) break;
    }
  }

  const fits = (kind, p) => kind === 'layers' ? p.K > 1 : kind === 'wipe' || kind === 'split' ? !!srcMeta(p).photo : true;
  const srcMeta = p => { const s = env.sources.find(q => q.key === p.spec.src); return { name: s ? s.name : p.spec.src, photo: s && s.kind === 'photo', poi: s && s.poi || [[0.5, 0.5]], credit: s ? s.credit : '' }; };

  function nextShot(force) {
    let item = force ? { kind: force, dur: 9 } : plan[pi % plan.length];
    let kind = item.kind;
    let p = null;
    if (kind === 'gallery') {
      if (env.cache.size < 2) kind = 'push';
    }
    if (kind !== 'gallery') {
      p = env.producer.take(q => q.spec.kind === kind && fits(kind, q)) || (force ? null : env.producer.take(q => fits(kind, q)));
      if (!p && force) {
        const c = env.cache.list().filter(q => fits(kind, q) && q.spec.kind === kind && (!shot || q !== shot.p));
        if (c.length) p = c[c.length - 1];
        else { if (!wanted.has(kind)) { wanted.add(kind); env.producer.want(specFor(kind), true); } return false; }
      }
      if (!p) {
        const c = env.cache.list().filter(q => fits(kind, q) && (!shot || q !== shot.p));
        if (c.length) p = c[Math.floor(r() * c.length)];
      }
      if (!p) {
        // No piece for this kind yet: take any piece and a kind it fits.
        p = env.producer.take() || (env.cache.list()[0] ?? null);
        if (!p) return false;
        if (!fits(kind, p)) kind = BUILD_FALLBACK(kind, lastKind);
      }
      env.cache.touch(p);
    }
    if (!force) { pi++; if (pi >= plan.length) { planSeed++; const tail = plan[plan.length - 1].kind; plan = makePlan(planSeed, 200, calm); if (plan[0].kind === tail) plan.push(plan.shift()); pi = 0; } }
    wanted.delete(kind);
    const prev = shot;
    shot = { kind, dur: item.dur, t: 0, p, key: '', drawn: 0, data: {}, id: ++count };
    kindsSeen.add(kind);
    lastKind = kind;
    if (prev) fadeT = 0;
    labelAt = -1e9;
    feed();
    return true;
  }
  function BUILD_FALLBACK(kind, last) { const o = ['needle', 'push', 'maker'].filter(k => k !== last); return o[0]; }

  // ── shots ────────────────────────────────────────────────────────────────
  // Each: setup(sh, view) when the view changes, draw(g, sh, view), shown(sh).
  const SHOTS = {
    needle: {
      shown: sh => rampCount(sh.t, sh.dur, sh.p.n, { t0: 0.32, rate0: 1.6 + 1.6 * (1 - calm), t1: 0.9, kappa: 5.5 }),
      setup(sh, v) { sh.sq = fitSquare(v.band); accInit(sh, v); replay.reset(sh.p); sh.data.fanAt = -1; },
      draw(g, sh, v) {
        const { x, y, s } = sh.sq, p = sh.p, n = this.shown(sh), i = Math.floor(n), f = n - i;
        accTo(sh, v, i);
        g.drawImage(pool('acc', v.W, v.H), 0, 0);
        const slow = sh.t < sh.dur * 0.32 + 0.6;
        if (slow && i < p.n) fan(g, sh, i, f, x, y, s, v.dpr);
        pegs(g, p, x, y, s, v.dpr, null, i < p.n ? (lineAt(p, i, LT), LT[1]) : -1);
        if (i < p.n && (slow || f > 0)) inFlight(g, p, i, slow ? f : 0.999, x, y, s, v.dpr, 1, slow ? 1 : 0.7);
        if (!slow && i < p.n) { comet(g, p, i, x, y, s, v.dpr); lineAt(p, i, LT); const k = s / p.res; needleHead(g, x + (p.pegs.x[LT[2]] + 0.5) * k, y + (p.pegs.y[LT[2]] + 0.5) * k, v.dpr, 0.8); }
        return n;
      },
    },
    split: {
      shown: sh => rampCount(sh.t, sh.dur, sh.p.n, { t0: 0.08, rate0: 6, t1: 0.86, kappa: 4.2 }),
      setup(sh, v) {
        const b = v.band, wide = b.w / b.h > 1.5, gap = 14 * v.dpr, lab = 26 * v.dpr;
        const cells = [];
        if (wide) { const cw = (b.w - 2 * gap) / 3; for (let q = 0; q < 3; q++) cells.push({ x: b.x + q * (cw + gap), y: b.y, w: cw, h: b.h - lab }); }
        else { const ch = (b.h - 2 * gap - 3 * lab) / 3; for (let q = 0; q < 3; q++) cells.push({ x: b.x, y: b.y + q * (ch + gap + lab), w: b.w, h: ch }); }
        const sq = cells.map(c => fitSquare(c, 0.96)), s = Math.min(...sq.map(q => q.s));
        sh.cells = cells.map((c, q) => ({ x: c.x + (c.w - s) / 2, y: c.y + (c.h - s) / 2, s }));
        sh.sq = sh.cells[2];
        accInit(sh, v);
        // The target panel: the source at its own size (never scaled up past the image).
        const src = env.source(sh.p.spec.src, s);
        const tc = pool('src', s, s), tg = tc.getContext('2d');
        tg.save(); tg.globalCompositeOperation = 'source-over';
        tg.fillStyle = sh.p.cfg.dark ? '#000' : '#fff'; tg.fillRect(0, 0, s, s);
        if (src) { const ss = Math.min(src.width, src.height); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = 'high'; tg.drawImage(src, (src.width - ss) / 2, (src.height - ss) / 2, ss, ss, 0, 0, s, s); }
        if (!sh.p.cfg.color) { tg.globalCompositeOperation = 'saturation'; tg.fillStyle = '#808080'; tg.fillRect(0, 0, s, s); }
        tg.restore();
        sh.data.src = src; sh.data.errAt = -1e9;
      },
      draw(g, sh, v) {
        const p = sh.p, n = this.shown(sh), i = Math.floor(n), f = n - i;
        accTo(sh, v, i);
        const acc = pool('acc', v.W, v.H), [A, B, Cc] = sh.cells, s = A.s;
        // panel 1: target
        rim(g, p.cfg.shape, p.res, A.x, A.y, s, v.dpr, 'ebony');
        rim(g, p.cfg.shape, p.res, B.x, B.y, s, v.dpr, 'ebony');
        g.save(); boardPath(g, p.cfg.shape, p.res, A.x, A.y, s); g.clip(); g.drawImage(pool('src', s, s), A.x, A.y); g.restore();
        // panel 3: thread (from the cache canvas)
        g.drawImage(acc, 0, 0);
        // panel 2: what is still missing, at device px (draw.js errorView)
        if (clock - sh.data.errAt > 0.12) {
          sh.data.errAt = clock;
          const ec = pool('err', s, s), et = pool('errTmp', s, s), es = pool('errSmall', 8, 8);
          const src = sh.data.src, ss = src ? Math.min(src.width, src.height) : 1;
          errorView(ec.getContext('2d'), et.getContext('2d'), es.getContext('2d'), s, s, src,
            src ? [(src.width - ss) / 2, (src.height - ss) / 2, ss] : [0, 0, 1], [0, 0, s], acc, [Cc.x, Cc.y],
            { dark: p.cfg.dark, mono: !p.cfg.color, res: p.res });
        }
        g.save(); boardPath(g, p.cfg.shape, p.res, B.x, B.y, s); g.clip(); g.drawImage(pool('err', s, s), B.x, B.y); g.restore();
        pegs(g, p, Cc.x, Cc.y, s, v.dpr);
        if (i < p.n && n < 60) inFlight(g, p, i, f, Cc.x, Cc.y, s, v.dpr, 1, 0.8);
        const fs = Math.max(11, 13) * v.dpr, ty = q => sh.cells[q].y + s + 15 * v.dpr;
        const L = ['target', 'still missing', `thread · ${Math.floor(n).toLocaleString()} lines`];
        for (let q = 0; q < 3; q++) text(g, L[q], sh.cells[q].x + s / 2, ty(q), fs, '#c9c3b6', 'center', 500);
        return n;
      },
    },
    chase: {
      shown: sh => {
        const t = sh.t, tc = sh.dur * 0.58, n0 = sh.data.n0 || 0;
        if (t < tc) return Math.min(sh.p.n, n0 + 3 * t + 1.6 * t * t);
        const nA = Math.min(sh.p.n, n0 + 3 * tc + 1.6 * tc * tc), u = clamp01((t - tc) / (sh.dur * 0.36));
        return Math.min(sh.p.n, nA + (sh.p.n - nA) * Math.expm1(4.5 * u) / Math.expm1(4.5));
      },
      setup(sh, v) {
        sh.sq0 = fitSquare(v.band, 0.94);
        // close: the band shows about 28% of the piece width (the band can be wide)
        if (!sh.data.cam) { sh.data.cam = { x: 0.5, y: 0.5, vx: 0, vy: 0, zk: 0.9 + 0.3 * r() }; sh.data.n0 = Math.floor(sh.p.n * (0.35 + 0.2 * r())); }
        sh.data.cam.z = Math.max(3, (v.band.w / (0.28 * sh.sq0.s)) * sh.data.cam.zk);
        bigInit(sh, sh.sq0.s * sh.data.cam.z);
      },
      draw(g, sh, v) {
        const p = sh.p, n = this.shown(sh), i = Math.floor(n), f = n - i, cam = sh.data.cam;
        const tc = sh.dur * 0.58, out = ease((sh.t - tc) / (sh.dur * 0.34));
        // target: the needle head (piece units)
        let hx = 0.5, hy = 0.5;
        if (i < p.n) { lineAt(p, i, LT); const e = ease(f); hx = (lerp(p.pegs.x[LT[1]], p.pegs.x[LT[2]], e) + 0.5) / p.res; hy = (lerp(p.pegs.y[LT[1]], p.pegs.y[LT[2]], e) + 0.5) / p.res; }
        const tx = lerp(hx, 0.5, out), ty = lerp(hy, 0.5, out);
        if (!cam.on) { cam.on = true; cam.x = hx; cam.y = hy; }
        const dt = Math.min(0.05, sh.dt || 0.016), w = 3.2;
        cam.vx += (w * w * (tx - cam.x) - 2 * w * cam.vx) * dt; cam.vy += (w * w * (ty - cam.y) - 2 * w * cam.vy) * dt;
        cam.x += cam.vx * dt; cam.y += cam.vy * dt;
        const zoom = Math.exp(lerp(Math.log(cam.z), 0, out));
        const s = sh.sq0.s * zoom, cx = v.band.x + v.band.w / 2, cy = v.band.y + v.band.h / 2;
        const lim = c => Math.min(1 - 0.5 / zoom, Math.max(0.5 / zoom, c));
        const x = cx - lim(cam.x) * s, y = cy - lim(cam.y) * s;
        bigTo(sh, i, 8000);
        g.save(); clipBand(g, v);
        if (zoom < 1.4) rim(g, p.cfg.shape, p.res, x, y, s, v.dpr);
        piece(g, sh, x, y, s, i, zoom);
        pegs(g, p, x, y, s, v.dpr, v.band);
        if (out > 0.05 && i < p.n) comet(g, p, i, x, y, s, v.dpr, 10);
        if (i < p.n) inFlight(g, p, i, f, x, y, s, v.dpr, zoom, lerp(1.3, 0.8, out));
        g.restore();
        return n;
      },
    },
    layers: {
      shown: sh => rampCount(sh.t, sh.dur, sh.p.n, { t0: 0.06, rate0: 8, t1: 0.66, kappa: 4 }),
      setup(sh, v) {
        const b = v.band, K = sh.p.K, wide = b.w / b.h > 1.15, gap = 12 * v.dpr;
        let big, cells = [];
        if (wide) {
          big = fitSquare({ x: b.x, y: b.y, w: b.w * 0.6, h: b.h }, 0.94);
          const cw = b.w * 0.4, side = Math.min((cw - gap) / 2, (b.h - gap) / 2) * 0.92;
          const ox = b.x + b.w * 0.6 + (cw - (2 * side + gap)) / 2, oy = b.y + (b.h - (2 * side + gap)) / 2;
          for (let k = 0; k < K; k++) cells.push({ x: ox + (k % 2) * (side + gap), y: oy + Math.floor(k / 2) * (side + gap), s: side });
        } else {
          big = fitSquare({ x: b.x, y: b.y, w: b.w, h: b.h * 0.7 }, 0.94);
          const side = Math.min((b.w - (K - 1) * gap) / K, b.h * 0.27) * 0.95, ox = b.x + (b.w - (K * side + (K - 1) * gap)) / 2;
          for (let k = 0; k < K; k++) cells.push({ x: ox + k * (side + gap), y: b.y + b.h * 0.72, s: side });
        }
        sh.sq = big; sh.cells = cells; sh.layerDrawn = new Array(K).fill(0);
        accInit(sh, v);
        for (let k = 0; k < K; k++) { const c = pool('layer' + k, cells[k].s, cells[k].s), lg = c.getContext('2d'); lg.clearRect(0, 0, c.width, c.height); boardFill(lg, sh.p, 0, 0, cells[k].s); }
      },
      draw(g, sh, v) {
        const p = sh.p, n = this.shown(sh), i = Math.floor(n);
        accTo(sh, v, i);
        g.drawImage(pool('acc', v.W, v.H), 0, 0);
        pegs(g, p, sh.sq.x, sh.sq.y, sh.sq.s, v.dpr);
        const fly = easeIO((sh.t - sh.dur * 0.7) / (sh.dur * 0.22));
        for (let k = 0; k < p.K; k++) {
          const c = sh.cells[k], lc = pool('layer' + k, c.s, c.s);
          // each layer builds its own lines over the same time as the whole
          const ix = byThread(p)[k], m = p.n ? Math.floor(ix.length * Math.min(1, n / p.n)) : 0;
          if (sh.layerDrawn[k] < m) { strokeLines(lc.getContext('2d'), p, 0, 0, c.s, sh.layerDrawn[k], m, { index: ix, batch: 48, alphaK: 2.5 }); sh.layerDrawn[k] = m; }
          const sc = lerp(1, 0.35, fly), cs = c.s * sc;
          const cx = lerp(c.x + c.s / 2, sh.sq.x + sh.sq.s / 2, fly), cy = lerp(c.y + c.s / 2, sh.sq.y + sh.sq.s / 2, fly);
          g.save(); g.globalAlpha = 1 - fly;
          rim(g, p.cfg.shape, p.res, cx - cs / 2, cy - cs / 2, cs, v.dpr, 'ebony');
          g.save(); boardPath(g, p.cfg.shape, p.res, cx - cs / 2, cy - cs / 2, cs); g.clip();
          g.drawImage(lc, cx - cs / 2, cy - cs / 2, cs, cs); g.restore();
          // the thread colour chip
          g.fillStyle = p.colHex[k]; g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = v.dpr;
          g.beginPath(); g.arc(cx - cs / 2 + 9 * v.dpr, cy - cs / 2 + 9 * v.dpr, 6 * v.dpr * sc, 0, TAU); g.fill(); g.stroke();
          g.restore();
        }
        return n;
      },
    },
    maker: {
      shown: sh => sh.data.n0 + Math.min(sh.p.n - sh.data.n0, (1.2 + 0.6 * (1 - calm)) * sh.t + 0.18 * sh.t * sh.t),
      setup(sh, v) {
        const b = v.band, wide = b.w / b.h > 1.2;
        if (sh.data.n0 === undefined) sh.data.n0 = Math.floor(sh.p.n * (0.25 + 0.2 * r()));
        if (wide) { sh.sq = fitSquare({ x: b.x, y: b.y, w: b.w * 0.64, h: b.h }, 0.8); sh.tick = { x: b.x + b.w * 0.66, y: b.y + b.h * 0.06, w: b.w * 0.3, h: b.h * 0.88, vert: true }; }
        else { sh.sq = fitSquare({ x: b.x, y: b.y, w: b.w, h: b.h * 0.76 }, 0.8); sh.tick = { x: b.x, y: b.y + b.h * 0.8, w: b.w, h: b.h * 0.18, vert: false }; }
        accInit(sh, v, 0.35);
      },
      draw(g, sh, v) {
        const p = sh.p, n = this.shown(sh), i = Math.floor(n), f = n - i, d = v.dpr;
        accTo(sh, v, i);
        g.drawImage(pool('acc', v.W, v.H), 0, 0);
        const { x, y, s } = sh.sq, k = s / p.res, c = (p.res - 1) / 2;
        // numbered pegs: a label every q pegs, q from the arc gap
        const gapPx = (Math.PI * s) / p.P, q = [1, 2, 5, 10, 20].find(m => gapPx * m > 24 * d) || 20;
        const cur = i < p.n ? (lineAt(p, i, LT), LT[1]) : -1, nxt = i < p.n ? LT[2] : -1;
        g.save();
        g.font = `500 ${Math.round(10.5 * d)}px Inter, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let j = 0; j < p.P; j++) {
          const px = p.pegs.x[j] - c, py = p.pegs.y[j] - c, rr = Math.hypot(px, py) || 1;
          const ux = px / rr, uy = py / rr, X = x + (p.pegs.x[j] + 0.5) * k, Y = y + (p.pegs.y[j] + 0.5) * k;
          const tick = j % q === 0 ? 9 * d : 4 * d;
          g.strokeStyle = j === cur || j === nxt ? '#ffcf4a' : 'rgba(220,212,196,0.55)'; g.lineWidth = Math.max(1, d * 0.8);
          g.beginPath(); g.moveTo(X + ux * 4 * d, Y + uy * 4 * d); g.lineTo(X + ux * (4 * d + tick), Y + uy * (4 * d + tick)); g.stroke();
          if (j % q === 0 || j === cur || j === nxt) {
            g.fillStyle = j === cur ? '#ffcf4a' : j === nxt ? '#ff8a5c' : '#d8d0c0';
            const rr2 = j === cur || j === nxt ? 40 * d : 25 * d;
            g.fillText(String(j), X + ux * rr2, Y + uy * rr2);
          }
        }
        g.restore();
        pegs(g, p, x, y, s, d, null, cur);
        if (i < p.n) inFlight(g, p, i, f, x, y, s, d, 1, 0.9);
        ticker(g, sh, v, i, f);
        return n;
      },
    },
    push: {
      shown: sh => sh.p.n,
      setup(sh, v) {
        sh.sq0 = fitSquare(v.band, 0.9);
        if (!sh.data.z1) { const m = srcMeta(sh.p), c = r() < 0.5 ? m.poi : detailPoi(sh.p); sh.data.poi = c[Math.floor(r() * c.length)]; sh.data.z1 = 1.8 + r() * 0.9; }
        sh.data.z1 = Math.min(sh.data.z1, BIG_CAP / sh.sq0.s);
        bigInit(sh, sh.sq0.s * sh.data.z1);
      },
      draw(g, sh, v) {
        const p = sh.p, u = easeIO(sh.t / sh.dur), zoom = Math.exp(lerp(0, Math.log(sh.data.z1), u));
        const cam = camAt(sh.sq0, v.band, zoom, lerp(0.5, sh.data.poi[0], u), lerp(0.5, sh.data.poi[1], u));
        bigTo(sh, p.n, 6000);
        g.save(); clipBand(g, v);
        rim(g, p.cfg.shape, p.res, cam.x, cam.y, cam.s, v.dpr, sh.id % 3 === 0 ? 'brass' : 'wood');
        piece(g, sh, cam.x, cam.y, cam.s, p.n, zoom);
        pegs(g, p, cam.x, cam.y, cam.s, v.dpr, v.band);
        lightSweep(g, p, cam.x, cam.y, cam.s, (sh.t / sh.dur - 0.2) / 0.7, 0.9);
        g.restore();
        return p.n;
      },
    },
    rack: {
      shown: sh => sh.p.n,
      setup(sh, v) {
        sh.sq0 = fitSquare(v.band, 0.9);
        // close: the band shows about 20% of the piece width, thread-level detail
        if (!sh.data.zk) { const m = srcMeta(sh.p), c = m.photo && r() < 0.5 ? m.poi : detailPoi(sh.p); sh.data.poi = c[Math.floor(r() * c.length)]; sh.data.zk = 0.9 + 0.35 * r(); }
        sh.data.z0 = Math.max(4, (v.band.w / (0.2 * sh.sq0.s)) * sh.data.zk);
        bigInit(sh, sh.sq0.s * sh.data.z0);
      },
      draw(g, sh, v) {
        const p = sh.p, T = sh.t / sh.dur;
        const u = easeIO((T - 0.36) / 0.46), zoom = Math.exp(lerp(Math.log(sh.data.z0), 0, u));
        const w = clamp01((zoom - 1) / 2);
        const cam = camAt(sh.sq0, v.band, zoom, lerp(0.5, sh.data.poi[0], w), lerp(0.5, sh.data.poi[1], w));
        bigTo(sh, p.n, 6000);
        g.save(); clipBand(g, v);
        if (u === 0 && cam.s > sh.big.n + 0.5) {
          // The still close-up: drawn once as vectors into a band-size cache, then copied 1:1.
          const b = v.band, cc = pool('close', b.w, b.h);
          if (sh.data.closeKey !== sh.key) {
            const cg = cc.getContext('2d');
            cg.save(); cg.setTransform(1, 0, 0, 1, 0, 0); cg.globalCompositeOperation = 'source-over'; cg.globalAlpha = 1; cg.clearRect(0, 0, cc.width, cc.height);
            cg.translate(-b.x, -b.y);
            piece(cg, sh, cam.x, cam.y, cam.s, p.n, zoom);
            pegs(cg, p, cam.x, cam.y, cam.s, v.dpr, v.band);
            cg.restore();
            sh.data.closeKey = sh.key;
          }
          g.drawImage(cc, Math.round(b.x), Math.round(b.y));
        } else {
          if (zoom < 1.5) rim(g, p.cfg.shape, p.res, cam.x, cam.y, cam.s, v.dpr, 'ebony');
          piece(g, sh, cam.x, cam.y, cam.s, p.n, zoom);
          pegs(g, p, cam.x, cam.y, cam.s, v.dpr, v.band);
        }
        g.restore();
        // depth of field at the start (sharp centre), a focus pull in the middle
        const dof = (1 - u) * clamp01(1 - (T - 0.3) / 0.1) * 0.45;
        const pull = Math.sin(Math.PI * clamp01((T - 0.4) / 0.4)) * 0.5;
        if (dof > 0.02) blurPass(g, v, dof, true, p.cfg.dark ? 0.35 : 0);
        if (pull > 0.02) blurPass(g, v, pull, false, 0);
        return p.n;
      },
    },
    wipe: {
      shown: sh => sh.p.n,
      setup(sh, v) {
        sh.sq = fitSquare(v.band, 0.9);
        accInit(sh, v, 1, true);
        const s = Math.round(sh.sq.s), src = env.source(sh.p.spec.src, s), tc = pool('src', s, s), tg = tc.getContext('2d');
        tg.save(); tg.globalCompositeOperation = 'source-over'; tg.fillStyle = '#000'; tg.fillRect(0, 0, s, s);
        if (src) { const ss = Math.min(src.width, src.height); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = 'high'; tg.drawImage(src, (src.width - ss) / 2, (src.height - ss) / 2, ss, ss, 0, 0, s, s); }
        tg.restore();
      },
      draw(g, sh, v) {
        const p = sh.p, { x, y, s } = sh.sq, T = sh.t / sh.dur;
        accTo(sh, v, p.n);
        g.drawImage(pool('acc', v.W, v.H), 0, 0);
        const u = clamp01(0.5 - 0.47 * Math.cos(TAU * clamp01((T - 0.06) / 0.88) * 0.75 + 0.0001));
        const xw = x + s * u;
        g.save(); boardPath(g, p.cfg.shape, p.res, x, y, s); g.clip();
        g.beginPath(); g.rect(x - 2, y - 2, xw - x + 2, s + 4); g.clip();
        g.drawImage(pool('src', Math.round(s), Math.round(s)), x, y);
        g.restore();
        pegs(g, p, x, y, s, v.dpr);
        lightSweep(g, p, x, y, s, (T - 0.5) / 0.45, 0.8);
        g.save(); boardPath(g, p.cfg.shape, p.res, x, y, s, 4 * v.dpr); g.clip();
        g.fillStyle = 'rgba(255,248,230,0.95)'; g.fillRect(xw - 0.75 * v.dpr, y - 8 * v.dpr, 1.5 * v.dpr, s + 16 * v.dpr);
        g.restore();
        g.fillStyle = '#fff8e6'; g.beginPath(); g.arc(xw, y + s / 2, 5 * v.dpr, 0, TAU); g.fill();
        const fs = 12.5 * v.dpr, ly = y + s + 18 * v.dpr;
        text(g, 'source', Math.max(x + 30 * v.dpr, xw - 46 * v.dpr), ly, fs, '#d8d0c0', 'center');
        text(g, 'thread', Math.min(x + s - 30 * v.dpr, xw + 46 * v.dpr), ly, fs, '#d8d0c0', 'center');
        return p.n;
      },
    },
    gallery: {
      shown: sh => sh.data.items ? sh.data.items.reduce((a, q) => a + q.p.n, 0) : 0,
      setup(sh, v) {
        const all = env.cache.list();
        if (!sh.data.pick) {
          const shuffled = all.slice().sort(() => r() - 0.5);
          sh.data.pick = shuffled.slice(0, Math.min(4, Math.max(2, shuffled.length)));
          sh.data.pan = r() < 0.5 ? 1 : -1;
        }
        const b = v.band, items = sh.data.pick, m = items.length;
        const wallW = Math.max(b.w * 1.35, b.w + 220 * v.dpr), gapX = wallW / m;
        sh.data.wallW = wallW;
        sh.data.items = items.map((p, q) => {
          const s = Math.min(gapX * 0.78, b.h * (q % 2 ? 0.62 : 0.74));
          const y = b.y + (b.h - s) / 2 + (q % 2 ? -1 : 1) * b.h * 0.05 - 12 * v.dpr;
          return { p, x: q * gapX + (gapX - s) / 2, y, s, done: 0 };
        });
        sh.data.zMax = 1.1;
        for (let q = 0; q < m; q++) {
          const it = sh.data.items[q], cs = it.s * sh.data.zMax, c = pool('gal' + q, cs, cs), cg = c.getContext('2d');
          cg.clearRect(0, 0, c.width, c.height); boardFill(cg, it.p, 0, 0, cs);
        }
      },
      draw(g, sh, v) {
        const b = v.band, T = sh.t / sh.dur, d = sh.data, u = easeIO(T);
        const zoom = lerp(1, d.zMax, Math.sin(Math.PI * clamp01(T)) * 0.9);
        const span = Math.max(0, d.wallW - b.w), off = (d.pan > 0 ? u : 1 - u) * span;
        // finish the piece rasters (a budget of lines per frame), at max zoom size
        let budget = 2600;
        for (let q = 0; q < d.items.length && budget > 0; q++) {
          const it = d.items[q]; if (it.done >= it.p.n) continue;
          const cs = it.s * d.zMax, c = pool('gal' + q, cs, cs), to = Math.min(it.p.n, it.done + budget);
          strokeLines(c.getContext('2d'), it.p, 0, 0, c.width, it.done, to, { zoom: 1, batch: 48 });
          budget -= to - it.done; it.done = to;
        }
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        g.save();
        g.translate(cx, cy); g.scale(zoom, zoom); g.translate(-cx, -cy);
        g.translate(b.x - off, 0);
        // wall light
        const wl = g.createLinearGradient(0, b.y - b.h * 0.3, 0, b.y + b.h * 1.3);
        wl.addColorStop(0, 'rgba(255,236,200,0.05)'); wl.addColorStop(0.5, 'rgba(255,236,200,0.02)'); wl.addColorStop(1, 'rgba(0,0,0,0.25)');
        g.fillStyle = wl; g.fillRect(-b.w, b.y - b.h, d.wallW + 2 * b.w, b.h * 3);
        for (let q = 0; q < d.items.length; q++) {
          const it = d.items[q], c = pool('gal' + q, it.s * d.zMax, it.s * d.zMax);
          // spot light on the wall
          const sp = g.createRadialGradient(it.x + it.s / 2, it.y - it.s * 0.1, 0, it.x + it.s / 2, it.y + it.s * 0.4, it.s * 0.95);
          sp.addColorStop(0, 'rgba(255,230,190,0.16)'); sp.addColorStop(1, 'rgba(255,230,190,0)');
          g.fillStyle = sp; g.fillRect(it.x - it.s * 0.5, it.y - it.s * 0.6, it.s * 2, it.s * 2.2);
          rim(g, it.p.cfg.shape, it.p.res, it.x, it.y, it.s, v.dpr, ['wood', 'brass', 'ebony'][q % 3]);
          g.save(); boardPath(g, it.p.cfg.shape, it.p.res, it.x, it.y, it.s); g.clip();
          g.drawImage(c, it.x, it.y, it.s, it.s);
          g.restore();
          lightSweep(g, it.p, it.x, it.y, it.s, (T * 1.25 - q * 0.12), 0.7);
          const m = srcMeta(it.p);
          text(g, `${m.name}`, it.x + it.s / 2, it.y + it.s + 22 * v.dpr, 12.5 * v.dpr, '#e6dfd0', 'center', 500, "'STIX Two Text', Georgia, serif");
          text(g, `${it.p.cfg.shape} · ${it.p.P} pegs · ${it.p.n.toLocaleString()} lines`, it.x + it.s / 2, it.y + it.s + 39 * v.dpr, 10.5 * v.dpr, '#a39c8f', 'center');
        }
        g.restore();
        return this.shown(sh);
      },
    },
  };

  // A big raster of a piece for camera moves: drawn once (in chunks) at
  // the largest size the shot shows, then only scaled down. The hairline
  // is drawn for that size (zoom 1), so the mean darkening holds at every
  // smaller size. sizes above BIG_CAP are drawn as vectors instead.
  const BIG_CAP = env.phone ? 2048 : 3072;
  function bigInit(sh, size) {
    const n = Math.min(BIG_CAP, Math.round(size)), c = pool('big', n, n), bg = c.getContext('2d');
    bg.save(); bg.setTransform(1, 0, 0, 1, 0, 0); bg.globalCompositeOperation = 'source-over'; bg.globalAlpha = 1;
    bg.clearRect(0, 0, n, n); boardFill(bg, sh.p, 0, 0, n); bg.restore();
    sh.big = { n, drawn: 0 };
  }
  function bigTo(sh, upTo, budget = 3000) {
    const b = sh.big, to = Math.min(sh.p.n, Math.floor(upTo), b.drawn + budget);
    if (to > b.drawn) { strokeLines(pool('big', b.n, b.n).getContext('2d'), sh.p, 0, 0, b.n, b.drawn, to, { zoom: 1, batch: 48 }); b.drawn = to; }
    return b.drawn;
  }
  /** Draw the piece at (x, y, s): the big raster scaled down, or vectors when s is larger. */
  function piece(g, sh, x, y, s, n, zoom) {
    if (sh.big && s <= sh.big.n + 0.5 && sh.big.drawn >= Math.floor(n)) {
      g.save(); boardPath(g, sh.p.cfg.shape, sh.p.res, x, y, s); g.clip();
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(pool('big', sh.big.n, sh.big.n), x, y, s, s); g.restore();
    } else { boardFill(g, sh.p, x, y, s); strokeLines(g, sh.p, x, y, s, 0, Math.floor(n), { zoom, batch: 48, cull: sh.view }); }
  }
  function clipBand(g, v) {
    const b = v.band, rr = 10 * v.dpr;
    g.beginPath();
    if (g.roundRect) g.roundRect(b.x, b.y, b.w, b.h, rr); else g.rect(b.x, b.y, b.w, b.h);
    g.clip();
  }

  /** The line numbers of each thread (cached on the piece). */
  function byThread(p) {
    if (p.byK) return p.byK;
    const cnt = new Int32Array(p.K); for (let i = 0; i < p.n; i++) cnt[p.L[3 * i]]++;
    const out = Array.from(cnt, c => new Int32Array(c)), at = new Int32Array(p.K);
    for (let i = 0; i < p.n; i++) { const k = p.L[3 * i]; out[k][at[k]++] = i; }
    return (p.byK = out);
  }

  /** A point of interest: one of the 3 blocks of the target with the most detail (variance), near the middle. */
  function detailPoi(p) {
    if (p.poiCache) return p.poiCache;
    const res = p.res, B = 16, nb = Math.floor(res / B), T = p.target, best = [];
    for (let by = 1; by < nb - 1; by++) for (let bx = 1; bx < nb - 1; bx++) {
      const ux = (bx + 0.5) / nb - 0.5, uy = (by + 0.5) / nb - 0.5;
      if (ux * ux + uy * uy > 0.09) continue;
      let s1 = 0, s2 = 0;
      for (let y = by * B; y < by * B + B; y += 2) for (let x = bx * B; x < bx * B + B; x += 2) { const v = T[y * res + x]; s1 += v; s2 += v * v; }
      const n = (B / 2) * (B / 2), varr = s2 / n - (s1 / n) * (s1 / n);
      best.push([varr, (bx + 0.5) / nb, (by + 0.5) / nb]);
    }
    best.sort((a, b) => b[0] - a[0]);
    const top = best.slice(0, 3).map(b => [b[1], b[2]]);
    return (p.poiCache = top.length ? top : [[0.5, 0.5]]);
  }

  function camAt(sq0, band, zoom, cx, cy) {
    const s = sq0.s * zoom, lim = c => Math.min(1 - 0.5 / zoom, Math.max(0.5 / zoom, c));
    const bx = band.x + band.w / 2, by = band.y + band.h / 2;
    return zoom > 1.001 ? { x: bx - lim(cx) * s, y: by - lim(cy) * s, s } : { x: bx - 0.5 * s, y: by - 0.5 * s, s };
  }

  // The cache canvas of a still camera: board and rim, then new lines only.
  function accInit(sh, v, pre = 0, chunk = false) {
    const acc = pool('acc', v.W, v.H), g = acc.getContext('2d');
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, v.W, v.H);
    const { x, y, s } = sh.sq;
    rim(g, sh.p.cfg.shape, sh.p.res, x, y, s, v.dpr, sh.kind === 'maker' ? 'brass' : 'wood');
    boardFill(g, sh.p, x, y, s);
    g.restore();
    sh.drawn = 0;
    if (pre && sh.data.n0) { strokeLines(g, sh.p, x, y, s, 0, sh.data.n0, { batch: 48 }); sh.drawn = sh.data.n0; }
    sh.chunk = chunk;
  }
  function accTo(sh, v, n) {
    n = Math.min(sh.p.n, Math.floor(n));
    if (n <= sh.drawn) return;
    const to = sh.chunk ? Math.min(n, sh.drawn + 2600) : n;
    const g = pool('acc', v.W, v.H).getContext('2d'), { x, y, s } = sh.sq;
    strokeLines(g, sh.p, x, y, s, sh.drawn, to, { batch: to - sh.drawn > 200 ? 48 : 1 });
    sh.drawn = to;
  }

  /** The candidate fan from the current peg: every legal line, by its gain; the winner bright. */
  function fan(g, sh, i, f, x, y, s, dpr) {
    const p = sh.p;
    if (sh.data.fanAt !== i) {
      replay.advance(i);
      lineAt(p, i, LT);
      const P = p.P, out = fanBuf.subarray(0, P);
      replay.fan(LT[0], out);
      let mx = 0; for (let j = 0; j < P; j++) if (out[j] > mx) mx = out[j];
      sh.data.fanMax = mx; sh.data.fanAt = i; sh.data.fanK = LT[0]; sh.data.fanA = LT[1]; sh.data.fanB = LT[2];
    }
    const k = s / p.res, a = sh.data.fanA, mx = sh.data.fanMax || 1;
    const ax = x + (p.pegs.x[a] + 0.5) * k, ay = y + (p.pegs.y[a] + 0.5) * k;
    const fade = 1 - ease(clamp01((f - 0.15) / 0.7));
    g.save();
    g.lineCap = 'round';
    g.lineWidth = Math.max(0.8, 0.9 * dpr);
    g.strokeStyle = p.cfg.dark ? '#7fd4ff' : '#2a7fd0';
    for (let j = 0; j < p.P; j++) {
      const gj = fanBuf[j];
      if (gj === NO_GAIN || gj <= 0) continue;
      const w = gj / mx;
      g.globalAlpha = fade * (0.05 + 0.55 * w * w);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(x + (p.pegs.x[j] + 0.5) * k, y + (p.pegs.y[j] + 0.5) * k); g.stroke();
    }
    const b = sh.data.fanB;
    g.globalAlpha = 0.25 + 0.75 * fade; g.strokeStyle = '#ff5a3c'; g.lineWidth = 2.2 * dpr;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(x + (p.pegs.x[b] + 0.5) * k, y + (p.pegs.y[b] + 0.5) * k); g.stroke();
    g.restore();
  }

  /** The build sheet ticker: rows "line  thread  from -> to", the current row lit. */
  function ticker(g, sh, v, i, f) {
    const p = sh.p, T = sh.tick, d = v.dpr, rowH = 24 * d;
    g.save();
    g.beginPath(); g.rect(T.x, T.y, T.w, T.h); g.clip();
    g.fillStyle = 'rgba(8,10,14,0.55)'; g.fillRect(T.x, T.y, T.w, T.h);
    g.font = `500 ${Math.round(13 * d)}px 'IBM Plex Mono', ui-monospace, Menlo, monospace`; g.textBaseline = 'middle';
    if (T.vert) {
      text(g, 'BUILD SHEET', T.x + 14 * d, T.y + 16 * d, 10.5 * d, '#9a937f', 'left', 600);
      const top = T.y + 40 * d, rows = Math.floor((T.h - 46 * d) / rowH), mid = Math.floor(rows * 0.6);
      for (let q = -mid; q <= rows - mid; q++) {
        const li = i + q; if (li < 0 || li >= p.n) continue;
        lineAt(p, li, LT);
        const yy = top + (q + mid - ease(f)) * rowH;
        if (yy < top - rowH || yy > T.y + T.h) continue;
        const now = q === 0;
        g.globalAlpha = now ? 1 : Math.max(0.15, 1 - Math.abs(q) * 0.09);
        g.fillStyle = now ? '#ffcf4a' : '#d8d0c0'; g.textAlign = 'left';
        g.fillText(String(li + 1).padStart(5, ' '), T.x + 12 * d, yy);
        g.fillStyle = p.colHex[LT[0]]; g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = d;
        g.beginPath(); g.arc(T.x + 74 * d, yy, 5 * d, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = now ? '#ffcf4a' : '#e6dfd0';
        g.fillText(`${String(LT[1]).padStart(3, ' ')} → ${String(LT[2]).padStart(3, ' ')}`, T.x + 90 * d, yy);
      }
      g.globalAlpha = 1;
      const len = threadLength(p, i + f);
      text(g, `${len.toFixed(1)} m of thread`, T.x + 14 * d, T.y + T.h - 14 * d, 11 * d, '#9a937f', 'left', 500);
    } else {
      const cy = T.y + T.h * 0.42, colW = 108 * d, mid = T.x + T.w * 0.45;
      for (let q = -6; q <= 6; q++) {
        const li = i + q; if (li < 0 || li >= p.n) continue;
        lineAt(p, li, LT);
        const xx = mid + (q - ease(f)) * colW;
        if (xx < T.x - colW || xx > T.x + T.w + colW) continue;
        g.globalAlpha = q === 0 ? 1 : Math.max(0.2, 1 - Math.abs(q) * 0.16);
        g.fillStyle = q === 0 ? '#ffcf4a' : '#e6dfd0'; g.textAlign = 'center';
        g.fillText(`${LT[1]}→${LT[2]}`, xx, cy);
        g.fillStyle = p.colHex[LT[0]]; g.beginPath(); g.arc(xx, cy + 15 * d, 3.5 * d, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
      text(g, `line ${i + 1} · ${threadLength(p, i + f).toFixed(1)} m`, T.x + T.w / 2, T.y + T.h * 0.85, 10.5 * d, '#9a937f', 'center');
    }
    g.restore();
  }

  /** A soft blur of the frame (two downsample steps). mask: a sharp centre. glow: a screen bloom. */
  function blurPass(g, v, amount, mask, glow) {
    const W = v.W, H = v.H;
    const a = pool('blurA', W / 4, H / 4), b2 = pool('blurB', W / 16, H / 16);
    const ag = a.getContext('2d'), bg = b2.getContext('2d');
    ag.imageSmoothingEnabled = true; bg.imageSmoothingEnabled = true;
    ag.globalCompositeOperation = 'copy'; ag.drawImage(g.canvas, 0, 0, W, H, 0, 0, a.width, a.height); ag.globalCompositeOperation = 'source-over';
    bg.globalCompositeOperation = 'copy'; bg.drawImage(a, 0, 0, a.width, a.height, 0, 0, b2.width, b2.height); bg.globalCompositeOperation = 'source-over';
    ag.globalCompositeOperation = 'copy'; ag.drawImage(b2, 0, 0, b2.width, b2.height, 0, 0, a.width, a.height); ag.globalCompositeOperation = 'source-over';
    g.save();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (glow > 0) { g.globalCompositeOperation = 'screen'; g.globalAlpha = glow * amount; g.drawImage(a, 0, 0, a.width, a.height, 0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
    if (mask) {
      const full = pool('blurFull', W, H), fg = full.getContext('2d');
      fg.save(); fg.globalCompositeOperation = 'copy'; fg.imageSmoothingEnabled = true; fg.drawImage(a, 0, 0, a.width, a.height, 0, 0, W, H);
      fg.globalCompositeOperation = 'destination-in';
      const cx = v.band.x + v.band.w / 2, cy = v.band.y + v.band.h / 2, R = Math.min(v.band.w, v.band.h) * 0.5;
      const gr = fg.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.6);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
      fg.fillStyle = gr; fg.fillRect(0, 0, W, H); fg.restore();
      g.globalAlpha = amount; g.drawImage(full, 0, 0);
    } else { g.globalAlpha = amount; g.drawImage(a, 0, 0, a.width, a.height, 0, 0, W, H); }
    g.restore();
  }

  // ── the plate ────────────────────────────────────────────────────────────
  function plateInfo() {
    if (!shot) return null;
    const sh = shot, n = Math.floor(sh.shownNow || 0);
    if (sh.kind === 'gallery') {
      const items = sh.data.items || [];
      const total = items.reduce((a, q) => a + threadLength(q.p, q.p.n), 0);
      return {
        title: TITLES.gallery, sub: 'Finished pieces in circle, square and hexagon frames',
        params: [
          { sym: 'N', name: 'pieces', value: String(items.length), cls: 'm1' },
          { sym: 'n', name: 'lines', value: items.reduce((a, q) => a + q.p.n, 0).toLocaleString(), cls: 'm2' },
          { sym: 'ℓ', name: 'thread', value: `${Math.round(total).toLocaleString()} m`, cls: 'm3' },
        ],
        tex: TEX, lines: [`Thread length: the chords, on frames ${BOARD_M * 100} cm wide.`, 'After the idea of image-stylization-threading by Jérémie Piellard; our own model and WGSL'],
      };
    }
    const p = sh.p, m = srcMeta(p), len = threadLength(p, n);
    const subs = {
      needle: 'Each line is the one that lowers the error most; the fan is every candidate from the peg',
      split: 'The target, what is still missing, and the thread that removes it',
      chase: 'The needle goes peg to peg; then the camera pulls back to the picture',
      layers: `${p.K} threads: each colour builds alone (small panels shown darker), then the layers combine`,
      maker: 'Peg numbers and the build sheet: the sequence a maker follows by hand',
      push: 'Close, only straight chords; far, a picture',
      rack: 'From the crossings of single threads to the whole image',
      wipe: 'The source image and its thread piece',
    };
    const threads = p.K === 1 ? (p.cfg.dark ? '1 · white on black' : '1 · black on white') : `${p.K} · ${p.spec.pal === 'image' ? 'from the image' : p.spec.pal === 'cmyk' ? 'CMY + K' : 'RGB + W'}`;
    return {
      title: `${TITLES[sh.kind]} · ${m.name}`, sub: subs[sh.kind],
      params: [
        { sym: 'F', name: 'frame', value: p.cfg.shape, cls: 'm1' },
        { sym: 'P', name: 'pegs', value: String(p.P), cls: 'm5' },
        { sym: 'n', name: 'lines', value: `${n.toLocaleString()} / ${p.n.toLocaleString()}`, cls: 'm2' },
        { sym: 'ℓ', name: 'thread', value: `${len < 100 ? len.toFixed(1) : Math.round(len).toLocaleString()} m`, cls: 'm3' },
        { sym: 'K', name: 'threads', value: threads, cls: 'm4' },
      ],
      tex: TEX,
      lines: [m.credit, `Thread length: the chords, on a frame ${BOARD_M * 100} cm wide. After the idea of image-stylization-threading by Jérémie Piellard; our own model and WGSL.`],
    };
  }

  // ── the frame ────────────────────────────────────────────────────────────
  function frame(g, dt, v) {
    clock += dt;
    if (!shot && !nextShot()) { waiting += dt; wall(g, v.W, v.H); return; }
    shot.t += dt; shot.dt = dt;
    if (shot.t >= shot.dur) {
      // snapshot the last frame for the cross-fade, then cut
      const fc = pool('fade', v.W, v.H), fg = fc.getContext('2d');
      fg.globalCompositeOperation = 'copy'; fg.drawImage(g.canvas, 0, 0); fg.globalCompositeOperation = 'source-over';
      if (!nextShot()) shot.dur += 1;
    }
    const key = [v.W, v.H, v.band.x, v.band.y, v.band.w, v.band.h].map(q => Math.round(q)).join('|');
    if (shot.key !== key) { shot.key = key; shot.view = v.band; SHOTS[shot.kind].setup(shot, v); }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    wall(g, v.W, v.H, shot.kind === 'gallery' ? 1 : 0);
    shot.shownNow = SHOTS[shot.kind].draw(g, shot, v);
    if (fadeT < 1) {
      fadeT = Math.min(1, fadeT + dt / 0.85);
      g.globalAlpha = 1 - ease(fadeT); g.drawImage(pool('fade', v.W, v.H), 0, 0); g.globalAlpha = 1;
    }
    // the shot's own in-fade at the very start, and the fade out before a cut
    g.restore();
    if (env.label && clock - labelAt > 0.45) { labelAt = clock; env.label(plateInfo()); }
  }

  feed();
  return {
    frame,
    cut(kind) { if (kind && !KINDS.includes(kind)) return false; return nextShot(kind || null); },
    plate: plateInfo,
    debug() {
      return shot ? { kind: shot.kind, t: +shot.t.toFixed(2), dur: +shot.dur.toFixed(2), shown: Math.floor(shot.shownNow || 0), n: shot.p ? shot.p.n : 0,
        count, cache: env.cache.size, cacheBytes: env.cache.bytes(), canvases: created, slots: slots.size, ready: env.producer.readyCount,
        pending: env.producer.pending, kinds: [...kindsSeen] } : { waiting: +waiting.toFixed(2), ready: env.producer.readyCount, pending: env.producer.pending };
    },
    get shot() { return shot; },
    get canvases() { return created; },
  };
}
