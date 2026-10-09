// ============================================================================
//  NONFLOWERS  ·  grow.js — the stroke replay on canvases (page and saver)
// ----------------------------------------------------------------------------
//  Our own code around Nonflowers by Lingdong Huang (2018, MIT). It draws a
//  recorded plant (pool.js record(): rec, sheet, inked, painting) stage by
//  stage. record.js has the strokes, the stages and the play clock.
//
//  LAYERS. Two 1200 px canvases, as upstream woody() and herbal() use:
//  layer 0 (stems and leaves) and layer 1 (petals). sync(n) draws strokes
//  in playback order with record.js drawStroke() until n are drawn or the
//  time budget ends, so a long stage spans many frames and the main
//  thread does not stop. A step back restores a checkpoint and draws on.
//
//  CHECKPOINTS. At the start of each stroke stage, sync() keeps a copy of
//  the part of both layers that shows in the painting (a 600 px window at
//  the blit offset). At most CP_MAX copies stay; the start (empty layers)
//  needs none.
//
//  COMPOSE. compose(at) draws the 600 px painting for a stepper state
//  (record.js createStepper().at()) into G.canvas:
//    paper   the white sheet, then the paper columns in the order of the
//            upstream paper() loop (from the two edges of each 512 px
//            tile to its middle)
//    strokes the sheet, layer 0 with blend multiply, layer 1 on top, at
//            the upstream blit offset (as upstream Layer.blit)
//    shade   the same, with the filtered result (inked) under a line that
//            moves down, as Layer.filter walks the rows
//    mount   inked, then the bordered painting with the squircle traced
//    done    the one-shot painting itself
//  It returns the pen point (painting px) of the last stroke, or null.
//
//  GREP MAP
//    grep -n 'export function createGrowth'   the replay object
//    grep -n 'function sync'                  draw strokes within a budget
//    grep -n 'function compose'               one frame of the painting
// ============================================================================
import { SIZE } from './engine.js';
import { drawStroke } from './record.js';

