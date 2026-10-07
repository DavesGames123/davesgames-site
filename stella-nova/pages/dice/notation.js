// ============================================================================
//  DICE LAB  ·  notation.js — dice notation: parse, plan the dice, score
// ----------------------------------------------------------------------------
//  No DOM. tests.mjs runs it.
//
//  GRAMMAR. A sum of terms with + or -. A term is a constant or a group:
//      [count] d sides [!] [keep]
//    sides  4 6 8 10 12 20, 100 or % (two d10: tens 00-90 and units 0-9,
//           00 + 0 reads as 100), F (Fate: -1 0 +1), C (coin: 1 head, 0 tail)
//    !      exploding: a die that shows its top value rolls once more and
//           adds; this repeats
//    keep   kh N keep the N highest, kl N keep the N lowest, dl N drop the
//           N lowest, dh N drop the N highest (N defaults to 1), k N = kh N
//  Words: "4d6 drop lowest", "2d20 keep highest", "advantage" (2d20kh1),
//  "disadvantage" (2d20kl1), "3 coins", "2d% + 3". Spaces do not matter.
//
//  PLAN. planDice(spec) lists the physical dice: one die per count (two for
//  a d%: a d100 tens die and a d10). score(spec, reads) maps the reads back
//  to the groups, applies the explode chains and the keep or drop, and
//  sums. Each die in the breakdown is marked kept or dropped.
//
//  GREP MAP
//    export function parse ...... text to { terms, text } or { error }
//    export function planDice ... the dice to throw for a spec
//    export function score ...... the reads to a total and a breakdown
// ============================================================================

const SIDES = { 4: 'd4', 6: 'd6', 8: 'd8', 10: 'd10', 12: 'd12', 20: 'd20', 100: 'd%', F: 'dF', C: 'coin' };
export const MAX_DICE = 120;

export function parse(input) {
  let s = String(input || '').toLowerCase().trim();
  if (!s) return { error: 'Type a roll, for example 3d6+2.' };
  s = s.replace(/\bdisadvantage\b|\bdis\b/g, '2d20kl1').replace(/\badvantage\b|\badv\b/g, '2d20kh1');
  s = s.replace(/(\d*)\s*coins?\b/g, (m, n) => `${n || 1}dc`);
  s = s.replace(/\s*(drop|keep)\s+(lowest|highest|low|high)\s*(\d*)/g, (m, a, b, n) => `${a[0]}${b[0] === 'l' ? 'l' : 'h'}${n || 1}`);
  s = s.replace(/\s+/g, '');
  if (!/^[-+]?[0-9a-z%!+-]+$/.test(s)) return { error: `Cannot read "${input}".` };
  const terms = [];
  const re = /([+-]?)([^+-]+)/g; let m, total = 0;
  while ((m = re.exec(s))) {
    const sign = m[1] === '-' ? -1 : 1, body = m[2];
    if (/^\d+$/.test(body)) { terms.push({ sign, kind: 'const', value: +body }); continue; }
    const g = /^(\d*)d(\d+|%|f|c)(!?)(?:(kh|kl|dh|dl|k)(\d*))?$/.exec(body);
    if (!g) return { error: `Cannot read "${body}".` };
    const count = g[1] === '' ? 1 : +g[1];
    let sides = g[2] === '%' ? 100 : g[2] === 'f' ? 'F' : g[2] === 'c' ? 'C' : +g[2];
    if (!SIDES[sides]) return { error: `No physical d${sides} here. Use d4, d6, d8, d10, d12, d20, d%, dF or dC.` };
    if (count < 1) return { error: 'A group needs one die or more.' };
    const explode = g[3] === '!';
    if (explode && (sides === 'F' || sides === 'C' || sides === 100)) return { error: 'Fate dice, coins and d% do not explode here.' };
    let keep = null;
    if (g[4]) {
      const n = g[5] === '' ? 1 : +g[5], op = g[4] === 'k' ? 'kh' : g[4];
      const k = op === 'kh' || op === 'kl' ? n : count - n;
      if (k < 1 || k > count) return { error: `${body}: keep or drop must leave 1 to ${count} dice.` };
      keep = { hi: op === 'kh' || op === 'dl', n: k, op, arg: n };
    }
    total += count * (sides === 100 ? 2 : 1);
    terms.push({ sign, kind: 'dice', count, sides, type: SIDES[sides], explode, keep });
  }
  if (!terms.length) return { error: 'Nothing to roll.' };
  if (total > MAX_DICE) return { error: `At most ${MAX_DICE} dice in one throw.` };
  return { terms, text: format(terms) };
}

