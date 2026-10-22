// ============================================================================
//  DARK MATTER HALO  ·  draw-charts.js — the line charts (2D canvas)
// ----------------------------------------------------------------------------
//  Pure drawing: each function takes a 2D context in CSS px, the box size
//  and a plain options object, and draws one chart. No DOM reads, so
//  saver.js draws the same charts into its own canvas.
//
//  Colours: PAL. The same values are CSS tokens in style.css, so the
//  legends and the equation symbols match the lines.
//
//  grep -n targets
//    palette ............... "export const PAL"
//    axes and ticks ........ "export function frame"
//    rotation curve ........ "export function drawCurve"
//    density profiles ...... "export function drawProfiles"
//    family curves ......... "export function drawFamilyCurves"
//    dark fraction ......... "export function drawFraction"
// ============================================================================

export const PAL = Object.freeze({
  bg: '#05070c', grid: 'rgba(255,255,255,0.07)', axis: 'rgba(255,255,255,0.28)', ink: '#e8eaf0', ink2: '#c2c7d4', dim: '#8a91a5',
  total: '#eef2f4', baryons: '#ffd666', halo: '#a8a4ff', bulge: '#ff9a62', thin: '#62c4ff', thick: '#a9dcff', hi: '#86dc7c', h2: '#4fd1b5',
  eilers: '#ffffff', jiao: '#f2a7ff', sun: '#ffe08a', gap: 'rgba(168,164,255,0.16)',
  fam: { nfw: '#a8a4ff', einasto: '#ff6f7d', burkert: '#ffb347', isothermal: '#5fd3c6' },
});
export const PART_LABEL = Object.freeze({ bulge: 'Bulge', thin: 'Thin disc', thick: 'Thick disc', hi: 'Atomic gas', h2: 'Molecular gas', baryons: 'All visible matter', halo: 'Dark halo', total: 'Total' });
const FONT = (px, w = 400) => `${w} ${px}px Inter, system-ui, -apple-system, sans-serif`;

const fmtTick = v => {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-2) { const e = Math.round(Math.log10(a)); return Math.abs(a / 10 ** e - 1) < 1e-6 ? `10^${e}` : v.toExponential(0); }
  return a < 1 ? String(+v.toPrecision(2)) : String(+v.toFixed(0));
};
const sup = s => s.replace(/\^(-?\d+)/, (_, e) => '' + [...e].map(c => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]).join(''));

// Axes in box {x, y, w, h}. xr, yr: [min, max]. opts: xlog, ylog,
// xticks, yticks (lists), xlabel, ylabel, fs (font px). Returns X(), Y().
export function frame(g, box, xr, yr, o = {}) {
  const fs = o.fs || 12;
  const L = (v, log) => log ? Math.log10(v) : v;
  const X = v => box.x + (L(v, o.xlog) - L(xr[0], o.xlog)) / (L(xr[1], o.xlog) - L(xr[0], o.xlog)) * box.w;
  const Y = v => box.y + box.h - (L(v, o.ylog) - L(yr[0], o.ylog)) / (L(yr[1], o.ylog) - L(yr[0], o.ylog)) * box.h;
  g.save();
  g.lineWidth = 1; g.font = FONT(fs); g.fillStyle = PAL.dim;
  g.strokeStyle = PAL.grid;
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const t of o.xticks || []) {
    const x = Math.round(X(t)) + 0.5;
    g.beginPath(); g.moveTo(x, box.y); g.lineTo(x, box.y + box.h); g.stroke();
    g.fillText(o.xlog ? sup(fmtTick(t)) : fmtTick(t), x, box.y + box.h + 5);
  }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const t of o.yticks || []) {
    const y = Math.round(Y(t)) + 0.5;
    g.beginPath(); g.moveTo(box.x, y); g.lineTo(box.x + box.w, y); g.stroke();
    g.fillText(o.ylog ? sup(fmtTick(t)) : fmtTick(t), box.x - 6, y);
  }
  g.strokeStyle = PAL.axis;
  g.beginPath(); g.moveTo(box.x + 0.5, box.y); g.lineTo(box.x + 0.5, box.y + box.h + 0.5); g.lineTo(box.x + box.w, box.y + box.h + 0.5); g.stroke();
  g.fillStyle = PAL.ink2;
  if (o.xlabel) { g.textAlign = 'right'; g.textBaseline = 'top'; g.fillText(o.xlabel, box.x + box.w, box.y + box.h + fs + 9); }
  if (o.ylabel) { g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(o.ylabel, box.x - (o.ylabelIn ? 0 : 4), box.y - 6); }
  g.restore();
  return { X, Y };
}

