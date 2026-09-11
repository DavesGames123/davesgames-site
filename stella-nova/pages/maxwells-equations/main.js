// ============================================================================
//  MAXWELL'S EQUATIONS  ·  interactive explorer
// ----------------------------------------------------------------------------
//  Four tabbed canvas visualizations, one per equation. A tab selects activeEq;
//  switchEq re-renders the equation display, rebuilds the tab's controls, and
//  re-seeds its scene. One render(dt) dispatches to the active equation's own
//  draw routine each frame. All scene state lives in STATE; controls and drag
//  handlers mutate it in place.
//
//  THE FOUR TABS
//  --------------------------------------------------------------------------
//      0  Gauss ∇·E = ρ/ε₀      charges + a Gaussian surface; flux = enclosed Q
//      1  Gauss ∇·B = 0         a dipole magnet; every closed surface nets zero
//      2  Faraday ∇×E = −∂B/∂t  oscillating B induces a circulating E (Lenz sign)
//      3  Ampère–Maxwell        wire currents give μ₀J·B, plus the capacitor's
//                               displacement current ε₀∂E/∂t circulating B
//
//  SCREEN LAYOUT   (the leading marker is an element id)
//  --------------------------------------------------------------------------
//      #panel       tabs, per-equation controls, About text
//      #canvas-wrap #sim-canvas plus the floating #eq-display card
//      #status-bar  active equation · info · fps
//
//  FRAME PIPELINE
//  --------------------------------------------------------------------------
//      loop(t) ─ render(dt) ─ clear + grid ─▶ renderGauss / renderMonopoles /
//                                             renderFaraday / renderAmpere
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      constants ........... "EQ_COLORS"           per-tab colors and labels
//      state ............... "const STATE="        all scene state
//      equation display .... "EQUATION DISPLAY"     LaTeX and prose per tab
//      controls ............ "function buildControls"  per-tab control markup
//      tab switch .......... "function switchEq"    change the active equation
//      per-tab init ........ "function initEq"      seed a scene on entry
//      physics ............. "function eField"      field formulas
//      actions ............. "function addCharge"   add/clear scene objects
//      field color ......... "function fColor"      magnitude → tinted color
//      render dispatch ..... "function render"      clear, grid, dispatch
//      Gauss draw .......... "function renderGauss" tab 0
//      monopoles draw ...... "function renderMonopoles"  tab 1
//      Faraday draw ........ "function renderFaraday"    tab 2
//      Ampère draw ......... "function renderAmpere"     tab 3
//      drag ................ "function getPos"      pointer picking and drag
//      resize .............. "function resize"      canvas sizing and DPR
//      loop ................ "function loop"        per-frame driver
// ============================================================================
/* ════════════════════════════════════════════════════════════
   MAXWELL'S EQUATIONS — INTERACTIVE EXPLORER
   4 tabbed visualizations, one per equation.
   ════════════════════════════════════════════════════════════ */
// The drawing canvas and its 2D context. CW/CH are the CSS size; activeEq is the
// index of the currently shown equation (0 to 3).
const canvas=document.getElementById('sim-canvas');
const ctx=canvas.getContext('2d');
let CW=100,CH=100,activeEq=0;

// Per-tab accent color and the label strings shown on the tab, status bar, and
// equation title. Index by activeEq.
// Colors matching the equation accents
const EQ_COLORS=['#ff9050','#60e0ee','#64c864','#c890ff'];
const EQ_NAMES=['I · Gauss\'s Law','II · No Monopoles','III · Faraday\'s Law','IV · Ampère–Maxwell'];
const EQ_TITLES=['GAUSS\'S LAW · ELECTRIC','GAUSS\'S LAW · MAGNETIC','FARADAY\'S LAW · INDUCTION','AMPÈRE–MAXWELL LAW'];
const EQ_ROMAN=['I','II','III','IV'];

// All scene state, grouped by equation. Gauss holds the charge list and the
// Gaussian surface; monopoles hold the dipole pose; Faraday holds the drive rate
// and phase clock; Ampère holds the wire list and its clock. Positions are in
// canvas pixels; angles in radians.
// Per-equation state
const STATE={
  // Eq 0: Gauss - charges
  charges:[],
  gaussR:80,
  gaussX:0,gaussY:0,
  // Eq 1: No monopoles - dipole
  dipX:0,dipY:0,dipAngle:0,dipStr:2,
  // Eq 2: Faraday - changing B
  faradayRate:1.0,faradayTime:0,faradayR:60,
  // Eq 3: Ampere - wire current
  ampWires:[],ampTime:0,
  // Shared
  showArrows:true,showTracers:true,
};

// Paint a range input's filled track via the --pct custom property.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}

