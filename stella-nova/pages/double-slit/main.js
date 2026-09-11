// Mobile drawer
function toggleDrawer(){
  const c=document.getElementById('controls'),f=document.getElementById('fab'),b=document.getElementById('drawer-bg');
  const open=!c.classList.contains('open');
  c.classList.toggle('open',open);f.classList.toggle('open',open);b.classList.toggle('show',open);
}
function closeDrawer(){
  document.getElementById('controls').classList.remove('open');
  document.getElementById('fab').classList.remove('open');
  document.getElementById('drawer-bg').classList.remove('show');
}

// ============================================================
//  FDTD 2D SCALAR WAVE — THREE INDEPENDENT RGB CHANNELS
//  ψ(n+1) = damping * dissipation * (2ψ(n) - ψ(n-1) + α²·∇²ψ(n))
//  α = c·dt/dx  (Courant number, stability requires α ≤ 1/√2)
//  Mur 1st-order ABC at edges + PML damping ramp
// ============================================================

const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');
const detC = document.getElementById('detectorCanvas');
const detCtx = detC.getContext('2d');

let NX, NY, N;
let u = [null,null,null];
let up = [null,null,null];
let un = [null,null,null];
let barrier, userWalls, caArr, cbArr;
let imgData;
let detAccum = [null,null,null];
let detCount = 0;
let simTime = 0, stepN = 0;
let paused = false;
let fCount = 0, lastFT = performance.now(), fps = 0;

const P = {
  lambdaR: 44, lambdaG: 32, lambdaB: 22,
  chOn: [true, true, true],
  slitW: 15, slitSep: 111, barrierX: 0.30, slitMode: 'double',
  dt: 0.50, amp: 1.0, pml: 30, gain: 1.0,
  disp: 'amplitude',
  brushR: 6, srcMode: 'impulse',
  scale: 2,
  dissipation: 0.995,
};

let displayW, displayH;
function init() {
  const r = canvas.parentElement.getBoundingClientRect();
  displayW = Math.floor(r.width);
  displayH = Math.floor(r.height);
  NX = Math.floor(displayW / P.scale);
  NY = Math.floor(displayH / P.scale);
  canvas.width = NX;
  canvas.height = NY;
  N = NX * NY;
  for (let c = 0; c < 3; c++) {
    u[c]  = new Float32Array(N);
    up[c] = new Float32Array(N);
    un[c] = new Float32Array(N);
    detAccum[c] = new Float64Array(NY);
  }
  barrier = new Uint8Array(N);
  userWalls = new Uint8Array(N);
  // Proper lossy medium: two coefficient arrays derived from conductivity σ
  // ∂²ψ/∂t² + σ·∂ψ/∂t = c²∇²ψ
  // Discretized: ψ(n+1) = ca*(2ψ(n) + α²∇²ψ) - cb*ψ(n-1)
  // where ca = 1/(1+σΔt/2),  cb = (1-σΔt/2)/(1+σΔt/2)
  caArr = new Float32Array(N); // coefficient for current term
  cbArr = new Float32Array(N); // coefficient for previous term
  imgData = ctx.createImageData(NX, NY);
  const d = imgData.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  detCount = 0; simTime = 0; stepN = 0;
  buildDamping(); buildBarrier(); resizeDetector();
  document.getElementById('og').textContent = `${NX}×${NY}`;
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
    caArr[i] = 1.0 / (1.0 + sig);
    cbArr[i] = (1.0 - sig) / (1.0 + sig);
  }
}

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

let mDown = false, mX = 0, mY = 0;
let sineChAmp = [1, 1, 1];

function gp(e) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(NX-1, Math.floor((e.clientX - r.left) / r.width * NX))), y: Math.max(0, Math.min(NY-1, Math.floor((e.clientY - r.top) / r.height * NY))) };
}

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

canvas.addEventListener('mousedown',e=>{mDown=true;sineChAmp=[0.4+Math.random()*0.6,0.4+Math.random()*0.6,0.4+Math.random()*0.6];const p=gp(e);mX=p.x;mY=p.y;if(P.srcMode!=='sine')applyBrush(p.x,p.y);});
canvas.addEventListener('mousemove',e=>{if(!mDown)return;const p=gp(e);if(P.srcMode!=='sine'){let cx=mX,cy=mY;const dx=Math.abs(p.x-cx),dy=Math.abs(p.y-cy),sx=cx<p.x?1:-1,sy=cy<p.y?1:-1;let err=dx-dy;while(true){applyBrush(cx,cy);if(cx===p.x&&cy===p.y)break;const e2=2*err;if(e2>-dy){err-=dy;cx+=sx;}if(e2<dx){err+=dx;cy+=sy;}}}mX=p.x;mY=p.y;});
canvas.addEventListener('mouseup',()=>{mDown=false;});
canvas.addEventListener('mouseleave',()=>{mDown=false;});
canvas.addEventListener('wheel',e=>{e.preventDefault();P.brushR=Math.max(1,Math.min(30,P.brushR+(e.deltaY>0?-1:1)));document.getElementById('sl-br').value=P.brushR;document.getElementById('val-br').textContent=P.brushR;},{passive:false});

