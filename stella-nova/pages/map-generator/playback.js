// playback.js — the animation of how a city was made, from its event log.
//
// gen.js makes the whole city first, fast, and writes city.events: the
// order in which the generator made each thing. timeline(city) gives each
// thing a start time and a length (s at speed 1), phase by phase, in that
// order. The 2D view (draw2d.js), the 3D view (mesh3d.js puts the times in
// the vertices) and the saver all play the same timeline.
//
// PHASES and their share of the time (s):
//   field 2.2  coast 1.6  river 1.8  main 3.2  major 5  parks 1.4
//   minor 8    blocks 2.6  lots 4.2  buildings 4.4
// A road takes a time in proportion to its length, so it draws at about
// the same pen speed as the other roads of its class. The items of a phase
// start one after another and overlap.
//
// timeline(city) -> tl = { dur, phases: [{k, t0, t1}],
//   field, coast, river: [t0, d],
//   roads: { main|major|minor|coast|river: Float32Array [t0, d, ..] },
//   parks, blocks, lots, buildings: Float32Array [t0, d, ..] }
// prog(a, i, T)  0..1, the progress of item i at time T
// frameAt(city, tl, T) -> what shows at T: { roads: {cls: [partial line]},
//   parks, blocks, lots: [polygon], buildings: [{lot, h}], field: alpha,
//   coast, river: 0..1, phase }  At T >= tl.dur it equals the city.
//
// grep: export const PHASES  export function timeline  export function frameAt  function cut

export const PHASES = [
  ['field', 2.2, 'tensor field'], ['coast', 1.6, 'coastline'], ['river', 1.8, 'river'],
  ['main', 3.2, 'main roads'], ['major', 5.0, 'major roads'], ['parks', 1.4, 'parks'],
  ['minor', 8.0, 'minor roads'], ['blocks', 2.6, 'blocks'], ['lots', 4.2, 'lots'],
  ['buildings', 4.4, 'buildings'],
];

const lenOf = (l) => {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
};

// Times for n items in a phase of length B starting at p0. w[i] is the
// relative length of item i (0..1); a long item takes longer.
function spread(n, p0, B, w, minFrac = 0.18, maxFrac = 0.45) {
  const a = new Float32Array(2 * n);
  if (!n) return a;
  for (let i = 0; i < n; i++) {
    const d = B * (minFrac + (maxFrac - minFrac) * (w ? w[i] : 0.5));
    const t = n === 1 ? p0 : p0 + (B - d) * (i / (n - 1));
    a[2 * i] = t; a[2 * i + 1] = Math.max(d, 1e-3);
  }
  return a;
}

export function timeline(city) {
  // the order of the items comes from the event log
  const order = { main: [], major: [], minor: [], parks: [], blocks: [], lots: [], buildings: [] };
  let hasCoast = false, hasRiver = false;
  for (const e of city.events) {
    if (e.k === 'road') order[e.cls].push(e.i);
    else if (e.k === 'parks') order.parks.push(e.i);
    else if (e.k === 'block') order.blocks.push(e.i);
    else if (e.k === 'lots') order.lots.push(e);
    else if (e.k === 'building') order.buildings.push(e.i);
    else if (e.k === 'coast') hasCoast = true;
    else if (e.k === 'river') hasRiver = true;
  }
  const tl = { phases: [], roads: {} };
  let t = 0;
  for (const [k, B] of PHASES) {
    const p0 = t;
    if (k === 'field') tl.field = [p0, B];
    else if (k === 'coast') { if (!hasCoast) continue; tl.coast = [p0, B]; tl.roads.coast = spread(city.roads.coast.length, p0, B, null, 0.8, 0.8); }
    else if (k === 'river') { if (!hasRiver) continue; tl.river = [p0, B]; tl.roads.river = spread(city.roads.river.length, p0, B, null, 0.8, 0.8); }
    else if (k === 'main' || k === 'major' || k === 'minor') {
      const lines = city.roads[k];
      const ids = order[k];
      if (!ids.length) { tl.roads[k] = new Float32Array(0); continue; }
      const L = ids.map((i) => lenOf(lines[i]));
      const mx = Math.max(...L, 1);
      const s = spread(ids.length, p0, B, L.map((x) => x / mx), k === 'minor' ? 0.05 : 0.2, k === 'minor' ? 0.22 : 0.5);
      const a = new Float32Array(2 * lines.length);
      ids.forEach((id, j) => { a[2 * id] = s[2 * j]; a[2 * id + 1] = s[2 * j + 1]; });
      tl.roads[k] = a;
    } else if (k === 'parks' || k === 'blocks' || k === 'buildings') {
      const ids = order[k];
      const n = k === 'parks' ? city.parks.length : k === 'blocks' ? city.blocks.length : city.buildings.length;
      const s = spread(ids.length, p0, B, null, k === 'buildings' ? 0.12 : 0.25, k === 'buildings' ? 0.12 : 0.25);
      const a = new Float32Array(2 * n);
      ids.forEach((id, j) => { a[2 * id] = s[2 * j]; a[2 * id + 1] = s[2 * j + 1]; });
      tl[k] = a;
      if (!ids.length) continue;
    } else if (k === 'lots') {
      const groups = order.lots;
      const s = spread(groups.length, p0, B, null, 0.15, 0.15);
      const a = new Float32Array(2 * city.lots.length);
      groups.forEach((g, j) => { for (let i = g.from; i < g.from + g.n; i++) { a[2 * i] = s[2 * j]; a[2 * i + 1] = s[2 * j + 1]; } });
      tl.lots = a;
      if (!groups.length) continue;
    }
    t = p0 + B;
    tl.phases.push({ k, t0: p0, t1: t });
  }
  for (const k of ['coast', 'river']) if (!tl.roads[k]) tl.roads[k] = new Float32Array(0);
  for (const k of ['parks', 'blocks', 'lots', 'buildings']) if (!tl[k]) tl[k] = new Float32Array(0);
  tl.dur = t;
  return tl;
}