// The four equations as KaTeX source, color-coded to the field accents.
/* ═══ EQUATION DISPLAY ═══ */
const EQ_LATEX=[
  `\\textcolor{#ff9050}{\\nabla \\cdot \\vec{E}} \\;=\\; \\frac{\\textcolor{#ffc832}{\\rho}}{\\textcolor{#c890ff}{\\varepsilon_0}}`,
  `\\textcolor{#60e0ee}{\\nabla \\cdot \\vec{B}} \\;=\\; 0`,
  `\\textcolor{#64c864}{\\nabla \\times \\vec{E}} \\;=\\; -\\frac{\\partial \\textcolor{#60e0ee}{\\vec{B}}}{\\partial t}`,
  `\\textcolor{#c890ff}{\\nabla \\times \\vec{B}} \\;=\\; \\textcolor{#c890ff}{\\mu_0}\\!\\left(\\textcolor{#ffb84d}{\\vec{J}} + \\textcolor{#c890ff}{\\varepsilon_0}\\frac{\\partial \\textcolor{#ff9050}{\\vec{E}}}{\\partial t}\\right)`,
];
// Plain-language explanation of each equation, shown under the formula.
const EQ_ENGLISH=[
  `<strong>Electric charges create electric field.</strong> Positive charges are sources (field radiates outward). Negative charges are sinks (field points inward). The total flux through any closed surface equals the enclosed charge. Drag charges and the Gaussian surface to see this.`,
  `<strong>There are no magnetic monopoles.</strong> Magnetic field lines always form closed loops — they never start or end. The total magnetic flux through any closed surface is always zero. Every north pole has a south pole. Drag the dipole and watch the lines close on themselves.`,
  `<strong>A changing magnetic field creates an electric field.</strong> When B changes in time, it induces a circulating E field. Faster change = stronger induced E. This is the principle behind every electrical generator. Adjust the rate to see the induced field change.`,
  `<strong>Electric currents and changing electric fields create magnetic field.</strong> Steady currents (J) create circulating B — that's the Biot–Savart law. Maxwell's genius: he added the ∂E/∂t term, predicting that even without wire, a changing E field creates B. This completed the equations and predicted electromagnetic waves.`,
];

// Fill the equation card for the active tab: accent dot, title, prose, and the
// rendered LaTeX formula.
function renderEqDisplay(){
  const col=EQ_COLORS[activeEq];
  document.getElementById('eq-dot').style.background=col;
  document.getElementById('eq-dot').style.boxShadow=`0 0 8px ${col}`;
  document.getElementById('eq-title-text').textContent=EQ_TITLES[activeEq];
  document.getElementById('eq-title-text').style.color=col;
  document.getElementById('eq-english').innerHTML=EQ_ENGLISH[activeEq];
  try{
    katex.render(EQ_LATEX[activeEq],document.getElementById('eq-katex'),{throwOnError:false,displayMode:true});
  }catch(e){}
}

// Rebuild the control panel and About text for the active tab. Each case injects
// the widgets that tab needs, wired through inline handlers that write STATE.
/* ═══ CONTROLS PER EQUATION ═══ */
function buildControls(){
  const area=document.getElementById('ctrl-area');
  area.innerHTML='';
  const about=document.getElementById('about-text');
  switch(activeEq){
    // Gauss: add charges of either sign and resize the Gaussian surface.
    case 0:
      area.innerHTML=`
        <button class="tog-btn on" onclick="addCharge(1)">+ Add Positive Charge</button>
        <button class="tog-btn on" onclick="addCharge(-1)">− Add Negative Charge</button>
        <div class="mag-row" style="margin-top:6px"><span class="mag-row-lbl">Surface</span>
          <input type="range" min="30" max="200" value="${STATE.gaussR}" step="5" oninput="STATE.gaussR=+this.value;sg(this)">
          <span class="val">${STATE.gaussR}</span></div>
        <button class="tog-btn" onclick="clearCharges()" style="margin-top:4px;color:var(--yellow);border-color:rgba(255,200,50,0.3)">✕ Clear Charges</button>`;
      about.textContent='Coulomb discovered (1785) that electric force follows an inverse-square law. Gauss showed this means the total flux through any closed surface depends only on enclosed charge — not the surface shape. Place charges and resize the Gaussian surface to verify.';
      break;
    // No monopoles: set the dipole strength and orientation angle.
    case 1:
      area.innerHTML=`
        <div class="mag-row"><span class="mag-row-lbl">Str</span>
          <input type="range" min="0.5" max="5" value="${STATE.dipStr}" step="0.1" oninput="STATE.dipStr=+this.value;sg(this)">
          <span class="val">${STATE.dipStr.toFixed(1)}</span></div>
        <div class="mag-row"><span class="mag-row-lbl">Angle</span>
          <input type="range" min="-3.14" max="3.14" value="${STATE.dipAngle}" step="0.05" oninput="STATE.dipAngle=+this.value;sg(this)">
          <span class="val">${(STATE.dipAngle*180/Math.PI).toFixed(0)}°</span></div>`;
      about.textContent='No one has ever found an isolated magnetic pole. Break a magnet in half and you get two smaller magnets, each with both N and S. This equation — ∇·B = 0 — encodes that fact. Gauss (1835) formalized it. The field lines must close, unlike electric field lines which can start on + and end on −.';
      break;
    // Faraday: set how fast B oscillates and the field region radius.
    case 2:
      area.innerHTML=`
        <div class="mag-row"><span class="mag-row-lbl">Rate</span>
          <input type="range" min="-3" max="3" value="${STATE.faradayRate}" step="0.1" oninput="STATE.faradayRate=+this.value;document.getElementById('vl-rate').textContent=(+this.value).toFixed(1);sg(this)">
          <span class="val" id="vl-rate">${STATE.faradayRate.toFixed(1)}</span></div>
        <div class="mag-row"><span class="mag-row-lbl">Radius</span>
          <input type="range" min="30" max="150" value="${STATE.faradayR}" step="5" oninput="STATE.faradayR=+this.value;sg(this)">
          <span class="val">${STATE.faradayR}</span></div>`;
      about.textContent='Faraday discovered (1831) that a changing magnetic field induces an electric current. He moved magnets through coils and saw current flow. The negative sign means the induced E opposes the change (Lenz\'s law) — nature resists changes in flux. This is how generators, transformers, and induction cooktops work.';
      break;
    // Ampère–Maxwell: add current-carrying wires (current out of or into plane).
    case 3:
      area.innerHTML=`
        <button class="tog-btn on" onclick="addAmpWire(1)">⊙ Add Wire (I out)</button>
        <button class="tog-btn on" onclick="addAmpWire(-1)">⊗ Add Wire (I in)</button>
        <button class="tog-btn" onclick="STATE.ampWires=[]" style="margin-top:4px;color:var(--yellow);border-color:rgba(255,200,50,0.3)">✕ Clear</button>`;
      about.textContent='Ampère showed (1825) that currents create circulating B fields. Maxwell (1862) added the displacement current term ε₀∂E/∂t — without it, the equations are mathematically inconsistent for time-varying fields. This fix predicted electromagnetic waves traveling at c. Light is an electromagnetic wave.';
      break;
  }
  area.querySelectorAll('input[type=range]').forEach(sg);
}

