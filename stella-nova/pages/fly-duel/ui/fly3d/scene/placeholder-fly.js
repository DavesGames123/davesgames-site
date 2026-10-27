// ============================================================================
//  FLY DUEL 3D  ·  the stand-in fly  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. A stand-in fly with the API of
//  ui/fly3d/fly.js: buildFly, animate and CLIPS. The scene uses it until
//  the dynamic import of fly.js works. The legs use two-bone IK.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'function placeholderBuildFly'    stand-in fly
//      grep -n 'function legTo'                  two-bone leg IK
//      grep -n 'function placeholderAnimate'     stand-in clips
//      grep -n 'export const PLACEHOLDER_CLIPS'  clip lengths
//      grep -n 'export const PLACEHOLDER_FLY'    the stand-in module
// ============================================================================
import * as THREE from 'three';

// ======================================================== placeholder fly
// Stand-in with the API of ui/fly3d/fly.js. Origin at the seat, +y up, +z
// forward (toward the table). About TABLE.flyH tall.
function placeholderBuildFly({ colour = '#39d0f0', seed = 1, detail = 'high' } = {}) {
  const root = new THREE.Group(); root.name = 'fly-placeholder';
  const tan = new THREE.MeshStandardMaterial({ color: 0xc8954e, roughness: 0.55 });
  const ochre = new THREE.MeshStandardMaterial({ color: 0xa8732f, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 });
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xa3242a, roughness: 0.28, metalness: 0.05 });
  const wingM = new THREE.MeshPhysicalMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.32, roughness: 0.12, iridescence: 1, iridescenceIOR: 1.3, side: THREE.DoubleSide, depthWrite: false });
  const collarM = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), roughness: 0.4, emissive: new THREE.Color(colour), emissiveIntensity: 0.2 });
  const seg = detail === 'low' ? 10 : 20;
  const ell = (rx, ry, rz, m) => { const e = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), m); e.scale.set(rx, ry, rz); e.castShadow = true; return e; };
  const body = new THREE.Group(); root.add(body);
  const abdomen = new THREE.Group(); abdomen.position.set(0, 0.42, -0.08); body.add(abdomen);
  abdomen.add(ell(0.4, 0.5, 0.4, tan));
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.39 - i * 0.06, 0.05, 6, seg), dark); b.rotation.x = Math.PI / 2; b.position.y = -0.05 - i * 0.16; b.scale.set(1, 1, 1); abdomen.add(b); }
  const thorax = new THREE.Group(); thorax.position.set(0, 1.05, 0.02); body.add(thorax);
  thorax.add(ell(0.33, 0.36, 0.31, ochre));
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, seg), collarM); collar.rotation.x = Math.PI / 2 - 0.2; collar.position.set(0, 0.33, 0.04); thorax.add(collar);
  const head = new THREE.Group(); head.position.set(0, 1.62, 0.1); body.add(head);
  head.add(ell(0.25, 0.22, 0.22, tan));
  const eyes = [-1, 1].map(s => { const e = ell(0.17, 0.2, 0.16, eyeM); e.position.set(s * 0.19, 0.03, 0.06); head.add(e); return e; });
  const prob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.22, 8), ochre); prob.position.set(0, -0.2, 0.12); prob.rotation.x = 0.4; head.add(prob);
  const antennae = [-1, 1].map(s => {
    const a = new THREE.Group(); a.position.set(s * 0.06, 0.08, 0.2); head.add(a);
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 6), ochre); s1.position.y = 0.05; a.add(s1);
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ochre); s2.position.y = 0.12; a.add(s2);
    const ar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 4), dark); ar.position.set(s * 0.06, 0.2, 0.03); ar.rotation.z = -s * 0.6; a.add(ar);
    a.rotation.x = 0.5;
    return a;
  });
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.bezierCurveTo(0.25, 0.1, 0.9, 0.05, 1.0, -0.12); wingShape.bezierCurveTo(0.85, -0.3, 0.3, -0.26, 0, -0.06);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 12);
  const wings = [-1, 1].map(s => {
    const w = new THREE.Group(); w.position.set(s * 0.18, 1.18, -0.18); body.add(w);
    const m = new THREE.Mesh(wingGeo, wingM); m.scale.set(s * 0.9, 0.9, 0.9); m.rotation.y = s * Math.PI / 2; w.add(m);
    w.rotation.set(0.9, 0, -s * 0.35);
    return w;
  });
  // legs: segments placed every frame from two-bone IK
  const segGeo = new THREE.CylinderGeometry(1, 0.8, 1, 6); segGeo.translate(0, 0.5, 0);
  const attach = [[-0.16, 0.93, 0.2], [0.16, 0.93, 0.2], [-0.26, 0.88, 0.06], [0.26, 0.88, 0.06], [-0.22, 0.78, -0.06], [0.22, 0.78, -0.06]];
  const lens = [[0.42, 0.42, 0.18], [0.42, 0.42, 0.18], [0.5, 0.52, 0.2], [0.5, 0.52, 0.2], [0.5, 0.5, 0.18], [0.5, 0.5, 0.18]];
  const legs = attach.map((a, i) => {
    const segs = [0, 1, 2].map(k => { const m = new THREE.Mesh(segGeo, k === 2 ? dark : ochre); m.castShadow = true; root.add(m); return m; });
    return { attach: new THREE.Vector3(...a), len: lens[i], segs, target: new THREE.Vector3(), side: i % 2 ? 1 : -1, r: [0.04, 0.032, 0.022] };
  });
  const rig = { root, body, head, eyes, antennae, wings, abdomen, thorax, legs, seed, phase: (seed * 1.7) % 6.28 };
  const dispose = () => { root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } }); [tan, ochre, dark, eyeM, wingM, collarM].forEach(m => m.dispose()); };
  return { root, rig, dispose };
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function placeSeg(m, a, b, r) {
  _v1.subVectors(b, a); const l = _v1.length() || 1e-4;
  m.position.copy(a); m.quaternion.setFromUnitVectors(_up, _v1.multiplyScalar(1 / l)); m.scale.set(r, l, r);
}
// Two-bone IK in the fly's local space: hip -> knee -> ankle, then the
// tarsus to the target. pole: the side the knee bends to.
function legTo(leg, target, pole) {
  const H = _v2.copy(leg.attach), [a, b, c] = leg.len;
  const P = new THREE.Vector3().copy(target);
  const dir = new THREE.Vector3().subVectors(P, H);
  let d = dir.length(); dir.normalize();
  const ankle = new THREE.Vector3().copy(P).addScaledVector(dir, -c);
  const toA = new THREE.Vector3().subVectors(ankle, H); d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, toA.length())); toA.normalize();
  const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const perp = new THREE.Vector3().copy(pole).addScaledVector(toA, -pole.dot(toA)).normalize();
  const knee = new THREE.Vector3().copy(H).addScaledVector(toA, a * ca).addScaledVector(perp, a * sa);
  const ank = new THREE.Vector3().copy(H).addScaledVector(toA, d);
  placeSeg(leg.segs[0], H, knee, leg.r[0]);
  placeSeg(leg.segs[1], knee, ank, leg.r[1]);
  placeSeg(leg.segs[2], ank, _v3.copy(ank).addScaledVector(toA, c * 0.4).add(new THREE.Vector3(0, -c * 0.8, 0)).lerp(P, 0.6), leg.r[2]);
}

