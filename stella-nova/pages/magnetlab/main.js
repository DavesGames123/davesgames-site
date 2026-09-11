// ============================================================================
//  MAGNETLAB  ·  2D magnetic field simulator  (canvas 2D)
// ----------------------------------------------------------------------------
//  Every magnet is a rigid body carrying a set of point dipoles ("poles"). The
//  field at any point is the vector sum of each pole's dipole field. Massless
//  tracer particles ride that field like iron filings, and dynamic magnets feel
//  the force and torque the field exerts on their own poles. All of it draws to
//  one canvas through a pan/zoom camera transform.
//
//  FIELD MODEL   (one pole, in the pole's local frame)
//  --------------------------------------------------------------------------
//      B(r) = FIELD_SCALE * ( 3(m·r̂)r̂ − m ) / r³        point dipole
//
//         S ●━━━▶━━━ N        m points S→N; field loops N back to S
//          ╲   ╱ ╲   ╱
//           ╲ ╱   ╲ ╱         tracers follow B̂, biased to spawn near tips
//            ●     ●
//
//  SIMULATION LOOP   (loop(), 60 Hz via requestAnimationFrame)
//  --------------------------------------------------------------------------
//      integrateMagnets()  spin, then force+torque, then collisions
//      updateTracers(dt)   step each tracer along B̂, respawn when dead
//      render()            clear ▶ camera transform ▶ grid ▶ layers ▶ magnets
//
//  COORDINATE FRAMES
//      screen px ── screenToWorld() ──▶ world px ── camera transform ──▶ canvas
//      CW / CH   = logical CSS-pixel size of the canvas (physics units)
//      CAM.x/y   = world offset from centre;  CAM.zoom = scale factor
//
//  SECTION MAP   (jump with grep -n "<anchor>" main.js)
//  --------------------------------------------------------------------------
//      state ................ "const SIM ="        sim flags + tuning
//      camera / viewport .... "CAMERA / VIEWPORT"   screen↔world mapping
//      magnet factory ....... "MAGNET FACTORY"      pole layouts per type
//      physics .............. "PHYSICS"             field, forces, collisions
//      tracers .............. "TRACERS"             spawn + step iron filings
//      colors ............... "COLORS"              field magnitude → RGB ramp
//      render ............... "function render"     the per-frame draw
//      magnet drawing ....... "function renderMagnets"  per-type glyphs
//      ui wiring ............ "UI WIRING"           panel + card controls
//      drag + zoom .......... "DRAG + ZOOM"         mouse/touch input
//      resize ............... "function resize"     ResizeObserver sizing
//      loop ................. "function loop"        the frame driver
//      init ................. "INIT"                first magnet + start
// ============================================================================

/* ════════════════════════════════════════════════════════════
   MAGNETLAB — 2D MAGNETIC FIELD SIMULATOR
   CW / CH = logical CSS-pixel dimensions of the canvas.
   All physics, spawning, hit-testing, and rendering use CW/CH.
   ════════════════════════════════════════════════════════════ */

// The canvas and its 2D context. CW/CH track the wrapper's CSS size and are the
// unit system for all physics, spawning, hit-testing, and rendering.
const canvas = document.getElementById('sim-canvas');
const ctx = canvas.getContext('2d');
let CW = 100, CH = 100;

// The one mutable state bag: display toggles, tracer tuning, the physics
// timestep, velocity damping factors, and which magnet is selected.
const SIM = {
  playing:true, showTracers:true, showArrows:true, showHeatmap:false,
  tracerCount:2500, tracerSpeed:1.5, tracerTrail:40,
  dt:1/60, damping:0.97, angDamping:0.85, selectedId:-1,
};

// The scene: all magnets, all tracer particles, and a monotonic id counter.
let magnets=[], tracers=[], nextId=0;

/* ═══ CAMERA / VIEWPORT ═══ */
const CAM = { x:0, y:0, zoom:1 }; // x,y = world offset from center, zoom = scale factor

// Invert the camera transform: map a screen pixel back to a world coordinate.
// Used by input handling and by the spawn/visibility tests below.
function screenToWorld(sx, sy){
  return [(sx - CW/2) / CAM.zoom + CW/2 - CAM.x,
          (sy - CH/2) / CAM.zoom + CH/2 - CAM.y];
}

// World-space rectangle currently on screen; tracers respawn and cull against
// this so off-screen work is avoided at any zoom.
function visibleBounds(){
  const [x0,y0]=screenToWorld(0,0);
  const [x1,y1]=screenToWorld(CW,CH);
  return {x0,y0,x1,y1};
}

