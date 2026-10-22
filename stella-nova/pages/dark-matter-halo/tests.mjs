// ============================================================================
//  DARK MATTER HALO  ·  tests.mjs — node tests, no browser
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/dark-matter-halo/tests.mjs
//  Covers model.js. The first group checks that the sum of the McMillan
//  (2017) components gives the values of the paper (Table 3, sec. 2.1-2.3).
//  The other groups check each method against a closed form: the disc
//  rings against the Freeman thin disc, the spheroid against a sphere, and
//  the halo quadrature against the Burkert and isothermal masses.
//
//  The shots.js group checks the saver: the seeded plan, the framing in
//  the plate band at 16:9 and at 9:16, and that the shear test stars fly
//  apart with the visible matter only and hold with the halo.
//  The halo.js group checks the page logic against model.js and closed
//  forms. The page group links main.js in node (a SyntaxError or a
//  missing export blanks the page) and checks that index.html has every
//  id main.js binds, the head load order and the [hidden] guard.
//  The data.js group checks the measured points: a weighted line fit
//  to each table must give the fit that its paper reports.
//
//  grep -n targets: "section(" opens each group.
// ============================================================================
import * as M from './model.js';
import * as D from './data.js';
import * as H from './halo.js';
import * as Sh from './shots.js';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = fileURLToPath(new URL('.', import.meta.url));

let pass = 0, fail = 0, cur = '';
function section(s) { cur = s; console.log('\n# ' + s); }
function ok(c, msg) { if (c) pass++; else { fail++; console.log(`  FAIL [${cur}] ${msg}`); } }
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const m = M.MCMILLAN17;

section('McMillan 2017 values');
{
  const c = M.curve(m, [m.R0]);
  ok(Math.abs(c.v.total[0] - m.v0) < 1.5, `v(R0) ${c.v.total[0].toFixed(2)} vs ${m.v0} km/s`);
  const rho = M.haloDensity(m.halo, m.R0);
  ok(rel(rho, m.derived.rhoSun) < 0.01, `rho_sun ${M.perPc3(rho).toFixed(5)} Msun/pc^3`);
  ok(Math.abs(M.gev(rho) - 0.38) < 0.01, `rho_sun ${M.gev(rho).toFixed(3)} GeV/cm^3`);
  const v = M.virial(m);
  ok(rel(v.Mv, m.derived.Mv) < 0.02, `Mv ${v.Mv.toExponential(3)} (H = 70.4, 200 x critical, baryons in)`);
  const mstar = M.bulgeMass(m.bulge) + M.discMass(m.discs[0]) + M.discMass(m.discs[1]);
  ok(rel(mstar, m.derived.Mstar) < 0.01, `M* ${mstar.toExponential(3)}`);
  // Sec. 2.1: rho0,b = 9.93e10 Msun/kpc^3 <-> Mb = 8.9e9. Table 3 gives
  // Mb 9.23e9 for rho0,b 98.4e9, which eq. 1 does not give; see model.js.
  const b = M.bulgeMass({ ...m.bulge, rho0: 9.93e10 });
  ok(rel(b, 8.9e9) < 0.01, `bulge mass for the sec. 2.1 normalisation ${b.toExponential(3)}`);
  ok(rel(M.discMass(m.discs[2]), 1.1e10) < 0.04, `HI mass ${M.discMass(m.discs[2]).toExponential(3)} (Table 1: 1.1e10)`);
  ok(rel(M.discMass(m.discs[3]), 1.2e9) < 0.04, `H2 mass ${M.discMass(m.discs[3]).toExponential(3)} (Table 1: 1.2e9)`);
  const sun = m.discs.map(d => M.discSigma(d, 8.33) / 1e6);
  ok(Math.abs(sun[2] - 10) < 0.2 && Math.abs(sun[3] - 2) < 0.05, `gas Sigma at 8.33 kpc: HI ${sun[2].toFixed(2)}, H2 ${sun[3].toFixed(2)} (Table 1: 10, 2)`);
}

