/* ═════════════════════════════════════════════════════════════
   DRAWING
   ═════════════════════════════════════════════════════════════ */
// Cached starfield. Positions come from a cheap deterministic hash of the index
// (primes 7919/6271 spread them), so stars stay put between frames and only
// regenerate when the view size changes.
let _sc=null;
function getStars(){
  if(_sc&&_sc.W===W&&_sc.H===H) return _sc.d;
  const d=[];
  for(let i=0;i<300;i++) d.push({
    x:((i*7919+13337)%W), y:((i*6271+31337)%H),
    r:0.2+(i%6)*0.18, a:0.04+(i%5)*0.09
  });
  _sc={W,H,d}; return d;
}

/* ═════════════════════════════════════════════════════════════
   LABEL PLACEMENT
   ═════════════════════════════════════════════════════════════ */
// Each frame, every canvas label asks placeLabel for a free spot. LBOX holds
// the boxes (screen px) already taken: the Sun, the planet discs, then the
// labels in priority order (planet names, window tags, ellipse geometry, the
// burn readout). A label tries its candidate centres in order and takes the
// first one that overlaps no box and stays inside the clear canvas part. A
// label with no free candidate is not drawn, unless it is forced.
let LBOX=[];
function lblReset(){ LBOX=[]; }
function lblBlock(x0,y0,x1,y1){ LBOX.push([x0,y0,x1,y1]); }
function lblFree(x0,y0,x1,y1){
  if(x0<4||y0<4||x1>W-4||y1>CLEAR_B-2) return false;
  for(const b of LBOX) if(x0<b[2]&&x1>b[0]&&y0<b[3]&&y1>b[1]) return false;
  return true;
}
// Measure text in the current ctx.font and return the chosen centre, or null.
// cands: [[cx,cy],..] centres. pad: extra space around the box.
function placeLabel(text,cands,force,pad){
  pad=pad==null?3:pad;
  const w=ctx.measureText(text).width+pad*2, h=parseFloat(ctx.font.match(/([\d.]+)px/)[1])*1.25+pad;
  for(const [cx,cy] of cands){
    const x0=cx-w/2,y0=cy-h/2;
    if(lblFree(x0,y0,x0+w,y0+h)){ lblBlock(x0,y0,x0+w,y0+h); return [cx,cy]; }
  }
  if(!force) return null;
  const [cx,cy]=cands[0]; lblBlock(cx-w/2,cy-h/2,cx+w/2,cy+h/2); return [cx,cy];
}
// Draw centred text with a dark offset copy behind it for contrast.
function shadowText(text,x,y,col){
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='rgba(0,0,0,0.75)'; ctx.fillText(text,x+1,y+1);
  ctx.fillStyle=col; ctx.fillText(text,x,y);
}
// Lay out the planet names before any other label, so they win. The Sun and
// every planet disc are blocked first. Source and target choose first. Each
// name tries right, left, above and below its disc. It stores its centre in
// p._lbl (null = no room, the name is not drawn this frame).
function layoutPlanetLabels(){
  const sr=13*UIS; lblBlock(CX-sr,CY-sr,CX+sr,CY+sr);
  const pos=new Map();
  planets.forEach(p=>{ const q=pPos(p); pos.set(p,q); const r=p.size*UIS+3; lblBlock(q.x-r,q.y-r,q.x+r,q.y+r); });
  const order=[...planets].sort((a,b)=>((b===source||b===target)?1:0)-((a===source||a===target)?1:0));
  ctx.font=`500 ${11*UIS}px ${F_SANS}`;
  order.forEach(p=>{
    const q=pos.get(p), w=ctx.measureText(p.name).width, g=p.size*UIS+7*UIS, hh=9*UIS;
    const G=g*2.6;
    p._lbl=placeLabel(p.name,[[q.x+g+w/2,q.y],[q.x-g-w/2,q.y],[q.x,q.y-g-hh*0.4],[q.x,q.y+g+hh*0.4],
      [q.x+G*0.7+w/2,q.y-G*0.7],[q.x-G*0.7-w/2,q.y-G*0.7],[q.x+G*0.7+w/2,q.y+G*0.7],[q.x-G*0.7-w/2,q.y+G*0.7],
      [q.x,q.y-G-hh*0.4],[q.x,q.y+G+hh*0.4]],p===source||p===target,2);
  });
}

// Paint the deep-space backdrop: fill, stars, a slow radar sweep line, and the
// glowing Sun at the view centre.
function drawBg(){
  ctx.fillStyle='#060810'; ctx.fillRect(0,0,W,H);
  getStars().forEach(s=>{
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,TAU);
    ctx.fillStyle=`rgba(200,210,240,${s.a})`; ctx.fill();
  });
  // radar sweep
  // Sweep angle advances slowly with sim time; drawn as a faint spoke.
  const sa=(simTime*0.26)%TAU;
  const rm=planets.length?Math.max(...planets.map(p=>p.r))*SCALE*1.1:200;
  ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(CX+Math.cos(sa)*rm,CY-Math.sin(sa)*rm);
  ctx.strokeStyle='rgba(150,200,255,0.07)'; ctx.lineWidth=1; ctx.stroke();
  // sun
  const sg=ctx.createRadialGradient(CX,CY,0,CX,CY,50);
  sg.addColorStop(0,'rgba(255,248,190,1)'); sg.addColorStop(0.18,'rgba(255,218,90,0.82)');
  sg.addColorStop(0.55,'rgba(255,155,45,0.14)'); sg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(CX,CY,50,0,TAU); ctx.fillStyle=sg; ctx.fill();
  ctx.beginPath(); ctx.arc(CX,CY,11,0,TAU); ctx.fillStyle='#fff9dc'; ctx.fill();
}

