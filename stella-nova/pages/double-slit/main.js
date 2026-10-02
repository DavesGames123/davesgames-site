// ============================================================================
//  DOUBLE-SLIT DIFFRACTION  ·  2D FDTD scalar-wave interference sim
// ----------------------------------------------------------------------------
//  Three independent scalar wave fields (one per colour channel) march
//  forward in time on a 2D grid with a finite-difference time-domain (FDTD)
//  leapfrog scheme. A plane wave from the left meets a barrier with one to
//  three slits. The waves from the slits overlap and interfere. The screen
//  column near the right edge shows the time-averaged intensity <ψ²>.
//
//  WAVE EQUATION   (per channel, lossy medium)
//  --------------------------------------------------------------------------
//      ∂²ψ/∂t² + σ·∂ψ/∂t = c²∇²ψ
//    leapfrog discretization actually stepped in step():
//      ψ(n+1) = ca·(2ψ(n) + α²∇²ψ(n)) − cb·ψ(n−1)
//      α = c·dt/dx   Courant number; the scheme is stable only while α ≤ 1/√2
//      ca = 1/(1+σΔt/2) ,  cb = (1−σΔt/2)/(1+σΔt/2)     from conductivity σ
//    The retention per step (P.dissipation) adds a uniform σ (buildDamping).
//
//  UNITS
//  --------------------------------------------------------------------------
//    1 cell = CELL_NM = 17.7 nm (532 nm is 30 cells). The light sliders
//    are in nm, the slit sliders in cells shown as µm. One step is
//    α·CELL_NM/c, about 0.03 fs at α = 0.5.
//
//  DOMAIN LAYOUT   (grid NX×NY, x increases to the right)
//  --------------------------------------------------------------------------
//      x=0   sourceX      barrierX·NX         screenX = 0.78·NX     NX−1
//       │ PML  │ plane     │ slit barrier        ║ screen column     │
//       │      │ wave ▶ ▶  │  ┌─┐ ═══▶ fringes   ║  <ψ²> profile     │
//       │      │           │  └─┘                ║ absorber ramp     │
//       │   PML ramp wraps all four edges (quartic σ)                │
//
//  FRAME PIPELINE
//  --------------------------------------------------------------------------
//      loop() ─ step() ×P.spf     advance the three fields; planeSource() drives
//             │                   the left column when P.plane is on
//             ├ accumI()          move the <ψ²> average of every cell
//             ├ autoRef()         exposure reference from the diffraction zone
//             ├ render()          fields → spectral RGB through a tone curve
//             └ drawProfile()     the screen <ψ²> with axes and fringe marks
//      drawFx() redraws the source, slit and screen marks and the scale bar
//      when the geometry or the size changes.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      units ............... "const CELL_NM"          nm and µm per cell
//      spectral colour ..... "function specRGB"       wavelength → RGB
//      field buffers ....... "let NX"                 triple buffer per channel
//      parameters .......... "const P ="              every tunable parameter
//      grid init ........... "function init"          allocate buffers to size
//      PML damping ......... "function buildDamping"  absorbing-boundary coeffs
//      barrier ............. "function buildBarrier"  slit geometry into a mask
//      brush ............... "function applyBrush"    paint source / wall / erase
//      plane source ........ "function planeSource"   line source at sourceX()
//      FDTD step ........... "function step"          the leapfrog update
//      intensity average ... "function accumI"        <ψ²> per cell, screenX()
//      exposure ............ "function autoRef"       robust reference levels
//      field render ........ "function render"        fields → pixels
//      overlay marks ....... "function drawFx"        labels, scale bar
//      fringe rows ......... "function fringeRows"    exact r₂ − r₁ = mλ rows
//      screen profile ...... "function drawProfile"   <ψ²> plot with axes
//      control wiring ...... "function bindRange"     sliders → P
//      main loop ........... "function loop"          requestAnimationFrame driver
//      saver detector ...... "function drawDetector"  summed I(y) into the field canvas
//      screensaver hook .... "window.snSaver"         lib/screensaver.js mode
// ============================================================================

// ── units and colour ────────────────────────────────────────────────────────
const CELL_NM = 532 / 30;                 // nm per grid cell
const C_FS_PER_STEP = a => a * CELL_NM * 1e-9 / 2.998e8 * 1e15;
const um = cells => (cells * CELL_NM / 1000);

// Wavelength (nm) to linear RGB in 0..1, after Bruton's piecewise fit, with
// the fall-off of eye response at the ends of the visible band. The channel
// colour of each wave is the colour of its wavelength.
function specRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = (440 - nm) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
  else { r = 1; }
  const f = nm < 420 ? 0.35 + 0.65 * (nm - 380) / 40 : nm > 700 ? 0.35 + 0.65 * (750 - nm) / 50 : 1;
  return [r * f, g * f, b * f].map(v => Math.pow(Math.max(0, v), 0.8));
}
const cssRGB = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;

// ── canvases ────────────────────────────────────────────────────────────────
// The field is drawn at grid size and scaled by the browser (smooth). The
// overlay and the profile are drawn at device pixels.
const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');
const fxC = document.getElementById('fxCanvas');
const fx = fxC.getContext('2d');
const profC = document.getElementById('profileCanvas');
const pctx = profC.getContext('2d');
const $ = id => document.getElementById(id);

// Grid dimensions and the per-channel field buffers. Each channel keeps three
// time slices (u = now, up = previous, un = next) for the leapfrog update.
// barrier/userWalls are masks; caArr/cbArr are the lossy-medium coefficients.
let NX, NY, N;
let u = [null,null,null];
let up = [null,null,null];
let un = [null,null,null];
let barrier, userWalls, caArr, cbArr;
let imgData;
// Time-averaged intensity <ψ²> per cell and channel (an exponential moving
// average over about 1.5 periods). The Intensity view and the screen profile
// read it, so the fringes show without the flicker of the instant ψ².
let Iavg = [null,null,null];
const I_RATE = 1 / 96;
let simTime = 0, stepN = 0;
let paused = false;
let fCount = 0, lastFT = performance.now(), fps = 0, frameN = 0;