export function format(terms) {
  return terms.map((t, i) => {
    const sg = t.sign < 0 ? '−' : i ? '+' : '';
    if (t.kind === 'const') return `${sg}${t.value}`;
    const k = t.keep ? `${t.keep.op}${t.keep.arg}` : '';
    const sd = t.sides === 100 ? '%' : t.sides;
    return `${sg}${t.count}d${sd}${t.explode ? '!' : ''}${k}`;
  }).join(' ').replace(/ ([+−])/g, ' $1 ');
}

// the physical dice for a spec: [{ type, term, slot, part }]; a d% die has
// part 'tens' (type d100) and part 'units' (type d10)
export function planDice(spec) {
  const out = [];
  spec.terms.forEach((t, ti) => {
    if (t.kind !== 'dice') return;
    for (let k = 0; k < t.count; k++) {
      if (t.sides === 100) { out.push({ type: 'd100', term: ti, slot: k, part: 'tens' }); out.push({ type: 'd10', term: ti, slot: k, part: 'units' }); }
      else out.push({ type: t.type === 'd%' ? 'd100' : t.type, term: ti, slot: k });
    }
  });
  return out;
}

// face value of one physical read, as the group counts it
export function dieValue(sides, read) {
  if (sides === 10) return read.value === 0 ? 10 : read.value;   // the 0 face of a d10 is 10
  return read.value;
}
export const topValue = sides => sides === 100 ? 100 : sides === 10 ? 10 : sides;

// score: plan items with reads (and extra explode reads), to a total.
// items: [{ term, slot, part, read, chain: [reads] }]
export function score(spec, items) {
  const groups = spec.terms.map(t => ({ t, dice: [] }));
  for (const it of items) {
    const g = groups[it.term];
    if (!g.dice[it.slot]) g.dice[it.slot] = { parts: {}, chain: [], cocked: false };
    const d = g.dice[it.slot];
    if (it.part) d.parts[it.part] = it.read; else d.read = it.read;
    if (it.chain) d.chain = it.chain;
    if (it.read && it.read.cocked) d.cocked = true;
  }
  let total = 0, cocked = 0;
  const parts = groups.map(({ t, dice }) => {
    if (t.kind === 'const') { total += t.sign * t.value; return { term: t, value: t.sign * t.value }; }
    const vals = dice.map(d => {
      let v;
      if (t.sides === 100) { const tens = d.parts.tens ? d.parts.tens.value : 0, units = d.parts.units ? d.parts.units.value : 0; v = tens + units || 100; }
      else v = dieValue(t.sides, d.read);
      // the chain of extra dice from explosions (each read is one more die)
      let sum = v; const seq = [v];
      for (const r of d.chain) { const x = t.sides === 100 ? r.value : dieValue(t.sides, r); seq.push(x); sum += x; }
      if (d.cocked) cocked++;
      return { v: sum, seq, kept: true, cocked: d.cocked };
    });
    if (t.keep) {
      const order = vals.map((x, i) => i).sort((a, b) => t.keep.hi ? vals[b].v - vals[a].v || a - b : vals[a].v - vals[b].v || a - b);
      vals.forEach(x => { x.kept = false; });
      order.slice(0, t.keep.n).forEach(i => { vals[i].kept = true; });
    }
    const sub = vals.reduce((s, x) => s + (x.kept ? x.v : 0), 0);
    total += t.sign * sub;
    return { term: t, dice: vals, value: t.sign * sub };
  });
  return { total, parts, cocked };
}
