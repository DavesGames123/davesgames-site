// ============================================================================
//  DESIGN  ·  the design format, its checker and the motif language
// ----------------------------------------------------------------------------
//  One format carries every design on this page: the motif builder
//  (motif.js), the scaffolder (scaffold.js), the sequence designer
//  (sequence.js), the metrics (metrics.js) and the viewer (view3d.js).
//  No DOM, so Node can import it and the tools can test it.
//
//  Coordinates are angstroms (A). A design is one protein chain plus one
//  fixed ligand. The chain is a backbone trace: each residue keeps its
//  C-alpha point and a C-beta point that gives the side-chain direction.
//  A full backbone is not modelled. The real model generates all atoms.
//
//  Design = {
//    n,       number of residues in the chain
//    ca,      Float32Array n*3, C-alpha positions
//    cb,      Float32Array n*3, C-beta positions (side-chain direction)
//    fixed,   Uint8Array n, 1 where the residue belongs to the motif
//    motifId, Int32Array n, index into motif.residues, or -1
//    seq,     string of n letters, 'X' where no amino acid is assigned
//    ss,      string of n characters, 'H' helix, 'E' strand, 'L' loop
//    ligand,  { name, atoms: [{ name, el, x, y, z }] }  held fixed
//    meta,    { seed, steps, motifStr, seqLength, ... }  free-form
//  }
//
//  THE MOTIF LANGUAGE. parseMotifStr reads the `motif_str` field of an
//  AP Novo design manifest, which the AlphaProtein Novo README documents.
//  Chains are delimited by '/'. The first chain is a comma-separated list
//  of segments. A segment is one of:
//    A1      residue 1 of input chain A, held at its input coordinates
//    A5-6    residues 5 to 6 of input chain A, held
//    3       three designed residues
//    5-10    between 5 and 10 designed residues, sampled once per design
//  Later chains hold one residue each: a ligand, always fixed.
//  A '|' gives the order of the motif segments to sample. The text before
//  '|' lists the motif groups. The text after it is the template, and each
//  '{}' takes one group. The parser puts a random permutation of the groups
//  into the placeholders, so 'A1,A2|{},5-10,{}' gives 'A1,5-10,A2' or
//  'A2,5-10,A1'.
//
//  EXPORTS   (grep -n "<anchor>" design.js)
//    limits ........... "export const LIMITS"
//    residue read ..... "export function resAt"
//    checker .......... "export function validate"
//    motif language ... "export function parseMotifStr"
//    plan a chain ..... "export function planChain"
//    seeded random .... "export function rng"
// ============================================================================

export const LIMITS = { minLen: 40, maxLen: 320, maxLigandAtoms: 120 };

// Amino acids, one letter. 'X' means no assignment yet.
export const AA = 'ACDEFGHIKLMNPQRSTVWY';

// Seeded random numbers (mulberry32). The same seed gives the same design.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Position of residue i, written into out. which is 'ca' or 'cb'.
export function resAt(d, i, out, which = 'ca') {
  const a = which === 'cb' ? d.cb : d.ca, k = i * 3;
  out[0] = a[k]; out[1] = a[k + 1]; out[2] = a[k + 2];
  return out;
}

// Check a design against the format. Returns { ok, errors: [string] }.
export function validate(d) {
  const e = [];
  if (!d || typeof d !== 'object') return { ok: false, errors: ['design is not an object'] };
  if (!Number.isInteger(d.n) || d.n < LIMITS.minLen || d.n > LIMITS.maxLen) {
    e.push(`n must be an integer ${LIMITS.minLen}..${LIMITS.maxLen}, got ${d.n}`);
    return { ok: false, errors: e };
  }
  for (const k of ['ca', 'cb']) {
    if (!(d[k] instanceof Float32Array)) { e.push(`${k} must be a Float32Array`); continue; }
    if (d[k].length !== d.n * 3) e.push(`${k} length ${d[k].length} is not n*3`);
    else for (let i = 0; i < d[k].length; i++) if (!Number.isFinite(d[k][i])) { e.push(`${k}[${i}] is not finite`); break; }
  }
  if (!(d.fixed instanceof Uint8Array) || d.fixed.length !== d.n) e.push('fixed must be a Uint8Array of length n');
  if (!(d.motifId instanceof Int32Array) || d.motifId.length !== d.n) e.push('motifId must be an Int32Array of length n');
  if (typeof d.seq !== 'string' || d.seq.length !== d.n) e.push('seq must be a string of length n');
  else if (/[^ACDEFGHIKLMNPQRSTVWYX]/.test(d.seq)) e.push('seq has a letter that is not an amino acid or X');
  if (typeof d.ss !== 'string' || d.ss.length !== d.n) e.push('ss must be a string of length n');
  else if (/[^HEL]/.test(d.ss)) e.push("ss must use only 'H', 'E' and 'L'");
  const L = d.ligand;
  if (!L || !Array.isArray(L.atoms) || !L.atoms.length) e.push('ligand must have a non-empty atoms array');
  else if (L.atoms.length > LIMITS.maxLigandAtoms) e.push(`ligand has more than ${LIMITS.maxLigandAtoms} atoms`);
  else for (const [i, a] of L.atoms.entries()) {
    if (!a || typeof a.el !== 'string') { e.push(`ligand atom ${i} has no element`); break; }
    if (![a.x, a.y, a.z].every(Number.isFinite)) { e.push(`ligand atom ${i} has a coordinate that is not finite`); break; }
  }
  // The chain must stay connected: C-alpha to C-alpha is about 3.8 A.
  for (let i = 1; i < d.n; i++) {
    const k = i * 3, j = k - 3;
    const dx = d.ca[k] - d.ca[j], dy = d.ca[k + 1] - d.ca[j + 1], dz = d.ca[k + 2] - d.ca[j + 2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r < 2.8 || r > 4.8) { e.push(`residues ${i - 1} and ${i} are ${r.toFixed(2)} A apart, not near 3.8`); break; }
  }
  return { ok: e.length === 0, errors: e };
}

