// ============================================================================
//  BIOME PARTS  ·  gallery.js — goals to start from
// ----------------------------------------------------------------------------
//  DATA. The six showcase parts are Biome-S1's own showcase/goals.json
//  (github.com/shhivv/biome-s1, MIT, Shiv Shanmugam), copied unchanged; the
//  repo shows them built in FreeCAD in viz/public/parts. The eval picks are
//  goals from the repo's held-out suites (the goal streams of
//  freecad_s1/evaluate.py, seeds as given; make_ref.py regenerates them).
//
//  GREP MAP
//    GALLERY ........ key -> { name, note, goal, source }
// ============================================================================
const g = (level, scale, features) => ({ level, scale, features: features.map(([kind, params]) => ({ kind, params })) });
export const GALLERY = {
  flange: { name: 'Flange', source: 'showcase', note: 'Disc, centre boss, six bolt holes on a polar pattern, chamfered top.',
    goal: g(3, 72, [['base_cyl', { r: 36, h: 8 }], ['boss_cyl', { r: 15, x: 0, y: 0, h: 12 }], ['hole', { r: 3.2, x: 26, y: 0 }], ['polar_pattern', { n: 6 }], ['chamfer_top', { size: 1.5 }]]) },
  hex_nut: { name: 'Hex nut', source: 'showcase', note: 'Hexagon with a hole-tool bore and a chamfer.',
    goal: g(2, 32, [['base_hex', { r: 16, h: 12 }], ['hole_std', { r: 8, x: 0, y: 0 }], ['chamfer_top', { size: 1.5 }]]) },
  enclosure: { name: 'Enclosure', source: 'showcase', note: 'Box with rounded vertical edges, shelled open at the top.',
    goal: g(3, 70, [['base_box', { w: 70, d: 45, h: 28 }], ['fillet_vertical', { r: 6 }], ['shell', { t: 2 }]]) },
  mounting_plate: { name: 'Mounting plate', source: 'showcase', note: 'Plate, a centre pocket, two mirrored hole pairs, a chamfer. Seven items: longer than any training goal.',
    goal: g(4, 90, [['base_box', { w: 90, d: 60, h: 6 }], ['pocket_rect', { w: 36, d: 20, x: 0, y: 0, depth: 3 }], ['hole', { r: 3.5, x: 36, y: 22 }], ['mirror', {}], ['hole', { r: 3.5, x: 36, y: -22 }], ['mirror', {}], ['chamfer_top', { size: 1 }]]) },
  washer: { name: 'Washer', source: 'showcase', note: 'A ring revolved from a rectangle on the XZ plane, chamfered.',
    goal: g(2, 40, [['base_ring', { ri: 9, ro: 20, h: 5 }], ['chamfer_top', { size: 1 }]]) },
  slotted_wheel: { name: 'Slotted wheel', source: 'showcase', note: 'Disc, bore, a slot patterned eight times (a pocket under a polar pattern: a pair never seen in training), filleted.',
    goal: g(3, 64, [['base_cyl', { r: 32, h: 10 }], ['hole_std', { r: 6, x: 0, y: 0 }], ['pocket_rect', { w: 10, d: 5, x: 21, y: 0, depth: 5 }], ['polar_pattern', { n: 8 }], ['fillet_top', { r: 1.5 }]]) },
};
