// ============================================================================
//  NEURON LAB  ·  shared/neuron-mesh.js  ·  a cell as glowing tubes
// ----------------------------------------------------------------------------
//  Builds one BufferGeometry for a Cell (engine/cell.js): a tube along the
//  polyline of each section and a sphere for the soma. Each tube ring knows
//  the two nodes it sits between and its weight, so the colour runs smoothly
//  along a branch while the solver has only nseg nodes per section. Before a
//  section's first node the ring blends from the parent node, so the colour
//  flows across branch points.
//
//  Thin branches are drawn thicker than they are (legible, not to scale):
//  radius = max(thick d / 2, minR).
//
//  update(v) writes the voltage of each vertex (attribute aV); the shader
//  maps it with VCOLOR (the same stops as cmap() below) and adds glow above
//  about -55 mV, which the bloom pass picks up.
//
//  grep -n targets
//    "export function cmap"            voltage -> [r, g, b] 0..1 (2D plots)
//    "export function buildNeuronMesh" geometry, material, update, pick
//    "const VCOLOR"                    the GLSL colour map
// ============================================================================

export const STOPS = [[-80, [0.07, 0.09, 0.30]], [-70, [0.10, 0.20, 0.52]], [-60, [0.11, 0.45, 0.80]], [-45, [0.20, 0.85, 1.00]], [-20, [1.00, 0.82, 0.45]], [10, [1.00, 0.45, 0.66]], [40, [1.00, 1.00, 1.00]]];
export function cmap(v) {
  if (v <= STOPS[0][0]) return STOPS[0][1];
  for (let k = 1; k < STOPS.length; k++) if (v <= STOPS[k][0]) {
    const [a, A] = STOPS[k - 1], [b, B] = STOPS[k], t = (v - a) / (b - a);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }
  return STOPS[STOPS.length - 1][1];
}
export const cssColor = v => { const c = cmap(v); return `rgb(${c.map(x => Math.round(x * 255)).join(',')})`; };

const VCOLOR = `
vec3 vcolor(float v){
  ${STOPS.map(([x, c], k) => k === 0 ? `vec3 c = vec3(${c.join(',')});` : `c = mix(c, vec3(${c.join(',')}), clamp((v - (${STOPS[k - 1][0].toFixed(1)})) / ${(x - STOPS[k - 1][0]).toFixed(1)}, 0.0, 1.0));`).join('\n  ')}
  return c;
}`;