/* ═══ MAGNET FACTORY ═══ */
// Build one magnet of the given type at (x,y). Every type shares the same rigid
// body fields; the switch fills in size, mass, inertia, and the pole layout.
// A pole is {dx,dy,mx,my}: an offset in the body frame and a dipole-moment
// vector. angle starts at -PI/2 so bar-like magnets point up on spawn.
function createMagnet(type,x,y){
  const m={id:nextId++,type,x,y,angle:-Math.PI/2,strength:1.0,spin:0,fixed:true,vx:0,vy:0,va:0,mass:1,inertia:1};
  switch(type){
    // Bar magnet: five aligned poles in a row make a smooth two-ended field.
    case 'bar':
      m.w=100;m.h=30;m.poles=[];
      for(let i=-2;i<=2;i++) m.poles.push({dx:i*20,dy:0,mx:1,my:0});
      m.mass=2;m.inertia=2;break;
    // Dipole: a single point pole; the simplest field source.
    case 'dipole':
      m.w=36;m.h=36;m.poles=[{dx:0,dy:0,mx:1,my:0}];
      m.mass=0.5;m.inertia=0.3;break;
    // Solenoid: a denser, stronger row of poles, standing in for a coil.
    case 'solenoid':
      m.w=80;m.h=50;m.poles=[];m.strength=1.5;
      for(let i=-3;i<=3;i++) m.poles.push({dx:i*10,dy:0,mx:2,my:0});
      m.mass=3;m.inertia=3;break;
    // Horseshoe: poles trace a U so both tips point the same way, concentrating
    // the field in the gap between the arms.
    case 'horseshoe':
      m.w=60;m.h=70;m.poles=[
        {dx:25,dy:-30,mx:0,my:-1},{dx:25,dy:-15,mx:0.5,my:-0.5},
        {dx:25,dy:0,mx:1,my:0},{dx:25,dy:15,mx:0.5,my:0.5},
        {dx:15,dy:28,mx:0,my:1},{dx:0,dy:32,mx:-0.3,my:1},{dx:-15,dy:28,mx:0,my:1},
        {dx:-25,dy:15,mx:-0.5,my:0.5},{dx:-25,dy:0,mx:-1,my:0},{dx:-25,dy:-15,mx:-0.5,my:-0.5},
        {dx:-25,dy:-30,mx:0,my:-1}
      ];m.mass=2.5;m.inertia=2.5;break;
    // Buzzer: a dense disc of aligned poles, a strong compact dipole.
    case 'buzzer':
      m.w=44;m.h=44;m.poles=[{dx:0,dy:0,mx:1.5,my:0}];
      // Dense disc: center + 6 in a ring, all aligned
      for(let i=0;i<6;i++){const a=i*Math.PI/3;m.poles.push({dx:Math.cos(a)*14,dy:Math.sin(a)*14,mx:1,my:0});}
      m.mass=1.5;m.inertia=1.2;break;
    // Ring: eight poles pointing radially outward, so the field blooms outward
    // all around rather than from two ends.
    case 'ring':
      m.w=56;m.h=56;m.poles=[];
      // 8 dipoles pointing radially outward
      for(let i=0;i<8;i++){const a=i*Math.PI/4;const cx=Math.cos(a),sy=Math.sin(a);
        m.poles.push({dx:cx*22,dy:sy*22,mx:cx*1.2,my:sy*1.2});}
      m.mass=2;m.inertia=2;break;
    // Quadrupole: two N and two S poles at the cardinal points, giving the
    // four-lobed field that focuses charged beams in accelerators.
    case 'quadrupole':
      m.w=50;m.h=50;m.poles=[
        {dx:22,dy:0,mx:1.5,my:0},   // N right
        {dx:0,dy:22,mx:0,my:1.5},   // N down
        {dx:-22,dy:0,mx:-1.5,my:0}, // S left (points inward = N right repels)
        {dx:0,dy:-22,mx:0,my:-1.5}  // S up
      ];m.mass=2;m.inertia=2;m.strength=1.2;break;
    // Halbach array: each pole is rotated 90 degrees from the last, which
    // reinforces the field on one face and cancels it on the other.
    case 'halbach':
      m.w=130;m.h=30;m.poles=[];
      // Each dipole rotated 90° from previous → field concentrates on one side
      for(let i=0;i<6;i++){
        const a=i*Math.PI/2; // 0, 90, 180, 270, 0, 90...
        m.poles.push({dx:(i-2.5)*22,dy:0,mx:Math.cos(a)*1.5,my:Math.sin(a)*1.5});}
      m.mass=3;m.inertia=3;m.strength=1.3;break;
  }
  return m;
}

/* ═══ PHYSICS ═══ */
const FIELD_SCALE = 80000; // compensates for 1/r³ falloff at pixel-scale distances

// The point-dipole field at offset (px,py) from a pole with moment (mx,my).
// This is B = (3(m·r̂)r̂ − m)/r³ written out in Cartesian form. The r<5 guard
// clamps the singularity at the pole so the field stays finite up close.
function dipoleField(px,py,mx,my){
  const r2=px*px+py*py,r=Math.sqrt(r2);
  if(r<5)return[0,0];
  const r3=r2*r,r5=r3*r2,mdotr=mx*px+my*py;
  return[(3*mdotr*px/r5-mx/r3)*FIELD_SCALE,(3*mdotr*py/r5-my/r3)*FIELD_SCALE];
}

