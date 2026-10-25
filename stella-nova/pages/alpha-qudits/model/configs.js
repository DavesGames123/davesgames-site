// ============================================================================
//  ALPHA QUDITS  ·  model/configs.js  ·  read cap, charge, configurations (MODEL)
// ----------------------------------------------------------------------------
//  readCap(d1, d2): a type is readable when every positive map between its
//  ends is decomposable. The literature fixes where: always at (2,2)
//  (Stormer 1963) and (2,3) (Woronowicz 1976); not at (2,4) (Woronowicz
//  1976) and (3,3) (Choi 1975), and such maps embed in every type with
//  d1 d2 >= 8. No product of two integers >= 2 is 7. So readable <=>
//  d1 d2 <= 6. The model cites these theorems; it does not prove them.
//
//  centralCharge(d1, d2): Q = i diag(d2 1_d1; -d1 1_d2) acts on the pair as
//  the scalar i (d2 - d1) (Lemma S6).
//
//  enumerateConfigs(): Sec. S5. A configuration is a centre of dimension
//  c in {2, 3} with a multiset of arms, each a link to a far end of
//  dimension e in {2, 3}, read or unread. Reads 1 .. c + 1, links 2 .. c + 1.
//  The read cap admits a configuration when every read arm is readable.
//  It is readable when it is admitted and has two or more reads. The three
//  filters of Theorem 1: endRule (no read arm with c < e), twoPoint
//  (exactly two reads and one unread arm, all of one type), charge (every
//  arm has c != e).
//
//  grep -n targets:  export function readCap | readableTypes |
//  centralCharge | chargeQ | readoutDimension | enumerateConfigs |
//  configLabel | function recordsPerPair
// ============================================================================
import { buildRecords } from './records.js';

export function readCap(d1, d2) {
  const lo = Math.min(d1, d2), hi = Math.max(d1, d2), p = d1 * d2;
  if (lo < 2) return { d1, d2, product: p, readable: false, reason: 'A one-dimensional system ends no pair.', cite: null };
  if (lo === 2 && hi === 2) return { d1, d2, product: p, readable: true, reason: 'Every positive map is decomposable.', cite: 'Størmer 1963' };
  if (lo === 2 && hi === 3) return { d1, d2, product: p, readable: true, reason: 'Every positive map is decomposable.', cite: 'Woronowicz 1976' };
  if (lo === 2) return { d1, d2, product: p, readable: false, key: '(2,4)',
    reason: hi === 4 ? 'A non-decomposable positive map exists.' : 'The (2,4) map embeds.', cite: 'Woronowicz 1976' };
  return { d1, d2, product: p, readable: false, key: '(3,3)',
    reason: lo === 3 && hi === 3 ? 'The Choi map is positive and not decomposable.' : 'The Choi map of (3,3) embeds.', cite: 'Choi 1975' };
}

// Readable types (d1 <= d2) with dimensions 2 .. maxD.
export function readableTypes(maxD = 5) {
  const out = [];
  for (let a = 2; a <= maxD; a++) for (let b = a; b <= maxD; b++) if (readCap(a, b).readable) out.push([a, b]);
  return out;
}

// The scalar by which Q acts on a (d1, d2) pair: i (d2 - d1).
export function centralCharge(d1, d2) { return { re: 0, im: d2 - d1 }; }

// Q as the diagonal of a (d1 + d2) matrix, imaginary parts only.
export function chargeQ(d1 = 2, d2 = 3) {
  return { im: [...Array(d1).fill(d2), ...Array(d2).fill(-d1)], re: Array(d1 + d2).fill(0) };
}

