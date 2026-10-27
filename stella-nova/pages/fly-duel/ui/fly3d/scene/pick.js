// ============================================================================
//  FLY DUEL 3D  ·  pointer picks on the table  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of the closure of ui/fly3d/scene.js createDuelScene. Client px
//  (a pointer event) -> a raycast on the card meshes, the life dice and
//  the flies. createPicker({ canvas, camera, Z, flies, drums, mirror }) ->
//  { pickPermanent, pickCard, pickFace }. mirror() gives the current mirror.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export function createPicker'  the picks of one scene
//      grep -n 'function toNdc'                client px -> NDC
//      grep -n 'function pickPermanent'        a permanent, a fly or its dice
//      grep -n 'function pickCard'             a hand card
//      grep -n 'function pickFace'             any card under a point (zoom)
// ============================================================================
import * as THREE from 'three';

export function createPicker({ canvas, camera, Z, flies, drums, mirror: mirrorOf }) {
  // Screen point (client px, as a pointer event gives) -> NDC.
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
  function toNdc(x, y) {
    const r = canvas?.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: canvas?.clientWidth || 960, height: canvas?.clientHeight || 540 };
    if (!(r.width > 0 && r.height > 0)) return null;
    return _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }
  function castAt(x, y, objs) {
    const n = toNdc(x, y);
    if (!n) return null;
    camera.updateMatrixWorld();
    _ray.setFromCamera(n, camera);
    const hits = _ray.intersectObjects(objs, false);
    return hits[0] || null;
  }
  // A permanent under the point: { uid, id, seat, point } or null. A tap
  // on a fly or its life dice gives { uid: null, player: seat }.
  function pickPermanent(x, y) {
    const list = [], owner = new Map();
    for (let p = 0; p < 2; p++) for (const pe of mirrorOf()?.players[p].battlefield || []) { const o = Z.perms.get(pe.uid); if (o) { list.push(o.mesh); owner.set(o.mesh, { uid: pe.uid, id: pe.id, seat: p }); } }
    const h = castAt(x, y, list);
    if (h) return { ...owner.get(h.object), point: h.point.clone() };
    const bodies = [];
    for (let p = 0; p < 2; p++) { drums[p].grp.traverse(o => { if (o.isMesh) { o.userData.seat = p; bodies.push(o); } }); if (flies[p].holder.visible) flies[p].built?.root.traverse(o => { if (o.isMesh && !o.isInstancedMesh) { o.userData.seat = p; bodies.push(o); } }); }
    const b = castAt(x, y, bodies);
    return b ? { uid: null, player: b.object.userData.seat, point: b.point.clone() } : null;
  }
  // A hand card under the point: { seat, index, id } or null.
  function pickCard(x, y) {
    const list = [], at = new Map();
    // a hidden card (the hand of the other fly in play mode) gives no id
    for (let p = 0; p < 2; p++) Z.hand[p].forEach((o, i) => { list.push(o.mesh); at.set(o.mesh, { seat: p, index: i, id: o.hidden ? null : o.id }); });
    const h = castAt(x, y, list);
    return h ? at.get(h.object) : null;
  }
  // Any card under the point, for the card zoom (ui/cardzoom.js):
  // { id, zone, seat, uid } or null. zone: hand, perm, held (a card
  // being cast), grave, tossed. A hidden card (the question-mark back of
  // play mode) gives id null, so the zoom never shows its face.
  function pickFace(x, y) {
    const list = [], at = new Map();
    const add = (o, zone, seat) => { if (!o?.mesh?.visible) return; list.push(o.mesh); at.set(o.mesh, { id: o.hidden ? null : o.id, zone, seat, uid: o.uid ?? null }); };
    for (let p = 0; p < 2; p++) {
      Z.hand[p].forEach(o => add(o, 'hand', p));
      Z.grave[p].forEach(o => add(o, 'grave', p));
      add(Z.held[p], 'held', p);
      for (const pe of mirrorOf()?.players[p].battlefield || []) add(Z.perms.get(pe.uid), 'perm', p);
    }
    Z.tossed.forEach(o => add(o, 'tossed', -1));
    const h = castAt(x, y, list);
    return h ? at.get(h.object) : null;
  }
  return { pickPermanent, pickCard, pickFace };
}