// Screen position of a planet at time t. Angle is analytic (angle0 + omega·t);
// y is flipped because canvas y grows downward. Defaults to the current simTime.
function pPos(p,t){
  t=t!==undefined?t:simTime;
  const ang=p.angle+p.omega*t;
  return{x:CX+Math.cos(ang)*p.r*SCALE, y:CY-Math.sin(ang)*p.r*SCALE, ang};
}

// Draw a planet's circular orbit. Selected orbits (source/target) are solid and
// coloured; the rest are faint dashed rings.
function drawOrbit(p){
  ctx.beginPath(); ctx.arc(CX,CY,p.r*SCALE,0,TAU);
  const sel=p===source||p===target;
  ctx.setLineDash(sel?[]:[1.5,7]);
  ctx.strokeStyle=p===source?'rgba(150,200,255,0.45)':p===target?'rgba(122,216,122,0.45)':'rgba(150,200,255,0.06)';
  ctx.lineWidth=sel?1.4:0.7;
  ctx.stroke(); ctx.setLineDash([]);
}

// Draw a planet disc with a shaded radial gradient. Source, target, and hovered
// planets also get a coloured glow halo and outline ring.
function drawPlanet(p,pos,alpha){
  alpha=alpha!==undefined?alpha:1;
  const isSrc=p===source,isTgt=p===target,isHov=p===hovered;
  const r=p.size*UIS;
  ctx.globalAlpha=alpha;
  if(alpha===1&&(isSrc||isTgt||isHov)){
    const gc=isSrc?'150,200,255':isTgt?'122,216,122':'200,220,255';
    const g=ctx.createRadialGradient(pos.x,pos.y,0,pos.x,pos.y,r*5);
    g.addColorStop(0,`rgba(${gc},0.32)`); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(pos.x,pos.y,r*5,0,TAU); ctx.fillStyle=g; ctx.fill();
    ctx.beginPath(); ctx.arc(pos.x,pos.y,r+4*UIS,0,TAU);
    ctx.strokeStyle=isSrc?'rgba(150,200,255,0.78)':isTgt?'rgba(122,216,122,0.78)':'rgba(255,255,255,0.25)';
    ctx.lineWidth=1.1; ctx.stroke();
  }
  const pg=ctx.createRadialGradient(pos.x-r*0.3,pos.y-r*0.3,0,pos.x,pos.y,r);
  pg.addColorStop(0,`hsl(${p.hue},75%,80%)`); pg.addColorStop(1,`hsl(${p.hue},55%,35%)`);
  ctx.beginPath(); ctx.arc(pos.x,pos.y,r,0,TAU); ctx.fillStyle=pg; ctx.fill();
  ctx.globalAlpha=1;
}

// Draw a planet's name beside it, with a dark drop shadow for legibility.
function drawLabel(p,pos){
  if(!p._lbl) return;
  const col=p===source?'#96c8ff':p===target?'#7ad87a':`hsl(${p.hue},50%,72%)`;
  ctx.font=`500 ${11*UIS}px ${F_SANS}`;
  shadowText(p.name,p._lbl[0],p._lbl[1],col);
}

// Map eccentric anomaly E to a screen point on the transfer ellipse. In the
// ellipse's own frame the point is (a·cosE - c, b·sinE), with the Sun at the
// origin (a focus). Rotate by periAng (periapsis direction) and apply the
// world→screen transform with the y flip.
function eToXY(a_t,b_t,c_t,periAng,E){
  const xo=a_t*Math.cos(E)-c_t, yo=b_t*Math.sin(E);
  const cp=Math.cos(periAng), sp=Math.sin(periAng);
  return[CX+(xo*cp-yo*sp)*SCALE, CY-(xo*sp+yo*cp)*SCALE];
}
// Draw the transfer ellipse as a dashed outline. If drawArc, also stroke the
// half-ellipse the ship actually travels (periapsis to apoapsis) in solid gold.
function drawXferEllipse(tr,periAng,alpha,drawArc){
  const{a_t,b_t,c_t}=tr;
  ctx.globalAlpha=alpha;
  // Trace the whole ellipse in 180 segments across a full sweep of E.
  ctx.beginPath();
  for(let i=0;i<=180;i++){const[x,y]=eToXY(a_t,b_t,c_t,periAng,i*TAU/180);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}
  ctx.closePath(); ctx.setLineDash([4,5]);
  ctx.strokeStyle='rgba(255,200,50,0.42)'; ctx.lineWidth=0.9; ctx.stroke(); ctx.setLineDash([]);
  if(drawArc){
    ctx.globalAlpha=Math.min(alpha*3.2,1);
    // Ascending transfers start at periapsis (E=0); descending at apoapsis (E=pi).
    const E0=tr.asc?0:Math.PI;
    // Stroke only the half-orbit (E0 to E0+pi) the ship coasts along.
    ctx.beginPath();
    for(let i=0;i<=100;i++){const[x,y]=eToXY(a_t,b_t,c_t,periAng,E0+i*Math.PI/100);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)}
    ctx.strokeStyle='#ffc832'; ctx.lineWidth=2.2*UIS; ctx.stroke();
  }
  ctx.globalAlpha=1;
}