canvas.addEventListener('touchstart',e=>{e.preventDefault();mDown=true;sineChAmp=[0.4+Math.random()*0.6,0.4+Math.random()*0.6,0.4+Math.random()*0.6];const p=gp(e.touches[0]);mX=p.x;mY=p.y;if(P.srcMode!=='sine')applyBrush(p.x,p.y);},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!mDown)return;const p=gp(e.touches[0]);if(P.srcMode!=='sine')applyBrush(p.x,p.y);mX=p.x;mY=p.y;},{passive:false});
canvas.addEventListener('touchend',()=>{mDown=false;});

function step() {
  const nx=NX,ny=NY,alpha2=P.dt*P.dt,lambdas=[P.lambdaR,P.lambdaG,P.lambdaB],diss=P.dissipation;
  for (let c=0;c<3;c++) {
    if(!P.chOn[c]) continue;
    const uc=u[c],upc=up[c],unc=un[c],omega=2*Math.PI/lambdas[c];
    if(mDown&&P.srcMode==='sine'){const r=P.brushR,r2=r*r,sv=P.amp*sineChAmp[c]*Math.sin(omega*simTime);for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){const d2=dx*dx+dy*dy;if(d2>r2)continue;const x=mX+dx,y=mY+dy;if(x<0||x>=nx||y<0||y>=ny)continue;const i=y*nx+x;if(!barrier[i]){const falloff=1-Math.sqrt(d2)/r;uc[i]+=sv*0.4*falloff;}}}
    // Interior FDTD: proper lossy medium formulation
    // ψ(n+1) = ca * (2ψ(n) + α²∇²ψ) - cb * ψ(n-1)
    // Global dissipation applied multiplicatively on top
    for(let y=1;y<ny-1;y++){const yo=y*nx;for(let x=1;x<nx-1;x++){const i=yo+x;if(barrier[i]){unc[i]=0;continue;}const lap=uc[i-1]+uc[i+1]+uc[i-nx]+uc[i+nx]-4*uc[i];unc[i]=diss*(caArr[i]*(2*uc[i]+alpha2*lap)-cbArr[i]*upc[i]);}}
    // Hard zero all edge cells
    for(let x=0;x<nx;x++){unc[x]=0;unc[(ny-1)*nx+x]=0;}
    for(let y=0;y<ny;y++){unc[y*nx]=0;unc[y*nx+nx-1]=0;}
    up[c]=uc;u[c]=unc;un[c]=upc;
  }
  simTime+=1;stepN++;
}

function accumDet(){const dx=Math.min(NX-5,Math.floor(NX*0.78));for(let c=0;c<3;c++){if(!P.chOn[c])continue;for(let y=0;y<NY;y++){const v=u[c][y*NX+dx];detAccum[c][y]+=v*v;}}detCount++;}

function render(){
  const d=imgData.data,g=P.gain,disp=P.disp,rOn=P.chOn[0],gOn=P.chOn[1],bOn=P.chOn[2];
  if(disp==='amplitude'){const ur=u[0],ug=u[1],ub=u[2];for(let i=0;i<N;i++){const p=i*4;let vr=rOn?ur[i]*g:0;if(vr<0)vr=-vr;vr=vr*255|0;if(vr>255)vr=255;let vg=gOn?ug[i]*g:0;if(vg<0)vg=-vg;vg=vg*255|0;if(vg>255)vg=255;let vb=bOn?ub[i]*g:0;if(vb<0)vb=-vb;vb=vb*255|0;if(vb>255)vb=255;d[p]=vr;d[p+1]=vg;d[p+2]=vb;}}
  else if(disp==='intensity'){const ur=u[0],ug=u[1],ub=u[2];for(let i=0;i<N;i++){const p=i*4;let ir=rOn?ur[i]*g:0;ir=ir*ir*255|0;if(ir>255)ir=255;let ig=gOn?ug[i]*g:0;ig=ig*ig*255|0;if(ig>255)ig=255;let ib=bOn?ub[i]*g:0;ib=ib*ib*255|0;if(ib>255)ib=255;d[p]=ir;d[p+1]=ig;d[p+2]=ib;}}
  else if(disp==='phase'){for(let i=0;i<N;i++){const p=i*4;for(let c=0;c<3;c++){if(!P.chOn[c]){d[p+c]=0;continue;}const v=u[c][i],vp=up[c][i];const amp=Math.sqrt(v*v+vp*vp)*g;const phase=Math.atan2(v,vp);const bright=Math.min(1,amp)*(0.5+0.5*Math.cos(phase));d[p+c]=Math.round(bright*255);}}}
  for(let i=0;i<N;i++){if(barrier[i]){const p=i*4;if(userWalls[i]){d[p]=100;d[p+1]=180;d[p+2]=240;}else{d[p]=45;d[p+1]=70;d[p+2]=100;}}}
  ctx.putImageData(imgData,0,0);
}

