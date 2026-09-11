// ============================================================================
//  BLOWUP GEOMETRY  ·  figure renderer for the article page
// ----------------------------------------------------------------------------
//  One classic script (no modules, no three.js). It renders the display
//  equations, then draws nine 2D-canvas figures for the essay. Each figure is
//  wrapped in guarded() so one failing figure cannot take down the rest, and its
//  error is shown in the page's #errbar.
//
//  STATIC vs ANIMATED
//  ------------------
//      Static figures push their draw function into STATIC and call it once; a
//      window resize re-runs every STATIC draw at the new width. The two animated
//      figures (steering, and the interactive explorer) drive themselves with
//      requestAnimationFrame instead.
//
//  THE INTERACTIVE FIGURE (guarded 'figure 9', canvas #f-play)
//  ----------------------------------------------------------------------------
//      controls ▶ P (params) ─rebuild()▶ integrate the layered ODE system,
//      saving samples ─▶ draw(): sampleAt(time) ─▶ field + gradient/Ω/cone plots.
//      Structural controls rebuild; time and zoom only redraw.
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ----------------------------------------------------------------------------
//      error bar ........... "errbar"            show real script errors on page
//      equations ........... "data-tex"          KaTeX render of the display eqs
//      guarded wrapper ..... "function guarded"  per-figure error isolation
//      colour + palette .... "function inferno"  inferno map and named colours
//      canvas setup ........ "function setup"    DPR-aware sizing, resize redraw
//      draw helpers ........ "function arrow"    arrow / label / heat
//      figure 1 ............ "figure 1"          affine background
//      figure 2 ............ "figure 2"          one wave, interactive tilt
//      figure 3 ............ "figure 3"          same rate, gradients apart
//      figure 4 ............ "figure 4"          steering animation
//      figure 5 ............ "figure 5"          nested zooms
//      figure 6 ............ "figure 6"          the cone
//      figure 7 ............ "figure 7"          stage lengths
//      figure 8 ............ "figure 8"          vortex tube scalings
//      figure 9 ............ "figure 9"          interactive explorer + ODE system
// ============================================================================
// any error is shown on the page with its real message (the preview sandbox otherwise reports only "Script error.")
window.addEventListener('error',e=>{ const b=document.getElementById('errbar'); b.style.display='block'; b.textContent+='error: '+(e.message||'?')+(e.lineno?' @ line '+e.lineno:'')+'\n'; });
// Render every display equation from its data-tex attribute, falling back to raw
// TeX if KaTeX is missing or throws.
document.querySelectorAll('.eq[data-tex]').forEach(el=>{ if(window.katex){ try{ katex.render(el.dataset.tex,el,{displayMode:true,throwOnError:false}); }catch(err){ el.textContent=el.dataset.tex; } } else el.textContent=el.dataset.tex; });
// Run one figure's setup inside a try/catch so a failure stays local and is shown.
function guarded(name,fn){ try{ fn(); }catch(err){ console.error('['+name+']',err); const b=document.getElementById('errbar'); b.style.display='block'; b.textContent+=name+': '+err.message+'\n'; } }
// inferno colour map: the same degree-6 polynomial fit used by the solver pages.
const _IC=[[0.0002189403691192265,0.001651004631001012,-0.01948089843709184],[0.1065134194856116,0.5639564367884091,3.932712388889277],[11.60249308247187,-3.972853965665698,-15.9423044794981],[-41.70399613139459,17.43639888205313,44.35414519872813],[77.162935699427,-33.40235894210092,-81.80730925738993],[-71.31942824499214,32.62606426397723,73.20951985803202],[25.13112622477341,-12.24266895238567,-23.07032500287172]];
// Map t in [0,1] to an inferno [r,g,b] in 0..255 (Horner evaluation).
function inferno(t){ t=Math.max(0,Math.min(1,t)); const o=[0,0,0]; for(let c=0;c<3;c++){ let v=_IC[6][c]; for(let i=5;i>=0;i--) v=_IC[i][c]+t*v; o[c]=Math.max(0,Math.min(255,v*255)); } return o; }
// [r,g,b] triple to a CSS colour string, and the page's named palette.
const rgb=c=>`rgb(${c[0]|0},${c[1]|0},${c[2]|0})`;
const ACC='#f6a03f',PALE='#fcf1a4',RED='#e34a6a',CYAN='#38bdf8',DIM='#9b8e98',WHITE='rgba(243,238,238,0.85)';
const _fig={}; // canvases are sized to their CSS width; if the page is resized every static figure is redrawn and the animated ones pick up the new size on their next frame
// Size a canvas to its CSS width at device resolution and return {context, W, H};
// cached per id and reused until the width changes.
function setup(id){ const c=document.getElementById(id); const DPR=Math.min(2,devicePixelRatio||1); const W=c.clientWidth, H=parseInt(c.getAttribute('height')); const k=_fig[id]; if(k&&k.W===W) return k; c.width=W*DPR; c.height=H*DPR; c.style.height=H+'px'; const x=c.getContext('2d'); x.setTransform(DPR,0,0,DPR,0,0); return _fig[id]={c,x,W,H}; }
// Registry of static figure draws; a debounced resize re-runs them all.
const STATIC=[]; let _rt=null; window.addEventListener('resize',()=>{ clearTimeout(_rt); _rt=setTimeout(()=>{ for(const f of STATIC) f(); },120); });
// Arrow with a filled head (first argument is the 2D context here).
function arrow(x,x0,y0,x1,y1,col,w=1.2){ const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy); if(L<0.5) return; x.strokeStyle=col;x.fillStyle=col;x.lineWidth=w; x.beginPath();x.moveTo(x0,y0);x.lineTo(x1,y1);x.stroke(); const h=Math.min(8,L*0.5),ux=dx/L,uy=dy/L; x.beginPath();x.moveTo(x1,y1);x.lineTo(x1-h*ux+h*.5*uy,y1-h*uy-h*.5*ux);x.lineTo(x1-h*ux-h*.5*uy,y1-h*uy+h*.5*ux);x.closePath();x.fill(); }
// Monospace canvas label.
function label(x,t,px,py,col=DIM,size=11,al='left'){ x.fillStyle=col; x.font=`${size}px 'JetBrains Mono'`; x.textAlign=al; x.textBaseline='middle'; x.fillText(t,px,py); }
// Rasterise a scalar field fn over [-1,1]² into an n×n image (divergent inferno)
// and blit it to (px,py) at size S.
function heat(x,fn,px,py,S,n=96){ const cv=document.createElement('canvas'); cv.width=n; cv.height=n; const cx=cv.getContext('2d'); const img=cx.createImageData(n,n); const d=img.data; for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const u=-1+2*(i+.5)/n, v=1-2*(j+.5)/n; const c=inferno(0.5+0.5*Math.max(-1,Math.min(1,fn(u,v)))); const k=4*(j*n+i); d[k]=c[0];d[k+1]=c[1];d[k+2]=c[2];d[k+3]=255; } cx.putImageData(img,0,0); x.imageSmoothingEnabled=true; x.drawImage(cv,px,py,S,S); }

