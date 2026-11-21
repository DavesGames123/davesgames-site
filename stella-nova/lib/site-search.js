// ============================================================================
//  SITE SEARCH  ·  ranked page search for the shell sidebar and the home page
// ----------------------------------------------------------------------------
//  The index is lib/search-index.js (window.SN_SEARCH_INDEX). The tool
//  tools/search-index.mjs writes it from lib/nav-data.js, the home blurbs
//  and search words (pages/home/sectors.js) and the text of each page's
//  index.html (title, description, headings, body text).
//
//  A query word matches a page word in five ways. Each way has a weight:
//    exact   the same folded word                              1.0
//    stem    the same stem ("strings" = "string")              0.9
//    prefix  the page word starts with the query word          0.7
//            (only for query words of 3 or more letters)
//    concept a word of the same concept group (CONCEPTS)       0.55
//            ("strings" finds violin, guitar, harp, chord)
//    typo    one edit away (two for 8 or more letters)         0.45
//  A page field gives its weight to each word in it (FIELD_W): the label
//  is strongest, the body text weakest. Rare words count more (idf).
//  A page that matches all query words ranks above one that matches some.
//
//  Classic script, no ES modules, so it also runs on file:// and in node.
//  It sets window.snSearch = { search, stem, fold, tokens, ready, load }.
//
//  grep -n targets
//    concept groups ....... "var CONCEPTS"
//    field weights ........ "var FIELD_W"
//    stemmer .............. "function stem"
//    index build .......... "function build"
//    query expansion ...... "function expand"
//    ranking .............. "function search"
//    lazy load ............ "function load"
// ============================================================================
(function (w) {
'use strict';

// Concept groups. A query word in a group also finds the other words of the
// group, at the concept weight. Write the words in their stem form (stem()
// is applied at build time too, so a plural here is also fine).
var CONCEPTS = [
  'string violin guitar cello viola harp bass pluck strum bow fret chord sitar banjo ukulele lute piano harmonic',
  'string thread yarn rope cord wire cable filament fibre fiber',
  'sound audio acoustic music musical note tone pitch frequency resonance vibration instrument synth',
  'wave ripple oscillation vibration standing interference diffraction',
  'fluid liquid water flow navier stokes cfd turbulence vortex smoke',
  'fire flame burn combustion smoke ember explosion blast',
  'heat thermal temperature diffusion conduction convection',
  'light optics optical lens refraction reflection prism ray photon laser caustic',
  'colour color hue palette pigment rgb spectrum',
  'gravity orbit planet star galaxy kepler newton celestial space astronomy astro',
  'blackhole black hole event horizon schwarzschild kerr wormhole relativity spacetime einstein',
  'quantum atom orbital electron wavefunction schrodinger qubit superposition entanglement particle',
  'magnet magnetic electromagnet field coil induction electric charge current voltage',
  'shader wgsl glsl gpu webgpu webgl render rendering graphic',
  'fractal mandelbrot julia mandelbulb recursion selfsimilar',
  'noise perlin simplex procedural random generative',
  'cell biology life organism dna protein enzyme molecule chemistry',
  'protein enzyme amino peptide fold alphafold',
  'virus vaccine mrna epidemic outbreak disease immune infection',
  'brain neuron neural connectome fly drosophila',
  'machine gear engine mechanism linkage clock watch cam drivetrain gearbox',
  'robot robotic arm actuator legged locomotion',
  'cloth fabric textile soft body spring mass',
  'sand granular dune grain particle',
  'weather storm rain cloud wind hurricane cyclone tornado climate',
  'ocean sea tide tidal current marine coral reef',
  'terrain landscape mountain erosion heightmap island map',
  'city town building urban architecture',
  'game play puzzle board card',
  'pool billiard snooker cue',
  'security hack breach incident vulnerability cve exploit malware ransomware',
  'math mathematic geometry algebra calculus tensor topology equation',
  'network graph node edge tree',
  'growth grow branch dendrite crystal aggregation dla coral plant tree',
  'plant flower tree leaf botanical garden forest',
  'anatomy skull skeleton bone body human',
  'chemistry chemical reaction molecule bond octane fuel',
  'ai machine learning neural network model llm transformer',
  'pendulum swing oscillator chaos double',
  'chaos attractor lorenz strange butterfly',
  'collision impact crash physics rigid body',
  'glass crystal gem diamond jewel',
  'metal steel iron forge alloy liquid metal',
  'draw drawing art pen sketch line ink paint painting',
  'pattern tiling tessellation truchet symmetry kaleidoscope',
  'wind tunnel aerodynamic airfoil lift drag',
  'satellite orbit leo rocket spacecraft launch',
  'flight plane aircraft airport airline',
  'emulator retro classic arcade',
  'sax saxophone flute trumpet brass woodwind horn',
  'drum percussion membrane',
  'image picture photo pixel'
];

// Field weights. The keys are the field names of SN_SEARCH_INDEX rows.
var FIELD_W = { l: 10, k: 6, s: 4, d: 3, p: 2, h: 2, b: 1 };
var W_EXACT = 1, W_STEM = 0.9, W_PREFIX = 0.7, W_CONCEPT = 0.55, W_TYPO = 0.45;

var STOP = {};
('a an and are as at be by for from has have in into is it its of on or that the this to was with you your can how what why when where which who will not no but all any each more most one two our we us my me i do does it\'s than then there these those over under up out about page stella nova').split(' ').forEach(function (s) { STOP[s] = 1; });

function fold(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

// Words: folded, split on anything that is not a letter or a digit. A
// hyphen word also gives its joined form ("n-body" -> n, body, nbody).
function tokens(t) {
  var out = [], s = fold(t);
  var parts = s.split(/[^a-z0-9\-]+/);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p) continue;
    var sub = p.split('-').filter(Boolean);
    for (var j = 0; j < sub.length; j++) out.push(sub[j]);
    if (sub.length > 1) out.push(sub.join(''));
  }
  return out;
}

// A light English stemmer: plurals, -ing, -ed, -ly, -ies. It must give the
// same stem for the forms a visitor types ("strings", "string", "stringed").
function stem(t) {
  var s = t;
  if (s.length < 4 || /^\d+$/.test(s)) return s;
  if (/ies$/.test(s) && s.length > 4) return s.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(s)) return s;
  if (/(sses|xes|zes|ches|shes)$/.test(s)) return s.slice(0, -2);
  if (/s$/.test(s)) s = s.slice(0, -1);
  // -ing and -ed come off only when a stem of 4 or more letters with a
  // vowel stays: "string", "spring" and "speed" keep their form.
  var m = /^(.*?)(ing|ed)$/.exec(s);
  if (m && m[1].length >= 4 && /[aeiouy]/.test(m[1])) { s = m[1]; if (/(.)\1$/.test(s) && !/(ll|ss|zz)$/.test(s)) s = s.slice(0, -1); }
  else if (s.length > 5 && /ly$/.test(s)) s = s.slice(0, -2);
  return s;
}

