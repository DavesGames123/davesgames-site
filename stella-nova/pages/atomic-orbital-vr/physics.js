/* ════════════════════════════════════════════════════════════
   PHYSICS
   Pure hydrogenic math and colormaps. No THREE, no scene, no
   shared state — every function uses only its parameters and the
   other pure helpers here. Safe to import from any module.
   GREP: radialR | legendrePlm | particleColor | probabilityFlow | fieldColor
   ════════════════════════════════════════════════════════════ */
// Plain factorial, used by the radial normalization constant below.
function factorial(n){if(n<=1)return 1;let r=1;for(let i=2;i<=n;i++)r*=i;return r;}

// Hydrogenic radial wavefunction R(n,ℓ) at radius r (atomic units). The middle
// block evaluates the associated Laguerre polynomial by upward recurrence, then
// the return multiplies in the normalization, the exp decay, and the ρ^ℓ factor.
export function radialR(r,n,l){
  const rho=2*r/n,k=n-l-1,alpha=2*l+1;let L=1;
  if(k===1){L=1+alpha-rho;}else if(k>1){let Lm2=1,Lm1=1+alpha-rho;for(let j=2;j<=k;j++){const t=((2*j-1+alpha-rho)*Lm1-(j-1+alpha)*Lm2)/j;Lm2=Lm1;Lm1=t;}L=Lm1;}
  return Math.sqrt(Math.pow(2/n,3)*factorial(n-l-1)/(2*n*factorial(n+l)))*Math.exp(-rho/2)*Math.pow(rho,l)*L;
}

// Associated Legendre P_ℓ^m(x), the polar (θ) factor of the spherical harmonic.
// Builds P_m^m from the closed form, then climbs ℓ by the standard recurrence.
export function legendrePlm(x,l,m){
  const am=Math.abs(m);let Pmm=1;
  if(am>0){const s=Math.sqrt((1-x)*(1+x));let f=1;for(let j=1;j<=am;j++){Pmm*=-f*s;f+=2;}}
  if(l===am)return Pmm;let Pm1m=x*(2*am+1)*Pmm;if(l===am+1)return Pm1m;
  let pp=Pmm;for(let ll=am+2;ll<=l;ll++){const t=((2*ll-1)*x*Pm1m-(ll+am-1)*pp)/(ll-am);pp=Pm1m;Pm1m=t;}return Pm1m;
}

// Probability colormap for |ψ|²: black ▶ violet ▶ red ▶ orange ▶ yellow ▶ white.
const HEAT=[[0,0,0],[.3,0,.6],[.8,0,0],[1,.5,0],[1,1,0],[1,1,1]];
// Map v in [0,1] onto the HEAT ramp with linear interpolation between stops.
function heatmap(v){v=Math.max(0,Math.min(1,v));const sv=v*5,i=Math.min(Math.floor(sv),4),t=sv-i;return[HEAT[i][0]+t*(HEAT[i+1][0]-HEAT[i][0]),HEAT[i][1]+t*(HEAT[i+1][1]-HEAT[i][1]),HEAT[i][2]+t*(HEAT[i+1][2]-HEAT[i][2])];}
// Signed colormap for Re(ψ) / Im(ψ): negative reads blue, positive reads red.
function diverging(v){v=Math.max(-1,Math.min(1,v));if(v>=0){const t=v;return[Math.min(1,t*2),Math.min(1,Math.max(0,t*2-.5)),0];}const t=-v;return[0,Math.min(1,Math.max(0,t*2-.5)),Math.min(1,t*2)];}

// Color one particle from the wavefunction at its position. Rebuilds R and P_ℓ^m
// there, forms the time-dependent phase m·φ − t/(2n²), then selects by mode:
// 0 |ψ|² heatmap · 1 Re · 2 Im · 3 phase (hue wheel around the azimuth).
export function particleColor(x,y,z,n,l,m,t,mode,scaler){
  const r=Math.sqrt(x*x+y*y+z*z);if(r<1e-6)return[0,0,0];
  const R=radialR(r,n,l),Plm=legendrePlm(y/r,l,m),phi=Math.atan2(z,x);
  const phase=m*phi-t/(2*n*n);
  if(mode===0)return heatmap(R*R*Plm*Plm*scaler);
  if(mode===1)return diverging(R*Plm*Math.cos(phase)*scaler*.05);
  if(mode===2)return diverging(R*Plm*Math.sin(phase)*scaler*.05);
  const phiE=((phase%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
  const hh=phiE/(2*Math.PI)*6,hi=Math.floor(hh)%6,ff=hh-Math.floor(hh),q=1-ff;
  return[[1,ff,0],[q,1,0],[0,1,ff],[0,q,1],[ff,0,1],[1,0,q]][hi];
}

// Probability current J = m/(r*sinθ) in phi-hat direction
export function probabilityFlow(x,y,z,m){
  const r=Math.sqrt(x*x+y*y+z*z);if(r<1e-6)return[0,0,0];
  const theta=Math.acos(Math.max(-1,Math.min(1,y/r))),phi=Math.atan2(z,x);
  const st=Math.max(Math.abs(Math.sin(theta)),1e-4)*Math.sign(Math.sin(theta)||1);
  const vm=m/(r*st);
  return[-vm*Math.sin(phi),0,vm*Math.cos(phi)];
}

// Field color ramp: dark-purple → blue → cyan → green → orange → white
// Compresses magnitude with a log curve, then a gamma, before the ramp lookup.
export function fieldColor(mag,gamma=1){
  const lv=Math.log10(1+mag*99)/2;
  const lc=Math.pow(Math.max(0,Math.min(1,lv)),1/Math.max(0.1,gamma));
  const stops=[[0.05,0,0.3],[0,0.2,1],[0,1,0.8],[0.2,1,0],[1,0.5,0],[1,1,1]];
  const sv=lc*5,i=Math.min(Math.floor(sv),4),t=sv-i;
  return[stops[i][0]+t*(stops[i+1][0]-stops[i][0]),stops[i][1]+t*(stops[i+1][1]-stops[i][1]),stops[i][2]+t*(stops[i+1][2]-stops[i][2])];
}
