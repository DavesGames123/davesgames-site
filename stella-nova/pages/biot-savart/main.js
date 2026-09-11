// ============================================================================
//  BIOT-SAVART LAW  ·  interactive cross-section of straight-wire magnetic fields
// ----------------------------------------------------------------------------
//  A 2D canvas looks down the barrel of a set of infinite straight wires that
//  run perpendicular to the screen. Each wire carries a current out of the page
//  (⊙, positive) or into it (⊗, negative). In that plane the field of one wire
//  is circular: B = μ₀I/(2πr), pointing along φ̂ (tangent to the circle around
//  the wire). The total field at any point is the vector sum over all wires
//  (superposition). Nothing is integrated over time for the physics; the field
//  is a closed-form function of position, recomputed wherever it is sampled.
//
//  WORLD FRAME  (canvas pixels are world units; camera pans/zooms on top)
//  ---------------------------------------------------------------------------
//      current OUT of page (⊙, I>0)  ─▶  field circulates counter-clockwise
//
//                  ▲ +y (down in screen space)
//                  │        φ̂  (B direction)
//                  │      ╭────▶───╮
//                  │     │    ●     │     ● = wire (into/out of screen)
//                  │     │  ⊙ wire  │     r = distance wire ─▶ sample point
//                  │      ╲────◀───╯      B = μ₀I/(2πr) along φ̂ = (-dy,dx)/r
//     ─────────────┼─────────────────▶ +x
//
//  SAMPLING / RENDER PIPELINE  (drawn every frame in render())
//  ---------------------------------------------------------------------------
//      wires[] ─┬─ renderHeatmap()  per-cell |B|, log-mapped to a color ramp
//               ├─ renderArrows()   field direction on a fixed grid
//               ├─ renderTracers()  particles advected along B (streamlines)
//               ├─ renderWires()    the ⊙/⊗ glyphs and current rings
//               └─ renderProbe()    per-wire dB vectors + total B + compass
//                        │
//                        ▼   totalField(x,y) = Σ wireField(...) over wires[]
//                     <canvas>
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  ---------------------------------------------------------------------------
//      state ................ "const SIM="          the one mutable sim state
//      camera ............... "CAM ="               pan/zoom, screenToWorld
//      physics .............. "wireField"           single-wire B, superposition
//      color ramp ........... "fieldColorRGB"       |B| to RGB for field draws
//      tracers .............. "spawnTracers"        streamline particle pool
//      render ............... "function render"     per-frame draw orchestration
//      probe ................ "function renderProbe" vector decomposition + compass
//      wire list UI ......... "rebuildWireList"     the side-panel wire cards
//      add/remove ........... "function addWire"    place, delete, edit wires
//      presets .............. "function preset"     parallel/anti/triangle/quad
//      pointer .............. "function onDown"     drag wires/probe, pan
//      pinch/wheel zoom ..... "wheel"               zoom keeping cursor fixed
//      resize ............... "function resize"     canvas sizing, DPR clamp
//      loop ................. "function loop"       rAF: step, advect, render
//      init ................. "INIT"                first layout, anti preset
// ============================================================================
/* ════════════════════════════════════════════════════════════
   BIOT-SAVART LAW — INTERACTIVE EDUCATIONAL SIMULATOR
   Cross-section view: infinite wires ⊥ to screen.
   B field in-plane: B = μ₀I/(2πr) in φ̂ direction.
   ════════════════════════════════════════════════════════════ */
const canvas=document.getElementById('sim-canvas');
const ctx=canvas.getContext('2d');
// CW/CH are the canvas size in world (CSS) pixels; set for real by resize().
let CW=100,CH=100;

// The single mutable state object. Every toggle and slider writes one field
// here; render() and the loop read it. probeX/probeY track the draggable probe;
// stepping/stepIdx/stepTimer drive the "accumulate one wire at a time" mode.
const SIM={
  showTracers:true,showArrows:true,showHeatmap:false,
  tracerCount:2000,tracerSpeed:1.5,tracerTrail:35,
  showProbe:true,probeX:0,probeY:0,
  stepping:false,stepIdx:0,stepTimer:0,
  selectedId:-1,
};
// wires: the sources. tracers: the streamline particle pool. nextId: a
// monotonic counter so every wire has a stable id across list rebuilds.
let wires=[],tracers=[],nextId=0;