// Total field at a world point: sum every pole of every magnet. Each pole is
// rotated into world space by its magnet's angle, then scaled by strength.
function totalField(wx,wy){
  let Bx=0,By=0;
  for(const mag of magnets){
    const ca=Math.cos(mag.angle),sa=Math.sin(mag.angle);
    for(const p of mag.poles){
      const sx=mag.x+p.dx*ca-p.dy*sa,sy=mag.y+p.dx*sa+p.dy*ca;
      const mmx=(p.mx*ca-p.my*sa)*mag.strength,mmy=(p.mx*sa+p.my*ca)*mag.strength;
      const[bx,by]=dipoleField(wx-sx,wy-sy,mmx,mmy);
      Bx+=bx;By+=by;
    }
  }
  return[Bx,By];
}
// Same sum as totalField, but skipping one magnet by id. A magnet must not feel
// its own field, so force and torque use this to see only its neighbours.
function fieldFromOthers(wx,wy,exId){
  let Bx=0,By=0;
  for(const mag of magnets){
    if(mag.id===exId)continue;
    const ca=Math.cos(mag.angle),sa=Math.sin(mag.angle);
    for(const p of mag.poles){
      const sx=mag.x+p.dx*ca-p.dy*sa,sy=mag.y+p.dx*sa+p.dy*ca;
      const mmx=(p.mx*ca-p.my*sa)*mag.strength,mmy=(p.mx*sa+p.my*ca)*mag.strength;
      const[bx,by]=dipoleField(wx-sx,wy-sy,mmx,mmy);
      Bx+=bx;By+=by;
    }
  }
  return[Bx,By];
}
// Advance every magnet one physics step: driven spin, then magnetic force and
// torque on dynamic bodies, then collision resolution. Fixed magnets and the
// one being dragged are held in place but still act as field sources.
function integrateMagnets(){
  // ── Apply preset spin to ALL magnets (fixed or dynamic) ──
  for(const mag of magnets){
    if(mag.spin!==0 && mag!==dragMag) mag.angle+=mag.spin*SIM.dt;
  }

  // ── Magnetic forces & torque (dynamic only) ──
  for(const mag of magnets){
    if(mag.fixed||mag===dragMag)continue;
    const ca=Math.cos(mag.angle),sa=Math.sin(mag.angle);
    let Fx=0,Fy=0,torque=0;
    for(const p of mag.poles){
      const sx=mag.x+p.dx*ca-p.dy*sa,sy=mag.y+p.dx*sa+p.dy*ca;
      const mmx=(p.mx*ca-p.my*sa)*mag.strength,mmy=(p.mx*sa+p.my*ca)*mag.strength;
      const[Bx,By]=fieldFromOthers(sx,sy,mag.id);
      // Force on a dipole is F = grad(m·B). Sample B at four points a step h
      // apart and take central differences to get the gradient numerically.
      const h=2;
      const[Bxr,Byr]=fieldFromOthers(sx+h,sy,mag.id);
      const[Bxl,Byl]=fieldFromOthers(sx-h,sy,mag.id);
      const[Bxu,Byu]=fieldFromOthers(sx,sy+h,mag.id);
      const[Bxd,Byd]=fieldFromOthers(sx,sy-h,mag.id);
      Fx+=(mmx*(Bxr-Bxl)+mmy*(Byr-Byl))/(2*h)*6000;
      Fy+=(mmx*(Bxu-Bxd)+mmy*(Byu-Byd))/(2*h)*6000;
      // Torque on a dipole is m × B; in 2D that cross product is the scalar
      // (mx*By − my*Bx), which turns the magnet toward field alignment.
      torque+=(mmx*By-mmy*Bx)*1200;
    }
    // Clamp force and torque so a close approach cannot blow the body up.
    const fMag=Math.sqrt(Fx*Fx+Fy*Fy),fMax=4000;
    if(fMag>fMax){Fx*=fMax/fMag;Fy*=fMax/fMag;}
    torque=Math.max(-1500,Math.min(1500,torque));
    // Semi-implicit Euler: integrate velocity from force, then damp it. Linear
    // and angular velocities decay each step so motion settles.
    mag.vx=(mag.vx+Fx/mag.mass*SIM.dt)*SIM.damping;
    mag.vy=(mag.vy+Fy/mag.mass*SIM.dt)*SIM.damping;
    mag.va=(mag.va+torque/mag.inertia*SIM.dt)*SIM.angDamping;
    // Hard cap on angular velocity to prevent spin blowup
    mag.va=Math.max(-3,Math.min(3,mag.va));
    mag.x+=mag.vx*SIM.dt;mag.y+=mag.vy*SIM.dt;mag.angle+=mag.va*SIM.dt;
    // Wall bounce: keep the body inside a margin and reverse velocity at half
    // energy so it does not escape the canvas.
    const M=40;
    if(mag.x<M){mag.x=M;mag.vx*=-0.5;}if(mag.x>CW-M){mag.x=CW-M;mag.vx*=-0.5;}
    if(mag.y<M){mag.y=M;mag.vy*=-0.5;}if(mag.y>CH-M){mag.y=CH-M;mag.vy*=-0.5;}
  }

  // ── Magnet-magnet collisions with contact damping (spring-dashpot) ──
  // Each pair is resolved as a soft spring plus a dashpot: a graduated repulsion
  // as they near, position correction and an impulse on hard overlap, and
  // velocity damping throughout so bodies settle instead of jittering.
  const restitution = 0.1;  // nearly inelastic — magnets stick rather than bounce
  const COLL_PAD = 14;      // padding so magnets settle with a visible gap
  const SKIN = 30;          // proximity zone for soft forces
  const CONTACT_DAMP = 12;  // dashpot coefficient — absorbs relative velocity
  const ANG_CONTACT_DAMP = 0.7; // angular damping when in proximity

  // Test each unordered pair once; radii are half the larger body dimension
  // plus padding so magnets keep a visible gap at rest.
  for(let i=0;i<magnets.length;i++){
    const a=magnets[i];
    const ra=Math.max(a.w,a.h)*0.5 + COLL_PAD;
    for(let j=i+1;j<magnets.length;j++){
      const b=magnets[j];
      const rb=Math.max(b.w,b.h)*0.5 + COLL_PAD;
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const minDist=ra+rb;
      if(dist<0.1)continue;

      const nx=dx/dist, ny=dy/dist;
      const aFixed=a.fixed||a===dragMag, bFixed=b.fixed||b===dragMag;

      // ── Proximity zone: soft repulsion + velocity damping (dashpot) ──
      if(dist<minDist+SKIN){
        // Relative velocity along normal (positive = approaching)
        const rvx=(a.vx||0)-(b.vx||0), rvy=(a.vy||0)-(b.vy||0);
        const rvn=rvx*nx+rvy*ny;

        if(dist>=minDist){
          // Skin zone: graduated repulsion + damping
          const t=1-(dist-minDist)/SKIN; // 0 at edge, 1 at boundary
          const skinForce=t*600;
          const dampForce=rvn*CONTACT_DAMP*t; // damp relative approach
          const totalF=skinForce+dampForce;
          if(!aFixed){a.vx-=nx*totalF*SIM.dt/a.mass;a.vy-=ny*totalF*SIM.dt/a.mass;}
          if(!bFixed){b.vx+=nx*totalF*SIM.dt/b.mass;b.vy+=ny*totalF*SIM.dt/b.mass;}
        } else {
          // Hard overlap: position correction + strong damping
          const overlap=minDist-dist;
          if(!(aFixed&&bFixed)){
            if(aFixed){b.x+=nx*overlap;b.y+=ny*overlap;}
            else if(bFixed){a.x-=nx*overlap;a.y-=ny*overlap;}
            else{a.x-=nx*overlap*0.5;a.y-=ny*overlap*0.5;b.x+=nx*overlap*0.5;b.y+=ny*overlap*0.5;}
          }

          // Velocity exchange (nearly inelastic)
          if(!aFixed&&!bFixed){
            if(rvn>0){
              const impulse=rvn*(1+restitution)/(1/a.mass+1/b.mass);
              a.vx-=impulse/a.mass*nx;a.vy-=impulse/a.mass*ny;
              b.vx+=impulse/b.mass*nx;b.vy+=impulse/b.mass*ny;
            }
          } else if(aFixed&&!bFixed){
            const bvn=b.vx*nx+b.vy*ny;
            if(bvn<0){b.vx-=2*bvn*nx*restitution;b.vy-=2*bvn*ny*restitution;}
          } else if(!aFixed&&bFixed){
            const avn=a.vx*nx+a.vy*ny;
            if(avn>0){a.vx-=2*avn*nx*restitution;a.vy-=2*avn*ny*restitution;}
          }

          // Strong contact damping — kill remaining relative velocity
          const dampF=rvn*CONTACT_DAMP;
          if(!aFixed){a.vx-=nx*dampF*SIM.dt/a.mass;a.vy-=ny*dampF*SIM.dt/a.mass;}
          if(!bFixed){b.vx+=nx*dampF*SIM.dt/b.mass;b.vy+=ny*dampF*SIM.dt/b.mass;}
        }

        // Angular damping when in proximity — helps magnets align and stop spinning
        if(!aFixed) a.va*=ANG_CONTACT_DAMP;
        if(!bFixed) b.va*=ANG_CONTACT_DAMP;
      }
    }
  }
}

