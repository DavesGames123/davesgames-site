/* ════════════════════════════════════════════════════════════
   BIOT-SAVART LAW — INTERACTIVE EDUCATIONAL SIMULATOR
   Cross-section view: infinite wires ⊥ to screen.
   B field in-plane: B = μ₀I/(2πr) in φ̂ direction.
   ════════════════════════════════════════════════════════════ */
const canvas=document.getElementById('sim-canvas');
const ctx=canvas.getContext('2d');
let CW=100,CH=100;

const SIM={
  showTracers:true,showArrows:true,showHeatmap:false,
  tracerCount:2000,tracerSpeed:1.5,tracerTrail:35,
  showProbe:true,probeX:0,probeY:0,
  stepping:false,stepIdx:0,stepTimer:0,
  selectedId:-1,
};
let wires=[],tracers=[],nextId=0;

/* ═══ CAMERA ═══ */
const CAM={x:0,y:0,zoom:1};
function screenToWorld(sx,sy){return[(sx-CW/2)/CAM.zoom+CW/2-CAM.x,(sy-CH/2)/CAM.zoom+CH/2-CAM.y];}

// Wire colors for probe decomposition
const WIRE_COLORS=['#60e0ee','#64c864','#ff9050','#c890ff','#ffc832','#ff6b6b','#b896ff','#64dcc8','#f5c842','#ff8830'];

/* ═══ PHYSICS: INFINITE WIRE FIELD ═══ */
// B = μ₀I/(2πr) perpendicular to r, right-hand rule
// In 2D: wire at (wx,wy) with current I (positive=out of screen)
// At point (px,py): B direction is (-dy,dx)/r (rotated 90° CCW for I>0)
function wireField(px,py,wx,wy,current){
  const dx=px-wx,dy=py-wy;
  const r2=dx*dx+dy*dy;
  if(r2<25) return[0,0]; // avoid singularity within 5px
  const r=Math.sqrt(r2);
  // B = μ₀I/(2πr), direction = (-dy,dx)/r for I>0 (CCW circulation)
  const B=current/(r*6.2832); // μ₀/4π absorbed into display scaling
  return[-dy/r*B, dx/r*B];
}

function totalField(px,py){
  let Bx=0,By=0;
  for(const w of wires){
    const[bx,by]=wireField(px,py,w.x,w.y,w.current);
    Bx+=bx;By+=by;
  }
  return[Bx,By];
}

/* ═══ FIELD COLOR (matches MagnetLab/orbital viewer) ═══ */
function fieldColorRGB(mag,gamma){
  gamma=gamma||1;
  const lv=Math.log10(1+mag*12)/2.2;
  const lc=Math.pow(Math.max(0,Math.min(1,lv)),1/Math.max(0.1,gamma));
  const S=[[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]];
  const sv=lc*5,si=Math.min(Math.floor(sv),4),sf=sv-si;
  return[S[si][0]+sf*(S[si+1][0]-S[si][0]),S[si][1]+sf*(S[si+1][1]-S[si][1]),S[si][2]+sf*(S[si+1][2]-S[si][2])];
}

/* ═══ TRACERS ═══ */
function spawnTracers(){
  tracers=[];
  for(let i=0;i<SIM.tracerCount;i++){
    tracers.push({x:Math.random()*CW,y:Math.random()*CH,trail:[],age:0,maxAge:2.5+Math.random()*4});
  }
}
function updateTracers(dt){
  const speed=SIM.tracerSpeed*80;
  for(const tr of tracers){
    tr.age+=dt;
    const[Bx,By]=totalField(tr.x,tr.y);
    const Bmag=Math.sqrt(Bx*Bx+By*By);
    if(Bmag>1e-6){tr.x+=(Bx/Bmag)*speed*dt;tr.y+=(By/Bmag)*speed*dt;}
    tr.trail.unshift([tr.x,tr.y,Bmag]);
    if(tr.trail.length>SIM.tracerTrail) tr.trail.pop();
    // Check if inside any wire
    let inWire=false;
    for(const w of wires){const dx=tr.x-w.x,dy=tr.y-w.y;if(dx*dx+dy*dy<144){inWire=true;break;}}
    if(tr.age>tr.maxAge||tr.x<-20||tr.x>CW+20||tr.y<-20||tr.y>CH+20||inWire){
      // Respawn biased near wires
      if(wires.length>0&&Math.random()<0.6){
        const w=wires[Math.floor(Math.random()*wires.length)];
        const a=Math.random()*Math.PI*2,r=15+Math.random()*60;
        tr.x=w.x+Math.cos(a)*r;tr.y=w.y+Math.sin(a)*r;
      } else {tr.x=Math.random()*CW;tr.y=Math.random()*CH;}
      tr.trail=[];tr.age=0;tr.maxAge=2.5+Math.random()*4;
    }
  }
}

