// ============================================================================
//  FLY DUEL 3D  ·  highlight marks and block arrows  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of the closure of ui/fly3d/scene.js createDuelScene. The play
//  mode marks legal attackers, blockers and targets with rings (the layout
//  of scene.js reads hlColour and hl), and draws an arrow from each blocker
//  to its attacker. createHighlights({ scene, Z, mirror }) -> { highlight,
//  hlColour, hl, blockArrows, arrows }. mirror() gives the current mirror.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export function createHighlights'  the marks of one scene
//      grep -n 'const HL_COLOUR'                   ring colour per kind
//      grep -n 'function highlight'                set or clear the marks
//      grep -n 'const ARROW'                       arrow numbers
//      grep -n 'function blockArrows'              blocker -> attacker arrows
// ============================================================================
import * as THREE from 'three';
import { TOKENS, FLY } from '../../tokens.js';

export function createHighlights({ scene, Z, mirror: mirrorOf }) {
  // highlight(ids, kind) or highlight(spec). kind: 'eligible' (can act),
  // 'attack', 'block', 'target', 'pending'. spec (ui/play/play.js): {
  // eligible, attackers, blocks: [[attacker, blocker]], targets, pending }.
  // highlight(null) clears every mark. A step mark (attacking, blocking,
  // a spell target) wins over a highlight mark.
  const HL_COLOUR = { eligible: TOKENS.ink2, attack: null, block: null, target: TOKENS.app, pending: TOKENS.ink };
  const hl = new Map();
  function highlight(a, kind) {
    if (a == null) { hl.clear(); hlPairs = []; return hl.size; }
    if (Array.isArray(a)) {
      const k = HL_COLOUR[kind] !== undefined ? kind : 'eligible';
      for (const [u, v] of [...hl]) if (v === k) hl.delete(u);
      for (const u of a) if (u != null) hl.set(u, k);
      return hl.size;
    }
    hl.clear();
    hlPairs = [];
    const add = (list, k) => { for (const u of list || []) if (u != null && u !== -1) hl.set(u, k); };
    add(a.eligible, 'eligible');
    add(a.targets, 'target');
    add(a.attackers, 'attack');
    const bl = Array.isArray(a.blocks) ? a.blocks : a.blocks && typeof a.blocks === 'object' ? Object.entries(a.blocks).map(([x, y]) => [+x, y]) : [];
    for (const q of bl) { if (Array.isArray(q)) { hl.set(q[1], 'block'); if (!hl.has(q[0])) hl.set(q[0], 'attack'); hlPairs.push([q[0], q[1]]); } }
    add(a.pending, 'pending');
    return hl.size;
  }
  const hlColour = (uid, seat) => { const k = hl.get(uid); return k == null ? null : HL_COLOUR[k] ?? FLY[seat]; };
  // Block arrows (play mode): a flat bar with a head from each blocker to
  // the attacker that it blocks (highlight spec blocks), in the colour of
  // the blocker's seat, just over the cards. blockArrows() runs each frame,
  // so an arrow follows its cards. highlight(null) or a spec with no
  // blocks takes the arrows off.
  let hlPairs = [];
  const arrows = new THREE.Group(); arrows.name = 'block-arrows';
  scene.add(arrows);
  const ARROW = { w: 0.07, t: 0.012, head: 0.24, headR: 0.13, gapB: 0.38, gapA: 0.46, lift: 0.07 };
  const arrowBar = new THREE.BoxGeometry(1, 1, 1);
  const arrowHead = new THREE.ConeGeometry(1, 1, 3).rotateX(Math.PI / 2);   // the tip at +z
  const _a0 = new THREE.Vector3(), _a1 = new THREE.Vector3(), _ad = new THREE.Vector3();
  function blockArrows() {
    const live = hlPairs.filter(([a, b]) => Z.perms.get(a) && Z.perms.get(b));
    while (arrows.children.length < live.length) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: TOKENS.ink });
      g.add(new THREE.Mesh(arrowBar, mat), new THREE.Mesh(arrowHead, mat));
      arrows.add(g);
    }
    arrows.children.forEach((g, i) => {
      const q = live[i];
      g.visible = !!q;
      if (!q) return;
      const [a, b] = q;
      const seat = mirrorOf()?.players.findIndex(pl => pl.battlefield.some(x => x.uid === b)) ?? -1;
      g.children[0].material.color.set(FLY[seat] || TOKENS.ink);
      _a0.copy(Z.perms.get(b).mesh.position); _a1.copy(Z.perms.get(a).mesh.position);
      _a0.y = _a1.y = Math.max(_a0.y, _a1.y) + ARROW.lift;
      _ad.subVectors(_a1, _a0);
      const d = _ad.length();
      if (d < 1e-3) { g.visible = false; return; }
      _ad.multiplyScalar(1 / d);
      const len = Math.max(0.05, d - ARROW.gapB - ARROW.gapA - ARROW.head);
      g.position.copy(_a0).addScaledVector(_ad, ARROW.gapB);
      g.lookAt(_a1);
      const [bar, head] = g.children;
      bar.scale.set(ARROW.w, ARROW.t, len); bar.position.set(0, 0, len / 2);
      head.scale.set(ARROW.headR, ARROW.t * 2, ARROW.head); head.position.set(0, 0, len + ARROW.head / 2);
    });
  }
  return { highlight, hlColour, hl, blockArrows, arrows };
}
