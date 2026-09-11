import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

/* ───────── shared ui ───────── */
const $ = id => document.getElementById(id);
const stage = $('stage'), c2d = $('c2d'), c3d = $('c3d'); let ctx = c2d.getContext('2d'); const MAINCTX = ctx;
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const COL = { bg:'#0a0810', blue:'#f6a03f', blueDim:'#a85f14', yellow:'#fcf1a4', yellowDim:'#b9a865',
  text:'#d9d0d3', dim:'#9b8e98', faint:'#5e5361', green:'#7ec27e', red:'#e34a6a', border:'rgba(252,180,120,0.2)' };
const TOG = { arrows:true, phaseplane:true, series:true, trails:true, spin:true, chars:true, inviscid:true, fixed:true };
let VIEW = 'wave';
const fmt = (x,d=3) => Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(d);
const fmtE = x => x === 0 ? '0' : (Math.abs(x) >= 1e4 || Math.abs(x) < 1e-3 ? x.toExponential(2) : x.toPrecision(4));

document.querySelectorAll('.view-btn').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('.tog-row').forEach(r => r.addEventListener('click', () => {
  const k = r.dataset.tog; TOG[k] = !TOG[k]; r.querySelector('.tog').classList.toggle('on', TOG[k]);
}));
$('qp-col').onclick = () => { document.body.classList.toggle('qp-collapsed'); queueResize(); };
$('mp-col').onclick = () => { document.body.classList.toggle('mp-collapsed'); queueResize(); };

const TITLES = { equations:['Navier–Stokes 1D','the equations: derivation and structure'], burgers:['burgers','one dimension, one fight'], flow2d:['flow 2D','a solved problem, live'], flow3d:['flow 3D','vortex stretching, live'], wave:['wave','exact affine-wave ODE'], cascade:['cascade','layers to a finite-time limit'], vortex:['vortex','self-similar collapse'] };
const CAPTIONS = {
  equations:'<b>Helmholtz–Leray decomposition.</b> Left: an arbitrary smooth vector field with its divergence in colour. Middle: the divergence-free part the fluid keeps. Right: the gradient part, with its potential φ in colour — this is what pressure removes, instantly, everywhere.',
  burgers:'<b>top-left</b> the profile, with the initial condition faint and the inviscid characteristics solution dashed. <b>top-right</b> characteristics in the x–t plane: where they cross, the inviscid equation has already broken. <b>bottom</b> steepest slope against the exact inviscid law, and energy.',
  flow2d:'<b>left</b> vorticity ω, blue negative · yellow positive, with velocity arrows. <b>right</b> energy, enstrophy and max|ω| over time, all monotone, and the energy identity checked against the running field.',
  flow3d:'<b>the cube</b> is the periodic box; points show where |ω| is above the threshold, coloured by intensity. Vortex sheets thin into tubes. <b>right</b> energy and enstrophy — enstrophy can climb here — and the Beale–Kato–Majda integral.',
  wave:'<b>left</b> total temperature θ near the origin, blue cold · yellow warm — <b>right</b> the added wave alone, contrast-stretched. The wavevector <b>ζ</b> and background gradient <b>G</b> are drawn at the center. Watch ζ swing past vertical during steering: that is what turns the vorticity off.',
  cascade:'<b>left</b> the temperature field, magnified about the origin. Each zoom level shows the previous layer as a flat ramp and the next layer as fresh stripes inside it. <b>right</b> the gradient norm climbing an accelerating staircase toward <b>T<sub>*</sub></b> while the temperature norm stays bounded.',
  vortex:'A kinematic stand-in for the reported solution: fluid parcels spiral inward, the core shrinks as ℓ(t) and stretches along the axis to conserve volume, and angular speed rises as ℓ<sup>−2</sup>. Colour is angular speed. Drag to orbit, scroll to zoom.'
};
function setView(v){
  VIEW = v;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  document.querySelectorAll('.sec').forEach(s => s.classList.toggle('on', s.id === 'sec-' + v));
  $('qp-title').innerHTML = `${TITLES[v][0]}<small>${TITLES[v][1]}</small>`;
  $('stage-caption').innerHTML = CAPTIONS[v];
  const three = v==='vortex'||v==='flow3d'; c2d.classList.add('active'); c3d.classList.toggle('active', three);
  if(VX.controls) VX.controls.enabled = v==='vortex'; if(F3.controls) F3.controls.enabled = v==='flow3d';
  buildMath(v); const body=$('mp-body'); const sec=$('sec-'+v); if(sec){ sec.classList.add('on'); body.prepend(sec); } const chap=document.createElement('div'); chap.className='qp-title mp-chap'; chap.innerHTML=`${TITLES[v][0]}<small>${TITLES[v][1]}</small>`; body.prepend(chap);
  const sel=$('chapter-sel'); if(sel) sel.value=v; ovBegin(); ovEnd(); EQ_dirty(); queueResize();
  if(!EMBED_READY) return; if(location.hash!=='#'+v){ try{ history.replaceState(null,'','#'+v); }catch(e){} }
}
let EMBED_READY=false;
function EQ_dirty(){ if(typeof EQ!=='undefined') EQ.dirty=true; }
let resizeQueued = false;
function queueResize(){ if(!resizeQueued){ resizeQueued = true; requestAnimationFrame(()=>{ resizeQueued=false; setTimeout(resize, 240); resize(); }); } }
let _lastW=0,_lastH=0;
function resize(){
  const W = stage.clientWidth, H = stage.clientHeight; if(W===_lastW&&H===_lastH) return; _lastW=W; _lastH=H; EQ_dirty();
  c2d.width = W*DPR; c2d.height = H*DPR; c2d.style.width = W+'px'; c2d.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  if(VX.renderer){ VX.renderer.setSize(W,H,false); VX.camera.aspect = W/H; VX.camera.updateProjectionMatrix(); if(F3.camera){ F3.camera.aspect=W/H; F3.camera.updateProjectionMatrix(); } }
}
window.addEventListener('resize', resize);


/* ───────── KaTeX overlay labels on the stage ───────── */
const OV=$('stage-overlay'), ovCache=new Map(); let ovUsed=new Set();
const texify=str=>str.split('$').map((p,i)=>i%2?katex.renderToString(p,{throwOnError:false}):p).join('');
function ovBegin(){ ovUsed=new Set(); }
function ov(id,src,x,y,o={}){ let c=ovCache.get(id); if(!c){ const el=document.createElement('div'); OV.appendChild(el); c={el,src:null,cls:null}; ovCache.set(id,c); }
  const cls='ov'+(o.cls?' '+o.cls:''); if(c.cls!==cls){ c.el.className=cls; c.cls=cls; }
  if(c.src!==src){ c.src=src; if(o.display===true) katex.render(src,c.el,{throwOnError:false,displayMode:true}); else if(o.display===false) katex.render(src,c.el,{throwOnError:false}); else c.el.innerHTML=texify(src); }
  const st=c.el.style; st.left=x+'px'; st.top=y+'px'; st.maxWidth=o.w?o.w+'px':''; st.textAlign=o.align||'left'; st.transform=o.align==='center'?'translateX(-50%)':o.align==='right'?'translateX(-100%)':''; st.display=''; ovUsed.add(id); }
function ovEnd(){ for(const [id,c] of ovCache) if(!ovUsed.has(id)) c.el.style.display='none'; }


/* ───────── on-stage scrubber, mirrors the active view's slider ───────── */
const SCRUB={equations:null, burgers:['r-btl','v-btl','timeline'], flow2d:['r-ftl','v-ftl','timeline'], flow3d:['r-gtl','v-gtl','timeline'], wave:['r-wtl','v-wtl','timeline'], cascade:['r-zoom','v-zoom','magnification'], vortex:['r-xt','v-xt','t / T∗']};
const SCRUB_H=48; const stageH=()=>stage.clientHeight-(SCRUB[VIEW]?SCRUB_H:0);
let ssDrag=false; for(const ev of ['pointerdown','touchstart','mousedown']) $('ss-range').addEventListener(ev,()=>ssDrag=true); for(const ev of ['pointerup','touchend','mouseup','pointercancel']) window.addEventListener(ev,()=>ssDrag=false);
$('ss-range').addEventListener('input',e=>{ const m=SCRUB[VIEW]; if(!m) return; const t=$(m[0]); t.value=e.target.value; t.dispatchEvent(new Event('input')); });
function scrubSync(){ const m=SCRUB[VIEW]; const el=$('stage-scrub'); el.classList.toggle('off',!m); if(!m) return; const t=$(m[0]); const r=$('ss-range'); if(r.min!==t.min) r.min=t.min; if(r.max!==t.max) r.max=t.max; if(r.step!==t.step) r.step=t.step; if(!ssDrag&&document.activeElement!==r) r.value=t.value; $('ss-val').textContent=$(m[1]).textContent; $('ss-name').textContent=m[2]; }

/* ───────── colour maps ───────── */
// inferno (Zucker's polynomial fit), and the two maps the page uses
const _IC=[[0.0002189403691192265,0.001651004631001012,-0.01948089843709184],[0.1065134194856116,0.5639564367884091,3.932712388889277],[11.60249308247187,-3.972853965665698,-15.9423044794981],[-41.70399613139459,17.43639888205313,44.35414519872813],[77.162935699427,-33.40235894210092,-81.80730925738993],[-71.31942824499214,32.62606426397723,73.20951985803202],[25.13112622477341,-12.24266895238567,-23.07032500287172]];
function inferno(t){ t=Math.max(0,Math.min(1,t)); const o=[0,0,0]; for(let c=0;c<3;c++){ let v=_IC[6][c]; for(let i=5;i>=0;i--) v=_IC[i][c]+t*v; o[c]=Math.max(0,Math.min(255,v*255)); } return o; }
function divRGB(u){ return inferno(0.5+0.5*Math.max(-1,Math.min(1,u))); } // signed field: negative dark, zero mid, positive bright
function heatRGB(u){ return inferno(u); }
// tracer palette: cyan → pale cyan → white, 0..1 floats (never dark, so no violet against the inferno particles)
function cyanRGB(u){ u=Math.max(0,Math.min(1,u)); const a=[0.08,0.30,0.62], b=[0.16,0.62,0.95], c=[0.30,0.90,1.0]; if(u<0.5){ const t=u/0.5; return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]; } const t=(u-0.5)/0.5; return [b[0]+(c[0]-b[0])*t,b[1]+(c[1]-b[1])*t,b[2]+(c[2]-b[2])*t]; }
// all tracers of a scene in one fat-line geometry per layer; tracers are joined by black segments, invisible under additive blending
// keep a trail's path length at most L world units by dropping tail points
function trimTrail(t,L){ let acc=0; for(let j=t.length-1;j>0;j--){ const a=t[j],b=t[j-1]; acc+=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]); if(acc>L){ t.splice(0,j); return; } } }
class TracerBundle{
  constructor(scene,w=1.4){ this.mats=[new LineMaterial({linewidth:w,vertexColors:true,transparent:true,opacity:0.55,depthWrite:false,blending:THREE.AdditiveBlending,worldUnits:false}),
      new LineMaterial({linewidth:w*2.2,vertexColors:true,transparent:true,opacity:0.03,depthWrite:false,blending:THREE.AdditiveBlending,worldUnits:false}),
      new LineMaterial({linewidth:w*3,vertexColors:true,transparent:true,opacity:0.0,depthWrite:false,blending:THREE.AdditiveBlending,worldUnits:false})];
    this.setWidth(w); this.gain=0.35;
    this.g=new LineGeometry(); this.g.setPositions([0,0,0,0,0,0.001]); this.g.setColors([0,0,0,0,0,0]); this.lines=this.mats.map(m=>new Line2(this.g,m)); this.lines.slice().reverse().forEach(l=>scene.add(l)); }
  setWidth(w){ this.mats[0].linewidth=w; this.mats[1].linewidth=w*2.2; this.mats[2].linewidth=w*3; }
  set(trails,visible){ this.lines.forEach(l=>l.visible=visible); if(!visible) return; const W=stage.clientWidth,H=stage.clientHeight; for(const m of this.mats) m.resolution.set(W,H);
    let n=0; for(const t of trails) if(t.length>=2) n+=t.length+2; if(n<2){ this.lines.forEach(l=>l.visible=false); return; }
    // colour by stretching rate, normalised to the 95th percentile of all trail points this frame
    const samp=[]; let q=0; for(const t of trails) for(const p of t){ if((q++&7)===0) samp.push(Math.max(0,p[3])); } samp.sort((a,b)=>a-b); const p95=Math.max(1e-9,samp[Math.floor(samp.length*0.95)]||1); this.p95=p95;
    const pos=new Float32Array(n*3), col=new Float32Array(n*3); let o=0; const put=(p,r,g,b)=>{ pos[3*o]=p[0];pos[3*o+1]=p[1];pos[3*o+2]=p[2]; col[3*o]=r;col[3*o+1]=g;col[3*o+2]=b; o++; };
    for(const t of trails){ if(t.length<2) continue; const L=t.length; put(t[0],0,0,0); for(let j=0;j<L;j++){ const p=t[j]; const f=0.3+0.7*Math.pow(j/(L-1),1.3); const c=cyanRGB(Math.max(0,p[3])/p95); const g=this.gain; put(p,c[0]*f*g,c[1]*f*g,c[2]*f*g); } put(t[L-1],0,0,0); }
    this.g.setPositions(pos); this.g.setColors(col); this.g.computeBoundingSphere(); }
}
function arrow(x0,y0,x1,y1,col,w=1.2){
  const dx=x1-x0, dy=y1-y0, L=Math.hypot(dx,dy); if(L<0.5) return;
  ctx.strokeStyle=col; ctx.fillStyle=col; ctx.lineWidth=w;
  ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
  const h=Math.min(7,L*0.5), ux=dx/L, uy=dy/L;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x1-h*ux+h*0.5*uy, y1-h*uy-h*0.5*ux); ctx.lineTo(x1-h*ux-h*0.5*uy, y1-h*uy+h*0.5*ux); ctx.closePath(); ctx.fill();
}
function label(txt,x,y,col=COL.dim,size=10,align='left',font='JetBrains Mono'){ ctx.fillStyle=col; ctx.font=`${size}px '${font}'`; ctx.textAlign=align; ctx.textBaseline='middle'; ctx.fillText(txt,x,y); }
function serifLabel(txt,x,y,col,size=15,align='left'){ ctx.fillStyle=col; ctx.font=`italic ${size}px 'Cormorant Garamond'`; ctx.textAlign=align; ctx.textBaseline='middle'; ctx.fillText(txt,x,y); }

