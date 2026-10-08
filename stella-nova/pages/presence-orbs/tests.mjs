// ============================================================================
//  PRESENCE ORBS  ·  tests.mjs — node tests.mjs   (no DOM, no GPU)
// ----------------------------------------------------------------------------
//  Checks the screensaver shot director (director.js):
//    order ...... two seeds give two different shot orders; one seed gives
//                 the same order twice; no kind shows two times in a row
//    duration ... every shot lasts 5 to 12 s at calm 0, 0.5 and 1
//    activity ... in at least 85% of the frames, one orb or more is not idle;
//                 every orb changes state in the run; calm 1 changes state
//                 less often than calm 0, but more than zero times
//    solo ....... a solo shot goes through all six states
//    cells ...... no species shows two times in one shot; levels, activity
//                 and tones are finite and in 0..1
//    layout ..... every cell square is inside the rect, and no two overlap
//    label ...... every shot has a title, a sub and a line
//    dpr ........ the saver pixel ratio stays under the phone and desktop caps
// ============================================================================
import { readFileSync } from 'node:fs';
import { makeDirector, sampleShot, layoutShot, shotLabel, saverDpr, SAVER_PHONE_PX, SAVER_MAX_PX, STATES, SHOT_MIN, SHOT_MAX } from './director.js';

const STYLES = JSON.parse(readFileSync(new URL('styles.json', import.meta.url), 'utf8'));
const OUT = new Set(['tempest', 'opal', 'glimmer', 'abyss']);
const pool = STYLES.filter(s => !OUT.has(s.name)).map(s => ({ name: s.name, family: s.family, species: s.species }));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const shots = (seed, calm, n = 40) => { const d = makeDirector({ seed, calm, pool }); return Array.from({ length: n }, () => d.next()); };
const sig = list => list.map(s => s.kind + ':' + s.cells.map(c => c.name).join('+')).join(' ');

// order
{
  const a = sig(shots(1, 0.7)), b = sig(shots(2, 0.7)), c = sig(shots(1, 0.7));
  const seeds = new Set(Array.from({ length: 20 }, (_, i) => sig(shots(1000 + i * 7919, 0.7, 6))));
  ok(a !== b, 'seeds 1 and 2 give the same order'); ok(a === c, 'seed 1 is not repeatable');
  ok(seeds.size === 20, `20 seeds give ${seeds.size} different orders`);
  let rep = 0; for (const s of [1, 2, 3, 99]) { const l = shots(s, 0.5); for (let i = 1; i < l.length; i++) if (l[i].kind === l[i - 1].kind) rep++; }
  ok(rep === 0, `${rep} kinds repeat back to back`);
  console.log('order     ', 'seed 1 first kinds:', shots(1, 0.7, 8).map(s => s.kind).join(' '));
  console.log('order     ', 'seed 2 first kinds:', shots(2, 0.7, 8).map(s => s.kind).join(' '));
  console.log('order     ', `20 seeds -> ${seeds.size} different six-shot orders`);
}

