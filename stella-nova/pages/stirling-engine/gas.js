// ============================================================================
//  STIRLING ENGINE  ·  gas.js — the working gas as tagged particles
// ────────────────────────────────────────────────────────────────────────────
//  Each particle carries a fixed mass tag mu in [0, 1), spread evenly, so the
//  particles are equal parcels of the sealed charge. Each frame the spaces of
//  E.gas() (hot space, hot pipe, regenerator, cold pipe, cold space, and in
//  the gamma the transfer pipe and the power cylinder) are laid end to end in
//  mass order. A particle sits in the space whose mass span holds its tag,
//  at the place f in that space, through scene.js gasMap. So the particles
//  move exactly as the Schmidt model says the gas moves: no particle is
//  pushed by hand, and a space holds more particles where it is colder.
//
//  In the regenerator the temperature falls linearly with depth s, and the
//  mass above depth s is ln(T(s)/Th) / ln(Tc/Th) of the regenerator's mass:
//  f inverts that, so the cold lower screens hold more particles.
//
//  Colour is temperature on a calm scale, cold blue to hot amber. The points
//  are clipped by the section plane (they are only seen through the cut).
//
//  GREP MAP
//    function createGas .... the points and the update
//    function tempColor .... the colour scale
// ============================================================================
import * as THREE from 'three';

const COLD = new THREE.Color(0.22, 0.52, 1.0), MID = new THREE.Color(0.80, 0.66, 0.80), HOT = new THREE.Color(1.0, 0.55, 0.22);
export function tempColor(t, out) {
  t = Math.max(0, Math.min(1, t));
  return t < 0.5 ? out.copy(COLD).lerp(MID, t * 2) : out.copy(MID).lerp(HOT, (t - 0.5) * 2);
}
export const tempCss = t => '#' + tempColor(t, new THREE.Color()).getHexString();

function sprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.9)'); r.addColorStop(0.7, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createGas(n, plane) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 6.5, map: sprite(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true, clippingPlanes: [plane], opacity: 0.9 });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let s = 12345; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const P = [];
  for (let i = 0; i < n; i++) P.push({ mu: (i + rnd()) / n, u: rnd(), v: rnd(), w: rnd() });
  const c = new THREE.Color();

  // gs = E.gas(k, Th); map = scene gasMap; Tc, Th in K
  function update(gs, k, map, Th, Tc) {
    const S = gs.S, span = Th - Tc;
    let i = 0, start = 0;
    for (let j = 0; j < S.length; j++) {
      const q = S[j], end = j === S.length - 1 ? 1.0000001 : start + q.m, fn = map[q.id];
      while (i < n && P[i].mu < end) {
        const p = P[i];
        let f = q.m > 0 ? (p.mu - start) / q.m : 0, T = q.T;
        if (q.kind === 'r' && Math.abs(span) > 1e-3) {
          const Ts = Th * Math.pow(Tc / Th, f);     // the temperature at that depth
          f = (Ts - Th) / (Tc - Th); T = Ts;
        }
        const xyz = fn ? fn(f, p.u, p.v, p.w, k) : [0, -1e4, 0];
        pos[i * 3] = xyz[0]; pos[i * 3 + 1] = xyz[1]; pos[i * 3 + 2] = xyz[2];
        tempColor(span > 1e-3 ? (T - Tc) / span : 0, c);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        i++;
      }
      start = end;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { points, update, mat, dispose: () => { geo.dispose(); mat.map.dispose(); mat.dispose(); } };
}
