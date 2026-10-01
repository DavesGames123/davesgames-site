// ============================================================================
//  PROTEIN VIEWER  ·  app/stage.js — renderer, scene, lights, materials, controls
// ────────────────────────────────────────────────────────────────────────────
//  The three.js objects that live for the whole page. If WebGL 2 is not
//  available, this module shows #nogl and throws. main.js imports it
//  first, so the page then installs no listener and loads nothing.
//
//  GREP MAP
//    let renderer / const scene / camera / controls / post   the stage
//    const mol / over / overlay        layers, stick overlay, measure scene
//    const matAtom / matCartoon / matSurface / matMark / matLine  materials
//    function clearGroup               remove and dispose the children
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as R from '../reps.js';
import { Post } from '../post.js';
import { $, COARSE, DPR } from './env.js';

// ── renderer, scene, lights ───────────────────────────────────────────────
export const canvas = $('view');
export let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 required');
} catch (e) { $('nogl').hidden = false; throw e; }
renderer.setPixelRatio(DPR());
renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
export const envRT = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
scene.environment = envRT.texture;
pmrem.dispose();
export const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 2000);
scene.add(camera);
const key = new THREE.DirectionalLight(0xffffff, 2.3);
key.position.set(-0.55, 0.85, 1.0);
camera.add(key); camera.add(key.target); key.target.position.set(0, 0, -1);
const fill = new THREE.DirectionalLight(0xa9c2ff, 0.55);
fill.position.set(0.9, -0.4, 0.4);
camera.add(fill); camera.add(fill.target); fill.target.position.set(0, 0, -1);
scene.add(new THREE.HemisphereLight(0xe2e8ff, 0x1c1e2a, 0.5));
export const mol = new THREE.Group();
export const over = new THREE.Group();
scene.add(mol, over);
export const overlay = new THREE.Scene();
export const post = new Post(renderer, COARSE);

export const matAtom = R.makeMaterial({ roughness: 0.36 });
export const matCartoon = R.makeMaterial({ roughness: 0.48, vertexColors: true, side: THREE.DoubleSide });
export const matSurface = R.makeMaterial({ roughness: 0.55, vertexColors: true, env: 0.4 });
export const matMark = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
export const matLine = { distance: new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 0.45, gapSize: 0.3, depthTest: false, transparent: true }),
  angle: new THREE.LineDashedMaterial({ color: 0x9fe3ff, dashSize: 0.45, gapSize: 0.3, depthTest: false, transparent: true }),
  dihedral: new THREE.LineDashedMaterial({ color: 0xd6b0ff, dashSize: 0.45, gapSize: 0.3, depthTest: false, transparent: true }) };

export const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.rotateSpeed = COARSE ? 0.75 : 0.9; controls.zoomSpeed = 1.1; controls.panSpeed = 0.9;
controls.screenSpacePanning = true;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.autoRotateSpeed = 1.1;

export function clearGroup(g) {
  for (const c of [...g.children]) { g.remove(c); R.disposeObject(c); }
}
