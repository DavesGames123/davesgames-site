// ============================================================================
//  CORAL REEF  ·  explainer diagram: one walker joins a tip (2D canvas)
// ----------------------------------------------------------------------------
//  A small 2D model of lib/dla-engine.js grows a cluster up from a seabed
//  line, with snow that falls from the top. The diagram then records the
//  real walk of the next walker (the trace option of addParticle) and
//  plays it back: the dot follows the walk, the trail fades, and the new
//  particle flashes where it joins. Most walks end on a tip, because a tip
//  is the first part that a falling walker meets.
//
//  The walk jumps: dlaf moves a walker by its distance to the cluster less
//  the attraction distance, so far from the cluster the steps are long.
//
//  grep -n targets
//    the model ........... "function newModel"
//    one recorded walk ... "function nextWalk"
//    drawing ............. "function draw"
// ============================================================================
import { createModel, randomInUnitSphere } from '../../lib/dla-engine.js';
import { sample } from '../../lib/growth-gradients.js';

export function mountDiagram(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { start() {}, stop() {}, size() {} };
  let m, walk = null, wi = 0, flash = null, raf = 0, on = false, seed = 11;
  const W = 60, H = 44;              // model units shown

  function newModel() {
    const top = { y: 6 };
    m = createModel({
      dim: 2, seed: seed++, params: { particleSpacing: 1, attractionDistance: 1.4, minMoveDistance: 0.7, stickiness: 0.9 },
      maxSteps: 3000,
      hooks: {
        randomStartingPosition(mm, out) { out[0] = (mm.random() - 0.5) * W * 0.8; out[1] = top.y + 8; out[2] = 0; return out; },
        shouldReset(mm, p) { return p[1] < 0 || p[1] > top.y + 14 || Math.abs(p[0]) > W * 0.5; },
        motionVector(mm, p, out) { randomInUnitSphere(mm.random, 2, out); out[1] -= 0.45; return out; },
        placeParticle(mm, p, parent, out) { mm.lerpFrom(parent, p, mm.params.particleSpacing, out); if (out[1] < 0) out[1] = 0; return out; },
      },
      onAdd(i, par, mm) { const y = mm.pos[i * 3 + 1]; if (y > top.y) top.y = y; },
    });
    for (let x = -24; x <= 24; x += 12) m.add([x, 0, 0]);
    m.grow(opts.start ?? 260);
  }

  function nextWalk() {
    const pts = [];
    const id = m.addParticle((p, kind) => { if (kind === 2) pts.length = 0; else pts.push(p[0], p[1]); });
    pts.push(m.pos[id * 3], m.pos[id * 3 + 1]);
    walk = { pts, id, par: m.parent[id] };
    wi = 0;
  }

  function toPx(x, y) {
    const w = canvas.width, h = canvas.height, s = Math.min(w / W, h / H);
    return [w / 2 + x * s, h - 8 - y * s, s];
  }

  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#071a24'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b3a2f'; ctx.fillRect(0, h - 8, w, 8);
    const n = m.count, c = [0, 0, 0], P = m.pos, s = toPx(0, 0)[2];
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const p = m.parent[i]; if (p < 0 || (walk && i === walk.id && !flash)) continue;
      sample(opts.gradient ? opts.gradient() : 'reef', i / Math.max(1, n - 1), false, c);
      ctx.strokeStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;
      ctx.lineWidth = Math.max(1, s * 0.7);
      const a = toPx(P[p * 3], P[p * 3 + 1]), b = toPx(P[i * 3], P[i * 3 + 1]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    if (walk) {
      const k = Math.min(wi, walk.pts.length / 2 - 1);
      ctx.lineWidth = 1;
      for (let j = Math.max(1, k - 60); j <= k; j++) {
        const a = toPx(walk.pts[j * 2 - 2], walk.pts[j * 2 - 1]), b = toPx(walk.pts[j * 2], walk.pts[j * 2 + 1]);
        ctx.strokeStyle = `rgba(200,235,240,${(0.08 + 0.6 * (j - k + 60) / 60).toFixed(2)})`;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      const d = toPx(walk.pts[k * 2], walk.pts[k * 2 + 1]);
      ctx.fillStyle = '#e8fbff'; ctx.beginPath(); ctx.arc(d[0], d[1], Math.max(2.5, s * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    if (flash) {
      const d = toPx(flash.x, flash.y), r = Math.max(4, s * 1.2) * (1 + flash.t * 2.5);
      ctx.strokeStyle = `rgba(255,214,110,${(1 - flash.t).toFixed(2)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(d[0], d[1], r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(190,220,228,0.85)'; ctx.font = `${Math.round(11 * (window.devicePixelRatio || 1))}px system-ui, sans-serif`;
    ctx.fillText('marine snow falls', 8, 16 * (window.devicePixelRatio || 1));
  }

  let last = 0, joins = 0;
  function frame(t) {
    raf = on ? requestAnimationFrame(frame) : 0;
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (!walk) nextWalk();
    const steps = walk.pts.length / 2;
    wi += Math.max(1, steps / 150) * dt * 60;     // a walk plays in about 2.5 s
    if (wi >= steps - 1 && !flash) {
      flash = { x: walk.pts[walk.pts.length - 2], y: walk.pts[walk.pts.length - 1], t: 0 };
    }
    if (flash) {
      flash.t += dt * 1.4;
      if (flash.t >= 1) { flash = null; walk = null; if (++joins > 40) { joins = 0; newModel(); } else m.grow(3); }
    }
    draw();
  }

  function size() {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    canvas.width = Math.max(10, Math.round(r.width * d)); canvas.height = Math.max(10, Math.round(r.height * d));
  }

  newModel();
  return {
    start() { if (on) return; on = true; size(); last = 0; raf = requestAnimationFrame(frame); },
    stop() { on = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    size,
  };
}
