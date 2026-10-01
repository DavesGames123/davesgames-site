// ============================================================================
//  TWENTY TO FOUR  ·  radiating-dipole field simulation
// ----------------------------------------------------------------------------
//  A single oscillating charge (a point dipole) radiates in a 2D slice. The
//  canvas draws the electric field E as vectors and stream-function contour
//  lines, the magnetic field B⊥ as a heatmap or glyphs, and outward wavefronts.
//  The equation panel (built by concepts.js) hovers each of Maxwell's original
//  scalar components; on hover it calls window.__setOverlay to paint the exact
//  field quantity that component governs.
//
//  FIELD MODEL   (dipole along the axis, evaluated at radius r, retarded phase)
//  --------------------------------------------------------------------------
//      u = k·r − t                 retarded phase; k = 2π/λ
//      near/induction ∝ cos u / r³ + k·sin u / r²     dominates close in
//      radiation      ∝ k²·cos u / r                  dominates far out, is light
//      E = amp·( near·(3cosθ r̂ − â) + radiation·(â − cosθ r̂) )
//      B⊥ = amp·(r̂ × â)·( radiation + near )          out of / into the plane
//
//  COORDINATE FRAME   (canvas pixels; y increases downward)
//  --------------------------------------------------------------------------
//      (0,0) ┌─────────────▶ x
//            │        â  axis (axisDeg, y flipped so degrees read upward)
//            │       ╱
//            │   ● SRC ─── r̂ ──▶ • sample (x,y)
//            │   dipole          r = |sample − SRC|
//            ▼ y
//
//  RENDER ORDER   (render(), back to front)
//  --------------------------------------------------------------------------
//      background grid ─▶ heatmap (overlay quantity or B⊥) ─▶ wavefronts
//        ─▶ field-line contours ─▶ E vectors ─▶ overlay component vectors
//        ─▶ source glow
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      state ............... "const SIM="            all live parameters
//      palette ............. "const PAL="            colours shared with style.css
//      color ramp .......... "function fieldColorRGB"  magnitude → RGB
//      field model ......... "function fieldAt"       the dipole E and B
//      overlays ............ "OVERLAYS"               hover → quantity table
//      heatmap ............. "function drawHeatmap"   dense scalar field paint
//      vector arrows ....... "function drawArrowField"  arrow grid renderer
//      Bz glyphs ........... "function drawBzGlyphs"  out/into-plane symbols
//      field lines ......... "function buildGrid"     stream function + march
//      contour march ....... "function marchAll"      marching squares
//      line draw ........... "function renderLines"   one WebGL2 call; 2D fallback
//      render .............. "function render"        the per-frame draw
//      source glow ......... "function renderSource"  the oscillating charge
//      controls ............ "function sg"            slider wiring
//      pointer ............. "function ptr"           drag the source
//      resize .............. "function resize"        canvas sizing and DPR
//      loop ................ "function loop"          time advance and FPS
// ============================================================================

// The drawing canvas and its 2D context. CW/CH are the CSS pixel size (the
// backing store is scaled by device pixel ratio in resize()).
const canvas=document.getElementById('sim-canvas');
const ctx=canvas.getContext('2d');
let CW=100,CH=100;

// The single mutable state. t is the phase clock; lambda is the wavelength in
// pixels; axisDeg is the dipole orientation; density controls how many contour
// levels appear; amp/cNear/cRad scale the overall strength and the two field
// terms; the show* flags toggle each render layer; overlay names the hovered
// quantity or is null.
const SIM={
  playing:true, speed:1.0, t:0,
  freq:1.0, lambda:140, axisDeg:90, density:42,
  showLines:true, showFlow:true, showB:true, showFronts:false, showVectors:true,
  amp:1.0, cNear:1.0, cRad:1.0,
  overlay:null,
};
// The source (dipole) position in canvas pixels, and the drag offset while it is
// being moved.
const SRC={x:0,y:0};
// One palette for the canvas and the equations (style.css :root has the same
// values as CSS tokens). E is gold, B is cyan, the displacement current is
// green, and indigo marks the negative side of a signed heatmap.
const PAL={e:[255,200,100],b:[94,214,230],disp:[134,227,168],a:[185,164,255],neg:[125,136,255],ev:[242,227,198]};
const rgbS=c=>c[0]+','+c[1]+','+c[2];
let dragging=false,dragDX=0,dragDY=0;

