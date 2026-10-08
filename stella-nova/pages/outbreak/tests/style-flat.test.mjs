// style-flat (G4): the pure helpers, and create/setProj/update/dispose
// against a stub THREE (no GPU). The coast file is the real storm-globe data.
import { readFileSync } from 'node:fs';
import flatStyle, { mapGrid, projectLL, flatGraticule, flatOutline, flatCoast, normProj, SHADERS, LINE_Z } from '../render/style-flat.js';
import { flat } from '../geo.js';
import { decodeCoast } from '../../storm-globe/coast.js';

function stubThree() {
  const made = [], live = new Set();
  class Disp { constructor() { made.push(this); live.add(this); } dispose() { live.delete(this); } }
  class Obj { constructor() { this.children = []; this.parent = null; }
    add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); }
    remove(c) { this.children = this.children.filter(x => x !== c); c.parent = null; } }
  class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class BufferGeometry extends Disp { constructor() { super(); this.attributes = {}; } setAttribute(k, a) { this.attributes[k] = a; } setIndex(i) { this.index = i; } }
  return {
    made, live,
    T: {
      Group: Obj, Mesh, LineSegments: Mesh, BufferGeometry,
      ShaderMaterial: class extends Disp { constructor(o) { super(); Object.assign(this, o); } },
      DataTexture: class extends Disp { constructor(d, w, h) { super(); this.image = { data: d, width: w, height: h }; } },
      BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.needsUpdate = false; } },
      Vector2: class { constructor(x, y) { this.x = x; this.y = y; } },
      Color: class { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } },
      AdditiveBlending: 2,
    },
  };
}

const near = (a, b, e = 1e-5) => Math.abs(a - b) < e;

