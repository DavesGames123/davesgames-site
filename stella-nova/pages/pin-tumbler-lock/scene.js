// ============================================================================
//  PIN TUMBLER LOCK  ·  scene.js — the 3D parts of one lock, and their pose
// ────────────────────────────────────────────────────────────────────────────
//  build(B, L) makes every part of lock L (lock.js) with the builder B
//  (kit.js) and returns:
//    pose(st, ek) ..... places the key, the plug, each stack, the cam and the
//                       bolt for the state st = L.state(key, s, θ). ek is
//                       the explode amount (springs relax to free length).
//    stacks ........... per chamber, the parts that can block: { kp, dp, wf }
//    shear ............ the shear-line overlays (y = R; for wafers also −R)
//    box .............. the assembled bounds { c: [x, y, z], R }
//    explodeShift ..... the move of the bounds centre when fully exploded
//  Every size comes from L.g, so the model and the analysis agree.
//
//  EXPLODE PATHS. The key leaves first (main.js withdraws it as the parts
//  start to part), then drops below the axis and slides back under the
//  housing. Pin tumbler: the cap, the
//  springs, the drivers and the key pins lift up their own chambers to a
//  row above the housing; the bolt and case, the cam and the clip go back;
//  then the plug slides out of the front through the collar. Wafer lock:
//  the strike, the cam and the clip go back, then the plug, with its
//  wafers and springs in their slots, slides out of the back.
//
//  GREP MAP
//    function keyway ........... the keyway outline, (z, y)
//    function keyParts ......... blade (with ward grooves), neck and bow
//    function pinTumbler ....... the pin tumbler parts
//    function waferLock ........ the wafer lock parts
//    export function build ..... common parts, bounds, explode shift
// ============================================================================
import * as THREE from 'three';
import { lathe, rod, rrect, circlePath, slabXZ, slabXY, alongX, merge, zyExtrude, arcPts, plugCrown, createSpring, clipY, ease } from './kit.js';
import { keyTop, camPin } from './lock.js';

const PI = Math.PI;
const circle = (r, n = 96, cz = 0, cy = 0) => arcPts(r, 0, 2 * PI, n, cz, cy).slice(0, -1);

// the keyway, clockwise from the top left, (z, y)
function keyway(g) {
  if (g.type === 'pin') {
    const c = g.chanW, w = g.slotW, A = g.wards[0], Bw = g.wards[1];
    return [[-c, g.wayTop], [-c, g.ledgeY], [-w, g.ledgeY], [-w, Bw.y1], [-Bw.z, Bw.y1], [-Bw.z, Bw.y0], [-w, Bw.y0], [-w, g.wayBot],
      [w, g.wayBot], [w, A.y0], [A.z, A.y0], [A.z, A.y1], [w, A.y1], [w, g.ledgeY], [c, g.ledgeY], [c, g.wayTop]];
  }
  const w = g.slot, A = g.wards[0];
  return [[-w, g.wayTop], [-w, g.wayBot], [w, g.wayBot], [w, A.y0], [A.z, A.y0], [A.z, A.y1], [w, A.y1], [w, g.wayTop]];
}