const LAY = 1200, CP_MAX = 16;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function createGrowth(P, chs) {
  const rec = P.rec, c0 = canvas(LAY, LAY), c1 = canvas(LAY, LAY), out = canvas(SIZE, SIZE);
  const g0 = c0.getContext('2d'), g1 = c1.getContext('2d'), go = out.getContext('2d');
  const xref = rec.xref, yref = rec.yref;
  // The painting window in layer px (integer, so a copy back is exact).
  const wx = Math.max(0, Math.min(LAY - 1, Math.floor(-xref))), wy = Math.max(0, Math.min(LAY - 1, Math.floor(-yref)));
  const ww = Math.min(SIZE + 1, LAY - wx), wh = Math.min(SIZE + 1, LAY - wy);
  const starts = new Set(chs.filter(c => c.to > c.from).map(c => c.from));
  const cps = new Map();   // stroke count -> [copy0, copy1]
  let drawn = 0;
  const now = () => performance.now();

  function clear() { g0.clearRect(0, 0, LAY, LAY); g1.clearRect(0, 0, LAY, LAY); drawn = 0; }
  function keep() {
    if (cps.has(drawn) || drawn === 0) return;
    const a = canvas(ww, wh), b = canvas(ww, wh);
    a.getContext('2d').drawImage(c0, wx, wy, ww, wh, 0, 0, ww, wh);
    b.getContext('2d').drawImage(c1, wx, wy, ww, wh, 0, 0, ww, wh);
    cps.set(drawn, [a, b]);
    // Drop the copy nearest to another one when there are too many.
    if (cps.size > CP_MAX) {
      const ks = [...cps.keys()].sort((x, y) => x - y);
      let best = 1, gap = Infinity;
      for (let i = 1; i < ks.length - 1; i++) { const d = ks[i + 1] - ks[i - 1]; if (d < gap) { gap = d; best = i; } }
      cps.delete(ks[best]);
    }
  }
  function restore(n) {
    let k = 0;
    for (const key of cps.keys()) if (key <= n && key > k) k = key;
    clear();
    if (k) {
      const [a, b] = cps.get(k);
      g0.drawImage(a, wx, wy); g1.drawImage(b, wx, wy);
      drawn = k;
    }
  }
  // Draw until n strokes are done or budget ms pass. Returns the count.
  function sync(n, budget = 8) {
    n = Math.max(0, Math.min(rec.n, n));
    if (n < drawn) restore(n);
    const t0 = now();
    let i = 0;
    while (drawn < n) {
      if (starts.has(drawn)) keep();
      const s = rec.order[drawn];
      drawStroke(rec.layer[s] ? g1 : g0, rec, s);
      drawn++;
      if ((++i & 15) === 0 && now() - t0 > budget) break;
    }
    return drawn;
  }
  function pen() {
    if (!drawn) return null;
    const s = rec.order[drawn - 1], j = rec.off[s + 1] - 1;
    if (j < rec.off[s]) return null;
    return { x: rec.pts[2 * j] + xref, y: rec.pts[2 * j + 1] + yref };
  }
  function layers() {
    go.globalCompositeOperation = 'multiply'; go.drawImage(c0, xref, yref);
    go.globalCompositeOperation = 'source-over'; go.drawImage(c1, xref, yref);
  }
  function squircle(g, u) {
    // r(θ) = 0.98 (cos^3 θ + sin^3 θ)^(-1/3) on each quarter, in painting px.
    g.beginPath();
    const N = Math.max(2, Math.ceil(240 * u));
    for (let i = 0; i <= N; i++) {
      const th = (i / 240) * Math.PI * 2, q = ((th % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      const r = 0.98 * Math.pow(1 / (Math.pow(Math.cos(q), 3) + Math.pow(Math.sin(q), 3)), 1 / 3);
      const x = SIZE / 2 * (1 + r * Math.cos(th)), y = SIZE / 2 * (1 + r * Math.sin(th));
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  function compose(at) {
    const key = at.chapter.key, u = at.u;
    go.setTransform(1, 0, 0, 1, 0, 0); go.globalAlpha = 1; go.globalCompositeOperation = 'source-over';
    go.clearRect(0, 0, SIZE, SIZE);
    if (at.done) { go.drawImage(P.painting, 0, 0); return null; }
    if (key === 'paper') {
      go.fillStyle = 'white'; go.fillRect(0, 0, SIZE, SIZE);
      const i = Math.min(257, Math.ceil(257 * u));
      go.save(); go.beginPath();
      for (const ox of [0, 512]) { go.rect(ox, 0, i, SIZE); go.rect(ox + 512 - i + 1, 0, i, SIZE); }
      go.clip(); go.drawImage(P.sheet, 0, 0); go.restore();
      return { x: Math.min(SIZE - 1, i), y: SIZE * (0.15 + 0.7 * ((u * 9) % 1)), paper: true };
    }
    if (key === 'mount') {
      go.drawImage(P.painting, 0, 0);
      go.globalAlpha = 1 - u; go.drawImage(P.inked, 0, 0); go.globalAlpha = 1;
      go.strokeStyle = 'rgba(160,40,30,0.85)'; go.lineWidth = 2; squircle(go, u);
      return null;
    }
    go.drawImage(P.sheet, 0, 0);
    layers();
    if (key === 'shade') {
      const y = SIZE * u;
      go.save(); go.beginPath(); go.rect(0, 0, SIZE, y); go.clip(); go.drawImage(P.inked, 0, 0); go.restore();
      go.fillStyle = 'rgba(160,40,30,0.55)'; go.fillRect(0, y - 1, SIZE, 2);
      return null;
    }
    return pen();
  }
  return {
    canvas: out, sync, compose, pen,
    get drawn() { return drawn; },
    get checkpoints() { return cps.size; },
    release() { c0.width = c1.width = out.width = 1; cps.clear(); },
  };
}
