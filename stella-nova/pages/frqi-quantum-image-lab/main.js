// ============================================================================
//  FRQI QUANTUM IMAGE LAB  ·  encode an image into a quantum state, then read it
// ----------------------------------------------------------------------------
//  FRQI (Flexible Representation of Quantum Images) writes each pixel intensity
//  into a rotation angle θ carried by one color qubit, entangled with nPos
//  position qubits that address the pixel. The full encoded state is
//      |φ⟩ = (1/√N) Σᵢ (cos θᵢ|0⟩ + sin θᵢ|1⟩) ⊗ |i⟩ ,  θᵢ = (pixelᵢ/255)·π/2.
//  simulate() runs the circuit (H on each position qubit, then one controlled-RY
//  per lit pixel), snapshotting the state vector at every step. appendLayer()
//  turns each snapshot into a density-matrix slab (diagonal populations |cᵣ|² and
//  off-diagonal coherences |cᵣ||c_c|) drawn as an instanced 3D tower. Sampling
//  the final state gives per-pixel P(|1⟩), decoded back to intensity.
//
//  RENDER / DATA FLOW
//  ----------------------------------------------------------------------------
//      paint / preset ─▶ img[]  (grayscale grid)
//              │  rebuildAmpFromImg → a0/a1 amplitudes
//              ▼
//      simulate() ─▶ per-step state vectors ─▶ appendLayer → ρ cell stack (GL)
//              │                                      ▲ score strip + circuit
//              │                                      │ share the playhead
//              ▼
//      runSampling() ─▶ shots ─▶ P(|1⟩) ─▶ reconstruct ─▶ register tape
//              │  flight: each pixel cell moves tape → (row, col)
//              ▼
//      Reconstruction grid beside the Target grid, + |error| and MAE
//
//  RUN TIMING  (frqi-core.js, pure; node tests.mjs checks it)
//      sample for the Time slider (default 1.2 s), then fly for 1.3 s: an
//      image is finished 2.5 s after Sample. The saver uses saverPlan().
//
//  ρ STACK CELL  (one slab per circuit step, y = layer)
//  ----------------------------------------------------------------------------
//        z (row r)                     diagonal   : |ρ_rr| = |c_r|²   (populations)
//          ▲    ● off-diagonal         off-diag   : |ρ_rc| = |c_r||c_c| (coherence)
//          │  ● ●                       colour     : cellColor(mag, re, im)
//          │● ● ●  ← diagonal          budget cap : curBudget() bounds cell count
//          └──────────▶ x (col c)      so the tower stays ~bounded at high DIM
//
//  KEY INDEXING
//      DIM = 2·N is the state size: the color qubit is the low bit, so basis i
//      is the |0⟩ branch of pixel i and n+i is the |1⟩ branch.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      colour language ...... "QAV COLOUR LANGUAGE"  colormaps + cell colour
//      state model .......... "STATE MODEL"          img, amplitudes, presets
//      transforms ........... "function applyXform"  quantum gates on the state
//      paint field .......... "PAINT FIELD"          source + amplitude tiles
//      GL init .............. "function initGL"      Three.js stack + bloom
//      circuit sim .......... "function simulate"    state-vector simulation
//      density slabs ........ "function appendLayer" ρ cells per layer
//      build stack .......... "function buildStack"  full tower rebuild
//      init picker .......... "function ensurePicker" pick the start state
//      score strip .......... "function drawScore"   playhead notation
//      sampling ............. "function runSampling" timed shots (shotsAt)
//      run phase ............ "function reconPhase"  none / sample / flight / done
//      circuit view ......... "function drawCircuit" gate diagram + scrub
//      RY editor ............ "function openRyEd"     retune a pixel
//      reconstruction ....... "function drawRecon"   sizes #recon-cv, calls paintRecon
//      recon painter ........ "function paintRecon"  target grid, recon, tape, flight
//      orchestration ........ "function renderAll"   repaint everything
//      controls ............. "function setPos"      register + control bindings
//      phone dock ........... "PHONE DOCK"           sheet toggle, play, sample
//      init ................. "buildCmapButtons"     first paint
//      screensaver .......... "window.snSaver"       autopilot for lib/screensaver.js
//      saver plate .......... "function saverPlate"  opts.label: |I⟩, qubits, step, MAE
//      saver image panel .... "function hudRender"   paintRecon on a plane over the GL
//      saver layout ......... "function saverLayout" stack and image panel in the band
// ============================================================================
import * as THREE from 'three';
import { EQ_STATE } from './equation.js';
import { buildCdf, sampleCdf, shotsAt, reconstruct, tapeCols, flightU, flightPos, PAGE_FLIGHT_MS, saverPlan, glPixelRatio, reconTypeScale } from './frqi-core.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
// The phone query matches the phone block of style.css. COARSE: a touch screen.
const PHONE_Q=matchMedia('(max-width:820px),(max-height:500px) and (pointer:coarse)');
const COARSE=matchMedia('(pointer:coarse)').matches;

