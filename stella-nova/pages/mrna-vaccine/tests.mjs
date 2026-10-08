// ============================================================================
//  MRNA VACCINE  ·  node tests for the pure logic  (node tests.mjs)
// ----------------------------------------------------------------------------
//  Checks data.js: the timeline is sorted and its dates are valid, every
//  source id resolves, efficacy from the case counts matches the published
//  values, the strand encodes the real spike stretches with both codon
//  sets, the LNP phases and pH are in order, the titre model peaks after
//  the boost, and the saver plan shuffles, varies by seed and cuts every
//  5 to 12 s. Exit code 1 on any failure.
// ============================================================================
import * as D from './data.js';

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

// timeline: valid dates, sorted, known sources, eras
const days = D.TIMELINE.map(e => D.dayNum(e.date));
ok(days.every(Number.isFinite), 'every timeline date parses');
for (const e of D.TIMELINE) {
  const [y, m, d] = e.date.split('-').map(Number);
  if (d) ok(new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d, `real calendar day ${e.date}`);
  ok(e.src.length > 0 && e.src.every(id => D.SOURCES[id]), `sources resolve for ${e.date}`);
  ok(!!D.ERAS[e.era], `era known for ${e.date}`);
}
ok(days.every((v, i) => !i || v >= days[i - 1]), 'timeline sorted by date');
ok(D.TIMELINE[0].date === '1961' && D.TIMELINE.at(-1).date === '2023-10-02', 'timeline runs 1961 to the 2023 Nobel');
for (const s of Object.values(D.SOURCES)) ok(s.url === null || /^https:\/\//.test(s.url), 'source url is https or null');

// day counts used in the hero
const d0 = D.dayNum('2020-01-11');
ok(D.dayNum('2020-03-16') - D.dayNum('2020-01-13') === 63, '63 days from sequence choice to first dose (Moderna count)');
ok(D.dayNum('2020-03-16') - d0 === 65, '65 days from posted genome to first dose');
ok(D.dayNum('2020-12-02') - d0 === 326, '326 days from posted genome to UK authorization');
ok(D.fmtDate('2020-12-02') === '2 December 2020' && D.fmtDate('1961') === '1961', 'date format');

// efficacy from case counts
const [bnt, mod] = D.TRIALS;
ok(bnt.casesV === 8 && bnt.casesP === 162 && mod.casesV === 11 && mod.casesP === 185, 'trial case counts');
const vb = D.ve(bnt.casesV, bnt.casesP), vm = D.ve(mod.casesV, mod.casesP);
ok(Math.abs(vb * 100 - bnt.ve) < 0.2, `BNT162b2 1 - 8/162 = ${(vb * 100).toFixed(2)} near ${bnt.ve}`);
ok(Math.abs(vm * 100 - mod.ve) < 0.2, `mRNA-1273 1 - 11/185 = ${(vm * 100).toFixed(2)} near ${mod.ve}`);
ok(D.ve(5, 10, 100, 200) === 0, 've uses group sizes');
ok(Number.isNaN(D.ve(1, 0)), 've undefined with no placebo cases');
ok(bnt.ci[0] < bnt.ve && bnt.ve < bnt.ci[1] && mod.ci[0] < mod.ve && mod.ve < mod.ci[1], 'efficacy inside its interval');

// genetic code and the strand
ok(Object.keys(D.CODE).length === 64 && D.CODE.AUG === 'M' && D.CODE.UGA === '*' && D.CODE.CCU === 'P' && D.CODE.UGG === 'W', 'genetic code');
for (const [aa, pair] of Object.entries(D.CODON_PICK)) ok(pair.every(c => D.CODE[c] === aa), `both codon picks encode ${aa}`);
for (const opt of [0, 1]) for (const p2 of [true, false]) {
  const T = D.buildStrand({ opt, p2 });
  const reg = T.map(t => t.region).filter((r, i, a) => r !== a[i - 1]);
  ok(reg.join() === 'cap,utr5,orf,utr3,polyA', `region order opt=${opt} p2=${p2}`);
  const cod = T.filter(t => t.codon && t.pos === 0).map(t => t.codon);
  const prot = D.translate(cod);
  const want = D.PEPTIDES.signal.seq + (p2 ? D.PEPTIDES.hinge.seq2P : D.PEPTIDES.hinge.seq) + '*';
  ok(prot === want, `strand encodes ${want} (got ${prot})`);
  const r986 = T.find(t => t.res === 986 && t.pos === 0), r987 = T.find(t => t.res === 987 && t.pos === 0);
  ok(r986.aa === (p2 ? 'P' : 'K') && r987.aa === (p2 ? 'P' : 'V'), `residues 986/987 p2=${p2}`);
  ok(T.filter(t => t.k === 'nt').every(t => 'ACGU'.includes(t.b)), 'bases are ACGU');
  const firstA = T.findIndex(t => t.region === 'polyA');
  ok(T.slice(firstA, firstA + 30).every(t => t.b === 'A'), 'poly(A) starts with A30');
}
const gc0 = D.gcFraction(D.codonsFor(D.PEPTIDES.signal.seq, 0)), gc1 = D.gcFraction(D.codonsFor(D.PEPTIDES.signal.seq, 1));
ok(gc1 > gc0, `GC-rich codons raise GC (${gc0.toFixed(2)} -> ${gc1.toFixed(2)})`);
ok(D.CONSTRUCT.regions.find(r => r.id === 'polyA').len === 110, 'poly(A) 110');

// decay, charge, journey
ok(Math.abs(D.remaining(8, 8) - 0.5) < 1e-12 && Math.abs(D.remaining(24, 8) - 0.125) < 1e-12, 'first-order half-life');
ok(Math.abs(D.protonated(D.LNP.pKa, D.LNP.pKa) - 0.5) < 1e-12, 'half charged at pH = pKa');
ok(D.protonated(7.4, D.LNP.pKa) < 0.1 && D.protonated(5.5, D.LNP.pKa) > 0.85, 'neutral in blood, charged in endosome');
ok(Math.abs(D.LNP.lipids.reduce((s, l) => s + l.mol, 0) - 1) < 1e-9, 'lipid shares sum to 1');
let lastI = 0, lastPH = 99;
for (let p = 0; p <= 1.0001; p += 0.01) {
  const j = D.journey(p);
  ok(j.i >= lastI && j.pH <= lastPH + 1e-12 && j.k >= 0 && j.k <= 1, `journey monotone at ${p.toFixed(2)}`);
  lastI = j.i; lastPH = j.pH;
}
ok(D.journey(0).id === 'blood' && D.journey(1).id === 'free' && D.journey(0).pH === 7.4 && D.journey(1).pH === 5.5, 'journey ends');
ok(D.JOURNEY.every((ph, i) => !i || ph.to > D.JOURNEY[i - 1].to) && D.JOURNEY.at(-1).to === 1, 'journey phase bounds');

// titre: zero before dose 1, the boost peak is higher, decays later
const doses = [0, 21];
let peak1 = 0, peak2 = 0;
for (let d = 0; d < 21; d += 0.5) peak1 = Math.max(peak1, D.titre(d, doses));
for (let d = 21; d < 80; d += 0.5) peak2 = Math.max(peak2, D.titre(d, doses));
ok(D.titre(0, doses) === 0 && D.titre(-3, doses) === 0, 'titre zero before dose 1');
ok(peak2 > 5 * peak1, `boost peak ${peak2.toFixed(2)} > 5x prime peak ${peak1.toFixed(2)}`);
ok(D.titre(150, doses) < peak2, 'titre wanes');

// saver plan
for (const seed of [1, 7, 42, 12345]) for (const calm of [0, 0.7, 1]) {
  const P = D.shotPlan(seed, 40, calm);
  ok(P.length === 40 && P.every(s => s.sec >= 5 && s.sec <= 12 && D.SHOTS.includes(s.id)), `plan cuts 5-12 s seed=${seed} calm=${calm}`);
  ok(P.every((s, i) => !i || s.id !== P[i - 1].id), `no shot twice in a row seed=${seed}`);
  for (let i = 0; i + 4 <= 40; i += 4) ok(new Set(P.slice(i, i + 4).map(s => s.id)).size === 4, `each pass shows all four seed=${seed}`);
}
const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(s => D.shotPlan(s, 8).map(x => x.id).join()));
ok(orders.size >= 4, `plans vary with the seed (${orders.size} distinct of 8)`);
ok(D.shotPlan(9, 12).map(x => x.id + x.sec).join() === D.shotPlan(9, 12).map(x => x.id + x.sec).join(), 'plan is deterministic per seed');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
