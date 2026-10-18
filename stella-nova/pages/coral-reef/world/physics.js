// ============================================================================
//  CORAL REEF  ·  world/physics.js  ·  the solid for the ROVs and the camera
// ----------------------------------------------------------------------------
//  The ROVs (rov/squad.js) and the explore camera (camera.js) need one field
//  of the solid: rock and sand (world/field.js) and the coral of the shown
//  chunks (world/stream.js coralDist). This file joins them in the units of
//  the rock field (a bound, SDF_SCALE x metres), with the conventions of
//  rock/index.js, so camera.js createField and rov/pilot.js read it as
//  they read the plot rock.
//
//  CORAL TERM (the method of rov/coral-field.js): (d - margin) x k, d the
//  metres to the nearest coral particle (at most REACH), k = clear /
//  (clearM - margin): the field is `clear` at clearM metres from the coral
//  skeleton, so the vehicles keep about clearM from it.
//
//    const P = worldPhysics(W, streamer, { clear, clearM, eye: () => [x, y, z] });
//    P.sdf(x, y, z), P.sdfAll (the same), P.sdfScale, P.lipschitz, P.normal,
//    P.bounds, P.radius (Infinity), P.sand, P.ground, P.habitat,
//    P.features (the features near the eye, a getter), P.featuresAt(x, z, r),
//    P.colonies(), P.coralDist, P.tourGrid() (a route maker for camera.js)
//
//  grep -n targets: "export function worldPhysics"
// ============================================================================
import { Y_MIN, Y_MAX } from './field.js';
import { marchPath } from '../rov/pilot.js';

export function worldPhysics(W, st, o = {}) {
  const clear = o.clear ?? 0.62, clearM = o.clearM ?? 1.3, margin = o.margin ?? 0.2;
  const k = clear / Math.max(0.1, clearM - margin);
  const coral = st && st.coralDist ? (x, y, z) => (st.coralDist(x, y, z) - margin) * k : () => Infinity;
  const sdf = (x, y, z) => { const a = W.sdfAll(x, y, z); if (a < -0.2) return a; const c = coral(x, y, z); return a < c ? a : c; };
  const normal = (x, y, z, e = 0.05) => {
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  const eye = o.eye || (() => [0, 0, 0]);
  let fAt = null, fList = [];
  const P = {
    sdf, sdfAll: sdf, rockSdf: W.sdfAll, normal, sdfScale: W.sdfScale, lipschitz: W.lipschitz, sdfClamp: W.sdfClamp,
    bounds: { min: [-Infinity, Y_MIN, -Infinity], max: [Infinity, Y_MAX, Infinity] }, radius: Infinity, seed: W.seed,
    sand: { heightAt: W.sandAt, sdf: W.sand.sdf }, ground: W.ground, habitat: W.habitat,
    featuresAt: (x, z, r) => W.features(x, z, r),
    colonies: () => (st && st.colonies ? st.colonies() : []),
    coralDist: (x, y, z) => (st && st.coralDist ? st.coralDist(x, y, z) : Infinity),
    // a route maker for camera.js tours: the grid-free planner of rov/pilot.js
    tourGrid: () => ({ route(a, b, cl) { const p = marchPath(sdf, [a, b], cl, { budget: 40000, step: 0.4 }); return p && p.pts.length > 1 ? p.pts : null; } }),
    clear,
  };
  // the features near the eye (camera.js tourList reads rock.features)
  Object.defineProperty(P, 'features', {
    get() {
      const e = eye();
      if (!fAt || Math.hypot(e[0] - fAt[0], e[2] - fAt[2]) > 20) { fAt = e.slice(); fList = W.features(e[0], e[2], 60); }
      return fList;
    },
  });
  return P;
}