// Every tunable parameter in one object the UI writes into. lamNm are the
// channel wavelengths in nm; lambdaR/G/B are the same in cells (step() reads
// them). dt is the Courant number α. slitSep and slitW are in grid cells;
// barrierX is a fraction of the width. expo is the exposure in stops.
const P = {
  lamNm: [650, 532, 450],
  lambdaR: 650 / CELL_NM, lambdaG: 532 / CELL_NM, lambdaB: 450 / CELL_NM,
  chOn: [true, true, true],
  slitW: 20, slitSep: 111, barrierX: 0.30, slitMode: 'double',
  dt: 0.50, amp: 1.0, pml: 30, gain: 1.0,
  disp: 'amplitude',
  brushR: 6, srcMode: 'impulse',
  scale: 2,
  dissipation: 1.000,   // retention per step (1 = lossless away from the PML)
  plane: true,   // continuous plane wave from the left edge (on at load)
  spf: 2,        // FDTD steps per animation frame
  expo: 0,       // exposure in stops around the auto reference
};
let COL = P.lamNm.map(specRGB);

// (Re)allocate every buffer to match the field size and the cell size. The
// grid resolution is the CSS size divided by P.scale. Called at start, on a
// size change and on a cell-size change.
let displayW, displayH;
function init() {
  const r = canvas.parentElement.getBoundingClientRect();
  displayW = Math.max(40, Math.floor(r.width));
  displayH = Math.max(40, Math.floor(r.height));
  NX = Math.floor(displayW / P.scale);
  NY = Math.floor(displayH / P.scale);
  canvas.width = NX;
  canvas.height = NY;
  N = NX * NY;
  for (let c = 0; c < 3; c++) {
    u[c]  = new Float32Array(N);
    up[c] = new Float32Array(N);
    un[c] = new Float32Array(N);
    Iavg[c] = new Float32Array(N);
  }
  barrier = new Uint8Array(N);
  userWalls = new Uint8Array(N);
  caArr = new Float32Array(N);
  cbArr = new Float32Array(N);
  imgData = ctx.createImageData(NX, NY);
  const d = imgData.data;
  // Fill the alpha byte of every pixel once so later frames only touch RGB.
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  simTime = 0; stepN = 0; refA = [[0,0],[0,0],[0,0]]; refI = [[0,0],[0,0],[0,0]];
  buildDamping(); buildBarrier(); sizeOverlays();
  $('og').textContent = `${NX}×${NY}`;
}

function buildDamping() {
  // Proper PML: conductivity σ ramps smoothly from 0 to σ_max
  // ca = 1/(1 + σΔt/2),  cb = (1 - σΔt/2)/(1 + σΔt/2)
  // When σ=0: ca=1, cb=1 (lossless)
  // When σΔt/2=1: ca=0.5, cb=0 (heavy absorption, no memory of previous step)
  const pml = 40;
  const sigMax = 2.0; // σΔt/2 at boundary edge (strong absorption)
  const absorbStart = Math.floor(NX * 0.78);
  const absorbLen = Math.max(1, NX - absorbStart);
  // The retention r per step is a uniform σ: the amplitude per step is
  // √cb = r when σΔt/2 = (1 − r²)/(1 + r²). This loss changes the phase
  // speed only to second order. (Multiplying the whole update by r made the
  // amplitude per step √r and shifted the wavelength to first order: at
  // r = 0.995, a 30-cell wave ran 40.6 cells long.)
  const r2 = P.dissipation * P.dissipation, sig0 = (1 - r2) / (1 + r2);
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const i = y * NX + x;
    const dL = x, dR = NX-1-x, dT = y, dB = NY-1-y;
    const mn = Math.min(dL, dR, dT, dB);
    let sig = 0; // σΔt/2
    // Quartic ramp into PML — smooth impedance transition
    if (mn < pml) { const t = (pml - mn) / pml; sig = sigMax * t * t * t * t; }
    // Right-side detector absorber wall
    if (x > absorbStart) {
      const t = (x - absorbStart) / absorbLen;
      sig = Math.max(sig, sigMax * t * t * t);
    }
    sig += sig0;
    caArr[i] = 1.0 / (1.0 + sig);
    cbArr[i] = (1.0 - sig) / (1.0 + sig);
  }
}

// Rebuild the barrier mask from the current slit settings. Start from the walls
// the user painted, draw a solid vertical wall at barrierX, then carve the slit
// openings back out. One, two, or three slit centers depend on slitMode; each
// opening is slitW cells tall, centered and spaced by slitSep.
function buildBarrier() {
  barrier.set(userWalls);
  if (P.slitMode === 'none') return;
  const bx = Math.floor(NX * P.barrierX), cy = Math.floor(NY / 2), thick = 3;
  for (let t = 0; t < thick; t++) { const x = bx + t; if (x < 0 || x >= NX) continue; for (let y = 0; y < NY; y++) barrier[y * NX + x] = 1; }
  let centers = [];
  if (P.slitMode === 'single') centers = [cy];
  else if (P.slitMode === 'double') centers = [cy - Math.floor(P.slitSep/2), cy + Math.floor(P.slitSep/2)];
  else if (P.slitMode === 'triple') centers = [cy - P.slitSep, cy, cy + P.slitSep];
  const hw = Math.floor(P.slitW / 2);
  for (const sc of centers) for (let t = 0; t < thick; t++) { const x = bx + t; if (x < 0 || x >= NX) continue; for (let dy = -hw; dy <= hw; dy++) { const y = sc + dy; if (y >= 0 && y < NY && !userWalls[y * NX + x]) barrier[y * NX + x] = 0; } }
}

// Pointer state: whether a drag is active, the last grid cell touched, and a
// random per-drag amplitude per channel so successive strokes vary in strength.
let mDown = false, mX = 0, mY = 0;
let sineChAmp = [1, 1, 1];

