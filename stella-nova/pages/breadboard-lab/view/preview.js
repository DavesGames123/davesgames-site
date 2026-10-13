// ============================================================================
//  BREADBOARD LAB  ·  view/preview.js — material swatches
// ----------------------------------------------------------------------------
//  view.previewMaterial(spec, size) (CONTRACT 4.2) renders a sphere and a
//  pin with one material into a small canvas, for the MATERIALS panel. It
//  uses the main renderer (one WebGL context for the page) and a render
//  target, then copies the pixels to a 2D canvas. Results are cached by
//  spec and size (64 entries).
//
//  In node (no document) it returns null.
//
//  GREP MAP
//    createPreview ...... small scene: sphere, pin, lights, camera
//    render ............. render target → pixels → canvas, cache
// ============================================================================

export function createPreview(THREE, renderer, env) {
  let scene = null, camera = null, sphere = null, pin = null;
  const cache = new Map();
  const targets = new Map();

  function setup() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111113);
    if (env) scene.environment = env;
    camera = new THREE.PerspectiveCamera(30, 1, 1, 200);
    camera.position.set(0, 9, 34);
    camera.lookAt(0, 0, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(10, 20, 14);
    scene.add(key, new THREE.HemisphereLight(0xdfe6ff, 0x202024, 0.7));
    sphere = new THREE.Mesh(new THREE.SphereGeometry(6, 48, 32));
    sphere.position.set(-2.5, 0, 0);
    pin = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 14, 20));
    pin.position.set(6.5, -1, 1);
    pin.rotation.z = 0.25;
    scene.add(sphere, pin);
  }

  return {
    render(spec, size = 96, makeMaterial) {
      if (typeof document === 'undefined' || !renderer || !renderer.setRenderTarget) return null;
      const key = JSON.stringify(spec) + '@' + size;
      if (cache.has(key)) return cache.get(key);
      if (!scene) setup();
      const mat = makeMaterial ? makeMaterial(spec) : new THREE.MeshStandardMaterial({ color: spec.color || '#888888', roughness: spec.roughness ?? 0.5, metalness: spec.metalness ?? 0 });
      sphere.material = mat; pin.material = mat;
      let rt = targets.get(size);
      if (!rt) { rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 }); if (THREE.SRGBColorSpace) rt.texture.colorSpace = THREE.SRGBColorSpace; targets.set(size, rt); }
      const prev = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      const px = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
      renderer.setRenderTarget(prev);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const c2 = canvas.getContext('2d');
      const img = c2.createImageData(size, size);
      for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
      c2.putImageData(img, 0, 0);
      cache.set(key, canvas);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return canvas;
    },
    dispose() {
      for (const rt of targets.values()) rt.dispose();
      targets.clear();
      cache.clear();
      if (sphere) { sphere.geometry.dispose(); pin.geometry.dispose(); }
    },
  };
}
