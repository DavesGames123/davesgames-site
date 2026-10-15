// WEATHER MAP · data/fronts.js — WPC coded surface bulletins (CODSUS) to
// plain front sets. No DOM. The parsers run in node on the fixtures in
// data/sample.
//
// Bulletin types (api.weather.gov products, product code COD):
//   ASUS01  analysis, low-res positions (location SUS)
//   ASUS02  analysis, hi-res positions (location SUS)
//   FSUS02  forecast, 12/24 h in one bulletin and 36/48 h in a second
//           bulletin issued a few minutes later (location SRP)
//
// Position tokens, west longitude positive in the bulletin:
//   4-5 digits  LLooo   lat 2 digits, lon 2-3 digits, whole degrees
//   7 digits    LLLoooo lat and lon in tenths (lon has a leading 0)
//   A lon over 180 is an east longitude (360 - lon).
// VALID token: MMDDHHZ in analyses, DDHHMMZ in forecasts. decodeValid
// takes the reading nearest to the issuance time.
//
// grep -n targets:
//   decodePos         one position token to [lat, lon]
//   decodeValid       VALID token to epoch ms
//   issuanceOf        issuance time from the WMO header and date line
//   parseCodsusAll    every section (analysis or each prog) of a bulletin
//   parseCodsus       the first section, CONTRACT shape
//   pickNewest        newest ids per wmoCollectiveId from a product list
//   loadFronts        live analysis + forecasts, sample fallback
//   frontsAt          held set for time t
//   frontsBracket     sets on each side of t and the fraction u (for morphs)

import { fetchJSON, cacheGet, cacheSet, readSample } from './net.js';

export const API = 'https://api.weather.gov';
export const FRONT_TYPES = ['COLD', 'WARM', 'STNRY', 'OCFNT', 'TROF'];
// DRYLINE and SQLN are rare extra types. They keep their own type name.
const LINE_KEYS = new Set([...FRONT_TYPES, 'DRYLINE', 'SQLN']);
const STRENGTHS = new Set(['WK', 'MDT', 'STG']);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const H = 3600000;

export function decodePos(tok) {
  if (!/^\d+$/.test(tok)) return null;
  let lat, lonW;
  if (tok.length === 4 || tok.length === 5) { lat = +tok.slice(0, 2); lonW = +tok.slice(2); }
  else if (tok.length === 7) { lat = +tok.slice(0, 3) / 10; lonW = +tok.slice(3) / 10; }
  else return null;
  if (lat > 90) return null;
  const lon = (lonW > 180 ? 360 - lonW : -lonW) + 0; // + 0 turns -0 into 0
  return [lat, lon];
}

// Issuance time: WMO header "ASUS01 KWBC 151627" gives day and UTC time;
// the date line "1226 PM EDT THU OCT 15 2026" gives month and year.
export function issuanceOf(text, fallback = Date.now()) {
  const wmo = /^[A-Z]{4}\d\d [A-Z]{4} (\d\d)(\d\d)(\d\d)/m.exec(text);
  const dl = /\b\d{3,4} [AP]M [A-Z]{3,4} [A-Z]{3} ([A-Z]{3}) (\d{1,2}) (\d{4})\b/.exec(text);
  if (!wmo) return fallback;
  const day = +wmo[1], hh = +wmo[2], mm = +wmo[3];
  let year, mon, lday;
  if (dl && MONTHS.includes(dl[1])) { mon = MONTHS.indexOf(dl[1]); lday = +dl[2]; year = +dl[3]; }
  else { const f = new Date(fallback); year = f.getUTCFullYear(); mon = f.getUTCMonth(); lday = f.getUTCDate(); }
  // The UTC day can be one day past the local date, across a month end.
  if (day < lday - 20) mon += 1; else if (day > lday + 20) mon -= 1;
  return Date.UTC(year, mon, day, hh, mm);
}

