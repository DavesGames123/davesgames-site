// ============================================================================
//  LOSE THE MODIFIER  ·  tests.mjs — node tests of the data and the matcher
// ----------------------------------------------------------------------------
//  Run from the repo root:  node stella-nova/pages/lose-the-modifier/tests.mjs
//  DATA
//    1. every line has six fields, and no field is empty
//    2. no weak phrase occurs twice
//    3. family, part of speech and register come from the allowed sets
//    4. a modifier family entry starts with one of its modifiers
//    5. every entry has a target, and no target is its own base or phrase
//    6. the example ends with . ! or ? and uses the first target as a word
//    7. size: 800 entries or more, 300 or more in "very"
//  MATCHER
//    8. stem gives one stem for the inflections of a word
//    9. lookup: exact, base only, other forms, alias, reverse, prefix, typo
//   10. scan + fixText: spans, capitals, a / an, stem-only spans kept
// ============================================================================
import { RAW, PHRASES, FAMILIES, REGISTERS, POS, parse } from './phrases.js';
import { stem, lookup, buildScan, scan, fixText } from './matcher.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; if (fail <= 40) console.log('FAIL', msg); } };

// ── DATA ───────────────────────────────────────────────────────────────────
const lines = RAW.split('\n').filter(l => l.trim());
for (const l of lines) {
  const f = l.split('|');
  ok(f.length === 6, `six fields: ${l}`);
  ok(f.every(x => x.trim() !== '' && x === x.trim()), `no empty or padded field: ${l}`);
}
ok(parse(RAW).length === PHRASES.length, 'parse(RAW) gives PHRASES');

const seen = new Map();
for (const e of PHRASES) {
  ok(!seen.has(e.phrase), `duplicate weak phrase "${e.phrase}"`);
  seen.set(e.phrase, e);
}
const fam = new Map(FAMILIES.map(f => [f.id, f]));
const isWord = (sentence, w) => new RegExp(`(^|[^A-Za-z'-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z'-])`, 'i').test(sentence);
for (const e of PHRASES) {
  const f = fam.get(e.family);
  ok(!!f, `family "${e.family}" (${e.phrase})`);
  ok(POS.includes(e.pos), `pos "${e.pos}" (${e.phrase})`);
  ok(REGISTERS.includes(e.reg), `register "${e.reg}" (${e.phrase})`);
  ok(e.phrase === e.phrase.toLowerCase() && !/\s{2}/.test(e.phrase), `lowercase single-spaced phrase "${e.phrase}"`);
  if (f && f.kind === 'mod') ok(f.mods.includes(e.mod) && e.base.length > 0, `"${e.phrase}" starts with a ${e.family} modifier`);
  if (f && f.kind === 'verb') ok(e.base && e.mod, `"${e.phrase}" is verb + adverb`);
  ok(e.targets.length >= 1 && e.targets.length <= 4, `1 to 4 targets (${e.phrase})`);
  ok(e.targets.every(t => t && t === t.trim()), `no empty target (${e.phrase})`);
  ok(new Set(e.targets).size === e.targets.length, `no repeated target (${e.phrase})`);
  ok(!e.targets.includes(e.base) && !e.targets.includes(e.phrase), `no target equals its base (${e.phrase})`);
  ok(/[.!?]$/.test(e.ex), `example ends with . ! or ? (${e.phrase})`);
  ok(e.ex.split(/\s+/).length >= 5, `example is a sentence (${e.phrase})`);
  ok(isWord(e.ex, e.targets[0]), `example uses "${e.targets[0]}" (${e.phrase}): ${e.ex}`);
}
const count = id => PHRASES.filter(e => e.family === id).length;
ok(PHRASES.length >= 800, `800 entries or more (${PHRASES.length})`);
ok(count('very') >= 300, `300 "very" entries or more (${count('very')})`);
for (const f of FAMILIES) ok(count(f.id) >= 10, `family ${f.id} has 10 entries or more (${count(f.id)})`);

