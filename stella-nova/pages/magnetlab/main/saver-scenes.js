// ============================================================================
//  MAGNETLAB  ·  screensaver scenes  (part 16 of 20)
// ----------------------------------------------------------------------------
//  The saver state and the 16 scene definitions: build, step and label.
//
//  grep -n targets: "let saverOn", "const SV=", "const VIEWS", "const SAVER_SCENES", "id:'<scene>'"
// ============================================================================

/* ═══ SCREENSAVER ═══ */
// Hook for the shell screensaver (lib/screensaver.js). enter() hides the panel,
// status bar, equation card and overlays, so #canvas-wrap fills the window and
// resize() sizes the canvas to it. The saver then plays a tour of 16 magnet
// configurations (SAVER_SCENES) in a seeded order. The seed also sets the
// free values of each scene: magnet type, multipole order, ring count, grid
// size, gear ratio, spiral count, chain length, the constellation layout,
// and so on. Each scene builds its own fixed magnets, moves them in
// saverStep() on smooth paths (the compass needles turn toward B), and picks a view:
// field lines coloured by |B|, by the direction of B, silver lines, a heat map
// under the lines, or an iron-filings layer. A scene change fades through
// black (saverOverlay). Each scene sends opts.label its field equation and its
// live parameters. opts.calm (1 = slowest) scales every rate.
//
//   grep -n targets: "const SAVER_SCENES", "const SV_PLATE", "function saverPlate",
//   "function svAnchor", "function saverStep",
//   "function saverScene", "function renderFilings", "window.snSaver"
let saverOn=false;
const SV={opts:null,order:[],k:0,t:0,dwell:20,slow:1,scene:null,st:null,fade:1,cx:0,cy:0,R:200};
const FADE_S=1.4;
const deg=a=>Math.round(a*180/Math.PI);
const fx=(v,n=2)=>(+v).toFixed(n);
// An angular rate as the viewer sees it: scene time runs at SV.slow.
const om=w=>fx(w*SV.slow,3);

// Small builders. A saver magnet is fixed, so the collision code does not move
// it, and saverStep() owns its position and angle.
function svMag(type,x,y,angle,strength){
  const m=createMagnet(type,x,y); m.angle=angle; m.fixed=true;
  if(strength!=null) m.strength=strength; return m;
}
// One dipole of a ring or an array: a 'dipole' body with its moment along angle.
const svDip=(x,y,a,s)=>svMag('dipole',x,y,a,s??1.4);

// View presets. trMode is the tracer colour mode in TR_FS.
const VIEWS={
  mag:   {name:'field lines, colour = |B| (log scale)',     tr:true, mode:0, heat:false, fil:false},
  dir:   {name:'field lines, hue = direction of B',          tr:true, mode:1, heat:false, fil:false},
  silver:{name:'field lines, brightness = |B|',              tr:true, mode:2, heat:false, fil:false},
  heat:  {name:'heat map of |B| under the field lines',      tr:true, mode:2, heat:true,  fil:false},
  filings:{name:'iron filings: each one turns until τ = m × B = 0', tr:false, mode:0, heat:false, fil:true},
};
const DIPOLE_EQ='B(r) = (μ₀/4π)·[3(m·r̂)r̂ − m] / r³';
const SUM_EQ='B = Σᵢ (μ₀/4π)·[3(mᵢ·r̂ᵢ)r̂ᵢ − mᵢ] / rᵢ³';

