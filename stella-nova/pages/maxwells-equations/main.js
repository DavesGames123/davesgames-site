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
//  SCENE UNITS
//  --------------------------------------------------------------------------
//      All positions and sizes in STATE are scene units, not pixels. The
//      origin is the center of the free area: the canvas area below the
//      equation card. The scene is SCENE units across. fitScene sets K, the
//      pixels per unit, so the scene fills the free area at any window shape.
//      px(u) and py(v) change units to pixels. toUnits changes pixels to units.
//      Field formulas use units, so the field looks the same at every size.
//
//  SCREEN LAYOUT   (the leading marker is an element id)
//  --------------------------------------------------------------------------
//      #panel       tabs, per-equation controls, About text
//      #canvas-wrap #sim-canvas plus the floating #eq-display card
//      #status-bar  active equation · info · fps
//      #dock        phone only: panel button and equation buttons
//
//  FRAME PIPELINE
//  --------------------------------------------------------------------------
//      loop(t) ─ render(dt) ─ clear + grid ─▶ renderGauss / renderMonopoles /
//                                             renderFaraday / renderAmpere
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      constants ........... "EQ_COLORS"           per-tab colors and labels
//      scale ............... "function fitScene"    free area, K, px, py, font
//      state ............... "const STATE="        all scene state
//      equation display .... "EQUATION DISPLAY"     LaTeX and prose per tab
//      controls ............ "function buildControls"  per-tab control markup
//      tab switch .......... "function switchEq"    change the active equation
//      per-tab init ........ "function initEq"      seed a scene on entry
//      physics ............. "function eField"      field formulas
//      actions ............. "function addCharge"   add/clear scene objects
//      arrow ............... "function arrow"       one field arrow
//      render dispatch ..... "function render"      clear, grid, dispatch
//      Gauss draw .......... "function renderGauss" tab 0
//      monopoles draw ...... "function renderMonopoles"  tab 1
//      Faraday draw ........ "function renderFaraday"    tab 2
//      Ampère draw ......... "function renderAmpere"     tab 3
//      drag ................ "function getPos"      pointer picking and drag
//      phone sheet ......... "function setOpen"     dock, sheet, and grip
//      resize .............. "function resize"      canvas sizing and DPR
//      loop ................ "function loop"        per-frame driver
// ============================================================================
// The drawing canvas and its 2D context. CW/CH are the CSS size; activeEq is the
// index of the currently shown equation (0 to 3).
const canvas=document.getElementById('sim-canvas');
const ctx=canvas.getContext('2d');
let CW=100,CH=100,activeEq=0;

// Per-tab accent color and the label strings shown on the tab, status bar, and
// equation title. Index by activeEq.
const EQ_COLORS=['#ff9050','#60e0ee','#64c864','#c890ff'];
const EQ_NAMES=['I · Gauss\'s Law','II · No Monopoles','III · Faraday\'s Law','IV · Ampère–Maxwell'];
const EQ_TITLES=['GAUSS\'S LAW · ELECTRIC','GAUSS\'S LAW · MAGNETIC','FARADAY\'S LAW · INDUCTION','AMPÈRE–MAXWELL LAW'];
const EQ_ROMAN=['I','II','III','IV'];

/* ═══ SCALE ═══ */
// The scene is SCENE units across. FX, FY are the pixel center of the free
// area. K is pixels per unit. T is the stroke scale: it follows K but does not
// go below 1, so lines stay visible on small screens.
const SCENE=380;
let FX=50,FY=50,K=1,T=1;
const px=u=>FX+u*K, py=v=>FY+v*K;
function toUnits(x,y){return[(x-FX)/K,(y-FY)/K];}
// Find the free area below the equation card and fit the scene in it. If the
// card leaves less than 45% of the height, use the full canvas.
function fitScene(){
  const card=document.getElementById('eq-display');
  const pad=Math.max(10,Math.min(CW,CH)*0.02);
  let top=card?card.offsetTop+card.offsetHeight+pad:pad;
  if(CH-top<CH*0.45)top=pad;
  const w=CW-2*pad,h=CH-top-pad;
  FX=CW/2;FY=top+h/2;
  K=Math.max(0.5,Math.min(w,h)/SCENE);
  T=Math.max(1,K);
}
// Canvas font for a label of base size b px. The size follows K, but it is
// never less than b and never more than 2.4 b.
function font(b,w='bold'){return`${w} ${Math.round(Math.min(b*2.4,Math.max(b,b*K)))}px "JetBrains Mono"`;}

