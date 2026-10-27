// ============================================================================
//  MAGNETLAB  ·  magnet factory  (part 2 of 20)
// ----------------------------------------------------------------------------
//  createMagnet() builds one rigid body of a type with its pole layout.
//  The UI, the saver scenes and boot all call it.
//
//  grep -n targets: "function createMagnet", "case '<type>'"
// ============================================================================

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
