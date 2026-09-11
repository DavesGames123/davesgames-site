const canvas=document.getElementById('sim-canvas');
const ctx=canvas.getContext('2d');
let CW=100,CH=100;

const SIM={
  playing:true, speed:1.0, t:0,
  freq:1.0, lambda:140, axisDeg:90, density:42,
  showLines:true, showFlow:true, showB:true, showFronts:false, showVectors:true,
  amp:1.0, cNear:1.0, cRad:1.0,
  overlay:null,
};
const SRC={x:0,y:0};
let dragging=false,dragDX=0,dragDY=0;

function fieldColorRGB(mag,gamma){
  gamma=gamma||1.0;
  const lv=Math.log10(1+mag*9e6)/6.6;
  const lc=Math.pow(Math.max(0,Math.min(1,lv)),1/Math.max(0.1,gamma));
  const stops=[[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]];
  const sv=lc*5,si=Math.min(Math.floor(sv),4),sf=sv-si;
  return [stops[si][0]+sf*(stops[si+1][0]-stops[si][0]),
          stops[si][1]+sf*(stops[si+1][1]-stops[si][1]),
          stops[si][2]+sf*(stops[si+1][2]-stops[si][2])];
}
function kOf(){return 2*Math.PI/SIM.lambda;}
function axisVec(){const a=SIM.axisDeg*Math.PI/180;return [Math.cos(a),-Math.sin(a)];}

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
function field(x,y){return fieldAt(x,y,SIM.t);}

/* ─── OVERLAYS: hover a Maxwell equation → see that quantity ───
   .fn  = signed scalar for the heatmap
   .cvec= the COMPONENT vector drawn over the base E vectors, or 'glyph' (B⊥), or null */
const HT=0.05, hS=2;
function dEdt(x,y,comp){const a=fieldAt(x,y,SIM.t+HT),b=fieldAt(x,y,SIM.t-HT);return (a[comp]-b[comp])/(2*HT);}
function dBz_dy(x,y){return (field(x,y+hS).Bz-field(x,y-hS).Bz)/(2*hS);}
function dBz_dx(x,y){return (field(x+hS,y).Bz-field(x-hS,y).Bz)/(2*hS);}
const OVL={
  Ex:{lab:'Eₓ — electric field, x-component', fn:(x,y)=>field(x,y).Ex, cvec:(x,y)=>[field(x,y).Ex,0]},
  Ey:{lab:'E_y — electric field, y-component', fn:(x,y)=>field(x,y).Ey, cvec:(x,y)=>[0,field(x,y).Ey]},
  Bz:{lab:'B⊥ — magnetic field, out of / into the plane', fn:(x,y)=>field(x,y).Bz, cvec:'glyph'},
  dExdt:{lab:'∂Eₓ/∂t — displacement current, x', fn:(x,y)=>dEdt(x,y,'Ex'), cvec:(x,y)=>[dEdt(x,y,'Ex'),0]},
  dEydt:{lab:'∂E_y/∂t — displacement current, y', fn:(x,y)=>dEdt(x,y,'Ey'), cvec:(x,y)=>[0,dEdt(x,y,'Ey')]},
  curlHx:{lab:'(∇×H)ₓ ∝ ∂_y B⊥', fn:dBz_dy, cvec:(x,y)=>[dBz_dy(x,y),0]},
  curlHy:{lab:'(∇×H)_y ∝ −∂ₓ B⊥', fn:(x,y)=>-dBz_dx(x,y), cvec:(x,y)=>[0,-dBz_dx(x,y)]},
  divE:{lab:'∇·E — sources of the field (≈ 0 away from the charge)', fn:(x,y)=>(dExdx(x,y)+dEydy(x,y)), cvec:null},
  zero:{lab:'≡ 0 for an in-plane dipole — this component vanishes in the slice', fn:null, cvec:null},
};
function dExdx(x,y){return (field(x+hS,y).Ex-field(x-hS,y).Ex)/(2*hS);}
function dEydy(x,y){return (field(x,y+hS).Ey-field(x,y-hS).Ey)/(2*hS);}
window.__setOverlay=function(kind){
  SIM.overlay=(kind&&OVL[kind])?kind:null;
  const cap=document.getElementById('ovl-caption'),stov=document.getElementById('st-ovl');
  if(!SIM.overlay){cap.classList.remove('show');stov.innerHTML='showing: <b>field lines</b>';return;}
  const o=OVL[kind];cap.classList.add('show');
  cap.innerHTML=o.fn
    ? o.lab+'<span class="ck"><span class="pm pos">▮ positive</span> &nbsp; <span class="pm neg">▮ negative</span> &nbsp; amber arrow = this component</span>'
    : o.lab+'<span class="ck">nothing to draw — the field has no component here</span>';
  stov.innerHTML='showing: <b>'+kind+'</b>';
};

