/* ════════════════════════════════════════════════════════════
   CDF samplers
   Inverse-transform sampling tables for radius and polar angle.
   Pure math built on radialR / legendrePlm from physics.js.
   GREP: buildRadialCDF | buildThetaCDF | sampleCDF | radialQuantile
         buildTone
   ════════════════════════════════════════════════════════════ */
import { radialR, legendrePlm } from './physics.js';

// Inverse-transform sampling: tabulate the cumulative radial probability
// r²·R(r)² out to rMax, normalize to 1, and later invert it with a binary search
// so uniform draws land at physically correct radii.
export function buildRadialCDF(n,l){const M=4096,rMax=10*n*n;const cdf=new Float64Array(M);let sum=0;for(let i=0;i<M;i++){const r=i*rMax/(M-1),R=radialR(r,n,l);sum+=r*r*R*R;cdf[i]=sum;}for(let i=0;i<M;i++)cdf[i]/=sum;return{cdf,rMax,M};}
// Same idea for the polar angle: cumulative sinθ·P_ℓ^m(cosθ)² over [0,π].
export function buildThetaCDF(l,m){const M=2048;const cdf=new Float64Array(M);let sum=0;for(let i=0;i<M;i++){const theta=i*Math.PI/(M-1),Plm=legendrePlm(Math.cos(theta),l,m);sum+=Math.sin(theta)*Plm*Plm;cdf[i]=sum;}for(let i=0;i<M;i++)cdf[i]/=sum;return{cdf,M};}
// Draw one sample: binary-search a uniform u into the CDF, scale index to maxVal.
export function sampleCDF(d,maxVal){const{cdf,M}=d;const u=Math.random();let lo=0,hi=M-1;while(lo<hi){const mid=(lo+hi)>>1;if(cdf[mid]<u)lo=mid+1;else hi=mid;}return lo*maxVal/(M-1);}

// Radius (a.u.) that holds fraction p of the radial probability of table d.
export function radialQuantile(d,p){let i=0;while(i<d.M-1&&d.cdf[i]<p)i++;return i*d.rMax/(d.M-1);}

// Per-state tone for |ψ|². The density d = R²·P² has a range that changes by
// orders of magnitude with (n, ℓ, m), so one fixed gain cannot suit all states.
// 1. Peak: max R² times max P² (the two factors are separate).
// 2. Draw a 64 x 64 stratified grid of quantiles from the two CDFs. Each cell
//    has the same probability, so the sorted values are the density that the
//    particles show. hi is the 99.5 percent value, med is the median.
// 3. x = d / hi. For x <= 1 the tone is asinh(x/c) / asinh(1/c). The search
//    sets c so that the median particle gets tone 0.5. toneMap in physics.js
//    puts x > 1 (the top 0.5 percent, up to the peak) in the last tenth.
export function buildTone(rd,td,n,l,m){
  let pr=0;for(let i=0;i<rd.M;i++){const R=radialR(i*rd.rMax/(rd.M-1),n,l);if(R*R>pr)pr=R*R;}
  let pt=0;for(let i=0;i<td.M;i++){const P=legendrePlm(Math.cos(i*Math.PI/(td.M-1)),l,m);if(P*P>pt)pt=P*P;}
  const G=64,v=new Float64Array(G*G),q=(d,u,max)=>{let lo=0,hi=d.M-1;while(lo<hi){const mid=(lo+hi)>>1;if(d.cdf[mid]<u)lo=mid+1;else hi=mid;}return lo*max/(d.M-1);};
  for(let i=0;i<G;i++){const r=q(rd,(i+.5)/G,rd.rMax),R=radialR(r,n,l);
    for(let j=0;j<G;j++){const P=legendrePlm(Math.cos(q(td,(j+.5)/G,Math.PI)),l,m);v[i*G+j]=R*R*P*P;}}
  v.sort();
  const hi=Math.max(v[Math.floor(0.995*v.length)],1e-300),med=Math.max(v[v.length>>1]/hi,1e-12);
  const T=c=>Math.asinh(med/c)/Math.asinh(1/c);
  let lo=-30,up=4;for(let k=0;k<60;k++){const mid=(lo+up)/2;if(T(Math.exp(mid))>0.5)lo=mid;else up=mid;}
  const c=Math.exp((lo+up)/2);
  return {inv:1/hi,c,k:1/Math.asinh(1/c),lnPk:Math.log(Math.max(1,pr*pt/hi))};
}
