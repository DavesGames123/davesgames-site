// style-holo (G5): the pure helpers, and create/update/dispose against a
// stub THREE (no GPU). The coast file is the real storm-globe 50m data.
import { readFileSync } from 'node:fs';
import holo, { graticuleSegments, ringSegments, scanY, flicker, holoColor, SHADERS, GRID_R, COAST_R, RING_R } from '../render/style-holo.js';
import { tintFor } from '../render/style-night.js';

function stubThree() {
  const made = [], live = new Set();
  class Disp { constructor() { made.push(this); live.add(this); } dispose() { live.delete(this); } }
  class Obj { constructor() { this.children = []; this.parent = null; this.rotation = { x: 0, y: 0, z: 0 }; }
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

const segLen = (p, s) => { const o = s * 6; return Math.hypot(p[o] - p[o + 3], p[o + 1] - p[o + 4], p[o + 2] - p[o + 5]); };

export default async function (ok) {
  // graticule
  const g = graticuleSegments();
  let onR = true, maxLen = 0;
  for (let i = 0; i < g.pos.length; i += 3) if (Math.abs(Math.hypot(g.pos[i], g.pos[i + 1], g.pos[i + 2]) - GRID_R) > 1e-5) onR = false;
  for (let s = 0; s < g.n; s++) maxLen = Math.max(maxLen, segLen(g.pos, s));
  ok('style-holo: graticule points on the grid radius', onR, `${g.n} segments`);
  ok('style-holo: graticule chords at most 2 deg', maxLen <= 2 * Math.PI / 180 * GRID_R + 1e-6, `max ${(maxLen * 180 / Math.PI).toFixed(3)} deg`);
  let eq = 0, pm = 0, poleY = 0;
  for (let s = 0; s < g.n; s++) {
    const o = s * 6;
    if (g.bright[s * 2] === 1 && Math.abs(g.pos[o + 1]) < 1e-6 && Math.abs(g.pos[o + 4]) < 1e-6) eq++;
    if (g.bright[s * 2] === 1 && Math.abs(g.pos[o + 2]) < 1e-6 && Math.abs(g.pos[o + 5]) < 1e-6 && g.pos[o] > 0) pm++;
    poleY = Math.max(poleY, Math.abs(g.pos[o + 1]), Math.abs(g.pos[o + 4]));
  }
  ok('style-holo: equator and prime meridian are bright', eq >= 180 && pm >= 70, `equator ${eq}, meridian ${pm}`);
  ok('style-holo: no lines meet at the poles', poleY < Math.sin(76 * Math.PI / 180), `max |y| ${poleY.toFixed(4)}`);
  ok('style-holo: 11 parallels and 24 meridians at 15 deg', (() => {
    const lats = new Set(), lons = new Set();
    for (let s = 0; s < g.n; s++) { const o = s * 6; if (Math.abs(g.pos[o + 1] - g.pos[o + 4]) < 1e-7) lats.add(g.pos[o + 1].toFixed(4)); else lons.add(Math.atan2(-g.pos[o + 2], g.pos[o]).toFixed(3)); }
    return lats.size === 11 && lons.size === 24;
  })());

  // rings
  const r = ringSegments(1.2, 128, 10, 0.02);
  let ringOk = true, ticks = 0, longTicks = 0;
  for (let s = 0; s < r.n; s++) {
    const o = s * 6, y0 = r.pos[o + 1], y1 = r.pos[o + 4];
    if (y0 !== 0 || y1 !== 0) ringOk = false;
    if (r.bright[s * 2] === 1) { ticks++; const l = segLen(r.pos, s); if (Math.abs(l - 0.04) < 1e-6) longTicks++; else if (Math.abs(l - 0.02) > 1e-6) ringOk = false; }
    else if (Math.abs(Math.hypot(r.pos[o], r.pos[o + 2]) - 1.2) > 1e-6) ringOk = false;
  }
  ok('style-holo: ring flat, on its radius, ticks of the set length', ringOk);
  ok('style-holo: 36 ticks, 4 long at the quarters', ticks === 36 && longTicks === 4, `${ticks} / ${longTicks}`);
  ok('style-holo: rings sit outside the globe', RING_R.every(v => v > 1.1));

  // scan band, flicker, colour
  ok('style-holo: scan starts at the top, at the base mid-period', Math.abs(scanY(0) - 1.1) < 1e-12 && Math.abs(scanY(4.5) + 1.1) < 1e-12);
  ok('style-holo: scan is periodic and works for t < 0', Math.abs(scanY(2) - scanY(11)) < 1e-12 && Math.abs(scanY(-2) - scanY(7)) < 1e-12);
  let fmin = 1, fmax = 0, jump = 0;
  for (let k = 0; k <= 6000; k++) { const t = k / 60, f = flicker(t); fmin = Math.min(fmin, f); fmax = Math.max(fmax, f); if (k) jump = Math.max(jump, Math.abs(f - flicker(t - 1 / 60))); }
  ok('style-holo: flicker in [0.9, 1]', fmin >= 0.9 && fmax <= 1, `${fmin.toFixed(3)}..${fmax.toFixed(3)}`);
  ok('style-holo: flicker has no snaps at 60 fps', jump < 0.03, `max step ${jump.toFixed(4)}`);
  const cA = holoColor(0), cB = holoColor(1);
  ok('style-holo: colour cyan at tint 0, rose side at tint 1', cA[2] > cA[0] && cB[0] > cB[2] && cB[0] > cA[0]);
  ok('style-holo: colour clamps the tint', holoColor(-1).join() === cA.join() && holoColor(9).join() === cB.join());

  // shader sources: braces balance, each fragment writes a colour
  let bal = true;
  for (const [v, f] of Object.values(SHADERS)) for (const s of [v, f]) if ((s.match(/{/g) || []).length !== (s.match(/}/g) || []).length) bal = false;
  ok('style-holo: shader braces balance', bal);
  ok('style-holo: each fragment shader sets gl_FragColor', Object.values(SHADERS).every(([, f]) => f.includes('gl_FragColor')));

  // create / update / dispose with a stub THREE and a stub fetch
  const st = stubThree(), root = new st.T.Group();
  const landMask = new st.T.DataTexture(new Uint8Array(4), 1024, 512), fieldTex = new st.T.DataTexture(new Uint8Array(4), 512, 256);
  const fieldOwned = new Set([landMask, fieldTex]);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => readFileSync(new URL(String(url))).buffer.slice(0) });
  try {
    ok('style-holo: id holo, globe mode', holo.id === 'holo' && holo.mode === 'globe' && typeof holo.label === 'string');
    const D = { nodes: [{ pop: 600 }, { pop: 400 }] };
    const s = holo.create({ THREE: st.T, root, D, field: { texture: fieldTex, landMask } });
    await s.coastReady;
    ok('style-holo: group added to root', root.children.includes(s.group));
    const names = s.group.children.map(c => c.name);
    ok('style-holo: core, grid, rings, halo and coast in the group', ['holo-core', 'holo-grid', 'holo-rings', 'holo-halo', 'holo-coast'].every(n => names.includes(n)), names.join(','));
    const core = s.group.children.find(c => c.name === 'holo-core');
    const coast = s.group.children.find(c => c.name === 'holo-coast');
    ok('style-holo: core reads the field textures', core.material.uniforms.uField.value === fieldTex && core.material.uniforms.uLand.value === landMask);
    ok('style-holo: core writes depth, lines do not test it', core.material.depthTest !== false && coast.material.depthTest === false && coast.material.depthWrite === false);
    const cpos = coast.geometry.attributes.position.array;
    ok('style-holo: coast on the coast radius', Math.abs(Math.hypot(cpos[0], cpos[1], cpos[2]) - COAST_R) < 1e-5);
    for (let k = 0; k < 120; k++) s.update({ t: k / 60, dt: 1 / 60, sim: { I: new Float64Array([50, 0]) }, prev: new Float32Array(2), events: [], mode: 'globe' });
    ok('style-holo: tint moves toward the world prevalence', s.tint > 0 && s.tint < tintFor(0.05), s.tint.toFixed(3));
    const col = core.material.uniforms.uColor.value;
    ok('style-holo: all layers share the moving colour', coast.material.uniforms.uColor.value === col && col.r > holoColor(0)[0]);
    ok('style-holo: scan uniform shared and live', coast.material.uniforms.uScan.value === scanY(119 / 60) && core.material.uniforms.uScan.value === scanY(119 / 60));
    const ringLine = s.group.children.find(c => c.name === 'holo-rings').children[0].children[0];
    ok('style-holo: rings turn', ringLine.rotation.y > 0);
    s.update(null);
    s.dispose();
    const leaks = [...st.live].filter(o => !fieldOwned.has(o));
    ok('style-holo: dispose releases every owned GPU object', leaks.length === 0, `${leaks.length} left of ${st.made.length - 2}`);
    ok('style-holo: dispose leaves the field textures to F', st.live.has(landMask) && st.live.has(fieldTex));
    ok('style-holo: dispose removes the group', !root.children.includes(s.group));
    s.dispose();
    // no field, and a coast that arrives after dispose
    let release;
    globalThis.fetch = () => new Promise(res => { release = () => res({ ok: true, arrayBuffer: async () => readFileSync(new URL('../../storm-globe/data/coast-50m.bin', import.meta.url)).buffer.slice(0) }); });
    const s0 = holo.create({ THREE: st.T, root, D: null });
    s0.update({ t: 0, dt: 0.016, sim: null });
    s0.dispose(); release(); await s0.coastReady;
    ok('style-holo: a late coast after dispose leaks nothing', [...st.live].filter(o => !fieldOwned.has(o)).length === 0 && !s0.group.children.some(c => c.name === 'holo-coast'));
  } finally { globalThis.fetch = oldFetch; }
}
