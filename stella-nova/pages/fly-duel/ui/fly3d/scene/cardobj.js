// ============================================================================
//  FLY DUEL 3D  ·  one card on the table  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. CardObj is one card mesh with its ring.
//  It moves toward its target on an arc, dims, glows, pulses and lunges.
//  W is the scene world of createDuelScene (tex, cardGeo, ringGeo, backMat,
//  edgeMat, mysteryMat, cards, reduced).
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export class CardObj'  one card on the table
//      grep -n 'setHidden(on)'         question-mark caps, no id
//      grep -n '  target('             start a move
//      grep -n '  update(dt)'          one frame of the move
// ============================================================================
import * as THREE from 'three';
import { CARD } from '../../../game/cards.js';
import { PALETTE, colourKey } from '../../art.js';
import { TOKENS } from '../../tokens.js';
import { TABLE as T } from './table.js';
import { easeIO } from './ease.js';

// One card on the table. It moves toward its target with an arc.
export class CardObj {
  constructor(W, id) {
    this.W = W; this.id = id; this.uid = null;
    const face = W.tex.face(id);
    this.front = new THREE.MeshStandardMaterial({
      map: face || null, color: face ? 0xffffff : new THREE.Color(PALETTE[colourKey(CARD[id]?.colour)]?.ink || TOKENS.none),
      roughness: 0.58, metalness: 0, emissive: 0xffffff, emissiveMap: face || null, emissiveIntensity: 0,
    });
    this.mesh = new THREE.Mesh(W.cardGeo, [this.front, W.backMat, W.edgeMat]);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.userData.card = id;
    this.ring = new THREE.Mesh(W.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    this.ring.position.z = -T.cardT / 2 - 0.002; this.ring.visible = false;
    this.mesh.add(this.ring);
    this.badge = null; this.badgeKey = '';
    this.fromP = new THREE.Vector3(); this.fromQ = new THREE.Quaternion();
    this.toP = new THREE.Vector3(); this.toQ = new THREE.Quaternion();
    this.t = 1; this.dur = 0; this.arc = 0;
    this.next = null;                 // { dur, arc } for the next move
    this.dim = 1; this.dimTo = 1; this.glow = 0; this.glowTo = 0;
    this.scale = 1; this.scaleTo = 1;
    this.lunge = null;                // { dir: Vector3, t, dur }
    this.pulse = 0;
    this.hidden = false;
    W.cards.add(this.mesh);
  }
  // Hidden (play mode, a hand card of the other fly): both caps show the
  // question-mark back, and the mesh carries no card id.
  setHidden(on) {
    on = !!on;
    if (on === this.hidden) return;
    this.hidden = on;
    const ms = this.mesh.material;
    ms[0] = on ? this.W.mysteryMat : this.front;
    ms[1] = on ? this.W.mysteryMat : this.W.backMat;
    this.mesh.userData.card = on ? null : this.id;
  }
  place(p, q) { this.mesh.position.copy(p); this.mesh.quaternion.copy(q); this.toP.copy(p); this.toQ.copy(q); this.t = 1; this.dur = 0; }
  // Move toward p, q. A zone change (this.next) always starts a new arc.
  // follow: a small change of the target (a fan that moves with the
  // fly's hand) changes the end point and does not start a new move.
  target(p, q, dur = 0.35, arc = 0, follow = false) {
    let delay = 0;
    const d2 = this.toP.distanceToSquared(p), dq = Math.abs(this.toQ.dot(q));
    if (this.next) { ({ dur, arc } = this.next); delay = this.next.delay || 0; this.next = null; }
    else {
      if (d2 < 1e-8 && dq > 0.999999) return;
      if (follow && d2 < 0.0025 && dq > 0.9995) { this.toP.copy(p); this.toQ.copy(q); return; }
    }
    this.fromP.copy(this.basePos ?? this.mesh.position); this.fromQ.copy(this.mesh.quaternion);
    this.toP.copy(p); this.toQ.copy(q);
    this.t = 0; this.dur = this.W.reduced ? 0 : Math.max(0, dur); this.arc = arc;
    this.delay = this.W.reduced ? 0 : delay;
  }
  update(dt) {
    const m = this.mesh;
    if (this.delay > 0) { this.delay -= dt; dt = this.delay < 0 ? -this.delay : 0; if (this.delay < 0) this.delay = 0; }
    if (this.delay > 0) { /* wait at the start pose */ }
    else if (this.t < 1) {
      this.t = this.dur > 0 ? Math.min(1, this.t + dt / this.dur) : 1;
      const e = easeIO(this.t);
      m.position.lerpVectors(this.fromP, this.toP, e);
      m.position.y += this.arc * 4 * e * (1 - e);
      m.quaternion.slerpQuaternions(this.fromQ, this.toQ, e);
    } else { m.position.copy(this.toP); m.quaternion.copy(this.toQ); }
    this.basePos = this.basePos || new THREE.Vector3();
    this.basePos.copy(m.position);
    if (this.lunge) {
      const L = this.lunge; L.t += dt;
      const k = Math.min(1, L.t / L.dur);
      m.position.addScaledVector(L.dir, Math.sin(Math.PI * k) * L.len);
      if (k >= 1) this.lunge = null;
    }
    const a = 1 - Math.exp(-dt * 14);
    this.dim += (this.dimTo - this.dim) * a;
    this.glow += (this.glowTo - this.glow) * a;
    this.scale += (this.scaleTo - this.scale) * a;
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 2.2);
    const s = this.scale * (1 + 0.12 * Math.sin(Math.PI * this.pulse));
    m.scale.setScalar(s);
    this.front.color.setScalar(this.dim);
    this.front.emissiveIntensity = this.glow;
  }
  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.front.dispose(); this.ring.material.dispose();
    if (this.badge) { this.badge.material.map?.dispose(); this.badge.material.dispose(); }
  }
}
