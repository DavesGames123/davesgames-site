// ============================================================================
//  ALPHA QUDITS  ·  saver/plan.js  ·  what the saver shows, and where (DOM-free)
// ----------------------------------------------------------------------------
//  saver/index.js draws. This module decides the shot order, the frame box
//  and the label plate, so node tests can check them at 16:9 and at 9:16.
//
//  A SHOT is one entry of a package's saverShots, tagged with its package:
//    { pkg, id, scene, params, seconds, title, caption, tex, aspect?, t0? }
//  STRANDS and COMPARE draw a shot with renderShot(g, shot, t, box). ENDS
//  and RECORDS draw it with a fill figure (createEnds / createRecords with
//  fill: true); saver/index.js copies that canvas into the box.
//
//  THE PLATE. Each cut calls opts.label(plateFor(shot, facts)) once:
//    title, sub     the shot title, and the analogy it belongs to
//    tex, rules     the shot's TeX, coloured with the page m1..m6 classes
//    params         live values that MODEL computes at enter time
//    lines          the caption, the stance line, the credit
//    code           a short extract of model/*.js, cut at run time from the
//                   real source file (CODE + extractCode), never a copy
//
//  grep -n targets
//    seeded random ........ "export function rng"
//    shot list ............ "export function collectShots"
//    seeded plan .......... "export function shotPlan"
//    frame box ............ "export function frameBox"
//    code extracts ........ "export const CODE"   "export function extractCode"
//    plate ................ "export function plateFor"
//    live values .......... "export function modelFacts"
// ============================================================================

export const PKGS = Object.freeze(['strands', 'ends', 'records', 'compare']);

// The analogy that each package and scene shows (CONTRACT.md "Analogies").
export const SUBS = Object.freeze({
  strands: 'Analogy 1: threads',
  'ends:gears': 'Analogy 2: mirror gears',
  'ends:bloch': 'Analogy 2: the qubit end',
  'ends:qutrit': 'Analogy 2: the qutrit end',
  'ends:locks': 'Analogy 3: locks and keys',
  'ends:charge': 'The charge at the (2, 3) link',
  records: 'Analogy 4: mirrors and drum modes',
  'compare:roles': 'Analogy 5: a correspondence of roles',
  'compare:dials': 'Analogy 6: dials',
  compare: 'Against the measurements',
});

// STRANDS shots carry no caption: these say what each one shows.
export const STRANDS_CAPTIONS = Object.freeze({
  'strands-pair-4': 'Two ququarts as four threads, each of amplitude 1/2.',
  'strands-pair-32': 'A qutrit and a qubit share two threads. The third qutrit direction meets none.',
  'strands-swap-3': 'Distilling the middle pair re-ties the threads: the outer ends become a pair, at 1/3.',
  'strands-swap-2': 'The same swap for qubits: the outer ends become a pair, at 1/2.',
  'strands-read-qutrit': 'A read at the qutrit end sends each basis element down the threads to the qubit.',
  'strands-read-qubit': 'A read at the qubit end: the far end gets the conjugate on the shared directions.',
  'strands-shared': 'One qudit at the end of several links, drawn as one copy per link.',
  'strands-object-knot': 'The object: a shared qutrit with three links to qubits, two of them read.',
  'strands-object-paths': 'A route between the read qubits crosses three threads: 1/√2 · 1/√3 · 1/√2.',
  'strands-object-terms': 'The joint state has 3 · 2 · 2 = 12 terms of amplitude 1/(2√3).',
  'strands-object-mirror': 'Both exchanges act as the mirror of the drawing.',
});

export const STANCE = 'Conjecture 1 of the paper: the match with α(0) is proposed, not derived.';
export const CREDIT = 'After A. D. Wissner-Gross, 2026 preprint. Our drawings; counts recomputed in model/.';

// Colour rules for the plate TeX (lib/sci.css classes, NOTES.md): m1 qubit,
// m2 qutrit, m3 records and weights, m4 charge, m5 alpha, m6 readout N.
export const RULES = Object.freeze([
  ['\\alpha^{-1}_{\\mathrm{cand}}', 'm5'], ['\\alpha_{\\mathrm{cand}}', 'm5'], ['\\alpha_W', 'm5'],
  ['\\sigma_x', 'm1'], ['\\sigma_y', 'm1'], ['\\sigma_z', 'm1'], ['\\sigma_\\mu', 'm1'], ['\\sigma_\\nu', 'm1'],
  ['\\omega_m', 'm3'], ['\\omega_d', 'm3'], ['\\Omega', 'm3'], ['\\sqrt{k_r}', 'm3'],
  ['\\mathfrak{su}(3)', 'm2'], ['\\mathfrak{su}(2)', 'm1'], ['\\mathfrak{u}(1)', 'm4'],
]);

