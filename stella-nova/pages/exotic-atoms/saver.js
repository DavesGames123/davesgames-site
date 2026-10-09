// ============================================================================
//  EXOTIC ATOMS  ·  screensaver hook (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). enter() hides the
//  page, puts one full-window canvas on top and plays a seeded bag of shots
//  (shotPlan: no kind twice in a row, 6 to 12 s). The plate carries the
//  state, one TeX line and short notes, never code. Subjects sit in the
//  clear band between the plate texts (lib/saver-clear.js plateBand).
//
//  HEADLINE: THE CLIMB (seven variants, climb.js CLIMBS)
//    An atom starts in the ground state and absorbs one photon at a time.
//    Each photon is a wave train in the colour of its real wavelength (UV,
//    visible, infrared, terahertz, microwave, radio); the level diagram
//    steps up; the cloud morphs to the new state in magma. The first steps
//    go one by one, then the ladder speeds up to n = 50 ... 300, and a last
//    photon ionizes the atom: the cloud dissolves into the continuum. The
//    camera follows the size with a spring, so the cloud swells past the
//    frame before the view pulls back. Real objects (a virus, a bacterium,
//    a red blood cell) are drawn to the same scale. A note names what
//    limits the atom at that n (climb.js limitsAt / worstLimit).
//  OTHER SHOTS
//    swell      clouds swell from n = 1 to n = 200, no photons
//    trilobite  a ground-state atom comes in and the trilobite forms
//    bloom      field lines of a circular state's current grow outward
//    packet     a Kepler wave packet goes round, spreads and revives
//    scale      positronium, hydrogen, muonic hydrogen at one scale, zoom
//    squeeze    hydrogen in 10^2 to 10^8 T: the cloud becomes a needle
//  The page loop in main.js stops while window.__eaSaver is true.
//
//  grep -n targets
//    shot plan ........ "export function shotPlan"
//    the climb ........ "function climbShot"
//    other shots ...... "const SHOTS"
//    frame loop ....... "function frame"
// ============================================================================
import * as Ph from './physics.js';
import * as St from './states.js';
import * as Bf from './bfield.js';
import * as K from './climb.js';
import { makeScene } from './scene.js';
import { drawLadder, drawPhoton, drawScaleBar, proj } from './draw.js';
import * as CM from '../ct-lab/colormaps/maps.js';
import { rng } from '../circular-rydberg/physics.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const SUB = n => String(n);