/* ═══ TRACERS ═══ */
// Tracers are massless particles that ride the field like iron filings. They
// spawn biased toward pole tips (where the field is richest), step along the
// field direction each frame, and respawn when they age out or leave view.

// Collect world-space positions of magnet pole tips for biased spawning
function getPoleTips(){
  const tips=[];
  for(const mag of magnets){
    const ca=Math.cos(mag.angle),sa=Math.sin(mag.angle);
    // Use first and last poles as "tips" (N and S ends)
    const tipPoles = mag.poles.length<=2 ? mag.poles : [mag.poles[0],mag.poles[mag.poles.length-1]];
    for(const p of tipPoles){
      tips.push({
        x: mag.x + p.dx*ca - p.dy*sa,
        y: mag.y + p.dx*sa + p.dy*ca
      });
    }
    // Also add intermediate poles for denser coverage near the body
    if(mag.poles.length>2){
      const mid=mag.poles[Math.floor(mag.poles.length/2)];
      tips.push({
        x: mag.x + mid.dx*ca - mid.dy*sa,
        y: mag.y + mid.dx*sa + mid.dy*ca
      });
    }
  }
  return tips;
}

// Pick a spawn point: usually near a pole tip (Gaussian-ish clustered radius),
// sometimes anywhere in view, and never inside a magnet body.
function spawnPos(){
  const tips=getPoleTips();
  // 65% near poles, 35% random — reject positions inside magnets
  for(let attempt=0;attempt<10;attempt++){
    let x,y;
    if(tips.length>0 && Math.random()<0.65){
      const tip=tips[Math.floor(Math.random()*tips.length)];
      const r=(Math.random()+Math.random()+Math.random())/3 * 35 + 8;
      const a=Math.random()*Math.PI*2;
      x=tip.x+Math.cos(a)*r; y=tip.y+Math.sin(a)*r;
    } else {
      const vb=visibleBounds();
      x=vb.x0+Math.random()*(vb.x1-vb.x0);
      y=vb.y0+Math.random()*(vb.y1-vb.y0);
    }
    if(!isInsideMagnet(x,y)) return [x,y];
  }
  const vb=visibleBounds();
  return [vb.x0+Math.random()*(vb.x1-vb.x0), vb.y0+Math.random()*(vb.y1-vb.y0)];
}

// Test if point is inside any magnet's oriented bounding box (with padding)
function isInsideMagnet(px,py){
  for(const mag of magnets){
    const ca=Math.cos(-mag.angle),sa=Math.sin(-mag.angle);
    const dx=px-mag.x, dy=py-mag.y;
    const lx=dx*ca-dy*sa, ly=dx*sa+dy*ca;
    const pad=6; // px padding
    if(Math.abs(lx)<mag.w*0.5+pad && Math.abs(ly)<mag.h*0.5+pad) return true;
  }
  return false;
}

// Rebuild the whole tracer pool. Called on count change, magnet edits, and
// resize. Each tracer gets a random lifetime so respawns stay staggered.
function spawnTracers(){
  tracers=[];
  for(let i=0;i<SIM.tracerCount;i++){
    const [x,y]=spawnPos();
    tracers.push({x,y,trail:[],age:0,maxAge:2.5+Math.random()*4});
  }
}

// Step every tracer one frame: move along the unit field vector, push the new
// point onto its trail, then respawn if it aged out, left view, or entered a
// magnet. Trail stores [x,y,Bmag] so the renderer can colour by strength.
function updateTracers(dt){
  const speed=SIM.tracerSpeed*80,trailLen=SIM.tracerTrail;
  const threshold=1e-6;
  for(const tr of tracers){
    tr.age+=dt;
    const[Bx,By]=totalField(tr.x,tr.y);
    const Bmag=Math.sqrt(Bx*Bx+By*By);
    if(Bmag>threshold){
      const vx=(Bx/Bmag)*speed;
      const vy=(By/Bmag)*speed;
      tr.x+=vx*dt;
      tr.y+=vy*dt;
    }
    tr.trail.unshift([tr.x,tr.y,Bmag]);
    if(tr.trail.length>trailLen)tr.trail.pop();
    // Kill if: aged out, out of visible bounds, OR inside a magnet body
    const vb=visibleBounds();
    const margin=40;
    if(tr.age>tr.maxAge||tr.x<vb.x0-margin||tr.x>vb.x1+margin||tr.y<vb.y0-margin||tr.y>vb.y1+margin||isInsideMagnet(tr.x,tr.y)){
      // Respawn biased toward poles
      const [nx,ny]=spawnPos();
      tr.x=nx;tr.y=ny;tr.trail=[];tr.age=0;tr.maxAge=2.5+Math.random()*4;
    }
  }
}

