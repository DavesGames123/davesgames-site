// ============================================================================
//  PARTICLE COLLIDER  ·  accplots.js — the accelerator stations: text and plots
// ----------------------------------------------------------------------------
//  Ten stations follow the beam from the ion source to the dump. Each has
//  a title, a lede, its relations, a numbers table and one or two live
//  plots, all computed from accel.js each frame. createAccel() holds the
//  live state (the ramp clock, the tracked linac and RF particles, the
//  tune and chromaticity settings) and draws the plots of one station.
//
//  PLOTS  (2D canvas, recessive grid, 2 px lines, series colours from the
//  dataviz reference palette, checked on the #0b0e17 panel surface:
//  blue #3987e5, orange #d95926, aqua #199e70, yellow #c98500)
//    source  RF wave with the bunch on it; longitudinal phase space
//    chain   beam momentum per machine (log scale), B rho and dipole B
//    dipole  B = p / (e c rho) for each ring, the ramp point
//    fodo    beta_x, beta_y over 3 cells, D below; the x-x' ellipse
//    tune    the tune diagram, resonance lines to 5th order, the working
//            point and the chromatic footprint; the 1/3 resonance (Henon)
//    rf      the RF bucket: separatrix and tracked particles
//    ramp    momentum over the cycle; gain per turn below
//    ip      the two bunches crossing at angle; luminosity against beta*
//    sr      U0 against E for protons (this ring) and electrons (LEP)
//    dump    the dilution sweep painting the dump block
//
//  GREP MAP  export const STATIONS · function createAccel · function axes
// ============================================================================
import * as A from './accel.js';

export const SER = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const INK = '#d7dbe6', MUTED = '#8a90a6', GRID = 'rgba(150,160,190,0.13)';
const f3 = v => v.toPrecision(3), fx = (v, n = 2) => v.toFixed(n);
const sci = v => { const e = Math.floor(Math.log10(Math.abs(v))); return `${(v / 10 ** e).toFixed(2)}×10${String(e).replace(/-/g, '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`; };