// Map a field magnitude to an RGB colour along the E ramp: deep amber, gold,
// then warm white where the field is strongest. E is gold in the equations,
// so the field lines are too. The magnitude is log-compressed because the
// field spans many orders between the near zone and the far zone.
function fieldColorRGB(mag,gamma){
  gamma=gamma||1.0;
  const lv=Math.log10(1+mag*9e6)/6.6;
  const lc=Math.pow(Math.max(0,Math.min(1,lv)),1/Math.max(0.1,gamma));
  const stops=[[0.30,0.15,0.05],[0.62,0.34,0.08],[0.92,0.62,0.22],[1,0.80,0.42],[1,0.90,0.68],[1,0.97,0.90]];
  const sv=lc*5,si=Math.min(Math.floor(sv),4),sf=sv-si;
  return [stops[si][0]+sf*(stops[si+1][0]-stops[si][0]),
          stops[si][1]+sf*(stops[si+1][1]-stops[si][1]),
          stops[si][2]+sf*(stops[si+1][2]-stops[si][2])];
}
// Wavenumber k = 2π/λ.
function kOf(){return 2*Math.PI/SIM.lambda;}
// Unit vector along the dipole axis. Y is negated so the degree readout matches
// the usual math convention (counterclockwise from the x-axis) on a y-down canvas.
function axisVec(){const a=SIM.axisDeg*Math.PI/180;return [Math.cos(a),-Math.sin(a)];}

// The dipole field at a point and time. Combines the near/induction term
// (1/r³ and 1/r², weighted by cNear) with the radiation term (1/r, weighted by
// cRad). nvx/nvy is the radial-dominated component, tvx/tvy the transverse
// radiation component, and Bz the out-of-plane magnetic field from r̂ × â.
// r is clamped to 7 px to avoid the singularity at the source.
// field at an arbitrary time (needed for d/dt overlays). amp/cNear/cRad are live coefficients.
function fieldAt(x,y,t){
  const k=kOf(),[ax,ay]=axisVec();
  let dx=x-SRC.x,dy=y-SRC.y;
  let r=Math.hypot(dx,dy); if(r<7) r=7;
  const rx=dx/r,ry=dy/r,cosT=rx*ax+ry*ay;
  const u=k*r-t,r2=r*r,r3=r2*r,cu=Math.cos(u),su=Math.sin(u);
  const nearInd=SIM.cNear*(cu/r3+k*su/r2), rad=SIM.cRad*(k*k*cu/r);
  const nvx=3*cosT*rx-ax,nvy=3*cosT*ry-ay,tvx=ax-cosT*rx,tvy=ay-cosT*ry;
  const Ex=SIM.amp*(nvx*nearInd+tvx*rad), Ey=SIM.amp*(nvy*nearInd+tvy*rad);
  const crossZ=rx*ay-ry*ax;
  const Bz=SIM.amp*crossZ*(SIM.cRad*k*k*cu/r + SIM.cNear*k*su/r2);
  return {Ex,Ey,Bz,Emag:Math.hypot(Ex,Ey)};
}
// Field at the current simulation time.
function field(x,y){return fieldAt(x,y,SIM.t);}

/* ─── OVERLAYS: hover a Maxwell equation → see that quantity ───
   .fn  = signed scalar for the heatmap
   .cvec= the COMPONENT vector drawn over the base E vectors, or 'glyph' (B⊥), or null */