// Switch the active equation: highlight its tab, update the status label, and
// refresh the display, controls, and scene.
/* ═══ EQUATION SWITCH ═══ */
function switchEq(idx){
  activeEq=idx;
  document.querySelectorAll('.eq-tab').forEach(t=>t.classList.toggle('active',+t.dataset.eq===idx));
  document.getElementById('st-eq').textContent=EQ_NAMES[idx];
  renderEqDisplay();
  buildControls();
  initEq();
}

// Seed a tab's scene when it becomes active or after a resize: place default
// charges and the surface, center the dipole, or place a first wire.
/* ═══ INIT PER EQUATION ═══ */
function initEq(){
  switch(activeEq){
    case 0:
      if(!STATE.charges.length){
        STATE.charges=[{x:CW/2-40,y:CH/2,q:1},{x:CW/2+40,y:CH/2,q:-1}];
      }
      STATE.gaussX=CW/2;STATE.gaussY=CH/2;
      break;
    case 1:
      STATE.dipX=CW/2;STATE.dipY=CH/2;
      break;
    case 2:
      break;
    case 3:
      if(!STATE.ampWires.length){
        STATE.ampWires=[{x:CW/2,y:CH/2,I:2}];
      }
      break;
  }
}

// Field formulas. All are 2D and use pixel distances; the numeric constants are
// tuned for visible arrow lengths, not physical units.
/* ═══ PHYSICS ═══ */
// Electric field of a point charge: magnitude q/r² (Coulomb inverse square),
// pointing away from a positive charge. Clamped inside r² = 100 px² to avoid the
// singularity at the charge.
// Electric field from point charge
function eField(px,py,cx,cy,q){
  const dx=px-cx,dy=py-cy,r2=dx*dx+dy*dy;
  if(r2<100)return[0,0];
  const r=Math.sqrt(r2),F=q*12000/(r2);
  return[F*dx/r,F*dy/r];
}
// Superpose the field of every charge.
function totalE(px,py){
  let Ex=0,Ey=0;
  for(const c of STATE.charges){const[ex,ey]=eField(px,py,c.x,c.y,c.q);Ex+=ex;Ey+=ey;}
  return[Ex,Ey];
}
// Magnetic dipole field: the standard 3(m·r̂)r̂ − m form, falling off as 1/r³,
// with moment (mx,my) and strength str. Clamped near the dipole.
// Magnetic dipole field
function dipField(px,py,dx0,dy0,mx,my,str){
  const dx=px-dx0,dy=py-dy0,r2=dx*dx+dy*dy;
  if(r2<100)return[0,0];
  const r=Math.sqrt(r2),r3=r2*r,r5=r3*r2;
  const mdotr=mx*dx+my*dy;
  return[(3*mdotr*dx/r5-mx/r3)*str*100000,(3*mdotr*dy/r5-my/r3)*str*100000];
}
// Dipole field at the current pose, moment set by the angle control.
function totalB_dip(px,py){
  const mx=Math.cos(STATE.dipAngle),my=Math.sin(STATE.dipAngle);
  return dipField(px,py,STATE.dipX,STATE.dipY,mx,my,STATE.dipStr);
}
// Magnetic field of a straight wire (Biot–Savart): magnitude μ₀I/2πr, tangent to
// circles around the wire. The returned (−dy, dx)/r direction is that tangent.
// Wire B field (same as biot-savart page)
function wireB(px,py,wx,wy,I){
  const dx=px-wx,dy=py-wy,r2=dx*dx+dy*dy;
  if(r2<25)return[0,0];
  const r=Math.sqrt(r2),B=I*5/(r*6.2832); // 5x boost for visibility
  return[-dy/r*B,dx/r*B];
}
// Superpose the field of every wire.
function totalB_amp(px,py){
  let Bx=0,By=0;
  for(const w of STATE.ampWires){const[bx,by]=wireB(px,py,w.x,w.y,w.I);Bx+=bx;By+=by;}
  return[Bx,By];
}

// Scene actions invoked from the control buttons.
/* ═══ ACTIONS ═══ */
// Add a charge of sign q near the center with a small random offset.
function addCharge(q){
  STATE.charges.push({x:CW/2+(Math.random()-0.5)*100,y:CH/2+(Math.random()-0.5)*100,q});
}
// Remove all charges.
function clearCharges(){STATE.charges=[];}
// Add a wire with current direction dir, searching outward in rings for a free
// slot so wires do not overlap.
function addAmpWire(dir){
  const cx=CW/2,cy=CH/2;
  let x=cx,placed=false;
  for(let ring=0;ring<6&&!placed;ring++){
    for(const ox of(ring===0?[0]:[-ring*60,ring*60])){
      const tx=cx+ox;let ok=true;
      for(const w of STATE.ampWires)if(Math.abs(tx-w.x)<50){ok=false;break;}
      if(ok){x=tx;placed=true;break;}
    }
  }
  STATE.ampWires.push({x,y:cy,I:dir*2});
}