export function prog(a, i, T) {
  const d = a[2 * i + 1];
  const x = (T - a[2 * i]) / (d || 1e-3);
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

export function phaseAt(tl, T) {
  for (const p of tl.phases) if (T < p.t1) return p.k;
  return 'done';
}

// The first f (0..1) of a line, by length. f = 1 returns the line itself.
export function cut(l, f) {
  if (f >= 1) return l;
  if (f <= 0 || l.length < 2) return [];
  const total = lenOf(l);
  let left = total * f;
  const out = [l[0]];
  for (let i = 1; i < l.length; i++) {
    const s = Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    if (s >= left) {
      const k = s ? left / s : 0;
      out.push([l[i - 1][0] + (l[i][0] - l[i - 1][0]) * k, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * k]);
      return out;
    }
    out.push(l[i]);
    left -= s;
  }
  return out;
}

const ease = (x) => x * x * (3 - 2 * x);

export function frameAt(city, tl, T) {
  if (T >= tl.dur) T = Infinity;   // the end is the whole city, whatever the float32 rounding
  const f = { roads: {}, parks: [], blocks: [], lots: [], buildings: [], lotIds: [] };
  for (const k of ['coast', 'river', 'main', 'major', 'minor']) {
    const a = tl.roads[k] || [];
    f.roads[k] = city.roads[k].map((l, i) => cut(l, prog(a, i, T))).filter((l) => l.length > 1);
  }
  f.coast = tl.coast ? Math.min(1, Math.max(0, (T - tl.coast[0]) / tl.coast[1])) : 0;
  f.river = tl.river ? Math.min(1, Math.max(0, (T - tl.river[0]) / tl.river[1])) : 0;
  f.parks = city.parks.filter((_, i) => prog(tl.parks, i, T) > 0);
  f.blocks = city.blocks.filter((_, i) => prog(tl.blocks, i, T) > 0);
  city.lots.forEach((l, i) => { if (prog(tl.lots, i, T) > 0) { f.lots.push(l); f.lotIds.push(i); } });
  city.buildings.forEach((b, i) => {
    const p = prog(tl.buildings, i, T);
    if (p > 0) f.buildings.push({ lot: city.lots[i], h: b.h * ease(p), i });
  });
  // the field: in over its phase, then it fades while the roads draw
  const fp = Math.min(1, Math.max(0, (T - tl.field[0]) / tl.field[1]));
  const minorEnd = (tl.phases.find((p) => p.k === 'minor') || { t1: tl.dur }).t1;
  const fade = Math.min(1, Math.max(0, (T - tl.field[1]) / Math.max(minorEnd - tl.field[1], 1e-3)));
  f.field = T === Infinity ? 0 : fp * (1 - 0.85 * fade);
  f.phase = phaseAt(tl, T);
  return f;
}