// HT is the time step for the ∂/∂t central difference; hS is the spatial step
// for ∂/∂x and ∂/∂y central differences.
const HT=0.05, hS=2;
// Central-difference time derivative of one field component (displacement current).
function dEdt(x,y,comp){const a=fieldAt(x,y,SIM.t+HT),b=fieldAt(x,y,SIM.t-HT);return (a[comp]-b[comp])/(2*HT);}
// Central-difference spatial derivatives of B⊥ (the curl-of-H components).
function dBz_dy(x,y){return (field(x,y+hS).Bz-field(x,y-hS).Bz)/(2*hS);}
function dBz_dx(x,y){return (field(x+hS,y).Bz-field(x-hS,y).Bz)/(2*hS);}
// Overlay table: for each hoverable equation component, fn is the signed scalar
// the heatmap paints, and cvec is the component vector drawn over the base E
// arrows ('glyph' means draw B⊥ symbols, null means nothing to draw). ov keys
// in concepts.js index into this table.
const OVL={
  Ex:{lab:'Eₓ — electric field, x-component', col:'e', fn:(x,y)=>field(x,y).Ex, cvec:(x,y)=>[field(x,y).Ex,0]},
  Ey:{lab:'E_y — electric field, y-component', col:'e', fn:(x,y)=>field(x,y).Ey, cvec:(x,y)=>[0,field(x,y).Ey]},
  Bz:{lab:'B⊥ — magnetic field, out of / into the plane', col:'b', fn:(x,y)=>field(x,y).Bz, cvec:'glyph'},
  dExdt:{lab:'∂Eₓ/∂t — displacement current, x', col:'disp', fn:(x,y)=>dEdt(x,y,'Ex'), cvec:(x,y)=>[dEdt(x,y,'Ex'),0]},
  dEydt:{lab:'∂E_y/∂t — displacement current, y', col:'disp', fn:(x,y)=>dEdt(x,y,'Ey'), cvec:(x,y)=>[0,dEdt(x,y,'Ey')]},
  curlHx:{lab:'(∇×H)ₓ ∝ ∂_y B⊥', col:'b', fn:dBz_dy, cvec:(x,y)=>[dBz_dy(x,y),0]},
  curlHy:{lab:'(∇×H)_y ∝ −∂ₓ B⊥', col:'b', fn:(x,y)=>-dBz_dx(x,y), cvec:(x,y)=>[0,-dBz_dx(x,y)]},
  divE:{lab:'∇·E — sources of the field (≈ 0 away from the charge)', col:'e', fn:(x,y)=>(dExdx(x,y)+dEydy(x,y)), cvec:null},
  zero:{lab:'≡ 0 for an in-plane dipole — this component vanishes in the slice', col:'e', fn:null, cvec:null},
};
// Spatial derivatives of the E components, summed for the divergence overlay.
function dExdx(x,y){return (field(x+hS,y).Ex-field(x-hS,y).Ex)/(2*hS);}
function dEydy(x,y){return (field(x,y+hS).Ey-field(x,y-hS).Ey)/(2*hS);}
// Called by concepts.js on hover: set the active overlay, update the caption and
// the status readout, or clear back to the field-line view when kind is null.
window.__setOverlay=function(kind){
  SIM.overlay=(kind&&OVL[kind])?kind:null;
  const cap=document.getElementById('ovl-caption'),stov=document.getElementById('st-ovl');
  if(!SIM.overlay){cap.classList.remove('show');stov.innerHTML='showing: <b>field lines</b>';return;}
  const o=OVL[kind];cap.classList.add('show');cap.style.setProperty('--cap','rgb('+rgbS(PAL[o.col])+')');
  cap.innerHTML=o.fn
    ? o.lab+'<span class="ck"><span class="pm pos">positive</span><span class="pm neg">negative</span><span>arrows: this component</span></span>'
    : o.lab+'<span class="ck">nothing to draw: the field has no component here</span>';
  stov.innerHTML='showing: <b>'+kind+'</b>';
};

/* ─── smooth high-resolution field heatmap (computed dense, upscaled with smoothing) ─── */
// Offscreen buffer for the heatmap: the scalar field is sampled sparsely onto a
// small canvas, then upscaled with smoothing for a fast, soft heatmap.
const hmCanvas=document.createElement('canvas'); const hmCtx=hmCanvas.getContext('2d');
// Paint the signed scalar fn as a heatmap: pos for positive, neg for
// negative (RGB triples from PAL), with log-compressed alpha so both near and
// far zones stay visible. maxA caps the alpha, so the field lines stay on top.
function drawHeatmap(fn,pos,neg,maxA){
  pos=pos||PAL.e;neg=neg||PAL.neg;maxA=maxA||150;
  const step=6;
  const bw=Math.max(2,Math.ceil(CW/step)), bh=Math.max(2,Math.ceil(CH/step));
  if(hmCanvas.width!==bw||hmCanvas.height!==bh){hmCanvas.width=bw;hmCanvas.height=bh;}
  const img=hmCtx.createImageData(bw,bh), data=img.data;
  const vals=new Float32Array(bw*bh); let mx=1e-30, idx=0;
  for(let j=0;j<bh;j++){const y=(j+0.5)*step;
    for(let i=0;i<bw;i++,idx++){const x=(i+0.5)*step;const v=fn(x,y);vals[idx]=v;const a=Math.abs(v);if(a>mx)mx=a;}}
  const TARGET=1e4, SCALE=TARGET/mx, DEN=Math.log10(1+TARGET);
  const bright=Math.min(1.7,Math.sqrt(SIM.amp));
  for(let p=0;p<vals.length;p++){
    const v=vals[p]; let a=Math.log10(1+Math.abs(v)*SCALE)/DEN; a=a*a*bright;
    if(a>1)a=1; const al=(a*maxA)|0; const o=p*4;
    const c=v>=0?pos:neg; data[o]=c[0];data[o+1]=c[1];data[o+2]=c[2];
    data[o+3]=al;
  }
  hmCtx.putImageData(img,0,0);
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(hmCanvas,0,0,bw,bh,0,0,CW,CH);ctx.restore();
}