/* ═══ RENDER ═══ */
function render(){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.restore();
  ctx.fillStyle='#0e1118';ctx.fillRect(0,0,CW,CH);

  // Camera transform
  ctx.save();
  ctx.translate(CW/2,CH/2);
  ctx.scale(CAM.zoom,CAM.zoom);
  ctx.translate(-CW/2+CAM.x,-CH/2+CAM.y);

  // Grid
  const gx0=Math.floor(((0-CW/2)/CAM.zoom+CW/2-CAM.x)/50)*50;
  const gy0=Math.floor(((0-CH/2)/CAM.zoom+CH/2-CAM.y)/50)*50;
  const[vx1,vy1]=screenToWorld(CW,CH);
  ctx.strokeStyle='rgba(150,200,255,0.03)';ctx.lineWidth=1/CAM.zoom;
  for(let x=gx0;x<vx1;x+=50){ctx.beginPath();ctx.moveTo(x,gy0);ctx.lineTo(x,vy1);ctx.stroke();}
  for(let y=gy0;y<vy1;y+=50){ctx.beginPath();ctx.moveTo(gx0,y);ctx.lineTo(vx1,y);ctx.stroke();}

  if(SIM.showHeatmap) renderHeatmap();
  if(SIM.showArrows) renderArrows();
  if(SIM.showTracers) renderTracers();
  renderWires();
  if(SIM.showProbe&&wires.length>0) renderProbe();
  ctx.restore(); // camera transform
}

function renderHeatmap(){
  const step=12;
  for(let x=0;x<CW;x+=step)for(let y=0;y<CH;y+=step){
    const[Bx,By]=totalField(x+step/2,y+step/2);
    const Bmag=Math.sqrt(Bx*Bx+By*By);
    const[r,g,b]=fieldColorRGB(Bmag);
    ctx.fillStyle=`rgba(${(r*255)|0},${(g*255)|0},${(b*255)|0},0.35)`;
    ctx.fillRect(x,y,step,step);
  }
}

function renderArrows(){
  ctx.save();ctx.globalCompositeOperation='lighter';
  const step=30,maxLen=13;
  for(let x=step/2;x<CW;x+=step)for(let y=step/2;y<CH;y+=step){
    const[Bx,By]=totalField(x,y);
    const Bmag=Math.sqrt(Bx*Bx+By*By);
    if(Bmag<1e-5)continue;
    const[r,g,b]=fieldColorRGB(Bmag);
    const lv=Math.min(1,Math.log10(1+Bmag*12)/2.2);
    const len=Math.max(2,lv*maxLen);
    const nx=Bx/Bmag,ny=By/Bmag,alpha=Math.max(0.05,Math.min(0.45,lv*0.5));
    ctx.strokeStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;
    ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    if(len>3){
      const ax=x+nx*len,ay=y+ny*len,px=-ny*2,py=nx*2;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*3+px,ay-ny*3+py);ctx.lineTo(ax-nx*3-px,ay-ny*3-py);ctx.closePath();
      ctx.fillStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;ctx.fill();
    }
  }
  ctx.restore();
}

function renderTracers(){
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
  for(const tr of tracers){
    const tl=tr.trail.length;if(tl<2)continue;
    const ageA=tr.age<0.1?tr.age/0.1:tr.age>tr.maxAge*0.8?(tr.maxAge-tr.age)/(tr.maxAge*0.2):1;
    for(let s=0;s<tl-1;s++){
      const pt=tr.trail[s],pn=tr.trail[s+1];
      const a0=(1-s/SIM.tracerTrail)*ageA;
      if(a0<0.01)continue;
      const[r,g,b]=fieldColorRGB(pt[2]||0);
      ctx.strokeStyle=`rgba(${(r*a0*0.12*255)|0},${(g*a0*0.12*255)|0},${(b*a0*0.12*255)|0},1)`;
      ctx.lineWidth=Math.max(1,5*a0);ctx.beginPath();ctx.moveTo(pt[0],pt[1]);ctx.lineTo(pn[0],pn[1]);ctx.stroke();
      ctx.strokeStyle=`rgba(${(r*a0*0.55*255)|0},${(g*a0*0.55*255)|0},${(b*a0*0.55*255)|0},1)`;
      ctx.lineWidth=Math.max(0.5,1.8*a0);ctx.beginPath();ctx.moveTo(pt[0],pt[1]);ctx.lineTo(pn[0],pn[1]);ctx.stroke();
    }
  }
  ctx.restore();
}