/* Faint geometric construction of the transfer ellipse: major + minor axes,
   center, empty focus, and color-coded labels for a, b, c, r1, r2 */
function drawEllipseGeometry(tr,periAng){
  const{a_t,b_t,c_t,rPer,rApo,asc,r1,r2}=tr;
  const sp=Math.sin(periAng), cp=Math.cos(periAng);
  // ts: transform an ellipse-local point (Sun at origin) to screen coordinates.
  function ts(xo,yo){
    return [CX+(xo*cp-yo*sp)*SCALE, CY-(xo*sp+yo*cp)*SCALE];
  }
  // local +y direction projected to screen (unit vector)
  function perpY(p,n){ return [p[0]+(-sp)*n, p[1]+(-cp)*n]; }
  // local +x direction projected to screen (unit vector)
  function perpX(p,n){ return [p[0]+cp*n, p[1]+(-sp)*n]; }

  // Key construction points: Sun (occupied focus), periapsis, apoapsis, the
  // geometric centre, the empty focus (at 2c from the Sun), and the minor-axis
  // ends. Periapsis is at local +x, apoapsis at local -x.
  const sun=[CX,CY];
  const peri=ts(rPer,0);
  const apo=ts(-rApo,0);
  const center=ts(-c_t,0);
  const focus2=ts(-2*c_t,0);
  const minorTop=ts(-c_t,b_t);
  const minorBot=ts(-c_t,-b_t);

  ctx.save();

  // Major axis (dashed, faint orange)
  ctx.beginPath();
  ctx.moveTo(peri[0],peri[1]); ctx.lineTo(apo[0],apo[1]);
  ctx.setLineDash([3,5]);
  ctx.strokeStyle='rgba(255,144,80,0.18)'; ctx.lineWidth=0.9; ctx.stroke();

  // Minor axis (dashed, fainter orange)
  ctx.beginPath();
  ctx.moveTo(minorTop[0],minorTop[1]); ctx.lineTo(minorBot[0],minorBot[1]);
  ctx.strokeStyle='rgba(255,144,80,0.14)'; ctx.lineWidth=0.8; ctx.stroke();
  ctx.setLineDash([]);

  // Sun-to-other-focus tick (faint, indicates 2c)
  ctx.beginPath();
  ctx.moveTo(sun[0],sun[1]); ctx.lineTo(focus2[0],focus2[1]);
  ctx.setLineDash([1,3]);
  ctx.strokeStyle='rgba(180,190,220,0.15)'; ctx.lineWidth=0.7; ctx.stroke();
  ctx.setLineDash([]);

  // Center marker (orange dot)
  ctx.beginPath();
  ctx.arc(center[0],center[1],2.6*UIS,0,TAU);
  ctx.fillStyle='rgba(255,144,80,0.45)'; ctx.fill();

  // Empty focus marker (open circle + crosshair)
  ctx.beginPath();
  ctx.arc(focus2[0],focus2[1],3.2*UIS,0,TAU);
  ctx.strokeStyle='rgba(180,190,220,0.4)'; ctx.lineWidth=1; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(focus2[0]-2*UIS,focus2[1]); ctx.lineTo(focus2[0]+2*UIS,focus2[1]);
  ctx.moveTo(focus2[0],focus2[1]-2*UIS); ctx.lineTo(focus2[0],focus2[1]+2*UIS);
  ctx.stroke();

  // ── Labels ── each label tries its home spot on one side of its line,
  // then the other side, then further out, through placeLabel. A label with
  // no free spot is left out for this frame rather than drawn over another.
  ctx.font=`italic 500 ${13*UIS}px ${F_SERIF}`;
  const PX=16*UIS;
  function geo(text,mid,side,col){
    const c=[perpY(mid,side*PX),perpY(mid,-side*PX),perpY(mid,side*PX*2),perpY(mid,-side*PX*2),perpX(perpY(mid,side*PX),PX*2),perpX(perpY(mid,side*PX),-PX*2)];
    const at=placeLabel(text,c,false,2);
    if(at) shadowText(text,at[0],at[1],col);
  }
  // r1, r2: the radii to the two tangent points, labelled above the axis.
  // asc: the source meets the ellipse at periapsis (+x), the target at apoapsis.
  let r1X, r2X;
  if(asc){ r1X=rPer/2; r2X=-rApo/2; }
  else   { r1X=-rApo/2; r2X=rPer/2; }
  geo(`r\u2081 = ${r1.toFixed(3)}`, ts(r1X,0), 1, 'rgba(150,200,255,0.9)');
  geo(`r\u2082 = ${r2.toFixed(3)}`, ts(r2X,0), 1, 'rgba(150,200,255,0.9)');
  // a: centre to apoapsis half, below the axis. c: Sun to centre, below.
  geo(`a = ${a_t.toFixed(3)}`, ts(-c_t-a_t/2,0), -1, 'rgba(255,184,128,0.92)');
  geo(`c = ${c_t.toFixed(3)}`, ts(-c_t/2,0), -1, 'rgba(190,200,225,0.8)');
  // b: the upper half of the minor axis, beside the line.
  const bMid=ts(-c_t,b_t/2);
  const bc=[perpX(bMid,-PX*1.6),perpX(bMid,PX*1.6),perpX(bMid,-PX*3),perpX(bMid,PX*3)];
  const bAt=placeLabel(`b = ${b_t.toFixed(3)}`,bc,false,2);
  if(bAt) shadowText(`b = ${b_t.toFixed(3)}`,bAt[0],bAt[1],'rgba(255,184,128,0.92)');

  ctx.restore();
}

