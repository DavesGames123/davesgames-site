// ============================================================================
//  PROTEIN VIEWER  ·  ss.js — secondary structure from coordinates
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE. Used when a file has no HELIX/SHEET records (for
//  example every AlphaFold model). Two methods:
//
//  1. Backbone H-bonds (after Kabsch and Sander's DSSP, simplified).
//     The amide H sits on N, opposite the previous C=O. The electrostatic
//     energy of an N-H...O=C pair is
//         E = 0.084 * 332 * (1/rON + 1/rCH - 1/rOH - 1/rCN)  kcal/mol
//     and the pair is an H-bond when E < -0.5.
//       n-turn at i ... H-bond from CO(i) to NH(i+n)
//       H (alpha) ..... 4-turns at i-1 and i mark i..i+3
//       G (3-10) ...... 3-turns at i-1 and i mark i..i+2 (if not H)
//       E (strand) .... a residue in a bridge whose neighbour is also in
//                       a bridge (a ladder); parallel and antiparallel
//                       bridges use the DSSP H-bond patterns
//  2. CA geometry, for CA-only chains: helix and strand have typical
//     i..i+2, i..i+3 and i..i+4 CA distances, and a strand has a CA of a
//     distant residue within 5.3 A.
//
//  grep: export function assignSS  function hbondEnergy  function caOnly
// ============================================================================
import { makeGrid } from './parse.js';

const Q = 0.084 * 332;

export function hbondEnergy(O, C, N, H) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const rON = d(O, N), rCH = d(C, H), rOH = d(O, H), rCN = d(C, N);
  if (rON < 0.5 || rOH < 0.5) return -9.9;
  return Q * (1 / rON + 1 / rCH - 1 / rOH - 1 / rCN);
}