/* ─── smooth high-resolution field heatmap (computed dense, upscaled with smoothing) ─── */
const hmCanvas=document.createElement('canvas'); const hmCtx=hmCanvas.getContext('2d');
function drawHeatmap(fn){
  const step=7;
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
    if(a>1)a=1; const al=(a*235)|0; const o=p*4;
    if(v>=0){data[o]=255;data[o+1]=176;data[o+2]=77;} else {data[o]=96;data[o+1]=170;data[o+2]=255;}
    data[o+3]=al;
  }
  hmCtx.putImageData(img,0,0);
  ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(hmCanvas,0,0,bw,bh,0,0,CW,CH);ctx.restore();
}

/* ─── vector field arrows ─── */
function arrowGS(){return Math.max(30,Math.round(Math.min(CW,CH)/14));}
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
    ctx.strokeStyle='rgba('+rgb+','+al+')';ctx.lineWidth=1.3;
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    const px=-ny*2.6,py=nx*2.6;
    ctx.fillStyle='rgba('+rgb+','+al+')';
    ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x1-nx*4.6+px,y1-ny*4.6+py);ctx.lineTo(x1-nx*4.6-px,y1-ny*4.6-py);ctx.closePath();ctx.fill();
  }
  ctx.restore();
}
function drawBzGlyphs(){
  const gs=arrowGS(); let mx=1e-30; const pts=[];
  for(let y=gs/2;y<CH;y+=gs)for(let x=gs/2;x<CW;x+=gs){const v=field(x,y).Bz;const a=Math.abs(v);if(a>mx)mx=a;pts.push([x,y,v]);}
  const K=1e4/mx, DEN=Math.log10(1+1e4);
  ctx.save();
  for(const p of pts){
    const v=p[2],a=Math.abs(v);if(a<1e-13)continue;
    const t=Math.log10(1+a*K)/DEN, r=2+t*6, al=0.35+0.6*t;
    ctx.strokeStyle='rgba(255,200,50,'+al+')';ctx.lineWidth=1.4;
    ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.stroke();
    if(v>=0){ctx.fillStyle='rgba(255,200,50,'+al+')';ctx.beginPath();ctx.arc(p[0],p[1],Math.max(1,r*0.32),0,Math.PI*2);ctx.fill();}
    else{const d=r*0.7;ctx.beginPath();ctx.moveTo(p[0]-d,p[1]-d);ctx.lineTo(p[0]+d,p[1]+d);ctx.moveTo(p[0]+d,p[1]-d);ctx.lineTo(p[0]-d,p[1]+d);ctx.stroke();}
  }
  ctx.restore();
}
function renderComponentVectors(kind){
  const o=OVL[kind]; if(!o) return;
  if(o.cvec==='glyph'){drawBzGlyphs();return;}
  if(typeof o.cvec==='function'){drawArrowField(o.cvec,'255,200,50',0.95,1.0);}
}

/* ─── stream-function field lines (contours; smooth in time) ─── */
let GS=0,GW=0,GH=0,psiGrid=null,magGrid=null;
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
function contourLevels(){
  const k=kOf();
  const M=Math.max(7,Math.min(20,Math.round(SIM.density/3.8)));
  const base=k*0.025, ratio=1.5, out=[];
  for(let n=0;n<M;n++){const v=base*Math.pow(ratio,n);out.push(v);out.push(-v);}
  out.sort((a,b)=>a-b);
  return out;
}
function sampleMag(x,y){const gi=Math.min(GW-1,Math.max(0,(x/GS)|0)),gj=Math.min(GH-1,Math.max(0,(y/GS)|0));return magGrid[gj*GW+gi];}
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

