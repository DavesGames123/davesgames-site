// ============================================================================
//  PROTEIN VIEWER  ·  colors.js — the colour schemes and their legends
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE. Colours are sRGB in 0..1; the renderer converts to
//  linear. Each scheme gives one colour per residue (the cartoon, the
//  surface and the sequence strip use it) and one per atom (the atom reps):
//    chain ...... a pastel per chain, with no green (green is for ligands)
//    ss ......... helix, 3-10 helix, strand, coil, nucleic acid
//    residue .... amino-acid class, and A/T/G/C/U for nucleotides
//    hydro ...... Kyte-Doolittle hydropathy, blue (polar) to orange (apolar)
//    bfactor .... the 5th..95th percentile of the file's B-factors
//    plddt ...... the four AlphaFold DB confidence bands
//    rainbow .... N- to C-terminus inside each chain
//    element .... CPK-like, with carbons grey (ligand carbons green)
//  In the atom reps, N, O, S, P and metals keep their element colour in
//  every scheme (opts.hetero), so the chemistry stays readable.
//
//  grep: export const SCHEMES  function residueColors  function atomColors
//        export function legend  const KD  const ELEMENT
// ============================================================================

export const SCHEMES = [
  { id: 'chain', label: 'Chain' },
  { id: 'ss', label: 'Secondary' },
  { id: 'residue', label: 'Residue' },
  { id: 'hydro', label: 'Hydropathy' },
  { id: 'bfactor', label: 'B-factor' },
  { id: 'plddt', label: 'pLDDT' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'element', label: 'Element' },
];

const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const toHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

export const CHAIN = ['#6ea8ff', '#ff8a65', '#c39bff', '#ffd166', '#4dd0e1', '#f48fb1', '#a5c8ff', '#ffb38a', '#b39ddb', '#fff0a0', '#80deea', '#f8bbd0'].map(hex);
export const SS = { H: hex('#ff5c8a'), G: hex('#ff9ab8'), E: hex('#ffcc4a'), C: hex('#d4dae6'), N: hex('#7cc6fe') };
export const LIGAND_C = hex('#4fe08f');
export const ELEMENT = {
  C: hex('#a9b2c2'), N: hex('#4f7bff'), O: hex('#ff4a4a'), S: hex('#ffd23f'), P: hex('#ff9a3c'), H: hex('#eef1f6'),
  FE: hex('#e0783f'), ZN: hex('#8a90d8'), MG: hex('#8aff6a'), CA: hex('#6ae08a'), NA: hex('#ab5cf2'), K: hex('#a24ee6'),
  CL: hex('#2fe02f'), MN: hex('#a77ad7'), SE: hex('#ffa100'), HG: hex('#c8c8e0'), BR: hex('#b33a3a'), F: hex('#90e050'),
  I: hex('#a020a0'), CU: hex('#c88033'), CO: hex('#f090a0'), NI: hex('#50d050'), CD: hex('#ffd98f'),
};
const X = hex('#ff69b4');
// Kyte & Doolittle (1982) hydropathy
export const KD = { ILE: 4.5, VAL: 4.2, LEU: 3.8, PHE: 2.8, CYS: 2.5, MET: 1.9, ALA: 1.8, GLY: -0.4, THR: -0.7, SER: -0.8,
  TRP: -0.9, TYR: -1.3, PRO: -1.6, HIS: -3.2, GLU: -3.5, GLN: -3.5, ASP: -3.5, ASN: -3.5, LYS: -3.9, ARG: -4.5, MSE: 1.9 };