export function buildNeuronMesh(THREE, cell, o = {}) {
  const radial = o.radial || 8, thick = o.thick ?? 1.6, minR = o.minR ?? 0.8;
  const pos = [], nor = [], ring0 = [], ring1 = [], ringT = [], vRing = [], idx = [], vNode = [];
  let nRing = 0;
  const S = cell.sections;
  const addRing = (c, T, N, B, r, i0, i1, t, node) => {
    for (let k = 0; k < radial; k++) {
      const a = k / radial * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      const nx = N[0] * cs + B[0] * sn, ny = N[1] * cs + B[1] * sn, nz = N[2] * cs + B[2] * sn;
      pos.push(c[0] + nx * r, c[1] + ny * r, c[2] + nz * r); nor.push(nx, ny, nz);
      vRing.push(nRing); vNode.push(node);
    }
    ring0.push(i0); ring1.push(i1); ringT.push(t);
    return nRing++;
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  for (let si = 0; si < S.length; si++) {
    const s = S[si];
    if (s.kind === 'soma') continue;
    const ns = s.nseg, m = Math.max(3, ns * 3 + 1), pn = cell.parent[s.first];
    let prev = null, N = null;
    for (let q = 0; q < m; q++) {
      const x = q / (m - 1), c = cell.pointAt(s, x);
      const c2 = cell.pointAt(s, Math.min(1, x + 0.5 / m)), c1 = cell.pointAt(s, Math.max(0, x - 0.5 / m));
      const T = nrm([c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]]);
      if (!N) { const up = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; N = nrm(cross(cross(T, up), T)); }
      else { const B0 = cross(T, N); N = nrm(cross(B0, T)); }
      const B = cross(T, N);
      const d = (s.d0 + ((s.d1 ?? s.d0) - s.d0) * x) * cell.diamScale, r = Math.max(minR, thick * d / 2);
      const f = x * ns - 0.5;
      let i0, i1, t;
      if (f < 0) { i0 = pn >= 0 ? pn : s.first; i1 = s.first; t = (f + 0.5) / 0.5; }
      else if (f >= ns - 1) { i0 = i1 = s.first + ns - 1; t = 0; }
      else { i0 = s.first + Math.floor(f); i1 = i0 + 1; t = f - Math.floor(f); }
      const node = t < 0.5 ? i0 : i1;
      const rI = addRing(c, T, N, B, r, i0, i1, t, node);
      if (prev !== null) for (let k = 0; k < radial; k++) {
        const a = prev * radial + k, b = prev * radial + (k + 1) % radial, cc = rI * radial + k, dd = rI * radial + (k + 1) % radial;
        idx.push(a, cc, b, b, cc, dd);
      }
      prev = rI;
    }
  }
  // soma sphere
  const soma = S[0], sc = cell.pointAt(soma, 0.5), sr = soma.d0 * cell.diamScale * 0.62;
  const lat = 14, lon = 20, base = pos.length / 3;
  for (let a = 0; a <= lat; a++) for (let b = 0; b < lon; b++) {
    const th = a / lat * Math.PI, ph = b / lon * Math.PI * 2;
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    pos.push(sc[0] + n[0] * sr, sc[1] + n[1] * sr, sc[2] + n[2] * sr); nor.push(...n); vRing.push(-1); vNode.push(0);
  }
  for (let a = 0; a < lat; a++) for (let b = 0; b < lon; b++) {
    const p = base + a * lon + b, q = base + a * lon + (b + 1) % lon, r = p + lon, s2 = q + lon;
    idx.push(p, q, r, q, s2, r);
  }
  const nv = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const aV = new THREE.BufferAttribute(new Float32Array(nv).fill(-65), 1); aV.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aV', aV);
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: 1.0 }, uDim: { value: 1.0 }, uLight: { value: new THREE.Vector3(0.4, 0.8, 0.5).normalize() } },
    vertexShader: `
      attribute float aV; varying float vV; varying vec3 vN; varying vec3 vView;
      void main(){ vV = aV; vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform float uGlow; uniform float uDim; uniform vec3 uLight; varying float vV; varying vec3 vN; varying vec3 vView;
      ${VCOLOR}
      void main(){
        vec3 n = normalize(vN), vd = normalize(vView);
        vec3 L = normalize((viewMatrix * vec4(uLight, 0.0)).xyz);
        float dif = 0.35 + 0.65 * max(dot(n, L), 0.0);
        float rim = pow(1.0 - max(dot(n, vd), 0.0), 2.2);
        vec3 c = vcolor(vV);
        float hot = smoothstep(-58.0, 15.0, vV);
        vec3 col = c * (0.55 * dif + 0.35) * uDim + c * rim * 0.55 + c * hot * 2.4 * uGlow;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  const ringV = new Float32Array(nRing), arr = aV.array;
  const r0 = Int32Array.from(ring0), r1 = Int32Array.from(ring1), rt = Float32Array.from(ringT), vr = Int32Array.from(vRing);
  const nodeOf = Int32Array.from(vNode);
  return {
    mesh, geometry: g, material: mat, nRing, nv, nodeOf,
    update(v) {
      for (let k = 0; k < nRing; k++) ringV[k] = v[r0[k]] + (v[r1[k]] - v[r0[k]]) * rt[k];
      const v0 = v[0];
      for (let i = 0; i < nv; i++) { const k = vr[i]; arr[i] = k >= 0 ? ringV[k] : v0; }
      aV.needsUpdate = true;
    },
    // the node under a ray hit (face index)
    pickNode(hit) { if (!hit || !hit.face) return -1; return nodeOf[hit.face.a]; },
    dispose() { g.dispose(); mat.dispose(); },
  };
}