section('disc rings vs the Freeman thin disc');
{
  // Md 5e10, Rd 2.6: razor-thin values from scipy I0K0 - I1K1.
  const d = { id: 't', law: 'exp', sigma0: 5e10 / (2 * Math.PI * 2.6 * 2.6), Rd: 2.6, zd: 0.01 };
  const want = [[2, 134.9], [5, 178.2], [8.2, 170.2], [20, 109.1]];
  const c = M.curve({ ...m, discs: [d], bulge: { ...m.bulge, rho0: 0 }, halo: { family: 'nfw', rho0: 0, rs: 1 } }, want.map(w => w[0]));
  want.forEach(([R, v], i) => ok(rel(c.v.t[i], v) < 0.01, `R ${R}: ${c.v.t[i].toFixed(2)} vs ${v}`));
  const thick = M.curve({ ...m, discs: [{ ...d, zd: 0.3 }] }, [8.2]);
  ok(thick.v.t[0] < c.v.t[2] && thick.v.t[0] > 0.9 * c.v.t[2], `a thick disc is a little slower (${thick.v.t[0].toFixed(1)} vs ${c.v.t[2].toFixed(1)})`);
}

section('bulge spheroid');
{
  const sph = { ...m.bulge, q: 1 };
  // A sphere: v^2 = G M(<R) / R, M(<R) = 4 pi int rho r^2 (midpoint sum).
  for (const R of [0.5, 2, 8]) {
    const c = M.curve({ ...m, bulge: sph, discs: [], halo: { family: 'nfw', rho0: 0, rs: 1 } }, [R]);
    ok(rel(c.v2.bulge[0], M.G * sphereMass(sph, R) / R) < 1e-3, `q = 1 at R ${R}: ${c.v.bulge[0].toFixed(2)} km/s`);
  }
  function sphereMass(b, R) { let s = 0; const n = 20000; for (let i = 0; i < n; i++) { const r = (i + 0.5) / n * R; s += 4 * Math.PI * r * r * M.bulgeDensity(b, r, 0) * R / n; } return s; }
  // Independent check of the flattened bulge: a brute-force ring sum on a
  // geometric (R', z) grid that resolves the cusp. A sphere of the same
  // mass is 7 % off at 4 kpc, so this separates the two.
  const A = geo(1e-4, 12, 1500), Z = geo(1e-4, 8, 700);
  const ringSum = R => {
    let s = 0;
    for (let i = 0; i + 1 < A.length; i++) {
      const a = (A[i] + A[i + 1]) / 2, da = A[i + 1] - A[i];
      for (let j = 0; j + 1 < Z.length; j++) {
        const z = (Z[j] + Z[j + 1]) / 2, rho = M.bulgeDensity(m.bulge, a, z);
        if (!rho) continue;
        const q = (R + a) ** 2 + z * z;
        s -= 2 * 2 * Math.PI * a * rho * da * (Z[j + 1] - Z[j]) * 2 * M.G * agmK(4 * a * R / q) / (Math.PI * Math.sqrt(q));
      }
    }
    return s;
  };
  for (const [R, tol] of [[1, 0.01], [4, 0.002], [8, 0.002]]) {
    const h = 1e-3 * R, want = R * (ringSum(R + h) - ringSum(R - h)) / (2 * h);
    const got = M.curve({ ...m, discs: [], halo: { family: 'nfw', rho0: 0, rs: 1 } }, [R]).v2.bulge[0];
    ok(rel(got, want) < tol, `flattened bulge at R ${R}: ${got.toFixed(1)} vs ring sum ${want.toFixed(1)}`);
  }
  function geo(lo, hi, n) { const e = [0]; for (let i = 0; i <= n; i++) e.push(lo * Math.pow(hi / lo, i / n)); return e; }
  function agmK(mm) { let a = 1, c = Math.sqrt(1 - mm); for (let i = 0; i < 40 && Math.abs(a - c) > 1e-15 * a; i++) { const t = (a + c) / 2; c = Math.sqrt(a * c); a = t; } return Math.PI / (2 * a); }
}