/* ═══════════════════════════════════════════════
   WAVE — the exact affine-wave ODE, one layer
   state: ζ = r(sin φ, cos φ) in lab frame, Θ, Ω
   Θ̇ = a Ω  with a = A sin s /(λ r)   (invariant under common rotation)
   Ω̇ = λ r sin φ Θ                     (uses the laboratory component ζ₁)
   ═══════════════════════════════════════════════ */
const WV = { A:1, lam:14, s:0.4, r:1, L:6, spd:1.5, seed:5e-4, Lambda:3, playing:true };
const smootherstep = t => t<=0?0:t>=1?1:t*t*t*(t*(t*6-15)+10);
const bump = y => (y<=0||y>=1)?0:30*y*y*(1-y)*(1-y); // unit integral on (0,1)
WV.zprofile = (tau, mu) => tau < 1 ? 1 - smootherstep(tau) : tau <= 1 + 1/WV.Lambda ? -mu*WV.Lambda*bump(WV.Lambda*(tau-1)) : 0;
WV.phiOf = (tau, mu) => Math.asin(Math.max(-0.98, Math.min(0.98, Math.sin(WV.s)*WV.zprofile(tau,mu))));
WV.gamma = () => Math.sqrt(WV.A)*Math.sin(WV.s);
WV.a = () => WV.A*Math.sin(WV.s)/(WV.lam*WV.r);
function wvReset(){
  WV.view=-1; WV.t=0; WV.phase='growth'; WV.phi=WV.s; WV.alpha=0; WV.mu=null; WV.t1=0;
  WV.Th = -WV.seed; WV.Om = (WV.lam*WV.r/Math.sqrt(WV.A))*WV.Th; // growing eigenline
  WV.hist=[]; WV.steerEnd=0; WV.frameAcc=0;
}
function rk4(Th,Om,t,dt,phiAt){ // phiAt(t) gives ζ angle; a is constant
  const a=WV.a(), f=(T,O,tt)=>[a*O, WV.lam*WV.r*Math.sin(phiAt(tt))*T];
  const k1=f(Th,Om,t), k2=f(Th+0.5*dt*k1[0],Om+0.5*dt*k1[1],t+0.5*dt),
        k3=f(Th+0.5*dt*k2[0],Om+0.5*dt*k2[1],t+0.5*dt), k4=f(Th+dt*k3[0],Om+dt*k3[1],t+dt);
  return [Th+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]), Om+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1])];
}
function steerEndpoint(mu){ // integrate steering from (t1,Th1,Om1) for trial mu; return Ω at end
  const g=WV.gamma(), T=(1+1/WV.Lambda)/g, n=800, dt=T/n; let Th=WV.Th1, Om=WV.Om1, t=WV.t1;
  const phiAt = tt => WV.phiOf(g*(tt-WV.t1), mu);
  for(let i=0;i<n;i++){ [Th,Om]=rk4(Th,Om,t,dt,phiAt); t+=dt; }
  return Om;
}
function shoot(){ // least μ with Ω(end)=0 : Ω(0)<0, Ω grows with μ
  let lo=0, hi=1; let vhi=steerEndpoint(hi), guard=0;
  while(vhi<0 && guard++<12){ lo=hi; hi*=2; vhi=steerEndpoint(hi); }
  if(vhi<0) return hi; // clamped profile can't reach zero; accept
  for(let i=0;i<40;i++){ const m=0.5*(lo+hi); if(steerEndpoint(m)<0) lo=m; else hi=m; }
  return 0.5*(lo+hi);
}
function wvAdvance(dtTot){
  const g=WV.gamma(); const dt=Math.min(0.01, 0.04/g); let rem=dtTot;
  while(rem>0){
    const h=Math.min(dt,rem);
    if(WV.phase==='growth'){
      [WV.Th,WV.Om]=rk4(WV.Th,WV.Om,WV.t,h,()=>WV.s); WV.t+=h; WV.phi=WV.s;
      if(Math.abs(WV.Th)>=WV.seed*Math.exp(WV.L)){ WV.phase='steer'; WV.t1=WV.t; WV.Th1=WV.Th; WV.Om1=WV.Om; WV.mu=shoot(); WV.steerEnd=WV.t1+(1+1/WV.Lambda)/g; }
    } else if(WV.phase==='steer'){
      const phiAt=tt=>WV.phiOf(g*(tt-WV.t1),WV.mu);
      [WV.Th,WV.Om]=rk4(WV.Th,WV.Om,WV.t,h,phiAt); WV.t+=h; WV.phi=phiAt(WV.t);
      if(WV.t>=WV.steerEnd){ WV.phase='hold'; WV.Om=0; WV.phi=0; }
    } else { WV.t+=h; WV.phi=0; }
    WV.alpha=WV.s-WV.phi; rem-=h;
  }
  const H=WV.hist; const last=H[H.length-1];
  if(!last || WV.t-last.t>0.02){ H.push({t:WV.t,Th:WV.Th,Om:WV.Om,phase:WV.phase,phi:WV.phi,alpha:WV.alpha,mu:WV.mu}); if(H.length>4000) H.splice(0,H.length-4000); }
}
// controls
const bindRange=(id,vid,obj,key,f=x=>x,show=x=>x)=>{ const r=$(id); const upd=()=>{ obj[key]=f(parseFloat(r.value)); $(vid).textContent=show(obj[key]); }; r.addEventListener('input',()=>{upd(); if(obj===WV) wvReset(); if(obj===CS){ CS.dirty=true; } }); upd(); };
bindRange('r-A','v-A',WV,'A',x=>x,x=>x.toFixed(2));
bindRange('r-lam','v-lam',WV,'lam',x=>x,x=>x.toFixed(0));
bindRange('r-s','v-s',WV,'s',x=>x,x=>x.toFixed(2)+' rad');
bindRange('r-L','v-L',WV,'L',x=>x,x=>'e^'+x.toFixed(1)+' = ×'+Math.exp(x).toFixed(0));
$('r-spd').addEventListener('input',e=>{WV.spd=parseFloat(e.target.value);$('v-spd').textContent=WV.spd.toFixed(1)+'×'}); $('v-spd').textContent='1.5×';
$('w-play').onclick=()=>{WV.playing=!WV.playing; if(WV.playing) WV.view=-1; $('w-play').textContent=WV.playing?'pause':'play';};
$('r-wtl').addEventListener('input',e=>{ const i=parseInt(e.target.value); WV.view=i>=WV.hist.length-1?-1:i; WV.playing=false; $('w-play').textContent='play'; });
$('w-reset').onclick=wvReset;
$('w-step').onclick=()=>{ WV.playing=false; $('w-play').textContent='play'; wvAdvance(0.25/WV.gamma()); };
wvReset();