// Map a pointer event to a clamped grid cell. Scales client pixels through the
// canvas rectangle into [0, NX) × [0, NY).
function gp(e) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(NX-1, Math.floor((e.clientX - r.left) / r.width * NX))), y: Math.max(0, Math.min(NY-1, Math.floor((e.clientY - r.top) / r.height * NY))) };
}

// Paint into the field at a grid cell using the active source mode. 'wall' and
// 'erase' edit the userWalls mask; 'impulse' injects a soft radial bump into
// each enabled channel, with a linear falloff to the brush edge. (Continuous
// 'sine' injection is handled inside step(), not here.)
function applyBrush(gx, gy) {
  const r = P.brushR, r2 = r * r;
  if (P.srcMode === 'wall') {
    for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) { if(dx*dx+dy*dy>r2) continue; const x=gx+dx,y=gy+dy; if(x<0||x>=NX||y<0||y>=NY) continue; const i=y*NX+x; userWalls[i]=1;barrier[i]=1; for(let c=0;c<3;c++){u[c][i]=0;up[c][i]=0;} }
  } else if (P.srcMode === 'erase') {
    for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) { if(dx*dx+dy*dy>r2) continue; const x=gx+dx,y=gy+dy; if(x<0||x>=NX||y<0||y>=NY) continue; userWalls[y*NX+x]=0; }
    buildBarrier();
  } else if (P.srcMode === 'impulse') {
    const chAmp=[P.chOn[0]?(0.4+Math.random()*0.6):0,P.chOn[1]?(0.4+Math.random()*0.6):0,P.chOn[2]?(0.4+Math.random()*0.6):0];
    for (let c=0;c<3;c++) { if(!chAmp[c]) continue; for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) { const d2=dx*dx+dy*dy; if(d2>r2) continue; const x=gx+dx,y=gy+dy; if(x<0||x>=NX||y<0||y>=NY) continue; const i=y*NX+x; if(!barrier[i]){const falloff=1-Math.sqrt(d2)/r;u[c][i]+=P.amp*chAmp[c]*falloff*1.5;} } }
  }
}

// Mouse drawing. On press pick fresh per-channel amplitudes, then paint. On drag
// walk a Bresenham line between the last cell and the current one so fast strokes
// leave no gaps. Wheel adjusts the brush radius.
canvas.addEventListener('mousedown',e=>{mDown=true;sineChAmp=[0.4+Math.random()*0.6,0.4+Math.random()*0.6,0.4+Math.random()*0.6];const p=gp(e);mX=p.x;mY=p.y;if(P.srcMode!=='sine')applyBrush(p.x,p.y);});
canvas.addEventListener('mousemove',e=>{if(!mDown)return;const p=gp(e);if(P.srcMode!=='sine'){let cx=mX,cy=mY;const dx=Math.abs(p.x-cx),dy=Math.abs(p.y-cy),sx=cx<p.x?1:-1,sy=cy<p.y?1:-1;let err=dx-dy;while(true){applyBrush(cx,cy);if(cx===p.x&&cy===p.y)break;const e2=2*err;if(e2>-dy){err-=dy;cx+=sx;}if(e2<dx){err+=dx;cy+=sy;}}}mX=p.x;mY=p.y;});
canvas.addEventListener('mouseup',()=>{mDown=false;});
canvas.addEventListener('mouseleave',()=>{mDown=false;});
canvas.addEventListener('wheel',e=>{e.preventDefault();P.brushR=Math.max(1,Math.min(30,P.brushR+(e.deltaY>0?-1:1)));document.getElementById('sl-br').value=P.brushR;document.getElementById('val-br').textContent=P.brushR;},{passive:false});

// Touch drawing mirrors the mouse handlers for phones and tablets.
canvas.addEventListener('touchstart',e=>{e.preventDefault();mDown=true;sineChAmp=[0.4+Math.random()*0.6,0.4+Math.random()*0.6,0.4+Math.random()*0.6];const p=gp(e.touches[0]);mX=p.x;mY=p.y;if(P.srcMode!=='sine')applyBrush(p.x,p.y);},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!mDown)return;const p=gp(e.touches[0]);if(P.srcMode!=='sine')applyBrush(p.x,p.y);mX=p.x;mY=p.y;},{passive:false});
canvas.addEventListener('touchend',()=>{mDown=false;});

// Plane-wave source: a soft line source on one column near the left edge.
// It adds A·sin(ωt) each step, so a plane wave runs right to the barrier
// and its left half dies in the PML. The amplitude ramps in over two
// periods (no step shock) and tapers over 48 cells at the top and bottom,
// so the ends of the line do not send out their own circular waves.
function sourceX(){return Math.max(2,Math.min(44,Math.floor(NX*P.barrierX)-12));}
function planeSource(uc,c,omega){
  const sx=sourceX(),T=2*Math.PI/omega,ramp=Math.min(1,simTime/(2*T));
  const a=0.12*ramp*Math.sin(omega*simTime);
  if(!a)return;
  for(let y=1;y<NY-1;y++){const e=Math.min(1,Math.min(y,NY-1-y)/48);uc[y*NX+sx]+=a*e*e*(3-2*e);}
}

