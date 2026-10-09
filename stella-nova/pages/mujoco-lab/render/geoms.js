// ============================================================================
//  MUJOCO LAB  ·  render/geoms.js — three.js geometry and materials from mjModel
// ----------------------------------------------------------------------------
//  All geometry is in the MuJoCo geom frame (z-up). The renderer puts the
//  meshes in a root group that turns z-up into three y-up. No three.js
//  import: every builder takes the THREE namespace of the page.
//
//  GREP MAP
//    export const GEOM ............ mjtGeom ids
//    export function geomGeometry . one geom -> BufferGeometry (cached by key)
//    function meshGeometry ........ mesh_vert / mesh_face / normals / uv
//    function hfieldGeometry ...... hfield grid
//    function capsule ............. lathe capsule along z
//    export function geomColor .... material or geom rgba (simulate rule)
//    export function makeTextures . 2D textures (RGBA DataTexture) and mean colours
//    export function gridTexture .. theme floor grid (DataTexture, no canvas)
//    export function skinBuild .... skin geometry + mjv_updateSkin on the CPU
//    export function flexBuild .... flex surface / segments from flexvert_xpos
// ============================================================================

export const GEOM = { PLANE: 0, HFIELD: 1, SPHERE: 2, CAPSULE: 3, ELLIPSOID: 4, CYLINDER: 5, BOX: 6, MESH: 7, SDF: 8 };
const NTEXROLE = 10, ROLE_RGB = 1;

function capsule(THREE, r, h, seg) {
  const pts = [], n = Math.max(4, seg >> 2);
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r - h)); }
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r + h)); }
  pts[0].x = 0; pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

function meshGeometry(THREE, m, mi) {
  const va = m.mesh_vertadr[mi], fa = m.mesh_faceadr[mi], nf = m.mesh_facenum[mi];
  const V = m.mesh_vert, F = m.mesh_face;
  const na = m.mesh_normaladr ? m.mesh_normaladr[mi] : -1, N = m.mesh_normal, FN = m.mesh_facenormal;
  const ta = m.mesh_texcoordadr ? m.mesh_texcoordadr[mi] : -1, TC = m.mesh_texcoord, FT = m.mesh_facetexcoord;
  const hasN = na >= 0 && m.mesh_normalnum && m.mesh_normalnum[mi] > 0 && FN && FN.length >= 3 * (fa + nf);
  const hasT = ta >= 0 && m.mesh_texcoordnum && m.mesh_texcoordnum[mi] > 0 && FT && FT.length >= 3 * (fa + nf);
  const pos = new Float32Array(9 * nf), nor = hasN ? new Float32Array(9 * nf) : null, uv = hasT ? new Float32Array(6 * nf) : null;
  let flipped = 0;
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const vi = va + F[3 * (fa + f) + k], o = 9 * f + 3 * k;
      pos[o] = V[3 * vi]; pos[o + 1] = V[3 * vi + 1]; pos[o + 2] = V[3 * vi + 2];
      if (hasN) { const ni = na + FN[3 * (fa + f) + k]; nor[o] = N[3 * ni]; nor[o + 1] = N[3 * ni + 1]; nor[o + 2] = N[3 * ni + 2]; }
      if (hasT) { const ti = ta + FT[3 * (fa + f) + k]; uv[6 * f + 2 * k] = TC[2 * ti]; uv[6 * f + 2 * k + 1] = 1 - TC[2 * ti + 1]; }
    }
    // Decimated meshes can have faces with the wrong winding. MuJoCo's
    // vertex normals give the outside: swap corners 1 and 2 of a face whose
    // winding normal points against them, so FrontSide culling keeps it.
    if (hasN) {
      const o = 9 * f;
      const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
      const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const dot = cx * (nor[o] + nor[o + 3] + nor[o + 6]) + cy * (nor[o + 1] + nor[o + 4] + nor[o + 7]) + cz * (nor[o + 2] + nor[o + 5] + nor[o + 8]);
      if (dot < 0) {
        flipped++;
        for (let k = 0; k < 3; k++) {
          let t = pos[o + 3 + k]; pos[o + 3 + k] = pos[o + 6 + k]; pos[o + 6 + k] = t;
          t = nor[o + 3 + k]; nor[o + 3 + k] = nor[o + 6 + k]; nor[o + 6 + k] = t;
        }
        if (hasT) { const q = 6 * f; let t = uv[q + 2]; uv[q + 2] = uv[q + 4]; uv[q + 4] = t; t = uv[q + 3]; uv[q + 3] = uv[q + 5]; uv[q + 5] = t; }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (hasN) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); else g.computeVertexNormals();
  if (hasT) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.userData = { flipped, faces: nf };
  return g;
}