export function decodeValid(tok, ref) {
  const m = /^(\d\d)(\d\d)(\d\d)Z?$/.exec(tok);
  if (!m) return NaN;
  const a = +m[1], b = +m[2], c = +m[3];
  const r = new Date(ref), y = r.getUTCFullYear(), mo = r.getUTCMonth();
  const cands = [];
  // MMDDHH
  if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && c < 24) for (const dy of [-1, 0, 1]) cands.push(Date.UTC(y + dy, a - 1, b, c));
  // DDHHMM
  if (a >= 1 && a <= 31 && b < 24 && c < 60) for (const dm of [-1, 0, 1]) cands.push(Date.UTC(y, mo + dm, a, b, c));
  let best = NaN, bd = Infinity;
  for (const t of cands) {
    const d = t - ref;
    if (d < -48 * H || d > 240 * H) continue;
    if (Math.abs(d) < bd) { bd = Math.abs(d); best = t; }
  }
  return best;
}

function emptySet(valid, hour) { return { valid, hour, highs: [], lows: [], fronts: [], skipped: 0 }; }

function finishBlock(set, key, toks) {
  if (!key) return;
  if (key === 'HIGHS' || key === 'LOWS') {
    const out = key === 'HIGHS' ? set.highs : set.lows;
    for (let i = 0; i + 1 < toks.length; i += 2) {
      const hPa = +toks[i], p = decodePos(toks[i + 1]);
      if (!p || !(hPa >= 870 && hPa <= 1090)) { set.skipped++; continue; }
      out.push({ lat: p[0], lon: p[1], hPa });
    }
    if (toks.length % 2) set.skipped++;
    return;
  }
  const front = { type: key, pts: [] };
  let i = 0;
  while (i < toks.length && /^[A-Z]+$/.test(toks[i])) {
    if (STRENGTHS.has(toks[i])) front.strength = toks[i];
    else (front.tags ||= []).push(toks[i]);
    i++;
  }
  for (; i < toks.length; i++) {
    const p = decodePos(toks[i]);
    if (!p) { set.skipped++; continue; }
    const last = front.pts[front.pts.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue; // repeated point
    front.pts.push(p);
  }
  if (front.pts.length >= 2) set.fronts.push(front);
  else set.skipped++;
}

export function parseCodsusAll(text, opts = {}) {
  const ref = opts.issued ?? issuanceOf(text, opts.now ?? Date.now());
  const sets = [];
  let set = null, key = null, toks = [];
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const v = /^(?:(\d+)HR PROG )?VALID (\d{6}Z?)\b/.exec(line);
    if (v) {
      if (set) finishBlock(set, key, toks);
      key = null; toks = [];
      set = emptySet(decodeValid(v[2], ref), v[1] ? +v[1] : 0);
      sets.push(set);
      continue;
    }
    if (!set) continue;
    if (line.startsWith('$$')) { finishBlock(set, key, toks); key = null; toks = []; set = null; continue; }
    const parts = line.split(/\s+/);
    const head = parts[0];
    if (head === 'HIGHS' || head === 'LOWS' || LINE_KEYS.has(head)) {
      finishBlock(set, key, toks);
      key = head; toks = parts.slice(1);
    } else if (/^\d+$/.test(head) && key) {
      toks.push(...parts); // continuation line
    } else {
      finishBlock(set, key, toks); key = null; toks = [];
    }
  }
  if (set) finishBlock(set, key, toks);
  for (const s of sets) s.issued = ref;
  return sets;
}

export function parseCodsus(text, opts) {
  const all = parseCodsusAll(text, opts);
  return all[0] || emptySet(NaN, 0);
}

// Product list (@graph, newest first) -> newest n ids of one collective.
export function pickNewest(list, wmo, n = 1) {
  const g = (list && list['@graph']) || [];
  return g.filter(p => p.wmoCollectiveId === wmo)
    .sort((a, b) => Date.parse(b.issuanceTime) - Date.parse(a.issuanceTime))
    .slice(0, n);
}

