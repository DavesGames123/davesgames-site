// render (F): budget arithmetic, the land raster, the node-to-texel
// weights of the field, and createGlobe against a stub THREE (no GPU).
import { readFileSync } from 'node:fs';
import { MAX_PX, canvasBudget, canvasBytes } from '../budget.js';
import { rasterLand, landFraction, downMask, buildWeights, glowFor, deadFor, fillField, createField, sigmaKm, MASK_W, MASK_H, FIELD_W, FIELD_H } from '../render/field.js';
import { createGlobe, viewOffsetFor, poseMode, nodeWorld, STYLE_LIST } from '../render/globe.js';
import { parseNodes } from '../data.js';

function stubThree() {
  const live = new Set();
  class Disp { constructor() { live.add(this); } dispose() { live.delete(this); } }
  class Vec { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    project(cam) { // orthographic stand-in: x, y in [-2, 2] -> ndc, z by depth
      const d = Math.hypot(this.x - cam.position.x, this.y - cam.position.y, this.z - cam.position.z);
      this.x /= 2; this.y /= 2; this.z = d < 50 ? 0.5 : 2; return this; } }
  class Obj { constructor() { this.children = []; this.parent = null; this.position = new Vec(); this.up = new Vec(0, 1, 0); }
    add(c) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); }
    remove(c) { this.children = this.children.filter(x => x !== c); c.parent = null; }
    lookAt() {} updateMatrixWorld() {} }
  class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class BufferGeometry extends Disp { constructor() { super(); this.attributes = {}; } setAttribute(k, a) { this.attributes[k] = a; } }
  let renders = 0, lost = 0, pr = 0;
  const T = {
    Group: Obj, Scene: Obj, Mesh, Points: Mesh, LineSegments: Mesh, BufferGeometry,
    SphereGeometry: class extends BufferGeometry {}, PlaneGeometry: class extends BufferGeometry {},
    BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
    ShaderMaterial: class extends Disp { constructor(o) { super(); Object.assign(this, o); } },
    DataTexture: class extends Disp { constructor(data, w, h) { super(); this.image = { data, width: w, height: h }; } },
    Vector2: Vec, Vector3: Vec, Color: class { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } },
    PerspectiveCamera: class extends Obj { constructor() { super(); this.view = null; }
      setViewOffset(W, H, x, y, w, h) { this.view = { enabled: true, W, H, x, y, w, h }; }
      clearViewOffset() { this.view = null; } updateProjectionMatrix() {} },
    WebGLRenderer: class { constructor() { this.capabilities = { getMaxAnisotropy: () => 8 }; }
      setClearColor() {} setPixelRatio(p) { pr = p; } getPixelRatio() { return pr; } setSize() {}
      render() { renders++; } dispose() {} forceContextLoss() { lost++; } },
    AdditiveBlending: 2, BackSide: 1, RGBAFormat: 1023, UnsignedByteType: 1009, LinearFilter: 1006,
    RepeatWrapping: 1000, ClampToEdgeWrapping: 1001,
  };
  return { T, live, stats: () => ({ renders, lost, pr }) };
}