// Map a field magnitude to a tinted, log-compressed color. hue selects the field
// family: e orange (E), b blue (B), g green (induced E), p purple (Ampère B).
/* ═══ FIELD COLOR ═══ */
function fColor(mag,alpha,hue){
  // Simple: hue-tinted brightness
  const lv=Math.min(1,Math.log10(1+mag*8)/2);
  const a=lv*alpha;
  switch(hue){
    case 'e':return`rgba(${(255*lv)|0},${(120*lv)|0},${(40*lv)|0},${a})`; // orange
    case 'b':return`rgba(${(40*lv)|0},${(180*lv)|0},${(240*lv)|0},${a})`; // blue-cyan
    case 'g':return`rgba(${(60*lv)|0},${(200*lv)|0},${(80*lv)|0},${a})`; // green
    case 'p':return`rgba(${(180*lv)|0},${(100*lv)|0},${(255*lv)|0},${a})`; // purple
    default:return`rgba(${(150*lv)|0},${(200*lv)|0},${(255*lv)|0},${a})`;
  }
}

// Per-frame draw: clear, paint the background grid, then dispatch to the active
// equation's own renderer.
/* ═══ RENDER ═══ */
function render(dt){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.restore();
  ctx.fillStyle='#0e1118';ctx.fillRect(0,0,CW,CH);
  // Grid
  ctx.strokeStyle='rgba(150,200,255,0.025)';ctx.lineWidth=1;
  for(let x=0;x<CW;x+=50){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke();}
  for(let y=0;y<CH;y+=50){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke();}

  switch(activeEq){
    case 0:renderGauss(dt);break;
    case 1:renderMonopoles(dt);break;
    case 2:renderFaraday(dt);break;
    case 3:renderAmpere(dt);break;
  }
}

// Tab 0. Draw the E field as an arrow grid, the charges, the draggable Gaussian
// surface, and the flux arrows on it. Sum the enclosed charge and show that the
// net flux is zero exactly when the enclosed charge is zero.
/* ── EQ 0: GAUSS'S LAW ── */
function renderGauss(dt){
  const step=28;
  ctx.save();ctx.globalCompositeOperation='lighter';
  // E field arrows
  for(let x=step/2;x<CW;x+=step)for(let y=step/2;y<CH;y+=step){
    const[Ex,Ey]=totalE(x,y);
    const Em=Math.sqrt(Ex*Ex+Ey*Ey);if(Em<0.01)continue;
    const lv=Math.min(1,Math.log10(1+Em*1.5)/1.5);
    const len=Math.max(3,lv*16),nx=Ex/Em,ny=Ey/Em;
    const alpha=Math.max(0.08,lv*0.6);
    // Glow
    ctx.strokeStyle=`rgba(255,140,60,${alpha*0.25})`;ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    // Core
    ctx.strokeStyle=`rgba(255,150,70,${alpha})`;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    if(len>4){const ax=x+nx*len,ay=y+ny*len;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*4-ny*2.5,ay-ny*4+nx*2.5);ctx.lineTo(ax-nx*4+ny*2.5,ay-ny*4-nx*2.5);ctx.closePath();ctx.fillStyle=`rgba(255,150,70,${alpha})`;ctx.fill();}
  }
  ctx.restore();

  // Charges
  for(const c of STATE.charges){
    ctx.beginPath();ctx.arc(c.x,c.y,12,0,Math.PI*2);
    ctx.fillStyle=c.q>0?'rgba(220,60,60,0.8)':'rgba(60,100,220,0.8)';ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.lineWidth=1.5;ctx.stroke();
    ctx.font='bold 14px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#fff';ctx.fillText(c.q>0?'+':'−',c.x,c.y);
  }

  // Gaussian surface
  ctx.strokeStyle='rgba(255,200,50,0.6)';ctx.lineWidth=2;ctx.setLineDash([6,4]);
  ctx.beginPath();ctx.arc(STATE.gaussX,STATE.gaussY,STATE.gaussR,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);
  ctx.font='bold 10px "JetBrains Mono"';ctx.textAlign='center';
  ctx.fillStyle='rgba(255,200,50,0.7)';ctx.fillText('Gaussian Surface',STATE.gaussX,STATE.gaussY-STATE.gaussR-10);

  // Compute enclosed charge
  let Qenc=0;
  for(const c of STATE.charges){
    const dx=c.x-STATE.gaussX,dy=c.y-STATE.gaussY;
    if(dx*dx+dy*dy<STATE.gaussR*STATE.gaussR) Qenc+=c.q;
  }
  // Flux arrows on surface
  const nArrows=24;
  for(let i=0;i<nArrows;i++){
    const a=i/nArrows*Math.PI*2;
    const sx=STATE.gaussX+Math.cos(a)*STATE.gaussR,sy=STATE.gaussY+Math.sin(a)*STATE.gaussR;
    const[Ex,Ey]=totalE(sx,sy);
    const nr=Math.cos(a),nt=Math.sin(a);
    const flux=Ex*nr+Ey*nt; // E·n̂
    const len=Math.min(20,Math.abs(flux)*3);
    const dir=flux>0?1:-1;
    ctx.strokeStyle=flux>0?'rgba(255,150,50,0.6)':'rgba(50,150,255,0.6)';
    ctx.lineWidth=2;ctx.beginPath();
    ctx.moveTo(sx,sy);ctx.lineTo(sx+nr*len*dir,sy+nt*len*dir);ctx.stroke();
  }

  ctx.font='bold 12px "JetBrains Mono"';ctx.textAlign='center';
  ctx.fillStyle='rgba(255,200,50,0.9)';
  ctx.fillText(`Q_enc = ${Qenc>0?'+':''}${Qenc}`,STATE.gaussX,STATE.gaussY+STATE.gaussR+18);
  ctx.fillStyle='rgba(255,200,50,0.5)';
  ctx.fillText(`Φ = Q/ε₀ ${Qenc===0?'= 0':'≠ 0'}`,STATE.gaussX,STATE.gaussY+STATE.gaussR+32);
  document.getElementById('st-info').textContent=`Q_enc=${Qenc} · ${STATE.charges.length} charges`;
}

