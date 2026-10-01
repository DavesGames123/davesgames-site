// ============================================================================
//  SDF FORGE  ·  examples.js — the example documents
// ----------------------------------------------------------------------------
//  PURE. Each example is built with the document operations a user has, so
//  every example is also a test of them (tests.mjs compiles each one with
//  naga). Sizes are in world units; the ground is y = 0.
//
//  GREP MAP
//    EXAMPLES ...... { key: { label, note, build() } }
//    primitives / pawn / creature / chain / tower / flange
// ============================================================================
import * as D from './doc.js';
import * as M from './math.js';

const mat = (color, rough = 0.45, metal = 0) => ({ color, rough, metal });
function P(doc, type, o) { const n = D.makePrim(doc, type, o); doc.nodes[n.id] = n; return n; }
function G(doc, op, smooth, k, kids, o = {}) {
  const g = D.makeGroup(doc, op, smooth, { p: { k }, ...o });
  // the modifier calls below need the group in the document
  doc.nodes[g.id] = g;
  for (const n of kids) { doc.nodes[n.id] = n; g.children.push(n.id); }
  return g;
}
const root = (doc, n) => { doc.nodes[n.id] = n; doc.roots.push(n.id); return n; };

function primitives() {
  const doc = D.newDoc();
  root(doc, P(doc, 'box', { pos: [-4.5, 0.8, -1], p: { w: 1.8, h: 1.6, d: 1.8 } }));
  root(doc, P(doc, 'sphere', { pos: [-1.8, 1, -1], p: { r: 1 } }));
  root(doc, P(doc, 'cylinder', { pos: [0.8, 1, -1], p: { r: 0.8, h: 2 } }));
  root(doc, P(doc, 'cone', { pos: [3.4, 1.1, -1], p: { r1: 0.95, r2: 0.2, h: 2.2 } }));
  root(doc, P(doc, 'torus', { pos: [6, 0.3, -1], p: { R: 1, r: 0.3 } }));
  const s = P(doc, 'sphere', { pos: [-0.4, 1.1, 2.4], p: { r: 1.1 }, mat: mat([0.86, 0.5, 0.3], 0.35) });
  const c = P(doc, 'box', { pos: [0.6, 1.6, 3.0], rot: [20, 30, 0], p: { w: 1.4, h: 1.4, d: 1.4 } });
  const g = G(doc, 'subtract', true, 0.15, [s, c], { name: 'SmoothSubtract' });
  g.pos = [0, 0, 0];
  root(doc, g);
  return doc;
}

function pawn() {
  const doc = D.newDoc();
  const ivory = mat([0.93, 0.9, 0.83], 0.28), ebony = mat([0.07, 0.07, 0.08], 0.22);
  const make = (x, m, name) => {
    const parts = [
      P(doc, 'cylinder', { name: 'Foot', pos: [0, 0.16, 0], p: { r: 1, h: 0.32 }, mat: m }),
      P(doc, 'torus', { name: 'Ring', pos: [0, 0.38, 0], p: { R: 0.82, r: 0.13 }, mat: m }),
      P(doc, 'cone', { name: 'Body', pos: [0, 1.06, 0], p: { r1: 0.66, r2: 0.22, h: 1.35 }, mat: m }),
      P(doc, 'cylinder', { name: 'Collar', pos: [0, 1.74, 0], p: { r: 0.48, h: 0.08 }, mat: m }),
      P(doc, 'sphere', { name: 'Head', pos: [0, 2.16, 0], p: { r: 0.44 }, mat: m }),
    ];
    D.addMod(doc, parts[3].id, 'round'); parts[3].mods[0].p = { r: 0.05 };
    const g = G(doc, 'union', true, 0.14, parts, { name });
    g.pos = [x, 0, 0];
    return root(doc, g);
  };
  make(-1.4, ivory, 'PawnWhite');
  make(1.4, ebony, 'PawnBlack');
  root(doc, P(doc, 'box', { name: 'Board', pos: [0, -0.1, 0], p: { w: 6, h: 0.2, d: 4 }, mat: mat([0.36, 0.22, 0.12], 0.55) }));
  return doc;
}

function creature() {
  const doc = D.newDoc();
  const skin = mat([0.22, 0.66, 0.58], 0.38), eye = mat([0.03, 0.03, 0.04], 0.1), white = mat([0.95, 0.95, 0.92], 0.3);
  const body = P(doc, 'ellipsoid', { name: 'Body', pos: [0, 1.15, 0], p: { rx: 1.15, ry: 0.85, rz: 1.0 }, mat: skin });
  D.addMod(doc, body.id, 'displace'); body.mods[0].p = { a: 0.025, f: 5 };
  const head = P(doc, 'sphere', { name: 'Head', pos: [0, 2.0, 0.75], p: { r: 0.62 }, mat: skin });
  const leg = P(doc, 'capsule', { name: 'Leg', pos: [0.62, 0.42, 0.5], rot: [10, 0, -12], p: { r: 0.22, h: 0.55 }, mat: skin });
  const legs = G(doc, 'union', false, 0.3, [leg], { name: 'Legs' });
  D.addMod(doc, legs.id, 'mirror'); legs.mods[0].p = { x: 1, y: 0, z: 1, off: 0 };
  const tail = P(doc, 'capsule', { name: 'Tail', pos: [0, 1.0, -1.25], rot: [-60, 0, 0], p: { r: 0.16, h: 0.9 }, mat: skin });
  const blob = G(doc, 'union', true, 0.35, [body, head, legs, tail], { name: 'Blob' });
  const eyeW = P(doc, 'sphere', { name: 'EyeWhite', pos: [0.24, 2.12, 1.2], p: { r: 0.17 }, mat: white });
  const pupil = P(doc, 'sphere', { name: 'Pupil', pos: [0.26, 2.14, 1.33], p: { r: 0.075 }, mat: eye });
  const eyes = G(doc, 'union', false, 0.1, [eyeW, pupil], { name: 'Eyes' });
  D.addMod(doc, eyes.id, 'mirror'); eyes.mods[0].p = { x: 1, y: 0, z: 0, off: 0 };
  root(doc, G(doc, 'union', false, 0.3, [blob, eyes], { name: 'Creature' }));
  return doc;
}

