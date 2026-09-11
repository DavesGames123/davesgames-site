"use strict";

/* equation color roles */
const ST="#45d3ff", PA="#ffc832", OP="#96c8ff";

/* ════════ attractor library ════════
   f(x,y,z,P)->[dx,dy,dz]; dt = step; eq = [{sub, lines:[latex...]}] */
const ATTRACTORS = {
  lorenz:{name:"Lorenz",start:[0.1,0,0],dt:0.005,
    blurb:"The original 'butterfly'. A 3-mode truncation of Rayleigh–Bénard convection — the icon of deterministic chaos.",
    params:{sigma:{l:"σ",min:1,max:20,step:0.1,d:10},rho:{l:"ρ",min:1,max:60,step:0.1,d:28},beta:{l:"β",min:0.5,max:5,step:0.01,d:2.667}},
    f:(x,y,z,P)=>[P.sigma*(y-x),x*(P.rho-z)-y,x*y-P.beta*z],
    eq:[{sub:"Lorenz system · Rayleigh–Bénard convection",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = \\textcolor{${PA}}{\\sigma}\\,(\\textcolor{${ST}}{y}-\\textcolor{${ST}}{x})`,
      `\\textcolor{${OP}}{\\dot{y}} = \\textcolor{${ST}}{x}\\,(\\textcolor{${PA}}{\\rho}-\\textcolor{${ST}}{z}) - \\textcolor{${ST}}{y}`,
      `\\textcolor{${OP}}{\\dot{z}} = \\textcolor{${ST}}{x}\\textcolor{${ST}}{y} - \\textcolor{${PA}}{\\beta}\\,\\textcolor{${ST}}{z}`]}]},
  rossler:{name:"Rössler",start:[0.1,0,0],dt:0.02,
    blurb:"A single spiralling band that folds back on itself — chaos from one nonlinear term.",
    params:{a:{l:"a",min:0.05,max:0.5,step:0.005,d:0.2},b:{l:"b",min:0.05,max:1,step:0.01,d:0.2},c:{l:"c",min:2,max:12,step:0.05,d:5.7}},
    f:(x,y,z,P)=>[-y-z,x+P.a*y,P.b+z*(x-P.c)],
    eq:[{sub:"Rössler system",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = -\\textcolor{${ST}}{y} - \\textcolor{${ST}}{z}`,
      `\\textcolor{${OP}}{\\dot{y}} = \\textcolor{${ST}}{x} + \\textcolor{${PA}}{a}\\,\\textcolor{${ST}}{y}`,
      `\\textcolor{${OP}}{\\dot{z}} = \\textcolor{${PA}}{b} + \\textcolor{${ST}}{z}(\\textcolor{${ST}}{x}-\\textcolor{${PA}}{c})`]}]},
  aizawa:{name:"Aizawa",start:[0.1,0,0],dt:0.01,
    blurb:"A spherical shell pierced by a spindle. Constants e=0.25, f=0.1.",
    params:{a:{l:"a",min:0.5,max:1.2,step:0.005,d:0.95},b:{l:"b",min:0.3,max:1,step:0.005,d:0.7},c:{l:"c",min:0.3,max:1,step:0.005,d:0.6},d:{l:"d",min:2,max:4.5,step:0.01,d:3.5}},
    f:(x,y,z,P)=>[(z-P.b)*x-P.d*y,P.d*x+(z-P.b)*y,P.c+P.a*z-z*z*z/3-(x*x+y*y)*(1+0.25*z)+0.1*z*x*x*x],
    eq:[{sub:"Aizawa system",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = (\\textcolor{${ST}}{z}-\\textcolor{${PA}}{b})\\textcolor{${ST}}{x} - \\textcolor{${PA}}{d}\\,\\textcolor{${ST}}{y}`,
      `\\textcolor{${OP}}{\\dot{y}} = \\textcolor{${PA}}{d}\\,\\textcolor{${ST}}{x} + (\\textcolor{${ST}}{z}-\\textcolor{${PA}}{b})\\textcolor{${ST}}{y}`,
      `\\textcolor{${OP}}{\\dot{z}} = \\textcolor{${PA}}{c} + \\textcolor{${PA}}{a}\\textcolor{${ST}}{z} - \\tfrac{\\textcolor{${ST}}{z}^3}{3} - (\\textcolor{${ST}}{x}^2{+}\\textcolor{${ST}}{y}^2)(1{+}0.25\\textcolor{${ST}}{z}) + 0.1\\,\\textcolor{${ST}}{z}\\textcolor{${ST}}{x}^3`]}]},
  thomas:{name:"Thomas",start:[1.1,1.1,-0.5],dt:0.05,
    blurb:"Cyclically symmetric — a particle wandering a lattice of sine wells.",
    params:{b:{l:"b",min:0.05,max:0.33,step:0.001,d:0.208}},
    f:(x,y,z,P)=>[Math.sin(y)-P.b*x,Math.sin(z)-P.b*y,Math.sin(x)-P.b*z],
    eq:[{sub:"Thomas' cyclically symmetric system",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = \\sin\\textcolor{${ST}}{y} - \\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{x}`,
      `\\textcolor{${OP}}{\\dot{y}} = \\sin\\textcolor{${ST}}{z} - \\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{y}`,
      `\\textcolor{${OP}}{\\dot{z}} = \\sin\\textcolor{${ST}}{x} - \\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{z}`]}]},
  halvorsen:{name:"Halvorsen",start:[-1.48,-1.51,2.04],dt:0.005,
    blurb:"A three-armed pinwheel with full cyclic symmetry.",
    params:{a:{l:"a",min:1.0,max:1.8,step:0.005,d:1.4}},
    f:(x,y,z,P)=>[-P.a*x-4*y-4*z-y*y,-P.a*y-4*z-4*x-z*z,-P.a*z-4*x-4*y-x*x],
    eq:[{sub:"Halvorsen system",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = -\\textcolor{${PA}}{a}\\textcolor{${ST}}{x} - 4\\textcolor{${ST}}{y} - 4\\textcolor{${ST}}{z} - \\textcolor{${ST}}{y}^2`,
      `\\textcolor{${OP}}{\\dot{y}} = -\\textcolor{${PA}}{a}\\textcolor{${ST}}{y} - 4\\textcolor{${ST}}{z} - 4\\textcolor{${ST}}{x} - \\textcolor{${ST}}{z}^2`,
      `\\textcolor{${OP}}{\\dot{z}} = -\\textcolor{${PA}}{a}\\textcolor{${ST}}{z} - 4\\textcolor{${ST}}{x} - 4\\textcolor{${ST}}{y} - \\textcolor{${ST}}{x}^2`]}]},
  chen:{name:"Chen",start:[-0.1,0.5,-0.6],dt:0.004,
    blurb:"A cousin of Lorenz with a denser, more turbulent double scroll.",
    params:{a:{l:"a",min:20,max:45,step:0.1,d:35},b:{l:"b",min:1,max:6,step:0.05,d:3},c:{l:"c",min:20,max:35,step:0.1,d:28}},
    f:(x,y,z,P)=>[P.a*(y-x),(P.c-P.a)*x-x*z+P.c*y,x*y-P.b*z],
    eq:[{sub:"Chen system",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = \\textcolor{${PA}}{a}\\,(\\textcolor{${ST}}{y}-\\textcolor{${ST}}{x})`,
      `\\textcolor{${OP}}{\\dot{y}} = (\\textcolor{${PA}}{c}-\\textcolor{${PA}}{a})\\textcolor{${ST}}{x} - \\textcolor{${ST}}{x}\\textcolor{${ST}}{z} + \\textcolor{${PA}}{c}\\,\\textcolor{${ST}}{y}`,
      `\\textcolor{${OP}}{\\dot{z}} = \\textcolor{${ST}}{x}\\textcolor{${ST}}{y} - \\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{z}`]}]},
  dadras:{name:"Dadras",start:[1.1,2.1,-2],dt:0.01,
    blurb:"A four-wing attractor — the trajectory threads four lobes around the origin.",
    params:{a:{l:"a",min:1,max:5,step:0.05,d:3},b:{l:"b",min:1,max:4,step:0.05,d:2.7},c:{l:"c",min:1,max:3,step:0.05,d:1.7},d:{l:"d",min:1,max:3,step:0.05,d:2},e:{l:"e",min:5,max:12,step:0.1,d:9}},
    f:(x,y,z,P)=>[y-P.a*x+P.b*y*z,P.c*y-x*z+z,P.d*x*y-P.e*z],
    eq:[{sub:"Dadras four-wing system",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = \\textcolor{${ST}}{y} - \\textcolor{${PA}}{a}\\textcolor{${ST}}{x} + \\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{y}\\textcolor{${ST}}{z}`,
      `\\textcolor{${OP}}{\\dot{y}} = \\textcolor{${PA}}{c}\\textcolor{${ST}}{y} - \\textcolor{${ST}}{x}\\textcolor{${ST}}{z} + \\textcolor{${ST}}{z}`,
      `\\textcolor{${OP}}{\\dot{z}} = \\textcolor{${PA}}{d}\\,\\textcolor{${ST}}{x}\\textcolor{${ST}}{y} - \\textcolor{${PA}}{e}\\,\\textcolor{${ST}}{z}`]}]},
  lorenz84:{name:"Lorenz-84",start:[0.1,0.1,0.1],dt:0.01,
    blurb:"A low-order model of global atmospheric circulation. Knotted and weather-like.",
    params:{a:{l:"a",min:0.2,max:1.5,step:0.01,d:0.95},b:{l:"b",min:3,max:10,step:0.05,d:7.91},F:{l:"F",min:1,max:8,step:0.05,d:4.83},G:{l:"G",min:1,max:8,step:0.05,d:4.66}},
    f:(x,y,z,P)=>[-P.a*x-y*y-z*z+P.a*P.F,-y+x*y-P.b*x*z+P.G,-z+P.b*x*y+x*z],
    eq:[{sub:"Lorenz-84 atmospheric model",lines:[
      `\\textcolor{${OP}}{\\dot{x}} = -\\textcolor{${PA}}{a}\\textcolor{${ST}}{x} - \\textcolor{${ST}}{y}^2 - \\textcolor{${ST}}{z}^2 + \\textcolor{${PA}}{a}\\textcolor{${PA}}{F}`,
      `\\textcolor{${OP}}{\\dot{y}} = -\\textcolor{${ST}}{y} + \\textcolor{${ST}}{x}\\textcolor{${ST}}{y} - \\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{x}\\textcolor{${ST}}{z} + \\textcolor{${PA}}{G}`,
      `\\textcolor{${OP}}{\\dot{z}} = -\\textcolor{${ST}}{z} + \\textcolor{${PA}}{b}\\,\\textcolor{${ST}}{x}\\textcolor{${ST}}{y} + \\textcolor{${ST}}{x}\\textcolor{${ST}}{z}`]}]}
};

/* ════════ state ════════ */
const MAXP=1000, MAXT=400, CAP=MAXP*MAXT;
let cur="lorenz", P={}, particles=[];
const cfg={count:100,trail:220,speed:1,glow:13,colMode:"speed",palette:"stella",gamma:1.0,contrast:1.0,exposure:1.0,autoRotate:true,fog:false};
const view={center:new THREE.Vector3(),radius:60,theta:0.9,phi:1.05,autoTheta:0};

/* ════════ three ════════ */
const host=document.getElementById("gl-host");
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById("gl"),antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.setClearColor(0x080b12,1);
const scene=new THREE.Scene();
const fog=new THREE.Fog(0x080b12,1,1000);scene.fog=fog;   // toggled via depth-fog: near-black fog fades distant filaments
const camera=new THREE.PerspectiveCamera(54,1,0.1,6000);

/* ── tracers = additive line segments (the MagnetLab primitive, in 3D) ──
   each trail is a polyline; we emit one segment (2 verts) per pair of trail
   points. per-vertex color carries the trail fade (brightness ∝ position
   along the trail), and AdditiveBlending makes overlapping filaments glow. */
const SEGV=MAXP*(MAXT-1)*2;                  // max vertices (2 per segment)
const positions=new Float32Array(SEGV*3);
const colors=new Float32Array(SEGV*3);
const geo=new THREE.BufferGeometry();
geo.setAttribute("position",new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
geo.setAttribute("color",new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
geo.setDrawRange(0,0);
geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1e6);
const mat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false});
const lines=new THREE.LineSegments(geo,mat);
lines.frustumCulled=false;
scene.add(lines);

/* ════════ integration ════════ */
function rk4(s,dt,f){const[x,y,z]=s;
  const k1=f(x,y,z,P);
  const k2=f(x+dt*0.5*k1[0],y+dt*0.5*k1[1],z+dt*0.5*k1[2],P);
  const k3=f(x+dt*0.5*k2[0],y+dt*0.5*k2[1],z+dt*0.5*k2[2],P);
  const k4=f(x+dt*k3[0],y+dt*k3[1],z+dt*k3[2],P);
  return[x+dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]),y+dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]),z+dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2])];}
function survey(){const att=ATTRACTORS[cur],f=att.f,dt=att.dt;let s=att.start.slice();
  for(let i=0;i<2000;i++)s=rk4(s,dt,f);
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];const samples=[];
  for(let i=0;i<8000;i++){s=rk4(s,dt,f);if(!isFinite(s[0])||!isFinite(s[1])||!isFinite(s[2])){s=att.start.slice();continue;}
    for(let k=0;k<3;k++){if(s[k]<mn[k])mn[k]=s[k];if(s[k]>mx[k])mx[k]=s[k];}if(i%6===0)samples.push(s.slice());}
  const c=[(mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2];
  const r=0.5*Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])||10;
  return{center:c,radius:r,samples};}
function reseed(keepView){const sv=survey();view.center.set(sv.center[0],sv.center[1],sv.center[2]);
  if(!keepView)view.radius=sv.radius*2.6;
  const S=sv.samples;particles=[];
  for(let i=0;i<MAXP;i++){const base=S[(Math.random()*S.length)|0].slice();
    base[0]+=(Math.random()-0.5)*sv.radius*0.04;base[1]+=(Math.random()-0.5)*sv.radius*0.04;base[2]+=(Math.random()-0.5)*sv.radius*0.04;
    particles.push({pos:base.slice(),trail:[[base[0],base[1],base[2],0]],speed:0});}}

/* ════════ color ════════ */
const PALETTES={
  stella:[[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]],
  plasma:[[0.05,0.03,0.53],[0.35,0,0.62],[0.61,0.09,0.62],[0.83,0.31,0.44],[0.96,0.58,0.25],[0.99,0.91,0.15]],
  viridis:[[0.27,0,0.33],[0.25,0.27,0.53],[0.18,0.43,0.56],[0.13,0.57,0.55],[0.21,0.72,0.47],[0.57,0.84,0.27],[0.99,0.91,0.14]],
  inferno:[[0,0,0.02],[0.22,0.04,0.33],[0.49,0.09,0.42],[0.74,0.21,0.33],[0.93,0.41,0.15],[0.99,0.71,0.18],[0.99,0.99,0.75]],
  ice:[[0,0.02,0.1],[0,0.18,0.45],[0,0.45,0.78],[0.25,0.74,0.96],[0.7,0.93,1],[1,1,1]],
  ember:[[0.02,0,0],[0.3,0.02,0],[0.66,0.11,0],[0.94,0.35,0],[1,0.7,0.15],[1,1,0.85]]
};
function ramp(S,t){t=t<0?0:t>1?1:t;const n=S.length-1,v=t*n,i=Math.min(Math.floor(v),n-1),f=v-i;
  return[S[i][0]+f*(S[i+1][0]-S[i][0]),S[i][1]+f*(S[i+1][1]-S[i][1]),S[i][2]+f*(S[i+1][2]-S[i][2])];}
function toneMap(t){t=t<0?0:t>1?1:t;t=0.5+(t-0.5)*cfg.contrast;if(t<0)t=0;else if(t>1)t=1;t=Math.pow(t,1/cfg.gamma);return t<0?0:t>1?1:t;}
function drawToneCurve(){const cv=document.getElementById("toneCurve");if(!cv)return;const x=cv.getContext("2d"),W=cv.width,H=cv.height,gh=10,pad=3,S=PALETTES[cfg.palette]||PALETTES.stella;
  x.clearRect(0,0,W,H);x.fillStyle="#0c0f16";x.fillRect(0,0,W,H);
  for(let px=0;px<W;px++){const c=ramp(S,toneMap(px/(W-1)));x.fillStyle="rgb("+Math.min(255,c[0]*cfg.exposure*255|0)+","+Math.min(255,c[1]*cfg.exposure*255|0)+","+Math.min(255,c[2]*cfg.exposure*255|0)+")";x.fillRect(px,H-gh,1,gh);}
  x.strokeStyle="rgba(150,200,255,0.08)";x.lineWidth=1;for(let g=0;g<=4;g++){const gx=g/4*(W-1);x.beginPath();x.moveTo(gx,0);x.lineTo(gx,H-gh-1);x.stroke();}
  const ph=H-gh-2*pad;x.strokeStyle="#45d3ff";x.lineWidth=1.5;x.beginPath();
  for(let px=0;px<W;px++){let o=toneMap(px/(W-1))*cfg.exposure;o=o<0?0:o>1?1:o;const yy=pad+(1-o)*ph;px===0?x.moveTo(px,yy):x.lineTo(px,yy);}x.stroke();}
function hsl(h,s,l){h=((h%1)+1)%1;const a=s*Math.min(l,1-l);const fn=n=>{const k=(n+h*12)%12;return l-a*Math.max(-1,Math.min(k-3,Math.min(9-k,1)));};return[fn(0),fn(8),fn(4)];}
const ACC=[0.27,0.83,1.0];

/* ════════ loop ════════ */
let last=0,fc=0,ft=0,capT=0,lastV=0,stepAcc=0;
function frame(now){requestAnimationFrame(frame);
  const dt=Math.min((now-last)/1000,0.05);last=now;fc++;ft+=dt;
  const att=ATTRACTORS[cur],f=att.f,adt=att.dt;
  const M=cfg.count,T=cfg.trail;
  stepAcc+=cfg.speed;const sub=Math.floor(stepAcc);stepAcc-=sub;   // fractional flow speed (0.1–2 steps/frame) → ultra-slow fluid flow
  for(let i=0;i<M;i++){const p=particles[i];let s=p.pos;
    for(let k=0;k<sub;k++){
      s=rk4(s,adt,f);
      if(!isFinite(s[0])||!isFinite(s[1])||!isFinite(s[2])){const seed=particles[(Math.random()*M)|0].pos;s=[seed[0]+(Math.random()-0.5),seed[1]+(Math.random()-0.5),seed[2]+(Math.random()-0.5)];p.trail.length=0;}
      const d=f(s[0],s[1],s[2],P);const spd=Math.sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);
      p.speed=spd;p.trail.push([s[0],s[1],s[2],spd]);
    }
    while(p.trail.length>T)p.trail.shift();p.pos=s;
  }
  let maxSpeed=1e-6;
  for(let i=0;i<M;i++)if(particles[i].speed>maxSpeed)maxSpeed=particles[i].speed;
  const gmul=(cfg.glow/10)*0.85+0.2,expo=cfg.exposure,STOPS=PALETTES[cfg.palette]||PALETTES.stella;  // Glow → additive brightness; tone via palette+exposure
  let v=0;
  for(let i=0;i<M;i++){const p=particles[i],L=p.trail.length;if(L<2)continue;
    let spec=cfg.colMode==="spectrum",mono=cfg.colMode==="mono",sc=[0,0,0];
    if(spec)sc=hsl(i/M*0.8+0.5,0.85,0.6);else if(mono)sc=ACC;
    for(let j=0;j<L-1;j++){
      const p0=p.trail[j],p1=p.trail[j+1];
      const f0=j/(L-1),f1=(j+1)/(L-1);
      let r0,g0,b0,r1,g1,b1;
      if(spec||mono){r0=r1=sc[0];g0=g1=sc[1];b0=b1=sc[2];}
      else{const c0=ramp(STOPS,toneMap(p0[3]/maxSpeed)),c1=ramp(STOPS,toneMap(p1[3]/maxSpeed));r0=c0[0];g0=c0[1];b0=c0[2];r1=c1[0];g1=c1[1];b1=c1[2];}
      const br0=(0.12+1.15*Math.pow(f0,1.3))*gmul*expo, br1=(0.12+1.15*Math.pow(f1,1.3))*gmul*expo;
      positions[v*3]=p0[0];positions[v*3+1]=p0[1];positions[v*3+2]=p0[2];
      colors[v*3]=r0*br0;colors[v*3+1]=g0*br0;colors[v*3+2]=b0*br0;v++;
      positions[v*3]=p1[0];positions[v*3+1]=p1[1];positions[v*3+2]=p1[2];
      colors[v*3]=r1*br1;colors[v*3+1]=g1*br1;colors[v*3+2]=b1*br1;v++;
    }
  }
  geo.setDrawRange(0,v);
  geo.attributes.position.needsUpdate=true;geo.attributes.color.needsUpdate=true;
  const ptr=v>>1;
  if(cfg.autoRotate)view.autoTheta+=0.0013;
  const th=view.theta+view.autoTheta,ph=view.phi,R=view.radius;
  camera.position.set(view.center.x+R*Math.sin(ph)*Math.cos(th),view.center.y+R*Math.cos(ph),view.center.z+R*Math.sin(ph)*Math.sin(th));
  camera.lookAt(view.center);
  if(cfg.fog){fog.near=R*0.35;fog.far=R*2.4;}else{fog.near=1e5;fog.far=2e5;}
  renderer.render(scene,camera);
  lastV=maxSpeed;
  capT+=dt;
  if(capT>0.25){capT=0;
    document.getElementById("st-pts").innerHTML="<b>"+ptr.toLocaleString()+"</b> pts · "+M+"×"+T;
    document.getElementById("st-v").innerHTML="v<sub>max</sub> <b>"+maxSpeed.toFixed(1)+"</b>";}
  if(ft>=0.5){document.getElementById("st-fps").textContent=Math.round(fc/ft)+" fps";fc=0;ft=0;}
}

/* ════════ equations ════════ */
function renderEquations(){const wrap=document.getElementById("eq-blocks");wrap.innerHTML="";
  ATTRACTORS[cur].eq.forEach(b=>{const div=document.createElement("div");div.className="eq-block";
    let html=(b.sub?`<div class="eq-sublabel">${b.sub}</div>`:"");
    b.lines.forEach((_,i)=>html+=`<div class="eq-row" data-i="${i}"></div>`);
    div.innerHTML=html;wrap.appendChild(div);
    if(window.katex)b.lines.forEach((tex,i)=>{try{katex.render(tex,div.querySelector('[data-i="'+i+'"]'),{throwOnError:false,displayMode:true});}catch(e){}});
  });}

/* ════════ UI ════════ */
const $=id=>document.getElementById(id);
function setRange(r){const pct=(r.value-r.min)/(r.max-r.min)*100;r.style.setProperty("--pct",pct+"%");}
function loadParams(){P={};const ps=ATTRACTORS[cur].params;for(const k in ps)P[k]=ps[k].d;}
function buildParamUI(){const wrap=$("params");wrap.innerHTML="";const ps=ATTRACTORS[cur].params;
  for(const k in ps){const d=ps[k],row=document.createElement("div");row.className="mrow";
    row.innerHTML=`<span class="mrow-lbl">${d.l}</span><input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${P[k]}"><span class="val">${P[k].toFixed(3)}</span>`;
    wrap.appendChild(row);const r=row.querySelector("input");setRange(r);
    r.addEventListener("input",()=>{P[k]=parseFloat(r.value);row.querySelector(".val").textContent=P[k].toFixed(3);setRange(r);});}}
function selectSystem(key,keepView){cur=key;loadParams();buildParamUI();renderEquations();
  $("sysBlurb").innerHTML=`<b>${ATTRACTORS[cur].name}.</b> ${ATTRACTORS[cur].blurb}`;
  $("st-sys").textContent=ATTRACTORS[cur].name;reseed(keepView);}

const sel=$("sysSel");
for(const k in ATTRACTORS){const o=document.createElement("option");o.value=k;o.textContent=ATTRACTORS[k].name;sel.appendChild(o);}
sel.value=cur;sel.addEventListener("change",()=>selectSystem(sel.value,false));

$("btnDef").addEventListener("click",()=>{loadParams();buildParamUI();reseed(true);});
$("btnRand").addEventListener("click",()=>{const ps=ATTRACTORS[cur].params;for(const k in ps){const d=ps[k];P[k]=d.min+Math.random()*(d.max-d.min);}buildParamUI();reseed(true);});

function bindSlider(id,valId,key,fmt){const r=$(id);setRange(r);
  r.addEventListener("input",()=>{cfg[key]=parseFloat(r.value);$(valId).textContent=fmt?fmt(cfg[key]):cfg[key];setRange(r);});}
bindSlider("rCount","vCount","count");
bindSlider("rTrail","vTrail","trail");
bindSlider("rSpeed","vSpeed","speed");
bindSlider("rGlow","vGlow","glow",v=>(v/10).toFixed(1));
$("palSel").addEventListener("change",e=>{cfg.palette=e.target.value;drawToneCurve();});
[["rGamma","vGamma","gamma"],["rContrast","vContrast","contrast"],["rExposure","vExposure","exposure"]].forEach(a=>{const r=$(a[0]);setRange(r);r.addEventListener("input",()=>{cfg[a[2]]=parseFloat(r.value);$(a[1]).textContent=cfg[a[2]].toFixed(2);setRange(r);drawToneCurve();});});

$("colMode").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;[...$("colMode").children].forEach(x=>x.classList.remove("on"));b.classList.add("on");cfg.colMode=b.dataset.m;});
function tog(id,key,after){const el=$(id);el.addEventListener("click",()=>{cfg[key]=!cfg[key];el.classList.toggle("on",cfg[key]);if(after)after();});}
tog("tRot","autoRotate");
tog("tFog","fog");
$("btnView").addEventListener("click",()=>{view.theta=0.9;view.phi=1.05;view.autoTheta=0;reseed(true);});
$("eq-toggle").addEventListener("click",()=>{const p=$("eq-panel");const c=p.classList.toggle("collapsed");p.querySelector(".arrow").textContent=c?"▼":"▲";});