// Tab 1. Draw the dipole B field as arrows, the bar-magnet glyph, and a closed
// surface annotated to show its net magnetic flux is always zero: field lines
// close on themselves, so every line entering the surface also leaves it.
/* ── EQ 1: NO MONOPOLES ── */
function renderMonopoles(dt){
  const step=24;
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(let x=step/2;x<CW;x+=step)for(let y=step/2;y<CH;y+=step){
    const[Bx,By]=totalB_dip(x,y);
    const Bm=Math.sqrt(Bx*Bx+By*By);if(Bm<0.001)continue;
    const lv=Math.min(1,Math.log10(1+Bm*3)/1.6);
    const len=Math.max(3,lv*14),nx=Bx/Bm,ny=By/Bm;
    const alpha=Math.max(0.08,lv*0.6);
    ctx.strokeStyle=`rgba(60,180,230,${alpha*0.25})`;ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    ctx.strokeStyle=`rgba(80,200,240,${alpha})`;ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    if(len>4){const ax=x+nx*len,ay=y+ny*len;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*4-ny*2.5,ay-ny*4+nx*2.5);ctx.lineTo(ax-nx*4+ny*2.5,ay-ny*4-nx*2.5);ctx.closePath();ctx.fillStyle=`rgba(80,200,240,${alpha})`;ctx.fill();}
  }
  ctx.restore();

  // Dipole magnet visual
  const mx=Math.cos(STATE.dipAngle),my=Math.sin(STATE.dipAngle);
  ctx.save();ctx.translate(STATE.dipX,STATE.dipY);ctx.rotate(STATE.dipAngle);
  ctx.fillStyle='rgba(220,60,60,0.7)';ctx.fillRect(0,-10,25,20);
  ctx.fillStyle='rgba(60,100,220,0.7)';ctx.fillRect(-25,-10,25,20);
  ctx.strokeStyle='rgba(150,200,255,0.3)';ctx.lineWidth=1;ctx.strokeRect(-25,-10,50,20);
  ctx.font='bold 10px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#fff';ctx.fillText('N',12,0);ctx.fillText('S',-12,0);
  ctx.restore();

  // Show any closed surface has zero net flux
  const sr=90;
  ctx.strokeStyle='rgba(96,224,238,0.4)';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);
  ctx.beginPath();ctx.arc(STATE.dipX,STATE.dipY,sr,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  ctx.font='bold 10px "JetBrains Mono"';ctx.textAlign='center';
  ctx.fillStyle='rgba(96,224,238,0.7)';
  ctx.fillText('Φ_B = 0 (always)',STATE.dipX,STATE.dipY+sr+16);
  ctx.fillStyle='rgba(96,224,238,0.4)';
  ctx.fillText('Lines in = Lines out',STATE.dipX,STATE.dipY+sr+30);
  document.getElementById('st-info').textContent='∇·B = 0 everywhere';
}

// Tab 2. A circular region carries an oscillating B (drawn as into/out-of-plane
// glyphs). Its time derivative induces a circulating E outside the region; the
// induced magnitude tracks |dB/dt| and the circulation sense follows Lenz's law,
// opposing the change.
/* ── EQ 2: FARADAY'S LAW ── */
function renderFaraday(dt){
  // Advance the drive clock, then read off B, its rate, the induced E magnitude,
  // and the Lenz-law circulation direction.
  STATE.faradayTime+=dt*STATE.faradayRate;
  const cx=CW/2,cy=CH/2,R=STATE.faradayR;
  const Bval=Math.sin(STATE.faradayTime*2); // oscillating B
  const dBdt=Math.cos(STATE.faradayTime*2)*STATE.faradayRate*2; // rate of change
  const Eind=Math.abs(dBdt)*0.5; // induced E magnitude ∝ |dB/dt|
  const Edir=dBdt>0?-1:1; // Lenz's law: opposes change

  // B region (filled circle)
  const bAlpha=Math.abs(Bval)*0.3;
  ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);
  ctx.fillStyle=Bval>0?`rgba(60,150,255,${bAlpha})`:`rgba(255,60,60,${bAlpha})`;
  ctx.fill();
  ctx.strokeStyle='rgba(150,200,255,0.3)';ctx.lineWidth=1;ctx.stroke();

  // B arrows inside (into/out of screen)
  const bStep=25;
  for(let x=cx-R;x<=cx+R;x+=bStep)for(let y=cy-R;y<=cy+R;y+=bStep){
    if((x-cx)**2+(y-cy)**2>R*R)continue;
    ctx.font='bold 12px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=Bval>0?`rgba(100,180,255,${Math.abs(Bval)*0.5})`:`rgba(255,100,100,${Math.abs(Bval)*0.5})`;
    ctx.fillText(Bval>0?'⊙':'⊗',x,y);
  }

  // Induced E field (circulating arrows outside B region)
  if(Eind>0.05){
    ctx.save();ctx.globalCompositeOperation='lighter';
    const nE=20;
    for(let i=0;i<nE;i++){
      const a=i/nE*Math.PI*2;
      for(let rr=R+20;rr<R+100;rr+=30){
        const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr;
        const ux=-Math.sin(a)*Edir,uy=Math.cos(a)*Edir;
        const len=Math.min(15,Eind*12);
        const alpha=Math.min(0.6,Eind*0.5)*(1-(rr-R)/120);
        if(alpha<0.02)continue;
        ctx.strokeStyle=`rgba(100,220,100,${alpha})`;ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+ux*len,y+uy*len);ctx.stroke();
        if(len>4){ctx.beginPath();ctx.moveTo(x+ux*len,y+uy*len);ctx.lineTo(x+ux*len-ux*3-uy*2,y+uy*len-uy*3+ux*2);ctx.lineTo(x+ux*len-ux*3+uy*2,y+uy*len-uy*3-ux*2);ctx.closePath();ctx.fillStyle=`rgba(100,220,100,${alpha})`;ctx.fill();}
      }
    }
    ctx.restore();
  }

  // Labels
  ctx.font='bold 11px "JetBrains Mono"';ctx.textAlign='center';
  ctx.fillStyle=Bval>0?'rgba(100,180,255,0.8)':'rgba(255,100,100,0.8)';
  ctx.fillText(`B = ${Bval.toFixed(2)} ${Bval>0?'(out)':'(in)'}`,cx,cy-R-16);
  ctx.fillStyle='rgba(100,200,100,0.8)';
  ctx.fillText(`|∂B/∂t| = ${Math.abs(dBdt).toFixed(2)} → |E_ind| = ${Eind.toFixed(2)}`,cx,cy+R+20);
  if(Math.abs(dBdt)<0.1){ctx.fillStyle='rgba(255,200,50,0.6)';ctx.fillText('dB/dt ≈ 0 → no induction',cx,cy+R+36);}
  document.getElementById('st-info').textContent=`B=${Bval.toFixed(2)} · dB/dt=${dBdt.toFixed(2)}`;
}

