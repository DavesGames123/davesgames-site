// ============================================================================
//  DIAGRAM FIXTURES  ·  stand-in index TeX parser and library expressions
// ----------------------------------------------------------------------------
//  MATH owns the real parser (tensor/index.js parseIndexTex). This file has a
//  small stand-in so the diagram tests and the legend run without it. It
//  reads the same restricted grammar: factors with ^ and _ index groups,
//  '{}' spacers, \partial and \nabla, sums with + and -, one '=', number and
//  \frac coefficients, (ab) and [ab] symmetry groups, also across factors
//  (term.sym with refs [[factor, slot], ...]). It does not distribute
//  parentheses: the fixtures are written in expanded form.
//
//  FIXTURES lists 40+ expressions from the CONTRACT.md library list, so that
//  the layout tests cover every glyph.
//
//  EXPORTS   (jump with grep -n "<anchor>" fixtures.js)
//      parseStub ....... "export function parseStub"   TeX -> TensorExpr
//      FIXTURES ........ "export const FIXTURES"       [{ id, tex }]
//      fixtureSteps .... "export function fixtureSteps" sample OpTrace steps
// ============================================================================

const CONSTS = new Set(['\\pi', 'G', 'c', '\\kappa', '\\hbar', 'k']);

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '\\') {
      let j = i + 1;
      if (/[A-Za-z]/.test(src[j] || '')) { while (/[A-Za-z]/.test(src[j] || '')) j++; }
      else j++;
      const cmd = src.slice(i, j);
      if (cmd === '\\,' || cmd === '\\;' || cmd === '\\!' || cmd === '\\ ' || cmd === '\\left' || cmd === '\\right') { i = j; continue; }
      out.push(cmd); i = j; continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (/[0-9.]/.test(src[j] || '')) j++;
      out.push(src.slice(i, j)); i = j; continue;
    }
    out.push(ch); i++;
  }
  return out;
}

function readGroup(toks, k) {
  // Returns [tokens, nextIndex] for {..} or a single token.
  if (toks[k] === '{') {
    let depth = 1, j = k + 1;
    const g = [];
    while (j < toks.length && depth) {
      if (toks[j] === '{') depth++;
      else if (toks[j] === '}') { depth--; if (!depth) break; }
      g.push(toks[j]); j++;
    }
    return [g, j + 1];
  }
  return [[toks[k]], k + 1];
}

function readName(toks, k) {
  const t = toks[k];
  if (/^\\(dot|ddot|tilde|bar|hat|mathrm|operatorname)$/.test(t)) {
    const [g, n] = readGroup(toks, k + 1);
    return [`${t}{${g.join('')}}`, n];
  }
  if (t === 'd' && /^[a-z]$/.test(toks[k + 1] || '')) return ['d' + toks[k + 1], k + 2];
  return [t, k + 1];
}