/* ===== QAV COLOUR LANGUAGE ===== */
// Shared palette and colour maps (ported from the Quantum Algorithm Visualizer).
// heatColor maps a magnitude to a ramp; amplitudeColorArr maps a phase; the
// Hermite curve LUT shapes magnitude so diffuse states stay dim and peaks glow.
const C_AMBER=[255,185,72],C_NAVY=[36,52,78],C_CYAN=[69,211,255];
const CMAPS={
  inferno:[[26,12,54],[58,18,99],[101,26,123],[151,41,107],[201,62,74],[233,109,38],[248,168,40],[251,221,96],[255,250,214]],
  ice:[[6,11,32],[10,32,74],[16,62,124],[26,104,176],[42,152,212],[96,198,236],[166,228,246],[232,249,255]],
  viridis:[[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[110,206,88],[181,222,43],[253,231,37]],
  turbo:[[48,18,59],[62,84,205],[40,160,232],[42,215,167],[120,245,80],[211,228,46],[252,160,46],[227,79,17],[122,4,3]],
  plasma:[[24,12,110],[84,2,163],[139,10,165],[185,50,137],[219,92,104],[244,136,73],[254,188,43],[240,249,33]],
  mono:[[24,26,34],[62,67,80],[110,117,134],[158,166,186],[206,214,232],[245,249,255]],
};
// Active heat map, ρ colour mode (mag/phase/real), and the spin-label toggle.
let ACTIVE_HEAT=CMAPS.inferno,colorMode='mag',spinLabels=false;
const clamp01=x=>x<0?0:x>1?1:x;
// Linear interpolation between two RGB triples.
const lerp3=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
// Sample the active heat map at v in [0,1].
function heatColor(v){v=clamp01(v);const H=ACTIVE_HEAT,s=v*(H.length-1),i=Math.min(Math.floor(s),H.length-2),t=s-i;return lerp3(H[i],H[i+1],t);}
// Map a phase angle (−π..π) to the cyan→violet→amber ramp.
function amplitudeColorArr(ph){let n=(ph+Math.PI)/(2*Math.PI);n=clamp01(n);const c0=[75,215,255],c1=[130,115,255],c2=[255,177,92];return n<0.5?lerp3(c0,c1,n*2):lerp3(c1,c2,(n-0.5)*2);}
// Map a signed real part (−1..1) to the amber→navy→cyan diverging ramp.
function densityColorReal(re){const t=(Math.max(-1,Math.min(1,re))+1)*0.5;return t<0.5?lerp3(C_AMBER,C_NAVY,t*2):lerp3(C_NAVY,C_CYAN,(t-0.5)*2);}
// A monotone Hermite tone curve, precomputed into a 256-entry lookup table so
// magnitude can be shaped identically to the QAV without per-sample spline math.
const CURVE={pts:[{x:0,y:0},{x:0.5,y:Math.pow(0.5,0.2)},{x:1,y:1}],lut:new Float32Array(256)};
function buildCurve(){const P=CURVE.pts.slice().sort((a,b)=>a.x-b.x),n=P.length,xs=P.map(p=>p.x),ys=P.map(p=>p.y),dx=[],m=[];
  for(let i=0;i<n-1;i++){dx[i]=Math.max(1e-6,xs[i+1]-xs[i]);m[i]=(ys[i+1]-ys[i])/dx[i];}
  const t=new Array(n);t[0]=m[0];t[n-1]=m[n-2];for(let i=1;i<n-1;i++)t[i]=(m[i-1]*m[i]<=0)?0:(m[i-1]+m[i])/2;
  for(let k=0;k<256;k++){const x=k/255;let i=0;while(i<n-2&&x>xs[i+1])i++;const h=dx[i],s=(x-xs[i])/h,h00=(1+2*s)*(1-s)*(1-s),h10=s*(1-s)*(1-s),h01=s*s*(3-2*s),h11=s*s*(s-1);
    CURVE.lut[k]=Math.min(1,Math.max(0,h00*ys[i]+h10*h*t[i]+h01*ys[i+1]+h11*h*t[i+1]));}}
buildCurve();
const curveEval=v=>{v=clamp01(v);return CURVE.lut[Math.min(255,(v*255)|0)];};   // QAV-exact Hermite LUT
const EXPO=()=>1;                 // gain 0 (unity): raw absolute |ρ|, exactly like QAV — no amplitude lift
// Pick a cell colour from magnitude and (re, im), following the active ρ mode:
// real part, phase, or the plain magnitude heat ramp. The curve weight w dims
// low-magnitude cells uniformly.
function cellColor(mag,re,im){const w=curveEval(clamp01(mag));
  if(colorMode==='real'){const c=densityColorReal(re);return [c[0]*w,c[1]*w,c[2]*w];}
  if(colorMode==='phase'){const c=amplitudeColorArr(Math.atan2(im,re));return [c[0]*w,c[1]*w,c[2]*w];}
  return heatColor(0.01+0.99*w);}     // QAV-exact: full ramp, shaped by the curve
// Brighten a cell by its magnitude so peaks bloom under the bloom pass.
const glowGain=mag=>1+1.9*clamp01(mag);   // QAV-exact linear glow
// Cool→warm ramp used for the spin-percentage labels.
function warmRamp(t){t=clamp01(t);const cool=[96,168,235],mid=[255,200,90],hot=[233,86,55];return t<0.5?lerp3(cool,mid,t*2):lerp3(mid,hot,(t-0.5)*2);}
// Format an RGB triple as a CSS colour string.
const rgb=a=>`rgb(${a[0]|0},${a[1]|0},${a[2]|0})`;

/* ===== STATE MODEL (square only) ===== */
// The image is always square. nPos = position qubits (even, 2..10); side/rows/
// cols = 2^(nPos/2); img holds grayscale intensities; a0/a1 are the |0⟩ and |1⟩
// amplitude components per pixel; measured caches a sampled reconstruction.
const HALF_PI=Math.PI/2,POS_MIN=2,POS_MAX=10;
let nPos=4,side=4,rows=4,cols=4,img=null,a0re,a0im,a1re,a1im,decodeMode='frqi',measured=null,threshold=0,showShotLabels=true;
// Pixel count.
const N=()=>rows*cols;
// FRQI angle: intensity 0..255 maps to θ in [0, π/2].
const theta=v=>(v/255)*HALF_PI;
// The P(|1⟩) → intensity decode (arcsin√P or linear) is decodeP1 in
// frqi-core.js; reconFromSampling calls it through reconstruct().
// Rebuild the amplitude arrays from img: a0=cosθ (|0⟩), a1=sinθ (|1⟩), phase 0.
function rebuildAmpFromImg(){const n=N();a0re=new Float64Array(n);a0im=new Float64Array(n);a1re=new Float64Array(n);a1im=new Float64Array(n);for(let i=0;i<n;i++){const th=theta(img[i]);a0re[i]=Math.cos(th);a1re[i]=Math.sin(th);}}
// P(|1⟩) for a pixel: the |1⟩ probability normalised over both branches.
const p1Of=i=>{const m0=a0re[i]*a0re[i]+a0im[i]*a0im[i],m1=a1re[i]*a1re[i]+a1im[i]*a1im[i],s=m0+m1;return s>0?m1/s:0;};

// Generate a named test image on the current grid (cross, checker, gradient,
// rings, phantom, or blank).
function makePreset(name){
  const R=rows,C=cols,a=new Float32Array(R*C),set=(r,c,v)=>{if(r>=0&&r<R&&c>=0&&c<C)a[r*C+c]=v;};
  if(name==='blank'){}
  else if(name==='cross'){const tol=0.5/Math.max(R,C);for(let r=0;r<R;r++)for(let c=0;c<C;c++){const yr=R>1?r/(R-1):0.5,xc=C>1?c/(C-1):0.5;a[r*C+c]=(Math.abs(yr-xc)<=tol||Math.abs(yr-(1-xc))<=tol)?255:0;}}
  else if(name==='checker'){for(let r=0;r<R;r++)for(let c=0;c<C;c++)a[r*C+c]=((r+c)&1)?235:25;}
  else if(name==='gradient'){for(let r=0;r<R;r++)for(let c=0;c<C;c++)a[r*C+c]=Math.round((r/(R-1||1)*0.5+c/(C-1||1)*0.5)*255);}
  else if(name==='rings'){const cx=(C-1)/2,cy=(R-1)/2,mx=Math.max(R,C)*0.5;for(let r=0;r<R;r++)for(let c=0;c<C;c++){const d=Math.hypot(c-cx,r-cy)/mx;a[r*C+c]=Math.round((0.5+0.5*Math.cos(d*Math.PI*4))*255);}}
  else if(name==='phantom'){const cx=(C-1)/2,cy=(R-1)/2,RD=Math.max(R,C)*0.46;
    for(let r=0;r<R;r++)for(let c=0;c<C;c++){const d=Math.hypot(c-cx,r-cy);a[r*C+c]=Math.max(0,Math.round(d<RD?80+60*Math.cos(d/RD*Math.PI*0.8):8));}
    const br=Math.round(R*0.30),bc=Math.round(C*0.66),sp=Math.max(0,Math.round(R/16));
    for(let dr=0;dr<=sp;dr++)for(let dc=0;dc<=sp;dc++)set(br+dr,bc+dc,255);}
  return a;
}
// Apply a quantum gate to the encoded state. negative = X on the color qubit
// (swap |0⟩/|1⟩, invert intensity); phaseZ = Z (flip |1⟩ sign); phaseS = S
// (quarter phase on |1⟩); flalth = X on the low x-bit (mirror columns).
function applyXform(kind){const n=N();
  if(kind==='negative'){[a0re,a1re]=[a1re,a0re];[a0im,a1im]=[a1im,a0im];for(let i=0;i<n;i++)img[i]=255-img[i];}
  else if(kind==='phaseZ'){for(let i=0;i<n;i++){a1re[i]*=-1;a1im[i]*=-1;}}
  else if(kind==='phaseS'){for(let i=0;i<n;i++){const r=a1re[i],m=a1im[i];a1re[i]=-m;a1im[i]=r;}}
  else if(kind==='flalth'){permute(i=>{const r=Math.floor(i/cols),c=i%cols;return r*cols+(cols-1-c);});}
  measured=null;markCustom();renderAll();
}
// Reorder all amplitude and image arrays by a pixel-index permutation fn.
function permute(fn){const n=N(),b0r=new Float64Array(n),b0i=new Float64Array(n),b1r=new Float64Array(n),b1i=new Float64Array(n),bi=new Float32Array(n);
  for(let i=0;i<n;i++){const j=fn(i);b0r[j]=a0re[i];b0i[j]=a0im[i];b1r[j]=a1re[i];b1i[j]=a1im[i];bi[j]=img[i];}
  a0re=b0r;a0im=b0i;a1re=b1r;a1im=b1i;img=bi;}
// Largest amplitude magnitude across both branches, used to normalise the tiles.
const maxMag=()=>{let m=1e-9;const n=N();for(let i=0;i<n;i++)m=Math.max(m,Math.hypot(a0re[i],a0im[i]),Math.hypot(a1re[i],a1im[i]));return m;};

/* ===== PAINT FIELD (SOURCE | |0⟩ / |1⟩) ===== */
// The three grids in module 1: the paintable source, and the |0⟩ (cosθ) and
// |1⟩ (sinθ) amplitude tiles derived from it.
const srcCv=document.getElementById('src-cv'),sctx=srcCv.getContext('2d');
const amp0Cv=document.getElementById('amp0-cv'),a0ctx=amp0Cv.getContext('2d');
const amp1Cv=document.getElementById('amp1-cv'),a1ctx=amp1Cv.getContext('2d');
let srcGeom=null,ink=255,brushSz=1;
// Size a canvas to its wrapper at device pixel ratio and return the cell layout
// (cell size, grid pixel size, top-left origin) for drawing the square grid.
function fitGrid(cv,wrap){const W=wrap.clientWidth,H=wrap.clientHeight,dpr=Math.min(2,devicePixelRatio||1);if(W<2||H<2)return null;
  cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const pad=10,cell=Math.max(2,Math.floor(Math.min((W-pad*2)/cols,(H-pad*2-14)/rows))),pw=cell*cols,ph=cell*rows,x0=(W-pw)/2,y0=(H-ph)/2+6;return {W,H,cell,pw,ph,x0,y0};}
// Repaint all three field grids: the source intensities, then the two amplitude
// tiles coloured by cellColor, plus optional spin-percentage labels.
function drawField(){
  const sg=fitGrid(srcCv,srcCv.parentElement);
  if(sg){srcGeom=sg;const gl=sg.cell>5?1:0;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const v=Math.round(img[r*cols+c]);sctx.fillStyle=`rgb(${v},${v},${v})`;sctx.fillRect(sg.x0+c*sg.cell,sg.y0+r*sg.cell,sg.cell-gl,sg.cell-gl);}
    sctx.strokeStyle='rgba(150,200,255,0.14)';sctx.lineWidth=1;sctx.strokeRect(sg.x0,sg.y0,sg.pw,sg.ph);
    if(spinLabels&&sg.cell>=15){sctx.textAlign='center';sctx.textBaseline='middle';const fs=Math.max(8,Math.floor(sg.cell*0.4));sctx.font=`600 ${fs}px ui-monospace, Menlo, monospace`;
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const i=r*cols+c,p=p1Of(i),tx=sg.x0+c*sg.cell+sg.cell/2,ty=sg.y0+r*sg.cell+sg.cell/2;
        sctx.lineWidth=Math.max(2.2,sg.cell*0.12);sctx.strokeStyle='rgba(0,0,0,0.8)';sctx.strokeText(Math.round(p*100),tx,ty);sctx.fillStyle=rgb(warmRamp(p));sctx.fillText(Math.round(p*100),tx,ty);}
      sctx.textBaseline='alphabetic';}}
  // Draw the |0⟩ and |1⟩ amplitude tiles, each normalised by the peak magnitude.
  const mm=maxMag();
  [[amp0Cv,a0ctx,'a0'],[amp1Cv,a1ctx,'a1']].forEach(([cv,ctx,which])=>{
    const g=fitGrid(cv,cv.parentElement);if(!g)return;const gl=g.cell>5?1:0;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const i=r*cols+c,re=(which==='a0'?a0re[i]:a1re[i]),im=(which==='a0'?a0im[i]:a1im[i]),w=Math.hypot(re,im)/mm;ctx.fillStyle=rgb(cellColor(w,re/mm,im/mm));ctx.fillRect(g.x0+c*g.cell,g.y0+r*g.cell,g.cell-gl,g.cell-gl);}
    ctx.strokeStyle='rgba(150,200,255,0.12)';ctx.lineWidth=1;ctx.strokeRect(g.x0,g.y0,g.pw,g.ph);});
  document.getElementById('field-cap').innerHTML=`<b>RY(2θ)</b> · ${rows}×${cols}`;
  drawFieldLegend();
}
// Draw the colour-key strip under the tiles, matching the active ρ colour mode.
function drawFieldLegend(){const lg=document.getElementById('field-legend');
  if(colorMode==='mag'){const g=ACTIVE_HEAT.map((c,i)=>`${rgb(c)} ${i/(ACTIVE_HEAT.length-1)*100}%`).join(',');lg.innerHTML=`|amp|<div class="lg-bar" style="background:linear-gradient(to right,${g})"></div><div class="lg-ends"><span>0</span><span>max</span></div>`;}
  else if(colorMode==='phase'){const s=[];for(let k=0;k<=8;k++)s.push(`${rgb(amplitudeColorArr(-Math.PI+2*Math.PI*k/8))} ${k/8*100}%`);lg.innerHTML=`arg<div class="lg-bar" style="background:linear-gradient(to right,${s.join(',')})"></div><div class="lg-ends"><span>−π</span><span>+π</span></div>`;}
  else{const s=[];for(let k=0;k<=8;k++)s.push(`${rgb(densityColorReal(-1+2*k/8))} ${k/8*100}%`);lg.innerHTML=`Re<div class="lg-bar" style="background:linear-gradient(to right,${s.join(',')})"></div><div class="lg-ends"><span>−</span><span>+</span></div>`;}
}
// Map a pointer position on the source canvas to a pixel index (or −1 outside).
const srcCellAt=(px,py)=>{if(!srcGeom)return -1;const{x0,y0,cell}=srcGeom;const c=Math.floor((px-x0)/cell),r=Math.floor((py-y0)/cell);return(r<0||c<0||r>=rows||c>=cols)?-1:r*cols+c;};
let painting=false,dirty=false;
// Paint the brush footprint at the pointer: set img and amplitudes, mark dirty.
function paintAt(e){const rct=srcCv.getBoundingClientRect();const i=srcCellAt(e.clientX-rct.left,e.clientY-rct.top);if(i<0)return;
  const r0=Math.floor(i/cols),c0=i%cols,h=Math.floor((brushSz-1)/2);
  for(let dr=-h;dr<=brushSz-1-h;dr++)for(let dc=-h;dc<=brushSz-1-h;dc++){const r=r0+dr,c=c0+dc;if(r<0||c<0||r>=rows||c>=cols)continue;const idx=r*cols+c;img[idx]=ink;const th=theta(ink);a0re[idx]=Math.cos(th);a0im[idx]=0;a1re[idx]=Math.sin(th);a1im[idx]=0;}
  measured=null;drawField();updateReadout();markCustom();dirty=true;}
// Paint on drag; on release, rebuild the expensive stack/circuit/recon once.
srcCv.addEventListener('pointerdown',e=>{painting=true;paintAt(e);});
const endPaint=()=>{painting=false;if(dirty){dirty=false;buildStack();drawCircuit();drawRecon();}};
addEventListener('pointerup',endPaint);addEventListener('pointercancel',endPaint);
// Hover (when not painting) shows the per-pixel tooltip.
srcCv.addEventListener('pointermove',e=>{
  if(painting){paintAt(e);return;}
  const rct=srcCv.getBoundingClientRect();const i=srcCellAt(e.clientX-rct.left,e.clientY-rct.top);const tip=document.getElementById('cell-tip');
  if(i<0){tip.style.display='none';return;}
  const r=Math.floor(i/cols),c=i%cols,th=theta(img[i]),addr=i.toString(2).padStart(nPos,'0');
  tip.innerHTML=`<div class="ct-h">PIXEL (y${r}, x${c})</div><div class="ct-r">|i⟩ <b>${addr}</b></div><div class="ct-r">intensity <b>${Math.round(img[i])}</b></div><div class="ct-r">θ <b>${(th/Math.PI).toFixed(3)}π</b></div><div class="ct-r">spin P(|1⟩) <b>${Math.round(p1Of(i)*100)}%</b></div>`;
  tip.style.display='block';tip.style.left=Math.min(e.clientX+16,innerWidth-170)+'px';tip.style.top=(e.clientY+10)+'px';
});
srcCv.addEventListener('pointerleave',()=>document.getElementById('cell-tip').style.display='none');
// Brush toolbar: ink swatches, brush size, fill, clear, and photo upload.
document.querySelectorAll('.sw').forEach(s=>s.addEventListener('click',()=>{ink=+s.dataset.ink;document.querySelectorAll('.sw').forEach(x=>x.classList.remove('active'));s.classList.add('active');}));
document.getElementById('brush-up').addEventListener('click',()=>{brushSz=Math.min(8,brushSz+1);document.getElementById('brush-sz').textContent=brushSz;});
document.getElementById('brush-dn').addEventListener('click',()=>{brushSz=Math.max(1,brushSz-1);document.getElementById('brush-sz').textContent=brushSz;});
document.getElementById('paint-fill').addEventListener('click',()=>{for(let i=0;i<N();i++)img[i]=ink;rebuildAmpFromImg();measured=null;markCustom();renderAll();});
document.getElementById('paint-clear').addEventListener('click',()=>{for(let i=0;i<N();i++)img[i]=0;rebuildAmpFromImg();measured=null;markCustom();renderAll();});
document.getElementById('paint-upload').addEventListener('click',()=>document.getElementById('file-in').click());
// Upload a photo: draw it down to the grid size, convert to luma, encode.
document.getElementById('file-in').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const im=new Image();im.onload=()=>{
  const oc=document.createElement('canvas');oc.width=cols;oc.height=rows;const ox=oc.getContext('2d');ox.drawImage(im,0,0,cols,rows);const d=ox.getImageData(0,0,cols,rows).data;
  // Rec. 601 luma weights map RGB to grayscale intensity.
  for(let i=0;i<N();i++)img[i]=Math.round(0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2]);
  rebuildAmpFromImg();measured=null;markCustom();renderAll();URL.revokeObjectURL(im.src);};im.src=URL.createObjectURL(f);e.target.value='';});

/* ===== ρ STATE STACK — on-the-fly density (scales to 10 qubits) ===== */
// The 3D tower. Each circuit step becomes one horizontal slab of density-matrix
// cells; slabs stack up the y axis. PITCH is cell spacing, CUBE the cell size,
// LAYER_GAP the vertical gap between slabs, BARMAX the sampling histogram height.
const PITCH=1.0,CUBE=0.82,LAYER_GAP=1.15,BARMAX=4.6;
let scene,camera,renderer,composer,controls,grp,glReady=false;
let cellMesh,floorMesh,floorGrid,labelGroup,sampleMesh,histGroup,histBars,histMarks,labelSprites=[];
let DIM=32,layerStates=[],layerLabel=[],layerGate=[],layerGIdx=[],totalLayers=1,builtStage=-1,layerEndArr=[];
let gateList=[],activePix=[],stackStage=0,stackPlaying=false,stackTimer=null,sampleAnim=null,initBasis=0;
// Saver state, declared here because the render loop (animateGL) reads it
// from the first frame: hud is the saver image panel, saverOn the mode flag.
let hud=null,saverOn=false;
// Reusable scratch objects for writing instance matrices and colours.
const dummy=new THREE.Object3D(),_col=new THREE.Color();
// Cells dimmer than this heat cut are skipped; driven by the threshold slider.
const heatCut=()=>Math.max(1e-4,threshold);
const curBudget=()=>Math.max(3000,Math.min(16000,Math.floor(240000/Math.max(1,totalLayers))));   // total tower stays ~bounded