/* ═══ CAMERA ═══ */
// Pan/zoom about the canvas center. zoom scales, (x,y) offsets in world units.
const CAM={x:0,y:0,zoom:1};
// Invert the camera transform: screen pixel to world coordinate. The exact
// inverse of the translate/scale/translate applied in render().
function screenToWorld(sx,sy){return[(sx-CW/2)/CAM.zoom+CW/2-CAM.x,(sy-CH/2)/CAM.zoom+CH/2-CAM.y];}

// One stable color per wire, indexed by position. The probe draws each wire's
// dB in its own color so the superposition can be read apart visually.
const WIRE_COLORS=['#60e0ee','#64c864','#ff9050','#c890ff','#ffc832','#ff6b6b','#b896ff','#64dcc8','#f5c842','#ff8830'];

/* ═══ PHYSICS: INFINITE WIRE FIELD ═══ */
// B = μ₀I/(2πr) perpendicular to r, right-hand rule
// In 2D: wire at (wx,wy) with current I (positive=out of screen)
// At point (px,py): B direction is (-dy,dx)/r (rotated 90° CCW for I>0)
function wireField(px,py,wx,wy,current){
  // Displacement from wire to sample point, and its squared length.
  const dx=px-wx,dy=py-wy;
  const r2=dx*dx+dy*dy;
  if(r2<25) return[0,0]; // avoid singularity within 5px
  const r=Math.sqrt(r2);
  // Magnitude B = μ₀I/(2πr); 6.2832 is 2π, and μ₀/2π is folded into the
  // display scale so the numbers read cleanly rather than in SI units.
  // B = μ₀I/(2πr), direction = (-dy,dx)/r for I>0 (CCW circulation)
  const B=current/(r*6.2832); // μ₀/4π absorbed into display scaling
  // Rotate the unit radial (dx,dy)/r by 90° CCW to get φ̂, then scale by B.
  return[-dy/r*B, dx/r*B];
}

// Superposition: the total field is the plain vector sum of every wire's field.
function totalField(px,py){
  let Bx=0,By=0;
  for(const w of wires){
    const[bx,by]=wireField(px,py,w.x,w.y,w.current);
    Bx+=bx;By+=by;
  }
  return[Bx,By];
}

/* ═══ FIELD COLOR (matches MagnetLab/orbital viewer) ═══ */
// Map a field magnitude to an RGB triple on a 6-stop ramp. |B| spans many
// decades near a wire, so it is compressed with log10 before lookup.
function fieldColorRGB(mag,gamma){
  gamma=gamma||1;
  // Log-compress and normalize into roughly [0,1]; 12 and 2.2 shape the curve.
  const lv=Math.log10(1+mag*12)/2.2;
  // Optional gamma to bias the ramp toward low or high magnitudes.
  const lc=Math.pow(Math.max(0,Math.min(1,lv)),1/Math.max(0.1,gamma));
  // Six color stops: deep violet ▶ blue ▶ cyan ▶ green ▶ orange ▶ white.
  const S=[[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]];
  // Pick the segment (si) and interpolation fraction (sf), then lerp per channel.
  const sv=lc*5,si=Math.min(Math.floor(sv),4),sf=sv-si;
  return[S[si][0]+sf*(S[si+1][0]-S[si][0]),S[si][1]+sf*(S[si+1][1]-S[si][1]),S[si][2]+sf*(S[si+1][2]-S[si][2])];
}

