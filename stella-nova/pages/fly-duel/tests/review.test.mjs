// ============================================================================
//  FLY DUEL  ·  review tests  (node tests/review.test.mjs)
// ----------------------------------------------------------------------------
//  Package G (fact-check and review) owns this file. Each block locks one
//  fix from the review, so the fix cannot come back. No network: the checks
//  that used the network (DOI abstracts, card name search) are recorded in
//  the commit bodies, and only their result is locked here.
//
//  GREP MAP
//      grep -n 'CARD NAMES'     card names that clash with published cards
//      grep -n 'MANA GLYPHS'    no disc-shaped mana glyph
//      grep -n 'PAGE PROSE'     claims the sources or the model do not hold
//      grep -n 'EVAL VERDICT'   08 says plainly what the measured numbers mean
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CARDS, TOKENS } from '../game/cards.js';
import { manaGlyph } from '../ui/art.js';
import { evalVerdict } from '../ui/charts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

// ---------------------------------------------------------------- CARD NAMES
// On 2026-10-11 the review sent every card name to the Scryfall card search
// (exact name and name substring). One name was a published card: "Spore
// Burst". No other name was a match. This list holds the clash, and names
// that a rename must not use (they also are published cards).
{
  const CLASH = ['Spore Burst', 'Spore Cloud', 'Swell of Growth', 'Groundswell'];
  const names = [...CARDS, ...TOKENS].map(c => c.name.toLowerCase());
  for (const n of CLASH) ok(!names.includes(n.toLowerCase()), `card names: "${n}" is a published card name`);
  ok(new Set(names).size === names.length, 'card names: no two cards share a name');
}

// ---------------------------------------------------------------- MANA GLYPHS
// A coloured disc with a symbol, or a grey disc with a number, is the look
// of a published card game's mana symbols. The outline of each glyph (the
// first shape in the svg) must not be a circle.
{
  for (const [k, n] of [['amber', 0], ['moss', 0], ['generic', 3]]) {
    const svg = manaGlyph(k, n, 16);
    const first = (svg.match(/<svg[^>]*>\s*<(\w+)/) || [])[1];
    ok(first && first !== 'circle' && first !== 'ellipse', `mana glyphs: ${k} outline is ${first}, not a disc`);
  }
}

// ---------------------------------------------------------------- PAGE PROSE
// Claims that the review found wrong in index.html, and the citations it
// added. Checked against the abstracts and full texts (Europe PMC) on
// 2026-10-11, and against brain/mb.js learn(), which uses the KC trace and
// the compartment dopamine only (no MBON activity).
{
  const html = read('index.html');
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  ok(!/same rule a fly uses/i.test(text), 'prose: the hero does not say the model uses the same rule as a fly');
  ok(!/pre and post/i.test(text), 'prose: 05 does not say the rule needs MBON (post) activity');
  ok(/uses no MBON activity/.test(text), 'prose: 05 says the model uses no MBON activity');
  ok(/order of the two signals matters/.test(text), 'prose: 05 gives the order rule of Hige et al. 2015');
  ok(/random-looking claws<span data-cite="caron2013">/.test(html), 'prose: 02 cites Caron 2013 for random claws');
  ok(/its own DAN types<span data-cite="aso2014b aso2014a">/.test(html), 'prose: 02 cites Aso 2014a for compartments and DAN types');
  ok(!/sparse KC code and its compartments are in the wiring/.test(text), 'prose: 09 does not say the sparse code is in the wiring');
}

// ---------------------------------------------------------------- EVAL VERDICT
// The held-out table in 08 showed the numbers, but no sentence said that
// the flies lose about four games in five to the greedy bot, or that the
// A-vs-B interval does not include 50%. evalVerdict() writes those
// sentences from meta.final, so they follow the data file.
{
  const fin = JSON.parse(read('data/training-curve.json')).meta.final;
  const t = evalVerdict(fin).join(' ');
  ok(t.includes(`Fly A won ${Math.round(100 * fin.vsGreedy.A.rate)}%`), 'verdict: greedy rate of Fly A from the file');
  ok(/lose most games/.test(t) === (fin.vsGreedy.A.ci95[1] < 0.5 && fin.vsGreedy.B.ci95[1] < 0.5), 'verdict: says the flies lose to greedy exactly when both intervals are below 50%');
  const ab = fin.AvsB.ci95;
  ok(/Fly B is a little stronger/.test(t) === (ab[1] < 0.5), 'verdict: names Fly B stronger exactly when the A-vs-B interval is below 50%');
  ok(/Fly A is a little stronger/.test(t) === (ab[0] > 0.5), 'verdict: names Fly A stronger exactly when the interval is above 50%');
  const even = evalVerdict({ AvsB: { rate: 0.5, ci95: [0.47, 0.53] } }).join(' ');
  ok(/not different from an even match/.test(even), 'verdict: an interval across 50% reads as even');
  ok(evalVerdict(null).length === 0 && evalVerdict({}).length === 0, 'verdict: no rates, no sentences');
  ok(!/NaN|undefined/.test(t), 'verdict: no NaN or undefined');
  ok(/id="evalVerdict"/.test(read('index.html')), 'verdict: index.html has #evalVerdict');
  ok(/evalVerdict\(fin\)/.test(read('main.js')), 'verdict: main.js fills #evalVerdict from meta.final');
  console.log('  verdict:', t);
}

console.log(`review.test: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