function resizeDetector(){const h=detC.parentElement.getBoundingClientRect().height-20;detC.height=Math.max(80,h);}

function renderDetector(){
  const w=detC.width,h=detC.height;detCtx.fillStyle='#0e1118';detCtx.fillRect(0,0,w,h);
  if(!detCount)return;let maxI=0;for(let c=0;c<3;c++){if(!P.chOn[c])continue;for(let y=0;y<NY;y++){const v=detAccum[c][y]/detCount;if(v>maxI)maxI=v;}}if(!maxI)return;
  const colors=['rgba(255,107,107,','rgba(81,207,102,','rgba(51,154,240,'];const bw=w-6;
  for(let c=2;c>=0;c--){if(!P.chOn[c])continue;for(let py=0;py<h;py++){const gy=Math.floor(py/h*NY);const intensity=(detAccum[c][gy]/detCount)/maxI;detCtx.fillStyle=colors[c]+(0.6+0.4*intensity)+')';detCtx.fillRect(3,py,bw*intensity,1);}}
}

// Controls wiring
function wire(slId,valId,key,parse,fmt){const sl=document.getElementById(slId);const vl=document.getElementById(valId);sl.addEventListener('input',()=>{P[key]=parse(sl.value);vl.textContent=fmt?fmt(P[key]):P[key];if(['slitW','slitSep','barrierX','slitMode'].includes(key))buildBarrier();if(key==='pml')buildDamping();});}
wire('sl-lr','val-lr','lambdaR',Number);wire('sl-lg','val-lg','lambdaG',Number);wire('sl-lb','val-lb','lambdaB',Number);
wire('sl-sw','val-sw','slitW',Number);wire('sl-ss','val-ss','slitSep',Number);wire('sl-bx','val-bx','barrierX',Number,v=>v.toFixed(2));
wire('sl-dt','val-dt','dt',Number,v=>v.toFixed(2));wire('sl-gain','val-gain','gain',Number,v=>v.toFixed(1));wire('sl-br','val-br','brushR',Number);wire('sl-diss','val-diss','dissipation',Number,v=>v.toFixed(3));
document.getElementById('sl-scale').addEventListener('input',function(){P.scale=Number(this.value);document.getElementById('val-scale').textContent=P.scale;init();});

['r','g','b'].forEach((ch,ci)=>{document.getElementById('tog-'+ch).addEventListener('click',function(){P.chOn[ci]=!P.chOn[ci];this.classList.toggle('active',P.chOn[ci]);});});
document.getElementById('tog-all').addEventListener('click',function(){const allOn=P.chOn.every(v=>v);P.chOn=[!allOn,!allOn,!allOn];['r','g','b'].forEach((ch,ci)=>{document.getElementById('tog-'+ch).classList.toggle('active',P.chOn[ci]);});this.classList.toggle('active',P.chOn[0]);});

function wireGroup(sel,key,cb){document.querySelectorAll(sel).forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll(sel).forEach(b=>b.classList.remove('active'));btn.classList.add('active');const dk=Object.keys(btn.dataset)[0];P[key]=btn.dataset[dk];if(cb)cb();});});}
wireGroup('[data-slits]','slitMode',buildBarrier);wireGroup('[data-disp]','disp');wireGroup('[data-src]','srcMode');

document.getElementById('btn-pause').addEventListener('click',function(){paused=!paused;this.textContent=paused?'▶ Play':'⏸ Pause';this.classList.toggle('active',paused);});
document.getElementById('btn-reset').addEventListener('click',()=>{for(let c=0;c<3;c++){u[c].fill(0);up[c].fill(0);un[c].fill(0);detAccum[c].fill(0);}detCount=0;simTime=0;stepN=0;});
document.getElementById('btn-clr').addEventListener('click',()=>{userWalls.fill(0);buildBarrier();});

function loop(){
  fCount++;const now=performance.now();
  if(now-lastFT>500){fps=Math.round(fCount/((now-lastFT)/1000));fCount=0;lastFT=now;
    document.getElementById('perf-info').innerHTML=`${fps} fps · ${NX}×${NY} · <strong>${NX*NY*3/1000|0}k</strong> cells · α=${P.dt.toFixed(2)}`;}
  if(!paused){step();accumDet();}
  render();if(stepN%8===0)renderDetector();
  document.getElementById('ot').textContent=(simTime*0.01).toFixed(3);
  document.getElementById('os').textContent=stepN;
  requestAnimationFrame(loop);
}

window.addEventListener('resize',()=>{clearTimeout(window._rt);window._rt=setTimeout(()=>{init();},200);});
init();loop();