// Build the Three.js stack once: scene, camera, renderer, bloom composer, and
// orbit controls with slow auto-rotate. Then start the render loop.
function initGL(){
  const wrap=document.getElementById('stack-gl-wrap'),W=wrap.clientWidth||300,H=wrap.clientHeight||300;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x0a0d14);
  camera=new THREE.PerspectiveCamera(46,W/H,0.1,9000);camera.position.set(8,8,14);
  renderer=new THREE.WebGLRenderer({canvas:document.getElementById('stack-gl'),antialias:true});
  renderer.setPixelRatio(glPixelRatio(devicePixelRatio,COARSE));renderer.setSize(W,H,false);
  renderer.setClearColor(0x0a0d14,1);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=0.08;
  controls.autoRotate=true;controls.autoRotateSpeed=0.5;
  document.getElementById('stack-gl').addEventListener('pointerdown',()=>controls.autoRotate=false);
  // On a phone the modules are one scroll column. OrbitControls sets
  // touch-action none, so a swipe on the stack could not scroll the page.
  // pan-y gives a vertical swipe to the page; a sideways drag still turns
  // the stack, and two fingers still pinch.
  const panY=()=>{renderer.domElement.style.touchAction=PHONE_Q.matches?'pan-y':'none';};
  panY();PHONE_Q.addEventListener('change',panY);
  scene.add(new THREE.AmbientLight(0x556682,1.1));
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W,H),0.3,0.5,0.2));  // slightly softer glow
  composer.addPass(new OutputPass());
  grp=new THREE.Group();scene.add(grp);glReady=true;animateGL();
}
// Build the abstract gate list: init, an H on each position qubit, one
// controlled-RY per lit pixel, then a measurement. activePix lists lit pixels.
function buildGateList(){
  const n=N(),k=nPos;gateList=[{type:'init'}];
  for(let q=0;q<k;q++)gateList.push({type:'H',q});
  activePix=[];for(let i=0;i<n;i++)if(img[i]>0.5)activePix.push(i);
  for(const i of activePix)gateList.push({type:'cRY',pix:i,angle:2*theta(img[i])});
  gateList.push({type:'M'});
}
// Run the circuit as a dense state-vector simulation, snapshotting after every
// gate. The state size is dim = 2·n: the color qubit is the low bit, so index i
// is pixel i's |0⟩ branch and n+i its |1⟩ branch.
function simulate(){
  buildGateList();
  // Start from the chosen basis state |initBasis⟩ (default |0…0⟩).
  const n=N(),dim=2*n,k=nPos;let re=new Float64Array(dim),im=new Float64Array(dim);re[Math.min(initBasis,dim-1)]=1;
  const states=[],labels=[],gtype=[],gidx=[];
  // snap() records a copy of the current state plus its label and gate index.
  const snap=(lbl,gt,gi)=>{states.push({re:re.slice(),im:im.slice()});labels.push(lbl);gtype.push(gt);gidx.push(gi);};
  snap('init',{type:'init'},0);
  let gi=1;
  // Hadamard on each position qubit via the standard in-place butterfly: mix the
  // pair of amplitudes that differ only in this qubit's bit.
  for(let q=0;q<k;q++){const bit=1<<q,s=Math.SQRT1_2,nre=new Float64Array(dim),nim=new Float64Array(dim);
    for(let b=0;b<dim;b++){if(b&bit)continue;const b1=b|bit;nre[b]=(re[b]+re[b1])*s;nim[b]=(im[b]+im[b1])*s;nre[b1]=(re[b]-re[b1])*s;nim[b1]=(im[b]-im[b1])*s;}
    re=nre;im=nim;snap('H q'+q,{type:'H',q},gi);gi++;}
  // encode: one snapshot per controlled-RY, grouped if too many to keep the tower bounded
  // grp = pixels folded into one slab so the tower never exceeds ~maxSlabs.
  const enc=activePix.length,maxSlabs=Math.max(1,Math.min(enc,Math.max(6,34-k))),grp=Math.ceil(enc/maxSlabs);
  let done=0;
  for(let a=0;a<enc;a++){const i=activePix[a],th=theta(img[i]),ct=Math.cos(th),st=Math.sin(th);
    // Controlled-RY(2θ) rotates pixel i's color qubit: mix its |0⟩ (i) and |1⟩
    // (n+i) branches by (cosθ, sinθ).
    const r0=re[i],i0=im[i],r1=re[n+i],i1=im[n+i];
    re[i]=ct*r0-st*r1;im[i]=ct*i0-st*i1;re[n+i]=st*r0+ct*r1;im[n+i]=st*i0+ct*i1;
    // If this pixel carries a stored phase (from a gate), apply it to |1⟩.
    const ph=Math.atan2(a1im[i],a1re[i]);if(Math.abs(ph)>1e-9){const cr=Math.cos(ph),sr=Math.sin(ph),rr=re[n+i],ii=im[n+i];re[n+i]=cr*rr-sr*ii;im[n+i]=sr*rr+cr*ii;}
    done++;
    // Snapshot once per group boundary (or at the end).
    if(done>=grp||a===enc-1){const gIndex=1+k+a,lbl=grp>1?('RY ×'+done):('RY '+i.toString(2).padStart(k,'0'));snap(lbl,{type:'cRY',count:done},gIndex);done=0;}
  }
  // A blank image still needs one encode slab so the tower has a final state.
  if(enc===0)snap('RY enc',{type:'cRY',count:0},1+k);
  return {states,labels,gtype,gidx};
}
// Build a camera-facing text sprite (used for the basis-index axis labels).
function makeLabelSprite(txt){const c=document.createElement('canvas');c.width=128;c.height=32;const x=c.getContext('2d');
  x.fillStyle='#7a8aa6';x.font='600 16px ui-monospace, Menlo, monospace';x.textAlign='center';x.textBaseline='middle';x.fillText(txt,64,16);
  const tx=new THREE.CanvasTexture(c);tx.minFilter=THREE.LinearFilter;return new THREE.Sprite(new THREE.SpriteMaterial({map:tx,transparent:true,depthWrite:false}));}
// Dispose and remove every child of the stack group, freeing GPU resources.
function clearGrp(){if(!grp)return;for(let i=grp.children.length-1;i>=0;i--){const o=grp.children[i];o.traverse&&o.traverse(c=>{c.geometry&&c.geometry.dispose&&c.geometry.dispose();c.material&&(Array.isArray(c.material)?c.material:[c.material]).forEach(m=>m.dispose());});grp.remove(o);}
  cellMesh=floorMesh=floorGrid=labelGroup=sampleMesh=histGroup=histBars=histMarks=null;labelSprites=[];}
// Upper bound on cells per slab, used to size the shared instanced mesh.
function perLayerCap(){return Math.min(DIM*DIM,curBudget())+DIM;}
// Allocate all reusable GPU objects for the current DIM and layer count: the
// instanced cell mesh, sample-glow cubes, histogram bars/marks, floor, grid, and
// axis labels. Called on every rebuild because DIM changes with qubit count.
function rebuildMeshes(){
  clearGrp();
  const need=Math.max(DIM, totalLayers*perLayerCap());
  const geo=new RoundedBoxGeometry(CUBE,CUBE,CUBE,1,CUBE*0.14);geo.translate(0,CUBE/2,0);
  cellMesh=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial({toneMapped:false}),need);
  cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);cellMesh.setColorAt(0,_col.setRGB(0.1,0.05,0.2));cellMesh.count=0;cellMesh.frustumCulled=false;grp.add(cellMesh);
  const sgeo=new THREE.BoxGeometry(CUBE*1.14,CUBE*1.14,CUBE*1.14);
  sampleMesh=new THREE.InstancedMesh(sgeo,new THREE.MeshBasicMaterial({transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}),DIM);
  sampleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);sampleMesh.setColorAt(0,_col.setRGB(0,0,0));sampleMesh.count=0;sampleMesh.frustumCulled=false;grp.add(sampleMesh);
  histGroup=new THREE.Group();histGroup.visible=false;
  const barW=PITCH*0.6,bgeo=new THREE.BoxGeometry(barW,1,barW);bgeo.translate(0,0.5,0);
  histBars=new THREE.InstancedMesh(bgeo,new THREE.MeshBasicMaterial({toneMapped:false}),DIM);histBars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);histBars.setColorAt(0,_col.setRGB(0.1,0.05,0.2));histBars.count=0;histBars.frustumCulled=false;histGroup.add(histBars);
  const mgeo=new THREE.BoxGeometry(barW*1.25,0.05,barW*1.25);histMarks=new THREE.InstancedMesh(mgeo,new THREE.MeshBasicMaterial({toneMapped:false}),DIM);histMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);histMarks.setColorAt(0,_col.setRGB(1,0.72,0.28));histMarks.count=0;histMarks.frustumCulled=false;histGroup.add(histMarks);
  grp.add(histGroup);
  const span=DIM*PITCH;
  floorMesh=new THREE.Mesh(new THREE.PlaneGeometry(span+PITCH,span+PITCH),new THREE.MeshBasicMaterial({color:0x05080f,transparent:true,opacity:0.6}));floorMesh.rotation.x=-Math.PI/2;floorMesh.position.y=-0.05;grp.add(floorMesh);
  const pts=[],half=span/2,nl=Math.min(DIM,64),stp=DIM/nl;for(let r=0;r<=nl;r++){const z=(r*stp-DIM/2)*PITCH;pts.push(-half,-0.05,z,half,-0.05,z);}for(let c=0;c<=nl;c++){const x=(c*stp-DIM/2)*PITCH;pts.push(x,-0.05,-half,x,-0.05,half);}
  const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  floorGrid=new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.06}));floorGrid.frustumCulled=false;grp.add(floorGrid);
  labelGroup=new THREE.Group();grp.add(labelGroup);
  // Only label basis indices when the tower is small enough to read them.
  if(DIM<=16){const half2=span/2,nb=nPos+1;for(let i=0;i<DIM;i++){const lbl=i.toString(2).padStart(nb,'0');
    const a=makeLabelSprite(lbl);a.position.set(-half2-0.7,0.05,(i-(DIM-1)/2)*PITCH);a.scale.set(1.1,0.55,1);labelGroup.add(a);labelSprites.push(a);
    const b=makeLabelSprite(lbl);b.position.set((i-(DIM-1)/2)*PITCH,0.05,-half2-0.7);b.scale.set(1.1,0.55,1);labelGroup.add(b);labelSprites.push(b);}}
}
// Running instance index at the end of each built layer.
const layerEnd=L=>L<0?0:(layerEndArr[L]||0);
// Turn one state snapshot into density-matrix cells at height L. Writes into the
// shared instanced mesh starting at instance index si, returns the next index.
function appendLayer(L,si){
  const st=layerStates[L],re=st.re,im=st.im,baseY=L*LAYER_GAP,cut=heatCut(),off=(DIM-1)/2,ex=EXPO();
  // Amplitude magnitude per basis index, and the list of populated indices.
  const mag=new Float64Array(DIM);let active=[];
  for(let i=0;i<DIM;i++){const m=Math.hypot(re[i],im[i]);mag[i]=m;if(m>1e-9)active.push(i);}
  // |ρ_ij| is used ABSOLUTELY (like QAV) and lifted into the visible band by EXPO — diffuse states stay dim, peaks glow
  // Place one cell at matrix position (r,c) with magnitude m and (re,im) parts.
  const place=(r,c,m,rr,ii)=>{dummy.position.set((c-off)*PITCH,baseY,(r-off)*PITCH);dummy.scale.set(1,1,1);dummy.updateMatrix();cellMesh.setMatrixAt(si,dummy.matrix);
    const d=clamp01(m*ex),col=cellColor(d,rr*ex,ii*ex);_col.setRGB(col[0]/255,col[1]/255,col[2]/255).multiplyScalar(glowGain(d));cellMesh.setColorAt(si,_col);si++;};
  // Diagonal cells are the populations |ρ_rr| = |c_r|²: the outcome probabilities.
  // diagonal populations  |ρ_rr| = |c_r|²
  for(const r of active){const m2=re[r]*re[r]+im[r]*im[r];if(clamp01(m2*ex)<cut)continue;place(r,r,m2,m2,0);}
  // Off-diagonal cells are coherences |ρ_rc| = |c_r||c_c|. At large DIM the full
  // matrix is too big, so keep only the strongest indices within curBudget().
  // off-diagonal coherences  |ρ_rc| = |c_r||c_c|  (capped pool at high DIM)
  let pool=active;const bud=curBudget(),full=DIM*DIM<=bud;
  if(!full){active.sort((a,b)=>mag[b]-mag[a]);pool=active.slice(0,Math.min(active.length,Math.floor(Math.sqrt(bud))));}
  const cap=si+(full?DIM*DIM:bud);
  // Complex coherence ρ_rc = c_r · conj(c_c).
  for(let x=0;x<pool.length&&si<cap;x++){const r=pool[x],mr=mag[r];if(mr<=0)continue;
    for(let y=0;y<pool.length&&si<cap;y++){const c=pool[y];if(c===r)continue;const m=mr*mag[c];if(clamp01(m*ex)<cut)continue;
      const rRe=re[r]*re[c]+im[r]*im[c],rIm=im[r]*re[c]-re[r]*im[c];place(r,c,m,rRe,rIm);}}
  return si;
}
// Lazily build slabs up to a given stage, caching how far the mesh is filled,
// then set the visible instance count. Avoids rebuilding earlier slabs.
function buildStackUpTo(stage){
  stage=Math.min(stage,totalLayers-1);
  if(stage>builtStage){let si=layerEnd(builtStage);
    for(let L=builtStage+1;L<=stage;L++){si=appendLayer(L,si);layerEndArr[L]=si;}
    builtStage=stage;cellMesh.instanceMatrix.needsUpdate=true;if(cellMesh.instanceColor)cellMesh.instanceColor.needsUpdate=true;}
  const shown=Math.min(stage,builtStage);cellMesh.count=shown<0?0:layerEnd(shown);return shown;
}
// Full rebuild: re-simulate the circuit, resize meshes, build every slab, and
// jump the playhead to the final state. Frames the camera on the first build.
function buildStack(){
  if(!glReady)return;
  const {states,labels,gtype,gidx}=simulate();layerStates=states;layerLabel=labels;layerGate=gtype;layerGIdx=gidx;totalLayers=states.length;DIM=2*N();
  builtStage=-1;layerEndArr=[];
  rebuildMeshes();stackStage=totalLayers-1;
  buildStackUpTo(totalLayers-1);setStage(stackStage);ensurePicker();updateDiagGuide();if(!_framed){_framed=true;frameCamera();}
}
let _framed=false,camZoom=1;
// Position the camera to frame the whole tower (and the sampling histogram,
// while sampling or when hist is true). camZoom > 1 moves the camera back
// from the target; the saver sets it so the tower fits its part of the band.
function frameCamera(hist){const span=DIM*PITCH,towerH=totalLayers*LAYER_GAP+((hist||sampleAnim)?BARMAX+LAYER_GAP*1.4:0);
  const d=Math.max(span,towerH)*1.15+span*0.5+5,ty=towerH*0.45;
  camera.position.set((span*0.85+4)*camZoom,ty+(towerH*0.62+span*0.35-ty)*camZoom,d*camZoom);controls.target.set(0,ty,0);controls.update();}
