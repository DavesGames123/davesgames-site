// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  tests-face.mjs — node tests-face.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks the face catalogue without a browser:
//    dials ..... dials.js knows every base, numeral style and track in
//                catalog.js, and paints every combination on a recording
//                mock context without throwing, without measureText, and
//                with every numeral style leaving marks
//    hands ..... every hour style and its minute pair is drawn by the kit
//                or by hands.js; each hands.js outline is a simple polygon
//                with its holes inside, reaches its tip, and stays slim,
//                at watch and clock lengths
//    picks ..... the catalogue's pick functions return listed values only
// ============================================================================
import * as CAT from './catalog.js';
import * as H from './hands.js';
import { dialPainter, KNOWN } from './dials.js';
import * as G from '../watch-movement/geom.js';
import { rng } from './generator.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ── dials ───────────────────────────────────────────────────────────────────
for (const [list, known, what] of [[CAT.DIAL_BASES, KNOWN.bases, 'base'], [CAT.NUMERALS, KNOWN.numerals, 'numeral style'], [CAT.TRACKS, KNOWN.tracks, 'track']]) {
  const missing = list.filter(x => !known.includes(x));
  ok(missing.length === 0, `dials.js paints every ${what} in the catalogue`, missing.length ? 'missing ' + missing.join(', ') : `${list.length}`);
}
// a mock 2D context that records drawing and refuses measureText
function mockCtx() {
  const rec = { text: 0, fills: 0, strokes: 0, fontSet: false, textWithoutFont: 0, measure: 0 };
  const grad = { addColorStop() {} };
  const g = new Proxy({}, {
    get(t, k) {
      if (k === 'rec') return rec;
      if (k === 'measureText') return () => { rec.measure++; return { width: 1 }; };
      if (k === 'fillText') return () => { rec.text++; if (!rec.fontSet) rec.textWithoutFont++; };
      if (k === 'fill' || k === 'fillRect') return () => { rec.fills++; };
      if (k === 'stroke') return () => { rec.strokes++; };
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { if (k === 'font') rec.fontSet = true; t[k] = v; return true; },
  });
  return g;
}
{
  let errors = [], measure = 0, noFont = 0, blank = [], n = 0;
  const face = (base, numerals, track) => ({ base, numerals, track, brand: 'Test Maker', accent: '#b0402e' });
  for (const base of CAT.DIAL_BASES) for (const numerals of CAT.NUMERALS) for (const track of CAT.TRACKS) for (const o of [{}, { sub: [10.25, 3.95] }, { aperture: [9.6, 7] }]) {
    for (const R of [12.9, 18.6, 130]) {
      const g = mockCtx(); n++;
      try { dialPainter(face(base, numerals, track), { ...o, line: 'CAPTION' })(g, R); } catch (e) { errors.push(`${base}/${numerals}/${track}: ${e.message}`); continue; }
      measure += g.rec.measure; noFont += g.rec.textWithoutFont;
      if (g.rec.fills + g.rec.text + g.rec.strokes < 10) blank.push(`${base}/${numerals}/${track}`);
    }
  }
  ok(errors.length === 0, 'every base x numerals x track x seconds paints', errors.length ? errors.slice(0, 3).join('; ') : `${n} dials`);
  ok(measure === 0, 'no dial calls measureText (wrong under the dialFace font proxy)', `${measure} calls`);
  ok(noFont === 0, 'no text is drawn before a font is set', `${noFont}`);
  ok(blank.length === 0, 'every dial leaves marks', blank.slice(0, 3).join(', '));
  // each numeral style draws something of its own on a plain enamel dial
  const quiet = CAT.NUMERALS.filter(nm => { const g = mockCtx(); dialPainter(face('enamel', nm, 'none'), {})(g, 18); const ref = mockCtx(); dialPainter({ ...face('enamel', nm, 'none'), numerals: 'none-at-all' }, {})(ref, 18); return g.rec.text + g.rec.fills <= ref.rec.text + ref.rec.fills; });
  ok(quiet.length === 0, 'every numeral style marks the hours', quiet.join(', '));
}

// ── hands ───────────────────────────────────────────────────────────────────
function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (G.segX(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
  }
  return false;
}
const area = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
{
  const styles = new Set([...CAT.HAND_STYLES, ...CAT.HAND_STYLES.map(H.minuteFor), ...CAT.HAND_STYLES.map(H.forClock), ...CAT.HAND_STYLES.map(s => H.minuteFor(H.forClock(s)))]);
  const undrawn = [...styles].filter(s => !H.KIT_STYLES.includes(s) && !H.EXTRA[s]);
  ok(undrawn.length === 0, 'every hand style (and its minute and clock pair) is drawable', undrawn.join(', ') || `${styles.size} styles`);
  const noWidth = [...styles].filter(s => !H.HAND_W[s] && s !== 'needle');
  ok(noWidth.length === 0, 'every hand style has a width share', noWidth.join(', '));
  const bad = [];
  for (const name of Object.keys(H.EXTRA)) for (const L of [6.4, 10.2, 14.6, 66, 120]) for (const k of [1, 1.4]) {
    const w = L * (H.HAND_W[name] || 0.04) * k, parts = H.EXTRA[name](L, w);
    if (!parts.length) { bad.push(`${name}: empty`); continue; }
    let maxY = -Infinity, maxX = 0;
    for (const [out, holes] of parts) {
      if (out.length < 3 || out.some(p => !isFinite(p[0]) || !isFinite(p[1]))) { bad.push(`${name}@${L}: bad outline`); continue; }
      if (selfIntersects(out)) bad.push(`${name}@${L}: outline crosses itself`);
      if (area(out) < 1e-6) bad.push(`${name}@${L}: zero area`);
      for (const h of holes) {
        if (selfIntersects(h)) bad.push(`${name}@${L}: hole crosses itself`);
        if (!h.every(p => G.inPoly(p, out))) bad.push(`${name}@${L}: hole leaves its outline`);
        if (G.polysOverlap(h, out) && h.some(p => !G.inPoly(p, out))) bad.push(`${name}@${L}: hole cuts the edge`);
      }
      for (const p of out) { maxY = Math.max(maxY, p[1]); maxX = Math.max(maxX, Math.abs(p[0])); }
    }
    if (Math.abs(maxY - L) > L * 0.05) bad.push(`${name}@${L}: tip at ${maxY.toFixed(2)}, not ${L}`);
    if (maxX > L * 0.3) bad.push(`${name}@${L}: ${maxX.toFixed(2)} wide`);
  }
  ok(bad.length === 0, 'hands.js outlines are simple, holed inside, tipped and slim', bad.slice(0, 4).join('; ') || `${Object.keys(H.EXTRA).length} styles x 10 sizes`);
}

// ── picks ───────────────────────────────────────────────────────────────────
{
  const R = rng('catalog'), seen = { base: new Set(), num: new Set(), track: new Set(), hand: new Set() }, off = [];
  for (let i = 0; i < 6000; i++) {
    const era = ['old', 'classic', 'modern'][i % 3], clock = i % 7 === 0;
    const b = CAT.pickBase(R, era), nm = CAT.pickNumerals(R, era, clock, b), t = CAT.pickTrack(R, era), h = CAT.pickHands(R, era);
    seen.base.add(b); seen.num.add(nm); seen.track.add(t); seen.hand.add(h);
    if (!CAT.DIAL_BASES.includes(b) || !CAT.NUMERALS.includes(nm) || !CAT.TRACKS.includes(t) || !CAT.HAND_STYLES.includes(h)) off.push(`${b}/${nm}/${t}/${h}`);
  }
  ok(off.length === 0, 'picks return listed values only', off.slice(0, 3).join(', '));
  ok(seen.base.size === CAT.DIAL_BASES.length && seen.num.size === CAT.NUMERALS.length && seen.track.size === CAT.TRACKS.length && seen.hand.size === CAT.HAND_STYLES.length,
    'every listed base, numeral style, track and hand style can be picked', `${seen.base.size}/${CAT.DIAL_BASES.length} bases, ${seen.num.size}/${CAT.NUMERALS.length} numerals, ${seen.track.size}/${CAT.TRACKS.length} tracks, ${seen.hand.size}/${CAT.HAND_STYLES.length} hands`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