// A polyline through (xs[i], ys[i]) where ok(i); breaks where not.
function line(g, X, Y, xs, ys, ok = () => true) {
  g.beginPath();
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    if (!ok(i) || !Number.isFinite(ys[i])) { pen = false; continue; }
    const x = X(xs[i]), y = Y(ys[i]);
    if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
  }
  g.stroke();
}

function points(g, X, Y, table, color, shape, fs, xmax) {
  g.save();
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1;
  for (const p of table.rows) {
    if (p.R > xmax) continue;
    const x = X(p.R);
    g.globalAlpha = 0.7;
    g.beginPath(); g.moveTo(x, Y(p.v - p.lo)); g.lineTo(x, Y(p.v + p.hi)); g.stroke();
    g.globalAlpha = 1;
    const y = Y(p.v);
    if (shape === 'square') { g.lineWidth = 1.4; g.strokeRect(x - 3.2, y - 3.2, 6.4, 6.4); g.lineWidth = 1; }
    else { g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}

export function chartBox(w, h, fs, pad = {}) {
  const l = pad.l ?? Math.round(fs * 3.4), r = pad.r ?? 12, t = pad.t ?? Math.round(fs * 2), b = pad.b ?? Math.round(fs * 3.2);
  return { x: l, y: t, w: Math.max(10, w - l - r), h: Math.max(10, h - t - b) };
}

// The rotation curve. o: { curve, eilers, jiao, xmax, visibleOnly, parts,
// cursor (R or null), R0, fs, k (0..1 build-in for the saver) }.
export function drawCurve(g, w, h, o) {
  const fs = o.fs || (w < 520 ? 11 : 12), c = o.curve, xmax = o.xmax || 30, k = o.k ?? 1;
  const box = chartBox(w, h, fs);
  const ymax = 300;
  const { X, Y } = frame(g, box, [0, xmax], [0, ymax], { xticks: ticks(0, xmax, xmax > 40 ? 10 : 5), yticks: [0, 50, 100, 150, 200, 250, 300], xlabel: 'radius R from the centre, kpc', ylabel: 'circular speed, km/s', fs });
  const R = c.R, inX = i => R[i] <= xmax * k + 1e-9;
  g.save();
  g.beginPath(); g.rect(box.x, box.y - 2, box.w, box.h + 4); g.clip();
  // The gap between the visible-only curve and the total: the dark pull.
  g.fillStyle = o.visibleOnly ? 'rgba(168,164,255,0.22)' : PAL.gap;
  g.beginPath();
  let first = true;
  for (let i = 0; i < R.length; i++) if (inX(i)) { const x = X(R[i]), y = Y(Math.max(0, c.v.total[i])); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
  for (let i = R.length - 1; i >= 0; i--) if (inX(i)) g.lineTo(X(R[i]), Y(Math.max(0, c.v.baryons[i])));
  g.closePath(); g.fill();
  // Sun.
  g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,224,138,0.5)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(X(o.R0) + 0.5, box.y); g.lineTo(X(o.R0) + 0.5, box.y + box.h); g.stroke();
  g.setLineDash([]);
  if (o.parts) {
    g.lineWidth = 1.3;
    for (const id of ['bulge', 'thin', 'thick', 'hi', 'h2']) { g.strokeStyle = PAL[id]; g.globalAlpha = 0.85; line(g, X, Y, R, c.v[id], i => inX(i) && c.v[id][i] > 0); }
    g.globalAlpha = 1;
  }
  g.lineWidth = o.visibleOnly ? 2.6 : 2; g.strokeStyle = PAL.baryons; line(g, X, Y, R, c.v.baryons, inX);
  if (!o.visibleOnly) {
    g.lineWidth = 1.8; g.strokeStyle = PAL.halo; line(g, X, Y, R, c.v.halo, inX);
    g.lineWidth = 2.6; g.strokeStyle = PAL.total; line(g, X, Y, R, c.v.total, inX);
  }
  if (o.eilers) points(g, X, Y, o.eilers, PAL.eilers, 'dot', fs, xmax * k);
  if (o.jiao) points(g, X, Y, o.jiao, PAL.jiao, 'square', fs, xmax * k);
  g.restore();
  // Labels at the right end of the main lines.
  g.font = FONT(fs, 500); g.textAlign = 'left'; g.textBaseline = 'middle';
  // The Sun label sits at the foot of its line, clear of the axis title.
  g.fillStyle = PAL.sun; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('Sun', X(o.R0) + 4, box.y + box.h - 3);
  g.textBaseline = 'middle';
  if (o.visibleOnly) {
    const xm = Math.min(xmax * 0.72, 22), yb = at(R, c.v.baryons, xm), yt = at(R, c.v.total, xm);
    g.fillStyle = '#d4d1ff'; g.textAlign = 'center';
    g.fillText('missing pull', X(xm), Y((yb + yt) / 2));
  }
  // Cursor read-out.
  if (o.cursor != null && o.cursor > 0 && o.cursor <= xmax) {
    const x = X(o.cursor);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + 0.5, box.y); g.lineTo(x + 0.5, box.y + box.h); g.stroke();
    const rows = [['R', `${o.cursor.toFixed(1)} kpc`, PAL.ink]];
    if (!o.visibleOnly) rows.push(['total', kms(at(R, c.v.total, o.cursor)), PAL.total]);
    rows.push(['visible', kms(at(R, c.v.baryons, o.cursor)), PAL.baryons]);
    if (!o.visibleOnly) rows.push(['halo', kms(at(R, c.v.halo, o.cursor)), PAL.halo]);
    const near = nearestPoint([o.eilers, o.jiao].filter(Boolean), o.cursor);
    if (near) rows.push([near.who, `${near.p.v.toFixed(1)} km/s at ${near.p.R}`, near.color]);
    tip(g, x, box, rows, fs);
  }
}
const kms = v => `${v.toFixed(1)} km/s`;
function nearestPoint(tables, R) {
  let best = null;
  for (const t of tables) for (const p of t.rows) { const d = Math.abs(p.R - R); if (d < 0.5 && (!best || d < best.d)) best = { d, p, who: t.src === 'jiao23' ? 'Jiao 2023' : 'Eilers 2019', color: t.src === 'jiao23' ? PAL.jiao : PAL.eilers }; }
  return best;
}
function tip(g, x, box, rows, fs) {
  g.save();
  g.font = FONT(fs);
  const lh = fs + 5, wid = Math.max(...rows.map(r => g.measureText(r[0] + '  ' + r[1]).width)) + 18, hei = rows.length * lh + 10;
  let tx = x + 10; if (tx + wid > box.x + box.w) tx = x - 10 - wid;
  const ty = box.y + 6;
  g.fillStyle = 'rgba(8,10,18,0.92)'; g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.beginPath(); g.roundRect ? g.roundRect(tx, ty, wid, hei, 6) : g.rect(tx, ty, wid, hei); g.fill(); g.stroke();
  g.textBaseline = 'middle';
  rows.forEach((r, i) => { g.fillStyle = r[2]; g.textAlign = 'left'; g.fillText(r[0], tx + 9, ty + 5 + lh * (i + 0.5)); g.fillStyle = PAL.ink; g.textAlign = 'right'; g.fillText(r[1], tx + wid - 9, ty + 5 + lh * (i + 0.5)); });
  g.restore();
}
function at(R, arr, x) {
  if (x <= R[0]) return arr[0];
  for (let i = 1; i < R.length; i++) if (R[i] >= x) { const t = (x - R[i - 1]) / (R[i] - R[i - 1]); return arr[i - 1] + t * (arr[i] - arr[i - 1]); }
  return arr[R.length - 1];
}
function ticks(a, b, step) { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(+v.toFixed(6)); return out; }
const decades = (a, b) => { const out = []; for (let e = Math.ceil(Math.log10(a)); e <= Math.floor(Math.log10(b)); e++) out.push(10 ** e); return out; };

// rho(r) of each family, log-log. o: { profiles: [{ family, rho: Float64Array }],
// r, selected, R0, localBand: [lo, hi] Msun/pc^3, fs, k (inward reveal) }.
export function drawProfiles(g, w, h, o) {
  const fs = o.fs || (w < 520 ? 11 : 12);
  const box = chartBox(w, h, fs, { l: Math.round(fs * 3.6) });
  const xr = [0.1, 300], yr = [1e-7, 1e3];
  const { X, Y } = frame(g, box, xr, yr, { xlog: true, ylog: true, xticks: decades(...xr), yticks: decades(...yr).filter((_, i) => i % 2 === 0), xlabel: 'distance r from the centre, kpc', ylabel: 'dark matter density, Msun/pc³', fs });
  const rmin = o.k == null ? 0 : xr[1] * Math.pow(xr[0] / xr[1], o.k);
  g.save(); g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  // The Sun's radius and the measured local-density band.
  g.setLineDash([3, 4]); g.strokeStyle = 'rgba(255,224,138,0.5)';
  g.beginPath(); g.moveTo(X(o.R0) + 0.5, box.y); g.lineTo(X(o.R0) + 0.5, box.y + box.h); g.stroke(); g.setLineDash([]);
  if (o.localBand) {
    g.strokeStyle = PAL.sun; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X(o.R0), Y(o.localBand[0])); g.lineTo(X(o.R0), Y(o.localBand[1])); g.stroke();
  }
  for (const p of o.profiles) {
    const sel = p.family === o.selected;
    g.strokeStyle = PAL.fam[p.family]; g.lineWidth = sel ? 2.8 : 1.4; g.globalAlpha = sel ? 1 : 0.8;
    line(g, X, Y, o.r, p.rho, i => o.r[i] >= rmin && p.rho[i] > 0);
  }
  g.globalAlpha = 1;
  g.restore();
  g.font = FONT(fs, 500); g.fillStyle = PAL.sun; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillText('Sun', X(o.R0), box.y - 2);
  // Family labels at the left end, stacked by their value at the inner edge.
  const lab = o.profiles.map(p => ({ p, y: Y(Math.max(yr[0], Math.min(yr[1], p.rho[0]))) })).sort((a, b) => a.y - b.y);
  let last = -1e9;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  for (const l of lab) {
    if (o.k != null && o.k < 0.98) break;
    const y = Math.max(l.y, last + fs + 3); last = y;
    g.fillStyle = PAL.fam[l.p.family]; g.fillText(l.p.name || l.p.family, box.x + 8, Math.min(box.y + box.h - fs, Math.max(box.y + fs, y)));
  }
}