// Parse one motif_str into a list of segments. rand is a function in
// [0, 1); it picks the order when the string has a '|'. Returns
//   { chain: [seg], ligandChains: [string], resolved: string }
// seg is { kind: 'motif', chain, from, to } or { kind: 'design', lo, hi }.
export function parseMotifStr(str, rand = Math.random) {
  if (typeof str !== 'string' || !str.trim()) throw new Error('motif_str is empty');
  const chains = str.split('/').map(s => s.trim()).filter(Boolean);
  if (!chains.length) throw new Error('motif_str has no chains');
  let first = chains[0];
  // Order sampling: 'groups|template', each '{}' takes one group.
  if (first.includes('|')) {
    const [gs, tpl] = first.split('|');
    const groups = gs.split(',').map(s => s.trim()).filter(Boolean);
    const slots = tpl.split(',').map(s => s.trim());
    const holes = slots.filter(s => s === '{}').length;
    if (holes !== groups.length) throw new Error(`motif_str has ${groups.length} groups but ${holes} '{}' slots`);
    const order = groups.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let k = 0;
    first = slots.map(s => (s === '{}' ? order[k++] : s)).join(',');
  }
  const chain = first.split(',').map(s => s.trim()).filter(Boolean).map(tok => {
    let m = /^([A-Za-z])(\d+)(?:-(\d+))?$/.exec(tok);
    if (m) {
      const from = +m[2], to = m[3] === undefined ? from : +m[3];
      if (to < from) throw new Error(`motif segment '${tok}' counts backwards`);
      return { kind: 'motif', chain: m[1], from, to };
    }
    m = /^(\d+)-(\d+)$/.exec(tok);
    if (m) {
      const lo = +m[1], hi = +m[2];
      if (hi < lo) throw new Error(`designed range '${tok}' counts backwards`);
      return { kind: 'design', lo, hi };
    }
    m = /^(\d+)$/.exec(tok);
    if (m) return { kind: 'design', lo: +m[1], hi: +m[1] };
    throw new Error(`'${tok}' is not a segment: use A1, A5-6, 3 or 5-10`);
  });
  if (!chain.some(s => s.kind === 'motif')) throw new Error('motif_str holds no motif residue');
  const resolved = chain.map(s => (s.kind === 'motif'
    ? s.chain + s.from + (s.to > s.from ? '-' + s.to : '')
    : (s.lo === s.hi ? String(s.lo) : `${s.lo}-${s.hi}`))).join(',');
  return { chain, ligandChains: chains.slice(1), resolved: [resolved, ...chains.slice(1)].join('/') };
}

// Choose a length for every designed segment. seqLength is an optional
// string: '150' or '120-160'. The sampler tries to land the total length
// inside that range. Returns { lengths: [n per segment], total }.
// lengths[i] is the residue count of chain[i]: fixed for a motif segment.
export function planChain(parsed, { seqLength = null, rand = Math.random, tries = 400 } = {}) {
  const segs = parsed.chain;
  const fixedTotal = segs.reduce((s, x) => s + (x.kind === 'motif' ? x.to - x.from + 1 : 0), 0);
  let want = null;
  if (seqLength) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(String(seqLength).trim());
    if (!m) throw new Error(`seq_length '${seqLength}' is not a number or a range`);
    want = { lo: +m[1], hi: m[2] === undefined ? +m[1] : +m[2] };
    if (want.hi < want.lo) throw new Error(`seq_length '${seqLength}' counts backwards`);
  }
  const draw = () => segs.map(s => (s.kind === 'motif'
    ? s.to - s.from + 1
    : s.lo + Math.floor(rand() * (s.hi - s.lo + 1))));
  let best = null;
  for (let t = 0; t < tries; t++) {
    const lengths = draw();
    const total = lengths.reduce((a, b) => a + b, 0);
    if (!want) return { lengths, total };
    if (total >= want.lo && total <= want.hi) return { lengths, total };
    const miss = total < want.lo ? want.lo - total : total - want.hi;
    if (!best || miss < best.miss) best = { lengths, total, miss };
  }
  // No draw landed in the range. Give the nearest one and say so.
  const lo = segs.reduce((s, x) => s + (x.kind === 'motif' ? x.to - x.from + 1 : x.lo), 0);
  const hi = segs.reduce((s, x) => s + (x.kind === 'motif' ? x.to - x.from + 1 : x.hi), 0);
  return { lengths: best.lengths, total: best.total, missed: { want, reach: { lo, hi }, fixedTotal } };
}