/* ═══ COLORS — ported from orbital viewer's B-field tracer system ═══ */
// Returns [r,g,b] in 0-1 range, matching the orbital viewer exactly
// Ramp: dark-purple → blue → cyan → green → orange → white
// Map a field magnitude to an [r,g,b] ramp. A log curve compresses the huge
// dynamic range of a 1/r³ field, gamma reshapes it, and the result indexes a
// six-stop colour ramp from dark purple through to white.
function fieldColorRGB(mag, gamma){
  gamma = gamma || 1.0;
  const lv = Math.log10(1 + mag * 8) / 2.2;
  const lc = Math.pow(Math.max(0, Math.min(1, lv)), 1 / Math.max(0.1, gamma));
  const stops = [[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]];
  const sv = lc * 5, si = Math.min(Math.floor(sv), 4), sf = sv - si;
  return [
    stops[si][0] + sf * (stops[si+1][0] - stops[si][0]),
    stops[si][1] + sf * (stops[si+1][1] - stops[si][1]),
    stops[si][2] + sf * (stops[si+1][2] - stops[si][2])
  ];
}
// Same ramp as fieldColorRGB, formatted as an rgba() string at the given alpha.
function fieldColorCSS(mag, alpha, gamma){
  const [r,g,b] = fieldColorRGB(mag, gamma);
  return `rgba(${(r*255)|0},${(g*255)|0},${(b*255)|0},${alpha})`;
}

/* ═══ RENDER ═══ */
// Draw one frame: clear in device space, paint the background, apply the camera
// transform, then draw the grid and each enabled layer under it. Layer order is
// heatmap, arrows, tracers, magnets, so magnets sit on top.
function render(){
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.restore();

  // Background (full screen, no transform)
  ctx.fillStyle='#0e1118';
  ctx.fillRect(0,0,CW,CH);

  // Apply camera transform — all drawing below is in world coordinates
  ctx.save();
  ctx.translate(CW/2, CH/2);
  ctx.scale(CAM.zoom, CAM.zoom);
  ctx.translate(-CW/2 + CAM.x, -CH/2 + CAM.y);

  // Grid
  const vb=visibleBounds();
  ctx.strokeStyle='rgba(150,200,255,0.03)';ctx.lineWidth=1/CAM.zoom;
  const gs=50;
  const gx0=Math.floor(vb.x0/gs)*gs, gy0=Math.floor(vb.y0/gs)*gs;
  for(let x=gx0;x<vb.x1;x+=gs){ctx.beginPath();ctx.moveTo(x,vb.y0);ctx.lineTo(x,vb.y1);ctx.stroke();}
  for(let y=gy0;y<vb.y1;y+=gs){ctx.beginPath();ctx.moveTo(vb.x0,y);ctx.lineTo(vb.x1,y);ctx.stroke();}

  if(SIM.showHeatmap) renderHeatmap();
  if(SIM.showArrows) renderArrows();
  if(SIM.showTracers) renderTracers();
  renderMagnets();

  ctx.restore();
}

// Heatmap layer: fill a coarse grid of cells, each tinted by the field
// magnitude sampled at its origin.
function renderHeatmap(){
  const step=14;
  for(let x=0;x<CW;x+=step)for(let y=0;y<CH;y+=step){
    const[Bx,By]=totalField(x,y);
    ctx.fillStyle=fieldColorCSS(Math.sqrt(Bx*Bx+By*By),0.4);
    ctx.fillRect(x,y,step,step);
  }
}
// Arrow layer: at each grid node draw a short arrow along the field direction,
// with length and brightness scaled by the log of the field magnitude.
function renderArrows(){
  ctx.save();
  ctx.globalCompositeOperation='lighter'; // additive blend like orbital viewer
  const step=28,maxLen=14;
  for(let x=step/2;x<CW;x+=step)for(let y=step/2;y<CH;y+=step){
    const[Bx,By]=totalField(x,y);
    const Bmag=Math.sqrt(Bx*Bx+By*By);
    if(Bmag<1e-5)continue;
    const[r,g,b]=fieldColorRGB(Bmag);
    const lv=Math.min(1,Math.log10(1+Bmag*8)/2.2);
    const len=Math.max(3,lv*maxLen);
    const nx=Bx/Bmag,ny=By/Bmag;
    const alpha=Math.max(0.06,Math.min(0.5,lv*0.6));
    // Dim shaft color (0.35× like orbital viewer's instanced arrows)
    ctx.strokeStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;
    ctx.lineWidth=1.2;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+nx*len,y+ny*len);ctx.stroke();
    if(len>4){
      const ax=x+nx*len,ay=y+ny*len,px=-ny*2.5,py=nx*2.5;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax-nx*4+px,ay-ny*4+py);ctx.lineTo(ax-nx*4-px,ay-ny*4-py);ctx.closePath();
      ctx.fillStyle=`rgba(${(r*0.35*255)|0},${(g*0.35*255)|0},${(b*0.35*255)|0},${alpha})`;
      ctx.fill();
    }
  }
  ctx.restore();
}
// Tracer layer: draw each trail as a fading polyline. Two passes per segment,
// a wide dim glow under a thin bright core, give the additive bloom look.
function renderTracers(){
  ctx.save();
  ctx.globalCompositeOperation='lighter'; // additive blend — matches THREE.AdditiveBlending
  ctx.lineCap='round';

  for(const tr of tracers){
    const tl=tr.trail.length;if(tl<2)continue;
    // Age alpha: fast fade-in, slow sustain, fade-out in last 20%
    // Matches orbital viewer: tr.age<0.1 ? age/0.1 : age>max*0.8 ? (max-age)/(max*0.2) : 1
    const ageA = tr.age < 0.1 ? tr.age / 0.1
               : tr.age > tr.maxAge * 0.8 ? (tr.maxAge - tr.age) / (tr.maxAge * 0.2)
               : 1;

    for(let s=0;s<tl-1;s++){
      const pt=tr.trail[s], pn=tr.trail[s+1];
      // Trail alpha: head bright, tail dim (0.25× at tail end, matching orbital viewer)
      const a0 = (1 - s / SIM.tracerTrail) * ageA;
      const a1 = (1 - (s+1) / SIM.tracerTrail) * ageA * 0.25;
      if(a0 < 0.01) continue;

      const Bmag = pt[2] || 0;
      const [r,g,b] = fieldColorRGB(Bmag);

      // Glow pass: wider, dimmer line underneath for bloom effect
      ctx.strokeStyle = `rgba(${(r*a0*0.12*255)|0},${(g*a0*0.12*255)|0},${(b*a0*0.12*255)|0},1)`;
      ctx.lineWidth = Math.max(1, 5 * a0);
      ctx.beginPath(); ctx.moveTo(pt[0],pt[1]); ctx.lineTo(pn[0],pn[1]); ctx.stroke();

      // Core pass: bright, thin — color multiplied by alpha like vertex colors
      ctx.strokeStyle = `rgba(${(r*a0*0.55*255)|0},${(g*a0*0.55*255)|0},${(b*a0*0.55*255)|0},1)`;
      ctx.lineWidth = Math.max(0.5, 1.8 * a0);
      ctx.beginPath(); ctx.moveTo(pt[0],pt[1]); ctx.lineTo(pn[0],pn[1]); ctx.stroke();
    }
  }
  ctx.restore();
}
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
  ctx.font='bold 13px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
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
  ctx.font='bold 11px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
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
  ctx.font='bold 10px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
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
  ctx.font='bold 8px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
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
  ctx.font='bold 7px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
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
    ctx.font='bold 9px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
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
  ctx.font='bold 8px "JetBrains Mono"';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,200,50,0.6)';ctx.fillText('HALBACH',0,hh+8);
}

