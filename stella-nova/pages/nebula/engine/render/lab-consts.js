// lab-consts.js: the lab and hot-source values of the compositor (LAB-LOG parts 3-5), as one table.
// The values come only from the composition (js/data/composition.js) and the page query, so they do not
// change while the page runs. compositorSource writes them into the shader as "const" declarations. The
// compiler can then fold the switched-off paths (for example the WR crescent and the outflow cone, gain 0)
// and the loops over the hot sources. The math is the same: each literal holds the float32 value exactly.
//
// Exports (grep -n "^export"):
//   labConsts(comp, search, off?) -> { name: number[] }   uniform name -> vec4 values (16 vec4 for _Hot)
//   LAB_EFFECTS                                      [key, label, uniform, slot] of each lab effect switch
//   labOffFrom(search) -> [keys]                     the effects that ?off= turns off at load
//   (off: a set or array of LAB_EFFECTS keys; each one writes 0 to its slot.)
//   LAB_CONST_DECLS                                  the uniform names that the specialized source replaces
//   constDecl(name, values) -> string                one GLSL "const vec4" declaration
//
// The query keys are the same as before: ?hotgain= ?clu= ?sat= ?ripple= ?erode= ?erode2= ?cirrus= ?wr=
// ?cone= ?cirj= ?bodyop= ?tint= ?acc= ?r3= ?r4= ?proto=.

export const LAB_CONST_DECLS = ['_Hot', '_HotOn', '_LabStars', '_LabErode', '_LabErode2', '_LabCirrus', '_LabMisc',
  '_LabTint', '_LabAcc', '_LabR3', '_LabR4', '_Proto', '_ProtoOn'];
// _LabZ is not here: it follows the palette (lab-zones.js), and the palette changes while the page runs.

// The effect switches of the dock (ui/dock.js). Each one writes 0 to one slot of one value.
export const LAB_EFFECTS = [
  ['erode', 'Erosion', '_LabErode', 0],
  ['cirrus', 'Cirrus veils', '_LabCirrus', 0],
  ['tint', 'Ionization colour', '_LabTint', 0],
  ['cavity', 'Cavity glow', '_HotOn', 2],
  ['knots', 'Knots', '_LabAcc', 1],
  ['rims', 'Warm rims', '_LabR3', 0],
  ['fibres', 'Dust fibres', '_LabR4', 0],
  ['cluster', 'Cluster stars', '_LabStars', 0],
];

// ?off=key,key: the lab effects that start off (LAB_EFFECTS keys; unknown keys are ignored), sorted.
export function labOffFrom(search) {
  const m = /[?&]off=([a-z,]+)/.exec(search || '');
  const keys = new Set(LAB_EFFECTS.map((e) => e[0]));
  return m ? [...new Set(m[1].split(',').filter((k) => keys.has(k)))].sort() : [];
}

export function labConsts(comp, search, off) {
  const qs = search || '';
  const qn = (k, d) => { const m = new RegExp('[?&]' + k + '=([0-9.e,-]+)').exec(qs); return m ? m[1].split(',').map(Number) : d; };
  const hot = comp.sources.filter((s) => s.qMode !== 'none' && (s.teffK || 0) >= 20000).slice(0, 8);
  const H = new Array(64).fill(0);
  hot.forEach((s, k) => {
    [s.pos[0], s.pos[1], (1.1625 - s.pos[2]) * 3200, Math.pow(10, (s.logL || 4) - 6.2)].forEach((v, i) => { H[8 * k + i] = v; });
    [s.teffK, s.kind === 'DistantCluster' ? 400 : 40, 0, 0].forEach((v, i) => { H[8 * k + 4 + i] = v; });
  });
  const lab = comp.lab || {};
  const cl = qn('clu', lab.clusterStars || [0.12, 3.0]);
  const t = {
    _Hot: H,
    _HotOn: [hot.length, lab.hotFloor ?? 0.0012, qn('hotgain', [lab.hotGain ?? 60])[0], 0],
    _LabStars: [cl[0], cl[1], qn('sat', [lab.saturation ?? 1.3])[0], qn('ripple', [lab.ripple ?? 12])[0]],
    _LabErode: qn('erode', lab.erode || [1, 1.0, 0.7, 3.0]),
    _LabErode2: qn('erode2', lab.erode2 || [0.0015, 0.06, 320, 110]),
    _LabCirrus: qn('cirrus', lab.cirrus || [1, 0.012, 6, 45]),
    _LabMisc: [qn('wr', [0])[0], qn('cone', [0])[0], qn('cirj', [lab.cirrusJ ?? 0.3])[0], qn('bodyop', [lab.bodyOpacity ?? 3])[0]],
    _LabTint: qn('tint', lab.tint || [1, 1.0, -6.45, -5.65]),
    _LabAcc: qn('acc', lab.acc || [1, 1, 0.55, 1]),
    _LabR3: qn('r3', lab.r3 || [1, 0.8, 0.3, 1.5]),
    _LabR4: qn('r4', lab.r4 || [1.2, 100, 0.010, 18]),
  };
  // Cold filament section: lab.protostars = [[x, y, p, core gain, bubble R px, knot gain, bubble gain], ...],
  // lab.coldGlow = [refl, back, hub]. ?proto=refl,back,hub (0,0,0 turns the section layers off).
  const PS = new Array(48).fill(0); const ps = (lab.protostars || []).slice(0, 6);
  ps.forEach((q, k) => {
    [q[0], q[1], (1.1625 - q[2]) * 3200, q[3]].forEach((v, i) => { PS[8 * k + i] = v; });
    [q[4], q[5], q[6] ?? 1, 0].forEach((v, i) => { PS[8 * k + 4 + i] = v; });
  });
  const cg = qn('proto', lab.coldGlow || [0, 0, 0]);
  t._Proto = PS;
  t._ProtoOn = [ps.length, cg[0], cg[1], cg[2]];
  const offSet = new Set(off || []);
  for (const [key, , name, slot] of LAB_EFFECTS) {
    if (!offSet.has(key)) continue;
    t[name] = t[name].slice(); t[name][slot] = 0;
  }
  return t;
}

// A float32 value as a GLSL literal that parses back to the same float32 (9 significant digits).
function lit(v) {
  const f = Math.fround(Number(v) || 0);
  let s = f.toPrecision(9);
  if (!/[.eE]/.test(s)) s += '.0';
  if (/[eE]/.test(s) && !/\./.test(s.split(/[eE]/)[0])) s = s.replace(/[eE]/, '.0e');
  return s;
}

export function constDecl(name, values) {
  const v = Array.from(values, lit);
  while (v.length % 4) v.push('0.0');
  const vecs = [];
  for (let i = 0; i < v.length; i += 4) vecs.push(`vec4(${v.slice(i, i + 4).join(', ')})`);
  return vecs.length === 1 ? `const vec4 ${name} = ${vecs[0]};` : `const vec4 ${name}[${vecs.length}] = vec4[${vecs.length}](${vecs.join(', ')});`;
}