export const STATIONS = [
  { id: 'source', name: 'Source and linac', kind: 'H⁻ ions · 352 MHz drift-tube cells', lede: 'Ions leave the source at 45 keV. In each drift-tube cell the RF field points forward only while the bunch is in the gap. The bunch rides 30° before the crest: a late particle meets a higher field and catches up, an early one meets less and falls back. That is phase stability.',
    eqs: [['Energy gain per cell', 'ΔW = q E₀T L cos φs', 'L = βλ: the cell grows with the speed'], ['Phase focusing', 'k_l² = 2π q E₀T sin(−φs) / (mc² β³γ³ λ)', 'stable only for φs < 0 (before the crest)']] },
  { id: 'chain', name: 'Injector chain', kind: 'Linac4 → Booster → PS → SPS → collider', lede: 'No single machine can take protons from rest to TeV. Each ring accepts the beam at its injection field and hands it on at its top field, a factor of 10 to 20 in momentum each time.',
    eqs: [['Magnetic rigidity', 'Bρ = p / e = p[GeV/c] / 0.2998  T·m', 'the field a ring needs at radius ρ'], ['Revolution frequency', 'f = βc / C', 'the RF must stay a whole multiple h of f']] },
  { id: 'dipole', name: 'Arc dipoles', kind: '1232 superconducting dipoles, 1.9 K', lede: 'Each 14.3 m dipole bends the beam by 5.1 mrad. Two apertures 194 mm apart sit in one cryostat, with opposite fields, so the two beams turn the same way while they run in opposite directions.',
    eqs: [['Bending', 'B = p / (e ρ)', 'ρ = 2804 m for the collider dipoles'], ['Angle per dipole', 'θ = 2π / 1232 = 5.10 mrad', '']] },
  { id: 'fodo', name: 'FODO cells', kind: 'Focusing · drift · defocusing · drift', lede: 'A quadrupole focuses in one plane and defocuses in the other. Alternate them and the net effect focuses in both. The beam size breathes from cell to cell: wide in x at each focusing quadrupole, wide in y at each defocusing one.',
    eqs: [['Phase advance', 'cos μ = ½ Tr M', 'μ = 90° in the collider arcs'], ['Beta function', 'β± = Lc (1 ± sin μ/2) / sin μ', 'σ = √(ε β)'], ['Dispersion', 'D± = L θ (1 ± ½ sin μ/2) / sin²(μ/2)', 'x = D δ for a momentum error δ']] },
  { id: 'tune', name: 'Tune and sextupoles', kind: 'Betatron tune · chromaticity', lede: 'The tune Q counts betatron oscillations per turn. A tune near a fraction m/n lets a small kick add up turn after turn (a resonance). Particles with more momentum focus less: the natural chromaticity is strongly negative. Sextupoles where the dispersion is large give back the focusing.',
    eqs: [['Resonances', 'm Qx + n Qy = p', 'avoid low orders |m| + |n|'], ['Chromaticity', "ΔQ = Q' δ,  ξ_cell = −tan(μ/2) / π", ''], ['Sextupole correction', "ΔQ'x = (1/4π) Σ k₂L D βx", 'and minus with βy']] },
  { id: 'rf', name: 'RF and bunching', kind: '400 MHz superconducting cavities', lede: 'Above transition a faster particle takes a longer orbit and arrives late. The RF voltage is set so the late particle gets less energy: each particle circles the synchronous phase in the RF bucket. The bucket keeps the 25 ns bunches apart.',
    eqs: [['Slip factor', 'η = α_c − 1/γ²', 'positive: above transition'], ['Synchrotron tune', 'Qs = √(h eV |η cos φs| / (2π β² E))', ''], ['Bucket height', 'δmax = √(2eV / (π β² E h |η|))', 'stationary bucket']] },
  { id: 'ramp', name: 'The energy ramp', kind: '450 GeV → 6.8 TeV in 20 minutes', lede: 'At injection the dipoles run at 0.54 T. During the ramp the current rises and the field follows the momentum exactly; the RF gives each proton about half an MeV per turn, at 11 245 turns per second.',
    eqs: [['Field follows momentum', 'B(t) = p(t) / (e ρ)', ''], ['Energy per turn', 'ΔE = (dp/dt) c C / (βc) = eV sin φs', '']] },
  { id: 'ip', name: 'Collisions', kind: 'Interaction point · luminosity', lede: 'Final-focus triplets squeeze the beams to a few microns. The bunches cross at an angle so that they meet only once, at the centre of the detector. Luminosity counts the collisions per area per second; times the cross section, it gives the rate.',
    eqs: [['Luminosity', 'L = f n_b N₁N₂ / (4π σx σy) · F', 'F = 1/√(1 + (θc σz / 2σ)²)'], ['Beam size', 'σ* = √(ε_n β* / γ)', ''], ['Pile-up', 'μ = L σ_inel / (n_b f)', 'collisions per crossing']] },
  { id: 'sr', name: 'Synchrotron radiation', kind: 'Energy loss per turn', lede: 'Any charge on a curved path radiates. The loss per turn grows as E⁴ and falls as the fourth power of the mass: a 7 TeV proton loses 7 keV per turn, a 100 GeV electron in the same tunnel lost 3.5 GeV.',
    eqs: [['Loss per turn', 'U₀ = C_γ E⁴ / ρ', 'C_γ = 8.85×10⁻⁵ m/GeV³ (e), ÷ (m_p/m_e)⁴ for p'], ['Critical energy', 'E_c = (3/2) ħc γ³ / ρ', '']] },
  { id: 'dump', name: 'Beam dump', kind: 'Extraction in one turn', lede: 'At the end of a fill, or on any fault, fast kickers fire in the 3 μs abort gap and steer the whole beam out in one turn. Dilution kickers sweep it into an "e" on a graphite block so that no spot melts.',
    eqs: [['Stored energy', 'W = n_b N E', '362 MJ per beam at design'], ['Time to empty', 'one turn: C / c = 89 μs', '']] },
];