// wave field rendering
const FN=112; const fieldCvs=[0,1].map(()=>{ const c=document.createElement('canvas'); c.width=FN; c.height=FN; const x=c.getContext('2d'); return {c,x,img:x.createImageData(FN,FN)}; });
function paintField(fn, scale, dx, dy, S, idx=0){
  const {c:fieldCv,x:fctx,img:fimg}=fieldCvs[idx]; const d=fimg.data; for(let j=0;j<FN;j++){ const y=1-2*(j+0.5)/FN; for(let i=0;i<FN;i++){ const x=-1+2*(i+0.5)/FN; const c=divRGB(fn(x,y)/scale); const k=4*(j*FN+i); d[k]=c[0];d[k+1]=c[1];d[k+2]=c[2];d[k+3]=255; } }
  fctx.putImageData(fimg,0,0); ctx.imageSmoothingEnabled=true; ctx.drawImage(fieldCv,dx,dy,S,S);
  ctx.strokeStyle=COL.border; ctx.lineWidth=1; ctx.strokeRect(dx+0.5,dy+0.5,S-1,S-1);
}
function drawWave(){
  const W=stage.clientWidth, H=stageH(); ctx.clearRect(0,0,W,H);
  const wr=$('r-wtl'); wr.max=Math.max(0,WV.hist.length-1); if(WV.view<0) wr.value=WV.hist.length-1; const D=(WV.view>=0&&WV.hist[WV.view])?WV.hist[WV.view]:WV; $('v-wtl').textContent='t = '+D.t.toFixed(2)+(WV.view<0?'  live':'');
  const narrow=W<760; const showBottom = TOG.phaseplane||TOG.series; const hb = showBottom? Math.max(150, H*0.3) : 0;
  const top=22, S=narrow?Math.max(80,Math.min((H-hb-top-70)/2,W-40)):Math.max(80, Math.min(H-hb-top-40, (W-70)/2)); const gx=narrow?(W-S)/2:(W-(2*S+26))/2, gy=top+8; const ox2=narrow?gx:gx+S+26, oy2=narrow?gy+S+30:gy;
  const zx=Math.sin(D.phi), zy=Math.cos(D.phi); const Gx=WV.A*Math.sin(D.alpha), Gy=-WV.A*Math.cos(D.alpha);
  const theta=(x,y)=>Gx*x+Gy*y + D.Th*Math.sin(WV.lam*WV.r*(zx*x+zy*y));
  const wave =(x,y)=>D.Th*Math.sin(WV.lam*WV.r*(zx*x+zy*y));
  paintField(theta, WV.A*1.15, gx, gy, S);
  paintField(wave, Math.max(Math.abs(D.Th),1e-12), ox2, oy2, S, 1);
  label('θ = G·x + Θ sin(λζ·x)', gx, top-4, COL.dim, 10);
  label(`wave alone, ×${fmtE(1/Math.max(Math.abs(D.Th),1e-12))} contrast`, ox2, oy2-12, COL.dim, 10);
  // arrows in wave panel: v ∥ Jζ, sign sin(λζ·x)
  if(TOG.arrows && Math.abs(D.Om)>0){
    const ox=ox2, n=9, vmax=Math.abs(D.Om)/(WV.lam*WV.r*WV.r); const len=S/n*0.42;
    for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const x=-1+2*(i+0.5)/n, y=-1+2*(j+0.5)/n; const m=(D.Om/(WV.lam*WV.r*WV.r))*Math.sin(WV.lam*WV.r*(zx*x+zy*y))/vmax; const vx=-zy*m, vy=zx*m; const px=ox+(x+1)/2*S, py=oy2+(1-y)/2*S; arrow(px-vx*len*0.5,py+vy*len*0.5,px+vx*len*0.5,py-vy*len*0.5,'rgba(243,238,238,0.7)',1); }
  }
  // ζ and G at centre of left panel
  const cx=gx+S/2, cy=gy+S/2, R=S*0.34;
  ctx.setLineDash([3,4]); ctx.strokeStyle='rgba(200,208,224,0.35)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(cx,cy-R*1.1); ctx.lineTo(cx,cy+R*1.1); ctx.stroke(); ctx.setLineDash([]);
  arrow(cx,cy,cx+R*zx,cy-R*zy,COL.yellow,2); serifLabel('ζ',cx+R*zx+8,cy-R*zy-8,COL.yellow,17);
  const gL=R*0.9/Math.max(WV.A,1e-9); arrow(cx,cy,cx+gL*Gx,cy-gL*Gy,COL.blue,2); serifLabel('G',cx+gL*Gx-14,cy-gL*Gy+10,COL.blue,17);
  ctx.strokeStyle=COL.yellowDim; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(cx,cy,R*0.45,-Math.PI/2,-Math.PI/2+D.phi, D.phi<0); ctx.stroke();
  serifLabel('φ',cx+R*0.52*Math.sin(D.phi/2)+4,cy-R*0.52*Math.cos(D.phi/2),COL.yellowDim,14);
  const z1=Math.sin(D.phi); label(`ζ₁ ${z1>0.005?'> 0':z1<-0.005?'< 0':'= 0'}  →  Ω̇ = λζ₁Θ ${z1>0.005?'drives Ω':z1<-0.005?'reverses Ω':'off'}`, gx+8, gy+S-12, z1<-0.005?COL.red:z1>0.005?COL.yellow:COL.green, 10);
  // bottom: phase plane + series
  if(showBottom){
    const by=(narrow?oy2:gy)+S+22, bh=H-by-30; let bx=gx, bw=narrow?S:2*S+26;
    if(TOG.phaseplane&&!narrow){ const pw=Math.min(bh, bw*0.34); drawPhasePlane(bx,by,pw,bh); bx+=pw+26; bw-=pw+26; }
    if(TOG.series) drawSeries(bx,by,bw,bh);
  }
  // readouts
  const g=WV.gamma(), grad=WV.lam*WV.r*Math.abs(D.Th);
  const ph=D.phase; ['growth','steer','hold'].forEach(p=>{ const el=$('ph-'+p); el.className = p===ph?'on': (['growth','steer','hold'].indexOf(p)<['growth','steer','hold'].indexOf(ph)?'done':''); });
  $('w-ro').innerHTML = [
    ['time <i>t</i>', fmt(D.t,2), ''], ['rate <i>γ</i> = √A sin s', fmt(g,3), ''],
    ['<i>Θ</i> (amplitude)', fmtE(D.Th), Math.abs(D.Th)<1e-2?'cold':''],
    ['|∇ϑ(0)| = λ|Θ|', fmtE(grad), grad>1?'hot':''],
    ['<i>Ω</i> (vorticity amp.)', fmtE(D.Om), Math.abs(D.Om)<1e-6&&ph==='hold'?'cold':''],
    ['gain so far', 'e^'+fmt(Math.log(Math.abs(D.Th)/WV.seed),2), ''],
    ['angle <i>φ</i> (lab)', fmt(D.phi,3)+' rad', ''], ['common rotation <i>α</i>', fmt(D.alpha,3)+' rad', ''],
    ['pulse <i>μ</i> (shot)', D.mu==null?'—':fmt(D.mu,3), ''],
  ].map(([k,v,c])=>`<span class="k">${k}</span><span class="n ${c}">${v}</span>`).join('');
}
const symlog = x => Math.sign(x)*Math.log10(1+Math.abs(x)/WV.seed);
function drawPhasePlane(x,y,w,h){
  const sz=Math.min(w,h), cx=x+w/2, cy=y+sz/2; const maxv=symlog(WV.seed*Math.exp(WV.L)*1.3);
  const px=v=>cx+symlog(v)/maxv*sz/2, py=v=>cy-symlog(v)/maxv*sz/2;
  ctx.strokeStyle=COL.border; ctx.strokeRect(cx-sz/2+.5,cy-sz/2+.5,sz-1,sz-1);
  ctx.setLineDash([2,3]); ctx.strokeStyle='rgba(150,200,255,0.25)'; ctx.beginPath(); ctx.moveTo(cx-sz/2,cy); ctx.lineTo(cx+sz/2,cy); ctx.moveTo(cx,cy-sz/2); ctx.lineTo(cx,cy+sz/2); ctx.stroke();
  ctx.strokeStyle='rgba(255,200,50,0.35)'; ctx.beginPath(); ctx.moveTo(cx-sz/2,cy+sz/2); ctx.lineTo(cx+sz/2,cy-sz/2); ctx.moveTo(cx-sz/2,cy-sz/2); ctx.lineTo(cx+sz/2,cy+sz/2); ctx.stroke(); ctx.setLineDash([]);
  const k=Math.sqrt(WV.A)/(WV.lam*WV.r); // Ω̂ = Ω·k
  ctx.save(); ctx.beginPath(); ctx.rect(cx-sz/2,cy-sz/2,sz,sz); ctx.clip();
  ctx.beginPath(); let first=true; for(const p of WV.hist){ const X=px(p.Th), Y=py(p.Om*k); first?ctx.moveTo(X,Y):ctx.lineTo(X,Y); first=false; }
  ctx.strokeStyle=COL.blue; ctx.lineWidth=1.4; ctx.stroke();
  ctx.fillStyle=COL.yellow; ctx.beginPath(); ctx.arc(px(WV.Th),py(WV.Om*k),3.2,0,7); ctx.fill(); ctx.restore();
  serifLabel('Θ',cx+sz/2-12,cy+10,COL.dim,14); serifLabel('Ω̂',cx+6,cy-sz/2+10,COL.dim,14);
  label('eigenlines Ω̂ = ±Θ · symlog axes',cx-sz/2+4,cy+sz/2+10,COL.faint,9);
}
function drawSeries(x,y,w,h){
  const g=WV.gamma(); const tExp=(WV.L+1+1/WV.Lambda)/g*1.25; const tmax=Math.max(tExp,WV.t*1.05);
  const lo=Math.log10(WV.seed)-0.3, hi=Math.log10(WV.seed*Math.exp(WV.L)*WV.lam*WV.r)+0.4;
  const px=t=>x+t/tmax*w, py=v=>y+h-(v-lo)/(hi-lo)*h;
  ctx.strokeStyle=COL.border; ctx.strokeRect(x+.5,y+.5,w-1,h-1);
  // phase bands
  let segStart=0, segPhase=WV.hist[0]?.phase; const bands=[];
  for(const p of WV.hist){ if(p.phase!==segPhase){ bands.push([segStart,p.t,segPhase]); segStart=p.t; segPhase=p.phase; } }
  bands.push([segStart,WV.t,segPhase]);
  for(const [t0,t1,ph] of bands){ ctx.fillStyle = ph==='growth'?'rgba(246,160,63,0.06)':ph==='steer'?'rgba(252,241,164,0.09)':'rgba(126,194,126,0.07)'; ctx.fillRect(px(t0),y,px(t1)-px(t0),h); label(ph,px(t0)+4,y+9,COL.faint,9); }
  // gridlines
  for(let v=Math.ceil(lo);v<=hi;v++){ ctx.strokeStyle='rgba(150,200,255,0.08)'; ctx.beginPath(); ctx.moveTo(x,py(v)); ctx.lineTo(x+w,py(v)); ctx.stroke(); label('10^'+v,x+w-4,py(v)-6,COL.faint,9,'right'); }
  ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  const plot=(fn,col,width)=>{ ctx.beginPath(); let f=true; for(const p of WV.hist){ let v=fn(p); if(!isFinite(v)) continue; v=Math.max(v,lo-1); f?ctx.moveTo(px(p.t),py(v)):ctx.lineTo(px(p.t),py(v)); f=false; } ctx.strokeStyle=col; ctx.lineWidth=width; ctx.stroke(); };
  plot(p=>Math.log10(Math.abs(p.Th)),COL.blue,1.4);
  plot(p=>Math.log10(WV.lam*WV.r*Math.abs(p.Th)),COL.yellow,1.6);
  plot(p=>Math.log10(Math.abs(p.Om)*Math.sqrt(WV.A)/(WV.lam*WV.r)+1e-30),'rgba(200,208,224,0.45)',1);
  // predicted growth line
  ctx.setLineDash([3,3]); ctx.strokeStyle='rgba(255,200,50,0.35)'; ctx.beginPath(); ctx.moveTo(px(0),py(Math.log10(WV.seed*WV.lam))); const tg=WV.L/g; ctx.lineTo(px(tg),py(Math.log10(WV.seed*WV.lam)+WV.L/Math.LN10)); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  label('|Θ|',x+6,y+h-30,COL.blue,10); label('|∇ϑ(0)| = λ|Θ|',x+6,y+h-18,COL.yellow,10); label('|Ω̂|',x+6,y+h-42,'rgba(200,208,224,0.6)',10);
  label('t →',x+w-6,y+h-8,COL.faint,9,'right');
}

/* ═══════════════════════════════════════════════
   CASCADE — nested layers and the finite-time schedule
   ═══════════════════════════════════════════════ */