/* camera controls */
const cv=renderer.domElement;let dragging=false,lx=0,ly=0;
cv.addEventListener("pointerdown",e=>{dragging=true;lx=e.clientX;ly=e.clientY;cv.setPointerCapture(e.pointerId);});
cv.addEventListener("pointerup",()=>dragging=false);
cv.addEventListener("pointermove",e=>{if(!dragging)return;view.theta-=(e.clientX-lx)*0.006;view.phi-=(e.clientY-ly)*0.006;view.phi=Math.max(0.08,Math.min(Math.PI-0.08,view.phi));lx=e.clientX;ly=e.clientY;});
cv.addEventListener("wheel",e=>{e.preventDefault();view.radius*=(1+e.deltaY*0.0011);view.radius=Math.max(2,Math.min(2000,view.radius));},{passive:false});
let pinch=0;
cv.addEventListener("touchmove",e=>{if(e.touches.length===2){const dx=e.touches[0].clientX-e.touches[1].clientX,dy=e.touches[0].clientY-e.touches[1].clientY,d=Math.hypot(dx,dy);if(pinch)view.radius*=pinch/d;view.radius=Math.max(2,Math.min(2000,view.radius));pinch=d;e.preventDefault();}},{passive:false});
cv.addEventListener("touchend",()=>pinch=0);

function resize(){const W=host.clientWidth||600,H=host.clientHeight||400;renderer.setSize(W,H,false);camera.aspect=W/H;camera.updateProjectionMatrix();}
if(window.ResizeObserver)new ResizeObserver(resize).observe(host);else window.addEventListener("resize",resize);

setTimeout(()=>{resize();drawToneCurve();selectSystem("lorenz",false);requestAnimationFrame(frame);},40);