/* ═══ UI WIRING ═══ */
// Paint a range input's filled portion: set the --pct custom property the CSS
// gradient reads, so the track shows progress up to the thumb.
function sg(el){const pct=(el.value-el.min)/(el.max-el.min)*100;el.style.setProperty('--pct',pct+'%');}

// Rebuild the magnet list panel from scratch. One card per magnet carries the
// strength, angle, spin, and fixed/dynamic controls, each wired to setMagProp.
// Called after any add, remove, select, drag, or property change.
function rebuildMagnetList(){
  const list=document.getElementById('mag-list');if(!list)return;list.innerHTML='';
  const icons={bar:'▮',dipole:'◉',solenoid:'⊞',horseshoe:'⊍',buzzer:'⊚',ring:'◎',quadrupole:'✦',halbach:'⇶'};
  magnets.forEach(mag=>{
    const c=document.createElement('div');
    c.className='mag-card'+(mag.id===SIM.selectedId?' selected':'');
    c.onclick=e=>{if(!e.target.closest('.mag-card-del'))selectMagnet(mag.id);};
    c.innerHTML=`<div class="mag-card-head"><span class="mag-card-icon">${icons[mag.type]||'?'}</span><span class="mag-card-name">${mag.type.toUpperCase()} #${mag.id}</span><button class="mag-card-del" onclick="removeMagnet(${mag.id})">✕</button></div>
      <div class="mag-row"><span class="mag-row-lbl">Str</span><input type="range" min="0.1" max="5" value="${mag.strength}" step="0.1" oninput="setMagProp(${mag.id},'strength',+this.value,this)"><span class="val">${mag.strength.toFixed(1)}</span></div>
      <div class="mag-row"><span class="mag-row-lbl">Angle</span><input type="range" min="-3.14159" max="3.14159" value="${mag.angle}" step="0.05" oninput="setMagProp(${mag.id},'angle',+this.value,this)"><span class="val">${(mag.angle*180/Math.PI).toFixed(0)}°</span></div>
      <div class="mag-row"><span class="mag-row-lbl">Spin</span><input type="range" min="-24" max="24" value="${mag.spin}" step="0.5" oninput="setMagProp(${mag.id},'spin',+this.value,this)"><span class="val">${mag.spin.toFixed(1)}</span></div>
      <button class="tog-btn ${mag.fixed?'off':'on'}" onclick="toggleFixed(${mag.id})">${mag.fixed?'🔒 Fixed':'🔓 Dynamic'}</button>`;
    list.appendChild(c);
    c.querySelectorAll('input[type=range]').forEach(sg);
  });
  document.getElementById('st-magnets').textContent=magnets.length+' magnet'+(magnets.length!==1?'s':'');
}

// Add a magnet of the given type at a free spot near centre, select it, and
// respawn tracers so filings gather at the new poles.
function addMagnet(type){
  // Find a position that doesn't overlap existing magnets
  let cx=CW/2, cy=CH/2;
  const tryRadius=Math.max(60, Math.min(CW,CH)*0.08);
  let placed=false;
  // Spiral outward from center to find a free spot
  for(let ring=0;ring<8&&!placed;ring++){
    const r=ring*tryRadius;
    const steps=Math.max(1, Math.round(ring*6));
    for(let s=0;s<steps&&!placed;s++){
      const angle=s/steps*Math.PI*2;
      const tx=CW/2+Math.cos(angle)*r;
      const ty=CH/2+Math.sin(angle)*r;
      let overlap=false;
      for(const other of magnets){
        const dx=tx-other.x,dy=ty-other.y;
        const minD=Math.max(other.w,other.h)*0.5+60;
        if(dx*dx+dy*dy<minD*minD){overlap=true;break;}
      }
      if(!overlap){cx=tx;cy=ty;placed=true;}
    }
  }
  cx=Math.max(60,Math.min(CW-60,cx));
  cy=Math.max(60,Math.min(CH-60,cy));
  const m=createMagnet(type,cx,cy);
  magnets.push(m);SIM.selectedId=m.id;
  rebuildMagnetList();spawnTracers();
  // Auto-close mobile panel so user sees the new magnet
  if(window.innerWidth<600) document.getElementById('panel').classList.remove('mob-open');
}

// Slide the left panel in or out on narrow screens.
function toggleMobilePanel(){
  document.getElementById('panel').classList.toggle('mob-open');
}

