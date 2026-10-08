// style-dots (G3): the pure helpers, the land dot count on the real land
// mask, and create/update/dispose against a stub THREE (no GPU).
import { readFileSync } from 'node:fs';
import dots, { fibSphere, dotSpacing, pointScale, landAt, dotColor, SHADERS, FIB_N, DOT_R, BASE_R, ATMOS_R } from '../render/style-dots.js';
import { rasterLand, MASK_W, MASK_H } from '../render/field.js';

function stubThree() {
  const made = [], live = new Set();
  class Disp { constructor() { made.push(this); live.add(this); } dispose() { live.delete(this); } }
  class Obj { constructor() { this.children = []; this.parent = null; }
    add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); }
    remove(c) { this.children = this.children.filter(x => x !== c); c.parent = null; } }
  class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class BufferGeometry extends Disp { constructor() { super(); this.attributes = {}; } setAttribute(k, a) { this.attributes[k] = a; } }
  return {
    made, live,
    T: {
      Group: Obj, Mesh, Points: Mesh, BufferGeometry,
      SphereGeometry: class extends BufferGeometry { constructor(r) { super(); this.r = r; } },
      ShaderMaterial: class extends Disp { constructor(o) { super(); Object.assign(this, o); } },
      DataTexture: class extends Disp { constructor(d, w, h) { super(); this.image = { data: d, width: w, height: h }; } },
      BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
      BackSide: 1, AdditiveBlending: 2,
    },
  };
}

