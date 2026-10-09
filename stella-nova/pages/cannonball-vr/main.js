// ============================================================================
//  CANNONBALL VR  ·  pages/cannonball-vr/main.js — entry
// ----------------------------------------------------------------------------
//  The credit record for the TMP credit bar, then the cannonball app of
//  ../cannonball-3d/app.js in VR mode: renderer.xr on, the three.js
//  VRButton (vrbutton.js), and the renderer animation loop, so the scene
//  runs in a headset. The upstream MIT notice and the physics are in
//  ../cannonball-3d/sim.js (the same ball step as 02-cannonballVR.html).
// ============================================================================
import { start } from '../cannonball-3d/app.js';
import { VRButton } from './vrbutton.js';

TMP.page({ n: '02', title: 'Cannonball VR', file: '02-cannonballVR.html', video: 'j84zJ06wnVA', year: 2021, licence: 'MIT' });
start({ vr: true, VRButton, title: 'Cannonball VR', sub: 'The cannonball box for a VR headset: press Enter VR' });