// v_total(r) of each family, with the spread between them shaded.
// o: { curves: [{ family, v }], R, baryons, eilers, jiao, selected, xmax, fs }.
export function drawFamilyCurves(g, w, h, o) {
  const fs = o.fs || (w < 520 ? 11 : 12), xmax = o.xmax || 100;
  const box = chartBox(w, h, fs);
  const { X, Y } = frame(g, box, [0, xmax], [0, 350], { xticks: ticks(0, xmax, 20), yticks: [0, 100, 200, 300], xlabel: 'radius, kpc', ylabel: 'circular speed, km/s', fs });
  const R = o.R, n = R.length;
  g.save(); g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.07)';
  g.beginPath();
  for (let i = 0; i < n; i++) { const v = Math.max(...o.curves.map(c => c.v[i])); i ? g.lineTo(X(R[i]), Y(v)) : g.moveTo(X(R[i]), Y(v)); }
  for (let i = n - 1; i >= 0; i--) g.lineTo(X(R[i]), Y(Math.min(...o.curves.map(c => c.v[i]))));
  g.closePath(); g.fill();
  g.setLineDash([5, 4]); g.strokeStyle = PAL.baryons; g.lineWidth = 1.5; line(g, X, Y, R, o.baryons); g.setLineDash([]);
  for (const c of o.curves) { const sel = c.family === o.selected; g.strokeStyle = PAL.fam[c.family]; g.lineWidth = sel ? 2.8 : 1.4; line(g, X, Y, R, c.v); }
  if (o.eilers) points(g, X, Y, o.eilers, PAL.eilers, 'dot', fs, xmax);
  if (o.jiao) points(g, X, Y, o.jiao, PAL.jiao, 'square', fs, xmax);
  g.restore();
}