// Move the playhead to step s: reveal slabs up to s, update the label, and
// resync the score and circuit views.
function setStage(s){stackStage=Math.max(0,Math.min(totalLayers-1,s|0));buildStackUpTo(stackStage);cellMesh.count=layerEnd(stackStage);
  document.getElementById('st-lbl').textContent=`${stackStage}/${totalLayers-1} · ${layerLabel[stackStage]||''}`;drawScore();drawCircuit();}
// Step the playhead by d, cancelling any play or sampling first.
function stepStack(d){stopPlay();stopSampling();setStage(stackStage+d);}
// Toggle auto-play through the slabs on a timer (looping at the end).
function playStack(){if(stackPlaying){stopPlay();return;}stackPlaying=true;stopSampling();document.getElementById('st-play').textContent='⏸';
  if(stackStage>=totalLayers-1)setStage(0);
  stackTimer=setInterval(()=>{if(stackStage>=totalLayers-1)setStage(0);else setStage(stackStage+1);},760);}
// Stop auto-play and reset the button.
function stopPlay(){stackPlaying=false;const b=document.getElementById('st-play');if(b)b.textContent='▶';if(stackTimer){clearInterval(stackTimer);stackTimer=null;}}
// The GL render loop: update controls, advance any sampling animation, keep
// labels facing the camera, and render through the bloom composer.
function animateGL(){if(!glReady)return;requestAnimationFrame(animateGL);controls.update();
  if(sampleAnim)updateSampling(Math.min(0.05,clockDt()));
  for(const s of labelSprites)s.quaternion.copy(camera.quaternion);
  composer.render();hudRender();}
// Real seconds since the previous frame, for the sampling animation.
let _lastT=performance.now();function clockDt(){const t=performance.now(),d=(t-_lastT)/1000;_lastT=t;return d;}
// Match the GL camera and render targets to the wrapper size.
function resizeGL(){if(!glReady)return;const wrap=document.getElementById('stack-gl-wrap'),W=wrap.clientWidth,H=wrap.clientHeight;if(W<2||H<2)return;camera.aspect=W/H;camera.updateProjectionMatrix();renderer.setSize(W,H,false);composer.setSize(W,H);if(saverOn)saverLayout();}

/* ===== init-state picker — hover the bottom grid (layer 0) to read |b⟩, click to start there ===== */
// Raycasts the layer-0 floor so a diagonal cell can be picked as the start
// state. A pick sets initBasis and re-simulates from that basis vector.
const _ray=new THREE.Raycaster(),_ndc=new THREE.Vector2();
let pickPlane=null,pickHi=null,diagGuide=null,hoverRC=null,_downXY=null;
const DIAG_CAP=600;
const initTip=document.createElement('div');initTip.id='init-tip';
initTip.style.cssText='position:fixed;z-index:600;pointer-events:none;display:none;background:rgba(9,12,20,0.97);border:1px solid rgba(150,200,255,0.35);border-radius:7px;padding:7px 10px;font-family:var(--sci-mono);font-size:0.68rem;color:#cdd6e6;box-shadow:0 6px 22px rgba(0,0,0,0.55);max-width:220px;line-height:1.4';
document.body.appendChild(initTip);
// Lazily create the invisible pick plane, the hover highlight box, and the
// diagonal guide markers that show which cells are valid start states.
function ensurePicker(){
  if(!scene)return;
  if(!pickPlane){const pg=new THREE.PlaneGeometry(5000,5000);pickPlane=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({visible:false}));pickPlane.rotation.x=-Math.PI/2;pickPlane.frustumCulled=false;scene.add(pickPlane);}
  if(!pickHi){const hg=new THREE.BoxGeometry(PITCH*0.98,CUBE*1.14,PITCH*0.98);hg.translate(0,CUBE*0.5,0);
    pickHi=new THREE.Mesh(hg,new THREE.MeshBasicMaterial({color:0x9cc8ff,transparent:true,opacity:0.30,depthWrite:false,toneMapped:false}));pickHi.visible=false;pickHi.frustumCulled=false;scene.add(pickHi);}
  if(!diagGuide){const dg=new THREE.BoxGeometry(PITCH*0.9,0.05,PITCH*0.9);dg.translate(0,0.02,0);
    diagGuide=new THREE.InstancedMesh(dg,new THREE.MeshBasicMaterial({transparent:true,opacity:0.4,depthWrite:false,toneMapped:false}),DIAG_CAP);
    diagGuide.setColorAt(0,_col.setRGB(0.27,0.78,0.95));diagGuide.count=0;diagGuide.frustumCulled=false;scene.add(diagGuide);}
}
// Refresh the diagonal guide markers, raising and re-colouring the currently
// selected start-state cell.
function updateDiagGuide(){
  ensurePicker();if(!diagGuide)return;const off=(DIM-1)/2,n=Math.min(DIM,DIAG_CAP);
  for(let i=0;i<n;i++){const sel=(i===initBasis);dummy.position.set((i-off)*PITCH,0,(i-off)*PITCH);dummy.scale.set(1,sel?3.2:1,1);dummy.updateMatrix();diagGuide.setMatrixAt(i,dummy.matrix);
    if(sel)_col.setRGB(1,0.72,0.28).multiplyScalar(1.5);else _col.setRGB(0.27,0.78,0.95);diagGuide.setColorAt(i,_col);}
  diagGuide.count=n;diagGuide.instanceMatrix.needsUpdate=true;if(diagGuide.instanceColor)diagGuide.instanceColor.needsUpdate=true;
}
// Binary ket string for a basis index at the current DIM.
function ketStr(idx){const bits=Math.max(1,Math.round(Math.log2(DIM)));return idx.toString(2).padStart(bits,'0');}
// Convert a pointer event to the (row, col) matrix cell under it on the floor.
function pickRC(e){
  ensurePicker();const canvas=renderer.domElement,rect=canvas.getBoundingClientRect();
  _ndc.x=((e.clientX-rect.left)/rect.width)*2-1;_ndc.y=-((e.clientY-rect.top)/rect.height)*2+1;
  _ray.setFromCamera(_ndc,camera);const hit=_ray.intersectObject(pickPlane,false)[0];if(!hit)return null;
  const off=(DIM-1)/2,c=Math.round(hit.point.x/PITCH+off),r=Math.round(hit.point.z/PITCH+off);
  if(r<0||c<0||r>=DIM||c>=DIM)return null;return {r,c,off};
}
// Hide the pick highlight and its tooltip.
function hideInitHover(){hoverRC=null;if(pickHi)pickHi.visible=false;initTip.style.display='none';}
// On hover: highlight the cell and show a tooltip. Diagonal cells are valid
// start states (blue); off-diagonal cells are coherences (red, not pickable).
function onPickMove(e){
  const rc=pickRC(e);if(!rc){hideInitHover();return;}
  hoverRC=rc;const {r,c,off}=rc,diag=(r===c);
  pickHi.position.set((c-off)*PITCH,0,(r-off)*PITCH);pickHi.material.color.setHex(diag?0x9cc8ff:0xe05858);pickHi.material.opacity=diag?0.34:0.22;pickHi.visible=true;
  initTip.innerHTML = diag
    ? 'start state &nbsp;<b style="color:#9cc8ff">|'+ketStr(r)+'⟩</b>'+(r===initBasis?' <span style="color:#64c864">(current)</span>':'')+'<div style="color:#7a8aa6;font-size:0.58rem;margin-top:3px">✓ basis state — click to begin here</div>'
    : '⟨'+ketStr(r)+'|ρ₀|'+ketStr(c)+'⟩ coherence<div style="color:#e09090;font-size:0.58rem;margin-top:3px">✕ not a start state — pick a glowing diagonal cell</div>';
  initTip.style.display='block';const pad=15,w=initTip.offsetWidth,h=initTip.offsetHeight;
  let x=e.clientX+pad,y=e.clientY+pad;if(x+w>innerWidth-6)x=e.clientX-pad-w;if(y+h>innerHeight-6)y=e.clientY-pad-h;
  initTip.style.left=x+'px';initTip.style.top=y+'px';
}
// Wire the picker: hover to preview, click a diagonal cell to restart there. A
// pointer that moved more than a few pixels counts as an orbit drag, not a pick.
(function bindPicker(){const c=document.getElementById('stack-gl');
  c.addEventListener('pointermove',onPickMove);
  c.addEventListener('pointerleave',hideInitHover);
  c.addEventListener('pointerdown',e=>{_downXY=[e.clientX,e.clientY];});
  c.addEventListener('pointerup',e=>{if(!_downXY)return;const dx=e.clientX-_downXY[0],dy=e.clientY-_downXY[1];_downXY=null;
    if(dx*dx+dy*dy>25)return;                       // a drag = orbit, not a pick
    const rc=pickRC(e);if(rc&&rc.r===rc.c){initBasis=rc.r;stackStage=0;stopPlay();stopSampling();renderAll();onPickMove(e);}
  });
})();