function hfieldGeometry(THREE, m, h) {
  const nr = m.hfield_nrow[h], nc = m.hfield_ncol[h], s = m.hfield_size, a = m.hfield_adr[h], D = m.hfield_data;
  const rx = s[4 * h], ry = s[4 * h + 1], ez = s[4 * h + 2];
  const g = new THREE.PlaneGeometry(2 * rx, 2 * ry, nc - 1, nr - 1);
  const p = g.attributes.position.array;
  // PlaneGeometry rows run from +y to -y; MuJoCo row 0 is at -y.
  for (let iy = 0; iy < nr; iy++) for (let ix = 0; ix < nc; ix++) p[3 * (iy * nc + ix) + 2] = D[a + (nr - 1 - iy) * nc + ix] * ez;
  g.computeVertexNormals();
  return g;
}

// sizes: geom_size row; big: the edge of an infinite plane
export function geomGeometry(THREE, m, g, cache, opts = {}) {
  const t = m.geom_type[g], S = m.geom_size, a = S[3 * g], b = S[3 * g + 1], c = S[3 * g + 2];
  const seg = opts.phone ? 20 : 32;
  let key;
  switch (t) {
    case GEOM.PLANE: key = 'p' + (a || opts.big) + ',' + (b || opts.big); break;
    case GEOM.HFIELD: key = 'h' + m.geom_dataid[g]; break;
    case GEOM.SPHERE: key = 's' + a; break;
    case GEOM.CAPSULE: key = 'c' + a + ',' + b; break;
    case GEOM.ELLIPSOID: key = 'e' + a + ',' + b + ',' + c; break;
    case GEOM.CYLINDER: key = 'y' + a + ',' + b; break;
    case GEOM.BOX: key = 'b' + a + ',' + b + ',' + c; break;
    case GEOM.MESH: key = 'm' + m.geom_dataid[g]; break;
    default: return null;
  }
  let G = cache.get(key);
  if (G) return G;
  switch (t) {
    case GEOM.PLANE: { const w = a || opts.big, h = b || opts.big; G = new THREE.PlaneGeometry(2 * w, 2 * h, 1, 1); G.userData = { plane: [w, h] }; break; }
    case GEOM.HFIELD: G = hfieldGeometry(THREE, m, m.geom_dataid[g]); break;
    case GEOM.SPHERE: G = new THREE.SphereGeometry(a, seg, seg >> 1); break;
    case GEOM.CAPSULE: G = capsule(THREE, a, b, seg); break;
    case GEOM.ELLIPSOID: G = new THREE.SphereGeometry(1, seg, seg >> 1); G.scale(a, b, c); break;
    case GEOM.CYLINDER: G = new THREE.CylinderGeometry(a, a, 2 * b, seg, 1); G.rotateX(Math.PI / 2); break;
    case GEOM.BOX: G = new THREE.BoxGeometry(2 * a, 2 * b, 2 * c); break;
    case GEOM.MESH: G = meshGeometry(THREE, m, m.geom_dataid[g]); break;
  }
  cache.set(key, G);
  return G;
}

const DEF = [0.5, 0.5, 0.5, 1];
// simulate rule: the material colour wins unless the geom colour was set
export function geomColor(m, g, out = [0, 0, 0, 1]) {
  const r = m.geom_rgba, mat = m.geom_matid[g];
  let isDef = true;
  for (let k = 0; k < 4; k++) if (Math.abs(r[4 * g + k] - DEF[k]) > 1e-6) isDef = false;
  const src = mat >= 0 && isDef ? m.mat_rgba : r, o = mat >= 0 && isDef ? 4 * mat : 4 * g;
  for (let k = 0; k < 4; k++) out[k] = src[o + k];
  return out;
}
export function matTexId(m, mat) {
  if (mat < 0 || !m.mat_texid) return -1;
  const per = m.mat_texid.length / Math.max(1, m.nmat);
  return m.mat_texid[mat * per + (per >= NTEXROLE ? ROLE_RGB : 0)];
}