// the key at full insertion: blade side outline from keyTop, layered in z
// so the ward grooves run along it; a full-thickness neck and a bow
function keyParts(B, p, g, bit) {
  const k = g.key, xs = k.shoulder;
  const us = new Set();
  for (let u = -k.len; u <= 0; u += 0.05) us.add(+u.toFixed(4));
  for (let i = 0; i < g.n; i++) {
    const ui = g.X[i] - xs, c = k.cut(bit[i]), run = (k.yTop - c) / k.slope;
    for (const d of [-k.flat / 2 - run, -k.flat / 2, k.flat / 2, k.flat / 2 + run]) us.add(+(ui + d).toFixed(5));
  }
  us.add(-k.len + k.tipLen); us.add(0);
  const top = [...us].filter(u => u >= -k.len && u <= 0).sort((a, b) => a - b).map(u => [u + xs, keyTop(g, bit, u)]);
  const prof = [[xs - k.len, k.yBot + 0.7], ...top, [xs, k.yBot], [xs - k.len + 1.2, k.yBot]];
  const slab = (pts, z0, z1) => slabXY(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), z0, z1 - z0, 0);
  const t = k.thick / 2, gs = [];
  const plus = k.grooves.find(q => q.side > 0), minus = k.grooves.find(q => q.side < 0);
  const layer = (gr, z0, z1) => {
    if (!gr) { gs.push(slab(prof, z0, z1)); return; }
    gs.push(slab(clipY(prof, gr.y1, true), z0, z1), slab(clipY(prof, gr.y0, false), z0, z1));
  };
  const zp = plus ? plus.z : t, zm = minus ? minus.z : t;
  layer(minus, -t, -zm);
  gs.push(slab(prof, -zm, zp));
  layer(plus, zp, t);
  B.mesh(p, merge(gs), 'nickel');
  // the neck: its top edge is the shoulder that stops on the plug face
  const neckTop = g.type === 'pin' ? 5.2 : 4.6;
  B.mesh(p, slabXY(rrect(4.6, neckTop - k.yBot, 0.5, xs + 2.3, (neckTop + k.yBot) / 2), -t, 2 * t, 0.15), 'nickel');
  // the bow, with a ring hole and a shallow grip panel
  const bow = new THREE.Shape(); bow.absarc(xs + 13.2, 0.4, 9.2, 0, 2 * PI, false);
  bow.holes.push(circlePath(2.6, xs + 18.6, 0.4));
  B.mesh(p, slabXY(bow, -1.3, 2.6, 0.45), 'nickel');
  const panel = new THREE.Shape(); panel.absellipse(xs + 10.6, 0.4, 4.4, 5.6, 0, 2 * PI, false);
  B.mesh(p, slabXY(panel, 1.15, 0.3, 0.12), 'satin', { pick: true });
  B.mesh(p, slabXY(panel, -1.45, 0.3, 0.12), 'satin', { pick: true });
}