// Advance all three fields one FDTD tick. Per channel: inject continuous sine
// forcing if that mode is held, apply the leapfrog stencil across the interior,
// hard-zero the edges, then rotate the three buffers so next becomes current.
// alpha2 is α² (the squared Courant number) reused for every cell.
function step() {
  const nx=NX,ny=NY,alpha2=P.dt*P.dt,lambdas=[P.lambdaR,P.lambdaG,P.lambdaB];
  for (let c=0;c<3;c++) {
    if(!P.chOn[c]) continue;
    // A wave moves α cells per step, so one period of a wave λ cells long
    // is λ/α steps: ω = 2πα/λ per step. (ω = 2π/λ gave waves α·λ long.)
    const uc=u[c],upc=up[c],unc=un[c],omega=2*Math.PI*P.dt/lambdas[c];
    if(P.plane) planeSource(uc,c,omega);
    if(mDown&&P.srcMode==='sine'){const r=P.brushR,r2=r*r,sv=P.amp*sineChAmp[c]*Math.sin(omega*simTime);for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){const d2=dx*dx+dy*dy;if(d2>r2)continue;const x=mX+dx,y=mY+dy;if(x<0||x>=nx||y<0||y>=ny)continue;const i=y*nx+x;if(!barrier[i]){const falloff=1-Math.sqrt(d2)/r;uc[i]+=sv*0.4*falloff;}}}
    // Interior FDTD: lossy medium formulation (the retention is in ca/cb)
    // ψ(n+1) = ca * (2ψ(n) + α²∇²ψ) - cb * ψ(n-1)
    for(let y=1;y<ny-1;y++){const yo=y*nx;for(let x=1;x<nx-1;x++){const i=yo+x;if(barrier[i]){unc[i]=0;continue;}const lap=uc[i-1]+uc[i+1]+uc[i-nx]+uc[i+nx]-4*uc[i];unc[i]=caArr[i]*(2*uc[i]+alpha2*lap)-cbArr[i]*upc[i];}}
    // Hard zero all edge cells
    for(let x=0;x<nx;x++){unc[x]=0;unc[(ny-1)*nx+x]=0;}
    for(let y=0;y<ny;y++){unc[y*nx]=0;unc[y*nx+nx-1]=0;}
    // Rotate the triple buffer without copying: the old current becomes the new
    // previous, the freshly written next becomes current, and the old previous
    // is recycled as scratch for the next tick.
    up[c]=uc;u[c]=unc;un[c]=upc;
  }
  simTime+=1;stepN++;
}

// Intensity average: move <ψ²> of every cell toward the instant ψ² by I_RATE.
// The screen profile is this average down the column x ≈ 0.78·NX.
function screenX(){return Math.min(NX-5,Math.floor(NX*0.78));}
function accumI(){for(let c=0;c<3;c++){if(!P.chOn[c])continue;const uc=u[c],ia=Iavg[c];for(let i=0;i<N;i++){const v=uc[i];ia[i]+=(v*v-ia[i])*I_RATE;}}}

// ── exposure ────────────────────────────────────────────────────────────────
// Each channel has its own reference levels in two zones: the incident zone
// (left of the barrier) and the diffraction zone (barrier to the right
// edge). The incident wave is far stronger than the light past the slits,
// so one shared level would burn the left side white or hide the fringes.
// A strided sample gives the 99th percentile of |ψ| and of <ψ²> per zone.
// The values are smoothed, and the diffraction level never drops below 4 %
// of the incident level, so an empty zone does not blow up noise.
let refA = [[0,0],[0,0],[0,0]], refI = [[0,0],[0,0],[0,0]];   // [channel][zone]
const SMP = 30000, sA = [0,1,2].map(() => new Float32Array(SMP)), sI = [0,1,2].map(() => new Float32Array(SMP));
function pct(a, n, q) { const s = a.subarray(0, n).sort(); return s[Math.min(n - 1, Math.floor(n * q))] || 0; }
function zoneRef(x0, x1, y0, y1, st) {
  const out = [];
  for (let c = 0; c < 3; c++) {
    let n = 0; const ua = u[c], ia = Iavg[c];
    for (let y = y0; y < y1; y += st) for (let x = x0; x < x1 && n < SMP; x += st) { const i = y * NX + x, v = ua[i]; sA[c][n] = v < 0 ? -v : v; sI[c][n++] = ia[i]; }
    out.push(n ? [pct(sA[c], n, 0.99), pct(sI[c], n, 0.99)] : [0, 0]);
  }
  return out;
}
const ease = (r, v) => r ? r + (v - r) * 0.25 : v;
function autoRef() {
  const bx = Math.floor(NX * P.barrierX), sx = sourceX();
  // A narrow field leaves a thin incident zone; then sample all of it.
  const ix0 = sx + 3, ix1 = Math.max(ix0 + 2, bx - 3);
  const inc = zoneRef(ix0, ix1, 40, NY - 40, 3), dif = zoneRef(bx + 6, NX - 4, 2, NY - 2, 4);
  for (let c = 0; c < 3; c++) {
    const ai = Math.max(inc[c][0], 1e-5), ii = Math.max(inc[c][1], 1e-10);
    refA[c][0] = ease(refA[c][0], ai); refI[c][0] = ease(refI[c][0], ii);
    refA[c][1] = ease(refA[c][1], Math.max(dif[c][0], 0.04 * ai)); refI[c][1] = ease(refI[c][1], Math.max(dif[c][1], 0.0016 * ii));
  }
}

// Tone curve 1 − e^(−k·v) as a lookup over v in [0, 8): soft shoulder, no
// hard clip. k = 1.4 · 2^expo.
const TONE = new Float32Array(1024);
function buildTone() { const k = 1.4 * Math.pow(2, P.expo); for (let i = 0; i < 1024; i++) TONE[i] = 1 - Math.exp(-k * i / 128); }
buildTone();

