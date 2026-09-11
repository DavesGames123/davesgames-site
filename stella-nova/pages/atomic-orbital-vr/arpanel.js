/* ════════════════════════════════════════════════════════════
   AR PANEL — world-space canvas-texture GUI + hand dots
   A 2D canvas drawn each time it is dirty, uploaded as a texture on
   a small plane docked below the bounding cube. Buttons are UV rects
   with action closures that a fingertip poke hit-tests against. Also
   draws the always-on-top hand-joint dots.
   GREP: ARP | initARPanel | drawARPanel | updateARPanel
         setARBgOpacity | updateHandDots
   ════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { scene, camera, renderer, orbitalGroup, S, RT, bgDimMesh, bgDimMat } from './core.js';
import { _jointWorldPos } from './gestures.js';
import { applyQN, setColorMode, setN, setMagField } from './ui.js';
import { computeBField } from './bfield.js';

/* ════════════════════════════════════════════════════════════
   AR 3D PANEL — world-space canvas texture GUI
   Floats beside the bounding cube; finger-poke interaction.
   GREP: initARPanel | drawARPanel | updateARPanel | checkARPoke
   ════════════════════════════════════════════════════════════ */
// ARP holds the whole world-space control panel: a 2D canvas drawn each time it
// is dirty, uploaded as a texture on a plane, with a list of buttons in UV space
// that fingertip pokes hit-test against.
export const ARP = {
  PW:0.28, PH:0.50,   // metres
  CW:512,  CH:915,    // canvas pixel resolution
  mesh:null, tex:null, ctx:null,
  buttons:[],
  cooldown:0,
  dirty:true,
  bgOpacity:0,         // 0=full passthrough, 1=full black
};

/* Hand joint visualization — always-on-top dots so panel can't occlude hands */
// The subset of WebXR hand joints drawn as dots, one entry per tracked joint.
const _HAND_JOINTS=[
  'wrist',
  'thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip',
  'index-finger-metacarpal','index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate','index-finger-phalanx-distal','index-finger-tip',
  'middle-finger-tip','ring-finger-tip','pinky-finger-tip',
];
const _handDotGeo=new THREE.SphereGeometry(0.007,6,6);
const _handDotMat=new THREE.MeshBasicMaterial({color:0x96c8ff,transparent:true,opacity:0.55,depthTest:false,depthWrite:false});
export const _handDots=[];
for(let i=0;i<28;i++){const m=new THREE.Mesh(_handDotGeo,_handDotMat.clone());m.visible=false;m.renderOrder=9998;scene.add(m);_handDots.push(m);}

// Move the pool of dots onto each tracked joint pose; hide the unused tail.
function updateHandDots(frame,refSpace){
  let di=0;
  const sess=renderer.xr.getSession();
  if(sess&&frame&&refSpace){
    for(const src of sess.inputSources){
      if(!src.hand) continue;
      for(const jn of _HAND_JOINTS){
        const j=src.hand.get(jn); if(!j) continue;
        const p=frame.getJointPose(j,refSpace); if(!p||di>=_handDots.length) continue;
        const pos=p.transform.position;
        _handDots[di].position.set(pos.x,pos.y,pos.z);
        _handDots[di].visible=true; di++;
      }
    }
  }
  for(let i=di;i<_handDots.length;i++) _handDots[i].visible=false;
}

// ── Canvas helpers ──
// Trace a rounded rectangle path for the panel's cards and buttons.
function _rrect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}
// Draw a faint horizontal divider between panel sections.
function _div(ctx,W,y){
  ctx.save();ctx.strokeStyle='rgba(150,200,255,0.1)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(18,y);ctx.lineTo(W-18,y);ctx.stroke();ctx.restore();
}

// Build the panel mesh once: an offscreen canvas becomes a CanvasTexture on a
// small plane. Later draws reuse the same canvas and flag the texture dirty.
export function initARPanel(){
  if(ARP.mesh) return;
  const canvas=document.createElement('canvas');
  canvas.width=ARP.CW; canvas.height=ARP.CH;
  ARP.ctx=canvas.getContext('2d');
  ARP.tex=new THREE.CanvasTexture(canvas);
  ARP.tex.minFilter=THREE.LinearFilter;
  ARP.tex.generateMipmaps=false;
  const mat=new THREE.MeshBasicMaterial({
    map:ARP.tex, transparent:true,
    side:THREE.DoubleSide, depthWrite:false,
  });
  ARP.mesh=new THREE.Mesh(new THREE.PlaneGeometry(ARP.PW,ARP.PH), mat);
  ARP.mesh.renderOrder=999;
  ARP.mesh.visible=false;
  scene.add(ARP.mesh);
}

