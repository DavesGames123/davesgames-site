// tests/normals.test.mjs — the normals audit (node, no GPU, no browser).
// Run alone: node stella-nova/pages/dla-terrain/tests/normals.test.mjs
//
// Why (2026-10-18, the user): "make sure that all normals are
// appropriately flipped" and "i also notice that rock normals are
// inverted". What it checks:
//   1 every procedural stand-in (render/vegetation.js GEN through
//     fixWinding): the counter-clockwise face normal agrees with the
//     stored vertex normals (the bark pipeline culls back faces), no NaN or
//     zero normals, closed rocks point out
//   2 every CC0 model of assets/nature (each LOD): winding and normals
//     agree, no bad normals, closed rocks and boulders point out
//   3 the bark pipeline culls back faces with ccw front (the glTF rule)
//   4 shaders/ground.wgsl: the triplanar normal offset takes no sign(n)
//     (the uv is not mirrored), and fn hexNrm turns an OpenGL normal map
//     back the right way (a CPU twin against a known height field)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { standInLods, windingStats, fixWinding } from '../render/vegetation.js';
import { SPECIES } from '../render/scatter.js';
import { parseGLB } from '../../../lib/glb-lite.js';

const here = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
const ROOT = fileURLToPath(new URL('../../../assets/nature/', import.meta.url));
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`ok ${pass + fail} normals: ${name}`); }
  else { fail++; console.log(`not ok ${pass + fail} normals: ${name} ${extra}`); }
}

// 1 stand-ins
{
  let worst = 1, worstKey = '', bad = 0;
  for (const s of SPECIES) {
    const L = standInLods(s.key);
    L.forEach((parts, l) => { const w = windingStats(parts); bad += w.bad; if (w.agree < worst) { worst = w.agree; worstKey = s.key + ' L' + l; } });
  }
  ok(worst >= 0.999, `stand-ins: winding agrees with the normals (worst ${worst.toFixed(3)} ${worstKey})`);
  ok(bad === 0, `stand-ins: no NaN or zero normals (${bad})`);
  for (const k of ['rock', 'boulder', 'pebble']) {
    const w = windingStats(standInLods(k)[0]);
    ok(w.out > 0.95, `stand-in ${k}: the faces point out (${w.out.toFixed(3)})`);
  }
  // fixWinding turns a clockwise triangle
  const p = { n: 3, v: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0], i: [0, 1, 2] };
  ok(fixWinding([p]) === 1 && p.i.join() === '0,2,1', 'fixWinding turns a clockwise triangle to counter-clockwise');
}

// 2 the CC0 models
{
  const man = JSON.parse(readFileSync(ROOT + 'manifest.json', 'utf8'));
  let n = 0, worst = 1, worstId = '', bad = 0, rocksOut = 1, rockId = '';
  const report = [];
  for (const a of man.assets) {
    if (!a.lods) continue;
    for (let l = 0; l < a.lods.length; l++) {
      const f = ROOT + a.lods[l].file;
      if (!existsSync(f)) continue;
      const b = readFileSync(f);
      const sc = parseGLB(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      const parts = sc.meshes.map((m) => {
        const v = new Float32Array(m.vertexCount * 12);
        for (let i = 0; i < m.vertexCount; i++) {
          v.set([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]], i * 12);
          if (m.normals) v.set([m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]], i * 12 + 3);
        }
        return { n: m.vertexCount, v, i: m.indices, fol: m.material?.alphaMode === 'MASK' };
      });
      // double-sided materials: the loader fixes their winding (below)
      const solid = parts.filter((p, k) => !p.fol && !sc.meshes[k].material?.doubleSided);
      if (!solid.length) continue;
      const w = windingStats(solid);
      n++; bad += w.bad;
      if (w.agree < worst) { worst = w.agree; worstId = a.id + ' L' + l; }
      if ((a.kind === 'rock' || a.kind === 'boulder') && !/rocks_01|rock_0[79]/.test(a.id)) { if (w.out < rocksOut) { rocksOut = w.out; rockId = a.id + ' L' + l; } }
      if (l === 0) report.push(`${a.id} ${w.agree.toFixed(3)}`);
    }
  }
  console.log('# model LOD0 winding agreement: ' + report.join(', '));
  ok(n > 60, `models read: ${n} single-sided LODs`);
  ok(worst > 0.9, `models: winding agrees with the normals (worst ${worst.toFixed(3)} ${worstId})`);
  ok(bad === 0, `models: no NaN or zero normals (${bad})`);
  ok(rocksOut > 0.55, `closed rocks and boulders: the faces point out (worst ${rocksOut.toFixed(3)} ${rockId})`);
}

// 3 the bark pipeline
{
  const js = readFileSync(here('render/vegetation.js'), 'utf8');
  ok(/if \(!fol\) fixWinding\(\[p\]\);/.test(js), 'loadAssetProtos turns the solid asset triangles to agree with their normals');
  ok(/label: 'bark'[^\n]*cull: 'back'/.test(js), 'the bark pipeline culls back faces');
  ok(!/frontFace: 'cw'/.test(js), 'no clockwise front face (the glTF and stand-in winding is ccw)');
}

// 4 ground.wgsl normal maps
{
  const g = readFileSync(here('shaders/ground.wgsl'), 'utf8');
  ok(!/sign\(n\.[xz]\)/.test(g), 'triplanar normal offset: no sign(n.x) or sign(n.z) (the uv is not mirrored)');
  ok(/OpenGL normal \(\+y\)/.test(g), 'the ground sets are read as OpenGL normal maps');
  ok(/let r = vec2f\(\(x\.x \* m\.x\) - \(x\.y \* m\.y\), \(x\.y \* m\.x\) \+ \(x\.x \* m\.y\)\);/.test(g), 'fn hexNrm turns back with the transpose (OpenGL green)');
  // CPU twin: h(uv) = H(R uv + o); an OpenGL map of H stores r = -dH/du',
  // g = +dH/dv'. hexNrm must give r = -dh/du, g = +dh/dv.
  let err = 0;
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * 6.283, c = Math.cos(a), s = Math.sin(a);
    const gH = [Math.cos(k * 1.7), Math.sin(k * 2.3)];          // dH/du', dH/dv'
    const r = -gH[0], gg = gH[1];
    // h(u, v) = H(c u - s v, s u + c v): dh/du = c Hu + s Hv, dh/dv = -s Hu + c Hv
    const want = [-(c * gH[0] + s * gH[1]), -s * gH[0] + c * gH[1]];
    const got = [c * r - s * gg, s * r + c * gg];
    err = Math.max(err, Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]));
  }
  ok(err < 1e-9, `hexNrm twin matches the turned height gradient (max error ${err.toExponential(1)})`);
}

console.log(`# normals: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