// Index state. build() runs once, on the first search after the index is
// in place.
var IDX = null;

function build(rows) {
  var docs = [], df = {}, vocab = [], seen = {}, concept = {};
  rows.forEach(function (r) {
    var f = {}, all = {};
    for (var name in FIELD_W) {
      var tf = {};
      tokens(r[name] || '').forEach(function (t) {
        if (STOP[t] || t.length < 2 && !/\d/.test(t)) return;
        var st = stem(t);
        tf[st] = (tf[st] || 0) + 1;
        if (!seen[st]) { seen[st] = 1; vocab.push(st); }
      });
      f[name] = tf;
      for (var st in tf) all[st] = 1;
    }
    for (var s2 in all) df[s2] = (df[s2] || 0) + 1;
    docs.push({ r: r, f: f, label: fold(r.l) });
  });
  CONCEPTS.forEach(function (g, gi) {
    tokens(g).forEach(function (t) { var st = stem(t); (concept[st] || (concept[st] = [])).push(gi); });
  });
  vocab.sort();
  IDX = { docs: docs, df: df, vocab: vocab, concept: concept, n: docs.length };
  return IDX;
}

// Edit distance (a swap of two letters is one edit) with an early exit
// above max.
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  var pp = [], prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i]; var low = i;
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      if (cur[j] < low) low = cur[j];
    }
    if (low > max) return false;
    pp = prev; prev = cur;
  }
  return prev[b.length] <= max;
}