// All scene state, grouped by equation, in scene units. Gauss holds the charge
// list and the Gaussian surface; monopoles hold the dipole pose; Faraday holds
// the drive rate and phase clock; Ampère holds the wire list and its clock.
// Angles are in radians.
const STATE={
  // Eq 0: Gauss - charges
  charges:[],
  gaussR:110,
  gaussX:0,gaussY:0,
  // Eq 1: No monopoles - dipole
  dipX:0,dipY:0,dipAngle:0,dipStr:2,
  // Eq 2: Faraday - changing B
  faradayRate:1.0,faradayTime:0,faradayR:80,
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
// Each slider also writes its value into the .val span next to it.
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
        <div class="mag-row"><span class="mag-row-lbl">Surface</span>
          <input type="range" min="30" max="180" value="${STATE.gaussR}" step="5" aria-label="Surface radius" oninput="STATE.gaussR=+this.value;this.nextElementSibling.textContent=this.value;sg(this)">
          <span class="val">${STATE.gaussR}</span></div>
        <button class="tog-btn warn" onclick="clearCharges()">✕ Clear Charges</button>`;
      about.textContent='Coulomb discovered (1785) that electric force follows an inverse-square law. Gauss showed this means the total flux through any closed surface depends only on enclosed charge — not the surface shape. Place charges and resize the Gaussian surface to verify.';
      break;
    // No monopoles: set the dipole strength and orientation angle.
    case 1:
      area.innerHTML=`
        <div class="mag-row"><span class="mag-row-lbl">Str</span>
          <input type="range" min="0.5" max="5" value="${STATE.dipStr}" step="0.1" aria-label="Dipole strength" oninput="STATE.dipStr=+this.value;this.nextElementSibling.textContent=(+this.value).toFixed(1);sg(this)">
          <span class="val">${STATE.dipStr.toFixed(1)}</span></div>
        <div class="mag-row"><span class="mag-row-lbl">Angle</span>
          <input type="range" min="-3.14" max="3.14" value="${STATE.dipAngle}" step="0.05" aria-label="Dipole angle" oninput="STATE.dipAngle=+this.value;this.nextElementSibling.textContent=(this.value*180/Math.PI).toFixed(0)+'°';sg(this)">
          <span class="val">${(STATE.dipAngle*180/Math.PI).toFixed(0)}°</span></div>`;
      about.textContent='No one has ever found an isolated magnetic pole. Break a magnet in half and you get two smaller magnets, each with both N and S. This equation — ∇·B = 0 — encodes that fact. Gauss (1835) formalized it. The field lines must close, unlike electric field lines which can start on + and end on −.';
      break;
    // Faraday: set how fast B oscillates and the field region radius.
    case 2:
      area.innerHTML=`
        <div class="mag-row"><span class="mag-row-lbl">Rate</span>
          <input type="range" min="-3" max="3" value="${STATE.faradayRate}" step="0.1" aria-label="Rate" oninput="STATE.faradayRate=+this.value;this.nextElementSibling.textContent=(+this.value).toFixed(1);sg(this)">
          <span class="val">${STATE.faradayRate.toFixed(1)}</span></div>
        <div class="mag-row"><span class="mag-row-lbl">Radius</span>
          <input type="range" min="30" max="140" value="${STATE.faradayR}" step="5" aria-label="Radius" oninput="STATE.faradayR=+this.value;this.nextElementSibling.textContent=this.value;sg(this)">
          <span class="val">${STATE.faradayR}</span></div>`;
      about.textContent='Faraday discovered (1831) that a changing magnetic field induces an electric current. He moved magnets through coils and saw current flow. The negative sign means the induced E opposes the change (Lenz\'s law) — nature resists changes in flux. This is how generators, transformers, and induction cooktops work.';
      break;
    // Ampère–Maxwell: add current-carrying wires (current out of or into plane).
    case 3:
      area.innerHTML=`
        <button class="tog-btn on" onclick="addAmpWire(1)">⊙ Add Wire (I out)</button>
        <button class="tog-btn on" onclick="addAmpWire(-1)">⊗ Add Wire (I in)</button>
        <button class="tog-btn warn" onclick="STATE.ampWires=[];STATE.ampTracers=[]">✕ Clear</button>`;
      about.textContent='Ampère showed (1825) that currents create circulating B fields. Maxwell (1862) added the displacement current term ε₀∂E/∂t — without it, the equations are mathematically inconsistent for time-varying fields. This fix predicted electromagnetic waves traveling at c. Light is an electromagnetic wave.';
      break;
  }
  area.querySelectorAll('input[type=range]').forEach(sg);
}

// Switch the active equation: highlight its tab and dock button, update the
// status label, and refresh the display, controls, and scene. The card height
// can change, so fit the scene again.
/* ═══ EQUATION SWITCH ═══ */
function switchEq(idx){
  activeEq=idx;
  document.querySelectorAll('.eq-tab').forEach(t=>t.classList.toggle('active',+t.dataset.eq===idx));
  document.querySelectorAll('#dockEqs button').forEach(t=>t.classList.toggle('on',+t.dataset.eq===idx));
  document.getElementById('st-eq').textContent=EQ_NAMES[idx];
  renderEqDisplay();
  buildControls();
  initEq();
  fitScene();
}

// Seed a tab's scene when it becomes active: place default charges and the
// surface, center the dipole, or place a first wire. Units, so no reseed on
// resize.
/* ═══ INIT PER EQUATION ═══ */
const WIRE_Y=-70;   // the wire row, above the capacitor
function initEq(){
  switch(activeEq){
    case 0:
      if(!STATE.charges.length){
        STATE.charges=[{x:-55,y:0,q:1},{x:55,y:0,q:-1}];
      }
      STATE.gaussX=0;STATE.gaussY=0;
      break;
    case 1:
      STATE.dipX=0;STATE.dipY=0;
      break;
    case 2:
      break;
    case 3:
      if(!STATE.ampWires.length){
        STATE.ampWires=[{x:0,y:WIRE_Y,I:2}];
      }
      break;
  }
}

// Field formulas. All are 2D and use scene units; the numeric constants are
// tuned for visible arrow lengths, not physical units.
/* ═══ PHYSICS ═══ */
// Electric field of a point charge: magnitude q/r² (Coulomb inverse square),
// pointing away from a positive charge. Zero inside r² = 100 to avoid the
// singularity at the charge.
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
// with moment (mx,my) and strength str. Zero near the dipole.
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
  STATE.charges.push({x:(Math.random()-0.5)*120,y:(Math.random()-0.5)*120,q});
}
// Remove all charges.
function clearCharges(){STATE.charges=[];}
// Add a wire with current direction dir, searching outward in rings for a free
// slot so wires do not overlap. Stay inside the visible width.
function addAmpWire(dir){
  const half=Math.max(60,(CW/2-30)/K);
  let x=0,placed=false;
  for(let ring=0;ring<8&&!placed;ring++){
    for(const tx of(ring===0?[0]:[-ring*60,ring*60])){
      if(Math.abs(tx)>half)continue;
      let ok=true;
      for(const w of STATE.ampWires)if(Math.abs(tx-w.x)<50){ok=false;break;}
      if(ok){x=tx;placed=true;break;}
    }
  }
  STATE.ampWires.push({x,y:WIRE_Y,I:dir*2});
}

// Draw one field arrow at pixel (x,y) along unit vector (nx,ny), len pixels
// long. rgb is the core color. glow > 0 adds a wide faint stroke under it.
/* ═══ ARROW ═══ */
function arrow(x,y,nx,ny,len,rgb,alpha,glow){
  const ex=x+nx*len,ey=y+ny*len;
  if(glow>0){
    ctx.strokeStyle=`rgba(${rgb},${alpha*glow})`;ctx.lineWidth=3*T;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.stroke();
  }
  ctx.strokeStyle=`rgba(${rgb},${alpha})`;ctx.lineWidth=1.5*T;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.stroke();
  const h=4*T,s=2.5*T;
  if(len>h){
    ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-nx*h-ny*s,ey-ny*h+nx*s);ctx.lineTo(ex-nx*h+ny*s,ey-ny*h-nx*s);ctx.closePath();
    ctx.fillStyle=`rgba(${rgb},${alpha})`;ctx.fill();
  }
}
// Visit an arrow grid that covers the canvas. step is in units. The grid is
// on the scene origin, so it does not move when the window changes shape.
// fn gets the pixel point and the matching unit point.
function eachGridPoint(step,fn){
  const sp=step*K;
  const x0=((FX-sp/2)%sp+sp)%sp,y0=((FY-sp/2)%sp+sp)%sp;
  for(let x=x0;x<CW;x+=sp)for(let y=y0;y<CH;y+=sp)fn(x,y,(x-FX)/K,(y-FY)/K);
}

// Per-frame draw: clear, paint the background grid, then dispatch to the active
// equation's own renderer.
/* ═══ RENDER ═══ */
function render(dt){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.restore();
  ctx.fillStyle='#0e1118';ctx.fillRect(0,0,CW,CH);
  // Grid, 50 units apart, on the scene origin.
  const g=50*K;
  ctx.strokeStyle='rgba(150,200,255,0.03)';ctx.lineWidth=1;
  ctx.beginPath();
  for(let x=FX%g;x<CW;x+=g){ctx.moveTo(x,0);ctx.lineTo(x,CH);}
  for(let y=FY%g;y<CH;y+=g){ctx.moveTo(0,y);ctx.lineTo(CW,y);}
  ctx.stroke();

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
  ctx.save();ctx.globalCompositeOperation='lighter';
  // E field arrows
  eachGridPoint(28,(x,y,ux,uy)=>{
    const[Ex,Ey]=totalE(ux,uy);
    const Em=Math.sqrt(Ex*Ex+Ey*Ey);if(Em<0.01)return;
    const lv=Math.min(1,Math.log10(1+Em*1.5)/1.5);
    const len=Math.max(3,lv*16)*K;
    arrow(x,y,Ex/Em,Ey/Em,len,'255,150,70',Math.max(0.08,lv*0.6),0.25);
  });
  ctx.restore();

  // Charges
  const gx=px(STATE.gaussX),gy=py(STATE.gaussY),gR=STATE.gaussR*K;
  for(const c of STATE.charges){
    ctx.beginPath();ctx.arc(px(c.x),py(c.y),Math.max(12,14*K),0,Math.PI*2);
    ctx.fillStyle=c.q>0?'rgba(220,60,60,0.8)':'rgba(60,100,220,0.8)';ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.lineWidth=1.5*T;ctx.stroke();
    ctx.font=font(16);ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#fff';ctx.fillText(c.q>0?'+':'−',px(c.x),py(c.y));
  }

  // Gaussian surface
  ctx.strokeStyle='rgba(255,200,50,0.6)';ctx.lineWidth=2*T;ctx.setLineDash([6*T,4*T]);
  ctx.beginPath();ctx.arc(gx,gy,gR,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);
  ctx.font=font(12);ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillStyle='rgba(255,200,50,0.75)';ctx.fillText('Gaussian Surface',gx,gy-gR-10*T);

  // Compute enclosed charge
  let Qenc=0;
  for(const c of STATE.charges){
    const dx=c.x-STATE.gaussX,dy=c.y-STATE.gaussY;
    if(dx*dx+dy*dy<STATE.gaussR*STATE.gaussR) Qenc+=c.q;
  }
  // Flux arrows on surface
  const nArrows=24;
  ctx.lineWidth=2*T;
  for(let i=0;i<nArrows;i++){
    const a=i/nArrows*Math.PI*2;
    const nr=Math.cos(a),nt=Math.sin(a);
    const[Ex,Ey]=totalE(STATE.gaussX+nr*STATE.gaussR,STATE.gaussY+nt*STATE.gaussR);
    const flux=Ex*nr+Ey*nt; // E·n̂
    const len=Math.min(20,Math.abs(flux)*3)*K;
    const dir=flux>0?1:-1;
    const sx=gx+nr*gR,sy=gy+nt*gR;
    ctx.strokeStyle=flux>0?'rgba(255,150,50,0.6)':'rgba(50,150,255,0.6)';
    ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+nr*len*dir,sy+nt*len*dir);ctx.stroke();
  }

  const lh=Math.max(16,16*K);
  ctx.font=font(14);ctx.textAlign='center';
  ctx.fillStyle='rgba(255,200,50,0.95)';
  ctx.fillText(`Q_enc = ${Qenc>0?'+':''}${Qenc}`,gx,gy+gR+lh+4);
  ctx.fillStyle='rgba(255,200,50,0.6)';
  ctx.fillText(`Φ = Q/ε₀ ${Qenc===0?'= 0':'≠ 0'}`,gx,gy+gR+2*lh+6);
  document.getElementById('st-info').textContent=`Q_enc=${Qenc} · ${STATE.charges.length} charges`;
}

// Tab 1. Draw the dipole B field as arrows, the bar-magnet glyph, and a closed
// surface annotated to show its net magnetic flux is always zero: field lines
// close on themselves, so every line entering the surface also leaves it.
/* ── EQ 1: NO MONOPOLES ── */
function renderMonopoles(dt){
  ctx.save();ctx.globalCompositeOperation='lighter';
  eachGridPoint(24,(x,y,ux,uy)=>{
    const[Bx,By]=totalB_dip(ux,uy);
    const Bm=Math.sqrt(Bx*Bx+By*By);if(Bm<0.001)return;
    const lv=Math.min(1,Math.log10(1+Bm*3)/1.6);
    const len=Math.max(3,lv*14)*K;
    arrow(x,y,Bx/Bm,By/Bm,len,'80,200,240',Math.max(0.08,lv*0.6),0.25);
  });
  ctx.restore();

  // Dipole magnet visual, 70 by 28 units.
  const dx=px(STATE.dipX),dy=py(STATE.dipY);
  ctx.save();ctx.translate(dx,dy);ctx.rotate(STATE.dipAngle);ctx.scale(K,K);
  ctx.fillStyle='rgba(220,60,60,0.75)';ctx.fillRect(0,-14,35,28);
  ctx.fillStyle='rgba(60,100,220,0.75)';ctx.fillRect(-35,-14,35,28);
  ctx.strokeStyle='rgba(150,200,255,0.35)';ctx.lineWidth=1.2;ctx.strokeRect(-35,-14,70,28);
  ctx.font='bold 15px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#fff';ctx.fillText('N',17,1);ctx.fillText('S',-17,1);
  ctx.restore();

  // Show any closed surface has zero net flux
  const sr=125*K;
  ctx.strokeStyle='rgba(96,224,238,0.45)';ctx.lineWidth=1.5*T;ctx.setLineDash([5*T,4*T]);
  ctx.beginPath();ctx.arc(dx,dy,sr,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  const lh=Math.max(16,16*K);
  ctx.font=font(14);ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillStyle='rgba(96,224,238,0.85)';
  ctx.fillText('Φ_B = 0 (always)',dx,dy+sr+lh+4);
  ctx.font=font(12);ctx.fillStyle='rgba(96,224,238,0.6)';
  ctx.fillText('Lines in = Lines out',dx,dy+sr+2*lh+6);
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
  const cx=FX,cy=FY,Ru=STATE.faradayR,R=Ru*K;
  const Bval=Math.sin(STATE.faradayTime*2); // oscillating B
  const dBdt=Math.cos(STATE.faradayTime*2)*STATE.faradayRate*2; // rate of change
  const Eind=Math.abs(dBdt)*0.5; // induced E magnitude ∝ |dB/dt|
  const Edir=dBdt>0?-1:1; // Lenz's law: opposes change

  // B region (filled circle)
  const bAlpha=Math.abs(Bval)*0.3;
  ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);
  ctx.fillStyle=Bval>0?`rgba(60,150,255,${bAlpha})`:`rgba(255,60,60,${bAlpha})`;
  ctx.fill();
  ctx.strokeStyle='rgba(150,200,255,0.3)';ctx.lineWidth=T;ctx.stroke();

  // B glyphs inside (into/out of screen), 25 units apart.
  const bStep=25;
  ctx.font=`bold ${Math.max(10,Math.round(13*K))}px "JetBrains Mono"`;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=Bval>0?`rgba(100,180,255,${Math.abs(Bval)*0.5})`:`rgba(255,100,100,${Math.abs(Bval)*0.5})`;
  const n=Math.floor(Ru/bStep);
  for(let i=-n;i<=n;i++)for(let j=-n;j<=n;j++){
    if((i*i+j*j)*bStep*bStep>Ru*Ru)continue;
    ctx.fillText(Bval>0?'⊙':'⊗',cx+i*bStep*K,cy+j*bStep*K);
  }

  // Induced E field (circulating arrows outside B region)
  if(Eind>0.05){
    ctx.save();ctx.globalCompositeOperation='lighter';
    const nE=24;
    for(let i=0;i<nE;i++){
      const a=i/nE*Math.PI*2;
      for(let rr=Ru+20;rr<Ru+110;rr+=30){
        const x=cx+Math.cos(a)*rr*K,y=cy+Math.sin(a)*rr*K;
        const ux=-Math.sin(a)*Edir,uy=Math.cos(a)*Edir;
        // A minimum shaft of 6 units, so a weak field still shows its direction.
        const len=(6+Math.min(12,Eind*12))*K;
        const alpha=Math.min(0.75,0.15+Eind*0.55)*(1-(rr-Ru)/130);
        if(alpha<0.02)continue;
        arrow(x,y,ux,uy,len,'100,220,100',alpha,0);
      }
    }
    ctx.restore();
  }

  // Labels
  const lh=Math.max(16,16*K);
  ctx.font=font(14);ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillStyle=Bval>0?'rgba(100,180,255,0.9)':'rgba(255,100,100,0.9)';
  ctx.fillText(`B = ${Bval.toFixed(2)} ${Bval>0?'(out)':'(in)'}`,cx,cy-R-lh*0.8);
  ctx.fillStyle='rgba(100,200,100,0.9)';
  ctx.fillText(`|∂B/∂t| = ${Math.abs(dBdt).toFixed(2)} → |E_ind| = ${Eind.toFixed(2)}`,cx,cy+R+lh*1.4);
  if(Math.abs(dBdt)<0.1){ctx.fillStyle='rgba(255,200,50,0.7)';ctx.fillText('dB/dt ≈ 0 → no induction',cx,cy+R+lh*2.5);}
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
  const lh=Math.max(15,15*K);

  // ── PART 1: Wire currents → circulating B (μ₀J term) ──
  if(STATE.ampWires.length>0){
    ctx.save();ctx.globalCompositeOperation='lighter';
    // Dense field arrows
    eachGridPoint(24,(x,y,ux,uy)=>{
      const[Bx,By]=totalB_amp(ux,uy);
      const Bm=Math.sqrt(Bx*Bx+By*By);if(Bm<0.0005)return;
      const lv=Math.min(1,Math.log10(1+Bm*30)/1.6);
      const len=Math.max(3,lv*16)*K;
      arrow(x,y,Bx/Bm,By/Bm,len,'200,144,255',Math.max(0.08,Math.min(0.6,lv*0.7)),0.3);
    });

    // Streaming tracers around each wire, in units.
    if(!STATE.ampTracers)STATE.ampTracers=[];
    for(const w of STATE.ampWires){
      if(Math.random()<0.3){
        const a=Math.random()*Math.PI*2,r=20+Math.random()*90;
        STATE.ampTracers.push({x:w.x+Math.cos(a)*r,y:w.y+Math.sin(a)*r,trail:[],age:0,maxAge:2+Math.random()*2});
      }
    }
    const speed=100;
    const [uL,uT]=toUnits(-10,-10),[uR,uB]=toUnits(CW+10,CH+10);
    for(let i=STATE.ampTracers.length-1;i>=0;i--){
      const tr=STATE.ampTracers[i];tr.age+=dt;
      const[Bx,By]=totalB_amp(tr.x,tr.y);
      const Bm=Math.sqrt(Bx*Bx+By*By);
      if(Bm>1e-6){tr.x+=(Bx/Bm)*speed*dt;tr.y+=(By/Bm)*speed*dt;}
      tr.trail.unshift([tr.x,tr.y]);
      if(tr.trail.length>20)tr.trail.pop();
      if(tr.age>tr.maxAge||tr.x<uL||tr.x>uR||tr.y<uT||tr.y>uB){STATE.ampTracers.splice(i,1);continue;}
      // Draw trail
      const tl=tr.trail.length;if(tl<2)continue;
      const ageA=tr.age<0.1?tr.age/0.1:tr.age>tr.maxAge*0.7?(tr.maxAge-tr.age)/(tr.maxAge*0.3):1;
      for(let s=0;s<tl-1;s++){
        const a0=(1-s/20)*ageA;if(a0<0.02)continue;
        ctx.strokeStyle=`rgba(180,140,255,${a0*0.5})`;ctx.lineWidth=Math.max(0.5,2*a0)*T;
        ctx.beginPath();ctx.moveTo(px(tr.trail[s][0]),py(tr.trail[s][1]));ctx.lineTo(px(tr.trail[s+1][0]),py(tr.trail[s+1][1]));ctx.stroke();
      }
    }
    if(STATE.ampTracers.length>400)STATE.ampTracers.splice(0,STATE.ampTracers.length-400);
    ctx.restore();

    // Amperian loop around first wire
    const w0=STATE.ampWires[0],wx=px(w0.x),wy=py(w0.y);
    const loopR=62*K;
    ctx.strokeStyle='rgba(255,200,50,0.55)';ctx.lineWidth=2*T;ctx.setLineDash([5*T,4*T]);
    ctx.beginPath();ctx.arc(wx,wy,loopR,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    // ∮B·dl arrows on loop
    const nLoop=16,cw=w0.I>0?1:-1,al=8*K,ah=3*K,aw=2.5*K;
    ctx.fillStyle='rgba(255,200,50,0.75)';ctx.strokeStyle='rgba(255,200,50,0.75)';ctx.lineWidth=2*T;
    for(let i=0;i<nLoop;i++){
      const a=i/nLoop*Math.PI*2+STATE.ampTime*0.5;
      const lx=wx+Math.cos(a)*loopR,ly=wy+Math.sin(a)*loopR;
      const ux=-Math.sin(a)*cw,uy=Math.cos(a)*cw;
      ctx.beginPath();ctx.moveTo(lx,ly);ctx.lineTo(lx+ux*al,ly+uy*al);ctx.stroke();
      ctx.beginPath();ctx.moveTo(lx+ux*al,ly+uy*al);ctx.lineTo(lx+ux*(al-ah)-uy*aw,ly+uy*(al-ah)+ux*aw);ctx.lineTo(lx+ux*(al-ah)+uy*aw,ly+uy*(al-ah)-ux*aw);ctx.closePath();
      ctx.fill();
    }
    ctx.font=font(13);ctx.textAlign='center';ctx.textBaseline='alphabetic';
    ctx.fillStyle='rgba(255,200,50,0.9)';
    ctx.fillText('∮ B·dl = μ₀I_enc',wx,wy-loopR-lh*0.6);
  }

  // ── PART 2: Displacement current (ε₀ ∂E/∂t term) ──
  // Show a capacitor charging: E grows between plates, B circulates around gap.
  // The capacitor sits below the wire row, in units.
  const cx=px(0),capY=py(105),capGap=46*K,plateW=100*K,plateH=9*K;
  const capCharge=Math.sin(STATE.ampTime*1.5)*0.8; // oscillating charge
  const dEdt=Math.cos(STATE.ampTime*1.5)*1.5*0.8; // rate of change

  // Plates
  ctx.fillStyle='rgba(180,180,200,0.6)';
  ctx.fillRect(cx-plateW/2,capY-capGap/2-plateH,plateW,plateH);
  ctx.fillRect(cx-plateW/2,capY+capGap/2,plateW,plateH);

  // E field between plates (vertical arrows)
  if(Math.abs(capCharge)>0.05){
    const nE=5,dir=capCharge>0?1:-1;
    const eAlpha=Math.abs(capCharge)*0.7;
    const hh=4*K,hw=3*K;
    ctx.strokeStyle=`rgba(255,144,80,${eAlpha})`;ctx.fillStyle=`rgba(255,144,80,${eAlpha})`;ctx.lineWidth=2*T;
    for(let i=0;i<nE;i++){
      const ex=cx-plateW/3+i*(plateW*2/3)/(nE-1);
      ctx.beginPath();ctx.moveTo(ex,capY-capGap/2+2*K);ctx.lineTo(ex,capY+capGap/2-2*K);ctx.stroke();
      const tip=capY+dir*(capGap/2-2*K),ay2=tip-dir*hh;
      ctx.beginPath();ctx.moveTo(ex,tip);ctx.lineTo(ex-hw,ay2);ctx.lineTo(ex+hw,ay2);ctx.closePath();ctx.fill();
    }
    ctx.font=font(13);ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('E',cx+plateW/2+16*K,capY);
  }

  // Displacement current B circulation (when ∂E/∂t ≠ 0)
  if(Math.abs(dEdt)>0.1){
    ctx.save();ctx.globalCompositeOperation='lighter';
    const bAlpha=Math.min(0.7,Math.abs(dEdt)*0.45);
    const bDir=dEdt>0?1:-1;
    const bR=capGap*0.9;
    const nB=14;
    ctx.strokeStyle=`rgba(180,120,255,${bAlpha})`;ctx.fillStyle=`rgba(180,120,255,${bAlpha})`;ctx.lineWidth=2*T;
    for(let i=0;i<nB;i++){
      const a=i/nB*Math.PI*2;
      const bx=cx+Math.cos(a)*bR,by=capY+Math.sin(a)*bR;
      const ux=-Math.sin(a)*bDir*7*K,uy=Math.cos(a)*bDir*7*K;
      ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx+ux,by+uy);ctx.stroke();
      ctx.beginPath();ctx.moveTo(bx+ux,by+uy);
      ctx.lineTo(bx+ux*0.6-uy*0.3,by+uy*0.6+ux*0.3);
      ctx.lineTo(bx+ux*0.6+uy*0.3,by+uy*0.6-ux*0.3);ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }

  // Labels
  ctx.font=font(12);ctx.textAlign='center';ctx.textBaseline='alphabetic';
  ctx.fillStyle='rgba(200,200,220,0.7)';
  ctx.fillText('Capacitor Gap',cx,capY-capGap/2-plateH-lh*0.6);
  ctx.font=font(13);
  ctx.fillStyle='rgba(200,144,255,0.85)';
  ctx.fillText(Math.abs(dEdt)>0.1?'∂E/∂t ≠ 0 → B circulates!':'∂E/∂t ≈ 0 → no B',cx,capY+capGap/2+plateH+lh*1.3);
  ctx.font=font(12);
  ctx.fillStyle='rgba(200,144,255,0.6)';
  ctx.fillText('(displacement current)',cx,capY+capGap/2+plateH+lh*2.4);

  // Charge labels on plates
  if(Math.abs(capCharge)>0.1){
    ctx.font=`bold ${Math.max(11,Math.round(12*K))}px "JetBrains Mono"`;ctx.textBaseline='middle';
    ctx.fillStyle=capCharge>0?'rgba(255,120,120,0.9)':'rgba(120,160,255,0.9)';
    ctx.fillText(capCharge>0?'+ + + +':'− − − −',cx,capY-capGap/2-plateH/2);
    ctx.fillStyle=capCharge>0?'rgba(120,160,255,0.9)':'rgba(255,120,120,0.9)';
    ctx.fillText(capCharge>0?'− − − −':'+ + + +',cx,capY+capGap/2+plateH/2);
  }

  // Wires (draw on top)
  const wr=Math.max(14,16*K),m=wr*0.42;
  for(const w of STATE.ampWires){
    const x=px(w.x),y=py(w.y);
    ctx.beginPath();ctx.arc(x,y,wr,0,Math.PI*2);
    ctx.fillStyle='rgba(20,25,40,0.95)';ctx.fill();
    ctx.strokeStyle='rgba(200,144,255,0.65)';ctx.lineWidth=2*T;ctx.stroke();
    ctx.fillStyle=w.I>0?'#64c864':'#e05050';
    if(w.I>0){ctx.beginPath();ctx.arc(x,y,wr*0.36,0,Math.PI*2);ctx.fill();}
    else{ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=2.5*T;ctx.beginPath();ctx.moveTo(x-m,y-m);ctx.lineTo(x+m,y+m);ctx.moveTo(x+m,y-m);ctx.lineTo(x-m,y+m);ctx.stroke();}
    ctx.font=font(13);ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle='rgba(255,255,255,0.8)';
    ctx.fillText((w.I>0?'+':'')+w.I.toFixed(0)+'A',x,y-wr-lh*0.45);
    // Direction label
    ctx.font=font(11,'normal');ctx.fillStyle='rgba(255,255,255,0.55)';ctx.textBaseline='top';
    ctx.fillText(w.I>0?'out ⊙':'into ⊗',x,y+wr+lh*0.3);
  }

  document.getElementById('st-info').textContent=`${STATE.ampWires.length} wires · ∂E/∂t=${Math.abs(dEdt).toFixed(2)} · ∇×B = μ₀(J + ε₀∂E/∂t)`;
}

// Pointer dragging. onDown picks the nearest draggable object for the active tab
// (a charge or the surface, the dipole, or a wire); onMove updates its position;
// release clears the grab. getPos maps a mouse or touch event to scene units.
// The pick radius is at least 24px, so a finger can hit small objects.
/* ═══ DRAG ═══ */
let dragObj=null,dragOff=[0,0];
function getPos(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return toUnits(t.clientX-r.left,t.clientY-r.top);}
canvas.addEventListener('mousedown',onDown);canvas.addEventListener('touchstart',onDown,{passive:false});
function onDown(e){
  e.preventDefault();const[x,y]=getPos(e);
  const hit=(u)=>Math.max(u,24/K)**2;
  if(activeEq===0){
    // Drag charges or gaussian surface
    for(const c of STATE.charges){if((x-c.x)**2+(y-c.y)**2<hit(20)){dragObj={type:'charge',ref:c};dragOff=[c.x-x,c.y-y];return;}}
    if((x-STATE.gaussX)**2+(y-STATE.gaussY)**2<(STATE.gaussR+20)**2){dragObj={type:'gauss'};dragOff=[STATE.gaussX-x,STATE.gaussY-y];return;}
  }
  if(activeEq===1){
    if((x-STATE.dipX)**2+(y-STATE.dipY)**2<hit(40)){dragObj={type:'dip'};dragOff=[STATE.dipX-x,STATE.dipY-y];return;}
  }
  if(activeEq===3){
    for(const w of STATE.ampWires){if((x-w.x)**2+(y-w.y)**2<hit(22)){dragObj={type:'ampw',ref:w};dragOff=[w.x-x,0];return;}}
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

// Phone sheet. The dock button opens and closes the panel. A tap on the grip
// switches half and full height. A drag up gives full height. A drag down
// gives half height, then closes. On wide screens the panel is always open.
/* ═══ PHONE SHEET ═══ */
const PHONE_Q=window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const panel=document.getElementById('panel'),dockPanel=document.getElementById('dockPanel');
function setOpen(open){
  panel.classList.toggle('open',open);
  if(!open)panel.classList.remove('full');
  dockPanel.classList.toggle('on',open);
  dockPanel.setAttribute('aria-expanded',String(open));
}
dockPanel.addEventListener('click',()=>setOpen(!panel.classList.contains('open')));
setOpen(false);
PHONE_Q.addEventListener('change',()=>setOpen(false));
{
  const grip=document.getElementById('sheetGrip');
  let gripY=null;
  grip.addEventListener('pointerdown',e=>{gripY=e.clientY;try{grip.setPointerCapture(e.pointerId);}catch(x){}});
  grip.addEventListener('pointerup',e=>{
    if(gripY===null)return;
    const dy=e.clientY-gripY;gripY=null;
    if(Math.abs(dy)<8)panel.classList.toggle('full');
    else if(dy<-40)panel.classList.add('full');
    else if(dy>40){if(panel.classList.contains('full'))panel.classList.remove('full');else setOpen(false);}
  });
  grip.addEventListener('pointercancel',()=>{gripY=null;});
}

// Fit the canvas to its wrapper and scale the backing store by device pixel
// ratio (capped at 2). Then fit the scene to the free area. A change to the
// wrapper or to the card height calls resize again.
/* ═══ RESIZE ═══ */
function resize(){
  const w=document.getElementById('canvas-wrap');
  CW=w.clientWidth;CH=w.clientHeight;
  if(CW<10)CW=300;if(CH<10)CH=300;
  const dpr=Math.min(devicePixelRatio,2);
  canvas.width=Math.round(CW*dpr);canvas.height=Math.round(CH*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  fitScene();
}
if(window.ResizeObserver){
  const ro=new ResizeObserver(()=>resize());
  ro.observe(document.getElementById('canvas-wrap'));
  ro.observe(document.getElementById('eq-display'));
}else window.addEventListener('resize',resize);

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
// equation, and start the loop. Fit again when the web fonts load, because
// the card height changes.
/* ═══ INIT ═══ */
setTimeout(()=>{
  resize();
  switchEq(0);
  requestAnimationFrame(loop);
},50);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>fitScene());
