// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  tests.mjs — node tests.mjs
// ────────────────────────────────────────────────────────────────────────────
//  Checks generator.js without a browser: the same seed gives the same
//  piece; every registered type and every fitting calibre turns up; each calibre only goes in a type
//  that allows it; the seconds display matches the calibre; locks keep
//  their section; maker names never print a real watch or clock house.
// ============================================================================
import * as Gen from './generator.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const J = x => JSON.stringify(x);

ok(J(Gen.makeSpec('abc123')) === J(Gen.makeSpec('abc123')), 'the same seed gives the same spec');
ok(J(Gen.makeSpec('abc123')) !== J(Gen.makeSpec('abc124')), 'a different seed gives a different spec');

const N = 4000, seen = { type: {}, calibre: {}, base: {}, hands: {} };
let bad = [], secBad = [];
// the seconds display each calibre should get: CALIBRE_INFO, with small
// seconds dropped in a clock
const wantSeconds = (type, c) => { const v = (Gen.CALIBRE_INFO[c] || {}).seconds || 'none'; return Gen.TYPES[type].clock && v === 'small' ? 'none' : v; };
for (let i = 0; i < N; i++) {
  const s = Gen.makeSpec('s' + i);
  seen.type[s.type] = (seen.type[s.type] || 0) + 1;
  seen.calibre[s.movement.calibre] = (seen.calibre[s.movement.calibre] || 0) + 1;
  seen.base[s.face.base] = 1; seen.hands[s.face.handStyle] = 1;
  if (!Gen.TYPES[s.type].calibres.some(([c]) => c === s.movement.calibre)) bad.push(`${s.type}/${s.movement.calibre}`);
  const want = wantSeconds(s.type, s.movement.calibre);
  if (s.face.seconds !== want) secBad.push(`${s.type}/${s.movement.calibre}/${s.face.seconds}`);
}
const NT = Object.keys(Gen.TYPES).length, NC = new Set(Object.values(Gen.TYPES).flatMap(t => t.calibres.map(c => c[0])).filter(c => Gen.CALIBRE_INFO[c])).size;
ok(Object.keys(seen.type).length === NT, `every type turns up (${NT})`, J(seen.type));
ok(Object.keys(seen.calibre).length === NC, `every fitting calibre turns up (${NC})`, J(seen.calibre));
ok(Gen.DIAL_BASES.every(b => seen.base[b]), 'every dial base turns up', Object.keys(seen.base).length + ' of ' + Gen.DIAL_BASES.length + ' bases');
ok(bad.length === 0, 'each calibre only in a type that allows it', bad.slice(0, 5).join(', '));
ok(secBad.length === 0, 'the seconds display matches the calibre', secBad.slice(0, 5).join(', '));
ok(Gen.makeSpec('x', { type: 'alarm' }).type === 'alarm', 'a fixed type is kept');

{
  const a = Gen.makeSpec('lock1');
  const b = Gen.makeSpec('lock2', { prev: a, keep: { movement: true } });
  ok(J(b.movement) === J(a.movement) && b.type === a.type, 'a kept movement keeps the movement and the type');
  const c = Gen.makeSpec('lock3', { prev: a, keep: { case: true }, type: a.type });
  ok(J(c.case) === J(a.case), 'a kept case keeps the case');
  const d = Gen.makeSpec('lock4', { prev: a, keep: { face: true } });
  ok(d.face.brand === a.face.brand && d.face.base === a.face.base, 'a kept face keeps its look');
}

{
  let real = [], n = 0;
  const R = Gen.rng('names');
  for (let i = 0; i < 20000; i++) {
    const name = Gen.makerName(R), toks = name.toLowerCase().replace(/[^a-zà-ÿ ]/g, ' ').split(/\s+/);
    n++;
    if (toks.some(t => Gen.REAL_BRANDS.includes(t))) real.push(name);
  }
  ok(real.length === 0, 'maker names never use a real brand word', `${real.length}/${n}`);
}
{
  const rows = Gen.describe(Gen.makeSpec('desc'));
  ok(rows.length >= 6 && rows.every(r => r[0] && r[1] && !String(r[1]).includes('undefined')), 'describe() gives filled rows', rows.length + ' rows');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