// Figure 1: the affine background — hyperbolic strain streamlines drawn over the
// cold-above temperature ramp, with the gradient vector G.
guarded('figure 1',()=>{
/* 1 strain */
STATIC.push(function(){ const {x,W,H}=setup('f-strain'); x.clearRect(0,0,W,H); const S=Math.min(H-30,W*0.5), px=(W-S)/2, py=(H-S)/2; heat(x,(u,v)=>-v,px,py,S);
  x.save(); x.beginPath(); x.rect(px,py,S,S); x.clip(); for(const c of [0.03,0.08,0.15,0.25,0.4,0.6]) for(const sx of [1,-1]) for(const sy of [1,-1]){ x.strokeStyle='rgba(243,238,238,0.45)'; x.lineWidth=1; x.beginPath(); for(let i=1;i<=80;i++){ const u=sx*i/80; const v=sy*c/Math.abs(u); if(Math.abs(v)>1) continue; const X=px+(u+1)/2*S, Y=py+(1-v)/2*S; i===1?x.moveTo(X,Y):x.lineTo(X,Y); } x.stroke(); }
  for(let k=0;k<8;k++){ const a=k/8*6.283; const u=0.55*Math.cos(a), v=0.55*Math.sin(a); const du=u*0.18, dv=-v*0.18; arrow(x,px+(u+1)/2*S,py+(1-v)/2*S,px+(u+du+1)/2*S,py+(1-v-dv)/2*S,WHITE,1.3); } x.restore();
  label(x,'u = D·x  (strain: stretch along x, squeeze along y)',px,py-12,DIM); label(x,'cold',px+S-10,py+14,PALE,11,'right'); label(x,'warm',px+S-10,py+S-14,PALE,11,'right'); arrow(x,px+S+18,py+S*0.3,px+S+18,py+S*0.7,PALE,1.5); label(x,'G',px+S+26,py+S*0.5,PALE,13); }); STATIC.at(-1)();


});
// Figure 2: one plane wave on the background. The tilt slider redraws the field,
// the along-crest velocity arrows, the ζ diagram, and the √A·sin s rate curve.
guarded('figure 2',()=>{
/* 2 wave, interactive tilt */
{ const {x,W,H}=setup('f-wave'); const rs=document.getElementById('r-s'), vs=document.getElementById('v-s');
  function draw(){ const s=parseFloat(rs.value); x.clearRect(0,0,W,H); const S=Math.min(H-40,W*0.46), px=W*0.08, py=(H-S)/2; const lam=9, A=1, Th=0.35; const zx=Math.sin(s), zy=Math.cos(s);
    heat(x,(u,v)=>(-A*v+Th*Math.sin(lam*(zx*u+zy*v)))/1.3,px,py,S,120);
    const n=9, vmax=1; for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const u=-1+2*(i+.5)/n, v=-1+2*(j+.5)/n; const m=Math.sin(lam*(zx*u+zy*v)); const vx=-zy*m, vy=zx*m; const cx=px+(u+1)/2*S, cy=py+(1-v)/2*S, L=S/n*0.42; arrow(x,cx-vx*L*.5,cy+vy*L*.5,cx+vx*L*.5,cy-vy*L*.5,WHITE,1); }
    const cx=px+S/2, cy=py+S/2, R=S*0.36; x.setLineDash([3,4]); x.strokeStyle='rgba(243,238,238,0.35)'; x.beginPath(); x.moveTo(cx,cy-R*1.1); x.lineTo(cx,cy+R*1.1); x.stroke(); x.setLineDash([]);
    arrow(x,cx,cy,cx+R*zx,cy-R*zy,ACC,2.2); label(x,'ζ',cx+R*zx+10,cy-R*zy-8,ACC,14); x.strokeStyle=ACC; x.lineWidth=1; x.beginPath(); x.arc(cx,cy,R*.45,-Math.PI/2,-Math.PI/2+s); x.stroke(); label(x,'s',cx+R*.52*Math.sin(s/2)+6,cy-R*.52*Math.cos(s/2),ACC,12);
    // right: rate curve
    const gx=px+S+50, gw=W-gx-30, gy=py, gh=S; x.strokeStyle='rgba(252,180,120,0.2)'; x.strokeRect(gx+.5,gy+.5,gw-1,gh-1);
    x.strokeStyle=PALE; x.lineWidth=1.8; x.beginPath(); for(let i=0;i<=100;i++){ const ss=i/100*1.3; const X=gx+ss/1.3*gw, Y=gy+gh-Math.sqrt(A)*Math.sin(ss)*gh*0.9; i?x.lineTo(X,Y):x.moveTo(X,Y); } x.stroke();
    const X=gx+s/1.3*gw, Y=gy+gh-Math.sqrt(A)*Math.sin(s)*gh*0.9; x.fillStyle=ACC; x.beginPath(); x.arc(X,Y,4,0,7); x.fill();
    label(x,'growth rate √A·sin s',gx+8,gy+14,DIM); label(x,'s →',gx+gw-6,gy+gh-10,DIM,10,'right'); label(x,'0',gx+4,gy+gh-10,DIM,10); label(x,'π/2',gx+gw*(Math.PI/2/1.3)-2,gy+gh+12,DIM,10,'center');
    label(x,'velocity along the crests: v ∥ Jζ, so v·∇(wave) = 0',px,py+S+16,DIM); vs.textContent='s = '+s.toFixed(2)+' rad · rate '+Math.sin(s).toFixed(3); }
  rs.addEventListener('input',draw); draw(); STATIC.push(draw); }


});
// Figure 3: two waves with the same growth rate but frequencies 100× apart; their
// amplitudes coincide while their gradients λ|Θ| stay two decades apart.
guarded('figure 3',()=>{
/* 3 growth: same rate, different gradient */
STATIC.push(function(){ const {x,W,H}=setup('f-growth'); x.clearRect(0,0,W,H); const M=40, gx=M, gy=16, gw=W-2*M, gh=H-40; x.strokeStyle='rgba(252,180,120,0.2)'; x.strokeRect(gx+.5,gy+.5,gw-1,gh-1);
  const g=0.5, T=12, lo=-4, hi=4; const py=v=>gy+gh-(v-lo)/(hi-lo)*gh; for(let v=lo;v<=hi;v+=2){ x.strokeStyle='rgba(252,180,120,0.08)'; x.beginPath(); x.moveTo(gx,py(v)); x.lineTo(gx+gw,py(v)); x.stroke(); label(x,'10^'+v,gx+gw-4,py(v)-7,DIM,9,'right'); }
  const plot=(fn,col,w,dash)=>{ x.setLineDash(dash||[]); x.strokeStyle=col; x.lineWidth=w; x.beginPath(); for(let i=0;i<=100;i++){ const t=i/100*T; const v=fn(t); i?x.lineTo(gx+i/100*gw,py(v)):x.moveTo(gx+i/100*gw,py(v)); } x.stroke(); x.setLineDash([]); };
  const seed=1e-4; plot(t=>Math.log10(seed*Math.exp(g*t)),PALE,1); plot(t=>Math.log10(seed*Math.exp(g*t)),ACC,1,[4,3]);
  plot(t=>Math.log10(10*seed*Math.exp(g*t)),PALE,3); plot(t=>Math.log10(1000*seed*Math.exp(g*t)),ACC,3,[6,4]);
  label(x,'|Θ|  (both waves — identical)',gx+8,gy+gh-44,PALE,10); label(x,'λ|Θ|,  λ = 10',gx+8,gy+gh-30,PALE,10); label(x,'λ|Θ|,  λ = 1000',gx+8,gy+gh-16,ACC,10); label(x,'t →',gx+gw-6,gy+gh-10,DIM,10,'right'); }); STATIC.at(-1)();


});
// Figure 4: the steering animation. It integrates one growth-then-steer run once
// (with the pulse μ found by shooting), then animates ζ/G rotating together while
// Ω rises, reverses on the overshoot, and lands on zero.
guarded('figure 4',()=>{
/* 4 steering animation */
{ const btn=document.getElementById('b-steer'), lbl=document.getElementById('v-steer'); let t0=performance.now();
  const s=0.5, lam=12, A=1, a=A*Math.sin(s)/lam, g=Math.sqrt(A)*Math.sin(s), L=5, Lam=3; const sm=t=>t<=0?0:t>=1?1:t*t*t*(t*(t*6-15)+10), bump=y=>(y<=0||y>=1)?0:30*y*y*(1-y)*(1-y);
  const z=(tau,mu)=>tau<1?1-sm(tau):tau<=1+1/Lam?-mu*Lam*bump(Lam*(tau-1)):0; const phiOf=(tau,mu)=>Math.asin(Math.max(-0.98,Math.min(0.98,Math.sin(s)*z(tau,mu))));
  // simulate once: growth then steering with shot mu
  // Integrate one run for a trial pulse mu (growth at fixed tilt s, then steering)
  // and return its history; the shooter below picks the mu that lands Ω at zero.
  const dt=0.004; const tg=L/g; function run(mu){ let Th=-1e-3, Om=lam/Math.sqrt(A)*Th, t=0; const H_=[]; const phi=t=>t<tg?s:phiOf(g*(t-tg),mu); const tEnd=tg+(1+1/Lam)/g;
    while(t<tEnd){ const f=(T,O,tt)=>[a*O,lam*Math.sin(phi(tt))*T]; const k1=f(Th,Om,t),k2=f(Th+dt/2*k1[0],Om+dt/2*k1[1],t+dt/2),k3=f(Th+dt/2*k2[0],Om+dt/2*k2[1],t+dt/2),k4=f(Th+dt*k3[0],Om+dt*k3[1],t+dt); Th+=dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]); Om+=dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]); t+=dt; H_.push({t,Th,Om,phi:phi(t)}); } return H_; }
  // Bracket then bisect the pulse amplitude that returns Ω to zero, then keep that run.
  let lo=0,hi=1; while(run(hi).at(-1).Om<0&&hi<64) hi*=2; for(let i=0;i<30;i++){ const m=(lo+hi)/2; run(m).at(-1).Om<0?lo=m:hi=m; } const mu=(lo+hi)/2; const HIST=run(mu); const tEnd=HIST.at(-1).t; const OmMax=Math.max(...HIST.map(h=>Math.abs(h.Om)));
  // Replay button restarts the clock.
  btn.onclick=()=>t0=performance.now();
  // Per-frame draw: index into the precomputed history by wall-clock time.
  function frame(){ const {x,W,H}=setup('f-steer'); const tt=Math.min(tEnd,((performance.now()-t0)/1000)*(tEnd/8)); const i=Math.min(HIST.length-1,Math.floor(tt/dt)); const h=HIST[i]; x.clearRect(0,0,W,H);
    const S=Math.min(H-40,W*0.4), px=W*0.08, py=(H-S)/2, cx=px+S/2, cy=py+S/2, R=S*0.4; x.strokeStyle='rgba(252,180,120,0.2)'; x.strokeRect(px+.5,py+.5,S-1,S-1);
    x.setLineDash([3,4]); x.strokeStyle='rgba(243,238,238,0.35)'; x.beginPath(); x.moveTo(cx,cy-R*1.05); x.lineTo(cx,cy+R*1.05); x.stroke(); x.setLineDash([]);
    const al=s-h.phi; const zx=Math.sin(h.phi), zy=Math.cos(h.phi); const Gx=Math.sin(al), Gy=-Math.cos(al);
    arrow(x,cx,cy,cx+R*zx,cy-R*zy,ACC,2.2); label(x,'ζ',cx+R*zx+10,cy-R*zy-8,ACC,14); arrow(x,cx,cy,cx+R*.8*Gx,cy-R*.8*Gy,PALE,2); label(x,'G',cx+R*.8*Gx-14,cy-R*.8*Gy+12,PALE,14);
    const ph=h.t<tg?'growth':(g*(h.t-tg)<1?'transition':'overshoot'); label(x,ph+(i>=HIST.length-1?' → hold':''),px+6,py+S+14,DIM);
    const z1=Math.sin(h.phi); label(x,'ζ₁ '+(z1>0.005?'> 0  makes Ω':z1<-0.005?'< 0  unmakes Ω':'= 0  off'),px+6,py-10,z1<-0.005?RED:ACC,10);
    const gx=px+S+50, gw=W-gx-30, gy=py, gh=S; x.strokeStyle='rgba(252,180,120,0.2)'; x.strokeRect(gx+.5,gy+.5,gw-1,gh-1); x.strokeStyle='rgba(243,238,238,0.2)'; x.beginPath(); x.moveTo(gx,gy+gh/2); x.lineTo(gx+gw,gy+gh/2); x.stroke();
    x.strokeStyle=CYAN; x.lineWidth=1.8; x.beginPath(); for(let j=0;j<=i;j++){ const q=HIST[j]; const X=gx+q.t/tEnd*gw, Y=gy+gh/2+q.Om/OmMax*gh*0.42; j?x.lineTo(X,Y):x.moveTo(X,Y); } x.stroke();
    x.fillStyle=CYAN; x.beginPath(); x.arc(gx+h.t/tEnd*gw,gy+gh/2+h.Om/OmMax*gh*0.42,4,0,7); x.fill(); label(x,'Ω(t)  vorticity amplitude',gx+8,gy+14,CYAN); label(x,'0',gx+4,gy+gh/2-8,DIM,10); label(x,'t →',gx+gw-6,gy+gh-10,DIM,10,'right');
    x.setLineDash([2,3]); x.strokeStyle=ACC; x.beginPath(); x.moveTo(gx+tg/tEnd*gw,gy); x.lineTo(gx+tg/tEnd*gw,gy+gh); x.stroke(); x.setLineDash([]); label(x,'steer',gx+tg/tEnd*gw+4,gy+gh-14,ACC,10);
    lbl.textContent='pulse μ = '+mu.toFixed(3)+' · Ω at end = '+HIST.at(-1).Om.toExponential(1); requestAnimationFrame(frame); }
  frame(); }


});
// Figure 5: three consecutive zooms toward the origin — each parent layer appears
// as a straight ramp with the next layer's stripes nested inside it.
guarded('figure 5',()=>{
/* 5 nesting: three zooms */
STATIC.push(function(){ const {x,W,H}=setup('f-nest'); x.clearRect(0,0,W,H); const n=3, gap=26, S=Math.min(H-44,(W-(n+1)*gap)/n); const y0=(H-S)/2+6;
  const ang=[0.12,0.26,0.38]; // cumulative tilt of each layer's wavevector
  for(let k=0;k<n;k++){ const px=gap+k*(S+gap);
    heat(x,(u,v)=>{ // parent (k-1) is a straight ramp across this window; layer k is stripes with ~3 wavelengths across it
      const zp=k?[Math.sin(ang[k-1]),Math.cos(ang[k-1])]:[0,1]; const ramp=0.45*(zp[0]*u+zp[1]*v)*(k?-1:-1);
      const zc=[Math.sin(ang[k]),Math.cos(ang[k])]; const stripes=0.55*Math.sin(2*Math.PI*3.2*(zc[0]*u+zc[1]*v));
      return ramp+stripes; },px,y0,S,110);
    x.strokeStyle='rgba(252,180,120,0.25)'; x.strokeRect(px+.5,y0+.5,S-1,S-1);
    if(k<n-1){ const r=S*0.075; x.setLineDash([3,3]); x.strokeStyle=PALE; x.beginPath(); x.arc(px+S/2,y0+S/2,r,0,7); x.stroke(); x.setLineDash([]); x.strokeStyle='rgba(252,241,164,0.4)'; x.beginPath(); x.moveTo(px+S/2+r,y0+S/2); x.lineTo(px+S+gap,y0+2); x.moveTo(px+S/2+r,y0+S/2); x.lineTo(px+S+gap,y0+S-2); x.stroke(); }
    label(x,'layer '+(k+1),px,y0-22,ACC,11); label(x,k?'inside layer '+k+"'s linear zone":'the first wave on the background',px,y0-9,DIM,10); label(x,'zoom ×'+Math.pow(15,k),px+S-4,y0+S+13,ACC,10,'right'); } }); STATIC.at(-1)();


});
// Figure 6: successive layer gradients drawn head-to-tail inside one acute cone;
// the resultant grows without bound while the amplitude discs shrink summably.
guarded('figure 6',()=>{
/* 6 cone */
STATIC.push(function(){ const {x,W,H}=setup('f-cone'); x.clearRect(0,0,W,H); const ox=W*0.18, oy=H*0.82; x.strokeStyle='rgba(252,180,120,0.25)'; x.setLineDash([4,4]); x.beginPath(); x.moveTo(ox,oy); x.lineTo(ox+W*0.75*Math.cos(-0.15),oy+W*0.75*Math.sin(-0.15)); x.moveTo(ox,oy); x.lineTo(ox+W*0.75*Math.cos(-0.75),oy+W*0.75*Math.sin(-0.75)); x.stroke(); x.setLineDash([]); label(x,'acute cone',ox+W*0.72*Math.cos(-0.45),oy+W*0.72*Math.sin(-0.45),DIM,10);
  let X=ox,Y=oy; const N=6; for(let q=0;q<N;q++){ const L=28*Math.pow(1.35,q), a=-0.45+0.22*Math.sin(q*1.7); const nx=X+L*Math.cos(a), ny=Y+L*Math.sin(a); arrow(x,X,Y,nx,ny,rgb(inferno(0.35+0.6*q/(N-1))),2.2); x.fillStyle='rgba(252,241,164,0.35)'; x.beginPath(); x.arc(X+L*0.5*Math.cos(a),Y+L*0.5*Math.sin(a)-14,9*Math.pow(0.62,q),0,7); x.fill(); X=nx; Y=ny; }
  label(x,'gradient at the origin: sum of λΘζ over layers  → ∞',X+8,Y-4,ACC,11); label(x,'the amplitudes that produced it (discs) stay summable',ox,oy+16,DIM,10); }); STATIC.at(-1)();


});
// Figure 7: the finite-time schedule as stacked stage-length bars. Durations
// collapse fast (here Q=1.5 for visibility; the real Q≥200 hides all but the first).
guarded('figure 7',()=>{
/* 7 stage lengths */
STATIC.push(function(){ const {x,W,H}=setup('f-time'); x.clearRect(0,0,W,H); const Q=1.5, l1=4, L=3; const sig=[1]; const dur=[]; for(let q=1;q<=14;q++){ const ln=Math.pow(Q,q-1)*l1; const A=Math.exp(ln/8); const sq=q===1?0.3:Math.min(L*sig[q-2]/sig[q-1],1.2); dur.push((L+3)/(sig[q-1]*Math.sin(sq))); sig.push(Math.sqrt((q>1?sig[q-1]*sig[q-1]:1)+A)); }
  const T=dur.reduce((a,b)=>a+b,0); let X=30; const w=W-60, y=H/2-22, h=44; for(let q=0;q<dur.length;q++){ const ww=dur[q]/T*w; x.fillStyle=rgb(inferno(0.25+0.7*q/dur.length)); x.fillRect(X,y,Math.max(ww,1),h); if(ww>26) label(x,'q='+(q+1),X+ww/2,y+h/2,'#0a0810',10,'center'); X+=ww; }
  label(x,'0',30,y+h+16,DIM,10); label(x,'T∗ = '+T.toFixed(2),30+w,y+h+16,RED,10,'right'); label(x,'stage lengths (display exponent Q = 1.5; the real Q ≥ 200 makes every bar after the second invisible)',30,y-16,DIM,10); }); STATIC.at(-1)();


});
// Figure 8: a material vortex tube before and after halving its length ℓ (radius
// halves, length quadruples, spin quadruples), plus the three ℓ-scalings on a log axis.
guarded('figure 8',()=>{
/* 8 tube under strain: before / after, plus the scalings */
STATIC.push(function(){ const {x,W,H}=setup('f-tube'); x.clearRect(0,0,W,H);
  const drawTube=(cx,cy,R,Lh,turns,col,lw)=>{ x.strokeStyle='rgba(243,238,238,0.35)'; x.lineWidth=1; x.beginPath(); x.moveTo(cx-R,cy-Lh); x.lineTo(cx-R,cy+Lh); x.moveTo(cx+R,cy-Lh); x.lineTo(cx+R,cy+Lh); x.stroke();
    for(const sg of [-1,1]){ x.beginPath(); x.ellipse(cx,cy+sg*Lh,R,R*0.3,0,0,7); x.stroke(); }
    x.strokeStyle=col; x.lineWidth=lw; x.beginPath(); const N=400; for(let i=0;i<=N;i++){ const f=i/N; const z=(f-0.5)*2*Lh, a=f*turns*6.283; const X=cx+R*Math.cos(a), Y=cy+z+R*0.3*Math.sin(a); i?x.lineTo(X,Y):x.moveTo(X,Y); } x.stroke(); };
  const cy=H*0.46; const R1=Math.min(70,W*0.09), L1=H*0.16; const ell=0.5; const R2=R1*ell, L2=L1/(ell*ell);
  const c1=W*0.2, c2=W*0.5; drawTube(c1,cy,R1,L1,3,'rgba(56,189,248,0.75)',2); drawTube(c2,cy,R2,L2,3,'rgba(120,220,255,0.95)',3);
  arrow(x,c1+R1+18,cy,c2-R2-18,cy,PALE,1.6); label(x,'axial strain, ℓ → ℓ/2',(c1+c2)/2,cy-14,PALE,10,'center');
  label(x,'radius R',c1,cy+L1+22,DIM,10,'center'); label(x,'length L · 3 windings',c1,cy+L1+35,DIM,10,'center');
  label(x,'radius R/2',c2,cy+L2+22,DIM,10,'center'); label(x,'length 4L · the same 3 windings, spread',c2,cy+L2+35,DIM,10,'center'); label(x,'spins 4× faster',c2,cy-L2-14,CYAN,10,'center');
  // curves vs time
  const gx=W*0.68, gw=W-gx-24, gy=24, gh=H-60; x.strokeStyle='rgba(252,180,120,0.2)'; x.strokeRect(gx+.5,gy+.5,gw-1,gh-1);
  const plot=(fn,col,lab,dy)=>{ x.strokeStyle=col; x.lineWidth=1.8; x.beginPath(); for(let i=0;i<=100;i++){ const u=i/100*0.9; const l=Math.pow(1-u,0.5); const v=Math.log10(fn(l)); const X=gx+i/100*gw, Y=gy+gh-(v+1)/3*gh; i?x.lineTo(X,Y):x.moveTo(X,Y); } x.stroke(); label(x,lab,gx+6,gy+12+dy,col,10); };
  plot(l=>l,'rgba(243,238,238,0.7)','radius ∝ ℓ',0); plot(l=>1/(l*l),CYAN,'length, angular speed ∝ 1/ℓ²',13); plot(l=>l*l*l,ACC,'volume ∝ R²L = const',26);
  label(x,'t → T∗',gx+gw-6,gy+gh-10,DIM,10,'right'); label(x,'log scale',gx+6,gy+gh-10,DIM,9); }); STATIC.at(-1)();


});
// Figure 9: the interactive explorer. P holds every parameter; structural changes
// rebuild the whole construction, while time and zoom only redraw. The ODE system,
// the RK4 integrator, the build loop, and the composite draw all live here.
guarded('figure 9',()=>{
/* 9 explore the construction: the layered affine-wave ODE system, integrated, scrubbable in time and scale */
{ const P={A0:1,lam1:20,ratio:20,s:0.35,sd:0.55,L:5,g:3,n:4,steer:true,lin:true,shear:true,arrows:true,z:0,t:1,play:false,Lam:3}; const UPD={};
  // Bind one slider to P[key]; structural keys schedule a rebuild, z/t only redraw.
  const bind=(id,key,fmt)=>{ const el=document.getElementById(id), vv=document.getElementById(id+'-v'); const upd=()=>{ P[key]=parseFloat(el.value); if(vv) vv.textContent=fmt?fmt(P[key]):P[key]; }; UPD[key]=upd; el.addEventListener('input',()=>{ upd(); if(!['z','t'].includes(key)) scheduleRebuild(); else draw(); }); upd(); };
  // Debounce rebuilds so dragging a slider does not recompute on every input.
  let _rb=null; function scheduleRebuild(){ clearTimeout(_rb); _rb=setTimeout(rebuild,160); }
  bind('x-A0','A0',v=>v.toFixed(2)); bind('x-lam','lam1',v=>v.toFixed(0)); bind('x-r','ratio',v=>'×'+v.toFixed(0)); bind('x-s','s',v=>v.toFixed(2)+' rad'); bind('x-sd','sd',v=>v.toFixed(2)); bind('x-L','L',v=>'e^'+v.toFixed(1)); bind('x-g','g',v=>'×'+v.toFixed(1)); bind('x-n','n',v=>v.toFixed(0)); bind('x-z','z',v=>'×'+Math.pow(10,v).toExponential(1)); bind('x-t','t',v=>'');
  for(const [id,key] of [['x-steer','steer'],['x-lin','lin'],['x-shear','shear'],['x-arrows','arrows']]) document.getElementById(id).addEventListener('change',e=>{ P[key]=e.target.checked; key==='arrows'?draw():scheduleRebuild(); });
  // Play toggles the time animation; randomize sets fresh parameters and rebuilds.
  document.getElementById('x-play').onclick=()=>{ P.play=!P.play; document.getElementById('x-play').textContent=P.play?'pause':'play'; if(P.play) playTick(); };
  const rnd=(a,b)=>a+Math.random()*(b-a); const setv=(id,key,v,dp=2)=>{ const el=document.getElementById(id); el.value=(+v).toFixed(dp); UPD[key](); };
  document.getElementById('x-rand').onclick=()=>{ setv('x-A0','A0',rnd(0.5,2.2)); setv('x-lam','lam1',Math.round(rnd(10,32)),0); setv('x-r','ratio',Math.round(rnd(8,32)),0); setv('x-s','s',rnd(0.15,0.6)); setv('x-sd','sd',rnd(0.35,0.8)); setv('x-L','L',rnd(3,7),1); setv('x-g','g',rnd(2,5),1); setv('x-n','n',Math.round(rnd(3,6)),0);
    P.t=1; document.getElementById('x-t').value=1; P.z=0; document.getElementById('x-z').value=0; UPD.z(); rebuild(); }; // always the finished construction, fully zoomed out
  let auto=false; document.getElementById('x-auto').onclick=()=>{ auto=!auto; document.getElementById('x-auto').textContent=auto?'stop zoom':'auto-zoom'; if(auto) zoomTick(); };
  // Two self-driving loops: playTick advances time, zoomTick ramps magnification.
  function playTick(){ if(!P.play) return; P.t+=0.004; if(P.t>1){ P.t=0; } document.getElementById('x-t').value=P.t; draw(); requestAnimationFrame(playTick); }
  function zoomTick(){ if(!auto) return; P.z+=0.012; if(P.z>4.5) P.z=0; document.getElementById('x-z').value=P.z; draw(); requestAnimationFrame(zoomTick); }

  /* ── the system ──
     state: G0 (background gradient vector); layer j: ζ_j, Θ_j, Ω_j.
     Θ̇_j = −(Jζ_j·G_j)/(λ_j|ζ_j|²) Ω_j        G_j = G0 + Σ_{k<j} λ_kΘ_kζ_k  (older layers are its affine background)
     Ω̇_j = λ_j ζ_{j,1} Θ_j                       horizontal temperature variation makes vorticity
     ζ̇_j = −Dᵀ ζ_j,  Ġ0 = −Dᵀ G0                 D = α̇J (steering) + Σ_{k<j} (Ω_k/|ζ_k|²) Jζ_k ζ_kᵀ (shear of unsteered older layers, optional) */
  // Quarter-turn J (rotate a 2-vector by 90°).
  const J=v=>[-v[1],v[0]];
  // Right-hand side of the layered system: transport every wavevector by the
  // background D, and for the one active layer advance Θ and Ω from the gradient of
  // all older layers. Finished layers are frozen ramps that only get carried.
  function deriv(S,adot,shearOn){ const d={G0:[0,0],L:S.L.map(()=>({z:[0,0],Th:0,Om:0}))}; const Dt=(v,D)=>[-(D[0][0]*v[0]+D[1][0]*v[1]),-(D[0][1]*v[0]+D[1][1]*v[1])]; // −Dᵀv
    const D=[[0,-adot],[adot,0]]; // prescribed background: α̇J during steering, zero otherwise (the smooth force absorbs everything affine)
    if(shearOn) for(let k=0;k<S.L.length;k++){ const o=S.L[k]; if(!o.on||k===S.act||o.Om===0) continue; const n2=o.z[0]*o.z[0]+o.z[1]*o.z[1]; const c=o.Om/n2, Jz=J(o.z); D[0][0]+=c*Jz[0]*o.z[0]; D[0][1]+=c*Jz[0]*o.z[1]; D[1][0]+=c*Jz[1]*o.z[0]; D[1][1]+=c*Jz[1]*o.z[1]; } // leftover shear of unsteered finished layers
    for(let j=0;j<S.L.length;j++){ const l=S.L[j]; if(!l.on) continue; d.L[j].z=Dt(l.z,D); // every wavevector is transported by the background
      if(j!==S.act) continue; // finished layers are ramps near the origin: Θ and Ω frozen
      let G=[S.G0[0],S.G0[1]]; for(let k=0;k<j;k++){ const o=S.L[k]; if(o.on){ G[0]+=o.lam*o.Th*o.z[0]; G[1]+=o.lam*o.Th*o.z[1]; } }
      const n2=l.z[0]*l.z[0]+l.z[1]*l.z[1], Jz=J(l.z); d.L[j].Th=-(Jz[0]*G[0]+Jz[1]*G[1])/(l.lam*n2)*l.Om; d.L[j].Om=l.lam*l.z[0]*l.Th; }
    d.G0=Dt(S.G0,D); return d; }
  // Deep-copy a state (so RK4 stages do not alias the buffers of earlier stages).
  const copy=S=>({G0:[...S.G0],act:S.act,L:S.L.map(l=>({...l,z:[...l.z]}))});
  // One RK4 step of the whole layered state (adotAt supplies the steering rate α̇).
  function rk4(S,dt,adotAt,t,shearOn){ const add=(S,d,h)=>{ const T=copy(S); T.G0[0]+=h*d.G0[0]; T.G0[1]+=h*d.G0[1]; T.L.forEach((l,j)=>{ if(!l.on) return; l.z[0]+=h*d.L[j].z[0]; l.z[1]+=h*d.L[j].z[1]; l.Th+=h*d.L[j].Th; l.Om+=h*d.L[j].Om; }); return T; };
    const k1=deriv(S,adotAt(t),shearOn), k2=deriv(add(S,k1,dt/2),adotAt(t+dt/2),shearOn), k3=deriv(add(S,k2,dt/2),adotAt(t+dt/2),shearOn), k4=deriv(add(S,k3,dt),adotAt(t+dt),shearOn);
    const R=copy(S); R.G0[0]+=dt/6*(k1.G0[0]+2*k2.G0[0]+2*k3.G0[0]+k4.G0[0]); R.G0[1]+=dt/6*(k1.G0[1]+2*k2.G0[1]+2*k3.G0[1]+k4.G0[1]);
    R.L.forEach((l,j)=>{ if(!l.on) return; for(const f of ['Th','Om']) l[f]+=dt/6*(k1.L[j][f]+2*k2.L[j][f]+2*k3.L[j][f]+k4.L[j][f]); for(const i of [0,1]) l.z[i]+=dt/6*(k1.L[j].z[i]+2*k2.L[j].z[i]+2*k3.L[j].z[i]+k4.L[j].z[i]); }); return R; }
  // Smootherstep, bump, and the steering tilt profile (same shapes as the wave view).
  const sm=t=>t<=0?0:t>=1?1:t*t*t*(t*(t*6-15)+10), bump=y=>(y<=0||y>=1)?0:30*y*y*(1-y)*(1-y);
  const zprof=(tau,mu)=>tau<1?1-sm(tau):tau<=1+1/P.Lam?-mu*P.Lam*bump(P.Lam*(tau-1)):0;

  let RUN=null;
  // Build the whole construction: for each layer, seed it on the growing eigenline
  // of its background, integrate growth until its gradient dominates, then (if
  // steering is on) shoot the pulse that zeroes Ω and hold. Samples are kept for
  // the time slider; stages are kept for the shaded phase bands.
  function rebuild(){ // integrate the whole construction; keep samples for scrubbing
    const n=P.n, samples=[], stages=[]; let S={G0:[0,-P.A0],act:-1,L:[]}; for(let q=0;q<n;q++) S.L.push({lam:P.lam1*Math.pow(P.ratio,q),z:[0,1],Th:0,Om:0,on:false,R:q?0.5/(P.lam1*Math.pow(P.ratio,q-1)):1});
    let t=0; const push=(ph,q)=>samples.push({t,S:copy(S),ph,q});
    for(let q=0;q<n;q++){ let l=S.L[q]; // insert layer q tilted from vertical by s_q, on the growing eigenline of its background (rk4 returns a fresh state, so re-fetch l after every step)
      const sq=P.s*Math.pow(P.sd,q); let G=[S.G0[0],S.G0[1]]; for(let k=0;k<q;k++){ const o=S.L[k]; G[0]+=o.lam*o.Th*o.z[0]; G[1]+=o.lam*o.Th*o.z[1]; } const A=Math.hypot(G[0],G[1]);
      const target=P.A0*Math.pow(P.g,q+1)/l.lam; /* stop when this layer's gradient is g× everything beneath it */ const seed=target*Math.exp(-P.L); l.z=[Math.sin(sq),Math.cos(sq)]; l.Th=-seed; l.Om=(l.lam/Math.sqrt(A))*l.Th; l.on=true; S.act=q; const gam=Math.sqrt(A)*Math.sin(sq)||1e-3; const dt=Math.min(0.02/gam,0.02);
      const t0=t; while(Math.abs(S.L[q].Th)<target&&t-t0<40/gam){ S=rk4(S,dt,()=>0,t,P.shear); t+=dt; push('growth',q); } l=S.L[q]; stages.push({q,ph:'growth',t0,t1:t});
      if(P.steer){ const phi0=Math.atan2(l.z[0],l.z[1]), t1=t, T=(1+1/P.Lam)/gam; const phiOf=(tt,mu)=>Math.asin(Math.max(-0.98,Math.min(0.98,Math.sin(phi0)*zprof(gam*(tt-t1),mu)))); const adotOf=mu=>tt=>-(phiOf(tt+1e-4,mu)-phiOf(tt-1e-4,mu))/2e-4;
        const endOm=mu=>{ let X=copy(S), tt=t1; const h=T/400; for(let i=0;i<400;i++){ X=rk4(X,h,adotOf(mu),tt,P.shear); tt+=h; } return X.L[q].Om; };
        let lo=0,hi=1; while(endOm(hi)*Math.sign(l.Th)>0&&hi<128) hi*=2; // Ω starts with the sign of Θ; find the pulse that returns it to zero
        for(let i=0;i<28;i++){ const m=(lo+hi)/2; endOm(m)*Math.sign(l.Th)>0?lo=m:hi=m; } const mu=(lo+hi)/2; const ad=adotOf(mu);
        const h=T/400; for(let i=0;i<400;i++){ S=rk4(S,h,ad,t,P.shear); t+=h; push('steer',q); } stages.push({q,ph:'steer',t0:t1,t1:t,mu}); l=S.L[q]; l.Om=0; l.z=[0,Math.hypot(l.z[0],l.z[1])];
        const th=0.3/gam, t2=t; while(t-t2<th){ S=rk4(S,dt,()=>0,t,P.shear); t+=dt; push('hold',q); } stages.push({q,ph:'hold',t0:t2,t1:t}); } }
    RUN={samples,stages,T:t}; const st=[]; for(const s of stages) st.push(s); draw(); }
  // profile: sine, or a triangle wave — exactly linear (slope 1) on the whole rise, periodic, so every layer is a train of stripes
  const tri=s=>{ const p=2*Math.PI; let x=s-Math.floor(s/p+0.25)*p; return x<=Math.PI/2? x : Math.PI-x; }; // rises with slope 1 on [−π/2, π/2], falls back to −π/2 by 3π/2
  // F is the stripe profile; env is the radial cutoff nesting a layer in its parent.
  const F=s=>P.lin?tri(s):Math.sin(s);
  const env=(r,R)=>{ const u=r/R; return u<0.55?1:u>1?0:(t=>t*t*(3-2*t))((1-u)/0.45); };
  // Binary-search the sample nearest a given time, for scrubbing.
  function sampleAt(tt){ const s=RUN.samples; let lo=0,hi=s.length-1; while(lo<hi){ const m=(lo+hi)>>1; s[m].t<tt?lo=m+1:hi=m; } return s[lo]; }
  // Composite draw: the magnified, contrast-stretched field (with active-layer
  // velocity arrows and layer-envelope circles) on the left, and three stacked
  // right-column plots — gradient vs amplitude, per-layer Ω, and the ζ cone — plus
  // a readout.
  function draw(){ if(!RUN) return; const {x,W,H}=setup('f-play'); x.clearRect(0,0,W,H); const S=Math.min(H-40,W*0.55), px=16, py=16; const Z=Math.pow(10,P.z), w=1/Z; const tt=P.t*RUN.T; const smp=sampleAt(tt); const st=smp.S;
    // Temperature at (u,v): background gradient plus every layer coarse enough to
    // resolve at this zoom and inside its cutoff radius.
    const theta=(u,v)=>{ let th=st.G0[0]*u+st.G0[1]*v; const r=Math.hypot(u,v); st.L.forEach((l,q)=>{ if(!l.on||l.lam>90*Z||r>l.R) return; th+=l.Th*F(l.lam*(l.z[0]*u+l.z[1]*v))*env(r,l.R); }); return th; };
    const n=140, cv=document.createElement('canvas'); cv.width=n; cv.height=n; const cx=cv.getContext('2d'); const img=cx.createImageData(n,n); const vals=new Float32Array(n*n); let mn=1e9,mx=-1e9;
    for(let j=0;j<n;j++) for(let i=0;i<n;i++){ const u=(-1+2*(i+.5)/n)*w, v=(1-2*(j+.5)/n)*w; const t=theta(u,v); vals[j*n+i]=t; if(t<mn)mn=t; if(t>mx)mx=t; }
    const mid=(mn+mx)/2, half=Math.max((mx-mn)/2,1e-30); const d=img.data; for(let k=0;k<n*n;k++){ const c=inferno(0.5+0.5*(vals[k]-mid)/half); d[4*k]=c[0];d[4*k+1]=c[1];d[4*k+2]=c[2];d[4*k+3]=255; }
    cx.putImageData(img,0,0); x.imageSmoothingEnabled=true; x.drawImage(cv,px,py,S,S); x.strokeStyle='rgba(252,180,120,0.25)'; x.strokeRect(px+.5,py+.5,S-1,S-1);
    // velocity of the newest active layer: v = Ω/(λ|ζ|²) Jζ sin(λζ·x)
    const act=st.L[smp.q]; if(P.arrows&&act&&act.on&&Math.abs(act.Om)>0){ const m=11, cell=S/m, n2=act.z[0]**2+act.z[1]**2, Jz=J(act.z); for(let j=0;j<m;j++) for(let i=0;i<m;i++){ const u=(-1+2*(i+.5)/m)*w, v=(1-2*(j+.5)/m)*w; const r=Math.hypot(u,v); if(r>act.R) continue; const a=Math.sin(act.lam*(act.z[0]*u+act.z[1]*v))*Math.sign(act.Om); const vx=Jz[0]*a/Math.sqrt(n2), vy=Jz[1]*a/Math.sqrt(n2); const X=px+(i+.5)*cell, Y=py+(j+.5)*cell; arrow(x,X-vx*cell*.4,Y+vy*cell*.4,X+vx*cell*.4,Y-vy*cell*.4,'rgba(243,238,238,0.7)',1); } }
    const ccx=px+S/2, ccy=py+S/2; st.L.forEach((l,q)=>{ const rp=l.R*Z*S/2; if(!l.on||rp<4||rp>S*1.5) return; x.setLineDash([3,4]); x.strokeStyle='rgba(252,241,164,0.6)'; x.beginPath(); x.arc(ccx,ccy,rp,0,7); x.stroke(); x.setLineDash([]); label(x,'layer '+(q+1),ccx+rp*0.71+4,ccy-rp*0.71-6,PALE,10); });
    label(x,'t = '+tt.toFixed(2)+' / T∗ = '+RUN.T.toFixed(2)+'   ·   layer '+(smp.q+1)+' '+smp.ph+'   ·   window 2/Z = '+(2*w).toExponential(1),px,py+S+14,DIM,10);
    // right column: gradient plot, Ω per layer, cone
    const rx=px+S+26, rw=W-rx-16; let ry=py; const ph=(H-32-2*12-rw*0.55)/2;
    const box=(y,h)=>{ x.strokeStyle='rgba(252,180,120,0.2)'; x.strokeRect(rx+.5,y+.5,rw-1,h-1); };
    box(ry,ph); { for(const s of RUN.stages){ x.fillStyle=s.ph==='growth'?'rgba(246,160,63,0.07)':s.ph==='steer'?'rgba(252,241,164,0.12)':'rgba(126,194,126,0.08)'; x.fillRect(rx+s.t0/RUN.T*rw,ry,(s.t1-s.t0)/RUN.T*rw,ph); }
      const gradAt=sm=>{ let G=[sm.S.G0[0],sm.S.G0[1]]; sm.S.L.forEach(l=>{ if(!l.on) return; G[0]+=l.lam*l.Th*l.z[0]; G[1]+=l.lam*l.Th*l.z[1]; }); return Math.hypot(G[0],G[1]); };
      const supAt=sm=>{ let s=0; sm.S.L.forEach(l=>{ if(l.on) s+=Math.abs(l.Th); }); return s; };
      const gmax=Math.max(...RUN.samples.filter((_,i)=>i%7===0).map(gradAt)); const lo=Math.log10(P.A0)-0.5, hi=Math.log10(gmax)+0.3;
      const plot=(fn,col,wd)=>{ x.strokeStyle=col; x.lineWidth=wd; x.beginPath(); let f=true; for(let i=0;i<RUN.samples.length;i+=3){ const sm=RUN.samples[i]; const v=Math.log10(Math.max(1e-30,fn(sm))); const X=rx+sm.t/RUN.T*rw, Y=ry+ph-(v-lo)/(hi-lo)*ph; f?x.moveTo(X,Y):x.lineTo(X,Y); f=false; } x.stroke(); };
      x.save(); x.beginPath(); x.rect(rx,ry,rw,ph); x.clip(); plot(gradAt,ACC,1.8); plot(supAt,PALE,1.2); x.restore();
      x.strokeStyle='rgba(243,238,238,0.4)'; x.setLineDash([2,3]); x.beginPath(); x.moveTo(rx+P.t*rw,ry); x.lineTo(rx+P.t*rw,ry+ph); x.stroke(); x.setLineDash([]);
      label(x,'|∇θ(0)|  gradient at the origin (log)',rx+6,ry+12,ACC,10); label(x,'Σ|Θ|  amplitudes (bounded)',rx+6,ry+24,PALE,10); label(x,'growth · steer · hold',rx+rw-6,ry+ph-10,DIM,9,'right'); }
    ry+=ph+12; box(ry,ph); { let om=1e-9; for(let i=0;i<RUN.samples.length;i+=5) for(const l of RUN.samples[i].S.L) om=Math.max(om,Math.abs(l.Om)); const sl=v=>Math.sign(v)*Math.log10(1+Math.abs(v)/(om*1e-4))/Math.log10(1+1e4);
      x.strokeStyle='rgba(243,238,238,0.2)'; x.beginPath(); x.moveTo(rx,ry+ph/2); x.lineTo(rx+rw,ry+ph/2); x.stroke(); x.save(); x.beginPath(); x.rect(rx,ry,rw,ph); x.clip();
      for(let q=0;q<P.n;q++){ const c=inferno(0.35+0.6*q/Math.max(1,P.n-1)); x.strokeStyle=rgb(c); x.lineWidth=1.5; x.beginPath(); let f=true; for(let i=0;i<RUN.samples.length;i+=3){ const sm=RUN.samples[i]; const l=sm.S.L[q]; if(!l.on) continue; const X=rx+sm.t/RUN.T*rw, Y=ry+ph/2-sl(l.Om)*ph*0.46; f?x.moveTo(X,Y):x.lineTo(X,Y); f=false; } x.stroke(); } x.restore();
      x.strokeStyle='rgba(243,238,238,0.4)'; x.setLineDash([2,3]); x.beginPath(); x.moveTo(rx+P.t*rw,ry); x.lineTo(rx+P.t*rw,ry+ph); x.stroke(); x.setLineDash([]);
      label(x,'Ω_q  vorticity amplitude of each layer (symlog)'.replace('_q',''),rx+6,ry+12,DIM,10); label(x,P.steer?'each returns to zero at the end of its steering':'never steered: the shear stays and is felt by every later layer',rx+6,ry+ph-10,P.steer?'#7ec27e':RED,9); }
    ry+=ph+12; const cw=rw*0.55; box(ry,cw); { const ox=rx+cw/2, oy=ry+cw*0.86, R=cw*0.72; x.setLineDash([3,4]); x.strokeStyle='rgba(243,238,238,0.3)'; x.beginPath(); x.moveTo(ox,oy); x.lineTo(ox,oy-R); x.stroke(); x.setLineDash([]);
      st.L.forEach((l,q)=>{ if(!l.on) return; const c=inferno(0.35+0.6*q/Math.max(1,P.n-1)); const nm=Math.hypot(l.z[0],l.z[1])||1; const len=R*(0.45+0.55*q/Math.max(1,P.n-1)); arrow(x,ox,oy,ox+len*l.z[0]/nm,oy-len*l.z[1]/nm,rgb(c),2); });
      const G=st.G0; const gn=Math.hypot(G[0],G[1])||1; arrow(x,ox,oy,ox+R*0.5*G[0]/gn,oy-R*0.5*G[1]/gn,'rgba(243,238,238,0.6)',1.4); label(x,'ζ of each layer, and G₀ (grey), now',rx+6,ry+12,DIM,10); }
    // readouts beside the cone
    const rox=rx+cw+12; const grad=(()=>{ let G=[st.G0[0],st.G0[1]]; st.L.forEach(l=>{ if(!l.on) return; G[0]+=l.lam*l.Th*l.z[0]; G[1]+=l.lam*l.Th*l.z[1]; }); return Math.hypot(G[0],G[1]); })();
    const ro=[['T∗',RUN.T.toFixed(3)],['stages',RUN.stages.length],['gradient now',grad.toExponential(2)],['sup |θ| now',(P.A0+st.L.reduce((a,l)=>a+(l.on?Math.abs(l.Th):0),0)).toFixed(4)],['pulses μ',RUN.stages.filter(s=>s.mu!=null).map(s=>s.mu.toFixed(2)).join(' ')||'—']];
    ro.forEach(([k,v],i)=>{ label(x,k,rox,ry+14+i*15,DIM,10); label(x,String(v),rx+rw-6,ry+14+i*15,ACC,10,'right'); }); }
  // Build once on load, and register draw so a resize repaints at the new width.
  rebuild(); STATIC.push(draw); }

});