const CS = { z:0, Q:1.5, l1:4, L:3, auto:false, dirty:true, ratio:20, nDisp:6 };
bindRange('r-zoom','v-zoom',CS,'z',x=>x,x=>'×'+fmtE(Math.pow(10,x)));
bindRange('r-Q','v-Q',CS,'Q',x=>x,x=>x.toFixed(2));
bindRange('r-l1','v-l1',CS,'l1',x=>x,x=>x.toFixed(1)+'  (λ₁='+fmtE(Math.exp(x))+')');
bindRange('r-CL','v-CL',CS,'L',x=>x,x=>x.toFixed(1));
$('c-auto').onclick=()=>{ CS.auto=!CS.auto; $('c-auto').textContent=CS.auto?'stop':'auto-zoom'; };
$('c-zreset').onclick=()=>{ CS.z=0; $('r-zoom').value=0; $('v-zoom').textContent='×1'; CS.auto=false; $('c-auto').textContent='auto-zoom'; };
// display layers for the zoom picture
CS.disp = Array.from({length:CS.nDisp},(_,i)=>{ const q=i+1, lam=Math.pow(CS.ratio,q); const ang=0.42*(1-Math.pow(0.65,q)); return { q, lam, Th: 2.5*Math.pow(3,q)/lam, zx:Math.sin(ang), zy:Math.cos(ang), R: q===1?1.0:0.5/Math.pow(CS.ratio,q-1) }; }); // gradient λΘ = 2.5·3^q: each layer dominates its predecessors, amplitudes Σ(3/20)^q stay bounded
const env=(r,R)=>{ const u=r/R; return u<0.55?1:u>1?0:smootherstep((1-u)/0.45); };
function cascadeTheta(x,y,Z){
  let th=-y; // base: cold above
  for(const l of CS.disp){ if(l.lam>90*Z) break; const r=Math.hypot(x,y); if(r>l.R) continue; th+=l.Th*Math.sin(l.lam*(l.zx*x+l.zy*y))*env(r,l.R); }
  return th;
}
function schedule(){
  const Q=CS.Q, L=CS.L; const out=[]; let sig=[1], lnlam=[]; let T=0;
  for(let q=1;q<=80;q++){
    const ln = Math.pow(Q,q-1)*CS.l1; lnlam.push(ln);
    const A = Math.exp(ln/8); const sq = q===1?0.3:Math.min(L*sig[q-2]/sig[q-1],1.2);
    const gam = sig[q-1]*Math.sin(sq); const dur=(L+3)/gam;
    const Th = Math.exp(-7*ln/8);
    const Gprev=out.length?out[q-2].G:1, Tprev=out.length?out[q-2].T:1;
    const G=Gprev+A, Tn=Tprev+Th;            // gradients add (one cone); amplitudes summable
    const s2=Math.sqrt(G); sig.push(s2);     // σ_q² = |G_{<q+1}|
    out.push({q,ln,A,sq,gam,dur,t0:T,Th,G,T:Tn,sig:s2}); T+=dur;
    if(dur<T*1e-7||!isFinite(dur)) break;
  }
  return {layers:out,Tstar:T};
}
const csField=document.createElement('canvas'); const CN=150; csField.width=CN; csField.height=CN; const csctx=csField.getContext('2d'); const csimg=csctx.createImageData(CN,CN);
let SCH=null;
function drawCascade(dtFrame){
  if(CS.auto){ CS.z+=dtFrame*0.25; if(CS.z>4.6){CS.z=0;} $('r-zoom').value=CS.z; $('v-zoom').textContent='×'+fmtE(Math.pow(10,CS.z)); }
  if(CS.dirty||!SCH){ SCH=schedule(); CS.dirty=false; }
  const W=stage.clientWidth, H=stage.clientHeight; ctx.clearRect(0,0,W,H);
  const narrow=W<760; const S=narrow?Math.min(W-56,(H-120)*0.5):Math.min(H-70, (W-80)*0.46); const gx=28, gy=30; const Z=Math.pow(10,CS.z), wdt=1/Z;
  // field, auto-contrast
  const vals=new Float32Array(CN*CN); let mn=1e9,mx=-1e9;
  for(let j=0;j<CN;j++){ const y=(1-2*(j+0.5)/CN)*wdt; for(let i=0;i<CN;i++){ const x=(-1+2*(i+0.5)/CN)*wdt; const v=cascadeTheta(x,y,Z); vals[j*CN+i]=v; if(v<mn)mn=v; if(v>mx)mx=v; } }
  const mid=(mn+mx)/2, half=Math.max((mx-mn)/2,1e-30); const d=csimg.data;
  for(let k=0;k<CN*CN;k++){ const c=divRGB((vals[k]-mid)/half); d[4*k]=c[0];d[4*k+1]=c[1];d[4*k+2]=c[2];d[4*k+3]=255; }
  csctx.putImageData(csimg,0,0); ctx.imageSmoothingEnabled=true; ctx.drawImage(csField,gx,gy,S,S); ctx.strokeStyle=COL.border; ctx.strokeRect(gx+.5,gy+.5,S-1,S-1);
  // envelope circles
  const cx=gx+S/2, cy=gy+S/2;
  for(const l of CS.disp){ const rp=l.R*Z*S/2; if(rp<4||rp>S*1.5) continue; ctx.setLineDash([3,4]); ctx.strokeStyle='rgba(255,200,50,0.55)'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(cx,cy,rp,0,7); ctx.stroke(); ctx.setLineDash([]); label(`layer ${l.q}  λ=${fmtE(l.lam)}`,cx+rp*0.71+4,cy-rp*0.71-6,COL.yellow,10); }
  label(`window width 2/Z = ${fmtE(2*wdt)}   ·   contrast range ${fmtE(mx-mn)}`,gx,gy-10,COL.dim,10);
  const vis=CS.disp.filter(l=>l.lam<=90*Z); const cur=vis[vis.length-1];
  label(cur?`finest visible layer ${cur.q}: amplitude ${fmtE(cur.Th)}, gradient λ|Θ| = ${fmtE(cur.lam*cur.Th)}`:'base ramp only', gx, gy+S+14, COL.dim, 10);
  // plot
  const px0=narrow?gx:gx+S+40, pw=narrow?W-gx-30:W-px0-30, py0=narrow?gy+S+50:gy, ph=narrow?H-py0-30:S; const {layers,Tstar}=SCH;
  ctx.strokeStyle=COL.border; ctx.strokeRect(px0+.5,py0+.5,pw-1,ph-1);
  const Gmax=layers[layers.length-1].G; const ylo=-0.3, yhi=Math.log10(Gmax)+0.5;
  const X=t=>px0+t/(Tstar*1.04)*pw, Y=v=>py0+ph-(Math.log10(v)-ylo)/(yhi-ylo)*ph;
  for(let v=0;v<=yhi;v+=Math.max(1,Math.ceil((yhi-ylo)/8))){ ctx.strokeStyle='rgba(150,200,255,0.08)'; ctx.beginPath(); ctx.moveTo(px0,Y(Math.pow(10,v))); ctx.lineTo(px0+pw,Y(Math.pow(10,v))); ctx.stroke(); label('10^'+v,px0+4,Y(Math.pow(10,v))-6,COL.faint,9); }
  // stage bands
  layers.forEach((l,i)=>{ ctx.fillStyle=i%2?'rgba(150,200,255,0.04)':'rgba(150,200,255,0.015)'; ctx.fillRect(X(l.t0),py0,X(l.t0+l.dur)-X(l.t0),ph); });
  // gradient curve: within stage q, G(t)=G_{q-1} + A_q e^{-L} e^{γ(t-t0)} until it reaches A_q, then flat
  ctx.beginPath(); let f=true;
  for(const l of layers){ const Gprev=l.G-l.A; const n=24; for(let i=0;i<=n;i++){ const tt=l.t0+l.dur*i/n; const grow=Math.min(l.A, l.A*Math.exp(-CS.L)*Math.exp(l.gam*(tt-l.t0))); const v=Gprev+grow; const xx=X(tt), yy=Y(v); f?ctx.moveTo(xx,yy):ctx.lineTo(xx,yy); f=false; } }
  ctx.strokeStyle=COL.yellow; ctx.lineWidth=1.8; ctx.stroke();
  ctx.beginPath(); f=true; for(const l of layers){ const xx0=X(l.t0), xx1=X(l.t0+l.dur); const v=l.T; f?ctx.moveTo(xx0,Y(v)):ctx.lineTo(xx0,Y(v)); ctx.lineTo(xx1,Y(v)); f=false; } ctx.strokeStyle=COL.blue; ctx.lineWidth=1.6; ctx.stroke();
  ctx.setLineDash([4,4]); ctx.strokeStyle=COL.red; ctx.beginPath(); ctx.moveTo(X(Tstar),py0); ctx.lineTo(X(Tstar),py0+ph); ctx.stroke(); ctx.setLineDash([]);
  serifLabel('T∗',X(Tstar)-6,py0-10,COL.red,16,'right');
  label('‖∇θ‖∞  (sum of layer gradients, exponential growth inside each stage)',px0+8,py0+ph-30,COL.yellow,10);
  label('‖θ‖∞   (bounded: Σ λ_q^{−7/8} converges)',px0+8,py0+ph-16,COL.blue,10);
  label('t →',px0+pw-6,py0+ph-8,COL.faint,9,'right');
  const last=layers[layers.length-1];
  $('c-ro').innerHTML=[['layers before T<sub>*</sub>','∞  ('+layers.length+' drawn)'],['T<sub>*</sub>',fmt(Tstar,3)],['λ of last drawn layer','e^'+fmtE(last.ln)],['‖∇θ‖ at that layer',fmtE(last.G)],['sup‖θ‖ (limit)',fmt(last.T,4)],['stage 1 length / T<sub>*</sub>',fmt(layers[0].dur/Tstar,3)]]
    .map(([k,v])=>`<span class="k">${k}</span><span class="n">${v}</span>`).join('');
}

/* ═══════════════════════════════════════════════
   VORTEX — self-similar collapse, three.js
   ═══════════════════════════════════════════════ */
const VX = { u:0, gam:0.5, circ:1.2, spd:0.25, playing:true, N:7000, trailsN:110, trailLen:6.0 };
bindRange('r-gam','v-gam',VX,'gam',x=>x,x=>x.toFixed(2));
bindRange('r-circ','v-circ',VX,'circ',x=>x,x=>x.toFixed(2));
$('r-xspd').addEventListener('input',e=>{VX.spd=parseFloat(e.target.value);$('v-xspd').textContent=VX.spd.toFixed(2)}); $('v-xspd').textContent='0.25';
$('r-xt').addEventListener('input',e=>{ vxSeek(parseFloat(e.target.value)); });
$('r-xlen').addEventListener('input',e=>{VX.trailLen=parseFloat(e.target.value);$('v-xlen').textContent=VX.trailLen.toFixed(1)});
$('r-xw').addEventListener('input',e=>{const w=parseFloat(e.target.value);VX.bundle.setWidth(w);$('v-xw').textContent=w.toFixed(1)});
$('x-play').onclick=()=>{VX.playing=!VX.playing;$('x-play').textContent=VX.playing?'pause':'play';};
$('x-reset').onclick=()=>vxSeek(0);
function vxInit(){
  VX.renderer=new THREE.WebGLRenderer({canvas:c3d,antialias:true,alpha:true}); VX.renderer.setPixelRatio(DPR); VX.renderer.setClearColor(0x0a0810,0);
  VX.scene=new THREE.Scene(); VX.camera=new THREE.PerspectiveCamera(48,1,0.05,200); VX.camera.position.set(6.0,2.6,6.8);
  VX.controls=new OrbitControls(VX.camera,c3d); VX.controls.enableDamping=true; VX.controls.autoRotate=true; VX.controls.autoRotateSpeed=0.5;
  const N=VX.N; VX.rho0=new Float32Array(N); VX.th0=new Float32Array(N); VX.z0=new Float32Array(N); VX.th=new Float32Array(N);
  for(let i=0;i<N;i++){ VX.rho0[i]=0.08+4.0*Math.sqrt(Math.random()); VX.th0[i]=Math.random()*Math.PI*2; VX.z0[i]=(Math.random()*2-1)*0.9; VX.th[i]=VX.th0[i]; }
  VX.pos=new Float32Array(N*3); VX.col=new Float32Array(N*3);
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(VX.pos,3)); g.setAttribute('color',new THREE.BufferAttribute(VX.col,3));
  VX.points=new THREE.Points(g,new THREE.PointsMaterial({size:1.7,sizeAttenuation:false,vertexColors:true,transparent:true,opacity:0.8,depthWrite:false})); VX.scene.add(VX.points);
  // trails
  VX.trailIdx=[]; for(let k=0;k<VX.trailsN;k++){ let best=-1; for(let tries=0;tries<80;tries++){ const i=Math.floor(Math.random()*N); if(VX.rho0[i]>0.2&&VX.rho0[i]<3.6){best=i;break;} } VX.trailIdx.push(best<0?k:best); }
  VX.trailPos=new Float32Array(VX.trailsN*VX.trailLen*3); VX.trailCol=new Float32Array(VX.trailsN*VX.trailLen*3); VX.trailHead=0; VX.trailFill=0;
  VX.bundle=new TracerBundle(VX.scene,1.4);
  // axis + reference ring
  const ax=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-9,0),new THREE.Vector3(0,9,0)]); VX.scene.add(new THREE.Line(ax,new THREE.LineBasicMaterial({color:0xa85f14,transparent:true,opacity:0.4})));
  const ring=[]; for(let i=0;i<=96;i++){ const a=i/96*Math.PI*2; ring.push(new THREE.Vector3(4.0*Math.cos(a),0,4.0*Math.sin(a))); } VX.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring),new THREE.LineBasicMaterial({color:0xf6a03f,transparent:true,opacity:0.18})));
  VX.trailHist=Array.from({length:VX.trailsN},()=>[]);
  vxSeek(0);
}
function vxStep(dt){
  VX.u=Math.min(0.985,VX.u+dt); const ell=Math.pow(1-VX.u,VX.gam); VX.ell=ell;
  const Smax=Math.min(1/(ell*ell),40); const N=VX.N; let maxw=0, minw=1e30; if(!VX.w){ VX.w=new Float32Array(N); VX.S=new Float32Array(N).fill(1); VX.str=new Float32Array(N); }
  for(let i=0;i<N;i++){
    const r0=VX.rho0[i]; const S=1+(Smax-1)*Math.exp(-r0*r0/3.2); const rho=r0/Math.sqrt(S); const z=VX.z0[i]*S; VX.str[i]=dt>0?Math.log(S/VX.S[i])/dt:0; VX.S[i]=S;
    const w=VX.circ/(rho*rho+0.09*ell*ell+0.0015); const dth=Math.min(w*dt*3.0,0.6); VX.th[i]+=dth; VX.w[i]=w; if(w>maxw)maxw=w; if(w<minw)minw=w;
    const th=VX.th[i]; VX.pos[3*i]=rho*Math.cos(th); VX.pos[3*i+1]=z; VX.pos[3*i+2]=rho*Math.sin(th);
  }
  // colour by angular speed on a log scale between this frame's own min and max, so the core is the only bright thing
  const lr=Math.log(maxw/minw)||1; for(let i=0;i<N;i++){ const u=Math.pow(Math.log(VX.w[i]/minw)/lr,2.4); const c=heatRGB(u); VX.col[3*i]=c[0]/255; VX.col[3*i+1]=c[1]/255; VX.col[3*i+2]=c[2]/255; }
  VX.maxw=maxw; VX.points.geometry.attributes.position.needsUpdate=true; VX.points.geometry.attributes.color.needsUpdate=true;
  for(let k=0;k<VX.trailsN;k++){ const i=VX.trailIdx[k]; const h=VX.trailHist[k]; const lp=h[h.length-1]; if(!lp||Math.hypot(VX.pos[3*i]-lp[0],VX.pos[3*i+1]-lp[1],VX.pos[3*i+2]-lp[2])>0.02) h.push([VX.pos[3*i],VX.pos[3*i+1],VX.pos[3*i+2],VX.str[i]]); trimTrail(h,VX.trailLen); }
}
function vxSeek(u){ VX.u=0; for(let i=0;i<VX.N;i++) VX.th[i]=VX.th0[i]; VX.trailHist.forEach(h=>h.length=0); for(let i=0;i<500;i++){ vxStep(0.004); VX.u=0; } const n=Math.max(1,Math.round(u/0.0025)); for(let i=0;i<n;i++) vxStep(u/n); VX.u=u; $('r-xt').value=u; $('v-xt').textContent=u.toFixed(3); }
function drawVortex(dtFrame){ ctx.clearRect(0,0,stage.clientWidth,stage.clientHeight);
  if(VX.playing){ vxStep(dtFrame*VX.spd*0.12); if(VX.u>=0.985){ VX.playing=false; $('x-play').textContent='play'; } $('r-xt').value=VX.u; $('v-xt').textContent=VX.u.toFixed(3); }
  VX.bundle.set(VX.trailHist,TOG.trails);
  const rr=VX.renderer; rr.setScissorTest(false); rr.clear(); const Hv=stageH(); rr.setViewport(0,SCRUB_H,stage.clientWidth,Hv); rr.setScissor(0,SCRUB_H,stage.clientWidth,Hv); rr.setScissorTest(true); VX.camera.aspect=stage.clientWidth/Hv; VX.camera.updateProjectionMatrix();
  VX.controls.autoRotate=TOG.spin; VX.controls.update(); rr.render(VX.scene,VX.camera); rr.setScissorTest(false);
  const ell=VX.ell||1;
  $('x-ro').innerHTML=[['<i>T</i><sub>*</sub> − <i>t</i>',fmtE(1-VX.u)],['core length ℓ',fmtE(ell)],['sup|<i>u</i>| ∼ ℓ<sup>−1</sup>',fmtE(1/ell)],['vorticity ∼ ℓ<sup>−2</sup>',fmtE(1/(ell*ell))],['energy ∼ ℓ',fmtE(ell)],['enstrophy ∼ ℓ<sup>−1</sup>',fmtE(1/ell)],['∫ enstrophy dt (γ=½)',fmtE(2*(1-Math.sqrt(1-VX.u)))]]
    .map(([k,v])=>`<span class="k">${k}</span><span class="n">${v}</span>`).join('');
}

