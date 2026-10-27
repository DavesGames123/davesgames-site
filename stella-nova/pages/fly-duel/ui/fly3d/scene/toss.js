// ============================================================================
//  FLY DUEL 3D  ·  the toss: thrown cards  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of the closure of ui/fly3d/scene.js createDuelScene. The loser
//  throws its hand: ballistic arcs with spin, landing on the table, on the
//  cards there or on the floor, then a turn to flat and a short slide.
//  createToss({ Z, W, seed }) -> { start(p), update(dt, instant) }.
//  Z: the card zones of the scene (hand, perms, grave, tossed). W: the
//  scene world (W.reduced). seed(): the seed of the current record.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'export function createToss'  the toss of one scene
//      grep -n 'const TOSS'                  gravity, rest and slide numbers
//      grep -n 'function tossLaunch'         launch of one card
//      grep -n 'function tossStart'          the hand leaves the fan
//      grep -n 'function restOn'             rest height on the table
//      grep -n 'function tossLand'           landing: flat, face up or down
//      grep -n 'function tossUpdate'         thrown cards: flight, landing
// ============================================================================
import * as THREE from 'three';
import { TABLE as T } from './table.js';
import { easeOut, rngf } from './ease.js';

export function createToss({ Z, W, seed: seedOf }) {
  // ---------------------------------------------------------- the toss
  // The loser throws its hand (choreo op toss, user: "we should have the
  // loser throw their cards and put their head down on the table if they
  // lose"). The fly plays headDown; at CLIPS.headDown.release the cards
  // leave the fan and fly on ballistic arcs with spin. A card lands on the
  // table top (or on a card that lies there) when it comes down inside the
  // table, else on the floor. Below the table top a card does not go into
  // the table: it hits the side and drops. On landing the card turns flat
  // (face up or down, as it fell) and slides a little. Z.tossed holds the
  // thrown cards; the mirror keeps them in the hand (stats().hand counts
  // them). Reduced motion: the fly cuts to the end pose and the cards
  // are at once where the same throw puts them. In play mode the human
  // seat does not throw (the human has no body): that fly keeps the slump.
  const TOSS = { g: 16, rest: 0.005, floorRest: 0.005, stackGap: 0.0016, slide: 0.15, settle: 0.12, maxT: 6 };
  const _tv = new THREE.Vector3(), _tw = new THREE.Vector3(), _tq = new THREE.Quaternion(), _tn = new THREE.Vector3(), _te = new THREE.Euler();
  const insideTable = (x, z, m = 0) => Math.abs(x) <= T.halfLen - m && Math.abs(z) <= T.halfDepth - m;
  // The launch of card i of n of seat p: a fan of forward throws, and now
  // and then a card that slips out to the side and falls to the floor.
  function tossLaunch(p, i, n, seed) {
    const r = rngf((seed * 977 + p * 131 + i * 31 + 7) >>> 0);
    const side = p === 0 ? 1 : -1;
    let a = (n > 1 ? (i / (n - 1) - 0.5) * 1.15 : 0) + (r() - 0.5) * 0.35;
    let sp = 2.4 + 2.2 * r(), vy = 2.6 + 1.6 * r();
    if (n > 2 && r() < 0.2) { a = (r() < 0.5 ? -1 : 1) * (1.6 + 0.4 * r()); sp = 2.6 + 1.2 * r(); vy = 1.6 + 1.0 * r(); }
    const vel = new THREE.Vector3(side * Math.sin(a) * sp, vy, -side * Math.cos(a) * sp);
    const spin = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(9 + 9 * r());
    return { vel, spin };
  }
  function tossStart(p) {
    const H = Z.hand[p];
    if (!H.length) return;
    const seed = seedOf();
    const n = H.length;
    H.splice(0).forEach((o, i) => {
      const { vel, spin } = tossLaunch(p, i, n, seed);
      o.toss = { p, vel, spin, rested: false, landT: 0, slideV: new THREE.Vector3(), fromQ: new THREE.Quaternion(), toQ: new THREE.Quaternion(), surface: null };
      o.ring.visible = false; o.lunge = null; o.t = 1; o.delay = 0;
      Z.tossed.push(o);
    });
    if (W.reduced) { for (let k = 0; k < TOSS.maxT * 120 && Z.tossed.some(o => !o.toss.rested); k++) tossUpdate(1 / 120, true); }
  }
  // Rest height at (x, z) on the table: the table top, or over the cards
  // already there (permanents, graveyard, other thrown cards).
  function restOn(x, z, self) {
    let y = T.y + TOSS.rest;
    const near = (o) => { const q = o.mesh.position; if (Math.abs(q.x - x) < T.cardH * 0.7 && Math.abs(q.z - z) < T.cardH * 0.7 && q.y > T.y - 0.01) y = Math.max(y, q.y + TOSS.stackGap + 0.004); };
    for (const o of Z.perms.values()) near(o);
    for (const g of Z.grave) for (const o of g) near(o);
    for (const o of Z.tossed) if (o !== self && o.toss.rested && o.toss.surface === 'table') near(o);
    return y;
  }
  function tossLand(o, surface, y) {
    const st = o.toss, m = o.mesh;
    st.surface = surface; st.rested = true; st.landT = 0;
    m.position.y = y;
    // flat, face up or down as it fell, the heading of the card kept
    _tn.set(0, 0, 1).applyQuaternion(m.quaternion);
    const up = _tn.y >= 0;
    _tw.set(0, 1, 0).applyQuaternion(m.quaternion); _tw.y = 0;
    // Rx(-pi/2) puts the card top at -z (face up), Rx(pi/2) at +z
    const yaw = _tw.lengthSq() > 1e-6 ? (up ? Math.atan2(-_tw.x, -_tw.z) : Math.atan2(_tw.x, _tw.z)) : 0;
    st.fromQ.copy(m.quaternion);
    st.toQ.setFromEuler(_te.set(up ? -Math.PI / 2 : Math.PI / 2, yaw, 0, 'YXZ'));
    st.slideV.set(st.vel.x, 0, st.vel.z).multiplyScalar(TOSS.slide / Math.max(1e-6, Math.hypot(st.vel.x, st.vel.z)) * Math.min(1, Math.hypot(st.vel.x, st.vel.z) / 4));
    st.vel.set(0, 0, 0);
  }
  function tossUpdate(dt, instant = false) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    for (const o of Z.tossed) {
      const st = o.toss, m = o.mesh;
      if (st.rested) {
        if (st.landT >= 1) continue;
        st.landT = instant ? 1 : Math.min(1, st.landT + dt / TOSS.settle);
        const k = easeOut(st.landT);
        m.quaternion.slerpQuaternions(st.fromQ, st.toQ, k);
        // a short slide, which stays on the table when it landed there
        const nx = m.position.x + st.slideV.x * (instant ? 1 : dt / TOSS.settle) * (1 - k * 0.5);
        const nz = m.position.z + st.slideV.z * (instant ? 1 : dt / TOSS.settle) * (1 - k * 0.5);
        if (st.surface !== 'table' || insideTable(nx, nz, 0.02)) { m.position.x = nx; m.position.z = nz; }
        if (st.landT >= 1) { m.quaternion.copy(st.toQ); if (st.surface === 'table') m.position.y = restOn(m.position.x, m.position.z, o); }
        continue;
      }
      for (let k = 0; k < steps && !st.rested; k++) {
        const prevY = m.position.y;
        st.vel.y -= TOSS.g * h;
        const nx = m.position.x + st.vel.x * h, ny = m.position.y + st.vel.y * h, nz = m.position.z + st.vel.z * h;
        const inNow = insideTable(nx, nz);
        if (ny < T.y && inNow && prevY >= T.y - 1e-6) {
          // down onto the table top (or the cards on it)
          m.position.x = nx; m.position.z = nz;
          tossLand(o, 'table', restOn(nx, nz, o));
          break;
        }
        if (ny < T.y && inNow && prevY < T.y) {
          // under the top level and moving into the table: hit the side
          if (Math.abs(nx) > T.halfLen - 1e-3 || Math.abs(m.position.x) > T.halfLen) st.vel.x *= -0.2;
          if (Math.abs(nz) > T.halfDepth - 1e-3 || Math.abs(m.position.z) > T.halfDepth) st.vel.z *= -0.2;
          m.position.y = ny;
        } else m.position.set(nx, ny, nz);
        if (m.position.y <= TOSS.floorRest) { tossLand(o, 'floor', TOSS.floorRest + Z.tossed.filter(x => x.toss.rested && x.toss.surface === 'floor').length * TOSS.stackGap); break; }
        // spin
        _tq.setFromAxisAngle(_tv.copy(st.spin).normalize(), st.spin.length() * h);
        m.quaternion.premultiply(_tq);
      }
    }
  }
  return { start: tossStart, update: tossUpdate };
}