function parseSide(toks) {
  const terms = [];
  let k = 0;
  while (k < toks.length) {
    let sign = 1;
    while (toks[k] === '+' || toks[k] === '-') { if (toks[k] === '-') sign = -sign; k++; }
    // Coefficient.
    let num = 1, ctext = '';
    for (;;) {
      if (/^[0-9.]+$/.test(toks[k] || '')) { num *= parseFloat(toks[k]); k++; continue; }
      if (toks[k] === '\\frac' || toks[k] === '\\tfrac') {
        const [a, n1] = readGroup(toks, k + 1);
        const [b, n2] = readGroup(toks, n1);
        const A = a.join(''), B = b.join('');
        if (/^[0-9.]+$/.test(A) && /^[0-9.]+$/.test(B)) num *= parseFloat(A) / parseFloat(B);
        else ctext += `\\frac{${A}}{${B}}`;
        k = n2; continue;
      }
      if (CONSTS.has(toks[k]) && toks[k + 1] !== '^' && toks[k + 1] !== '_') { ctext += (ctext ? ' ' : '') + toks[k]; k++; continue; }
      break;
    }
    const factors = [], tsym = [];
    let open = null;
    while (k < toks.length && toks[k] !== '+' && toks[k] !== '-') {
      const t = toks[k];
      if (t === '(' || t === ')' || t === '{' || t === '}' || t === '[' || t === ']' || t === ',') { k++; continue; }
      let [name, n] = readName(toks, k);
      k = n;
      const f = { name, tex: name, indices: [] };
      while (toks[k] === '^' || toks[k] === '_' || (toks[k] === '{' && toks[k + 1] === '}')) {
        if (toks[k] === '{') { k += 2; continue; }
        const up = toks[k] === '^';
        const [g, n2] = readGroup(toks, k + 1);
        k = n2;
        if (g.length && g.every(x => /^[0-9]+$/.test(x))) { f.name += (up ? '^' : '_') + `{${g.join('')}}`; f.tex = f.name; continue; }
        for (let q = 0; q < g.length; q++) {
          const x = g[q];
          if (x === '(' || x === '[') { open = { type: x === '(' ? 'sym' : 'antisym', refs: [] }; continue; }
          if (x === ')' || x === ']') {
            if (open) {
              const fis = new Set(open.refs.map(r => r[0]));
              if (fis.size === 1) {
                const fi = open.refs[0][0], fac = factors[fi] || f;
                (fac.sym = fac.sym || []).push({ type: open.type, slots: open.refs.map(r => r[1]) });
              } else tsym.push(open);
              open = null;
            }
            continue;
          }
          if (x === "'") { const last = f.indices[f.indices.length - 1]; if (last) last.sym += "'"; continue; }
          if (x === '|' || x === ',' || x === ';') continue;
          f.indices.push({ sym: x, up });
          if (open) open.refs.push([factors.length, f.indices.length - 1]);
        }
      }
      if (/^\\partial$/.test(f.name)) f.kind = 'partial';
      else if (/^\\nabla$/.test(f.name)) f.kind = 'nabla';
      factors.push(f);
    }
    const term = { coeff: ctext ? (sign * num === 1 ? ctext : `${sign * num === -1 ? '-' : sign * num} ${ctext}`) : sign * num, factors };
    if (ctext && sign < 0 && num === 1) term.coeff = '-' + ctext;
    if (tsym.length) term.sym = tsym;
    if (!factors.length && !ctext && num === 0) term.coeff = 0;
    terms.push(term);
  }
  return terms;
}

function indexStats(terms) {
  const free = [], dummies = new Set();
  terms.forEach((t, ti) => {
    const c = new Map();
    for (const f of t.factors) for (const ix of [...f.indices, ...(f.deriv || [])]) {
      const e = c.get(ix.sym) || { n: 0, up: ix.up };
      e.n++; c.set(ix.sym, e);
    }
    for (const [s, e] of c) {
      if (e.n >= 2) dummies.add(s);
      else if (ti === 0) free.push({ sym: s, up: e.up });
    }
  });
  return { free, dummies: [...dummies] };
}

export function parseStub(tex) {
  const toks = tokenize(tex);
  const sides = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t === '{') depth++;
    if (t === '}') depth--;
    if (t === '=' && depth === 0) { sides.push([]); continue; }
    sides[sides.length - 1].push(t);
  }
  const terms = [];
  sides.forEach((s, si) => {
    const ts = s.length ? parseSide(s) : [{ coeff: 0, factors: [] }];
    for (const t of ts) { t.side = si; terms.push(t); }
  });
  const st = indexStats(terms.filter(t => t.side === 0));
  return { terms, free: st.free, dummies: st.dummies, tex };
}

