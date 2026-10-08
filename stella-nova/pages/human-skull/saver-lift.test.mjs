// HUMAN SKULL · saver-lift.test.mjs — node saver-lift.test.mjs
// The saver lift of each push-in part on data/skull.json, and the fit box.
// A portrait band of short side m: the fit puts the larger side of the box
// at 0.6 of m (main.js FIT.bone). A worst case lift runs across the screen
// (the lift length adds to the box side on screen). The part must stay in
// the band (within m / 2 of the aim) at both ends of the lift.
import { readFileSync } from 'node:fs';
import { SKULL_MID, liftVec, liftBox } from './saver-lift.js';
let fail = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) fail++; };
const J = JSON.parse(readFileSync(new URL('./data/skull.json', import.meta.url), 'utf8'));
// main.js makeTour: the push-in parts
const dist = c => Math.hypot(c[0] - SKULL_MID[0], c[1] - SKULL_MID[1], c[2] - SKULL_MID[2]);
const push = J.parts.filter(p => (p.group === 'cranial' || p.group === 'facial' || p.group === 'hyoid'))
  .filter(p => { const e = Math.max(...p.ext); return e >= 30 && (e >= 50 || dist(p.center) >= 60); });
check('push-in parts found', push.length >= 15, `${push.length} parts`);
let lenOk = true, holds = true, oldOut = 0, oldWorst = 0, newWorst = 0;
for (const p of push) {
  const L = liftVec(p.center, p.ext), a = Math.hypot(...L);
  if (a < 12 - 1e-9 || a > 40 + 1e-9) lenOk = false;
  const B = liftBox(p.center, p.ext, L);
  for (let k = 0; k < 3; k++) {
    for (const s of [0, 1]) {
      const lo = p.center[k] + s * L[k] - p.ext[k] / 2, hi = p.center[k] + s * L[k] + p.ext[k] / 2;
      if (lo < B.c[k] - B.size[k] / 2 - 1e-9 || hi > B.c[k] + B.size[k] / 2 + 1e-9) holds = false;
    }
  }
  // screen: side H of the home box, lift a across it. Old fit: aim at
  // home, H at 0.6 m; far end at (H / 2 + a) of scale 0.6 m / H. New fit:
  // aim at the box centre, H + a at 0.6 m; far end at (H + a) / 2 of it.
  const H = Math.max(...p.ext), o = (H / 2 + a) * 0.6 / H, n = 0.3;
  oldWorst = Math.max(oldWorst, o); newWorst = Math.max(newWorst, n);
  if (o > 0.5) oldOut++;
}
check('lift is 12 to 40 mm', lenOk);
check('the fit box holds the part at home and at the full lift', holds);
check('a lift across the screen stays in a portrait band', newWorst <= 0.5,
  `far end at ${(newWorst * 100).toFixed(0)}% of the short side from the aim (was up to ${(oldWorst * 100).toFixed(0)}%, ${oldOut} of ${push.length} parts out of the band)`);
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