// Clips: idle, think, groom, reach, place, tap, push, raiseArms, slump.
// t: seconds into the clip. opts: { dur, time, hand, rest, target, droop,
// shake } (points in world space).
function placeholderAnimate(rig, clipIn, t, opts = {}) {
  const clip = typeof clipIn === 'string' ? clipIn : clipIn?.name || 'idle';
  if (clipIn && typeof clipIn === 'object' && clipIn.target) opts = { ...opts, target: clipIn.target };
  const time = opts.time ?? t, dur = PLACEHOLDER_CLIPS[clip]?.duration || 1, k = Math.min(1, t / dur);
  const env = Math.sin(Math.PI * k);
  const root = rig.root;
  const local = v => v ? root.worldToLocal(_v3.copy(v)).clone() : null;
  const hand = local(opts.hand) || new THREE.Vector3(0, 1.3, 0.8);
  const rest = local(opts.rest) || new THREE.Vector3(0, 0.6, 0.9);
  const tgt = local(opts.target);
  // breathing and idle head motion
  rig.abdomen.scale.set(1, 1 + 0.025 * Math.sin(time * 2.1 + rig.phase), 1);
  rig.head.rotation.set(0.05 * Math.sin(time * 0.7 + rig.phase), 0.12 * Math.sin(time * 0.43 + rig.phase), 0);
  const tw = Math.sin(time * 9 + rig.phase) * 0.06;
  rig.antennae.forEach((a, i) => { a.rotation.x = 0.5 + tw * (i ? 1 : -1); });
  const droop = opts.droop || 0;
  rig.wings.forEach((w, i) => { const s = i ? 1 : -1; w.rotation.set(0.9 + droop * 0.5, 0, -s * (0.35 - droop * 0.25)); });
  rig.body.rotation.set(0, 0, 0); rig.body.position.set(0, 0, 0);
  let fl = new THREE.Vector3(hand.x - 0.22, hand.y, hand.z), fr = new THREE.Vector3(hand.x + 0.22, hand.y, hand.z);
  let ml = new THREE.Vector3(rest.x - 0.55, rest.y, rest.z), mr = new THREE.Vector3(rest.x + 0.55, rest.y, rest.z);
  const hl = new THREE.Vector3(-0.5, 0.0, 0.2), hr = new THREE.Vector3(0.5, 0.0, 0.2);
  switch (clip) {
    case 'think':
      rig.head.rotation.x += 0.25 * env; rig.head.rotation.z = 0.15 * env * Math.sin(rig.phase + 1);
      rig.antennae.forEach((a, i) => { a.rotation.x = 0.5 + Math.sin(time * 26 + i) * 0.18 * env; });
      break;
    case 'groom': {
      const rub = Math.sin(time * 14) * 0.06;
      const hp = new THREE.Vector3(0, 1.55, 0.32);
      fl.lerp(new THREE.Vector3(hp.x - 0.1 + rub, hp.y, hp.z), env); fr.lerp(new THREE.Vector3(hp.x + 0.1 - rub, hp.y, hp.z), env);
      rig.head.rotation.x += 0.2 * env;
      break;
    }
    case 'reach': if (tgt) fr.lerp(tgt, env); rig.head.rotation.x += 0.2 * env; break;
    case 'place': case 'tap': if (tgt) mr.lerp(tgt, env); rig.body.rotation.x = 0.12 * env; rig.head.rotation.x += 0.25 * env; break;
    case 'push': if (tgt) { ml.lerp(new THREE.Vector3(tgt.x - 0.3, tgt.y, tgt.z), env); mr.lerp(new THREE.Vector3(tgt.x + 0.3, tgt.y, tgt.z), env); } rig.body.rotation.x = 0.18 * env; break;
    case 'raiseArms': {
      const up = Math.min(1, k * 4);
      fl.lerp(new THREE.Vector3(-0.55, 2.1, 0.25), up); fr.lerp(new THREE.Vector3(0.55, 2.1, 0.25), up);
      rig.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.35 + 0.5 * Math.abs(Math.sin(time * 38))); });
      rig.head.rotation.x = -0.25 * up;
      break;
    }
    case 'slump': {
      const s = Math.min(1, k * 3);
      rig.body.rotation.x = 0.35 * s; rig.head.rotation.x = 0.5 * s;
      fl.lerp(new THREE.Vector3(-0.3, 0.75, 0.75), s); fr.lerp(new THREE.Vector3(0.3, 0.75, 0.75), s);
      rig.wings.forEach((w, i) => { w.rotation.x = 1.5; w.rotation.z = (i ? -1 : 1) * 0.05; });
      break;
    }
    default: break;
  }
  if (opts.shake) rig.body.position.x = Math.sin(time * 31) * 0.012;
  const pole = new THREE.Vector3(0, -0.3, -1);
  const legsT = [fl, fr, ml, mr, hl, hr];
  rig.legs.forEach((leg, i) => {
    const pl = i < 2 ? new THREE.Vector3(leg.side * 1, -1, -0.2) : i < 4 ? new THREE.Vector3(leg.side, 1, 0) : new THREE.Vector3(leg.side, 0.4, 1);
    legTo(leg, legsT[i], pl.normalize().add(pole.clone().multiplyScalar(0.2)));
  });
}
// Clip lengths of the stand-in: the CLIPS table shape of ui/fly3d/fly.js.
export const PLACEHOLDER_CLIPS = {
  idle: { duration: 6, loop: true }, think: { duration: 2, loop: true }, groom: { duration: 2.8 },
  reach: { duration: 1.0, contact: 0.48 }, place: { duration: 1.3, contact: 0.66 }, tap: { duration: 0.8, contact: 0.36 },
  push: { duration: 1.2, contact: 0.38 }, raiseArms: { duration: 1.4, hold: true }, slump: { duration: 1.6, hold: true },
};
export const PLACEHOLDER_FLY = { buildFly: placeholderBuildFly, animate: placeholderAnimate, CLIPS: PLACEHOLDER_CLIPS, placeholder: true };