// Draw a small labelled circle at a burn point (Δv1 or Δv2).
function burnMark(x,y,col,lbl){
  const r=9*UIS;
  lblBlock(x-r,y-r,x+r,y+r);
  ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.fillStyle='rgba(8,9,15,0.85)'; ctx.fill();
  ctx.beginPath(); ctx.arc(x,y,r,0,TAU); ctx.strokeStyle=col; ctx.lineWidth=1.2; ctx.stroke();
  ctx.fillStyle=col;
  ctx.font=`600 ${8*UIS}px ${F_SANS}`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(lbl,x,y+0.5);
}

// Draw ghost markers for the upcoming launch windows: for each, the source
// position at departure, the target position at arrival, the transfer ellipse
// preview, and a countdown label in days. The nearest window (i===0) is boldest.
function drawWindows(){
  if(!source||!target||!xfer||!launchWindows.length) return;
  // Fade later windows; the first is fully opaque.
  const alphas=[0.85,0.42,0.2];
  const wCols=['#ffc832','rgba(255,200,50,0.55)','rgba(255,200,50,0.28)'];

  launchWindows.forEach((w,i)=>{
    const al=alphas[i];
    const sr=source.size*UIS, tr2=target.size*UIS;
    const sx=CX+Math.cos(w.srcAng)*source.r*SCALE;
    const sy=CY-Math.sin(w.srcAng)*source.r*SCALE;
    const tx=CX+Math.cos(w.tgtAng)*target.r*SCALE;
    const ty=CY-Math.sin(w.tgtAng)*target.r*SCALE;

    // Periapsis points along the source radius for ascending transfers, the
    // opposite way for descending; preview the ellipse for this window.
    const periAng=xfer.asc?w.srcAng:w.srcAng+Math.PI;
    drawXferEllipse(xfer,periAng,al*0.32,i===0);

    // Green ghost of the target at its arrival position.
    ctx.globalAlpha=al*0.65;
    const tg=ctx.createRadialGradient(tx,ty,0,tx,ty,tr2*3.5);
    tg.addColorStop(0,'rgba(122,216,122,0.4)'); tg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(tx,ty,tr2*3.5,0,TAU); ctx.fillStyle=tg; ctx.fill();
    ctx.beginPath(); ctx.arc(tx,ty,tr2,0,TAU); ctx.fillStyle='rgba(122,216,122,0.4)'; ctx.fill();
    ctx.globalAlpha=1;

    // Gold halo of the source at its departure position.
    ctx.globalAlpha=al;
    const hg=ctx.createRadialGradient(sx,sy,0,sx,sy,sr*4.5);
    hg.addColorStop(0,'rgba(255,200,50,0.32)'); hg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(sx,sy,sr*4.5,0,TAU); ctx.fillStyle=hg; ctx.fill();
    ctx.beginPath(); ctx.arc(sx,sy,sr+5*UIS,0,TAU);
    ctx.strokeStyle=wCols[i]; ctx.lineWidth=i===0?1.6:0.85; ctx.stroke();
    ctx.globalAlpha=1;

    // Window tag ("W1 · 109 d") beside the source ghost: above, below,
    // left or right, wherever placeLabel finds room. W1 is always drawn.
    ctx.globalAlpha=al;
    const days=Math.round(w.dt*365.25);
    const tag=`${w.label} \u00b7 ${days} d`;
    ctx.font=`600 ${10*UIS}px ${F_SANS}`;
    const g=sr+12*UIS, tw=ctx.measureText(tag).width/2+4;
    const at=placeLabel(tag,[[sx,sy-g],[sx,sy+g],[sx+g+tw,sy],[sx-g-tw,sy]],i===0,2);
    if(at) shadowText(tag,at[0],at[1],i===0?'#ffc832':'rgba(255,200,50,0.75)');
    ctx.globalAlpha=1;

    // For the nearest window, draw a faint radius from the Sun to the departure point.
    if(i===0){
      ctx.beginPath(); ctx.moveTo(CX,CY); ctx.lineTo(sx,sy);
      ctx.setLineDash([2,6]); ctx.strokeStyle='rgba(255,200,50,0.12)'; ctx.lineWidth=0.8;
      ctx.stroke(); ctx.setLineDash([]);
    }
  });
}