// Tab 3. Two halves of the same law. Part 1: wire currents produce a circulating
// B (the μ₀J term), shown with an arrow grid, streaming tracers that follow the
// field, and an Amperian loop. Part 2: a charging capacitor whose changing E in
// the gap acts as a displacement current (the ε₀∂E/∂t term), circulating B even
// though no charge crosses the gap.
/* ── EQ 3: AMPERE-MAXWELL with tracers + displacement current ── */
function renderAmpere(dt){
  STATE.ampTime=(STATE.ampTime||0)+dt;
  const cx=CW/2,cy=CH/2;

  // ── PART 1: Wire currents → circulating B (μ₀J term) ──
  if(STATE.ampWires.length>0){
    const step=24;
    ctx.save();ctx.globalCompositeOperation='lighter';
    // Dense field arrows
    for(let x=step/2;x<CW;x+=step)for(let y=step/2;y<CH;y+=step){
      const[Bx,By]=totalB_amp(x,y);
      const Bm=Math.sqrt(Bx*Bx+By*By);if(Bm<0.0005)continue;
      const lv=Math.min(1,Math.log10(1+Bm*30)/1.6);
      const len=Math.max(3,lv*16),nx=Bx/Bm,ny=By/Bm;
      const alpha=Math.max(0.08,Math.min(0.6,lv*0.7));
      // Glow
      ctx.strokeStyle=`rgba(180,120,255,${alpha*0.3})`;ctx.lineWidth=3;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
      // Core arrow
      ctx.strokeStyle=`rgba(200,144,255,${alpha})`;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
      if(len>4){const ax=x+nx*len,ay=y+ny*len;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*4-ny*2.5,ay-ny*4+nx*2.5);ctx.lineTo(ax-nx*4+ny*2.5,ay-ny*4-nx*2.5);ctx.closePath();ctx.fillStyle=`rgba(200,144,255,${alpha})`;ctx.fill();}
    }

    // Streaming tracers around each wire
    if(!STATE.ampTracers)STATE.ampTracers=[];
    // Spawn
    for(const w of STATE.ampWires){
      if(Math.random()<0.3){
        const a=Math.random()*Math.PI*2,r=20+Math.random()*80;
        STATE.ampTracers.push({x:w.x+Math.cos(a)*r,y:w.y+Math.sin(a)*r,trail:[],age:0,maxAge:2+Math.random()*2});
      }
    }
    // Update + draw
    const speed=100;
    for(let i=STATE.ampTracers.length-1;i>=0;i--){
      const tr=STATE.ampTracers[i];tr.age+=dt;
      const[Bx,By]=totalB_amp(tr.x,tr.y);
      const Bm=Math.sqrt(Bx*Bx+By*By);
      if(Bm>1e-6){tr.x+=(Bx/Bm)*speed*dt;tr.y+=(By/Bm)*speed*dt;}
      tr.trail.unshift([tr.x,tr.y,Bm]);
      if(tr.trail.length>20)tr.trail.pop();
      if(tr.age>tr.maxAge||tr.x<-10||tr.x>CW+10||tr.y<-10||tr.y>CH+10)STATE.ampTracers.splice(i,1);
      // Draw trail
      const tl=tr.trail.length;if(tl<2)continue;
      const ageA=tr.age<0.1?tr.age/0.1:tr.age>tr.maxAge*0.7?(tr.maxAge-tr.age)/(tr.maxAge*0.3):1;
      for(let s=0;s<tl-1;s++){
        const a0=(1-s/20)*ageA;if(a0<0.02)continue;
        ctx.strokeStyle=`rgba(180,140,255,${a0*0.5})`;ctx.lineWidth=Math.max(0.5,2*a0);
        ctx.beginPath();ctx.moveTo(tr.trail[s][0],tr.trail[s][1]);ctx.lineTo(tr.trail[s+1][0],tr.trail[s+1][1]);ctx.stroke();
      }
    }
    if(STATE.ampTracers.length>400)STATE.ampTracers.splice(0,STATE.ampTracers.length-400);
    ctx.restore();

    // Amperian loop around first wire
    const w0=STATE.ampWires[0];
    const loopR=60;
    ctx.strokeStyle='rgba(255,200,50,0.5)';ctx.lineWidth=2;ctx.setLineDash([5,4]);
    ctx.beginPath();ctx.arc(w0.x,w0.y,loopR,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    // ∮B·dl arrows on loop
    const nLoop=16;
    for(let i=0;i<nLoop;i++){
      const a=i/nLoop*Math.PI*2+STATE.ampTime*0.5;
      const lx=w0.x+Math.cos(a)*loopR,ly=w0.y+Math.sin(a)*loopR;
      const ux=-Math.sin(a)*(w0.I>0?1:-1),uy=Math.cos(a)*(w0.I>0?1:-1);
      ctx.strokeStyle='rgba(255,200,50,0.7)';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+ux*8,ly+uy*8);ctx.stroke();
      ctx.beginPath();ctx.moveTo(lx+ux*8,ly+uy*8);ctx.lineTo(lx+ux*5-uy*2.5,ly+uy*5+ux*2.5);ctx.lineTo(lx+ux*5+uy*2.5,ly+uy*5-ux*2.5);ctx.closePath();
      ctx.fillStyle='rgba(255,200,50,0.7)';ctx.fill();
    }
    ctx.font='bold 11px "JetBrains Mono"';ctx.textAlign='center';
    ctx.fillStyle='rgba(255,200,50,0.8)';
    ctx.fillText('∮ B·dl = μ₀I_enc',w0.x,w0.y-loopR-14);
  }

  // ── PART 2: Displacement current (ε₀ ∂E/∂t term) ──
  // Show a capacitor charging: E grows between plates, B circulates around gap
  const capY=cy+120,capGap=40,plateW=80,plateH=8;
  const capCharge=Math.sin(STATE.ampTime*1.5)*0.8; // oscillating charge
  const dEdt=Math.cos(STATE.ampTime*1.5)*1.5*0.8; // rate of change

  // Plates
  ctx.fillStyle='rgba(180,180,200,0.6)';
  ctx.fillRect(cx-plateW/2,capY-capGap/2-plateH,plateW,plateH);
  ctx.fillRect(cx-plateW/2,capY+capGap/2,plateW,plateH);

  // E field between plates (vertical arrows)
  if(Math.abs(capCharge)>0.05){
    const nE=5,dir=capCharge>0?1:-1;
    const eAlpha=Math.abs(capCharge)*0.6;
    for(let i=0;i<nE;i++){
      const ex=cx-plateW/3+i*(plateW*2/3)/(nE-1);
      ctx.strokeStyle=`rgba(255,144,80,${eAlpha})`;ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(ex,capY-capGap/2+2);ctx.lineTo(ex,capY+capGap/2-2);ctx.stroke();
      // Arrowhead
      const ay2=capY+(dir>0?capGap/2-6:-capGap/2+6);
      ctx.beginPath();ctx.moveTo(ex,capY+(dir>0?capGap/2-2:-capGap/2+2));
      ctx.lineTo(ex-3,ay2);ctx.lineTo(ex+3,ay2);ctx.closePath();
      ctx.fillStyle=`rgba(255,144,80,${eAlpha})`;ctx.fill();
    }
    ctx.font='bold 10px "JetBrains Mono"';ctx.textAlign='center';
    ctx.fillStyle=`rgba(255,144,80,${eAlpha})`;
    ctx.fillText('E',cx+plateW/2+14,capY);
  }

  // Displacement current B circulation (when ∂E/∂t ≠ 0)
  if(Math.abs(dEdt)>0.1){
    ctx.save();ctx.globalCompositeOperation='lighter';
    const bAlpha=Math.min(0.6,Math.abs(dEdt)*0.4);
    const bDir=dEdt>0?1:-1;
    const bR=capGap*0.8;
    const nB=12;
    for(let i=0;i<nB;i++){
      const a=i/nB*Math.PI*2;
      const bx=cx+Math.cos(a)*bR,by=capY+Math.sin(a)*bR;
      const ux=-Math.sin(a)*bDir*6,uy=Math.cos(a)*bDir*6;
      ctx.strokeStyle=`rgba(180,120,255,${bAlpha})`;ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+ux,by+uy);ctx.stroke();
      ctx.beginPath();ctx.moveTo(bx+ux,by+uy);
      ctx.lineTo(bx+ux*0.6-uy*0.3,by+uy*0.6+ux*0.3);
      ctx.lineTo(bx+ux*0.6+uy*0.3,by+uy*0.6-ux*0.3);ctx.closePath();
      ctx.fillStyle=`rgba(180,120,255,${bAlpha})`;ctx.fill();
    }
    ctx.restore();
  }

  // Labels
  ctx.font='bold 10px "JetBrains Mono"';ctx.textAlign='center';
  ctx.fillStyle='rgba(200,200,220,0.6)';
  ctx.fillText('Capacitor Gap',cx,capY-capGap/2-plateH-8);
  ctx.fillStyle='rgba(200,144,255,0.7)';
  ctx.fillText(Math.abs(dEdt)>0.1?'∂E/∂t ≠ 0 → B circulates!':'∂E/∂t ≈ 0 → no B',cx,capY+capGap/2+plateH+16);
  ctx.fillStyle='rgba(200,144,255,0.5)';
  ctx.fillText('(displacement current)',cx,capY+capGap/2+plateH+30);

  // Charge labels on plates
  if(Math.abs(capCharge)>0.1){
    ctx.font='bold 12px "JetBrains Mono"';
    ctx.fillStyle=capCharge>0?'rgba(220,80,80,0.8)':'rgba(80,120,220,0.8)';
    ctx.fillText(capCharge>0?'+ + + +':'− − − −',cx,capY-capGap/2-plateH/2);
    ctx.fillStyle=capCharge>0?'rgba(80,120,220,0.8)':'rgba(220,80,80,0.8)';
    ctx.fillText(capCharge>0?'− − − −':'+ + + +',cx,capY+capGap/2+plateH/2+2);
  }

  // Wires (draw on top)
  for(const w of STATE.ampWires){
    ctx.beginPath();ctx.arc(w.x,w.y,14,0,Math.PI*2);
    ctx.fillStyle='rgba(20,25,40,0.95)';ctx.fill();
    ctx.strokeStyle='rgba(200,144,255,0.6)';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle=w.I>0?'#64c864':'#e05050';
    if(w.I>0){ctx.beginPath();ctx.arc(w.x,w.y,5,0,Math.PI*2);ctx.fill();}
    else{ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(w.x-6,w.y-6);ctx.lineTo(w.x+6,w.y+6);ctx.moveTo(w.x+6,w.y-6);ctx.lineTo(w.x-6,w.y+6);ctx.stroke();}
    ctx.font='bold 12px "JetBrains Mono"';ctx.textAlign='center';ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.fillText((w.I>0?'+':'')+w.I.toFixed(0)+'A',w.x,w.y-22);
    // Direction label
    ctx.font='9px "JetBrains Mono"';ctx.fillStyle='rgba(255,255,255,0.4)';
    ctx.fillText(w.I>0?'out ⊙':'into ⊗',w.x,w.y+22);
  }

  document.getElementById('st-info').textContent=`${STATE.ampWires.length} wires · ∂E/∂t=${Math.abs(dEdt).toFixed(2)} · ∇×B = μ₀(J + ε₀∂E/∂t)`;
}