section('halo families');
{
  const bk = { family: 'burkert', rho0: 1e7, rs: 9 }, it = { family: 'isothermal', rho0: 1e7, rs: 3 };
  for (const r of [1, 8, 40, 200]) {
    const x = r / 9, mb = Math.PI * 1e7 * 729 * (Math.log((1 + x) ** 2 * (1 + x * x)) - 2 * Math.atan(x));
    ok(rel(M.haloMass(bk, r), mb) < 1e-5, `Burkert M(<${r})`);
    const y = r / 3, mi = 4 * Math.PI * 1e7 * 27 * (y - Math.atan(y));
    ok(rel(M.haloMass(it, r), mi) < 1e-5, `isothermal M(<${r})`);
  }
  const nfwNum = M.haloMass({ ...m.halo, family: 'nfw' }, 30);
  let s = 0; const n = 200000; for (let i = 0; i < n; i++) { const r = (i + 0.5) / n * 30; s += 4 * Math.PI * r * r * M.haloDensity(m.halo, r) * 30 / n; }
  ok(rel(nfwNum, s) < 1e-3, 'NFW closed form = brute-force sum');
  const vf = Math.sqrt(4 * Math.PI * M.G * it.rho0 * it.rs * it.rs);
  const far = M.curve({ ...m, halo: it }, [300, 600]).v.halo;
  ok(rel(far[0], vf) < 0.02 && rel(far[1], vf) < 0.01, `cored isothermal goes flat: ${far[0].toFixed(1)}, ${far[1].toFixed(1)} -> ${vf.toFixed(1)}`);
  for (const f of ['einasto', 'burkert', 'isothermal']) {
    const h = M.matchLocal(m, f, f === 'einasto' ? 15 : 9);
    ok(rel(M.haloDensity(h, m.R0), M.haloDensity(m.halo, m.R0)) < 1e-12, `${f} matched to the local density`);
  }
  ok(M.haloDensity(m.halo, 0.1) > 10 * M.haloDensity(M.matchLocal(m, 'burkert', 9), 0.1), 'at 100 pc the cusp is 10x the core: the inner halo is where the profiles disagree');
}

section('curve shape');
{
  const c = M.curve(m, [2, 8.21, 50]);
  ok(c.v2.hi[0] < 0 && c.v.hi[0] < 0, 'inside its hole the HI disc pulls outward (v keeps the sign)');
  ok(c.v.baryons[2] < 0.5 * c.v.total[2], `at 50 kpc the baryons alone give ${c.v.baryons[2].toFixed(0)} of ${c.v.total[2].toFixed(0)} km/s`);
  const f8 = M.darkFraction(m, 8.21).frac, f50 = M.darkFraction(m, 50).frac;
  ok(f8 > 0.3 && f8 < 0.6 && f50 > 0.8, `dark fraction inside 8.21 kpc ${f8.toFixed(2)}, inside 50 kpc ${f50.toFixed(2)}`);
  const again = M.curve({ ...m, halo: M.matchLocal(m, 'burkert', 9) }, [2, 8.21, 50], { discs: Object.fromEntries(m.discs.map(d => [d.id, c.v2[d.id]])) });
  ok(again.v2.thin.every((v, i) => v === c.v2.thin[i]), 'opts.discs reuses the disc arrays');
  const t = performance.now(); M.curve(m, Array.from({ length: 120 }, (_, i) => 0.25 + i * 0.5)); const ms = performance.now() - t;
  ok(ms < 3000, `120-radius curve in ${ms.toFixed(0)} ms`);
}

