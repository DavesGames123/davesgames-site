/* ════════════════════════════════════════════════════════════
   GESTURES — WebXR hand tracking + pinch, thumbstick fallback
   One-hand pinch grabs and translates the orbital group; two-hand
   pinch scales it; the controller thumbstick rotates it. Pinch is
   driven by the XR selectstart/selectend events, which set _sysActive
   (mutated from the AR session). vrRotY and _pendingPanelCheck are
   reassignable, so setters are exported (option a).
   GREP: _sysActive | getPinchPos | _jointWorldPos
         updateHandTracking | handleVRInput | setVrRotY
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { scene, renderer, orbitalGroup } from './core.js';

/* ════════════════════════════════════════════════════════════
   HAND GESTURE SYSTEM
   One-hand pinch  → grab & translate orbitalGroup
   Two-hand pinch  → scale (and translate midpoint)
   Thumbstick X    → rotate (controller fallback)

   Uses WebXR Hand Tracking API joint poses.
   Pinch = thumb-tip ↔ index-finger-tip distance < PINCH_THRESH metres.
   ════════════════════════════════════════════════════════════ */
// System pinch state — driven by XR selectstart/selectend, not manual distance.
export const _sysActive = { left: false, right: false };
let _pendingPanelCheck = null; // inputSource set by selectstart, consumed next frame for panel
// Setter for the AR session, which writes _pendingPanelCheck across the module edge.
export function setPendingPanelCheck(v){ _pendingPanelCheck = v; }

// Pinch indicator dots (kept for visual feedback)
const _pinchGeo = new THREE.SphereGeometry(0.012, 8, 8);
const pinchMeshL = new THREE.Mesh(_pinchGeo,
  new THREE.MeshBasicMaterial({color:0x96c8ff,transparent:true,opacity:0.85,depthWrite:false}));
const pinchMeshR = new THREE.Mesh(_pinchGeo,
  new THREE.MeshBasicMaterial({color:0x96c8ff,transparent:true,opacity:0.85,depthWrite:false}));
pinchMeshL.visible=false; pinchMeshR.visible=false;
scene.add(pinchMeshL); scene.add(pinchMeshR);

// Gesture state — the anchor poses and starting transforms captured at the moment
// a grab or scale begins, so each frame applies a delta rather than an absolute.
const HS = {
  grabbing:false, grabStartWorld:new THREE.Vector3(), grabStartGroupPos:new THREE.Vector3(),
  scaling:false,  scaleStartDist:1,
  scaleStartGroupScale:new THREE.Vector3(1,1,1),
  scaleStartMid:new THREE.Vector3(), scaleStartGroupPos:new THREE.Vector3(),
};

// World position of one named hand joint, or null if it is not being tracked.
export function _jointWorldPos(hand, jointName, frame, refSpace){
  if(!hand) return null;
  const joint = hand.get(jointName); if(!joint) return null;
  const pose  = frame.getJointPose(joint, refSpace); if(!pose) return null;
  const p = pose.transform.position;
  return new THREE.Vector3(p.x, p.y, p.z);
}

// Pinch anchor for a hand: the index-finger tip, but only while the XR system
// reports that hand as actively pinching (selectstart/selectend drive _sysActive).
function getPinchPos(inputSource, frame, refSpace){
  if(!inputSource.hand) return null;
  const hand = inputSource.handedness === 'left' ? 'left' : 'right';
  if(!_sysActive[hand]) return null; // XR system says not pinching
  return _jointWorldPos(inputSource.hand, 'index-finger-tip', frame, refSpace);
}

// Read both pinch anchors this frame and act: two anchors scale (and translate by
// the midpoint), one anchor grabs and translates, none releases. Group transform
// deltas are computed against the pose captured when the gesture began.
function updateHandTracking(frame){
  const sess = renderer.xr.getSession(); if(!sess) return;
  const refSpace = renderer.xr.getReferenceSpace(); if(!refSpace) return;

  let lPos=null, rPos=null;
  for(const src of sess.inputSources){
    if(!src.hand) continue;
    const p = getPinchPos(src, frame, refSpace);
    if(src.handedness==='left')  lPos=p;
    else                         rPos=p;
  }

  // Update pinch indicators
  pinchMeshL.visible=!!lPos; if(lPos) pinchMeshL.position.copy(lPos);
  pinchMeshR.visible=!!rPos; if(rPos) pinchMeshR.position.copy(rPos);

  if(lPos && rPos){
    // ── TWO-HAND PINCH: scale + translate ──
    const mid  = lPos.clone().lerp(rPos, 0.5);
    const dist = lPos.distanceTo(rPos);

    if(!HS.scaling){
      HS.scaling=true; HS.grabbing=false;
      HS.scaleStartDist=Math.max(dist,0.01);
      HS.scaleStartGroupScale.copy(orbitalGroup.scale);
      HS.scaleStartMid.copy(mid);
      HS.scaleStartGroupPos.copy(orbitalGroup.position);
    }

    const sf = dist / HS.scaleStartDist;
    orbitalGroup.scale.copy(HS.scaleStartGroupScale).multiplyScalar(sf);
    // Translate with midpoint so scaling feels anchored between hands
    const delta = mid.clone().sub(HS.scaleStartMid);
    orbitalGroup.position.copy(HS.scaleStartGroupPos).add(delta);

  } else if(lPos || rPos){
    // ── ONE-HAND PINCH: grab and translate ──
    const pinch = lPos || rPos;
    HS.scaling=false;

    if(!HS.grabbing){
      HS.grabbing=true;
      HS.grabStartWorld.copy(pinch);
      HS.grabStartGroupPos.copy(orbitalGroup.position);
    }

    orbitalGroup.position.copy(HS.grabStartGroupPos)
      .add(pinch.clone().sub(HS.grabStartWorld));

  } else {
    // ── No pinch — release ──
    HS.grabbing=false;
    HS.scaling=false;
  }
}

// Accumulated controller-driven yaw of the orbital group.
let vrRotY=0;
// Setter for the AR session, which resets yaw to 0 on placement.
export function setVrRotY(v){ vrRotY = v; }

// Per-frame XR input: run hand gestures, and as a controller fallback map the
// thumbstick X axis to yaw. The deadzone ignores small stick drift.
export function handleVRInput(frame){
  const sess=renderer.xr.getSession(); if(!sess) return;

  // Hand tracking gestures (runs when hand-tracking feature is available)
  if(frame) updateHandTracking(frame);

  // Controller thumbstick → rotate orbitalGroup (fallback when using controllers)
  for(const src of sess.inputSources){
    if(!src.gamepad||src.hand) continue; // skip hand sources
    const ax=src.gamepad.axes;
    const stX=ax[2]??ax[0]??0;
    if(Math.abs(stX)>.12){
      vrRotY-=stX*.018;
      orbitalGroup.rotation.y=vrRotY;
    }
  }
}