// The scenes. build(st) puts the magnets in `magnets` and fills st. step(st,t)
// moves them; t is the scene time in seconds, already scaled by calm. label(st)
// gives the plate. views lists the views a scene can take (seeded choice).
const SAVER_SCENES=[
  { id:'dipole', views:['mag','filings','dir'],
    build(st){ const T=[['bar','A single bar magnet'],['solenoid','A single coil'],['buzzer','A single disc magnet'],['halbach','A single Halbach bar']];
      [st.type,st.name]=T[SV.pick(T.length)]; st.w=(0.14+0.16*SV.rnd())*(SV.rnd()<0.5?-1:1);
      magnets=[svMag(st.type,SV.cx,SV.cy,0,1.2)]; },
    step(st,t){ magnets[0].angle=st.w*t; },
    label:st=>({title:st.name, sub:st.type==='halbach'?'one-sided flux: strong face and weak face':'magnetic dipole',
      eq:[DIPOLE_EQ,'|B| ∝ 1/r³ far from the magnet'],
      lines:['axis angle '+((deg(magnets[0].angle)%360+360)%360)+'°, turning at ω = '+om(Math.abs(st.w))+' rad/s']}) },

  { id:'attract', views:['mag','filings','silver'],
    build(st){ st.d0=SV.R*0.55; st.a=SV.R*0.18; st.w=0.35; st.rot=0.05;
      magnets=[svMag('bar',0,0,0,1.2),svMag('bar',0,0,0,1.2)]; },
    step(st,t){ const d=st.d0+st.a*Math.sin(st.w*t), a=st.rot*t, c=Math.cos(a), s=Math.sin(a);
      st.d=d; magnets[0].x=SV.cx-c*d/2; magnets[0].y=SV.cy-s*d/2; magnets[1].x=SV.cx+c*d/2; magnets[1].y=SV.cy+s*d/2;
      magnets[0].angle=a; magnets[1].angle=a; },
    label:st=>({title:'Two magnets, N facing S', sub:'attracting pair',
      eq:['F = 3μ₀ m₁m₂ / (2π d⁴)   (coaxial dipoles)','U = −m·B,  F = ∇(m·B)'],
      lines:['the field lines run across the gap','gap d breathes '+Math.round(st.d0-st.a)+'–'+Math.round(st.d0+st.a)+' px at ω = '+om(st.w)+' rad/s']}) },

  { id:'repel', views:['mag','dir','filings'],
    build(st){ st.d0=SV.R*0.6; st.a=SV.R*0.18; st.w=0.3; st.rot=-0.05;
      magnets=[svMag('bar',0,0,0,1.2),svMag('bar',0,0,Math.PI,1.2)]; },
    step(st,t){ const d=st.d0+st.a*Math.sin(st.w*t), a=st.rot*t, c=Math.cos(a), s=Math.sin(a);
      magnets[0].x=SV.cx-c*d/2; magnets[0].y=SV.cy-s*d/2; magnets[1].x=SV.cx+c*d/2; magnets[1].y=SV.cy+s*d/2;
      magnets[0].angle=a; magnets[1].angle=a+Math.PI; },
    label:st=>({title:'Two magnets, N facing N', sub:'repelling pair',
      eq:['F = 3μ₀ m₁m₂ / (2π d⁴), pushing apart','B = 0 at the null point between the poles'],
      lines:['the lines turn away from the gap','gap d breathes '+Math.round(st.d0-st.a)+'–'+Math.round(st.d0+st.a)+' px at ω = '+om(st.w)+' rad/s']}) },

  { id:'quad', views:['mag','dir','heat'],
    build(st){ st.n=[4,4,6,8][SV.pick(4)]; st.r=SV.R*(st.n===4?0.55:0.6); st.w=0.07*(SV.rnd()<0.5?-1:1);
      st.name=st.n===4?'Quadrupole':st.n===6?'Sextupole':'Octupole';
      magnets=Array.from({length:st.n},()=>svMag(st.n===4?'bar':'buzzer',0,0,0,1.3)); },
    step(st,t){ for(let i=0;i<st.n;i++){ const p=Math.PI/st.n+i*2*Math.PI/st.n+st.w*t, m=magnets[i];
      m.x=SV.cx+Math.cos(p)*st.r; m.y=SV.cy+Math.sin(p)*st.r; m.angle=p+(i%2?Math.PI:0); } },
    label:st=>({title:st.name+' lens', sub:st.n+' magnets, poles alternate N S',
      eq:st.n===4?['Bx = G·y,   By = G·x','|B| = G·r   (zero on the axis)']:['|B| ∝ r^(n/2 − 1),  n = '+st.n,'B = 0 on the axis, flat near the centre'],
      lines:['bore radius '+Math.round(st.r)+' px','the lens turns at ω = '+om(st.w)+' rad/s','used to focus beams in accelerators']}) },

  { id:'halbach-ring', views:['mag','dir','heat','silver'],
    build(st){ const ks=[2,2,3,-2]; st.k=ks[SV.pick(ks.length)]; st.n=[8,12,16][SV.pick(3)]; st.r=SV.R*0.62; st.w=0.05;
      magnets=[]; for(let i=0;i<st.n;i++) magnets.push(svDip(0,0,0,1.6)); },
    step(st,t){ const sp=st.w*t; for(let i=0;i<st.n;i++){ const th=i/st.n*2*Math.PI, m=magnets[i];
      m.x=SV.cx+Math.cos(th+sp)*st.r; m.y=SV.cy+Math.sin(th+sp)*st.r; m.angle=st.k*th+sp; } },
    label:st=>({title:'Halbach cylinder, k = '+st.k, sub:st.n+' dipoles on a ring',
      eq:['m̂(θ) = (cos kθ, sin kθ)','B in the bore ∝ r^(k−2)'],
      lines:[st.k===2?'k = 2: near-uniform field in the bore, weak outside'
            :st.k===3?'k = 3: quadrupole in the bore, B = 0 at the centre'
            :'k = −2: the flux goes outside, the bore is near zero',
        'ring radius '+Math.round(st.r)+' px, turning at ω = '+om(st.w)+' rad/s']}) },

  { id:'halbach-line', views:['mag','silver','filings'],
    build(st){ st.n=12; st.gap=Math.min(46,CW*0.9/st.n); st.w=0.09;
      magnets=[]; for(let i=0;i<st.n;i++) magnets.push(svDip(0,0,0,1.6)); },
    step(st,t){ const a=0.25*Math.sin(st.w*t), c=Math.cos(a), s=Math.sin(a);
      for(let i=0;i<st.n;i++){ const u=(i-(st.n-1)/2)*st.gap, m=magnets[i];
        m.x=SV.cx+c*u; m.y=SV.cy+s*u; m.angle=a+i*Math.PI/2; } },
    label:st=>({title:'Linear Halbach array', sub:st.n+' dipoles, each turned 90°',
      eq:['m̂(x) = (cos kx, sin kx),  k = 2π/λ','B ∝ e^(−k|y|) on the strong face'],
      lines:['strong face below the array, weak face above','λ = '+Math.round(st.gap*4)+' px, rocking ±14°']}) },

  { id:'orbit', views:['mag','dir','silver'],
    build(st){ st.R=SV.R*0.62; st.w=0.25; magnets=[svMag('solenoid',SV.cx,SV.cy,0,1.4),svMag('buzzer',0,0,0,1.2)]; },
    step(st,t){ const p=st.w*t, m=magnets[1]; m.x=SV.cx+Math.cos(p)*st.R; m.y=SV.cy+Math.sin(p)*st.R; m.angle=p+Math.PI/2;
      magnets[0].angle=0.15*Math.sin(0.11*t); },
    label:st=>({title:'A magnet orbiting a coil', sub:'solenoid + disc magnet',
      eq:['B = μ₀ n I   (inside a long solenoid)','x = R cos ωt,  y = R sin ωt'],
      lines:['R = '+Math.round(st.R)+' px, ω = '+om(st.w)+' rad/s, period '+fx(2*Math.PI/(st.w*SV.slow),1)+' s','the disc moment stays along the orbit']}) },

  { id:'lattice', views:['dir','mag','filings'],
    build(st){ const big=SV.rnd()<0.5; st.nx=CW>CH?(big?7:5):(big?4:3); st.ny=CW>CH?(big?4:3):(big?7:5);
      st.sp=Math.min(CW/(st.nx+0.6),CH/(st.ny+0.6)); st.w=[]; st.wave=SV.rnd()<0.5;
      st.kx=0.6+0.9*SV.rnd(); st.ky=0.9*SV.rnd()-0.45; st.ww=0.35;
      magnets=[]; for(let j=0;j<st.ny;j++)for(let i=0;i<st.nx;i++){
        magnets.push(svDip(0,0,0,1.5)); st.w.push(((i+j)%2?-1:1)*(0.12+0.05*((i*3+j)%4))); } },
    step(st,t){ let q=0; for(let j=0;j<st.ny;j++)for(let i=0;i<st.nx;i++){ const m=magnets[q];
      m.x=SV.cx+(i-(st.nx-1)/2)*st.sp; m.y=SV.cy+(j-(st.ny-1)/2)*st.sp;
      m.angle=st.wave?st.kx*i+st.ky*j-st.ww*t:st.w[q]*t+(i+j)*0.7; q++; } },
    label:st=>({title:st.wave?'Spin wave on a lattice':'Lattice of turning dipoles',
      sub:st.nx+' × '+st.ny+' grid, '+(st.wave?'the moment angle travels as a wave':'neighbours counter-rotate'),
      eq:st.wave?[SUM_EQ,'θ(i, j, t) = kₓ i + k_y j − ω t']:[SUM_EQ,'θᵢ(t) = θᵢ₀ + ωᵢ t'],
      lines:st.wave?['kₓ = '+fx(st.kx)+', k_y = '+fx(st.ky)+' rad per site, ω = '+om(st.ww)+' rad/s']:['ωᵢ from '+om(Math.min(...st.w.map(Math.abs)))+' to '+om(Math.max(...st.w.map(Math.abs)))+' rad/s','spacing '+Math.round(st.sp)+' px']}) },

  { id:'horseshoe', views:['filings','mag','heat'],
    build(st){ st.w=0.12; st.d=Math.max(95,SV.R*0.28); magnets=[svMag('horseshoe',SV.cx,SV.cy,0,1.4),svMag('bar',0,0,0,0.9)]; },
    step(st,t){ const a=0.5*Math.sin(st.w*t), hs=magnets[0], b=magnets[1];
      hs.angle=a; b.x=SV.cx+Math.sin(a)*st.d; b.y=SV.cy-Math.cos(a)*st.d;
      b.angle=a+Math.PI/2+0.6*Math.sin(st.w*1.7*t); },
    label:st=>({title:'Horseshoe and a free bar', sub:'flux crosses the gap',
      eq:[SUM_EQ,'∇·B = 0: each line from N comes back to S'],
      lines:['the bar '+Math.round(st.d)+' px above the gap turns ±34°','the horseshoe rocks ±29°']}) },
  // Compass needles: weak dipoles on a grid. Each needle feels the drivers
  // and turns toward B with an overdamped torque τ = m × B. The drivers
  // drift on a Lissajous path near the centre.
  { id:'compass', views:['mag','dir'],
    build(st){ st.two=SV.rnd()<0.5; st.ax=SV.R*0.14; st.ay=SV.R*0.1; st.w1=0.13; st.w2=0.19; st.ph=6.283*SV.rnd(); st.k=3; st.last=0;
      const D=st.two?[svMag('bar',0,0,0,1.4),svMag('buzzer',0,0,0,1.3)]:[svMag(SV.rnd()<0.5?'bar':'horseshoe',0,0,0,1.5)];
      st.nd=D.length; magnets=D.slice();
      const s=Math.max(62,Math.min(CW,CH)/6.5), r0=SV.R*(st.two?0.5:0.4), nx=Math.floor(CW/s), ny=Math.floor(CH/s);
      for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){ const x=(i+0.5)*CW/nx, y=(j+0.5)*CH/ny;
        if(Math.hypot((x-SV.cx)/1.15,y-SV.cy)<r0) continue; const m=svDip(x,y,6.283*SV.rnd(),0.32); magnets.push(m); }
      st.nn=magnets.length-st.nd; },
    step(st,t){ const dt=Math.max(0,Math.min(0.1,t-st.last)); st.last=t;
      const ox=SV.cx+st.ax*Math.sin(st.w1*t+st.ph), oy=SV.cy+st.ay*Math.sin(st.w2*t);
      if(st.two){ const a=0.3*t, r=SV.R*0.17; magnets[0].x=ox+Math.cos(a)*r; magnets[0].y=oy+Math.sin(a)*r; magnets[0].angle=a+Math.PI/2;
        magnets[1].x=ox-Math.cos(a)*r; magnets[1].y=oy-Math.sin(a)*r; magnets[1].angle=-0.5*t; }
      else { magnets[0].x=ox; magnets[0].y=oy; magnets[0].angle=0.16*t; }
      for(let q=st.nd;q<magnets.length;q++){ const m=magnets[q]; let Bx=0,By=0;
        for(let d=0;d<st.nd;d++){ const D=magnets[d], ca=Math.cos(D.angle), sa=Math.sin(D.angle);
          for(const p of D.poles){ const b=dipoleField(m.x-(D.x+p.dx*ca-p.dy*sa),m.y-(D.y+p.dx*sa+p.dy*ca),(p.mx*ca-p.my*sa)*D.strength,(p.mx*sa+p.my*ca)*D.strength); Bx+=b[0]; By+=b[1]; } }
        const e=Math.atan2(By,Bx)-m.angle; m.angle+=(t<0.01?1:Math.min(1,st.k*dt))*Math.atan2(Math.sin(e),Math.cos(e)); } },
    label:st=>({title:'Compass field', sub:st.nn+' compass needles around '+(st.two?'two magnets':'one magnet'),
      eq:['τ = m × B: each needle turns until m ∥ B','B = Σ (μ₀/4π)·[3(m·r̂)r̂ − m] / r³ over the drivers'],
      lines:['the needles feel the drivers only']}) },

  // Magnetic gear: an inner ring of 2p₁ and an outer ring of 2p₂ radial
  // dipoles, alternating out and in, turning at the gear ratio.
  { id:'gear', views:['mag','dir','heat'],
    build(st){ const G=[[2,5],[3,7],[4,9],[2,7]]; [st.p1,st.p2]=G[SV.pick(G.length)]; st.ri=SV.R*0.3; st.ro=SV.R*0.72; st.w=0.16;
      magnets=[]; for(let i=0;i<2*st.p1;i++) magnets.push(svDip(0,0,0,1.5)); for(let i=0;i<2*st.p2;i++) magnets.push(svDip(0,0,0,1.5)); },
    step(st,t){ const a1=st.w*t, a2=-st.w*st.p1/st.p2*t;
      const ring=(o,n,r,a)=>{ for(let i=0;i<n;i++){ const th=a+i*2*Math.PI/n, m=magnets[o+i];
        m.x=SV.cx+Math.cos(th)*r; m.y=SV.cy+Math.sin(th)*r; m.angle=th+(i%2?Math.PI:0); } };
      ring(0,2*st.p1,st.ri,a1); ring(2*st.p1,2*st.p2,st.ro,a2); },
    label:st=>({title:'Magnetic gear '+st.p1+' : '+st.p2, sub:'two rings of alternating poles, no contact',
      eq:['ω₂ = −(p₁/p₂) ω₁','gear ratio G = p₂/p₁ = '+fx(st.p2/st.p1)],
      lines:['inner '+2*st.p1+' poles, outer '+2*st.p2+' poles']}) },

  // Phyllotaxis: dipoles on a golden-angle spiral. The moment of each one
  // turns from radial (a source-like field) to tangent (flux closure).
  { id:'spiral', views:['dir','mag','filings'],
    build(st){ st.n=[21,34,34,55][SV.pick(4)]; st.c=SV.R*0.78/Math.sqrt(st.n); st.w=0.12; st.rot=0.03*(SV.rnd()<0.5?-1:1);
      magnets=[]; for(let i=0;i<st.n;i++) magnets.push(svDip(0,0,0,st.n>40?1.1:1.3)); },
    step(st,t){ st.al=Math.PI/2*(0.5-0.5*Math.cos(st.w*t)); const g=2.39996323;
      for(let i=0;i<st.n;i++){ const th=(i+1)*g+st.rot*t, r=st.c*Math.sqrt(i+0.6), m=magnets[i];
        m.x=SV.cx+Math.cos(th)*r; m.y=SV.cy+Math.sin(th)*r; m.angle=th+st.al; } },
    label:st=>({title:'Golden spiral of dipoles', sub:st.n+' dipoles at the golden angle 137.5°',
      eq:['rₙ = c √n,   θₙ = n · 137.5°','m̂ₙ turns from radial to tangent: α = '+deg(st.al||0)+'°'],
      lines:['α = 0°: radial, α = 90°: the flux closes on itself']}) },

  // A seeded constellation: mixed magnet types at random places and angles,
  // each drifting on its own slow Lissajous path and turning.
  { id:'cluster', views:['mag','dir','filings','heat'],
    build(st){ const T=['bar','buzzer','ring','quadrupole','halbach','horseshoe','dipole','solenoid'];
      st.n=4+SV.pick(4); const P=[], lim=SV.R*0.72, minD=Math.max(120,SV.R*0.38); st.m=[];
      for(let tries=0;P.length<st.n&&tries<400;tries++){ const a=6.283*SV.rnd(), r=lim*Math.sqrt(SV.rnd());
        const x=SV.cx+Math.cos(a)*r*(CW>CH?1.35:0.9), y=SV.cy+Math.sin(a)*r*(CW>CH?0.85:1.2);
        if(P.every(q=>Math.hypot(q[0]-x,q[1]-y)>minD)) P.push([x,y]); }
      magnets=P.map(([x,y])=>{ const type=T[SV.pick(T.length)], m=svMag(type,x,y,6.283*SV.rnd(),1+0.5*SV.rnd());
        st.m.push({x,y,ax:18+22*SV.rnd(),ay:18+22*SV.rnd(),w1:0.08+0.12*SV.rnd(),w2:0.08+0.12*SV.rnd(),a0:m.angle,ws:(SV.rnd()-0.5)*0.4}); return m; });
      st.n=magnets.length; st.types=[...new Set(magnets.map(m=>m.type))]; },
    step(st,t){ magnets.forEach((m,i)=>{ const q=st.m[i]; m.x=q.x+q.ax*Math.sin(q.w1*t); m.y=q.y+q.ay*Math.sin(q.w2*t+1); m.angle=q.a0+q.ws*t; }); },
    label:st=>({title:'Constellation of '+st.n, sub:st.types.join(', ')+' at random places',
      eq:[SUM_EQ,'each magnet drifts: x = x₀ + A sin ω₁t, y = y₀ + B sin ω₂t'],
      lines:['a new arrangement from each seed']}) },

  // A chain of dipoles head to tail on a travelling sine wave, like the
  // magnetosome chain of a magnetotactic bacterium.
  { id:'chain', views:['mag','silver','filings'],
    build(st){ st.n=12+SV.pick(6); st.L=Math.min(CW*0.86,st.n*64); st.A=SV.R*(0.12+0.12*SV.rnd()); st.k=2*Math.PI*(1+SV.pick(2))/st.L; st.w=0.5;
      magnets=[]; for(let i=0;i<st.n;i++) magnets.push(svDip(0,0,0,1.3)); },
    step(st,t){ for(let i=0;i<st.n;i++){ const u=(i/(st.n-1)-0.5)*st.L, m=magnets[i], ph=st.k*u-st.w*t;
      m.x=SV.cx+u; m.y=SV.cy+st.A*Math.sin(ph); m.angle=Math.atan2(st.A*st.k*Math.cos(ph),1); } },
    label:st=>({title:'Dipole chain on a wave', sub:st.n+' dipoles head to tail',
      eq:['y = A sin(kx − ωt),   m̂ along the chain','head to tail: U = −m·B is lowest'],
      lines:['A = '+Math.round(st.A)+' px, λ = '+Math.round(2*Math.PI/st.k)+' px']}) },

  // Flux closure: four bars head to tail round a square. Closed, the flux
  // stays in the loop; as the square opens, the stray field leaks out.
  { id:'closure', views:['mag','filings','heat'],
    build(st){ st.h=Math.max(70,SV.R*0.26); st.g=SV.R*0.22; st.w=0.32; st.rot=0.04*(SV.rnd()<0.5?-1:1);
      magnets=[0,1,2,3].map(()=>svMag('bar',0,0,0,1.2)); },
    step(st,t){ st.open=st.g*(0.5-0.5*Math.cos(st.w*t)); const a0=st.rot*t;
      for(let i=0;i<4;i++){ const a=a0+i*Math.PI/2, d=st.h+st.open, m=magnets[i];
        m.x=SV.cx+Math.cos(a)*d; m.y=SV.cy+Math.sin(a)*d; m.angle=a+Math.PI/2; } },
    label:st=>({title:'Flux-closure square', sub:'four bars head to tail',
      eq:['∮ B·dl follows the loop when closed','∇·B = 0: the stray field appears at the gaps'],
      lines:['the corners open by '+Math.round(st.open||0)+' px']}) },

  // Two rows of alternating dipoles slide past each other in opposite
  // directions: a linear magnetic coupling.
  { id:'shear', views:['dir','mag','silver'],
    build(st){ st.a=Math.max(52,Math.min(80,CW/14)); st.n=Math.ceil(CW/st.a)+3; st.n+=st.n%2; st.gap=SV.R*(0.18+0.18*SV.rnd()); st.v=18+14*SV.rnd();
      st.ang=SV.rnd()<0.5?0:Math.PI/2; magnets=[]; for(let i=0;i<2*st.n;i++) magnets.push(svDip(0,0,0,1.3)); },
    step(st,t){ const span=st.n*st.a;
      for(let r=0;r<2;r++) for(let i=0;i<st.n;i++){ const m=magnets[r*st.n+i], sh=(r?-1:1)*st.v*t;
        let u=((i*st.a+sh)%span+span)%span; m.x=SV.cx+u-span/2; m.y=SV.cy+(r?1:-1)*st.gap/2; m.angle=st.ang+(i%2?Math.PI:0)+(r?Math.PI:0); } },
    label:st=>({title:'Two rows shearing', sub:'alternating dipoles slide past each other',
      eq:['m̂ᵢ = (−1)ⁱ m̂₀','F_x ∝ sin(2π Δx / 2a): the rows pull into register'],
      lines:['gap '+Math.round(st.gap)+' px, each row at '+Math.round(st.v*SV.slow)+' px/s']}) },
];