/* ═══ TRACERS ═══ */
// Fill the pool with particles at random positions. Each carries a trail buffer
// and a random lifetime so respawns are staggered rather than synchronized.
function spawnTracers(){
  tracers=[];
  for(let i=0;i<SIM.tracerCount;i++){
    tracers.push({x:Math.random()*CW,y:Math.random()*CH,trail:[],age:0,maxAge:2.5+Math.random()*4});
  }
}
// Advect every tracer one step along the local field direction (a streamline
// integrator). Because it follows B̂ at fixed speed, tracers trace field lines
// regardless of |B|; the trail records |B| per point for coloring.
function updateTracers(dt){
  // 80 px/s at speed 1.0; the slider scales this pixel rate.
  const speed=SIM.tracerSpeed*80;
  for(const tr of tracers){
    tr.age+=dt;
    // Move along the unit field vector (forward Euler on the normalized field).
    const[Bx,By]=totalField(tr.x,tr.y);
    const Bmag=Math.sqrt(Bx*Bx+By*By);
    if(Bmag>1e-6){tr.x+=(Bx/Bmag)*speed*dt;tr.y+=(By/Bmag)*speed*dt;}
    // Push the new head onto the trail; drop the oldest past the trail length.
    tr.trail.unshift([tr.x,tr.y,Bmag]);
    if(tr.trail.length>SIM.tracerTrail) tr.trail.pop();
    // Check if inside any wire
    let inWire=false;
    for(const w of wires){const dx=tr.x-w.x,dy=tr.y-w.y;if(dx*dx+dy*dy<144){inWire=true;break;}}
    // Retire when aged out, off-screen, or swallowed by a wire (r<12px), then
    // respawn to keep the pool full.
    if(tr.age>tr.maxAge||tr.x<-20||tr.x>CW+20||tr.y<-20||tr.y>CH+20||inWire){
      // Bias 60% of respawns to a ring around a random wire so field lines stay
      // populated near the sources where the structure is most interesting.
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
// Draw one frame. Order matters: clear, apply camera, then paint layers back to
// front so wires and the probe sit on top of the field visualization.
function render(){
  // Clear in device space (identity transform), then paint the background in
  // world space, before the camera transform is applied.
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.restore();
  ctx.fillStyle='#0e1118';ctx.fillRect(0,0,CW,CH);

  // Apply the pan/zoom: translate to center, scale, translate back plus offset.
  // Camera transform
  ctx.save();
  ctx.translate(CW/2,CH/2);
  ctx.scale(CAM.zoom,CAM.zoom);
  ctx.translate(-CW/2+CAM.x,-CH/2+CAM.y);

  // Reference grid, snapped to a 50px world lattice across the visible extent.
  // Grid
  const gx0=Math.floor(((0-CW/2)/CAM.zoom+CW/2-CAM.x)/50)*50;
  const gy0=Math.floor(((0-CH/2)/CAM.zoom+CH/2-CAM.y)/50)*50;
  const[vx1,vy1]=screenToWorld(CW,CH);
  ctx.strokeStyle='rgba(150,200,255,0.03)';ctx.lineWidth=1/CAM.zoom;
  for(let x=gx0;x<vx1;x+=50){ctx.beginPath();ctx.moveTo(x,gy0);ctx.lineTo(x,vy1);ctx.stroke();}
  for(let y=gy0;y<vy1;y+=50){ctx.beginPath();ctx.moveTo(gx0,y);ctx.lineTo(vx1,y);ctx.stroke();}

  // Field layers first (heatmap, arrows, tracers), then the wire glyphs, then
  // the probe on top. Each layer is gated by its toggle in SIM.
  if(SIM.showHeatmap) renderHeatmap();
  if(SIM.showArrows) renderArrows();
  if(SIM.showTracers) renderTracers();
  renderWires();
  if(SIM.showProbe&&wires.length>0) renderProbe();
  ctx.restore(); // camera transform
}

// Field-magnitude heatmap: color a coarse cell grid by |B| at each cell center.
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

// Field-direction arrows on a fixed 30px grid. 'lighter' compositing makes
// overlapping strokes add up as light. Length and alpha scale with log |B|.
function renderArrows(){
  ctx.save();ctx.globalCompositeOperation='lighter';
  const step=30,maxLen=13;
  for(let x=step/2;x<CW;x+=step)for(let y=step/2;y<CH;y+=step){
    const[Bx,By]=totalField(x,y);
    const Bmag=Math.sqrt(Bx*Bx+By*By);
    if(Bmag<1e-5)continue;
    const[r,g,b]=fieldColorRGB(Bmag);
    // Same log map as the color ramp, reused to set arrow length and opacity.
    const lv=Math.min(1,Math.log10(1+Bmag*12)/2.2);
    const len=Math.max(2,lv*maxLen);
    const nx=Bx/Bmag,ny=By/Bmag,alpha=Math.max(0.05,Math.min(0.45,lv*0.5));
    ctx.strokeStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;
    ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    // Draw a small filled arrowhead only when the shaft is long enough to read.
    if(len>3){
      const ax=x+nx*len,ay=y+ny*len,px=-ny*2,py=nx*2;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*3+px,ay-ny*3+py);ctx.lineTo(ax-nx*3-px,ay-ny*3-py);ctx.closePath();
      ctx.fillStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;ctx.fill();
    }
  }
  ctx.restore();
}

// Draw the streamline trails. Each segment fades toward the tail and toward the
// start/end of the particle's life; a wide dim stroke plus a thin bright core
// gives a glow. 'lighter' compositing sums overlapping trails.
function renderTracers(){
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
  for(const tr of tracers){
    const tl=tr.trail.length;if(tl<2)continue;
    // Life-fade envelope: fade in over the first 0.1s, fade out over the last 20%.
    const ageA=tr.age<0.1?tr.age/0.1:tr.age>tr.maxAge*0.8?(tr.maxAge-tr.age)/(tr.maxAge*0.2):1;
    for(let s=0;s<tl-1;s++){
      const pt=tr.trail[s],pn=tr.trail[s+1];
      // Per-segment alpha: older trail points (higher s) are dimmer.
      const a0=(1-s/SIM.tracerTrail)*ageA;
      if(a0<0.01)continue;
      // Color the segment by the |B| that was recorded at that trail point.
      const[r,g,b]=fieldColorRGB(pt[2]||0);
      ctx.strokeStyle=`rgba(${(r*a0*0.12*255)|0},${(g*a0*0.12*255)|0},${(b*a0*0.12*255)|0},1)`;
      ctx.lineWidth=Math.max(1,5*a0);ctx.beginPath();ctx.moveTo(pt[0],pt[1]);ctx.lineTo(pn[0],pn[1]);ctx.stroke();
      ctx.strokeStyle=`rgba(${(r*a0*0.55*255)|0},${(g*a0*0.55*255)|0},${(b*a0*0.55*255)|0},1)`;
      ctx.lineWidth=Math.max(0.5,1.8*a0);ctx.beginPath();ctx.moveTo(pt[0],pt[1]);ctx.lineTo(pn[0],pn[1]);ctx.stroke();
    }
  }
  ctx.restore();
}

// Draw each wire: a body disk, its current glyph (⊙ out / ⊗ into the page), a
// dashed ring whose radius grows with |I|, and a current label.
function renderWires(){
  for(const w of wires){
    const sel=w.id===SIM.selectedId;
    // Positive current points out of the screen (⊙); negative into it (⊗).
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

// The probe: decompose the field at one draggable point into per-wire dB
// vectors, sum them into a total B, and show a compass that aligns with B. In
// step-through mode only the first stepIdx wires are summed, so the total grows
// one contribution at a time.
function renderProbe(){
  const px=SIM.probeX,py=SIM.probeY;
  // How many wires currently count toward the total (all, unless stepping).
  const maxWires=SIM.stepping?SIM.stepIdx:wires.length;

  // Draw individual contribution vectors
  let totalBx=0,totalBy=0;
  for(let i=0;i<wires.length;i++){
    const w=wires[i];
    // Each wire's field at the probe; only active wires add to the running sum.
    const[bx,by]=wireField(px,py,w.x,w.y,w.current);
    const active=i<maxWires;
    if(active){totalBx+=bx;totalBy+=by;}

    // Scale the tiny field vector up to a visible pixel length (800x).
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

  // The resultant: sum of the active contributions, drawn thick and white.
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

  // A compass whose red (N) half points along B, the physical behavior of a
  // magnetic needle placed at the probe. angle is the field direction.
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
// Paint a range input's filled track: set the --pct custom property the CSS reads.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}

// Rebuild the side-panel wire cards from wires[]. Each card shows the current
// glyph, name, a delete button, and a current slider bound back to the wire.
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

// Add a wire with current direction dir (+1 out, -1 into). It searches outward
// from center for a horizontal slot at least 50px from existing wires so new
// wires do not land on top of one another.
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
// Delete a wire by id, then rebuild the list and reseed tracers.
function removeWire(id){wires=wires.filter(w=>w.id!==id);rebuildWireList();spawnTracers();}
// Set one property of a wire (used by the card's current slider) and refresh its
// filled track and numeric readout without a full list rebuild.
function setWireProp(id,prop,val,el){
  const w=wires.find(w=>w.id===id);if(!w)return;w[prop]=val;if(el)sg(el);
  const row=el.closest('.mag-row');if(row)row.querySelector('.val').textContent=val.toFixed(1);
}
// Remove every wire and clear the selection.
function clearAll(){wires=[];SIM.selectedId=-1;rebuildWireList();spawnTracers();}

// Toggle probe visibility and reflect the state on its button.
function toggleProbe(){SIM.showProbe=!SIM.showProbe;const b=document.getElementById('tog-probe');b.classList.toggle('on',SIM.showProbe);b.classList.toggle('off',!SIM.showProbe);}
// Toggle step-through accumulation mode, resetting the accumulation counter.
function toggleStep(){
  SIM.stepping=!SIM.stepping;SIM.stepIdx=0;SIM.stepTimer=0;
  const b=document.getElementById('tog-step');b.classList.toggle('on',SIM.stepping);b.classList.toggle('off',!SIM.stepping);
  document.getElementById('step-info').style.display=SIM.stepping?'block':'none';
}
// Generic boolean toggle for a display option keyed by name, syncing its button.
function toggleOpt(key,btnId){SIM[key]=!SIM[key];const b=document.getElementById(btnId);b.classList.toggle('on',SIM[key]);b.classList.toggle('off',!SIM[key]);}

// Load a named wire arrangement. sp is the base spacing between wires; the anti,
// triangle, and quad layouts alternate current sign to show interference.
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
// Interaction state: which wire is being dragged, whether the probe is grabbed,
// and pan bookkeeping. dragOff keeps the grab offset so the wire does not jump.
let dragWire=null,dragProbe=false,dragOff=[0,0],isPanning=false,panLast=[0,0];
// Pointer position in screen (canvas) pixels, handling both mouse and touch.
function getScreenPos(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return[t.clientX-r.left,t.clientY-r.top];}
// Pointer position in world coordinates.
function getPos(e){const[sx,sy]=getScreenPos(e);return screenToWorld(sx,sy);}

// Wheel zoom: zoom toward the cursor by keeping its world point fixed. Take the
// world point before and after the zoom change, then shift the camera by the
// difference so the pixel under the cursor stays put.
// Wheel zoom
canvas.addEventListener('wheel',e=>{
  e.preventDefault();const[sx,sy]=getScreenPos(e);const[wx,wy]=screenToWorld(sx,sy);
  CAM.zoom=Math.max(0.2,Math.min(6,CAM.zoom*(e.deltaY<0?1.08:1/1.08)));
  const[wx2,wy2]=screenToWorld(sx,sy);CAM.x+=wx2-wx;CAM.y+=wy2-wy;
},{passive:false});

// Two-finger pinch: record the initial finger distance and midpoint on start,
// then scale zoom by the distance ratio and pan by the midpoint drift.
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
// Press: hit-test the probe first, then wires (topmost first), else start a pan.
// The 400/zoom hit radius keeps a constant screen-space grab area at any zoom.
function onDown(e){
  e.preventDefault();const[x,y]=getPos(e);
  if(SIM.showProbe){const dx=x-SIM.probeX,dy=y-SIM.probeY;if(dx*dx+dy*dy<400/CAM.zoom){dragProbe=true;return;}}
  for(let i=wires.length-1;i>=0;i--){const w=wires[i];const dx=x-w.x,dy=y-w.y;if(dx*dx+dy*dy<400/CAM.zoom){dragWire=w;dragOff=[w.x-x,0];SIM.selectedId=w.id;rebuildWireList();return;}}
  isPanning=true;const[sx,sy]=getScreenPos(e);panLast=[sx,sy];
}
window.addEventListener('mousemove',onMove);
// Move: pan the camera, or drag the probe, or slide the grabbed wire. Wires move
// horizontally only (dragOff carries the x grab offset, y is pinned).
function onMove(e){
  if(isPanning&&!dragWire&&!dragProbe){
    const[sx,sy]=getScreenPos(e);CAM.x+=(sx-panLast[0])/CAM.zoom;CAM.y+=(sy-panLast[1])/CAM.zoom;panLast=[sx,sy];return;}
  if(!dragWire&&!dragProbe)return;e.preventDefault();const[x,y]=getPos(e);
  if(dragProbe){SIM.probeX=x;SIM.probeY=y;}
  else{dragWire.x=x+dragOff[0];} // horizontal only
}
window.addEventListener('mouseup',onUp);
// Release: clear all drag/pan flags.
function onUp(){dragWire=null;dragProbe=false;isPanning=false;}

/* ═══ RESIZE ═══ */
// Match the canvas backing store to its container. DPR is clamped to 2 so the
// pixel count stays bounded on high-density displays.
function resize(){
  const w=document.getElementById('canvas-wrap');
  CW=w.clientWidth;CH=w.clientHeight;
  if(CW<10)CW=300;if(CH<10)CH=300;
  const dpr=Math.min(devicePixelRatio,2);
  canvas.width=CW*dpr;canvas.height=CH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
// Track container size with a ResizeObserver where available, else window resize.
// Reseed tracers on resize because the world extent changed.
if(window.ResizeObserver)new ResizeObserver(()=>{resize();spawnTracers();}).observe(document.getElementById('canvas-wrap'));
else window.addEventListener('resize',()=>{resize();spawnTracers();});

/* ═══ LOOP ═══ */
// FPS bookkeeping alongside the frame timer.
let lastTime=0,fpsC=0,fpsT=0;
// The per-frame loop: advance step-through, advect tracers, then render.
function loop(time){
  requestAnimationFrame(loop);
  // Real elapsed seconds, clamped to 50ms so a tab switch does not jump tracers.
  const dt=Math.min((time-lastTime)/1000,0.05);lastTime=time;
  fpsC++;fpsT+=dt;if(fpsT>=0.5){document.getElementById('st-fps').textContent=Math.round(fpsC/fpsT)+' fps';fpsC=0;fpsT=0;}

  // Advance the accumulation index every 0.8s, wrapping past the last wire back
  // to zero so the "one wire at a time" build-up replays.
  // Step-through animation
  if(SIM.stepping&&wires.length>0){
    SIM.stepTimer+=dt;
    if(SIM.stepTimer>0.8){SIM.stepTimer=0;SIM.stepIdx++;if(SIM.stepIdx>wires.length)SIM.stepIdx=0;}
  }

  updateTracers(dt);
  render();
}

/* ═══ INIT ═══ */
// Paint every panel slider's filled track once at load.
document.querySelectorAll('#panel input[type=range]').forEach(sg);
// Defer first layout so the container has its final size, then seed the probe,
// load the anti-parallel preset, and start the render loop.
setTimeout(()=>{
  resize();spawnTracers();rebuildWireList();
  SIM.probeX=CW/2+100;SIM.probeY=CH/2;
  preset('anti'); // start with anti-parallel — most educational
  requestAnimationFrame(loop);
},50);
