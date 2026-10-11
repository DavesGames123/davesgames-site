// ============================================================================
//  FLY DUEL  ·  the mushroom body model  (ES module, no DOM)
// ----------------------------------------------------------------------------
//  One MushroomBody is the learning centre of one model fly. The wiring comes
//  from data/connectome.json (PN -> KC claws, KC -> MBON synapses, which DAN
//  gates which MBON). The learned part is the KC -> MBON weight table only.
//  Everything in this file is a model. It is not a real fly.
//
//  DATA PATH (one evaluation, no allocation in the hot path)
//      features[48] --encode--> glomerulus rates --> PN rates
//      PN rates --claws--> KC drive --APL (k winners)--> active KC list
//      active KCs --KC->MBON weights--> MBON rates --valence--> value
//
//  1. FEATURE -> GLOMERULUS MAP ("smell of a board").  Model.
//     In the fly, each olfactory receptor type sends its input to one
//     glomerulus. Here each of the F board features is one receptor type.
//     A seeded permutation gives each feature its own glomerulus (the
//     unique pn.types). Spare glomeruli get a second receptor type for
//     other features. A receptor has a Hill dose-response curve
//         rate = x^h / (x^h + EC50^h),  h = 1.5, EC50 seeded in [0.15, 0.6]
//     and the glomerulus rate is the mean of its receptor rates. All PNs
//     of one glomerulus share that rate (sister PNs get the same input).
//     So one board makes one odour-like pattern over the glomeruli.
//     Option encoding: 'population' instead deals M Gaussian tuning
//     curves per feature over the glomeruli (several features mix in one
//     glomerulus). It learned less in our node test runs on the real game
//     (vs a random player after 800 training games: 0.72 win rate against
//     0.88 for 'receptor'), so it is not the default.
//     If the data has fewer than 16 glomerulus names, each PN is its own
//     channel. The map seed is the only wiring difference between fly A
//     and fly B. The PN -> KC claws are the same for both.
//
//  2. KC SPARSE CODE.  Model of APL feedback inhibition.
//     KC drive = mean of its claw PN rates, weighted by synapse count.
//     Each KC drive gets a z-score against a calibration set of boards
//     (a homeostatic threshold, so each KC fires at a similar rate).
//     APL is a k-winners-take-all: the top k = round(sparsity * live KCs)
//     z-scores fire. Ties go to the lower KC index. A KC with no PN claw
//     never fires ("dead" in stats).
//     KC RATE (opts.kcCode).  'binary': each winner has rate 1 (format 1
//     model). 'graded': each winner has rate (z - L) / rateScale, where
//     L is the best z-score that did not win (the APL level) and
//     rateScale makes the mean rate 1 on the calibration boards. A real
//     KC fires a small and variable number of spikes per odour (Turner
//     2008), and APL feedback sets the level it must pass (Lin 2014), so
//     a graded rate is the nearer model. The winners are the same in
//     both codes. Only the rates change.
//
//  3. VALUE.  MBON rate j = (1/k) * sum over active KCs of r_i * w_ij
//     (r_i = KC rate, 1 for the binary code).
//     value = valueScale * sum_j valence_j * rate_j - bias. Valence +1
//     is approach, -1 is avoid. bias is the mean naive value over the
//     calibration set, so a naive fly starts near 0.
//
//  4. PLASTICITY.  Three-factor rule, depression gated by dopamine.
//       dw_ij = -eta * DAN_c(j) * e_i ,  w clamped to [0, wmax]
//     e_i is the decaying KC eligibility trace (set to the KC rate when
//     the KC fires). DAN_c is the signed DAN rate of compartment c
//     relative to its tonic rate (burst > 0, dip < 0). danFromDelta(delta) sets DAN_c = -valence_c * delta:
//       delta > 0: avoid compartments (PAM in the fly) burst. Their KC ->
//                  MBON synapses depress, avoid drive falls, value rises.
//       delta < 0: approach compartments (PPL1 in the fly) burst. Their
//                  synapses depress, approach drive falls, value falls.
//     A dip (DAN_c < 0) gives the opposite change (recovery). With this
//     sign, dw_ij = eta * delta * valence_j * e_i, which is the TD(lambda)
//     gradient step. eta = lr / ((valueScale/k) * N), N = sum of r_i^2 *
//     plastic synapses of KC i over the current active KCs (a normalised
//     step), so lr is the part of the error that one update removes on
//     the current pattern before clamping. Only MBONs whose valence agrees with their compartment
//     valence, and that have a gating DAN, are plastic.
//
//  EXPORTS   (jump with grep -n "<anchor>" brain/mb.js)
//      MushroomBody ...... "export class MushroomBody"
//      MB_DEFAULTS ....... "export const MB_DEFAULTS"
//      encode ............ "  encode("          features -> PN rates
//      kcActivity ........ "  kcActivity("      PN rates -> active KC list
//      kcCode ............ "  kcCode("          PN rates -> { kc, rate } copies
//      mbonOut ........... "  mbonOut("         active KCs -> MBON rates
//      value ............. "  value("           features -> number
//      evaluate .......... "  evaluate("        features -> { pn, kc, mbon, value }
//      valueOfKc ......... "  valueOfKc("       active KCs -> number
//      danFromDelta ...... "  danFromDelta("    TD error -> DAN per compartment
//      danNeurons ........ "  danNeurons("      compartment DAN -> per DAN neuron
//      traceStep ......... "  traceStep("       eligibility decay + new KCs
//      learn ............. "  learn("           three-factor update
//      calibrate ......... "  calibrate("       homeostatic KC thresholds
//      toJSON/fromJSON ... "  toJSON(" / "static fromJSON("
//      stats ............. "this.stats ="       counts for the page
// ============================================================================
import { mulberry32, hashSeed, shuffle } from '../data/rng.js';

