// foldio.js -- the FOLD file layer: read and write the origami interchange format.
//
// Port of origami src/model/fold_io.rs. FOLD is a JSON schema by Erik Demaine and
// Jason Ku. Its arrays are index-parallel, as CreasePattern stores them, so this
// layer is a copy and not a translation. Only the crease-pattern keys are read
// and written. Folded frames, multi-frame files, and layer orders are ignored.
//
// The web page adds two things the desktop app does not have: a file input that
// calls fromJson, and a download that calls toJson (see main.js importFold and
// exportFold).
//
// grep map:
//   toFold      -- CreasePattern to a FOLD object
//   fromFold    -- FOLD object to a CreasePattern
//   toJson / fromJson -- the string forms

import { CreasePattern, fromLetter } from './model.js';

// Build a FOLD object from a crease pattern. Key order follows the Rust struct.
export function toFold(cp) {
  const f = {
    file_spec: 1.2,
    file_creator: 'origami',
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
    vertices_coords: cp.vertices.map((v) => [v[0], v[1]]),
    edges_vertices: cp.edges.map((e) => [e[0], e[1]]),
    edges_assignment: cp.assignment.map((a) => a),
    edges_foldAngle: cp.foldAngle.slice(),
  };
  if (cp.faces.length) f.faces_vertices = cp.faces.map((x) => x.slice());
  return f;
}

// Build a crease pattern from a FOLD object. A 3D coordinate drops its z. A
// missing assignment array leaves every crease unassigned.
export function fromFold(f) {
  const cp = new CreasePattern();
  if (Array.isArray(f.vertices_coords)) {
    for (const c of f.vertices_coords) {
      const x = Math.fround(Number(c && c[0]) || 0);
      const y = Math.fround(Number(c && c[1]) || 0);
      cp.vertices.push([x, y]);
    }
  }
  if (Array.isArray(f.edges_vertices)) {
    f.edges_vertices.forEach((e, i) => {
      if (!Array.isArray(e) || e.length < 2) return;
      cp.edges.push([e[0] | 0, e[1] | 0]);
      const letter = Array.isArray(f.edges_assignment) && typeof f.edges_assignment[i] === 'string'
        ? f.edges_assignment[i].charAt(0) : 'U';
      cp.assignment.push(fromLetter(letter || 'U'));
      const ang = Array.isArray(f.edges_foldAngle) ? Number(f.edges_foldAngle[i]) : 0;
      cp.foldAngle.push(Math.fround(Number.isFinite(ang) ? ang : 0));
    });
  }
  if (Array.isArray(f.faces_vertices)) cp.faces = f.faces_vertices.map((x) => x.slice());
  return cp;
}

// A crease pattern as a pretty-printed FOLD JSON string.
export function toJson(cp) {
  return JSON.stringify(toFold(cp), null, 2);
}

// A crease pattern parsed from a FOLD JSON string. Throws on bad JSON, as the
// Rust version returns an error.
export function fromJson(s) {
  const f = JSON.parse(s);
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw new Error('a FOLD file is a JSON object');
  return fromFold(f);
}