export function assignSS(s) {
  const { residues, pos } = s;
  const P = i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  // protein residues in chain order, with a link flag to the previous one
  for (const seg of s.segments) {
    if (seg.kind !== 'protein') continue;
    const R = seg.residues.map(ri => residues[ri]);
    const full = R.filter(r => r.map.N !== undefined && r.map.C !== undefined && r.map.O !== undefined).length;
    if (full >= R.length * 0.8 && R.length >= 3) backbone(R);
    else caOnly(R);
  }
  // H-bonds between segments of different chains matter for strands that
  // pair across chains; the per-segment pass above ignores them, which is
  // the safe side: such strands may show as coil.

  function backbone(R) {
    const n = R.length;
    const N = [], C = [], O = [], H = [], CA = [];
    for (let k = 0; k < n; k++) {
      const r = R[k];
      N.push(r.map.N !== undefined ? P(r.map.N) : null);
      C.push(r.map.C !== undefined ? P(r.map.C) : null);
      O.push(r.map.O !== undefined ? P(r.map.O) : null);
      CA.push(r.map.CA !== undefined ? P(r.map.CA) : null);
    }
    for (let k = 0; k < n; k++) {
      if (!N[k]) { H.push(null); continue; }
      if (k === 0 || !C[k - 1] || !O[k - 1] || R[k].name === 'PRO') { H.push(null); continue; }
      const dx = C[k - 1][0] - O[k - 1][0], dy = C[k - 1][1] - O[k - 1][1], dz = C[k - 1][2] - O[k - 1][2];
      const l = Math.hypot(dx, dy, dz) || 1;
      H.push([N[k][0] + dx / l, N[k][1] + dy / l, N[k][2] + dz / l]);
    }
    // hb[acceptor k][donor m]: CO(k) ... HN(m)
    const hb = new Set();
    const key = (k, m) => k * 100000 + m;
    const opos = new Float32Array(3 * n), have = [];
    for (let k = 0; k < n; k++) if (O[k] && C[k]) { opos[3 * k] = O[k][0]; opos[3 * k + 1] = O[k][1]; opos[3 * k + 2] = O[k][2]; have.push(k); }
    const grid = makeGrid(opos, have, 5.2);
    for (let m = 0; m < n; m++) {
      if (!H[m]) continue;
      grid.near(N[m][0], N[m][1], N[m][2], 5.2, (k) => {
        if (Math.abs(k - m) < 2) return;
        if (hbondEnergy(O[k], C[k], N[m], H[m]) < -0.5) hb.add(key(k, m));
      });
    }
    const Hb = (k, m) => k >= 0 && m >= 0 && k < n && m < n && hb.has(key(k, m));
    const ss = new Array(n).fill('C');
    // turns and helices
    const turn = (i, t) => Hb(i, i + t);
    for (let i = 1; i < n - 4; i++) if (turn(i - 1, 4) && turn(i, 4)) for (let k = i; k <= i + 3; k++) ss[k] = 'H';
    // strands: bridges
    const bridge = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 3; j < n - 1; j++) {
        const par = (Hb(i - 1, j) && Hb(j, i + 1)) || (Hb(j - 1, i) && Hb(i, j + 1));
        const anti = (Hb(i, j) && Hb(j, i)) || (Hb(i - 1, j + 1) && Hb(j - 1, i + 1));
        if (par || anti) { bridge[i]++; bridge[j]++; }
      }
    }
    for (let i = 0; i < n; i++) {
      if (!bridge[i] || ss[i] === 'H') continue;
      if ((i > 0 && bridge[i - 1]) || (i < n - 1 && bridge[i + 1])) ss[i] = 'E';
    }
    // one-residue bulges inside a strand
    for (let i = 1; i < n - 1; i++) if (ss[i] === 'C' && ss[i - 1] === 'E' && ss[i + 1] === 'E') ss[i] = 'E';
    for (let i = 1; i < n - 3; i++) if (turn(i - 1, 3) && turn(i, 3)) for (let k = i; k <= i + 2; k++) if (ss[k] === 'C') ss[k] = 'G';
    // drop lone helix and strand residues
    clean(ss);
    for (let k = 0; k < n; k++) R[k].ss = ss[k];
  }

  function caOnly(R) {
    const n = R.length;
    const ca = R.map(r => (r.ca >= 0 ? P(r.ca) : null));
    const d = (a, b) => (ca[a] && ca[b] ? Math.hypot(ca[a][0] - ca[b][0], ca[a][1] - ca[b][1], ca[a][2] - ca[b][2]) : 99);
    const ss = new Array(n).fill('C');
    for (let i = 0; i + 4 < n; i++) {
      const d2 = d(i, i + 2), d3 = d(i, i + 3), d4 = d(i, i + 4);
      if (d2 > 5.0 && d2 < 6.0 && d3 > 4.6 && d3 < 5.8 && d4 > 5.6 && d4 < 6.8) for (let k = i; k <= i + 4; k++) ss[k] = 'H';
    }
    const caPos = new Float32Array(3 * n), idx = [];
    for (let k = 0; k < n; k++) if (ca[k]) { caPos.set(ca[k], 3 * k); idx.push(k); }
    const grid = makeGrid(caPos, idx, 5.5);
    for (let i = 1; i + 1 < n; i++) {
      if (ss[i] === 'H') continue;
      if (d(i - 1, i + 1) < 6.2) continue;
      let paired = false;
      if (ca[i]) grid.near(ca[i][0], ca[i][1], ca[i][2], 5.3, j => { if (Math.abs(j - i) > 3) paired = true; });
      if (paired) ss[i] = 'E';
    }
    clean(ss);
    for (let k = 0; k < n; k++) R[k].ss = ss[k];
  }
}

function clean(ss) {
  const n = ss.length;
  for (let i = 0; i < n; i++) {
    if (ss[i] === 'C') continue;
    let j = i; while (j + 1 < n && ss[j + 1] === ss[i]) j++;
    const len = j - i + 1, min = ss[i] === 'H' ? 4 : ss[i] === 'G' ? 3 : 2;
    if (len < min) for (let k = i; k <= j; k++) ss[k] = 'C';
    i = j;
  }
}