// The remaining control handlers: remove/select a magnet, edit a property,
// toggle fixed/dynamic, toggle each display layer, retune tracers, and run the
// transport buttons. Each keeps SIM and the DOM in sync, respawning tracers
// where the field geometry changed.
function removeMagnet(id){magnets=magnets.filter(m=>m.id!==id);if(SIM.selectedId===id)SIM.selectedId=magnets.length?magnets[0].id:-1;rebuildMagnetList();spawnTracers();}
function selectMagnet(id){SIM.selectedId=id;rebuildMagnetList();}
function setMagProp(id,prop,val,el){
  const m=magnets.find(m=>m.id===id);if(!m)return;m[prop]=val;if(el)sg(el);
  const row=el.closest('.mag-row');if(row){const v=row.querySelector('.val');if(prop==='angle')v.textContent=(val*180/Math.PI).toFixed(0)+'°';else v.textContent=val.toFixed(1);}
}
function toggleFixed(id){const m=magnets.find(m=>m.id===id);if(!m)return;m.fixed=!m.fixed;m.vx=0;m.vy=0;m.va=0;rebuildMagnetList();}
function toggleTracers(){SIM.showTracers=!SIM.showTracers;const b=document.getElementById('tog-tracers');b.classList.toggle('on',SIM.showTracers);b.classList.toggle('off',!SIM.showTracers);}
function toggleArrows(){SIM.showArrows=!SIM.showArrows;const b=document.getElementById('tog-arrows');b.classList.toggle('on',SIM.showArrows);b.classList.toggle('off',!SIM.showArrows);}
function toggleGrid(){SIM.showHeatmap=!SIM.showHeatmap;const b=document.getElementById('tog-grid');b.classList.toggle('on',SIM.showHeatmap);b.classList.toggle('off',!SIM.showHeatmap);}
function updateTracerCount(el){SIM.tracerCount=+el.value;document.getElementById('vl-tracer-count').textContent=el.value;sg(el);spawnTracers();document.getElementById('st-tracers').textContent=SIM.tracerCount+' tracers';}
function updateTracerSpeed(el){SIM.tracerSpeed=+el.value;document.getElementById('vl-tracer-speed').textContent=(+el.value).toFixed(1);sg(el);}
function updateTracerTrail(el){SIM.tracerTrail=+el.value;document.getElementById('vl-tracer-trail').textContent=el.value;sg(el);}
function togglePlay(){SIM.playing=!SIM.playing;const b=document.getElementById('btn-play');b.textContent=SIM.playing?'▶ Play':'▐▐ Pause';b.classList.toggle('active',SIM.playing);}
function resetSim(){magnets.forEach(m=>{m.vx=0;m.vy=0;m.va=0;m.spin=0;});rebuildMagnetList();spawnTracers();}
function stopAll(){magnets.forEach(m=>{m.vx=0;m.vy=0;m.va=0;m.spin=0;});rebuildMagnetList();}
function clearAll(){magnets=[];SIM.selectedId=-1;rebuildMagnetList();spawnTracers();}

/* ═══ DRAG + ZOOM ═══ */
// Input state: which magnet is being dragged, the grab offset, whether Shift
// is rotating it, and whether an empty-space drag is panning the camera.
let dragMag=null,dragOffX=0,dragOffY=0,rotating=false;
let isPanning=false, panLastX=0, panLastY=0;

// Mouse or touch position relative to the canvas, in screen pixels.
function getScreenPos(e){
  const rect=canvas.getBoundingClientRect();
  const t=e.touches?e.touches[0]:e;
  return[t.clientX-rect.left, t.clientY-rect.top];
}
// Same, but mapped through the camera into world coordinates.
function getCanvasPos(e){
  const [sx,sy]=getScreenPos(e);
  return screenToWorld(sx,sy);
}

// Topmost magnet under a world point, tested in each body's local frame against
// its padded bounding box. Iterates back to front so the top magnet wins.
function hitTest(wx,wy){
  for(let i=magnets.length-1;i>=0;i--){
    const m=magnets[i],ca=Math.cos(-m.angle),sa=Math.sin(-m.angle);
    const dx=wx-m.x,dy=wy-m.y,lx=dx*ca-dy*sa,ly=dx*sa+dy*ca;
    if(Math.abs(lx)<m.w/2+10&&Math.abs(ly)<m.h/2+10)return m;
  }
  return null;
}

// ── Wheel zoom (desktop) ──
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const [sx,sy]=getScreenPos(e);
  const [wx,wy]=screenToWorld(sx,sy);
  const factor=e.deltaY<0?1.08:1/1.08;
  CAM.zoom=Math.max(0.15,Math.min(8,CAM.zoom*factor));
  // Keep world point under cursor stationary
  const [wx2,wy2]=screenToWorld(sx,sy);
  CAM.x+=wx2-wx; CAM.y+=wy2-wy;
},{passive:false});

// ── Touch: pinch zoom + pan ──
// Snapshot taken at the start of a two-finger gesture: initial pinch distance,
// zoom, midpoint, and camera offset, so move events can compute deltas.
let pinchDist0=0, pinchZoom0=1, pinchMidX=0, pinchMidY=0, pinchCamX=0, pinchCamY=0;
let touchCount=0;

// Two fingers begin a pinch; one finger falls through to the drag handler.
canvas.addEventListener('touchstart',e=>{
  touchCount=e.touches.length;
  if(touchCount===2){
    e.preventDefault();
    dragMag=null; // cancel any drag
    const t0=e.touches[0],t1=e.touches[1];
    const rect=canvas.getBoundingClientRect();
    const sx0=t0.clientX-rect.left,sy0=t0.clientY-rect.top;
    const sx1=t1.clientX-rect.left,sy1=t1.clientY-rect.top;
    pinchDist0=Math.sqrt((sx1-sx0)**2+(sy1-sy0)**2);
    pinchZoom0=CAM.zoom;
    pinchMidX=(sx0+sx1)/2; pinchMidY=(sy0+sy1)/2;
    pinchCamX=CAM.x; pinchCamY=CAM.y;
    return;
  }
  if(touchCount===1) onDown(e);
},{passive:false});