/* ═══════════════════════════════════════════════
   FOUNDATIONS — equations · burgers · flow 2d · flow 3d
   Layout rule: every panel has a measured header block above it; panels are placed below their header.
   ═══════════════════════════════════════════════ */
const plotBox=(x,y,w,h)=>{ ctx.strokeStyle=COL.border; ctx.strokeRect(x+.5,y+.5,w-1,h-1); };
let frameNo=0;
function hdr(id,html,x,y,w,align){ ov(id,html,x,y,{w,cls:'hdr',align}); const c=ovCache.get(id); if(c.h==null||c.hw!==w||c.hsrc!==html||frameNo%40===0){ c.h=c.el.offsetHeight; c.hw=w; c.hsrc=html; } return c.h+8; }
function logPlot(x,y,w,h,series,tmax,lo,hi,opts={}){
  plotBox(x,y,w,h); ctx.save(); ctx.beginPath(); ctx.rect(x,y,w,h); ctx.clip();
  const px=t=>x+t/tmax*w, py=v=>y+h-(v-lo)/(hi-lo)*h;
  for(let g=Math.ceil(lo);g<=hi;g++){ ctx.strokeStyle='rgba(252,180,120,0.07)'; ctx.beginPath(); ctx.moveTo(x,py(g)); ctx.lineTo(x+w,py(g)); ctx.stroke(); label('10^'+g,x+w-4,py(g)-6,COL.faint,9,'right'); }
  for(const s of series){ ctx.beginPath(); let f=true; ctx.setLineDash(s.dash||[]); for(const [t,v] of s.pts){ const vv=Math.log10(Math.max(v,1e-30)); if(!isFinite(vv)) continue; const X=px(t),Y=Math.max(y-5,Math.min(y+h+5,py(vv))); f?ctx.moveTo(X,Y):ctx.lineTo(X,Y); f=false; } ctx.strokeStyle=s.col; ctx.lineWidth=s.width||1.4; ctx.stroke(); ctx.setLineDash([]); }
  if(opts.cursor!=null){ ctx.strokeStyle='rgba(243,238,238,0.35)'; ctx.setLineDash([2,3]); ctx.beginPath(); ctx.moveTo(px(opts.cursor),y); ctx.lineTo(px(opts.cursor),y+h); ctx.stroke(); ctx.setLineDash([]); }
  ctx.restore(); let ly=y+h-8; for(const s of [...series].reverse()){ if(s.label){ label(s.label,x+6,ly,s.col,10); ly-=12; } }
}
class Timeline{ constructor(cap,dt){ this.cap=cap; this.dt=dt; this.dt0=dt; this.frames=[]; this.view=-1; }
  push(t,make){ const last=this.frames[this.frames.length-1]; if(last&&t-last.t<this.dt-1e-9) return; this.frames.push(make()); if(this.frames.length>this.cap){ this.frames=this.frames.filter((_,i)=>i%2===0); this.dt*=2; } }
  clear(){ this.frames=[]; this.view=-1; this.dt=this.dt0; }
  current(){ return this.view<0?this.frames[this.frames.length-1]:this.frames[this.view]; }
  bind(rid,lid,onScrub){ this.range=$(rid); this.label=$(lid); this.range.addEventListener('input',()=>{ const i=parseInt(this.range.value); this.view=(i>=this.frames.length-1)?-1:i; onScrub(); }); }
  sync(){ const n=this.frames.length; this.range.max=Math.max(0,n-1); if(this.view<0) this.range.value=n-1; const f=this.current(); this.label.textContent=f?('t = '+f.t.toFixed(2)+(this.view<0?'  live':'')):'—'; }
}
const M=22; // margin
function stageDims(){ const W=stage.clientWidth,H=stageH(); const narrow=W<760; OV.style.fontSize=(narrow?0.86:Math.min(1,0.8+W/4000))+'rem'; return {W,H,narrow}; }

/* ─── Equations ─── */
const EQ={H:null,dirty:true}; function eqNew(){ EQ.H=helmholtz(64); EQ.dirty=true; }
$('e-new').onclick=eqNew; eqNew();
const eqCvs=[0,1,2].map(()=>{ const c=document.createElement('canvas'); c.width=64; c.height=64; const x=c.getContext('2d'); return {c,x,img:x.createImageData(64,64)}; }); // one scratch canvas per panel: a shared one gets blitted after it has been overwritten (deferred canvas copies)
function eqPanel(idx,x,y,S,scalar,scale,ax,ay,arrowCol){ const {c:eqCv,x:eqctx,img:eqimg}=eqCvs[idx]; const n=64,d=eqimg.data; for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const p=i+n*(n-1-j); const c=divRGB(scalar[p]/scale); const k=4*(j*n+i); d[k]=c[0];d[k+1]=c[1];d[k+2]=c[2];d[k+3]=255; }
  eqctx.putImageData(eqimg,0,0); ctx.imageSmoothingEnabled=true; ctx.drawImage(eqCv,x,y,S,S); plotBox(x,y,S,S);
  const m=13, cell=S/m; let vmax=1e-9; for(let p=0;p<n*n;p++) vmax=Math.max(vmax,Math.hypot(ax[p],ay[p]));
  for(let j=0;j<m;j++) for(let i=0;i<m;i++){ const gi=Math.floor((i+.5)/m*n), gj=Math.floor((j+.5)/m*n), p=gi+n*gj; const vx=ax[p]/vmax, vy=ay[p]/vmax; const cx=x+(i+.5)*cell, cy=y+S-(j+.5)*cell; arrow(cx-vx*cell*.45,cy+vy*cell*.45,cx+vx*cell*.45,cy-vy*cell*.45,arrowCol,1.1); } }
function drawEquations(force){ frameNo++; if(!EQ.dirty&&!force&&frameNo%40) return; EQ.dirty=false; const {W,H,narrow}=stageDims(); ctx.clearRect(0,0,W,H); const H_=EQ.H;
  let pmax=0; for(let p=0;p<64*64;p++) pmax=Math.max(pmax,Math.abs(H_.phi[p]));
  ovBegin();
  const h0=hdr('eq-top',R`$f=\mathbb{P}f+\nabla\varphi$ &nbsp;·&nbsp; $-\Delta\varphi=-\nabla\!\cdot f$ &nbsp;·&nbsp; $\mathbb{P}=I-\nabla\Delta^{-1}\nabla\!\cdot$<br>Any smooth vector field is a divergence-free field plus a gradient. The pressure gradient is exactly the part Navier–Stokes discards, every instant.`,W/2,M,Math.min(820,W-2*M),'center');
  const P=[[H_.div,H_.divMax,H_.fx,H_.fy,'rgba(243,238,238,0.85)',R`$f$ — an arbitrary smooth field; colour is $\nabla\!\cdot f$`],
           [H_.div.map(()=>0),1,H_.wx,H_.wy,COL.yellow,R`$\mathbb{P}f$ — the divergence-free part the fluid keeps; $\nabla\!\cdot\mathbb Pf\approx0$`],
           [H_.phi,pmax,H_.gx,H_.gy,COL.blue,R`$\nabla\varphi$ — removed by pressure; colour is the potential $\varphi$`]];
  if(!narrow){ const gap=(W-2*M)*0.04, S=Math.min((W-2*M-2*gap)/3, H-M-h0-90); const x0=(W-3*S-2*gap)/2; let hh=0; P.forEach((p,i)=>hh=Math.max(hh,hdr('eq-h'+i,p[5],x0+i*(S+gap),M+h0,S)));
    const gy=M+h0+hh; P.forEach((p,i)=>eqPanel(i,x0+i*(S+gap),gy,S,p[0],p[1],p[2],p[3],p[4]));
    serifLabel('=',x0+S+gap/2,gy+S/2,COL.dim,30,'center'); serifLabel('+',x0+2*S+1.5*gap,gy+S/2,COL.dim,30,'center'); }
  else { let y=M+h0; const S=Math.min(W-2*M,(H-y-3*60)/3-M); P.forEach((p,i)=>{ const hh=hdr('eq-h'+i,p[5],M,y,W-2*M); eqPanel(i,M,y+hh,S,p[0],p[1],p[2],p[3],p[4]); y+=hh+S+M; }); }
  ovEnd();
  $('e-ro').innerHTML=[['max |∇·f|',fmt(H_.divMax,3)],['max |∇·Pf|',H_.divProjMax.toExponential(1)],['grid','64² spectral']].map(([k,v])=>`<span class="k">${k}</span><span class="n">${v}</span>`).join(''); }

