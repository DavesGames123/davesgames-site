// ============================================================================
//  ENIGMA ROTORS  ·  tests.mjs — node stella-nova/pages/enigma-rotors/tests.mjs
// ----------------------------------------------------------------------------
//  Checks mech.js:
//    wirings ...... each rotor wiring is a permutation; reflector B is an
//                   involution with no fixed letter
//    vector 1 ..... I II III, B, rings AAA, start AAA: AAAAA -> BDZGO
//    double step .. I II III from ADU: ADV, AEW, BFX (the middle rotor
//                   steps on two presses in a row)
//    vector 2 ..... the Barbarossa message of 7 July 1941 (II IV V, rings
//                   BUL, ten plugs, start BLA): the cipher text decrypts to
//                   the published plain text
//    properties ... encrypt then decrypt from the same start gives the
//                   text back; no letter encrypts to itself; the rotor
//                   positions repeat after 26 * 25 * 26 = 16900 presses
//    path ......... the absolute contacts that scene.js draws give the
//                   lamp letter, and the path is symmetric (the lamp letter
//                   pressed gives the key letter)
// ============================================================================
import { ROTORS, REFLECTORS, UNITS, makeEnigma, pressSeries, stepPos, L2N, ALPHA } from './mech.js';

let fail = 0, n = 0;
const ok = (c, msg) => { n++; if (!c) { fail++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const cfg = (o = {}) => ({ rotors: ['I', 'II', 'III'], reflector: 'B', rings: 'AAA', start: 'AAA', plugs: '', ...o });

// wirings
for (const [k, r] of Object.entries(ROTORS)) ok([...r.wiring].sort().join('') === ALPHA, `rotor ${k}: wiring is a permutation`);
const U = [...REFLECTORS.B].map(L2N);
ok(U.every((v, i) => U[v] === i && v !== i), 'reflector B: involution, no fixed letter');

// vector 1
const v1 = makeEnigma(cfg()).encode('AAAAA');
ok(v1 === 'BDZGO', `I II III AAA: AAAAA -> ${v1} (want BDZGO)`);

// double step
const E = makeEnigma(cfg({ start: 'ADU' })), seen = [];
for (let i = 0; i < 3; i++) { E.press('A'); seen.push(E.window()); }
ok(seen.join(' ') === 'ADV AEW BFX', `double step from ADU: ${seen.join(' ')} (want ADV AEW BFX)`);
const ser = pressSeries(cfg({ start: 'ADU' }), 'A', 3);
ok(!ser[0].dbl && !ser[1].dbl && ser[2].dbl, 'own-notch step flagged on the third press only (AEW -> BFX)');
ok(JSON.stringify(stepPos([0, 4, 21], [16, 4, 21]).why) === '["R","M","L"]', 'stepPos: middle at its notch moves all three');

// vector 2: Barbarossa, 7 July 1941, part 1 (first group RFUGZ is the
// identification group and is not enciphered)
const bar = UNITS.find(u => u.id === 'barbarossa');
const want2 = 'AUFKLXABTEILUNGXVONXKURTINOWAXKURTINOWAXNORDWESTLXSEBEZXSEBEZXUAFFLIEGERSTRASZERIQTUNGXDUBROWKIXDUBROWKIXOPOTSCHKAXOPOTSCHKAXUMXEINSAQTDREINULLXUHRANGETRETENXANGRIFFXINFXRGTX';
const got2 = makeEnigma(bar).encode(bar.tape);
const same = [...want2].filter((c, i) => got2[i] === c).length;
ok(got2 === want2, `Barbarossa: ${same}/${want2.length} letters match; starts ${got2.slice(0, 20)}`);

// properties
const txt = 'DERFUEHRERISTTOTXDERKAMPFGEHTWEITERX'.repeat(60);
const c1 = makeEnigma(cfg({ start: 'QEV', rings: 'CXF', plugs: 'AZ BY' })).encode(txt);
ok(makeEnigma(cfg({ start: 'QEV', rings: 'CXF', plugs: 'AZ BY' })).encode(c1) === txt, `reciprocal over ${txt.length} letters`);
ok([...c1].every((c, i) => c !== txt[i]), 'no letter encrypts to itself');
const P = makeEnigma(cfg()), w0 = P.window();
let period = 0;
for (let i = 1; i <= 17000; i++) { P.press('A'); if (P.window() === w0) { period = i; break; } }
ok(period === 16900, `position period ${period} (want 16900)`);

// path
const S = pressSeries(bar, bar.tape, 200);
ok(S.every(p => p.a.length === 8 && makeEnigma(bar).plugs[p.a[7]] === p.out), 'path: 8 absolute contacts, the last one is the lamp (after the plugs)');
const Q = makeEnigma(cfg({ start: 'KQR' }));
Q.pos = 'KQR';
ok(ALPHA.split('').every(ch => Q.trace(Q.trace(L2N(ch)).out).out === L2N(ch)), 'path is symmetric at a fixed position');

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