section('shots.js (saver)');
{
  const a = Sh.shotPlan(1, 40, 0.7), b = Sh.shotPlan(1, 40, 0.7), c = Sh.shotPlan(2, 40, 0.7);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed, same plan');
  ok(a.map(s => s.id).join() !== c.map(s => s.id).join(), 'another seed, another order');
  ok(a.every(s => s.sec >= 5 && s.sec <= 12) && Sh.shotPlan(9, 40, 0).every(s => s.sec >= 5 && s.sec <= 12) && Sh.shotPlan(9, 40, 1).every(s => s.sec >= 5 && s.sec <= 12), 'every shot lasts 5 to 12 s at calm 0, 0.7 and 1');
  ok(a.every((s, i) => !i || s.id !== a[i - 1].id), 'no shot follows itself');
  ok(new Set(a.slice(0, 4).map(s => s.id)).size === 4, 'the first four shots are all four ids');
  const starts = new Set(Array.from({ length: 12 }, (_, i) => Sh.shotPlan(i + 1, 1)[0].id));
  ok(starts.size >= 3, `the first shot varies with the seed (${[...starts].join(', ')})`);
  for (const id of Sh.SHOT_IDS) ok(!('code' in Sh.SHOTS[id]) && Sh.SHOTS[id].title && Sh.SHOTS[id].tex.length, `plate of ${id}: title and TeX, no code`);
  // Framing: 16:9 and 9:16, with no plate and with a plate band.
  const frames = [[1280, 720, 0.24, 0.30], [1280, 720, 0, 0], [720, 1280, 0.24, 0.32], [405, 720, 0.26, 0.34], [390, 844, 0, 0]];
  for (const [w, h, ft, fb] of frames) {
    const band = { t: h * ft, b: h * fb }, bh = h - band.t - band.b;
    for (const id of Sh.SHOT_IDS) {
      const L = Sh.shotLayout(id, w, h, band), tag = `${id} at ${w}x${h} band ${bh.toFixed(0)}px`;
      ok(L.panels.every(p => p.x >= 0 && p.x + p.w <= w + 0.5 && p.y >= band.t - 0.5 && p.y + p.h <= h - band.b + 0.5), `${tag}: inside the clear band`);
      const area = L.panels.reduce((s, p) => s + p.w * p.h, 0);
      ok(area >= 0.3 * w * bh, `${tag}: fills ${(100 * area / (w * bh)).toFixed(0)} % of the band (>= 30 %)`);
      ok(Math.abs(L.subject.x - w / 2) < 1 && Math.abs(L.subject.y - (band.t + bh / 2)) < 1, `${tag}: centred in the band`);
      if (id === 'shear') {
        const [p, q] = L.panels;
        ok(p.x + p.w <= q.x + 0.5 || p.y + p.h <= q.y + 0.5, `${tag}: the two panels do not overlap`);
      } else {
        const p = L.panels[0];
        ok(p.w / p.h <= 1.61 && p.h / p.w <= 1.11, `${tag}: chart aspect ${(p.w / p.h).toFixed(2)}`);
      }
    }
  }
  // The shear test: the same launch speeds, two pulls.
  const base = H.baseOnce(), curve = H.curveFor(base, H.makeHalo('nfw', H.CONTROLS.rs.def, H.CONTROLS.local.def));
  const sim = Sh.makeShear(curve, 400, 5);
  for (let i = 0; i < 20; i++) Sh.stepShear(sim, 20);
  const fv = Sh.spread(sim.sets.visible.stars), fh = Sh.spread(sim.sets.halo.stars);
  ok(fv > 0.5, `visible matter only: ${(fv * 100).toFixed(0)} % of the stars go past 1.5 x their start radius in 400 Myr`);
  ok(fh < 0.01, `with the halo: ${(fh * 100).toFixed(1)} % do`);
  const rr = sim.sets.halo.stars.map(s => Math.hypot(s.x, s.y) / s.r0);
  ok(Math.max(...rr) < 1.05 && Math.min(...rr) > 0.95, 'with the halo the stars stay on their circles (within 5 %)');
}

