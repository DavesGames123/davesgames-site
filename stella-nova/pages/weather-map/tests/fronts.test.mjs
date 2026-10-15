// WEATHER MAP · tests/fronts.test.mjs — package FRONTS: render/fronts.js
// geometry (smoothing, symbol side and spacing, closed and short fronts,
// the antimeridian), the morph pairing and buffers, the sample bulletins,
// and shaders/fronts.wgsl (naga on frame.wgsl + fronts.wgsl, Tint rules).
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  smoothFront, frontGeometry, frontUnits, unitAlpha, unitBase, matchFronts, buildFrontBuffers,
  packFrontU, bracketOf, sampleAt, toXYZ, STYLES, KIND, PRES, FRONT_R, LINE_FLOATS, SYM_FLOATS,
  FRONT_U_FLOATS, MID_LEVEL, BIG, DEFAULTS, frontLegend,
} from '../render/fronts.js';
import { loadFrontsSample, frontsBracket } from '../data/fronts.js';

const page = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, page), 'utf8');
const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const east = (_lat, lon) => [-Math.sin(lon * D2R), 0, -Math.cos(lon * D2R)];
const north = (lat, lon) => [-Math.sin(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R), Math.sin(lat * D2R) * Math.sin(lon * D2R)];
const finite = a => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };

export default async function (ok) {
  // ── smoothing ──
  const cf = { type: 'COLD', pts: [[45, -95], [41, -97], [37, -99], [33, -101]] };
  const g = smoothFront(cf);
  const hits = cf.pts.every(p => g.P.some(q => angle(q, toXYZ(p[0], p[1])) < 1e-6));
  ok('front layer: Catmull-Rom passes through every control point', hits);
  let maxStep = 0;
  for (let i = 1; i < g.P.length; i++) maxStep = Math.max(maxStep, angle(g.P[i - 1], g.P[i]));
  ok('front layer: smoothed points are at most stepDeg apart', maxStep <= DEFAULTS.stepDeg * D2R + 1e-9, (maxStep / D2R).toFixed(3));
  ok('front layer: smoothed points are on the unit sphere', g.P.every(p => Math.abs(Math.hypot(...p) - 1) < 1e-9));
  let maxTurn = 0;
  for (let i = 1; i + 1 < g.P.length; i++) {
    const a = sampleAt(g, g.cum[i] - 1e-4).tangent, b = sampleAt(g, g.cum[i] + 1e-4).tangent;
    maxTurn = Math.max(maxTurn, angle(a, b));
  }
  ok('front layer: no kinks (tangent turn < 3 deg per point)', maxTurn < 3 * D2R, (maxTurn / D2R).toFixed(2));

  // ── which side the symbols face ──
  const gc = frontGeometry(cf);
  const sideOK = (geo, kind, want) => geo.symbols.filter(s => s.kind === kind).every(s => {
    const [lat, lon] = s.latlon;
    return dot(s.facing, want(lat, lon)) > 0.9;
  });
  ok('front layer: cold front walked south has its triangles east (left)', gc.symbols.length > 0 && sideOK(gc, KIND.TRI, east));
  ok('front layer: cold triangle apex is east of its base', gc.symbols.every(s => s.apex[1] > s.latlon[1]), JSON.stringify(gc.symbols[0].apex));
  const wf = frontGeometry({ type: 'WARM', pts: [[38, -100], [38.5, -95], [38, -90]] });
  ok('front layer: warm front walked east has its semicircles north (left)', sideOK(wf, KIND.SEMI, north) && wf.symbols.every(s => s.kind === KIND.SEMI));
  const sf = frontGeometry({ type: 'STNRY', pts: [[37, -81], [38, -88], [40, -95]] });
  const sw = (lat, lon) => north(lat, lon).map(v => -v);
  ok('front layer: stationary walked west: triangles south (left)', sideOK(sf, KIND.TRI, sw));
  ok('front layer: stationary walked west: semicircles north (right)', sideOK(sf, KIND.SEMI, north));
  ok('front layer: stationary triangles are blue, semicircles red', sf.symbols.every(s => s.color === (s.kind === KIND.TRI ? STYLES.COLD.color : STYLES.WARM.color)));
  const of = frontGeometry({ type: 'OCFNT', pts: [[50, -98], [51, -97], [50, -95], [48, -94]] });
  const oSides = new Set(of.symbols.map(s => s.side)), oKinds = of.symbols.map(s => s.kind);
  ok('front layer: occluded symbols all on the left, triangle and semicircle in turn', oSides.size === 1 && oSides.has(1) && oKinds.every((k, i) => k === (i % 2 ? KIND.SEMI : KIND.TRI)));
  ok('front layer: trough and squall line have no symbols', frontGeometry({ type: 'TROF', pts: [[30, -100], [35, -100]] }).symbols.length === 0 && frontGeometry({ type: 'SQLN', pts: [[30, -100], [35, -100]] }).symbols.length === 0);
  ok('front layer: trough line is dashed, stationary line alternates', STYLES.TROF.line === KIND.DASH && STYLES.STNRY.line === KIND.STATIONARY);

  // ── the sample data: cold fronts move toward their triangles ──
  const set = await loadFrontsSample();
  const seq = [set.analysis, ...set.forecasts];
  let toward = 0, total = 0;
  for (let k = 0; k + 1 < seq.length; k++) {
    const A = seq[k], B = seq[k + 1];
    for (const f of A.fronts.filter(x => x.type === 'COLD')) {
      const geo = frontGeometry(f);
      if (!geo) continue;
      const bp = B.fronts.filter(x => x.type === 'COLD').flatMap(x => smoothFront(x)?.P || []);
      for (const s of geo.symbols) {
        let best = null, bd = Infinity;
        for (const q of bp) { const d = angle(q, s.p); if (d < bd) { bd = d; best = q; } }
        if (!best || bd > 6 * D2R || bd < 0.2 * D2R) continue;
        total++;
        if (dot(best.map((v, i) => v - s.p[i]), s.facing) > 0) toward++;
      }
    }
  }
  ok('front layer: sample cold fronts move toward the triangle side (left of point order)', total > 20 && toward / total > 0.75, `${toward}/${total}`);
  let built = 0, bad = 0;
  for (const s of seq) for (const f of s.fronts) { const geo = frontGeometry(f); if (geo && geo.line.P.every(p => finite(p))) built++; else bad++; }
  ok('front layer: every sample front builds finite geometry', bad === 0 && built > 50, `${built} built, ${bad} bad`);
  ok('front layer: every sample front type has a style', seq.every(s => s.fronts.every(f => STYLES[f.type])));

  // ── screen spacing of symbols ──
  const long = frontGeometry({ type: 'COLD', pts: [[50, -90], [45, -95], [40, -100], [35, -103], [30, -105]] });
  const d0 = long.d0;
  let spacingOK = true, nestOK = true, detail = '';
  let prev = null;
  for (const needDeg of [0.05, 0.2, 0.7, 1.5, 3, 6, 12]) {
    const need = needDeg * D2R;
    const vis = long.symbols.filter(s => unitAlpha(s.unitRad, need) >= 1).map(s => s.s).sort((a, b) => a - b);
    for (let i = 1; i < vis.length; i++) {
      const gap = vis[i] - vis[i - 1];
      if (gap < Math.min(need, d0) - 1e-9 || (need > d0 && gap > 2 * need + 1e-9)) { spacingOK = false; detail = `need ${needDeg} gap ${(gap / D2R).toFixed(3)}`; }
    }
    if (prev && !vis.every(s => prev.some(p => Math.abs(p - s) < 1e-9))) nestOK = false;
    prev = vis;
  }
  ok('front layer: visible symbols are spaced between 1x and 2x the screen spacing', spacingOK, detail || `d0 ${(d0 / D2R).toFixed(3)} deg`);
  ok('front layer: a coarser level is a subset of the finer one (no sliding symbols)', nestOK);
  ok('front layer: unitAlpha is 1 at the spacing, 0.5 at 3/4, 0 at 1/2', unitAlpha(1, 1) === 1 && Math.abs(unitAlpha(0.75 * 2, 2) - 0.585) < 0.01 && unitAlpha(1, 2) === 0);
  const shader = read('shaders/fronts.wgsl');
  ok('front layer: the shader uses the same level fade as unitAlpha', /clamp\(log2\(i\.nb\.w \/ need\) \+ 1\.0, 0\.0, 1\.0\)/.test(shader));
  const mids = long.symbols.filter(s => s.level === MID_LEVEL);
  ok('front layer: one mid unit at the middle that always shows', mids.length === 1 && Math.abs(mids[0].f - 0.5) < 1e-9 && unitAlpha(mids[0].unitRad, 10) === 1);
  const sym = long.symbols.map(s => s.s - long.length / 2).sort((a, b) => a - b);
  ok('front layer: units are symmetric about the middle', sym.every((v, i) => Math.abs(v + sym[sym.length - 1 - i]) < 1e-9));
  ok('front layer: units stay inside the line', long.symbols.every(s => s.s > 0 && s.s < long.length && s.edge > 0));
  const counts = [0.05, 0.3, 1, 5].map(L => frontUnits(L * 1, false).length);
  ok('front layer: unit count is bounded (<= 2 * 128 + 1)', counts.every(c => c <= 257), counts.join(','));

  // ── short fronts ──
  const short = frontGeometry({ type: 'WARM', pts: [[40, -90], [40, -89.95]] });
  ok('front layer: a short front builds', !!short && short.length > 0 && short.length < 0.1 * D2R, short && (short.length / D2R).toFixed(3));
  ok('front layer: a short front has exactly the mid symbol', short.symbols.length === 1 && short.symbols[0].level === MID_LEVEL && short.symbols[0].edge === BIG);
  ok('front layer: a 1-point front is skipped', frontGeometry({ type: 'COLD', pts: [[40, -90]] }) === null && frontGeometry({ type: 'COLD', pts: [[40, -90], [40, -90]] }) === null);

  // ── closed fronts ──
  const ring = [];
  for (let i = 0; i <= 12; i++) { const a = i / 12 * 2 * Math.PI; ring.push([40 + 3 * Math.sin(a), -100 + 4 * Math.cos(a)]); }
  const cg = frontGeometry({ type: 'OCFNT', pts: ring });
  ok('front layer: a ring (first point = last) is closed', cg.closed && angle(cg.line.P[0], cg.line.P[cg.line.P.length - 1]) < 1e-12);
  const seam = angle(sampleAt(cg.line, cg.length - 1e-4).tangent, sampleAt(cg.line, 1e-4).tangent);
  ok('front layer: the closed ring is smooth across the seam', seam < 3 * D2R, (seam / D2R).toFixed(2));
  ok('front layer: a closed ring has no ends (no edge fade)', cg.symbols.every(s => s.edge === BIG));
  const firstS = Math.min(...cg.symbols.map(s => s.s)), lastS = Math.max(...cg.symbols.map(s => s.s));
  ok('front layer: closed ring symbols go round the whole ring', firstS < cg.d0 * 1.01 && cg.length - lastS < cg.d0 * 1.01, `${firstS.toFixed(4)} ${(cg.length - lastS).toFixed(4)} d0 ${cg.d0.toFixed(4)}`);
  const turnSign = cg.symbols.slice(0, 6).map(s => Math.sign(dot(s.facing, toXYZ(40, -100).map((v, i) => v - s.p[i]))));
  ok('front layer: counter-clockwise ring has its symbols facing inward (left)', turnSign.every(v => v > 0));
  const cn = cg.line.N[0], cnEnd = cg.line.N[cg.line.N.length - 1];
  ok('front layer: closed ring joins with one miter at the seam', angle(cn, cnEnd) < 1e-6);

  // ── antimeridian ──
  const am = frontGeometry({ type: 'COLD', pts: [[52, 175], [51, 179], [50, -177], [49, -173]] });
  ok('front layer: a front across 180 has its short length', am && am.length < 10 * D2R && am.length > 6 * D2R, am && (am.length / D2R).toFixed(2));
  ok('front layer: across 180 every point stays near the dateline', am.latlon.every(([, lon]) => Math.abs(lon) > 172));
  let amTurn = 0;
  for (let i = 1; i + 1 < am.line.P.length; i++) amTurn = Math.max(amTurn, angle(sampleAt(am.line, am.line.cum[i] - 1e-4).tangent, sampleAt(am.line, am.line.cum[i] + 1e-4).tangent));
  ok('front layer: across 180 the line has no kink', amTurn < 3 * D2R, (amTurn / D2R).toFixed(2));
  ok('front layer: walked east across 180 the triangles face north (left of walk)', am.symbols.length > 0 && am.symbols.every(s => dot(s.facing, north(...s.latlon)) > 0.9 && s.apex[0] > s.latlon[0]));
  const bulletin180 = frontGeometry({ type: 'WARM', pts: [[55, 180], [55, -180], [54, -175]] });
  ok('front layer: lon 180 and -180 count as one point', bulletin180 && bulletin180.length < 4 * D2R);

  // ── morph pairing ──
  const A = { valid: 0, fronts: [cf, { type: 'WARM', pts: [[38, -100], [38.5, -95], [38, -90]] }, { type: 'TROF', pts: [[30, -110], [33, -112]] }] };
  const shift = f => ({ ...f, pts: f.pts.map(([la, lo]) => [la, lo + 2]) });
  const B = { valid: 1, fronts: [shift(A.fronts[1]), shift(A.fronts[0]), { type: 'COLD', pts: [[30, -70], [25, -72]] }] };
  const m = matchFronts(A, B);
  ok('front layer: matchFronts pairs moved fronts by type', m.pairs.length === 2 && m.pairs.some(([i, j]) => i === 0 && j === 1) && m.pairs.some(([i, j]) => i === 1 && j === 0), JSON.stringify(m.pairs.map(p => p.slice(0, 2))));
  ok('front layer: unmatched fronts fade (trough out, far cold front in)', m.aOnly.join() === '2' && m.bOnly.join() === '2');
  const mSame = matchFronts(A, A);
  ok('front layer: a set matches itself at distance 0', mSame.pairs.length === 3 && mSame.pairs.every(([i, j, c]) => i === j && c < 1e-9));
  const buf = buildFrontBuffers(A, B);
  ok('front layer: morph buffers are finite', finite(buf.line) && finite(buf.sym));
  ok('front layer: line vertex and symbol instance sizes', buf.line.length === buf.lineVerts * LINE_FLOATS && buf.sym.length === buf.nSym * SYM_FLOATS);
  ok('front layer: index buffer is in range', buf.index.every(i => i < buf.lineVerts) && buf.nIndex % 6 === 0);
  const pres = new Set();
  for (let i = 0; i < buf.lineVerts; i++) pres.add(buf.line[i * LINE_FLOATS + 22]);
  ok('front layer: presence codes both, A only, B only', pres.has(PRES.BOTH) && pres.has(PRES.A) && pres.has(PRES.B));
  ok('front layer: morph stats', buf.pairs === 2 && buf.fadeOut === 1 && buf.fadeIn === 1);
  const st = buildFrontBuffers(A);
  let same = true;
  for (let i = 0; i < st.lineVerts; i++) for (let c = 0; c < 3; c++) if (st.line[i * LINE_FLOATS + c] !== st.line[i * LINE_FLOATS + 4 + c]) same = false;
  ok('front layer: a static set has state A = state B', same && st.pairs === 3);
  const full = buildFrontBuffers(set.analysis, set.forecasts[0]);
  ok('front layer: sample analysis to 12 h morph builds', full.pairs > 3 && finite(full.line) && finite(full.sym), `pairs ${full.pairs}, out ${full.fadeOut}, in ${full.fadeIn}, ${full.lineVerts} verts, ${full.nSym} symbols, ${((full.line.byteLength + full.sym.byteLength + full.index.byteLength) / 1024).toFixed(0)} KB`);
  ok('front layer: sample buffers stay small (< 4 MB)', full.line.byteLength + full.sym.byteLength + full.index.byteLength < 4 << 20);

  // ── brackets ──
  const mid = (set.analysis.valid + set.forecasts[0].valid) / 2;
  const br = bracketOf(set, mid), fb = frontsBracket(set, mid);
  ok('front layer: bracketOf follows frontsBracket', br.a === fb.a && br.b === fb.b && Math.abs(br.u - 0.5) < 1e-9);
  const one = bracketOf(set.analysis, 0);
  ok('front layer: one parsed set is a static bracket', one.a === set.analysis && one.b === set.analysis && one.u === 0);

  // ── uniform and shader ──
  const U = packFrontU({ u: 0.25, reveal: 0.5, alpha: 1 });
  ok('front layer: FrontU is 16 floats (64 bytes)', U.length === FRONT_U_FLOATS && U[0] === 0.25 && U[1] === 0.5 && U[4] === DEFAULTS.symbolPx);
  ok('front layer: shader shell radius matches FRONT_R', new RegExp(`const FX_R: f32 = ${FRONT_R.toString().replace('.', '\\.')};`).test(shader));
  ok('front layer: FrontU has 4 vec4 fields', (shader.match(/struct FrontU \{([\s\S]*?)\}/)[1].match(/vec4f/g) || []).length === 4);
  ok('front layer: 6 vertex attributes per input struct', ['LineIn', 'SymIn'].every(n => (shader.match(new RegExp(`struct ${n} \\{([\\s\\S]*?)\\n\\}`))[1].match(/@location/g) || []).length === 6) && LINE_FLOATS === 24 && SYM_FLOATS === 24);
  ok('front layer: entry points', ['vsLine', 'vsSym', 'fsLineHalo', 'fsLineCore', 'fsSymHalo', 'fsSymCore'].every(e => new RegExp(`fn ${e}\\(`).test(shader)));
  const frame = read('shaders/frame.wgsl');
  const code = shader.replace(/\/\/.*$/gm, '');
  const frameNames = [...frame.matchAll(/^fn (\w+)/gm)].map(x => x[1]);
  ok('front layer: shader does not redefine frame.wgsl names or PI', frameNames.every(n => !new RegExp(`^fn ${n}\\b`, 'm').test(code)) && !/\bconst PI\b/.test(code) && !/struct Frame\b/.test(code) && !/var<uniform> F\b/.test(code));
  const badLines = shader.split('\n').map((l, i) => [l.replace(/\/\/.*$/, ''), i + 1]).filter(([l]) => (l.includes('&&') && l.includes('||')) || (/\^/.test(l) && /\*/.test(l)));
  ok('front layer: fronts.wgsl has no mixed operators for Tint', !badLines.length, badLines.map(b => b[1]).join(','));
  const naga = join(homedir(), '.cargo/bin/naga');
  if (!existsSync(naga)) ok('front layer: naga (missing, not checked)', true);
  else {
    const fp = join(mkdtempSync(join(tmpdir(), 'wx-fronts-')), 'fronts-module.wgsl');
    writeFileSync(fp, frame + '\n' + shader);
    let msg = '';
    try { execFileSync(naga, [fp], { stdio: 'pipe' }); } catch (e) { msg = String(e.stderr || e.message).slice(0, 600); }
    ok('front layer: naga validates frame.wgsl + fronts.wgsl', !msg, msg);
  }
  ok('front layer: legend lists every style', frontLegend().length === Object.keys(STYLES).length);
  ok('front layer: unitBase has a floor of 0.001 rad', unitBase(0.01) === 0.001 && unitBase(1) === 1 / 256);
}