// Pointer dragging. onDown picks the nearest draggable object for the active tab
// (a charge or the surface, the dipole, or a wire); onMove updates its position;
// release clears the grab. getPos maps a mouse or touch event to canvas pixels.
/* ═══ DRAG ═══ */
let dragObj=null,dragOff=[0,0];
function getPos(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return[t.clientX-r.left,t.clientY-r.top];}
canvas.addEventListener('mousedown',onDown);canvas.addEventListener('touchstart',onDown,{passive:false});
function onDown(e){
  e.preventDefault();const[x,y]=getPos(e);
  if(activeEq===0){
    // Drag charges or gaussian surface
    for(const c of STATE.charges){if((x-c.x)**2+(y-c.y)**2<400){dragObj={type:'charge',ref:c};dragOff=[c.x-x,c.y-y];return;}}
    if((x-STATE.gaussX)**2+(y-STATE.gaussY)**2<(STATE.gaussR+20)**2){dragObj={type:'gauss'};dragOff=[STATE.gaussX-x,STATE.gaussY-y];return;}
  }
  if(activeEq===1){
    if((x-STATE.dipX)**2+(y-STATE.dipY)**2<900){dragObj={type:'dip'};dragOff=[STATE.dipX-x,STATE.dipY-y];return;}
  }
  if(activeEq===3){
    for(const w of STATE.ampWires){if((x-w.x)**2+(y-w.y)**2<400){dragObj={type:'ampw',ref:w};dragOff=[w.x-x,0];return;}}
  }
}
window.addEventListener('mousemove',onMove);window.addEventListener('touchmove',onMove,{passive:false});
function onMove(e){
  if(!dragObj)return;e.preventDefault();const[x,y]=getPos(e);
  switch(dragObj.type){
    case'charge':dragObj.ref.x=x+dragOff[0];dragObj.ref.y=y+dragOff[1];break;
    case'gauss':STATE.gaussX=x+dragOff[0];STATE.gaussY=y+dragOff[1];break;
    case'dip':STATE.dipX=x+dragOff[0];STATE.dipY=y+dragOff[1];break;
    case'ampw':dragObj.ref.x=x+dragOff[0];break;
  }
}
window.addEventListener('mouseup',()=>dragObj=null);
window.addEventListener('touchend',()=>dragObj=null);

