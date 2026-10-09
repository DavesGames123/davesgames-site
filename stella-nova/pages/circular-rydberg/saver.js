// ============================================================================
//  CIRCULAR RYDBERG  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides
//  the page, puts one full-window canvas on top and plays a seeded shuffle
//  of seven shot kinds (data.js shotPlan, no kind twice in a row, 6 to
//  12 s each): a ring growing with n, a cloud turning into a ring, a wave
//  packet going round, low l against circular, the preparation ladder,
//  the population cascade and the lifetime data. Subjects sit in the clear
//  band between the shell plate texts (lib/saver-clear.js plateBand). The
//  plate carries the state and one TeX line, never code.
//  The page loop in main.js stops while window.__crSaver is true.
//
//  grep -n targets
//    shot kinds and plates .. "const SHOTS"
//    frame loop ............. "function frame"
// ============================================================================
import * as P from './physics.js';
import { shotPlan, PAPER } from './data.js';
import { createCloud } from './cloud.js';
import { drawPrep, prepN, drawCascade, drawLifetime, PAL } from './draw.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const CAP = { d: PAPER.plateGapMm * 1e-3, R: PAPER.reflectivity };

// A shot: setup(R) -> state; plate(state) -> plate payload; draw(ctx) where
// ctx = { g (2D, CSS px), w, h (band size), k (0..1), tau, st, cloud(pts, view) }.
const SHOTS = {
  grow: {
    setup: R => ({ n0: 3 + Math.floor(R() * 6), n1: 80 + Math.floor(R() * 24), yaw: R() * 6, pitch: 0.75 + R() * 0.45 }),
    plate: s => ({ title: 'A circular orbit grows', sub: `|nC⟩ from n = ${s.n0} to n = ${s.n1}, drawn to one scale`, tex: ['\\langle r\\rangle = n\\left(n+\\tfrac12\\right)a_0'], lines: ['Electron density sampled from the hydrogen wave function', `At n = ${s.n1}: ${(2 * P.meanR(s.n1) * P.AU.a0 * 1e6).toFixed(2)} µm across`] }),
    draw: c => {
      const s = c.st, n = Math.round(s.n0 + (s.n1 - s.n0) * smooth(c.k / 0.85));
      if (s.n !== n) { s.n = n; s.pts = P.sampleCircular(n, c.N, 17 + n); }
      const ext = P.meanR(s.n1) + 3 * P.sigmaR(s.n1);
      c.cloud(s.pts, { yaw: s.yaw + c.tau * 0.18, pitch: s.pitch, scale: Math.min(c.w, c.h) * 0.47 / ext, m: n - 1, phase: c.tau * 1.4 });
      c.caption(`n = ${n}`);
    },
  },
  morph: {
    setup: R => { const n = 24 + Math.floor(R() * 40), l = Math.floor(R() * 4), m = Math.floor(R() * (l + 1)); return { n, l, m, yaw: R() * 6 }; },
    plate: s => ({ title: 'From a cloud to a ring', sub: `n = ${s.n}: l = ${s.l} becomes l = m = ${s.n - 1}`, tex: ['|\\psi_{n,n-1,n-1}|^2 \\propto r^{2n-2} e^{-2r/(n a_0)} \\sin^{2n-2}\\theta'], lines: ['Same shell, largest angular momentum', 'Points paired by azimuth, then moved'] }),
    draw: c => {
      const s = c.st;
      if (!s.A) {
        const a = P.sampleState(s.n, s.l, s.m, c.N, 3), b = P.sampleCircular(s.n, c.N, 4);
        const ord = arr => [...Array(arr.length / 4).keys()].sort((i, j) => arr[i * 4 + 3] - arr[j * 4 + 3]);
        const re = (arr, idx) => { const o = new Float32Array(arr.length); idx.forEach((q, d) => o.set(arr.subarray(q * 4, q * 4 + 4), d * 4)); return o; };
        s.A = re(a, ord(a)); s.B = re(b, ord(b));
      }
      const mk = smooth((c.k - 0.25) / 0.5);
      c.cloud(s.A, { yaw: s.yaw + c.tau * 0.15, pitch: 1.05 - 0.25 * mk, scale: Math.min(c.w, c.h) * 0.47 / (2 * s.n * s.n + 6 * s.n), mix: { pts2: s.B, k: mk } });
      c.caption(mk < 0.5 ? `n = ${s.n}, l = ${s.l}` : `|${s.n}C⟩`);
    },
  },
  packet: {
    setup: R => ({ n: 30 + Math.floor(R() * 50), yaw: R() * 6, pitch: 0.55 + R() * 0.5 }),
    plate: s => ({ title: 'A wave packet on the ring', sub: `circular states near n = ${s.n}, added with their phases`, tex: ['T_{\\mathrm{orb}} = 2\\pi n^3\\,\\frac{\\hbar}{E_h}'], lines: [`Real period at n = ${s.n}: ${(2 * Math.PI * s.n ** 3 * P.AU.t * 1e12).toPrecision(3)} ps, shown about 10¹² times slower`, 'Colour: the phase of the wave function (drawn with 6 turns, not n − 1)'] }),
    draw: c => {
      const s = c.st; if (!s.pts) s.pts = P.sampleCircular(s.n, c.N, 9);
      c.cloud(s.pts, { yaw: s.yaw + c.tau * 0.05, pitch: s.pitch, scale: Math.min(c.w, c.h) * 0.47 / (P.meanR(s.n) + 3 * P.sigmaR(s.n)), m: s.n - 1, cycles: 6, phase: c.tau * 2.2, colour: 'phase', packet: { phi: c.tau * 1.3, width: 0.34 } });
    },
  },
  compare: {
    setup: R => ({ n: 18 + Math.floor(R() * 40), yaw: R() * 6 }),
    plate: s => ({ title: 'Same energy, different shapes', sub: `n = ${s.n}: l = 0 (left) against l = m = ${s.n - 1} (right)`, tex: ['E_n = -\\frac{R_y}{n^2}'], lines: ['In hydrogen every l of one n has the same energy', 'Only the circular state cannot fall more than one rung'] }),
    draw: c => {
      const s = c.st; if (!s.a) { s.a = P.sampleState(s.n, 0, 0, c.N, 21); s.b = P.sampleCircular(s.n, c.N, 22); }
      const sc = Math.min(c.w / 2, c.h) * 0.46 / (2 * s.n * s.n + 6 * s.n);
      c.cloud(s.a, { yaw: s.yaw + c.tau * 0.15, pitch: 1.0, scale: sc, cxf: 0.25 });
      c.cloud(s.b, { yaw: s.yaw + c.tau * 0.15, pitch: 1.0, scale: sc, cxf: 0.75, m: s.n - 1, phase: c.tau }, true);
    },
  },
  ladder: {
    setup: R => ({ yaw: R() * 6 }),
    plate: () => ({ title: 'Up the ladder to n = 103', sub: '⁸⁸Sr: laser, radio frequency, then two-photon microwave steps', tex: ['|n\\,C\\rangle \\xrightarrow{\;2\\,\\mu\\mathrm{w}\;} |n+2\\,C\\rangle'], lines: [`${PAPER.pulses} pulses, about ${Math.round(PAPER.stepFidelity * 100)} % per step`, 'Pultinevicius et al., Nat. Commun. 2026'] }),
    draw: c => {
      const s = c.st, k = clamp(c.k * 1.08, 0, 1);
      if (!s.B) s.B = P.sampleCircular(79, c.N, 31);
      const wl = c.w * 0.56;
      const n = prepN(k) || 79, f = P.meanR(n) / P.meanR(79);
      if (!s.G) s.G = new Float32Array(s.B.length);
      for (let i = 0; i < s.G.length; i++) s.G[i] = (i % 4 === 3) ? s.B[i] : s.B[i] * f;
      // the cloud first (it fills the band), then the ladder on top of it
      c.cloud(k < 0.28 ? null : s.G, { yaw: s.yaw + c.tau * 0.2, pitch: 1.0, scale: Math.min(c.w - wl, c.h) * 0.46 / (P.meanR(103) + 3 * P.sigmaR(103)), cxf: (wl + (c.w - wl) / 2) / c.w });
      c.chart(0, 0, wl, c.h, (g, w, h) => drawPrep(g, w, h, { k }));
    },
  },
  cascade: {
    setup: R => ({ cap: R() < 0.65, n: 81 + 2 * Math.floor(R() * 11) }),
    plate: s => ({ title: s.cap ? 'Held between the plates' : 'Kicked by blackbody light', sub: `|${s.n}C⟩ at 300 K, ${s.cap ? 'σ light below c/2d removed' : 'free space'}`, tex: ['\\bar n = \\frac{1}{e^{h\\nu/k_BT}-1}'], lines: ['Our rate model: the circular ladder and one bin for the rest', 'Populations against hold time'] }),
    draw: c => {
      const s = c.st; if (!s.res) s.res = P.cascade(s.n, { T: 300, cap: s.cap ? CAP : null, tMax: s.cap ? 0.03 : 0.003, W: 5 });
      const tMax = s.res.times[s.res.times.length - 1];
      const w = Math.min(c.w * 0.9, 1100), h = Math.min(c.h * 0.86, 520);
      c.chart((c.w - w) / 2, (c.h - h) / 2, w, h, (g, ww, hh) => drawCascade(g, ww, hh, { res: s.res, t: tMax * clamp(c.k * 1.1, 0.002, 1), label: s.cap ? 'between the plates' : 'free space' }));
    },
  },
  lifetime: {
    setup: R => ({ hi: [95, 97, 99, 101][Math.floor(R() * 4)] }),
    plate: s => ({ title: 'More than 10 ms at room temperature', sub: 'measured lifetimes of strontium circular states against n', tex: ['\\Gamma = \\sum_s \\left(\\bar n + \\delta_{s}\\right)\\xi\\,A_{nC,s}'], lines: [`|101C⟩: ${PAPER.tau101Ms}(${PAPER.tau101ErrMs * 10}) ms, ${PAPER.enhancement}× free space`, 'Points: published data. Lines: our hydrogen model'] }),
    draw: c => {
      const w = Math.min(c.w * 0.9, 1100), h = Math.min(c.h * 0.86, 520);
      c.chart((c.w - w) / 2, (c.h - h) / 2, w, h, (g, ww, hh) => drawLifetime(g, ww, hh, { reveal: smooth(c.k / 0.7), hi: c.st.hi }));
    },
  },
};