/* ─── Burgers ─── */
const BG=new Burgers(1024); BG.playing=true; BG.spd=1; BG.tEnd=3; const BT=new Timeline(400,0.01); const BW=256, BROWS=301; const bgWF=new Uint8ClampedArray(BW*BROWS*4); let bgRows=0;
const bgNu=$('r-bnu'); const bgNuUpd=()=>{ BG.nu=Math.pow(10,parseFloat(bgNu.value)); $('v-bnu').textContent=BG.nu.toFixed(4); }; bgNu.addEventListener('input',()=>{bgNuUpd(); bgReset();}); bgNuUpd();
$('r-bspd').addEventListener('input',e=>{BG.spd=parseFloat(e.target.value);$('v-bspd').textContent=BG.spd.toFixed(1)+'×'});
function bgSnap(){ BT.push(BG.t,()=>({t:BG.t,u:Float32Array.from(BG.u)})); const row=Math.round(BG.t/BG.tEnd*(BROWS-1)); while(bgRows<=row&&bgRows<BROWS){ for(let i=0;i<BW;i++){ const c=divRGB(BG.u[Math.floor(i/BW*BG.n)]/1.2); const k=4*(bgRows*BW+i); bgWF[k]=c[0];bgWF[k+1]=c[1];bgWF[k+2]=c[2];bgWF[k+3]=255; } bgRows++; } }
function bgReset(){ BG.setIC(); BG.record(); BT.clear(); bgRows=0; bgSnap(); BG.playing=true; $('b-play').textContent='pause'; }
function bgResumeFromView(){ if(BT.view<0) return; const fr=BT.frames[BT.view]; const n=BG.n; for(let i=0;i<n;i++){ BG.ur[i]=fr.u[i]; BG.ui[i]=0; } fft1(BG.ur,BG.ui,n,false); BG.t=fr.t; BG.phys(); BG.hist=BG.hist.filter(h=>h.t<=fr.t+1e-9); BT.frames.length=BT.view+1; BT.view=-1; bgRows=Math.min(BROWS,Math.round(fr.t/BG.tEnd*(BROWS-1))+1); }
$('b-play').onclick=()=>{ BG.playing=!BG.playing; if(BG.playing) bgResumeFromView(); $('b-play').textContent=BG.playing?'pause':'play'; }; $('b-reset').onclick=bgReset;
BT.bind('r-btl','v-btl',()=>{ BG.playing=false; $('b-play').textContent='play'; });
document.querySelectorAll('[data-bic]').forEach(b=>b.onclick=()=>{ document.querySelectorAll('[data-bic]').forEach(x=>x.classList.toggle('on',x===b)); BG.setIC(b.dataset.bic); BG.record(); BT.clear(); bgRows=0; bgSnap(); });
bgReset();
function inviscidU(x,t){ let xi=x; for(let it=0;it<30;it++){ const u=BG.u0(xi), du=(BG.u0(xi+1e-5)-BG.u0(xi-1e-5))/2e-5; const g=xi+t*u-x; const dg=1+t*du; if(Math.abs(dg)<1e-6) break; xi-=g/dg; if(Math.abs(g)<1e-10) break; } return BG.u0(xi); }
const bgWFcv=document.createElement('canvas'); bgWFcv.width=BW; bgWFcv.height=BROWS; const bgWFctx=bgWFcv.getContext('2d');
function bgProfile(x0,y0,pw,ph,U,T,tb){ const n=BG.n; plotBox(x0,y0,pw,ph); const umax=1.6; const px=i=>x0+i/n*pw, py=u=>y0+ph/2-u/umax*ph/2;
  ctx.strokeStyle='rgba(252,180,120,0.12)'; ctx.beginPath(); ctx.moveTo(x0,py(0)); ctx.lineTo(x0+pw,py(0)); ctx.stroke();
  // motion arrows: each point moves right at speed u
  for(let m=1;m<12;m++){ const i=Math.floor(m/12*n); const u=U[i]; if(Math.abs(u)<0.08) continue; arrow(px(i),py(u),px(i)+u*pw/12,py(u),'rgba(243,238,238,0.35)',1); }
  ctx.setLineDash([2,4]); ctx.strokeStyle='rgba(243,238,238,0.3)'; ctx.beginPath(); for(let i=0;i<n;i+=2){ const u=BG.u0(2*Math.PI*i/n); i?ctx.lineTo(px(i),py(u)):ctx.moveTo(px(i),py(u)); } ctx.stroke(); ctx.setLineDash([]);
  if(TOG.inviscid&&T<tb*0.985){ ctx.setLineDash([5,4]); ctx.strokeStyle=COL.blue; ctx.lineWidth=1.3; ctx.beginPath(); for(let i=0;i<=200;i++){ const x=2*Math.PI*i/200; const u=inviscidU(x,T); i?ctx.lineTo(x0+i/200*pw,py(u)):ctx.moveTo(x0+i/200*pw,py(u)); } ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle=COL.yellow; ctx.lineWidth=2.2; ctx.beginPath(); for(let i=0;i<n;i+=2){ i?ctx.lineTo(px(i),py(U[i])):ctx.moveTo(px(i),py(U[i])); } ctx.stroke();
  // steepest point and its tangent
  let im=0,qm=0; for(let i=1;i<n-1;i++){ const q=-(U[i+1]-U[i-1])/(2*(2*Math.PI/n)); if(q>qm){qm=q;im=i;} }
  const sx=px(im), sy=py(U[im]); const dxw=Math.min(0.45,0.9/Math.max(qm,1)); const dxp=dxw/(2*Math.PI)*pw, dyp=qm*dxw/umax*ph/2;
  ctx.strokeStyle=COL.red; ctx.lineWidth=1.4; ctx.beginPath(); ctx.moveTo(sx-dxp,sy-dyp); ctx.lineTo(sx+dxp,sy+dyp); ctx.stroke(); ctx.fillStyle=COL.red; ctx.beginPath(); ctx.arc(sx,sy,3.5,0,7); ctx.fill();
  label('steepest slope  q = '+qm.toFixed(2),sx+8,sy-14,COL.red,10,sx>x0+pw*0.6?'right':'left');
  label('u(x,t)',x0+pw-6,y0+ph-14,COL.yellow,10,'right'); label('u₀',x0+pw-6,y0+ph-28,'rgba(243,238,238,0.55)',10,'right'); if(TOG.inviscid&&T<tb*0.985) label('inviscid (characteristics)',x0+pw-6,y0+ph-42,COL.blue,10,'right');
  label('x →',x0+4,y0+ph-8,COL.faint,9); return qm; }
function bgWaterfall(x0,y0,w,h,T,tb){ plotBox(x0,y0,w,h); const img=new ImageData(bgWF,BW,BROWS); bgWFctx.putImageData(img,0,0);
  ctx.save(); ctx.beginPath(); ctx.rect(x0,y0,w,h); ctx.clip(); ctx.imageSmoothingEnabled=true;
  // rows: time upward. draw only computed rows, mapped so t=0 is the bottom
  const rh=h/(BROWS-1); const rows=Math.max(1,bgRows); ctx.save(); ctx.translate(0,y0+h); ctx.scale(1,-1); ctx.drawImage(bgWFcv,0,0,BW,rows,x0,0,w,rows*rh); ctx.restore();
  if(TOG.chars){ const nl=36; for(let m=0;m<nl;m++){ const xi=2*Math.PI*m/nl, u=BG.u0(xi); const tEnd=BG.tEnd; ctx.strokeStyle='rgba(243,238,238,0.55)'; ctx.lineWidth=0.8; ctx.setLineDash(tb<tEnd?[]:[]); ctx.beginPath(); ctx.moveTo(x0+xi/(2*Math.PI)*w,y0+h); const t1=Math.min(tEnd,tb); ctx.lineTo(x0+((xi+u*t1)/(2*Math.PI))*w,y0+h-t1/tEnd*h); ctx.stroke();
      if(t1<tEnd){ ctx.setLineDash([2,4]); ctx.strokeStyle='rgba(243,238,238,0.2)'; ctx.beginPath(); ctx.moveTo(x0+((xi+u*t1)/(2*Math.PI))*w,y0+h-t1/tEnd*h); ctx.lineTo(x0+((xi+u*tEnd)/(2*Math.PI))*w,y0); ctx.stroke(); ctx.setLineDash([]); } }
    // wrap-around copies for lines leaving the domain
  }
  if(tb<BG.tEnd){ ctx.setLineDash([4,3]); ctx.strokeStyle=COL.red; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(x0,y0+h-tb/BG.tEnd*h); ctx.lineTo(x0+w,y0+h-tb/BG.tEnd*h); ctx.stroke(); ctx.setLineDash([]); label('t_b — characteristics cross; inviscid profile would be vertical',x0+6,y0+h-tb/BG.tEnd*h-9,COL.red,10); }
  ctx.strokeStyle=COL.yellow; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(x0,y0+h-T/BG.tEnd*h); ctx.lineTo(x0+w,y0+h-T/BG.tEnd*h); ctx.stroke(); label('now',x0+w-6,y0+h-T/BG.tEnd*h-8,COL.yellow,10,'right');
  ctx.restore(); label('t ↑',x0+4,y0+10,COL.faint,9); label('x →',x0+w-4,y0+h-8,COL.faint,9,'right'); }
function drawBurgers(dt){ frameNo++; const {W,H,narrow}=stageDims(); ctx.clearRect(0,0,W,H);
  if(BG.playing){ let adv=dt*BG.spd*0.45; const h=0.002; while(adv>0&&BG.t<BG.tEnd){ BG.step(h); adv-=h; if(BG.t-BG.hist[BG.hist.length-1].t>0.01) BG.record(); bgSnap(); } if(BG.t>=BG.tEnd){ BG.playing=false; $('b-play').textContent='play'; } }
  BT.sync(); const fr=BT.current(); const U=fr.u, T=fr.t; const tb=1/Math.max(BG.q0,1e-9);
  const hProf=R`$\partial_t u+u\,\partial_x u=\nu\,\partial_{xx}u$ &nbsp; with $\nu=$`+BG.nu.toFixed(4)+R`, $t=$`+T.toFixed(2)+R`. &nbsp; Each point of the profile moves to the right at its own height $u$ (small arrows): crests overtake troughs, so the front between them steepens. Viscosity pulls the front back toward a smooth ramp. The red mark is the steepest point.`;
  const hWF=R`Space–time: colour is $u(x,t)$, time runs upward. With $\nu=0$, $u$ is constant along the white characteristics $x=\xi+u_0(\xi)\,t$, so the colour bands would follow them exactly and collide at $t_b=1/\max(-u_0')=$`+tb.toFixed(2)+R`. With $\nu>0$ the bands merge into one sharp line instead — the viscous shock — and nothing diverges.`;
  const hP1=R`Steepest slope $q(t)=\max_x(-\partial_xu)$. Along a characteristic $\dot q=-q^2$, so the inviscid slope is $q_0/(1-q_0t)$ (dashed) and reaches $\infty$ at $t_b$. The viscous slope follows it, then saturates near $(\Delta u)^2/8\nu$ — a shock of width $\sim4\nu/\Delta u$.`;
  const slope=BG.hist.map(h=>[h.t,h.q]); const inv=[]; for(let t=0;t<tb*0.99;t+=0.01) inv.push([t,BG.q0/(1-BG.q0*t)]);
  const P1=(x,y,w,h)=>logPlot(x,y,w,h,[{pts:inv,col:'rgba(246,160,63,0.6)',dash:[4,3],label:'inviscid  q₀/(1−q₀t)'},{pts:slope,col:COL.yellow,width:1.8,label:'viscous, measured'},{pts:[[0,4/(8*BG.nu)],[BG.tEnd,4/(8*BG.nu)]],col:COL.red,dash:[2,3],label:'(Δu)²/8ν'}],BG.tEnd,-0.2,Math.log10(Math.max(50,1/BG.nu*4))+0.3,{cursor:T});
  ovBegin(); let qm=0;
  if(!narrow){ const lw=(W-3*M)*0.62, rw=W-3*M-lw, rx=M+lw+M; let y=M; const h1=hdr('b-h1',hProf,M,y,lw); y+=h1; const ph=(H-y-M)*0.36; qm=bgProfile(M,y,lw,ph,U,T,tb); y+=ph+M; const h2=hdr('b-h2',hWF,M,y,lw); y+=h2; bgWaterfall(M,y,lw,H-y-M,T,tb);
    let yr=M; const h3=hdr('b-h3',hP1,rx,yr,rw); yr+=h3; P1(rx,yr,rw,Math.min(H-yr-M,(H-yr-M)*0.6)); }
  else { const w=W-2*M; let y=M; const h1=hdr('b-h1',hProf,M,y,w); y+=h1; const avail=H-y-2*M; const ph=avail*0.26; qm=bgProfile(M,y,w,ph,U,T,tb); y+=ph+M; const h2=hdr('b-h2',hWF,M,0,w), h3=hdr('b-h3',hP1,M,0,w); const rest=H-y-h2-h3-2*M; hdr('b-h2',hWF,M,y,w); y+=h2; bgWaterfall(M,y,w,rest*0.6,T,tb); y+=rest*0.6+M; hdr('b-h3',hP1,M,y,w); y+=h3; P1(M,y,w,rest*0.4); }
  ovEnd();
  $('b-ro').innerHTML=[['t (shown)',T.toFixed(3)],['steepest slope q',fmtE(qm)],['inviscid q₀/(1−q₀t)',T<tb?fmtE(BG.q0/(1-BG.q0*T)):'∞ (past t_b)'],['breaking time t_b',tb.toFixed(3)],['viscous ceiling (Δu)²/8ν',fmtE(4/(8*BG.nu))],['shock width 4ν/Δu',fmtE(2*BG.nu)],['energy ½∫u²',fmt(BG.energy(),4)]].map(([k,v])=>`<span class="k">${k}</span><span class="n">${v}</span>`).join('');
}

/* ─── Flow 2D ─── */
const F2=new Flow2D(128); F2.playing=true; F2.spd=1; const FT=new Timeline(300,0.04);
const f2Nu=$('r-fnu'); const f2NuUpd=()=>{ F2.nu=Math.pow(10,parseFloat(f2Nu.value)); $('v-fnu').textContent=F2.nu.toFixed(4)+'  (Re≈'+(2*Math.PI/F2.nu).toFixed(0)+')'; }; f2Nu.addEventListener('input',()=>{f2NuUpd(); f2Reset();}); f2NuUpd();
$('r-fspd').addEventListener('input',e=>{F2.spd=parseFloat(e.target.value);$('v-fspd').textContent=F2.spd.toFixed(1)+'×'});
function f2Snap(){ FT.push(F2.t,()=>{ const n=F2.n,m=16,ux=new Float32Array(m*m),uy=new Float32Array(m*m); for(let j=0;j<m;j++) for(let i=0;i<m;i++){ const p=Math.floor((i+.5)/m*n)+n*Math.floor((j+.5)/m*n); ux[i+m*j]=F2.u[p]; uy[i+m*j]=F2.v[p]; } return {t:F2.t,om:Float32Array.from(F2.om),ux,uy,max:F2.maxOm()}; }); }
function f2Reset(){ F2.setIC(); F2.lastE=F2.E0; F2.lastZ=F2.Z0; F2.lastMax=F2.w0max; F2.record(); FT.clear(); f2Snap(); F2.playing=true; $('f-play').textContent='pause'; }
function f2ResumeFromView(){ if(FT.view<0) return; const fr=FT.frames[FT.view]; const N=F2.N; for(let p=0;p<N;p++){ F2.wr[p]=fr.om[p]; F2.wi[p]=0; } fftND(F2.wr,F2.wi,F2.dims,false); F2.wr[0]=0; F2.wi[0]=0; F2.t=fr.t; F2.rhs(F2.wr,F2.wi,F2.S[0],F2.S[1]); F2.lastE=F2.energy(); F2.lastZ=F2.enstrophy(); F2.lastMax=F2.maxOm(); F2.hist=F2.hist.filter(h=>h.t<=fr.t+1e-9); FT.frames.length=FT.view+1; FT.view=-1; }
$('f-play').onclick=()=>{ F2.playing=!F2.playing; if(F2.playing) f2ResumeFromView(); $('f-play').textContent=F2.playing?'pause':'play'; }; $('f-reset').onclick=f2Reset; $('f-step').onclick=()=>{F2.playing=false;$('f-play').textContent='play';f2ResumeFromView();F2.step(F2.dtCFL());F2.record();F2.rhs(F2.wr,F2.wi,F2.S[0],F2.S[1]);f2Snap();};
FT.bind('r-ftl','v-ftl',()=>{ F2.playing=false; $('f-play').textContent='play'; });
document.querySelectorAll('[data-fic]').forEach(b=>b.onclick=()=>{ document.querySelectorAll('[data-fic]').forEach(x=>x.classList.toggle('on',x===b)); F2.setIC(b.dataset.fic); F2.lastE=F2.E0; F2.lastZ=F2.Z0; F2.lastMax=F2.w0max; F2.record(); FT.clear(); f2Snap(); });
f2Reset();
const f2Cv=document.createElement('canvas'); f2Cv.width=128; f2Cv.height=128; const f2ctx=f2Cv.getContext('2d'); const f2img=f2ctx.createImageData(128,128);
const ICTEX={'taylor-green':R`Taylor–Green: $\omega_0=2\sin x\sin y$, so $u\!\cdot\!\nabla\omega\equiv0$ and $\omega=\omega_0e^{-2\nu t}$ exactly`,'lamb-oseen':R`Lamb–Oseen: $\omega=\frac{\Gamma}{4\pi\nu(t_0+t)}e^{-r^2/4\nu(t_0+t)}$, pure diffusion`,'dipole':'a vortex pair propagates by mutual induction','shear':'Kelvin–Helmholtz: shear layers roll up into vortices','random':'like-signed vortices merge; energy moves to large scales'};
function f2Field(gx,gy,S,fr){ const n=F2.n; const scale=TOG.fixed?F2.w0max:Math.max(fr.max,1e-9); const d=f2img.data;
  for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const p=i+n*(n-1-j); const c=divRGB(fr.om[p]/scale); const k=4*(j*n+i); d[k]=c[0];d[k+1]=c[1];d[k+2]=c[2];d[k+3]=255; }
  f2ctx.putImageData(f2img,0,0); ctx.imageSmoothingEnabled=true; ctx.drawImage(f2Cv,gx,gy,S,S); plotBox(gx,gy,S,S);
  if(TOG.arrows){ const m=16, cell=S/m; let vmax=1e-9; for(let p=0;p<m*m;p++) vmax=Math.max(vmax,Math.hypot(fr.ux[p],fr.uy[p])); for(let j=0;j<m;j++) for(let i=0;i<m;i++){ const p=i+m*j; const vx=fr.ux[p]/vmax, vy=fr.uy[p]/vmax; const cx=gx+(i+.5)*cell, cy=gy+S-(j+.5)*cell; arrow(cx-vx*cell*.4,cy+vy*cell*.4,cx+vx*cell*.4,cy-vy*cell*.4,'rgba(243,238,238,0.65)',1); } }
  return scale; }