// Enclosed dark fraction against r (log x). o: { r, fracs: [{ family, f }],
// selected, cosmic, marks: [{ r, label }], fs }.
export function drawFraction(g, w, h, o) {
  const fs = o.fs || (w < 520 ? 11 : 12);
  const box = chartBox(w, h, fs);
  const xr = [0.5, 300];
  const { X, Y } = frame(g, box, xr, [0, 1], { xlog: true, xticks: [1, 10, 100], yticks: [0, 0.25, 0.5, 0.75, 1], xlabel: 'radius of the sphere, kpc', ylabel: 'share of the mass inside that is dark', fs });
  g.save(); g.beginPath(); g.rect(box.x, box.y - 2, box.w, box.h + 4); g.clip();
  g.setLineDash([6, 5]); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(box.x, Y(o.cosmic)); g.lineTo(box.x + box.w, Y(o.cosmic)); g.stroke(); g.setLineDash([]);
  for (const f of o.fracs) { const sel = f.family === o.selected; g.strokeStyle = PAL.fam[f.family]; g.lineWidth = sel ? 2.8 : 1.3; g.globalAlpha = sel ? 1 : 0.75; line(g, X, Y, o.r, f.f); }
  g.globalAlpha = 1;
  g.restore();
  g.font = FONT(fs); g.fillStyle = PAL.ink2; g.textAlign = 'left'; g.textBaseline = 'bottom';
  g.fillText(`cosmic average ${(o.cosmic * 100).toFixed(0)} % (Planck 2018)`, box.x + 6, Y(o.cosmic) - 3);
  const sel = o.fracs.find(f => f.family === o.selected);
  for (const m of o.marks || []) {
    const v = at(o.r, sel.f, m.r), x = X(m.r), y = Y(v);
    g.fillStyle = PAL.fam[o.selected]; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = PAL.bg; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = PAL.ink; g.font = FONT(fs, 500); g.textBaseline = 'top';
    const txt = `${(v * 100).toFixed(0)} % inside ${m.label}`, right = x + 7 + g.measureText(txt).width > w - 4;
    g.textAlign = right ? 'right' : 'left';
    g.fillText(txt, right ? x - 7 : x + 7, y + 4);
  }
}