// ── field render ────────────────────────────────────────────────────────────
// Map the fields to canvas pixels. Each channel gives a level t in 0..1 from
// the tone curve, against the reference of its zone (incident or diffracted),
// and the pixel is Σ t·colour(λ) on a dark ground.
//   Wave       |ψ| / refA[c][zone]
//   Intensity  <ψ²> / refI[c][zone]
//   Phase      amplitude from ψ and its previous slice, times (1 + cos φ)/2
// Barrier cells are drawn last: slit walls in slate, painted walls in blue.
function render(){
  const d=imgData.data,disp=P.disp,on=P.chOn,bx=Math.floor(NX*P.barrierX)+3;
  const c0=COL[0],c1=COL[1],c2=COL[2],ref=disp==='intensity'?refI:refA;
  const k=[0,1].map(z=>[0,1,2].map(c=>128/(ref[c][z]||1)));
  const tone=v=>{v=v|0;return TONE[v>1023?1023:v];};
  for(let y=0;y<NY;y++){const row=y*NX;for(let x=0;x<NX;x++){
    const i=row+x,kz=k[x<bx?0:1];let t0=0,t1=0,t2=0;
    if(disp==='amplitude'){
      if(on[0])t0=tone(Math.abs(u[0][i])*kz[0]);
      if(on[1])t1=tone(Math.abs(u[1][i])*kz[1]);
      if(on[2])t2=tone(Math.abs(u[2][i])*kz[2]);
    }else if(disp==='intensity'){
      if(on[0])t0=tone(Iavg[0][i]*kz[0]);
      if(on[1])t1=tone(Iavg[1][i]*kz[1]);
      if(on[2])t2=tone(Iavg[2][i]*kz[2]);
    }else{
      for(let c=0;c<3;c++){if(!on[c])continue;const v=u[c][i],vp=up[c][i];const t=tone(Math.sqrt(v*v+vp*vp)*kz[c])*(0.5+0.5*Math.cos(Math.atan2(v,vp)));if(c===0)t0=t;else if(c===1)t1=t;else t2=t;}
    }
    const p=i*4;
    const r=5+250*(t0*c0[0]+t1*c1[0]+t2*c2[0]);
    const g=7+248*(t0*c0[1]+t1*c1[1]+t2*c2[1]);
    const b=11+244*(t0*c0[2]+t1*c1[2]+t2*c2[2]);
    d[p]=r>255?255:r;d[p+1]=g>255?255:g;d[p+2]=b>255?255:b;
  }}
  for(let i=0;i<N;i++){if(barrier[i]){const p=i*4;if(userWalls[i]){d[p]=110;d[p+1]=160;d[p+2]=220;}else{d[p]=128;d[p+1]=142;d[p+2]=168;}}}
  ctx.putImageData(imgData,0,0);
}

// ── overlays ────────────────────────────────────────────────────────────────
// Size the overlay and profile canvases to device pixels. Called from init().
let DPR = 1;
function sizeOverlays(){
  DPR=Math.min(2,window.devicePixelRatio||1);
  const fr=fxC.getBoundingClientRect();fxC.width=Math.round(fr.width*DPR);fxC.height=Math.round(fr.height*DPR);
  const pr=profC.getBoundingClientRect();profC.width=Math.max(1,Math.round(pr.width*DPR));profC.height=Math.max(1,Math.round(pr.height*DPR));
  drawFx();
}
// Source, slit and screen marks, and a 1 µm scale bar. Redrawn when the
// geometry or the size changes, not every frame.
function drawFx(){
  const W=fxC.width,H=fxC.height,s=W/NX;fx.clearRect(0,0,W,H);
  fx.font=`500 ${11*DPR}px Inter, system-ui, sans-serif`;fx.textBaseline='top';
  const mark=(x,label,dash,alpha)=>{fx.strokeStyle=`rgba(200,220,245,${alpha})`;fx.lineWidth=DPR;fx.setLineDash(dash.map(v=>v*DPR));fx.beginPath();fx.moveTo(x,0);fx.lineTo(x,H);fx.stroke();fx.setLineDash([]);fx.fillStyle='rgba(200,220,245,0.62)';fx.fillText(label,x+6*DPR,10*DPR);};
  const slitPx=(Math.floor(NX*P.barrierX)+4)*s;
  if(P.plane){const x=(sourceX()+0.5)*s;mark(x,slitPx-x>70*DPR?'Source':'',[2,5],0.22);}
  if(P.slitMode!=='none'){fx.fillStyle='rgba(200,220,245,0.62)';fx.fillText('Slits',slitPx+6*DPR,10*DPR);}
  mark((screenX()+0.5)*s,'Screen',[6,5],0.45);
  // scale bar, bottom right
  const L=1000/CELL_NM*s,x1=W-14*DPR,x0=x1-L,y=H-16*DPR;
  fx.strokeStyle='rgba(230,240,252,0.75)';fx.lineWidth=1.5*DPR;fx.beginPath();fx.moveTo(x0,y-4*DPR);fx.lineTo(x0,y);fx.lineTo(x1,y);fx.lineTo(x1,y-4*DPR);fx.stroke();
  fx.fillStyle='rgba(230,240,252,0.8)';fx.textAlign='center';fx.fillText('1 µm',(x0+x1)/2,y-16*DPR);fx.textAlign='left';
}

// Rows (in cells) of the bright fringes on the screen for one channel, from
// the exact path difference r₂ − r₁ = mλ of the slit centres. A triple slit
// has its principal maxima at the same rows as a pair of spacing d. Single
// slit and no slit give none.
function fringeRows(lam){
  if(P.slitMode!=='double'&&P.slitMode!=='triple')return [];
  const cy=Math.floor(NY/2),h=P.slitMode==='double'?Math.floor(P.slitSep/2):P.slitSep/2;
  const xb=Math.floor(NX*P.barrierX)+1.5,L=screenX()-xb;if(L<=0)return [];
  const f=y=>Math.hypot(L,y-(cy-h))-Math.hypot(L,y-(cy+h));
  const out=[{m:0,y:cy}];
  for(let m=1;m<12;m++){const t=m*lam;if(f(NY-1)<t)break;let lo=cy,hi=NY-1;for(let k=0;k<40;k++){const mid=(lo+hi)/2;if(f(mid)<t)lo=mid;else hi=mid;}const y=(lo+hi)/2;out.push({m,y},{m:-m,y:2*cy-y});}
  return out.filter(r=>r.y>=0&&r.y<NY);
}

