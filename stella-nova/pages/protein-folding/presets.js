// ============================================================================
//  PROTEIN FOLDING  ·  presets.js — preset list and one-line notes
// ----------------------------------------------------------------------------
//  Go presets point at a record in proteins.js. tm is the temperature where
//  Q falls through 0.5 in a slow heating scan from the native state, in this
//  model (eps/kB). A heating scan lags the true melting point, so tm is an
//  upper estimate, more so for large proteins. fold (const FOLD) is the
//  default run temperature as a fraction of tm. Lattice presets point at
//  HP_BENCH.
//
//  grep: const GROUPS  const GO  const HP_NOTES  const FOLD  export const PRESETS
// ============================================================================
import { HP_BENCH } from './lattice.js';

export const GROUPS = [
  ['mini', 'Hairpins and mini-proteins'],
  ['fast', 'Fast folders'],
  ['classic', 'Two-state classics'],
  ['big', 'Larger and slower'],
  ['limits', 'Model limits'],
  ['hp', 'HP lattice benchmarks'],
];

// id, group, name, tm, note
const GO = [
  ['cln025', 'mini', 'CLN025 chignolin', 0.86, 'A 10-residue designed hairpin (YYDPETGTWY). Folds in about 100 ns in water; here the zip-up takes under a second.'],
  ['chignolin', 'mini', 'Chignolin (original)', 0.87, 'The first chignolin (NMR). To a Go model it is the same as CLN025: the end mutations that make CLN025 more stable are invisible here.'],
  ['gb1hairpin', 'mini', 'GB1 hairpin 41-56', 0.79, 'The C-terminal hairpin of protein G, cut out. In water only about 40% of it is folded at room temperature; this model folds it fully when cold.'],
  ['trpcage', 'mini', 'Trp-cage TC5b', 0.82, 'Twenty residues: a helix, a short 3-10 turn and a polyproline strand wrapped round Trp6. Real Trp-cage needs that Trp; here any bead would do.'],
  ['bba', 'mini', 'BBA (FSD-EY)', 0.81, 'A zinc-free beta-beta-alpha design. Frustrated and hard in all-atom force fields, smooth in a native-centric model.'],
  ['villin', 'mini', 'Villin headpiece HP35', 1.0, 'Three helices round a Phe core (N68H crystal). A microsecond folder and the most simulated protein of its time.'],
  ['ww', 'fast', 'Pin1 WW domain', 1.15, 'A three-stranded sheet. In the real protein the first loop limits the rate.'],
  ['fip35', 'fast', 'FiP35 WW', 1.02, 'Pin1 WW with a shorter first loop, which folds several times faster in water. A Go model hardly sees the change: compare it with Pin1 WW.'],
  ['ntl9', 'fast', 'NTL9 (K12M)', 1.16, 'N-terminal domain of ribosomal protein L9: a mixed alpha/beta fold whose sheet pairs strands from both ends of the chain.'],
  ['proteinb', 'fast', 'Albumin-binding GA', 0.98, 'A three-helix albumin-binding module that folds in microseconds.'],
  ['engrailed', 'fast', 'Engrailed homeodomain', 0.99, 'A three-helix DNA-binding fold. In water it folds through a helical intermediate in microseconds.'],
  ['proteina', 'fast', 'Protein A B-domain', 0.85, 'A three-helix bundle and a standard test case for structure-based models.'],
  ['alpha3d', 'fast', 'alpha3D', 0.98, 'A 73-residue designed three-helix bundle that folds in a few microseconds.'],
  ['lambda', 'fast', 'Lambda repressor 6-85', 1.03, 'The five-helix N-terminal domain. Fast mutants of it fold in microseconds.'],
  ['proteing', 'classic', 'Protein G B1', 1.21, 'A four-stranded sheet packed on one helix. In water the second hairpin forms first.'],
  ['proteinl', 'classic', 'Protein L B1', 1.15, 'Same topology as protein G, but in water the first hairpin forms first. Pure Go models struggle to tell the two apart, which is the point.'],
  ['sh3', 'classic', 'Spectrin SH3', 1.19, 'A five-stranded beta barrel and a two-state folder with a polarised transition state.'],
  ['ci2', 'classic', 'CI2 20-83', 1.1, 'Chymotrypsin inhibitor 2, the two-state folder of phi-value analysis and an early Go-model success.'],
  ['ubiquitin', 'classic', 'Ubiquitin', 1.11, 'The beta-grasp fold, 76 residues. At 0.7 Tm it folds here in about 3e5 to 6e5 steps: ten seconds or so at full speed.'],
  ['titin', 'classic', 'Titin I27', 1.1, 'The Ig domain of AFM unfolding experiments. Start it native and pull the termini.'],
  ['tenascin', 'classic', 'Tenascin FN3', 1.23, 'A beta sandwich held by contacts far apart in sequence. Slow in this model too; lower the friction to help it.'],
  ['top7', 'big', 'Top7 (designed)', 1.12, 'A fold designed by computer with no natural relative. It folds quickly in this model.'],
  ['s6', 'big', 'Ribosomal S6', 1.16, 'A ferredoxin-like split beta-alpha-beta fold. Its sheet pairs strands that are far apart, so it often stalls half folded here.'],
  ['barnase', 'big', 'Barnase', 1.21, 'The 108-residue ribonuclease of phi-value analysis. Takes minutes here; watch the helices form first.'],
  ['chey', 'big', 'CheY', 1.18, 'A 128-residue flavodoxin fold. In water it passes a misfolded intermediate that this model cannot form: only native contacts attract.'],
  ['myoglobin', 'big', 'Apomyoglobin (no heme)', 0.99, 'Eight helices, 153 residues, the largest preset: the helices form fast, the packing can take minutes. Real apomyoglobin stays partly unfolded without its heme; this model folds all of it because the native map says so.'],
  ['rhodopsin', 'limits', 'Rhodopsin 1-64 (N-term + TM1)', 0.97, 'Cut from a membrane protein. The model folds it anyway, because the contacts are given. P23H, the commonest retinitis pigmentosa mutation, misfolds and is held in the ER; a native-centric model cannot show that.'],
];