export function createAccel() {
  const S = {
    preset: 'design', t: A.CYCLE.inj * 0.6, rampRate: 60, Qp: 2, qH: 0.31, k2: 1.0, sel: 'source',
    linac: null, rfPts: null, henon: [], footprint: null,
  };
  const lin = A.linacParams(50);
  const resetLinac = () => { S.linac = []; for (let i = 0; i < 90; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()); S.linac.push([0.35 * r * Math.cos(a), 0.12 * r * Math.sin(a)]); } };
  const resetRF = () => {
    const R = rfNow(); S.rfPts = [];
    for (let i = 0; i < 260; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()); S.rfPts.push([R.phis + 1.2 * r * Math.cos(a), R.dmax0 * 0.55 * r * Math.sin(a)]); }
  };
  const rfNow = () => { const r = A.ramp(S.t), dE = A.rampRate(S.t) * 1e3 * A.LHC.C / A.CLIGHT; return A.rfParams(Math.hypot(r.p, A.MP), r.phase === 'ramp' ? 12 : r.p > 1000 ? 16 : 8, Math.max(0, dE)); };
  resetLinac(); resetRF();
  const cell = A.fodo();

  function tick(dt) {
    S.t = (S.t + dt * S.rampRate) % A.ramp(0).T;
    if (S.linac) { A.linacTrack(lin, S.linac, 1); }
    if (S.rfPts) A.rfMap(rfNow(), S.rfPts, 3);
  }

  // ── drawing helpers ──
  function axes(g, b, xr, yr, o = {}) {
    const d = b.d, X = v => b.x + (o.logx ? Math.log10(v / xr[0]) / Math.log10(xr[1] / xr[0]) : (v - xr[0]) / (xr[1] - xr[0])) * b.w;
    const Y = v => b.y + b.h - (o.logy ? Math.log10(v / yr[0]) / Math.log10(yr[1] / yr[0]) : (v - yr[0]) / (yr[1] - yr[0])) * b.h;
    g.strokeStyle = GRID; g.lineWidth = d;
    g.font = `${9.5 * d}px "IBM Plex Mono", ui-monospace, Menlo, monospace`; g.fillStyle = MUTED;
    for (const v of o.xt || []) { const x = X(v); g.beginPath(); g.moveTo(x, b.y); g.lineTo(x, b.y + b.h); g.stroke(); g.textAlign = 'center'; g.fillText(o.xf ? o.xf(v) : String(v), x, b.y + b.h + 11 * d); }
    for (const v of o.yt || []) { const y = Y(v); g.beginPath(); g.moveTo(b.x, y); g.lineTo(b.x + b.w, y); g.stroke(); g.textAlign = 'right'; g.fillText(o.yf ? o.yf(v) : String(v), b.x - 4 * d, y + 3 * d); }
    g.textAlign = 'left';
    if (o.xl) { g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText(o.xl, b.x + b.w, b.y - 4 * d); g.textAlign = 'left'; }
    if (o.yl) { g.fillStyle = MUTED; g.fillText(o.yl, b.x, b.y - 4 * d); }
    return { X, Y };
  }
  const poly = (g, pts, X, Y, col, w, d, dash) => { g.strokeStyle = col; g.lineWidth = w * d; g.setLineDash(dash ? dash.map(v => v * d) : []); g.beginPath(); let on = false; for (const [x, y] of pts) { if (!(y === y) || !isFinite(y)) { on = false; continue; } const px = X(x), py = Y(y); on ? g.lineTo(px, py) : g.moveTo(px, py); on = true; } g.stroke(); g.setLineDash([]); };
  const dot = (g, x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };
  const legend = (g, items, x, y, d) => { g.font = `${9.5 * d}px "IBM Plex Mono", ui-monospace, Menlo, monospace`; let cx = x; for (const [t, c] of items) { g.fillStyle = c; g.fillRect(cx, y - 7 * d, 10 * d, 2.5 * d); g.fillStyle = INK; g.fillText(t, cx + 14 * d, y - 3 * d); cx += (g.measureText(t).width + 26 * d); } };
  const box = (w, h, d, pad = [34, 14, 22, 22]) => ({ x: pad[0] * d, y: pad[3] * d, w: w - (pad[0] + pad[1]) * d, h: h - (pad[2] + pad[3]) * d, d });

  const PLOTS = {
    source: [
      (g, w, h, d) => {
        const b = box(w, h, d), { X, Y } = axes(g, b, [-180, 180], [-1.1, 1.1], { xt: [-180, -90, 0, 90, 180], yt: [-1, 0, 1], xf: v => v + '°', xl: 'RF phase', yl: 'field in the gap, E/E₀' });
        const pts = []; for (let p = -180; p <= 180; p += 2) pts.push([p, Math.cos(p * Math.PI / 180)]); poly(g, pts, X, Y, SER[0], 2, d);
        const ps = lin.phis * 180 / Math.PI;
        g.strokeStyle = SER[3]; g.setLineDash([3 * d, 3 * d]); g.beginPath(); g.moveTo(X(ps), b.y); g.lineTo(X(ps), b.y + b.h); g.stroke(); g.setLineDash([]);
        for (const q of S.linac) { const p = ps + q[0] * 180 / Math.PI; dot(g, X(p), Y(Math.cos(p * Math.PI / 180)), 2.2 * d, SER[1]); }
        legend(g, [['RF wave', SER[0]], ['bunch', SER[1]], ['φs = −30°', SER[3]]], b.x + 6 * d, b.y + 12 * d, d);
      },
      (g, w, h, d) => {
        const b = box(w, h, d), { X, Y } = axes(g, b, [-60, 60], [-0.3, 0.3], { xt: [-60, -30, 0, 30, 60], yt: [-0.2, 0, 0.2], xf: v => v + '°', xl: 'Δφ', yl: 'ΔW (MeV)' });
        for (const q of S.linac) dot(g, X(q[0] * 180 / Math.PI), Y(q[1]), 2 * d, SER[1]);
      },
    ],
    chain: [
      (g, w, h, d) => {
        const T = A.chainTable(), b = box(w, h, d, [92, 14, 18, 18]), { X } = axes(g, b, [1e-5, 1e4], [0, 1], { logx: true, xt: [1e-4, 1e-2, 1, 100, 1e4], xf: v => v >= 1 ? `${v} GeV` : `${v * 1e3} MeV`, xl: 'momentum p (log)' });
        T.forEach((s, i) => {
          const y = b.y + (i + 0.5) * b.h / T.length, bh = b.h / T.length * 0.55;
          g.fillStyle = SER[0]; g.fillRect(b.x, y - bh / 2, X(s.pGeV) - b.x, bh);
          g.fillStyle = INK; g.textAlign = 'right'; g.fillText(s.name.replace('Super Proton Synchrotron', 'SPS').replace('Proton Synchrotron', 'PS'), b.x - 6 * d, y + 3 * d); g.textAlign = 'left';
          g.fillStyle = MUTED; g.fillText(s.B ? `B ${s.B.toFixed(2)} T` : s.id === 'linac' ? '160 MeV' : '45 keV', X(s.pGeV) + 5 * d, y + 3 * d);
        });
      },
    ],
    dipole: [
      (g, w, h, d) => {
        const b = box(w, h, d), { X, Y } = axes(g, b, [0, 7000], [0, 9], { xt: [0, 2000, 4000, 6000], yt: [0, 3, 6, 9], xf: v => `${v / 1000} TeV`, xl: 'p', yl: 'B (T)' });
        const rings = [['collider ρ 2804 m', A.LHC.rho, SER[0]], ['SPS ρ 741 m', 741.3, SER[1]], ['PS ρ 70 m', 70.08, SER[2]]];
        for (const [, rho, col] of rings) { const pts = []; for (let p = 0; p <= 7000; p += 50) pts.push([p, A.brho(p / 1000 * 1000) / rho]); poly(g, pts, X, Y, col, 2, d); }
        g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
        const r = A.ramp(S.t); dot(g, X(r.p), Y(r.B), 4.5 * d, '#fff'); g.restore();
        legend(g, rings.map(([t, , c]) => [t, c]), b.x + 6 * d, b.y + 12 * d, d);
      },
    ],
    fodo: [
      (g, w, h, d) => {
        const b = box(w, h * 0.66, d), { X, Y } = axes(g, b, [0, 3 * cell.Lc], [0, 200], { xt: [0, 107, 214, 321], yt: [0, 100, 200], xf: v => v + ' m', yl: 'β (m)' });
        const P = pl => { const out = []; for (let c = 0; c < 3; c++) for (const p of pl.pts) out.push([c * cell.Lc + p[0] * 2, p[1]]); return out; };
        // pts hold half a cell from QF to QD and on: the s of each point is p[0] (0..L) for half 1, then L..2L
        const sx = [], sy = []; for (let c = 0; c < 3; c++) { cell.X.pts.forEach((p, i) => sx.push([c * cell.Lc + i / (cell.X.pts.length - 1) * cell.Lc, p[1]])); cell.Y.pts.forEach((p, i) => sy.push([c * cell.Lc + i / (cell.Y.pts.length - 1) * cell.Lc, p[1]])); }
        void P;
        for (let c = 0; c <= 3; c++) { g.fillStyle = 'rgba(232,69,60,0.5)'; g.fillRect(X(c * cell.Lc) - 2 * d, b.y + b.h - 6 * d, 4 * d, 6 * d); if (c < 3) { g.fillStyle = 'rgba(242,179,61,0.6)'; g.fillRect(X(c * cell.Lc + cell.L) - 2 * d, b.y + b.h - 6 * d, 4 * d, 6 * d); } }
        poly(g, sx, X, Y, SER[0], 2, d); poly(g, sy, X, Y, SER[1], 2, d);
        legend(g, [['βx', SER[0]], ['βy', SER[1]], ['QF', '#e8453c'], ['QD', '#f2b33d']], b.x + 6 * d, b.y + 12 * d, d);
        const b2 = { x: b.x, y: h * 0.70, w: b.w, h: h * 0.22, d }, A2 = axes(g, b2, [0, 3 * cell.Lc], [0, 2.5], { yt: [0, 2], yl: 'D (m)' });
        const Dp = []; for (let c = 0; c < 3; c++) cell.Dpts.forEach((p, i) => Dp.push([c * cell.Lc + i / (cell.Dpts.length - 1) * cell.Lc, p[1]]));
        poly(g, Dp, A2.X, A2.Y, SER[2], 2, d);
      },
      (g, w, h, d) => {
        const b = box(w, h, d), bm = cell.betaMax, eps = 1, lim = Math.sqrt(2.2 * eps * bm), { X, Y } = axes(g, b, [-lim, lim], [-lim / bm * 1.2, lim / bm * 1.2], { xt: [0], yt: [0], xl: 'x at the focusing quadrupole', yl: "x'" });
        g.strokeStyle = 'rgba(57,135,229,0.35)'; g.lineWidth = d;
        for (const J of [0.25, 0.5, 0.75, 1]) { g.beginPath(); for (let k = 0; k <= 64; k++) { const a = k / 64 * 6.2832, x = Math.sqrt(2 * J * bm) * Math.cos(a), xp = -Math.sqrt(2 * J / bm) * Math.sin(a); k ? g.lineTo(X(x), Y(xp)) : g.moveTo(X(x), Y(xp)); } g.stroke(); }
        const ph = performance.now() / 1000 * 0.8;
        for (let i = 0; i < 40; i++) { const J = 0.05 + (i % 10) / 10, a = ph * 2 * Math.PI * 0.31 + i * 2.4, x = Math.sqrt(2 * J * bm) * Math.cos(a), xp = -Math.sqrt(2 * J / bm) * Math.sin(a); dot(g, X(x), Y(xp), 2.2 * d, SER[1]); }
      },
    ],
    tune: [
      (g, w, h, d) => {
        const b = box(w, h, d, [34, 14, 22, 22]), lo = 0.25, hi = 0.36, { X, Y } = axes(g, b, [lo, hi], [lo, hi], { xt: [0.26, 0.3, 0.34], yt: [0.26, 0.3, 0.34], xl: 'Qx (fraction)', yl: 'Qy' });
        g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
        for (const r of A.resonances(7)) {
          // m x + n y = p ; draw across the box
          const pts = [];
          if (Math.abs(r.n) > 0) { for (const x of [lo, hi]) pts.push([x, (r.p - r.m * x) / r.n]); }
          else pts.push([r.p / r.m, lo], [r.p / r.m, hi]);
          const a = Math.max(0.08, 0.6 - 0.08 * r.o);
          poly(g, pts, X, Y, `rgba(160,170,200,${a})`, r.o <= 3 ? 1.4 : 0.8, d);
        }
        // the chromatic footprint: Q(delta) for |delta| < 3 sigma_delta (1.1e-4)
        const sx = A.sextupoleFor(cell, S.Qp / 184, S.Qp / 184), sd = 1.1e-4;
        g.fillStyle = SER[1];
        for (let i = -30; i <= 30; i++) { const dl = i / 10 * sd, q = A.cellTune(cell, dl, sx), q0 = A.cellTune(cell, 0, sx); const qx = 0.31 + (q.qx - q0.qx) * 184, qy = 0.32 + (q.qy - q0.qy) * 184; dot(g, X(qx), Y(qy), 1.8 * d, SER[1]); }
        dot(g, X(0.31), Y(0.32), 4.5 * d, '#fff');
        g.restore();
        legend(g, [["Q' footprint ±3σδ", SER[1]], ['working point', '#ffffff']], b.x + 6 * d, b.y + 12 * d, d);
      },
      (g, w, h, d) => {
        const b = box(w, h, d), { X, Y } = axes(g, b, [-1, 1], [-1, 1], { xt: [0], yt: [0], xl: `Hénon map · Q = ${S.qH.toFixed(3)} · sextupole k₂ = 1`, yl: "x'" });
        if (!S.henon.length || S.henon.q !== S.qH) {
          S.henon = []; S.henon.q = S.qH;
          for (let k = 0; k < 26; k++) { const a = 0.03 + k * 0.026; S.henon.push(A.henon(S.qH, -1, [a, 0], 500)); }
        }
        S.henon.forEach((rec, k) => { const c = rec.length < 500 ? 'rgba(217,89,38,0.75)' : `rgba(57,135,229,${0.35 + 0.5 * (k % 3) / 2})`; g.fillStyle = c; for (const [x, p] of rec) { if (Math.abs(x) > 1 || Math.abs(p) > 1) continue; g.fillRect(X(x), Y(p), 1.4 * d, 1.4 * d); } });
        legend(g, [['bounded', SER[0]], ['lost', SER[1]]], b.x + 6 * d, b.y + 12 * d, d);
      },
    ],
    rf: [
      (g, w, h, d) => {
        const R = rfNow(), sep = A.separatrix(R), lim = R.dmax0 * 1.6, b = box(w, h, d, [44, 14, 22, 22]);
        const { X, Y } = axes(g, b, [R.phis - 3.6, R.phis + 3.6], [-lim, lim], { xt: [R.phis - Math.PI, R.phis, R.phis + Math.PI], xf: v => `${Math.round((v - R.phis) * 180 / Math.PI)}°`, yt: [-R.dmax0, 0, R.dmax0], yf: v => (v * 1e4).toFixed(1), xl: 'φ − φs', yl: 'δ = Δp/p (×10⁻⁴)' });
        g.save(); g.beginPath(); g.rect(b.x, b.y, b.w, b.h); g.clip();
        poly(g, sep.pts, X, Y, SER[0], 2, d); poly(g, sep.pts.map(([p, v]) => [p, -v]), X, Y, SER[0], 2, d);
        for (const q of S.rfPts) dot(g, X(q[0]), Y(q[1]), 1.8 * d, SER[1]);
        g.restore();
        legend(g, [['separatrix', SER[0]], ['protons', SER[1]]], b.x + 6 * d, b.y + 12 * d, d);
      },
    ],
    ramp: [
      (g, w, h, d) => {
        const T = A.ramp(0).T, b = box(w, h * 0.64, d, [40, 14, 18, 22]), { X, Y } = axes(g, b, [0, T], [0, 7], { xt: [0, 3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800, 32400, 36000, 39600], xf: v => v % 7200 ? '' : `${v / 3600} h`, yt: [0, 3.5, 7], yl: 'p (TeV/c)' });
        const pts = []; for (let t = 0; t <= T; t += T / 600) pts.push([t, A.ramp(t).p / 1000]);
        poly(g, pts, X, Y, SER[0], 2, d);
        const r = A.ramp(S.t); dot(g, X(S.t), Y(r.p / 1000), 4.5 * d, '#fff');
        g.fillStyle = INK; g.fillText(`${r.phase} · B = ${r.B.toFixed(2)} T`, b.x + 6 * d, b.y + 12 * d);
        const b2 = { x: b.x, y: h * 0.72, w: b.w, h: h * 0.18, d }, A2 = axes(g, b2, [0, T], [0, 600], { yt: [0, 500], yl: 'gain per turn (keV)' });
        const q = []; for (let t = 0; t <= T; t += T / 600) q.push([t, Math.max(0, A.rampRate(t) * 1e6 * A.LHC.C / A.CLIGHT)]);
        poly(g, q, A2.X, A2.Y, SER[2], 2, d);
      },
    ],
    ip: [
      (g, w, h, d) => {
        const P = A.PRESETS[S.preset], L = A.luminosity(P), b = box(w, h, d, [40, 14, 22, 22]);
        const zr = 4 * P.sigZ, xr = 5 * L.sigma, { X, Y } = axes(g, b, [-zr, zr], [-xr, xr], { xt: [-0.2, 0, 0.2].filter(v => Math.abs(v) <= zr), xf: v => `${v * 100} cm`, yt: [-2 * L.sigma, 0, 2 * L.sigma], yf: v => `${(v * 1e6).toFixed(0)} μm`, xl: 'z along the beam', yl: 'x' });
        const k = (performance.now() / 1000 % 3) / 3 * 2 - 1;      // -1 .. 1, the bunch centres move through each other
        for (const [sg, col] of [[1, 'rgba(217,89,38,'], [-1, 'rgba(57,135,229,']]) {
          const zc = sg * k * zr * 0.8, ang = sg * P.thetaC / 2 * (zr / xr);
          for (let i = 0; i < 200; i++) {
            const u = (i * 0.618) % 1, v = (i * 0.371) % 1, gz = Math.sqrt(-2 * Math.log(u + 1e-3)) * Math.cos(6.283 * v), gx = Math.sqrt(-2 * Math.log(u + 1e-3)) * Math.sin(6.283 * v);
            const z = zc + gz * P.sigZ, x = gx * L.sigma + (z) * sg * P.thetaC / 2;
            g.fillStyle = col + '0.6)'; g.fillRect(X(z), Y(x), 1.6 * d, 1.6 * d);
          }
          void ang;
        }
        g.fillStyle = INK; g.fillText(`σ* ${(L.sigma * 1e6).toFixed(1)} μm · θc ${(P.thetaC * 1e6).toFixed(0)} μrad · F ${L.F.toFixed(3)}`, b.x + 6 * d, b.y + 12 * d);
      },
      (g, w, h, d) => {
        const P = A.PRESETS[S.preset], b = box(w, h, d, [44, 14, 22, 22]), { X, Y } = axes(g, b, [0.1, 1.0], [0, 6], { xt: [0.15, 0.3, 0.55, 1.0], xf: v => `${v} m`, yt: [0, 2, 4, 6], yf: v => `${v}e34`, xl: 'β*', yl: 'L (cm⁻²s⁻¹)' });
        const pts = []; for (let bs = 0.1; bs <= 1.0; bs += 0.01) pts.push([bs, A.luminosity({ ...P, betaStar: bs }).L / 1e34]);
        poly(g, pts, X, Y, SER[0], 2, d);
        const L = A.luminosity(P); dot(g, X(P.betaStar), Y(L.L / 1e34), 4.5 * d, '#fff');
      },
    ],
    sr: [
      (g, w, h, d) => {
        const b = box(w, h, d, [46, 14, 22, 22]), { X, Y } = axes(g, b, [10, 10000], [1e-3, 1e10], { logx: true, logy: true, xt: [10, 100, 1000, 10000], xf: v => `${v} GeV`, yt: [1e-3, 1, 1e3, 1e6, 1e9], yf: v => v >= 1e9 ? `${v / 1e9} GeV` : v >= 1e6 ? `${v / 1e6} MeV` : v >= 1e3 ? `${v / 1e3} keV` : `${v} eV`, xl: 'beam energy', yl: 'U₀ per turn' });
        const pp = [], ee = []; for (let l = 1; l <= 4; l += 0.02) { const E = 10 ** l; pp.push([E, A.srLoss(E, A.LHC.rho).U0]); if (E < 300) ee.push([E, A.srLoss(E, 3026, 'e').U0]); }
        poly(g, pp, X, Y, SER[0], 2, d); poly(g, ee, X, Y, SER[1], 2, d);
        const r = A.ramp(S.t); dot(g, X(Math.max(10, r.p)), Y(A.srLoss(r.p, A.LHC.rho).U0), 4.5 * d, '#fff');
        dot(g, X(104.5), Y(A.srLoss(104.5, 3026, 'e').U0), 4 * d, SER[1]);
        legend(g, [['protons, this ring', SER[0]], ['electrons, LEP (2000)', SER[1]]], b.x + 6 * d, b.y + 12 * d, d);
      },
    ],
    dump: [
      (g, w, h, d) => {
        const P = A.PRESETS[S.preset], D = A.dump(P), b = box(w, h, d), { X, Y } = axes(g, b, [-45, 45], [-40, 40], { xt: [-40, 0, 40], yt: [-30, 0, 30], xf: v => `${v} cm`, yf: v => `${v}`, xl: 'the face of the dump block', yl: 'y (cm)' });
        const k = Math.min(1, (performance.now() / 1000 % 6) / 3.5), n = Math.floor(D.pts.length * k);
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) { const [x, y] = D.pts[i], a = i / D.pts.length; dot(g, X(x), Y(y), 2.4 * d, `rgba(${255},${Math.round(120 + 100 * a)},${Math.round(60 + 60 * a)},0.55)`); }
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = INK; g.fillText(`${(D.stored / 1e6).toFixed(0)} MJ in ${(D.turn * 1e6).toFixed(0)} μs`, b.x + 6 * d, b.y + 12 * d);
      },
    ],
  };

  // numbers for the station table: [label, value]
  function nums(id) {
    const P = A.PRESETS[S.preset], r = A.ramp(S.t), R = rfNow(), L = A.luminosity(P), T = A.chainTable();
    switch (id) {
      case 'source': return [['Linac RF', '352.2 MHz'], ['Cell length βλ at 50 MeV', `${(lin.L * 100).toFixed(1)} cm`], ['Gain per cell', `${(lin.gain * 1e3).toFixed(0)} keV`], ['φs', '−30°'], ['Phase advance', `${(lin.muCell * 180 / Math.PI).toFixed(2)}° / cell`], ['Final energy', '160 MeV']];
      case 'chain': return T.filter(s => s.B).map(s => [s.name.replace('Super Proton Synchrotron', 'SPS').replace('Proton Synchrotron', 'PS'), `${f3(s.pGeV)} GeV/c · ${s.B.toFixed(2)} T · ${(s.frev / 1e3).toFixed(1)} kHz`]);
      case 'dipole': return [['Momentum now', `${(r.p / 1000).toFixed(3)} TeV/c`], ['B ρ', `${A.brho(r.p).toFixed(0)} T·m`], ['Dipole field', `${r.B.toFixed(3)} T`], ['Field at 7 TeV', `${(A.brho(7000) / A.LHC.rho).toFixed(2)} T`], ['Dipoles', '1232 × 14.3 m'], ['Bend per dipole', `${(2 * Math.PI / 1232 * 1e3).toFixed(2)} mrad`]];
      case 'fodo': return [['Cell length', `${cell.Lc} m`], ['Phase advance', `${(cell.mu * 180 / Math.PI).toFixed(1)}°`], ['β max / min', `${cell.betaMax.toFixed(1)} / ${cell.betaMin.toFixed(1)} m`], ['D max / min', `${cell.Dmax.toFixed(2)} / ${cell.Dmin.toFixed(2)} m`], ['Quad focal length', `${cell.f.toFixed(1)} m`], ['σ at β max, 7 TeV', `${(Math.sqrt(3.75e-6 / 7461 * cell.betaMax) * 1e3).toFixed(2)} mm`]];
      case 'tune': { const sx = A.sextupoleFor(cell, S.Qp / 184, S.Qp / 184); return [['Tunes Qx / Qy', '64.31 / 59.32'], ['Natural ξ per cell', fx(cell.xiX, 4)], ["Natural Q' (184 cells)", fx(cell.xiX * 184, 1)], ["Target Q'", `+${S.Qp}`], ['SF k₂L', `${sx.SF.toFixed(4)} m⁻²`], ['SD k₂L', `${sx.SD.toFixed(4)} m⁻²`]]; }
      case 'rf': return [['Energy', `${(R.E).toFixed(0)} GeV`], ['RF voltage', `${R.V} MV · h = ${R.h}`], ['η', sci(R.eta)], ['φs', `${(R.phis * 180 / Math.PI).toFixed(2)}°`], ['Qs', R.Qs.toFixed(5)], ['Bucket half-height', sci(R.dmax0)]];
      case 'ramp': return [['Phase', r.phase], ['Momentum', `${(r.p / 1000).toFixed(3)} TeV/c`], ['Dipole field', `${r.B.toFixed(3)} T`], ['Gain per turn', `${Math.max(0, A.rampRate(S.t) * 1e6 * A.LHC.C / A.CLIGHT).toFixed(0)} keV`], ['Cycle clock', `${(S.t / 3600).toFixed(2)} h`], ['Clock speed', `×${S.rampRate}`]];
      case 'ip': return [['Preset', P.name], ['Luminosity', `${sci(L.L)} cm⁻²s⁻¹`], ['σ*', `${(L.sigma * 1e6).toFixed(1)} μm`], ['Crossing factor F', L.F.toFixed(3)], ['Pile-up μ', L.mu.toFixed(1)], ['Collision rate', `${(L.rate / 1e9).toFixed(2)} GHz`]];
      case 'sr': { const s = A.srLoss(Math.max(450, r.p), A.LHC.rho), pw = s.U0 * P.nb * P.N * L.f * A.QE; return [['U₀ now', `${(s.U0 / 1e3).toFixed(3)} keV / turn`], ['Critical energy', `${s.Ec.toFixed(1)} eV`], ['Power per beam', `${(pw / 1e3).toFixed(2)} kW`], ['LEP 104.5 GeV', `${(A.srLoss(104.5, 3026, 'e').U0 / 1e9).toFixed(2)} GeV / turn`]]; }
      case 'dump': { const D = A.dump(P); return [['Stored energy', `${(D.stored / 1e6).toFixed(0)} MJ`], ['Bunches', `${P.nb} × ${sci(P.N)}`], ['Turn time', `${(D.turn * 1e6).toFixed(1)} μs`], ['Abort gap', '3 μs'], ['TNT equivalent', `${(D.stored / 4.184e6).toFixed(0)} kg`]]; }
    }
    return [];
  }
  function draw(id, canvases) {
    const list = PLOTS[id] || [];
    canvases.forEach((c, i) => {
      if (!c) return;
      const r = c.getBoundingClientRect(); if (!r.width || !r.height) return;
      const d = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * d), h = Math.round(r.height * d);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const g = c.getContext('2d'); g.clearRect(0, 0, w, h);
      c.style.display = list[i] ? '' : 'none';
      if (list[i]) list[i](g, w, h, d);
    });
  }
  return { S, tick, draw, nums, plotsOf: id => (PLOTS[id] || []).length, resetRF, resetLinac, rfNow, lum: () => A.luminosity(A.PRESETS[S.preset]) };
}