// The screen profile: <ψ²> down the screen column per channel, each channel
// scaled to its own peak (so the fringe rows of a weak colour still read),
// drawn as filled curves (additive) on a y axis in µm from
// the centre line. Marks on the left edge give the bright-fringe rows.
function drawProfile(){
  const W=profC.width,H=profC.height,sx=screenX();
  pctx.clearRect(0,0,W,H);
  const padL=30*DPR,padR=8*DPR,pw=W-padL-padR,yOf=gy=>(gy+0.5)/NY*H;
  // axes: y ticks every 0.5, 1 or 2 µm
  const cy=Math.floor(NY/2),spanUm=um(NY/2),stepUm=spanUm>6?2:spanUm>2.5?1:0.5;
  pctx.font=`500 ${9.5*DPR}px ui-monospace, "SF Mono", Menlo, monospace`;pctx.textBaseline='middle';pctx.textAlign='right';
  for(let v=-Math.floor(spanUm/stepUm)*stepUm;v<=spanUm;v+=stepUm){
    const y=yOf(cy+v*1000/CELL_NM);if(y<8*DPR||y>H-8*DPR)continue;
    pctx.fillStyle=v===0?'rgba(150,200,255,0.16)':'rgba(150,200,255,0.07)';pctx.fillRect(padL,y,pw,DPR);
    pctx.fillStyle='rgba(170,190,215,0.6)';pctx.fillText((v>0?'+':'')+(Math.abs(v)<1e-9?'0':v.toFixed(stepUm<1?1:0)),padL-5*DPR,y);
  }
  pctx.textAlign='left';pctx.fillStyle='rgba(170,190,215,0.6)';pctx.fillText('µm',4*DPR,H-10*DPR);
  {
    pctx.globalCompositeOperation='lighter';
    for(let c=0;c<3;c++){if(!P.chOn[c])continue;const col=COL[c],ia=Iavg[c];
      let maxI=0;for(let y=0;y<NY;y++){const v=ia[y*NX+sx];if(v>maxI)maxI=v;}if(!(maxI>0))continue;
      pctx.beginPath();pctx.moveTo(padL,0);
      for(let py=0;py<=H;py+=DPR){const gy=Math.min(NY-1,Math.floor(py/H*NY));pctx.lineTo(padL+pw*ia[gy*NX+sx]/maxI,py);}
      pctx.lineTo(padL,H);pctx.closePath();
      pctx.fillStyle=`rgba(${col.map(v=>Math.round(v*255)).join(',')},0.16)`;pctx.fill();
      pctx.beginPath();for(let py=0;py<=H;py+=DPR){const gy=Math.min(NY-1,Math.floor(py/H*NY));const x=padL+pw*ia[gy*NX+sx]/maxI;if(py===0)pctx.moveTo(x,py);else pctx.lineTo(x,py);}
      pctx.strokeStyle=cssRGB(col);pctx.lineWidth=1.25*DPR;pctx.stroke();}
    pctx.globalCompositeOperation='source-over';
  }
  // fringe marks: one short tick per channel; m labels for the first channel on
  let first=-1;
  for(let c=0;c<3;c++){if(!P.chOn[c])continue;if(first<0)first=c;
    for(const r of fringeRows(P.lamNm[c]/CELL_NM)){const y=yOf(r.y);pctx.fillStyle=cssRGB(COL[c]);pctx.fillRect(padL-1*DPR+c*3*DPR,y-0.5*DPR,3*DPR,DPR*1.5);
      if(c===first&&W>110*DPR&&Math.abs(r.m)<=3&&y>16*DPR&&y<H-34*DPR){pctx.fillStyle='rgba(230,240,252,0.7)';pctx.textAlign='left';pctx.fillText('m='+r.m,W-padR-34*DPR,y);}}}
}

// ── controls ────────────────────────────────────────────────────────────────
// Each range slider shows its fill through --fill. bindRange binds one slider
// to a setter and a readout format, and runs once to set the start state.
function setFill(sl){sl.style.setProperty('--fill',((sl.value-sl.min)/(sl.max-sl.min)*100)+'%');}
function bindRange(id,outId,set,fmt){const sl=$(id),o=$(outId);const run=()=>{const v=Number(sl.value);set(v);o.textContent=fmt(v);setFill(sl);};sl.addEventListener('input',run);run();}
const LAM_KEYS=['lambdaR','lambdaG','lambdaB'];
function setLam(c,nm){P.lamNm[c]=nm;P[LAM_KEYS[c]]=nm/CELL_NM;COL[c]=specRGB(nm);const row=document.querySelector(`.chan[data-ch="${c}"]`);row.style.setProperty('--sw',cssRGB(COL[c]));}
[['sl-lr','val-lr'],['sl-lg','val-lg'],['sl-lb','val-lb']].forEach(([s,o],c)=>bindRange(s,o,v=>setLam(c,v),v=>v+' nm'));
const geom=()=>{buildBarrier();drawFx();};
bindRange('sl-sw','val-sw',v=>{P.slitW=v;if(NX)geom();},v=>um(v).toFixed(2)+' µm');
bindRange('sl-ss','val-ss',v=>{P.slitSep=v;if(NX)geom();},v=>um(v).toFixed(2)+' µm');
bindRange('sl-bx','val-bx',v=>{P.barrierX=v;if(NX)geom();},v=>Math.round(v*100)+' %');
bindRange('sl-exp','val-exp',v=>{P.expo=v;buildTone();},v=>(v>0?'+':'')+v.toFixed(1)+' EV');
bindRange('sl-br','val-br',v=>{P.brushR=v;},v=>String(v));
bindRange('sl-dt','val-dt',v=>{P.dt=v;},v=>v.toFixed(2));
bindRange('sl-diss','val-diss',v=>{P.dissipation=v;if(NX)buildDamping();},v=>v.toFixed(3));
bindRange('sl-spf','val-spf',v=>{P.spf=v;},v=>String(v));
bindRange('sl-scale','val-scale',v=>{if(P.scale!==v){P.scale=v;if(NX)init();}},v=>v+' px');

