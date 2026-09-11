/* ════════════════════════════════════════════════════════════
   AR SESSION — immersive-ar with surface hit-test placement
   Requests the session, hands it to the renderer, shrinks the
   simulation for headset budget, and wires pinch, hit-test, and
   placement. Session-local state stays module-private. The render
   loop calls window._arUpdateHitTest / window._arUpdateScale.
   Module top-level runs the wiring once, at import.
   GREP: _arUpdateHitTest | _arUpdateScale | arStatus
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { camera, renderer, controls, orbitalGroup, boundingCube, reticle,
         bgDimMesh, bgDimMat, S, RT } from './core.js';
import { pMat, startGrow } from './particles.js';
import { setMagField } from './ui.js';
import { ARP, initARPanel, _handDots } from './arpanel.js';
import { _sysActive, setVrRotY, setPendingPanelCheck } from './gestures.js';

// Whole AR flow scoped in a block so its session-local state stays private.
{
  const arBtn = document.getElementById('ar-btn');

  // ── Visible status/error — shown in headset since no console ──
  // In-headset toast: errors stick, informational messages clear after 4 s.
  function arStatus(msg, isErr){
    const el = document.getElementById('ar-status');
    if(!el) return;
    el.textContent = msg;
    el.className = 'ar-status-msg' + (isErr?' ar-err':'');
    el.style.display = 'block';
    if(!isErr) setTimeout(()=>{ el.style.display='none'; }, 4000);
  }

  let arSession    = null;
  let hitTestSrc   = null;
  let hasHitTest   = false;
  let arPlaced     = false;
  let arSpawnDone  = false;  // true after spawn anim completes — hand gestures own scale
  let arScaleTarget= 1;
  let inARSession  = false;
  let arSaved      = null;   // saved settings restored on exit
  const AR_SCALE   = 0.05;
  const AR_HOVER   = 0.10;

  // ── Support check ──
  // Enable the button only when immersive-ar is actually supported.
  if(navigator.xr){
    navigator.xr.isSessionSupported('immersive-ar')
      .then(ok => {
        if(ok){ arBtn.classList.add('vr-ready'); }
        else  { arBtn.textContent='AR unavailable'; arBtn.disabled=true; }
      })
      .catch(e => { arBtn.textContent='AR check failed'; arBtn.disabled=true; });
  } else {
    arBtn.textContent='No WebXR'; arBtn.disabled=true;
  }

  // Enter (or exit) AR. Requests the session, hands it to the renderer, shrinks
  // the simulation for headset budget, and wires pinch, hit-test, and placement.
  arBtn.addEventListener('click', async () => {
    if(arSession){ arSession.end(); return; }

    arStatus('Requesting AR session…');

    let s;
    try {
      s = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local'],
        optionalFeatures: ['hit-test','local-floor','hand-tracking','light-estimation'],
        // dom-overlay intentionally omitted — it renders above the system hand compositor
        // and obscures passthrough hands. All AR UI is in 3D world space instead.
      });
    } catch(e) {
      arStatus('Session failed: ' + (e.message||String(e)), true);
      return;
    }

    arStatus('AR started ✓');
    arSession    = s;
    arPlaced     = false;
    arSpawnDone  = false;
    arScaleTarget= 0;
    inARSession  = true;
    orbitalGroup.scale.setScalar(0);
    orbitalGroup.position.set(0,0,0);
    reticle.visible      = false;
    boundingCube.visible = false;

    renderer.setClearColor(0x000000, 0);

    try {
      await renderer.xr.setSession(s);
    } catch(e) {
      arStatus('setSession failed: '+(e.message||String(e)), true);
      s.end(); return;
    }

    controls.enabled = false;
    document.body.classList.add('xr-active','ar-mode');
    arBtn.textContent = 'Exit AR';

    // ── Reduce simulation load for AR ──
    // Snapshot desktop settings, then drop count, point size, and B-field detail
    // so the headset holds frame rate. The end handler restores this snapshot.
    arSaved = {
      N: S.N, psize: S.psize,
      showBField: S.showBField, showBTr: S.showBTr,
      bGridDim: S.bGridDim, bUpdateEvery: S.bUpdateEvery, bTrSpawn: S.bTrSpawn,
      bArrowScale: S.bArrowScale, bTrSpeed: S.bTrSpeed, bTrTrail: S.bTrTrail,
    };
    S.N = 25000; startGrow();
    pMat.size = 0.005;
    // AR B-field: coarser grid, lower spawn, faster + longer-trail tracers
    S.bGridDim = 9; S.bUpdateEvery = 90; S.bArrowScale = 0.6;
    S.bTrSpawn = 300;   // lower than desktop 750 — less particle overdraw in AR
    S.bTrSpeed = 2.5;   // faster so flows look dynamic at AR scale
    S.bTrTrail = 80;    // longer trail for visual clarity
    RT.bFieldData = null;  // force fresh recompute with AR grid settings
    setMagField(false);

    // ── System pinch events — drive _sysActive + panel checks ──
    s.addEventListener('selectstart', e => {
      if(!e.inputSource.hand) return;
      const h = e.inputSource.handedness === 'left' ? 'left' : 'right';
      _sysActive[h] = true;
      if(ARP.mesh && ARP.mesh.visible) setPendingPanelCheck(e.inputSource);
    });
    s.addEventListener('selectend', e => {
      if(!e.inputSource.hand) return;
      const h = e.inputSource.handedness === 'left' ? 'left' : 'right';
      _sysActive[h] = false;
    });

    // ── Hit-test (optional) ──
    hasHitTest = false;
    try {
      const viewerSpace = await s.requestReferenceSpace('viewer');
      hitTestSrc = await s.requestHitTestSource({ space: viewerSpace });
      hasHitTest = true;
      document.getElementById('ar-hint').style.display = 'flex';
      arStatus('Point at a surface to place');
    } catch(e) {
      arStatus('Hit-test unavailable — tap to place at fixed depth');
      document.getElementById('ar-hint').style.display = 'flex';
    }

    // ── Placement via select — one-time only, reticle stops after placement ──
    s.addEventListener('select', () => {
      if(arPlaced) return; // one placement only

      let placePos = new THREE.Vector3();

      if(hasHitTest && reticle.visible){
        placePos.setFromMatrixPosition(
          new THREE.Matrix4().fromArray(reticle.matrix.elements));
        placePos.y += AR_HOVER;
      } else {
        const cam = renderer.xr.getCamera();
        const fwd = new THREE.Vector3(0,0,-0.6).applyQuaternion(cam.quaternion);
        placePos.copy(cam.position).add(fwd);
      }

      orbitalGroup.position.copy(placePos);
      orbitalGroup.rotation.set(0,0,0);
      setVrRotY(0);
      arPlaced     = true;
      arSpawnDone  = false;
      arScaleTarget= AR_SCALE;
      boundingCube.visible = true;

      document.getElementById('ar-hint').style.display = 'none';
      // Cancel hit test — reticle gone, no re-placement
      if(hitTestSrc){ hitTestSrc.cancel(); hitTestSrc=null; }
      reticle.visible = false;
      // Show 3D world-space control panel
      initARPanel();
      ARP.mesh.visible = true;
      ARP.dirty = true;
      arStatus('Placed · poke panel to control');
    });

    // ── Cleanup on session end ──
    // Reset every AR-only piece of state, restore the clear color and controls,
    // return the group to the origin at unit scale, and reload saved settings.
    s.addEventListener('end', () => {
      if(ARP.mesh) ARP.mesh.visible = false;
      _handDots.forEach(d=>d.visible=false);
      ARP.bgOpacity=0;
      _sysActive.left=false; _sysActive.right=false; setPendingPanelCheck(null);
      arSession = null; hitTestSrc = null;
      arPlaced = false; arSpawnDone = false; hasHitTest = false;
      inARSession = false; arScaleTarget = 1;
      renderer.setClearColor(0x0e1118, 1);
      controls.enabled = true;
      document.body.classList.remove('xr-active','ar-mode');
      document.getElementById('ar-hint').style.display = 'none';
      document.getElementById('ar-status').style.display = 'none';
      arBtn.textContent = 'Enter AR';
      orbitalGroup.scale.setScalar(1);
      orbitalGroup.position.set(0,0,0);
      orbitalGroup.rotation.set(0,0,0);
      boundingCube.visible = false;
      reticle.visible = false;
      // Restore saved settings
      if(arSaved){
        S.N = arSaved.N; startGrow();
        S.psize = arSaved.psize; pMat.size = S.psize;
        S.bGridDim = arSaved.bGridDim; S.bUpdateEvery = arSaved.bUpdateEvery;
        S.bTrSpawn = arSaved.bTrSpawn; S.bArrowScale = arSaved.bArrowScale;
        S.bTrSpeed = arSaved.bTrSpeed; S.bTrTrail = arSaved.bTrTrail;
        if(arSaved.showBField) setMagField(true);
        arSaved = null;
      }
      bgDimMesh.visible = false; bgDimMat.opacity = 0; ARP.bgOpacity = 0;
    });
  });

  // Called from animation loop — hit test reticle update
  window._arUpdateHitTest = function(frame){
    if(!hitTestSrc || !frame) return;
    const refSpace = renderer.xr.getReferenceSpace(); if(!refSpace) return;
    const results = frame.getHitTestResults(hitTestSrc);
    if(results.length > 0){
      const pose = results[0].getPose(refSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
    } else {
      reticle.visible = false;
    }
  };

  // Spawn animation — lerps scale from 0 to AR_SCALE once, then stops forever.
  // After arSpawnDone=true, hand gestures own orbitalGroup.scale freely.
  window._arUpdateScale = function(dt){
    if(!inARSession || arSpawnDone) return;
    const cur  = orbitalGroup.scale.x;
    const next = cur + (arScaleTarget - cur) * Math.min(1, dt*8);
    orbitalGroup.scale.setScalar(next);
    if(arPlaced && Math.abs(next - arScaleTarget) < 0.0005){
      orbitalGroup.scale.setScalar(arScaleTarget);
      arSpawnDone = true; // hand gestures take over from here
    }
  };
}
