// ============================================================================
//  SMITH CHART  ·  rf.test.mjs — node rf.test.mjs
// ----------------------------------------------------------------------------
//  Checks the math in rf.js with no browser:
//    units ........ parseEng and fmtEng
//    chart map .... gamma <-> z, VSWR, return loss, mismatch loss
//    forms ........ |gamma|, VSWR and S11 dB with a phase
//    L-network .... every solution, built from its part values, gives Z0
//    stub ......... the stub admittance cancels jb at d, for open and short
//    quarter-wave . line d, then lambda/4 of Zt, gives Z0
//    models ....... series and parallel RLC at resonance
//    Touchstone ... RI, MA and DB files, Z data, Hz units, v2 keywords
// ============================================================================
import { createRequire } from 'node:module';
const RF = createRequire(import.meta.url)('./rf.js');
const { cx, abs, sub } = RF;

let pass = 0, fail = 0;
function check(name, ok, info = '') {
  if (ok) pass++; else fail++;
  if (!ok || process.argv.includes('-v')) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`);
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const cnear = (a, b, tol = 1e-9) => abs(sub(a, b)) <= tol * Math.max(1, abs(b));

// ── units ───────────────────────────────────────────────────────────────────
for (const [s, v] of [['2.2n', 2.2e-9], ['10p', 10e-12], ['1.5G', 1.5e9], ['1.5GHz', 1.5e9], ['2.4 GHz', 2.4e9],
  ['50', 50], ['50 ohm', 50], ['75Ω', 75], ['100m', 0.1], ['5 mm', 5e-3], ['3.3u', 3.3e-6], ['4.7µ', 4.7e-6],
  ['1meg', 1e6], ['2M', 2e6], ['1e9', 1e9], ['-12.5', -12.5], ['.5', 0.5], ['2.2nH', 2.2e-9], ['10pF', 1e-11], ['1k', 1e3]]) {
  check(`parseEng "${s}"`, near(RF.parseEng(s), v, 1e-12), `-> ${RF.parseEng(s)}`);
}
for (const s of ['', 'abc', '1x2', '1.2.3', '5 q']) check(`parseEng "${s}" is NaN`, Number.isNaN(RF.parseEng(s)));
for (const [v, u, s] of [[2.2e-9, 'H', '2.20 nH'], [1e-11, 'F', '10.0 pF'], [50, 'Ω', '50.0 Ω'], [1.5e9, 'Hz', '1.50 GHz'], [999.96, 'Hz', '1.00 kHz']]) {
  check(`fmtEng ${v} ${u}`, RF.fmtEng(v, u) === s, `-> "${RF.fmtEng(v, u)}"`);
}
check('fmtEng compact round trip', near(RF.parseEng(RF.fmtEng(2.2e-9, '', 3, true)), 2.2e-9, 1e-12), RF.fmtEng(2.2e-9, '', 3, true));

// ── chart map ───────────────────────────────────────────────────────────────
for (const z of [cx(1.2, -1.6), cx(0.4, 0.8), cx(3, 0), cx(0.01, 5)]) {
  check(`z -> gamma -> z  ${z.re}${z.im >= 0 ? '+' : ''}${z.im}j`, cnear(RF.gammaToZ(RF.zToGamma(z)), z, 1e-12));
}
{
  const g = RF.zToGamma(cx(3, 0));
  check('gamma of z = 3 is 0.5', cnear(g, cx(0.5, 0), 1e-12));
  check('VSWR of |gamma| 0.5 is 3', near(RF.vswr(0.5), 3));
  check('return loss of |gamma| 0.5 is 6.0206 dB', near(RF.returnLossDb(0.5), 6.020599913, 1e-9));
  check('mismatch loss of |gamma| 0.5 is 1.2494 dB', near(RF.mismatchLossDb(0.5), 1.249387366, 1e-9));
  check('lambda/4 line turns z into 1/z', cnear(RF.zIn(cx(2, 1), 0.25), RF.inv(cx(2, 1)), 1e-12));
  check('lambda/2 line keeps z', cnear(RF.zIn(cx(2, 1), 0.5), cx(2, 1), 1e-12));
  check('a negative length undoes a positive one', cnear(RF.zIn(RF.zIn(cx(0.3, -0.7), 0.13), -0.13), cx(0.3, -0.7), 1e-12));
}

// ── forms ───────────────────────────────────────────────────────────────────
{
  const a = RF.gammaFrom('mag', 0.5, -60), b = RF.gammaFrom('vswr', 3, -60), c = RF.gammaFrom('db', -6.020599913, -60), d = RF.gammaFrom('db', 6.020599913, -60);
  check('|gamma| form', near(abs(a), 0.5) && near(RF.arg(a) * 180 / Math.PI, -60, 1e-9));
  check('VSWR 3 form = |gamma| 0.5', cnear(a, b, 1e-12));
  check('S11 -6.02 dB form = |gamma| 0.5', cnear(a, c, 1e-9));
  check('S11 +6.02 is read as return loss', cnear(a, d, 1e-9));
  check('VSWR below 1 is rejected', RF.gammaFrom('vswr', 0.5, 0) === null);
  check('Q of 1 + j2 is 2', near(RF.qOf(cx(1, 2)), 2));
}

// ── L-network ───────────────────────────────────────────────────────────────
// A deterministic set of loads over the whole chart. Each solution is built
// again from its part values (pF, nH) at f, then Zin must be Z0.
{
  const Z0 = 50, f = 2.4e9;
  let rng = 12345;
  const rand = () => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
  let sols = 0, worst = 0, loads = 0, missing = 0;
  const cases = [cx(10, 15), cx(200, -100), cx(25, 0), cx(50, 80), cx(120, 0), cx(50, 0.5)];
  for (let i = 0; i < 400; i++) {
    const g = RF.polar(0.97 * Math.sqrt(rand()), rand() * Math.PI * 2);
    cases.push(RF.scale(RF.gammaToZ(g), Z0));
  }
  for (const ZL of cases) {
    const S = RF.lMatch(ZL, Z0, f);
    loads++;
    if (!S.length) missing++;
    for (const s of S) {
      sols++;
      const Zin = RF.lNetworkZin(ZL, s, f);
      worst = Math.max(worst, abs(sub(Zin, cx(Z0, 0))) / Z0);
      if (!(s.q >= 0)) worst = Infinity;
    }
  }
  check('L-network: every solution gives Z0 (rel. error < 1e-9)', worst < 1e-9, `${sols} solutions on ${loads} loads, worst ${worst.toExponential(2)}`);
  check('L-network: every load with R > 0 has a solution', missing === 0, `${missing} with none`);
  const four = RF.lMatch(cx(30, 40), Z0, f), two = RF.lMatch(cx(200, -100), Z0, f);
  check('L-network: 30 + j40 (R < Z0, G < 1/Z0) has 4 solutions', four.length === 4, four.map(s => s.topo).join(','));
  const one = RF.lMatch(cx(10, 15), Z0, f);
  check('L-network: 10 + j15 (G > 1/Z0) has only the series-first pair', one.length === 2 && one.every(s => s.topo === 'series'));
  check('L-network: 200 - j100 has only the shunt-first pair', two.length === 2 && two.every(s => s.topo === 'shunt'));
  check('L-network: a matched load needs no network', RF.lMatch(cx(50, 0), Z0, f).length === 0);
  check('L-network: a pure reactance has no solution', RF.lMatch(cx(0, 30), Z0, f).length === 0);
  // a textbook value: 25 ohm to 50 ohm at 1 GHz, series L then shunt C.
  // X = 25, B = 1/50 -> L = 3.979 nH, C = 3.183 pF
  const tb = RF.lMatch(cx(25, 0), Z0, 1e9).find(s => s.topo === 'series' && s.near.part.kind === 'L');
  check('L-network: 25 -> 50 ohm at 1 GHz is 3.979 nH + 3.183 pF', tb && near(tb.near.part.value, 3.9789e-9, 1e-4) && near(tb.far.part.value, 3.1831e-12, 1e-4),
    tb ? `${RF.fmtEng(tb.near.part.value, 'H')} + ${RF.fmtEng(tb.far.part.value, 'F')}` : 'none');
}

// ── stub ────────────────────────────────────────────────────────────────────
{
  let worst = 0, n = 0;
  for (const kind of ['open', 'short']) {
    for (const z of [cx(1.2, -1.6), cx(0.4, 0.8), cx(3, 0), cx(0.2, -0.1), cx(1, 0.7)]) {
      for (const s of RF.shuntStub(z, kind)) {
        n++;
        const yD = RF.inv(RF.zIn(z, s.d));
        const sum = RF.add(yD, RF.stubY(kind, s.l));
        worst = Math.max(worst, abs(sub(sum, cx(1, 0))));
        if (!(s.d >= 0 && s.d < 0.5 && s.l >= 0 && s.l < 0.5)) worst = Infinity;
      }
    }
  }
  check('stub: y(d) + y(stub) = 1 for every solution', worst < 1e-9, `${n} solutions, worst ${worst.toExponential(2)}`);
  const sm = RF.stubMatch(cx(60, -80), 50, 'short', 1e9, 0.66);
  const lam = 0.66 * RF.C0 / 1e9;
  check('stub: metres use vf * c / f', sm.length === 2 && near(sm[0].dM, sm[0].d * lam) && near(sm[0].lDeg, sm[0].l * 360), `lambda ${(lam * 1000).toFixed(2)} mm`);
}

// ── quarter-wave ────────────────────────────────────────────────────────────
{
  let worst = 0, n = 0;
  for (const ZL of [cx(60, -80), cx(20, 30), cx(150, 0), cx(10, -5)]) {
    for (const s of RF.quarterWave(ZL, 50)) {
      n++;
      const Zd = RF.scale(RF.zIn(RF.scale(ZL, 1 / 50), s.d), 50);
      const Zin = RF.scale(RF.zIn(RF.scale(Zd, 1 / s.Zt), 0.25), s.Zt);
      worst = Math.max(worst, abs(sub(Zin, cx(50, 0))) / 50, Math.abs(Zd.im) / 50);
    }
  }
  check('quarter-wave: line d gives a real R, lambda/4 of Zt gives Z0', worst < 1e-9, `${n} solutions, worst ${worst.toExponential(2)}`);
}

// ── models ──────────────────────────────────────────────────────────────────
{
  const L = 40e-9, C = 6e-12, f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  check('series RLC is R at f0', cnear(RF.seriesRLC(30, L, C, f0), cx(30, 0), 1e-9));
  check('parallel RLC is R at f0', cnear(RF.parallelRLC(300, L, C, f0), cx(300, 0), 1e-9));
  check('parallel RLC with no parts is open', !isFinite(RF.parallelRLC(Infinity, Infinity, 0, 1e9).re));
  check('series RLC with C = Infinity has no cap', near(RF.seriesRLC(5, 1e-9, Infinity, 1e9).im, 2 * Math.PI));
  const eq = RF.equivalent(cx(50, -50), 1e9);
  check('equivalent: 50 - j50 at 1 GHz is 50 ohm + 3.183 pF series', eq.series.part.kind === 'C' && near(eq.series.part.value, 3.1831e-12, 1e-4));
  check('equivalent: 50 - j50 is 100 ohm || 1.592 pF', near(eq.parallel.R, 100, 1e-9) && eq.parallel.part.kind === 'C' && near(eq.parallel.part.value, 1.5915e-12, 1e-4));
}

// ── Touchstone ──────────────────────────────────────────────────────────────
{
  const want = [cx(0.3, -0.4), cx(-0.1, 0.2)];
  const ma = want.map(g => [abs(g), RF.arg(g) * 180 / Math.PI]);
  const files = {
    'RI, GHz': `! a test\n# GHz S RI R 50\n1.0 0.3 -0.4\n2.0 -0.1 0.2\n`,
    'MA, MHz': `# MHz S MA R 50\n1000 ${ma[0][0]} ${ma[0][1]}\n2000 ${ma[1][0]} ${ma[1][1]}\n`,
    'DB, Hz': `# Hz S DB R 50\n1e9 ${20 * Math.log10(ma[0][0])} ${ma[0][1]} ! inline comment\n2e9 ${20 * Math.log10(ma[1][0])} ${ma[1][1]}\n`,
    'default options (GHz S MA)': `# \n1 ${ma[0][0]} ${ma[0][1]}\n2 ${ma[1][0]} ${ma[1][1]}\n`,
    'v2 keywords': `[Version] 2.0\n# GHz S RI R 50\n[Number of Ports] 1\n[Network Data]\n1 0.3 -0.4\n2 -0.1 0.2\n[End]\n`,
  };
  for (const [name, text] of Object.entries(files)) {
    let ok = false, info = '';
    try {
      const t = RF.parseTouchstone(text, 'x.s1p');
      ok = t.points.length === 2 && near(t.points[0].f, 1e9) && near(t.points[1].f, 2e9)
        && cnear(t.points[0].g, want[0], 1e-9) && cnear(t.points[1].g, want[1], 1e-9);
      info = `${t.fmt}, ${t.points.length} points`;
    } catch (e) { info = e.message; }
    check(`Touchstone ${name}`, ok, info);
  }
  // Z data, normalized to R = 75: z = 2 -> gamma 1/3, then Z = 150 ohm
  const tz = RF.parseTouchstone('# GHz Z RI R 75\n1 2 0\n', 'z.s1p');
  check('Touchstone Z data: z 2 on R 75 is 150 ohm', tz.ref === 75 && cnear(RF.zFromGammaRef(tz.points[0].g, tz.ref), cx(150, 0), 1e-9));
  // 2-port: S11 is the first pair of 9 numbers
  const t2 = RF.parseTouchstone('# GHz S RI R 50\n1 0.3 -0.4 0.9 0 0.9 0 0.1 0.1\n', 'amp.s2p');
  check('Touchstone 2-port keeps S11', t2.ports === 2 && cnear(t2.points[0].g, want[0], 1e-12));
  let threw = '';
  try { RF.parseTouchstone('# GHz S RI R 50\n1 0.3\n', 'bad.s1p'); } catch (e) { threw = e.message; }
  check('Touchstone: a short record throws', !!threw, threw);
  const pts = RF.parseTouchstone(files['RI, GHz'], 'x.s1p').points;
  check('gammaAtFreq interpolates the middle', cnear(RF.gammaAtFreq(pts, 1.5e9), cx(0.1, -0.1), 1e-12));
  check('gammaAtFreq is null outside the data', RF.gammaAtFreq(pts, 3e9) === null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