// key pin: domed tip of radius domeR, chamfered top, length kl
function keyPinGeom(g, kl) {
  const R = g.domeR, r = g.pinR, h = R - Math.sqrt(R * R - r * r), dome = [];
  for (let j = 0; j <= 10; j++) { const rr = r * j / 10; dome.push([rr, R - Math.sqrt(R * R - rr * rr)]); }
  return lathe([dome, [[r, kl - 0.22]], [[r - 0.22, kl]], [[0, kl]]], 40);
}
function driverGeom(g) {
  const r = g.pinR, d = g.driverLen;
  return lathe([[[0, 0]], [[r - 0.25, 0]], [[r, 0.25]], [[r, d - 0.25]], [[r - 0.25, d]], [[0, d]]], 40);
}
// the key, once out (main.js withdraws it by e = 0.32): down below the
// axis, then back under the housing, so it never crosses the collar or head
const keyPath = (dx, dy) => (e, v) => v.set(dx * ease((e - 0.55) / 0.4), dy * ease((e - 0.3) / 0.35), 0);
// a thin line that shows through every part
function overlayLine(B, x0, x1, y, col) {
  const geo = alongX(rod(0.075, x0, x1, 8)); geo.translate(0, y, 0.0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
  m.renderOrder = 10; m.castShadow = false;
  return B.extra(m);
}

// ── pin tumbler ─────────────────────────────────────────────────────────────
function pinTumbler(B, L) {
  const g = L.g, Rp = g.Rp, x0 = g.x0, x1 = g.x1, n = g.n;
  const Rq = Rp - 0.03, zt = Math.sqrt(g.Rh * g.Rh - Rp * Rp), kmax = Math.max(...g.kLen);
  const out = { kp: [], dp: [], sp: [], springs: [] };

  // housing: the round body to the shear-line height, the tower above it
  const H = B.part('housing', { cut: true, label: 'Housing', labelAt: [-3, g.yTop - 2, -zt] });
  const a0 = Math.atan2(Rp, zt), dl = 0.35, b0 = Math.atan2(Math.sqrt(Rp * Rp - dl * dl), -dl);
  const body = [...arcPts(g.Rh, a0, PI - a0 - 2 * PI, 120), [-dl, Rp], ...arcPts(Rp, b0, 2 * PI + PI - b0, 120)];
  body.push([dl, Rp]);
  B.mesh(H, zyExtrude(body, x0, x1), 'housing');
  const tw = new THREE.Shape(); tw.moveTo(x0, -zt); tw.lineTo(x1, -zt); tw.lineTo(x1, zt); tw.lineTo(x0, zt); tw.closePath();
  for (const x of g.X) tw.holes.push(circlePath(g.holeR, x, 0));
  B.mesh(H, slabXZ(tw, Rp, g.yTop - Rp, 0), 'housing');
  // two mounting screws from the tower to the case
  for (const z of [-3, 3]) { const sc = alongX(rod(1.15, -32.4, x0, 20)); sc.translate(0, 12.5, z); B.mesh(H, sc, 'steel', { pick: false }); }

  // the cap strip over the chambers
  const capY = 21 + kmax + 2.5 + g.driverLen + 2.5 + g.spring.free + 3;
  const C = B.part('cap', { cut: true, label: 'Cap strip', explode: [0, capY - g.yTop, 0], st: 0.02, labelAt: [(g.X[0] + g.X[n - 1]) / 2, g.yTop + 1, -2] });
  B.mesh(C, slabXZ(rrect(g.X[0] - g.X[n - 1] + 5.2, 5.2, 0.8, (g.X[0] + g.X[n - 1]) / 2, 0), g.yTop, g.capH, 0.2), 'housing');

  // plug: lower body with the keyway, crown with the chambers, face, boss
  const P = B.part('plug', { cut: true, label: 'Plug', explode: [30, 0, 0], st: 0.55, labelAt: [x1 + 1, -Rp, -2] });
  const yk = g.wayTop, wk = Math.sqrt(Rq * Rq - yk * yk), ka = Math.asin(yk / Rq);
  const way = keyway(g);
  const lower = [[wk, yk], ...arcPts(Rq, ka, PI - ka - 2 * PI, 120).slice(1, -1), [-wk, yk], ...way];
  B.mesh(P, zyExtrude(lower, x0, x1), 'plug');
  B.mesh(P, plugCrown(x0, x1, Rq, yk, g.X.map(x => ({ x, r: g.holeR }))), 'plug');
  B.mesh(P, zyExtrude(circle(7.3), x1, x1 + g.key.shoulder, [way]), 'plug');
  B.mesh(P, alongX(rod(4.9, x0 - 1.8, x0, 48)), 'plug');

  // pin stacks
  const gp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x = g.X[i];
    const sp = createSpring(g.spring.coilR, g.spring.wire / 2, g.spring.turns);
    const S = B.part(`sp${i}`, { info: 'spring', label: i === 0 ? 'Springs' : null, labelAt: [x, 3, 0] });
    S.explodeFn = (e, v) => { const k = ease((e - 0.05) / 0.95); v.set(0, (21 + g.kLen[i] + 2.5 + g.driverLen + 2.5 - out.pose.dt[i]) * k, 0); };
    const sm = B.mesh(S, sp.geom, 'spring'); sm.position.x = x;
    out.springs.push(sp); out.sp.push(S);
    const Dp = B.part(`dp${i}`, { info: 'driver', label: i === 0 ? 'Driver pins' : null, labelAt: [x, 2.5, 0] });
    Dp.explodeFn = (e, v) => { const k = ease((e - 0.09) / 0.91); v.set(0, (21 + g.kLen[i] + 2.5 - out.pose.db[i]) * k, 0); };
    const dg = driverGeom(g); dg.translate(x, 0, 0); B.mesh(Dp, dg, 'driver');
    out.dp.push(Dp);
    const K = B.part(`kp${i}`, { info: 'keyPin', label: i === 0 ? 'Key pins' : null, labelAt: [x, 1.5, 0] });
    K.explodeFn = (e, v) => {
      const k = ease((e - 0.13) / 0.87), th = out.pose.th, kb = out.pose.kb[i];
      gp.set(0, kb * Math.cos(th), kb * Math.sin(th));
      v.set(-gp.x * k, (21 - gp.y) * k, -gp.z * k);
    };
    const kg = keyPinGeom(g, g.kLen[i]); kg.translate(x, 0, 0); B.mesh(K, kg, 'keypin');
    out.kp.push(K);
  }

  // collar: the face ring round the front of the plug
  const Co = B.part('collar', { cut: true, explode: [5, 0, 0], st: 0.3, label: 'Collar', labelAt: [x1 + 1.6, 9, 0] });
  B.mesh(Co, alongX(lathe([[[7.45, 0.05]], [[9.7, 0.05]], [[9.7, 1.1]], [[9.2, 1.6]], [[7.45, 1.6]]], 96)), 'satin');

  // retaining clip on the boss, behind the housing
  const Cl = B.part('clip', { explode: [-9, 0, 0], st: 0.2, label: 'Clip', labelAt: [x0 - 0.4, -6.5, 0] });
  B.mesh(Cl, alongX(lathe([[[4.92, x0 - 0.75]], [[7.0, x0 - 0.75]], [[7.0, x0 - 0.05]], [[4.92, x0 - 0.05]]], 64)), 'blued');

  // cam: hub, arm and the pin that drives the bolt
  const Rc = g.cam.Rc;
  const Cm = B.part('cam', { explode: [-16, 0, 0], st: 0.12, label: 'Cam', labelAt: [-29.6, -Rc, 0] });
  B.mesh(Cm, alongX(rod(4.6, -29.6, x0 - 1.9, 48)), 'zinc');
  B.mesh(Cm, zyExtrude([[1.8, 0], ...arcPts(1.8, 0, -PI, 16, 0, -Rc), [-1.8, 0]], -29.6, x0 - 1.9), 'zinc');
  const pin = alongX(rod(g.cam.pinR, -32.6, -29.6, 20)); pin.translate(0, -Rc, 0);
  B.mesh(Cm, pin, 'steel');

  // bolt: a yoke with a slot for the cam pin (a Scotch yoke), and the bar
  const Bo = B.part('bolt', { explode: [-26, 0, 0], st: 0.04, label: 'Bolt', labelAt: [-31, -12, -20] });
  const bolt = [[3, 2.4], [-3, 2.4], [-3, -10.5], [-26, -10.5], [-26.8, -11.3], [-26.8, -13.0], [-26, -13.8], [3, -13.8]];
  const cw = g.cam.slotW, sy0 = g.cam.slotY0, sy1 = g.cam.slotY1;
  const slot = [...arcPts(cw, 0, PI, 10, 0, sy1 - cw), ...arcPts(cw, PI, 2 * PI, 10, 0, sy0 + cw)];
  B.mesh(Bo, zyExtrude(bolt, -32.0, -30.0, [slot]), 'satin');

  // case: a guide plate behind the bar, a strap over it, and the mounting
  // plate for the two screws; the yoke and the cam pin stay in view
  const Ca = B.part('case', { explode: [-26, 0, 0], st: 0.04, label: 'Lock case', labelAt: [-34, -16, -24] });
  B.mesh(Ca, zyExtrude([[6, -9.4], [-31, -9.4], [-31, -16.5], [6, -16.5]], -34.0, -32.4), 'black');
  B.mesh(Ca, zyExtrude([[6, 16], [-8, 16], [-8, 9.5], [6, 9.5]], -34.0, -32.4), 'black');
  B.mesh(Ca, zyExtrude([[-19, -9.4], [-24, -9.4], [-24, -10.4], [-19, -10.4]], -32.4, -29.4), 'black');
  B.mesh(Ca, zyExtrude([[-19, -13.9], [-24, -13.9], [-24, -15.0], [-19, -15.0]], -32.4, -29.4), 'black');
  B.mesh(Ca, zyExtrude([[-19, -9.4], [-24, -9.4], [-24, -15.0], [-19, -15.0]], -29.4, -28.8), 'black');

  // key
  const Ky = B.part('key', { label: 'Key', labelAt: [g.key.shoulder + 13, 9.6, 0] });
  Ky.explodeFn = keyPath(-22, -24);
  out.keyPart = Ky;

  out.shear = [overlayLine(B, x0 + 0.3, x1 - 0.3, Rp, 0x7fe3b0)];
  out.pose = { kb: new Array(n).fill(0), db: new Array(n).fill(0), dt: new Array(n).fill(0), th: 0 };
  out.apply = (st, ek) => {
    const th = st.theta, c = Math.cos(th), s = Math.sin(th);
    P.root.rotation.x = th; Cm.root.rotation.x = th;
    Bo.root.position.z = camPin(g, th).yoke;
    const relax = ease((ek - 0.05) / 0.5);
    for (let i = 0; i < n; i++) {
      const q = st.ch[i];
      out.pose.kb[i] = q.kb; out.pose.db[i] = q.db; out.pose.dt[i] = q.dt;
      out.kp[i].root.rotation.x = th; out.kp[i].root.position.set(0, q.kb * c, q.kb * s);
      out.dp[i].root.position.y = q.db;
      out.sp[i].root.position.y = q.dt;
      out.springs[i].setLength(q.spring + (g.spring.free - q.spring) * relax);
    }
    out.pose.th = th;
  };
  return out;
}