export const CLIMB_KINDS = Object.keys(K.CLIMBS).map(id => 'climb:' + id);
export const OTHER_KINDS = ['swell', 'trilobite', 'bloom', 'packet', 'scale', 'squeeze'];
export const SHOT_KINDS = CLIMB_KINDS.concat(OTHER_KINDS);
// Seeded bag: every kind once per bag, shuffled, never the same kind twice
// in a row (also across bags). Climbs get 10 to 12 s, others 6 to 10 s.
export function shotPlan(seed = 1, count = 40, calm = 0.6) {
  const R = rng(seed >>> 0 || 1), out = [];
  let bag = [];
  while (out.length < count) {
    if (!bag.length) { bag = SHOT_KINDS.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    let k = bag.findIndex(x => !out.length || x !== out[out.length - 1].id);
    if (k < 0) k = 0;
    const id = bag.splice(k, 1)[0], climb = id.startsWith('climb:');
    out.push({ id, sec: climb ? 10 + 2 * Math.min(1, 0.4 * calm + 0.6 * R()) : 6 + 4 * Math.min(1, 0.35 * calm + 0.65 * R()), seed: Math.floor(R() * 1e9) });
  }
  return out;
}

// ---------------------------------------------------------------- climb
// the position along the ladder at shot progress k: the first s0 steps one
// by one, then faster (power law), then the ionizing photon
export function climbPace(k, S, s0 = Math.min(5, S)) {
  const kA = 0.4, kB = 0.86;
  if (k < kA) return { p: s0 * k / kA, ion: 0, slow: true };
  if (k < kB) return { p: s0 + (S - s0) * Math.pow((k - kA) / (kB - kA), 1.7), ion: 0, slow: false };
  return { p: S, ion: (k - kB) / (1 - kB), slow: false };
}
const TEX = {
  yrast: 'E_n = -\\frac{\\mathrm{Ry}}{n^2},\\qquad \\Delta E_{n\\to n+1} \\approx \\frac{2\\,\\mathrm{Ry}}{n^3}',
  sp: '|n\\,s\\rangle \\to |n{+}1\\,p\\rangle \\to |n{+}2\\,s\\rangle:\\quad \\Delta\\ell = \\pm 1,\\ \\Delta m = 0',
  alkali: 'E_{n\\ell} = -\\frac{\\mathrm{Ry}_{\\mathrm{Rb}}}{(n-\\delta_\\ell)^2},\\quad \\delta_s = 3.131,\\ \\delta_p = 2.642',
  exciton: 'E_n = E_g - \\frac{\\mathrm{Ry}^*}{n^2},\\quad \\mathrm{Ry}^* = 92\\ \\mathrm{meV}',
  field: '\\mu_z = -m\\,\\mu_B,\\qquad B(0) \\approx \\frac{\\mu_0\\mu_B}{2\\pi a_0^3}\\,\\frac{n-1}{n^6}',
  it: 'F_{\\mathrm{IT}} = \\frac{1}{3n^5}\\,\\frac{E_h}{e a_0}',
};
function climbShot(id) {
  const v = K.CLIMBS[id];
  return {
    setup(R) {
      const top = v.tops[Math.floor(R() * v.tops.length)], steps = K.climbSteps(id, top), sp = Ph.SPECIES[v.sp];
      const last = steps[steps.length - 1].to, ion = K.ionizeStep(id, last);
      const levels = [steps[0].from].concat(steps.map(s => s.to)).map((q, i) => {
        const eV = q[0] === 0 ? sp.gapEV : Ph.bindingEV(sp, q[0], q[1]);
        const lab = q[0] === 0 ? 'crystal' : `n = ${q[0]}`;
        return { n: q[0], l: q[1], m: q[2], eV, label: lab, tag: i === 0 || [2, 3, 5, 10, 20, 50, 100, 200, 300].includes(q[0]) && (i === 0 || steps[i - 1].from[0] !== q[0]) };
      });
      const st = { id, v, sp, top, steps, ion, levels, yaw: R() * 6, pitch: v.rule === 'yrast' ? 0.9 + R() * 0.4 : 1.0 + R() * 0.3, cache: new Map(), lscale: null, lv: 0, lastSample: -1, shown: null, milestone: -1, lim: null, limT: -1 };
      if (v.field) {
        const ref = 16, F = Bf.solveAxisym(St.densityNLM(ref, ref - 1, ref - 1), { g: -1, ext: Ph.meanR(ref, ref - 1) * 1.6, ns: 40, nt: 32, symmetric: true });
        st.ref = ref; st.refLines = Bf.fieldLines(F, { lines: 7 });
      }
      return st;
    },
    plate(s, extra = {}) {
      const cur = extra.cur == null ? 0 : extra.cur, L = s.levels[cur], step = s.steps[Math.max(0, Math.min(s.steps.length - 1, cur - 1))];
      const sizeM = L.n ? 2 * Ph.sizeM(s.sp, L.n, L.l) : 0;
      const params = L.n ? [{ sym: 'n', value: String(L.n), name: 'principal' }, { sym: '\\ell', value: String(L.l), name: 'angular' }, { sym: 'm', value: String(L.m), name: 'magnetic' }] : [{ sym: 'n', value: '—', name: 'no exciton yet' }];
      if (cur > 0) params.push({ sym: '\\lambda', value: K.fmtLen(step.lam), name: `${step.band} photon` });
      const tex = s.v.field ? TEX.field : extra.ion ? TEX.it : s.v.rule === 'yrast' && s.sp.id !== 'X' ? TEX.yrast : s.v.rule === 'sp' ? TEX.sp : s.v.rule === 'alkali' ? TEX.alkali : TEX.exciton;
      const lines = [];
      if (sizeM) lines.push(`${K.fmtLen(sizeM)} across: ${K.scaleLabel(sizeM)}`);
      if (extra.limit) lines.push(`Limit: ${extra.limit}`);
      if (extra.ion) lines.push('One more photon: the electron leaves, the cloud joins the continuum');
      return { title: `Climbing ${s.sp.name.toLowerCase()} one photon at a time`, sub: `${s.v.title}: from the ground state toward n = ${s.top}`, params, tex: [tex], lines };
    },
    draw(c) {
      const s = c.st, S = s.steps.length, pace = climbPace(c.k, S), cur = Math.min(S, Math.floor(pace.p)), frac = pace.p - cur;
      const L = s.levels[cur], next = s.levels[Math.min(S, cur + 1)];
      // cloud: the current state, morphing to the next in the last 40 % of a slow step
      const getCloud = q => {
        const key = q.n + ',' + q.l + ',' + q.m;
        if (!s.cache.has(key)) { if (s.cache.size > 24) s.cache.clear(); const nn = Math.max(1, q.n); s.cache.set(key, St.pairByAzimuth(St.sampleNLM(nn, Math.min(q.l, nn - 1), Math.min(q.m, q.l), c.N, 11 + q.n))); }
        return s.cache.get(key);
      };
      const now = c.tau;
      let cl = null, mix = null;
      if (L.n > 0) {
        if (pace.slow || now - s.lastSample > 0.14 || !s.shown) { s.shown = { q: L, c: getCloud(L) }; s.lastSample = now; }
        cl = s.shown.c;
        const rShown = Ph.meanR(Math.max(1, s.shown.q.n), Math.min(s.shown.q.l, s.shown.q.n - 1)), rNow = Ph.meanR(L.n, L.l);
        if (Math.abs(rNow / rShown - 1) > 0.001) { const f = rNow / rShown; s.G = s.G && s.G.length === cl.pts.length ? s.G : new Float32Array(cl.pts.length); for (let i = 0; i < s.G.length; i++) s.G[i] = i % 4 === 3 ? cl.pts[i] : cl.pts[i] * f; cl = { pts: s.G, dens: cl.dens }; }
        if (pace.slow && frac > 0.6 && next && next.n > 0) mix = { pts2: getCloud(next).pts, k: smooth((frac - 0.6) / 0.4) };
      } else if (pace.slow && frac > 0.6 && next) { cl = getCloud(next); }
      // ionization: points fly out, the cloud fades
      let weights = null;
      if (pace.ion > 0 && cl) {
        const f = 1 + 4 * pace.ion * pace.ion, n = cl.pts.length;
        s.I = s.I && s.I.length === n ? s.I : new Float32Array(n);
        for (let i = 0; i < n; i++) s.I[i] = i % 4 === 3 ? cl.pts[i] : cl.pts[i] * f * (1 + 0.3 * Math.sin(i * 1.7) * pace.ion);
        cl = { pts: s.I, dens: cl.dens };
      }
      // camera: a spring on log(scale) toward the size of the current state
      const nNow = Math.max(1, L.n || 2), lNow = L.n ? L.l : 1, ext = Ph.meanR(nNow, Math.min(lNow, nNow - 1)) * (lNow === nNow - 1 ? 1.25 : 1.15) + 2;
      const wl = Math.min(220, c.w * 0.2), cw = c.w - wl, target = Math.log(Math.min(cw, c.h) * 0.42 / ext);
      if (s.lscale == null) s.lscale = target;
      const om = pace.slow ? 3.5 : 1.7;   // a slow spring in the fast climb: the cloud swells past the frame
      s.lv += (om * om * (target - s.lscale) - 2 * om * s.lv) * c.dt; s.lscale += s.lv * c.dt;
      const scale = Math.exp(s.lscale) * (1 - 0.15 * pace.ion);
      const cx = wl + cw / 2, cy = c.h / 2;
      const view = c.cloud(cl, { yaw: s.yaw + c.tau * 0.12, pitch: s.pitch, scale, cx, cy, mix, m: L.m || 0, exposure: 1 - 0.85 * pace.ion,
        lines: s.refLines && L.n > 1 ? scaledLines(s, L.n) : null, ring: 0 });
      // reference objects at the same scale, right of the atom
      const aM = Ph.units(s.sp).a, g = c.g;
      drawRefs(g, c, cx, cy, scale, aM, ext);
      // the ladder and the photon
      const photons = [];
      if (cur < S && pace.ion === 0) photons.push({ i0: cur, i1: cur + 1, rgb: Ph.photonRGB(s.steps[cur].lam), k: frac, slot: 0.5 });
      if (pace.ion > 0) photons.push({ i0: S, i1: S, ion: true, rgb: Ph.photonRGB(s.ion.lam), k: Math.min(0.99, pace.ion * 1.5), slot: 0.5 });
      const eMin = s.levels[S].eV * 0.55, eMax = s.levels[0].eV * 1.7;
      c.over(g2 => {
        drawLadder(g2, 18, 0, wl - 70, c.h, { levels: s.levels, cur, photons, title: s.sp.name, ion: pace.ion, eMin, eMax });
        const st2 = pace.ion > 0 ? s.ion : cur < S ? s.steps[cur] : null;
        if (st2) {
          const pk = pace.ion > 0 ? Math.min(1, pace.ion * 2.2) : Math.min(1, frac / 0.6);
          if (pk < 1) drawPhoton(g2, wl - 30, cy - c.h * 0.32, cx, cy, pk, st2.lam, Ph.photonRGB(st2.lam), { label: `${K.fmtLen(st2.lam)} · ${st2.band}${st2.hz < 3e12 ? ' · ' + K.fmtHz(st2.hz) : ''}` });
        }
        // caption
        g2.fillStyle = 'rgba(240,236,228,0.85)'; g2.font = '500 15px Inter, system-ui, sans-serif'; g2.textAlign = 'right';
        const sz = L.n ? 2 * Ph.sizeM(s.sp, L.n, L.l) : 0;
        g2.fillText(pace.ion > 0 ? `ionized: E > 0` : L.n ? `n = ${L.n} · l = ${L.l} · m = ${L.m} · ${K.fmtLen(sz)}` : 'crystal ground state', c.w - 22, c.h - 18);
        g2.font = '12px Inter, system-ui, sans-serif'; g2.fillStyle = 'rgba(240,236,228,0.6)';
        g2.fillText(`photon ${Math.min(cur + (frac > 0.6 ? 1 : 0), S)} of ${S + 1} · binding ${K.fmtEV(L.eV)}`, c.w - 22, c.h - 38);
        if (s.v.field && L.n > 1) g2.fillText(`orbital moment −${L.m} μB · B at nucleus ≈ ${(12.52 * (L.n - 1) / Math.pow(L.n, 6)).toPrecision(2)} T`, c.w - 22, c.h - 56);
        if (s.lim) { g2.textAlign = 'left'; g2.fillStyle = 'rgba(255,200,150,0.85)'; g2.fillText(s.lim, wl + 10, 22); }
      });
      // limits, a few times per second
      if (L.n > 1 && c.tau - s.limT > 0.3) { s.limT = c.tau; const lm = K.limitsAt(s.sp.id, L.n, L.l, { T: s.sp.id === 'X' ? 1.3 : 300, climbS: K.climbTime(s.steps.slice(0, cur)) }); s.lim = L.n >= 20 ? K.worstLimit(lm) : ''; }
      // plate: at milestones (laser steps done, n = 10, 50, 100, 200, 300, ionization)
      const ms = pace.ion > 0 ? 99 : [1, 2, 3, 4, 5, 10, 50, 100, 200, 300].filter(x => L.n >= x).length;
      if (ms !== s.milestone) { s.milestone = ms; c.replate({ cur, limit: s.lim, ion: pace.ion > 0 }); }
      return view;
    },
  };
}
function scaledLines(s, n) {
  if (s.lnN === n) return s.lnC;
  const f = Ph.meanR(n, n - 1) / Ph.meanR(s.ref, s.ref - 1);
  s.lnC = s.refLines.map(L => { const o = new Float32Array(L.length); for (let i = 0; i < L.length; i++) o[i] = L[i] * f; o.mag = L.mag; return o; });
  s.lnN = n; return s.lnC;
}
// a real object drawn to scale beside the atom: the largest that fits
function drawRefs(g, c, cx, cy, scale, aM, ext) {
  // the real object closest in size to the atom that fits beside it
  const pxPerM = scale / aM, room = Math.min(c.h * 0.7, (c.w - cx - ext * scale) * 0.8), atom = 2 * ext / 1.2 * aM;
  const fits = K.SCALES.filter(s => s.m * pxPerM > 14 && s.m * pxPerM < room && s.id !== 'muh' && s.id !== 'proton');
  if (!fits.length) return;
  const r = fits.reduce((a, b) => Math.abs(Math.log(b.m / atom)) < Math.abs(Math.log(a.m / atom)) ? b : a), d = r.m * pxPerM, x = Math.min(c.w - d / 2 - 20, cx + ext * scale + 30 + d / 2), y = cy;
  c.over(g2 => {
    g2.strokeStyle = 'rgba(160,200,255,0.55)'; g2.lineWidth = 1.5; g2.setLineDash([]);
    if (r.id === 'bacterium') { g2.beginPath(); g2.ellipse(x, y, d / 2, d / 5, 0.4, 0, 2 * Math.PI); g2.stroke(); }
    else if (r.id === 'rbc') { g2.beginPath(); g2.ellipse(x, y, d / 2, d / 2, 0, 0, 2 * Math.PI); g2.stroke(); g2.beginPath(); g2.ellipse(x, y, d / 4.5, d / 4.5, 0, 0, 2 * Math.PI); g2.stroke(); }
    else if (r.id === 'virus') { g2.beginPath(); g2.arc(x, y, d / 2, 0, 2 * Math.PI); g2.stroke(); for (let k = 0; k < 16; k++) { const a = k / 16 * 2 * Math.PI; g2.beginPath(); g2.moveTo(x + Math.cos(a) * d / 2, y + Math.sin(a) * d / 2); g2.lineTo(x + Math.cos(a) * d * 0.6, y + Math.sin(a) * d * 0.6); g2.stroke(); } }
    else { g2.beginPath(); g2.arc(x, y, d / 2, 0, 2 * Math.PI); g2.stroke(); }
    g2.fillStyle = 'rgba(160,200,255,0.75)'; g2.font = '12px Inter, system-ui, sans-serif'; g2.textAlign = 'center';
    g2.fillText(`${r.name}, ${K.fmtLen(r.m)}`, x, y + d / 2 + 16);
  });
}

// ---------------------------------------------------------------- others
const SHOTS = {
  swell: {
    setup: R => ({ circ: R() < 0.6, top: 120 + Math.floor(R() * 81), yaw: R() * 6, lscale: null, lv: 0, cache: new Map(), last: -1 }),
    plate: s => ({ title: 'From n = 1 to n = ' + s.top, sub: s.circ ? 'circular states |nC⟩, l = m = n − 1' : 'states with l = 1', tex: ['\\langle r\\rangle = \\tfrac12\\left(3n^2-\\ell(\\ell+1)\\right)a_0'], lines: [`At n = ${s.top}: ${K.fmtLen(2 * Ph.meanR(s.top, s.circ ? s.top - 1 : 1) * Ph.C.a0)} across, ${K.scaleLabel(2 * Ph.meanR(s.top, s.circ ? s.top - 1 : 1) * Ph.C.a0)}`, 'Each cloud sampled from the exact hydrogen wave function'] }),
    draw: c => {
      const s = c.st, n = Math.max(1, Math.round(Math.exp(Math.log(s.top) * smooth(c.k / 0.9)))), l = s.circ ? n - 1 : Math.min(1, n - 1);
      if (s.n !== n && (c.tau - s.last > 0.12 || !s.cl)) { s.n = n; s.last = c.tau; s.cl = St.sampleNLM(n, l, s.circ ? l : 0, c.N, 5 + n); }
      const ext = Ph.meanR(n, l) * 1.2 + 2, target = Math.log(Math.min(c.w * 0.75, c.h) * 0.4 / ext);
      if (s.lscale == null) s.lscale = target;
      s.lv += (9 * (target - s.lscale) - 6 * s.lv) * c.dt; s.lscale += s.lv * c.dt;
      const scale = Math.exp(s.lscale), cx = c.w * 0.42;
      c.cloud(s.cl, { yaw: s.yaw + c.tau * 0.15, pitch: 1.0, scale, cx, cy: c.h / 2, m: l });
      drawRefs(c.g, c, cx, c.h / 2, scale, Ph.C.a0, ext);
      c.over(g => { g.fillStyle = 'rgba(240,236,228,0.85)'; g.font = '500 15px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`n = ${s.n} · ${K.fmtLen(2 * Ph.meanR(s.n, l) * Ph.C.a0)}`, c.w - 22, c.h - 18); });
    },
  },
  trilobite: {
    setup: R => { const n = 24 + Math.floor(R() * 14); const Rw = St.outerWell(n); return { n, R: Rw, kind: R() < 0.75 ? 'trilobite' : 'butterfly', yaw: (R() - 0.5) * 0.3 }; },
    plate: s => ({ title: s.kind === 'trilobite' ? 'A trilobite molecule forms' : 'A butterfly molecule forms', sub: `a ground-state Rb atom settles in the n = ${s.n} Rydberg orbit`, tex: ['U(R) = 2\\pi a_s \\sum_{\\ell\\ge 3}\\frac{2\\ell+1}{4\\pi}\\,R_{n\\ell}(R)^2'], lines: [`Bond length ${K.fmtLen(s.R * Ph.C.a0)} (${Math.round(s.R)} a₀)`, 'Greene, Dickinson & Sadeghpour 2000 · seen in 2009 and 2015', 'Brightness ∝ |ψ|; a cut through the axis'] }),
    draw: c => {
      const s = c.st;
      if (!s.AB) {
        // the bare Rydberg atom (l = 3, m = 0) and the molecule in one
        // cloud; weights cross-fade from the first half to the second
        const N = c.N * 2, tri = St.trilobite(s.n, s.R, { kind: s.kind }), B = tri.sample(N, 3, 0.5), A = St.sampleNLM(s.n, 3, 0, N, 4);
        s.AB = { pts: new Float32Array(N * 8), dens: new Float32Array(N * 2), weights: new Float32Array(N * 2) };
        s.AB.pts.set(A.pts); s.AB.pts.set(B.pts, N * 4); s.AB.dens.set(A.dens); s.AB.dens.set(B.dens, N); s.Nh = N;
      }
      const k = smooth((c.k - 0.3) / 0.45), zc = s.R * 0.42, ext = s.R * 0.9;
      for (let i = 0; i < s.Nh; i++) { s.AB.weights[i] = 1 - k; s.AB.weights[s.Nh + i] = k; }
      const scale = Math.min(c.w, c.h) * 0.44 / ext * (1 + 0.08 * c.k), pitch = 0.04;
      const cy = c.h / 2 + zc * scale * Math.cos(pitch);
      c.cloud(s.AB, { yaw: s.yaw, pitch, scale, cx: c.w / 2, cy, cut: { mode: 2, axis: 1, pos: 0, ext } });
      // the perturber coming in along z
      const zp = s.R + (2.2 * s.n * s.n - s.R) * (1 - smooth(c.k / 0.4));
      c.over(g => { const p = proj({ yaw: s.yaw, pitch, scale, cx: c.w / 2, cy }, null, 0, 0, zp); g.fillStyle = 'rgba(160,220,255,0.95)'; g.beginPath(); g.arc(p[0], p[1], 5, 0, 2 * Math.PI); g.fill(); g.font = '12px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.fillText('ground-state atom', p[0] + 10, p[1] + 4); });
    },
  },
  bloom: {
    setup: R => { const n = 6 + Math.floor(R() * 30); return { n, yaw: R() * 6, pitch: 0.25 + R() * 0.3, spin: R() < 0.4 }; },
    plate: s => ({ title: 'The magnetic field of a circular orbit', sub: `|${s.n}C⟩: the current of the electron cloud, by Biot–Savart`, tex: ['\\mathbf j = \\frac{\\hbar m}{m_e\\rho}|\\psi|^2\\hat{\\boldsymbol\\varphi},\\qquad \\mu_z = -m\\,\\mu_B'], lines: [`μ = −${s.n - 1} μB · |B| at the nucleus ≈ ${(12.52 * (s.n - 1) / Math.pow(s.n, 6)).toPrecision(2)} T`, 'Exact loop fields (elliptic integrals) summed over the cloud'] }),
    draw: c => {
      const s = c.st;
      if (!s.cl) { s.cl = St.sampleNLM(s.n, s.n - 1, s.n - 1, c.N, 3); const E = s.cl.ext * 1.3; s.F = Bf.solveAxisym(St.densityNLM(s.n, s.n - 1, s.n - 1), { g: -1, spin: s.spin ? -0.5006 : 0, ext: E, ns: 44, nt: 36, symmetric: true }); s.L = Bf.fieldLines(s.F, { lines: 9 }); s.E = E; }
      const scale = Math.min(c.w, c.h) * 0.42 / s.E;
      c.cloud(s.cl, { yaw: s.yaw + c.tau * 0.1, pitch: s.pitch, scale, cx: c.w / 2, cy: c.h / 2, m: s.n - 1, field: s.F, lines: s.L, reveal: smooth(c.k / 0.6), showMag: c.k > 0.35, magAlpha: 0.45 * smooth((c.k - 0.35) / 0.3), linePhase: c.tau * 0.1 });
    },
  },
  packet: {
    setup: R => { const n = 18 + Math.floor(R() * 20); return { n, sig: 1.4 + R() * 1.2, yaw: R() * 6, pitch: 0.75 + R() * 0.35 }; },
    plate: s => ({ title: 'A wave packet orbits, spreads and revives', sub: `circular states near n = ${s.n}, Gaussian weights (σ = ${s.sig.toFixed(1)})`, tex: ['\\Psi(t) = \\sum_n c_n\\,\\psi_n\\,e^{-iE_nt/\\hbar},\\qquad T_{\\mathrm{rev}} = \\tfrac{2n}{3}T_K'], lines: [`Kepler period ${K.fmtTime(2 * Math.PI * s.n ** 3 * Ph.C.tAU)}, revival after ${(2 * s.n / 3).toFixed(1)} orbits`, 'Shown about 10¹¹ times slower'] }),
    draw: c => {
      const s = c.st;
      if (!s.pk) s.pk = St.packet('circular', s.n, s.sig, c.N, 5);
      const turns = (2 * s.n / 3) * 1.05, t = turns * s.pk.TK * Math.pow(c.k, 1.25);
      s.pk.update(t);
      c.cloud({ pts: s.pk.pts, dens: s.pk.dens, weights: s.pk.w }, { yaw: s.yaw, pitch: s.pitch, scale: Math.min(c.w, c.h) * 0.44 / s.pk.ext, cx: c.w / 2, cy: c.h / 2, m: 1, cycles: 1 });
      c.over(g => { g.fillStyle = 'rgba(240,236,228,0.8)'; g.font = '500 14px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`t = ${(t / s.pk.TK).toFixed(1)} orbits`, c.w - 22, c.h - 18); });
    },
  },
  scale: {
    setup: R => ({ n: 2 + Math.floor(R() * 3), yaw: R() * 6 }),
    plate: s => ({ title: 'Same orbit, three masses', sub: `|${s.n}C⟩ of positronium, hydrogen and muonic hydrogen at one scale`, tex: ['a = a_0\\,\\frac{m_e}{\\mu},\\qquad \\mu_{\\mathrm{Ps}} = \\tfrac12 m_e,\\quad \\mu_{\\mu p} = 185.8\\,m_e'], lines: ['Positronium is twice hydrogen; muonic hydrogen is 186 times smaller', 'The camera zooms in 400 times'] }),
    draw: c => {
      const s = c.st;
      if (!s.cl) s.cl = St.sampleNLM(s.n, s.n - 1, s.n - 1, c.N, 3);
      const sp = ['Ps', 'H', 'muH'], ext0 = Ph.meanR(s.n, s.n - 1) * 1.3 * 2;     // Ps in H units
      const zoom = Math.exp(Math.log(400) * smooth((c.k - 0.3) / 0.6));
      const pw = c.w / 3;
      sp.forEach((id, i) => {
        const u = Ph.units(id), f = u.a / Ph.units('H').a, scale = Math.min(pw, c.h) * 0.42 / ext0 * zoom * f;
        c.cloud(s.cl, { yaw: s.yaw + c.tau * 0.15, pitch: 1.0, scale, cx: pw / 2, cy: c.h / 2, m: s.n - 1, pane: [i * pw, pw] });
      });
      c.over(g => { g.fillStyle = 'rgba(240,236,228,0.85)'; g.font = '500 14px Inter, system-ui, sans-serif'; g.textAlign = 'center'; sp.forEach((id, i) => g.fillText(`${Ph.SPECIES[id].name} · ${K.fmtLen(2 * Ph.meanR(s.n, s.n - 1) * Ph.units(id).a)}`, pw * (i + 0.5), c.h - 18)); });
    },
  },
  squeeze: {
    setup: R => ({ logs: [2, 3, 4, 5, 6, 7, 8], yaw: R() * 6 }),
    plate: s => ({ title: 'Hydrogen in a white-dwarf field', sub: 'the ground state from 10² T to 10⁸ T: the cloud becomes a needle', tex: ['H = -\\tfrac12\\nabla^2 - \\frac1r + \\frac{\\beta^2}{8}\\rho^2 + \\frac{\\beta}{2}(L_z+2S_z)'], lines: ['Variational state, 0.1-2.5 % from the exact energies (Kravchenko 1996)', 'Magnetic white dwarfs: 10²-10⁵ T · neutron stars: 10⁸ T'] }),
    draw: c => {
      const s = c.st;
      if (!s.cl) s.cl = s.logs.map(L => { const st = Ph.strongB(Math.pow(10, L) / Ph.C.B0); return { st, c: St.pairByAzimuth(St.strongBState(st, c.N, 2)) }; });
      const x = smooth(c.k / 0.92) * (s.logs.length - 1), i = Math.min(s.logs.length - 2, Math.floor(x)), f = x - i;
      const A = s.cl[i], B = s.cl[i + 1], zr = A.st.zRms * (1 - smooth(f)) + B.st.zRms * smooth(f), scale = Math.min(c.w, c.h) * 0.42 / (2.9 * zr);
      c.cloud(A.c, { yaw: s.yaw + c.tau * 0.1, pitch: 0.12, scale, cx: c.w / 2, cy: c.h / 2, mix: { pts2: B.c.pts, k: smooth(f) } });
      const logB = s.logs[i] + f, st = f < 0.5 ? A.st : B.st;
      c.over(g => { g.fillStyle = 'rgba(240,236,228,0.85)'; g.font = '500 15px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(`B = 10^${logB.toFixed(1)} T · binding ${K.fmtEV(st.binding * Ph.C.hartreeEV)} · ${st.aspect.toFixed(1)}× longer than wide`, c.w - 22, c.h - 18);
        g.strokeStyle = '#9fd0ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(c.w * 0.82, c.h * 0.75); g.lineTo(c.w * 0.82, c.h * 0.25); g.stroke(); g.fillStyle = '#9fd0ff'; g.beginPath(); g.moveTo(c.w * 0.82, c.h * 0.22); g.lineTo(c.w * 0.82 - 6, c.h * 0.26); g.lineTo(c.w * 0.82 + 6, c.h * 0.26); g.fill(); g.textAlign = 'left'; g.font = '13px Inter, system-ui, sans-serif'; g.fillText('B', c.w * 0.82 + 10, c.h * 0.24); });
    },
  },
};
for (const id of Object.keys(K.CLIMBS)) SHOTS['climb:' + id] = climbShot(id);
export { SHOTS };

// ---------------------------------------------------------------- frame
let run = null;
window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const calm = clamp(o.calm == null ? 0.6 : +o.calm, 0, 1);
    const seed = (o.seed >>> 0) || ((Math.random() * 1e9) >>> 0);
    const plan = shotPlan(seed, 60, calm);
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none;visibility:visible!important}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__eaSaver = true;
    const phone = matchMedia('(max-width: 860px)').matches;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const scenes = [makeScene(mk), makeScene(mk), makeScene(mk)];
    const lut = CM.variant('magma', {}), flut = CM.variant('mako', {});
    run = { plan, css, cv, raf: 0, i: 0, tau: 0, last: 0, plated: -1, st: null, N: phone ? 9000 : 18000 };
    const g = cv.getContext('2d');
    const begin = () => {
      const shot = plan[run.i % plan.length], R = rng(shot.seed >>> 0 || 1);
      try { run.st = SHOTS[shot.id].setup(R); } catch (e) { run.st = null; }
    };
    begin();
    const frame = now => {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      let shot = plan[run.i % plan.length];
      run.tau += dt * (1 - 0.25 * calm);
      if (run.tau >= shot.sec || !run.st) { run.tau = 0; run.i++; shot = plan[run.i % plan.length]; begin(); }
      const Sh = SHOTS[shot.id], k = run.tau / shot.sec;
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const top = band ? band.t : 0, bot = band ? band.b : 0, bh = Math.max(160, h - top - bot);
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#050509'; g.fillRect(0, 0, cv.width, cv.height);
      let sn = 0;
      const overs = [];
      const ctx = {
        g, w, h: bh, k, tau: run.tau, dt, st: run.st, N: run.N,
        cloud: (cl, v) => {
          const pane = v.pane || [0, w];
          return scenes[sn++ % 3].draw(g, { x: pane[0], y: top, w: pane[1], h: bh, dpr, budget: (phone ? 5e5 : 9e5) / (v.pane ? 2 : 1), cloud: cl,
            yaw: v.yaw, pitch: v.pitch, scale: v.scale, cx: v.cx, cy: v.cy, lut, flut, colour: 'density', m: v.m || 0, cycles: v.cycles, exposure: v.exposure || 1, cut: v.cut || null,
            field: v.field || null, lines: v.lines || null, showLines: !!v.lines, showMag: !!v.showMag, magAlpha: v.magAlpha, reveal: v.reveal, linePhase: v.linePhase, nucleus: true, mix: v.mix || null });
        },
        over: f => overs.push(f),
        replate: extra => { if (typeof o.label === 'function') { try { o.label(Object.assign({}, Sh.plate(run.st, extra), { anchor: () => ({ x: w / 2, y: top + bh / 2, r: Math.min(w, bh) * 0.4 }) })); } catch (e) { /* the plate is optional */ } } },
      };
      try { Sh.draw(ctx); } catch (e) { /* a bad frame is skipped */ }
      g.save(); g.setTransform(dpr, 0, 0, dpr, 0, top * dpr);
      for (const f of overs) { try { f(g); } catch (e) { /* skip */ } }
      g.restore();
      const fade = smooth(Math.min(run.tau, shot.sec - run.tau) / (0.45 + 0.5 * calm));
      if (fade < 1) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = `rgba(5,5,9,${1 - fade})`; g.fillRect(0, 0, cv.width, cv.height); }
      if (run.plated !== run.i) { run.plated = run.i; ctx.replate({ cur: 0 }); }
      run.raf = requestAnimationFrame(frame);
    };
    run.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 600 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    run.cv.remove(); run.css.remove();
    run = null; window.__eaSaver = false;
  },
};
window.snSaver.debug = () => run ? { i: run.i, id: run.plan[run.i % run.plan.length].id, tau: run.tau, sec: run.plan[run.i % run.plan.length].sec } : null;