export const MB_DEFAULTS = {
  seed: 1,
  hemisphere: 'A',
  sparsity: 0.05,        // share of live KCs active (published 5-10 %)
  nFeatures: 48,         // game/features.js F
  encoding: 'receptor',  // 'receptor' (one per glomerulus) or 'population'
  ec50: [0.15, 0.6],     // receptor: EC50 range of the Hill curves
  hill: 1.5,             // receptor: Hill coefficient
  receptorsPerChannel: 3,// population: target tuning curves per glomerulus
  minCentres: 3,         // population: at least 3 tuning curves per feature
  tuningWidth: 0.6,      // population: sigma as a fraction of centre spacing
  wmax: 4,               // weight clamp; mean initial plastic weight = 1
  calibrationSize: 128,  // random boards when no samples are given
  kcCode: 'binary',      // 'binary' (rate 1) or 'graded' (rate above APL)
};

// Format 2 adds kcCode and rateScale. fromJSON reads a format 1 file
// with kcCode 'binary', which is the format 1 model.
const FORMAT = 'fly-duel-mb/2';
const FORMATS = ['fly-duel-mb/1', FORMAT];
const LEGACY = { kcCode: 'binary' };

// ---------------------------------------------------------------- helpers
function b64FromBytes(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function bytesFromB64(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
// Float32Array <-> base64 (little-endian on every browser and node we ship to)
function f32ToB64(f) { return b64FromBytes(new Uint8Array(f.buffer, f.byteOffset, f.byteLength)); }
function f32FromB64(b64) { const u8 = bytesFromB64(b64); return new Float32Array(u8.buffer, 0, u8.length >> 2); }

// Wiring fingerprint, so weights load only onto the wiring they came from.
function fingerprint(c) {
  const e = c.edges;
  let h = 0x811C9DC5 >>> 0;
  const mix = v => { h ^= v >>> 0; h = Math.imul(h, 0x01000193) >>> 0; };
  mix(c.pn.n); mix(c.kc.n); mix(c.mbon.n); mix(c.dan.n);
  for (const [a, b, w] of e.pn_kc) { mix(a); mix(b); mix(w); }
  for (const [a, b, w] of e.kc_mbon) { mix(a); mix(b); mix(w); }
  return `${c.pn.n}.${c.kc.n}.${c.mbon.n}.${c.dan.n}.${e.pn_kc.length}.${e.kc_mbon.length}.${(h >>> 0).toString(36)}`;
}

// Build CSR (row-major) arrays from [row, col, weight] triples.
function csr(nRows, triples) {
  const ptr = new Uint32Array(nRows + 1);
  for (const t of triples) ptr[t[0] + 1]++;
  for (let i = 0; i < nRows; i++) ptr[i + 1] += ptr[i];
  const col = new Uint32Array(triples.length), val = new Float32Array(triples.length);
  const fill = ptr.slice(0, nRows);
  for (const [r, cIdx, w] of triples) { const p = fill[r]++; col[p] = cIdx; val[p] = w == null ? 1 : w; }
  return { ptr, col, val };
}

// k-th largest value of a[0..n) (k in 1..n). Works on scratch, which it
// changes. Hoare quickselect with median-of-three pivots.
function kthLargest(scratch, n, k) {
  let lo = 0, hi = n - 1;
  const target = k - 1;
  while (hi > lo) {
    const mid = (lo + hi) >> 1;
    let a = scratch[lo], b = scratch[mid], c = scratch[hi];
    const pivot = a > b ? (b > c ? b : (a > c ? c : a)) : (a > c ? a : (b > c ? c : b));
    let i = lo, j = hi;
    while (i <= j) {
      while (scratch[i] > pivot) i++;
      while (scratch[j] < pivot) j--;
      if (i <= j) { const t = scratch[i]; scratch[i] = scratch[j]; scratch[j] = t; i++; j--; }
    }
    if (target <= j) hi = j; else if (target >= i) lo = i; else return scratch[target];
  }
  return scratch[target];
}

// ---------------------------------------------------------------- the model
export class MushroomBody {
  constructor(connectome, opts = {}) {
    const o = { ...MB_DEFAULTS, ...opts };
    this.opts = o;
    this.connectome = connectome;
    this.hemisphere = o.hemisphere;
    this.seed = o.seed >>> 0;
    this.sparsity = o.sparsity;
    this.wmax = o.wmax;
    this.fingerprint = fingerprint(connectome);
    const C = connectome;
    const nPN = this.nPN = C.pn.n, nKC = this.nKC = C.kc.n, nM = this.nMBON = C.mbon.n;
    this.nDAN = C.dan.n;
    this.nFeatures = o.nFeatures;

    this._buildEncoding();

    // PN -> KC claws, KC-major, weights normalised to sum 1 per KC. Claws
    // from sister PNs of one glomerulus merge into one channel input,
    // because the model gives sister PNs one shared rate.
    const merged = new Map();
    for (const [p, k, w] of C.edges.pn_kc) {
      const key = k * 65536 + this.pnChan[p];
      merged.set(key, (merged.get(key) || 0) + (w > 0 ? w : 1));
    }
    const kin = csr(nKC, [...merged].sort((a, b) => a[0] - b[0]).map(([key, w]) => [Math.floor(key / 65536), key % 65536, w]));
    this.kcInPtr = kin.ptr; this.kcInChan = new Uint16Array(kin.col); this.kcInW = new Float64Array(kin.val);
    this.kcLive = new Uint8Array(nKC);
    let live = 0;
    for (let k = 0; k < nKC; k++) {
      let s = 0;
      for (let p = kin.ptr[k]; p < kin.ptr[k + 1]; p++) s += this.kcInW[p];
      if (s > 0) { for (let p = kin.ptr[k]; p < kin.ptr[k + 1]; p++) this.kcInW[p] /= s; this.kcLive[k] = 1; live++; }
    }
    this.nLive = live;
    this.k = Math.max(1, Math.round(o.sparsity * live));

    // Compartments: the unique mbon.compartment names.
    const comps = [];
    const compIdx = new Map();
    this.mbonComp = new Uint16Array(nM);
    for (let j = 0; j < nM; j++) {
      const name = String(C.mbon.compartment?.[j] ?? `mbon${j}`);
      if (!compIdx.has(name)) { compIdx.set(name, comps.length); comps.push(name); }
      this.mbonComp[j] = compIdx.get(name);
    }
    this.compartments = comps;
    const nC = comps.length;
    this.valence = Int8Array.from({ length: nM }, (_, j) => Math.sign(+C.mbon.valence?.[j] || 0));

    // Compartment valence = sign of the summed valence of its MBONs.
    const vsum = new Float32Array(nC);
    for (let j = 0; j < nM; j++) vsum[this.mbonComp[j]] += this.valence[j];
    this.compValence = Int8Array.from(vsum, Math.sign);

    // Which DANs gate which compartment: dan_mbon_compartment edges, then
    // dan.compartment names that match an MBON compartment.
    this.danComp = new Int32Array(this.nDAN).fill(-1);
    const gated = new Uint8Array(nC);
    for (const [d, m] of C.edges.dan_mbon_compartment || []) {
      if (m < 0 || m >= nM || d < 0 || d >= this.nDAN) continue;
      const c = this.mbonComp[m];
      gated[c] = 1;
      if (this.danComp[d] < 0) this.danComp[d] = c;
    }
    for (let d = 0; d < this.nDAN; d++) {
      const c = compIdx.get(String(C.dan.compartment?.[d] ?? ''));
      if (c != null) { gated[c] = 1; if (this.danComp[d] < 0) this.danComp[d] = c; }
    }
    this.compGated = gated;

    // Plastic MBON: valence != 0, same sign as its compartment, gated.
    this.mbonPlastic = new Uint8Array(nM);
    let disagree = 0;
    for (let j = 0; j < nM; j++) {
      const c = this.mbonComp[j];
      if (this.valence[j] !== 0 && this.valence[j] === this.compValence[c] && gated[c]) this.mbonPlastic[j] = 1;
      else if (this.valence[j] !== 0 && gated[c]) disagree++;
    }

    // Biology check, for the page: does each gating DAN cluster agree
    // with the textbook sign (PAM -> avoid compartments, PPL1 -> approach)?
    let clusterAgree = 0, clusterDisagree = 0;
    for (let d = 0; d < this.nDAN; d++) {
      const c = this.danComp[d]; if (c < 0) continue;
      const cl = String(C.dan.cluster?.[d] || '').toUpperCase();
      const want = cl.startsWith('PAM') ? -1 : cl.startsWith('PPL1') ? 1 : 0;
      if (!want || !this.compValence[c]) continue;
      if (want === this.compValence[c]) clusterAgree++; else clusterDisagree++;
    }

    // KC -> MBON synapses, KC-major. w0 = synapse count / mean plastic count.
    const kout = csr(nKC, C.edges.kc_mbon.map(([k, m, w]) => [k, m, w > 0 ? w : 1]));
    this.kcOutPtr = kout.ptr; this.kcOutMbon = new Uint16Array(kout.col);
    const syn = kout.val;
    let sp = 0, np = 0;
    for (let e = 0; e < syn.length; e++) if (this.mbonPlastic[this.kcOutMbon[e]]) { sp += syn[e]; np++; }
    const meanSyn = np ? sp / np : 1;
    this.w0 = new Float32Array(syn.length);
    for (let e = 0; e < syn.length; e++) this.w0[e] = Math.min(o.wmax, syn[e] / meanSyn);
    this.w = this.w0.slice();
    this.edgePlastic = new Uint8Array(syn.length);
    this.kcPlasticCount = new Uint16Array(nKC);
    for (let k = 0; k < nKC; k++) {
      for (let e = kout.ptr[k]; e < kout.ptr[k + 1]; e++) {
        if (this.mbonPlastic[this.kcOutMbon[e]]) { this.edgePlastic[e] = 1; this.kcPlasticCount[k]++; }
      }
    }
    let plKc = 0, plSum = 0;
    for (let k = 0; k < nKC; k++) if (this.kcLive[k] && this.kcPlasticCount[k]) { plKc++; plSum += this.kcPlasticCount[k]; }
    const meanPl = plKc ? plSum / plKc : 1;
    this.valueScale = 2 / meanPl;

    // Scratch buffers.
    this._glom = new Float32Array(this.nChannels);
    this._pn = new Float32Array(nPN);
    this._chan = new Float64Array(this.nChannels);
    this._chanCount = new Float64Array(this.nChannels);
    for (let p = 0; p < nPN; p++) this._chanCount[this.pnChan[p]]++;
    this._drive = new Float64Array(nKC);
    this._z = new Float64Array(nKC);
    this._sel = new Float64Array(nKC);
    this._kc = new Uint16Array(nKC);
    this._rate = new Float32Array(nKC);
    this.graded = o.kcCode === 'graded';
    this.rateScale = 1;   // graded: mean (z - APL level) of a winner
    this._mbon = new Float32Array(nM);
    this._dan = new Float32Array(nC);

    // Eligibility trace: dense values + sparse index list.
    this.elig = new Float32Array(nKC);
    this.eligIdx = new Uint16Array(nKC);
    this.eligN = 0;

    this.kcMu = new Float32Array(nKC);
    this.kcSd = new Float32Array(nKC).fill(1);
    this._invSd = new Float64Array(nKC).fill(1);
    this.bias = 0;
    this.updates = 0;
    this.lastLearn = null;

    this.stats = {
      pn: nPN, kc: nKC, kcLive: live, kcDead: nKC - live, kActive: this.k,
      mbon: nM, mbonPlastic: this.mbonPlastic.reduce((a, b) => a + b, 0),
      mbonValenceDisagree: disagree, dan: this.nDAN,
      compartments: nC, compartmentsGated: gated.reduce((a, b) => a + b, 0),
      clusterAgree, clusterDisagree,
      channels: this.nChannels, channelKind: this.channelKind, centresPerFeature: this.centres,
      clawEdges: C.edges.pn_kc.length, kcMbonEdges: C.edges.kc_mbon.length,
      plasticSynapses: this.edgePlastic.reduce((a, b) => a + b, 0),
      synthetic: !!C.meta?.synthetic,
    };

    if (opts.calibration !== false) this.calibrate(opts.calibration);
  }

  // Feature -> channel tuning curves. Deterministic in (seed, hemisphere).
  _buildEncoding() {
    const C = this.connectome, o = this.opts, nPN = this.nPN;
    const types = C.pn.types || [];
    const names = new Map();
    const pnChan = new Uint16Array(nPN);
    for (let p = 0; p < nPN; p++) {
      const t = types[p] == null ? `pn${p}` : String(types[p]);
      if (!names.has(t)) names.set(t, names.size);
      pnChan[p] = names.get(t);
    }
    if (names.size < 16) { for (let p = 0; p < nPN; p++) pnChan[p] = p; this.channelKind = 'pn'; this.nChannels = nPN; }
    else { this.channelKind = 'glomerulus'; this.nChannels = names.size; }
    this.channelNames = this.channelKind === 'pn' ? Array.from({ length: nPN }, (_, p) => types[p] ?? `pn${p}`) : [...names.keys()];
    this.pnChan = pnChan;

    const F = o.nFeatures, G = this.nChannels;
    const rng = mulberry32(hashSeed(`mb-map:${this.hemisphere}:${this.seed}`));
    // Receptor table, channel-major: feature, kind, a, b.
    //   kind 0: Hill dose-response   x^b / (x^b + a^b)   (a = EC50)
    //   kind 1: Gaussian tuning      exp(-(x - a)^2 * b) (a = centre)
    const per = Array.from({ length: G }, () => []);
    if (o.encoding === 'population') {
      const M = Math.max(o.minCentres, Math.ceil(o.receptorsPerChannel * G / F));
      this.centres = M;
      const sigma = o.tuningWidth / M, k2 = 1 / (2 * sigma * sigma);
      const slots = [];
      for (let f = 0; f < F; f++) for (let m = 0; m < M; m++) slots.push([f, 1, (m + 0.5) / M, k2]);
      shuffle(slots, rng).forEach((sl, i) => per[i % G].push(sl));
    } else {
      // One receptor type per glomerulus, as in the fly: a seeded
      // permutation gives each feature its own glomerulus. Spare
      // glomeruli get a second receptor for other random features. When there
      // are fewer glomeruli than features, glomeruli take two features.
      this.centres = 1;
      const order = shuffle(Array.from({ length: G }, (_, g) => g), rng);
      const ec50 = () => o.ec50[0] + rng() * (o.ec50[1] - o.ec50[0]);
      for (let f = 0; f < F; f++) per[order[f % G]].push([f, 0, ec50(), o.hill]);
      const spare = shuffle(Array.from({ length: F }, (_, f) => f), rng);
      for (let i = F; i < G; i++) per[order[i]].push([spare[(i - F) % F], 0, ec50(), o.hill]);
    }
    this.recPtr = new Uint32Array(G + 1);
    for (let g = 0; g < G; g++) this.recPtr[g + 1] = this.recPtr[g] + per[g].length;
    const R = this.recPtr[G];
    this.recFeature = new Uint16Array(R);
    this.recKind = new Uint8Array(R);
    this.recA = new Float64Array(R);
    this.recB = new Float64Array(R);
    let r = 0;
    for (let g = 0; g < G; g++) for (const [f, kind, a, b] of per[g]) { this.recFeature[r] = f; this.recKind[r] = kind; this.recA[r] = a; this.recB[r] = b; r++; }
    // Channel -> features, for the page ("which glomeruli smell life?").
    this.channelFeatures = per.map(list => list.map(x => x[0]));
  }

  // features (length nFeatures, ~[0, 1]) -> PN rates in [0, 1).
  // Returns an internal buffer: copy it to keep it.
  encode(features) {
    const G = this.nChannels, glom = this._glom, rp = this.recPtr, rf = this.recFeature, rk = this.recKind, ra = this.recA, rb = this.recB;
    for (let g = 0; g < G; g++) {
      let s = 0;
      for (let r = rp[g]; r < rp[g + 1]; r++) {
        let x = +features[rf[r]];
        x = x > 1 ? 1 : (x >= 0 ? x : 0);   // NaN -> 0
        if (rk[r] === 0) { const xh = Math.pow(x, rb[r]); s += xh / (xh + Math.pow(ra[r], rb[r])); }
        else { const d = x - ra[r]; s += Math.exp(-d * d * rb[r]); }
      }
      glom[g] = rp[g + 1] > rp[g] ? s / (rp[g + 1] - rp[g]) : 0;
    }
    const pn = this._pn, ch = this.pnChan;
    for (let p = 0; p < this.nPN; p++) pn[p] = glom[ch[p]];
    return pn;
  }

  // KC drive without the APL step: weighted mean of claw channel rates.
  // The channel rate is the mean rate of its PNs (equal to the glomerulus
  // rate for the output of encode).
  _drives(pnRates) {
    const G = this.nChannels, ch = this._chan, cnt = this._chanCount, pc = this.pnChan;
    if (pnRates === this._pn) ch.set(this._glom);
    else {
      ch.fill(0);
      for (let p = 0; p < this.nPN; p++) ch[pc[p]] += pnRates[p];
      for (let g = 0; g < G; g++) ch[g] /= cnt[g];
    }
    const d = this._drive, ptr = this.kcInPtr, ci = this.kcInChan, w = this.kcInW, n = this.nKC;
    let p = 0;
    for (let k = 0; k < n; k++) {
      let s = 0;
      const end = ptr[k + 1];
      for (; p < end; p++) s += w[p] * ch[ci[p]];
      d[k] = s;
    }
    return d;
  }

  // PN rates -> sorted active KC indices (k winners of the z-scored drive).
  // Returns an internal buffer view: copy it (slice) to keep it.
  kcActivity(pnRates) {
    const d = this._drives(pnRates), z = this._z, sel = this._sel, live = this.kcLive;
    const mu = this.kcMu, isd = this._invSd, n = this.nKC;
    let m = 0;
    for (let k = 0; k < n; k++) {
      const v = live[k] ? (d[k] - mu[k]) * isd[k] : -Infinity;
      z[k] = v;
      if (live[k]) sel[m++] = v;
    }
    const K = Math.min(this.k, m);
    if (!K) return this._kc.subarray(0, 0);
    const thr = kthLargest(sel, m, K);
    let above = 0;
    for (let k = 0; k < n; k++) if (z[k] > thr) above++;
    let ties = K - above, out = 0;
    const kc = this._kc, rate = this._rate;
    for (let k = 0; k < n && out < K; k++) {
      const v = z[k];
      if (v > thr) kc[out++] = k;
      else if (v === thr && ties > 0) { kc[out++] = k; ties--; }
    }
    if (this.graded) {
      // APL level = the best z-score that did not win (the K+1-th).
      let lose = -Infinity, j = 0;
      for (let k = 0; k < n; k++) {
        if (j < out && kc[j] === k) { j++; continue; }
        if (live[k] && z[k] > lose) lose = z[k];
      }
      if (lose === -Infinity) lose = thr - 1;
      const inv = 1 / this.rateScale;
      for (let a = 0; a < out; a++) { const r = (z[kc[a]] - lose) * inv; rate[a] = r > 0.01 ? r : 0.01; }
    } else rate.fill(1, 0, out);
    this.kcRate = rate.subarray(0, out);
    return kc.subarray(0, out);
  }

  // PN rates -> { kc, rate } copies. rate is null for the binary code.
  kcCode(pnRates) {
    const kc = this.kcActivity(pnRates).slice();
    return { kc, rate: this.graded ? this.kcRate.slice() : null };
  }

  // Active KCs -> MBON rates (mean weight over the k winners). rate:
  // KC rates in the order of activeKc (graded code), or null (rate 1).
  mbonOut(activeKc, out = this._mbon, rate = null) {
    out.fill(0);
    const ptr = this.kcOutPtr, mb = this.kcOutMbon, w = this.w;
    for (let a = 0; a < activeKc.length; a++) {
      const k = activeKc[a], r = rate ? rate[a] : 1;
      for (let e = ptr[k]; e < ptr[k + 1]; e++) out[mb[e]] += r * w[e];
    }
    const inv = 1 / this.k;
    for (let j = 0; j < out.length; j++) out[j] *= inv;
    return out;
  }

  // Active KCs -> value, without the MBON buffer (fast path).
  // rate: as in mbonOut.
  valueOfKc(activeKc, rate = null) {
    const ptr = this.kcOutPtr, mb = this.kcOutMbon, w = this.w, v = this.valence;
    let s = 0;
    for (let a = 0; a < activeKc.length; a++) {
      const k = activeKc[a];
      let sk = 0;
      for (let e = ptr[k]; e < ptr[k + 1]; e++) sk += v[mb[e]] * w[e];
      s += rate ? rate[a] * sk : sk;
    }
    return this.valueScale * s / this.k - this.bias;
  }

  // features -> value (approach minus avoid drive).
  value(features) {
    const kc = this.kcActivity(this.encode(features));
    return this.valueOfKc(kc, this.graded ? this.kcRate : null);
  }

  // features -> copies of every layer, for the brain view and the trainer.
  // kcRate: rate of each active KC (all 1 for the binary code).
  evaluate(features) {
    const pn = this.encode(features).slice();
    const kc = this.kcActivity(pn).slice();
    const kcRate = this.kcRate.slice(), rate = this.graded ? kcRate : null;
    const mbon = this.mbonOut(kc, this._mbon, rate).slice();
    return { pn, kc, kcRate, mbon, value: this.valueOfKc(kc, rate) };
  }

  // TD error -> signed DAN rate per compartment (relative to tonic rate).
  // Only gated compartments with a valence carry a signal.
  danFromDelta(delta, out = new Float32Array(this.compartments.length)) {
    for (let c = 0; c < out.length; c++) out[c] = this.compGated[c] ? -this.compValence[c] * delta : 0;
    return out;
  }

  // Compartment DAN -> per DAN neuron (for the brain view). Burst only.
  danNeurons(danComp, out = new Float32Array(this.nDAN)) {
    for (let d = 0; d < this.nDAN; d++) { const c = this.danComp[d]; out[d] = c >= 0 ? Math.max(0, danComp[c]) : 0; }
    return out;
  }

  // Eligibility: e <- decay * e, then e_i = 1 for each active KC (a
  // replacing trace), or e_i = its rate when rate is given (graded code).
  // Values under 1e-3 leave the list.
  traceStep(activeKc, decay, rate = null) {
    const e = this.elig, idx = this.eligIdx;
    let n = 0;
    for (let a = 0; a < this.eligN; a++) {
      const k = idx[a], v = e[k] * decay;
      if (v >= 1e-3) { e[k] = v; idx[n++] = k; } else e[k] = 0;
    }
    if (activeKc) for (let a = 0; a < activeKc.length; a++) {
      const k = activeKc[a];
      if (e[k] === 0) idx[n++] = k;
      e[k] = rate ? Math.max(1e-3, rate[a]) : 1;
    }
    this.eligN = n;
  }

  clearTrace() {
    for (let a = 0; a < this.eligN; a++) this.elig[this.eligIdx[a]] = 0;
    this.eligN = 0;
  }

  // Three-factor update: dw_ij = -eta * dan[c(j)] * e_i, w in [0, wmax].
  //   activeKc: KCs with e_i = 1 for this update, or null to use the trace.
  //   dan:      Float32Array per compartment (see danFromDelta).
  //   lr:       part of the error to remove on normKc (default 0.1).
  //   normKc:   pattern for the normalised step (default activeKc, or the
  //             trace KCs with e = 1).
  //   normRate: rates of normKc (graded code), or null (rate 1).
  //   activeRate: rates of activeKc (graded code): e_i = rate.
  // Returns { eta, changed, clamped, dwAbs }.
  learn(activeKc, dan, lr = 0.1, normKc = null, normRate = null, activeRate = null) {
    const ptr = this.kcOutPtr, mb = this.kcOutMbon, w = this.w, plast = this.edgePlastic, comp = this.mbonComp;
    const wmax = this.wmax;
    const norm = normKc || activeKc;
    const nRate = normKc ? normRate : activeRate;
    let N = 0;
    if (norm) for (let a = 0; a < norm.length; a++) { const r = nRate ? nRate[a] : 1; N += r * r * this.kcPlasticCount[norm[a]]; }
    else for (let a = 0; a < this.eligN; a++) { const k = this.eligIdx[a]; if (this.elig[k] === 1) N += this.kcPlasticCount[k]; }
    if (!N) return { eta: 0, changed: 0, clamped: 0, dwAbs: 0 };
    const eta = lr / ((this.valueScale / this.k) * N);
    let changed = 0, clamped = 0, dwAbs = 0;
    const one = (k, ek) => {
      for (let e = ptr[k]; e < ptr[k + 1]; e++) {
        if (!plast[e]) continue;
        const d = dan[comp[mb[e]]];
        if (!d) continue;
        let nw = w[e] - eta * d * ek;
        if (nw < 0) { nw = 0; clamped++; } else if (nw > wmax) { nw = wmax; clamped++; }
        dwAbs += Math.abs(nw - w[e]);
        w[e] = nw; changed++;
      }
    };
    if (activeKc) for (let a = 0; a < activeKc.length; a++) one(activeKc[a], activeRate ? activeRate[a] : 1);
    else for (let a = 0; a < this.eligN; a++) { const k = this.eligIdx[a]; one(k, this.elig[k]); }
    this.updates++;
    return { eta, changed, clamped, dwAbs };
  }

  // Homeostatic KC thresholds: mean and spread of each KC drive over a set
  // of boards (feature vectors). No samples: random boards from the seed.
  // Also sets bias so that the naive mean value over the set is 0.
  calibrate(samples) {
    const nKC = this.nKC, F = this.nFeatures;
    if (!samples || !samples.length) {
      const rng = mulberry32(hashSeed(`mb-cal:${this.hemisphere}:${this.seed}`));
      samples = Array.from({ length: this.opts.calibrationSize }, () => Float32Array.from({ length: F }, rng));
    }
    const s1 = new Float64Array(nKC), s2 = new Float64Array(nKC);
    for (const f of samples) {
      const d = this._drives(this.encode(f));
      for (let k = 0; k < nKC; k++) { s1[k] += d[k]; s2[k] += d[k] * d[k]; }
    }
    const n = samples.length;
    for (let k = 0; k < nKC; k++) {
      const mu = s1[k] / n, v = Math.max(0, s2[k] / n - mu * mu);
      this.kcMu[k] = mu;
      this.kcSd[k] = Math.sqrt(v) + 1e-3;
      this._invSd[k] = 1 / this.kcSd[k];
    }
    // Graded code: rateScale = mean (z - APL level) of a winner, so the
    // mean rate of an active KC is 1, as in the binary code.
    if (this.graded) {
      this.rateScale = 1;
      let rs = 0, rn = 0;
      for (const f of samples) { this.kcActivity(this.encode(f)); for (const r of this.kcRate) { rs += r; rn++; } }
      this.rateScale = rn && rs > 0 ? rs / rn : 1;
    }
    this.bias = 0;
    let vs = 0;
    for (const f of samples) vs += this.value(f);
    this.bias = vs / n;
    this.calibrationCount = n;
    return this;
  }

  // Weights back to the naive state (keeps the calibration).
  reset() { this.w.set(this.w0); this.clearTrace(); this.updates = 0; this.lastLearn = null; }

  // Plain JSON. Float arrays as base64 of little-endian float32.
  toJSON() {
    return {
      format: FORMAT, fingerprint: this.fingerprint,
      opts: { ...this.opts, calibration: undefined },
      hemisphere: this.hemisphere, seed: this.seed,
      bias: this.bias, updates: this.updates, rateScale: this.rateScale,
      kcMu: f32ToB64(this.kcMu), kcSd: f32ToB64(this.kcSd), w: f32ToB64(this.w),
    };
  }

  static fromJSON(connectome, json) {
    if (!json || !FORMATS.includes(json.format)) throw new Error(`MushroomBody.fromJSON: format ${json && json.format} is not ${FORMAT}`);
    const mb = new MushroomBody(connectome, { ...LEGACY, ...json.opts, seed: json.seed, hemisphere: json.hemisphere, calibration: false });
    if (mb.fingerprint !== json.fingerprint) throw new Error(`MushroomBody.fromJSON: wiring ${mb.fingerprint} is not ${json.fingerprint}`);
    const mu = f32FromB64(json.kcMu), sd = f32FromB64(json.kcSd), w = f32FromB64(json.w);
    if (mu.length !== mb.nKC || sd.length !== mb.nKC || w.length !== mb.w.length) throw new Error('MushroomBody.fromJSON: array size');
    mb.kcMu.set(mu); mb.kcSd.set(sd); mb.w.set(w);
    for (let k = 0; k < mb.nKC; k++) mb._invSd[k] = 1 / mb.kcSd[k];
    mb.bias = json.bias; mb.updates = json.updates | 0;
    if (json.rateScale > 0) mb.rateScale = json.rateScale;
    return mb;
  }
}