// ── wafer lock ─────────────────────────────────────────────────────────────
function waferLock(B, L) {
  const g = L.g, Rp = g.Rp, x0 = g.x0, x1 = g.x1, n = g.n, Rq = Rp - 0.03;
  const out = { wf: [], springs: [] };
  const way = keyway(g);
  // housing with grooves above and below the bore; the head at the front
  const H = B.part('housing', { cut: true, label: 'Housing', labelAt: [-6, g.Rh, -4] });
  const gw = g.grooveW, gy = g.grooveY, ga = Math.asin(gw / Rp);
  const hole = [[gw, Math.sqrt(Rp * Rp - gw * gw)], [gw, gy], [-gw, gy], [-gw, Math.sqrt(Rp * Rp - gw * gw)],
    ...arcPts(Rp, PI / 2 + ga, 3 * PI / 2 - ga, 60).slice(1, -1), [-gw, -Math.sqrt(Rp * Rp - gw * gw)], [-gw, -gy], [gw, -gy], [gw, -Math.sqrt(Rp * Rp - gw * gw)],
    ...arcPts(Rp, -PI / 2 + ga, PI / 2 - ga, 60).slice(1, -1)];
  B.mesh(H, zyExtrude(circle(g.Rh, 120), x0, x1, [hole]), 'housing');
  B.mesh(H, zyExtrude(circle(12.2, 120), x1, x1 + g.key.shoulder, [circle(Rp + 0.08, 96)]), 'housing');
  // a nut thread look: shallow rings round the body
  for (let x = x0 + 2; x < x1 - 3; x += 1.25) B.mesh(H, alongX(lathe([[[g.Rh - 0.01, x]], [[g.Rh + 0.35, x + 0.45]], [[g.Rh - 0.01, x + 0.9]]], 96)), 'housing', { pick: true });

  // plug: solid segments with the keyway, split pieces at each wafer slot
  const P = B.part('plug', { cut: true, label: 'Plug', explode: [-25, 0, 0], st: 0.3, labelAt: [x0 + 1, -Rp, -2] });
  const st0 = 0.3, plugK = e => ease((e - st0) / (1 - st0));
  const sw = g.slotW, sa = Math.acos(sw / Rq), yc = Math.sqrt(Rq * Rq - sw * sw), pk = g.pocket;
  const right = [...arcPts(Rq, -sa, sa, 40)];
  const left = [[-sw, yc], ...arcPts(Rq, PI - sa, PI + sa, 40).slice(1, -1), [-sw, -yc], [-sw, pk.y0], [pk.z0, pk.y0], [pk.z0, pk.y1], [-sw, pk.y1]];
  const edges = [x0];
  for (const x of [...g.X].reverse()) edges.push(x - g.slotT / 2, x + g.slotT / 2);
  edges.push(x1 + g.key.shoulder);
  for (let j = 0; j < edges.length - 1; j++) {
    const a = edges[j], b = edges[j + 1];
    if (j % 2 === 0) B.mesh(P, zyExtrude(circle(Rq, 120), a, b, [way]), 'plug');
    else { B.mesh(P, zyExtrude(right, a, b), 'plug'); B.mesh(P, zyExtrude(left, a, b), 'plug'); }
  }
  B.mesh(P, alongX(rod(4.9, x0 - 2, x0, 48)), 'plug');

  // wafers, each with its spring in the plug pocket
  const Rw = Rp - 0.06, ww = g.waferW, wa = Math.acos(ww / Rw), wy = Math.sqrt(Rw * Rw - ww * ww), tb = g.tab;
  for (let i = 0; i < n; i++) {
    const x = g.X[i];
    const W = B.part(`wf${i}`, { info: 'wafer', label: i === 0 ? 'Wafers' : null, labelAt: [x, Rp, 0] });
    W.explodeFn = (e, v) => v.set(-25 * plugK(e), 0, 0);
    const outline = [...arcPts(Rw, wa, PI - wa, 40), [-ww, tb.y1], [tb.z0, tb.y1], [tb.z0, tb.y0], [-ww, tb.y0], ...arcPts(Rw, PI + wa, 2 * PI - wa, 40)];
    const win = [[-g.winW, g.winTop[i]], [-g.winW, g.winBot], [g.winW, g.winBot], [g.winW, g.winTop[i]]];
    B.mesh(W, zyExtrude(outline, x - g.waferT / 2, x + g.waferT / 2, [win]), 'wafer');
    const sp = createSpring(g.spring.coilR, g.spring.wire / 2, g.spring.turns, 18, 6);
    const sm = B.mesh(W, sp.geom, 'spring'); sm.position.set(x, tb.y1, (pk.z0 + pk.z1) / 2);
    sm.userData.part = 'wSpring';
    out.springs.push(sp); out.wf.push(W);
  }

  // clip, cam bar with its screw, and the frame stop it hooks behind
  const Cl = B.part('clip', { explode: [-28, 0, 0], st: 0.15, label: 'Clip', labelAt: [x0 - 0.4, -6.5, 0] });
  B.mesh(Cl, alongX(lathe([[[4.92, x0 - 0.85]], [[7.0, x0 - 0.85]], [[7.0, x0 - 0.1]], [[4.92, x0 - 0.1]]], 64)), 'blued');
  const Cm = B.part('cam', { explode: [-31, 0, 0], st: 0.08, label: 'Cam bar', labelAt: [-27.2, -g.cam.len + 3, 0] });
  const cw = g.cam.w / 2, cl = g.cam.len;
  B.mesh(Cm, zyExtrude([...arcPts(cw, 0, PI, 20, 0, 0), ...arcPts(cw, PI, 2 * PI, 20, 0, -cl + cw)], -27.2, -25.2), 'zinc');
  B.mesh(Cm, alongX(lathe([[[0, -27.9]], [[2.3, -27.9]], [[2.3, -27.6]], [[2.0, -27.2]], [[0, -27.2]]], 32)), 'steel');
  const Sk = B.part('strike', { explode: [-36, 0, 0], st: 0.02, label: 'Frame stop', labelAt: [-30.5, -20, 6] });
  B.mesh(Sk, zyExtrude([[7, -14.6], [-7, -14.6], [-7, -27], [7, -27]], -31.0, -27.6), 'black');

  const Ky = B.part('key', { label: 'Key', labelAt: [g.key.shoulder + 13, 9.6, 0] });
  Ky.explodeFn = keyPath(-20, -22);
  out.keyPart = Ky;
  out.shear = [overlayLine(B, x0 + 0.3, x1 - 0.3, Rp, 0x7fe3b0), overlayLine(B, x0 + 0.3, x1 - 0.3, -Rp, 0x7fe3b0)];
  out.apply = (st, ek) => {
    const th = st.theta;
    P.root.rotation.x = th; Cm.root.rotation.x = th;
    for (let i = 0; i < n; i++) {
      const q = st.ch[i], W = out.wf[i];
      W.root.rotation.x = th;
      W.root.position.set(0, q.off * Math.cos(th), q.off * Math.sin(th));
      out.springs[i].setLength(q.spring);
    }
  };
  return out;
}

