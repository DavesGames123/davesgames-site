// ============================================================================
//  WASM-4 ARCADE  ·  carts3d.js — 3D cartridges with printed labels
// ----------------------------------------------------------------------------
//  makeCart(cart, i) -> { group, id, paint(screen) }
//    group     a rounded plastic shell (DIM.cart), grip ridges, a top lip,
//              and a printed label on the front. Pick target: every mesh
//              has userData.pick = { type: 'cart', id }.
//    paint(cv) draws the label: the title band, the cart's own screen (the
//              160 x 160 canvas that main.js paints for the shelf; pixels
//              kept sharp) and the author and licence. Before the screen
//              exists, a pattern from the cart's id stands in.
//  The shell colour comes from PLASTICS by index, so neighbours differ.
//
//  drawLabel(g, cart, screen, w, h) is the 2D drawing, also used by tests.
//
//  grep -n targets  "export function makeCart"  "export function drawLabel"
//                   "export const PLASTICS"  "export const LABEL"
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeCanvas, canvasTex, rng } from './tex.js';
import { DIM } from './room.js';

export const PLASTICS = [0x3c3a40, 0x8d7bc4, 0x2f8f8a, 0xc94b3f, 0xe0c341, 0xd8d4cb, 0x3c69c9, 0x6b9a3a, 0xe58a3a, 0x222226];
export const LABEL = { w: 256, h: 272, plane: [6.6, 7.0] };
const BAND = ['#2b2d42', '#5a3a7a', '#1e5f5a', '#7a2a22', '#6b5a12', '#4a4640', '#1f3c7a', '#38521e', '#7a4518', '#111114'];

function fitFont(g, text, maxW, size, weight = 'bold') {
  let s = size;
  do { g.font = `${weight} ${s}px ui-sans-serif, system-ui, sans-serif`; s -= 1; } while (s > 10 && g.measureText(text).width > maxW);
}

export function drawLabel(g, cart, screen, i = 0, w = LABEL.w, h = LABEL.h) {
  g.fillStyle = '#f4ecd8'; g.fillRect(0, 0, w, h);
  g.fillStyle = BAND[i % BAND.length]; g.fillRect(0, 0, w, 40);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitFont(g, cart.title, w - 20, 26);
  g.fillText(cart.title, w / 2, 21);
  const S = 180, x = (w - S) / 2, y = 49;
  g.fillStyle = '#0d0c0b'; g.fillRect(x - 5, y - 5, S + 10, S + 10);
  if (screen) {
    g.imageSmoothingEnabled = false;
    g.drawImage(screen, x, y, S, S);
  } else {
    const r = rng(([...cart.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0) || 1);
    const pal = ['#071821', '#306850', '#86c06c', '#e0f8cf'];
    for (let yy = 0; yy < 14; yy++) for (let xx = 0; xx < 14; xx++) { g.fillStyle = pal[Math.floor(r() * 4)]; g.fillRect(x + xx * S / 14, y + yy * S / 14, S / 14 + 0.5, S / 14 + 0.5); }
  }
  g.fillStyle = '#3a3428'; fitFont(g, `${cart.author || ''}`, w - 24, 18, '600');
  g.fillText(cart.author || '', w / 2, y + S + 18);
  g.fillStyle = '#7a705e'; fitFont(g, `${cart.licence || ''} · WASM-4`, w - 24, 14, '500');
  g.fillText(`${cart.licence || ''} · WASM-4`, w / 2, y + S + 35);
}

let shared = null;
function geos() {
  if (shared) return shared;
  const C = DIM.cart;
  shared = {
    body: new RoundedBoxGeometry(C.w, C.h, C.t, 2, 0.35),
    label: new THREE.PlaneGeometry(LABEL.plane[0], LABEL.plane[1]),
    ridge: new THREE.BoxGeometry(C.w * 0.62, 0.22, 0.2),
  };
  return shared;
}

export function makeCart(cart, i) {
  const C = DIM.cart, G = geos(), g = new THREE.Group();
  g.name = 'cart-' + cart.id;
  const plastic = new THREE.MeshStandardMaterial({ color: PLASTICS[i % PLASTICS.length], roughness: 0.42, metalness: 0.02 });
  const body = new THREE.Mesh(G.body, plastic);
  body.castShadow = true; body.receiveShadow = true; g.add(body);
  const cv = makeCanvas(LABEL.w, LABEL.h), ctx = cv.getContext('2d');
  drawLabel(ctx, cart, null, i);
  const tex = canvasTex(THREE, cv);
  const label = new THREE.Mesh(G.label, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  label.position.set(0, C.h / 2 - 0.5 - LABEL.plane[1] / 2, C.t / 2 + 0.04);
  label.receiveShadow = true; g.add(label);
  for (let k = 0; k < 3; k++) {
    const r = new THREE.Mesh(G.ridge, plastic);
    r.position.set(0, -C.h / 2 + 0.45 + k * 0.42, C.t / 2 + 0.06); g.add(r);
  }
  g.traverse(o => { if (o.isMesh) o.userData.pick = { type: 'cart', id: cart.id }; });
  return {
    group: g, id: cart.id, canvas: cv, tex,
    paint(screen) { drawLabel(ctx, cart, screen, i); tex.needsUpdate = true; },
    dispose() { tex.dispose(); plastic.dispose(); label.material.dispose(); },
  };
}
