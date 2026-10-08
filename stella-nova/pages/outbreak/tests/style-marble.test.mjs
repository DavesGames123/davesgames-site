// style-marble (G2): the sun helpers, and create/update/dispose against a
// stub THREE (no GPU).
import marble, { sunFrom, slerpDir, SUN_AZ, SUN_EL, COLOR_URL, LIGHTS_URL, SHADERS } from '../render/style-marble.js';
import { existsSync } from 'node:fs';

function stubThree() {
  const made = [], live = new Set();
  class Disp { constructor() { made.push(this); live.add(this); } dispose() { live.delete(this); } }
  class Obj { constructor() { this.children = []; this.parent = null; }
    add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); }
    remove(c) { this.children = this.children.filter(x => x !== c); c.parent = null; } }
  class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class BufferGeometry extends Disp { constructor() { super(); this.attributes = {}; } setAttribute(k, a) { this.attributes[k] = a; } }
  const loads = [];
  return {
    made, live, loads,
    T: {
      Group: Obj, Mesh, Points: Mesh, BufferGeometry,
      SphereGeometry: class extends BufferGeometry {},
      ShaderMaterial: class extends Disp { constructor(o) { super(); Object.assign(this, o); } },
      DataTexture: class extends Disp { constructor(d, w, h) { super(); this.image = { data: d, width: w, height: h }; } },
      Texture: Disp,
      TextureLoader: class { load(url, onLoad) { loads.push({ url, onLoad }); } },
      BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
      Vector3: class { constructor(x, y, z) { this.set(x, y, z); } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } },
      BackSide: 1, AdditiveBlending: 2,
    },
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);

export default function (ok) {
  // sun geometry
  const views = [[0, 0, 3], [2.2, 0.5, -1], [0.1, -3, 0.2], [0, 4, 0], [0, -2, 0]];
  let unit = true, angle = true;
  const want = Math.cos(SUN_AZ * Math.PI / 180) * Math.cos(SUN_EL * Math.PI / 180);
  for (const v of views) {
    const s = sunFrom(v), vn = v.map(x => x / len(v));
    if (!(Math.abs(len(s) - 1) < 1e-12)) unit = false;
    if (!(Math.abs(dot(s, vn) - want) < 1e-9)) angle = false;
  }
  ok('style-marble: sun is a unit vector, also for a camera over a pole', unit);
  ok('style-marble: sun sits at the set angle from the view', angle, `cos ${want.toFixed(4)}`);
  const s0 = sunFrom([0, 0, 1]);       // view at lon -90; east of it is lon 0 (+x)
  ok('style-marble: sun is east of the view and above it', s0[0] > 0 && s0[1] > 0, s0.map(x => x.toFixed(3)).join(','));
  ok('style-marble: sun of a null camera is finite', sunFrom(null).every(Number.isFinite));

  // easing
  const a = [1, 0, 0], b = [0, 1, 0];
  const e1 = slerpDir(slerpDir(a, b, 0.25), b, 0.25), e2 = slerpDir(a, b, 0.5);
  ok('style-marble: sun easing composes over frame steps', Math.abs(dot(e1, e2) - 1) < 1e-3, dot(e1, e2).toFixed(6));
  ok('style-marble: sun easing with dt 0 holds', slerpDir(a, b, 0).join() === a.join());
  ok('style-marble: sun easing reaches the target', dot(slerpDir(a, b, 30), b) > 0.9999);
  ok('style-marble: opposite target gives a unit vector', Math.abs(len(slerpDir([1, 0, 0], [-1, 0, 0], 1e9)) - 1) < 1e-9);

  // data paths and shaders
  ok('style-marble: Blue Marble and lights files exist', existsSync(COLOR_URL) && existsSync(LIGHTS_URL));
  ok('style-marble: three shader pairs', Object.keys(SHADERS).length === 3 && Object.values(SHADERS).every(p => p.length === 2 && p.every(s => /void main\(\)/.test(s))));

  // create / update / dispose
  const st = stubThree(), root = new st.T.Group();
  const landMask = new st.T.DataTexture(new Uint8Array(4), 1024, 512), fieldTex = new st.T.DataTexture(new Uint8Array(4), 512, 256);
  const fieldOwned = new Set([landMask, fieldTex]);
  ok('style-marble: id marble, globe mode', marble.id === 'marble' && marble.mode === 'globe' && marble.label === 'Marble');
  const camera = { position: { x: 0, y: 0, z: 3 } };
  const s = marble.create({ THREE: st.T, root, D: { nodes: [{ pop: 600 }, { pop: 400 }] }, field: { texture: fieldTex, landMask }, camera, renderer: { getPixelRatio: () => 2 } });
  ok('style-marble: group added to root', root.children.includes(s.group));
  ok('style-marble: globe, atmosphere and stars in the group', s.group.children.length === 3, s.group.children.map(c => c.name).join(','));
  const globe = s.group.children.find(c => c.name === 'marble-globe');
  ok('style-marble: globe reads the field textures', globe.material.uniforms.uField.value === fieldTex && globe.material.uniforms.uLand.value === landMask);
  ok('style-marble: two textures requested', st.loads.length === 2);
  const dayTex = new st.T.Texture(); st.loads[0].onLoad(dayTex);
  ok('style-marble: Blue Marble load sets the day texture', globe.material.uniforms.uDay.value === dayTex && globe.material.uniforms.uHasDay.value === 1);

  // move the camera; the sun follows without a snap
  camera.position = { x: 3, y: 0, z: 0 };
  const before = s.sun;
  s.update({ t: 0, dt: 1 / 60, sim: { I: new Float64Array([50, 0]) } });
  const step = s.sun;
  ok('style-marble: sun does not snap on a camera cut', dot(before, step) > 0.99, dot(before, step).toFixed(5));
  for (let k = 0; k < 600; k++) s.update({ t: k / 60, dt: 1 / 60, sim: { I: new Float64Array([50, 0]) } });
  ok('style-marble: sun settles at the new view', dot(s.sun, sunFrom([3, 0, 0])) > 0.9999);
  const u = globe.material.uniforms.uSun.value;
  ok('style-marble: sun uniform follows', Math.abs(u.x - s.sun[0]) < 1e-12 && Math.abs(u.y - s.sun[1]) < 1e-12);
  ok('style-marble: tint rises with prevalence', globe.material.uniforms.uTint.value > 0);
  s.update(null);
  s.dispose();
  const late = new st.T.Texture(); st.loads[1].onLoad(late);
  ok('style-marble: a late texture after dispose is released', !st.live.has(late));
  const leaks = [...st.live].filter(o => !fieldOwned.has(o));
  ok('style-marble: dispose releases every owned GPU object', leaks.length === 0, `${leaks.length} left`);
  ok('style-marble: dispose leaves the field textures to F', st.live.has(landMask) && st.live.has(fieldTex));
  ok('style-marble: dispose removes the group', !root.children.includes(s.group));
  s.dispose();
  const s2 = marble.create({ THREE: st.T, root, D: null });
  s2.update({ t: 0, dt: 0.016, sim: null }); s2.dispose();
  ok('style-marble: builds and disposes without field or camera', [...st.live].filter(o => !fieldOwned.has(o)).length === 0);
}
