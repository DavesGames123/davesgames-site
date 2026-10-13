// ============================================================================
//  BREADBOARD LAB  ·  view/test/stubs.mjs — stand-ins for other roles
// ----------------------------------------------------------------------------
//  The SCENE tests must run before PARTS delivers. These stubs follow the
//  shapes of CONTRACT 3.5 (part defs, registry) and 4.3 (part handles) for a
//  few parts only. They live in the SCENE test folder, never in parts/.
//
//  GREP MAP
//    DEFS / REGISTRY ...... res, led, button-6mm, mcu-uno, inst-dmm, ic-555
//    stubParts ............ buildPart / buildBoard / buildWire / wirePath
//    stubRenderer ......... a WebGLRenderer stand-in for node
// ============================================================================

const unoPins = [];
for (let i = 0; i <= 13; i++) unoPins.push({ name: 'D' + i, x: 20 - i, z: -8, socket: true });
for (let i = 0; i <= 5; i++) unoPins.push({ name: 'A' + i, x: 6 + i, z: 12, socket: true });
for (const [i, n] of ['5V', '3V3', 'GND.1', 'GND.2', 'VIN'].entries()) unoPins.push({ name: n, x: i, z: 12, socket: true });

export const DEFS = {
  res: {
    id: 'res', name: 'Resistor', category: 'passive', mount: 'board', desc: '',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: '$span', z: 0 }],
    params: [{ key: 'r', label: 'R', unit: 'Ω', type: 'number', default: 1000, series: 'E12' }, { key: 'span', label: 'Span', type: 'int', default: 4, min: 3, max: 12, geometric: true }],
    electrical: [{ id: 'main', type: 'resistor', nodes: { a: '1', b: '2' }, params: { r: '$r' } }],
    slots: [{ key: 'body', label: 'Body', default: 'resistor-beige' }, { key: 'legs', label: 'Legs', default: 'tin' }],
    model: { template: 'axial' },
  },
  led: {
    id: 'led', name: 'LED', category: 'semis', mount: 'board', desc: '', visual: 'led',
    pins: [{ name: 'A', x: 0, z: 0 }, { name: 'K', x: 1, z: 0 }],
    params: [{ key: 'color', label: 'Colour', type: 'enum', default: 'red', options: ['red', 'green', 'blue'] }],
    electrical: [{ id: 'main', type: 'led', nodes: { a: 'A', k: 'K' }, params: { color: '$color' } }],
    slots: [{ key: 'lens', label: 'Lens', default: 'led-red' }],
    model: { template: 'radial' },
  },
  'button-6mm': {
    id: 'button-6mm', name: 'Button', category: 'input', mount: 'board', desc: '',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 2, z: 0 }, { name: '3', x: 0, z: -3 }, { name: '4', x: 2, z: -3 }],
    params: [{ key: 'pressed', label: 'Pressed', type: 'bool', default: false, live: true }],
    electrical: [], interact: { kind: 'press', key: 'pressed' },
    slots: [{ key: 'body', label: 'Body', default: 'abs-black' }],
    model: { template: 'box', w: 6, d: 6, h: 4 },
  },
  'ic-555': {
    id: 'ic-555', name: '555', category: 'ics', mount: 'board', desc: '',
    pins: [1, 2, 3, 4].map((n, i) => ({ name: String(n), x: i, z: 0 })).concat([5, 6, 7, 8].map((n, i) => ({ name: String(n), x: 3 - i, z: -3 }))),
    params: [], electrical: [], slots: [{ key: 'body', label: 'Body', default: 'epoxy-black' }],
    model: { template: 'dip', pins: 8, label: '555' },
  },
  'mcu-uno': {
    id: 'mcu-uno', name: '328 Dev Board', category: 'mcu', mount: 'free', desc: '',
    pins: unoPins, params: [], electrical: [],
    slots: [{ key: 'body', label: 'PCB', default: 'pcb-blue' }], model: { template: 'header-board', w: 68.6, d: 53.3 },
  },
  'inst-dmm': {
    id: 'inst-dmm', name: 'Multimeter', category: 'instruments', mount: 'free', desc: '', visual: 'meter',
    pins: [], params: [], electrical: [], slots: [{ key: 'body', label: 'Body', default: 'abs-black' }], model: { template: 'box', w: 80, d: 150, h: 30 },
  },
};

