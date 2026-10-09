// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · explain.js — live figures for the explainer under the lab
// ────────────────────────────────────────────────────────────────────────────
//  Each <canvas data-fig="name"> in #explain gets one figure. A figure is a
//  draw(ctx, w, h, t) function; t is wall seconds. Only figures in view
//  animate (IntersectionObserver), and the loop stops on pagehide. The
//  equations are [data-tex] boxes, typeset by lib/sci-math.js (MathJax SVG).
//  The figures use closed-form solutions, not the grid solver, so they cost
//  almost nothing.
//
//  SECTION MAP   (grep -n "<anchor>" explain.js)
//    entry ............... "export function initExplainer"
//    travelling waves .... "dalembert:"
//    standing waves ...... "standing:"
//    Mersenne ............ "mersenne:"
//    harmonic series ..... "series:"
//    pluck position ...... "pluck:"
//    inharmonicity ....... "stiff:"
//    frets ............... "frets:"
//    body ................ "body:"
//    Helmholtz motion .... "helmholtz:"
//    interval table ...... "function intervalTable"
// ════════════════════════════════════════════════════════════════════════════

import { typesetAll } from '../../lib/sci-math.js';
import { INSTRUMENTS, noteName, freqToMidi } from './engine/instruments.js';
import { INTERVALS, ratioOf } from './engine/harmonics.js';
import { BODY_MODES, peakingCoefs } from './engine/audio.js';

const C = { m1: '#62c4ff', m2: '#ff9a62', m3: '#86dc7c', m4: '#e889dc', m5: '#ffd666', m6: '#a8a4ff', text: '#dde1ec', dim: '#8b92a8', line: 'rgba(143,182,255,0.16)', bg: '#0a0c14', red: '#ff6a6a' };
const FONT = '500 11px Inter, system-ui, sans-serif';

/** Odd 2-periodic extension of a triangle pluck at p (peak 1). */
function tri(x, p) {
  let y = ((x % 2) + 2) % 2, s = 1;
  if (y > 1) { y = 2 - y; s = -1; }
  return s * (y <= p ? y / p : (1 - y) / (1 - p));
}

function axisLine(ctx, x0, x1, y) {
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke();
}
function ends(ctx, x0, x1, y, h) {
  ctx.fillStyle = '#8e7b62';
  ctx.fillRect(x0 - 4, y - h, 4, 2 * h); ctx.fillRect(x1, y - h, 4, 2 * h);
}
function curve(ctx, x0, x1, y, amp, fn, color, lw = 2, n = 200) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = i / n, px = x0 + (x1 - x0) * x, py = y - amp * fn(x);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.stroke();
}
function label(ctx, text, x, y, color = C.dim, align = 'left') {
  ctx.fillStyle = color; ctx.font = FONT; ctx.textAlign = align; ctx.fillText(text, x, y);
}