export default function (ok) {
  // Fibonacci lattice
  const f = fibSphere(FIB_N, DOT_R);
  let onR = true, uvOk = true, minY = 1;
  for (let i = 0; i < f.n; i++) {
    const x = f.pos[i * 3], y = f.pos[i * 3 + 1], z = f.pos[i * 3 + 2];
    if (Math.abs(Math.hypot(x, y, z) - DOT_R) > 1e-5) onR = false;
    const lat = Math.asin(y / DOT_R) * 180 / Math.PI, lon = Math.atan2(-z, x) * 180 / Math.PI;
    const u = (lon + 180) / 360, v = (lat + 90) / 180;
    if (Math.abs(f.uv[i * 2 + 1] - v) > 1e-4 || Math.min(Math.abs(f.uv[i * 2] - u), 1 - Math.abs(f.uv[i * 2] - u)) > 1e-4) uvOk = false;
    minY = Math.min(minY, 1 - Math.abs(y / DOT_R));
  }
  ok('style-dots: every dot on the dot radius', onR);
  ok('style-dots: uv matches the contract axes (u = (lon+180)/360, v = (lat+90)/180)', uvOk);
  ok('style-dots: no dot sits on a pole', minY > 0);
  // equal area: each latitude band of equal height holds the same count
  const bands = new Array(10).fill(0);
  for (let i = 0; i < f.n; i++) bands[Math.min(9, Math.floor((f.pos[i * 3 + 1] / DOT_R + 1) * 5))]++;
  ok('style-dots: equal-area lattice (10 bands within 0.5 %)', bands.every(b => Math.abs(b - f.n / 10) <= f.n / 10 * 0.005), bands.join(','));

  // land dots on the real Natural Earth mask
  const world = JSON.parse(readFileSync(new URL('../../map-projections/data/world.json', import.meta.url)));
  const mask = rasterLand(world.land, MASK_W, MASK_H);
  let land = 0;
  for (let i = 0; i < f.n; i++) if (landAt(mask, MASK_W, MASK_H, f.uv[i * 2], f.uv[i * 2 + 1])) land++;
  ok('style-dots: about 20k land dots (17k..24k)', land >= 17000 && land <= 24000, `${land} of ${f.n}`);
  ok('style-dots: landAt clamps uv at the edges', landAt(mask, MASK_W, MASK_H, 1, 1) === (mask[MASK_W * MASK_H - 1] > 0) && landAt(mask, MASK_W, MASK_H, -0.1, -0.1) === (mask[0] > 0));

  // sizes
  const sp = dotSpacing(FIB_N, DOT_R);
  ok('style-dots: dot spacing about 0.0134', Math.abs(sp - 0.0134) < 0.0005, sp.toFixed(5));
  const ps = pointScale(1000, 90);
  ok('style-dots: pointScale is H / (2 tan(fov/2))', Math.abs(ps - 500) < 1e-9, ps);
  const px = sp * 0.62 * pointScale(1440, 35) / 2.2;
  ok('style-dots: land dot at the default view is 1..14 px', px >= 1 && px <= 14, px.toFixed(2));

  // colour ramp
  const c0 = dotColor(0), c5 = dotColor(0.5), c1 = dotColor(1);
  ok('style-dots: calm land is teal (blue over red)', c0[2] > c0[0]);
  ok('style-dots: red rises with the glow', c0[0] < c5[0] && c5[0] <= c1[0] && c5[0] > c5[2]);
  const dd = dotColor(1, 1);
  ok('style-dots: deaths grey the colour', Math.abs(dd[0] - dd[2]) < Math.abs(c1[0] - c1[2]));
  ok('style-dots: colour clamps its inputs', dotColor(-1).join() === c0.join() && dotColor(5, 0).join() === c1.join());
  ok('style-dots: colour stays in 0..1', [c0, c5, c1, dd].every(c => c.every(x => x >= 0 && x <= 1)));

  // shader sources
  let bal = true;
  for (const [v, fr] of Object.values(SHADERS)) for (const s of [v, fr]) if ((s.match(/{/g) || []).length !== (s.match(/}/g) || []).length) bal = false;
  ok('style-dots: shader braces balance', bal);
  ok('style-dots: each fragment shader sets gl_FragColor', Object.values(SHADERS).every(([, fr]) => fr.includes('gl_FragColor')));
  ok('style-dots: dot shader reads the land mask and the field', /uLand/.test(SHADERS.dots[0]) && /uField/.test(SHADERS.dots[0]));

  // create / update / dispose
  const st = stubThree(), root = new st.T.Group();
  const landMask = new st.T.DataTexture(new Uint8Array(4), 1024, 512), fieldTex = new st.T.DataTexture(new Uint8Array(4), 512, 256);
  ok('style-dots: id dots, globe mode', dots.id === 'dots' && dots.mode === 'globe' && typeof dots.label === 'string');
  const D = { nodes: [{ pop: 600 }, { pop: 400 }] };
  const camera = { fov: 35 }, renderer = { domElement: { height: 1440 } };
  const s = dots.create({ THREE: st.T, root, D, camera, renderer, field: { texture: fieldTex, landMask } });
  ok('style-dots: group added to root', root.children.includes(s.group));
  const by = n => s.group.children.find(c => c.name === n);
  const pts = by('dots-points'), base = by('dots-base'), atm = by('dots-atmos');
  ok('style-dots: base, points and atmosphere in the group', pts && base && atm);
  ok('style-dots: radii base < dots < atmosphere', base.geometry.r === BASE_R && BASE_R < DOT_R && atm.geometry.r === ATMOS_R && ATMOS_R > DOT_R);
  ok('style-dots: points read the field textures', pts.material.uniforms.uField.value === fieldTex && pts.material.uniforms.uLand.value === landMask);
  ok('style-dots: points do not write depth, the base does', pts.material.depthWrite === false && base.material.depthWrite !== false);
  ok('style-dots: point attributes sized to FIB_N', pts.geometry.attributes.position.array.length === FIB_N * 3 && pts.geometry.attributes.aUv.array.length === FIB_N * 2 && pts.geometry.attributes.aPhase.array.length === FIB_N);
  for (let k = 0; k < 120; k++) s.update({ t: k / 60, dt: 1 / 60, sim: { I: new Float64Array([50, 0]) }, prev: new Float32Array(2), events: [], mode: 'globe' });
  ok('style-dots: uScale follows the buffer and the fov', Math.abs(pts.material.uniforms.uScale.value - pointScale(1440, 35)) < 1e-9);
  const h = base.material.uniforms.uHeat.value;
  ok('style-dots: rim heat rises with the world prevalence', h > 0 && h < 1, h.toFixed(3));
  ok('style-dots: time uniform live', pts.material.uniforms.uTime.value === 119 / 60);
  s.update(null);
  s.dispose();
  const leaks = [...st.live].filter(o => o !== landMask && o !== fieldTex);
  ok('style-dots: dispose releases every owned GPU object', leaks.length === 0, `${leaks.length} left of ${st.made.length - 2}`);
  ok('style-dots: dispose leaves the field textures to F', st.live.has(landMask) && st.live.has(fieldTex));
  ok('style-dots: dispose removes the group', !root.children.includes(s.group));
  s.dispose();

  // no field, no camera: still builds with stand-ins
  const st2 = stubThree();
  const s2 = dots.create({ THREE: st2.T, root: null, D: null });
  s2.update({ t: 0, dt: 0.016 });
  ok('style-dots: works without a field or camera', s2.group.children.length === 3);
  s2.dispose();
  ok('style-dots: no-field dispose releases all', st2.live.size === 0);
}