// Channel swatches: each one turns its wave on or off.
function setChan(c,on){P.chOn[c]=on;const b=$(['tog-r','tog-g','tog-b'][c]);b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);document.querySelector(`.chan[data-ch="${c}"]`).classList.toggle('off',!on);if(!on){u[c].fill(0);up[c].fill(0);un[c].fill(0);Iavg[c].fill(0);}}
['tog-r','tog-g','tog-b'].forEach((id,c)=>$(id).addEventListener('click',()=>setChan(c,!P.chOn[c])));
function setSlider(id,v){const sl=$(id);sl.value=v;sl.dispatchEvent(new Event('input'));}
$('preset-rgb').addEventListener('click',()=>{setSlider('sl-lr',650);setSlider('sl-lg',532);setSlider('sl-lb',450);[0,1,2].forEach(c=>setChan(c,true));});
$('preset-mono').addEventListener('click',()=>{setSlider('sl-lg',532);setChan(0,false);setChan(1,true);setChan(2,false);});
$('btn-plane').addEventListener('click',function(){P.plane=!P.plane;this.classList.toggle('on',P.plane);this.setAttribute('aria-pressed',P.plane);drawFx();});

// Segmented groups (slit mode, view, brush): one button on at a time.
function wireGroup(sel,key,cb){document.querySelectorAll(sel).forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll(sel).forEach(b=>b.classList.remove('on'));btn.classList.add('on');P[key]=btn.dataset[Object.keys(btn.dataset)[0]];if(cb)cb();}));}
wireGroup('[data-slits]','slitMode',geom);wireGroup('[data-disp]','disp');wireGroup('[data-src]','srcMode');

// Transport: pause (also the space key), reset the fields, clear the walls.
function setPaused(p){paused=p;const b=$('btn-pause');b.textContent=p?'Play':'Pause';b.classList.toggle('on',p);}
$('btn-pause').addEventListener('click',()=>setPaused(!paused));
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.closest('input,button')){e.preventDefault();setPaused(!paused);}});
$('btn-reset').addEventListener('click',()=>{for(let c=0;c<3;c++){u[c].fill(0);up[c].fill(0);un[c].fill(0);Iavg[c].fill(0);}simTime=0;stepN=0;refA=[[0,0],[0,0],[0,0]];refI=[[0,0],[0,0],[0,0]];});
$('btn-clr').addEventListener('click',()=>{userWalls.fill(0);buildBarrier();});

// The equations start folded on a phone, where the field needs the room.
if(matchMedia('(max-width:760px) and (orientation:portrait)').matches)$('eqs').open=false;

// ── main loop ───────────────────────────────────────────────────────────────
// Advance the sim (P.spf steps) unless paused, refresh the exposure every 6
// frames, render the field each frame and the profile every 3rd frame.
function loop(){
  fCount++;frameN++;const now=performance.now();
  if(now-lastFT>500){fps=Math.round(fCount/((now-lastFT)/1000));fCount=0;lastFT=now;$('ofps').textContent=fps+' fps';}
  if(!paused)for(let k=0;k<P.spf;k++){step();accumI();}
  if(frameN%6===1)autoRef();
  render();if(saverOn)drawDetector();else if(frameN%3===0)drawProfile();
  $('ot').textContent=(simTime*C_FS_PER_STEP(P.dt)).toFixed(1);
  $('os').textContent=stepN;
  requestAnimationFrame(loop);
}

// Re-grid when the field changes size (window resize, phone rotation).
// A change of under 2 cells keeps the running field.
new ResizeObserver(()=>{clearTimeout(window._rt);window._rt=setTimeout(()=>{const r=canvas.parentElement.getBoundingClientRect();if(Math.abs(Math.floor(r.width/P.scale)-NX)>1||Math.abs(Math.floor(r.height/P.scale)-NY)>1)init();else sizeOverlays();},150);}).observe($('field'));

// Test hook for headless checks: the live state, read only by convention.
window.__ds={get P(){return P},get u(){return u},get Iavg(){return Iavg},get NX(){return NX},get NY(){return NY},get step(){return stepN},get refA(){return refA},get refI(){return refI},screenX:()=>screenX(),sourceX:()=>sourceX(),fringeRows:l=>fringeRows(l)};

