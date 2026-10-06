// ============================================================================
//  LOSE THE MODIFIER  ·  matcher.js — find weak phrases (no DOM)
// ----------------------------------------------------------------------------
//  Pure functions over the entries of phrases.js. main.js, paste.js,
//  saver.js and tests.mjs import them. Nothing here touches the page.
//
//  stem(word)            a light suffix stripper: tired, tires, tiring all
//                        give "tir". The same rule runs on both sides of a
//                        compare, so the stems only have to agree, not be
//                        real roots.
//  lookup(q, entries)    ranked matches for what the user types:
//                        the full phrase, the phrase with other inflections,
//                        the base word alone ("tired"), any intensifier plus
//                        a known base ("awfully tired"), a strong word
//                        (reverse), a prefix while typing, one-letter typos.
//  buildScan(entries)    the token index for scan().
//  scan(text, idx)       every weak phrase in a paragraph, as spans.
//                        exact spans (same word forms as the entry) can be
//                        replaced; a stem-only span (walks slowly against
//                        walked slowly) is shown, not replaced.
//  fixText(text, spans)  the text with every fixable span replaced by its
//                        first target; keeps capitals, mends a / an.
//
//  grep -n targets
//    "function stem("       the suffix stripper
//    "function lookup("     the ranked live search
//    "function scan("       the paragraph scanner
//    "function fixText("    the fix-all rewrite
//    "const INTENS"         the intensifiers that alias to "very"
// ============================================================================

// Intensifiers that the data does not hold as a family of their own. In
// front of a base that the "very" family knows, they take the "very" entry.
export const INTENS = ['very', 'really', 'so', 'extremely', 'quite', 'pretty', 'totally', 'super', 'incredibly', 'highly', 'rather',
  'awfully', 'terribly', 'truly', 'utterly', 'absolutely', 'fairly', 'seriously', 'remarkably', 'exceptionally', 'especially',
  'particularly', 'insanely', 'ridiculously', 'hugely', 'deeply', 'unbelievably', 'amazingly', 'mighty', 'real', 'way', 'damn'];

export function normalize(s) {
  return String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z' -]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function stem(word) {
  let s = String(word).toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
  if (s.length <= 3) return s;
  if (s.endsWith('ily') && s.length > 4) s = s.slice(0, -3) + 'i';
  else if (s.endsWith('ly') && s.length > 5) s = s.slice(0, -2);
  if (/(ies|ied|ier)$/.test(s)) s = s.slice(0, -3) + 'i';
  else if (s.endsWith('iest')) s = s.slice(0, -4) + 'i';
  else if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('est') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('er') && s.length > 4) s = s.slice(0, -2);
  else if (/(ss|us|is)$/.test(s)) { /* keep: glass, famous, basis */ }
  else if (/(ches|shes|xes|zes|sses)$/.test(s)) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 3) s = s.slice(0, -1);
  if (/([b-df-hj-np-tv-z])\1$/.test(s) && !/(ll|ss)$/.test(s)) s = s.slice(0, -1);
  if (s.endsWith('e') && s.length > 3) s = s.slice(0, -1);
  if (s.endsWith('y') && s.length > 2) s = s.slice(0, -1) + 'i';
  return s;
}

// Levenshtein distance, stopped early above max.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < low) low = cur[j];
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Strip one leading modifier (a family modifier or an intensifier) from a
// normalized query. Returns { mod, rest } or null.
function stripMod(q, mods) {
  for (const m of mods) if (q.startsWith(m + ' ') && q.length > m.length + 1) return { mod: m, rest: q.slice(m.length + 1) };
  return null;
}

export function lookup(query, entries, opts = {}) {
  const q = normalize(query);
  if (!q) return [];
  const toks = q.split(' '), qst = toks.map(stem);
  const cut = stripMod(q, (opts.mods || []).concat(INTENS));
  const rst = cut ? cut.rest.split(' ').map(stem) : null;
  const out = [];
  for (const e of entries) {
    let s = 0, how = '';
    if (q === e.phrase) { s = 100; how = 'exact'; }
    else if (same(qst, e.stems)) { s = 95; how = 'form'; }
    else if (same(qst, e.bstems)) { s = 80; how = 'base'; }
    else if (rst && same(rst, e.bstems)) { s = 72; how = 'alias'; }
    else if (e.targets.includes(q)) { s = 60; how = 'reverse'; }
    else if (q.length >= 3 && e.phrase.startsWith(q)) { s = 48 - Math.min(10, (e.phrase.length - q.length) * 0.4); how = 'prefix'; }
    else if (toks.length === 1 && q.length >= 2 && e.base.startsWith(q)) { s = 40 - Math.min(10, (e.base.length - q.length) * 0.5); how = 'prefix'; }
    else if (cut && cut.rest.length >= 2 && e.base.startsWith(cut.rest) && e.bstems.length === 1) { s = 38 - Math.min(10, (e.base.length - cut.rest.length) * 0.5); how = 'prefix'; }
    else {
      const w = cut ? cut.rest : (toks.length === 1 ? q : '');
      const max = w.length >= 8 ? 2 : 1;
      if (w.length >= 4 && e.base.indexOf(' ') < 0 && editDistance(w, e.base, max) <= max) { s = 34 - editDistance(w, e.base, max) * 4; how = 'typo'; }
    }
    if (!s) continue;
    if (cut && e.mods.includes(cut.mod)) s += 4;
    if (opts.family && e.family === opts.family) s += 3;
    if (e.family === 'very') s += 1;
    out.push({ e, score: s, how });
  }
  out.sort((a, b) => b.score - a.score || a.e.order - b.e.order);
  return out.slice(0, opts.limit || 24);
}