export const REGISTRY = {
  get: id => DEFS[id] || null,
  list: cat => Object.values(DEFS).filter(d => !cat || d.category === cat),
  categories: ['passive', 'semis', 'input', 'ics', 'mcu', 'instruments'],
};

// Part handles of CONTRACT 4.3, made from plain boxes.
export function stubParts(THREE) {
  const calls = { part: 0, board: 0, wire: 0, state: 0, damage: 0, look: 0, disposed: 0 };
  const G = 2.54;
  function buildPart(T, def, part, ctx) {
    calls.part++;
    const object = new T.Group();
    const geo = new T.BoxGeometry(5, 3, 5);
    const mesh = new T.Mesh(geo, ctx.materials('abs-white'));
    mesh.position.y = 2;
    object.add(mesh);
    const pins = (def.pins || []).map(p => ({ name: p.name, local: new T.Vector3((typeof p.x === 'number' ? p.x : 4) * G, p.socket ? 9 : 0, p.z * G) }));
    const screens = {};
    if (def.visual === 'meter') {
      const ctx2 = { fillRect() {}, clearRect() {} };
      screens.main = { canvas: { width: 128, height: 64 }, ctx: ctx2, texture: { needsUpdate: false, dispose() {} } };
    }
    const handle = {
      object, pins, pickables: [mesh], slots: { body: [mesh] },
      setLook(slot, m) { calls.look++; for (const x of handle.slots[slot] || []) x.material = m; },
      setState(f) { calls.state++; handle.lastState = f; },
      setDamage(k) { calls.damage++; handle.damage = k; },
      screens,
      leads: def.id === 'inst-dmm' ? { red: new T.Vector3(10, 5, 60), black: new T.Vector3(-10, 5, 60) } : undefined,
      dispose() { calls.disposed++; geo.dispose(); },
    };
    if (def.interact) handle.interact = { kind: def.interact.kind, meshes: [mesh], key: def.interact.key };
    return handle;
  }
  function buildBoard(T, board) {
    calls.board++;
    const object = new T.Group();
    const geo = new T.BoxGeometry(160, 8.5, 54);
    const mesh = new T.Mesh(geo, new T.MeshStandardMaterial());
    mesh.position.y = 4.25;
    object.add(mesh);
    const holes = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial(), 1);
    object.add(holes);
    return { object, holes, pickables: [mesh], dispose() { geo.dispose(); } };
  }
  function wirePath(a, b) { return [a, [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 10, (a[2] + b[2]) / 2], b]; }
  function buildWire(T, { points, color }) {
    calls.wire++;
    const mk = pts => new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p => new T.Vector3(...p))), 8, 0.3, 4);
    const mesh = new T.Mesh(mk(points), new T.MeshStandardMaterial({ color }));
    return { object: mesh, setPoints(p) { mesh.geometry.dispose(); mesh.geometry = mk(p); }, dispose() { mesh.geometry.dispose(); mesh.material.dispose(); } };
  }
  return { parts: { buildPart, buildBoard, buildWire, wirePath }, calls };
}

// Enough of WebGLRenderer for createView in node.
export function stubRenderer() {
  const r = {
    renders: 0, disposed: false, lost: false,
    domElement: null,
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0, toneMappingExposure: 1, outputColorSpace: '',
    info: { render: { calls: 0, triangles: 0 } },
    capabilities: { isWebGL2: true },
    setPixelRatio(p) { r.pixelRatio = p; },
    getPixelRatio() { return r.pixelRatio || 1; },
    setSize(w, h) { r.size = [w, h]; },
    getSize(v) { v.set((r.size || [800, 500])[0], (r.size || [800, 500])[1]); return v; },
    setClearColor() {}, setRenderTarget() {}, clear() {},
    render() { r.renders++; },
    readRenderTargetPixels() {},
    compile() {},
    dispose() { r.disposed = true; },
    forceContextLoss() { r.lost = true; },
  };
  return r;
}
