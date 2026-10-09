// ============================================================================
//  NEURON LAB ENGINE  ·  hashstate.js  ·  the lab in the URL hash
// ----------------------------------------------------------------------------
//  encodeHash(state) -> 'seed=7&s=m12.b0.s3.w9&lock=mb&mode=net&...'
//  decodeHash(str)   -> state. An old hash with only a cell id
//  ('#purkinje') still works: it gives { type }.
//
//  state: {
//    type      the one-cell type ('pyramidal' ...)
//    cs        the one-cell shape seed (New shape)
//    seed      the master seed that the dice and the seed box show
//    seeds     { morph, bio, stim, wire }: 0 = the page defaults
//    lock      ['morph', ...]: categories that the dice leave alone
//    mode      'cell' | 'net'
//    ranges    { cat: { key: { lo, hi } | { on: false } | { choices } } }
//    net       { n, layout, vel, types: [...], conns: [{ pre, post, ty, w, sec, x, d }],
//                pos: [[x, y, z] | null] }  (null: no edits since the dice)
//  }
//  Weights are kept in units of 1e-5 uS, x in 1/100, fixed delays in 0.1 ms,
//  positions in um, so a value that went through the hash once comes back
//  the same every time (tests.mjs checks the round trip).
//
//  grep -n targets
//    "export function encodeHash"  state -> string
//    "export function decodeHash"  string -> state
//    "export function quantize"    the values the hash can hold
// ============================================================================
import { CATS, RANGES, TYPES } from './random.js';

const TL = { pyramidal: 'p', purkinje: 'k', motor: 'm', granule: 'g' };
const LT = Object.fromEntries(Object.entries(TL).map(([a, b]) => [b, a]));
const CL = { morph: 'm', bio: 'b', stim: 's', wire: 'w' };
const LC = Object.fromEntries(Object.entries(CL).map(([a, b]) => [b, a]));
const num = v => { const x = +(+v).toPrecision(6); return String(x); };

export function quantize(c) {
  const o = { pre: c.pre | 0, post: c.post | 0, ty: c.ty === 'i' ? 'i' : 'e', w: Math.round(c.w * 1e5) / 1e5, sec: c.sec | 0, x: Math.round(c.x * 100) / 100 };
  if (c.d != null) o.d = Math.round(c.d * 10) / 10;
  return o;
}

export function encodeHash(st) {
  const q = [];
  if (st.seed) q.push('seed=' + (st.seed >>> 0));
  if (st.seeds) q.push('s=' + CATS.map(c => CL[c.id] + ((st.seeds[c.id] || 0) >>> 0)).join('.'));
  if (st.lock && st.lock.length) q.push('lock=' + st.lock.map(c => CL[c]).join(''));
  if (st.mode === 'net') q.push('mode=net');
  if (st.type && st.type !== 'pyramidal') q.push('type=' + st.type);
  if (st.cs && st.cs !== 1) q.push('cs=' + (st.cs >>> 0));
  if (st.ranges) {
    const R = [];
    for (const [cat, keys] of Object.entries(st.ranges)) for (const [k, r] of Object.entries(keys || {})) {
      if (!RANGES[cat] || !RANGES[cat][k]) continue;
      if (r.on === false) R.push(`${CL[cat]}:${k}:off`);
      else if (r.choices) R.push(`${CL[cat]}:${k}:c:${r.choices.join(',')}`);
      else if (r.lo != null && r.hi != null) R.push(`${CL[cat]}:${k}:${num(r.lo)}:${num(r.hi)}`);
    }
    if (R.length) q.push('r=' + R.join('~'));
  }
  const N = st.net;
  if (N) {
    q.push(`net=${N.n}_${N.layout || 'ring'}_${num(N.vel ?? 0.3)}`);
    if (N.types && N.types.length) q.push('ty=' + N.types.map(t => TL[t] || 'p').join(''));
    if (N.conns) q.push('c=' + N.conns.map(c0 => { const c = quantize(c0); return `${c.pre}-${c.post}-${c.ty}-${Math.round(c.w * 1e5)}-${c.sec}-${Math.round(c.x * 100)}` + (c.d != null ? `-${Math.round(c.d * 10)}` : ''); }).join('_'));
    if (N.pos && N.pos.some(Boolean)) q.push('pos=' + N.pos.map(p => p ? p.map(v => Math.round(v)).join(':') : '').join('_'));
  }
  return q.join('&');
}

export function decodeHash(str) {
  str = String(str || '').replace(/^#/, '');
  if (TYPES.includes(str)) return { type: str };
  const P = new URLSearchParams(str), st = {};
  if (P.has('seed')) st.seed = (+P.get('seed') >>> 0) || 1;
  if (P.has('s')) {
    st.seeds = {};
    for (const part of P.get('s').split('.')) { const c = LC[part[0]]; if (c) st.seeds[c] = (+part.slice(1) >>> 0) || 0; }
  }
  if (P.has('lock')) st.lock = P.get('lock').split('').map(ch => LC[ch]).filter(Boolean);
  if (P.get('mode') === 'net') st.mode = 'net';
  if (P.has('type') && TYPES.includes(P.get('type'))) st.type = P.get('type');
  if (P.has('cs')) st.cs = (+P.get('cs') >>> 0) || 1;
  if (P.has('r')) {
    st.ranges = {};
    for (const e of P.get('r').split('~')) {
      const [cl, k, a, b] = e.split(':'), cat = LC[cl];
      if (!cat || !RANGES[cat][k]) continue;
      const o = (st.ranges[cat] = st.ranges[cat] || {});
      if (a === 'off') o[k] = { on: false };
      else if (a === 'c') o[k] = { choices: (b || '').split(',').filter(x => RANGES[cat][k].choices.includes(x)) };
      else if (Number.isFinite(+a) && Number.isFinite(+b)) o[k] = { lo: +a, hi: +b };
    }
  }
  if (P.has('net')) {
    const [n, layout, vel] = P.get('net').split('_');
    const N = st.net = { n: Math.max(1, Math.min(12, +n | 0)), layout: layout || 'ring', vel: Number.isFinite(+vel) ? +vel : 0.3 };
    if (P.has('ty')) N.types = P.get('ty').split('').map(ch => LT[ch] || 'pyramidal');
    if (P.has('c')) {
      N.conns = P.get('c') ? P.get('c').split('_').map(s => {
        const f = s.split('-'); if (f.length < 6) return null;
        const c = { pre: +f[0] | 0, post: +f[1] | 0, ty: f[2] === 'i' ? 'i' : 'e', w: (+f[3]) / 1e5, sec: +f[4] | 0, x: (+f[5]) / 100 };
        if (f[6] != null) c.d = (+f[6]) / 10;
        return c;
      }).filter(c => c && c.pre < N.n && c.post < N.n && c.pre !== c.post) : [];
    }
    if (P.has('pos')) N.pos = P.get('pos').split('_').map(s => s ? s.split(':').map(Number) : null);
  }
  return st;
}