// ── build ───────────────────────────────────────────────────────────────────
export function build(B, L) {
  const g = L.g;
  const sc = L.pin ? pinTumbler(B, L) : waferLock(B, L);
  keyParts(B, sc.keyPart, g, L.bits.right);
  // the wrong key is the same blank with other cuts: a second blade, shown
  // in place of the first
  const wrongP = B.part('keyWrong', { info: 'key', explodeFn: sc.keyPart.explodeFn });
  keyParts(B, wrongP, g, L.bits.wrong);
  const keyFor = id => id === 'wrong' ? wrongP : id === 'right' ? sc.keyPart : null;

  const pose = (st, ek = 0) => {
    sc.apply(st, ek);
    const dx = st.xs - g.key.shoulder;
    for (const kp of [sc.keyPart, wrongP]) {
      const on = keyFor(st.keyId) === kp;
      kp.holder.visible = on;
      kp.root.position.x = dx; kp.root.rotation.x = st.theta;
    }
  };
  // bounds: assembled, key home
  pose(L.state('right', 1, 0), 0);
  B.applyExplode(0);
  B.root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(B.root), c0 = bb.getCenter(new THREE.Vector3());
  const box = { c: c0.toArray(), R: bb.getSize(new THREE.Vector3()).length() / 2 };
  // the exploded bounds, key out
  pose(L.state('right', 0, 0), 1);
  B.applyExplode(1);
  B.root.updateMatrixWorld(true);
  const be = new THREE.Box3().setFromObject(B.root), c1 = be.getCenter(new THREE.Vector3());
  const explodeShift = c1.sub(c0).toArray(), explodeR = be.getSize(new THREE.Vector3()).length() / 2;
  pose(L.state('none', 0, 0), 0);
  B.applyExplode(0);
  return { pose, box, explodeShift, explodeR, shear: sc.shear, stacks: { kp: sc.kp || [], dp: sc.dp || [], wf: sc.wf || [] }, keyFor };
}
