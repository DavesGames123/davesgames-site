// ============================================================================
//  PROTEIN VIEWER  ·  reps.js — three.js meshes for each representation
// ────────────────────────────────────────────────────────────────────────────
//  Every atom rep is two InstancedMesh objects (spheres, and bonds as two
//  half cylinders so each half takes its atom's colour), so 20k+ atoms stay
//  at frame rate. The cartoon and the surface are one indexed mesh each,
//  coloured per vertex from the residue or the atom under it.
//  Each layer keeps the atom or residue behind every instance or vertex,
//  so main.js paints a colour change or a highlight without a rebuild.
//    layer.paintAtoms(lin)      lin: Float32Array(3 * atoms), linear RGB
//    layer.paintResidues(lin)   lin: Float32Array(3 * residues)
//
//  grep: export function atomLayer  export function bondLayer
//        export function cartoonLayer  export function surfaceLayer
//        export function traceLayer  function sphereGeo
// ============================================================================
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _z = new THREE.Vector3();
const geoCache = new Map();

export function sphereGeo(detail) {
  if (!geoCache.has('s' + detail)) geoCache.set('s' + detail, new THREE.IcosahedronGeometry(1, detail));
  return geoCache.get('s' + detail);
}
function cylGeo(seg) {
  if (!geoCache.has('c' + seg)) {
    const g = new THREE.CylinderGeometry(1, 1, 1, seg, 1, true);
    g.translate(0, 0.5, 0);
    geoCache.set('c' + seg, g);
  }
  return geoCache.get('c' + seg);
}
export function disposeGeoCache() { for (const g of geoCache.values()) g.dispose(); geoCache.clear(); }

export function makeMaterial(opts = {}) {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: opts.roughness ?? 0.42, metalness: 0, envMapIntensity: opts.env ?? 0.55, vertexColors: !!opts.vertexColors, side: opts.side ?? THREE.FrontSide, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, depthWrite: opts.depthWrite ?? true, flatShading: false });
}

// spheres for the atoms in `idx`; radius(i) in A
export function atomLayer(idx, wpos, radius, detail, material) {
  const n = idx.length;
  const mesh = new THREE.InstancedMesh(sphereGeo(detail), material, Math.max(1, n));
  mesh.count = n;
  const rad = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx[k], r = radius(i);
    rad[k] = r;
    _m.makeScale(r, r, r).setPosition(wpos[3 * i], wpos[3 * i + 1], wpos[3 * i + 2]);
    mesh.setMatrixAt(k, _m);
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData = { idx, rad };
  mesh.paintAtoms = lin => {
    const c = mesh.instanceColor.array;
    for (let k = 0; k < n; k++) { const i = idx[k]; c[3 * k] = lin[3 * i]; c[3 * k + 1] = lin[3 * i + 1]; c[3 * k + 2] = lin[3 * i + 2]; }
    mesh.instanceColor.needsUpdate = true;
  };
  return mesh;
}

// bonds: pairs [i0, j0, i1, j1, ...]; two half cylinders per bond
export function bondLayer(pairs, wpos, r, seg, material) {
  const nb = pairs.length / 2, n = nb * 2;
  const mesh = new THREE.InstancedMesh(cylGeo(seg), material, Math.max(1, n));
  mesh.count = n;
  const owner = new Int32Array(n);
  for (let b = 0; b < nb; b++) {
    const i = pairs[2 * b], j = pairs[2 * b + 1];
    _a.set(wpos[3 * i], wpos[3 * i + 1], wpos[3 * i + 2]);
    _b.set(wpos[3 * j], wpos[3 * j + 1], wpos[3 * j + 2]);
    const mid = _v.copy(_a).add(_b).multiplyScalar(0.5);
    for (let h = 0; h < 2; h++) {
      const from = h ? _b : _a;
      const axis = mid.clone().sub(from);
      const len = axis.length() || 1e-3;
      const y = axis.divideScalar(len);
      _x.set(1, 0, 0); if (Math.abs(y.x) > 0.9) _x.set(0, 1, 0);
      _z.crossVectors(_x, y).normalize(); _x.crossVectors(y, _z).normalize();
      _m.makeBasis(_x.multiplyScalar(r), y.multiplyScalar(len), _z.multiplyScalar(r)).setPosition(from);
      mesh.setMatrixAt(2 * b + h, _m);
      owner[2 * b + h] = h ? j : i;
    }
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.paintAtoms = lin => {
    const c = mesh.instanceColor.array;
    for (let k = 0; k < n; k++) { const i = owner[k]; c[3 * k] = lin[3 * i]; c[3 * k + 1] = lin[3 * i + 1]; c[3 * k + 2] = lin[3 * i + 2]; }
    mesh.instanceColor.needsUpdate = true;
  };
  return mesh;
}

// cylinders between explicit points (nucleotide rungs, the trace)
export function segmentLayer(segs, r, seg, material) {
  const n = segs.length;
  const mesh = new THREE.InstancedMesh(cylGeo(seg), material, Math.max(1, n));
  mesh.count = n;
  for (let k = 0; k < n; k++) {
    const { from, to } = segs[k];
    _a.set(from[0], from[1], from[2]); _b.set(to[0], to[1], to[2]);
    const y = _b.clone().sub(_a); const len = y.length() || 1e-3; y.divideScalar(len);
    _x.set(1, 0, 0); if (Math.abs(y.x) > 0.9) _x.set(0, 1, 0);
    _z.crossVectors(_x, y).normalize(); _x.crossVectors(y, _z).normalize();
    _m.makeBasis(_x.multiplyScalar(r), y.multiplyScalar(len), _z.multiplyScalar(r)).setPosition(_a);
    mesh.setMatrixAt(k, _m);
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.paintResidues = lin => {
    const c = mesh.instanceColor.array;
    for (let k = 0; k < n; k++) { const i = segs[k].res; c[3 * k] = lin[3 * i]; c[3 * k + 1] = lin[3 * i + 1]; c[3 * k + 2] = lin[3 * i + 2]; }
    mesh.instanceColor.needsUpdate = true;
  };
  return mesh;
}

// the cartoon mesh from cartoon.js arrays
export function cartoonLayer(g, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.position.length), 3));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  const vres = g.vres;
  mesh.paintResidues = lin => {
    const c = geo.attributes.color.array;
    for (let v = 0; v < vres.length; v++) { const i = vres[v]; c[3 * v] = lin[3 * i]; c[3 * v + 1] = lin[3 * i + 1]; c[3 * v + 2] = lin[3 * i + 2]; }
    geo.attributes.color.needsUpdate = true;
  };
  return mesh;
}

// the surface mesh from surface.js arrays; colour by the owner atom
export function surfaceLayer(g, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.position.length), 3));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  const own = g.owner;
  mesh.paintAtoms = lin => {
    const c = geo.attributes.color.array;
    for (let v = 0; v < own.length; v++) { const i = own[v]; c[3 * v] = lin[3 * i]; c[3 * v + 1] = lin[3 * i + 1]; c[3 * v + 2] = lin[3 * i + 2]; }
    geo.attributes.color.needsUpdate = true;
  };
  return mesh;
}

export function disposeObject(o) {
  o.traverse(c => {
    // instanced meshes share the cached sphere and cylinder geometry;
    // dispose() frees only their instance buffers
    if (c.isInstancedMesh) c.dispose();
    else if (c.isMesh && c.geometry && !c.userData.sharedGeo) c.geometry.dispose();
    if (c.isLine || c.isLineSegments) { c.geometry.dispose(); c.material.dispose(); }
  });
}