/* ---- score strip (scrolling musical notation drives the stack) ---- */
// A musical-score-style timeline: one column per circuit step, one lane per
// qubit. The playhead marks the current slab; dragging it scrubs the stack.
const scoreCv=document.getElementById('score-cv'),scx=scoreCv.getContext('2d');
const scoreGut=document.getElementById('score-gutter'),sgx=scoreGut.getContext('2d');
const scoreWrap=document.getElementById('score-wrap');
// SCOL = column width per step; SGUT = pinned gutter width for qubit labels.
const SCOL=58,SGUT=30;
// Draw the score: playhead, qubit wires, per-step gate glyphs, beat numbers, and
// the pinned qubit-label gutter.
function drawScore(){
  const dpr=Math.min(2,devicePixelRatio||1),n=nPos+1,Hc=104,viewW=scoreWrap.clientWidth||400;
  const x0=SGUT+8,Wc=Math.max(viewW,x0+totalLayers*SCOL+24);
  if(scoreCv.style.width!==Wc+'px')scoreCv.style.width=Wc+'px';
  scoreCv.width=Math.round(Wc*dpr);scoreCv.height=Math.round(Hc*dpr);scoreCv.style.height=Hc+'px';scx.setTransform(dpr,0,0,dpr,0,0);scx.clearRect(0,0,Wc,Hc);
  const padT=14,padB=Hc-16,laneH=(padB-padT)/Math.max(1,n),colX=s=>x0+SCOL*(s+0.5),endX=x0+SCOL*totalLayers;
  const laneY=q=>padT+laneH*(n-1-q)+laneH/2;
  // playhead
  const px=x0+SCOL*stackStage;scx.fillStyle='rgba(255,200,80,0.1)';scx.fillRect(px,padT-7,SCOL,padB-padT+14);
  scx.strokeStyle='rgba(255,200,80,0.85)';scx.lineWidth=1.5;const mx=px+SCOL/2;scx.beginPath();scx.moveTo(mx,padT-8);scx.lineTo(mx,padB+8);scx.stroke();
  // wires
  for(let q=0;q<n;q++){const y=laneY(q);scx.strokeStyle=q<nPos?'rgba(70,95,135,0.55)':'rgba(255,185,72,0.5)';scx.lineWidth=1;scx.beginPath();scx.moveTo(x0-6,y);scx.lineTo(endX+8,y);scx.stroke();}
  // gates per layer
  scx.textBaseline='middle';scx.textAlign='center';
  for(let s=0;s<totalLayers;s++){const g=layerGate[s],x=colX(s),active=s===stackStage;
    if(g.type==='H'){gateGlyph(scx,x,laneY(g.q),'H','#45d3ff',active,laneH);}
    else if(g.type==='cRY'){const y0=laneY(nPos),y1=laneY(0);scx.strokeStyle='rgba(255,185,72,'+(active?0.95:0.6)+')';scx.lineWidth=active?2:1.3;scx.beginPath();scx.moveTo(x,Math.min(y0,y1));scx.lineTo(x,Math.max(y0,y1));scx.stroke();
      for(let q=0;q<nPos;q++){scx.fillStyle='rgba(255,185,72,0.5)';scx.beginPath();scx.arc(x,laneY(q),3,0,7);scx.fill();}
      gateGlyph(scx,x,laneY(nPos),'RY','#ffb948',active,laneH);}
  }
  // beat numbers
  scx.font='500 8px ui-monospace, Menlo, monospace';scx.textBaseline='top';
  for(let s=0;s<totalLayers;s++){scx.fillStyle=(s===stackStage)?'rgba(255,200,80,0.95)':'rgba(110,125,150,0.6)';scx.fillText('L'+s,colX(s),padB+4);}
  // gutter (qubit labels, pinned)
  scoreGut.width=Math.round(SGUT*dpr);scoreGut.height=Math.round(Hc*dpr);scoreGut.style.width=SGUT+'px';scoreGut.style.height=Hc+'px';sgx.setTransform(dpr,0,0,dpr,0,0);sgx.clearRect(0,0,SGUT,Hc);
  const grd=sgx.createLinearGradient(0,0,SGUT,0);grd.addColorStop(0,'rgba(8,12,20,0.98)');grd.addColorStop(0.7,'rgba(8,12,20,0.94)');grd.addColorStop(1,'rgba(8,12,20,0)');sgx.fillStyle=grd;sgx.fillRect(0,0,SGUT,Hc);
  sgx.textAlign='left';sgx.textBaseline='middle';sgx.font='600 9px ui-monospace, Menlo, monospace';
  for(let q=0;q<n;q++){sgx.fillStyle=q<nPos?'#8fa0bd':'#ffb948';sgx.fillText(q<nPos?('q'+q):('c'),4,laneY(q));}
}
// Draw one boxed gate glyph, brighter when it is the active step.
function gateGlyph(ctx,x,y,label,color,active,laneH){const s=Math.min(20,laneH*0.74);ctx.fillStyle='rgba(8,12,20,0.96)';ctx.strokeStyle=color;ctx.lineWidth=active?2:1.3;
  ctx.fillRect(x-s*0.7,y-s/2,s*1.4,s);ctx.strokeRect(x-s*0.7,y-s/2,s*1.4,s);ctx.fillStyle=active?color:'#cdd6e6';ctx.font='700 10px ui-monospace, Menlo, monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,x,y+0.5);}
let scoreScrub=false;
// Map a pointer x to a step and jump the playhead there.
function scoreScrubTo(clientX){const rect=scoreCv.getBoundingClientRect(),x=clientX-rect.left,x0=SGUT+8;let s=Math.floor((x-x0)/SCOL);s=Math.max(0,Math.min(totalLayers-1,s));stopPlay();stopSampling();setStage(s);}
scoreCv.addEventListener('pointerdown',e=>{scoreScrub=true;try{scoreCv.setPointerCapture(e.pointerId);}catch(_){}scoreScrubTo(e.clientX);e.preventDefault();});
scoreCv.addEventListener('pointermove',e=>{if(scoreScrub)scoreScrubTo(e.clientX);});
scoreCv.addEventListener('pointerup',()=>scoreScrub=false);
scoreCv.addEventListener('pointercancel',()=>scoreScrub=false);

/* ---- timed sampling, then the flight into the image (frqi-core.js) ---- */
// Seedable mulberry32 PRNG so each sampling run is reproducible.
function makeRng(seed){let a=(seed>>>0)||1;return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
// Place the additive sample-glow cubes along the diagonal of the final slab.
function placeSampleGlow(L){for(let i=0;i<DIM;i++){const x=(i-(DIM-1)/2)*PITCH,y=L*LAYER_GAP+CUBE*0.5;dummy.position.set(x,y,x);dummy.scale.set(1,1,1);dummy.updateMatrix();sampleMesh.setMatrixAt(i,dummy.matrix);}sampleMesh.instanceMatrix.needsUpdate=true;sampleMesh.count=DIM;}
// Update the histogram bars (measured frequencies) and the marks (true P) above
// the final slab, breathing them so they read as live.
function updateHistBars(A){if(!histBars||histBars.count!==A.D)return;const baseY=A.layer*LAYER_GAP+CUBE;let scale=1e-4;for(let i=0;i<A.D;i++)scale=Math.max(scale,A.counts[i]/Math.max(1,A.drawn),A.probs[i]);
  const breathe=0.82+0.18*Math.sin(A.gp);
  for(let i=0;i<A.D;i++){const dx=(i-(A.D-1)/2)*PITCH,emp=A.counts[i]/Math.max(1,A.drawn),h=Math.max(1e-4,(emp/scale)*BARMAX);
    dummy.position.set(dx,baseY,dx);dummy.scale.set(1,h,1);dummy.updateMatrix();histBars.setMatrixAt(i,dummy.matrix);
    const col=heatColor(0.04+0.96*(emp/scale)),b=breathe*(1+A.pulses[i]*1.4);_col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b);histBars.setColorAt(i,_col);
    const th=baseY+Math.max(1e-4,(A.probs[i]/scale)*BARMAX);dummy.position.set(dx,th,dx);dummy.scale.set(1,1,1);dummy.updateMatrix();histMarks.setMatrixAt(i,dummy.matrix);}
  histBars.instanceMatrix.needsUpdate=true;if(histBars.instanceColor)histBars.instanceColor.needsUpdate=true;histMarks.instanceMatrix.needsUpdate=true;}
// Colour the sample-glow cubes by their running count, pulsing on new hits.
function paintSampleGlow(A){if(!sampleMesh||sampleMesh.count!==A.D)return;const breathe=0.75+0.25*Math.sin(A.gp);
  for(let i=0;i<A.D;i++){const norm=A.counts[i]/A.maxc,b=norm*breathe*1.25+A.pulses[i]*2.2;
    if(b<=0.001)_col.setRGB(0,0,0);else{const col=heatColor(0.01+0.99*curveEval(norm));_col.setRGB(col[0]/255*b,col[1]/255*b,col[2]/255*b);}
    sampleMesh.setColorAt(i,_col);}
  if(sampleMesh.instanceColor)sampleMesh.instanceColor.needsUpdate=true;}
// Draw one measurement shot (binary search on the CDF) and record it. The
// outcome |c⟩|i⟩ pulses its histogram bar and the tape cell of pixel i.
function oneShot(A){const idx=sampleCdf(A.cdf,A.rng());A.counts[idx]++;A.pulses[idx]=1;A.pix[idx%A.n]=1;A.drawn++;if(A.counts[idx]>A.maxc)A.maxc=A.counts[idx];}
// Start a sampling run on the final state: read its outcome probabilities and
// set up the run that the GL loop advances. A run is sampleMs of shots, then
// flightMs of cells that move from the register tape into the image grid.
// opt: { sampleMs, flightMs, reframe } (the saver passes its own plan).
function runSampling(opt={}){
  if(!glReady)return;stopPlay();setStage(totalLayers-1);
  const L=totalLayers-1,st=layerStates[L],D=DIM,n=N(),probs=new Float64Array(D);let sm=0;
  for(let i=0;i<D;i++){const p=st.re[i]*st.re[i]+st.im[i]*st.im[i];probs[i]=p;sm+=p;}
  if(sm>0)for(let i=0;i<D;i++)probs[i]/=sm;
  const shots=Math.max(1,Math.round(+document.getElementById('shots').value));
  const sampleMs=opt.sampleMs??Math.round(+document.getElementById('stime').value*1000),flightMs=opt.flightMs??PAGE_FLIGHT_MS;
  sampleAnim={probs,cdf:buildCdf(probs),D,n,layer:L,counts:new Float64Array(D),pulses:new Float32Array(D),pix:new Float32Array(n),maxc:1,drawn:0,shots,t:0,sampleMs,flightMs,gp:0,done:false,rng:makeRng(0x51EE)};
  placeSampleGlow(L);histBars.count=D;histMarks.count=D;for(let i=0;i<D;i++)histMarks.setColorAt(i,_col.setRGB(1,0.72,0.28));if(histMarks.instanceColor)histMarks.instanceColor.needsUpdate=true;
  histGroup.visible=true;if(opt.reframe!==false)frameCamera();reconFromSampling(sampleAnim);
}
// Advance the run each frame: draw the shots that shotsAt() asks for by now,
// refresh the estimate, and end the run when the flight is over. One frame
// draws at most shots/(frames in sampleMs) shots, so the thread stays free.
function updateSampling(dt){const A=sampleAnim;if(!A)return;A.gp+=dt*5;
  if(!A.done){A.t+=dt*1000;
    const want=shotsAt(A.t,A.sampleMs,A.shots);while(A.drawn<want)oneShot(A);
    if(A.t>=A.sampleMs+A.flightMs){A.done=true;if(hud)hud.dirty=true;}
    reconFromSampling(A);}
  const decay=Math.exp(-dt*4);for(let i=0;i<A.D;i++)A.pulses[i]*=decay;
  const pd=Math.exp(-dt*7);for(let i=0;i<A.n;i++)A.pix[i]*=pd;
  paintSampleGlow(A);updateHistBars(A);}
// Turn accumulated shot counts into a reconstructed image (frqi-core.js
// reconstruct): per pixel, P(|1⟩) is the |1⟩ share of its two branch counts,
// decoded back to intensity.
function reconFromSampling(A){const r=reconstruct(A.counts,A.n,decodeMode);
  measured={vest:r.vest,shots:Math.round(A.drawn),per:r.per};drawRecon();
  document.getElementById('recon-tag').textContent=A.done?(A.drawn+' shots'):A.t<A.sampleMs?('… '+A.drawn):'to the grid';}
// The phase of the current run, for the painters.
function reconPhase(){const A=sampleAnim;if(!measured)return {kind:'none'};
  if(!A||A.done)return {kind:'done'};
  if(A.t<A.sampleMs)return {kind:'sample',A};
  return {kind:'flight',A,tf:A.t-A.sampleMs};}
// Cancel any sampling run and hide its glow, bars, and marks. A run that has
// not finished leaves no reconstruction.
function stopSampling(){if(!sampleAnim)return;if(!sampleAnim.done){measured=null;drawRecon();if(hud)hud.dirty=true;}
  sampleAnim=null;if(sampleMesh)sampleMesh.count=0;if(histGroup)histGroup.visible=false;if(histBars)histBars.count=0;if(histMarks)histMarks.count=0;}

/* ===== CIRCUIT (synced playhead + scrub) ===== */
// The encoding-circuit diagram: qubit wires, H gates, one controlled-RY column
// per lit pixel, and a measurement column. Its playhead tracks the stack stage;
// clicking scrubs, and clicking an RY box opens the pixel editor.
const ccv=document.getElementById('circuit-cv'),cctx=ccv.getContext('2d');
let circLeft=78,circColW=40,circXH=100,circShown=0,circK=4,circColorY=0,circRowH=24;
// Redraw the circuit for the current image and playhead position.
function drawCircuit(){
  const body=document.getElementById('circuit-body'),k=nPos,n=N(),rowsC=k+1,rowH=Math.max(18,Math.min(34,(body.clientHeight-66)/rowsC)),top=24,left=78,colW=40,dpr=Math.min(2,devicePixelRatio||1);
  // Draw at most MAXG controlled-RY columns to keep the diagram legible.
  const pixels=activePix.length?activePix:[],MAXG=40,shown=pixels.slice(0,MAXG),nCols=1+shown.length+1;
  circLeft=left;circColW=colW;circXH=left+22;circShown=shown.length;circK=k;
  const W=Math.max(left+22+nCols*colW+40,body.clientWidth),H=Math.max(body.clientHeight,top+rowsC*rowH+26);
  ccv.width=W*dpr;ccv.height=H*dpr;ccv.style.width=W+'px';ccv.style.height=H+'px';cctx.setTransform(dpr,0,0,dpr,0,0);cctx.clearRect(0,0,W,H);
  const yOf=r=>top+r*rowH;
  // ---- playhead band synced to the stack slab ----
  const hl=layerGIdx[stackStage];let hlx=-1;
  if(hl>=1&&hl<=k)hlx=circXH;
  else if(hl>k){const a=hl-(k+1);if(a>=0&&a<shown.length)hlx=circXH+colW*(1+a);else if(hl>=1+k+pixels.length)hlx=circXH+colW*(1+shown.length);}
  if(hlx>=0){cctx.fillStyle='rgba(255,200,80,0.12)';cctx.fillRect(hlx-colW/2,top-9,colW,rowsC*rowH+4);
    cctx.strokeStyle='rgba(255,200,80,0.8)';cctx.lineWidth=1.5;cctx.beginPath();cctx.moveTo(hlx,top-10);cctx.lineTo(hlx,top+(rowsC-1)*rowH+10);cctx.stroke();}
  cctx.strokeStyle='rgba(150,200,255,0.2)';cctx.lineWidth=1;cctx.font='9px ui-monospace, Menlo, monospace';
  for(let r=0;r<rowsC;r++){const y=yOf(r);cctx.beginPath();cctx.moveTo(left,y);cctx.lineTo(W-20,y);cctx.stroke();
    cctx.fillStyle=r<k?'rgba(128,144,176,0.95)':'rgba(255,185,72,0.95)';cctx.textAlign='right';cctx.fillText(r<k?('q'+r):('q'+k+' c'),left-8,y+3);}
  for(let r=0;r<k;r++)gbox(circXH,yOf(r),'H','#45d3ff',rowH);
  let cx=circXH+colW;const colorY=yOf(k);circColorY=colorY;circRowH=rowH;
  // One controlled-RY column per pixel: control dots on the position qubits
  // (filled for 1-bits, open for 0-bits) and the RY box on the color qubit.
  shown.forEach(i=>{const addr=i.toString(2).padStart(k,'0');let minY=colorY,maxY=colorY;
    for(let qi=0;qi<k;qi++){const y=yOf(qi);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    cctx.strokeStyle='rgba(255,185,72,0.6)';cctx.lineWidth=1.3;cctx.beginPath();cctx.moveTo(cx,minY);cctx.lineTo(cx,maxY);cctx.stroke();
    // addr is MSB-first, so bit qi reads from the far end of the string.
    for(let qi=0;qi<k;qi++){const bit=addr[k-1-qi],y=yOf(qi);cctx.beginPath();cctx.arc(cx,y,3.6,0,7);
      if(bit==='1'){cctx.fillStyle='#ffb948';cctx.fill();}else{cctx.fillStyle='#0a0d14';cctx.fill();cctx.strokeStyle='#ffb948';cctx.lineWidth=1.3;cctx.stroke();}}
    gbox(cx,colorY,'RY','#ffb948',rowH,(2*theta(img[i])).toFixed(2));cx+=colW;});
  for(let r=0;r<rowsC;r++)gbox(cx,yOf(r),'M','#64c864',rowH);
  let cap=`H×${k} · ${pixels.length} controlled-RY · same circuit the stack steps through`;
  if(pixels.length>shown.length)cap+=`  —  first ${shown.length} of ${pixels.length} shown`;
  cctx.fillStyle='rgba(80,96,128,0.9)';cctx.font='9px ui-monospace, Menlo, monospace';cctx.textAlign='left';cctx.fillText(cap,left,H-9);
}
// Draw one labelled gate box on the circuit, with an optional sub-label.
function gbox(x,y,label,color,rowH,sub){const s=Math.min(22,rowH-7);cctx.fillStyle='rgba(10,13,20,0.95)';cctx.strokeStyle=color;cctx.lineWidth=1.4;cctx.fillRect(x-s/2,y-s/2,s,s);cctx.strokeRect(x-s/2,y-s/2,s,s);
  cctx.fillStyle=color;cctx.font='600 10px ui-monospace, Menlo, monospace';cctx.textAlign='center';cctx.textBaseline='middle';cctx.fillText(label,x,y);cctx.textBaseline='alphabetic';
  if(sub){cctx.fillStyle='rgba(255,185,72,0.8)';cctx.font='7px ui-monospace, Menlo, monospace';cctx.fillText(sub,x,y+s/2+8);}}
// Map a click x on the circuit to the nearest gate, then to the matching slab.
function circuitScrub(clientX){
  const rect=ccv.getBoundingClientRect(),x=clientX-rect.left;
  let gi;const ci=Math.round((x-circXH)/circColW);
  if(ci<=0)gi=circK;                                            // H block → last H gate
  else if(ci<=circShown)gi=1+circK+(ci-1);                       // a-th controlled-RY
  else gi=1+circK+Math.max(0,activePix.length-1);                // measure → final encode
  let best=0,bd=1e9;for(let j=0;j<totalLayers;j++){const d=Math.abs(layerGIdx[j]-gi);if(d<bd){bd=d;best=j;}}
  stopPlay();stopSampling();setStage(best);
}
let circScrub=false;
// ---- click an RY gate to retune that pixel (edit the source via the RY array) ----
// Return the pixel index whose RY box is under the pointer, or −1.
function ryGateAt(clientX,clientY){
  const rect=ccv.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top,bs=Math.min(22,circRowH-7)/2+3;
  for(let a=0;a<circShown;a++){const gx=circXH+circColW*(1+a);
    if(Math.abs(x-gx)<=bs&&Math.abs(y-circColorY)<=bs)return activePix[a];}
  return -1;
}
// A small floating editor for retuning one pixel's RY angle (intensity).
let ryEd=null,editPix=-1;
// Create the editor DOM once and wire its slider to retune the current pixel.
function buildRyEd(){
  ryEd=document.createElement('div');ryEd.id='ry-editor';
  ryEd.style.cssText='position:fixed;z-index:500;display:none;width:206px;background:rgba(9,12,20,0.98);border:1px solid var(--border-b);border-radius:9px;padding:11px 12px;backdrop-filter:blur(9px);box-shadow:0 8px 30px rgba(0,0,0,0.6);font-family:var(--sci-mono);user-select:none';
  ryEd.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px"><span id="ry-title" style="font-size:0.78rem;color:#ffb948;font-weight:600"></span><span id="ry-x" style="cursor:pointer;color:#7d8aa0;padding:0 2px">✕</span></div>'
    +'<div style="font-size:0.66rem;color:#cdd6e6;margin-bottom:8px">RY <span id="ry-ang">0</span> rad <span style="color:#5a8cc0">·</span> intensity <span id="ry-int" style="color:#96c8ff">0</span></div>'
    +'<input type="range" id="ry-sl" min="0" max="3.14159" step="0.01" style="width:100%;accent-color:#ffb948;margin-bottom:6px">'
    +'<div style="font-size:0.5rem;color:#5a8cc0;line-height:1.4">drag → retunes this pixel and rebuilds the encoded state</div>';
  document.body.appendChild(ryEd);
  ryEd.querySelector('#ry-sl').addEventListener('input',e=>{if(editPix<0)return;
    const ang=+e.target.value;img[editPix]=Math.round(ang/Math.PI*255);rebuildAmpFromImg();measured=null;markCustom();renderAll();syncRyEd();});
  ryEd.querySelector('#ry-x').addEventListener('click',closeRyEd);
}
// Push the current pixel's angle and intensity into the editor readouts.
function syncRyEd(){if(editPix<0||!ryEd)return;const ang=2*theta(img[editPix]);
  ryEd.querySelector('#ry-ang').textContent=ang.toFixed(2);ryEd.querySelector('#ry-int').textContent=Math.round(img[editPix]);
  const sl=ryEd.querySelector('#ry-sl');if(document.activeElement!==sl)sl.value=ang;}
// Open the editor for a pixel near the click, clamped to stay on screen.
function openRyEd(pix,cx,cy){editPix=pix;if(!ryEd)buildRyEd();const r=(pix/cols|0),c=pix%cols;
  ryEd.querySelector('#ry-title').textContent='pixel ('+r+','+c+')';ryEd.style.display='block';syncRyEd();
  const w=ryEd.offsetWidth,h=ryEd.offsetHeight,pad=14;let x=cx+pad,y=cy-h-pad;
  if(x+w>innerWidth-8)x=cx-pad-w;if(x<8)x=8;if(y<8)y=cy+pad;if(y+h>innerHeight-8)y=innerHeight-8-h;
  ryEd.style.left=x+'px';ryEd.style.top=y+'px';}
// Close the editor.
function closeRyEd(){editPix=-1;if(ryEd)ryEd.style.display='none';}
// Pointer down on the circuit: open the RY editor if over a gate, else scrub.
ccv.addEventListener('pointerdown',e=>{
  const pix=ryGateAt(e.clientX,e.clientY);
  if(pix>=0){openRyEd(pix,e.clientX,e.clientY);e.preventDefault();return;}
  closeRyEd();circScrub=true;try{ccv.setPointerCapture(e.pointerId);}catch(_){}circuitScrub(e.clientX);e.preventDefault();});
ccv.addEventListener('pointermove',e=>{if(circScrub){circuitScrub(e.clientX);return;}ccv.style.cursor=ryGateAt(e.clientX,e.clientY)>=0?'pointer':'ew-resize';});
ccv.addEventListener('pointerup',()=>circScrub=false);
ccv.addEventListener('pointercancel',()=>circScrub=false);
ccv.style.cursor='ew-resize';

/* ===== RECON ===== */
// The reconstruction panel: the Target image as a cell grid, the
// Reconstruction grid beside it, and |error| on a wide panel. Under them is
// the register tape: the N measured pixels in index order |i⟩. After the
// shots, each tape cell moves on an eased arc to its (row, col) cell, so the
// readout visibly reorganizes into the image. paintRecon draws on any 2D
// context: #recon-cv on the page, the saver image panel (hud) in the saver.
const rcv=document.getElementById('recon-cv'),rctx=rcv.getContext('2d');
let rSize='';
// Size #recon-cv to its body (only when the size changes) and paint it.
function drawRecon(){
  const body=document.getElementById('recon-body'),W=body.clientWidth,H=body.clientHeight,dpr=Math.min(2,devicePixelRatio||1);
  if(W<2||H<2)return;
  const key=W+'x'+H+'@'+dpr;
  if(key!==rSize){rSize=key;rcv.width=W*dpr;rcv.height=H*dpr;rcv.style.width=W+'px';rcv.style.height=H+'px';}
  rctx.setTransform(dpr,0,0,dpr,0,0);rctx.clearRect(0,0,W,H);
  paintRecon(rctx,W,H,{err:W>=520,fs:reconTypeScale(W)});
}
// Grey level of an intensity as a CSS colour.
const grey=v=>{v=Math.max(0,Math.min(255,Math.round(v)));return `rgb(${v},${v},${v})`;};
const SLOT='rgb(20,26,38)',LINE='rgba(150,200,255,0.26)';
// Paint the panel in a W×H box. o.err adds the |error| panel; o.fs scales
// the type; o.idle is the footer text before a run. Layout, top to bottom: titles, grids, tape label, tape, footer.
function paintRecon(ctx,W,H,o){
  const n=N(),ph=reconPhase(),rec=measured?measured.vest:null,P=o.err?3:2,fs=o.fs||1;
  const titleH=16*fs,footH=24*fs,tlabH=15*fs,gapY=10*fs,padX=12*fs,gap=Math.max(12*fs,W*0.025);
  const tc=tapeCols(n,cols),tl=Math.ceil(n/tc),availH=H-titleH-footH-tlabH-gapY*2;
  let tcell=Math.min((W-padX*2)/tc,availH*0.24/tl);
  const cell=Math.max(2,Math.floor(Math.min((W-padX*2-gap*(P-1))/(P*cols),(availH-tcell*tl)/rows)));
  tcell=Math.max(1.5,Math.min(tcell,cell));
  const pw=cell*cols,phh=cell*rows,totalW=P*pw+gap*(P-1),tw=tc*tcell,tapeH=tcell*tl;
  const top=Math.max(0,(H-(titleH+phh+gapY+tlabH+tapeH+gapY+footH))/2);
  const x0=(W-totalW)/2,y0=top+titleH,tx0=(W-tw)/2,ty0=y0+phh+gapY+tlabH;
  const gl=cell>=5?1:0,tg=tcell>=5?1:0,px=p=>x0+p*(pw+gap);
  const font=(w,sz)=>`${w} ${Math.round(sz*fs)}px ui-monospace, Menlo, monospace`;
  // Flight progress per pixel (0 = on the tape, 1 = in its grid cell).
  const u=new Float32Array(n);
  if(ph.kind==='flight')for(let i=0;i<n;i++)u[i]=flightU(i,n,ph.A.flightMs,ph.tf);
  else if(ph.kind==='done')u.fill(1);
  // Grid back: the line colour shows through a 1 px gap round each cell, so
  // every cell boundary is visible.
  const back=x=>{ctx.fillStyle=LINE;ctx.fillRect(x-1,y0-1,pw+(gl?1:2),phh+(gl?1:2));};
  // Titles
  let maxE=0,mae=0;if(rec&&ph.kind==='done'){for(let i=0;i<n;i++){const e=Math.abs(img[i]-rec[i]);mae+=e;if(e>maxE)maxE=e;}mae/=n;}
  const titles=['Target · '+rows+'×'+cols,ph.kind==='done'?'Reconstruction · '+measured.shots+' shots':ph.kind==='flight'?'Reconstruction · building':'Reconstruction','|error|'];
  ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.font=font(500,9);
  for(let p=0;p<P;p++){ctx.fillStyle=p===0?'rgba(150,200,255,0.9)':p===1?'rgba(255,185,72,0.9)':'rgba(90,140,192,0.85)';ctx.fillText(titles[p],px(p)+pw/2,y0-6*fs);}
  // Target grid
  back(px(0));
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){ctx.fillStyle=grey(img[r*cols+c]);ctx.fillRect(px(0)+c*cell,y0+r*cell,cell-gl,cell-gl);}
  // Reconstruction grid: a cell shows its value once its flight has landed.
  back(px(1));
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const i=r*cols+c;ctx.fillStyle=(rec&&u[i]>=1)?grey(rec[i]):SLOT;ctx.fillRect(px(1)+c*cell,y0+r*cell,cell-gl,cell-gl);}
  if(ph.kind==='done'&&measured.per&&showShotLabels&&cell>=14*fs){
    ctx.font=font(600,Math.max(7,cell*0.30/fs));ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=Math.max(2,cell*0.11);
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const i=r*cols+c,s=String(Math.round(measured.per[i])),cx=px(1)+c*cell+(cell-gl)/2,cy=y0+r*cell+(cell-gl)/2;
      ctx.strokeStyle='rgba(6,9,15,0.92)';ctx.strokeText(s,cx,cy);ctx.fillStyle='rgba(214,221,234,0.96)';ctx.fillText(s,cx,cy);}
    ctx.textBaseline='alphabetic';}
  // Error grid
  if(P===3){back(px(2));
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const i=r*cols+c;let f=SLOT;
      if(rec&&ph.kind==='done'){const t=maxE>0?Math.abs(img[i]-rec[i])/maxE:0;f=`rgb(${Math.round(20+t*200)},${Math.round(20+t*10)},${Math.round(28+t*10)})`;}
      ctx.fillStyle=f;ctx.fillRect(px(2)+c*cell,y0+r*cell,cell-gl,cell-gl);}}
  // Register tape: the measured pixels in index order.
  ctx.textAlign='left';ctx.font=font(500,9);ctx.fillStyle='rgba(128,144,176,0.9)';
  ctx.fillText(tl>1?`measured |i⟩, i = 0 … ${n-1}, ${tc} per line`:`measured |i⟩, i = 0 … ${n-1}`,tx0,ty0-5*fs);
  const tapeAt=i=>({x:tx0+(i%tc)*tcell,y:ty0+Math.floor(i/tc)*tcell});
  for(let i=0;i<n;i++){const t=tapeAt(i);let f=SLOT;
    if(rec&&ph.kind==='sample'&&measured.per[i]>0)f=grey(rec[i]);
    else if(rec&&ph.kind==='flight'&&u[i]<=0)f=grey(rec[i]);
    else if(u[i]>0)f='rgba(20,26,38,0.55)';
    ctx.fillStyle=f;ctx.fillRect(t.x,t.y,tcell-tg,tcell-tg);
    if(ph.kind==='sample'&&ph.A.pix[i]>0.05&&tcell>=3){ctx.strokeStyle=`rgba(255,185,72,${(ph.A.pix[i]*0.9).toFixed(3)})`;ctx.lineWidth=1;ctx.strokeRect(t.x+0.5,t.y+0.5,tcell-tg-1,tcell-tg-1);}}
  // Cells in flight, drawn over everything: tape cell → grid cell.
  if(ph.kind==='flight'){const ts=tcell-tg,gs=cell-gl;
    for(let i=0;i<n;i++){if(u[i]<=0||u[i]>=1)continue;const t=tapeAt(i),r=Math.floor(i/cols),c=i%cols;
      const q=flightPos(u[i],{x:t.x+ts/2,y:t.y+ts/2,s:ts},{x:px(1)+c*cell+gs/2,y:y0+r*cell+gs/2,s:gs});
      ctx.fillStyle=grey(rec[i]);ctx.fillRect(q.x-q.s/2,q.y-q.s/2,q.s,q.s);
      if(q.s>=3){ctx.strokeStyle=`rgba(255,185,72,${(0.85*Math.sin(Math.PI*u[i])).toFixed(3)})`;ctx.lineWidth=1;ctx.strokeRect(q.x-q.s/2+0.5,q.y-q.s/2+0.5,q.s-1,q.s-1);}}}
  // Footer line
  ctx.textAlign='center';const fy=ty0+tapeH+gapY+footH*0.62;
  if(ph.kind==='done'){ctx.fillStyle='rgba(255,185,72,0.95)';ctx.font=font(600,11);ctx.fillText(`MAE ${mae.toFixed(2)} · ${decodeMode==='frqi'?'arcsin√P₁':'linear P₁'}`,W/2,fy);}
  else if(ph.kind==='sample'){ctx.fillStyle='rgba(255,185,72,0.85)';ctx.font=font(500,10);ctx.fillText(`${ph.A.drawn} of ${ph.A.shots} shots`,W/2,fy);}
  else if(ph.kind==='flight'){ctx.fillStyle='rgba(255,185,72,0.85)';ctx.font=font(500,10);ctx.fillText('each |i⟩ moves to its cell (row, col)',W/2,fy);}
  else{ctx.fillStyle='rgba(128,144,176,0.8)';ctx.font=font(400,10);ctx.fillText(o.idle||'Sample to reconstruct →',W/2,fy);}
}