export default async function (ok) {
  // budget
  const a = canvasBudget(1280, 720, 2);
  ok('budget: a laptop window keeps pixel ratio 2', a.pr === 2 && a.w === 2560 && a.h === 1440, `pr ${a.pr}`);
  const b = canvasBudget(2560, 1440, 2);
  ok('budget: a 1440p window at dpr 2 drops to 1x', b.pr === 1 && b.px <= MAX_PX, `pr ${b.pr}`);
  const c = canvasBudget(3840, 2160, 3);
  ok('budget: a 4k window stays under 2560 x 1440 device px', c.px <= MAX_PX * 1.002 && c.pr < 1, `px ${c.px}`);
  ok('budget: dpr 3 phone capped at 2', canvasBudget(390, 844, 3).pr === 2);
  ok('budget: bytes = px x (4 x 8 + 12)', canvasBytes(100) === 4400 && a.bytes === a.px * 44);
  ok('budget: zero size gives a valid ratio', canvasBudget(0, 0, 0).pr === 1);

  // land raster
  const sq = rasterLand([[0, 0, 1000, 0, 1000, 1000, 0, 1000]], 360, 180);
  let n = 0; for (const v of sq) n += v;
  ok('raster: a 10 x 10 deg square fills 100 texels at 1 deg', n === 100, `${n}`);
  ok('raster: the square sits at lon 0..10, lat 0..10', sq[95 * 360 + 185] === 1 && sq[85 * 360 + 185] === 0 && sq[95 * 360 + 175] === 0);
  const two = rasterLand([[0, 0, 1000, 0, 1000, 1000, 0, 1000], [500, 500, 1500, 500, 1500, 1500, 500, 1500]], 360, 180);
  ok('raster: overlapping rings do not cut a hole', two[(90 + 7) * 360 + 187] === 1);
  const world = JSON.parse(readFileSync(new URL('../../map-projections/data/world.json', import.meta.url)));
  const m = rasterLand(world.land);
  const lf = landFraction(m);
  ok('raster: Natural Earth land covers 26-32 % of the sphere', lf > 0.26 && lf < 0.32, lf.toFixed(3));
  const dm = downMask(m, MASK_W, MASK_H, 2);
  ok('raster: the 2x down mask keeps the land', landFraction(dm, FIELD_W, FIELD_H) >= lf);

  // weights
  const nodes = [{ lat: 5, lon: 5, pop: 5e6 }, { lat: 5, lon: 20, pop: 5e6 }];
  const land = new Uint8Array(FIELD_W * FIELD_H).fill(1);
  const W = buildWeights(nodes, land);
  const tx = (lat, lon) => Math.floor((lat + 90) / 180 * FIELD_H) * FIELD_W + Math.floor((lon + 180) / 360 * FIELD_W);
  const at = (lat, lon) => { const t = W.texel.indexOf(tx(lat, lon)); return t < 0 ? null : { n: Array.from(W.node.slice(t * W.k, t * W.k + W.k)), w: Array.from(W.w.slice(t * W.k, t * W.k + W.k)) }; };
  const c0 = at(5, 5);
  ok('weights: the texel at a node weighs it near 1', c0 && c0.n[0] === 0 && c0.w[0] > 0.95, c0 && c0.w[0].toFixed(3));
  ok('weights: weights fall with distance', c0 && (c0.n[1] === -1 || c0.w[1] < 0.1));
  ok('weights: land beyond 3 sigma of every node has no texel', at(60, 120) === null && at(5, 40) === null);
  ok('weights: sigma grows with population and is clamped', sigmaKm(5e6) === 450 && sigmaKm(1e9) === 900 && sigmaKm(1) === 270);
  const ocean = buildWeights(nodes, new Uint8Array(FIELD_W * FIELD_H));
  ok('weights: no land, no texels', ocean.T === 0);

  // glow and fill
  ok('glow: 0 at none, 1 at 5 %, monotone', glowFor(0) === 0 && glowFor(0.05) === 1 && glowFor(1e-5) > glowFor(1e-6) && glowFor(1e-6) > 0);
  ok('dead: square root, 1 at 5 %', deadFor(0) === 0 && deadFor(0.05) === 1 && Math.abs(deadFor(0.0125) - 0.5) < 1e-12);
  const data = new Uint8Array(FIELD_W * FIELD_H * 4);
  fillField(data, FIELD_W, Float32Array.of(1, 0), Float32Array.of(0, 0.5), W);
  const o = tx(5, 5) * 4, o2 = tx(5, 20) * 4;
  ok('fill: a node at glow 1 lights its texel', data[o] > 240 && data[o + 1] < 20, `${data[o]} ${data[o + 1]}`);
  ok('fill: the deaths share goes to G', data[o2] < 20 && data[o2 + 1] > 120, `${data[o2]} ${data[o2 + 1]}`);
  ok('fill: texels with no node stay 0', data[tx(60, 120) * 4] === 0);

  // createField with a stub THREE and the real nodes
  const S = stubThree();
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url))));
  const f = createField(D, S.T);
  ok('field: the textures have the contract sizes', f.landMask.image.width === 1024 && f.landMask.image.height === 512 && f.texture.image.width === 512 && f.texture.image.height === 256);
  f.update(new Float32Array(D.nodes.length).fill(0.01));
  ok('field: no update before the land arrives', !f.ready && f.texture.image.data[0] === 0);
  f.setWorld(world);
  const prev = new Float32Array(D.nodes.length).fill(0.01);
  f.update(prev);
  let lit = 0; for (let i = 0; i < FIELD_W * FIELD_H; i++) if (f.texture.image.data[i * 4] > 0) lit++;
  ok('field: 1 % prevalence everywhere lights a large part of the land', f.ready && lit > 15000, `${lit} texels`);
  f.dispose();
  ok('field: dispose releases both textures', S.live.size === 0);

  // globe helpers
  ok('globe: view offset centres a left panel rect', JSON.stringify(viewOffsetFor(1000, 600, 300, 1000, 0, 600)) === JSON.stringify({ x: -150, y: 0 }));
  ok('globe: pose mode maps flat projections', poseMode('globe', 'equalearth') === 'globe' && poseMode('flat') === 'equirect' && poseMode('flat', 'equalearth') === 'equalearth');
  const p = nodeWorld({ lat: 0, lon: 90 }, 'globe');
  ok('globe: node (0, 90) is on -z', Math.abs(p[2] + 1) < 1e-12 && Math.abs(p[0]) < 1e-12);
  ok('globe: six styles listed', STYLE_LIST.map(s => s.id).join() === 'night,marble,dots,flat,equalearth,holo');
  ok('globe: the flat styles name their projection', STYLE_LIST.find(s => s.id === 'flat').proj === 'equirect' && STYLE_LIST.find(s => s.id === 'equalearth').proj === 'equalearth');

  // createGlobe against the stub
  const G = stubThree();
  const warn = console.warn; console.warn = () => {};
  const canvas = { clientWidth: 800, clientHeight: 600 };
  const g = createGlobe(canvas, { D, net: null, THREE: G.T, worldUrl: null });
  await g.ready;
  ok('createGlobe: starts on the night style', g.style === 'night' && g.mode === 'globe');
  ok('createGlobe: hands styles the field and geo in ctx', g.ctx.field === g.field && typeof g.ctx.geo.arcPoints === 'function');
  g.setStyle('holo');
  ok('createGlobe: switches to holo', g.style === 'holo');
  g.setStyle('no-such-style');
  ok('createGlobe: an unknown style shows night', g.style === 'night');
  g.setCamera({ lat: 0, lon: 0, alt: 2 });
  g.update({ t: 0, dt: 0.016, sim: null, prev: new Float32Array(D.nodes.length), events: [] });
  ok('createGlobe: update renders one frame at the budget ratio', G.stats().renders === 1 && G.stats().pr === 1);
  const v = g.project(D.nodes.findIndex(x => Math.abs(x.lon) < 30 && Math.abs(x.lat) < 30));
  const back = g.project(D.nodes.findIndex(x => Math.abs(x.lon) > 150));
  ok('createGlobe: project hides the far side', v.visible && !back.visible);
  g.setViewOffset(200, 800, 0, 600);
  ok('createGlobe: setViewOffset shifts the view', g.ctx.camera.view && g.ctx.camera.view.x === -100);
  g.setViewOffset(null);
  ok('createGlobe: setViewOffset(null) clears it', !g.ctx.camera.view);
  g.dispose();
  console.warn = warn;
  ok('createGlobe: dispose releases every GPU object and loses the context', G.live.size === 0 && G.stats().lost === 1, `${G.live.size} live`);
}