section('halo.js (page logic)');
{
  const R0 = m.R0, base = H.baseOnce();
  ok(H.CURVE_R.every((r, i) => !i || r > H.CURVE_R[i - 1]) && H.CURVE_R.includes(R0), 'curve grid sorted and holds R0');
  const def = H.makeHalo('nfw', H.CONTROLS.rs.def, H.CONTROLS.local.def);
  ok(rel(def.rho0, m.halo.rho0) < 1e-9 && def.rs === m.halo.rs, 'the default controls give the McMillan halo');
  for (const f of H.FAMILIES) for (const loc of [0.2, 0.3, 0.5]) {
    const h = H.makeHalo(f, 12, loc);
    ok(Math.abs(M.gev(M.haloDensity(h, R0)) - loc) < 1e-9, `${f} at ${loc} GeV/cm^3: density at the Sun matches`);
  }
  const bur = H.makeHalo('burkert', 9, 0.34);
  const want = M.curve(H.withHalo(bur), [3, R0, 40]), got = H.curveFor(base, bur);
  [3, R0, 40].forEach((r, i) => { const j = H.CURVE_R.indexOf(r); ok(j < 0 || rel(got.v.total[j], want.v.total[i]) < 1e-9, `curveFor (cached discs) = curve at R ${r}`); });
  const mb = H.baseFractions(), c = H.curveFor(base, def), s = H.summary(base, def, c, mb);
  ok(Math.abs(s.vSun - 233.2) < 0.2, `summary: ${s.vSun.toFixed(2)} km/s at the Sun`);
  ok(Math.abs(s.vSunBaryons - 177) < 1, `summary: visible matter alone ${s.vSunBaryons.toFixed(1)} km/s (about 177)`);
  ok(Math.abs(s.fracSun - 0.47) < 0.01 && Math.abs(s.frac50 - 0.87) < 0.01, `summary: dark ${(s.fracSun * 100).toFixed(1)} % inside R0, ${(s.frac50 * 100).toFixed(1)} % inside 50 kpc`);
  ok(rel(s.Mv, m.derived.Mv) < 0.02, `summary: virial mass ${s.Mv.toExponential(3)}`);
  for (const r of [3, 20, 100]) ok(Math.abs(H.at(H.FRAC_R, H.fractionCurve(def, mb), r) - M.darkFraction(m, r).frac) < 0.01, `fractionCurve at ${r} kpc matches darkFraction`);
  const fr = H.fractionCurve(def, mb);
  ok(fr.every((f, i) => H.FRAC_R[i] < 2 || f >= fr[i - 1]), 'dark share rises outward past 2 kpc');
  const nx = 60, nz = 40, g = H.densityGrid(m, 'halo', nx, nz, 30, 20);
  ok(g.every((v, k) => Math.abs(v - g[(nz - 1 - Math.floor(k / nx)) * nx + (k % nx)]) < 1e-6), 'density grid is symmetric in z');
  const it = { family: 'isothermal', rho0: 1e7, rs: 4 };
  for (const R of [0, 8, 25]) {
    const a = Math.hypot(4, R), exact = 2 * 1e7 * 16 / a * Math.atan(300 / a) * 1e-6;
    ok(rel(H.haloColumn(it, R), exact) < 0.01, `halo column at R ${R}: ${H.haloColumn(it, R).toFixed(2)} vs ${exact.toFixed(2)} Msun/pc^2`);
  }
  const e38 = H.misfit(c, D.EILERS19.rows), e30 = H.misfit(H.curveFor(base, H.makeHalo('nfw', H.CONTROLS.rs.def, 0.30)), D.EILERS19.rows);
  ok(e38.mean > 0 && e30.rms < e38.rms, `the McMillan curve runs above Eilers (mean ${e38.mean.toFixed(1)}); 0.30 GeV/cm^3 fits better (rms ${e30.rms.toFixed(1)} vs ${e38.rms.toFixed(1)})`);
  const st = H.discStars(500, 4), st2 = H.discStars(500, 4);
  ok(st.length === 500 && st.every(x => x.R > 0 && x.R <= 22) && JSON.stringify(st) === JSON.stringify(st2), 'disc stars: seeded, inside 22 kpc');
}