function drawFlow2D(dt){ frameNo++; const {W,H,narrow}=stageDims(); ctx.clearRect(0,0,W,H);
  if(F2.playing){ let adv=dt*F2.spd*0.8; const t0=performance.now(); while(adv>0&&performance.now()-t0<28){ const h=Math.min(F2.dtCFL(),adv); F2.step(h); adv-=h; if(F2.t-F2.hist[F2.hist.length-1].t>0.02) F2.record(); f2Snap(); } }
  FT.sync(); const fr=FT.current(); const tmax=Math.max(1,F2.t*1.05); const scale=TOG.fixed?F2.w0max:Math.max(fr.max,1e-9);
  const hF=R`$\partial_t\omega+u\!\cdot\!\nabla\omega=\nu\Delta\omega$, &nbsp; $u=\nabla^{\perp}\psi$, $\Delta\psi=\omega$ &nbsp; at $t=$`+fr.t.toFixed(2)+'<br>'+ICTEX[F2.ic]+'. Colour scale ±'+fmt(scale,2)+(TOG.fixed?' (fixed at the initial maximum, so decay shows)':' (auto)')+R`; $128^2$ pseudo-spectral, 2/3 dealiased, RK4.`;
  const hP1=R`$E=\tfrac12\langle|u|^2\rangle$, &nbsp; $Z=\tfrac12\langle\omega^2\rangle$, &nbsp; $\|\omega\|_\infty$ — all three can only decrease in 2D`;
  const hP2=R`$\dot E=-2\nu Z$, checked live: the two curves should coincide`;
  const ex=[]; if(F2.ic==='taylor-green'){ for(let t=0;t<=tmax;t+=tmax/60) ex.push([t,2*Math.exp(-2*F2.nu*t)]); } else if(F2.ic==='lamb-oseen'){ for(let t=0;t<=tmax;t+=tmax/60) ex.push([t,F2.w0max*F2.t0/(F2.t0+t)]); }
  const lo=Math.log10(Math.min(F2.E0,F2.Z0)*0.02), hi=Math.log10(Math.max(F2.w0max,F2.Z0)*1.5);
  const de=[], rhs=[]; const hh=F2.hist; for(let i=1;i<hh.length-1;i++){ const dEdt=(hh[i+1].E-hh[i-1].E)/(hh[i+1].t-hh[i-1].t); de.push([hh[i].t,-dEdt]); rhs.push([hh[i].t,2*F2.nu*hh[i].Z]); }
  const dmax=Math.max(1e-9,...rhs.map(r=>r[1]));
  const P1=(x,y,w,h)=>logPlot(x,y,w,h,[{pts:hh.map(h=>[h.t,h.E]),col:COL.blue,width:1.6,label:'energy'},{pts:hh.map(h=>[h.t,h.Z]),col:COL.yellow,width:1.6,label:'enstrophy'},{pts:hh.map(h=>[h.t,h.m]),col:'rgba(243,238,238,0.7)',label:'max|ω|'},...(ex.length?[{pts:ex,col:COL.red,dash:[4,3],label:'exact'}]:[])],tmax,lo,hi,{cursor:fr.t});
  const P2=(x,y,w,h)=>logPlot(x,y,w,h,[{pts:rhs,col:COL.yellow,width:3,label:'2νZ'},{pts:de,col:COL.blue,width:1.2,label:'−dE/dt, measured'}],tmax,Math.log10(dmax)-2,Math.log10(dmax)+0.4,{cursor:fr.t});
  ovBegin();
  if(!narrow){ const lw=(W-3*M)*0.52, rw=W-3*M-lw, rx=M+lw+M; const h1=hdr('f-h1',hF,M,M,lw); const S=Math.min(lw,H-M-h1-M); f2Field(M,M+h1,S,fr);
    let y=M; const h2=hdr('f-h2',hP1,rx,y,rw); y+=h2; const h3=hdr('f-h3',hP2,rx,0,rw); const ph=(H-y-M-h3-M)/2; P1(rx,y,rw,ph); y+=ph+M; hdr('f-h3',hP2,rx,y,rw); y+=h3; P2(rx,y,rw,ph); }
  else { const w=W-2*M; let y=M; const h1=hdr('f-h1',hF,M,y,w); y+=h1; const h2=hdr('f-h2',hP1,M,0,w), h3=hdr('f-h3',hP2,M,0,w); const S=Math.min(w,(H-y-h2-h3-3*M)*0.5); f2Field(M,y,S,fr); y+=S+M; const ph=(H-y-h2-h3-M)/2; hdr('f-h2',hP1,M,y,w); y+=h2; P1(M,y,w,ph); y+=ph+M; hdr('f-h3',hP2,M,y,w); y+=h3; P2(M,y,w,ph); }
  ovEnd();
  const um=Math.sqrt(2*F2.lastE);
  $('f-ro').innerHTML=[['t (live)',F2.t.toFixed(3)],['energy',fmtE(F2.lastE)],['enstrophy',fmtE(F2.lastZ)],['max|ω| / initial',fmt(F2.lastMax/F2.w0max,4)],['−dE/dt  vs  2νZ',(de.length?fmtE(de[de.length-1][1]):'—')+' · '+fmtE(2*F2.nu*F2.lastZ)],['Re = U·2π/ν',fmtE(um*2*Math.PI/F2.nu)],['dt (CFL)',fmtE(F2.dtCFL())],['steps',F2.steps]].map(([k,v])=>`<span class="k">${k}</span><span class="n">${v}</span>`).join('');
}

/* ─── Flow 3D: particles and tracers advected through the simulated field ─── */
const F3={sim:null,n:32,playing:true,nu:0.01,spd:1,np:7000,nt:110,len:6.0,ic:'column',cylR:2.9}; const GT=new Timeline(240,0);
const f3Nu=$('r-gnu'); const f3NuUpd=()=>{ F3.nu=Math.pow(10,parseFloat(f3Nu.value)); $('v-gnu').textContent=F3.nu.toFixed(4)+'  (Re≈'+(1/F3.nu).toFixed(0)+')'; }; f3Nu.addEventListener('input',()=>{f3NuUpd(); f3Reset();}); f3NuUpd();
$('r-glen').addEventListener('input',e=>{F3.len=parseFloat(e.target.value);$('v-glen').textContent=F3.len.toFixed(1)});
$('r-gw').addEventListener('input',e=>{const w=parseFloat(e.target.value);F3.bundle.setWidth(w);$('v-gw').textContent=w.toFixed(1)});
$('g-play').onclick=()=>{ F3.playing=!F3.playing; if(F3.playing) GT.view=-1; $('g-play').textContent=F3.playing?'pause':'play'; }; $('g-reset').onclick=()=>f3Reset();
GT.bind('r-gtl','v-gtl',()=>{ F3.playing=false; $('g-play').textContent='play'; });
document.querySelectorAll('[data-gic]').forEach(b=>b.onclick=()=>{ document.querySelectorAll('[data-gic]').forEach(x=>x.classList.toggle('on',x===b)); F3.ic=b.dataset.gic; f3Reset(); });
document.querySelectorAll('[data-gn]').forEach(b=>b.onclick=()=>{ document.querySelectorAll('[data-gn]').forEach(x=>x.classList.toggle('on',x===b)); F3.n=parseInt(b.dataset.gn); f3Reset(); });
const F3SCALE=4.3; const W2S=v=>(v/Math.PI-1)*F3SCALE; // sim [0,2π) → world, scaled up so the column fills the pane and runs off the top and bottom like the vortex
function f3Init3D(){ F3.scene=new THREE.Scene(); F3.camera=new THREE.PerspectiveCamera(42,1,0.05,100); F3.camera.position.set(6.0,2.6,6.8); F3.controls=new OrbitControls(F3.camera,c3d); F3.controls.enableDamping=true; F3.controls.autoRotate=true; F3.controls.autoRotateSpeed=0.4; F3.controls.enabled=false;
  const e=new THREE.EdgesGeometry(new THREE.BoxGeometry(2*F3SCALE,2*F3SCALE,2*F3SCALE)); F3.scene.add(new THREE.LineSegments(e,new THREE.LineBasicMaterial({color:0xa85f14,transparent:true,opacity:0.35})));
  const N=F3.np; F3.pos=new Float32Array(N*3); F3.col=new Float32Array(N*3); const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(F3.pos,3)); g.setAttribute('color',new THREE.BufferAttribute(F3.col,3));
  F3.points=new THREE.Points(g,new THREE.PointsMaterial({size:1.7,sizeAttenuation:false,vertexColors:true,transparent:true,opacity:0.8,depthWrite:false})); F3.scene.add(F3.points);
  F3.bundle=new TracerBundle(F3.scene,1.4);
  // open column, laid out like the vortex pane: an axis and one faint equatorial ring, no end caps
  const cyl=new THREE.Group(); const R=F3.cylR/Math.PI*F3SCALE; { const pts=[]; for(let i=0;i<=96;i++){ const a=i/96*6.2832; pts.push(new THREE.Vector3(R*Math.cos(a),0,R*Math.sin(a))); } cyl.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xf6a03f,transparent:true,opacity:0.18}))); }
  cyl.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-9,0),new THREE.Vector3(0,9,0)]),new THREE.LineBasicMaterial({color:0x5a8cc0,transparent:true,opacity:0.35})));
  F3.scene.add(cyl); F3.cyl=cyl; F3.cube=F3.scene.children[0];
  F3.px=new Float32Array(N*3); F3.gen=new Uint16Array(F3.nt); }
