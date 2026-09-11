/* ════════════════════════════════════════════════════════════
   CDF samplers
   Inverse-transform sampling tables for radius and polar angle.
   Pure math built on radialR / legendrePlm from physics.js.
   GREP: buildRadialCDF | buildThetaCDF | sampleCDF
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