// Repaint the whole panel and rebuild ARP.buttons. Each control draws itself and
// pushes a UV-space rectangle plus an action closure, so poke detection stays a
// simple point-in-rect test in updateARPanel().
function drawARPanel(){
  const ctx=ARP.ctx;
  const W=ARP.CW, H=ARP.CH;
  ARP.buttons=[];
  ctx.clearRect(0,0,W,H);

  // Background + border
  ctx.fillStyle='rgba(6,9,18,0.95)';
  _rrect(ctx,0,0,W,H,20); ctx.fill();
  ctx.strokeStyle='rgba(150,200,255,0.28)';ctx.lineWidth=2;
  _rrect(ctx,1,1,W-2,H-2,20); ctx.stroke();

  // Top accent gradient
  const gr=ctx.createLinearGradient(0,0,W,0);
  gr.addColorStop(0,'rgba(150,200,255,0)');
  gr.addColorStop(0.5,'rgba(150,200,255,0.55)');
  gr.addColorStop(1,'rgba(150,200,255,0)');
  ctx.fillStyle=gr; ctx.fillRect(0,0,W,3);

  const SUBS=['s','p','d','f','g','h'];
  const{n,l,m}=S; const ms=(m>=0?'+':'')+m;
  let y=18;

  // Title
  ctx.textAlign='center';
  ctx.font='italic 500 26px "Cormorant Garamond",serif';
  ctx.fillStyle='rgba(150,200,255,0.55)';
  ctx.fillText(`${n}${SUBS[l]??'?'} orbital`,W/2,y+26); y+=28;
  ctx.font='500 13px "JetBrains Mono",monospace';
  ctx.fillStyle='rgba(150,200,255,0.28)';
  ctx.fillText(`|${n},${l},${ms}⟩`,W/2,y+16); y+=28;

  _div(ctx,W,y); y+=16;

  // ── QN stepper rows ──
  // Draw one quantum-number row (label, value, minus/plus). Each button records
  // its UV rect and an action that steps n / ℓ / m through applyQN().
  function qnRow(sym,val,qn,minV,maxV){
    const RH=68, BW=68, BH=46;
    const cx=W/2, by=y+(RH-BH)/2;
    // Label
    ctx.font='italic 700 32px "Cormorant Garamond",serif';
    ctx.fillStyle='rgba(150,200,255,0.6)';
    ctx.textAlign='left';
    ctx.fillText(sym,20,y+RH*0.72);
    // Value
    ctx.font='bold 24px "JetBrains Mono",monospace';
    ctx.fillStyle='#e8ecf4';
    ctx.textAlign='center';
    ctx.fillText(String(val),cx,y+RH*0.72);
    // − button
    const bxM=cx-BW*1.55, bxP=cx+BW*0.55;
    [[bxM,'−',false],[bxP,'+',true]].forEach(([bx,lbl,isPlus])=>{
      ctx.fillStyle='rgba(150,200,255,0.07)';
      _rrect(ctx,bx,by,BW,BH,9); ctx.fill();
      ctx.strokeStyle='rgba(150,200,255,0.22)';ctx.lineWidth=1.2;
      _rrect(ctx,bx,by,BW,BH,9); ctx.stroke();
      ctx.font='bold 24px "JetBrains Mono",monospace';
      ctx.fillStyle='rgba(150,200,255,0.75)';
      ctx.textAlign='center';
      ctx.fillText(lbl,bx+BW/2,by+BH*0.75);
      ARP.buttons.push({u0:bx/W,v0:by/H,u1:(bx+BW)/W,v1:(by+BH)/H,
        action:()=>{
          let{n:nn,l:ll,m:mm}=S;
          const d=isPlus?1:-1;
          if(qn==='n')nn+=d; else if(qn==='l')ll+=d; else mm+=d;
          applyQN(nn,ll,mm); S.dirty=true;
        }
      });
    });
    y+=RH;
  }
  qnRow('n',n,'n',1,6);
  qnRow('ℓ',l,'l',0,n-1);
  qnRow('m',m,'m',-l,l);

  _div(ctx,W,y); y+=14;

  // ── B Field toggle ──
  // One wide button. Turning it on clears any cached field and schedules a fresh
  // Biot-Savart solve at the AR grid resolution.
  const bOn=S.showBField;
  ctx.fillStyle=bOn?'rgba(150,200,255,0.11)':'rgba(255,60,60,0.08)';
  _rrect(ctx,16,y,W-32,66,12); ctx.fill();
  ctx.strokeStyle=bOn?'rgba(150,200,255,0.45)':'rgba(255,80,80,0.35)';
  ctx.lineWidth=1.5; _rrect(ctx,16,y,W-32,66,12); ctx.stroke();
  ctx.font='bold 18px "JetBrains Mono",monospace';
  ctx.fillStyle=bOn?'#96c8ff':'#e06060';
  ctx.textAlign='center';
  ctx.fillText(bOn?'⊕  B FIELD  ON':'⊗  B FIELD  OFF',W/2,y+42);
  ARP.buttons.push({u0:16/W,v0:y/H,u1:(W-16)/W,v1:(y+66)/H,
    action:()=>{
      const enabling=!S.showBField;
      setMagField(enabling);
      // Force fresh Biot-Savart with current AR grid settings (bGridDim=9)
      if(enabling){ RT.bFieldData=null; if(!RT.bFieldScheduled){RT.bFieldScheduled=true;setTimeout(computeBField,0);} }
    }});
  y+=80;

  _div(ctx,W,y); y+=14;

  // ── Color mode ──
  // Four visualization modes (|ψ|², Re, Im, phase), highlighting the active one.
  ctx.font='11px "JetBrains Mono",monospace';
  ctx.fillStyle='rgba(150,200,255,0.3)';
  ctx.textAlign='left';
  ctx.fillText('VISUALIZE',18,y+13); y+=20;
  const modes=['|ψ|²','Re','Im','∠'];
  const mw=(W-36)/4-5;
  for(let i=0;i<4;i++){
    const bx=18+i*(mw+5), act=S.colorMode===i;
    ctx.fillStyle=act?'rgba(255,200,50,0.14)':'rgba(255,255,255,0.03)';
    _rrect(ctx,bx,y,mw,50,8); ctx.fill();
    ctx.strokeStyle=act?'rgba(255,200,50,0.5)':'rgba(150,200,255,0.14)';
    ctx.lineWidth=1.2; _rrect(ctx,bx,y,mw,50,8); ctx.stroke();
    ctx.font=(act?'bold ':'')+'15px "JetBrains Mono",monospace';
    ctx.fillStyle=act?'#ffc832':'rgba(150,200,255,0.55)';
    ctx.textAlign='center';
    ctx.fillText(modes[i],bx+mw/2,y+33);
    const ii=i;
    ARP.buttons.push({u0:bx/W,v0:y/H,u1:(bx+mw)/W,v1:(y+50)/H,
      action:()=>setColorMode(ii)});
  }
  y+=64;

  _div(ctx,W,y); y+=14;

  // ── Particle count presets ──
  // Fixed count choices tuned for AR headroom; the match test allows ±500.
  ctx.font='11px "JetBrains Mono",monospace';
  ctx.fillStyle='rgba(150,200,255,0.3)';
  ctx.textAlign='left';
  ctx.fillText('PARTICLES',18,y+13); y+=20;
  const presets=[['5k',5000],['10k',10000],['25k',25000],['50k',50000]];
  const pw=(W-36)/4-5;
  for(let i=0;i<4;i++){
    const bx=18+i*(pw+5), act=Math.abs(S.N-presets[i][1])<500;
    ctx.fillStyle=act?'rgba(150,200,255,0.12)':'rgba(255,255,255,0.03)';
    _rrect(ctx,bx,y,pw,46,8); ctx.fill();
    ctx.strokeStyle=act?'rgba(150,200,255,0.45)':'rgba(150,200,255,0.12)';
    ctx.lineWidth=1.2; _rrect(ctx,bx,y,pw,46,8); ctx.stroke();
    ctx.font=(act?'bold ':'')+'14px "JetBrains Mono",monospace';
    ctx.fillStyle=act?'#96c8ff':'rgba(150,200,255,0.5)';
    ctx.textAlign='center';
    ctx.fillText(presets[i][0],bx+pw/2,y+30);
    const pi=i;
    ARP.buttons.push({u0:bx/W,v0:y/H,u1:(bx+pw)/W,v1:(y+46)/H,
      action:()=>setN(presets[pi][1])});
  }
  y+=60;

  _div(ctx,W,y); y+=14;

  // ── Background opacity ──
  // Dim the AR passthrough behind the cloud: Pass keeps it fully see-through, VR
  // paints it solid black. Level feeds the camera-tracking bgDim plane.
  ctx.font='11px "JetBrains Mono",monospace';
  ctx.fillStyle='rgba(150,200,255,0.3)';
  ctx.textAlign='left';
  ctx.fillText('BACKGROUND',18,y+13); y+=20;
  const bgLevels=[[0,'Pass'],[0.25,'25%'],[0.5,'50%'],[0.75,'75%'],[1,'VR']];
  const bw=(W-36)/5-4;
  for(let i=0;i<5;i++){
    const bx=18+i*(bw+4);
    const act=Math.abs(ARP.bgOpacity-bgLevels[i][0])<0.05;
    ctx.fillStyle=act?(i===4?'rgba(255,200,50,0.18)':'rgba(150,200,255,0.12)'):'rgba(255,255,255,0.03)';
    _rrect(ctx,bx,y,bw,46,7); ctx.fill();
    ctx.strokeStyle=act?(i===4?'rgba(255,200,50,0.5)':'rgba(150,200,255,0.45)'):'rgba(150,200,255,0.12)';
    ctx.lineWidth=1.2; _rrect(ctx,bx,y,bw,46,7); ctx.stroke();
    ctx.font=(act?'bold ':'')+'13px "JetBrains Mono",monospace';
    ctx.fillStyle=act?(i===4?'#ffc832':'#96c8ff'):'rgba(150,200,255,0.5)';
    ctx.textAlign='center';
    ctx.fillText(bgLevels[i][1],bx+bw/2,y+30);
    const level=bgLevels[i][0];
    ARP.buttons.push({u0:bx/W,v0:y/H,u1:(bx+bw)/W,v1:(y+46)/H,
      action:()=>setARBgOpacity(level)});
  }
  y+=58;

  ARP.tex.needsUpdate=true;
}

