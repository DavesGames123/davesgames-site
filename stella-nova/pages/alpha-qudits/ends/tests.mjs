// ============================================================================
//  ALPHA QUDITS  ·  ends/tests.mjs  ·  node tests of the ENDS package
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/alpha-qudits/ends/tests.mjs
//  Optional: NODE_PATH holding jsdom@24.1.3 (boots createEnds in a DOM) and
//  mathjax-full@3.2.2 (typesets every saver TeX string). Without them, a
//  skip line prints and the other checks still run.
//
//  SECTIONS   (grep -n "section('" tests.mjs)
//    letters ..... Pauli and Gell-Mann: traceless, Hermitian, orthogonal
//    bases ....... mutually unbiased bases and read letters
//    transpose ... the transpose identity and matchings, random U
//    sign ........ Weyl phase: -1 at d = 2, omega at d = 3
//    read cap .... Choi map positive, not CP, not decomposable (witness)
//    charge ...... the 12 generators, Q central, rank 8, stabilizer, U, Y
//    scenes ...... every scene and step draws on a mock canvas, all finite
//    dom ......... createEnds in jsdom (skip without jsdom)
//    saver ....... saverShots valid; TeX typesets (skip without MathJax)
//    model ....... agreement with ../model/index.js (skip until it lands)
// ============================================================================
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const L = await import(join(HERE, 'linalg.js'));
let pass = 0, fail = 0, skip = 0;
const section = s => console.log('\n## ' + s);
async function check(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e)); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const near = (a, b, tol = 1e-10, m = '') => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m} expected ${b}, got ${a}`); };
const isZero = (A, tol = 1e-10) => Math.max(...A.re.map(Math.abs), ...A.im.map(Math.abs)) <= tol;
const randU = (d, rnd) => { // a random unitary from Gram-Schmidt of random columns
  const cols = [];
  for (let k = 0; k < d; k++) {
    let v = L.randomKet(d, rnd);
    for (const c of cols) { const [r, i] = L.inner(c, v); v = { re: v.re.map((x, n) => x - (r * c.re[n] - i * c.im[n])), im: v.im.map((x, n) => x - (r * c.im[n] + i * c.re[n])) }; }
    const nr = Math.hypot(...v.re, ...v.im); cols.push({ re: v.re.map(x => x / nr), im: v.im.map(x => x / nr) });
  }
  const U = L.cm(d); for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) { U.re[i * d + j] = cols[j].re[i]; U.im[i * d + j] = cols[j].im[i]; }
  return U;
};
const rnd = L.mulberry(20261024);

// ============================================================================
section('letters');
await check('3 Pauli and 8 Gell-Mann letters: traceless, Hermitian, tr(AB) = 2 delta', () => {
  for (const set of [L.pauli(), L.gellMann()]) {
    set.forEach((A, i) => {
      const [tr, ti] = L.trace(A); near(tr, 0); near(ti, 0);
      assert(L.maxAbsDiff(A, L.adj(A)) < 1e-12, 'not Hermitian');
      set.forEach((B, j) => { const [r, im] = L.hs(A, B); near(r, i === j ? 2 : 0, 1e-12); near(im, 0); });
    });
  }
  assert(L.pauli().length === 3 && L.gellMann().length === 8);
});
await check('Gell-Mann: 5 symmetric (real), 3 antisymmetric (imaginary)', () => {
  const G = L.gellMann();
  const sym = G.filter(A => A.kind === 'sym'), anti = G.filter(A => A.kind === 'anti');
  assert(sym.length === 5 && anti.length === 3, `${sym.length} + ${anti.length}`);
  for (const A of sym) assert(isZero({ re: A.im, im: A.im }) && L.maxAbsDiff(A, L.transpose(A)) < 1e-12);
  for (const A of anti) assert(isZero({ re: A.re, im: A.re }) && L.maxAbsDiff(A, L.scale(L.transpose(A), -1)) < 1e-12);
});

section('bases');
for (const d of [2, 3]) {
  await check(`d = ${d}: ${d + 1} bases, orthonormal, mutually unbiased (|<e|f>|^2 = 1/${d})`, () => {
    const B = L.mubs(d); assert(B.length === d + 1);
    B.forEach((b, i) => B.forEach((c, j) => b.vecs.forEach((e, k) => c.vecs.forEach((f, l) => {
      const [r, im] = L.inner(e, f), o = r * r + im * im;
      near(o, i === j ? (k === l ? 1 : 0) : 1 / d, 1e-12, `basis ${i}.${k} vs ${j}.${l}`);
    }))));
  });
  await check(`d = ${d}: read letters P - 1/d span d^2 - 1 = ${d * d - 1}; cross-basis letters orthogonal`, () => {
    const R = L.readLetters(d);
    assert(L.spanRank(R.map(r => r.A)) === d * d - 1);
    for (const a of R) for (const b of R) if (a.basis !== b.basis) near(L.hs(a.A, b.A)[0], 0, 1e-12);
    const G = d === 2 ? L.pauli() : L.gellMann();
    assert(L.spanRank(R.map(r => r.A).concat(G)) === d * d - 1, 'same span as the Pauli / Gell-Mann set');
  });
}
await check('Bloch vectors of the qubit bases are the +-z, +-x, +-y poles', () => {
  const want = [[[0, 0, 1], [0, 0, -1]], [[1, 0, 0], [-1, 0, 0]], [[0, 1, 0], [0, -1, 0]]];
  L.mubs(2).forEach((b, i) => b.vecs.forEach((v, k) => L.blochOf(v).forEach((x, n) => near(x, want[i][k][n], 1e-12))));
});

section('transpose');
for (const d of [2, 3]) {
  await check(`d = ${d}: (U x 1)|w> = (1 x U^T)|w> for 50 random unitaries`, () => {
    const C0 = L.coeffMatrix(d);
    for (let k = 0; k < 50; k++) { const U = randU(d, rnd); assert(L.maxAbsDiff(L.actPair(C0, U, null), L.actPair(C0, null, L.transpose(U))) < 1e-12); }
  });
  await check(`d = ${d}: a matching U x conj(U) leaves |w> unchanged; U x U does not in general`, () => {
    const C0 = L.coeffMatrix(d); let moved = 0;
    for (let k = 0; k < 50; k++) {
      const U = randU(d, rnd);
      assert(L.maxAbsDiff(L.actPair(C0, U, L.conj(U)), C0) < 1e-12);
      if (L.maxAbsDiff(L.actPair(C0, U, U), C0) > 1e-3) moved++;
    }
    assert(moved > 40, 'U x U moved only ' + moved);
  });
}
await check('real turns: R(a)^T = R(-a), the mirror of the gears', () => {
  for (const a of [0.3, 1.1, -2]) assert(L.maxAbsDiff(L.transpose(L.rot2(3, a)), L.rot2(3, -a)) < 1e-15);
});

section('sign');
await check('Weyl phase from the clock and shift matrices: -1 at d = 2, omega at d = 3', () => {
  const [r2, i2] = L.weylPhase(2), [r3, i3] = L.weylPhase(3);
  near(r2, -1, 1e-12); near(i2, 0, 1e-12); near(r3, -0.5, 1e-12); near(i3, Math.sqrt(3) / 2, 1e-12);
});
await check('an order sign (lambda = 1/lambda, lambda^d = 1, lambda != 1) exists at d = 2, not at d = 3', () => {
  const ok = d => L.signPossible(d).some(p => p.k > 0 && p.sign);
  assert(ok(2) && !ok(3));
});
await check('qubit letters anticommute pairwise; [sx, sy] = 2i sz', () => {
  const P = L.pauli();
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) assert(isZero(L.add(L.mul(P[a], P[b]), L.mul(P[b], P[a]))));
  const cmm = L.add(L.mul(P[0], P[1]), L.mul(P[1], P[0]), -1);
  assert(L.maxAbsDiff(cmm, L.scale(P[2], 0, 2)) < 1e-12);
});

section('read cap');
await check("Choi's map is positive: 3000 random pure states map to PSD", () => {
  const r = L.mulberry(7); let mn = Infinity;
  for (let k = 0; k < 3000; k++) mn = Math.min(mn, ...L.hermEig(L.choiMap(L.projector(L.randomKet(3, r)))));
  assert(mn > -1e-10, 'min ' + mn);
});
await check("Choi's map is not completely positive: Choi matrix eigenvalue -1", () => near(Math.min(...L.hermEig(L.choiMatrix(L.choiMap, 3))), -1, 1e-9));
await check('Horodecki state: PPT for a <= 4, Choi witness negative for a > 3, positive for a <= 3', () => {
  for (const a of [2, 2.5, 3]) assert(Math.min(...L.hermEig(L.applySecond(L.horodeckiState(a), 3, 3, L.choiMap))) > -1e-10, 'a=' + a);
  for (const a of [3.25, 3.5, 4]) {
    const S = L.horodeckiState(a);
    near(L.trace(S)[0], 1, 1e-12);
    assert(Math.min(...L.hermEig(L.partialT(S, 3, 3))) > -1e-10, 'PPT at ' + a);
    assert(Math.min(...L.hermEig(L.applySecond(S, 3, 3, L.choiMap))) < -1e-3, 'caught at ' + a);
  }
  assert(Math.min(...L.hermEig(L.partialT(L.horodeckiState(4.5), 3, 3))) < -1e-3, 'not PPT at 4.5');
});
await check('so Choi is not decomposable: every decomposable map keeps the PPT state PSD (random Phi1 + Phi2 o T)', () => {
  // a decomposable map from random Kraus operators
  const S = L.horodeckiState(3.5);
  for (let k = 0; k < 20; k++) {
    const K1 = randU(3, rnd), K2 = randU(3, rnd), w = rnd();
    const phi = X => L.add(L.scale(L.mul(L.mul(K1, X), L.adj(K1)), w), L.scale(L.mul(L.mul(K2, L.transpose(X)), L.adj(K2)), 1 - w));
    assert(Math.min(...L.hermEig(L.applySecond(S, 3, 3, phi))) > -1e-10);
  }
});
await check('read cap cells: open exactly when d1 d2 <= 6, for d = 2..5', () => {
  for (let a = 2; a <= 5; a++) for (let b = 2; b <= 5; b++) assert(L.readCapLocal(a, b).open === (a * b <= 6), `${a},${b}`);
  const prods = new Set(); for (let a = 2; a <= 50; a++) for (let b = 2; b <= 50; b++) prods.add(a * b);
  assert(!prods.has(7) && prods.has(6) && prods.has(8), '7 is no product');
});

section('charge');
const E = L.idBasis();
await check('12 generators: block-diagonal, traceless, anti-Hermitian, independent', () => {
  assert(E.length === 12);
  for (const A of E) {
    const [tr, ti] = L.trace(A); near(tr, 0, 1e-12); near(ti, 0, 1e-12);
    assert(L.maxAbsDiff(L.adj(A), L.scale(A, -1)) < 1e-12);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if ((i < 2) !== (j < 2)) assert(A.re[i * 5 + j] === 0 && A.im[i * 5 + j] === 0);
  }
  assert(L.spanRank(E) === 12);
});
await check('Q is central and acts on the pair ket as i(d2 - d1) = i', () => {
  const Q = E[11];
  for (const A of E) assert(isZero(L.bracket(Q, A)));
  const v = L.linkAction(Q, L.pairKet23()), p = L.pairKet23();
  for (let k = 0; k < 6; k++) { near(v.re[k], 0, 1e-12); near(v.im[k], p.re[k], 1e-12); }
  assert(L.centralChargeLocal(2, 3) === 1 && L.centralChargeLocal(2, 2) === 0);
});
await check('Q = 6iY with Y = diag(1/2, 1/2; -1/3, -1/3, -1/3); the (3, 2) has Y = 1/6', () => {
  const Y = L.hypercharge();
  for (let k = 0; k < 5; k++) near(E[11].im[k * 6], 6 * Y[k], 1e-12);
  near(Y[0] + Y[2], 1 / 6, 1e-15);
});
await check('action on the pair ket has rank 8; null space 4 holds the paper’s basis (S8)', () => {
  assert(L.actionRank() === 8);
  const NS = L.nullSpace(L.actionMatrix()); assert(NS.length === 4);
  const S8 = [[1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0], [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, -1]];
  for (const c of S8) { const v = L.linkAction(L.combo(c, E), L.pairKet23()); assert(Math.max(...v.re.map(Math.abs), ...v.im.map(Math.abs)) < 1e-12); }
  assert(L.rank(NS.concat(S8)) === 4, 'same span');
});
await check('the stabilizer has a one-dimensional centre, the line of U = i diag(1, 1; -1, -1, 0)', () => {
  const N = L.nullSpace(L.actionMatrix()).map(c => L.combo(c, E));
  // c with [sum c_k N_k, N_j] = 0 for all j: rows = entries of brackets
  const rows = [];
  for (const B of N) {
    const br = N.map(A => L.bracket(A, B));
    for (let e = 0; e < 25; e++) { rows.push(br.map(M => M.re[e])); rows.push(br.map(M => M.im[e])); }
  }
  const cen = L.nullSpace(rows); assert(cen.length === 1, 'centre dimension ' + cen.length);
  const Z = L.combo(cen[0], N), U = L.unbroken(), k = Z.im[0] / U[0];
  for (let i = 0; i < 5; i++) { near(Z.im[i * 6], k * U[i], 1e-9); near(Z.re[i * 6], 0, 1e-12); }
  const Um = L.cm(5); U.forEach((u, i) => { Um.im[i * 6] = u; });
  const v = L.linkAction(Um, L.pairKet23()); assert(Math.max(...v.re.map(Math.abs), ...v.im.map(Math.abs)) < 1e-12, 'U reads 0');
});

// ============================================================================
section('scenes');
// A mock 2D context: every call is a no-op; numeric arguments must be finite.
function mockCtx(bad) {
  const NUM = new Set(['moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'fillRect', 'strokeRect', 'clearRect', 'translate', 'rotate', 'scale', 'setTransform', 'fillText', 'strokeText', 'createRadialGradient', 'createLinearGradient', 'ellipse', 'rect']);
  const target = { measureText: s => ({ width: String(s).length * 6.5 }), createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }), setLineDash() {}, save() {}, restore() {} };
  return new Proxy(target, {
    get(t, k) {
      if (k in t && typeof t[k] === 'function' && !NUM.has(k)) return t[k];
      if (typeof k === 'string' && /^[a-z]/.test(k) && !(k in t && typeof t[k] !== 'function')) {
        return (...args) => {
          if (NUM.has(k)) for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(k + '(' + args.join(',') + ')');
          if (k === 'createRadialGradient' || k === 'createLinearGradient') return { addColorStop() {} };
          if (k === 'measureText') return { width: String(args[0]).length * 6.5 };
          return undefined;
        };
      }
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const IDX = await import(join(HERE, 'index.js'));
await check('five scenes, each with steps, analogy text (right and breaks), captions', () => {
  assert(IDX.SCENES.join(',') === 'gears,bloch,qutrit,locks,charge', IDX.SCENES.join(','));
  for (const k of IDX.SCENES) {
    const M = IDX.SCENE_MODULES[k];
    assert(M.steps.length >= 2, k + ' steps');
    for (const part of ['right', 'breaks']) { const s = M.analogy[part]; assert(s && s.length > 80 && s.length < 700, k + ' ' + part + ' length ' + (s || '').length); }
    for (const s of M.steps) { const st = M.init({ step: s.id }); const c = M.caption(st, 1); assert(c && c.length > 40, k + '/' + s.id + ' caption'); assert(!/[A-Z]{4,}/.test(c.replace(/PPT|CODATA/g, '')), 'no shouting in ' + k); }
  }
});
await check('every scene and step draws at 360, 768 and 1280 px and in saver bands, all numbers finite', () => {
  let frames = 0; const bad = [];
  for (const k of IDX.SCENES) {
    const M = IDX.SCENE_MODULES[k];
    for (const W of [320, 360, 768, 1280]) {
      const H = M.height(W);
      assert(H >= 280 && H <= 700, `${k} height ${H} at ${W}`);
      for (const s of M.steps) for (const variant of [{}, { d: 3 }, { pair: 2, order: 1 }, { sel: [3, 3] }]) {
        for (const view of [{ x: 0, y: 0, w: W, h: H }, { x: 0, y: 120, w: W, h: Math.round(H * 0.4) }]) {
          const st = M.init(Object.assign({ step: s.id }, variant)); st.auto = false; st.since = 0;
          for (const t of [0, 0.4, 1.7, 3.3, 6.1, 12.9]) { M.draw(mockCtx(bad), { W, H, view, fill: false, reduced: false }, st, t); frames++; }
        }
      }
      // the tour mode
      const st = M.init({}); st.auto = true; st.since = 0;
      for (let t = 0; t < 40; t += 1.3) { M.draw(mockCtx(bad), { W, H, view: { x: 0, y: 0, w: W, h: H } }, st, t); frames++; }
    }
  }
  assert(bad.length === 0, bad.slice(0, 5).join('; '));
  console.log(`       ${frames} frames drew`);
});
await check('the tour visits every step of every scene', () => {
  for (const k of IDX.SCENES) {
    const M = IDX.SCENE_MODULES[k], st = M.init({}), seen = new Set(); st.auto = true; st.since = 0;
    for (let t = 0; t < 60; t += 0.5) { M.draw(mockCtx([]), { W: 360, H: 500, view: { x: 0, y: 0, w: 360, h: 500 } }, st, t); seen.add(st.step); }
    assert(seen.size === M.steps.length, k + ' saw ' + [...seen]);
  }
});
const LKmod = await import(join(HERE, 'scenes', 'locks.js'));
await check('locks witness: PT >= 0 up to 4, Choi < 0 past 3, positivity and CP numbers', () => {
  const D = LKmod.witnessData();
  D.xs.forEach((a, i) => { if (a <= 4 + 1e-9) assert(D.pt[i] > -1e-9, 'pt ' + a); if (a > 3 + 1e-9) assert(D.ch[i] < 0, 'ch ' + a); if (a < 3 - 1e-9) assert(D.ch[i] > 0, 'sep ' + a); });
  assert(D.posMin >= -1e-10); near(D.cpMin, -1, 1e-9);
});
// Text stays inside the canvas: a text-measuring mock (about 0.55 em per
// character for Inter; serif and narrow glyphs make it an overestimate).
function textCtx(W, H, out) {
  const st = { font: '12px x', textAlign: 'start' };
  const measure = s => { const m = /([\d.]+)px/.exec(st.font); return String(s).length * (m ? +m[1] : 12) * 0.55; };
  const base = mockCtx([]);
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return s => ({ width: measure(s) });
      if (k === 'fillText') return (s, x, y, maxW) => {
        const w = Math.min(measure(s), maxW ?? Infinity), a = st.textAlign, x0 = a === 'center' ? x - w / 2 : a === 'right' || a === 'end' ? x - w : x;
        if (x0 < -2 || x0 + w > W + 2 || y < -2 || y > H + 2) out.push(`"${String(s).slice(0, 40)}" x ${Math.round(x0)}..${Math.round(x0 + w)} y ${Math.round(y)}`);
      };
      if (k in st) return st[k];
      return base[k];
    },
    set(t, k, v) { st[k] = v; return true; },
  });
}
await check('at 320 to 1280 px every text label stays inside the figure', () => {
  const out = [];
  for (const k of IDX.SCENES) {
    const M = IDX.SCENE_MODULES[k];
    for (const W of [320, 360, 414, 768, 1280]) {
      const H = M.height(W);
      for (const s of M.steps) for (const variant of [{}, { d: 3 }, { sel: [2, 3] }, { pair: 1, order: 1 }]) {
        const st = M.init(Object.assign({ step: s.id }, variant)); st.auto = false; st.since = 0;
        for (const tt of [0.5, 2.6, 4.1, 7.3, 12]) {
          const before = out.length;
          M.draw(textCtx(W, H, out), { W, H, view: { x: 0, y: 0, w: W, h: H } }, st, tt);
          for (let i = before; i < out.length; i++) out[i] = `${k}/${s.id} W ${W}: ` + out[i];
        }
      }
    }
  }
  const uniq = [...new Set(out)];
  for (const u of uniq.slice(0, 40)) console.log('       outside: ' + u);
  assert(uniq.length === 0, uniq.length + ' labels outside:\n       ' + uniq.slice(0, 12).join('\n       '));
});
const BLmod = await import(join(HERE, 'scenes', 'bloch.js'));
await check('bloch product(): sx sy = i sz, sy sx = -i sz, cyclic', () => {
  const p = BLmod.product('x', 'y'), q = BLmod.product('y', 'x'), r = BLmod.product('z', 'x');
  assert(p.c === 'z' && Math.abs(p.im - 1) < 1e-12 && q.c === 'z' && Math.abs(q.im + 1) < 1e-12 && r.c === 'y' && Math.abs(r.im - 1) < 1e-12);
});

// ============================================================================
section('dom');
function findMod(name) {
  const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(':')].filter(Boolean);
  for (const d of dirs) for (const base of [join(d, 'x.js'), join(d, '..', 'x.js')]) { try { return createRequire(base)(name); } catch (e) { /* next */ } }
  return null;
}
const jsdom = findMod('jsdom');
if (!jsdom) { skip++; console.log('  skip dom: jsdom not found on NODE_PATH'); }
else {
  await check('createEnds boots in jsdom: canvas, 44 px buttons, notes, play(t), show, dispose', async () => {
    const dom = new jsdom.JSDOM('<!doctype html><html><head></head><body><div id="h" style="width:360px"></div></body></html>', { pretendToBeVisual: true });
    const w = dom.window;
    for (const k of ['window', 'document', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle']) globalThis[k] = k === 'window' ? w : w[k];
    w.HTMLCanvasElement.prototype.getContext = function () { return mockCtx(this.__bad || (this.__bad = [])); };
    const host = w.document.getElementById('h');
    const api = IDX.createEnds(host, { scene: 'gears', autoplay: false });
    assert(host.querySelector('canvas'), 'canvas');
    assert(w.document.getElementById('ends-css'), 'css injected');
    const btns = host.querySelectorAll('button'); assert(btns.length >= 4, 'buttons ' + btns.length);
    assert(host.querySelectorAll('.ends-note').length === 2, 'two notes');
    const h2 = w.document.createElement('div'); w.document.body.appendChild(h2);
    const quiet = IDX.createEnds(h2, { scene: 'bloch', notes: false, reduced: true });
    assert(!h2.querySelector('.ends-note') && h2.querySelector('.ends-cap'), 'notes: false hides the analogy text, keeps the caption');
    quiet.play(1.5); quiet.pause(); quiet.resume(); quiet.play(2); quiet.dispose();
    for (const sc of IDX.SCENES) for (const step of IDX.STEPS[sc]) { api.show(sc, { step }); api.play(2.5); assert(host.querySelector('.ends-cap').textContent.length > 20, sc + ' caption'); }
    btns[0] && host.querySelector('button').click();
    api.setBand({ t: 80, b: 120 }); api.play(1);
    const css = IDX.SCENE_MODULES && (await import(join(HERE, 'style.js'))).CSS;
    assert(/min-height:44px/.test(css) && /\[hidden\]\{display:none!important\}/.test(css), '44 px and hidden rule');
    assert(!/text-transform:\s*uppercase|letter-spacing/.test(css), 'no uppercase HUD text');
    api.dispose(); assert(!host.querySelector('canvas'), 'disposed');
    const f = w.document.createElement('div'); w.document.body.appendChild(f);
    const s2 = IDX.createEnds(f, { fill: true, scene: 'locks', params: { step: 'grid' } });
    assert(!f.querySelector('button') && !f.querySelector('.ends-notes'), 'fill mode has no controls');
    s2.play(3); s2.dispose();
  });
}

// ============================================================================
section('saver');
await check('saverShots name real scenes and steps, 5 to 12 s each, with TeX and captions', () => {
  assert(IDX.saverShots.length >= IDX.SCENES.length * 2);
  const ids = new Set();
  for (const s of IDX.saverShots) {
    assert(IDX.SCENES.includes(s.scene), s.id); assert(IDX.STEPS[s.scene].includes(s.params.step), s.id + ' step');
    assert(s.seconds >= 5 && s.seconds <= 12, s.id + ' seconds'); assert(s.tex && s.caption && s.title, s.id);
    assert(!ids.has(s.id), 'dup ' + s.id); ids.add(s.id);
  }
  for (const k of IDX.SCENES) assert(IDX.saverShots.some(s => s.scene === k), 'no shot for ' + k);
});
const mjMod = findMod('mathjax-full/js/mathjax.js');
if (!mjMod) { skip++; console.log('  skip mathjax: mathjax-full not found on NODE_PATH'); }
else {
  await check('every saver TeX string typesets in MathJax 3 with no error', () => {
    const { TeX } = findMod('mathjax-full/js/input/tex.js'), { SVG } = findMod('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = findMod('mathjax-full/js/adaptors/liteAdaptor.js'), { RegisterHTMLHandler } = findMod('mathjax-full/js/handlers/html.js');
    const { AllPackages } = findMod('mathjax-full/js/input/tex/AllPackages.js');
    const ad = liteAdaptor(); RegisterHTMLHandler(ad);
    const doc = mjMod.mathjax.document('', { InputJax: new TeX({ packages: AllPackages.filter(p => p !== 'bussproofs'), formatError: (j, e) => { throw e; } }), OutputJax: new SVG({ fontCache: 'none' }) });
    for (const s of IDX.saverShots) { const out = ad.outerHTML(doc.convert(s.tex, { display: true })); assert(!/data-mjx-error|merror/.test(out), 'TeX error: ' + s.tex); }
    console.log(`       ${IDX.saverShots.length} TeX strings typeset`);
  });
}

// ============================================================================
section('model');
const modelPath = join(HERE, '..', 'model', 'index.js');
if (!existsSync(modelPath)) { skip++; console.log('  skip model: ../model/index.js has not landed (ENDS uses linalg.js)'); }
else {
  let M = null;
  await check('MODEL imports', async () => { M = await import(modelPath); });
  if (M && typeof M.readCap === 'function') await check('MODEL readCap agrees with d1 d2 <= 6 on the 5 x 5 grid', () => {
    for (let a = 2; a <= 5; a++) for (let b = 2; b <= 5; b++) {
      const r = M.readCap(a, b), open = typeof r === 'boolean' ? r : r && (r.readable ?? r.open);
      assert(open === (a * b <= 6), `${a},${b}: ${JSON.stringify(r)}`);
    }
  });
  if (M && typeof M.centralCharge === 'function') await check('MODEL centralCharge is i(d2 - d1)', () => {
    for (const [a, b] of [[2, 2], [2, 3], [3, 3]]) {
      const q = M.centralCharge(a, b), im = typeof q === 'number' ? q : q && (q.im ?? q[1]);
      near(im, b - a, 1e-12, `${a},${b}`);
    }
  });
  if (M && typeof M.gellMann === 'function') await check('MODEL has 8 Gell-Mann and 3 Pauli letters', () => {
    assert(M.gellMann().length === 8 && M.pauli().length === 3);
  });
  if (M && typeof M.stabilizer === 'function') await check('MODEL stabilizer: rank 8, null space 4', () => {
    const s = M.stabilizer(); assert((s.rank ?? 8) === L.actionRank() && (s.nullity ?? s.null ?? (s.basis && s.basis.length) ?? 4) === 4, JSON.stringify(Object.keys(s)));
  });
}

console.log(`\nends: ${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