section('page: link and markup');
{
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./main.js')"], { cwd: HERE, encoding: 'utf8', timeout: 60000 });
  const err = run.stderr || '';
  ok(!/SyntaxError/.test(err), 'main.js links (no SyntaxError)' + (/SyntaxError/.test(err) ? ': ' + err.split('\n').find(l => /SyntaxError/.test(l)) : ''));
  ok(/ReferenceError: (matchMedia|window|document|IntersectionObserver|addEventListener|requestAnimationFrame) is not defined/.test(err), 'main.js ran in node until a browser global');
  const html = readFileSync(HERE + 'index.html', 'utf8'), js = readFileSync(HERE + 'main.js', 'utf8'), css = readFileSync(HERE + 'style.css', 'utf8');
  const ids = [...new Set([...js.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(x => x[1]))];
  const missing = ids.filter(id => !html.includes(`id="${id}"`));
  ok(ids.length > 20 && !missing.length, `index.html has all ${ids.length} ids main.js binds` + (missing.length ? ` (missing ${missing.join(', ')})` : ''));
  const head = ['gpu-guard.js', 'wishlist.js', 'stats-beacon.js'].map(f => html.indexOf(f));
  ok(head.every(i => i > 0) && head[0] < head[1] && head[1] < head[2] && head[2] < html.indexOf('<meta charset'), 'head order: gpu-guard, wishlist, stats-beacon');
  ok(/\[hidden\]\{display:none!important\}/.test(css), 'style.css has the [hidden] guard');
  ok(!/katex/i.test(html + js) && js.includes("../../lib/sci-math.js") && html.includes('../../lib/sci.css'), 'math through sci-math.js and sci.css, no KaTeX');
  ok(js.includes("import './saver.js'"), 'main.js imports saver.js');
  // rem is the root size (16px; style.css does not set it). Canvas text
  // in draw-*.js uses fs >= 11 (see the fs defaults there).
  const small = [...css.matchAll(/font(?:-size)?:\s*(?:[0-9]{3}\s+)?([0-9.]+)(px|rem)/g)].map(x => x[2] === 'rem' ? +x[1] * 16 : +x[1]);
  ok(small.length > 10 && small.every(px => px >= 11), `no CSS text under 11px (${small.length} sizes, smallest ${Math.min(...small).toFixed(1)}px)`);
}

section('data.js');
{
  // Weighted least-squares line v = a + b (R - R0), weights 1 / sigma^2.
  const fit = (rows, r0) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of rows) { const s = (p.lo + p.hi) / 2, w = 1 / (s * s), x = p.R - r0; sw += w; sx += w * x; sy += w * p.v; sxx += w * x * x; sxy += w * x * p.v; }
    const b = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
    return { a: (sy - b * sx) / sw, b };
  };
  for (const T of [D.EILERS19, D.JIAO23]) {
    ok(!!D.SOURCES[T.src], `${T.src} source resolves`);
    ok(T.rows.every((p, i) => p.lo > 0 && p.hi > 0 && p.v > 100 && p.v < 300 && (!i || p.R > T.rows[i - 1].R)), `${T.src}: sorted by R, positive errors, speeds 100-300 km/s`);
  }
  ok(D.EILERS19.rows.length === 38 && D.JIAO23.rows.length === 18, `row counts ${D.EILERS19.rows.length} and ${D.JIAO23.rows.length} (tables: 38 and 18)`);
  // Checksums of the copied speeds, so that a later typo shows.
  ok(D.EILERS19.rows.reduce((s, p) => s + p.v, 0).toFixed(2) === '8171.47', 'Eilers speed checksum');
  ok(D.JIAO23.rows.reduce((s, p) => s + p.v, 0).toFixed(2) === '3731.50', 'Jiao speed checksum');
  const e = fit(D.EILERS19.rows, D.EILERS19.r0);
  ok(Math.abs(e.a - 229.0) < 0.2 && Math.abs(e.b + 1.7) < 0.1, `Eilers line fit ${e.a.toFixed(2)} km/s, ${e.b.toFixed(2)} km/s/kpc (paper: 229.0, -1.7)`);
  const j = fit(D.JIAO23.rows, D.JIAO23.r0);
  ok(Math.abs(j.b + 2.18) < 0.05, `Jiao line slope ${j.b.toFixed(2)} km/s/kpc (paper: -2.18)`);
  const drop = D.JIAO23.rows.find(p => p.R === 19.5).v - D.JIAO23.rows.find(p => p.R === 26.5).v;
  ok(Math.abs(drop - D.ESTIMATES.jiaoDrop.dv) < 2, `Jiao drop 19.5 -> 26.5 kpc ${drop.toFixed(1)} km/s (abstract: about 30)`);
  ok(Math.abs(D.cosmicDarkFraction() - 0.843) < 0.002, `cosmic dark share of matter ${D.cosmicDarkFraction().toFixed(4)}`);
  ok(D.HISTORY.every((h, i) => !i || h.year >= D.HISTORY[i - 1].year), 'history sorted by year');
  const cited = [...D.HISTORY, ...D.METHODS].flatMap(h => h.src).concat(Object.values(D.ESTIMATES).flat().filter(x => x && x.src).map(x => x.src));
  ok(cited.every(id => D.SOURCES[id]), 'every cited source id resolves');
  ok(Object.values(D.SOURCES).every(s => s.doi || s.arxiv), 'every source has a DOI or an arXiv id');
  ok(Math.abs(D.ESTIMATES.localGeV[1].v - M.gev(M.haloDensity(m.halo, m.R0))) < 0.01, 'the McMillan local density in data.js matches model.js');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
