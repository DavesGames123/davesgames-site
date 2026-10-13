// ============================================================================
//  SCIENCE TOOLKIT  ·  intent.js  ·  one notebook line -> an answer (no DOM)
// ----------------------------------------------------------------------------
//  The scratchpad (pad.js) sends each line here. evalLine() reads the line
//  in this order and stops at the first reading that fits:
//
//    1. blank line, or a note that starts with # or //
//    2. a variable: "x = 3 mm" (the right side is any line of this list)
//    3. a tool name alone ("dilution", "t-test", "open fft"): its form
//    4. a phrase for one engine: "molar mass CuSO4", "dilute 2 M to ...",
//       "pH of 0.1 M acetic acid", "balance ...", "500 nm photon in eV",
//       "mean 1 2 3" and the other rows of PHRASES
//    5. a list of 3 or more numbers: summary statistics
//    6. an expression with units and constants, with an optional target
//       after "in", "to" or "as": "h*c/500 nm in eV", "3 ft to m"
//    7. a chemical formula alone ("NaCl"): its molar mass
//    8. else an error, with the tools that match the words
//
//  The maths stays in core/*.js and tools/*.js: a phrase fills the inputs
//  of a tool and calls its run(), or calls a core engine. The result has
//  the tool id and its input values, so pad.js can show the full method
//  (rows, plots, TeX, references) or the tool form under the line.
//
//  Constants: a bare name of core/constants.js ("h", "c", "kB", "NA", "R")
//  reads as the constant. Four names are also units (h hour, G gauss,
//  F farad, b barn): they read as a unit after a number, a unit or "/"
//  ("2 h", "J/h"), and as the constant elsewhere ("h*c", "G M/r^2").
//  The method line says which constants a line used.
//
//  RESULT  { kind: 'blank'|'note'|'value'|'assign'|'form'|'error',
//            answer, value, unit, q: {v, d} (SI), method, note,
//            tool, vals, error, alt: [tool ids], name (for assign) }
//
//  GREP MAP
//    grep -n "export function evalLine"      one line
//    grep -n "export function evalNotebook"  every line, with variables
//    grep -n "export function nice"          number formatting
//    grep -n "function evalExpr"             expressions with units
//    grep -n "function prep"                 constant names -> $ names
//    grep -n "function pickUnit"             the unit of an answer
//    grep -n "function scan"                 quantities in free text
//    grep -n "const PHRASES"                 the engine phrases
//    grep -n "const TOOL_NAMES"              tool names and other names
//    grep -n "export const EXAMPLES"         suggestions and starter lines
//    grep -n "export function suggest"       suggestions for a prefix
// ============================================================================
import { tokenize, parse } from './core/expr.js';
import { evalQty, unit as unitSym, qty, convert, dimEq, dimName, dimText, named, constQty, UNITS, BASE } from './core/units.js';
import { CONST } from './core/constants.js';
import { formula, molarMass, parseEquation, balance, equationText, acidBase } from './core/chem.js';
import { describe as describeData } from './core/stats.js';
import { acid as findAcid } from './core/ref.js';
import { fmt, nums } from './kit.js';
import { TOOLS as REG, BY_ID, search } from './registry.js';
import { TOOLS as T_UNITS } from './tools/units.js';
import { TOOLS as T_MEASURE } from './tools/measure.js';
import { TOOLS as T_STATS } from './tools/stats.js';
import { TOOLS as T_CHEM } from './tools/chem.js';
import { TOOLS as T_PHYS } from './tools/phys.js';
import { TOOLS as T_MATHS } from './tools/maths.js';
import { TOOLS as T_DATA } from './tools/data.js';

// Every tool definition by id.
export const DEFS = { ...T_UNITS, ...T_MEASURE, ...T_STATS, ...T_CHEM, ...T_PHYS, ...T_MATHS, ...T_DATA };

// Default input values of a tool, with some values replaced.
export function toolVals(id, vals = {}) {
  const d = DEFS[id];
  return { ...Object.fromEntries(d.inputs.map(i => [i.k, i.def ?? ''])), ...vals };
}
export function runTool(id, vals) { return DEFS[id].run(toolVals(id, vals)); }

// ── numbers and units as text ───────────────────────────────────────────────
// Five significant figures; integers up to 1e9 keep all their digits.
export function nice(x, sig = 5) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return fmt(x);
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1e-4 && a < 1e9) {
    const digits = Math.min(21, Math.max(sig, Math.floor(Math.log10(a)) + 1));
    let s = x.toPrecision(digits);
    if (s.includes('e')) return fmt(x, sig);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  return fmt(x, sig);
}