/* ─── vector field arrows ─── */
// Arrow grid spacing, scaled to the canvas size.
function arrowGS(){return Math.max(30,Math.round(Math.min(CW,CH)/14));}
// Draw a vector field vf as a grid of arrows. Lengths and opacities are
// log-scaled to the grid maximum; additive blending makes overlapping arrows
// glow. lenMul scales arrow length, rgb is the base color.
function drawArrowField(vf,rgb,alpha,lenMul){
  const gs=arrowGS(); let mx=1e-30; const pts=[];
  for(let y=gs/2;y<CH;y+=gs)for(let x=gs/2;x<CW;x+=gs){const v=vf(x,y);const m=Math.hypot(v[0],v[1]);if(m>mx)mx=m;pts.push([x,y,v[0],v[1],m]);}
  const K=1e4/mx, DEN=Math.log10(1+1e4);
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const a of pts){
    const m=a[4]; if(m<1e-13) continue;
    const nx=a[2]/m, ny=a[3]/m, t=Math.log10(1+m*K)/DEN;
    const len=(6+t*gs*0.42)*lenMul, al=alpha*(0.32+0.68*t);
    const x=a[0],y=a[1],x0=x-nx*len*0.5,y0=y-ny*len*0.5,x1=x+nx*len*0.5,y1=y+ny*len*0.5;
    ctx.strokeStyle='rgba('+rgb+','+al+')';ctx.lineWidth=1.15;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    const px=-ny*2.3,py=nx*2.3;
    ctx.fillStyle='rgba('+rgb+','+al+')';
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x1-nx*4.6+px,y1-ny*4.6+py);ctx.lineTo(x1-nx*4.6-px,y1-ny*4.6-py);ctx.closePath();ctx.fill();
  }
  ctx.restore();
}
// Draw B⊥ as glyphs on the arrow grid: a filled dot for field out of the plane,
// a cross for field into the plane, sized by log-scaled magnitude.
function drawBzGlyphs(){
  const gs=arrowGS(); let mx=1e-30; const pts=[];
  for(let y=gs/2;y<CH;y+=gs)for(let x=gs/2;x<CW;x+=gs){const v=field(x,y).Bz;const a=Math.abs(v);if(a>mx)mx=a;pts.push([x,y,v]);}
  const K=1e4/mx, DEN=Math.log10(1+1e4);
  ctx.save();
  for(const p of pts){
    const v=p[2],a=Math.abs(v);if(a<1e-13)continue;
    const t=Math.log10(1+a*K)/DEN, r=2+t*6, al=0.35+0.6*t;
    ctx.strokeStyle='rgba('+rgbS(PAL.b)+','+al+')';ctx.lineWidth=1.4;
    ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.stroke();
    if(v>=0){ctx.fillStyle='rgba('+rgbS(PAL.b)+','+al+')';ctx.beginPath();ctx.arc(p[0],p[1],Math.max(1,r*0.32),0,Math.PI*2);ctx.fill();}
    else{const d=r*0.7;ctx.beginPath();ctx.moveTo(p[0]-d,p[1]-d);ctx.lineTo(p[0]+d,p[1]+d);ctx.moveTo(p[0]+d,p[1]-d);ctx.lineTo(p[0]-d,p[1]+d);ctx.stroke();}
  }
  ctx.restore();
}
// Draw the hovered overlay's component vectors (or B⊥ glyphs) in the colour
// of that quantity over the base E field.
function renderComponentVectors(kind){
  const o=OVL[kind]; if(!o) return;
  if(o.cvec==='glyph'){drawBzGlyphs();return;}
  if(typeof o.cvec==='function'){drawArrowField(o.cvec,rgbS(PAL[o.col]),0.95,1.0);}
}

