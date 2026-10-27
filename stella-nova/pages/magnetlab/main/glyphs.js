// ============================================================================
//  MAGNETLAB  ·  magnet drawing  (part 11 of 20)
// ----------------------------------------------------------------------------
//  renderMagnets() and one glyph drawer per magnet type. Appearance only:
//  the poles in magnets.js carry the physics.
//
//  grep -n targets: "function renderMagnets", "function drawBar", "function drawHalbach"
// ============================================================================

// Magnet layer: translate and rotate into each body's frame, dispatch to the
// per-type glyph drawer, and ring dynamic magnets with a dashed halo.
function renderMagnets(){
  for(const mag of magnets){
    ctx.save();ctx.translate(mag.x,mag.y);ctx.rotate(mag.angle);
    const sel=mag.id===SIM.selectedId;
    if(mag.type==='bar') drawBar(mag,sel);
    else if(mag.type==='dipole') drawDipole(mag,sel);
    else if(mag.type==='solenoid') drawSolenoid(mag,sel);
    else if(mag.type==='horseshoe') drawHorseshoe(mag,sel);
    else if(mag.type==='buzzer') drawBuzzer(mag,sel);
    else if(mag.type==='ring') drawRing(mag,sel);
    else if(mag.type==='quadrupole') drawQuadrupole(mag,sel);
    else if(mag.type==='halbach') drawHalbach(mag,sel);
    if(!mag.fixed){
      ctx.strokeStyle='rgba(100,200,100,0.45)';ctx.lineWidth=1;ctx.setLineDash([3,3]);
      ctx.beginPath();ctx.arc(0,0,Math.max(mag.w,mag.h)*0.65,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();
  }
}
// Per-type glyph drawers. Each runs in the magnet's local frame (already
// translated and rotated) and paints red for N, blue for S, brighter if
// selected. They draw appearance only; the poles above carry the physics.

// Bar: red N half, blue S half, N/S labels.
function drawBar(m,sel){
  const hw=m.w/2,hh=m.h/2;
  ctx.fillStyle=sel?'rgba(220,60,60,0.85)':'rgba(200,50,50,0.65)';ctx.fillRect(0,-hh,hw,m.h);
  ctx.fillStyle=sel?'rgba(60,100,220,0.85)':'rgba(50,80,200,0.65)';ctx.fillRect(-hw,-hh,hw,m.h);
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.25)';ctx.lineWidth=sel?2:1;ctx.strokeRect(-hw,-hh,m.w,m.h);
  ctx.font='bold 13px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,255,255,0.8)';ctx.fillText('N',hw/2,0);ctx.fillText('S',-hw/2,0);
}
// Dipole: a split disc with an arrow showing moment direction.
function drawDipole(m,sel){
  const r=16;
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle=sel?'rgba(150,200,255,0.2)':'rgba(150,200,255,0.08)';ctx.fill();
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.35)';ctx.lineWidth=sel?2:1;ctx.stroke();
  ctx.beginPath();ctx.arc(0,0,r-2,-Math.PI/2,Math.PI/2);ctx.fillStyle='rgba(220,60,60,0.45)';ctx.fill();
  ctx.beginPath();ctx.arc(0,0,r-2,Math.PI/2,Math.PI*1.5);ctx.fillStyle='rgba(60,100,220,0.45)';ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(-7,0);ctx.lineTo(7,0);ctx.moveTo(4,-3);ctx.lineTo(7,0);ctx.lineTo(4,3);ctx.stroke();
}
// Solenoid: a coil-wound block with vertical winding lines and end labels.
function drawSolenoid(m,sel){
  const hw=m.w/2,hh=m.h/2;
  ctx.fillStyle=sel?'rgba(80,60,40,0.8)':'rgba(60,45,30,0.65)';ctx.fillRect(-hw,-hh,m.w,m.h);
  ctx.strokeStyle='rgba(200,160,60,0.45)';ctx.lineWidth=1.5;
  for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(i*10,-hh);ctx.lineTo(i*10,hh);ctx.stroke();}
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.25)';ctx.lineWidth=sel?2:1;ctx.strokeRect(-hw,-hh,m.w,m.h);
  ctx.font='bold 11px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(220,60,60,0.8)';ctx.fillText('N',hw-10,0);
  ctx.fillStyle='rgba(60,100,220,0.8)';ctx.fillText('S',-hw+10,0);
}
// Horseshoe: two coloured arms joined by a bend, N and S tips at the top.
function drawHorseshoe(m,sel){
  const lc=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.35)';ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(25,-30);ctx.lineTo(25,15);ctx.strokeStyle='rgba(220,80,80,0.65)';ctx.lineWidth=10;ctx.stroke();
  ctx.beginPath();ctx.moveTo(-25,-30);ctx.lineTo(-25,15);ctx.strokeStyle='rgba(80,100,220,0.65)';ctx.lineWidth=10;ctx.stroke();
  ctx.beginPath();ctx.arc(0,15,25,0,Math.PI);ctx.strokeStyle='rgba(140,100,180,0.55)';ctx.lineWidth=10;ctx.stroke();
  ctx.strokeStyle=lc;ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.moveTo(30,-30);ctx.lineTo(30,15);ctx.arc(0,15,30,0,Math.PI);ctx.lineTo(-30,-30);ctx.stroke();
  ctx.beginPath();ctx.moveTo(20,-30);ctx.lineTo(20,15);ctx.arc(0,15,20,0,Math.PI);ctx.lineTo(-20,-30);ctx.stroke();
  ctx.beginPath();ctx.moveTo(20,-30);ctx.lineTo(30,-30);ctx.moveTo(-20,-30);ctx.lineTo(-30,-30);ctx.stroke();
  ctx.font='bold 10px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,200,200,0.9)';ctx.fillText('N',25,-22);
  ctx.fillStyle='rgba(200,200,255,0.9)';ctx.fillText('S',-25,-22);
}
// Buzzer: a metallic disc split N/S with a centre dot.
function drawBuzzer(m,sel){
  const r=20;
  // Metallic disc body
  const grad=ctx.createRadialGradient(0,0,2,0,0,r);
  grad.addColorStop(0,'rgba(180,180,200,0.4)');grad.addColorStop(0.6,'rgba(120,120,140,0.35)');grad.addColorStop(1,'rgba(80,80,100,0.25)');
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill();
  // N half (right)
  ctx.beginPath();ctx.arc(0,0,r-2,-Math.PI/2,Math.PI/2);ctx.fillStyle='rgba(220,60,60,0.4)';ctx.fill();
  // S half (left)
  ctx.beginPath();ctx.arc(0,0,r-2,Math.PI/2,Math.PI*1.5);ctx.fillStyle='rgba(60,100,220,0.4)';ctx.fill();
  // Outline + inner ring
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
  ctx.strokeStyle='rgba(150,200,255,0.12)';ctx.beginPath();ctx.arc(0,0,r*0.55,0,Math.PI*2);ctx.stroke();
  // Center dot
  ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fillStyle='rgba(200,200,220,0.6)';ctx.fill();
  ctx.font='bold 8px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,255,255,0.7)';ctx.fillText('N',10,0);ctx.fillText('S',-10,0);
}
// Ring: an annulus with radial ticks marking the outward pole directions.
function drawRing(m,sel){
  const ro=26,ri=14;
  // Ring body with radial gradient
  ctx.beginPath();ctx.arc(0,0,ro,0,Math.PI*2);ctx.arc(0,0,ri,0,Math.PI*2,true);
  ctx.fillStyle=sel?'rgba(100,180,100,0.3)':'rgba(80,150,80,0.2)';ctx.fill();
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.arc(0,0,ro,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(0,0,ri,0,Math.PI*2);ctx.stroke();
  // Pole direction ticks (radial outward arrows)
  ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.lineWidth=1.5;
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    ctx.beginPath();ctx.moveTo(Math.cos(a)*ri,Math.sin(a)*ri);ctx.lineTo(Math.cos(a)*ro,Math.sin(a)*ro);ctx.stroke();
  }
  ctx.font='bold 7px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText('RING',0,0);
}
// Quadrupole: four pole circles on a cross, alternating N and S.
function drawQuadrupole(m,sel){
  const s=22,r=8;
  // Four pole circles at cardinal directions
  const poles=[{x:s,y:0,n:true},{x:0,y:s,n:false},{x:-s,y:0,n:true},{x:0,y:-s,n:false}];
  // Cross body
  ctx.strokeStyle=sel?'rgba(150,200,255,0.5)':'rgba(150,200,255,0.15)';ctx.lineWidth=sel?2:1;
  ctx.beginPath();ctx.moveTo(-s,0);ctx.lineTo(s,0);ctx.moveTo(0,-s);ctx.lineTo(0,s);ctx.stroke();
  // Pole circles
  for(const p of poles){
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
    ctx.fillStyle=p.n?'rgba(220,60,60,0.55)':'rgba(60,100,220,0.55)';ctx.fill();
    ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.3)';ctx.lineWidth=sel?2:1;ctx.stroke();
    ctx.font='bold 9px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='rgba(255,255,255,0.8)';ctx.fillText(p.n?'N':'S',p.x,p.y);
  }
  // Center marker
  ctx.beginPath();ctx.arc(0,0,3,0,Math.PI*2);ctx.fillStyle='rgba(255,200,50,0.5)';ctx.fill();
}
// Halbach: segmented bar with a rotation arrow per segment showing the 90
// degree step that steers the field to one face.
function drawHalbach(m,sel){
  const hw=m.w/2,hh=m.h/2,ns=6,sw=m.w/ns;
  // Draw segments with arrows showing rotation
  for(let i=0;i<ns;i++){
    const x=-hw+i*sw;
    const a=i*Math.PI/2; // 0°, 90°, 180°, 270°...
    // Segment fill: color indicates pole direction
    const red=Math.max(0,Math.cos(a)), blue=Math.max(0,-Math.cos(a));
    const up=Math.max(0,-Math.sin(a)), dn=Math.max(0,Math.sin(a));
    ctx.fillStyle=`rgba(${(80+red*140)|0},${(40+up*80+dn*80)|0},${(80+blue*140)|0},0.5)`;
    ctx.fillRect(x,-hh,sw,m.h);
    // Arrow showing dipole direction in this segment
    ctx.save();ctx.translate(x+sw/2,0);ctx.rotate(a);
    ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(-6,0);ctx.lineTo(6,0);ctx.moveTo(3,-3);ctx.lineTo(6,0);ctx.lineTo(3,3);ctx.stroke();
    ctx.restore();
  }
  // Outline
  ctx.strokeStyle=sel?'rgba(150,200,255,0.8)':'rgba(150,200,255,0.25)';ctx.lineWidth=sel?2:1;
  ctx.strokeRect(-hw,-hh,m.w,m.h);
  // Segment dividers
  ctx.strokeStyle='rgba(150,200,255,0.15)';ctx.lineWidth=1;
  for(let i=1;i<ns;i++){const x=-hw+i*sw;ctx.beginPath();ctx.moveTo(x,-hh);ctx.lineTo(x,hh);ctx.stroke();}
  // Label
  ctx.font='bold 8px Inter, system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,200,50,0.6)';ctx.fillText('HALBACH',0,hh+8);
}