function renderWires(){
  for(const w of wires){
    const sel=w.id===SIM.selectedId;
    const out=w.current>0;
    // Wire body
    ctx.beginPath();ctx.arc(w.x,w.y,10,0,Math.PI*2);
    ctx.fillStyle=sel?'rgba(30,35,50,0.95)':'rgba(20,25,40,0.9)';ctx.fill();
    ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';
    ctx.lineWidth=sel?2.5:1.5;ctx.stroke();
    // Current symbol
    ctx.fillStyle=out?'#64c864':'#e05050';
    ctx.font='bold 14px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
    if(out){
      // ⊙ dot
      ctx.beginPath();ctx.arc(w.x,w.y,4,0,Math.PI*2);ctx.fill();
    } else {
      // ⊗ cross
      ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=2.5;
      ctx.beginPath();ctx.moveTo(w.x-6,w.y-6);ctx.lineTo(w.x+6,w.y+6);
      ctx.moveTo(w.x+6,w.y-6);ctx.lineTo(w.x-6,w.y+6);ctx.stroke();
    }
    // Current magnitude ring
    const ringR=12+Math.abs(w.current)*3;
    ctx.strokeStyle=out?'rgba(100,200,100,0.25)':'rgba(224,80,80,0.25)';
    ctx.lineWidth=1;ctx.setLineDash([3,3]);
    ctx.beginPath();ctx.arc(w.x,w.y,ringR,0,Math.PI*2);ctx.stroke();
    ctx.setLineDash([]);
    // Label — larger
    ctx.font='bold 11px "JetBrains Mono"';ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.fillText((w.current>0?'+':'')+w.current.toFixed(1)+'A',w.x,w.y-20);
  }
}

