// interpreter.js — MarkovJunior core, ported from C# to JavaScript.
//
// Source: github.com/mxgmn/MarkovJunior, Copyright (C) 2022 Maxim Gumin,
// The MIT License (MIT). The full notice is in LICENSE-MarkovJunior.txt next
// to this file. This module has no DOM, so Node and Deno can run it headless.
//
// What is ported, file for file:
//   Interpreter.cs   Interpreter (start / step instead of an IEnumerable)
//   Node.cs          Branch, SequenceNode, MarkovNode, node factory
//   Grid.cs          Grid, unions, wave masks
//   Rule.cs          Rule, pattern parse, rotation, reflection
//   SymmetryHelper   squareSymmetries, subgroup table (2D)
//   RuleNode.cs      incremental match set, fields, observe (greedy)
//   OneNode / AllNode / ParallelNode
//   Field.cs         BFS potentials, DeltaPointwise
//   Observation.cs   future set, backward potentials
//   Path.cs, Convolution.cs
//
// Not ported: 3D grids, map, wfc, convchain, search="True", file rules
// (fin / fout / file). load() reports these as errors.
//
// Additions for the page, none of which change the rewrite semantics:
//   - a seeded mulberry32 generator in place of System.Random
//   - ip.mark(i): per-cell stamp (turn of last write), writer (leaf id) and
//     heat (write count), for the visualization passes
//   - ip.incremental = false forces a full rescan on every rule node turn,
//     so the page can show what incremental matching saves
//   - ip.symmetryDefault replaces the root default symmetry group
//   - ip.temperature >= 0 replaces the temperature of every inference node
//
// grep: class Interpreter  class Grid  class Rule  class RuleNode  class OneNode
//       class AllNode  class ParallelNode  class Field  const Observation
//       class PathNode  class ConvolutionNode  export function parseXML

// ─── XML ────────────────────────────────────────────────────────────────────
// A small parser for the model files: elements, attributes, comments,
// declarations and the five XML entities. It keeps the line of each element.
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unent = (s) => s.replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ENT[e]);