// Two-finger move: zoom by the distance ratio about the pinch midpoint, then
// pan by how far that midpoint drifted. One finger falls through to onMove.
canvas.addEventListener('touchmove',e=>{
  if(e.touches.length===2){
    e.preventDefault();
    const t0=e.touches[0],t1=e.touches[1];
    const rect=canvas.getBoundingClientRect();
    const sx0=t0.clientX-rect.left,sy0=t0.clientY-rect.top;
    const sx1=t1.clientX-rect.left,sy1=t1.clientY-rect.top;
    const dist=Math.sqrt((sx1-sx0)**2+(sy1-sy0)**2);
    const midX=(sx0+sx1)/2, midY=(sy0+sy1)/2;

    // Zoom
    const [wxOld,wyOld]=screenToWorld(pinchMidX,pinchMidY);
    CAM.zoom=Math.max(0.15,Math.min(8,pinchZoom0*(dist/pinchDist0)));
    const [wxNew,wyNew]=screenToWorld(pinchMidX,pinchMidY);
    CAM.x+=wxNew-wxOld; CAM.y+=wyNew-wyOld;

    // Pan with midpoint drift
    const dmx=(midX-pinchMidX)/CAM.zoom, dmy=(midY-pinchMidY)/CAM.zoom;
    CAM.x=pinchCamX+dmx; CAM.y=pinchCamY+dmy;
    return;
  }
  onMove(e);
},{passive:false});

canvas.addEventListener('touchend',e=>{
  touchCount=e.touches.length;
  if(touchCount===0) onUp();
},{passive:false});

// ── Mouse drag ──
// Press: grab a magnet under the cursor (Shift to rotate it), or start panning
// on empty space.
canvas.addEventListener('mousedown',onDown);
function onDown(e){
  e.preventDefault();const[x,y]=getCanvasPos(e);const hit=hitTest(x,y);
  if(hit){dragMag=hit;dragOffX=hit.x-x;dragOffY=hit.y-y;rotating=e.shiftKey;SIM.selectedId=hit.id;rebuildMagnetList();}
  else{
    // Pan if clicking empty space
    isPanning=true;const[sx,sy]=getScreenPos(e);panLastX=sx;panLastY=sy;
  }
}
// Move: pan the camera, rotate the grabbed magnet toward the cursor, or drag it
// by the stored grab offset.
window.addEventListener('mousemove',onMove);
function onMove(e){
  if(isPanning&&!dragMag){
    const[sx,sy]=getScreenPos(e);
    CAM.x+=(sx-panLastX)/CAM.zoom; CAM.y+=(sy-panLastY)/CAM.zoom;
    panLastX=sx;panLastY=sy;
    return;
  }
  if(!dragMag)return;e.preventDefault();const[x,y]=getCanvasPos(e);
  if(rotating)dragMag.angle=Math.atan2(y-dragMag.y,x-dragMag.x);
  else{dragMag.x=x+dragOffX;dragMag.y=y+dragOffY;}
  rebuildMagnetList();
}
// Release: zero the dropped magnet's velocity so it does not fling off, and
// clear all drag/pan state.
window.addEventListener('mouseup',onUp);
function onUp(){if(dragMag){dragMag.vx=0;dragMag.vy=0;}dragMag=null;rotating=false;isPanning=false;}

/* ═══ RESIZE — uses ResizeObserver on the wrapper div ═══ */
// Match the canvas backing store to the wrapper size times the device pixel
// ratio (capped at 2), and set the transform so drawing stays in CSS pixels.
function resize(){
  const wrap=document.getElementById('canvas-wrap');
  CW=wrap.clientWidth;
  CH=wrap.clientHeight;
  if(CW<10||CH<10){CW=300;CH=300;} // fallback
  const dpr=Math.min(devicePixelRatio,2);
  canvas.width=CW*dpr;
  canvas.height=CH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  document.getElementById('st-dims').textContent=CW+'×'+CH;
}

// Prefer ResizeObserver so the canvas tracks the wrapper through layout changes,
// not just window resizes; fall back to the resize event where it is absent.
// Use ResizeObserver for reliable sizing
if(window.ResizeObserver){
  new ResizeObserver(()=>{resize();spawnTracers();}).observe(document.getElementById('canvas-wrap'));
} else {
  window.addEventListener('resize',()=>{resize();spawnTracers();});
}

/* ═══ LOOP ═══ */
// Frame driver: measure dt (clamped so a stalled tab cannot jump the physics),
// step the simulation when playing, refresh the status readouts, and render.
let lastTime=0,fpsCounter=0,fpsTime=0;
function loop(time){
  requestAnimationFrame(loop);
  const dt=Math.min((time-lastTime)/1000,0.05);lastTime=time;
  fpsCounter++;fpsTime+=dt;
  if(fpsTime>=0.5){document.getElementById('st-fps').textContent=Math.round(fpsCounter/fpsTime)+' fps';fpsCounter=0;fpsTime=0;}
  if(SIM.playing){integrateMagnets();updateTracers(dt);}
  if(magnets.length>0){
    const[Bx,By]=totalField(CW/2,CH/2);
    document.getElementById('st-field').textContent='B: '+Math.sqrt(Bx*Bx+By*By).toExponential(1);
  }
  document.getElementById('st-zoom').textContent=CAM.zoom.toFixed(1)+'×';
  render();
}

/* ═══ INIT ═══ */
// Paint the fixed panel sliders once, then start after a short delay so the
// wrapper has a measured size. Init sizes the canvas, spawns tracers, builds
// the list, drops one bar magnet, and kicks off the loop.
document.querySelectorAll('#panel input[type=range]').forEach(sg);
// Delay init slightly to ensure layout is computed
setTimeout(()=>{
  resize();
  spawnTracers();
  rebuildMagnetList();
  addMagnet('bar');
  requestAnimationFrame(loop);
},50);