// ── paragraph scan ─────────────────────────────────────────────────────────
// Families whose head word inflects (verbs, stock phrases): their first
// token is also indexed by stem.
const STEMMED = new Set(['verb', 'wordy']);
export function buildScan(entries) {
  const first = new Map(), firstStem = new Map(), veryBase = new Map();
  const add = (m, k, e) => { if (!m.has(k)) m.set(k, []); m.get(k).push(e); };
  for (const e of entries) {
    add(first, e.toks[0], e);
    if (STEMMED.has(e.family)) add(firstStem, e.stems[0], e);
    if (e.family === 'very') veryBase.set(e.base, e);
  }
  return { first, firstStem, veryBase };
}

const TOKEN = /[A-Za-z][A-Za-z'’-]*/g;
const BREAK = /[.,;:!?()"“”—\n]/;

export function tokenize(text) {
  const out = []; let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) out.push({ w: m[0], lw: m[0].toLowerCase().replace(/’/g, "'"), s: m.index, e: m.index + m[0].length });
  return out;
}

export function scan(text, idx) {
  const t = tokenize(text), spans = [];
  // linked(i, n): tokens i .. i+n-1 have no break mark between them.
  const linked = (i, n) => { for (let k = i; k < i + n - 1; k++) if (BREAK.test(text.slice(t[k].e, t[k + 1].s))) return false; return true; };
  for (let i = 0; i < t.length; i++) {
    let best = null;
    const cands = (idx.first.get(t[i].lw) || []).concat(idx.firstStem.get(stem(t[i].lw)) || []);
    for (const e of cands) {
      const n = e.toks.length;
      if (i + n > t.length || (best && (n < best.n || (n === best.n && best.exact))) || !linked(i, n)) continue;
      let exact = true, ok = true;
      for (let k = 0; k < n && ok; k++) {
        const w = t[i + k].lw;
        if (w === e.toks[k]) continue;
        exact = false;
        if (!STEMMED.has(e.family) || stem(w) !== e.stems[k]) ok = false;
      }
      if (ok) best = { e, n, exact };
    }
    // An intensifier in front of a base that the "very" family knows.
    if (!best && INTENS.includes(t[i].lw) && i + 1 < t.length && linked(i, 2)) {
      const e = idx.veryBase.get(t[i + 1].lw);
      if (e) best = { e, n: 2, exact: true, alias: true };
    }
    if (best) {
      spans.push({ start: t[i].s, end: t[i + best.n - 1].e, text: text.slice(t[i].s, t[i + best.n - 1].e), entry: best.e, fixable: best.exact, alias: !!best.alias });
      i += best.n - 1;
    }
  }
  return spans;
}

// Match the case of the source: Capital, ALL CAPS or lower.
export function matchCase(src, word) {
  if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return word.toUpperCase();
  if (/^[A-Z]/.test(src)) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

// A word that takes "an": a vowel sound first (rough rule, with the common
// exceptions: "a unique", "an hour", "an honest").
const VOWEL = /^(?:[aeio]|u(?!ni|s[eu]|ti|bi|ra)|hon|hour|heir)/i;
const article = (txt, rep) => txt.replace(/\b(a|an)(\s+)$/i, (m, a, sp) => matchCase(a, VOWEL.test(rep) ? 'an' : 'a') + sp);

export function fixText(text, spans, pick = s => s.entry.targets[0]) {
  // Forward pass: parts are { t } plain text or { t, fix: true } new words.
  const parts = []; let at = 0, count = 0;
  for (const s of spans.slice().sort((a, b) => a.start - b.start)) {
    if (!s.fixable || s.start < at) continue;
    const rep = matchCase(s.text, pick(s));
    const before = article(text.slice(at, s.start), rep);
    if (before) parts.push({ t: before });
    parts.push({ t: rep, fix: true, from: s.text });
    at = s.end; count++;
  }
  if (at < text.length) parts.push({ t: text.slice(at) });
  return { text: parts.map(p => p.t).join(''), parts, count };
}