export function parseXML(src) {
  src = src.replace(/^﻿/, '');
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const root = { tag: '#doc', attrs: {}, children: [], line: 0 };
  const stack = [root];
  let line = 1, pos = 0, m;
  while ((m = re.exec(src))) {
    for (let k = pos; k < m.index; k++) if (src.charCodeAt(k) === 10) line++;
    pos = m.index;
    if (m[1]) {
      const top = stack.pop();
      if (!top || top.tag !== m[1]) throw new Error(`mismatched </${m[1]}> at line ${line}`);
    } else if (m[2]) {
      const el = { tag: m[2], attrs: {}, children: [], line, parent: stack[stack.length - 1] };
      let a;
      attrRe.lastIndex = 0;
      while ((a = attrRe.exec(m[3]))) el.attrs[a[1]] = unent(a[2] ?? a[3]);
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
  const top = root.children[0];
  if (!top) throw new Error('empty document');
  top.parent = null;
  return top;
}

class MJError extends Error {}
const fail = (msg, el) => { throw new MJError(el ? `${msg} at line ${el.line}` : msg); };

function get(el, name, dflt) {
  const v = el.attrs[name];
  if (v === undefined) {
    if (dflt === undefined) fail(`<${el.tag}> needs attribute "${name}"`, el);
    return dflt;
  }
  if (typeof dflt === 'boolean') return v.toLowerCase() === 'true';
  if (typeof dflt === 'number') return Number(v);
  return v;
}
const elements = (el, names) => el.children.filter((c) => names.includes(c.tag));
function myDescendants(el, tags) {
  const out = [], q = [el];
  while (q.length) {
    const e = q.shift();
    if (e !== el) out.push(e);
    for (const x of elements(e, tags)) q.push(x);
  }
  return out;
}

// ─── random ─────────────────────────────────────────────────────────────────
export class Random {
  constructor(seed) { this.a = (seed | 0) || 0x9e3779b9; }
  nextDouble() {
    let a = (this.a = (this.a + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  next(n) { return n === undefined ? Math.floor(this.nextDouble() * 2147483647) : Math.floor(this.nextDouble() * n); }
}
function shuffle(n, random) {
  const a = new Int32Array(n);
  for (let i = 0; i < n; i++) { const j = random.next(i + 1); a[i] = a[j]; a[j] = i; }
  return a;
}

// ─── symmetry ───────────────────────────────────────────────────────────────
export const SQUARE_SUBGROUPS = {
  '()': [1, 0, 0, 0, 0, 0, 0, 0],
  '(x)': [1, 1, 0, 0, 0, 0, 0, 0],
  '(y)': [1, 0, 0, 0, 0, 1, 0, 0],
  '(x)(y)': [1, 1, 0, 0, 1, 1, 0, 0],
  '(xy+)': [1, 0, 1, 0, 1, 0, 1, 0],
  '(xy)': [1, 1, 1, 1, 1, 1, 1, 1],
};
function getSymmetry(s, dflt) {
  if (s == null) return dflt;
  return SQUARE_SUBGROUPS[s] ?? null;
}
function squareSymmetries(thing, rotation, reflection, same, subgroup) {
  const t = new Array(8);
  t[0] = thing; t[1] = reflection(t[0]);
  t[2] = rotation(t[0]); t[3] = reflection(t[2]);
  t[4] = rotation(t[2]); t[5] = reflection(t[4]);
  t[6] = rotation(t[4]); t[7] = reflection(t[6]);
  const result = [];
  for (let i = 0; i < 8; i++) {
    if ((!subgroup || subgroup[i]) && !result.some((s) => same(s, t[i]))) result.push(t[i]);
  }
  return result;
}

// ─── grid ───────────────────────────────────────────────────────────────────
export class Grid {
  static load(el, MX, MY, MZ) {
    const g = new Grid();
    g.MX = MX; g.MY = MY; g.MZ = MZ;
    const valueString = el.attrs.values?.replace(/ /g, '');
    if (valueString == null) fail('no values specified', el);
    g.C = valueString.length;
    if (g.C > 30) fail('more than 30 values', el);
    g.values = new Map(); g.waves = new Map(); g.characters = [];
    for (let i = 0; i < g.C; i++) {
      const s = valueString[i];
      if (g.values.has(s)) fail(`repeating value ${s}`, el);
      g.characters.push(s); g.values.set(s, i); g.waves.set(s, 1 << i);
    }
    g.waves.set('*', (1 << g.C) - 1);
    for (const u of myDescendants(el, ['markov', 'sequence', 'union']).filter((x) => x.tag === 'union')) {
      const symbol = get(u, 'symbol')[0];
      if (g.waves.has(symbol)) fail(`repeating union type ${symbol}`, u);
      g.waves.set(symbol, g.wave(get(u, 'values'), u));
    }
    const N = MX * MY * MZ;
    g.state = new Uint8Array(N);
    g.mask = new Uint8Array(N);
    g.folder = el.attrs.folder ?? null;
    return g;
  }
  wave(values, el) {
    let sum = 0;
    for (const ch of values) {
      if (!this.values.has(ch)) fail(`unknown value ${ch}`, el);
      sum += 1 << this.values.get(ch);
    }
    return sum;
  }
  clear() { this.state.fill(0); }
  matches(rule, x, y, z) {
    const { MX, MY, state } = this;
    let dz = 0, dy = 0, dx = 0;
    const input = rule.input;
    for (let di = 0; di < input.length; di++) {
      if ((input[di] & (1 << state[x + dx + (y + dy) * MX + (z + dz) * MX * MY])) === 0) return false;
      dx++;
      if (dx === rule.IMX) { dx = 0; dy++; if (dy === rule.IMY) { dy = 0; dz++; } }
    }
    return true;
  }
}

// ─── rule ───────────────────────────────────────────────────────────────────
export class Rule {
  constructor(input, IMX, IMY, IMZ, output, OMX, OMY, OMZ, C, p) {
    Object.assign(this, { input, output, IMX, IMY, IMZ, OMX, OMY, OMZ, p, C });
    const lists = [...Array(C)].map(() => []);
    for (let z = 0; z < IMZ; z++) for (let y = 0; y < IMY; y++) for (let x = 0; x < IMX; x++) {
      let w = input[x + y * IMX + z * IMX * IMY];
      for (let c = 0; c < C; c++, w >>= 1) if (w & 1) lists[c].push(x, y, z);
    }
    this.ishifts = lists.map((l) => Int32Array.from(l));
    if (OMX === IMX && OMY === IMY && OMZ === IMZ) {
      const ol = [...Array(C)].map(() => []);
      for (let z = 0; z < OMZ; z++) for (let y = 0; y < OMY; y++) for (let x = 0; x < OMX; x++) {
        const o = output[x + y * OMX + z * OMX * OMY];
        if (o !== 0xff) ol[o].push(x, y, z);
        else for (let c = 0; c < C; c++) ol[c].push(x, y, z);
      }
      this.oshifts = ol.map((l) => Int32Array.from(l));
    }
    const wildcard = (1 << C) - 1;
    this.binput = Uint8Array.from(input, (w) => (w === wildcard ? 0xff : 31 - Math.clz32(w & -w)));
    this.original = false;
  }
  zRotated() {
    const { IMX, IMY, IMZ, OMX, OMY, OMZ, input, output } = this;
    const ni = new Int32Array(input.length);
    for (let z = 0; z < IMZ; z++) for (let y = 0; y < IMX; y++) for (let x = 0; x < IMY; x++)
      ni[x + y * IMY + z * IMX * IMY] = input[IMX - 1 - y + x * IMX + z * IMX * IMY];
    const no = new Uint8Array(output.length);
    for (let z = 0; z < OMZ; z++) for (let y = 0; y < OMX; y++) for (let x = 0; x < OMY; x++)
      no[x + y * OMY + z * OMX * OMY] = output[OMX - 1 - y + x * OMX + z * OMX * OMY];
    return new Rule(ni, IMY, IMX, IMZ, no, OMY, OMX, OMZ, this.C, this.p);
  }
  reflected() {
    const { IMX, IMY, IMZ, OMX, OMY, OMZ, input, output } = this;
    const ni = new Int32Array(input.length);
    for (let z = 0; z < IMZ; z++) for (let y = 0; y < IMY; y++) for (let x = 0; x < IMX; x++)
      ni[x + y * IMX + z * IMX * IMY] = input[IMX - 1 - x + y * IMX + z * IMX * IMY];
    const no = new Uint8Array(output.length);
    for (let z = 0; z < OMZ; z++) for (let y = 0; y < OMY; y++) for (let x = 0; x < OMX; x++)
      no[x + y * OMX + z * OMX * OMY] = output[OMX - 1 - x + y * OMX + z * OMX * OMY];
    return new Rule(ni, IMX, IMY, IMZ, no, OMX, OMY, OMZ, this.C, this.p);
  }
  static same(a, b) {
    if (a.IMX !== b.IMX || a.IMY !== b.IMY || a.IMZ !== b.IMZ || a.OMX !== b.OMX || a.OMY !== b.OMY || a.OMZ !== b.OMZ) return false;
    for (let i = 0; i < a.input.length; i++) if (a.input[i] !== b.input[i]) return false;
    for (let i = 0; i < a.output.length; i++) if (a.output[i] !== b.output[i]) return false;
    return true;
  }
  symmetries(symmetry) {
    return squareSymmetries(this, (r) => r.zRotated(), (r) => r.reflected(), Rule.same, symmetry);
  }
  static parse(s, el) {
    const lines = s.split(' ').map((l) => l.split('/'));
    const MX = lines[0][0].length, MY = lines[0].length, MZ = lines.length;
    const result = new Array(MX * MY * MZ);
    for (let z = 0; z < MZ; z++) {
      const lz = lines[MZ - 1 - z];
      if (lz.length !== MY) fail('non-rectangular pattern', el);
      for (let y = 0; y < MY; y++) {
        if (lz[y].length !== MX) fail('non-rectangular pattern', el);
        for (let x = 0; x < MX; x++) result[x + y * MX + z * MX * MY] = lz[y][x];
      }
    }
    return { rect: result, MX, MY, MZ };
  }
  static load(el, gin, gout) {
    if (el.attrs.file || el.attrs.fin || el.attrs.fout) fail('file rules (fin / fout / file) are not supported in this port', el);
    const inS = el.attrs.in, outS = el.attrs.out;
    if (inS == null) fail('no input in a rule', el);
    if (outS == null) fail('no output in a rule', el);
    const I = Rule.parse(inS, el), O = Rule.parse(outS, el);
    if (gin === gout && (O.MZ !== I.MZ || O.MY !== I.MY || O.MX !== I.MX)) fail('non-matching pattern sizes', el);
    if (I.MZ > 1) fail('3D patterns are not supported in this port', el);
    const input = Int32Array.from(I.rect, (c) => {
      const w = gin.waves.get(c);
      if (w === undefined) fail(`input code ${c} is not found in codes`, el);
      return w;
    });
    const output = Uint8Array.from(O.rect, (c) => {
      if (c === '*') return 0xff;
      const v = gout.values.get(c);
      if (v === undefined) fail(`output code ${c} is not found in codes`, el);
      return v;
    });
    const r = new Rule(input, I.MX, I.MY, I.MZ, output, O.MX, O.MY, O.MZ, gin.C, get(el, 'p', 1.0));
    r.inString = inS; r.outString = outS;
    return r;
  }
}

// ─── nodes ──────────────────────────────────────────────────────────────────
const NODE_NAMES = ['one', 'all', 'prl', 'markov', 'sequence', 'path', 'map', 'convolution', 'convchain', 'wfc'];

function factory(el, symmetry, ip, grid) {
  if (!NODE_NAMES.includes(el.tag)) fail(`unknown node type "${el.tag}"`, el);
  const C = { one: OneNode, all: AllNode, prl: ParallelNode, markov: MarkovNode, sequence: SequenceNode,
    path: PathNode, convolution: ConvolutionNode }[el.tag];
  if (!C) fail(`<${el.tag}> nodes are not supported in this port`, el);
  const node = new C();
  node.ip = ip; node.grid = grid; node.el = el; node.kind = el.tag;
  node.load(el, symmetry, grid);
  return node;
}

class Branch {
  constructor() { this.parent = null; this.nodes = []; this.n = 0; }
  load(el, parentSymmetry) {
    const symmetry = getSymmetry(el.attrs.symmetry, parentSymmetry);
    if (!symmetry) fail(`unknown symmetry ${el.attrs.symmetry}`, el);
    this.nodes = elements(el, NODE_NAMES).map((x) => {
      const child = factory(x, symmetry, this.ip, this.grid);
      if (child instanceof Branch) child.parent = this;
      return child;
    });
  }
  go() {
    for (; this.n < this.nodes.length; this.n++) {
      const node = this.nodes[this.n];
      if (node instanceof Branch) this.ip.current = node;
      if (node.go()) return true;
    }
    this.ip.current = this.ip.current.parent;
    this.reset();
    return false;
  }
  reset() { for (const node of this.nodes) node.reset(); this.n = 0; }
}
class SequenceNode extends Branch {}
class MarkovNode extends Branch {
  go() { this.n = 0; return super.go(); }
}

// ─── field ──────────────────────────────────────────────────────────────────
class Field {
  constructor(el, grid) {
    this.recompute = get(el, 'recompute', false);
    this.essential = get(el, 'essential', false);
    this.substrate = grid.wave(get(el, 'on'), el);
    let zero = el.attrs.from;
    this.inversed = zero != null;
    if (zero == null) zero = get(el, 'to');
    this.zero = grid.wave(zero, el);
  }
  compute(potential, grid) {
    const { MX, MY, MZ, state } = grid;
    const N = state.length;
    const q = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) {
      potential[i] = -1;
      if (this.zero & (1 << state[i])) { potential[i] = 0; q[tail++] = i; }
    }
    if (!tail) return false;
    const plane = MX * MY;
    while (head < tail) {
      const i = q[head++];
      const t = potential[i];
      const x = i % MX, y = ((i / MX) | 0) % MY, z = (i / plane) | 0;
      const visit = (j) => {
        if (potential[j] === -1 && (this.substrate & (1 << state[j]))) { potential[j] = t + 1; q[tail++] = j; }
      };
      if (x > 0) visit(i - 1);
      if (x < MX - 1) visit(i + 1);
      if (y > 0) visit(i - MX);
      if (y < MY - 1) visit(i + MX);
      if (z > 0) visit(i - plane);
      if (z < MZ - 1) visit(i + plane);
    }
    return true;
  }
  static deltaPointwise(state, rule, x, y, z, fields, potentials, MX, MY) {
    let sum = 0, dz = 0, dy = 0, dx = 0;
    for (let di = 0; di < rule.input.length; di++) {
      const nv = rule.output[di];
      if (nv !== 0xff && (rule.input[di] & (1 << nv)) === 0) {
        const i = x + dx + (y + dy) * MX + (z + dz) * MX * MY;
        const np = potentials[nv][i];
        if (np === -1) return null;
        const ov = state[i];
        const op = potentials[ov][i];
        sum += np - op;
        if (fields) {
          if (fields[ov]?.inversed) sum += 2 * op;
          if (fields[nv]?.inversed) sum -= 2 * np;
        }
      }
      dx++;
      if (dx === rule.IMX) { dx = 0; dy++; if (dy === rule.IMY) { dy = 0; dz++; } }
    }
    return sum;
  }
}

// ─── observation ────────────────────────────────────────────────────────────
const Observation = {
  computeFutureSetPresent(future, state, observations, ip) {
    const mask = observations.map((o) => o == null);
    for (let i = 0; i < state.length; i++) {
      const v = state[i];
      const obs = observations[v];
      mask[v] = true;
      if (obs) { future[i] = obs.to; if (state[i] !== obs.from) { state[i] = obs.from; ip.mark(i); } }
      else future[i] = 1 << v;
    }
    return mask.every(Boolean);
  },
  computeBackwardPotentials(potentials, future, MX, MY, MZ, rules) {
    for (let c = 0; c < potentials.length; c++) {
      const p = potentials[c];
      for (let i = 0; i < future.length; i++) p[i] = future[i] & (1 << c) ? 0 : -1;
    }
    Observation.computePotentials(potentials, MX, MY, MZ, rules, true);
  },
  computePotentials(potentials, MX, MY, MZ, rules, backwards) {
    const N = potentials[0].length;
    const qc = [], qi = [];
    for (let c = 0; c < potentials.length; c++) {
      const p = potentials[c];
      for (let i = 0; i < N; i++) if (p[i] === 0) { qc.push(c); qi.push(i); }
    }
    const matchMask = rules.map(() => new Uint8Array(N));
    for (let h = 0; h < qc.length; h++) {
      const value = qc[h], i = qi[h];
      const x = i % MX, y = ((i / MX) | 0) % MY, z = (i / (MX * MY)) | 0;
      const t = potentials[value][i];
      for (let r = 0; r < rules.length; r++) {
        const maskr = matchMask[r], rule = rules[r];
        const shifts = backwards ? rule.oshifts[value] : rule.ishifts[value];
        for (let l = 0; l < shifts.length; l += 3) {
          const sx = x - shifts[l], sy = y - shifts[l + 1], sz = z - shifts[l + 2];
          if (sx < 0 || sy < 0 || sz < 0 || sx + rule.IMX > MX || sy + rule.IMY > MY || sz + rule.IMZ > MZ) continue;
          const si = sx + sy * MX + sz * MX * MY;
          if (!maskr[si] && Observation.forwardMatches(rule, sx, sy, sz, potentials, t, MX, MY, backwards)) {
            maskr[si] = 1;
            Observation.applyForward(rule, sx, sy, sz, potentials, t, MX, MY, qc, qi, backwards);
          }
        }
      }
    }
  },
  forwardMatches(rule, x, y, z, potentials, t, MX, MY, backwards) {
    let dz = 0, dy = 0, dx = 0;
    const a = backwards ? rule.output : rule.binput;
    for (let di = 0; di < a.length; di++) {
      const value = a[di];
      if (value !== 0xff) {
        const cur = potentials[value][x + dx + (y + dy) * MX + (z + dz) * MX * MY];
        if (cur > t || cur === -1) return false;
      }
      dx++;
      if (dx === rule.IMX) { dx = 0; dy++; if (dy === rule.IMY) { dy = 0; dz++; } }
    }
    return true;
  },
  applyForward(rule, x, y, z, potentials, t, MX, MY, qc, qi, backwards) {
    const a = backwards ? rule.binput : rule.output;
    for (let dz = 0; dz < rule.IMZ; dz++) for (let dy = 0; dy < rule.IMY; dy++) for (let dx = 0; dx < rule.IMX; dx++) {
      const idi = x + dx + (y + dy) * MX + (z + dz) * MX * MY;
      const o = a[dx + dy * rule.IMX + dz * rule.IMX * rule.IMY];
      if (o !== 0xff && potentials[o][idi] === -1) { potentials[o][idi] = t + 1; qc.push(o); qi.push(idi); }
    }
  },
  isGoalReached(present, future) {
    for (let i = 0; i < present.length; i++) if (((1 << present[i]) & future[i]) === 0) return false;
    return true;
  },
};

// ─── rule nodes ─────────────────────────────────────────────────────────────
class RuleNode {
  load(el, parentSymmetry, grid) {
    const symmetry = getSymmetry(el.attrs.symmetry, parentSymmetry);
    if (!symmetry) fail(`unknown symmetry ${el.attrs.symmetry}`, el);
    const xrules = elements(el, ['rule']);
    const ruleEls = xrules.length ? xrules : [el];
    this.rules = [];
    this.originals = [];
    for (const xr of ruleEls) {
      const rule = Rule.load(xr, grid, grid);
      rule.original = true;
      const rs = getSymmetry(xr.attrs.symmetry, symmetry);
      if (!rs) fail(`unknown symmetry ${xr.attrs.symmetry}`, xr);
      const variants = rule.symmetries(rs);
      this.originals.push({ rule, variants: variants.length, first: this.rules.length });
      this.rules.push(...variants);
    }
    this.last = new Uint8Array(this.rules.length);
    this.steps = get(el, 'steps', 0);
    this.temperature = get(el, 'temperature', 0.0);
    const xfields = elements(el, ['field']);
    const N = grid.state.length;
    if (xfields.length) {
      this.fields = new Array(grid.C).fill(null);
      for (const xf of xfields) {
        const c = get(xf, 'for')[0];
        const v = grid.values.get(c);
        if (v === undefined) fail(`unknown field value ${c}`, xf);
        this.fields[v] = new Field(xf, grid);
      }
      this.potentials = [...Array(grid.C)].map(() => new Int32Array(N));
    }
    const xobs = elements(el, ['observe']);
    if (xobs.length) {
      this.observations = new Array(grid.C).fill(null);
      for (const x of xobs) {
        const value = grid.values.get(get(x, 'value')[0]);
        if (value === undefined) fail('unknown observe value', x);
        const from = get(x, 'from', grid.characters[value])[0];
        if (!grid.values.has(from)) fail(`unknown observe from ${from}`, x);
        this.observations[value] = { from: grid.values.get(from), to: grid.wave(get(x, 'to'), x) };
      }
      if (get(el, 'search', false)) fail('search="True" is not supported in this port', el);
      this.potentials = [...Array(grid.C)].map(() => new Int32Array(N));
      this.future = new Int32Array(N);
    }
    this.matches = [];   // flat r, x, y, z
    this.matchCount = 0;
    this.lastMatchedTurn = -1;
    this.counter = 0;
    this.futureComputed = false;
  }
  reset() {
    this.lastMatchedTurn = -1;
    this.counter = 0;
    this.futureComputed = false;
    this.last.fill(0);
  }
  add(r, x, y, z, maskr) {
    maskr[x + y * this.grid.MX + z * this.grid.MX * this.grid.MY] = 1;
    const k = this.matchCount * 4;
    this.matches[k] = r; this.matches[k + 1] = x; this.matches[k + 2] = y; this.matches[k + 3] = z;
    this.matchCount++;
  }
  temp() { return this.ip.temperature >= 0 ? this.ip.temperature : this.temperature; }
  go() {
    const ip = this.ip, grid = this.grid;
    ip.leaf = this;
    this.last.fill(0);
    if (this.steps > 0 && this.counter >= this.steps) return false;
    const { MX, MY, MZ } = grid;
    if (this.observations && !this.futureComputed) {
      if (!Observation.computeFutureSetPresent(this.future, grid.state, this.observations, ip)) return false;
      this.futureComputed = true;
      Observation.computeBackwardPotentials(this.potentials, this.future, MX, MY, MZ, this.rules);
    }
    const rules = this.rules;
    if (this.lastMatchedTurn >= 0 && ip.incremental) {
      const plane = MX * MY;
      for (let n = ip.first[this.lastMatchedTurn]; n < ip.changes.length; n++) {
        const i = ip.changes[n];
        const x = i % MX, y = ((i / MX) | 0) % MY, z = (i / plane) | 0;
        const value = grid.state[i];
        for (let r = 0; r < rules.length; r++) {
          const rule = rules[r];
          const maskr = this.matchMask[r];
          const shifts = rule.ishifts[value];
          for (let l = 0; l < shifts.length; l += 3) {
            const sx = x - shifts[l], sy = y - shifts[l + 1], sz = z - shifts[l + 2];
            if (sx < 0 || sy < 0 || sz < 0 || sx + rule.IMX > MX || sy + rule.IMY > MY || sz + rule.IMZ > MZ) continue;
            const si = sx + sy * MX + sz * plane;
            if (!maskr[si] && grid.matches(rule, sx, sy, sz)) this.add(r, sx, sy, sz, maskr);
          }
        }
        ip.scanned++;
      }
    } else {
      this.matchCount = 0;
      if (this.matchMask && !ip.incremental) for (const m of this.matchMask) m.fill(0);
      for (let r = 0; r < rules.length; r++) {
        const rule = rules[r];
        const maskr = this.matchMask?.[r];
        for (let z = rule.IMZ - 1; z < MZ; z += rule.IMZ)
          for (let y = rule.IMY - 1; y < MY; y += rule.IMY)
            for (let x = rule.IMX - 1; x < MX; x += rule.IMX) {
              const shifts = rule.ishifts[grid.state[x + y * MX + z * MX * MY]];
              ip.scanned++;
              for (let l = 0; l < shifts.length; l += 3) {
                const sx = x - shifts[l], sy = y - shifts[l + 1], sz = z - shifts[l + 2];
                if (sx < 0 || sy < 0 || sz < 0 || sx + rule.IMX > MX || sy + rule.IMY > MY || sz + rule.IMZ > MZ) continue;
                if (grid.matches(rule, sx, sy, sz)) this.add(r, sx, sy, sz, maskr);
              }
            }
      }
    }
    if (this.fields) {
      let anySuccess = false, anyComputation = false;
      for (let c = 0; c < this.fields.length; c++) {
        const f = this.fields[c];
        if (f && (this.counter === 0 || f.recompute)) {
          const ok = f.compute(this.potentials[c], grid);
          if (!ok && f.essential) return false;
          anySuccess ||= ok;
          anyComputation = true;
        }
      }
      if (anyComputation && !anySuccess) return false;
    }
    return true;
  }
}

class OneNode extends RuleNode {
  load(el, sym, grid) {
    super.load(el, sym, grid);
    this.matchMask = this.rules.map(() => new Uint8Array(grid.state.length));
  }
  reset() {
    super.reset();
    if (this.matchCount !== 0) { for (const m of this.matchMask) m.fill(0); this.matchCount = 0; }
  }
  apply(rule, x, y, z) {
    const { MX, MY, state } = this.grid, ip = this.ip;
    for (let dz = 0; dz < rule.OMZ; dz++) for (let dy = 0; dy < rule.OMY; dy++) for (let dx = 0; dx < rule.OMX; dx++) {
      const nv = rule.output[dx + dy * rule.OMX + dz * rule.OMX * rule.OMY];
      if (nv !== 0xff) {
        const si = x + dx + (y + dy) * MX + (z + dz) * MX * MY;
        if (nv !== state[si]) { state[si] = nv; ip.changes.push(si); ip.mark(si); }
      }
    }
  }
  go() {
    if (!super.go()) return false;
    this.lastMatchedTurn = this.ip.counter;
    const m = this.randomMatch(this.ip.random);
    if (m < 0) return false;
    const k = m;
    const R = this.matches[k], X = this.matches[k + 1], Y = this.matches[k + 2], Z = this.matches[k + 3];
    this.last[R] = 1;
    this.apply(this.rules[R], X, Y, Z);
    this.counter++;
    return true;
  }
  // Returns the flat offset of the chosen match in this.matches, or -1. The
  // plain branch swaps the chosen match to the end of the live range first,
  // so its four slots stay valid until the next add.
  randomMatch(random) {
    const grid = this.grid, M = this.matches;
    if (this.potentials) {
      if (this.observations && Observation.isGoalReached(grid.state, this.future)) {
        this.futureComputed = false;
        return -1;
      }
      let max = -1000, argmax = -1, first = 0, firstSet = false;
      const T = this.temp();
      for (let k = 0; k < this.matchCount; k++) {
        const r = M[k * 4], x = M[k * 4 + 1], y = M[k * 4 + 2], z = M[k * 4 + 3];
        const i = x + y * grid.MX + z * grid.MX * grid.MY;
        if (!grid.matches(this.rules[r], x, y, z)) {
          this.matchMask[r][i] = 0;
          const e = (this.matchCount - 1) * 4;
          M[k * 4] = M[e]; M[k * 4 + 1] = M[e + 1]; M[k * 4 + 2] = M[e + 2]; M[k * 4 + 3] = M[e + 3];
          this.matchCount--;
          k--;
        } else {
          const h = Field.deltaPointwise(grid.state, this.rules[r], x, y, z, this.fields, this.potentials, grid.MX, grid.MY);
          if (h === null) continue;
          if (!firstSet) { first = h; firstSet = true; }
          const u = random.nextDouble();
          const key = T > 0 ? Math.pow(u, Math.exp((h - first) / T)) : -h + 0.001 * u;
          if (key > max) { max = key; argmax = k; }
        }
      }
      return argmax >= 0 ? argmax * 4 : -1;
    }
    while (this.matchCount > 0) {
      const mi = random.next(this.matchCount);
      const b = mi * 4, e = (this.matchCount - 1) * 4;
      const r = M[b], x = M[b + 1], y = M[b + 2], z = M[b + 3];
      this.matchMask[r][x + y * grid.MX + z * grid.MX * grid.MY] = 0;
      M[b] = M[e]; M[b + 1] = M[e + 1]; M[b + 2] = M[e + 2]; M[b + 3] = M[e + 3];
      M[e] = r; M[e + 1] = x; M[e + 2] = y; M[e + 3] = z;
      this.matchCount--;
      if (grid.matches(this.rules[r], x, y, z)) return e;
    }
    return -1;
  }
}

class AllNode extends RuleNode {
  load(el, sym, grid) {
    super.load(el, sym, grid);
    this.matchMask = this.rules.map(() => new Uint8Array(grid.state.length));
  }
  fit(r, x, y, z, newstate, MX, MY) {
    const rule = this.rules[r], state = this.grid.state, ip = this.ip;
    for (let dz = 0; dz < rule.OMZ; dz++) for (let dy = 0; dy < rule.OMY; dy++) for (let dx = 0; dx < rule.OMX; dx++) {
      const v = rule.output[dx + dy * rule.OMX + dz * rule.OMX * rule.OMY];
      if (v !== 0xff && newstate[x + dx + (y + dy) * MX + (z + dz) * MX * MY]) return;
    }
    this.last[r] = 1;
    for (let dz = 0; dz < rule.OMZ; dz++) for (let dy = 0; dy < rule.OMY; dy++) for (let dx = 0; dx < rule.OMX; dx++) {
      const nv = rule.output[dx + dy * rule.OMX + dz * rule.OMX * rule.OMY];
      if (nv !== 0xff) {
        const i = x + dx + (y + dy) * MX + (z + dz) * MX * MY;
        newstate[i] = 1;
        state[i] = nv;
        ip.changes.push(i);
        ip.mark(i);
      }
    }
  }
  go() {
    if (!super.go()) return false;
    const ip = this.ip, grid = this.grid, M = this.matches;
    this.lastMatchedTurn = ip.counter;
    if (this.matchCount === 0) return false;
    const { MX, MY } = grid;
    const at = (k) => [M[k * 4], M[k * 4 + 1], M[k * 4 + 2], M[k * 4 + 3]];
    if (this.potentials) {
      let first = 0, firstSet = false;
      const T = this.temp();
      const list = [];
      for (let m = 0; m < this.matchCount; m++) {
        const [r, x, y, z] = at(m);
        const h = Field.deltaPointwise(grid.state, this.rules[r], x, y, z, this.fields, this.potentials, MX, MY);
        if (h !== null) {
          if (!firstSet) { first = h; firstSet = true; }
          const u = ip.random.nextDouble();
          list.push([m, T > 0 ? Math.pow(u, Math.exp((h - first) / T)) : -h + 0.001 * u]);
        }
      }
      list.sort((a, b) => b[1] - a[1]);
      for (const [m] of list) {
        const [r, x, y, z] = at(m);
        this.matchMask[r][x + y * MX + z * MX * MY] = 0;
        this.fit(r, x, y, z, grid.mask, MX, MY);
      }
    } else {
      const sh = shuffle(this.matchCount, ip.random);
      for (let k = 0; k < sh.length; k++) {
        const [r, x, y, z] = at(sh[k]);
        this.matchMask[r][x + y * MX + z * MX * MY] = 0;
        this.fit(r, x, y, z, grid.mask, MX, MY);
      }
    }
    for (let n = ip.first[this.lastMatchedTurn]; n < ip.changes.length; n++) grid.mask[ip.changes[n]] = 0;
    this.counter++;
    this.matchCount = 0;
    return true;
  }
}

class ParallelNode extends RuleNode {
  load(el, sym, grid) {
    super.load(el, sym, grid);
    this.newstate = new Uint8Array(grid.state.length);
  }
  add(r, x, y, z) {
    const rule = this.rules[r], ip = this.ip;
    if (ip.random.nextDouble() > rule.p) return;
    this.last[r] = 1;
    const { MX, MY, state } = this.grid;
    for (let dz = 0; dz < rule.OMZ; dz++) for (let dy = 0; dy < rule.OMY; dy++) for (let dx = 0; dx < rule.OMX; dx++) {
      const nv = rule.output[dx + dy * rule.OMX + dz * rule.OMX * rule.OMY];
      const idi = x + dx + (y + dy) * MX + (z + dz) * MX * MY;
      if (nv !== 0xff && nv !== state[idi]) { this.newstate[idi] = nv; ip.changes.push(idi); }
    }
    this.matchCount++;
  }
  go() {
    if (!super.go()) return false;
    const ip = this.ip, state = this.grid.state;
    for (let n = ip.first[ip.counter]; n < ip.changes.length; n++) {
      const i = ip.changes[n];
      state[i] = this.newstate[i];
      ip.mark(i);
    }
    this.counter++;
    return this.matchCount > 0;
  }
}

// ─── path ───────────────────────────────────────────────────────────────────
class PathNode {
  load(el, sym, grid) {
    const startSymbols = get(el, 'from');
    this.start = grid.wave(startSymbols, el);
    const color = get(el, 'color', startSymbols[0])[0];
    if (!grid.values.has(color)) fail(`unknown color ${color}`, el);
    this.value = grid.values.get(color);
    this.finish = grid.wave(get(el, 'to'), el);
    this.inertia = get(el, 'inertia', false);
    this.longest = get(el, 'longest', false);
    this.edges = get(el, 'edges', false);
    this.vertices = get(el, 'vertices', false);
    this.substrate = grid.wave(get(el, 'on'), el);
    this.rules = [];
  }
  reset() {}
  go() {
    const ip = this.ip, grid = this.grid, { MX, MY, MZ, state } = grid;
    ip.leaf = this;
    const N = state.length;
    const gen = new Int32Array(N).fill(-1);
    const fq = [];
    const starts = [];
    for (let i = 0; i < N; i++) {
      const s = state[i];
      if (this.start & (1 << s)) starts.push(i);
      if (this.finish & (1 << s)) { gen[i] = 0; fq.push(i); }
    }
    if (!starts.length || !fq.length) return false;
    const plane = MX * MY;
    for (let h = 0; h < fq.length; h++) {
      const i = fq[h];
      const t = gen[i] + 1;
      const x = i % MX, y = ((i / MX) | 0) % MY, z = (i / plane) | 0;
      for (const [dx, dy, dz] of directions(x, y, z, MX, MY, MZ, this.edges, this.vertices)) {
        const j = i + dx + dy * MX + dz * plane;
        const v = state[j];
        if (gen[j] === -1 && ((this.substrate & (1 << v)) || (this.start & (1 << v)))) {
          if (this.substrate & (1 << v)) fq.push(j);
          gen[j] = t;
        }
      }
    }
    if (!starts.some((i) => gen[i] > 0)) return false;
    const rnd = new Random(ip.random.next());
    let min = MX * MY * MZ, max = -2, argmin = -1, argmax = -1;
    for (const p of starts) {
      const g = gen[p];
      if (g === -1) continue;
      const noise = 0.1 * rnd.nextDouble();
      if (g + noise < min) { min = g + noise; argmin = p; }
      if (g + noise > max) { max = g + noise; argmax = p; }
    }
    const pen = this.longest ? argmax : argmin;
    let px = pen % MX, py = ((pen / MX) | 0) % MY, pz = (pen / plane) | 0;
    let [dx, dy, dz] = this.direction(px, py, pz, 0, 0, 0, gen, rnd);
    px += dx; py += dy; pz += dz;
    while (gen[px + py * MX + pz * plane] !== 0) {
      const i = px + py * MX + pz * plane;
      state[i] = this.value;
      ip.changes.push(i);
      ip.mark(i);
      [dx, dy, dz] = this.direction(px, py, pz, dx, dy, dz, gen, rnd);
      px += dx; py += dy; pz += dz;
    }
    return true;
  }
  direction(x, y, z, dx, dy, dz, gen, random) {
    const { MX, MY, MZ } = this.grid;
    const plane = MX * MY;
    const g = gen[x + y * MX + z * plane];
    const cand = [];
    const add = (DX, DY, DZ) => { if (gen[x + DX + (y + DY) * MX + (z + DZ) * plane] === g - 1) cand.push([DX, DY, DZ]); };
    if (!this.vertices && !this.edges) {
      if (dx || dy || dz) {
        const cx = x + dx, cy = y + dy, cz = z + dz;
        if (this.inertia && cx >= 0 && cy >= 0 && cz >= 0 && cx < MX && cy < MY && cz < MZ && gen[cx + cy * MX + cz * plane] === g - 1)
          return [dx, dy, dz];
      }
      if (x > 0) add(-1, 0, 0);
      if (x < MX - 1) add(1, 0, 0);
      if (y > 0) add(0, -1, 0);
      if (y < MY - 1) add(0, 1, 0);
      if (z > 0) add(0, 0, -1);
      if (z < MZ - 1) add(0, 0, 1);
      return cand[random.next(cand.length)];
    }
    for (const p of directions(x, y, z, MX, MY, MZ, this.edges, this.vertices)) add(...p);
    if (this.inertia && (dx || dy || dz)) {
      let best = -4, result = [-1, -1, -1];
      for (const c of cand) {
        const noise = 0.1 * random.nextDouble();
        const cos = (c[0] * dx + c[1] * dy + c[2] * dz) / Math.sqrt((c[0] ** 2 + c[1] ** 2 + c[2] ** 2) * (dx * dx + dy * dy + dz * dz));
        if (cos + noise > best) { best = cos + noise; result = c; }
      }
      return result;
    }
    return cand[random.next(cand.length)];
  }
}
function directions(x, y, z, MX, MY, MZ, edges) {
  const r = [];
  if (x > 0) r.push([-1, 0, 0]);
  if (x < MX - 1) r.push([1, 0, 0]);
  if (y > 0) r.push([0, -1, 0]);
  if (y < MY - 1) r.push([0, 1, 0]);
  if (edges) {
    if (x > 0 && y > 0) r.push([-1, -1, 0]);
    if (x > 0 && y < MY - 1) r.push([-1, 1, 0]);
    if (x < MX - 1 && y > 0) r.push([1, -1, 0]);
    if (x < MX - 1 && y < MY - 1) r.push([1, 1, 0]);
  }
  return r;
}

// ─── convolution ────────────────────────────────────────────────────────────
const KERNELS_2D = { VonNeumann: [0, 1, 0, 1, 0, 1, 0, 1, 0], Moore: [1, 1, 1, 1, 0, 1, 1, 1, 1] };

class ConvolutionNode {
  load(el, sym, grid) {
    let xr = elements(el, ['rule']);
    if (!xr.length) xr = [el];
    this.crules = xr.map((x) => {
      const r = { input: grid.values.get(get(x, 'in')[0]), output: grid.values.get(get(x, 'out')[0]), p: get(x, 'p', 1.0) };
      if (r.input === undefined || r.output === undefined) fail('unknown value in a convolution rule', x);
      const vs = x.attrs.values, ss = x.attrs.sum;
      if (vs != null && ss == null) fail('missing "sum" attribute', x);
      if (vs == null && ss != null) fail('missing "values" attribute', x);
      if (vs != null) {
        r.values = [...vs].map((c) => grid.values.get(c));
        r.sums = new Uint8Array(28);
        for (const s of ss.split(',')) {
          if (s.includes('.')) { const [a, b] = s.split('..').map(Number); for (let i = a; i <= b; i++) r.sums[i] = 1; }
          else r.sums[Number(s)] = 1;
        }
      }
      return r;
    });
    this.rules = [];
    this.steps = get(el, 'steps', -1);
    this.periodic = get(el, 'periodic', false);
    const nb = get(el, 'neighborhood');
    this.kernel = KERNELS_2D[nb];
    if (!this.kernel) fail(`unknown neighborhood ${nb}`, el);
    this.sumfield = new Int32Array(grid.state.length * grid.C);
    this.counter = 0;
  }
  reset() { this.counter = 0; }
  go() {
    const ip = this.ip, grid = this.grid, { MX, MY, C, state } = grid;
    ip.leaf = this;
    if (this.steps > 0 && this.counter >= this.steps) return false;
    const sf = this.sumfield, K = this.kernel;
    sf.fill(0);
    for (let y = 0; y < MY; y++) for (let x = 0; x < MX; x++) {
      const base = (x + y * MX) * C;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let sx = x + dx, sy = y + dy;
        if (this.periodic) {
          if (sx < 0) sx += MX; else if (sx >= MX) sx -= MX;
          if (sy < 0) sy += MY; else if (sy >= MY) sy -= MY;
        } else if (sx < 0 || sy < 0 || sx >= MX || sy >= MY) continue;
        sf[base + state[sx + sy * MX]] += K[dx + 1 + (dy + 1) * 3];
      }
    }
    let change = false;
    for (let i = 0; i < state.length; i++) {
      const input = state[i];
      for (const rule of this.crules) {
        if (input === rule.input && rule.output !== state[i] && (rule.p === 1.0 || ip.random.nextDouble() < rule.p)) {
          let ok = true;
          if (rule.sums) {
            let sum = 0;
            for (const v of rule.values) sum += sf[i * C + v];
            ok = !!rule.sums[sum];
          }
          if (ok) { state[i] = rule.output; ip.mark(i); change = true; break; }
        }
      }
    }
    this.counter++;
    return change;
  }
}

// ─── interpreter ────────────────────────────────────────────────────────────
export class Interpreter {
  // opts: { symmetry: subgroup name or null, temperature: number (-1 = model) }
  static load(xmlOrEl, MX, MY, opts = {}) {
    const el = typeof xmlOrEl === 'string' ? parseXML(xmlOrEl) : xmlOrEl;
    const ip = new Interpreter();
    ip.origin = get(el, 'origin', false);
    ip.grid = Grid.load(el, MX, MY, 1);
    ip.temperature = opts.temperature ?? -1;
    ip.incremental = true;
    const dflt = opts.symmetry && SQUARE_SUBGROUPS[opts.symmetry] ? SQUARE_SUBGROUPS[opts.symmetry] : new Array(8).fill(1);
    const symmetry = getSymmetry(el.attrs.symmetry, dflt);
    if (!symmetry) fail(`unknown symmetry ${el.attrs.symmetry}`, el);
    const top = factory(el, symmetry, ip, ip.grid);
    if (top instanceof Branch) ip.root = top;
    else {
      const m = new MarkovNode();
      m.ip = ip; m.grid = ip.grid; m.nodes = [top]; m.kind = 'markov'; m.el = null; m.implicit = true;
      ip.root = m;
    }
    ip.changes = [];
    ip.first = [];
    // Leaf ids for the writer pass: 1..L in document order.
    ip.leaves = [];
    const walk = (n, depth) => {
      n.depth = depth;
      if (n instanceof Branch) n.nodes.forEach((c) => walk(c, depth + 1));
      else { ip.leaves.push(n); n.id = ip.leaves.length; }
    };
    walk(ip.root, 0);
    const N = MX * MY;
    ip.stamp = new Uint32Array(N);
    ip.writer = new Uint8Array(N);
    ip.heat = new Uint32Array(N);
    return ip;
  }

  start(seed, steps) {
    this.random = new Random(seed);
    this.steps = steps;
    const g = this.grid;
    g.clear();
    g.mask.fill(0);
    if (this.origin) g.state[(g.MX >> 1) + (g.MY >> 1) * g.MX] = 1;
    this.changes.length = 0;
    this.first.length = 0;
    this.first.push(0);
    this.root.reset();
    this.current = this.root;
    this.counter = 0;
    this.leaf = null;
    this.scanned = 0;
    this.stamp.fill(0); this.writer.fill(0); this.heat.fill(0);
    this.dirty0 = 0; this.dirty1 = g.MY - 1;
    if (this.origin) this.mark((g.MX >> 1) + (g.MY >> 1) * g.MX);
  }

  get done() { return this.current == null || (this.steps > 0 && this.counter >= this.steps); }

  // One interpreter turn. Returns false when the program has finished.
  step() {
    if (this.done) return false;
    this.current.go();
    this.counter++;
    this.first.push(this.changes.length);
    return true;
  }

  mark(i) {
    this.stamp[i] = this.counter + 1;
    this.writer[i] = this.leaf?.id ?? 0;
    this.heat[i]++;
    const y = (i / this.grid.MX) | 0;
    if (y < this.dirty0) this.dirty0 = y;
    if (y > this.dirty1) this.dirty1 = y;
  }
  takeDirty() {
    const r = [this.dirty0, this.dirty1];
    this.dirty0 = this.grid.MY; this.dirty1 = -1;
    return r;
  }
}

export { MJError };
