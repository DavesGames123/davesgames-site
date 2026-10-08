// style-night (G1): the pure helpers, and create/update/dispose against a
// stub THREE (no GPU). The coast file is the real storm-globe 50m data.
import { readFileSync } from 'node:fs';
import { decodeCoast } from '../../storm-globe/coast.js';
import night, { toSphere, coastSegments, starField, worldPrevalence, tintFor, approach, COAST_R, COAST_URL } from '../render/style-night.js';
import { SHADERS as NIGHT_SHADERS } from '../render/style-night.js';

// a stub THREE: counts what was made and what was disposed
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
      Group: Obj, Mesh, Points: Mesh, LineSegments: Mesh, BufferGeometry,
      SphereGeometry: class extends BufferGeometry {},
      ShaderMaterial: class extends Disp { constructor(o) { super(); Object.assign(this, o); } },
      DataTexture: class extends Disp { constructor(d, w, h) { super(); this.image = { data: d, width: w, height: h }; } },
      BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
      Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
      Color: class { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } },
      BackSide: 1, AdditiveBlending: 2,
    },
  };
}

export default async function (ok) {
  ok('style-night: calm, no pulse, no breathing, no coast halo', !/sin\(uTime|landAt\(d \*/.test(Object.values(NIGHT_SHADERS).flat().join('\n')));
  // axes: the contract's globe convention
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  ok('style-night: toSphere (0,0) = +x', near(toSphere(0, 0), [1, 0, 0]));
  ok('style-night: toSphere (0,90) = -z', near(toSphere(0, 90), [0, 0, -1]));
  ok('style-night: toSphere (90,0) = +y', near(toSphere(90, 0), [0, 1, 0]));

  // coast segments from the real file
  const rings = decodeCoast(readFileSync(new URL(COAST_URL)));
  const seg = coastSegments(rings);
  let rOk = true, maxLen = 0, artefact = 0;
  for (let i = 0; i < seg.pos.length; i += 3) {
    const r = Math.hypot(seg.pos[i], seg.pos[i + 1], seg.pos[i + 2]);
    if (Math.abs(r - COAST_R) > 1e-5) rOk = false;
    if (seg.pos[i + 1] / r < -Math.sin(89.9 * Math.PI / 180) - 1e-7) artefact++;
  }
  for (let s = 0; s < seg.n; s++) {
    const o = s * 6;
    maxLen = Math.max(maxLen, Math.hypot(seg.pos[o] - seg.pos[o + 3], seg.pos[o + 1] - seg.pos[o + 4], seg.pos[o + 2] - seg.pos[o + 5]));
  }
  ok('style-night: coast segments exist', seg.n > 20000 && seg.n < 400000, `${seg.n} segments from ${rings.length} rings`);
  ok('style-night: coast points sit on the coast radius', rOk);
  ok('style-night: no coast chord longer than 1.5 deg', maxLen <= 1.5 * Math.PI / 180 * COAST_R + 1e-6, `max ${(maxLen * 180 / Math.PI).toFixed(3)} deg`);
  ok('style-night: no pole-closing artefact', artefact === 0, `${artefact}`);
  ok('style-night: lakes at half brightness', seg.bright.includes(0.5) && seg.bright.includes(1));
  const cut = coastSegments([{ kind: 0, pts: new Float32Array([180, 10, 180, 20, -180, 30]) }, { kind: 0, pts: new Float32Array([-10, -89.95, 10, -89.95]) }]);
  ok('style-night: antimeridian and pole cut edges dropped', cut.n === 0, `${cut.n}`);
  const wrap = coastSegments([{ kind: 0, pts: new Float32Array([179.5, 0, -179.5, 0]) }]);
  ok('style-night: a segment across 180 takes the short way', wrap.n === 1, `${wrap.n} parts`);

  // stars
  const a = starField(300, 9), b = starField(300, 9);
  let unit = true;
  for (let i = 0; i < 300; i++) if (Math.abs(Math.hypot(a.dir[i * 3], a.dir[i * 3 + 1], a.dir[i * 3 + 2]) - 1) > 1e-6) unit = false;
  ok('style-night: stars on the unit sphere', unit);
  ok('style-night: stars deterministic per seed', a.dir.join() === b.dir.join() && a.size.join() === b.size.join());

  // prevalence, tint, approach
  ok('style-night: no sim, prevalence 0', worldPrevalence(null, 100) === 0);
  ok('style-night: prevalence = sum I / pop', Math.abs(worldPrevalence({ I: new Float64Array([10, 30]) }, 1000) - 0.04) < 1e-12);
  ok('style-night: tint 0 below 1e-5, 1 at 5 %', tintFor(1e-6) === 0 && tintFor(0.05) === 1 && tintFor(0.5) === 1);
  ok('style-night: tint rises with prevalence', tintFor(1e-4) < tintFor(1e-3) && tintFor(1e-3) < tintFor(1e-2));
  const s1 = approach(approach(0, 1, 0.5), 1, 0.5), s2 = approach(0, 1, 1);
  ok('style-night: approach is frame-rate independent', Math.abs(s1 - s2) < 1e-12);
  ok('style-night: approach with dt 0 holds', approach(0.3, 1, 0) === 0.3);

  // create / update / dispose with a stub THREE and a stub fetch
  const st = stubThree(), root = new st.T.Group();
  const landMask = new st.T.DataTexture(new Uint8Array(4), 1024, 512), fieldTex = new st.T.DataTexture(new Uint8Array(4), 512, 256);
  const fieldOwned = new Set([landMask, fieldTex]);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => readFileSync(new URL(String(url))).buffer.slice(0) });
  try {
    ok('style-night: id night, globe mode', night.id === 'night' && night.mode === 'globe' && typeof night.label === 'string');
    const D = { nodes: [{ pop: 600 }, { pop: 400 }] };
    const s = night.create({ THREE: st.T, root, D, field: { texture: fieldTex, landMask }, renderer: { getPixelRatio: () => 2 } });
    await s.coastReady;
    ok('style-night: group added to root', root.children.includes(s.group));
    ok('style-night: globe, atmosphere, stars and coast in the group', s.group.children.length === 4, `${s.group.children.map(c => c.name).join(',')}`);
    const globe = s.group.children.find(c => c.name === 'night-globe');
    ok('style-night: globe reads the field textures', globe.material.uniforms.uField.value === fieldTex && globe.material.uniforms.uLand.value === landMask);
    ok('style-night: land texel from the mask size', Math.abs(globe.material.uniforms.uTexel.value.x - 1 / 1024) < 1e-12);
    for (let k = 0; k < 60; k++) s.update({ t: k / 60, dt: 1 / 60, sim: { I: new Float64Array([50, 0]) }, prev: new Float32Array(2), events: [], mode: 'globe' });
    const tint = globe.material.uniforms.uTint.value;
    ok('style-night: tint moves toward the world prevalence', tint > 0 && tint < tintFor(0.05), tint.toFixed(3));
    s.update(null);
    s.dispose();
    const leaks = [...st.live].filter(o => !fieldOwned.has(o));
    ok('style-night: dispose releases every owned GPU object', leaks.length === 0, `${leaks.length} left of ${st.made.length - 2}`);
    ok('style-night: dispose leaves the field textures to F', st.live.has(landMask) && st.live.has(fieldTex));
    ok('style-night: dispose removes the group', !root.children.includes(s.group));
    s.dispose();
    ok('style-night: second dispose is safe', true);
    // no field (F absent): the style still builds and disposes
    const s0 = night.create({ THREE: st.T, root, D: null });
    s0.update({ t: 0, dt: 0.016, sim: null });
    await s0.coastReady; s0.dispose();
    ok('style-night: builds and disposes without a field', [...st.live].filter(o => !fieldOwned.has(o)).length === 0);
  } finally { globalThis.fetch = oldFetch; }
}