/* ─── stream-function field lines (contours; smooth in time) ─── */
// Grid state for the field-line contours: cell size GS, grid width/height GW/GH,
// and the sampled stream-function and magnitude arrays.
let GS=0,GW=0,GH=0,psiGrid=null,magGrid=null;
// Sample the dipole stream function psi and the field magnitude onto a grid.
// Field lines are the level curves of psi, so contouring psi traces the E field
// lines without integrating them. sin²θ weighting gives the dipole lobe shape.
function buildGrid(){
  GS=Math.min(10,Math.max(5,Math.round(Math.sqrt(CW*CH)/130)));
  GW=Math.ceil(CW/GS)+1;GH=Math.ceil(CH/GS)+1;const N=GW*GH;
  if(!psiGrid||psiGrid.length!==N){psiGrid=new Float32Array(N);magGrid=new Float32Array(N);}
  const k=kOf(),[ax,ay]=axisVec(),cN=SIM.cNear,cR=SIM.cRad,amp=SIM.amp;let idx=0;
  for(let j=0;j<GH;j++){const y=j*GS;
    for(let i=0;i<GW;i++,idx++){const x=i*GS;
      let dx=x-SRC.x,dy=y-SRC.y;let r=Math.hypot(dx,dy);if(r<7)r=7;
      const rx=dx/r,ry=dy/r,cosT=rx*ax+ry*ay,sin2=1-cosT*cosT,u=k*r-SIM.t,cu=Math.cos(u),su=Math.sin(u);
      psiGrid[idx]=sin2*(cN*cu/r + cR*k*su);
      const gw=cN*(cu/(r*r*r)+k*su/(r*r)), hw=cR*k*k*cu/r, gh=gw-hw;
      magGrid[idx]=amp*Math.sqrt(4*cosT*cosT*gw*gw+sin2*gh*gh);
    }}
}
// Build the set of psi contour levels, geometrically spaced (ratio 1.5) and
// mirrored in sign, so both field-line densities near and far from the source
// stay legible. The count grows with the density control.
function contourLevels(){
  const k=kOf();
  const M=Math.max(7,Math.min(20,Math.round(SIM.density/3.8)));
  const base=k*0.025, ratio=1.5, out=[];
  for(let n=0;n<M;n++){const v=base*Math.pow(ratio,n);out.push(v);out.push(-v);}
  out.sort((a,b)=>a-b);
  return out;
}
// Nearest-cell lookup of the field magnitude, used to color a contour segment.
function sampleMag(x,y){const gi=Math.min(GW-1,Math.max(0,(x/GS)|0)),gj=Math.min(GH-1,Math.max(0,(y/GS)|0));return magGrid[gj*GW+gi];}
// Marching squares over psiGrid: for every cell and every level that crosses it,
// interpolate the crossing points on the cell edges and emit line segments into
// segs. Empty and single-value cells are skipped for speed.
function marchAll(levels,segs){
  const NL=levels.length;
  for(let j=0;j<GH-1;j++){const rowA=j*GW,rowB=(j+1)*GW,y0=j*GS,y1=y0+GS;
    for(let i=0;i<GW-1;i++){const x0=i*GS,x1=x0+GS;
      const tl=psiGrid[rowA+i],tr=psiGrid[rowA+i+1],br=psiGrid[rowB+i+1],bl=psiGrid[rowB+i];
      let mn=tl,mx=tl;if(tr<mn)mn=tr;else if(tr>mx)mx=tr;if(br<mn)mn=br;else if(br>mx)mx=br;if(bl<mn)mn=bl;else if(bl>mx)mx=bl;
      for(let li=0;li<NL;li++){const L=levels[li];if(L<mn)continue;if(L>mx)break;
        const a=tl<L,b=tr<L,c=br<L,d=bl<L;if(a===b&&b===c&&c===d)continue;
        let n=0;const p=[];
        if(a!==b){const t=(L-tl)/(tr-tl);p.push(x0+t*GS,y0);n++;}
        if(b!==c){const t=(L-tr)/(br-tr);p.push(x1,y0+t*GS);n++;}
        if(d!==c){const t=(L-bl)/(br-bl);p.push(x0+t*GS,y1);n++;}
        if(a!==d){const t=(L-tl)/(bl-tl);p.push(x0,y0+t*GS);n++;}
        if(n>=2){segs.push(p[0],p[1],p[2],p[3]);if(n===4)segs.push(p[4],p[5],p[6],p[7]);}
      }}}
}

