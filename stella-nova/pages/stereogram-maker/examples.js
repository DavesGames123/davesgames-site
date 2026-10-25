// ============================================================================
//  STEREOGRAM MAKER  ·  examples.js — the example gallery (no DOM)
// ----------------------------------------------------------------------------
//  EXAMPLES is the list of ready pairs on the Examples tab. Each one is a
//  part of the page state (state.js): src, pat and an optional view. A
//  model example with no yaw or pitch takes the view of its MODELS record
//  (models/index.js). The page shows the first example at load when the
//  link holds no state. The tests check that every model, tile and shape
//  id here exists.
//
//  Pairs are picked so the pattern suits the object: a busy, fine tile
//  for an object with small detail (the lion's mane, the skull), a broad
//  tile for a big smooth form (the apple, the duck), and few tiles with
//  long straight runs, because the eye can lock onto a run at the wrong
//  depth.
//
//  grep -n targets: "export const EXAMPLES", "export const SHAPE_NAMES"
// ============================================================================

export const SHAPE_NAMES = {
  sphere: 'Sphere', torus: 'Ring', steps: 'Steps', cone: 'Cone', ripple: 'Ripple', pyramid: 'Pyramid',
};

// A model example: title, note (the pattern), model id, tile id or a dot
// kind, and the tile seed.
const M = (title, note, id, pat, seed = 1) => ({
  title, note, src: { kind: 'model', id },
  pat: pat === 'dots' ? { kind: 'dots', seed } : pat === 'colour' ? { kind: 'colour', palette: 0, seed } : { kind: 'tile', id: pat, seed },
});

export const EXAMPLES = [
  M('Lion head', 'Morphogen', 'lion-head', 'pd-morphogen', 3),
  M('Marble bust', 'Crackle', 'marble-bust-01', 'pd-crackle', 2),
  M('Human skull', 'Circle pack', 'scattering-skull', 'pd-circle-pack', 4),
  M('Spider conch', 'Hex arcs', 'lambis-shell', 'pd-hex-arcs', 1),
  M('Horse head', 'Flow ribbons', 'horse-head', 'pd-flow-ribbons', 5),
  M('Concrete cat', 'Nested Truchet', 'concrete-cat-statue', 'pd-nested-truchet', 2),
  M('Pocket watch', 'Coloured dots', 'pocket-watch', 'colour', 6),
  M('Antique camera', 'Delaunay mesh', 'antique-camera', 'pd-delaunay-mesh', 3),
  M('Garden gnome', 'Screen dots', 'garden-gnome', 'pd-screen-dots', 1),
  M('Apple', 'Lava blobs', 'food-apple-01', 'pd-lava-blobs', 7),
  M('Bull head', 'Twirl checker', 'bull-head', 'pd-twirl-checker', 2),
  M('Barramundi', 'Curl streams', 'barramundi-fish', 'pd-curl-streams', 4),
  M('Brass microscope', 'Lead glass', 'vintage-microscope', 'pd-lead-glass', 3),
  M('Rubber duck', 'Tumbling blocks', 'rubber-duck-toy', 'pd-tumbling-blocks', 1),
  M('Pomegranate', 'Phase rings', 'food-pomegranate-01', 'pd-phase-rings', 2),
  M('Suzanne', 'Random dots', 'suzanne', 'dots', 9),
  { title: 'Look closer', note: 'Star rosettes', src: { kind: 'text', text: 'Look closer', face: 'bevel' }, pat: { kind: 'tile', id: 'pd-star-rosettes', seed: 2 } },
  { title: 'A ring', note: 'Random dots', src: { kind: 'shape', shape: 'torus' }, pat: { kind: 'dots', seed: 3 } },
];