const HP_NOTES = {
  hp20: 'Unger-Moult 20-mer. Best known on the square lattice: E = -9. Replica exchange finds it in seconds.',
  hp24: '24-mer. Best known E = -9.',
  hp25: '25-mer. Best known E = -8; only 8 H and many ways to place them.',
  hp36: '36-mer. Best known E = -14.',
  hp48: '48-mer. Best known E = -23.',
  hp50: '50-mer. Best known E = -21.',
  hp60: '60-mer. Best known E = -36 (first reports said -35). A few minutes of search may stop at -34 or -35.',
  hp64: '64-mer. Best known E = -42. Simple Monte Carlo stalls here; this is why folding is hard.',
};

// Default run temperature as a fraction of tm. The value is the faster of
// 0.6 and 0.7 tm in a sweep (median time to Q >= 0.8 over 3 coil starts);
// the mini-proteins use 0.8, which tests.mjs checks.
const FOLD = {
  ww: 0.7, fip35: 0.7, ntl9: 0.7, proteinb: 0.6, engrailed: 0.6, proteina: 0.6, alpha3d: 0.6, lambda: 0.6,
  proteing: 0.6, proteinl: 0.7, sh3: 0.6, ci2: 0.6, ubiquitin: 0.7, titin: 0.6, tenascin: 0.6,
  top7: 0.6, s6: 0.6, barnase: 0.6, chey: 0.7, myoglobin: 0.6, rhodopsin: 0.6,
};
export const PRESETS = [
  ...GO.map(([id, group, name, tm, note]) => ({ kind: 'go', id, group, name, tm, note, fold: FOLD[id] ?? 0.8 })),
  ...HP_BENCH.map(b => ({ kind: 'hp', id: b.id, group: 'hp', name: `HP ${b.seq.length}-mer`, seq: b.seq, best: b.best, note: HP_NOTES[b.id] })),
];
export const presetById = id => PRESETS.find(p => p.id === id);