export const FIGURES = {
  dalembert: {
    animated: true,
    draw(ctx, w, h, t) {
      const p = 0.3, x0 = 30, x1 = w - 30, y = h * 0.55, A = h * 0.32;
      const ct = (t * 0.12) % 2;
      axisLine(ctx, x0, x1, y); ends(ctx, x0, x1, y, A * 0.4);
      curve(ctx, x0, x1, y, A, (x) => 0.5 * tri(x - ct, p), C.m1, 1.6);
      curve(ctx, x0, x1, y, A, (x) => 0.5 * tri(x + ct, p), C.m2, 1.6);
      curve(ctx, x0, x1, y, A, (x) => 0.5 * tri(x - ct, p) + 0.5 * tri(x + ct, p), '#f4f5fa', 3);
      label(ctx, 'f(x − ct)', x0, 18, C.m1); label(ctx, 'g(x + ct)', x0 + 80, 18, C.m2); label(ctx, 'sum: the string', x0 + 160, 18, '#f4f5fa');
      label(ctx, `t = ${(ct / 2).toFixed(2)} of a period`, x1, 18, C.dim, 'right');
    },
  },

  standing: {
    animated: true,
    draw(ctx, w, h, t) {
      const x0 = 46, x1 = w - 20, rows = 5, rh = h / rows;
      for (let n = 1; n <= rows; n++) {
        const y = rh * (n - 0.5), A = rh * 0.36, ph = Math.cos(2 * Math.PI * 0.22 * n * t);
        axisLine(ctx, x0, x1, y);
        curve(ctx, x0, x1, y, A, (x) => Math.sin(n * Math.PI * x) * ph, [C.m5, C.m1, C.m2, C.m3, C.m4][n - 1], 2.4);
        ctx.fillStyle = C.text;
        for (let k = 0; k <= n; k++) { ctx.beginPath(); ctx.arc(x0 + ((x1 - x0) * k) / n, y, 3, 0, Math.PI * 2); ctx.fill(); }
        label(ctx, `n = ${n}`, 8, y + 4, C.text);
      }
    },
  },

  mersenne: {
    animated: true,
    setup(fig) {
      const base = INSTRUMENTS.classical.strings[5];
      fig.mu0 = base.mu;
      fig.ctl = {};
      for (const el of fig.figure.querySelectorAll('[data-ctl]')) fig.ctl[el.dataset.ctl] = el;
    },
    draw(ctx, w, h, t, fig) {
      const L = +fig.ctl.L.value, T = +fig.ctl.T.value, mu = fig.mu0 * +fig.ctl.mu.value;
      const f = Math.sqrt(T / mu) / (2 * L);
      const x0 = 30, xs = (w - 60) / 0.7, x1 = x0 + L * xs, y = h * 0.55;
      axisLine(ctx, x0, w - 30, y); ends(ctx, x0, x1, y, 24);
      // shown 200 times slower; the phase accumulates so a slider move does not jump
      fig.ph = (fig.ph || 0) + (fig.dt || 0) * f / 200;
      curve(ctx, x0, x1, y, 30 * Math.cos(2 * Math.PI * fig.ph), (x) => Math.sin(Math.PI * x), C.m4, 3);
      const note = noteName(Math.round(freqToMidi(f)));
      ctx.fillStyle = '#f4f5fa'; ctx.font = '600 15px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`f₁ = ${f.toFixed(1)} Hz (${note})`, x0, 24);
      label(ctx, `L = ${(L * 1000).toFixed(0)} mm`, x0, h - 12, C.m6);
      label(ctx, `T = ${T.toFixed(0)} N`, x0 + 110, h - 12, C.m2);
      label(ctx, `μ = ${(mu * 1000).toFixed(2)} g/m`, x0 + 200, h - 12, C.m3);
      label(ctx, `c = ${Math.sqrt(T / mu).toFixed(0)} m/s`, x0 + 320, h - 12, C.m1);
    },
  },

  series: {
    animated: true,
    draw(ctx, w, h, t) {
      const f1 = 82.41, fLo = 60, fHi = 1200, x0 = 20, x1 = w - 20, base = h - 34, top = 30;
      const X = (f) => x0 + (Math.log(f / fLo) / Math.log(fHi / fLo)) * (x1 - x0);
      axisLine(ctx, x0, x1, base);
      const hi = Math.floor(t * 0.8) % 12 + 1;
      for (let n = 1; n <= 12; n++) {
        const x = X(n * f1), col = n === hi ? C.m5 : n === 1 ? C.m4 : C.m1;
        ctx.strokeStyle = col; ctx.lineWidth = n === hi ? 3 : 2;
        ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, top + (n - 1) * 3); ctx.stroke();
        label(ctx, String(n), x, base + 14, col, 'center');
        if (n < 12 && X((n + 1) * f1) - x > 26) {
          const r = ratioOf(n + 1, n);
          label(ctx, `${n + 1}:${n}`, (x + X((n + 1) * f1)) / 2, top + 50 + (n % 2) * 16, n === hi || n + 1 === hi ? C.m5 : C.dim, 'center');
          if (r.name && n <= 5) label(ctx, r.name, (x + X((n + 1) * f1)) / 2, top + 84 + (n % 2) * 14, C.dim, 'center');
        }
      }
      label(ctx, `harmonic ${hi}: ${(hi * f1).toFixed(1)} Hz, ${noteName(Math.round(freqToMidi(hi * f1)))}`, x1, 16, C.m5, 'right');
      label(ctx, 'log frequency', x0, h - 6);
    },
  },

  pluck: {
    animated: true,
    draw(ctx, w, h, t) {
      const p = 0.275 + 0.225 * Math.sin(t * 0.35);
      const x0 = 30, x1 = w - 30, y = h * 0.3, A = h * 0.18;
      axisLine(ctx, x0, x1, y); ends(ctx, x0, x1, y, A * 0.5);
      curve(ctx, x0, x1, y, A, (x) => tri(x, p), C.m2, 2.6);
      ctx.fillStyle = C.m2; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * p, y - A, 4, 0, Math.PI * 2); ctx.fill();
      label(ctx, `p = ${p.toFixed(3)}`, x0, 16, C.m2);
      const N = 16, bx0 = x0, bw = (x1 - x0) / N, base = h - 22, bh = h * 0.42;
      const v = [];
      let m = 0;
      for (let n = 1; n <= N; n++) { const a = Math.abs(Math.sin(n * Math.PI * p)) / n; v.push(a); m = Math.max(m, a); }
      for (let n = 1; n <= N; n++) {
        const a = v[n - 1] / m, x = bx0 + (n - 1) * bw + bw * 0.18, zero = Math.abs(Math.sin(n * Math.PI * p)) < 0.08;
        ctx.fillStyle = zero ? C.red : C.m1;
        ctx.fillRect(x, base - Math.max(2, a * bh), bw * 0.64, Math.max(2, a * bh));
        label(ctx, String(n), x + bw * 0.32, base + 13, zero ? C.red : C.dim, 'center');
      }
      label(ctx, 'force on the bridge, by harmonic', x1, base - bh - 6, C.dim, 'right');
    },
  },

  stiff: {
    animated: false,
    draw(ctx, w, h) {
      const st = INSTRUMENTS.steel.strings;
      const sets = [
        { B: st[4].B, name: `plain steel B3 (B = ${st[4].B.toExponential(1)})`, col: C.m1 },
        { B: st[0].B, name: `wound E2 (B = ${st[0].B.toExponential(1)})`, col: C.m3 },
        { B: st[4].B * 30, name: `30 × the plain B3 value`, col: C.m4 },
      ];
      const N = 16, x0 = 44, x1 = w - 16, top = 16, base = h - 28;
      const maxC = 1200 * Math.log2(Math.sqrt(1 + sets[2].B * N * N));
      const X = (n) => x0 + ((n - 1) / (N - 1)) * (x1 - x0), Y = (c) => base - (c / maxC) * (base - top);
      axisLine(ctx, x0, x1, base);
      for (let c = 0; c <= maxC; c += maxC > 60 ? 20 : 5) { label(ctx, `${c}¢`, x0 - 6, Y(c) + 4, C.dim, 'right'); ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(x0, Y(c)); ctx.lineTo(x1, Y(c)); ctx.stroke(); }
      for (let n = 1; n <= N; n++) label(ctx, String(n), X(n), base + 14, C.dim, 'center');
      sets.forEach((s, k) => {
        ctx.strokeStyle = s.col; ctx.lineWidth = 2.2; ctx.beginPath();
        for (let n = 1; n <= N; n++) { const c = 1200 * Math.log2(Math.sqrt(1 + s.B * n * n)); n === 1 ? ctx.moveTo(X(n), Y(c)) : ctx.lineTo(X(n), Y(c)); }
        ctx.stroke();
        label(ctx, s.name, x0 + 8, top + 14 + k * 15, s.col);
      });
      label(ctx, 'harmonic n', x1, h - 4, C.dim, 'right');
    },
  },

  frets: {
    animated: false,
    draw(ctx, w, h) {
      const L = 0.648, x0 = 20, x1 = w - 20, y = h * 0.42, X = (d) => x0 + (d / L) * (x1 - x0);
      ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x0, y - 26, (x1 - x0) * 0.75, 52);
      ctx.fillStyle = '#c9c2b0'; ctx.fillRect(x0 - 3, y - 26, 4, 52);
      ctx.fillStyle = '#8e7b62'; ctx.fillRect(x1 - 2, y - 30, 5, 60);
      ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 1.5;
      for (let n = 1; n <= 19; n++) {
        const x = X(L * (1 - 2 ** (-n / 12)));
        ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x, y + 26); ctx.stroke();
        if ([3, 5, 7, 9, 12, 15, 17, 19].includes(n)) label(ctx, String(n), x - 4, y + 42, C.dim, 'center');
      }
      // just intervals: where the fret would be for a pure ratio
      const just = [[5, 4, 'M3 5/4'], [4, 3, '4th 4/3'], [3, 2, '5th 3/2'], [5, 3, 'M6 5/3'], [2, 1, 'octave 2/1']];
      just.forEach(([a, b, name], k) => {
        const x = X(L * (1 - b / a));
        ctx.strokeStyle = C.m2; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y - 34); ctx.lineTo(x, y - 26); ctx.stroke();
        label(ctx, name, x, y - 40 - (k % 2) * 13, C.m2, 'center');
      });
      label(ctx, 'white: equal-tempered frets. orange: where a pure ratio would put the fret', x0, h - 10, C.dim);
    },
  },

  body: {
    animated: false,
    draw(ctx, w, h) {
      const fs = 44100, fLo = 50, fHi = 6000, x0 = 40, x1 = w - 16, top = 20, base = h - 28;
      const X = (f) => x0 + (Math.log(f / fLo) / Math.log(fHi / fLo)) * (x1 - x0);
      const dbMax = 14, dbMin = -6, Y = (d) => base - ((d - dbMin) / (dbMax - dbMin)) * (base - top);
      for (const d of [0, 6, 12]) { ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(x0, Y(d)); ctx.lineTo(x1, Y(d)); ctx.stroke(); label(ctx, `${d} dB`, x0 - 4, Y(d) + 4, C.dim, 'right'); }
      for (const f of [100, 200, 500, 1000, 2000, 5000]) label(ctx, f >= 1000 ? `${f / 1000}k` : String(f), X(f), base + 14, C.dim, 'center');
      const sets = [['steel', 'steel-string guitar', C.m5], ['classical', 'classical guitar', C.m3], ['violin', 'violin', C.m4]];
      sets.forEach(([key, name, col], k) => {
        const cs = BODY_MODES[key].map((m) => peakingCoefs(m.f, m.q, m.gainDb, fs));
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i <= 300; i++) {
          const f = fLo * (fHi / fLo) ** (i / 300), wv = (2 * Math.PI * f) / fs;
          let g = 0;
          for (const c of cs) {
            const zr = Math.cos(wv), zi = -Math.sin(wv), z2r = Math.cos(2 * wv), z2i = -Math.sin(2 * wv);
            const nr = c.b0 + c.b1 * zr + c.b2 * z2r, ni = c.b1 * zi + c.b2 * z2i;
            const dr = 1 + c.a1 * zr + c.a2 * z2r, di = c.a1 * zi + c.a2 * z2i;
            g += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
          }
          i ? ctx.lineTo(X(f), Y(g)) : ctx.moveTo(X(f), Y(g));
        }
        ctx.stroke();
        label(ctx, name, x1, top + 12 + k * 15, col, 'right');
      });
      label(ctx, 'Hz', x1, h - 4, C.dim, 'right');
    },
  },

  helmholtz: {
    animated: true,
    draw(ctx, w, h, t) {
      const beta = 0.18, x0 = 30, x1 = w - 30, y = h * 0.3, A = h * 0.16;
      const phase = (t * 0.25) % 1;
      const shape = (ph) => {
        const up = ph < 0.5, xc = up ? 2 * ph : 2 - 2 * ph;
        const yc = (up ? 1 : -1) * 4 * xc * (1 - xc);
        return { xc, yc, at: (x) => (x <= xc ? (xc > 0 ? (yc * x) / xc : 0) : xc < 1 ? (yc * (1 - x)) / (1 - xc) : 0) };
      };
      axisLine(ctx, x0, x1, y); ends(ctx, x0, x1, y, A * 0.6);
      // the lens-shaped envelope
      curve(ctx, x0, x1, y, A, (x) => 4 * x * (1 - x), 'rgba(232,137,220,0.35)', 1);
      curve(ctx, x0, x1, y, A, (x) => -4 * x * (1 - x), 'rgba(232,137,220,0.35)', 1);
      const s = shape(phase);
      curve(ctx, x0, x1, y, A, s.at, '#f4f5fa', 2.6);
      ctx.fillStyle = C.m4; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * s.xc, y - A * s.yc, 4.5, 0, Math.PI * 2); ctx.fill();
      const bx = x0 + (x1 - x0) * beta;
      ctx.fillStyle = 'rgba(232,201,150,0.5)'; ctx.fillRect(bx - 3, y - A * 1.1, 6, A * 2.2);
      label(ctx, 'bow', bx, y + A * 1.1 + 14, '#e8c996', 'center');
      // velocity under the bow over two periods
      const gy = h * 0.78, gh = h * 0.16, M = 400;
      axisLine(ctx, x0, x1, gy);
      ctx.strokeStyle = C.m1; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= M; i++) {
        const ph = (2 * i) / M, a = shape((ph + 1e-3) % 1).at(beta), b = shape(ph % 1).at(beta);
        const v = (a - b) / 1e-3;
        const vv = Math.max(-1, Math.min(1, v / 3));
        const px = x0 + ((x1 - x0) * i) / M, py = gy - gh * vv;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      const cx = x0 + (x1 - x0) * (phase / 2);
      ctx.strokeStyle = C.m5; ctx.beginPath(); ctx.moveTo(cx, gy - gh - 6); ctx.lineTo(cx, gy + gh + 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + (x1 - x0) / 2, gy - gh - 6); ctx.lineTo(cx + (x1 - x0) / 2, gy + gh + 6); ctx.stroke();
      const slip = s.xc < beta;
      label(ctx, slip ? 'slip: the corner passes the bow' : 'stick: the string moves with the bow', x0, 16, slip ? C.m5 : C.dim);
      label(ctx, 'string velocity at the bow', x0, gy - gh - 10, C.m1);
    },
  },
};

