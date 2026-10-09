// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · view2d.js — the 2D pane: string, force colour, modes, spectrum
// ────────────────────────────────────────────────────────────────────────────
//  One canvas, four regions, drawn each frame from the shared world object
//  that main.js owns (the 3D view reads the same object):
//
//    string     the full scale from the nut (left) to the bridge (right).
//               The part behind the stopping fret lies flat. The vibrating
//               part is drawn with exaggerated displacement and coloured
//               by the chosen field (total acceleration by default) through
//               a ct-lab colour map. Arrows show the field along the string.
//               Node and antinode marks show for the chosen harmonic.
//    history    the field along the string over time, newest row at top.
//               Travelling kinks show as diagonal lines (d'Alembert).
//    modes      bars: amplitude of harmonic n of the selected string, with
//               its ratio n:1 and its frequency f_n.
//    spectrum   the same modes as lines on a log frequency axis (dB).
//
//  Positions on a string are fractions from the BRIDGE (engine convention),
//  so screen x = bridgeX - pos * (bridgeX - fretX).
//
//  Pointer input (single-string or all-strings lanes):
//    pluck    drag the string out and release
//    strike   tap: a velocity bump at that point
//    bow      hold: stick-slip bowing at that point until release
//    touch    tap near a node: light touch there, then a pluck (harmonic)
//  Each input calls world.excite(stringIndex, kind, args).
//
//  SECTION MAP   (grep -n "<anchor>" view2d.js)
//    factory ........... "export function createView2D"
//    layout ............ "function layout("
//    field scale ....... "function fieldOf("
//    string lane ....... "function drawLane("
//    history ........... "function drawHistory("
//    modal bars ........ "function drawModes("
//    spectrum .......... "function drawSpectrum("
//    modal analysis .... "export function modeAmplitudes"
//    pointer ........... "function onDown("
// ════════════════════════════════════════════════════════════════════════════

import * as CM from '../ct-lab/colormaps/maps.js';
import { floorLut } from './stringlut.js';
import { smoothField } from './engine/strings.js';
import { noteName, freqToMidi } from './engine/instruments.js';

export const FIELDS = {
  a: { label: 'Total acceleration', short: 'a', unit: 'm/s²', key: 'a' },
  aTension: { label: 'Tension part', short: 'a_T', unit: 'm/s²', key: 'aTension' },
  aStiff: { label: 'Stiffness part', short: 'a_B', unit: 'm/s²', key: 'aStiff' },
  aDamp: { label: 'Damping part', short: 'a_d', unit: 'm/s²', key: 'aDamp' },
  v: { label: 'Velocity', short: 'v', unit: 'm/s', key: 'v' },
  u: { label: 'Displacement', short: 'u', unit: 'm', key: 'u' },
};

export const HARMONIC_COLORS = ['#ffd27a', '#62c4ff', '#ff9a62', '#86dc7c', '#e889dc', '#a8a4ff', '#7fe3d5', '#ff7a9a', '#c9e27a', '#9fb7ff', '#ffb0e0', '#d0c090'];

const N_MODES = 12;
const HIST_COLS = 192, HIST_ROWS = 140;

/**
 * Modal amplitudes of a sampled string: A_n = sqrt(b_n^2 + (c_n / w_n)^2),
 * where b_n and c_n are the projections of u and v on sin(n pi x).
 * Returns Float64Array(nMax) in metres.
 */
export function modeAmplitudes(u, v, f1, B, nMax = N_MODES, out = new Float64Array(nMax)) {
  const N = u.length - 1;
  for (let n = 1; n <= nMax; n++) {
    let b = 0, c = 0;
    const kx = (n * Math.PI) / N;
    for (let i = 1; i < N; i++) {
      const s = Math.sin(kx * i);
      b += u[i] * s; c += v[i] * s;
    }
    b *= 2 / N; c *= 2 / N;
    const w = 2 * Math.PI * n * f1 * Math.sqrt(1 + B * n * n);
    out[n - 1] = Math.hypot(b, c / w);
  }
  return out;
}

