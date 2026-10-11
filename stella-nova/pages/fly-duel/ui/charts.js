// ============================================================================
//  FLY DUEL  ·  training curves  (pure ES module + 2D canvas drawing)
// ----------------------------------------------------------------------------
//  Reads data/training-curve.json (package D) and the live progress
//  messages of train/worker.js, and draws win rate against games played.
//
//  The file shape belongs to package D. flattenRow() turns one checkpoint
//  into dotted keys ("A.vsRandom" -> 0.71), so any nesting works. A key
//  is a series when its values are numbers in [0, 1]. The x axis is the
//  first key of X_KEYS that the rows have.
//
//  GREP MAP
//      grep -n 'export function flattenRow'    nested object -> dotted keys
//      grep -n 'export function curveRows'     find the checkpoint array
//      grep -n 'export function toSeries'      rows -> series per key
//      grep -n 'export function seriesLabel'   readable name of a key
//      grep -n 'export function drawChart'     axes, chance line, series
//      grep -n 'export function evalVerdict'   held-out result as plain sentences
// ============================================================================

export const X_KEYS = ['games', 'game', 'episodes', 'step', 'checkpoint'];
export const SERIES_COL = ['#ff9a62', '#62c4ff', '#86dc7c', '#e889dc', '#ffd666', '#a8a4ff', '#ff6a6a', '#9de8b6'];

export function flattenRow(o, pre = '', out = {}) {
  if (o == null) return out;
  for (const [k, v] of Object.entries(o)) {
    const key = pre ? `${pre}.${k}` : k;
    if (typeof v === 'number') out[key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flattenRow(v, key, out);
  }
  return out;
}

export function curveRows(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (const k of ['checkpoints', 'points', 'curve', 'rows', 'history', 'data']) if (Array.isArray(json[k])) return json[k];
  for (const v of Object.values(json)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  return [];
}

// rows -> { xKey, series: [{ key, pts: [[x, y]] }] }. A rate key is one
// whose values all fall in [0, 1]. Counts (wins, losses) are left out.
export function toSeries(rows) {
  const flat = rows.map(r => flattenRow(r));
  const xKey = X_KEYS.find(k => flat.some(r => k in r)) || null;
  const keys = new Set();
  for (const r of flat) for (const k of Object.keys(r)) if (k !== xKey) keys.add(k);
  const series = [];
  for (const key of keys) {
    const pts = [];
    let ok = true;
    flat.forEach((r, i) => {
      if (!(key in r)) return;
      const y = r[key];
      if (!(y >= 0 && y <= 1)) ok = false;
      pts.push([xKey ? r[xKey] : i, y]);
    });
    if (ok && pts.length && !/(^|\.)(seed|n|time|ms|sec|wall|lr|gamma|temp)/i.test(key)) series.push({ key, pts });
  }
  return { xKey, series };
}

const SEG = { A: 'Fly A', B: 'Fly B', vsRandom: 'vs random bot', vsGreedy: 'vs greedy bot', AvsB: 'A vs B', winRateA: 'Fly A wins of A vs B', eval: 'eval' };
export function seriesLabel(key) {
  return key.split('.').map(k => SEG[k] ?? k.replace(/winRate/i, 'win rate')).join(' · ');
}

// Draw series on [0, 1]. opts: { xMax, chance: 0.5, title, hide: Set }.
export function drawChart(g, w, h, series, opts = {}) {
  g.clearRect(0, 0, w, h);
  const L = 34, R = 10, T = 10, B = 24;
  const pw = w - L - R, ph = h - T - B;
  let xMax = opts.xMax || 1;
  for (const s of series) for (const p of s.pts) xMax = Math.max(xMax, p[0]);
  const X = x => L + (x / xMax) * pw, Y = y => T + (1 - y) * ph;
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.fillStyle = '#8a91a5'; g.font = '11px system-ui,sans-serif';
  for (const y of [0, 0.25, 0.5, 0.75, 1]) {
    g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(L + pw, Y(y)); g.stroke();
    g.textAlign = 'right'; g.fillText(`${Math.round(y * 100)}%`, L - 4, Y(y) + 4);
  }
  g.textAlign = 'center';
  for (let i = 0; i <= 4; i++) { const x = (xMax * i) / 4; g.fillText(x >= 1000 ? `${(x / 1000).toFixed(x % 1000 ? 1 : 0)}k` : `${Math.round(x)}`, X(x), h - 6); }
  if (opts.chance != null) {
    g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.beginPath(); g.moveTo(L, Y(opts.chance)); g.lineTo(L + pw, Y(opts.chance)); g.stroke(); g.setLineDash([]);
  }
  series.forEach((s, i) => {
    if (opts.hide && opts.hide.has(s.key)) return;
    g.strokeStyle = s.col || SERIES_COL[i % SERIES_COL.length]; g.lineWidth = 2; g.beginPath();
    s.pts.forEach((p, j) => j ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])));
    g.stroke();
    if (s.pts.length < 40) { g.fillStyle = g.strokeStyle; for (const p of s.pts) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 2.4, 0, 7); g.fill(); } }
  });
  if (!series.length) { g.fillStyle = '#8a91a5'; g.textAlign = 'center'; g.fillText(opts.empty || 'no data yet', L + pw / 2, T + ph / 2); }
  g.textAlign = 'left';
}

// The plain verdict of the held-out test (meta.final of
// data/training-curve.json), as sentences. All numbers come from fin.
// A result is "above" or "below" a coin flip only when its 95% interval
// does not include 50%. Returns [] when fin has no rates.
export function evalVerdict(fin) {
  const out = [];
  const pc = v => `${Math.round(100 * v)}%`;
  const side = r => !r?.ci95 ? 0 : r.ci95[0] > 0.5 ? 1 : r.ci95[1] < 0.5 ? -1 : 0;
  const rA = fin?.vsRandom?.A, rB = fin?.vsRandom?.B, gA = fin?.vsGreedy?.A, gB = fin?.vsGreedy?.B, ab = fin?.AvsB;
  if (rA?.rate != null && rB?.rate != null)
    out.push(`Against the random player, Fly A won ${pc(rA.rate)} and Fly B won ${pc(rB.rate)} of the held-out games.`);
  if (gA?.rate != null && gB?.rate != null) {
    const both = side(gA) === -1 && side(gB) === -1;
    out.push(`Against the greedy bot, Fly A won ${pc(gA.rate)} and Fly B won ${pc(gB.rate)}.`
      + (both ? ' The flies lose most games to this short hand-written heuristic: they have not learned to beat it.' : ''));
  }
  if (ab?.rate != null) {
    const s = side(ab);
    out.push(`Fly A against Fly B: Fly A won ${pc(ab.rate)}`
      + (ab.ci95 ? ` (95% interval ${pc(ab.ci95[0])} to ${pc(ab.ci95[1])})` : '')
      + (s === 1 ? ', so Fly A is a little stronger.' : s === -1 ? ', so Fly B is a little stronger.' : ', not different from an even match.'));
  }
  return out;
}