// Draw the bottom prompt box that walks the user through the next action. The
// text depends on how far selection has progressed and whether hop mode is on.
function drawGuidance(){
  const el=document.getElementById('guide');
  if(!el) return;
  // Hide while a transfer is flying, or once everything is selected in normal mode.
  let off=(ship&&!ship.arrived)||(!hopMode&&source&&target&&ship);

  // Choose the prompt lines for the current selection stage.
  let line1='', line2='', sub='';
  if(hopMode){
    if(!source){
      line1='Hop mode';
      line2='Step 1: select a home planet';
      sub='The spacecraft parks there and waits for the first transfer.';
    } else if(!target){
      line1=`Parked at ${source.name}`;
      line2='Step 2: select a destination';
      sub='Choose any other planet to compute the Hohmann transfer.';
    } else {
      line1=`${source.name} \u2192 ${target.name}`;
      line2=`${launchWindows.length} launch windows shown`;
      sub='Wait for the W1 marker, then press \u25b6 Launch.';
    }
  } else {
    if(!source){
      line2='Step 1: select a source planet';
      sub='Click any planet to begin the transfer calculation.';
    } else if(!target){
      line1=`Source: ${source.name}`;
      line2='Step 2: select a target planet';
      sub='Click another planet to compute the Hohmann transfer.';
    } else if(!ship){
      line1=`${source.name} \u2192 ${target.name}`;
      line2=`${launchWindows.length} launch windows shown`;
      sub='The gold markers show where to launch. Press \u25b6 Launch when ready.';
    } else off=true;
  }
  // Touch the DOM only when the text changes. A change in the guide's height
  // moves the clear canvas part, so resize() frames the orbits again.
  const key=(off?'0':'1')+line1+'|'+line2+'|'+sub;
  if(el._key===key) return;
  el._key=key;
  el.classList.toggle('off',!!off);
  if(!off){
    document.getElementById('guide1').textContent=line1;
    document.getElementById('guide2').textContent=line2;
    document.getElementById('guide3').textContent=sub;
  }
  const h=el.offsetHeight;
  if(el._h!==undefined&&el._h!==h){ resize(); _sc=null; }
  el._h=h;
}

// The grade card's box. It sits where #guide sits (the guide hides while a
// ship flies), so it covers the base line, not the orbits.
function scoreRect(){
  const u=UIS, bw=Math.min(W-28,320*u), bh=128*u;
  const g=document.getElementById('guide');
  let cx=CX, bot=H-14;
  if(g&&g.offsetParent){ const rg=g.getBoundingClientRect(), rc=cvs.getBoundingClientRect(); cx=rg.left-rc.left+rg.width/2; bot=rg.bottom-rc.top; }
  return {bx:cx-bw/2, by:bot-bh, bw, bh};
}
// The Δv1 arrow's ends in screen px, or null when it does not show: the
// first 12% of the coast. fade runs 1 to 0 over that time.
function burnArrow(){
  if(!ship||!xfer) return null;
  const dt=simTime-ship.launchT;
  if(dt<0||dt>xfer.tTr*0.12) return null;
  const fade=dt<0.001?1:Math.max(0,1-dt/(xfer.tTr*0.12));
  const lx=CX+Math.cos(ship.launchAng)*xfer.r1*SCALE;
  const ly=CY-Math.sin(ship.launchAng)*xfer.r1*SCALE;
  // Tangent is 90 degrees ahead of the radius; sign follows ascent/descent.
  const tanAng=ship.launchAng+Math.PI/2*(xfer.asc?1:-1);
  // Arrow length in pixels, proportional to burn fraction, capped to the view.
  const len=Math.min(xfer.dv1/xfer.vc1*xfer.r1*SCALE*5, Math.min(W,H)*0.32);
  return {lx,ly,vx:lx+Math.cos(tanAng)*len,vy:ly-Math.sin(tanAng)*len,tanAng,len,fade};
}

// Draw the first-burn Δv arrow at the departure point, shown briefly after
// launch then fading out. The arrow points along the tangent (the burn is
// prograde) and its length scales with the burn fraction dv1/vc1.
function drawBurnVector(){
  const A=burnArrow(); if(!A) return;
  const {lx,ly,vx,vy,tanAng,fade}=A, dvPixels=A.len;

  ctx.save();
  ctx.globalAlpha=fade*0.92;
  const gl=ctx.createRadialGradient(lx,ly,0,lx,ly,dvPixels*1.1);
  gl.addColorStop(0,'rgba(92,216,232,0.14)'); gl.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(lx,ly,dvPixels*1.1,0,TAU); ctx.fillStyle=gl; ctx.fill();

  ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(vx,vy);
  ctx.strokeStyle='#5cd8e8'; ctx.lineWidth=2.5*UIS; ctx.lineCap='round'; ctx.stroke();

  // Arrowhead as a filled triangle at the vector tip.
  const headLen=10*UIS, headAng=0.42;
  ctx.beginPath();
  ctx.moveTo(vx,vy);
  ctx.lineTo(vx-headLen*Math.cos(tanAng-headAng), vy+headLen*Math.sin(tanAng-headAng));
  ctx.lineTo(vx-headLen*Math.cos(tanAng+headAng), vy+headLen*Math.sin(tanAng+headAng));
  ctx.closePath(); ctx.fillStyle='#5cd8e8'; ctx.fill();

  // Δv1 value in km/s beside the arrow, on whichever side has room.
  ctx.font=`600 ${11*UIS}px ${F_SANS}`;
  const mx=(lx+vx)/2, my=(ly+vy)/2;
  const nx=-Math.sin(tanAng)*16*UIS, ny=Math.cos(tanAng)*16*UIS;
  const txt=`\u0394v\u2081 = ${(xfer.dv1*AU2KMS).toFixed(2)} km/s`;
  const at=placeLabel(txt,[[mx+nx,my-ny],[mx-nx,my+ny],[vx+nx,vy-ny],[vx-nx,vy+ny],[mx+nx*2.5,my-ny*2.5],[mx-nx*2.5,my+ny*2.5]],false,2);
  if(at) shadowText(txt,at[0],at[1],'#9ce8f4');
  ctx.restore();
}

