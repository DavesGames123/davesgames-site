// survival_test.js - runs every creature of an unfiltered creatures.json in
// engine.js and keeps those that live.
//   python3 tools/build_creatures.py animals.json --out /tmp/all.json
//   deno run -A tools/survival_test.js /tmp/all.json keep.json
//   python3 tools/build_creatures.py animals.json --keep keep.json
//
// Each creature starts alone in the middle of a square world three times its
// size (128 cells or more). It runs for 40 units of time (40 T steps, 200 to
// 2000 steps). At the end it is in one of three classes:
//   live   mass is 0.5 to 2 times the start mass, and focus > 0.5 (the
//          mass has not spread over the whole torus)
//   grow   mass is more than 2 times the start, or focus <= 0.5. Chan's
//          catalog has growers on purpose: the chain (N+) creatures, and
//          the glider gun, puffers and methuselahs of the Game of Life.
//   die    mass is less than 0.5 times the start
// keep.json gets the live and grow creatures, with the class and the scale.
// A creature with R > 18 first runs at scale 18 / R, because the page is fast
// at R <= 18. That scale is kept only when the creature is live at it. Else
// the creature runs again at scale 1 and gets the class of that run.
//
// Detail check: with a creatures.json that already has scales and a
// detail factor d, each creature runs once at scale * d (the page's
// Detail setting) and the classes are compared with the stored class.
//   deno run -A tools/survival_test.js creatures.json detail2.json 2
import { createEngine, resample } from '../engine.js';

const [inPath, outPath, detailArg] = Deno.args;
const detail = detailArg ? +detailArg : 0;
const doc = JSON.parse(await Deno.readTextFile(inPath));
const engine = await createEngine(null);
const keep = {};
const tally = { live: 0, grow: 0, die: 0, scaled: 0 };

function cells(c) {
  const bin = atob(c.cells);
  const data = new Float32Array(c.w * c.h);
  for (let i = 0; i < data.length; i++) data[i] = bin.charCodeAt(i) / 255;
  return { w: c.w, h: c.h, data };
}

async function trial(c, scale) {
  const patch = resample(cells(c), scale);
  const n = Math.max(128, Math.ceil(Math.max(patch.w, patch.h) * 3 / 16) * 16);
  engine.setWorld(n, n);
  engine.setRule({ R: c.R * scale, T: c.T, m: c.m, s: c.s, b: c.b, kn: c.kn, gn: c.gn });
  engine.stamp(patch, n / 2, n / 2);
  const s0 = await engine.stats();
  const steps = Math.min(2000, Math.max(200, Math.round(40 * c.T)));
  for (let i = 0; i < steps; i += 250) engine.step(Math.min(250, steps - i));
  const s1 = await engine.stats();
  const ratio = s1.mass / s0.mass;
  const cls = !(ratio >= 0.5) ? 'die' : (ratio > 2 || s1.focus <= 0.5) ? 'grow' : 'live';
  return { cls, ratio, focus: s1.focus, max: s1.max, steps, n };
}

const t0 = performance.now();
if (detail) {
  const bad = [];
  for (const c of doc.creatures) {
    const res = await trial(c, c.scale * detail);
    const same = res.cls === c.cls || (c.cls === 'grow' && res.cls !== 'die');
    if (!same) bad.push(c);
    console.log(`${same ? 'SAME' : 'DIFF'}  ${String(c.id).padStart(3)} ${c.code.padEnd(8)} ${c.name.slice(0, 34).padEnd(34)} ${c.cls}->${res.cls}  R=${(c.R * c.scale * detail).toFixed(1)}  mass x${res.ratio.toFixed(2)} focus ${res.focus.toFixed(2)}`);
  }
  await Deno.writeTextFile(outPath, JSON.stringify(bad.map(c => c.id)));
  console.log(`\n${doc.creatures.length} tested at detail ${detail}: ${doc.creatures.length - bad.length} same class, ${bad.length} changed; ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  engine.destroy();
  Deno.exit(0);
}
for (const c of doc.creatures) {
  let res = null, scale = 1;
  if (c.R > 18) {
    scale = +(18 / c.R).toFixed(4);
    res = await trial(c, scale);
    if (res.cls !== 'live') { scale = 1; res = await trial(c, 1); }
    else tally.scaled++;
  } else {
    res = await trial(c, 1);
  }
  const tag = `${String(c.src).padStart(3)} ${c.code.padEnd(8)} ${c.name.slice(0, 34).padEnd(34)} R=${String(c.R).padStart(2)} x${scale}`;
  const nums = `mass x${res.ratio.toFixed(2)} focus ${res.focus.toFixed(2)} max ${res.max.toFixed(2)}`;
  tally[res.cls]++;
  if (res.cls !== 'die') keep[c.src] = { scale, cls: res.cls };
  console.log(`${res.cls.toUpperCase().padEnd(4)}  ${tag}  ${nums}`);
}
await Deno.writeTextFile(outPath, JSON.stringify(keep));
console.log(`\n${doc.creatures.length} tested: ${tally.live} live, ${tally.grow} grow, ${tally.die} die; ${tally.scaled} at scale 18/R; ${((performance.now() - t0) / 1000).toFixed(0)} s`);
engine.destroy();