let run = null;
window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const calm = clamp(o.calm == null ? 0.6 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || ((Math.random() * 1e9) >>> 0);
    const plan = shotPlan(seed, 60, calm);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__crSaver = true;
    const phone = matchMedia('(max-width: 860px)').matches;
    const off = document.createElement('canvas'), chartCv = document.createElement('canvas'), clouds = [createCloud(1, 1), createCloud(1, 1)];
    run = { plan, css, cv, raf: 0, i: 0, tau: 0, last: 0, plated: -1, st: null, N: phone ? 12000 : 26000 };
    const g = cv.getContext('2d');
    const begin = () => {
      const shot = plan[run.i % plan.length];
      let s = shot.seed >>> 0 || 1;
      const R = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      run.st = SHOTS[shot.id].setup(R);
    };
    begin();
    const frame = now => {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      let shot = plan[run.i % plan.length];
      run.tau += dt * (1 - 0.3 * calm);
      if (run.tau >= shot.sec) { run.tau = 0; run.i++; shot = plan[run.i % plan.length]; begin(); }
      const S = SHOTS[shot.id], k = run.tau / shot.sec;
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const top = band ? band.t : 0, bot = band ? band.b : 0, bh = Math.max(140, h - top - bot);
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = PAL.bg; g.fillRect(0, 0, cv.width, cv.height);
      // the band in device px, a slow push-in about its centre
      const z = 1 + 0.06 * smooth(k);
      let cloudN = 0;
      const ctx = {
        w, h: bh, k, tau: run.tau, st: run.st, N: run.N,
        cloud: (pts, view, second) => {
          if (!pts) return;
          const cw = Math.round(w * dpr), ch = Math.round(bh * dpr), px = cw * ch, sc = px > 1.5e6 ? Math.sqrt(1.5e6 / px) : 1;
          const W = Math.round(cw * sc), H = Math.round(ch * sc);
          const cl = clouds[cloudN++ % 2]; cl.resize(W, H);
          off.width = W; off.height = H;
          cl.render(off.getContext('2d'), pts, Object.assign({ cx: W * (view.cxf || 0.5), cy: H / 2, bg: [5, 7, 12] }, view, { scale: view.scale * dpr * sc * z }));
          g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
          if (second) { g.drawImage(off, W * 0.5, 0, W * 0.5, H, cw * 0.5, top * dpr, cw * 0.5, ch); }
          else g.drawImage(off, 0, 0, W, H, 0, top * dpr, cw, ch);
          g.restore();
        },
        // a chart draws on its own canvas (its clearRect must not punch
        // through the saver canvas), then lands in the band with the push-in
        chart: (x, y, cw, ch, f) => {
          const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
          if (chartCv.width !== pw || chartCv.height !== ph) { chartCv.width = pw; chartCv.height = ph; }
          const cg = chartCv.getContext('2d'); cg.setTransform(dpr, 0, 0, dpr, 0, 0); f(cg, cw, ch);
          g.save(); g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - (w / 2 - x) * z), dpr * (top + bh / 2 - (bh / 2 - y) * z));
          g.drawImage(chartCv, 0, 0, cw, ch); g.restore();
        },
        caption: t => { g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = 'rgba(232,234,240,0.7)'; g.font = '500 14px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(t, w - 24, top + bh - 16); g.restore(); },
      };
      try { S.draw(ctx); } catch (e) { /* a bad frame is skipped */ }
      const f = smooth(Math.min(run.tau, shot.sec - run.tau) / (0.5 + 0.6 * calm));
      if (f < 1) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = `rgba(5,7,12,${1 - f})`; g.fillRect(0, 0, cv.width, cv.height); }
      if (run.plated !== run.i && typeof o.label === 'function') {
        run.plated = run.i;
        try { o.label(Object.assign({}, S.plate(run.st), { anchor: () => ({ x: w / 2, y: top + bh / 2, r: Math.min(w, bh) * 0.4 }) })); } catch (e) { /* the plate is optional */ }
      }
      run.raf = requestAnimationFrame(frame);
    };
    run.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 600 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    run.cv.remove(); run.css.remove();
    run = null; window.__crSaver = false;
  },
};
window.snSaver.debug = () => run ? { i: run.i, id: run.plan[run.i % run.plan.length].id, tau: run.tau, sec: run.plan[run.i % run.plan.length].sec } : null;
export { SHOTS };