// duration, activity, cells, layout, label
const rect = { x: 0, y: 120, w: 1600, h: 640 }, tall = { x: 0, y: 160, w: 420, h: 520 };
const changesPerSec = {};
for (const calm of [0, 0.5, 1]) {
  let lo = Infinity, hi = 0, frames = 0, active = 0, changes = 0, time = 0, kinds = {};
  for (const seed of [1, 7, 31, 4242]) for (const sh of shots(seed, calm, 30)) {
    lo = Math.min(lo, sh.dur); hi = Math.max(hi, sh.dur);
    kinds[sh.kind] = (kinds[sh.kind] || 0) + 1;
    ok(new Set(sh.cells.map(c => c.name)).size === sh.cells.length, `${sh.kind} shot shows a species twice`);
    const L = shotLabel(sh); ok(L.title && L.sub && L.line, `${sh.kind} shot has no label`);
    const seen = sh.cells.map(() => new Set());
    let prev = null;
    for (let t = 0; t < sh.dur; t += 1 / 30) {
      const s = sampleShot(sh, t); frames++;
      if (s.cells.some(c => c.st !== 'idle')) active++;
      s.cells.forEach((c, i) => {
        seen[i].add(c.st);
        if (prev && prev[i] !== c.st) changes++;
        ok(STATES.includes(c.st), 'bad state ' + c.st);
        ok(c.level >= 0 && c.level <= 1 && c.activity >= 0 && c.activity <= 1, `level ${c.level} activity ${c.activity}`);
        ok(c.tone.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'bad tone');
      });
      ok(s.focus >= 0 && s.focus < sh.cells.length, 'focus out of range');
      prev = s.cells.map(c => c.st);
    }
    time += sh.dur;
    ok(seen.every(q => q.size > 1), `${sh.kind} shot (calm ${calm}): an orb stays in one state`);
    if (sh.kind === 'solo') ok(STATES.every(st => seen[0].has(st)), `solo shot misses a state: ${[...seen[0]].join(',')}`);
    for (const r of [rect, tall]) for (const t of [0, sh.dur / 2, sh.dur]) {
      const cs = layoutShot(sh, r, t);
      ok(cs.length === sh.cells.length, 'layout count');
      for (const c of cs) ok(c.s > 0 && c.x - c.s / 2 >= r.x - 0.5 && c.x + c.s / 2 <= r.x + r.w + 0.5 && c.y - c.s / 2 >= r.y - 0.5 && c.y + c.s / 2 <= r.y + r.h + 0.5,
        `${sh.kind} cell outside the rect ${JSON.stringify(c)} in ${JSON.stringify(r)}`);
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++)
        ok(Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y) >= (cs[i].s + cs[j].s) / 2 - 0.5 || Math.max(Math.abs(cs[i].x - cs[j].x), Math.abs(cs[i].y - cs[j].y)) >= (cs[i].s + cs[j].s) / 2 - 0.5, `${sh.kind} cells overlap`);
    }
  }
  ok(lo >= SHOT_MIN && hi <= SHOT_MAX, `calm ${calm}: shots last ${lo.toFixed(2)}..${hi.toFixed(2)} s`);
  const frac = active / frames;
  ok(frac >= 0.85, `calm ${calm}: only ${(frac * 100).toFixed(1)}% of frames have a non-idle orb`);
  changesPerSec[calm] = changes / time;
  console.log('calm', calm.toFixed(1), `shots ${lo.toFixed(2)}..${hi.toFixed(2)} s; non-idle frames ${(frac * 100).toFixed(1)}%; state changes ${(changes / time).toFixed(2)}/s; kinds ${JSON.stringify(kinds)}`);
}
ok(changesPerSec[1] < changesPerSec[0] && changesPerSec[1] > 0.5, 'calm 1 is not slower than calm 0, or it is static');

// dpr: the saver canvas on phones, a tablet and desktops
{
  const px = (w, h, n, d, c) => { const r = saverDpr(w, h, n, d, c); return Math.round(w * r) * Math.round(h * r); };
  for (const [w, h] of [[360, 640], [390, 844], [844, 390], [1024, 1366]]) for (const n of [1, 12]) {
    const r = saverDpr(w, h, n, 3, true);
    ok(r <= (n > 1 ? 1.25 : 1.5) && px(w, h, n, 3, true) <= SAVER_PHONE_PX * 1.01, `phone saver dpr ${w}x${h} n ${n}: ${r}`);
    console.log(`  saver dpr ${w}x${h} n=${n} touch: ${r.toFixed(3)}, ${(px(w, h, n, 3, true) / 1e6).toFixed(2)} Mpx`);
  }
  ok(saverDpr(1440, 900, 1, 2, false) === 2 && saverDpr(1440, 900, 12, 2, false) === 1.5, 'desktop saver keeps dpr 2 (one orb) and 1.5 (grid)');
  ok(px(3840, 2160, 1, 2, false) <= SAVER_MAX_PX * 1.01, 'a 4K desktop saver stays under 3840x2160 device px');
  ok(saverDpr(390, 844, 1, 1, true) === 1, 'a 1x screen keeps dpr 1');
}

console.log(fails ? `${fails} checks FAILED` : 'all checks pass');
process.exit(fails ? 1 : 0);