/* ===== ORCHESTRATION ===== */
// Repaint everything after a state change: readout, field, stack, circuit, recon.
function renderAll(){updateReadout();drawField();buildStack();drawCircuit();drawRecon();}
// Fill the side-panel register readout (image size, pixels, qubits, ρ size, gates).
function updateReadout(){const n=N(),k=nPos;let nz=0;for(let i=0;i<n;i++)if(img[i]>0.5)nz++;
  document.getElementById('readout').innerHTML=
    `<div><span class="rk">image</span><span class="rv">${rows}×${cols}</span></div>`+
    `<div><span class="rk">pixels (N)</span><span class="rv">${n}</span></div>`+
    `<div><span class="rk">position qubits</span><span class="rv">${k}</span></div>`+
    `<div><span class="rk">total qubits</span><span class="rv amb">${k+1}</span></div>`+
    `<div><span class="rk">ρ size</span><span class="rv">${2*n}×${2*n}</span></div>`+
    `<div><span class="rk">RY gates</span><span class="rv">${nz}</span></div>`;
}
// Change the position-qubit count (even only), which resizes the square grid,
// regenerates the current preset, and rebuilds the whole scene.
function setPos(p){
  p=Math.max(POS_MIN,Math.min(POS_MAX,p));if(p&1)p++;                 // even only
  nPos=p;side=1<<(p/2);rows=side;cols=side;
  document.getElementById('q-pos').textContent=nPos;
  document.getElementById('q-side').textContent=side;document.getElementById('q-side2').textContent=side;
  document.getElementById('q-total').textContent=nPos+1;
  document.getElementById('q-dn').disabled=nPos<=POS_MIN;document.getElementById('q-up').disabled=nPos>=POS_MAX;
  const act=document.querySelector('.preset-btn.active');img=makePreset(act?act.dataset.preset:'cross');rebuildAmpFromImg();measured=null;stackStage=0;stopPlay();stopSampling();renderAll();
}
// Position-qubit steppers (± 2 to stay even).
document.getElementById('q-up').addEventListener('click',()=>setPos(nPos+2));
document.getElementById('q-dn').addEventListener('click',()=>setPos(nPos-2));
// Clear the preset highlight once the image is edited by hand.
function markCustom(){document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));}
// Preset buttons load a generated test image and rebuild the scene.
document.querySelectorAll('.preset-btn').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');img=makePreset(b.dataset.preset);rebuildAmpFromImg();measured=null;stopSampling();renderAll();}));
// Shots slider: set the shot count and repaint its fill.
const shots=document.getElementById('shots');shots.addEventListener('input',()=>{document.getElementById('shots-v').textContent=shots.value;shots.style.setProperty('--pct',((shots.value-64)/19936*100)+'%');});
// Time slider: seconds of shots before the flight (0.3 to 4 s). It sets
// the next run; a run in progress keeps its own time.
const stime=document.getElementById('stime');stime.addEventListener('input',()=>{document.getElementById('stime-v').textContent=(+stime.value).toFixed(1)+'s';stime.style.setProperty('--pct',((stime.value-0.3)/3.7*100)+'%');});
// Heat threshold: hide dim ρ cells; rebuilding the tower re-applies the cut.
const thr=document.getElementById('thresh');thr.addEventListener('input',()=>{threshold=+thr.value;document.getElementById('thresh-v').textContent=threshold.toFixed(2);thr.style.setProperty('--pct',(threshold/0.5*100)+'%');builtStage=-1;layerEndArr=[];buildStackUpTo(totalLayers-1);setStage(stackStage);});
// Toggle the per-pixel spin-percentage labels on the source grid.
const spinBtn=document.getElementById('spin-toggle');spinBtn.addEventListener('click',()=>{spinLabels=!spinLabels;spinBtn.classList.toggle('active',spinLabels);spinBtn.innerHTML='Spin&nbsp;% labels: '+(spinLabels?'on':'off');drawField();});
// Update the field module's ρ-mode tag glyph.
function setTag(){const m={mag:'|ρ|',phase:'∠ρ',real:'Re ρ'};document.getElementById('field-tag').textContent=m[colorMode];}
// ρ colour mode buttons: rebuild the tower so cell colours follow the new mode.
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-mode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');colorMode=b.dataset.mode;setTag();drawField();builtStage=-1;layerEndArr=[];buildStackUpTo(totalLayers-1);setStage(stackStage);}));
// Toggle per-pixel shot-count labels on the reconstruction.
document.getElementById('show-labels').addEventListener('change',e=>{showShotLabels=e.target.checked;drawRecon();});
// Decode-mode buttons: re-decode any current sampling with the new map.
document.querySelectorAll('[data-decode]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-decode]').forEach(x=>x.classList.remove('active'));b.classList.add('active');decodeMode=b.dataset.decode;if(sampleAnim)reconFromSampling(sampleAnim);drawRecon();}));
// Quantum-op buttons apply a gate to the encoded state.
document.querySelectorAll('[data-xform]').forEach(b=>b.addEventListener('click',()=>applyXform(b.dataset.xform)));
// Start a sampling run.
document.getElementById('run-shots').addEventListener('click',runSampling);
// Stack transport controls: first, prev, play, next, last.
document.getElementById('st-first').addEventListener('click',()=>stepStack(-totalLayers));
document.getElementById('st-last').addEventListener('click',()=>{stopPlay();stopSampling();setStage(totalLayers-1);});
document.getElementById('st-prev').addEventListener('click',()=>stepStack(-1));
document.getElementById('st-next').addEventListener('click',()=>stepStack(1));
document.getElementById('st-play').addEventListener('click',playStack);