export function createView2D(canvas, world) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 0, H = 0, dpr = 1;
  let L = null;                        // layout
  const bufs = [];                     // smoothed field per string
  const scales = [];                   // running field scale per string
  const hist = new Float32Array(HIST_COLS * HIST_ROWS);
  let histHead = 0, histScale = 1e-9, histKey = '';
  const histCanvas = document.createElement('canvas');
  histCanvas.width = HIST_COLS; histCanvas.height = HIST_ROWS;
  const hctx = histCanvas.getContext('2d');
  let himg = null;
  const amps = new Float64Array(N_MODES);
  let lutKey = '', lut = null, slut = null, diverging = false;
  let drag = null;                     // { lane, pos, kind, y0, id }
  let hover = null;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    L = layout();
  }

  function layout() {
    const pad = W < 520 ? 10 : 16;
    const narrow = W < 560;
    const all = world.showAll && world.sims.length > 1;
    const hStr = Math.round(H * (narrow ? 0.44 : 0.47));
    const hHist = Math.round(H * (narrow ? 0.16 : 0.18));
    const top = { x: pad, y: 6, w: W - 2 * pad, h: hStr };
    const histR = { x: pad, y: top.y + top.h + 6, w: W - 2 * pad, h: hHist - 6 };
    const yb = histR.y + histR.h + 22;
    const hb = H - yb - 8;
    let modes, spec;
    if (narrow) {
      modes = { x: pad, y: yb, w: W - 2 * pad, h: hb * 0.52 - 14 };
      spec = { x: pad, y: yb + hb * 0.52 + 8, w: W - 2 * pad, h: hb * 0.48 - 8 };
    } else {
      const wm = (W - 2 * pad - 16) * 0.5;
      modes = { x: pad, y: yb, w: wm, h: hb };
      spec = { x: pad + wm + 16, y: yb, w: wm, h: hb };
    }
    const nutX = top.x + 26, bridgeX = top.x + top.w - 26;
    const lanes = [];
    if (all) {
      // the legend keeps the top 34 px; index 0 (lowest string) at the bottom
      const n = world.sims.length, y0 = top.y + 34, lh = (top.h - 34) / n;
      for (let i = 0; i < n; i++) lanes.push({ i, y: y0 + (top.h - 34) - (i + 0.5) * lh, h: lh });
    } else {
      lanes.push({ i: world.sel, y: top.y + top.h * 0.56, h: top.h * 0.8 });
    }
    return { pad, top, histR, modes, spec, nutX, bridgeX, lanes, all, narrow };
  }

  function lutNow() {
    const c = world.cmap;
    const key = `${c.id}|${c.reverse}|${c.gamma}`;
    if (key !== lutKey) {
      lutKey = key;
      lut = CM.variant(c.id, { reverse: c.reverse, gamma: c.gamma });
      slut = floorLut(lut);   // the string itself: never darker than L* 34
      diverging = CM.get(c.id).kind === 'diverging';
    }
    return lut;
  }
  const col = (t) => {
    const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
    return `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`;
  };
  // the string and its arrows: the floored LUT, so a string at rest (zero
  // field, black in magma) still shows over the dark fretboard
  const scol = (t) => {
    const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
    return `rgb(${slut[k]},${slut[k + 1]},${slut[k + 2]})`;
  };
  // value -> colour parameter: magnitude for sequential maps, signed for diverging
  const tOf = (f, s) => (diverging ? 0.5 + 0.5 * Math.max(-1, Math.min(1, f / s)) : Math.min(1, Math.abs(f) / s));

  /** Smoothed field of string i and its running scale. */
  function fieldOf(i) {
    const sim = world.sims[i];
    const src = sim[FIELDS[world.field].key];
    if (!bufs[i] || bufs[i].length !== src.length) bufs[i] = new Float64Array(src.length);
    const passes = world.field === 'u' || world.field === 'v' ? 1 : 3;
    smoothField(src, passes, bufs[i]);
    let m = 0;
    for (let j = 0; j < src.length; j++) m = Math.max(m, Math.abs(bufs[i][j]));
    const prev = scales[i] || 0;
    // fast attack, slow release: the colours do not flicker as the wave turns
    scales[i] = Math.max(m, prev * 0.985, 1e-12);
    return bufs[i];
  }

  const fretX = (fret) => L.nutX + (L.bridgeX - L.nutX) * (1 - 2 ** (-fret / 12));
  const pxPerM = () => (L.bridgeX - L.nutX) / world.inst.scaleM;

  function drawLane(lane, F) {
    const i = lane.i, sim = world.sims[i], N = sim.N;
    const s = scales[i];
    const fx = fretX(world.frets[i]), bx = L.bridgeX, cy = lane.y;
    const ampPx = Math.min(lane.h * 0.46, 260);
    const k = world.exag * pxPerM();
    const yOf = (u) => cy - Math.max(-ampPx, Math.min(ampPx, u * k));
    const xOf = (j) => bx - ((bx - fx) * j) / N;
    const single = !L.all;
    const sel = i === world.sel;

    // rest line, nut, bridge, frets
    ctx.strokeStyle = 'rgba(143,182,255,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L.nutX, cy); ctx.lineTo(bx, cy); ctx.stroke();
    if (single || i === 0) {
      const y0 = single ? cy - ampPx : L.top.y, y1 = single ? cy + ampPx : L.top.y + L.top.h;
      ctx.strokeStyle = 'rgba(200,210,230,0.10)';
      if (!world.inst.bowed) {
        for (let f = 1; f <= world.inst.frets; f++) {
          const x = fretX(f);
          ctx.beginPath(); ctx.moveTo(x, y0 + 10); ctx.lineTo(x, y1 - 10); ctx.stroke();
        }
      }
      ctx.fillStyle = '#c9c2b0';
      ctx.fillRect(L.nutX - 5, y0 + 6, 5, y1 - y0 - 12);
      ctx.fillStyle = '#8e7b62';
      ctx.fillRect(bx, y0 + 6, 6, y1 - y0 - 12);
      if (single) {
        ctx.fillStyle = '#6f7690'; ctx.font = '500 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('nut', L.nutX - 3, y1 + 2);
        ctx.fillText('bridge', bx + 3, y1 + 2);
      }
    }
    // the stopped part (nut to fret) lies still
    ctx.strokeStyle = sel ? '#59607a' : '#3c4258'; ctx.lineWidth = single ? 2 : 1.5;
    ctx.beginPath(); ctx.moveTo(L.nutX, cy); ctx.lineTo(fx, cy); ctx.stroke();
    if (world.frets[i] > 0) {
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath(); ctx.arc(fx - 6, cy, single ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // harmonic nodes and antinodes (single view)
    if (single && world.harmonic > 1) {
      const n = world.harmonic, hc = HARMONIC_COLORS[(n - 1) % HARMONIC_COLORS.length];
      ctx.fillStyle = hc; ctx.strokeStyle = hc; ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      for (let q = 1; q < n; q++) {
        const x = bx - (bx - fx) * (q / n);
        ctx.beginPath(); ctx.arc(x, cy, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillText('N', x, cy + ampPx * 0.62 + 14);
        ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(x, cy - ampPx * 0.6); ctx.lineTo(x, cy + ampPx * 0.6); ctx.stroke(); ctx.globalAlpha = 1;
      }
      for (let q = 0; q < n; q++) {
        const x = bx - (bx - fx) * ((2 * q + 1) / (2 * n));
        ctx.beginPath(); ctx.moveTo(x, cy + ampPx * 0.62); ctx.lineTo(x - 4, cy + ampPx * 0.62 + 6); ctx.lineTo(x + 4, cy + ampPx * 0.62 + 6); ctx.closePath(); ctx.fill();
      }
    }
    if (single && world.tool === 'touch') {
      ctx.fillStyle = 'rgba(255,210,122,0.55)'; ctx.font = '500 9px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      for (const [q, n] of [[1, 2], [1, 3], [1, 4], [1, 5], [2, 5], [1, 6]]) {
        const x = bx - (bx - fx) * (q / n);
        ctx.fillRect(x - 0.5, cy - ampPx * 0.9, 1, 8);
        ctx.fillText(`${q}/${n}`, x, cy - ampPx * 0.9 - 3);
      }
    }

    // string: a dark under-stroke, then coloured segments
    const lw = single ? 6 : sel ? 4 : 3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = lw + 3;
    ctx.beginPath();
    for (let j = 0; j <= N; j++) { const x = xOf(j), y = yOf(sim.u[j]); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.lineWidth = lw;
    for (let j = 0; j < N; j++) {
      ctx.strokeStyle = scol(tOf(0.5 * (F[j] + F[j + 1]), s));
      ctx.beginPath(); ctx.moveTo(xOf(j), yOf(sim.u[j])); ctx.lineTo(xOf(j + 1), yOf(sim.u[j + 1])); ctx.stroke();
    }

    // force arrows
    if (world.arrows && (single || lane.h > 46)) {
      const na = single ? 29 : 15, len = single ? Math.min(70, ampPx * 0.5) : lane.h * 0.36;
      for (let q = 1; q < na; q++) {
        const j = Math.round((q / na) * N), f = F[j] / s;
        if (Math.abs(f) < 0.04) continue;
        const x = xOf(j), y = yOf(sim.u[j]), dy = -f * len;
        ctx.strokeStyle = scol(tOf(F[j], s)); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = single ? 1.6 : 1.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + dy); ctx.stroke();
        const hd = Math.sign(dy) * Math.min(6, Math.abs(dy) * 0.5);
        ctx.beginPath(); ctx.moveTo(x, y + dy); ctx.lineTo(x - 3.5, y + dy - hd); ctx.lineTo(x + 3.5, y + dy - hd); ctx.closePath(); ctx.fill();
      }
    }

    // pluck point (selected string only) and bow
    if (single || sel) {
      const pp = bx - (bx - fx) * world.pluckPos, py = cy + (single ? ampPx * 0.95 : lane.h * 0.3);
      ctx.fillStyle = 'rgba(126,224,168,0.8)';
      ctx.beginPath(); ctx.moveTo(pp, py); ctx.lineTo(pp - 4, py + 7); ctx.lineTo(pp + 4, py + 7); ctx.closePath(); ctx.fill();
    }
    const bw = sim.bowing;
    if (bw) {
      const x = bx - (bx - fx) * bw.pos;
      ctx.fillStyle = 'rgba(232,201,150,0.35)';
      ctx.fillRect(x - 4, cy - ampPx * 0.8, 8, ampPx * 1.6);
    }

    // drag preview (pluck)
    if (drag && drag.lane === i && drag.kind === 'pluck') {
      const gx = bx - (bx - fx) * drag.pos;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(fx, cy); ctx.lineTo(gx, drag.y); ctx.lineTo(bx, cy); ctx.stroke(); ctx.setLineDash([]);
    }

    // label
    const st = world.inst.strings[i];
    const f1 = world.f1(i);
    ctx.textAlign = 'left';
    ctx.font = `${single ? 600 : 500} ${single ? 13 : 10}px Inter, system-ui, sans-serif`;
    const lab = single ? `${st.name} string · ${noteName(Math.round(freqToMidi(f1)))} · ${f1.toFixed(f1 < 100 ? 2 : 1)} Hz`
      : `${st.name} · ${world.frets[i] < 0 ? 'muted' : `${noteName(Math.round(freqToMidi(f1)))} ${f1.toFixed(0)} Hz`}`;
    const ly = single ? lane.y - ampPx - 2 : lane.y - lane.h * 0.5 + 11;
    if (!single) { ctx.fillStyle = 'rgba(10,12,20,0.75)'; ctx.fillRect(L.nutX + 2, ly - 10, ctx.measureText ? ctx.measureText(lab).width + 6 : 90, 13); }
    ctx.fillStyle = sel ? '#eef1f8' : '#9aa1b8';
    ctx.fillText(lab, L.nutX + 4, ly);
  }

  function drawLegend() {
    const s = scales[world.sel] || 1, fd = FIELDS[world.field];
    const x = L.top.x + L.top.w - 170, y = L.top.y + 8, w = 150;
    for (let q = 0; q < w; q++) { ctx.fillStyle = col(q / (w - 1)); ctx.fillRect(x + q, y + 14, 1, 7); }
    ctx.fillStyle = '#aeb4c4'; ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(diverging ? `${fd.label} (signed)` : `|${fd.label.toLowerCase()}|`, x, y + 9);
    ctx.textAlign = 'right';
    ctx.fillText(`${diverging ? '+' : ''}${fmt(s)} ${fd.unit}`, x + w, y + 33);
    ctx.textAlign = 'left';
    ctx.fillText(diverging ? `-${fmt(s)}` : '0', x, y + 33);
  }

  function pushHistory(F) {
    const i = world.sel, N = F.length - 1, s = scales[i];
    histHead = (histHead + HIST_ROWS - 1) % HIST_ROWS;
    const row = histHead * HIST_COLS;
    for (let c = 0; c < HIST_COLS; c++) {
      const x = (c / (HIST_COLS - 1)) * N, j = Math.min(N - 1, Math.floor(x)), f = x - j;
      hist[row + c] = (F[j] * (1 - f) + F[j + 1] * f);
    }
    histScale = Math.max(s, histScale * 0.995);
  }

  function drawHistory() {
    const r = L.histR;
    if (r.h < 12) return;
    const key = `${world.sel}|${world.field}|${world.instKey}`;
    if (key !== histKey) { hist.fill(0); histKey = key; histScale = 1e-9; }
    if (!himg) himg = hctx.createImageData(HIST_COLS, HIST_ROWS);
    const d = himg.data, s = histScale;
    for (let rr = 0; rr < HIST_ROWS; rr++) {
      const src = ((histHead + rr) % HIST_ROWS) * HIST_COLS;
      for (let c = 0; c < HIST_COLS; c++) {
        // columns: bridge on the right, as in the string view
        const t = tOf(hist[src + (HIST_COLS - 1 - c)], s);
        const k = Math.round(t * 255) * 3, o = (rr * HIST_COLS + c) * 4;
        d[o] = lut[k]; d[o + 1] = lut[k + 1]; d[o + 2] = lut[k + 2]; d[o + 3] = 255;
      }
    }
    hctx.putImageData(himg, 0, 0);
    // the history spans the vibrating part only; draw it under that part
    const fx = fretX(world.frets[world.sel]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(histCanvas, fx, r.y, L.bridgeX - fx, r.h);
    ctx.strokeStyle = 'rgba(143,182,255,0.18)'; ctx.lineWidth = 1;
    ctx.strokeRect(fx + 0.5, r.y + 0.5, L.bridgeX - fx - 1, r.h - 1);
    ctx.fillStyle = '#8b92a8'; ctx.font = '500 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('field over time', L.nutX, r.y + 12);
    ctx.fillText('newest at top', L.nutX, r.y + 25);
  }

  function drawModes() {
    const r = L.modes, i = world.sel, sim = world.sims[i];
    modeAmplitudes(sim.u, sim.v, sim.f1, sim.B, N_MODES, amps);
    let m = 0;
    for (const a of amps) m = Math.max(m, a);
    ctx.fillStyle = '#c9cedb'; ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Harmonics now on the string', r.x, r.y - 8);
    const bw = r.w / N_MODES;
    const base = r.y + r.h - 24;
    const hmax = base - r.y - 4;
    ctx.strokeStyle = 'rgba(143,182,255,0.18)'; ctx.beginPath(); ctx.moveTo(r.x, base + 0.5); ctx.lineTo(r.x + r.w, base + 0.5); ctx.stroke();
    for (let n = 1; n <= N_MODES; n++) {
      const a = m > 0 ? amps[n - 1] / m : 0;
      const x = r.x + (n - 1) * bw + bw * 0.16, w = bw * 0.68;
      const h = Math.max(1, a * hmax);
      const hc = HARMONIC_COLORS[(n - 1) % HARMONIC_COLORS.length];
      ctx.globalAlpha = world.harmonic === n || world.harmonic < 2 ? 1 : 0.55;
      ctx.fillStyle = hc; ctx.fillRect(x, base - h, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#dde1ec'; ctx.font = `600 ${bw > 30 ? 10 : 9}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(`${n}:1`, x + w / 2, base + 12);
      if (bw > 26) {
        const fn = n * sim.f1 * Math.sqrt(1 + sim.B * n * n);
        ctx.fillStyle = '#8b92a8'; ctx.font = '500 9px Inter, system-ui, sans-serif';
        ctx.fillText(fn >= 1000 ? `${(fn / 1000).toFixed(2)}k` : fn.toFixed(0), x + w / 2, base + 22);
      }
    }
  }

  function drawSpectrum() {
    const r = L.spec, sim = world.sims[world.sel];
    const fLo = 40, fHi = 12000, lx = Math.log(fHi / fLo);
    const X = (f) => r.x + (Math.log(f / fLo) / lx) * r.w;
    const base = r.y + r.h - 14, top = r.y + 4, dbMin = -60;
    ctx.fillStyle = '#c9cedb'; ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Spectrum (dB, log frequency)', r.x, r.y - 8);
    ctx.strokeStyle = 'rgba(143,182,255,0.12)'; ctx.fillStyle = '#6f7690'; ctx.font = '500 9px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    for (let o = 1; o <= 9; o++) {
      const f = 32.703 * 2 ** (o - 1);
      if (f < fLo || f > fHi) continue;
      const x = X(f);
      ctx.beginPath(); ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, base); ctx.stroke();
      ctx.fillText(`C${o}`, x, base + 11);
    }
    let m = 0;
    for (let n = 1; n <= N_MODES; n++) m = Math.max(m, amps[n - 1] * n);
    if (m <= 0) return;
    for (let n = 1; n <= N_MODES; n++) {
      const fn = n * sim.f1 * Math.sqrt(1 + sim.B * n * n);
      if (fn > fHi) break;
      const db = Math.max(dbMin, 20 * Math.log10((amps[n - 1] * n) / m + 1e-12));
      const y = base - ((db - dbMin) / -dbMin) * (base - top);
      const x = X(fn);
      ctx.strokeStyle = HARMONIC_COLORS[(n - 1) % HARMONIC_COLORS.length]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 1;
  }

  function draw() {
    if (!L) resize();
    if (!W || !H) return;
    lutNow();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0c14'; ctx.fillRect(0, 0, W, H);
    const fields = [];
    for (const lane of L.lanes) fields[lane.i] = fieldOf(lane.i);
    if (!fields[world.sel]) fields[world.sel] = fieldOf(world.sel);
    if (!world.paused) pushHistory(fields[world.sel]);
    for (const lane of L.lanes) drawLane(lane, fields[lane.i]);
    drawLegend();
    drawHistory();
    drawModes();
    drawSpectrum();
  }

  // ── pointer ─────────────────────────────────────────────────────────────
  function hit(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!L || y > L.top.y + L.top.h + 4) return null;
    let lane = L.lanes[0];
    if (L.all) {
      let best = 1e9;
      for (const ln of L.lanes) { const d = Math.abs(ln.y - y); if (d < best) { best = d; lane = ln; } }
    }
    const fx = fretX(world.frets[lane.i]);
    if (x < fx - 8 || x > L.bridgeX + 8) return null;
    const pos = Math.max(0.01, Math.min(0.99, (L.bridgeX - x) / (L.bridgeX - fx)));
    return { lane: lane.i, pos, x, y, cy: lane.y };
  }

  function onDown(e) {
    const h = hit(e);
    if (!h) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    if (h.lane !== world.sel) world.select?.(h.lane);
    const kind = world.tool;
    drag = { lane: h.lane, pos: h.pos, kind, y: h.y, cy: h.cy, id: e.pointerId };
    if (kind === 'strike') { world.excite(h.lane, 'strike', { pos: h.pos }); drag = null; }
    else if (kind === 'bow') world.excite(h.lane, 'bow', { pos: h.pos });
    else if (kind === 'touch') {
      // snap to the nearest low-order node
      let best = null;
      for (let n = 2; n <= 8; n++) for (let q = 1; q < n; q++) {
        const d = Math.abs(h.pos - q / n);
        if (d < 0.035 && (!best || n < best.n || (n === best.n && d < best.d))) best = { n, q, d };
      }
      world.excite(h.lane, 'touch', { pos: best ? best.q / best.n : h.pos, n: best ? best.n : 0 });
      drag = null;
    }
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) {
      hover = hit(e);
      canvas.style.cursor = hover ? (world.tool === 'pluck' ? 'grab' : 'pointer') : 'default';
      return;
    }
    const r = canvas.getBoundingClientRect();
    drag.y = e.clientY - r.top;
    if (drag.kind === 'bow') {
      const h = hit(e);
      if (h) world.bowMove?.(drag.lane, h.pos);
    }
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.kind === 'pluck') {
      const dy = drag.cy - drag.y;
      const amp = dy / (world.exag * pxPerM());
      world.excite(drag.lane, 'pluck', { pos: drag.pos, amp: Math.abs(dy) < 4 ? null : amp });
    } else if (drag.kind === 'bow') world.excite(drag.lane, 'bowStop', {});
    drag = null;
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => resize()); ro.observe(canvas); }

  return {
    draw,
    resize,
    relayout() { L = layout(); },
    resetScales() { scales.length = 0; histScale = 1e-9; hist.fill(0); },
    amplitudes: () => amps,
    dispose() { ro?.disconnect(); canvas.removeEventListener('pointerdown', onDown); },
  };
}

function fmt(v) {
  if (!isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e4 || (a < 1e-2 && a > 0)) return v.toExponential(1).replace('e+', 'e');
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}