// ── MATCHER ────────────────────────────────────────────────────────────────
for (const g of [['tired', 'tires', 'tiring', 'tire'], ['happy', 'happier', 'happiest', 'happily'], ['walked', 'walks', 'walking', 'walk'], ['big', 'bigger', 'biggest']])
  ok(g.every(w => stem(w) === stem(g[0])), `one stem for ${g.join(', ')}: ${g.map(stem).join(', ')}`);
ok(stem('glass') === 'glass' && stem('famous') === 'famous', 'stem keeps -ss and -us words');

const top = q => (lookup(q, PHRASES)[0] || {}).e;
const phr = q => (top(q) || {}).phrase;
ok(phr('very tired') === 'very tired', 'lookup exact "very tired"');
ok(phr('Very  Tired!') === 'very tired', 'lookup ignores case, spaces and marks');
ok(phr('tired') === 'very tired', `lookup base "tired" -> very tired (${phr('tired')})`);
ok(phr('awfully tired') === 'very tired', `lookup alias "awfully tired" (${phr('awfully tired')})`);
ok(phr('walk slowly') === 'walked slowly', `lookup other form "walk slowly" (${phr('walk slowly')})`);
ok(phr('walking slowly') === 'walked slowly', `lookup other form "walking slowly" (${phr('walking slowly')})`);
ok(phr('in order to') === 'in order to', 'lookup wordy "in order to"');
ok(lookup('exhausted', PHRASES).some(r => r.e.phrase === 'very tired' && r.how === 'reverse'), 'lookup reverse "exhausted"');
ok(phr('very tir') === 'very tired' || lookup('very tir', PHRASES).slice(0, 5).some(r => r.e.phrase === 'very tired'), 'lookup prefix "very tir"');
ok(lookup('tird', PHRASES).slice(0, 5).some(r => r.e.phrase === 'very tired'), 'lookup typo "tird"');
ok(lookup('', PHRASES).length === 0 && lookup('zzqx', PHRASES).length === 0, 'lookup: no match for nothing');

const idx = buildScan(PHRASES);
const text = 'It was a very old house, and Sam was really, really tired. He walked slowly home. In order to sleep, she walks slowly upstairs. AWFULLY TIRED!';
const spans = scan(text, idx);
const words = spans.map(s => s.text);
ok(words.includes('very old'), `scan finds "very old" (${words})`);
ok(words.includes('walked slowly') && words.includes('In order to'), `scan finds "walked slowly" and "In order to" (${words})`);
ok(!words.includes('really, really'), 'scan does not join words across a comma');
const stemOnly = spans.find(s => s.text === 'walks slowly');
ok(stemOnly && !stemOnly.fixable, 'scan: "walks slowly" is a stem-only span, not fixable');
const alias = spans.find(s => s.text === 'AWFULLY TIRED');
ok(alias && alias.alias && alias.entry.phrase === 'very tired', 'scan: "AWFULLY TIRED" aliases to very tired');
const fx = fixText(text, spans);
const old = PHRASES.find(e => e.phrase === 'very old').targets[0];
ok(fx.text.includes((/^[aeiou]/.test(old) ? 'an ' : 'a ') + old + ' house'), `fixText mends the article: ${fx.text}`);
ok(fx.text.includes('To sleep'), `fixText keeps the capital: ${fx.text}`);
ok(fx.text.includes('walks slowly'), 'fixText keeps the stem-only span');
ok(fx.text.includes(PHRASES.find(e => e.phrase === 'very tired').targets[0].toUpperCase() + '!'), 'fixText keeps ALL CAPS');
ok(fx.parts.map(p => p.t).join('') === fx.text && fx.count === fx.parts.filter(p => p.fix).length, 'fixText parts join to the text');

const fams = {}; for (const e of PHRASES) fams[e.family] = (fams[e.family] || 0) + 1;
console.log(`${PHRASES.length} entries:`, Object.entries(fams).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(fail ? `${fail} of ${n} checks FAILED` : `all ${n} checks pass`);
process.exit(fail ? 1 : 0);