// One query word -> { pageStem: weight, ... }, the best weight per stem.
function expand(q, isLast) {
  var out = {}, st = stem(q), V = IDX.vocab, i;
  function put(s, wt) { if (!(out[s] >= wt)) out[s] = wt; }
  if (IDX.df[q]) put(q, W_EXACT);
  if (IDX.df[st]) put(st, q === st ? W_EXACT : W_STEM);
  if (q.length >= 3) {
    // Binary search for the first vocab word >= q, then walk the prefix run.
    var lo = 0, hi = V.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (V[mid] < q) lo = mid + 1; else hi = mid; }
    var pw = isLast ? W_PREFIX : W_PREFIX * 0.85;
    for (i = lo; i < V.length && V[i].lastIndexOf(q, 0) === 0; i++) if (V[i] !== q) put(V[i], pw);
    if (st !== q) for (i = 0; i < V.length; i++) if (V[i].lastIndexOf(st, 0) === 0 && V[i] !== st) put(V[i], pw * 0.95);
  }
  var gs = IDX.concept[st] || IDX.concept[q];
  if (gs) gs.forEach(function (gi) {
    tokens(CONCEPTS[gi]).forEach(function (t) { var s = stem(t); if (IDX.df[s] && s !== st) put(s, W_CONCEPT); });
  });
  if (q.length >= 4) {
    var max = q.length >= 8 ? 2 : 1;
    for (i = 0; i < V.length; i++) {
      var v = V[i];
      if (v.length < 4 || out[v] || Math.abs(v.length - st.length) > max) continue;
      if (within(st, v, max)) put(v, W_TYPO);
    }
  }
  return out;
}

// search(query, opts) -> [{ key, label, path, score, matched, total, why }]
// opts.limit (default 60), opts.min (drop rows under this part of the top
// score, default 0.04).
function search(query, opts) {
  opts = opts || {};
  if (!IDX) { var rows = w.SN_SEARCH_INDEX && w.SN_SEARCH_INDEX.pages; if (!rows) return null; build(rows); }
  var qs = tokens(query).filter(function (t) { return !STOP[t]; });
  if (!qs.length) return [];
  var ex = qs.map(function (q, i) { return expand(q, i === qs.length - 1); });
  var N = IDX.n, res = [];
  IDX.docs.forEach(function (d) {
    var score = 0, matched = 0, why = [];
    for (var qi = 0; qi < ex.length; qi++) {
      var best = 0, bestStem = null;
      for (var s in ex[qi]) {
        var idf = Math.log(1 + N / (IDX.df[s] || 1));
        var sc = 0;
        for (var name in FIELD_W) {
          var tf = d.f[name][s];
          if (tf) sc += FIELD_W[name] * (1 + Math.log(tf));
        }
        sc *= ex[qi][s] * idf;
        if (sc > best) { best = sc; bestStem = s; }
      }
      if (best > 0) { matched++; score += best; why.push(bestStem); }
    }
    if (!matched) return;
    // A label that starts with the query ranks first.
    var lq = fold(query).trim();
    if (lq && d.label.lastIndexOf(lq, 0) === 0) score *= 1.6;
    else if (lq && d.label.indexOf(lq) >= 0) score *= 1.3;
    var cover = matched / ex.length;
    score *= cover * cover;
    res.push({ key: d.r.k, label: d.r.l, path: d.r.p, score: score, matched: matched, total: ex.length, why: why });
  });
  res.sort(function (a, b) { return (b.matched - a.matched) || (b.score - a.score) || (a.label < b.label ? -1 : 1); });
  var top = res.length ? res[0].score : 0, min = opts.min == null ? 0.04 : opts.min;
  var full = res.length ? res[0].matched : 0;
  res = res.filter(function (r) { return r.matched === full && r.score >= top * min; });
  return res.slice(0, opts.limit || 60);
}

function ready() { return !!(w.SN_SEARCH_INDEX && w.SN_SEARCH_INDEX.pages); }

// load(src, cb): add the index script once, then call cb. The shell calls
// it on the first focus of the search field, so the index does not load
// with every page view.
var waiting = null;
function load(src, cb) {
  if (ready()) { if (cb) cb(); return; }
  if (waiting) { if (cb) waiting.push(cb); return; }
  waiting = cb ? [cb] : [];
  var d = w.document; if (!d) return;
  var s = d.createElement('script');
  s.src = src; s.async = true;
  s.onload = function () { IDX = null; var q = waiting; waiting = null; q.forEach(function (f) { try { f(); } catch (e) {} }); };
  s.onerror = function () { waiting = null; };
  d.head.appendChild(s);
}

w.snSearch = { search: search, stem: stem, fold: fold, tokens: tokens, ready: ready, load: load, CONCEPTS: CONCEPTS, FIELD_W: FIELD_W };
})(typeof window !== 'undefined' ? window : globalThis);
