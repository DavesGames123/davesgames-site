// ============================================================================
//  MAGNETLAB  ·  magnet dynamics  (part 4 of 20)
// ----------------------------------------------------------------------------
//  integrateMagnets(): driven spin, force and torque on dynamic magnets,
//  wall bounce, then the spring-dashpot contact pass. loop() calls it.
//
//  grep -n targets: "function integrateMagnets", "Magnetic forces", "Magnet-magnet collisions"
// ============================================================================

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