// The per-frame draw. Clear, paint the faint background grid, then layer the
// heatmap, wavefronts, field lines, E vectors, any overlay vectors, and finally
// the source glow, back to front.
/* ─── render ─── */
function render(){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.restore();
  ctx.fillStyle='#0a0d14';ctx.fillRect(0,0,CW,CH);
  // A soft warm light round the charge, then a faint reference grid every 46 px.
  const R0=Math.hypot(CW,CH)*0.6,bg=ctx.createRadialGradient(SRC.x,SRC.y,0,SRC.x,SRC.y,R0);
  bg.addColorStop(0,'rgba(255,200,100,0.05)');bg.addColorStop(0.5,'rgba(94,214,230,0.015)');bg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=bg;ctx.fillRect(0,0,CW,CH);
  ctx.strokeStyle='rgba(160,185,225,0.028)';ctx.lineWidth=1;
  for(let x=0;x<CW;x+=46){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke();}
  for(let y=0;y<CH;y+=46){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke();}

  // base field heatmap: overlay quantity when hovering, else the magnetic field
  if(SIM.overlay && OVL[SIM.overlay].fn) drawHeatmap(OVL[SIM.overlay].fn,PAL[OVL[SIM.overlay].col],PAL.neg,190);
  else if(SIM.showB && !SIM.overlay) drawHeatmap((x,y)=>field(x,y).Bz,PAL.b,PAL.neg,105);

  if(SIM.showFronts) renderFronts();
  if(SIM.showLines) renderLines();
  if(SIM.showVectors) drawArrowField((x,y)=>{const f=field(x,y);return [f.Ex,f.Ey];},rgbS(PAL.ev),SIM.overlay?0.25:0.42,0.9);
  if(SIM.overlay) renderComponentVectors(SIM.overlay);
  renderSource();
}
// Dashed concentric circles marking successive wavefronts, spaced one wavelength
// apart and advancing outward with the phase clock.
function renderFronts(){
  const k=kOf();ctx.save();ctx.strokeStyle='rgba(168,185,217,0.2)';ctx.lineWidth=1;ctx.setLineDash([2,6]);
  for(let n=0;n<16;n++){const r=(2*Math.PI*n+SIM.t)/k;if(r<8||r>Math.hypot(CW,CH))continue;
    ctx.beginPath();ctx.arc(SRC.x,SRC.y,r,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
const GLOW=window.GlowLines?GlowLines.create():null;
// Contour segments meet end to end. With round caps and additive blending,
// each joint is drawn twice and shows as a bright bead along the line. trim
// pulls both ends of a segment in by a part of the half width w/2, so the
// caps of two neighbours just meet. It writes the result into TR.
const TR=[0,0,0,0];
function trim(x0,y0,x1,y1,w){
  const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy),t=Math.min(w*0.42,L*0.35)/(L||1);
  TR[0]=x0+dx*t;TR[1]=y0+dy*t;TR[2]=x1-dx*t;TR[3]=y1-dy*t;return TR;
}
// Draw the E field lines as contours of the stream function. Each segment is
// colored by local magnitude and drawn twice: a soft wide glow pass then a thin
// bright pass. When the energy pulse is on, a traveling sine brightens the lines
// outward from the source; overlays dim the lines so the overlay reads clearly.
function renderLines(){
  buildGrid();
  const levels=contourLevels();const segs=[];marchAll(levels,segs);
  const k=kOf(),flowPhase=SIM.t/k, dim=SIM.overlay?0.3:1;
  // One WebGL2 draw for all segments (lib/glow-lines.js); the 2D strokes below
  // are the fallback. Same colors, alphas and widths in both paths.
  if(GLOW&&GLOW.begin(ctx)){
    for(let s=0;s<segs.length;s+=4){
      const x0=segs[s],y0=segs[s+1],x1=segs[s+2],y1=segs[s+3];
      const mx=(x0+x1)*0.5,my=(y0+y1)*0.5,m=sampleMag(mx,my);
      const [r,g,b]=fieldColorRGB(m);
      let pulse=1;
      if(SIM.showFlow){const rr=Math.hypot(mx-SRC.x,my-SRC.y);pulse=0.4+0.6*Math.max(0,Math.sin((rr-flowPhase)*k));}
      const lv=Math.min(1,Math.log10(1+m*9e6)/6.6);
      const a=Math.min(0.92,0.16+lv*0.95)*pulse*dim;
      if(a<0.02)continue;
      const wg=4.5*pulse;trim(x0,y0,x1,y1,wg);
      GLOW.seg(TR[0],TR[1],TR[2],TR[3],r*a*0.16,g*a*0.16,b*a*0.16,wg);
      trim(x0,y0,x1,y1,1.4);
      GLOW.seg(TR[0],TR[1],TR[2],TR[3],r*a,g*a,b*a,1.4);
    }
    GLOW.flush(ctx);
    return;
  }
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
  for(let pass=0;pass<2;pass++){
    for(let s=0;s<segs.length;s+=4){
      const x0=segs[s],y0=segs[s+1],x1=segs[s+2],y1=segs[s+3];
      const mx=(x0+x1)*0.5,my=(y0+y1)*0.5,m=sampleMag(mx,my);
      const [r,g,b]=fieldColorRGB(m);
      let pulse=1;
      if(SIM.showFlow){const rr=Math.hypot(mx-SRC.x,my-SRC.y);pulse=0.4+0.6*Math.max(0,Math.sin((rr-flowPhase)*k));}
      const lv=Math.min(1,Math.log10(1+m*9e6)/6.6);
      const a=Math.min(0.92,0.16+lv*0.95)*pulse*dim;
      if(a<0.02)continue;
      if(pass===0){ctx.strokeStyle='rgba('+((r*a*0.16*255)|0)+','+((g*a*0.16*255)|0)+','+((b*a*0.16*255)|0)+',1)';ctx.lineWidth=4.5*pulse;}
      else{ctx.strokeStyle='rgba('+((r*a*255)|0)+','+((g*a*255)|0)+','+((b*a*255)|0)+',1)';ctx.lineWidth=1.4;}
      trim(x0,y0,x1,y1,ctx.lineWidth);
      ctx.beginPath();ctx.moveTo(TR[0],TR[1]);ctx.lineTo(TR[2],TR[3]);ctx.stroke();
    }
  }
  ctx.restore();
}
// Draw the oscillating charge: a short axis tick and a radial glow whose color
// and position swing with sin(t), so the charge visibly vibrates along the axis.
function renderSource(){
  const [ax,ay]=axisVec();const osc=Math.sin(SIM.t);const off=osc*7;
  const cx=SRC.x,cy=SRC.y;ctx.save();
  ctx.strokeStyle='rgba(168,185,217,0.35)';ctx.lineWidth=1.5;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(cx-ax*12,cy-ay*12);ctx.lineTo(cx+ax*12,cy+ay*12);ctx.stroke();
  const gx=cx+ax*off,gy=cy+ay*off,mix=(osc+1)*0.5;
  const cr=(PAL.b[0]+(PAL.e[0]-PAL.b[0])*mix)|0,cg=(PAL.b[1]+(PAL.e[1]-PAL.b[1])*mix)|0,cb=(PAL.b[2]+(PAL.e[2]-PAL.b[2])*mix)|0,c=cr+','+cg+','+cb;
  const grd=ctx.createRadialGradient(gx,gy,0,gx,gy,22);
  grd.addColorStop(0,'rgba('+c+',0.95)');grd.addColorStop(0.35,'rgba('+c+',0.35)');grd.addColorStop(1,'rgba('+c+',0)');
  ctx.fillStyle=grd;ctx.beginPath();ctx.arc(gx,gy,22,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(255,250,240,1)';ctx.beginPath();ctx.arc(gx,gy,3.2,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// Control wiring. sg paints a slider's filled track; each set* handler writes one
// SIM field and updates its readout; tog flips a boolean layer; togglePlay and
// setSpeed drive the time clock. These are called from inline handlers in the HTML.
/* ─── controls ─── */
function sg(el){if(!el)return;const min=+el.min,max=+el.max;el.style.setProperty('--pct',((el.value-min)/(max-min)*100)+'%');}
function setFreq(el){SIM.freq=+el.value;document.getElementById('vl-freq').textContent=SIM.freq.toFixed(2);sg(el);}
function setLambda(el){SIM.lambda=+el.value;document.getElementById('vl-lambda').textContent=SIM.lambda;document.getElementById('st-lambda').textContent=SIM.lambda;sg(el);}
function setAxis(el){SIM.axisDeg=+el.value;document.getElementById('vl-axis').textContent=SIM.axisDeg;sg(el);}
function setDensity(el){SIM.density=+el.value;document.getElementById('vl-density').textContent=SIM.density;sg(el);}
function setCoef(key,el){SIM[key]=+el.value;const m={amp:'vl-amp',cNear:'vl-near',cRad:'vl-rad'};document.getElementById(m[key]).textContent=(+el.value).toFixed(2);sg(el);}
function tog(key,btn){SIM[key]=!SIM[key];btn.classList.toggle('on',SIM[key]);}
// The play button shows the action it will take: pause while playing.
function togglePlay(){SIM.playing=!SIM.playing;const b=document.getElementById('btn-play');b.textContent=SIM.playing?'❚❚':'▶';b.classList.toggle('on',SIM.playing);}
function setSpeed(s){SIM.speed=s;document.getElementById('sp-slow').classList.toggle('on',s<1);document.getElementById('sp-1').classList.toggle('on',s>=1);}
// The tune card (a bottom sheet on phones). open omitted = toggle.
function tuneOpen(open){const t=document.getElementById('tune'),b=document.getElementById('tune-btn');const o=open===undefined?!t.classList.contains('open'):!!open;t.classList.toggle('open',o);b.classList.toggle('on',o);}

// Pointer handling: drag the source when the press lands near it. ptr maps a
// mouse or touch event to canvas pixels; the handlers store the grab offset so
// the charge follows the cursor without snapping its center to it.
/* ─── pointer: drag source ─── */
function ptr(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return [t.clientX-r.left,t.clientY-r.top];}
canvas.addEventListener('mousedown',e=>{const[x,y]=ptr(e);if(Math.hypot(x-SRC.x,y-SRC.y)<60){dragging=true;dragDX=SRC.x-x;dragDY=SRC.y-y;}});
canvas.addEventListener('mousemove',e=>{if(!dragging)return;const[x,y]=ptr(e);SRC.x=x+dragDX;SRC.y=y+dragDY;});
window.addEventListener('mouseup',()=>dragging=false);
canvas.addEventListener('touchstart',e=>{const[x,y]=ptr(e);if(Math.hypot(x-SRC.x,y-SRC.y)<70){dragging=true;dragDX=SRC.x-x;dragDY=SRC.y-y;e.preventDefault();}},{passive:false});
canvas.addEventListener('touchmove',e=>{if(!dragging)return;const[x,y]=ptr(e);SRC.x=x+dragDX;SRC.y=y+dragDY;e.preventDefault();},{passive:false});
window.addEventListener('touchend',()=>dragging=false);

// Fit the canvas to the stage element, scale the backing store by device pixel
// ratio (capped at 2), and place the source near the center on first size.
/* ─── resize ─── */
function resize(){
  const s=document.getElementById('stage');CW=s.clientWidth;CH=s.clientHeight;
  if(CW<10||CH<10){CW=600;CH=400;}
  const dpr=Math.min(devicePixelRatio,2);canvas.width=CW*dpr;canvas.height=CH*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  if(SRC.x===0&&SRC.y===0){SRC.x=CW*0.46;SRC.y=CH*0.5;}
}
// Prefer a ResizeObserver on the stage; fall back to the window resize event.
if(window.ResizeObserver){new ResizeObserver(()=>resize()).observe(document.getElementById('stage'));}
else{window.addEventListener('resize',resize);}

// The animation loop. Advance the phase clock by real elapsed time (scaled by
// freq and speed) when playing, refresh the FPS and status readouts, and render.
/* ─── loop ─── */
let last=0,fc=0,ft=0;
function loop(time){
  requestAnimationFrame(loop);
  const dt=Math.min((time-last)/1000,0.05);last=time;
  fc++;ft+=dt;if(ft>=0.5){document.getElementById('st-fps').textContent=Math.round(fc/ft)+' fps';fc=0;ft=0;}
  if(SIM.playing){SIM.t+=dt*SIM.freq*SIM.speed*3.2;}
  document.getElementById('st-c').textContent=(SIM.lambda*SIM.freq).toFixed(0)+'px/s';
  document.getElementById('st-phase').textContent=(SIM.t%(2*Math.PI)).toFixed(2);
  render();
}
// Boot: paint every slider's initial fill, then size the canvas and start the
// loop after a short delay so the layout has settled.
document.querySelectorAll('#tune input[type=range]').forEach(sg);
setTimeout(()=>{resize();requestAnimationFrame(loop);},60);