function renderProbe(){
  const px=SIM.probeX,py=SIM.probeY;
  const maxWires=SIM.stepping?SIM.stepIdx:wires.length;

  // Draw individual contribution vectors
  let totalBx=0,totalBy=0;
  for(let i=0;i<wires.length;i++){
    const w=wires[i];
    const[bx,by]=wireField(px,py,w.x,w.y,w.current);
    const active=i<maxWires;
    if(active){totalBx+=bx;totalBy+=by;}

    // Contribution vector
    const scale=800;
    const vx=bx*scale,vy=by*scale;
    const len=Math.sqrt(vx*vx+vy*vy);
    if(len<1)continue;

    const col=WIRE_COLORS[i%WIRE_COLORS.length];
    ctx.globalAlpha=active?0.8:0.15;
    ctx.strokeStyle=col;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+vx,py+vy);ctx.stroke();
    // Arrowhead
    if(len>5){
      const nx=vx/len,ny=vy/len;
      const ax=px+vx,ay=py+vy,ppx=-ny*4,ppy=nx*4;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*7+ppx,ay-ny*7+ppy);ctx.lineTo(ax-nx*7-ppx,ay-ny*7-ppy);ctx.closePath();
      ctx.fillStyle=col;ctx.fill();
    }
    // Dashed line from wire to probe
    ctx.strokeStyle=col;ctx.lineWidth=0.5;ctx.setLineDash([4,4]);ctx.globalAlpha=active?0.3:0.08;
    ctx.beginPath();ctx.moveTo(w.x,w.y);ctx.lineTo(px,py);ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha=1;
  }

  // Total B vector (white, thick)
  const tvx=totalBx*800,tvy=totalBy*800;
  const tlen=Math.sqrt(tvx*tvx+tvy*tvy);
  if(tlen>1){
    ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.globalAlpha=0.9;
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+tvx,py+tvy);ctx.stroke();
    const nx=tvx/tlen,ny=tvy/tlen;
    const ax=px+tvx,ay=py+tvy,ppx=-ny*5,ppy=nx*5;
    ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*9+ppx,ay-ny*9+ppy);ctx.lineTo(ax-nx*9-ppx,ay-ny*9-ppy);ctx.closePath();
    ctx.fillStyle='#fff';ctx.fill();
    ctx.globalAlpha=1;
  }

  // Compass needle — rotates to align with total B
  const Bmag=Math.sqrt(totalBx*totalBx+totalBy*totalBy);
  const angle=Math.atan2(totalBy,totalBx);
  const needleLen=18,needleW=5;
  ctx.save();
  ctx.translate(px,py);
  ctx.rotate(angle);
  // Compass housing
  ctx.beginPath();ctx.arc(0,0,needleLen+4,0,Math.PI*2);
  ctx.fillStyle='rgba(20,25,40,0.85)';ctx.fill();
  ctx.strokeStyle='rgba(255,200,50,0.6)';ctx.lineWidth=1.5;ctx.stroke();
  // N half (red) — points in B direction
  ctx.beginPath();ctx.moveTo(needleLen,0);ctx.lineTo(-2,needleW);ctx.lineTo(-2,-needleW);ctx.closePath();
  ctx.fillStyle='rgba(220,60,60,0.9)';ctx.fill();
  // S half (blue)
  ctx.beginPath();ctx.moveTo(-needleLen,0);ctx.lineTo(2,needleW);ctx.lineTo(2,-needleW);ctx.closePath();
  ctx.fillStyle='rgba(60,100,220,0.9)';ctx.fill();
  // Center pivot
  ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);
  ctx.fillStyle='#ffc832';ctx.fill();
  // N/S labels
  ctx.font='bold 7px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,200,200,0.9)';ctx.fillText('N',needleLen*0.55,0);
  ctx.fillStyle='rgba(200,200,255,0.9)';ctx.fillText('S',-needleLen*0.55,0);
  ctx.restore();

  // |B| label below compass
  ctx.font='bold 10px "JetBrains Mono"';ctx.textAlign='center';ctx.fillStyle='rgba(255,200,50,0.7)';
  ctx.fillText('|B|='+Bmag.toFixed(3),px,py+needleLen+16);

  // Update status
  document.getElementById('st-probe').textContent='probe: |B|='+Bmag.toFixed(4);
}

/* ═══ UI ═══ */
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}

function rebuildWireList(){
  const list=document.getElementById('wire-list');list.innerHTML='';
  wires.forEach((w,i)=>{
    const c=document.createElement('div');
    c.className='wire-card'+(w.id===SIM.selectedId?' selected':'');
    c.onclick=e=>{if(!e.target.closest('.wire-card-del')){SIM.selectedId=w.id;rebuildWireList();}};
    const col=WIRE_COLORS[i%WIRE_COLORS.length];
    c.innerHTML=`<div class="wire-card-head"><span class="wire-card-icon" style="color:${col}">${w.current>0?'⊙':'⊗'}</span><span class="wire-card-name">Wire #${w.id}</span><button class="wire-card-del" onclick="removeWire(${w.id})">✕</button></div>
      <div class="mag-row"><span class="mag-row-lbl">I</span><input type="range" min="-5" max="5" value="${w.current}" step="0.1" oninput="setWireProp(${w.id},'current',+this.value,this)"><span class="val">${w.current.toFixed(1)}</span></div>`;
    list.appendChild(c);
    c.querySelectorAll('input[type=range]').forEach(sg);
  });
  document.getElementById('st-wires').textContent=wires.length+' wire'+(wires.length!==1?'s':'');
}

function addWire(dir){
  // Spawn along horizontal center, spaced apart
  let cx=CW/2,cy=CH/2,placed=false;
  for(let ring=0;ring<8&&!placed;ring++){
    const offsets=ring===0?[0]:[-ring*60,ring*60];
    for(const ox of offsets){
      const tx=CW/2+ox;
      let ok=true;
      for(const w of wires){if(Math.abs(tx-w.x)<50){ok=false;break;}}
      if(ok){cx=tx;placed=true;break;}
    }
  }
  cx=Math.max(30,Math.min(CW-30,cx));
  wires.push({id:nextId++,x:cx,y:cy,current:dir*2.0});
  SIM.selectedId=wires[wires.length-1].id;
  if(!SIM.probeX){SIM.probeX=CW/2+80;SIM.probeY=CH/2;}
  rebuildWireList();spawnTracers();
  if(window.innerWidth<600)document.getElementById('panel').classList.remove('mob-open');
}
function removeWire(id){wires=wires.filter(w=>w.id!==id);rebuildWireList();spawnTracers();}
function setWireProp(id,prop,val,el){
  const w=wires.find(w=>w.id===id);if(!w)return;w[prop]=val;if(el)sg(el);
  const row=el.closest('.mag-row');if(row)row.querySelector('.val').textContent=val.toFixed(1);
}
function clearAll(){wires=[];SIM.selectedId=-1;rebuildWireList();spawnTracers();}