// Seeded random in [0, 1) (mulberry32).
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// mods: { strands: module, ends: module, ... }; a missing package is left
// out. STRANDS exports SAVER_SHOTS, the others saverShots.
export function collectShots(mods) {
  const out = [];
  for (const pkg of PKGS) {
    const m = mods[pkg];
    const list = m && (m.saverShots || m.SAVER_SHOTS);
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      if (!s || !s.id || !s.scene) continue;
      out.push({ ...s, params: { ...(s.params || {}) }, pkg, title: s.title || s.label || s.id,
        caption: s.caption || STRANDS_CAPTIONS[s.id] || '', seconds: +s.seconds || 8 });
    }
  }
  return out;
}

// Seconds on screen: the package's length, a little longer when calm,
// always 5 to 12 s (PAGES.md step 9).
export const shotSeconds = (s, calm = 0.7) => Math.max(5, Math.min(12, Math.round(s.seconds * (0.9 + 0.3 * calm) * 10) / 10));

// A plan of n shots. Each run through the list is a seeded shuffle of all
// shots, reordered so that two shots of one package do not follow each
// other when another package is left; no shot repeats across a seam.
export function shotPlan(shots, seed = 1, n = 120, calm = 0.7) {
  if (!shots.length) return [];
  const r = rng(seed), out = [];
  let prev = null;
  while (out.length < n) {
    const bag = [...shots];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    while (bag.length) {
      let j = bag.findIndex(s => !prev || (s.pkg !== prev.pkg && s.id !== prev.id));
      if (j < 0) j = bag.findIndex(s => !prev || s.id !== prev.id);
      if (j < 0) j = 0;
      const s = bag.splice(j, 1)[0];
      out.push({ ...s, sec: shotSeconds(s, calm) });
      prev = s;
    }
  }
  return out.slice(0, n);
}

// The box a shot draws in, in a w x h frame (CSS px). band = { t, b, w }
// from plateBand(h) (lib/saver-clear.js), or null for no plate. band.w is
// the plate width: the 9:16 column when the iframe is wider than it.
export function frameBox(w, h, band = null) {
  const colW = Math.min(w, (band && band.w) || w), x0 = (w - colW) / 2;
  const top = band ? band.t : 0, bh = Math.max(60, h - top - (band ? band.b : 0));
  const mx = Math.max(10, colW * 0.03), my = Math.max(6, bh * 0.03);
  return { x: x0 + mx, y: top + my, w: Math.max(40, colW - 2 * mx), h: Math.max(40, bh - 2 * my) };
}

// The code extract for a shot: { file, fn } in model/. The scene picks it;
// a shot id can pick its own.
export const CODE = Object.freeze({
  'strands:pair': { file: 'states.js', fn: 'pairKet' },
  'strands:swap': { file: 'states.js', fn: 'swapping' },
  'strands:read': { file: 'states.js', fn: 'transposeIdentity' },
  'strands:shared': { file: 'states.js', fn: 'strandAmplitude' },
  'strands:object': { file: 'states.js', fn: 'strandAmplitude' },
  'ends:gears': { file: 'states.js', fn: 'transposeIdentity' },
  'ends:bloch': { file: 'letters.js', fn: 'commutatorLetter' },
  'ends:qutrit': { file: 'letters.js', fn: 'clockShift' },
  'ends:locks': { file: 'configs.js', fn: 'readCap' },
  'ends:charge': { file: 'algebra.js', fn: 'hypercharge' },
  'records:square': { file: 'configs.js', fn: 'readoutDimension' },
  'records:mirror': { file: 'records.js', fn: 'sectors' },
  'records:modes': { file: 'records.js', fn: 'sectors' },
  'records:grid': { file: 'records.js', fn: 'sectors' },
  'records:abacus': { file: 'value.js', fn: 'weighNumerator' },
  'compare:ruler': { file: 'data.js', fn: 'sigma' },
  'compare:digits': { file: 'exact.js', fn: 'isqrt' },
  'compare:dials': { file: 'value.js', fn: 'value' },
  'compare:lookElsewhere': { file: 'look-elsewhere.js', fn: 'smoothDenominators' },
  'compare:roles': { file: 'value.js', fn: 'weighNumerator' },
  'compare:history': { file: 'exact.js', fn: 'inverseDigits' },
});
export const codeFor = s => CODE[s.pkg + ':' + s.scene] || null;
export const CODE_LINES = 12; // the plate shows at most 12 lines (lib/screensaver.js)