/* ===== PHONE DOCK ===== */
// The dock shows on phones only (style.css). Controls opens or closes the
// panel sheet. Play and Sample press the stack and reconstruction buttons,
// and Sample closes the sheet, so the run is in view.
const dockPanel=document.getElementById('dock-panel'),panelEl=document.getElementById('panel');
function setSheet(open){panelEl.classList.toggle('open',open);dockPanel.classList.toggle('on',open);dockPanel.setAttribute('aria-expanded',String(open));}
dockPanel.addEventListener('click',()=>setSheet(!panelEl.classList.contains('open')));
document.getElementById('dock-play').addEventListener('click',()=>document.getElementById('st-play').click());
document.getElementById('dock-sample').addEventListener('click',()=>{setSheet(false);document.getElementById('run-shots').click();document.getElementById('m-recon').scrollIntoView({behavior:'smooth',block:'start'});});

// Build the colour-map picker: one gradient-swatch button per map in CMAPS.
function buildCmapButtons(){const grid=document.getElementById('cmap-grid');grid.innerHTML='';
  Object.keys(CMAPS).forEach(name=>{const btn=document.createElement('button');btn.className='cmap-btn'+(CMAPS[name]===ACTIVE_HEAT?' active':'');
    const cv=document.createElement('canvas');cv.width=60;cv.height=18;const g=cv.getContext('2d');const H=CMAPS[name];
    for(let x=0;x<60;x++){g.fillStyle=rgb(rampSample(H,x/59));g.fillRect(x,0,1,18);}
    btn.appendChild(cv);const l=document.createElement('span');l.className='cl';l.textContent=name.slice(0,4);btn.appendChild(l);
    btn.addEventListener('click',()=>{ACTIVE_HEAT=CMAPS[name];document.querySelectorAll('.cmap-btn').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
      drawField();builtStage=-1;layerEndArr=[];buildStackUpTo(totalLayers-1);setStage(stackStage);});
    grid.appendChild(btn);});}
// Sample an arbitrary colour map at v (used to paint the swatch previews).
const rampSample=(H,v)=>{v=clamp01(v);const s=v*(H.length-1),i=Math.min(Math.floor(s),H.length-2),t=s-i;return lerp3(H[i],H[i+1],t);};
// Show the FRQI state equation: static MathJax SVG from equation.js
// (typeset.mjs writes it). No math library loads at run time.
function renderEquation(){document.getElementById('eq-main').innerHTML=EQ_STATE;}

// Redraw the affected module whenever its body resizes.
const ro=new ResizeObserver(entries=>{for(const e of entries){const id=e.target.id;
  if(id==='field-body')drawField();else if(id==='stack-gl-wrap'){resizeGL();drawScore();}else if(id==='circuit-body')drawCircuit();else if(id==='recon-body')drawRecon();}});
['field-body','stack-gl-wrap','circuit-body','recon-body'].forEach(id=>ro.observe(document.getElementById(id)));
addEventListener('resize',drawScore);

// Seed the slider fills, build the colour picker, and start the scene at 4
// position qubits (a 4×4 image). setPos triggers the first full render.
shots.style.setProperty('--pct',((4000-64)/19936*100)+'%');stime.style.setProperty('--pct',((1.2-0.3)/3.7*100)+'%');thr.style.setProperty('--pct','0%');
buildCmapButtons();setTag();renderEquation();initGL();setPos(4);