export default async function (ok) {
  ok('style-flat: normProj', normProj('equalearth') === 'equalearth' && normProj('x') === 'equirect' && normProj() === 'equirect');

  // mesh grid
  const g = mapGrid('equirect');
  const V = g.nx * g.ny;
  ok('style-flat: grid 181 x 91 vertices at 2 deg', g.nx === 181 && g.ny === 91 && g.pos.length === 3 * V && g.uv.length === 2 * V);
  let eqOk = true, uvOk = true;
  for (let k = 0; k < V; k++) {
    const lon = g.ll[2 * k], lat = g.ll[2 * k + 1];
    if (!near(g.pos[3 * k], lon / 90) || !near(g.pos[3 * k + 1], lat / 90) || g.pos[3 * k + 2] !== 0) eqOk = false;
    if (!near(g.uv[2 * k], (lon + 180) / 360) || !near(g.uv[2 * k + 1], (lat + 90) / 180)) uvOk = false;
  }
  ok('style-flat: equirect vertices at x = lon/90, y = lat/90, z = 0', eqOk);
  ok('style-flat: uv is equirectangular, row 0 south (field layout)', uvOk);
  let idxOk = g.index.length === (g.nx - 1) * (g.ny - 1) * 6, ccw = true;
  for (let t = 0; t < g.index.length; t += 3) {
    const [a, b, c] = [g.index[t], g.index[t + 1], g.index[t + 2]];
    if (a >= V || b >= V || c >= V) idxOk = false;
    const ax = g.pos[3 * a], ay = g.pos[3 * a + 1];
    const cr = (g.pos[3 * b] - ax) * (g.pos[3 * c + 1] - ay) - (g.pos[3 * b + 1] - ay) * (g.pos[3 * c] - ax);
    if (!(cr > 0)) ccw = false;
  }
  ok('style-flat: index in range, two triangles per cell', idxOk);
  ok('style-flat: every triangle faces +z (counter-clockwise)', ccw);
  let minX = 9, maxX = -9, minY = 9, maxY = -9;
  for (let k = 0; k < V; k++) { minX = Math.min(minX, g.pos[3 * k]); maxX = Math.max(maxX, g.pos[3 * k]); minY = Math.min(minY, g.pos[3 * k + 1]); maxY = Math.max(maxY, g.pos[3 * k + 1]); }
  ok('style-flat: equirect map is 4 x 2', near(minX, -2) && near(maxX, 2) && near(minY, -1) && near(maxY, 1));

  const e = mapGrid('equalearth');
  let eeOk = true, eMinX = 9, eMaxX = -9;
  for (let k = 0; k < V; k++) {
    const q = flat(e.ll[2 * k + 1], e.ll[2 * k], 0, 'equalearth');
    if (!near(e.pos[3 * k], q[0]) || !near(e.pos[3 * k + 1], q[1])) eeOk = false;
    eMinX = Math.min(eMinX, e.pos[3 * k]); eMaxX = Math.max(eMaxX, e.pos[3 * k]);
  }
  ok('style-flat: Equal Earth vertices from geo.js flat()', eeOk);
  ok('style-flat: Equal Earth scaled to width 4', near(eMinX, -2, 1e-4) && near(eMaxX, 2, 1e-4), `${eMinX.toFixed(5)}..${eMaxX.toFixed(5)}`);
  const top = e.pos[3 * (V - 1)];
  ok('style-flat: Equal Earth pole line shorter than the equator', top > 0.9 && top < 1.4, `pole half width ${top.toFixed(3)}`);

  // projectLL
  const p = projectLL(new Float32Array([90, 45]), 'equirect', 0.5);
  ok('style-flat: projectLL height on +z', near(p[0], 1) && near(p[1], 0.5) && p[2] === 0.5);

  // line helpers
  const gr = flatGraticule();
  const lats = new Set(), lons = new Set();
  let grOk = true;
  for (let s = 0; s < gr.n; s++) {
    const o = s * 4;
    if (Math.abs(gr.ll[o]) > 180 || Math.abs(gr.ll[o + 1]) > 90) grOk = false;
    if (gr.ll[o + 1] === gr.ll[o + 3]) lats.add(gr.ll[o + 1]); else lons.add(gr.ll[o]);
  }
  ok('style-flat: graticule 5 parallels and 11 meridians at 30 deg', grOk && lats.size === 5 && lons.size === 11, `${lats.size} / ${lons.size}`);
  let brightEq = 0;
  for (let s = 0; s < gr.n; s++) if (gr.bright[2 * s] === 1) brightEq++;
  ok('style-flat: equator and prime meridian are bright', brightEq > 0 && brightEq < gr.n);
  const ol = flatOutline();
  let olMax = 0;
  for (let s = 0; s < ol.n; s++) olMax = Math.max(olMax, Math.hypot(ol.ll[4 * s + 2] - ol.ll[4 * s], ol.ll[4 * s + 3] - ol.ll[4 * s + 1]));
  ok('style-flat: outline segments at most 2 deg', olMax <= 2 + 1e-6 && ol.n === 2 * 90 + 2 * 180);

  const rings = decodeCoast(readFileSync(new URL('../../storm-globe/data/coast-50m.bin', import.meta.url)));
  const c = flatCoast(rings);
  let cross = 0, longSeg = 0;
  for (let s = 0; s < c.n; s++) {
    const o = s * 4;
    if (Math.abs(c.ll[o + 2] - c.ll[o]) > 180) cross++;
    if (Math.hypot(c.ll[o + 2] - c.ll[o], c.ll[o + 3] - c.ll[o + 1]) > 1.5 + 1e-4) longSeg++;
  }
  ok('style-flat: coast has no antimeridian crossing', c.n > 10000 && cross === 0, `${c.n} segments`);
  ok('style-flat: coast segments at most 1.5 deg', longSeg === 0);
  const fake = flatCoast([{ kind: 0, pts: new Float32Array([179, 10, -179, 11, -178, 12]) }]);
  ok('style-flat: a segment across the antimeridian is dropped', fake.n === 1 && fake.ll[0] === -179);

  // shaders
  let bal = true;
  for (const [v, f] of Object.values(SHADERS)) for (const s of [v, f]) if ((s.match(/{/g) || []).length !== (s.match(/}/g) || []).length) bal = false;
  ok('style-flat: calm, no pulse over time in any shader', !/sin\(uTime/.test(Object.values(SHADERS).flat().join('\n')));
  ok('style-flat: shader braces balance', bal);
  ok('style-flat: each fragment shader sets gl_FragColor', Object.values(SHADERS).every(([, f]) => f.includes('gl_FragColor')));

  // create / setProj / update / dispose with a stub THREE and a stub fetch
  const st = stubThree(), root = new st.T.Group();
  const landMask = new st.T.DataTexture(new Uint8Array(4), 1024, 512), fieldTex = new st.T.DataTexture(new Uint8Array(4), 512, 256);
  const fieldOwned = new Set([landMask, fieldTex]);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => readFileSync(new URL(String(url))).buffer.slice(0) });
  try {
    ok('style-flat: id flat, flat mode', flatStyle.id === 'flat' && flatStyle.mode === 'flat' && typeof flatStyle.label === 'string');
    const D = { nodes: [{ pop: 600 }, { pop: 400 }] };
    const s = flatStyle.create({ THREE: st.T, root, D, field: { texture: fieldTex, landMask } });
    await s.coastReady;
    ok('style-flat: starts equirect', s.proj === 'equirect');
    ok('style-flat: group added to root', root.children.includes(s.group));
    const names = s.group.children.map(x => x.name);
    ok('style-flat: map, grid, edge and coast in the group', ['flat-map', 'flat-grid', 'flat-edge', 'flat-coast'].every(n => names.includes(n)), names.join(','));
    const map = s.group.children.find(x => x.name === 'flat-map');
    const coast = s.group.children.find(x => x.name === 'flat-coast');
    ok('style-flat: map reads the field textures', map.material.uniforms.uField.value === fieldTex && map.material.uniforms.uLand.value === landMask);
    ok('style-flat: lines above the plane', coast.geometry.attributes.position.array[2] === Math.fround(LINE_Z));
    const before = map.geometry.attributes.position.array.slice();
    const posArr = map.geometry.attributes.position.array, cArr = coast.geometry.attributes.position.array;
    const madeBefore = st.made.length;
    s.setProj('equalearth');
    ok('style-flat: setProj switches to Equal Earth', s.proj === 'equalearth');
    ok('style-flat: setProj moves vertices in place, no new GPU objects',
      map.geometry.attributes.position.array === posArr && coast.geometry.attributes.position.array === cArr &&
      map.geometry.attributes.position.needsUpdate && st.made.length === madeBefore);
    const k = 3 * (g.nx * 60 + 10);
    ok('style-flat: Equal Earth positions match mapGrid', near(posArr[k], e.pos[k]) && near(posArr[k + 1], e.pos[k + 1]) && !near(posArr[k], before[k]));
    s.setProj('equirect');
    let back = true;
    for (let i = 0; i < posArr.length; i++) if (!near(posArr[i], before[i])) { back = false; break; }
    ok('style-flat: back to equirect restores the mesh', back);
    for (let f = 0; f < 120; f++) s.update({ t: f / 60, dt: 1 / 60, sim: { I: new Float64Array([50, 0]) }, prev: new Float32Array(2), events: [], mode: 'flat' });
    ok('style-flat: tint moves toward the world prevalence', s.tint > 0 && map.material.uniforms.uTint.value === s.tint);
    s.update(null);
    s.dispose();
    const leaks = [...st.live].filter(o => !fieldOwned.has(o));
    ok('style-flat: dispose releases every owned GPU object', leaks.length === 0, `${leaks.length} left of ${st.made.length - 2}`);
    ok('style-flat: dispose leaves the field textures to F', st.live.has(landMask) && st.live.has(fieldTex));
    ok('style-flat: dispose removes the group', !root.children.includes(s.group));
    s.dispose();
    // start in Equal Earth from ctx.proj, no field, coast after dispose
    let release;
    globalThis.fetch = () => new Promise(res => { release = () => res({ ok: true, arrayBuffer: async () => readFileSync(new URL('../../storm-globe/data/coast-50m.bin', import.meta.url)).buffer.slice(0) }); });
    const s0 = flatStyle.create({ THREE: st.T, root, D: null, proj: 'equalearth' });
    ok('style-flat: ctx.proj sets the start projection', s0.proj === 'equalearth');
    s0.update({ t: 0, dt: 0.016, sim: null });
    s0.dispose(); release(); await s0.coastReady;
    ok('style-flat: a late coast after dispose leaks nothing', [...st.live].filter(o => !fieldOwned.has(o)).length === 0 && !s0.group.children.some(x => x.name === 'flat-coast'));
  } finally { globalThis.fetch = oldFetch; }
}