// Cut function fn out of the source text src: from its "function fn(" line
// to the first closing brace at column 0, at most max lines. A longer body
// ends with a "// ..." line. Returns null when fn is not in src.
export function extractCode(src, fn, max = CODE_LINES) {
  const lines = String(src).split('\n');
  const re = new RegExp('^(export\\s+)?function\\s+' + fn + '\\s*\\(');
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) return null;
  const body = [];
  for (let j = i; j < lines.length; j++) {
    body.push(lines[j].replace(/\s+$/, ''));
    if (j > i && lines[j] === '}') break;
    if (j === i && /\}\s*$/.test(lines[j]) && !/\{\s*$/.test(lines[j])) break; // a one-line body
  }
  if (body.length > max) { body.length = max - 1; body.push('  // ...'); }
  return body.join('\n');
}

// Live values from MODEL, computed once at enter: the candidate digits, N
// and its three factors, the record count, the hypercharge on the link.
export function modelFacts(M) {
  if (!M) return null;
  try {
    const v = M.value();
    const recs = M.buildRecords();
    const unread = M.readoutDimension({ center: 3, far: [], unread: 2 });
    const read = M.readoutDimension({ center: 3, far: [2], unread: 0 });
    const y = M.hypercharge().onLink;
    return { inv: v.inverseDigits(15), N: v.N, unread, read, records: recs.length, y: y[0] + '/' + y[1] };
  } catch (e) { return null; }
}

function paramsFor(s, f) {
  if (!f) return [];
  const inv = { sym: '\\alpha^{-1}_{\\mathrm{cand}}', name: 'the paper’s candidate', value: f.inv + '…', cls: 'm5' };
  const N = { sym: 'N', name: 'readout dimension', value: `${f.N} = ${f.unread} · ${f.read} · ${f.read}`, cls: 'm6' };
  const R = { sym: 'R', name: 'records', value: String(f.records), cls: 'm3' };
  if (s.pkg === 'compare' || (s.pkg === 'records' && s.scene === 'abacus')) return [inv];
  if (s.pkg === 'records') return [R, N];
  if (s.pkg === 'ends' && s.scene === 'charge') return [{ sym: 'Y', name: 'hypercharge on the link', value: f.y, cls: 'm4' }];
  if (s.pkg === 'strands' && s.scene === 'object') return [N];
  return [];
}

// The label plate for a shot (lib/screensaver.js "label plate (poster)").
// code: the extract text, or null. facts: modelFacts() or null.
export function plateFor(s, { code = null, facts = null } = {}) {
  const sub = SUBS[s.pkg + ':' + s.scene] || SUBS[s.pkg] || '';
  const lines = [];
  if (s.caption) lines.push(s.caption);
  if (s.pkg === 'compare' || (s.pkg === 'records' && s.scene === 'abacus')) lines.push(STANCE);
  lines.push(CREDIT);
  const tex = Array.isArray(s.tex) ? s.tex.filter(Boolean) : s.tex ? [s.tex] : [];
  const info = { title: s.title, sub, tex, rules: RULES.filter(([sym]) => tex.some(t => t.includes(sym))), lines, params: paramsFor(s, facts) };
  const c = codeFor(s);
  if (code && c) info.code = { lang: 'js', name: `model/${c.file} · ${c.fn}()`, text: code };
  return info;
}

// Legibility. A shot whose subject must shrink below MIN_SCALE of its own
// layout size to fit the box (a short band on a phone, a long plate) is
// skipped at the cut. pickLegible(plan, i, scaleOf) returns the first index
// from i on, within one run of the plan, whose shot is legible; when no
// shot is, it returns i, so the saver still shows something.
export const MIN_SCALE = 0.55;
export function pickLegible(plan, i, scaleOf, max = plan.length) {
  for (let n = 0; n < Math.min(max, plan.length); n++) {
    const s = plan[(i + n) % plan.length];
    if (scaleOf(s) >= MIN_SCALE) return i + n;
  }
  return i;
}