// 2D textures -> RGBA DataTexture; every texture gets its mean colour too
export function makeTextures(THREE, m) {
  const out = [];
  for (let t = 0; t < m.ntex; t++) {
    const w = m.tex_width[t], h = m.tex_height[t], nch = m.tex_nchannel ? m.tex_nchannel[t] : 3, a = m.tex_adr[t], D = m.tex_data;
    const n = w * h, mean = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) mean[k] += D[a + nch * i + Math.min(k, nch - 1)];
    for (let k = 0; k < 3; k++) mean[k] /= 255 * Math.max(1, n);
    let tex = null;
    if (m.tex_type[t] === 0) {
      const px = new Uint8Array(4 * n);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) px[4 * i + k] = D[a + nch * i + Math.min(k, nch - 1)];
        px[4 * i + 3] = nch === 4 ? D[a + 4 * i + 3] : 255;
      }
      tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const pot = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
      tex.generateMipmaps = pot;
      tex.minFilter = pot ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;
      if (THREE.SRGBColorSpace && 'colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
    out.push({ type: m.tex_type[t], tex, mean });
  }
  return out;
}

// A floor grid without a canvas: minor lines each cell, a major line each 5
export function gridTexture(THREE, base, minor, major, cells = 5, size = 256) {
  const px = new Uint8Array(4 * size * size), c = size / cells;
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const B = hex(base), m1 = hex(minor), m2 = hex(major);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const onMaj = x < 2 || y < 2, onMin = (x % c) < 1.2 || (y % c) < 1.2;
    const C = onMaj ? m2 : onMin ? m1 : B, o = 4 * (y * size + x);
    px[o] = C[0]; px[o + 1] = C[1]; px[o + 2] = C[2]; px[o + 3] = 255;
  }
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8;
  if (THREE.SRGBColorSpace && 'colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---- skins: mjv_updateSkin on the CPU ---------------------------------------------
export function skinBuild(THREE, m, s) {
  const va = m.skin_vertadr[s], nv = m.skin_vertnum[s], fa = m.skin_faceadr[s], nf = m.skin_facenum[s];
  const pos = new Float32Array(3 * nv), nor = new Float32Array(3 * nv), idx = new Uint32Array(3 * nf);
  for (let i = 0; i < 3 * nf; i++) idx[i] = m.skin_face[3 * fa + i];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const ta = m.skin_texcoordadr ? m.skin_texcoordadr[s] : -1;
  if (ta >= 0) { const uv = new Float32Array(2 * nv); for (let i = 0; i < nv; i++) { uv[2 * i] = m.skin_texcoord[2 * (ta + i)]; uv[2 * i + 1] = 1 - m.skin_texcoord[2 * (ta + i) + 1]; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
  const ba = m.skin_boneadr[s], nb = m.skin_bonenum[s];
  const rot = new Float64Array(9 * nb), tr = new Float64Array(3 * nb);
  return {
    geometry: g, va, nv, nf,
    update(d) {
      const xp = d.xpos, xq = d.xquat, BP = m.skin_bonebindpos, BQ = m.skin_bonebindquat, V = m.skin_vert;
      pos.fill(0);
      for (let j = 0; j < nb; j++) {
        const bi = ba + j, b = m.skin_bonebodyid[bi];
        // rotate = xquat[b] * conj(bindquat)
        const aw = xq[4 * b], ax = xq[4 * b + 1], ay = xq[4 * b + 2], az = xq[4 * b + 3];
        const bw = BQ[4 * bi], bx = -BQ[4 * bi + 1], by = -BQ[4 * bi + 2], bz = -BQ[4 * bi + 3];
        const w = aw * bw - ax * bx - ay * by - az * bz, x = aw * bx + ax * bw + ay * bz - az * by;
        const y = aw * by - ax * bz + ay * bw + az * bx, z = aw * bz + ax * by - ay * bx + az * bw;
        const R = rot, o = 9 * j;
        R[o] = 1 - 2 * (y * y + z * z); R[o + 1] = 2 * (x * y - w * z); R[o + 2] = 2 * (x * z + w * y);
        R[o + 3] = 2 * (x * y + w * z); R[o + 4] = 1 - 2 * (x * x + z * z); R[o + 5] = 2 * (y * z - w * x);
        R[o + 6] = 2 * (x * z - w * y); R[o + 7] = 2 * (y * z + w * x); R[o + 8] = 1 - 2 * (x * x + y * y);
        const px = BP[3 * bi], py = BP[3 * bi + 1], pz = BP[3 * bi + 2];
        tr[3 * j] = xp[3 * b] - (R[o] * px + R[o + 1] * py + R[o + 2] * pz);
        tr[3 * j + 1] = xp[3 * b + 1] - (R[o + 3] * px + R[o + 4] * py + R[o + 5] * pz);
        tr[3 * j + 2] = xp[3 * b + 2] - (R[o + 6] * px + R[o + 7] * py + R[o + 8] * pz);
        const vadr = m.skin_bonevertadr[bi], vn = m.skin_bonevertnum[bi];
        for (let k = 0; k < vn; k++) {
          const vid = m.skin_bonevertid[vadr + k], wt = m.skin_bonevertweight[vadr + k], q = 3 * (va + vid);
          const vx = V[q], vy = V[q + 1], vz = V[q + 2], p = 3 * vid;
          pos[p] += wt * (R[o] * vx + R[o + 1] * vy + R[o + 2] * vz + tr[3 * j]);
          pos[p + 1] += wt * (R[o + 3] * vx + R[o + 4] * vy + R[o + 5] * vz + tr[3 * j + 1]);
          pos[p + 2] += wt * (R[o + 6] * vx + R[o + 7] * vy + R[o + 8] * vz + tr[3 * j + 2]);
        }
      }
      areaNormals(pos, idx, nor);
      const inf = m.skin_inflate ? m.skin_inflate[s] : 0;
      if (inf) for (let i = 0; i < 3 * nv; i++) pos[i] += inf * nor[i];
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    },
  };
}

// area-weighted vertex normals, no allocation
function areaNormals(pos, idx, nor) {
  nor.fill(0);
  for (let f = 0; f < idx.length; f += 3) {
    const a = 3 * idx[f], b = 3 * idx[f + 1], c = 3 * idx[f + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz; nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz; nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz;
  }
  for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
}

// ---- flex: positions from d.flexvert_xpos each frame ----------------------------
// dim 1 -> segment list (drawn by the overlay pool), dim 2 -> two-sided
// surface of the elements, dim 3 -> the shell triangles
export function flexBuild(THREE, m, f) {
  const dim = m.flex_dim[f], va = m.flex_vertadr[f], nv = m.flex_vertnum[f];
  let tri = null, seg = null;
  if (dim === 1) {
    const ea = m.flex_elemdataadr[f], ne = m.flex_elemnum[f];
    seg = new Uint32Array(2 * ne); for (let i = 0; i < 2 * ne; i++) seg[i] = m.flex_elem[ea + i];
  } else if (dim === 2) {
    const ea = m.flex_elemdataadr[f], ne = m.flex_elemnum[f];
    tri = new Uint32Array(3 * ne); for (let i = 0; i < 3 * ne; i++) tri[i] = m.flex_elem[ea + i];
  } else {
    const sa = m.flex_shelldataadr[f], ns = m.flex_shellnum[f];
    tri = new Uint32Array(3 * ns); for (let i = 0; i < 3 * ns; i++) tri[i] = m.flex_shell[sa + i];
  }
  const pos = new Float32Array(3 * nv), nor = new Float32Array(3 * nv);
  let g = null;
  if (tri) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(tri, 1));
  }
  return {
    dim, geometry: g, seg, pos, nv, va, radius: m.flex_radius ? m.flex_radius[f] : 0.005,
    update(d) {
      const X = d.flexvert_xpos;
      for (let i = 0; i < 3 * nv; i++) pos[i] = X[3 * va + i];
      if (g) { areaNormals(pos, tri, nor); g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; }
    },
  };
}