function toggleProbe(){SIM.showProbe=!SIM.showProbe;const b=document.getElementById('tog-probe');b.classList.toggle('on',SIM.showProbe);b.classList.toggle('off',!SIM.showProbe);}
function toggleStep(){
  SIM.stepping=!SIM.stepping;SIM.stepIdx=0;SIM.stepTimer=0;
  const b=document.getElementById('tog-step');b.classList.toggle('on',SIM.stepping);b.classList.toggle('off',!SIM.stepping);
  document.getElementById('step-info').style.display=SIM.stepping?'block':'none';
}
function toggleOpt(key,btnId){SIM[key]=!SIM[key];const b=document.getElementById(btnId);b.classList.toggle('on',SIM[key]);b.classList.toggle('off',!SIM[key]);}

function preset(name){
  wires=[];nextId=0;
  const cx=CW/2,cy=CH/2,sp=70;
  switch(name){
    case 'parallel':
      wires.push({id:nextId++,x:cx-sp/2,y:cy,current:2});
      wires.push({id:nextId++,x:cx+sp/2,y:cy,current:2});break;
    case 'anti':
      wires.push({id:nextId++,x:cx-sp/2,y:cy,current:2});
      wires.push({id:nextId++,x:cx+sp/2,y:cy,current:-2});break;
    case 'triangle':
      wires.push({id:nextId++,x:cx-sp,y:cy,current:2});
      wires.push({id:nextId++,x:cx,y:cy,current:-2});
      wires.push({id:nextId++,x:cx+sp,y:cy,current:2});break;
    case 'quad':
      wires.push({id:nextId++,x:cx-sp*1.5,y:cy,current:2});
      wires.push({id:nextId++,x:cx-sp*0.5,y:cy,current:-2});
      wires.push({id:nextId++,x:cx+sp*0.5,y:cy,current:2});
      wires.push({id:nextId++,x:cx+sp*1.5,y:cy,current:-2});break;
  }
  SIM.selectedId=wires.length?wires[0].id:-1;
  SIM.probeX=cx+120;SIM.probeY=cy;
  rebuildWireList();spawnTracers();
}

/* ═══ DRAG ═══ */
let dragWire=null,dragProbe=false,dragOff=[0,0],isPanning=false,panLast=[0,0];
function getScreenPos(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return[t.clientX-r.left,t.clientY-r.top];}
function getPos(e){const[sx,sy]=getScreenPos(e);return screenToWorld(sx,sy);}

// Wheel zoom
canvas.addEventListener('wheel',e=>{
  e.preventDefault();const[sx,sy]=getScreenPos(e);const[wx,wy]=screenToWorld(sx,sy);
  CAM.zoom=Math.max(0.2,Math.min(6,CAM.zoom*(e.deltaY<0?1.08:1/1.08)));
  const[wx2,wy2]=screenToWorld(sx,sy);CAM.x+=wx2-wx;CAM.y+=wy2-wy;
},{passive:false});