// Draw the launch-grade card after a launch: the big letter grade, the timing
// error, and a flavour verdict. It holds for a few seconds then fades and clears.
function drawScoreOverlay(){
  if(!launchScore) return;
  // Advance the fade timer; hold fully, then fade out and drop the card.
  launchScore.fadeT+=0.016;
  const hold=3.2, fade=2;
  let alpha=1;
  if(launchScore.fadeT>hold) alpha=Math.max(0,1-(launchScore.fadeT-hold)/fade);
  if(alpha<=0){ launchScore=null; return; }

  const sc=launchScore, u=UIS;
  const {bx,by,bw,bh}=scoreRect();

  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.fillStyle='rgba(8,9,15,0.92)';
  ctx.strokeStyle=sc.color+'66';
  ctx.lineWidth=1;
  rRect(ctx,bx,by,bw,bh,12*u); ctx.fill(); ctx.stroke();

  // Grade at the left; timing on the right; the verdict line under both.
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font=`600 ${46*u}px ${F_SERIF}`;
  ctx.fillStyle=sc.color;
  ctx.shadowColor=sc.color; ctx.shadowBlur=16*u;
  ctx.fillText(sc.grade, bx+bw*0.2, by+44*u);
  ctx.shadowBlur=0;

  const dStr=sc.dtDays<1 ? `${(sc.dtDays*24).toFixed(1)} hr` : `${sc.dtDays.toFixed(1)} days`;
  const tx=bx+bw*0.4, tw=bw*0.56;
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.font=`500 ${10*u}px ${F_SANS}`;
  ctx.fillStyle='rgba(150,200,255,0.75)';
  ctx.fillText('Launch timing', tx, by+18*u, tw);
  ctx.fillStyle=sc.color;
  ctx.font=`600 ${14*u}px ${F_SANS}`;
  ctx.fillText(dStr+' '+sc.timing, tx, by+33*u, tw);
  ctx.font=`400 ${11*u}px ${F_SANS}`;
  ctx.fillStyle='rgba(210,215,230,0.65)';
  ctx.fillText(sc.dtDays<0.5?'On window':'Off window by '+dStr, tx, by+54*u, tw);

  ctx.strokeStyle='rgba(150,200,255,0.12)';
  ctx.beginPath(); ctx.moveTo(bx+14*u,by+80*u); ctx.lineTo(bx+bw-14*u,by+80*u); ctx.stroke();

  ctx.font=`italic 400 ${13*u}px ${F_SERIF}`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='rgba(215,220,235,0.8)';
  ctx.fillText(sc.flavor, bx+bw/2, by+102*u, bw-24*u);
  ctx.restore();
}

// Trace a rounded rectangle path (used by the HUD panels).
function rRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