export const FIXTURES = [
  { id: 'kronecker', tex: '\\delta^a{}_b v^b = v^a' },
  { id: 'cross', tex: 'w_i = \\epsilon_{ijk} a^j b^k' },
  { id: 'dot-metric', tex: 's = g_{\\mu\\nu} u^\\mu v^\\nu' },
  { id: 'change-basis', tex: "v^{a'} = \\Lambda^{a'}{}_b v^b" },
  { id: 'line-element', tex: 'ds^2 = g_{\\mu\\nu} dx^\\mu dx^\\nu' },
  { id: 'christoffel', tex: '\\Gamma^\\lambda_{\\mu\\nu} = \\frac{1}{2} g^{\\lambda\\sigma} \\partial_\\mu g_{\\sigma\\nu} + \\frac{1}{2} g^{\\lambda\\sigma} \\partial_\\nu g_{\\sigma\\mu} - \\frac{1}{2} g^{\\lambda\\sigma} \\partial_\\sigma g_{\\mu\\nu}' },
  { id: 'geodesic', tex: '\\ddot{x}^\\lambda + \\Gamma^\\lambda_{\\mu\\nu} \\dot{x}^\\mu \\dot{x}^\\nu = 0' },
  { id: 'covariant-vector', tex: '\\nabla_\\mu v^\\nu = \\partial_\\mu v^\\nu + \\Gamma^\\nu_{\\mu\\lambda} v^\\lambda' },
  { id: 'parallel-transport', tex: '\\dot{x}^\\mu \\nabla_\\mu v^\\nu = 0' },
  { id: 'riemann', tex: 'R^\\rho{}_{\\sigma\\mu\\nu} = \\partial_\\mu \\Gamma^\\rho_{\\nu\\sigma} - \\partial_\\nu \\Gamma^\\rho_{\\mu\\sigma} + \\Gamma^\\rho_{\\mu\\lambda} \\Gamma^\\lambda_{\\nu\\sigma} - \\Gamma^\\rho_{\\nu\\lambda} \\Gamma^\\lambda_{\\mu\\sigma}' },
  { id: 'ricci', tex: 'R_{\\sigma\\nu} = R^\\rho{}_{\\sigma\\rho\\nu}' },
  { id: 'ricci-scalar', tex: 'R = g^{\\sigma\\nu} R_{\\sigma\\nu}' },
  { id: 'bianchi', tex: '\\nabla_\\lambda R_{\\rho\\sigma\\mu\\nu} + \\nabla_\\rho R_{\\sigma\\lambda\\mu\\nu} + \\nabla_\\sigma R_{\\lambda\\rho\\mu\\nu} = 0' },
  { id: 'efe', tex: 'R_{\\mu\\nu} - \\frac{1}{2} R g_{\\mu\\nu} + \\Lambda g_{\\mu\\nu} = 8 \\pi G T_{\\mu\\nu}' },
  { id: 'einstein-tensor', tex: 'G_{\\mu\\nu} = R_{\\mu\\nu} - \\frac{1}{2} g_{\\mu\\nu} R' },
  { id: 'flrw', tex: 'ds^2 = - dt^2 + a^2 \\gamma_{ij} dx^i dx^j' },
  { id: 'lorentz', tex: "x^{\\mu'} = \\Lambda^{\\mu'}{}_\\nu x^\\nu" },
  { id: 'maxwell-f', tex: 'F_{\\mu\\nu} = \\partial_\\mu A_\\nu - \\partial_\\nu A_\\mu' },
  { id: 'maxwell-source', tex: '\\partial_\\mu F^{\\mu\\nu} = \\mu_0 J^\\nu' },
  { id: 'maxwell-bianchi', tex: '\\partial_{[\\lambda} F_{\\mu\\nu]} = 0' },
  { id: 'em-stress', tex: 'T^{\\mu\\nu} = F^{\\mu\\alpha} F^\\nu{}_\\alpha - \\frac{1}{4} g^{\\mu\\nu} F_{\\alpha\\beta} F^{\\alpha\\beta}' },
  { id: 'perfect-fluid', tex: 'T^{\\mu\\nu} = \\rho u^\\mu u^\\nu + p u^\\mu u^\\nu + p g^{\\mu\\nu}' },
  { id: 'cauchy', tex: 't_i = \\sigma_{ij} n_j' },
  { id: 'strain', tex: '\\varepsilon_{ij} = \\frac{1}{2} \\partial_i u_j + \\frac{1}{2} \\partial_j u_i' },
  { id: 'hooke', tex: '\\sigma_{ij} = C_{ijkl} \\varepsilon_{kl}' },
  { id: 'inertia', tex: 'I_{ij} = m r_k r_k \\delta_{ij} - m r_i r_j' },
  { id: 'quadrupole', tex: 'Q_{ij} = 3 x_i x_j - r^2 \\delta_{ij}' },
  { id: 'divergence', tex: '\\mathrm{div} = \\partial_i v^i' },
  { id: 'killing', tex: '\\nabla_\\mu \\xi_\\nu + \\nabla_\\nu \\xi_\\mu = 0' },
  { id: 'geodesic-deviation', tex: 'A^\\mu = - R^\\mu{}_{\\nu\\rho\\sigma} u^\\nu \\xi^\\rho u^\\sigma' },
  { id: 'weyl', tex: 'C_{abcd} = R_{abcd} - g_{a[c} R_{d]b} + g_{b[c} R_{d]a} + \\frac{1}{3} R g_{a[c} g_{d]b}' },
  { id: 'weyl-traceless', tex: 'C^a{}_{bad} = 0' },
  { id: 'attention-scores', tex: 'S_{ij} = Q_{id} K_{jd}' },
  { id: 'attention-out', tex: 'O_{iv} = A_{ij} V_{jv}' },
  { id: 'trace', tex: 't = A^i{}_i' },
  { id: 'determinant', tex: 'D \\epsilon_{lmn} = \\epsilon_{ijk} A^i{}_l A^j{}_m A^k{}_n' },
  { id: 'matrix-product', tex: 'C^i{}_k = A^i{}_j B^j{}_k' },
  { id: 'trace-product', tex: 't = A^i{}_j B^j{}_i' },
  { id: 'epsilon-delta', tex: '\\epsilon_{ijk} \\epsilon_{imn} = \\delta_{jm} \\delta_{kn} - \\delta_{jn} \\delta_{km}' },
  { id: 'first-bianchi', tex: 'R_{a[bcd]} = 0' },
  { id: 'raise', tex: 'v^\\mu = g^{\\mu\\nu} v_\\nu' },
  { id: 'lower', tex: 'v_\\mu = g_{\\mu\\nu} v^\\nu' },
  { id: 'symmetric-part', tex: 'T_{(ab)} = \\frac{1}{2} T_{ab} + \\frac{1}{2} T_{ba}' },
  { id: 'antisymmetric-part', tex: 'T_{[ab]} = \\frac{1}{2} T_{ab} - \\frac{1}{2} T_{ba}' },
  { id: 'gradient', tex: 'df = \\partial_\\mu f dx^\\mu' },
  { id: 'outer-product', tex: 'T^\\mu{}_\\nu = u^\\mu \\omega_\\nu' },
  { id: 'metric-inverse', tex: 'g^{\\mu\\lambda} g_{\\lambda\\nu} = \\delta^\\mu{}_\\nu' },
  { id: 'second-derivative', tex: '\\nabla_\\mu \\nabla_\\nu \\phi = \\partial_\\mu \\partial_\\nu \\phi - \\Gamma^\\lambda_{\\mu\\nu} \\partial_\\lambda \\phi' },
];