const CLASS = {
  aliphatic: { res: 'ALA VAL LEU ILE MET MSE', c: hex('#efd9a0'), label: 'Aliphatic' },
  aromatic: { res: 'PHE TRP TYR', c: hex('#c38bf0'), label: 'Aromatic' },
  polar: { res: 'SER THR ASN GLN', c: hex('#86d1e6'), label: 'Polar' },
  basic: { res: 'LYS ARG HIS', c: hex('#4f6dff'), label: 'Basic' },
  acidic: { res: 'ASP GLU', c: hex('#ff5a5f'), label: 'Acidic' },
  gly: { res: 'GLY', c: hex('#eeeeee'), label: 'Gly' },
  pro: { res: 'PRO HYP', c: hex('#f5a3c7'), label: 'Pro' },
  cys: { res: 'CYS', c: hex('#ffe066'), label: 'Cys' },
};
const CLASS_OF = {};
for (const k in CLASS) for (const r of CLASS[k].res.split(' ')) CLASS_OF[r] = CLASS[k].c;
const BASE = { A: hex('#ff7a6b'), G: hex('#5fd38a'), C: hex('#5aa2ff'), T: hex('#ffd25a'), U: hex('#ffb35a'), N: hex('#c8c8c8') };
const RAINBOW = ['#3d5afe', '#00a6ff', '#16e0c0', '#a8f040', '#ffe14d', '#ff9a3c', '#ff3d5a'].map(hex);
const BWR = [hex('#3e6bff'), hex('#eef0f6'), hex('#ff4040')];
const HYD = [hex('#3f86ff'), hex('#eef0f6'), hex('#ff9a2e')];
export const PLDDT = [
  { min: 90, c: hex('#0053d6'), label: 'Very high (>90)' },
  { min: 70, c: hex('#65cbf3'), label: 'Confident (70–90)' },
  { min: 50, c: hex('#ffdb13'), label: 'Low (50–70)' },
  { min: -1, c: hex('#ff7d45'), label: 'Very low (<50)' },
];
const ramp = (stops, t) => {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[i], stops[i + 1], t - i);
};
const plddtColor = b => PLDDT.find(p => b > p.min || p.min < 0).c;

function bRange(s) {
  const v = [];
  for (const r of s.residues) if ((r.kind === 'protein' || r.kind === 'nucleic') && r.ca >= 0) v.push(s.atoms[r.ca].b);
  if (!v.length) for (const a of s.atoms) v.push(a.b);
  v.sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * 0.05)] ?? 0, hi = v[Math.floor(v.length * 0.95)] ?? 1;
  return [lo, hi > lo ? hi : lo + 1];
}

// one colour per residue
export function residueColors(s, scheme) {
  const R = s.residues, out = new Float32Array(R.length * 3);
  const [blo, bhi] = scheme === 'bfactor' ? bRange(s) : [0, 1];
  // rainbow index inside each chain's polymer
  const pidx = new Float32Array(R.length);
  if (scheme === 'rainbow') for (const ch of s.chains) {
    const pol = ch.residues.filter(i => R[i].kind === 'protein' || R[i].kind === 'nucleic');
    pol.forEach((ri, k) => { pidx[ri] = pol.length > 1 ? k / (pol.length - 1) : 0; });
  }
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    const pol = r.kind === 'protein' || r.kind === 'nucleic';
    let c;
    if (!pol) {
      c = r.kind === 'ligand' ? LIGAND_C : r.kind === 'water' ? ELEMENT.O : (ELEMENT[s.atoms[r.atoms[0]].el] || X);
      if (scheme === 'chain' && r.kind !== 'ion' && r.kind !== 'water') c = LIGAND_C;
    } else switch (scheme) {
      case 'chain': c = CHAIN[r.chain % CHAIN.length]; break;
      case 'ss': c = r.kind === 'nucleic' ? SS.N : SS[r.ss] || SS.C; break;
      case 'residue': c = r.kind === 'nucleic' ? (BASE[r.code] || BASE.N) : (CLASS_OF[r.name] || hex('#cccccc')); break;
      case 'hydro': c = r.kind === 'nucleic' ? hex('#9aa4b8') : ramp(HYD, ((KD[r.name] ?? 0) + 4.5) / 9); break;
      case 'bfactor': c = ramp(BWR, ((r.ca >= 0 ? s.atoms[r.ca].b : 0) - blo) / (bhi - blo)); break;
      case 'plddt': c = plddtColor(r.ca >= 0 ? s.atoms[r.ca].b : 0); break;
      case 'rainbow': c = ramp(RAINBOW, pidx[i]); break;
      case 'element': default: c = r.kind === 'nucleic' ? hex('#c9cfdb') : ELEMENT.C; break;
    }
    out[3 * i] = c[0]; out[3 * i + 1] = c[1]; out[3 * i + 2] = c[2];
  }
  return out;
}

