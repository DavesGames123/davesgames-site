// ============================================================================
//  MATERIAL STUDIO  ·  viewport/preview-mesh.js — the preview mesh on the GPU, .obj load
// ────────────────────────────────────────────────────────────────────────────
//  Builds the preview mesh with ../mesh.js and uploads it as one interleaved
//  vertex buffer (48 bytes a vertex) and a uint32 index buffer. R.meshKey
//  holds the mesh name and density, so a change of either rebuilds the
//  buffers. The wireframe edge buffer is made on first use. loadOBJFile()
//  makes an .obj file the 'custom' mesh.
//
//  GREP TARGETS
//      ensureMesh ............. the current mesh, rebuilt on a key change
//      uploadMesh ............. vertex and index buffers from mesh data
//      ensureEdges ............ the wireframe index buffer
//      loadOBJFile ............ parse an .obj File into R.custom
// ============================================================================
import { buildMesh, parseOBJ, edgeIndices } from '../mesh.js';
import { device, store, state, cam, R, clamp, idOf } from './state.js';
import { updateStats, syncHud } from './hud.js';
import { requestRender } from './render.js';

export function ensureMesh() {
  let name = state.view.mesh;
  if (name === 'custom' && !R.custom) name = 'sphere';
  const sub = clamp(+state.view.subdiv || 128, 16, 512);
  const key = name === 'custom' ? 'custom|' + idOf(R.custom) : `${name}|${sub}`;
  if (R.mesh && R.meshKey === key) return R.mesh;
  const data = name === 'custom' ? R.custom : buildMesh(name, { subdiv: sub });
  if (R.mesh) { R.mesh.vbuf.destroy(); R.mesh.ibuf.destroy(); R.mesh.ebuf?.destroy(); }
  R.mesh = uploadMesh(data, name);
  R.meshKey = key; R.shadowSig = '';
  updateStats();
  return R.mesh;
}

function uploadMesh(m, name) {
  const nv = m.positions.length / 3;
  const v = new Float32Array(nv * 12);
  for (let i = 0; i < nv; i++) {
    const o = i * 12;
    v[o] = m.positions[i * 3]; v[o + 1] = m.positions[i * 3 + 1]; v[o + 2] = m.positions[i * 3 + 2];
    v[o + 3] = m.normals[i * 3]; v[o + 4] = m.normals[i * 3 + 1]; v[o + 5] = m.normals[i * 3 + 2];
    v[o + 6] = m.uvs[i * 2]; v[o + 7] = m.uvs[i * 2 + 1];
    v[o + 8] = m.tangents[i * 4]; v[o + 9] = m.tangents[i * 4 + 1]; v[o + 10] = m.tangents[i * 4 + 2]; v[o + 11] = m.tangents[i * 4 + 3];
  }
  const vbuf = device.createBuffer({ label: 'vp-vb-' + name, size: v.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, v);
  const ibuf = device.createBuffer({ label: 'vp-ib-' + name, size: Math.max(4, m.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, m.indices);
  const b = m.bounds || { min: [-1, -1, -1], max: [1, 1, 1], radius: 1 };
  return { name, data: m, vbuf, ibuf, count: m.indices.length, ebuf: null, ecount: 0, minY: b.min[1], radius: b.radius, vertices: nv, triangles: m.indices.length / 3 };
}

export function ensureEdges(mesh) {
  if (mesh.ebuf) return;
  const e = edgeIndices(mesh.data);
  mesh.ebuf = device.createBuffer({ label: 'vp-edges', size: Math.max(4, e.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(mesh.ebuf, 0, e);
  mesh.ecount = e.length;
}

/** Load a Wavefront .obj File as the 'custom' mesh. */
export async function loadOBJFile(file) {
  if (!file) return false;
  if (file.size > 96 * 1024 * 1024) { store.toast('The .obj file is larger than 96 MB', 'error'); return false; }
  try {
    const m = parseOBJ(await file.text());
    R.custom = m;
    store.toast(`Loaded ${file.name}: ${m.positions.length / 3} vertices, ${m.indices.length / 3} triangles`, 'ok');
    if (state.view.mesh === 'custom') { R.meshKey = ''; requestRender(); }
    else store.setView({ mesh: 'custom' });
    syncHud();
    cam && cam.frame(1);
    return true;
  } catch (e) {
    store.toast('Could not read the .obj file: ' + e.message, 'error');
    return false;
  }
}
