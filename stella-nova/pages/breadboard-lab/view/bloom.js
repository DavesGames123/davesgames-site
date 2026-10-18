// ============================================================================
//  BREADBOARD LAB  ·  view/bloom.js — bloom from the emitters only
// ----------------------------------------------------------------------------
//  A composer pass between the RenderPass and the OutputPass. It draws the
//  bloom source image itself, so lit white plastic and chrome never bloom:
//    1. the BASE layer with one black material (it only writes depth, so a
//       part in front of an LED hides the LED), with no background, no
//       environment and no fog
//    2. the EMIT layer with the real materials on top. The lights are on
//       BASE only, so an emitter shows its emission and nothing else.
//    3. an UnrealBloomPass (threshold, strength and radius from
//       core/light.js BLOOM) blurs that image. Its composite target
//       (renderTargetsHorizontal[0], three r160) is added to the frame
//       with the additive copy material of the bloom pass.
//  The source target has the size of the composer targets, so the bloom
//  follows the canvas size and the pixel ratio (setSize). The source target
//  has the canvas aspect, so lib/tilt.js turns the camera for it in the
//  same way as for the RenderPass.
//
//  The browser loads this module with the postprocessing addons. node
//  never runs it (no WebGL), but node imports it (no top-level THREE).
//
//  GREP MAP
//    createEmitterBloom .... (THREE, { Pass, UnrealBloomPass }, scene, camera, cfg)
//    render ................ source image, bloom, additive blend
//    setSize / dispose
// ============================================================================
import { LAYER, BLOOM } from '../core/light.js';

export function createEmitterBloom(THREE, mods, scene, camera, cfg = BLOOM) {
  const { Pass, UnrealBloomPass } = mods;
  class EmitterBloomPass extends Pass {
    constructor() {
      super();
      this.needsSwap = false;
      this.source = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), cfg.strength, cfg.radius, cfg.threshold);
      this.black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
      this.clear = new THREE.Color(0, 0, 0);
      this.keepClear = new THREE.Color();
    }
    setSize(w, h) {
      this.source.setSize(w, h);
      this.bloom.setSize(w, h);
    }
    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      const bg = scene.background, env = scene.environment, fog = scene.fog, over = scene.overrideMaterial;
      const mask = camera.layers.mask, autoClear = renderer.autoClear;
      renderer.getClearColor(this.keepClear);
      const alpha = renderer.getClearAlpha();
      scene.background = null; scene.environment = null; scene.fog = null;
      renderer.setRenderTarget(this.source);
      renderer.setClearColor(this.clear, 1);
      renderer.clear();
      renderer.autoClear = false;
      scene.overrideMaterial = this.black;
      camera.layers.set(LAYER.BASE);
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
      camera.layers.set(LAYER.EMIT);
      renderer.render(scene, camera);
      camera.layers.mask = mask;
      scene.background = bg; scene.environment = env; scene.fog = fog; scene.overrideMaterial = over;
      renderer.autoClear = autoClear;
      renderer.setClearColor(this.keepClear, alpha);
      // the bloom of the source image; render() leaves the composite in
      // renderTargetsHorizontal[0] and its additive copy material set up
      this.bloom.render(renderer, null, this.source, deltaTime, maskActive);
      renderer.setRenderTarget(readBuffer);
      this.bloom.fsQuad.material = this.bloom.blendMaterial;
      this.bloom.copyUniforms.tDiffuse.value = this.bloom.renderTargetsHorizontal[0].texture;
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      this.bloom.fsQuad.render(renderer);
      renderer.autoClear = ac;
    }
    dispose() {
      this.source.dispose();
      this.bloom.dispose();
      this.black.dispose();
    }
  }
  return new EmitterBloomPass();
}