// one colour per atom; resCol from residueColors
export function atomColors(s, scheme, resCol, opts = { hetero: true }) {
  const A = s.atoms, out = new Float32Array(A.length * 3);
  const [blo, bhi] = scheme === 'bfactor' ? bRange(s) : [0, 1];
  for (let i = 0; i < A.length; i++) {
    const a = A[i], r = s.residues[a.res];
    let c;
    if (scheme === 'element') c = a.el === 'C' ? (r.kind === 'ligand' ? LIGAND_C : ELEMENT.C) : ELEMENT[a.el] || X;
    else if (scheme === 'bfactor') c = ramp(BWR, (a.b - blo) / (bhi - blo));
    else if (opts.hetero && a.el !== 'C' && a.el !== 'H' && r.kind !== 'ion') c = ELEMENT[a.el] || X;
    else { c = [resCol[3 * a.res], resCol[3 * a.res + 1], resCol[3 * a.res + 2]]; if (a.el === 'H') c = mix(c, [1, 1, 1], 0.5); }
    out[3 * i] = c[0]; out[3 * i + 1] = c[1]; out[3 * i + 2] = c[2];
  }
  return out;
}

// legend: { kind: 'swatch', items: [{c, label}] } or { kind: 'ramp', stops, lo, hi, label }
export function legend(s, scheme) {
  const sw = items => ({ kind: 'swatch', items: items.map(([c, label]) => ({ c: toHex(c), label })) });
  switch (scheme) {
    case 'chain': {
      const ch = s.chains.filter(c => c.residues.some(i => s.residues[i].kind === 'protein' || s.residues[i].kind === 'nucleic'));
      return sw(ch.slice(0, 12).map((c) => [CHAIN[s.chains.indexOf(c) % CHAIN.length], 'Chain ' + c.id]).concat([[LIGAND_C, 'Ligand C']]));
    }
    case 'ss': return sw([[SS.H, 'α-helix'], [SS.G, '3₁₀-helix'], [SS.E, 'β-strand'], [SS.C, 'Coil'], [SS.N, 'Nucleic']]);
    case 'residue': {
      const it = s.residues.some(r => r.kind === 'protein') ? Object.values(CLASS).map(k => [k.c, k.label]) : [];
      if (s.residues.some(r => r.kind === 'nucleic')) it.push([BASE.A, 'A'], [BASE.G, 'G'], [BASE.C, 'C'], [BASE.T, 'T'], [BASE.U, 'U']);
      return sw(it);
    }
    case 'hydro': return { kind: 'ramp', stops: HYD.map(toHex), lo: 'Polar −4.5', hi: '+4.5 Apolar', label: 'Kyte–Doolittle' };
    case 'bfactor': { const [lo, hi] = bRange(s); return { kind: 'ramp', stops: BWR.map(toHex), lo: lo.toFixed(0) + ' Å²', hi: hi.toFixed(0) + ' Å²', label: s.meta.af ? 'B column (pLDDT here)' : 'B-factor' }; }
    case 'plddt': return sw(PLDDT.map(p => [p.c, p.label]));
    case 'rainbow': return { kind: 'ramp', stops: RAINBOW.map(toHex), lo: 'N', hi: 'C', label: 'Sequence position' };
    case 'element': return sw([[ELEMENT.C, 'C'], [ELEMENT.N, 'N'], [ELEMENT.O, 'O'], [ELEMENT.S, 'S'], [ELEMENT.P, 'P'], [LIGAND_C, 'Ligand C']]);
  }
  return sw([]);
}