// Saver detector. In saver mode the profile panel is hidden, so the field
// canvas itself carries the result: the strip right of the screen column
// becomes a detector. drawDetector() runs after render() each frame and
// writes into waveCanvas (grid px), so a recording keeps it.
//   film   a band of the summed colour Σ COL[c]·<ψ²>c, as a photo plate sees it
//   curve  the summed intensity I(y) = Σ <ψ²>c, scaled to its peak, filled
//   theory the Fraunhofer sum of cos²β·sinc²α (or the 3-slit factor) per
//          channel, dashed, with sin θ = Y/√(Y² + L²) for the large angles
// Geometry in cells: d = 2·⌊sep/2⌋ (double) or sep (triple), a = 2·⌊w/2⌋ + 1,
// L = screenX() − (⌊NX·barrierX⌋ + 1.5), the same L that fringeRows() uses.
let saverOn=false,saverTimer=0;
function slitGeom(){
  const d=P.slitMode==='double'?2*Math.floor(P.slitSep/2):P.slitSep,a=2*Math.floor(P.slitW/2)+1;
  const L=screenX()-(Math.floor(NX*P.barrierX)+1.5);
  return {d,a,L};
}
function theoryI(Y,lam,g){
  const s=Y/Math.hypot(g.L,Y),be=Math.PI*g.d*s/lam,al=Math.PI*g.a*s/lam;
  const sinc=Math.abs(al)<1e-6?1:Math.sin(al)/al;
  let f;
  if(P.slitMode==='triple'){const sb=Math.sin(be);f=Math.abs(sb)<1e-6?1:Math.sin(3*be)/(3*sb);}
  else f=Math.cos(be);
  return f*f*sinc*sinc;
}
function drawDetector(){
  const sx=screenX(),x0=sx+1,w=NX-x0;if(w<12)return;
  const cy=Math.floor(NY/2),g=slitGeom(),on=P.chOn;
  const bw=Math.max(4,Math.round(w*0.2)),cx0=x0+bw+3,cw=NX-3-cx0;
  ctx.fillStyle='rgb(6,9,14)';ctx.fillRect(x0,0,w,NY);
  ctx.fillStyle='rgba(200,220,245,0.55)';ctx.fillRect(sx,0,1,NY);
  // summed intensity per row, and its peak
  const tot=new Float32Array(NY);let mx=0;
  for(let y=0;y<NY;y++){let t=0;for(let c=0;c<3;c++)if(on[c])t+=Iavg[c][y*NX+sx];tot[y]=t;if(t>mx)mx=t;}
  if(!(mx>0))return;
  // film band: summed colour, square-root tone so the side orders show
  const img=ctx.createImageData(bw,NY),d=img.data;
  for(let y=0;y<NY;y++){
    let r=0,gg=0,b=0;
    for(let c=0;c<3;c++){if(!on[c])continue;const v=Math.sqrt(Iavg[c][y*NX+sx]/mx*3);r+=v*COL[c][0];gg+=v*COL[c][1];b+=v*COL[c][2];}
    for(let x=0;x<bw;x++){const p=(y*bw+x)*4;d[p]=Math.min(255,8+247*r);d[p+1]=Math.min(255,10+245*gg);d[p+2]=Math.min(255,14+241*b);d[p+3]=255;}
  }
  ctx.putImageData(img,x0,0);
  // the summed curve, filled from the left edge of the plot
  ctx.beginPath();ctx.moveTo(cx0,0);
  for(let y=0;y<NY;y++)ctx.lineTo(cx0+cw*tot[y]/mx,y+0.5);
  ctx.lineTo(cx0,NY);ctx.closePath();ctx.fillStyle='rgba(235,240,250,0.16)';ctx.fill();
  ctx.beginPath();for(let y=0;y<NY;y++){const x=cx0+cw*tot[y]/mx;if(y)ctx.lineTo(x,y+0.5);else ctx.moveTo(x,0.5);}
  ctx.strokeStyle='rgba(240,244,252,0.92)';ctx.lineWidth=1;ctx.stroke();
  // the Fraunhofer theory, summed over the channels that are on
  let n=0;for(let c=0;c<3;c++)if(on[c])n++;
  if(n&&P.slitMode!=='single'&&P.slitMode!=='none'&&g.L>0){
    ctx.beginPath();
    for(let y=0;y<NY;y++){let t=0;for(let c=0;c<3;c++)if(on[c])t+=theoryI(y-cy,P.lamNm[c]/CELL_NM,g);const x=cx0+cw*t/n;if(y)ctx.lineTo(x,y+0.5);else ctx.moveTo(x,0.5);}
    ctx.setLineDash([3,3]);ctx.strokeStyle='rgba(255,214,110,0.7)';ctx.stroke();ctx.setLineDash([]);
  }
  ctx.fillStyle='rgba(200,220,245,0.25)';ctx.fillRect(cx0,0,1,NY);
}
function saverPlate(label){
  if(!label)return;
  const g=slitGeom(),f=v=>v.toFixed(2),on=[0,1,2].filter(c=>P.chOn[c]);
  const lam=on.map(c=>P.lamNm[c]).join(' / ');
  const dy=on.map(c=>f(um(P.lamNm[c]/CELL_NM*g.L/g.d))).join(' / ');
  const tri=P.slitMode==='triple';
  label({
    title:tri?'Triple slit · summed intensity':'Double slit · summed intensity',
    sub:'detector strip at the right edge · white = Σ <ψ²>, dashed = theory',
    lines:['d = '+f(um(g.d))+' µm   a = '+f(um(g.a))+' µm','λ = '+lam+' nm','L = '+f(um(g.L))+' µm','fringe Δy = λL/d = '+dy+' µm','t = '+(simTime*C_FS_PER_STEP(P.dt)).toFixed(0)+' fs'],
    eq:tri?['I(y) ∝ [sin(3πdy/λL) / 3sin(πdy/λL)]² · sinc²(πay/λL)','I_total(y) = Σ_λ I_λ(y)']
          :['I(y) ∝ cos²(πdy/λL) · sinc²(πay/λL)','I_total(y) = Σ_λ I_λ(y)'],
  });
}

// Screensaver hook (lib/screensaver.js has the protocol). The CSS under
// html.sn-saver hides the panel, the profile and the overlays, so the field
// fills the frame. init() re-grids to that size, then the sim runs ahead
// under the shell's black cover until the fringes reach the screen column.
// calm 1 gives one step per frame. The seed picks the slit count and gap.
// saverOn makes loop() draw the detector strip (drawDetector) in place of
// the hidden profile panel. The plate gets d, a, λ, L once a second.
window.snSaver={async enter(o){
  const calm=o&&o.calm!=null?o.calm:0.7,seed=(o&&o.seed)>>>0;
  document.documentElement.classList.add('sn-saver');
  $('preset-rgb').click();setPaused(false);P.plane=true;P.disp='amplitude';P.expo=0;buildTone();
  P.slitMode=seed%4===3?'triple':'double';
  setSlider('sl-ss',P.slitMode==='triple'?[60,72,84][(seed>>2)%3]:[90,111,130,150][(seed>>2)%4]);
  setSlider('sl-spf',calm>=0.5?1:2);
  init();
  const need=(screenX()-sourceX())/P.dt+240,t0=performance.now();
  while(stepN<need&&performance.now()-t0<4000){for(let k=0;k<40;k++){step();accumI();}autoRef();await new Promise(r=>setTimeout(r,0));}
  for(let k=0;k<12;k++)autoRef();
  saverOn=true;
  const label=o&&o.labels!==false?o.label:null;
  clearInterval(saverTimer);saverPlate(label);saverTimer=setInterval(()=>saverPlate(label),1000);
  return {canvas,warmupMs:1000};
},exit(){saverOn=false;clearInterval(saverTimer);saverTimer=0;}};

// Boot: a narrow field (a phone) uses 1 px cells, so the 40-cell PML and
// the absorber do not take most of the grid. Then build the grid and start.
if($('field').getBoundingClientRect().width<600)setSlider('sl-scale',1);
init();loop();