const SUPS = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '.': '·' };
const sup = (e) => (e === 1 ? '' : [...String(e)].map(c => SUPS[c] ?? c).join(''));
// "m s^-2" or "mm^2" style text -> "m/s²", "mm²". The result parses again.
export function prettyUnit(s) {
  const t = String(s).trim();
  if (!t || /[()/*]/.test(t)) return t.replace(/\^(-?\d+)/g, (_, e) => sup(Number(e)));
  const num = [], den = [];
  for (const p of t.split(/\s+/)) {
    const m = /^(.+?)(?:\^(-?\d+(?:\.\d+)?))?$/.exec(p);
    const e = m[2] ? Number(m[2]) : 1;
    (e > 0 ? num : den).push(m[1] + sup(Math.abs(e)));
  }
  if (!den.length) return num.join('·');
  const d = den.length > 1 ? `(${den.join('·')})` : den[0];
  return `${num.join('·') || '1'}/${d}`;
}
// Dimension exponents -> "kg·m²/s²".
export function dimUnit(d) {
  const order = [1, 0, 2, 3, 4, 5, 6];
  const parts = order.filter(i => Math.abs(d[i]) > 1e-9).map(i => `${BASE[i]}^${+d[i].toFixed(6)}`);
  return prettyUnit(parts.join(' ')) || '';
}

const D = (o) => BASE.map(b => o[b] || 0);
const DIM = {
  one: D({}), length: D({ m: 1 }), mass: D({ kg: 1 }), time: D({ s: 1 }), temp: D({ K: 1 }), amount: D({ mol: 1 }),
  volume: D({ m: 3 }), area: D({ m: 2 }), molar: D({ mol: 1, m: -3 }), massConc: D({ kg: 1, m: -3 }), pressure: D({ kg: 1, m: -1, s: -2 }),
  energy: D({ kg: 1, m: 2, s: -2 }), freq: D({ s: -1 }), wavenumber: D({ m: -1 }), speed: D({ m: 1, s: -1 }), accel: D({ m: 1, s: -2 }),
  stiff: D({ kg: 1, s: -2 }), molarMass: D({ kg: 1, mol: -1 }),
};
const isDim = (q, k) => q && dimEq(q.d, DIM[k]);
const dimOf = (q) => Object.keys(DIM).find(k => isDim(q, k)) || '';

// Display units with SI prefixes. A named unit takes any prefix; seconds
// only smaller ones; mass shows in g below 1 kg.
const PRE = [['T', 1e12], ['G', 1e9], ['M', 1e6], ['k', 1e3], ['', 1], ['m', 1e-3], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12], ['f', 1e-15]];
function scaled(v, sym, { maxUp = 1e12 } = {}) {
  if (v === 0 || !Number.isFinite(v)) return { value: v, unit: sym };
  const a = Math.abs(v);
  for (const [p, f] of PRE) if (f <= maxUp && a / f >= 1) return { value: v / f, unit: p + sym };
  return { value: v, unit: sym };
}
// Preferred units for some dimensions that have no named SI unit.
const PREFERRED = [['volume', 'L', 1e-3], ['molar', 'M', 1e3], ['speed', 'm/s', 1], ['accel', 'm/s²', 1], ['molarMass', 'g/mol', 1e-3], ['massConc', 'g/L', 1], ['area', 'm²', 1]];

function siDisplay(Q) {
  const nm = named(Q.d);
  if (nm) return scaled(Q.v, nm);
  if (isDim(Q, 'one')) return { value: Q.v, unit: '' };
  if (isDim(Q, 'mass')) return Math.abs(Q.v) >= 1 ? { value: Q.v, unit: 'kg' } : scaled(Q.v * 1000, 'g', { maxUp: 1 });
  if (isDim(Q, 'time')) return Math.abs(Q.v) < 1 ? scaled(Q.v, 's', { maxUp: 1 }) : { value: Q.v, unit: 's' };
  if (isDim(Q, 'length')) return scaled(Q.v, 'm', { maxUp: 1e3 });
  for (const [k, u, f] of PREFERRED) {
    if (!isDim(Q, k)) continue;
    if (u === 'L' || u === 'M') return scaled(Q.v / f, u, { maxUp: 1 });
    return { value: Q.v / f, unit: u };
  }
  return { value: Q.v, unit: dimUnit(Q.d) };
}

// The unit of an answer: a unit the line used, when the result has that
// dimension (or its square, cube or inverse); else a named SI unit or the
// SI base units.
function pickUnit(Q, cands, allowPlain) {
  for (const c of cands) {
    if (!c.q || (isDim(c.q, 'one') && !allowPlain)) continue;
    if (c.offset) continue;
    const ks = c.compound || isDim(c.q, 'one') ? [1] : [1, 2, 3, -1];
    for (const k of ks) {
      if (Q.d.every((x, i) => Math.abs(x - k * c.q.d[i]) < 1e-9)) {
        const unit = k === 1 ? c.text : `${c.text}${sup(k)}`;
        return { value: Q.v / c.q.v ** k, unit };
      }
    }
  }
  return siDisplay(Q);
}

// ── expressions ─────────────────────────────────────────────────────────────
const isNumTok = (t) => t && t.k === 'n';
export function canUnit(s) { try { unitSym(s); return true; } catch (e) { return false; } }
// Extra short names for constants.
const ALIAS = { k: 'kB', k_B: 'kB', N_A: 'NA', e0: 'eps0', ε0: 'eps0', mu_0: 'mu0', m_e: 'me', m_p: 'mp', m_n: 'mn', g0: 'gn' };
const constId = (name) => (CONST[name] ? name : ALIAS[name] && CONST[ALIAS[name]] ? ALIAS[name] : null);

// Rewrite bare constant names to "$id" and list the units the text uses.
function prep(text, vars) {
  const tk = tokenize(text);
  const out = [], consts = [], units = [], used = [];
  tk.forEach((t, i) => {
    if (t.k === 'n') { out.push(String(t.v)); return; }
    if (t.k !== 'id') { out.push(t.v); return; }
    const name = t.v;
    if (name in vars) { out.push(name); used.push(name); units.push({ text: vars[name].unit, q: vars[name].unitQ, compound: /[/·]/.test(vars[name].unit || '') }); return; }
    if (name[0] === '$') { const id = name.slice(1); if (CONST[id]) consts.push(id); out.push(name); return; }
    const cid = constId(name);
    const asUnit = canUnit(name);
    // A name that is a unit and a constant of the same size ("atm", "au", "eV") stays a unit.
    const same = cid && asUnit && (() => { const a = qtyOrNull('1 ' + name), b = constQty(cid); return a && dimEq(a.d, b.d) && Math.abs(a.v - b.v) <= 1e-12 * Math.abs(b.v); })();
    if (cid && asUnit && !same) {
      const prev = tk[i - 1];
      const unitCtx = prev && (isNumTok(prev) || (prev.k === 'op' && prev.v === '/') || (prev.k === 'id' && canUnit(prev.v) && !constId(prev.v) && !(prev.v in vars)));
      if (!unitCtx && CONST[cid].unit !== name) { out.push('$' + cid); consts.push(cid); return; }
    } else if (cid && !asUnit) { out.push('$' + cid); consts.push(cid); return; }
    if (asUnit) {
      const u = UNITS[name];
      const q = qtyOrNull('1 ' + name);
      units.push({ text: name, q: q && { v: q.v, d: q.d }, offset: !!(u && u[3]) || /^(degC|degF|°C|°F|℃)$/.test(name) });
    }
    out.push(name);
  });
  return { src: out.join(' '), consts: [...new Set(consts)], units, used: [...new Set(used)] };
}
const qtyOrNull = (s) => { try { return evalQty(parse(s)); } catch (e) { return null; } };

const TEMP_ONLY = /^\s*[-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*(degC|°C|℃|degF|°F|degR|°R|K)\s*$/;
const TEMP_UNIT = /^\s*(degC|°C|℃|degF|°F|degR|°R|K)\s*$/;

function constNote(ids) {
  if (!ids.length) return '';
  return ids.map(id => `${id === 'qe' ? 'e' : id} = ${CONST[id].name}`).join(', ') + ' (CODATA 2022)';
}

function evalExpr(text, env, target = '') {
  const scope = Object.fromEntries(Object.entries(env.vars).map(([k, v]) => [k, v.q]));
  // Temperature with an offset: "37 degC to degF".
  if (target && TEMP_ONLY.test(text) && TEMP_UNIT.test(target)) {
    const v = convert(text.replace('−', '-'), target.trim());
    const tu = target.trim().replace(/^deg/, '°');
    return { kind: 'value', value: v, unit: tu, answer: `${nice(v)} ${tu}`, q: qty(text), method: 'temperature with offsets: K = °C + 273.15 = (°F + 459.67) × 5/9', tool: 'unit-convert', vals: { q: text, to: target.trim() } };
  }
  const P = prep(text, env.vars);
  const tree = parse(P.src);
  const Q = TEMP_ONLY.test(text) ? qty(text) : evalQty(tree, scope);
  if (!Number.isFinite(Q.v)) throw new Error('The result is not a finite number.');
  let disp;
  if (target) {
    const tp = prep(target, {});
    const tq = evalQty(parse(tp.src));
    if (!dimEq(tq.d, Q.d)) throw new Error(`The result is ${dimName(Q.d)}; it cannot be shown in ${target}.`);
    disp = { value: Q.v / tq.v, unit: prettyUnit(target) };
  } else {
    const cands = [...P.units];
    for (const id of P.consts) if (CONST[id].unit) cands.push({ text: prettyUnit(CONST[id].unit), q: qtyOrNull('1 ' + CONST[id].unit), compound: /\s/.test(CONST[id].unit) });
    const plain = !/[A-Za-z_]\s*\(/.test(text);
    disp = pickUnit(Q, cands, plain);
  }
  const parts = [];
  const si = siDisplay(Q);
  if (disp.unit !== si.unit && !isDim(Q, 'one') && !/[·(]/.test(si.unit)) parts.push(`= ${nice(si.value)} ${si.unit}`.trim());
  const cn = constNote(P.consts);
  if (cn) parts.push(cn);
  return {
    kind: 'value', value: disp.value, unit: disp.unit, q: Q,
    answer: `${nice(disp.value)}${disp.unit ? ' ' + disp.unit : ''}`,
    method: parts.join(' · '), tool: 'calc', vals: { e: P.src, to: target || '', vars: P.used.map(n => `${n} = ${fmt(env.vars[n].q.v, 12)} ${dimText(env.vars[n].q.d) === '1' ? '' : dimText(env.vars[n].q.d)}`.trim()).join('\n') },
  };
}

// ── free text -> quantities ─────────────────────────────────────────────────
const STOP = new Set(['to', 'of', 'in', 'at', 'and', 'for', 'from', 'with', 'after', 'left', 'remaining', 'vs', 'vs.', 'by', 'into', 'over', 'is', 'a', 'an', 'the', 'on']);
const startsNum = (s) => /^[-+−]?(\d|\.\d)/.test(s);
// Quantities in order, each with the word before it, and the other words.
function scan(text) {
  const toks = String(text).replace(/,/g, ' , ').replace(/;/g, ' , ').split(/\s+/).filter(Boolean);
  const qs = [], words = [];
  for (let i = 0; i < toks.length;) {
    if (startsNum(toks[i])) {
      let best = null;
      for (let j = i; j < Math.min(toks.length, i + 4); j++) {
        if (j > i && (startsNum(toks[j]) || toks[j] === ',' || STOP.has(toks[j].toLowerCase()))) break;
        const t = toks.slice(i, j + 1).join(' ');
        try { const q = qty(t.replace(/−/g, '-')); if (Number.isFinite(q.v)) best = { text: t, q, end: j }; } catch (e) { /* not a quantity */ }
      }
      if (best) {
        const prev = (toks.slice(0, i).reverse().find(x => x !== ',') || '').toLowerCase();
        qs.push({ text: best.text, q: best.q, prev, kind: dimOf(best.q) });
        i = best.end + 1; continue;
      }
    }
    if (toks[i] !== ',') words.push(toks[i]);
    i++;
  }
  return { qs, words };
}

