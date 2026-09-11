// ============================================================================
//  ATOMIC ORBITAL VR  ·  hydrogenic orbital as a live particle cloud
// ----------------------------------------------------------------------------
//  Samples the hydrogen wavefunction ψ(n,ℓ,m) as hundreds of thousands of GPU
//  points, colors each by |ψ|², Re(ψ), Im(ψ) or phase, and animates the points
//  along the probability current. On top of the cloud it computes a magnetic
//  field from that current (discrete Biot-Savart) and draws it as arrows and
//  advected tracers. The whole scene is grabbable in WebXR immersive-ar with a
//  world-space control panel poked by the fingertip.
//
//  MODULE MAP  (this file is the entry; each subsystem is its own ES module)
//  ----------------------------------------------------------------------------
//      core.js ......... S, isMobile, scene/camera/renderer/controls,
//                        orbitalGroup, scene scaffold, RT runtime state
//      physics.js ...... pure wavefunction math + colormaps
//      cdf.js .......... inverse-CDF radial + theta samplers
//      particles.js .... buffers, pSystem, startRebuild/startGrow/spawnChunk/
//                        updateColors/animateFlow/rebuildStaticFlow
//      bfield.js ....... computeBField/sampleBField/uploadBArrows + arrows
//      tracers.js ...... flow tracers + B-field tracers
//      arpanel.js ...... world-space canvas GUI + hand dots
//      gestures.js ..... hand tracking / pinch + handleVRInput
//      arsession.js .... immersive-ar session (window._arUpdate*)
//      ui.js ........... panel/slider DOM wiring (initUI) + setters
//
//  RENDER LOOP  (renderer.setAnimationLoop) — orchestration kept here
//  ----------------------------------------------------------------------------
//      dirty? rebuild : spawnChunk ▶ evolve colors ▶ animateFlow ▶ tracers
//      ▶ periodic B recompute ▶ nucleus spin ▶ XR input ▶ AR panel ▶ render
// ============================================================================
import * as THREE from 'three';
import { renderer, scene, camera, controls, orbitalGroup, S, RT,
         nucleusGroup, bgDimMesh } from './core.js';
import { startRebuild, spawnChunk, updateColors, animateFlow, pMat } from './particles.js';
import { computeBField } from './bfield.js';
import { updateFlowTracers, updateBTracers } from './tracers.js';
import { updateARPanel } from './arpanel.js';
import { handleVRInput } from './gestures.js';
import { initUI, syncQN } from './ui.js';
import './arsession.js';   // side effect: wires the AR button + window._arUpdate*

// Bind the DOM controls and run the initial setters (setMagField / setAnimate
// and the slider syncs) in the original order.
initUI();

// Paces the periodic Biot-Savart recompute; owned by the render loop alone.
let bFieldFrameCount=0;

// Frame clock.
const clock=new THREE.Clock();
// Guarantee material size matches state regardless of initialization order.
pMat.size = S.psize;
// First fill of the cloud.
startRebuild();

// The per-frame loop, driven by WebXR when in a session and by rAF otherwise.
// Order: rebuild if dirty, otherwise stream/evolve/animate the cloud, update the
// tracers and periodic B solve, spin the nucleus, then handle XR input, the AR
// panel, and the passthrough dim plane before rendering.
renderer.setAnimationLoop((time, frame)=>{
  const dt=clock.getDelta();

  // Quantum state changed → full clear and rebuild
  if(S.dirty){S.dirty=false;S.colDirty=false;RT.colorRollIdx=0;startRebuild();return;}

  // Grow/shrink particle count each frame
  spawnChunk();

  // Time-evolve phase (rolling window so large counts stay smooth)
  if(S.evolving&&S.colorMode!==0){S.simTime+=dt*S.timeSpeed*12;updateColors();}
  else if(S.colDirty){S.colDirty=false;RT.colorRollIdx=0;updateColors();}

  // Animate particle positions along J
  if(S.animateFlow&&S.m!==0){
    animateFlow(dt);
    if(S.colorMode!==0) updateColors();
  }

  // Flow tracers
  updateFlowTracers(dt);

  // B field: periodic recompute
  if(S.showBField){
    bFieldFrameCount++;
    if(bFieldFrameCount>=S.bUpdateEvery){
      bFieldFrameCount=0;
      if(!RT.bFieldScheduled){RT.bFieldScheduled=true;setTimeout(computeBField,0);}
    }
  }

  // B-field tracers
  updateBTracers(dt);

  // Nucleus spin animation
  nucleusGroup.children.forEach(c=>{if(c.userData.spinSpeed)c.rotateOnAxis(c.userData.spinAxis,c.userData.spinSpeed*dt);});

  handleVRInput(frame);
  if(frame && window._arUpdateHitTest) _arUpdateHitTest(frame);
  if(window._arUpdateScale) _arUpdateScale(dt);
  updateARPanel(frame);
  // Safety: clamp scale back to 1 if something collapsed it outside AR mode
  if(!document.body.classList.contains('ar-mode') && orbitalGroup.scale.x < 0.05)
    orbitalGroup.scale.setScalar(1);
  // Track bgDimMesh to camera so it always covers the full AR passthrough background
  if(bgDimMesh.visible){
    bgDimMesh.position.copy(camera.position);
    bgDimMesh.quaternion.copy(camera.quaternion);
    bgDimMesh.translateZ(-10);
  }
  controls.update();
  renderer.render(scene,camera);
});

// Seed the display from the default sliders once wiring is complete.
syncQN();