// Draw the spacecraft: its fading trail, the hull rotated to its heading, and
// an engine plume while under way. A green halo marks a parked ship in hop mode.
function drawShip(){
  if(!ship||(!ship.x&&ship.x!==0)) return;

  // Trail
  // Fade the trail from tail to head so recent motion is brightest.
  if(ship.trail.length>1){
    for(let i=1;i<ship.trail.length;i++){
      const t=i/ship.trail.length;
      ctx.beginPath();
      ctx.moveTo(ship.trail[i-1].x,ship.trail[i-1].y);
      ctx.lineTo(ship.trail[i].x,ship.trail[i].y);
      ctx.strokeStyle=`rgba(255,200,80,${t*0.5})`;
      ctx.lineWidth=1+t*1.2; ctx.stroke();
    }
  }

  // Heading: from the last two trail points while flying; from the orbital
  // tangent once parked; from the launch tangent before any trail exists.
  let heading=0;
  if(ship.trail.length>=2){
    const a=ship.trail[ship.trail.length-2];
    const b=ship.trail[ship.trail.length-1];
    heading=Math.atan2(b.y-a.y,b.x-a.x);
  } else if(ship.arrived){
    const ang=ship.arriveAng+ship.arriveOmega*(simTime-ship.arriveT);
    heading=ang+Math.PI/2;
  } else {
    heading=ship.launchAng+(xfer&&xfer.asc?Math.PI/2:-Math.PI/2);
  }

  if(hopMode&&ship.arrived){
    const g=ctx.createRadialGradient(ship.x,ship.y,0,ship.x,ship.y,18*UIS);
    g.addColorStop(0,'rgba(122,216,122,0.28)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(ship.x,ship.y,18*UIS,0,TAU); ctx.fillStyle=g; ctx.fill();
  }
  const eg=ctx.createRadialGradient(ship.x,ship.y,0,ship.x,ship.y,14*UIS);
  eg.addColorStop(0,'rgba(255,220,120,0.24)'); eg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath(); ctx.arc(ship.x,ship.y,14*UIS,0,TAU); ctx.fillStyle=eg; ctx.fill();

  // Move to the ship and rotate the local frame to its heading, then draw.
  ctx.save();
  ctx.translate(ship.x,ship.y);
  ctx.rotate(heading);
  const s=UIS;
  // Engine plume, only while under way; it flickers via a sine of sim time.
  if(!ship.arrived){
    const plumeLen=10*s, plumeW=4*s;
    const pg=ctx.createLinearGradient(-plumeLen,0,0,0);
    pg.addColorStop(0,'rgba(100,200,255,0)');
    pg.addColorStop(0.4,'rgba(150,230,255,0.5)');
    pg.addColorStop(1,'rgba(220,240,255,0.9)');
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(-plumeLen,-plumeW*0.5*(0.6+0.4*Math.sin(simTime*80)));
    ctx.lineTo(-plumeLen*1.4,0);
    ctx.lineTo(-plumeLen, plumeW*0.5*(0.6+0.4*Math.sin(simTime*80+1)));
    ctx.closePath(); ctx.fillStyle=pg; ctx.fill();
  }
  // Hull: an arrow-like polygon pointing along +x (the heading direction).
  ctx.beginPath();
  ctx.moveTo( 9*s,  0); ctx.lineTo( 2*s,  3.5*s); ctx.lineTo(-5*s,  2.5*s);
  ctx.lineTo(-3*s,  0); ctx.lineTo(-5*s, -2.5*s); ctx.lineTo( 2*s, -3.5*s);
  ctx.closePath(); ctx.fillStyle='#c8dcf0'; ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4*s, 0, 2.5*s, 1.5*s, 0, 0, TAU);
  ctx.fillStyle='rgba(180,230,255,0.75)'; ctx.fill();
  ctx.strokeStyle='rgba(150,200,255,0.45)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(2*s,3.5*s); ctx.lineTo(-5*s,2.5*s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(2*s,-3.5*s); ctx.lineTo(-5*s,-2.5*s); ctx.stroke();
  ctx.restore();
}

// Advance the flying ship along the transfer ellipse. Position is analytic:
// mean anomaly grows linearly with elapsed time, Kepler's equation gives the
// eccentric anomaly, and eToXY maps it to the screen. On arrival the ship
// circularises onto the target orbit (and hop mode logs the leg).
function updateShip(){
  if(!ship||ship.arrived) return;
  const dt=simTime-ship.launchT;
  // Before the launch instant, hold the ship at the departure point.
  if(dt<=0){
    ship.x=CX+Math.cos(ship.launchAng)*xfer.r1*SCALE;
    ship.y=CY-Math.sin(ship.launchAng)*xfer.r1*SCALE;
    return;
  }
  // After one half-period the ship reaches the far tangent and arrives.
  if(dt>=xfer.tTr){
    ship.arrived=true;
    // Arrival is half a turn from launch, at the target radius.
    ship.arriveAng=ship.launchAng+Math.PI;
    ship.arriveT=simTime;
    // Post-arrival angular rate is the target orbit's: omega = TAU/r^1.5.
    ship.arriveOmega=TAU/Math.pow(xfer.r2,1.5);
    if(hopMode){
      // Log this leg, then make the target the new home and clear the target.
      hopLog.push({
        from: hopHomePlanet ? hopHomePlanet.name : source.name,
        to: target.name,
        toColor: target.color,
        fromColor: source.color,
        grade: launchScore ? launchScore.grade : '—',
        color: launchScore ? launchScore.color : '#c8d0e0',
        dtDays: launchScore ? launchScore.dtDays : 0,
        timing: launchScore ? launchScore.timing : '',
        dvTot: xfer.dvTot,
      });
      hopHomePlanet=target;
      setTbar(true,`✓ ARRIVED AT ${target.name.toUpperCase()} — SELECT NEXT DESTINATION`, true);
      setStatus(`At ${target.name}. Hop ${hopLog.length} complete.`);
      source=target; target=null; xfer=null; launchWindows=[];
      setBtnLaunch(false);
      setEqPanelActive(false);
      renderMath();
    } else {
      // Normal mode: just report the completed transfer.
      setTbar(true,'✓ TRANSFER COMPLETE — SPACECRAFT IN TARGET ORBIT', true);
      setStatus('Transfer complete');
    }
    return;
  }
  // Mid-flight: mean anomaly goes from E0 to E0+pi over the half-period, so the
  // fraction dt/tTr scaled by pi is the mean-anomaly progress. Solve Kepler for
  // the eccentric anomaly, then map to a screen point on the ellipse.
  const E=solveKepler((xfer.asc?0:Math.PI)+Math.PI*(dt/xfer.tTr), xfer.e_t);
  const xo=xfer.a_t*Math.cos(E)-xfer.c_t, yo=xfer.b_t*Math.sin(E);
  const cp=Math.cos(ship.periAng), sp=Math.sin(ship.periAng);
  const nx=CX+(xo*cp-yo*sp)*SCALE;
  const ny=CY-(xo*sp+yo*cp)*SCALE;
  // Append to the trail, keeping at most 120 points.
  ship.trail.push({x:nx,y:ny});
  if(ship.trail.length>120) ship.trail.shift();
  ship.x=nx; ship.y=ny;
}