// Set passthrough dimming: drive the bgDim plane's opacity and show it only when
// some dimming is asked for.
export function setARBgOpacity(v){
  ARP.bgOpacity=v;
  bgDimMat.opacity = v;
  bgDimMesh.visible = v > 0.01;
  ARP.dirty=true;
}

// Per-frame panel work: keep the hand dots current, dock the panel under the
// bounding cube facing the camera, repaint if dirty, then test the index-finger
// tip against every button. A short cooldown prevents a single poke re-firing.
export function updateARPanel(frame){
  const refSpace=renderer.xr.getReferenceSpace();
  // Hand dots always update in AR (depthTest:false keeps them on top of everything)
  if(frame&&refSpace) updateHandDots(frame,refSpace);

  if(!ARP.mesh||!ARP.mesh.visible) return;

  // Dock panel directly below the bounding cube, face camera
  const wp=new THREE.Vector3();
  orbitalGroup.getWorldPosition(wp);
  const sz=Math.max(orbitalGroup.scale.x,0.04);
  const cubeHalf=3*sz; // half-extent of 6-unit local cube in world space
  // Hang below cube bottom edge, at front face Z — panel top aligns with cube bottom
  ARP.mesh.position.set(wp.x, wp.y - cubeHalf - ARP.PH*0.5 - 0.01, wp.z + cubeHalf);
  ARP.mesh.lookAt(camera.position);

  if(ARP.dirty){ARP.dirty=false;drawARPanel();}

  if(ARP.cooldown>0){ARP.cooldown--;return;}
  if(!frame||!refSpace) return;
  // Continuous finger-poke detection — user physically touches panel surface
  const sess=renderer.xr.getSession(); if(!sess) return;
  for(const src of sess.inputSources){
    if(!src.hand) continue;
    const tip=_jointWorldPos(src.hand,'index-finger-tip',frame,refSpace); if(!tip) continue;
    const local=ARP.mesh.worldToLocal(tip.clone());
    if(Math.abs(local.z)>0.035) continue; // must be within 3.5cm of panel surface
    const u=(local.x+ARP.PW/2)/ARP.PW;
    const v=1-(local.y+ARP.PH/2)/ARP.PH;
    if(u<0||u>1||v<0||v>1) continue;
    for(const btn of ARP.buttons){
      if(u>=btn.u0&&u<=btn.u1&&v>=btn.v0&&v<=btn.v1){
        btn.action(); ARP.dirty=true; ARP.cooldown=22; return;
      }
    }
  }
}
