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
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CARDS, TOKENS } from '../game/cards.js';

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

console.log(`review.test: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