/* ═════════════════════════════════════════════════════════════
   MAIN LOOP
   ═════════════════════════════════════════════════════════════ */
// fc counts frames per second window; lastFT marks that window's start.
let fc=0, lastFT=performance.now();
// The per-frame update and render. Advances sim time by real elapsed time
// scaled by BASE_TS and the speed slider, moves the ship, refreshes the launch
// windows when idle, then draws every layer back to front.
function frame(now){
  // Time step in real seconds since the last frame.
  if(lastT===null) lastT=now;
  const dtR=(now-lastT)/1000; lastT=now;

  // Advance sim time unless paused; slider sets years per real second.
  if(!paused){
    const spd=parseFloat(document.getElementById('spSlider').value);
    simTime+=dtR*BASE_TS*spd;
  }

  // Arrived ship coasts on the target orbit; otherwise step along the ellipse.
  if(ship&&ship.arrived){
    const ang=ship.arriveAng+ship.arriveOmega*(simTime-ship.arriveT);
    const r=ship.r2;
    ship.x=CX+Math.cos(ang)*r*SCALE;
    ship.y=CY-Math.sin(ang)*r*SCALE;
  } else updateShip();

  // Recompute launch windows only while no ship is in flight.
  if(source&&target&&xfer&&(!ship||ship.arrived))
    launchWindows=computeWindows(source,target,xfer,simTime);

  // Back to front: background, orbits, then the launch-window ghosts. The
  // planet names claim their label spots first (layoutPlanetLabels).
  lblReset();
  // Marks that labels must not cover claim their boxes first: the grade
  // card, the two burn markers, the ship, and the launch-window rings.
  if(launchScore){ const R=scoreRect(); lblBlock(R.bx,R.by,R.bx+R.bw,R.by+R.bh); }
  const BA=burnArrow();
  if(BA) for(let k=0;k<=6;k++){ const x=BA.lx+(BA.vx-BA.lx)*k/6, y=BA.ly+(BA.vy-BA.ly)*k/6, q=5*UIS; lblBlock(x-q,y-q,x+q,y+q); }
  if(ship&&xfer){
    const br=10*UIS;
    [[ship.launchAng,xfer.r1],[ship.launchAng+Math.PI,xfer.r2]].forEach(([g,rr])=>{
      const x=CX+Math.cos(g)*rr*SCALE, y=CY-Math.sin(g)*rr*SCALE; lblBlock(x-br,y-br,x+br,y+br);
    });
    if(ship.x||ship.x===0){ const sr=11*UIS; lblBlock(ship.x-sr,ship.y-sr,ship.x+sr,ship.y+sr); }
  }
  if(source&&target&&xfer) launchWindows.forEach(w=>{
    const sx=CX+Math.cos(w.srcAng)*source.r*SCALE, sy=CY-Math.sin(w.srcAng)*source.r*SCALE, rr=source.size*UIS+6*UIS;
    lblBlock(sx-rr,sy-rr,sx+rr,sy+rr);
  });
  layoutPlanetLabels();
  drawBg();
  planets.forEach(p=>drawOrbit(p));
  drawWindows();

  // Geometry overlay: faint axes + labels on whichever ellipse is "active"
  if(xfer){
    let geomAng=null;
    if(ship){
      geomAng=xfer.asc?ship.launchAng:ship.launchAng+Math.PI;
    } else if(launchWindows.length>0){
      const w=launchWindows[0];
      geomAng=xfer.asc?w.srcAng:w.srcAng+Math.PI;
    }
    if(geomAng!==null) drawEllipseGeometry(xfer,geomAng);
  }

  // With a ship in flight, draw its full ellipse and both burn markers.
  if(ship&&xfer){
    const pA=xfer.asc?ship.launchAng:ship.launchAng+Math.PI;
    drawXferEllipse(xfer,pA,1,true);
    burnMark(CX+Math.cos(ship.launchAng)*xfer.r1*SCALE,CY-Math.sin(ship.launchAng)*xfer.r1*SCALE,'#5cd8e8','Δv₁');
    burnMark(CX+Math.cos(ship.launchAng+Math.PI)*xfer.r2*SCALE,CY-Math.sin(ship.launchAng+Math.PI)*xfer.r2*SCALE,'#ffc832','Δv₂');
  }

  // Planets and labels on top of orbits, then the ship and its HUD overlays.
  planets.forEach(p=>{const pos=pPos(p);drawPlanet(p,pos);drawLabel(p,pos)});
  drawShip();
  drawBurnVector();
  drawScoreOverlay();
  drawGuidance();

  // Once per second, publish the frame count as FPS.
  fc++; const n2=performance.now();
  if(n2-lastFT>=1000){document.getElementById('fpsRead').textContent=fc;fc=0;lastFT=n2}
  // Update the topbar readouts and schedule the next frame.
  document.getElementById('bodyCount').textContent=planets.length;
  document.getElementById('timeRead').textContent=simTime.toFixed(2);
  requestAnimationFrame(frame);
}