// Pinch zoom
let pinchD0=0,pinchZ0=1,pinchMX=0,pinchMY=0,pinchCX=0,pinchCY=0,touchN=0;
canvas.addEventListener('touchstart',e=>{
  touchN=e.touches.length;
  if(touchN===2){e.preventDefault();dragWire=null;dragProbe=false;
    const r=canvas.getBoundingClientRect(),t0=e.touches[0],t1=e.touches[1];
    const s0=[t0.clientX-r.left,t0.clientY-r.top],s1=[t1.clientX-r.left,t1.clientY-r.top];
    pinchD0=Math.sqrt((s1[0]-s0[0])**2+(s1[1]-s0[1])**2);pinchZ0=CAM.zoom;
    pinchMX=(s0[0]+s1[0])/2;pinchMY=(s0[1]+s1[1])/2;pinchCX=CAM.x;pinchCY=CAM.y;return;}
  if(touchN===1)onDown(e);
},{passive:false});
canvas.addEventListener('touchmove',e=>{
  if(e.touches.length===2){e.preventDefault();
    const r=canvas.getBoundingClientRect(),t0=e.touches[0],t1=e.touches[1];
    const s0=[t0.clientX-r.left,t0.clientY-r.top],s1=[t1.clientX-r.left,t1.clientY-r.top];
    const d=Math.sqrt((s1[0]-s0[0])**2+(s1[1]-s0[1])**2);
    const mx=(s0[0]+s1[0])/2,my=(s0[1]+s1[1])/2;
    const[wxO,wyO]=screenToWorld(pinchMX,pinchMY);
    CAM.zoom=Math.max(0.2,Math.min(6,pinchZ0*(d/pinchD0)));
    const[wxN,wyN]=screenToWorld(pinchMX,pinchMY);
    CAM.x+=wxN-wxO;CAM.y+=wyN-wyO;
    CAM.x=pinchCX+(mx-pinchMX)/CAM.zoom;CAM.y=pinchCY+(my-pinchMY)/CAM.zoom;return;}
  onMove(e);
},{passive:false});
canvas.addEventListener('touchend',e=>{touchN=e.touches.length;if(!touchN)onUp();},{passive:false});

canvas.addEventListener('mousedown',onDown);
function onDown(e){
  e.preventDefault();const[x,y]=getPos(e);
  if(SIM.showProbe){const dx=x-SIM.probeX,dy=y-SIM.probeY;if(dx*dx+dy*dy<400/CAM.zoom){dragProbe=true;return;}}
  for(let i=wires.length-1;i>=0;i--){const w=wires[i];const dx=x-w.x,dy=y-w.y;if(dx*dx+dy*dy<400/CAM.zoom){dragWire=w;dragOff=[w.x-x,0];SIM.selectedId=w.id;rebuildWireList();return;}}
  isPanning=true;const[sx,sy]=getScreenPos(e);panLast=[sx,sy];
}
window.addEventListener('mousemove',onMove);
function onMove(e){
  if(isPanning&&!dragWire&&!dragProbe){
    const[sx,sy]=getScreenPos(e);CAM.x+=(sx-panLast[0])/CAM.zoom;CAM.y+=(sy-panLast[1])/CAM.zoom;panLast=[sx,sy];return;}
  if(!dragWire&&!dragProbe)return;e.preventDefault();const[x,y]=getPos(e);
  if(dragProbe){SIM.probeX=x;SIM.probeY=y;}
  else{dragWire.x=x+dragOff[0];} // horizontal only
}
window.addEventListener('mouseup',onUp);
function onUp(){dragWire=null;dragProbe=false;isPanning=false;}

/* ═══ RESIZE ═══ */
function resize(){
  const w=document.getElementById('canvas-wrap');
  CW=w.clientWidth;CH=w.clientHeight;
  if(CW<10)CW=300;if(CH<10)CH=300;
  const dpr=Math.min(devicePixelRatio,2);
  canvas.width=CW*dpr;canvas.height=CH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
if(window.ResizeObserver)new ResizeObserver(()=>{resize();spawnTracers();}).observe(document.getElementById('canvas-wrap'));
else window.addEventListener('resize',()=>{resize();spawnTracers();});

/* ═══ LOOP ═══ */
let lastTime=0,fpsC=0,fpsT=0;
function loop(time){
  requestAnimationFrame(loop);
  const dt=Math.min((time-lastTime)/1000,0.05);lastTime=time;
  fpsC++;fpsT+=dt;if(fpsT>=0.5){document.getElementById('st-fps').textContent=Math.round(fpsC/fpsT)+' fps';fpsC=0;fpsT=0;}

  // Step-through animation
  if(SIM.stepping&&wires.length>0){
    SIM.stepTimer+=dt;
    if(SIM.stepTimer>0.8){SIM.stepTimer=0;SIM.stepIdx++;if(SIM.stepIdx>wires.length)SIM.stepIdx=0;}
  }

  updateTracers(dt);
  render();
}

/* ═══ INIT ═══ */
document.querySelectorAll('#panel input[type=range]').forEach(sg);
setTimeout(()=>{
  resize();spawnTracers();rebuildWireList();
  SIM.probeX=CW/2+100;SIM.probeY=CH/2;
  preset('anti'); // start with anti-parallel — most educational
  requestAnimationFrame(loop);
},50);