// Readout dimension N = prod over read arms (c e)^2 * prod over unread
// arms (c^2 - 1)(e^2 - 1) (Lemma S8). config: { center, arms: [{far,
// read}] } or { center, far: [e1, e2], unread: e | null }.
export function readoutDimension(config = { center: 3, far: [2, 2], unread: 2 }) {
  const c = config.center;
  const arms = config.arms || [
    ...config.far.map(e => ({ far: e, read: true })),
    ...(config.unread ? [{ far: config.unread, read: false }] : []),
  ];
  let N = 1;
  for (const a of arms) N *= a.read ? (c * a.far) ** 2 : (c * c - 1) * (a.far * a.far - 1);
  return N;
}

function factor23(n) { let p = 0, q = 0; while (n % 2 === 0) { n /= 2; p++; } while (n % 3 === 0) { n /= 3; q++; } return { p2: p, p3: q, rest: n }; }

export function configLabel(arms) {
  const R = arms.filter(a => a.read).map(a => a.far).sort();
  const U = arms.filter(a => !a.read).map(a => a.far).sort();
  return [...R.map(e => e + 'R'), ...U.map(e => e + 'U')].join(' ');
}

const recCache = new Map();
function recordsFor(c, e1, e2) {
  const key = c + ':' + Math.min(e1, e2) + ':' + Math.max(e1, e2);
  if (!recCache.has(key)) recCache.set(key, buildRecords({ center: c, far: [Math.min(e1, e2), Math.max(e1, e2)], unread: null }).length);
  return recCache.get(key);
}
// Records per unordered pair of read arms, grouped by the far dims.
function recordsPerPair(c, arms) {
  const reads = arms.filter(a => a.read).map(a => a.far);
  const m = new Map();
  for (let i = 0; i < reads.length; i++) for (let j = i + 1; j < reads.length; j++) {
    const f = [reads[i], reads[j]].sort();
    const k = f.join(',');
    if (!m.has(k)) m.set(k, { far: f, pairs: 0, records: recordsFor(c, f[0], f[1]) });
    m.get(k).pairs++;
  }
  return [...m.values()];
}

// Multisets of size n from the list of kinds (non-decreasing indices).
function multisets(kinds, n, start = 0, acc = [], out = []) {
  if (acc.length === n) { out.push(acc.slice()); return out; }
  for (let i = start; i < kinds.length; i++) { acc.push(kinds[i]); multisets(kinds, n, i, acc, out); acc.pop(); }
  return out;
}

// opts.linksAtBound: only configurations with exactly c + 1 links.
export function enumerateConfigs(opts = {}) {
  const kinds = [];
  for (const e of [2, 3]) for (const read of [true, false]) kinds.push({ far: e, read });
  const out = [];
  for (const c of [2, 3]) {
    const bound = c + 1;
    for (let L = 2; L <= bound; L++) {
      if (opts.linksAtBound && L !== bound) continue;
      for (const arms of multisets(kinds, L)) {
        const reads = arms.filter(a => a.read).length;
        if (reads < 1 || reads > bound) continue;
        const unread = L - reads;
        const admitted = arms.every(a => !a.read || readCap(c, a.far).readable);
        const readable = admitted && reads >= 2;
        const N = readoutDimension({ center: c, arms });
        const f = factor23(N);
        const filters = {
          endRule: arms.every(a => !a.read || c >= a.far),
          twoPoint: reads === 2 && unread === 1 && arms.every(a => a.far === arms[0].far),
          charge: arms.every(a => centralCharge(c, a.far).im !== 0),
        };
        out.push({
          center: c, arms: arms.map(a => ({ far: a.far, read: a.read })), label: configLabel(arms),
          links: L, reads, unread, N, Nfactors: [f.p2, f.p3],
          admitted, readable,
          records: readable ? recordsPerPair(c, arms) : null,
          filters,
          isObject: readable && filters.endRule && filters.twoPoint && filters.charge,
        });
      }
    }
  }
  // Rank of the readable ones by N (1 = smallest; ties share a rank).
  const rs = out.filter(o => o.readable).map(o => o.N).sort((a, b) => a - b);
  for (const o of out) o.rankByN = o.readable ? rs.indexOf(o.N) + 1 : null;
  return out;
}
