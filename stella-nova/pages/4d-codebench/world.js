// ============================================================================
//  WORLD  ·  the 4D world format and its checker (ES module, no DOM)
// ----------------------------------------------------------------------------
//  One format carries every 4D scene on this page: the reference scenes
//  (scenes.js), the submissions that the sandbox runs (sandbox.js), the
//  renderer (render.js) and the scorer (score.js). It is a small, original
//  stand-in for the world format of 4DCodeBench: explicit geometry for each
//  frame, with fixed topology so that vertex i of an object is the same bit
//  of matter in every frame (temporal correspondence).
//
//  Coordinates: metres, y up, the floor is the plane y = 0.
//
//  World = {
//    fps:    number          frames per second (30 on this page)
//    frames: number          frame count T
//    camera: { eye: [x,y,z], target: [x,y,z], fovY: degrees }   up is +y
//    objects: [ Obj, ... ]
//  }
//  Obj = {
//    name:    string
//    kind:    'mesh' | 'points'    points: particles (grains, fluid)
//    color:   [r, g, b]            each 0..1
//    dynamic: boolean              false: the object does not move
//    count:   number               vertices (mesh) or particles (points)
//    faces:   Uint32Array          mesh only: 3 vertex indices per triangle
//    radius:  number               points only: particle radius in metres
//    pos:     Float32Array         frames * count * 3. Vertex i at frame t
//                                  is pos[(t * count + i) * 3 + 0..2].
//                                  A static object may give one frame
//                                  (count * 3 floats); readers repeat it.
//  }
//
//  Limits that keep the browser fast: at most 24 objects, at most 20000
//  vertices or particles per object, at most 240 frames.
//
//  EXPORTS   (grep -n "<anchor>" world.js)
//    limits ........... "export const LIMITS"
//    vertex read ...... "export function vert"
//    frame slice ...... "export function frameOf"
//    checker .......... "export function validate"
//    bounds ........... "export function bounds"
// ============================================================================

export const LIMITS = { objects: 24, count: 20000, frames: 240 };

// Number of frames stored for an object: frames, or 1 for a static object.
export function storedFrames(o) { return o.pos.length / (o.count * 3); }

// Position of vertex i of object o at frame t, written into out.
export function vert(o, t, i, out) {
  const f = storedFrames(o) === 1 ? 0 : t;
  const k = (f * o.count + i) * 3;
  out[0] = o.pos[k]; out[1] = o.pos[k + 1]; out[2] = o.pos[k + 2];
  return out;
}

// The Float32Array view of object o at frame t (count * 3 floats).
export function frameOf(o, t) {
  const f = storedFrames(o) === 1 ? 0 : t;
  return o.pos.subarray(f * o.count * 3, (f + 1) * o.count * 3);
}

// Check a world against the format. Returns { ok, errors: [string] }. The
// checker of the real benchmark rejects malformed submissions before
// scoring; this one does the same for the sandbox.
export function validate(w) {
  const e = [];
  const num = (v, name) => { if (typeof v !== 'number' || !Number.isFinite(v)) e.push(`${name} is not a finite number`); };
  if (!w || typeof w !== 'object') return { ok: false, errors: ['world is not an object'] };
  num(w.fps, 'fps'); num(w.frames, 'frames');
  if (!(w.frames >= 1 && w.frames <= LIMITS.frames && Number.isInteger(w.frames))) e.push(`frames must be an integer 1..${LIMITS.frames}`);
  const c = w.camera;
  if (!c || !Array.isArray(c.eye) || !Array.isArray(c.target) || c.eye.length !== 3 || c.target.length !== 3) e.push('camera needs eye and target as [x, y, z]');
  else { c.eye.forEach((v, i) => num(v, `camera.eye[${i}]`)); c.target.forEach((v, i) => num(v, `camera.target[${i}]`)); num(c.fovY, 'camera.fovY'); }
  if (!Array.isArray(w.objects) || !w.objects.length) e.push('objects must be a non-empty array');
  else if (w.objects.length > LIMITS.objects) e.push(`at most ${LIMITS.objects} objects`);
  else w.objects.forEach((o, n) => {
    const at = `objects[${n}] (${o && o.name})`;
    if (!o || typeof o !== 'object') { e.push(`${at} is not an object`); return; }
    if (o.kind !== 'mesh' && o.kind !== 'points') e.push(`${at}: kind must be 'mesh' or 'points'`);
    if (!(Number.isInteger(o.count) && o.count >= 1 && o.count <= LIMITS.count)) { e.push(`${at}: count must be an integer 1..${LIMITS.count}`); return; }
    if (!(o.pos instanceof Float32Array)) { e.push(`${at}: pos must be a Float32Array`); return; }
    const per = o.count * 3;
    if (o.pos.length !== per && o.pos.length !== per * w.frames) e.push(`${at}: pos length ${o.pos.length} is not count*3 or frames*count*3`);
    for (let k = 0; k < o.pos.length; k++) if (!Number.isFinite(o.pos[k])) { e.push(`${at}: pos[${k}] is not finite`); break; }
    if (o.kind === 'mesh') {
      if (!(o.faces instanceof Uint32Array) || o.faces.length % 3 || !o.faces.length) e.push(`${at}: faces must be a Uint32Array of triangles`);
      else for (let k = 0; k < o.faces.length; k++) if (o.faces[k] >= o.count) { e.push(`${at}: face index ${o.faces[k]} >= count`); break; }
    } else num(o.radius, `${at}.radius`);
    if (!Array.isArray(o.color) || o.color.length !== 3) e.push(`${at}: color must be [r, g, b]`);
  });
  return { ok: e.length === 0, errors: e };
}

// Axis-aligned bounds of all objects at frame t: { min: [..], max: [..] }.
export function bounds(w, t = 0) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], p = [0, 0, 0];
  for (const o of w.objects) for (let i = 0; i < o.count; i++) {
    vert(o, t, i, p);
    for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; }
  }
  return { min: mn, max: mx };
}