/* ─── render ─── */
function render(){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.restore();
  ctx.fillStyle='#0b0e15';ctx.fillRect(0,0,CW,CH);
  ctx.strokeStyle='rgba(150,200,255,0.022)';ctx.lineWidth=1;
  for(let x=0;x<CW;x+=46){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke();}
  for(let y=0;y<CH;y+=46){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke();}

  // base field heatmap: overlay quantity when hovering, else the magnetic field
  if(SIM.overlay && OVL[SIM.overlay].fn) drawHeatmap(OVL[SIM.overlay].fn);
  else if(SIM.showB && !SIM.overlay) drawHeatmap((x,y)=>field(x,y).Bz);

  if(SIM.showFronts) renderFronts();
  if(SIM.showLines) renderLines();
  if(SIM.showVectors) drawArrowField((x,y)=>{const f=field(x,y);return [f.Ex,f.Ey];},'205,216,238',0.55,1.0);
  if(SIM.overlay) renderComponentVectors(SIM.overlay);
  renderSource();
}
function renderFronts(){
  const k=kOf();ctx.save();ctx.strokeStyle='rgba(150,200,255,0.13)';ctx.lineWidth=1;ctx.setLineDash([2,6]);
  for(let n=0;n<16;n++){const r=(2*Math.PI*n+SIM.t)/k;if(r<8||r>Math.hypot(CW,CH))continue;
    ctx.beginPath();ctx.arc(SRC.x,SRC.y,r,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
function renderLines(){
  buildGrid();
  const levels=contourLevels();const segs=[];marchAll(levels,segs);
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
  const k=kOf(),flowPhase=SIM.t/k, dim=SIM.overlay?0.3:1;
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
      if(pass===0){ctx.strokeStyle='rgba('+((r*a*0.18*255)|0)+','+((g*a*0.18*255)|0)+','+((b*a*0.18*255)|0)+',1)';ctx.lineWidth=4.5*pulse;}
      else{ctx.strokeStyle='rgba('+((r*a*255)|0)+','+((g*a*255)|0)+','+((b*a*255)|0)+',1)';ctx.lineWidth=1.4;}
      ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    }
  }
  ctx.restore();
}
function renderSource(){
  const [ax,ay]=axisVec();const osc=Math.sin(SIM.t);const off=osc*7;
  const cx=SRC.x,cy=SRC.y;ctx.save();
  ctx.strokeStyle='rgba(150,200,255,0.25)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(cx-ax*12,cy-ay*12);ctx.lineTo(cx+ax*12,cy+ay*12);ctx.stroke();
  const gx=cx+ax*off,gy=cy+ay*off,mix=(osc+1)*0.5;
  const cr=(96+(255-96)*mix)|0,cg=(224+(200-224)*mix)|0,cb=(238+(50-238)*mix)|0,c=cr+','+cg+','+cb;
  const grd=ctx.createRadialGradient(gx,gy,0,gx,gy,16);
  grd.addColorStop(0,'rgba('+c+',0.95)');grd.addColorStop(0.4,'rgba('+c+',0.4)');grd.addColorStop(1,'rgba('+c+',0)');
  ctx.fillStyle=grd;ctx.beginPath();ctx.arc(gx,gy,16,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba('+c+',1)';ctx.beginPath();ctx.arc(gx,gy,3.2,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

/* ─── controls ─── */
function sg(el){if(!el)return;const min=+el.min,max=+el.max;el.style.setProperty('--pct',((el.value-min)/(max-min)*100)+'%');}
function setFreq(el){SIM.freq=+el.value;document.getElementById('vl-freq').textContent=SIM.freq.toFixed(2);sg(el);}
function setLambda(el){SIM.lambda=+el.value;document.getElementById('vl-lambda').textContent=SIM.lambda;document.getElementById('st-lambda').textContent=SIM.lambda;sg(el);}
function setAxis(el){SIM.axisDeg=+el.value;document.getElementById('vl-axis').textContent=SIM.axisDeg;sg(el);}
function setDensity(el){SIM.density=+el.value;document.getElementById('vl-density').textContent=SIM.density;sg(el);}
function setCoef(key,el){SIM[key]=+el.value;const m={amp:'vl-amp',cNear:'vl-near',cRad:'vl-rad'};document.getElementById(m[key]).textContent=(+el.value).toFixed(2);sg(el);}
function tog(key,btn){SIM[key]=!SIM[key];btn.classList.toggle('on',SIM[key]);}
function togglePlay(){SIM.playing=!SIM.playing;const b=document.getElementById('btn-play');b.textContent=SIM.playing?'▶ Play':'❚❚ Pause';b.classList.toggle('active',SIM.playing);}
function setSpeed(s){SIM.speed=s;}

/* ─── pointer: drag source ─── */
function ptr(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return [t.clientX-r.left,t.clientY-r.top];}
canvas.addEventListener('mousedown',e=>{const[x,y]=ptr(e);if(Math.hypot(x-SRC.x,y-SRC.y)<60){dragging=true;dragDX=SRC.x-x;dragDY=SRC.y-y;}});
canvas.addEventListener('mousemove',e=>{if(!dragging)return;const[x,y]=ptr(e);SRC.x=x+dragDX;SRC.y=y+dragDY;});
window.addEventListener('mouseup',()=>dragging=false);
canvas.addEventListener('touchstart',e=>{const[x,y]=ptr(e);if(Math.hypot(x-SRC.x,y-SRC.y)<70){dragging=true;dragDX=SRC.x-x;dragDY=SRC.y-y;e.preventDefault();}},{passive:false});
canvas.addEventListener('touchmove',e=>{if(!dragging)return;const[x,y]=ptr(e);SRC.x=x+dragDX;SRC.y=y+dragDY;e.preventDefault();},{passive:false});
window.addEventListener('touchend',()=>dragging=false);

/* ─── resize ─── */
function resize(){
  const s=document.getElementById('stage');CW=s.clientWidth;CH=s.clientHeight;
  if(CW<10||CH<10){CW=600;CH=400;}
  const dpr=Math.min(devicePixelRatio,2);canvas.width=CW*dpr;canvas.height=CH*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  if(SRC.x===0&&SRC.y===0){SRC.x=CW*0.46;SRC.y=CH*0.5;}
}
if(window.ResizeObserver){new ResizeObserver(()=>resize()).observe(document.getElementById('stage'));}
else{window.addEventListener('resize',resize);}

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
document.querySelectorAll('#rail input[type=range]').forEach(sg);
setTimeout(()=>{resize();requestAnimationFrame(loop);},60);
