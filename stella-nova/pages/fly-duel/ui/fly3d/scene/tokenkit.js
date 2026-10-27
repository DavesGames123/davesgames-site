// ============================================================================
//  FLY DUEL 3D  ·  mana token meshes  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. tokenKit() makes the mana token meshes:
//  one prism per colour (ui/fly3d/mana.js tokenShape and colourHex), a dark
//  hull for a hard edge, and an inset for the second colour of a dual land.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'const TOKEN_HULL'          hull size factor
//      grep -n 'export function tokenKit'  token meshes
//      grep -n 'function toGeneric'        a token that pays a generic cost
// ============================================================================
import * as THREE from 'three';
import { TOKENS } from '../../tokens.js';
import { colourHex, tokenShape } from '../mana.js';

// --------------------------------------------------------- mana tokens
// The tokens are thick (0.08) and large (a third of the card width or
// more), so the mana on each stack reads in the wide shot. Each colour of
// game/cards.js has its own prism (ui/fly3d/mana.js tokenShape: amber a
// honeycomb cell, moss a diamond, the other colours the next free shape)
// and its own hue (colourHex). Generic mana is a grey square. A token of
// a dual land is the prism of its first colour with an inset of the
// second colour on top.
// A dark hull behind each token (back faces, 1.16 times the size) gives
// a hard edge. Without it, an amber token on an amber land has almost
// no contrast. It is an outline, not a glow: no blur, no blend.
const TOKEN_HULL = 1.16;
const TOKEN_H = 0.08;
export function tokenKit() {
  const geos = new Map(), mats = new Map();
  const hull = new THREE.MeshBasicMaterial({ color: new THREE.Color('#07080c'), side: THREE.BackSide });
  function geo(key) {
    const sides = key === 'generic' ? 0 : tokenShape(key);
    const k = 's' + sides;
    if (!geos.has(k)) {
      const r = sides === 0 ? 0 : sides === 3 ? 0.165 : sides === 4 ? 0.15 : 0.135;
      geos.set(k, sides === 0 ? new THREE.BoxGeometry(0.2, TOKEN_H, 0.2) : new THREE.CylinderGeometry(r, r, TOKEN_H, sides));
    }
    return geos.get(k);
  }
  function inset(key) {
    const sides = tokenShape(key) || 4, k = 'i' + sides;
    if (!geos.has(k)) { const r = 0.075; geos.set(k, new THREE.CylinderGeometry(r, r, TOKEN_H * 1.08, sides)); }
    return geos.get(k);
  }
  function mat(key) {
    if (!mats.has(key)) {
      const c = key === 'generic' ? TOKENS.none : colourHex(key);
      mats.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(c), emissive: new THREE.Color(c), emissiveIntensity: key === 'generic' ? 0.35 : 0.5, roughness: 0.35, metalness: 0.1 }));
    }
    return mats.get(key);
  }
  // A token mesh for a list of colours ([] or ['generic'] = generic).
  function make(colours) {
    const cs = colours && colours.length ? colours : ['generic'];
    const m = new THREE.Mesh(geo(cs[0]), mat(cs[0]));
    m.castShadow = true;
    const h = new THREE.Mesh(geo(cs[0]), hull);
    h.scale.setScalar(TOKEN_HULL); h.name = 'token-hull'; m.add(h);
    if (cs[1]) { const i = new THREE.Mesh(inset(cs[1]), mat(cs[1])); i.name = 'token-inset'; m.add(i); }
    m.userData.kind = cs.join('+');
    m.rotation.y = cs[0] === 'amber' ? Math.PI / 6 : 0;
    return m;
  }
  // Turn a token into a generic one (a token that pays a generic cost).
  function toGeneric(m) {
    m.geometry = geo('generic'); m.material = mat('generic'); m.userData.kind = 'generic';
    if (m.children[0]) m.children[0].geometry = geo('generic');
    for (const c of m.children) if (c.name === 'token-inset') c.visible = false;
  }
  // Show only the paid colour (a dual land that pays its second colour).
  function toColour(m, key) {
    m.geometry = geo(key); m.material = mat(key); m.userData.kind = key;
    if (m.children[0]) m.children[0].geometry = geo(key);
    for (const c of m.children) if (c.name === 'token-inset') c.visible = false;
  }
  function dispose() { for (const g of geos.values()) g.dispose(); for (const x of mats.values()) x.dispose(); hull.dispose(); }
  return { make, toGeneric, toColour, mat, geo, dispose };
}