/* ===== SCREENSAVER ===== */
// The plate for opts.label (the shell draws it at the lower right). All facts
// are live page state: the preset, nPos, N(), the slab label that simulate()
// wrote for stackStage, the gate count (nPos H + one controlled-RY for each
// lit pixel), and during sampling the shots drawn and the MAE that drawRecon
// also shows. One title for each image, so a call swaps the text in place.
const supN=v=>String(v).replace(/\d/g,c=>'⁰¹²³⁴⁵⁶⁷⁸⁹'[c]);
function stepText(lbl){
  if(lbl==='init')return 'start state |'+initBasis.toString(2).padStart(nPos+1,'0')+'⟩';
  if(/^H q/.test(lbl))return 'Hadamard on position qubit '+lbl.slice(3);
  if(/^RY ×/.test(lbl))return lbl.slice(4)+' controlled-RY(2θᵢ) gates, grouped in one slab';
  if(/^RY [01]+$/.test(lbl))return 'controlled-RY(2θᵢ) on the color qubit, pixel |'+lbl.slice(3)+'⟩';
  return lbl;
}
// params, the page's TeX (typeset.mjs) and its classes: theta_i m2, |0> m1,
// |1> and P_1 m5, |i> m3. eq is the plain fallback. The hook adds the anchor.
function saverPlate(){
  const n=N(),k=nPos,act=document.querySelector('.preset-btn.active');
  const params=[
    {sym:'N',name:'pixels, '+side+' × '+side,value:String(n)},
    {sym:'n',name:'qubits, '+k+' + 1 color',value:String(k+1)},
    {sym:'G',name:'gates, H + controlled-RY',value:k+' + '+activePix.length},
  ];
  const lines=[];
  const A=sampleAnim;
  if(A){
    let mae=0;const rec=measured&&measured.vest;
    if(rec){for(let i=0;i<n;i++)mae+=Math.abs(img[i]-rec[i]);mae/=n;}
    params.push({sym:'S',name:'shots drawn',value:A.drawn+' of '+A.shots});
    if(rec)params.push({sym:'\\varepsilon',name:'mean abs. error',value:mae.toFixed(2)});
    const k=reconPhase().kind;
    lines.push(k==='sample'?'Sampling the final state.':k==='flight'?'Each measured pixel |i⟩ moves to its cell.':'Reconstruction beside the target grid.');
  }else lines.push('Step '+stackStage+' of '+(totalLayers-1)+': '+stepText(layerLabel[stackStage]||''));
  const dec=decodeMode==='frqi'?'P_1(i) = \\sin^2\\theta_i, \\qquad \\text{pixel}_i = \\frac{510}{\\pi}\\arcsin\\sqrt{P_1}'
    :'\\text{pixel}_i \\approx 255\\,P_1(i)';
  return {
    title:'FRQI image: '+(act?act.textContent.trim():'custom'),
    sub:'Flexible representation of quantum images',
    params,lines,
    tex:['|\\varphi\\rangle=\\frac{1}{\\sqrt{N}}\\sum_{i=0}^{N-1}\\bigl(\\cos\\theta_i\\,|0\\rangle+\\sin\\theta_i\\,|1\\rangle\\bigr)\\otimes|i\\rangle',
      '\\theta_i = \\frac{\\text{pixel}_i}{255}\\cdot\\frac{\\pi}{2}',dec,
      '\\rho = |\\varphi\\rangle\\langle\\varphi|'],
    rules:[['\\theta_i','m2'],['|0\\rangle','m1'],['|1\\rangle','m5'],['P_1','m5'],['|i\\rangle','m3']],
    eq:[
      '|I⟩ = (1/√N) Σᵢ (cos θᵢ|0⟩ + sin θᵢ|1⟩) ⊗ |i⟩',
      'i = 0 … '+(n-1)+',  1/√N = 1/2'+supN(k/2)+' = 1/'+Math.round(Math.sqrt(n)),
      'θᵢ = (pixelᵢ / 255) · π/2',
      decodeMode==='frqi'?'P₁(i) = sin²θᵢ,  pixelᵢ = (510/π) arcsin√P₁':'pixelᵢ ≈ 255 · P₁(i)  (linear decode)',
      'ρ = |I⟩⟨I|,  cell height |ρ_rc| = |c_r||c_c|',
    ],
  };
}
// The rho stack on screen, for the shell's label plate. In grp space the
// cells span x, z in +-DIM PITCH / 2, and the slabs rise along +y by
// LAYER_GAP up to the current stage (plus BARMAX while sampling). The 8 box
// corners and two slab centres go through grp.matrixWorld and the camera to
// canvas px: the centre of their screen box, a radius that holds every
// corner, and the first and the current slab as key points.
const _av=new THREE.Vector3();
function stackAnchor(){
  if(!glReady||!grp)return null;
  const b=renderer.domElement.getBoundingClientRect(),h=DIM*PITCH/2;
  const L=sampleAnim?sampleAnim.layer+1:stackStage+1,top=L*LAYER_GAP+(sampleAnim?BARMAX:CUBE);
  grp.updateMatrixWorld();
  const P=(x,y,z)=>{_av.set(x,y,z).applyMatrix4(grp.matrixWorld).project(camera);
    return _av.z>1?null:{x:b.left+(_av.x+1)/2*b.width,y:b.top+(1-_av.y)/2*b.height};};
  const c=[];for(const x of [-h,h])for(const y of [0,top])for(const z of [-h,h]){const q=P(x,y,z);if(q)c.push(q);}
  if(!c.length)return null;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const q of c){x0=Math.min(x0,q.x);x1=Math.max(x1,q.x);y0=Math.min(y0,q.y);y1=Math.max(y1,q.y);}
  const cx=(x0+x1)/2,cy=(y0+y1)/2;let r=0;for(const q of c)r=Math.max(r,Math.hypot(q.x-cx,q.y-cy));
  const pts=[P(0,CUBE/2,0),P(0,(L-1)*LAYER_GAP+CUBE/2,0)].filter(Boolean);
  return {x:cx,y:cy,r,pts};
}

// The saver image panel: paintRecon draws into an off-screen 2D canvas, and
// a plane in its own orthographic scene shows that canvas over the GL frame
// after the bloom pass. So the recorded canvas (#stack-gl) holds the target
// grid and the flight, in tab capture and in paint mode. hud.rect is in CSS
// px; the canvas is redrawn every frame of a run and once on hud.dirty.
function ensureHud(){if(hud)return hud;
  const cv=document.createElement('canvas'),mat=new THREE.MeshBasicMaterial({transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),mat),scene2=new THREE.Scene();scene2.add(mesh);
  hud={cv,ctx:cv.getContext('2d'),tex:null,mat,mesh,scene:scene2,cam:new THREE.OrthographicCamera(-1,1,1,-1,-1,1),rect:null,dpr:1,fs:1,dirty:true,fade:()=>0};
  return hud;}
// Place the panel at rect (CSS px) in a W×H frame. A new canvas size needs a
// new texture, so the old one is disposed.
function hudPlace(rect,W,H){const h=ensureHud(),d=Math.min(1.5,devicePixelRatio||1);
  h.rect=rect;h.dpr=d;h.fs=Math.max(1,Math.min(2.2,rect.h/300));
  h.cv.width=Math.max(2,Math.round(rect.w*d));h.cv.height=Math.max(2,Math.round(rect.h*d));
  if(h.tex)h.tex.dispose();h.tex=new THREE.CanvasTexture(h.cv);h.tex.colorSpace=THREE.SRGBColorSpace;h.tex.minFilter=THREE.LinearFilter;h.tex.generateMipmaps=false;
  h.mat.map=h.tex;h.mat.needsUpdate=true;
  h.cam.left=-W/2;h.cam.right=W/2;h.cam.top=H/2;h.cam.bottom=-H/2;h.cam.updateProjectionMatrix();
  h.mesh.scale.set(rect.w,rect.h,1);h.mesh.position.set(rect.x+rect.w/2-W/2,H/2-(rect.y+rect.h/2),0);h.dirty=true;}
// Draw the panel over the frame (called by animateGL after composer.render).
// Its opacity follows the saver fade, so it fades with the scene.
function hudRender(){if(!hud||!hud.rect||!hud.tex)return;
  if((sampleAnim&&!sampleAnim.done)||hud.dirty){hud.dirty=false;const c=hud.ctx,d=hud.dpr;
    c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,hud.rect.w,hud.rect.h);paintRecon(c,hud.rect.w,hud.rect.h,{err:false,fs:hud.fs,idle:'the circuit builds |φ⟩, then shots'});hud.tex.needsUpdate=true;}
  hud.mat.opacity=1-hud.fade();
  renderer.autoClear=false;renderer.render(hud.scene,hud.cam);renderer.autoClear=true;}
// Split the clear band between the label plate's top and bottom text
// (plateBand, lib/saver-clear.js) into a stack part and an image part. Wide
// frame: stack left, images right. Tall frame: stack above, images below.
// A view offset moves the tower centre into its part, and camZoom moves
// the camera back so the tower fits. Called on each image change (under the
// fade) and on resize.
let bandFn=null;
function saverLayout(){if(!saverOn||!glReady)return;
  const W=innerWidth,H=innerHeight,band=bandFn?bandFn(H):null;
  const t=band?band.t:H*0.2,b=band?band.b:H*0.26,mid=Math.max(H*0.3,H-t-b);
  let rect,cx,cy,partH;
  if(W>=H*1.05){rect={x:W*0.53,y:t,w:W*0.43,h:mid};cx=W*0.28;cy=t+mid/2;partH=mid;}
  else{const hh=mid*0.5;rect={x:W*0.04,y:t+mid-hh,w:W*0.92,h:hh};cx=W/2;cy=t+(mid-hh)/2;partH=mid-hh;}
  camZoom=Math.max(1,Math.min(3,H/partH*0.9));
  camera.setViewOffset(W,H,W/2-cx,H/2-cy,W,H);hudPlace(rect,W,H);}

// Hook for the shell screensaver (lib/screensaver.js). It moves #stack-gl-wrap
// to <body> and hides all other content, so the rho stack fills the window
// through resizeGL (the ResizeObserver calls it). Each image runs in order:
// the circuit builds the tower one slab at a time, the final state is
// sampled (the histogram grows), and then each measured pixel moves from the
// register tape into the reconstruction grid beside the target grid (the
// saver image panel). saverPlan (frqi-core.js) sets the times: an image is
// finished at most 8.2 s after its fade-in, and then holds. A full-screen
// quad in the scene fades to the background colour across each image
// change, so the recorded canvas has no hard cut. opts.calm (1 = slowest)
// sets the spin and the pace; opts.seed sets the order of the images. No
// exit(): the shell reloads the page on stop.
window.snSaver={enter(o={}){
  const calm=Math.max(0,Math.min(1,o.calm??0.7)),secs=Math.max(20,+o.seconds||60);
  let r=(o.seed>>>0)||1;const rnd=()=>(r=(r*1664525+1013904223)>>>0)/4294967296;
  const wrap=document.getElementById('stack-gl-wrap');document.body.appendChild(wrap);
  const st=document.createElement('style');
  st.textContent='body>*:not(#stack-gl-wrap){display:none!important}#stack-gl-wrap>*:not(#stack-gl){display:none!important}'+
    '#stack-gl-wrap{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:1}#stack-gl{cursor:none!important}';
  document.head.appendChild(st);
  saverOn=true;import('../../lib/saver-clear.js').then(m=>{bandFn=m.plateBand;}).catch(()=>{/* no band */});
  resizeGL();
  controls.autoRotate=true;controls.autoRotateSpeed=0.5*(1-0.5*calm);
  const fadeMat=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,uniforms:{a:{value:1}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:'uniform float a;void main(){gl_FragColor=vec4(0.0392,0.051,0.0784,a);}'});
  const fadeQ=new THREE.Mesh(new THREE.PlaneGeometry(2,2),fadeMat);fadeQ.frustumCulled=false;fadeQ.renderOrder=9999;scene.add(fadeQ);
  ensureHud().fade=()=>fadeMat.uniforms.a.value;
  const names=['cross','gradient','checker','phantom','rings'];
  for(let i=names.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[names[i],names[j]]=[names[j],names[i]];}
  const cycle=Math.max(12,secs/3)*1000,fadeMs=(0.7+1.0*calm)*1000;
  const wait=ms=>new Promise(res=>setTimeout(res,ms));
  // Resolve when test() is true (checked each 100 ms) or after maxMs.
  const until=(test,maxMs)=>new Promise(res=>{const t0=performance.now();const k=()=>{if(test()||performance.now()-t0>maxMs)res();else setTimeout(k,100);};k();});
  const fadeTo=to=>new Promise(res=>{const from=fadeMat.uniforms.a.value,t0=performance.now();
    const step=now=>{const k=Math.min(1,(now-t0)/fadeMs);fadeMat.uniforms.a.value=from+(to-from)*k*k*(3-2*k);if(k<1)requestAnimationFrame(step);else res();};
    requestAnimationFrame(step);});
  let n=0;
  (async function run(){
    for(;;){
      // image change, layout and reframe, under the fade
      const b=document.querySelector('.preset-btn[data-preset="'+names[n++%names.length]+'"]');
      stopSampling();b.click();setStage(0);saverLayout();frameCamera(true);
      const plan=saverPlan(calm,totalLayers);
      await fadeTo(0);
      const t0=performance.now();
      // build: one slab per step
      while(stackStage<totalLayers-1){await wait(plan.stepMs);setStage(stackStage+1);}
      await wait(plan.holdMs);
      // sample, then the flight into the image; the camera already has room
      runSampling({sampleMs:plan.sampleMs,flightMs:plan.flightMs,reframe:false});
      await until(()=>!sampleAnim||sampleAnim.done,plan.sampleMs+plan.flightMs+2000);
      // hold the finished image for the rest of the cycle
      await wait(Math.max(2500,cycle-2*fadeMs-(performance.now()-t0)));
      await fadeTo(1);
    }
  })();
  // Plate: at most one call each second, and only when the text changes.
  // run() has already clicked the first preset, so the first plate names it.
  if(typeof o.label==='function'){let last='';
    // The anchor is null while the fade quad hides the scene.
    const anchor=()=>(fadeMat.uniforms.a.value>0.5?null:stackAnchor());
    const tick=()=>{const p=saverPlate(),j=JSON.stringify(p);if(j!==last){last=j;p.anchor=anchor;o.label(p);}};
    tick();setInterval(tick,1000);}
  return {canvas:document.getElementById('stack-gl'),warmupMs:fadeMs+500};
}};
