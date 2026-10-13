// ============================================================================
//  BREADBOARD LAB  ·  parts/boards.js — breadboard models
// ----------------------------------------------------------------------------
//  buildBoard(THREE, board, ctx) -> { object, holes, holeIds, pickables,
//  setHoleColors, clearHoleColors, dispose } (CONTRACT 4.3).
//
//  ALL HOLES ARE ONE INSTANCED MESH. Instance i is holeTable(type)[i], so a
//  ray hit's instanceId gives the hole id (holeIds[i]). A hole is a dark
//  square 0.02 mm above the top: two triangles each, 830 holes = 1660
//  triangles in one draw call. Net highlight recolours instances.
//
//  The object is placed at board.x, board.z and turned by board.rot, so a
//  board-local point maps to the world as geometry.js boardToWorld does.
//
//  GREP MAP
//    buildBoard ............. body, channel + rail stripes (one mesh), holes, silkscreen
//    setHoleColors .......... { localId: '#hex' } -> instance colours
// ============================================================================
import { BOARD_TYPES, BOARD_H, holeTable, colX, rowZ, railX, ROWS } from './geometry.js';
import { makeMaterial, presetById } from './materials.js';
import { labelTexture } from './labels.js';
import { mergeGeometries } from './models/kit.js';

export function buildBoard(THREE, board, ctx = {}) {
  const bt = BOARD_TYPES[board.type];
  if (!bt) throw new Error('unknown board type ' + board.type);
  const matOf = ctx.materials || (id => makeMaterial(THREE, presetById(id)));
  const looks = board.looks || {};
  const [W, D, H] = bt.size;
  const group = new THREE.Group();
  group.name = 'board:' + board.id;
  const own = { geoms: [], mats: [], tex: [] };
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = true; m.castShadow = true;
    group.add(m); own.geoms.push(geo);
    return m;
  };
  // body: a rounded slab
  const s = new THREE.Shape();
  const r = 1.6, x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  s.moveTo(x0 + r, z0); s.lineTo(x1 - r, z0); s.quadraticCurveTo(x1, z0, x1, z0 + r);
  s.lineTo(x1, z1 - r); s.quadraticCurveTo(x1, z1, x1 - r, z1); s.lineTo(x0 + r, z1);
  s.quadraticCurveTo(x0, z1, x0, z1 - r); s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
  const bodyGeo = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false, curveSegments: 3 });
  bodyGeo.rotateX(-Math.PI / 2);
  const body = add(bodyGeo, matOf(looks.body || 'board-white'));
  body.userData.board = board.id;
  // the centre channel and the rail stripes: one vertex-coloured mesh
  const marks = [], cols = [];
  const mark = (w, d, z, hex) => { const g = new THREE.BoxGeometry(w, 0.06, d); g.translate(0, H + 0.025, z); marks.push(g); cols.push(new THREE.Color(hex)); };
  mark(W - 4, 2.2, 0, presetById('board-hole').color);
  if (bt.railHoles) {
    const len = (railX(board.type, bt.railHoles) - railX(board.type, 1)) + 4;
    for (const [z, id] of [[-24.6, 'rail-blue'], [-18.6, 'rail-red'], [18.6, 'rail-red'], [24.6, 'rail-blue']]) mark(len, 0.5, z, presetById(id).color);
  }
  const marksGeo = mergeGeometries(THREE, marks, cols);
  marks.forEach(g => g.dispose());
  const marksMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  own.mats.push(marksMat);
  const marksMesh = add(marksGeo, marksMat);
  marksMesh.castShadow = false;
  // holes
  const table = holeTable(board.type);
  const holeGeo = new THREE.PlaneGeometry(1.05, 1.05);
  holeGeo.rotateX(-Math.PI / 2);
  own.geoms.push(holeGeo);
  const holeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  own.mats.push(holeMat);
  const holes = new THREE.InstancedMesh(holeGeo, holeMat, table.length);
  holes.name = 'holes:' + board.id;
  const m4 = new THREE.Matrix4();
  const base = new THREE.Color('#151515');
  table.forEach((h, i) => { m4.makeTranslation(h.x, H + 0.03, h.z); holes.setMatrixAt(i, m4); holes.setColorAt(i, base); });
  holes.instanceMatrix.needsUpdate = true;
  holes.instanceColor.needsUpdate = true;
  holes.userData.board = board.id;
  holes.userData.holeIds = table.map(h => h.id);
  group.add(holes);
  // silkscreen: row letters and every fifth column number (browser only)
  if (ctx.labels !== false) {
    const lines = [];
    const tex = labelTexture(THREE, '', { w: 8, h: 8 });
    if (tex) {
      tex.dispose();
      const cols = bt.cols;
      const silk = (text, w, d, x, z, size = 1) => {
        const t = labelTexture(THREE, text, { w: Math.round(w * 20), h: Math.round(d * 20), color: '#6a6a66', font: 'mono', weight: 600, scale: 0.8 * size });
        if (!t) return;
        own.tex.push(t);
        const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
        const mt = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
        own.mats.push(mt);
        const mesh = add(g, mt, x, H + 0.04, z);
        mesh.castShadow = false; mesh.renderOrder = 2;
        lines.push(mesh);
      };
      for (let c = 1; c <= cols; c++) if (c === 1 || c % 5 === 0) {
        silk(String(c), 3, 1.6, colX(board.type, c), rowZ(0) - 2.1);
        silk(String(c), 3, 1.6, colX(board.type, c), rowZ(9) + 2.1);
      }
      for (let i = 0; i < 10; i++) {
        silk(ROWS[i], 1.6, 1.6, colX(board.type, 1) - 2.6, rowZ(i));
        silk(ROWS[i], 1.6, 1.6, colX(board.type, cols) + 2.6, rowZ(i));
      }
    }
  }
  group.position.set(board.x || 0, 0, board.z || 0);
  group.rotation.y = -(board.rot || 0) * Math.PI / 2;
  group.userData.board = board.id;
  const idx = new Map(table.map((h, i) => [h.id, i]));
  const tmp = new THREE.Color();
  return {
    object: group, holes, holeIds: holes.userData.holeIds, pickables: [body, holes], body,
    height: BOARD_H,
    // { localId: '#hex' } -> colour those holes (others stay as they are)
    setHoleColors(map) {
      for (const k in map) { const i = idx.get(k); if (i !== undefined) holes.setColorAt(i, tmp.set(map[k])); }
      holes.instanceColor.needsUpdate = true;
    },
    clearHoleColors() {
      for (let i = 0; i < table.length; i++) holes.setColorAt(i, base);
      holes.instanceColor.needsUpdate = true;
    },
    setLook(slot, material) { if (slot === 'body' && material) body.material = material; },
    dispose() {
      for (const g of own.geoms) g.dispose();
      for (const m of own.mats) m.dispose();
      for (const t of own.tex) t.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