function f3Seed(i){ const s=F3.sim; if(F3.ic==='column'){ const r=Math.sqrt(Math.random())*F3.cylR*0.97, a=Math.random()*6.2832; F3.px[3*i]=(Math.PI+r*Math.cos(a)+6.2832)%6.2832; F3.px[3*i+1]=(Math.PI+r*Math.sin(a)+6.2832)%6.2832; F3.px[3*i+2]=Math.PI+(Math.random()*2-1)*0.9*Math.PI/F3SCALE; } else { F3.px[3*i]=Math.random()*6.2832; F3.px[3*i+1]=Math.random()*6.2832; F3.px[3*i+2]=Math.random()*6.2832; } }
function f3Advect(dt,warm){ const s=F3.sim, N=F3.np, v=[0,0,0], w=[0,0,0]; const TP=2*Math.PI; if(!F3.spd_) F3.spd_=new Float32Array(N); 
  const a=[0,0,0], b=[0,0,0]; if(!F3.str) F3.str=new Float32Array(F3.nt);
  const move=(i,h)=>{ let x=F3.px[3*i],y=F3.px[3*i+1],z=F3.px[3*i+2]; s.velAt(x,y,z,v); s.velAt(x+0.5*h*v[0],y+0.5*h*v[1],z+0.5*h*v[2],w); x+=h*w[0]; y+=h*w[1]; z+=h*w[2]; x-=Math.floor(x/TP)*TP; y-=Math.floor(y/TP)*TP; z-=Math.floor(z/TP)*TP; F3.px[3*i]=x; F3.px[3*i+1]=y; F3.px[3*i+2]=z; const sp=Math.hypot(w[0],w[1],w[2]); F3.spd_[i]=sp;
    if(i<F3.nt){ // stretching rate of a line element along the flow: t·(∇u)·t, by finite difference along the tangent
      if(sp>1e-9){ const tx=w[0]/sp,ty=w[1]/sp,tz=w[2]/sp, e=0.06; s.velAt(x+e*tx,y+e*ty,z+e*tz,a); s.velAt(x-e*tx,y-e*ty,z-e*tz,b); F3.str[i]=((a[0]-b[0])*tx+(a[1]-b[1])*ty+(a[2]-b[2])*tz)/(2*e); } else F3.str[i]=0; }
    };
  // tracers: 4 substeps, each pushed to the live trail, trimmed to the arc-length budget
  for(let k=0;k<F3.nt;k++){ for(let q=0;q<4;q++){ move(k,dt/4); const t=F3.tr[k]; const prev=t[t.length-1]; const p=[W2S(F3.px[3*k]),W2S(F3.px[3*k+2]),W2S(F3.px[3*k+1]),F3.str[k]]; if(prev&&(Math.abs(p[0]-prev[0])>0.8*F3SCALE||Math.abs(p[1]-prev[1])>0.8*F3SCALE||Math.abs(p[2]-prev[2])>0.8*F3SCALE)) t.length=0; if(!prev||Math.hypot(p[0]-prev[0],p[1]-prev[1],p[2]-prev[2])>0.02) t.push(p); trimTrail(t,F3.len); } }
  if(!warm) for(let i=F3.nt;i<N;i++) move(i,dt);
  // speed normalisation: 95th percentile of a sample, so hot spots and dead zones both show
  const samp=[]; for(let i=0;i<N;i+=Math.max(1,(N/600)|0)) samp.push(F3.spd_[i]); samp.sort((a,b)=>a-b); F3.s95=Math.max(1e-6,samp[Math.floor(samp.length*0.95)]);
  }
function f3Snap(){ const s=F3.sim; GT.push(s.t,()=>{ const N=F3.np, pos=new Float32Array(N*3), sp=new Float32Array(N); for(let i=0;i<N;i++){ pos[3*i]=W2S(F3.px[3*i]); pos[3*i+1]=W2S(F3.px[3*i+2]); pos[3*i+2]=W2S(F3.px[3*i+1]); sp[i]=F3.spd_?F3.spd_[i]:0; } return {t:s.t,pos,sp,str:F3.str?Float32Array.from(F3.str):new Float32Array(F3.nt),gen:Uint16Array.from(F3.gen)}; }); }
function f3Reset(){ if(!F3.sim||F3.sim.n!==F3.n) F3.sim=new Flow3D(F3.n); F3.sim.nu=F3.nu; F3.sim.setIC(F3.ic); F3.sim.record(); for(let i=0;i<F3.np;i++) f3Seed(i); F3.gen.fill(0); F3.s95=1; F3.spd_=null; F3.tr=Array.from({length:F3.nt},()=>[]);
  const h=F3.sim.dtCFL(); for(let i=0;i<400;i++) f3Advect(h,true); f3Advect(h,false); // warm-up: tracers get their full length through the frozen initial field
  F3.cyl.visible=F3.ic==='column'; F3.cube.visible=F3.ic!=='column'; GT.clear(); f3Snap(); F3.playing=true; $('g-play').textContent='pause'; }
function f3Show(){ const frames=GT.frames, idx=GT.view<0?frames.length-1:GT.view, fr=frames[idx]; if(!fr) return;
  let mx=1e-9,mn=1e30; for(let i=0;i<F3.np;i++){ const v=fr.sp[i]; if(v>mx)mx=v; if(v<mn)mn=v; } mn=Math.max(mn,mx*1e-3); const lr=Math.log(mx/mn)||1;
  for(let i=0;i<F3.np;i++){ F3.pos[3*i]=fr.pos[3*i]; F3.pos[3*i+1]=fr.pos[3*i+1]; F3.pos[3*i+2]=fr.pos[3*i+2]; const u=Math.pow(Math.max(0,Math.log(Math.max(fr.sp[i],mn)/mn))/lr,2.4); const c=inferno(u); F3.col[3*i]=c[0]/255; F3.col[3*i+1]=c[1]/255; F3.col[3*i+2]=c[2]/255; }
  F3.points.geometry.attributes.position.needsUpdate=true; F3.points.geometry.attributes.color.needsUpdate=true;
  let trails;
  if(GT.view<0){ trails=F3.tr; }
  else { trails=[]; for(let k=0;k<F3.nt;k++){ const pts=[]; const gen=fr.gen[k]; let px=null,py=null,pz=null; let acc=0; for(let j=idx;j>=0&&acc<F3.len;j--){ const f=frames[j]; if(f.gen[k]!==gen) break; const x=f.pos[3*k],y=f.pos[3*k+1],z=f.pos[3*k+2]; if(px!==null){ const d=Math.hypot(x-px,y-py,z-pz); if(d>0.8*F3SCALE) break; acc+=d; } pts.push([x,y,z,f.str[k]]); px=x;py=y;pz=z; } pts.reverse(); trails.push(pts); } }
  F3.bundle.set(trails,TOG.trails); }
function drawFlow3D(dt){ frameNo++; const {W,H,narrow}=stageDims(); ctx.clearRect(0,0,W,H); const s=F3.sim;
  if(F3.playing){ const h=s.dtCFL(); s.step(h); s.record(); f3Advect(h,false); f3Snap(); }
  GT.sync(); f3Show(); const fr=GT.current(); const tmax=Math.max(2,s.t*1.05);
  const icTxt={column:R`vortex column: $\omega_z=A\,e^{-\rho^2/r_0^2}$ on a helical axis, plus a weak axial jet — spins, waves, diffuses, decays`,'taylor-green':R`Taylor–Green: $u_0=(\sin x\cos y\cos z,\,-\cos x\sin y\cos z,\,0)$`,abc:R`ABC: $\omega=u$, so $u\times\omega=0$ and the flow decays exactly as $u_0e^{-\nu t}$`}[F3.ic];
  const hV=R`$\partial_t\omega+(u\!\cdot\!\nabla)\omega=(\omega\!\cdot\!\nabla)u+\nu\Delta\omega$ &nbsp; at $t=$`+fr.t.toFixed(2)+'<br>'+icTxt+R`. Particles and tracers ride the computed field; colour is speed. $`+F3.n+R`^3$ spectral, `+s.msStep.toFixed(0)+' ms per step.';
  const hP1=R`$\dot Z=\int\omega\!\cdot\!S\,\omega-\nu\!\int|\nabla\omega|^2$ — enstrophy may grow in 3D`;
  const hP2=R`Beale–Kato–Majda: $\int_0^t\|\omega\|_\infty\,d\tau<\infty\ \Rightarrow$ smooth on $[0,t]$`;
  const ex=[]; if(F3.ic==='abc') for(let t=0;t<=tmax;t+=tmax/50) ex.push([t,s.E0*Math.exp(-2*s.nu*t)]);
  const P1=(x,y,w,h)=>logPlot(x,y,w,h,[{pts:s.hist.map(h=>[h.t,h.E]),col:COL.blue,width:1.6,label:'energy'},{pts:s.hist.map(h=>[h.t,h.Z]),col:COL.yellow,width:1.6,label:'enstrophy'},{pts:s.hist.map(h=>[h.t,h.m]),col:'rgba(243,238,238,0.7)',label:'max|ω|'},...(ex.length?[{pts:ex,col:COL.red,dash:[4,3],label:'ABC exact'}]:[])],tmax,Math.log10(Math.min(s.E0,s.Z0)*0.05),Math.log10(Math.max(s.m0,s.Z0)*4),{cursor:fr.t});
  const P2=(x,y,w,h)=>logPlot(x,y,w,h,[{pts:s.hist.map(h=>[h.t,h.bkm]),col:COL.green,width:1.8,label:'BKM integral'},{pts:s.hist.map(h=>[h.t,2*s.nu*h.Z]),col:COL.yellow,label:'2νZ = −dE/dt'}],tmax,-2.5,Math.log10(Math.max(1,s.bkm)*3)+0.3,{cursor:fr.t});
  const r=VX.renderer; r.setScissorTest(false); r.clear(); const Hv=stageH(); r.setViewport(0,SCRUB_H,stage.clientWidth,Hv); r.setScissor(0,SCRUB_H,stage.clientWidth,Hv); r.setScissorTest(true); F3.camera.aspect=stage.clientWidth/Hv; F3.camera.updateProjectionMatrix();
  F3.controls.autoRotate=TOG.spin; F3.controls.update(); r.render(F3.scene,F3.camera); r.setScissorTest(false);
  ovBegin(); ovEnd();
  // diagnostics live in the mathematics panel
  const c1=$('mp-c1'), c2=$('mp-c2'); if(c1&&c2&&!document.body.classList.contains('mp-collapsed')){ for(const [c,fn,title] of [[c1,P1,hP1],[c2,P2,hP2]]){ const w=c.parentElement.clientWidth-2, h=170; if(c.width!==w*DPR||c.height!==h*DPR){ c.width=w*DPR; c.height=h*DPR; c.style.width=w+'px'; c.style.height=h+'px'; } const pc=c.getContext('2d'); pc.setTransform(DPR,0,0,DPR,0,0); pc.clearRect(0,0,w,h); ctx=pc; fn(0,0,w,h); ctx=MAINCTX; } }
  $('g-ro').innerHTML=[['t (live)',s.t.toFixed(3)],['energy / E₀',fmt(s.lastE/s.E0,4)],['enstrophy / Z₀',fmt(s.lastZ/s.Z0,4)],['max|ω| / initial',fmt(s.lastMax/s.m0,4)],['∫‖ω‖∞ dt',fmt(s.bkm,3)],['particles · tracers',F3.np+' · '+F3.nt],['stretch rate, 95th pct',fmtE(F3.bundle.p95||0)],['ms / step',s.msStep.toFixed(0)]].map(([k,v])=>`<span class="k">${k}</span><span class="n">${v}</span>`).join('');
}
f3Init3D(); f3Reset();


/* ───────── main loop ───────── */
const VIEWS=['equations','burgers','flow2d','flow3d','wave','cascade','vortex'];
const hashView=()=>{ const h=(location.hash||'').replace(/^#/,''); return VIEWS.includes(h)?h:null; };
const FIXED=window.NS_FIXED_VIEW||null; const EMBED=(window.self!==window.top)||/[?&]embed/.test(location.search)||!!FIXED; if(EMBED) document.body.classList.add('embed');
$('chapter-sel').classList.toggle('off',!!FIXED); $('chapter-sel').addEventListener('change',e=>setView(e.target.value));
vxInit(); setView(FIXED||hashView()||'equations'); resize();
window.addEventListener('hashchange',()=>{ if(FIXED) return; const v=hashView(); if(v&&v!==VIEW) setView(v); }); EMBED_READY=!FIXED;
window.addEventListener('error',e=>{ const st=$('status'); st.textContent='error: '+(e.message||'?')+(e.filename?' @ '+e.filename.split('/').pop()+':'+e.lineno:''); st.classList.add('paused'); });
window.addEventListener('unhandledrejection',e=>{ const st=$('status'); st.textContent='error: '+(e.reason&&e.reason.message||e.reason); st.classList.add('paused'); });
let last=performance.now(); let loopErr=null;
function loop(now){
  try{ loopBody(now); }catch(e){ if(!loopErr){ loopErr=e; console.error('[ns-blowup] '+VIEW+' view failed:', e); const st=$('status'); st.textContent='error in '+VIEW+': '+e.message; st.classList.add('paused'); } }
  requestAnimationFrame(loop);
}
function loopBody(now){
  const dt=Math.min(0.05,(now-last)/1000); last=now;
  if(!loopErr){ $('status').textContent = ({wave:WV.playing,vortex:VX.playing,burgers:BG.playing,flow2d:F2.playing,flow3d:F3.playing}[VIEW]??true) ? 'running' : 'paused'; $('status').classList.toggle('paused', $('status').textContent==='paused'); }
  if(VIEW==='equations') drawEquations(false);
  else if(VIEW==='burgers') drawBurgers(dt);
  else if(VIEW==='flow2d') drawFlow2D(dt);
  else if(VIEW==='flow3d') drawFlow3D(dt);
  else if(VIEW==='wave'){ if(WV.playing) wvAdvance(dt*WV.spd*1.4); drawWave(); }
  else if(VIEW==='cascade') drawCascade(dt);
  else drawVortex(dt);
  scrubSync();
}
requestAnimationFrame(loop);
