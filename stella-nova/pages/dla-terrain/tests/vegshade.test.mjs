// tests/vegshade.test.mjs — plant and prop light at every governor level
// (node, no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/vegshade.test.mjs
//
// Why (2026-10-18, the user): "this is albedo only, it's got no shading
// when under shadow from cloud cover and the trees themselves aren't
// getting any shadows when sunlight is on them either". At the governor
// emergency level the cascades hold no casters. These checks make sure
// that shaders/props.wgsl still applies the sun, the sky ambient, the AO,
// the cloud shadow, the crown self shadow and the ridge shadow then.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vegShadowsOn, crownTermsCPU, standInProto } from '../render/vegetation.js';

const here = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} vegshade: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} vegshade: ${name} ${extra}`); }
}
const src = readFileSync(here('shaders/props.wgsl'), 'utf8').replace(/\/\/.*$/gm, '');
const body = (name) => {
  const i = src.indexOf('fn ' + name + '(');
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(j, k + 1); }
  return '';
};

// 1 the governor emergency level turns the map off for the plants
ok(vegShadowsOn({ govLevel: 0, shadowInfo: {} }) === 1, 'level 0 with a shadow list: the cascades are on');
ok(vegShadowsOn({ govLevel: 5, shadowInfo: {} }) === 0, 'emergency (govLevel 5): the cascades are off');
ok(vegShadowsOn({ govLevel: 1, gov: { keys: ['emergency'] }, shadowInfo: {} }) === 0, 'emergency gov key: the cascades are off');
ok(vegShadowsOn({ shadowInfo: null }) === 0, 'no shadow list: off');

// 2 shadeVeg: the terms that do not need the map
const sv = body('shadeVeg');
ok(/vegCloud\(/.test(sv), 'shadeVeg applies the cloud shadow');
ok(/G\.ambient/.test(sv) && /\bao\b/.test(sv), 'shadeVeg applies the sky ambient times the AO');
ok(/G\.sunColor/.test(sv) && /dot\(n, L\)/.test(sv), 'shadeVeg applies the sun with N.L');
ok(/extSh/.test(sv), 'shadeVeg takes the external sun visibility (crown, ridge)');
ok(/if \(VP\.sun\.w > 0\.5\) \{ map = sunShadowSoft/.test(sv), 'the map is read only while it holds casters');
ok(!/return alb/.test(sv), 'no albedo-only return');
for (const fs of ['fs_mesh', 'fs_imp']) {
  const b = body(fs);
  ok(/crownTerms\(/.test(b) && /shadeVeg\(/.test(b) && /tsh/.test(b), `${fs}: crown terms, the ridge shadow and shadeVeg`);
}
ok(/terrainSunVis\(/.test(body('vs_mesh')) && /terrainSunVis\(/.test(body('vs_imp')), 'the vertex shaders march the ridge shadow');
ok(/VEG_MARCH/.test(body('terrainSunVis')) && /const VEG_MARCH: u32 = 8u;/.test(src), 'the ridge march has a constant cap');
ok(/needMarch/.test(src) && /VP\.sun\.w < 0\.5/.test(body('needMarch')), 'the ridge march runs where the cascades do not cover');

// 3 the crown terms (CPU twin of fn crownTerms) on a stand-in oak
const oak = standInProto('oak');
const it = [0, 0, 0, 1, 0, oak.species, 0, 0.5];
const h = oak.spec[0], sun = [0.6, 0.6, 0.2];
const sl = Math.hypot(...sun), L = sun.map((v) => v / sl);
const cy = h * 0.64 - oak.spec[6] * h, R = Math.max(oak.spec[1], 0.2 * h);
const lit = crownTermsCPU([L[0] * R * 0.98, cy + L[1] * h * 0.33, L[2] * R * 0.98], it, oak.spec, sun);
const dark = crownTermsCPU([-L[0] * R * 0.98, cy - L[1] * h * 0.33, -L[2] * R * 0.98], it, oak.spec, sun);
const mid = crownTermsCPU([0, cy, 0], it, oak.spec, sun);
ok(lit[0] > 0.9, `sun side of the crown is lit (${lit[0].toFixed(2)})`);
ok(dark[0] < 0.35, `far side of the crown is in its own shadow (${dark[0].toFixed(2)})`);
ok(mid[1] < lit[1] && mid[1] < 0.7, `crown AO darker inside (${mid[1].toFixed(2)} < ${lit[1].toFixed(2)})`);
const rock = standInProto('rock');
ok(crownTermsCPU([0, 0.3, 0], [0, 0, 0, 1, 0, rock.species, 0, 0.5], rock.spec, sun).join() === '1,1', 'rocks take no crown terms');

console.log(`# vegshade: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
