// ============================================================================
//  HUMAN SKELETON  ·  app/stage.js — renderer, scene, lights, floor, controls
// ────────────────────────────────────────────────────────────────────────────
//  This module makes the WebGL 2 renderer and the fixed scene objects. If
//  WebGL 2 is not available, it shows #nogl and throws, so no other module
//  of the page runs. The other modules import these objects and do not
//  replace them.
//
//  GREP MAP
//    const canvas / let renderer                     the WebGL 2 renderer
//    const scene / envRT / camera / pickCam          scene and cameras
//    const key / rim                                 the lights
//    const floor / poolTex / pool / trays            floor, light pool, trays
//    const U                                         colour uniforms
//    const controls                                  OrbitControls set-up
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { studioEnvironment } from '../render.js';
import { $, COARSE, DPR, THEMES } from './env.js';

export const canvas = $('view');
export let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 required');
} catch (e) { $('nogl').hidden = false; $('loading').hidden = true; throw e; }
renderer.setPixelRatio(DPR());
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

export const scene = new THREE.Scene();
export const envRT = studioEnvironment(renderer);
scene.environment = envRT.texture;
export const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
export const pickCam = new THREE.PerspectiveCamera();
pickCam.layers.set(1);
export const key = new THREE.DirectionalLight(0xfff0dc, 2.1);
key.castShadow = true;
key.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.012;
scene.add(key, key.target);
export const rim = new THREE.DirectionalLight(0xbcd2ff, 0.55);
rim.position.set(2.5, 2.2, -3);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xfff4e2, 0x2a2118, 0.25));

// floor: a shadow catcher and a soft pool of light under the specimen
export const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.5, color: 0x000000 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
export const poolTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
export const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, opacity: 0.1 }));
pool.rotation.x = -Math.PI / 2;
pool.position.y = 0.0005;
pool.renderOrder = -1;
scene.add(pool, floor);
export const trays = new THREE.Group();
scene.add(trays);

export const U = {
  uBone: { value: new THREE.Color(0xe7d9c0) }, uCav: { value: new THREE.Color(0x8a6a4a) },
  uSel: { value: new THREE.Color(THEMES.dark.sel) }, uHov: { value: new THREE.Color(THEMES.dark.hov) },
  uGhost: { value: new THREE.Color(THEMES.dark.ghost) }, uGhostA: { value: THEMES.dark.ghostA },
};

export const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.11;
controls.rotateSpeed = COARSE ? 0.8 : 0.9; controls.zoomSpeed = 1.1; controls.panSpeed = 0.9;
controls.screenSpacePanning = true;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.autoRotateSpeed = 0.8;
controls.minDistance = 0.08; controls.maxDistance = 14;