function chain() {
  const doc = D.newDoc();
  const gold = mat([1.0, 0.77, 0.34], 0.22, 1);
  // Interlocking pitch: each wire runs through the middle of the next loop.
  // The links lie along an arc on the ground, flat and upright in turn. A
  // limited repeat cannot do this: a link crosses its cell, and one sample
  // per cell would cut it at the boundary.
  const le = 0.35, R = 0.45, r = 0.12, s = 2 * le + R, rad = 4.2, n = 9;
  const kids = [];
  for (let i = 0; i < n; i++) {
    const th = (i - (n - 1) / 2) * s / rad;
    const pos = [rad * Math.cos(th) - rad, 0, rad * Math.sin(th)];
    let rot;
    if (i % 2 === 0) { pos[1] = r; rot = [90, -th / M.DEG, 0]; }
    else {
      pos[1] = R + r;
      const Rm = M.m3mul(M.eulerToM3([0, -(th / M.DEG) - 90, 0]), M.eulerToM3([0, 0, 90]));
      rot = M.m3ToEuler(Rm).map(v => +v.toFixed(4));
    }
    kids.push(P(doc, 'link', { name: 'Link' + String(i + 1).padStart(2, '0'), pos, rot, p: { le, R, r }, mat: gold }));
  }
  const g = G(doc, 'union', false, 0.1, kids, { name: 'Chain' });
  g.pos = [2.1, 0, 0];
  root(doc, g);
  return doc;
}

function tower() {
  const doc = D.newDoc();
  const concrete = mat([0.78, 0.77, 0.74], 0.6), glass = mat([0.46, 0.64, 0.8], 0.12, 0.15);
  const core = P(doc, 'roundbox', { name: 'Core', pos: [0, 0, 0], p: { w: 1.5, h: 6, d: 1.5, r: 0.12 }, mat: glass });
  const floor = P(doc, 'box', { name: 'Floors', pos: [0, 0, 0], p: { w: 2.3, h: 0.12, d: 2.3 }, mat: concrete });
  D.addMod(doc, floor.id, 'repeat'); floor.mods[0].p = { s: 0.6, nx: 0, ny: 4, nz: 0 };
  D.addMod(doc, floor.id, 'round'); floor.mods[1].p = { r: 0.03 };
  const spire = P(doc, 'cone', { name: 'Spire', pos: [0, 3.8, 0], p: { r1: 0.5, r2: 0.02, h: 1.6 }, mat: concrete });
  const body = G(doc, 'union', true, 0.08, [core, floor, spire], { name: 'Tower' });
  body.pos = [0, 3.15, 0];
  D.addMod(doc, body.id, 'twist'); body.mods[0].p = { k: 0.32 };
  root(doc, body);
  root(doc, P(doc, 'cylinder', { name: 'Plinth', pos: [0, 0.15, 0], p: { r: 2.2, h: 0.3 }, mat: concrete }));
  return doc;
}

function flange() {
  const doc = D.newDoc();
  const steel = mat([0.62, 0.64, 0.68], 0.32, 1);
  const base = P(doc, 'cylinder', { name: 'Disc', pos: [0, 0.25, 0], p: { r: 2, h: 0.5 }, mat: steel });
  const boss = P(doc, 'hexprism', { name: 'Boss', pos: [0, 0.9, 0], p: { r: 0.9, h: 1.3 }, mat: steel });
  const body = G(doc, 'union', true, 0.22, [base, boss], { name: 'Body' });
  const bore = P(doc, 'cylinder', { name: 'Bore', pos: [0, 0.8, 0], p: { r: 0.45, h: 3 }, mat: steel });
  const hole = P(doc, 'cylinder', { name: 'BoltHole', pos: [1.05, 0.25, 1.05], p: { r: 0.2, h: 2 }, mat: steel });
  const holes = G(doc, 'union', false, 0.1, [hole], { name: 'BoltHoles' });
  D.addMod(doc, holes.id, 'mirror'); holes.mods[0].p = { x: 1, y: 0, z: 1, off: 0 };
  const slot = P(doc, 'box', { name: 'Slot', pos: [0, 1.55, 0], p: { w: 2.4, h: 0.3, d: 0.22 }, mat: steel });
  const part = G(doc, 'subtract', true, 0.05, [body, bore, holes, slot], { name: 'Flange' });
  D.addMod(doc, part.id, 'round'); part.mods[0].p = { r: 0.015 };
  root(doc, part);
  return doc;
}

export const EXAMPLES = {
  primitives: { label: 'Primitives', note: 'Forge\'s lineup, and a smooth subtract.', build: primitives },
  pawn: { label: 'Chess pawns', note: 'Five shapes stacked like a lathe profile and blended with a smooth union.', build: pawn },
  creature: { label: 'Blob creature', note: 'Smooth unions, a displaced body, and mirror modifiers for the legs and eyes.', build: creature },
  chain: { label: 'Chain', note: 'Nine links along an arc, flat and upright in turn: each link is rotated to the tangent.', build: chain },
  tower: { label: 'Twisted tower', note: 'Repeated floors in a group with a twist modifier.', build: tower },
  flange: { label: 'Flange', note: 'A smooth subtract of a bore, mirrored bolt holes and a slot, then a round.', build: flange },
};