/** The just-vs-equal interval table. */
function intervalTable(table) {
  if (!table) return;
  const head = document.createElement('tr');
  for (const t of ['Interval', 'Equal (cents)', 'Just ratio', 'Just (cents)', 'Difference']) { const th = document.createElement('th'); th.textContent = t; head.appendChild(th); }
  const rows = INTERVALS.filter((iv) => iv.semis > 0).map((iv) => {
    const tr = document.createElement('tr');
    const cells = [iv.name, iv.etCents.toFixed(0), `${iv.just[0]}/${iv.just[1]}`, iv.justCents.toFixed(1), `${iv.diff >= 0 ? '+' : ''}${iv.diff.toFixed(1)}`];
    cells.forEach((c, k) => { const td = document.createElement('td'); td.textContent = c; if (k === 4 && Math.abs(iv.diff) > 10) td.className = 'bad'; tr.appendChild(td); });
    return tr;
  });
  table.replaceChildren(head, ...rows);
}

export function initExplainer(root) {
  if (!root) return null;
  typesetAll(root).catch(() => {});
  intervalTable(root.querySelector('#ivTable'));
  const figs = [];
  for (const canvas of root.querySelectorAll('canvas[data-fig]')) {
    const def = FIGURES[canvas.dataset.fig];
    if (!def) continue;
    const fig = { canvas, def, ctx: canvas.getContext('2d'), figure: canvas.closest('figure'), visible: false, w: 0, h: 0, dirty: true };
    def.setup?.(fig);
    if (fig.figure) fig.figure.addEventListener('input', () => { fig.dirty = true; });
    figs.push(fig);
  }
  const size = (f) => {
    const r = f.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    f.w = Math.max(1, Math.round(r.width)); f.h = Math.max(1, Math.round(r.height)); f.dpr = dpr;
    f.canvas.width = Math.round(f.w * dpr); f.canvas.height = Math.round(f.h * dpr);
    f.dirty = true;
  };
  figs.forEach(size);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((es) => { for (const e of es) { const f = figs.find((x) => x.canvas === e.target); if (f) size(f); } });
    figs.forEach((f) => ro.observe(f.canvas));
  }
  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((es) => { for (const e of es) { const f = figs.find((x) => x.canvas === e.target); if (f) { f.visible = e.isIntersecting; f.dirty = true; } } }, { rootMargin: '80px' });
    figs.forEach((f) => io.observe(f.canvas));
  } else figs.forEach((f) => { f.visible = true; });

  let raf = 0, last = 0, alive = true;
  const t0 = performance.now();
  const loop = (now) => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const t = (now - t0) / 1000;
    for (const f of figs) {
      if (!f.visible || (!f.def.animated && !f.dirty)) continue;
      f.dirty = false; f.dt = dt;
      const ctx = f.ctx;
      ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, f.w, f.h);
      f.def.draw(ctx, f.w, f.h, t, f);
    }
  };
  raf = requestAnimationFrame(loop);
  window.addEventListener('pagehide', () => { alive = false; cancelAnimationFrame(raf); });
  window.addEventListener('pageshow', (e) => { if (e.persisted && !alive) { alive = true; last = 0; raf = requestAnimationFrame(loop); } });
  return { figs };
}
