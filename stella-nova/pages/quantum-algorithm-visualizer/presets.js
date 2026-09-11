// QAVE presets: named-algorithm gate builders (presetGates + PRESET_N) and the
// density-matrix packer densityToCell (rho = |psi><psi| -> mag,re,im per cell).
//   grep -n "function presetGates" presets.js   grep -n "function densityToCell" presets.js
import { RT } from './core.js';

const PRESET_N={bell:2,grover:3,dj:3,bv:4,toffoli:3,kick:2,teleport:3}; // fixed-size presets; others scale with the qubit count
// Build the gate list for a named algorithm at n qubits. The local helpers (H, X,
// CX, CP controlled-phase, CCZ, QFT, and so on) are small circuit-writing shorthands.
function presetGates(name,n){const g=[];
  const H=q=>g.push({name:'h',kind:'unitary',targets:[q],controls:[]});
  const X=q=>g.push({name:'x',kind:'unitary',targets:[q],controls:[]});
  const CX=(c,t)=>g.push({name:'cx',kind:'unitary',targets:[t],controls:[c]});
  const CZ=(c,t)=>g.push({name:'cz',kind:'unitary',targets:[t],controls:[c]});
  const CCX=(a,b,t)=>g.push({name:'ccx',kind:'unitary',targets:[t],controls:[a,b]});
  const RZ=(a,q)=>g.push({name:'rz',kind:'unitary',targets:[q],controls:[],params:[a]});
  const RY=(a,q)=>g.push({name:'ry',kind:'unitary',targets:[q],controls:[],params:[a]});
  const SWAP=(a,b)=>g.push({name:'swap',kind:'unitary',targets:[a,b],controls:[]});
  const CP=(c,t,l)=>{RZ(l/2,c);CX(c,t);RZ(-l/2,t);CX(c,t);RZ(l/2,t);};      // controlled phase λ
  const CCZ=(a,b,t)=>{H(t);CCX(a,b,t);H(t);};                                // controlled-controlled-Z
  const MEAS=()=>g.push({name:'measure',kind:'measurement',targets:Array.from({length:n},(_,i)=>i)});
  const qftOn=(qs,inv)=>{const s=inv?-1:1,m=qs.length;
    for(let to=0;to<m;to++){const tg=qs[m-1-to];H(tg);for(let co=to+1;co<m;co++)CP(qs[m-1-co],tg,s*Math.PI/Math.pow(2,co-to));}
    for(let i=0;i<(m>>1);i++)SWAP(qs[i],qs[m-1-i]);};
  const all=Array.from({length:n},(_,i)=>i);
  // One branch per algorithm: emit its gate sequence into g. Entangling and
  // interference families (Bell, GHZ, QFT, Grover, Deutsch-Jozsa, and so on).
  if(name==='bell'){H(0);CX(0,1);MEAS();}
  else if(name==='ghz'){H(0);for(let q=1;q<n;q++)CX(0,q);MEAS();}
  else if(name==='plus'){for(const q of all)H(q);}                            // uniform superposition: every ρ cell equal
  else if(name==='qft'){const prep=[0.17,-0.33,0.71,0.42,-0.6,0.95,-0.21,1.3];for(const q of all)H(q);all.forEach(q=>RZ(prep[q%prep.length],q));qftOn(all,false);}
  else if(name==='iqft'){for(const q of all)H(q);qftOn(all,true);}
  else if(name==='grover'){for(let q=0;q<3;q++)H(q);CCZ(0,1,2);              // oracle marks |111⟩
    for(let q=0;q<3;q++)H(q);for(let q=0;q<3;q++)X(q);CCZ(0,1,2);for(let q=0;q<3;q++)X(q);for(let q=0;q<3;q++)H(q);MEAS();} // diffusion
  else if(name==='dj'){X(2);for(let q=0;q<3;q++)H(q);CX(0,2);CX(1,2);H(0);H(1);MEAS();} // balanced oracle f=x0⊕x1
  else if(name==='bv'){X(3);for(let q=0;q<4;q++)H(q);CX(0,3);CX(2,3);H(0);H(1);H(2);MEAS();} // hidden string s=101
  else if(name==='toffoli'){H(0);H(1);CCX(0,1,2);MEAS();}
  else if(name==='kick'){X(1);H(0);CZ(0,1);H(0);MEAS();}                      // phase kickback onto the control
  else if(name==='teleport'){RY(0.9,0);H(1);CX(1,2);CX(0,1);H(0);MEAS();}     // teleportation through Bell-basis measurement
  else if(name==='scramble'){const ph=[0.4,1.1,-0.7,0.9,1.7,-1.3,0.55,2.0];for(const q of all)H(q);all.forEach(q=>RZ(ph[q%ph.length],q));
    for(let i=0;i<n-1;i++)CX(i,i+1);if(n>1)CX(n-1,0);for(const q of all)H(q);for(let i=0;i<n-1;i++)CZ(i,i+1);}
  return g;}

// Form the density matrix ρ = |ψ⟩⟨ψ| and pack each entry as (magnitude, re, im).
// ρ_rc = amp_r · conj(amp_c); this is what every cell in the 3D grid displays.
function densityToCell(state){ // returns Float32Array[DIM*DIM*3] = mag,re,im
  const re=state.re,im=state.im,out=new Float32Array(RT.DIM*RT.DIM*3);
  for(let r=0;r<RT.DIM;r++){const cr=re[r],ci=im[r];for(let c=0;c<RT.DIM;c++){
    const dr=re[c],di=im[c];const rRe=cr*dr+ci*di,rIm=ci*dr-cr*di;const k=(r*RT.DIM+c)*3;
    out[k]=Math.hypot(rRe,rIm);out[k+1]=rRe;out[k+2]=rIm;}}
  return out;}


export { presetGates, PRESET_N, densityToCell };