// Fit the canvas to its wrapper and scale the backing store by device pixel
// ratio (capped at 2). Reseeding the scene on resize is wired below.
/* ═══ RESIZE ═══ */
function resize(){
  const w=document.getElementById('canvas-wrap');
  CW=w.clientWidth;CH=w.clientHeight;
  if(CW<10)CW=300;if(CH<10)CH=300;
  const dpr=Math.min(devicePixelRatio,2);
  canvas.width=CW*dpr;canvas.height=CH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
if(window.ResizeObserver)new ResizeObserver(()=>{resize();initEq();}).observe(document.getElementById('canvas-wrap'));
else window.addEventListener('resize',()=>{resize();initEq();});

// The animation loop: measure the frame delta, update the FPS readout twice a
// second, and render the active equation.
/* ═══ LOOP ═══ */
let lastTime=0,fpsC=0,fpsT=0;
function loop(time){
  requestAnimationFrame(loop);
  const dt=Math.min((time-lastTime)/1000,0.05);lastTime=time;
  fpsC++;fpsT+=dt;if(fpsT>=0.5){document.getElementById('st-fps').textContent=Math.round(fpsC/fpsT)+' fps';fpsC=0;fpsT=0;}
  render(dt);
}

// Boot after a short delay so layout settles: size the canvas, open the first
// equation, and start the loop.
/* ═══ INIT ═══ */
setTimeout(()=>{
  resize();
  switchEq(0);
  requestAnimationFrame(loop);
},50);