// "12.5 mL" -> { value: 12.5, unit: 'mL' }.
function fromRow(text) {
  const m = /^\s*([-+−]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(.*)$/i.exec(String(text));
  if (!m) return { value: NaN, unit: '' };
  return { value: Number(m[1].replace('−', '-')), unit: m[2].trim() };
}
const rowOf = (res, re) => (res.rows || []).find(r => re.test(r[0]));
const answerOf = (row) => { const r = fromRow(row[1]); return { value: r.value, unit: r.unit, answer: Number.isFinite(r.value) ? `${nice(r.value)}${r.unit ? ' ' + r.unit : ''}` : row[1] }; };
const qOf = (value, unit) => { try { return qty(`${value} ${unit}`.trim()); } catch (e) { return null; } };

function form(tool, vals, note) {
  return { kind: 'form', tool, vals: toolVals(tool, vals), note: note || `Fill in the ${BY_ID[tool].name.toLowerCase()} form.` };
}

// ── phrases ─────────────────────────────────────────────────────────────────
const FORMULA = String.raw`[A-Z\[(][A-Za-z0-9()\[\]·•.*₀-₉^+-]*`;
const NUM = String.raw`[-+−]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const COLOURS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'purple', 'grey', 'gray', 'white', 'gold', 'silver', 'none'];

function molarAnswer(f) {
  const r = molarMass(f.trim());
  return {
    kind: 'value', value: r.M, unit: 'g/mol', answer: `${nice(r.M)} g/mol`, q: { v: r.M / 1000, d: DIM.molarMass },
    method: 'M = Σ nᵢ·Aᵣ(Eᵢ), IUPAC 2021 atomic weights' + (r.noStd.length ? ` · ${r.noStd.join(', ')}: longest-lived isotope` : ''),
    tool: 'molar-mass', vals: { f: f.trim(), m: '' },
  };
}

function dilution(body) {
  const sp = /^(.*?)\s+to\s+(.*)$/i.exec(body);
  if (!sp) return form('dilution', {}, 'Write: dilute 2 M to 0.5 M, 50 mL');
  const v = { c1: '', v1: '', c2: '', v2: '' };
  for (const [side, c, vv] of [[sp[1], 'c1', 'v1'], [sp[2], 'c2', 'v2']]) {
    for (const x of scan(side).qs) {
      if (x.kind === 'volume') { if (!v[vv]) v[vv] = x.text; }
      else if (!v[c]) v[c] = x.text;
    }
  }
  const empty = Object.keys(v).filter(k => !v[k]);
  if (empty.length !== 1) return form('dilution', v, empty.length ? `Needs ${empty.length - 1} more value${empty.length > 2 ? 's' : ''}: leave one of C₁, V₁, C₂, V₂ empty.` : 'Leave one of C₁, V₁, C₂, V₂ empty.');
  const res = runTool('dilution', v);
  const a = answerOf(res.rows[0]);
  if (empty[0] === 'v1') {
    const add = answerOf(rowOf(res, /^Solvent/));
    return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `take ${a.answer}, add ${add.answer}`, method: 'C₁V₁ = C₂V₂ (volumes taken as additive)', tool: 'dilution', vals: v };
  }
  const name = { c1: 'C₁', c2: 'C₂', v2: 'V₂' }[empty[0]];
  return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `${name} = ${a.answer}`, method: 'C₁V₁ = C₂V₂', tool: 'dilution', vals: v };
}

function phOf(body) {
  const pk = /\bpKa\s*=?\s*([-\d.,\s]+)/i.exec(body);
  const rest = pk ? body.replace(pk[0], ' ') : body;
  const { qs, words } = scan(rest);
  const cq = qs.find(x => x.kind === 'molar' || x.kind === 'one');
  const sp = words.filter(w => !/^(solution|aq|\(aq\))$/i.test(w)).join(' ');
  const row = findAcid(sp) || words.map(findAcid).find(Boolean) || null;
  if (!cq) return form('ph', {}, 'Give a concentration, for example: pH of 0.1 M acetic acid');
  const C = cq.kind === 'molar' ? cq.q.v / 1000 : cq.q.v;
  const c = String(C);
  let r, vals, method, kind = row ? row.kind : 'acid';
  let pKa = pk ? pk[1].split(/[,\s]+/).filter(Boolean).map(Number) : row ? row.pKa : null;
  if (!row && !pKa) return form('ph', { mode: 'weak', c }, `"${sp || '?'}" is not in the pKa table. Give its pKa: pH of ${nice(C)} M pKa 4.2`);
  if (pk && row && (kind === 'strong-acid' || kind === 'strong-base')) kind = 'acid';
  const who = row ? row.name : 'the acid';
  if (kind === 'strong-acid') { r = acidBase({ Ca: C * row.n }); vals = { mode: 'strong-acid', c: String(C * row.n) }; method = `strong acid: [H⁺] from the charge balance, water included (${who})`; }
  else if (kind === 'strong-base') { r = acidBase({ Cb: C * row.n }); vals = { mode: 'strong-base', c: String(C * row.n) }; method = `strong base: [OH⁻] = ${row.n > 1 ? row.n + 'C' : 'C'}, water included (${who})`; }
  else if (kind === 'sulfuric') { r = acidBase({ C, pKa: [1.99], z0: -1 }); vals = { mode: 'weak', c, pk: '-3, 1.99' }; method = 'first step strong, HSO₄⁻ pKa 1.99, charge balance'; }
  else if (kind === 'base') { r = acidBase({ C, pKa, z0: 1 }); vals = { mode: 'weak-base', c, pk: String(+(14 - pKa[0]).toFixed(4)) }; method = `weak base, pKa(BH⁺) = ${pKa[0]}, charge balance (${who})`; }
  else { r = acidBase({ C, pKa }); vals = { mode: pKa.length > 1 ? 'weak' : 'weak', c, pk: pKa.join(', ') }; method = `weak acid, pKa ${pKa.join(', ')}, charge balance (${who})`; }
  return { kind: 'value', value: r.pH, unit: '', answer: `pH ${r.pH.toFixed(2)}`, q: { v: r.pH, d: DIM.one }, method: method + ' · 25 °C, no activity correction', tool: 'ph', vals };
}

function gasLaw(body) {
  const v = { P: '', V: '', n: '', T: '' };
  for (const x of scan(body).qs) {
    const k = { pressure: 'P', volume: 'V', amount: 'n', temp: 'T' }[x.kind];
    if (k && !v[k]) v[k] = x.text;
  }
  const empty = Object.keys(v).filter(k => !v[k]);
  if (empty.length !== 1) return form('gas', { law: 'ideal', ...v }, 'Give three of P, V, n and T.');
  const res = runTool('gas', { law: 'ideal', ...v });
  const a = answerOf(res.rows[0]);
  return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `${empty[0]} = ${a.answer}`, method: 'PV = nRT, R = 8.314462618 J/(mol·K) exact', tool: 'gas', vals: { law: 'ideal', ...v } };
}

function halfLife(body) {
  const { qs } = scan(body);
  const times = qs.filter(x => x.kind === 'time'), amts = qs.filter(x => x.kind !== 'time');
  const after = (x) => ['after', 'in', 'over', 'elapsed'].includes(x.prev);
  const v = { h: '', n0: '100 %', t: '', n: '' };
  if (times.length >= 2) {
    const [a, b] = after(times[0]) ? [times[1], times[0]] : [times[0], times[1]];
    v.h = a.text; v.t = b.text;
    if (amts.length) v.n0 = amts[0].text;
  } else if (times.length === 1 && amts.length) {
    if (after(times[0])) v.t = times[0].text; else v.h = times[0].text;
    if (amts.length >= 2) { v.n0 = amts[0].text; v.n = amts[amts.length - 1].text; } else v.n = amts[0].text.includes('%') ? amts[0].text : `${amts[0].text} %`;
  } else return form('decay', {}, 'Write: half-life 5730 yr after 10000 yr');
  const res = runTool('decay', v);
  const a = answerOf(res.rows[0]);
  const lab = { 'Remaining N': 'N', 'Elapsed time t': 't', 'Half-life T½': 'T½' }[res.rows[0][0]] || res.rows[0][0];
  const method = lab === 'N' ? 'N = N₀·2^(−t/T½)' : lab === 't' ? 't = T½·log₂(N₀/N)' : 'T½ = t / log₂(N₀/N)';
  return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `${lab} = ${a.answer}`, method, tool: 'decay', vals: v };
}

function photon(text) {
  let body = text.replace(/\b(photons?|light|of|a|the|energy|wavelength|frequency|wavenumber)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  let target = '';
  const tm = /^(.*\S)\s+(?:in|to|as)\s+(\S+)$/.exec(body);
  if (tm) { body = tm[1]; target = tm[2]; }
  const x = scan(body).qs.find(q => ['length', 'freq', 'energy', 'wavenumber'].includes(q.kind));
  if (!x) return form('photon', {}, 'Give a wavelength, frequency, energy or wavenumber: 500 nm photon in eV');
  const h = constQty('h').v, c = constQty('c').v, kB = constQty('kB').v;
  const E = { length: h * c / x.q.v, freq: h * x.q.v, energy: x.q.v, wavenumber: h * c * x.q.v }[x.kind];
  if (!target) target = x.kind === 'energy' ? 'nm' : 'eV';
  const tq = evalQty(parse(target));
  const tk = dimOf(tq);
  const out = { energy: E, length: h * c / E, freq: E / h, wavenumber: E / (h * c), temp: E / kB }[tk];
  if (out == null) throw new Error(`A photon cannot be shown in ${target}.`);
  const value = out / tq.v;
  const sym = { length: 'λ', freq: 'ν', energy: 'E', wavenumber: 'ν̃' };
  const F = { 'length>energy': 'E = hc/λ', 'freq>energy': 'E = hν', 'wavenumber>energy': 'E = hc·ν̃', 'energy>length': 'λ = hc/E', 'energy>freq': 'ν = E/h', 'energy>wavenumber': 'ν̃ = E/(hc)', 'length>freq': 'ν = c/λ', 'freq>length': 'λ = c/ν', 'length>wavenumber': 'ν̃ = 1/λ', 'wavenumber>length': 'λ = 1/ν̃', 'energy>temp': 'T = E/k_B', 'length>temp': 'T = hc/(λ·k_B)' };
  const method = F[`${x.kind}>${tk}`] || `${sym[tk] || 'x'} from E = hν = hc/λ`;
  return { kind: 'value', value, unit: prettyUnit(target), answer: `${nice(value)} ${prettyUnit(target)}`, q: { v: out, d: tq.d }, method: `${method} · h, c exact (SI 2019)`, tool: 'photon', vals: { x: x.text } };
}

function statsLine(word, body) {
  const xs = nums(body.replace(/[[\]]/g, ' '));
  if (xs.length < 2) throw new Error('Give at least two numbers.');
  const s = describeData(xs);
  const w = word.toLowerCase();
  const pick = {
    mean: ['mean', s.mean, 'x̄ = Σx/n'], average: ['mean', s.mean, 'x̄ = Σx/n'], avg: ['mean', s.mean, 'x̄ = Σx/n'],
    median: ['median', s.median, 'middle value (type 7 quantiles)'],
    sd: ['sd', s.sd, 's = √(Σ(x − x̄)²/(n − 1))'], stdev: ['sd', s.sd, 's = √(Σ(x − x̄)²/(n − 1))'], std: ['sd', s.sd, 's = √(Σ(x − x̄)²/(n − 1))'], stddev: ['sd', s.sd, 's = √(Σ(x − x̄)²/(n − 1))'], 'standard deviation': ['sd', s.sd, 's = √(Σ(x − x̄)²/(n − 1))'],
    sem: ['SEM', s.sem, 'SEM = s/√n'], 'standard error': ['SEM', s.sem, 'SEM = s/√n'],
    variance: ['variance', s.var, 's² = Σ(x − x̄)²/(n − 1)'], var: ['variance', s.var, 's² = Σ(x − x̄)²/(n − 1)'],
    sum: ['sum', s.sum, 'Σx'], min: ['min', s.min, 'smallest value'], max: ['max', s.max, 'largest value'], range: ['range', s.max - s.min, 'max − min'],
    n: ['n', s.n, 'count'], count: ['n', s.n, 'count'],
  }[w];
  const vals = { d: xs.join(' ') };
  if (pick) return { kind: 'value', value: pick[1], unit: '', answer: `${pick[0]} = ${nice(pick[1])}`, q: { v: pick[1], d: DIM.one }, method: `${pick[2]} · n = ${s.n}`, tool: 'describe', vals };
  return { kind: 'value', value: s.mean, unit: '', answer: `mean ${nice(s.mean)} · sd ${nice(s.sd, 3)} · n ${s.n}`, q: { v: s.mean, d: DIM.one }, method: `median ${nice(s.median)} · SEM ${nice(s.sem, 3)} · range ${nice(s.min)} to ${nice(s.max)}`, tool: 'describe', vals };
}

// [regex, (match, text, env) => result]. The first match wins.
const PHRASES = [
  [/^(?:molar mass|molecular (?:weight|mass)|formula (?:weight|mass)|mw|m\.w\.|mm)\s*(?:of\s+)?(\S.*)$/i, (m) => molarAnswer(m[1])],
  [new RegExp(String.raw`^(?:(?:moles?|amount|mass)\s+(?:of|in)\s+)?(${NUM}\s*(?:[kmuµμn]?g|[kmuµμn]?mol))\s+(?:of\s+)?(${FORMULA})(?:\s+(?:in|to|as)\s+([kmuµμn]?(?:g|mol)))?$`), (m) => {
    const r = molarMass(m[2]), Q = qty(m[1]);
    const toMol = isDim(Q, 'mass');
    if (!toMol && !isDim(Q, 'amount')) return null;
    const target = m[3] || (toMol ? 'mol' : 'g');
    const tq = qty('1 ' + target);
    const si = toMol ? Q.v * 1000 / r.M / 1 : Q.v * r.M / 1000;
    const want = toMol ? 'amount' : 'mass';
    if (!isDim(tq, want)) return null;
    const value = si / tq.v;
    return { kind: 'value', value, unit: target, answer: `${nice(value)} ${target}`, q: { v: si, d: DIM[want] }, method: `${toMol ? 'n = m/M' : 'm = n·M'}, M = ${nice(r.M)} g/mol`, tool: 'molar-mass', vals: { f: m[2], m: m[1] } };
  }],
  [/^balance\s+(.+)$/i, (m) => balanceLine(m[1])],
  [/^(?!solve\b|integrat)(.*\S\s*(?:->|→|=>|⇌|<=>)\s*\S.*)$/i, (m) => balanceLine(m[1])],
  [/^dilut(?:e|ing|ion)\b[\s:]*(.*)$/i, (m) => dilution(m[1])],
  [/^p[Hh]\s*(?:of\s+)?(\S.*)$/, (m) => phOf(m[1])],
  [/^(?:ideal gas(?: law)?|gas law|pv\s*=\s*nrt)\b[\s:]*(.*)$/i, (m) => gasLaw(m[1])],
  [/^(?:half[- ]?life|t½|t1\/2|decay)\b[\s:]*(?:of\s+)?(.+)$/i, (m) => halfLife(m[1])],
  [/\bphotons?\b/i, (m, text) => photon(text)],
  [/^(?:black\s*-?body|wien(?:'s)?(?: peak)?|planck(?: spectrum)?)\s+(?:at\s+|of\s+)?(\S.*)$/i, (m) => {
    const T = scan(m[1]).qs.find(x => x.kind === 'temp');
    if (!T) return form('blackbody', {}, 'Give a temperature: blackbody 5772 K');
    const vals = { T: T.text, l1: '', l2: '' };
    const a = answerOf(runTool('blackbody', vals).rows[0]);
    return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `λmax = ${a.answer}`, method: 'Wien: λmax = b/T, b = 2.897771955 mm·K', tool: 'blackbody', vals };
  }],
  [/^pendulum\s+(\S.*)$/i, (m) => {
    const v = { mode: 'pendulum', A: '' };
    for (const x of scan(m[1]).qs) {
      if (x.kind === 'length' && !v.L) v.L = x.text;
      else if (x.kind === 'accel') v.g = x.text;
      else if (x.kind === 'one') v.A = x.text;
    }
    if (!v.L) return form('shm', v, 'Give the length: pendulum 1 m');
    const res = runTool('shm', v);
    const row = v.A ? rowOf(res, /^Exact period/) : res.rows[0];
    const a = answerOf(row);
    return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `T = ${a.answer}`, method: v.A ? 'exact period: T = 4√(L/g)·K(sin θ₀/2)' : 'small angle: T = 2π√(L/g)', tool: 'shm', vals: v };
  }],
  [/^(?:spring|mass on a spring)\s+(\S.*)$/i, (m) => {
    const v = { mode: 'spring', A: '' };
    for (const x of scan(m[1]).qs) {
      if (x.kind === 'stiff') v.k = x.text; else if (x.kind === 'mass') v.m = x.text; else if (x.kind === 'length') v.A = x.text;
    }
    if (!v.k || !v.m) return form('shm', v, 'Give k and m: spring 50 N/m 0.5 kg');
    const res = runTool('shm', v);
    const a = answerOf(rowOf(res, /^Period/));
    return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `T = ${a.answer}`, method: 'T = 2π√(m/k)', tool: 'shm', vals: v };
  }],
  [/^projectile\s+(\S.*)$/i, (m) => {
    const v = {};
    for (const x of scan(m[1]).qs) {
      if (x.kind === 'speed') v.v = x.text; else if (x.kind === 'one') v.a = x.text; else if (x.kind === 'length') v.h = x.text; else if (x.kind === 'accel') v.g = x.text;
    }
    if (!v.v || !v.a) return form('projectile', v, 'Give speed and angle: projectile 20 m/s 45 deg');
    const res = runTool('projectile', v);
    const a = answerOf(res.rows[0]), t = answerOf(res.rows[1]), hm = answerOf(res.rows[2]);
    return { kind: 'value', ...a, q: qOf(a.value, a.unit), answer: `range ${a.answer} · flight ${t.answer} · top ${hm.answer}`, method: 'no drag: R = v₀cosθ·t_f, t_f from y(t) = 0', tool: 'projectile', vals: v };
  }],
  [/^(?:lorentz(?: factor)?|gamma|γ)\s+(?:factor\s+)?(?:at\s+|for\s+|of\s+)?(?:v\s*=\s*|β\s*=\s*|beta\s*=?\s*)?(\S.*)$/i, (m) => {
    const t = m[1].trim();
    const b = new RegExp(String.raw`^(${NUM})\s*c$`).exec(t) || new RegExp(String.raw`^(${NUM})$`).exec(t);
    let vals;
    if (b) vals = { kind: 'beta', x: b[1] };
    else { const x = scan(t).qs.find(q => q.kind === 'speed'); if (!x) return null; vals = { kind: 'v', x: x.text }; }
    const res = runTool('relativity', { ...vals, m: '', t: '' });
    const g = Number(res.rows[0][1]);
    return { kind: 'value', value: g, unit: '', answer: `γ = ${nice(g, 6)}`, q: { v: g, d: DIM.one }, method: 'γ = 1/√(1 − β²)', tool: 'relativity', vals: { ...vals, m: '', t: '' } };
  }],
  [new RegExp(`^(?:(?:${COLOURS.join('|')})[\\s,]+){2,5}(?:${COLOURS.join('|')})$`, 'i'), (m, text) => {
    const vals = { mode: 'decode', bands: text.trim().toLowerCase() };
    const res = runTool('resistor', vals);
    const R = qtyOrNull(res.copy.replace(/\s/g, ' '));
    return { kind: 'value', value: R ? R.v : NaN, unit: 'Ω', answer: res.rows[0][1], q: R, method: 'digit bands × 10^multiplier, IEC 60062', tool: 'resistor', vals };
  }],
  [/^resistor\s+(?:for\s+|of\s+)?(\S+)\s*(?:Ω|ohms?)?$/i, (m) => {
    const vals = { mode: 'encode', val: m[1] };
    const res = runTool('resistor', vals);
    return { kind: 'value', value: NaN, unit: '', answer: res.rows[0][1], method: `5 band: ${res.rows[1][1]} · ${res.rows[2][0]} ${res.rows[2][1]}`, tool: 'resistor', vals };
  }],
  [/^(series|parallel)\s+(?:of\s+)?(?:(resistors?|capacitors?|inductors?)\s+)?(\S.*)$/i, (m) => {
    const what = (m[2] || '').toLowerCase();
    let body = m[3];
    const kind = /^cap/.test(what) || /\d\s*[pnuµm]?F\b/.test(body) ? 'C' : /^ind/.test(what) || /\d\s*[pnuµm]?H\b/.test(body) ? 'L' : 'R';
    body = body.replace(/(\d)\s*(Ω|ohms?|F|H)\b/gi, '$1').replace(/\s+and\s+/gi, ' ');
    const vals = { kind, v: body };
    const res = runTool('combine', vals);
    const row = rowOf(res, new RegExp('^' + m[1], 'i'));
    const R = qtyOrNull(row[1]);
    return { kind: 'value', value: R ? R.v : NaN, unit: { R: 'Ω', C: 'F', L: 'H' }[kind], answer: row[1], q: R, method: (m[1].toLowerCase() === 'series') === (kind !== 'C') ? 'sum of the values' : '1/(Σ 1/x)', tool: 'combine', vals };
  }],
  [/^(mean|average|avg|median|sd|stdev|std|stddev|standard deviation|sem|standard error|variance|var|sum|min|max|range|count|stats|statistics|describe|summary)\s*(?:of\s*)?[:=]?\s*([-+−\d.(\[].*)$/i, (m) => statsLine(m[1], m[2])],
  [/^(paired\s+|student\s+|welch\s+)?t-?\s?test\s+(.+?)\s+(?:vs\.?|versus|against|and|\|)\s+(.+)$/i, (m) => {
    const mode = m[1] ? m[1].trim().toLowerCase() : 'welch';
    const b = m[3].trim();
    const one = /^(?:mu|μ)?\s*=?\s*[-+]?[\d.]+(?:e[-+]?\d+)?$/i.test(b) && !/\s/.test(b.replace(/^(?:mu|μ)\s*=?\s*/i, ''));
    const vals = one ? { mode: 'one', a: m[2], b: '', mu: b.replace(/^(?:mu|μ)\s*=?\s*/i, '') } : { mode, a: m[2], b };
    const res = runTool('ttest', vals);
    const t = Number(res.rows[0][1]), p = Number(res.rows[2][1]);
    return { kind: 'value', value: p, unit: '', answer: `t = ${nice(t, 4)}, p = ${res.rows[2][1]}`, q: { v: p, d: DIM.one }, method: `${{ one: 'one-sample', paired: 'paired', welch: 'Welch', student: 'Student' }[vals.mode]} t-test, df = ${nice(Number(res.rows[1][1]), 4)}, two-sided`, tool: 'ttest', vals };
  }],
  [/^(?:percent|%|pct)\s*(?:error|err|difference)\s+(?:of\s+)?(.+?)\s+(?:vs\.?|versus|against|from|accepted|ref(?:erence)?)\s+(.+)$/i, (m) => {
    const vals = { m: m[1], a: m[2], u: '' };
    const res = runTool('pct-error', vals);
    const a = answerOf(res.rows[0]);
    return { kind: 'value', ...a, q: { v: a.value / 100, d: DIM.one }, answer: a.answer, method: '(measured − accepted)/|accepted| × 100 %', tool: 'pct-error', vals };
  }],
  [/^round\s+(\S+)\s+to\s+(\d+)\s*(?:sig(?:nificant)?\.?\s*fig(?:ure)?s?|s\.?f\.?|figures|digits)?$/i, (m) => {
    const vals = { x: m[1], n: m[2], u: '' };
    const res = runTool('sig-figs', vals);
    return { kind: 'value', value: Number(res.rows[1][1]), unit: '', answer: res.rows[1][1], q: { v: Number(res.rows[1][1]), d: DIM.one }, method: `${res.rows[2][1]} · half away from zero`, tool: 'sig-figs', vals };
  }],
  [/^(?:sig(?:nificant)?\.?\s*fig(?:ure)?s?|sf)\s+(?:of\s+|in\s+)?(\S+)$/i, (m) => {
    const vals = { x: m[1], n: '3', u: '' };
    const res = runTool('sig-figs', vals);
    return { kind: 'value', value: Number(res.rows[0][1]), unit: '', answer: `${res.rows[0][1]} significant figure${res.rows[0][1] === '1' ? '' : 's'}`, method: 'leading zeros never count; trailing zeros count after a decimal point', tool: 'sig-figs', vals };
  }],
  [/^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)\s+(?:in|to|as)\s+(hex(?:adecimal)?|bin(?:ary)?|oct(?:al)?|dec(?:imal)?)$/i, (m) => {
    const vals = { x: m[1], from: '0', op: 'none', fl: '' };
    const res = runTool('base', vals);
    const which = m[2].toLowerCase().slice(0, 3);
    const row = res.rows[{ hex: 1, oct: 2, bin: 3, dec: 0 }[which]];
    const pre = { hex: '0x', oct: '0o', bin: '0b', dec: '' }[which];
    return { kind: 'value', value: Number(res.rows[0][1]), unit: '', answer: pre + row[1].replace(/\s/g, ''), method: `${row[0].toLowerCase()} of ${res.rows[0][1]}`, tool: 'base', vals };
  }],
  [/^(?:jd|julian date|julian day|mjd)\s+(?:of\s+|for\s+)?(\d.*)$/i, (m) => {
    const vals = { mode: 'date', x: m[1], cal: 'auto' };
    const res = runTool('jd', vals);
    const jd = Number(res.rows[0][1]);
    return { kind: 'value', value: jd, unit: '', answer: `JD ${res.rows[0][1]}`, q: { v: jd, d: DIM.one }, method: `MJD ${res.rows[1][1]} · ${res.rows[3][1]}`, tool: 'jd', vals };
  }],
  [/^(?:integrate|integral(?:\s+of)?|∫)\s+(.+?)(?:\s*d[a-z])?\s+from\s+(\S+)\s+to\s+(\S+)$/i, (m) => {
    const vals = { f: m[1].replace(/\s*dx$/, ''), a: m[2], b: m[3], x0: '' };
    const res = runTool('integrate', vals);
    const v = Number(res.rows[0][1]);
    return { kind: 'value', value: v, unit: '', answer: nice(v, 8), q: { v, d: DIM.one }, method: `adaptive Gauss–Kronrod, error ≈ ${res.rows[1][1]}`, tool: 'integrate', vals };
  }],
  [/^(?:solve|roots?(?:\s+of)?|zeros?(?:\s+of)?)\s+(.+?)(?:\s+(?:from|for x in|in|on|between)\s+\[?\s*([-\d.e]+)\s*(?:,|to|and)\s*([-\d.e]+)\s*\]?)?$/i, (m) => {
    const vals = { f: m[1], a: m[2] || '-100', b: m[3] || '100', mode: 'all' };
    const res = runTool('roots', vals);
    const roots = res.rows.filter(r => /^Root/.test(r[0])).map(r => Number(r[1]));
    if (!roots.length) return form('roots', vals, 'No root in this range. Change a and b.');
    return { kind: 'value', value: roots[0], unit: '', answer: `x = ${roots.slice(0, 5).map(x => nice(x, 7)).join(', ')}${roots.length > 5 ? ', …' : ''}`, q: { v: roots[0], d: DIM.one }, method: `scan + Brent on [${vals.a}, ${vals.b}]`, tool: 'roots', vals };
  }],
];

function balanceLine(eq) {
  const E = parseEquation(eq), c = balance(E);
  return { kind: 'value', value: NaN, unit: '', answer: equationText(E, c), method: 'atoms and charge conserved: null space of the element matrix', tool: 'balance', vals: { eq } };
}

// ── tool names ──────────────────────────────────────────────────────────────
const TOOL_NAMES = (() => {
  const m = new Map();
  const add = (k, id) => { const n = k.toLowerCase().replace(/[^a-z0-9%²₁₂ ]+/g, ' ').replace(/\s+/g, ' ').trim(); if (n && !m.has(n)) m.set(n, id); };
  for (const t of REG) { add(t.id, t.id); add(t.name, t.id); add(t.name.replace(/\(.*?\)/g, ''), t.id); }
  const extra = {
    'unit-convert': 'convert, converter, units', constants: 'constant, codata', 'sig-figs': 'sig figs, significant figures', scales: 'temperature scales, energy scales',
    uncertainty: 'error propagation, propagate', wmean: 'weighted average', describe: 'stats, statistics, summary, describe, mean', ttest: 't test, ttest, student t',
    chisq: 'chi square, chi squared, chi2, contingency', anova: 'anova', corr: 'pearson, spearman', fit: 'fit, regression, least squares', dist: 'normal distribution, distribution, p value',
    power: 'sample size, power analysis', 'molar-mass': 'molar mass, molecular weight', balance: 'balance, balancer', stoich: 'stoichiometry, limiting reagent, yield',
    dilution: 'dilute, c1v1', solution: 'concentration, molarity, molality', ph: 'ph, buffer', gas: 'gas, ideal gas, gas law, pv nrt', decay: 'half life, half-life, decay',
    projectile: 'projectile', shm: 'pendulum, spring, oscillator, shm', photon: 'photon', blackbody: 'black body, blackbody, wien, planck',
    relativity: 'lorentz, relativity, gamma', doppler: 'doppler, redshift', resistor: 'resistor, colour code, color code', combine: 'series, parallel',
    rlc: 'rc, rl, rlc', optics: 'lens, mirror, thin lens', db: 'db, decibel, decibels', calc: 'calculator, calc', roots: 'roots, root finder, solve',
    integrate: 'integral, integrate, derivative', matrix: 'matrix, determinant, eigenvalues', base: 'base, binary, hex, hexadecimal', complex: 'complex',
    fft: 'fft, fourier, spectrum', interp: 'interpolation, spline, smoothing', csv: 'csv, plot, plotter', latex: 'latex, tex', bibtex: 'bibtex, citation',
    jd: 'julian date, jd, mjd', geo: 'coordinates, gps, distance, great circle',
  };
  for (const [id, words] of Object.entries(extra)) for (const w of words.split(/,\s*/)) add(w, id);
  return m;
})();
export function toolByName(text) {
  const t = String(text).toLowerCase().replace(/^(?:open|tool|show)\s+/, '').replace(/[?!.]+$/, '').replace(/[^a-z0-9%²₁₂ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return TOOL_NAMES.get(t) || null;
}

// ── one line ────────────────────────────────────────────────────────────────
export function newEnv() { return { vars: {} }; }

const DATA_LINE = /^\s*[-+−]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:\s*[,;\s]\s*[-+−]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?){2,}\s*$/i;

export function evalLine(line, env = newEnv()) {
  const text = String(line ?? '').replace(/ /g, ' ').trim();
  if (!text) return { kind: 'blank' };
  if (/^(#|\/\/)/.test(text)) return { kind: 'note', answer: '' };
  // 2. variables
  const asg = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S.*)$/.exec(text);
  if (asg && !/(->|→|=>|⇌|=)/.test(asg[2])) {
    const name = asg[1];
    if (name === 'ans') return { kind: 'error', error: '"ans" is the previous answer; choose another name.' };
    const r = evalLine(asg[2], { vars: { ...env.vars } });
    if (r.kind === 'error' || r.kind === 'form') return r;
    if (!r.q) return { kind: 'error', error: `${name}: this line has no single value to keep.` };
    const unitQ = r.unit ? qtyOrNull(`1 ${r.unit}`) : null;
    env.vars[name] = { q: r.q, unit: r.unit && unitQ ? r.unit : '', unitQ };
    const hides = canUnit(name) ? ` · ${name} now hides the unit ${name} in later lines` : constId(name) ? ` · ${name} now hides the constant ${name} in later lines` : '';
    return { ...r, kind: 'assign', name, answer: `${name} = ${r.answer}`, method: (r.method || '') + hides };
  }
  // 3. a tool name alone
  const tid = toolByName(text);
  if (tid) return form(tid, {}, `${BY_ID[tid].name}: ${BY_ID[tid].blurb}`);
  try {
    // 4. phrases
    for (const [re, fn] of PHRASES) {
      const m = re.exec(text);
      if (!m) continue;
      const r = fn(m, text, env);
      if (r) return keepAns(r, env);
    }
    // 5. data
    if (DATA_LINE.test(text) && (/[,;]/.test(text) || text.split(/\s+/).length >= 3)) return keepAns(statsLine('stats', text), env);
  } catch (e) {
    return { kind: 'error', error: e.message || String(e), alt: altTools(text) };
  }
  // 6. expression, with a target unit after the last "in", "to", "as"
  let firstErr = null;
  const split = /^(.*\S)\s+(?:in|to|as|into|→|->)\s+(\S.*)$/.exec(text);
  const tries = split ? [[split[1], split[2]], [text, '']] : [[text, '']];
  for (const [body, target] of tries) {
    try { return keepAns(evalExpr(body, env, target), env); }
    catch (e) { if (!firstErr) firstErr = e; }
  }
  // 7. a formula alone
  if (new RegExp(`^${FORMULA}$`).test(text) && /[A-Z][a-z]?\d|[A-Z][a-z]?[A-Z]|[()·]/.test(text)) {
    try { const r = molarAnswer(text); r.method = 'read as a formula · ' + r.method; return keepAns(r, env); }
    catch (e) { /* not a formula */ }
  }
  return { kind: 'error', error: firstErr ? firstErr.message : 'Cannot read this line.', alt: altTools(text) };
}

function keepAns(r, env) {
  if (r && r.q && Number.isFinite(r.q.v)) env.vars.ans = { q: r.q, unit: r.unit || '', unitQ: r.unit ? qtyOrNull(`1 ${r.unit}`) : null };
  return r;
}

// Tools whose words match the line, for an error that offers a way on.
function altTools(text) {
  const words = String(text).toLowerCase().match(/[a-z][a-z-]{2,}/g) || [];
  let hits = search(words.join(' '));
  if (!hits.length) hits = [...new Set(words.flatMap(w => search(w).slice(0, 2)))];
  return hits.slice(0, 3).map(t => t.id);
}

// Every line in order; variables and "ans" carry from line to line.
export function evalNotebook(lines) {
  const env = newEnv();
  return lines.map(l => { try { return evalLine(l, env); } catch (e) { return { kind: 'error', error: e.message || String(e) }; } });
}

// ── suggestions ─────────────────────────────────────────────────────────────
export const EXAMPLES = [
  '500 nm photon in eV', 'molar mass CuSO4·5H2O', 'dilute 2 M HCl to 0.5 M, 50 mL', 'pH of 0.1 M acetic acid',
  'balance C3H8 + O2 -> CO2 + H2O', '10 g NaCl in mol', 'h*c/500 nm in eV', '3 ft to m', '37 degC to degF',
  '9.81 m/s^2 * 2 s', 'x = 3 mm', 'pi (2.5 mm)^2 in mm^2', 'ideal gas 1 mol, 0 degC, 1 atm', 'half-life 5730 yr after 10000 yr',
  'mean 5.1 4.9 6.2 5.8 6.0', 't-test 5.1 4.9 6.2 5.8 vs 6.0 5.4 6.8 6.1', 'pendulum 1 m', 'spring 50 N/m 0.5 kg',
  'projectile 20 m/s 45 deg', 'blackbody 5772 K', 'lorentz 0.6c', 'parallel 100 220 470', 'yellow violet red gold',
  'percent error 9.72 vs 9.80665', 'round 0.0045600 to 2 sig figs', '255 in hex', 'integrate exp(-x^2) from -inf to inf',
  'solve x^3 - 2x - 5 = 0', 'jd 2000-01-01 12:00', 'sqrt(2 * 9.81 m/s^2 * 10 m) in km/h', 'R * 298.15 K in kJ/mol',
  'pH of 0.01 M NaOH', 'kB * 300 K in meV', '1 atm in psi', '60 mph in km/h',
];

// First visit: a few lines that show what to type.
export const STARTER = [
  '# Type a line; the answer shows under it. Click a table value to insert it.',
  '500 nm photon in eV',
  'dilute 2 M HCl to 0.5 M, 50 mL',
  'molar mass CuSO4·5H2O',
  'pH of 0.1 M acetic acid',
  'x = 3 mm',
  'pi x^2 in mm^2',
];

// Up to n suggestions for the text typed so far: examples that start with
// it or hold all its words, then tool names.
export function suggest(text, n = 6) {
  const t = String(text).toLowerCase().trim();
  if (!t) return [];
  const words = t.split(/\s+/);
  const out = [];
  for (const ex of EXAMPLES) if (ex.toLowerCase().startsWith(t) && ex.toLowerCase() !== t) out.push({ text: ex, kind: 'example' });
  for (const ex of EXAMPLES) if (!out.some(o => o.text === ex) && ex.toLowerCase() !== t && words.every(w => ex.toLowerCase().includes(w))) out.push({ text: ex, kind: 'example' });
  if (/^[a-z][a-z -]*$/.test(t)) for (const tool of search(t).slice(0, 3)) out.push({ text: tool.name.toLowerCase(), kind: 'tool', tool: tool.id });
  return out.slice(0, n);
}