// Steps in the OpTrace shape, one per transition kind, for tests and demos.
export function fixtureSteps(parse = parseStub) {
  const S = (id, kind, a, b, focus, label) => ({ id, kind, label: label || kind, before: parse(a), after: parse(b), focus, sums: [], ms: 1200 });
  return [
    S('contract', 'contract', 'T^a{}_b', 'T^a{}_a', ['a', 'b'], 'Join the upper a with the lower b.'),
    S('contract2', 'contract', 'A^i{}_j B^k{}_l', 'A^i{}_j B^j{}_l', ['j'], 'Sum over j.'),
    S('raise', 'raise', 'v_\\nu', 'v^\\nu', ['\\nu'], 'Raise the index with the inverse metric.'),
    S('raise-explicit', 'raise', 'v_\\nu', 'g^{\\mu\\nu} v_\\nu', ['\\nu'], 'Put the inverse metric on the leg.'),
    S('lower', 'lower', 'T^{\\mu\\nu}', 'T^\\mu{}_\\nu', ['\\nu'], 'Lower the second index.'),
    S('transform', 'transform', 'T^a{}_b', "T^{a'}{}_{b'}", ['a', 'b'], 'Change coordinates.'),
    S('symmetrize', 'symmetrize', 'T_{ab}', 'T_{(ab)}', ['a', 'b'], 'Symmetrise.'),
    S('antisymmetrize', 'antisymmetrize', 'F_{ab}', 'F_{[ab]}', ['a', 'b'], 'Antisymmetrise.'),
    S('sym-overlay', 'symmetrize', 'T_{abc}', 'T_{abc}', ['a', 'b', 'c'], 'Symmetrise all three.'),
    S('partial', 'partial', 'v^\\nu', '\\partial_\\mu v^\\nu', ['\\mu'], 'Take the partial derivative.'),
    S('covariant', 'covariant', '\\partial_\\mu v^\\nu', '\\partial_\\mu v^\\nu + \\Gamma^\\nu_{\\mu\\lambda} v^\\lambda', ['\\lambda'], 'Add the connection term.'),
    S('expand', 'expandSum', 'T_{(ab)}', '\\frac{1}{2} T_{ab} + \\frac{1}{2} T_{ba}', ['a', 'b'], 'Write out the symmetrisation.'),
    S('cancel', 'evaluate', 'A_a + B_a - B_a', 'A_a', [], 'Two terms cancel.'),
    S('relabel', 'relabel', 'v^a w_a', 'v^b w_b', ['a', 'b'], 'Rename the dummy index.'),
    S('product', 'product', 'u^a', 'u^a \\omega_b', [], 'Take the tensor product.'),
    S('trace', 'trace', 'A^i{}_j B^j{}_k', 'A^i{}_j B^j{}_i', ['i', 'k'], 'Trace of the product.'),
  ];
}
