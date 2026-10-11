// ============================================================================
//  FLY DUEL  ·  saver look checks  (node tests/saver-look.test.mjs)
// ----------------------------------------------------------------------------
//  Static checks of saver.js: no canvas glow (shadowBlur, shadowColor),
//  the cards are drawCard() of ui/cardface.js, and the 2D brain views take
//  the wiring of each fly (connectomes [A, B]). Then one 2D show runs on a
//  stub context for 120 s of show time, and the card names that it draws
//  must come from drawCard (a name and a type line on one card).
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const src = readFileSync(join(ROOT, 'saver.js'), 'utf8');
const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

ok(!/shadowBlur|shadowColor/.test(code), 'saver.js: no canvas glow (shadowBlur, shadowColor)');
ok(/import \{[^}]*drawCard[^}]*\} from '\.\/ui\/cardface\.js'/.test(src), 'saver.js: imports drawCard from ui/cardface.js');
ok(!/cardArt\(/.test(code), 'saver.js: no procedural SVG card art');
ok(/env\.connectomes\?\.\[i\]/.test(code) && /conOf\('B'\)/.test(code), 'saver.js: 2D brain views use the wiring of each fly');

// one 2D show on a stub context
const { createShow } = await import('../saver.js');
const rules = await import('../game/rules.js');
const cards = await import('../game/cards.js');
const bots = await import('../game/bots.js');
const { typeLine } = await import('../ui/cardface.js');
const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));
const text = [];
let bad = 0;
const ctx = () => new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'measureText') return s => ({ width: String(s).length * 6 });
    if (k === 'createLinearGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
    if (k === 'fillText') return (s, ...a) => { text.push(String(s)); if (a.some(v => !Number.isFinite(v))) bad++; };
    return (...a) => { if (a.some(v => typeof v === 'number' && !Number.isFinite(v))) bad++; };
  },
  set(t, k, v) { t[k] = v; return true; },
});
const canvas = () => ({ width: 0, height: 0, style: {}, getContext: ctx, remove() {} });
const show = createShow({ rules, byId: new Map(Object.entries(cards.CARD)), connectome: C, connectomes: [C, C], flies: [null, null], bots, trained: false, seed: 7, calm: 0.2, makeCanvas: canvas, makeImage: null, dpr: 1 });
const g = ctx();
const R = { x: 0, y: 0, w: 1280, h: 720 };
for (let t = 0; t < 120 * 10; t++) { show.update(0.1); show.draw(g, R, 0.1); }
const names = Object.values(cards.CARD).filter(c => text.includes(c.name));
ok(names.length >= 3, `show: card names drawn (${names.length})`);
ok(names.some(c => text.includes(typeLine(c))), 'show: the type line of a drawn card is there (drawCard)');
ok(bad === 0, `show: only finite numbers (${bad} bad calls)`);

console.log(`saver-look: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