// Merge forecast sections by valid time; the newer issuance wins.
export function mergeForecasts(sections) {
  const by = new Map();
  for (const s of sections) {
    if (!Number.isFinite(s.valid)) continue;
    const o = by.get(s.valid);
    if (!o || s.issued > o.issued) by.set(s.valid, s);
  }
  return [...by.values()].sort((a, b) => a.valid - b.valid);
}

async function productText(id, opts) {
  const p = await fetchJSON(`${API}/products/${id}`, opts);
  return { text: p.productText || '', issued: Date.parse(p.issuanceTime) };
}

export async function loadFrontsLive(opts = {}) {
  const [sus, srp] = await Promise.all([
    fetchJSON(`${API}/products/types/COD/locations/SUS`, opts),
    fetchJSON(`${API}/products/types/COD/locations/SRP`, opts).catch(() => null),
  ]);
  const a = pickNewest(sus, opts.hires ? 'ASUS02' : 'ASUS01', 1)[0];
  if (!a) throw new Error('no ASUS01 analysis in the product list');
  // The 12/24 h and 36/48 h progs come as two bulletins, a few minutes apart.
  const fIds = srp ? pickNewest(srp, 'FSUS02', 2) : [];
  const [an, ...fc] = await Promise.all([
    productText(a.id, opts),
    ...fIds.map(f => productText(f.id, opts).catch(() => null)),
  ]);
  const analysis = parseCodsus(an.text, { now: an.issued });
  if (!Number.isFinite(analysis.valid) || !analysis.fronts.length) throw new Error('analysis did not parse');
  const sections = [];
  for (const f of fc) if (f) sections.push(...parseCodsusAll(f.text, { now: f.issued }));
  const raw = { analysis: an.text, forecasts: fc.filter(Boolean).map(f => f.text) };
  return { analysis, forecasts: mergeForecasts(sections).filter(s => s.valid > analysis.valid), live: true, raw };
}

export async function loadFrontsSample(opts = {}) {
  const meta = JSON.parse(await readSample('manifest.json', opts));
  const analysis = parseCodsus(await readSample(meta.fronts.analysis, opts));
  const sections = [];
  for (const f of meta.fronts.forecasts) sections.push(...parseCodsusAll(await readSample(f, opts)));
  return { analysis, forecasts: mergeForecasts(sections).filter(s => s.valid > analysis.valid), live: false };
}

export async function loadFronts(opts = {}) {
  const hit = !opts.noCache && cacheGet('fronts');
  if (hit) return { ...hit, live: true, cached: true };
  try {
    const set = await loadFrontsLive(opts);
    delete set.raw;
    cacheSet('fronts', set);
    return set;
  } catch (e) {
    const error = String(e && e.message || e);
    // A failed refresh keeps the last set of this session before the sample.
    const stale = cacheGet('fronts', 12 * 3600 * 1000);
    if (stale) return { ...stale, live: false, stale: true, error };
    const set = await loadFrontsSample(opts);
    set.error = error;
    return set;
  }
}

function sequence(set) {
  if (!set) return [];
  return [set.analysis, ...(set.forecasts || [])].filter(s => s && Number.isFinite(s.valid)).sort((a, b) => a.valid - b.valid);
}

// The latest set with valid <= t; before the first set, the first set.
export function frontsAt(set, t) {
  const seq = sequence(set);
  if (!seq.length) return null;
  let held = seq[0];
  for (const s of seq) if (s.valid <= t) held = s;
  return held;
}

// { a, b, u }: a.valid <= t <= b.valid, u in 0..1. a === b at the ends.
export function frontsBracket(set, t) {
  const seq = sequence(set);
  if (!seq.length) return null;
  if (t <= seq[0].valid) return { a: seq[0], b: seq[0], u: 0 };
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i], b = seq[i + 1];
    if (t <= b.valid) return { a, b, u: (t - a.valid) / Math.max(1, b.valid - a.valid) };
  }
  const z = seq[seq.length - 1];
  return { a: z, b: z, u: 0 };
}
